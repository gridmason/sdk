import { expect, test } from 'vitest';

import * as sdk from '../src/index.js';
import * as react from '../src/helpers/react/index.js';
import * as vue from '../src/helpers/vue/index.js';
import * as vanilla from '../src/helpers/vanilla/index.js';
import * as noop from '../src/noop/index.js';
import * as fixture from '../src/fixture/index.js';
import * as conformance from '../src/conformance/index.js';

// Scaffold smoke test (issue #2): proves the package barrel and every reserved
// subpath entry point (`.`, `./react`, `./vue`, `./vanilla`, `./noop`,
// `./fixture`, `./conformance`) is importable and builds, so a broken export
// wiring fails CI before publish. As the S-E1/S-E2 epics land, these modules
// begin exposing the real HostSDK interface, helpers, and conformance kit.
test.each([
  ['root', sdk],
  ['react', react],
  ['vue', vue],
  ['vanilla', vanilla],
  ['noop', noop],
  ['fixture', fixture],
  ['conformance', conformance],
])('the %s entry point is importable', (_name, mod) => {
  expect(mod).toBeTypeOf('object');
  expect(mod).not.toBeNull();
});
