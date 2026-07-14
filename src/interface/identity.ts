/**
 * The **per-instance remote-identity contract** (docs/SPEC.md §2, §6; FR-8;
 * docs/identity-token.md). This module answers one question — *what identity is
 * stamped on every outbound `records`/`net` call, and where the SDK attaches it*
 * — and deliberately leaves the other one — *how that identity is proven* — to
 * the shell's Service Worker. That split is the whole security posture (SPEC §6):
 *
 * ```
 * SDK        = what identity is stamped  +  where it attaches   (this module)
 * shell SW   = how the identity is proven (mint, sign, validate) (dashboard §3)
 * ```
 *
 * Ships **no keys, no transport crypto, and no token minting**. The shell mints
 * the unforgeable {@link InstanceToken} at mount and hands the SDK a *closure
 * reader* ({@link InstanceTokenReader}) over it; the SDK never sees how the token
 * was produced and never inspects it. All this module contributes is the token's
 * opaque type, the canonical header slot it rides in ({@link INSTANCE_TOKEN_HEADER}),
 * and the pure attachment mechanics ({@link stampInstanceToken}, {@link bindIdentityStamper})
 * a real transport uses to put the closure token onto each call.
 *
 * ## Closure-holding rules (SPEC §2)
 *
 * At mount the shell mints one token per instance and captures it in the SDK
 * transport's closure. Three rules make that a binding rather than a decoration:
 *
 * 1. **Never on the handle.** The token is *not* a member of {@link HostSDK.identity}
 *    (which carries only `instanceId`/`widgetId`) and is not exposed by anything a
 *    widget can reach. Widget code cannot read, copy, or forward it — it only ever
 *    holds a handle whose transport *already* stamps the token below the surface.
 * 2. **Stamped below the API.** The transport reads the token via its
 *    {@link InstanceTokenReader} and attaches it to every outbound `records`/`net`
 *    call ({@link IdentityStamper}); the API maps the token to
 *    `(instanceId, widgetId, declared capabilities)`. A call carrying no valid
 *    token reaches the API as an anonymous page script — no capability-scoped
 *    access (SPEC §2).
 * 3. **Revoked with the instance.** Revocation and the token are one story
 *    (SPEC §3 rule 6, src/noop/lifecycle.ts): on unmount the reader stops
 *    yielding a token, so {@link IdentityStamper.stampRequest} refuses to stamp a
 *    dead instance and throws {@link InstanceGone} instead of sending an
 *    unattributed call.
 *
 * Same-document JS is not a sandbox, so this binding is enforcement plumbing plus
 * an audit trail — the hard boundary stays review of signed code (SPEC §2).
 *
 * This module declares the contract and the *pure, non-privileged* attachment
 * mechanics only. The token minting lives in the shell; the real `records`/`net`
 * send and the SW's proof live in the dashboard's reference host (dashboard §3);
 * the dev handles (`createNoopSDK`/`createFixtureSDK`) bind no remote identity by
 * design.
 */

import { InstanceGone } from './errors.js';
import type { ScopedRequest } from './index.js';

declare const instanceTokenBrand: unique symbol;

/**
 * The unforgeable per-instance secret the **shell mints** at mount and the SDK
 * transport carries — opaque to the SDK, which never mints, parses, logs, or
 * otherwise inspects it (SPEC §6). Modeled as a branded `string` because the
 * token rides a transport header ({@link INSTANCE_TOKEN_HEADER}), which must be a
 * string; the brand keeps an arbitrary `string` from being mistaken for a token
 * without an explicit, auditable {@link toInstanceToken} cast.
 *
 * The API maps a valid token to `(instanceId, widgetId, declared capabilities)`;
 * the token itself encodes none of those to the SDK — only the shell/API assign
 * it meaning (SPEC §2).
 */
export type InstanceToken = string & { readonly [instanceTokenBrand]: 'InstanceToken' };

/**
 * Brand an opaque string the **shell has already minted** as an {@link InstanceToken}.
 *
 * This is a *type-level cast, not minting*: it creates no secret, adds no
 * entropy, and performs no crypto — the shell owns minting (SPEC §6). It exists
 * so the shell and dev/host code adopt the token type without an unsafe
 * `as unknown as InstanceToken` at every seam. Never call it to *fabricate* a
 * token; only to type a value the shell produced.
 */
export function toInstanceToken(minted: string): InstanceToken {
  return minted as InstanceToken;
}

/**
 * The canonical transport header the per-instance {@link InstanceToken} is
 * stamped under — the *where* the SDK owns. The shell's SW reads this slot to
 * recover the token and prove it (SPEC §2; dashboard §3). Lower-case so it
 * matches how HTTP normalizes header names; {@link stampInstanceToken} strips any
 * case-variant a widget may have supplied so the stamped token always wins.
 */
export const INSTANCE_TOKEN_HEADER = 'x-gridmason-instance-token';

/**
 * A transport header map: header name → value. Structurally the shape of
 * {@link ScopedRequest.headers}, named here because the identity stamp also
 * applies to the host's records-channel transport headers, not only `net`
 * requests.
 */
export type TransportHeaders = { readonly [name: string]: string };

/**
 * A zero-argument reader the shell hands the SDK transport, closed over the
 * instance's token (the closure-holding rule — the token is captured here, never
 * returned to widget code). Returns the live token while the instance is mounted
 * and `undefined` once it is revoked (SPEC §3 rule 6): a revoked reader is how
 * "the token and its revocation are one story" reaches the transport, so a stamp
 * on a dead instance becomes an {@link InstanceGone} rather than an unattributed
 * call.
 */
export type InstanceTokenReader = () => InstanceToken | undefined;

/**
 * Stamp `token` into a transport header map under {@link INSTANCE_TOKEN_HEADER}.
 *
 * Pure and immutable: returns a new map, never mutates `headers`. The stamped
 * token **overrides** any value a widget supplied under that header — including a
 * different-cased variant (`X-Gridmason-Instance-Token`, …) — so a widget can
 * never spoof or suppress its own identity by pre-seeding the header. This is the
 * *where* half of the contract (place the token in a well-known slot); it is not
 * crypto and does not prove anything — the SW does that (SPEC §6).
 */
export function stampInstanceToken(
  headers: TransportHeaders | undefined,
  token: InstanceToken,
): TransportHeaders {
  const stamped: Record<string, string> = {};
  const canonical = INSTANCE_TOKEN_HEADER.toLowerCase();
  for (const [name, value] of Object.entries(headers ?? {})) {
    // Drop any case-variant the caller supplied so the token we stamp is the
    // only occupant of the slot (no widget-seeded identity survives).
    if (name.toLowerCase() === canonical) continue;
    stamped[name] = value;
  }
  stamped[INSTANCE_TOKEN_HEADER] = token;
  return stamped;
}

/**
 * The transport-attachment API: the per-mount seam a real `records`/`net`
 * transport routes every outbound call through so the closure {@link InstanceToken}
 * is attached before the call reaches the shell's SW. Created once per instance
 * by {@link bindIdentityStamper}; it holds the {@link InstanceTokenReader} (and
 * thus the token) privately and never exposes the token — only stamped headers /
 * requests leave it.
 */
export interface IdentityStamper {
  /**
   * The mount this stamper attributes calls to. A conforming transport keeps this
   * equal to the handle's `identity.instanceId`, tying the outbound identity to
   * the per-instance handle (SPEC §3 rules 3 and 5).
   */
  readonly instanceId: string;
  /**
   * Attach the closure token to a transport header map — the mechanism both a
   * `net` request (via {@link stampRequest}) and the host's records-channel
   * transport use. Returns a new map (see {@link stampInstanceToken}); throws
   * {@link InstanceGone} for this `instanceId` if the token has been revoked
   * (SPEC §3 rule 6), so a dead instance never emits an unattributed call.
   */
  stampHeaders(headers?: TransportHeaders): TransportHeaders;
  /**
   * Attach the closure token to a scoped `net` request, returning a copy with the
   * token header set (all other fields, including `req.host`/`req.path`,
   * unchanged). Throws {@link InstanceGone} if the instance is revoked. This is
   * the `net`-channel application of {@link stampHeaders}.
   */
  stampRequest(req: ScopedRequest): ScopedRequest;
}

/**
 * Bind an {@link InstanceTokenReader} into an {@link IdentityStamper} for one
 * mount — the transport-attachment API a real host wires behind its `records`/
 * `net` implementation. The `readToken` closure is captured privately; the token
 * is read afresh on every stamp (so a mid-life revocation takes effect
 * immediately) and never returned.
 *
 * A stamp while the reader yields `undefined` (the instance was revoked on
 * unmount, SPEC §3 rule 6) throws {@link InstanceGone} rather than emitting a
 * call the API could not attribute — this is where the token and its revocation
 * become one story at the transport layer. This factory ships **no** minting and
 * **no** crypto; it only reads and places the token the shell already minted.
 */
export function bindIdentityStamper(
  instanceId: string,
  readToken: InstanceTokenReader,
): IdentityStamper {
  function requireToken(): InstanceToken {
    const token = readToken();
    if (token === undefined) throw new InstanceGone({ instanceId });
    return token;
  }
  return {
    instanceId,
    stampHeaders(headers?: TransportHeaders): TransportHeaders {
      return stampInstanceToken(headers, requireToken());
    },
    stampRequest(req: ScopedRequest): ScopedRequest {
      return { ...req, headers: stampInstanceToken(req.headers, requireToken()) };
    },
  };
}
