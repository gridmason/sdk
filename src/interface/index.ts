/**
 * The `HostSDK` interface (docs/SPEC.md §3): what a host shell implements so
 * widgets reach data, permissions, events, navigation, and telemetry through a
 * single capability-enforcing chokepoint — plus the typed error surface
 * (`PermissionDenied`, `InstanceGone`).
 *
 * Placeholder — the interface and error types land in S-E1 (issue #5). The
 * entry point is reserved and re-exported from the package root now so
 * downstream repos can pin the import path before the types exist.
 *
 * When #5 builds the interface here, its shared contract types
 * (`WidgetID`/`WidgetId`, the page-context type grammar, the capability-grammar
 * types) come from `@gridmason/protocol` via `../protocol/index.js` — never a
 * local redefinition. See `docs/re-export-policy.md` for which type to import
 * from where (and the `PageContext` gap `context`'s typing depends on).
 */
export const INTERFACE_PLACEHOLDER = true;
