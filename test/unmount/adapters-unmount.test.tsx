// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { effectScope } from 'vue';
import { afterEach, describe, expect, test } from 'vitest';

import { createFixtureSDK, getFixtureControls } from '../../src/fixture/index.js';
import type { FixtureSDK } from '../../src/fixture/index.js';
import type { HostSDK, TypedTopic } from '../../src/index.js';
import { subscribe } from '../../src/helpers/index.js';
import * as reactHelpers from '../../src/helpers/react/index.js';
import * as vueHelpers from '../../src/helpers/vue/index.js';
import * as vanillaHelpers from '../../src/helpers/vanilla/index.js';

/**
 * Issue #13 (FR-2, SPEC §3 rule 6), adapter wiring: a **framework unmount** must
 * trigger the widget-side release of every helper subscription for the handle.
 * Each adapter exposes the seam — React/Vue as `useInstanceCleanup`, vanilla as the
 * re-exported `releaseInstance` — and each frees an imperatively-registered
 * subscription (one that carries no per-subscription cleanup of its own) when the
 * framework tears the widget down.
 */

afterEach(cleanup);

const SALES: TypedTopic<{ readonly id: string }> = { ns: 'acme.sales', name: 'selected' };

/** A fixture handle whose bus a widget may subscribe to. */
function liveSdk(): FixtureSDK {
  return createFixtureSDK({}, { capabilities: ['events:acme.sales'] });
}

describe('React — useInstanceCleanup releases helper subscriptions on unmount', () => {
  function Widget({ sdk }: { sdk: HostSDK }): ReactElement {
    reactHelpers.useInstanceCleanup(sdk);
    useEffect(() => {
      // An imperative subscription with no manual cleanup: only the instance
      // cleanup seam frees it on unmount.
      subscribe(sdk, SALES, () => {});
    }, [sdk]);
    return <p>widget</p>;
  }

  test('a leaked subscription is released when the component unmounts', () => {
    const sdk = liveSdk();
    const view = render(<Widget sdk={sdk} />);
    const { recorder } = getFixtureControls(sdk);

    expect(recorder.callsTo('events.on')).toHaveLength(1);
    expect(recorder.callsTo('events.unsubscribe')).toHaveLength(0);

    view.unmount();
    expect(recorder.callsTo('events.unsubscribe')).toHaveLength(1);
  });
});

describe('Vue — useInstanceCleanup releases helper subscriptions on scope dispose', () => {
  test('a leaked subscription is released when the effect scope stops', () => {
    const sdk = liveSdk();
    const scope = effectScope();
    scope.run(() => {
      vueHelpers.useInstanceCleanup(sdk);
      subscribe(sdk, SALES, () => {});
    });
    const { recorder } = getFixtureControls(sdk);

    expect(recorder.callsTo('events.on')).toHaveLength(1);
    expect(recorder.callsTo('events.unsubscribe')).toHaveLength(0);

    scope.stop();
    expect(recorder.callsTo('events.unsubscribe')).toHaveLength(1);
  });
});

describe('vanilla — releaseInstance releases every subscription the widget opened', () => {
  test('the caller-driven teardown frees subscriptions made through on()', () => {
    const sdk = liveSdk();
    // The vanilla `on` is the caller-managed subscription; the widget opens two and
    // relies on the single releaseInstance teardown to free both.
    vanillaHelpers.on(sdk, SALES, () => {});
    vanillaHelpers.on(sdk, SALES, () => {});
    const { recorder } = getFixtureControls(sdk);

    expect(recorder.callsTo('events.on')).toHaveLength(2);
    expect(recorder.callsTo('events.unsubscribe')).toHaveLength(0);

    vanillaHelpers.releaseInstance(sdk);
    expect(recorder.callsTo('events.unsubscribe')).toHaveLength(2);
  });
});
