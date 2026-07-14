/**
 * The settings-form **controller** (docs/SPEC.md §4) — the framework-agnostic core of
 * the settings-form helper. It owns the two jobs the helper exists to save every
 * widget author from re-writing: the **schema→field binding** (via `./schema.js`) and
 * the **value round-trip** (seed from `settings.get()`, persist each edit through
 * `settings.update()`). It renders nothing — a per-framework binding (the React
 * `useSettingsForm`, `./react.ts`; Phase-B Vue/vanilla, #10) drives it and hands each
 * field to the host's {@link SettingsFormAdapter}.
 *
 * ## No privileged logic (the audit guarantee)
 *
 * Like every helper, the controller bottoms out in handle methods and adds none of
 * its own capability logic. It reuses the core's {@link settingsSource} for the
 * reactive value + persisting setter — so the round-trip is the *same*
 * `settings.update` path `useSettings` uses — and it calls `settings.onSchema(schema)`
 * exactly once, when the controller is first created for a `(handle, schema)` pair, to
 * register the form (SPEC §3: `onSchema` "register settings form"). A widget stays
 * auditable by reading its SDK calls: one `settings.onSchema`, a `settings.get` seed,
 * one `settings.update` per edit.
 *
 * ## Caching (why `onSchema` fires once, not per render)
 *
 * A framework binding calls {@link settingsFormController} on every render. The
 * controller is cached per handle and per **schema object identity** (a nested
 * `WeakMap`, collected with the handle), so repeated calls return the same instance
 * and `settings.onSchema` is not re-invoked each render. Pass a **stable** schema
 * reference (a module-level constant), the same discipline the event helpers ask for
 * a `TypedTopic`; a fresh schema object each render would register repeatedly and
 * defeat the cache.
 */

import type { HostSDK, JSONSchema, WidgetSettings } from '../../interface/index.js';
import type { ReactiveSource } from '../index.js';
import { settingsSource } from '../index.js';

import type { FieldModel } from './adapter.js';
import { compileSchema } from './schema.js';

/**
 * The framework-agnostic settings-form binding for one `(handle, schema)` pair. A
 * {@link ReactiveSource} of the current {@link WidgetSettings} (so a framework adapter
 * re-renders on every persisted edit), plus the compiled {@link FieldModel}s and the
 * per-field value accessor and setter. Obtained from {@link settingsFormController}.
 */
export interface SettingsFormController extends ReactiveSource<WidgetSettings> {
  /** The compiled fields, in schema order — stable for the lifetime of the controller. */
  readonly fields: readonly FieldModel[];
  /**
   * The current value for `name`: the saved settings value when present, else the
   * field's {@link FieldModel.default} (or `undefined` when it has none). This is the
   * value a framework binding passes to the adapter as `FieldRenderProps.value`.
   */
  valueOf(name: string): unknown;
  /**
   * Persist `value` for the `name` field through `settings.update({ [name]: value })`
   * and advance the reactive snapshot. Resolves when the update resolves; rejects
   * (leaving the snapshot unchanged) if it rejects — the same guarantee
   * {@link settingsSource}'s setter gives.
   */
  setValue(name: string, value: unknown): Promise<void>;
}

/** Per-handle cache of controllers, keyed by schema object identity. Both maps are weak. */
const controllers = new WeakMap<HostSDK, WeakMap<JSONSchema, SettingsFormController>>();

function createController(sdk: HostSDK, schema: JSONSchema): SettingsFormController {
  const fields = compileSchema(schema);
  const settings = settingsSource(sdk);
  // Index fields by name for O(1) default lookup in valueOf.
  const byName = new Map<string, FieldModel>(fields.map((f) => [f.name, f]));

  // Register the schema once, when the controller is first built for this pair
  // (the cache below ensures "once per (handle, schema)", not once per render).
  sdk.settings.onSchema(schema);

  return {
    fields,
    subscribe: settings.subscribe,
    getSnapshot: settings.getSnapshot,
    valueOf(name) {
      const current = settings.getSnapshot();
      if (name in current) return current[name];
      return byName.get(name)?.default;
    },
    setValue(name, value) {
      return settings.update({ [name]: value });
    },
  };
}

/**
 * The {@link SettingsFormController} for rendering `schema`'s settings form off `sdk` —
 * the seam a framework binding (React `useSettingsForm`, and the Phase-B Vue/vanilla
 * equivalents) binds to. Cached per handle and per schema object identity; the first
 * call for a `(handle, schema)` pair compiles the schema and calls
 * `settings.onSchema` once (see the module's caching note — pass a stable schema
 * reference).
 */
export function settingsFormController(sdk: HostSDK, schema: JSONSchema): SettingsFormController {
  let bySchema = controllers.get(sdk);
  if (bySchema === undefined) {
    bySchema = new WeakMap<JSONSchema, SettingsFormController>();
    controllers.set(sdk, bySchema);
  }
  let controller = bySchema.get(schema);
  if (controller === undefined) {
    controller = createController(sdk, schema);
    bySchema.set(schema, controller);
  }
  return controller;
}
