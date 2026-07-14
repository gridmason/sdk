/**
 * The no-op reference implementation (docs/SPEC.md §5): `createNoopSDK()` — every
 * method resolves to an empty/typed-default, records calls for assertions, and
 * denies nothing (dev only, clearly labeled). This is what the dashboard M1
 * static boot passes to widgets before a registry exists, and what widget unit
 * tests mount against. Published at `@gridmason/sdk/noop`.
 *
 * Placeholder — `createNoopSDK()` lands in S-E1 (issue #6).
 */
export const NOOP_PLACEHOLDER = true;
