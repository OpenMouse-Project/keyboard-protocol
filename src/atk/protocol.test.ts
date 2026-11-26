import assert from "node:assert/strict";
import test from "node:test";
import {
  ATK_ADVANCED_MODE, ATK_COMMAND, ATK_CUSTOM_ID, ATK_FRAME_LENGTH, ATK_KEYBOARDS, ATK_LIGHT_ZONE, ATK_SLEEP_NEVER, ATK_VENDOR_ID,
  atkBuildClearAdvancedKey, atkBuildGetAdvancedKey, atkBuildGetDeadZone, atkBuildGetFeature, atkBuildGetFirmware, atkBuildGetFlag,
  atkBuildGetKeyLight, atkBuildGetKeymapChunk, atkBuildGetKeyRapidTrigger, atkBuildGetKeyTravel, atkBuildGetLightConfig,
  atkBuildGetProtocolVersion, atkBuildGetReportRate, atkBuildGetSleep, atkBuildGetTravelLimits, atkBuildGetZoneLight, atkBuildMt,
  atkBuildSetAdvancedKey, atkBuildSetDeadZone, atkBuildSetDks, atkBuildSetFeature, atkBuildSetFlag, atkBuildSetKeyLight,
  atkBuildSetKeyRapidTrigger, atkBuildSetKeyTravel, atkBuildSetLightConfig, atkBuildSetReportRate, atkBuildSetSleep,
  atkBuildSetZoneLight, atkBuildTgl, atkCustomGet, atkCustomSet, atkDecodeAdvancedKey, atkDecodeDeadZone, atkDecodeFeature,
  atkDecodeFirmware, atkDecodeFlag, atkDecodeKeyLight, atkDecodeKeymap, atkDecodeKeyRapidTrigger, atkDecodeKeyTravel,
  atkDecodeLightConfig, atkDecodeProtocolVersion, atkDecodeReportRate, atkDecodeSleep, atkDecodeTravelLimits, atkDecodeZoneLight,
  atkFrame, atkIsFirmwareV2, atkKeyboardProduct, atkKeymapChunks, atkReplyMatches, atkZoneChannel,
} from "./index.ts";

const hex = (frame: Uint8Array): string => Buffer.from(frame).toString("hex");

function reply(...bytes: number[]): Uint8Array {
  const frame = new Uint8Array(ATK_FRAME_LENGTH);
  bytes.forEach((value, index) => { frame[index] = value; });
  return frame;
}

const ORACLE: ReadonlyArray<readonly [string, Uint8Array, string]> = [
  ["protocol", atkBuildGetProtocolVersion(), "0100000000000000000000000000000000000000000000000000000000000000"],
  ["version", atkBuildGetFirmware(), "0296000000000000000000000000000000000000000000000000000000000000"],
  ["travelInfo", atkBuildGetTravelLimits(), "0296240000000000000000000000000000000000000000000000000000000000"],
  ["deadGet", atkBuildGetDeadZone(), "02960b0000000000000000000000000000000000000000000000000000000000"],
  ["deadSet", atkBuildSetDeadZone({ top: 0.35, bottom: 0.2 }), "03960b015e00c800000000000000000000000000000000000000000000000000"],
  ["featureGet", atkBuildGetFeature(), "0296110000000000000000000000000000000000000000000000000000000000"],
  ["featureSet", atkBuildSetFeature({ rgbArea: 1, exchangeWasd: 1, macMode: 0, winLock: 1, nkro: 2 }), "0396110101000102000000000000000000000000000000000000000000000000"],
  ["flagGet", atkBuildGetFlag("gameMode"), "02961e0000000000000000000000000000000000000000000000000000000000"],
  ["flagSet", atkBuildSetFlag("gameMode", true), "03961e0100000000000000000000000000000000000000000000000000000000"],
  ["sleepGet", atkBuildGetSleep(), "0296260000000000000000000000000000000000000000000000000000000000"],
  ["sleepSet", atkBuildSetSleep(300), "0396260500000000000000000000000000000000000000000000000000000000"],
  ["sleepNever", atkBuildSetSleep(ATK_SLEEP_NEVER), "0396260000000000000000000000000000000000000000000000000000000000"],
  ["rateGet", atkBuildGetReportRate(), "0296460000000000000000000000000000000000000000000000000000000000"],
  ["lightGet", atkBuildGetLightConfig(), "0841000000000000000000000000000000000000000000000000000000000000"],
  ["lightSet", atkBuildSetLightConfig({ effect: 6, speed: 3, color: [10, 20, 30], brightness: 200, colorful: true }), "07410600030a141ec80100000000000000000000000000000000000000000000"],
  ["zoneGetV1", atkBuildGetZoneLight(ATK_LIGHT_ZONE.logo, false), "0296210000000000000000000000000000000000000000000000000000000000"],
  ["zoneSetV1", atkBuildSetZoneLight(ATK_LIGHT_ZONE.side, false, { effect: 2, colorful: false, brightness: 5, speed: 4, color: [1, 2, 3] }), "0396270200050401020300000000000000000000000000000000000000000000"],
  ["zoneGetV2", atkBuildGetZoneLight(ATK_LIGHT_ZONE.front, true), "029653f200000000000000000000000000000000000000000000000000000000"],
  ["zoneSetV2", atkBuildSetZoneLight(ATK_LIGHT_ZONE.button, true, { effect: 3, colorful: true, brightness: 9, speed: 8, color: [7, 8, 9] }), "03965303010908070809f3000000000000000000000000000000000000000000"],
  ["keyLightGet", atkBuildGetKeyLight(12), "02964b0c00000000000000000000000000000000000000000000000000000000"],
  ["keyLightSet", atkBuildSetKeyLight(12, [1, 2, 3]), "03964b0c01020300000000000000000000000000000000000000000000000000"],
  ["travelGet", atkBuildGetKeyTravel(2, 5), "0296030205000000000000000000000000000000000000000000000000000000"],
  ["travelSet", atkBuildSetKeyTravel(2, 5, 1.25), "039603020504e200000000000000000000000000000000000000000000000000"],
  ["rtGet", atkBuildGetKeyRapidTrigger(2, 5), "0296070205000000000000000000000000000000000000000000000000000000"],
  ["rtSet", atkBuildSetKeyRapidTrigger(2, 5, { enabled: true, press: 0.3, release: 0.2 }), "03960702050100c8012c00000000000000000000000000000000000000000000"],
  ["advGet", atkBuildGetAdvancedKey(4), "0296200000010400040000000000000000000000000000000000000000000000"],
  ["advSetRs", atkBuildSetAdvancedKey(4, { mode: 1, point: 1.5, rt: true, key1: [0, 0x1a], key2: [0, 0x16], layer: 0 }), "03962000000304010405dc0001001a0016000000000000000000000000000000"],
  ["advSetOks", atkBuildSetAdvancedKey(7, { mode: 6, point: 0.8, key1: [0, 4], key2: [0, 5], layer: 1, triggerDelay: 300, keyDelay: 20 }), "039620000003070607032000000004000501012c001400000000000000000000"],
  ["advClear", atkBuildClearAdvancedKey(4), "0396200000030400040000000000000000000000000000000000000000000000"],
  ["mt", atkBuildMt(3, 0x04, 0xe1, 200), "fe0d0203000400e100c800000000000000000000000000000000000000000000"],
  ["tgl", atkBuildTgl(3, 0x1a, 150), "fe0d0217001a0000009600000000000000000000000000000000000000000000"],
  ["dks", atkBuildSetDks(2, [0x04, 0x05, 0, 0x07], 1.2, 3.1), "03960f000003020f0000040f000005000000000f00000704b00c1c0000000000"],
  ["rateSet restart", atkBuildSetReportRate(2000)[0]!, "03964e0100000000000000000000000000000000000000000000000000000000"],
  ["rateSet rate", atkBuildSetReportRate(2000)[1]!, "0396460200000000000000000000000000000000000000000000000000000000"],
  ["keymap chunk 0", atkBuildGetKeymapChunk(0, 28), "1200001c00000000000000000000000000000000000000000000000000000000"],
  ["keymap chunk 1", atkBuildGetKeymapChunk(28, 28), "12001c1c00000000000000000000000000000000000000000000000000000000"],
];

test("request frames match the OpenATK keyboard configurator byte for byte", () => {
  for (const [name, frame, expected] of ORACLE) assert.equal(hex(frame), expected, name);
});

test("frames are always 32 bytes and reject payloads that do not fit", () => {
  assert.equal(atkFrame(1).length, ATK_FRAME_LENGTH);
  assert.throws(() => atkFrame(1, new Array(32).fill(0)), RangeError);
  assert.throws(() => atkFrame(300), RangeError);
});

test("replies are matched by command, then by the custom channel", () => {
  const get = atkCustomGet(0x24);
  assert.equal(atkReplyMatches(get, reply(ATK_COMMAND.getKeyboardValue, ATK_CUSTOM_ID, 0x24, 0, 5)), true);
  assert.equal(atkReplyMatches(get, reply(ATK_COMMAND.getKeyboardValue, ATK_CUSTOM_ID, 0x0b)), false);
  assert.equal(atkReplyMatches(get, reply(ATK_COMMAND.getKeyboardValue, 0x00, 0x24)), false);
  assert.equal(atkReplyMatches(get, reply(ATK_COMMAND.getProtocolVersion)), false);
  assert.equal(atkReplyMatches(atkBuildGetProtocolVersion(), reply(ATK_COMMAND.getProtocolVersion, 0, 9)), true);
  assert.equal(atkReplyMatches(atkBuildGetLightConfig(), reply(ATK_COMMAND.lightingGetValue, 0x41)), true);
});

test("protocol version and firmware decode", () => {
  assert.equal(atkDecodeProtocolVersion(reply(1, 0, 9)), 9);
  const firmware = atkDecodeFirmware(reply(2, ATK_CUSTOM_ID, 0, 0, 0, 0x02, 0x10));
  assert.equal(firmware.text, "2.10");
  assert.equal(firmware.value, 2.1);
  assert.equal(atkIsFirmwareV2(firmware), true);
  assert.equal(atkIsFirmwareV2(atkDecodeFirmware(reply(2, ATK_CUSTOM_ID, 0, 0, 0, 0x01, 0x09))), false);
  assert.equal(atkIsFirmwareV2(null), false);
});

test("travel limits, dead zone, and per-key travel decode in millimetres", () => {
  const limits = atkDecodeTravelLimits(reply(2, ATK_CUSTOM_ID, 0x24, 0x0d, 0x48, 0x00, 0x64, 0x00, 0x14, 0x0d, 0x48, 0x00, 0x01, 0x00, 0x01));
  assert.deepEqual(limits, { travelMax: 3.4, travelMin: 0.1, travelStep: 0.02, rtMax: 3.4, rtMin: 0.001, rtStep: 0.001 });
  assert.deepEqual(atkDecodeDeadZone(reply(2, ATK_CUSTOM_ID, 0x0b, 0x01, 0x5e, 0x00, 0xc8)), { top: 0.35, bottom: 0.2 });
  assert.equal(atkDecodeKeyTravel(reply(2, ATK_CUSTOM_ID, 0x03, 2, 5, 0x04, 0xe2)), 1.25);
});

test("rapid trigger and advanced key replies decode", () => {
  assert.deepEqual(atkDecodeKeyRapidTrigger(reply(2, ATK_CUSTOM_ID, 0x07, 2, 5, 1, 0x00, 0xc8, 0x01, 0x2c)), { enabled: true, release: 0.2, press: 0.3 });
  const advanced = atkDecodeAdvancedKey(4, reply(2, ATK_CUSTOM_ID, 0x20, 0, 0, 1, 4, 1, 4, 0x05, 0xdc, 0, 1, 0, 0x1a, 0, 0x16, 0));
  assert.deepEqual(advanced, { index: 4, mode: ATK_ADVANCED_MODE.rs, point: 1.5, rt: true, key1: [0, 0x1a], key2: [0, 0x16], layer: 0 });
});

test("feature, flag, sleep, and polling replies decode", () => {
  assert.deepEqual(atkDecodeFeature(reply(2, ATK_CUSTOM_ID, 0x11, 1, 1, 0, 1, 2, 3)), { rgbArea: 1, exchangeWasd: 1, macMode: 0, winLock: 1, nkro: 2, keyMode: 3 });
  assert.equal(atkDecodeFlag(reply(2, ATK_CUSTOM_ID, 0x1e, 1)), true);
  assert.equal(atkDecodeFlag(reply(2, ATK_CUSTOM_ID, 0x1e, 0)), false);
  assert.equal(atkDecodeSleep(reply(2, ATK_CUSTOM_ID, 0x26, 5)), 300);
  assert.equal(atkDecodeSleep(reply(2, ATK_CUSTOM_ID, 0x26, 0)), ATK_SLEEP_NEVER);
  assert.equal(atkDecodeReportRate(reply(2, ATK_CUSTOM_ID, 0x46, 0)), 8000);
  assert.equal(atkDecodeReportRate(reply(2, ATK_CUSTOM_ID, 0x46, 3)), 1000);
  assert.equal(atkDecodeReportRate(reply(2, ATK_CUSTOM_ID, 0x46, 9)), null);
});

test("lighting replies decode", () => {
  assert.deepEqual(atkDecodeLightConfig(reply(8, 0x41, 6, 0, 3, 10, 20, 30, 200, 1)), { effect: 6, speed: 3, color: [10, 20, 30], brightness: 200, colorful: true });
  assert.deepEqual(atkDecodeZoneLight(reply(2, ATK_CUSTOM_ID, 0x53, 3, 1, 9, 8, 7, 8, 9)), { effect: 3, colorful: true, brightness: 9, speed: 8, color: [7, 8, 9] });
  assert.deepEqual(atkDecodeKeyLight(reply(2, ATK_CUSTOM_ID, 0x4b, 12, 1, 2, 3)), { key: 12, color: [1, 2, 3] });
});

test("older firmware keeps the logo and side lights on their own channels", () => {
  assert.equal(atkZoneChannel(ATK_LIGHT_ZONE.logo, false), 0x21);
  assert.equal(atkZoneChannel(ATK_LIGHT_ZONE.side, false), 0x27);
  assert.equal(atkZoneChannel(ATK_LIGHT_ZONE.front, false), 0x53);
  assert.equal(atkZoneChannel(ATK_LIGHT_ZONE.logo, true), 0x53);
});

test("keymap chunks cover the matrix and decode big-endian codes", () => {
  const chunks = atkKeymapChunks(5, 14);
  assert.equal(chunks.length, 5);
  assert.deepEqual(chunks[4], { offset: 112, length: 28 });
  assert.deepEqual(atkKeymapChunks(1, 3), [{ offset: 0, length: 6 }]);
  assert.deepEqual(atkDecodeKeymap([0x00, 0x29, 0x01, 0x04], 1, 2), [0x29, 0x104]);
  assert.throws(() => atkBuildGetKeymapChunk(0, 29), RangeError);
});

test("writes reject out-of-range values", () => {
  assert.throws(() => atkBuildSetSleep(0), RangeError);
  assert.throws(() => atkBuildSetSleep(60 * 256), RangeError);
  assert.throws(() => atkBuildSetReportRate(500), RangeError);
  assert.throws(() => atkBuildSetKeyTravel(0, 0, -1), RangeError);
  assert.throws(() => atkBuildSetKeyTravel(0, 0, 70), RangeError);
  assert.throws(() => atkBuildSetLightConfig({ effect: 300, speed: 0, color: [0, 0, 0], brightness: 0, colorful: false }), RangeError);
  assert.throws(() => atkBuildSetFeature({ rgbArea: 0, exchangeWasd: 0, macMode: 0, winLock: 0, nkro: 3 }), RangeError);
  assert.throws(() => atkBuildSetDks(0, [1, 2, 3, 4, 5], 1, 1), RangeError);
  assert.throws(() => atkBuildTgl(0, 4, 70000), RangeError);
});

test("the catalog is unique, ATK-only, and leaves out the QMK-based Hex80 boards", () => {
  const ids = ATK_KEYBOARDS.map((product) => product.productId);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ATK_VENDOR_ID, 0x373b);
  assert.equal(ATK_KEYBOARDS.some((product) => /hex80|qk/i.test(product.name)), false);
  assert.equal(atkKeyboardProduct(0x1176), undefined);
  assert.equal(atkKeyboardProduct(0x10b0)?.name, "EDGE 60HE ULTIMATE");
  assert.deepEqual([atkKeyboardProduct(0x10b0)?.rows, atkKeyboardProduct(0x10b0)?.cols], [5, 14]);
  assert.equal(atkCustomSet(1, [2]).length, ATK_FRAME_LENGTH);
});
