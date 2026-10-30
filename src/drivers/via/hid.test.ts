import assert from "node:assert/strict";
import test from "node:test";

import { ViaHidClient, ViaUnhandledError } from "./hid.ts";
import { VIA_COMMAND, VIA_REPORT_LENGTH, decodeViaKeymap, encodeViaKeymap } from "@openmouse/keyboard-protocol/via";

const MATRIX = { rows: 2, cols: 3 };

class FakeViaBoard {
  vendorId = 0xfeed;
  productId = 0x0001;
  productName = "Test VIA Board";
  opened = false;
  collections = [{ usagePage: 0xff60, usage: 0x61, inputReports: [], outputReports: [], featureReports: [], children: [] }];
  protocol = 9;
  firmware = [0, 0, 1, 2];
  layoutOptions = [0, 0, 0, 3];
  customMax = 255;
  keymap = encodeViaKeymap([[4, 5, 6, 7, 8, 9], [0x5100, 0x5101, 0x5102, 0x5103, 0x5104, 0x5105]]);
  macros = [0x61, 0x62, 0, 0x63, 0, ...new Array<number>(11).fill(0)];
  custom = new Map<string, number[]>([["3,1", [128]], ["3,2", [5]], ["3,4", [10, 200]]]);
  unhandled = new Set<number>([0x06]);
  corruptKeymapWrites = false;
  silent = false;
  sent: number[][] = [];
  private listeners = new Set<(event: HIDInputReportEvent) => void>();

  async open(): Promise<void> { this.opened = true; }
  async close(): Promise<void> { this.opened = false; }
  addEventListener(_type: "inputreport", listener: (event: HIDInputReportEvent) => void): void { this.listeners.add(listener); }
  removeEventListener(_type: "inputreport", listener: (event: HIDInputReportEvent) => void): void { this.listeners.delete(listener); }

  async sendReport(_reportId: number, source: BufferSource): Promise<void> {
    const request = new Uint8Array(source instanceof ArrayBuffer ? source : source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
    this.sent.push([...request]);
    if (this.silent) return;
    const reply = this.respond(request);
    const event = { reportId: 0, data: new DataView(reply.buffer), device: this } as unknown as HIDInputReportEvent;
    for (const listener of this.listeners) listener(event);
  }

  private respond(request: Uint8Array): Uint8Array<ArrayBuffer> {
    const reply = new Uint8Array(VIA_REPORT_LENGTH);
    reply.set(request);
    const [command, a = 0, b = 0, c = 0] = request;
    const offset = (a << 8) | b;
    const keyAt = (a * 6 + b * 3 + c) * 2;
    switch (command) {
      case VIA_COMMAND.getProtocolVersion: reply.set([this.protocol >> 8, this.protocol & 0xff], 1); break;
      case VIA_COMMAND.getKeyboardValue:
        if (this.unhandled.has(a)) reply[0] = 0xff;
        else if (a === 0x04) reply.set(this.firmware, 2);
        else if (a === 0x02) reply.set(this.layoutOptions, 2);
        else if (a === 0x01) reply.set([0, 0, 0x03, 0xe8], 2);
        else if (a === 0x03) reply.set(this.protocol >= 13 ? [request[2]!, 0x00, 0x05, 0x01, 0x00] : [0x00, 0x05, 0x01, 0x00], 2);
        break;
      case VIA_COMMAND.setKeyboardValue: if (a === 0x02) this.layoutOptions = [...request.slice(2, 6)]; break;
      case VIA_COMMAND.getLayerCount: reply[1] = 2; break;
      case VIA_COMMAND.getKeymapBuffer: reply.set(this.keymap.slice(offset, offset + c), 4); break;
      case VIA_COMMAND.setKeymapBuffer: {
        const data = request.slice(4, 4 + c);
        if (this.corruptKeymapWrites) data[0] = (data[0]! + 1) & 0xff;
        this.keymap.splice(offset, c, ...data);
        break;
      }
      case VIA_COMMAND.getKeycode: reply.set(this.keymap.slice(keyAt, keyAt + 2), 4); break;
      case VIA_COMMAND.setKeycode: this.keymap.splice(keyAt, 2, request[4]!, request[5]!); break;
      case VIA_COMMAND.macroGetCount: reply[1] = 3; break;
      case VIA_COMMAND.macroGetBufferSize: reply.set([0, this.macros.length], 1); break;
      case VIA_COMMAND.macroGetBuffer: reply.set(this.macros.slice(offset, offset + c), 4); break;
      case VIA_COMMAND.macroSetBuffer: this.macros.splice(offset, c, ...request.slice(4, 4 + c)); break;
      case VIA_COMMAND.customMenuGet: {
        const value = this.custom.get(`${a},${b}`);
        if (value) reply.set(value, 3); else reply[0] = 0xff;
        break;
      }
      case VIA_COMMAND.customMenuSet: {
        const key = `${a},${b}`;
        this.custom.set(key, [...request.slice(3, 3 + (this.custom.get(key)?.length ?? 1))].map((byte) => Math.min(byte, this.customMax)));
        break;
      }
      default: reply[0] = 0xff;
    }
    return reply;
  }
}

const client = (board: FakeViaBoard) => new ViaHidClient(board as unknown as HIDDevice);

test("the VIA client recognises the raw HID collection, nested or not", () => {
  const board = new FakeViaBoard();
  assert.ok(ViaHidClient.isSupported(board as unknown as HIDDevice));
  board.collections = [{ usagePage: 1, usage: 6, inputReports: [], outputReports: [], featureReports: [], children: board.collections }];
  assert.ok(ViaHidClient.isSupported(board as unknown as HIDDevice));
  board.collections = [];
  assert.equal(ViaHidClient.isSupported(board as unknown as HIDDevice), false);
});

test("readStatus reports identity and leaves unsupported values null", async () => {
  const status = await client(new FakeViaBoard()).readStatus();
  assert.equal(status.brand, "VIA");
  assert.equal(status.name, "Test VIA Board");
  assert.deepEqual(status.via, {
    protocolVersion: 9,
    layerCount: 2,
    firmwareVersion: 0x0102,
    keycodesVersion: null,
    layoutOptions: 3,
    uptimeMs: 1000,
    macroCount: 3,
    macroBufferSize: 16,
  });
  assert.deepEqual(status.firmware, ["VIA protocol 9", "Firmware 258"]);
});

test("a firmware version of 0 means the maker never set one and is reported as unknown", async () => {
  const board = new FakeViaBoard();
  board.firmware = [0, 0, 0, 0];
  const status = await client(board).readStatus();
  assert.equal(status.firmwareVersion, null);
  assert.deepEqual(status.firmware, ["VIA protocol 9"]);
});

test("layout options are written as a 32-bit value and read back", async () => {
  const board = new FakeViaBoard();
  const via = client(board);
  assert.equal(await via.setLayoutOptions(0x00000105), 0x105);
  assert.deepEqual(board.layoutOptions, [0, 0, 1, 5]);
  assert.equal((await via.readStatus()).via?.layoutOptions, 0x105);
});

test("the keymap reads back as one array per layer", async () => {
  const keymap = await client(new FakeViaBoard()).readKeymap(MATRIX);
  assert.deepEqual(keymap, [[4, 5, 6, 7, 8, 9], [0x5100, 0x5101, 0x5102, 0x5103, 0x5104, 0x5105]]);
});

test("writeKeymap sends buffer chunks and confirms by read-back", async () => {
  const board = new FakeViaBoard();
  const next = [[10, 11, 12, 13, 14, 15], [16, 17, 18, 19, 20, 21]];
  await client(board).writeKeymap(next, MATRIX);
  assert.deepEqual(decodeViaKeymap([...board.keymap], 2, 2, 3), next);
  assert.equal(board.sent.filter((frame) => frame[0] === VIA_COMMAND.setKeymapBuffer).length, 1);
});

test("writeKeymap rejects a board whose read-back differs and a wrong-sized layer", async () => {
  const board = new FakeViaBoard();
  board.corruptKeymapWrites = true;
  await assert.rejects(client(board).writeKeymap([[1, 2, 3, 4, 5, 6]], MATRIX), /read-back/);
  await assert.rejects(client(new FakeViaBoard()).writeKeymap([[1, 2]], MATRIX), RangeError);
});

test("setKeycode confirms a single key", async () => {
  const board = new FakeViaBoard();
  assert.equal(await client(board).setKeycode(1, 1, 2, 0x1234), 0x1234);
  assert.equal(await client(board).readKeycode(1, 1, 2), 0x1234);
});

test("macros read as raw bytes per macro and rewrite with read-back", async () => {
  const board = new FakeViaBoard();
  const via = client(board);
  assert.deepEqual((await via.readMacros()).macros, [[0x61, 0x62], [0x63], []]);
  await via.writeMacros([[0x41], [], [0x42, 0x43]]);
  assert.deepEqual((await via.readMacros()).macros, [[0x41], [], [0x42, 0x43]]);
  await assert.rejects(via.writeMacros([[1]]), RangeError);
});

test("custom values are read and written through the custom menu channel", async () => {
  const via = client(new FakeViaBoard());
  assert.deepEqual(await via.readCustomValue([3, 4], 2), [10, 200]);
  await via.setCustomValue([3, 1], [64]);
  assert.deepEqual(await via.readCustomValue([3, 1], 1), [64]);
  await assert.rejects(via.readCustomValue([9, 9], 1), ViaUnhandledError);
});

test("a custom value the board clamps is reported as the board holds it, not as an error", async () => {
  const board = new FakeViaBoard();
  board.customMax = 100;
  const via = client(board);
  assert.deepEqual(await via.setCustomValue([3, 1], [200]), [100]);
  assert.deepEqual(await via.readCustomValue([3, 1], 1), [100]);
  assert.deepEqual(await via.setCustomValue([3, 1], [50]), [50]);
  assert.deepEqual(await via.setCustomValue([3, 1], [200], false), [200]);
});

test("a silent board times out and the session refuses further commands", async () => {
  const board = new FakeViaBoard();
  board.silent = true;
  const via = client(board);
  await assert.rejects(via.readKeycode(0, 0, 0), /did not answer/);
  board.silent = false;
  await assert.rejects(via.readKeycode(0, 0, 0), /Reconnect/);
});

test("the switch matrix reads as one big-endian bit mask per row", async () => {
  const board = new FakeViaBoard();
  const client = new ViaHidClient(board as unknown as HIDDevice);
  await client.open();
  assert.deepEqual(await client.readSwitchMatrix(2, 9), [5, 256]);
  await assert.rejects(client.readSwitchMatrix(40, 8), RangeError);
});

test("protocol 13 pages the switch matrix: the request names the first row and the reply echoes it", async () => {
  const board = new FakeViaBoard();
  board.protocol = 13;
  const client = new ViaHidClient(board as unknown as HIDDevice);
  await client.open();
  assert.deepEqual(await client.readSwitchMatrix(2, 9), [5, 256]);
  const request = board.sent.filter((frame) => frame[0] === VIA_COMMAND.getKeyboardValue && frame[1] === 0x03).at(-1)!;
  assert.equal(request[2], 0);
});

test("a macro upload holds playback with a non-zero last byte and releases it only when every chunk is in", async () => {
  const board = new FakeViaBoard();
  const via = client(board);
  await via.writeMacros([[0x41], [], [0x42, 0x43]]);
  const writes = board.sent.filter((frame) => frame[0] === VIA_COMMAND.macroSetBuffer);
  const last = board.macros.length - 1;
  assert.deepEqual([writes[0]!.slice(1, 5)], [[last >> 8, last & 0xff, 1, 0xff]]);
  assert.deepEqual(writes.at(-1)!.slice(1, 5), [last >> 8, last & 0xff, 1, 0]);
  assert.equal(board.macros[last], 0);
});
