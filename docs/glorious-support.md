# Glorious keyboards (stock firmware)

`@openmouse/keyboard-protocol/glorious` and `drivers/glorious/hid.ts` drive
Glorious keyboards on their original Glorious CORE firmware.

## Source and credit

Ported from [Wheelguard](https://github.com/djshiye/wheelguard) by Dino
Klisura (MIT licence), commit `e34953e`: `wheelguard/hw/gmmk.py`,
`gmmk_he.py`, `gmbk.py`, `gmmk_eternal.py`, the frame sequencing in
`wheelguard/gui/keyboard.py` and the test vectors in `tests/test_gmmk.py`.
Wheelguard's protocol notes are in its `docs/gmmk-protocol.md`. Wheelguard
decoded the frames by reading the keyboard code of Glorious CORE 2.1.23,
without running it.

**Nothing here is verified on hardware.** Every board is unconfirmed until
someone tries it and reports back.

## Boards

| Board | USB ids | Protocol |
| --- | --- | --- |
| GMMK Pro ANSI / ISO (and later ANSI / ISO boards) | `320F:5044` / `5046` (`5092` / `5093`) | GMMK |
| GMMK 2 65% ANSI / ISO | `320F:5045` / `504A` | GMMK |
| GMMK 2 96% ANSI / ISO | `320F:504B` / `505A` | GMMK |
| GMMK Numpad | `320F:5088` | GMMK, no macros |
| GMMK 3 and GMMK 3 Pro, 65% / 75% / 100%, ANSI / ISO | `342D:E3C5`-`E3D3` | GMMK, 126 keys, lights-off timer |
| GMMK 3 Pro Wireless, by cable | `342D:E3CB`-`E3CD`, `E3D4`-`E3D6` | GMMK, 110 keys, polling in the properties frame |
| GMMK 3 HE and Pro HE (wired and wireless, by cable) | `342D:E3D7`-`E3F4`, `3794:B300`-`B33B` | HE |
| GMBK 75% ANSI / ISO | `3794:B000` / `B001` | GMBK |
| GMMK Eternal 96% ANSI / ISO | `3794:B010` / `B011` | Eternal |

Bootloader ids are not in the catalog, so they are never opened. A board
flashed with QMK shows QMK's raw HID page instead of the Glorious settings
collection and is left to the VIA driver. The Eternal's stock firmware uses
that same `0xFF60:0x61` page, so it is matched by its own ids, and the
Glorious driver sits ahead of VIA in the registry.

## Transport

| Protocol | Collection | Report |
| --- | --- | --- |
| GMMK, GMBK | `0xFF01:0x01` | feature report 7, padded to the descriptor's size |
| HE | `0xFFFF:0x02` | feature report 0, 64 bytes, checksum at byte 7 |
| Eternal | `0xFF60:0x61` | output report 9, 64 bytes, checksum at byte 63 |

The driver refuses to send when the descriptor's report size is outside
63 to 1023 bytes, and only sends the commands listed below (an allow-list
checked frame by frame before anything goes out). Pauses between frames
match Glorious CORE's.

## What is sent

The boards report none of their settings, so the host keeps what it sent
(`GloriousBoardState`) and every change is planned as a job of frames.

| Setting | GMMK / GMMK 3 | HE | GMBK | Eternal |
| --- | --- | --- | --- | --- |
| Polling rate | `0x08` (Pro Wireless: in `0x07`) | `0x04` per profile, up to 8000 Hz | `0x11` per profile | `0x04 / 0x17` |
| Debounce (2, 8, 16 ms) | `0x07` for each layer of the profile | not offered | not offered (unit unknown) | `0x04 / 0x1E` |
| Lights-off timer | GMMK 3: `0x08` and all nine `0x07` | `0x12` | `0x11` per profile | `0x04 / 0x23` |
| Profile and layer | `0x01` | `0x05` | `0x01` | `0x10` (profile only) |
| Key assignment | `0x03` per layer | `0x13` per key | `0x03` per layer | `0x03` per key |
| Macros (10 slots) | `0x04` modes, `0x05` steps | no | no | no |
| Actuation, rapid trigger | no | `0x1D` then `0x1A` | no | no |

The `0x07` properties frame also carries lighting. OpenMouse writes the
board's own defaults there (Glorious mode, full brightness, side lights on),
so changing debounce or the timer resets lighting to the default.

Never built, so impossible to send: firmware updates and bootloaders,
factory reset, calibration, lighting, the HE travel stream and advanced
per-key modes. Fn and the knob are never remapped; the GMBK also keeps right
Alt (a layer key) and the Eternal keeps its modifiers, which CORE can't put
back.

## Open questions from Wheelguard

- GMMK 2: CORE names `/` and `\` the other way round from its default
  assignment; the default assignment is followed.
- Numpad: CORE indexes macro modes by lighting position, so macros are off.
- GMBK: debounce unit unknown; macros numbered two ways in CORE.
- Eternal: 8000 / 4000 / 2000 Hz known only from a vendor document, left out.

## Wheelguard licence

The ported code is used under Wheelguard's MIT licence, reproduced in full:

```text
MIT License

Copyright (c) 2026 Dino Klisura

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
