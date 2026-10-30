/**
 * Arbiter Studio keyboard protocol, implemented from static analysis of the
 * vendor's public web configurator (see docs/arbiter-support.md). No Arbiter
 * keyboard has been exercised through this package: every catalog entry is
 * `verified: false`.
 */
export const ARBITER_VENDOR_ID = 0x1a81;
export const ARBITER_VENDOR_ID_ALT = 0x371c;
export const ARBITER_CONFIG_USAGE = 1;
export const ARBITER_REPORT_ID = 0;
export const ARBITER_FRAME_SIZE = 64;

/** Keys carried by one long-packet table read or write (`keyCode, param` or `make, break` pairs). */
export const ARBITER_KEYS_PER_PACKET = 29;
export const ARBITER_LIGHT_DATA_SIZE = 26;
export const ARBITER_LIGHT_COLOR_SLOTS = 7;
export const ARBITER_USER_MODE_SIZE = 6;
/** A reply starting `[0x04, 0xC9]` announces a profile switch on the PRO models. */
export const ARBITER_PROFILE_CHANGED = [0x04, 0xc9] as const;

export const ARBITER_COMMAND = {
  setTravel: 0,
  getTravel: 1,
  getFirmware: 2,
  getSerial: 13,
  setLightEffect: 24,
  getLightEffect: 25,
  setKeyMapping: 26,
  getKeyMapping: 27,
  setBoardProfile: 38,
  setUserMode: 52,
  getUserMode: 53,
} as const;
export type ArbiterCommand = (typeof ARBITER_COMMAND)[keyof typeof ARBITER_COMMAND];

/** Packet type bits OR-ed into the command byte. */
export const ARBITER_PACKET = { short: 0x00, long: 0x40 } as const;
export type ArbiterPacketType = (typeof ARBITER_PACKET)[keyof typeof ARBITER_PACKET];

export const ARBITER_STATUS = [
  "Success", "Busy", "UnexpectedError", "NoSupport", "DeviceIsOffline", "BadDevice",
  "BadData", "DeviceIsNotExisted", "NoMoreData", "MemeryNoEnough", "FwUpdating",
] as const;

export const ARBITER_LIGHT_EFFECTS = [
  "Spectral_Cycle", "Static", "L_R_Surf", "Breath", "Snake", "Magnetic", "Rotate", "M_Surf",
  "Colorful_Fountain", "Laser", "Cross_Surf", "Traffic", "Rippling", "Dance_Macabre",
  "Rand_Fountatin", "Love",
] as const;

/** Protocol class names from the vendor bundle; `s2` was not diffed against `yl`. */
export type ArbiterProtocol = "yl" | "s2" | "i2" | "u2";

export interface ArbiterProduct {
  name: string;
  vendorId: number;
  productId: number;
  usagePage: number;
  protocol: ArbiterProtocol;
  /** Keys per layer in the vendor's matrix. */
  keys: number;
  layers: number;
  profiles: number;
  superTap: boolean;
  /** False until the model is exercised through this package on hardware. */
  verified: boolean;
}

const product = (
  name: string, vendorId: number, productId: number, usagePage: number,
  protocol: ArbiterProtocol, keys: number, layers: number, profiles: number, superTap: boolean,
): ArbiterProduct => ({ name, vendorId, productId, usagePage, protocol, keys, layers, profiles, superTap, verified: false });

/** One entry per vendor id, product id and usage page the vendor bundle defines. */
export const ARBITER_PRODUCTS: readonly ArbiterProduct[] = [
  product("Arbiter Polar 65", ARBITER_VENDOR_ID, 0x2072, 0xff01, "yl", 68, 1, 1, false),
  product("Arbiter Polar 65", ARBITER_VENDOR_ID, 0x2072, 0xff02, "yl", 68, 1, 1, true),
  product("Polar 65", ARBITER_VENDOR_ID, 0x208e, 0xff02, "yl", 68, 1, 1, true),
  product("Nimbus 65", ARBITER_VENDOR_ID, 0x2077, 0xff01, "yl", 68, 1, 1, false),
  product("Polar 65", ARBITER_VENDOR_ID_ALT, 0xa005, 0xff02, "yl", 68, 1, 1, true),
  product("Arbiter Polar 65", ARBITER_VENDOR_ID_ALT, 0xa006, 0xff01, "s2", 68, 1, 1, true),
  product("Polar 65 PRO", ARBITER_VENDOR_ID_ALT, 0xa003, 0xff02, "i2", 68, 2, 3, true),
  product("Polar 75 PRO", ARBITER_VENDOR_ID_ALT, 0xa001, 0xff02, "u2", 82, 2, 3, true),
];

/** The catalog entry for an exact vendor id, product id and usage page. */
export function arbiterProduct(vendorId: number, productId: number, usagePage: number): ArbiterProduct | undefined {
  return ARBITER_PRODUCTS.find((entry) =>
    entry.vendorId === vendorId && entry.productId === productId && entry.usagePage === usagePage);
}

export function arbiterIsPro(entry: ArbiterProduct): boolean {
  return entry.protocol === "i2" || entry.protocol === "u2";
}

/** Packets in a travel table: one `make, break` pair per key. */
export function arbiterTravelPackets(entry: ArbiterProduct): number {
  return Math.ceil(entry.keys / ARBITER_KEYS_PER_PACKET);
}

/**
 * Packets in the key mapping table. The table is flat: every key of layer 0,
 * then every key of layer 1. The vendor app sends 3 packets on the 65s, 5 on the
 * 65 PRO (2 x 68 keys) and 6 on the 75 PRO (2 x 82 keys).
 */
export function arbiterKeyMappingPackets(entry: ArbiterProduct): number {
  return Math.ceil((entry.keys * entry.layers) / ARBITER_KEYS_PER_PACKET);
}

/** `(85 - sum(bytes 0..62)) & 0xFF`, stored in the final byte. */
export function arbiterChecksum(frame: Uint8Array): number {
  let sum = 0;
  for (let index = 0; index < ARBITER_FRAME_SIZE - 1; index += 1) sum += frame[index] ?? 0;
  return (85 - sum) & 0xff;
}

/** Longest data field a frame can carry: bytes 4..62. */
const MAX_DATA = ARBITER_FRAME_SIZE - 5;

/** Build one 64-byte request. `data` is zero-padded; an oversize payload is rejected. */
export function encodeArbiterRequest(
  command: ArbiterCommand,
  packetType: ArbiterPacketType,
  data: readonly number[] = [],
): Uint8Array<ArrayBuffer> {
  if (!Object.values(ARBITER_COMMAND).includes(command)) throw new RangeError("Unsupported Arbiter command.");
  if (data.length > MAX_DATA) throw new RangeError("Arbiter payload exceeds 59 bytes.");
  for (const byte of data) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) throw new RangeError("Arbiter payload byte is invalid.");
  }
  const frame = new Uint8Array(ARBITER_FRAME_SIZE);
  frame[0] = 0;
  frame[1] = command | packetType;
  frame[2] = 0;
  frame[3] = data.length;
  frame.set(data, 4);
  frame[ARBITER_FRAME_SIZE - 1] = arbiterChecksum(frame);
  return frame;
}

export interface ArbiterReply {
  command: number;
  status: number;
  data: Uint8Array;
}

/** Decode one reply. `null` means the length, checksum or declared size is unusable. */
export function decodeArbiterReply(frame: Uint8Array): ArbiterReply | null {
  if (frame.length !== ARBITER_FRAME_SIZE || frame[ARBITER_FRAME_SIZE - 1] !== arbiterChecksum(frame)) return null;
  const size = frame[3] === 0xff ? 0 : (frame[3] ?? 0);
  if (size > MAX_DATA) return null;
  return { command: (frame[1] ?? 0) & 0x3f, status: frame[2] ?? 0, data: frame.slice(4, 4 + size) };
}

/** True for the unsolicited profile-switch report the PRO models send. */
export function isArbiterProfileChanged(frame: Uint8Array): boolean {
  return frame[0] === ARBITER_PROFILE_CHANGED[0] && frame[1] === ARBITER_PROFILE_CHANGED[1];
}

export function arbiterStatusName(status: number): string {
  return ARBITER_STATUS[status] ?? `Status ${status}`;
}

/** Short request with no payload: firmware, serial, light effect and user-mode reads. */
export function encodeArbiterShortRead(command: ArbiterCommand): Uint8Array<ArrayBuffer> {
  return encodeArbiterRequest(command, ARBITER_PACKET.short);
}

/** Packet header byte: low nibble index, high nibble total packet count. */
export function arbiterPacketHeader(index: number, total: number): number {
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || total > 15 || index < 0 || index >= total) {
    throw new RangeError("Arbiter packet index must be below a total of 1-15.");
  }
  return index | (total << 4);
}

/** Long read of one table packet (travel or key mapping). */
export function encodeArbiterTableRead(
  command: typeof ARBITER_COMMAND.getTravel | typeof ARBITER_COMMAND.getKeyMapping,
  index: number,
  total: number,
): Uint8Array<ArrayBuffer> {
  return encodeArbiterRequest(command, ARBITER_PACKET.long, [arbiterPacketHeader(index, total)]);
}

export interface ArbiterTablePacket {
  index: number;
  total: number;
  /** Raw bytes after the header, two per key. */
  entries: Uint8Array;
}

/** Split a table reply's data into its packet header and key pairs. */
export function decodeArbiterTablePacket(reply: ArbiterReply): ArbiterTablePacket | null {
  const header = reply.data[0];
  if (header === undefined || reply.data.length % 2 !== 1) return null;
  const index = header & 0x0f;
  const total = header >> 4;
  if (total < 1 || index >= total) return null;
  return { index, total, entries: reply.data.slice(1) };
}

export interface ArbiterKeyTravel {
  /** Actuation, in the firmware's own unit (the unit is not established). */
  make: number;
  /** Rapid-trigger distance, in the firmware's own unit. */
  break: number;
}

export function decodeArbiterTravelPacket(reply: ArbiterReply): { index: number; total: number; keys: ArbiterKeyTravel[] } | null {
  if (reply.command !== ARBITER_COMMAND.getTravel) return null;
  const packet = decodeArbiterTablePacket(reply);
  if (!packet) return null;
  const keys: ArbiterKeyTravel[] = [];
  for (let offset = 0; offset < packet.entries.length; offset += 2) {
    keys.push({ make: packet.entries[offset]!, break: packet.entries[offset + 1]! });
  }
  return { index: packet.index, total: packet.total, keys };
}

function encodeTablePacket(
  command: ArbiterCommand,
  index: number,
  total: number,
  pairs: readonly (readonly [number, number])[],
): Uint8Array<ArrayBuffer> {
  if (pairs.length < 1 || pairs.length > ARBITER_KEYS_PER_PACKET) {
    throw new RangeError("An Arbiter table packet carries 1-29 keys.");
  }
  return encodeArbiterRequest(command, ARBITER_PACKET.long, [
    arbiterPacketHeader(index, total),
    ...pairs.flatMap(([first, second]) => [first, second]),
  ]);
}

/** Write one packet of `make, break` pairs. */
export function encodeArbiterTravelWrite(index: number, total: number, keys: readonly ArbiterKeyTravel[]): Uint8Array<ArrayBuffer> {
  for (const key of keys) {
    for (const value of [key.make, key.break]) {
      if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new RangeError("Arbiter travel values are whole numbers from 0 to 255.");
    }
  }
  return encodeTablePacket(ARBITER_COMMAND.setTravel, index, total, keys.map((key) => [key.make, key.break] as const));
}

/** One mapped key: .NET `Keys` code plus the vendor's parameter byte. */
export interface ArbiterKeyBinding {
  keyCode: number;
  param: number;
}

export function decodeArbiterKeyMappingPacket(reply: ArbiterReply): { index: number; total: number; bindings: ArbiterKeyBinding[] } | null {
  if (reply.command !== ARBITER_COMMAND.getKeyMapping) return null;
  const packet = decodeArbiterTablePacket(reply);
  if (!packet) return null;
  const bindings: ArbiterKeyBinding[] = [];
  for (let offset = 0; offset < packet.entries.length; offset += 2) {
    bindings.push({ keyCode: packet.entries[offset]!, param: packet.entries[offset + 1]! });
  }
  return { index: packet.index, total: packet.total, bindings };
}

/** Write one packet of `keyCode, param` pairs. */
export function encodeArbiterKeyMappingWrite(index: number, total: number, bindings: readonly ArbiterKeyBinding[]): Uint8Array<ArrayBuffer> {
  for (const binding of bindings) {
    for (const value of [binding.keyCode, binding.param]) {
      if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new RangeError("Arbiter key bindings are whole numbers from 0 to 255.");
    }
  }
  return encodeTablePacket(ARBITER_COMMAND.setKeyMapping, index, total, bindings.map((b) => [b.keyCode, b.param] as const));
}

export interface ArbiterRgb {
  red: number;
  green: number;
  blue: number;
}

export interface ArbiterLightEffect {
  on: boolean;
  /** Index into {@link ARBITER_LIGHT_EFFECTS}. */
  effect: number;
  brightness: number;
  speed: number;
  /** Palette index; what it selects is not established. */
  colorIndex: number;
  colors: readonly ArbiterRgb[];
}

/** Decode the 26-byte light effect payload. */
export function decodeArbiterLightEffect(reply: ArbiterReply): ArbiterLightEffect | null {
  if (reply.command !== ARBITER_COMMAND.getLightEffect || reply.data.length !== ARBITER_LIGHT_DATA_SIZE) return null;
  const data = reply.data;
  const colors: ArbiterRgb[] = [];
  for (let slot = 0; slot < ARBITER_LIGHT_COLOR_SLOTS; slot += 1) {
    const base = 5 + slot * 3;
    colors.push({ red: data[base]!, green: data[base + 1]!, blue: data[base + 2]! });
  }
  return { on: data[0]! > 0, effect: data[1]!, brightness: data[2]!, speed: data[3]!, colorIndex: data[4]!, colors };
}

/** Encode a light effect write; every field is validated, and all 7 colours are required. */
export function encodeArbiterLightEffectWrite(light: ArbiterLightEffect): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(light.effect) || light.effect < 0 || light.effect >= ARBITER_LIGHT_EFFECTS.length) {
    throw new RangeError("Arbiter light effect is not one of the 16 known effects.");
  }
  if (light.colors.length !== ARBITER_LIGHT_COLOR_SLOTS) throw new RangeError("Arbiter light effects carry exactly 7 colours.");
  const scalars = [light.brightness, light.speed, light.colorIndex];
  const channels = light.colors.flatMap((color) => [color.red, color.green, color.blue]);
  for (const value of [...scalars, ...channels]) {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new RangeError("Arbiter light values are whole numbers from 0 to 255.");
  }
  return encodeArbiterRequest(ARBITER_COMMAND.setLightEffect, ARBITER_PACKET.short, [
    light.on ? 1 : 0, light.effect, light.brightness, light.speed, light.colorIndex, ...channels,
  ]);
}

/** Select an on-board profile (0-based). */
export function encodeArbiterBoardProfile(profile: number, profileCount: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(profile) || profile < 0 || profile >= profileCount) {
    throw new RangeError(`Arbiter profile must be 0-${profileCount - 1} for this model.`);
  }
  return encodeArbiterRequest(ARBITER_COMMAND.setBoardProfile, ARBITER_PACKET.short, [profile]);
}

/** `[layoutIndex, mode, checkFlag, flag | alternative << 7, keyIndex0, keyIndex1]`. */
export interface ArbiterUserMode {
  layoutIndex: number;
  mode: number;
  checkFlag: number;
  flag: number;
  alternative: number;
  keyIndex: readonly [number, number];
}

export function decodeArbiterUserMode(reply: ArbiterReply): ArbiterUserMode | null {
  if (reply.command !== ARBITER_COMMAND.getUserMode || reply.data.length !== ARBITER_USER_MODE_SIZE) return null;
  const data = reply.data;
  return {
    layoutIndex: data[0]!, mode: data[1]!, checkFlag: data[2]!,
    flag: data[3]! & 0x7f, alternative: data[3]! >> 7, keyIndex: [data[4]!, data[5]!],
  };
}

export function encodeArbiterUserModeWrite(mode: ArbiterUserMode): Uint8Array<ArrayBuffer> {
  const bytes = [mode.layoutIndex, mode.mode, mode.checkFlag, mode.keyIndex[0], mode.keyIndex[1]];
  for (const value of bytes) {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new RangeError("Arbiter user-mode values are whole numbers from 0 to 255.");
  }
  if (!Number.isInteger(mode.flag) || mode.flag < 0 || mode.flag > 0x7f) throw new RangeError("Arbiter user-mode flag is 0-127.");
  if (mode.alternative !== 0 && mode.alternative !== 1) throw new RangeError("Arbiter user-mode alternative is 0 or 1.");
  return encodeArbiterRequest(ARBITER_COMMAND.setUserMode, ARBITER_PACKET.short, [
    mode.layoutIndex, mode.mode, mode.checkFlag, mode.flag | (mode.alternative << 7), mode.keyIndex[0], mode.keyIndex[1],
  ]);
}

/** Firmware reply: byte 0 is the low and byte 7 the high version byte, shown as `V{high}{low}`. */
export function decodeArbiterFirmware(reply: ArbiterReply): string | null {
  if (reply.command !== ARBITER_COMMAND.getFirmware || reply.data.length < 8) return null;
  const hex = (value: number) => value.toString(16).padStart(2, "0");
  return `V${hex(reply.data[7]!)}${hex(reply.data[0]!)}`;
}

/** Serial reply: the vendor app concatenates each byte as unpadded hex. */
export function decodeArbiterSerial(reply: ArbiterReply): string | null {
  if (reply.command !== ARBITER_COMMAND.getSerial || reply.data.length === 0) return null;
  return [...reply.data].map((byte) => byte.toString(16)).join("");
}

/**
 * A write acknowledgement echoes the command and carries a four-byte
 * little-endian "data change flag". The vendor app reads the flag without
 * checking the length, so missing bytes count as zero. `null` means the reply
 * answers a different command.
 */
export function decodeArbiterWriteAck(reply: ArbiterReply, command: ArbiterCommand): number | null {
  if (reply.command !== command) return null;
  const byte = (index: number) => reply.data[index] ?? 0;
  return (byte(0) | (byte(1) << 8) | (byte(2) << 16) | (byte(3) << 24)) >>> 0;
}

/** Decoded state of an Arbiter keyboard, as a driver read it. */
export interface ArbiterKeyboardState {
  vendorId: number;
  productId: number;
  protocol: ArbiterProtocol;
  layers: number;
  profiles: number;
  superTap: boolean;
  verified: boolean;
  /** Per-key actuation and rapid-trigger values in the firmware's unit. */
  travel: readonly ArbiterKeyTravel[] | null;
  light: ArbiterLightEffect | null;
  userMode: ArbiterUserMode | null;
}
