/**
 * Advanced keys. A key becomes one by holding a keymap action of type DKS,
 * toggle or mod-tap whose `code1` names a slot in that type's table; each
 * profile has 32 slots per table. Rapid snap and SOCD pairs have no table:
 * both keys hold the pair's type with the partner's matrix index in `code2`.
 */
import type { MchoseAction } from "./keymap.ts";

export const MCHOSE_ADVANCED_SLOTS = 32;
export const MCHOSE_DKS_SIZE = 24;
export const MCHOSE_MOD_TAP_SIZE = 6;
export const MCHOSE_TOGGLE_SIZE = 3;

/** Table commands and per-profile strides: read, write, bytes per profile. */
export const MCHOSE_ADVANCED_TABLE = {
  dks: { read: 0xa2, write: 0xa3, stride: 768, record: MCHOSE_DKS_SIZE },
  modTap: { read: 0xa4, write: 0xa5, stride: 256, record: MCHOSE_MOD_TAP_SIZE },
  toggle: { read: 0xa6, write: 0xa7, stride: 128, record: MCHOSE_TOGGLE_SIZE },
} as const;
export type MchoseAdvancedTable = keyof typeof MCHOSE_ADVANCED_TABLE;

/**
 * One DKS action. A DKS key has four zones in travel order: press past the
 * first point, reach the second (bottom), release past the third, release
 * past the fourth. `zones[n]` is how many zones the action stays held from
 * zone n (0 for none); the last zone only takes 0 or 1. This is the vendor
 * app's bar editor, stored as a bit mask of 3 + 3 + 3 + 1 bits.
 */
export interface MchoseDksAction {
  action: MchoseAction;
  zones: [number, number, number, number];
}

export interface MchoseDks {
  /** Zone boundaries in 0.1 mm; the vendor app's default is 1.0, 3.0, 3.0, 1.0 mm. */
  points: [number, number, number, number];
  actions: [MchoseDksAction, MchoseDksAction, MchoseDksAction, MchoseDksAction];
}

export const MCHOSE_DKS_DEFAULT_POINTS: [number, number, number, number] = [10, 30, 30, 10];

const bars = (count: number): number => (count > 0 ? 1 : 0) | (count > 1 ? 2 : 0) | (count > 2 ? 4 : 0);
const count = (bits: number): number => (bits & 4 ? 3 : bits & 2 ? 2 : bits & 1 ? 1 : 0);

/**
 * Pack an action's zones. Spans past the end of the press are folded the way
 * the vendor app does it: a bar over all four zones is stored as 3, 3, 2.
 */
export function mchoseDksMask(zones: readonly number[]): number {
  let [downStart, downEnd, upStart, upEnd] = zones.map((value) => value ?? 0) as [number, number, number, number];
  if (downStart === 4) { downStart = 3; downEnd = 3; upStart = 2; }
  if (downStart === 3) { downStart = 3; downEnd = Math.max(downEnd, 2); }
  if (downEnd === 3) upStart = Math.max(upStart, 2);
  return (bars(downStart) & 7) | ((bars(downEnd) << 3) & 0x38) | ((bars(upStart) << 6) & 0x1c0) | ((upEnd ? 1 : 0) << 9);
}

export function mchoseDksZones(mask: number): [number, number, number, number] {
  return [count(mask & 7), count((mask >> 3) & 7), count((mask >> 6) & 7), (mask >> 9) & 1];
}

export function decodeMchoseDks(record: ArrayLike<number>): MchoseDks {
  const at = (index: number): number => record[index] ?? 0;
  const action = (n: number): MchoseDksAction => {
    const base = 4 + 5 * n;
    return {
      action: { type: at(base), code1: at(base + 1), code2: at(base + 2) },
      zones: mchoseDksZones(at(base + 3) | (at(base + 4) << 8)),
    };
  };
  return { points: [at(0), at(1), at(2), at(3)], actions: [action(0), action(1), action(2), action(3)] };
}

export function encodeMchoseDks(dks: MchoseDks): number[] {
  const out = new Array<number>(MCHOSE_DKS_SIZE).fill(0);
  dks.points.forEach((point, index) => {
    if (!Number.isInteger(point) || point < 1 || point > 40) throw new RangeError("DKS points must be 0.1-4.0 mm.");
    out[index] = point;
  });
  dks.actions.forEach(({ action, zones }, n) => {
    const base = 4 + 5 * n;
    const mask = mchoseDksMask(zones);
    out[base] = action.type; out[base + 1] = action.code1; out[base + 2] = action.code2;
    out[base + 3] = mask & 0xff; out[base + 4] = mask >> 8;
  });
  return out;
}

export interface MchoseModTap {
  tap: MchoseAction;
  hold: MchoseAction;
}

export function decodeMchoseModTap(record: ArrayLike<number>): MchoseModTap {
  const at = (index: number): number => record[index] ?? 0;
  return { tap: { type: at(0), code1: at(1), code2: at(2) }, hold: { type: at(3), code1: at(4), code2: at(5) } };
}

export function encodeMchoseModTap(entry: MchoseModTap): number[] {
  return [entry.tap.type, entry.tap.code1, entry.tap.code2, entry.hold.type, entry.hold.code1, entry.hold.code2];
}

export function decodeMchoseToggle(record: ArrayLike<number>): MchoseAction {
  return { type: record[0] ?? 0, code1: record[1] ?? 0, code2: record[2] ?? 0 };
}

export function encodeMchoseToggle(action: MchoseAction): number[] {
  return [action.type, action.code1, action.code2];
}

export function decodeMchoseTable<T>(data: ArrayLike<number>, record: number, decode: (bytes: number[]) => T): T[] {
  return Array.from({ length: MCHOSE_ADVANCED_SLOTS }, (_, slot) =>
    decode(Array.prototype.slice.call(data, slot * record, slot * record + record) as number[]));
}

/** The advanced-key tables of one profile. */
export interface MchoseAdvancedKeys {
  dks: MchoseDks[];
  modTap: MchoseModTap[];
  toggle: MchoseAction[];
}

/**
 * Keymap types whose `code1` is a slot in the mod-tap table. Rapid snap, SOCD
 * and layer-tap pairs take two consecutive-in-spirit slots there, one per key:
 * the first key's slot holds `{ tap: key 1, hold: key 2 }`, the second key's
 * `{ tap: key 2, hold: key 1 }`, where key 1 and key 2 are what the two keys
 * send. Every one of these types draws from the same 32 slots.
 */
export const MCHOSE_MOD_TAP_TABLE_TYPES: readonly number[] = [0x92, 0x93, 0x94, 0x95];

/**
 * SOCD rule, stored in each pair key's travel `priority`. The first key holds
 * the rule as chosen; the second holds it mirrored (1 and 2 swap).
 */
export const MCHOSE_SOCD_PRIORITY = { lastInput: 0, firstKey: 1, secondKey: 2, cancel: 3 } as const;

export function mchoseMirroredSocdPriority(priority: number): number {
  return priority === 1 ? 2 : priority === 2 ? 1 : priority;
}

/** Mod-tap hold time, stored in the key's keymap action as 10 ms steps. */
export const MCHOSE_MOD_TAP_HOLD_RANGE_MS = { min: 10, max: 2550 } as const;
