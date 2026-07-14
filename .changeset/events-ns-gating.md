---
'@gridmason/sdk': minor
---

Enforce `events:<ns>` capability gating end to end and strengthen the rule-4 host-conformance check.

The widget-side `emit`/`on` helpers — and the React, Vue, and vanilla adapters that re-export them — now carry the host's denial through faithfully: an out-of-namespace emit or subscribe fails with a typed `PermissionDenied`, never a silent no-op, never a delivered event, and (for subscribe) never a subscription tracked in the per-handle registry. `subscribe` now subscribes through the host before touching the registry so a denied subscribe leaks nothing.

The conformance kit's rule-4 check is strengthened beyond "the denial throws": it now asserts a denied out-of-namespace emit delivers *nothing* to a live, legitimately-subscribed handler — no deliver-past-the-gate leak and no routing by topic name across namespaces ("never a delivered event", SPEC §6). The instrumented-failure fixture seeds a matching "denied but still delivered" leak the kit must catch.
