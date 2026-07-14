import { expect, test } from 'vitest';

import * as conformance from '../../src/conformance/index.js';

// The host-conformance kit (docs/SPEC.md §5) lands in Phase B (issue #12); its
// tests will live in this directory (`test/conformance`, per SPEC §7). For now
// this asserts the kit's entry point is present so the scaffold's directory
// layout and `@gridmason/sdk/conformance` export stay wired end to end.
test('the conformance kit entry point is present', () => {
  expect(conformance).toBeTypeOf('object');
});
