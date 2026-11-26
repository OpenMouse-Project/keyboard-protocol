# ATK keyboard support

`@openmouse/keyboard-protocol/atk` speaks the configuration protocol of ATK,
EDGE, RS and Velota keyboards (vendor id `0x373B`). It is written from the
OpenATK keyboard configurator, whose request frames are the reference for the
tests. It has not been exercised on hardware through this package.

## Hardware verification

| Board | Id | Verified |
| --- | --- | --- |
| Nothing yet | | |

Everything below is implemented from the protocol and covered by tests against a
fake board and the OpenATK request frames only. Mark a board verified here, and
nowhere else, after each flow in the checklist has been run on it.

## Transport

- Collection: usage page `0xFF60`, usage `0x61`, the same raw-HID collection VIA
  uses. The command set is not VIA's. Boards are matched by catalogued product
  id, never by collection alone, so a VIA keyboard from another vendor is not
  claimed. The registry places this driver ahead of the generic VIA driver.
- Reports: report id 0, 32 bytes, zero padded. Byte 0 is the command, the
  payload starts at byte 1.
- Replies echo the command. For `getKeyboardValue` and `setKeyboardValue`
  (`0x02`, `0x03`) they also echo byte 1, and for the custom id `0x96` byte 2,
  the channel. There is no transaction id, so the driver serializes requests
  and retries an unanswered request up to three times, 1.2 s apart, before
  failing.

## Commands

| Command | Use |
| --- | --- |
| `0x01` | protocol version, big-endian at reply bytes 1 and 2 |
| `0x02` / `0x03` | get / set a keyboard value. With `0x96` at byte 1, byte 2 is a custom channel |
| `0x07` / `0x08` | set / get the back-lamp lighting block (`0x41`) |
| `0x12` | read keymap bytes: offset (2 bytes), length (at most 28) |
| `0xFE` | tap-dance entry write (used for MT and TGL) |

Firmware is `0x02 0x96` with no channel; reply bytes 5 and 6 are the version in
hex digits ("2.10" is 2.1). Firmware 2.1 and later moves the logo and side
lights onto the decoration channel.

## Custom channels

| Channel | Meaning | Notes |
| --- | --- | --- |
| `0x03` | per-key actuation | `[row, col, hi, lo]`, millimetres times 1000 |
| `0x07` | per-key rapid trigger | `[row, col, on, release hi/lo, press hi/lo]` |
| `0x0B` | dead zone | top and bottom, millimetres times 1000 |
| `0x0D` | tap-dance entry | sent under `0xFE`, see below |
| `0x0F` | dynamic keystroke (DKS) | up to four bindings plus top and bottom travel |
| `0x11` | feature block | RGB area, WASD swap, Mac mode, Win lock, NKRO (0 to 2), key mode (read only) |
| `0x1D` / `0x1E` / `0x25` | flags | bottom optimization, game mode, AI match |
| `0x20` | advanced keys | RS, SOCD, OKS and AKS slots, 20 of them |
| `0x21` / `0x27` | logo / side light | firmware before 2.1 |
| `0x24` | travel limits | six values: travel max, min and step, rapid-trigger max, min and step |
| `0x26` | light-off timer | minutes, 0 means never |
| `0x46` | polling rate | 0 to 3 for 8 kHz, 4 kHz, 2 kHz, 1 kHz. A restart flag (`0x4E`) is written first |
| `0x4B` | single-key lighting | `[key, r, g, b]` |
| `0x53` | zone lighting | logo 240, side 241, front 242, button 243, zone id last on writes |

Advanced keys are `[0x96, 0x20, 0, 0, sub, index, mode, index, point hi/lo, 0,
rt, key1(2), key2(2), layer, trigger delay(2), key delay(2)]`. Sub 1 reads, sub 3
writes. Modes: 0 none, 1 RS, 2 to 5 SOCD (last, key 1, key 2, neutral), 6 OKS,
7 to 9 AKS.

## Implemented

Identity (protocol, firmware, product name and matrix), travel limits, dead
zone, feature flags, polling rate, sleep, back-lamp and zone lighting, per-key
lighting, per-key travel and rapid trigger, advanced keys (RS, SOCD, OKS, AKS),
MT, TGL and DKS writes, and keymap read.

Writes are read back where the protocol has a matching read: polling rate,
sleep, dead zone, feature block, flags, lighting, key travel, rapid trigger,
key light and advanced keys. MT, TGL and DKS have no read command in the
configurator, so those writes are only acknowledged, not confirmed.

## Not exposed

- Keymap writes, macros, profiles and firmware update. The configurator this was
  written from does not write the keymap.
- Calibration and live key-travel monitoring.
- LCD, wireless pairing and side-light position modes (`0x51`).
- Boards with no catalogued matrix (RS8 Neo, the Halo and Nothing68 family) get
  every setting but not the keymap read.

## Catalog

107 product ids in `src/atk/products.ts`, taken from the OpenATK registry. The
four `ATK x QK Hex80` entries are left out: they are QMK-based collaboration
boards that belong on the generic VIA driver, not here. The 2.4G entries are
reported as wireless from their name; that is inferred, not read from the board.

## Hardware checklist

Run each on a connected board and note the result under the table above. Stop
at the first unexpected value.

1. Connect, read status: name, firmware, rate, sleep and lighting match the
   vendor app.
2. Change polling rate, replug, confirm it stuck.
3. Change sleep timer and the game-mode flag, confirm in the vendor app.
4. Change one key's actuation and rapid trigger, read them back, test the key.
5. Change back-lamp effect, colour and brightness.
6. Set an RS or SOCD pair and clear it.
7. Read the keymap and compare with the vendor app.
