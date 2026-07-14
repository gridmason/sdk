/**
 * The per-instance lifecycle the dev `HostSDK` implementations share to make
 * SPEC §3 rule 6 hold mechanically (docs/SPEC.md §2, §3 rule 6). A mount holds
 * one {@link InstanceLifecycle}; its out-of-band `unmount` control ({@link NoopControls.unmount},
 * {@link import('../fixture/index.js').FixtureControls.unmount}) calls {@link InstanceLifecycle.revoke},
 * which:
 *
 * 1. **Revokes the per-instance token** — after revoke, every gated handle call
 *    ({@link InstanceLifecycle.assertLive} for sync members, an
 *    {@link InstanceLifecycle.revoked}/{@link InstanceLifecycle.gone} check for
 *    async ones) fails with a typed {@link import('../interface/index.js').InstanceGone}
 *    rather than hanging or returning data (SPEC §2: the token is minted at mount
 *    and revoked at unmount).
 * 2. **Auto-unsubscribes** — every `events.on` subscription registered through the
 *    handle records its release via {@link InstanceLifecycle.onRevoke}, so revoke
 *    releases them all and no subscriber survives the mount that created it.
 *
 * This mirrors what a conforming host does out-of-band (the {@link import('../conformance/types.js').Mount}
 * seam the conformance kit drives): the dev handles are self-contained host+SDK,
 * so they own the revocation the kit's rule-6 check asserts against an arbitrary
 * host. The lifecycle lives with the no-op (the base dev impl) because the fixture
 * impl layers on it and reuses this exact primitive.
 */

import { InstanceGone } from '../interface/index.js';

/**
 * A revocable per-mount lifecycle: a revocation flag plus a set of teardowns run
 * on revoke. Created once per dev handle ({@link createInstanceLifecycle}); the
 * gated members consult it on every call and the `events.on` seam registers its
 * unsubscribe with it.
 */
export interface InstanceLifecycle {
  /** The mount this lifecycle governs — the `instanceId` an {@link InstanceGone} carries. */
  readonly instanceId: string;
  /** `true` once {@link revoke} has run (the handle is unmounted/stale). */
  readonly revoked: boolean;
  /**
   * A fresh typed {@link InstanceGone} for this instance — the rejection an async
   * stale call resolves to, or the throw a sync one raises.
   */
  gone(): InstanceGone;
  /**
   * Throw {@link InstanceGone} if the handle is revoked; a no-op while live. The
   * guard a **synchronous** gated member (`events.emit`/`on`, `settings.get`, …)
   * runs before doing any work.
   */
  assertLive(): void;
  /**
   * Register `release` to run when the handle is revoked; returns a function that
   * deregisters it (called by a subscription's own {@link import('../interface/index.js').Unsubscribe}
   * so a manual unsubscribe is not re-run on revoke). If the handle is *already*
   * revoked, `release` runs immediately and the returned deregister is a no-op.
   */
  onRevoke(release: () => void): () => void;
  /**
   * Revoke the per-instance token and run every registered teardown, in
   * registration order. Idempotent — a second call is a no-op (so `unmount()`
   * twice is safe).
   */
  revoke(): void;
}

/**
 * Create an {@link InstanceLifecycle} for the mount `instanceId`. Starts live
 * (not revoked) with no teardowns; {@link InstanceLifecycle.revoke} flips it and
 * releases everything registered through {@link InstanceLifecycle.onRevoke}.
 */
export function createInstanceLifecycle(instanceId: string): InstanceLifecycle {
  const releases = new Set<() => void>();
  let revoked = false;

  return {
    instanceId,
    get revoked() {
      return revoked;
    },
    gone() {
      return new InstanceGone({ instanceId });
    },
    assertLive() {
      if (revoked) throw new InstanceGone({ instanceId });
    },
    onRevoke(release) {
      if (revoked) {
        release();
        return () => {};
      }
      releases.add(release);
      return () => {
        releases.delete(release);
      };
    },
    revoke() {
      if (revoked) return;
      // Flip the flag before running teardowns so anything a teardown touches
      // already sees the handle as revoked.
      revoked = true;
      // Snapshot then clear: a teardown deregisters itself (a no-op on the empty
      // set), and the snapshot avoids mutating the set mid-iteration.
      const snapshot = [...releases];
      releases.clear();
      for (const release of snapshot) release();
    },
  };
}
