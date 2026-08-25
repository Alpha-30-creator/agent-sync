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
}
