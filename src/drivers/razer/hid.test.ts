import assert from "node:assert/strict";
import test from "node:test";

import { RazerKeyboardHidClient } from "./hid.ts";
import { RAZER_REPORT_LENGTH, RAZER_STATUS, RAZER_VENDOR_ID } from "@openmouse/keyboard-protocol/razer";

const text = (value: string): number[] => [...Buffer.from(value, "ascii")];

function reply(status: number, commandClass: number, commandId: number, args: readonly number[], transactionId = 0x1f): Uint8Array {
  const frame = new Uint8Array(RAZER_REPORT_LENGTH);
  frame[0] = status;
  frame[1] = transactionId;
  frame[5] = args.length;
  frame[6] = commandClass;
  frame[7] = commandId;
  frame.set(args, 8);
  return frame;
}

class FakeRazerKeyboard {
  vendorId = RAZER_VENDOR_ID;
  productId = 0x02a6;
  productName = "Razer Huntsman V3 Pro";
  opened = false;
  collections = [{ usagePage: 0x0001, usage: 0x0002, inputReports: [], outputReports: [], featureReports: [], children: [] }];
  brightness = 200;
  rejectExtendedEffect = false;
  pollingCode = 0x01;
  gameModeLed = false;
  ignoreGameModeWrites = false;
  denyFeatureReads: DOMException | null = null;
  writes: { transactionId: number; commandClass: number; commandId: number; args: number[] }[] = [];
  private listeners = new Set<(event: HIDInputReportEvent) => void>();
  private nextReply: Uint8Array | null = null;

  async open(): Promise<void> { this.opened = true; }
  async close(): Promise<void> { this.opened = false; }
  addEventListener(_type: "inputreport", listener: (event: HIDInputReportEvent) => void): void { this.listeners.add(listener); }
  removeEventListener(_type: "inputreport", listener: (event: HIDInputReportEvent) => void): void { this.listeners.delete(listener); }
  async sendReport(): Promise<void> { throw new Error("Razer test device does not take output reports."); }

  async sendFeatureReport(_reportId: number, source: BufferSource): Promise<void> {
    const data = source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    const transactionId = data[1] ?? 0;
    const commandClass = data[6] ?? 0;
    const commandId = data[7] ?? 0;
    const args = [...data.slice(8, 8 + (data[5] ?? 0))];
    this.writes.push({ transactionId, commandClass, commandId, args });
    if (commandClass === 0x00 && commandId === 0x81) {
      this.nextReply = reply(RAZER_STATUS.ok, commandClass, commandId, [0x02, 0x0b]);
    } else if (commandClass === 0x00 && commandId === 0x82) {
      this.nextReply = reply(RAZER_STATUS.ok, commandClass, commandId, [...text("RZ01"), 0]);
    } else if (commandClass === 0x00 && commandId === 0xc0) {
      this.nextReply = reply(RAZER_STATUS.unsupported, commandClass, commandId, []);
    } else if (commandClass === 0x00 && commandId === 0x85) {
      this.nextReply = reply(RAZER_STATUS.ok, commandClass, commandId, [this.pollingCode]);
    } else if (commandClass === 0x00 && commandId === 0x05) {
      this.pollingCode = args[0] ?? 0;
      this.nextReply = reply(RAZER_STATUS.ok, commandClass, commandId, []);
    } else if (commandClass === 0x0f && commandId === 0x84) {
      this.nextReply = reply(RAZER_STATUS.ok, commandClass, commandId, [0x01, 0x05, this.brightness]);
    } else if (commandClass === 0x0f && commandId === 0x04) {
      this.brightness = args[2] ?? 0;
      this.nextReply = reply(RAZER_STATUS.ok, commandClass, commandId, []);
    } else if (commandClass === 0x0f && commandId === 0x02) {
      this.nextReply = reply(this.rejectExtendedEffect ? RAZER_STATUS.unsupported : RAZER_STATUS.ok, commandClass, commandId, []);
    } else if (commandClass === 0x03 && commandId === 0x0a) {
      this.nextReply = reply(RAZER_STATUS.ok, commandClass, commandId, []);
    } else if (commandClass === 0x0f && commandId === 0x03) {
      this.nextReply = reply(RAZER_STATUS.ok, commandClass, commandId, [], transactionId);
    } else if (commandClass === 0x03 && commandId === 0x0b) {
      this.nextReply = reply(RAZER_STATUS.ok, commandClass, commandId, [], transactionId);
    } else if (commandClass === 0x03 && commandId === 0x00) {
      if (!this.ignoreGameModeWrites) this.gameModeLed = args[2] === 1;
      this.nextReply = reply(RAZER_STATUS.ok, commandClass, commandId, [], transactionId);
    } else if (commandClass === 0x03 && commandId === 0x80) {
      this.nextReply = reply(RAZER_STATUS.ok, commandClass, commandId, [args[0] ?? 0, 0x08, this.gameModeLed ? 1 : 0], transactionId);
    } else if (commandClass === 0x02 && (commandId === 0x0d || commandId === 0x12)) {
      this.nextReply = reply(RAZER_STATUS.ok, commandClass, commandId, []);
    } else if (commandClass === 0x02 && commandId === 0x8d) {
      this.nextReply = reply(RAZER_STATUS.ok, commandClass, commandId, [0x01, args[1] ?? 0, 0x00, 0x02, 0x02, 0x00, 0x04]);
    } else if (commandClass === 0x02 && commandId === 0x92) {
      this.nextReply = reply(RAZER_STATUS.ok, commandClass, commandId, [args[0] ?? 0, args[1] ?? 0, args[2] ?? 0, 0x05, 0x05, 0x0c, 0x01, 0x01]);
    } else {
      this.nextReply = reply(RAZER_STATUS.failure, commandClass, commandId, []);
    }
  }

  async receiveFeatureReport(): Promise<DataView> {
    if (this.denyFeatureReads) throw this.denyFeatureReads;
    if (!this.nextReply) throw new Error("No Razer reply prepared.");
    const reply = this.nextReply;
    this.nextReply = null;
    return new DataView(reply.buffer, reply.byteOffset, reply.byteLength);
  }

  emitFirmware(): void {
    const event = { data: new DataView(new ArrayBuffer(0)), reportId: 0, device: this } as unknown as HIDInputReportEvent;
    for (const listener of this.listeners) listener(event);
  }
}

test("the Razer client discovers the transaction id and reads identity, polling and brightness", async () => {
  const device = new FakeRazerKeyboard();
  const client = new RazerKeyboardHidClient(device as unknown as HIDDevice);
  const status = await client.readStatus();
  assert.equal(status.brand, "Razer");
  assert.equal(status.name, "Huntsman V3 Pro");
  assert.equal(status.firmwareVersion, "2.11");
  assert.equal(status.serial, "RZ01");
  assert.equal(status.razer?.pollingRateHz, 1000);
  assert.equal(status.razer?.brightness, 200);
  assert.equal(status.razer?.pollingStyle, "standard");
  assert.equal(status.razer?.brightnessStyle, "extended");
  await client.close();
});

test("setBrightness writes the extended command and confirms by read-back", async () => {
  const device = new FakeRazerKeyboard();
  const client = new RazerKeyboardHidClient(device as unknown as HIDDevice);
  assert.equal(await client.setBrightness(120), 120);
  const write = device.writes.find((entry) => entry.commandClass === 0x0f && entry.commandId === 0x04);
  assert.deepEqual(write?.args, [0x01, 0x05, 120]);
  await client.close();
});

test("setPollingRate writes the standard command when the extended one is unsupported", async () => {
  const device = new FakeRazerKeyboard();
  const client = new RazerKeyboardHidClient(device as unknown as HIDDevice);
  assert.equal(await client.setPollingRate(500), 500);
  const write = device.writes.find((entry) => entry.commandClass === 0x00 && entry.commandId === 0x05);
  assert.deepEqual(write?.args, [0x02]);
  await client.close();
});

test("matrix effects and key bindings use their documented argument layouts", async () => {
  const device = new FakeRazerKeyboard();
  const client = new RazerKeyboardHidClient(device as unknown as HIDDevice);
  await client.setMatrixEffect({ kind: "static", red: 0xff, green: 0x00, blue: 0x10 });
  await client.setStandardBinding(0x1f, { kind: "keyboard", modifiers: 0x02, usage: 0x04 });
  await client.setAnalogBinding(1, 0x1f, false, 0x05, 0x05, { kind: "keyboard", modifiers: 0x00, usage: 0x05 });
  const effect = device.writes.find((entry) => entry.commandClass === 0x0f && entry.commandId === 0x02);
  assert.deepEqual(effect?.args.slice(0, 9), [0x01, 0x05, 0x01, 0x00, 0x00, 0x01, 0xff, 0x00, 0x10]);
  const standard = device.writes.find((entry) => entry.commandClass === 0x02 && entry.commandId === 0x0d);
  assert.deepEqual(standard?.args.slice(0, 7), [0x01, 0x1f, 0x00, 0x02, 0x02, 0x02, 0x04]);
  const analog = device.writes.find((entry) => entry.commandClass === 0x02 && entry.commandId === 0x12);
  assert.deepEqual(analog?.args.slice(0, 10), [0x01, 0x1f, 0x00, 0x05, 0x05, 0x02, 0x03, 0x02, 0x00, 0x05]);
  await client.close();
});

test("matrix effects fall back to the standard command when extended is rejected", async () => {
  const device = new FakeRazerKeyboard();
  device.rejectExtendedEffect = true;
  const client = new RazerKeyboardHidClient(device as unknown as HIDDevice);
  await client.setMatrixEffect({ kind: "static", red: 1, green: 2, blue: 3 });
  assert.ok(device.writes.some((entry) => entry.commandClass === 0x03 && entry.commandId === 0x0a));
  await client.close();
});

test("binding read commands decode the echoed standard and analog records", async () => {
  const device = new FakeRazerKeyboard();
  const client = new RazerKeyboardHidClient(device as unknown as HIDDevice);
  const standard = await client.readStandardBinding(0x1f);
  assert.equal(standard?.key, 0x1f);
  assert.equal(standard?.type, 0x02);
  const analog = await client.readAnalogBinding(1, 0x1f, true);
  assert.equal(analog?.key, 0x1f);
  assert.equal(analog?.fnLayer, true);
  assert.equal(analog?.actuation, 0x05);
  assert.equal(analog?.type, 0x0c);
  await client.close();
});

test("custom matrix rows and activation use only model-evidenced command variants", async () => {
  const device = new FakeRazerKeyboard();
  const client = new RazerKeyboardHidClient(device as unknown as HIDDevice);
  await client.setCustomMatrixRow(2, 4, [[1, 2, 3], [4, 5, 6]]);
  await client.activateCustomMatrix();
  const row = device.writes.find((entry) => entry.commandClass === 0x0f && entry.commandId === 0x03);
  assert.equal(row?.transactionId, 0x1f);
  assert.equal(row?.args.length, 0x47);
  assert.deepEqual(row?.args.slice(0, 11), [0, 0, 2, 4, 5, 1, 2, 3, 4, 5, 6]);
  const activation = device.writes.find((entry) => entry.commandClass === 0x0f && entry.commandId === 0x02);
  assert.equal(activation?.transactionId, 0x1f);
  assert.deepEqual(activation?.args, [0, 0, 8, ...Array(9).fill(0)]);
  await client.close();
});

test("standard custom frame uses 0xff even when firmware discovery replies on 0x1f", async () => {
  const device = new FakeRazerKeyboard();
  device.productId = 0x0237;
  const client = new RazerKeyboardHidClient(device as unknown as HIDDevice);
  await client.setCustomMatrixRow(0, 1, [[0x10, 0x20, 0x30]]);
  await client.activateCustomMatrix();
  const row = device.writes.find((entry) => entry.commandClass === 3 && entry.commandId === 0x0b);
  assert.equal(row?.transactionId, 0xff);
  assert.equal(row?.args.length, 0x46);
  assert.deepEqual(row?.args.slice(0, 7), [0xff, 0, 1, 1, 0x10, 0x20, 0x30]);
  const activation = device.writes.find((entry) => entry.commandClass === 3 && entry.commandId === 0x0a);
  assert.equal(activation?.transactionId, 0xff);
  assert.deepEqual(activation?.args, [5, 0]);
  await client.close();
});

test("game-mode LED uses model storage and its distinct transaction, then checks readback", async () => {
  const device = new FakeRazerKeyboard();
  const client = new RazerKeyboardHidClient(device as unknown as HIDDevice);
  assert.equal(await client.setGameModeLed(true), true);
  assert.equal(await client.readGameModeLed(), true);
  const ledWrites = device.writes.filter((entry) => entry.commandClass === 3 && (entry.commandId === 0 || entry.commandId === 0x80));
  assert.deepEqual(ledWrites.map(({ transactionId, commandId, args }) => [transactionId, commandId, ...args.slice(0, 3)]), [
    [0xff, 0, 1, 8, 1], [0xff, 0x80, 1, 8, 0], [0xff, 0x80, 1, 8, 0],
  ]);
  await client.close();

  const huntsmanV2 = new FakeRazerKeyboard();
  huntsmanV2.productId = 0x026c;
  const v2 = new RazerKeyboardHidClient(huntsmanV2 as unknown as HIDDevice);
  assert.equal(await v2.setGameModeLed(false), false);
  const write = huntsmanV2.writes.find((entry) => entry.commandClass === 3 && entry.commandId === 0);
  assert.equal(write?.transactionId, 0x1f);
  assert.deepEqual(write?.args, [0, 8, 0]);
  await v2.close();
});

test("game-mode LED refuses to report success when its readback disagrees", async () => {
  const device = new FakeRazerKeyboard();
  device.ignoreGameModeWrites = true;
  const client = new RazerKeyboardHidClient(device as unknown as HIDDevice);
  await assert.rejects(client.setGameModeLed(true), /did not confirm/);
  await client.close();
});

test("models outside the enabled subset reject new methods without sending feature commands", async () => {
  const device = new FakeRazerKeyboard();
  device.productId = 0x0235;
  const client = new RazerKeyboardHidClient(device as unknown as HIDDevice);
  await assert.rejects(client.setCustomMatrixRow(0, 0, [[1, 2, 3]]), /not enabled/);
  await assert.rejects(client.activateCustomMatrix(), /not enabled/);
  await assert.rejects(client.readGameModeLed(), /not enabled/);
  await assert.rejects(client.setGameModeLed(true), /not enabled/);
  assert.equal(device.writes.length, 0);
  await client.close();
});

test("a non-keyboard Razer product id is rejected", () => {
  const device = { ...new FakeRazerKeyboard(), productId: 0x00c1 };
  assert.equal(RazerKeyboardHidClient.isSupported(device as unknown as HIDDevice), false);
});

test("a permission denial during discovery is rethrown and faults the client", async () => {
  const device = new FakeRazerKeyboard();
  device.denyFeatureReads = new DOMException("The requested operation was blocked.", "NotAllowedError");
  const client = new RazerKeyboardHidClient(device as unknown as HIDDevice);
  await assert.rejects(client.readFirmware(), (error: unknown) => error instanceof DOMException
    && error.name === "NotAllowedError");
  // The permission error is terminal: the client is faulted, not left probing.
  await assert.rejects(client.readSerial(), /Reconnect the Razer keyboard/);
  await client.close();
});

test("identity reads open a fresh client before exchanging", async () => {
  const device = new FakeRazerKeyboard();
  const client = new RazerKeyboardHidClient(device as unknown as HIDDevice);
  assert.equal(device.opened, false);
  assert.equal(await client.readFirmware(), "2.11");
  assert.equal(await client.readSerial(), "RZ01");
  assert.equal(device.opened, true);
  await client.close();
});
