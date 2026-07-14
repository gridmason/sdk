import { describe, expect, expectTypeOf, test } from 'vitest';

import type { PageContext, WidgetID } from '@gridmason/protocol';

// Everything under test resolves through the package root barrel — proving the
// `HostSDK` interface and the error surface are surfaced from `@gridmason/sdk`
// itself (issue #5 deliverable 6), not only from the deep path.
import {
  InstanceGone,
  PermissionDenied,
  isInstanceGone,
  isPermissionDenied,
} from '../src/index.js';
import type {
  HostSDK,
  RecordData,
  ScopedResponse,
  Unsubscribe,
} from '../src/index.js';

/**
 * Issue #5 (FR-1/FR-2): the `HostSDK` interface + typed error surface. The
 * interface is types-only, so its assertions are compile-time (`expectTypeOf`,
 * enforced by `npm run typecheck`); the error classes are runtime, so they get
 * behavioral tests — construction, typed fields, and the realm-safe guards the
 * dev impls (#6/#7) and the conformance kit (S-E2) depend on.
 */

describe('HostSDK interface shape (SPEC §3, compile-time)', () => {
  test('context is the protocol page-context value type (protocol#37, 0.0.3)', () => {
    expectTypeOf<HostSDK['context']>().toEqualTypeOf<PageContext>();
  });

  test('identity.widgetId resolves to protocol WidgetID (no local copy)', () => {
    expectTypeOf<HostSDK['identity']['widgetId']>().toEqualTypeOf<WidgetID>();
    expectTypeOf<HostSDK['identity']['instanceId']>().toEqualTypeOf<string>();
  });

  test('records access is async and returns the SDK record value type', () => {
    expectTypeOf<
      ReturnType<HostSDK['records']['read']>
    >().toEqualTypeOf<Promise<RecordData>>();
    expectTypeOf<
      ReturnType<HostSDK['records']['query']>
    >().toEqualTypeOf<Promise<RecordData[]>>();
  });

  test('net.fetch returns the DOM-free ScopedResponse, and on() yields Unsubscribe', () => {
    expectTypeOf<
      ReturnType<HostSDK['net']['fetch']>
    >().toEqualTypeOf<Promise<ScopedResponse>>();
    expectTypeOf<
      ReturnType<HostSDK['events']['on']>
    >().toEqualTypeOf<Unsubscribe>();
  });
});

describe('PermissionDenied (SPEC §3 rule 1)', () => {
  test('captures the required capability + instanceId and is an Error', () => {
    const err = new PermissionDenied({
      capability: { api: 'records.read', scope: 'customer' },
      instanceId: 'inst-1',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PermissionDenied);
    expect(err.name).toBe('PermissionDenied');
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.capability).toEqual({ api: 'records.read', scope: 'customer' });
    expect(err.instanceId).toBe('inst-1');
    // Default message names the capability in its canonical `<api>:<scope>` form.
    expect(err.message).toContain('records.read:customer');
  });

  test('accepts a message override', () => {
    const err = new PermissionDenied({
      capability: { api: 'net', scope: 'api.acme.com' },
      instanceId: 'inst-2',
      message: 'nope',
    });
    expect(err.message).toBe('nope');
  });
});

describe('InstanceGone (SPEC §3 rule 6)', () => {
  test('captures the instanceId and is an Error', () => {
    const err = new InstanceGone({ instanceId: 'inst-3' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(InstanceGone);
    expect(err.name).toBe('InstanceGone');
    expect(err.code).toBe('INSTANCE_GONE');
    expect(err.instanceId).toBe('inst-3');
  });
});

describe('realm-safe guards', () => {
  test('match their own error by the code discriminant', () => {
    const denied = new PermissionDenied({
      capability: { api: 'events', scope: 'acme.sales' },
      instanceId: 'inst-4',
    });
    const gone = new InstanceGone({ instanceId: 'inst-4' });

    expect(isPermissionDenied(denied)).toBe(true);
    expect(isInstanceGone(gone)).toBe(true);
  });

  test('do not match the other error, a plain Error, or a non-error', () => {
    const gone = new InstanceGone({ instanceId: 'inst-5' });

    expect(isPermissionDenied(gone)).toBe(false);
    expect(isInstanceGone(new Error('boom'))).toBe(false);
    expect(isPermissionDenied(undefined)).toBe(false);
    expect(isPermissionDenied({ code: 'PERMISSION_DENIED' })).toBe(false);
  });

  test('match a duplicated (cross-realm) copy by code where instanceof fails', () => {
    // Simulate a second module copy: same shape + discriminant, distinct class
    // identity. `instanceof` fails across realms; the guard must not.
    const foreign = Object.assign(new Error('permission denied'), {
      name: 'PermissionDenied',
      code: 'PERMISSION_DENIED',
    });
    expect(foreign).not.toBeInstanceOf(PermissionDenied);
    expect(isPermissionDenied(foreign)).toBe(true);
  });
});
