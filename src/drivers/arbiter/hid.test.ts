import assert from "node:assert/strict";
import test from "node:test";
import {
  ARBITER_COMMAND,
  arbiterChecksum,
  decodeArbiterReply,
  type ArbiterLightEffect,
} from "../../arbiter/index.ts";
import { ArbiterKeyboardHidClient } from "./hid.ts";
import { createSupportedClient, deviceBrand } from "../registry.ts";
import { ARBITER_HID_FILTERS, VENDOR_ID } from "../vendors.ts";

const KEYS = 68;

/** The fake is sized from a catalog model: keys per layer, layers and packet counts. */
interface Shape { vendorId: number; productId: number; usagePage: number; travelKeys: number; bindingKeys: number; layers: number }
const POLAR_65: Shape = { vendorId: 0x1a81, productId: 0x2072, usagePage: 0xff02, travelKeys: 68, bindingKeys: 68, layers: 1 };
const POLAR_65_PRO: Shape = { vendorId: 0x371c, productId: 0xa003, usagePage: 0xff02, travelKeys: 68, bindingKeys: 68, layers: 2 };
const POLAR_75_PRO: Shape = { vendorId: 0x371c, productId: 0xa001, usagePage: 0xff02, travelKeys: 82, bindingKeys: 81, layers: 2 };
const ARBITER_S2: Shape = { vendorId: 0x371c, productId: 0xa006, usagePage: 0xff01, travelKeys: 69, bindingKeys: 69, layers: 1 };

/** A 68-key Polar 65 that answers the documented frames. */
class FakeArbiterKeyboard {
  vendorId = 0x1a81;
  productId = 0x2072;
  productName = "Polar 65";
  opened = false;
  collections: HIDCollectionInfo[] = [{ usagePage: 0xff02, usage: 1, inputReports: [], outputReports: [], featureReports: [], children: [] }];
  listeners = new Set<(event: HIDInputReportEvent) => void>();
  sent: Uint8Array[] = [];
  travel: { make: number; break: number }[] = Array.from({ length: KEYS }, () => ({ make: 10, break: 10 }));
  bindings: { keyCode: number; param: number }[] = Array.from({ length: KEYS }, (_, i) => ({ keyCode: 27 + (i % 5), param: 0 }));
  travelTotal = 3;
  mappingTotal = 3;
  light: number[] = [1, 2, 100, 50, 0, ...new Array(21).fill(0)];
  userMode = [0, 1, 1, 0, 3, 4];
  status = 0;
  silent = false;
  /** Stop answering after this many requests (-1 never). */
  silentAfter = -1;
  forgetWrites = false;
  constructor(shape: Shape = POLAR_65) {
    this.vendorId = shape.vendorId;
    this.productId = shape.productId;
    this.collections[0]!.usagePage = shape.usagePage;
    this.travel = Array.from({ length: shape.travelKeys }, () => ({ make: 10, break: 10 }));
    this.bindings = Array.from({ length: shape.bindingKeys * shape.layers }, (_, i) => ({ keyCode: 27 + (i % 5), param: i >= shape.bindingKeys ? 1 : 0 }));
    this.travelTotal = Math.ceil(shape.travelKeys / 29);
    this.mappingTotal = Math.ceil((shape.bindingKeys * shape.layers) / 29);
  }
  get hid(): HIDDevice { return this as unknown as HIDDevice; }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  addEventListener(_type: string, listener: (event: HIDInputReportEvent) => void) { this.listeners.add(listener); }
  removeEventListener(_type: string, listener: (event: HIDInputReportEvent) => void) { this.listeners.delete(listener); }
  emit(frame: Uint8Array, reportId = 0) {
    const event = { device: this.hid, reportId, data: new DataView(frame.buffer, 0, frame.length) } as HIDInputReportEvent;
    this.listeners.forEach((listener) => listener(event));
  }
  private reply(command: number, packetBits: number, data: number[]) {
    const frame = new Uint8Array(64);
    frame[1] = command | packetBits;
    frame[2] = this.status;
    frame[3] = data.length;
    frame.set(data, 4);
    frame[63] = arbiterChecksum(frame);
    this.emit(frame);
  }
  private tablePacket(rows: number[][], index: number, total: number) {
    return [index | (total << 4), ...rows.slice(index * 29, (index + 1) * 29).flat()];
  }
  async sendReport(reportId: number, buffer: BufferSource) {
    assert.equal(reportId, 0);
    const request = new Uint8Array(buffer as Uint8Array);
    assert.equal(request.length, 64);
    assert.equal(arbiterChecksum(request), request[63]);
    this.sent.push(request);
    if (this.silent || (this.silentAfter >= 0 && this.sent.length > this.silentAfter)) return;
    const command = request[1]! & 0x3f;
    const bits = request[1]! & 0xc0;
    const data = request.slice(4, 4 + request[3]!);
    const index = (data[0] ?? 0) & 15;
    switch (command) {
      case ARBITER_COMMAND.getFirmware: return this.reply(command, bits, [5, 0, 0, 0, 0, 0, 0, 1]);
      case ARBITER_COMMAND.getSerial: return this.reply(command, bits, [0xab, 0x01, 0x02]);
      case ARBITER_COMMAND.getTravel:
        return this.reply(command, bits, this.tablePacket(this.travel.map((k) => [k.make, k.break]), index, this.travelTotal));
      case ARBITER_COMMAND.setTravel: {
        if (!this.forgetWrites) {
          for (let i = 1; i + 1 < data.length; i += 2) this.travel[index * 29 + (i - 1) / 2] = { make: data[i]!, break: data[i + 1]! };
        }
        return this.reply(command, bits, [1, 0, 0, 0]);
      }
      case ARBITER_COMMAND.getKeyMapping:
        return this.reply(command, bits, this.tablePacket(this.bindings.map((b) => [b.keyCode, b.param]), index, this.mappingTotal));
      case ARBITER_COMMAND.setKeyMapping: {
        if (!this.forgetWrites) {
          for (let i = 1; i + 1 < data.length; i += 2) this.bindings[index * 29 + (i - 1) / 2] = { keyCode: data[i]!, param: data[i + 1]! };
        }
        return this.reply(command, bits, [1, 0, 0, 0]);
      }
      case ARBITER_COMMAND.getLightEffect: return this.reply(command, bits, this.light);
      case ARBITER_COMMAND.setLightEffect:
        if (!this.forgetWrites) this.light = [...data];
        return this.reply(command, bits, [1, 0, 0, 0]);
      case ARBITER_COMMAND.getUserMode: return this.reply(command, bits, this.userMode);
      case ARBITER_COMMAND.setUserMode:
        if (!this.forgetWrites) this.userMode = [...data];
        return this.reply(command, bits, [1, 0, 0, 0]);
      case ARBITER_COMMAND.setBoardProfile: return this.reply(command, bits, [1, 0, 0, 0]);
    }
  }
}

const LIGHT: ArbiterLightEffect = {
  on: true, effect: 4, brightness: 60, speed: 20, colorIndex: 1,
  colors: Array.from({ length: 7 }, (_, i) => ({ red: i, green: 0, blue: 255 - i })),
};

test("registry and filters claim only catalogued vendor, product and usage page triples", () => {
  const device = new FakeArbiterKeyboard();
  assert.ok(createSupportedClient(device.hid) instanceof ArbiterKeyboardHidClient);
  assert.equal(deviceBrand(new ArbiterKeyboardHidClient(device.hid)), "Arbiter Studio");
  assert.equal(ARBITER_HID_FILTERS.length, 9);
  assert.deepEqual(ARBITER_HID_FILTERS[0], { vendorId: 0x1a81, productId: 0x2072, usagePage: 0xff01, usage: 1 });
  assert.equal(VENDOR_ID.arbiter, 0x1a81);
  assert.equal(VENDOR_ID.arbiterAlt, 0x371c);
  device.collections[0]!.usagePage = 0xff01; // 0x2072 exists on both pages
  assert.equal(ArbiterKeyboardHidClient.isSupported(device.hid), true);
  device.collections[0]!.usagePage = 0xff03;
  assert.equal(ArbiterKeyboardHidClient.isSupported(device.hid), false);
  device.collections[0]!.usagePage = 0xff02; device.productId = 0x2073;
  assert.equal(ArbiterKeyboardHidClient.isSupported(device.hid), false);
  device.productId = 0x2072; device.vendorId = 0x371c;
  assert.equal(ArbiterKeyboardHidClient.isSupported(device.hid), false);
});

test("a config collection nested under a parent is still claimed", () => {
  const device = new FakeArbiterKeyboard();
  device.collections = [{ usagePage: 1, usage: 6, inputReports: [], outputReports: [], featureReports: [], children: device.collections }];
  assert.equal(ArbiterKeyboardHidClient.isSupported(device.hid), true);
});

test("status reads identity, travel, light and SuperTap and releases the listener on close", async () => {
  const device = new FakeArbiterKeyboard();
  const client = new ArbiterKeyboardHidClient(device.hid);
  const status = await client.readStatus();
  assert.equal(status.brand, "Arbiter Studio");
  assert.equal(status.name, "Arbiter Polar 65");
  assert.equal(status.firmwareVersion, "V0105");
  assert.equal(status.serial, "ab12");
  assert.equal(status.profileCount, 1);
  assert.equal(status.arbiter?.travel?.length, KEYS);
  assert.equal(status.arbiter?.light?.effect, 2);
  assert.equal(status.arbiter?.userMode?.keyIndex[0], 3);
  assert.equal(status.arbiter?.verified, false);
  assert.match(status.ui?.statusNote ?? "", /not been tested/);
  await client.close();
  assert.equal(device.listeners.size, 0);
});

test("a model without SuperTap never asks for the user mode", async () => {
  const device = new FakeArbiterKeyboard();
  device.collections[0]!.usagePage = 0xff01;
  const client = new ArbiterKeyboardHidClient(device.hid);
  const status = await client.readStatus();
  assert.equal(status.arbiter?.userMode, null);
  assert.equal(device.sent.some((frame) => (frame[1]! & 0x3f) === ARBITER_COMMAND.getUserMode), false);
  await assert.rejects(client.readUserMode(), /SuperTap/);
  await client.close();
});

test("travel is read across all three packets", async () => {
  const device = new FakeArbiterKeyboard();
  device.travel[0] = { make: 3, break: 4 };
  device.travel[67] = { make: 7, break: 8 };
  const client = new ArbiterKeyboardHidClient(device.hid);
  const travel = await client.readTravel();
  assert.equal(travel.length, KEYS);
  assert.deepEqual(travel[0], { make: 3, break: 4 });
  assert.deepEqual(travel[67], { make: 7, break: 8 });
  const reads = device.sent.filter((frame) => (frame[1]! & 0x3f) === ARBITER_COMMAND.getTravel);
  assert.deepEqual(reads.map((frame) => frame[4]), [0x30, 0x31, 0x32]);
  await client.close();
});

test("setKeyTravel patches chosen keys, preserves the rest and verifies by read-back", async () => {
  const device = new FakeArbiterKeyboard();
  device.travel[5] = { make: 99, break: 98 };
  const client = new ArbiterKeyboardHidClient(device.hid);
  const result = await client.setKeyTravel([{ index: 0, make: 4 }, { index: 40, break: 6 }]);
  assert.deepEqual(result[0], { make: 4, break: 10 });
  assert.deepEqual(result[40], { make: 10, break: 6 });
  assert.deepEqual(result[5], { make: 99, break: 98 });
  assert.equal(device.sent.filter((frame) => (frame[1]! & 0x3f) === ARBITER_COMMAND.setTravel).length, 3);
  await client.close();
});

test("travel writes reject bad keys and values before anything is sent", async () => {
  const device = new FakeArbiterKeyboard();
  const client = new ArbiterKeyboardHidClient(device.hid);
  await assert.rejects(client.setKeyTravel([{ index: 68, make: 1 }]), /outside/);
  await assert.rejects(client.setKeyTravel([{ index: 0, make: 39 }]), /actuation must be 1-38 \(0.1-3.8 mm\)/);
  await assert.rejects(client.setKeyTravel([{ index: 0, make: 0 }]), /actuation must be/);
  await assert.rejects(client.setKeyTravel([{ index: 0, break: 25 }]), /rapid trigger must be 1-24 \(0.1-2.4 mm\)/);
  await assert.rejects(client.setKeyTravel([{ index: 0, make: 1.5 }]), /actuation must be/);
  assert.equal(device.sent.some((frame) => (frame[1]! & 0x3f) === ARBITER_COMMAND.setTravel), false);
  await client.close();
});

test("a keyboard that ignores a travel write is reported, not trusted", async () => {
  const device = new FakeArbiterKeyboard(); device.forgetWrites = true;
  const client = new ArbiterKeyboardHidClient(device.hid);
  await assert.rejects(client.setKeyTravel([{ index: 0, make: 4 }]), /did not retain/);
  await client.close();
});

test("light effect writes are confirmed by read-back", async () => {
  const device = new FakeArbiterKeyboard();
  const client = new ArbiterKeyboardHidClient(device.hid);
  assert.deepEqual(await client.setLightEffect(LIGHT), LIGHT);
  await client.close();
  const ignoring = new FakeArbiterKeyboard(); ignoring.forgetWrites = true;
  const second = new ArbiterKeyboardHidClient(ignoring.hid);
  await assert.rejects(second.setLightEffect(LIGHT), /did not retain/);
  await second.close();
});

test("65 models have one key binding layer and use three packets", async () => {
  const device = new FakeArbiterKeyboard();
  const client = new ArbiterKeyboardHidClient(device.hid);
  const before = await client.readKeyBindings();
  assert.equal(before.length, 1);
  assert.equal(before[0]!.length, KEYS);
  const after = await client.setKeyBindings([{ index: 10, keyCode: 65 }]);
  assert.deepEqual(after[0]![10], { keyCode: 65, param: 0 });
  assert.deepEqual(after[0]![11], before[0]![11]);
  assert.equal(device.sent.filter((frame) => (frame[1]! & 0x3f) === ARBITER_COMMAND.setKeyMapping).length, 3);
  await assert.rejects(client.setKeyBindings([{ index: 99, keyCode: 1 }]), /outside/);
  await assert.rejects(client.setKeyBindings([{ layer: 1, index: 0, keyCode: 1 }]), /outside/);
  await client.close();
});

test("the 65 PRO reads and writes two layers across five packets", async () => {
  const device = new FakeArbiterKeyboard(POLAR_65_PRO);
  const client = new ArbiterKeyboardHidClient(device.hid);
  const before = await client.readKeyBindings();
  assert.deepEqual(before.map((layer) => layer.length), [68, 68]);
  assert.equal(before[1]![0]!.param, 1);
  const reads = device.sent.filter((frame) => (frame[1]! & 0x3f) === ARBITER_COMMAND.getKeyMapping);
  assert.deepEqual(reads.map((frame) => frame[4]), [0x50, 0x51, 0x52, 0x53, 0x54]);
  const after = await client.setKeyBindings([{ layer: 1, index: 5, keyCode: 65 }, { layer: 0, index: 67, keyCode: 66, param: 2 }]);
  assert.deepEqual(after[1]![5], { keyCode: 65, param: 0 });
  assert.deepEqual(after[0]![67], { keyCode: 66, param: 2 });
  assert.deepEqual(after[0]![5], before[0]![5]);
  assert.equal(device.sent.filter((frame) => (frame[1]! & 0x3f) === ARBITER_COMMAND.setKeyMapping).length, 5);
  await client.close();
});

test("the 75 PRO has 81 bindings per layer, 82 travel entries and six mapping packets", async () => {
  const device = new FakeArbiterKeyboard(POLAR_75_PRO);
  const client = new ArbiterKeyboardHidClient(device.hid);
  assert.deepEqual((await client.readKeyBindings()).map((layer) => layer.length), [81, 81]);
  assert.equal(device.sent.filter((frame) => (frame[1]! & 0x3f) === ARBITER_COMMAND.getKeyMapping).length, 6);
  assert.equal((await client.readTravel()).length, 82);
  assert.equal(device.sent.filter((frame) => (frame[1]! & 0x3f) === ARBITER_COMMAND.getTravel).length, 3);
  await client.setKeyBindings([{ layer: 1, index: 80, keyCode: 70 }]);
  assert.equal(device.bindings[161]!.keyCode, 70);
  await assert.rejects(client.setKeyBindings([{ layer: 1, index: 81, keyCode: 70 }]), /outside/);
  await client.close();
});

test("the Arbiter Polar 65 on 0xA006 has 69 wire entries in both tables", async () => {
  const device = new FakeArbiterKeyboard(ARBITER_S2);
  const client = new ArbiterKeyboardHidClient(device.hid);
  assert.equal((await client.readTravel()).length, 69);
  assert.equal((await client.readKeyBindings())[0]!.length, 69);
  assert.equal(device.sent.filter((frame) => (frame[1]! & 0x3f) === ARBITER_COMMAND.getTravel).length, 3);
  await client.close();
});

test("rebinding a key writes param 0 unless one is given, and leaves other keys' params alone", async () => {
  const device = new FakeArbiterKeyboard(POLAR_65_PRO);
  const client = new ArbiterKeyboardHidClient(device.hid);
  const after = await client.setKeyBindings([{ layer: 1, index: 3, keyCode: 65 }, { layer: 1, index: 4, keyCode: 66, param: 7 }]);
  assert.equal(after[1]![3]!.param, 0);
  assert.equal(after[1]![4]!.param, 7);
  assert.equal(after[1]![5]!.param, 1);
  await client.close();
});

test("a keyboard that reports the wrong table size or a short table is rejected", async () => {
  const wrongTotal = new FakeArbiterKeyboard(POLAR_65_PRO);
  wrongTotal.mappingTotal = 4;
  const first = new ArbiterKeyboardHidClient(wrongTotal.hid);
  await assert.rejects(first.readKeyBindings(), /unexpected table size/);
  await first.close();
  const short = new FakeArbiterKeyboard(POLAR_65);
  short.travel = short.travel.slice(0, 60);
  const second = new ArbiterKeyboardHidClient(short.hid);
  await assert.rejects(second.readTravel(), /expected 68/);
  await second.close();
});

test("a keyboard that ignores a key mapping write is reported", async () => {
  const device = new FakeArbiterKeyboard(POLAR_65_PRO); device.forgetWrites = true;
  const client = new ArbiterKeyboardHidClient(device.hid);
  await assert.rejects(client.setKeyBindings([{ layer: 1, index: 0, keyCode: 65 }]), /did not retain/);
  await client.close();
});

test("profile switching is bounded and only acknowledged", async () => {
  const device = new FakeArbiterKeyboard(POLAR_65_PRO);
  const client = new ArbiterKeyboardHidClient(device.hid);
  await client.setBoardProfile(2);
  assert.deepEqual([...device.sent.at(-1)!.slice(0, 5)], [0, 38, 0, 1, 2]);
  await assert.rejects(client.setBoardProfile(3), /profile must be/);
  await client.close();
});

test("user mode writes are confirmed by read-back", async () => {
  const device = new FakeArbiterKeyboard();
  const client = new ArbiterKeyboardHidClient(device.hid);
  const mode = await client.readUserMode();
  const written = await client.setUserMode({ ...mode, checkFlag: 0, keyIndex: [9, 10] });
  assert.equal(written.checkFlag, 0);
  assert.deepEqual(written.keyIndex, [9, 10]);
  await client.close();
});

test("a refused command surfaces the status name and requires a reconnect", async () => {
  const device = new FakeArbiterKeyboard(); device.status = 3;
  const client = new ArbiterKeyboardHidClient(device.hid);
  await assert.rejects(client.readTravel(), /NoSupport/);
  await assert.rejects(client.readTravel(), /Reconnect/);
  await client.close();
});

test("status fails if the session dies during an optional read instead of returning nulls", async () => {
  const device = new FakeArbiterKeyboard(); device.silentAfter = 1; // answers firmware, then nothing
  const client = new ArbiterKeyboardHidClient(device.hid);
  await assert.rejects(client.readStatus(), /did not answer/);
  await assert.rejects(client.readStatus(), /Reconnect/);
  await client.close();
});

test("an optional read that fails without killing the session leaves its field null", async () => {
  const device = new FakeArbiterKeyboard();
  const client = new ArbiterKeyboardHidClient(device.hid);
  const original = device.sendReport.bind(device);
  device.sendReport = async (reportId: number, buffer: BufferSource) => {
    if (((buffer as Uint8Array)[1]! & 0x3f) === ARBITER_COMMAND.getLightEffect) { device.light = [1, 2]; } // wrong size
    await original(reportId, buffer);
  };
  const status = await client.readStatus();
  assert.equal(status.arbiter?.light, null);
  assert.equal(status.arbiter?.travel?.length, KEYS);
  await client.close();
});

test("a silent keyboard times out and the session is not reused", async () => {
  const device = new FakeArbiterKeyboard(); device.silent = true;
  const client = new ArbiterKeyboardHidClient(device.hid);
  await assert.rejects(client.readLightEffect(), /did not answer/);
  device.silent = false;
  await assert.rejects(client.readLightEffect(), /Reconnect/);
  assert.equal(device.sent.length, 1);
  await client.close();
});

test("damaged and foreign reports never complete a transaction, and profile switches are announced", async () => {
  const device = new FakeArbiterKeyboard();
  const client = new ArbiterKeyboardHidClient(device.hid);
  let announced = 0;
  client.onProfileChanged(() => { announced += 1; });
  const original = device.sendReport.bind(device);
  device.sendReport = async (reportId: number, buffer: BufferSource) => {
    const noise = new Uint8Array(64); noise[0] = 4; noise[1] = 0xc9;
    device.emit(noise);
    const bad = new Uint8Array(64); bad[1] = 2; bad[63] = 1;
    device.emit(bad);
    device.emit(new Uint8Array(64), 1);
    await original(reportId, buffer);
  };
  const status = await client.readStatus();
  assert.equal(status.firmwareVersion, "V0105");
  assert.ok(announced >= 1);
  await client.close();
});

test("decoded replies in the fake match what the codec reads", () => {
  const frame = new Uint8Array(64); frame[1] = 2; frame[3] = 8; frame[11] = 1; frame[63] = arbiterChecksum(frame);
  assert.equal(decodeArbiterReply(frame)?.data.length, 8);
});
