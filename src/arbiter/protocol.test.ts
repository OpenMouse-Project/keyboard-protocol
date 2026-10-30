import assert from "node:assert/strict";
import test from "node:test";
import {
  ARBITER_COMMAND,
  ARBITER_PACKET,
  ARBITER_PRODUCTS,
  arbiterChecksum,
  arbiterIsPro,
  arbiterPacketHeader,
  arbiterProduct,
  decodeArbiterFirmware,
  decodeArbiterKeyMappingPacket,
  decodeArbiterLightEffect,
  decodeArbiterReply,
  decodeArbiterSerial,
  decodeArbiterTravelPacket,
  decodeArbiterUserMode,
  decodeArbiterWriteAck,
  encodeArbiterBoardProfile,
  encodeArbiterKeyMappingWrite,
  encodeArbiterLightEffectWrite,
  encodeArbiterRequest,
  encodeArbiterShortRead,
  encodeArbiterTableRead,
  encodeArbiterTravelWrite,
  encodeArbiterUserModeWrite,
  isArbiterProfileChanged,
  type ArbiterLightEffect,
} from "./index.ts";

/** Wrap a payload in a checksummed reply frame the way the keyboard does. */
function reply(command: number, data: readonly number[], status = 0): Uint8Array {
  const frame = new Uint8Array(64);
  frame[1] = command;
  frame[2] = status;
  frame[3] = data.length;
  frame.set(data, 4);
  frame[63] = arbiterChecksum(frame);
  return frame;
}

test("requests carry the packet type in the command byte and a checksum that sums to 85", () => {
  const frame = encodeArbiterShortRead(ARBITER_COMMAND.getFirmware);
  assert.equal(frame.length, 64);
  assert.deepEqual([...frame.slice(0, 4)], [0, 2, 0, 0]);
  assert.equal(frame.reduce((sum, byte) => sum + byte, 0) & 0xff, 85);
  const long = encodeArbiterTableRead(ARBITER_COMMAND.getTravel, 0, 3);
  assert.deepEqual([...long.slice(0, 5)], [0, 1 | 0x40, 0, 1, 0x30]);
});

test("request encoding rejects oversize payloads, bad bytes and unknown commands", () => {
  assert.throws(() => encodeArbiterRequest(ARBITER_COMMAND.setTravel, ARBITER_PACKET.long, new Array(60).fill(0)), RangeError);
  assert.throws(() => encodeArbiterRequest(ARBITER_COMMAND.setTravel, ARBITER_PACKET.long, [256]), RangeError);
  assert.throws(() => encodeArbiterRequest(99 as never, ARBITER_PACKET.short), RangeError);
  assert.equal(encodeArbiterRequest(ARBITER_COMMAND.setTravel, ARBITER_PACKET.long, new Array(59).fill(1)).length, 64);
});

test("packet headers pack index and total and reject impossible pairs", () => {
  assert.equal(arbiterPacketHeader(2, 3), 0x32);
  assert.throws(() => arbiterPacketHeader(3, 3), RangeError);
  assert.throws(() => arbiterPacketHeader(0, 16), RangeError);
});

test("replies decode only with a valid checksum and size, masking the packet type", () => {
  const good = reply(2 | 0x40, [1, 2, 3]);
  assert.deepEqual(decodeArbiterReply(good), { command: 2, status: 0, data: new Uint8Array([1, 2, 3]) });
  const bad = good.slice(); bad[63] ^= 1;
  assert.equal(decodeArbiterReply(bad), null);
  const oversize = reply(2, []); oversize[3] = 60; oversize[63] = arbiterChecksum(oversize);
  assert.equal(decodeArbiterReply(oversize), null);
  assert.equal(decodeArbiterReply(good.slice(0, 63)), null);
  const ff = reply(2, []); ff[3] = 0xff; ff[63] = arbiterChecksum(ff);
  assert.equal(decodeArbiterReply(ff)?.data.length, 0);
});

test("profile-changed reports are recognised and are not replies", () => {
  const event = new Uint8Array(64); event[0] = 4; event[1] = 0xc9;
  assert.equal(isArbiterProfileChanged(event), true);
  assert.equal(isArbiterProfileChanged(reply(2, [])), false);
});

test("firmware and serial decode like the vendor app", () => {
  assert.equal(decodeArbiterFirmware(decodeArbiterReply(reply(2, [0x05, 0, 0, 0, 0, 0, 0, 0x01]))!), "V0105");
  assert.equal(decodeArbiterFirmware(decodeArbiterReply(reply(2, [1, 2]))!), null);
  assert.equal(decodeArbiterSerial(decodeArbiterReply(reply(13, [0x0a, 0xff, 0x01]))!), "aff1");
  assert.equal(decodeArbiterSerial(decodeArbiterReply(reply(2, [1]))!), null);
});

test("travel tables round-trip through the packet header and key pairs", () => {
  const packet = decodeArbiterTravelPacket(decodeArbiterReply(reply(1 | 0x40, [0x31, 10, 11, 20, 21]))!);
  assert.deepEqual(packet, { index: 1, total: 3, keys: [{ make: 10, break: 11 }, { make: 20, break: 21 }] });
  assert.equal(decodeArbiterTravelPacket(decodeArbiterReply(reply(1, [0x31, 10]))!), null);
  assert.equal(decodeArbiterTravelPacket(decodeArbiterReply(reply(1, [0x33, 10, 11]))!), null);
  assert.equal(decodeArbiterTravelPacket(decodeArbiterReply(reply(2, [0x31, 10, 11]))!), null);
  const write = encodeArbiterTravelWrite(1, 3, [{ make: 10, break: 11 }, { make: 20, break: 21 }]);
  assert.deepEqual([...write.slice(0, 9)], [0, 0x40, 0, 5, 0x31, 10, 11, 20, 21]);
  assert.throws(() => encodeArbiterTravelWrite(0, 3, []), RangeError);
  assert.throws(() => encodeArbiterTravelWrite(0, 3, new Array(30).fill({ make: 1, break: 1 })), RangeError);
  assert.throws(() => encodeArbiterTravelWrite(0, 3, [{ make: 256, break: 1 }]), RangeError);
});

test("key mapping packets carry keyCode and param pairs", () => {
  const packet = decodeArbiterKeyMappingPacket(decodeArbiterReply(reply(27, [0x30, 27, 0, 65, 1]))!);
  assert.deepEqual(packet, { index: 0, total: 3, bindings: [{ keyCode: 27, param: 0 }, { keyCode: 65, param: 1 }] });
  const write = encodeArbiterKeyMappingWrite(2, 3, [{ keyCode: 27, param: 0 }]);
  assert.deepEqual([...write.slice(0, 7)], [0, 26 | 0x40, 0, 3, 0x32, 27, 0]);
  assert.throws(() => encodeArbiterKeyMappingWrite(0, 3, [{ keyCode: -1, param: 0 }]), RangeError);
});

const LIGHT: ArbiterLightEffect = {
  on: true, effect: 2, brightness: 80, speed: 40, colorIndex: 3,
  colors: Array.from({ length: 7 }, (_, i) => ({ red: i, green: i * 2, blue: i * 3 })),
};

test("the 26-byte light effect encodes and decodes symmetrically", () => {
  const frame = encodeArbiterLightEffectWrite(LIGHT);
  assert.equal(frame[3], 26);
  assert.deepEqual([...frame.slice(4, 9)], [1, 2, 80, 40, 3]);
  const decoded = decodeArbiterLightEffect(decodeArbiterReply(reply(25, [...frame.slice(4, 30)]))!);
  assert.deepEqual(decoded, LIGHT);
  assert.equal(decodeArbiterLightEffect(decodeArbiterReply(reply(25, [1, 2, 3]))!), null);
  assert.throws(() => encodeArbiterLightEffectWrite({ ...LIGHT, effect: 16 }), RangeError);
  assert.throws(() => encodeArbiterLightEffectWrite({ ...LIGHT, colors: LIGHT.colors.slice(1) }), RangeError);
  assert.throws(() => encodeArbiterLightEffectWrite({ ...LIGHT, brightness: 300 }), RangeError);
});

test("profile selection is bounded by the model's profile count", () => {
  assert.deepEqual([...encodeArbiterBoardProfile(2, 3).slice(0, 5)], [0, 38, 0, 1, 2]);
  assert.throws(() => encodeArbiterBoardProfile(3, 3), RangeError);
  assert.throws(() => encodeArbiterBoardProfile(1, 1), RangeError);
});

test("user mode splits the flag from the alternative bit", () => {
  const decoded = decodeArbiterUserMode(decodeArbiterReply(reply(53, [1, 2, 1, 0x85, 7, 9]))!);
  assert.deepEqual(decoded, { layoutIndex: 1, mode: 2, checkFlag: 1, flag: 5, alternative: 1, keyIndex: [7, 9] });
  const frame = encodeArbiterUserModeWrite(decoded!);
  assert.deepEqual([...frame.slice(4, 10)], [1, 2, 1, 0x85, 7, 9]);
  assert.equal(decodeArbiterUserMode(decodeArbiterReply(reply(53, [1, 2]))!), null);
  assert.throws(() => encodeArbiterUserModeWrite({ ...decoded!, flag: 128 }), RangeError);
  assert.throws(() => encodeArbiterUserModeWrite({ ...decoded!, alternative: 2 as never }), RangeError);
});

test("write acknowledgements read the flag and tolerate a short body", () => {
  assert.equal(decodeArbiterWriteAck(decodeArbiterReply(reply(26, [1, 0, 0, 0x80]))!, ARBITER_COMMAND.setKeyMapping), 0x80000001);
  assert.equal(decodeArbiterWriteAck(decodeArbiterReply(reply(26, []))!, ARBITER_COMMAND.setKeyMapping), 0);
  assert.equal(decodeArbiterWriteAck(decodeArbiterReply(reply(24, []))!, ARBITER_COMMAND.setKeyMapping), null);
});

test("the catalog matches the vendor bundle and is entirely unverified", () => {
  assert.equal(ARBITER_PRODUCTS.length, 8);
  assert.ok(ARBITER_PRODUCTS.every((entry) => !entry.verified));
  assert.equal(arbiterProduct(0x1a81, 0x2072, 0xff01)?.superTap, false);
  assert.equal(arbiterProduct(0x1a81, 0x2072, 0xff02)?.superTap, true);
  assert.equal(arbiterProduct(0x371c, 0xa006, 0xff01)?.protocol, "s2");
  assert.equal(arbiterProduct(0x371c, 0xa003, 0xff01), undefined);
  assert.deepEqual(ARBITER_PRODUCTS.filter(arbiterIsPro).map((entry) => [entry.name, entry.layers, entry.profiles]),
    [["Polar 65 PRO", 2, 3], ["Polar 75 PRO", 2, 3]]);
});
