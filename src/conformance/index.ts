/**
 * The host-conformance test kit (docs/SPEC.md §5): import it, pass your
 * `HostSDK` implementation, and it asserts the §3 contract rules — capability
 * intersection, denial typing, remote-identity presence, per-instance
 * isolation, typed-topic gating. Passing the suite is the definition of "a valid
 * Gridmason host." Published at `@gridmason/sdk/conformance` so every host and
 * product shell runs the same kit in its own CI (mirrors how
 * `@gridmason/protocol/vectors` distributes the type conformance vectors).
 *
 * Placeholder — the kit is a Phase-B deliverable (issue #12); its tests live in
 * `test/conformance`.
 */
export const CONFORMANCE_PLACEHOLDER = true;
