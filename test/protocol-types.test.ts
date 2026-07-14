import { describe, expect, expectTypeOf, test } from 'vitest';

import { CAPABILITY_APIS } from '@gridmason/protocol';
import type {
  Capability,
  CapabilityApi,
  ContextMap,
  RecordRefContextType,
  WidgetID,
} from '@gridmason/protocol';
// The shipped type-conformance vectors (protocol §6/§7): proving the SDK reads
// the same shapes protocol tests itself against.
import type { ContextVector } from '@gridmason/protocol/vectors';

import type { WidgetId } from '../src/protocol/index.js';

/**
 * Compile-time integration check (issue #3, FR-1). The `HostSDK` interface is
 * built in #5; these assertions stand in for it, proving `@gridmason/protocol`'s
 * published type vectors line up with the shapes that interface will consume —
 * `WidgetID {source,tag}`, the capability grammar, and the page-context type
 * grammar — with **no local redefinition** of any shared contract type.
 *
 * The `expectTypeOf(...).toEqualTypeOf(...)` assertions are enforced by
 * `npm run typecheck` (tsc over `test/`): a re-exported type drifting from the
 * one protocol publishes is a compile error, not a runtime one. One runtime
 * `expect` additionally pins the enumerated capability apis.
 */

describe('WidgetID / WidgetId (protocol §3.3)', () => {
  test('matches the SPEC §3 { source, tag } mount identity', () => {
    expectTypeOf<WidgetID>().toEqualTypeOf<{
      readonly source: string;
      readonly tag: string;
    }>();
  });

  test('the SDK WidgetId alias resolves to protocol WidgetID (no local copy)', () => {
    expectTypeOf<WidgetId>().toEqualTypeOf<WidgetID>();
  });
});

describe('capability grammar (protocol §3.1; SPEC §6)', () => {
  test('CapabilityApi is the union closed over CAPABILITY_APIS', () => {
    expectTypeOf<CapabilityApi>().toEqualTypeOf<
      (typeof CAPABILITY_APIS)[number]
    >();
  });

  test('Capability is { api, scope? } — consumed by every gated SDK call', () => {
    expectTypeOf<Capability>().toEqualTypeOf<{
      api: CapabilityApi;
      scope?: string;
    }>();
  });

  test('the v1 capability api enumeration is stable', () => {
    expect(CAPABILITY_APIS).toEqual([
      'records.read',
      'records.write',
      'net',
      'events',
    ]);
  });
});

describe('page-context type grammar (protocol §3.2)', () => {
  test('a record-ref slot carries a host-declared recordType', () => {
    expectTypeOf<RecordRefContextType>().toEqualTypeOf<{
      readonly type: 'record-ref';
      readonly recordType: string;
    }>();
  });

  test('protocol context vectors are keyed by the same ContextMap shape', () => {
    expectTypeOf<ContextVector['requires']>().toEqualTypeOf<ContextMap>();
    expectTypeOf<ContextVector['page']>().toEqualTypeOf<ContextMap>();
  });
});
