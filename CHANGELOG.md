# @gridmason/sdk

## 0.3.0

### Minor Changes

- eb58efc: Add the host-conformance test kit at `@gridmason/sdk/conformance` (SPEC §5,
  FR-7). A host implementation supplies a `ConformanceHost` adapter and the kit
  asserts every SPEC §3 contract rule: capability intersection before transport
  with typed `PermissionDenied` (rule 1), `net.fetch` host scoping (rule 2), the
  per-instance remote-identity binding (rule 3), typed namespaced capability-gated
  events (rule 4), per-instance `instanceId` isolation (rule 5), and unmount
  revocation with auto-unsubscribe and typed `InstanceGone` (rule 6). Exposes the
  vitest binding `runHostConformance` plus the framework-free `conformanceChecks` /
  `runConformanceChecks`. Passing the suite is the definition of a valid Gridmason
  host.
- 760541f: Add the settings-form helper (FR-6): a schema-only widget renders an editable
  settings form in the host's design system via a host-supplied `settings-form`
  adapter, and edits round-trip through `settings.update`.

  - Framework-agnostic core (from `@gridmason/sdk`): the `SettingsFormAdapter` contract,
    a `compileSchema` JSON-Schema→field compiler (the pinned renderer approach — kept
    behind the adapter, so swappable; see `docs/settings-form.md`), and a
    `settingsFormController` that owns the schema→form binding and value round-trip
    (registering the schema once via `settings.onSchema`, reusing the `useSettings`
    source).
  - React binding (from `@gridmason/sdk/react`): `useSettingsForm(sdk, schema, adapter)`.
  - The SDK ships no field UI — the host supplies its design-system components through
    the adapter. A dev/reference stub adapter backs the tests and the new Storybook
    story only (not published).

- c23743e: Harden the unmount lifecycle so SPEC §3 rule 6 holds mechanically across the
  helper core and the dev implementations (FR-2, issue #13).

  - **Token revocation.** The no-op and fixture dev handles now carry a revocable
    per-instance lifecycle. A new `unmount()` on `getNoopControls(sdk)` /
    `getFixtureControls(sdk)` revokes the instance token; after it, every gated
    handle call fails with a typed `InstanceGone` — async members (`records`, `net`,
    `settings.update`) reject, sync ones (`events`, `settings.get`/`onSchema`, `nav`,
    `telemetry`) throw — never hanging and never returning data. `unmount()` is
    idempotent, and `controls.revoked` reports the state.
  - **Auto-unsubscribe.** Every `events.on` subscription registered through a handle
    is tracked and released on unmount, so no subscriber survives the mount that
    created it (the fixture drops it from its in-memory bus; the no-op records the
    release).
  - **Adapter wiring.** A new `releaseInstance(sdk)` releases every helper `events`
    subscription for a handle in one call. React and Vue expose it as a
    `useInstanceCleanup(sdk)` lifecycle hook (effect cleanup / `onScopeDispose`), and
    the vanilla adapter re-exports `releaseInstance` for a caller-driven teardown — so
    a framework unmount frees the widget-side subscriptions.

  Consistent with the host-conformance kit: the dev handles pass the kit's
  authoritative rule-6 check, so a conforming host and a widget using the helpers
  agree on unmount behavior.

- bb5189a: Add the Vue and vanilla widget-side helper adapters (FR-5, Phase B), completing
  the three-framework set over the one framework-agnostic core.

  - `@gridmason/sdk/vue` — Vue 3 composables (`useRecord`, `useSettings`, `on`) plus
    the re-exported 1:1 wrappers (`emit`, `scopedFetch`). `useRecord`/`useSettings`
    return `ComputedRef`s over the shared reactive source and release their
    subscription on `onScopeDispose`; `useSettings`'s settings computed is read-only
    (persist only through its setter). `vue` is an **optional** peer dependency.
  - `@gridmason/sdk/vanilla` — the non-hook form: `getRecord` (one-shot promise) and
    `watchRecord` (subscribe-style), an imperative `bindSettings` binding
    (`get`/`update`/`watch`), `on` (caller-managed `Unsubscribe`), and the same
    `emit`/`scopedFetch`. No framework peer.

  All three adapters share one core cache/settings/event seam and add no privileged
  logic — each helper mirrors a `HostSDK` method 1:1. A new parity matrix
  (`test/parity`) runs the same behavioral cases (record read, settings bind +
  persist, emit/receive, scoped fetch, capability denial, idle read) against React,
  Vue, and vanilla and asserts identical observable behavior. The shared core needed
  no change to host all three.

## 0.2.0

### Minor Changes

- 8f5a967: Retype `HostSDK.context` to the protocol page-context **value** type. Bumps
  `@gridmason/protocol` to `^0.0.3`, which publishes the runtime value surface
  (`PageContext`, `ContextValue`, `RecordRefValue`, `ObjectValue`) that
  gridmason/protocol#37 requested. `HostSDK.context` is now a `PageContext` (the
  value side of the `ContextMap` type grammar) instead of the interim `ContextMap`;
  `createNoopSDK`/`createFixtureSDK` context defaults and the fixture file's
  `context` preset are typed to `PageContext` accordingly. The value types are
  re-exported author-facing from `@gridmason/sdk`; the value-side conformance
  helpers (`matchesContextType`/`matchesContextMap`) stay internal, mirroring
  `isContextSubset`.

## 0.1.0

### Minor Changes

- 59d5cbf: S-E1: the committed M1 surface. Ships the `HostSDK` interface (records, scoped
  net.fetch, typed namespaced events, context, settings, nav, telemetry, per-mount
  identity) with the typed error surface (`PermissionDenied`, `InstanceGone`) and
  the six contract rules documented; `createNoopSDK()` (typed-empty defaults, call
  recording, dev-branded); `createFixtureSDK(fixtures)` (JSON fixture map with
  subset matching, fixture-hit/default-empty flagging, scripted events, capability
  enforcement against the declared manifest); and the React helper subset
  (`useRecord`, `useRecordSuspense`, `useSettings`, `emit`/`on`, `scopedFetch`)
  over a framework-agnostic core ready for the Phase B Vue/vanilla adapters.

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
