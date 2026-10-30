# Keychron Hall-effect keyboards

Keychron's Hall-effect (HE/TMR) boards share one configuration protocol, the
`KC_HE` command group (`0xA9`) on the VIA raw-HID collection. The codec is
`@openmouse/keyboard-protocol/keychron`; the WebHID client is
`KeychronHidClient` in `src/drivers/keychron/hid.ts`.

## Status

Implemented from static analysis of Keychron Launcher and **not yet run against
a physical board**. The unit tests pin the byte layouts Launcher uses; they do
not show firmware behaviour. Treat every write as unverified until a board has
been exercised, and note the gaps below before relying on a value.

## Evidence

- Launcher (`launcher.keychron.com`, `main.d60cabdb24f8f1c7.js`) contains five
  command classes, `getCommandVersion()` 1 to 5, that build the same
  `[0xA9, subcommand, ...]` reports. Their differences are reproduced here:
  one-byte travel up to v4 and 16-bit travel in v5, 4-byte key slots up to v4
  and 7-byte slots in v5, and a v4+ profile-info tail with DKS and snap-tap
  counts (v5 adds the travel unit).
- Reports are 32 bytes, report ID 0, usage page `0xFF60`, usage `0x61`.
- The product catalog (`src/keychron/products.ts`, 169 boards) comes from
  Launcher's per-board definitions at
  `static/device/{vid*65536+pid}/json/v3.json`, gathered on 2026-10-30. A board
  is included when its definition declares the `HE` feature, an `extra.he`
  block or an `axisList`, or when its name says HE/TMR (three boards, marked
  `launcherFlag: false`).

## What is implemented

| Area | Commands |
| --- | --- |
| Identity | version and capability bits, profile count/size/active slot, profile names |
| Travel | actuation, rapid-trigger press/release, global and per-key (`setTravel`) |
| Profiles | select, read and decode the whole buffer, save, clear, rename |
| Advanced keys | DKS decode and write/remove, snap-tap decode and write, turbo/DKR/toggle slot decode |
| Response | curve read/write, live per-key travel |
| Maintenance | calibration start/stop/state, switch axis type read/write, single-key reset, joystick mode |

## Known gaps

- `workMode` and `keyMode` are sent as the raw bytes Launcher uses. Their
  meanings are only partly known (`keyMode` 0 means "write a per-key buffer"),
  so the driver exposes them unnamed.
- The profile buffer layout past the snap-tap region, the v5 DKS/snap-tap
  write offsets beyond what Launcher sets, and turbo/DKR write commands are not
  covered.
- `readStatus` reports connection type as unknown; the raw-HID path is the same
  over USB and the 2.4 GHz receiver, and Bluetooth was not examined.
- `settingsReady` stays false, so hosts do not show a keyboard settings surface
  until a board has verified the writes.
- Non-HE Keychron keyboards (QMK/VIA, ZMK, "DEBOUNCE" boards) use a different
  feature set and are not claimed.
