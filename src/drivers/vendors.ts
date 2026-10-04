import {
  WOOTING_CONFIG_USAGE,
  WOOTING_CONFIG_USAGE_PAGE,
  WOOTING_PRODUCT_IDS,
  WOOTING_VENDOR_ID,
} from "@openmouse/keyboard-protocol/wooting";

export const VENDOR_ID = {
  wooting: WOOTING_VENDOR_ID,
} as const;

// Wooting analog boards expose their command-capable config interface on usage
// page 0xFF55, usage 0x01. Offer only that page: a board also presents a legacy
// 0xFF00 collection and the analog stream, and matching those too would list
// the same physical keyboard several times in the picker. The driver reads
// commands through 0xFF55 alone.
export const WOOTING_HID_FILTERS: HIDDeviceFilter[] = WOOTING_PRODUCT_IDS.map((productId) => (
  { vendorId: WOOTING_VENDOR_ID, productId, usagePage: WOOTING_CONFIG_USAGE_PAGE, usage: WOOTING_CONFIG_USAGE }
));

export const SUPPORTED_HID_FILTERS: HIDDeviceFilter[] = [
  ...WOOTING_HID_FILTERS,
];
