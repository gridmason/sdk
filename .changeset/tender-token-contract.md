---
"@gridmason/sdk": minor
---

Add the per-instance remote-identity token contract (FR-8). New in `@gridmason/sdk`:
the opaque `InstanceToken` type (SDK-defined, shell-minted, never minted here), the
canonical `INSTANCE_TOKEN_HEADER` slot, the `InstanceTokenReader` closure type, the
pure `stampInstanceToken` header stamp (anti-spoof: overrides any widget-supplied
token header), and the `IdentityStamper` / `bindIdentityStamper` transport-attachment
API. The token lives in the transport closure (never on `HostSDK.identity`) and a
stamp on a revoked instance throws `InstanceGone`, tying the token to unmount
revocation. Ships no keys, no transport crypto, and no minting — the shell's Service
Worker proves the identity. See `docs/identity-token.md`.
