/**
 * The `settings-form` **adapter contract** (docs/SPEC.md §4) — the shape a **host**
 * supplies so the settings-form helper can render an editable settings form in the
 * host's own design system.
 *
 * ## The boundary this file draws
 *
 * The SDK ships **no UI components** (SPEC non-goals §1): a settings form is drawn
 * with the *host's* design-system inputs (its themed text field, its select, its
 * checkbox), never with markup the SDK hard-codes. The settings-form helper owns the
 * two things a widget author should not re-write per widget — the **schema→field
 * binding** (turning a JSON Schema into an ordered list of typed {@link FieldModel}s,
 * see `./schema.js`) and the **value round-trip** (seeding from `settings.get()`,
 * persisting each edit through `settings.update()`, see `./controller.js`). What a
 * field *looks like* is the host's, delivered through this adapter.
 *
 * A host implements {@link SettingsFormAdapter} once, against its design system; every
 * schema-only widget then renders through it. This package ships only the contract
 * here plus a dev/reference stub (`./stub.js`, test/story use) — the real adapter
 * lives in the host repos (gridmason/dashboard).
 *
 * ## Framework-agnostic by construction
 *
 * The contract is generic over the framework node type `N` a field renders to (a
 * React element, a Vue VNode, an `HTMLElement`, a string in a test double), so the
 * one contract serves the React reference adapter and the Phase-B Vue/vanilla
 * adapters (#10) without change. The {@link FieldModel} carried across it is plain
 * data — no framework, no DOM — exactly like every other seam in the helper core.
 */

/**
 * The control kind a {@link FieldModel} asks the adapter to render. A small, closed
 * vocabulary the schema compiler (`./schema.js`) maps JSON-Schema property shapes
 * onto; a host adapter renders each to a design-system input. Deliberately minimal
 * for v0 (scalar + enum settings) — richer shapes (nested objects, arrays) are a
 * future extension of the same compiler, behind this same contract.
 */
export type FieldControl = 'text' | 'textarea' | 'number' | 'checkbox' | 'select';

/** One selectable option of a `select` {@link FieldModel} (from the schema `enum`). */
export interface FieldOption {
  /** The value written to settings when this option is chosen. */
  readonly value: unknown;
  /** Human-readable label (schema `enumNames` entry when present, else `String(value)`). */
  readonly label: string;
}

/**
 * One editable field the settings form renders — the compiled, framework-free
 * description of a single settings property that the schema compiler (`./schema.js`)
 * produces and the adapter turns into a design-system input. Plain data: it names
 * *what* to render and *how it binds to settings*, never *how it looks*.
 */
export interface FieldModel {
  /**
   * The settings property key this field reads and writes (a top-level key of the
   * `WidgetSettings` object in v0). Used as the `settings.update` patch key and as a
   * stable render key.
   */
  readonly name: string;
  /** Which {@link FieldControl} the adapter should render. */
  readonly control: FieldControl;
  /** Human label — the schema property's `title`, falling back to {@link name}. */
  readonly label: string;
  /** Help text — the schema property's `description`, when present. */
  readonly description?: string;
  /** Whether the schema's `required` array lists this property. */
  readonly required: boolean;
  /** The schema property's `default`, used as the field value when settings has none. */
  readonly default?: unknown;
  /** For a `select` control: the allowed options (from the schema `enum`). */
  readonly options?: readonly FieldOption[];
}

/**
 * What the adapter's {@link SettingsFormAdapter.field} receives for one field: the
 * compiled {@link FieldModel}, the value to show, and the change callback to call
 * with the field's next value. Calling `onChange(next)` is what drives the helper's
 * `settings.update` round-trip — the adapter never touches the handle itself.
 */
export interface FieldRenderProps {
  /** The field to render. */
  readonly field: FieldModel;
  /**
   * The current value for this field — the saved settings value, or the field's
   * {@link FieldModel.default} when settings has none yet. Opaque JSON; the adapter
   * coerces it to its input as the {@link FieldModel.control} implies.
   */
  readonly value: unknown;
  /**
   * Report the field's next value. The helper persists it through
   * `settings.update({ [field.name]: next })` and advances the reactive snapshot, so
   * the adapter is a pure view — it renders `value` and reports edits, nothing more.
   */
  readonly onChange: (next: unknown) => void;
}

/** What {@link SettingsFormAdapter.form} receives: the already-rendered field nodes. */
export interface FormRenderProps<N> {
  /** The rendered fields, in schema order, for the adapter to arrange/wrap. */
  readonly fields: readonly N[];
}

/**
 * The `settings-form` adapter a **host** implements (its design system's field
 * components). Generic over the rendered node type `N`.
 *
 * - {@link SettingsFormAdapter.field} is required: render one {@link FieldModel} to a
 *   node, wiring the design-system input's value to `props.value` and its change
 *   event to `props.onChange`.
 * - {@link SettingsFormAdapter.form} is optional: wrap the rendered fields (a
 *   fieldset, a layout grid, a submit affordance). When omitted, the helper returns
 *   the bare field nodes for the widget to arrange.
 */
export interface SettingsFormAdapter<N> {
  /** Render a single field. See {@link FieldRenderProps}. */
  field(props: FieldRenderProps): N;
  /** Optionally wrap the rendered fields. See {@link FormRenderProps}. */
  form?(props: FormRenderProps<N>): N;
}
