import { defineConfig } from 'vitest/config';

// Scaffold test config (issue #2). The SDK carries no coverage gate yet — the
// conformance kit and helper suites that will earn one land in S-E1/S-E2
// (issues #5–#8, #10–#13). Coverage is reported (npm run coverage) but not
// thresholded until those paths exist.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'lcov', 'html'],
    },
  },
});
