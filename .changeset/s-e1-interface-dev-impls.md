---
"@gridmason/sdk": minor
---

S-E1: the committed M1 surface. Ships the `HostSDK` interface (records, scoped
net.fetch, typed namespaced events, context, settings, nav, telemetry, per-mount
identity) with the typed error surface (`PermissionDenied`, `InstanceGone`) and
the six contract rules documented; `createNoopSDK()` (typed-empty defaults, call
recording, dev-branded); `createFixtureSDK(fixtures)` (JSON fixture map with
subset matching, fixture-hit/default-empty flagging, scripted events, capability
enforcement against the declared manifest); and the React helper subset
(`useRecord`, `useRecordSuspense`, `useSettings`, `emit`/`on`, `scopedFetch`)
over a framework-agnostic core ready for the Phase B Vue/vanilla adapters.
