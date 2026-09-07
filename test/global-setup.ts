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
  const root = fileURLToPath(new URL('..', import.meta.url));

  execFileSync('node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], {
    cwd: root,
    stdio: 'inherit',
  });

  /**
   * The same assembly step `pnpm build` runs.
   *
   * `tsc` alone does not produce a complete `dist/`: the shipped skill pack is copied
   * and its shared references materialised by a script. Leaving that out here passed
   * locally purely because an earlier build had left the directory behind, and failed on
   * a clean checkout — so the bootstrap has to build everything the CLI needs, not just
   * the TypeScript.
   */
  execFileSync('node', ['scripts/build-skillpack.mjs'], { cwd: root, stdio: 'inherit' });

  /**
   * Also the executable bit, for the same reason.
   *
   * A developer running the suite rebuilds `dist/` in place — and a linked checkout's
   * global `agent-sync` points straight at the file `tsc` just rewrote. Skipping this
   * left them with "permission denied" from a command that worked minutes earlier, with
   * nothing connecting it to having run the tests.
   */
  execFileSync('node', ['scripts/chmod-bin.mjs'], { cwd: root, stdio: 'inherit' });

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
