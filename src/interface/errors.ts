/**
 * The typed error surface of the host-SDK boundary (docs/SPEC.md §3, contract
 * rules 1 and 6).
 *
 * A capability chokepoint fails *loudly and typed* — never with an empty result
 * that a widget could mistake for "no data" (that would leak whether a record
 * exists past a permission it lacks). Two failure modes cross the boundary:
 *
 * - {@link PermissionDenied} — the call failed the `min(user, declared-widget)`
 *   capability check *before* transport (rule 1). It is thrown/rejected in place
 *   of the value, so a denied `records.read` rejects rather than resolving to
 *   `undefined`/`[]`.
 * - {@link InstanceGone} — the handle is stale: the widget was unmounted, its
 *   per-instance token revoked, and a call arrived on the dead handle (rule 6).
 *   It rejects rather than hanging or silently resolving.
 *
 * These classes are part of the package's public surface because the dev
 * implementations (`createNoopSDK`/`createFixtureSDK`, issues #6/#7) throw them
 * and the host-conformance kit (S-E2) asserts a conforming host produces them.
 * This module declares the types and their construction only — no enforcement
 * logic lives here.
 *
 * ## `instanceof` across ESM realms
 *
 * `instanceof` is only reliable when the checker and the thrower share one copy
 * of this module. A host that bundles `@gridmason/sdk` separately from a widget
 * (two realms, two class identities) can make `err instanceof PermissionDenied`
 * return `false` for a genuine denial. Two mitigations ship here:
 *
 * 1. Each class pins its prototype (`Object.setPrototypeOf`) and its `name`, so
 *    `instanceof` and stack traces are correct within a single realm even under
 *    down-level transpilation.
 * 2. Each carries a stable string {@link SdkErrorCode} discriminant, and the
 *    exported {@link isPermissionDenied} / {@link isInstanceGone} guards test
 *    *that* rather than class identity — the realm-safe check. Prefer the guards
 *    at the boundary; reserve `instanceof` for same-realm code.
 */

import { formatCapability } from '@gridmason/protocol';
import type { Capability } from '@gridmason/protocol';

/**
 * Stable, realm-independent discriminant carried by every SDK boundary error.
 * The {@link isPermissionDenied} / {@link isInstanceGone} guards match on this,
 * so a duplicated module copy (distinct class identity) does not defeat the
 * check the way `instanceof` can.
 */
export type SdkErrorCode = 'PERMISSION_DENIED' | 'INSTANCE_GONE';

/** Named arguments for constructing a {@link PermissionDenied}. */
export interface PermissionDeniedInit {
  /**
   * The capability the call required and was **not** granted — the intersection
   * `min(user, declared-widget)` did not contain it (docs/SPEC.md §3 rule 1).
   */
  readonly capability: Capability;
  /** The mount whose handle made the denied call (docs/SPEC.md §3 rule 5). */
  readonly instanceId: string;
  /** Overrides the default, capability-derived message. */
  readonly message?: string;
}

/**
 * A capability-gated call (`records.read/query/write`, `net.fetch`, an `events`
 * subscription to a gated namespace) failed the `min(user, declared-widget)`
 * check *before* transport (docs/SPEC.md §3 rule 1). The call rejects with this
 * — it never resolves to an empty/default value, so a widget cannot infer the
 * existence of data behind a permission it lacks (no capability leakage,
 * SPEC §2).
 */
export class PermissionDenied extends Error {
  override readonly name = 'PermissionDenied';
  /** Realm-safe discriminant; see {@link isPermissionDenied}. */
  readonly code: SdkErrorCode = 'PERMISSION_DENIED';
  /** The required-but-ungranted capability (`<api>[:<scope>]`). */
  readonly capability: Capability;
  /** The mount whose handle made the denied call. */
  readonly instanceId: string;

  constructor(init: PermissionDeniedInit) {
    super(
      init.message ??
        `permission denied: capability "${formatCapability(init.capability)}" is not granted to instance ${init.instanceId}`,
    );
    // Restore the prototype so `instanceof` and the class `name` survive
    // down-level transpilation within this realm (see module doc).
    Object.setPrototypeOf(this, PermissionDenied.prototype);
    this.capability = init.capability;
    this.instanceId = init.instanceId;
  }
}

/** Named arguments for constructing an {@link InstanceGone}. */
export interface InstanceGoneInit {
  /** The unmounted mount whose stale handle was called. */
  readonly instanceId: string;
  /** Overrides the default message. */
  readonly message?: string;
}

/**
 * A call arrived on a **stale** handle: the widget was unmounted, the host
 * revoked its per-instance token, and every `events` subscription registered
 * through the handle was released (docs/SPEC.md §3 rule 6). The call rejects
 * with this rather than hanging or returning data — a use-after-unmount is a bug
 * in the widget, surfaced as a typed error the host and conformance kit assert.
 */
export class InstanceGone extends Error {
  override readonly name = 'InstanceGone';
  /** Realm-safe discriminant; see {@link isInstanceGone}. */
  readonly code: SdkErrorCode = 'INSTANCE_GONE';
  /** The unmounted mount whose stale handle was called. */
  readonly instanceId: string;

  constructor(init: InstanceGoneInit) {
    super(
      init.message ??
        `instance ${init.instanceId} is gone: this handle was revoked on unmount and can no longer be used`,
    );
    Object.setPrototypeOf(this, InstanceGone.prototype);
    this.instanceId = init.instanceId;
  }
}

/**
 * Realm-safe {@link PermissionDenied} guard. Prefer this over `instanceof` at a
 * boundary a widget's module may cross (see module doc): it matches the stable
 * {@link SdkErrorCode} discriminant, which a duplicated module copy preserves.
 */
export function isPermissionDenied(e: unknown): e is PermissionDenied {
  return (
    e instanceof Error &&
    (e as { code?: unknown }).code === ('PERMISSION_DENIED' satisfies SdkErrorCode)
  );
}

/**
 * Realm-safe {@link InstanceGone} guard. Prefer this over `instanceof` at a
 * boundary a widget's module may cross (see module doc).
 */
export function isInstanceGone(e: unknown): e is InstanceGone {
  return (
    e instanceof Error &&
    (e as { code?: unknown }).code === ('INSTANCE_GONE' satisfies SdkErrorCode)
  );
}
