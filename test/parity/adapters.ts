/**
 * Parity harness (issue #10, FR-5): the three widget-side adapters — React,
 * Vue, vanilla — reduced to **one** uniform observation API so the matrix
 * (`./parity.test.ts`) can run the same behavioral cases against each and assert
 * identical observable behavior. That matrix is the acceptance gate for the
 * Phase-B adapters sharing one core.
 *
 * Each adapter is driven in its **native** environment — React through
 * `renderHook` + `act`/`waitFor`, Vue inside an `effectScope`, vanilla by plain
 * calls — and its output is normalized to the same plain shapes ({@link ObservedRecord},
 * settings before/after, received payloads, response summary). Normalizing here is
 * what makes a cross-adapter `toEqual` meaningful: e.g. a denial's `PermissionDenied`
 * instance differs per handle (distinct `instanceId`), so a record observation
 * carries the realm-safe `denied` flag + the `capability` object, not the error
 * instance.
 *
 * This is a **test helper**, not a suite (no `*.test.*` name), so vitest imports
 * it without collecting it. The importing test file selects the `jsdom`
 * environment React's `renderHook` needs.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { effectScope } from 'vue';

import { isPermissionDenied } from '../../src/index.js';
import type {
  Capability,
  HostSDK,
  RecordData,
  RecordRef,
  ScopedRequest,
  TypedTopic,
  WidgetSettings,
} from '../../src/index.js';
import type { RecordStatus } from '../../src/helpers/index.js';
// The 1:1 wrappers are the shared core functions every adapter re-exports
// unchanged; using them here keeps the harness's emit/fetch identical across rows.
import { emit, scopedFetch } from '../../src/helpers/index.js';
import * as reactHelpers from '../../src/helpers/react/index.js';
import * as vueHelpers from '../../src/helpers/vue/index.js';
import * as vanillaHelpers from '../../src/helpers/vanilla/index.js';

/** The event payload the matrix emits/receives. */
export interface Ping {
  readonly id: string;
}

/** A record read reduced to its observable, cross-adapter-comparable state. */
export interface ObservedRecord {
  /** `idle` (no ref) | `pending` | `success` | `error`. */
  readonly status: RecordStatus;
  /** The record on success; `undefined` otherwise. */
  readonly data: RecordData | undefined;
  /** `true` iff the read rejected with a `PermissionDenied` (realm-safe check). */
  readonly denied: boolean;
  /** The denied capability, when `denied` — comparable across handles (the error instance is not). */
  readonly capability: Capability | undefined;
}

/** Settings observed immediately before and after a persisted patch. */
export interface ObservedSettings {
  readonly before: WidgetSettings;
  readonly after: WidgetSettings;
}

/** Events observed: what arrived while subscribed, and how many arrived after teardown. */
export interface ObservedEvents {
  readonly received: readonly Ping[];
  /** Deliveries after the subscription was torn down — expected `0` for every adapter. */
  readonly afterTeardown: number;
}

/** A scoped response reduced to its observable fields. */
export interface ObservedResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly json: unknown;
}

/**
 * One adapter under test, presented as four `observe*` operations that each drive
 * the adapter's real helpers and return a normalized observation. The matrix runs
 * every operation on every adapter and asserts the results match.
 */
export interface ParityAdapter {
  readonly name: 'react' | 'vue' | 'vanilla';
  observeRecord(sdk: HostSDK, ref: RecordRef | undefined): Promise<ObservedRecord>;
  observeSettings(sdk: HostSDK, patch: Partial<WidgetSettings>): Promise<ObservedSettings>;
  observeEvents(
    sdk: HostSDK,
    topic: TypedTopic<Ping>,
    payloads: readonly Ping[],
  ): Promise<ObservedEvents>;
  observeFetch(sdk: HostSDK, req: ScopedRequest): Promise<ObservedResponse>;
}

/** Normalize a record read's `(status, data, error)` triple into a comparable shape. */
function normalizeRecord(
  status: RecordStatus,
  data: RecordData | undefined,
  error: unknown,
): ObservedRecord {
  const denied = isPermissionDenied(error);
  return { status, data, denied, capability: denied ? error.capability : undefined };
}

/** Await until `pred` holds (settling a fixture read is a microtask), else throw. */
async function pollUntil(pred: () => boolean, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (pred()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (!pred()) throw new Error('pollUntil: condition not met within budget');
}

/** `scopedFetch` and `emit` are the shared core wrappers — identical for every adapter. */
async function observeFetch(sdk: HostSDK, req: ScopedRequest): Promise<ObservedResponse> {
  const res = await scopedFetch(sdk, req);
  return { status: res.status, ok: res.ok, json: await res.json() };
}

// ─────────────────────────────────────────────────────────────────────────────
// React — hooks driven through renderHook + act/waitFor
// ─────────────────────────────────────────────────────────────────────────────

export const reactAdapter: ParityAdapter = {
  name: 'react',
  async observeRecord(sdk, ref) {
    const { result, unmount } = renderHook(() => reactHelpers.useRecord(sdk, ref));
    await waitFor(() => {
      if (result.current.status === 'pending') throw new Error('still pending');
    });
    const observed = normalizeRecord(
      result.current.status,
      result.current.data,
      result.current.error,
    );
    unmount();
    return observed;
  },
  async observeSettings(sdk, patch) {
    const { result, unmount } = renderHook(() => reactHelpers.useSettings(sdk));
    const before = result.current[0];
    await act(async () => {
      await result.current[1](patch);
    });
    const after = result.current[0];
    unmount();
    return { before, after };
  },
  async observeEvents(sdk, topic, payloads) {
    const received: Ping[] = [];
    const { unmount } = renderHook(() =>
      reactHelpers.on(sdk, topic, (p) => received.push(p)),
    );
    for (const p of payloads) act(() => emit(sdk, topic, p));
    const captured = received.length;
    unmount(); // React releases the subscription on unmount.
    for (const p of payloads) emit(sdk, topic, p);
    return { received: [...received].slice(0, captured), afterTeardown: received.length - captured };
  },
  observeFetch,
};

// ─────────────────────────────────────────────────────────────────────────────
// Vue — composables driven inside an effectScope
// ─────────────────────────────────────────────────────────────────────────────

export const vueAdapter: ParityAdapter = {
  name: 'vue',
  async observeRecord(sdk, ref) {
    const scope = effectScope();
    const r = scope.run(() => vueHelpers.useRecord(sdk, ref));
    if (r === undefined) throw new Error('effectScope.run returned undefined');
    await pollUntil(() => r.status.value !== 'pending');
    const observed = normalizeRecord(r.status.value, r.data.value, r.error.value);
    scope.stop();
    return observed;
  },
  async observeSettings(sdk, patch) {
    const scope = effectScope();
    const pair = scope.run(() => vueHelpers.useSettings(sdk));
    if (pair === undefined) throw new Error('effectScope.run returned undefined');
    const [settings, set] = pair;
    const before = settings.value;
    await set(patch);
    const after = settings.value;
    scope.stop();
    return { before, after };
  },
  async observeEvents(sdk, topic, payloads) {
    const received: Ping[] = [];
    const scope = effectScope();
    scope.run(() => vueHelpers.on(sdk, topic, (p) => received.push(p)));
    for (const p of payloads) emit(sdk, topic, p);
    const captured = received.length;
    scope.stop(); // onScopeDispose releases the subscription.
    for (const p of payloads) emit(sdk, topic, p);
    return { received: [...received].slice(0, captured), afterTeardown: received.length - captured };
  },
  observeFetch,
};

// ─────────────────────────────────────────────────────────────────────────────
// Vanilla — plain calls, caller-managed teardown
// ─────────────────────────────────────────────────────────────────────────────

export const vanillaAdapter: ParityAdapter = {
  name: 'vanilla',
  async observeRecord(sdk, ref) {
    let snapshot = { status: 'idle' as RecordStatus, data: undefined as RecordData | undefined, error: undefined as unknown };
    const stop = vanillaHelpers.watchRecord(sdk, ref, (s) => {
      snapshot = { status: s.status, data: s.data, error: s.error };
    });
    await pollUntil(() => snapshot.status !== 'pending');
    stop();
    return normalizeRecord(snapshot.status, snapshot.data, snapshot.error);
  },
  async observeSettings(sdk, patch) {
    const binding = vanillaHelpers.bindSettings(sdk);
    const before = binding.get();
    await binding.update(patch);
    const after = binding.get();
    return { before, after };
  },
  async observeEvents(sdk, topic, payloads) {
    const received: Ping[] = [];
    const stop = vanillaHelpers.on(sdk, topic, (p) => received.push(p));
    for (const p of payloads) emit(sdk, topic, p);
    const captured = received.length;
    stop(); // Caller-managed unsubscribe.
    for (const p of payloads) emit(sdk, topic, p);
    return { received: [...received].slice(0, captured), afterTeardown: received.length - captured };
  },
  observeFetch,
};

/** The three adapters, in reference-first order (React is the reference, GW-D16). */
export const adapters: readonly ParityAdapter[] = [reactAdapter, vueAdapter, vanillaAdapter];
