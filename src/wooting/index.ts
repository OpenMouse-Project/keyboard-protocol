/**
 * Wooting analog keyboard vendor HID protocol — transport-independent codec.
 *
 * Wire mechanics mirror the official Wooting RGB SDK (`src/wooting-usb.c`,
 * `wooting_usb_send_feature_buff`) and the community references below.
 * Commands are 8-byte HID *feature* reports:
 *
 *   [reportIndex, magic0, magic1, commandId, param3, param2, param1, param0]
 *
 * where `magic0`/`magic1` are `0xD0`/`0xDA` on single-report (Standard)
 * devices and `0xD1`/`0xDA` on multi-report (ARM) devices, and `reportIndex`
 * (0 or 1) matches. Note the SDK writes the four parameters in reverse order
 * (param3 first). The response is read back as an *input* report; its layout is
 * command-specific.
 *
 * References:
 * - Wooting RGB SDK `wooting-usb.c` / `wooting-usb.h` (command framing,
 *   `WOOTING_DEVICE_LAYOUT` enum).
 * - `d0da` project's `d0da_feature.py` (D0DA command table, cross-checked).
 * - wootswitch `docs/hid-protocol.md` (full 0–59 command table, ARM vs
 *   Standard variants, response header + status byte, profile-slot placement,
 *   profile-switch sequence, ARM profile-index quirk). Confirmed against a
 *   60HE+ (ARM, PID `0x1320`, config page `0xFF55`).
 * - PastaJ36 "Wooting USB config protocol" gist (original 8-byte feature /
 *   128-byte report description).
 *
 * Hardware-confirmed on a Wooting 60HE+ (VID `0x31E3`, PID `0x1322`):
 * single-report v2-interface board using magic `0xD0`/`0xDA`... note — the
 * 60HE+ answers with the *multi-report* magic (`0xD1`) and report index 1 on
 * its config interface (usage page `0xFF55`, usage `0x01`), so commands go
 * out in multi-report form. The `0xFF53` collection is the analog/HID data
 * stream and declares no feature report, so a WebHID feature write there
 * fails. wootswitch reports the analog stream as `0xFF54` on PID `0x1320`;
 * both pages are accepted when looking for the stream (see driver).
 *
 * These helpers are read-only building blocks: the host uses them to identify
 * a board and, where the transport permits, read its device config. No
 * firmware flashing, profile writes, or key remapping live here.
 */

/** Wooting "VID2" — used by every Hall-effect / ARM board (Two HE, 60HE, 60HE+, 80HE…). */
export const WOOTING_VENDOR_ID = 0x31e3;
/** Atmel VID on the original AVR boards (Wooting One / Two). Kept for discovery only. */
export const WOOTING_LEGACY_VENDOR_ID = 0x03eb;

export interface WootingProduct {
  name: string;
  /** True only once the board has been exercised on real hardware through OpenMouse. */
  verified: boolean;
}

/**
 * Known product IDs. Only the 60HE+ is listed until other boards are captured
 * and confirmed on hardware.
 */
export const WOOTING_PRODUCTS: Record<number, WootingProduct> = {
  0x1322: { name: "Wooting 60HE+", verified: false },
};

export const WOOTING_PRODUCT_IDS: readonly number[] = Object.keys(WOOTING_PRODUCTS).map(Number);

/**
 * Vendor config interface. ARM boards (60HE+ and later) expose commands on
 * usage page `0xFF55`, usage `0x01`. Standard-firmware boards (One / Two /
 * original 60HE) use usage page `0x1337` instead (wootswitch). `0xFF00` is the
 * legacy generic interface on older boards.
 */
export const WOOTING_CONFIG_USAGE_PAGE = 0xff55;
export const WOOTING_CONFIG_USAGE_PAGE_STANDARD = 0x1337;
export const WOOTING_CONFIG_USAGE_PAGE_LEGACY = 0xff00;
/** The analog/HID data stream — not used for commands. */
export const WOOTING_ANALOG_USAGE_PAGE = 0xff53;
/** Second analog-stream page seen on PID 0x1320 (wootswitch); accepted too. */
export const WOOTING_ANALOG_USAGE_PAGE_ALT = 0xff54;
export const WOOTING_CONFIG_USAGE = 0x01;

export const WOOTING_COMMAND_SIZE = 8;
export const WOOTING_MAGIC_SINGLE = 0xd0;
export const WOOTING_MAGIC_MULTI = 0xd1;
export const WOOTING_MAGIC_WORD_1 = 0xda;

/** Reply status byte: the board understood and answered the command. */
export const WOOTING_STATUS_OK = 0x88;
/** Reply status byte: unsupported / error (e.g. GetDigitalProfilesCount on ARM). */
export const WOOTING_STATUS_ERROR = 0x66;

/**
 * D0DA command IDs (wootswitch table, cross-checked with the RGB SDK and the
 * `d0da` project). Only read-only queries are listed here — deliberately NOT
 * the neighbouring destructive ones (`reset_to_bootloader = 0x02`,
 * `keys_off = 0x15`, `do_soft_reset = 0x19`, profile-save / RGB-write /
 * activate / reload commands, …).
 */
export const WOOTING_COMMAND = {
  /** ping — liveness probe, no payload. */
  ping: 0x00,
  /** get_version — firmware version. */
  getVersion: 0x01,
  /** get_serial — device serial number. */
  getSerial: 0x03,
  /** get_rgb_profile_count — number of RGB profiles. */
  getRgbProfileCount: 0x04,
  /** get_digital_profiles_count — profile count (0x66 on ARM; probe metadata instead). */
  getDigitalProfilesCount: 0x09,
  /** get_analog_profiles_count — analog profile count. */
  getAnalogProfilesCount: 0x0a,
  /** get_current_keyboard_profile_index — which onboard profile is active. */
  getCurrentKeyboardProfileIndex: 0x0b,
  /** get_digital_profile — digital profile blob for a slot. */
  getDigitalProfile: 0x0c,
  /** get_analog_profile_main_part — analog profile main part for a slot. */
  getAnalogProfileMainPart: 0x0d,
  /** get_analog_profile_curve_map_1/2 — actuation curve pages for a slot. */
  getAnalogProfileCurve1: 0x0e,
  getAnalogProfileCurve2: 0x0f,
  /** get_number_of_keys — matrix key count. */
  getNumberOfKeys: 0x10,
  /** get_main_mapping_profile — primary key mapping for a slot. */
  getMainMappingProfile: 0x11,
  /** get_function_mapping_profile — function-layer mapping for a slot. */
  getFunctionMappingProfile: 0x12,
  /** get_device_config — board layout / config block. */
  getDeviceConfig: 0x13,
  /** get_analog_values — one-shot analog snapshot (vs the streaming interface). */
  getAnalogValues: 0x14,
  /** get_dks_profile — dynamic-keystroke profile for a slot. */
  getDksProfile: 0x18,
  /** get_keyboard_profile — the active profile: actuation (field 1, mm × 20480), rapid trigger, etc. */
  getKeyboardProfile: 0x27,
  /** get_gamepad_mapping / get_gamepad_profile — gamepad layer (slot). */
  getGamepadMapping: 0x28,
  getGamepadProfile: 0x29,
  /** get_mapping_profile — key mapping blob for a slot. */
  getMappingProfile: 0x30,
  /** get_actuation_profile — per-key actuation overrides for a profile. */
  getActuationProfile: 0x31,
  /** get_rgb_profile_core — RGB profile core block. */
  getRgbProfileCore: 0x32,
  /** get_settings — global device settings protobuf. */
  getSettings: 0x33,
  /** get_akc_profile — advanced-keys-combo profile for a slot. */
  getAkcProfile: 0x34,
  /** get_rapid_trigger_profile — rapid-trigger profile for a slot. */
  getRapidTriggerProfile: 0x36,
  /** get_profile_metadata — slot metadata protobuf (payload length + name). */
  getProfileMetadata: 0x37,
  /** is_flash_chip_connected — nonzero when the flash chip answers. */
  isFlashChipConnected: 0x38,
  /** get_rgb_layer — RGB layer block. */
  getRgbLayer: 0x39,
  /** get_flash_stats — flash usage stats. */
  getFlashStats: 0x3a,
  /** get_rgb_bins — RGB bin calibration. */
  getRgbBins: 0x3b,
  /** get_rgb_profile_colors_1/2 — RGB profile colour pages. */
  getRgbProfileColors1: 0x23,
  getRgbProfileColors2: 0x24,
} as const;

/** Total key travel of a Wooting Lekker/analog switch, in millimetres (0–255 maps onto this). */
export const WOOTING_TRAVEL_MM = 4.0;

/** Convert a raw 0–255 analog value to millimetres of travel. */
export function wootingAnalogMm(value: number): number {
  return (value / 255) * WOOTING_TRAVEL_MM;
}

/** One decoded protobuf field: its number, wire type, and value(s). */
export interface ProtobufField {
  field: number;
  wire: number;
  /** varint / 32-bit / 64-bit numeric value (wire 0/5/1). */
  int?: number;
  /** the same 32-/64-bit value read as a float, for spotting mm settings. */
  float?: number;
  /** length-delimited payload (wire 2) — sub-message or string/bytes. */
  bytes?: Uint8Array;
}

function readVarint(data: Uint8Array, at: number): [number, number] {
  let result = 0;
  let shift = 0;
  let i = at;
  while (i < data.length) {
    const byte = data[i]!;
    result += (byte & 0x7f) * 2 ** shift;
    i += 1;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [result, i];
}

/**
 * Decode a protobuf message into its raw fields — no schema needed, because the
 * wire format tags every field with its number and type. Used to read the
 * Wooting profile blob and pick out the actuation / rapid-trigger values by
 * correlating with known settings. Returns [] if the bytes are not valid protobuf.
 */
export function decodeProtobufFields(data: Uint8Array): ProtobufField[] {
  const fields: ProtobufField[] = [];
  let i = 0;
  while (i < data.length) {
    const [tag, afterTag] = readVarint(data, i);
    if (tag === 0) break;
    i = afterTag;
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 0) {
      const [value, next] = readVarint(data, i);
      fields.push({ field, wire, int: value });
      i = next;
    } else if (wire === 2) {
      const [len, next] = readVarint(data, i);
      i = next;
      if (i + len > data.length) break;
      fields.push({ field, wire, bytes: data.slice(i, i + len) });
      i += len;
    } else if (wire === 5) {
      if (i + 4 > data.length) break;
      const view = new DataView(data.buffer, data.byteOffset + i, 4);
      fields.push({ field, wire, int: view.getUint32(0, true), float: view.getFloat32(0, true) });
      i += 4;
    } else if (wire === 1) {
      if (i + 8 > data.length) break;
      const view = new DataView(data.buffer, data.byteOffset + i, 8);
      fields.push({ field, wire, int: Number(view.getBigUint64(0, true)), float: view.getFloat64(0, true) });
      i += 8;
    } else {
      break;
    }
  }
  return fields;
}

/** Decoded actuation / rapid-trigger settings for the active profile. */
export interface WootingActuation {
  /** Actuation point in millimetres (the depth at which a press registers). */
  actuationMm: number;
  /** Whether rapid trigger is enabled. */
  rapidTrigger: boolean;
  /** Rapid-trigger sensitivity in millimetres, when rapid trigger is on. */
  rapidTriggerSensitivityMm: number | null;
  /** Continuous rapid trigger (release only when the key fully lifts). */
  continuousRapidTrigger: boolean;
}

/** Raw global settings decoded from a get_settings (0x33) reply. */
export interface WootingGlobalSettings {
  /** Raw actuation value (nested field 1). Multiply by the mm factor to display. */
  actuationRaw: number | null;
  /** Raw rapid-trigger sensitivity value (nested field 2). */
  rapidTriggerSensitivityRaw: number | null;
}

/**
 * Decode the nested-message fields of a profile reply
 * (`magic magic cmd status <len:u16> 0a <len> <nested>`). Returns the nested
 * message's fields as {field, value}. Used to read the keyboard profile (0x27),
 * whose field 1 is the actuation (stored as mm × 20480).
 */
export function decodeWootingProfileFields(reply: Uint8Array): Array<{ field: number; value: number }> {
  if (reply.length < 6) return [];
  const length = reply[4]! | (reply[5]! << 8);
  const body = reply.subarray(6, 6 + length);
  const nested = decodeProtobufFields(body).find((field) => field.field === 1 && field.bytes);
  if (!nested?.bytes) return [];
  return decodeProtobufFields(nested.bytes)
    .filter((field) => field.int !== undefined)
    .map((field) => ({ field: field.field, value: field.int! }));
}

/**
 * Millimetres of actuation from the keyboard profile's raw value. Confirmed on a
 * 60HE+ across two settings: 1.00mm → 20480, 0.50mm → 18432, i.e. a line
 * `raw = 16384 + mm * 4096` (raw 0x4000 = 0mm, 0x8000 = 4mm).
 */
export const WOOTING_ACTUATION_ZERO = 16384;
export const WOOTING_ACTUATION_UNITS_PER_MM = 4096;
export function wootingActuationMm(raw: number): number {
  return (raw - WOOTING_ACTUATION_ZERO) / WOOTING_ACTUATION_UNITS_PER_MM;
}

export function decodeWootingGlobalSettings(reply: Uint8Array): WootingGlobalSettings | null {
  if (reply.length < 6 || reply[2] !== WOOTING_COMMAND.getSettings) return null;
  const length = reply[4]! | (reply[5]! << 8);
  const body = reply.subarray(6, 6 + length);
  const nested = decodeProtobufFields(body).find((field) => field.field === 1 && field.bytes);
  if (!nested?.bytes) return { actuationRaw: null, rapidTriggerSensitivityRaw: null };
  const sub = decodeProtobufFields(nested.bytes);
  const at = (n: number) => sub.find((field) => field.field === n)?.int ?? null;
  return { actuationRaw: at(1), rapidTriggerSensitivityRaw: at(2) };
}

export interface WootingCommandOptions {
  /** Multi-report (ARM) boards use magic 0xD1 and report index 1. The 60HE+ does. */
  multiReport?: boolean;
}

/**
 * Build the full 8-byte command buffer exactly as the SDK lays it out, with the
 * hidapi report-index byte first. Transports that take the report id separately
 * (WebHID) should send `buffer[0]` as the report id and `buffer.subarray(1)` as
 * the data — see {@link wootingFeatureReport}.
 */
export function encodeWootingCommand(
  commandId: number,
  param0 = 0,
  param1 = 0,
  param2 = 0,
  param3 = 0,
  { multiReport = false }: WootingCommandOptions = {},
): Uint8Array {
  const buffer = new Uint8Array(WOOTING_COMMAND_SIZE);
  buffer[0] = multiReport ? 1 : 0;
  buffer[1] = multiReport ? WOOTING_MAGIC_MULTI : WOOTING_MAGIC_SINGLE;
  buffer[2] = WOOTING_MAGIC_WORD_1;
  buffer[3] = commandId & 0xff;
  buffer[4] = param3 & 0xff;
  buffer[5] = param2 & 0xff;
  buffer[6] = param1 & 0xff;
  buffer[7] = param0 & 0xff;
  return buffer;
}

/**
 * Encode a profile-slot argument for a slot-taking command (get_digital_profile,
 * get_mapping_profile, get_profile_metadata, …). The slot sits at a different
 * byte per firmware variant: byte 4 (param3) on ARM, byte 7 (param0) on
 * Standard (wootswitch). Returns a full 8-byte command buffer.
 */
export function encodeWootingProfileCommand(
  commandId: number,
  slot: number,
  { multiReport = true }: WootingCommandOptions = {},
): Uint8Array {
  return multiReport
    ? encodeWootingCommand(commandId, 0, 0, 0, slot, { multiReport })
    : encodeWootingCommand(commandId, slot, 0, 0, 0, { multiReport });
}

/**
 * Split an encoded command into the `{ reportId, data }` pair a WebHID
 * `sendFeatureReport(reportId, data)` call expects: the leading hidapi index
 * byte becomes the report id, and the remaining seven bytes are the data.
 */
export function wootingFeatureReport(buffer: Uint8Array) {
  return { reportId: buffer[0] ?? 0, data: buffer.slice(1) };
}

/**
 * Board physical layout as reported in the device-config response. Values follow
 * the SDK's `WOOTING_DEVICE_LAYOUT` enum (wooting-usb.h); anything outside it is
 * surfaced as `Unknown` with the raw id kept.
 */
export type WootingLayout = "ANSI" | "ISO" | "JIS" | "ANSI Split" | "ISO Split" | "Unknown";

/** SDK `WOOTING_DEVICE_LAYOUT` values → display names. */
const WOOTING_LAYOUTS: Readonly<Record<number, WootingLayout>> = {
  0: "ANSI",
  1: "ISO",
  2: "JIS",
  3: "ANSI Split",
  4: "ISO Split",
};

export interface WootingDeviceConfig {
  layout: WootingLayout;
  /** Raw layout byte, preserved for boards whose value we do not name yet. */
  layoutId: number;
}

/**
 * Offset of the layout byte inside the device-config response as WebHID delivers
 * it. The Wooting SDK reads index 10, but its buffer includes the leading
 * report-id byte that a WebHID `inputreport` event strips, so the same field
 * sits at index 9 here — confirmed against a 60HE+ reply
 * (`d1 da 13 88 07 00 00 00 00 00 …`, byte 9 = 0x00 = ANSI).
 */
export const WOOTING_DEVICE_CONFIG_LAYOUT_OFFSET = 9;

/**
 * Decode the layout out of a device-config response. `response` is the raw input
 * report payload (no report-id prefix, matching the WebHID `inputreport` event).
 * Returns `null` when the buffer is too short to trust.
 */
export function decodeWootingDeviceConfig(
  response: Uint8Array,
  offset: number = WOOTING_DEVICE_CONFIG_LAYOUT_OFFSET,
): WootingDeviceConfig | null {
  if (response.length <= offset) return null;
  const layoutId = response[offset]!;
  return { layout: WOOTING_LAYOUTS[layoutId] ?? "Unknown", layoutId };
}

/**
 * True when a buffer looks like a genuine Wooting command reply: it starts with
 * the magic word (`0xD0` or `0xD1`, then `0xDA`) and is long enough to carry a
 * command byte. Used to reject stub responses — e.g. a feature GET that echoes
 * only the report id — so the driver waits for the real input-report reply.
 * A `0x66`-status (unsupported) reply still passes: it IS a genuine reply, the
 * caller decides it carries no payload (see {@link wootingReplyOk}).
 */
export function isWootingReply(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && (bytes[0] === WOOTING_MAGIC_SINGLE || bytes[0] === WOOTING_MAGIC_MULTI)
    && bytes[1] === WOOTING_MAGIC_WORD_1;
}

/**
 * True when the reply's status byte (index 3) is OK (`0x88`). A `0x66` reply
 * means the board understood the framing but does not implement the command —
 * GetDigitalProfilesCount answers exactly this on ARM firmware — so the caller
 * must treat it as "no data", never as payload.
 */
export function wootingReplyOk(reply: Uint8Array): boolean {
  return isWootingReply(reply) && reply[3] === WOOTING_STATUS_OK;
}

/** Offset of the `major` byte in a get_version reply (minor/patch follow). */
export const WOOTING_VERSION_OFFSET = 6;

/**
 * Decode the firmware version out of a `get_version` reply.
 *
 * Confirmed against a real 60HE+ answer `d1 da 01 88 03 00 02 0d 00 …` whose
 * Wootility-reported version is v2.13.0: after the 4-byte header
 * (`magic0 magic1 command status`, status 0x88 = OK) and a two-byte leading
 * field, the version is `major minor patch` at offset 6 — here 2, 13, 0 → "2.13.0".
 * Returns null when the reply is not a version answer, carries no version, or
 * has an error status.
 */
export function decodeWootingVersion(reply: Uint8Array): string | null {
  const o = WOOTING_VERSION_OFFSET;
  if (!wootingReplyOk(reply) || reply.length < o + 3) return null;
  const [major, minor, patch] = [reply[o]!, reply[o + 1]!, reply[o + 2]!];
  if (major === 0 && minor === 0 && patch === 0) return null;
  return `${major}.${minor}.${patch}`;
}

export interface WootingProfileIndex {
  /**
   * Flash-stored default profile slot (0-based). On ARM this never changes via
   * software — it reflects the physical profile stored on the board — so it
   * must NOT be shown as the active profile.
   */
  flashDefault: number | null;
  /** Runtime-active profile slot (0-based): the one that actually answers keys. */
  active: number | null;
}

/**
 * Decode a `get_current_keyboard_profile_index` reply. ARM and Standard differ
 * (wootswitch, confirmed on 60HE+): the payload's first byte is the
 * flash-stored default, the third byte is the runtime-active slot — software
 * profile switches only move the latter, so reading byte 0 shows a stale
 * value. This reply carries NO length prefix (unlike the profile-blob
 * family), so payload starts at index 4 in WebHID framing.
 *
 * Returns nulls (not a guess) when the reply is too short or has error status.
 */
export function decodeWootingProfileIndex(reply: Uint8Array): WootingProfileIndex | null {
  if (!wootingReplyOk(reply)) return null;
  if (reply.length < 5) return null;
  const flashDefault = reply[4]!;
  const active = reply.length > 6 ? reply[6]! : flashDefault;
  return { flashDefault, active };
}

/**
 * Decode a `get_profile_metadata` reply for one slot (wootswitch layout):
 * payload byte 0 is the protobuf length — 0 means no profile exists at this
 * slot — byte 1 is padding, bytes 2.. are a protobuf encoding a single
 * field-1 string: the profile name. Like the profile-index reply, there is no
 * outer length prefix; payload starts at index 4 in WebHID framing.
 *
 * Returns `{ exists: false }` for an empty slot, `{ exists: true, name }` for
 * a populated one (`name` is null when the protobuf does not carry one), and
 * null when the reply itself is unusable.
 */
export function decodeWootingProfileMetadata(
  reply: Uint8Array,
): { exists: boolean; name: string | null } | null {
  if (!wootingReplyOk(reply) || reply.length < 6) return null;
  if (reply[4] === 0) return { exists: false, name: null };
  const fields = decodeProtobufFields(reply.subarray(6));
  const raw = fields.find((field) => field.field === 1 && field.bytes)?.bytes;
  if (!raw) return { exists: true, name: null };
  try {
    return { exists: true, name: new TextDecoder().decode(raw) };
  } catch {
    return { exists: true, name: null };
  }
}

/**
 * Decode a scalar count reply (`get_digital_profiles_count`,
 * `get_analog_profiles_count`, `get_number_of_keys`, `get_rgb_profile_count`):
 * payload byte 0 at index 4. Returns null on error status — notably
 * GetDigitalProfilesCount answers `0x66` on ARM, where the count must be
 * probed via GetProfileMetadata slots instead (wootswitch).
 */
export function decodeWootingCount(reply: Uint8Array, commandId: number): number | null {
  if (reply.length < 5 || reply[2] !== commandId) return null;
  if (!wootingReplyOk(reply)) return null;
  return reply[4]!;
}

/** One key's live analog reading: a USB HID keyboard usage id and its 0–255 travel. */
export interface WootingAnalogKey {
  /** USB HID keyboard/keypad usage id (e.g. 0x04 = A). */
  usage: number;
  /** Analog value, 0 (released) to 255 (fully pressed). */
  value: number;
}

/**
 * Decode one analog input report from the Wooting analog stream (the 0xFF53 /
 * 0xFF54 interface). The report is a run of 3-byte entries `[usageHigh, usage,
 * value]`; a full snapshot of the currently-pressed keys arrives on every event
 * (a key at value 0 / usage 0 is absent). Layout matches the community WebHID
 * readers (colecrouter/wooting-js). Returns the pressed keys in a stable order
 * (by usage id) so a live UI can keep each key's row in place instead of
 * reordering as values fluctuate.
 */
export function decodeWootingAnalogReport(data: Uint8Array): WootingAnalogKey[] {
  const keys: WootingAnalogKey[] = [];
  for (let i = 0; i + 2 < data.length; i += 3) {
    const usage = data[i + 1]!;
    const value = data[i + 2]!;
    if (usage !== 0 && value !== 0) keys.push({ usage, value });
  }
  return keys.sort((a, b) => a.usage - b.usage);
}

/** Human name for a product id, falling back to a generic Wooting label. */
export function wootingProductName(productId: number): string {
  return WOOTING_PRODUCTS[productId]?.name ?? "Wooting keyboard";
}
