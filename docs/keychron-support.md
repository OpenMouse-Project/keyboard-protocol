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
| Profiles | select, read and decode the whole buffer, save, clear, rename (28-byte UTF-16BE name, length byte `2 * chars`, then save) |
| Advanced keys | DKS decode and write/remove, snap-tap decode and write, turbo/DKR/toggle slot decode |
| Response | curve read/write, live per-key travel |
| Layout and legends | physical key layout per board (`keychronLayoutFor`), keymap read through the standard VIA dynamic-keymap command (`readKeymap`, `readLayerCount`), and `keychronKeycodeLegend` for key labels |
| Maintenance | calibration start/stop/state, switch axis type read/write, single-key reset, joystick mode |

## Layouts and legends

`src/keychron/layouts.ts` holds the physical key layout (position, size,
rotation, knob index) for every catalogued board, 103 distinct layouts taken
from Launcher's definitions with decorative art removed. The profile buffer has
no key names, so legends come from the keymap: the driver reads it with VIA's
`DYNAMIC_KEYMAP_GET_BUFFER` (0x12, 14 keys per read, big-endian keycodes), the
same way Launcher does. `keychronKeycodeLegend` labels basic keycodes,
modifiers, layer keys and mod/layer-tap wrappers, and shows the hex value for
anything else (custom or vendor codes).

## Key remapping

`KeychronHidClient.setKeycode(layer, row, col, code)` sets one key with the
standard VIA `dynamic_keymap_set_keycode` command (`0x05`, big-endian code), as
Launcher does, then reads the key back (`0x04`) and fails if the board did not
keep it. Launcher itself does not wait for a reply, so the read-back is this
driver's addition. Encoders use `0x15`/`0x14` (frames only; no driver method yet).

The keycode tables depend on the VIA protocol version the board reports
(`readViaProtocol`, command `0x01`): layer keys sit at `0x5200`/`0x5220`... on
protocol 11 and later and at `0x5000`/`0x5100`... before that, and the custom
(Keychron-specific) keys start at `0x7E00` (12+), `0x7F00` (11) or `0x5F80`.
`setKeycode` only sends codes the table for the board's version can name, so a
layer or custom code is never sent with the wrong table. `keychronKeycodeCatalog`
builds the picker's categories from the same table, including the board's
custom keys. `remapWarnings` flags replacing the only layer key on a layer.

Not covered: macros, tap-dance and other quantum keycodes beyond the layer,
mod-tap and layer-tap forms, encoder remapping in the driver, and resetting the
keymap. A remap persists in the board's memory.

## Write parameters (from Launcher's call sites)

- `workMode`: Global 0, Static 1, QuickTrigger (rapid trigger) 2.
- `keyMode`: 1 applies to every key; 0 applies to the keys set in a 24-byte
  bitmap (byte `3 * row + floor(col / 8)`, bit `col % 8`).
- Launcher follows every write with `saveProfile`, which the driver leaves to
  the caller.

## Known gaps

- Travel range: Launcher's displayed range is `min` up to `max + deadzone`
  (`extra.he.distance`); the deadzone extends the top, it is not a lower bound.
- The profile buffer layout past the snap-tap region, the v5 DKS/snap-tap
  write offsets beyond what Launcher sets, and turbo/DKR write commands are not
  covered.
- `readStatus` reports connection type as unknown; the raw-HID path is the same
  over USB and the 2.4 GHz receiver, and Bluetooth was not examined.
- `settingsReady` stays false, so hosts do not show a keyboard settings surface
  until a board has verified the writes.
- Non-HE Keychron keyboards (QMK/VIA, ZMK, "DEBOUNCE" boards) use a different
  feature set and are not claimed.
