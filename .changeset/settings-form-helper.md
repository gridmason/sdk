---
'@gridmason/sdk': minor
---

Add the settings-form helper (FR-6): a schema-only widget renders an editable
settings form in the host's design system via a host-supplied `settings-form`
adapter, and edits round-trip through `settings.update`.

- Framework-agnostic core (from `@gridmason/sdk`): the `SettingsFormAdapter` contract,
  a `compileSchema` JSON-Schema→field compiler (the pinned renderer approach — kept
  behind the adapter, so swappable; see `docs/settings-form.md`), and a
  `settingsFormController` that owns the schema→form binding and value round-trip
  (registering the schema once via `settings.onSchema`, reusing the `useSettings`
  source).
- React binding (from `@gridmason/sdk/react`): `useSettingsForm(sdk, schema, adapter)`.
- The SDK ships no field UI — the host supplies its design-system components through
  the adapter. A dev/reference stub adapter backs the tests and the new Storybook
  story only (not published).
