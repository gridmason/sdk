/**
 * The fixture reference implementation (docs/SPEC.md §5, FR-4): {@link createFixtureSDK} —
 * the no-op handle backed by an author-supplied fixture map, so a widget under
 * development receives *realistic data* instead of empty defaults, while the
 * capability check still runs so **fixture-green predicts review-green**.
 * Consumed by `gridmason dev` (gridmason/cli) and by widget unit tests that need
 * data-bearing cases. Published at `@gridmason/sdk/fixture`.
 *
 * ## What it adds over the no-op (issue #6)
 *
 * It is layered *on* the no-op core — it reuses {@link buildNoopMembers} for the
 * ungated members (`nav`, `telemetry`, `context`, `identity`) and the one shared
 * {@link CallRecorder}, so there is a single inspection surface, not a second
 * recording harness. On top it adds four behaviors:
 *
 * 1. **Fixture data.** `records.read`/`query` and `net.fetch` consult the fixture
 *    map first (subset match, `./schema.ts`); a hit returns the fixture's data,
 *    a miss falls through to the no-op typed-default.
 * 2. **Per-call flagging.** Every gated call is recorded with a {@link FixtureCallMeta}
 *    tag — `fixture-hit` | `default-empty` | `denied` | `allowed` — so the CLI's
 *    SDK inspector (cli §4) shows which calls were backed by fixtures.
 * 3. **Capability enforcement.** A gated call for a capability the widget did not
 *    declare is denied with a typed {@link PermissionDenied}, **never** satisfied
 *    by fixture data (`./capabilities.ts`, SPEC §5/§6).
 * 4. **A real event bus + scripted emissions.** `events.emit`/`on` deliver in a
 *    same-document in-memory bus, and the fixture's scripted `events` fire to
 *    subscribers on their declared delays via an injectable {@link FixtureScheduler}
 *    (default `setTimeout`; tests use {@link createManualScheduler} for
 *    determinism). `settings.update` is data-bearing here (a round trip the
 *    no-op deliberately lacks).
 *
 * The handle is branded {@link FIXTURE_CONTROLS} — {@link isFixtureSDK} is `true`
 * and {@link getFixtureControls} exposes the recorder — so, like the no-op, it can
 * never be mistaken for a conforming host (it enforces capabilities but binds no
 * remote identity and mediates no real transport).
 */

import { PermissionDenied } from '../interface/index.js';
import type {
  HostSDK,
  JSONSchema,
  Patch,
  QuerySpec,
  ReadOptions,
  RecordData,
  RecordRef,
  ScopedRequest,
  ScopedResponse,
  TypedTopic,
  Unsubscribe,
  WidgetSettings,
} from '../interface/index.js';
import type { Capability, ContextMap, WidgetID } from '../protocol/index.js';
import { buildNoopMembers, createCallRecorder } from '../noop/index.js';
import type { CallRecorder, SdkMethod } from '../noop/index.js';

import {
  eventsCapability,
  isGranted,
  netCapability,
  normalizeCapabilities,
  readCapability,
  toCapability,
  writeCapability,
} from './capabilities.js';
import type { NormalizedCapability, RequiredCapability } from './capabilities.js';
import { matchNet, matchQuery, matchRead } from './schema.js';
import type { FixtureFile, NetResponse } from './schema.js';

export type {
  FixtureFile,
  NetFixture,
  NetPattern,
  NetResponse,
  QueryFixture,
  QueryPattern,
  ReadFixture,
  RecordFields,
  RecordFixtures,
  RefPattern,
  ScriptedEvent,
  TopicRef,
} from './schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// Per-call outcome flag (what the CLI SDK inspector renders)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How a gated call resolved against the fixture map and capability check:
 *
 * - `fixture-hit` — a fixture matched; the call returned fixture data.
 * - `default-empty` — allowed, but no fixture matched; the no-op typed-default
 *   was returned.
 * - `denied` — the capability check failed; a {@link PermissionDenied} was
 *   thrown/rejected and no data (fixture or default) was produced.
 * - `allowed` — a gated call with no fixture concept (an `events` emit/subscribe)
 *   passed its capability check.
 */
export type FixtureOutcome = 'fixture-hit' | 'default-empty' | 'denied' | 'allowed';

/**
 * The {@link RecordedCall.meta} tag the fixture attaches to every gated call, so
 * the CLI's SDK inspector (cli §4) can classify it. Read it off a recording via
 * `getFixtureControls(sdk).recorder`.
 */
export interface FixtureCallMeta {
  /** How the call resolved. */
  readonly outcome: FixtureOutcome;
  /** For a `denied` outcome, the required-but-ungranted capability. */
  readonly capability?: Capability;
}

const META_HIT: FixtureCallMeta = { outcome: 'fixture-hit' };
const META_EMPTY: FixtureCallMeta = { outcome: 'default-empty' };
const META_ALLOWED: FixtureCallMeta = { outcome: 'allowed' };

function metaDenied(required: RequiredCapability): FixtureCallMeta {
  return { outcome: 'denied', capability: toCapability(required) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler (scripted events; injectable for deterministic tests)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How the fixture schedules its scripted `events` emissions. The default uses
 * `setTimeout`; a test injects a {@link ManualScheduler} (via
 * {@link createManualScheduler}) to fire emissions deterministically without
 * global fake timers.
 */
export interface FixtureScheduler {
  /** Run `fn` after `delayMs` milliseconds. */
  schedule(fn: () => void, delayMs: number): void;
}

/**
 * A {@link FixtureScheduler} whose emissions fire only when the test advances it,
 * so scripted-event tests are deterministic. `tick(ms)` fires everything whose
 * cumulative delay has elapsed (in delay order); `flush()` fires all pending
 * regardless of delay.
 */
export interface ManualScheduler extends FixtureScheduler {
  /** Advance virtual time by `ms` and fire every callback now due, in delay order. */
  tick(ms: number): void;
  /** Fire every pending callback immediately, regardless of delay. */
  flush(): void;
  /** Count of callbacks not yet fired. */
  readonly pending: number;
}

/** The production scheduler: plain `setTimeout`. */
const defaultScheduler: FixtureScheduler = {
  schedule(fn, delayMs) {
    setTimeout(fn, delayMs);
  },
};

/**
 * Create a {@link ManualScheduler} for deterministic scripted-event tests. Nothing
 * fires until `tick`/`flush` is called, so a test can subscribe first, then drive
 * emissions:
 *
 * ```ts
 * const scheduler = createManualScheduler();
 * const sdk = createFixtureSDK({ events: [{ topic, payload, delay: 100 }] },
 *   { capabilities: ['events:acme.sales'], scheduler });
 * sdk.events.on(topic, handler);
 * scheduler.tick(100); // handler runs now, deterministically
 * ```
 */
export function createManualScheduler(): ManualScheduler {
  const queue: { fn: () => void; at: number }[] = [];
  let now = 0;

  return {
    schedule(fn, delayMs) {
      queue.push({ fn, at: now + Math.max(0, delayMs) });
    },
    tick(ms) {
      now += ms;
      // Fire every due callback in ascending scheduled-time order. Re-scan each
      // iteration because a fired callback may schedule more.
      for (;;) {
        let earliest: { fn: () => void; at: number } | undefined;
        for (const entry of queue) {
          if (entry.at <= now && (earliest === undefined || entry.at < earliest.at)) {
            earliest = entry;
          }
        }
        if (earliest === undefined) break;
        queue.splice(queue.indexOf(earliest), 1);
        earliest.fn();
      }
    },
    flush() {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next !== undefined) next.fn();
      }
    },
    get pending() {
      return queue.length;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Brand + controls (mirrors the no-op brand)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Symbol key under which every fixture handle carries its {@link FixtureControls}.
 * On the global symbol registry (`Symbol.for`) so {@link isFixtureSDK} survives a
 * duplicated module copy, exactly like the no-op brand.
 */
export const FIXTURE_CONTROLS: unique symbol = Symbol.for('@gridmason/sdk/fixture.controls');

/**
 * The dev control surface hung off a fixture handle under {@link FIXTURE_CONTROLS}:
 * the brand flag, a label, the shared {@link CallRecorder} (its calls carry
 * {@link FixtureCallMeta}), and the {@link FixtureFile} in force.
 */
export interface FixtureControls {
  /** Always `true`. Brands the handle as the dev/fixture implementation. */
  readonly isFixture: true;
  /** Human-readable dev label (default `gridmason-fixture-sdk`). */
  readonly label: string;
  /** The per-handle recorder; each gated call's `meta` is a {@link FixtureCallMeta}. */
  readonly recorder: CallRecorder<SdkMethod>;
  /** The fixture map this handle serves. */
  readonly fixtures: FixtureFile;
}

/**
 * A {@link HostSDK} handle produced by {@link createFixtureSDK}: the host contract
 * plus the {@link FIXTURE_CONTROLS} brand.
 */
export interface FixtureSDK extends HostSDK {
  /** Dev/fixture control surface — see {@link FixtureControls}. */
  readonly [FIXTURE_CONTROLS]: FixtureControls;
}

/** Options for {@link createFixtureSDK}. All optional; each has a dev default. */
export interface FixtureSDKOptions {
  /**
   * The widget's declared capabilities (the manifest `capabilities` subset).
   * Object form ({@link Capability}) or string form
   * (`'records.read:recordType:customer'`) — both accepted, invalid entries throw
   * at construction. **Defaults to `[]`**, so a fixture with no declared
   * capabilities denies every gated call (the correct default: a widget declaring
   * nothing can read nothing). Enforcement is the point — a fixture never grants
   * a capability the widget did not declare (SPEC §5).
   */
  readonly capabilities?: ReadonlyArray<Capability | string>;
  /** The per-mount instance id. Defaults to a unique `dev-fixture-<n>`. */
  readonly instanceId?: string;
  /** The `(source, tag)` widget identity. Defaults to a `local` dev widget. */
  readonly widgetId?: WidgetID;
  /** Initial settings `settings.get()` returns; `settings.update()` persists onto them. */
  readonly settings?: WidgetSettings;
  /** Page context exposed as `sdk.context`; overrides the fixture file's `context`. */
  readonly context?: ContextMap;
  /** The {@link FixtureControls} label. Defaults to `gridmason-fixture-sdk`. */
  readonly label?: string;
  /** Scheduler for scripted `events` emissions. Defaults to `setTimeout`. */
  readonly scheduler?: FixtureScheduler;
}

/** Falls back to a unique, clearly dev-labeled instance id when none is given. */
let instanceCounter = 0;

// ─────────────────────────────────────────────────────────────────────────────
// createFixtureSDK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a fixture {@link HostSDK} handle (docs/SPEC.md §5): the no-op handle
 * backed by `fixtures`, with the capability check enforced against
 * `options.capabilities`. See the module doc for the four behaviors it adds over
 * the no-op. **Dev/test only** — it is not a conforming host.
 *
 * ```ts
 * const sdk = createFixtureSDK(
 *   { records: { read: [{ ref: { recordType: 'customer', id: 'c1' }, fields: { name: 'Acme' } }] } },
 *   { capabilities: ['records.read:recordType:customer'] },
 * );
 * await sdk.records.read({ recordType: 'customer', id: 'c1' }); // → { ref, fields: { name: 'Acme' } }
 * getFixtureControls(sdk).recorder.last('records.read')?.meta;   // → { outcome: 'fixture-hit' }
 * ```
 */
export function createFixtureSDK(
  fixtures: FixtureFile,
  options: FixtureSDKOptions = {},
): FixtureSDK {
  const declared = normalizeCapabilities(options.capabilities ?? []);
  const scheduler = options.scheduler ?? defaultScheduler;
  const recorder = createCallRecorder<SdkMethod>();
  const instanceId = options.instanceId ?? `dev-fixture-${++instanceCounter}`;

  // Reuse the no-op core for the ungated members and the shared recorder; the
  // gated members (records/net/events) and data-bearing settings are overridden.
  const noopMembers = buildNoopMembers(recorder, {
    context: options.context ?? fixtures.context ?? {},
    settings: options.settings ?? {},
    instanceId,
    widgetId: options.widgetId ?? { source: 'local', tag: 'fixture-widget' },
  });

  const records = buildRecords(recorder, declared, instanceId, fixtures);
  const net = buildNet(recorder, declared, instanceId, fixtures);
  const events = buildEvents(recorder, declared, instanceId);
  const settings = buildSettings(recorder, options.settings ?? {});

  // Schedule the fixture's scripted emissions. Subscribers register during the
  // widget's (synchronous) mount, which runs before any scheduled callback fires.
  for (const scripted of fixtures.events ?? []) {
    scheduler.schedule(
      () => events.deliver(scripted.topic.ns, scripted.topic.name, scripted.payload),
      scripted.delay ?? 0,
    );
  }

  const controls: FixtureControls = Object.freeze({
    isFixture: true as const,
    label: options.label ?? 'gridmason-fixture-sdk',
    recorder,
    fixtures,
  });

  return Object.freeze({
    records,
    net,
    events: events.bus,
    settings,
    context: noopMembers.context,
    nav: noopMembers.nav,
    telemetry: noopMembers.telemetry,
    identity: noopMembers.identity,
    [FIXTURE_CONTROLS]: controls,
  });
}

/** The arg list a `records.read` records — mirrors the no-op (omits an absent opts). */
function readArgs(ref: RecordRef, opts: ReadOptions | undefined): readonly unknown[] {
  return opts === undefined ? [ref] : [ref, opts];
}

function buildRecords(
  recorder: CallRecorder<SdkMethod>,
  declared: readonly NormalizedCapability[],
  instanceId: string,
  fixtures: FixtureFile,
): HostSDK['records'] {
  return Object.freeze({
    read(ref: RecordRef, opts?: ReadOptions): Promise<RecordData> {
      const required = readCapability(ref.recordType);
      if (!isGranted(declared, required)) {
        recorder.record('records.read', readArgs(ref, opts), metaDenied(required));
        return Promise.reject(
          new PermissionDenied({ capability: toCapability(required), instanceId }),
        );
      }
      const hit = matchRead(fixtures.records?.read, ref);
      if (hit !== undefined) {
        recorder.record('records.read', readArgs(ref, opts), META_HIT);
        return Promise.resolve({ ref, fields: hit.fields });
      }
      recorder.record('records.read', readArgs(ref, opts), META_EMPTY);
      return Promise.resolve({ ref, fields: {} });
    },
    query(spec: QuerySpec): Promise<RecordData[]> {
      const required = readCapability(spec.recordType);
      if (!isGranted(declared, required)) {
        recorder.record('records.query', [spec], metaDenied(required));
        return Promise.reject(
          new PermissionDenied({ capability: toCapability(required), instanceId }),
        );
      }
      const hit = matchQuery(fixtures.records?.query, spec);
      if (hit !== undefined) {
        recorder.record('records.query', [spec], META_HIT);
        return Promise.resolve([...hit.result]);
      }
      recorder.record('records.query', [spec], META_EMPTY);
      return Promise.resolve([]);
    },
    write(ref: RecordRef, patch: Patch): Promise<RecordData> {
      const required = writeCapability(ref.recordType);
      if (!isGranted(declared, required)) {
        recorder.record('records.write', [ref, patch], metaDenied(required));
        return Promise.reject(
          new PermissionDenied({ capability: toCapability(required), instanceId }),
        );
      }
      // No write fixtures in v0: an allowed write falls through to the no-op
      // default (echo the ref with empty fields), flagged default-empty.
      recorder.record('records.write', [ref, patch], META_EMPTY);
      return Promise.resolve({ ref, fields: {} });
    },
  });
}

function buildNet(
  recorder: CallRecorder<SdkMethod>,
  declared: readonly NormalizedCapability[],
  instanceId: string,
  fixtures: FixtureFile,
): HostSDK['net'] {
  return Object.freeze({
    fetch(req: ScopedRequest): Promise<ScopedResponse> {
      const required = netCapability(req.host);
      if (!isGranted(declared, required)) {
        recorder.record('net.fetch', [req], metaDenied(required));
        return Promise.reject(
          new PermissionDenied({ capability: toCapability(required), instanceId }),
        );
      }
      const hit = matchNet(fixtures.net, req);
      if (hit !== undefined) {
        recorder.record('net.fetch', [req], META_HIT);
        return Promise.resolve(toResponse(hit.response));
      }
      recorder.record('net.fetch', [req], META_EMPTY);
      return Promise.resolve(toResponse({}));
    },
  });
}

/**
 * Turn a fixture {@link NetResponse} into a {@link ScopedResponse}. A `body`
 * string is served verbatim (`text()`), with `json()` parsing it; any other JSON
 * value is served as JSON (`json()` returns it, `text()` returns its
 * `JSON.stringify`); an absent body is the empty response (the no-op default, so
 * `toResponse({})` is the fall-through empty).
 */
function toResponse(r: NetResponse): ScopedResponse {
  const status = r.status ?? 200;
  const body = r.body;
  const text =
    typeof body === 'string' ? body : body === undefined ? '' : JSON.stringify(body);
  return {
    status,
    ok: status < 400,
    headers: r.headers ?? {},
    json<T = unknown>(): Promise<T> {
      if (typeof body !== 'string') return Promise.resolve(body as T);
      if (body === '') return Promise.resolve(undefined as T);
      try {
        return Promise.resolve(JSON.parse(body) as T);
      } catch (e) {
        return Promise.reject(e as Error);
      }
    },
    text(): Promise<string> {
      return Promise.resolve(text);
    },
  };
}

interface Subscription {
  readonly topic: TypedTopic<unknown>;
  readonly handler: (payload: unknown) => void;
}

/**
 * The fixture event bus: a real same-document in-memory bus (unlike the no-op,
 * which records but never delivers). `deliver` is exposed to the factory so
 * scripted emissions can publish to subscribers.
 */
function buildEvents(
  recorder: CallRecorder<SdkMethod>,
  declared: readonly NormalizedCapability[],
  instanceId: string,
): { bus: HostSDK['events']; deliver: (ns: string, name: string, payload: unknown) => void } {
  const subscribers = new Set<Subscription>();

  function deliver(ns: string, name: string, payload: unknown): void {
    for (const sub of subscribers) {
      if (sub.topic.ns === ns && sub.topic.name === name) sub.handler(payload);
    }
  }

  const bus: HostSDK['events'] = Object.freeze({
    emit<T>(topic: TypedTopic<T>, payload: T): void {
      const required = eventsCapability(topic.ns);
      if (!isGranted(declared, required)) {
        recorder.record('events.emit', [topic, payload], metaDenied(required));
        throw new PermissionDenied({ capability: toCapability(required), instanceId });
      }
      recorder.record('events.emit', [topic, payload], META_ALLOWED);
      deliver(topic.ns, topic.name, payload);
    },
    on<T>(topic: TypedTopic<T>, handler: (payload: T) => void): Unsubscribe {
      const required = eventsCapability(topic.ns);
      if (!isGranted(declared, required)) {
        recorder.record('events.on', [topic, handler], metaDenied(required));
        throw new PermissionDenied({ capability: toCapability(required), instanceId });
      }
      recorder.record('events.on', [topic, handler], META_ALLOWED);
      const sub: Subscription = {
        topic: topic as TypedTopic<unknown>,
        handler: handler as (payload: unknown) => void,
      };
      subscribers.add(sub);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        subscribers.delete(sub);
        recorder.record('events.unsubscribe', [topic]);
      };
    },
  });

  return { bus, deliver };
}

/**
 * Data-bearing settings: `get` returns the current settings, `update` merges the
 * patch and persists it (a round trip the no-op deliberately lacks — see the
 * no-op module doc). Ungated (settings carry no capability).
 */
function buildSettings(
  recorder: CallRecorder<SdkMethod>,
  initial: WidgetSettings,
): HostSDK['settings'] {
  let current: WidgetSettings = { ...initial };
  return Object.freeze({
    get(): WidgetSettings {
      recorder.record('settings.get', []);
      return current;
    },
    update(patch: Partial<WidgetSettings>): Promise<void> {
      recorder.record('settings.update', [patch]);
      current = { ...current, ...patch };
      return Promise.resolve();
    },
    onSchema(schema: JSONSchema): void {
      recorder.record('settings.onSchema', [schema]);
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Brand guards
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Realm-safe brand guard: `true` iff `sdk` is a handle produced by
 * {@link createFixtureSDK}. Matches the {@link FIXTURE_CONTROLS} symbol and its
 * `isFixture` flag.
 */
export function isFixtureSDK(sdk: unknown): sdk is FixtureSDK {
  if (typeof sdk !== 'object' || sdk === null) return false;
  const controls = (sdk as { [FIXTURE_CONTROLS]?: unknown })[FIXTURE_CONTROLS];
  return (
    typeof controls === 'object' &&
    controls !== null &&
    (controls as { isFixture?: unknown }).isFixture === true
  );
}

/**
 * The {@link FixtureControls} of a fixture handle — its label, the shared
 * {@link CallRecorder} (calls tagged with {@link FixtureCallMeta}), and the
 * {@link FixtureFile} in force. The accessor a test or the CLI inspector reaches
 * the recording through.
 */
export function getFixtureControls(sdk: FixtureSDK): FixtureControls {
  return sdk[FIXTURE_CONTROLS];
}
