import type { KeyboardStatus } from "../keyboard-types.ts";
import {
  STEELSERIES_APEX_PRO_2023_SLOTS,
  STEELSERIES_APEX_PRO_2023_PRODUCT_ID,
  STEELSERIES_CONFIG_USAGE,
  STEELSERIES_CONFIG_USAGE_PAGE,
  STEELSERIES_APEX_PRO_2023_LIGHTING_KEYS,
  STEELSERIES_FEATURE_DATA_LENGTH,
  STEELSERIES_FIRST_PROFILE_FS,
  STEELSERIES_KEYBOARD_PRODUCTS,
  STEELSERIES_PROFILE_CHUNK_LENGTH,
  STEELSERIES_PROFILE_LENGTH,
  STEELSERIES_PROFILE_OFFSET,
  STEELSERIES_VENDOR_ID,
  decodeSteelseriesFirmware,
  decodeSteelseriesProfile,
  encodeSteelseriesClearDirectLighting,
  encodeSteelseriesFileOpen,
  encodeSteelseriesFirmwarePoll,
  encodeSteelseriesHallThresholds,
  encodeSteelseriesLighting,
  encodeSteelseriesOledDirect,
  encodeSteelseriesOledDisplay,
  encodeSteelseriesOledResetDirect,
  packSteelseriesOledPixels,
  encodeSteelseriesProfileRead,
  encodeSteelseriesProfileWrite,
  encodeSteelseriesRapidTap,
  encodeSteelseriesRapidTapPairs,
  encodeSteelseriesRapidTriggerSensitivity,
  encodeSteelseriesReleaseMode,
  encodeSteelseriesValidateProfile,
  steelseriesActuationRaw,
  steelseriesSealProfile,
  type SteelSeriesApexProfile,
  type SteelSeriesReleaseMode,
  type SteelSeriesRapidTapPair,
  type SteelSeriesRgb,
} from "@openmouse/keyboard-protocol/steelseries";

const FIRMWARE_TIMEOUT_MS = 800;
const COMMAND_GAP_MS = 13;
const PROFILE_CHUNKS = STEELSERIES_PROFILE_LENGTH / STEELSERIES_PROFILE_CHUNK_LENGTH;
const FEATURE_REPORT_ID = 0;
const OUTPUT_REPORT_ID = 0;

export class SteelSeriesKeyboardHidClient {
  readonly device: HIDDevice;
  private queue: Promise<unknown> = Promise.resolve();
  private listening = false;
  private firmwareWaiter: { resolve: (data: Uint8Array) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private cachedProfile: SteelSeriesApexProfile | null = null;

  private cachedBlob: Uint8Array | null = null;
  private directLighting: Map<number, SteelSeriesRgb> | null = null;
  private get wireless2023(): boolean {
    return this.device.productId === 0x1630 || this.device.productId === 0x1632;
  }
  private lightingPacketId(): 0x40 | 0x61 {
    return this.wireless2023 ? 0x61 : 0x40;
  }
  private requireTkl2023(): void {
    if (this.device.productId !== STEELSERIES_APEX_PRO_2023_PRODUCT_ID) {
      throw new Error("This command is only documented for the wired Apex Pro TKL 0x1628.");
    }
  }

  constructor(device: HIDDevice) {
    this.device = device;
  }

  /** SteelSeries vendor id, a catalogued Apex Pro product, and the 0xFFC0 command collection. */
  static isSupported(device: HIDDevice): boolean {
    if (device.vendorId !== STEELSERIES_VENDOR_ID) return false;
    if (!STEELSERIES_KEYBOARD_PRODUCTS.has(device.productId)) return false;
    return SteelSeriesKeyboardHidClient.hasConfigCollection(device.collections);
  }

  private static hasConfigCollection(collections: readonly HIDCollectionInfo[]): boolean {
    for (const collection of collections) {
      if (collection.usagePage === STEELSERIES_CONFIG_USAGE_PAGE && collection.usage === STEELSERIES_CONFIG_USAGE) return true;
      if (SteelSeriesKeyboardHidClient.hasConfigCollection(collection.children)) return true;
    }
    return false;
  }

  private static delay(ms: number): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, ms);
    return promise;
  }

  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    const waiter = this.firmwareWaiter;
    if (!waiter) return;
    const data = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    if ((data[0] ?? 0) !== 0x90) return;
    this.firmwareWaiter = null;
    clearTimeout(waiter.timer);
    waiter.resolve(data);
  };

  async open(): Promise<void> {
    if (!SteelSeriesKeyboardHidClient.isSupported(this.device)) throw new Error("Not a supported SteelSeries Apex Pro control interface.");
    if (!this.device.opened) await this.device.open();
    if (!this.listening) {
      this.device.addEventListener("inputreport", this.onInputReport);
      this.listening = true;
    }
  }

  async close(): Promise<void> {
    this.directLighting = null;
    this.firmwareWaiter?.resolve(new Uint8Array());
    this.firmwareWaiter = null;
    if (this.listening) this.device.removeEventListener("inputreport", this.onInputReport);
    this.listening = false;
    if (this.device.opened) await this.device.close();
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Send one 644-byte feature payload and return the 644-byte feature reply. */
  private async featureExchange(payload: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
    await this.open();
    await this.device.sendFeatureReport(FEATURE_REPORT_ID, payload);
    const reply = await this.device.receiveFeatureReport(FEATURE_REPORT_ID);
    const data = new Uint8Array(reply.buffer, reply.byteOffset, reply.byteLength);
    if (data.length < STEELSERIES_FEATURE_DATA_LENGTH) throw new Error("The SteelSeries keyboard returned a short feature reply.");
    return data;
  }

  private async readFirmware(): Promise<string | null> {
    await this.open();
    const request = encodeSteelseriesFirmwarePoll(0);
    const { promise: reply, resolve, reject } = Promise.withResolvers<Uint8Array>();
    const timer = setTimeout(() => {
      this.firmwareWaiter = null;
      reject(new Error("The SteelSeries keyboard did not answer the firmware poll."));
    }, FIRMWARE_TIMEOUT_MS);
    this.firmwareWaiter = { resolve, timer };
    try {
      await this.device.sendReport(OUTPUT_REPORT_ID, request);
      return decodeSteelseriesFirmware(await reply);
    } catch (error) {
      clearTimeout(timer);
      this.firmwareWaiter = null;
      throw error;
    } finally {
      clearTimeout(timer);
      this.firmwareWaiter = null;
    }
  }

  private async readProfileBlob(slot: number): Promise<Uint8Array> {
    if (this.wireless2023) throw new Error("The 2023 wireless on-board profile format is not documented for this driver.");
    await this.open();
    const fsId = STEELSERIES_FIRST_PROFILE_FS + slot;
    const chunks: Uint8Array[] = [];
    for (let index = 0; index < PROFILE_CHUNKS; index += 1) {
      const offset = index * STEELSERIES_PROFILE_CHUNK_LENGTH;
      const request = encodeSteelseriesProfileRead(fsId, STEELSERIES_PROFILE_CHUNK_LENGTH, offset);
      const reply = await this.featureExchange(request);
      chunks.push(reply.slice(3, 3 + STEELSERIES_PROFILE_CHUNK_LENGTH));
      if (index + 1 < PROFILE_CHUNKS) await SteelSeriesKeyboardHidClient.delay(COMMAND_GAP_MS);
    }
    const blob = new Uint8Array(STEELSERIES_PROFILE_LENGTH);
    chunks.forEach((chunk, index) => blob.set(chunk, index * STEELSERIES_PROFILE_CHUNK_LENGTH));
    return blob;
  }

  private async readProfile(slot: number): Promise<SteelSeriesApexProfile> {
    const blob = await this.readProfileBlob(slot);
    const profile = decodeSteelseriesProfile(blob, slot);
    if (!profile) throw new Error("The SteelSeries keyboard returned an unreadable on-board profile.");
    if (!profile.checksumValid) throw new Error("The SteelSeries on-board profile checksum did not match.");
    this.cachedBlob = blob;
    this.cachedProfile = profile;
    return profile;
  }

  async readAnalogProfile(slot = 0): Promise<SteelSeriesApexProfile> {
    return this.serialized(() => this.readProfile(slot));
  }

  private async writeProfileBlob(slot: number, blob: Uint8Array): Promise<void> {
    if (this.wireless2023) throw new Error("The 2023 wireless on-board profile format is not documented for this driver.");
    await this.open();
    const fsId = STEELSERIES_FIRST_PROFILE_FS + slot;
    await this.device.sendReport(OUTPUT_REPORT_ID, encodeSteelseriesFileOpen(fsId));
    await SteelSeriesKeyboardHidClient.delay(COMMAND_GAP_MS);
    for (let offset = 0; offset < blob.length; offset += STEELSERIES_PROFILE_CHUNK_LENGTH) {
      const data = blob.slice(offset, offset + STEELSERIES_PROFILE_CHUNK_LENGTH);
      await this.device.sendFeatureReport(FEATURE_REPORT_ID, encodeSteelseriesProfileWrite(fsId, offset, data));
      if (offset + STEELSERIES_PROFILE_CHUNK_LENGTH < blob.length) {
        await SteelSeriesKeyboardHidClient.delay(COMMAND_GAP_MS);
      }
    }
    await this.device.sendReport(OUTPUT_REPORT_ID, encodeSteelseriesValidateProfile(slot));
    await SteelSeriesKeyboardHidClient.delay(50);
  }

  /** Build the on-board blob from the live view, write all 25 chunks, and verify the read-back. */
  private async persistProfile(slot: number, profile: SteelSeriesApexProfile, source: Uint8Array): Promise<SteelSeriesApexProfile> {
    const blob = new Uint8Array(source);
    for (const key of profile.keys) {
      const index = STEELSERIES_APEX_PRO_2023_SLOTS.indexOf(key.usage);
      if (index < 0) continue;
      blob[STEELSERIES_PROFILE_OFFSET.actuation + index] = key.actuation;
      blob[STEELSERIES_PROFILE_OFFSET.reset + index] = key.reset;
      blob[STEELSERIES_PROFILE_OFFSET.releaseMode + index] = key.releaseMode;
      blob[STEELSERIES_PROFILE_OFFSET.rapidTriggerSensitivity + index] = key.rapidTriggerSensitivity;
    }
    if (profile.secondActuation) {
      profile.secondActuation.forEach(([h, l], index) => {
        blob[STEELSERIES_PROFILE_OFFSET.secondActuation + index] = h;
        blob[STEELSERIES_PROFILE_OFFSET.secondReset + index] = l;
      });
    }
    if (profile.deviceSchema === 8 && profile.rapidTapPairs) {
      profile.rapidTapPairs.forEach((pair, index) => {
        const offset = STEELSERIES_PROFILE_OFFSET.rapidTapPairs + index * 5;
        blob[offset] = pair.hid1;
        blob[offset + 1] = pair.hid2;
        blob[offset + 2] = pair.mode | (pair.reportBothKeys ? 0x80 : 0);
      });
    }
    if (profile.oled) {
      const offset = profile.deviceSchema < 6 ? 1866 : STEELSERIES_PROFILE_OFFSET.oled;
      blob.set(profile.oled, offset);
    }
    if (profile.deviceSchema === 8 && profile.rapidTapEnabled !== null) {
      blob[STEELSERIES_PROFILE_OFFSET.rapidTapEnabled] = profile.rapidTapEnabled ? 1 : 0;
    }
    steelseriesSealProfile(blob);
    await this.writeProfileBlob(slot, blob);
    const readBack = await this.readProfileBlob(slot);
    if (readBack.length !== blob.length || readBack.some((byte, index) => byte !== blob[index])) {
      throw new Error("The SteelSeries keyboard did not retain the on-board profile write.");
    }
    const decoded = decodeSteelseriesProfile(readBack, slot);
    if (!decoded || !decoded.checksumValid) throw new Error("The SteelSeries on-board profile did not validate after writing.");
    this.cachedBlob = readBack;
    this.cachedProfile = decoded;
    return decoded;
  }

  /** Update keys in the current direct-lighting frame, or provide all 84 keys initially. */
  async setLighting(colors: ReadonlyMap<number, SteelSeriesRgb>): Promise<void> {
    return this.serialized(async () => {
      const next = new Map(this.directLighting ?? []);
      for (const [usage, color] of colors) {
        if (!STEELSERIES_APEX_PRO_2023_LIGHTING_KEYS.includes(usage)) {
          throw new RangeError(`SteelSeries key ${usage} has no direct-lighting zone.`);
        }
        next.set(usage, color);
      }
      if (next.size !== STEELSERIES_APEX_PRO_2023_LIGHTING_KEYS.length) {
        throw new Error("A complete 84-key lighting frame is required before partial updates can preserve other colours.");
      }
      const frame = encodeSteelseriesLighting(next, this.lightingPacketId());
      await this.open();
      await this.device.sendFeatureReport(FEATURE_REPORT_ID, frame);
      this.directLighting = next;
    });
  }

  /** Paint every key one colour. */
  async setSolidLighting(red: number, green: number, blue: number): Promise<void> {
    return this.serialized(async () => {
      await this.open();
      const color = [red, green, blue] as const;
      const colors = new Map<number, SteelSeriesRgb>();
      for (const usage of STEELSERIES_APEX_PRO_2023_LIGHTING_KEYS) colors.set(usage, color);
      await this.device.sendFeatureReport(FEATURE_REPORT_ID, encodeSteelseriesLighting(colors, this.lightingPacketId()));
      this.directLighting = colors;
    });
  }

  /** Hand lighting back to the active on-board profile. */
  async clearLighting(): Promise<void> {
    return this.serialized(async () => {
      if (this.wireless2023) throw new Error("The 2023 wireless direct-lighting release command is not documented for this driver.");
      await this.open();
      await this.device.sendReport(OUTPUT_REPORT_ID, encodeSteelseriesClearDirectLighting());
      this.directLighting = null;
    });
  }

  /** Persist every live value in the cached profile to its own on-board slot. */
  async saveProfile(slot?: number): Promise<SteelSeriesApexProfile> {
    return this.serialized(async () => {
      const profile = await this.currentProfile();
      const target = slot ?? profile.slot;
      if (target !== profile.slot) throw new Error("saveProfile refuses a cross-slot overwrite: the cached profile was read from a different slot.");
      const source = this.cachedBlob ?? await this.readProfileBlob(profile.slot);
      return this.persistProfile(target, profile, source);
    });
  }

  private async currentProfile(): Promise<SteelSeriesApexProfile> {
    return this.cachedProfile ?? this.readProfile(0);
  }

  /** Replace the 68-key hall-threshold table for the primary layer. */
  async setActuation(usages: readonly number[], tenthsMm: number): Promise<SteelSeriesApexProfile> {
    return this.serialized(async () => {
      const raw = steelseriesActuationRaw(tenthsMm);
      if (!raw) throw new RangeError("Actuation must be a whole number of tenths from 0.1 to 4.0 mm.");
      const profile = await this.currentProfile();
      const targets = new Set(usages);
      for (const usage of targets) {
        if (!STEELSERIES_APEX_PRO_2023_SLOTS.includes(usage)) throw new RangeError(`HID usage 0x${usage.toString(16)} has no analog switch.`);
      }
      const keys = [...profile.keys]
        .sort((left, right) => left.usage - right.usage)
        .map((key) => targets.has(key.usage)
          ? [key.usage, raw[0], raw[1]] as const
          : [key.usage, key.actuation, key.reset] as const);
      await this.featureExchange(encodeSteelseriesHallThresholds(0x00, keys));
      const updated: SteelSeriesApexProfile = {
        ...profile,
        live: true,
        keys: profile.keys.map((key) => targets.has(key.usage)
          ? { ...key, actuation: raw[0], reset: raw[1], tenthsMm }
          : key),
      };
      this.cachedProfile = updated;
      return updated;
    });
  }

  /** Change secondary-layer actuation, preserving the other 67 keys. 0x1628 only. */
  async setSecondActuation(usages: readonly number[], tenthsMm: number): Promise<SteelSeriesApexProfile> {
    return this.serialized(async () => {
      this.requireTkl2023();
      const raw = steelseriesActuationRaw(tenthsMm);
      if (!raw) throw new RangeError("Actuation must be a whole number of tenths from 0.1 to 4.0 mm.");
      const profile = await this.currentProfile();
      if (!profile.secondActuation) throw new Error("The profile has no recognised secondary actuation layer.");
      const targets = new Set(usages);
      for (const usage of targets) {
        if (!STEELSERIES_APEX_PRO_2023_SLOTS.includes(usage)) throw new RangeError(`HID usage 0x${usage.toString(16)} has no analog switch.`);
      }
      const values = profile.secondActuation.map(([h, l], index) => targets.has(STEELSERIES_APEX_PRO_2023_SLOTS[index]!)
        ? raw : [h, l] as const);
      const keys = STEELSERIES_APEX_PRO_2023_SLOTS.map((usage, index) =>
        [usage, values[index]![0], values[index]![1]] as const).sort((a, b) => a[0] - b[0]);
      await this.featureExchange(encodeSteelseriesHallThresholds(0x02, keys));
      const updated = { ...profile, live: true, secondActuation: values };
      this.cachedProfile = updated;
      return updated;
    });
  }

  /** Replace the release-mode table (0 off, 2 Rapid Trigger, 3 Key Guard, 4). */
  async setReleaseMode(usages: readonly number[], mode: SteelSeriesReleaseMode): Promise<SteelSeriesApexProfile> {
    return this.serialized(async () => {
      const profile = await this.currentProfile();
      const targets = new Set(usages);
      for (const usage of targets) {
        if (!STEELSERIES_APEX_PRO_2023_SLOTS.includes(usage)) throw new RangeError(`HID usage 0x${usage.toString(16)} has no analog switch.`);
      }
      const keys = [...profile.keys]
        .sort((left, right) => left.usage - right.usage)
        .map((key) => [key.usage, targets.has(key.usage) ? mode : key.releaseMode] as const);
      await this.featureExchange(encodeSteelseriesReleaseMode(keys));
      const updated: SteelSeriesApexProfile = {
        ...profile,
        live: true,
        keys: profile.keys.map((key) => targets.has(key.usage) ? { ...key, releaseMode: mode } : key),
      };
      this.cachedProfile = updated;
      return updated;
    });
  }

  /** Replace the rapid-trigger sensitivity table. The raw unit is the firmware's, not millimetres. */
  async setRapidTriggerSensitivity(usages: readonly number[], sensitivity: number): Promise<SteelSeriesApexProfile> {
    return this.serialized(async () => {
      if (!Number.isInteger(sensitivity) || sensitivity < 0 || sensitivity > 255) throw new RangeError("Sensitivity must be a whole number from 0 to 255.");
      const profile = await this.currentProfile();
      const targets = new Set(usages);
      for (const usage of targets) {
        if (!STEELSERIES_APEX_PRO_2023_SLOTS.includes(usage)) throw new RangeError(`HID usage 0x${usage.toString(16)} has no analog switch.`);
      }
      const keys = [...profile.keys]
        .sort((left, right) => left.usage - right.usage)
        .map((key) => [key.usage, targets.has(key.usage) ? sensitivity : key.rapidTriggerSensitivity] as const);
      await this.featureExchange(encodeSteelseriesRapidTriggerSensitivity(keys));
      const updated: SteelSeriesApexProfile = {
        ...profile,
        live: true,
        keys: profile.keys.map((key) => targets.has(key.usage) ? { ...key, rapidTriggerSensitivity: sensitivity } : key),
      };
      this.cachedProfile = updated;
      return updated;
    });
  }

  async setRapidTap(enabled: boolean): Promise<boolean> {
    return this.serialized(async () => {
      if (this.wireless2023) throw new Error("The 2023 wireless Rapid Tap command is not documented for this driver.");
      await this.open();
      await this.device.sendReport(OUTPUT_REPORT_ID, encodeSteelseriesRapidTap(enabled));
      if (this.cachedProfile) this.cachedProfile = { ...this.cachedProfile, live: true, rapidTapEnabled: enabled };
      return enabled;
    });
  }

  /** Send all ten indexed Rapid Tap slots; pass empty entries as `{ hid1: 0, hid2: 0, mode: 0, reportBothKeys: false }`. */
  async setRapidTapPairs(pairs: readonly SteelSeriesRapidTapPair[]): Promise<SteelSeriesApexProfile> {
    return this.serialized(async () => {
      this.requireTkl2023();
      const frame = encodeSteelseriesRapidTapPairs(pairs);
      const profile = await this.currentProfile();
      if (profile.deviceSchema !== 8 || !profile.rapidTapPairs) throw new Error("Rapid Tap pairs require device profile schema 8.");
      await this.open();
      await this.device.sendReport(OUTPUT_REPORT_ID, frame);
      const updated = { ...profile, live: true, rapidTapPairs: pairs.map((pair) => ({ ...pair })) };
      this.cachedProfile = updated;
      return updated;
    });
  }

  /** Change the active profile's 640-byte OLED image. Saving the profile persists it. */
  async setOledDisplay(bitmap: Uint8Array): Promise<SteelSeriesApexProfile> {
    return this.serialized(async () => {
      this.requireTkl2023();
      const frame = encodeSteelseriesOledDisplay(bitmap);
      const profile = await this.currentProfile();
      if (!profile.oled) throw new Error("The profile has no recognised OLED layout.");
      await this.open();
      await this.device.sendFeatureReport(FEATURE_REPORT_ID, frame);
      const updated = { ...profile, live: true, oled: new Uint8Array(bitmap) };
      this.cachedProfile = updated;
      return updated;
    });
  }

  /** Temporary GameSense image; does not modify the cached on-board profile. */
  async setOledDirect(bitmap: Uint8Array): Promise<void> {
    return this.serialized(async () => {
      this.requireTkl2023();
      const frame = encodeSteelseriesOledDirect(bitmap);
      await this.open();
      await this.device.sendFeatureReport(FEATURE_REPORT_ID, frame);
    });
  }

  /** Render a 128×40 monochrome pixel array to the temporary OLED override. */
  async setOledDirectPixels(pixels: Uint8Array): Promise<void> {
    return this.setOledDirect(packSteelseriesOledPixels(pixels));
  }

  /** Return OLED ownership to the on-board profile. */
  async clearOledDirect(): Promise<void> {
    return this.serialized(async () => {
      this.requireTkl2023();
      await this.open();
      await this.device.sendReport(OUTPUT_REPORT_ID, encodeSteelseriesOledResetDirect());
    });
  }

  readStatus(): Promise<KeyboardStatus> {
    return this.serialized(async () => {
      await this.open();
      const firmwareVersion = await this.readFirmware().catch(() => null);
      const profile = this.wireless2023 ? null : this.cachedProfile?.live
        ? this.cachedProfile
        : await this.readProfile(0).catch(() => null);
      const product = STEELSERIES_KEYBOARD_PRODUCTS.get(this.device.productId)!;
      const lines: string[] = [];
      if (firmwareVersion) lines.push(`Firmware: ${firmwareVersion}`);
      if (profile) {
        lines.push(`Profile 1: ${profile.keys.length} analog keys`);
        lines.push(`Checksum: ${profile.checksumValid ? "valid" : "mismatch"}`);
      }
      return {
        brand: "SteelSeries",
        name: product.name,
        ui: {
          family: "steelseries",
          settingsReady: false,
          defaultDisplayName: product.name,
          statusNote: product.verified ? undefined : "Apex Pro analog frames are derived from SteelSeries GG's shipped device descriptions and a public GG capture; this model has not been tested through OpenMouse.",
        },
        connectionType: "Wired",
        connectionDetail: "USB",
        firmware: lines,
        firmwareVersion,
        layout: null,
        serial: null,
        activeProfile: null,
        profileCount: product.profileSlots,
        profileNames: [],
        steelseries: { productId: this.device.productId, profile, verified: product.verified },
      };
    });
  }
}
