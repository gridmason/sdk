/**
 * The schema→form compiler (docs/SPEC.md §4) — the **pinned renderer approach** for
 * FR-6. Turns a settings {@link JSONSchema} into an ordered list of framework-free
 * {@link FieldModel}s the host adapter renders.
 *
 * ## Why a compiler, not an off-the-shelf form renderer (the pinned choice)
 *
 * FR-6 left the JSON-schema form renderer open (spec Risks). The mainstream
 * libraries — `@rjsf/core` (react-jsonschema-form) and `@jsonforms/*` — each **ship
 * their own UI widget set and are framework-coupled** (rjsf is React-first; jsonforms
 * binds a renderer set per framework). Adopting one would violate two hard
 * constraints of this package at once: *no UI components ship from the SDK* (SPEC
 * non-goals §1) and *the helper core stays framework-agnostic, depending on
 * `@gridmason/protocol` only* (SPEC §7). It would also hand the host's design system
 * a competing widget set to fight.
 *
 * So the pinned approach is a **thin compiler owned here**: parse the schema into
 * plain {@link FieldModel} data and let the host's `settings-form` adapter supply the
 * actual inputs (`./adapter.ts`). The SDK owns the *binding* (schema → fields → value
 * round-trip); the host owns the *look*. This keeps the renderer **swappable behind
 * the adapter** exactly as FR-6 asks — a host may back its adapter with rjsf/jsonforms
 * internally if it wants, and this compiler can grow richer shapes, without either
 * change touching the widget-facing helper or the adapter contract. See
 * `docs/settings-form.md` for the full rationale.
 *
 * ## v0 scope (documented, intentional)
 *
 * A settings object is flat scalars in practice, so v0 compiles a **top-level object
 * schema** of scalar and single-choice (`enum`) properties:
 *
 * - `boolean` → `checkbox`
 * - `number` / `integer` → `number`
 * - a property with an `enum` (any scalar type) → `select`
 * - `string` with `format: 'textarea'` → `textarea`
 * - `string` (otherwise) → `text`
 *
 * `title`/`description`/`default`/`required` map onto the {@link FieldModel}. A
 * property whose type the compiler does not handle (nested `object`, `array`, `null`,
 * a type-union) is **skipped** — nested composition is a future extension of this
 * same compiler, not a v0 promise. A schema that is not a `type: "object"` with a
 * `properties` object compiles to `[]` (nothing to render).
 */

import type { JSONSchema } from '../../interface/index.js';
import type { FieldControl, FieldModel, FieldOption } from './adapter.js';

/** A JSON object at compile time — the shape both a schema and its properties take. */
type JsonObject = { readonly [key: string]: unknown };

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a property's `type`. JSON Schema allows a string or an array of strings; the
 * compiler handles only a single scalar type, so an array (type-union) yields
 * `undefined` and the property is skipped.
 */
function scalarType(prop: JsonObject): string | undefined {
  return typeof prop.type === 'string' ? prop.type : undefined;
}

/** Compile a property's `enum` into {@link FieldOption}s, honouring `enumNames` when aligned. */
function compileOptions(prop: JsonObject): readonly FieldOption[] | undefined {
  if (!Array.isArray(prop.enum)) return undefined;
  // `enumNames` (an rjsf convention) supplies human labels positionally; use it only
  // when it is a string array of matching length, else fall back to String(value).
  const names =
    Array.isArray(prop.enumNames) && prop.enumNames.length === prop.enum.length
      ? prop.enumNames
      : undefined;
  return prop.enum.map((value, i) => {
    const name = names?.[i];
    return { value, label: typeof name === 'string' ? name : String(value) };
  });
}

/** Decide the {@link FieldControl} for a property; `undefined` = a shape v0 does not render. */
function controlFor(prop: JsonObject): FieldControl | undefined {
  // An `enum` is a single-choice field regardless of the underlying scalar type.
  if (Array.isArray(prop.enum)) return 'select';
  switch (scalarType(prop)) {
    case 'boolean':
      return 'checkbox';
    case 'number':
    case 'integer':
      return 'number';
    case 'string':
      return prop.format === 'textarea' ? 'textarea' : 'text';
    default:
      // object / array / null / type-union / missing type — skipped in v0.
      return undefined;
  }
}

/** Compile one property to a {@link FieldModel}, or `undefined` to skip it. */
function compileField(name: string, prop: unknown, required: ReadonlySet<string>): FieldModel | undefined {
  if (!isJsonObject(prop)) return undefined;
  const control = controlFor(prop);
  if (control === undefined) return undefined;

  const options = control === 'select' ? compileOptions(prop) : undefined;
  // A select with no usable options has nothing to choose from — skip it.
  if (control === 'select' && (options === undefined || options.length === 0)) return undefined;

  // Build with exactOptionalPropertyTypes in mind: omit optional keys entirely rather
  // than setting them to `undefined`.
  return {
    name,
    control,
    label: typeof prop.title === 'string' ? prop.title : name,
    required: required.has(name),
    ...(typeof prop.description === 'string' ? { description: prop.description } : {}),
    ...('default' in prop ? { default: prop.default } : {}),
    ...(options !== undefined ? { options } : {}),
  };
}

/**
 * Compile a settings {@link JSONSchema} into the ordered {@link FieldModel}s the
 * settings-form helper renders through a host adapter. Fields come out in the schema's
 * `properties` insertion order. See the module doc for the v0 shape rules; a schema
 * with no compilable properties yields `[]`.
 */
export function compileSchema(schema: JSONSchema): readonly FieldModel[] {
  if (!isJsonObject(schema)) return [];
  // Only a top-level object schema describes a settings form (v0).
  if (schema.type !== 'object' || !isJsonObject(schema.properties)) return [];

  const required = new Set<string>(
    Array.isArray(schema.required) ? schema.required.filter((k): k is string => typeof k === 'string') : [],
  );

  const fields: FieldModel[] = [];
  for (const [name, prop] of Object.entries(schema.properties)) {
    const field = compileField(name, prop, required);
    if (field !== undefined) fields.push(field);
  }
  return fields;
}
