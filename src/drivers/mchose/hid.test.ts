import assert from "node:assert/strict";
import test from "node:test";
import { MCHOSE_COMMAND, mchoseChecksum } from "../../mchose/index.ts";
import { MchoseKeyboardHidClient } from "./hid.ts";
import { createSupportedClient, deviceBrand } from "../registry.ts";
import { MCHOSE_HID_FILTERS, SUPPORTED_HID_FILTERS, VENDOR_ID } from "../vendors.ts";

const RECORD = [0xa0, 0x01, 0x1e, 0x00, 0x09, 0x1e, 0x0c, 0x1e];
const INFO = [0x16, 0x01, ..."Nov  8 2025,16:25:57GL8KH-PRO"].map((c) => typeof c === "string" ? c.charCodeAt(0) : c);

/** An Ace 68 Air III that serves and stores the documented memory regions. */
class FakeMchoseKeyboard {
  vendorId = 0x41e4;
  productId = 0x2132;
  productName = "Ace 68 Air";
  opened = false;
  collections: HIDCollectionInfo[] = [{ usagePage: 0x0001, usage: 0x0000, inputReports: [], outputReports: [], featureReports: [], children: [] }];
  listeners = new Set<(event: HIDInputReportEvent) => void>();
  sent: Uint8Array[] = [];
  /** Factory resets asked for, by target byte (255 is the whole keyboard). */
  resets: number[] = [];
  info = INFO;
  base = [1, 3, 0, 1, 2, 3, 0xaa, 0xbb, ...new Array(48).fill(0xa2)];
  config = Array.from({ length: 4 }, (_, profile) => [0x50, 4 * profile, 0xaa, 0xbb, 0x01, 0x01, 0, 0x06, ...new Array(56).fill(0x10)]);
  travel = Array.from({ length: 4 }, () => Array.from({ length: 128 }, () => RECORD).flat());
  defaults = Array.from({ length: 128 }, (_, slot) => slot === 4 ? [0x10, 0, 0x14] : slot === 0 ? [0x10, 0, 0x08] : [0, 0, 0]).flat();
  keymap = Array.from({ length: 2048 * 4 }, () => 0);
  colors = Array.from({ length: 512 * 4 }, () => 0);
  macros = [...Array.from({ length: 16 }, () => [0x40, 0]).flat(), 0x81, 0x7e, ...new Array(30).fill(0), 0, 0, 0x80, 0, ...new Array(8192 - 68).fill(0)];
  dks = new Array(768 * 4).fill(0);
  modTap = new Array(256 * 4).fill(0);
  toggle = new Array(128 * 4).fill(0);
  custom = new Array(1024 * 4).fill(0xff);
  calibration: number[] = [];
  silent = false;
  /** Answer this command with this many bytes instead of what was asked (models a short reply). */
  shortReply: { command: number; size: number } | null = null;
  /** Drop this many frames before answering again (models a slow flash write). */
  dropNext = 0;
  forgetWrites = false;
  get hid(): HIDDevice { return this as unknown as HIDDevice; }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  addEventListener(_type: string, listener: (event: HIDInputReportEvent) => void) { this.listeners.add(listener); }
  removeEventListener(_type: string, listener: (event: HIDInputReportEvent) => void) { this.listeners.delete(listener); }
  private region(command: number, offset: number): { bytes: number[]; at: number } {
    switch (command) {
      case MCHOSE_COMMAND.getInfo: return { bytes: this.info, at: offset };
      case MCHOSE_COMMAND.getBase: case MCHOSE_COMMAND.setBase: return { bytes: this.base, at: offset };
      case MCHOSE_COMMAND.getFuncConfig: case MCHOSE_COMMAND.setFuncConfig: return { bytes: this.config[offset >> 6]!, at: offset & 63 };
      case MCHOSE_COMMAND.getDefaultKeymap: return { bytes: this.defaults, at: offset };
      case MCHOSE_COMMAND.getKeymap: case MCHOSE_COMMAND.setKeymap: return { bytes: this.keymap, at: offset };
      case MCHOSE_COMMAND.getKeyColors: case MCHOSE_COMMAND.setKeyColors: return { bytes: this.colors, at: offset };
      case MCHOSE_COMMAND.getMacros: case MCHOSE_COMMAND.setMacros: return { bytes: this.macros, at: offset };
      case MCHOSE_COMMAND.getDks: case MCHOSE_COMMAND.setDks: return { bytes: this.dks, at: offset };
      case MCHOSE_COMMAND.getModTap: case MCHOSE_COMMAND.setModTap: return { bytes: this.modTap, at: offset };
      case MCHOSE_COMMAND.getToggle: case MCHOSE_COMMAND.setToggle: return { bytes: this.toggle, at: offset };
      case MCHOSE_COMMAND.getCustomData: case MCHOSE_COMMAND.setCustomData: return { bytes: this.custom, at: offset };
      case MCHOSE_COMMAND.startCalibration: case MCHOSE_COMMAND.endCalibration: case MCHOSE_COMMAND.restartCalibration:
        return { bytes: [0], at: 0 };
      default: return { bytes: this.travel[offset >> 10]!, at: offset & 1023 };
    }
  }
  async sendReport(reportId: number, data: BufferSource) {
    const frame = new Uint8Array(data as ArrayBuffer);
    this.sent.push(frame.slice());
    if (this.silent || reportId !== 0 || frame[0] !== 0x55) return;
    if (this.dropNext > 0) { this.dropNext -= 1; return; }
    const command = frame[1]!;
    if (command === MCHOSE_COMMAND.factoryReset) {
      // Echo, then announce the reset the way the keyboard does.
      this.resets.push(frame[8]!);
      const echo = new Uint8Array(64);
      echo.set(frame.slice(0, 9));
      echo[0] = 0xaa;
      echo[3] = mchoseChecksum(echo, frame[4]!);
      const notice = new Uint8Array(64);
      notice[0] = 0xa2;
      for (const bytes of [echo, notice]) {
        queueMicrotask(() => this.listeners.forEach((listener) => listener({ device: this.hid, reportId: 0, data: new DataView(bytes.buffer) } as HIDInputReportEvent)));
      }
      return;
    }
    // Like the hardware, info answers only the bytes it has (31 of the 56 asked for).
    const size = this.shortReply?.command === command ? this.shortReply.size
      : command === MCHOSE_COMMAND.getInfo ? Math.min(frame[4]!, this.info.length) : frame[4]!;
    const offset = frame[5]! | (frame[6]! << 8);
    const region = this.region(command, offset);
    const writing = [MCHOSE_COMMAND.setBase, MCHOSE_COMMAND.setFuncConfig, MCHOSE_COMMAND.setKeyTravel, MCHOSE_COMMAND.setKeymap,
      MCHOSE_COMMAND.setKeyColors, MCHOSE_COMMAND.setMacros, MCHOSE_COMMAND.setDks, MCHOSE_COMMAND.setModTap, MCHOSE_COMMAND.setToggle,
      MCHOSE_COMMAND.setCustomData, MCHOSE_COMMAND.startCalibration, MCHOSE_COMMAND.endCalibration, MCHOSE_COMMAND.restartCalibration,
    ].includes(command as never);
    if (command >= MCHOSE_COMMAND.startCalibration && command <= MCHOSE_COMMAND.endCalibration || command === MCHOSE_COMMAND.restartCalibration) this.calibration.push(command);
    const reply = new Uint8Array(64);
    reply.set(frame.slice(0, 8));
    reply[0] = 0xaa;
    reply[4] = size;
    if (writing) {
      reply.set(frame.slice(8, 8 + size), 8);
      if (!this.forgetWrites) region.bytes.splice(region.at, size, ...frame.slice(8, 8 + size));
    } else {
      reply.set(Array.from({ length: size }, (_, i) => region.bytes[region.at + i] ?? 0), 8);
    }
    reply[3] = mchoseChecksum(reply, size);
    queueMicrotask(() => {
      const event = { device: this.hid, reportId: 0, data: new DataView(reply.buffer) } as HIDInputReportEvent;
      this.listeners.forEach((listener) => listener(event));
    });
  }
  writes(command: number): Uint8Array[] { return this.sent.filter((frame) => frame[1] === command); }
}

test("recognises the Air III vendor collection and registers filters", () => {
  const fake = new FakeMchoseKeyboard();
  assert.ok(MchoseKeyboardHidClient.isSupported(fake.hid));
  const client = createSupportedClient(fake.hid);
  assert.ok(client instanceof MchoseKeyboardHidClient);
  assert.equal(deviceBrand(client!), "MCHOSE");
  assert.equal(VENDOR_ID.mchose, 0x41e4);
  assert.deepEqual(MCHOSE_HID_FILTERS[0], { vendorId: 0x41e4, productId: 0x2132, usagePage: 1, usage: 0 });
  assert.ok(SUPPORTED_HID_FILTERS.some((filter) => filter.vendorId === 0x41e4));
  const keyboardCollection = new FakeMchoseKeyboard();
  keyboardCollection.collections = [{ ...keyboardCollection.collections[0]!, usage: 6 }];
  assert.ok(!MchoseKeyboardHidClient.isSupported(keyboardCollection.hid), "the boot keyboard collection is not the config channel");
  const other = new FakeMchoseKeyboard();
  other.productId = 0x9999;
  assert.ok(!MchoseKeyboardHidClient.isSupported(other.hid));
});

test("readStatus reads identity, the active profile, performance and key travel", async () => {
  const fake = new FakeMchoseKeyboard();
  const status = await new MchoseKeyboardHidClient(fake.hid).readStatus();
  assert.equal(status.brand, "MCHOSE");
  assert.equal(status.name, "Ace 68 Air III");
  assert.equal(status.firmwareVersion, "116");
  assert.deepEqual(status.firmware, ["Firmware: 116", "Controller: GL8KH-PRO", "Built: Nov 8 2025,16:25:57"]);
  assert.equal(status.activeProfile, 1);
  assert.equal(status.profileCount, 3);
  assert.equal(status.mchose?.performance?.pollingHz, 8000);
  assert.equal(status.mchose?.travel?.length, 128);
  assert.equal(status.mchose?.travel?.[0]?.actuation, 31);
  // Travel and config are read for the active profile only.
  assert.ok(fake.writes(MCHOSE_COMMAND.getKeyTravel).every((frame) => (frame[5]! | (frame[6]! << 8)) >= 1024));
  assert.equal(fake.writes(MCHOSE_COMMAND.getFuncConfig)[0]![5], 64);
});

test("key travel edits write only the changed window and are read back", async () => {
  const fake = new FakeMchoseKeyboard();
  const client = new MchoseKeyboardHidClient(fake.hid);
  const keys = await client.setKeyTravel(1, [{ index: 0, actuation: 150, rapidTrigger: false }]);
  assert.equal(keys[0]!.actuation, 150);
  assert.equal(keys[0]!.keyMode, 0);
  assert.equal(keys[1]!.actuation, 31, "other keys keep their values");
  const writes = fake.writes(MCHOSE_COMMAND.setKeyTravel);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]![5]! | (writes[0]![6]! << 8), 1024);
  assert.deepEqual(fake.travel[0]!.slice(0, 8), RECORD, "other profiles are untouched");
  assert.deepEqual(fake.travel[1]!.slice(0, 8), [0xa0, 0x00, 149, 0x00, 0x09, 0x1e, 0x0c, 0x1e]);
});

test("an out-of-range edit is rejected before anything is written", async () => {
  const fake = new FakeMchoseKeyboard();
  const client = new MchoseKeyboardHidClient(fake.hid);
  await assert.rejects(client.setKeyTravel(1, [{ index: 0, actuation: 400 }]), RangeError);
  await assert.rejects(client.setKeyTravel(1, [{ index: 200, actuation: 100 }]), RangeError);
  await assert.rejects(client.setKeyTravel(4, [{ index: 0, actuation: 100 }]), RangeError);
  assert.equal(fake.writes(MCHOSE_COMMAND.setKeyTravel).length, 0);
  // A rejected argument does not fault the session.
  assert.equal((await client.readKeyTravel(1)).length, 128);
});

test("polling rate and Windows lock rewrite one profile's config and confirm it", async () => {
  const fake = new FakeMchoseKeyboard();
  const client = new MchoseKeyboardHidClient(fake.hid);
  assert.equal((await client.setPollingRate(1, 1000)).pollingHz, 1000);
  assert.equal(fake.config[1]![4], 0x04);
  assert.equal(fake.config[0]![4], 0x01, "other profiles are untouched");
  const writes = fake.writes(MCHOSE_COMMAND.setFuncConfig);
  assert.deepEqual(writes.map((frame) => [frame[4], frame[5]]), [[56, 64], [56, 72]]);
  assert.equal((await client.setWinLock(1, true)).lockWin, true);
  await assert.rejects(client.setPollingRate(1, 16000), RangeError);
});

test("debug mode streams key reports to listeners while replies still resolve", async () => {
  const fake = new FakeMchoseKeyboard();
  const client = new MchoseKeyboardHidClient(fake.hid);
  await client.setDebugMode(1, true);
  assert.equal(fake.config[1]![7], 0x06 | 8);
  assert.equal(fake.config[0]![7], 0x06, "other profiles are untouched");
  const seen: unknown[] = [];
  const stop = client.onKeyReport((report) => seen.push(report));
  const report = new Uint8Array(64);
  report.set([0xa0, 0x10, 0x00, 0x14, 0, 0, 0x00, 0x40, 0, 0, 0xff]);
  const send = () => fake.listeners.forEach((listener) => listener({ device: fake.hid, reportId: 0, data: new DataView(report.buffer) } as HIDInputReportEvent));
  send();
  await client.setDebugMode(1, false);
  stop();
  send();
  assert.deepEqual(seen, [{ type: 0x10, code1: 0, code2: 0x14, travel: 64, calibration: "done" }]);
  assert.equal(fake.config[1]![7], 0x06);
});

test("switching profile writes the order position and reads it back", async () => {
  const fake = new FakeMchoseKeyboard();
  const client = new MchoseKeyboardHidClient(fake.hid);
  assert.equal((await client.setActiveProfile(2)).activeProfile, 2);
  assert.equal(fake.base[0], 2);
  await assert.rejects(client.setActiveProfile(3), RangeError);
});

test("a write the keyboard does not keep is reported", async () => {
  const fake = new FakeMchoseKeyboard();
  fake.forgetWrites = true;
  await assert.rejects(new MchoseKeyboardHidClient(fake.hid).setPollingRate(1, 1000), /did not retain/);
});

test("a silent keyboard times out and faults the session", async () => {
  const fake = new FakeMchoseKeyboard();
  fake.silent = true;
  const client = new MchoseKeyboardHidClient(fake.hid);
  await assert.rejects(client.readInfo(), /did not answer/);
  fake.silent = false;
  await assert.rejects(client.readInfo(), /Reconnect/);
});

test("readStatus resolves the layout from the keyboard's default keymap", async () => {
  const status = await new MchoseKeyboardHidClient(new FakeMchoseKeyboard().hid).readStatus();
  const layout = status.mchose!.layout!;
  assert.equal(layout.find((key) => key.label === "Q")!.index, 4);
  assert.equal(layout.find((key) => key.label === "E")!.index, 0);
  assert.equal(status.mchose!.settings!.bottomRapidTrigger, true);
});

test("keymap writes touch only their layer and are read back", async () => {
  const fake = new FakeMchoseKeyboard();
  const client = new MchoseKeyboardHidClient(fake.hid);
  const keys = await client.setKeymap(1, 2, [{ index: 5, action: { type: 0x10, code1: 1, code2: 0x06 } }]);
  assert.deepEqual(keys[5], { type: 0x10, code1: 1, code2: 0x06 });
  assert.deepEqual(fake.keymap.slice(512 * 6 + 15, 512 * 6 + 18), [0x10, 1, 0x06]);
  const frames = fake.writes(MCHOSE_COMMAND.setKeymap);
  assert.equal(frames.length, 1);
  assert.equal(frames[0]![4], 54, "windows hold whole 3-byte actions");
  await assert.rejects(client.setKeymap(1, 4, []), RangeError);
});

test("macros round-trip through the 8 KB region", async () => {
  const fake = new FakeMchoseKeyboard();
  const client = new MchoseKeyboardHidClient(fake.hid);
  const macros = await client.readMacros();
  assert.ok(macros.every((macro) => macro.steps.length === 0));
  macros[0] = { mode: 1, steps: [{ kind: "key", code: 0x04, down: true, delayMs: 20 }, { kind: "key", code: 0x04, down: false, delayMs: 0 }] };
  const saved = await client.setMacros(macros);
  assert.deepEqual(saved[0], macros[0]);
});

test("advanced-key slots, colours, names and calibration", async () => {
  const fake = new FakeMchoseKeyboard();
  const client = new MchoseKeyboardHidClient(fake.hid);
  await client.setModTap(1, 31, { tap: { type: 0x10, code1: 0, code2: 0x29 }, hold: { type: 0x10, code1: 1, code2: 0 } });
  await client.setToggle(1, 0, { type: 0x10, code1: 0, code2: 0x2c });
  const advanced = await client.readAdvancedKeys(1);
  assert.equal(advanced.modTap[31]!.hold.code1, 1);
  assert.equal(advanced.toggle[0]!.code2, 0x2c);
  await client.clearSlot(1, "modTap", 31);
  assert.deepEqual((await client.readAdvancedKeys(1)).modTap[31], { tap: { type: 0, code1: 0, code2: 0 }, hold: { type: 0, code1: 0, code2: 0 } });
  const colors = await client.setKeyColors(1, [{ index: 3, color: { r: 1, g: 2, b: 3 } }]);
  assert.deepEqual(colors[3], { r: 1, g: 2, b: 3 });
  const names = await client.setProfileName(2, "Aim");
  assert.equal(names[2], "Aim");
  assert.deepEqual(fake.writes(MCHOSE_COMMAND.setCustomData).map((frame) => frame[4]), [56], "only the frames the JSON needs");
  await client.calibrate("start");
  await client.calibrate("end");
  assert.deepEqual(fake.calibration, [MCHOSE_COMMAND.startCalibration, MCHOSE_COMMAND.endCalibration]);
});

test("a slow frame is sent again instead of faulting the session", async () => {
  const fake = new FakeMchoseKeyboard();
  const client = new MchoseKeyboardHidClient(fake.hid);
  fake.dropNext = 2;
  assert.equal((await client.readInfo()).firmwareVersion, "116");
  assert.equal(fake.writes(MCHOSE_COMMAND.getInfo).length, 3);
});

test("a short reply to a config read ends the session before anything is written", async () => {
  const fake = new FakeMchoseKeyboard();
  fake.shortReply = { command: MCHOSE_COMMAND.getFuncConfig, size: 0 };
  const client = new MchoseKeyboardHidClient(fake.hid);
  await assert.rejects(client.setPollingRate(1, 1000), /answered command 0x5 with 0 of 56/);
  assert.equal(fake.writes(MCHOSE_COMMAND.setFuncConfig).length, 0);
  await assert.rejects(client.readInfo(), /Reconnect/);
});

test("an empty echo is not taken as a write", async () => {
  const fake = new FakeMchoseKeyboard();
  fake.shortReply = { command: MCHOSE_COMMAND.startCalibration, size: 0 };
  await assert.rejects(new MchoseKeyboardHidClient(fake.hid).calibrate("start"), /did not echo/);
});

test("advanced-key slots stop at 32", async () => {
  const client = new MchoseKeyboardHidClient(new FakeMchoseKeyboard().hid);
  await assert.rejects(client.setModTap(1, 32, { tap: { type: 0, code1: 0, code2: 0 }, hold: { type: 0, code1: 0, code2: 0 } }), RangeError);
  await assert.rejects(client.clearSlot(1, "modTap", 42), RangeError);
});

test("factory reset targets one profile or the whole keyboard and waits for the notice", async () => {
  const fake = new FakeMchoseKeyboard();
  const client = new MchoseKeyboardHidClient(fake.hid);
  await client.factoryReset(2);
  await client.factoryReset("all");
  assert.deepEqual(fake.resets, [2, 255]);
  await assert.rejects(client.factoryReset(9), RangeError);
  fake.silent = true;
  await assert.rejects(client.readBase(), /did not answer/);
  await assert.rejects(client.factoryReset(0), /Reconnect/, "a faulted session reports the failure instead of waiting for a reboot");
  assert.deepEqual(fake.resets, [2, 255]);
});
