import assert from "node:assert/strict";
import test from "node:test";
import {
  MCHOSE_ACTION_TYPE,
  applyMchoseKeyTravelUpdate,
  decodeMchoseKeyTravel,
  decodeMchoseKeyReport,
  decodeMchoseDks,
  decodeMchoseKeymap,
  decodeMchoseLighting,
  decodeMchoseMacros,
  decodeMchoseModTap,
  decodeMchoseProfileNames,
  decodeMchoseSettings,
  encodeMchoseActions,
  encodeMchoseDks,
  encodeMchoseJson,
  encodeMchoseMacros,
  encodeMchoseModTap,
  mchoseActionLabel,
  mchoseConfigWithDebugMode,
  mchoseConfigWithLighting,
  mchoseConfigWithSettings,
  mchoseDisplayProfileName,
  mchoseDksMask,
  mchoseDksZones,
  mchoseKeymapOffset,
  mchoseLayoutFromDefaults,
  mchoseMacroRegionLength,
  mchoseMediaAction,
  type MchoseMacro,
} from "./index.ts";

const bytes = (hex: string): number[] => hex.trim().split(/\s+/).map((byte) => parseInt(byte, 16));

// Profile 2 of an Ace 68 Air III, read over USB.
const CONFIG = bytes(`50 04 aa bb 01 01 00 06 02 64 02 00 01 00 ff 00 00 00 00 00 05 00 00 00 01 50 02 00 01 66 e2 ff ${"10 ".repeat(32)}`);
// The empty macro region the keyboard ships with.
const EMPTY_MACROS = bytes(`${"40 00 ".repeat(16)} 81 7e ${"00 ".repeat(30)} 00 00 80 00`);
// Default keymap, first 16 slots, as the keyboard reports it (command 0x07).
const DEFAULT_KEYMAP = bytes("10 00 08 10 00 37 10 00 20 10 00 0d 10 00 14 10 00 2d 10 02 00 10 00 0c 10 00 2a 10 00 19 10 00 4b 10 01 00 10 00 0f 10 00 4f f0 ff 01 00 00 00");

test("settings decode and rewrite only their bits", () => {
  const settings = decodeMchoseSettings(CONFIG);
  assert.deepEqual(settings, {
    macMode: false, lockWin: false, lockAltTab: false, lockAltF4: false, scanRateRaw: 0, tachyonMode: false,
    bottomRapidTrigger: true, travelCheck: true, debounce: false, rtSmart: 5, sleepTime: 16, sleepEnabled: true,
  });
  assert.deepEqual(mchoseConfigWithSettings(CONFIG, 1, settings), CONFIG, "an unchanged write is byte-identical");
  const next = mchoseConfigWithSettings(CONFIG, 1, { ...settings, macMode: true, lockWin: true, debounce: true, scanRateRaw: 3 });
  assert.equal(next[1], 0x06, "Mac layer of profile 1");
  assert.equal(next[6]! & 1, 0, "Mac mode releases the Win lock");
  assert.equal(next[7], 0xe6);
  assert.equal(next[4], 0x31, "scan rate high nibble, polling kept");
  assert.throws(() => mchoseConfigWithSettings(CONFIG, 1, { ...settings, rtSmart: 16 }), RangeError);
});

test("debug mode flips only bit 3 of byte 7", () => {
  const config = Uint8Array.from(CONFIG);
  const on = mchoseConfigWithDebugMode(config, true);
  assert.equal(on[7], CONFIG[7]! | 8);
  assert.deepEqual(on.filter((_, i) => i !== 7), CONFIG.filter((_, i) => i !== 7));
  assert.deepEqual(mchoseConfigWithDebugMode(Uint8Array.from(on), false), CONFIG);
  assert.throws(() => mchoseConfigWithDebugMode(new Uint8Array(10), true), RangeError);
});

test("key reports carry the key's action, its travel and calibration state", () => {
  const frame = [0xa0, 0x10, 0x00, 0x04, 0, 0, 0x01, 0x2c, 0, 0, 0xff, ...new Array(53).fill(0)];
  assert.deepEqual(decodeMchoseKeyReport(frame), { type: 0x10, code1: 0, code2: 4, travel: 300, calibration: "done" });
  assert.equal(decodeMchoseKeyReport([...frame.slice(0, 10), 1, ...frame.slice(11)])!.calibration, "pending");
  assert.equal(decodeMchoseKeyReport([...frame.slice(0, 10), 0, ...frame.slice(11)])!.calibration, "none");
  assert.equal(decodeMchoseKeyReport([0xaa, ...frame.slice(1)]), null);
  assert.equal(decodeMchoseKeyReport(frame.slice(0, 8)), null);
});

test("lighting decodes both zones and round-trips", () => {
  const lighting = decodeMchoseLighting(CONFIG);
  assert.deepEqual(lighting.main, { effect: 2, brightness: 100, speed: 2, direction: 0, rainbow: true, color: { r: 255, g: 0, b: 0 } });
  assert.deepEqual(lighting.side, { effect: 1, brightness: 80, speed: 2, rainbow: false, color: { r: 0x66, g: 0xe2, b: 0xff } });
  assert.deepEqual(mchoseConfigWithLighting(CONFIG, lighting), CONFIG);
  const dim = mchoseConfigWithLighting(CONFIG, { ...lighting, main: { ...lighting.main, speed: 4, brightness: 10 } });
  assert.deepEqual([dim[9], dim[10]], [10, 0]);
  assert.throws(() => mchoseConfigWithLighting(CONFIG, { ...lighting, main: { ...lighting.main, brightness: 101 } }), RangeError);
});

test("keymap actions decode, label and encode", () => {
  const keys = decodeMchoseKeymap(DEFAULT_KEYMAP, 16);
  assert.deepEqual(keys[6], { type: 0x10, code1: 0x02, code2: 0 });
  assert.equal(mchoseActionLabel(keys[6]!), "Shift");
  assert.equal(mchoseActionLabel(keys[14]!), "Fn1");
  assert.equal(mchoseActionLabel(keys[15]!), null, "an empty slot has no name");
  assert.equal(mchoseActionLabel({ type: 0x10, code1: 0x01, code2: 0x06 }), "Ctrl+C");
  assert.equal(mchoseActionLabel(mchoseMediaAction(0x0183)), "Media player");
  assert.equal(mchoseActionLabel({ type: MCHOSE_ACTION_TYPE.macro, code1: 2, code2: 0 }), "Macro 3");
  assert.equal(mchoseActionLabel({ type: 0x10, code1: 0, code2: 0 }), "Disabled");
  assert.deepEqual(encodeMchoseActions(keys), DEFAULT_KEYMAP);
  assert.equal(mchoseKeymapOffset(1, 2), 512 * 6);
  assert.throws(() => encodeMchoseActions([{ type: 256, code1: 0, code2: 0 }]), RangeError);
});

test("the layout takes matrix slots from the keyboard's default keymap", () => {
  const layout = mchoseLayoutFromDefaults(decodeMchoseKeymap(DEFAULT_KEYMAP, 16));
  const slot = (label: string) => layout.find((key) => key.label === label)!.index;
  assert.equal(slot("E"), 0);
  assert.equal(slot("Q"), 4);
  assert.equal(slot("LShift"), 6);
  assert.equal(slot("Fn"), 14);
  // Swapped slots on another firmware are followed.
  const swapped = decodeMchoseKeymap(DEFAULT_KEYMAP, 16);
  [swapped[0], swapped[4]] = [swapped[4]!, swapped[0]!];
  assert.equal(mchoseLayoutFromDefaults(swapped).find((key) => key.label === "Q")!.index, 0);
});

test("macros: the shipped empty region decodes and re-encodes byte for byte", () => {
  const macros = decodeMchoseMacros(EMPTY_MACROS);
  assert.equal(macros.length, 16);
  assert.ok(macros.every((macro) => macro.steps.length === 0 && macro.mode === 0));
  assert.deepEqual(encodeMchoseMacros(macros), EMPTY_MACROS);
  assert.equal(mchoseMacroRegionLength(EMPTY_MACROS, EMPTY_MACROS), 68);
});

test("macros: steps, modifiers, mouse and delays round-trip", () => {
  const macros: MchoseMacro[] = Array.from({ length: 16 }, () => ({ mode: 0, steps: [] }));
  macros[2] = { mode: 1, steps: [
    { kind: "key", code: 0xe1, down: true, delayMs: 0 },
    { kind: "key", code: 0x04, down: true, delayMs: 30 },
    { kind: "key", code: 0x04, down: false, delayMs: 0 },
    { kind: "key", code: 0xe1, down: false, delayMs: 0 },
    { kind: "mouse", code: 0x01, down: true, delayMs: 1000 },
  ] };
  macros[5] = { mode: 255, steps: [{ kind: "key", code: 0x2c, down: true, delayMs: 5 }] };
  const region = encodeMchoseMacros(macros);
  assert.deepEqual(region.slice(4, 6), [0x44, 0x00], "macro 3 starts after the shared end marker");
  assert.deepEqual(region.slice(0x44, 0x48), [4, 0, 0x41, 0x02], "Shift is a modifier mask with no delay");
  assert.deepEqual(region.slice(0x54, 0x58), [0xe8, 0x03, 0xc3, 0x01], "last step carries the end flag");
  assert.equal(region[34 + 5], 255);
  assert.deepEqual(decodeMchoseMacros(region), macros);
  assert.equal(mchoseMacroRegionLength(region, region), region.length);
  assert.throws(() => encodeMchoseMacros([{ mode: 0, steps: [{ kind: "key", code: 4, down: true, delayMs: 70000 }] }]), RangeError);
});

test("DKS zones pack the way the vendor app does", () => {
  assert.equal(mchoseDksMask([1, 0, 0, 0]), 0x001);
  assert.equal(mchoseDksMask([0, 2, 0, 0]), 0x018);
  assert.equal(mchoseDksMask([0, 0, 0, 1]), 0x200);
  assert.equal(mchoseDksMask([4, 0, 0, 0]), 0x07 | 0x38 | 0xc0, "a bar over all zones folds to 3, 3, 2");
  assert.deepEqual(mchoseDksZones(0x018), [0, 2, 0, 0]);
  const record = encodeMchoseDks({ points: [12, 30, 28, 8], actions: [
    { action: { type: 0x10, code1: 0, code2: 0x04 }, zones: [1, 0, 0, 0] },
    { action: { type: 0x10, code1: 0, code2: 0x05 }, zones: [0, 2, 0, 0] },
    { action: mchoseMediaAction(0xe9), zones: [0, 0, 1, 0] },
    { action: { type: 0, code1: 0, code2: 0 }, zones: [0, 0, 0, 1] },
  ] });
  assert.equal(record.length, 24);
  assert.deepEqual(decodeMchoseDks(record).actions[1]!.zones, [0, 2, 0, 0]);
  assert.deepEqual(encodeMchoseDks(decodeMchoseDks(record)), record);
  assert.throws(() => encodeMchoseDks({ ...decodeMchoseDks(record), points: [0, 30, 30, 10] }), RangeError);
});

test("mod-tap records hold the tap then the hold action", () => {
  const entry = { tap: { type: 0x10, code1: 0, code2: 0x29 }, hold: { type: 0x10, code1: 1, code2: 0 } };
  assert.deepEqual(encodeMchoseModTap(entry), [0x10, 0, 0x29, 0x10, 1, 0]);
  assert.deepEqual(decodeMchoseModTap(encodeMchoseModTap(entry)), entry);
});

test("profile names are JSON padded with 0xFF; vendor preset markers are not shown", () => {
  const stored = encodeMchoseJson(["EQ<official@-10:0>QE", "Official configuration--6", "EQ<apex@-1:0>QE", ""], 280);
  assert.equal(stored.length, 280);
  const names = decodeMchoseProfileNames(stored);
  assert.deepEqual(names, ["EQ<official@-10:0>QE", "Official configuration--6", "EQ<apex@-1:0>QE", null]);
  assert.equal(mchoseDisplayProfileName(names[0]!), null);
  assert.equal(mchoseDisplayProfileName(names[1]!), "Official configuration--6");
  assert.deepEqual(decodeMchoseProfileNames(new Array(280).fill(0xff)), [null, null, null, null]);
  assert.throws(() => encodeMchoseJson(["x".repeat(300)], 280), RangeError);
});

test("changing precision carries rapid-trigger distances over in millimetres", () => {
  const key = decodeMchoseKeyTravel([0xa0, 0x01, 0x1e, 0x00, 0x09, 0x1e, 0x0c, 0x1e]);
  const fine = applyMchoseKeyTravelUpdate(key, { index: 0, precision: 2 });
  assert.deepEqual([fine.pressPrecision, fine.releasePrecision, fine.rapidTriggerPress, fine.rapidTriggerRelease], [2, 2, 100, 130]);
  const back = applyMchoseKeyTravelUpdate(fine, { index: 0, precision: 0 });
  assert.deepEqual([back.rapidTriggerPress, back.rapidTriggerRelease], [10, 13]);
  const deep = applyMchoseKeyTravelUpdate({ ...key, rapidTriggerPress: 300 }, { index: 0, precision: 2 });
  assert.equal(deep.rapidTriggerPress, 500, "3.00 mm does not fit 0.001 mm steps; clamped to 0.5 mm");
  assert.equal(applyMchoseKeyTravelUpdate(key, { index: 0, switchType: 2 }).switchType, 2);
  assert.throws(() => applyMchoseKeyTravelUpdate(key, { index: 0, precision: 3 }), RangeError);
  const split = applyMchoseKeyTravelUpdate(key, { index: 0, pressPrecision: 2 });
  assert.deepEqual([split.pressPrecision, split.releasePrecision, split.rapidTriggerPress, split.rapidTriggerRelease], [2, 0, 100, 13]);
  const release = applyMchoseKeyTravelUpdate(key, { index: 0, precision: 0, releasePrecision: 1 });
  assert.deepEqual([release.pressPrecision, release.releasePrecision, release.rapidTriggerRelease], [0, 1, 26]);
});

test("travel presets give WASD, Caps Lock or Space their own values", async () => {
  const { MCHOSE_TRAVEL_PRESETS, mchoseTravelPresetUpdates, mchoseMirroredSocdPriority } = await import("./index.ts");
  const fps = MCHOSE_TRAVEL_PRESETS.find((preset) => preset.id === "extreme")!;
  const [w, q] = mchoseTravelPresetUpdates(fps, [[71, 0x1a], [4, 0x14]]);
  assert.deepEqual(w, { index: 71, precision: 0, actuation: 10, rapidTrigger: true, rapidTriggerPress: 4, rapidTriggerRelease: 4, pressDeadzone: 0, releaseDeadzone: 0 });
  assert.equal(q!.actuation, 150);
  const key = decodeMchoseKeyTravel([0xa0, 0x00, 0x1e, 0x19, 0x09, 0x1e, 0x0c, 0x1e]);
  const next = applyMchoseKeyTravelUpdate(key, w!);
  assert.deepEqual([next.pressPrecision, next.actuation, next.rapidTriggerPress, next.keyMode], [0, 10, 4, 1], "precision drops back to 0.01 mm first");
  assert.equal(applyMchoseKeyTravelUpdate(key, { index: 0, priority: 3 }).priority, 3);
  assert.throws(() => applyMchoseKeyTravelUpdate(key, { index: 0, priority: 16 }), RangeError);
  assert.deepEqual([0, 1, 2, 3].map(mchoseMirroredSocdPriority), [0, 2, 1, 3]);
});

test("lighting leaves an unchanged zone as stored, even out of range", () => {
  const odd = CONFIG.slice(); odd[26] = 0xff; odd[25] = 0xc8;
  const lighting = decodeMchoseLighting(odd);
  const next = mchoseConfigWithLighting(odd, { ...lighting, main: { ...lighting.main, brightness: 50 } });
  assert.equal(next[9], 50);
  assert.deepEqual([next[25], next[26]], [0xc8, 0xff], "the light box bytes are untouched");
  assert.throws(() => mchoseConfigWithLighting(odd, { ...lighting, side: { ...lighting.side, effect: 3 } }), RangeError, "editing that zone still checks it");
});

test("an unchanged lighting zone in another property order is not rechecked", () => {
  const config = new Array(64).fill(0);
  config[25] = 200; // side brightness the firmware may hold outside 0-100
  const stored = decodeMchoseLighting(config);
  const side = { color: { b: stored.side.color.b, g: stored.side.color.g, r: stored.side.color.r }, rainbow: stored.side.rainbow, speed: stored.side.speed, brightness: stored.side.brightness, effect: stored.side.effect };
  const next = mchoseConfigWithLighting(config, { main: { ...stored.main, effect: 6 }, side });
  assert.equal(next[8], 6);
  assert.equal(next[25], 200, "the side zone is left as stored");
});

test("the vendor app's name codes read as names, or as no name", () => {
  assert.equal(mchoseDisplayProfileName("i18n<defaultOnboard>"), null);
  assert.equal(mchoseDisplayProfileName("i18n<defaultOnboard>3"), null);
  assert.equal(mchoseDisplayProfileName("EQ<apex@-1:0>QE"), null);
  assert.equal(mchoseDisplayProfileName("lang<无畏契约明星主播,VALORANT star streamer>"), "VALORANT star streamer");
  assert.equal(mchoseDisplayProfileName('lang<{"zh": "均衡", "en": "Balanced"}>'), "Balanced");
  assert.equal(mchoseDisplayProfileName("Games"), "Games");
});
