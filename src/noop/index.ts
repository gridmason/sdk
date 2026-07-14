/**
 * The no-op reference implementation (docs/SPEC.md §5): {@link createNoopSDK} —
 * a {@link HostSDK} handle where every method resolves to an empty/typed-default
 * value, every invocation is recorded for assertions, and **nothing is denied**.
 * It is the handle the dashboard's M1 static boot passes to widgets before a
 * registry exists, and the handle a widget unit test mounts against. Published at
 * `@gridmason/sdk/noop`.
 *
 * ## What "no-op" means here (and what it is not)
 *
 * The no-op is a dev/test convenience, **not** an enforcing host. It performs no
 * capability check: it never throws {@link PermissionDenied}, never binds a
 * remote identity, never mediates a real event bus. Its returns are honest
 * *empties* — `records.query` resolves to `[]`, `net.fetch` to an OK response
 * with an empty body — never data behind a permission. To make that impossible
 * to miss, every handle is branded: {@link isNoopSDK} is `true` for it and the
 * {@link NOOP_CONTROLS} symbol exposes its {@link NoopControls} (the dev label
 * and the {@link CallRecorder}). A conforming host is decided by the conformance
 * kit (S-E2); this handle would fail it by design, and the brand is how calling
 * code refuses to mistake one for the other.
 *
 * ## Recording
 *
 * Every method appends `{ method, args, seq }` to a per-handle
 * {@link CallRecorder} (issue #6 carves the recorder into `./recorder.ts` so the
 * fixture impl, issue #7, layers its matching on the same log). A test reaches it
 * via {@link getNoopControls}: `getNoopControls(sdk).recorder.callsTo('records.read')`.
 * `events.on` also records `events.unsubscribe` when the returned
 * {@link Unsubscribe} runs, so a test can assert a widget released a subscription.
 *
 * The typed-default fall-through lives in {@link buildNoopMembers}, which the
 * fixture impl reuses for its unmatched-call path.
 */

import type {
  HostSDK,
  JSONSchema,
  Notice,
  Patch,
  QuerySpec,
  ReadOptions,
  RecordData,
  RecordRef,
  RouteRef,
  ScopedRequest,
  ScopedResponse,
  TypedTopic,
  Unsubscribe,
  WidgetError,
  WidgetSettings,
} from '../interface/index.js';
import type { ContextMap, WidgetID } from '../protocol/index.js';

import type { CallRecorder, SdkMethod } from './recorder.js';
import { createCallRecorder } from './recorder.js';

export type {
  CallRecorder,
  RecordedCall,
  SdkMethod,
} from './recorder.js';
export { createCallRecorder } from './recorder.js';

/**
 * Symbol key under which every no-op handle carries its {@link NoopControls}.
 * Registered on the process-global symbol registry (`Symbol.for`) so the brand
 * survives a duplicated module copy the same way the error guards' string
 * discriminant does (interface/errors.ts) — {@link isNoopSDK} stays reliable when
 * a host bundles `@gridmason/sdk` separately from a widget.
 *
 * Prefer the {@link isNoopSDK} guard and {@link getNoopControls} accessor over
 * indexing this symbol directly.
 */
export const NOOP_CONTROLS: unique symbol = Symbol.for('@gridmason/sdk/noop.controls');

/**
 * The dev-only control surface hung off a no-op handle under {@link NOOP_CONTROLS}:
 * the brand flag, a human-readable label, and the {@link CallRecorder} that
 * captures every method invocation.
 */
export interface NoopControls {
  /**
   * Always `true`. Brands the handle as the dev/no-op implementation so it can
   * never be mistaken for an enforcing host (see module doc).
   */
  readonly isNoop: true;
  /** Human-readable dev label, surfaced in tooling/logs (default `gridmason-noop-sdk`). */
  readonly label: string;
  /** The per-handle recorder of every method invocation. */
  readonly recorder: CallRecorder<SdkMethod>;
}

/**
 * A {@link HostSDK} handle produced by {@link createNoopSDK}: the full host
 * contract plus the {@link NOOP_CONTROLS} brand carrying its {@link NoopControls}.
 */
export interface NoopSDK extends HostSDK {
  /** Dev/no-op control surface — see {@link NoopControls}. */
  readonly [NOOP_CONTROLS]: NoopControls;
}

/** Options for {@link createNoopSDK}. All optional; each has a dev-labeled default. */
export interface NoopSDKOptions {
  /**
   * The per-mount instance id (`identity.instanceId`). Defaults to a unique
   * `dev-noop-<n>` value so distinct handles read distinctly in a recording.
   */
  readonly instanceId?: string;
  /** The `(source, tag)` widget identity. Defaults to a `local` dev widget. */
  readonly widgetId?: WidgetID;
  /**
   * The page context exposed as `sdk.context`. Defaults to an empty
   * {@link ContextMap}; pass one to mount a widget against a specific context.
   */
  readonly context?: ContextMap;
  /**
   * The settings `settings.get()` returns. Defaults to empty. The no-op does not
   * persist `settings.update()` — it records and resolves; use the fixture impl
   * (issue #7) for a data-bearing round trip.
   */
  readonly settings?: WidgetSettings;
  /** The {@link NoopControls} label. Defaults to `gridmason-noop-sdk`. */
  readonly label?: string;
}

/** Falls back to a unique, clearly dev-labeled instance id when the caller omits one. */
let instanceCounter = 0;

/**
 * Build the branded {@link NoopControls} for one handle: a fresh recorder plus
 * the immutable brand fields.
 */
function createNoopControls(label: string): NoopControls {
  return Object.freeze({
    isNoop: true as const,
    label,
    recorder: createCallRecorder<SdkMethod>(),
  });
}

/**
 * Construct the {@link HostSDK} members backed by `recorder`. Factored out of
 * {@link createNoopSDK} so the fixture impl (issue #7) can reuse this exact
 * typed-default fall-through for its unmatched calls while sharing one recorder.
 *
 * Every member records its invocation, then returns the empty/typed-default:
 * `records.read`/`write` echo the ref with empty `fields`; `records.query` → `[]`;
 * `net.fetch` → an OK, empty-body {@link ScopedResponse}; `events.emit` is a
 * recorded no-op (the no-op does not deliver — the fixture impl adds scripted
 * emissions); `events.on` records and returns a working {@link Unsubscribe} that
 * records `events.unsubscribe` on first call and is idempotent thereafter.
 */
export function buildNoopMembers(
  recorder: CallRecorder<SdkMethod>,
  opts: {
    readonly context: ContextMap;
    readonly settings: WidgetSettings;
    readonly instanceId: string;
    readonly widgetId: WidgetID;
  },
): HostSDK {
  const records: HostSDK['records'] = Object.freeze({
    read(ref: RecordRef, readOpts?: ReadOptions): Promise<RecordData> {
      recorder.record('records.read', readOpts === undefined ? [ref] : [ref, readOpts]);
      return Promise.resolve({ ref, fields: {} });
    },
    query(spec: QuerySpec): Promise<RecordData[]> {
      recorder.record('records.query', [spec]);
      return Promise.resolve([]);
    },
    write(ref: RecordRef, patch: Patch): Promise<RecordData> {
      recorder.record('records.write', [ref, patch]);
      return Promise.resolve({ ref, fields: {} });
    },
  });

  const net: HostSDK['net'] = Object.freeze({
    fetch(req: ScopedRequest): Promise<ScopedResponse> {
      recorder.record('net.fetch', [req]);
      return Promise.resolve(emptyResponse());
    },
  });

  const events: HostSDK['events'] = Object.freeze({
    emit<T>(topic: TypedTopic<T>, payload: T): void {
      recorder.record('events.emit', [topic, payload]);
    },
    on<T>(topic: TypedTopic<T>, handler: (payload: T) => void): Unsubscribe {
      recorder.record('events.on', [topic, handler]);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        recorder.record('events.unsubscribe', [topic]);
      };
    },
  });

  const settings: HostSDK['settings'] = Object.freeze({
    get(): WidgetSettings {
      recorder.record('settings.get', []);
      return opts.settings;
    },
    update(patch: Partial<WidgetSettings>): Promise<void> {
      recorder.record('settings.update', [patch]);
      return Promise.resolve();
    },
    onSchema(schema: JSONSchema): void {
      recorder.record('settings.onSchema', [schema]);
    },
  });

  const nav: HostSDK['nav'] = Object.freeze({
    open(target: RouteRef): void {
      recorder.record('nav.open', [target]);
    },
    toast(msg: Notice): void {
      recorder.record('nav.toast', [msg]);
    },
  });

  const telemetry: HostSDK['telemetry'] = Object.freeze({
    error(e: WidgetError): void {
      recorder.record('telemetry.error', [e]);
    },
    mark(name: string, ms: number): void {
      recorder.record('telemetry.mark', [name, ms]);
    },
  });

  return {
    records,
    net,
    events,
    settings,
    nav,
    telemetry,
    context: opts.context,
    identity: Object.freeze({
      instanceId: opts.instanceId,
      widgetId: opts.widgetId,
    }),
  };
}

/** The empty, OK {@link ScopedResponse} `net.fetch` resolves to (no data, ever). */
function emptyResponse(): ScopedResponse {
  return {
    status: 200,
    ok: true,
    headers: {},
    json<T = unknown>(): Promise<T> {
      return Promise.resolve(undefined as T);
    },
    text(): Promise<string> {
      return Promise.resolve('');
    },
  };
}

/**
 * Create a no-op {@link HostSDK} handle (docs/SPEC.md §5): every method resolves
 * to an empty/typed-default, every call is recorded for assertions, and nothing
 * is denied. **Dev/test only** — it is not an enforcing host (see module doc).
 *
 * Reach the recording via {@link getNoopControls}:
 *
 * ```ts
 * const sdk = createNoopSDK();
 * await sdk.records.read({ recordType: 'customer', id: 'c1' });
 * const { recorder } = getNoopControls(sdk);
 * expect(recorder.last('records.read')?.args[0]).toEqual({ recordType: 'customer', id: 'c1' });
 * ```
 */
export function createNoopSDK(options: NoopSDKOptions = {}): NoopSDK {
  const controls = createNoopControls(options.label ?? 'gridmason-noop-sdk');
  const members = buildNoopMembers(controls.recorder, {
    context: options.context ?? {},
    settings: options.settings ?? {},
    instanceId: options.instanceId ?? `dev-noop-${++instanceCounter}`,
    widgetId: options.widgetId ?? { source: 'local', tag: 'noop-widget' },
  });

  return Object.freeze({
    ...members,
    [NOOP_CONTROLS]: controls,
  });
}

/**
 * Realm-safe brand guard: `true` iff `sdk` is a handle produced by
 * {@link createNoopSDK}. Matches the {@link NOOP_CONTROLS} symbol and its
 * `isNoop` flag, so a host can refuse to treat a dev handle as an enforcing one.
 */
export function isNoopSDK(sdk: unknown): sdk is NoopSDK {
  if (typeof sdk !== 'object' || sdk === null) return false;
  const controls = (sdk as { [NOOP_CONTROLS]?: unknown })[NOOP_CONTROLS];
  return (
    typeof controls === 'object' &&
    controls !== null &&
    (controls as { isNoop?: unknown }).isNoop === true
  );
}

/**
 * The {@link NoopControls} of a no-op handle — its dev label and
 * {@link CallRecorder}. The ergonomic accessor a widget test reaches the
 * recording through.
 */
export function getNoopControls(sdk: NoopSDK): NoopControls {
  return sdk[NOOP_CONTROLS];
}
