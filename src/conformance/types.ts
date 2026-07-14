/**
 * The adapter contract the host-conformance kit drives (docs/SPEC.md §5).
 *
 * The kit is **host-agnostic**: it asserts the six SPEC §3 contract rules
 * against the {@link HostSDK} *interface*, never against one implementation. A
 * consumer (the dashboard reference host, a product shell) supplies a
 * {@link ConformanceHost} — a thin test seam that mounts a widget with a given
 * capability grant and returns the live handle plus the two things the interface
 * cannot expose on its own: the remote-identity the host bound to the last
 * outbound call (rule 3) and an `unmount` that revokes the handle (rule 6).
 *
 * Everything here is **types only** — the checks that consume them live in
 * `./checks.ts`, and the vitest entrypoint in `./index.ts`.
 */

import type { HostSDK } from '../interface/index.js';
import type { Capability, PageContext, WidgetId } from '../protocol/index.js';

/**
 * A request to mount one widget instance for a single conformance scenario. The
 * kit chooses the capability sets so it can drive a call to the allowed *and*
 * denied side of each rule; a conforming host enforces the intersection
 * `min(user, widget)` (SPEC §3 rule 1), so both sets are supplied explicitly
 * rather than pre-intersected.
 */
export interface MountRequest {
  /**
   * The `(source, tag)` widget identity. The kit mounts the **same** `widgetId`
   * twice to assert per-instance isolation (rule 5), so a host must derive
   * `instanceId` per mount, not from the widget identity.
   */
  readonly widgetId: WidgetId;
  /**
   * The capabilities the widget declared in its manifest — the `declared-widget`
   * side of the `min(user, widget)` intersection (rule 1). Object form
   * ({@link Capability}) or string form (`'records.read:recordType:customer'`);
   * a host adapter may accept either.
   */
  readonly widgetCapabilities: readonly (Capability | string)[];
  /**
   * The capabilities the acting user/session grants — the `user` side of the
   * intersection. A call is permitted only when **both** sides grant it; the kit
   * uses an asymmetric pair (widget-wide, user-narrow) to prove the host
   * intersects rather than trusting the widget's declaration alone.
   */
  readonly userCapabilities: readonly (Capability | string)[];
  /** The page context to expose as `sdk.context`. Defaults to empty when omitted. */
  readonly context?: PageContext;
}

/**
 * The remote-identity binding a conforming host stamps on an outbound
 * (`records`/`net`) call before transport (SPEC §3 rule 3, §6). The SDK defines
 * *what* is stamped; the shell's Service Worker does the stamping, so the kit
 * cannot read it off the {@link HostSDK} handle — the {@link Mount} adapter
 * surfaces it instead. A host that drops the binding reports `undefined` and
 * fails the rule-3 check.
 */
export interface RemoteIdentityBinding {
  /**
   * The mount the outbound call was attributed to. Rule 3 is satisfied only when
   * this equals the calling handle's `identity.instanceId` (the per-instance
   * binding, tying rule 3 to rule 5).
   */
  readonly instanceId: string;
  /** For a `net.fetch`, the remote host the identity was scoped to; omitted for records. */
  readonly host?: string;
}

/**
 * A live mounted instance under test: the handle plus the two out-of-band
 * observation/control seams the {@link HostSDK} interface deliberately does not
 * expose (remote-identity is stamped below the handle; unmount is the host's
 * lifecycle, not the widget's).
 */
export interface Mount {
  /** The capability-scoped handle the widget would receive. */
  readonly sdk: HostSDK;
  /**
   * The {@link RemoteIdentityBinding} the host stamped on the **most recent**
   * allowed outbound (`records`/`net`) call through {@link sdk}, or `undefined`
   * when none has been made or the host bound none. A conforming host returns a
   * binding whose `instanceId` matches `sdk.identity.instanceId` (rule 3).
   */
  lastOutboundIdentity(): RemoteIdentityBinding | undefined;
  /**
   * Unmount this instance (SPEC §3 rule 6): the host revokes the per-instance
   * token and releases every `events` subscription registered through the
   * handle. After this resolves, a gated call on {@link sdk} must reject with
   * {@link InstanceGone} and a subsequent emit must not reach the released
   * subscribers. Idempotent — calling it twice is a no-op.
   */
  unmount(): void | Promise<void>;
}

/**
 * The host adapter a consumer passes to the conformance kit. One method: mount a
 * widget instance for a scenario and return its {@link Mount}. The kit calls
 * `mount` several times per rule (fresh instances, and two mounts of one widget
 * for rules 4–6), so an implementation must return an **independent** instance
 * each call — never a shared/cached handle.
 */
export interface ConformanceHost {
  /** A human-readable name for the host under test, used in check output. */
  readonly name?: string;
  /** Mount one widget instance for a conformance scenario. */
  mount(request: MountRequest): Mount | Promise<Mount>;
}

/**
 * Stable identifier for each SPEC §3 contract rule the kit asserts. Used as the
 * {@link ConformanceCheck} id and as the discriminant an instrumented-failure
 * fixture seeds a violation against (one rule at a time), so a test can map
 * "broke rule X" to "check X must fail".
 */
export type RuleId =
  /** Rule 1: capability intersection before transport; typed `PermissionDenied`, no empty-result leakage. */
  | 'capability-intersection'
  /** Rule 2: `net.fetch` reaches only declared hosts. */
  | 'net-host-scope'
  /** Rule 3: every outbound call carries the per-instance remote-identity binding. */
  | 'remote-identity'
  /** Rule 4: typed, namespaced, capability-gated events; host-mediated, never a shared global. */
  | 'event-gating'
  /** Rule 5: two mounts of one widget get distinct `instanceId`s. */
  | 'per-instance-id'
  /** Rule 6: unmount revokes the token, auto-unsubscribes, and stale calls reject `InstanceGone`. */
  | 'unmount-revocation';

/**
 * Thrown by a {@link ConformanceCheck} when the host under test violates the
 * rule the check enforces. A typed error (rather than a bare `Error`) so the
 * vitest binding and the acceptance-gate fixture can assert *that a violation
 * was raised* and attribute it to a {@link RuleId}. The message states the
 * observed behavior and the rule it breaks.
 */
export class ConformanceViolation extends Error {
  override readonly name = 'ConformanceViolation';
  /** The rule the host violated. */
  readonly rule: RuleId;

  constructor(rule: RuleId, message: string) {
    super(message);
    Object.setPrototypeOf(this, ConformanceViolation.prototype);
    this.rule = rule;
  }
}

/**
 * One rule's assertion, decoupled from any test framework. `run` drives the
 * {@link ConformanceHost} through the rule's allowed/denied scenarios and
 * resolves on conformance or rejects with a {@link ConformanceViolation} on the
 * first breach. `./index.ts` wraps each check as a `vitest` test
 * ({@link runHostConformance}); a non-vitest consumer can drive them directly
 * ({@link runConformanceChecks}).
 */
export interface ConformanceCheck {
  /** Stable rule id — see {@link RuleId}. */
  readonly id: RuleId;
  /** The SPEC §3 rule number (1–6) this check enforces. */
  readonly rule: 1 | 2 | 3 | 4 | 5 | 6;
  /** One-line human title, used as the vitest test name. */
  readonly title: string;
  /** Run the check; reject with {@link ConformanceViolation} on a breach. */
  run(host: ConformanceHost): Promise<void>;
}
