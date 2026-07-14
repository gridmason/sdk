// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Suspense, useState } from 'react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, test } from 'vitest';

import { createFixtureSDK, getFixtureControls } from '../../src/fixture/index.js';
import type { FixtureFile } from '../../src/fixture/index.js';
import type { HostSDK, TypedTopic } from '../../src/index.js';
import {
  emit,
  on,
  scopedFetch,
  useRecord,
  useRecordSuspense,
  useSettings,
} from '../../src/helpers/react/index.js';

/**
 * Issue #8 (FR-5): the React helper subset — `useRecord`, `useSettings`, `emit`/`on`,
 * `scopedFetch` — over the framework-agnostic core. The acceptance criterion is the
 * headline test: a sample React widget mounts `useRecord` + `useSettings` against
 * `createFixtureSDK` and both the rendered data and the recorded SDK calls check out.
 * The remaining tests cover the audit guarantees (each helper mirrors a handle method
 * 1:1), the cache/read-dedup semantics, capability denial surfacing as an error, and
 * the suspense variant.
 *
 * Assertions query by rendered text rather than reading DOM node properties: the
 * package deliberately compiles without the DOM lib (src is DOM-agnostic — see the
 * interface module doc), so the test stays off `HTMLElement`-typed accessors.
 */

// Testing Library's auto-cleanup keys off a global `afterEach`, which vitest does not
// expose unless `globals: true`; unmount explicitly so each test starts clean.
afterEach(cleanup);

const CUSTOMER_FIXTURE: FixtureFile = {
  records: {
    read: [
      { ref: { recordType: 'customer', id: 'c1' }, fields: { name: 'Acme', tier: 'gold' } },
    ],
  },
};

/** A sample widget exercising the two headline hooks together. */
function CustomerCard({ sdk }: { sdk: HostSDK }): ReactElement {
  const { data, loading, error } = useRecord(sdk, { recordType: 'customer', id: 'c1' });
  const [settings, setSettings] = useSettings(sdk);

  if (loading) return <p>loading…</p>;
  if (error) return <p role="alert">denied</p>;
  return (
    <div>
      <h1>{`name:${String(data?.fields.name)}`}</h1>
      <p>{`tier:${String(data?.fields.tier)}`}</p>
      <p>{`label:${String(settings.label ?? '')}`}</p>
      <button onClick={() => void setSettings({ label: 'renamed' })}>rename</button>
    </div>
  );
}

describe('React helpers — acceptance (FR-5): sample widget over createFixtureSDK', () => {
  test('useRecord + useSettings render fixture data, and the SDK calls are recorded', async () => {
    const sdk = createFixtureSDK(CUSTOMER_FIXTURE, {
      capabilities: ['records.read:recordType:customer'],
      settings: { label: 'initial' },
    });

    render(<CustomerCard sdk={sdk} />);

    // The record resolves and its fields render.
    await screen.findByText('name:Acme');
    screen.getByText('tier:gold');
    // Settings are reactive and seeded from the handle.
    screen.getByText('label:initial');

    const recorder = getFixtureControls(sdk).recorder;
    // The read went through the handle exactly once (audit: helper mirrors it 1:1).
    expect(recorder.callsTo('records.read')).toHaveLength(1);
    expect(recorder.callsTo('records.read')[0]?.args).toEqual([
      { recordType: 'customer', id: 'c1' },
    ]);
    expect(recorder.last('records.read')?.meta).toEqual({ outcome: 'fixture-hit' });
    // useSettings seeded from settings.get().
    expect(recorder.callsTo('settings.get').length).toBeGreaterThanOrEqual(1);

    // The setter persists through settings.update and the reactive snapshot advances.
    fireEvent.click(screen.getByText('rename'));
    await screen.findByText('label:renamed');
    expect(recorder.callsTo('settings.update')).toHaveLength(1);
    expect(recorder.last('settings.update')?.args).toEqual([{ label: 'renamed' }]);
  });
});

describe('useRecord — cache, idle, and denial', () => {
  test('two hooks reading the same ref share one sdk.records.read (documented dedup)', async () => {
    const sdk = createFixtureSDK(CUSTOMER_FIXTURE, {
      capabilities: ['records.read:recordType:customer'],
    });
    function Two({ sdk }: { sdk: HostSDK }): ReactElement {
      const a = useRecord(sdk, { recordType: 'customer', id: 'c1' });
      const b = useRecord(sdk, { recordType: 'customer', id: 'c1' });
      return <p>{`${String(a.data?.fields.name)}/${String(b.data?.fields.name)}`}</p>;
    }
    render(<Two sdk={sdk} />);
    await screen.findByText('Acme/Acme');
    expect(getFixtureControls(sdk).recorder.callsTo('records.read')).toHaveLength(1);
  });

  test('an undefined ref is idle and issues no read', () => {
    const sdk = createFixtureSDK(CUSTOMER_FIXTURE, {
      capabilities: ['records.read:recordType:customer'],
    });
    function Idle({ sdk }: { sdk: HostSDK }): ReactElement {
      const { status, data, loading } = useRecord(sdk, undefined);
      return <p>{`${status}:${String(data)}:${String(loading)}`}</p>;
    }
    render(<Idle sdk={sdk} />);
    screen.getByText('idle:undefined:false');
    expect(getFixtureControls(sdk).recorder.callsTo('records.read')).toHaveLength(0);
  });

  test('a read the widget lacks capability for surfaces as an error (never fixture data)', async () => {
    // A fixture exists for `secret:s1`, but the widget declared only `customer`.
    const sdk = createFixtureSDK(
      { records: { read: [{ ref: { recordType: 'secret', id: 's1' }, fields: { k: 'v' } }] } },
      { capabilities: ['records.read:recordType:customer'] },
    );
    function Secret({ sdk }: { sdk: HostSDK }): ReactElement {
      const { error, loading } = useRecord(sdk, { recordType: 'secret', id: 's1' });
      if (loading) return <p>loading…</p>;
      return <p role="alert">{error ? 'denied' : 'leaked'}</p>;
    }
    render(<Secret sdk={sdk} />);
    await screen.findByText('denied');
    expect(getFixtureControls(sdk).recorder.last('records.read')?.meta).toMatchObject({
      outcome: 'denied',
    });
  });
});

describe('useRecordSuspense — the suspense-glue variant', () => {
  test('suspends until the read resolves, then renders the record', async () => {
    const sdk = createFixtureSDK(CUSTOMER_FIXTURE, {
      capabilities: ['records.read:recordType:customer'],
    });
    function Card({ sdk }: { sdk: HostSDK }): ReactElement {
      const record = useRecordSuspense(sdk, { recordType: 'customer', id: 'c1' });
      return <h1>{String(record.fields.name)}</h1>;
    }
    render(
      <Suspense fallback={<p>fallback</p>}>
        <Card sdk={sdk} />
      </Suspense>,
    );
    await screen.findByText('Acme');
    expect(getFixtureControls(sdk).recorder.callsTo('records.read')).toHaveLength(1);
  });
});

const SALE_SELECTED: TypedTopic<{ readonly id: string }> = {
  ns: 'acme.sales',
  name: 'sale-selected',
};

describe('emit / on — thin, lifecycle-managed event wrappers', () => {
  test('on subscribes for the component lifetime; emit delivers; unmount unsubscribes', async () => {
    const sdk = createFixtureSDK({}, { capabilities: ['events:acme.sales'] });
    function Listener({ sdk }: { sdk: HostSDK }): ReactElement {
      const [last, setLast] = useState('none');
      on(sdk, SALE_SELECTED, (sale) => setLast(sale.id));
      return <p>{`last:${last}`}</p>;
    }
    const view = render(<Listener sdk={sdk} />);
    screen.getByText('last:none');

    act(() => {
      emit(sdk, SALE_SELECTED, { id: 's1' });
    });
    await screen.findByText('last:s1');

    const recorder = getFixtureControls(sdk).recorder;
    expect(recorder.callsTo('events.on')).toHaveLength(1);
    expect(recorder.callsTo('events.emit')).toHaveLength(1);

    // Unmount releases the subscription (belt-and-braces alongside the host's own
    // release on unmount, SPEC §3 rule 6).
    view.unmount();
    expect(recorder.callsTo('events.unsubscribe')).toHaveLength(1);
  });
});

describe('scopedFetch — 1:1 over sdk.net.fetch', () => {
  test('compiles to a single net.fetch and returns the fixture response', async () => {
    const sdk = createFixtureSDK(
      {
        net: [
          { match: { host: 'api.acme.com', path: '/v2/sales' }, response: { body: { total: 3 } } },
        ],
      },
      { capabilities: ['net:api.acme.com'] },
    );
    const res = await scopedFetch(sdk, { host: 'api.acme.com', path: '/v2/sales' });
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ total: 3 });

    const recorder = getFixtureControls(sdk).recorder;
    expect(recorder.callsTo('net.fetch')).toHaveLength(1);
    expect(recorder.last('net.fetch')?.args).toEqual([
      { host: 'api.acme.com', path: '/v2/sales' },
    ]);
  });
});
