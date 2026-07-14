import type { StorybookConfig } from '@storybook/react-vite';

/**
 * Minimal Storybook (SPEC §7) — added by issue #11 for the settings-form helper.
 * The repo had no Storybook; this is the lean seed (react-vite framework, no addons)
 * that renders the helper through the dev stub adapter so the schema→form binding is
 * visible without a real host design system. Later helper stories are added as
 * `.stories.tsx` files under `src`.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
};

export default config;
