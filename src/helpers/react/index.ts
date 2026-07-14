/**
 * React widget-side helpers (docs/SPEC.md §4) — the **reference adapter** over the
 * framework-agnostic helper core (`../index.js`). The dashboard is React (GW-D16),
 * so this set is the one the Phase-B Vue and vanilla adapters (S-E2) mirror; it
 * adds React lifecycle glue (`useSyncExternalStore`, effect-managed subscriptions)
 * over the shared {@link import('../index.js').ReactiveSource} seam and nothing else
 * — every hook still bottoms out in a handle method, so a widget stays auditable by
 * reading its SDK calls. Published at `@gridmason/sdk/react`.
 *
 * `react` is a **peer** (and optional) dependency: importing `@gridmason/sdk` alone
 * never pulls React in, and only a widget that imports this subpath needs it.
 *
 * ## `useRecord` — the caching/suspense choice we ship, and why
 *
 * SPEC §4 asks for "caching/suspense glue". React 18+ offers two mainstream shapes
 * for that: a **suspense** hook that `throw`s the pending promise (returning the
 * record directly, requiring a `<Suspense>` + error boundary around the widget), or
 * a **state-object** hook returning `{ data, loading, error }` that renders its own
 * fallbacks. We ship the **state-object `useRecord` as the default**, because a
 * widget is mounted by the host into a tree it does not control (core owns the mount
 * point) and is **not guaranteed** to sit inside a `<Suspense>`/error boundary — a
 * throwing hook without one takes down the host subtree, whereas the state object
 * degrades to a local fallback. It is also the shape every mainstream data hook
 * (SWR, React Query) exposes by default, so it reads as expected.
 *
 * The core cache is nonetheless **suspense-ready**: it dedups the read into one
 * in-flight promise reachable via {@link import('../index.js').RecordSource.getPromise}.
 * {@link useRecordSuspense} is the thin opt-in built on that same promise — proof the
 * "suspense glue" is present — for widgets that *do* own a boundary. Both hooks share
 * one cache and one `sdk.records.read` per ref; neither adds privileged logic.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import type {
  HostSDK,
  RecordData,
  RecordRef,
  ReadOptions,
  ScopedRequest,
  ScopedResponse,
  TypedTopic,
  WidgetSettings,
} from '../../interface/index.js';
import type { RecordStatus } from '../index.js';
import { recordSource, releaseInstance, settingsSource, subscribe } from '../index.js';

// The framework-agnostic 1:1 wrappers need no React glue; re-export them so a
// widget imports its whole helper set from `@gridmason/sdk/react`. `releaseInstance`
// is re-exported for a widget that wants to release every subscription itself.
export { emit, releaseInstance, scopedFetch } from '../index.js';
export type {
  ReactiveSource,
  RecordSnapshot,
  RecordSource,
  RecordStatus,
  SettingsSource,
} from '../index.js';

/**
 * The result of {@link useRecord}: the record read state, plus `loading` (a
 * convenience for `status === 'pending'`) and a `refetch` that forces a fresh
 * `sdk.records.read`, bypassing the cache.
 */
export interface UseRecordResult {
  /** The record once read; `undefined` while idle/pending or on error. */
  readonly data: RecordData | undefined;
  /** The rejection when `status === 'error'` (e.g. a `PermissionDenied`); else `undefined`. */
  readonly error: unknown;
  /** `true` while the underlying `sdk.records.read` is in flight. */
  readonly loading: boolean;
  /** The full read status — `idle` (no ref) | `pending` | `success` | `error`. */
  readonly status: RecordStatus;
  /** Force a fresh `sdk.records.read` for this ref, bypassing the cache. */
  readonly refetch: () => void;
}

/**
 * Read a record by ref, typed by its `recordType` (SPEC §4). A 1:1 read through
 * `sdk.records.read` behind the shared cache: the first `useRecord` for a ref issues
 * exactly one read and every later render/hook for the same ref reuses it
 * (`../index.js` documents the dedup). Returns the non-throwing
 * {@link UseRecordResult} — see the module doc for why this is the default over a
 * suspense-throwing hook.
 *
 * Pass `ref` `undefined` (e.g. a page with no context record) for a stable `idle`
 * result — the hook is still called unconditionally, satisfying the rules of hooks.
 *
 * ```tsx
 * const { data, loading, error } = useRecord(sdk, sdk.context.record);
 * if (loading) return <Spinner />;
 * if (error) return <ErrorCard err={error} />;
 * return <Card fields={data?.fields} />;
 * ```
 */
export function useRecord(
  sdk: HostSDK,
  ref: RecordRef | undefined,
  opts?: ReadOptions,
): UseRecordResult {
  const source = recordSource(sdk, ref, opts);
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const refetch = useCallback(() => source.refetch(), [source]);
  return {
    data: snapshot.data,
    error: snapshot.error,
    loading: snapshot.status === 'pending',
    status: snapshot.status,
    refetch,
  };
}

/**
 * The suspense variant of {@link useRecord} for widgets that own a `<Suspense>` +
 * error boundary: it `throw`s the pending read promise (suspending) and re-`throw`s
 * a read rejection (for the error boundary), returning the {@link RecordData}
 * directly once resolved. Shares {@link useRecord}'s cache and its single
 * `sdk.records.read` per ref — it is the same read, surfaced the suspense way.
 *
 * `ref` must be defined here: suspense has no "idle" state for an absent record.
 * Guard an optional ref at the call site (render nothing, or use {@link useRecord})
 * rather than passing `undefined`.
 */
export function useRecordSuspense(sdk: HostSDK, ref: RecordRef, opts?: ReadOptions): RecordData {
  const source = recordSource(sdk, ref, opts);
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  if (snapshot.status === 'error') throw snapshot.error;
  if (snapshot.status === 'success' && snapshot.data !== undefined) return snapshot.data;
  // idle or pending: suspend on the in-flight read. A defined ref always has a
  // promise (only the no-ref idle source returns undefined, excluded above).
  const promise = source.getPromise();
  if (promise !== undefined) throw promise;
  // Defensive: unreachable for a defined ref; suspend indefinitely rather than
  // render an inconsistent state.
  throw new Promise<void>(() => {});
}

/**
 * Reactive per-instance settings with a persisting setter (SPEC §4). Returns the
 * current settings and a `set(patch)` that forwards to `sdk.settings.update` and
 * then advances the reactive snapshot, re-rendering subscribers. The snapshot seeds
 * from `sdk.settings.get()`; the SDK interface has no host→widget settings push, so
 * it changes only through this setter (`../index.js` documents the seam).
 *
 * ```tsx
 * const [settings, setSettings] = useSettings(sdk);
 * <input value={String(settings.title ?? '')}
 *        onChange={(e) => void setSettings({ title: e.target.value })} />
 * ```
 */
export function useSettings(
  sdk: HostSDK,
): readonly [WidgetSettings, (patch: Partial<WidgetSettings>) => Promise<void>] {
  const source = settingsSource(sdk);
  const settings = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const set = useCallback((patch: Partial<WidgetSettings>) => source.update(patch), [source]);
  return [settings, set];
}

/**
 * Subscribe to a typed event topic for the lifetime of the component (SPEC §4). A
 * thin, effect-managed wrapper over `sdk.events.on`: it subscribes on mount and
 * calls the returned {@link import('../../interface/index.js').Unsubscribe} on
 * unmount, so a widget never leaks a subscription (the host also releases it on
 * unmount, SPEC §3 rule 6 — this is the belt-and-braces React side).
 *
 * The latest `handler` is read through a ref, so passing a fresh closure each render
 * does **not** re-subscribe; the subscription is re-created only when the `sdk` or
 * the topic's `ns`/`name` change. `on` is a hook — obey the rules of hooks (call it
 * unconditionally at the top level).
 *
 * ```tsx
 * on(sdk, saleSelected, (sale) => setSelectedId(sale.id));
 * ```
 */
export function on<T>(sdk: HostSDK, topic: TypedTopic<T>, handler: (payload: T) => void): void {
  const handlerRef = useRef(handler);
  // Keep the ref current without re-subscribing (a new handler closure each render
  // must not tear down the subscription).
  useEffect(() => {
    handlerRef.current = handler;
  });
  useEffect(() => {
    const unsubscribe = subscribe(sdk, topic, (payload: T) => handlerRef.current(payload));
    return unsubscribe;
    // Re-subscribe only on identity change of the handle or the topic address, not
    // on every render (the topic object is often an inline literal).
  }, [sdk, topic.ns, topic.name]);
}

/**
 * Release every helper `events` subscription for `sdk` when the component unmounts
 * (SPEC §3 rule 6, widget side). Each {@link on} already releases its own
 * subscription on unmount; this is the belt-and-braces seam for a widget that also
 * subscribes imperatively (via the core `subscribe`) or wants one guaranteed
 * teardown that leaves no subscriber behind. Call it once, unconditionally, at the
 * top level of the widget's root component:
 *
 * ```tsx
 * function Widget({ sdk }: { sdk: HostSDK }) {
 *   useInstanceCleanup(sdk); // frees every helper subscription on unmount
 *   // …
 * }
 * ```
 *
 * The host independently revokes the instance token on its side, so a stale call
 * still rejects a typed `InstanceGone`; this releases the widget-side bookkeeping.
 */
export function useInstanceCleanup(sdk: HostSDK): void {
  useEffect(() => () => releaseInstance(sdk), [sdk]);
}

// Re-exported so a widget can name the request/response types alongside scopedFetch
// without a second import path.
export type { ScopedRequest, ScopedResponse };
