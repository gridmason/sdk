// Public barrel for @gridmason/sdk. The root export carries the host-SDK
// interface (the `HostSDK` handle types) and the framework-agnostic widget-side
// helpers; the per-framework adapters (`./react`, `./vue`, `./vanilla`), the
// dev implementations (`./noop`, `./fixture`), and the host-conformance kit
// (`./conformance`) are separate package exports (see package.json "exports").
//
// These subtrees are placeholders until the S-E1/S-E2 epics land (docs/SPEC.md
// §3–§5): #5 HostSDK interface, #6 createNoopSDK, #7 createFixtureSDK, #8 React
// helpers, then the Phase-B helper/conformance work.
export * from './interface/index.js';
export * from './helpers/index.js';
