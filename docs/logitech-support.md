# Logitech keyboard support

Coverage ledger for the Logitech HID++ 2.0 keyboard driver.

## Evidence

- Logitech's public HID++ 2.0 documentation (`Logitech/cpg-docs`).
- OpenLogi's reference pages for `0x0000` root, `0x0003` deviceInformation,
  `0x1004` unifiedBattery, `0x8040` brightnessControl, `0x8060` reportRate and
  `0x8061` extendedAdjustableReportRate, read 2026-10-29.
- G HUB's shipped device catalog (the `ghub-web-cn` mirror) for keyboard
  product ids, names and transport SKUs.
- Local G HUB 2026.10 (`lghub.app`) and its agent binary were inspected for
  the `0x1B08` function ids: 0 capabilities (long), 1 get rapid trigger,
  2 set rapid trigger, 3 set key-travel events, 4 get key priority,
  5 set key priority.
- The agent's `F1b08AnalogKeysTag::Row::toBytes` code emits an 8-bit control
  index and a big-endian 16-bit value. Its constructor points to tag ID
  `0x1B08`. The separate `IAnalogKeysProfileTag::toBytes` code emits the
  same three-byte row shape for legacy actuation tags. The `0x8102` methods name
  functions 6–7 for tag reads and 9–11 for tag writes/commit. Static
  disassembly confirms function 6 starts with `[profile, tag_id_BE16, args…]`,
  function 9 with `[tag_id_BE16, length_BE16, args…]`, function 10 with a
  fragment index and 15 padded data bytes, and function 11 takes a BE32
  value. The function 11 value and session conditions remain under
  investigation.
- The agent's `ActuationPointProfileTag` constructor fixes tag ID `0x0123`;
  `RapidTriggerProfileTag` fixes tag ID `0x0124`. The modern `0x1B08` tag and
  those legacy tags must be chosen from the device's advertised tag list.
  No physical-unit conversion is inferred from their raw u16 values.
- OpenLogi's `0x8081` per-key lighting and `0x1B04` control pages for the zone
  and remap framing.
- [OpenLogi's `0x8040` wire reference](https://openlogi.org/hidpp/features/x8040-brightness-control)
  for the illumination capability bit and functions 3–4.
- [OpenLogi's `0x8081` wire reference](https://openlogi.org/hidpp/features/x8081-per-key-lighting)
  for four distinct zone/RGB tuples per function-1 frame and the echoed zone IDs.
- OpenLogi's published [0x8070 colorLedEffects wire reference](https://openlogi.org/hidpp/features/x8070-color-led-effects)
  and [GitHub implementation](https://github.com/AprilNEA/OpenLogi/blob/master/crates/openlogi-hidpp/src/feature/color_led_effects.rs)
  plus its [wire type definitions](https://github.com/AprilNEA/OpenLogi/blob/master/crates/openlogi-hidpp/src/feature/color_led_effects/types.rs):
  fn 0 returns zone count and a BE extended-capability mask (bit 0 permits
  `getZoneEffect`); fn 1 reads `[zone, 0, 0]` and returns the echoed zone,
  BE location and effect count; fn 2 reads `[zone, ordinal, 0]` and returns
  the zone-local effect id; fn 3 writes a 16-byte frame with ten effect
  parameters and zero persistence (RAM only); fn 14 reads `[zone, 0, 0]`
  for the currently configured RAM effect. Fixed color has effect id `1`
  and RGB parameters at bytes 2–4 of the fn 3 payload. Retrieved 2026-10-29.
- OpenLogi's [0x8100 onboardProfiles summary](https://openlogi.org/hidpp/features/x8100-onboard-profiles)
  reports sector I/O and CRC framing but no typed OpenLogi implementation or
  verified profile-format layout. It does not authenticate a safe edit of
  G HUB's analog profile-header bytes.

No Logitech keyboard has been exercised through this package. Tests use a fake
HID++ endpoint that answers the documented frames; they prove framing, feature
resolution and read-back flow, not firmware behavior on a specific model.

## Transport

HID++ 2.0 rides on usage page `0xFF00` (USB) or `0xFF43` (Bluetooth). Requests
are output reports on report id `0x10` (short, three parameters) or `0x11`
(long, sixteen parameters); the function byte is `(function << 4) | 0x05` and
the device index is `0xFF` for a directly attached keyboard. Replies arrive as
input reports and are matched by device index, feature index and function.

Product ids are restricted to the keyboard rows in G HUB's catalog so the same
predicate cannot claim a Logitech mouse or headset, which speak the same
transport.

## Implemented

| Surface | Feature | Functions | Behavior |
| --- | --- | --- | --- |
| Identity | `0x0003` | `getDeviceInfo`, `getFwInfo`, `getSerialNumber` | Unit id, transport bits, model ids, firmware version, serial when advertised. |
| Battery | `0x1004` | `getBatteryCapabilities`, `getBatteryInfo` | Percentage only when the gauge capability is set; otherwise the coarse level. |
| Polling rate | `0x8061` | `getActualReportRateList`, `getReportRate`, `setReportRate` | Reads the advertised mask, writes a discriminant and verifies the read-back. |
| Brightness and illumination | `0x8040` | functions 0–4 | Reads the range and current brightness; writes big-endian brightness and verifies it. When the illumination capability is advertised, reads and toggles backlight power independently, with read-back. |
| Receiver | HID++ pairing slots 1–6 | Root `getFeature` + `0x0003` device information | Probes each slot, matches the reported model ids against the keyboard catalog, and addresses that device index. |
| Analog switches | `0x1B08` | functions 0–5 | Reads capabilities (raw bytes), rapid-trigger state and key-priority state; writes rapid trigger, key priority and key-travel events with read-back where a getter exists. |
| Per-key lighting | `0x8081` | presence, individual zones, single-value zones, frame end | Reads present zones, paints one solid colour across them or stages different colours for selected zones, then commits with `frame_end`; optionally claims `0x8071` software control. The fn 1 staging reply is only an acknowledgement and is not compared with the requested zones. |
| RGB effects | `0x8071` | device/cluster/effect info, set cluster effect | Reads clusters and effect ordinals, claims `ALL_CLUSTERS`, and applies Off, Static, Cycling, Wave or Breathing single to every cluster that advertises it. |
| Legacy LED zones | `0x8070` | info, zone info, effect info, set zone effect, get zone effect | Enumerates per-zone ordinals; reads the active RAM effect, applies a fixed color or a caller-supplied ten-byte *raw* effect for any advertised zone-local effect ID, and verifies the ordinal and all ten RAM parameter bytes when fn 14 is advertised. No EEPROM writes or undocumented effect-specific parameter encoding. |
| Key remapping | `0x1B04` | count, info, reporting, set-reporting | Reads controls, their groups and legal targets, and remaps a control with device read-back. |

## Not implemented

- Per-key analog actuation through the FKC file (`0x1B05`) / modular profile
  tags (`0x8102`). The row body codec for G HUB's `F1b08AnalogKeysTag` is
  available as `[control_index, value_hi, value_lo]`, but the `0x8102`
  session/tag transfer and profile commit are not wired yet. The global
  `0x1B08` switches are implemented.
- PRO X TKL RAPID (`C35B`) and G515 RAPID TKL (`C363`) are now catalogued from
  [OpenLogi's model IDs](https://openlogi.org/hidpp/model-ids) and the
  [OpenRGB device report](https://gitlab.com/CalcProgrammer1/OpenRGB/-/work_items/5521).
  Neither has been connected to this package.
- The six analog bytes in the `0x8100` profile header (`0x72..0x77`), which
  G HUB maps to its `AnalogSettings` message, are not exposed either.
- Custom/multi-zone effect maps and named animations for legacy `0x8070`.
  The `0x8081` zone-colour setter has no physical key-to-zone layout map.
  Non-fixed legacy effects are accessible only through the raw ten-byte API:
  OpenLogi documents the frame and effect IDs, but parameter semantics depend
  on the individual effect and are not established for keyboard models.
  Also not implemented: onboard `0x8100` profile management. The header's six
  analog bytes alone do not establish profile-slot addressing, sector write
  prerequisites or full-header integrity/CRC handling.
- Hardware verification of any catalogued model. `verified: false` means USB
  recognition and documented HID++ support only.

The driver never writes a feature the keyboard did not advertise. Setters with
a getter read the value back before reporting success; write-only frames
(`0x8081` zone paint / `frame_end`, `0x1B08` key-travel events) are identified
as such.
