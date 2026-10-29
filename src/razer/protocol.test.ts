import assert from "node:assert/strict";
import test from "node:test";

import {
  RAZER_KEYBOARD_PRODUCT_IDS,
  RAZER_CUSTOM_MATRIX_SUPPORT,
  RAZER_GAME_MODE_LED_SUPPORT,
  RAZER_KEYBOARD_PRODUCTS,
  RAZER_KEYBOARD_READ,
  RAZER_POLLING_RATES,
  RAZER_REPORT_LENGTH,
  decodeRazerBrightness,
  decodeRazerFirmware,
  decodeRazerPollingCode,
  decodeRazerResponse,
  decodeRazerSerial,
  encodeRazerAnalogBinding,
  encodeRazerCustomMatrixEffect,
  encodeRazerCustomMatrixRow,
  encodeRazerGameModeLed,
  encodeRazerPollingCode,
  encodeRazerRequest,
  razerChecksum,
} from "./index.ts";

const bytes = (values: readonly number[]): Uint8Array => Uint8Array.from(values);

test("a request is a 90-byte frame with the documented header and checksum", () => {
  const frame = encodeRazerRequest(RAZER_KEYBOARD_READ.firmware, 0x1f);
  assert.equal(frame.length, RAZER_REPORT_LENGTH);
  assert.equal(frame[0], 0);
  assert.equal(frame[1], 0x1f);
  assert.equal(frame[2], 0);
  assert.equal(frame[3], 0);
  assert.equal(frame[4], 0);
  assert.equal(frame[5], 0x02);
  assert.equal(frame[6], 0x00);
  assert.equal(frame[7], 0x81);
  assert.equal(frame[88], razerChecksum(frame));
  assert.equal(frame[89], 0);
});

test("the checksum XORs bytes 2..87", () => {
  const frame = Uint8Array.from({ length: RAZER_REPORT_LENGTH }, (_, index) => index);
  const expected = Array.from(frame.slice(2, 88)).reduce((crc, byte) => crc ^ byte, 0);
  assert.equal(razerChecksum(frame), expected);
});

test("a payload larger than the declared data size is rejected", () => {
  assert.throws(() => encodeRazerRequest({ commandClass: 0, commandId: 0x81, dataSize: 1, args: [1, 2] }, 0x1f), /data size/);
  assert.throws(() => encodeRazerRequest({ commandClass: 0, commandId: 0x81, dataSize: 81 }, 0x1f), /data size/);
});

test("responses decode their status, data size and argument slice", () => {
  const frame = new Uint8Array(RAZER_REPORT_LENGTH);
  frame[0] = 0x02;
  frame[1] = 0x1f;
  frame[2] = 0x00;
  frame[3] = 0x01;
  frame[5] = 0x02;
  frame[6] = 0x00;
  frame[7] = 0x81;
  frame[8] = 0x02;
  frame[9] = 0x0b;
  const response = decodeRazerResponse(frame);
  assert.equal(response?.status, 0x02);
  assert.equal(response?.transactionId, 0x1f);
  assert.equal(response?.remainingPackets, 1);
  assert.equal(response?.dataSize, 2);
  assert.equal(response?.commandClass, 0x00);
  assert.equal(response?.commandId, 0x81);
  assert.deepEqual([...(response?.args ?? [])], [0x02, 0x0b]);
  assert.equal(decodeRazerFirmware(response!.args), "2.11");
  assert.equal(decodeRazerResponse(frame.slice(0, 89)), null);
});

test("serial replies trim at the first NUL and reject empty text", () => {
  assert.equal(decodeRazerSerial(bytes([0x41, 0x42, 0x43, 0, 0x44])), "ABC");
  assert.equal(decodeRazerSerial(bytes([0, 0, 0])), null);
});

test("polling codes round-trip in both command families", () => {
  for (const hz of RAZER_POLLING_RATES) {
    const extended = encodeRazerPollingCode(hz, true);
    if (extended !== null) assert.equal(decodeRazerPollingCode(extended, true), hz);
    const standard = encodeRazerPollingCode(hz, false);
    if (standard !== null) assert.equal(decodeRazerPollingCode(standard, false), hz);
  }
  assert.equal(encodeRazerPollingCode(250, false), null);
  assert.equal(decodeRazerPollingCode(0x03, true), null);
});

test("brightness uses the third argument byte", () => {
  assert.equal(decodeRazerBrightness(bytes([0x01, 0x05, 0xb7])), 0xb7);
  assert.equal(decodeRazerBrightness(bytes([0x01, 0x05])), null);
});

test("the analog Fn binding matches the published OpenRazer capture", () => {
  const command = encodeRazerAnalogBinding(0x01, 0x7f, false, 0x00, 0x00, { kind: "fn" });
  const frame = encodeRazerRequest(command, 0x1f);
  assert.deepEqual([...frame.slice(6, 20)], [0x02, 0x12, 0x01, 0x7f, 0x00, 0x00, 0x00, 0x0c, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00]);
});

test("extended and standard custom rows match OpenRazer's fixed-size report arguments", () => {
  const colors = [[0x11, 0x22, 0x33], [0xaa, 0xbb, 0xcc]] as const;
  const extended = encodeRazerCustomMatrixRow("extended", 2, 4, colors);
  assert.deepEqual([extended.commandClass, extended.commandId, extended.dataSize], [0x0f, 0x03, 0x47]);
  const extendedFrame = encodeRazerRequest(extended, 0x1f);
  assert.deepEqual([...extendedFrame.slice(8, 19)], [0, 0, 2, 4, 5, 0x11, 0x22, 0x33, 0xaa, 0xbb, 0xcc]);
  assert.equal(extendedFrame[5], 0x47);
  assert.equal(extendedFrame[19], 0);
  assert.deepEqual(encodeRazerCustomMatrixEffect("extended"), {
    commandClass: 0x0f, commandId: 0x02, dataSize: 0x0c, args: [0, 0, 8],
  });

  const standard = encodeRazerCustomMatrixRow("standard", 3, 0, colors);
  assert.deepEqual([standard.commandClass, standard.commandId, standard.dataSize], [0x03, 0x0b, 0x46]);
  const standardFrame = encodeRazerRequest(standard, 0xff);
  assert.deepEqual([...standardFrame.slice(8, 18)], [0xff, 3, 0, 1, 0x11, 0x22, 0x33, 0xaa, 0xbb, 0xcc]);
  assert.deepEqual(encodeRazerCustomMatrixEffect("standard"), {
    commandClass: 0x03, commandId: 0x0a, dataSize: 0x02, args: [0x05, 0],
  });
});

test("custom row rejects overflow, malformed RGB, and empty segments before emitting a report", () => {
  assert.throws(() => encodeRazerCustomMatrixRow("extended", 0, 0, []), RangeError);
  assert.throws(() => encodeRazerCustomMatrixRow("standard", 0, 0, Array(23).fill([0, 0, 0])), RangeError);
  assert.throws(() => encodeRazerCustomMatrixRow("extended", 0, 255, [[0, 0, 0], [0, 0, 0]]), RangeError);
  assert.throws(() => encodeRazerCustomMatrixRow("extended", 256, 0, [[0, 0, 0]]), RangeError);
  assert.throws(() => encodeRazerCustomMatrixRow("extended", 0, 0, [[-1, 0, 0]]), RangeError);
  assert.throws(() => encodeRazerCustomMatrixRow("extended", 0, 0, [[1.5, 0, 0]]), RangeError);
});

test("game-mode LED request is 03/00 and read is 03/80, GAME_LED 08", () => {
  assert.deepEqual(encodeRazerGameModeLed(0, true), { commandClass: 3, commandId: 0, dataSize: 3, args: [0, 8, 1] });
  assert.deepEqual(encodeRazerGameModeLed(1, false), { commandClass: 3, commandId: 0, dataSize: 3, args: [1, 8, 0] });
  assert.deepEqual(encodeRazerGameModeLed(1), { commandClass: 3, commandId: 0x80, dataSize: 3, args: [1, 8] });
  assert.equal(RAZER_GAME_MODE_LED_SUPPORT.get(0x026c)?.storage, 0);
  assert.equal(RAZER_GAME_MODE_LED_SUPPORT.get(0x02a6)?.transactionId, 0xff);
  assert.equal(RAZER_CUSTOM_MATRIX_SUPPORT.get(0x02a6)?.transactionId, 0x1f);
  assert.equal(RAZER_CUSTOM_MATRIX_SUPPORT.has(0x0235), false);
});

test("the keyboard catalog carries no duplicate product ids and marks nothing verified", () => {
  assert.equal(new Set(RAZER_KEYBOARD_PRODUCT_IDS).size, RAZER_KEYBOARD_PRODUCT_IDS.length);
  for (const product of RAZER_KEYBOARD_PRODUCTS.values()) {
    assert.equal(product.verified, false);
    assert.ok(product.name.length > 0);
  }
});
