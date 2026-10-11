import {
  WOOTING_CONFIG_USAGE,
  WOOTING_CONFIG_USAGE_PAGE,
  WOOTING_PRODUCT_IDS,
  WOOTING_VENDOR_ID,
} from "@openmouse/keyboard-protocol/wooting";
import {
  WUQUE_CONFIG_USAGE,
  WUQUE_CONFIG_USAGE_PAGE,
  WUQUE_PRODUCTS,
  WUQUE_PRODUCT_IDS,
  WUQUE_VENDOR_ID,
  WUQUE_VENDOR_ID_ALT,
} from "@openmouse/keyboard-protocol/wuque";

export const VENDOR_ID = {
  wooting: WOOTING_VENDOR_ID,
  wuque: WUQUE_VENDOR_ID,
  wuqueAlt: WUQUE_VENDOR_ID_ALT,
} as const;

// Wooting analog boards expose their command-capable config interface on usage
// page 0xFF55, usage 0x01. Offer only that page: a board also presents a legacy
// 0xFF00 collection and the analog stream, and matching those too would list
// the same physical keyboard several times in the picker. The driver reads
// commands through 0xFF55 alone.
export const WOOTING_HID_FILTERS: HIDDeviceFilter[] = WOOTING_PRODUCT_IDS.map((productId) => (
  { vendorId: WOOTING_VENDOR_ID, productId, usagePage: WOOTING_CONFIG_USAGE_PAGE, usage: WOOTING_CONFIG_USAGE }
));

// Wuque Studio boards expose their command interface on usage page 0xFFB0,
// usage 0x01. As with Wooting, offer only that collection: the same physical
// keyboard also presents a boot-keyboard, a consumer-control and a mouse
// collection on the same interface, and matching those would list it several
// times in the picker. Product ids are paired with their own vendor id — the
// 80 HE ids are enumerated under 0x36B5, not 0x1CA6.
export const WUQUE_HID_FILTERS: HIDDeviceFilter[] = WUQUE_PRODUCT_IDS.map((productId) => (
  {
    vendorId: WUQUE_PRODUCTS[productId]!.vendorId,
    productId,
    usagePage: WUQUE_CONFIG_USAGE_PAGE,
    usage: WUQUE_CONFIG_USAGE,
  }
));

export const SUPPORTED_HID_FILTERS: HIDDeviceFilter[] = [
  ...WOOTING_HID_FILTERS,
  ...WUQUE_HID_FILTERS,
];
