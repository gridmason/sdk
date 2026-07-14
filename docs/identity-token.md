# The per-instance remote-identity token contract (FR-8)

Every `records`/`net` call a widget makes must reach the API **as that widget
instance** — not as an anonymous page script. This is the contract that makes
that so: the shape of the per-instance token, the rules for holding it, and the
API the SDK transport uses to attach it. It is the contract the dashboard's
reference `HostSDK` and its Service Worker (SW) implement against (dashboard §3,
D-E4).

The types live in [`src/interface/identity.ts`](../src/interface/identity.ts)
and are re-exported from the package root (`@gridmason/sdk`).

## The one split that governs everything

> **SDK** defines *what* identity is stamped and *where* it attaches.
> **Shell SW** defines *how* that identity is proven.

The package ships **no keys, no transport crypto, and no token minting** (SPEC
§6). It contributes the token's opaque type, one header slot, and the pure
mechanics that place the token on a call. Minting the unforgeable token, signing
it, and validating it at the API are the shell/SW's job.

```
widget code
  │  sdk.records.read(...) / sdk.net.fetch(...)
  ▼
HostSDK handle            capability check: min(user, declared-widget)
  ▼
SDK transport             reads the closure InstanceToken, stamps it          ← this contract
  │                       (x-gridmason-instance-token) on the outbound call
  ▼
shell Service Worker      attaches auth, proves the token                     ← shell owns this
  ▼
API                       maps token → (instanceId, widgetId, capabilities)
```

## The token

```ts
type InstanceToken = string & { /* opaque brand */ };
```

- **Opaque.** The SDK never mints, parses, logs, or inspects it. It is a branded
  `string` only because it rides a transport header (which must be a string); the
  brand stops an arbitrary `string` from being treated as a token without an
  explicit cast.
- **Shell-minted, per instance.** The shell mints one unforgeable token per mount
  (a fresh token for each of two mounts of the same widget) and holds the minting
  secret. The SDK receives only the minted value.
- **Meaning lives at the API.** The API maps a valid token to
  `(instanceId, widgetId, declared capabilities)`. The token encodes none of that
  to the SDK.

`toInstanceToken(minted: string): InstanceToken` brands a value the shell already
minted. It is a **type cast, not minting** — no secret, no entropy, no crypto.
Use it to type a shell-produced value; never to fabricate a token.

## Closure-holding rules

1. **The token is never on the handle.** `HostSDK.identity` exposes only
   `instanceId` and `widgetId`. The token is captured in the SDK transport's
   closure via an `InstanceTokenReader` and is never returned to, or reachable
   by, widget code.

   ```ts
   type InstanceTokenReader = () => InstanceToken | undefined;
   ```

2. **It is stamped below the API, on every outbound call.** The transport reads
   the token through its reader and attaches it to each `records`/`net` call. A
   call with no valid token gets no capability-scoped access — it reaches the API
   as an anonymous page script (SPEC §2).

3. **The token and its revocation are one story.** On unmount the instance is
   revoked (SPEC §3 rule 6, [`src/noop/lifecycle.ts`](../src/noop/lifecycle.ts)).
   The shell's reader stops yielding a token once revoked, so a stamp on a dead
   instance throws `InstanceGone` instead of emitting an unattributed call.

Same-document JS is not a sandbox: this binding is enforcement plumbing plus an
audit trail. The hard boundary stays review of signed code (SPEC §2).

## Where it attaches

```ts
const INSTANCE_TOKEN_HEADER = 'x-gridmason-instance-token';
```

The token rides this header on the transport request the SW carries. The SDK owns
the slot name (the *where*); the SW reads it to recover and prove the token.

`stampInstanceToken(headers, token)` places the token in that slot. It is pure
and immutable (returns a new map) and the stamped token **overrides** any value —
including a different-cased variant — a widget pre-seeded under that header, so a
widget can never spoof or suppress its own identity.

## The transport-attachment API

A real host binds the reader into an `IdentityStamper` once per mount and routes
each outbound call through it:

```ts
const stamper = bindIdentityStamper(instanceId, readToken);

// net channel — stamp the scoped request the widget passed:
const outbound = stamper.stampRequest(req); // req.headers now carry the token

// records channel — stamp the host's own records-transport headers:
const headers = stamper.stampHeaders(baseHeaders);
```

- `stamper.instanceId` equals the handle's `identity.instanceId` — this is what
  ties the stamped identity to the per-instance handle (SPEC §3 rules 3 and 5).
- Both methods read the token afresh (so a mid-life revocation takes effect at
  once) and throw `InstanceGone` when the reader yields `undefined`.
- Neither method exposes the token — only stamped headers/requests leave the
  stamper.

`bindIdentityStamper` ships no minting and no crypto; it only reads and places
the token the shell minted.

## What the dashboard implements against this (D-E4)

- The shell **mints** the per-instance token at mount and captures it in a reader
  closure (returning `undefined` after the instance's unmount revocation).
- The reference `HostSDK`'s `records`/`net` transport calls `stampRequest` /
  `stampHeaders` on every outbound call before handing it to the SW.
- The SW reads `x-gridmason-instance-token`, **proves** it, and the API maps it to
  `(instanceId, widgetId, capabilities)`.

The observable side of rule 3 — that a conforming host attributes each outbound
call to the calling instance — is asserted by the conformance kit through its
`RemoteIdentityBinding` seam (`{ instanceId, host? }`, token-free by design;
[`src/conformance/types.ts`](../src/conformance/types.ts)). The token itself is
never surfaced for observation.

## Out of scope here

- Token **minting** and the minting secret (shell).
- **Proving** the token: signing, validation, session mapping (shell SW).
- The concrete `records`/`net` **send** and the records wire envelope (reference
  host).
