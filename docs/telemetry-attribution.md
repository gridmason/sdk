# Telemetry attribution (SPEC §3 telemetry/identity, §2 audit trail)

A host attributes error and latency **per widget instance** and **per widget
identity** (SPEC §3, core §7). The raw telemetry surface on the handle is
identity-free at the call site:

```ts
telemetry: { error(e: WidgetError): void; mark(name: string, ms: number): void }
```

`mark(name, ms)` and `error(e)` say *what* happened, not *which mount*. The host
knows the mount anyway, because the handle is **per-instance** (SPEC §3 rule 5):
that per-instance binding is how the host maps a call back to `(instanceId,
widgetId)`. The attribution helpers make that binding **explicit and available
widget-side**, so a widget author never hand-threads identity and a host has one
documented record shape to aggregate.

This is the **audit-trail side** of the per-instance binding (SPEC §2). It is
**not security enforcement**: the identity stamped here is *read* from the handle,
never minted (SPEC §4, §2). A widget can only ever read its own handle's
`identity`, so it cannot attribute a mark to another mount through these helpers.

## The helper

`attributeTelemetry(sdk)` returns a stable, per-handle facade; the per-framework
forms are `useTelemetry(sdk)` (React hook, Vue composable) and, for vanilla, the
re-exported `attributeTelemetry` itself.

```ts
import { attributeTelemetry } from '@gridmason/sdk';        // core / vanilla
import { useTelemetry } from '@gridmason/sdk/react';        // or /vue

const telemetry = attributeTelemetry(sdk);

telemetry.mark('first-paint', 12);                          // → AttributedMark
telemetry.error({ message: 'render failed', name: 'RangeError' }); // → AttributedError
const rows = await telemetry.time('load', () => getRecord(sdk, ref)); // times + marks
```

Each method reads `sdk.identity`, forwards to `sdk.telemetry`, and returns the
attributed audit-trail record. `time(name, op)` is the ergonomic form of `mark`:
it measures wall-clock around `op` (sync return or async settle), marks the
elapsed `ms` under `name`, and returns `op`'s result unchanged. Latency is marked
whether `op` succeeds **or throws/rejects** (latency-to-failure is telemetry too);
the original error is re-thrown afterward.

## The attributed mark shape (what a host receives)

For a **latency mark**, a host reconstructs:

| Field        | Type       | Source                                    |
|--------------|------------|-------------------------------------------|
| `instanceId` | `string`   | `sdk.identity.instanceId` — the emitting mount |
| `widgetId`   | `WidgetID` | `sdk.identity.widgetId` — `{ source, tag }` |
| `name`       | `string`   | the mark name (e.g. `first-paint`, `load`) |
| `ms`         | `number`   | the measured latency, in milliseconds     |

`name` and `ms` arrive on the wire through `sdk.telemetry.mark(name, ms)`;
`instanceId` and `widgetId` come from the **per-instance handle** the host holds
for that mount (SPEC §3 rule 5). `AttributedMark` (returned by `mark`/`time`) is
that same four-field record surfaced widget-side, so a widget, a test, or a
host-side collector all name the mark shape identically.

With these fields a host dashboard can aggregate latency **per instance** (this
one mount's `first-paint` over time) and **per widget identity** (every mount of
`{ source, tag }` — the p50/p95 for a widget across the page/tenant).

## The attributed error shape (what a host receives)

For an **error**, `error(e)` forwards a copy of the caller's `WidgetError` with
identity folded into `detail`, and returns an `AttributedError`:

| Field                 | Type          | Source                                        |
|-----------------------|---------------|-----------------------------------------------|
| `instanceId`          | `string`      | `sdk.identity.instanceId`                      |
| `widgetId`            | `WidgetID`    | `sdk.identity.widgetId` — `{ source, tag }`    |
| `error.message`       | `string`      | caller's `WidgetError.message`                 |
| `error.name`          | `string?`     | caller's `WidgetError.name`                     |
| `error.stack`         | `string?`     | caller's `WidgetError.stack`                    |
| `error.detail`        | object        | caller's `detail` **plus** `{ instanceId, widgetId }` |

Unlike a mark, `WidgetError` has an in-band slot (`detail`), so identity is stamped
directly onto the forwarded report — an error stays self-describing even when a
host pipes it somewhere detached from the handle. Attribution keys win: if a caller
puts its own `instanceId`/`widgetId` in `detail`, the stamped values overwrite
them, so an error is always attributed to the mount that actually reported it.

## Revoked handle (SPEC §3 rule 6)

`mark`/`error`/`time` bottom out in `sdk.telemetry`, whose sync methods **throw a
typed `InstanceGone`** on a handle whose token was revoked on unmount (consistent
with #13). The helpers do **not** swallow it: a telemetry call on a stale handle
throws `InstanceGone`, and for an async `op` that already settled inside `time`,
that surfaces as a rejection of the returned promise. Use `isInstanceGone(err)` to
detect it.

## Scope

This helper delivers the widget-side attribution and the documented record shape.
It does **not** implement any host-side dashboard, storage, or aggregation — that
is the consuming host's concern (e.g. `gridmason/dashboard` and product shells read
the shape above). It reuses `identity` from the host-SDK interface (S-E1) and mints
no identity of its own.
