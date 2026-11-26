import assert from "node:assert/strict";
import test from "node:test";

import { GloriousKeyboardHidClient } from "./hid.ts";
import { ViaHidClient } from "../via/hid.ts";
import { createSupportedClient } from "../registry.ts";
import {
  gloriousDefaultState,
  gloriousKeysJob,
  gloriousModel,
  gloriousPollingJob,
  gmmkPollingFrame,
  type GloriousJob,
} from "@openmouse/keyboard-protocol/glorious";

/** One collection with a report of `bytes` bytes (report id not counted). */
function settings(usagePage: number, usage: number, reportId: number, bytes: number, output = false): HIDCollectionInfo {
  const report = { reportId, items: [{ reportSize: 8, reportCount: bytes }] } as unknown as HIDReportInfo;
  return {
    usagePage, usage, children: [], inputReports: [],
    outputReports: output ? [report] : [], featureReports: output ? [] : [report],
  } as HIDCollectionInfo;
}

interface Sent { kind: "feature" | "output"; reportId: number; data: Uint8Array }

function fakeDevice(vendorId: number, productId: number, collections: HIDCollectionInfo[]) {
  const sent: Sent[] = [];
  const listeners = new Set<(event: HIDInputReportEvent) => void>();
  const device = {
    vendorId, productId, productName: "GMMK", opened: false, collections,
    async open() { device.opened = true; },
    async close() { device.opened = false; },
    async sendFeatureReport(reportId: number, data: BufferSource) { sent.push({ kind: "feature", reportId, data: new Uint8Array(data as ArrayBuffer) }); },
    async sendReport(reportId: number, data: BufferSource) { sent.push({ kind: "output", reportId, data: new Uint8Array(data as ArrayBuffer) }); },
    addEventListener(_type: string, listener: (event: HIDInputReportEvent) => void) { listeners.add(listener); },
    removeEventListener(_type: string, listener: (event: HIDInputReportEvent) => void) { listeners.delete(listener); },
    emit(reportId: number, bytes: number[]) {
      const data = new DataView(Uint8Array.from(bytes).buffer);
      listeners.forEach((listener) => listener({ device, reportId, data } as unknown as HIDInputReportEvent));
    },
  };
  return { device: device as unknown as HIDDevice & { emit: typeof device.emit }, sent };
}

const noWait = async () => {};

test("a stock GMMK 2 is driven by Glorious; a QMK-flashed one is left to VIA", () => {
  const stock = fakeDevice(0x320f, 0x504a, [settings(0xff01, 1, 7, 263), settings(0xff00, 0xff00, 4, 63)]).device;
  assert.ok(createSupportedClient(stock) instanceof GloriousKeyboardHidClient);
  const qmk = fakeDevice(0x320f, 0x504a, [settings(0xff60, 0x61, 0, 32, true)]).device;
  assert.equal(GloriousKeyboardHidClient.isSupported(qmk), false);
  assert.ok(createSupportedClient(qmk) instanceof ViaHidClient);
});

test("the Eternal's stock firmware on QMK's page is Glorious, by its ids", () => {
  const eternal = fakeDevice(0x3794, 0xb010, [settings(0xff60, 0x61, 9, 63, true)]).device;
  assert.ok(createSupportedClient(eternal) instanceof GloriousKeyboardHidClient);
});

test("frames go out padded to the descriptor's size, without the report id", async () => {
  const { device, sent } = fakeDevice(0x320f, 0x504a, [settings(0xff01, 1, 7, 263)]);
  const client = new GloriousKeyboardHidClient(device, noWait);
  const model = gloriousModel(0x320f, 0x504a)!;
  const state = gloriousDefaultState(model);
  await client.send([...gloriousPollingJob(model, state, 250), ...gloriousKeysJob(model, state, { KeyA: { kind: "disabled" } })]);
  assert.equal(sent.length, 2);
  assert.ok(sent.every((s) => s.kind === "feature" && s.reportId === 7 && s.data.length === 263));
  assert.deepEqual([...sent[0]!.data.subarray(0, 10)], [8, 0, 0, 0, 0, 0, 0, 2, 1, 0]);
  assert.equal(sent[1]!.data[0], 0x03);
});

test("close() drops jobs still queued and stops the one being sent", async () => {
  const { device, sent } = fakeDevice(0x320f, 0x504a, [settings(0xff01, 1, 7, 263)]);
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const client = new GloriousKeyboardHidClient(device, () => gate);
  const model = gloriousModel(0x320f, 0x504a)!;
  const state = gloriousDefaultState(model);
  const running = client.send([...gloriousPollingJob(model, state, 250), ...gloriousKeysJob(model, state, { KeyA: { kind: "disabled" } })]);
  const queued = client.send(gloriousPollingJob(model, state, 500));
  await new Promise((resolve) => setImmediate(resolve));
  const closing = client.close();
  release();
  await assert.rejects(running, /closed before the change was fully sent/);
  await assert.rejects(queued, /closed; nothing was sent/);
  await closing;
  assert.equal(sent.length, 1, "only the frame already on the wire went out");
  assert.equal(device.opened, false);
  await client.send(gloriousPollingJob(model, state, 1000));
  assert.equal(sent.length, 2, "a send after close() reopens and works");
});

test("HE and Eternal use their own reports", async () => {
  const he = fakeDevice(0x342d, 0xe3de, [settings(0xffff, 2, 0, 64)]);
  const heModel = gloriousModel(0x342d, 0xe3de)!;
  await new GloriousKeyboardHidClient(he.device, noWait).send(gloriousPollingJob(heModel, gloriousDefaultState(heModel), 8000));
  assert.deepEqual(he.sent.map((s) => [s.kind, s.reportId, s.data.length, s.data[0], s.data[1]]),
    [["feature", 0, 64, 4, 0], ["feature", 0, 64, 4, 1], ["feature", 0, 64, 4, 2]]);
  const eternal = fakeDevice(0x3794, 0xb010, [settings(0xff60, 0x61, 9, 63, true)]);
  const eModel = gloriousModel(0x3794, 0xb010)!;
  await new GloriousKeyboardHidClient(eternal.device, noWait).send(gloriousPollingJob(eModel, gloriousDefaultState(eModel), 500));
  assert.deepEqual(eternal.sent.map((s) => [s.kind, s.reportId, s.data.length]), [["output", 9, 63]]);
});

test("nothing is sent when a frame is refused or the report size is off", async () => {
  const { device, sent } = fakeDevice(0x320f, 0x504a, [settings(0xff01, 1, 7, 263)]);
  const client = new GloriousKeyboardHidClient(device, noWait);
  const reset = new Uint8Array(264);
  reset.set([7, 0x02]);
  const job: GloriousJob = [{ frame: gmmkPollingFrame(1000), delayMs: 0 }, { frame: reset, delayMs: 0 }];
  await assert.rejects(client.send(job));
  const small = fakeDevice(0x320f, 0x504a, [settings(0xff01, 1, 7, 8)]);
  await assert.rejects(new GloriousKeyboardHidClient(small.device, noWait).send([{ frame: gmmkPollingFrame(1000), delayMs: 0 }]));
  assert.equal(sent.length + small.sent.length, 0);
});

test("a profile switched on the board is announced", async () => {
  const { device } = fakeDevice(0x320f, 0x504a, [settings(0xff01, 1, 7, 263), settings(0xff00, 0xff00, 4, 63)]);
  const client = new GloriousKeyboardHidClient(device, noWait);
  const seen: [number, number][] = [];
  client.onProfileChanged((profile, layer) => seen.push([profile, layer]));
  await client.open();
  device.emit(4, [0xf1, 2, 1]);
  device.emit(4, [0x00, 2, 1]);
  assert.deepEqual(seen, [[1, 0]]);
  assert.equal((await client.readStatus()).glorious?.model.key, "gmmk2-65-iso");
});
