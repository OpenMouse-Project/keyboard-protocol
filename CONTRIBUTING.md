# Contributing to Keyboard Protocol

This repository contains the transport-independent keyboard codecs and optional
HID drivers used by OpenMouse. Keep application state, rendering, and UI controls
in the consuming application.

## Development

Use Node.js 24 and npm for development and release tooling, matching CI.

```sh
npm ci
npm run check
```

The check builds JavaScript, declarations, declaration maps, and source maps;
runs codec and driver tests; and inspects the npm package with a packing dry run.
Generated `dist/` files and package tarballs are not committed.

The test command loads `scripts/fast-test-timers.mjs` to shorten fake-device
settle delays and timeouts. Tests asserting real elapsed time must be added to
that script's exclusion list. The shim is never loaded by the published package.

## Protocol changes

- Keep pure codecs in `src/<brand>/` and hardware transport in `src/drivers/`.
- Export public APIs through the appropriate `package.json` subpath.
- Preserve unknown fields during read-modify-write operations.
- Validate ranges and verify writes using device replies or read-back.
- Distinguish hardware-verified behavior from inferred or untested behavior.
- Add tests for captured replies, malformed data, discovery, and write failures.
- Do not commit vendor binaries, credentials, device serials, or personal captures.

TypeScript uses NodeNext resolution. Relative `.ts` source imports are rewritten
to `.js` during compilation; published entry points refer to `dist/`.

To check the consuming app against the local package, keep `openmouse` and
`keyboard-protocol` as sibling checkouts:

```sh
npm run build
cd ../openmouse
npm install --no-save --package-lock=false ../keyboard-protocol
npm run check
```

## Versioning and releases

Use Conventional Commit subjects and PR titles. Squash-merged PR titles become
release inputs: `fix:` publishes a patch, `feat:` a minor, and `!` or a
`BREAKING CHANGE:` footer a major. Documentation, tests, and maintenance-only
commits do not publish a version.

After a push to `main` passes CI, the Release workflow checks that the validated
commit is still the current branch head, checks out that exact commit, and runs
semantic-release. It computes the version from release tags and commits, creates
a GitHub release, and publishes `@openmouse/keyboard-protocol` publicly on npm.
Do not bump `package.json` or create release tags by hand. The checked-in version
is a development placeholder; npm and GitHub release tags identify releases.

Publishing uses npm trusted publishing (GitHub Actions OIDC), with no long-lived
npm token in the workflow. See the one-time publisher setup in the README.
