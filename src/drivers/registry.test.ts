import assert from "node:assert/strict";
import test from "node:test";

import { WootingHidClient } from "./wooting/hid.ts";
import { WuqueHidClient } from "./wuque/hid.ts";
import { RazerKeyboardHidClient } from "./razer/hid.ts";
import { LogitechKeyboardHidClient } from "./logitech/hid.ts";
import { SteelSeriesKeyboardHidClient } from "./steelseries/hid.ts";
import { KeychronHidClient } from "./keychron/hid.ts";
import { ArbiterKeyboardHidClient } from "./arbiter/hid.ts";
import { DEVICE_DRIVERS, clientSupportScore, createSupportedClient, deviceBrand } from "./registry.ts";
import {
  ARBITER_HID_FILTERS,
  SUPPORTED_HID_FILTERS,
  KEYCHRON_HID_FILTERS,
  KOCHI_HID_FILTERS,
  LOGITECH_HID_FILTERS,
  RAZER_HID_FILTERS,
  STEELSERIES_HID_FILTERS,
  VENDOR_ID,
  WOOTING_HID_FILTERS,
  WUQUE_HID_FILTERS,
} from "./vendors.ts";
import { WOOTING_PRODUCT_IDS, WOOTING_VENDOR_ID } from "@openmouse/keyboard-protocol/wooting";
import {
  WUQUE_CONFIG_USAGE,
  WUQUE_CONFIG_USAGE_PAGE,
  WUQUE_PRODUCTS,
  WUQUE_PRODUCT_IDS,
  WUQUE_VENDOR_ID,
  WUQUE_VENDOR_ID_ALT,
} from "@openmouse/keyboard-protocol/wuque";
import { RAZER_KEYBOARD_PRODUCT_IDS, RAZER_VENDOR_ID } from "@openmouse/keyboard-protocol/razer";
import { LOGITECH_KEYBOARD_PRODUCT_IDS, LOGITECH_RECEIVER_PRODUCT_IDS, LOGITECH_VENDOR_ID } from "@openmouse/keyboard-protocol/logitech";
import { STEELSERIES_KEYBOARD_PRODUCT_IDS, STEELSERIES_VENDOR_ID } from "@openmouse/keyboard-protocol/steelseries";
import { KEYCHRON_CONFIG_USAGE, KEYCHRON_CONFIG_USAGE_PAGE, KEYCHRON_HE_PRODUCT_IDS, KEYCHRON_VENDOR_ID } from "@openmouse/keyboard-protocol/keychron";

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

const KEYCHRON_DEVICE = (overrides: FakeDeviceOptions = {}): HIDDevice => fakeDevice({
  vendorId: KEYCHRON_VENDOR_ID,
  productId: KEYCHRON_HE_PRODUCT_IDS[0]!,
  collections: [collection(KEYCHRON_CONFIG_USAGE_PAGE, KEYCHRON_CONFIG_USAGE)],
  ...overrides,
});

const RAZER_DEVICE = (): HIDDevice =>
  fakeDevice({ vendorId: RAZER_VENDOR_ID, productId: 0x02a6, collections: [collection(0x0001, 0x0002)] });

const LOGITECH_DEVICE = (): HIDDevice =>
  fakeDevice({ vendorId: LOGITECH_VENDOR_ID, productId: 0xc352, collections: [collection(0xff00, 2)] });

const STEELSERIES_DEVICE = (): HIDDevice =>
  fakeDevice({ vendorId: STEELSERIES_VENDOR_ID, productId: 0x1628, collections: [collection(0xffc0, 1)] });

const ARBITER_DEVICE = (): HIDDevice =>
  fakeDevice({ vendorId: 0x371c, productId: 0xa003, collections: [collection(0xff02, 1)] });

const LOGITECH_RECEIVER_DEVICE = (): HIDDevice =>
  fakeDevice({ vendorId: LOGITECH_VENDOR_ID, productId: 0xc547, collections: [collection(0xff00, 2)] });

test("DEVICE_DRIVERS lists one branded entry per supported protocol", () => {
  assert.deepEqual(
    DEVICE_DRIVERS.map((driver) => driver.brand),
    ["Kochi", "Wooting", "Wuque Studio", "Razer", "Logitech", "SteelSeries", "Keychron", "Arbiter Studio"],
  );
});

test("createSupportedClient returns the matching driver client", () => {
  assert.ok(createSupportedClient(WOOTING_DEVICE()) instanceof WootingHidClient);
  assert.ok(createSupportedClient(WUQUE_DEVICE()) instanceof WuqueHidClient);
  assert.ok(createSupportedClient(RAZER_DEVICE()) instanceof RazerKeyboardHidClient);
  assert.ok(createSupportedClient(LOGITECH_DEVICE()) instanceof LogitechKeyboardHidClient);
  assert.ok(createSupportedClient(LOGITECH_RECEIVER_DEVICE()) instanceof LogitechKeyboardHidClient);
  assert.ok(createSupportedClient(STEELSERIES_DEVICE()) instanceof SteelSeriesKeyboardHidClient);
  assert.ok(createSupportedClient(KEYCHRON_DEVICE()) instanceof KeychronHidClient);
  assert.ok(createSupportedClient(ARBITER_DEVICE()) instanceof ArbiterKeyboardHidClient);
});

test("Keychron claims only catalogued HE boards on the raw-HID collection", () => {
  assert.equal(deviceBrand(createSupportedClient(KEYCHRON_DEVICE())!), "Keychron");
  assert.equal(createSupportedClient(KEYCHRON_DEVICE({ productId: 0x0001 })), null);
  assert.equal(createSupportedClient(KEYCHRON_DEVICE({ collections: [collection(0xff60, 0x62)] })), null);
  assert.equal(KEYCHRON_HID_FILTERS.length, KEYCHRON_HE_PRODUCT_IDS.length);
  assert.ok(KEYCHRON_HID_FILTERS.every((filter) => filter.vendorId === VENDOR_ID.keychron));
});

test("createSupportedClient returns null for a device no driver claims", () => {
  assert.equal(createSupportedClient(fakeDevice({ vendorId: 0x1234, productId: 0x9999 })), null);
  // A Wuque product id under the Wooting vendor belongs to neither driver.
  assert.equal(createSupportedClient(fakeDevice({ vendorId: WOOTING_VENDOR_ID, productId: 0x1b10 })), null);
  // A Razer mouse shares the control collection but is absent from the keyboard catalog.
  assert.equal(createSupportedClient(fakeDevice({
    vendorId: RAZER_VENDOR_ID, productId: 0x00c1, collections: [collection(0x0001, 0x0002)],
  })), null);
  // A Logitech mouse speaks HID++ but is absent from the keyboard catalog.
  assert.equal(createSupportedClient(fakeDevice({
    vendorId: LOGITECH_VENDOR_ID, productId: 0xc094, collections: [collection(0xff00, 2)],
  })), null);
});

test("clientSupportScore reports a nonzero score only for claimed devices", () => {
  assert.equal(clientSupportScore(WOOTING_DEVICE()), 6);
  assert.equal(clientSupportScore(WUQUE_DEVICE()), 6);
  assert.equal(clientSupportScore(RAZER_DEVICE()), 6);
  assert.equal(clientSupportScore(LOGITECH_DEVICE()), 6);
  assert.equal(clientSupportScore(STEELSERIES_DEVICE()), 6);
  assert.equal(clientSupportScore(ARBITER_DEVICE()), 6);
  assert.equal(clientSupportScore(fakeDevice({ vendorId: 0x1234, productId: 0x9999 })), 0);
});

test("deviceBrand names the driver that claimed the client", () => {
  assert.equal(deviceBrand(createSupportedClient(WOOTING_DEVICE())!), "Wooting");
  assert.equal(deviceBrand(createSupportedClient(WUQUE_DEVICE())!), "Wuque Studio");
  assert.equal(deviceBrand(createSupportedClient(RAZER_DEVICE())!), "Razer");
  assert.equal(deviceBrand(createSupportedClient(LOGITECH_DEVICE())!), "Logitech");
  assert.equal(deviceBrand(createSupportedClient(STEELSERIES_DEVICE())!), "SteelSeries");
  assert.equal(deviceBrand(createSupportedClient(ARBITER_DEVICE())!), "Arbiter Studio");
});

test("deviceBrand falls back to Unknown for an unclaimed device", () => {
  const orphan = { device: fakeDevice({ vendorId: 0x1234, productId: 0x9999 }) };
  assert.equal(deviceBrand(orphan as unknown as Parameters<typeof deviceBrand>[0]), "Unknown");
});

test("VENDOR_ID exposes every branded vendor id", () => {
  assert.equal(VENDOR_ID.wooting, WOOTING_VENDOR_ID);
  assert.equal(VENDOR_ID.wuque, WUQUE_VENDOR_ID);
  assert.equal(VENDOR_ID.wuqueAlt, WUQUE_VENDOR_ID_ALT);
  assert.equal(VENDOR_ID.razer, RAZER_VENDOR_ID);
  assert.equal(VENDOR_ID.logitech, LOGITECH_VENDOR_ID);
  assert.equal(VENDOR_ID.steelseries, STEELSERIES_VENDOR_ID);
});

test("WOOTING_HID_FILTERS offer only the command config collection", () => {
  assert.equal(WOOTING_HID_FILTERS.length, 2);
  assert.deepEqual(WOOTING_HID_FILTERS.map((filter) => filter.usagePage), [0xff55, 0x1337]);
  for (const filter of WOOTING_HID_FILTERS) {
    assert.equal(filter.vendorId, WOOTING_VENDOR_ID);
    assert.equal(filter.usage, 0x01);
    assert.equal(filter.productId, undefined);
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

test("new vendor filters name each catalogued product and the control collection", () => {
  assert.equal(RAZER_HID_FILTERS.length, RAZER_KEYBOARD_PRODUCT_IDS.length);
  for (const filter of RAZER_HID_FILTERS) {
    assert.equal(filter.vendorId, RAZER_VENDOR_ID);
    assert.equal(filter.usagePage, 0x0001);
    assert.equal(filter.usage, 0x0002);
    assert.ok(filter.productId !== undefined);
  }

  assert.equal(LOGITECH_HID_FILTERS.length, (LOGITECH_KEYBOARD_PRODUCT_IDS.length + LOGITECH_RECEIVER_PRODUCT_IDS.length) * 2);
  for (const filter of LOGITECH_HID_FILTERS) {
    assert.equal(filter.vendorId, LOGITECH_VENDOR_ID);
    assert.ok([0xff00, 0xff43].includes(filter.usagePage!));
    assert.ok(filter.productId !== undefined);
  }

  assert.equal(STEELSERIES_HID_FILTERS.length, STEELSERIES_KEYBOARD_PRODUCT_IDS.length);
  for (const filter of STEELSERIES_HID_FILTERS) {
    assert.equal(filter.vendorId, STEELSERIES_VENDOR_ID);
    assert.equal(filter.usagePage, 0xffc0);
    assert.equal(filter.usage, 1);
  }
});

test("SUPPORTED_HID_FILTERS concatenates the vendor filter sets with no duplicates", () => {
  assert.deepEqual(SUPPORTED_HID_FILTERS, [
    ...KOCHI_HID_FILTERS,
    ...WOOTING_HID_FILTERS,
    ...WUQUE_HID_FILTERS,
    ...RAZER_HID_FILTERS,
    ...LOGITECH_HID_FILTERS,
    ...STEELSERIES_HID_FILTERS,
    ...KEYCHRON_HID_FILTERS,
    ...ARBITER_HID_FILTERS,
  ]);
  const seen = new Set(SUPPORTED_HID_FILTERS.map((f) => `${f.vendorId}:${f.productId}:${f.usagePage}:${f.usage}`));
  assert.equal(seen.size, SUPPORTED_HID_FILTERS.length);
});
