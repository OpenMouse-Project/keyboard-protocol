/**
 * Ace 68 Air key layout: positions and labels from the vendor web
 * configurator's Air II/III drawing, matrix slots from the keyboard's own
 * default keymap (command 0x07) on an Ace 68 Air III, firmware 116. The
 * vendor's offline key file orders slots differently; the keyboard's order
 * is the one its key-travel table follows (Caps Lock, the only key with a
 * deeper factory actuation, is slot 46). `mchoseLayoutFromDefaults`
 * resolves slots from a connected keyboard instead.
 */

export interface MchoseLayoutKey {
  /** Index into the 128-entry key-travel table and key matrix. */
  index: number;
  /** HID usage the key sends on the base layer (0xFF for Fn). */
  usage: number;
  label: string;
  /** Physical row, 0 at the number row. */
  row: number;
  /** Left edge and width in key units, from the vendor drawing. */
  x: number;
  width: number;
}

type Row = readonly [index: number, usage: number, label: string, row: number, x: number, width: number];

const ROWS: readonly Row[] = [
  [26, 0x29, "Esc", 0, 0.31, 1],
  [64, 0x1e, "1", 0, 1.4, 1],
  [22, 0x1f, "2", 0, 2.5, 1],
  [2, 0x20, "3", 0, 3.6, 1],
  [60, 0x21, "4", 0, 4.69, 1],
  [38, 0x22, "5", 0, 5.79, 1],
  [78, 0x23, "6", 0, 6.88, 1],
  [76, 0x24, "7", 0, 7.98, 1],
  [27, 0x25, "8", 0, 9.07, 1],
  [67, 0x26, "9", 0, 10.17, 1],
  [65, 0x27, "0", 0, 11.26, 1],
  [5, 0x2d, "-", 0, 12.36, 1],
  [28, 0x2e, "=", 0, 13.45, 1],
  [8, 0x2a, "Bksp", 0, 14.55, 2.05],
  [55, 0x49, "Insert", 0, 16.69, 1],
  [66, 0x2b, "Tab", 1, 0.31, 1.52],
  [4, 0x14, "Q", 1, 1.93, 1],
  [83, 0x1a, "W", 1, 3.02, 1],
  [0, 0x08, "E", 1, 4.12, 1],
  [40, 0x15, "R", 1, 5.21, 1],
  [18, 0x17, "T", 1, 6.31, 1],
  [16, 0x1c, "Y", 1, 7.4, 1],
  [47, 0x18, "U", 1, 8.5, 1],
  [7, 0x0c, "I", 1, 9.6, 1],
  [25, 0x12, "O", 1, 10.69, 1],
  [45, 0x13, "P", 1, 11.79, 1],
  [68, 0x2f, "[", 1, 12.88, 1],
  [48, 0x30, "]", 1, 13.98, 1],
  [30, 0x31, "\\", 1, 15.07, 1.52],
  [70, 0x4c, "Delete", 1, 16.69, 1],
  [46, 0x39, "Caps", 2, 0.31, 1.81],
  [81, 0x04, "A", 2, 2.21, 1],
  [80, 0x16, "S", 2, 3.31, 1],
  [82, 0x07, "D", 2, 4.4, 1],
  [58, 0x09, "F", 2, 5.5, 1],
  [36, 0x0a, "G", 2, 6.6, 1],
  [56, 0x0b, "H", 2, 7.69, 1],
  [3, 0x0d, "J", 2, 8.79, 1],
  [41, 0x0e, "K", 2, 9.88, 1],
  [12, 0x0f, "L", 2, 10.98, 1],
  [52, 0x33, ";", 2, 12.07, 1],
  [72, 0x34, "'", 2, 13.17, 1],
  [34, 0x28, "Enter", 2, 14.26, 2.33],
  [10, 0x4b, "PgUp", 2, 16.69, 1],
  [6, 0xe1, "LShift", 3, 0.31, 2.33],
  [44, 0x1d, "Z", 3, 2.74, 1],
  [49, 0x1b, "X", 3, 3.83, 1],
  [29, 0x06, "C", 3, 4.93, 1],
  [9, 0x19, "V", 3, 6.02, 1],
  [69, 0x05, "B", 3, 7.12, 1],
  [43, 0x11, "N", 3, 8.21, 1],
  [23, 0x10, "M", 3, 9.31, 1],
  [21, 0x36, ",", 3, 10.4, 1],
  [1, 0x37, ".", 3, 11.5, 1],
  [32, 0x38, "/", 3, 12.6, 1],
  [54, 0xe5, "RShift", 3, 13.69, 1.81],
  [53, 0x52, "Up", 3, 15.6, 1],
  [50, 0x4e, "PgDn", 3, 16.69, 1],
  [11, 0xe0, "LCtrl", 4, 0.31, 1.29],
  [71, 0xe3, "Win", 4, 1.69, 1.29],
  [31, 0xe2, "LAlt", 4, 3.07, 1.29],
  [63, 0x2c, "Space", 4, 4.45, 6.67],
  [61, 0xe6, "RAlt", 4, 11.21, 1],
  [14, 0xff, "Fn", 4, 12.31, 1],
  [74, 0xe4, "RCtrl", 4, 13.4, 1],
  [33, 0x50, "Left", 4, 14.5, 1],
  [73, 0x51, "Down", 4, 15.6, 1],
  [13, 0x4f, "Right", 4, 16.69, 1],
];

export const MCHOSE_ACE68_LAYOUT: readonly MchoseLayoutKey[] = /* @__PURE__ */ ROWS.map(([index, usage, label, row, x, width]) => ({ index, usage, label, row, x, width }));

/** HID usage a default-keymap action stands for: plain keys, modifiers (0xE0-0xE7) and Fn (0xFF). */
function defaultUsage(action: { type: number; code1: number; code2: number }): number | null {
  if (action.type === 0x10 && action.code1 === 0 && action.code2 !== 0) return action.code2;
  if (action.type === 0x10 && action.code2 === 0 && action.code1 !== 0) {
    const bit = Math.log2(action.code1);
    return Number.isInteger(bit) ? 0xe0 + bit : null;
  }
  if (action.type === 0xf0 && action.code1 === 0xff) return 0xff;
  return null;
}

/**
 * The layout with each key's matrix slot taken from the keyboard's own default
 * keymap (layer 0 of command 0x07). Keys the keymap does not name keep the
 * slot from the static table.
 */
export function mchoseLayoutFromDefaults(defaults: readonly { type: number; code1: number; code2: number }[]): MchoseLayoutKey[] {
  const slots = new Map<number, number>();
  defaults.forEach((action, slot) => {
    const usage = defaultUsage(action);
    if (usage !== null && !slots.has(usage)) slots.set(usage, slot);
  });
  return MCHOSE_ACE68_LAYOUT.map((key) => ({ ...key, index: slots.get(key.usage) ?? key.index }));
}
