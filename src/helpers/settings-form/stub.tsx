/**
 * A **dev/reference** React `settings-form` adapter (docs/SPEC.md §5-style dev impl)
 * — the stub the settings-form tests and the Storybook story render through so the
 * helper can be exercised **without a real host design system**. It maps each
 * {@link FieldModel} to a bare, unstyled HTML input.
 *
 * ## Not the shipped API, by design
 *
 * This is the only place the settings-form helper emits markup, and it is
 * deliberately **not** part of the published widget-author surface (it is not
 * re-exported from `@gridmason/sdk/react`, and it is excluded from the build — see
 * `tsconfig.build.json`). "The SDK ships no UI components" (SPEC non-goals §1): the
 * real form fields come from the host's design system through its own
 * {@link SettingsFormAdapter}. This stub exists purely to prove the contract — the
 * same role `createNoopSDK` plays for the handle — and hosts may read it as a minimal
 * reference implementation.
 *
 * Non-string `enum` option values survive the round trip: each option renders with a
 * `String(value)` DOM value, and the change handler recovers the original typed value
 * by matching that string back to the option (so a numeric or boolean enum choice is
 * persisted with its real type, not coerced to a string).
 */

import type { ReactElement } from 'react';

import type {
  FieldModel,
  FieldRenderProps,
  FormRenderProps,
  SettingsFormAdapter,
} from './adapter.js';

/** Recover the typed `enum` value whose `String(value)` equals the selected string. */
function optionValue(field: FieldModel, selected: string): unknown {
  const match = field.options?.find((o) => String(o.value) === selected);
  return match !== undefined ? match.value : selected;
}

// The package compiles without the DOM lib (src is DOM-agnostic — see the interface
// module doc), so a change event's `currentTarget` is not typed with `.value`/`.checked`.
// Read them through these narrow casts rather than pulling the DOM lib into the build.
function currentValue(e: { readonly currentTarget: unknown }): string {
  return (e.currentTarget as { readonly value: string }).value;
}
function currentChecked(e: { readonly currentTarget: unknown }): boolean {
  return (e.currentTarget as { readonly checked: boolean }).checked;
}

/** Render one field's control. Split out so {@link reactStubAdapter} stays a thin map. */
function StubControl({ field, value, onChange }: FieldRenderProps): ReactElement {
  const testId = `field-${field.name}`;
  switch (field.control) {
    case 'checkbox':
      return (
        <input
          data-testid={testId}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(currentChecked(e))}
        />
      );
    case 'number':
      return (
        <input
          data-testid={testId}
          type="number"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => {
            const raw = currentValue(e);
            onChange(raw === '' ? undefined : Number(raw));
          }}
        />
      );
    case 'textarea':
      return (
        <textarea
          data-testid={testId}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(currentValue(e))}
        />
      );
    case 'select':
      return (
        <select
          data-testid={testId}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(optionValue(field, currentValue(e)))}
        >
          {field.options?.map((opt) => (
            <option key={String(opt.value)} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    case 'text':
    default:
      return (
        <input
          data-testid={testId}
          type="text"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(currentValue(e))}
        />
      );
  }
}

/**
 * The dev/reference React {@link SettingsFormAdapter}: each field is a labelled, bare
 * HTML control; {@link SettingsFormAdapter.form} wraps them in a plain `<div>`. Pass
 * it to `useSettingsForm` in tests, stories, and quick local demos — never as a host's
 * real adapter (see the module doc).
 */
export const reactStubAdapter: SettingsFormAdapter<ReactElement> = {
  field(props: FieldRenderProps): ReactElement {
    return (
      <label key={props.field.name} data-testid={`label-${props.field.name}`}>
        <span>{props.field.label}</span>
        {props.field.description !== undefined ? <small>{props.field.description}</small> : null}
        <StubControl {...props} />
      </label>
    );
  },
  form({ fields }: FormRenderProps<ReactElement>): ReactElement {
    return <div data-testid="settings-form">{fields}</div>;
  },
};
