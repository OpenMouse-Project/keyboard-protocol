import assert from "node:assert/strict";
import test from "node:test";
import { KEYCHRON_HE_COMMAND, KEYCHRON_HE_PRODUCTS, KEYCHRON_HE_SUBCOMMAND as SUB } from "../../keychron/index.ts";
import { KeychronHidClient } from "./hid.ts";

const ID = Number(Object.keys(KEYCHRON_HE_PRODUCTS)[0]);
const { rows, cols } = KEYCHRON_HE_PRODUCTS[ID]!;

const SIZE = 4 * (rows * cols + 1) + 19 * 20 + 3 * 20 + 32;

/** A v4 board with three profiles; the active one is slot 1. */
class FakeBoard {
  vendorId = 0x3434;
  productId = ID;
  productName = "Keychron";
  opened = false;
  collections = [{ usagePage: 0xff60, usage: 0x61, inputReports: [], outputReports: [], featureReports: [], children: [] }];
  listeners = new Set<(event: HIDInputReportEvent) => void>();
  sent: Uint8Array[] = [];
  silent = false;
  silentVia = false;
  nak = false;
  buffer = new Uint8Array(SIZE);
  version = 4;
  get hid(): HIDDevice { return this as unknown as HIDDevice; }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  addEventListener(_t: string, l: (e: HIDInputReportEvent) => void) { this.listeners.add(l); }
  removeEventListener(_t: string, l: (e: HIDInputReportEvent) => void) { this.listeners.delete(l); }
  emit(frame: Uint8Array, reportId = 0) {
    const event = { device: this.hid, reportId, data: new DataView(frame.buffer, frame.byteOffset, frame.length) } as HIDInputReportEvent;
    this.listeners.forEach((l) => l(event));
  }
  async sendReport(reportId: number, data: BufferSource) {
    assert.equal(reportId, 0);
    const request = data as Uint8Array;
    assert.equal(request.length, 32);
    this.sent.push(request.slice());
    if (this.silent) return;
    if (request[0] === 0x11 || request[0] === 0x12) {
      if (this.silentVia) return;
      const via = new Uint8Array(32);
      via.set(request.slice(0, 4));
      if (request[0] === 0x11) via[1] = 4;
      else for (let i = 0; i < request[3]!; i += 2) { const key = ((request[1]! << 8 | request[2]!) + i) / 2; via[4 + i] = 0; via[5 + i] = 4 + (key % 26); }
      this.emit(via);
      return;
    }
    assert.equal(request[0], KEYCHRON_HE_COMMAND);
    const reply = new Uint8Array(32);
    reply.set(request.slice(0, 2));
    switch (request[1]) {
      case SUB.getVersion: reply.set([this.version, 0, 0b100001], 2); break;
      case SUB.getProfilesInfo: reply.set([1, 3, SIZE & 0xff, SIZE >> 8, 20, 20], 2); break;
      case SUB.getProfileBuffer: {
        reply.set(request.slice(2, 6), 2);
        const offset = request[3]! | (request[4]! << 8);
        const length = request[5]!;
        // The name window sits in the last 32 bytes: "P" + slot digit.
        const nameStart = SIZE - 32;
        const name = new Uint8Array(32);
        name.set([0, 0x50, 0, 0x30 + request[2]!]);
        for (let i = 0; i < length; i++) {
          const at = offset + i;
          reply[6 + i] = at >= nameStart ? name[at - nameStart]! : this.buffer[at]!;
        }
        break;
      }
      case SUB.setProfileName: break;
      case SUB.setTravel: case SUB.saveProfileBuffer: reply[2] = this.nak ? 1 : 0; break;
      case SUB.getRealtimeTravel: reply.set([request[2]!, request[3]!, 33], 3); break;
      default: break;
    }
    this.emit(new Uint8Array(32).fill(0x7f), 1); // wrong report id never completes a transaction
    this.emit(reply);
  }
}

const client = (board: FakeBoard) => new KeychronHidClient(board.hid);

test("isSupported needs a catalogued HE product and the raw-HID collection", () => {
  assert.equal(KeychronHidClient.isSupported(new FakeBoard().hid), true);
  const other = new FakeBoard(); other.productId = 0x0001;
  assert.equal(KeychronHidClient.isSupported(other.hid), false);
  const vendor = new FakeBoard(); vendor.vendorId = 0x1234;
  assert.equal(KeychronHidClient.isSupported(vendor.hid), false);
  const page = new FakeBoard(); page.collections = [{ ...page.collections[0]!, usage: 1 }];
  assert.equal(KeychronHidClient.isSupported(page.hid), false);
});

test("readStatus reports version, units and profile names", async () => {
  const board = new FakeBoard();
  const status = await client(board).readStatus();
  assert.equal(status.brand, "Keychron");
  assert.equal(status.activeProfile, 1);
  assert.equal(status.profileCount, 3);
  assert.deepEqual(status.profileNames, ["P0", "P1", "P2"]);
  assert.equal(status.keychron?.heVersion, 4);
  assert.equal(status.keychron?.unit, 0.1);
  assert.equal(status.keychron?.features.switchAxis, true);
  assert.equal(status.keychron?.features.supportMechanical, true);
});

test("readProfile walks the buffer in 26-byte reads and decodes keys", async () => {
  const board = new FakeBoard();
  const word = (12 << 2) | (3 << 8);
  board.buffer.set([word & 0xff, (word >> 8) & 0xff, 0, 0], 4 * (cols + 1)); // key (1,0)
  const profile = await client(board).readProfile();
  assert.equal(profile.keys[1]![0]!.distance, 12);
  assert.equal(profile.keys[1]![0]!.advancePress, 3);
  const reads = board.sent.filter((frame) => frame[1] === SUB.getProfileBuffer);
  assert.ok(reads.length >= Math.ceil(SIZE / 26));
  assert.ok(reads.every((frame) => frame[2] === 1 && frame[5]! <= 26));
  await assert.rejects(() => client(board).readProfile(9), RangeError);
});

test("setTravel targets the active profile and requires an acknowledgement", async () => {
  const board = new FakeBoard();
  const keyboard = client(board);
  await keyboard.setTravel({ workMode: 1, press: 20, sensitivePress: 4, keyMode: 1 });
  const write = board.sent.find((frame) => frame[1] === SUB.setTravel)!;
  assert.deepEqual([...write.slice(2, 8)], [1, 1, 20, 4, 4, 1]);
  await keyboard.saveProfile();
  assert.equal(board.sent.at(-1)![1], SUB.saveProfileBuffer);
  board.nak = true;
  await assert.rejects(() => keyboard.saveProfile(), /did not save/);
});

test("renameProfile writes the name then saves", async () => {
  const board = new FakeBoard();
  await client(board).renameProfile(2, "Aim");
  const rename = board.sent.find((frame) => frame[1] === SUB.setProfileName)!;
  assert.deepEqual([...rename.slice(2, 8)], [2, 6, 0, 0x41, 0, 0x69]);
  assert.equal(board.sent.at(-1)![1], SUB.saveProfileBuffer);
  await assert.rejects(() => client(board).renameProfile(7, "x"), RangeError);
  await assert.rejects(() => client(board).renameProfile(0, ""), RangeError);
});

test("readKeymap reads one layer through the VIA keymap command", async () => {
  const board = new FakeBoard();
  const keymap = await client(board).readKeymap(0);
  assert.equal(keymap.length, rows);
  assert.ok(keymap.every((row) => row.length === cols));
  assert.deepEqual(keymap[0]!.slice(0, 3), [4, 5, 6]);
  const reads = board.sent.filter((frame) => frame[0] === 0x12);
  assert.equal(reads.length, Math.ceil(rows * cols / 14));
  assert.equal(await client(board).readLayerCount(), 4);
});

test("a board that ignores the keymap read keeps its session for HE commands", async () => {
  const board = new FakeBoard();
  board.silentVia = true;
  const keyboard = client(board);
  await assert.rejects(() => keyboard.readKeymap(0), /did not answer/);
  await assert.rejects(() => keyboard.readLayerCount(), /did not answer/);
  assert.equal((await keyboard.readStatus()).brand, "Keychron");
  assert.equal(await keyboard.readKeyTravel(1, 1), 33);
});

test("live travel matches the echoed key", async () => {
  const board = new FakeBoard();
  assert.equal(await client(board).readKeyTravel(2, 5), 33);
});

test("a silent board faults the session so a late reply cannot confirm a later command", async () => {
  const board = new FakeBoard();
  board.silent = true;
  const keyboard = client(board);
  await assert.rejects(() => keyboard.readStatus(), /did not answer/);
  board.silent = false;
  await assert.rejects(() => keyboard.readStatus(), /Reconnect/);
});

test("close releases the device and rejects further use", async () => {
  const board = new FakeBoard();
  const keyboard = client(board);
  await keyboard.readStatus();
  await keyboard.close();
  assert.equal(board.opened, false);
  assert.equal(board.listeners.size, 0);
  await assert.rejects(() => keyboard.open(), /Reconnect/);
});
