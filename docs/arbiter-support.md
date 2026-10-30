# Arbiter Studio keyboard protocol

Findings from the vendor's public web configurator, and the coverage ledger for
the `@openmouse/keyboard-protocol/arbiter` codec and driver built from them.
Everything here comes from static analysis of the vendor's bundle. No Arbiter
keyboard has been exercised through this package, so every catalog entry is
`verified: false`.

## Evidence

Retrieved 2026-10-30.

- `https://arbiterstudio.com/pages/web-app` is a Shopify landing page. It links
  to two apps: `https://app.arbiterstudio.com/` and
  `https://webapp.arbiterstudio.com/`.
- `app.arbiterstudio.com` ("Arbiter Web App", Vite bundle
  `/assets/index-476KMaHx.js`, 1,347,907 bytes) is the keyboard configurator.
  Every field below comes from reading that bundle; no code was executed.
- `webapp.arbiterstudio.com` (`static/js/index-4718c809.js`) is a different,
  generic app (GBK text encoding, DPI and file-transfer helpers, Monaco editor).
  Its HID filters are built at runtime. It was not analysed for keyboards.
- The bundle is minified, so the names below (`Oe`, `Sn`, …) are the bundle's own
  identifiers, kept so the source can be searched.

## Device catalog

All entries use usage `1`. `Proto` is the bundle's protocol class, which
differs between models (see [Protocol variants](#protocol-variants)).
`superTap` is the bundle's `superTapSupport`.

| Name in bundle | VID | PID | Usage page | Layers | Profiles | superTap | Proto |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Arbiter Polar 65 - Gaming Keyboard | `0x1A81` | `0x2072` | `0xFF01` | Main | 1 | no | `yl` |
| Arbiter Polar 65 - Gaming Keyboard | `0x1A81` | `0x2072` | `0xFF02` | Main | 1 | yes | `yl` |
| Polar 65 - Gaming Keyboard | `0x1A81` | `0x208E` | `0xFF02` | Main | 1 | yes | `yl` |
| Nimbus 65 - Gaming Keyboard | `0x1A81` | `0x2077` | `0xFF01` | Main | 1 | no | `yl` |
| Polar 65 - Gaming Keyboard | `0x371C` | `0xA005` | `0xFF02` | Main | 1 | yes | `yl` |
| Arbiter Polar 65 - Gaming Keyboard | `0x371C` | `0xA006` | `0xFF01` | Main | 1 | yes | `s2` |
| Polar 65 PRO - Gaming Keyboard | `0x371C` | `0xA003` | `0xFF02` | Main, FN | 3 | yes | `i2` |
| Polar 75 PRO - Gaming Keyboard | `0x371C` | `0xA001` | `0xFF02` | Main, FN | 3 | yes | `u2` |

Only `0x1A81:0x2072` is defined on two usage pages. Whether the other PIDs
also expose a second page is unknown. Discovery filters must pair each PID
with its own usage page, as `src/drivers/vendors.ts` does for Wuque.

Defaults in the bundle: every model starts on the `L_R_Surf` light effect with
actuation `10` and rapid trigger `10`. The two PRO models also define profile 1
(`Static`, actuation `5`, rapid trigger `5`) and profile 2 (`L_R_Surf` on the
65 PRO and `Snake` on the 75 PRO, colour index `3`, actuation `1`, rapid
trigger `1`).

The vendor's key matrices have 68 keys on the 65s and the 65 PRO, 70 on the
`0xA006` board (one placeholder, `None`, at index 28) and 82 on the 75 PRO (a
placeholder at the end). The wire tables are not always the matrix size; see
[Table sizes](#table-sizes).

## Transport

- Reports use report id `0`. Requests go out with `device.sendReport(0, frame)`
  and replies arrive as `inputreport` events.
- Frames are 64 bytes (`Wired`). The bundle also defines 19 (`BT`) and 32
  (`Wireless`) but only accepts replies whose length is 64.
- Request layout: `[logDevice=0, cmd | packetType, status=0, dataSize, data…,
  zero padding…, checksum]`.
- Reply layout: `[logDevice, cmd, status, dataSize, data…, …, checksum]`. A
  `dataSize` of `0xFF` is read as 0.
- Checksum: `(85 - sum(bytes 0..62)) & 0xFF`, stored in byte 63. Replies are
  checked the same way.
- Packet type is OR-ed into the command byte: short `0x00`, long `0x40`, large
  `0x80`, extra-large `0xC0`.
- Long (multi-packet) commands put `index | (total << 4)` as the first data
  byte. Key tables are 29 keys per packet and 3 packets, so 87 keys at most.

## Protocol variants

The bundle has four keyboard classes that share the command set and framing
above but differ in the details below. `yl` and `s2` both extend the 65 base
classes (`hP`, `xP`); `i2` and `u2` extend the PRO classes (`PP`, `VP`).

- **`yl` / `s2` (65 models):** replies carry the command id at byte 1 (masked
  with `& 63`) and the status at byte 2 for USB. Key mapping is read and written
  with the long `GetKeyMapping`/`SetKeyMapping` commands.
- **`i2` / `u2` (PRO models):**
  - Key mapping uses the same `GetKeyMapping`/`SetKeyMapping` commands as the
    65s, with 5 packets on the 65 PRO (2 layers x 68 keys = 136 pairs) and 6 on
    the 75 PRO (2 layers x 81 keys = 162 pairs). The vendor app requests and
    writes with that total in the packet header.
  - The table is flat: every key of layer 0 (`Main`), then every key of layer 1
    (`FN`). The vendor app derives the layer from `index >= keys`.
  - There are three board profiles.
  - Both PRO classes also define a `GetKeyMappingPerKeys` (`29`) request (14
    four-byte `[layer, keyIndex, 0, 0]` entries per packet), but nothing in the
    bundle calls it. The UI loads key mappings with `GetKeyMapping`, so the
    per-key command is treated as unused and is not implemented.
  - Their reply handler reads `byte 0` first. A report starting `0x04` with
    `byte 1 == 0xC9` raises the bundle's `OnProfileChanged` event, so the
    keyboard announces a profile switch (for example from the keyboard itself)
    without being asked.
- `s2` differs from `yl` somewhere in code that was not diffed; treat it as a
  separate variant until it is.

### Table sizes

Each class's decoders were read to find how many entries are on the wire:

| Class | Models | Travel entries | Key bindings per layer | Packets (travel / mapping) |
| --- | --- | --- | --- | --- |
| `yl` | 65s | 68 | 68 | 3 / 3 |
| `s2` | `0x371C:0xA006` | 69 | 69 | 3 / 3 |
| `i2` | 65 PRO | 68 | 68 (x2 layers) | 3 / 5 |
| `u2` | 75 PRO | 82 | 81 (x2 layers) | 3 / 6 |

- `s2` skips matrix index 28 (the `None` placeholder) when it writes travel and
  both ways for key mapping, so its wire tables hold 69 of the matrix's 70
  entries. Its travel *read* decoder does not skip index 28 while its travel
  *write* does, so one of them is probably wrong in the vendor app; the driver
  treats both as 69 wire entries and fails a read of any other size.
- `u2` drops the matrix's final `None` entry from each key mapping layer (81 of
  82) but keeps all 82 in the travel table.
- The driver works in wire order and does not map entries to key positions; that
  needs the vendor's matrices.

## Commands

| Command | Id | Packet | Request data | Reply data |
| --- | --- | --- | --- | --- |
| `GetFwVersion` | 2 | short | none | byte 0 = low, byte 7 = high; shown as `V{high:02x}{low:02x}` |
| `GetDeviceSerialNo` | 13 | short | none | serial as concatenated unpadded hex bytes |
| `GetMagSwitchTravel` | 1 | long | `index\|total<<4` | same header, then `triggerMake, triggerBreak` per key |
| `SetMagSwitchTravel` | 0 | long | header, then `triggerMake, triggerBreak` per key (29 per packet) | four bytes, little-endian "data change flag" |
| `GetLightEffect` | 25 | short | none | 26 bytes |
| `SetLightEffect` | 24 | short | 26 bytes | data change flag |
| `GetKeyMapping` | 27 | long | `index\|total<<4` | header, then `keyCode, param` per key per layer |
| `SetKeyMapping` | 26 | long | header, then `keyCode, param` per key per layer (29 pairs per packet) | data change flag |
| `GetKeyMappingPerKeys` | 29 | short | defined on the PRO classes but never called by the bundle; not implemented | |
| `GetAllProfile` | 35 | long | `index\|total<<4` (total 10) | requested packet by packet until `index == total - 1`; payload not decoded |
| `SetBoardProfile` | 38 | short | one byte, the profile index | data change flag |
| `GetUserMode` | 53 | short | none (`dataSize` 6) | 6 bytes, see SuperTap |
| `SetUserMode` | 52 | short | 6 bytes, see SuperTap | data change flag |

Keys in the travel and mapping tables follow the layout array `keyMaxtrix`
(68 entries for the 65s, listed in the bundle as `_P`/`J4`), not HID usages.
The bundle starts each table read at packet index 0 and requests the next index
until `index == total - 1`.

Status codes: `0` Success, `1` Busy, `2` UnexpectedError, `3` NoSupport,
`4` DeviceIsOffline, `5` BadDevice, `6` BadData, `7` DeviceIsNotExisted,
`8` NoMoreData, `9` MemeryNoEnough, `10` FwUpdating.

After a profile load the configurator queues its writes (travel, light, key
mapping, user mode) and a 200 ms timer sends the next one when no command is
outstanding or 3 seconds have passed since the last.

### Travel (actuation and rapid trigger)

Each key has `triggerMake` and `triggerBreak`, one byte each. The UI maps
`triggerMake` to actuation and `triggerBreak` to rapid trigger and defaults
both to `10`. The unit and the allowed range are not stated in the bundle's
protocol code. `soleMakeSet` and `soleBreakSet` are UI flags, not wire fields.
There is no separate press/release dead zone field and no per-key rapid trigger
enable bit in these commands.

### Light effect (26 bytes)

`[lightOn, effect, brightness, speed, colorIndex, then 7 × (r, g, b)]`.
The reply is accepted only when it is exactly 26 bytes.

Effects: `0` Spectral_Cycle, `1` Static, `2` L_R_Surf, `3` Breath, `4` Snake,
`5` Magnetic, `6` Rotate, `7` M_Surf, `8` Colorful_Fountain, `9` Laser,
`10` Cross_Surf, `11` Traffic, `12` Rippling, `13` Dance_Macabre,
`14` Rand_Fountatin, `15` Love.

The bundle's default palette (`Dr`) has 7 colours (white, red, green, blue,
yellow, magenta, cyan), which matches the 26-byte length (5 + 21). What
`colorIndex` selects among them is not established.

### Key mapping

Each entry is `keyCode, param`. Key codes are the .NET `Keys` enum values the
bundle uses for its labels (for example `242`/`245` Fn, `249` SuperTap,
`250` Play), not USB HID usages. The table is flat with a second layer
addressed after the first (`index >= keys` selects layer 1). The 65 models define
only the `Main` layer in `keyMatrixLayer`; the PRO models add `FN`. Layout variants are named `US, Nordic, UK, German,
French, Swedish, Japanese, Taiwanese, Korean, Russian, Portuguese,
Spanish_Mexico, Spanish_Latam` (ids 1–13), but no command that reads or sets
the layout was found.

### SuperTap (user mode)

`SetUserMode`/`GetUserMode` carry six bytes:
`[layoutIndex, mode, checkFlag, flag & 0x7F | alternative-bit, keyIndex0,
keyIndex1]`. The UI reads `checkFlag > 0` as enabled and `keyIndex0/1` as the
two keys of the SuperTap pair. Only models with `superTapSupport` expose it.
The meaning of `mode`, `flag` and `alternative` is not established.

## Implemented

The codec is `src/arbiter/index.ts` and the driver is
`ArbiterKeyboardHidClient` in `src/drivers/arbiter/hid.ts`. Tests use a fake
keyboard that answers the frames above; they prove framing and read-back flow,
not firmware behavior.

| Surface | Commands | Behavior |
| --- | --- | --- |
| Identity | `GetFwVersion`, `GetDeviceSerialNo` | Firmware as `V{high}{low}` and the serial as the vendor app renders it. |
| Travel | `GetMagSwitchTravel`, `SetMagSwitchTravel` | `readTravel()` walks every packet. `setKeyTravel()` reads the table, patches the chosen keys, writes every packet and reads the table back to confirm. Values are whole numbers 0-255 in the firmware's own unit. |
| Light effect | `GetLightEffect`, `SetLightEffect` | 26-byte payload with 7 colours, validated and confirmed by read-back. |
| Key mapping | `GetKeyMapping`, `SetKeyMapping` | `readKeyBindings()` returns bindings by layer and wire entry; `setKeyBindings()` takes `{ layer, index, keyCode, param }`, patches the table, writes every packet and reads it back. `param` is written as 0 unless given, as the vendor app does; untouched keys keep theirs. Sizes are in [Table sizes](#table-sizes); the reply must report the expected packet total and entry count. |
| Profile | `SetBoardProfile` | `setBoardProfile(n)` is bounded by the model's profile count and is only acknowledged; no read-back command was found. |
| SuperTap | `GetUserMode`, `SetUserMode` | Models with `superTap` only; writes are confirmed by read-back. |
| Notifications | `[0x04, 0xC9]` report | `onProfileChanged(listener)` fires when a PRO model announces a profile switch. |

Behavior worth knowing:

- A reply's status byte must be `0`; otherwise the call fails with the status
  name (`NoSupport`, `Busy`, …) and the session is marked unusable.
- Replies carry no transaction id, so a timeout or refusal also marks the
  session unusable. Reconnect before continuing, as with the Kochi driver.
- A write acknowledgement is accepted if it echoes the command; the four-byte
  flag is read as zero when the body is shorter, matching how the vendor app
  reads it.
- `encodeArbiterUserModeWrite` sets the alternative bit with `alternative << 7`.
  The vendor bundle computes `alternative >> 7 & 128`, which can never set it;
  that looks like a bug there, but which one the firmware expects is unknown.
- Discovery filters pair every catalog entry's product id with its own vendor id
  and usage page (`ARBITER_HID_FILTERS`).

## Not established

- Any hardware confirmation, including the PIDs above. They are bundle
  definitions, not seen on a connected keyboard.
- Units and limits for `triggerMake`/`triggerBreak`.
- What `colorIndex` selects.
- Reply `status` handling on real firmware and whether a reply echoes the
  request's packet-type bits.
- `GetAllProfile`, board-profile switching semantics and how many profiles each
  model has.
- Whether the firmware uses the packet total in the request header. The bundle
  cannot answer it: every total the vendor app sends equals the true packet
  count, so a firmware that reads the total and one that ignores it behave the
  same for the app. Reads send the real total on the first request and echo the
  reply's total afterwards; writes send a fixed per-model total (3, 5 or 6) on
  every packet. The driver sends the same totals, so it does what the vendor app
  does; sending a different total is untested and is not done.
- What the `param` byte of a binding means. The vendor app only ever writes `0`:
  every keyboard, media and mouse binding it can author has `param: 0`, and the
  matrix defaults are all `0`. It only carries a nonzero value if the keyboard
  itself reports one. The driver therefore writes `0` for a rebound key and
  leaves other keys' values untouched.
- The FN layer's behaviour on the keyboard itself.
- Which of the `s2` travel read and write sizes is right (see
  [Table sizes](#table-sizes)).
- Wireless, Bluetooth and dongle transports. The bundle has per-transport
  header offsets (status at byte 2 or 3, id at 1 or 2, size at 3 or 5) and a
  19- and 32-byte frame length, but no device definition uses them.
- Firmware update, reset and calibration commands. None were found, and none
  are implemented.
- `GetAllProfile` (requested by the bundle but its payload was not decoded) and
  the unused `GetKeyMappingPerKeys`.
- Press/release dead zones, per-key rapid trigger groups, key-travel streaming
  and macros. No corresponding command is defined in this bundle.
