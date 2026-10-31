# MCHOSE magnetic keyboards

Vendor id **`0x41E4`**. Implemented from MCHOSE's M HUB web configurator
(`https://www.mchose.com.cn/cizhou/CZ_SHARED_DATA/`, `main.7d734adfcc65efb81c4d.js`,
fetched 2026-10-31), which calls this command set the `glw` family, and
checked against an **Ace 68 Air III** (`0x41E4:0x2132`, firmware 116,
controller `GL8KH-PRO`) over USB on Windows.

MCHOSE also ships keyboards under vendor id `0x3837` that use a different
protocol (`qhw`, report id `0x4D`). Those are not covered here.

| Model | Product id | Status |
| --- | --- | --- |
| Ace 68 Air III | `0x2132` | Verified: every read and write below was exercised on hardware |
| Ace 68 Air II | `0x2120` | Same layout, keymap and command set in the vendor bundle; not tested |

## Transport

The configuration channel is USB interface 1, a top-level collection on
usage page `0x0001` with usage `0x0000`. Interface 0 and 2 carry the
keyboard, mouse, consumer, system and radio collections.

Every request and reply is a 64-byte report with report id 0:

```
[flag, command, 0, checksum, size, offsetLo, offsetHi, 0, data (up to 56)]
```

- Requests use flag `0x55`, replies `0xAA`.
- `checksum` is the low byte of the sum of bytes 4 onwards, over the header
  tail and `size` data bytes. The keyboard uses the same rule for replies.
- A read sends no data and gets `size` bytes back from `offset`. The info
  read answers 31 of the 56 bytes asked for, so a reply may be shorter.
- A write is acknowledged by an echo of the frame with flag `0xAA`.
- Long regions are read 56 bytes at a time. Writes keep every frame at 56
  bytes: the vendor app moves the last frame back so it ends at the end of
  the region, and so does this driver, even when that splits a record.
- A reply shorter than asked for ends the session, except for the info read,
  and a write echo must carry every byte sent. Otherwise a read-modify-write
  could send back zeros for bytes the keyboard never returned.
- A frame with no answer is sent again after a 200 ms pause, twice at most.

## Commands

| Command | Region | Meaning |
| --- | --- | --- |
| `0x03` | 56 | Info: firmware version (u16, shown as hex digits: `0x0116` is "116"), then build date and controller as ASCII |
| `0x04` / `0x0E` | 56 | Profile table read / write |
| `0x05` / `0x06` | 64 at `64 * profile` | Function config read / write |
| `0xA0` / `0xA1` | 1024 at `1024 * profile` | Key-travel table read / write, 8 bytes per matrix slot, 128 slots |
| `0x07` | 512 per layer | Factory keymap, read only |
| `0x08` / `0x09` | 512 at `512 * (4 * profile + layer)` | Keymap read / write, 3 bytes per slot |
| `0x0A` / `0x0B` | 512 at `512 * profile` | Per-key colours (RGB) for the Custom effect |
| `0x0C` / `0x0D` | 8192, shared | Macros |
| `0xA2` / `0xA3` | 768 at `768 * profile` | DKS slots, 24 bytes each |
| `0xA4` / `0xA5` | 256 at `256 * profile` | Mod-tap slots, 6 bytes each |
| `0xA6` / `0xA7` | 128 at `128 * profile` | Toggle slots, 3 bytes each |
| `0xA8` / `0xA9` / `0xB1` | 1 | Start / end / restart calibration |
| `0xF1` / `0xF2` | 1024 at `1024 * profile` | Custom area where the vendor app keeps JSON (profile names) |
| `0xEE` | 1 | Factory reset: a profile index, or 255 for the whole keyboard; the keyboard then sends `0xA2` (or `FA FB FF`) |

### Calibration progress

The vendor app turns on debug mode (function config byte 7, bit 3) for the
active profile while calibrating, and off again when it ends. With debug
mode on, the keyboard sends an unrequested frame for each moving key:

| Byte | Meaning |
|---|---|
| 0 | `0xA0` |
| 1-3 | The key's factory action (type, code1, code2), matched against the factory keymap of layer 0 to find its matrix slot |
| 4-5 | Big-endian; rises with travel (likely the raw sensor reading) |
| 6-7 | Travel, big-endian, 0.01 mm (about 3.41 mm at the bottom); the key counts as down above 10 |
| 10 | Calibration: `0x00` not done, `0x01` after the first full press, `0xFF` after the second |

Seen on hardware during a calibration: the keyboard cycles through every key
about every 10 ms, so a listener sees idle keys too. After the first full
press a key stays at `0x01`, and the keyboard flashes it blue until it is
pressed again.

Debug mode works without calibration too: the keyboard then reports only
keys that move, with their travel (0 at rest, about 341 at the bottom) and
calibration status, and sends nothing while no key moves. The vendor app
draws live press depth from these reports on its key-travel page.

Not implemented: firmware update (`0x5F`, `0x80`-`0x84`), music-sync lighting, layer-tap and key-combination keys, and the
vendor app's cloud presets.

### Profile table

`[orderPosition, count, order[0..3], ...]`. The active profile is
`order[orderPosition]`. Switching profile rewrites byte 0 and sends the
other bytes back as read; the driver confirms by reading the table again.

### Function config

| Byte | Field |
| --- | --- |
| 1, low nibble | Layer mode: `4 * profile`, `+ 2` for the Mac layer |
| 4, low nibble | Polling rate: 4 = 1 kHz, 3 = 2 kHz, 2 = 4 kHz, 1 = 8 kHz (0 = 16 kHz, 5 = 32 kHz on other models) |
| 4, high nibble | Key scan rate option |
| 5 | Global dead zone |
| 6 | Bit 0 Win lock, bit 1 Alt+Tab lock, bit 2 Alt+F4 lock |
| 7 | Bit 0 "berserk" (tachyon) mode, bit 1 bottom rapid trigger, bit 2 travel check, bits 5-7 debounce |
| 8-31, 40-51 | Lighting (left untouched) |
| 35, 36 | Sleep time and mode |

Writes change only the bits being set and send every other byte back as
read, then compare all 64 bytes on read-back.

### Key-travel record

| Byte | Field |
| --- | --- |
| 0 | High nibble `0xA` on every captured key (kept as read), low nibble switch type |
| 1 | Low nibble key mode (0 normal, 1 rapid trigger), high nibble priority |
| 2, 3 bit 0 | Actuation, 9 bits, stored minus one |
| 3 bits 3-4 / 1-2 | Press / release rapid-trigger precision |
| 4, 5 bit 0 | Rapid-trigger press, 9 bits, stored minus one |
| 5 bits 1-7 | Press dead zone |
| 6, 7 bit 0 | Rapid-trigger release, 9 bits, stored minus one |
| 7 bits 1-7 | Release dead zone |

Units, from the vendor app's conversions:

- Actuation and dead zones are 0.01 mm. The app allows actuation from
  0.10 mm to 3.40 mm (every switch it lists for this model has 3.4 mm of
  travel) and dead zones up to 0.50 mm.
- Rapid-trigger steps depend on the key's precision: 0 is 0.01 mm (2-340
  steps), 1 is 0.005 mm and 2 is 0.001 mm (2-500 steps each).

Edits keep the key's switch type and priority. Changing the precision
carries the rapid-trigger distances over in millimetres, clamped to the new
range. Only the 56-byte
windows that changed are written; the whole table is read back to confirm.

### Matrix slots

The 68 keys map to matrix slots through the keyboard's own factory keymap
(`0x07`, layer 0), joined by HID usage with the vendor's drawing. The vendor
app also ships an offline key file whose slot order is different; the
keyboard's order is the one the travel table follows (Caps Lock is the only
key with a deeper factory actuation, 2.50 mm, and sits in slot 46).
`mchoseLayoutFromDefaults` resolves the slots from the connected keyboard;
`MCHOSE_ACE68_LAYOUT` is the same table read from an Air III on firmware 116.

### Key actions

Keymap entries, macros' targets and the advanced-key tables all use 3-byte
actions `[type, code1, code2]`:

| Type | Meaning |
| --- | --- |
| `0x10` | Key: `code1` modifier mask (1 LCtrl … 0x80 RWin), `code2` HID usage; all zero disables the key |
| `0x20` / `0x21` | Mouse button mask / wheel (`code2` 1 up, 0xFF down) |
| `0x30` | Consumer usage, little-endian in `code1, code2` |
| `0x40` | System: 1 power, 2 sleep, 4 wake |
| `0x70` | Macro, `code1` is the macro (0-15) |
| `0x90` / `0x91` / `0x92` | DKS / toggle / mod-tap, `code1` is the slot; mod-tap's `code2` is the hold time in 10 ms |
| `0x93` / `0x94` / `0x95` | Rapid snap / SOCD / layer tap pairs, `code2` the partner key; kept as read |
| `0xF0` | Keyboard functions: Fn layers (`0xFF, n`), lighting and profile shortcuts |

Layers are Windows, Windows Fn, Mac, Mac Fn. A key bound to an advanced key
takes the first slot no key of that profile uses; a slot nothing points at
any more is cleared.

### Rapid snap and SOCD pairs

Pairs have no table of their own: they share the 32 mod-tap slots. Each of
the two keys takes one slot, `{ tap: its own action, hold: the partner's }`,
and its keymap entry is `[0x93 or 0x94, slot, partner's matrix index]`. The
SOCD rule lives in each key's travel priority nibble: 0 last input wins,
1 first key wins, 2 second key wins, 3 neither; the second key holds the
mirrored value (1 and 2 swap). Replacing either key of a pair returns the
partner to its factory action and clears the rule. Layer-tap pairs (`0x95`)
use the same layout and are kept as read.

The vendor app's "combination" keys are modifier+key keymap entries
(`0x10` with both a modifier mask and a usage); it also lists them in its own
storage on the keyboard, which the keyboard does not act on.

### DKS

`[p1, p2, p3, p4, 4 × (type, code1, code2, maskLo, maskHi)]`. The points are
0.1 mm. Each action's mask is 3 + 3 + 3 + 1 bits: how many zones the action
stays held from each point, packed as 1, 3 or 7. A span over all four zones
is stored as 3, 3, 2, as the vendor app writes it.

### Macros

Bytes 0-31 hold each macro's start offset, `0x81 0x7E` at 32 marks the
play-mode table at 34-49 (0 repeat while held, 1 once, 255 repeat until
pressed again), and steps start at 64: `[delay u16 LE, flags, code]`, where
flags are 1 modifier mask, 2 key, 3 mouse, `0x40` press, `0x80` last step.
The delay follows the step; under 5 ms is written as 4, meaning none.
Writing the first frame takes a flash erase (180 ms measured); the driver
resends a frame that gets no answer, twice at most, as the vendor app does.

### Lighting

In the function config: backlight effect, brightness (0-100), `4 - speed`,
direction, "colourful" and RGB at bytes 8-16; the light box at 24-31. Effect
names and which ones take a colour, speed or direction come from the vendor
app.

### Profile names

Profile 0's custom area at 336-615 holds a JSON array of names padded with
`0xFF`. The vendor app stores its own presets as markers such as
`EQ<official@-10:0>QE`, which have no text to show. Like the vendor app, the
driver writes only the 56-byte frames the JSON needs.

## Hardware checks

On the Ace 68 Air III, through `MchoseKeyboardHidClient` over node-hid, every
change written, read back and then restored:

- Info, profile table, function config, key-travel, keymap, macro, DKS,
  mod-tap, toggle, colour and custom-area reads decode and pass checksums.
- One key's actuation; polling rate 8 kHz to 4 kHz; active profile.
- Settings (Alt+Tab lock, RT smart) and backlight brightness.
- A keymap entry, a per-key colour, a DKS, mod-tap and toggle slot, a
  16th macro and a profile name. Afterwards the macro, advanced-key and
  name regions were compared with a dump taken first and were
  byte-identical.
- Through the OpenMouse client: binding a mod-tap on the Mac Fn layer
  (slot allocation, hold time), then restoring the factory key, which
  freed the slot.
- An SOCD pair (A and D on the Mac Fn layer, first key wins), rebinding it
  as rapid snap, then removing it: the mod-tap table, that layer and the
  travel table were byte-identical to a dump taken first.
- A full calibration through the OpenMouse client by hand: keys showed
  the blue waiting state after one press and turned green after the second,
  matching the keyboard's own lights.
- Live key depth through the OpenMouse client: with debug mode on outside
  calibration, the travel view filled each key as it was pressed.
- Saving a whole profile to a file through the OpenMouse client and loading
  it back: unchanged, then with an edited actuation, key colour,
  brightness and Mac-layer key, then the original again. Every read-back
  matched, and the profile ended byte-for-byte as it started.
- A factory reset of the active profile (`0xEE` with its index), after
  saving every profile and the macros: that profile's settings, lighting,
  key travel, keymap and key colours went back to the factory values
  (Horiz Wave, brightness 50, rainbow on, 1.50 mm actuation). Its name in
  the custom area, the other profiles, the macros and the advanced-key
  tables were untouched. The keyboard then rebooted and attached again as
  a new USB device, so the session that sent the reset ends there. Loading
  the saved file brought the profile back byte-for-byte. The whole-keyboard
  reset (255) has not been run.

Not exercised: how advanced keys and macros behave when typed, the Air II,
wireless models.
