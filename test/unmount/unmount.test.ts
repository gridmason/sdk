import { describe, expect, test } from 'vitest';

import { isInstanceGone } from '../../src/index.js';
import type { HostSDK, RecordRef, TypedTopic } from '../../src/index.js';
import { createNoopSDK, getNoopControls } from '../../src/noop/index.js';
import {
  createFixtureSDK,
  createManualScheduler,
  getFixtureControls,
} from '../../src/fixture/index.js';
import { releaseInstance, subscribe } from '../../src/helpers/index.js';
import { conformanceChecks } from '../../src/conformance/index.js';
import type { ConformanceHost } from '../../src/conformance/index.js';

/**
 * Issue #13 (FR-2, SPEC §3 rule 6): unmount-semantics hardening across the helper
 * core and the dev implementations. Three acceptance gates:
 *
 * - **stale-handle** — after unmount, *every* handle method fails with a typed
 *   `InstanceGone` (async members reject, sync ones throw), never hanging and
 *   never returning data;
 * - **subscription-leak** — N `events` subscriptions, unmount, zero survivors;
 * - **per-instance isolation** — unmounting one mount leaves a sibling mount fully
 *   live (independent revocation).
 *
 * Plus the consistency contract: the conformance kit's authoritative rule-6 check
 * (`src/conformance/checks.ts`) is driven against the hardened no-op mount seam and
 * must pass — a host passing conformance and a widget using the dev handles agree
 * on unmount behavior.
 */

const CUSTOMER: RecordRef = { recordType: 'customer', id: 'c1' };
const SALES: TypedTopic<{ readonly id: string }> = { ns: 'acme.sales', name: 'selected' };

/**
 * Assert a promise settles quickly (never hangs) and settles as a rejection with a
 * typed `InstanceGone` — never resolving to data.
 */
async function expectGoneAsync(p: Promise<unknown>): Promise<void> {
  const TIMED_OUT = Symbol('timeout');
  const RESOLVED = Symbol('resolved');
  const outcome = await Promise.race([
    p.then(
      () => RESOLVED,
      (e: unknown) => e,
    ),
    new Promise<typeof TIMED_OUT>((resolve) => setTimeout(() => resolve(TIMED_OUT), 500)),
  ]);
  expect(outcome, 'a stale async call must not hang').not.toBe(TIMED_OUT);
  expect(outcome, 'a stale async call must not resolve with data').not.toBe(RESOLVED);
  expect(isInstanceGone(outcome)).toBe(true);
}

/** Assert a synchronous call throws a typed `InstanceGone`. */
function expectGoneSync(fn: () => unknown): void {
  let thrown: unknown;
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    thrown = e;
  }
  expect(threw, 'a stale sync call must throw').toBe(true);
  expect(isInstanceGone(thrown)).toBe(true);
}

/** Drive every handle method on a stale handle and assert each fails `InstanceGone`. */
async function assertEveryMethodGone(sdk: HostSDK): Promise<void> {
  // Async members reject.
  await expectGoneAsync(sdk.records.read(CUSTOMER));
  await expectGoneAsync(sdk.records.query({ recordType: 'customer' }));
  await expectGoneAsync(sdk.records.write(CUSTOMER, { note: 'x' }));
  await expectGoneAsync(sdk.net.fetch({ host: 'api.acme.com', path: '/v2/sales' }));
  await expectGoneAsync(sdk.settings.update({ label: 'x' }));
  // Sync members throw.
  expectGoneSync(() => sdk.events.emit(SALES, { id: 'x' }));
  expectGoneSync(() => sdk.events.on(SALES, () => {}));
  expectGoneSync(() => sdk.settings.get());
  expectGoneSync(() => sdk.settings.onSchema({}));
  expectGoneSync(() => sdk.nav.open({ path: '/x' }));
  expectGoneSync(() => sdk.nav.toast({ message: 'x' }));
  expectGoneSync(() => sdk.telemetry.error({ message: 'x' }));
  expectGoneSync(() => sdk.telemetry.mark('load', 1));
}

describe('stale-handle: every method rejects/throws InstanceGone after unmount', () => {
  test('no-op handle', async () => {
    const sdk = createNoopSDK();
    getNoopControls(sdk).unmount();
    expect(getNoopControls(sdk).revoked).toBe(true);
    await assertEveryMethodGone(sdk);
  });

  test('fixture handle — deadness dominates even a granted capability', async () => {
    // Grant every capability the methods touch, so the InstanceGone is the token
    // revocation, not a PermissionDenied.
    const sdk = createFixtureSDK(
      {},
      {
        capabilities: [
          'records.read:recordType:customer',
          'records.write:recordType:customer',
          'net:api.acme.com',
          'events:acme.sales',
        ],
      },
    );
    getFixtureControls(sdk).unmount();
    expect(getFixtureControls(sdk).revoked).toBe(true);
    await assertEveryMethodGone(sdk);
  });

  test('unmount is idempotent', () => {
    const sdk = createNoopSDK();
    const { unmount } = getNoopControls(sdk);
    unmount();
    expect(() => unmount()).not.toThrow();
    expect(getNoopControls(sdk).revoked).toBe(true);
  });
});

describe('subscription-leak: unmount releases every subscription (zero survivors)', () => {
  test('no-op — every events.on is released on unmount', () => {
    const sdk = createNoopSDK();
    const N = 5;
    for (let i = 0; i < N; i++) sdk.events.on(SALES, () => {});
    const { recorder } = getNoopControls(sdk);
    expect(recorder.callsTo('events.on')).toHaveLength(N);
    expect(recorder.callsTo('events.unsubscribe')).toHaveLength(0);

    getNoopControls(sdk).unmount();

    // Every opened subscription released → zero survivors.
    expect(recorder.callsTo('events.unsubscribe')).toHaveLength(N);
  });

  test('fixture — a scripted emission after unmount reaches no subscriber', () => {
    const scheduler = createManualScheduler();
    const sdk = createFixtureSDK(
      { events: [{ topic: { ns: SALES.ns, name: SALES.name }, payload: { id: 'after' }, delay: 10 }] },
      { capabilities: ['events:acme.sales'], scheduler },
    );
    const received: { id: string }[] = [];
    const N = 4;
    for (let i = 0; i < N; i++) sdk.events.on(SALES, (p) => received.push(p));

    // Positive control: the live bus delivers to all N subscribers.
    sdk.events.emit(SALES, { id: 'live' });
    expect(received).toHaveLength(N);
    received.length = 0;

    getFixtureControls(sdk).unmount();
    expect(getFixtureControls(sdk).recorder.callsTo('events.unsubscribe')).toHaveLength(N);

    // The scripted emission still fires host-internally, but the bus was drained on
    // unmount, so it reaches nobody.
    scheduler.tick(10);
    expect(received).toHaveLength(0);
  });

  test('helper core — releaseInstance drains every subscription registered through subscribe()', () => {
    const sdk = createFixtureSDK({}, { capabilities: ['events:acme.sales'] });
    const received: { id: string }[] = [];
    const N = 3;
    for (let i = 0; i < N; i++) subscribe(sdk, SALES, (p) => received.push(p));

    sdk.events.emit(SALES, { id: 'live' });
    expect(received).toHaveLength(N);
    received.length = 0;

    releaseInstance(sdk);
    expect(getFixtureControls(sdk).recorder.callsTo('events.unsubscribe')).toHaveLength(N);

    // After release, an emission (the host is not revoked here) reaches no subscriber.
    sdk.events.emit(SALES, { id: 'again' });
    expect(received).toHaveLength(0);

    // Idempotent: a second release is a no-op.
    expect(() => releaseInstance(sdk)).not.toThrow();
  });
});

describe('per-instance isolation: revocation is independent across mounts', () => {
  test('no-op — unmounting one mount leaves the sibling live', async () => {
    const a = createNoopSDK();
    const b = createNoopSDK();

    getNoopControls(a).unmount();

    await expectGoneAsync(a.records.read(CUSTOMER));
    await expect(b.records.read(CUSTOMER)).resolves.toEqual({ ref: CUSTOMER, fields: {} });
    expect(getNoopControls(a).revoked).toBe(true);
    expect(getNoopControls(b).revoked).toBe(false);
  });

  test('fixture — a sibling bus keeps delivering after the other unmounts', () => {
    const a = createFixtureSDK({}, { capabilities: ['events:acme.sales'] });
    const b = createFixtureSDK({}, { capabilities: ['events:acme.sales'] });
    const receivedB: { id: string }[] = [];
    b.events.on(SALES, (p) => receivedB.push(p));

    getFixtureControls(a).unmount();

    expectGoneSync(() => a.events.emit(SALES, { id: 'x' }));
    b.events.emit(SALES, { id: 'live' });
    expect(receivedB).toEqual([{ id: 'live' }]);
  });
});

describe('consistency contract: conformance kit rule-6 passes against the hardened no-op', () => {
  test('the authoritative rule-6 check resolves for the no-op mount seam', async () => {
    const rule6 = conformanceChecks.find((c) => c.rule === 6);
    expect(rule6, 'the kit must expose a rule-6 check').toBeDefined();

    // A minimal ConformanceHost over the hardened no-op: its out-of-band unmount is
    // the dev handle's token revocation, so the kit's rule-6 assertions (stale call
    // → InstanceGone; no delivery to a released subscriber) hold. The no-op is not a
    // conforming host for the other rules — this exercises rule 6 only.
    const host: ConformanceHost = {
      name: 'hardened no-op',
      mount(req) {
        const sdk = createNoopSDK({ widgetId: req.widgetId });
        return {
          sdk,
          lastOutboundIdentity: () => undefined,
          unmount: () => getNoopControls(sdk).unmount(),
        };
      },
    };

    await expect(rule6!.run(host)).resolves.toBeUndefined();
  });
});
