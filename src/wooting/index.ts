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
 * `d0da` project). Write commands below are RAM-only unless marked FLASH:
 * profile-switch (0x21/0x17/0x26) and RGB-direct (0x1D–0x20) never touch
 * flash; every `save*` (0x08/0x2A/0x2F/0x35) plus `resetSettings` (0x2B)
 * overwrites onboard flash and needs an explicit user confirm. Deliberately
 * absent (NEVER encode): `reset_to_bootloader` 0x02 (leaves HID),
 * `keys_off` 0x15 (kills output until 0x16/reset), `do_soft_reset` 0x19
 * (drops RAM state, can re-enumerate).
 */
export const WOOTING_COMMAND = {
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
  /** keys_on — restores key/LED output (pair of the NEVER-encoded keys_off 0x15). RAM-only. */
  keysOn: 0x16,
  /** activate_profile — switches the active profile in RAM (slot byte). RAM-only. */
  activateProfile: 0x17,
  /** get_dks_profile — dynamic-keystroke profile for a slot. */
  getDksProfile: 0x18,
  /** refresh_rgb_colors — pushes staged RGB to the board. RAM-only. */
  refreshRgbColors: 0x1d,
  /** woot_dev_single_color — sets one key's RGB (SDK WOOTING_SINGLE_COLOR_COMMAND). RAM-only. */
  wootDevSingleColor: 0x1e,
  /** woot_dev_reset_color — resets one key's RGB (SDK WOOTING_SINGLE_RESET_COMMAND). RAM-only. */
  wootDevResetColor: 0x1f,
  /** woot_dev_reset_all — resets all RGB (SDK WOOTING_RESET_ALL_COMMAND). RAM-only. */
  wootDevResetAll: 0x20,
  /** woot_dev_init — session init, sent on SDK connect and before profile switching. RAM-only. */
  wootDevInit: 0x21,
  /** reload_profile — reloads LED/key config from flash into the active state (slot byte). RAM-only. */
  reloadProfile: 0x26,
  /** save_rgb_profile — persists the RGB profile to flash (slot byte). FLASH. */
  saveRgbProfile: 0x08,
  /** reload_profile_0 — reloads profile slot 0 from flash (no slot byte). RAM-only. */
  reloadProfile0: 0x07,
  /** save_keyboard_profile — persists the keyboard profile to flash (slot byte). FLASH. */
  saveKeyboardProfile: 0x2a,
  /** reset_settings — factory-resets settings. FLASH. */
  resetSettings: 0x2b,
  /** set_raw_scanning — toggles raw scanning mode (0/1). RAM-only. */
  setRawScanning: 0x2c,
  /** start/stop_xinput_detection — toggles gamepad detection. RAM-only. */
  startXinputDetection: 0x2d,
  stopXinputDetection: 0x2e,
  /** save_dks_profile — persists the DKS profile to flash (slot byte). FLASH. */
  saveDksProfile: 0x2f,
  /** save_akc_profile — persists the AKC profile to flash (slot byte). FLASH. */
  saveAkcProfile: 0x35,
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

// ---------------------------------------------------------------------------
// Typed read decoders for the remaining 60HE+ profile / RGB / diagnostic blobs.
//
// Every decoder below follows the wootswitch ARM reply layout as delivered by
// WebHID (report id stripped): `[D1 DA cmdEcho status payload...]` where
// status is `0x88` (OK) or `0x66` (unsupported / error). Length-prefixed
// profile blobs carry a u16LE length at payload offset 0 and an outer protobuf;
// 0x27's outer field 1 holds a nested varint message (actuation/RT), every
// other profile blob holds opaque binary rows preserved verbatim (see each
// decoder's live capture). All decoders return null on error status, command
// mismatch, or a truncated header, and never throw on board bytes. No write
// encoders live here: Save*/Activate/Reload/RGB-write and the destructive
// commands (`reset_to_bootloader` 0x02, `keys_off` 0x15, `do_soft_reset`
// 0x19) are deliberately absent.
//
// Actuation conversions use the contract line `raw = 16384 + mm * 4096`
// ({@link wootingActuationMm}).

/** One nested varint field of a profile blob: its protobuf field number and value. */
export interface WootingProfileField {
  field: number;
  value: number;
}

/** True when `reply` is a usable answer to `commandId`: long enough, echoing the command, status OK. */
function wootingCheckedReply(reply: Uint8Array, commandId: number, minLength: number): boolean {
  return reply.length >= minLength && reply[2] === commandId && wootingReplyOk(reply);
}

/**
 * Body of a length-prefixed profile-blob reply (u16LE length at payload offset
 * 0, body follows), or null when the reply is unusable. The returned view
 * shares the reply buffer — no copy.
 */
function wootingBlobBody(reply: Uint8Array, commandId: number): Uint8Array | null {
  if (!wootingCheckedReply(reply, commandId, 6)) return null;
  const length = reply[4]! | (reply[5]! << 8);
  return reply.subarray(6, 6 + length);
}

/** Nested varint field `n` of a profile blob, or null when it is absent. */
function wootingFieldAt(fields: readonly WootingProfileField[], n: number): number | null {
  return fields.find((entry) => entry.field === n)?.value ?? null;
}

/** Nested varint field `n` read as a flag (nonzero = true), or null when absent. */
function wootingFlagAt(fields: readonly WootingProfileField[], n: number): boolean | null {
  const value = wootingFieldAt(fields, n);
  return value === null ? null : value !== 0;
}

/** Little-endian u16 at `at`, or null when the buffer ends first. */
function wootingU16LE(bytes: Uint8Array, at: number): number | null {
  return bytes.length >= at + 2 ? (bytes[at]! | (bytes[at + 1]! << 8)) : null;
}

/**
 * Raw payload of a fixed (non-length-prefixed) reply starting at index 4, or
 * null when the reply is unusable. The returned view shares the reply buffer.
 */
function wootingRawPayload(reply: Uint8Array, commandId: number, minLength: number): Uint8Array | null {
  if (!wootingCheckedReply(reply, commandId, minLength)) return null;
  return reply.subarray(4);
}

/**
 * Decode the nested-message fields of a 0x27 profile reply
 * (`magic magic cmd status <len:u16> 0a <len> <nested>`). Returns the nested
 * message's varint fields as {field, value}. Only 0x27 carries this shape on
 * ARM — every other profile blob holds opaque binary rows, so this helper
 * MUST NOT be used for 0x0D/0x18/0x28/0x29/0x30/0x31/0x33/0x34/0x36.
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

/** Live 60HE+ `get_keyboard_profile` (0x27) nested fields (22-byte body). */
export interface WootingKeyboardProfile {
  /** Actuation raw (nested field 1) on the contract line. Confirmed: 17203 = 0.20mm. */
  actuationRaw: number | null;
  actuationMm: number | null;
  /** Rapid-trigger enable flag (nested field 2). Live: 1. */
  rapidTriggerEnabled: boolean | null;
  /** Upstroke sensitivity raw (nested field 3). Live: 1. */
  pressSensitivityRaw: number | null;
  /** Downstroke sensitivity raw (nested field 4). Live: 16794. */
  releaseSensitivityRaw: number | null;
  /** Rapid-trigger release threshold raw (nested field 5). Live: 0. */
  releaseThresholdRaw: number | null;
  /** Curve preset selector (nested field 6). Live: 2. */
  curvePreset: number | null;
  /** Continuous rapid trigger (nested field 7). Live: 0. */
  continuousRapidTrigger: boolean | null;
  /** Every nested varint field, so future firmware fields survive. */
  fields: WootingProfileField[];
}

/**
 * Decode the live `get_keyboard_profile` (0x27) reply. Field numbers are the
 * live 60HE+ capture (`0a1408b3860110011801209a83012800300238004800`):
 * f1 = actuation raw, f2 = RT enable, f3/f4 = up/down sensitivity,
 * f5 = release threshold, f6 = curve preset, f7 = continuous RT, f9 = 0.
 * Returns null on error status, command mismatch, or a truncated header.
 */
export function decodeWootingKeyboardProfile(reply: Uint8Array): WootingKeyboardProfile | null {
  if (!wootingCheckedReply(reply, WOOTING_COMMAND.getKeyboardProfile, 6)) return null;
  const fields = decodeWootingProfileFields(reply);
  const actuationRaw = wootingFieldAt(fields, 1);
  return {
    actuationRaw,
    actuationMm: actuationRaw === null ? null : wootingActuationMm(actuationRaw),
    rapidTriggerEnabled: wootingFlagAt(fields, 2),
    pressSensitivityRaw: wootingFieldAt(fields, 3),
    releaseSensitivityRaw: wootingFieldAt(fields, 4),
    releaseThresholdRaw: wootingFieldAt(fields, 5),
    curvePreset: wootingFieldAt(fields, 6),
    continuousRapidTrigger: wootingFlagAt(fields, 7),
    fields,
  };
}

/**
 * Decoded `get_analog_profile_main_part` (0x0D) reply: every ARM board answers
 * `0x66` (unsupported — confirmed live on the 60HE+), so this decoder exists
 * for Standard-firmware boards only and always yields null on ARM hardware.
 */
export interface WootingAnalogProfileMainPart {
  actuationRaw: number | null;
  actuationMm: number | null;
  rapidTriggerEnabled: boolean | null;
  pressSensitivityRaw: number | null;
  releaseSensitivityRaw: number | null;
  continuousRapidTrigger: boolean | null;
  fields: WootingProfileField[];
}

export function decodeWootingAnalogProfileMainPart(reply: Uint8Array): WootingAnalogProfileMainPart | null {
  if (!wootingCheckedReply(reply, WOOTING_COMMAND.getAnalogProfileMainPart, 6)) return null;
  const fields = decodeWootingProfileFields(reply);
  const actuationRaw = wootingFieldAt(fields, 1);
  return {
    actuationRaw,
    actuationMm: actuationRaw === null ? null : wootingActuationMm(actuationRaw),
    rapidTriggerEnabled: wootingFlagAt(fields, 2),
    pressSensitivityRaw: wootingFieldAt(fields, 3),
    releaseSensitivityRaw: wootingFieldAt(fields, 4),
    continuousRapidTrigger: wootingFlagAt(fields, 5),
    fields,
  };
}

/**
 * Decoded `get_rapid_trigger_profile` (0x36) reply: every ARM board answers an
 * empty OK body (confirmed live: `d1 da 36 88` + zeros) — rapid-trigger state
 * lives in the 0x27 keyboard profile on ARM. Kept for Standard firmware.
 */
export interface WootingRapidTriggerProfile {
  enabled: boolean | null;
  pressSensitivityRaw: number | null;
  releaseSensitivityRaw: number | null;
  continuous: boolean | null;
  fields: WootingProfileField[];
}

export function decodeWootingRapidTriggerProfile(reply: Uint8Array): WootingRapidTriggerProfile | null {
  if (!wootingCheckedReply(reply, WOOTING_COMMAND.getRapidTriggerProfile, 6)) return null;
  const fields = decodeWootingProfileFields(reply);
  return {
    enabled: wootingFlagAt(fields, 1),
    pressSensitivityRaw: wootingFieldAt(fields, 2),
    releaseSensitivityRaw: wootingFieldAt(fields, 3),
    continuous: wootingFlagAt(fields, 4),
    fields,
  };
}

/**
 * Decoded `get_actuation_profile` (0x31) reply: every ARM board answers an
 * empty OK body (confirmed live: `d1 da 31 88` + zeros), so per-key readings
 * come from the 0x27 profile instead — this decoder exists for
 * Standard-firmware boards and preserves whatever nested fields they send.
 */
export interface WootingActuationOverride {
  key: number;
  actuationRaw: number;
  actuationMm: number;
}

export interface WootingActuationProfile {
  overrides: WootingActuationOverride[];
  raw: Uint8Array;
}

export function decodeWootingActuationProfile(reply: Uint8Array): WootingActuationProfile | null {
  const body = wootingBlobBody(reply, WOOTING_COMMAND.getActuationProfile);
  if (!body) return null;
  return {
    overrides: decodeWootingProfileFields(reply).map(({ field, value }) => ({
      key: field - 1,
      actuationRaw: value,
      actuationMm: wootingActuationMm(value),
    })),
    raw: body,
  };
}

/**
 * One key-map row group: the 21-byte inner field-1 payload of one outer
 * field-1 group. Live 60HE+ `get_mapping_profile` (0x30) body (150 bytes):
 * six `0a 17 0a 15 <21 bytes>` groups — row content is an opaque key bitmap,
 * not nested varints (`ff…` bytes are not valid field tags), so rows are
 * preserved verbatim instead of misread as key/usage pairs.
 */
export interface WootingMappingProfile {
  /** One 21-byte row per outer field-1 group, in reply order. */
  groups: Uint8Array[];
  /** Full length-prefixed body, for the remap editor to refine. */
  raw: Uint8Array;
}

export function decodeWootingMappingProfile(
  reply: Uint8Array,
  commandId: number = WOOTING_COMMAND.getMappingProfile,
): WootingMappingProfile | null {
  if (
    commandId !== WOOTING_COMMAND.getMappingProfile
    && commandId !== WOOTING_COMMAND.getMainMappingProfile
    && commandId !== WOOTING_COMMAND.getFunctionMappingProfile
  ) return null;
  const body = wootingBlobBody(reply, commandId);
  if (!body) return null;
  const groups: Uint8Array[] = [];
  for (const outer of decodeProtobufFields(body)) {
    const inner = outer.field === 1 && outer.bytes
      ? decodeProtobufFields(outer.bytes).find((field) => field.field === 1 && field.bytes)?.bytes
      : undefined;
    if (inner) groups.push(inner);
  }
  return { groups, raw: body };
}

/** `get_main_mapping_profile` (0x11): the primary-layer map rows. */
export function decodeWootingMainMappingProfile(reply: Uint8Array): WootingMappingProfile | null {
  return decodeWootingMappingProfile(reply, WOOTING_COMMAND.getMainMappingProfile);
}

/** `get_function_mapping_profile` (0x12): the function-layer map rows. */
export function decodeWootingFunctionMappingProfile(reply: Uint8Array): WootingMappingProfile | null {
  return decodeWootingMappingProfile(reply, WOOTING_COMMAND.getFunctionMappingProfile);
}

/**
 * Decoded `get_dks_profile` (0x18) reply: every ARM board answers an empty OK
 * body (confirmed live: `d1 da 18 88` + zeros — no DKS binds on this profile),
 * so the decoder reports `cellCount` from the length prefix (0 = unbound)
 * and preserves the body. Populated Standard-firmware bodies stay as `raw`
 * for the DKS editor to refine.
 */
export interface WootingDksProfile {
  /** Length-prefix value: 0 means no DKS binds on this slot. */
  cellCount: number;
  raw: Uint8Array;
}

export function decodeWootingDksProfile(reply: Uint8Array): WootingDksProfile | null {
  if (!wootingCheckedReply(reply, WOOTING_COMMAND.getDksProfile, 6)) return null;
  const length = reply[4]! | (reply[5]! << 8);
  const body = reply.subarray(6, 6 + length);
  return { cellCount: length, raw: body };
}

/**
 * Decoded `get_akc_profile` (0x34) reply. Schema reverse-engineered from the
 * Wootility web bundle (protobuf-es classes, `wootility.io`):
 *
 * - Body = repeated AKC entries (outer field 1) + trailer fields 2/3.
 * - Entry = `{ keyIndex: 8, layer: 9, oneof akc: dks = 1, modTap = 2,
 *   toggleKey = 3, rappySnappy = 4, socd = 5 }` (from the `J_` class field
 *   list and the binary `switch(u1S)` dispatch: dks = 1, modTap = 2,
 *   toggle = 3, rappy = 4, socd = 5, keyIndex = 8, layer = 9).
 * - Rappy/SOCD sub-message = `{ secondaryKey: 1 (uint32 matrix index),
 *   socd: 2 (SOCD mode enum), inputBothWhenBottomedOut: 3 (bool) }` (from
 *   the `X_` class field list and both binary writers).
 * - Matrix index = `(row & 7) << 5 | (col & 31)` (from `Ba`/`l2`: col mask
 *   `0x1f`, row shift 5, row mask 7; `(31, 7)` = empty).
 * - SOCD mode enum `Rt` (from the bundle): 0/1/2 = unknown labels, 3 =
 *   SecondaryPress, 4 = LastInputPriority (from the Wootility UI strings:
 *   Last Input Priority, Absolute Priority, Neutral).
 *
 * Live 60HE+ (18 bytes): entry = `2a 06 [08 63 10 04 18 00] 40 61 48 00`,
 * i.e. socd(5) = `{ secondaryKey: 99 = (3,3) = D, socd: 4 =
 * LastInputPriority, bottomed: false }`, keyIndex 97 = (3,1) = A, layer 0.
 * This matches the Wootility UI showing A+D Last Input Priority active.
 */

/** Matrix position of a key: row 0–5, col 0–30 (`(31, 7)` = empty). */
export interface WootingKeyIndex {
  row: number;
  col: number;
}

/** Decode a Wootility matrix key index, or null when it is the empty slot. */
export function decodeWootingKeyIndex(index: number): WootingKeyIndex | null {
  const col = index & 0x1f;
  const row = (index >> 5) & 0x7;
  if (col === 31 && row === 7) return null;
  return { row, col };
}
/**
 * Firmware matrix → UI key id for the 60% layout (from the RGB SDK's
 * `keyboard-matrix-rows-columns.png`: matrix row 1 = number row, matrix
 * row 2 = Q row, matrix row 3 = A row, matrix row 4 = Z row, matrix row 5
 * = bottom row; columns count the Esc column as 0). Only positions present
 * on a 60% board are listed — function-row, nav-cluster, and numpad
 */
const WOOTING_60_MATRIX_TO_KEY: Readonly<Record<string, string>> = {
  "1:0": "esc",
  "1:1": "1", "1:2": "2", "1:3": "3", "1:4": "4", "1:5": "5",
  "1:6": "6", "1:7": "7", "1:8": "8", "1:9": "9", "1:10": "0",
  "1:11": "minus", "1:12": "equal", "1:13": "backspace",
  "2:0": "tab",
  "2:1": "q", "2:2": "w", "2:3": "e", "2:4": "r", "2:5": "t",
  "2:6": "y", "2:7": "u", "2:8": "i", "2:9": "o", "2:10": "p",
  "2:11": "lbracket", "2:12": "rbracket", "2:13": "backslash",
  "3:0": "caps",
  "3:1": "a", "3:2": "s", "3:3": "d", "3:4": "f", "3:5": "g",
  "3:6": "h", "3:7": "j", "3:8": "k", "3:9": "l",
  "3:10": "semicolon", "3:11": "quote", "3:13": "enter",
  "4:0": "lshift",
  "4:2": "z", "4:3": "x", "4:4": "c", "4:5": "v", "4:6": "b",
  "4:7": "n", "4:8": "m", "4:9": "comma", "4:10": "period",
  "4:11": "slash", "4:13": "rshift",
  "5:0": "lctrl", "5:1": "lwin", "5:2": "lalt", "5:6": "space",
  "5:10": "ralt", "5:11": "rctrl", "5:12": "menu", "5:13": "rctrl",
  "5:14": "fn1",
};

/**
 * UI key id for a firmware matrix position, or null when no 60% key lives
 * there (function-row/nav/numpad columns, ISO extras, gaps). Never guesses:
 * an unmapped position is null, and the caller renders the raw (row,col).
 */
export function wootingMatrixKeyId(row: number, col: number): string | null {
  return WOOTING_60_MATRIX_TO_KEY[`${row}:${col}`] ?? null;
}
/** SOCD mode selector (Wootility `Rt` enum; labels 0–2 unknown). */
export type WootingSocdMode = 0 | 1 | 2 | 3 | 4;

/** Human label for a SOCD mode. Modes 0–2 have no UI string; shown as-is. */
export function wootingSocdModeLabel(mode: number): string {
  switch (mode) {
    case 3: return "Secondary Press";
    case 4: return "Last Input Priority";
    default: return `Mode ${mode}`;
  }
}

/** Oneof discriminator for an AKC entry (Wootility `J_` oneof `akc`). */
export type WootingAkcKind = "dks" | "modTap" | "toggleKey" | "rappySnappy" | "socd" | "unknown";

/** Named AKC entry: primary key + layer + the bound advanced-key payload. */
export interface WootingAkcCombo {
  /** Primary key matrix index (entry field 8). */
  keyIndex: number;
  /** Primary key matrix position, null when empty. */
  key: WootingKeyIndex | null;
  /** Entry layer (entry field 9). */
  layer: number;
  /** Which oneof member the entry carries (fields 1–5). */
  kind: WootingAkcKind;
  /** Secondary key matrix index (Rappy/SOCD field 1). */
  secondaryKeyIndex: number | null;
  /** Secondary key matrix position, null when absent/empty. */
  secondaryKey: WootingKeyIndex | null;
  /** SOCD mode (Rappy/SOCD field 2). */
  socdMode: number | null;
  /** Both keys stay active when bottomed out (Rappy/SOCD field 3). */
  inputBothWhenBottomedOut: boolean | null;
  /** Verbatim bytes of the oneof sub-message. */
  payload: Uint8Array | null;
  /** Verbatim bytes of the whole entry. */
  raw: Uint8Array;
}

export interface WootingAkcProfile {
  combos: WootingAkcCombo[];
  /** Every outer field's bytes, so trailer fields survive. */
  fields: Array<{ field: number; raw: Uint8Array }>;
  raw: Uint8Array;
}

/** Map an entry oneof field number to its kind (dks = 1 … socd = 5). */
function wootingAkcKind(field: number): WootingAkcKind | null {
  switch (field) {
    case 1: return "dks";
    case 2: return "modTap";
    case 3: return "toggleKey";
    case 4: return "rappySnappy";
    case 5: return "socd";
    default: return null;
  }
}

export function decodeWootingAkcProfile(reply: Uint8Array): WootingAkcProfile | null {
  const body = wootingBlobBody(reply, WOOTING_COMMAND.getAkcProfile);
  if (!body) return null;
  const combos: WootingAkcCombo[] = [];
  const fields: Array<{ field: number; raw: Uint8Array }> = [];
  for (const outer of decodeProtobufFields(body)) {
    if (!outer.bytes) continue;
    fields.push({ field: outer.field, raw: outer.bytes });
    if (outer.field !== 1) continue;
    const entry = decodeProtobufFields(outer.bytes);
    const keyField = entry.find((field) => field.field === 8 && field.int !== undefined);
    const layerField = entry.find((field) => field.field === 9 && field.int !== undefined);
    const payloadField = entry.find((field) => field.bytes && wootingAkcKind(field.field) !== null);
    const kind = payloadField ? wootingAkcKind(payloadField.field)! : "unknown";
    let secondaryKeyIndex: number | null = null;
    let socdMode: number | null = null;
    let inputBothWhenBottomedOut: boolean | null = null;
    if (payloadField?.bytes && (kind === "rappySnappy" || kind === "socd")) {
      for (const sub of decodeProtobufFields(payloadField.bytes)) {
        if (sub.field === 1 && sub.int !== undefined) secondaryKeyIndex = sub.int;
        else if (sub.field === 2 && sub.int !== undefined) socdMode = sub.int;
        else if (sub.field === 3 && sub.int !== undefined) inputBothWhenBottomedOut = sub.int !== 0;
      }
    }
    combos.push({
      keyIndex: keyField?.int ?? -1,
      key: keyField?.int === undefined ? null : decodeWootingKeyIndex(keyField.int),
      layer: layerField?.int ?? 0,
      kind,
      secondaryKeyIndex,
      secondaryKey: secondaryKeyIndex === null ? null : decodeWootingKeyIndex(secondaryKeyIndex),
      socdMode,
      inputBothWhenBottomedOut,
      payload: payloadField?.bytes ?? null,
      raw: outer.bytes,
    });
  }
  if (combos.length === 0) return null;
  return { combos, fields, raw: body };
}

/**
 * Decoded `get_gamepad_profile` (0x29) reply: every outer field holds one
 * inner bind/axis group verbatim (live 60HE+, 40 bytes: four `0a 04…` /
 * `0a 06…` groups under outer field 1 plus a field-2 mode trailer
 * `0800100018012032`). The trailer's field 3 is the profile's mode selector
 * (best-effort); rows stay binary.
 */
export interface WootingGamepadProfile {
  /** Verbatim bytes of one outer field-1 group. */
  groups: Uint8Array[];
  /** Mode selector from the field-2 trailer (field 3, best-effort). */
  mode: number | null;
  /** Every outer field's bytes, so unknown trailer fields survive. */
  fields: Array<{ field: number; raw: Uint8Array }>;
  raw: Uint8Array;
}

export function decodeWootingGamepadProfile(reply: Uint8Array): WootingGamepadProfile | null {
  const body = wootingBlobBody(reply, WOOTING_COMMAND.getGamepadProfile);
  if (!body) return null;
  const groups: Uint8Array[] = [];
  const fields: Array<{ field: number; raw: Uint8Array }> = [];
  let mode: number | null = null;
  for (const outer of decodeProtobufFields(body)) {
    if (!outer.bytes) continue;
    fields.push({ field: outer.field, raw: outer.bytes });
    if (outer.field === 1) groups.push(outer.bytes);
    else if (outer.field === 2) {
      mode = decodeProtobufFields(outer.bytes).find((inner) => inner.field === 3)?.int ?? null;
    }
  }
  if (groups.length === 0) return null;
  return { groups, mode, fields, raw: body };
}

/**
 * Decoded `get_gamepad_mapping` (0x28) reply: every ARM board answers an
 * empty OK body (confirmed live: `d1 da 28 88` + zeros — no gamepad binds on
 * this profile). Gamepad binds live in the 0x29 profile instead. Kept for
 * Standard firmware; populated bodies stay as `raw` for the editor.
 */
export interface WootingGamepadMapping {
  /** Length-prefix value: 0 means no gamepad binds on this slot. */
  bindingCount: number;
  raw: Uint8Array;
}

export function decodeWootingGamepadMapping(reply: Uint8Array): WootingGamepadMapping | null {
  if (!wootingCheckedReply(reply, WOOTING_COMMAND.getGamepadMapping, 6)) return null;
  const length = reply[4]! | (reply[5]! << 8);
  const body = reply.subarray(6, 6 + length);
  return { bindingCount: length, raw: body };
}

/**
 * RGB profile block shared by `get_rgb_profile_core` (0x32), colours
 * (0x23/0x24), layer (0x39), and bins (0x3B). Live 60HE+ shapes: core is one
 * field-1 config row (`08ff0110ffff03…`) plus a field-4 lighting row;
 * colours are repeated field-1 BGR rows; bins is a packed calibration row.
 * Rows are binary (e.g. `0xff 0x01` is not a valid field tag), so groups stay
 * verbatim with the trailer bytes split out.
 */
export interface WootingRgbBlock {
  commandId: number;
  /** Verbatim bytes of every outer field-1 group, in reply order. */
  groups: Uint8Array[];
  /** Verbatim bytes of the first non-field-1 group (lighting/trailer), if any. */
  trailer: Uint8Array | null;
  raw: Uint8Array;
}

function decodeWootingRgbBlock(reply: Uint8Array, commandId: number): WootingRgbBlock | null {
  const body = wootingBlobBody(reply, commandId);
  if (!body) return null;
  const groups: Uint8Array[] = [];
  let trailer: Uint8Array | null = null;
  for (const outer of decodeProtobufFields(body)) {
    if (!outer.bytes) continue;
    if (outer.field === 1) groups.push(outer.bytes);
    else if (!trailer) trailer = outer.bytes;
  }
  if (groups.length === 0) return null;
  return { commandId, groups, trailer, raw: body };
}

/** `get_rgb_profile_core` (0x32): the RGB profile core block. */
export function decodeWootingRgbProfileCore(reply: Uint8Array): WootingRgbBlock | null {
  return decodeWootingRgbBlock(reply, WOOTING_COMMAND.getRgbProfileCore);
}

/**
 * `get_rgb_profile_colors_1/2` (0x23/0x24): the RGB colour pages. The part is
 * read off the echoed command — a reply echoing anything else is not a colour
 * page and decodes to null.
 */
export interface WootingRgbProfileColors extends WootingRgbBlock {
  part: 1 | 2;
}

export function decodeWootingRgbProfileColors(reply: Uint8Array): WootingRgbProfileColors | null {
  const echoed = reply[2] ?? -1;
  if (echoed !== WOOTING_COMMAND.getRgbProfileColors1 && echoed !== WOOTING_COMMAND.getRgbProfileColors2) return null;
  const block = decodeWootingRgbBlock(reply, echoed);
  if (!block) return null;
  return { ...block, part: echoed === WOOTING_COMMAND.getRgbProfileColors1 ? 1 : 2 };
}

/** `get_rgb_layer` (0x39): one RGB layer block. */
export function decodeWootingRgbLayer(reply: Uint8Array): WootingRgbBlock | null {
  return decodeWootingRgbBlock(reply, WOOTING_COMMAND.getRgbLayer);
}

/** `get_rgb_bins` (0x3B): the RGB bin-calibration block. */
export function decodeWootingRgbBins(reply: Uint8Array): WootingRgbBlock | null {
  return decodeWootingRgbBlock(reply, WOOTING_COMMAND.getRgbBins);
}

/**
 * Full global settings decoded from a get_settings (0x33) reply. Live 60HE+
 * (8-byte body `0a040805100a1000`): the field-1 group holds verbatim config
 * bytes `08 05 10 0a` — NOT nested varints (`0x10 0x0a` is not a valid field
 * tag) — so settings are preserved as raw config rows. Wootility ranges
 * (actuation 0.1–4.0mm, RT, Tachyon ≤1000Hz on 60HE+) apply at the UI layer,
 * never as decoded claims here.
 */
export interface WootingGlobalSettings {
  /** Verbatim config bytes of the field-1 group. */
  config: Uint8Array | null;
  /** Every outer field's bytes, so unknown settings survive. */
  fields: Array<{ field: number; raw: Uint8Array }>;
  /** The full length-prefixed body. */
  raw: Uint8Array;
}

export function decodeWootingGlobalSettings(reply: Uint8Array): WootingGlobalSettings | null {
  const body = wootingBlobBody(reply, WOOTING_COMMAND.getSettings);
  if (!body) return null;
  const fields: Array<{ field: number; raw: Uint8Array }> = [];
  let config: Uint8Array | null = null;
  for (const outer of decodeProtobufFields(body)) {
    if (!outer.bytes) continue;
    fields.push({ field: outer.field, raw: outer.bytes });
    if (outer.field === 1 && !config) config = outer.bytes;
  }
  if (!config) return null;
  return { config, fields, raw: body };
}

/**
 * Named scalar diagnostics. All three share the single-byte payload shape, so
 * each delegates to {@link decodeWootingCount} — the names exist so the
 * driver and UI layers can import one decoder per command id.
 */

/** `get_number_of_keys` (0x10): matrix key count (61 on the 60HE+). */
export function decodeWootingNumberOfKeys(reply: Uint8Array): number | null {
  return decodeWootingCount(reply, WOOTING_COMMAND.getNumberOfKeys);
}

/** `get_analog_profiles_count` (0x0A): analog profile count. */
export function decodeWootingAnalogProfilesCount(reply: Uint8Array): number | null {
  return decodeWootingCount(reply, WOOTING_COMMAND.getAnalogProfilesCount);
}

/** `get_rgb_profile_count` (0x04): RGB profile count. */
export function decodeWootingRgbProfileCount(reply: Uint8Array): number | null {
  return decodeWootingCount(reply, WOOTING_COMMAND.getRgbProfileCount);
}

/**
 * `is_flash_chip_connected` (0x38): nonzero payload byte means the flash chip
 * answers. Null on error status or a truncated header — never a guessed false.
 */
export function decodeWootingFlashChipConnected(reply: Uint8Array): boolean | null {
  const payload = wootingRawPayload(reply, WOOTING_COMMAND.isFlashChipConnected, 5);
  if (!payload) return null;
  return payload[0] !== 0;
}

/**
 * `get_flash_stats` (0x3A): flash usage as two u16LE page counts (used, then
 * total — best-effort order) with the raw payload preserved for refinement.
 */
export interface WootingFlashStats {
  usedPages: number | null;
  totalPages: number | null;
  raw: Uint8Array;
}

export function decodeWootingFlashStats(reply: Uint8Array): WootingFlashStats | null {
  const payload = wootingRawPayload(reply, WOOTING_COMMAND.getFlashStats, 8);
  if (!payload) return null;
  return { usedPages: wootingU16LE(payload, 0), totalPages: wootingU16LE(payload, 2), raw: payload };
}

/**
 * `get_analog_values` (0x14): one-shot analog snapshot. The live 60HE+ answers
 * the same six-group profile layout as 0x30 (150 bytes of `0a 17 0a 15 …`
 * rows, all zero at rest), NOT the streaming 3-byte `[usageHigh, usage,
 * value]` shape — so the raw groups are preserved for the snapshot view.
 * Returns null on error status or a truncated header.
 */
export interface WootingAnalogSnapshot {
  /** One 21-byte row per outer field-1 group, in reply order. */
  groups: Uint8Array[];
  raw: Uint8Array;
}

export function decodeWootingAnalogSnapshot(reply: Uint8Array): WootingAnalogSnapshot | null {
  const body = wootingBlobBody(reply, WOOTING_COMMAND.getAnalogValues);
  if (!body) return null;
  const groups: Uint8Array[] = [];
  for (const outer of decodeProtobufFields(body)) {
    const inner = outer.field === 1 && outer.bytes
      ? decodeProtobufFields(outer.bytes).find((field) => field.field === 1 && field.bytes)?.bytes
      : undefined;
    if (inner) groups.push(inner);
  }
  return { groups, raw: body };
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
 * Settle delay between profile-switch steps. The wootswitch sequence needs
 * 100ms after ActivateProfile before ReloadProfile, and 100ms after reload
 * before the change is visible — confirmed live (switching without the
 * settle leaves the 0x0b index stale).
 */
export const WOOTING_PROFILE_SWITCH_SETTLE_MS = 100;

/**
 * Encode the three-step RAM-only profile-switch sequence (wootswitch):
 * WootDevInit (0x21, no args) → ActivateProfile (0x17, slot) → ReloadProfile
 * (0x26, slot). Returns the three 8-byte buffers in send order; the driver
 * waits {@link WOOTING_PROFILE_SWITCH_SETTLE_MS} between sends and verifies
 * with get_current_keyboard_profile_index (0x0b). NEVER persists to flash —
 * the board reverts on power loss unless a save* follows with user confirm.
 */
export function encodeWootingProfileSwitch(slot: number, { multiReport = true }: WootingCommandOptions = {}): [Uint8Array, Uint8Array, Uint8Array] {
  return [
    encodeWootingCommand(WOOTING_COMMAND.wootDevInit, 0, 0, 0, 0, { multiReport }),
    encodeWootingProfileCommand(WOOTING_COMMAND.activateProfile, slot, { multiReport }),
    encodeWootingProfileCommand(WOOTING_COMMAND.reloadProfile, slot, { multiReport }),
  ];
}

/**
 * Encode a FLASH-persisting save command (save_rgb_profile 0x08,
 * save_keyboard_profile 0x2A, save_dks_profile 0x2F, save_akc_profile 0x35).
 * The `confirmed` flag is a call-site gate: without it the encoder throws
 * instead of building a flash-overwriting buffer, so no UI drag or slider can
 * persist by accident — only an explicit Save button passing confirmed: true.
 */
export function encodeWootingSaveCommand(
  commandId: number,
  slot: number,
  { multiReport = true, confirmed = false }: WootingCommandOptions & { confirmed?: boolean } = {},
): Uint8Array {
  if (
    commandId !== WOOTING_COMMAND.saveRgbProfile
    && commandId !== WOOTING_COMMAND.saveKeyboardProfile
    && commandId !== WOOTING_COMMAND.saveDksProfile
    && commandId !== WOOTING_COMMAND.saveAkcProfile
  ) throw new Error(`Refusing to encode non-save command 0x${commandId.toString(16)} as a flash write.`);
  if (!confirmed) throw new Error("Refusing to encode a flash write without confirmed: true.");
  return encodeWootingProfileCommand(commandId, slot, { multiReport });
}

/**
 * Encode a single-key RGB set (woot_dev_single_color 0x1E, SDK
 * WOOTING_SINGLE_COLOR_COMMAND): key index + R/G/B. RAM-only — visible until
 * the profile reloads; persists only via save_rgb_profile with confirm.
 * Live 60HE+: `0x1E` answers 0x88 (accepted); `0x1F`/`0x20` answer 0x88;
 * `0x1D` answers 0x66 (no staged RGB to push on this firmware).
 */
export function encodeWootingSingleColor(
  keyIndex: number,
  red: number,
  green: number,
  blue: number,
  { multiReport = true }: WootingCommandOptions = {},
): Uint8Array {
  return encodeWootingCommand(WOOTING_COMMAND.wootDevSingleColor, blue, green, red, keyIndex, { multiReport });
}

/**
 * Encode the full-board RGB buffer (SDK wooting_usb_send_buffer_v3 path):
 * report index 5, magic D1 DA, report id 11, then the 6×21×u16 BGR matrix
 * (252 bytes). The 60HE+ meta uses small packets (SDK uses_small_packets)
 * but the v3 single-write shape is what the ARM firmware accepts on the
 * config interface — confirmed by the SDK's v3 branch, NOT yet by a live
 * Wootility capture, so the driver sends it only from an explicit RGB Apply.
 * Live note: refresh_rgb_colors (0x1D) answers 0x66 on this firmware, so a
 * buffer push that the board will not display must surface "not applied"
 * rather than success (see driver setRgbBuffer).
 */
export const WOOTING_RGB_ROWS = 6;
export const WOOTING_RGB_COLS = 21;
export const WOOTING_RGB_REPORT_ID = 11;
export function encodeWootingRgbBuffer(colors: Uint8Array | readonly number[]): Uint8Array {
  if (colors.length !== WOOTING_RGB_ROWS * WOOTING_RGB_COLS * 2) {
    throw new Error(`RGB buffer must be ${WOOTING_RGB_ROWS * WOOTING_RGB_COLS * 2} bytes, got ${colors.length}.`);
  }
  const buffer = new Uint8Array(4 + colors.length);
  buffer[0] = 5;
  buffer[1] = WOOTING_MAGIC_MULTI;
  buffer[2] = WOOTING_MAGIC_WORD_1;
  buffer[3] = WOOTING_RGB_REPORT_ID;
  buffer.set(colors, 4);
  return buffer;
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
