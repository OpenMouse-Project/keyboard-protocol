export const ATK_VENDOR_ID = 0x373b;
export const ATK_CONFIG_USAGE_PAGE = 0xff60;
export const ATK_CONFIG_USAGE = 0x61;
export const ATK_REPORT_ID = 0;
export const ATK_FRAME_LENGTH = 32;
export const ATK_PAYLOAD_OFFSET = 1;
export const ATK_CUSTOM_ID = 0x96;
export const ATK_KEYMAP_CHUNK = 28;
export const ATK_ADVANCED_SLOTS = 20;
export const ATK_TAP_DANCE_PREFIX = 0xfe;

export const ATK_COMMAND = {
  getProtocolVersion: 0x01,
  getKeyboardValue: 0x02,
  setKeyboardValue: 0x03,
  lightingSetValue: 0x07,
  lightingGetValue: 0x08,
  keymapGetBuffer: 0x12,
} as const;

export const ATK_CHANNEL = {
  oneTogTh: 0x03,
  oneRt: 0x07,
  deadBand: 0x0b,
  dks: 0x0f,
  entry: 0x0d,
  feature: 0x11,
  bottomOptimize: 0x1d,
  gameMode: 0x1e,
  advancedKey: 0x20,
  logoLight: 0x21,
  travel: 0x24,
  aiMatch: 0x25,
  lightOff: 0x26,
  sideLight: 0x27,
  lightInfo: 0x41,
  reportRate: 0x46,
  keyLight: 0x4b,
  restart: 0x4e,
  lightPositionMode: 0x51,
  decorationLight: 0x53,
} as const;

export const ATK_LIGHT_ZONE = { logo: 240, side: 241, front: 242, button: 243 } as const;
export type AtkLightZone = (typeof ATK_LIGHT_ZONE)[keyof typeof ATK_LIGHT_ZONE];

export const ATK_ADVANCED_MODE = {
  none: 0,
  rs: 1,
  socd: 2,
  socdKey1: 3,
  socdKey2: 4,
  socdNeutral: 5,
  oks: 6,
  aksKey1: 7,
  aksKey2: 8,
  aksNeutral: 9,
} as const;

export const ATK_REPORT_RATES: ReadonlyArray<readonly [number, number]> = [
  [8000, 0],
  [4000, 1],
  [2000, 2],
  [1000, 3],
];

export const ATK_SLEEP_NEVER = 65535;
export const ATK_NKRO_MODES = ["Force 6-key", "Smart detect", "Force full-key"] as const;

export type AtkRgb = readonly [number, number, number];

function byte(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new RangeError(`${name} must be a byte, got ${value}`);
  return value;
}

function milli(mm: number, name: string): number {
  const value = Math.round(mm * 1000);
  if (!Number.isFinite(mm) || value < 0 || value > 0xffff) throw new RangeError(`${name} must be 0 to 65.535 mm, got ${mm}`);
  return value;
}

function u16(frame: Uint8Array, index: number): number {
  return ((frame[index] ?? 0) << 8) | (frame[index + 1] ?? 0);
}

export function atkFrame(command: number, payload: readonly number[] = []): Uint8Array {
  if (payload.length > ATK_FRAME_LENGTH - ATK_PAYLOAD_OFFSET) throw new RangeError("ATK payload does not fit in one 32-byte report");
  const frame = new Uint8Array(ATK_FRAME_LENGTH);
  frame[0] = byte(command, "command");
  payload.forEach((value, index) => { frame[ATK_PAYLOAD_OFFSET + index] = value & 0xff; });
  return frame;
}

export function atkCustomGet(channel: number, extra: readonly number[] = []): Uint8Array {
  return atkFrame(ATK_COMMAND.getKeyboardValue, [ATK_CUSTOM_ID, channel, ...extra]);
}

export function atkCustomSet(channel: number, data: readonly number[]): Uint8Array {
  return atkFrame(ATK_COMMAND.setKeyboardValue, [ATK_CUSTOM_ID, channel, ...data]);
}

export function atkReplyMatches(sent: Uint8Array, got: Uint8Array): boolean {
  if (sent[0] !== got[0]) return false;
  if (sent[0] !== ATK_COMMAND.getKeyboardValue && sent[0] !== ATK_COMMAND.setKeyboardValue) return true;
  if (sent[1] !== got[1]) return false;
  if (sent[1] !== ATK_CUSTOM_ID) return true;
  return sent[2] === got[2];
}

export function atkBuildGetProtocolVersion(): Uint8Array {
  return atkFrame(ATK_COMMAND.getProtocolVersion);
}

export function atkDecodeProtocolVersion(reply: Uint8Array): number {
  return u16(reply, 1);
}

export function atkBuildGetFirmware(): Uint8Array {
  return atkFrame(ATK_COMMAND.getKeyboardValue, [ATK_CUSTOM_ID]);
}

export interface AtkFirmwareVersion {
  text: string;
  value: number;
}

export function atkDecodeFirmware(reply: Uint8Array): AtkFirmwareVersion {
  const text = `${reply[5]!.toString(16)}.${reply[6]!.toString(16).padStart(2, "0")}`;
  return { text, value: Number(text) };
}

export function atkIsFirmwareV2(firmware: AtkFirmwareVersion | null): boolean {
  return firmware !== null && firmware.value >= 2.1;
}

export interface AtkTravelLimits {
  travelMax: number;
  travelMin: number;
  travelStep: number;
  rtMax: number;
  rtMin: number;
  rtStep: number;
}

export function atkBuildGetTravelLimits(): Uint8Array {
  return atkCustomGet(ATK_CHANNEL.travel);
}

export function atkDecodeTravelLimits(reply: Uint8Array): AtkTravelLimits {
  const at = (offset: number): number => u16(reply, ATK_PAYLOAD_OFFSET + offset) / 1000;
  return { travelMax: at(2), travelMin: at(4), travelStep: at(6), rtMax: at(8), rtMin: at(10), rtStep: at(12) };
}

export interface AtkDeadZone {
  top: number;
  bottom: number;
}

export function atkBuildGetDeadZone(): Uint8Array {
  return atkCustomGet(ATK_CHANNEL.deadBand);
}

export function atkBuildSetDeadZone(zone: AtkDeadZone): Uint8Array {
  const top = milli(zone.top, "top");
  const bottom = milli(zone.bottom, "bottom");
  return atkCustomSet(ATK_CHANNEL.deadBand, [top >> 8, top & 0xff, bottom >> 8, bottom & 0xff]);
}

export function atkDecodeDeadZone(reply: Uint8Array): AtkDeadZone {
  return { top: u16(reply, ATK_PAYLOAD_OFFSET + 2) / 1000, bottom: u16(reply, ATK_PAYLOAD_OFFSET + 4) / 1000 };
}

export interface AtkFeature {
  rgbArea: number;
  exchangeWasd: number;
  macMode: number;
  winLock: number;
  nkro: number;
  keyMode: number;
}

export function atkBuildGetFeature(): Uint8Array {
  return atkCustomGet(ATK_CHANNEL.feature);
}

export function atkDecodeFeature(reply: Uint8Array): AtkFeature {
  const at = (offset: number): number => reply[ATK_PAYLOAD_OFFSET + offset] ?? 0;
  return { rgbArea: at(2), exchangeWasd: at(3), macMode: at(4), winLock: at(5), nkro: at(6), keyMode: at(7) };
}

export function atkBuildSetFeature(feature: Omit<AtkFeature, "keyMode">): Uint8Array {
  if (feature.nkro < 0 || feature.nkro >= ATK_NKRO_MODES.length) throw new RangeError("NKRO mode must be 0, 1 or 2");
  return atkCustomSet(ATK_CHANNEL.feature, [
    byte(feature.rgbArea, "rgbArea"), feature.exchangeWasd ? 1 : 0, feature.macMode ? 1 : 0,
    feature.winLock ? 1 : 0, byte(feature.nkro, "nkro"),
  ]);
}

export const ATK_FLAG_CHANNEL = {
  gameMode: ATK_CHANNEL.gameMode,
  aiMatch: ATK_CHANNEL.aiMatch,
  bottomOptimize: ATK_CHANNEL.bottomOptimize,
} as const;
export type AtkFlag = keyof typeof ATK_FLAG_CHANNEL;

export function atkBuildGetFlag(flag: AtkFlag): Uint8Array {
  return atkCustomGet(ATK_FLAG_CHANNEL[flag]);
}

export function atkBuildSetFlag(flag: AtkFlag, enabled: boolean): Uint8Array {
  return atkCustomSet(ATK_FLAG_CHANNEL[flag], [enabled ? 1 : 0]);
}

export function atkDecodeFlag(reply: Uint8Array): boolean {
  return (reply[ATK_PAYLOAD_OFFSET + 2] ?? 0) !== 0;
}

export function atkBuildGetSleep(): Uint8Array {
  return atkCustomGet(ATK_CHANNEL.lightOff);
}

export function atkDecodeSleep(reply: Uint8Array): number {
  const minutes = reply[ATK_PAYLOAD_OFFSET + 2] ?? 0;
  return minutes === 0 ? ATK_SLEEP_NEVER : minutes * 60;
}

export function atkBuildSetSleep(seconds: number): Uint8Array {
  if (seconds === ATK_SLEEP_NEVER) return atkCustomSet(ATK_CHANNEL.lightOff, [0]);
  const minutes = Math.round(seconds / 60);
  if (minutes < 1 || minutes > 0xff) throw new RangeError("Sleep must be 1 to 255 minutes, or never");
  return atkCustomSet(ATK_CHANNEL.lightOff, [minutes]);
}

export function atkBuildGetReportRate(): Uint8Array {
  return atkCustomGet(ATK_CHANNEL.reportRate);
}

export function atkDecodeReportRate(reply: Uint8Array): number | null {
  const code = reply[ATK_PAYLOAD_OFFSET + 2];
  return ATK_REPORT_RATES.find(([, value]) => value === code)?.[0] ?? null;
}

export function atkBuildSetReportRate(hz: number): Uint8Array[] {
  const entry = ATK_REPORT_RATES.find(([rate]) => rate === hz);
  if (!entry) throw new RangeError(`Unsupported report rate: ${hz}`);
  return [atkCustomSet(ATK_CHANNEL.restart, [1]), atkCustomSet(ATK_CHANNEL.reportRate, [entry[1]])];
}

export interface AtkLightConfig {
  effect: number;
  speed: number;
  color: AtkRgb;
  brightness: number;
  colorful: boolean;
}

export function atkBuildGetLightConfig(): Uint8Array {
  return atkFrame(ATK_COMMAND.lightingGetValue, [ATK_CHANNEL.lightInfo]);
}

export function atkDecodeLightConfig(reply: Uint8Array): AtkLightConfig {
  const at = (offset: number): number => reply[ATK_PAYLOAD_OFFSET + offset] ?? 0;
  return { effect: at(1), speed: at(3), color: [at(4), at(5), at(6)], brightness: at(7), colorful: at(8) !== 0 };
}

export function atkBuildSetLightConfig(config: AtkLightConfig): Uint8Array {
  return atkFrame(ATK_COMMAND.lightingSetValue, [
    ATK_CHANNEL.lightInfo, byte(config.effect, "effect"), 0, byte(config.speed, "speed"),
    byte(config.color[0], "red"), byte(config.color[1], "green"), byte(config.color[2], "blue"),
    byte(config.brightness, "brightness"), config.colorful ? 1 : 0,
  ]);
}

export interface AtkZoneLight {
  effect: number;
  colorful: boolean;
  brightness: number;
  speed: number;
  color: AtkRgb;
}

export function atkZoneChannel(zone: AtkLightZone, v2: boolean): number {
  if (!v2 && zone <= ATK_LIGHT_ZONE.side) return zone === ATK_LIGHT_ZONE.logo ? ATK_CHANNEL.logoLight : ATK_CHANNEL.sideLight;
  return ATK_CHANNEL.decorationLight;
}

export function atkBuildGetZoneLight(zone: AtkLightZone, v2: boolean): Uint8Array {
  const channel = atkZoneChannel(zone, v2);
  return atkCustomGet(channel, channel === ATK_CHANNEL.decorationLight ? [zone] : []);
}

export function atkDecodeZoneLight(reply: Uint8Array): AtkZoneLight {
  const at = (offset: number): number => reply[ATK_PAYLOAD_OFFSET + offset] ?? 0;
  return { effect: at(2), colorful: at(3) !== 0, brightness: at(4), speed: at(5), color: [at(6), at(7), at(8)] };
}

export function atkBuildSetZoneLight(zone: AtkLightZone, v2: boolean, light: AtkZoneLight): Uint8Array {
  const channel = atkZoneChannel(zone, v2);
  const data = [
    byte(light.effect, "effect"), light.colorful ? 1 : 0, byte(light.brightness, "brightness"), byte(light.speed, "speed"),
    byte(light.color[0], "red"), byte(light.color[1], "green"), byte(light.color[2], "blue"),
  ];
  return atkCustomSet(channel, channel === ATK_CHANNEL.decorationLight ? [...data, zone] : data);
}

export function atkBuildGetKeyLight(key: number): Uint8Array {
  return atkCustomGet(ATK_CHANNEL.keyLight, [byte(key, "key")]);
}

export function atkDecodeKeyLight(reply: Uint8Array): { key: number; color: AtkRgb } {
  const at = (offset: number): number => reply[ATK_PAYLOAD_OFFSET + offset] ?? 0;
  return { key: at(2), color: [at(3), at(4), at(5)] };
}

export function atkBuildSetKeyLight(key: number, color: AtkRgb): Uint8Array {
  return atkCustomSet(ATK_CHANNEL.keyLight, [byte(key, "key"), byte(color[0], "red"), byte(color[1], "green"), byte(color[2], "blue")]);
}

export function atkBuildGetKeyTravel(row: number, col: number): Uint8Array {
  return atkCustomGet(ATK_CHANNEL.oneTogTh, [byte(row, "row"), byte(col, "col")]);
}

export function atkDecodeKeyTravel(reply: Uint8Array): number {
  return u16(reply, ATK_PAYLOAD_OFFSET + 4) / 1000;
}

export function atkBuildSetKeyTravel(row: number, col: number, mm: number): Uint8Array {
  const value = milli(mm, "travel");
  return atkCustomSet(ATK_CHANNEL.oneTogTh, [byte(row, "row"), byte(col, "col"), value >> 8, value & 0xff]);
}

export interface AtkRapidTrigger {
  enabled: boolean;
  press: number;
  release: number;
}

export function atkBuildGetKeyRapidTrigger(row: number, col: number): Uint8Array {
  return atkCustomGet(ATK_CHANNEL.oneRt, [byte(row, "row"), byte(col, "col")]);
}

export function atkDecodeKeyRapidTrigger(reply: Uint8Array): AtkRapidTrigger {
  return {
    enabled: (reply[ATK_PAYLOAD_OFFSET + 4] ?? 0) !== 0,
    release: u16(reply, ATK_PAYLOAD_OFFSET + 5) / 1000,
    press: u16(reply, ATK_PAYLOAD_OFFSET + 7) / 1000,
  };
}

export function atkBuildSetKeyRapidTrigger(row: number, col: number, rapid: AtkRapidTrigger): Uint8Array {
  const press = milli(rapid.press, "press");
  const release = milli(rapid.release, "release");
  return atkCustomSet(ATK_CHANNEL.oneRt, [
    byte(row, "row"), byte(col, "col"), rapid.enabled ? 1 : 0, release >> 8, release & 0xff, press >> 8, press & 0xff,
  ]);
}

export interface AtkAdvancedKey {
  index: number;
  mode: number;
  point: number;
  rt: boolean;
  key1: readonly [number, number];
  key2: readonly [number, number];
  layer: number;
}

export type AtkAdvancedKeyWrite = Partial<Omit<AtkAdvancedKey, "index">> & {
  triggerDelay?: number;
  keyDelay?: number;
};

const ADVANCED_GET = 1;
const ADVANCED_SET = 3;

function advancedPayload(sub: number, index: number, write: AtkAdvancedKeyWrite = {}): number[] {
  const payload = new Array<number>(23).fill(0);
  payload[0] = ATK_CUSTOM_ID;
  payload[1] = ATK_CHANNEL.advancedKey;
  payload[4] = sub;
  payload[5] = byte(index, "index");
  payload[7] = index;
  if (write.mode !== undefined) payload[6] = byte(write.mode, "mode");
  if (write.point !== undefined) {
    const point = milli(write.point, "point");
    payload[8] = point >> 8;
    payload[9] = point & 0xff;
  }
  if (write.rt !== undefined) payload[11] = write.rt ? 1 : 0;
  if (write.key1) { payload[12] = byte(write.key1[0], "key1"); payload[13] = byte(write.key1[1], "key1"); }
  if (write.key2) { payload[14] = byte(write.key2[0], "key2"); payload[15] = byte(write.key2[1], "key2"); }
  if (write.layer !== undefined) payload[16] = byte(write.layer, "layer");
  if (write.triggerDelay !== undefined) {
    payload[17] = (write.triggerDelay >> 8) & 0xff;
    payload[18] = write.triggerDelay & 0xff;
  }
  if (write.keyDelay !== undefined) {
    payload[19] = (write.keyDelay >> 8) & 0xff;
    payload[20] = write.keyDelay & 0xff;
  }
  return payload;
}

export function atkBuildGetAdvancedKey(index: number): Uint8Array {
  return atkFrame(ATK_COMMAND.getKeyboardValue, advancedPayload(ADVANCED_GET, index));
}

export function atkBuildSetAdvancedKey(index: number, write: AtkAdvancedKeyWrite): Uint8Array {
  return atkFrame(ATK_COMMAND.setKeyboardValue, advancedPayload(ADVANCED_SET, index, write));
}

export function atkBuildClearAdvancedKey(index: number): Uint8Array {
  return atkBuildSetAdvancedKey(index, { mode: ATK_ADVANCED_MODE.none });
}

export function atkDecodeAdvancedKey(index: number, reply: Uint8Array): AtkAdvancedKey {
  const at = (offset: number): number => reply[ATK_PAYLOAD_OFFSET + offset] ?? 0;
  return {
    index,
    mode: at(6),
    point: u16(reply, ATK_PAYLOAD_OFFSET + 8) / 1000,
    rt: at(11) !== 0,
    key1: [at(12), at(13)],
    key2: [at(14), at(15)],
    layer: at(16),
  };
}

export function atkBuildTapDance(index: number, tap: number, hold: number, timerMs: number): Uint8Array {
  if (timerMs < 0 || timerMs > 0xffff) throw new RangeError("Tap-dance timer must fit 16 bits");
  return atkFrame(ATK_TAP_DANCE_PREFIX, [
    ATK_CHANNEL.entry, 2, byte(index, "index"), 0, byte(tap, "tap"), 0, byte(hold, "hold"),
    (timerMs >> 8) & 0xff, timerMs & 0xff,
  ]);
}

export function atkBuildMt(index: number, tap: number, hold: number, delayMs: number): Uint8Array {
  return atkBuildTapDance(index, tap, hold, delayMs);
}

export function atkBuildTgl(index: number, key: number, delayMs: number): Uint8Array {
  return atkBuildTapDance(index + ATK_ADVANCED_SLOTS, key, 0, delayMs);
}

export function atkBuildSetDks(index: number, codes: readonly number[], top: number, bottom: number): Uint8Array {
  if (codes.length > 4) throw new RangeError("DKS takes at most 4 bindings");
  const payload = new Array<number>(26).fill(0);
  payload[0] = ATK_CUSTOM_ID;
  payload[1] = ATK_CHANNEL.dks;
  payload[4] = ADVANCED_SET;
  payload[5] = byte(index, "index");
  codes.forEach((code, slot) => {
    const offset = 6 + 4 * slot;
    payload[offset] = code ? 0x0f : 0;
    payload[offset + 3] = byte(code, "code");
  });
  const t = milli(top, "top");
  const b = milli(bottom, "bottom");
  payload[22] = t >> 8;
  payload[23] = t & 0xff;
  payload[24] = b >> 8;
  payload[25] = b & 0xff;
  return atkFrame(ATK_COMMAND.setKeyboardValue, payload);
}

export function atkBuildGetKeymapChunk(offset: number, length: number): Uint8Array {
  if (length < 1 || length > ATK_KEYMAP_CHUNK) throw new RangeError(`Keymap chunk must be 1 to ${ATK_KEYMAP_CHUNK} bytes`);
  return atkFrame(ATK_COMMAND.keymapGetBuffer, [offset >> 8, offset & 0xff, length]);
}

export function atkKeymapChunks(rows: number, cols: number): Array<{ offset: number; length: number }> {
  const total = rows * cols * 2;
  const chunks: Array<{ offset: number; length: number }> = [];
  for (let offset = 0; offset < total; offset += ATK_KEYMAP_CHUNK) {
    chunks.push({ offset, length: Math.min(ATK_KEYMAP_CHUNK, total - offset) });
  }
  return chunks;
}

export function atkDecodeKeymapChunk(reply: Uint8Array, length: number): number[] {
  return Array.from(reply.subarray(4, 4 + length));
}

export function atkDecodeKeymap(bytes: readonly number[], rows: number, cols: number): number[] {
  const codes: number[] = [];
  for (let i = 0; i < rows * cols; i++) codes.push(((bytes[i * 2] ?? 0) << 8) | (bytes[i * 2 + 1] ?? 0));
  return codes;
}
export * from "./products.ts";
