/**
 * Keychron Hall-effect keyboard protocol (the `KC_HE` command group, 0xA9) —
 * transport-independent codec.
 *
 * Decoded from the public Keychron Launcher web app (launcher.keychron.com,
 * `main.d60cabdb24f8f1c7.js`, the five `getCommandVersion()` classes that
 * return 1-5) and its per-board definitions. See docs/keychron-support.md for
 * the evidence, what is and is not hardware-verified, and the product catalog.
 *
 * Every command is one 32-byte report on the VIA raw-HID collection (usage page
 * 0xFF60, usage 0x61, report id 0):
 *
 *   [0xA9, subcommand, ...arguments, zero padding]
 *
 * and the board answers with a report that echoes `[0xA9, subcommand]`. The
 * board reports its HE command version (1-5) for `AMC_GET_VERSION`; the
 * version selects the key-slot layout and the width of the travel fields:
 *
 *   v1-v4  one byte per travel value, in 0.1 mm steps
 *   v5     16-bit little-endian travel values, in a step the board reports
 *          (0.1, 0.01 or 0.001 mm) in its profile-info reply
 *
 * Nothing here has been run against a physical Keychron board. Frames mirror
 * what Launcher sends; the unit tests pin the byte layout, not firmware
 * behaviour.
 */

export const KEYCHRON_VENDOR_ID = 0x3434;
export const KEYCHRON_CONFIG_USAGE_PAGE = 0xff60;
export const KEYCHRON_CONFIG_USAGE = 0x61;
export const KEYCHRON_REPORT_ID = 0;
export const KEYCHRON_REPORT_SIZE = 32;
/** `KC_HE` in Launcher's command enum. */
export const KEYCHRON_HE_COMMAND = 0xa9;

export const KEYCHRON_HE_SUBCOMMAND = {
  getVersion: 0x01,
  getProfilesInfo: 0x10,
  selectProfile: 0x11,
  getProfileBuffer: 0x12,
  setProfileName: 0x13,
  setTravel: 0x14,
  setAdvanceMode: 0x15,
  setActOnAxis: 0x16,
  resetSingleKey: 0x1d,
  clearProfileBuffer: 0x1e,
  saveProfileBuffer: 0x1f,
  getCurve: 0x20,
  setCurve: 0x21,
  getJoyKeyboard: 0x22,
  setJoyKeyboard: 0x23,
  getRealtimeTravel: 0x30,
  calibrate: 0x40,
  getCalibrateState: 0x41,
  getCalibratedValue: 0x42,
  getAxisType: 0x50,
  setAxisType: 0x51,
} as const;
export type KeychronHeSubcommand = (typeof KEYCHRON_HE_SUBCOMMAND)[keyof typeof KEYCHRON_HE_SUBCOMMAND];

/** `AMC_CALIBRATE` argument: start the calibration sweep / stop it. */
export const KEYCHRON_CALIBRATE = { start: 2, stop: 4 } as const;

/**
 * `workMode` byte of a travel write. Launcher's `hw` enum: Global 0, Static 1,
 * QuickTrigger 2 (rapid trigger).
 */
export const KEYCHRON_WORK_MODE = { global: 0, static: 1, quickTrigger: 2 } as const;
export type KeychronWorkMode = (typeof KEYCHRON_WORK_MODE)[keyof typeof KEYCHRON_WORK_MODE];

/** `keyMode` byte of a travel write: 1 applies to every key, 0 to the keys set in a bitmap. */
export const KEYCHRON_KEY_MODE = { perKey: 0, allKeys: 1 } as const;
/** Per-key bitmap: three bytes per row, eight columns per byte, low bit first. */
export const KEYCHRON_KEY_BITMAP_SIZE = 24;
/** Profile names are 28 bytes: up to 14 UTF-16BE units, zero padded. */
export const KEYCHRON_PROFILE_NAME_BYTES = 28;

export interface KeychronKeyPosition { row: number; col: number }

/** Bitmap of `keys` in Launcher's layout: byte `3 * row + floor(col / 8)`, bit `col % 8`. */
export function keychronKeyBitmap(keys: readonly KeychronKeyPosition[]): Uint8Array<ArrayBuffer> {
  const bitmap = new Uint8Array(KEYCHRON_KEY_BITMAP_SIZE);
  for (const { row, col } of keys) {
    const at = 3 * row + Math.floor(col / 8);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || col >= 24 || at >= bitmap.length) {
      throw new RangeError(`Key [${row},${col}] is outside the 8x24 bitmap.`);
    }
    bitmap[at]! |= 1 << (col % 8);
  }
  return bitmap;
}

/** `keyMode` and `buffer` for a travel write: every key (no keys given) or just `keys`. */
export function keychronKeyTarget(keys?: readonly KeychronKeyPosition[]): { keyMode: number; buffer?: number[] } {
  if (!keys) return { keyMode: KEYCHRON_KEY_MODE.allKeys };
  if (keys.length === 0) throw new RangeError("A per-key write needs at least one key.");
  return { keyMode: KEYCHRON_KEY_MODE.perKey, buffer: [...keychronKeyBitmap(keys)] };
}

/** Name bytes and length for `setProfileName`: trimmed, BMP only, up to 14 characters. */
export function keychronProfileNameBytes(name: string): { chars: number[]; length: number } {
  const units = [...name.trim()];
  if (units.length === 0 || units.length > 14) throw new RangeError("Profile names are 1-14 characters.");
  const chars = new Array<number>(KEYCHRON_PROFILE_NAME_BYTES).fill(0);
  units.forEach((unit, index) => {
    const code = unit.codePointAt(0)!;
    if (code > 0xffff) throw new RangeError("Profile names are limited to the Basic Multilingual Plane.");
    chars[2 * index] = code >> 8;
    chars[2 * index + 1] = code & U8;
  });
  return { chars, length: 2 * units.length };
}

export type KeychronHeVersion = 1 | 2 | 3 | 4 | 5;

/** Capability bits of the `AMC_GET_VERSION` reply (byte 4, bit 0 first). */
export interface KeychronHeFeatures {
  switchAxis: boolean;
  resetSingleKey: boolean;
  dkr: boolean;
  turbo: boolean;
  gamepadDisable: boolean;
  supportMechanical: boolean;
}

export interface KeychronHeVersionInfo {
  version: number;
  features: KeychronHeFeatures;
}

export interface KeychronProfilesInfo {
  /** Active profile slot. */
  current: number;
  total: number;
  /** Size in bytes of one profile buffer. */
  size: number;
  /** v4+ only: DKS slots the board supports. */
  dksCount: number | null;
  /** v4+ only: snap-tap slots the board supports. */
  snapTapCount: number | null;
  /** Millimetres per travel step. */
  unit: number;
}

/** What a key's four-byte (v1-4) / seven-byte (v5) slot says to do. */
export const KEYCHRON_ADVANCE_MODE = {
  none: 0,
  dks: 3,
  analog: 4,
  toggle: 5,
  dkr: 7,
  turbo: 8,
} as const;

export interface KeychronKeySlot {
  /** Raw 2-bit actuation mode. */
  mode: number;
  /** Actuation travel, in `unit` steps. */
  distance: number;
  /** Rapid-trigger press sensitivity, in `unit` steps. */
  advancePress: number;
  /** Rapid-trigger release sensitivity, in `unit` steps. */
  advanceRelease: number;
  /** One of KEYCHRON_ADVANCE_MODE (or an unknown raw value). */
  advanceMode: number;
  /** DKS / turbo slot index when `advanceMode` uses one. */
  index: number;
}

export interface KeychronDksSlot {
  index: number;
  /** Four trigger travels, in `unit` steps. */
  travel: readonly number[];
  /** Four 16-bit keycodes. */
  keycodes: readonly number[];
  /** Four packed action nibbles per keycode: [press, bottom, release, top]. */
  actions: readonly (readonly number[])[];
}

export interface KeychronSnapTapSlot {
  index: number;
  keys: readonly [{ row: number; col: number }, { row: number; col: number }];
  type: number;
}

export interface KeychronProfileBuffer {
  global: KeychronKeySlot;
  /** `keys[row][col]`. */
  keys: readonly (readonly KeychronKeySlot[])[];
  /** Occupied DKS slots (null entries are empty). v1+ layout differs by version. */
  dks: readonly (KeychronDksSlot | null)[];
  /** Occupied snap-tap slots; v4+ only. */
  snapTap: readonly KeychronSnapTapSlot[];
}

export interface KeychronTravelSetting {
  /** KEYCHRON_WORK_MODE: global 0, static 1, quickTrigger 2. */
  workMode: number;
  /** Actuation, in `unit` steps. */
  press?: number;
  /** Rapid-trigger press sensitivity, in `unit` steps. */
  sensitivePress?: number;
  /** Rapid-trigger release sensitivity; defaults to `sensitivePress`. */
  sensitiveRelease?: number;
  /** KEYCHRON_KEY_MODE: 0 writes the keys in `buffer`, 1 applies to every key. */
  keyMode: number;
  /** Per-key bytes (only sent when `keyMode` is 0). */
  buffer?: readonly number[];
}

export type KeychronCurve = readonly [
  readonly [number, number], readonly [number, number],
  readonly [number, number], readonly [number, number],
];

export interface KeychronAxisType {
  type: number;
  /** Maximum travel in millimetres. */
  maxMm: number;
}

export interface KeychronCalibrationState {
  /** Per-key flags, 8 per byte, low bit first. */
  keys: readonly boolean[];
  state: number;
}

const U8 = 0xff;

function frame(subcommand: number, ...args: number[]): Uint8Array<ArrayBuffer> {
  if (args.length > KEYCHRON_REPORT_SIZE - 2) throw new RangeError("Keychron HE command is too long.");
  const out = new Uint8Array(KEYCHRON_REPORT_SIZE);
  out[0] = KEYCHRON_HE_COMMAND;
  out[1] = subcommand;
  args.forEach((value, index) => {
    if (!Number.isInteger(value) || value < 0 || value > U8) throw new RangeError("Keychron HE argument must be a byte.");
    out[index + 2] = value;
  });
  return out;
}

function profile(slot: number): number {
  if (!Number.isInteger(slot) || slot < 0 || slot > U8) throw new RangeError("Invalid Keychron profile slot.");
  return slot;
}

function putWord(out: Uint8Array, at: number, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new RangeError("Keychron HE word out of range.");
  out[at] = value & U8;
  out[at + 1] = value >> 8;
}

export function isKeychronHeVersion(version: number): version is KeychronHeVersion {
  return version >= 1 && version <= 5 && Number.isInteger(version);
}

/** Key slot size in the profile buffer: 4 bytes up to v4, 7 from v5. */
export const keychronKeySlotSize = (version: KeychronHeVersion): number => (version >= 5 ? 7 : 4);
/** DKS slot size: 19 bytes up to v4, 21 from v5. */
export const keychronDksSlotSize = (version: KeychronHeVersion): number => (version >= 5 ? 21 : 19);
export const KEYCHRON_DKS_SLOTS = 20;
export const KEYCHRON_SNAP_TAP_SLOTS = 20;
const SNAP_TAP_SLOT_SIZE = 3;

export const keychronHeFrames = {
  version: () => frame(KEYCHRON_HE_SUBCOMMAND.getVersion),
  profilesInfo: () => frame(KEYCHRON_HE_SUBCOMMAND.getProfilesInfo),
  selectProfile: (slot: number) => frame(KEYCHRON_HE_SUBCOMMAND.selectProfile, profile(slot)),
  /**
   * Read a profile buffer from `offset`. A reply carries 26 payload bytes; the
   * name read in v1-4 still sends 30 in the length byte, as Launcher does.
   */
  readProfile(slot: number, offset: number, length: number) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 0xffff) throw new RangeError("Invalid profile offset.");
    if (!Number.isInteger(length) || length < 1 || length > 30) throw new RangeError("Profile reads carry 1-30 bytes.");
    return frame(KEYCHRON_HE_SUBCOMMAND.getProfileBuffer, profile(slot), offset & U8, offset >> 8, length);
  },
  saveProfile: (slot: number) => frame(KEYCHRON_HE_SUBCOMMAND.saveProfileBuffer, profile(slot)),
  clearProfile: (slot: number) => frame(KEYCHRON_HE_SUBCOMMAND.clearProfileBuffer, profile(slot)),
  /** Use `keychronProfileNameBytes`; Launcher follows a rename with `saveProfile`. */
  setProfileName(slot: number, chars: readonly number[], length: number) {
    return frame(KEYCHRON_HE_SUBCOMMAND.setProfileName, profile(slot), length, ...chars);
  },
  setTravel(version: KeychronHeVersion, slot: number, setting: KeychronTravelSetting): Uint8Array<ArrayBuffer> {
    const out = frame(KEYCHRON_HE_SUBCOMMAND.setTravel, profile(slot), setting.workMode);
    const press = setting.press ?? 0;
    const sensitivePress = setting.sensitivePress ?? 0;
    const sensitiveRelease = setting.sensitiveRelease ?? setting.sensitivePress ?? 0;
    let next: number;
    if (version >= 5) {
      putWord(out, 4, press);
      putWord(out, 6, sensitivePress);
      putWord(out, 8, sensitiveRelease);
      next = 10;
    } else {
      for (const [at, value] of [[4, press], [5, sensitivePress], [6, sensitiveRelease]] as const) {
        if (!Number.isInteger(value) || value < 0 || value > U8) throw new RangeError("Keychron v1-4 travel is one byte.");
        out[at] = value;
      }
      next = 7;
    }
    out[next] = setting.keyMode;
    if (setting.keyMode === 0) {
      const buffer = setting.buffer ?? [];
      if (next + 1 + buffer.length > KEYCHRON_REPORT_SIZE) throw new RangeError("Per-key buffer does not fit one report.");
      buffer.forEach((value, index) => { out[next + 1 + index] = value & U8; });
    }
    return out;
  },
  /** Turn one DKS/advanced-key slot off for the key at `row`,`col`. */
  removeAdvanceKey: (slot: number, row: number, col: number) =>
    frame(KEYCHRON_HE_SUBCOMMAND.setAdvanceMode, profile(slot), 0, row, col),
  setAdvanceKey(version: KeychronHeVersion, slot: number, key: {
    workMode?: number; row: number; col: number; position: number;
    distance: readonly [number, number, number, number];
    keycodes: readonly number[]; actions: readonly number[];
  }) {
    const out = frame(KEYCHRON_HE_SUBCOMMAND.setAdvanceMode, profile(slot), key.workMode || 1, key.row, key.col, key.position);
    // Launcher sends the four travels in the order [0, 3, 1, 2].
    const order = [0, 3, 1, 2] as const;
    let at = 7;
    for (const index of order) {
      const value = key.distance[index];
      if (version >= 5) { putWord(out, at, value); at += 2; } else { out[at++] = value & U8; }
    }
    key.keycodes.slice(0, 4).forEach((code, index) => putWord(out, at + 2 * index, code));
    at += 8;
    key.actions.forEach((value, index) => { out[at + index] = value & U8; });
    return out;
  },
  getCurve: () => frame(KEYCHRON_HE_SUBCOMMAND.getCurve),
  setCurve(curve: KeychronCurve) {
    return frame(KEYCHRON_HE_SUBCOMMAND.setCurve, ...curve.flat());
  },
  /** Live travel of the key at `row`,`col`. */
  realtimeTravel: (row: number, col: number) => frame(KEYCHRON_HE_SUBCOMMAND.getRealtimeTravel, row, col),
  calibrate: () => frame(KEYCHRON_HE_SUBCOMMAND.calibrate, KEYCHRON_CALIBRATE.start),
  stopCalibration: () => frame(KEYCHRON_HE_SUBCOMMAND.calibrate, KEYCHRON_CALIBRATE.stop),
  calibrationState: () => frame(KEYCHRON_HE_SUBCOMMAND.getCalibrateState),
  getAxisType: () => frame(KEYCHRON_HE_SUBCOMMAND.getAxisType),
  setAxisType: (type: number) => frame(KEYCHRON_HE_SUBCOMMAND.setAxisType, type),
  /** Snap-tap pair: `keys` are [col, row] pairs as Launcher sends them. */
  setSnapTap(slot: number, snap: { keys: readonly [readonly [number, number], readonly [number, number]]; index: number; wordMode: number }) {
    return frame(KEYCHRON_HE_SUBCOMMAND.setActOnAxis, profile(slot),
      snap.keys[0][0], snap.keys[0][1], snap.keys[1][0], snap.keys[1][1], snap.index, snap.wordMode);
  },
  getJoyKeyboard: () => frame(KEYCHRON_HE_SUBCOMMAND.getJoyKeyboard),
  /** Launcher packs three flags into one byte via its own bit order; pass the packed byte. */
  setJoyKeyboard: (packed: number) => frame(KEYCHRON_HE_SUBCOMMAND.setJoyKeyboard, packed),
  resetSingleKey: (slot: number, row: number, col: number) =>
    frame(KEYCHRON_HE_SUBCOMMAND.resetSingleKey, profile(slot), row, col),
} as const;

/** True when `report` is an answer to the given HE subcommand. */
export function isKeychronHeReply(report: Uint8Array, subcommand: KeychronHeSubcommand): boolean {
  return report.length >= 2 && report[0] === KEYCHRON_HE_COMMAND && report[1] === subcommand;
}

export function decodeKeychronHeVersion(report: Uint8Array): KeychronHeVersionInfo | null {
  if (!isKeychronHeReply(report, KEYCHRON_HE_SUBCOMMAND.getVersion) || report.length < 5) return null;
  const bits = report[4]!;
  return {
    version: report[2]!,
    features: {
      switchAxis: Boolean(bits & 1),
      resetSingleKey: Boolean(bits & 2),
      dkr: Boolean(bits & 4),
      turbo: Boolean(bits & 8),
      gamepadDisable: Boolean(bits & 16),
      supportMechanical: Boolean(bits & 32),
    },
  };
}

/** Millimetres per step for a v5 profile-info unit code (2 -> 0.01, 3 -> 0.001, else 0.1). */
export const keychronUnit = (code: number | undefined): number => (code === 2 ? 0.01 : code === 3 ? 0.001 : 0.1);

export function decodeKeychronProfilesInfo(report: Uint8Array, version: KeychronHeVersion): KeychronProfilesInfo | null {
  if (!isKeychronHeReply(report, KEYCHRON_HE_SUBCOMMAND.getProfilesInfo) || report.length < 6) return null;
  return {
    current: report[2]!,
    total: report[3]!,
    size: (report[5]! << 8) | report[4]!,
    dksCount: version >= 4 ? report[6]! : null,
    snapTapCount: version >= 4 ? report[7]! : null,
    unit: version >= 5 ? keychronUnit(report[8]) : 0.1,
  };
}

/**
 * Where a profile's name lives and how much to read: the last bytes of the
 * profile buffer. v1 starts 33 bytes from the end, later versions 32, and v5
 * reads 26 bytes where earlier versions read 30.
 */
export function keychronNameWindow(version: KeychronHeVersion, size: number): { offset: number; length: number } {
  return { offset: size - (version === 1 ? 33 : 32), length: version >= 5 ? 26 : 30 };
}

/** Decode a profile name from a read reply: bytes 6.. are big-endian UTF-16 units, zero pairs skipped. */
export function decodeKeychronProfileName(report: Uint8Array): string | null {
  if (!isKeychronHeReply(report, KEYCHRON_HE_SUBCOMMAND.getProfileBuffer)) return null;
  let name = "";
  for (let i = 6; i + 1 < KEYCHRON_REPORT_SIZE && i + 1 < report.length; i += 2) {
    if (report[i] === 0 && report[i + 1] === 0) continue;
    name += String.fromCharCode((report[i]! << 8) | report[i + 1]!);
  }
  return name;
}

/** Payload bytes of a profile-buffer read reply. */
export function keychronProfileChunk(report: Uint8Array): Uint8Array | null {
  return isKeychronHeReply(report, KEYCHRON_HE_SUBCOMMAND.getProfileBuffer) ? report.slice(6, 32) : null;
}

/** Reassemble a buffer from consecutive chunks, trimmed to `size`. */
export function joinKeychronProfile(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out.slice(0, size);
}

/** Read plan for a whole profile: (offset, length) pairs of up to 26 bytes. */
export function keychronProfileReadPlan(size: number): { offset: number; length: number }[] {
  const plan: { offset: number; length: number }[] = [];
  for (let offset = 0; offset < size; offset += 26) plan.push({ offset, length: Math.min(26, size - offset) });
  return plan;
}

function bits(value: bigint, low: number, width: number): number {
  return Number((value >> BigInt(low)) & ((1n << BigInt(width)) - 1n));
}

function littleEndian(bytes: Uint8Array, start: number, end: number): bigint {
  let value = 0n;
  for (let i = end - 1; i >= start; i--) value = (value << 8n) | BigInt(bytes[i]!);
  return value;
}

/** One key's slot. v1-4: 32 bits LE (mode 2, distance 6, press 6, release 6, advance 4, index 8). v5: 6 bytes LE of 14-bit fields, then the index byte. */
export function decodeKeychronKeySlot(version: KeychronHeVersion, slot: Uint8Array): KeychronKeySlot {
  if (version >= 5) {
    const word = littleEndian(slot, 0, 6);
    return {
      mode: bits(word, 0, 2), distance: bits(word, 2, 14), advancePress: bits(word, 16, 14),
      advanceRelease: bits(word, 30, 14), advanceMode: bits(word, 44, 4), index: slot[6]!,
    };
  }
  const word = littleEndian(slot, 0, 4);
  return {
    mode: bits(word, 0, 2), distance: bits(word, 2, 6), advancePress: bits(word, 8, 6),
    advanceRelease: bits(word, 14, 6), advanceMode: bits(word, 20, 4), index: bits(word, 24, 8),
  };
}

function decodeActions(a: number, b: number): number[] {
  return [a & 0xf, b & 0xf, b >> 4, a >> 4];
}

function decodeDksSlot(version: KeychronHeVersion, bytes: Uint8Array, index: number): KeychronDksSlot | null {
  const packed = version >= 5 ? 5 : 3;
  const word = littleEndian(bytes, 0, packed);
  if (word === 0n) return null;
  const travel = version >= 5
    ? [bits(word, 0, 10), bits(word, 20, 10), bits(word, 30, 10), bits(word, 10, 10)]
    : [bits(word, 0, 6), bits(word, 12, 6), bits(word, 18, 6), bits(word, 6, 6)];
  const keycodes = [0, 1, 2, 3].map((i) => bytes[packed + 2 * i]! | (bytes[packed + 2 * i + 1]! << 8));
  const actionStart = packed + 8;
  const actions = [0, 1, 2, 3].map((i) => decodeActions(bytes[actionStart + 2 * i]!, bytes[actionStart + 2 * i + 1]!));
  return { index, travel, keycodes, actions };
}

/** Decode the whole profile buffer for a board with `rows` x `cols` keys. */
export function decodeKeychronProfileBuffer(
  version: KeychronHeVersion, buffer: Uint8Array, rows: number, cols: number,
): KeychronProfileBuffer {
  const slot = keychronKeySlotSize(version);
  const keyBytes = slot * (rows * cols + 1);
  if (buffer.length < keyBytes) throw new RangeError("Profile buffer is shorter than its key matrix.");
  const keys = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => {
    const start = slot * (row * cols + col + 1);
    return decodeKeychronKeySlot(version, buffer.subarray(start, start + slot));
  }));
  const dksSize = keychronDksSlotSize(version);
  const dks: (KeychronDksSlot | null)[] = [];
  for (let i = 0; i < KEYCHRON_DKS_SLOTS; i++) {
    const start = keyBytes + dksSize * i;
    dks.push(start + dksSize <= buffer.length ? decodeDksSlot(version, buffer.subarray(start, start + dksSize), i) : null);
  }
  const snapTap: KeychronSnapTapSlot[] = [];
  if (version >= 4) {
    const snapStart = keyBytes + dksSize * KEYCHRON_DKS_SLOTS;
    for (let i = 0; i < KEYCHRON_SNAP_TAP_SLOTS; i++) {
      const start = snapStart + SNAP_TAP_SLOT_SIZE * i;
      if (start + SNAP_TAP_SLOT_SIZE > buffer.length) break;
      const [a, b, type] = [buffer[start]!, buffer[start + 1]!, buffer[start + 2]!];
      if (a === 0 && b === 0) continue;
      snapTap.push({ index: i, type, keys: [{ col: a >> 3, row: a & 7 }, { col: b >> 3, row: b & 7 }] });
    }
  }
  return {
    global: decodeKeychronKeySlot(version, buffer.subarray(0, slot)),
    keys, dks, snapTap,
  };
}

export function decodeKeychronRealtimeTravel(
  report: Uint8Array, version: KeychronHeVersion, row: number, col: number,
): number | null {
  if (!isKeychronHeReply(report, KEYCHRON_HE_SUBCOMMAND.getRealtimeTravel)) return null;
  // v1 and v2 answer with the bare distance in byte 2; v3 onward echo the key.
  if (version >= 3 && (report[3] !== row || report[4] !== col)) return null;
  if (version >= 5) return (report[6]! << 8) | report[5]!;
  return version >= 3 ? report[5]! : report[2]!;
}

export function decodeKeychronCurve(report: Uint8Array): KeychronCurve | null {
  if (!isKeychronHeReply(report, KEYCHRON_HE_SUBCOMMAND.getCurve) || report.length < 10) return null;
  return [[report[2]!, report[3]!], [report[4]!, report[5]!], [report[6]!, report[7]!], [report[8]!, report[9]!]];
}

export function decodeKeychronAxisType(report: Uint8Array, unit: number): KeychronAxisType | null {
  if (!isKeychronHeReply(report, KEYCHRON_HE_SUBCOMMAND.getAxisType) || report.length < 5) return null;
  return { type: report[2]!, maxMm: Number((((report[4]! << 8) + report[3]!) * unit).toFixed(2)) };
}

/** Calibration state: byte 3 is the state, bytes 4-21 are per-key flags. */
export function decodeKeychronCalibrationState(report: Uint8Array): KeychronCalibrationState | null {
  if (!isKeychronHeReply(report, KEYCHRON_HE_SUBCOMMAND.getCalibrateState) || report.length < 22) return null;
  const keys: boolean[] = [];
  for (const byte of report.slice(4, 22)) for (let bit = 0; bit < 8; bit++) keys.push(Boolean((byte >> bit) & 1));
  return { state: report[3]!, keys };
}

/** Write-style replies (`setTravel`, `saveProfile`, …) carry 0 in byte 2 on success. */
export function keychronHeAcknowledged(report: Uint8Array, subcommand: KeychronHeSubcommand): boolean {
  return isKeychronHeReply(report, subcommand) && report[2] === 0;
}

export * from "./products.js";
