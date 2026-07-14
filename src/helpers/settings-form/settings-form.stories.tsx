/**
 * Storybook story for the settings-form helper (docs/SPEC.md §7, FR-6). It mounts a
 * **schema-only widget** — one that ships a settings JSON Schema but no custom
 * settings element — and renders its editable form through {@link useSettingsForm}
 * and the dev {@link reactStubAdapter}, backed by a {@link createFixtureSDK} handle so
 * edits actually persist (`settings.update`) and the live settings JSON updates as you
 * type. It stands in for a host: a real host swaps the stub for its design-system
 * `SettingsFormAdapter`, and this same helper renders the identical form themed.
 *
 * This file (and the stub it imports) is a dev artifact — excluded from the published
 * build (`tsconfig.build.json`); the SDK ships no field UI (SPEC non-goals §1).
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import type { ReactElement } from 'react';

import { createFixtureSDK } from '../../fixture/index.js';
import type { HostSDK, JSONSchema } from '../../interface/index.js';

import { useSettingsForm } from './react.js';
import { reactStubAdapter } from './stub.js';

/** A representative flat settings schema exercising every v0 control kind. */
const SETTINGS_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      title: 'Title',
      description: 'Shown in the widget header.',
      default: 'Untitled',
    },
    rows: { type: 'integer', title: 'Rows', default: 5 },
    compact: { type: 'boolean', title: 'Compact mode' },
    theme: {
      type: 'string',
      title: 'Theme',
      enum: ['light', 'dark', 'system'],
      enumNames: ['Light', 'Dark', 'System'],
      default: 'system',
    },
    notes: { type: 'string', title: 'Notes', format: 'textarea' },
  },
  required: ['title'],
};

/**
 * The demo widget: renders the settings form and, below it, the live settings the
 * edits persist into — the schema→form binding and the value round-trip in one view.
 */
function SettingsFormDemo(): ReactElement {
  // A fixture handle stands in for a host: settings.update is data-bearing, so edits
  // round-trip. Created once per mount.
  const [sdk] = useState<HostSDK>(() =>
    createFixtureSDK({}, { settings: { title: 'Sales snapshot' } }),
  );
  const form = useSettingsForm(sdk, SETTINGS_SCHEMA, reactStubAdapter);

  return (
    <section style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 420 }}>
      <h3>Widget settings</h3>
      {form}
      <h4 style={{ marginTop: 24 }}>Persisted settings</h4>
      <pre data-testid="live-settings" style={{ background: '#f4f4f5', padding: 12, borderRadius: 6 }}>
        {JSON.stringify(sdk.settings.get(), null, 2)}
      </pre>
    </section>
  );
}

const meta: Meta<typeof SettingsFormDemo> = {
  title: 'Helpers/SettingsForm',
  component: SettingsFormDemo,
  parameters: { layout: 'padded' },
};

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Edit any field — the "Persisted settings" block updates live, proving the helper
 * persisted the change through `settings.update`.
 */
export const Default: Story = {};
