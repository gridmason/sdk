import { defineConfig } from 'vitest/config';

// Scaffold test config (issue #2). The SDK carries no coverage gate yet — the
// conformance kit and helper suites that will earn one land in S-E1/S-E2
// (issues #5–#8, #10–#13). Coverage is reported (npm run coverage) but not
// thresholded until those paths exist.
export default defineConfig({
  // The React helper suite (issue #8) writes JSX; esbuild picks up the automatic
  // runtime from tsconfig's `"jsx": "react-jsx"`, so a test needs no `import React`.
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'lcov', 'html'],
    },
  },
});
