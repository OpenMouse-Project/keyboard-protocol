// Vectors ported from Wheelguard's tests/test_gmmk.py (MIT) at e34953e.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GLORIOUS_KEY_INDEX,
  GLORIOUS_MODELS,
  eternalDebounceFrame,
  eternalKeyFrame,
  eternalPollingFrame,
  eternalProfileFrame,
  eternalStandbyFrame,
  gloriousDefaultState,
  gloriousDeleteMacroJob,
  gloriousFrameAllowed,
  gloriousKeysJob,
  gloriousLayerJob,
  gloriousLayoutKeys,
  gloriousLockedKeys,
  gloriousMacroJob,
  gloriousMacroProblem,
  gloriousModel,
  gloriousPollingJob,
  gloriousSleepJob,
  gmbkKeysFrame,
  gmbkSettingsFrame,
  gmmkKeymapFrame,
  gmmkMacroFrame,
  gmmkParseEvent,
  gmmkPollingFrame,
  gmmkProfileFrame,
  gmmkPropertiesFrame,
  heActuationFrame,
  heKeyFrame,
  hePollingFrame,
  heProfileFrame,
  heSleepFrame,
  type GloriousBoardState,
  type GloriousLayerKeys,
  type GloriousModel,
} from "./index.ts";

const m = (vid: number, pid: number): GloriousModel => gloriousModel(vid, pid)!;
const ANSI = m(0x320f, 0x5044);
const ALT = m(0x320f, 0x5092);
const bytes = (f: Uint8Array, from: number, to: number) => [...f.subarray(from, to)];
const u16le = (c: Uint8Array, at: number) => c[at]! | (c[at + 1]! << 8);

test("the reporter's GMMK 2 65% ISO is a known board", () => {
  const board = m(0x320f, 0x504a);
  assert.equal(board.name, "Glorious GMMK 2 65% (ISO)");
  assert.equal(board.protocol, "gmmk");
  assert.equal(board.commitKeys, false);
});

test("every model has a key index, a drawing whose keys it knows, and unique ids", () => {
  const ids = new Set<string>();
  for (const model of GLORIOUS_MODELS) {
    const id = `${model.vendorId}:${model.productId}`;
    assert.ok(!ids.has(id), id);
    ids.add(id);
    const index = GLORIOUS_KEY_INDEX[model.keymap]!;
    assert.ok(index, model.key);
    const drawn = new Set(gloriousLayoutKeys(model.form, model.layout).map((k) => k.id));
    drawn.delete("EnterLower");
    for (const key of drawn) assert.ok(key in index, `${model.key}: ${key}`);
    const positions = Object.values(index).filter((p) => p !== 255);
    assert.equal(positions.length, new Set(positions).size, `${model.key}: shared position`);
  }
  assert.equal(GLORIOUS_MODELS.length, 9 + 12 + 6 + 54 + 2 + 2);
});

test("polling, profile and properties frames", () => {
  const f = gmmkPollingFrame(500);
  assert.equal(f.length, 264);
  assert.deepEqual(bytes(f, 0, 11), [7, 8, 0, 0, 0, 0, 0, 0, 1, 1, 0]);
  assert.ok(f.subarray(11).every((b) => b === 0));
  assert.equal(gmmkPollingFrame(125)[8], 3);
  assert.throws(() => gmmkPollingFrame(8000), RangeError);
  const p = gmmkProfileFrame(2, 1);
  assert.equal(p.length, 64);
  assert.deepEqual(bytes(p, 0, 4), [7, 1, 3, 2]);
  assert.throws(() => gmmkProfileFrame(3, 0), RangeError);
  assert.deepEqual(bytes(gmmkPropertiesFrame(0, 2, 8), 0, 12), [7, 7, 1, 3, 1, 0, 1, 0, 20, 0, 8, 0]);
  assert.throws(() => gmmkPropertiesFrame(0, 0, 5), RangeError);
  const w = gmmkPropertiesFrame(1, 2, 8, 30, 250);
  assert.deepEqual([w[9], w[10], w[11]], [2, 8, 30]);
});

test("the GMMK Pro's factory keymap", () => {
  const f = gmmkKeymapFrame(ANSI, 0, 0, {});
  const a = f.subarray(8, 248);
  assert.equal(a[120 + 0], 41);
  assert.equal(a[120 + 13], 70);
  assert.equal(a[120 + 34], 76);
  assert.deepEqual([a[109], a[120 + 109]], [1, 160]);
  assert.deepEqual([a[14], a[120 + 14]], [3, 2]);
  const iso = gmmkKeymapFrame(m(0x320f, 0x5046), 0, 0, {}).subarray(8, 248);
  assert.equal(iso[120 + 81], 100);
  for (const [name, model] of [["ansi", ANSI], ["iso", m(0x320f, 0x5046)], ["ansi-alt", ALT]] as const) {
    const km = gmmkKeymapFrame(model, 0, 0, {}).subarray(8);
    for (const [key, i] of Object.entries(GLORIOUS_KEY_INDEX[name]!)) assert.notEqual(km[i], 0xff, key);
  }
});

test("keymap frame applies bindings and leaves everything else alone", () => {
  const keys: GloriousLayerKeys = {
    CapsLock: { kind: "key", code: 224 },
    KeyA: { kind: "key", code: 6, mods: ["ctrl", "super"] },
    F5: { kind: "media", code: 1 },
    F6: { kind: "mouse", code: 3 },
    F7: { kind: "function", code: 2 },
    F8: { kind: "macro", slot: 2 },
    KeyQ: { kind: "disabled" },
  };
  const f = gmmkKeymapFrame(ANSI, 1, 2, keys, [2]);
  assert.deepEqual(bytes(f, 0, 4), [7, 3, 2, 3]);
  const km = f.subarray(8, 248);
  const def = gmmkKeymapFrame(ANSI, 0, 0, {}).subarray(8, 248);
  const ix = GLORIOUS_KEY_INDEX.ansi!;
  const at = (k: string, data = km) => [data[ix[k]!], data[120 + ix[k]!]];
  assert.deepEqual(at("CapsLock"), [2, 224]);
  assert.deepEqual(at("KeyA"), [0xe0 + 1 + 8, 6]);
  assert.deepEqual(at("F5"), [3, 1]);
  assert.deepEqual(at("F6"), [9, 3]);
  assert.deepEqual(at("F7"), [8, 2]);
  assert.deepEqual(at("F8"), [5, 2]);
  assert.deepEqual(at("KeyQ"), [1, 0]);
  const changed = Object.keys(ix).filter((k) => JSON.stringify(at(k)) !== JSON.stringify(at(k, def)));
  assert.deepEqual(new Set(changed), new Set(Object.keys(keys)));
  assert.ok(f.subarray(248).every((b) => b === 0));
});

test("keymap frame refuses what the board can't take", () => {
  for (const bad of [
    { Fn: { kind: "disabled" } }, { Knob: { kind: "media", code: 2 } }, { Nope: { kind: "disabled" } },
    { KeyA: { kind: "key", code: 3 } }, { KeyA: { kind: "macro", slot: 4 } }, { KeyA: { kind: "media", code: 9 } },
    { KeyA: { kind: "key", code: 225, mods: ["ctrl"] } },
  ] as GloriousLayerKeys[]) {
    assert.throws(() => gmmkKeymapFrame(ANSI, 0, 0, bad, [1]), RangeError, JSON.stringify(bad));
  }
  assert.throws(() => gmmkKeymapFrame(m(0x320f, 0x5045), 0, 0, { F1: { kind: "disabled" } }), RangeError);
});

test("the alt Pro swaps slash and backslash", () => {
  const f = gmmkKeymapFrame(ALT, 0, 0, { Slash: { kind: "disabled" } });
  assert.equal(f[8 + 53], 1);
  assert.equal(f[8 + 120 + 53], 0);
});

test("GMMK 2 96%, GMMK 3 and GMMK 3 Pro Wireless keymaps", () => {
  const g96 = m(0x320f, 0x504b);
  const f = gmmkKeymapFrame(g96, 1, 2, { Numpad5: { kind: "media", code: 1 } });
  assert.deepEqual([f[8 + 75], f[8 + 120 + 75]], [3, 1]);
  const g3 = m(0x342d, 0xe3c9);
  const k = gmmkKeymapFrame(g3, 0, 1, { End: { kind: "disabled" }, Pause: { kind: "key", code: 4 } });
  assert.equal(k[8 + 126 + 57], 0);
  assert.deepEqual([k[8 + 16], k[8 + 126 + 16]], [1, 4]);
  const g3w = m(0x342d, 0xe3cc);
  const w = gmmkKeymapFrame(g3w, 0, 0, { KeyA: { kind: "disabled" } });
  assert.deepEqual([w[8 + 8], w[8 + 110 + 8]], [1, 0]);
  assert.equal(w[8 + 110 + 13], 0x16);
  const numpad = m(0x320f, 0x5088);
  assert.throws(() => gmmkKeymapFrame(numpad, 0, 0, { Numpad1: { kind: "macro", slot: 1 } }, [1]), RangeError);
  const n = gmmkKeymapFrame(numpad, 0, 0, { Numpad1: { kind: "media", code: 1 } });
  assert.deepEqual([n[8 + 12], n[8 + 20 + 12]], [3, 1]);
  assert.ok(n.subarray(8 + 40).every((b) => b === 0));
});

test("macro frame", () => {
  const ev = [
    { type: "press", code: 224, delay: 300 }, { type: "press", code: 6, delay: 20 },
    { type: "release", code: 6, delay: 20 }, { type: "release", code: 224, delay: 1 },
  ] as const;
  const f = gmmkMacroFrame(3, ev);
  assert.deepEqual(bytes(f, 0, 3), [7, 5, 3]);
  assert.deepEqual(bytes(f, 8, 20), [0x81, 0x2c, 224, 0x80, 20, 6, 0x00, 20, 6, 0x00, 1, 224]);
  assert.equal(gloriousMacroProblem([]), "The macro is empty.");
  assert.ok(gloriousMacroProblem(Array(21).fill(ev).flat()));
  assert.throws(() => gmmkMacroFrame(0, ev), RangeError);
});

test("HE frames, checksum, standby and actuation", () => {
  const f = hePollingFrame(2, 8000);
  assert.equal(f.length, 65);
  assert.deepEqual(bytes(f, 0, 4), [0, 0x04, 2, 0]);
  assert.equal(f[8], 255 - (0x04 + 2));
  assert.equal(hePollingFrame(0, 125)[3], 6);
  const p = heProfileFrame(1, 2);
  assert.deepEqual([p[1], p[2], p[3], p[8]], [0x05, 1, 2, 255 - 8]);
  const wired = heSleepFrame(7, false).subarray(1);
  assert.equal(u16le(wired, 16), 420);
  assert.equal(u16le(wired, 8), 0);
  for (const at of [12, 14, 18]) assert.equal(u16le(wired, at), 0xffff);
  const never = heSleepFrame(255, true).subarray(1);
  assert.deepEqual([8, 10, 16].map((at) => u16le(never, at)), [0, 0, 0]);
  const fifteen = heSleepFrame(15, true).subarray(1);
  assert.deepEqual([8, 10, 16].map((at) => u16le(fifteen, at)), [900, 900, 900]);
  const c = heActuationFrame(1, 2, { actuation: 2.0, rapid: false, sensitivity: 0.2 }).subarray(1);
  assert.deepEqual(bytes(c, 0, 7), [0x1a, 0x21, 0, 0, 19, 1, 0]);
  assert.deepEqual([c[8], c[9], c[10], c[25]], [19, 0, 0, 36]);
  const r = heActuationFrame(0, 0, { actuation: 0.1, rapid: true, sensitivity: 0.3 }).subarray(1);
  assert.deepEqual([r[3], r[4], r[8], r[9], r[10]], [0x80, 1, 1, 2, 2]);
  for (const bad of [{ actuation: 4.0, rapid: false, sensitivity: 0.2 }, { actuation: 1.25, rapid: false, sensitivity: 0.2 }]) {
    assert.throws(() => heActuationFrame(0, 0, bad), RangeError);
  }
  const k = heKeyFrame(0, 1, 9, [0, 0, 5, 0]).subarray(1);
  assert.deepEqual(bytes(k, 0, 5), [0x13, 0, 9, 1, 0]);
  assert.deepEqual(bytes(k, 8, 12), [0, 0, 5, 0]);
});

test("HE key job sends one frame per changed key, with one modifier at most", () => {
  const he = GLORIOUS_MODELS.find((x) => x.protocol === "he" && x.form === "g3-75" && x.layout === "ansi")!;
  const s = gloriousDefaultState(he);
  const job = gloriousKeysJob(he, s, { KeyA: { kind: "key", code: 4, mods: ["ctrl"] }, F3: { kind: "media", code: 3 } });
  assert.equal(job.length, 2);
  const byKey = Object.fromEntries(job.map(({ frame }) => [frame[3], bytes(frame, 9, 13)]));
  assert.deepEqual(byKey[GLORIOUS_KEY_INDEX["he-75-ansi"]!.KeyA!], [0, 0xe0, 4, 0]);
  assert.deepEqual(byKey[GLORIOUS_KEY_INDEX["he-75-ansi"]!.F3!], [3, 0, 0xe9, 0]);
  assert.throws(() => gloriousKeysJob(he, s, { KeyA: { kind: "key", code: 4, mods: ["ctrl", "shift"] } }), RangeError);
  const back = gloriousKeysJob(he, { ...s, keys: [[{ KeyZ: { kind: "disabled" } }, {}, {}], [{}, {}, {}], [{}, {}, {}]] }, {});
  assert.deepEqual(bytes(back[0]!.frame, 9, 13), [0, 0, 0x1d, 0]);
});

test("GMBK settings and keys", () => {
  assert.deepEqual([...gmbkSettingsFrame(1, 250, 15)], [7, 0x11, 2, 0, 0, 3, 2, 15, 0]);
  assert.deepEqual(bytes(gmbkSettingsFrame(0, 125, 255), 5, 8), [7, 2, 0]);
  for (const bad of [[0, 8000, 7], [0, 1000, 61], [3, 1000, 7]] as const) assert.throws(() => gmbkSettingsFrame(...bad), RangeError);
  const iso = m(0x3794, 0xb001);
  const f = gmbkKeysFrame(iso, 2, 1, { KeyA: { kind: "key", code: 6, mods: ["shift"] }, Backslash: { kind: "media", code: 1 } });
  assert.equal(f.length, 256);
  assert.deepEqual(bytes(f, 0, 4), [7, 3, 3, 2]);
  assert.deepEqual([f[4 + 2 * 64], f[5 + 2 * 64]], [0xe1, 6]);
  assert.deepEqual([f[4 + 2 * 85], f[5 + 2 * 85]], [3, 1]);
  assert.deepEqual([f[4 + 2 * 115], f[5 + 2 * 115]], [0x0d, 2]);
  for (const bad of [{ AltRight: { kind: "disabled" } }, { Fn: { kind: "disabled" } }, { KeyA: { kind: "macro", slot: 1 } },
    { KeyA: { kind: "key", code: 6, mods: ["ctrl", "shift"] } }] as GloriousLayerKeys[]) {
    assert.throws(() => gmbkKeysFrame(iso, 0, 0, bad), RangeError);
  }
});

test("Eternal frames and checksum", () => {
  const f = eternalProfileFrame(1);
  assert.deepEqual([bytes(f, 0, 8), f[63], f.length], [[9, 0x10, 0, 0, 1, 0, 1, 1], 0xe3, 64]);
  assert.deepEqual(bytes(eternalPollingFrame(250), 0, 8), [9, 4, 0x17, 0, 1, 0, 1, 2]);
  assert.deepEqual(bytes(eternalDebounceFrame(8), 6, 9), [2, 0x1f, 0x40]);
  assert.deepEqual(bytes(eternalStandbyFrame(15), 6, 9), [2, 0x03, 0x84]);
  assert.deepEqual(bytes(eternalStandbyFrame(255), 7, 9), [0, 0]);
  const k = eternalKeyFrame(2, 43, [0, 1, 0, 6]);
  assert.deepEqual(bytes(k, 0, 13), [9, 3, 2, 0, 1, 0, 6, 0, 43, 0, 1, 0, 6]);
  for (const frame of [k, eternalPollingFrame(1000)]) assert.equal(frame.reduce((a, b) => a + b, 0) & 0xff, 0xff);
  const eternal = m(0x3794, 0xb010);
  assert.ok(gloriousLockedKeys(eternal).has("ShiftLeft"));
  assert.throws(() => gloriousKeysJob(eternal, gloriousDefaultState(eternal), { KeyA: { kind: "key", code: 0xe1 } }), RangeError);
  assert.deepEqual(gloriousLayerJob(eternal, gloriousDefaultState(eternal), 1), []);
});

test("jobs follow CORE's sequences", () => {
  const g2 = m(0x320f, 0x504a);
  const s = gloriousDefaultState(g2);
  assert.deepEqual(gloriousPollingJob(g2, s, 500).map((j) => [j.frame[1], j.delayMs]), [[0x08, 550]]);
  // The GMMK 2 doesn't commit after keys; the Pro re-selects the layer twice.
  assert.deepEqual(gloriousKeysJob(g2, s, { KeyA: { kind: "disabled" } }).map((j) => j.frame[1]), [0x03]);
  assert.deepEqual(gloriousKeysJob(ANSI, gloriousDefaultState(ANSI), { KeyA: { kind: "disabled" } }).map((j) => j.frame[1]), [0x03, 0x01, 0x01]);
  // A layer switch selects, resends the layer's keys, selects again.
  assert.deepEqual(gloriousLayerJob(g2, s, 1).map((j) => j.frame[1]), [0x01, 0x03, 0x01]);
  // GMMK 3: the timer goes in the polling frame and all nine properties frames.
  const g3 = m(0x342d, 0xe3c9);
  const sleepJob = gloriousSleepJob(g3, gloriousDefaultState(g3), 30);
  assert.deepEqual(sleepJob.map((j) => j.frame[1]), [0x08, ...Array(9).fill(0x07)]);
  assert.ok(sleepJob.every((j) => j.frame[11] === 30));
  // GMMK 3 Pro Wireless: no polling frame, the rate rides in the properties frame.
  const g3w = m(0x342d, 0xe3cc);
  const poll = gloriousPollingJob(g3w, gloriousDefaultState(g3w), 250);
  assert.deepEqual(poll.map((j) => [j.frame[1], j.frame[9]]), [[0x07, 2]]);
  assert.ok(gloriousSleepJob(g3w, gloriousDefaultState(g3w), 15).every((j) => j.frame[1] === 0x07));
  assert.throws(() => gloriousSleepJob(g2, s, 15), RangeError);
});

test("macro jobs: in use sends steps and modes; deleting resets the keys first", () => {
  const ev = [{ type: "press", code: 4, delay: 10 }, { type: "release", code: 4, delay: 10 }] as const;
  const base = gloriousDefaultState(ANSI);
  const s: GloriousBoardState = {
    ...base,
    macros: { 1: { name: "A", mode: "once", events: ev } },
    keys: [[{ F1: { kind: "macro", slot: 1 } }, {}, {}], [{}, {}, {}], [{}, {}, {}]],
  };
  assert.deepEqual(gloriousMacroJob(ANSI, base, 1, { name: "A", mode: "once", events: ev }), []);
  assert.deepEqual(gloriousMacroJob(ANSI, s, 1, { name: "A", mode: "once", events: ev }).map((j) => j.frame[1]), [0x05]);
  assert.deepEqual(gloriousMacroJob(ANSI, s, 1, { name: "A", mode: "toggle", events: ev }).map((j) => j.frame[1]), [0x05, 0x04, 0x01, 0x01]);
  const { job, keys } = gloriousDeleteMacroJob(ANSI, s, 1);
  assert.deepEqual(job.map((j) => j.frame[1]), [0x03, 0x01, 0x01]);
  assert.deepEqual(keys[0]![0], {});
});

test("events and the frame allow-list", () => {
  assert.deepEqual(gmmkParseEvent(Uint8Array.from([0xf1, 2, 3])), [1, 2]);
  assert.equal(gmmkParseEvent(Uint8Array.from([0xf1, 4, 1])), null);
  assert.ok(gloriousFrameAllowed(ANSI, gmmkPollingFrame(1000)));
  const reset = new Uint8Array(264);
  reset.set([7, 0x02]);
  assert.equal(gloriousFrameAllowed(ANSI, reset), false);
  const eternal = m(0x3794, 0xb010);
  const factory = eternalPollingFrame(1000).slice();
  factory[1] = 0x11;
  assert.equal(gloriousFrameAllowed(eternal, factory), false);
});
