# Changelog

All notable changes to `@thru/x402`. Format follows [Keep a Changelog](https://keepachangelog.com);
versioning follows [semver](https://semver.org).

While the package is `0.x`, minor bumps may carry breaking changes — they are called out explicitly.

## [Unreleased]

### Fixed

- **The published build could not be imported in Node.** `tsconfig` used
  `moduleResolution: "Bundler"` while the package declares `"type": "module"`, so `dist/` shipped
  extensionless relative imports (`export * from './types'`). Node's ESM resolver rejects those,
  making `import '@thru/x402'` throw `ERR_MODULE_NOT_FOUND` — in the Express-on-Node case the SDK
  exists for. Now compiled with `NodeNext`. The unit suite never caught this because ts-jest
  compiles from `src/`; `npm run smoke` now loads the real build output under Node.

### Changed

- **BREAKING — `buildChallengeHeaders(req, opts?)`: `opts.mppSecret` is now optional, and the MPP
  challenge is omitted when it is absent.** Previously the MPP `WWW-Authenticate` header was always
  emitted, falling back to a hardcoded placeholder secret when none was supplied. That placeholder
  could never match a real deployment's `FACILITATOR_MPP_HMAC_SECRET`, so any merchant who did not
  configure one got a silently half-broken gate: x402 payments settled while every MPP payment
  failed with an opaque `binding mismatch`. Not advertising a protocol you cannot honour is the
  correct behaviour.

  *Migration:* pass `mppSecret` (from your Thru operator) if you serve MPP clients. If you only
  serve x402 clients, no change — you were never getting working MPP anyway.

- `gateRequest` now rejects an inbound MPP credential with `reason: 'mpp_not_configured'` when no
  `mppSecret` is set, instead of forwarding a payload the facilitator is guaranteed to reject.

### Added

- `examples/express-server.ts` — canonical integration, typechecked in CI against the built
  package's `exports`/`types` map. Source of truth for all documented snippets.
- `scripts/smoke.mjs` — built-artifact smoke test; runs under plain Node, walks every `exports`
  subpath, and exercises the gate end-to-end.
- `scripts/check-doc-snippets.mjs` — lints Thru's console/marketing snippets for call shapes that
  silently disable the payment gate.
- `README.md`.
- npm packaging metadata: `files`, `repository`, `license`, `engines`, and a `prepublishOnly` that
  runs the full `verify` chain. The package is no longer `private`.

## [0.1.0]

Initial implementation: facilitator client, dual-protocol 402 challenge builder, framework-agnostic
payment gate, Express adapter, internal testing agent client.
