---
"@gridmason/sdk": minor
---

Retype `HostSDK.context` to the protocol page-context **value** type. Bumps
`@gridmason/protocol` to `^0.0.3`, which publishes the runtime value surface
(`PageContext`, `ContextValue`, `RecordRefValue`, `ObjectValue`) that
gridmason/protocol#37 requested. `HostSDK.context` is now a `PageContext` (the
value side of the `ContextMap` type grammar) instead of the interim `ContextMap`;
`createNoopSDK`/`createFixtureSDK` context defaults and the fixture file's
`context` preset are typed to `PageContext` accordingly. The value types are
re-exported author-facing from `@gridmason/sdk`; the value-side conformance
helpers (`matchesContextType`/`matchesContextMap`) stay internal, mirroring
`isContextSubset`.
