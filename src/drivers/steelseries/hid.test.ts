import assert from "node:assert/strict";
import test from "node:test";

import { SteelSeriesKeyboardHidClient } from "./hid.ts";
import {
  STEELSERIES_APEX_PRO_2023_SLOTS,
  STEELSERIES_FEATURE_DATA_LENGTH,
  STEELSERIES_PROFILE_CHECKSUM_OFFSET,
  STEELSERIES_PROFILE_LENGTH,
  STEELSERIES_PROFILE_OFFSET,
  STEELSERIES_VENDOR_ID,
  steelseriesCrc32,
} from "@openmouse/keyboard-protocol/steelseries";

function sealedProfile(): Uint8Array<ArrayBuffer> {
  const blob = new Uint8Array(STEELSERIES_PROFILE_LENGTH);
  blob[STEELSERIES_PROFILE_OFFSET.deviceSchema] = 8;
  blob[STEELSERIES_PROFILE_OFFSET.actuation + 16] = 0x39;
  blob[STEELSERIES_PROFILE_OFFSET.reset + 16] = 0x34;
  blob[STEELSERIES_PROFILE_OFFSET.releaseMode + 16] = 0x02;
  blob[STEELSERIES_PROFILE_OFFSET.rapidTriggerSensitivity + 16] = 0x02;
  blob[STEELSERIES_PROFILE_OFFSET.secondActuation + 16] = 0x15;
  blob[STEELSERIES_PROFILE_OFFSET.secondReset + 16] = 0x12;
  blob.set([4, 7, 1, 0, 0], STEELSERIES_PROFILE_OFFSET.rapidTapPairs);
  blob[STEELSERIES_PROFILE_OFFSET.oled] = 0x11;
  blob[STEELSERIES_PROFILE_OFFSET.rapidTapEnabled] = 0x00;
  const crc = steelseriesCrc32(blob.slice(0, STEELSERIES_PROFILE_CHECKSUM_OFFSET));
  blob[STEELSERIES_PROFILE_CHECKSUM_OFFSET] = crc & 0xff;
  blob[STEELSERIES_PROFILE_CHECKSUM_OFFSET + 1] = (crc >>> 8) & 0xff;
  blob[STEELSERIES_PROFILE_CHECKSUM_OFFSET + 2] = (crc >>> 16) & 0xff;
  blob[STEELSERIES_PROFILE_CHECKSUM_OFFSET + 3] = (crc >>> 24) & 0xff;
  return blob;
}

class FakeSteelSeriesKeyboard {
  vendorId = STEELSERIES_VENDOR_ID;
  productId = 0x1628;
  productName = "SteelSeries Apex Pro TKL";
  opened = false;
  collections = [{ usagePage: 0xffc0, usage: 1, inputReports: [], outputReports: [], featureReports: [], children: [] }];
  frames: { kind: "feature" | "output"; data: number[] }[] = [];
  private profile = sealedProfile();
  private listeners = new Set<(event: HIDInputReportEvent) => void>();
  private lastOffset = 0;

  async open(): Promise<void> { this.opened = true; }
  async close(): Promise<void> { this.opened = false; }
  addEventListener(_type: "inputreport", listener: (event: HIDInputReportEvent) => void): void { this.listeners.add(listener); }
  removeEventListener(_type: "inputreport", listener: (event: HIDInputReportEvent) => void): void { this.listeners.delete(listener); }

  async sendFeatureReport(_reportId: number, source: BufferSource): Promise<void> {
    const data = source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    this.frames.push({ kind: "feature", data: [...data] });
    if (data[0] === 0x83 && data[1] === 0x01) {
      this.lastOffset = (data[5] ?? 0) | ((data[6] ?? 0) << 8) | ((data[7] ?? 0) << 16) | ((data[8] ?? 0) << 24);
    }
    if (data[0] === 0x03 && data[1] === 0x01) {
      const offset = (data[5] ?? 0) | ((data[6] ?? 0) << 8) | ((data[7] ?? 0) << 16) | ((data[8] ?? 0) << 24);
      const size = (data[3] ?? 0) | ((data[4] ?? 0) << 8);
      this.profile.set(data.slice(9, 9 + size), offset);
    }
  }

  async receiveFeatureReport(): Promise<DataView> {
    const reply = new Uint8Array(STEELSERIES_FEATURE_DATA_LENGTH);
    reply.set([0x00, 0x83, 0x01], 0);
    reply.set(this.profile.slice(this.lastOffset, this.lastOffset + 500), 3);
    return new DataView(reply.buffer);
  }

  async sendReport(_reportId: number, source: BufferSource): Promise<void> {
    const data = source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    this.frames.push({ kind: "output", data: [...data] });
    if (data[0] !== 0x90) return;
    const reply = new Uint8Array(64);
    reply.set([0x90, 0x00, ...Buffer.from("1.19.7", "ascii")]);
    const event = { reportId: 0, data: new DataView(reply.buffer), device: this } as unknown as HIDInputReportEvent;
    for (const listener of this.listeners) listener(event);
  }
}

test("the SteelSeries client reads firmware and the persisted analog profile", async () => {
  const device = new FakeSteelSeriesKeyboard();
  const client = new SteelSeriesKeyboardHidClient(device as unknown as HIDDevice);
  const status = await client.readStatus();
  assert.equal(status.brand, "SteelSeries");
  assert.equal(status.name, "Apex Pro TKL (2023)");
  assert.equal(status.firmwareVersion, "1.19.7");
  assert.equal(status.steelseries?.profile?.keys.length, 68);
  assert.equal(status.steelseries?.profile?.checksumValid, true);
  const key = status.steelseries?.profile?.keys.find((entry) => entry.usage === 0x1a);
  assert.equal(key?.tenthsMm, 20);
  assert.equal(device.frames.filter((frame) => frame.kind === "feature" && frame.data[0] === 0x83).length, 25);
  await client.close();
});

test("setActuation reads the table, patches the requested key and frames all 68", async () => {
  const device = new FakeSteelSeriesKeyboard();
  const client = new SteelSeriesKeyboardHidClient(device as unknown as HIDDevice);
  const profile = await client.setActuation([0x1a], 10);
  assert.equal(profile.live, true);
  const key = profile.keys.find((entry) => entry.usage === 0x1a);
  assert.equal(key?.tenthsMm, 10);
  assert.equal(key?.actuation, 21);
  assert.equal(key?.reset, 18);
  const hall = device.frames.find((frame) => frame.kind === "feature" && frame.data[0] === 0x38 && frame.data[1] === 0x61);
  assert.equal(hall?.data[2], 68);
  assert.equal(hall?.data[3], 0);
  const body = hall?.data.slice(4) ?? [];
  const keyOffset = body.findIndex((value, index) => index % 3 === 0 && value === 0x1a);
  assert.deepEqual(body.slice(keyOffset, keyOffset + 3), [0x1a, 21, 18]);
  await client.close();
});

test("release mode, sensitivity and rapid tap frames use their own sub-commands", async () => {
  const device = new FakeSteelSeriesKeyboard();
  const client = new SteelSeriesKeyboardHidClient(device as unknown as HIDDevice);
  await client.setReleaseMode([0x1a], 2);
  await client.setRapidTriggerSensitivity([0x1a], 3);
  await client.setRapidTap(true);
  assert.ok(device.frames.some((frame) => frame.data[0] === 0x38 && frame.data[1] === 0x62));
  assert.ok(device.frames.some((frame) => frame.data[0] === 0x38 && frame.data[1] === 0x65));
  assert.ok(device.frames.some((frame) => frame.kind === "output" && frame.data[0] === 0x38 && frame.data[1] === 0x66 && frame.data[2] === 1));
  await client.close();
});

test("saveProfile writes all 25 chunks and verifies the persisted blob", async () => {
  const device = new FakeSteelSeriesKeyboard();
  const client = new SteelSeriesKeyboardHidClient(device as unknown as HIDDevice);
  await client.setActuation([0x1a], 10);
  const saved = await client.saveProfile();
  assert.equal(saved.live, false);
  assert.equal(saved.checksumValid, true);
  assert.equal(saved.keys.find((entry) => entry.usage === 0x1a)?.tenthsMm, 10);
  const writes = device.frames.filter((frame) => frame.kind === "feature" && frame.data[0] === 0x03 && frame.data[1] === 0x01);
  assert.equal(writes.length, 25);
  await client.close();
});

test("secondary actuation changes only selected thresholds in schema 8 and persists the indexed table", async () => {
  const device = new FakeSteelSeriesKeyboard();
  const client = new SteelSeriesKeyboardHidClient(device as unknown as HIDDevice);
  const profile = await client.setSecondActuation([0x1a], 20);
  assert.deepEqual(profile.secondActuation?.[16], [0x39, 0x34]);
  const frame = device.frames.find((entry) => entry.kind === "feature"
    && entry.data[0] === 0x38 && entry.data[1] === 0x61 && entry.data[3] === 2);
  assert.equal(frame?.data.length, 644);
  assert.deepEqual(frame?.data.slice(0, 4), [0x38, 0x61, 68, 2]);
  const w = frame?.data.findIndex((byte, index) => index >= 4 && (index - 4) % 3 === 0 && byte === 0x1a) ?? -1;
  assert.deepEqual(frame?.data.slice(w, w + 3), [0x1a, 0x39, 0x34]);
  await assert.rejects(client.setSecondActuation([0x29], 20), /no analog switch/);
  await client.saveProfile();
  const reread = await client.readAnalogProfile();
  assert.deepEqual(reread.secondActuation?.[16], [0x39, 0x34]);
  assert.deepEqual(reread.secondActuation?.[15], [0, 0]);
  await client.close();
});

test("Rapid Tap indexed pairs and OLED profile bitmap are live and survive saveProfile", async () => {
  const device = new FakeSteelSeriesKeyboard();
  const client = new SteelSeriesKeyboardHidClient(device as unknown as HIDDevice);
  const pairs = Array.from({ length: 10 }, (_, index) => ({
    hid1: index === 0 ? 4 : 0, hid2: index === 0 ? 7 : 0,
    mode: index === 0 ? 3 as const : 0 as const, reportBothKeys: index === 0,
  }));
  await assert.rejects(client.setRapidTapPairs(pairs.map((pair, index) =>
    index === 0 ? { ...pair, hid2: 4 } : pair)), /distinct analog HID/);
  const profile = await client.setRapidTapPairs(pairs);
  assert.deepEqual(profile.rapidTapPairs?.[0], pairs[0]);
  const tap = device.frames.find((entry) => entry.kind === "output" && entry.data[0] === 0x38 && entry.data[1] === 0x67);
  assert.equal(tap?.data.length, 64);
  assert.deepEqual(tap?.data.slice(0, 9), [0x38, 0x67, 10, 0, 4, 7, 0x83, 0, 0]);
  const bitmap = Uint8Array.from({ length: 640 }, (_, index) => index & 0xff);
  await client.setOledDisplay(bitmap);
  const oled = device.frames.find((entry) => entry.kind === "feature" && entry.data[0] === 0x38 && entry.data[1] === 0x83);
  assert.equal(oled?.data.length, 644);
  assert.deepEqual(oled?.data.slice(0, 6), [0x38, 0x83, 0, 0, 1, 2]);
  assert.equal(oled?.data[642], bitmap[639]);
  await client.saveProfile();
  const reread = await client.readAnalogProfile();
  assert.deepEqual(reread.rapidTapPairs?.[0], pairs[0]);
  assert.deepEqual(reread.oled, bitmap);
  await client.close();
});

test("OLED direct writes release control without changing on-board profile", async () => {
  const device = new FakeSteelSeriesKeyboard();
  const client = new SteelSeriesKeyboardHidClient(device as unknown as HIDDevice);
  await client.setOledDirect(new Uint8Array(640).fill(0x7f));
  const direct = device.frames.find((entry) => entry.kind === "feature" && entry.data[0] === 0x1f && entry.data[1] === 0x81);
  assert.equal(direct?.data.length, 644);
  assert.deepEqual(direct?.data.slice(0, 5), [0x1f, 0x81, 0x7f, 0x7f, 0x7f]);
  await client.clearOledDirect();
  assert.ok(device.frames.some((entry) => entry.kind === "output" && entry.data[0] === 0x1f && entry.data[1] === 0x82));
  assert.equal((await client.readAnalogProfile()).oled?.[0], 0x11);
  device.productId = 0x1642;
  await assert.rejects(client.setSecondActuation([4], 10), /only documented.*0x1628/);
  await assert.rejects(client.setRapidTapPairs([]), /only documented.*0x1628/);
  await assert.rejects(client.setOledDisplay(new Uint8Array(640)), /only documented.*0x1628/);
  await assert.rejects(client.setOledDirect(new Uint8Array(640)), /only documented.*0x1628/);
  await assert.rejects(client.clearOledDirect(), /only documented.*0x1628/);
  await client.close();
});

test("direct lighting paints all 84 keys and clear hands control back", async () => {
  const device = new FakeSteelSeriesKeyboard();
  const client = new SteelSeriesKeyboardHidClient(device as unknown as HIDDevice);
  await client.setSolidLighting(255, 0, 0);
  const light = device.frames.find((frame) => frame.kind === "feature" && frame.data[0] === 0x40);
  assert.equal(light?.data[1], 84);
  assert.deepEqual(light?.data.slice(2, 6), [0x04, 255, 0, 0]);
  await client.clearLighting();
  assert.ok(device.frames.some((frame) => frame.kind === "output" && frame.data[0] === 0x41));
  await client.close();
});

test("a non-analog key is rejected before a frame is sent", async () => {
  const device = new FakeSteelSeriesKeyboard();
  const client = new SteelSeriesKeyboardHidClient(device as unknown as HIDDevice);
  await assert.rejects(client.setActuation([0x29], 10), /no analog switch/);
  assert.ok(!STEELSERIES_APEX_PRO_2023_SLOTS.includes(0x29));
  await client.close();
});
