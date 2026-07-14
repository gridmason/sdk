# Contributing to `@gridmason/sdk`

Thanks for your interest in contributing. This package defines **both sides of
the widget/host boundary**: the `HostSDK` interface a host shell implements (the
capability-enforcing chokepoint for data, network, events, navigation, and
telemetry) and the widget-side helper library authors import. All widget I/O
flows through it, gated by `min(user permissions, declared capabilities)`.
Because the interface is a contract every host and every widget builds against —
and because it is a **security** boundary — the contribution process is
deliberately strict about **contracts** and **capability correctness**.

Please also read our [Code of Conduct](./CODE_OF_CONDUCT.md) and
[Security Policy](./SECURITY.md). Never file a suspected vulnerability as a
public issue or PR — follow [SECURITY.md](./SECURITY.md) instead.

## Contributor License Agreement (required)

Gridmason is released under [AGPL-3.0](./LICENSE), and Sniper7Kills LLC offers it
under separate commercial terms as well. To keep dual licensing possible, **every
contributor must sign the [Contributor License Agreement](./.github/CLA.md)**
before their pull request can be merged.

You do not need to do anything up front. When you open your first pull request, a
bot comments with the CLA text and a one-line instruction; you sign by replying
with the exact sentence it gives you. The signature is recorded once and applies
to all your future contributions. PRs from unsigned contributors are blocked from
merging until the CLA is signed.

## Development setup

Requirements: **Node.js >= 22** (the package targets modern ESM; see `engines`
in `package.json`) and npm.

```bash
git clone https://github.com/gridmason/sdk.git
cd sdk
npm ci          # install exact, locked dependencies
```

Local checks — these are exactly what CI runs, and all four must be green before
you open a PR:

```bash
npm run build        # tsc -> dist/ (ESM + type declarations)
npm test             # vitest run
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
```

Useful during development:

```bash
npm run test:watch   # vitest in watch mode
npm run coverage     # vitest run --coverage
npm run lint:fix     # auto-fix lint issues
```

## The contract-first change process

The `HostSDK` interface and the wire behavior it implies are contracts that
`core`, the dashboard, and every widget build against. That constrains *how*
changes are allowed to happen:

- **The interface is capability-shaped, and stays that way.** Every data or
  network method is capability-gated; there is no unscoped `fetch` on the handle
  and no untyped/ambient event bus (SPEC §2, §6). A change that adds an escape
  hatch around `min(user, widget)` — a raw fetch, a global bus, an un-gated
  topic — will not be accepted.
- **Types come from `@gridmason/protocol`.** The capability grammar, page-context
  types, and `WidgetId` are defined once in `@gridmason/protocol` and imported
  here — never re-declared. Do not fork a contract type into this package.
- **The conformance kit is part of the contract.** `@gridmason/sdk/conformance`
  is what makes "a valid Gridmason host" machine-checkable. If you change a
  contract rule (SPEC §3), update the kit and its tests in the same PR so a
  divergent host fails a shared test instead of production — and include the
  **negative** cases (a call that should be denied, a stale handle that should
  return `InstanceGone`).
- **Cross-repo needs are contract-first, not atomic.** We do not do coordinated
  cross-repo merges. If a change here requires work in `core`, the dashboard, or
  `protocol`, land the SDK change, cut a release, and let dependents bump on
  their own cadence; if the change *originates* in `protocol` (a contract type),
  file an issue there first.
- **No dependency creep.** This package depends on `@gridmason/protocol` only —
  never on `core`, the registry, or any host (SPEC §7). New runtime dependencies
  must be minimal, pinned, and justified in the PR.

## Changesets (required on user-facing changes)

This package publishes to npm via [changesets](https://github.com/changesets/changesets)
with SemVer. **Any change that affects consumers — the interface, an exported
type or helper, runtime behavior, or the public API — must include a changeset**
so the release notes and version bump are generated correctly:

```bash
npx changeset
```

Pick the bump that matches the impact:

- **patch** — bug fix with no API change.
- **minor** — additive, backward-compatible change (a new optional method, a new
  helper).
- **major** — a breaking change. Pre-1.0, breaking changes bump the `0.x` minor
  per SemVer's 0.x rules; call them out clearly in the changeset regardless.

Changesets are **not** required for changes with no consumer impact (internal
refactors with identical behavior, tests, CI, or documentation). If in doubt,
add one — an extra patch note is cheaper than a missed release.

## Pull request checklist

Before you open a PR:

- [ ] `npm run build && npm test && npm run lint && npm run typecheck` all pass.
- [ ] Tests added/updated, including negative cases for any capability, scoping,
      identity, or unmount behavior.
- [ ] The conformance kit + its tests updated if you changed a SPEC §3 contract
      rule.
- [ ] A changeset is included if the change is user-facing.
- [ ] The CLA is signed (the bot will guide you on your first PR).
- [ ] The PR description explains the *contract* impact — is this additive
      (minor) or breaking (major), and which interface members, helpers, or
      capabilities are affected?

Small, focused PRs review faster. For a significant change, opening an issue to
discuss the approach first is welcome — especially for anything that touches the
`HostSDK` interface or the capability model.

## License

By contributing, you agree that your contributions are licensed under the
project's [AGPL-3.0](./LICENSE) license and are covered by the terms of the
[CLA](./.github/CLA.md) you signed.
