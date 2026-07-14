import { describe, expect, test } from 'vitest';
import { effectScope } from 'vue';

import { createFixtureSDK, getFixtureControls } from '../../src/fixture/index.js';
import { PermissionDenied } from '../../src/index.js';
import type { TypedTopic } from '../../src/index.js';
import { emit, releaseInstance, subscribe } from '../../src/helpers/index.js';
import * as reactHelpers from '../../src/helpers/react/index.js';
import * as vanillaHelpers from '../../src/helpers/vanilla/index.js';
import * as vueHelpers from '../../src/helpers/vue/index.js';

/**
 * `events:<ns>` capability gating end to end through the widget-side helpers (issue
 * #16, FR-2 / SPEC §3 rule 4, §6). The parity matrix (`test/parity`) covers the
 * *allowed* path — subscribe, receive every emission, tear down; this suite covers
 * the *denied* path the rule turns on: a widget can only `emit`/`on` a topic whose
 * namespace its `events:<ns>` capability covers, and an out-of-namespace call is a
 * typed `PermissionDenied` — never a silent no-op, never a delivered event, never a
 * tracked subscription.
 *
 * The helpers hold no capability logic themselves (they are 1:1 forwards over the
 * host handle, SPEC §4); the enforcement lives in the host and the helpers must
 * carry the denial through faithfully. These tests drive a fixture handle that
 * declares only `events:acme.sales` and prove the denial flows through the shared
 * core (`emit`/`subscribe`) and each of the three adapters that re-export it.
 */

interface Sale {
  readonly id: string;
}

/** A topic in the granted namespace. */
const GRANTED: TypedTopic<Sale> = { ns: 'acme.sales', name: 'selected' };
/** A topic of the *same name* in a namespace the widget never declared. */
const UNGRANTED: TypedTopic<Sale> = { ns: 'secret.ops', name: 'selected' };

/** A fixture handle declaring only the `acme.sales` events namespace. */
function grantedSdk() {
  return createFixtureSDK({}, { capabilities: ['events:acme.sales'] });
}

describe('events:<ns> gating through the helper core', () => {
  test('subscribe on an ungranted namespace throws PermissionDenied and tracks no subscription', () => {
    const sdk = grantedSdk();
    expect(() => subscribe(sdk, UNGRANTED, () => undefined)).toThrow(PermissionDenied);

    const recorder = getFixtureControls(sdk).recorder;
    expect(recorder.last('events.on')?.meta).toEqual({
      outcome: 'denied',
      capability: { api: 'events', scope: 'secret.ops' },
    });
    // The denied subscription never entered the per-handle registry: a full
    // instance release drains nothing (no phantom unsubscribe to record).
    releaseInstance(sdk);
    expect(recorder.callsTo('events.unsubscribe')).toHaveLength(0);
  });

  test('emit on an ungranted namespace throws PermissionDenied and delivers to no one', () => {
    const sdk = grantedSdk();
    const received: Sale[] = [];
    // A legitimately-subscribed handler in the granted namespace, same topic *name*
    // as the ungranted emit below — a name-only bus would leak to it.
    subscribe(sdk, GRANTED, (p) => received.push(p));

    expect(() => emit(sdk, UNGRANTED, { id: 'leaked' })).toThrow(PermissionDenied);
    expect(received).toEqual([]); // the denied emit reached nobody — never a delivered event

    // Sanity: a granted emit on the same name still routes correctly, so the empty
    // result above is the denial doing its job, not a dead bus.
    emit(sdk, GRANTED, { id: 's1' });
    expect(received).toEqual([{ id: 's1' }]);
  });
});

describe('events:<ns> gating through each adapter (all three funnel to the gated core)', () => {
  test('vanilla `on` denies an ungranted namespace', () => {
    const sdk = grantedSdk();
    expect(() => vanillaHelpers.on(sdk, UNGRANTED, () => undefined)).toThrow(PermissionDenied);
  });

  test('vue `on` denies an ungranted namespace (throws out of setup)', () => {
    const sdk = grantedSdk();
    const scope = effectScope();
    expect(() => scope.run(() => vueHelpers.on(sdk, UNGRANTED, () => undefined))).toThrow(
      PermissionDenied,
    );
    scope.stop();
  });

  test('the shared `emit` wrapper each adapter re-exports denies an ungranted namespace', () => {
    const sdk = grantedSdk();
    expect(() => reactHelpers.emit(sdk, UNGRANTED, { id: 'x' })).toThrow(PermissionDenied);
    expect(() => vueHelpers.emit(sdk, UNGRANTED, { id: 'x' })).toThrow(PermissionDenied);
    expect(() => vanillaHelpers.emit(sdk, UNGRANTED, { id: 'x' })).toThrow(PermissionDenied);
  });
});
