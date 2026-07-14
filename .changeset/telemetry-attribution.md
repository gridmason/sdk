---
"@gridmason/sdk": minor
---

Add telemetry-attribution helpers (`attributeTelemetry`, `useTelemetry` for React/Vue). They read `sdk.identity` and stamp `instanceId` + `widgetId` onto every latency mark and error before forwarding to `sdk.telemetry`, plus a `time(name, op)` that measures an operation's latency — so a widget author never hand-threads identity. Documents the attributed mark/error shape a host aggregates per instance and per widget (docs/telemetry-attribution.md). Audit-trail surface (SPEC §2), not security enforcement: identity is read from the handle, never minted.
