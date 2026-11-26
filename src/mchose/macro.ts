/**
 * Macros. The Ace 68 Air keeps 16 macros in one 8 KB region shared by every
 * profile (read 0x0C, write 0x0D at offset 0):
 *
 *   bytes 0-31   start offset of each macro (u16 LE, from the region start)
 *   bytes 32-33  0x81 0x7E, marking the play-mode table as valid
 *   bytes 34-49  play mode per macro
 *   byte 64...   steps, 4 bytes each: [delayLo, delayHi, flags, code]
 *
 * `flags` low six bits: 1 modifier (code is a bit mask), 2 key (HID usage),
 * 3 mouse button (bit mask); 0x40 marks a press, 0x80 the macro's last step.
 * The delay follows the step; the vendor app writes 4 for "no delay" and
 * ignores anything under 5 ms.
 */

export const MCHOSE_MACRO_COUNT = 16;
export const MCHOSE_MACRO_REGION_SIZE = 8192;
export const MCHOSE_MACRO_HEADER_SIZE = 64;
export const MCHOSE_MACRO_MAGIC = [0x81, 0x7e] as const;
export const MCHOSE_MACRO_MIN_DELAY_MS = 5;
export const MCHOSE_MACRO_MAX_DELAY_MS = 0xffff;
const NO_DELAY = MCHOSE_MACRO_MIN_DELAY_MS - 1;

/** Play modes the vendor app offers. */
export const MCHOSE_MACRO_MODE = { whileHeld: 0, once: 1, toggle: 255 } as const;

export interface MchoseMacroStep {
  kind: "key" | "mouse";
  /** HID keyboard usage (modifiers as 0xE0-0xE7), or a mouse button bit (1 left, 2 right, 4 middle, 8 back, 16 forward). */
  code: number;
  down: boolean;
  /** Wait after this step, in milliseconds; 0 for none. */
  delayMs: number;
}

export interface MchoseMacro {
  mode: number;
  steps: MchoseMacroStep[];
}

const KIND_MODIFIER = 1;
const KIND_KEY = 2;
const KIND_MOUSE = 3;
const FLAG_DOWN = 0x40;
const FLAG_END = 0x80;

export function decodeMchoseMacroStep(bytes: ArrayLike<number>): { step: MchoseMacroStep | null; end: boolean } {
  const delay = (bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8);
  const flags = bytes[2] ?? 0;
  const code = bytes[3] ?? 0;
  const kind = flags & 0x3f;
  const end = (flags & FLAG_END) !== 0;
  const down = (flags & FLAG_DOWN) !== 0;
  const delayMs = delay >= MCHOSE_MACRO_MIN_DELAY_MS ? delay : 0;
  if (kind === KIND_MODIFIER) {
    const bit = Math.log2(code);
    if (!Number.isInteger(bit) || bit > 7) return { step: null, end };
    return { step: { kind: "key", code: 0xe0 + bit, down, delayMs }, end };
  }
  if (kind === KIND_KEY) return { step: code === 0 && delayMs === 0 ? null : { kind: "key", code, down, delayMs }, end };
  if (kind === KIND_MOUSE) return { step: { kind: "mouse", code, down, delayMs }, end };
  return { step: null, end };
}

export function encodeMchoseMacroStep(step: MchoseMacroStep, last: boolean): number[] {
  if (!Number.isInteger(step.delayMs) || step.delayMs < 0 || step.delayMs > MCHOSE_MACRO_MAX_DELAY_MS) {
    throw new RangeError("Macro delay must be 0-65535 ms.");
  }
  if (!Number.isInteger(step.code) || step.code < 0 || step.code > 0xff) throw new RangeError("Macro step code must be a byte.");
  const delay = step.delayMs < MCHOSE_MACRO_MIN_DELAY_MS ? NO_DELAY : step.delayMs;
  const modifier = step.kind === "key" && step.code >= 0xe0 && step.code <= 0xe7;
  const kind = step.kind === "mouse" ? KIND_MOUSE : modifier ? KIND_MODIFIER : KIND_KEY;
  const code = modifier ? 1 << (step.code - 0xe0) : step.code;
  return [delay & 0xff, delay >> 8, kind | (step.down ? FLAG_DOWN : 0) | (last ? FLAG_END : 0), code];
}

/** Steps of one macro, from its start offset to its end flag. */
export function decodeMchoseMacroSteps(region: ArrayLike<number>, start: number): MchoseMacroStep[] {
  const steps: MchoseMacroStep[] = [];
  for (let at = start; at + 4 <= region.length; at += 4) {
    const { step, end } = decodeMchoseMacroStep(Array.prototype.slice.call(region, at, at + 4) as number[]);
    if (step) steps.push(step);
    if (end) break;
  }
  return steps;
}

/** Bytes of the region a decoder needs: up to the end flag of the macro that starts last. */
export function mchoseMacroRegionLength(header: ArrayLike<number>, body: ArrayLike<number>): number | null {
  let last = MCHOSE_MACRO_HEADER_SIZE;
  for (let index = 0; index < MCHOSE_MACRO_COUNT; index += 1) {
    last = Math.max(last, (header[2 * index] ?? 0) | ((header[2 * index + 1] ?? 0) << 8));
  }
  for (let at = last; at + 4 <= body.length; at += 4) {
    if (((body[at + 2] ?? 0) & FLAG_END) !== 0) return at + 4;
  }
  return null;
}

export function decodeMchoseMacros(region: ArrayLike<number>): MchoseMacro[] {
  const hasModes = region[32] === MCHOSE_MACRO_MAGIC[0] && region[33] === MCHOSE_MACRO_MAGIC[1];
  return Array.from({ length: MCHOSE_MACRO_COUNT }, (_, index) => {
    const start = (region[2 * index] ?? 0) | ((region[2 * index + 1] ?? 0) << 8);
    const valid = start >= MCHOSE_MACRO_HEADER_SIZE && start < region.length;
    return {
      mode: hasModes ? (region[34 + index] ?? 0) : MCHOSE_MACRO_MODE.whileHeld,
      steps: valid ? decodeMchoseMacroSteps(region, start) : [],
    };
  });
}

/** The whole used region for 16 macros. Empty macros share one end marker at offset 64. */
export function encodeMchoseMacros(macros: readonly MchoseMacro[]): number[] {
  if (macros.length > MCHOSE_MACRO_COUNT) throw new RangeError(`At most ${MCHOSE_MACRO_COUNT} macros.`);
  const header = new Array<number>(MCHOSE_MACRO_HEADER_SIZE).fill(0);
  const body: number[] = [0, 0, FLAG_END, 0];
  header[32] = MCHOSE_MACRO_MAGIC[0];
  header[33] = MCHOSE_MACRO_MAGIC[1];
  for (let index = 0; index < MCHOSE_MACRO_COUNT; index += 1) {
    const macro = macros[index];
    const mode = macro?.mode ?? MCHOSE_MACRO_MODE.whileHeld;
    if (!Number.isInteger(mode) || mode < 0 || mode > 0xff) throw new RangeError("Macro mode must be a byte.");
    header[34 + index] = mode;
    let start = MCHOSE_MACRO_HEADER_SIZE;
    if (macro && macro.steps.length > 0) {
      start = MCHOSE_MACRO_HEADER_SIZE + body.length;
      macro.steps.forEach((step, i) => body.push(...encodeMchoseMacroStep(step, i === macro.steps.length - 1)));
    }
    header[2 * index] = start & 0xff;
    header[2 * index + 1] = start >> 8;
  }
  const region = [...header, ...body];
  if (region.length > MCHOSE_MACRO_REGION_SIZE) throw new RangeError("Macros exceed the keyboard's 8 KB macro memory.");
  return region;
}
