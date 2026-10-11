import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeWuqueBlackout,
  decodeWuqueConfigSwitch,
  decodeWuqueDeviceFeature,
  decodeWuqueDeviceInfo,
  decodeWuqueDoubleLighting,
  decodeWuqueEffectArea,
  decodeWuqueKeyboardColor,
  decodeWuqueKeyCode,
  decodeWuqueKeyLayout,
  decodeWuqueKeyLayoutStyle,
  decodeWuqueLightingBase,
  decodeWuqueLightingColorCorrection,
  decodeWuqueLightingCustom,
  decodeWuqueMacroMode,
  decodeWuqueMacroSpaceInfo,
  decodeWuquePerformance,
  decodeWuqueProtocolVersion,
  decodeWuqueReportRate,
  decodeWuqueReportRateList,
  decodeWuqueRtPrecision,
  decodeWuqueShakeOptimization,
  decodeWuqueSleepTime,
  decodeWuqueSpecialLighting,
  decodeWuqueSystemSetting,
  decodeWuqueUsbModeStatus,
  encodeWuqueAxisAdc,
  encodeWuqueBlackoutGet,
  encodeWuqueBlackoutSet,
  encodeWuqueConfigSwitch,
  encodeWuqueDeviceFeature,
  encodeWuqueDeviceInfo,
  encodeWuqueDeviceProtocol,
  encodeWuqueGetKeyCode,
  encodeWuqueGetKeyLayout,
  encodeWuqueGetKeyLayoutStyle,
  encodeWuqueGetLightingBase,
  encodeWuqueGetLightingCustom,
  encodeWuqueGetMacroMode,
  encodeWuqueGetPerformance,
  encodeWuqueGfsRestore,
  encodeWuqueGfsParamSave,
  encodeWuqueHighPollingRateReset,
  encodeWuqueKeyboardColorGet,
  encodeWuqueKeyboardColorSet,
  encodeWuqueLightingCaps,
  encodeWuqueLightingDirectDrive,
  encodeWuqueMacroSpaceInfo,
  encodeWuqueReportRateSetting,
  encodeWuqueRtPrecisionQuery,
  encodeWuqueSetKeyCode,
  encodeWuqueSetLightingBase,
  encodeWuqueSetMacro,
  encodeWuqueSetMacroMode,
  encodeWuqueShakeOptimizationGet,
  encodeWuqueShakeOptimizationSet,
  encodeWuqueSleepTimeGet,
  encodeWuqueSleepTimeSet,
  encodeWuqueSystemSetting,
  encodeWuqueUsbModeStatus,
  isWuqueReply,
  isWuqueUnsupported,
  wuqueKeycodeCategory,
  wuqueMatrixKeyLabel,
  wuqueKeycodeLabel,
  WUQUE_KEYCODE_LABELS,
  wuquePackMacroEvent,
  wuqueReplyPayload,
  wuqueTravelMm,
  wuqueUnpackMacroEvent,
  wuqueU16,
  wuqueU32,
  WUQUE_GROUP,
  WUQUE_LIST_ACCESS,
  WUQUE_SAVE_SCOPE,
  WUQUE_ACCESS,
  WUQUE_SYSTEM,
  WUQUE_UNSUPPORTED,
  WUQUE_USB_MODE,
  WUQUE_REPORT_RATE,
  WUQUE_LIGHTING_AREA,
  WUQUE_LIGHTING_BLOCK,
} from "./index.ts";

/** Frame bytes as the wire carries them: 64 bytes, zero-padded. */
function reply(bytes: readonly number[]): Uint8Array {
  const out = new Uint8Array(64);
  bytes.forEach((value, index) => (out[index] = value));
  return out;
}

/** Compare a request frame against its first `length` bytes. */
function expectFrame(frame: Uint8Array, bytes: readonly number[], length = bytes.length): void {
  assert.equal(frame.length, 64);
  assert.deepEqual(Array.from(frame.slice(0, length)), bytes);
  assert.ok(
    frame.slice(length).every((byte) => byte === 0),
    `bytes after ${length} must stay zero-padded`,
  );
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

test("requests are 64 bytes with group, sub-command and little-endian params", () => {
  expectFrame(encodeWuqueGetKeyCode(1, 2, 3), [3, 3, 1, 2, 3]);
  expectFrame(encodeWuqueSleepTimeSet(0x1234), [2, 13, 0, 0x34, 0x12]);
  expectFrame(encodeWuqueSetKeyCode(0, 1, 2, 0x1e00), [3, 4, 0, 1, 2, 0x00, 0x1e]);
});

test("reply helpers accept only a matching echo and flag the unsupported marker", () => {
  const good = reply([1, 1, 1, 2, 1, 0]);
  assert.equal(isWuqueReply(good, 1, 1), true);
  assert.equal(isWuqueReply(good, 2, 1), false);
  assert.equal(isWuqueUnsupported(good), false);
  assert.equal(isWuqueUnsupported(reply([18, WUQUE_UNSUPPORTED])), true);
  assert.deepEqual(Array.from(wuqueReplyPayload(good, 1, 1)!.slice(0, 4)), [1, 2, 1, 0]);
  assert.equal(wuqueReplyPayload(good, 2, 1), null);
  assert.equal(wuqueReplyPayload(new Uint8Array([1]), 1, 1), null);
  assert.equal(wuqueReplyPayload(null, 1, 1), null);
});

test("u16/u32 readers and travel conversion follow the mm×1000 convention", () => {
  assert.equal(wuqueU16(reply([0, 0, 0x34, 0x12]), 2), 0x1234);
  assert.equal(wuqueU16(new Uint8Array([0]), 1), null);
  assert.equal(wuqueU32(reply([0, 0, 0x78, 0x56, 0x34, 0x12]), 2), 0x12345678);
  assert.equal(wuqueTravelMm(2000), 2);
  assert.equal(wuqueTravelMm(300), 0.3);
});

// ---------------------------------------------------------------------------
// Device identity (group 1) — bytes captured from a BABAO60 HE, protocol 1.2.1.0
// ---------------------------------------------------------------------------

test("device protocol request and hardware reply decode", () => {
  expectFrame(encodeWuqueDeviceProtocol(), [1, 1]);
  assert.deepEqual(decodeWuqueProtocolVersion(reply([1, 1, 1, 2, 1, 0])), {
    mainVersion: 1,
    subVersion: 2,
    hardwareVersion: 1,
    softwareVersion: 0,
  });
  assert.equal(decodeWuqueProtocolVersion(new Uint8Array([1, 1, 1, 2])), null);
  assert.equal(decodeWuqueProtocolVersion(reply([2, 1, 1, 2, 1, 0])), null);
});

test("device info request and hardware reply decode", () => {
  expectFrame(encodeWuqueDeviceInfo(), [1, 2]);
  // Captured frame structure with a synthetic device serial.
  const captured = reply([
    1, 2, 1, 0, 0, 0x1b, 0, 0x10, 2, 1, 1, 0, 1, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    11, 12, 0x32, 0x30, 0x32, 0x36, 0x30, 0x39, 0x31, 0x35, 0x31, 0x34, 0x3a, 0x32, 0x31, 0x3a, 0x33, 0x32,
  ]);
  assert.deepEqual(decodeWuqueDeviceInfo(captured), {
    boardId: 1769488,
    appVersion: "2.1.1.0",
    pcbVersion: "1-0-0-0",
    runModeVersion: 0,
    sn: "123456789101112",
    timestamp: "2026091514:2",
  });
});

test("device feature reply decode marks the magnetic axis and USB link", () => {
  expectFrame(encodeWuqueDeviceFeature(), [1, 3]);
  const feature = decodeWuqueDeviceFeature(reply([1, 3, 2, 1, 1, 0]));
  assert.equal(feature?.axisType.magnetic, true);
  assert.equal(feature?.axisType.mechanical, false);
  assert.equal(feature?.connectionMode.usb, true);
  assert.equal(feature?.connectionMode.usb3, false);
  assert.equal(feature?.basicFunctions.rgbLighting, true);
  assert.equal(feature?.extendedFunctions.voicePlayback, false);
});

// ---------------------------------------------------------------------------
// Global settings (group 2) and CustomCommand (group 10)
// ---------------------------------------------------------------------------

test("global requests carry the access selector byte", () => {
  expectFrame(encodeWuqueConfigSwitch(WUQUE_LIST_ACCESS.read), [2, 3, 1]);
  expectFrame(encodeWuqueConfigSwitch(WUQUE_LIST_ACCESS.readList), [2, 3, 0]);
  expectFrame(encodeWuqueConfigSwitch(WUQUE_LIST_ACCESS.write, 2), [2, 3, 2, 2]);
  expectFrame(encodeWuqueSystemSetting(WUQUE_ACCESS.read), [2, 4, 1]);
  expectFrame(encodeWuqueSystemSetting(WUQUE_ACCESS.write, WUQUE_SYSTEM.mac), [2, 4, 2, 1]);
  expectFrame(encodeWuqueReportRateSetting(WUQUE_LIST_ACCESS.readList), [2, 5, 0]);
  expectFrame(encodeWuqueReportRateSetting(WUQUE_LIST_ACCESS.read), [2, 5, 1]);
  expectFrame(encodeWuqueReportRateSetting(WUQUE_LIST_ACCESS.write, WUQUE_REPORT_RATE.r1khz), [2, 5, 2, 3]);
});

test("global scope, sleep, shake and query frames match the vendor app", () => {
  expectFrame(encodeWuqueGfsRestore(WUQUE_SAVE_SCOPE.all), [2, 1, 0]);
  expectFrame(encodeWuqueGfsParamSave(WUQUE_SAVE_SCOPE.lighting), [2, 2, 3]);
  expectFrame(encodeWuqueHighPollingRateReset(), [2, 15, 1]);
  expectFrame(encodeWuqueSleepTimeGet(), [2, 13, 1]);
  expectFrame(encodeWuqueShakeOptimizationGet(), [2, 16, 1]);
  expectFrame(encodeWuqueShakeOptimizationSet(false), [2, 16, 0, 0]);
  expectFrame(encodeWuqueMacroSpaceInfo(), [2, 14, 0]);
  expectFrame(encodeWuqueRtPrecisionQuery(), [2, 12, 0]);
  expectFrame(encodeWuqueUsbModeStatus(), [18, 1]);
});

test("hardware global replies decode", () => {
  assert.deepEqual(decodeWuqueSystemSetting(reply([2, 4, 1, 0])), { key: "win", value: 0 });
  assert.deepEqual(decodeWuqueConfigSwitch(reply([2, 3, 1, 0])), { key: "config1", value: 0 });
  assert.deepEqual(decodeWuqueReportRateList(reply([2, 5, 0, 6, 0, 1, 2, 3, 4, 5])), {
    total: 6,
    list: ["r8khz", "r4khz", "r2khz", "r1khz", "r500hz", "r250hz"],
  });
  assert.deepEqual(decodeWuqueReportRate(reply([2, 5, 1, 0])), { key: "r8khz", value: 0 });
  assert.deepEqual(decodeWuqueMacroSpaceInfo(reply([2, 14, 0, 16, 0xc0, 3])), { macroCount: 16, macroNumber: 960 });
  assert.deepEqual(decodeWuqueRtPrecision(reply([2, 12, 0, 1, 1])), { min: 0.001 });
  assert.deepEqual(decodeWuqueShakeOptimization(reply([2, 16, 1, 1])), { enabled: true, status: 1 });
  assert.deepEqual(decodeWuqueSleepTime(reply([2, 13, 1, 0, 0])), 0);
  assert.deepEqual(decodeWuqueEffectArea(reply([2, 8, 0, 1, 0, 20, 6, 15])), {
    total: 1,
    areas: [{ index: 0, count: 20, rows: 6, cols: 15 }],
  });
  assert.deepEqual(decodeWuqueDoubleLighting(reply([2, 10, 0, 0])), { doubleLighting: 0 });
  assert.deepEqual(decodeWuqueSpecialLighting(reply([2, 11, 0, 2])), { specialLighting: 5 });
});

test("a group the firmware does not implement decodes to null", () => {
  // 60 HE 1.2.1.0 answers the USB-mode group with the 0xFF sub-command marker.
  assert.equal(decodeWuqueUsbModeStatus(reply([18, WUQUE_UNSUPPORTED])), null);
});

test("blackout and shell colour frames follow the vendor byte order", () => {
  expectFrame(encodeWuqueBlackoutGet(), [10, 1, 0]);
  expectFrame(encodeWuqueBlackoutSet(true), [10, 1, 1, 255]);
  expectFrame(encodeWuqueBlackoutSet(false), [10, 1, 1, 0]);
  expectFrame(encodeWuqueKeyboardColorGet(), [10, 1, 1]);
  expectFrame(encodeWuqueKeyboardColorSet({ r: 1, g: 2, b: 3 }), [10, 1, 2, 255, 3, 2, 1]);
  assert.deepEqual(decodeWuqueBlackout(reply([10, 1, 0, 0])), { open: false });
  assert.deepEqual(decodeWuqueKeyboardColor(reply([10, 1, 1, 0, 3, 2, 1])), { r: 1, g: 2, b: 3 });
});

// ---------------------------------------------------------------------------
// Layout and keycodes (group 3)
// ---------------------------------------------------------------------------

test("key requests address layer, row and column", () => {
  expectFrame(encodeWuqueGetKeyLayout(0, 1), [3, 1, 0, 1]);
  expectFrame(encodeWuqueGetKeyCode(2, 3, 4), [3, 3, 2, 3, 4]);
  expectFrame(encodeWuqueGetKeyLayoutStyle(5), [3, 5, 5]);
});

test("hardware key layout and keycode replies decode", () => {
  const row = reply([3, 1, 0, 1, 0x29, 0, 0x1e, 0, 0x1f, 0, 0x20, 0, 0x21, 0, 0x22, 0, 0x23, 0, 0x24, 0, 0x25, 0, 0x26, 0, 0x27, 0, 0x2d, 0, 0x2e, 0, 0x2a, 0]);
  assert.deepEqual(decodeWuqueKeyLayout(row)?.keycodes.slice(0, 14), [41, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 45, 46, 42]);
  assert.deepEqual(decodeWuqueKeyLayout(row)?.keycodes.slice(14), Array(7).fill(0));
  assert.deepEqual(decodeWuqueKeyCode(reply([3, 3, 0, 1, 0, 0x29, 0])), { layer: 0, row: 1, col: 0, keycode: 41 });
});

test("style pack entries keep the quarter-cell positions", () => {
  const style = decodeWuqueKeyLayoutStyle(reply([3, 5, 5, 0x02, 0xa0, 0x52, 0xa0, 0xa2, 0xa0]));
  assert.equal(style?.index, 5);
  assert.deepEqual(style?.entries[0], { row: 5, col: 0, ratio: 2, type: "key" });
  assert.deepEqual(style?.entries[1], { row: 5, col: 1.25, ratio: 2, type: "key" });
});

test("keycode labels come from the vendor name table only", () => {
  assert.equal(Object.keys(WUQUE_KEYCODE_LABELS).length, 283);
  assert.equal(wuqueKeycodeLabel(0x29), "Esc");
  assert.equal(wuqueKeycodeLabel(0xe0), "L-Ctrl");
  assert.equal(wuqueKeycodeLabel(0x2c), "Space");
  assert.equal(wuqueKeycodeLabel(0x46), "PrtScr");
  assert.equal(wuqueKeycodeLabel(0xf100), "Fn0");
  assert.equal(wuqueKeycodeLabel(0xf500), "M0");
  assert.equal(wuqueKeycodeLabel(0x206f), "Bri+");
  // Not in the vendor table or deliberately unnamed: null, never a guess.
  assert.equal(wuqueKeycodeLabel(0xf20a), null);
  assert.equal(wuqueMatrixKeyLabel(0x2a), "Bksp");
  assert.equal(wuqueMatrixKeyLabel(0x4c), "Del");
  assert.equal(wuqueMatrixKeyLabel(0x29), "Esc");
  assert.equal(wuqueMatrixKeyLabel(0xf20a), null);
  assert.equal(wuqueKeycodeLabel(0x1234), null);
  for (const label of Object.values(WUQUE_KEYCODE_LABELS)) {
    assert.ok(!label.includes(" "), `no spaces in button label: ${label}`);
  }
});

test("keycodes map onto the vendor category table", () => {
  assert.equal(wuqueKeycodeCategory(0x29), "basic");
  assert.equal(wuqueKeycodeCategory(0xf500), "macro");
  assert.equal(wuqueKeycodeCategory(0x4000), "mouse");
  assert.equal(wuqueKeycodeCategory(0), "special");
  assert.equal(wuqueKeycodeCategory(0x1234), null);
});

// ---------------------------------------------------------------------------
// Performance (group 4)
// ---------------------------------------------------------------------------

test("performance request and hardware reply decode", () => {
  expectFrame(encodeWuqueGetPerformance(1, 0), [4, 1, 1, 0]);
  expectFrame(encodeWuqueAxisAdc(1), [4, 3, 0, 1]);
  const block = decodeWuquePerformance(
    reply([
      4, 1, 1, 0, 0, 0xd0, 7, 0xd0, 7, 0xf4, 1, 0x2c, 1, 0x2c, 1, 0xc8, 0, 0xc8, 0, 0, 0, 0xb0, 0x37, 0x7a, 0x0d, 0x80,
      0x55,
    ]),
  );
  assert.equal(block?.normalPressMm, 2);
  assert.equal(block?.normalReleaseMm, 2);
  assert.equal(block?.rtFirstTouchMm, 0.5);
  assert.equal(block?.rtPressMm, 0.3);
  assert.equal(block?.rtReleaseMm, 0.3);
  assert.equal(block?.pressDeadStrokeMm, 0.2);
  assert.equal(block?.releaseDeadStrokeMm, 0.2);
});

// ---------------------------------------------------------------------------
// Lighting (group 5)
// ---------------------------------------------------------------------------

test("lighting requests match the vendor frames", () => {
  expectFrame(encodeWuqueGetLightingBase(WUQUE_LIGHTING_AREA.keyboard, WUQUE_LIGHTING_BLOCK.base), [5, 1, 0, 0]);
  expectFrame(encodeWuqueGetLightingBase(WUQUE_LIGHTING_AREA.keyboard, WUQUE_LIGHTING_BLOCK.palette), [5, 1, 0, 1]);
  expectFrame(encodeWuqueGetLightingCustom(WUQUE_LIGHTING_AREA.keyboard, 0), [5, 3, 0, 0]);
  expectFrame(encodeWuqueLightingDirectDrive(WUQUE_LIGHTING_AREA.keyboard, 0, [{ r: 1, g: 2, b: 3, isCustom: false }]), [
    5, 5, 0, 0, 3, 2, 1, 0,
  ]);
  expectFrame(encodeWuqueLightingCaps({ r: 1, g: 2, b: 3 }), [5, 6, 3, 1, 2]);
  expectFrame(
    encodeWuqueSetLightingBase({ area: 0, block: 0, open: true, mode: 17, luminance: 80, speed: 40, direction: 0, selectStaticColor: 7 }),
    [5, 2, 0, 0, 1, 17, 80, 40, 0, 7],
    10,
  );
});

test("lighting replies decode in the vendor channel order", () => {
  assert.deepEqual(decodeWuqueLightingBase(reply([5, 1, 0, 0, 1, 0x11, 0x50, 0x28, 0, 7])), {
    area: 0,
    openCode: 1,
    open: true,
    mode: 17,
    luminance: 80,
    speed: 40,
    direction: 0,
    selectStaticColor: 7,
  });
  assert.deepEqual(decodeWuqueLightingColorCorrection(reply([5, 1, 0, 2, 0x64, 0x3c, 0x64])), { r: 100, g: 60, b: 100 });
  const leds = decodeWuqueLightingCustom(reply([5, 3, 0, 0, 3, 2, 1, 255, 0, 0, 0, 0]));
  assert.deepEqual(leds?.[0], { b: 3, g: 2, r: 1, isCustom: true });
  assert.deepEqual(leds?.[1], { b: 0, g: 0, r: 0, isCustom: false });
});

// ---------------------------------------------------------------------------
// Macros (group 7)
// ---------------------------------------------------------------------------

test("macro requests and packed events round-trip", () => {
  expectFrame(encodeWuqueGetMacroMode(3), [7, 1, 3]);
  expectFrame(encodeWuqueSetMacroMode({ macroId: 3, valid: true, actNum: 7, repNum: 0, mode: 0 }), [
    7, 2, 3, 1, 7, 0, 0, 0, 0,
  ]);
  const packed = wuquePackMacroEvent({ status: 1, delay: 100, keyCode: 22 });
  assert.equal(packed, 2154037270);
  assert.deepEqual(wuqueUnpackMacroEvent(packed!), { status: 1, delay: 100, keyCode: 22 });
  assert.equal(wuquePackMacroEvent({ status: 0, delay: 32768, keyCode: 4 }), null);

  const frame = encodeWuqueSetMacro(0, 0, [{ status: 0, delay: 15, keyCode: 4 }]);
  // One packed u32 LE per event: delay in bits 16-30, keycode in bits 0-15.
  expectFrame(frame!, [7, 4, 0, 0, 4, 0, 15, 0, 0, 0, 0, 0], 12);
});

test("hardware macro replies decode", () => {
  assert.deepEqual(decodeWuqueMacroMode(reply([7, 1, 0, 1, 0, 0, 0, 0, 0])), {
    macroId: 0,
    valid: true,
    actNum: 0,
    repNum: 0,
    mode: 0,
  });
});

// ---------------------------------------------------------------------------
// Robustness
// ---------------------------------------------------------------------------

test("truncated or mismatched replies never throw", () => {
  const decoders = [
    decodeWuqueProtocolVersion,
    decodeWuqueDeviceInfo,
    decodeWuqueDeviceFeature,
    decodeWuqueSystemSetting,
    decodeWuqueConfigSwitch,
    decodeWuqueReportRate,
  decodeWuqueReportRateList,
    decodeWuqueRtPrecision,
    decodeWuqueShakeOptimization,
    decodeWuqueSleepTime,
    decodeWuqueMacroSpaceInfo,
    decodeWuqueEffectArea,
    decodeWuqueDoubleLighting,
    decodeWuqueSpecialLighting,
    decodeWuqueUsbModeStatus,
    decodeWuqueKeyLayout,
    decodeWuqueKeyCode,
    decodeWuqueKeyLayoutStyle,
    decodeWuquePerformance,
    decodeWuqueLightingBase,
    decodeWuqueLightingColorCorrection,
    decodeWuqueLightingCustom,
    decodeWuqueBlackout,
    decodeWuqueKeyboardColor,
    decodeWuqueMacroMode,
  ];
  for (const decode of decoders) {
    assert.equal(decode(new Uint8Array(0)), null, `${decode.name} on empty reply`);
    assert.equal(decode(reply([0xff, 0xff])), null, `${decode.name} on junk reply`);
    assert.equal(decode(reply([9, 9, 9])), null, `${decode.name} on foreign group`);
    // A matching echo with a truncated payload must not throw either.
    assert.doesNotThrow(() => decode(reply([1, 2, 3])));
  }
  assert.equal(WUQUE_GROUP.layoutAndKey, 3);
  assert.equal(WUQUE_USB_MODE.usb3_0_32k, 3);
});
