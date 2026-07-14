/**
 * Vue widget-side helpers (docs/SPEC.md §4) — Vue 3 composables over the
 * framework-agnostic helper core (`../index.js`), mirroring the React reference
 * adapter (`../react`) 1:1. Published at `@gridmason/sdk/vue`.
 *
 * This adapter adds only Vue lifecycle glue over the shared
 * {@link import('../index.js').ReactiveSource} seam — a `shallowRef` bound to the
 * source's `getSnapshot`, refreshed by its `subscribe`, and torn down on
 * `onScopeDispose`. Every composable still bottoms out in a handle method, so a
 * widget stays auditable by reading its SDK calls; the adapter opens no data path
 * and adds no capability logic the core does not already have. Because the React
 * set is the reference (dashboard is React, GW-D16), these composables expose the
 * same surface — `useRecord`, `useSettings`, `emit`/`on`, `scopedFetch` — and, per
 * the parity matrix (`test/parity`), the same observable behavior.
 *
 * `vue` is an **optional peer** dependency: importing `@gridmason/sdk` alone never
 * pulls Vue in, and only a widget that imports this subpath needs it.
 *
 * ## Reactive shape (the idiom difference from React)
 *
 * React hooks return plain values re-read each render; Vue composables return
 * **refs** the template unwraps and re-renders from. So {@link useRecord} returns
 * {@link ComputedRef}s (`data`, `error`, `loading`, `status`) plus a plain
 * `refetch`, and {@link useSettings} returns a `[ComputedRef<WidgetSettings>, set]`
 * tuple — a read-only computed (no `.value` setter) so settings only ever change
 * through the persisting `set`, exactly as React's snapshot only advances through
 * its setter. The underlying read/cache/settings semantics are the core's,
 * unchanged.
 *
 * ## Lifecycle
 *
 * Each composable registers its teardown with {@link onScopeDispose}, so a
 * subscription is released when the owning component unmounts (or the enclosing
 * `effectScope` stops). Call them from `setup()` (or another composable) like any
 * Vue composable; called outside an effect scope the teardown cannot auto-run
 * (Vue emits its standard warning) — the host still releases every subscription on
 * unmount regardless (SPEC §3 rule 6).
 */

import { computed, onScopeDispose, shallowRef } from 'vue';
import type { ComputedRef } from 'vue';

import type {
  HostSDK,
  RecordData,
  RecordRef,
  ReadOptions,
  TypedTopic,
  WidgetSettings,
} from '../../interface/index.js';
import type { AttributedTelemetry, RecordStatus } from '../index.js';
import { attributeTelemetry, recordSource, releaseInstance, settingsSource, subscribe } from '../index.js';

// The framework-agnostic 1:1 wrappers and the attribution facade need no Vue glue;
// re-export them so a widget imports its whole helper set from `@gridmason/sdk/vue`.
// `releaseInstance` is re-exported for a widget that wants to release every
// subscription itself; `attributeTelemetry` for a widget that wants the facade
// outside `setup` (the `useTelemetry` composable is the in-`setup` form).
export { attributeTelemetry, emit, releaseInstance, scopedFetch } from '../index.js';
export type {
  AttributedError,
  AttributedMark,
  AttributedTelemetry,
  ReactiveSource,
  RecordSnapshot,
  RecordSource,
  RecordStatus,
  SettingsSource,
} from '../index.js';

/**
 * The result of {@link useRecord}: reactive {@link ComputedRef}s over the record
 * read state, plus `loading` (a convenience for `status === 'pending'`) and a
 * `refetch` that forces a fresh `sdk.records.read`, bypassing the cache. Mirrors
 * React's `UseRecordResult`, ref-wrapped for the Vue idiom.
 */
export interface UseRecordResult {
  /** The record once read; `undefined` while idle/pending or on error. */
  readonly data: ComputedRef<RecordData | undefined>;
  /** The rejection when `status === 'error'` (e.g. a `PermissionDenied`); else `undefined`. */
  readonly error: ComputedRef<unknown>;
  /** `true` while the underlying `sdk.records.read` is in flight. */
  readonly loading: ComputedRef<boolean>;
  /** The full read status — `idle` (no ref) | `pending` | `success` | `error`. */
  readonly status: ComputedRef<RecordStatus>;
  /** Force a fresh `sdk.records.read` for this ref, bypassing the cache. */
  readonly refetch: () => void;
}

/**
 * Read a record by ref, typed by its `recordType` (SPEC §4) — the Vue composable
 * form of React's `useRecord`. A 1:1 read through `sdk.records.read` behind the
 * shared cache: the first call for a ref issues exactly one read and every later
 * call/component for the same ref reuses it (`../index.js` documents the dedup).
 * Returns reactive {@link UseRecordResult} refs; there is no throwing/suspense
 * variant (a widget is mounted into a tree it does not control, so it renders its
 * own fallbacks from `loading`/`error`).
 *
 * Pass `ref` `undefined` (e.g. a page with no context record) for a stable `idle`
 * result — no read fires.
 *
 * ```vue
 * <script setup lang="ts">
 * const { data, loading, error } = useRecord(sdk, sdk.context.record);
 * </script>
 * <template>
 *   <Spinner v-if="loading" />
 *   <ErrorCard v-else-if="error" :err="error" />
 *   <Card v-else :fields="data?.fields" />
 * </template>
 * ```
 */
export function useRecord(
  sdk: HostSDK,
  ref: RecordRef | undefined,
  opts?: ReadOptions,
): UseRecordResult {
  const source = recordSource(sdk, ref, opts);
  const snapshot = shallowRef(source.getSnapshot());
  const stop = source.subscribe(() => {
    snapshot.value = source.getSnapshot();
  });
  onScopeDispose(stop);
  return {
    data: computed(() => snapshot.value.data),
    error: computed(() => snapshot.value.error),
    loading: computed(() => snapshot.value.status === 'pending'),
    status: computed(() => snapshot.value.status),
    refetch: () => source.refetch(),
  };
}

/**
 * Reactive per-instance settings with a persisting setter (SPEC §4) — the Vue
 * composable form of React's `useSettings`. Returns a `[settings, set]` tuple:
 * `settings` is a read-only {@link ComputedRef} (no `.value` setter, so settings
 * change only through `set`) that seeds from `sdk.settings.get()`, and `set(patch)`
 * forwards to `sdk.settings.update` and then advances the reactive snapshot. The
 * SDK interface has no host→widget settings push, so the value changes only through
 * `set` (`../index.js` documents the seam).
 *
 * ```vue
 * <script setup lang="ts">
 * const [settings, setSettings] = useSettings(sdk);
 * </script>
 * <template>
 *   <input :value="String(settings.title ?? '')"
 *          @input="(e) => setSettings({ title: (e.target as HTMLInputElement).value })" />
 * </template>
 * ```
 */
export function useSettings(
  sdk: HostSDK,
): readonly [ComputedRef<WidgetSettings>, (patch: Partial<WidgetSettings>) => Promise<void>] {
  const source = settingsSource(sdk);
  const snapshot = shallowRef(source.getSnapshot());
  const stop = source.subscribe(() => {
    snapshot.value = source.getSnapshot();
  });
  onScopeDispose(stop);
  const settings = computed(() => snapshot.value);
  const set = (patch: Partial<WidgetSettings>): Promise<void> => source.update(patch);
  return [settings, set];
}

/**
 * Subscribe to a typed event topic for the lifetime of the component (SPEC §4) —
 * the Vue composable form of React's `on`. A thin wrapper over `sdk.events.on`: it
 * subscribes when called (in `setup`) and releases the subscription on
 * {@link onScopeDispose}, so a widget never leaks one (the host also releases it on
 * unmount, SPEC §3 rule 6 — this is the belt-and-braces Vue side). Because a
 * composable's `setup` runs once, the `handler` closure is stable and no
 * re-subscription dance is needed (unlike React's per-render hook).
 *
 * ```ts
 * on(sdk, saleSelected, (sale) => (selectedId.value = sale.id));
 * ```
 */
export function on<T>(sdk: HostSDK, topic: TypedTopic<T>, handler: (payload: T) => void): void {
  const unsubscribe = subscribe(sdk, topic, handler);
  onScopeDispose(unsubscribe);
}

/**
 * Release every helper `events` subscription for `sdk` when the component's scope
 * disposes (SPEC §3 rule 6, widget side) — the Vue form of React's
 * {@link import('../react/index.js').useInstanceCleanup}. Each {@link on} already
 * releases its own subscription on `onScopeDispose`; this is the belt-and-braces
 * seam for a widget that also subscribes imperatively (via the core `subscribe`) or
 * wants one guaranteed teardown that leaves no subscriber behind. Call it from
 * `setup` (or another composable):
 *
 * ```ts
 * useInstanceCleanup(sdk); // frees every helper subscription on scope dispose
 * ```
 *
 * The host independently revokes the instance token on its side, so a stale call
 * still rejects a typed `InstanceGone`; this releases the widget-side bookkeeping.
 */
export function useInstanceCleanup(sdk: HostSDK): void {
  onScopeDispose(() => releaseInstance(sdk));
}

/**
 * The attributed telemetry surface for this mount (SPEC §3 telemetry/identity, §2
 * audit trail) — the Vue form of {@link import('../index.js').attributeTelemetry},
 * mirroring React's `useTelemetry`. Returns the {@link AttributedTelemetry} facade
 * whose `mark`/`error` stamp the handle's `instanceId` + `widgetId` before
 * forwarding to `sdk.telemetry`, and whose `time` measures an operation's latency
 * — so a widget author reports an error or times an operation without
 * hand-threading identity.
 *
 * The facade is stateless and stable per handle (the core caches it); there is no
 * subscription to release, so — unlike the reactive composables — it registers no
 * `onScopeDispose` teardown. Call it from `setup` (or another composable):
 *
 * ```ts
 * const telemetry = useTelemetry(sdk);
 * const rows = await telemetry.time('load', () => getRecord(sdk, ref));
 * ```
 */
export function useTelemetry(sdk: HostSDK): AttributedTelemetry {
  return attributeTelemetry(sdk);
}
