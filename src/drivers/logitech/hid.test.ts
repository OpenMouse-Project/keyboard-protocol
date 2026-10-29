import assert from "node:assert/strict";
import test from "node:test";

import { LogitechKeyboardHidClient } from "./hid.ts";
import { LOGITECH_LONG_REPORT_ID, LOGITECH_SOFTWARE_ID, LOGITECH_VENDOR_ID } from "@openmouse/keyboard-protocol/logitech";

const text = (value: string): number[] => [...Buffer.from(value, "ascii")];

function response(featureIndex: number, functionId: number, params: readonly number[], deviceIndex = 0xff): DataView {
  const data = new Uint8Array(19);
  data[0] = deviceIndex;
  data[1] = featureIndex;
  data[2] = (functionId << 4) | LOGITECH_SOFTWARE_ID;
  data.set(params, 3);
  return new DataView(data.buffer);
}

class FakeLogitechKeyboard {
  vendorId = LOGITECH_VENDOR_ID;
  productId = 0xc352;
  productName = "Logitech PRO X TKL";
  deviceIndex = 0xff;
  modelIds = [0xc352];
  opened = false;
  collections = [{ usagePage: 0xff00, usage: 2, inputReports: [], outputReports: [], featureReports: [], children: [] }];
  pollingCode = 3;
  rapidTrigger = false;
  keyPriority = true;
  brightness = 500;
  controlIds = [0x00e4, 0x00e5];
  controlMap = new Map([[0x00e4, 0x00e4], [0x00e5, 0x00e5]]);
  brightnessMax = 1000;
  supportsLegacyLighting = true;
  supportsPerKeyLighting = true;
  legacyReadback = true;
  legacyReadbackMatches = true;
  legacyParams = new Array(10).fill(0);
  legacyOrdinal = 0;
  writes: { reportId: number; featureIndex: number; functionId: number; params: number[] }[] = [];
  private listeners = new Set<(event: HIDInputReportEvent) => void>();

  async open(): Promise<void> { this.opened = true; }
  async close(): Promise<void> { this.opened = false; }
  addEventListener(_type: "inputreport", listener: (event: HIDInputReportEvent) => void): void { this.listeners.add(listener); }
  removeEventListener(_type: "inputreport", listener: (event: HIDInputReportEvent) => void): void { this.listeners.delete(listener); }

  async sendFeatureReport(): Promise<void> { throw new Error("Logitech test device does not take feature reports."); }
  async receiveFeatureReport(): Promise<DataView> { throw new Error("Logitech test device does not take feature reports."); }

  async sendReport(reportId: number, source: BufferSource): Promise<void> {
    const data = source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    const featureIndex = data[1] ?? 0;
    const functionId = ((data[2] ?? 0) >> 4) & 0x0f;
    const params = [...data.slice(3)];
    this.writes.push({ reportId, featureIndex, functionId, params });
    const reply = this.reply(featureIndex, functionId, params);
    const event = { reportId: LOGITECH_LONG_REPORT_ID, data: reply, device: this } as unknown as HIDInputReportEvent;
    for (const listener of this.listeners) listener(event);
  }

  private reply(featureIndex: number, functionId: number, params: number[]): DataView {
    if (featureIndex === 0 && functionId === 0) {
      const featureId = ((params[0] ?? 0) << 8) | (params[1] ?? 0);
      const index = new Map([[0x0003, 1], [0x1004, 2], [0x8061, 3], [0x8040, 4], [0x1b08, 5], [0x1b04, 7], [0x8071, 8]]).get(featureId)
        ?? (this.supportsPerKeyLighting && featureId === 0x8081 ? 6 : this.supportsLegacyLighting && featureId === 0x8070 ? 9 : 0);
      return response(0x00, 0, [index, 0x00, 0x01], this.deviceIndex);
    }
    if (featureIndex === 1) {
      if (functionId === 0) {
        const models = [...this.modelIds, 0, 0, 0].slice(0, 3).flatMap((id) => [(id >> 8) & 0xff, id & 0xff]).slice(0, 6);
        return response(1, 0, [0x02, 0x01, 0x02, 0x03, 0x04, 0x00, 0x08, ...models, 0x00, 0x01, 0x00], this.deviceIndex);
      }
      if (functionId === 1) {
        return response(1, 1, [0x00, 0x4b, 0x42, 0x44, 0x01, 0x23, 0x04, 0x56, 0x01], this.deviceIndex);
      }
      if (functionId === 2) {
        return response(1, 2, [...text("LT-0001"), 0], this.deviceIndex);
      }
    }
    if (featureIndex === 2) {
      if (functionId === 0) return response(2, 0, [0x0f, 0x03], this.deviceIndex);
      if (functionId === 1) return response(2, 1, [78, 4, 1], this.deviceIndex);
    }
    if (featureIndex === 3) {
      if (functionId === 1) return response(3, 1, [0x00, 0b01001111], this.deviceIndex);
      if (functionId === 2) return response(3, 2, [this.pollingCode], this.deviceIndex);
      if (functionId === 3) {
        this.pollingCode = params[0] ?? 0;
        return response(3, 3, [], this.deviceIndex);
      }
    }
    if (featureIndex === 5) {
      if (functionId === 0) return response(5, 0, [1, 2, 3], this.deviceIndex);
      if (functionId === 1) return response(5, 1, [this.rapidTrigger ? 1 : 0], this.deviceIndex);
      if (functionId === 2) {
        this.rapidTrigger = (params[0] ?? 0) !== 0;
        return response(5, 2, [], this.deviceIndex);
      }
      if (functionId === 4) return response(5, 4, [this.keyPriority ? 1 : 0], this.deviceIndex);
      if (functionId === 5) {
        this.keyPriority = (params[0] ?? 0) !== 0;
        return response(5, 5, [], this.deviceIndex);
      }
    }
    if (featureIndex === 8) {
      if (functionId === 0) {
        if ((params[0] ?? 0) === 0xff) return response(8, 0, [0, 0, 1], this.deviceIndex);
        if ((params[1] ?? 0) === 0xff) return response(8, 0, [0, 0, 0, 5, 2, 0, 0, 0], this.deviceIndex);
        const effect = params[1] ?? 0;
        return response(8, 0, [0, effect, 0, effect === 1 ? 1 : 0, 0, 0, 0x13, 0x88], this.deviceIndex);
      }
      if (functionId === 5) return response(8, 5, [1, 1, 0], this.deviceIndex);
      if (functionId === 1) return response(8, 1, [...params], this.deviceIndex);
    }
    if (featureIndex === 9) {
      if (functionId === 0) return response(9, 0, [2, 0, 0, 0, this.legacyReadback ? 1 : 0], this.deviceIndex);
      if (functionId === 1) return response(9, 1, [params[0] ?? 0, 0, (params[0] ?? 0) + 1, 3, 0], this.deviceIndex);
      if (functionId === 2) {
        const zone = params[0] ?? 0;
        const ordinal = params[1] ?? 0;
        return response(9, 2, [zone, ordinal, 0, zone === 1 && ordinal === 2 ? 1 : 3, 0, 0, 0, 0], this.deviceIndex);
      }
      if (functionId === 3) {
        this.legacyOrdinal = params[1] ?? 0;
        this.legacyParams = params.slice(2, 12);
        return response(9, 3, [], this.deviceIndex);
      }
      if (functionId === 14) {
        return response(9, 14, [params[0] ?? 0, this.legacyOrdinal, ...(this.legacyReadbackMatches ? this.legacyParams : new Array(10).fill(0))], this.deviceIndex);
      }
    }
    if (featureIndex === 7) {
      if (functionId === 0) return response(7, 0, [this.controlIds.length], this.deviceIndex);
      if (functionId === 1) {
        const position = params[0] ?? 0;
        const id = this.controlIds[position] ?? 0;
        return response(7, 1, [(id >> 8) & 0xff, id & 0xff, 0, 0, 0x10, 0, 4, 0x08], this.deviceIndex);
      }
      if (functionId === 2) {
        const id = ((params[0] ?? 0) << 8) | (params[1] ?? 0);
        const target = this.controlMap.get(id) ?? id;
        return response(7, 2, [(id >> 8) & 0xff, id & 0xff, 0, (target >> 8) & 0xff, target & 0xff, 0], this.deviceIndex);
      }
      if (functionId === 3) {
        const id = ((params[0] ?? 0) << 8) | (params[1] ?? 0);
        const target = ((params[3] ?? 0) << 8) | (params[4] ?? 0);
        this.controlMap.set(id, target);
        return response(7, 3, [], this.deviceIndex);
      }
    }
    if (featureIndex === 6) {
      if (functionId === 0) {
        const page = params[1] ?? 0;
        return response(6, 0, [0, 0, page === 0 ? 0b00001110 : 0, ...new Array(11).fill(0)], this.deviceIndex);
      }
      if (functionId === 6) return response(6, 6, [...params], this.deviceIndex);
      if (functionId === 7) return response(6, 7, [], this.deviceIndex);
    }
    if (featureIndex === 4) {
      if (functionId === 0) return response(4, 0, [(this.brightnessMax >> 8) & 0xff, this.brightnessMax & 0xff, 0x64, 0x04, 0x00, 0x00, 0x00], this.deviceIndex);
      if (functionId === 1) return response(4, 1, [(this.brightness >> 8) & 0xff, this.brightness & 0xff], this.deviceIndex);
      if (functionId === 2) {
        this.brightness = ((params[0] ?? 0) << 8) | (params[1] ?? 0);
        return response(4, 2, [], this.deviceIndex);
      }
    }
    return response(0xff, 8, [0x07], this.deviceIndex);
  }
}

test("the Logitech client reads identity, battery, report rate and brightness over HID++", async () => {
  const device = new FakeLogitechKeyboard();
  const client = new LogitechKeyboardHidClient(device as unknown as HIDDevice);
  const status = await client.readStatus();
  assert.equal(status.brand, "Logitech");
  assert.equal(status.name, "PRO X TKL");
  assert.equal(status.firmwareVersion, "1.23");
  assert.equal(status.serial, "LT-0001");
  assert.equal(status.logitech?.unitId, "01020304");
  assert.equal(status.logitech?.battery?.percent, 78);
  assert.equal(status.logitech?.pollingRateHz, 1000);
  assert.deepEqual(status.logitech?.supportedPollingRates, [125, 250, 500, 1000, 8000]);
  assert.equal(status.logitech?.brightness?.value, 500);
  assert.deepEqual(status.logitech?.analog?.capabilities?.slice(0, 3), Uint8Array.from([1, 2, 3]));
  assert.equal(status.logitech?.analog?.rapidTrigger, false);
  assert.equal(status.logitech?.analog?.keyPriority, true);
  assert.deepEqual(status.logitech?.lighting?.zones, [1, 2, 3]);
  assert.equal(status.logitech?.controls, null);
  assert.equal(status.logitech?.lighting?.rgbZones.length, 1);
  assert.equal(status.logitech?.lighting?.rgbZones[0]?.effects.length, 2);
  assert.equal((await client.readControls())?.length, 2);
  assert.equal(status.logitech?.brightness?.max, 1000);
  await client.close();
});

test("setPollingRate writes the discriminant and verifies the read-back", async () => {
  const device = new FakeLogitechKeyboard();
  const client = new LogitechKeyboardHidClient(device as unknown as HIDDevice);
  assert.equal(await client.setPollingRate(500), 500);
  const write = device.writes.find((entry) => entry.featureIndex === 3 && entry.functionId === 3);
  assert.deepEqual(write?.params.slice(0, 1), [2]);
  await client.close();
});

test("setBrightness writes big-endian and verifies the read-back", async () => {
  const device = new FakeLogitechKeyboard();
  const client = new LogitechKeyboardHidClient(device as unknown as HIDDevice);
  assert.equal(await client.setBrightness(750), 750);
  const write = device.writes.find((entry) => entry.featureIndex === 4 && entry.functionId === 2);
  assert.deepEqual(write?.params.slice(0, 2), [0x02, 0xee]);
  await client.close();
});

test("1B04 remaps a control only when the device allows the target", async () => {
  const device = new FakeLogitechKeyboard();
  const client = new LogitechKeyboardHidClient(device as unknown as HIDDevice);
  const controls = await client.remapControl(0x00e4, 0x00e5);
  assert.equal(controls.find((control) => control.controlId === 0x00e4)?.mappedTo, 0x00e5);
  await assert.rejects(client.remapControl(0x00e4, 0x00ff), /cannot be remapped/);
  await client.close();
});

test("0x8071 applies a static effect to every cluster that advertises it", async () => {
  const device = new FakeLogitechKeyboard();
  const client = new LogitechKeyboardHidClient(device as unknown as HIDDevice);
  await client.setRgbEffect("Static", { red: 1, green: 2, blue: 3 }, 1000);
  const write = device.writes.find((entry) => entry.featureIndex === 8 && entry.functionId === 1);
  assert.deepEqual(write?.params.slice(0, 6), [0, 1, 1, 2, 3, 2]);
  await client.close();
});

test("0x8070 discovers zone-local fixed-colour ordinal, writes volatile long frame and reads RAM back", async () => {
  const device = new FakeLogitechKeyboard();
  const client = new LogitechKeyboardHidClient(device as unknown as HIDDevice);
  const zones = await client.readLegacyZones();
  assert.equal(zones?.canReadEffect, true);
  assert.equal(zones?.zones[1]?.location, 2);
  assert.deepEqual(zones?.zones[1]?.effects.map((effect) => effect.id), [3, 3, 1]);
  assert.ok(device.writes.some((entry) => entry.featureIndex === 0 && entry.functionId === 0
    && entry.params[0] === 0x80 && entry.params[1] === 0x70));
  await client.setLegacyZoneColor(1, 0x12, 0x34, 0x56);
  const write = device.writes.find((entry) => entry.featureIndex === 9 && entry.functionId === 3);
  assert.equal(write?.reportId, LOGITECH_LONG_REPORT_ID);
  assert.deepEqual(write?.params, [1, 2, 0x12, 0x34, 0x56, ...new Array(11).fill(0)]);
  assert.ok(device.writes.some((entry) => entry.featureIndex === 9 && entry.functionId === 14 && entry.params[0] === 1 && entry.params[1] === 0));
  assert.deepEqual((await client.readStatus()).logitech?.lighting?.legacyZones.map((zone) => zone.index), [0, 1]);
  await client.close();
});

test("0x8070 legacy lighting is visible in status without a 0x8081 per-key feature", async () => {
  const device = new FakeLogitechKeyboard();
  device.supportsPerKeyLighting = false;
  const client = new LogitechKeyboardHidClient(device as unknown as HIDDevice);
  const lighting = (await client.readStatus()).logitech?.lighting;
  assert.deepEqual(lighting?.zones, []);
  assert.deepEqual(lighting?.legacyZones.map((zone) => zone.location), [1, 2]);
  assert.equal(lighting?.legacyEffectReadback, true);
  await client.close();
});

test("0x8070 refuses absent feature, absent read-back and unadvertised effects without writing", async () => {
  const device = new FakeLogitechKeyboard();
  const client = new LogitechKeyboardHidClient(device as unknown as HIDDevice);
  device.supportsLegacyLighting = false;
  await assert.rejects(client.setLegacyZoneColor(1, 1, 2, 3), /does not expose 0x8070/);
  await client.close();
  const unreadable = new FakeLogitechKeyboard();
  unreadable.legacyReadback = false;
  const unreadableClient = new LogitechKeyboardHidClient(unreadable as unknown as HIDDevice);
  await assert.rejects(unreadableClient.setLegacyZoneColor(1, 1, 2, 3), /does not advertise 0x8070 effect read-back/);
  await assert.rejects(unreadableClient.setLegacyZoneColor(0, 1, 2, 3), /does not advertise 0x8070 effect read-back/);
  assert.equal(unreadable.writes.filter((entry) => entry.featureIndex === 9 && entry.functionId === 3).length, 0);
  await unreadableClient.close();
  const noFixedColor = new FakeLogitechKeyboard();
  const noFixedClient = new LogitechKeyboardHidClient(noFixedColor as unknown as HIDDevice);
  await assert.rejects(noFixedClient.setLegacyZoneColor(0, 1, 2, 3), /does not advertise a fixed-colour effect/);
  await assert.rejects(noFixedClient.setLegacyZoneColor(2, 1, 2, 3), /does not advertise LED zone 2/);
  assert.equal(noFixedColor.writes.filter((entry) => entry.featureIndex === 9 && entry.functionId === 3).length, 0);
  await noFixedClient.close();
});

test("0x8070 reports a mismatched RAM read-back instead of claiming success", async () => {
  const device = new FakeLogitechKeyboard();
  device.legacyReadbackMatches = false;
  const client = new LogitechKeyboardHidClient(device as unknown as HIDDevice);
  await assert.rejects(client.setLegacyZoneColor(1, 1, 2, 3), /did not confirm the 0x8070 RAM effect/);
  await client.close();
});

test("0x8070 applies a discovered non-fixed effect with ten opaque bytes and verifies every byte", async () => {
  const device = new FakeLogitechKeyboard();
  const client = new LogitechKeyboardHidClient(device as unknown as HIDDevice);
  const params = [0x12, 0x34, 0x13, 0x88, 1, 2, 3, 4, 5, 6];
  await client.setLegacyZoneEffect(1, 3, params);
  const write = device.writes.find((entry) => entry.featureIndex === 9 && entry.functionId === 3);
  assert.deepEqual(write?.params, [1, 0, ...params, 0, 0, 0, 0]);
  assert.equal(write?.reportId, LOGITECH_LONG_REPORT_ID);
  const active = await client.readLegacyZoneEffect(1);
  assert.equal(active.effectId, 3);
  assert.equal(active.effectOrdinal, 0);
  assert.deepEqual([...active.params], params);
  await assert.rejects(client.setLegacyZoneEffect(1, 3, [1, 2]), /exactly ten/);
  await assert.rejects(client.setLegacyZoneEffect(1, 3, [...params.slice(0, 9), 256]), /8-bit/);
  await client.close();
});

test("0x8081 paints a solid colour and commits the frame", async () => {
  const device = new FakeLogitechKeyboard();
  const client = new LogitechKeyboardHidClient(device as unknown as HIDDevice);
  const lighting = await client.setSolidColor(255, 0, 0);
  assert.deepEqual(lighting.zones, [1, 2, 3]);
  const paint = device.writes.find((entry) => entry.featureIndex === 6 && entry.functionId === 6);
  assert.deepEqual(paint?.params.slice(0, 6), [255, 0, 0, 1, 2, 3]);
  assert.ok(device.writes.some((entry) => entry.featureIndex === 6 && entry.functionId === 7));
  await client.close();
});

test("1B08 rapid trigger and key priority are written and read back", async () => {
  const device = new FakeLogitechKeyboard();
  const client = new LogitechKeyboardHidClient(device as unknown as HIDDevice);
  assert.equal(await client.setAnalogRapidTrigger(true), true);
  assert.equal(await client.setAnalogKeyPriority(false), false);
  assert.equal(device.rapidTrigger, true);
  assert.equal(device.keyPriority, false);
  await client.close();
});

test("a receiver is probed for a paired keyboard and reports its model", async () => {
  const device = new FakeLogitechKeyboard();
  device.productId = 0xc547;
  device.productName = "LIGHTSPEED receiver";
  device.deviceIndex = 1;
  const client = new LogitechKeyboardHidClient(device as unknown as HIDDevice);
  const status = await client.readStatus();
  assert.equal(status.name, "PRO X TKL");
  assert.equal(status.logitech?.productId, 0xc352);
  assert.equal(status.logitech?.receiverProductId, 0xc547);
  assert.equal(status.connectionType, "Wireless");
  await client.close();
});

test("a Logitech mouse product id is rejected", () => {
  const device = { ...new FakeLogitechKeyboard(), productId: 0xc094 };
  assert.equal(LogitechKeyboardHidClient.isSupported(device as unknown as HIDDevice), false);
});
