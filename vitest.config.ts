import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Builds the CLI once for the whole run; see test/global-setup.ts.
    globalSetup: ['test/global-setup.ts'],
    // The e2e suites spawn the real CLI, which spawns git: a handful of process
    // launches per test. Vitest's 5s default is enough on a warm developer machine and
    // not on a cold Windows runner, where the first test in a file has timed out at
    // 5.6s while passing everywhere else. Time out on genuine hangs, not on a slow box.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli/**'],
      thresholds: {
        // The pure core has no excuse for untested branches (ADR 0004).
        'src/core/**/*.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
      },
    },
  },
});
