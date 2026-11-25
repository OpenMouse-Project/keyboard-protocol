# VIA support

`@openmouse/keyboard-protocol/via` speaks the [VIA](https://github.com/the-via/app)
configuration protocol used by QMK/VIA firmware. It is written from the public
protocol and the VIA definition format.

## Hardware verification

Exercised through the OpenMouse UI on one board:

| Board | Id | VIA protocol | Verified |
| --- | --- | --- | --- |
| Anvil Native | `7470:0002` | 11 | identity, layout from its VIA definition, keymap read and write, RGB-matrix controls (brightness, effect, speed, colour), macro write and playback |

Everything else is implemented from the protocol and covered by tests against a
fake board only. Other boards, and VIA protocols other than 11, are unverified.

## Transport

- One raw-HID collection: usage page `0xFF60`, usage `0x61`, 32-byte reports.
- The driver matches the collection only, not vendor or product ids, so any
  VIA board is recognised. Brand drivers in the registry take precedence.
- There is no transaction id. Replies are paired by command id plus the echoed
  addressing bytes, and a timeout faults the session until reconnect.

## Implemented

| Area | Detail |
| --- | --- |
| Identity | protocol version, firmware version (0 is reported as unknown), keycodes version, layout options, uptime |
| Keymap | layer count, whole-keymap buffer read/write (protocol 8+), single key read/write (protocol 7) |
| Keycode names | basic keys, modifier combinations, mod-tap, layer-tap, layer keys (MO/TG/TO/TT/OSL/DF), one-shot modifiers and macro keys, for both QMK numbering generations (legacy up to protocol 10, modern from 11). Lighting keycodes (BL_, RGB_, RM_ and UG_, numbered per protocol generation and offered per the definition's keycode modules), a definition's custom keycodes, and a composer for layer-tap, mod-tap and modifier+key (`viaComposeKeycode`). Unknown codes are shown as hex. |
| Keycode names for files and hosts | `viaKeycodeToLayoutName` / `viaKeycodeFromLayoutName` use the names VIA writes in a `.layout.json` (`KC_A`, `MO(1)`, `LT(1,KC_A)`, `LCTL(KC_A)`, `MT(MOD_LCTL,KC_A)`, hex when unnamed). `viaKeycodeFromEventCode` / `viaEventCodeFromKeycode` map `KeyboardEvent.code` to basic keycodes, for macro recording and for showing the OS layout's legends |
| Encoders | get/set per layer and direction, with read-back |
| Switch matrix | `readSwitchMatrix(rows, cols)` returns one bit mask per row (key tester); the matrix must fit one report (30 bytes) |
| Macros | count, buffer size, raw buffer read/write, and a codec for the action format: text, key tap/down/up and delays (delays need protocol 11). Bytes the codec does not understand round-trip untouched. A text syntax like VIA's macro editor (`{KC_A}`, `{KC_LCTL,KC_C}`, `{+KC_LSFT}` / `{-KC_LSFT}`, `{500}`, `\{`) is read and written by `parseViaMacroExpression` and `viaMacroToExpression`, using the QMK names from <https://docs.qmk.fm/keycodes_basic> (`viaKeycodeFromName`, `viaKeycodeName`). Differences from VIA's editor: `\\` types a backslash, and bytes it cannot name are written as `{raw:...}`. |
| Custom menu | get/set/save by `[channel, valueId, ...]` (lighting and other board settings), and a parser that turns a definition's menus into range, toggle, dropdown, colour and button controls with their `showIf` conditions |
| Definitions | `parseViaDefinition` reads the served v3 form and the older v2 form (v2 names its lighting, for example `qmk_rgblight`, or extends a preset with an object, instead of listing menus; those are expanded to the same controls, v2 `customMenus` are kept, and old firmware addresses them by single value id; Wilba Tech `wt_rgb_backlight` and `wt_mono_backlight` get brightness, effect, speed, colours, sleep and indicator controls on their single value ids, without the per-key custom colour or the lighting keycodes) (`https://usevia.app/definitions/v3/<vendorId*65536+productId>.json`; v2 lives under `/definitions/v2/`), which already has key positions and menus spelled out; the raw KLE files in `the-via/keyboards` are not read. `viaLayoutChoices` decodes the board's layout options, `viaPackLayoutChoices` encodes them, and `viaActiveKeys` selects the matching keys |
| Layout options | read and write (`setLayoutOptions`, a 32-bit keyboard value), with the board's reply returned |

Writes are read back. `setCustomValue` returns what the board reports, which can
differ from the request: boards clamp or round custom values (the Anvil Native
reads one lower near the top of its brightness range), so callers should show the
returned value.

## Not exposed

- EEPROM reset, bootloader jump and macro reset.
- The device-indication value and per-key RGB.
- Macro keycodes above 8 bits. Protocol 11 macros store basic keycodes in one
  byte, so only basic keys can be tapped, held or released.
- Audio and LED-matrix custom channels, whose ids are not confirmed.

## Application-level features

Kept in OpenMouse, not in this package, because they are about files and UI:
saving and restoring a keymap file (keymap, macros, encoders and layout options;
lighting is not included), saving and loading VIA's own `.layout.json`, the rotary
encoder editor, the live key tester, macro recording from the host keyboard, and
showing the OS keyboard layout's legends on keys.

## Definitions

The wire protocol does not carry the key layout or the custom-menu meaning.
Those come from a VIA v3 definition (published from
[`the-via/keyboards`](https://github.com/the-via/keyboards), GPL-3.0). This
package only parses a definition object; fetching and caching it, and matching a
board to one by vendor and product id (`viaVendorProductId`), is left to the
consuming application. `usevia.app` answers a missing definition with an HTML
page and status 200, so treat a body that is not a valid definition as "none".
