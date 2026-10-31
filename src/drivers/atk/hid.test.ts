import assert from "node:assert/strict";
import test from "node:test";
import { ATK_CUSTOM_ID, ATK_FRAME_LENGTH, ATK_LIGHT_ZONE, ATK_SLEEP_NEVER, ATK_VENDOR_ID } from "../../atk/index.ts";
import { AtkKeyboardHidClient } from "./hid.ts";
import { clientSupportScore, createSupportedClient, deviceBrand } from "../registry.ts";
import { ATK_HID_FILTERS, SUPPORTED_HID_FILTERS } from "../vendors.ts";

class FakeAtkKeyboard {
  vendorId = ATK_VENDOR_ID;
  productId = 0x10b0;
  productName = "EDGE 60HE ULTIMATE";
  opened = false;
  collections = [{ usagePage: 0xff60, usage: 0x61, inputReports: [], outputReports: [], featureReports: [], children: [] }];
  state = new Map<string, number[]>();
  sent: Uint8Array[] = [];
  silent = new Set<number>();
  ignoreWrites = new Set<number>();
  firmware = [2, 0x10];
  listeners = new Set<(event: HIDInputReportEvent) => void>();
  get hid(): HIDDevice { return this as unknown as HIDDevice; }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  addEventListener(_type: string, listener: (event: HIDInputReportEvent) => void) { this.listeners.add(listener); }
  removeEventListener(_type: string, listener: (event: HIDInputReportEvent) => void) { this.listeners.delete(listener); }

  private key(channel: number, bytes: number[]): string {
    return channel === 0x03 || channel === 0x07 ? `${channel}:${bytes[0]},${bytes[1]}` : `${channel}`;
  }

  private emit(frame: Uint8Array) {
    const event = { device: this.hid, reportId: 0, data: new DataView(frame.buffer) } as HIDInputReportEvent;
    this.listeners.forEach((listener) => listener(event));
  }

  async sendReport(reportId: number, buffer: BufferSource) {
    assert.equal(reportId, 0);
    const request = Uint8Array.from(buffer as Uint8Array);
    assert.equal(request.length, ATK_FRAME_LENGTH);
    this.sent.push(request);
    const channel = request[2]!;
    if (this.silent.has(request[0]! * 256 + (request[1] === ATK_CUSTOM_ID ? channel : 0))) return;
    const reply = new Uint8Array(ATK_FRAME_LENGTH);
    reply[0] = request[0]!;
    if (request[0] === 0x01) {
      reply[2] = 9;
    } else if (request[0] === 0x08) {
      reply[1] = 0x41;
      reply.set(this.state.get("light") ?? [], 2);
    } else if (request[0] === 0x07) {
      this.state.set("light", Array.from(request.subarray(2, 10)));
      queueMicrotask(() => this.emit(Uint8Array.from(request)));
      return;
    } else if (request[0] === 0x02 && request[1] === ATK_CUSTOM_ID && channel === 0) {
      reply[1] = ATK_CUSTOM_ID;
      reply[5] = this.firmware[0]!;
      reply[6] = this.firmware[1]!;
    } else if (request[1] === ATK_CUSTOM_ID) {
      reply[1] = ATK_CUSTOM_ID;
      reply[2] = channel;
      if (request[0] === 0x03) {
        if (!this.ignoreWrites.has(channel)) this.state.set(this.key(channel, Array.from(request.subarray(3))), Array.from(request.subarray(3, 20)));
        queueMicrotask(() => this.emit(Uint8Array.from(request)));
        return;
      }
      const stored = this.state.get(this.key(channel, Array.from(request.subarray(3)))) ?? [];
      reply.set(channel === 0x03 || channel === 0x07 ? stored : stored, 3);
    }
    queueMicrotask(() => this.emit(reply));
  }
}

function setup(): { fake: FakeAtkKeyboard; client: AtkKeyboardHidClient } {
  const fake = new FakeAtkKeyboard();
  return { fake, client: new AtkKeyboardHidClient(fake.hid) };
}

test("only catalogued ATK keyboards on the raw-HID collection are claimed", () => {
  assert.equal(AtkKeyboardHidClient.isSupported(setup().fake.hid), true);

  const otherVendor = new FakeAtkKeyboard();
  otherVendor.vendorId = 0x7470;
  assert.equal(AtkKeyboardHidClient.isSupported(otherVendor.hid), false);

  const uncatalogued = new FakeAtkKeyboard();
  uncatalogued.productId = 0x9999;
  assert.equal(AtkKeyboardHidClient.isSupported(uncatalogued.hid), false);

  const hex80 = new FakeAtkKeyboard();
  hex80.productId = 0x1176;
  assert.equal(AtkKeyboardHidClient.isSupported(hex80.hid), false);

  const noCollection = new FakeAtkKeyboard();
  noCollection.collections = [];
  assert.equal(AtkKeyboardHidClient.isSupported(noCollection.hid), false);
});

test("the registry hands an ATK keyboard to the ATK driver ahead of generic VIA", () => {
  const { fake } = setup();
  const client = createSupportedClient(fake.hid);
  assert.ok(client instanceof AtkKeyboardHidClient);
  assert.equal(deviceBrand(client), "ATK");
  assert.equal(clientSupportScore(fake.hid), 6);
});

test("the picker filters name every catalogued ATK product", () => {
  assert.ok(ATK_HID_FILTERS.length > 100);
  assert.ok(ATK_HID_FILTERS.every((filter) => filter.vendorId === ATK_VENDOR_ID && filter.usagePage === 0xff60 && filter.usage === 0x61));
  assert.ok(ATK_HID_FILTERS.every((filter) => SUPPORTED_HID_FILTERS.includes(filter)));
  assert.equal(ATK_HID_FILTERS.some((filter) => filter.productId === 0x1176), false);
});

test("readStatus reads identity and settings from the custom channels", async () => {
  const { fake, client } = setup();
  fake.state.set("36", [0x0d, 0x48, 0x00, 0x64, 0x00, 0x14, 0x0d, 0x48, 0x00, 0x01, 0x00, 0x01]);
  fake.state.set("11", [0x01, 0x5e, 0x00, 0xc8]);
  fake.state.set("17", [1, 0, 1, 0, 2, 3]);
  fake.state.set("30", [1]);
  fake.state.set("38", [5]);
  fake.state.set("70", [2]);
  fake.state.set("light", [6, 0, 3, 10, 20, 30, 200, 1]);
  const status = await client.readStatus();
  assert.equal(status.brand, "ATK");
  assert.equal(status.name, "EDGE 60HE ULTIMATE");
  assert.equal(status.connectionType, "Wired");
  assert.equal(status.firmwareVersion, "2.10");
  assert.equal(status.layout, "5x14 matrix");
  assert.equal(status.atk?.protocolVersion, 9);
  assert.equal(status.atk?.reportRate, 2000);
  assert.equal(status.atk?.gameMode, true);
  assert.equal(status.atk?.sleepSeconds, 300);
  assert.deepEqual(status.atk?.deadZone, { top: 0.35, bottom: 0.2 });
  assert.equal(status.atk?.feature?.nkro, 2);
  assert.deepEqual(status.atk?.travelLimits, { travelMax: 3.4, travelMin: 0.1, travelStep: 0.02, rtMax: 3.4, rtMin: 0.001, rtStep: 0.001 });
  assert.deepEqual(status.atk?.light, { effect: 6, speed: 3, color: [10, 20, 30], brightness: 200, colorful: true });
});

test("a 2.4G variant is reported as wireless", async () => {
  const { fake, client } = setup();
  fake.productId = 0x1242;
  fake.productName = "ATK A87 Ultra 2.4G";
  const status = await client.readStatus();
  assert.equal(status.connectionType, "Wireless");
  assert.equal(status.connectionDetail, "2.4 GHz receiver");
});

test("setReportRate writes the restart flag then the rate, and confirms by reading back", async () => {
  const { fake, client } = setup();
  assert.equal(await client.setReportRate(4000), 4000);
  const writes = fake.sent.filter((frame) => frame[0] === 0x03).map((frame) => [frame[2], frame[3]]);
  assert.deepEqual(writes, [[0x4e, 1], [0x46, 1]]);
});

test("setReportRate fails when the keyboard keeps a different rate", async () => {
  const { fake, client } = setup();
  fake.ignoreWrites.add(0x46);
  fake.state.set("70", [3]);
  await assert.rejects(client.setReportRate(8000), /kept 1000 instead of 8000/);
});

test("setSleep, dead zone, flags and feature writes round-trip through read-back", async () => {
  const { client } = setup();
  assert.equal(await client.setSleep(300), 300);
  assert.equal(await client.setSleep(ATK_SLEEP_NEVER), ATK_SLEEP_NEVER);
  assert.deepEqual(await client.setDeadZone({ top: 0.35, bottom: 0.2 }), { top: 0.35, bottom: 0.2 });
  assert.equal(await client.setFlag("gameMode", true), true);
  const feature = await client.setFeature({ winLock: 1, nkro: 2 });
  assert.equal(feature.winLock, 1);
  assert.equal(feature.nkro, 2);
});

test("setFlag fails when the keyboard refuses the change", async () => {
  const { fake, client } = setup();
  fake.ignoreWrites.add(0x1e);
  await assert.rejects(client.setFlag("gameMode", true), /kept gameMode off/);
});

test("per-key travel and rapid trigger are bounds-checked against the matrix and read back per key", async () => {
  const { client } = setup();
  assert.equal(await client.setKeyTravel(2, 5, 1.25), 1.25);
  assert.deepEqual(await client.setKeyRapidTrigger(2, 5, { enabled: true, press: 0.3, release: 0.2 }), { enabled: true, press: 0.3, release: 0.2 });
  assert.throws(() => client.readKeyTravel(5, 0), /outside this keyboard's 5 rows/);
  assert.throws(() => client.setKeyTravel(0, 14, 1), /outside this keyboard's 14 columns/);
  assert.throws(() => client.readKeyTravel(-1, 0), RangeError);
});

test("zone lights use the decoration channel on v2 firmware and the logo channel on older firmware", async () => {
  const light = { effect: 3, colorful: true, brightness: 9, speed: 8, color: [7, 8, 9] as const };
  const v2 = setup();
  await v2.client.setZoneLight(ATK_LIGHT_ZONE.button, light);
  assert.equal(v2.fake.sent.find((frame) => frame[0] === 0x03)![2], 0x53);

  const old = setup();
  old.fake.firmware = [1, 0x09];
  await old.client.setZoneLight(ATK_LIGHT_ZONE.logo, light);
  assert.equal(old.fake.sent.find((frame) => frame[0] === 0x03)![2], 0x21);
});

test("an unanswered command fails after three tries and later commands still work", async () => {
  const { fake, client } = setup();
  fake.silent.add(0x02 * 256 + 0x0b);
  await assert.rejects(client.setDeadZone({ top: 0.1, bottom: 0.1 }), /did not answer command 0x3 after 3 tries|did not answer command 0x2 after 3 tries/);
  fake.silent.clear();
  assert.equal(await client.setFlag("aiMatch", true), true);
});

test("the keymap is read in 28-byte chunks and decoded", async () => {
  const { fake, client } = setup();
  const original = fake.sendReport.bind(fake);
  fake.sendReport = async (reportId: number, buffer: BufferSource) => {
    const request = buffer as Uint8Array;
    if (request[0] !== 0x12) return original(reportId, buffer);
    fake.sent.push(Uint8Array.from(request));
    const offset = (request[1]! << 8) | request[2]!;
    const reply = new Uint8Array(ATK_FRAME_LENGTH);
    reply[0] = 0x12;
    for (let i = 0; i < request[3]!; i++) reply[4 + i] = (offset + i) % 2 === 0 ? 0 : 0x04 + Math.floor((offset + i) / 2);
    queueMicrotask(() => fake["emit"](reply));
  };
  const map = await client.readKeymap();
  assert.equal(map.length, 70);
  assert.equal(map[0], 0x04);
  assert.equal(map[69], 0x04 + 69);
  assert.equal(fake.sent.filter((frame) => frame[0] === 0x12).length, 5);
});

test("closing the client ends the session", async () => {
  const { fake, client } = setup();
  await client.open();
  await client.close();
  assert.equal(fake.opened, false);
  await assert.rejects(client.open(), /session was closed/);
});
