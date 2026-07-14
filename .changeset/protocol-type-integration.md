---
"@gridmason/sdk": patch
---

Wire the type-level dependency on `@gridmason/protocol` (`^0.0.2`, the SDK's only
runtime dependency). Re-export the author-facing protocol types from
`@gridmason/sdk` — the per-mount identity `WidgetID` (plus a `WidgetId` spelling
alias), the page-context type grammar (`ContextMap`/`ContextType`), and the
capability-grammar types (`Capability`, `CapabilityApi`, `CAPABILITY_APIS`) —
while the enforcement utilities and manifest/layout types stay internal. The
`HostSDK` interface (a later release) sources its shared contract types from
protocol via this barrel rather than redefining them; the split, and the
`WidgetID`/`PageContext` naming notes, are documented in the re-export policy.
