# SPEC — `@gridmason/sdk` (the host interface + widget helpers)

**Repo:** `gridmason/sdk` · **Package:** `@gridmason/sdk` · **License:** AGPL-3.0 (CLA required) · **Status:** reviewed 2026-07-13 · **Project:** [Gridmason](https://github.com/gridmason/.github)

Two contracts in one package, on opposite sides of the same boundary:

1. **The host-SDK interface** — what a host shell (the dashboard, or any application embedding Gridmason) *implements* so widgets can reach data, permissions, events, and telemetry through a single capability-enforcing chokepoint.
2. **The widget-side helper library** — what a widget author *imports* to talk to that host without hand-writing the wire protocol.

The engine (`core`) passes the SDK handle to each widget **opaquely** (core §4) — core never inspects it. This package defines the handle. **All widget network I/O flows through the SDK** (Gridmason principle) — a widget that reaches `fetch`/`XMLHttpRequest` directly is a review failure, because only the SDK path carries the per-remote identity binding the API trusts (dashboard §3).

> **M1 committed** (README build order): the host-SDK **interface** + a **no-op reference implementation** — the dashboard's M1 static boot needs a real handle to pass widgets before any registry exists. The full helper library and enforcement reference land alongside dashboard M2/M3.

## 1. Scope

**In:** the `HostSDK` TypeScript interface (data access, capability model, typed event bus, navigation, telemetry, settings-form binding); the widget-side helpers that wrap it; the capability-enforcement contract (`min(user, widget)`); the remote-identity binding contract; a **no-op reference implementation** for tests/dev; conformance tests any host implementation must pass.

**Out (explicit non-goals):** any concrete backend (the dashboard's reference *implementation* lives in the dashboard repo, §6 there); the transport crypto (that is the shell's Service Worker, dashboard §3 — the SDK defines *what* identity gets stamped, not *how* the SW attaches it); UI components (that is `@gridmason/design`/host theme); module loading (registry + shell).

## 2. The boundary

```
widget code
  │  imports @gridmason/sdk helpers  →  calls sdk.records.read(...)
  ▼
HostSDK handle  (interface defined here; implemented by the host shell)
  │  enforces min(user permissions, declared widget capabilities) per call
  │  every network call carries the per-remote identity header (which remote asked)
  ▼
host shell  →  SDK transport (attaches per-instance identity token)
             →  Service Worker (attaches auth)  →  API
```

The SDK is the **only** sanctioned path from widget to data. Two properties make that enforceable rather than honor-system:

- **Capability scoping** — every SDK method checks the caller's declared `capabilities` (manifest, protocol §3.1) intersected with the *user's* permissions. A widget declaring `records.read:recordType:customer` used by a user without customer-read gets a typed `PermissionDenied`, never data.
- **Remote identity** — at mount the shell mints an unforgeable per-instance token, held in the SDK handle's closure; the SDK transport attaches it to every call and the API maps it to `(instanceId, widgetId, declared capabilities)` (dashboard §3). A call without a valid token gets no capability-scoped access — a widget that bypasses the SDK reaches the API as an anonymous page script, not as itself. Same-document JS is not a sandbox: the binding is enforcement plumbing plus an audit trail, and the hard boundary stays review of signed code.

## 3. Host-SDK interface (what the host implements)

```ts
interface HostSDK {
  // ── data access (capability-gated; all async; all through the SW transport) ──
  records: {
    read(ref: RecordRef, opts?): Promise<Record>            // cap: records.read:<scope>
    query(spec: QuerySpec): Promise<Record[]>               // cap: records.read:<scope>
    write(ref: RecordRef, patch: Patch): Promise<Record>    // cap: records.write:<scope>
  }
  net: {
    fetch(req: ScopedRequest): Promise<Response>             // cap: net:<host>; NO raw fetch
  }

  // ── typed event bus (cross-widget comms; core §4 event out, this is the bus) ──
  events: {
    emit<T>(topic: TypedTopic<T>, payload: T): void
    on<T>(topic: TypedTopic<T>, handler: (p: T) => void): Unsubscribe
  }

  // ── context + settings ──
  context: PageContext                                       // typed, from the page (protocol §3.2)
  settings: {
    get(): WidgetSettings                                    // saved per-instance props
    update(patch: Partial<WidgetSettings>): Promise<void>    // persists via layout store
    onSchema(schema: JSONSchema): void                        // register settings form (core §4)
  }

  // ── navigation + host affordances (no window.location; host owns routing) ──
  nav: { open(target: RouteRef): void; toast(msg: Notice): void }

  // ── observability (host attributes error/latency per widget; core §7) ──
  telemetry: { error(e: WidgetError): void; mark(name: string, ms: number): void }

  // ── identity of THIS mount (opaque to the widget; used by helpers) ──
  readonly identity: { instanceId: string; widgetId: WidgetId /* {source,tag} */ }
}
```

**Contract rules a conforming host MUST honor** (conformance-tested, §5):

1. Every `records`/`net` call is checked against `min(user, declared-capabilities)` **before** transport; denial is a typed `PermissionDenied`, not an empty result (no capability leakage).
2. `net.fetch` only reaches hosts the widget declared (`net:<host>` capability); there is **no** unscoped fetch on the handle.
3. Every outbound call carries the remote-identity binding; a host that drops it fails conformance.
4. `events` topics are **typed and namespaced**; a widget cannot subscribe to a topic it has no capability for. The bus is same-document, in-memory, host-mediated — never a shared global (core §4).
5. The handle is **per-instance**: two mounts of the same widget get distinct handles with distinct `instanceId`.
6. On unmount the host revokes the instance token and the SDK releases every `events` subscription registered through the handle; a stale handle's calls fail with a typed `InstanceGone` (never a hang, never data).

## 4. Widget-side helpers (what the author imports)

Thin ergonomics over the handle — no privileged logic, so a widget can be audited by reading its SDK calls:

```ts
import { useRecord, useSettings, emit, on, scopedFetch } from '@gridmason/sdk'

// framework-agnostic core + thin per-framework adapters (React hooks, Vue composables,
// vanilla functions) — the helper set mirrors the handle 1:1, adds caching/suspense glue.
const record   = await useRecord(sdk, sdk.context.record)      // typed by recordType
const [s, set] = useSettings(sdk)                              // reactive settings
scopedFetch(sdk, { host: 'api.acme.com', path: '/v2/sales' }) // compiles to net.fetch
```

- Helpers are **optional** — a vanilla widget may call the handle directly. They exist so the common cases (read the context record, bind settings, emit an event) are one line and correctly typed.
- The **settings-form** helper renders a JSON-schema'd form in the host's design system via the `settings-form` adapter (core §4 fallback) when the widget ships no custom settings element.
- Per-framework packages (`@gridmason/sdk/react`, `/vue`, `/vanilla`) share one core; the React set is the reference (dashboard is React, GW-D16).

## 5. No-op reference implementation + conformance suite

- **No-op impl** (`createNoopSDK()`): every method resolves to empty/typed-default, records calls for assertions, denies nothing (dev only, clearly labeled). This is what dashboard **M1** passes to widgets before a registry exists, and what widget unit tests mount against.
- **Fixture impl** (`createFixtureSDK(fixtures)`): the no-op impl backed by an author-supplied fixture map, so a widget under development receives *realistic data*, not empty defaults. Fixtures are plain JSON keyed by call shape — `records`: record-ref → record, query-spec pattern → record list; `net`: `host + path` pattern → response body/status; `events`: optional scripted emissions (topic + payload + delay) to exercise subscribers. Unmatched calls fall through to no-op defaults **and are flagged** (the CLI's SDK inspector shows fixture-hit vs default-empty per call, cli §4). Capability checks still run against the manifest — a fixture never satisfies a call the widget didn't declare, so fixture-green predicts review-green. Consumed by `gridmason dev` and by widget unit tests needing data-bearing cases.
- **Conformance suite**: a host-implementation test kit (import it, pass your `HostSDK`, it asserts the §3 contract rules — capability intersection, denial typing, remote-identity presence, per-instance isolation, typed-topic gating). The dashboard's reference implementation and each product shell run it. *Passing the suite is the definition of "a valid Gridmason host."*

## 6. Security posture

- The SDK is a **capability chokepoint**, not a convenience layer: removing it must break data access, not merely inconvenience it. Hence no raw `fetch` on the handle, no untyped event bus, no ambient globals.
- The package ships **no keys and no transport crypto** — it defines the identity that gets stamped; the shell's SW does the stamping (dashboard §3). Clean split: SDK = *what is allowed*, SW = *how it's proven*.
- Capability grammar and the `min(user, widget)` semantics are imported from `@gridmason/protocol` (§3.1) — one definition, enforced identically in picker-gating (core §6) and at every SDK call.

## 7. Package + repo

- Publishes `@gridmason/sdk` (ESM + types; per-framework subpath exports; changesets; SemVer). **License: AGPL-3.0 (GW-D8); all contributions require the CLA.**
- Repo: `src/interface` (the `HostSDK` types), `src/helpers` (framework-agnostic + `react`/`vue`/`vanilla` adapters), `src/noop`, `test/conformance`. Storybook for the settings-form helper; unit tests for helpers + the full conformance kit.
- Depends on: `@gridmason/protocol` (capability grammar, context types, `WidgetId`). No dependency on `core` (core consumes the handle opaquely, not the reverse), the registry, or any host.

## 8. Milestones

1. **M1 — interface + no-op** (committed): `HostSDK` interface + `createNoopSDK()` + the React helper subset the dashboard M1 needs. Unblocks dashboard M1 static boot.
2. **M2 — helpers + conformance**: full helper set (all three framework adapters), settings-form binding, the host-conformance test kit. Unblocks dashboard M2 (reference implementation runs conformance).
3. **M3 — enforcement contract hardening**: remote-identity binding contract finalized with the dashboard SW; capability-diff hooks aligned with registry review (protocol §3.1).
4. Exit: the dashboard's reference `HostSDK` passes the conformance suite and enforces `min(user, widget)` end-to-end on a live third-party widget.
