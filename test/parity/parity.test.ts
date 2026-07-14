// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';

import { createFixtureSDK, getFixtureControls } from '../../src/fixture/index.js';
import type { FixtureFile, FixtureSDKOptions } from '../../src/fixture/index.js';
import type { TypedTopic } from '../../src/index.js';
import { adapters } from './adapters.js';
import type { Ping } from './adapters.js';

/**
 * Parity matrix (issue #10, FR-5) — the acceptance gate for the Phase-B adapters.
 * The same five behavioral cases (fixture-backed record read, settings bind +
 * persist, emit/receive an event, scoped fetch, capability denial), plus an idle
 * no-ref read, run against React, Vue, and vanilla and must produce identical
 * observable behavior. Two layers:
 *
 * 1. **Per-adapter** (`describe.each`) — each adapter alone must produce the
 *    expected result *and* the expected 1:1 handle calls (the recorder proves a
 *    helper mirrors a handle method one-for-one, no extra reads).
 * 2. **Cross-adapter** — every case is run on all three fresh handles and the
 *    normalized observations are asserted deep-equal, so no adapter silently
 *    diverges. This is the "identical observable behavior" gate the issue names.
 *
 * The adapters are driven in their native environments by `./adapters.ts`; this
 * file only supplies fixtures and asserts. `jsdom` is selected for React's
 * `renderHook`.
 */

const CUSTOMER = { recordType: 'customer', id: 'c1' } as const;
const SECRET = { recordType: 'secret', id: 's1' } as const;

const PING: TypedTopic<Ping> = { ns: 'acme.sales', name: 'ping' };
const PINGS: readonly Ping[] = [{ id: 'a' }, { id: 'b' }];

/** A fixture file with a customer read, a secret read, and a net endpoint. */
const FIXTURES: FixtureFile = {
  records: {
    read: [
      { ref: CUSTOMER, fields: { name: 'Acme', tier: 'gold' } },
      { ref: SECRET, fields: { key: 'top-secret' } },
    ],
  },
  net: [{ match: { host: 'api.acme.com', path: '/v2/ping' }, response: { body: { pong: true } } }],
};

/** The capabilities a widget declares to exercise the allowed cases (not `secret`). */
const CAPS = [
  'records.read:recordType:customer',
  'events:acme.sales',
  'net:api.acme.com',
];

function freshSdk(overrides: FixtureSDKOptions = {}) {
  return createFixtureSDK(FIXTURES, {
    capabilities: CAPS,
    settings: { label: 'initial' },
    ...overrides,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-adapter: expected behavior + 1:1 handle-call accounting
// ─────────────────────────────────────────────────────────────────────────────

describe.each(adapters)('$name adapter', (adapter) => {
  test('reads a fixture-backed record through exactly one sdk.records.read', async () => {
    const sdk = freshSdk();
    const observed = await adapter.observeRecord(sdk, CUSTOMER);
    expect(observed).toEqual({
      status: 'success',
      data: { ref: CUSTOMER, fields: { name: 'Acme', tier: 'gold' } },
      denied: false,
      capability: undefined,
    });
    const recorder = getFixtureControls(sdk).recorder;
    expect(recorder.callsTo('records.read')).toHaveLength(1);
    expect(recorder.last('records.read')?.meta).toEqual({ outcome: 'fixture-hit' });
  });

  test('an undefined ref is idle and issues no read', async () => {
    const sdk = freshSdk();
    const observed = await adapter.observeRecord(sdk, undefined);
    expect(observed).toEqual({
      status: 'idle',
      data: undefined,
      denied: false,
      capability: undefined,
    });
    expect(getFixtureControls(sdk).recorder.callsTo('records.read')).toHaveLength(0);
  });

  test('binds settings and persists a patch through one sdk.settings.update', async () => {
    const sdk = freshSdk();
    const observed = await adapter.observeSettings(sdk, { label: 'renamed' });
    expect(observed).toEqual({
      before: { label: 'initial' },
      after: { label: 'renamed' },
    });
    const recorder = getFixtureControls(sdk).recorder;
    expect(recorder.callsTo('settings.update')).toHaveLength(1);
    expect(recorder.last('settings.update')?.args).toEqual([{ label: 'renamed' }]);
    expect(recorder.callsTo('settings.get').length).toBeGreaterThanOrEqual(1);
  });

  test('subscribes, receives every emission, and stops receiving after teardown', async () => {
    const sdk = freshSdk();
    const observed = await adapter.observeEvents(sdk, PING, PINGS);
    expect(observed.received).toEqual(PINGS);
    expect(observed.afterTeardown).toBe(0);
    const recorder = getFixtureControls(sdk).recorder;
    expect(recorder.callsTo('events.on')).toHaveLength(1);
    expect(recorder.callsTo('events.unsubscribe')).toHaveLength(1);
  });

  test('scoped fetch returns the fixture response through one sdk.net.fetch', async () => {
    const sdk = freshSdk();
    const observed = await adapter.observeFetch(sdk, { host: 'api.acme.com', path: '/v2/ping' });
    expect(observed).toEqual({ status: 200, ok: true, json: { pong: true } });
    expect(getFixtureControls(sdk).recorder.callsTo('net.fetch')).toHaveLength(1);
  });

  test('a read the widget lacks capability for is denied, never fixture data', async () => {
    const sdk = freshSdk();
    const observed = await adapter.observeRecord(sdk, SECRET);
    expect(observed).toEqual({
      status: 'error',
      data: undefined,
      denied: true,
      capability: { api: 'records.read', scope: 'recordType:secret' },
    });
    expect(getFixtureControls(sdk).recorder.last('records.read')?.meta).toMatchObject({
      outcome: 'denied',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-adapter: the observations must be identical across all three
// ─────────────────────────────────────────────────────────────────────────────

describe('identical observable behavior across adapters', () => {
  /** Run `observe` on a fresh handle for each adapter and assert all results deep-equal. */
  async function assertIdentical<T>(
    observe: (adapter: (typeof adapters)[number], sdk: ReturnType<typeof freshSdk>) => Promise<T>,
  ): Promise<void> {
    const results = await Promise.all(
      adapters.map(async (adapter) => ({ name: adapter.name, value: await observe(adapter, freshSdk()) })),
    );
    const [reference, ...rest] = results;
    if (reference === undefined) throw new Error('no adapters registered');
    for (const other of rest) {
      expect(other.value, `${other.name} diverges from ${reference.name}`).toEqual(reference.value);
    }
  }

  test('record read is identical', async () => {
    await assertIdentical((adapter, sdk) => adapter.observeRecord(sdk, CUSTOMER));
  });

  test('idle read is identical', async () => {
    await assertIdentical((adapter, sdk) => adapter.observeRecord(sdk, undefined));
  });

  test('settings bind + persist is identical', async () => {
    await assertIdentical((adapter, sdk) => adapter.observeSettings(sdk, { label: 'renamed' }));
  });

  test('emit/receive is identical', async () => {
    await assertIdentical((adapter, sdk) => adapter.observeEvents(sdk, PING, PINGS));
  });

  test('scoped fetch is identical', async () => {
    await assertIdentical((adapter, sdk) =>
      adapter.observeFetch(sdk, { host: 'api.acme.com', path: '/v2/ping' }),
    );
  });

  test('capability denial is identical', async () => {
    await assertIdentical((adapter, sdk) => adapter.observeRecord(sdk, SECRET));
  });
});
