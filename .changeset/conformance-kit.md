---
'@gridmason/sdk': minor
---

Add the host-conformance test kit at `@gridmason/sdk/conformance` (SPEC §5,
FR-7). A host implementation supplies a `ConformanceHost` adapter and the kit
asserts every SPEC §3 contract rule: capability intersection before transport
with typed `PermissionDenied` (rule 1), `net.fetch` host scoping (rule 2), the
per-instance remote-identity binding (rule 3), typed namespaced capability-gated
events (rule 4), per-instance `instanceId` isolation (rule 5), and unmount
revocation with auto-unsubscribe and typed `InstanceGone` (rule 6). Exposes the
vitest binding `runHostConformance` plus the framework-free `conformanceChecks` /
`runConformanceChecks`. Passing the suite is the definition of a valid Gridmason
host.
