import assert from "node:assert/strict";
import test from "node:test";
import { KOCHI_COMMAND, kochiChecksum } from "../../kochi/index.ts";
import { KochiHidClient } from "./hid.ts";
import { createSupportedClient, deviceBrand } from "../registry.ts";
import { KOCHI_HID_FILTERS } from "../vendors.ts";

class FakeDevice {
  vendorId = 0x1ca2;
  productId = 0x0901;
  productName = "KOCHI68 Keyboard";
  opened = false;
  collections = [{ usagePage: 0xffa0, usage: 1, inputReports: [], outputReports: [], featureReports: [], children: [] }];
  mode: "win" | "mac" = "mac";
  sent: number[] = [];
  silent = false;
  refused = false;
  applyWrite = true;
  inconsistent = false;
  sendError = false;
  wrongName = false;
  listeners = new Set<(event: HIDInputReportEvent) => void>();
  get hid(): HIDDevice { return this as unknown as HIDDevice; }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  addEventListener(_type: string, listener: (event: HIDInputReportEvent) => void) { this.listeners.add(listener); }
  removeEventListener(_type: string, listener: (event: HIDInputReportEvent) => void) { this.listeners.delete(listener); }
  emit(frame: Uint8Array, reportId = 0, offset = false) {
    const wrapped = offset ? new Uint8Array(frame.length + 8) : frame;
    if (offset) wrapped.set(frame, 4);
    const event = { device: this.hid, reportId, data: new DataView(wrapped.buffer, offset ? 4 : 0, frame.length) } as HIDInputReportEvent;
    this.listeners.forEach(listener => listener(event));
  }
  async sendReport(reportId: number, buffer: BufferSource) {
    assert.equal(reportId, 0);
    const request = buffer as Uint8Array;
    assert.equal(request.length, 64);
    const command = request[4]!;
    this.sent.push(command);
    if (this.sendError) throw new Error("USB send failed");
    if (this.silent) return;
    let value = 0;
    if (command === KOCHI_COMMAND.setWin || command === KOCHI_COMMAND.setMac) {
      value = this.refused ? 0 : 1;
      if (!this.refused && this.applyWrite) this.mode = command === KOCHI_COMMAND.setWin ? "win" : "mac";
    } else {
      value = Number(this.mode === (command === KOCHI_COMMAND.queryWin ? "win" : "mac"));
      if (this.inconsistent) value = 1;
    }
    const reply = new Uint8Array(64);
    reply.set([0x5c, 4, 0x80, 0, 0, command, value, 0xff]);
    if (command === KOCHI_COMMAND.name) {
      reply[1] = 34;
      reply.fill(0, 6);
      reply.set(new TextEncoder().encode(this.wrongName ? "OTHER" : "KOCHI68"), 6);
    }
    reply[3] = kochiChecksum(reply);
    // A wrong report and a damaged checksum cannot finish the transaction.
    this.emit(reply, 1);
    const bad = reply.slice(); bad[3] ^= 1; this.emit(bad);
    this.emit(reply, 0, true);
  }
}

test("registry/filter claim only the hardware-identified HB68 command collection", () => {
  const device = new FakeDevice();
  assert.ok(createSupportedClient(device.hid) instanceof KochiHidClient);
  assert.equal(deviceBrand(new KochiHidClient(device.hid)), "Kochi");
  assert.deepEqual(KOCHI_HID_FILTERS, [{ vendorId: 0x1ca2, productId: 0x0901, usagePage: 0xffa0, usage: 1 }]);
  device.collections[0]!.usage = 2; assert.equal(KochiHidClient.isSupported(device.hid), false);
  device.collections[0]!.usage = 1; device.collections[0]!.usagePage = 1; assert.equal(KochiHidClient.isSupported(device.hid), false);
  device.collections[0]!.usagePage = 0xffa0; device.productId++; assert.equal(KochiHidClient.isSupported(device.hid), false);
  device.productId--; device.vendorId++; assert.equal(KochiHidClient.isSupported(device.hid), false);
});

test("identity and mode are read without firmware, serial, or calibration commands", async () => {
  const device = new FakeDevice(); const client = new KochiHidClient(device.hid);
  const status = await client.readStatus();
  assert.equal(status.name, "Hummingbird 68");
  assert.deepEqual(status.kochi, { systemMode: "mac" });
  assert.equal(status.serial, null);
  assert.deepEqual(device.sent, [38, 33, 34]);
  await client.close(); assert.equal(device.listeners.size, 0);
});

test("concurrent mode changes are serialized with both read-back queries", async () => {
  const device = new FakeDevice(); const client = new KochiHidClient(device.hid);
  assert.deepEqual(await Promise.all([client.setSystemMode("win"), client.setSystemMode("mac")]), ["win", "mac"]);
  assert.deepEqual(device.sent, [48, 33, 34, 49, 33, 34]);
  assert.throws(() => client.setSystemMode("linux" as never), /Windows or Mac/);
  await client.close();
});

test("refused writes, unmodified state, contradictions and wrong identity fail clearly", async () => {
  for (const flag of ["refused", "applyWrite", "inconsistent"] as const) {
    const device = new FakeDevice(); device[flag] = flag !== "applyWrite";
    const client = new KochiHidClient(device.hid);
    await assert.rejects(client.setSystemMode("win"), /acknowledge|read-back|consistent/);
    await client.close();
  }
  const device = new FakeDevice(); device.wrongName = true;
  const client = new KochiHidClient(device.hid);
  await assert.rejects(client.readStatus(), /identify/); await client.close();
});

test("timeout and USB failure require a reconnect and never confirm a later operation", async () => {
  for (const flag of ["silent", "sendError"] as const) {
    const device = new FakeDevice(); device[flag] = true;
    const client = new KochiHidClient(device.hid);
    await assert.rejects(client.readSystemMode(), /answer|USB send/);
    device[flag] = false;
    await assert.rejects(client.setSystemMode("win"), /Reconnect/);
    assert.deepEqual(device.sent, [33]);
    await client.close();
  }
});

test("disconnect rejects pending reads and removes its input listener", async () => {
  const device = new FakeDevice(); device.silent = true;
  const client = new KochiHidClient(device.hid);
  await client.open();
  const read = client.readSystemMode();
  // Allow the queued exchange to install the listener before closing.
  for (let n = 0; n < 5; n++) await Promise.resolve();
  await client.close();
  await assert.rejects(read, /disconnected/);
  assert.equal(device.listeners.size, 0);
});
