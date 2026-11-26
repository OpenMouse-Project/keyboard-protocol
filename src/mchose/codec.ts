/**
 * MCHOSE magnetic keyboard protocol (the vendor's "glw" family), implemented
 * from the M HUB web configurator (https://www.mchose.com.cn, CZ_SHARED_DATA
 * bundle 2026-10) and checked against an Ace 68 Air III on firmware 116.
 * See docs/mchose-support.md.
 *
 * Every request and reply is one 64-byte report with report id 0 on the
 * vendor collection (usage page 0x0001, usage 0x0000):
 *
 *   [flag, command, 0, checksum, size, offsetLo, offsetHi, 0, data...]
 *
 * Requests use flag 0x55, replies 0xAA. The checksum is the low byte of the
 * sum of bytes 4 onwards (size, offset, reserved and data). A reply echoes
 * the command, size and offset; a write is acknowledged by echoing its frame.
 */
export const MCHOSE_REPORT_ID = 0;
export const MCHOSE_FRAME_SIZE = 64;
export const MCHOSE_HEADER_SIZE = 8;
/** Largest data field one frame carries. */
export const MCHOSE_MAX_CHUNK = MCHOSE_FRAME_SIZE - MCHOSE_HEADER_SIZE;
export const MCHOSE_REQUEST_FLAG = 0x55;
export const MCHOSE_REPLY_FLAG = 0xaa;

export const MCHOSE_COMMAND = {
  getInfo: 0x03,
  getBase: 0x04,
  getFuncConfig: 0x05,
  setFuncConfig: 0x06,
  setBase: 0x0e,
  getKeyTravel: 0xa0,
  setKeyTravel: 0xa1,
  getDefaultKeymap: 0x07,
  getKeymap: 0x08,
  setKeymap: 0x09,
  getKeyColors: 0x0a,
  setKeyColors: 0x0b,
  getMacros: 0x0c,
  setMacros: 0x0d,
  getDks: 0xa2,
  setDks: 0xa3,
  getModTap: 0xa4,
  setModTap: 0xa5,
  getToggle: 0xa6,
  setToggle: 0xa7,
  startCalibration: 0xa8,
  endCalibration: 0xa9,
  restartCalibration: 0xb1,
  /** One byte: a profile index, or 255 for the whole keyboard. */
  factoryReset: 0xee,
  getCustomData: 0xf1,
  setCustomData: 0xf2,
} as const;
export type MchoseCommand = (typeof MCHOSE_COMMAND)[keyof typeof MCHOSE_COMMAND];

/** On-board profiles; each has its own function config and key-travel table. */
export const MCHOSE_PROFILE_COUNT = 4;
export const MCHOSE_INFO_SIZE = 56;
export const MCHOSE_BASE_SIZE = 56;
/** Function config per profile, at offset `64 * profile`. */
export const MCHOSE_FUNC_CONFIG_SIZE = 64;
export const MCHOSE_KEY_RECORD_SIZE = 8;
export const MCHOSE_KEY_SLOTS = 128;
/** Key-travel table per profile, at offset `1024 * profile`. */
export const MCHOSE_KEY_TRAVEL_SIZE = MCHOSE_KEY_RECORD_SIZE * MCHOSE_KEY_SLOTS;

function assertByte(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new RangeError(`${what} must be a byte.`);
}

function assertWindow(offset: number, size: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset > 0xffff) throw new RangeError("MCHOSE offset must fit 16 bits.");
  if (!Number.isInteger(size) || size < 1 || size > MCHOSE_MAX_CHUNK) throw new RangeError(`MCHOSE chunk must be 1-${MCHOSE_MAX_CHUNK} bytes.`);
}

/** Low byte of the sum of bytes 4 onwards, over `size` data bytes. */
export function mchoseChecksum(frame: Uint8Array, size: number): number {
  let sum = 0;
  for (let index = 4; index < MCHOSE_HEADER_SIZE + size; index += 1) sum += frame[index] ?? 0;
  return sum & 0xff;
}

function encodeFrame(command: MchoseCommand, offset: number, size: number, data: readonly number[]): Uint8Array<ArrayBuffer> {
  if (!Object.values(MCHOSE_COMMAND).includes(command)) throw new RangeError("Unsupported MCHOSE command.");
  assertWindow(offset, size);
  data.forEach((byte) => assertByte(byte, "MCHOSE payload byte"));
  const frame = new Uint8Array(MCHOSE_FRAME_SIZE);
  frame[0] = MCHOSE_REQUEST_FLAG;
  frame[1] = command;
  frame[4] = size;
  frame[5] = offset & 0xff;
  frame[6] = offset >> 8;
  frame.set(data, MCHOSE_HEADER_SIZE);
  frame[3] = mchoseChecksum(frame, data.length);
  return frame;
}

/** A read of `size` bytes at `offset`; the request carries no data. */
export function encodeMchoseRead(command: MchoseCommand, offset: number, size: number): Uint8Array<ArrayBuffer> {
  return encodeFrame(command, offset, size, []);
}

/** A write of `data` (1-56 bytes) at `offset`. */
export function encodeMchoseWrite(command: MchoseCommand, offset: number, data: readonly number[]): Uint8Array<ArrayBuffer> {
  return encodeFrame(command, offset, data.length, data);
}

export interface MchoseReply {
  command: number;
  size: number;
  offset: number;
  data: Uint8Array;
}

/** Decode one reply; `null` when the flag, size or checksum is wrong. */
export function decodeMchoseReply(frame: Uint8Array): MchoseReply | null {
  if (frame.length < MCHOSE_HEADER_SIZE || frame[0] !== MCHOSE_REPLY_FLAG) return null;
  const size = frame[4] ?? 0;
  if (size > MCHOSE_MAX_CHUNK || frame.length < MCHOSE_HEADER_SIZE + size) return null;
  if (frame[3] !== mchoseChecksum(frame, size)) return null;
  return {
    command: frame[1] ?? 0,
    size,
    offset: (frame[5] ?? 0) | ((frame[6] ?? 0) << 8),
    data: frame.slice(MCHOSE_HEADER_SIZE, MCHOSE_HEADER_SIZE + size),
  };
}

/**
 * True when `reply` answers `request`: same command and offset, and no more
 * data than was asked for. The info reply is shorter than the 56 bytes read.
 */
export function mchoseReplyMatches(request: Uint8Array, reply: MchoseReply): boolean {
  return reply.command === request[1] && reply.size <= (request[4] ?? 0)
    && reply.offset === ((request[5] ?? 0) | ((request[6] ?? 0) << 8));
}

/** Read frames for `size` bytes at `offset`, 56 at a time; the last one is shorter. */
export function mchoseReadFrames(command: MchoseCommand, offset: number, size: number): Uint8Array<ArrayBuffer>[] {
  const frames: Uint8Array<ArrayBuffer>[] = [];
  for (let at = 0; at < size; at += MCHOSE_MAX_CHUNK) {
    frames.push(encodeMchoseRead(command, offset + at, Math.min(MCHOSE_MAX_CHUNK, size - at)));
  }
  return frames;
}

/**
 * Write frames for `data` at `offset`. Like the vendor app, a short tail is
 * sent as a full 56-byte frame ending at the end of `data`, so every frame
 * but a lone short one is full size.
 */
export function mchoseWriteFrames(command: MchoseCommand, offset: number, data: readonly number[]): Uint8Array<ArrayBuffer>[] {
  if (data.length === 0) throw new RangeError("MCHOSE write needs data.");
  const frames: Uint8Array<ArrayBuffer>[] = [];
  for (let at = 0; at < data.length; at += MCHOSE_MAX_CHUNK) {
    const start = at > 0 && data.length - at < MCHOSE_MAX_CHUNK ? data.length - MCHOSE_MAX_CHUNK : at;
    frames.push(encodeMchoseWrite(command, offset + start, data.slice(start, start + MCHOSE_MAX_CHUNK)));
  }
  return frames;
}

/**
 * Write only the windows of `next` that differ from `current`. Windows start
 * on whole records (`record` bytes each, at most 56 bytes). A window that
 * would run past the end is pulled back to end at the end of the table, the
 * way the vendor app sends its last frame, even when that splits a record:
 * the bytes written are the table's own, so a split record stays whole.
 * Returns no frames when nothing changed.
 */
export function mchoseChangedWriteFrames(
  command: MchoseCommand,
  offset: number,
  current: readonly number[],
  next: readonly number[],
  record = 1,
): Uint8Array<ArrayBuffer>[] {
  if (current.length !== next.length) throw new RangeError("MCHOSE tables differ in size.");
  const window = Math.floor(MCHOSE_MAX_CHUNK / record) * record;
  if (window < 1) throw new RangeError("MCHOSE records must fit in one frame.");
  // Pull the last window back to end at the table's end, even when that splits a record, as the vendor app does.
  const lastFull = next.length - window;
  const starts = new Set<number>();
  next.forEach((byte, index) => {
    if (byte === current[index]) return;
    const aligned = Math.floor(index / window) * window;
    starts.add(aligned > lastFull && lastFull >= 0 ? lastFull : aligned);
  });
  return [...starts].sort((a, b) => a - b)
    .map((start) => encodeMchoseWrite(command, offset + start, next.slice(start, start + window)));
}

export interface MchoseInfo {
  /** Firmware version as the vendor app shows it (hex digits of a u16, e.g. "116"). */
  firmwareVersion: string;
  /** Build timestamp string, when the firmware reports one. */
  buildDate: string | null;
  /** Controller name, when the firmware reports one (e.g. "GL8KH-PRO"). */
  chip: string | null;
}

function ascii(bytes: Uint8Array): string | null {
  const end = bytes.indexOf(0);
  const slice = end === -1 ? bytes : bytes.subarray(0, end);
  if (slice.length === 0 || slice.some((byte) => byte < 0x20 || byte > 0x7e)) return null;
  return String.fromCharCode(...slice).replace(/\s+/g, " ").trim() || null;
}

/** Command 0x03: firmware version, then the build date and controller as ASCII. */
export function decodeMchoseInfo(data: Uint8Array): MchoseInfo | null {
  if (data.length < 2) return null;
  const version = (data[0] ?? 0) | ((data[1] ?? 0) << 8);
  return {
    firmwareVersion: version.toString(16),
    buildDate: data.length >= 22 ? ascii(data.subarray(2, 22)) : null,
    chip: data.length > 22 ? ascii(data.subarray(22)) : null,
  };
}

export interface MchoseBase {
  /** Active profile (0-based). */
  activeProfile: number;
  /** Profiles the user has enabled. */
  profileCount: number;
  /** Profile slots in their display order. */
  order: readonly number[];
}

/**
 * Command 0x04: `[orderPosition, count, order[0..3], ...]`. The active profile
 * is `order[orderPosition]`. Firmware without a valid order list reports the
 * active profile directly in byte 0.
 */
export function decodeMchoseBase(data: Uint8Array): MchoseBase | null {
  if (data.length < 2 + MCHOSE_PROFILE_COUNT) return null;
  const order = Array.from(data.subarray(2, 2 + MCHOSE_PROFILE_COUNT));
  const ordered = [...order].sort((a, b) => a - b).every((value, index) => value === index);
  const position = data[0] ?? 0;
  const count = data[1] ?? 0;
  if (position >= MCHOSE_PROFILE_COUNT) return null;
  if (ordered && count >= 1 && count <= MCHOSE_PROFILE_COUNT) {
    if (position >= count) return null;
    return { activeProfile: order[position]!, profileCount: count, order };
  }
  return { activeProfile: position, profileCount: MCHOSE_PROFILE_COUNT, order: [0, 1, 2, 3] };
}

/** `data` with `profile` made active. Throws when it is not one of the enabled profiles. */
export function mchoseBaseWithActiveProfile(data: Uint8Array, profile: number): number[] {
  const base = decodeMchoseBase(data);
  if (!base) throw new Error("The MCHOSE keyboard reported an unreadable profile table.");
  const position = base.order.indexOf(profile);
  if (!Number.isInteger(profile) || position < 0 || position >= base.profileCount) {
    throw new RangeError(`Profile ${profile + 1} is not one of this keyboard's ${base.profileCount} enabled profiles.`);
  }
  const next = Array.from(data);
  next[0] = position;
  return next;
}

/** Wire value of the polling-rate nibble -> Hz, from the vendor app's options. */
export const MCHOSE_POLLING_RATES: Readonly<Record<number, number>> = {
  0: 16000,
  1: 8000,
  2: 4000,
  3: 2000,
  4: 1000,
  5: 32000,
};

export function mchosePollingHz(raw: number): number | null {
  return MCHOSE_POLLING_RATES[raw] ?? null;
}

export function mchosePollingRaw(hz: number): number | null {
  const entry = Object.entries(MCHOSE_POLLING_RATES).find(([, value]) => value === hz);
  return entry ? Number(entry[0]) : null;
}

/** The performance fields of one profile's 64-byte function config. Lighting bytes are left alone. */
export interface MchosePerformance {
  /** Byte 1 low nibble: `4 * profile` for Windows, `+ 2` for Mac layers. */
  layerMode: number;
  pollingRaw: number;
  pollingHz: number | null;
  /** Byte 4 high nibble: the vendor's "tick rate" (key scan rate) option. */
  scanRateRaw: number;
  lockWin: boolean;
  lockAltTab: boolean;
  lockAltF4: boolean;
  /** "Berserk" mode: lowers the minimum rapid-trigger distance. */
  tachyonMode: boolean;
  bottomRapidTrigger: boolean;
  debounceLevel: number;
  sleepTime: number;
}

export function decodeMchosePerformance(config: Uint8Array): MchosePerformance | null {
  if (config.length < MCHOSE_FUNC_CONFIG_SIZE) return null;
  const at = (index: number): number => config[index] ?? 0;
  return {
    layerMode: at(1) & 0x0f,
    pollingRaw: at(4) & 0x0f,
    pollingHz: mchosePollingHz(at(4) & 0x0f),
    scanRateRaw: at(4) >> 4,
    lockWin: (at(6) & 1) === 1,
    lockAltTab: ((at(6) >> 1) & 1) === 1,
    lockAltF4: ((at(6) >> 2) & 1) === 1,
    tachyonMode: (at(7) & 1) === 1,
    bottomRapidTrigger: ((at(7) >> 1) & 1) === 1,
    debounceLevel: (at(7) >> 5) & 7,
    sleepTime: at(35),
  };
}

/** `config` with a new polling rate; every other byte is kept. */
export function mchoseConfigWithPollingRate(config: Uint8Array, hz: number): number[] {
  const raw = mchosePollingRaw(hz);
  if (raw === null) throw new RangeError(`${hz} Hz is not an MCHOSE polling rate.`);
  if (config.length !== MCHOSE_FUNC_CONFIG_SIZE) throw new RangeError("MCHOSE function config must be 64 bytes.");
  const next = Array.from(config);
  next[4] = (next[4]! & 0xf0) | raw;
  return next;
}

/** Settings in the function config besides polling rate and lighting. */
export interface MchoseSettings {
  /** Mac layer (the vendor's Mac mode); turning it on also releases the Win lock, as the vendor app does. */
  macMode: boolean;
  lockWin: boolean;
  lockAltTab: boolean;
  lockAltF4: boolean;
  /** Raw scan-rate nibble: 0 1 kHz, 1 2 kHz, 2 4 kHz, 3 8 kHz. */
  scanRateRaw: number;
  /** "Berserk" mode: rapid trigger down to 1 step. */
  tachyonMode: boolean;
  /** The vendor's "stability mode". */
  bottomRapidTrigger: boolean;
  /** The vendor's "auto check" (travel self-check). */
  travelCheck: boolean;
  /** Debounce optimisation; the vendor app writes level 7 to turn it on. */
  debounce: boolean;
  /** RT smart level 1-15, 0 for off. */
  rtSmart: number;
  /** Sleep delay in 30-second steps. */
  sleepTime: number;
  sleepEnabled: boolean;
}

export const MCHOSE_SCAN_RATES_HZ: readonly number[] = [1000, 2000, 4000, 8000];
export const MCHOSE_RT_SMART_RANGE = { min: 1, max: 15 } as const;

export function decodeMchoseSettings(config: ArrayLike<number>): MchoseSettings {
  const at = (index: number): number => config[index] ?? 0;
  return {
    macMode: (at(1) & 0x0f) % 4 >= 2,
    lockWin: (at(6) & 1) === 1,
    lockAltTab: ((at(6) >> 1) & 1) === 1,
    lockAltF4: ((at(6) >> 2) & 1) === 1,
    scanRateRaw: at(4) >> 4,
    tachyonMode: (at(7) & 1) === 1,
    bottomRapidTrigger: ((at(7) >> 1) & 1) === 1,
    travelCheck: ((at(7) >> 2) & 1) === 1,
    debounce: ((at(7) >> 5) & 7) > 0,
    rtSmart: at(20),
    sleepTime: at(35),
    sleepEnabled: at(36) !== 0,
  };
}

/** `config` (of `profile`) with new settings; bits the settings do not cover are kept. */
export function mchoseConfigWithSettings(config: ArrayLike<number>, profile: number, settings: MchoseSettings): number[] {
  if (config.length !== MCHOSE_FUNC_CONFIG_SIZE) throw new RangeError("MCHOSE function config must be 64 bytes.");
  if (!Number.isInteger(settings.scanRateRaw) || settings.scanRateRaw < 0 || settings.scanRateRaw > 3) throw new RangeError("Scan rate must be 0-3.");
  if (!Number.isInteger(settings.rtSmart) || settings.rtSmart < 0 || settings.rtSmart > MCHOSE_RT_SMART_RANGE.max) throw new RangeError("RT smart must be 0-15.");
  if (!Number.isInteger(settings.sleepTime) || settings.sleepTime < 0 || settings.sleepTime > 0xff) throw new RangeError("Sleep time must be a byte.");
  const next = Array.from(config);
  const lockWin = settings.macMode ? false : settings.lockWin;
  next[1] = (next[1]! & 0xf0) | ((4 * profile + (settings.macMode ? 2 : 0)) & 0x0f);
  next[4] = (next[4]! & 0x0f) | (settings.scanRateRaw << 4);
  next[6] = (next[6]! & ~7) | (settings.lockAltF4 ? 4 : 0) | (settings.lockAltTab ? 2 : 0) | (lockWin ? 1 : 0);
  // A switch that did not change keeps its raw value (a debounce level, a non-1 "on").
  const debounceBits = ((next[7]! >> 5) & 7) > 0 === settings.debounce ? next[7]! & 0xe0 : settings.debounce ? 7 << 5 : 0;
  next[7] = (next[7]! & ~0xe7) | debounceBits | (settings.travelCheck ? 4 : 0)
    | (settings.bottomRapidTrigger ? 2 : 0) | (settings.tachyonMode ? 1 : 0);
  next[20] = settings.rtSmart;
  next[35] = settings.sleepTime;
  if ((next[36] !== 0) !== settings.sleepEnabled) next[36] = settings.sleepEnabled ? 1 : 0;
  return next;
}

/** `config` with the Windows-key lock set; every other byte is kept. */
export function mchoseConfigWithWinLock(config: Uint8Array, locked: boolean): number[] {
  if (config.length !== MCHOSE_FUNC_CONFIG_SIZE) throw new RangeError("MCHOSE function config must be 64 bytes.");
  const next = Array.from(config);
  next[6] = (next[6]! & ~1) | (locked ? 1 : 0);
  return next;
}

/** `config` with the keyboard's debug mode on or off (byte 7, bit 3). */
export function mchoseConfigWithDebugMode(config: Uint8Array, on: boolean): number[] {
  if (config.length !== MCHOSE_FUNC_CONFIG_SIZE) throw new RangeError("MCHOSE function config must be 64 bytes.");
  const next = Array.from(config);
  next[7] = (next[7]! & ~8) | (on ? 8 : 0);
  return next;
}

/** First byte of the report the keyboard sends for a moving key while debug mode is on. */
export const MCHOSE_KEY_REPORT_FLAG = 0xa0;

/**
 * A key report: the key's factory action (which identifies it), how far it
 * is pressed (0.01 mm; the vendor app treats a key as pressed above 10), and
 * its calibration: a key needs two full presses, and after the first one the
 * keyboard flashes it blue until the second.
 */
export interface MchoseKeyReport {
  type: number;
  code1: number;
  code2: number;
  travel: number;
  calibration: "none" | "pending" | "done";
}

export function decodeMchoseKeyReport(frame: ArrayLike<number>): MchoseKeyReport | null {
  if (frame.length < 11 || frame[0] !== MCHOSE_KEY_REPORT_FLAG) return null;
  return {
    type: frame[1]!,
    code1: frame[2]!,
    code2: frame[3]!,
    travel: (frame[6]! << 8) | frame[7]!,
    // 0 not calibrated, 1 after the first press, 0xFF calibrated.
    calibration: frame[10] === 0xff ? "done" : frame[10] === 0 ? "none" : "pending",
  };
}

/**
 * Custom data area: 1024 bytes per profile (read 0xF1, write 0xF2) where the
 * vendor app keeps JSON. Profile names live in profile 0's area at 336-615
 * as a JSON array, padded with 0xFF.
 */
export const MCHOSE_CUSTOM_AREA_SIZE = 1024;
export const MCHOSE_PROFILE_NAMES_OFFSET = 336;
export const MCHOSE_PROFILE_NAMES_SIZE = 280;

export function decodeMchoseJson(bytes: ArrayLike<number>): unknown {
  const raw = Array.from(bytes);
  const end = raw.findIndex((byte) => byte === 0xff || byte === 0);
  const text = new TextDecoder().decode(Uint8Array.from(end === -1 ? raw : raw.slice(0, end)));
  try { return JSON.parse(text); } catch { return null; }
}

/** `value` as JSON padded with 0xFF to `size` bytes. */
export function encodeMchoseJson(value: unknown, size: number): number[] {
  const text = Array.from(new TextEncoder().encode(JSON.stringify(value)));
  if (text.length >= size) throw new RangeError(`JSON must fit in ${size - 1} bytes.`);
  return [...text, ...new Array<number>(size - text.length).fill(0xff)];
}

/** Profile names by slot, exactly as stored; `null` where none is stored. */
export function decodeMchoseProfileNames(bytes: ArrayLike<number>): (string | null)[] {
  const names = decodeMchoseJson(bytes);
  const list = Array.isArray(names) ? names : [];
  return Array.from({ length: MCHOSE_PROFILE_COUNT }, (_, slot) => {
    const name = list[slot];
    return typeof name === "string" && name !== "" ? name : null;
  });
}

/**
 * A readable profile name, or null where the slot has no name of the user's
 * own. The vendor app stores some names as codes: `EQ<official@-10:0>QE`
 * points into its online preset library (nothing to show here),
 * `i18n<defaultOnboard>3` is its default for an unnamed slot, and
 * `lang<...>` holds a name in several languages, of which English is shown.
 */
export function mchoseDisplayProfileName(name: string | null): string | null {
  if (name === null || /^EQ<.*>QE$/.test(name) || /^i18n<defaultOnboard>\d*$/.test(name)) return null;
  const multi = /^lang<([\s\S]*)>$/.exec(name);
  if (!multi) return name;
  const body = multi[1]!;
  let english: unknown;
  if (body.startsWith("{")) {
    try {
      const names = JSON.parse(body) as Record<string, unknown>;
      english = names.en ?? names[typeof names.fallback === "string" ? names.fallback : "en"];
    } catch { /* fall through to the plain list */ }
  }
  // The plain form lists the languages in the vendor app's order, Chinese then English.
  if (typeof english !== "string") english = body.split(",")[1] ?? body.split(",")[0];
  return typeof english === "string" && english.trim() !== "" ? english.trim() : null;
}

/** Key mode values the vendor app writes; the firmware may hold others. */
export const MCHOSE_KEY_MODE = { normal: 0, rapidTrigger: 1 } as const;

/**
 * One 8-byte key-travel record. Distances are the firmware's own steps:
 * actuation and dead zones are 0.01 mm; rapid-trigger steps depend on the
 * key's precision (see `mchoseRapidTriggerStep`).
 */
export interface MchoseKeyTravel {
  /** Byte 0 high nibble, kept as read (0xA on every captured key). */
  tag: number;
  switchType: number;
  keyMode: number;
  priority: number;
  actuation: number;
  pressPrecision: number;
  releasePrecision: number;
  rapidTriggerPress: number;
  rapidTriggerRelease: number;
  pressDeadzone: number;
  releaseDeadzone: number;
  /** Byte 3 bits the vendor app never sets (5-7), kept as read. */
  spare: number;
}

export function decodeMchoseKeyTravel(record: ArrayLike<number>): MchoseKeyTravel {
  if (record.length < MCHOSE_KEY_RECORD_SIZE) throw new RangeError("MCHOSE key record must be 8 bytes.");
  const at = (index: number): number => record[index] ?? 0;
  return {
    tag: at(0) >> 4,
    switchType: at(0) & 0x0f,
    keyMode: at(1) & 0x0f,
    priority: at(1) >> 4,
    actuation: (at(2) | ((at(3) & 1) << 8)) + 1,
    pressPrecision: (at(3) >> 3) & 3,
    releasePrecision: (at(3) >> 1) & 3,
    rapidTriggerPress: (at(4) | ((at(5) & 1) << 8)) + 1,
    rapidTriggerRelease: (at(6) | ((at(7) & 1) << 8)) + 1,
    pressDeadzone: at(5) >> 1,
    releaseDeadzone: at(7) >> 1,
    spare: at(3) & 0xe0,
  };
}

function nineBit(value: number, what: string): [number, number] {
  if (!Number.isInteger(value) || value < 1 || value > 512) throw new RangeError(`${what} must be 1-512 steps.`);
  return [(value - 1) & 0xff, (value - 1) >> 8];
}

function sevenBit(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 127) throw new RangeError(`${what} must be 0-127 steps.`);
  return value << 1;
}

export function encodeMchoseKeyTravel(key: MchoseKeyTravel): number[] {
  const [actLo, actHi] = nineBit(key.actuation, "Actuation");
  const [pressLo, pressHi] = nineBit(key.rapidTriggerPress, "Rapid-trigger press");
  const [releaseLo, releaseHi] = nineBit(key.rapidTriggerRelease, "Rapid-trigger release");
  return [
    ((key.tag & 0x0f) << 4) | (key.switchType & 0x0f),
    ((key.priority & 0x0f) << 4) | (key.keyMode & 0x0f),
    actLo,
    (key.spare & 0xe0) | ((key.pressPrecision & 3) << 3) | ((key.releasePrecision & 3) << 1) | actHi,
    pressLo,
    sevenBit(key.pressDeadzone, "Press dead zone") | pressHi,
    releaseLo,
    sevenBit(key.releaseDeadzone, "Release dead zone") | releaseHi,
  ];
}

export function decodeMchoseKeyTravelTable(table: ArrayLike<number>): MchoseKeyTravel[] {
  if (table.length !== MCHOSE_KEY_TRAVEL_SIZE) throw new RangeError("MCHOSE key-travel table must be 1024 bytes.");
  const keys: MchoseKeyTravel[] = [];
  for (let slot = 0; slot < MCHOSE_KEY_SLOTS; slot += 1) {
    keys.push(decodeMchoseKeyTravel(Array.prototype.slice.call(table, slot * 8, slot * 8 + 8) as number[]));
  }
  return keys;
}

/**
 * Travel limits from the vendor app for the Ace 68 Air: every switch it
 * offers has 3.4 mm of travel, actuation runs from 0.10 mm, dead zones up
 * to 0.50 mm, and rapid trigger from 2 steps.
 */
export const MCHOSE_MAX_TRAVEL_MM = 3.4;
export const MCHOSE_ACTUATION_RANGE = { min: 10, max: 340 } as const;
export const MCHOSE_DEADZONE_RANGE = { min: 0, max: 50 } as const;
export const MCHOSE_TRAVEL_STEP_MM = 0.01;

/** Rapid-trigger precision values: step size and limits in firmware steps. */
export const MCHOSE_RT_PRECISION: Readonly<Record<number, { stepMm: number; min: number; max: number }>> = {
  0: { stepMm: 0.01, min: 2, max: 340 },
  1: { stepMm: 0.005, min: 2, max: 500 },
  2: { stepMm: 0.001, min: 2, max: 500 },
};

export function mchoseRapidTriggerStep(precision: number): { stepMm: number; min: number; max: number } {
  return MCHOSE_RT_PRECISION[precision] ?? MCHOSE_RT_PRECISION[0]!;
}

export function mchoseStepsToMm(steps: number, stepMm = MCHOSE_TRAVEL_STEP_MM): number {
  return Math.round(steps * stepMm * 1000) / 1000;
}

export function mchoseMmToSteps(mm: number, stepMm = MCHOSE_TRAVEL_STEP_MM): number {
  return Math.round(mm / stepMm);
}

/** A partial key edit in firmware steps; omitted fields keep their value. */
export interface MchoseKeyTravelUpdate {
  index: number;
  actuation?: number;
  rapidTrigger?: boolean;
  rapidTriggerPress?: number;
  rapidTriggerRelease?: number;
  pressDeadzone?: number;
  releaseDeadzone?: number;
  /**
   * Rapid-trigger precision for both directions (0 0.01 mm, 1 0.005 mm,
   * 2 0.001 mm). The key's current rapid-trigger distances are carried over
   * in millimetres, clamped to the new precision's range.
   */
  precision?: number;
  /** Press-only and release-only precision, as the vendor app sets them; they win over `precision`. */
  pressPrecision?: number;
  releasePrecision?: number;
  /** Switch type, an index into the model's switch list. */
  switchType?: number;
  /** Travel priority nibble; SOCD pairs keep their rule here. */
  priority?: number;
}

/** One group of keys in a travel preset, in millimetres. */
export interface MchoseTravelPresetGroup {
  actuationMm: number;
  rapidTrigger: boolean;
  rapidTriggerMm: number;
  deadzoneMm: number;
}

/**
 * The vendor app's travel presets. `special` applies to the keys `keys`
 * names (by HID usage) and `rest` to every other key. Presets also turn
 * berserk mode off; switch types are left as they are.
 */
export interface MchoseTravelPreset {
  id: "beginner" | "fps" | "extreme" | "office" | "moba" | "fpsBalanced";
  keys: readonly number[];
  special: MchoseTravelPresetGroup | null;
  rest: MchoseTravelPresetGroup;
}

const WASD = [0x1a, 0x04, 0x16, 0x07];
const group = (actuationMm: number, rapidTrigger: boolean, rapidTriggerMm: number, deadzoneMm: number): MchoseTravelPresetGroup =>
  ({ actuationMm, rapidTrigger, rapidTriggerMm, deadzoneMm });

export const MCHOSE_TRAVEL_PRESETS: readonly MchoseTravelPreset[] = [
  { id: "beginner", keys: [], special: null, rest: group(1.5, false, 1.5, 0.15) },
  { id: "fps", keys: WASD, special: group(0.1, true, 0.1, 0), rest: group(1.5, true, 1.5, 0.15) },
  { id: "extreme", keys: WASD, special: group(0.1, true, 0.04, 0), rest: group(1.5, true, 1.5, 0.15) },
  { id: "office", keys: [0x39], special: group(2.5, false, 1.5, 0.15), rest: group(2, false, 1.5, 0.15) },
  { id: "moba", keys: [0x2c], special: group(1.8, true, 0.8, 0.15), rest: group(1.2, true, 0.8, 0.15) },
  { id: "fpsBalanced", keys: WASD, special: group(1, true, 0.1, 0.15), rest: group(1.5, true, 0.5, 0.15) },
];

/** Key-travel updates for a preset, at 0.01 mm precision, for the given `[index, usage]` keys. */
export function mchoseTravelPresetUpdates(preset: MchoseTravelPreset, keys: readonly (readonly [index: number, usage: number])[]): MchoseKeyTravelUpdate[] {
  const steps = (mm: number): number => Math.round(mm * 100);
  return keys.map(([index, usage]) => {
    const values = preset.special && preset.keys.includes(usage) ? preset.special : preset.rest;
    return {
      index,
      precision: 0,
      actuation: steps(values.actuationMm),
      rapidTrigger: values.rapidTrigger,
      rapidTriggerPress: steps(values.rapidTriggerMm),
      rapidTriggerRelease: steps(values.rapidTriggerMm),
      pressDeadzone: steps(values.deadzoneMm),
      releaseDeadzone: steps(values.deadzoneMm),
    };
  });
}

/** Switch types the vendor app offers for the Ace 68 Air III, by value. */
export const MCHOSE_ACE68_SWITCHES: readonly { value: number; name: string }[] = [
  { value: 0, name: "Default" },
  { value: 1, name: "Taishan Magnetic Switch GT" },
  { value: 2, name: "Kailh Magnetic God Switch" },
];

function assertRange(value: number, range: { min: number; max: number }, what: string): void {
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw new RangeError(`${what} must be ${range.min}-${range.max} steps.`);
  }
}

/** Apply one edit to a record, checking each new value against the vendor app's limits. */
export function applyMchoseKeyTravelUpdate(key: MchoseKeyTravel, update: MchoseKeyTravelUpdate): MchoseKeyTravel {
  const next = { ...key };
  if (update.switchType !== undefined) {
    if (!Number.isInteger(update.switchType) || update.switchType < 0 || update.switchType > 15) throw new RangeError("Switch type must be 0-15.");
    next.switchType = update.switchType;
  }
  if (update.priority !== undefined) {
    if (!Number.isInteger(update.priority) || update.priority < 0 || update.priority > 15) throw new RangeError("Priority must be 0-15.");
    next.priority = update.priority;
  }
  const pressPrecision = update.pressPrecision ?? update.precision;
  const releasePrecision = update.releasePrecision ?? update.precision;
  // A new precision carries the distance over in millimetres, clamped to its range.
  const carry = (steps: number, from: number, to: number): number => {
    const target = MCHOSE_RT_PRECISION[to];
    if (!target || !Number.isInteger(to)) throw new RangeError("Precision must be 0, 1 or 2.");
    const mm = steps * mchoseRapidTriggerStep(from).stepMm;
    return Math.min(target.max, Math.max(target.min, Math.round(mm / target.stepMm)));
  };
  if (pressPrecision !== undefined) {
    next.rapidTriggerPress = carry(key.rapidTriggerPress, key.pressPrecision, pressPrecision);
    next.pressPrecision = pressPrecision;
  }
  if (releasePrecision !== undefined) {
    next.rapidTriggerRelease = carry(key.rapidTriggerRelease, key.releasePrecision, releasePrecision);
    next.releasePrecision = releasePrecision;
  }
  if (update.actuation !== undefined) {
    assertRange(update.actuation, MCHOSE_ACTUATION_RANGE, "Actuation");
    next.actuation = update.actuation;
  }
  if (update.rapidTrigger !== undefined) next.keyMode = update.rapidTrigger ? MCHOSE_KEY_MODE.rapidTrigger : MCHOSE_KEY_MODE.normal;
  if (update.rapidTriggerPress !== undefined) {
    assertRange(update.rapidTriggerPress, mchoseRapidTriggerStep(next.pressPrecision), "Rapid-trigger press");
    next.rapidTriggerPress = update.rapidTriggerPress;
  }
  if (update.rapidTriggerRelease !== undefined) {
    assertRange(update.rapidTriggerRelease, mchoseRapidTriggerStep(next.releasePrecision), "Rapid-trigger release");
    next.rapidTriggerRelease = update.rapidTriggerRelease;
  }
  if (update.pressDeadzone !== undefined) {
    assertRange(update.pressDeadzone, MCHOSE_DEADZONE_RANGE, "Press dead zone");
    next.pressDeadzone = update.pressDeadzone;
  }
  if (update.releaseDeadzone !== undefined) {
    assertRange(update.releaseDeadzone, MCHOSE_DEADZONE_RANGE, "Release dead zone");
    next.releaseDeadzone = update.releaseDeadzone;
  }
  return next;
}

/** Everything the driver reads for one connection. */
export interface MchoseKeyboardState {
  productId: number;
  verified: boolean;
  info: MchoseInfo;
  base: MchoseBase | null;
  /** Performance of the active profile. */
  performance: MchosePerformance | null;
  settings?: MchoseSettings | null;
  lighting?: import("./lighting.ts").MchoseLighting | null;
  profileNames?: readonly (string | null)[] | null;
  /** The layout with matrix slots from this keyboard's default keymap. */
  layout?: readonly import("./layout.ts").MchoseLayoutKey[] | null;
  /** Key-travel records of the active profile, indexed by matrix slot (128). */
  travel: readonly MchoseKeyTravel[] | null;
}
