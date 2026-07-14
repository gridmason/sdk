/**
 * The fixture file schema (docs/SPEC.md §5, FR-4) and its matcher — the plain
 * JSON an author writes so a widget under development receives realistic data
 * instead of empty no-op defaults. This module owns the **shape** of a fixture
 * file ({@link FixtureFile}) and the **matching semantics** ({@link matchRead},
 * {@link matchQuery}, {@link matchNet}); the runtime wiring (capability
 * enforcement, recording, scheduling) lives in `./index.ts`.
 *
 * The file is consumed verbatim by `gridmason dev` (gridmason/cli) and by widget
 * unit tests, so its shape is a contract — documented in
 * [`docs/fixture-schema.md`](../../docs/fixture-schema.md).
 *
 * ## Matching semantics — subset match, most-specific-wins (the open question)
 *
 * The spec's Risks section flagged query-pattern matching as an open choice
 * between **glob** (match a serialized call string against a wildcard pattern)
 * and **subset** (match a partial example of the call object structurally). This
 * module picks **subset match**, for four reasons the schema doc expands on:
 *
 * 1. The call shapes are *structured objects* ({@link QuerySpec},
 *    {@link ScopedRequest}, {@link RecordRef}) — not opaque strings. A partial
 *    object that must be a structural subset of the actual call is the natural
 *    fit; glob would force serializing to a string, which is key-order- and
 *    whitespace-fragile.
 * 2. **Determinism** → "fixture-green predicts review-green": subset match has a
 *    well-defined specificity total order (count of constrained leaf values), so
 *    *which* fixture wins a call is stable and explainable; a `where`-constrained
 *    query beats a bare `recordType` one, ties break by declaration order.
 * 3. **No new syntax** for the `gridmason dev` loop: an author writes the shape
 *    of the call they expect, partially filled — nothing to learn or escape.
 * 4. **No accidental cross-matches**: a glob like `*sale*` could match an
 *    unintended record type or host; a structural subset cannot.
 *
 * Tradeoff (documented, not hidden): subset match cannot express "every path
 * under `/v2/`" — an author lists the paths, or omits `path` to match any path on
 * a host. If prefix/glob path matching is ever needed it can be added as an
 * explicit opt-in matcher without changing this subset default.
 */

import type {
  HttpMethod,
  QuerySpec,
  RecordData,
  RecordRef,
  ScopedRequest,
} from '../interface/index.js';
import type { PageContext } from '../protocol/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixture file schema (the JSON an author writes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A fixture file: plain JSON keyed by call shape (docs/SPEC.md §5). Every field
 * is optional — an empty `{}` is a valid file where every call falls through to
 * the no-op default. Consumed verbatim by `gridmason dev` and widget tests.
 */
export interface FixtureFile {
  /** Record reads and queries — see {@link RecordFixtures}. */
  readonly records?: RecordFixtures;
  /** Scoped-network responses, matched by host (and optionally path/method). */
  readonly net?: readonly NetFixture[];
  /** Scripted host-side emissions delivered to the widget's subscribers. */
  readonly events?: readonly ScriptedEvent[];
  /**
   * A page-context preset exposed as `sdk.context` (the runtime slot *values* a
   * mounted widget receives — a {@link PageContext}, protocol §3.2). An
   * `options.context` passed to `createFixtureSDK` overrides this.
   */
  readonly context?: PageContext;
}

/** The record side of a fixture file: reads keyed by ref, queries by pattern. */
export interface RecordFixtures {
  /**
   * Fixtures for `records.read(ref)`. Each is subset-matched against the
   * requested {@link RecordRef}: a `{ recordType, id }` pattern serves that exact
   * ref; omitting `id` serves any record of that type (a template). The returned
   * {@link RecordData} echoes the *requested* ref with the fixture's `fields`.
   */
  readonly read?: readonly ReadFixture[];
  /**
   * Fixtures for `records.query(spec)`. Each is subset-matched against the
   * {@link QuerySpec}: a `match` of `{ recordType }` serves any query of that
   * type; adding `where`/`limit` narrows it. Most-specific match wins.
   */
  readonly query?: readonly QueryFixture[];
}

/** A record's field bag — host-domain fields, values opaque to the SDK. */
export type RecordFields = { readonly [field: string]: unknown };

/** A partial {@link RecordRef} used as a read-fixture pattern (subset-matched). */
export interface RefPattern {
  /** Record kind to serve; omit to match any type. */
  readonly recordType?: string;
  /** Record id to serve; omit to serve any id of the matched type (template). */
  readonly id?: string;
}

/** A fixture for `records.read`: a ref pattern → the record's fields. */
export interface ReadFixture {
  /** The ref pattern this fixture serves (subset-matched against the call). */
  readonly ref: RefPattern;
  /** The fields the served {@link RecordData} carries. */
  readonly fields: RecordFields;
}

/** A partial {@link QuerySpec} used as a query-fixture pattern (subset-matched). */
export interface QueryPattern {
  /** The record type queried; the one field a useful pattern always sets. */
  readonly recordType?: string;
  /** Field predicates that must be a subset of the query's `where`. */
  readonly where?: { readonly [field: string]: unknown };
  /** The exact `limit` to match; omit to match regardless of limit. */
  readonly limit?: number;
}

/** A fixture for `records.query`: a query pattern → the record list to return. */
export interface QueryFixture {
  /** The query pattern this fixture serves. */
  readonly match: QueryPattern;
  /** The records returned when a query matches. */
  readonly result: readonly RecordData[];
}

/** A partial {@link ScopedRequest} used as a net-fixture pattern (subset-matched). */
export interface NetPattern {
  /** The remote host; the one field a useful pattern always sets. */
  readonly host: string;
  /** The request path to match; omit to match any path on the host. */
  readonly path?: string;
  /** The method to match; omit to match any method. */
  readonly method?: HttpMethod;
}

/** The response a matched {@link NetFixture} serves. */
export interface NetResponse {
  /** HTTP status; defaults to `200`. `ok` is derived as `status < 400`. */
  readonly status?: number;
  /**
   * Response body. A **string** is served verbatim — `text()` returns it and
   * `json()` parses it. Any **other JSON value** (object/array/number/boolean)
   * is served as JSON — `json()` returns it and `text()` returns its
   * `JSON.stringify`, so a JSON API fixture is just `body: { ... }`. Omitted →
   * the empty body (`text()` → `''`, `json()` → `undefined`).
   */
  readonly body?: unknown;
  /** Response headers, name → value. Default `{}`. */
  readonly headers?: { readonly [name: string]: string };
}

/** A fixture for `net.fetch`: a request pattern → the response to serve. */
export interface NetFixture {
  /** The request pattern this fixture serves. */
  readonly match: NetPattern;
  /** The response served on a match. */
  readonly response: NetResponse;
}

/** The `{ ns, name }` identity of a bus topic (the gated `events:<ns>` namespace). */
export interface TopicRef {
  /** Capability namespace gated as `events:<ns>`. */
  readonly ns: string;
  /** Topic name within the namespace. */
  readonly name: string;
}

/**
 * A scripted host-side emission: after `delay` ms the fixture delivers `payload`
 * to every subscriber of `topic` (matched by `ns` + `name`), simulating the host
 * or another widget publishing on the bus so a widget's `events.on` handlers run.
 * A widget with no capability for `topic.ns` never subscribed, so it never
 * receives one — enforcement holds without a second check.
 */
export interface ScriptedEvent {
  /** The topic the emission is published on. */
  readonly topic: TopicRef;
  /** The payload delivered to subscribers. */
  readonly payload: unknown;
  /** Delay before delivery, in ms. Defaults to `0` (next scheduler tick). */
  readonly delay?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Subset matcher
// ─────────────────────────────────────────────────────────────────────────────

/** A JSON-ish value the subset matcher compares. */
type Json = unknown;

/**
 * Structural **subset** predicate: `true` iff every leaf the `pattern` constrains
 * is present and deep-equal in `value` (extra keys in `value` are ignored — that
 * is the "subset"). Primitives compare by `Object.is`; arrays match only when
 * same-length and element-wise subset-matching (so array leaves are effectively
 * exact); objects recurse key-by-key. This is the one matching primitive all
 * three call kinds share.
 */
export function subsetMatches(pattern: Json, value: Json): boolean {
  if (pattern === value) return true;
  if (
    typeof pattern !== 'object' ||
    pattern === null ||
    typeof value !== 'object' ||
    value === null
  ) {
    return Object.is(pattern, value);
  }

  const patternIsArray = Array.isArray(pattern);
  const valueIsArray = Array.isArray(value);
  if (patternIsArray || valueIsArray) {
    if (!patternIsArray || !valueIsArray || pattern.length !== value.length) {
      return false;
    }
    return pattern.every((item, i) => subsetMatches(item, value[i]));
  }

  const pRec = pattern as { readonly [k: string]: Json };
  const vRec = value as { readonly [k: string]: Json };
  return Object.keys(pRec).every(
    (key) => key in vRec && subsetMatches(pRec[key], vRec[key]),
  );
}

/**
 * Specificity of a pattern = the number of constrained **leaf** (primitive)
 * values it carries. Higher wins when several fixtures match one call; ties are
 * broken by declaration order (the caller keeps the first). A `{ recordType,
 * where: { customer } }` pattern (2 leaves) outranks a bare `{ recordType }` (1).
 */
export function specificity(pattern: Json): number {
  if (typeof pattern !== 'object' || pattern === null) return 1;
  if (Array.isArray(pattern)) {
    return pattern.reduce<number>((n, item) => n + specificity(item), 0);
  }
  return Object.values(pattern as { readonly [k: string]: Json }).reduce<number>(
    (n, v) => n + specificity(v),
    0,
  );
}

/**
 * Pick the most specific fixture whose `patternOf(fixture)` subset-matches
 * `call`, breaking ties by declaration order (earliest wins). Returns `undefined`
 * when none match. The shared selection used by all three call kinds.
 */
export function pickMatch<F>(
  fixtures: readonly F[],
  patternOf: (fixture: F) => Json,
  call: Json,
): F | undefined {
  let best: F | undefined;
  let bestScore = -1;
  for (const fixture of fixtures) {
    const pattern = patternOf(fixture);
    if (!subsetMatches(pattern, call)) continue;
    const score = specificity(pattern);
    // Strict `>` keeps the earliest fixture on a tie (declaration order).
    if (score > bestScore) {
      best = fixture;
      bestScore = score;
    }
  }
  return best;
}

/** The most specific {@link ReadFixture} serving `ref`, or `undefined`. */
export function matchRead(
  fixtures: readonly ReadFixture[] | undefined,
  ref: RecordRef,
): ReadFixture | undefined {
  if (fixtures === undefined) return undefined;
  return pickMatch(fixtures, (f) => f.ref, ref);
}

/** The most specific {@link QueryFixture} serving `spec`, or `undefined`. */
export function matchQuery(
  fixtures: readonly QueryFixture[] | undefined,
  spec: QuerySpec,
): QueryFixture | undefined {
  if (fixtures === undefined) return undefined;
  return pickMatch(fixtures, (f) => f.match, spec);
}

/**
 * The most specific {@link NetFixture} serving `req`, or `undefined`. The request
 * is normalized so an omitted `method` matches a pattern that pins `GET` (the
 * handle's default), mirroring how a real host resolves the method.
 */
export function matchNet(
  fixtures: readonly NetFixture[] | undefined,
  req: ScopedRequest,
): NetFixture | undefined {
  if (fixtures === undefined) return undefined;
  const normalized = { host: req.host, path: req.path, method: req.method ?? 'GET' };
  return pickMatch(fixtures, (f) => f.match, normalized);
}
