import { describe, expect, expectTypeOf, test } from 'vitest';

import type { HostSDK, RecordData, TypedTopic } from '../../src/index.js';
import {
  NOOP_CONTROLS,
  createCallRecorder,
  createNoopSDK,
  getNoopControls,
  isNoopSDK,
} from '../../src/noop/index.js';
import type { NoopSDK } from '../../src/noop/index.js';

/**
 * Issue #6 (FR-3): `createNoopSDK()` — every method resolves typed-empty, every
 * call is recorded for assertions, and the handle is branded dev/no-op. The
 * headline test is the acceptance criterion "recorded calls assertable in a
 * sample widget test": a plain widget function is handed a no-op handle and its
 * SDK usage is asserted from the recording alone.
 */

// A topic a widget would emit/subscribe on. `TypedTopic` binds the payload type.
const SALE_SELECTED: TypedTopic<{ readonly id: string }> = {
  ns: 'acme.sales',
  name: 'sale-selected',
};

describe('createNoopSDK — sample widget test (acceptance criterion)', () => {
  // A realistic widget: it never knows it holds a no-op — it just uses the SDK.
  async function salesWidget(sdk: HostSDK): Promise<RecordData> {
    const customer = await sdk.records.read({ recordType: 'customer', id: 'c1' });
    await sdk.records.query({ recordType: 'sale', where: { customer: 'c1' } });
    sdk.events.emit(SALE_SELECTED, { id: 'c1' });
    const off = sdk.events.on(SALE_SELECTED, () => {});
    off();
    sdk.nav.toast({ message: 'loaded', level: 'success' });
    sdk.telemetry.mark('load', 42);
    return customer;
  }

  test('a widget test asserts which calls the widget made, with what args, in order', async () => {
    const sdk = createNoopSDK();
    await salesWidget(sdk);

    const { recorder } = getNoopControls(sdk);

    // "the widget called records.read with this ref"
    expect(recorder.last('records.read')?.args[0]).toEqual({
      recordType: 'customer',
      id: 'c1',
    });
    // "emitted this event with this payload"
    expect(recorder.last('events.emit')?.args).toEqual([SALE_SELECTED, { id: 'c1' }]);
    // subscription was opened and released
    expect(recorder.callsTo('events.on')).toHaveLength(1);
    expect(recorder.callsTo('events.unsubscribe')).toHaveLength(1);

    // The exact ordered sequence of methods the widget invoked.
    expect(recorder.calls.map((c) => c.method)).toEqual([
      'records.read',
      'records.query',
      'events.emit',
      'events.on',
      'events.unsubscribe',
      'nav.toast',
      'telemetry.mark',
    ]);
    // seq is monotonic, contiguous, and starts at 0.
    expect(recorder.calls.map((c) => c.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('createNoopSDK — typed-empty defaults', () => {
  test('records: read/write echo the ref with empty fields, query is []', async () => {
    const sdk = createNoopSDK();
    const ref = { recordType: 'customer', id: 'c1' };

    await expect(sdk.records.read(ref)).resolves.toEqual({ ref, fields: {} });
    await expect(sdk.records.query({ recordType: 'customer' })).resolves.toEqual([]);
    await expect(sdk.records.write(ref, { name: 'x' })).resolves.toEqual({
      ref,
      fields: {},
    });
  });

  test('net.fetch resolves an OK, empty-body ScopedResponse', async () => {
    const sdk = createNoopSDK();
    const res = await sdk.net.fetch({ host: 'api.acme.com', path: '/v2/x' });

    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.headers).toEqual({});
    await expect(res.text()).resolves.toBe('');
    await expect(res.json()).resolves.toBeUndefined();
  });

  test('settings.get returns empty (or the provided) settings; update resolves', async () => {
    expect(createNoopSDK().settings.get()).toEqual({});
    expect(createNoopSDK({ settings: { theme: 'dark' } }).settings.get()).toEqual({
      theme: 'dark',
    });
    await expect(createNoopSDK().settings.update({ theme: 'dark' })).resolves.toBeUndefined();
  });

  test('context and identity are dev-labeled typed defaults, overridable', () => {
    const dflt = createNoopSDK();
    expect(dflt.context).toEqual({});
    expect(dflt.identity.instanceId).toMatch(/^dev-noop-\d+$/);
    expect(dflt.identity.widgetId).toEqual({ source: 'local', tag: 'noop-widget' });

    const custom = createNoopSDK({
      instanceId: 'inst-42',
      widgetId: { source: 'local', tag: 'acme-chart' },
      context: { customer: { recordType: 'customer', id: 'c1' } },
    });
    expect(custom.identity.instanceId).toBe('inst-42');
    expect(custom.identity.widgetId).toEqual({ source: 'local', tag: 'acme-chart' });
    expect(custom.context).toEqual({
      customer: { recordType: 'customer', id: 'c1' },
    });
  });

  test('denies nothing — no method throws or rejects, for any input', async () => {
    const sdk = createNoopSDK();
    // A capability a real host would deny; the no-op resolves it anyway.
    await expect(
      sdk.records.read({ recordType: 'secret', id: 'x' }),
    ).resolves.toBeDefined();
    await expect(sdk.net.fetch({ host: 'undeclared.example', path: '/' })).resolves.toBeDefined();
    expect(() => sdk.events.emit(SALE_SELECTED, { id: 'x' })).not.toThrow();
  });
});

describe('createNoopSDK — events subscription lifecycle', () => {
  test('on() returns a working, idempotent Unsubscribe that records once', () => {
    const sdk = createNoopSDK();
    const { recorder } = getNoopControls(sdk);

    const off = sdk.events.on(SALE_SELECTED, () => {});
    off();
    off(); // idempotent — records no second unsubscribe
    off();

    expect(recorder.callsTo('events.unsubscribe')).toHaveLength(1);
  });

  test('emit does not deliver to on() subscribers (no-op has no bus)', () => {
    const sdk = createNoopSDK();
    let delivered = 0;
    sdk.events.on(SALE_SELECTED, () => {
      delivered += 1;
    });
    sdk.events.emit(SALE_SELECTED, { id: 'c1' });
    expect(delivered).toBe(0);
  });
});

describe('createNoopSDK — dev/no-op brand', () => {
  test('the handle is branded and its controls are reachable', () => {
    const sdk = createNoopSDK();
    expect(isNoopSDK(sdk)).toBe(true);
    expect(sdk[NOOP_CONTROLS].isNoop).toBe(true);
    expect(getNoopControls(sdk).label).toBe('gridmason-noop-sdk');
    expect(getNoopControls(createNoopSDK({ label: 'dashboard-m1' })).label).toBe('dashboard-m1');
  });

  test('isNoopSDK rejects non-no-op values', () => {
    expect(isNoopSDK(undefined)).toBe(false);
    expect(isNoopSDK(null)).toBe(false);
    expect(isNoopSDK({})).toBe(false);
    expect(isNoopSDK({ records: {}, net: {} })).toBe(false);
    // A look-alike that lacks the branded controls is not a no-op.
    expect(isNoopSDK({ [NOOP_CONTROLS]: { isNoop: false } })).toBe(false);
  });

  test('a no-op handle satisfies HostSDK (type-level)', () => {
    expectTypeOf<NoopSDK>().toExtend<HostSDK>();
    expectTypeOf(createNoopSDK()).toExtend<HostSDK>();
  });
});

describe('createNoopSDK — handle isolation', () => {
  test('distinct handles have independent recorders and distinct default ids', async () => {
    const a = createNoopSDK();
    const b = createNoopSDK();

    await a.records.query({ recordType: 'x' });

    expect(getNoopControls(a).recorder.calls).toHaveLength(1);
    expect(getNoopControls(b).recorder.calls).toHaveLength(0);
    expect(a.identity.instanceId).not.toBe(b.identity.instanceId);
  });
});

describe('createCallRecorder — reusable recording helper (shared with fixture #7)', () => {
  test('records method/args/seq, and calls is a defensive snapshot', () => {
    const rec = createCallRecorder<'a' | 'b'>();
    rec.record('a', [1]);
    rec.record('b', ['x', 'y']);

    expect(rec.calls).toEqual([
      { method: 'a', args: [1], seq: 0 },
      { method: 'b', args: ['x', 'y'], seq: 1 },
    ]);

    // Mutating the returned array does not affect the log.
    const snapshot = rec.calls;
    (snapshot as unknown[]).push('junk');
    expect(rec.calls).toHaveLength(2);
  });

  test('callsTo filters, last finds the most recent, clear empties without rewinding seq', () => {
    const rec = createCallRecorder<'a' | 'b'>();
    rec.record('a', []);
    rec.record('b', []);
    rec.record('a', []);

    expect(rec.callsTo('a')).toHaveLength(2);
    expect(rec.last()?.method).toBe('a');
    expect(rec.last('b')?.seq).toBe(1);

    rec.clear();
    expect(rec.calls).toHaveLength(0);
    expect(rec.last()).toBeUndefined();
    // seq keeps advancing after a clear (it never rewinds).
    expect(rec.record('a', []).seq).toBe(3);
  });
});
