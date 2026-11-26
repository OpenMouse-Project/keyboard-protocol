import type { KeyboardStatus } from "../keyboard-types.ts";
import {
  ATK_ADVANCED_MODE, ATK_CONFIG_USAGE, ATK_SLEEP_NEVER, ATK_CONFIG_USAGE_PAGE, ATK_REPORT_ID, ATK_VENDOR_ID,
  atkBuildClearAdvancedKey, atkBuildGetAdvancedKey, atkBuildGetDeadZone, atkBuildGetFeature, atkBuildGetFirmware,
  atkBuildGetFlag, atkBuildGetKeyLight, atkBuildGetKeymapChunk, atkBuildGetKeyRapidTrigger, atkBuildGetKeyTravel,
  atkBuildGetLightConfig, atkBuildGetProtocolVersion, atkBuildGetReportRate, atkBuildGetSleep, atkBuildGetTravelLimits,
  atkBuildGetZoneLight, atkBuildMt, atkBuildSetAdvancedKey, atkBuildSetDeadZone, atkBuildSetDks, atkBuildSetFeature,
  atkBuildSetFlag, atkBuildSetKeyLight, atkBuildSetKeyRapidTrigger, atkBuildSetKeyTravel, atkBuildSetLightConfig,
  atkBuildSetReportRate, atkBuildSetSleep, atkBuildSetZoneLight, atkBuildTgl, atkDecodeAdvancedKey, atkDecodeDeadZone,
  atkDecodeFeature, atkDecodeFirmware, atkDecodeFlag, atkDecodeKeyLight, atkDecodeKeymap, atkDecodeKeymapChunk,
  atkDecodeKeyRapidTrigger, atkDecodeKeyTravel, atkDecodeLightConfig, atkDecodeProtocolVersion, atkDecodeReportRate,
  atkDecodeSleep, atkDecodeTravelLimits, atkDecodeZoneLight, atkIsFirmwareV2, atkKeyboardProduct, atkKeymapChunks,
  atkReplyMatches,
  type AtkAdvancedKey, type AtkAdvancedKeyWrite, type AtkDeadZone, type AtkFeature, type AtkFirmwareVersion,
  type AtkFlag, type AtkLightConfig, type AtkLightZone, type AtkRapidTrigger, type AtkRgb, type AtkTravelLimits,
  type AtkZoneLight,
} from "@openmouse/keyboard-protocol/atk";

const ATTEMPTS = 3;
const REPLY_TIMEOUT_MS = 1200;

export interface AtkKeyboardState {
  productId: number;
  protocolVersion: number | null;
  travelLimits: AtkTravelLimits | null;
  deadZone: AtkDeadZone | null;
  feature: AtkFeature | null;
  gameMode: boolean | null;
  aiMatch: boolean | null;
  bottomOptimize: boolean | null;
  reportRate: number | null;
  sleepSeconds: number | null;
  light: AtkLightConfig | null;
}

export class AtkKeyboardHidClient {
  readonly device: HIDDevice;
  private queue: Promise<unknown> = Promise.resolve();
  private listening = false;
  private faulted = false;
  private firmware: AtkFirmwareVersion | null = null;
  private pending: { sent: Uint8Array; resolve: (frame: Uint8Array) => void } | null = null;

  constructor(device: HIDDevice) { this.device = device; }

  static isSupported(device: HIDDevice): boolean {
    return device.vendorId === ATK_VENDOR_ID
      && atkKeyboardProduct(device.productId) !== undefined
      && AtkKeyboardHidClient.hasConfigCollection(device.collections);
  }

  private static hasConfigCollection(collections: readonly HIDCollectionInfo[]): boolean {
    return collections.some((collection) =>
      (collection.usagePage === ATK_CONFIG_USAGE_PAGE && collection.usage === ATK_CONFIG_USAGE)
      || AtkKeyboardHidClient.hasConfigCollection(collection.children));
  }

  private get product() {
    return atkKeyboardProduct(this.device.productId);
  }

  async open(): Promise<void> {
    if (!AtkKeyboardHidClient.isSupported(this.device)) throw new Error("Not an ATK keyboard configuration interface.");
    if (this.faulted) throw new Error("This keyboard session was closed; reconnect to continue.");
    if (!this.device.opened) await this.device.open();
    if (this.faulted) {
      if (this.device.opened) await this.device.close();
      throw new Error("This keyboard session was closed; reconnect to continue.");
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
    if (event.device !== this.device || !this.pending) return;
    const frame = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    if (atkReplyMatches(this.pending.sent, frame)) this.pending.resolve(frame.slice());
  };

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async exchange(frame: Uint8Array): Promise<Uint8Array> {
    await this.open();
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const reply = new Promise<Uint8Array | null>((resolve) => {
        this.pending = { sent: frame, resolve };
        timer = setTimeout(() => resolve(null), REPLY_TIMEOUT_MS);
      });
      try {
        await this.device.sendReport(ATK_REPORT_ID, frame as BufferSource);
        const got = await reply;
        if (got) return got;
      } catch (error) {
        if (attempt === ATTEMPTS) throw error;
      } finally {
        clearTimeout(timer);
        this.pending = null;
      }
    }
    throw new Error(`The keyboard did not answer command 0x${frame[0]!.toString(16)} after ${ATTEMPTS} tries.`);
  }

  private async quietly<T>(read: () => Promise<T>): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      if (this.faulted) throw error;
      return null;
    }
  }

  private async v2(): Promise<boolean> {
    if (!this.firmware) this.firmware = atkDecodeFirmware(await this.exchange(atkBuildGetFirmware()));
    return atkIsFirmwareV2(this.firmware);
  }

  private checkKey(row: number, col: number): void {
    const product = this.product;
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) throw new RangeError("Key row and column must be non-negative integers");
    if (product?.rows != null && row >= product.rows) throw new RangeError(`Row ${row} is outside this keyboard's ${product.rows} rows`);
    if (product?.cols != null && col >= product.cols) throw new RangeError(`Column ${col} is outside this keyboard's ${product.cols} columns`);
  }

  readStatus(): Promise<KeyboardStatus> {
    return this.serialized(async () => {
      await this.open();
      const firmware = await this.quietly(async () => atkDecodeFirmware(await this.exchange(atkBuildGetFirmware())));
      this.firmware = firmware;
      const product = this.product!;
      const wireless = /2\.4G/i.test(product.name);
      const atk: AtkKeyboardState = {
        productId: this.device.productId,
        protocolVersion: await this.quietly(async () => atkDecodeProtocolVersion(await this.exchange(atkBuildGetProtocolVersion()))),
        travelLimits: await this.quietly(async () => atkDecodeTravelLimits(await this.exchange(atkBuildGetTravelLimits()))),
        deadZone: await this.quietly(async () => atkDecodeDeadZone(await this.exchange(atkBuildGetDeadZone()))),
        feature: await this.quietly(async () => atkDecodeFeature(await this.exchange(atkBuildGetFeature()))),
        gameMode: await this.quietly(async () => atkDecodeFlag(await this.exchange(atkBuildGetFlag("gameMode")))),
        aiMatch: await this.quietly(async () => atkDecodeFlag(await this.exchange(atkBuildGetFlag("aiMatch")))),
        bottomOptimize: await this.quietly(async () => atkDecodeFlag(await this.exchange(atkBuildGetFlag("bottomOptimize")))),
        reportRate: await this.quietly(async () => atkDecodeReportRate(await this.exchange(atkBuildGetReportRate()))),
        sleepSeconds: await this.quietly(async () => atkDecodeSleep(await this.exchange(atkBuildGetSleep()))),
        light: await this.quietly(async () => atkDecodeLightConfig(await this.exchange(atkBuildGetLightConfig()))),
      };
      return {
        brand: "ATK",
        name: product.name,
        connectionType: wireless ? "Wireless" : "Wired",
        connectionDetail: wireless ? "2.4 GHz receiver" : "USB",
        firmware: firmware ? [`Firmware ${firmware.text}`] : [],
        firmwareVersion: firmware?.text ?? null,
        layout: product.rows != null && product.cols != null ? `${product.rows}x${product.cols} matrix` : null,
        serial: null,
        activeProfile: null,
        profileCount: null,
        profileNames: [],
        ui: { family: "atk", defaultDisplayName: product.name },
        atk,
      };
    });
  }

  setReportRate(hz: number): Promise<number> {
    return this.serialized(async () => {
      for (const frame of atkBuildSetReportRate(hz)) await this.exchange(frame);
      const confirmed = atkDecodeReportRate(await this.exchange(atkBuildGetReportRate()));
      if (confirmed !== hz) throw new Error(`The keyboard kept ${confirmed ?? "an unknown rate"} instead of ${hz} Hz.`);
      return confirmed;
    });
  }

  setSleep(seconds: number): Promise<number> {
    return this.serialized(async () => {
      await this.exchange(atkBuildSetSleep(seconds));
      const confirmed = atkDecodeSleep(await this.exchange(atkBuildGetSleep()));
      const expected = seconds === ATK_SLEEP_NEVER ? ATK_SLEEP_NEVER : Math.round(seconds / 60) * 60;
      if (confirmed !== expected) throw new Error(`The keyboard kept ${confirmed} s instead of ${expected} s.`);
      return confirmed;
    });
  }

  setDeadZone(zone: AtkDeadZone): Promise<AtkDeadZone> {
    return this.serialized(async () => {
      await this.exchange(atkBuildSetDeadZone(zone));
      return atkDecodeDeadZone(await this.exchange(atkBuildGetDeadZone()));
    });
  }

  setFeature(change: Partial<Omit<AtkFeature, "keyMode">>): Promise<AtkFeature> {
    return this.serialized(async () => {
      const current = atkDecodeFeature(await this.exchange(atkBuildGetFeature()));
      await this.exchange(atkBuildSetFeature({ ...current, ...change }));
      return atkDecodeFeature(await this.exchange(atkBuildGetFeature()));
    });
  }

  setFlag(flag: AtkFlag, enabled: boolean): Promise<boolean> {
    return this.serialized(async () => {
      await this.exchange(atkBuildSetFlag(flag, enabled));
      const confirmed = atkDecodeFlag(await this.exchange(atkBuildGetFlag(flag)));
      if (confirmed !== enabled) throw new Error(`The keyboard kept ${flag} ${confirmed ? "on" : "off"}.`);
      return confirmed;
    });
  }

  setLightConfig(config: AtkLightConfig): Promise<AtkLightConfig> {
    return this.serialized(async () => {
      await this.exchange(atkBuildSetLightConfig(config));
      return atkDecodeLightConfig(await this.exchange(atkBuildGetLightConfig()));
    });
  }

  readZoneLight(zone: AtkLightZone): Promise<AtkZoneLight> {
    return this.serialized(async () => atkDecodeZoneLight(await this.exchange(atkBuildGetZoneLight(zone, await this.v2()))));
  }

  setZoneLight(zone: AtkLightZone, light: AtkZoneLight): Promise<AtkZoneLight> {
    return this.serialized(async () => {
      const v2 = await this.v2();
      await this.exchange(atkBuildSetZoneLight(zone, v2, light));
      return atkDecodeZoneLight(await this.exchange(atkBuildGetZoneLight(zone, v2)));
    });
  }

  readKeyLight(key: number): Promise<{ key: number; color: AtkRgb }> {
    return this.serialized(async () => atkDecodeKeyLight(await this.exchange(atkBuildGetKeyLight(key))));
  }

  setKeyLight(key: number, color: AtkRgb): Promise<{ key: number; color: AtkRgb }> {
    return this.serialized(async () => {
      await this.exchange(atkBuildSetKeyLight(key, color));
      return atkDecodeKeyLight(await this.exchange(atkBuildGetKeyLight(key)));
    });
  }

  readKeyTravel(row: number, col: number): Promise<number> {
    this.checkKey(row, col);
    return this.serialized(async () => atkDecodeKeyTravel(await this.exchange(atkBuildGetKeyTravel(row, col))));
  }

  setKeyTravel(row: number, col: number, mm: number): Promise<number> {
    this.checkKey(row, col);
    return this.serialized(async () => {
      await this.exchange(atkBuildSetKeyTravel(row, col, mm));
      return atkDecodeKeyTravel(await this.exchange(atkBuildGetKeyTravel(row, col)));
    });
  }

  readKeyRapidTrigger(row: number, col: number): Promise<AtkRapidTrigger> {
    this.checkKey(row, col);
    return this.serialized(async () => atkDecodeKeyRapidTrigger(await this.exchange(atkBuildGetKeyRapidTrigger(row, col))));
  }

  setKeyRapidTrigger(row: number, col: number, rapid: AtkRapidTrigger): Promise<AtkRapidTrigger> {
    this.checkKey(row, col);
    return this.serialized(async () => {
      await this.exchange(atkBuildSetKeyRapidTrigger(row, col, rapid));
      return atkDecodeKeyRapidTrigger(await this.exchange(atkBuildGetKeyRapidTrigger(row, col)));
    });
  }

  readAdvancedKey(index: number): Promise<AtkAdvancedKey> {
    return this.serialized(async () => atkDecodeAdvancedKey(index, await this.exchange(atkBuildGetAdvancedKey(index))));
  }

  setAdvancedKey(index: number, write: AtkAdvancedKeyWrite): Promise<AtkAdvancedKey> {
    return this.serialized(async () => {
      await this.exchange(atkBuildSetAdvancedKey(index, write));
      return atkDecodeAdvancedKey(index, await this.exchange(atkBuildGetAdvancedKey(index)));
    });
  }

  clearAdvancedKey(index: number): Promise<AtkAdvancedKey> {
    return this.serialized(async () => {
      await this.exchange(atkBuildClearAdvancedKey(index));
      const confirmed = atkDecodeAdvancedKey(index, await this.exchange(atkBuildGetAdvancedKey(index)));
      if (confirmed.mode !== ATK_ADVANCED_MODE.none) throw new Error("The keyboard kept the advanced key.");
      return confirmed;
    });
  }

  setMt(index: number, tap: number, hold: number, delayMs: number): Promise<void> {
    return this.serialized(async () => { await this.exchange(atkBuildMt(index, tap, hold, delayMs)); });
  }

  setTgl(index: number, key: number, delayMs: number): Promise<void> {
    return this.serialized(async () => { await this.exchange(atkBuildTgl(index, key, delayMs)); });
  }

  setDks(index: number, codes: readonly number[], top: number, bottom: number): Promise<void> {
    return this.serialized(async () => { await this.exchange(atkBuildSetDks(index, codes, top, bottom)); });
  }

  readKeymap(): Promise<number[]> {
    const { rows, cols } = this.product ?? {};
    if (rows == null || cols == null) return Promise.reject(new Error("This keyboard's matrix size is not catalogued."));
    return this.serialized(async () => {
      const bytes: number[] = [];
      for (const { offset, length } of atkKeymapChunks(rows, cols)) {
        bytes.push(...atkDecodeKeymapChunk(await this.exchange(atkBuildGetKeymapChunk(offset, length)), length));
      }
      return atkDecodeKeymap(bytes, rows, cols);
    });
  }
}

