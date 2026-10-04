import assert from "node:assert/strict";
import test from "node:test";

import { WootingHidClient } from "./hid.ts";
import { deviceBrand } from "../registry.ts";
import { WOOTING_VENDOR_ID } from "@openmouse/keyboard-protocol/wooting";

interface FakeOptions {
  /** Layout byte the fake answers with, "silent" for no reply, "throw" to reject the send. */
  reply?: number | "silent" | "throw";
  /** Which channel the reply comes back on. */
  channel?: "input" | "feature";
  productId?: number;
  usagePage?: number;
  featureReportId?: number;
  /** Profile-index payload [flashDefault, pad, active]; null = silent on 0x0b. */
  profileIndex?: [number, number, number] | null;
  /** Profile names by slot; missing slot = empty (length 0) probe answer. */
  profileNames?: (string | null)[];
  /** Raw length-prefixed bodies answered verbatim per command (live captures). */
  blobBodies?: Record<number, number[] | null>;
  /** Nested varint pairs answered for profile-blob reads; null echoes header-only. */
  blobFields?: Record<number, Array<readonly [number, number]> | null>;
  /** Scalar payload byte answered for count/flash reads; null = error status. */
  scalarReplies?: Record<number, number | null>;
}

/** Test-only varint encoder for building blob answers by hand. */
function fakeVarint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  do {
    let byte = rest & 0x7f;
    rest = Math.floor(rest / 128);
    if (rest !== 0) byte |= 0x80;
    out.push(byte);
  } while (rest !== 0);
  return out;
}

/** ARM profile-blob answer from nested varint pairs (`d1 da cmd 88 <len:u16> 0a <len> …`). */
function fakeBlobAnswer(command: number, nested: Array<readonly [number, number]>): Uint8Array {
  const inner = nested.flatMap(([field, value]) => [(field << 3) | 0, ...fakeVarint(value)]);
  const body = [0x0a, inner.length, ...inner];
  return new Uint8Array([0xd1, 0xda, command, 0x88, body.length, 0x00, ...body]);
}

function fakeWooting(
  { reply = 0, channel = "input", productId = 0x1322, usagePage = 0xff55, featureReportId = 1, profileIndex = [0, 0, 1], profileNames = ["Default"], blobFields = {}, blobBodies = {}, scalarReplies = {} }: FakeOptions = {},
) {
  let inputListener: ((event: HIDInputReportEvent) => void) | null = null;
  const sent: Array<{ reportId: number; data: Uint8Array }> = [];
  const sentReports: Array<{ reportId: number; data: Uint8Array }> = [];
  let opened = false;
  let lastCommand = 0;
  let lastSlot = 0;
  // Fake runtime-active slot: write commands (0x17) move it, 0x0b reads it.
  let fakeActiveSlot = profileIndex ? profileIndex[2] : 0;
  // Echo the command that was just sent; the DEVICE_CONFIG reply (0x13) also
  // carries the layout byte at the WebHID offset (9).
  const answer = () => {
    const response = new Uint8Array(64);
    response[0] = 0xd1; // the 60HE+ answers with the multi-report magic
    response[1] = 0xda;
    response[2] = lastCommand;
    response[3] = 0x88; // OK status
    if (lastCommand === 0x13) response[9] = typeof reply === "number" ? reply : 0;
    if (lastCommand === 0x01) response.set([0x03, 0x00, 0x02, 0x0d], 4); // version 3.0.2 build 13
    if (lastCommand === 0x09) response[3] = 0x66; // ARM: no direct profile count
    if (lastCommand === 0x0b) {
      if (!profileIndex) return null;
      response.set([profileIndex[0], profileIndex[1], fakeActiveSlot], 4);
    }
    if (lastCommand === 0x37) {
      const name = profileNames[lastSlot] ?? null;
      if (name === null && lastSlot >= profileNames.length) return response.subarray(0, 6).slice();
      const encoded = new TextEncoder().encode(name ?? "");
      const body = new Uint8Array([0x0a, encoded.length, ...encoded]);
      response[4] = body.length;
      response[5] = 0;
      response.set(body, 6);
    }
    if (lastCommand in blobBodies) {
      const body = blobBodies[lastCommand];
      if (body === null || body === undefined) return null;
      return new Uint8Array([0xd1, 0xda, lastCommand, 0x88, body.length, 0x00, ...body]);
    }
    if (lastCommand in blobFields) {
      const nested = blobFields[lastCommand];
      if (nested === null || nested === undefined) return null;
      return fakeBlobAnswer(lastCommand, nested);
    }
    // Unlisted profile blobs stay silent (no reply) unless the test opts in
    // via blobFields/blobBodies — never invented.
    if ([0x14, 0x18, 0x27, 0x28, 0x29, 0x30, 0x31, 0x32, 0x33, 0x34, 0x36, 0x11, 0x12, 0x23, 0x24, 0x39, 0x3b].includes(lastCommand)) {
      return null;
    }
    if (lastCommand in scalarReplies) {
      const value = scalarReplies[lastCommand];
      if (value === null || value === undefined) {
        response[3] = 0x66;
        return response;
      }
      response[4] = value;
      if (lastCommand === 0x3a) response.set([value, 0x00, 0x40, 0x00], 4);
      return response;
    }
    // Live 60HE+: 0x10/0x04/0x0A answer 0x66 on ARM — the scalar fallbacks
    // below only serve Standard-firmware boards in tests.
    if ([0x10, 0x04, 0x0a].includes(lastCommand)) {
      response[3] = 0x66;
      return response;
    }
    if (lastCommand === 0x38) response[4] = 1;
    if (lastCommand === 0x3a) response.set([0x0a, 0x00, 0x40, 0x00], 4);
    return response;
  };
  const device = {
    vendorId: WOOTING_VENDOR_ID,
    productId,
    productName: "Wooting 60HE+",
    get opened() {
      return opened;
    },
    collections: [{
      usagePage,
      usage: 1,
      children: [],
      inputReports: [],
      outputReports: [],
      featureReports: [{ reportId: featureReportId, items: [] }],
    }],
    open: async () => void (opened = true),
    close: async () => void (opened = false),
    sendFeatureReport: async (reportId: number, data: Uint8Array) => {
      sent.push({ reportId, data: new Uint8Array(data) });
      // WebHID body (hidapi index byte already split off): [d1, da, cmd, slot, 0, 0, 0].
      lastCommand = data[2] ?? 0;
      if (lastCommand === 0x37) lastSlot = data[3] ?? 0;
      if (lastCommand === 0x17) fakeActiveSlot = data[3] ?? fakeActiveSlot;
      if (reply === "throw") throw new Error("This interface has no feature report to write to.");
      if (reply !== "silent" && channel === "input") {
        const out = answer();
        if (out) inputListener?.({ data: new DataView(out.buffer) } as HIDInputReportEvent);
      }
    },
    sendReport: async (reportId: number, data: Uint8Array) => {
      sentReports.push({ reportId, data: new Uint8Array(data) });
    },
    receiveFeatureReport: async (_reportId: number) => {
      if (reply === "silent" || reply === "throw" || channel !== "feature") {
        return new DataView(new Uint8Array(64).buffer);
      }
      return new DataView((answer() ?? new Uint8Array(64)).buffer);
    },
    addEventListener: (type: string, listener: (event: HIDInputReportEvent) => void) => {
      if (type === "inputreport") inputListener = listener;
    },
    removeEventListener: (type: string, listener: (event: HIDInputReportEvent) => void) => {
      if (type === "inputreport" && inputListener === listener) inputListener = null;
    },
    fireInput: (bytes: Uint8Array) => {
      inputListener?.({ device, reportId: 1, data: new DataView(bytes.buffer) } as unknown as HIDInputReportEvent);
    },
  } as unknown as HIDDevice & { fireInput: (bytes: Uint8Array) => void };
  return { device, sent, sentReports, fireInput: (device as unknown as { fireInput: (bytes: Uint8Array) => void }).fireInput };
}

test("isSupported accepts only the config interface", () => {
  assert.equal(WootingHidClient.isSupported(fakeWooting().device), true);
  // The legacy 0xFF00 and analog 0xFF53 collections are not the command
  // interface, so they are rejected (this is what kept the board off the picker
  // twice).
  assert.equal(WootingHidClient.isSupported(fakeWooting({ usagePage: 0xff00 }).device), false);
  assert.equal(WootingHidClient.isSupported(fakeWooting({ usagePage: 0xff53 }).device), false);
  // Standard-firmware 0x1337 config page is accepted for One/Two/60HE.
  assert.equal(WootingHidClient.isSupported(fakeWooting({ usagePage: 0x1337 }).device), true);
  // Wrong product id (not in the catalog) is rejected.
  assert.equal(WootingHidClient.isSupported(fakeWooting({ productId: 0x0001 }).device), false);
});

test("readStatus identifies the board with firmware, layout and profiles", async () => {
  // Live 60HE+ bodies: 0x27 actuation 17203 = 0.20mm, 0x33 config row,
  // 0x30/0x29/0x32/0x23/0x24 six-group rows, 0x14 zero rows at rest.
  const mapRow = (fill: number) => [0x0a, 0x17, 0x0a, 0x15, ...new Array<number>(21).fill(fill)];
  const mapBody = [...mapRow(0x26), ...mapRow(0x26), ...mapRow(0x26), ...mapRow(0x26), ...mapRow(0x26), ...mapRow(0x26)];
  const zeroBody = [...mapRow(0), ...mapRow(0), ...mapRow(0), ...mapRow(0), ...mapRow(0), ...mapRow(0)];
  const { device, sent } = fakeWooting({
    reply: 3,
    blobBodies: {
      0x27: [0x0a, 0x14, 0x08, 0xb3, 0x86, 0x01, 0x10, 0x01, 0x18, 0x01, 0x20, 0x9a, 0x83, 0x01, 0x28, 0x00, 0x30, 0x02, 0x38, 0x00, 0x48, 0x00],
      0x33: [0x0a, 0x04, 0x08, 0x05, 0x10, 0x0a, 0x10, 0x00],
      0x30: mapBody,
      0x14: zeroBody,
      0x29: [0x0a, 0x1c, 0x0a, 0x04, 0x08, 0x00, 0x10, 0x14, 0x0a, 0x04, 0x08, 0x3c, 0x10, 0x3c, 0x0a, 0x06, 0x08, 0xc2, 0x01, 0x10, 0xc3, 0x01, 0x0a, 0x06, 0x08, 0xfd, 0x01, 0x10, 0xff, 0x01, 0x12, 0x08, 0x08, 0x00, 0x10, 0x00, 0x18, 0x01, 0x20, 0x32],
      0x34: [0x0a, 0x0c, 0x2a, 0x06, 0x08, 0x63, 0x10, 0x04, 0x18, 0x00, 0x40, 0x61, 0x48, 0x00, 0x10, 0x00, 0x18, 0x01],
      0x32: [0x0a, 0x13, 0x08, 0xff, 0x01, 0x10, 0xff, 0xff, 0x03, 0x18, 0xff, 0xff, 0x03, 0x20, 0xff, 0xff, 0x03, 0x28, 0xff, 0xff, 0x03, 0x22, 0x08, 0x0a, 0x06, 0x4a, 0x04, 0x08, 0x7f, 0x10, 0x00],
      0x23: [0x0a, 0x2b, 0x0a, 0x29, 0x1f, 0x1f, 0x1f, 0x1f, 0x1f, 0xbf, 0x07, 0xbf, 0x07, 0xbf, 0x07, 0xbf, 0x07, 0x9f, 0x0e, 0x9f, 0x0e, 0x9f, 0x0e, 0x9f, 0x0e, 0xf1, 0x0f, 0xf1, 0x0f, 0xf1, 0x0f, 0xf1, 0x0f, 0xe0, 0xdf, 0x01, 0xe0, 0xdf, 0x01, 0xe0, 0xdf, 0x01, 0xe0, 0xdf, 0x01],
      0x24: [0x0a, 0x2b, 0x0a, 0x29, 0x1f, 0x1f, 0x1f, 0x1f, 0x1f, 0xbf, 0x07, 0xbf, 0x07, 0xbf, 0x07, 0xbf, 0x07, 0x9f, 0x0e, 0x9f, 0x0e, 0x9f, 0x0e, 0x9f, 0x0e, 0xf1, 0x0f, 0xf1, 0x0f, 0xf1, 0x0f, 0xf1, 0x0f, 0xe0, 0xdf, 0x01, 0xe0, 0xdf, 0x01, 0xe0, 0xdf, 0x01, 0xe0, 0xdf, 0x01],
    },
    scalarReplies: { 0x10: null, 0x04: null, 0x0a: null },
  });
  const client = new WootingHidClient(device);
  const status = await client.readStatus();

  assert.equal(status.brand, "Wooting");
  assert.equal(status.name, "Wooting 60HE+");
  assert.equal(status.ui?.settingsReady, false);
  assert.equal(status.ui?.family, "wooting");
  assert.equal(deviceBrand(client), "Wooting");
  // Version, config, serial, index, count-probe, then one metadata probe that
  // answers populated and one that answers empty.
  assert.ok(sent.length >= 5);
  assert.ok(sent.every((packet) => packet.reportId === 1));
  assert.deepEqual([...sent[0]!.data.slice(0, 3)], [0xd1, 0xda, 0x01]);
  assert.deepEqual([...sent[1]!.data.slice(0, 3)], [0xd1, 0xda, 0x13]);
  assert.deepEqual(status.firmware, ["Firmware: 2.13.0", "Layout: ANSI Split"]);
  assert.equal(status.firmwareVersion, "2.13.0");
  assert.equal(status.layout, "ANSI Split");
  // ARM quirk: the ACTIVE byte (slot 1) wins over the flash default (slot 0).
  assert.equal(status.activeProfile, 1);
  assert.equal(status.profileCount, 1);
  assert.deepEqual([...status.profileNames], ["Default"]);
  // Live actuation raw 17203 = 0.20mm on the contract line.
  assert.equal(status.analogProfile?.actuationRaw, 17203);
  assert.deepEqual([...(status.analogProfile?.global?.config ?? [])], [0x08, 0x05, 0x10, 0x0a]);
  assert.equal(status.mappings?.slot, 1);
  assert.equal(status.mappings?.mapping?.groups.length, 6);
  // 0x18/0x28 answer empty on ARM: readDks reports null (unbound), 0x28 binds null.
  assert.equal(status.dks, null);
  assert.equal(status.gamepad?.mapping, null);
  assert.equal(status.gamepad?.profile?.mode, 1);
  assert.equal(status.akc?.combos.length, 1);
  assert.equal(status.rgb?.slot, 1);
  assert.ok(status.rgb?.core);
  assert.equal(status.rgb?.colors1?.part, 1);
  assert.equal(status.rgb?.colors2?.part, 2);
  // 0x10/0x04/0x0A answer 0x66 on ARM: null counts, never guessed.
  assert.equal(status.diagnostics?.keyCount, null);
  assert.equal(status.diagnostics?.flashConnected, true);
  assert.equal(status.diagnostics?.flashStats?.usedPages, 10);
  assert.equal(status.analogSnapshot?.available, true);
  assert.equal(status.analogSnapshot?.keys.length, 0);
  // A second readStatus reuses every cached reply: no further writes.
  const sentAfterFirst = sent.length;
  await client.readStatus();
  assert.equal(sent.length, sentAfterFirst);
});

test("readStatus reads a reply delivered as a feature report", async () => {
  const { device } = fakeWooting({ reply: 1, channel: "feature" });
  const status = await new WootingHidClient(device).readStatus();
  assert.ok(status.firmware.includes("Layout: ISO"));
});

test("a header-only config reply shows the raw bytes but no invented layout", async () => {
  // reply 0 lands in the header region only; there is no real payload to decode.
  const { device } = fakeWooting({ reply: 0 });
  const status = await new WootingHidClient(device).readStatus();
  assert.ok(status.firmware.some((line) => line.startsWith("Config reply: d1 da 13")));
  assert.ok(!status.firmware.some((line) => line.startsWith("Layout:")));
  assert.equal(status.layout, null);
});

test("readStatus still connects when the browser refuses the feature write", async () => {
  const { device } = fakeWooting({ reply: "throw" });
  const client = new WootingHidClient(device);
  const status = await client.readStatus();

  assert.equal(status.brand, "Wooting");
  assert.equal(status.name, "Wooting 60HE+");
  assert.equal(status.ui?.settingsReady, false);
  // No live config, so no layout line — but the board is still identified.
  assert.deepEqual(status.firmware, []);
  assert.equal(status.activeProfile, null);
  assert.equal(status.profileCount, null);
});

test("an unreadable profile index reports nulls, never a guessed slot", async () => {
  const { device } = fakeWooting({ profileIndex: null });
  const status = await new WootingHidClient(device).readStatus();
  assert.equal(status.activeProfile, null);
});

test("startAnalog opens the 0xFF53 sibling and streams decoded frames", async () => {
  // A separate HIDDevice for the analog interface, discovered via navigator.hid.
  let analogListener: ((event: HIDInputReportEvent) => void) | null = null;
  let analogOpened = false;
  const analog = {
    vendorId: WOOTING_VENDOR_ID,
    productId: 0x1322,
    productName: "Wooting 60HE+",
    get opened() {
      return analogOpened;
    },
    collections: [{ usagePage: 0xff53, usage: 1, children: [], inputReports: [], outputReports: [], featureReports: [] }],
    open: async () => void (analogOpened = true),
    close: async () => void (analogOpened = false),
    addEventListener: (type: string, listener: (event: HIDInputReportEvent) => void) => {
      if (type === "inputreport") analogListener = listener;
    },
    removeEventListener: (type: string, listener: (event: HIDInputReportEvent) => void) => {
      if (type === "inputreport" && analogListener === listener) analogListener = null;
    },
  } as unknown as HIDDevice;

  const priorNavigator = (globalThis as { navigator?: unknown }).navigator;
  Object.defineProperty(globalThis, "navigator", {
    value: { hid: { getDevices: async () => [analog] } },
    configurable: true,
  });
  try {
    const { device } = fakeWooting();
    const client = new WootingHidClient(device);
    const frames: number[][] = [];
    const stop = await client.startAnalog((keys) => frames.push(keys.map((k) => k.value)));

    assert.equal(analogOpened, true);
    // A live frame: A (0x04) at 180.
    analogListener!({ data: new DataView(new Uint8Array([0x00, 0x04, 0xb4]).buffer) } as HIDInputReportEvent);
    assert.deepEqual(frames, [[180]]);

    stop();
    assert.equal(analogListener, null);
  } finally {
    Object.defineProperty(globalThis, "navigator", { value: priorNavigator, configurable: true });
  }
});

test("failing reads are attempted once, not on every refresh", async () => {
  const { device, sent } = fakeWooting({ reply: "throw" });
  const client = new WootingHidClient(device);
  await client.readStatus();
  await client.readStatus();
  await client.readStatus();
  // Only the first readStatus tried the identity commands; later refreshes reuse the cache.
  // (Profile probes are live per read; identity commands are cached.)
  const identitySends = sent.filter((packet) => [0x01, 0x13, 0x03].includes(packet.data[2] ?? -1));
  assert.equal(identitySends.length, 3);
});

test("read* helpers decode one feature each and cache per slot", async () => {
  const mapRow = (fill: number) => [0x0a, 0x17, 0x0a, 0x15, ...new Array<number>(21).fill(fill)];
  const mapBody = [...mapRow(0x26), ...mapRow(0x26), ...mapRow(0x26), ...mapRow(0x26), ...mapRow(0x26), ...mapRow(0x26)];
  const zeroBody = [...mapRow(0), ...mapRow(0), ...mapRow(0), ...mapRow(0), ...mapRow(0), ...mapRow(0)];
  const { device, sent } = fakeWooting({
    blobBodies: {
      0x27: [0x0a, 0x14, 0x08, 0xb3, 0x86, 0x01, 0x10, 0x01, 0x18, 0x01, 0x20, 0x9a, 0x83, 0x01, 0x28, 0x00, 0x30, 0x02, 0x38, 0x00, 0x48, 0x00],
      0x33: [0x0a, 0x04, 0x08, 0x05, 0x10, 0x0a, 0x10, 0x00],
      0x30: mapBody,
      0x29: [0x0a, 0x1c, 0x0a, 0x04, 0x08, 0x00, 0x10, 0x14, 0x0a, 0x04, 0x08, 0x3c, 0x10, 0x3c, 0x0a, 0x06, 0x08, 0xc2, 0x01, 0x10, 0xc3, 0x01, 0x0a, 0x06, 0x08, 0xfd, 0x01, 0x10, 0xff, 0x01, 0x12, 0x08, 0x08, 0x00, 0x10, 0x00, 0x18, 0x01, 0x20, 0x32],
      0x34: [0x0a, 0x0c, 0x2a, 0x06, 0x08, 0x63, 0x10, 0x04, 0x18, 0x00, 0x40, 0x61, 0x48, 0x00, 0x10, 0x00, 0x18, 0x01],
      0x32: [0x0a, 0x13, 0x08, 0xff, 0x01, 0x10, 0xff, 0xff, 0x03, 0x18, 0xff, 0xff, 0x03, 0x20, 0xff, 0xff, 0x03, 0x28, 0xff, 0xff, 0x03, 0x22, 0x08, 0x0a, 0x06, 0x4a, 0x04, 0x08, 0x7f, 0x10, 0x00],
      0x23: [0x0a, 0x2b, 0x0a, 0x29, 0x1f, 0x1f, 0x1f, 0x1f, 0x1f, 0xbf, 0x07, 0xbf, 0x07, 0xbf, 0x07, 0xbf, 0x07, 0x9f, 0x0e, 0x9f, 0x0e, 0x9f, 0x0e, 0x9f, 0x0e, 0xf1, 0x0f, 0xf1, 0x0f, 0xf1, 0x0f, 0xf1, 0x0f, 0xe0, 0xdf, 0x01, 0xe0, 0xdf, 0x01, 0xe0, 0xdf, 0x01, 0xe0, 0xdf, 0x01],
      0x24: [0x0a, 0x2b, 0x0a, 0x29, 0x1f, 0x1f, 0x1f, 0x1f, 0x1f, 0xbf, 0x07, 0xbf, 0x07, 0xbf, 0x07, 0xbf, 0x07, 0x9f, 0x0e, 0x9f, 0x0e, 0x9f, 0x0e, 0x9f, 0x0e, 0xf1, 0x0f, 0xf1, 0x0f, 0xf1, 0x0f, 0xf1, 0x0f, 0xe0, 0xdf, 0x01, 0xe0, 0xdf, 0x01, 0xe0, 0xdf, 0x01, 0xe0, 0xdf, 0x01],
      0x14: zeroBody,
    },
    scalarReplies: { 0x10: null, 0x04: null, 0x0a: null },
  });
  const client = new WootingHidClient(device);

  const full = (await client.readAnalogProfileFull(1))!;
  assert.equal(full.actuationRaw, 17203);
  assert.deepEqual([...(full.global?.config ?? [])], [0x08, 0x05, 0x10, 0x0a]);
  // The slot byte rides at ARM byte 4 (WebHID body index 3).
  assert.ok(sent.some((packet) => packet.data[2] === 0x27 && packet.data[3] === 1));

  const mappings = (await client.readMappings(1))!;
  assert.equal(mappings.slot, 1);
  assert.equal(mappings.mapping?.groups.length, 6);
  // 0x11/0x12 stay silent, so the Fn layers are null rather than invented.
  assert.equal(mappings.main, null);
  assert.equal(mappings.function, null);

  // 0x18 answers empty on ARM: unbound, reported as null (Standard only).
  assert.equal(await client.readDks(1), null);

  const akc = (await client.readAkc(1))!;
  assert.equal(akc.combos.length, 1);

  const gamepad = (await client.readGamepad(1))!;
  // 0x28 answers empty on ARM, so mapping stays null; binds live in 0x29 (mode 1).
  assert.equal(gamepad.mapping, null);
  assert.equal(gamepad.profile?.mode, 1);

  const rgb = (await client.readRgb(1))!;
  assert.ok(rgb.core);
  assert.equal(rgb.colors1?.part, 1);
  assert.equal(rgb.colors2?.part, 2);
  // 0x39 answers empty on ARM: no layer rows, never invented.
  assert.equal(rgb.layer, null);

  const diagnostics = (await client.readDiagnostics())!;
  assert.equal(diagnostics.keyCount, null);
  assert.equal(diagnostics.flashConnected, true);
  assert.equal(diagnostics.flashStats?.usedPages, 10);

  const snapshot = await client.readAnalogSnapshot();
  assert.equal(snapshot.available, true);
  assert.deepEqual(snapshot.keys, []);

  // Slot reads are cached: repeating every helper sends nothing new.
  const sentAfterFirst = sent.length;
  await client.readAnalogProfileFull(1);
  await client.readMappings(1);
  await client.readDks(1);
  await client.readGamepad(1);
  await client.readRgb(1);
  await client.readDiagnostics();
  await client.readAnalogSnapshot();
  assert.equal(sent.length, sentAfterFirst);
});

test("read* helpers report nulls on a silent board, never invented data", async () => {
  const { device } = fakeWooting({ reply: "silent", profileIndex: null });
  const client = new WootingHidClient(device);

  assert.equal(await client.readAnalogProfileFull(0), null);
  assert.equal(await client.readPerKeyActuation(0), null);
  assert.equal(await client.readRapidTrigger(0), null);
  assert.equal(await client.readMappings(0), null);
  assert.equal(await client.readDks(0), null);
  assert.equal(await client.readAkc(0), null);
  assert.equal(await client.readGamepad(0), null);
  assert.equal(await client.readRgb(0), null);
  assert.equal(await client.readDiagnostics(), null);
  assert.deepEqual(await client.readAnalogSnapshot(), { available: false, keys: [] });

  const status = await client.readStatus();
  assert.equal(status.analogProfile, null);
  assert.equal(status.perKeyActuation, null);
  assert.equal(status.analogSnapshot?.available, false);
});

test("switchProfile sends the init-activate-reload sequence and verifies the slot", async () => {
  const { device, sent } = fakeWooting({ profileIndex: [0, 0, 0] });
  const client = new WootingHidClient(device);

  assert.equal(await client.switchProfile(2), 2);
  const commands = sent.map((packet) => packet.data[2]);
  assert.deepEqual(commands.slice(0, 3), [0x21, 0x17, 0x26]);
  // Slot byte rides at ARM byte 4 (WebHID body index 3).
  assert.equal(sent[1]?.data[3], 2);
  assert.equal(sent[2]?.data[3], 2);
  const status = await client.readStatus();
  assert.equal(status.activeProfile, 2);
});

test("switchProfile throws when the board refuses instead of guessing", async () => {
  const { device } = fakeWooting({ reply: "silent", profileIndex: [0, 0, 0] });
  const client = new WootingHidClient(device);
  await assert.rejects(() => client.switchProfile(1));
});

test("saveProfile requires confirmed and clears the cache on success", async () => {
  const { device, sent } = fakeWooting();
  const client = new WootingHidClient(device);
  await client.readStatus();
  const sentAfterRead = sent.length;

  await assert.rejects(() => client.saveProfile(0x2a, 1, false));
  assert.equal(sent.length, sentAfterRead);
  assert.equal(await client.saveProfile(0x2a, 1, true), true);
  assert.ok(sent.some((packet) => packet.data[2] === 0x2a && packet.data[3] === 1));
  // Cache cleared: the next readStatus re-sends the version probe.
  await client.readStatus();
  assert.ok(sent.filter((packet) => packet.data[2] === 0x01).length >= 2);
});

test("single-key color and reset send the live-verified RGB-direct shapes", async () => {
  const { device, sent } = fakeWooting();
  const client = new WootingHidClient(device);

  assert.equal(await client.setSingleKeyColor(0, 255, 0, 0), true);
  assert.ok(sent.some((packet) => packet.data[2] === 0x1e));
  assert.equal(await client.resetRgb(0), true);
  assert.ok(sent.some((packet) => packet.data[2] === 0x1f));
  assert.equal(await client.resetRgb(), true);
  assert.ok(sent.some((packet) => packet.data[2] === 0x20));
});

test("setRgbBuffer pushes the v3 report to index 5", async () => {
  const { device, sentReports } = fakeWooting();
  const client = new WootingHidClient(device);

  const colors = new Uint8Array(6 * 21 * 2).fill(0x7f);
  assert.deepEqual(await client.setRgbBuffer(colors), { applied: true });
  assert.equal(sentReports.length, 1);
  assert.equal(sentReports[0]?.reportId, 5);
  assert.deepEqual([...(sentReports[0]?.data.subarray(0, 3) ?? [])], [0xd1, 0xda, 11]);
});

test("keypress-shaped input reports never resolve a pending command read", async () => {
  // Fire a plain keyboard/boot report (no magic word) plus a reply echoing
  // a DIFFERENT command mid-walk: with the command-id filter neither may be
  // mistaken for the version reply, so the version still decodes.
  const { device, fireInput } = fakeWooting();
  const client = new WootingHidClient(device);
  await client.open();
  const pending = client.readStatus().then((status) => status.firmwareVersion);
  fireInput(new Uint8Array([0x00, 0x04, 0x14]));
  fireInput(new Uint8Array([0xd1, 0xda, 0x13, 0x88, 0x07, 0x00]));
  assert.equal(await pending, "2.13.0");
});
