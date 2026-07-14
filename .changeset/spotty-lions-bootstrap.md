---
"@gridmason/sdk": patch
---

Initial `0.0.x` release. Publishes the package scaffold (ESM output + type
declarations) with the per-framework subpath exports reserved (`.`, `./react`,
`./vue`, `./vanilla`, `./noop`, `./fixture`, `./conformance`), and stands up the
changesets + npm Trusted Publishing (OIDC) release pipeline and the CLA gate.
The `HostSDK` interface, helpers, no-op/fixture implementations, and the
conformance kit land in later releases.
