# sdk

`@gridmason/sdk` — the host-SDK interface widgets code against (capability-scoped data access, typed event bus, widget helpers) + the widget-side helper library. Public OSS (AGPL-3.0). Engineering spec: [`docs/SPEC.md`](docs/SPEC.md) · Build plan: [`docs/specs/sdk-v0/spec.md`](docs/specs/sdk-v0/spec.md).

Two contracts in one package, on opposite sides of the same boundary: the **host-SDK interface** a host shell implements so widgets reach data, permissions, events, and telemetry through a single capability-enforcing chokepoint (`min(user permissions, declared capabilities)` per call), and the **widget-side helpers** a widget author imports to talk to that host. All widget network I/O flows through the SDK — it is the only sanctioned path from widget to data (SPEC §2).

Two audiences, one package. If you are **writing a widget**, you import the helpers ([Write a widget](#write-a-widget)). If you are **building a host** that mounts widgets, you implement the `HostSDK` interface and prove it with the conformance kit ([Implement a host](#implement-a-host)).

## Install

```bash
npm install @gridmason/sdk
```

Requires **Node.js >= 22**. The package is ESM-only and ships type declarations. `@gridmason/protocol` is its single runtime dependency (installed automatically); `react` and `vue` are **optional** peer dependencies — you need only the one your widget's framework adapter uses, and importing `@gridmason/sdk` alone pulls in neither.

## Package exports

The package publishes ESM + type declarations with these entry points:

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

## Write a widget

A widget is a component the host mounts, handing it a capability-scoped `HostSDK` handle. The helpers are thin ergonomics over that handle — every helper mirrors an `sdk` method 1:1 and adds no privileged logic, so a widget stays auditable by reading its SDK calls. The React adapter is the reference set; Vue (`@gridmason/sdk/vue`) and vanilla (`@gridmason/sdk/vanilla`) mirror it over the same core.

Read the record the page is scoped to and render it:

```tsx
import type { HostSDK } from '@gridmason/sdk';
import { useRecord } from '@gridmason/sdk/react';

export function CustomerCard({ sdk }: { sdk: HostSDK }) {
  // `useRecord` is a hook, not an awaited call: it returns read state (cached,
  // deduped) and re-renders as the underlying `sdk.records.read` resolves. The
  // host runs its capability check before transport, so a denied read surfaces
  // as a typed `PermissionDenied` in `error`.
  const { data, loading, error } = useRecord(sdk, sdk.context.record);

  if (loading) return <p>Loading…</p>;
  if (error) return <p>Could not load this record.</p>;
  return <h2>{String(data?.fields.name ?? 'Untitled')}</h2>;
}
```

The rest of the widget-side surface follows the same shape: `useSettings(sdk)` for reactive per-instance settings with a persisting setter, `on(sdk, topic, handler)` / `emit(sdk, topic, payload)` for the typed, namespaced event bus, `scopedFetch(sdk, req)` for capability-scoped network access, and `useTelemetry(sdk)` for identity-stamped marks and errors. See [`docs/SPEC.md`](docs/SPEC.md) §4 for the full helper set.

To develop a widget without a live host, mount it against a dev handle: `createFixtureSDK(fixtures)` (`@gridmason/sdk/fixture`) backs the same interface with an author-supplied [fixture map](docs/fixture-schema.md) so the widget receives realistic data while the capability check still runs, or `createNoopSDK()` (`@gridmason/sdk/noop`) for typed-empty defaults.

## Implement a host

A host implements the `HostSDK` interface — the one capability-enforcing chokepoint every mounted widget receives (`records`, `net`, `events`, `context`, `settings`, `nav`, `telemetry`, `identity`). The interface documents six contract rules a conforming host MUST honor (capability intersection before transport, net-host scoping, per-instance remote identity, typed namespaced events, per-instance isolation, unmount revocation). Read them on the `HostSDK` type and in [`docs/SPEC.md`](docs/SPEC.md) §3.

Prove your implementation conforms with the host-conformance kit — passing it is the definition of "a valid Gridmason host." In a vitest test file, hand `runHostConformance` a thin adapter that mounts one widget instance per scenario:

```ts
import { runHostConformance } from '@gridmason/sdk/conformance';

runHostConformance({
  name: 'my host',
  // Stand up one widget instance with the requested `min(user, widget)` grant
  // and return the live handle plus the two out-of-band seams the interface
  // cannot expose: the stamped remote identity (rule 3) and an `unmount` that
  // revokes the handle (rule 6).
  mount: (req) => mountOneInstance(req),
});
```

The kit registers one `vitest` test per rule. A framework-free surface (`conformanceChecks` / `runConformanceChecks`) is exported alongside for a consumer embedding the checks outside vitest.

## Status

Shipping, published to npm under 0.x. As of **0.4.0** the package carries the full M1 surface: the `HostSDK` interface and its typed error surface (`PermissionDenied`, `InstanceGone`), the `createNoopSDK()` and `createFixtureSDK()` dev handles, the React/Vue/vanilla widget-side helper adapters over one framework-agnostic core, the settings-form helper, the per-instance identity-token contract, telemetry-attribution helpers, and the host-conformance kit. See the [build plan](docs/specs/sdk-v0/spec.md) for the issue map and the [CHANGELOG](CHANGELOG.md) for what landed in each release.

## Documentation

- [`docs/SPEC.md`](docs/SPEC.md) — the engineering spec: the two contracts, the six host rules, the capability model, and the full helper surface.
- [`docs/re-export-policy.md`](docs/re-export-policy.md) — which `@gridmason/protocol` types the SDK re-exports author-facing versus consumes internally, and where each downstream import comes from.
- [`docs/fixture-schema.md`](docs/fixture-schema.md) — the fixture-map file schema for `createFixtureSDK`: realistic dev data behind the same capability check.
- [`docs/settings-form.md`](docs/settings-form.md) — the settings-form helper (FR-6): render a schema-only widget's settings as a form in the host's design system and round-trip the values.
- [`docs/identity-token.md`](docs/identity-token.md) — the per-instance remote-identity token contract (FR-8): the token shape, the rules for holding it, and how the transport stamps it.
- [`docs/telemetry-attribution.md`](docs/telemetry-attribution.md) — the telemetry-attribution helpers: how a mark or error is stamped with per-instance and per-widget identity for host-side aggregation.

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
</content>
</invoke>
