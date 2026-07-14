/**
 * Telemetry-attribution helpers (docs/SPEC.md §3 telemetry + identity, §2 audit
 * trail) — the widget-side seam that stamps *who emitted* onto every latency mark
 * and error report before it reaches the host, so a widget author never
 * hand-threads identity.
 *
 * `sdk.telemetry` is deliberately identity-free at the call site:
 * `mark(name, ms)` and `error(e)` say *what* happened, not *which mount*. The host
 * knows the mount because the handle is per-instance (SPEC §3 rule 5) — that
 * per-instance binding is what lets the host attribute error/latency per widget
 * (core §7). These helpers make that attribution **explicit and available
 * widget-side**: {@link attributeTelemetry} reads `sdk.identity` and produces an
 * {@link AttributedMark} / {@link AttributedError} — the audit-trail record whose
 * fields (`instanceId`, `widgetId`, mark `name`, `ms` / error payload) a host
 * dashboard aggregates per instance and per widget identity (docs/telemetry-attribution.md).
 *
 * This is the **audit-trail side** of the per-instance binding (SPEC §2), **not
 * security enforcement**: the identity stamped here is *read* from the handle,
 * never minted (SPEC §4, §2). A widget cannot forge another mount's identity
 * through these helpers because it can only ever read its own handle's
 * `identity` — the helpers add no privileged logic and open no path the handle
 * does not already expose.
 *
 * Like every other helper this bottoms out in a handle method: `mark` forwards to
 * `sdk.telemetry.mark`, `error` to `sdk.telemetry.error`. On a **revoked** handle
 * those forwards throw a typed `InstanceGone` (SPEC §3 rule 6, consistent with
 * #13) — the helper does not swallow it. It is framework-agnostic (the shared
 * core the `./react`, `./vue`, and `./vanilla` wrappers sit on) and depends on
 * `@gridmason/protocol` only, never on core (SPEC §7).
 */

import { isInstanceGone } from '../interface/index.js';
import type { HostSDK, WidgetError } from '../interface/index.js';
import type { WidgetID } from '../protocol/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Attributed audit-trail shapes (what a host receives)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A latency mark carrying the identity of the mount that emitted it — the
 * audit-trail record a host aggregates per instance and per widget (SPEC §2,
 * core §7). Returned by {@link AttributedTelemetry.mark}; its fields are the
 * documented mark shape (docs/telemetry-attribution.md).
 *
 * The bare `sdk.telemetry.mark(name, ms)` forward carries no identity on the wire
 * — the host binds it to this mount through the per-instance handle (SPEC §3
 * rule 5). This record is that same attribution made explicit widget-side: the
 * `(instanceId, widgetId)` a host reconstructs, alongside the `name`/`ms` it
 * received.
 */
export interface AttributedMark {
  /** The emitting mount's unique id (`sdk.identity.instanceId`). */
  readonly instanceId: string;
  /** The emitting mount's `(source, tag)` widget identity (`sdk.identity.widgetId`). */
  readonly widgetId: WidgetID;
  /** The mark name, exactly as passed to {@link AttributedTelemetry.mark}. */
  readonly name: string;
  /** The measured latency, in milliseconds. */
  readonly ms: number;
}

/**
 * A widget error carrying the identity of the mount that reported it — the
 * audit-trail record a host aggregates per instance and per widget (SPEC §2,
 * core §7). Returned by {@link AttributedTelemetry.error}.
 *
 * Unlike a mark, an error has an in-band slot for identity: the forwarded
 * {@link WidgetError} carries `instanceId` + `widgetId` in its `detail`, so an
 * error report stays self-describing even detached from the handle. This record
 * surfaces the same identity plus the stamped `error` for a caller that wants it
 * without re-reading `detail`.
 */
export interface AttributedError {
  /** The reporting mount's unique id (`sdk.identity.instanceId`). */
  readonly instanceId: string;
  /** The reporting mount's `(source, tag)` widget identity (`sdk.identity.widgetId`). */
  readonly widgetId: WidgetID;
  /**
   * The forwarded {@link WidgetError} — a copy of the caller's report with
   * `instanceId` + `widgetId` folded into `detail` (see
   * {@link AttributedTelemetry.error}).
   */
  readonly error: WidgetError;
}

// ─────────────────────────────────────────────────────────────────────────────
// The attributed-telemetry facade
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The attributed telemetry surface for one handle: `mark`/`error` forward to
 * `sdk.telemetry` with the handle's identity stamped, and {@link time} measures an
 * operation's latency so the author never computes `ms` by hand. Obtained from
 * {@link attributeTelemetry}; one stable instance per handle.
 */
export interface AttributedTelemetry {
  /**
   * Record a named latency measurement (SPEC §3) attributed to this mount. Reads
   * `sdk.identity`, forwards `sdk.telemetry.mark(name, ms)`, and returns the
   * {@link AttributedMark} audit-trail record. On a revoked handle the forward
   * throws a typed `InstanceGone` (#13), so this method throws too.
   */
  mark(name: string, ms: number): AttributedMark;
  /**
   * Report a widget error (SPEC §3) attributed to this mount. Reads
   * `sdk.identity`, folds `instanceId` + `widgetId` into a copy of `e.detail`
   * (attribution wins over any caller keys of the same name), forwards
   * `sdk.telemetry.error(stamped)`, and returns the {@link AttributedError}. On a
   * revoked handle the forward throws a typed `InstanceGone` (#13).
   */
  error(e: WidgetError): AttributedError;
  /**
   * Time `op` and record its latency as `name`, attributed to this mount — the
   * ergonomic form of `mark` that computes `ms` for you. Measures wall-clock from
   * just before `op()` until it returns (sync) or its promise settles (async),
   * then `mark(name, elapsed)`, and returns `op`'s result unchanged.
   *
   * Latency is marked whether `op` succeeds **or throws/rejects** (latency-to-
   * failure is telemetry too); the original error/rejection is re-thrown after the
   * mark. Because it ends in a `mark`, a revoked handle surfaces as `InstanceGone`
   * from the mark (#13) — for an async `op` that already settled, that rejects the
   * returned promise.
   */
  time<T>(name: string, op: () => T): T;
}

/**
 * Monotonic-ish millisecond clock: `performance.now()` where available (a
 * high-resolution, monotonic timer in browsers and Node ≥ 22), else `Date.now()`.
 */
function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** True for a thenable — the {@link AttributedTelemetry.time} async-path test. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function createAttributedTelemetry(sdk: HostSDK): AttributedTelemetry {
  function mark(name: string, ms: number): AttributedMark {
    // Read identity from the handle (never minted — SPEC §4, §2), then forward the
    // bare mark. The host attributes it to this mount via the per-instance handle
    // (rule 5); the returned record makes that attribution explicit. Ordering
    // matters: the forward is what throws InstanceGone on a revoked handle (#13).
    const { instanceId, widgetId } = sdk.identity;
    sdk.telemetry.mark(name, ms);
    return { instanceId, widgetId, name, ms };
  }

  function error(e: WidgetError): AttributedError {
    const { instanceId, widgetId } = sdk.identity;
    // Fold identity into a *copy* of detail so the forwarded report is
    // self-describing; attribution keys win over caller-supplied ones of the same
    // name (documented on AttributedTelemetry.error).
    const stamped: WidgetError = {
      ...e,
      detail: { ...e.detail, instanceId, widgetId },
    };
    sdk.telemetry.error(stamped);
    return { instanceId, widgetId, error: stamped };
  }

  // Record latency-to-failure for an `op` that already threw/rejected, without
  // ever letting the mark shadow the widget's original error (#45 batch review).
  // On a revoked handle the `mark` forward throws `InstanceGone` (#13); on the
  // happy path that surfaces (op succeeded), but here the widget already has a
  // real error, so the original must win. If the mark's InstanceGone is the only
  // signal that the handle died mid-op, attach it as `cause` rather than dropping
  // it — the original still propagates intact.
  function markFailureLatency(name: string, ms: number, original: unknown): void {
    try {
      mark(name, ms);
    } catch (markErr) {
      if (
        isInstanceGone(markErr) &&
        typeof original === 'object' &&
        original !== null &&
        (original as { cause?: unknown }).cause === undefined
      ) {
        try {
          (original as { cause?: unknown }).cause = markErr;
        } catch {
          // `original` is frozen/sealed: keep it as-is. Dropping the mark's
          // InstanceGone is fine — the widget's original error is what matters.
        }
      }
      // Any throw from the mark (InstanceGone or otherwise) is swallowed: the
      // latency side effect must never replace the op's outcome.
    }
  }

  function time<T>(name: string, op: () => T): T {
    const start = now();
    const elapsed = (): number => now() - start;
    let result: T;
    try {
      result = op();
    } catch (err) {
      // Synchronous throw: record latency-to-failure, then re-throw the original.
      markFailureLatency(name, elapsed(), err);
      throw err;
    }
    if (isThenable(result)) {
      return (result as PromiseLike<unknown>).then(
        (value) => {
          mark(name, elapsed());
          return value;
        },
        (err: unknown) => {
          markFailureLatency(name, elapsed(), err);
          throw err;
        },
      ) as T;
    }
    mark(name, elapsed());
    return result;
  }

  return Object.freeze({ mark, error, time });
}

/**
 * One attributed-telemetry facade per handle, so a reference to `attributeTelemetry(sdk)`
 * is referentially stable across calls/renders (React effect deps, a stored
 * reporter). Keyed on the `sdk` and collected with it — a `WeakMap`, matching the
 * per-handle store the rest of the helper core uses.
 */
const facades = new WeakMap<HostSDK, AttributedTelemetry>();

/**
 * The {@link AttributedTelemetry} for `sdk` — the framework-agnostic entry point
 * the `./react` and `./vue` `useTelemetry` wrappers and the vanilla surface bind
 * to. It stamps the handle's `identity` (SPEC §3 rule 5) onto every mark/error so
 * the host can attribute error and latency per widget instance and per widget
 * identity (SPEC §2 audit trail, core §7); it mints no identity and adds no
 * privileged logic (SPEC §4).
 *
 * The facade is stateless (it re-reads `sdk.identity` on each call, so it always
 * reflects the live handle) and cached per handle for a stable reference.
 *
 * ```ts
 * const telemetry = attributeTelemetry(sdk);
 * telemetry.mark('first-paint', 12);           // → { instanceId, widgetId, name, ms }
 * const rows = await telemetry.time('load', () => getRecord(sdk, ref));
 * telemetry.error({ message: 'render failed', name: 'RangeError' });
 * ```
 */
export function attributeTelemetry(sdk: HostSDK): AttributedTelemetry {
  let facade = facades.get(sdk);
  if (facade === undefined) {
    facade = createAttributedTelemetry(sdk);
    facades.set(sdk, facade);
  }
  return facade;
}
