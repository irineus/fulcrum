import { defineConfig } from 'vitest/config';

// Two lanes, chosen by the script (card 03.3). `npm test` is `vitest run test/unit`: no
// network, every push, blocks a merge. `npm run test:contract` is `vitest run test/contract`:
// it runs against FULCRUM_URL and TARGET_URL (docs/testing.md §3.1) from the Contract
// workflow, never on a pull request (§4.1). A contract run with no configuration skips
// every group with a message instead of failing.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
    // A contract call crosses the internet twice (runner → edge → target).
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
