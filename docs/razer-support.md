# Razer keyboard support

This is the coverage ledger for the Razer keyboard driver. It separates the
wire facts transcribed from OpenRazer from what this package implements and
what has been exercised on hardware.

## Evidence

- OpenRazer `driver/razercommon.h`, `razercommon.c`,
  `razerchromacommon.c` and `razerkbd_driver.c` on `master`, read 2026-10-29.
  Those files define the 90-byte report, the XOR checksum over bytes 2..87, the
  command classes/ids used here, and the per-model transaction ids.
- OpenRazer `razerkbd_driver.h` for the keyboard product ids. The catalog here
  is a subset of standalone keyboards; Blade laptops, keypads and pre-90-byte
  models are excluded.
- OpenRazer issue #2031 and PR #2054 document the keyboard binding commands:
  class `0x02`/id `0x12` on analog boards and class `0x02`/id `0x0D` on
  non-analog boards, with the argument order and the published Fn-binding
  capture `02 12 01 7f 00 00 00 0c 01 01 00 00 00 00`.
- G HUB's public keyboard catalog was used only as a cross-check for model
  names; it does not define the Razer wire format.
- [OpenRazer `razerchromacommon.c`](https://github.com/openrazer/openrazer/blob/master/driver/razerchromacommon.c)
  defines custom mode `0x0F/0x02` (12 bytes, `00 00 08`), extended row
  `0x0F/0x03` (71 bytes, `00 00 row start stop RGB…`), standard mode
  `0x03/0x0A` (`05 00`), and standard row `0x03/0x0B` (70 bytes,
  `FF row start stop RGB…`). It also defines standard game LED write
  `0x03/0x00` and read `0x03/0x80`, both three bytes, with LED ID `0x08`.
- [OpenRazer `razerkbd_driver.c`](https://github.com/openrazer/openrazer/blob/master/driver/razerkbd_driver.c)
  `razer_attr_write_matrix_effect_custom`,
  `razer_attr_write_matrix_custom_frame`, and
  `razer_attr_{read,write}_game_led_state` enumerate the models and
  command-specific transaction ids. In particular, Huntsman V3 Pro matrix
  writes use `0x1F` while its game LED uses `0xFF`; Huntsman V2 game LED
  uses NOSTORE (`0x00`) with transaction `0x1F`.
- [OpenRazer `razercommon.h`](https://github.com/openrazer/openrazer/blob/master/driver/razercommon.h)
  defines GAME_LED `0x08`, NOSTORE `0x00`, and VARSTORE `0x01`.
- [OpenRazer issue #1259](https://github.com/openrazer/openrazer/issues/1259)
  explicitly reports onboard profile commands `0x05/0x02` and `0x05/0x08`
  as unknown, including their parameters. These are not implemented.

No Razer keyboard has been exercised through this package. The tests use a fake
HID device that answers the same frames; they prove framing and state flow, not
firmware behavior.

## Transport

Razer keyboards carry the control channel on the interface whose HID protocol
is Generic Desktop / Mouse. `isSupported` therefore requires the vendor id,
a catalogued keyboard product id, and a `0x0001:0x0002` collection. A Razer
mouse has the same collection and is rejected by the product-id catalog.

Requests are 90-byte feature reports on report id 0, sent with
`sendFeatureReport(0, frame)`. Replies are read with `receiveFeatureReport(0)`.
The firmware transaction id is not fixed across generations; a mismatch is
silent, so identity/polling/brightness/effect/binding calls probe `0x1f`,
`0x3f`, `0x9f`, `0xff` with the firmware read and keep the first answer.
Custom rows/mode and game LED instead use their upstream PID-specific
transaction ids; a single keyboard may require different ids for each.

## Implemented

| Surface | Wire commands | Behavior |
| --- | --- | --- |
| Identity | `0x00/0x81` firmware, `0x00/0x82` serial | Decodes `major.minor` and the 22-byte serial. |
| Polling rate | `0x00/0xC0` + `0x00/0x40` (extended), `0x00/0x85` + `0x00/0x05` (standard) | Reads extended first, falls back to standard, writes back and verifies. |
| Brightness | `0x0F/0x84` + `0x0F/0x04` (extended matrix), `0x03/0x83` + `0x03/0x03` (standard) | Reads extended first, falls back to standard, writes back and verifies. |
| RGB matrix effects | `0x0F/0x02`, then `0x03/0x0A` | Off, Static, Spectrum, Wave, Breathing (random/single colour) and Reactive. Extended form uses varstore 1 / backlight LED 5; the standard form is the fallback. Write-only. |
| Standard key binding | `0x02/0x0D`, read `0x02/0x8D` | Disable, mouse, keyboard (modifiers + USB usage), macro, multimedia and Fn bindings; the get direction reads the record back. |
| Analog key binding | `0x02/0x12`, read `0x02/0x92` | Onboard slot, Razer layout key, Fn-layer flag, raw actuation/release thresholds, binding type and parameters; the get direction reads the record back. |
| Custom RGB matrix rows | `0x0F/0x03` (extended, 71 bytes) or `0x03/0x0B` (standard, 70 bytes); select mode with `0x0F/0x02` or `0x03/0x0A` | `setCustomMatrixRow(row, startColumn, [[r,g,b], …])` writes an inclusive 1–22-column physical row segment; `activateCustomMatrix()` separately selects custom mode. Both are write-only. No USB-usage-to-matrix-coordinate mapping is claimed. |
| Game-mode LED | `0x03/0x00` write, `0x03/0x80` read, `storage 08 state` | `readGameModeLed()` reads byte 2; `setGameModeLed(boolean)` writes then checks byte 2 on readback. This is the game-mode LED state command, not a portable guarantee that the OS disables particular keys. |

The status object exposes `razer.pollingStyle` and `razer.brightnessStyle` so a
caller can see which command family the model answered. Binding reads use the
get direction; effect writes return after a successful status because no effect
getter is established.

The two new features are intentionally restricted to this evidence-backed
subset of the catalog (all `verified: false`):

| PID / model | Custom mode + row | Game-mode LED |
| --- | --- | --- |
| `0237` BlackWidow Essential | Standard, transaction `FF` | VARSTORE, transaction `FF` |
| `026B` Huntsman V2 Tenkeyless; `026C` Huntsman V2 | Extended, transaction `1F` | NOSTORE, transaction `1F` |
| `02A6` Huntsman V3 Pro; `02A7` Huntsman V3 Pro TKL; `02B0` Huntsman V3 Pro Mini; `02CF` Huntsman V3 Pro 8KHz | Extended, transaction `1F` | VARSTORE, transaction `FF` |

The row encoder refuses more than 22 triplets so RGB data fits the declared
70/71-byte report, and refuses coordinates outside 0–255. Send all desired
segments then select custom mode. Matrix coordinates are physical matrix
positions, not Razer binding scancodes or USB HID usages; no layout map has
been established here. Other catalogued models may have upstream support but
are not implicitly enabled by trying another family.

## Not implemented

- Hardware confirmation of the read direction. The get ids are the write ids
  with bit 7 set (`0x0D`→`0x8D`, `0x12`→`0x92`), following Razer's direction
  convention; the write path is captured, the read path is inferred.
- Converting millimetres to the analog actuation/release bytes. The command
  exposes the raw firmware thresholds instead of inventing a scale.
- Onboard macro upload/readback and onboard profile management. OpenRazer
  exposes macro *bindings* but no keyboard macro program encoding; issue #1259
  calls out unknown `0x05/0x02`/`0x05/0x08` profile parameters. Neither
  guessing an index nor mapping the `VARSTORE` LED/effect argument to an
  onboard profile manager is justified.
- Wireless receiver-attached keyboards: the driver expects the keyboard's own
  control interface.
- Hardware verification for every catalogued model, including the newly added
  custom-matrix and game-LED commands, and for the polling, brightness, effect
  and binding command families each model actually accepts.

A model marked `verified: false` has USB recognition and transcribed protocol
support only. A wrong command family is rejected by the keyboard or fails the
read-back; the driver never invents a value.
