/**
 * The React binding of the settings-form helper (docs/SPEC.md §4, FR-6) —
 * {@link useSettingsForm}. It drives the framework-agnostic
 * {@link SettingsFormController} (`./controller.js`) and hands each field to the
 * host's {@link SettingsFormAdapter}, so a **schema-only widget** (one shipping a
 * settings JSON Schema but no custom settings element) renders an editable form in
 * the host's design system with one hook call. Published at `@gridmason/sdk/react`,
 * the reference adapter the Phase-B Vue/vanilla bindings (#10) mirror.
 *
 * The hook adds only React lifecycle glue (`useSyncExternalStore` over the
 * controller's reactive source) — no privileged logic. Every edit routes through the
 * controller's `settings.update` round-trip; the schema is registered once via
 * `settings.onSchema` (see the controller module doc). This file carries **no JSX**
 * and imports no design-system UI: the nodes come entirely from the caller-supplied
 * adapter, honouring "the SDK ships no UI components" (SPEC non-goals §1).
 */

import { useSyncExternalStore } from 'react';

import type { HostSDK, JSONSchema } from '../../interface/index.js';

import type { FieldRenderProps, SettingsFormAdapter } from './adapter.js';
import { settingsFormController } from './controller.js';

export type {
  FieldControl,
  FieldModel,
  FieldOption,
  FieldRenderProps,
  FormRenderProps,
  SettingsFormAdapter,
} from './adapter.js';
export type { SettingsFormController } from './controller.js';

/**
 * Render `schema`'s settings form through `adapter`, bound to `sdk`'s settings
 * (SPEC §4). Returns the rendered field nodes as an array, in schema order — render
 * them anywhere in the widget (e.g. `<form>{useSettingsForm(sdk, schema, adapter)}</form>`).
 * When the adapter provides {@link SettingsFormAdapter.form}, the single wrapper node
 * is returned directly instead. Either way the result is renderable React content.
 *
 * Each field shows the saved settings value (or the schema `default`), and an edit is
 * persisted through `settings.update` and re-rendered — the value round-trip the
 * helper owns. The schema is registered once via `settings.onSchema`; pass a **stable**
 * schema reference (a module-level constant) so the registration and the controller
 * cache are not defeated by a new object each render (see the controller module doc).
 *
 * ```tsx
 * const SETTINGS_SCHEMA = { type: 'object', properties: { title: { type: 'string' } } } as const;
 * function Settings({ sdk }: { sdk: HostSDK }) {
 *   return <form>{useSettingsForm(sdk, SETTINGS_SCHEMA, hostAdapter)}</form>;
 * }
 * ```
 *
 * @typeParam N - the adapter's rendered node type (a React element for a React host).
 */
export function useSettingsForm<N>(
  sdk: HostSDK,
  schema: JSONSchema,
  adapter: SettingsFormAdapter<N>,
): N | readonly N[] {
  const controller = settingsFormController(sdk, schema);
  // Subscribe so a persisted edit re-renders; the snapshot itself is read per field
  // through the controller's valueOf (settings value ?? schema default).
  useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  const fields = controller.fields.map((field) => {
    const props: FieldRenderProps = {
      field,
      value: controller.valueOf(field.name),
      onChange: (next) => void controller.setValue(field.name, next),
    };
    return adapter.field(props);
  });

  // With a `form`, return the single wrapper node (no array — the adapter owns the
  // fields' keys); otherwise the field-node array (each field keyed by the adapter).
  return adapter.form !== undefined ? adapter.form({ fields }) : fields;
}
