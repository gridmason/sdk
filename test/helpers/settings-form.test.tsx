// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, test } from 'vitest';

import { createFixtureSDK, getFixtureControls } from '../../src/fixture/index.js';
import type { FixtureSDK } from '../../src/fixture/index.js';
import type { HostSDK, JSONSchema, SettingsFormAdapter } from '../../src/index.js';
import { useSettings, useSettingsForm } from '../../src/helpers/react/index.js';
import { reactStubAdapter } from '../../src/helpers/settings-form/stub.js';

/**
 * Issue #11 (FR-6): the settings-form helper. The acceptance criterion is the headline
 * test — a **schema-only widget** (a settings JSON Schema, no custom settings element)
 * renders an editable form through the dev stub adapter, and every edit persists
 * through `settings.update` and re-renders. The remaining tests cover the value
 * round-trip per control (including a typed non-string `select`), that `settings.onSchema`
 * is registered exactly once across re-renders, default-vs-saved value seeding, and the
 * optional `form` wrapper branch.
 *
 * Persisted state is asserted through the recorded SDK calls and the fixture's
 * data-bearing `settings.get()`; reactivity through a rendered text marker. The package
 * compiles without the DOM lib, so the tests stay off `HTMLElement`-typed accessors
 * (same discipline as the React helper suite) — a queried node is only ever handed to
 * `fireEvent`, never read for its properties.
 */

afterEach(cleanup);

const SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', title: 'Title', default: 'Untitled' },
    rows: { type: 'integer', title: 'Rows', default: 5 },
    compact: { type: 'boolean', title: 'Compact mode' },
    theme: { type: 'string', title: 'Theme', enum: ['light', 'dark', 'system'], default: 'system' },
    notes: { type: 'string', title: 'Notes', format: 'textarea' },
  },
  required: ['title'],
};

/** A schema-only widget: renders the settings form and a reactive title marker. */
function SettingsWidget({
  sdk,
  schema = SCHEMA,
  adapter = reactStubAdapter,
}: {
  sdk: HostSDK;
  schema?: JSONSchema;
  adapter?: SettingsFormAdapter<ReactElement>;
}): ReactElement {
  const form = useSettingsForm(sdk, schema, adapter);
  const [settings] = useSettings(sdk);
  return (
    <div>
      {form}
      <p>{`title:${String(settings.title ?? '')}`}</p>
    </div>
  );
}

function makeSDK(settings: Record<string, unknown> = {}): FixtureSDK {
  return createFixtureSDK({}, { settings });
}

/** Fire `edit`, then flush the async settings.update state advance inside act. */
async function editing(edit: () => void): Promise<void> {
  await act(async () => {
    edit();
  });
}

describe('settings-form — acceptance (FR-6): schema-only widget, editable via stub, edits persist', () => {
  test('renders a field per schema property and persists each edit through settings.update', async () => {
    const sdk = makeSDK({ title: 'Sales snapshot' });
    render(<SettingsWidget sdk={sdk} />);

    // A field rendered per compiled property (schema order), through the stub adapter.
    for (const name of ['title', 'rows', 'compact', 'theme', 'notes']) {
      expect(screen.getByTestId(`field-${name}`)).toBeDefined();
    }
    // The schema was registered exactly once.
    const recorder = getFixtureControls(sdk).recorder;
    expect(recorder.callsTo('settings.onSchema')).toHaveLength(1);
    expect(recorder.last('settings.onSchema')?.args).toEqual([SCHEMA]);

    // The seeded value shows; a field the store lacks shows its schema default but is
    // not persisted until edited.
    screen.getByText('title:Sales snapshot');
    expect(sdk.settings.get()).toEqual({ title: 'Sales snapshot' });

    // Edit the title → exactly one settings.update, the store advances, and the marker
    // re-renders.
    await editing(() =>
      fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'Renamed' } }),
    );
    expect(recorder.callsTo('settings.update')).toHaveLength(1);
    expect(recorder.last('settings.update')?.args).toEqual([{ title: 'Renamed' }]);
    expect(sdk.settings.get()).toMatchObject({ title: 'Renamed' });
    await screen.findByText('title:Renamed');
  });

  test('round-trips each control type with its native value', async () => {
    const sdk = makeSDK({ title: 'x' });
    render(<SettingsWidget sdk={sdk} />);
    const recorder = getFixtureControls(sdk).recorder;

    await editing(() =>
      fireEvent.change(screen.getByTestId('field-rows'), { target: { value: '7' } }),
    );
    expect(recorder.last('settings.update')?.args).toEqual([{ rows: 7 }]); // number, not '7'

    await editing(() => fireEvent.click(screen.getByTestId('field-compact')));
    expect(recorder.last('settings.update')?.args).toEqual([{ compact: true }]); // boolean

    await editing(() =>
      fireEvent.change(screen.getByTestId('field-theme'), { target: { value: 'dark' } }),
    );
    expect(recorder.last('settings.update')?.args).toEqual([{ theme: 'dark' }]);

    await editing(() =>
      fireEvent.change(screen.getByTestId('field-notes'), { target: { value: 'a note' } }),
    );
    expect(recorder.last('settings.update')?.args).toEqual([{ notes: 'a note' }]);

    expect(sdk.settings.get()).toEqual({
      title: 'x',
      rows: 7,
      compact: true,
      theme: 'dark',
      notes: 'a note',
    });
  });

  test('a non-string enum select persists its typed (numeric) value', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { level: { type: 'integer', title: 'Level', enum: [1, 2, 3] } },
    };
    const sdk = makeSDK();
    render(<SettingsWidget sdk={sdk} schema={schema} />);
    await editing(() =>
      fireEvent.change(screen.getByTestId('field-level'), { target: { value: '2' } }),
    );
    // Recovered as the number 2, not the string "2".
    expect(getFixtureControls(sdk).recorder.last('settings.update')?.args).toEqual([{ level: 2 }]);
    expect(sdk.settings.get()).toEqual({ level: 2 });
  });
});

describe('settings-form — registration, seeding, and the form wrapper', () => {
  test('settings.onSchema is called once across re-renders (controller is cached)', async () => {
    const sdk = makeSDK({ title: 'x' });
    const view = render(<SettingsWidget sdk={sdk} />);
    view.rerender(<SettingsWidget sdk={sdk} />);
    await editing(() =>
      fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'y' } }),
    );
    view.rerender(<SettingsWidget sdk={sdk} />);
    expect(getFixtureControls(sdk).recorder.callsTo('settings.onSchema')).toHaveLength(1);
  });

  test('the default stub wraps fields in a form container; a form-less adapter returns bare fields', () => {
    const sdk = makeSDK({ title: 'x' });
    const { rerender } = render(<SettingsWidget sdk={sdk} />);
    // Default stub provides `form` → the wrapper node is present.
    expect(screen.getByTestId('settings-form')).toBeDefined();

    // An adapter without `form` yields the bare field nodes (no wrapper).
    const fieldOnly: SettingsFormAdapter<ReactElement> = { field: reactStubAdapter.field };
    rerender(<SettingsWidget sdk={sdk} adapter={fieldOnly} />);
    expect(screen.queryByTestId('settings-form')).toBeNull();
    expect(screen.getByTestId('field-title')).toBeDefined();
  });
});
