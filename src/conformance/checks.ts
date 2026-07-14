/**
 * The six SPEC §3 contract-rule checks, decoupled from any test framework
 * (docs/SPEC.md §5). Each {@link ConformanceCheck} drives a {@link ConformanceHost}
 * through the allowed *and* denied side of one rule and rejects with a
 * {@link ConformanceViolation} on the first breach. `./index.ts` wraps them as
 * `vitest` tests; {@link runConformanceChecks} drives them without a framework
 * (used by the acceptance-gate fixture, and by any non-vitest consumer).
 *
 * A check asserts against the {@link HostSDK} *interface* only — it never reaches
 * into a concrete implementation. The two things the interface cannot expose (the
 * stamped remote identity, rule 3; the unmount lifecycle, rule 6) come through the
 * {@link Mount} adapter the host supplies.
 */

import { isInstanceGone, isPermissionDenied } from '../interface/index.js';
import type { HostSDK, RecordRef, TypedTopic } from '../interface/index.js';
import type { WidgetId } from '../protocol/index.js';
import { widgetIdEqual } from '@gridmason/protocol';

import { ConformanceViolation } from './types.js';
import type {
  ConformanceCheck,
  ConformanceHost,
  RemoteIdentityBinding,
  RuleId,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Scenario fixtures (the kit's own; host-agnostic)
// ─────────────────────────────────────────────────────────────────────────────

/** Two `(source, tag)` widget identities the checks mount. */
const WIDGET_A: WidgetId = { source: 'local', tag: 'gridmason-conformance-a' };
const WIDGET_B: WidgetId = { source: 'local', tag: 'gridmason-conformance-b' };

/** A record the checks read/query under a `records.read:recordType:customer` grant. */
const CUSTOMER: RecordRef = { recordType: 'customer', id: 'c1' };
/** A record of a *different* type, used to prove the intersection excludes it. */
const ORDER: RecordRef = { recordType: 'order', id: 'o1' };

/** A typed payload for the event-bus checks. */
interface SalePayload {
  readonly id: string;
}

/** Build a typed, namespaced topic. */
function topic<T>(ns: string, name: string): TypedTopic<T> {
  return { ns, name };
}

/** How long a stale-handle call may take before "hang" is a rule-6 violation. */
const STALE_CALL_TIMEOUT_MS = 1000;
/** How long to wait for an event emission to be delivered (host may deliver async). */
const DELIVERY_WAIT_MS = 200;
/** A short settle window to let an *erroneous* delivery land before asserting it did not. */
const DELIVERY_SETTLE_MS = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Small async/settlement helpers (no test framework)
// ─────────────────────────────────────────────────────────────────────────────

/** The result of settling a promise without letting it throw. */
type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

/** Await a promise, capturing rejection instead of propagating it. */
async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await p };
  } catch (error) {
    return { ok: false, error };
  }
}

/** Run a synchronous call, capturing a throw instead of propagating it. */
function trySync<T>(fn: () => T): Settled<T> {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

/** Sentinel returned by {@link withTimeout} when the promise did not settle in time. */
const TIMED_OUT = Symbol('gridmason.conformance.timeout');

/** Race `p` against a timer; resolve to {@link TIMED_OUT} if it does not settle in `ms`. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Resolve after `ms` (real timer). */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll `predicate` until it is true or `ms` elapses; returns its final value. */
async function waitFor(predicate: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await delay(2);
  }
  return predicate();
}

/** Render an unknown thrown value for a violation message. */
function describeThrown(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return `a non-Error value (${JSON.stringify(e)})`;
}

/** Raise a rule violation. */
function violate(rule: RuleId, message: string): never {
  throw new ConformanceViolation(rule, message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared assertions across rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assert a `records.read` was denied with a **typed** `PermissionDenied` and did
 * *not* resolve to an empty/default value (rule 1: no capability leakage).
 */
async function assertReadDenied(
  rule: RuleId,
  sdk: HostSDK,
  ref: RecordRef,
  who: string,
): Promise<void> {
  const outcome = await settle(sdk.records.read(ref));
  if (outcome.ok) {
    violate(
      rule,
      `records.read for "${ref.recordType}" by ${who} resolved (to ${JSON.stringify(outcome.value)}) instead of rejecting PermissionDenied — a denial must be a typed error, never an empty result a widget could read as "no data" (SPEC §3 rule 1, no capability leakage).`,
    );
  }
  if (!isPermissionDenied(outcome.error)) {
    violate(
      rule,
      `records.read for "${ref.recordType}" by ${who} rejected with ${describeThrown(outcome.error)} instead of a typed PermissionDenied (SPEC §3 rule 1).`,
    );
  }
}

/**
 * Assert a `records.query` was denied with a typed `PermissionDenied` and did
 * *not* resolve to `[]` — the classic empty-array leak (rule 1).
 */
async function assertQueryDenied(rule: RuleId, sdk: HostSDK, recordType: string): Promise<void> {
  const outcome = await settle(sdk.records.query({ recordType }));
  if (outcome.ok) {
    violate(
      rule,
      `records.query for "${recordType}" resolved (to ${JSON.stringify(outcome.value)}) instead of rejecting PermissionDenied — an ungranted query must reject, never return an empty list (SPEC §3 rule 1, no capability leakage).`,
    );
  }
  if (!isPermissionDenied(outcome.error)) {
    violate(
      rule,
      `records.query for "${recordType}" rejected with ${describeThrown(outcome.error)} instead of a typed PermissionDenied (SPEC §3 rule 1).`,
    );
  }
}

/** Assert a `records.read` the intersection grants actually resolves (positive control). */
async function assertReadAllowed(rule: RuleId, sdk: HostSDK, ref: RecordRef): Promise<void> {
  const outcome = await settle(sdk.records.read(ref));
  if (!outcome.ok) {
    violate(
      rule,
      `records.read for "${ref.recordType}" is granted by min(user, widget) but rejected with ${describeThrown(outcome.error)} — an allowed call must resolve, not deny (SPEC §3 rule 1).`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The six checks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rule 1 — capability intersection before transport, typed denial, no leakage.
 * Proves the host (a) denies a call the widget never declared, (b) intersects
 * `min(user, widget)` rather than trusting the widget's declaration, and (c)
 * allows a call both sides grant — with every denial a typed `PermissionDenied`,
 * never an empty result.
 */
const capabilityIntersection: ConformanceCheck = {
  id: 'capability-intersection',
  rule: 1,
  title: 'rule 1 — records/net checked against min(user, widget) before transport; denial is a typed PermissionDenied, never an empty result',
  async run(host: ConformanceHost): Promise<void> {
    // (a) The widget declared no capability at all → every read is denied.
    const undeclared = await host.mount({
      widgetId: WIDGET_A,
      widgetCapabilities: [],
      userCapabilities: ['records.read'],
    });
    await assertReadDenied('capability-intersection', undeclared.sdk, CUSTOMER, 'a widget that declared no capability');
    await assertQueryDenied('capability-intersection', undeclared.sdk, CUSTOMER.recordType);

    // (b) The widget declared all reads, but the user grants only `customer` →
    // the host must intersect: `customer` allowed, `order` denied.
    const narrowed = await host.mount({
      widgetId: WIDGET_A,
      widgetCapabilities: ['records.read'],
      userCapabilities: ['records.read:recordType:customer'],
    });
    await assertReadAllowed('capability-intersection', narrowed.sdk, CUSTOMER);
    await assertReadDenied('capability-intersection', narrowed.sdk, ORDER, 'a type outside the user grant');
    await assertQueryDenied('capability-intersection', narrowed.sdk, ORDER.recordType);
  },
};

/**
 * Rule 2 — `net.fetch` reaches only declared hosts. A request to the declared
 * host resolves; a request to an undeclared host rejects with a typed
 * `PermissionDenied`, never resolving to a response.
 */
const netHostScope: ConformanceCheck = {
  id: 'net-host-scope',
  rule: 2,
  title: 'rule 2 — net.fetch reaches only hosts declared via net:<host>; an undeclared host is denied',
  async run(host: ConformanceHost): Promise<void> {
    const mount = await host.mount({
      widgetId: WIDGET_A,
      widgetCapabilities: ['net:api.acme.com'],
      userCapabilities: ['net:api.acme.com'],
    });

    const allowed = await settle(mount.sdk.net.fetch({ host: 'api.acme.com', path: '/v2/sales' }));
    if (!allowed.ok) {
      violate(
        'net-host-scope',
        `net.fetch to the declared host "api.acme.com" rejected with ${describeThrown(allowed.error)} — a declared host must be reachable (SPEC §3 rule 2).`,
      );
    }

    const denied = await settle(mount.sdk.net.fetch({ host: 'evil.example', path: '/exfil' }));
    if (denied.ok) {
      violate(
        'net-host-scope',
        `net.fetch to the undeclared host "evil.example" resolved (status ${denied.value.status}) instead of rejecting PermissionDenied — net reaches only declared hosts (SPEC §3 rule 2).`,
      );
    }
    if (!isPermissionDenied(denied.error)) {
      violate(
        'net-host-scope',
        `net.fetch to the undeclared host "evil.example" rejected with ${describeThrown(denied.error)} instead of a typed PermissionDenied (SPEC §3 rule 2).`,
      );
    }
  },
};

/** Assert the host stamped a per-instance remote identity on an outbound call. */
function assertBoundIdentity(
  binding: RemoteIdentityBinding | undefined,
  expectedInstanceId: string,
  call: string,
): void {
  if (binding === undefined) {
    violate(
      'remote-identity',
      `${call} produced no remote-identity binding (Mount.lastOutboundIdentity() returned undefined) — every outbound call must carry the per-instance identity (SPEC §3 rule 3).`,
    );
  }
  if (binding.instanceId !== expectedInstanceId) {
    violate(
      'remote-identity',
      `${call} bound identity for instance "${binding.instanceId}", but the calling handle is instance "${expectedInstanceId}" — the binding must be this mount's identity (SPEC §3 rule 3, tied to rule 5).`,
    );
  }
}

/**
 * Rule 3 — every outbound call carries the per-instance remote-identity binding.
 * After an allowed `records.read` and an allowed `net.fetch`, the host must
 * report (via {@link Mount.lastOutboundIdentity}) a binding whose `instanceId`
 * matches the calling handle. A host that drops it reports `undefined`.
 */
const remoteIdentity: ConformanceCheck = {
  id: 'remote-identity',
  rule: 3,
  title: 'rule 3 — every outbound records/net call carries the per-instance remote-identity binding',
  async run(host: ConformanceHost): Promise<void> {
    const mount = await host.mount({
      widgetId: WIDGET_A,
      widgetCapabilities: ['records.read:recordType:customer', 'net:api.acme.com'],
      userCapabilities: ['records.read:recordType:customer', 'net:api.acme.com'],
    });
    const expected = mount.sdk.identity.instanceId;

    const read = await settle(mount.sdk.records.read(CUSTOMER));
    if (!read.ok) {
      violate(
        'remote-identity',
        `a granted records.read rejected with ${describeThrown(read.error)} — rule 3 is asserted on an allowed outbound call (SPEC §3 rule 3).`,
      );
    }
    assertBoundIdentity(mount.lastOutboundIdentity(), expected, 'records.read');

    const fetched = await settle(mount.sdk.net.fetch({ host: 'api.acme.com', path: '/v2/sales' }));
    if (!fetched.ok) {
      violate(
        'remote-identity',
        `a granted net.fetch rejected with ${describeThrown(fetched.error)} — rule 3 is asserted on an allowed outbound call (SPEC §3 rule 3).`,
      );
    }
    assertBoundIdentity(mount.lastOutboundIdentity(), expected, 'net.fetch');
  },
};

/**
 * Rule 4 — typed, namespaced, capability-gated events; host-mediated, never a
 * shared global. Emitting or subscribing on a namespace the widget lacks is a
 * typed denial; a granted typed topic is delivered host-mediated to a co-mounted
 * subscriber and routed by exact topic, so a widget cannot reach the bus except
 * through a capability it holds. The denial is strengthened to *no delivery*: a
 * denied out-of-namespace emit must not reach a live subscriber — neither leaked
 * past the gate nor routed by topic name across namespaces (SPEC §6, "never a
 * delivered event").
 */
const eventGating: ConformanceCheck = {
  id: 'event-gating',
  rule: 4,
  title: 'rule 4 — events are typed, namespaced, and capability-gated; the bus is host-mediated, never a shared global',
  async run(host: ConformanceHost): Promise<void> {
    const emitter = await host.mount({
      widgetId: WIDGET_A,
      widgetCapabilities: ['events:acme.sales'],
      userCapabilities: ['events:acme.sales'],
    });
    const subscriber = await host.mount({
      widgetId: WIDGET_B,
      widgetCapabilities: ['events:acme.sales'],
      userCapabilities: ['events:acme.sales'],
    });

    // (a) Subscribing to a namespace the widget has no `events:<ns>` for is denied, typed.
    const ungranted = topic<unknown>('secret.ops', 'leak');
    const onOutcome = trySync(() => subscriber.sdk.events.on(ungranted, () => undefined));
    if (onOutcome.ok) {
      onOutcome.value();
      violate(
        'event-gating',
        `events.on for the ungranted namespace "secret.ops" was allowed — a subscription requires the events:<ns> capability (SPEC §3 rule 4).`,
      );
    }
    if (!isPermissionDenied(onOutcome.error)) {
      violate(
        'event-gating',
        `events.on for the ungranted namespace "secret.ops" threw ${describeThrown(onOutcome.error)} instead of a typed PermissionDenied (SPEC §3 rule 4).`,
      );
    }

    // (b) Emitting on an ungranted namespace is likewise denied, typed.
    const emitOutcome = trySync(() => emitter.sdk.events.emit(ungranted, { id: 'x' }));
    if (emitOutcome.ok) {
      violate(
        'event-gating',
        `events.emit on the ungranted namespace "secret.ops" was allowed — an emission requires the events:<ns> capability (SPEC §3 rule 4).`,
      );
    }
    if (!isPermissionDenied(emitOutcome.error)) {
      violate(
        'event-gating',
        `events.emit on the ungranted namespace "secret.ops" threw ${describeThrown(emitOutcome.error)} instead of a typed PermissionDenied (SPEC §3 rule 4).`,
      );
    }

    // (c) A granted, typed topic is delivered host-mediated to a co-mounted
    // subscriber, and routed by exact topic (the same-ns different-name emission
    // must not reach this handler).
    const sales = topic<SalePayload>('acme.sales', 'selected');
    const received: SalePayload[] = [];
    const unsub = subscriber.sdk.events.on(sales, (p) => {
      received.push(p);
    });
    emitter.sdk.events.emit(topic<SalePayload>('acme.sales', 'other'), { id: 'wrong-topic' });
    emitter.sdk.events.emit(sales, { id: 's1' });

    await waitFor(() => received.length >= 1, DELIVERY_WAIT_MS);
    await delay(DELIVERY_SETTLE_MS); // let any erroneous same-ns delivery land too

    if (received.length !== 1 || received[0]?.id !== 's1') {
      unsub();
      violate(
        'event-gating',
        `a granted typed topic emission was not delivered host-mediated and routed by exact topic (received ${JSON.stringify(received)}, expected exactly [{ id: 's1' }]) — the bus must gate by capability and route by typed topic, never behave as a shared global (SPEC §3 rule 4).`,
      );
    }

    // (d) A capability denial is *no delivery*, not merely a thrown error — "never a
    // delivered event" (SPEC §3 rule 4, §6). With the granted acme.sales/selected
    // handler still live, the emitter (which holds only events:acme.sales) emits a
    // topic of the same *name* in an ungranted namespace: a conforming host must
    // throw PermissionDenied *and* deliver nothing — neither leaking the payload past
    // the gate (deliver-then-deny) nor routing it by name across namespaces into the
    // live subscriber. This is stronger than (b): (b) proves the emit throws, (d)
    // proves the throw is accompanied by silence on the bus.
    const crossNs = topic<SalePayload>('secret.ops', 'selected');
    const leak = trySync(() => emitter.sdk.events.emit(crossNs, { id: 'leaked' }));
    if (leak.ok) {
      unsub();
      violate(
        'event-gating',
        `events.emit on the ungranted namespace "secret.ops" was allowed — an emission requires the events:<ns> capability (SPEC §3 rule 4).`,
      );
    }
    if (!isPermissionDenied(leak.error)) {
      unsub();
      violate(
        'event-gating',
        `events.emit on the ungranted namespace "secret.ops" threw ${describeThrown(leak.error)} instead of a typed PermissionDenied (SPEC §3 rule 4).`,
      );
    }
    await delay(DELIVERY_SETTLE_MS); // let any erroneous cross-namespace delivery land before asserting it did not
    unsub();
    if (received.length !== 1) {
      violate(
        'event-gating',
        `a denied out-of-namespace emission was still delivered to a subscriber (received ${JSON.stringify(received)}, expected the denial to reach no one) — a capability denial must be no delivery, never a leaked event routed by name across namespaces (SPEC §3 rule 4, §6).`,
      );
    }
  },
};

/**
 * Rule 5 — the handle is per-instance. Two mounts of the *same* widget get
 * distinct, non-empty `instanceId`s (while preserving the widget identity).
 */
const perInstanceId: ConformanceCheck = {
  id: 'per-instance-id',
  rule: 5,
  title: 'rule 5 — two mounts of the same widget get distinct handles with distinct instanceId',
  async run(host: ConformanceHost): Promise<void> {
    const first = await host.mount({ widgetId: WIDGET_A, widgetCapabilities: [], userCapabilities: [] });
    const second = await host.mount({ widgetId: WIDGET_A, widgetCapabilities: [], userCapabilities: [] });

    const idA = first.sdk.identity.instanceId;
    const idB = second.sdk.identity.instanceId;

    if (typeof idA !== 'string' || idA.length === 0 || typeof idB !== 'string' || idB.length === 0) {
      violate(
        'per-instance-id',
        `identity.instanceId must be a non-empty string per mount, got ${JSON.stringify(idA)} and ${JSON.stringify(idB)} (SPEC §3 rule 5).`,
      );
    }
    if (idA === idB) {
      violate(
        'per-instance-id',
        `two mounts of the same widget share instanceId "${idA}" — each mount must get a distinct per-instance handle (SPEC §3 rule 5).`,
      );
    }
    if (!widgetIdEqual(first.sdk.identity.widgetId, WIDGET_A) || !widgetIdEqual(second.sdk.identity.widgetId, WIDGET_A)) {
      violate(
        'per-instance-id',
        `a mount reported a widgetId other than the one it was mounted with — the per-instance handle must preserve the (source, tag) widget identity (SPEC §3 rule 5).`,
      );
    }
  },
};

/**
 * Rule 6 — unmount revokes the token, auto-unsubscribes, and stale calls reject
 * `InstanceGone`. After unmount, a gated call on the stale handle must reject
 * with a typed `InstanceGone` (never resolve, never hang), and a subscription
 * registered through the handle must no longer receive emissions.
 */
const unmountRevocation: ConformanceCheck = {
  id: 'unmount-revocation',
  rule: 6,
  title: 'rule 6 — unmount revokes the token and auto-unsubscribes; a stale handle rejects InstanceGone',
  async run(host: ConformanceHost): Promise<void> {
    const sales = topic<SalePayload>('acme.sales', 'selected');
    const subscriber = await host.mount({
      widgetId: WIDGET_A,
      widgetCapabilities: ['records.read:recordType:customer', 'events:acme.sales'],
      userCapabilities: ['records.read:recordType:customer', 'events:acme.sales'],
    });
    const emitter = await host.mount({
      widgetId: WIDGET_B,
      widgetCapabilities: ['events:acme.sales'],
      userCapabilities: ['events:acme.sales'],
    });

    const received: SalePayload[] = [];
    subscriber.sdk.events.on(sales, (p) => {
      received.push(p);
    });

    await subscriber.unmount();

    // (1) A gated call on the stale handle must reject InstanceGone — not resolve,
    // not hang.
    const stale = await withTimeout(settle(subscriber.sdk.records.read(CUSTOMER)), STALE_CALL_TIMEOUT_MS);
    if (stale === TIMED_OUT) {
      violate(
        'unmount-revocation',
        `records.read on an unmounted handle neither resolved nor rejected within ${STALE_CALL_TIMEOUT_MS}ms — a stale call must reject InstanceGone, never hang (SPEC §3 rule 6).`,
      );
    }
    if (stale.ok) {
      violate(
        'unmount-revocation',
        `records.read on an unmounted handle resolved (to ${JSON.stringify(stale.value)}) instead of rejecting InstanceGone — the per-instance token must be revoked on unmount (SPEC §3 rule 6).`,
      );
    }
    if (!isInstanceGone(stale.error)) {
      violate(
        'unmount-revocation',
        `records.read on an unmounted handle rejected with ${describeThrown(stale.error)} instead of a typed InstanceGone (SPEC §3 rule 6).`,
      );
    }

    // (2) Auto-unsubscribe: an emission after unmount must not reach the released
    // handler.
    const before = received.length;
    emitter.sdk.events.emit(sales, { id: 'after-unmount' });
    await delay(DELIVERY_SETTLE_MS);
    if (received.length !== before) {
      violate(
        'unmount-revocation',
        `a subscription registered through an unmounted handle still received an emission — unmount must release every events subscription (SPEC §3 rule 6).`,
      );
    }
  },
};

/**
 * The six SPEC §3 contract-rule checks, in rule order. Passing every check
 * against a host is the definition of "a valid Gridmason host" (SPEC §5).
 */
export const conformanceChecks: readonly ConformanceCheck[] = [
  capabilityIntersection,
  netHostScope,
  remoteIdentity,
  eventGating,
  perInstanceId,
  unmountRevocation,
];

/** The outcome of running one {@link ConformanceCheck}. */
export interface ConformanceResult {
  /** The check that ran. */
  readonly check: ConformanceCheck;
  /** `true` when the host conformed to the rule. */
  readonly ok: boolean;
  /** The violation raised when `ok` is `false` and the failure was a rule breach. */
  readonly violation?: ConformanceViolation;
  /** An unexpected (non-{@link ConformanceViolation}) error thrown by the check. */
  readonly error?: unknown;
}

/**
 * Run every {@link ConformanceCheck} against `host` and collect the results,
 * without a test framework. The vitest entrypoint ({@link runHostConformance})
 * is the usual way a host runs the kit; this driver is for the acceptance-gate
 * fixture and for consumers embedding the kit outside vitest.
 */
export async function runConformanceChecks(host: ConformanceHost): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = [];
  for (const check of conformanceChecks) {
    try {
      await check.run(host);
      results.push({ check, ok: true });
    } catch (error) {
      if (error instanceof ConformanceViolation) {
        results.push({ check, ok: false, violation: error });
      } else {
        results.push({ check, ok: false, error });
      }
    }
  }
  return results;
}
