/**
 * Git via the system binary (ADR 0002): shelling out inherits the user's existing
 * auth — SSH agents, credential helpers, proxies — which reimplementing in-process
 * would not.
 */
import { execFileSync } from 'node:child_process';

export interface GitResult {
  readonly ok: boolean;
  readonly output: string;
}

export const git = (cwd: string, args: readonly string[]): GitResult => {
  try {
    const output = execFileSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, output: output.trim() };
  } catch (error) {
    const shell = error as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, output: (shell.stderr ?? shell.stdout ?? shell.message ?? '').trim() };
  }
};

export const isGitAvailable = (): boolean => git(process.cwd(), ['--version']).ok;

export const isRepository = (cwd: string): boolean =>
  git(cwd, ['rev-parse', '--is-inside-work-tree']).output === 'true';

export const init = (cwd: string): GitResult => git(cwd, ['init', '-q', '-b', 'main']);

export const hasChanges = (cwd: string): boolean =>
  git(cwd, ['status', '--porcelain']).output.length > 0;

/** Stage everything and commit. Returns false when there was nothing to commit. */
export const commitAll = (cwd: string, message: string): boolean => {
  git(cwd, ['add', '-A']);
  if (!hasChanges(cwd)) return false;
  return git(cwd, ['commit', '-q', '-m', message]).ok;
};

export const remoteUrl = (cwd: string): string | null => {
  const result = git(cwd, ['remote', 'get-url', 'origin']);
  return result.ok && result.output.length > 0 ? result.output : null;
};

export const setRemote = (cwd: string, url: string): GitResult =>
  remoteUrl(cwd) === null
    ? git(cwd, ['remote', 'add', 'origin', url])
    : git(cwd, ['remote', 'set-url', 'origin', url]);

export const clone = (url: string, destination: string): GitResult =>
  git(process.cwd(), ['clone', '-q', url, destination]);

export const pull = (cwd: string): GitResult => git(cwd, ['pull', '--rebase', '-q']);

export const push = (cwd: string): GitResult => git(cwd, ['push', '-q', '-u', 'origin', 'HEAD']);

/**
 * Normalised remote used as a project-linking hint (docs/04-sync-model.md §3a):
 * scheme, credentials, and a trailing `.git` are stripped so that ssh and https forms
 * of the same repository compare equal.
 */
export const normalizeRemote = (url: string): string => {
  const withoutScheme = url
    .trim()
    .replace(/^git\+/, '')
    .replace(/^[a-z]+:\/\//, '');
  const withoutCredentials = withoutScheme.replace(/^[^@/]+@/, '');
  const withSlashes = withoutCredentials.replace(/:(?=\D)/, '/');
  return withSlashes
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
};
