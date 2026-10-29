import assert from "node:assert/strict";
import test from "node:test";

import {
  LOGITECH_KEYBOARD_PRODUCT_IDS,
  LOGITECH_KEYBOARD_PRODUCTS,
  LOGITECH_LONG_DATA_LENGTH,
  LOGITECH_LONG_REPORT_ID,
  LOGITECH_SHORT_DATA_LENGTH,
  LOGITECH_SHORT_REPORT_ID,
  LOGITECH_SOFTWARE_ID,
  decodeLogitechBattery,
  decodeLogitechBrightness,
  decodeLogitechBrightnessInfo,
  decodeLogitechDeviceInformation,
  decodeLogitechLegacyLightingInfo,
  decodeLogitechLegacyZoneInfo,
  decodeLogitechLegacyEffectInfo,
  decodeLogitechFeatureInfo,
  decodeLogitechFirmwareInfo,
  decodeLogitechReportRate,
  decodeLogitechReportRates,
  decodeLogitechResponse,
  encodeLogitechReportRate,
  encodeLogitechRequest,
} from "./index.ts";

const bytes = (values: readonly number[]): Uint8Array => Uint8Array.from(values);

test("short requests carry three parameters and the software id", () => {
  const { reportId, data } = encodeLogitechRequest(0xff, 0x00, 0, [0x10, 0x04, 0x00], false);
  assert.equal(reportId, LOGITECH_SHORT_REPORT_ID);
  assert.equal(data.length, LOGITECH_SHORT_DATA_LENGTH);
  assert.deepEqual([...data], [0xff, 0x00, LOGITECH_SOFTWARE_ID, 0x10, 0x04, 0x00]);
});

test("long requests carry sixteen parameters", () => {
  const params = Array.from({ length: 16 }, (_, index) => index);
  const { reportId, data } = encodeLogitechRequest(0xff, 0x05, 1, params, true);
  assert.equal(reportId, LOGITECH_LONG_REPORT_ID);
  assert.equal(data.length, LOGITECH_LONG_DATA_LENGTH);
  assert.deepEqual([...data], [0xff, 0x05, (1 << 4) | LOGITECH_SOFTWARE_ID, ...params]);
});

test("parameter counts above the report size are rejected", () => {
  assert.throws(() => encodeLogitechRequest(0xff, 0, 0, [0, 0, 0, 0], false), /at most 3/);
  assert.throws(() => encodeLogitechRequest(0xff, 0, 0, new Array(17).fill(0), true), /at most 16/);
});

test("responses decode normal and error frames and ignore unrelated report ids", () => {
  const normal = decodeLogitechResponse(LOGITECH_SHORT_REPORT_ID, bytes([0xff, 0x05, (1 << 4) | LOGITECH_SOFTWARE_ID, 1, 2, 3]));
  assert.equal(normal?.featureIndex, 0x05);
  assert.equal(normal?.functionId, 1);
  assert.equal(normal?.softwareId, LOGITECH_SOFTWARE_ID);

  const error = decodeLogitechResponse(LOGITECH_SHORT_REPORT_ID, bytes([0xff, 0xff, 0x05, (2 << 4) | LOGITECH_SOFTWARE_ID, 0x07, 0x00]));
  assert.equal(error?.errorCode, 0x07);
  assert.equal(error?.requestFeatureIndex, 0x05);
  assert.equal(error?.requestFunctionByte, (2 << 4) | LOGITECH_SOFTWARE_ID);

  assert.equal(decodeLogitechResponse(0x01, bytes([0, 0, 0, 0, 0, 0])), null);
});

test("root feature replies decode index, type and version", () => {
  assert.deepEqual(decodeLogitechFeatureInfo(bytes([0x05, 0x00, 0x04])), { index: 5, type: 0, version: 4 });
  assert.equal(decodeLogitechFeatureInfo(bytes([0x00, 0x00, 0x00])), null);
});

test("device information decodes unit id, transport, model ids, serial capability", () => {
  const info = decodeLogitechDeviceInformation(bytes([
    0x03, 0x01, 0x02, 0x03, 0x04, 0x00, 0x08, 0xc3, 0x52, 0x00, 0x00, 0x00, 0x00, 0x02, 0x01, 0x00,
  ]));
  assert.deepEqual(info, {
    entityCount: 3,
    unitId: "01020304",
    transport: ["USB"],
    modelIds: [0xc352],
    extendedModelId: 2,
    serialNumber: true,
  });
  assert.equal(decodeLogitechDeviceInformation(bytes([0x03])), null);
});

test("firmware BCD fields decode into version and build", () => {
  const info = decodeLogitechFirmwareInfo(bytes([0x00, 0x4b, 0x42, 0x44, 0x01, 0x23, 0x04, 0x56, 0x01, 0, 0, 0, 0, 0, 0, 0]));
  assert.deepEqual(info, { entityType: 0, prefix: "KBD", version: "1.23", build: 456, active: true });
  assert.deepEqual(
    decodeLogitechFirmwareInfo(bytes([0x00, 0x4b, 0x42, 0x44, 0x01, 0x23, 0x04, 0x56, 0x00])),
    { entityType: 0, prefix: "KBD", version: "1.23", build: 456, active: false },
  );
  assert.equal(decodeLogitechFirmwareInfo(bytes([0x00, 0x4b])), null);
});

test("battery decodes gauge percentage, level and status", () => {
  assert.deepEqual(decodeLogitechBattery(bytes([0x4e, 0x04, 0x01, 0x00]), true), {
    percent: 0x4e, level: "good", status: "charging",
  });
  assert.deepEqual(decodeLogitechBattery(bytes([0x4e, 0x04, 0x01, 0x00]), false), {
    percent: null, level: "good", status: "charging",
  });
  assert.deepEqual(decodeLogitechBattery(bytes([0x00, 0x00, 0x09]), true), {
    percent: 0, level: null, status: null,
  });
});

test("report-rate masks and discriminants decode in both directions", () => {
  assert.deepEqual(decodeLogitechReportRates(bytes([0x00, 0b01000111])), [125, 250, 500, 8000]);
  assert.equal(decodeLogitechReportRate(bytes([0x03])), 1000);
  assert.equal(decodeLogitechReportRate(bytes([0x07])), null);
  for (const hz of [125, 250, 500, 1000, 2000, 4000, 8000]) {
    assert.equal(decodeLogitechReportRate(bytes([encodeLogitechReportRate(hz) ?? 0xff])), hz);
  }
  assert.equal(encodeLogitechReportRate(300), null);
});

test("brightness info and value decode", () => {
  const info = decodeLogitechBrightnessInfo(bytes([0x03, 0xe8, 0x64, 0x04, 0x00, 0x00, 0x00]));
  assert.deepEqual(info, { min: 0, max: 1000, steps: 100, illumination: true });
  assert.equal(decodeLogitechBrightness(bytes([0x01, 0xf4])), 500);
  assert.equal(decodeLogitechBrightness(bytes([0x01])), null);
});

test("0x8070 info, zone and zone-local effect replies decode capabilities and BE fields", () => {
  assert.deepEqual(decodeLogitechLegacyLightingInfo(bytes([2, 0, 0, 0, 1])), { zoneCount: 2, canReadEffect: true });
  assert.deepEqual(decodeLogitechLegacyLightingInfo(bytes([1, 0, 0, 0, 0])), { zoneCount: 1, canReadEffect: false });
  assert.deepEqual(decodeLogitechLegacyZoneInfo(bytes([1, 0x12, 0x34, 3, 0]), 1), { location: 0x1234, effectCount: 3 });
  assert.deepEqual(decodeLogitechLegacyEffectInfo(bytes([1, 2, 0, 1, 0, 0, 0x13, 0x88]), 1, 2), { index: 2, id: 1, period: 5000 });
  assert.equal(decodeLogitechLegacyLightingInfo(bytes([1, 0, 0, 0])), null);
  assert.equal(decodeLogitechLegacyZoneInfo(bytes([0, 0, 1, 2, 0]), 1), null);
  assert.equal(decodeLogitechLegacyEffectInfo(bytes([1, 1, 0, 1, 0, 0, 0x13, 0x88]), 1, 2), null);
});

test("the keyboard catalog carries no duplicate product ids and marks nothing verified", () => {
  assert.equal(new Set(LOGITECH_KEYBOARD_PRODUCT_IDS).size, LOGITECH_KEYBOARD_PRODUCT_IDS.length);
  for (const product of LOGITECH_KEYBOARD_PRODUCTS.values()) {
    assert.equal(product.verified, false);
    assert.ok(product.name.length > 0);
  }
});
