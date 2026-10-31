/**
 * Lighting. Effect settings live in each profile's 64-byte function config;
 * per-key colours for the "Custom" effect live in a separate table (read
 * 0x0A, write 0x0B, 512 bytes per profile, 3 bytes RGB per matrix slot).
 */

export const MCHOSE_LIGHT_READ = 0x0a;
export const MCHOSE_LIGHT_WRITE = 0x0b;
export const MCHOSE_LIGHT_PROFILE_SIZE = 512;
export const MCHOSE_LIGHT_SLOTS = 128;

export interface MchoseEffect {
  value: number;
  name: string;
  /** The effect takes the chosen colour (otherwise it picks its own). */
  color: boolean;
  speed: boolean;
  direction: boolean;
}

const effect = (value: number, name: string, speed: boolean, direction: boolean, color: boolean): MchoseEffect =>
  ({ value, name, speed, direction, color });

/** Backlight effects of the Ace 68 Air, in the vendor app's order, with its English names. */
export const MCHOSE_ACE68_EFFECTS: readonly MchoseEffect[] = [
  /* @__PURE__ */ effect(0, "Custom", false, false, false),
  /* @__PURE__ */ effect(6, "Horiz Wave", true, true, true),
  /* @__PURE__ */ effect(7, "Vert Wave", true, true, true),
  /* @__PURE__ */ effect(8, "Center Spread", true, true, true),
  /* @__PURE__ */ effect(9, "Star Twinkle", true, false, true),
  /* @__PURE__ */ effect(4, "Breath", true, false, true),
  /* @__PURE__ */ effect(1, "RainbowCycle", true, false, false),
  /* @__PURE__ */ effect(5, "Disco", true, false, false),
  /* @__PURE__ */ effect(3, "Constant On", false, false, true),
  /* @__PURE__ */ effect(2, "Linear Grad", false, false, true),
  /* @__PURE__ */ effect(11, "Bottom Up", true, false, true),
  /* @__PURE__ */ effect(12, "Recip Rebound", true, false, true),
  /* @__PURE__ */ effect(10, "Center Spin", true, true, true),
  /* @__PURE__ */ effect(18, "Diag Flow", true, false, true),
  /* @__PURE__ */ effect(19, "Laser Rain", true, false, true),
  /* @__PURE__ */ effect(20, "Dot Twinkle", true, false, true),
  /* @__PURE__ */ effect(21, "Fireworks", true, false, true),
  /* @__PURE__ */ effect(22, "Triangle Bounce", true, false, true),
  /* @__PURE__ */ effect(14, "Solid Ripple", true, false, true),
  /* @__PURE__ */ effect(13, "Key Ripple", true, false, true),
  /* @__PURE__ */ effect(15, "Key Trail", true, false, true),
  /* @__PURE__ */ effect(16, "Key Firework", true, false, true),
  /* @__PURE__ */ effect(17, "Key Beam", true, false, true),
];

/** Light-box (side) effects of the Ace 68 Air. */
export const MCHOSE_ACE68_SIDE_EFFECTS: readonly MchoseEffect[] = [
  /* @__PURE__ */ effect(0, "Flow", true, false, false),
  /* @__PURE__ */ effect(1, "RainbowCycle", true, false, false),
  /* @__PURE__ */ effect(2, "Breath", true, false, true),
  /* @__PURE__ */ effect(3, "Constant On", false, false, true),
  /* @__PURE__ */ effect(4, "Off", false, false, false),
];

/** Effect value that turns the backlight off. */
export const MCHOSE_LIGHT_OFF = 255;
export const MCHOSE_BRIGHTNESS_MAX = 100;
/** Speed runs 0 (slow) to 4 (fast); the firmware stores `4 - speed`. */
export const MCHOSE_SPEED_MAX = 4;

export interface MchoseRgb { r: number; g: number; b: number }

export interface MchoseLightZone {
  effect: number;
  brightness: number;
  speed: number;
  /** The vendor's "colourful" switch: the effect cycles colours instead of using `color`. */
  rainbow: boolean;
  color: MchoseRgb;
}

export interface MchoseLighting {
  main: MchoseLightZone & { direction: number };
  side: MchoseLightZone;
}

export function decodeMchoseLighting(config: ArrayLike<number>): MchoseLighting {
  const at = (index: number): number => config[index] ?? 0;
  return {
    main: {
      effect: at(8), brightness: at(9), speed: MCHOSE_SPEED_MAX - at(10), direction: at(11), rainbow: at(12) !== 0,
      color: { r: at(14), g: at(15), b: at(16) },
    },
    side: {
      effect: at(24), brightness: at(25), speed: MCHOSE_SPEED_MAX - at(26), rainbow: at(27) !== 0,
      color: { r: at(29), g: at(30), b: at(31) },
    },
  };
}

function checkZone(zone: MchoseLightZone): void {
  const byte = (value: number) => Number.isInteger(value) && value >= 0 && value <= 255;
  if (!byte(zone.effect)) throw new RangeError("Lighting effect must be a byte.");
  if (!Number.isInteger(zone.brightness) || zone.brightness < 0 || zone.brightness > MCHOSE_BRIGHTNESS_MAX) throw new RangeError("Brightness must be 0-100.");
  if (!Number.isInteger(zone.speed) || zone.speed < 0 || zone.speed > MCHOSE_SPEED_MAX) throw new RangeError("Speed must be 0-4.");
  if (![zone.color.r, zone.color.g, zone.color.b].every(byte)) throw new RangeError("Colour channels must be bytes.");
}

/** Field by field, so a zone built with its properties in another order still counts as unchanged. */
const sameZone = (a: MchoseLightZone & { direction?: number }, b: MchoseLightZone & { direction?: number }): boolean =>
  a.effect === b.effect && a.brightness === b.brightness && a.speed === b.speed && a.rainbow === b.rainbow
  && a.direction === b.direction && a.color.r === b.color.r && a.color.g === b.color.g && a.color.b === b.color.b;

/**
 * `config` with new lighting; every byte outside the lighting fields is kept.
 * A zone that did not change is left exactly as stored, so a value the
 * firmware holds outside the app's ranges never blocks editing the other zone.
 */
export function mchoseConfigWithLighting(config: ArrayLike<number>, lighting: MchoseLighting): number[] {
  const stored = decodeMchoseLighting(config);
  const mainChanged = !sameZone(stored.main, lighting.main);
  const sideChanged = !sameZone(stored.side, lighting.side);
  if (mainChanged) checkZone(lighting.main);
  if (sideChanged) checkZone(lighting.side);
  if (mainChanged && (!Number.isInteger(lighting.main.direction) || lighting.main.direction < 0 || lighting.main.direction > 0xff)) throw new RangeError("Direction must be a byte.");
  const next = Array.from(config);
  const main = mainChanged ? lighting.main : null;
  const side = sideChanged ? lighting.side : null;
  if (main) {
    next[8] = main.effect; next[9] = main.brightness; next[10] = MCHOSE_SPEED_MAX - main.speed; next[11] = main.direction;
    if ((next[12] !== 0) !== main.rainbow) next[12] = main.rainbow ? 1 : 0;
    next[14] = main.color.r; next[15] = main.color.g; next[16] = main.color.b;
  }
  if (side) {
    next[24] = side.effect; next[25] = side.brightness; next[26] = MCHOSE_SPEED_MAX - side.speed;
    if ((next[27] !== 0) !== side.rainbow) next[27] = side.rainbow ? 1 : 0;
    next[29] = side.color.r; next[30] = side.color.g; next[31] = side.color.b;
  }
  return next;
}

export function decodeMchoseKeyColors(data: ArrayLike<number>): MchoseRgb[] {
  return Array.from({ length: Math.floor(data.length / 3) }, (_, slot) => ({ r: data[slot * 3] ?? 0, g: data[slot * 3 + 1] ?? 0, b: data[slot * 3 + 2] ?? 0 }));
}

export function encodeMchoseKeyColors(colors: readonly MchoseRgb[]): number[] {
  return colors.flatMap(({ r, g, b }) => {
    if (![r, g, b].every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) throw new RangeError("Colour channels must be bytes.");
    return [r, g, b];
  });
}
