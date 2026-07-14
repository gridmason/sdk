# sdk

`@gridmason/sdk` — the host-SDK interface widgets code against (capability-scoped data access, typed event bus, widget helpers) + the widget-side helper library. Public OSS (AGPL-3.0). Engineering spec: [`docs/SPEC.md`](docs/SPEC.md) · Build plan: [`docs/specs/sdk-v0/spec.md`](docs/specs/sdk-v0/spec.md).

Two contracts in one package, on opposite sides of the same boundary: the **host-SDK interface** a host shell implements so widgets reach data, permissions, events, and telemetry through a single capability-enforcing chokepoint (`min(user permissions, declared capabilities)` per call), and the **widget-side helpers** a widget author imports to talk to that host. All widget network I/O flows through the SDK — it is the only sanctioned path from widget to data (SPEC §2).

## Package exports

The package publishes ESM + type declarations with these entry points (reserved from the scaffold; the implementations land across the S-E1/S-E2 epics):

| Import | Contents |
|---|---|
| `@gridmason/sdk` | the `HostSDK` interface + framework-agnostic widget helpers |
| `@gridmason/sdk/react` | React helper adapter (the reference set) |
| `@gridmason/sdk/vue` | Vue helper adapter |
| `@gridmason/sdk/vanilla` | vanilla (no-framework) helper adapter |
| `@gridmason/sdk/noop` | `createNoopSDK()` — dev/test no-op reference implementation |
| `@gridmason/sdk/fixture` | `createFixtureSDK()` — no-op backed by an author fixture map |
| `@gridmason/sdk/conformance` | host-conformance test kit — "a valid Gridmason host" made machine-checkable |

Depends on `@gridmason/protocol` only (capability grammar, page-context types, `WidgetID`) — never on `core`, the registry, or any host (SPEC §7). The SDK re-exports the author-facing subset of those protocol types from `@gridmason/sdk` (so a widget author needs no second install) and consumes the rest internally; which is which, and where each downstream import comes from, is the [re-export policy](docs/re-export-policy.md).

## Status

Scaffold (issue #2): the releasable package skeleton — build (ESM + `.d.ts`), CI, changesets + npm Trusted Publishing, and the CLA gate. Each entry point above is a reserved placeholder until its epic lands. See the [build plan](docs/specs/sdk-v0/spec.md) for the issue map.

## Development

Requires **Node.js >= 22**.

```bash
npm ci
npm run build        # tsc -> dist/ (ESM + type declarations)
npm test             # vitest run
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution process, including the required **Contributor License Agreement** (AGPL-3.0 + commercial dual licensing).

## Releasing

Versioning and publishing are driven by [changesets](https://github.com/changesets/changesets). The package ships ESM + type declarations under SemVer 0.x, publishing to npm as `@gridmason/sdk`.

**Add a changeset with every change that should ship.** After making a change, run:

```bash
npm run changeset
```

Pick the bump (patch/minor/major — we are pre-1.0, so breaking changes are `minor` and everything else is `patch`) and write a one-line summary. This drops a markdown file in `.changeset/`; commit it with your PR.

**How a changeset becomes a publish:**

1. PRs land on `main` carrying their `.changeset/*.md` files.
2. The [`release`](.github/workflows/release.yml) workflow runs on every push to `main`. When unreleased changesets are present it opens (or updates) a **"Version Packages"** PR that consumes the changesets, bumps `package.json`, and updates `CHANGELOG.md`.
3. Merging that PR pushes the version bump to `main`, which re-runs the workflow — this time with no pending changesets, so it runs `changeset publish` and pushes the release to npm.

Publishing authenticates with **npm Trusted Publishing (OIDC)** — there is no `NPM_TOKEN` secret. The workflow requests `id-token: write` and npm exchanges the GitHub OIDC token at publish time; [build provenance](https://docs.npmjs.com/generating-provenance-statements) is attached automatically (`NPM_CONFIG_PROVENANCE`).

### Maintainer one-time setup (npmjs.com trusted publisher)

Trusted Publishing must be enabled once on npmjs.com before CI can publish. The `@gridmason` scope must already exist and the first `0.0.x` version must already be published (bootstrapped locally). Then, on npmjs.com:

**Package `@gridmason/sdk` → Settings → Trusted Publisher → GitHub Actions**, with:

| Field | Value |
|---|---|
| Organization / user | `gridmason` |
| Repository | `sdk` |
| Workflow filename | `release.yml` |
| Environment | *(leave blank)* |

After this is saved, the CI `release` workflow publishes without any token.

## License

[AGPL-3.0](LICENSE). All contributions require the [CLA](.github/CLA.md).
