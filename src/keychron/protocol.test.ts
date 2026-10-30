import assert from "node:assert/strict";
import test from "node:test";
import {
  KEYCHRON_HE_COMMAND, decodeKeychronKeymapChunk, joinKeychronKeymap, keychronKeycodeLegend, keychronKeymapReadPlan, keychronLayoutFor, keychronViaFrames, KEYCHRON_KEY_MODE, KEYCHRON_WORK_MODE, keychronKeyBitmap, keychronKeyTarget, keychronProfileNameBytes, KEYCHRON_HE_PRODUCTS, KEYCHRON_HE_PRODUCT_IDS, KEYCHRON_HE_SUBCOMMAND,
  decodeKeychronAxisType, decodeKeychronCalibrationState, decodeKeychronCurve, decodeKeychronHeVersion,
  decodeKeychronKeySlot, decodeKeychronProfileBuffer, decodeKeychronProfileName, decodeKeychronProfilesInfo,
  decodeKeychronRealtimeTravel, joinKeychronProfile, keychronHeAcknowledged, keychronHeFrames,
  keychronNameWindow, keychronProfileReadPlan, keychronUnit,
} from "./index.ts";

const reply = (sub: number, ...bytes: number[]) => {
  const out = new Uint8Array(32);
  out.set([KEYCHRON_HE_COMMAND, sub, ...bytes]);
  return out;
};
const head = (frame: Uint8Array, length: number) => [...frame.slice(0, length)];

test("frames are 32-byte KC_HE reports", () => {
  const frame = keychronHeFrames.version();
  assert.equal(frame.length, 32);
  assert.deepEqual(head(frame, 3), [0xa9, 0x01, 0]);
  assert.deepEqual(head(keychronHeFrames.selectProfile(2), 3), [0xa9, 0x11, 2]);
  assert.deepEqual(head(keychronHeFrames.readProfile(1, 0x0134, 26), 6), [0xa9, 0x12, 1, 0x34, 0x01, 26]);
  assert.deepEqual(head(keychronHeFrames.realtimeTravel(3, 7), 4), [0xa9, 0x30, 3, 7]);
  assert.deepEqual(head(keychronHeFrames.calibrate(), 3), [0xa9, 0x40, 2]);
  assert.deepEqual(head(keychronHeFrames.stopCalibration(), 3), [0xa9, 0x40, 4]);
  assert.deepEqual(head(keychronHeFrames.setAxisType(2), 3), [0xa9, 0x51, 2]);
});

test("frame arguments are range checked", () => {
  assert.throws(() => keychronHeFrames.selectProfile(256), RangeError);
  assert.throws(() => keychronHeFrames.readProfile(0, 0, 31), RangeError);
  assert.throws(() => keychronHeFrames.readProfile(0, 0x10000, 4), RangeError);
  assert.throws(() => keychronHeFrames.setTravel(4, 0, { workMode: 1, press: 300, keyMode: 1 }), RangeError);
});

test("setTravel packs one byte per value up to v4 and 16-bit words in v5", () => {
  const v4 = keychronHeFrames.setTravel(4, 1, { workMode: 1, press: 20, sensitivePress: 4, keyMode: 1 });
  assert.deepEqual(head(v4, 9), [0xa9, 0x14, 1, 1, 20, 4, 4, 1, 0]);
  const v5 = keychronHeFrames.setTravel(5, 2, { workMode: 1, press: 0x0123, sensitivePress: 40, sensitiveRelease: 50, keyMode: 1 });
  assert.deepEqual(head(v5, 12), [0xa9, 0x14, 2, 1, 0x23, 0x01, 40, 0, 50, 0, 1, 0]);
  const perKey = keychronHeFrames.setTravel(4, 0, { workMode: 1, keyMode: 0, buffer: [9, 8, 7] });
  assert.deepEqual(head(perKey, 11), [0xa9, 0x14, 0, 1, 0, 0, 0, 0, 9, 8, 7]);
});

test("version reply exposes the version and capability bits", () => {
  const info = decodeKeychronHeVersion(reply(KEYCHRON_HE_SUBCOMMAND.getVersion, 4, 0, 0b101011));
  assert.equal(info?.version, 4);
  assert.deepEqual(info?.features, {
    switchAxis: true, resetSingleKey: true, dkr: false, turbo: true, gamepadDisable: false, supportMechanical: true,
  });
  assert.equal(decodeKeychronHeVersion(reply(0x02, 4)), null);
});

test("profile info reads the version-dependent tail", () => {
  const raw = reply(KEYCHRON_HE_SUBCOMMAND.getProfilesInfo, 1, 3, 0x5c, 0x03, 20, 18, 2);
  assert.deepEqual(decodeKeychronProfilesInfo(raw, 3), {
    current: 1, total: 3, size: 0x035c, dksCount: null, snapTapCount: null, unit: 0.1,
  });
  assert.deepEqual(decodeKeychronProfilesInfo(raw, 5), {
    current: 1, total: 3, size: 0x035c, dksCount: 20, snapTapCount: 18, unit: 0.01,
  });
  assert.equal(keychronUnit(3), 0.001);
  assert.equal(keychronUnit(undefined), 0.1);
});

test("name window and read plan follow the profile size", () => {
  assert.deepEqual(keychronNameWindow(1, 860), { offset: 827, length: 30 });
  assert.deepEqual(keychronNameWindow(4, 860), { offset: 828, length: 30 });
  assert.deepEqual(keychronNameWindow(5, 860), { offset: 828, length: 26 });
  const plan = keychronProfileReadPlan(60);
  assert.deepEqual(plan, [{ offset: 0, length: 26 }, { offset: 26, length: 26 }, { offset: 52, length: 8 }]);
  const joined = joinKeychronProfile([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])], 5);
  assert.deepEqual([...joined], [1, 2, 3, 4, 5]);
});

test("profile names are big-endian UTF-16 with zero pairs skipped", () => {
  const name = reply(KEYCHRON_HE_SUBCOMMAND.getProfileBuffer, 0, 0, 0, 0, 0, 0x50, 0, 0x31, 0, 0, 0);
  // reply bytes 6.. are the payload
  name[6] = 0; name[7] = 0x50; name[8] = 0; name[9] = 0x31; name[10] = 0; name[11] = 0;
  assert.equal(decodeKeychronProfileName(name), "P1");
  assert.equal(decodeKeychronProfileName(reply(0x13)), null);
});

test("v1-4 key slots unpack mode, travel, rapid trigger and index", () => {
  // mode 2, distance 20, press 4, release 5, advance 3, index 9
  const word = 2 | (20 << 2) | (4 << 8) | (5 << 14) | (3 << 20) | (9 << 24);
  const slot = new Uint8Array([word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff]);
  assert.deepEqual(decodeKeychronKeySlot(4, slot), {
    mode: 2, distance: 20, advancePress: 4, advanceRelease: 5, advanceMode: 3, index: 9,
  });
});

test("v5 key slots use 14-bit fields and a trailing index byte", () => {
  const word = (1n) | (300n << 2n) | (40n << 16n) | (50n << 30n) | (7n << 44n);
  const slot = new Uint8Array(7);
  for (let i = 0; i < 6; i++) slot[i] = Number((word >> BigInt(8 * i)) & 0xffn);
  slot[6] = 11;
  assert.deepEqual(decodeKeychronKeySlot(5, slot), {
    mode: 1, distance: 300, advancePress: 40, advanceRelease: 50, advanceMode: 7, index: 11,
  });
});

test("profile buffers decode the key matrix, DKS and snap-tap regions", () => {
  const rows = 2; const cols = 2; const slot = 4;
  const buffer = new Uint8Array(slot * (rows * cols + 1) + 19 * 20 + 3 * 20);
  // key (1,0) -> slot 3: distance 10, press 2
  const word = (10 << 2) | (2 << 8);
  buffer.set([word & 0xff, (word >> 8) & 0xff, 0, 0], slot * 3);
  // DKS slot 0: travels 1, 2, 3, 4 packed as [t0, t3, t1, t2] -> bits 0, 6, 12, 18
  const dksStart = slot * 5;
  const dksWord = 1 | (4 << 6) | (2 << 12) | (3 << 18);
  buffer.set([dksWord & 0xff, (dksWord >> 8) & 0xff, (dksWord >> 16) & 0xff], dksStart);
  buffer.set([0x41, 0x00], dksStart + 3); // keycode 0x0041
  buffer.set([0xa5, 0x3c], dksStart + 11); // action nibbles
  // snap-tap slot 2: key (col 1,row 0) and (col 2,row 1), type 3
  const snapStart = slot * 5 + 19 * 20;
  buffer.set([(1 << 3) | 0, (2 << 3) | 1, 3], snapStart + 3 * 2);
  const profile = decodeKeychronProfileBuffer(4, buffer, rows, cols);
  assert.equal(profile.keys[1]![0]!.distance, 10);
  assert.equal(profile.keys[1]![0]!.advancePress, 2);
  assert.equal(profile.keys[0]![0]!.distance, 0);
  assert.equal(profile.dks[0]?.keycodes[0], 0x41);
  assert.deepEqual(profile.dks[0]?.travel, [1, 2, 3, 4]);
  assert.deepEqual(profile.dks[0]?.actions[0], [0x5, 0xc, 0x3, 0xa]);
  assert.equal(profile.dks[1], null);
  assert.deepEqual(profile.snapTap, [{
    index: 2, type: 3, keys: [{ col: 1, row: 0 }, { col: 2, row: 1 }],
  }]);
  assert.throws(() => decodeKeychronProfileBuffer(4, new Uint8Array(4), rows, cols), RangeError);
});

test("live travel replies differ by version and must echo the key from v3", () => {
  assert.equal(decodeKeychronRealtimeTravel(reply(0x30, 17), 2, 0, 0), 17);
  assert.equal(decodeKeychronRealtimeTravel(reply(0x30, 0, 3, 7, 21), 4, 3, 7), 21);
  assert.equal(decodeKeychronRealtimeTravel(reply(0x30, 0, 3, 7, 21), 4, 3, 8), null);
  assert.equal(decodeKeychronRealtimeTravel(reply(0x30, 0, 3, 7, 0x2c, 0x01), 5, 3, 7), 300);
});

test("curve, axis type, calibration and acknowledgement replies decode", () => {
  assert.deepEqual(decodeKeychronCurve(reply(0x20, 1, 2, 3, 4, 5, 6, 7, 8)), [[1, 2], [3, 4], [5, 6], [7, 8]]);
  assert.deepEqual(decodeKeychronAxisType(reply(0x50, 2, 0x23, 0x00), 0.1), { type: 2, maxMm: 3.5 });
  const cal = decodeKeychronCalibrationState(reply(0x41, 0, 1, 0b0000_0101));
  assert.equal(cal?.state, 1);
  assert.deepEqual(cal?.keys.slice(0, 3), [true, false, true]);
  assert.equal(keychronHeAcknowledged(reply(0x14, 0), 0x14), true);
  assert.equal(keychronHeAcknowledged(reply(0x14, 1), 0x14), false);
});

test("the HE catalog is keyed by 16-bit product ids", () => {
  assert.ok(KEYCHRON_HE_PRODUCT_IDS.length > 150);
  for (const id of KEYCHRON_HE_PRODUCT_IDS) {
    assert.ok(id > 0 && id <= 0xffff);
    const product = KEYCHRON_HE_PRODUCTS[id]!;
    assert.ok(product.rows > 0 && product.cols > 0 && product.name.length > 0);
  }
});

test("work and key modes match Launcher's enums", () => {
  assert.deepEqual(KEYCHRON_WORK_MODE, { global: 0, static: 1, quickTrigger: 2 });
  assert.deepEqual(KEYCHRON_KEY_MODE, { perKey: 0, allKeys: 1 });
});

test("the key bitmap is three bytes per row, low bit first", () => {
  const bitmap = keychronKeyBitmap([{ row: 0, col: 0 }, { row: 1, col: 9 }, { row: 2, col: 23 }]);
  assert.equal(bitmap.length, 24);
  assert.equal(bitmap[0], 0b1);
  assert.equal(bitmap[3 + 1], 0b10);
  assert.equal(bitmap[6 + 2], 0b1000_0000);
  assert.equal(bitmap.reduce((sum, byte) => sum + byte, 0), 1 + 2 + 128);
  assert.throws(() => keychronKeyBitmap([{ row: 0, col: 24 }]), RangeError);
  assert.throws(() => keychronKeyBitmap([{ row: 8, col: 0 }]), RangeError);
});

test("key targets are all-keys by default and per-key with a bitmap", () => {
  assert.deepEqual(keychronKeyTarget(), { keyMode: 1 });
  const target = keychronKeyTarget([{ row: 0, col: 1 }]);
  assert.equal(target.keyMode, 0);
  assert.equal(target.buffer?.[0], 0b10);
  assert.throws(() => keychronKeyTarget([]), RangeError);
});

test("profile names are trimmed big-endian UTF-16 with a byte length", () => {
  const { chars, length } = keychronProfileNameBytes("  Hi\u00e9 ");
  assert.equal(length, 6);
  assert.deepEqual(chars.slice(0, 7), [0, 0x48, 0, 0x69, 0, 0xe9, 0]);
  assert.equal(chars.length, 28);
  assert.throws(() => keychronProfileNameBytes("   "), RangeError);
  assert.throws(() => keychronProfileNameBytes("x".repeat(15)), RangeError);
  assert.throws(() => keychronProfileNameBytes("\u{1F600}"), RangeError);
  const frame = keychronHeFrames.setProfileName(2, chars, length);
  assert.deepEqual([...frame.slice(0, 8)], [0xa9, 0x13, 2, 6, 0, 0x48, 0, 0x69]);
});

test("keymap reads cover one layer in 14-key chunks at the right byte offsets", () => {
  const plan = keychronKeymapReadPlan(1, 6, 5); // 30 keys: 14 + 14 + 2
  assert.deepEqual(plan, [{ offset: 60, bytes: 28 }, { offset: 88, bytes: 28 }, { offset: 116, bytes: 4 }]);
  assert.deepEqual([...keychronViaFrames.keymapBuffer(plan[1]!).slice(0, 4)], [0x12, 0, 88, 28]);
  assert.throws(() => keychronKeymapReadPlan(256, 1, 1), RangeError);
  assert.throws(() => keychronKeymapReadPlan(255, 20, 20), RangeError);
  assert.throws(() => keychronViaFrames.keymapBuffer({ offset: 0, bytes: 30 }), RangeError);
  assert.deepEqual([...keychronViaFrames.layerCount().slice(0, 2)], [0x11, 0]);
});

test("keymap replies are big-endian keycodes and fold into rows", () => {
  const reply = new Uint8Array(32);
  reply.set([0x12, 0, 0, 4, 0x00, 0x04, 0x00, 0x05]);
  assert.deepEqual(decodeKeychronKeymapChunk(reply, 4), [4, 5]);
  assert.equal(decodeKeychronKeymapChunk(new Uint8Array(32), 4), null);
  assert.deepEqual(joinKeychronKeymap([[1, 2, 3], [4, 5, 6]], 2, 3), [[1, 2, 3], [4, 5, 6]]);
  assert.throws(() => joinKeychronKeymap([[1]], 2, 3), RangeError);
});

test("legends cover letters, symbols, modifiers, layers and fall back to hex", () => {
  const label = (code: number) => keychronKeycodeLegend(code).label;
  assert.equal(label(0x04), "A");
  assert.equal(label(0x1d), "Z");
  assert.equal(label(0x1e), "1");
  assert.equal(label(0x27), "0");
  assert.equal(label(0x3a), "F1");
  assert.equal(label(0x45), "F12");
  assert.equal(label(0x68), "F13");
  assert.equal(label(0x59), "1");
  assert.equal(label(0x2c), "Space");
  assert.equal(label(0xe1), "Shift");
  assert.equal(label(0x0000), "");
  assert.equal(label(0x0001), "▽");
  assert.equal(label(0x5221), "MO1");
  assert.equal(keychronKeycodeLegend(0x0204).title, "Shift+Key A");
  assert.equal(label(0x2204), "A");
  const unknown = keychronKeycodeLegend(0x7e40);
  assert.equal(unknown.unknown, true);
  assert.equal(unknown.label, "0x7E40");
});

test("every catalogued board has a physical layout whose keys fit its matrix", () => {
  for (const id of KEYCHRON_HE_PRODUCT_IDS) {
    const layout = keychronLayoutFor(id);
    const { rows, cols } = KEYCHRON_HE_PRODUCTS[id]!;
    assert.ok(layout, `layout for 0x${id.toString(16)}`);
    assert.ok(layout.keys.length > 0 && layout.width > 0 && layout.height > 0);
    for (const key of layout.keys) assert.ok(key.row < rows && key.col < cols, `0x${id.toString(16)} [${key.row},${key.col}]`);
  }
  assert.equal(keychronLayoutFor(0x0001), null);
});
