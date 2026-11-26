/** MCHOSE magnetic keyboards this package knows, and the collection their configuration uses. */
export const MCHOSE_KEYBOARD_VENDOR_ID = 0x41e4;
export const MCHOSE_CONFIG_USAGE_PAGE = 0x0001;
export const MCHOSE_CONFIG_USAGE = 0x0000;

export interface MchoseProduct {
  name: string;
  productId: number;
  /** Polling rates the vendor app offers on this model. */
  pollingRatesHz: readonly number[];
  /** False until the model is exercised through this package on hardware. */
  verified: boolean;

}

export const MCHOSE_PRODUCTS: readonly MchoseProduct[] = [
  { name: "Ace 68 Air III", productId: 0x2132, pollingRatesHz: [1000, 2000, 4000, 8000], verified: true },
  // Same layout, keymap and "glw" command set in the vendor bundle; not tested.
  { name: "Ace 68 Air II", productId: 0x2120, pollingRatesHz: [1000, 2000, 4000, 8000], verified: false },
];
export const MCHOSE_PRODUCT_IDS: readonly number[] = /* @__PURE__ */ MCHOSE_PRODUCTS.map((entry) => entry.productId);

export function mchoseProduct(vendorId: number, productId: number): MchoseProduct | undefined {
  if (vendorId !== MCHOSE_KEYBOARD_VENDOR_ID) return undefined;
  return MCHOSE_PRODUCTS.find((entry) => entry.productId === productId);
}
