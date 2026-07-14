/**
 * The framework-agnostic settings-form helper (docs/SPEC.md §4, FR-6) — the
 * `settings-form` adapter contract, the schema→form compiler (the pinned renderer
 * approach), and the controller that binds a JSON Schema to the settings value
 * round-trip. Re-exported from the package root (`@gridmason/sdk`) alongside the rest
 * of the framework-agnostic helper core.
 *
 * A per-framework binding renders these: the React `useSettingsForm` (and its
 * dev/reference stub adapter) is published from `@gridmason/sdk/react`; the Phase-B
 * Vue/vanilla bindings (#10) reuse this same contract and controller. The SDK ships
 * **no field UI** — a host supplies its design-system inputs through
 * {@link SettingsFormAdapter} (see `./adapter.ts`, `docs/settings-form.md`).
 */

export type {
  FieldControl,
  FieldModel,
  FieldOption,
  FieldRenderProps,
  FormRenderProps,
  SettingsFormAdapter,
} from './adapter.js';
export { compileSchema } from './schema.js';
export type { SettingsFormController } from './controller.js';
export { settingsFormController } from './controller.js';
