# `@openmouse/keyboard-protocol`

Transport-independent analog gaming keyboard protocol codecs used by OpenMouse.

The package owns packet layouts, command constants, encoders, decoders,
protocol-specific value types, the device catalog, and the HID drivers used by
OpenMouse. Pure codec entry points do not depend on WebHID, so browser,
Node.js, and TypeScript projects can use them independently from the optional
driver layer.

```ts
import { encodeWootingCommand } from "@openmouse/keyboard-protocol/wooting";

import {
  createSupportedClient,
  SUPPORTED_HID_FILTERS,
} from "@openmouse/keyboard-protocol/drivers";
```

## Development

```sh
npm install
npm run check
```

Codec sources are grouped by brand under `src/`; HID drivers, discovery
filters, the driver registry, and shared status types live under
`src/drivers/`.

## Protocol entry points

| Brand | Import |
| --- | --- |
| Wooting | `@openmouse/keyboard-protocol/wooting` |

An exported protocol means OpenMouse implements that wire format. It does not
claim every keyboard from that brand works. When a catalog provides a
`verified` field, use it to distinguish hardware-tested support from USB
recognition.
