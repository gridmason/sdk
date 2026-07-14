# @gridmason/sdk

## 0.0.1

### Patch Changes

- 7b4a46f: Wire the type-level dependency on `@gridmason/protocol` (`^0.0.2`, the SDK's only
  runtime dependency). Re-export the author-facing protocol types from
  `@gridmason/sdk` — the per-mount identity `WidgetID` (plus a `WidgetId` spelling
  alias), the page-context type grammar (`ContextMap`/`ContextType`), and the
  capability-grammar types (`Capability`, `CapabilityApi`, `CAPABILITY_APIS`) —
  while the enforcement utilities and manifest/layout types stay internal. The
  `HostSDK` interface (a later release) sources its shared contract types from
  protocol via this barrel rather than redefining them; the split, and the
  `WidgetID`/`PageContext` naming notes, are documented in the re-export policy.
- c6d5a7d: Initial `0.0.x` release. Publishes the package scaffold (ESM output + type
  declarations) with the per-framework subpath exports reserved (`.`, `./react`,
  `./vue`, `./vanilla`, `./noop`, `./fixture`, `./conformance`), and stands up the
  changesets + npm Trusted Publishing (OIDC) release pipeline and the CLA gate.
  The `HostSDK` interface, helpers, no-op/fixture implementations, and the
  conformance kit land in later releases.
