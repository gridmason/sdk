# Fixture file schema (`@gridmason/sdk/fixture`)

`createFixtureSDK(fixtures, options?)` is the [no-op handle](../src/noop/index.ts)
backed by an author-supplied **fixture map**, so a widget under development
receives *realistic data* instead of empty defaults — while the capability check
still runs, so **fixture-green predicts review-green** (SPEC [§5](./SPEC.md)).

The fixture map is **plain JSON**, keyed by call shape. It is consumed verbatim
by `gridmason dev` (gridmason/cli) and by widget unit tests, so this shape is a
contract. The TypeScript types live in [`src/fixture/schema.ts`](../src/fixture/schema.ts)
(`FixtureFile` and friends) and are re-exported from `@gridmason/sdk/fixture`.

```ts
import { createFixtureSDK } from '@gridmason/sdk/fixture';

const sdk = createFixtureSDK(
  {
    records: {
      read: [
        { ref: { recordType: 'customer', id: 'c1' }, fields: { name: 'Acme', tier: 'gold' } },
      ],
      query: [
        { match: { recordType: 'sale', where: { customer: 'c1' } },
          result: [{ ref: { recordType: 'sale', id: 's1' }, fields: { total: 42 } }] },
      ],
    },
    net: [
      { match: { host: 'api.acme.com', path: '/v2/sales' },
        response: { status: 200, body: { rows: [] } } },
    ],
    events: [
      { topic: { ns: 'acme.sales', name: 'sale-selected' }, payload: { id: 'c1' }, delay: 100 },
    ],
    context: { customer: { recordType: 'customer', id: 'c1' } },
  },
  { capabilities: ['records.read:recordType:customer', 'net:api.acme.com', 'events:acme.sales'] },
);
```

Every top-level field is **optional**; `createFixtureSDK({})` is a valid handle
where every call falls through to the no-op default (but capability checks still
apply — see below).

## Top-level shape

| Field | Type | Purpose |
|---|---|---|
| `records.read` | `ReadFixture[]` | `records.read(ref)` results, matched by ref |
| `records.query` | `QueryFixture[]` | `records.query(spec)` results, matched by pattern |
| `net` | `NetFixture[]` | `net.fetch(req)` responses, matched by host/path/method |
| `events` | `ScriptedEvent[]` | scripted host-side emissions to the widget's subscribers |
| `context` | `PageContext` | runtime slot-value preset for `sdk.context` (overridden by `options.context`) |

### `records.read` — `ReadFixture`

```ts
{ ref: { recordType: 'customer', id: 'c1' }, fields: { name: 'Acme' } }
```

`ref` is a **partial** `RecordRef` (subset-matched against the requested ref).
`{ recordType, id }` serves that exact record; omitting `id` makes a **template**
that serves any id of that type. The returned `RecordData` echoes the *requested*
ref with the fixture's `fields`.

### `records.query` — `QueryFixture`

```ts
{ match: { recordType: 'sale', where: { customer: 'c1' } }, result: [ /* RecordData[] */ ] }
```

`match` is a **partial** `QuerySpec`. `{ recordType }` serves every query of that
type; adding `where`/`limit` narrows it. `result` is the record list returned
(returned as a defensive copy). See matching semantics below.

### `net` — `NetFixture`

```ts
{ match: { host: 'api.acme.com', path: '/v2/sales', method: 'GET' },
  response: { status: 200, body: { rows: [] }, headers: { 'content-type': 'application/json' } } }
```

`match` is a **partial** `ScopedRequest`: `host` is the field a useful pattern
always sets; omit `path`/`method` to match any. `method` defaults to `GET` (the
handle's default) when the request omits it.

`response` fields all default: `status` → `200` (`ok` is derived as `status < 400`),
`headers` → `{}`, `body` → empty. **`body`** is ergonomic: a **string** is served
verbatim (`text()` returns it, `json()` parses it); **any other JSON value**
(object/array/number/boolean) is served as JSON (`json()` returns it, `text()`
returns its `JSON.stringify`) — so a JSON API fixture is just `body: { ... }`.

### `events` — `ScriptedEvent`

```ts
{ topic: { ns: 'acme.sales', name: 'sale-selected' }, payload: { id: 'c1' }, delay: 100 }
```

After `delay` ms (default `0`) the fixture delivers `payload` to every subscriber
of `topic` (matched by `ns` + `name`), simulating the host or another widget
publishing on the bus. Timing is driven by an injectable scheduler
(`options.scheduler`) — the default uses `setTimeout`; tests pass
`createManualScheduler()` for determinism (`tick(ms)` / `flush()`). The fixture
event bus is real: a widget's own `events.emit` also delivers to its `on()`
subscribers (unlike the no-op, which records but never delivers).

## Matching semantics — **subset match**, most-specific-wins

> This resolves the open question the spec's Risks section flagged for
> query-pattern matching: **glob vs subset**. We pick **subset**.

A pattern **matches** a call iff every leaf the pattern constrains is present and
deep-equal in the call — extra fields in the call are ignored (that is the
"subset"). Primitives compare by `Object.is`; arrays match only when same-length
and element-wise equal; objects recurse. The single matcher
(`subsetMatches`) backs reads, queries, and net alike.

When several fixtures match one call, the **most specific** wins — specificity is
the count of constrained leaf values in the pattern. Ties break by **declaration
order** (the first wins). So `{ recordType: 'sale', where: { customer: 'c1' } }`
(2 leaves) outranks a bare `{ recordType: 'sale' }` (1 leaf), and among equally
specific patterns the earlier-listed one is chosen. This selection is total and
deterministic.

### Why subset, not glob

1. **The call shapes are structured objects** (`QuerySpec`, `ScopedRequest`,
   `RecordRef`), not opaque strings. A partial example that must be a structural
   subset is the natural fit; glob would force serializing a call to a string and
   matching a wildcard against it — fragile to key order and whitespace.
2. **Determinism → "fixture-green predicts review-green."** Subset match has a
   well-defined specificity order, so *which* fixture answers a call is stable and
   explainable. A serialized-string glob has no comparable, stable tiebreak.
3. **No new syntax** for the `gridmason dev` loop: an author writes the shape of
   the call they expect, partially filled — nothing to learn or escape.
4. **No accidental cross-matches**: a glob like `*sale*` could match an unintended
   record type or host; a structural subset cannot.

### The tradeoff (documented, not hidden)

Subset match cannot express "every path under `/v2/`" — an author lists the paths,
or omits `path` to match any path on a host. If prefix/glob path matching is ever
needed, it can be added as an **explicit opt-in matcher** (e.g. a `{ pathPrefix }`
pattern field) without changing this subset default, so nothing here is a
one-way door.

## Capability enforcement (a fixture never grants what the widget didn't declare)

`createFixtureSDK`'s `options.capabilities` is the widget's declared capabilities
— the manifest `capabilities` subset. Both the object form (`{ api, scope }`, as a
manifest carries it) and the string form (`'records.read:recordType:customer'`,
ergonomic for tests) are accepted; an invalid entry throws at construction.

Every gated call (`records.read`/`query`/`write`, `net.fetch`, `events.emit`/`on`)
is checked **before** the fixture map is consulted, using the same scope-prefix
`min(user, widget)` semantics as a real host (SPEC §6; in dev there is no user, so
the enforced set is the declared capabilities alone):

- **api must match exactly** — `records.read` and `records.write` are distinct.
- **the declared scope path must be a prefix of the required one** — unscoped
  `records.read` grants every read; `records.read:recordType` grants every type;
  `records.read:recordType:customer` grants only `customer`.

A call whose required capability is **not** granted is denied with a typed
`PermissionDenied` — it is **never** satisfied by fixture data, and never leaks an
empty result the widget could mistake for "no data". **`capabilities` defaults to
`[]`**, so a fixture that declares nothing denies every gated call (a widget
declaring nothing can read nothing).

Required capability per call:

| Call | Required capability |
|---|---|
| `records.read(ref)` / `records.query(spec)` | `records.read:recordType:<type>` |
| `records.write(ref, patch)` | `records.write:recordType:<type>` |
| `net.fetch(req)` | `net:<req.host>` |
| `events.emit(topic, …)` / `events.on(topic, …)` | `events:<topic.ns>` |

`settings`, `nav`, and `telemetry` carry no capability and are ungated.

## Per-call flagging (what the CLI SDK inspector renders)

Every gated call is recorded on the shared [`CallRecorder`](../src/noop/recorder.ts)
with a `meta` tag (`FixtureCallMeta`) so the CLI's SDK inspector (cli §4) can show
which calls were backed by fixtures:

| `outcome` | Meaning |
|---|---|
| `fixture-hit` | a fixture matched; the call returned fixture data |
| `default-empty` | allowed, but no fixture matched → no-op typed-default |
| `denied` | capability check failed → `PermissionDenied`; `meta.capability` is the ungranted capability |
| `allowed` | a gated call with no fixture concept (an `events` emit/subscribe) passed its check |

Reach the recording via `getFixtureControls(sdk).recorder`:

```ts
await sdk.records.read({ recordType: 'customer', id: 'c1' });
getFixtureControls(sdk).recorder.last('records.read')?.meta; // → { outcome: 'fixture-hit' }
```

Ungated calls (`settings`/`nav`/`telemetry`) record with no `meta`, exactly as the
no-op does.
