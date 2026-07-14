---
"@gridmason/sdk": minor
---

Add the Vue and vanilla widget-side helper adapters (FR-5, Phase B), completing
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
