/**
 * Glorious keyboards on their stock (Glorious CORE) firmware: GMMK Pro,
 * GMMK 2, GMMK 3 / 3 Pro (wired and the Pro Wireless by cable), GMMK 3 HE /
 * Pro HE, GMMK Numpad, GMBK 75% and GMMK Eternal 96.
 *
 * Ported from Wheelguard (https://github.com/djshiye/wheelguard, MIT,
 * Copyright (c) 2026 Dino Klisura) at e34953e; see docs/glorious-support.md.
 * Wheelguard decoded the frames by reading Glorious CORE 2.1.23, not by
 * running it, and none of them is verified on hardware yet.
 *
 * The boards report none of their settings back, so a host keeps what it
 * sent ({@link GloriousBoardState}) and every change is planned here as a
 * list of frames ({@link GloriousJob}) the way CORE sends them. Every builder
 * is a pure function. Never built here (so impossible to send): firmware
 * updates, bootloaders, factory resets, calibration and lighting (the
 * properties frame carries the board's own default lighting).
 */
import {
  GLORIOUS_DEFAULT_KEYMAPS,
  GLORIOUS_KEY_INDEX,
  gloriousDefaultUsage,
  type GloriousForm,
} from "./layouts.ts";

export * from "./layouts.ts";

export const GLORIOUS_VENDOR_ID = 0x320f;
export const GLORIOUS_GMMK3_VENDOR_ID = 0x342d;
export const GLORIOUS_3794_VENDOR_ID = 0x3794;

export type GloriousProtocol = "gmmk" | "he" | "gmbk" | "eternal";

export interface GloriousModel {
  vendorId: number;
  productId: number;
  key: string;
  name: string;
  layout: "ansi" | "iso";
  /** Key map name in {@link GLORIOUS_KEY_INDEX}. */
  keymap: string;
  form: GloriousForm;
  protocol: GloriousProtocol;
  /** CORE re-selects the profile after a key assignment (GMMK Pro and Numpad). */
  commitKeys: boolean;
  /** Positions in the key assignment frame. */
  keyCount: number;
  /** Has the lights-off timer. */
  sleep: boolean;
  /** GMMK 3 Pro Wireless: no polling frame; the rate is byte 9 of the properties frame. */
  pollingInProperties: boolean;
  macros: boolean;
  wireless: boolean;
  defaultDebounce: number;
  /** Minutes; 255 is never. */
  defaultSleep: number;
}

const model = (
  vendorId: number, productId: number, key: string, name: string, layout: "ansi" | "iso", keymap: string,
  form: GloriousForm, extra: Partial<GloriousModel> = {},
): GloriousModel => ({
  vendorId, productId, key, name, layout, keymap, form, protocol: "gmmk", commitKeys: false, keyCount: 120,
  sleep: false, pollingInProperties: false, macros: true, wireless: false, defaultDebounce: 16, defaultSleep: 7,
  ...extra,
});

const lay = (iso: boolean): "ansi" | "iso" => (iso ? "iso" : "ansi");
const isoName = (iso: boolean) => (iso ? " (ISO)" : "");

function buildModels(): GloriousModel[] {
  const v = GLORIOUS_VENDOR_ID;
  const models = [
    model(v, 0x5044, "gmmk-pro-ansi", "Glorious GMMK Pro", "ansi", "ansi", "pro", { commitKeys: true }),
    model(v, 0x5046, "gmmk-pro-iso", "Glorious GMMK Pro (ISO)", "iso", "iso", "pro", { commitKeys: true }),
    model(v, 0x5092, "gmmk-pro-ansi-alt", "Glorious GMMK Pro", "ansi", "ansi-alt", "pro", { commitKeys: true }),
    model(v, 0x5093, "gmmk-pro-iso-alt", "Glorious GMMK Pro (ISO)", "iso", "iso", "pro", { commitKeys: true }),
    model(v, 0x5045, "gmmk2-65-ansi", "Glorious GMMK 2 65%", "ansi", "65-ansi", "65"),
    model(v, 0x504a, "gmmk2-65-iso", "Glorious GMMK 2 65% (ISO)", "iso", "65-iso", "65"),
    model(v, 0x504b, "gmmk2-96-ansi", "Glorious GMMK 2 96%", "ansi", "96-ansi", "96"),
    model(v, 0x505a, "gmmk2-96-iso", "Glorious GMMK 2 96% (ISO)", "iso", "96-iso", "96"),
    model(v, 0x5088, "gmmk-numpad", "Glorious GMMK Numpad", "ansi", "numpad", "numpad",
      { commitKeys: true, keyCount: 20, macros: false }),
  ];
  const wired: readonly [number, "100" | "75" | "65", boolean, boolean][] = [
    [0xe3c8, "100", false, false], [0xe3d1, "100", true, false], [0xe3c9, "75", false, false], [0xe3d2, "75", true, false],
    [0xe3ca, "65", false, false], [0xe3d3, "65", true, false], [0xe3c5, "100", false, true], [0xe3ce, "100", true, true],
    [0xe3c6, "75", false, true], [0xe3cf, "75", true, true], [0xe3c7, "65", false, true], [0xe3d0, "65", true, true],
  ];
  for (const [pid, size, iso, pro] of wired) {
    models.push(model(GLORIOUS_GMMK3_VENDOR_ID, pid, `gmmk3${pro ? "-pro" : ""}-${size}-${lay(iso)}`,
      `Glorious GMMK 3${pro ? " Pro" : ""} ${size}%${isoName(iso)}`, lay(iso), iso ? "g3-iso" : "g3-ansi", `g3-${size}`,
      { keyCount: 126, sleep: true }));
  }
  const wireless: readonly [number, "100" | "75" | "65", boolean][] = [
    [0xe3cb, "100", false], [0xe3d4, "100", true], [0xe3cc, "75", false],
    [0xe3d5, "75", true], [0xe3cd, "65", false], [0xe3d6, "65", true],
  ];
  for (const [pid, size, iso] of wireless) {
    models.push(model(GLORIOUS_GMMK3_VENDOR_ID, pid, `gmmk3-pro-wireless-${size}-${lay(iso)}`,
      `Glorious GMMK 3 Pro Wireless ${size}%${isoName(iso)}`, lay(iso), `g3w${size === "65" ? "-65" : ""}-${lay(iso)}`,
      `g3-${size}`, { keyCount: 110, sleep: true, pollingInProperties: true }));
  }
  const he: readonly [readonly [number, number, number], "he" | "pro-he", "100" | "75" | "65", boolean, boolean][] = [
    [[0xe3df, 0xb31b, 0xb308], "he", "100", false, false], [[0xe3f4, 0xb33b, 0xb328], "he", "100", true, false],
    [[0xe3de, 0xb31a, 0xb307], "he", "75", false, false], [[0xe3f3, 0xb33a, 0xb327], "he", "75", true, false],
    [[0xe3dd, 0xb319, 0xb306], "he", "65", false, false], [[0xe3f2, 0xb339, 0xb326], "he", "65", true, false],
    [[0xe3dc, 0xb312, 0xb302], "pro-he", "100", false, false], [[0xe3f1, 0xb332, 0xb322], "pro-he", "100", true, false],
    [[0xe3db, 0xb311, 0xb301], "pro-he", "75", false, false], [[0xe3f0, 0xb331, 0xb321], "pro-he", "75", true, false],
    [[0xe3da, 0xb310, 0xb300], "pro-he", "65", false, false], [[0xe3ef, 0xb330, 0xb320], "pro-he", "65", true, false],
    [[0xe3d9, 0xb317, 0xb305], "pro-he", "100", false, true], [[0xe3ee, 0xb337, 0xb325], "pro-he", "100", true, true],
    [[0xe3d8, 0xb315, 0xb304], "pro-he", "75", false, true], [[0xe3ed, 0xb335, 0xb324], "pro-he", "75", true, true],
    [[0xe3d7, 0xb313, 0xb303], "pro-he", "65", false, true], [[0xe3ec, 0xb333, 0xb323], "pro-he", "65", true, true],
  ];
  for (const [ids, line, size, iso, wl] of he) {
    const vendors = [GLORIOUS_GMMK3_VENDOR_ID, GLORIOUS_3794_VENDOR_ID, GLORIOUS_3794_VENDOR_ID];
    ids.forEach((pid, i) => models.push(model(vendors[i]!, pid, `gmmk3-${line}${wl ? "-wireless" : ""}-${size}-${lay(iso)}`,
      `Glorious GMMK 3 ${line === "pro-he" ? "Pro HE" : "HE"}${wl ? " Wireless" : ""} ${size}%${isoName(iso)}`,
      lay(iso), `he-${size}-${lay(iso)}`, `g3-${size}`,
      { sleep: true, macros: false, protocol: "he", wireless: wl })));
  }
  for (const [pid, iso] of [[0xb000, false], [0xb001, true]] as const) {
    models.push(model(GLORIOUS_3794_VENDOR_ID, pid, `gmbk-75-${lay(iso)}`, `Glorious GMBK 75%${isoName(iso)}`, lay(iso),
      `gmbk-${lay(iso)}`, "g3-75", { keyCount: GMBK_PAIRS, sleep: true, macros: false, protocol: "gmbk",
        defaultDebounce: GMBK_DEFAULT_DEBOUNCE }));
  }
  for (const [pid, iso] of [[0xb010, false], [0xb011, true]] as const) {
    models.push(model(GLORIOUS_3794_VENDOR_ID, pid, `gmmk-eternal-96-${lay(iso)}`,
      `Glorious GMMK Eternal 96%${isoName(iso)}`, lay(iso), `eternal-${lay(iso)}`, "96",
      { sleep: true, macros: false, protocol: "eternal", defaultDebounce: iso ? 16 : 8, defaultSleep: 255 }));
  }
  return models;
}

const GMBK_PAIRS = 126;
const GMBK_DEFAULT_DEBOUNCE = 2;

/** Every supported board. Bootloader ids are never listed, so they are never opened. */
export const GLORIOUS_MODELS: readonly GloriousModel[] = buildModels();

export function gloriousModel(vendorId: number, productId: number): GloriousModel | undefined {
  return GLORIOUS_MODELS.find((m) => m.vendorId === vendorId && m.productId === productId);
}

/** The HID collection settings go to, and how. */
export interface GloriousTransport {
  usagePage: number;
  usage: number;
  reportId: number;
  /** Settings go as output reports (`sendReport`), not feature reports. */
  output: boolean;
  /** Rates the board takes, fastest first. */
  polling: readonly number[];
}

export const GLORIOUS_TRANSPORTS: Readonly<Record<GloriousProtocol, GloriousTransport>> = {
  gmmk: { usagePage: 0xff01, usage: 0x01, reportId: 7, output: false, polling: [1000, 500, 250, 125] },
  he: { usagePage: 0xffff, usage: 0x02, reportId: 0, output: false, polling: [8000, 4000, 2000, 1000, 500, 250, 125] },
  gmbk: { usagePage: 0xff01, usage: 0x01, reportId: 7, output: false, polling: [1000, 500, 250, 125] },
  // The Eternal's stock firmware uses QMK's raw HID page; it is matched by its own ids only.
  eternal: { usagePage: 0xff60, usage: 0x61, reportId: 9, output: true, polling: [1000, 500, 250, 125] },
};

export const GLORIOUS_PROFILES = 3;
export const GLORIOUS_LAYERS = 3;
export const GLORIOUS_DEBOUNCE_MS = [2, 8, 16] as const;
/** Lights-off timer choices in minutes; 255 is never. */
export const GLORIOUS_SLEEP_MINUTES = [3, 7, 15, 30, 255] as const;
export const GLORIOUS_SLEEP_NEVER = 255;
export const GLORIOUS_MAX_MACROS = 10;
export const GLORIOUS_MAX_MACRO_EVENTS = 82;
export const GLORIOUS_HE_ACTUATION_MM = [0.1, 3.6] as const;
export const GLORIOUS_HE_SENSITIVITY_MM = [0.1, 2.0] as const;
const HE_DEADZONE_MM = 3.7;
const ETERNAL_DEBOUNCE_MS = [1, 30] as const;
const GMBK_STANDBY_MAX = 60;

export const GLORIOUS_MEDIA = {
  0: "Media player", 1: "Play / Pause", 2: "Mute", 3: "Volume up", 4: "Volume down", 5: "Stop",
  6: "Previous track", 7: "Next track",
} as const;
export const GLORIOUS_MOUSE = {
  1: "Left click", 2: "Right click", 3: "Middle click", 4: "Back", 5: "Forward", 6: "Scroll up", 7: "Scroll down",
} as const;
export const GLORIOUS_FUNCTIONS = { 2: "Next profile", 1: "Previous profile", 4: "Next layer", 3: "Previous layer" } as const;

export type GloriousModifier = "ctrl" | "shift" | "alt" | "super";
export const GLORIOUS_MODIFIERS: readonly GloriousModifier[] = ["ctrl", "shift", "alt", "super"];

/** What a key does. A key with no binding does what the board makes it do. */
export type GloriousBinding =
  | { kind: "disabled" }
  | { kind: "key"; code: number; mods?: readonly GloriousModifier[] }
  | { kind: "media"; code: number }
  | { kind: "mouse"; code: number }
  | { kind: "function"; code: number }
  | { kind: "macro"; slot: number };

export type GloriousLayerKeys = Readonly<Record<string, GloriousBinding>>;
export type GloriousMacroMode = "once" | "repeat" | "toggle";

export interface GloriousMacroEvent {
  type: "press" | "release";
  /** HID keyboard usage. */
  code: number;
  /** Milliseconds until the next event, 1 to 32767. */
  delay: number;
}

export interface GloriousMacro {
  name: string;
  mode: GloriousMacroMode;
  events: readonly GloriousMacroEvent[];
}

export interface GloriousAnalog {
  /** Actuation point in mm. */
  actuation: number;
  rapid: boolean;
  /** Rapid trigger sensitivity in mm. */
  sensitivity: number;
}

/** Everything sent to one board, kept by the host because the board can't report it. */
export interface GloriousBoardState {
  polling: number;
  profile: number;
  layer: number;
  /** Debounce per profile, ms. */
  debounce: readonly number[];
  /** Lights-off timer, minutes; 255 is never. */
  sleep: number;
  analog: GloriousAnalog;
  /** `keys[profile][layer]`: bindings that differ from the board's own. */
  keys: readonly (readonly GloriousLayerKeys[])[];
  /** Macros by slot (1 to 10). */
  macros: Readonly<Record<number, GloriousMacro>>;
}

export const GLORIOUS_DEFAULT_ANALOG: GloriousAnalog = { actuation: 2.0, rapid: false, sensitivity: 0.2 };

export function gloriousDefaultState(m: GloriousModel): GloriousBoardState {
  return {
    polling: 1000, profile: 0, layer: 0,
    debounce: Array(GLORIOUS_PROFILES).fill(m.defaultDebounce),
    sleep: m.defaultSleep, analog: { ...GLORIOUS_DEFAULT_ANALOG },
    keys: Array.from({ length: GLORIOUS_PROFILES }, () => Array.from({ length: GLORIOUS_LAYERS }, () => ({}))),
    macros: {},
  };
}

/** One frame (report id first) and the pause CORE leaves after it. */
export interface GloriousFrame {
  frame: Uint8Array;
  delayMs: number;
}
export type GloriousJob = GloriousFrame[];

const DELAY_LONG = 550;
const DELAY_KEYS = 150;
const HE_DELAY_KEY = 250;
const GMBK_DELAY = 150;
const ETERNAL_DELAY = 40;

/** Keys a board's controls never change: Fn and the knob, plus what its protocol can't put back. */
export function gloriousLockedKeys(m: GloriousModel): ReadonlySet<string> {
  const locked = ["Fn", "Knob"];
  if (m.protocol === "gmbk") locked.push("AltRight");
  if (m.protocol === "eternal") {
    locked.push("ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft");
  }
  return new Set(locked);
}

/** The keys of a board that can be remapped. */
export function gloriousRemappableKeys(m: GloriousModel): string[] {
  const locked = gloriousLockedKeys(m);
  return Object.keys(GLORIOUS_KEY_INDEX[m.keymap]!).filter((key) => !locked.has(key));
}

const isModifier = (code: number) => code >= 0xe0 && code <= 0xe7;

/** Why a binding can't be sent to this board ("" when it can). */
export function gloriousBindingProblem(m: GloriousModel, b: GloriousBinding, macroSlots: readonly number[] = []): string {
  switch (b.kind) {
    case "disabled":
      return "";
    case "key": {
      if (!Number.isInteger(b.code) || b.code < 4 || b.code > 231) return "Unknown key.";
      const mods = b.mods ?? [];
      if (mods.some((mod) => !GLORIOUS_MODIFIERS.includes(mod))) return "Unknown modifier.";
      if (mods.length && isModifier(b.code)) return "A modifier key can't take extra modifiers.";
      if ((m.protocol === "he" || m.protocol === "gmbk") && mods.length > 1) return "This keyboard takes one modifier with a key.";
      if (m.protocol === "eternal" && isModifier(b.code)) {
        return "This keyboard can't turn a key into a modifier; choose a key with a modifier instead.";
      }
      return "";
    }
    case "media":
      return b.code in GLORIOUS_MEDIA ? "" : "Unknown action.";
    case "mouse":
      return b.code in GLORIOUS_MOUSE ? "" : "Unknown action.";
    case "function":
      if (!(b.code in GLORIOUS_FUNCTIONS)) return "Unknown action.";
      if (m.protocol === "eternal" && b.code !== 1 && b.code !== 2) return "This keyboard switches profiles, not layers.";
      return "";
    case "macro":
      if (!m.macros) return "Macros aren't available on this keyboard.";
      return macroSlots.includes(b.slot) ? "" : "That macro doesn't exist.";
    default:
      return "Unknown action.";
  }
}

/** Why a macro can't be stored ("" when it can). */
export function gloriousMacroProblem(events: readonly GloriousMacroEvent[]): string {
  if (events.length === 0) return "The macro is empty.";
  if (events.length > GLORIOUS_MAX_MACRO_EVENTS) return `A macro holds at most ${GLORIOUS_MAX_MACRO_EVENTS} key presses and releases.`;
  for (const e of events) {
    if (e.type !== "press" && e.type !== "release") return "Unknown macro step.";
    if (!Number.isInteger(e.code) || e.code < 4 || e.code > 231) return "Unknown key in the macro.";
    if (!Number.isInteger(e.delay) || e.delay < 1 || e.delay > 0x7fff) return "Delays are 1 to 32767 ms.";
  }
  return "";
}

const checkSlot = (profile: number, layer: number) => {
  if (!(Number.isInteger(profile) && Number.isInteger(layer)
    && profile >= 0 && profile < GLORIOUS_PROFILES && layer >= 0 && layer < GLORIOUS_LAYERS)) {
    throw new RangeError("Profile and layer are 0 to 2.");
  }
};
const checkSleep = (sleep: number | null) => {
  if (sleep !== null && !(Number.isInteger(sleep) && sleep >= 1 && sleep <= GLORIOUS_SLEEP_NEVER)) {
    throw new RangeError(`Sleep timer ${sleep} isn't supported.`);
  }
};

// ================================================================ GMMK Pro / GMMK 2 / GMMK 3 / Numpad
const GMMK_REPORT_ID = 7;
const GMMK_FRAME_LEN = 264;
const GMMK_SHORT_LEN = 64;
const GMMK_POLLING = GLORIOUS_TRANSPORTS.gmmk.polling;
const MOD_BITS: Readonly<Record<GloriousModifier, number>> = { ctrl: 1, shift: 2, alt: 4, super: 8 };
const T_KEY = 1, T_MODIFIER = 2, T_MEDIA = 3, T_MACRO = 5, T_FUNCTION = 8, T_MOUSE = 9, T_COMBO = 0xe0;
const MACRO_MODES: Readonly<Record<GloriousMacroMode, number>> = { once: 1, repeat: 0xffff, toggle: 0 };

const gmmkFrame = (cmd: number, length = GMMK_FRAME_LEN) => {
  const f = new Uint8Array(length);
  f[0] = GMMK_REPORT_ID;
  f[1] = cmd;
  return f;
};

/** Switch to (and commit) a profile and layer, both 0-based. */
export function gmmkProfileFrame(profile: number, layer: number): Uint8Array {
  checkSlot(profile, layer);
  const f = gmmkFrame(0x01, GMMK_SHORT_LEN);
  f[2] = profile + 1;
  f[3] = layer + 1;
  return f;
}

/** `sleep`: the GMMK 3's lights-off timer, which CORE repeats in this frame. */
export function gmmkPollingFrame(hz: number, sleep: number | null = null): Uint8Array {
  const code = GMMK_POLLING.indexOf(hz);
  if (code < 0) throw new RangeError(`Polling rate ${hz} Hz isn't supported.`);
  checkSleep(sleep);
  const f = gmmkFrame(0x08);
  f[8] = code;
  f[9] = 1;
  if (sleep !== null) f[11] = sleep;
  return f;
}

/** Debounce plus the board's default lighting (Glorious mode, full brightness, side lights on). */
export function gmmkPropertiesFrame(
  profile: number, layer: number, debounceMs: number, sleep: number | null = null, polling: number | null = null,
): Uint8Array {
  checkSlot(profile, layer);
  checkSleep(sleep);
  if (polling !== null && !GMMK_POLLING.includes(polling)) throw new RangeError(`Polling rate ${polling} Hz isn't supported.`);
  if (!(GLORIOUS_DEBOUNCE_MS as readonly number[]).includes(debounceMs)) throw new RangeError(`Debounce ${debounceMs} ms isn't supported.`);
  const f = gmmkFrame(0x07);
  f[2] = profile + 1;
  f[3] = layer + 1;
  f[4] = 1;
  f[5] = 0;
  f[6] = 1;
  f[7] = 0;
  f[8] = 20;
  if (polling !== null) f[9] = GMMK_POLLING.indexOf(polling);
  f[10] = debounceMs;
  if (sleep !== null) f[11] = sleep;
  return f;
}

function gmmkDefaultKeymap(m: GloriousModel): Uint8Array {
  const d = GLORIOUS_DEFAULT_KEYMAPS;
  if (m.keymap === "numpad") return d.numpad.slice();
  if (m.keymap.startsWith("g3w")) {
    const km = d.g3w.slice();
    const n = m.keyCount;
    km[104] = T_MEDIA; km[n + 104] = 3;
    km[109] = T_MEDIA; km[n + 109] = 4;
    if (m.form !== "g3-65") km[n + 1] = 0x35;
    if (m.layout === "iso") { km[107] = T_KEY; km[n + 107] = 0x64; }
    return km;
  }
  if (m.vendorId === GLORIOUS_GMMK3_VENDOR_ID) {
    const km = d.g3.slice();
    if (m.key === "gmmk3-pro-100-ansi") for (const i of [17, 18]) { km[i] = 0xff; km[126 + i] = 0xff; }
    return km;
  }
  if (m.form === "65") return d.g2_65.slice();
  if (m.form === "96") return d.g2_96.slice();
  return (m.layout === "iso" ? d.proIso : d.proAnsi).slice();
}

/** (type, code) of a binding in the GMMK key frame. */
function gmmkEncode(b: GloriousBinding): readonly [number, number] {
  switch (b.kind) {
    case "disabled": return [T_KEY, 0];
    case "key": {
      const mods = (b.mods ?? []).reduce((bits, mod) => bits | MOD_BITS[mod], 0);
      if (mods) return [T_COMBO + mods, b.code];
      return [isModifier(b.code) ? T_MODIFIER : T_KEY, b.code];
    }
    case "media": return [T_MEDIA, b.code];
    case "mouse": return [T_MOUSE, b.code];
    case "function": return [T_FUNCTION, b.code];
    case "macro": return [T_MACRO, b.slot];
  }
}

function checkBindings(m: GloriousModel, keys: GloriousLayerKeys, macroSlots: readonly number[]): void {
  const index = GLORIOUS_KEY_INDEX[m.keymap]!;
  const locked = gloriousLockedKeys(m);
  for (const [key, b] of Object.entries(keys)) {
    if (locked.has(key)) throw new RangeError(`${key} can't be remapped.`);
    if (!(key in index)) throw new RangeError(`Unknown key ${key}.`);
    const problem = gloriousBindingProblem(m, b, macroSlots);
    if (problem) throw new RangeError(`${key}: ${problem}`);
  }
}

/** One layer's whole key assignment: the board's defaults with `keys` applied. */
export function gmmkKeymapFrame(
  m: GloriousModel, profile: number, layer: number, keys: GloriousLayerKeys, macroSlots: readonly number[] = [],
): Uint8Array {
  checkSlot(profile, layer);
  checkBindings(m, keys, macroSlots);
  const index = GLORIOUS_KEY_INDEX[m.keymap]!;
  const data = gmmkDefaultKeymap(m);
  for (const [key, b] of Object.entries(keys)) {
    const i = index[key]!;
    [data[i], data[m.keyCount + i]] = gmmkEncode(b);
  }
  const f = gmmkFrame(0x03);
  f[2] = profile + 1;
  f[3] = layer + 1;
  f.set(data, 8);
  return f;
}

/** How each key bound to a macro plays it. */
export function gmmkMacroModeFrame(
  m: GloriousModel, profile: number, layer: number, keys: GloriousLayerKeys, modes: Readonly<Record<number, GloriousMacroMode>>,
): Uint8Array {
  checkSlot(profile, layer);
  const index = GLORIOUS_KEY_INDEX[m.keymap]!;
  const f = gmmkFrame(0x04);
  f[2] = profile + 1;
  f[3] = layer + 1;
  for (const [key, b] of Object.entries(keys)) {
    if (b.kind !== "macro") continue;
    const value = MACRO_MODES[modes[b.slot] ?? "once"];
    const off = 8 + index[key]! * 2;
    f[off] = value >> 8;
    f[off + 1] = value & 0xff;
  }
  return f;
}

/** One macro's events. */
export function gmmkMacroFrame(slot: number, events: readonly GloriousMacroEvent[]): Uint8Array {
  if (!Number.isInteger(slot) || slot < 1 || slot > GLORIOUS_MAX_MACROS) throw new RangeError("Macro slot out of range.");
  const problem = gloriousMacroProblem(events);
  if (problem) throw new RangeError(problem);
  const f = gmmkFrame(0x05);
  f[2] = slot;
  events.forEach((e, i) => {
    const off = 8 + i * 3;
    f[off] = (e.delay >> 8) | (e.type === "press" ? 0x80 : 0);
    f[off + 1] = e.delay & 0xff;
    f[off + 2] = e.code;
  });
  return f;
}

// ================================================================ GMMK 3 HE / Pro HE
const HE_COMMANDS = new Set([0x04, 0x05, 0x12, 0x13, 0x1a, 0x1d]);
const HE_POLLING = GLORIOUS_TRANSPORTS.he.polling;

export function heChecksum(command: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += command[i]!;
  return 255 - (sum & 0xff);
}

/** Report id 0, then the 64-byte command with its checksum at byte 7. */
function heFrame(cmd: number, params: readonly number[] = [], payload: Readonly<Record<number, number>> = {}): Uint8Array {
  if (!HE_COMMANDS.has(cmd)) throw new RangeError(`Command 0x${cmd.toString(16)} is never sent.`);
  const c = new Uint8Array(64);
  c[0] = cmd;
  params.forEach((v, i) => { c[i + 1] = v; });
  for (const [at, v] of Object.entries(payload)) c[Number(at)] = v;
  c[7] = heChecksum(c);
  const f = new Uint8Array(65);
  f.set(c, 1);
  return f;
}

export function hePollingFrame(profile: number, hz: number): Uint8Array {
  checkSlot(profile, 0);
  const code = HE_POLLING.indexOf(hz);
  if (code < 0) throw new RangeError(`Polling rate ${hz} Hz isn't supported.`);
  return heFrame(0x04, [profile, code]);
}

export function heProfileFrame(profile: number, layer: number): Uint8Array {
  checkSlot(profile, layer);
  return heFrame(0x05, [profile, layer]);
}

/** Standby in minutes (255 never): the USB timer, plus Bluetooth and 2.4 GHz on a wireless board. Deep sleep stays off. */
export function heSleepFrame(minutes: number, wireless: boolean): Uint8Array {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 255) throw new RangeError(`Standby ${minutes} min isn't supported.`);
  const s = minutes === 255 ? 0 : minutes * 60;
  const pay: Record<number, number> = {};
  const u16 = (at: number, v: number) => { pay[at] = v & 0xff; pay[at + 1] = v >> 8; };
  for (const at of [12, 14, 18]) u16(at, 0xffff);
  u16(16, s);
  if (wireless) { u16(8, s); u16(10, s); }
  return heFrame(0x12, [], pay);
}

const mmToFw = (mm: number) => Math.max(1, Math.min(40, Math.round(mm * 10) - 1));

export function heCheckAnalog(a: GloriousAnalog): void {
  const within = (v: number, [lo, hi]: readonly [number, number]) =>
    Number.isFinite(v) && v >= lo - 1e-9 && v <= hi + 1e-9 && Math.abs(v * 10 - Math.round(v * 10)) < 1e-6;
  if (typeof a.rapid !== "boolean") throw new RangeError("Rapid trigger is on or off.");
  if (!within(a.actuation, GLORIOUS_HE_ACTUATION_MM)) throw new RangeError(`Actuation point ${a.actuation} mm isn't supported.`);
  if (!within(a.sensitivity, GLORIOUS_HE_SENSITIVITY_MM)) throw new RangeError(`Sensitivity ${a.sensitivity} mm isn't supported.`);
}

/** "Custom" analog mode, so the board uses the values sent instead of a preset. */
export function heMagnetModeFrame(): Uint8Array {
  return heFrame(0x1d, [3]);
}

/** Every key's actuation point and rapid trigger for one profile and layer. */
export function heActuationFrame(profile: number, layer: number, a: GloriousAnalog): Uint8Array {
  checkSlot(profile, layer);
  heCheckAnalog(a);
  const act = mmToFw(a.actuation);
  const pay: Record<number, number> = { 8: act, 25: mmToFw(HE_DEADZONE_MM) };
  if (a.rapid) pay[9] = pay[10] = mmToFw(a.sensitivity);
  return heFrame(0x1a, [(layer << 4) | profile, 0, a.rapid ? 0x80 : 0, act, 1, 0], pay);
}

const HE_MEDIA: Readonly<Record<number, readonly [number, number, number, number]>> = {
  0: [3, 0, 0x83, 0x01], 1: [3, 0, 0xcd, 0], 2: [3, 0, 0xe2, 0], 3: [3, 0, 0xe9, 0], 4: [3, 0, 0xea, 0],
  5: [3, 0, 0xb7, 0], 6: [3, 0, 0xb6, 0], 7: [3, 0, 0xb5, 0],
};
const HE_MOUSE: Readonly<Record<number, readonly [number, number, number, number]>> = {
  1: [1, 0, 0xf0, 2], 2: [1, 0, 0xf1, 0], 3: [1, 0, 0xf2, 0], 4: [1, 0, 0xf4, 0], 5: [1, 0, 0xf3, 0],
  6: [1, 0, 0xf8, 0xff], 7: [1, 0, 0xf8, 1],
};
const HE_MOD_USAGE: Readonly<Record<GloriousModifier, number>> = { ctrl: 0xe0, shift: 0xe1, alt: 0xe2, super: 0xe3 };

/** The four keycode bytes of a binding; null is the key's own usage. */
function heKeycode(b: GloriousBinding | null, ownUsage: number): readonly [number, number, number, number] {
  if (b === null) return isModifier(ownUsage) ? [0, ownUsage, 0, 0] : [0, 0, ownUsage, 0];
  switch (b.kind) {
    case "disabled": return [0, 0, 0, 0];
    case "key": {
      if (isModifier(b.code)) return [0, b.code, 0, 0];
      const mod = b.mods?.[0];
      return [0, mod ? HE_MOD_USAGE[mod] : 0, b.code, 0];
    }
    case "media": return HE_MEDIA[b.code]!;
    case "mouse": return HE_MOUSE[b.code]!;
    case "function": return [8, 0, b.code, 0];
    case "macro": throw new RangeError("Macros aren't available on this keyboard.");
  }
}

export function heKeyFrame(profile: number, layer: number, keyNumber: number, code: readonly number[]): Uint8Array {
  checkSlot(profile, layer);
  if (!Number.isInteger(keyNumber) || keyNumber < 0 || keyNumber >= 168 || code.length !== 4) throw new RangeError("Bad key.");
  return heFrame(0x13, [profile, keyNumber, layer, 0], Object.fromEntries(code.map((v, i) => [8 + i, v])));
}

/** (profile, layer), 0-based, from a "profile changed on the board" event; null for anything else. */
export function heParseEvent(data: Uint8Array): readonly [number, number] | null {
  if (data.length >= 4 && data[0] === 5 && data[1] === 0x01 && data[2]! < GLORIOUS_PROFILES && data[3]! < GLORIOUS_LAYERS) {
    return [data[2]!, data[3]!];
  }
  return null;
}

// ================================================================ GMBK 75%
const GMBK_POLLING_CODE: Readonly<Record<number, number>> = { 1000: 0, 500: 1, 250: 3, 125: 7 };
const GMBK_MOD_INDEX: Readonly<Record<GloriousModifier, number>> = { ctrl: 0, shift: 1, alt: 2, super: 3 };

/** One profile's settings: Win-lock off, Windows mode, default debounce and knob sensitivity, as CORE sends them. */
export function gmbkSettingsFrame(profile: number, polling: number, standby: number): Uint8Array {
  checkSlot(profile, 0);
  const code = GMBK_POLLING_CODE[polling];
  if (code === undefined) throw new RangeError(`Polling rate ${polling} Hz isn't supported.`);
  const minutes = standby === GLORIOUS_SLEEP_NEVER ? 0 : standby;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > GMBK_STANDBY_MAX) throw new RangeError(`Standby ${standby} min isn't supported.`);
  return Uint8Array.from([7, 0x11, profile + 1, 0, 0, code, GMBK_DEFAULT_DEBOUNCE, minutes, 0]);
}

function gmbkDefaultPairs(layer: number): Uint8Array {
  const km = GLORIOUS_DEFAULT_KEYMAPS.gmbk.slice();
  if (layer === 1) { km[2 * 115] = 0x0d; km[2 * 115 + 1] = 0x02; }
  return km;
}

/** One layer's whole key assignment: the board's defaults with `keys` applied. */
export function gmbkKeysFrame(m: GloriousModel, profile: number, layer: number, keys: GloriousLayerKeys): Uint8Array {
  checkSlot(profile, layer);
  checkBindings(m, keys, []);
  const index = GLORIOUS_KEY_INDEX[m.keymap]!;
  const pairs = gmbkDefaultPairs(layer);
  for (const [key, b] of Object.entries(keys)) {
    const i = index[key]!;
    const mod = b.kind === "key" ? b.mods?.[0] : undefined;
    [pairs[2 * i], pairs[2 * i + 1]] = b.kind === "key" && mod ? [T_COMBO + GMBK_MOD_INDEX[mod], b.code] : gmmkEncode(b);
  }
  const f = new Uint8Array(256);
  f.set([7, 0x03, profile + 1, layer + 1]);
  f.set(pairs, 4);
  return f;
}

// ================================================================ GMMK Eternal 96
const ETERNAL_FRAME_LEN = 64;
const ETERNAL_POLLING_CODE: Readonly<Record<number, number>> = { 1000: 0, 500: 1, 250: 2, 125: 3 };
const ETERNAL_MEDIA: Readonly<Record<number, number>> = { 0: 0x183, 1: 0xcd, 2: 0xe2, 3: 0xe9, 4: 0xea, 5: 0xb7, 6: 0xb6, 7: 0xb5 };
const ETERNAL_MOUSE: Readonly<Record<number, number>> = { 1: 1, 2: 2, 3: 3, 4: 5, 5: 4, 6: 8, 7: 9 };
const ETERNAL_FUNCTIONS: Readonly<Record<number, number>> = { 2: 1, 1: 2 };

export function eternalChecksum(f: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < ETERNAL_FRAME_LEN - 1; i++) sum += f[i]!;
  return (0xff - sum) & 0xff;
}

function eternalFrame(cmd: number, val: number, payload: readonly number[], lengthByte = payload.length): Uint8Array {
  if (payload.length > 56) throw new RangeError("Payload too long.");
  const f = new Uint8Array(ETERNAL_FRAME_LEN);
  f.set([9, cmd, val, 0, 1, 0, lengthByte]);
  f.set(payload, 7);
  f[ETERNAL_FRAME_LEN - 1] = eternalChecksum(f);
  return f;
}

export function eternalPollingFrame(hz: number): Uint8Array {
  const code = ETERNAL_POLLING_CODE[hz];
  if (code === undefined) throw new RangeError(`Polling rate ${hz} Hz isn't supported.`);
  return eternalFrame(0x04, 0x17, [code]);
}

/** Debounce in microseconds, big-endian. */
export function eternalDebounceFrame(ms: number): Uint8Array {
  if (!Number.isInteger(ms) || ms < ETERNAL_DEBOUNCE_MS[0] || ms > ETERNAL_DEBOUNCE_MS[1]) throw new RangeError(`Debounce ${ms} ms isn't supported.`);
  const us = ms * 1000;
  return eternalFrame(0x04, 0x1e, [us >> 8, us & 0xff]);
}

/** Lights-off timer in seconds, big-endian; 255 minutes (never) is 0. */
export function eternalStandbyFrame(minutes: number): Uint8Array {
  const seconds = minutes === GLORIOUS_SLEEP_NEVER ? 0 : minutes * 60;
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 0xffff) throw new RangeError(`Standby ${minutes} min isn't supported.`);
  return eternalFrame(0x04, 0x23, [seconds >> 8, seconds & 0xff]);
}

export function eternalProfileFrame(profile: number): Uint8Array {
  checkSlot(profile, 0);
  return eternalFrame(0x10, 0, [profile]);
}

function eternalKeycode(b: GloriousBinding | null, ownUsage: number): readonly [number, number, number, number] {
  if (b === null) return [0, 0, 0, ownUsage];
  switch (b.kind) {
    case "disabled": return [0, 0, 0, 0];
    case "key": return [0, (b.mods ?? []).reduce((bits, mod) => bits | MOD_BITS[mod], 0), 0, b.code];
    case "media": { const usage = ETERNAL_MEDIA[b.code]!; return [2, 0, usage >> 8, usage & 0xff]; }
    case "mouse": return [1, ETERNAL_MOUSE[b.code]!, 0, 0];
    case "function": return [6, ETERNAL_FUNCTIONS[b.code]!, 0, 0];
    case "macro": throw new RangeError("Macros aren't available on this keyboard.");
  }
}

/** One key on one layer of the active profile. */
export function eternalKeyFrame(layer: number, position: number, code: readonly number[]): Uint8Array {
  checkSlot(0, layer);
  if (!Number.isInteger(position) || position < 1 || position > 106) throw new RangeError("Unknown key.");
  return eternalFrame(0x03, layer & 3, [position >> 8, position & 0xff, ...code], 6);
}

// ================================================================ jobs: what a change sends
const sleepByte = (m: GloriousModel, s: GloriousBoardState) => (m.sleep ? s.sleep : null);
const pollingByte = (m: GloriousModel, s: GloriousBoardState) => (m.pollingInProperties ? s.polling : null);
const macroSlots = (s: GloriousBoardState) => Object.keys(s.macros).map(Number);

/** Polling rates the board takes, slowest first. */
export function gloriousPollingChoices(m: GloriousModel): number[] {
  return [...GLORIOUS_TRANSPORTS[m.protocol].polling].sort((a, b) => a - b);
}

/** Debounce choices in ms; empty where the board's unit isn't known (GMBK). */
export function gloriousDebounceChoices(m: GloriousModel): number[] {
  if (m.protocol === "gmbk" || m.protocol === "he") return [];
  return [...GLORIOUS_DEBOUNCE_MS];
}

/** Lights-off timer choices in minutes (255 never); empty without a timer. */
export function gloriousSleepChoices(m: GloriousModel): number[] {
  if (!m.sleep) return [];
  return [...GLORIOUS_SLEEP_MINUTES];
}

/** Whether a layer switch is a board command (the Eternal has none: layers only choose which keys are edited). */
export const gloriousLayerSwitches = (m: GloriousModel) => m.protocol !== "eternal";

const gmbkSettings = (polling: number, standby: number): GloriousJob =>
  Array.from({ length: GLORIOUS_PROFILES }, (_, p) => ({ frame: gmbkSettingsFrame(p, polling, standby), delayMs: GMBK_DELAY }));

export function gloriousPollingJob(m: GloriousModel, s: GloriousBoardState, hz: number): GloriousJob {
  switch (m.protocol) {
    case "gmbk": return gmbkSettings(hz, s.sleep);
    case "eternal": return [{ frame: eternalPollingFrame(hz), delayMs: ETERNAL_DELAY }];
    case "he": return Array.from({ length: GLORIOUS_PROFILES }, (_, p) => ({ frame: hePollingFrame(p, hz), delayMs: DELAY_LONG }));
    case "gmmk":
      if (m.pollingInProperties) {
        return [{ frame: gmmkPropertiesFrame(s.profile, s.layer, s.debounce[s.profile]!, sleepByte(m, s), hz), delayMs: DELAY_LONG }];
      }
      return [{ frame: gmmkPollingFrame(hz, sleepByte(m, s)), delayMs: DELAY_LONG }];
  }
}

/** The lights-off timer, written the way CORE writes it (on the GMMK 3: the polling frame and every properties frame). */
export function gloriousSleepJob(m: GloriousModel, s: GloriousBoardState, minutes: number): GloriousJob {
  if (!m.sleep) throw new RangeError("This keyboard has no lights-off timer.");
  switch (m.protocol) {
    case "he": return [{ frame: heSleepFrame(minutes, m.wireless), delayMs: DELAY_LONG }];
    case "gmbk": return gmbkSettings(s.polling, minutes);
    case "eternal": return [{ frame: eternalStandbyFrame(minutes), delayMs: ETERNAL_DELAY }];
    case "gmmk": {
      const polling = pollingByte(m, s);
      const job: GloriousJob = polling === null ? [{ frame: gmmkPollingFrame(s.polling, minutes), delayMs: DELAY_LONG }] : [];
      for (let p = 0; p < GLORIOUS_PROFILES; p++) {
        for (let layer = 0; layer < GLORIOUS_LAYERS; layer++) {
          job.push({ frame: gmmkPropertiesFrame(p, layer, s.debounce[p]!, minutes, polling), delayMs: DELAY_LONG });
        }
      }
      return job;
    }
  }
}

/** Debounce for the active profile (the Eternal: the whole board). Lighting goes back to the board's default. */
export function gloriousDebounceJob(m: GloriousModel, s: GloriousBoardState, ms: number): GloriousJob {
  if (m.protocol === "eternal") return [{ frame: eternalDebounceFrame(ms), delayMs: ETERNAL_DELAY }];
  if (m.protocol !== "gmmk") throw new RangeError("This keyboard's debounce isn't changed by OpenMouse.");
  return Array.from({ length: GLORIOUS_LAYERS }, (_, layer) => ({
    frame: gmmkPropertiesFrame(s.profile, layer, ms, sleepByte(m, s), pollingByte(m, s)), delayMs: DELAY_LONG,
  }));
}

/** Macros the layer uses, then its key assignment; no commit. */
function layerJob(m: GloriousModel, p: number, layer: number, keys: GloriousLayerKeys, macros: GloriousBoardState["macros"]): GloriousJob {
  if (m.protocol === "gmbk") return [{ frame: gmbkKeysFrame(m, p, layer, keys), delayMs: GMBK_DELAY }];
  const job: GloriousJob = [];
  const used = [...new Set(Object.values(keys).flatMap((b) => (b.kind === "macro" ? [b.slot] : [])))].sort((a, b) => a - b);
  if (used.length) {
    const modes = Object.fromEntries(used.map((slot) => [slot, macros[slot]?.mode ?? "once"]));
    job.push({ frame: gmmkMacroModeFrame(m, p, layer, keys, modes), delayMs: DELAY_KEYS });
    for (const slot of used) {
      const macro = macros[slot];
      if (!macro) throw new RangeError("That macro doesn't exist.");
      job.push({ frame: gmmkMacroFrame(slot, macro.events), delayMs: DELAY_KEYS });
    }
  }
  job.push({ frame: gmmkKeymapFrame(m, p, layer, keys, Object.keys(macros).map(Number)), delayMs: DELAY_KEYS });
  return job;
}

/** After key changes the Pro and Numpad re-select the active layer, as CORE does. */
function commit(m: GloriousModel, s: GloriousBoardState): GloriousJob {
  if (!m.commitKeys) return [];
  const frame = gmmkProfileFrame(s.profile, s.layer);
  return [{ frame, delayMs: DELAY_LONG }, { frame, delayMs: DELAY_LONG }];
}

function heAnalogJob(profile: number, layer: number, analog: GloriousAnalog): GloriousJob {
  return [
    { frame: heProfileFrame(profile, layer), delayMs: DELAY_LONG },
    { frame: heMagnetModeFrame(), delayMs: DELAY_LONG },
    { frame: heActuationFrame(profile, layer, analog), delayMs: DELAY_LONG },
  ];
}

export function gloriousProfileJob(m: GloriousModel, s: GloriousBoardState, profile: number): GloriousJob {
  checkSlot(profile, 0);
  if (m.protocol === "he") return heAnalogJob(profile, s.layer, s.analog);
  if (m.protocol === "eternal") return [{ frame: eternalProfileFrame(profile), delayMs: ETERNAL_DELAY }];
  return [{ frame: gmmkProfileFrame(profile, s.layer), delayMs: DELAY_LONG }];
}

/** Selects a layer on the board and sends its keys again, as CORE does. Empty on the Eternal. */
export function gloriousLayerJob(m: GloriousModel, s: GloriousBoardState, layer: number): GloriousJob {
  checkSlot(s.profile, layer);
  if (m.protocol === "eternal") return [];
  if (m.protocol === "he") return heAnalogJob(s.profile, layer, s.analog);
  const frame = gmmkProfileFrame(s.profile, layer);
  return [{ frame, delayMs: DELAY_LONG }, ...layerJob(m, s.profile, layer, s.keys[s.profile]![layer]!, s.macros), { frame, delayMs: DELAY_LONG }];
}

/** Actuation point and rapid trigger for the active profile and layer (GMMK 3 HE). */
export function gloriousAnalogJob(m: GloriousModel, s: GloriousBoardState, analog: GloriousAnalog): GloriousJob {
  if (m.protocol !== "he") throw new RangeError("This keyboard has no analog keys.");
  return heAnalogJob(s.profile, s.layer, analog);
}

/** Writes the active profile and layer's keys as `next`. */
export function gloriousKeysJob(m: GloriousModel, s: GloriousBoardState, next: GloriousLayerKeys): GloriousJob {
  checkBindings(m, next, macroSlots(s));
  const p = s.profile, layer = s.layer;
  const old = s.keys[p]![layer]!;
  if (m.protocol === "he" || m.protocol === "eternal") {
    const index = GLORIOUS_KEY_INDEX[m.keymap]!;
    const job: GloriousJob = [];
    for (const key of [...new Set([...Object.keys(old), ...Object.keys(next)])].sort()) {
      const before = old[key] ?? null, after = next[key] ?? null;
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      const own = gloriousDefaultUsage(key, m.layout);
      job.push(m.protocol === "he"
        ? { frame: heKeyFrame(p, layer, index[key]!, heKeycode(after, own)), delayMs: HE_DELAY_KEY }
        : { frame: eternalKeyFrame(layer, index[key]!, eternalKeycode(after, own)), delayMs: ETERNAL_DELAY });
    }
    return job;
  }
  return [...layerJob(m, p, layer, next, s.macros), ...commit(m, s)];
}

const usesSlot = (keys: GloriousLayerKeys, slot: number) => Object.values(keys).some((b) => b.kind === "macro" && b.slot === slot);

/**
 * Stores a macro. A macro no key plays yet needs no frames; one in use sends
 * its new steps and, when its play mode changed, every layer's play modes.
 */
export function gloriousMacroJob(m: GloriousModel, s: GloriousBoardState, slot: number, macro: GloriousMacro): GloriousJob {
  if (!m.macros) throw new RangeError("Macros aren't available on this keyboard.");
  if (!Number.isInteger(slot) || slot < 1 || slot > GLORIOUS_MAX_MACROS) throw new RangeError("Macro slot out of range.");
  const problem = gloriousMacroProblem(macro.events);
  if (problem) throw new RangeError(problem);
  const inUse = s.keys.some((profile) => profile.some((keys) => usesSlot(keys, slot)));
  if (!inUse) return [];
  const macros = { ...s.macros, [slot]: macro };
  const job: GloriousJob = [{ frame: gmmkMacroFrame(slot, macro.events), delayMs: DELAY_KEYS }];
  if (s.macros[slot]?.mode !== macro.mode) {
    s.keys.forEach((profile, p) => profile.forEach((keys, layer) => {
      if (!usesSlot(keys, slot)) return;
      const modes = Object.fromEntries(Object.values(keys).flatMap((b) =>
        b.kind === "macro" ? [[b.slot, macros[b.slot]?.mode ?? "once"] as const] : []));
      job.push({ frame: gmmkMacroModeFrame(m, p, layer, keys, modes), delayMs: DELAY_KEYS });
    }));
    job.push(...commit(m, s));
  }
  return job;
}

/** Removes a macro: every key that plays it goes back to normal first. Returns the frames and the keys after. */
export function gloriousDeleteMacroJob(m: GloriousModel, s: GloriousBoardState, slot: number): { job: GloriousJob; keys: GloriousBoardState["keys"] } {
  const macros = Object.fromEntries(Object.entries(s.macros).filter(([k]) => Number(k) !== slot));
  const keys = s.keys.map((profile) => profile.map((layerKeys) =>
    Object.fromEntries(Object.entries(layerKeys).filter(([, b]) => !(b.kind === "macro" && b.slot === slot)))));
  const job: GloriousJob = [];
  keys.forEach((profile, p) => profile.forEach((layerKeys, layer) => {
    if (Object.keys(layerKeys).length !== Object.keys(s.keys[p]![layer]!).length) job.push(...layerJob(m, p, layer, layerKeys, macros));
  }));
  if (job.length) job.push(...commit(m, s));
  return { job, keys };
}

/** (profile, layer), 0-based, from a GMMK "switched on the board" event: input report 4, `F1 pp ll` 1-based (report id not included). */
export function gmmkParseEvent(data: Uint8Array): readonly [number, number] | null {
  if (data.length >= 3 && data[0] === 0xf1 && data[1]! >= 1 && data[1]! <= GLORIOUS_PROFILES && data[2]! >= 1 && data[2]! <= GLORIOUS_LAYERS) {
    return [data[1]! - 1, data[2]! - 1];
  }
  return null;
}

/** The event collection boards announce on-board profile switches on. */
export const GLORIOUS_EVENT_COLLECTIONS: Readonly<Partial<Record<GloriousProtocol, { usagePage: number; usage: number; reportId: number }>>> = {
  gmmk: { usagePage: 0xff00, usage: 0xff00, reportId: 4 },
  he: { usagePage: 0xffff, usage: 0x01, reportId: 0 },
};

/** Whether a frame may go to this board: only the commands built above. */
export function gloriousFrameAllowed(m: GloriousModel, frame: Uint8Array): boolean {
  const t = GLORIOUS_TRANSPORTS[m.protocol];
  if (frame[0] !== t.reportId) return false;
  switch (m.protocol) {
    case "gmmk": return [0x01, 0x03, 0x04, 0x05, 0x07, 0x08].includes(frame[1]!);
    case "gmbk": return [0x01, 0x03, 0x11].includes(frame[1]!);
    case "he": return frame.length === 65 && HE_COMMANDS.has(frame[1]!) && frame[8] === heChecksum(frame.subarray(1));
    case "eternal":
      return frame.length === ETERNAL_FRAME_LEN && frame[63] === eternalChecksum(frame)
        && ((frame[1] === 0x04 && [0x17, 0x1e, 0x23].includes(frame[2]!)) || frame[1] === 0x03 || frame[1] === 0x10);
  }
}
