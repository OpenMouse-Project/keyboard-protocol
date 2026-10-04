/**
 * Shared keyboard status shape. Deliberately NOT MouseStatus: keyboards have
 * no DPI, polling rate, lift-off distance or battery-vs-wired mouse fields,
 * and stuffing them into the mouse grid is what made the old shim drivers
 * report `dpi: 0` / `pollingRateHz: 0` placeholder noise.
 */

import type {
  WootingActuationProfile,
  WootingAkcProfile,
  WootingDksProfile,
  WootingFlashStats,
  WootingGamepadMapping,
  WootingGamepadProfile,
  WootingGlobalSettings,
  WootingMappingProfile,
  WootingProfileField,
  WootingRapidTriggerProfile,
  WootingRgbBlock,
  WootingRgbProfileColors,
} from "@openmouse/keyboard-protocol/wooting";

export interface KeyboardUiHints {
  /** Stable driver id, e.g. "wooting". */
  family?: string;
  /**
   * When false, the host's mouse settings grid stays hidden. Keyboards set
   * this until the host ships a keyboard surface (actuation / rapid trigger).
   */
  settingsReady?: boolean;
  /** Sidebar name before the first status read. */
  defaultDisplayName?: string;
  /**
   * Extra sentence for the connected status line, for states that need
   * explaining (e.g. why live config is unavailable).
   */
  statusNote?: string;
}

export type KeyboardConnectionType = "Wired" | "Wireless" | "Unknown";

/** Decoded actuation for the active profile (0x27) plus global settings (0x33). */
export interface WootingAnalogProfileFull {
  /** Raw actuation from the 0x27 nested field 1 (`16384 + mm * 4096`). */
  actuationRaw: number | null;
  /** Actuation point in millimetres, when the board reports it. */
  actuationMm: number | null;
  /** Every nested varint field of the 0x27 reply, so unknown fields survive. */
  profileFields: readonly WootingProfileField[];
  /** Global settings from 0x33 (actuation, Tachyon, polling, lock + raw). */
  global: WootingGlobalSettings | null;
}

/** Key remaps for one slot: generic blob (0x30) plus Fn layers (0x11/0x12). */
export interface WootingMappings {
  slot: number;
  mapping: WootingMappingProfile | null;
  main: WootingMappingProfile | null;
  function: WootingMappingProfile | null;
}

/** Gamepad layer for one slot (binds 0x28 + mode 0x29). */
export interface WootingGamepad {
  slot: number;
  mapping: WootingGamepadMapping | null;
  profile: WootingGamepadProfile | null;
}

/** RGB blocks for one slot. Sizes/fields only — no effect writes. */
export interface WootingRgb {
  slot: number;
  core: WootingRgbBlock | null;
  colors1: WootingRgbProfileColors | null;
  colors2: WootingRgbProfileColors | null;
  layer: WootingRgbBlock | null;
}

/** Counts + flash health (0x10 / 0x04 / 0x0A / 0x38 / 0x3A). */
export interface WootingDiagnostics {
  keyCount: number | null;
  rgbProfileCount: number | null;
  analogProfileCount: number | null;
  flashConnected: boolean | null;
  flashStats: WootingFlashStats | null;
}

export interface WootingAnalogSnapshotKey {
  usage: number;
  value: number;
  /** Millimetres of travel for `value` (0–255 maps onto 0–4mm). */
  mm: number;
}

/** One-shot analog snapshot (0x14); `available` false means the board stayed silent. */
export interface WootingAnalogSnapshot {
  available: boolean;
  keys: readonly WootingAnalogSnapshotKey[];
}

export interface KeyboardStatus {
  brand: string;
  name: string;
  ui?: KeyboardUiHints;
  connectionType: KeyboardConnectionType;
  connectionDetail: string;
  /** Human-readable identity lines (firmware, layout, serial). */
  firmware: string[];
  firmwareVersion: string | null;
  layout: string | null;
  serial: string | null;
  /** Runtime-active onboard profile slot (0-based), when the board reports it. */
  activeProfile: number | null;
  /** Onboard profile count, when the board reports it. */
  profileCount: number | null;
  /** Profile names by slot; null entries are slots the board would not name. */
  profileNames: readonly (string | null)[];
  /** Actuation + global settings (0x27 + 0x33), when the board answers. */
  analogProfile?: WootingAnalogProfileFull | null;
  /** Per-key actuation overrides for one slot (0x31). */
  perKeyActuation?: WootingActuationProfile | null;
  /** Rapid-trigger profile for one slot (0x36). */
  rapidTrigger?: WootingRapidTriggerProfile | null;
  /** Key mappings for one slot (0x30 / 0x11 / 0x12). */
  mappings?: WootingMappings | null;
  /** Dynamic-keystroke profile for one slot (0x18). */
  dks?: WootingDksProfile | null;
  /** Advanced-keys-combo profile for one slot (0x34). */
  akc?: WootingAkcProfile | null;
  /** Gamepad layer for one slot (0x28 / 0x29). */
  gamepad?: WootingGamepad | null;
  /** RGB blocks for one slot (0x32 / 0x23 / 0x24 / 0x39). Read-only. */
  rgb?: WootingRgb | null;
  /** Counts + flash health (0x10 / 0x04 / 0x0A / 0x38 / 0x3A). */
  diagnostics?: WootingDiagnostics | null;
  /** One-shot analog snapshot (0x14) versus the streaming interface. */
  analogSnapshot?: WootingAnalogSnapshot | null;
}
