/**
 * Key actions: what a key sends, as stored in the keymap, mod-tap and toggle
 * slots, DKS actions and macros. Every action is three bytes, `type, code1,
 * code2`; the vendor app also writes them as a 24-bit number
 * `type << 16 | code1 << 8 | code2`.
 */

export interface MchoseAction {
  type: number;
  code1: number;
  code2: number;
}

export const MCHOSE_ACTION_TYPE = {
  /** `code1` modifier mask, `code2` HID keyboard usage. Usage 0 with no modifier disables the key. */
  key: 0x10,
  /** `code1` button mask: 1 left, 2 right, 4 middle, 8 back, 16 forward. */
  mouse: 0x20,
  /** Wheel: `code2` 1 up, 0xFF down. */
  wheel: 0x21,
  /** Consumer usage, little-endian in `code1, code2`. */
  media: 0x30,
  /** `code1` 1 power, 2 sleep, 4 wake. */
  system: 0x40,
  /** `code1` macro slot (0-15). */
  macro: 0x70,
  /** `code1` DKS slot. */
  dks: 0x90,
  /** `code1` toggle slot. */
  toggle: 0x91,
  /** `code1` mod-tap slot, `code2` hold time in 10 ms. */
  modTap: 0x92,
  /** Rapid snap pair: `code2` is the partner key's matrix index. */
  snapTap: 0x93,
  /** SOCD pair: `code2` is the partner key's matrix index; the key's travel priority picks the winner. */
  socd: 0x94,
  /** Layer tap pair, kept as read. */
  layerTap: 0x95,
  /** Keyboard functions: Fn layers, lighting, profile switch. */
  special: 0xf0,
} as const;

export const MCHOSE_MODIFIER = {
  leftCtrl: 0x01, leftShift: 0x02, leftAlt: 0x04, leftWin: 0x08,
  rightCtrl: 0x10, rightShift: 0x20, rightAlt: 0x40, rightWin: 0x80,
} as const;

export const MCHOSE_DISABLED_ACTION: MchoseAction = { type: MCHOSE_ACTION_TYPE.key, code1: 0, code2: 0 };

export function mchoseActionValue(action: MchoseAction): number {
  return ((action.type & 0xff) << 16) | ((action.code1 & 0xff) << 8) | (action.code2 & 0xff);
}

export function mchoseActionFromValue(value: number): MchoseAction {
  return { type: (value >> 16) & 0xff, code1: (value >> 8) & 0xff, code2: value & 0xff };
}

export function mchoseActionsEqual(a: MchoseAction, b: MchoseAction): boolean {
  return a.type === b.type && a.code1 === b.code1 && a.code2 === b.code2;
}

/** A key with optional modifiers (`usage` 0 for a bare modifier combination). */
export function mchoseKeyAction(usage: number, modifiers = 0): MchoseAction {
  return { type: MCHOSE_ACTION_TYPE.key, code1: modifiers & 0xff, code2: usage & 0xff };
}

/** HID keyboard usage names, as the vendor app labels them. */
export const MCHOSE_USAGE_NAMES: Readonly<Record<number, string>> = {
  0x04: "A", 0x05: "B", 0x06: "C", 0x07: "D", 0x08: "E", 0x09: "F", 0x0a: "G", 0x0b: "H", 0x0c: "I", 0x0d: "J",
  0x0e: "K", 0x0f: "L", 0x10: "M", 0x11: "N", 0x12: "O", 0x13: "P", 0x14: "Q", 0x15: "R", 0x16: "S", 0x17: "T",
  0x18: "U", 0x19: "V", 0x1a: "W", 0x1b: "X", 0x1c: "Y", 0x1d: "Z",
  0x1e: "1", 0x1f: "2", 0x20: "3", 0x21: "4", 0x22: "5", 0x23: "6", 0x24: "7", 0x25: "8", 0x26: "9", 0x27: "0",
  0x28: "Enter", 0x29: "Esc", 0x2a: "Backspace", 0x2b: "Tab", 0x2c: "Space", 0x2d: "-", 0x2e: "=", 0x2f: "[",
  0x30: "]", 0x31: "\\", 0x33: ";", 0x34: "'", 0x35: "`", 0x36: ",", 0x37: ".", 0x38: "/", 0x39: "Caps Lock",
  0x3a: "F1", 0x3b: "F2", 0x3c: "F3", 0x3d: "F4", 0x3e: "F5", 0x3f: "F6", 0x40: "F7", 0x41: "F8", 0x42: "F9",
  0x43: "F10", 0x44: "F11", 0x45: "F12", 0x46: "Print Screen", 0x47: "Scroll Lock", 0x48: "Pause",
  0x49: "Insert", 0x4a: "Home", 0x4b: "Page Up", 0x4c: "Delete", 0x4d: "End", 0x4e: "Page Down",
  0x4f: "Right", 0x50: "Left", 0x51: "Down", 0x52: "Up", 0x53: "Num Lock", 0x54: "Num /", 0x55: "Num *",
  0x56: "Num -", 0x57: "Num +", 0x58: "Num Enter", 0x59: "Num 1", 0x5a: "Num 2", 0x5b: "Num 3", 0x5c: "Num 4",
  0x5d: "Num 5", 0x5e: "Num 6", 0x5f: "Num 7", 0x60: "Num 8", 0x61: "Num 9", 0x62: "Num 0", 0x63: "Num .",
  0x64: "ISO \\", 0x65: "Menu",
  0x68: "F13", 0x69: "F14", 0x6a: "F15", 0x6b: "F16", 0x6c: "F17", 0x6d: "F18", 0x6e: "F19", 0x6f: "F20",
  0x70: "F21", 0x71: "F22", 0x72: "F23", 0x73: "F24",
};

const MODIFIER_NAMES: readonly [number, string][] = [
  [MCHOSE_MODIFIER.leftCtrl, "Ctrl"], [MCHOSE_MODIFIER.leftShift, "Shift"], [MCHOSE_MODIFIER.leftAlt, "Alt"], [MCHOSE_MODIFIER.leftWin, "Win"],
  [MCHOSE_MODIFIER.rightCtrl, "Right Ctrl"], [MCHOSE_MODIFIER.rightShift, "Right Shift"], [MCHOSE_MODIFIER.rightAlt, "Right Alt"], [MCHOSE_MODIFIER.rightWin, "Right Win"],
];

/** Consumer usages the vendor app offers, by usage. */
export const MCHOSE_MEDIA_NAMES: Readonly<Record<number, string>> = {
  0x00e2: "Mute", 0x00e9: "Volume up", 0x00ea: "Volume down", 0x00cd: "Play / pause", 0x00b7: "Stop",
  0x00b6: "Previous track", 0x00b5: "Next track", 0x0183: "Media player", 0x006f: "Screen brightness up",
  0x0070: "Screen brightness down", 0x0223: "Browser home", 0x0227: "Browser refresh", 0x0226: "Browser stop",
  0x0225: "Browser forward", 0x0224: "Browser back", 0x022a: "Browser favourites", 0x0221: "Search",
  0x0192: "Calculator", 0x0194: "My computer", 0x018a: "Mail", 0x00cf: "Siri", 0x00a0: "Launchpad",
  0x00bc: "Rewind", 0x00bb: "Fast forward", 0x00af: "Select", 0x00b0: "Eject", 0x029f: "Mission Control",
};

export function mchoseMediaAction(usage: number): MchoseAction {
  return { type: MCHOSE_ACTION_TYPE.media, code1: usage & 0xff, code2: (usage >> 8) & 0xff };
}

export const MCHOSE_MOUSE_NAMES: Readonly<Record<number, string>> = {
  0x01: "Left click", 0x02: "Right click", 0x04: "Middle click", 0x08: "Back", 0x10: "Forward",
};

/** Keyboard functions under type 0xF0, keyed by `code1 << 8 | code2`. */
export const MCHOSE_SPECIAL_NAMES: Readonly<Record<number, string>> = {
  0x2f00: "Next lighting effect", 0x2e00: "Previous lighting effect", 0x3200: "Brightness up", 0x3300: "Brightness down",
  0x3d00: "Next colour", 0x3c00: "Previous colour", 0x3500: "Lighting on / off", 0x3600: "Speed up", 0x3700: "Speed down",
  0xfa00: "Next profile", 0x1e00: "Back to home", 0x4900: "Charging indicator",
  0x3000: "Lighting mode", 0x3e00: "Colour", 0x0200: "Win lock", 0x0400: "Windows mode", 0x0500: "Mac mode", 0x0800: "Reset",
  0x1c00: "Light bar off", 0xa000: "Light bar effect", 0x1500: "Light bar brightness up", 0x1600: "Light bar brightness down",
  0x1a00: "Light bar next colour",
  0xff00: "Fn0", 0xff01: "Fn1", 0xff02: "Fn2", 0xff03: "Fn3", 0xff04: "Fn4", 0xff05: "Fn5", 0xff06: "Fn6", 0xff07: "Fn7",
  0xff08: "Fn8", 0xff09: "Fn9", 0xff0a: "Fn10", 0xff0b: "Fn11", 0xff0c: "Fn12", 0xff0d: "Fn13", 0xff0e: "Fn14", 0xff0f: "Fn15",
};

export const MCHOSE_SYSTEM_NAMES: Readonly<Record<number, string>> = { 1: "Power", 2: "Sleep", 4: "Wake" };

/** English label for an action; `null` when the vendor app names it nowhere. */
export function mchoseActionLabel(action: MchoseAction): string | null {
  const { type, code1, code2 } = action;
  switch (type) {
    case MCHOSE_ACTION_TYPE.key: {
      if (code1 === 0 && code2 === 0) return "Disabled";
      const mods = MODIFIER_NAMES.filter(([bit]) => (code1 & bit) !== 0).map(([, name]) => name);
      const key = code2 === 0 ? null : MCHOSE_USAGE_NAMES[code2] ?? `Key 0x${code2.toString(16)}`;
      return [...mods, ...(key ? [key] : [])].join("+");
    }
    case MCHOSE_ACTION_TYPE.mouse: return MCHOSE_MOUSE_NAMES[code1] ?? null;
    case MCHOSE_ACTION_TYPE.wheel: return code2 === 1 ? "Wheel up" : code2 === 0xff ? "Wheel down" : null;
    case MCHOSE_ACTION_TYPE.media: return MCHOSE_MEDIA_NAMES[code1 | (code2 << 8)] ?? null;
    case MCHOSE_ACTION_TYPE.system: return MCHOSE_SYSTEM_NAMES[code1] ?? null;
    case MCHOSE_ACTION_TYPE.macro: return `Macro ${code1 + 1}`;
    case MCHOSE_ACTION_TYPE.dks: return "DKS";
    case MCHOSE_ACTION_TYPE.toggle: return "Toggle";
    case MCHOSE_ACTION_TYPE.modTap: return "Mod-tap";
    case MCHOSE_ACTION_TYPE.snapTap: return "Rapid snap";
    case MCHOSE_ACTION_TYPE.socd: return "SOCD";
    case MCHOSE_ACTION_TYPE.layerTap: return "Layer tap";
    case MCHOSE_ACTION_TYPE.special: return MCHOSE_SPECIAL_NAMES[(code1 << 8) | code2] ?? null;
    default: return null;
  }
}

/** Keymap region: 512 bytes per layer, 4 layers per profile, 3 bytes per matrix slot. */
export const MCHOSE_LAYER_COUNT = 4;
export const MCHOSE_KEYMAP_LAYER_SIZE = 512;
export const MCHOSE_ACTION_SIZE = 3;

export function mchoseKeymapOffset(profile: number, layer: number): number {
  return MCHOSE_KEYMAP_LAYER_SIZE * (MCHOSE_LAYER_COUNT * profile + layer);
}

export function decodeMchoseKeymap(data: ArrayLike<number>, slots: number): MchoseAction[] {
  const actions: MchoseAction[] = [];
  for (let slot = 0; slot < slots; slot += 1) {
    actions.push({ type: data[slot * 3] ?? 0, code1: data[slot * 3 + 1] ?? 0, code2: data[slot * 3 + 2] ?? 0 });
  }
  return actions;
}

export function encodeMchoseActions(actions: readonly MchoseAction[]): number[] {
  return actions.flatMap((action) => {
    for (const byte of [action.type, action.code1, action.code2]) {
      if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) throw new RangeError("MCHOSE action bytes must be bytes.");
    }
    return [action.type, action.code1, action.code2];
  });
}
