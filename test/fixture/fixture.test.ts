import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest';

import type { HostSDK, RecordData, TypedTopic } from '../../src/index.js';
import { PermissionDenied, isPermissionDenied } from '../../src/index.js';
import {
  FIXTURE_CONTROLS,
  createFixtureSDK,
  createManualScheduler,
  getFixtureControls,
  isFixtureSDK,
} from '../../src/fixture/index.js';
import type { FixtureCallMeta, FixtureFile, FixtureSDK } from '../../src/fixture/index.js';

/**
 * Issue #7 (FR-4): `createFixtureSDK(fixtures)` — the no-op handle backed by an
 * author-supplied fixture map, with the capability check still enforced so
 * "fixture-green predicts review-green". The three acceptance criteria are the
 * headline tests: a fixture-backed `records.read` returns the sample, an
 * undeclared capability is still denied, and an unmatched call is flagged in the
 * recording.
 */

const SALE_SELECTED: TypedTopic<{ readonly id: string }> = {
  ns: 'acme.sales',
  name: 'sale-selected',
};

/** Read the fixture outcome tag off a recorded call. */
function metaOf(sdk: FixtureSDK, method: Parameters<
  ReturnType<typeof getFixtureControls>['recorder']['last']
>[0]): FixtureCallMeta | undefined {
  return getFixtureControls(sdk).recorder.last(method)?.meta as FixtureCallMeta | undefined;
}

describe('createFixtureSDK — acceptance criteria (FR-4)', () => {
  test('fixture-backed records.read returns the sample record, flagged fixture-hit', async () => {
    const sdk = createFixtureSDK(
      {
        records: {
          read: [
            { ref: { recordType: 'customer', id: 'c1' }, fields: { name: 'Acme', tier: 'gold' } },
          ],
        },
      },
      { capabilities: ['records.read:recordType:customer'] },
    );

    await expect(
      sdk.records.read({ recordType: 'customer', id: 'c1' }),
    ).resolves.toEqual({
      ref: { recordType: 'customer', id: 'c1' },
      fields: { name: 'Acme', tier: 'gold' },
    });

    expect(metaOf(sdk, 'records.read')).toEqual({ outcome: 'fixture-hit' });
  });

  test('an undeclared capability is denied with a typed PermissionDenied — never fixture data', async () => {
    // A fixture EXISTS for `secret:s1`, but the widget did not declare read on it.
    const sdk = createFixtureSDK(
      { records: { read: [{ ref: { recordType: 'secret', id: 's1' }, fields: { k: 'v' } }] } },
      { capabilities: ['records.read:recordType:customer'] },
    );

    const denial = sdk.records.read({ recordType: 'secret', id: 's1' });
    await expect(denial).rejects.toBeInstanceOf(PermissionDenied);
    await denial.catch((e: unknown) => {
      expect(isPermissionDenied(e)).toBe(true);
      expect((e as PermissionDenied).capability).toEqual({
        api: 'records.read',
        scope: 'recordType:secret',
      });
    });

    // The denial is recorded — with the ungranted capability — and no data leaked.
    expect(metaOf(sdk, 'records.read')).toEqual({
      outcome: 'denied',
      capability: { api: 'records.read', scope: 'recordType:secret' },
    });
  });

  test('an unmatched (but allowed) call falls through to the no-op default, flagged default-empty', async () => {
    const sdk = createFixtureSDK(
      { records: { read: [{ ref: { recordType: 'customer', id: 'c1' }, fields: { name: 'Acme' } }] } },
      { capabilities: ['records.read'] }, // unscoped: grants every read
    );

    // Declared, but no fixture for id 'c2' → no-op default (echo ref, empty fields).
    await expect(sdk.records.read({ recordType: 'customer', id: 'c2' })).resolves.toEqual({
      ref: { recordType: 'customer', id: 'c2' },
      fields: {},
    });
    expect(metaOf(sdk, 'records.read')).toEqual({ outcome: 'default-empty' });
  });
});

describe('createFixtureSDK — query subset matching + specificity', () => {
  const fixtures: FixtureFile = {
    records: {
      query: [
        { match: { recordType: 'sale' }, result: [record('sale', 's-any')] },
        {
          match: { recordType: 'sale', where: { customer: 'c1' } },
          result: [record('sale', 's-c1a'), record('sale', 's-c1b')],
        },
      ],
    },
  };

  test('the most specific matching fixture wins (where-constrained beats bare recordType)', async () => {
    const sdk = createFixtureSDK(fixtures, { capabilities: ['records.read'] });

    const forC1 = await sdk.records.query({ recordType: 'sale', where: { customer: 'c1' } });
    expect(forC1.map((r) => r.ref.id)).toEqual(['s-c1a', 's-c1b']);
    expect(metaOf(sdk, 'records.query')).toEqual({ outcome: 'fixture-hit' });
  });

  test('a query matching only the broad pattern gets it (subset: extra call fields are ignored)', async () => {
    const sdk = createFixtureSDK(fixtures, { capabilities: ['records.read'] });

    // where.customer is 'c2' → the specific fixture does NOT match; the bare one does.
    const forC2 = await sdk.records.query({ recordType: 'sale', where: { customer: 'c2' } });
    expect(forC2.map((r) => r.ref.id)).toEqual(['s-any']);
  });

  test('a query with no matching fixture is default-empty ([])', async () => {
    const sdk = createFixtureSDK(fixtures, { capabilities: ['records.read'] });
    await expect(sdk.records.query({ recordType: 'invoice' })).resolves.toEqual([]);
    expect(metaOf(sdk, 'records.query')).toEqual({ outcome: 'default-empty' });
  });

  test('the returned list is a defensive copy (mutating it never affects the fixture)', async () => {
    const sdk = createFixtureSDK(fixtures, { capabilities: ['records.read'] });
    const first = await sdk.records.query({ recordType: 'sale' });
    first.push(record('sale', 'junk'));
    const second = await sdk.records.query({ recordType: 'sale' });
    expect(second.map((r) => r.ref.id)).toEqual(['s-any']);
  });
});

describe('createFixtureSDK — read templates (subset match on the ref)', () => {
  test('an id-less read fixture serves any id of the type; an exact-id fixture outranks it', async () => {
    const sdk = createFixtureSDK(
      {
        records: {
          read: [
            { ref: { recordType: 'customer' }, fields: { tier: 'default' } },
            { ref: { recordType: 'customer', id: 'vip' }, fields: { tier: 'platinum' } },
          ],
        },
      },
      { capabilities: ['records.read'] },
    );

    // Any id → template; the returned ref echoes the *requested* ref.
    await expect(sdk.records.read({ recordType: 'customer', id: 'c9' })).resolves.toEqual({
      ref: { recordType: 'customer', id: 'c9' },
      fields: { tier: 'default' },
    });
    // Exact id → the more specific fixture wins.
    await expect(sdk.records.read({ recordType: 'customer', id: 'vip' })).resolves.toEqual({
      ref: { recordType: 'customer', id: 'vip' },
      fields: { tier: 'platinum' },
    });
  });
});

describe('createFixtureSDK — net.fetch', () => {
  test('a matched request serves the fixture body + status; text() and json() read it', async () => {
    const sdk = createFixtureSDK(
      {
        net: [
          {
            match: { host: 'api.acme.com', path: '/v2/sales' },
            response: { status: 201, body: { total: 3 } },
          },
        ],
      },
      { capabilities: ['net:api.acme.com'] },
    );

    const res = await sdk.net.fetch({ host: 'api.acme.com', path: '/v2/sales' });
    expect(res.status).toBe(201);
    expect(res.ok).toBe(true);
    await expect(res.json()).resolves.toEqual({ total: 3 });
    await expect(res.text()).resolves.toBe('{"total":3}');
    expect(metaOf(sdk, 'net.fetch')).toEqual({ outcome: 'fixture-hit' });
  });

  test('a string body is served verbatim; json() parses it', async () => {
    const sdk = createFixtureSDK(
      { net: [{ match: { host: 'api.acme.com' }, response: { body: '{"ok":1}' } }] },
      { capabilities: ['net:api.acme.com'] },
    );
    const res = await sdk.net.fetch({ host: 'api.acme.com', path: '/anything' });
    await expect(res.text()).resolves.toBe('{"ok":1}');
    await expect(res.json()).resolves.toEqual({ ok: 1 });
  });

  test('an unmatched host-declared request is default-empty (OK, empty body)', async () => {
    const sdk = createFixtureSDK(
      { net: [{ match: { host: 'api.acme.com', path: '/v2/sales' }, response: { body: 'x' } }] },
      { capabilities: ['net:api.acme.com'] },
    );
    const res = await sdk.net.fetch({ host: 'api.acme.com', path: '/other' });
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe('');
    await expect(res.json()).resolves.toBeUndefined();
    expect(metaOf(sdk, 'net.fetch')).toEqual({ outcome: 'default-empty' });
  });

  test('an undeclared host is denied — even when a fixture would have matched', async () => {
    const sdk = createFixtureSDK(
      { net: [{ match: { host: 'evil.example' }, response: { body: 'secret' } }] },
      { capabilities: ['net:api.acme.com'] },
    );
    await expect(sdk.net.fetch({ host: 'evil.example', path: '/' })).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    expect(metaOf(sdk, 'net.fetch')).toEqual({
      outcome: 'denied',
      capability: { api: 'net', scope: 'evil.example' },
    });
  });

  test('a status >= 400 has ok=false', async () => {
    const sdk = createFixtureSDK(
      { net: [{ match: { host: 'api.acme.com' }, response: { status: 404 } }] },
      { capabilities: ['net'] }, // unscoped net grants every host
    );
    const res = await sdk.net.fetch({ host: 'api.acme.com', path: '/missing' });
    expect(res.status).toBe(404);
    expect(res.ok).toBe(false);
  });
});

describe('createFixtureSDK — event bus + scripted emissions', () => {
  test('scripted events fire to subscribers on their declared delays (deterministic)', () => {
    const scheduler = createManualScheduler();
    const sdk = createFixtureSDK(
      {
        events: [
          { topic: SALE_SELECTED, payload: { id: 'late' }, delay: 100 },
          { topic: SALE_SELECTED, payload: { id: 'early' }, delay: 10 },
        ],
      },
      { capabilities: ['events:acme.sales'], scheduler },
    );

    const seen: string[] = [];
    sdk.events.on(SALE_SELECTED, (p) => seen.push(p.id));

    expect(scheduler.pending).toBe(2);
    expect(seen).toEqual([]); // nothing fires until time advances

    scheduler.tick(10);
    expect(seen).toEqual(['early']); // shorter delay first

    scheduler.tick(90);
    expect(seen).toEqual(['early', 'late']);
    expect(scheduler.pending).toBe(0);
  });

  test('unsubscribing before a scripted event fires prevents delivery', () => {
    const scheduler = createManualScheduler();
    const sdk = createFixtureSDK(
      { events: [{ topic: SALE_SELECTED, payload: { id: 'x' }, delay: 50 }] },
      { capabilities: ['events:acme.sales'], scheduler },
    );
    let delivered = 0;
    const off = sdk.events.on(SALE_SELECTED, () => (delivered += 1));
    off();
    scheduler.flush();
    expect(delivered).toBe(0);
    expect(getFixtureControls(sdk).recorder.callsTo('events.unsubscribe')).toHaveLength(1);
  });

  test('the default scheduler delivers via setTimeout', async () => {
    vi.useFakeTimers();
    try {
      const sdk = createFixtureSDK(
        { events: [{ topic: SALE_SELECTED, payload: { id: 'timed' }, delay: 5 }] },
        { capabilities: ['events:acme.sales'] },
      );
      let got: string | undefined;
      sdk.events.on(SALE_SELECTED, (p) => (got = p.id));
      expect(got).toBeUndefined();
      await vi.advanceTimersByTimeAsync(5);
      expect(got).toBe('timed');
    } finally {
      vi.useRealTimers();
    }
  });

  test('emit delivers to on() subscribers (a real same-document bus, unlike the no-op)', () => {
    const sdk = createFixtureSDK({}, { capabilities: ['events:acme.sales'] });
    let delivered = 0;
    sdk.events.on(SALE_SELECTED, () => (delivered += 1));
    sdk.events.emit(SALE_SELECTED, { id: 'c1' });
    expect(delivered).toBe(1);
    expect(metaOf(sdk, 'events.emit')).toEqual({ outcome: 'allowed' });
  });

  test('emit/subscribe on an undeclared namespace throws PermissionDenied (sync)', () => {
    const sdk = createFixtureSDK({}, { capabilities: ['events:other.ns'] });
    expect(() => sdk.events.emit(SALE_SELECTED, { id: 'x' })).toThrow(PermissionDenied);
    expect(() => sdk.events.on(SALE_SELECTED, () => {})).toThrow(PermissionDenied);
    expect(metaOf(sdk, 'events.on')).toEqual({
      outcome: 'denied',
      capability: { api: 'events', scope: 'acme.sales' },
    });
  });

  test('a scripted event on an undeclared namespace reaches nobody (never subscribed)', () => {
    const scheduler = createManualScheduler();
    const sdk = createFixtureSDK(
      { events: [{ topic: SALE_SELECTED, payload: { id: 'x' }, delay: 0 }] },
      { capabilities: [], scheduler }, // no events capability at all
    );
    // The widget cannot even subscribe; firing delivers to an empty subscriber set.
    expect(() => sdk.events.on(SALE_SELECTED, () => {})).toThrow(PermissionDenied);
    expect(() => scheduler.flush()).not.toThrow();
  });
});

describe('createFixtureSDK — records.write + settings round trip', () => {
  test('write is capability-gated; an allowed write is default-empty (no write fixtures in v0)', async () => {
    const denied = createFixtureSDK({}, { capabilities: ['records.read:recordType:customer'] });
    await expect(
      denied.records.write({ recordType: 'customer', id: 'c1' }, { name: 'x' }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    expect(metaOf(denied, 'records.write')).toEqual({
      outcome: 'denied',
      capability: { api: 'records.write', scope: 'recordType:customer' },
    });

    const allowed = createFixtureSDK({}, { capabilities: ['records.write:recordType:customer'] });
    await expect(
      allowed.records.write({ recordType: 'customer', id: 'c1' }, { name: 'x' }),
    ).resolves.toEqual({ ref: { recordType: 'customer', id: 'c1' }, fields: {} });
    expect(metaOf(allowed, 'records.write')).toEqual({ outcome: 'default-empty' });
  });

  test('settings.update is data-bearing: a later get reflects the merged patch', async () => {
    const sdk = createFixtureSDK({}, { settings: { theme: 'light', density: 'cozy' } });
    expect(sdk.settings.get()).toEqual({ theme: 'light', density: 'cozy' });
    await sdk.settings.update({ theme: 'dark' });
    expect(sdk.settings.get()).toEqual({ theme: 'dark', density: 'cozy' });
  });
});

describe('createFixtureSDK — capability scope semantics', () => {
  test('records.read and records.write are distinct apis (read cap does not grant write)', async () => {
    const sdk = createFixtureSDK({}, { capabilities: ['records.read:recordType:customer'] });
    await expect(
      sdk.records.read({ recordType: 'customer', id: 'c1' }),
    ).resolves.toBeDefined();
    await expect(
      sdk.records.write({ recordType: 'customer', id: 'c1' }, {}),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  test('a scoped capability grants only its scope; the default (no capabilities) denies everything', async () => {
    const scoped = createFixtureSDK({}, { capabilities: ['records.read:recordType:customer'] });
    await expect(scoped.records.read({ recordType: 'customer', id: 'c1' })).resolves.toBeDefined();
    await expect(scoped.records.read({ recordType: 'order', id: 'o1' })).rejects.toBeInstanceOf(
      PermissionDenied,
    );

    const none = createFixtureSDK({});
    await expect(none.records.read({ recordType: 'customer', id: 'c1' })).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });

  test('object-form capabilities are accepted (as a manifest carries them)', async () => {
    const sdk = createFixtureSDK(
      {},
      { capabilities: [{ api: 'records.read', scope: 'recordType:customer' }] },
    );
    await expect(sdk.records.read({ recordType: 'customer', id: 'c1' })).resolves.toBeDefined();
  });

  test('an invalid capability throws at construction', () => {
    expect(() => createFixtureSDK({}, { capabilities: ['bogus.api:x'] })).toThrow(/invalid capability/);
    expect(() =>
      // @ts-expect-error — invalid api at the type level too
      createFixtureSDK({}, { capabilities: [{ api: 'nope' }] }),
    ).toThrow(/invalid capability/);
  });
});

describe('createFixtureSDK — recording + brand + type', () => {
  test('a denied call does not leak data and records exactly one denied entry', async () => {
    const sdk = createFixtureSDK(
      { records: { read: [{ ref: { recordType: 'secret', id: 's1' }, fields: { k: 'v' } }] } },
      { capabilities: [] },
    );
    await sdk.records.read({ recordType: 'secret', id: 's1' }).catch(() => undefined);
    const reads = getFixtureControls(sdk).recorder.callsTo('records.read');
    expect(reads).toHaveLength(1);
    expect(reads[0]?.meta).toEqual({
      outcome: 'denied',
      capability: { api: 'records.read', scope: 'recordType:secret' },
    });
  });

  test('the shared recorder preserves ordering and monotonic seq across mixed calls', async () => {
    const sdk = createFixtureSDK({}, { capabilities: ['records.read', 'events:acme.sales'] });
    await sdk.records.read({ recordType: 'customer', id: 'c1' });
    sdk.events.emit(SALE_SELECTED, { id: 'c1' });
    sdk.nav.toast({ message: 'hi' });

    const { recorder } = getFixtureControls(sdk);
    expect(recorder.calls.map((c) => c.method)).toEqual([
      'records.read',
      'events.emit',
      'nav.toast',
    ]);
    expect(recorder.calls.map((c) => c.seq)).toEqual([0, 1, 2]);
    // An ungated call (nav) carries no outcome meta.
    expect(recorder.last('nav.toast')?.meta).toBeUndefined();
  });

  test('the handle is branded and its controls (recorder + fixtures) are reachable', () => {
    const fixtures: FixtureFile = { records: { read: [] } };
    const sdk = createFixtureSDK(fixtures, { label: 'dashboard-dev' });
    expect(isFixtureSDK(sdk)).toBe(true);
    expect(sdk[FIXTURE_CONTROLS].isFixture).toBe(true);
    expect(getFixtureControls(sdk).label).toBe('dashboard-dev');
    expect(getFixtureControls(sdk).fixtures).toBe(fixtures);
  });

  test('isFixtureSDK rejects non-fixture values', () => {
    expect(isFixtureSDK(undefined)).toBe(false);
    expect(isFixtureSDK(null)).toBe(false);
    expect(isFixtureSDK({})).toBe(false);
    expect(isFixtureSDK({ [FIXTURE_CONTROLS]: { isFixture: false } })).toBe(false);
  });

  test('distinct handles have independent recorders and distinct default ids', async () => {
    const a = createFixtureSDK({}, { capabilities: ['records.read'] });
    const b = createFixtureSDK({}, { capabilities: ['records.read'] });
    await a.records.read({ recordType: 'x', id: '1' });
    expect(getFixtureControls(a).recorder.calls).toHaveLength(1);
    expect(getFixtureControls(b).recorder.calls).toHaveLength(0);
    expect(a.identity.instanceId).not.toBe(b.identity.instanceId);
  });

  test('a fixture handle satisfies HostSDK (type-level)', () => {
    expectTypeOf<FixtureSDK>().toExtend<HostSDK>();
    expectTypeOf(createFixtureSDK({})).toExtend<HostSDK>();
  });
});

/** A minimal RecordData for a type/id. */
function record(recordType: string, id: string): RecordData {
  return { ref: { recordType, id }, fields: {} };
}

afterEach(() => {
  vi.useRealTimers();
});
