export * from "./controls.js";
/**
 * Logitech HID++ 2.0 keyboard codec.
 *
 * Frame layout, feature ids and the feature functions below come from
 * Logitech's public HID++ 2.0 documentation and the OpenLogi reference pages
 * for `0x0000`, `0x0003`, `0x1004`, `0x8040`, `0x8060` and `0x8061`. The
 * keyboard product ids are the keyboard rows in G HUB's shipped device catalog.
 *
 * The driver lives in `../drivers/logitech/hid.ts`; this module does not touch
 * WebHID.
 */

export const LOGITECH_VENDOR_ID = 0x046d;
export const LOGITECH_HIDPP_USAGE_PAGE = 0xff00;
export const LOGITECH_HIDPP_BLUETOOTH_USAGE_PAGE = 0xff43;
export const LOGITECH_SHORT_REPORT_ID = 0x10;
export const LOGITECH_LONG_REPORT_ID = 0x11;
export const LOGITECH_SHORT_DATA_LENGTH = 6;
export const LOGITECH_LONG_DATA_LENGTH = 19;
export const LOGITECH_SOFTWARE_ID = 0x05;
export const LOGITECH_DIRECT_DEVICE_INDEX = 0xff;

export const LOGITECH_FEATURE = {
  root: 0x0000,
  featureSet: 0x0001,
  deviceInformation: 0x0003,
  deviceName: 0x0005,
  unifiedBattery: 0x1004,
  reprogControls: 0x1b04,
  analogKeys: 0x1b08,
  brightnessControl: 0x8040,
  colorLedEffects: 0x8070,
  rgbEffects: 0x8071,
  perKeyLightingV2: 0x8081,
  reportRate: 0x8060,
  extendedReportRate: 0x8061,
} as const;

export const LOGITECH_HIDPP_ERRORS: Readonly<Record<number, string>> = {
  0x01: "unknown request",
  0x02: "invalid argument",
  0x03: "value out of range",
  0x04: "hardware error",
  0x05: "Logitech internal error",
  0x06: "invalid feature index",
  0x07: "invalid function",
  0x08: "device busy",
  0x09: "unsupported",
};

export interface LogitechKeyboardProduct {
  name: string;
  wireless: boolean;
  /** False until the model is exercised through this package on hardware. */
  verified: boolean;
}

/**
 * Keyboard product ids from G HUB's device catalog. Bluetooth (`b3xx`) and
 * regional (`40xx`) SKUs share the name with their wired (`c3xx`) sibling.
 */
export const LOGITECH_KEYBOARD_PRODUCTS: ReadonlyMap<number, LogitechKeyboardProduct> = new Map([
  [0xc351, { name: "PRO X 60", wireless: true, verified: false }],
  [0xb37b, { name: "PRO X 60", wireless: true, verified: false }],
  [0x40af, { name: "PRO X 60", wireless: true, verified: false }],
  [0xc352, { name: "PRO X TKL", wireless: true, verified: false }],
  [0xb382, { name: "PRO X TKL", wireless: true, verified: false }],
  [0x40b0, { name: "PRO X TKL", wireless: true, verified: false }],
  [0xc366, { name: "G316", wireless: false, verified: false }],
  [0xc361, { name: "G316 X", wireless: false, verified: false }],
  [0xc355, { name: "G515 LIGHTSPEED TKL", wireless: true, verified: false }],
  [0xb389, { name: "G515 LIGHTSPEED TKL", wireless: true, verified: false }],
  [0x40b4, { name: "G515 LIGHTSPEED TKL", wireless: true, verified: false }],
  [0xc358, { name: "G515 TKL", wireless: false, verified: false }],
  [0xc35a, { name: "G517 LIGHTSPEED TKL", wireless: true, verified: false }],
  [0xb390, { name: "G517 LIGHTSPEED TKL", wireless: true, verified: false }],
  [0x40b9, { name: "G517 LIGHTSPEED TKL", wireless: true, verified: false }],
  [0xc348, { name: "G713", wireless: false, verified: false }],
  [0xc347, { name: "G715", wireless: true, verified: false }],
  [0xb368, { name: "G715", wireless: true, verified: false }],
  [0x40a2, { name: "G715", wireless: true, verified: false }],
  [0xc359, { name: "G915 X", wireless: true, verified: false }],
  [0xc356, { name: "G915 X LIGHTSPEED", wireless: true, verified: false }],
  [0xb38a, { name: "G915 X LIGHTSPEED", wireless: true, verified: false }],
  [0x40b5, { name: "G915 X LIGHTSPEED", wireless: true, verified: false }],
  [0xc357, { name: "G915 X LIGHTSPEED TKL", wireless: true, verified: false }],
  [0xb38b, { name: "G915 X LIGHTSPEED TKL", wireless: true, verified: false }],
  [0x40b6, { name: "G915 X LIGHTSPEED TKL", wireless: true, verified: false }],
]);

export const LOGITECH_KEYBOARD_PRODUCT_IDS: readonly number[] = [...LOGITECH_KEYBOARD_PRODUCTS.keys()];


/**
 * Logitech receivers that forward HID++ to a paired keyboard. A receiver has
 * no keyboard product id of its own; the driver probes its pairing slots and
 * matches the reported model ids against `LOGITECH_KEYBOARD_PRODUCTS`.
 */
export const LOGITECH_RECEIVER_PRODUCTS: ReadonlyMap<number, string> = new Map([
  [0xc52b, "Unifying receiver"],
  [0xc532, "Unifying receiver"],
  [0xc539, "LIGHTSPEED receiver"],
  [0xc53a, "LIGHTSPEED receiver"],
  [0xc53d, "LIGHTSPEED receiver"],
  [0xc53f, "LIGHTSPEED receiver"],
  [0xc541, "LIGHTSPEED receiver"],
  [0xc543, "LIGHTSPEED receiver"],
  [0xc545, "LIGHTSPEED receiver"],
  [0xc547, "LIGHTSPEED receiver"],
  [0xc548, "Logi Bolt receiver"],
  [0xc54d, "LIGHTSPEED receiver"],
]);

export const LOGITECH_RECEIVER_PRODUCT_IDS: readonly number[] = [...LOGITECH_RECEIVER_PRODUCTS.keys()];

/** HID++ 2.0 parameters are at most 16 bytes in a long report. */
export const LOGITECH_MAX_PARAMS = 16;

/** Build the report body (without the WebHID report id) for one request. */
export function encodeLogitechRequest(
  deviceIndex: number,
  featureIndex: number,
  functionId: number,
  params: readonly number[],
  long: boolean,
): { reportId: number; data: Uint8Array<ArrayBuffer> } {
  const length = long ? LOGITECH_LONG_DATA_LENGTH : LOGITECH_SHORT_DATA_LENGTH;
  const maxParams = long ? LOGITECH_MAX_PARAMS : 3;
  if (!Number.isInteger(functionId) || functionId < 0 || functionId > 0x0f) throw new RangeError("HID++ function id is a nibble from 0 to 15.");
  if (params.length > maxParams) throw new RangeError(`HID++ ${long ? "long" : "short"} request carries at most ${maxParams} parameters.`);
  const data = new Uint8Array(length);
  data[0] = deviceIndex;
  data[1] = featureIndex;
  data[2] = (functionId << 4) | LOGITECH_SOFTWARE_ID;
  data.set(params, 3);
  return { reportId: long ? LOGITECH_LONG_REPORT_ID : LOGITECH_SHORT_REPORT_ID, data };
}

export interface LogitechResponse {
  deviceIndex: number;
  featureIndex: number;
  functionId: number;
  params: Uint8Array;
  /** Feature index `0xff` marks a HID++ error response. */
  errorCode: number | null;
}

/** Decode an input report body. Returns `null` for an unrelated report id. */
export function decodeLogitechResponse(reportId: number, data: Uint8Array): LogitechResponse | null {
  if (reportId !== LOGITECH_SHORT_REPORT_ID && reportId !== LOGITECH_LONG_REPORT_ID) return null;
  if (data.length < LOGITECH_SHORT_DATA_LENGTH) return null;
  const featureIndex = data[1] ?? 0;
  const functionId = ((data[2] ?? 0) >> 4) & 0x0f;
  if (featureIndex === 0xff) {
    return { deviceIndex: data[0] ?? 0, featureIndex, functionId, params: data.slice(3), errorCode: data[3] ?? 0 };
  }
  return { deviceIndex: data[0] ?? 0, featureIndex, functionId, params: data.slice(3), errorCode: null };
}

export interface LogitechFeatureInfo {
  index: number;
  type: number;
  version: number;
}

/** Root `getFeature` reply: `[index, type, version]`. */
export function decodeLogitechFeatureInfo(params: Uint8Array): LogitechFeatureInfo | null {
  const index = params[0] ?? 0;
  if (index === 0) return null;
  return { index, type: params[1] ?? 0, version: params[2] ?? 0 };
}

export interface LogitechDeviceInformation {
  entityCount: number;
  unitId: string;
  transport: readonly string[];
  modelIds: readonly number[];
  extendedModelId: number;
  serialNumber: boolean;
}

/** DeviceInformation `getDeviceInfo` reply. */
export function decodeLogitechDeviceInformation(params: Uint8Array): LogitechDeviceInformation | null {
  if (params.length < 15) return null;
  const unitId = [...params.slice(1, 5)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const transportBits = params[6] ?? 0;
  const transport = [
    transportBits & 0x08 ? "USB" : null,
    transportBits & 0x04 ? "eQuad" : null,
    transportBits & 0x02 ? "BTLE" : null,
    transportBits & 0x01 ? "Bluetooth" : null,
  ].filter((entry): entry is string => entry !== null);
  const modelIds: number[] = [];
  for (let offset = 7; offset <= 11; offset += 2) {
    const id = ((params[offset] ?? 0) << 8) | (params[offset + 1] ?? 0);
    if (id !== 0) modelIds.push(id);
  }
  return {
    entityCount: params[0] ?? 0,
    unitId,
    transport,
    modelIds,
    extendedModelId: params[13] ?? 0,
    serialNumber: ((params[14] ?? 0) & 0x01) !== 0,
  };
}

/** Decode the packed four-digit version/build fields from `getFwInfo`. */
function decodeBcd(value: number): number {
  const hex = value.toString(16).padStart(4, "0");
  if (!/^\d{4}$/.test(hex)) return Math.min(value, 9999);
  return Number(hex);
}

export interface LogitechFirmwareInfo {
  entityType: number;
  prefix: string;
  version: string;
  build: number;
  active: boolean;
}

/** DeviceInformation `getFwInfo` reply. */
export function decodeLogitechFirmwareInfo(params: Uint8Array): LogitechFirmwareInfo | null {
  if (params.length < 9) return null;
  const version = decodeBcd(((params[4] ?? 0) << 8) | (params[5] ?? 0));
  const build = decodeBcd(((params[6] ?? 0) << 8) | (params[7] ?? 0));
  const prefixBytes = params.slice(1, 4);
  const end = prefixBytes.indexOf(0);
  return {
    entityType: params[0] ?? 0,
    prefix: new TextDecoder().decode(end < 0 ? prefixBytes : prefixBytes.slice(0, end)),
    version: `${Math.floor(version / 100)}.${(version % 100).toString().padStart(2, "0")}`,
    build,
    active: ((params[8] ?? 0) & 0x01) !== 0,
  };
}

export interface LogitechBattery {
  percent: number | null;
  level: "critical" | "low" | "good" | "full" | null;
  status: "discharging" | "charging" | "charging-nearly-full" | "full" | "charging-slow" | "invalid" | "thermal-error" | "charging-error" | null;
}

const BATTERY_LEVELS: Readonly<Record<number, NonNullable<LogitechBattery["level"]>>> = {
  1: "critical",
  2: "low",
  4: "good",
  8: "full",
};
const BATTERY_STATUSES: Readonly<Record<number, NonNullable<LogitechBattery["status"]>>> = {
  0: "discharging",
  1: "charging",
  2: "charging-nearly-full",
  3: "full",
  4: "charging-slow",
  5: "invalid",
  6: "thermal-error",
  7: "charging-error",
};

/** UnifiedBattery `getBatteryInfo` reply, plus whether a percentage gauge exists. */
export function decodeLogitechBattery(params: Uint8Array, hasGauge: boolean): LogitechBattery {
  return {
    percent: hasGauge ? params[0] ?? null : null,
    level: BATTERY_LEVELS[params[1] ?? 0] ?? null,
    status: BATTERY_STATUSES[params[2] ?? 0] ?? null,
  };
}

/** Extended report-rate bit mask in reply byte 1, bits 0..6. */
export function decodeLogitechReportRates(params: Uint8Array): number[] {
  const mask = params[1] ?? 0;
  const rates = [125, 250, 500, 1000, 2000, 4000, 8000];
  return rates.filter((_, index) => (mask & (1 << index)) !== 0);
}

/** Extended report-rate discriminant (0 = 125 Hz .. 6 = 8000 Hz). */
export function decodeLogitechReportRate(params: Uint8Array): number | null {
  const code = params[0] ?? 0xff;
  return code < 7 ? 125 * 2 ** code : null;
}

/** Inverse of `decodeLogitechReportRate`; `null` for an unrepresentable rate. */
export function encodeLogitechReportRate(hz: number): number | null {
  const code = Math.log2(hz / 125);
  return Number.isInteger(code) && code >= 0 && code <= 6 ? code : null;
}

export interface LogitechBrightnessInfo {
  value: number;
  min: number;
  max: number;
  /** Number of advertised brightness steps, not the size of one step. */
  steps: number;
  illumination: boolean;
}

/** BrightnessControl `getInfo` + `getBrightness` replies. */
export function decodeLogitechBrightnessInfo(params: Uint8Array): Omit<LogitechBrightnessInfo, "value"> | null {
  if (params.length < 7) return null;
  const max = ((params[0] ?? 0) << 8) | (params[1] ?? 0);
  const steps = ((params[6] ?? 0) << 8) | (params[2] ?? 0);
  const capabilities = params[3] ?? 0;
  const min = ((params[4] ?? 0) << 8) | (params[5] ?? 0);
  return { min, max, steps, illumination: (capabilities & 0x04) !== 0 };
}

/** BrightnessControl `getBrightness` reply. */
export function decodeLogitechBrightness(params: Uint8Array): number | null {
  if (params.length < 2) return null;
  return ((params[0] ?? 0) << 8) | (params[1] ?? 0);
}


/** Decode one 0x8081 presence page (14 bytes after the two prefix bytes). */
export function decodeLogitechZonePresence(params: Uint8Array, page: number): number[] {
  const zones: number[] = [];
  for (let byte = 0; byte < 14; byte += 1) {
    const value = params[2 + byte] ?? 0;
    for (let bit = 0; bit < 8; bit += 1) {
      if ((value & (1 << bit)) === 0) continue;
      const zone = page * 112 + byte * 8 + bit;
      if (zone <= 0xff) zones.push(zone);
    }
  }
  return zones;
}

export interface LogitechAnalogState {
  /** Global rapid-trigger switch (0x1B08 function 1/2). */
  rapidTrigger: boolean | null;
  /** Global key-priority / Snap Tap switch (0x1B08 function 4/5). */
  keyPriority: boolean | null;
  /** Raw capabilities reply; its bit layout is not decoded. */
  capabilities: Uint8Array | null;
}


/** HID++ 0x8070 info: one zone count, BE capability masks. */
export function decodeLogitechLegacyLightingInfo(params: Uint8Array): { zoneCount: number; canReadEffect: boolean } | null {
  if (params.length < 5) return null;
  return { zoneCount: params[0]!, canReadEffect: (((params[3]! << 8) | params[4]!) & 1) !== 0 };
}

export interface LogitechLegacyZoneInfo {
  index: number;
  location: number;
  /** Effect ordinals belong to this zone, not the global effect ID. */
  effects: readonly LogitechRgbEffectInfo[];
}

export interface LogitechLegacyLightingInfo {
  zones: readonly LogitechLegacyZoneInfo[];
  /** The feature advertises getZoneEffect (fn 14), allowing RAM read-back. */
  canReadEffect: boolean;
}

/** 0x8070 getZoneInfo (fn 1) response; reject a mismatched zone echo. */
export function decodeLogitechLegacyZoneInfo(params: Uint8Array, zoneIndex: number): { location: number; effectCount: number } | null {
  if (params.length < 5 || params[0] !== zoneIndex) return null;
  return { location: (params[1]! << 8) | params[2]!, effectCount: params[3]! };
}

/** 0x8070 getZoneEffectInfo (fn 2) response. */
export function decodeLogitechLegacyEffectInfo(params: Uint8Array, zoneIndex: number, ordinal: number): LogitechRgbEffectInfo | null {
  if (params.length < 8 || params[0] !== zoneIndex || params[1] !== ordinal) return null;
  return { index: ordinal, id: (params[2]! << 8) | params[3]!, period: (params[6]! << 8) | params[7]! };
}

/** Raw active 0x8070 RAM effect; individual parameter meanings depend on effect ID. */
export interface LogitechLegacyActiveEffect {
  zoneIndex: number;
  effectOrdinal: number;
  effectId: number;
  params: Uint8Array;
}


export interface LogitechRgbEffectInfo {
  index: number;
  id: number;
  period: number;
}

export interface LogitechRgbZoneInfo {
  index: number;
  location: number;
  effects: readonly LogitechRgbEffectInfo[];
}

export type LogitechRgbMode = "Off" | "Static" | "Cycling" | "Wave" | "Breathing single";

const LOGITECH_RGB_EFFECT_IDS: Readonly<Record<number, LogitechRgbMode>> = {
  0x00: "Off",
  0x01: "Static",
  0x03: "Cycling",
  0x04: "Wave",
  0x0a: "Breathing single",
  0x15: "Cycling",
  0x16: "Wave",
};

export function logitechRgbMode(effectId: number): LogitechRgbMode | null {
  return LOGITECH_RGB_EFFECT_IDS[effectId] ?? null;
}

export interface LogitechLightingState {
  /** Addressable zone ids reported by 0x8081 presence pages. */
  zones: readonly number[];
  /** 0x8071 clusters and their effect ordinals, when the keyboard exposes them. */
  rgbZones: readonly LogitechRgbZoneInfo[];
  /** 0x8070 legacy LED zones, when advertised by the keyboard. */
  legacyZones: readonly LogitechLegacyZoneInfo[];
  /** Whether 0x8070 fn 14 permits verifying the active RAM effect. */
  legacyEffectReadback: boolean;
}

export interface LogitechKeyboardState {
  productId: number;
  /** Receiver product id when the keyboard is paired behind one. */
  receiverProductId: number | null;
  unitId: string | null;
  serial: string | null;
  transport: readonly string[];
  modelIds: readonly number[];
  firmware: string | null;
  battery: LogitechBattery | null;
  pollingRateHz: number | null;
  supportedPollingRates: readonly number[];
  brightness: LogitechBrightnessInfo | null;
  analog: LogitechAnalogState | null;
  lighting: LogitechLightingState | null;
  controls: readonly import("./controls.js").LogitechControl[] | null;
  wireless: boolean;
  verified: boolean;
}
