import { defineConfig } from 'vitest/config';

// Unit tests run anywhere. Contract tests (test/contract/) run against FULCRUM_URL and
// TARGET_URL (docs/testing.md) and are wired by card 03.3 — until then the directory only
// carries its README, so the `test:contract` script passes with no files instead of
// failing the CI lane.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
});
