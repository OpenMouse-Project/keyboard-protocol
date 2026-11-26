import { MCHOSE_ACE68_SWITCHES } from "./codec.ts";
import { MCHOSE_ACE68_LAYOUT, type MchoseLayoutKey } from "./layout.ts";
import { MCHOSE_ACE68_EFFECTS, MCHOSE_ACE68_SIDE_EFFECTS, type MchoseEffect } from "./lighting.ts";

/**
 * What differs between MCHOSE models that share the command set. Kept apart
 * from `MCHOSE_PRODUCTS`, which stays small enough to load for device
 * detection; adding a model is a product entry plus one of these.
 */
export interface MchoseModel {
  /**
   * The vendor drawing with matrix slots, used until the keyboard's own
   * factory keymap is read (that read places each key for the board itself).
   */
  layout: readonly MchoseLayoutKey[];
  /** Backlight effects, and the light-box (side) effects when the model has one. */
  effects: { main: readonly MchoseEffect[]; side: readonly MchoseEffect[] | null };
  /** Switch types the vendor app lets the user pick for calibration curves. */
  switches: readonly { value: number; name: string }[];
  /** Travel a key reports at the bottom of a press, in 0.01 mm. */
  fullTravel: number;
}

/** The Ace 68 Air: 68 keys, a backlight and a light box; full travel measured on an Air III. */
const ACE68_AIR: MchoseModel = {
  layout: MCHOSE_ACE68_LAYOUT,
  effects: { main: MCHOSE_ACE68_EFFECTS, side: MCHOSE_ACE68_SIDE_EFFECTS },
  switches: MCHOSE_ACE68_SWITCHES,
  fullTravel: 341,
};

const MODELS: Readonly<Record<number, MchoseModel>> = { 0x2132: ACE68_AIR, 0x2120: ACE68_AIR };

/** The model details for a product id from `MCHOSE_PRODUCTS`. */
export function mchoseModel(productId: number): MchoseModel | undefined {
  return MODELS[productId];
}
