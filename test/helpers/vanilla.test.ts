import { describe, expect, test } from 'vitest';

import { createFixtureSDK, getFixtureControls } from '../../src/fixture/index.js';
import { isPermissionDenied } from '../../src/index.js';
import { getRecord } from '../../src/helpers/vanilla/index.js';

/**
 * Vanilla-specific surface not reached by the parity matrix, which drives record
 * reads through `watchRecord`: the one-shot `getRecord` promise. Its subscribe-style
 * sibling, the settings binding, and `on` are all covered by `test/parity`.
 */
const CUSTOMER = { recordType: 'customer', id: 'c1' } as const;
const SECRET = { recordType: 'secret', id: 's1' } as const;

const FIXTURES = {
  records: {
    read: [
      { ref: CUSTOMER, fields: { name: 'Acme' } },
      { ref: SECRET, fields: { key: 'top-secret' } },
    ],
  },
};

describe('getRecord — one-shot imperative read', () => {
  test('resolves the fixture record through exactly one sdk.records.read', async () => {
    const sdk = createFixtureSDK(FIXTURES, {
      capabilities: ['records.read:recordType:customer'],
    });
    const record = await getRecord(sdk, CUSTOMER);
    expect(record).toEqual({ ref: CUSTOMER, fields: { name: 'Acme' } });
    expect(getFixtureControls(sdk).recorder.callsTo('records.read')).toHaveLength(1);
  });

  test('two reads of the same ref share one sdk.records.read (documented dedup)', async () => {
    const sdk = createFixtureSDK(FIXTURES, {
      capabilities: ['records.read:recordType:customer'],
    });
    const [a, b] = await Promise.all([getRecord(sdk, CUSTOMER), getRecord(sdk, CUSTOMER)]);
    expect(a).toEqual(b);
    expect(getFixtureControls(sdk).recorder.callsTo('records.read')).toHaveLength(1);
  });

  test('rejects with PermissionDenied for an undeclared capability, never fixture data', async () => {
    const sdk = createFixtureSDK(FIXTURES, {
      capabilities: ['records.read:recordType:customer'],
    });
    await expect(getRecord(sdk, SECRET)).rejects.toSatisfy(isPermissionDenied);
    expect(getFixtureControls(sdk).recorder.last('records.read')?.meta).toMatchObject({
      outcome: 'denied',
    });
  });
});
