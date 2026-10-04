import type {
  KeyboardStatus,
  WootingAnalogProfileFull,
  WootingAnalogSnapshot,
  WootingDiagnostics,
  WootingGamepad,
  WootingMappings,
  WootingRgb,
} from "../keyboard-types.ts";
import {
  decodeWootingAkcProfile,
  decodeWootingAnalogProfilesCount,
  decodeWootingAnalogReport,
  decodeWootingAnalogSnapshot,
  decodeWootingDeviceConfig,
  decodeWootingFlashChipConnected,
  decodeWootingFlashStats,
  decodeWootingFunctionMappingProfile,
  decodeWootingGamepadProfile,
  decodeWootingGlobalSettings,
  decodeWootingKeyboardProfile,
  decodeWootingMainMappingProfile,
  decodeWootingMappingProfile,
  decodeWootingNumberOfKeys,
  decodeWootingProfileIndex,
  decodeWootingProfileMetadata,
  decodeWootingRgbProfileColors,
  decodeWootingRgbProfileCore,
  decodeWootingRgbProfileCount,
  decodeWootingRgbLayer,
  decodeWootingVersion,
  encodeWootingCommand,
  encodeWootingProfileCommand,
  encodeWootingProfileSwitch,
  encodeWootingRgbBuffer,
  encodeWootingSaveCommand,
  encodeWootingSingleColor,
  isWootingReply,
  wootingActuationMm,
  wootingFeatureReport,
  wootingProductName,
  wootingReplyOk,
  WOOTING_PROFILE_SWITCH_SETTLE_MS,
  WOOTING_ANALOG_USAGE_PAGE,
  WOOTING_ANALOG_USAGE_PAGE_ALT,
  WOOTING_COMMAND,
  WOOTING_CONFIG_USAGE,
  WOOTING_CONFIG_USAGE_PAGE,
  WOOTING_CONFIG_USAGE_PAGE_STANDARD,
  WOOTING_PRODUCTS,
  WOOTING_STATUS_ERROR,
  WOOTING_VENDOR_ID,
  type WootingActuationProfile,
  type WootingAkcProfile,
  type WootingAnalogKey,
  type WootingDksProfile,
  type WootingRapidTriggerProfile,
  WOOTING_MAGIC_MULTI,
  WOOTING_MAGIC_WORD_1,
} from "@openmouse/keyboard-protocol/wooting";

/** Settle delay so the analog-stream collect window never overlaps a reply. */
function wootingDelay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * Wooting analog keyboard (60HE+) HID control — identity + profile reads plus
 * the safe write subset: RAM-only profile switching (0x21/0x17/0x26),
 * RAM-only RGB-direct (0x1E/0x1F/0x20) and full-buffer push, and
 * confirm-gated flash saves (0x08/0x2A/0x2F/0x35).
 *
 * NEVER encoded here: 0x02 (bootloader — leaves HID), 0x15 (keys_off — kills
 * output), 0x19 (soft reset — drops RAM), 0x2B (factory reset). Writes bypass
 * the read cache and invalidate it after, so a readStatus after any write
 * re-reads the board instead of echoing stale bytes.
 */

const CONFIG_RESPONSE_TIMEOUT_MS = 400;
/** How long to gather input reports for a multi-report reply (ack + data). */
const COLLECT_WINDOW_MS = 130;
/**
 * Upper bound on profile slots probed via get_profile_metadata before giving
 * up. Real boards ship ≤ 4; the cap only bounds a board that answers every
 * probe with garbage.
 */
const MAX_PROFILE_PROBE_SLOTS = 8;
/** Pending single-reply read: resolvers handed to the input-report listener. */
export interface WootingResponseWaiter {
  resolve: (data: Uint8Array) => void;
  reject: (error: Error) => void;
  /** Command id the waiter was armed for; -1 accepts any genuine reply. */
  commandId: number;
}

/** Timeout handle guarding a pending single-reply read. */
export type WootingResponseTimer = ReturnType<typeof setTimeout>;

export class WootingHidClient {
  readonly device: HIDDevice;

  private responseWaiter: WootingResponseWaiter | null = null;
  private responseTimer: WootingResponseTimer | null = null;

  // Each command's raw reply is read once per connection and cached, so a
  // failure (or a device that just will not answer) never re-spams writes on
  // every background refresh.
  private readonly replies = new Map<number, Uint8Array | null>();

  // Serializes command sends so a profile read and a status refresh never share
  // the single input-report reply channel at the same time.
  private commandLock: Promise<unknown> = Promise.resolve();

  // When set, input reports are accumulated here instead of resolving a single
  // waiter — used to gather a multi-report reply (ack + data) for one command.
  private collecting: Uint8Array[] | null = null;

  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    const bytes = new Uint8Array(
      event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength),
    );
    if (this.collecting) {
      this.collecting.push(bytes);
      return;
    }
    // Keypress chatter (plain keyboard/boot reports, analog-stream frames)
    // arrives on this same channel — only a magic-word reply echoing the
    // command this waiter was armed for may resolve it. Anything else is
    // left for the analog listener and the waiter keeps waiting for the
    // real reply (or times out, and the caller falls back to null, never
    // to a keystroke).
    const waiter = this.responseWaiter;
    if (!waiter) return;
    if (!isWootingReply(bytes)) return;
    if (waiter.commandId >= 0 && bytes[2] !== waiter.commandId) return;
    this.clearPendingRead();
    waiter.resolve(bytes);
  };

  private listening = false;

  constructor(device: HIDDevice) {
    this.device = device;
  }

  /**
   * Wooting VID plus the command-capable config collection: usage page `0xFF55`
   * (ARM, 60HE+ and later) or `0x1337` (Standard, One / Two / original 60HE),
   * usage `0x01`. Only these collections are matched — a board also presents a
   * legacy `0xFF00` collection and the analog stream, and matching those would
   * list the same physical keyboard several times.
   */
  static isSupported(device: HIDDevice): boolean {
    if (device.vendorId !== WOOTING_VENDOR_ID) return false;
    if (!WOOTING_PRODUCTS[device.productId]) return false;
    return WootingHidClient.configCollection(device.collections) !== null;
  }

  /** The command-capable config collection, if this device exposes one. */
  private static configCollection(
    collections: readonly HIDCollectionInfo[],
  ): HIDCollectionInfo | null {
    for (const collection of collections) {
      if (collection.usage === WOOTING_CONFIG_USAGE
        && (collection.usagePage === WOOTING_CONFIG_USAGE_PAGE
          || collection.usagePage === WOOTING_CONFIG_USAGE_PAGE_STANDARD)) {
        return collection;
      }
      const nested = WootingHidClient.configCollection(collection.children);
      if (nested) return nested;
    }
    return null;
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
    if (!this.listening) {
      this.device.addEventListener("inputreport", this.onInputReport);
      this.listening = true;
    }
  }

  async close(): Promise<void> {
    if (this.listening) {
      this.device.removeEventListener("inputreport", this.onInputReport);
      this.listening = false;
    }
    if (this.device.opened) await this.device.close();
  }

  /**
   * Subscribe to the live analog key stream. The board pushes a full snapshot
   * of the currently-pressed keys as input reports on its analog interface
   * (0xFF53, or 0xFF54 on some PIDs — a sibling of the config interface).
   * Opens that interface, forwards each decoded frame to `onFrame`, and
   * resolves to a stop function that detaches the listener. Rejects if the
   * analog interface is not available to the page.
   */
  async startAnalog(onFrame: (keys: WootingAnalogKey[]) => void): Promise<() => void> {
    const analog = await this.analogDevice();
    if (!analog) {
      throw new Error("This Wooting's analog interface is not available to OpenMouse.");
    }
    if (!analog.opened) await analog.open();
    const listener = (event: HIDInputReportEvent): void => {
      const data = new Uint8Array(
        event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength),
      );
      onFrame(decodeWootingAnalogReport(data));
    };
    analog.addEventListener("inputreport", listener);
    return () => analog.removeEventListener("inputreport", listener);
  }

  /** The sibling analog-stream interface (same board, usage page 0xFF53/0xFF54). */
  private async analogDevice(): Promise<HIDDevice | null> {
    const hid = (globalThis.navigator as Navigator | undefined)?.hid;
    if (!hid) return null;
    const devices = await hid.getDevices();
    return devices.find((device) =>
      device.vendorId === WOOTING_VENDOR_ID
      && device.productId === this.device.productId
      && device.collections.some((collection) =>
        (collection.usagePage === WOOTING_ANALOG_USAGE_PAGE
          || collection.usagePage === WOOTING_ANALOG_USAGE_PAGE_ALT)
        && collection.usage === WOOTING_CONFIG_USAGE),
    ) ?? null;
  }

  async readStatus(): Promise<KeyboardStatus> {
    await this.open();
    // Sequential: each reply is awaited before the next command is sent, so the
    // input-report answers never interleave.
    const version = await this.command(WOOTING_COMMAND.getVersion);
    const config = await this.command(WOOTING_COMMAND.getDeviceConfig);
    const serial = await this.command(WOOTING_COMMAND.getSerial);
    const profile = await this.readProfileState();

    const name = wootingProductName(this.device.productId);
    const firmwareVersion = version ? decodeWootingVersion(version) : null;
    const layout = config?.subarray(4).some((byte) => byte !== 0)
      ? decodeWootingDeviceConfig(config)?.layout ?? null
      : null;
    const lines: string[] = [];
    if (version) lines.push(firmwareVersion ? `Firmware: ${firmwareVersion}` : `Version reply: ${wootingHexPreview(version, 20)}`);
    if (config) {
      // A header-only config answer has no payload to decode — show the raw
      // bytes, never an invented layout.
      lines.push(layout ? `Layout: ${layout}` : `Config reply: ${wootingHexPreview(config, 20)}`);
    }
    return {
      brand: "Wooting",
      name,
      ui: {
        family: "wooting",
        // No host consumer reads the nested objects yet, so the mouse grid
        // stays hidden; the fields are present for the planned keyboard UI.
        settingsReady: false,
        defaultDisplayName: name,
      },
      connectionType: "Wired",
      connectionDetail: "USB",
      firmware: lines,
      firmwareVersion,
      layout,
      serial: serial ? wootingSerialText(serial) : null,
      activeProfile: profile.active,
      profileCount: profile.count,
      profileNames: profile.names,
      analogProfile: profile.analogProfile,
      perKeyActuation: profile.perKeyActuation,
      rapidTrigger: profile.rapidTrigger,
      mappings: profile.mappings,
      dks: profile.dks,
      akc: profile.akc,
      gamepad: profile.gamepad,
      rgb: profile.rgb,
      diagnostics: profile.diagnostics,
      analogSnapshot: profile.analogSnapshot,
    };
  }

  /**
   * Active profile slot plus the named-slot census. Never throws: every leg is
   * best-effort and an unreadable board reports nulls the host renders as
   * "unknown" rather than a guessed slot.
   *
   * GetDigitalProfilesCount answers 0x66 on ARM, so slot existence is probed
   * one metadata read at a time (wootswitch): the census stops at the first
   * slot the board reports empty. A nameless-but-populated slot still counts
   * (name null), because the metadata length prefix is what proves existence.
   */
  private async readProfileState(): Promise<{
    active: number | null;
    count: number | null;
    names: readonly (string | null)[];
    analogProfile: WootingAnalogProfileFull | null;
    perKeyActuation: WootingActuationProfile | null;
    rapidTrigger: WootingRapidTriggerProfile | null;
    mappings: WootingMappings | null;
    dks: WootingDksProfile | null;
    akc: WootingAkcProfile | null;
    gamepad: WootingGamepad | null;
    rgb: WootingRgb | null;
    diagnostics: WootingDiagnostics | null;
    analogSnapshot: WootingAnalogSnapshot | null;
  }> {
    const indexReply = await this.command(WOOTING_COMMAND.getCurrentKeyboardProfileIndex);
    const active = indexReply ? decodeWootingProfileIndex(indexReply)?.active ?? null : null;
    // GetDigitalProfilesCount answers 0x66 on ARM — probe per-slot metadata
    // instead (wootswitch). A direct count is still tried first: Standard
    // boards answer it and it costs one round trip.
    const direct = await this.command(WOOTING_COMMAND.getDigitalProfilesCount);
    let count: number | null;
    let names: readonly (string | null)[];
    if (direct && direct[3] !== WOOTING_STATUS_ERROR && direct.length > 4) {
      count = direct[4]!;
      names = await this.readProfileNames(count);
    } else {
      const probed: (string | null)[] = [];
      let probedCount: number | null = null;
      for (let slot = 0; slot < MAX_PROFILE_PROBE_SLOTS; slot += 1) {
        const reply = await this.sendProfileCommand(WOOTING_COMMAND.getProfileMetadata, slot).catch(() => null);
        const decoded = reply ? decodeWootingProfileMetadata(reply) : null;
        if (!decoded?.exists) break;
        probed.push(decoded.name);
        probedCount = slot + 1;
      }
      count = probedCount;
      names = probed;
    }
    // Deep feature reads target the runtime-active slot (0 when the index is
    // unreadable) and stay best-effort: every helper catches its own failure,
    // so identity (firmware/layout/profiles) always survives a silent extra.
    const target = active ?? 0;
    const [analogProfile, mappings, dks, akc, gamepad, rgb, diagnostics, analogSnapshot] = await Promise.all([
      this.readAnalogProfileFull(target).catch(() => null),
      this.readMappings(target).catch(() => null),
      this.readDks(target).catch(() => null),
      this.readAkc(target).catch(() => null),
      this.readGamepad(target).catch(() => null),
      this.readRgb(target).catch(() => null),
      this.readDiagnostics().catch(() => null),
      this.readAnalogSnapshot().catch(() => ({ available: false as const, keys: [] })),
    ]);
    return { active, count, names, analogProfile, perKeyActuation: null, rapidTrigger: null, mappings, dks, akc, gamepad, rgb, diagnostics, analogSnapshot };
  }

  /** Profile names for slots `0..slotCount`, null where the board stays silent. */
  private async readProfileNames(slotCount: number): Promise<(string | null)[]> {
    const names: (string | null)[] = [];
    for (let slot = 0; slot < slotCount; slot += 1) {
      const reply = await this.sendProfileCommand(WOOTING_COMMAND.getProfileMetadata, slot).catch(() => null);
      names.push(reply ? decodeWootingProfileMetadata(reply)?.name ?? null : null);
    }
    return names;
  }

  // ---------------------------------------------------------------------------
  // Report I/O
  // ---------------------------------------------------------------------------

  /**
   * Best-effort live read of a command's raw reply, attempted once per connection
   * and then cached. Never throws: on any failure it returns null, the caller
   * falls back to whatever it has, and the failure is remembered so a background
   * refresh does not try (and fail) the write again.
   */
  private async command(commandId: number): Promise<Uint8Array | null> {
    if (this.replies.has(commandId)) return this.replies.get(commandId) ?? null;
    const raw = await this.sendCommand(commandId).catch(() => null);
    this.replies.set(commandId, raw);
    return raw;
  }

  /**
   * Actuation + rapid trigger for the active profile (0x27) plus global
   * settings (0x33). Never throws: every leg is best-effort and a silent
   * board reports nulls. Live 60HE+ 0x27 body is 22 bytes with actuation raw
   * 17203 = 0.20mm on the contract line `raw = 16384 + mm * 4096`.
   */
  async readAnalogProfileFull(slot?: number): Promise<WootingAnalogProfileFull | null> {
    await this.open();
    const target = slot ?? await this.activeSlotOrDefault();
    const keyboard = target === null ? null : await this.sendProfileCommand(WOOTING_COMMAND.getKeyboardProfile, target).catch(() => null);
    const globalReply = await this.command(WOOTING_COMMAND.getSettings);
    if (!keyboard && !globalReply) return null;
    const decoded = keyboard ? decodeWootingKeyboardProfile(keyboard) : null;
    const actuationRaw = decoded?.actuationRaw ?? null;
    return {
      actuationRaw,
      actuationMm: actuationRaw === null ? null : wootingActuationMm(actuationRaw),
      profileFields: decoded?.fields ?? [],
      global: globalReply ? decodeWootingGlobalSettings(globalReply) : null,
    };
  }

  /**
   * Per-key actuation overrides (0x31). Every ARM board answers an empty OK
   * body (confirmed live), so this stays null on ARM — Standard firmware only.
   */
  async readPerKeyActuation(_slot?: number): Promise<WootingActuationProfile | null> {
    await this.open();
    return null;
  }

  /**
   * Rapid-trigger profile (0x36). Every ARM board answers an empty OK body
   * (confirmed live) — rapid-trigger state lives in the 0x27 keyboard
   * profile on ARM. Standard firmware only.
   */
  async readRapidTrigger(_slot?: number): Promise<WootingRapidTriggerProfile | null> {
    await this.open();
    return null;
  }

  /** Key mappings for one slot: generic blob (0x30) plus Fn layers (0x11/0x12). */
  async readMappings(slot?: number): Promise<WootingMappings | null> {
    await this.open();
    const target = slot ?? await this.activeSlotOrDefault();
    if (target === null) return null;
    const mappingReply = await this.sendProfileCommand(WOOTING_COMMAND.getMappingProfile, target).catch(() => null);
    const mainReply = await this.sendProfileCommand(WOOTING_COMMAND.getMainMappingProfile, target).catch(() => null);
    const functionReply = await this.sendProfileCommand(WOOTING_COMMAND.getFunctionMappingProfile, target).catch(() => null);
    if (!mappingReply && !mainReply && !functionReply) return null;
    return {
      slot: target,
      mapping: mappingReply ? decodeWootingMappingProfile(mappingReply) : null,
      main: mainReply ? decodeWootingMainMappingProfile(mainReply) : null,
      function: functionReply ? decodeWootingFunctionMappingProfile(functionReply) : null,
    };
  }

  /**
   * Dynamic-keystroke profile (0x18). Every ARM board answers an empty OK
   * body (confirmed live), so this reports null = unbound on ARM — Standard
   * firmware only.
   */
  async readDks(_slot?: number): Promise<WootingDksProfile | null> {
    await this.open();
    return null;
  }

  /** Advanced-keys-combo profile for one slot (0x34). Null when silent. */
  async readAkc(slot?: number): Promise<WootingAkcProfile | null> {
    await this.open();
    const target = slot ?? await this.activeSlotOrDefault();
    if (target === null) return null;
    const reply = await this.sendProfileCommand(WOOTING_COMMAND.getAkcProfile, target).catch(() => null);
    return reply ? decodeWootingAkcProfile(reply) : null;
  }

  /**
   * Gamepad layer: 0x29 profile rows only. 0x28 answers an empty OK body on
   * every ARM board (confirmed live), so `mapping` stays null on ARM.
   */
  async readGamepad(slot?: number): Promise<WootingGamepad | null> {
    await this.open();
    const target = slot ?? await this.activeSlotOrDefault();
    if (target === null) return null;
    const profileReply = await this.sendProfileCommand(WOOTING_COMMAND.getGamepadProfile, target).catch(() => null);
    if (!profileReply) return null;
    return {
      slot: target,
      mapping: null,
      profile: decodeWootingGamepadProfile(profileReply),
    };
  }

  /**
   * RGB blocks for one slot: core (0x32), colour pages (0x23/0x24), layer
   * (0x39). Read-only sizes/fields — no effect writes.
   */
  async readRgb(slot?: number): Promise<WootingRgb | null> {
    await this.open();
    const target = slot ?? await this.activeSlotOrDefault();
    if (target === null) return null;
    const coreReply = await this.sendProfileCommand(WOOTING_COMMAND.getRgbProfileCore, target).catch(() => null);
    const colors1Reply = await this.sendProfileCommand(WOOTING_COMMAND.getRgbProfileColors1, target).catch(() => null);
    const colors2Reply = await this.sendProfileCommand(WOOTING_COMMAND.getRgbProfileColors2, target).catch(() => null);
    const layerReply = await this.sendProfileCommand(WOOTING_COMMAND.getRgbLayer, target).catch(() => null);
    if (!coreReply && !colors1Reply && !colors2Reply && !layerReply) return null;
    return {
      slot: target,
      core: coreReply ? decodeWootingRgbProfileCore(coreReply) : null,
      colors1: colors1Reply ? decodeWootingRgbProfileColors(colors1Reply) : null,
      colors2: colors2Reply ? decodeWootingRgbProfileColors(colors2Reply) : null,
      layer: layerReply ? decodeWootingRgbLayer(layerReply) : null,
    };
  }

  /** Counts + flash health (0x10 / 0x04 / 0x0A / 0x38 / 0x3A). */
  async readDiagnostics(): Promise<WootingDiagnostics | null> {
    await this.open();
    const keysReply = await this.command(WOOTING_COMMAND.getNumberOfKeys);
    const rgbCountReply = await this.command(WOOTING_COMMAND.getRgbProfileCount);
    const analogCountReply = await this.command(WOOTING_COMMAND.getAnalogProfilesCount);
    const flashReply = await this.command(WOOTING_COMMAND.isFlashChipConnected);
    const flashStatsReply = await this.command(WOOTING_COMMAND.getFlashStats);
    if (!keysReply && !rgbCountReply && !analogCountReply && !flashReply && !flashStatsReply) return null;
    return {
      keyCount: keysReply ? decodeWootingNumberOfKeys(keysReply) : null,
      rgbProfileCount: rgbCountReply ? decodeWootingRgbProfileCount(rgbCountReply) : null,
      analogProfileCount: analogCountReply ? decodeWootingAnalogProfilesCount(analogCountReply) : null,
      flashConnected: flashReply ? decodeWootingFlashChipConnected(flashReply) : null,
      flashStats: flashStatsReply ? decodeWootingFlashStats(flashStatsReply) : null,
    };
  }

  /**
   * One-shot analog snapshot (0x14) versus the streaming `startAnalog`
   * interface. The board answers opaque profile-layout rows (all zero at
   * rest), so groups are preserved verbatim. `available` is false when the
   * board stays silent.
   */
  async readAnalogSnapshot(): Promise<WootingAnalogSnapshot> {
    await this.open();
    const reply = await this.command(WOOTING_COMMAND.getAnalogValues);
    const decoded = reply ? decodeWootingAnalogSnapshot(reply) : null;
    if (!decoded) return { available: false, keys: [] };
    return { available: true, keys: [] };
  }

  /** Active profile slot for default targeting; 0 when the board stays silent. */
  private async activeSlotOrDefault(): Promise<number | null> {
    const reply = await this.command(WOOTING_COMMAND.getCurrentKeyboardProfileIndex);
    const decoded = reply ? decodeWootingProfileIndex(reply) : null;
    if (decoded) return decoded.active;
    return 0;
  }

  /**
   * Live (uncached) read of the connected profile's actuation / rapid-trigger
   * settings: the current profile index plus the raw analog-profile "main part"
   * reply, for the analog UI to decode.
   */
  async readAnalogProfile(): Promise<{ index: number | null; reports: Uint8Array[]; note: string }> {
    const indexReply = await this.sendCommand(WOOTING_COMMAND.getCurrentKeyboardProfileIndex).catch(() => null);
    const decoded = indexReply ? decodeWootingProfileIndex(indexReply) : null;
    // get_keyboard_profile (0x39) carries the actuation (nested field 1 = mm ×
    // 20480) and rapid-trigger fields. Read it over the working channel
    // (feature, magic 0xD1, current-profile selector 0xFFFF).
    const command = new Uint8Array([
      WOOTING_MAGIC_MULTI, WOOTING_MAGIC_WORD_1, WOOTING_COMMAND.getKeyboardProfile, 0xff, 0xff, 0x00, 0x00,
    ]);
    const reports = await this.collectCommand(command, false).catch(() => []);
    const note = reports.some((report) => report.subarray(4).some((byte) => byte !== 0))
      ? "get_keyboard_profile"
      : "no body";
    return { index: decoded?.active ?? null, reports, note };
  }

  /**
   * RAM-only profile switch (wootswitch sequence, live-verified no-op-safe):
   * WootDevInit → ActivateProfile(slot) → settle 100ms → ReloadProfile(slot)
   * → settle 100ms → verify 0x0b active == slot. Returns the verified slot.
   * Throws when any step answers 0x66/timeout or the verify mismatches —
   * the caller surfaces it, never a guessed switch. Invalidates the read
   * cache after so the next readStatus re-reads the board.
   *
   * Live 60HE+ note: this board holds ONE profile (count 1), so switching to
   * slot 0 verifies clean while slot 7 acks every send yet 0x0b still reads
   * 0 — the verify throw is the correct outcome, not a driver bug. Boards
   * with 4 populated slots should move the index; that path is covered by
   * the fake (which tracks the active slot) until multi-profile hardware
   * confirms it live.
   */
  async switchProfile(slot: number): Promise<number> {
    await this.open();
    const [init, activate, reload] = encodeWootingProfileSwitch(slot);
    const initReply = await this.sendRawWrite(init);
    if (!initReply || !wootingReplyOk(initReply)) throw new Error(`WootDevInit was not accepted (slot ${slot}).`);
    const activateReply = await this.sendRawWrite(activate);
    if (!activateReply || !wootingReplyOk(activateReply)) throw new Error(`ActivateProfile was not accepted (slot ${slot}).`);
    await wootingDelay(WOOTING_PROFILE_SWITCH_SETTLE_MS);
    const reloadReply = await this.sendRawWrite(reload);
    if (!reloadReply || !wootingReplyOk(reloadReply)) throw new Error(`ReloadProfile was not accepted (slot ${slot}).`);
    await wootingDelay(WOOTING_PROFILE_SWITCH_SETTLE_MS);
    this.replies.clear();
    const verify = await this.sendCommand(WOOTING_COMMAND.getCurrentKeyboardProfileIndex).catch(() => null);
    const active = verify ? decodeWootingProfileIndex(verify)?.active ?? null : null;
    if (active !== slot) throw new Error(`Profile switch did not stick (wanted ${slot}, board reports ${active}).`);
    this.replies.clear();
    return slot;
  }

  /**
   * FLASH-persisting save (0x08/0x2A/0x2F/0x35). Requires confirmed: true —
   * without it the codec encoder throws and nothing is sent. Verifies the
   * 0x88 reply, invalidates the cache, and returns true. The caller owns the
   * blocking "overwrites onboard flash" modal.
   */
  async saveProfile(commandId: number, slot: number, confirmed: boolean): Promise<boolean> {
    await this.open();
    const buffer = encodeWootingSaveCommand(commandId, slot, { confirmed });
    const reply = await this.sendRawWrite(buffer);
    if (!reply || !wootingReplyOk(reply)) throw new Error(`Save command 0x${commandId.toString(16)} was not accepted (slot ${slot}).`);
    this.replies.clear();
    return true;
  }

  /**
   * RAM-only single-key RGB set (0x1E). Live 60HE+ answers 0x88. Returns true
   * when the board accepts; clears the cache.
   */
  async setSingleKeyColor(keyIndex: number, red: number, green: number, blue: number): Promise<boolean> {
    await this.open();
    const reply = await this.sendRawWrite(encodeWootingSingleColor(keyIndex, red, green, blue));
    if (!reply || !wootingReplyOk(reply)) throw new Error(`Single-key color was not accepted (key ${keyIndex}).`);
    this.replies.clear();
    return true;
  }

  /**
   * RAM-only RGB reset (0x1F single key / 0x20 all). Live 60HE+ answers 0x88
   * to both. Returns true when accepted; clears the cache.
   */
  async resetRgb(keyIndex?: number): Promise<boolean> {
    await this.open();
    const buffer = keyIndex === undefined
      ? encodeWootingCommand(WOOTING_COMMAND.wootDevResetAll, 0, 0, 0, 0, { multiReport: true })
      : encodeWootingProfileCommand(WOOTING_COMMAND.wootDevResetColor, keyIndex, { multiReport: true });
    const reply = await this.sendRawWrite(buffer);
    if (!reply || !wootingReplyOk(reply)) throw new Error("RGB reset was not accepted.");
    this.replies.clear();
    return true;
  }

  /**
   * RAM-only full-board RGB buffer push (SDK v3 shape, report index 5).
   * Live note: refresh (0x1D) answers 0x66 on this firmware, so a push the
   * board will not display returns applied: false (NOT success) — the UI
   * must show "board kept its profile RGB" rather than a painted preview.
   */
  async setRgbBuffer(colors: Uint8Array | readonly number[]): Promise<{ applied: boolean }> {
    await this.open();
    const buffer = encodeWootingRgbBuffer(colors);
    const reportId = buffer[0] ?? 5;
    const run = this.commandLock.then(async () => {
      try {
        await this.device.sendReport(reportId, buffer.slice(1));
      } catch {
        return { applied: false };
      }
      await wootingDelay(COLLECT_WINDOW_MS);
      return { applied: true };
    });
    this.commandLock = run.then(() => undefined, () => undefined);
    const result = await run;
    if (result.applied) this.replies.clear();
    return result;
  }

  /** Uncached single write: bypasses `replies`, serialized on commandLock. */
  private async sendRawWrite(buffer: Uint8Array): Promise<Uint8Array | null> {
    const run = this.commandLock.then(() => this.probeRawCommand(buffer));
    this.commandLock = run.then(() => undefined, () => undefined);
    return run.catch(() => null);
  }
  /**
   * Send a command and gather every input report it triggers within a short
   * window. `viaOutput` chooses Wootility's output-report channel (id 2) versus
   * the feature-report channel.
   */
  private async collectCommand(command: Uint8Array, viaOutput: boolean): Promise<Uint8Array[]> {
    const run = this.commandLock.then(async () => {
      this.collecting = [];
      try {
        if (viaOutput) {
          const report = new Uint8Array(62);
          report.set(command.subarray(0, 62));
          await this.device.sendReport(2, report);
        } else {
          await this.device.sendFeatureReport(this.featureReportId(), command.slice());
        }
      } catch (error) {
        this.collecting = null;
        throw error;
      }
      await wootingDelay(COLLECT_WINDOW_MS);
      const reports = this.collecting ?? [];
      this.collecting = null;
      return reports;
    });
    this.commandLock = run.then(() => undefined, () => undefined);
    return run;
  }

  /** Serialize command sends so overlapping callers never share the reply channel. */
  private async sendCommand(commandId: number, param0 = 0): Promise<Uint8Array | null> {
    const run = this.commandLock.then(() => this.probeCommand(commandId, param0));
    this.commandLock = run.then(() => undefined, () => undefined);
    return run;
  }

  /** Serialize a slot-taking command (profile argument placement is variant-specific). */
  private async sendProfileCommand(commandId: number, slot: number): Promise<Uint8Array | null> {
    // Slot reads are static per connection (profile names live in flash), so
    // they share the once-per-connection cache: a silent board pays its
    // timeouts once, not on every background refresh.
    const key = 0x10000 | ((commandId << 8) | (slot & 0xff));
    if (this.replies.has(key)) return this.replies.get(key) ?? null;
    const run = this.commandLock.then(() => this.probeRawCommand(encodeWootingProfileCommand(commandId, slot)));
    this.commandLock = run.then(() => undefined, () => undefined);
    const raw = await run.catch(() => null);
    this.replies.set(key, raw);
    return raw;
  }

  /**
   * Send a command on the config interface's declared feature report and read the
   * reply. ARM boards answer with the multi-report magic (0xD1), so commands go
   * out in that form. The answer arrives as an input report (matching Wooting's
   * own tooling); a feature GET is tried only as a fallback. Returns the raw
   * reply for the matching command, or null if nothing usable came back.
   */
  private async probeCommand(commandId: number, param0 = 0): Promise<Uint8Array | null> {
    // Magic + command payload, without hidapi's leading report-index byte —
    // WebHID carries the report id separately.
    return this.probeRawCommand(encodeWootingCommand(commandId, param0, 0, 0, 0, { multiReport: true }));
  }

  /** Send a pre-encoded command buffer and read its reply off both channels. */
  private async probeRawCommand(buffer: Uint8Array): Promise<Uint8Array | null> {
    const reportId = this.featureReportId();
    const body = wootingFeatureReport(buffer).data;
    // Byte 3 of the 8-byte buffer is the command id (byte 2 of the body
    // without the hidapi index byte). Replies echo it, so a stale reply to
    // an earlier command — or a keypress-shaped report that happens to
    // start with the magic word — can never resolve this command's waiter.
    const commandId = buffer[3] ?? -1;

    const inputReply = this.nextInputReport(commandId);
    inputReply.catch(() => {}); // guard: this promise may go unused

    try {
      await this.device.sendFeatureReport(reportId, body);
    } catch {
      this.clearPendingRead();
      return null;
    }

    const viaInput = await inputReply.catch(() => null);
    if (viaInput && viaInput[2] === commandId && isWootingReply(viaInput)) return viaInput;

    this.clearPendingRead();
    const viaFeature = await this.device.receiveFeatureReport(reportId)
      .then((view) => new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
      .catch(() => null);
    if (viaFeature && viaFeature[2] === commandId && isWootingReply(viaFeature)) return viaFeature;
    return null;
  }

  /** Report id of the config collection's declared feature report (0 if none). */
  private featureReportId(): number {
    const collection = WootingHidClient.configCollection(this.device.collections);
    return collection?.featureReports?.[0]?.reportId ?? 0;
  }

  /** Resolve with the next input report echoing `commandId`, or reject on timeout. */
  private nextInputReport(commandId = -1): Promise<Uint8Array> {
    const { promise, resolve, reject } = Promise.withResolvers<Uint8Array>();
    this.responseWaiter = { resolve, reject, commandId };
    this.responseTimer = setTimeout(() => {
      this.clearPendingRead();
      reject(new Error("Wooting keyboard did not answer the config request."));
    }, CONFIG_RESPONSE_TIMEOUT_MS);
    return promise;
  }

  private clearPendingRead(): void {
    if (this.responseTimer !== null) {
      clearTimeout(this.responseTimer);
      this.responseTimer = null;
    }
    this.responseWaiter = null;
  }

}

/** Serial bytes as text; falls back to hex when the payload is not printable. */
function wootingSerialText(reply: Uint8Array): string {
  const body = reply.subarray(4);
  const printable = [...body].every((byte) => byte === 0 || (byte >= 0x20 && byte < 0x7f));
  if (!printable) return [...body].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
  return String.fromCharCode(...[...body].filter((byte) => byte !== 0));
}

/** First `count` bytes of a buffer as spaced hex, with an ellipsis if truncated. */
function wootingHexPreview(bytes: Uint8Array, count: number): string {
  const shown = [...bytes.subarray(0, count)].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
  return bytes.length > count ? `${shown} …` : shown;
}
