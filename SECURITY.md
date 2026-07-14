# Security Policy

`@gridmason/sdk` defines the **capability chokepoint** between a widget and its
host: the `HostSDK` interface every host implements and the widget-side helpers
authors import. All widget data and network access flows through it, gated by
`min(user permissions, declared widget capabilities)`. A defect that lets a
widget reach data outside its declared capabilities, bypass the SDK to talk to
the API directly, or subscribe to an event topic it was not granted is a
security defect in every host that ships the interface. We treat vulnerability
reports accordingly.

## Reporting a Vulnerability

**Do not open a public issue, discussion, or pull request for a suspected
vulnerability.** Public disclosure before a fix is available puts every
downstream host and its users at risk.

Instead, report privately through GitHub's coordinated disclosure workflow:

1. Go to the **[Security Advisories](https://github.com/gridmason/sdk/security/advisories/new)**
   page for this repository (Security tab → Report a vulnerability).
2. Provide as much of the following as you can:
   - Affected version(s) or commit(s), and the affected surface (e.g. the
     capability-intersection check, `net.fetch` scoping, the typed event bus,
     per-instance identity, unmount revocation).
   - A description of the issue and its security impact (e.g. a call that
     returns data past `min(user, widget)`, an unscoped network reach, a
     cross-instance handle leak, a stale-handle call that returns data instead
     of `InstanceGone`).
   - A minimal reproduction — ideally a failing conformance-kit case or a short
     widget/host script against a published `0.x` build.
   - Any known workarounds.

If you cannot use GitHub Security Advisories, contact an administrator of the
[`gridmason`](https://github.com/gridmason) GitHub organization directly to
arrange a private channel.

## What to Expect

- **Acknowledgement** within **3 business days** of your report.
- An initial **assessment and severity triage** within **10 business days**.
- Ongoing updates through the advisory thread as we investigate and prepare a
  fix.
- **Coordinated disclosure**: we will agree on a disclosure timeline with you.
  Our target is a fix and published advisory within **90 days** of triage;
  actively-exploited issues are handled faster. We will credit you in the
  advisory unless you ask us not to.

We do not currently operate a paid bug-bounty program.

## Supported Versions

Gridmason is pre-1.0. Security fixes land on the latest `0.x` line and are
released as a new patch version; there is no long-term support for older `0.x`
releases. Always depend on the most recent published version.

| Version | Supported |
| ------- | --------- |
| latest `0.x` | :white_check_mark: |
| older `0.x` | :x: |

Once a `1.0` line ships, this table will be updated with a supported-version
window.

## Scope

In scope — anything that lets a widget reach data, network hosts, or events it
should not, or lets a host that passes the conformance kit still leak:

- Capability-intersection flaws: a `records`/`net` call that returns data past
  `min(user, declared-capabilities)`, or a denial that leaks existence instead
  of returning a typed `PermissionDenied`.
- `net.fetch` reaching a host the widget did not declare (`net:<host>`), or any
  unscoped fetch path on the handle.
- Missing or forgeable remote-identity binding on an outbound call.
- Typed-event-bus gating bypasses: subscribing to or emitting on a topic
  namespace the widget has no capability for, or the bus leaking across
  documents/instances.
- Per-instance isolation failures: two mounts sharing state, or a stale handle
  returning data after unmount instead of `InstanceGone`.
- Supply-chain integrity of the package itself (build, publish provenance,
  dependency pinning).

Out of scope:

- The transport crypto and auth attachment — that is the shell's Service Worker
  (dashboard §3), not this package. The SDK defines *what* identity is stamped,
  not *how* it is proven.
- Concrete backend behavior — the reference `HostSDK` implementation lives in
  the dashboard repo; report those there unless the root cause is in this
  interface.
- Same-document JS "escapes" that assume the SDK is a sandbox. It is not: the
  binding is enforcement plumbing plus an audit trail, and the hard boundary
  stays review of signed code (SPEC §2). Reports must show a capability,
  scoping, identity, or isolation bypass — not merely that co-resident script
  can reach co-resident script.

## Disclosure Philosophy

The SDK is a capability chokepoint, not a convenience layer: removing it must
break data access, not merely inconvenience it (SPEC §6). If you have found a way
to reach data, a network host, or an event topic outside a widget's declared and
user-intersected capabilities — or to make a conforming host leak — we want to
hear from you before anyone else does.
