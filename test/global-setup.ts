import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Build the CLI once, before any suite runs.
 *
 * The end-to-end suites drive the built CLI from `dist/`. Each used to build it in its
 * own `beforeAll`, which meant several suites rewriting the same files while others
 * were executing them — a race that showed up as intermittent, Windows-only failures
 * with misleading symptoms (a definition reported missing moments after being written).
 */
export default function setup(): void {
  execFileSync('node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: 'inherit',
  });

  /**
   * Refuse a guessed git identity for every test process.
   *
   * A CI container cannot invent `user@hostname`, but a developer's machine can — so a
   * test that forgot to supply an identity passed locally and failed in CI, with the
   * real error swallowed by our git wrapper. Making the strict behaviour the default
   * means that gap shows up on the machine where it is cheap to fix.
   */
  process.env.GIT_CONFIG_COUNT = '1';
  process.env.GIT_CONFIG_KEY_0 = 'user.useConfigOnly';
  process.env.GIT_CONFIG_VALUE_0 = 'true';
}
