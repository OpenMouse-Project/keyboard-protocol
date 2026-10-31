import assert from "node:assert/strict";
import test from "node:test";
import {
  MCHOSE_ACE68_LAYOUT,
  MCHOSE_COMMAND,
  MCHOSE_KEY_TRAVEL_SIZE,
  applyMchoseKeyTravelUpdate,
  decodeMchoseBase,
  decodeMchoseInfo,
  decodeMchoseKeyTravel,
  decodeMchoseKeyTravelTable,
  decodeMchosePerformance,
  decodeMchoseReply,
  encodeMchoseKeyTravel,
  encodeMchoseRead,
  encodeMchoseWrite,
  mchoseBaseWithActiveProfile,
  mchoseChangedWriteFrames,
  mchoseConfigWithPollingRate,
  mchoseConfigWithWinLock,
  mchosePollingHz,
  mchosePollingRaw,
  mchoseProduct,
  mchoseReadFrames,
  mchoseReplyMatches,
  mchoseStepsToMm,
  mchoseWriteFrames,
} from "./index.ts";

const bytes = (hex: string): Uint8Array => Uint8Array.from(hex.trim().split(/\s+/).map((byte) => parseInt(byte, 16)));
const pad = (frame: Uint8Array): Uint8Array => { const out = new Uint8Array(64); out.set(frame); return out; };

// Replies captured from an Ace 68 Air III (0x41E4:0x2132, firmware 116) over USB.
const INFO_REPLY = pad(bytes(`aa 03 00 20 1f 00 00 00 16 01 4e 6f 76 20 20 38 20 32 30 32 35 2c 31 36 3a 32 35 3a 35 37
  47 4c 38 4b 48 2d 50 52 4f`));
const BASE_REPLY = bytes(`aa 04 00 07 38 00 00 00 01 03 00 01 02 03 aa bb ${"a2 ".repeat(48)}`);
const CONFIG_REPLY = bytes(`aa 05 00 c1 38 40 00 00 50 04 aa bb 01 01 00 06 02 64 02 00 01 00 ff 00 00 00 00 00 05 00 00 00
  01 50 02 00 01 66 e2 ff ${"10 ".repeat(24)}`);
const CONFIG_TAIL_REPLY = pad(bytes("aa 05 00 00 08 78 00 00 10 10 10 10 10 10 10 10"));
const TRAVEL_REPLY = bytes(`aa a0 00 ac 38 00 04 00 ${"a0 01 1e 00 09 1e 0c 1e ".repeat(7)}`);

test("requests carry flag 0x55, size, little-endian offset and a sum checksum", () => {
  const read = encodeMchoseRead(MCHOSE_COMMAND.getKeyTravel, 1024, 56);
  assert.deepEqual(Array.from(read.slice(0, 8)), [0x55, 0xa0, 0, 0x3c, 56, 0x00, 0x04, 0]);
  assert.equal(read.length, 64);
  const write = encodeMchoseWrite(MCHOSE_COMMAND.setKeyTravel, 1024, Array.from(TRAVEL_REPLY.slice(8)));
  // The keyboard echoes a write with the same checksum byte.
  assert.deepEqual(Array.from(write.slice(1, 8)), [0xa1, 0, 0xac, 56, 0x00, 0x04, 0]);
  assert.throws(() => encodeMchoseRead(MCHOSE_COMMAND.getInfo, 0, 57), RangeError);
  assert.throws(() => encodeMchoseWrite(MCHOSE_COMMAND.setBase, 0, [256]), RangeError);
});

test("captured replies decode and pass their checksum", () => {
  for (const frame of [INFO_REPLY, BASE_REPLY, CONFIG_REPLY, CONFIG_TAIL_REPLY, TRAVEL_REPLY]) {
    assert.ok(decodeMchoseReply(frame), `reply 0x${frame[1]!.toString(16)} decodes`);
  }
  const reply = decodeMchoseReply(TRAVEL_REPLY)!;
  assert.equal(reply.offset, 1024);
  assert.ok(mchoseReplyMatches(encodeMchoseRead(MCHOSE_COMMAND.getKeyTravel, 1024, 56), reply));
  assert.ok(!mchoseReplyMatches(encodeMchoseRead(MCHOSE_COMMAND.getKeyTravel, 0, 56), reply));
  assert.ok(!mchoseReplyMatches(encodeMchoseRead(MCHOSE_COMMAND.getKeyTravel, 1024, 16), reply), "never more than asked for");
  assert.ok(mchoseReplyMatches(encodeMchoseRead(MCHOSE_COMMAND.getInfo, 0, 56), decodeMchoseReply(INFO_REPLY)!), "info answers 31 of 56 bytes");
  const corrupt = TRAVEL_REPLY.slice();
  corrupt[20] ^= 1;
  assert.equal(decodeMchoseReply(corrupt), null);
  assert.equal(decodeMchoseReply(encodeMchoseRead(MCHOSE_COMMAND.getInfo, 0, 56)), null, "a request is not a reply");
});

test("device info reads firmware, build date and controller", () => {
  assert.deepEqual(decodeMchoseInfo(decodeMchoseReply(INFO_REPLY)!.data), {
    firmwareVersion: "116",
    buildDate: "Nov 8 2025,16:25:57",
    chip: "GL8KH-PRO",
  });
  assert.deepEqual(decodeMchoseInfo(bytes("17 01")), { firmwareVersion: "117", buildDate: null, chip: null });
});

test("the profile table names the active slot through its order list", () => {
  const data = decodeMchoseReply(BASE_REPLY)!.data;
  assert.deepEqual(decodeMchoseBase(data), { activeProfile: 1, profileCount: 3, order: [0, 1, 2, 3] });
  const next = mchoseBaseWithActiveProfile(data, 2);
  assert.equal(next[0], 2);
  assert.deepEqual(next.slice(1), Array.from(data.slice(1)), "everything else is written back as read");
  assert.throws(() => mchoseBaseWithActiveProfile(data, 3), RangeError, "slot 4 is not enabled");
  assert.deepEqual(decodeMchoseBase(bytes("02 00 00 00 00 00")), { activeProfile: 2, profileCount: 4, order: [0, 1, 2, 3] }, "no order list: every slot is selectable");
  assert.equal(decodeMchoseBase(bytes("09 03 00 01 02 03")), null);
});

test("function config exposes polling rate and locks and changes only their bits", () => {
  const config = new Uint8Array([...decodeMchoseReply(CONFIG_REPLY)!.data, ...decodeMchoseReply(CONFIG_TAIL_REPLY)!.data]);
  const performance = decodeMchosePerformance(config)!;
  assert.equal(performance.pollingHz, 8000);
  assert.equal(performance.layerMode, 4, "profile 1, Windows layer");
  assert.equal(performance.lockWin, false);
  assert.equal(performance.bottomRapidTrigger, true);
  const slower = mchoseConfigWithPollingRate(config, 1000);
  assert.equal(slower[4], 0x04);
  assert.deepEqual(slower.filter((_, i) => i !== 4), Array.from(config).filter((_, i) => i !== 4));
  const locked = mchoseConfigWithWinLock(config, true);
  assert.equal(decodeMchosePerformance(Uint8Array.from(locked))!.lockWin, true);
  assert.deepEqual(locked.filter((_, i) => i !== 6), Array.from(config).filter((_, i) => i !== 6));
  assert.throws(() => mchoseConfigWithPollingRate(config, 500), RangeError);
  assert.equal(mchosePollingHz(4), 1000);
  assert.equal(mchosePollingRaw(2000), 3);
});

test("key records round-trip and convert to millimetres", () => {
  const record = Array.from(TRAVEL_REPLY.slice(8, 16));
  const key = decodeMchoseKeyTravel(record);
  assert.deepEqual(key, {
    tag: 0xa, switchType: 0, keyMode: 1, priority: 0,
    actuation: 31, pressPrecision: 0, releasePrecision: 0,
    rapidTriggerPress: 10, rapidTriggerRelease: 13, pressDeadzone: 15, releaseDeadzone: 15, spare: 0,
  });
  assert.deepEqual(encodeMchoseKeyTravel(key), record);
  assert.equal(mchoseStepsToMm(key.actuation), 0.31);
  const fine = decodeMchoseKeyTravel([0xa0, 0x01, 0x95, 0x19, 0x31, 0x00, 0x31, 0x00]);
  assert.equal(fine.actuation, 0x195 + 1, "actuation has a ninth bit");
  assert.equal(fine.pressPrecision, 3);
  assert.deepEqual(encodeMchoseKeyTravel(fine), [0xa0, 0x01, 0x95, 0x19, 0x31, 0x00, 0x31, 0x00]);
});

test("key edits are range-checked against the vendor app's limits", () => {
  const key = decodeMchoseKeyTravel(Array.from(TRAVEL_REPLY.slice(8, 16)));
  const next = applyMchoseKeyTravelUpdate(key, { index: 0, actuation: 150, rapidTrigger: false, pressDeadzone: 0 });
  assert.equal(next.actuation, 150);
  assert.equal(next.keyMode, 0);
  assert.equal(next.pressDeadzone, 0);
  assert.equal(next.rapidTriggerPress, key.rapidTriggerPress);
  assert.throws(() => applyMchoseKeyTravelUpdate(key, { index: 0, actuation: 9 }), RangeError);
  assert.throws(() => applyMchoseKeyTravelUpdate(key, { index: 0, actuation: 341 }), RangeError);
  assert.throws(() => applyMchoseKeyTravelUpdate(key, { index: 0, rapidTriggerPress: 1 }), RangeError);
  assert.throws(() => applyMchoseKeyTravelUpdate(key, { index: 0, releaseDeadzone: 51 }), RangeError);
  const fine = { ...key, pressPrecision: 2 };
  assert.equal(applyMchoseKeyTravelUpdate(fine, { index: 0, rapidTriggerPress: 500 }).rapidTriggerPress, 500);
});

test("reads walk 56-byte chunks; writes keep every frame full size", () => {
  const reads = mchoseReadFrames(MCHOSE_COMMAND.getKeyTravel, 1024, MCHOSE_KEY_TRAVEL_SIZE);
  assert.equal(reads.length, 19);
  assert.deepEqual(Array.from(reads.at(-1)!.slice(4, 7)), [16, 0xf0, 0x07], "last read is 16 bytes at 2032");
  const config = Array.from({ length: 64 }, (_, i) => i);
  const writes = mchoseWriteFrames(MCHOSE_COMMAND.setFuncConfig, 64, config);
  assert.equal(writes.length, 2);
  assert.deepEqual(Array.from(writes[1]!.slice(4, 9)), [56, 72, 0, 0, 8], "tail frame moves back to offset 8");
  assert.deepEqual(Array.from(mchoseWriteFrames(MCHOSE_COMMAND.setBase, 0, [1, 2, 3])[0]!.slice(4, 11)), [3, 0, 0, 0, 1, 2, 3]);
});

test("table writes send only the windows that changed", () => {
  const current = Array.from({ length: MCHOSE_KEY_TRAVEL_SIZE }, () => 0);
  assert.equal(mchoseChangedWriteFrames(MCHOSE_COMMAND.setKeyTravel, 0, current, current).length, 0);
  const next = current.slice();
  next[3] = 1;
  next[1020] = 1;
  const frames = mchoseChangedWriteFrames(MCHOSE_COMMAND.setKeyTravel, 2048, current, next);
  assert.equal(frames.length, 2);
  assert.equal(frames[0]![5]! | (frames[0]![6]! << 8), 2048);
  assert.equal(frames[1]![5]! | (frames[1]![6]! << 8), 2048 + 968, "the last window stays 56 bytes");
  // Mod-tap: 6-byte records in a 256-byte table; windows hold whole records.
  const mt = new Array(256).fill(0);
  const changed = mt.slice(); changed[31 * 6] = 1;
  const mtFrames = mchoseChangedWriteFrames(MCHOSE_COMMAND.setModTap, 256, mt, changed, 6);
  assert.deepEqual(mtFrames.map((frame) => [frame[4], (frame[5]! | (frame[6]! << 8)) - 256]), [[54, 162]]);
  // A change in the last record pulls the window back to end at the table's end, like the vendor app.
  const tail = mt.slice(); tail[255] = 1;
  const tailFrames = mchoseChangedWriteFrames(MCHOSE_COMMAND.setModTap, 256, mt, tail, 6);
  assert.deepEqual(tailFrames.map((frame) => [frame[4], (frame[5]! | (frame[6]! << 8)) - 256]), [[54, 202]]);
  assert.ok(frames.every((frame) => frame[4] === 56));
});

test("the catalog and layout cover the Ace 68 Air", () => {
  assert.equal(mchoseProduct(0x41e4, 0x2132)?.verified, true);
  assert.equal(mchoseProduct(0x41e4, 0x2120)?.verified, false);
  assert.equal(mchoseProduct(0x3837, 0x2132), undefined);
  assert.equal(MCHOSE_ACE68_LAYOUT.length, 68);
  const indexes = MCHOSE_ACE68_LAYOUT.map((key) => key.index);
  assert.equal(new Set(indexes).size, 68, "every key has its own slot");
  assert.ok(indexes.every((index) => index >= 0 && index < 128));
  assert.deepEqual(MCHOSE_ACE68_LAYOUT.find((key) => key.label === "Q"), { index: 4, usage: 0x14, label: "Q", row: 1, x: 1.93, width: 1 });
  assert.deepEqual([...new Set(MCHOSE_ACE68_LAYOUT.map((key) => key.row))], [0, 1, 2, 3, 4]);
});

test("a full table decodes to 128 records", () => {
  const table = new Uint8Array(MCHOSE_KEY_TRAVEL_SIZE);
  for (let slot = 0; slot < 128; slot += 1) table.set(TRAVEL_REPLY.slice(8, 16), slot * 8);
  const keys = decodeMchoseKeyTravelTable(table);
  assert.equal(keys.length, 128);
  assert.throws(() => decodeMchoseKeyTravelTable(new Uint8Array(1000)), RangeError);
});

test("every MCHOSE product has its model details", async () => {
  const { MCHOSE_PRODUCTS, mchoseModel } = await import("./index.ts");
  for (const product of MCHOSE_PRODUCTS) {
    const model = mchoseModel(product.productId);
    assert.ok(model, product.name);
    assert.ok(model.layout.length > 0 && model.effects.main.length > 0 && model.switches.length > 0 && model.fullTravel > 0, product.name);
  }
});
