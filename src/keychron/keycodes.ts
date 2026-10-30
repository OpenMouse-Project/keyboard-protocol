/**
 * Short key legends for QMK keycodes, for drawing a keyboard from a keymap
 * read. Covers the common basic keycodes, modifiers, layer keys and the
 * modifier/layer-tap wrappers; anything else falls back to its hex value so a
 * custom or vendor keycode is never shown as something it is not.
 */

export interface KeychronLegend {
  /** What to draw on the key; empty for an unassigned key. */
  label: string;
  /** Longer name for a tooltip. */
  title: string;
  /** True when the code is not recognised and `label` is its hex value. */
  unknown: boolean;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "1234567890";

const BASIC: Readonly<Record<number, [label: string, title: string]>> = {
  0x28: ["Enter", "Enter"], 0x29: ["Esc", "Escape"], 0x2a: ["Bksp", "Backspace"], 0x2b: ["Tab", "Tab"],
  0x2c: ["Space", "Space"], 0x2d: ["-", "Minus"], 0x2e: ["=", "Equal"], 0x2f: ["[", "Left bracket"],
  0x30: ["]", "Right bracket"], 0x31: ["\\", "Backslash"], 0x32: ["#", "Non-US hash"], 0x33: [";", "Semicolon"],
  0x34: ["'", "Quote"], 0x35: ["`", "Grave"], 0x36: [",", "Comma"], 0x37: [".", "Period"], 0x38: ["/", "Slash"],
  0x39: ["Caps", "Caps Lock"], 0x46: ["PrtSc", "Print Screen"], 0x47: ["ScrLk", "Scroll Lock"],
  0x48: ["Pause", "Pause"], 0x49: ["Ins", "Insert"], 0x4a: ["Home", "Home"], 0x4b: ["PgUp", "Page Up"],
  0x4c: ["Del", "Delete"], 0x4d: ["End", "End"], 0x4e: ["PgDn", "Page Down"], 0x4f: ["→", "Right arrow"],
  0x50: ["←", "Left arrow"], 0x51: ["↓", "Down arrow"], 0x52: ["↑", "Up arrow"], 0x53: ["Num", "Num Lock"],
  0x54: ["/", "Keypad slash"], 0x55: ["*", "Keypad asterisk"], 0x56: ["-", "Keypad minus"],
  0x57: ["+", "Keypad plus"], 0x58: ["Ent", "Keypad enter"], 0x62: ["0", "Keypad 0"], 0x63: [".", "Keypad period"],
  0x64: ["\\", "Non-US backslash"], 0x65: ["Menu", "Application"],
  0xe0: ["Ctrl", "Left Control"], 0xe1: ["Shift", "Left Shift"], 0xe2: ["Alt", "Left Alt"], 0xe3: ["Win", "Left GUI"],
  0xe4: ["Ctrl", "Right Control"], 0xe5: ["Shift", "Right Shift"], 0xe6: ["Alt", "Right Alt"], 0xe7: ["Win", "Right GUI"],
  0xa8: ["Mute", "Mute"], 0xa9: ["Vol+", "Volume up"], 0xaa: ["Vol-", "Volume down"], 0xab: ["Next", "Next track"],
  0xac: ["Prev", "Previous track"], 0xad: ["Stop", "Stop"], 0xae: ["Play", "Play/pause"],
};

const MOD_BITS = [["Ctrl", 0x01], ["Shift", 0x02], ["Alt", 0x04], ["Win", 0x08]] as const;

function basic(code: number): [string, string] | null {
  if (code >= 0x04 && code <= 0x1d) return [LETTERS[code - 0x04]!, `Key ${LETTERS[code - 0x04]}`];
  if (code >= 0x1e && code <= 0x27) return [DIGITS[code - 0x1e]!, `Key ${DIGITS[code - 0x1e]}`];
  if (code >= 0x3a && code <= 0x45) return [`F${code - 0x39}`, `F${code - 0x39}`];
  if (code >= 0x68 && code <= 0x73) return [`F${code - 0x5b}`, `F${code - 0x5b}`];
  if (code >= 0x59 && code <= 0x61) return [String(code - 0x58), `Keypad ${code - 0x58}`];
  return BASIC[code] ?? null;
}

/** Legend for one keycode as read from the board. */
export function keychronKeycodeLegend(code: number): KeychronLegend {
  if (code === 0x0000) return { label: "", title: "No key", unknown: false };
  if (code === 0x0001) return { label: "▽", title: "Transparent (falls through to the layer below)", unknown: false };
  const direct = basic(code);
  if (direct) return { label: direct[0], title: direct[1], unknown: false };
  // Modifier combos: 0x0100-0x1FFF are a basic key plus mod bits.
  if (code >= 0x0100 && code <= 0x1fff) {
    const key = basic(code & 0xff);
    const mods = MOD_BITS.filter(([, bit]) => (code >> 8) & bit).map(([name]) => name);
    if (key && mods.length) return { label: key[0], title: `${mods.join("+")}+${key[1]}`, unknown: false };
  }
  // Mod-tap 0x2000-0x3FFF and layer-tap 0x4000-0x4FFF: the tap key is the legend.
  if ((code >= 0x2000 && code <= 0x4fff)) {
    const key = basic(code & 0xff);
    if (key) return { label: key[0], title: `${code >= 0x4000 ? "Layer-tap" : "Mod-tap"} ${key[1]}`, unknown: false };
  }
  const layer = code & 0x1f;
  if (code >= 0x5200 && code <= 0x521f) return { label: `TO${layer}`, title: `Switch to layer ${layer}`, unknown: false };
  if (code >= 0x5220 && code <= 0x523f) return { label: `MO${layer}`, title: `Momentary layer ${layer}`, unknown: false };
  if (code >= 0x5240 && code <= 0x525f) return { label: `DF${layer}`, title: `Default layer ${layer}`, unknown: false };
  if (code >= 0x5260 && code <= 0x527f) return { label: `TG${layer}`, title: `Toggle layer ${layer}`, unknown: false };
  if (code >= 0x5280 && code <= 0x529f) return { label: `OS${layer}`, title: `One-shot layer ${layer}`, unknown: false };
  if (code >= 0x52c0 && code <= 0x52df) return { label: `TT${layer}`, title: `Layer tap-toggle ${layer}`, unknown: false };
  const hex = `0x${code.toString(16).toUpperCase().padStart(4, "0")}`;
  return { label: hex, title: `Unrecognised keycode ${hex}`, unknown: true };
}
