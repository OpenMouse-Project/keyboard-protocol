import assert from "node:assert/strict";
import test from "node:test";
import {
  ARBITER_COMMAND,
  ARBITER_KEY_CODE,
  ARBITER_PACKET,
  ARBITER_PRODUCTS,
  arbiterChecksum,
  arbiterIsPro,
  arbiterKeyMappingPackets,
  arbiterLayout,
  arbiterMatrixToWire,
  arbiterWireToMatrix,
  arbiterTravelPackets,
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
  assert.deepEqual(ARBITER_PRODUCTS.map((entry) => [entry.name, entry.travelKeys, entry.bindingKeys, arbiterTravelPackets(entry), arbiterKeyMappingPackets(entry)]), [
    ["Arbiter Polar 65", 68, 68, 3, 3], ["Arbiter Polar 65", 68, 68, 3, 3], ["Polar 65", 68, 68, 3, 3], ["Nimbus 65", 68, 68, 3, 3],
    ["Polar 65", 68, 68, 3, 3], ["Arbiter Polar 65", 69, 69, 3, 3], ["Polar 65 PRO", 68, 68, 3, 5], ["Polar 75 PRO", 82, 81, 3, 6],
  ]);
  assert.deepEqual(ARBITER_PRODUCTS.filter(arbiterIsPro).map((entry) => [entry.name, entry.layers, entry.profiles]),
    [["Polar 65 PRO", 2, 3], ["Polar 75 PRO", 2, 3]]);
});

test("layouts match the catalog and the factory main layer is the matrix", () => {
  for (const entry of ARBITER_PRODUCTS) {
    const layout = arbiterLayout(entry);
    assert.equal(layout.layers.length, entry.layers);
    for (const layer of layout.layers) assert.equal(layer.length, layout.matrix.length);
    assert.deepEqual(layout.layers[0], layout.matrix.map((key) => key.keyCode));
  }
  assert.deepEqual(ARBITER_PRODUCTS.map((entry) => arbiterLayout(entry).matrix.length), [68, 68, 68, 68, 68, 70, 68, 82]);
});

test("wire entries map to matrix keys without landing on a placeholder", () => {
  for (const entry of ARBITER_PRODUCTS) {
    const { matrix } = arbiterLayout(entry);
    for (const table of ["travel", "bindings"] as const) {
      const size = table === "travel" ? entry.travelKeys : entry.bindingKeys;
      const seen = new Set<number>();
      for (let wire = 0; wire < size; wire += 1) {
        const index = arbiterWireToMatrix(entry, table, wire)!;
        assert.equal(arbiterMatrixToWire(entry, table, index), wire);
        seen.add(index);
        // The 75 PRO's travel table keeps its placeholder slot; no other table does.
        if (!(entry.protocol === "u2" && table === "travel" && wire === 81)) assert.notEqual(matrix[index]!.name, "None");
      }
      assert.equal(seen.size, size);
      assert.equal(arbiterWireToMatrix(entry, table, size), null);
    }
  }
});

test("the s2 board skips matrix index 28 and the 75 PRO omits its last key mapping slot", () => {
  const s2 = arbiterProduct(0x371c, 0xa006, 0xff01)!;
  assert.deepEqual([27, 28, 68].map((wire) => arbiterWireToMatrix(s2, "travel", wire)), [27, 29, 69]);
  assert.equal(arbiterMatrixToWire(s2, "bindings", 28), null);
  assert.equal(arbiterLayout(s2).matrix[28]!.name, "None");
  const pro75 = arbiterProduct(0x371c, 0xa001, 0xff02)!;
  assert.equal(arbiterMatrixToWire(pro75, "bindings", 81), null);
  assert.equal(arbiterMatrixToWire(pro75, "travel", 81), 81);
  assert.equal(arbiterLayout(pro75).matrix[81]!.name, "None");
});

test("the PRO FN layers differ from Main where the vendor defines media and function keys", () => {
  const pro65 = arbiterLayout(arbiterProduct(0x371c, 0xa003, 0xff02)!);
  assert.equal(pro65.layers[1]!.filter((code, i) => code !== pro65.layers[0]![i]).length, 33);
  const names = pro65.matrix.map((key) => key.name);
  assert.equal(names[1], "D1");
  assert.equal(pro65.layers[1]![1], 112); // F1
  const pro75 = arbiterLayout(arbiterProduct(0x371c, 0xa001, 0xff02)!);
  assert.equal(pro75.layers[1]!.filter((code, i) => code !== pro75.layers[0]![i]).length, 8);
  // LShift is the SuperTap key on the FN layer, and the Alt positions are the Fn key.
  assert.equal(pro65.layers[1]![44], ARBITER_KEY_CODE.superTap);
  assert.equal(pro65.layers[1]![60], ARBITER_KEY_CODE.fnLayer);
  assert.equal(pro65.layers[0]![63], ARBITER_KEY_CODE.fn);
});
