# Wooting support investigation

This is the working coverage ledger for full Wooting support. It separates what
Wootility exposes, what this package implements, and what has been exercised on
hardware. A recognized USB product is not a verified configuration flow.

## Evidence

- Installed Wootility 5.4.2, `/Applications/Wootility.app/Contents/Resources/app.asar`, SHA-256 `44a1cf3deb66a732dca9e402c326e077a0a8510a1bdc5552b3c9de30507863b8`.
- REA static analysis of `package.json`, `dist-electron/main.js`, and `dist-electron/preload.js`: `ev_87630563697468d1c4eadc4bec522579c7c038d34e3e4e508ce4de7abf31b428`. This is source analysis, not observed execution; renderer code and 756 other files were outside this analysis selection.
- A focused REA run on the obfuscated renderer assets reached its 300-second analysis limit before parsing either asset. Its retained partial record is `ev_314f8f65a400d6c71ed4b6bf912bff32a07bc45e9ffb62f337c08a03daf4d331`; it does not establish renderer command or write-path coverage.
- A later debug launch exposed Wootility's Chromium page at `file:///index.html`. REA's Electron target discovery excluded that noncanonical file URL, so a temporary local DevTools probe recorded the arguments passed to WebHID `sendReport` and `sendFeatureReport`. The probe forwarded calls unchanged. This is runtime evidence for outgoing bytes only; acknowledgements and device-side effects were checked through Wootility's UI.
- Read-only Wootility UI inspection showed a connected 60HE+ with ARM firmware 2.13.0. No profile value, keyboard setting, or firmware was changed during inspection.
- Wootility's main-process device descriptors list 13 model base PIDs under VID `0x31e3`; the connected 60HE+ uses variant PID `0x1322` while its catalog base is `0x1320`. The meaning of every possible low-nibble variant remains unverified.

## Device catalog

| Base PID | Wootility model | Firmware family shown by descriptor |
| --- | --- | --- |
| `1100` | One | Standard |
| `1200` | Two | Standard |
| `1210` | Two Lekker Edition | Standard |
| `1220` | Two HE (AVR) | Standard |
| `1230` | Two HE (ARM) | ARM |
| `1300` | 60HE (AVR) | Standard |
| `1310` | 60HE (ARM) | ARM |
| `1320` | 60HE+ | ARM |
| `1340` | 60HE v2 | ARM |
| `1400` | 80HE | ARM |
| `1410` | 80HE+ | ARM |
| `1500` | UwU | Device-dependent |
| `1510` | UwU RGB | Device-dependent |

Wootility also allows legacy Atmel VID `0x03eb` PIDs `0x2402`, `0x2403`,
`0xff01`, and `0xff02`. They map to the One/Two families in the model table;
their HID collection and command behavior have not been captured, so this
package does not offer them in discovery yet.

## Model capability matrix

`wootingModel(productId)` and `wootingCapabilities(productId, firmware)` encode
these Wootility 5.4.2 descriptors. Variant PIDs match with `productId & 0xfff0`.

| Model | Base PID | Transport | Switch | Per-key RT (this package) |
| --- | --- | --- | --- | --- |
| One | `0x1100` | Standard `0x1337` | Flaretech | none |
| Two | `0x1200` | Standard | Flaretech | none |
| Two Lekker Edition | `0x1210` | Standard | Hall | none (Standard RT command not established) |
| Two HE (AVR) | `0x1220` | Standard | Hall | none (same gap) |
| Two HE (ARM) | `0x1230` | ARM `0xFF55` | Hall | partial `>=2.5.3`, full `>=2.10.0-alpha.0` |
| 60HE (AVR) | `0x1300` | Standard | Hall | none (same gap) |
| 60HE (ARM) | `0x1310` | ARM | Hall | partial `>=2.5.3`, full `>=2.10.0-alpha.0` |
| 60HE+ | `0x1320` | ARM | Hall | full `>=2.10.0-alpha.0` |
| 60HE v2 | `0x1340` | ARM | Hall | full `>=2.10.0-alpha.0` |
| 80HE | `0x1400` | ARM | Hall | full `>=2.10.0-alpha.0` |
| 80HE+ | `0x1410` | ARM | Hall | full `>=2.10.0-alpha.0` |
| UwU | `0x1500` | ARM | Hall | full `>=2.10.0-alpha.0` |
| UwU RGB | `0x1510` | ARM | Hall | full `>=2.10.0-alpha.0` |

Full RT caps at 10 keys/group and 30 groups on `>=2.13.0-beta.7` (10 groups
before). Wootility's `ms` gate nominally selects partial RT on AVR Hall-effect
boards, but its Standard device class has no per-key RT method; this package
therefore marks Standard as `none` until a Standard wire shape is established.
`status.capabilities` exposes the same decision to consumers.

## Feature coverage

| Wootility surface | Present package behavior | Still needed for complete support |
| --- | --- | --- |
| Identity and profiles | Firmware, serial, layout, active profile, names, counts; RAM-only profile switch and explicit flash-save commands | Verify all model families and multi-profile writes on physical devices; full profile import/export |
| Actuation and rapid trigger | Saves base defaults and individual actuation overrides with device read-back; decodes packed ARM per-key values; reads and writes ARM per-key RT groups (0x3D/0x1D); default actuation survived a USB power cycle | Multi-group and secondary-sensitivity coverage on other ARM families; linked-namespace selector semantics |
| RGB | Typed core/base/effect-layer codec for all 15 effects; RGB565 color pages; per-model layer limits and effect defaults; ARM core/color staging with read-back; captured Static/Wave round trip | Standard/AVR fixed-128 CRC RGB path, live effect write validation, color-page layout verification |
| Remapping | Reads opaque mapping blocks | Decode key/layer mappings and implement write/read-back, including Fn layers |
| Advanced keys | Reads populated DKS and AKC blocks with multi-part follow-ups; encodes all five payloads; typed DKS packing; corrected SOCD/JIT labels; chunked 10-item writes with read-back | Live validation; exact hold-duration/secondary-actuation units; ARM cap constant reconciliation |
| Gamepad | Reads mapping and profile blocks | Controller type, polling, analog mapping, keyboard override, and write verification |
| Global settings | Reads RGB sleep timers, Num Lock inversion, debounce filter, and device name; field-preserving output write with current-value read-back on ARM | Hardware validation of the write, persistence across power cycles, compatibility mode, and Tachyon |
| Switch selector | Not implemented | Per-key switch type, spacer size, calibration and saved configuration |
| Firmware update and reset | Not implemented | Separate guarded workflows with device-specific recovery and live validation |

The Wootility UI also exposes inactive/onboard profile management and four
onboard slots on the inspected 60HE+. The current package counts readable
populated profiles; it does not model slot capacity separately.

The driver queries `0x31`, `0x18`, and `0x3D` for per-key actuation, DKS, and
per-key rapid trigger. A saved Esc actuation override made `0x31` return
packed field-4 values; an empty `0x31` body means no overrides. The ARM
decoder handles the packed values and retains the complete body. `0x36` is not
the ARM per-key RT store: Wootility's `KeyPropertyProfile` read stays empty
there, which is why the earlier captures looked like missing data. Per-key RT
uses read `0x3D` / write output `0x1D` (see the section below).

## Protobuf schema anchors from Wootility

The shipped main bundle contains generated descriptors for the following
messages. These field numbers provide a starting point for typed decoders;
they do not by themselves identify the command used to write each message.

| Message | Fields |
| --- | --- |
| `GlobalSettings` | 1 RGB sleep timeout, 2 invert Num Lock, 3 debounce filter, 4 device name |
| `RgbSleepTimeout` | 1 dim minutes, 2 off minutes, 3 turn off |
| `DeviceSettings` | 1 NKRO, 2 gamepad mode, 3 force USB full speed, 4 gamepad interval |
| `KeyboardProfile.KBase` | 1 actuation, 2 digital output, 3 rapid trigger enable, 4 sensitivity, 5 Tachyon enable, 6 tick rate, 7 strict actuation range, 8 secondary sensitivity, 9 Tachyon mode |
| `RapidTriggerProfile` | 1 `groups` (repeated `RapidTriggerProfileGroup`) |
| `RapidTriggerProfileGroup` | 1 keys (repeated uint32), 2 config, 3 enabled (oneof `value`) |
| `RapidTriggerConfig` | 1 primary sensitivity, 2 secondary sensitivity, 3 continuous mode |
| `AKCItem` | 1 DKS, 2 Mod Tap, 3 Toggle Key, 4 Rappy Snappy, 5 SOCD, 8 key index, 9 layer |
| `AKC_DKSItem` | 1 key bytes, 2 bitmapped action bytes, 3 optional secondary actuation raw |
| `AKC_ModTapItem` | 1 tap key, 2 hold key, 3 optional hold duration raw, 4 optional JIT activation enum |
| `AKC_ToggleKeyItem` | 1 keybind |
| `AKC_RappySnappyItem` | 1 secondary key, 2 SOCD mode |
| `AKC_SOCDItem` | 1 secondary key, 2 SOCD mode, 3 both on bottom out |
| `RgbEffectLayer` | 1 wave, 2 scan, 3 breath, 4 cycle, 5 ripple, 6 trail, 7 analog touch, 8 analog jelly, 9 analog bomb, 10 analog mixing, 11 rapid trigger, 12 snake, 13 heatmap, 14 noise, 15 spiral |
| `SensorConfigProfile` | 1 sensors, 2 base, 3 switch properties version |

The observed `get_settings` (`0x33`) body
`0a 04 08 05 10 0a 10 00` decodes as a `GlobalSettings` message:
RGB dim after 5 minutes, off after 10 minutes, and Num Lock not inverted.
This was previously treated as opaque bytes in the package.

## 60HE+ write captures

All temporary setting changes below were saved and then restored to their
original values on the connected 60HE+ (ARM firmware 2.13.0). The values in
the final Wootility UI were 0.20 mm actuation, 0.10 mm rapid-trigger
sensitivity, 5-minute RGB dim timeout, and debounce off, with no pending save.
The full traces remain local under `/tmp/wooting-*.json`; they contain other
profile report bytes and are deliberately not committed.

WebHID feature report IDs and output report IDs use different command spaces.
For example, output command `0x15` writes key actuation overrides while feature
command `0x15` is `keys_off`; output `0x17` writes global settings while feature
`0x17` activates a profile. An implementation must never substitute one
transport for the other.

| Change and observed packet | Interpretation |
| --- | --- |
| Save two keys at 0.30 mm: output report ID 1, `d1 da 15 01 0e 00 22 0c 08 a0 80 b4 a6 04 08 ad 81 b4 a6 04` plus zero padding to 32 bytes | Output `0x15`; byte 3 is the save flag, not the profile slot; `KeyMMPropertyProfile.partialEncoded` field 4 contains two packed `rawActuation << 16 \| matrixKey` values. Raw actuation `0x44cd` equals `16384 + round(0.30 × 4096)`; matrix keys are `0x20` and `0xad`. |
| Restore both keys to 0.20 mm: output report ID 1, `d1 da 15 01 00 00` plus zero padding | No per-key actuation overrides remain at the profile default. |
| Save two keys at 0.20 mm RT sensitivity: output report ID 1, `d1 da 1d 01 0f 00 0a 0d 08 20 08 ad 01 12 06 08 b3 86 01 18 01` plus padding | Output `0x1d`; one `RapidTriggerProfile` group with two keys, primary sensitivity raw `17203` (0.20 mm), and continuous mode true. |
| Restore RT sensitivity to 0.10 mm: output report ID 1, `d1 da 1d 01 00 00` plus padding | No rapid-trigger override group remains at the profile default. |
| Change RGB dim timer from 5 to 10 minutes: output report ID 1, `d1 da 17 00 08 00 0a 04 08 0a 10 0a 10 00` plus padding | Output `0x17` carries the complete `GlobalSettings` protobuf; RGB sleep field 1 contains dim/off minutes. |
| Enable debounce: output report ID 1, `d1 da 17 00 0a 00 0a 04 08 05 10 0a 10 00 18 01` plus padding | GlobalSettings field 3 is the debounce flag. Restoring it sends field 3 with value zero. |
| Change the RGB base effect Static to Wave: output report ID 2, `d1 da 16 00 29 00 0a 13 08 ff 01 10 ff ff 03 ...` plus padding to 62 bytes | Output `0x16` carries a 41-byte RGB profile core message for slot 0. Restoring Static sent the same command with a 31-byte message. This command is distinct from feature `0x16` (`keys_on`). |
| Add a temporary Toggle Key binding on Menu: output report ID 2, `d1 da 18 00 1d 00 0a 0c 2a 06 08 63 10 04 18 00 40 61 48 00 0a 09 1a 02 08 77 40 ab 01 48 00 10 00 18 02` plus padding | Output `0x18` stages the complete AKC profile. The existing SOCD A/D entry remained in the message; the new field-1 item contains Toggle Key field 3, matrix key `0xab`, and layer 0. The trailing item count changed from 1 to 2. |
| Remove that Toggle Key and restore the saved profile: output report ID 1, `d1 da 18 00 12 00 0a 0c 2a 06 08 63 10 04 18 00 40 61 48 00 10 00 18 01` plus padding | The original 18-byte AKC message returned, with one SOCD A/D item and no Toggle Key. Wootility showed one active advanced key and no pending save. |

An input-report listener saw only the periodic `0x49` reply during a global
settings write, with no reply echoing output command `0x17` in that capture.
The driver must read settings back before reporting such a write as confirmed;
the UI toggle alone does not prove the device retained it.

The driver now implements that read-back check for the observed ARM output
`0x17` format. It starts with the full device message, replaces only requested
fields, and preserves unknown fields. A fake device test covers a successful
read-back and a board that ignores the write. This has not yet been exercised
through OpenMouse against the physical 60HE+; read-back of a live setting also
does not prove power-cycle persistence.

Wootility's complete profile save transmitted 25 non-heartbeat writes across
output report IDs 1, 2, 3, and 4, plus feature-report save commands. The
single-packet codecs added here reproduce the observed changed packets, but
the package does not yet implement that complete save transaction or claim
that an isolated output packet persists a setting.

The ordered write sequence was identical in actuation, rapid-trigger, and RGB
effect saves (only payloads differed). `O` means output report and `F` means
feature report; command numbers are scoped to that report type:

| Step | Report and command | Observed role |
| --- | --- | --- |
| 1–3 | O2 `0x16`, O3 `0x0e`, O3 `0x0f` | RGB core and two color pages |
| 4 | F1 `0x08` | Save RGB profile |
| 5–8 | O4 `0x1b` at offsets 0, 32, 64, 96 | Four large RGB/calibration chunks |
| 9–13 | O1 `0x1d`, O1 `0x11`, O2 `0x13`, O1 `0x12`, O3 `0x14` | Rapid trigger, keyboard base, gamepad, a second small block, first mapping chunk |
| 14–17 | O3 `0x14` at parts 1 and 2, O1 `0x14` part 3, O1 `0x15` | Remaining mapping chunks and key actuation overrides |
| 18–19 | O1 `0x18`, F1 `0x35` | Advanced key block then save AKC profile |
| 20–22 | O1 `0x1a` scope 1, F1 `0x48`, O1 `0x1a` scope 0 | Profile metadata and a save tracker read (`QQ.getProfileSaveTracker`) |
| 23–25 | O1 `0x07`, O1 `0x28`, O1 `0x17` | Final activation/device/global writes; exact semantics still need read-back correlation |

This sequence is evidence of what Wootility sent on the 60HE+; the tentative
roles are not a safe reconstruction recipe. The large `0x1b` blocks still
need decoding before a complete profile save can be exposed.

The ARM keyboard base profile has a narrower write path: Wootility sends
output `0x11` with byte 3 set to the save flag. `writeAnalogDefaults` reads
the active profile, patches its actuation and rapid-trigger base fields while
preserving other protobuf fields, writes that complete base message, and
requires a matching device read-back. It requires explicit confirmation.
Tests cover an applying and an ignoring board. A 0.25 mm default actuation
saved through OpenMouse remained 0.25 mm after the device's `reload_profile`
command (`0x26`), which reloads flash into active state. The user then
unplugged and reconnected the 60HE+; OpenMouse reconnected and read 0.25 mm
from the keyboard. The original 0.20 mm default was restored and read back,
and Wootility reconnected with no pending save.

`editPerKeyActuation` reads the complete `0x31` block, changes one matrix key,
writes output `0x15` with the save flag, and verifies every override on
read-back. A live 60HE+ no-op and changed-value save both passed; the changed
value survived `reload_profile`, and Wootility displayed it after reopening.
The temporary override was removed, with the empty `0x31` body verified after
reload. The method supports report IDs 1–4 by message size, but reports 2–4
have not been validated on hardware for this command.

The driver can now stage a complete RGB core message and compare the immediate
`get_rgb_profile_core` reply byte-for-byte. Tests simulate both an applying and
an ignoring board. This is still not a complete RGB effect editor or a proven
flash save.

The same Toggle Key capture supports an AKC save path for complete messages up
to 56 bytes: output `0x18`, feature save `0x35`, then raw `get_akc_profile`
read-back. The driver requires an explicit flash-write confirmation. Tests
cover an applying and an ignoring board; the path has not yet been exercised
through OpenMouse on the physical keyboard. Larger AKC profiles remain
unsupported. The codec now encodes all five subtype payload shapes from the
shipped Wootility descriptors and can replace one AKC entry while preserving
the other entries and unknown top-level fields. The driver exposes a
read-modify-save operation for one item on the captured AKC scope 0. Wootility's
SOCD and Toggle Key payloads are exact packet tests; a fake-device add/remove
round trip verifies that the SOCD entry survives. The raw binding codes and
timing units for other subtypes still need UI correlation.

A further controlled UI probe captured the Gamepad enable switch. Enabling it
sent output report ID 1 `d1 da 07 00 00 00 00 00 00 0a` plus padding to 32
bytes, followed by feature command `0x19` (soft reset). Disabling it sent the
same report with byte 9 changed to `0x0c`, again followed by `0x19` and device
reconnection. There was no enabled Save button. Wootility showed Gamepad off
and no pending save after restoration. The meaning of the other bits in output
`0x07` is not yet established, so this is not a safe gamepad writer. A drag
attempt on the Remap screen did not stage an edit, so no remap write format is
established by that probe.

## Per-key rapid trigger (0x3D read / 0x1D write)

Wootility 5.4.2's full per-key rapid-trigger store is a separate pair from the
legacy `0x36` read:

| Wootility method | Wire | Payload |
| --- | --- | --- |
| `getFullRapidTriggerProfile(profileId)` | feature read `0x3D` | selector `(namespace << 8) \| profileIndex` in the first two parameter bytes; `0xFFFF` also returned the active profile on the 60HE+ |
| `setFullRapidTriggerProfile(profile, save, profileId)` | output `0x1D` | byte 3 `save \| profileIndex << 1 \| namespace << 6`, then `len:u16` and `profiles.RapidTriggerProfile` |
| `getRapidTriggerProfile(profileId)` | feature read `0x36` | legacy `KeyPropertyProfile`; empty on ARM |

The message is `RapidTriggerProfile { repeated RapidTriggerProfileGroup groups
= 1 }`. Each group carries repeated `keys` (matrix indices), plus oneof
`config` (`RapidTriggerConfig`, field 2) or `enabled` (field 3). A group with
`enabled: true` follows the profile base; `enabled: false` disables rapid
trigger for its keys. `RapidTriggerConfig` fields are 1 primary sensitivity,
2 optional secondary sensitivity, and 3 continuous mode. Sensitivities use the
confirmed `raw = 16384 + mm * 4096` line (0.20 mm = 17203).

Wootility splits at 10 keys per group. It caps the write at 30 groups on
firmware `>= 2.13.0-beta.7` and 10 groups before that. The firmware returns
keys packed (field 1 wire 2), while it accepted the unpacked key encoding
Wootility itself sent in the captured save.

Live 60HE+ (ARM 2.13.0, slot 0) read reply:

```
d1 da 3d 88 0f 00 0a 0d 0a 03 20 ad 01 12 06 08 b3 86 01 18 01
```

That is one group for keys `0x20` and `0xad` at 0.20 mm with continuous mode
on. Slot 1 and feature `0x36` returned empty bodies. The active profile's `0x27`
base reply still had rapid-trigger enable set to `1`, so per-key groups
coexist with the base switch; the package does not clear or set that switch
when editing per-key RT.

Writing the same body back through output `0x1D` with the save bit produced a
byte-identical read-back. A reversible change then moved key `0x20` to 0.10 mm
(continuous on):

```
d1 da 1d 01 19 00 0a 0b 08 ad 01 12 06 08 b3 86 01 18 01 0a 0a 08 20 12 06 08 9a 83 01 18 01
```

Read-back returned one group at 0.20 mm for `0xad` and a second at 0.10 mm
(16794) for `0x20`. Writing the original body back restored the original
reply byte-for-byte. The driver exposes `readPerKeyRapidTrigger` and
confirm-gated `editPerKeyRapidTrigger`; the latter removes/re-adds the target
keys, preserves unknown fields and other groups, and verifies the per-key map
after read-back.

Both live writes fit report ID 1 (32 bytes). Larger profiles use the same
report-size ladder as actuation/RGB (IDs 2–4); those frames are covered by
packet tests, not by a live multi-report save. The save bit persisted through
an immediate read-back; a power-cycle test of an output `0x1D`-only save has
not been run.

## RGB core, effects, and colors

Wootility's ARM RGB core is read with feature `0x32` and staged with output
`0x16`:

```
RgbProfileCore
  1 base        RgbProfileCore.Base
  3 effectLegacy  (oneof effect; AVR/legacy)
  4 effectsV2     RgbEffects { repeated layers = 1 }
```

`Base` is brightness (1), CapsLock (2), FnLock (3), optional ScrollLock (4) and
NumLock (5) active colors. Colors are RGB565 (`0xFFFF` = white). There is no
Static effect message: ARM "Static" is the base brightness plus an
`analogBomb` layer at brightness 127, while the actual static per-key colors
live in the color pages. A live Static→Wave save carried:

```
0a 13 [Base: 255 / 65535 x4]
22 12 0a 08 [Wave color 0 speed 16 direction 0]
      0a 06 4a 04 08 7f 10 00 [AnalogBomb 127]
```

`RgbEffectLayer` is a 15-way oneof with no enable/opacity/blend fields;
presence in the repeated layer list is the enable, and list order is stored.
The effect field tables are implemented in `WootingRgbEffect`:

| # | Effect | Fields |
| --- | --- | --- |
| 1 | Wave | color enum, speed, direction |
| 2 | Scan | size, speed, base brightness, direction |
| 3 | Breath | speed, secondary brightness (no field 2) |
| 4 | Cycle | color enum, speed |
| 5 | KeyRipple | flags, ripple speed, fade speed, base brightness |
| 6 | KeyTrail | base brightness, speed, flags, optional color |
| 7 | AnalogTouch | base brightness, use curve, mode, left/right key |
| 8 | AnalogJelly | base brightness, use curve |
| 9 | AnalogBomb (AOE) | base brightness, use curve |
| 10 | AnalogMixing | use curve |
| 11 | RapidTrigger | base brightness |
| 12 | Snake | size, base brightness, direction, mode, passive speed, curve, decay |
| 13 | Heatmap | empty |
| 14 | Noise | primary/secondary RGB565, speed, scale |
| 15 | Spiral | primary/secondary RGB565, speed/spiral sint32 |

`wootingRgbEffectFields(kind)` returns UI field descriptors (number, boolean,
enum labels, RGB565 color); `wootingRgbEffectDefaults(kind)` supplies the
Wootility defaults. Slider ranges are not encoded in the protobuf.

Colors are read from `0x23`/`0x24` and staged with output `0x0E`/`0x0F` as
`ColorsProfile { repeated ColorRow rows = 1 }`, `ColorRow { repeated uint32
values = 1 }` (packed or unpacked). Page 1 is RGB rows 0–2 and page 2 is rows
3–5; each page is 3 rows × 21 RGB565 values on 60HE-class boards. The per-key
key-to-LED mapping is not yet verified; the driver exposes typed rows but the
safe UI fallback is one solid color across both pages. RGB persistence is
feature `0x08`; the
larger mapping chunks use output `0x1B`. Per-model usable layer counts are
1 (One/Two/Lekker/TwoHE-AVR), 2 (60HE AVR), 4 (60HE ARM/+/v2, TwoHE ARM,
80HE/80HE+), 3 (UwU RGB), 0 (UwU non-RGB). Only 80HE/80HE+ have a lightbar.

`decodeWootingRgbCore`, `encodeWootingRgbCore`, `decodeWootingRgbColors`,
`encodeWootingRgbColors`, `wootingRgbEffectDefaults`, `wootingRgbLayerLimit`,
and `createWootingRgbStaticCore` are the typed entry points. The driver exposes
`readRgbCore`, `readRgbColors`, `writeRgbCore`, `writeRgbColors`, and the raw
`writeRgbProfileCore`. Standard/AVR uses a fixed-128-byte CRC frame and is not
implemented.

## Advanced keys

`AKCItem` carries one of DKS (1), Mod Tap (2), Toggle Key (3), Rappy Snappy (4),
or SOCD (5), plus `keyIndex` (8) and `layer` (9). ARM reads with `0x34`, stages
with output `0x18`, and persists with feature `0x35`; Wootility chunks at 10
items and sets the save bit on the last chunk (the renderer does not always
send the separate `0x35`).

DKS packs four keybind bytes and four `bitmappedActions` bytes. Each point byte
packs the four bindings' 2-bit behavior:

```
byte[point] = action0 | action1<<2 | action2<<4 | action3<<6
behavior: 0 Hold, 1 Down, 2 Up, 3 Single
keys[i] = keybind byte, 255 = empty
```

`encodeWootingDksPayload` implements this. SOCD is
`Both=0, Neither=1, PrimaryPriority=2, SecondaryPriority=3,
LastInputPriority=4`; Mod Tap JIT is `Hold_Modifiers=0, Never=1,
Hold_Always=2, Tap_Always=3`. `wootingSocdModeLabel` and
`wootingJitActivationLabel` expose the labels. Rappy/SOCD `secondaryKey` is a
matrix index; DKS/ModTap/Toggle keybinds are uint32 keybind ids (`255` empty).
Caps are 20 items on AVR and 40 on ARM per the wootswitch table; the renderer
uses a second cap constant whose ARM value is not yet reconciled. ARM
`>=2.7.3-beta.0` removes the one-key-per-layer restriction.

Large profiles are chunked at 10 items. `encodeWootingAkcChunks` builds
`PartialAKCProfile` messages with `startPoint`/`totalItems`,
`encodeWootingAkcChunkReport` frames output `0x18`, and the driver’s
`writeAkcProfile`/`editAkcItem` use the chunked path automatically when the
profile exceeds one report. `readAkc` follows multi-part replies with
`startPoint = items.length`.

## Profiles

Profile identity is `{namespace, index}`. `Default`/onboard allows 4 slots;
`Linked` allows 10. `wootingProfileSelector` returns
`(namespace << 8) | index` (`0xFFFF` for the active profile), and
`encodeWootingProfileSelectorCommand` frames an ARM 16-bit selector read.
Output flag bytes are `save | index << 1 | namespace << 6`. Current profile is
read with `0x0B`, metadata with `0x37`, and switching is
`WootDevInit 0x21 → ActivateProfile 0x17 → settle → ReloadProfile 0x26 →
verify 0x0B`.

Wootility's complete "Save to Keyboard" sequence is ordered: RGB core `0x16`,
color pages `0x0E/0x0F`, feature `0x08` save, mapping chunks `0x1B` ×4, RT
`0x1D`, base `0x11`, gamepad `0x13`, a small `0x12` block, keymap chunks `0x14`,
actuation commit `0x15`, AKC `0x18`, feature `0x35`, metadata `0x1A`, tracker
`0x48`, metadata re-stage, then output `0x07`, `0x28`, and `0x17` (roles not yet
correlated by read-back), and a
final AKC pass. Many blocks persist through their output save bit; RGB and AKC
also use the feature saves. This package currently reads active slot/names/count,
performs the RAM switch sequence, and exposes individual block saves; it does
not implement the complete transaction, linked profiles, import/export, or
profile metadata writes.

## Validation status

The model catalog and Standard/ARM report selection have automated tests.
Existing 60HE+ HID observations in this repository cover reads and a small
write subset, including a live per-key rapid-trigger change and restore through
`0x3D`/`0x1D`. None of the newly cataloged families has been exercised through
OpenMouse in this investigation. Full support requires captures and read-back
tests for the remaining feature rows on representative hardware; a Wootility
screen alone does not establish the bytes sent to a keyboard.
