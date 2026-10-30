# SteelSeries Apex Pro support

Coverage ledger for the SteelSeries wired Apex Pro TKL family.

The catalog also includes Apex Pro TKL Wireless (2023) PIDs `0x1630` and
`0x1632` for direct lighting. OpenRGB's [wireless protocol fix](https://gitlab.com/CalcProgrammer1/OpenRGB/-/merge_requests/3237)
identifies `0x61` as its direct-lighting packet and reports a USB test on
`0x1632`. The driver sends OpenRGB's `0x4B` init feature report (64 data
bytes) once per opened connection, then uses a 642-data-byte `0x61` frame
(643 on the wire, matching OpenRGB) for solid and per-key lighting. It does
not expose the wired profile/analog commands or the unconfirmed lighting
release command on those PIDs. Their HID collection and this implementation
still need a hardware test through OpenMouse.

## Evidence

- SteelSeries GG 108.3.0 shipped device descriptions, extracted locally under
  `.rea-cache/steelseries/lisp`: `apex_pro_tkl_2022.lisp`,
  `base_apex_2022_wired.lisp` and `base_apex_2022_legacy.lisp`. These define
  the 645-byte feature report, `00 38 61/62/65/66/67` analog frames, the
  `83 01` profile read and the on-board profile layout.
- [Public GG wire capture for `0x1628` firmware 1.19.7](https://github.com/Ven0m0/steelseriesgg-rs/blob/main/docs/development/apex-pro-tkl-2023-gg-capture.md)
  records `38 67 0a 00 04 07 <mode> …`; its schema-8 profile
  puts Rapid Tap pairs at offset 2650 and enable at 2700. Secondary-layer
  `h`/`l` offsets 1306/1376 follow the GG struct layout, not captured deltas.
  Its authors report a hardware test where a live `38 61` frame changed
  actuation on a real `0x1628`;
  these new command surfaces have **not** had that hardware replay.
- GG's `apex_pro_tkl_2022.lisp` lines 527-549 specify the two `38 61`
  layers (0 and 2); lines 585-661 specify `38 66`, `38 67`,
  `38 83 00`, `1f 81`, `1f 82`, and their HID report channels. GG
  `base_apex_2022_wired.lisp` lines 625-653 specify the secondary threshold
  arrays and five-byte on-board Rapid Tap slots (10 entries). Profile schema
  8 includes those slots, while schema 6/7 do not
  (`apex_pro_tkl_2022.lisp` lines 142-155, 230-243).
- That external report is evidence, not a test performed by this package. No
  SteelSeries keyboard has been exercised through this package; the tests use a
  fake HID device and a synthetic sealed profile.
- [SteelSeries GameSense's image specification](https://github.com/SteelSeries/gamesense-sdk)
  defines 128×40 monochrome images as row-major, MSB-first pixels. The
  community [steelclock-go direct-display implementation](https://github.com/pozitronik/steelclock-go)
  routes PID `0x1628` through `1F 81` with that packing; its Linux path is
  derived from a community reference, not a hardware test by this package.

## Transport

The command collection is usage page `0xFFC0`, usage `0x0001`. Feature frames
are 645 bytes on the wire (one report-id byte plus 644 data bytes); output
frames are 65 bytes (one report-id byte plus 64 data bytes). WebHID calls
therefore pass 644 data bytes to `sendFeatureReport(0, …)` and 64 data bytes to
`sendReport(0, …)`.

Firmware is polled with output `90 00`; the reply is `90 00 <ASCII version>`.
A profile is read in 25 chunks of 500 bytes: feature
`83 01 <fs-id> <size LE16> <offset LE32>`, answered by a feature read whose data
starts behind a three-byte header. File id `0x80 + slot` addresses slots 0..4.

## Implemented

| Surface | Wire frame | Behavior |
| --- | --- | --- |
| Identity | output `90 00` | Firmware version string. |
| Profile read | feature `83 01 …` | 12,500-byte blob, STM32 CRC check, 68 analog keys decoded into actuation, reset point, release mode and rapid-trigger sensitivity. |
| Actuation | feature `38 61 44 00 {hid,h,l}×68` | Patches the requested keys in the current profile, sends all 68, updates the live view. |
| Second actuation | feature `38 61 44 02 {hid,h,l}×68` | Preserves unselected secondary thresholds, applies selected raw actuation points. `0x1628` only. |
| Rapid trigger / Key Guard | feature `38 62 44 {hid,mode}×68` | Modes 0 (off), 2 (Rapid Trigger), 3 (Key Guard), 4. |
| Rapid-trigger sensitivity | feature `38 65 44 {hid,value}×68` | Raw firmware units; the unit is not established. |
| Rapid Tap | output `38 66 0\|1` | Enable or disable. |
| Rapid Tap pairs | output `38 67 0a {index,hid1,hid2,mode-or-0x80,0,0}×10` | Complete ten-slot table, indexed 0–9; `0x80` means report both keys. Requires `0x1628` with schema-8 on-board profile. |
| OLED profile bitmap | feature `38 83 00` + 640 bytes | 640-byte opaque image; decoded bitmap/packing is not assumed. Cached for `saveProfile()`. `0x1628` only. |
| OLED direct image | feature `1f 81` + 640 bytes, output `1f 82` | GameSense image override and release; does not change the cached on-board image. `setOledDirectPixels()` packs 128×40 pixels in row-major MSB-first order. `0x1628` only. |
| Direct lighting | feature `40 count {hid,r,g,b}*86` (wireless: `61`, 642 data bytes, after one `4B` init) | Repaints all 86 addressable keys, including ISO usages `0x32` and `0x64`. The first custom frame must supply all 86 colours; subsequent partial updates preserve colours from that frame. `clearLighting()` sends output `41` to hand control back to the profile and drops the cache. |
| Profile persistence | output `02 01 fs`, feature `03 01 fs …` ×25, output `B1 slot` | `saveProfile()` patches the cached blob, reseals the STM32 CRC, writes all 12,500 bytes, runs validation and compares the read-back byte for byte. |

The new secondary-layer, Rapid Tap-pair and OLED APIs reject other PIDs:
the GG definition is explicitly `0x1628`. The catalogue still includes wired
`0x1642` (Gen 3), but no independent capture establishes these frames there.
The secondary layer needs a recognised device profile schema 4–8; Rapid Tap
pairs require schema 8 (GG chooses that schema for firmware ≥1.19.0). Ten
pair slots, including unused all-zero slots, fill 63 of the 64 output bytes.
Each OLED bitmap must be exactly 640 bytes: the persistent command leaves one
zero feature-data byte for padding; the direct command leaves two.

## Persistence and state

The setters change the keyboard's live settings. `saveProfile()` then patches
the cached 12,500-byte blob from those live values, including secondary
thresholds and (on schema 8) Rapid Tap pairs and OLED image, reseals the CRC,
writes all 25 chunks, sends validation and verifies the read-back byte for
byte. Only the Rapid Tap pair's three defined bytes per five-byte on-board
slot are changed; the two reserved bytes remain as read. A caller that only
wants a volatile change can skip `saveProfile()`. After a live write the cached
object is marked `live: true`; a successful save returns `live: false`.
Direct OLED images (`1f 81`) are temporary and never saved.

## Not implemented

- Hardware verification of the profile write. The CRC and chunk framing are
  vendor-derived; the read-back comparison is implemented but no physical
  board has run it through this package.
- Hardware verification of new `38 67`, second-layer `38 61 02`, OLED
  `38 83 00` and GameSense `1f 81`/`1f 82` writes. The frame shapes are GG
  description-derived, while the capture only observes `38 67`.
- Lighting effects and Prism sync. Only the direct per-key colour frame is
  implemented; there is no lighting read-back, so a partial initial frame is
  rejected until all 86 colours are supplied by the caller.
- On-board OLED `38 83 00` bit order and orientation, plus animation timing,
  are not established by the command descriptions. That API still accepts
  already-packed 640-byte device data.
- Key remaps/macros: GG defines `36` layer-chunk mappings and `37` macro
  events, but `mappings` rewrites all mapping layers, all macro chunks and
  `3c` meta-bitmask as one transaction (`base_apex_2022_wired.lisp` lines
  262-415). Safe partial edits require decoding all three on-board layers
  plus macro references; no standalone per-key remap is claimed.
- Wireless, Mini, Apex 9 and legacy Apex Pro (`0x1610`/`0x1614`/`0x1640`)
  families. Their command bytes and profile layouts differ.
- Hardware verification of any model. `verified: false` means the frames are
  transcribed from shipped vendor descriptions and external captures only.
