import assert from "node:assert/strict";
import test from "node:test";

import { WuqueHidClient } from "./hid.ts";
import { deviceBrand } from "../registry.ts";
import { SUPPORTED_HID_FILTERS } from "../vendors.ts";
import { WUQUE_CONFIG_USAGE_PAGE, WUQUE_VENDOR_ID } from "@openmouse/keyboard-protocol/wuque";

/** Answer for one `(group, subCommand)` pair: bytes, a builder, or a failure mode. */
type FakeAnswer = number[] | ((frame: Uint8Array) => number[]) | "silent" | "unsupported" | "throw";

interface FakeOptions {
  /** Answers keyed by `"<group>:<subCommand>"`. Missing key = silent. */
  answers?: Record<string, FakeAnswer>;
  vendorId?: number;
  productId?: number;
  usagePage?: number;
  usage?: number;
  /** Junk reports emitted before every real answer (boot-keyboard chatter etc.). */
  noise?: number[][];
}

function pad(bytes: readonly number[]): Uint8Array {
  const out = new Uint8Array(64);
  bytes.forEach((value, index) => (out[index] = value));
  return out;
}

/**
 * Fake Wuque board. Reply bytes are the ones captured from a real BABAO60 HE so
 * the driver is exercised against the wire, not against invented data.
 */
function fakeWuque({
  answers = {},
  vendorId = WUQUE_VENDOR_ID,
  productId = 0x1b10,
  usagePage = WUQUE_CONFIG_USAGE_PAGE,
  usage = 1,
  noise = [],
}: FakeOptions = {}) {
  const listeners = new Set<(event: HIDInputReportEvent) => void>();
  const sent: Uint8Array[] = [];
  const emit = (bytes: Uint8Array) => {
    const event = { reportId: 0, data: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
    for (const listener of listeners) listener(event as HIDInputReportEvent);
  };
  const device = {
    vendorId,
    productId,
    productName: "BABAO60 HE",
    collections: [{ usagePage, usage, type: "vendor", children: [] }],
    opened: false,
    async open() {
      this.opened = true;
    },
    async close() {
      this.opened = false;
    },
    async sendReport(_reportId: number, data: BufferSource) {
      const view = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const bytes = Uint8Array.from(view);
      sent.push(bytes);
      const answer = answers[`${bytes[0]}:${bytes[1]}`];
      if (answer === "throw") throw new Error("send failed");
      for (const junk of noise) emit(pad(junk));
      if (answer === undefined || answer === "silent") return;
      if (answer === "unsupported") {
        emit(pad([bytes[0]!, 0xff]));
        return;
      }
      emit(pad(typeof answer === "function" ? answer(bytes) : answer));
    },
    addEventListener(type: string, listener: (event: HIDInputReportEvent) => void) {
      if (type === "inputreport") listeners.add(listener);
    },
    removeEventListener(type: string, listener: (event: HIDInputReportEvent) => void) {
      if (type === "inputreport") listeners.delete(listener);
    },
  };
  return { device: device as unknown as HIDDevice, sent };
}

/** Hardware reply bytes with a synthetic serial, per `(group, subCommand)`. */
const HARDWARE: Record<string, FakeAnswer> = {
  "1:1": [1, 1, 1, 2, 1, 0],
  "1:2": [
    1, 2, 1, 0, 0, 0x1b, 0, 0x10, 2, 1, 1, 0, 1, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    11, 12, 0x32, 0x30, 0x32, 0x36, 0x30, 0x39, 0x31, 0x35, 0x31, 0x34, 0x3a, 0x32, 0x31, 0x3a, 0x33, 0x32,
  ],
  "1:3": [1, 3, 2, 1, 1, 0],
  "2:3": [2, 3, 1, 0],
  "2:4": [2, 4, 1, 0],
  // `[2,5]` answers the advertised list for ReadList and the live rate for Read.
  "2:5": (frame) => (frame[2] === 0 ? [2, 5, 0, 6, 0, 1, 2, 3, 4, 5] : [2, 5, 1, 0]),
  "2:8": [2, 8, 0, 1, 0, 20, 6, 15],
  "2:10": [2, 10, 0, 0],
  "2:11": [2, 11, 0, 2],
  "2:12": [2, 12, 0, 1, 1],
  "2:13": [2, 13, 1, 0, 0],
  "2:14": [2, 14, 0, 16, 0xc0, 3],
  "2:16": [2, 16, 1, 1],
  "3:1": (frame) => [
    3, 1, frame[2]!, frame[3]!,
    ...Array.from({ length: 42 }, (_, index) => (frame[3] === 1 && index === 0 ? 0x29 : 0)),
  ],
  "3:3": (frame) => [
    3, 3, frame[2]!, frame[3]!, frame[4]!,
    frame[2] === 0 && frame[3] === 1 && frame[4] === 0 ? 0x29 : 0,
    0,
  ],
  "3:4": (frame) => [3, 4, frame[2]!, frame[3]!, frame[4]!, frame[5]!, frame[6]!],
  "4:1": [4, 1, 1, 0, 0, 0xd0, 7, 0xd0, 7, 0xf4, 1, 0x2c, 1, 0x2c, 1, 0xc8, 0, 0xc8, 0, 0, 0, 0xb0, 0x37, 0x7a, 0x0d, 0x80, 0x55],
  "5:1": [5, 1, 0, 0, 1, 0x11, 0x50, 0x28, 0, 7],
  "5:3": (frame) => [5, 3, frame[2]!, frame[3]!, ...Array.from({ length: 15 * 4 }, (_, index) => (index % 4 === 3 ? 0 : 1))],
  "7:1": [7, 1, 0, 1, 3, 0, 0, 0, 0],
  "7:3": (frame) => [7, 3, frame[2]!, frame[3]!, 4, 0, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "10:1": [10, 1, 0, 0],
  "16:1": "unsupported",
  "18:1": "unsupported",
};

test("isSupported matches the vendor config collection only", () => {
  const { device } = fakeWuque();
  assert.equal(WuqueHidClient.isSupported(device), true);
  assert.equal(WuqueHidClient.isSupported(fakeWuque({ vendorId: 0x1234 }).device), false);
  assert.equal(WuqueHidClient.isSupported(fakeWuque({ productId: 0x1b11 }).device), false);
  assert.equal(WuqueHidClient.isSupported(fakeWuque({ usagePage: 0xff53 }).device), false);
  assert.equal(WuqueHidClient.isSupported(fakeWuque({ usage: 6 }).device), false);
  // Product ids are per-vendor: the 80 HE id must not match the 60 HE vendor.
  assert.equal(WuqueHidClient.isSupported(fakeWuque({ productId: 0x75d4 }).device), false);
  assert.equal(WuqueHidClient.isSupported(fakeWuque({ vendorId: 0x36b5, productId: 0x75d4 }).device), true);
  assert.equal(WuqueHidClient.isSupported(fakeWuque({ vendorId: 0x36b5, productId: 0x1b10 }).device), false);
});

test("discovery filters pair each product id with its own vendor id", () => {
  const pairs = SUPPORTED_HID_FILTERS.filter((filter) => filter.usagePage === WUQUE_CONFIG_USAGE_PAGE).map(
    (filter) => `${filter.vendorId.toString(16)}:${filter.productId!.toString(16)}`,
  );
  // Numeric product-id keys sort ascending, so the filter order is stable.
  assert.deepEqual(pairs, ["1ca6:1b09", "1ca6:1b0a", "1ca6:1b10", "36b5:75d2", "36b5:75d4"]);
});

test("readStatus reports the board identity captured on hardware", async () => {
  const { device } = fakeWuque({ answers: HARDWARE });
  const client = new WuqueHidClient(device);
  const status = await client.readStatus();
  assert.equal(status.brand, "Wuque Studio");
  assert.equal(status.name, "BABAO60 HE");
  assert.equal(status.firmwareVersion, "1.2.1.0");
  assert.equal(status.serial, "123456789101112");
  assert.equal(status.connectionType, "Wired");
  assert.equal(status.activeProfile, 0);
  assert.equal(status.profileCount, 4);
  assert.equal(status.wuque?.device.info?.appVersion, "2.1.1.0");
  assert.equal(status.wuque?.device.feature?.axisType.magnetic, true);
  assert.equal(status.wuque?.global.systemType, 0);
  assert.equal(status.wuque?.global.reportRates.length, 6);
  assert.equal(status.wuque?.global.macroSpace?.macroCount, 16);
  assert.equal(status.wuque?.global.blackout, false);
  // The 60 HE firmware does not implement the USB-mode group.
  assert.equal(status.wuque?.global.usbMode, null);
  assert.equal(deviceBrand(client), "Wuque Studio");
});

test("input reports that do not echo the command are ignored", async () => {
  // Boot-keyboard chatter and another command's reply arrive first; the waiter
  // must keep waiting for the frame it actually sent.
  const { device } = fakeWuque({
    answers: HARDWARE,
    noise: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [1, 2, 9, 9, 9, 9],
    ],
  });
  const client = new WuqueHidClient(device);
  assert.deepEqual(await client.readDeviceProtocol(), {
    mainVersion: 1,
    subVersion: 2,
    hardwareVersion: 1,
    softwareVersion: 0,
  });
});

test("unsupported commands resolve to null instead of failing", async () => {
  const { device } = fakeWuque({ answers: HARDWARE });
  const client = new WuqueHidClient(device);
  assert.equal(await client.readUsbModeStatus(), null);
  assert.equal(await client.readKeyboardMode(), null);
});

test("a silent board times out to null", async () => {
  const { device } = fakeWuque({ answers: { ...HARDWARE, "2:4": "silent" } });
  const client = new WuqueHidClient(device);
  assert.equal(await client.readSystemSetting(), null);
});

test("a keycode write is only reported as success when the board echoes it", async () => {
  const { device, sent } = fakeWuque({ answers: HARDWARE });
  const client = new WuqueHidClient(device);
  assert.equal(await client.writeKeyCode(0, 1, 0, 0x29), true);
  assert.deepEqual(Array.from(sent.at(-1)!.slice(0, 7)), [3, 4, 0, 1, 0, 0x29, 0]);

  const mismatched = fakeWuque({
    answers: { ...HARDWARE, "3:4": [3, 4, 0, 1, 0, 0x04, 0] },
  });
  const other = new WuqueHidClient(mismatched.device);
  await assert.rejects(() => other.writeKeyCode(0, 1, 0, 0x29), /not confirmed/);
});

test("key layout fills every matrix slot and lighting walks all custom pages", async () => {
  const { device } = fakeWuque({ answers: HARDWARE });
  const client = new WuqueHidClient(device);
  const layout = await client.readKeyLayout(0);
  assert.equal(layout.rows.length, 6);
  assert.equal(layout.rows[0]!.length, 21);
  assert.equal(layout.rows[0]![0], 0);
  assert.equal(layout.rows[1]![0], 41);

  const custom = await client.readLightingCustom(0);
  assert.equal(custom.length, 9 * 15);
  assert.deepEqual(custom[0], { b: 1, g: 1, r: 1, isCustom: false });
});

test("macro reads page events up to actNum", async () => {
  const { device } = fakeWuque({ answers: HARDWARE });
  const client = new WuqueHidClient(device);
  const macro = await client.readMacro(0);
  assert.equal(macro?.header.actNum, 3);
  assert.equal(macro?.events.length, 3);
  assert.deepEqual(macro?.events[0], { status: 0, delay: 15, keyCode: 4 });
});

test("polling rates come from the board's own list", async () => {
  const { device } = fakeWuque({ answers: HARDWARE });
  const client = new WuqueHidClient(device);
  assert.deepEqual(await client.readReportRates(), ["r8khz", "r4khz", "r2khz", "r1khz", "r500hz", "r250hz"]);
  assert.equal(await client.readReportRate(), "r8khz");
});

test("performance and axis reads decode the fixed-point fields", async () => {
  const { device } = fakeWuque({ answers: HARDWARE });
  const client = new WuqueHidClient(device);
  const performance = await client.readPerformance(1, 0);
  assert.equal(performance?.normalPressMm, 2);
  assert.equal(performance?.rtPressMm, 0.3);
});

test("config switch confirms the live slot and rejects a different read-back", async () => {
  let slot = 0;
  const good = fakeWuque({ answers: { '2:3': frame => { if (frame[2] === 2) slot = frame[3]!; return [2, 3, frame[2]!, slot]; } } });
  const client = new WuqueHidClient(good.device);
  await client.writeConfigSwitch(2);
  assert.equal((await client.readConfigSwitch())?.value, 2);
  await assert.rejects(client.writeConfigSwitch(4), RangeError);
  const bad = fakeWuque({ answers: { '2:3': frame => [2, 3, frame[2]!, frame[2] === 2 ? frame[3]! : 0] } });
  await assert.rejects(new WuqueHidClient(bad.device).writeConfigSwitch(2), /not confirmed/);
});

test("ADC samples are fresh while static reads remain cached until refresh", async () => {
  let sample = 2235;
  const { device, sent } = fakeWuque({ answers: { '4:3': frame => [4, 3, frame[2]!, frame[3]!, sample & 255, sample++ >> 8], '2:3': [2, 3, 1, 0] } });
  const client = new WuqueHidClient(device);
  assert.equal((await client.readAxisAdc(1))?.data[0], 2235);
  assert.equal((await client.readAxisAdc(1))?.data[0], 2236);
  await client.readConfigSwitch(); await client.readConfigSwitch();
  assert.equal(sent.filter(frame => frame[0] === 2).length, 1);
  client.invalidateReadCache(); await client.readConfigSwitch();
  assert.equal(sent.filter(frame => frame[0] === 2).length, 2);
});

test("direct-drive send failures propagate even though the protocol has no reply", async () => {
  const { device } = fakeWuque({ answers: { '5:5': 'throw' } });
  await assert.rejects(new WuqueHidClient(device).writeLightingDirectDrive(0, [{ r: 0, g: 0, b: 0 }]), /send failed/);
});

test("a matching keycode echoed for another coordinate is rejected", async () => {
  const { device } = fakeWuque({ answers: { '3:4': [3, 4, 0, 1, 1, 4, 0] } });
  await assert.rejects(new WuqueHidClient(device).writeKeyCode(0, 1, 0, 4), /not confirmed/);
});
