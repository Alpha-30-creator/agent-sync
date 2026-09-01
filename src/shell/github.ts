/**
 * GitHub via the `gh` binary.
 *
 * Same reasoning as git (ADR 0002): shelling out inherits the auth the user already
 * has. `gh` is an optional dependency — nothing in agent-sync needs it except
 * `init --create-remote`, so its absence is a clear message on that one path rather
 * than a startup requirement.
 */
import { execFileSync } from 'node:child_process';

export type GhOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const gh = (args: readonly string[]): { ok: boolean; output: string } => {
  try {
    const output = execFileSync('gh', [...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    return { ok: true, output: output.trim() };
  } catch (error) {
    const shell = error as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, output: (shell.stderr ?? shell.stdout ?? shell.message ?? '').trim() };
  }
};

export const isGhAvailable = (): boolean => gh(['--version']).ok;

/** The login `gh` is authenticated as — also the default owner for a new repository. */
export const authenticatedLogin = (): GhOutcome<string> => {
  const result = gh(['api', 'user', '--jq', '.login']);
  if (!result.ok || result.output.length === 0) {
    return {
      ok: false,
      message:
        'gh is installed but not authenticated — run:\n' +
        '  gh auth login\n' +
        (result.output.length > 0 ? `\n${result.output}` : ''),
    };
  }
  return { ok: true, value: result.output };
};

export const repoExists = (slug: string): boolean =>
  gh(['repo', 'view', slug, '--json', 'name']).ok;

/**
 * The clone protocol `gh` is configured for.
 *
 * Handing back an ssh URL to someone whose gh is set to https gives them a remote their
 * credential helper does not cover, and the failure only shows up at the first push.
 * gh's own default is https, so that is the fallback when the setting is unreadable.
 */
export const gitProtocol = (): 'ssh' | 'https' => {
  const result = gh(['config', 'get', 'git_protocol']);
  return result.ok && result.output === 'ssh' ? 'ssh' : 'https';
};

/**
 * Create an empty repository and return the URL to sync through.
 *
 * Deliberately does not pass `--source`/`--push`: the store is pushed by git afterwards
 * so that one code path owns publishing the library, whether or not gh created the repo.
 */
export const createRepo = (slug: string, visibility: 'private' | 'public'): GhOutcome<string> => {
  const created = gh(['repo', 'create', slug, `--${visibility}`]);
  if (!created.ok) return { ok: false, message: created.output };

  const protocol = gitProtocol();
  const field = protocol === 'ssh' ? 'sshUrl' : 'url';
  const url = gh(['repo', 'view', slug, '--json', field, '--jq', `.${field}`]);
  if (!url.ok || url.output.length === 0) {
    return { ok: false, message: `created ${slug} but could not read its URL:\n${url.output}` };
  }
  // gh reports the https clone URL without the .git suffix; git accepts either, but the
  // suffixed form is what every other tool writes into a remote.
  const value =
    protocol === 'https' && !url.output.endsWith('.git') ? `${url.output}.git` : url.output;
  return { ok: true, value };
};
