/**
 * Re-export barrel: the `@gridmason/protocol` types the SDK surfaces to widget
 * authors (issue #3, docs/SPEC.md §3, §6, §7).
 *
 * The SDK's shared contract types have **one** definition — the one published by
 * `@gridmason/protocol` — enforced identically in picker-gating (core §6) and at
 * every SDK call (SPEC §6). This module never redefines any of them; it only
 * re-exports the subset a widget author reads through `@gridmason/sdk`, so the
 * common author-facing names resolve without a second `@gridmason/protocol`
 * install. Everything protocol exports that is *not* re-exported here is
 * consumed internally (imported directly from `@gridmason/protocol` by the code
 * that needs it) and is intentionally kept off the author surface.
 *
 * The full policy — what is re-exported here versus consumed internally, and
 * where downstream issues (#5 `HostSDK` interface, the helpers, the conformance
 * kit) should import each type from — lives in
 * [`docs/re-export-policy.md`](../../docs/re-export-policy.md). Two facts that
 * doc records and that a downstream reader hits immediately:
 *
 * - **`WidgetID`, not `WidgetId`.** SPEC §3 writes the per-mount identity as
 *   `WidgetId`; `@gridmason/protocol` publishes it as `WidgetID`. This module
 *   re-exports the real `WidgetID` and adds a `WidgetId` type alias to it — a
 *   pure spelling bridge to the same `{ source, tag }` type, not a copy.
 * - **The page-context grammar and its runtime values are distinct.**
 *   `ContextMap` / `ContextType` (protocol §3.2) declare the *shape* of context
 *   slots — a page-type's provided context and a widget's `requiresContext`.
 *   `PageContext` (published by `@gridmason/protocol@0.0.3`, gridmason/protocol#37)
 *   is the *value* side: the slot values `SPEC §3`'s `context: PageContext`
 *   carries. Both grammars and values are re-exported below; the value-side
 *   conformance helpers (`matchesContextType`/`matchesContextMap`) stay internal,
 *   like `isContextSubset` — see the policy doc.
 */

// ── Per-mount widget identity (protocol §3.3; SPEC §3 `HostSDK.identity`) ──
// A widget is `(source, tag)` — never `tag` alone. Authors read this off
// `sdk.identity.widgetId`. The `source`-parsing helpers (`parseSource`,
// `sourceKind`, `SourceKind`, `ParsedSource`, …) are host/registry concerns and
// stay off the author surface — import them from `@gridmason/protocol` directly.
import type { WidgetID } from '@gridmason/protocol';

export type { WidgetID };

/**
 * SPEC §3 spells the mount identity `WidgetId`; `@gridmason/protocol` publishes
 * it as {@link WidgetID}. This is a pure alias to that one type — the same
 * `{ readonly source: string; readonly tag: string }` contract, never a local
 * redefinition — so code following the SPEC's spelling still resolves to
 * protocol. Prefer {@link WidgetID} (protocol's own name) in new code.
 */
export type WidgetId = WidgetID;

// ── Page-context type grammar (protocol §3.2; SPEC §3 `HostSDK.context`) ──
// The declared *shape* of context slots: a page-type declares the context it
// provides and a widget declares the context it requires, both as `ContextMap`s;
// `isContextSubset` (consumed internally, not re-exported) relates them. These
// are the types a widget author needs to reason about the *declared* context.
export type {
  BoolContextType,
  CompositeContextType,
  ContextMap,
  ContextType,
  IdContextType,
  ListContextType,
  NumberContextType,
  ObjectContextType,
  PrimitiveContextType,
  RecordRefContextType,
  StringContextType,
} from '@gridmason/protocol';

// ── Page-context runtime values (protocol §3.2; SPEC §3 `HostSDK.context`) ──
// The *value* side of the grammar above, published by `@gridmason/protocol@0.0.3`
// (gridmason/protocol#37). `HostSDK.context` is a `PageContext` — a map of slot
// keys to `ContextValue`s (a `RecordRefValue`, string, number, boolean, list, or
// nested `ObjectValue`); an author reads these values off `sdk.context`, so the
// value types are author-facing and re-exported alongside the grammar. The
// value-side conformance helpers `matchesContextType` / `matchesContextMap` (the
// runtime counterpart of `isContextSubset`) are host/picker enforcement, not
// widget code — they stay off the author surface (import them from
// `@gridmason/protocol` directly). See the policy doc.
export type {
  ContextValue,
  ObjectValue,
  PageContext,
  RecordRefValue,
} from '@gridmason/protocol';

// ── Capability grammar (protocol §3.1; SPEC §6) ──
// One definition of `<api>[:<scope>]` and the `min(user, widget)` semantics,
// enforced identically everywhere. The author-facing *types* are re-exported;
// the grammar *functions* (`parseCapability`, `validateCapability`,
// `formatCapability`) are enforcement utilities consumed internally by the
// gated SDK call sites (#5), not by widget code — import those from
// `@gridmason/protocol` directly.
export type {
  Capability,
  CapabilityApi,
  CapabilityError,
} from '@gridmason/protocol';

/**
 * The enumerated v1 capability apis (`records.read`, `records.write`, `net`,
 * `events`) — the canonical, closed list {@link CapabilityApi} is the union of.
 * A runtime value (a `readonly` tuple), hence a value re-export, not a type one.
 */
export { CAPABILITY_APIS } from '@gridmason/protocol';
