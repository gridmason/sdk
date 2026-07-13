---
name: Gridmason SDK v0
slug: sdk-v0
status: approved
created: 2026-07-13
approved: 2026-07-13
---

# Gridmason SDK v0

## Overview

`@gridmason/sdk` defines both sides of the widget/host boundary: the `HostSDK` interface a host shell implements (capability-enforcing chokepoint for data, events, navigation, telemetry) and the widget-side helper library authors import. All widget network I/O flows through it — `min(user permissions, declared capabilities)` per call.

Full engineering spec: [`docs/SPEC.md`](../../SPEC.md). **Phase A:** interface + no-op + fixture implementations + React helpers (dashboard M1 and the CLI dev loop need them). **Phase B:** full helper set, conformance suite, identity-binding hardening.

## Goals

- Dashboard M1 mounts widgets against a real handle before any registry exists.
- "A valid Gridmason host" is machine-checkable: passing the conformance suite is the definition.
- Widget unit tests and `gridmason dev` get realistic data offline via the fixture SDK.

## Non-goals

- No concrete backend (dashboard owns the reference implementation), no transport crypto (shell SW), no UI components, no module loading.

## Users & personas

- **Widget authors** — import helpers; audit surface = their SDK calls.
- **Host implementers** — implement `HostSDK`, run the conformance suite.
- **The CLI** — embeds the fixture SDK in `gridmason dev`.

## Functional requirements

- **FR-1** `HostSDK` TS interface per SPEC §3: `records` (read/query/write), `net.fetch` (scoped, no raw fetch), typed namespaced `events`, `context`, `settings` (get/update/onSchema), `nav`, `telemetry`, per-mount `identity`.
- **FR-2** Contract rules 1–6 (SPEC §3): capability intersection before transport, typed `PermissionDenied` (no empty-result leakage), scoped `net` hosts only, identity binding on every outbound call, typed-topic capability gating (`events:<ns>`), per-instance handles, unmount revocation + auto-unsubscribe + typed `InstanceGone`.
- **FR-3** `createNoopSDK()`: typed-empty defaults, call recording for assertions, dev-labeled (SPEC §5).
- **FR-4** `createFixtureSDK(fixtures)`: JSON fixture map (records by ref/query pattern, net by host+path, scripted event emissions); unmatched → no-op default + flagged; capability checks still enforced (SPEC §5).
- **FR-5** React helper subset (`useRecord`, `useSettings`, `emit/on`, `scopedFetch`) — Phase A; Vue + vanilla adapters sharing one core — Phase B (SPEC §4).
- **FR-6** Settings-form helper: JSON-schema form via the host `settings-form` adapter when no custom settings element (SPEC §4). *(B)*
- **FR-7** Host-conformance test kit asserting every FR-2 rule; dashboard reference impl and product shells run it (SPEC §5). *(B)*
- **FR-8** Remote-identity contract finalized with the dashboard: shell-minted per-instance token held in handle closure; SDK transport attaches it (SPEC §2). *(B)*
- **FR-9** Publishes `@gridmason/sdk` 0.x, per-framework subpath exports, changesets.

## Architecture & stack

TS ESM. `src/interface`, `src/helpers` (+ `react`/`vue`/`vanilla` subpaths), `src/noop`, `src/fixture`, `test/conformance`. Depends on `@gridmason/protocol` only (capability grammar, context types, `WidgetId`). No dependency on core.

## Data model

Fixture file schema (records/net/events maps + context presets) — documented in FR-4 issue; consumed verbatim by `gridmason dev`.

## Screens & UX

None (library). The SDK inspector UI lives in the CLI dev server (cli spec).

## Epics & issues

### Epic: S-E0 Bootstrap
Goal: releasable package skeleton.
Depends on: protocol P-E1 on npm

- [ ] Repo scaffold + CI + changesets publish 0.0.x + community files (single combined bootstrap, pattern from protocol)
      FRs: FR-9
      Acceptance: CI green; npm install works; CLA gate active
- [ ] Type-level integration with `@gridmason/protocol` (capability grammar, WidgetId, contexts) + re-export policy
      FRs: FR-1
      Acceptance: no duplicated contract types; protocol type vectors compile against the interface
      Depends on: Repo scaffold

### Epic: S-E1 Interface + dev implementations (Phase A — unblocks dashboard M1 + cli dev)
Goal: the handle exists, widgets can be developed and unit-tested against it.
Depends on: S-E0

- [ ] `HostSDK` interface + typed error surface (`PermissionDenied`, `InstanceGone`) + docs
      FRs: FR-1, FR-2
      Acceptance: compiles against SPEC §3 signature-for-signature; error types exported
- [ ] `createNoopSDK()` with call recording
      FRs: FR-3
      Acceptance: every method resolves typed-empty; recorded calls assertable in a sample widget test
      Depends on: HostSDK interface
- [ ] `createFixtureSDK()` + fixture file schema + capability enforcement
      FRs: FR-4
      Acceptance: fixture-backed `records.read` returns sample; undeclared capability still denied; unmatched call flagged in the recording
      Depends on: createNoopSDK
- [ ] React helper subset
      FRs: FR-5
      Acceptance: sample React widget uses `useRecord`+`useSettings` against fixture SDK in tests
      Depends on: HostSDK interface

### Epic: S-E2 Helpers + conformance (Phase B)
Goal: full author surface + the host-validity yardstick.
Depends on: S-E1

- [ ] Vue + vanilla helper adapters over the shared core
      FRs: FR-5
      Acceptance: parity test matrix — same behaviors across all three adapters
- [ ] Settings-form helper + `settings-form` adapter binding
      FRs: FR-6
      Acceptance: schema-only widget renders an editable form via a stub adapter; updates persist through `settings.update`
- [ ] Conformance suite (host test kit)
      FRs: FR-7
      Acceptance: no-op impl instrumented to fail each rule → suite catches every seeded violation
- [ ] Unmount semantics hardening: token revocation hooks, auto-unsubscribe, `InstanceGone` paths
      FRs: FR-2
      Acceptance: stale-handle call test; leak test shows zero surviving subscriptions after unmount

### Epic: S-E3 Identity binding (Phase B — with dashboard E4)
Goal: the enforcement rail is real, not honor-system.
Depends on: S-E2; coordinates with dashboard D-E4

- [ ] Per-instance token contract: shape, closure-holding rules, transport attachment API
      FRs: FR-8
      Acceptance: contract doc + types; dashboard reference impl consumes them (cross-repo issue filed there)
- [ ] `events` capability gating (`events:<ns>`) end-to-end in helpers + conformance rule
      FRs: FR-2
      Acceptance: subscribe outside declared namespace → typed denial; conformance kit asserts it
- [ ] Telemetry attribution helpers (error/latency per instance)
      FRs: FR-1
      Acceptance: marks carry instanceId + widgetId; documented for host dashboards

## Milestones

1. **M-A:** S-E0 + S-E1 — dashboard M1 + `gridmason dev` unblocked.
2. **M-B:** S-E2 + S-E3 — conformance suite green on the dashboard's reference host.

## Risks & open questions

- JSON-schema form renderer choice for FR-6 (kept behind the adapter, so swappable — pick in S-E2 issue 2).
- Fixture query-pattern matching semantics (glob vs subset) — decide in S-E1 issue 3, document in the schema.

## Changelog

- 2026-07-13 — initial draft from the approved engineering spec set.
