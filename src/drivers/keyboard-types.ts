/**
 * Shared keyboard status shape. Deliberately NOT MouseStatus: keyboards have
 * no DPI, polling rate, lift-off distance or battery-vs-wired mouse fields,
 * and stuffing them into the mouse grid is what made the old shim drivers
 * report `dpi: 0` / `pollingRateHz: 0` placeholder noise.
 */

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
}
