# `@gridmason/protocol` re-export policy

`@gridmason/sdk` depends on **`@gridmason/protocol` only** (SPEC §7) and never
redefines a shared contract type. Capability grammar, the page-context type
grammar, and the per-mount `WidgetID` have exactly **one** definition — the one
`@gridmason/protocol` publishes — so the same rules gate the picker (core §6) and
every SDK call (SPEC §6). This document is the policy issue #3 establishes:

- **which** protocol types the SDK re-exports for widget authors' convenience,
- **which** it consumes internally only, and
- **where** downstream issues (#5 `HostSDK` interface, the helpers, the
  conformance kit) import each type from.

The re-export barrel that implements this policy is
[`src/protocol/index.ts`](../src/protocol/index.ts); it is surfaced at the
package root, so an author reaches the re-exported names from `@gridmason/sdk`.

## The dependency and its version pin

`package.json` declares:

```jsonc
"dependencies": { "@gridmason/protocol": "^0.0.2" }
```

It is the SDK's **only** runtime dependency (SPEC §7 — no `core`, no registry, no
host). The pin is `^0.0.2` for two reasons:

- **Org consistency.** The other `@gridmason/protocol` consumers (`core`, `cli`)
  declare the identical `^0.0.2` range; the supply chain reads the same
  everywhere.
- **Deliberate, not floating, bumps.** Under npm semver a `^0.0.z` caret resolves
  to `>=0.0.2 <0.0.3` — it does **not** float `0.0.x` patches or `0.x` minors. In
  0.x every changesets release may carry a breaking change (0.x has no stability
  guarantee), and gridmason is contract-first: a dependent adopts a new protocol
  by bumping its pin **on its own cadence** with a changeset, never silently.
  When protocol publishes `0.0.3`, the SDK opts in explicitly.

## What the SDK re-exports (author-facing, via `@gridmason/sdk`)

These resolve to the protocol package; the SDK adds no shape of its own (the one
alias below is a pure rename, documented as such).

| Re-exported name(s) | Protocol origin | Why author-facing |
|---|---|---|
| `WidgetID` | identity, §3.3 | the per-mount identity an author reads off `sdk.identity.widgetId` (`{ source, tag }`) |
| `WidgetId` *(alias → `WidgetID`)* | — | SPEC §3 spells it `WidgetId`; the alias bridges the spelling to the same protocol type (see below) |
| `ContextMap`, `ContextType`, and its members (`PrimitiveContextType`, `CompositeContextType`, `RecordRefContextType`, `StringContextType`, `NumberContextType`, `BoolContextType`, `IdContextType`, `ListContextType`, `ObjectContextType`) | context, §3.2 | the declared **shape** of context slots — what an author needs to reason about `sdk.context` |
| `Capability`, `CapabilityApi`, `CapabilityError` | manifest/capability, §3.1 | the capability-grammar **types** an author sees when declaring/handling capabilities |
| `CAPABILITY_APIS` *(value)* | manifest/capability, §3.1 | the canonical, closed v1 api enumeration `CapabilityApi` is the union of |

## What the SDK consumes internally (import from `@gridmason/protocol` directly)

Not on the author surface. The interface and helper code that needs these
imports them straight from `@gridmason/protocol` — they are **not** re-exported
through `@gridmason/sdk`, so the author API stays small and intentional.

| Name(s) | Protocol origin | Consumed by / role |
|---|---|---|
| `isContextSubset` | context, §3.2 | `requiresContext ⊆ pageContext` gating — a host/picker concern, not widget code |
| `parseCapability`, `validateCapability`, `formatCapability`, `CapabilityParseResult`, `ParsedCapability` | manifest/capability, §3.1 | capability **enforcement** utilities the gated `records`/`net` call sites (#5) run |
| `SourceKind`, `ParsedSource`, `parseSource`, `sourceKind`, `canonicalSource`, `sourcesEqual`, `compareSources`, `widgetIdEqual`, `compareWidgetIds`, `widgetIdKey`, `LOCAL_SOURCE`, `SIDELOAD_PREFIX` | identity, §3.3 | `source` parsing / identity comparison — host/registry concerns |
| `Manifest`, `ManifestKind`, `ManifestSize`, `GridSize`, `ManifestRequirement`, `ManifestContextRequirement`, `PageTypeDescriptor`, `lintTag`, `TagLintResult`, `TagViolation`, `TagViolationCode` | manifest, §3.1 | manifest authoring/lint — owned by the CLI and registry, not the SDK surface |
| `LayoutDoc` / layout, migrator, verify, negotiate, POC-import, and the `@gridmason/protocol/vectors` exports | layout / verify / negotiate / poc-import / vectors | not part of the widget↔host runtime contract the SDK exposes |

## Where downstream issues import each type from

- **#5 (`HostSDK` interface, `src/interface`).** Author-facing shared types come
  from the sibling barrel `../protocol/index.js` (so the interface and the author
  surface reference one binding); enforcement-only utilities (`parseCapability`
  et al.) come from `@gridmason/protocol` directly. Never redefine a contract
  type in `src/interface`.
- **Helpers (`src/helpers`).** Same rule: types via the barrel, utilities direct
  from protocol.
- **Widget authors.** Import the re-exported names from `@gridmason/sdk`; reach
  for `@gridmason/protocol` directly only for an internal-consumption name.

## Two facts a downstream reader hits immediately

### `WidgetID`, not `WidgetId`

SPEC §3 writes the per-mount identity as `WidgetId`; `@gridmason/protocol@0.0.2`
publishes it as **`WidgetID`**. The barrel re-exports the real `WidgetID` and
adds `export type WidgetId = WidgetID` — a pure spelling alias to the same
`{ readonly source: string; readonly tag: string }` type, **not** a second
declaration. Prefer `WidgetID` (protocol's own name) in new code; the alias
exists so SPEC-literal code (e.g. #5's interface as written) still resolves.

### No `PageContext` in protocol 0.0.2 — a gap #5 depends on

SPEC §3's interface has `context: PageContext` annotated "(protocol §3.2)". As of
`@gridmason/protocol@0.0.2` **there is no type named `PageContext`.** Protocol
§3.2 publishes the context **type grammar** — `ContextMap` / `ContextType` — which
describes the declared *shape* of context slots (a page-type's provided context
and a widget's `requiresContext`, both `ContextMap`s, related by
`isContextSubset`). That is a *declaration* vocabulary, not a runtime
page-context **value** type keyed by slot name (what `sdk.context.record` in
SPEC §4 reads).

Consequences, so #5 does not guess:

- The SDK does **not** define a local `PageContext` — that would be exactly the
  duplicated contract type this policy forbids. This issue re-exports the context
  *type grammar* protocol actually ships.
- When #5 types `HostSDK.context`, it must resolve the type from
  `@gridmason/protocol`. If a runtime page-context **value** type is required and
  protocol still ships only the type grammar, that is a **protocol contract gap**:
  #5 should file a cross-repo issue against `gridmason/protocol` (reference SPEC
  §3.2 and FR-1) requesting the runtime page-context value type, rather than
  minting a `PageContext` in the SDK. Until then, `context` types against the
  grammar protocol publishes (`ContextMap`).
