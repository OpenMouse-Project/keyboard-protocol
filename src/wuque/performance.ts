/**
 * Wuque Studio (BABAO / ZOOM) vendor HID protocol — Performance group (4).
 *
 * Covers per-key trigger tuning (`getPerformance`/`setPerformance`) and the
 * per-row hall-sensor `axisData` multiplexer (ADC / route / calibrate / key
 * status). Reverse-engineered from the vendor configurator bundle
 * `/hub/js/index-Qbh_Aa6s.js` (beautified as `app.pretty.js`) and consistent
 * with a physical BABAO60 HE (`0x1CA6:0x1B10`, protocol 1.2.1.0), which answers
 * every Performance read per key.
 *
 * Wire contract (see `./framing.ts`):
 * - Request = 64-byte output report id 0, `[group, subCommand, ...params]`.
 * - Reply = input report, `[group, subCommand, ...payload]`, payload from byte 2.
 * - Travel-like fields are **fixed point millimetres × 1000** (`toFixed(3)` on
 *   send, `÷ 1000` on receive — vendor helper `qr`, 51584). Axis-data samples
 *   are raw little-endian u16 sensor counts, not scaled.
 * - No status byte: every group-4 decoder starts at payload byte 2 (contrast
 *   the voice/haptic streaming groups, PROTOCOL.md §3).
 *
 * Every decoder returns `null` — never throws — for a short reply, a
 * group/sub-command (or op-code) mismatch, or a board "unsupported" echo
 * (`subCommand === 0xFF`).
 *
 * Evidence line references are into `app.pretty.js`.
 */

import {
  WUQUE_AXIS_COMMAND,
  WUQUE_GROUP,
  WUQUE_PERFORMANCE_COMMAND,
  encodeWuqueCommand,
  isWuqueReply,
  isWuqueUnsupported,
  wuqueTravelMm,
  wuqueTravelRaw,
  wuqueU16,
  wuqueU16Bytes,
} from "./framing.ts";

/** Two zero bytes; the vendor emits `[0,0]` for a zero axis id/range/coefficient. */
const ZERO_U16: readonly [number, number] = [0, 0];

/**
 * Decoded `getPerformance` (sub 1) / `setPerformance` (sub 2) reply — vendor
 * `getPerformanceData`, 52266–52282. Both sub-commands answer with this layout.
 *
 * All `*Mm` fields are millimetres (raw u16 ÷ 1000). `mode`, `axis` and
 * `calibrate` are documented unit-less selector bytes.
 */
export interface WuquePerformanceBlock {
  /**
   * Trigger-mode selector byte (reply[4]). The vendor keeps no enum for it; the
   * value comes from the imported key config model. [INFERENCE: likely
   * normal / rapid-trigger / combined mode]
   */
  mode: number;
  /** Normal actuation point, mm. */
  normalPressMm: number;
  /** Normal release point, mm. */
  normalReleaseMm: number;
  /** Rapid-trigger first-touch sensitivity, mm. */
  rtFirstTouchMm: number;
  /** Rapid-trigger press sensitivity, mm. */
  rtPressMm: number;
  /** Rapid-trigger release sensitivity, mm. */
  rtReleaseMm: number;
  /** Press-side dead-zone stroke, mm. */
  pressDeadStrokeMm: number;
  /** Release-side dead-zone stroke, mm. */
  releaseDeadStrokeMm: number;
  /**
   * Engine axis-type id (reply[19]). Vendor `z2` table (50504): 0 MagneticAxisWired
   * … 16 MagneticAxisWiredGamepad. Kept numeric; the table is not decoded here.
   */
  axis: number;
  /** Calibration flag byte (reply[20]). */
  calibrate: number;
  /** V2 axis-library id (reply[21..22], u16 LE). */
  axisV2Id: number;
  /** V2 axis range maximum (reply[23..24], u16 LE). */
  axisRangeMax: number;
  /** V2 axis coefficient (reply[25..26], u16 LE). */
  axisCoefficient: number;
}

/**
 * Request fields for {@link encodeWuqueSetPerformance}. Travel fields are in
 * millimetres and encoded as mm × 1000.
 *
 * `row`/`col` are matrix coordinates; `axis` is the engine axis-type id. The
 * vendor app zero-fills `calibrate` on a normal write and defaults the
 * `axis*` fields to 0 (56384–56536); the same defaults are applied here.
 */
export interface WuquePerformanceSettings {
  row: number;
  col: number;
  mode: number;
  /** Normal actuation point, mm. */
  normalPressMm: number;
  /** Normal release point, mm; the vendor defaults a missing value to 0. */
  normalReleaseMm?: number;
  /** Rapid-trigger first-touch sensitivity, mm. */
  rtFirstTouchMm: number;
  /** Rapid-trigger press sensitivity, mm. */
  rtPressMm: number;
  /** Rapid-trigger release sensitivity, mm. */
  rtReleaseMm: number;
  /** Press-side dead-zone stroke, mm. */
  pressDeadStrokeMm: number;
  /** Release-side dead-zone stroke, mm. */
  releaseDeadStrokeMm: number;
  /** Engine axis-type id; defaults to 0. */
  axis?: number;
  /** Calibration flag byte; defaults to 0. */
  calibrate?: number;
  /** V2 axis-library id; 0 emits `[0,0]`. */
  axisV2Id?: number;
  /** V2 axis range maximum; 0 emits `[0,0]`. */
  axisRangeMax?: number;
  /** V2 axis coefficient; 0 emits `[0,0]`. */
  axisCoefficient?: number;
}

/** True when `reply` is a GetPerformance/SetPerformance answer with a full body. */
function isPerformanceReply(reply: Uint8Array): boolean {
  if (reply.length < 27) return false;
  if (!isWuqueReply(reply, WUQUE_GROUP.performance)) return false;
  if (isWuqueUnsupported(reply)) return false;
  const sub = reply[1];
  return sub === WUQUE_PERFORMANCE_COMMAND.getPerformance
    || sub === WUQUE_PERFORMANCE_COMMAND.setPerformance;
}

/**
 * Build a `getPerformance` request (group 4, sub 1): `[4,1,row,col]`
 * (vendor builder 52232–52241). The reply is decoded by
 * {@link decodeWuquePerformance}.
 */
export function encodeWuqueGetPerformance(row: number, col: number): Uint8Array {
  return encodeWuqueCommand(WUQUE_GROUP.performance, WUQUE_PERFORMANCE_COMMAND.getPerformance, [
    row,
    col,
  ]);
}

/**
 * Build a `setPerformance` request (group 4, sub 2), vendor builder 52242–52263.
 * Byte order:
 *
 * ```
 * 0  4 (group)            15-16 pressDeadStroke ×1000
 * 1  2 (sub)              17-18 releaseDeadStroke ×1000
 * 2  row     3  col       19    axis
 * 4  mode                 20    calibrate
 * 5-6   normalPress ×1000 21-22 axisV2Id (LE, or 00 00)
 * 7-8   normalRelease     23-24 axisRangeMax (LE, or 00 00)
 * 9-10  rtFirstTouch      25-26 axisCoefficient (LE, or 00 00)
 * 11-12 rtPress
 * 13-14 rtRelease
 * ```
 *
 * The board echoes `[4,2,row,col,...]`; the reply uses the same offset table as
 * `getPerformance`, so it is decoded by {@link decodeWuquePerformance}.
 */
export function encodeWuqueSetPerformance(settings: WuquePerformanceSettings): Uint8Array {
  const {
    row,
    col,
    mode,
    normalPressMm,
    normalReleaseMm = 0,
    rtFirstTouchMm,
    rtPressMm,
    rtReleaseMm,
    pressDeadStrokeMm,
    releaseDeadStrokeMm,
    axis = 0,
    calibrate = 0,
    axisV2Id = 0,
    axisRangeMax = 0,
    axisCoefficient = 0,
  } = settings;

  const params: number[] = [
    row,
    col,
    mode,
    ...wuqueU16Bytes(wuqueTravelRaw(normalPressMm)),
    ...wuqueU16Bytes(wuqueTravelRaw(normalReleaseMm)),
    ...wuqueU16Bytes(wuqueTravelRaw(rtFirstTouchMm)),
    ...wuqueU16Bytes(wuqueTravelRaw(rtPressMm)),
    ...wuqueU16Bytes(wuqueTravelRaw(rtReleaseMm)),
    ...wuqueU16Bytes(wuqueTravelRaw(pressDeadStrokeMm)),
    ...wuqueU16Bytes(wuqueTravelRaw(releaseDeadStrokeMm)),
    axis,
    calibrate,
    ...(axisV2Id === 0 ? ZERO_U16 : wuqueU16Bytes(axisV2Id)),
    ...(axisRangeMax === 0 ? ZERO_U16 : wuqueU16Bytes(axisRangeMax)),
    ...(axisCoefficient === 0 ? ZERO_U16 : wuqueU16Bytes(axisCoefficient)),
  ];

  return encodeWuqueCommand(
    WUQUE_GROUP.performance,
    WUQUE_PERFORMANCE_COMMAND.setPerformance,
    params,
  );
}

/**
 * Decode a `getPerformance` (sub 1) or `setPerformance` (sub 2) reply
 * (vendor `getPerformanceData`, 52266–52282). Returns `null` for a short
 * (<27 bytes) reply, a mismatched group/sub-command echo, or an unsupported
 * (`0xFF`) echo.
 */
export function decodeWuquePerformance(reply: Uint8Array): WuquePerformanceBlock | null {
  if (!isPerformanceReply(reply)) return null;
  return {
    mode: reply[4]!,
    normalPressMm: wuqueTravelMm(wuqueU16(reply, 5)!),
    normalReleaseMm: wuqueTravelMm(wuqueU16(reply, 7)!),
    rtFirstTouchMm: wuqueTravelMm(wuqueU16(reply, 9)!),
    rtPressMm: wuqueTravelMm(wuqueU16(reply, 11)!),
    rtReleaseMm: wuqueTravelMm(wuqueU16(reply, 13)!),
    pressDeadStrokeMm: wuqueTravelMm(wuqueU16(reply, 15)!),
    releaseDeadStrokeMm: wuqueTravelMm(wuqueU16(reply, 17)!),
    axis: reply[19]!,
    calibrate: reply[20]!,
    axisV2Id: wuqueU16(reply, 21)!,
    axisRangeMax: wuqueU16(reply, 23)!,
    axisCoefficient: wuqueU16(reply, 25)!,
  };
}

/**
 * Decoded `axisData` (group 4, sub 3) reply — shared by all four ops
 * (vendor `getADCData`/`getRouteData`/`getCalibrateData`/`getKeyStatusData`,
 * 52287–52398; all four bodies are byte-identical).
 */
export interface WuqueAxisReading {
  /**
   * Echoed axis-data op (reply[2]): {@link WUQUE_AXIS_COMMAND}.adc = 0,
   * `.route` = 1, `.calibrate` = 2, `.keyStatus` = 3. The vendor decoder labels
   * this byte `adc`/`route`/`calibrate` per op (and, by copy-paste, `calibrate`
   * for key status too) — it is always the echoed op code.
   */
  op: number;
  /** Matrix row (reply[3]). */
  row: number;
  /** Raw little-endian u16 samples, reply[4] to the end of the report. */
  data: number[];
}

/** True when `reply` answers group-4 `axisData` and echoes `op`. */
function isAxisReply(reply: Uint8Array, op: number): boolean {
  if (reply.length < 4) return false;
  if (!isWuqueReply(reply, WUQUE_GROUP.performance, WUQUE_PERFORMANCE_COMMAND.axisData)) {
    return false;
  }
  if (isWuqueUnsupported(reply)) return false;
  return reply[2] === op;
}

/** Decode a `[4,3,op,row,...]` axis-data reply; see {@link WuqueAxisReading}. */
function decodeWuqueAxisData(reply: Uint8Array, op: number): WuqueAxisReading | null {
  if (!isAxisReply(reply, op)) return null;
  const data: number[] = [];
  for (let at = 4; at + 1 < reply.length; at += 2) {
    data.push(wuqueU16(reply, at)!);
  }
  return { op: reply[2]!, row: reply[3]!, data };
}

/**
 * Build a per-row ADC read: `[4,3,0,row]` (vendor `getADC`, 52283–52286). The
 * reply is decoded by {@link decodeWuqueAxisAdc}.
 */
export function encodeWuqueAxisAdc(row: number): Uint8Array {
  return encodeWuqueCommand(WUQUE_GROUP.performance, WUQUE_PERFORMANCE_COMMAND.axisData, [
    WUQUE_AXIS_COMMAND.adc,
    row,
  ]);
}

/**
 * Build a per-row axis-route read: `[4,3,1,row]` (vendor `getRoute`,
 * 52311–52314). The reply is decoded by {@link decodeWuqueAxisRoute}.
 */
export function encodeWuqueAxisRoute(row: number): Uint8Array {
  return encodeWuqueCommand(WUQUE_GROUP.performance, WUQUE_PERFORMANCE_COMMAND.axisData, [
    WUQUE_AXIS_COMMAND.route,
    row,
  ]);
}

/**
 * Build a per-row calibration-status read: `[4,3,2,row]` (vendor `getCalibrate`
 * / controller `getCalibrationStatus`, 52339–52342, 57180–57182). The reply is
 * decoded by {@link decodeWuqueAxisCalibrate}.
 */
export function encodeWuqueAxisCalibrate(row: number): Uint8Array {
  return encodeWuqueCommand(WUQUE_GROUP.performance, WUQUE_PERFORMANCE_COMMAND.axisData, [
    WUQUE_AXIS_COMMAND.calibrate,
    row,
  ]);
}

/**
 * Build a per-row key-status read: `[4,3,3,row]` (vendor `getKeyStatus`,
 * 52367–52370). The reply is decoded by {@link decodeWuqueAxisKeyStatus}.
 */
export function encodeWuqueAxisKeyStatus(row: number): Uint8Array {
  return encodeWuqueCommand(WUQUE_GROUP.performance, WUQUE_PERFORMANCE_COMMAND.axisData, [
    WUQUE_AXIS_COMMAND.keyStatus,
    row,
  ]);
}

/**
 * Decode a `getADC` reply (op 0). Returns `null` for a short (<4 bytes) reply, a
 * mismatched group/sub-command/op echo, or an unsupported (`0xFF`) echo.
 * Samples are raw u16 sensor counts.
 */
export function decodeWuqueAxisAdc(reply: Uint8Array): WuqueAxisReading | null {
  return decodeWuqueAxisData(reply, WUQUE_AXIS_COMMAND.adc);
}

/** Decode a `getRoute` reply (op 1); `null` on any mismatch. */
export function decodeWuqueAxisRoute(reply: Uint8Array): WuqueAxisReading | null {
  return decodeWuqueAxisData(reply, WUQUE_AXIS_COMMAND.route);
}

/** Decode a `getCalibrate` (calibration status) reply (op 2); `null` on any mismatch. */
export function decodeWuqueAxisCalibrate(reply: Uint8Array): WuqueAxisReading | null {
  return decodeWuqueAxisData(reply, WUQUE_AXIS_COMMAND.calibrate);
}

/** Decode a `getKeyStatus` reply (op 3); `null` on any mismatch. */
export function decodeWuqueAxisKeyStatus(reply: Uint8Array): WuqueAxisReading | null {
  return decodeWuqueAxisData(reply, WUQUE_AXIS_COMMAND.keyStatus);
}
