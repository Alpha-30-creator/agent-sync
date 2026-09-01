/**
 * Make the built CLI executable.
 *
 * npm sets the executable bit on a package's `bin` when it installs one, so a published
 * `npm i -g agent-sync` never needs this. A *linked* checkout does: the global symlink
 * points straight at `dist/cli/index.js`, and a clean build writes that file fresh with
 * the default 644, which turns the linked command into "permission denied" — a confusing
 * failure a long way from its cause.
 *
 * chmod is a no-op for permissions on Windows rather than an error, so this is safe in
 * the 3-OS matrix.
 */
import { chmodSync } from 'node:fs';

chmodSync(new URL('../dist/cli/index.js', import.meta.url), 0o755);
