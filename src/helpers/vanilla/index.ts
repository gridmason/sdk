/**
 * Vanilla widget-side helpers (docs/SPEC.md §4) — plain functions over the
 * framework-agnostic helper core (`../index.js`), for widgets built without a
 * framework, mirroring the React reference adapter (`../react`) 1:1. Published at
 * `@gridmason/sdk/vanilla`.
 *
 * A vanilla widget can always call the handle directly (helpers are optional, SPEC
 * §4); this adapter exists so the common cases read as one line and share the same
 * cache/dedup as the React and Vue adapters. It is the **non-hook** form of the
 * same surface: where React has the `useRecord` hook and Vue the `useRecord`
 * composable, vanilla has a one-shot {@link getRecord} promise and a subscribe-style
 * {@link watchRecord}; where React/Vue return a reactive `[settings, set]`, vanilla
 * returns an imperative {@link bindSettings} binding. Every function still bottoms
 * out in a handle method — no privileged logic, no behavioral divergence (the
 * parity matrix in `test/parity` is the gate).
 *
 * Nothing here has a framework dependency, so this subpath imports no peer at all.
 *
 * ## Lifecycle is the caller's (the idiom difference from React/Vue)
 *
 * React and Vue release subscriptions automatically on unmount/scope-dispose.
 * Vanilla has no component lifecycle, so {@link watchRecord}, `bindSettings().watch`,
 * and {@link on} return an {@link Unsubscribe} the caller invokes itself. (The host
 * also releases every `events` subscription on unmount regardless, SPEC §3 rule 6 —
 * so a leaked `on` is bounded, but a well-behaved widget still unsubscribes.)
 *
 * For a single teardown that releases *every* subscription the widget opened
 * through the helpers at once, call the re-exported `releaseInstance(sdk)` when the
 * widget is removed — the vanilla equivalent of React/Vue's `useInstanceCleanup`.
 */

import type {
  HostSDK,
  RecordData,
  RecordRef,
  ReadOptions,
  Unsubscribe,
  WidgetSettings,
} from '../../interface/index.js';
import type { RecordSnapshot } from '../index.js';
import { recordSource, settingsSource } from '../index.js';

// The framework-agnostic 1:1 wrappers are already plain functions; re-export them
// so a widget imports its whole helper set from `@gridmason/sdk/vanilla`. `subscribe`
// is re-exported as `on` — the vanilla event helper *is* the caller-managed
// subscription, returning the Unsubscribe (no lifecycle wrapper to add).
// `releaseInstance` is the one-call teardown a vanilla widget runs when it is
// removed, to release every subscription it opened through the helpers at once
// (SPEC §3 rule 6, widget side — see the lifecycle note below).
export { emit, releaseInstance, scopedFetch, subscribe as on } from '../index.js';
export type {
  ReactiveSource,
  RecordSnapshot,
  RecordSource,
  RecordStatus,
  SettingsSource,
} from '../index.js';

/**
 * Read a record by ref, once (SPEC §4) — the imperative, one-shot form of React's
 * `useRecord`. Returns the record-read promise behind the shared cache: a 1:1
 * `sdk.records.read` deduped per `(handle, ref, fields)`, so calling it twice for
 * the same ref awaits one read (`../index.js` documents the dedup) and rejects with
 * the same `PermissionDenied` a direct call would when the capability is not
 * granted. For the reactive/subscribe form (and the no-ref idle case), use
 * {@link watchRecord}.
 *
 * ```ts
 * try {
 *   const record = await getRecord(sdk, sdk.context.record);
 *   render(record.fields);
 * } catch (err) {
 *   renderError(err); // e.g. a PermissionDenied
 * }
 * ```
 */
export function getRecord(
  sdk: HostSDK,
  ref: RecordRef,
  opts?: ReadOptions,
): Promise<RecordData> {
  const promise = recordSource(sdk, ref, opts).getPromise();
  // A defined ref always has an in-flight-or-settled read (only the no-ref idle
  // source returns undefined), so this is the record-read promise — 1:1 over
  // sdk.records.read behind the shared cache.
  return promise ?? Promise.reject(new Error('gridmason: getRecord requires a record ref'));
}

/**
 * Watch a record read (SPEC §4) — the subscribe-style form of React's `useRecord`
 * for a vanilla widget that re-renders on change. Calls `listener` immediately with
 * the current {@link RecordSnapshot} (so a caller sees `pending`, then `success` or
 * `error`) and again on every change, and returns an {@link Unsubscribe} the caller
 * invokes to stop. Shares {@link getRecord}'s cache and its single `sdk.records.read`
 * per ref. Pass `ref` `undefined` (no context record) for a permanently `idle`
 * source that fires no read.
 *
 * ```ts
 * const stop = watchRecord(sdk, sdk.context.record, (snap) => {
 *   if (snap.status === 'pending') showSpinner();
 *   else if (snap.status === 'error') showError(snap.error);
 *   else render(snap.data?.fields);
 * });
 * // later: stop();
 * ```
 */
export function watchRecord(
  sdk: HostSDK,
  ref: RecordRef | undefined,
  listener: (snapshot: RecordSnapshot) => void,
  opts?: ReadOptions,
): Unsubscribe {
  const source = recordSource(sdk, ref, opts);
  listener(source.getSnapshot());
  return source.subscribe(() => listener(source.getSnapshot()));
}

/**
 * An imperative settings binding (SPEC §4) — the vanilla form of React's
 * `useSettings`. `get()` returns the current settings (seeded 1:1 from
 * `sdk.settings.get()`), `update(patch)` persists through `sdk.settings.update` and
 * then advances the snapshot, and `watch(listener)` calls `listener` immediately
 * with the current value and again on every change, returning an {@link Unsubscribe}.
 * All three share one per-handle settings source with the React/Vue adapters.
 */
export interface SettingsBinding {
  /** The current saved settings for this instance (1:1 over `sdk.settings.get()`). */
  get(): WidgetSettings;
  /** Persist `patch` through `sdk.settings.update`, then advance the snapshot. */
  update(patch: Partial<WidgetSettings>): Promise<void>;
  /**
   * Call `listener` immediately with the current settings and again on every change;
   * returns an {@link Unsubscribe} the caller invokes to stop.
   */
  watch(listener: (settings: WidgetSettings) => void): Unsubscribe;
}

/**
 * Bind this handle's settings (SPEC §4) — see {@link SettingsBinding}. The binding
 * is a thin object over the shared per-handle settings source; it adds no state of
 * its own, so two bindings for the same handle observe the same value.
 *
 * ```ts
 * const settings = bindSettings(sdk);
 * const stop = settings.watch((s) => renderLabel(s.label));
 * await settings.update({ label: 'renamed' });
 * // later: stop();
 * ```
 */
export function bindSettings(sdk: HostSDK): SettingsBinding {
  const source = settingsSource(sdk);
  return {
    get: () => source.getSnapshot(),
    update: (patch) => source.update(patch),
    watch(listener) {
      listener(source.getSnapshot());
      return source.subscribe(() => listener(source.getSnapshot()));
    },
  };
}
