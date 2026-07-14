---
"@gridmason/sdk": minor
---

Harden the unmount lifecycle so SPEC §3 rule 6 holds mechanically across the
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
