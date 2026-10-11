# Kochi Hummingbird 68: Windows/Mac mode

This is deliberately a system-mode driver, not a claim of full HB68 feature
parity. It implements device naming, both system-mode queries, and Windows/Mac
mode changes. RGB, keymaps, analog travel, profiles, firmware, reset and
calibration commands are not exposed.

## Evidence

The public [HB68 configurator](https://hb68.devminer.xyz/device) and its
[bundled implementation](https://github.com/TheDevMinerTV/hummingbird68-webui/tree/3f30fb26553da50ca8438adf661af594558a0490/assets)
identify the framing and command meanings. This implementation was written
independently; no vendor bundle or executable is included in this package.

On 2026-10-11 a physical `KOCHI68 Keyboard` on macOS enumerated as USB
`1CA2:0901`. The command interface is usage page `FFA0`, usage `1`, with 64-byte
input/output reports and report ID `0`. The same product also exposes boot
keyboard collections and a vendor usage `2`; those are not claimed.

Hardware checks:

- Name query returned `KOCHI68`.
- Initial Windows query returned `0`, Mac query returned `1`.
- Windows change returned acknowledgement `1`; Windows/Mac queries returned
  `1`/`0` afterward.
- Mac change returned acknowledgement `1`; Windows/Mac queries returned
  `0`/`1` afterward. The original mode was restored.

Sanitized actual request/reply bytes are in
`src/kochi/fixtures/macos-mode.json`. They contain no serial number, keystrokes,
or personal data. Firmware version was not queried. This verifies USB commands
on this physical board on macOS, not every firmware revision or operating
system. Linux and Windows host testing remains outstanding.

## Wire format

Requests are zero-padded 64-byte reports:

`[5C, payloadLength, 00, checksum, command, FF, FF, ...zeroes]`

Replies use group `80`; their payload starts with a reserved byte, followed by
the echoed command. Mode query/write payloads are
`[reserved, command, result, FF]`. A query result `0` means inactive, `1` active,
and `FF` unsupported. A mode-write result `1` acknowledges the request.

The checksum is `(35 + header + payloadLength + group + finalPayloadByte) & FF`.
It does **not** cover every payload byte. The driver checks framing, checksum,
report ID, command echo, allowed result values, and agreement of both queries.

Commands: `26` name, `21` Windows query, `22` Mac query, `30` Windows change,
`31` Mac change (hexadecimal). Reads worked without a synchronization command;
no bootloader handshake is issued.

Transactions are serialized. Writes require an acknowledgement followed by
both mode queries. A timeout or transport failure requires a new client
connection, because the protocol has no transaction ID with which to reject
late replies. The driver never speculates about persistence or writes flash:
whether the mode survives unplugging is not yet tested.

For Linux, WebHID/hidraw access may require a device-specific udev rule. The
application should use Windows mode for a conventional PC/Linux key layout,
and Mac mode for macOS, matching the existing configurator's selector.
