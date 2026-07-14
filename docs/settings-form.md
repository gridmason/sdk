# The settings-form helper (FR-6)

A **schema-only widget** ships a JSON Schema for its settings and no custom settings
element. The settings-form helper renders that schema as an editable form in the
**host's** design system and round-trips the values through the handle. The widget
author writes one hook call; the host writes one adapter.

```tsx
import { useSettingsForm } from '@gridmason/sdk/react';

const SETTINGS_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', title: 'Title', default: 'Untitled' },
    theme: { type: 'string', title: 'Theme', enum: ['light', 'dark'] },
  },
  required: ['title'],
} as const;

function Settings({ sdk }: { sdk: HostSDK }) {
  // `hostAdapter` is supplied by the host; the SDK ships no field UI.
  return <form>{useSettingsForm(sdk, SETTINGS_SCHEMA, hostAdapter)}</form>;
}
```

## What the SDK owns vs. what the host owns

The helper owns the two things that should not be re-written per widget, and nothing
else:

- **The schema→field binding** — `compileSchema` turns the JSON Schema into an ordered
  list of framework-free `FieldModel`s (`name`, `control`, `label`, `required`,
  `default`, `options`).
- **The value round-trip** — it registers the schema once via `settings.onSchema`,
  seeds each field from `settings.get()` (or the schema `default`), and persists every
  edit through `settings.update({ [name]: value })`. This reuses the same
  `settingsSource` the `useSettings` helper uses, so a widget stays auditable by
  reading its SDK calls (one `onSchema`, a `get` seed, one `update` per edit).

The **host** owns what a field *looks like*: it implements a `SettingsFormAdapter`
once, against its design system, and every schema-only widget renders through it. The
SDK ships **no UI components** (SPEC non-goals §1) — only the contract, the compiler,
the controller, and the React binding. A dev/reference stub adapter exists purely for
tests and the Storybook story; it is not part of the published widget-author surface
and is excluded from the build.

## The pinned renderer approach (the FR-6 open question)

FR-6 left the JSON-schema form renderer open (spec Risks: "kept behind the adapter, so
swappable — pick in S-E2"). We pin a **thin compiler owned in this repo** rather than
adopting an off-the-shelf renderer, and keep it behind the `settings-form` adapter.

**Why not `@rjsf/core` (react-jsonschema-form) or `@jsonforms/*`:** both ship their own
UI widget set and are framework-coupled (rjsf is React-first; jsonforms binds a
renderer set per framework). Adopting either would violate two hard constraints of this
package at once — *the SDK ships no UI components* (SPEC §1) and *the helper core stays
framework-agnostic, depending on `@gridmason/protocol` only* (SPEC §7) — and would hand
the host's design system a competing widget set to fight.

**What "swappable" buys us:** because the renderer sits behind the adapter, the choice
is reversible without touching the widget-facing helper or the adapter contract. A host
is free to back its own `SettingsFormAdapter` with rjsf/jsonforms internally, and this
compiler can grow richer shapes, independently.

## v0 scope

v0 compiles a **top-level object schema** of scalar and single-choice properties — the
shape a settings object takes in practice:

| Schema property                          | Control    |
| ---------------------------------------- | ---------- |
| `boolean`                                | `checkbox` |
| `number` / `integer`                     | `number`   |
| any type with an `enum`                  | `select`   |
| `string` with `format: "textarea"`       | `textarea` |
| `string` (otherwise)                     | `text`     |

`title` → label (falling back to the property name), `description` → help text,
`default` → the value shown when the store has none, and the schema `required` array →
each field's `required` flag. `enumNames` (an rjsf convention) supplies option labels
when it aligns with `enum`; otherwise labels are `String(value)`, and non-string enum
values are carried through with their real type.

A property whose type v0 does not handle — a nested `object`, an `array`, `null`, or a
type-union — is **skipped**; a `select` with no options is skipped; and a schema that is
not a `type: "object"` with a `properties` object compiles to an empty form. Nested and
composite shapes are a future extension of this same compiler, behind the same adapter
contract — not a v0 promise.
