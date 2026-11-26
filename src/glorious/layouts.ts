/**
 * Key positions, factory key assignments and key drawings for Glorious
 * keyboards on their stock (Glorious CORE) firmware.
 *
 * Ported from Wheelguard (https://github.com/djshiye/wheelguard, MIT,
 * Copyright (c) 2026 Dino Klisura), `wheelguard/hw/gmmk.py`, `gmmk_he.py`,
 * `gmbk.py` and `gmmk_eternal.py` at e34953e. Wheelguard learned them by
 * reading Glorious CORE 2.1.23; none of it is verified on hardware yet.
 *
 * Keys are named by their `KeyboardEvent.code`, plus `Knob`, `Fn`, `Hashtag`
 * (ISO's key left of Enter) and `EnterLower` (the lower half of ISO's Enter,
 * drawn only). ISO's key left of Z is `Backslash`, as on ANSI boards.
 */

export type GloriousKeyIndex = Readonly<Record<string, number>>;

const range = (keys: string, first: number, name: (key: string) => string): Record<string, number> =>
  Object.fromEntries([...keys].map((key, i) => [name(key), first + i]));
const letters = (keys: string, first: number) => range(keys, first, (k) => `Key${k}`);
const digits = (first: number) => range("1234567890", first, (d) => `Digit${d}`);
const fKeys = (first: number, last: number, at: (n: number) => number): Record<string, number> =>
  Object.fromEntries(Array.from({ length: last - first + 1 }, (_, i) => [`F${first + i}`, at(first + i)]));

// ---------------------------------------------------------------- GMMK Pro and GMMK 2: 120 positions
const PRO_ANSI: GloriousKeyIndex = {
  Escape: 0, ...fKeys(1, 12, (n) => n), PrintScreen: 13, Knob: 14,
  Backquote: 20, ...digits(21), Minus: 31, Equal: 32, Backspace: 33, Delete: 34,
  Tab: 40, ...letters("QWERTYUIOP", 41), BracketLeft: 51, BracketRight: 52, Backslash: 53, PageUp: 54,
  CapsLock: 60, ...letters("ASDFGHJKL", 61), Semicolon: 70, Quote: 71, Enter: 73, PageDown: 74,
  ShiftLeft: 80, ...letters("ZXCVBNM", 81), Comma: 88, Period: 89, Slash: 90, ShiftRight: 91, ArrowUp: 93, End: 94,
  ControlLeft: 100, MetaLeft: 101, AltLeft: 102, Space: 105, AltRight: 108, Fn: 109,
  ControlRight: 110, ArrowLeft: 112, ArrowDown: 113, ArrowRight: 114,
};
const PRO_ISO: GloriousKeyIndex = {
  ...PRO_ANSI, Hashtag: 72, Backslash: 81, ...letters("ZXCVBNM", 82), Comma: 89, Period: 90, Slash: 91, ShiftRight: 92,
};
const PRO_ANSI_ALT: GloriousKeyIndex = { ...PRO_ANSI, Backslash: 90, Slash: 53 };

const ROW_NUM = { ...digits(21), Minus: 31, Equal: 32, Backspace: 33 };
const ROW_Q = { Tab: 40, ...letters("QWERTYUIOP", 41), BracketLeft: 51, BracketRight: 52 };
const ROW_A = { CapsLock: 60, ...letters("ASDFGHJKL", 61), Semicolon: 70, Quote: 71, Enter: 73 };
const ROW_Z = { ShiftLeft: 80, ...letters("ZXCVBNM", 82), Comma: 89, Period: 90, Slash: 91, ShiftRight: 92, ArrowUp: 93 };
const V2_ANSI = { Backslash: 53 };
const V2_ISO = { Hashtag: 72, Backslash: 81 };
const G2_65 = {
  Escape: 20, ...ROW_NUM, Delete: 34, ...ROW_Q, PageUp: 54, ...ROW_A, PageDown: 74, ...ROW_Z,
  End: 94, ControlLeft: 100, MetaLeft: 101, AltLeft: 102, Space: 105, AltRight: 108,
  Fn: 109, ArrowLeft: 112, ArrowDown: 113, ArrowRight: 114,
};
const G2_96 = {
  Escape: 0, ...fKeys(1, 12, (n) => n), PrintScreen: 13, Delete: 14, Insert: 15, PageUp: 16, PageDown: 17,
  Backquote: 20, ...ROW_NUM, NumLock: 34, NumpadDivide: 35, NumpadMultiply: 36,
  NumpadSubtract: 37, ...ROW_Q, Numpad7: 54, Numpad8: 55, Numpad9: 56, ...ROW_A, Numpad4: 74,
  Numpad5: 75, Numpad6: 76, NumpadAdd: 77, ...ROW_Z, Numpad1: 94, Numpad2: 95, Numpad3: 96,
  ControlLeft: 100, MetaLeft: 101, AltLeft: 102, Space: 105, AltRight: 109, Fn: 110,
  ControlRight: 111, ArrowLeft: 112, ArrowDown: 113, ArrowRight: 114, Numpad0: 115,
  NumpadDecimal: 116, NumpadEnter: 117,
};

// ---------------------------------------------------------------- GMMK 3 (wired): 126 positions, every size
const G3 = {
  Escape: 0, ...fKeys(1, 12, (n) => n + 1), PrintScreen: 14, ScrollLock: 15, Pause: 16,
  Knob: 20, Backquote: 21, ...digits(22), Minus: 32, Equal: 33, Backspace: 34, Insert: 35, Home: 36, PageUp: 37,
  NumLock: 38, NumpadDivide: 39, NumpadMultiply: 40, NumpadSubtract: 41,
  Tab: 42, ...letters("QWERTYUIOP", 43), BracketLeft: 53, BracketRight: 54, Delete: 56, End: 57, PageDown: 58,
  Numpad7: 59, Numpad8: 60, Numpad9: 61, NumpadAdd: 62,
  CapsLock: 63, ...letters("ASDFGHJKL", 64), Semicolon: 73, Quote: 74, Enter: 76, Numpad4: 80, Numpad5: 81, Numpad6: 82,
  ShiftLeft: 84, ...letters("ZXCVBNM", 86), Comma: 93, Period: 94, Slash: 95, ShiftRight: 97, ArrowUp: 99,
  Numpad1: 101, Numpad2: 102, Numpad3: 103, NumpadEnter: 104,
  ControlLeft: 105, MetaLeft: 106, AltLeft: 107, Space: 110, AltRight: 115, Fn: 116,
  ContextMenu: 117, ControlRight: 118, ArrowLeft: 119, ArrowDown: 120, ArrowRight: 121,
  Numpad0: 122, NumpadDecimal: 124,
};

// ---------------------------------------------------------------- GMMK 3 Pro Wireless: 110 positions, column by column
const G3W_SEQ = ("Escape Backquote Tab CapsLock ShiftLeft F1 Digit1 KeyQ KeyA ControlLeft F2 Digit2 KeyW KeyS MetaLeft "
  + "F3 Digit3 KeyE KeyZ AltLeft F4 Digit4 KeyR KeyD KeyX F5 Digit5 KeyT KeyF KeyC F6 Digit6 KeyY KeyG KeyV "
  + "F7 Digit7 KeyH KeyB Space F8 Digit8 KeyU KeyJ KeyN F9 Digit9 KeyI KeyK KeyM Digit0 KeyO KeyL Comma "
  + "AltRight F10 KeyP Semicolon Period Fn Minus BracketLeft Quote Slash ContextMenu F11 Equal BracketRight "
  + "ShiftRight ControlRight F12 Backspace Backslash Enter ArrowLeft PrintScreen Insert Delete ArrowUp "
  + "ArrowDown Pause ScrollLock Home End ArrowRight PageUp PageDown Numpad4 Numpad1 Numpad0 NumLock Numpad7 "
  + "Numpad5 Numpad2 NumpadDecimal NumpadDivide Numpad8 Numpad6 Numpad3 NumpadEnter NumpadMultiply Numpad9 "
  + "NumpadSubtract NumpadAdd").split(" ");
const G3W: Record<string, number> = Object.fromEntries(G3W_SEQ.map((key, i) => [key, i] as const).filter(([key]) => key !== "Escape"));
G3W.Escape = 0;
G3W.Knob = 108;
const G3W_65: Record<string, number> = { ...G3W, Escape: 1 };
delete G3W_65.Backquote;

const NUMPAD = {
  NumLock: 0, NumpadDivide: 1, NumpadMultiply: 2, NumpadSubtract: 3, Numpad7: 4, Numpad8: 5,
  Numpad9: 6, NumpadAdd: 7, Numpad4: 8, Numpad5: 9, Numpad6: 10, Knob: 11, Numpad1: 12,
  Numpad2: 13, Numpad3: 14, NumpadEnter: 15, Numpad0: 16, NumpadDecimal: 19,
};

// ---------------------------------------------------------------- GMBK 75%: (type, code) pair index
const GMBK_ANSI = {
  Escape: 1, ...fKeys(1, 12, (n) => n + 1), PrintScreen: 14, ScrollLock: 15, Pause: 16,
  Knob: 19, Backquote: 21, ...digits(22), Minus: 32, Equal: 33, Backspace: 34, Insert: 35, Home: 36, PageUp: 37,
  Tab: 42, ...letters("QWERTYUIOP", 43), BracketLeft: 53, BracketRight: 54, Backslash: 55, Delete: 56, End: 57, PageDown: 58,
  CapsLock: 63, ...letters("ASDFGHJKL", 64), Semicolon: 73, Quote: 74, Enter: 76,
  ShiftLeft: 84, ...letters("ZXCVBNM", 86), Comma: 93, Period: 94, Slash: 95, ShiftRight: 97, ArrowUp: 99,
  ControlLeft: 105, MetaLeft: 106, AltLeft: 107, Space: 110, AltRight: 115, Fn: 116, ContextMenu: 117,
  ControlRight: 118, ArrowLeft: 119, ArrowDown: 120, ArrowRight: 121,
};

// ---------------------------------------------------------------- GMMK Eternal 96: matrix position
const ETERNAL_ANSI = {
  Escape: 1, ...fKeys(1, 12, (n) => n + 1),
  Backquote: 14, ...digits(15), Minus: 25, Equal: 26, Backspace: 27,
  Tab: 28, ...letters("QWERTYUIOP", 29), BracketLeft: 39, BracketRight: 40, Backslash: 41,
  CapsLock: 42, ...letters("ASDFGHJKL", 43), Semicolon: 52, Quote: 53, Enter: 54,
  ShiftLeft: 55, ...letters("ZXCVBNM", 56), Comma: 63, Period: 64, Slash: 65, ShiftRight: 66,
  ControlLeft: 67, MetaLeft: 68, AltLeft: 69, Space: 70, AltRight: 71, Fn: 72, ControlRight: 73,
  ArrowUp: 74, ArrowDown: 75, ArrowLeft: 76, ArrowRight: 77, NumLock: 78, NumpadDivide: 79, NumpadMultiply: 80,
  NumpadSubtract: 81, NumpadAdd: 82, NumpadEnter: 83, NumpadDecimal: 84, Numpad0: 85, Numpad1: 86, Numpad2: 87,
  Numpad3: 88, Numpad4: 89, Numpad5: 90, Numpad6: 91, Numpad7: 92, Numpad8: 93, Numpad9: 94,
  PrintScreen: 95, ScrollLock: 96, Pause: 97, Insert: 98, Delete: 99, Home: 100, End: 101,
  PageUp: 102, PageDown: 103, ContextMenu: 104,
};

// ---------------------------------------------------------------- GMMK 3 HE: the board's own key numbers
const HE_SHARED = {
  Tab: 2, CapsLock: 3, ShiftLeft: 4, ControlLeft: 5, Digit1: 7, KeyQ: 8, KeyA: 9,
  Digit2: 13, KeyW: 14, KeyS: 15, KeyZ: 16, MetaLeft: 17, Digit3: 19, KeyE: 20, KeyD: 21,
  KeyX: 22, AltLeft: 23, Digit4: 25, KeyR: 26, KeyF: 27, KeyC: 28, Digit5: 31, KeyT: 32,
  KeyG: 33, KeyV: 34, Space: 35, Digit6: 37, KeyY: 38, KeyH: 39, KeyB: 40, Digit7: 43, KeyU: 44,
  KeyJ: 45, KeyN: 46, AltRight: 47, Digit8: 49, KeyI: 50, KeyK: 51, KeyM: 52, Fn: 53,
  Digit9: 55, KeyO: 56, KeyL: 57, Comma: 58, Digit0: 61, KeyP: 62, Semicolon: 63, Period: 64,
  Minus: 67, BracketLeft: 68, Quote: 69, Slash: 70, Equal: 73, BracketRight: 74, ShiftRight: 76,
  Backspace: 79,
};
const HE_F_ROW = { F1: 12, F2: 18, F3: 24, F4: 30, F5: 36, F6: 42, F7: 48, F8: 54, F9: 60, F10: 66, F11: 72, F12: 78 };
const HE_65 = { ...HE_SHARED, Escape: 1, ArrowLeft: 77, ArrowUp: 82, ArrowDown: 83, Knob: 84, PageUp: 87, PageDown: 88, ArrowRight: 89 };
const HE_75 = {
  ...HE_SHARED, ...HE_F_ROW, Escape: 0, Backquote: 1, ArrowLeft: 77, ArrowUp: 82, ArrowDown: 83, Knob: 84,
  Delete: 85, PageUp: 86, PageDown: 87, End: 88, ArrowRight: 89,
};
const HE_100 = {
  ...HE_SHARED, ...HE_F_ROW, Escape: 0, Backquote: 1, ContextMenu: 59, ControlRight: 65, ArrowLeft: 71, ArrowDown: 77,
  ArrowUp: 82, ArrowRight: 83, PrintScreen: 84, Insert: 85, Delete: 86, Numpad7: 87, Numpad4: 88, Numpad1: 89,
  ScrollLock: 90, Home: 91, End: 92, Numpad8: 93, Numpad5: 94, Numpad2: 95, Pause: 96, PageUp: 97, PageDown: 98,
  Numpad9: 99, Numpad6: 100, Numpad3: 101, NumLock: 104, NumpadMultiply: 105, NumpadDecimal: 106, Numpad0: 107,
  NumpadDivide: 110, NumpadSubtract: 111, NumpadAdd: 112, NumpadEnter: 113, Knob: 255,
};
const heAnsi = (keys: Record<string, number>) => ({ ...keys, Backslash: 80, Enter: 81 });
const heIso = (keys: Record<string, number>) => ({ ...keys, Backslash: 10, Enter: 80, Hashtag: 81 });

/** Position of every key in each board's key frame, by key map name. */
export const GLORIOUS_KEY_INDEX: Readonly<Record<string, GloriousKeyIndex>> = {
  ansi: PRO_ANSI, iso: PRO_ISO, "ansi-alt": PRO_ANSI_ALT,
  "g3-ansi": { ...G3, Backslash: 55 }, "g3-iso": { ...G3, Hashtag: 75, Backslash: 85 },
  "65-ansi": { ...G2_65, ...V2_ANSI }, "65-iso": { ...G2_65, ...V2_ISO },
  "96-ansi": { ...G2_96, ...V2_ANSI }, "96-iso": { ...G2_96, ...V2_ISO },
  "g3w-ansi": G3W, "g3w-iso": { ...G3W, Hashtag: 72, Backslash: 107 },
  "g3w-65-ansi": G3W_65, "g3w-65-iso": { ...G3W_65, Hashtag: 72, Backslash: 107 },
  numpad: NUMPAD,
  "gmbk-ansi": GMBK_ANSI, "gmbk-iso": { ...GMBK_ANSI, Hashtag: 75, Backslash: 85 },
  "eternal-ansi": ETERNAL_ANSI, "eternal-iso": { ...ETERNAL_ANSI, Backslash: 105, Hashtag: 106 },
  "he-65-ansi": heAnsi(HE_65), "he-65-iso": heIso(HE_65),
  "he-75-ansi": heAnsi(HE_75), "he-75-iso": heIso(HE_75),
  "he-100-ansi": heAnsi(HE_100), "he-100-iso": heIso(HE_100),
};

// ---------------------------------------------------------------- factory key assignments (types, then codes)
const hex = (text: string): Uint8Array => Uint8Array.from(text.match(/../g)!.map((b) => parseInt(b, 16)));

export const GLORIOUS_DEFAULT_KEYMAPS = {
  proAnsi: hex(
    "010101010101010101010101010103ffffffffff010101010101010101010101010101ffffffffff0101010101010101"
    + "01010101010101ffffffffff010101010101010101010101010101ffffffffff020101010101010101010102010101ff"
    + "ffffffff020202ffff01ffff020102ff010101ffffffffff293a3b3c3d3e3f4041424344454602ffffffffff351e1f20"
    + "212223242526272d2e2a4cffffffffff2b141a0815171c180c12132f30314bffffffffff39041607090a0b0d0e0f3334"
    + "32284effffffffffe11d1b0619051110363738e564524dffffffffffe0e3e2ffff2cffffe6a0e4ff50514fffffffffff"),
  proIso: hex(
    "010101010101010101010101010103ffffffffff010101010101010101010101010101ffffffffff0101010101010101"
    + "01010101010101ffffffffff010101010101010101010101010101ffffffffff020101010101010101010101020101ff"
    + "ffffffff020202ffff01ffff020102ff010101ffffffffff293a3b3c3d3e3f4041424344454602ffffffffff351e1f20"
    + "212223242526272d2e2a4cffffffffff2b141a0815171c180c12132f30314bffffffffff39041607090a0b0d0e0f3334"
    + "32284effffffffffe1641d1b0619051110363738e5524dffffffffffe0e3e2ffff2cffffe6a0e4ff50514fffffffffff"),
  g2_65: hex(
    "010101010101010101010101010103ffffffffff010101010101010101010101010101ffffffffff0101010101010101"
    + "01010101010101ffffffffff010101010101010101010101010101ffffffffff020101010101010101010101020101ff"
    + "ffffffff020202ffff01ffff020102ff010101ffffffffff353a3b3c3d3e3f4041424344454602ffffffffff291e1f20"
    + "212223242526272d2e2a4cffffffffff2b141a0815171c180c12132f30314bffffffffff39041607090a0b0d0e0f3334"
    + "32284effffffffffe1641d1b0619051110363738e5524dffffffffffe0e3e2ffff2cffffe6a0e4ff50514fffffffffff"),
  g2_96: hex(
    "010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101"
    + "010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101"
    + "010101010101010101010101010101010101010101010101293a3b3c3d3e3f404142434445464c494b4effff351e1f20"
    + "212223242526272d2e2a53545556ffff2b141a0815171c180c12132f30315f6061ffffff39041607090a0b0d0e0f3334"
    + "32285c5d5e57ffffe1641d1b0619051110363738e552595a5bffffffe0e3e2ffff2cffffffe6a0e450514f626358ffff"),
  g3: hex(
    "01ff0101010101010101010101010101010303ff03010101010101010101010101010101010101010101010101010101"
    + "0101010101010101010101010101010101010101010101010101010101ffffff010101ff020101010101010101010101"
    + "ff02ff01ff01010101020202ffff01ffffffff0201010201010101ff01ff29ff3a3b3c3d3e3f40414243444546474804"
    + "03ff02351e1f20212223242526272d2e2a494a4b535455562b141a0815171c180c12132f30314c4d4e5f606157390416"
    + "07090a0b0d0e0f33343228ffffff5c5d5effe1641d1b0619051110363738ffe5ff525b595a5b58e0e3e2ffff2cffffff"
    + "ffe6a065e450514f62ff63ffffffffff"),
  g3w: hex(
    "010101010201010101020101010102010101010201010101010101010101010101010101010101010101010101010101"
    + "0101010101010201010101ff010101010101010101010101010101010101010101010101010101010101010101010101"
    + "010101010101010101010101030129292b39e13a1e1404e03b1f1a16e33c20081de23d2115071b3e221709063f231c0a"
    + "1940240b052c4125180d1142260c0e1027120f36e643133337fe2d2f343865442e30e5e4452a31285046494c52514847"
    + "4a4d4f4b4e5c5962535f5d5a6354605e5b585561565704000000a2030000000000000000000000000000000000000000"
    + "0000000000000000"),
  numpad: hex("0101010101010101010101030101010101000001535455565f6061575c5d5e02595a5b5862000063"),
  /** GMBK: 126 (type, code) pairs for layers 1 and 3; layer 2 has a layer key on right Alt. */
  gmbk: hex(
    "ffff0129013a013b013c013d013e013f014001410142014301440145014601470148030403030302ffff0135011e011f"
    + "01200121012201230124012501260127012d012e012a0149014a014b0153015401550156012b0114011a010801150117"
    + "011c0118010c01120113012f01300131014c014d014e015f01600161015701390104011601070109010a010b010d010e"
    + "010f0133013401320128ffffffffffff015c015d015effff02e10164011d011b01060119010501110110013601370138"
    + "ffff02e5ffff0152ff5b0159015a015b015802e002e302e2ffffffff012cffffffffffffffff02c30d01016502e40150"
    + "0151014f0162ffff0163ffff"),
} as const;

// ---------------------------------------------------------------- drawing
export type GloriousForm = "pro" | "65" | "96" | "numpad" | "g3-65" | "g3-75" | "g3-100";
/** [key, width] or [key, width, height] in key units; a null key is a gap. */
type Cap = readonly [string | null, number, number?];
type Row = readonly Cap[];

const TOP: Row = [["Escape", 1], [null, 0.25], ["F1", 1], ["F2", 1], ["F3", 1], ["F4", 1], [null, 0.25], ["F5", 1],
  ["F6", 1], ["F7", 1], ["F8", 1], [null, 0.25], ["F9", 1], ["F10", 1], ["F11", 1], ["F12", 1],
  [null, 0.25], ["PrintScreen", 1], ["Knob", 1]];
const NUM: Row = [["Backquote", 1], ...[..."1234567890"].map((d): Cap => [`Digit${d}`, 1]), ["Minus", 1], ["Equal", 1],
  ["Backspace", 2], ["Delete", 1]];
const Q: Row = [["Tab", 1.5], ...[..."QWERTYUIOP"].map((c): Cap => [`Key${c}`, 1]), ["BracketLeft", 1], ["BracketRight", 1]];
const A: Row = [["CapsLock", 1.75], ...[..."ASDFGHJKL"].map((c): Cap => [`Key${c}`, 1]), ["Semicolon", 1], ["Quote", 1]];
const Z: Row = [...[..."ZXCVBNM"].map((c): Cap => [`Key${c}`, 1]), ["Comma", 1], ["Period", 1], ["Slash", 1]];
const BOTTOM: Row = [["ControlLeft", 1.25], ["MetaLeft", 1.25], ["AltLeft", 1.25], ["Space", 6.25], ["AltRight", 1],
  ["Fn", 1], ["ControlRight", 1], ["ArrowLeft", 1], ["ArrowDown", 1], ["ArrowRight", 1]];
const BOTTOM_65: Row = [...BOTTOM.slice(0, 5), ["Fn", 1], [null, 1], ["ArrowLeft", 1], ["ArrowDown", 1], ["ArrowRight", 1]];
const fRow = (from: number, to: number): Cap[] => Array.from({ length: to - from + 1 }, (_, i): Cap => [`F${from + i}`, 1]);
const TOP_96: Row = [["Escape", 1], [null, 0.25], ...fRow(1, 4), [null, 0.25], ...fRow(5, 8), [null, 0.25], ...fRow(9, 12),
  [null, 0.25], ["PrintScreen", 1], ["Delete", 1], ["Insert", 1], ["PageUp", 1], ["PageDown", 1]];
const NUM_96: Row = [...NUM.slice(0, -1), ["NumLock", 1], ["NumpadDivide", 1], ["NumpadMultiply", 1], ["NumpadSubtract", 1]];
const PAD7: Row = [["Numpad7", 1], ["Numpad8", 1], ["Numpad9", 1], ["NumpadAdd", 1, 2]];
const PAD4: Row = [["Numpad4", 1], ["Numpad5", 1], ["Numpad6", 1]];
const PAD1: Row = [["ArrowUp", 1], ["Numpad1", 1], ["Numpad2", 1], ["Numpad3", 1], ["NumpadEnter", 1, 2]];
const BOTTOM_96: Row = [...BOTTOM.slice(0, -3), ["ArrowLeft", 1], ["ArrowDown", 1], ["ArrowRight", 1], ["Numpad0", 1],
  ["NumpadDecimal", 1]];
const SHIFT_ANSI: Row = [["ShiftLeft", 2.25], ...Z, ["ShiftRight", 1.75]];
const SHIFT_ISO: Row = [["ShiftLeft", 1.25], ["Backslash", 1], ...Z, ["ShiftRight", 1.75]];
const Q_ANSI: Row = [...Q, ["Backslash", 1.5]];
const Q_ISO: Row = [...Q, ["Enter", 1.5]];
const A_ANSI: Row = [...A, ["Enter", 2.25]];
const A_ISO: Row = [...A, ["Hashtag", 1], ["EnterLower", 1.25]];
const BOTTOM_G3: Row = [...BOTTOM.slice(0, 4), ["AltRight", 1.5], ["Fn", 1.5], ["ArrowLeft", 1], ["ArrowDown", 1], ["ArrowRight", 1]];
const TOP_G3_75: Row = [...TOP.slice(0, -2), [null, 1], ["Knob", 1]];
const TOP_G3_100: Row = [TOP[0]!, [null, 1], ...fRow(1, 4), [null, 0.5], ...fRow(5, 8), [null, 0.5], ...fRow(9, 12),
  [null, 0.25], ["PrintScreen", 1], ["ScrollLock", 1], ["Pause", 1], [null, 3.25], ["Knob", 1]];
const NAV_G3: Row = [[null, 0.25], ["Insert", 1], ["Home", 1], ["PageUp", 1], [null, 0.25], ["NumLock", 1],
  ["NumpadDivide", 1], ["NumpadMultiply", 1], ["NumpadSubtract", 1]];
const DEL_G3: Row = [[null, 0.25], ["Delete", 1], ["End", 1], ["PageDown", 1], [null, 0.25], ...PAD7];
const PAD1_G3: Row = [[null, 1.25], ["ArrowUp", 1], [null, 1.25], ...PAD1.slice(1)];
const BOTTOM_G3_100: Row = [...BOTTOM.slice(0, 3), ["Space", 6.25], ["AltRight", 1.25], ["Fn", 1.25], ["ContextMenu", 1.25],
  ["ControlRight", 1.25], [null, 0.25], ["ArrowLeft", 1], ["ArrowDown", 1], ["ArrowRight", 1], [null, 0.25],
  ["Numpad0", 2], ["NumpadDecimal", 1]];
const SHIFT_G3_ANSI: Row = [...SHIFT_ANSI.slice(0, -1), ["ShiftRight", 2.75]];
const SHIFT_G3_ISO: Row = [...SHIFT_ISO.slice(0, -1), ["ShiftRight", 2.75]];
const NUM_65: Row = [["Escape", 1], ...NUM.slice(1)];
const NUM_G3_65: Row = [["Escape", 1], ...NUM.slice(1, -1), ["Knob", 1]];

const ROWS: Readonly<Record<string, readonly Row[]>> = {
  "pro:ansi": [TOP, NUM, [...Q_ANSI, ["PageUp", 1]], [...A_ANSI, ["PageDown", 1]], [...SHIFT_ANSI, ["ArrowUp", 1], ["End", 1]], BOTTOM],
  "pro:iso": [TOP, NUM, [...Q_ISO, ["PageUp", 1]], [...A_ISO, ["PageDown", 1]], [...SHIFT_ISO, ["ArrowUp", 1], ["End", 1]], BOTTOM],
  "65:ansi": [NUM_65, [...Q_ANSI, ["PageUp", 1]], [...A_ANSI, ["PageDown", 1]], [...SHIFT_ANSI, ["ArrowUp", 1], ["End", 1]], BOTTOM_65],
  "65:iso": [NUM_65, [...Q_ISO, ["PageUp", 1]], [...A_ISO, ["PageDown", 1]], [...SHIFT_ISO, ["ArrowUp", 1], ["End", 1]], BOTTOM_65],
  "96:ansi": [TOP_96, NUM_96, [...Q_ANSI, ...PAD7], [...A_ANSI, ...PAD4], [...SHIFT_ANSI, ...PAD1], BOTTOM_96],
  "96:iso": [TOP_96, NUM_96, [...Q_ISO, ...PAD7], [...A_ISO, ...PAD4], [...SHIFT_ISO, ...PAD1], BOTTOM_96],
  "numpad:ansi": [
    [["NumLock", 1], ["NumpadDivide", 1], ["NumpadMultiply", 1], ["NumpadSubtract", 1], [null, 0.5], ["Knob", 1]],
    PAD7, PAD4, PAD1.slice(1), [["Numpad0", 2], ["NumpadDecimal", 1]],
  ],
  "g3-65:ansi": [NUM_G3_65, [...Q_ANSI, [null, 1]], [...A_ANSI, ["PageUp", 1]], [...SHIFT_ANSI, ["ArrowUp", 1], ["PageDown", 1]], BOTTOM_G3],
  "g3-65:iso": [NUM_G3_65, [...Q_ISO, [null, 1]], [...A_ISO, ["PageUp", 1]], [...SHIFT_ISO, ["ArrowUp", 1], ["PageDown", 1]], BOTTOM_G3],
  "g3-75:ansi": [TOP_G3_75, NUM, [...Q_ANSI, ["PageUp", 1]], [...A_ANSI, ["PageDown", 1]], [...SHIFT_ANSI, ["ArrowUp", 1], ["End", 1]], BOTTOM_G3],
  "g3-75:iso": [TOP_G3_75, NUM, [...Q_ISO, ["PageUp", 1]], [...A_ISO, ["PageDown", 1]], [...SHIFT_ISO, ["ArrowUp", 1], ["End", 1]], BOTTOM_G3],
  "g3-100:ansi": [TOP_G3_100, [...NUM.slice(0, -1), ...NAV_G3], [...Q_ANSI, ...DEL_G3], [...A_ANSI, [null, 3.5], ...PAD4],
    [...SHIFT_G3_ANSI, ...PAD1_G3], BOTTOM_G3_100],
  "g3-100:iso": [TOP_G3_100, [...NUM.slice(0, -1), ...NAV_G3], [...Q_ISO, ...DEL_G3], [...A_ISO, [null, 3.5], ...PAD4],
    [...SHIFT_G3_ISO, ...PAD1_G3], BOTTOM_G3_100],
};

export interface GloriousKeyCap {
  /** Key name; ISO's lower Enter piece is `EnterLower` and selects `Enter`. */
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Every drawn key with its position in key units. */
export function gloriousLayoutKeys(form: GloriousForm, layout: "ansi" | "iso"): GloriousKeyCap[] {
  const rows = ROWS[`${form}:${form === "numpad" ? "ansi" : layout}`];
  if (!rows) throw new RangeError(`No drawing for ${form} ${layout}.`);
  const keys: GloriousKeyCap[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    for (const [id, w, h] of row) {
      if (id !== null) keys.push({ id, x, y, w, h: h ?? 1 });
      x += w;
    }
  });
  return keys;
}

// ---------------------------------------------------------------- names
const LABELS: Readonly<Record<string, string>> = {
  Escape: "Esc", PrintScreen: "PrtSc", Knob: "Knob", Backquote: "`", Minus: "-", Equal: "=",
  Backspace: "Backspace", Delete: "Del", Tab: "Tab", BracketLeft: "[", BracketRight: "]",
  Backslash: "\\", PageUp: "PgUp", CapsLock: "Caps", Semicolon: ";", Quote: "'", Enter: "Enter",
  EnterLower: "", Hashtag: "#", PageDown: "PgDn", ShiftLeft: "Shift", Comma: ",", Period: ".",
  Slash: "/", ShiftRight: "Shift", ArrowUp: "↑", End: "End", ControlLeft: "Ctrl",
  MetaLeft: "Win", AltLeft: "Alt", Space: "", AltRight: "Alt", Fn: "Fn", ControlRight: "Ctrl",
  ArrowLeft: "←", ArrowDown: "↓", ArrowRight: "→", Insert: "Ins", NumLock: "Num",
  NumpadDivide: "/", NumpadMultiply: "*", NumpadSubtract: "-", NumpadAdd: "+", NumpadEnter: "Enter",
  NumpadDecimal: ".", ScrollLock: "ScrLk", Pause: "Pause", Home: "Home", ContextMenu: "Menu",
};

/** The short label a key cap shows. */
export function gloriousKeyLabel(key: string): string {
  if (key in LABELS) return LABELS[key]!;
  if (/^(Key|Digit|Numpad)./.test(key)) return key.slice(-1);
  return key;
}

/** HID keyboard usages a key can be set to type, by name. */
export const GLORIOUS_USAGES: Readonly<Record<string, number>> = {
  ...Object.fromEntries([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((c, i) => [`Key${c}`, 4 + i])),
  ...Object.fromEntries([..."1234567890"].map((d, i) => [`Digit${d}`, 30 + i])),
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, 58 + i])),
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 13}`, 104 + i])),
  Escape: 41, Tab: 43, CapsLock: 57, Space: 44, Enter: 40, Backspace: 42,
  Delete: 76, Insert: 73, Home: 74, End: 77, PageUp: 75, PageDown: 78,
  ArrowUp: 82, ArrowDown: 81, ArrowLeft: 80, ArrowRight: 79, PrintScreen: 70,
  ScrollLock: 71, Pause: 72, ContextMenu: 101,
  Backquote: 53, Minus: 45, Equal: 46, BracketLeft: 47, BracketRight: 48,
  Backslash: 49, Semicolon: 51, Quote: 52, Comma: 54, Period: 55, Slash: 56, IntlBackslash: 100,
  ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, MetaLeft: 227,
  ControlRight: 228, ShiftRight: 229, AltRight: 230, MetaRight: 231,
  NumLock: 83, NumpadDivide: 84, NumpadMultiply: 85, NumpadSubtract: 86, NumpadAdd: 87, NumpadEnter: 88,
  ...Object.fromEntries([..."123456789"].map((d, i) => [`Numpad${d}`, 89 + i])), Numpad0: 98, NumpadDecimal: 99,
};

/** The usage a key types on the board by default (for boards written key by key). */
export function gloriousDefaultUsage(key: string, layout: "ansi" | "iso"): number {
  if (key === "Hashtag") return 0x32;
  if (key === "Backslash" && layout === "iso") return 0x64;
  const usage = GLORIOUS_USAGES[key];
  if (usage === undefined) throw new RangeError(`${key} has no usage of its own.`);
  return usage;
}
