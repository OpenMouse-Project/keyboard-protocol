# `@openmouse/keyboard-protocol`

Transport-independent analog gaming keyboard protocol codecs used by OpenMouse.

The package owns packet layouts, command constants, encoders, decoders,
protocol-specific value types, the device catalog, and the HID drivers used by
OpenMouse. Pure codec entry points do not depend on WebHID, so browser,
Node.js, and TypeScript projects can use them independently from the optional
driver layer.

## Installation

```sh
npm install @openmouse/keyboard-protocol
```

```ts
import { encodeWootingCommand } from "@openmouse/keyboard-protocol/wooting";

import {
  createSupportedClient,
  SUPPORTED_HID_FILTERS,
} from "@openmouse/keyboard-protocol/drivers";
```

## Development

Use Node.js 24 for development and release tooling, matching the mouse protocol CI.

```sh
npm ci
npm run check
```

Codec sources are grouped by brand under `src/`; HID drivers, discovery
filters, the driver registry, and shared status types live under
`src/drivers/`.

## Protocol entry points

| Brand | Import |
| --- | --- |
| Wooting | `@openmouse/keyboard-protocol/wooting` |
| Wuque Studio | `@openmouse/keyboard-protocol/wuque` |
| Kochi Hummingbird 68 | `@openmouse/keyboard-protocol/kochi` |
| Razer | `@openmouse/keyboard-protocol/razer` |
| Logitech | `@openmouse/keyboard-protocol/logitech` |
| SteelSeries | `@openmouse/keyboard-protocol/steelseries` |
| Keychron (Hall-effect) | `@openmouse/keyboard-protocol/keychron` |
| Arbiter Studio | `@openmouse/keyboard-protocol/arbiter` |
| VIA (QMK/VIA firmware, any vendor) | `@openmouse/keyboard-protocol/via` |

The VIA driver matches the raw-HID collection (`0xFF60:0x61`) on any board and
covers keymaps, keycode names, encoders, macros and custom-menu lighting. Layout
and menu meaning come from a VIA definition parsed with `parseViaDefinition`.
It has been exercised on one board (Anvil Native, VIA protocol 11); see
[the VIA ledger](docs/via-support.md).

Kochi Hummingbird 68 (`1CA2:0901`) supports reading and changing Windows/Mac
mode on its `FFA0:1` USB configuration collection. Both directions and mode
read-back were exercised on hardware on macOS. This is not full keyboard
configuration support; see [the evidence and limitations](docs/kochi-hb68.md).

Wooting discovery covers the Standard and ARM configuration collections and the
model families cataloged by Wootility 5.4.2. Only the 60HE+ protocol has prior
hardware captures in this repository; the [Wooting coverage ledger](docs/wooting-support.md)
tracks the remaining configuration and device validation work.

An exported protocol means OpenMouse implements that wire format. It does not
claim every keyboard from that brand works. When a catalog provides a
`verified` field, use it to distinguish hardware-tested support from USB
recognition.

Wuque Studio boards (`0x1CA6`, `0x36B5`) speak a 64-byte command protocol on
usage page `0xFFB0`, reverse-engineered from the vendor web configurator and
validated against a BABAO60 HE (`0x1CA6:0x1B10`, firmware protocol 1.2.1.0):
identity, key layout/keycodes, per-key travel and rapid trigger, lighting,
macros, advanced keys and global settings. The driver reads all of it and
sends only the safe write subset — it never issues factory reset, firmware,
voice, haptics, displayer or high-polling-rate commands.

### Razer, Logitech and SteelSeries

These three drivers are implemented from vendor-shipped or public protocol
sources, not from hardware exercised through this package. Every catalog entry
is `verified: false` until that changes.

- **Razer** (`0x1532`): 90-byte control reports. Identity, polling rate and
  brightness read with write/read-back; RGB matrix effects, model-gated custom
  RGB rows and standard/analog key bindings. Game-mode LED state has read-back;
  binding get-direction commands remain unverified on hardware. See
  [the Razer ledger](docs/razer-support.md).
- **Logitech** (`0x046D`): HID++ 2.0 identity, battery, polling rate,
  brightness, receiver pairing-slot discovery, `0x1B08` analog switches,
  `0x8081` solid per-key lighting, `0x8071` effects, `0x8070` legacy zone
  effects with RAM read-back, and `0x1B04` remapping. Per-key FKC analog tags
  remain open. See [the Logitech ledger](docs/logitech-support.md).
- **SteelSeries** (`0x1038`): wired Apex Pro TKL (`0x1628`, `0x1642`) on-board
  profile read/write, per-key actuation, rapid trigger/Key Guard, sensitivity,
  Rapid Tap, direct per-key lighting and profile persistence. The `0x1628`
  additionally has schema-gated second-layer actuation, Rapid Tap pairs and
  profile/direct OLED frames. `saveProfile()` verifies the read-back. See
  [the SteelSeries ledger](docs/steelseries-support.md).

Further Razer, Logitech and SteelSeries feature expansion is paused for now.
The linked ledgers identify unsupported flows and hardware-validation gaps;
the current implementations do not claim complete per-model feature coverage.


### Arbiter Studio

Polar 65, Nimbus 65, Polar 65 PRO and Polar 75 PRO (vendor ids `0x1A81` and
`0x371C`, usage pages `0xFF01`/`0xFF02`) are implemented from the vendor's web
configurator, not from hardware exercised through this package. Every catalog
entry is `verified: false`. The driver reads identity, per-key travel, the light
effect and SuperTap, and writes travel, light effects, SuperTap and key
bindings (including the PRO models' FN layer) with read-back. See
[the Arbiter ledger](docs/arbiter-support.md).

### BABAO60 HE validation status

Tested through the OpenMouse UI on a BABAO60 HE with protocol firmware 1.2.1.0:

- Actuation travel settings work.
- Polling rate settings work.
- Rapid trigger press and release settings work.
- Press and release dead zone settings work.

Slider dragging and applying trigger settings to multiple selected keys also
work in the consuming application.

Buttons/key mapping, macros, and lighting still need work. Their existing codecs
and driver APIs do not imply that the complete configuration flows are finished
or fully validated. These results apply to the tested board and firmware.

## Releases

This package follows the same release pipeline as `@openmouse/protocol`:
CI builds, tests, inspects the package, and audits runtime dependencies. After a
validated push to `main`, semantic-release derives the next npm version from
Conventional Commits and publishes that exact commit, with a matching GitHub
release. The release job ignores superseded CI runs.

The source version `0.1.0` is a development placeholder. Published versions are
recorded in npm and GitHub release tags; do not update source versions manually.
See [CONTRIBUTING.md](./CONTRIBUTING.md) for commit and release conventions.

### One-time npm publisher setup

The Release workflow uses GitHub Actions OIDC rather than an `NPM_TOKEN` secret.
For `@openmouse/keyboard-protocol`, configure its npm trusted publisher as:

- Organization/user: `OpenMouse-Project`
- Repository: `keyboard-protocol`
- Workflow filename: `release.yml`
- Environment: leave empty (the workflow does not declare an environment)
- Allowed actions: enable direct `npm publish` for semantic-release

See [npm’s trusted-publisher instructions](https://docs.npmjs.com/trusted-publishers/)
for the account-side configuration.

A package maintainer must bootstrap the first public npm publication before
configuring the package's trusted publisher. Once connected, subsequent releases
run automatically after CI on `main`. This repository setup does not create or
change the npm account connection.

## License

[AGPL-3.0-or-later](./LICENSE), matching the mouse protocol package.
