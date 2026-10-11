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
