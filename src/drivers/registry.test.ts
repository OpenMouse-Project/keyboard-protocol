import assert from "node:assert/strict";
import test from "node:test";

import { WootingHidClient } from "./wooting/hid.ts";
import { WuqueHidClient } from "./wuque/hid.ts";
import { DEVICE_DRIVERS, clientSupportScore, createSupportedClient, deviceBrand } from "./registry.ts";
import { SUPPORTED_HID_FILTERS, VENDOR_ID, WOOTING_HID_FILTERS, WUQUE_HID_FILTERS } from "./vendors.ts";
import { WOOTING_PRODUCT_IDS, WOOTING_VENDOR_ID } from "@openmouse/keyboard-protocol/wooting";
import {
  WUQUE_CONFIG_USAGE,
  WUQUE_CONFIG_USAGE_PAGE,
  WUQUE_PRODUCTS,
  WUQUE_PRODUCT_IDS,
  WUQUE_VENDOR_ID,
  WUQUE_VENDOR_ID_ALT,
} from "@openmouse/keyboard-protocol/wuque";

/** A vendor collection carrying only the fields `isSupported` reads. */
function collection(usagePage: number, usage: number, children: HIDCollectionInfo[] = []): HIDCollectionInfo {
  return { usagePage, usage, inputReports: [], outputReports: [], featureReports: [], children };
}

interface FakeDeviceOptions {
  vendorId?: number;
  productId?: number;
  collections?: HIDCollectionInfo[];
}

/** Minimal HIDDevice shaped so the driver `isSupported` predicates can classify it. */
function fakeDevice({
  vendorId = WOOTING_VENDOR_ID,
  productId = WOOTING_PRODUCT_IDS[0]!,
  collections = [collection(0xff55, 1)],
}: FakeDeviceOptions = {}): HIDDevice {
  return { vendorId, productId, productName: "test board", opened: false, collections } as unknown as HIDDevice;
}

const WOOTING_DEVICE = (): HIDDevice => fakeDevice({ vendorId: WOOTING_VENDOR_ID, productId: 0x1322 });

const WUQUE_DEVICE = (): HIDDevice =>
  fakeDevice({ vendorId: WUQUE_VENDOR_ID, productId: 0x1b10, collections: [collection(WUQUE_CONFIG_USAGE_PAGE, 1)] });

test("DEVICE_DRIVERS lists one branded entry per supported protocol", () => {
  assert.deepEqual(
    DEVICE_DRIVERS.map((driver) => driver.brand),
    ["Wooting", "Wuque Studio"],
  );
});

test("createSupportedClient returns the matching driver client", () => {
  assert.ok(createSupportedClient(WOOTING_DEVICE()) instanceof WootingHidClient);
  assert.ok(createSupportedClient(WUQUE_DEVICE()) instanceof WuqueHidClient);
});

test("createSupportedClient returns null for a device no driver claims", () => {
  assert.equal(createSupportedClient(fakeDevice({ vendorId: 0x1234, productId: 0x9999 })), null);
  // A Wuque product id under the Wooting vendor belongs to neither driver.
  assert.equal(createSupportedClient(fakeDevice({ vendorId: WOOTING_VENDOR_ID, productId: 0x1b10 })), null);
});

test("clientSupportScore reports a nonzero score only for claimed devices", () => {
  assert.equal(clientSupportScore(WOOTING_DEVICE()), 6);
  assert.equal(clientSupportScore(WUQUE_DEVICE()), 6);
  assert.equal(clientSupportScore(fakeDevice({ vendorId: 0x1234, productId: 0x9999 })), 0);
});

test("deviceBrand names the driver that claimed the client", () => {
  assert.equal(deviceBrand(createSupportedClient(WOOTING_DEVICE())!), "Wooting");
  assert.equal(deviceBrand(createSupportedClient(WUQUE_DEVICE())!), "Wuque Studio");
});

test("deviceBrand falls back to Unknown for an unclaimed device", () => {
  const orphan = { device: fakeDevice({ vendorId: 0x1234, productId: 0x9999 }) };
  assert.equal(deviceBrand(orphan as unknown as Parameters<typeof deviceBrand>[0]), "Unknown");
});

test("VENDOR_ID exposes both Wuque vendor ids", () => {
  assert.equal(VENDOR_ID.wooting, WOOTING_VENDOR_ID);
  assert.equal(VENDOR_ID.wuque, WUQUE_VENDOR_ID);
  assert.equal(VENDOR_ID.wuqueAlt, WUQUE_VENDOR_ID_ALT);
});

test("WOOTING_HID_FILTERS offer only the command config collection", () => {
  assert.equal(WOOTING_HID_FILTERS.length, WOOTING_PRODUCT_IDS.length);
  for (const filter of WOOTING_HID_FILTERS) {
    assert.equal(filter.vendorId, WOOTING_VENDOR_ID);
    assert.equal(filter.usagePage, 0xff55);
    assert.equal(filter.usage, 0x01);
    assert.ok(WOOTING_PRODUCT_IDS.includes(filter.productId!));
  }
});

test("WUQUE_HID_FILTERS pair each product id with its own vendor id", () => {
  assert.equal(WUQUE_HID_FILTERS.length, WUQUE_PRODUCT_IDS.length);
  for (const filter of WUQUE_HID_FILTERS) {
    assert.equal(filter.usagePage, WUQUE_CONFIG_USAGE_PAGE);
    assert.equal(filter.usage, WUQUE_CONFIG_USAGE);
    assert.equal(filter.vendorId, WUQUE_PRODUCTS[filter.productId!]!.vendorId);
  }
  // The 80 HE ids live under the second vendor id (0x36B5), not the primary one.
  const eighty = WUQUE_HID_FILTERS.find((filter) => filter.productId === 0x75d4);
  assert.equal(eighty?.vendorId, WUQUE_VENDOR_ID_ALT);
});

test("SUPPORTED_HID_FILTERS concatenates the vendor filter sets with no duplicates", () => {
  assert.deepEqual(SUPPORTED_HID_FILTERS, [...WOOTING_HID_FILTERS, ...WUQUE_HID_FILTERS]);
  const seen = new Set(SUPPORTED_HID_FILTERS.map((f) => `${f.vendorId}:${f.productId}`));
  assert.equal(seen.size, SUPPORTED_HID_FILTERS.length);
});
