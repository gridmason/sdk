/**
 * Capability enforcement for the fixture handle (docs/SPEC.md §5, §6). A fixture
 * is *not* an excuse to skip the capability check — the whole point is that
 * "fixture-green predicts review-green", so a gated call for a capability the
 * widget did not declare is denied with a typed {@link PermissionDenied}, exactly
 * as a conforming host would, and **never** satisfied by fixture data.
 *
 * The one definition of the capability grammar lives in `@gridmason/protocol`
 * (§3.1); this module imports its parser/validator (enforcement utilities the
 * re-export policy keeps off the author surface — docs/re-export-policy.md) and
 * applies the scope-prefix `min(user, widget)` semantics to the fixture's
 * declared set. In dev there is no "user", so the enforced set is the widget's
 * declared capabilities alone (the manifest subset `gridmason dev` passes in).
 *
 * ## Scope-prefix grant
 *
 * A capability is `<api>[:<scope>]` with a colon-delimited scope path (SPEC §2:
 * `records.read:recordType:customer`). A declared capability **grants** a
 * required one iff the api matches exactly and the declared scope path is a
 * **prefix** of the required one — so unscoped `records.read` grants every read,
 * `records.read:recordType` grants every type, and
 * `records.read:recordType:customer` grants only `customer`. This is the same
 * prefix containment the picker uses (core §6).
 */

import { parseCapability, validateCapability } from '@gridmason/protocol';
import type { Capability, CapabilityApi } from '../protocol/index.js';

/**
 * A declared capability reduced to the two things the grant check needs: its api
 * and its scope split into a path. Produced by {@link normalizeCapabilities}.
 */
export interface NormalizedCapability {
  readonly api: CapabilityApi;
  /** The scope split on `:`; empty for an unscoped (grants-all) capability. */
  readonly scopePath: readonly string[];
}

/**
 * The capability a gated call requires: the api plus the scope path derived from
 * the call (`records.read` on `customer` → `['recordType', 'customer']`).
 */
export interface RequiredCapability {
  readonly api: CapabilityApi;
  readonly scopePath: readonly string[];
}

/**
 * Normalize the widget's declared capabilities (the manifest `capabilities`
 * subset) into {@link NormalizedCapability}s. Accepts both the object form
 * ({@link Capability}, as a manifest carries it) and the string form
 * (`'records.read:recordType:customer'`, ergonomic for hand-written tests and
 * `gridmason dev`). Invalid input throws at construction — a fixture author sees
 * the grammar error immediately, not as a silent deny later.
 */
export function normalizeCapabilities(
  declared: ReadonlyArray<Capability | string>,
): NormalizedCapability[] {
  return declared.map((cap) => {
    if (typeof cap === 'string') {
      const parsed = parseCapability(cap);
      if (!parsed.ok) {
        throw new Error(
          `createFixtureSDK: invalid capability string ${JSON.stringify(cap)} (${parsed.error})`,
        );
      }
      return { api: parsed.api, scopePath: parsed.scopePath };
    }
    const error = validateCapability(cap);
    if (error !== undefined) {
      throw new Error(
        `createFixtureSDK: invalid capability ${JSON.stringify(cap)} (${error})`,
      );
    }
    return {
      api: cap.api,
      scopePath: cap.scope === undefined ? [] : cap.scope.split(':'),
    };
  });
}

/** `true` iff `short` is a prefix of (or equal to) `long`. */
function isPrefix(short: readonly string[], long: readonly string[]): boolean {
  if (short.length > long.length) return false;
  return short.every((segment, i) => segment === long[i]);
}

/**
 * `true` iff some declared capability grants `required` — same api, declared
 * scope a prefix of the required scope (see module doc).
 */
export function isGranted(
  declared: readonly NormalizedCapability[],
  required: RequiredCapability,
): boolean {
  return declared.some(
    (cap) => cap.api === required.api && isPrefix(cap.scopePath, required.scopePath),
  );
}

/**
 * The {@link Capability} object form of a required capability, for the
 * {@link PermissionDenied} a denial throws. Omits `scope` when the path is empty
 * (`exactOptionalPropertyTypes` — an unscoped capability carries no `scope` key).
 */
export function toCapability(required: RequiredCapability): Capability {
  return required.scopePath.length === 0
    ? { api: required.api }
    : { api: required.api, scope: required.scopePath.join(':') };
}

/** The capability a records read/query of `recordType` requires. */
export function readCapability(recordType: string): RequiredCapability {
  return { api: 'records.read', scopePath: ['recordType', recordType] };
}

/** The capability a records write of `recordType` requires. */
export function writeCapability(recordType: string): RequiredCapability {
  return { api: 'records.write', scopePath: ['recordType', recordType] };
}

/** The capability a `net.fetch` to `host` requires. */
export function netCapability(host: string): RequiredCapability {
  return { api: 'net', scopePath: [host] };
}

/** The capability an `events` emit/subscribe on namespace `ns` requires. */
export function eventsCapability(ns: string): RequiredCapability {
  return { api: 'events', scopePath: [ns] };
}
