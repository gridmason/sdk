/**
 * Acceptance gate for the host-conformance kit (docs/SPEC.md §5, issue #12 /
 * FR-7). The kit is only as good as the violations it catches, so this test
 * validates it against a **deliberately-broken host**: a minimal conforming
 * reference host (built on the no-op reference impl, issue #6) that can be
 * instrumented to fail exactly one SPEC §3 rule at a time. Two properties are
 * asserted, and together they are the gate:
 *
 * 1. The conforming host passes **all six** checks (no false positives — a kit
 *    that failed a conforming host would be useless).
 * 2. For each rule, a host seeded to violate *that* rule makes the matching
 *    check fail with a {@link ConformanceViolation} for that rule (no gaps — a
 *    rule the kit cannot catch is a gap in the kit).
 *
 * The reference host here is intentionally *not* shipped: a real conforming host
 * (the dashboard's `HostSDK`, a product shell) supplies its own
 * {@link ConformanceHost} adapter. This one exists only to exercise the kit.
 */

import { describe, expect, test } from 'vitest';

import { parseCapability } from '@gridmason/protocol';
import type { Capability, CapabilityApi } from '@gridmason/protocol';

import {
  InstanceGone,
  PermissionDenied,
} from '../../src/interface/index.js';
import type {
  HostSDK,
  Patch,
  QuerySpec,
  ReadOptions,
  RecordData,
  RecordRef,
  ScopedRequest,
  ScopedResponse,
  TypedTopic,
  Unsubscribe,
} from '../../src/interface/index.js';
import { buildNoopMembers, createCallRecorder } from '../../src/noop/index.js';
import type { SdkMethod } from '../../src/noop/index.js';

import {
  ConformanceViolation,
  conformanceChecks,
  runConformanceChecks,
  runHostConformance,
} from '../../src/conformance/index.js';
import type {
  ConformanceHost,
  Mount,
  MountRequest,
  RemoteIdentityBinding,
  RuleId,
} from '../../src/conformance/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Capability grant — min(user, widget) via prefix containment (SPEC §3.1)
// ─────────────────────────────────────────────────────────────────────────────

interface NormalizedCap {
  readonly api: CapabilityApi;
  readonly scopePath: readonly string[];
}

function normalize(caps: readonly (Capability | string)[]): NormalizedCap[] {
  return caps.map((cap) => {
    if (typeof cap === 'string') {
      const parsed = parseCapability(cap);
      if (!parsed.ok) throw new Error(`invalid capability "${cap}": ${parsed.error}`);
      return { api: parsed.api, scopePath: parsed.scopePath };
    }
    return { api: cap.api, scopePath: cap.scope === undefined ? [] : cap.scope.split(':') };
  });
}

/** `true` iff `short` is a prefix of (or equal to) `long`. */
function isPrefix(short: readonly string[], long: readonly string[]): boolean {
  return short.length <= long.length && short.every((seg, i) => seg === long[i]);
}

/** `true` iff some capability in `set` grants (`api`, `scopePath`) by prefix. */
function grantsOne(set: readonly NormalizedCap[], api: CapabilityApi, scopePath: readonly string[]): boolean {
  return set.some((cap) => cap.api === api && isPrefix(cap.scopePath, scopePath));
}

// ─────────────────────────────────────────────────────────────────────────────
// A minimal conforming reference host, instrumentable to break one rule
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The host-level event bus a {@link ConformanceHost}'s mounts share, so an
 * emission from one mount reaches a co-mounted subscriber (rule 4). Each
 * subscription is tagged with its owner `instanceId` so unmount can release just
 * that mount's subscriptions (rule 6).
 */
interface Subscription {
  readonly ns: string;
  readonly name: string;
  readonly handler: (payload: unknown) => void;
  readonly owner: string;
}

let instanceCounter = 0;

/**
 * Build a {@link ConformanceHost} whose mounts genuinely enforce every SPEC §3
 * rule — unless `broken` names one rule, whose enforcement is disabled to seed a
 * single violation. Built on {@link buildNoopMembers}: the underlying data
 * returns and the ungated members come from the no-op reference impl; this wraps
 * them with capability intersection, remote-identity stamping, a host-mediated
 * event bus, and unmount revocation.
 *
 * `opts.eventLeak` seeds a subtler rule-4 breach than disabling the gate: the host
 * still *denies* an out-of-namespace subscribe/emit (so the denial assertions pass),
 * but an emit delivers its payload to same-*name* subscribers regardless of
 * namespace or the gate — the "denied but still delivered" leak the strengthened
 * rule-4 check must catch. Kept off the {@link RuleId} axis (it is not a distinct
 * rule, but a leak within rule 4), so the one-check-per-rule mapping stays intact.
 */
function createConformanceHost(
  broken?: RuleId,
  opts: { readonly eventLeak?: boolean } = {},
): ConformanceHost {
  const enforceRecords = broken !== 'capability-intersection';
  const enforceNet = broken !== 'net-host-scope';
  const stampIdentity = broken !== 'remote-identity';
  const enforceEvents = broken !== 'event-gating';
  const distinctIds = broken !== 'per-instance-id';
  const revokeOnUnmount = broken !== 'unmount-revocation';
  const eventLeak = opts.eventLeak === true;

  const subscriptions = new Set<Subscription>();

  function deliver(ns: string, name: string, payload: unknown): void {
    for (const sub of subscriptions) {
      if (sub.ns === ns && sub.name === name) sub.handler(payload);
    }
  }

  function mount(request: MountRequest): Mount {
    const widget = normalize(request.widgetCapabilities);
    const user = normalize(request.userCapabilities);
    const granted = (api: CapabilityApi, scopePath: readonly string[]): boolean =>
      grantsOne(widget, api, scopePath) && grantsOne(user, api, scopePath);

    const instanceId = distinctIds ? `ref-instance-${++instanceCounter}` : 'ref-instance-shared';
    let revoked = false;
    let lastIdentity: RemoteIdentityBinding | undefined;

    const stamp = (binding: RemoteIdentityBinding): void => {
      if (stampIdentity) lastIdentity = binding;
    };

    const noop = buildNoopMembers(createCallRecorder<SdkMethod>(), {
      context: request.context ?? {},
      settings: {},
      instanceId,
      widgetId: request.widgetId,
    });

    const denied = (api: CapabilityApi, scope: string): PermissionDenied =>
      new PermissionDenied({ capability: { api, scope }, instanceId });

    const records: HostSDK['records'] = {
      read(ref: RecordRef, opts?: ReadOptions): Promise<RecordData> {
        if (revoked) return Promise.reject(new InstanceGone({ instanceId }));
        const scope = ['recordType', ref.recordType];
        if (enforceRecords && !granted('records.read', scope)) {
          return Promise.reject(denied('records.read', scope.join(':')));
        }
        stamp({ instanceId });
        return noop.records.read(ref, opts);
      },
      query(spec: QuerySpec): Promise<RecordData[]> {
        if (revoked) return Promise.reject(new InstanceGone({ instanceId }));
        const scope = ['recordType', spec.recordType];
        if (enforceRecords && !granted('records.read', scope)) {
          return Promise.reject(denied('records.read', scope.join(':')));
        }
        stamp({ instanceId });
        return noop.records.query(spec);
      },
      write(ref: RecordRef, patch: Patch): Promise<RecordData> {
        if (revoked) return Promise.reject(new InstanceGone({ instanceId }));
        const scope = ['recordType', ref.recordType];
        if (enforceRecords && !granted('records.write', scope)) {
          return Promise.reject(denied('records.write', scope.join(':')));
        }
        stamp({ instanceId });
        return noop.records.write(ref, patch);
      },
    };

    const net: HostSDK['net'] = {
      fetch(req: ScopedRequest): Promise<ScopedResponse> {
        if (revoked) return Promise.reject(new InstanceGone({ instanceId }));
        if (enforceNet && !granted('net', [req.host])) {
          return Promise.reject(denied('net', req.host));
        }
        stamp({ instanceId, host: req.host });
        return noop.net.fetch(req);
      },
    };

    const events: HostSDK['events'] = {
      emit<T>(topic: TypedTopic<T>, payload: T): void {
        if (revoked) throw new InstanceGone({ instanceId });
        // Seeded leak: deliver by topic *name* alone — ignoring the namespace and
        // the capability gate — so an ungranted emit still reaches a same-name
        // subscriber. This is the "denied but delivered" breach the strengthened
        // rule-4 check catches; a faithful host delivers only after the gate and
        // only to exact-topic (ns + name) subscribers.
        if (eventLeak) {
          for (const sub of subscriptions) {
            if (sub.name === topic.name) sub.handler(payload);
          }
        }
        if (enforceEvents && !granted('events', [topic.ns])) {
          throw denied('events', topic.ns);
        }
        if (!eventLeak) deliver(topic.ns, topic.name, payload);
      },
      on<T>(topic: TypedTopic<T>, handler: (payload: T) => void): Unsubscribe {
        if (revoked) throw new InstanceGone({ instanceId });
        if (enforceEvents && !granted('events', [topic.ns])) {
          throw denied('events', topic.ns);
        }
        const sub: Subscription = {
          ns: topic.ns,
          name: topic.name,
          handler: handler as (payload: unknown) => void,
          owner: instanceId,
        };
        subscriptions.add(sub);
        let active = true;
        return () => {
          if (!active) return;
          active = false;
          subscriptions.delete(sub);
        };
      },
    };

    const sdk: HostSDK = {
      records,
      net,
      events,
      context: noop.context,
      settings: noop.settings,
      nav: noop.nav,
      telemetry: noop.telemetry,
      identity: noop.identity,
    };

    return {
      sdk,
      lastOutboundIdentity: () => lastIdentity,
      unmount: () => {
        if (!revokeOnUnmount) return; // seeded rule-6 violation: no revoke, no unsubscribe
        revoked = true;
        for (const sub of [...subscriptions]) {
          if (sub.owner === instanceId) subscriptions.delete(sub);
        }
      },
    };
  }

  return { name: broken === undefined ? 'reference host' : `reference host (broken: ${broken})`, mount };
}

// ─────────────────────────────────────────────────────────────────────────────
// The gate
// ─────────────────────────────────────────────────────────────────────────────

const ALL_RULES: readonly RuleId[] = [
  'capability-intersection',
  'net-host-scope',
  'remote-identity',
  'event-gating',
  'per-instance-id',
  'unmount-revocation',
];

// Exercise the shipped vitest entrypoint exactly as a consumer would: one
// top-level call registers a `test` per rule. A conforming host passes all six,
// proving the `runHostConformance` binding (not just the framework-free driver)
// works end to end.
runHostConformance(createConformanceHost(), { label: 'reference host (vitest binding)' });

describe('conformance kit — acceptance gate', () => {
  test('a conforming reference host passes all six checks', async () => {
    const results = await runConformanceChecks(createConformanceHost());
    for (const result of results) {
      // An unexpected (non-violation) throw is a bug in the check itself.
      expect(result.error, `check "${result.check.id}" threw unexpectedly`).toBeUndefined();
      expect(
        result.ok,
        result.violation ? `check "${result.check.id}" failed: ${result.violation.message}` : undefined,
      ).toBe(true);
    }
  });

  test('every SPEC §3 rule has a dedicated check', () => {
    expect(conformanceChecks.map((c) => c.id).sort()).toEqual([...ALL_RULES].sort());
    // The `rule` numbers are 1..6, one each.
    expect(conformanceChecks.map((c) => c.rule).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  for (const rule of ALL_RULES) {
    test(`catches a seeded violation of rule "${rule}"`, async () => {
      const host = createConformanceHost(rule);
      const check = conformanceChecks.find((c) => c.id === rule);
      if (check === undefined) throw new Error(`no check for rule "${rule}"`);

      let thrown: unknown;
      try {
        await check.run(host);
      } catch (error) {
        thrown = error;
      }

      expect(thrown, `the kit did not catch a seeded violation of rule "${rule}"`).toBeInstanceOf(
        ConformanceViolation,
      );
      expect((thrown as ConformanceViolation).rule).toBe(rule);
    });
  }

  test('catches an events-gating leak: a denied out-of-namespace emit that still delivered', async () => {
    // A host that correctly *denies* out-of-namespace subscribe/emit (so the denial
    // assertions pass) but leaks the emitted payload to a same-name subscriber
    // regardless of namespace — the "never a delivered event" breach only the
    // strengthened rule-4 assertion catches. This proves the strengthening is
    // load-bearing: disabling the gate entirely is already caught by the
    // denial assertions, but a deliver-past-the-gate leak needs its own assertion.
    const host = createConformanceHost(undefined, { eventLeak: true });
    const check = conformanceChecks.find((c) => c.id === 'event-gating');
    if (check === undefined) throw new Error('no event-gating check');

    let thrown: unknown;
    try {
      await check.run(host);
    } catch (error) {
      thrown = error;
    }

    expect(thrown, 'the kit did not catch a denied-but-delivered events leak').toBeInstanceOf(
      ConformanceViolation,
    );
    expect((thrown as ConformanceViolation).rule).toBe('event-gating');
  });
});
