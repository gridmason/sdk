import { describe, expect, test } from 'vitest';

import { attributeTelemetry, isInstanceGone } from '../../src/index.js';
import type { AttributedMark, WidgetError, WidgetID } from '../../src/index.js';
import { createNoopSDK, getNoopControls } from '../../src/noop/index.js';
import { useTelemetry as useTelemetryReact } from '../../src/helpers/react/index.js';
import { useTelemetry as useTelemetryVue } from '../../src/helpers/vue/index.js';
import { attributeTelemetry as attributeTelemetryVanilla } from '../../src/helpers/vanilla/index.js';

/**
 * Issue #17 (FR-1, SPEC §3 telemetry/identity, §2 audit trail): telemetry
 * attribution. The helper reads `sdk.identity` and stamps `instanceId` + `widgetId`
 * onto every mark/error before forwarding to `sdk.telemetry`, so a widget author
 * never hand-threads identity. Gates:
 *
 * - **marks carry identity** — a mark's attributed record carries the mount's
 *   `instanceId` + `widgetId`, and the bare `telemetry.mark(name, ms)` is forwarded;
 * - **errors carry identity** — the forwarded `WidgetError.detail` is stamped, and
 *   attribution wins over caller keys;
 * - **independent mounts** — two handles attribute to their own identities;
 * - **revoked handle** — a telemetry call on a stale handle throws `InstanceGone`
 *   (consistent with #13), never swallowed.
 */

const WIDGET = { source: 'acme', tag: 'sales-card' } as const;

function mountedSdk(instanceId: string, widgetId: WidgetID = WIDGET) {
  return createNoopSDK({ instanceId, widgetId });
}

describe('marks carry instanceId + widgetId', () => {
  test('mark returns the attributed record and forwards the bare mark', () => {
    const sdk = mountedSdk('inst-1');
    const telemetry = attributeTelemetry(sdk);

    const attributed: AttributedMark = telemetry.mark('first-paint', 12);

    expect(attributed).toEqual({
      instanceId: 'inst-1',
      widgetId: WIDGET,
      name: 'first-paint',
      ms: 12,
    });
    // The bare mark is forwarded 1:1 to the handle (the host attributes it to this
    // mount via the per-instance handle).
    const { recorder } = getNoopControls(sdk);
    expect(recorder.callsTo('telemetry.mark').map((c) => c.args)).toEqual([['first-paint', 12]]);
  });

  test('error stamps identity into detail and forwards it', () => {
    const sdk = mountedSdk('inst-1');
    const telemetry = attributeTelemetry(sdk);

    const report: WidgetError = { message: 'render failed', name: 'RangeError' };
    const attributed = telemetry.error(report);

    expect(attributed.instanceId).toBe('inst-1');
    expect(attributed.widgetId).toEqual(WIDGET);
    expect(attributed.error.detail).toEqual({ instanceId: 'inst-1', widgetId: WIDGET });

    const { recorder } = getNoopControls(sdk);
    const forwarded = recorder.last('telemetry.error')?.args[0] as WidgetError;
    expect(forwarded.message).toBe('render failed');
    expect(forwarded.name).toBe('RangeError');
    expect(forwarded.detail).toEqual({ instanceId: 'inst-1', widgetId: WIDGET });
    // The caller's report object is not mutated — a copy is forwarded.
    expect(report.detail).toBeUndefined();
  });

  test('error attribution wins over caller-supplied detail keys, preserving others', () => {
    const sdk = mountedSdk('inst-1');
    const telemetry = attributeTelemetry(sdk);

    const attributed = telemetry.error({
      message: 'boom',
      detail: { instanceId: 'forged', widgetId: { source: 'x', tag: 'y' }, code: 'E_BOOM' },
    });

    expect(attributed.error.detail).toEqual({
      instanceId: 'inst-1',
      widgetId: WIDGET,
      code: 'E_BOOM',
    });
  });
});

describe('two mounts attribute independently', () => {
  test('distinct handles stamp their own identities', () => {
    const a = mountedSdk('inst-a', { source: 'acme', tag: 'a' });
    const b = mountedSdk('inst-b', { source: 'acme', tag: 'b' });

    const markA = attributeTelemetry(a).mark('load', 5);
    const markB = attributeTelemetry(b).mark('load', 9);

    expect(markA).toEqual({ instanceId: 'inst-a', widgetId: { source: 'acme', tag: 'a' }, name: 'load', ms: 5 });
    expect(markB).toEqual({ instanceId: 'inst-b', widgetId: { source: 'acme', tag: 'b' }, name: 'load', ms: 9 });

    // Each handle recorded only its own mark — no cross-contamination.
    expect(getNoopControls(a).recorder.callsTo('telemetry.mark').map((c) => c.args)).toEqual([['load', 5]]);
    expect(getNoopControls(b).recorder.callsTo('telemetry.mark').map((c) => c.args)).toEqual([['load', 9]]);
  });
});

describe('time() measures latency and attributes it', () => {
  test('sync op: marks elapsed under name and returns the result', () => {
    const sdk = mountedSdk('inst-1');
    const telemetry = attributeTelemetry(sdk);

    const result = telemetry.time('compute', () => 6 * 7);

    expect(result).toBe(42);
    const mark = getNoopControls(sdk).recorder.last('telemetry.mark');
    expect(mark?.args[0]).toBe('compute');
    expect(typeof mark?.args[1]).toBe('number');
    expect(mark?.args[1] as number).toBeGreaterThanOrEqual(0);
  });

  test('async op: marks only after the promise settles, returns the resolved value', async () => {
    const sdk = mountedSdk('inst-1');
    const telemetry = attributeTelemetry(sdk);
    const { recorder } = getNoopControls(sdk);

    const pending = telemetry.time('load', () => Promise.resolve('rows'));
    // Not marked while the op is still pending.
    expect(recorder.callsTo('telemetry.mark')).toHaveLength(0);

    const value = await pending;
    expect(value).toBe('rows');
    expect(recorder.callsTo('telemetry.mark').map((c) => c.args[0])).toEqual(['load']);
  });

  test('op that throws: records latency-to-failure and re-throws the original error', () => {
    const sdk = mountedSdk('inst-1');
    const telemetry = attributeTelemetry(sdk);
    const boom = new Error('kaboom');

    expect(() =>
      telemetry.time('render', () => {
        throw boom;
      }),
    ).toThrow(boom);
    expect(getNoopControls(sdk).recorder.last('telemetry.mark')?.args[0]).toBe('render');
  });

  test('async op that rejects: marks then re-rejects with the original reason', async () => {
    const sdk = mountedSdk('inst-1');
    const telemetry = attributeTelemetry(sdk);
    const boom = new Error('async-kaboom');

    await expect(telemetry.time('load', () => Promise.reject(boom))).rejects.toBe(boom);
    expect(getNoopControls(sdk).recorder.last('telemetry.mark')?.args[0]).toBe('load');
  });

  // #45 batch review: when the op ALREADY threw/rejected and the handle is also
  // revoked, the latency `mark` throws `InstanceGone` — which must NOT replace the
  // widget's original error. The original wins; the InstanceGone is preserved as
  // `cause` rather than silently dropped. (Happy-path revoked semantics — op
  // succeeds → InstanceGone throws, #13 — are unchanged; asserted below.)
  test('sync op throws + revoked handle: original error propagates, InstanceGone attached as cause', () => {
    const sdk = mountedSdk('inst-1');
    const telemetry = attributeTelemetry(sdk);
    getNoopControls(sdk).unmount();
    const boom = new Error('render-boom');

    let thrown: unknown;
    try {
      telemetry.time('render', () => {
        throw boom;
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(boom);
    expect(isInstanceGone((thrown as Error).cause)).toBe(true);
  });

  test('async op rejects + revoked handle: original reason propagates, InstanceGone attached as cause', async () => {
    const sdk = mountedSdk('inst-1');
    const telemetry = attributeTelemetry(sdk);
    getNoopControls(sdk).unmount();
    const boom = new Error('load-boom');

    let thrown: unknown;
    try {
      await telemetry.time('load', () => Promise.reject(boom));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(boom);
    expect(isInstanceGone((thrown as Error).cause)).toBe(true);
  });

  test('op SUCCEEDS + revoked handle: InstanceGone still surfaces from the mark (#13 unchanged)', () => {
    const sdk = mountedSdk('inst-1');
    const telemetry = attributeTelemetry(sdk);
    getNoopControls(sdk).unmount();

    let thrown: unknown;
    try {
      telemetry.time('compute', () => 6 * 7);
    } catch (e) {
      thrown = e;
    }
    expect(isInstanceGone(thrown)).toBe(true);
  });
});

describe('revoked handle: telemetry throws InstanceGone (SPEC §3 rule 6, #13)', () => {
  test('mark and error throw a typed InstanceGone after unmount', () => {
    const sdk = mountedSdk('inst-1');
    const telemetry = attributeTelemetry(sdk);
    getNoopControls(sdk).unmount();

    let markErr: unknown;
    try {
      telemetry.mark('load', 1);
    } catch (e) {
      markErr = e;
    }
    expect(isInstanceGone(markErr)).toBe(true);

    let errorErr: unknown;
    try {
      telemetry.error({ message: 'x' });
    } catch (e) {
      errorErr = e;
    }
    expect(isInstanceGone(errorErr)).toBe(true);
  });
});

describe('facade identity and cross-adapter re-exports', () => {
  test('the facade is stable per handle', () => {
    const sdk = mountedSdk('inst-1');
    expect(attributeTelemetry(sdk)).toBe(attributeTelemetry(sdk));
  });

  test('react/vue useTelemetry and the vanilla re-export return the same core facade', () => {
    const sdk = mountedSdk('inst-1');
    const core = attributeTelemetry(sdk);
    expect(useTelemetryReact(sdk)).toBe(core);
    expect(useTelemetryVue(sdk)).toBe(core);
    expect(attributeTelemetryVanilla(sdk)).toBe(core);
  });
});
