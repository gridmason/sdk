import { describe, expect, expectTypeOf, test } from 'vitest';

import { CAPABILITY_APIS, matchesContextMap } from '@gridmason/protocol';
import type {
  Capability,
  CapabilityApi,
  ContextMap,
  ContextValue,
  ObjectValue,
  PageContext,
  RecordRefContextType,
  RecordRefValue,
  WidgetID,
} from '@gridmason/protocol';
// The shipped conformance vectors (protocol §6/§7): proving the SDK reads the
// same shapes — and, for the runtime value relation, the same helper — protocol
// tests itself against.
import { contextValueVectors } from '@gridmason/protocol/vectors';
import type { ContextValueVector, ContextVector } from '@gridmason/protocol/vectors';

import type {
  ContextValue as SdkContextValue,
  ObjectValue as SdkObjectValue,
  PageContext as SdkPageContext,
  RecordRefValue as SdkRecordRefValue,
  WidgetId,
} from '../src/protocol/index.js';

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

describe('page-context value type (protocol §3.2; SPEC §3 HostSDK.context)', () => {
  test('a record-ref value carries the slot recordType plus the record id', () => {
    expectTypeOf<RecordRefValue>().toEqualTypeOf<{
      readonly recordType: string;
      readonly id: string;
    }>();
  });

  test('ContextValue is the union of a record-ref, scalars, a list, and an object', () => {
    expectTypeOf<ContextValue>().toEqualTypeOf<
      | RecordRefValue
      | string
      | number
      | boolean
      | readonly ContextValue[]
      | ObjectValue
    >();
  });

  test("PageContext maps slot names to ContextValues — HostSDK.context's type", () => {
    expectTypeOf<PageContext>().toEqualTypeOf<{
      readonly [key: string]: ContextValue;
    }>();
    expectTypeOf<ObjectValue>().toEqualTypeOf<{
      readonly [field: string]: ContextValue;
    }>();
  });

  test('the SDK re-exports resolve to protocol value types (no local copy)', () => {
    expectTypeOf<SdkPageContext>().toEqualTypeOf<PageContext>();
    expectTypeOf<SdkContextValue>().toEqualTypeOf<ContextValue>();
    expectTypeOf<SdkRecordRefValue>().toEqualTypeOf<RecordRefValue>();
    expectTypeOf<SdkObjectValue>().toEqualTypeOf<ObjectValue>();
  });

  test('protocol value-conformance vectors are keyed by PageContext / ContextMap', () => {
    expectTypeOf<ContextValueVector['context']>().toEqualTypeOf<PageContext>();
    expectTypeOf<ContextValueVector['contextMap']>().toEqualTypeOf<ContextMap>();
  });

  test('a PageContext value validates against its ContextMap via the shipped helper', () => {
    // Runtime pin: the value type the SDK exposes is exactly the one protocol
    // validates — every shipped vector's `matches` reproduces here.
    expect(contextValueVectors.length).toBeGreaterThan(0);
    for (const vector of contextValueVectors) {
      expect(matchesContextMap(vector.context, vector.contextMap)).toBe(vector.matches);
    }
  });
});
