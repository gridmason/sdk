/**
 * The host-conformance test kit (docs/SPEC.md §5): import it, pass your
 * {@link ConformanceHost} adapter, and it asserts every SPEC §3 contract rule —
 * capability intersection before transport with typed denial (rule 1), net-host
 * scoping (rule 2), per-instance remote-identity binding (rule 3), typed,
 * namespaced, capability-gated events (rule 4), per-instance isolation (rule 5),
 * and unmount revocation + auto-unsubscribe + typed `InstanceGone` (rule 6).
 * **Passing the suite is the definition of "a valid Gridmason host."**
 *
 * Published at `@gridmason/sdk/conformance` so the dashboard's reference host and
 * every product shell run the *same* kit in their own CI (mirrors how
 * `@gridmason/protocol/vectors` distributes the type-conformance vectors).
 *
 * ## Two entrypoints
 *
 * - {@link runHostConformance} — the **vitest** binding. Call it at the top level
 *   of a test file; it registers one `test` per rule inside a `describe`. This is
 *   the intended way a host runs the kit, so importing this subpath expects
 *   `vitest` to be present in the consumer's dev environment (it is — the
 *   consumer is writing vitest tests):
 *
 *   ```ts
 *   import { runHostConformance } from '@gridmason/sdk/conformance';
 *   import { createHost } from '../src/host.js';
 *
 *   runHostConformance({
 *     name: 'dashboard reference host',
 *     mount: (req) => createHost(req),
 *   });
 *   ```
 *
 * - {@link conformanceChecks} / {@link runConformanceChecks} — the **framework-free**
 *   surface. The same six checks as plain async functions, for a consumer
 *   embedding the kit outside vitest, or for a fixture that drives one rule at a
 *   time (the acceptance-gate test does exactly this).
 *
 * ## What a consumer implements
 *
 * A {@link ConformanceHost} is a thin test seam over the real host: `mount(req)`
 * stands up one widget instance with the requested `min(user, widget)` capability
 * grant and returns the live {@link HostSDK} handle plus the two observations the
 * interface cannot surface — the stamped remote identity (rule 3) and an
 * `unmount` that revokes the handle (rule 6). The kit is otherwise host-agnostic:
 * it asserts the *interface* contract, never one implementation.
 */

import { describe, test } from 'vitest';

import { conformanceChecks } from './checks.js';
import type { ConformanceHost } from './types.js';

export * from './types.js';
export { conformanceChecks, runConformanceChecks } from './checks.js';
export type { ConformanceResult } from './checks.js';

/** Options for {@link runHostConformance}. */
export interface RunHostConformanceOptions {
  /**
   * A label for the `describe` block. Defaults to the host's `name`, then to
   * `HostSDK`. Use it to distinguish several hosts run in one suite.
   */
  readonly label?: string;
}

/**
 * Register the full host-conformance suite as `vitest` tests — one `test` per
 * SPEC §3 rule inside a `describe`. Call at the top level of a test file so the
 * checks are collected synchronously:
 *
 * ```ts
 * import { runHostConformance } from '@gridmason/sdk/conformance';
 * runHostConformance({ name: 'my host', mount: (req) => mountMyHost(req) });
 * ```
 *
 * Each rule that the host violates fails its own test with a
 * {@link ConformanceViolation} describing the observed behavior; a conforming
 * host passes all six.
 */
export function runHostConformance(
  host: ConformanceHost,
  options: RunHostConformanceOptions = {},
): void {
  const label = options.label ?? host.name ?? 'HostSDK';
  describe(`Gridmason host conformance — ${label}`, () => {
    for (const check of conformanceChecks) {
      test(check.title, async () => {
        await check.run(host);
      });
    }
  });
}
