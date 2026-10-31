import type { KeyboardStatus } from "../keyboard-types.ts";
import {
  MCHOSE_BASE_SIZE,
  MCHOSE_COMMAND,
  MCHOSE_CONFIG_USAGE,
  MCHOSE_CONFIG_USAGE_PAGE,
  MCHOSE_FUNC_CONFIG_SIZE,
  MCHOSE_INFO_SIZE,
  MCHOSE_KEY_TRAVEL_SIZE,
  MCHOSE_PROFILE_COUNT,
  MCHOSE_REPORT_ID,
  applyMchoseKeyTravelUpdate,
  decodeMchoseBase,
  decodeMchoseInfo,
  decodeMchoseKeyTravelTable,
  decodeMchosePerformance,
  decodeMchoseReply,
  encodeMchoseKeyTravel,
  mchoseBaseWithActiveProfile,
  mchoseChangedWriteFrames,
  mchoseConfigWithPollingRate,
  mchoseConfigWithWinLock,
  mchoseProduct,
  mchoseReadFrames,
  mchoseReplyMatches,
  mchoseWriteFrames,
  type MchoseBase,
  type MchoseCommand,
  type MchoseInfo,
  type MchoseKeyTravel,
  type MchoseKeyTravelUpdate,
  type MchoseKeyboardState,
  type MchosePerformance,
  type MchoseProduct,
  type MchoseReply,
  MCHOSE_ADVANCED_TABLE,
  MCHOSE_ADVANCED_SLOTS,
  MCHOSE_ACTION_SIZE,
  MCHOSE_KEY_SLOTS,
  MCHOSE_LIGHT_PROFILE_SIZE,
  MCHOSE_LIGHT_SLOTS,
  MCHOSE_MACRO_HEADER_SIZE,
  MCHOSE_MACRO_REGION_SIZE,
  MCHOSE_MAX_CHUNK,
  MCHOSE_PROFILE_NAMES_OFFSET,
  MCHOSE_PROFILE_NAMES_SIZE,
  decodeMchoseDks,
  decodeMchoseKeyColors,
  decodeMchoseKeymap,
  decodeMchoseLighting,
  decodeMchoseMacros,
  decodeMchoseModTap,
  decodeMchoseProfileNames,
  decodeMchoseSettings,
  decodeMchoseTable,
  decodeMchoseToggle,
  encodeMchoseActions,
  encodeMchoseDks,
  encodeMchoseJson,
  encodeMchoseKeyColors,
  encodeMchoseMacros,
  encodeMchoseModTap,
  encodeMchoseToggle,
  mchoseConfigWithDebugMode,
  mchoseConfigWithLighting,
  decodeMchoseKeyReport,
  type MchoseKeyReport,
  mchoseConfigWithSettings,
  mchoseKeymapOffset,
  mchoseLayoutFromDefaults,
  mchoseMacroRegionLength,
  MCHOSE_LAYER_COUNT,
  type MchoseAction,
  type MchoseAdvancedKeys,
  type MchoseAdvancedTable,
  type MchoseDks,
  type MchoseLighting,
  type MchoseMacro,
  type MchoseModTap,
  type MchoseRgb,
  type MchoseSettings,
} from "@openmouse/keyboard-protocol/mchose";

const REPLY_TIMEOUT_MS = 1000;
/** How long a factory reset waits for the keyboard to announce it, as the vendor app does. */
const RESET_WAIT_MS = 5000;
const REPLY_RETRIES = 2;
/** Quiet time after a timeout, so a late reply arrives while nothing waits for it and is dropped. */
const SETTLE_MS = 200;

/** MCHOSE magnetic keyboards (Ace 68 Air) on their vendor collection (usage page 0x0001, usage 0). */
export class MchoseKeyboardHidClient {
  readonly device: HIDDevice;
  private queue: Promise<unknown> = Promise.resolve();
  private listening = false;
  private faulted = false;
  private pending: { request: Uint8Array; resolve: (reply: MchoseReply) => void } | null = null;
  private readonly keyListeners = new Set<(report: MchoseKeyReport) => void>();
  private readonly resetListeners = new Set<() => void>();

  constructor(device: HIDDevice) { this.device = device; }

  static productFor(device: HIDDevice): MchoseProduct | undefined {
    const product = mchoseProduct(device.vendorId, device.productId);
    return product && MchoseKeyboardHidClient.hasCollection(device.collections) ? product : undefined;
  }

  static isSupported(device: HIDDevice): boolean {
    return MchoseKeyboardHidClient.productFor(device) !== undefined;
  }

  /** The vendor collection is top-level; the keyboard's other interfaces use usages 2, 6, 0x80 and 0x0C. */
  private static hasCollection(collections: readonly HIDCollectionInfo[]): boolean {
    return collections.some((collection) => collection.usagePage === MCHOSE_CONFIG_USAGE_PAGE && collection.usage === MCHOSE_CONFIG_USAGE);
  }

  private requireProduct(): MchoseProduct {
    const product = MchoseKeyboardHidClient.productFor(this.device);
    if (!product) throw new Error("Not a supported MCHOSE keyboard configuration interface.");
    return product;
  }

  async open(): Promise<void> {
    this.requireProduct();
    if (this.faulted) throw new Error("Reconnect the MCHOSE keyboard after a failed transaction.");
    if (!this.device.opened) await this.device.open();
    if (this.faulted) {
      if (this.device.opened) await this.device.close();
      throw new Error("Reconnect the MCHOSE keyboard after a failed transaction.");
    }
    if (!this.listening) {
      this.device.addEventListener("inputreport", this.onReport);
      this.listening = true;
    }
  }

  async close(): Promise<void> {
    this.faulted = true;
    this.pending = null;
    if (this.listening) this.device.removeEventListener("inputreport", this.onReport);
    this.listening = false;
    if (this.device.opened) await this.device.close();
  }

  private readonly onReport = (event: HIDInputReportEvent): void => {
    if (event.device !== this.device || event.reportId !== MCHOSE_REPORT_ID) return;
    const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    const key = decodeMchoseKeyReport(bytes);
    if (key) {
      this.keyListeners.forEach((listener) => listener(key));
      return;
    }
    // After a factory reset the keyboard announces it: 0xA2, or FA FB FF.
    if (bytes[0] === 0xa2 || (bytes[0] === 0xfa && bytes[1] === 0xfb && bytes[2] === 0xff)) {
      this.resetListeners.forEach((listener) => listener());
      this.resetListeners.clear();
      return;
    }
    const reply = decodeMchoseReply(bytes);
    if (reply && this.pending && mchoseReplyMatches(this.pending.request, reply)) this.pending.resolve(reply);
  };

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Send one frame and wait for its echo; `null` on timeout. */
  private async attempt(frame: Uint8Array<ArrayBuffer>): Promise<MchoseReply | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reply = new Promise<MchoseReply | null>((resolve) => {
      this.pending = { request: frame, resolve };
      timer = setTimeout(() => resolve(null), REPLY_TIMEOUT_MS);
    });
    try {
      const [answer] = await Promise.all([reply, this.device.sendReport(MCHOSE_REPORT_ID, frame)]);
      return answer;
    } finally {
      clearTimeout(timer);
      this.pending = null;
    }
  }

  /**
   * One frame and its echo. Like the vendor app, a frame that gets no answer
   * is sent again (twice at most): flash writes can take longer than the
   * reply timeout, and resending the same bytes to the same offset is
   * harmless. A frame that never answers marks the session unusable.
   */
  private async exchange(frame: Uint8Array<ArrayBuffer>): Promise<MchoseReply> {
    await this.open();
    try {
      for (let attempt = 0; attempt <= REPLY_RETRIES; attempt += 1) {
        const answer = await this.attempt(frame);
        if (answer) return answer;
        await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      }
      throw new Error(`The MCHOSE keyboard did not answer command 0x${frame[1]!.toString(16)}.`);
    } catch (error) {
      this.faulted = true;
      throw error;
    }
  }

  private async read(command: MchoseCommand, offset: number, size: number): Promise<Uint8Array> {
    const out = new Uint8Array(size);
    for (const frame of mchoseReadFrames(command, offset, size)) {
      const reply = await this.exchange(frame);
      // Only the info read answers short (31 of 56 bytes); anything else short would be
      // written back as zeros by a read-modify-write, so it ends the session instead.
      if (reply.size !== frame[4] && command !== MCHOSE_COMMAND.getInfo) {
        this.faulted = true;
        throw new Error(`The MCHOSE keyboard answered command 0x${command.toString(16)} with ${reply.size} of ${frame[4]} bytes.`);
      }
      out.set(reply.data, reply.offset - offset);
    }
    return out;
  }

  /** Send every frame and check each echo carries the data that was sent. */
  private async write(frames: readonly Uint8Array<ArrayBuffer>[]): Promise<void> {
    for (const frame of frames) {
      const ack = await this.exchange(frame);
      const sent = frame.subarray(8, 8 + frame[4]!);
      if (ack.size !== frame[4] || ack.data.some((byte, index) => byte !== sent[index])) {
        this.faulted = true;
        throw new Error("The MCHOSE keyboard did not echo the write.");
      }
    }
  }

  private static assertProfile(profile: number): void {
    if (!Number.isInteger(profile) || profile < 0 || profile >= MCHOSE_PROFILE_COUNT) {
      throw new RangeError(`MCHOSE profile must be 0-${MCHOSE_PROFILE_COUNT - 1}.`);
    }
  }

  private async readInfoValue(): Promise<MchoseInfo> {
    const info = decodeMchoseInfo(await this.read(MCHOSE_COMMAND.getInfo, 0, MCHOSE_INFO_SIZE));
    if (!info) throw new Error("The MCHOSE keyboard returned unreadable device info.");
    return info;
  }

  private async readBaseBytes(): Promise<Uint8Array> {
    return this.read(MCHOSE_COMMAND.getBase, 0, MCHOSE_BASE_SIZE);
  }

  private async readBaseValue(): Promise<MchoseBase> {
    const base = decodeMchoseBase(await this.readBaseBytes());
    if (!base) throw new Error("The MCHOSE keyboard reported an unreadable profile table.");
    return base;
  }

  private readFuncConfig(profile: number): Promise<Uint8Array> {
    return this.read(MCHOSE_COMMAND.getFuncConfig, MCHOSE_FUNC_CONFIG_SIZE * profile, MCHOSE_FUNC_CONFIG_SIZE);
  }

  private readTravelTable(profile: number): Promise<Uint8Array> {
    return this.read(MCHOSE_COMMAND.getKeyTravel, MCHOSE_KEY_TRAVEL_SIZE * profile, MCHOSE_KEY_TRAVEL_SIZE);
  }

  readInfo(): Promise<MchoseInfo> {
    return this.serialized(() => this.readInfoValue());
  }

  readBase(): Promise<MchoseBase> {
    return this.serialized(() => this.readBaseValue());
  }

  /** Make `profile` active and confirm it by reading the profile table back. */
  setActiveProfile(profile: number): Promise<MchoseBase> {
    return this.serialized(async () => {
      MchoseKeyboardHidClient.assertProfile(profile);
      const next = mchoseBaseWithActiveProfile(await this.readBaseBytes(), profile);
      await this.write(mchoseWriteFrames(MCHOSE_COMMAND.setBase, 0, next));
      const confirmed = await this.readBaseValue();
      if (confirmed.activeProfile !== profile) throw new Error("The MCHOSE keyboard did not switch profile.");
      return confirmed;
    });
  }

  readPerformance(profile: number): Promise<MchosePerformance> {
    return this.serialized(async () => {
      MchoseKeyboardHidClient.assertProfile(profile);
      const performance = decodeMchosePerformance(await this.readFuncConfig(profile));
      if (!performance) throw new Error("The MCHOSE keyboard returned an unreadable function config.");
      return performance;
    });
  }

  /** Read-modify-write one profile's function config, confirmed by read-back of all 64 bytes. */
  private updateFuncConfig(profile: number, change: (config: Uint8Array) => number[], onConfirmed?: (bytes: Uint8Array) => void): Promise<MchosePerformance> {
    return this.serialized(async () => {
      MchoseKeyboardHidClient.assertProfile(profile);
      const next = change(await this.readFuncConfig(profile));
      await this.write(mchoseWriteFrames(MCHOSE_COMMAND.setFuncConfig, MCHOSE_FUNC_CONFIG_SIZE * profile, next));
      const confirmed = await this.readFuncConfig(profile);
      if (confirmed.some((byte, index) => byte !== next[index])) throw new Error("The MCHOSE keyboard did not retain the setting.");
      onConfirmed?.(confirmed);
      return decodeMchosePerformance(confirmed)!;
    });
  }

  setPollingRate(profile: number, hz: number): Promise<MchosePerformance> {
    const product = this.requireProduct();
    if (!product.pollingRatesHz.includes(hz)) return Promise.reject(new RangeError(`${product.name} does not offer ${hz} Hz.`));
    return this.updateFuncConfig(profile, (config) => mchoseConfigWithPollingRate(config, hz));
  }

  setWinLock(profile: number, locked: boolean): Promise<MchosePerformance> {
    return this.updateFuncConfig(profile, (config) => mchoseConfigWithWinLock(config, locked));
  }

  readSettings(profile: number): Promise<MchoseSettings> {
    return this.serialized(async () => {
      MchoseKeyboardHidClient.assertProfile(profile);
      return decodeMchoseSettings(await this.readFuncConfig(profile));
    });
  }

  /** Write every setting of one profile at once; confirmed by read-back of the whole config. */
  async setSettings(profile: number, settings: MchoseSettings): Promise<MchoseSettings> {
    let confirmed: Uint8Array | null = null;
    await this.updateFuncConfig(profile, (config) => mchoseConfigWithSettings(config, profile, settings), (bytes) => { confirmed = bytes; });
    return decodeMchoseSettings(confirmed!);
  }

  readLighting(profile: number): Promise<MchoseLighting> {
    return this.serialized(async () => {
      MchoseKeyboardHidClient.assertProfile(profile);
      return decodeMchoseLighting(await this.readFuncConfig(profile));
    });
  }

  async setLighting(profile: number, lighting: MchoseLighting): Promise<MchoseLighting> {
    let confirmed: Uint8Array | null = null;
    await this.updateFuncConfig(profile, (config) => mchoseConfigWithLighting(config, lighting), (bytes) => { confirmed = bytes; });
    return decodeMchoseLighting(confirmed!);
  }

  private static assertLayer(layer: number): void {
    if (!Number.isInteger(layer) || layer < 0 || layer >= MCHOSE_LAYER_COUNT) throw new RangeError(`MCHOSE layer must be 0-${MCHOSE_LAYER_COUNT - 1}.`);
  }

  private readKeymapBytes(profile: number, layer: number): Promise<Uint8Array> {
    return this.read(MCHOSE_COMMAND.getKeymap, mchoseKeymapOffset(profile, layer), MCHOSE_KEY_SLOTS * MCHOSE_ACTION_SIZE);
  }

  /** The 128 keymap slots of one layer of one profile. */
  readKeymap(profile: number, layer: number): Promise<MchoseAction[]> {
    return this.serialized(async () => {
      MchoseKeyboardHidClient.assertProfile(profile);
      MchoseKeyboardHidClient.assertLayer(layer);
      return decodeMchoseKeymap(await this.readKeymapBytes(profile, layer), MCHOSE_KEY_SLOTS);
    });
  }

  /** The factory keymap of one layer. */
  readDefaultKeymap(layer: number): Promise<MchoseAction[]> {
    return this.serialized(async () => {
      MchoseKeyboardHidClient.assertLayer(layer);
      const bytes = await this.read(MCHOSE_COMMAND.getDefaultKeymap, layer * 512, MCHOSE_KEY_SLOTS * MCHOSE_ACTION_SIZE);
      return decodeMchoseKeymap(bytes, MCHOSE_KEY_SLOTS);
    });
  }

  /** Reassign some keys of one layer; only changed entries' windows are written, and the layer is read back. */
  setKeymap(profile: number, layer: number, updates: readonly { index: number; action: MchoseAction }[]): Promise<MchoseAction[]> {
    return this.serialized(async () => {
      MchoseKeyboardHidClient.assertProfile(profile);
      MchoseKeyboardHidClient.assertLayer(layer);
      const offset = mchoseKeymapOffset(profile, layer);
      const current = Array.from(await this.readKeymapBytes(profile, layer));
      const actions = decodeMchoseKeymap(current, MCHOSE_KEY_SLOTS);
      for (const { index, action } of updates) {
        if (!Number.isInteger(index) || index < 0 || index >= MCHOSE_KEY_SLOTS) throw new RangeError(`Key ${index} is outside the ${MCHOSE_KEY_SLOTS}-slot keymap.`);
        actions[index] = { ...action };
      }
      const next = encodeMchoseActions(actions);
      await this.write(mchoseChangedWriteFrames(MCHOSE_COMMAND.setKeymap, offset, current, next, MCHOSE_ACTION_SIZE));
      const confirmed = await this.readKeymapBytes(profile, layer);
      if (confirmed.some((byte, index) => byte !== next[index])) throw new Error("The MCHOSE keyboard did not retain the keymap.");
      return decodeMchoseKeymap(confirmed, MCHOSE_KEY_SLOTS);
    });
  }

  private readTableBytes(profile: number, table: MchoseAdvancedTable): Promise<Uint8Array> {
    const spec = MCHOSE_ADVANCED_TABLE[table];
    return this.read(spec.read as MchoseCommand, spec.stride * profile, spec.stride);
  }

  /** DKS, mod-tap and toggle slots of one profile. */
  readAdvancedKeys(profile: number): Promise<MchoseAdvancedKeys> {
    return this.serialized(async () => {
      MchoseKeyboardHidClient.assertProfile(profile);
      return {
        dks: decodeMchoseTable(await this.readTableBytes(profile, "dks"), MCHOSE_ADVANCED_TABLE.dks.record, decodeMchoseDks),
        modTap: decodeMchoseTable(await this.readTableBytes(profile, "modTap"), MCHOSE_ADVANCED_TABLE.modTap.record, decodeMchoseModTap),
        toggle: decodeMchoseTable(await this.readTableBytes(profile, "toggle"), MCHOSE_ADVANCED_TABLE.toggle.record, decodeMchoseToggle),
      };
    });
  }

  private writeSlot(profile: number, table: MchoseAdvancedTable, slot: number, record: number[]): Promise<void> {
    return this.serialized(async () => {
      MchoseKeyboardHidClient.assertProfile(profile);
      const spec = MCHOSE_ADVANCED_TABLE[table];
      if (!Number.isInteger(slot) || slot < 0 || slot >= MCHOSE_ADVANCED_SLOTS) throw new RangeError(`Slot ${slot} is outside the ${table} table.`);
      const current = Array.from(await this.readTableBytes(profile, table));
      const next = current.slice();
      next.splice(slot * spec.record, spec.record, ...record);
      await this.write(mchoseChangedWriteFrames(spec.write as MchoseCommand, spec.stride * profile, current, next, spec.record));
      const confirmed = await this.readTableBytes(profile, table);
      if (confirmed.some((byte, index) => byte !== next[index])) throw new Error(`The MCHOSE keyboard did not retain the ${table} slot.`);
    });
  }

  setDks(profile: number, slot: number, dks: MchoseDks): Promise<void> {
    return this.writeSlot(profile, "dks", slot, encodeMchoseDks(dks));
  }

  setModTap(profile: number, slot: number, entry: MchoseModTap): Promise<void> {
    return this.writeSlot(profile, "modTap", slot, encodeMchoseModTap(entry));
  }

  setToggle(profile: number, slot: number, action: MchoseAction): Promise<void> {
    return this.writeSlot(profile, "toggle", slot, encodeMchoseToggle(action));
  }

  /** Clear a slot (all zero), as the vendor app does when a key stops using it. */
  clearSlot(profile: number, table: MchoseAdvancedTable, slot: number): Promise<void> {
    return this.writeSlot(profile, table, slot, new Array<number>(MCHOSE_ADVANCED_TABLE[table].record).fill(0));
  }

  private async readMacroRegion(): Promise<number[]> {
    const region = Array.from(await this.read(MCHOSE_COMMAND.getMacros, 0, MCHOSE_MACRO_HEADER_SIZE));
    while (region.length < MCHOSE_MACRO_REGION_SIZE && mchoseMacroRegionLength(region, region) === null) {
      const size = Math.min(MCHOSE_MAX_CHUNK, MCHOSE_MACRO_REGION_SIZE - region.length);
      region.push(...await this.read(MCHOSE_COMMAND.getMacros, region.length, size));
    }
    return region;
  }

  /** The 16 macros, shared by every profile. */
  readMacros(): Promise<MchoseMacro[]> {
    return this.serialized(async () => decodeMchoseMacros(await this.readMacroRegion()));
  }

  /** Rewrite all 16 macros and confirm the used bytes on read-back. */
  setMacros(macros: readonly MchoseMacro[]): Promise<MchoseMacro[]> {
    return this.serialized(async () => {
      const next = encodeMchoseMacros(macros);
      await this.write(mchoseWriteFrames(MCHOSE_COMMAND.setMacros, 0, next));
      const confirmed = await this.readMacroRegion();
      if (next.some((byte, index) => byte !== confirmed[index])) throw new Error("The MCHOSE keyboard did not retain the macros.");
      return decodeMchoseMacros(confirmed);
    });
  }

  private readColorBytes(profile: number): Promise<Uint8Array> {
    return this.read(MCHOSE_COMMAND.getKeyColors, MCHOSE_LIGHT_PROFILE_SIZE * profile, MCHOSE_LIGHT_SLOTS * 3);
  }

  /** Per-key colours of the Custom effect, by matrix slot. */
  readKeyColors(profile: number): Promise<MchoseRgb[]> {
    return this.serialized(async () => {
      MchoseKeyboardHidClient.assertProfile(profile);
      return decodeMchoseKeyColors(await this.readColorBytes(profile));
    });
  }

  setKeyColors(profile: number, updates: readonly { index: number; color: MchoseRgb }[]): Promise<MchoseRgb[]> {
    return this.serialized(async () => {
      MchoseKeyboardHidClient.assertProfile(profile);
      const current = Array.from(await this.readColorBytes(profile));
      const colors = decodeMchoseKeyColors(current);
      for (const { index, color } of updates) {
        if (!Number.isInteger(index) || index < 0 || index >= MCHOSE_LIGHT_SLOTS) throw new RangeError(`Key ${index} is outside the colour table.`);
        colors[index] = { ...color };
      }
      const next = encodeMchoseKeyColors(colors);
      await this.write(mchoseChangedWriteFrames(MCHOSE_COMMAND.setKeyColors, MCHOSE_LIGHT_PROFILE_SIZE * profile, current, next, 3));
      const confirmed = await this.readColorBytes(profile);
      if (confirmed.some((byte, index) => byte !== next[index])) throw new Error("The MCHOSE keyboard did not retain the colours.");
      return decodeMchoseKeyColors(confirmed);
    });
  }

  private readNameBytes(): Promise<Uint8Array> {
    return this.read(MCHOSE_COMMAND.getCustomData, MCHOSE_PROFILE_NAMES_OFFSET, MCHOSE_PROFILE_NAMES_SIZE);
  }

  /** Profile names as the vendor app stores them (profile 0's custom area). */
  readProfileNames(): Promise<(string | null)[]> {
    return this.serialized(async () => decodeMchoseProfileNames(await this.readNameBytes()));
  }

  /** Rename one profile; the other names are written back as read. */
  setProfileName(profile: number, name: string): Promise<(string | null)[]> {
    return this.serialized(async () => {
      MchoseKeyboardHidClient.assertProfile(profile);
      const names = decodeMchoseProfileNames(await this.readNameBytes()).map((entry) => entry ?? "");
      names[profile] = name;
      // Like the vendor app, send only the 56-byte frames the JSON and its first 0xFF pad need.
      const padded = encodeMchoseJson(names, MCHOSE_PROFILE_NAMES_SIZE);
      const length = Math.min(MCHOSE_PROFILE_NAMES_SIZE, MCHOSE_MAX_CHUNK * Math.ceil((padded.indexOf(0xff) + 1) / MCHOSE_MAX_CHUNK));
      const next = padded.slice(0, length);
      await this.write(mchoseWriteFrames(MCHOSE_COMMAND.setCustomData, MCHOSE_PROFILE_NAMES_OFFSET, next));
      const confirmed = await this.readNameBytes();
      if (next.some((byte, index) => byte !== confirmed[index])) throw new Error("The MCHOSE keyboard did not retain the profile name.");
      return decodeMchoseProfileNames(confirmed);
    });
  }

  /**
   * Key reports sent while debug mode is on: travel and calibration state of
   * each key as it moves. Returns a function that stops listening.
   */
  onKeyReport(listener: (report: MchoseKeyReport) => void): () => void {
    this.keyListeners.add(listener);
    return () => { this.keyListeners.delete(listener); };
  }

  /** Debug mode makes the keyboard send key reports; the vendor app keeps it on only while calibrating. */
  setDebugMode(profile: number, on: boolean): Promise<MchosePerformance> {
    return this.updateFuncConfig(profile, (config) => mchoseConfigWithDebugMode(config, on));
  }

  /**
   * Calibration: start it, have the user press every key fully, then end it.
   * Progress comes as key reports, with debug mode on.
   */
  calibrate(step: "start" | "end" | "restart"): Promise<void> {
    const command = step === "start" ? MCHOSE_COMMAND.startCalibration : step === "end" ? MCHOSE_COMMAND.endCalibration : MCHOSE_COMMAND.restartCalibration;
    return this.serialized(() => this.write(mchoseWriteFrames(command, 0, [0])));
  }

  /**
   * Factory reset, as the vendor app's "Restore factory settings": one
   * profile back to how the keyboard shipped, or the whole keyboard with
   * "all". Resolves once the keyboard announces the reset, or after 5 s.
   * The keyboard then reboots and attaches again as a new device, so this
   * session cannot be used afterwards.
   */
  factoryReset(target: number | "all"): Promise<void> {
    return this.serialized(async () => {
      if (target !== "all") MchoseKeyboardHidClient.assertProfile(target);
      let done: () => void = () => undefined;
      const announced = new Promise<void>((resolve) => { done = resolve; });
      this.resetListeners.add(done);
      // A closed or faulted session must fail here, not be mistaken for a reboot below.
      await this.open();
      const timer = setTimeout(done, RESET_WAIT_MS);
      try {
        // An Ace 68 Air III reboots straight away, often before it echoes the frame.
        await this.write(mchoseWriteFrames(MCHOSE_COMMAND.factoryReset, 0, [target === "all" ? 255 : target])).catch(() => undefined);
        await announced;
      } finally {
        clearTimeout(timer);
        this.resetListeners.delete(done);
      }
    });
  }

  /** All 128 key-travel records of one profile, by matrix slot. */
  readKeyTravel(profile: number): Promise<MchoseKeyTravel[]> {
    return this.serialized(async () => {
      MchoseKeyboardHidClient.assertProfile(profile);
      return decodeMchoseKeyTravelTable(await this.readTravelTable(profile));
    });
  }

  /**
   * Edit some keys of one profile. The table is read first, every update is
   * range-checked before anything is sent, only changed 56-byte windows are
   * written, and the whole table is read back to confirm.
   */
  setKeyTravel(profile: number, updates: readonly MchoseKeyTravelUpdate[]): Promise<MchoseKeyTravel[]> {
    return this.serialized(async () => {
      MchoseKeyboardHidClient.assertProfile(profile);
      const offset = MCHOSE_KEY_TRAVEL_SIZE * profile;
      const current = Array.from(await this.readTravelTable(profile));
      const keys = decodeMchoseKeyTravelTable(current);
      for (const update of updates) {
        const key = keys[update.index];
        if (!key) throw new RangeError(`Key ${update.index} is outside the ${keys.length}-slot table.`);
        keys[update.index] = applyMchoseKeyTravelUpdate(key, update);
      }
      const next = keys.flatMap((key) => encodeMchoseKeyTravel(key));
      await this.write(mchoseChangedWriteFrames(MCHOSE_COMMAND.setKeyTravel, offset, current, next));
      const confirmed = await this.readTravelTable(profile);
      if (confirmed.some((byte, index) => byte !== next[index])) throw new Error("The MCHOSE keyboard did not retain the key travel.");
      return decodeMchoseKeyTravelTable(confirmed);
    });
  }

  private async optionalRead<T>(read: () => Promise<T>): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      if (this.faulted) throw error;
      return null;
    }
  }

  readStatus(): Promise<KeyboardStatus> {
    return this.serialized(async () => {
      const product = this.requireProduct();
      const info = await this.readInfoValue();
      const base = await this.optionalRead(() => this.readBaseValue());
      const profile = base?.activeProfile ?? 0;
      const config = await this.optionalRead(() => this.readFuncConfig(profile));
      const travel = await this.optionalRead(async () => decodeMchoseKeyTravelTable(await this.readTravelTable(profile)));
      const profileNames = await this.optionalRead(async () => decodeMchoseProfileNames(await this.readNameBytes()));
      const defaults = await this.optionalRead(() => this.read(MCHOSE_COMMAND.getDefaultKeymap, 0, MCHOSE_KEY_SLOTS * MCHOSE_ACTION_SIZE));
      const mchose: MchoseKeyboardState = {
        productId: product.productId,
        verified: product.verified,
        info,
        base,
        performance: config ? decodeMchosePerformance(config) : null,
        settings: config ? decodeMchoseSettings(config) : null,
        lighting: config ? decodeMchoseLighting(config) : null,
        profileNames,
        layout: defaults ? mchoseLayoutFromDefaults(decodeMchoseKeymap(defaults, MCHOSE_KEY_SLOTS)) : null,
        travel,
      };
      const firmware = [`Firmware: ${info.firmwareVersion}`];
      if (info.chip) firmware.push(`Controller: ${info.chip}`);
      if (info.buildDate) firmware.push(`Built: ${info.buildDate}`);
      return {
        brand: "MCHOSE",
        name: product.name,
        ui: {
          family: "mchose",
          settingsReady: false,
          defaultDisplayName: product.name,
          statusNote: product.verified ? undefined : "MCHOSE support for this model comes from the vendor's web configurator; it has not been tested through OpenMouse.",
        },
        connectionType: "Wired",
        connectionDetail: "USB",
        firmware,
        firmwareVersion: info.firmwareVersion,
        layout: null,
        serial: null,
        activeProfile: base?.activeProfile ?? null,
        profileCount: base?.profileCount ?? null,
        profileNames: profileNames ?? [],
        mchose,
      };
    });
  }
}
