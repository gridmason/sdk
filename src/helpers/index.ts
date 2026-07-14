/**
 * Framework-agnostic widget-side helper core (docs/SPEC.md §4).
 *
 * Thin ergonomics over the {@link HostSDK} handle — **no privileged logic**. Every
 * helper mirrors a handle method 1:1, so a widget stays auditable by reading its
 * SDK calls: a reviewer who sees `scopedFetch(sdk, { host })` knows it can reach
 * exactly `host` and nothing more, because `scopedFetch` *is* `sdk.net.fetch` with
 * a friendlier call site. The helpers add no capability logic and open no data
 * path the handle does not already expose.
 *
 * This module is the **shared core** the per-framework adapters sit on. It carries
 * zero framework imports (no React, no Vue) and exposes its reactive state through
 * adapter-shaped seams — a `subscribe`/`getSnapshot` pair per reactive source,
 * the exact shape React's `useSyncExternalStore`, a Vue `shallowRef` + watcher, or
 * a vanilla subscription each consume without change. The React adapter
 * (`./react`) is the reference (dashboard is React, GW-D16); the Phase-B Vue and
 * vanilla adapters (S-E2) reuse these same sources.
 *
 * ## What the core owns
 *
 * - **1:1 wrappers** — {@link scopedFetch}, {@link emit}, {@link subscribe}: plain
 *   functions that forward to `sdk.net.fetch` / `sdk.events.emit` / `sdk.events.on`
 *   with no added behavior. Framework-agnostic, so they are re-exported unchanged
 *   by every adapter.
 * - **Record cache + read-dedup** — {@link recordSource}: the caching plumbing
 *   `useRecord` sits on. See the cache-semantics note below.
 * - **Reactive settings** — {@link settingsSource}: a subscribable mirror of
 *   `sdk.settings.get()` whose setter persists through `sdk.settings.update`.
 *
 * ## Cache semantics (why a cache does not weaken the audit surface)
 *
 * {@link recordSource} caches by `(handle, recordType, id, fields)`: the first read
 * of a ref calls `sdk.records.read` **once**, and later renders/hooks reading the
 * same ref reuse that result instead of re-issuing the call. The cache is scoped to
 * the individual handle (a `WeakMap` keyed on the `sdk`), so two mounts never share
 * cached data and the cache is collected with the handle.
 *
 * This changes *how many* reads fire, never *which* capabilities are exercised:
 * every distinct ref still maps to exactly one `records.read`, gated by the host's
 * capability check exactly as an un-helped `sdk.records.read` would be. A denial is
 * still a rejected {@link import('../interface/index.js').PermissionDenied}; a cache
 * hit never manufactures data for a ref the handle never read. {@link RecordSource.refetch}
 * is the escape hatch that forces a fresh `sdk.records.read` for callers that need
 * to bypass the cache. The dedup is documented here so a reviewer accounts for it;
 * it is the only place a helper's call count differs from its render count.
 */

import type {
  HostSDK,
  RecordData,
  RecordRef,
  ReadOptions,
  ScopedRequest,
  ScopedResponse,
  TypedTopic,
  Unsubscribe,
  WidgetSettings,
} from '../interface/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1:1 handle wrappers (framework-agnostic, no added behavior)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Perform a scoped network request — a 1:1 wrapper over `sdk.net.fetch` (SPEC §4).
 * There is deliberately nothing here but the forward: `scopedFetch(sdk, req)` is
 * `sdk.net.fetch(req)`, so the reachable hosts (and therefore the `net:<host>`
 * capabilities exercised) are exactly what the {@link ScopedRequest} names — no raw
 * URL, no unscoped fetch (SPEC §2, §6).
 */
export function scopedFetch(sdk: HostSDK, req: ScopedRequest): Promise<ScopedResponse> {
  return sdk.net.fetch(req);
}

/**
 * Publish `payload` to `topic`'s subscribers — a 1:1 wrapper over
 * `sdk.events.emit` (SPEC §4). Gated by `events:<topic.ns>` in the host exactly as
 * a direct call would be.
 */
export function emit<T>(sdk: HostSDK, topic: TypedTopic<T>, payload: T): void {
  sdk.events.emit(topic, payload);
}

/**
 * Subscribe `handler` to `topic`; returns the {@link Unsubscribe} — a 1:1 wrapper
 * over `sdk.events.on` (SPEC §4). This is the framework-agnostic subscription
 * primitive the adapters build lifecycle management on (React's `on` runs it inside
 * an effect and calls the returned unsubscribe on unmount); a vanilla widget can
 * call it directly and unsubscribe itself. The host also releases the subscription
 * on unmount regardless (SPEC §3 rule 6).
 */
export function subscribe<T>(
  sdk: HostSDK,
  topic: TypedTopic<T>,
  handler: (payload: T) => void,
): Unsubscribe {
  return sdk.events.on(topic, handler);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reactive source seam (useSyncExternalStore-shaped)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A reactive value an adapter binds to its framework: `getSnapshot()` returns the
 * current value (a stable reference that only changes identity when the value
 * changes, so `useSyncExternalStore`'s `Object.is` comparison and Vue's
 * `triggerRef` both work), and `subscribe(listener)` registers a change callback
 * and returns an {@link Unsubscribe}. This is the one seam the per-framework
 * adapters consume; nothing framework-specific leaks into the core.
 *
 * @typeParam S - the snapshot value type.
 */
export interface ReactiveSource<S> {
  /** Register `listener`, called after every change; the returned fn detaches it. */
  subscribe(listener: () => void): Unsubscribe;
  /** The current value — referentially stable until it changes. */
  getSnapshot(): S;
}

/** How a {@link RecordSnapshot} was reached. */
export type RecordStatus = 'idle' | 'pending' | 'success' | 'error';

/**
 * The state of a record read at a point in time (the snapshot a {@link RecordSource}
 * exposes). Every key is always present so the object is a stable, `exactOptional`-safe
 * shape:
 *
 * - `idle` — no ref was given (e.g. a page with no context record); no read fired.
 * - `pending` — the `sdk.records.read` is in flight; `data`/`error` are `undefined`.
 * - `success` — `data` holds the record.
 * - `error` — `error` holds the rejection (typically a
 *   {@link import('../interface/index.js').PermissionDenied} when the capability was
 *   not granted).
 */
export interface RecordSnapshot {
  /** Which state this snapshot is in. */
  readonly status: RecordStatus;
  /** The record, once read; `undefined` until then. */
  readonly data: RecordData | undefined;
  /** The rejection, on `error`; `undefined` otherwise. */
  readonly error: unknown;
}

/**
 * A {@link ReactiveSource} of a single record read, plus a {@link RecordSource.getPromise}
 * accessor for suspense integration and a {@link RecordSource.refetch} escape hatch.
 * Obtained from {@link recordSource}; cached per `(handle, ref, fields)` so repeated
 * calls for the same ref return the same source (see the module's cache-semantics
 * note).
 */
export interface RecordSource extends ReactiveSource<RecordSnapshot> {
  /**
   * The in-flight-or-settled read promise, for a suspense adapter to `throw` while
   * pending. `undefined` in the `idle` state (no ref, so nothing to await).
   */
  getPromise(): Promise<RecordData> | undefined;
  /**
   * Force a fresh `sdk.records.read` for this ref, bypassing the cache, and drive
   * the source back through `pending → success | error`. A no-op in the `idle`
   * state. This is the documented way to re-issue a read the cache would otherwise
   * dedup.
   */
  refetch(): void;
}

/**
 * A {@link ReactiveSource} of the handle's settings, whose {@link SettingsSource.update}
 * persists a patch through `sdk.settings.update` and then advances the snapshot.
 * Obtained from {@link settingsSource}; one per handle.
 */
export interface SettingsSource extends ReactiveSource<WidgetSettings> {
  /**
   * Persist `patch` through `sdk.settings.update` (a 1:1 forward), then merge it
   * into the reactive snapshot and notify subscribers. Resolves when the underlying
   * update resolves; rejects (leaving the snapshot unchanged) if it rejects.
   */
  update(patch: Partial<WidgetSettings>): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Record cache
// ─────────────────────────────────────────────────────────────────────────────

/** A stable cache key for a record read: recordType, id, and the projected fields. */
function recordKey(ref: RecordRef, opts: ReadOptions | undefined): string {
  const fields = opts?.fields;
  // Sort the projection so field order does not fork the cache (the host returns the
  // same fields regardless of the array's order).
  const projection = fields === undefined ? '' : [...fields].sort().join(',');
  return `${ref.recordType} ${ref.id} ${projection}`;
}

const IDLE_SNAPSHOT: RecordSnapshot = Object.freeze({
  status: 'idle',
  data: undefined,
  error: undefined,
});

/** The source returned for `recordSource(sdk, undefined)` — no read, permanently idle. */
const IDLE_RECORD_SOURCE: RecordSource = Object.freeze({
  subscribe() {
    return () => {};
  },
  getSnapshot() {
    return IDLE_SNAPSHOT;
  },
  getPromise() {
    return undefined;
  },
  refetch() {
    // No ref, nothing to read.
  },
});

/** A live record-cache entry: its current snapshot, the read promise, and listeners. */
interface RecordEntry {
  snapshot: RecordSnapshot;
  promise: Promise<RecordData> | undefined;
  readonly listeners: Set<() => void>;
  source: RecordSource;
}

/** The per-handle record cache: one entry per distinct `(ref, fields)` key. */
interface RecordCache {
  source(sdk: HostSDK, ref: RecordRef | undefined, opts: ReadOptions | undefined): RecordSource;
}

function createRecordCache(): RecordCache {
  const entries = new Map<string, RecordEntry>();

  function source(
    sdk: HostSDK,
    ref: RecordRef | undefined,
    opts: ReadOptions | undefined,
  ): RecordSource {
    if (ref === undefined) return IDLE_RECORD_SOURCE;
    // Bind the narrowed ref to a const so it stays `RecordRef` (not `| undefined`)
    // inside the read closure below.
    const readRef: RecordRef = ref;

    const key = recordKey(ref, opts);
    const existing = entries.get(key);
    if (existing !== undefined) return existing.source;

    const entry: RecordEntry = {
      snapshot: IDLE_SNAPSHOT, // replaced synchronously by the initial startRead below
      promise: undefined,
      listeners: new Set(),
      // Assigned immediately below; the cast avoids a nullable field for a value
      // that is always set before `source()` returns.
      source: undefined as unknown as RecordSource,
    };

    function set(next: RecordSnapshot): void {
      entry.snapshot = next;
      for (const listener of entry.listeners) listener();
    }

    function startRead(): void {
      set({ status: 'pending', data: undefined, error: undefined });
      // Read once through the handle; the capability check runs host-side exactly
      // as for a direct sdk.records.read. Guard against a later refetch superseding
      // this read by comparing the stored promise identity on resolution.
      const p = sdk.records.read(readRef, opts);
      entry.promise = p;
      void p.then(
        (data) => {
          if (entry.promise === p) set({ status: 'success', data, error: undefined });
        },
        (error: unknown) => {
          if (entry.promise === p) set({ status: 'error', data: undefined, error });
        },
      );
    }

    entry.source = {
      subscribe(listener) {
        entry.listeners.add(listener);
        return () => {
          entry.listeners.delete(listener);
        };
      },
      getSnapshot() {
        return entry.snapshot;
      },
      getPromise() {
        return entry.promise;
      },
      refetch() {
        startRead();
      },
    };

    entries.set(key, entry);
    startRead();
    return entry.source;
  }

  return { source };
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings store
// ─────────────────────────────────────────────────────────────────────────────

function createSettingsSource(sdk: HostSDK): SettingsSource {
  // Seed once from the handle; the SDK interface exposes no host→widget settings
  // push, so the snapshot advances only through update() (documented on SettingsSource).
  let snapshot: WidgetSettings = sdk.settings.get();
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    update(patch) {
      return sdk.settings.update(patch).then(() => {
        snapshot = { ...snapshot, ...patch };
        notify();
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-handle store (WeakMap keyed on the sdk handle — collected with the mount)
// ─────────────────────────────────────────────────────────────────────────────

interface HelperStore {
  readonly records: RecordCache;
  settings: SettingsSource | undefined;
}

const stores = new WeakMap<HostSDK, HelperStore>();

function storeFor(sdk: HostSDK): HelperStore {
  let store = stores.get(sdk);
  if (store === undefined) {
    store = { records: createRecordCache(), settings: undefined };
    stores.set(sdk, store);
  }
  return store;
}

/**
 * The cached {@link RecordSource} for reading `ref` off `sdk` — the caching seam
 * `useRecord` (and the Phase-B Vue/vanilla equivalents) bind to. Passing `ref`
 * `undefined` returns a permanently idle source (the no-context-record case), so a
 * hook can call this unconditionally. See the module's cache-semantics note for the
 * read-dedup guarantee.
 */
export function recordSource(
  sdk: HostSDK,
  ref: RecordRef | undefined,
  opts?: ReadOptions,
): RecordSource {
  return storeFor(sdk).records.source(sdk, ref, opts);
}

/**
 * The {@link SettingsSource} for `sdk` — the reactive-settings seam `useSettings`
 * binds to, one per handle. Its snapshot seeds from `sdk.settings.get()` and
 * advances when {@link SettingsSource.update} persists a patch.
 */
export function settingsSource(sdk: HostSDK): SettingsSource {
  const store = storeFor(sdk);
  if (store.settings === undefined) store.settings = createSettingsSource(sdk);
  return store.settings;
}
