/**
 * End-to-end: `init --create-remote`, driven against a stub `gh`.
 *
 * The stub is a real executable on PATH that makes a real bare repository, so the
 * exercised path is the whole thing — argument parsing, preflight, repository
 * creation, `git remote add`, and the first push — with only the network faked.
 *
 * POSIX only: the stub has to be an executable on PATH, and Node refuses to spawn the
 * `.cmd` shim Windows would need without a shell. The wrapper it stands in for is a
 * dozen lines of `execFileSync` with no platform-specific behaviour.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));
const posix = process.platform !== 'win32';

let workspace: string;
let home: string;
let stubBin: string;
let ghState: string;
/** PATH holding git but deliberately no gh, for the "not installed" case. */
let bareBin: string;

const GH_STUB = `#!/usr/bin/env node
// Stand-in for the GitHub CLI. Understands only the calls src/shell/github.ts makes.
const { execFileSync } = require('node:child_process');
const { appendFileSync, mkdirSync, existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const args = process.argv.slice(2);
const state = process.env.GH_STUB_DIR;
appendFileSync(join(state, 'calls.log'), args.join(' ') + '\\n');

// Each call is its own process, so "created earlier in this run" has to be read back
// from disk rather than remembered in memory.
const createdLog = join(state, 'existing.log');
const existing = [
  ...(process.env.GH_STUB_EXISTING ?? '').split(','),
  ...(existsSync(createdLog) ? readFileSync(createdLog, 'utf8').split('\\n') : []),
].filter(Boolean);
const login = process.env.GH_STUB_LOGIN ?? '';
const pathFor = (slug) => join(state, slug.replace('/', '__') + '.git');

if (args[0] === '--version') { console.log('gh version 2.0.0 (stub)'); process.exit(0); }

if (args[0] === 'api' && args[1] === 'user') {
  if (login === '') { console.error('You are not logged into any GitHub hosts.'); process.exit(1); }
  console.log(login); process.exit(0);
}

if (args[0] === 'config' && args[1] === 'get' && args[2] === 'git_protocol') {
  console.log(process.env.GH_STUB_PROTOCOL ?? 'https'); process.exit(0);
}

if (args[0] === 'repo' && args[1] === 'view') {
  const slug = args[2];
  if (!existing.includes(slug)) { console.error('Could not resolve to a Repository.'); process.exit(1); }
  // Both URL fields resolve to the same local bare repository, so a push really works.
  if (args.includes('sshUrl') || args.includes('url')) { console.log(pathFor(slug)); process.exit(0); }
  console.log(JSON.stringify({ name: slug.split('/')[1] })); process.exit(0);
}

if (args[0] === 'repo' && args[1] === 'create') {
  if (process.env.GH_STUB_FAIL_CREATE) { console.error('HTTP 403: permission denied'); process.exit(1); }
  const slug = args[2];
  const visibility = args.includes('--public') ? 'public' : 'private';
  appendFileSync(join(state, 'created.log'), slug + ' ' + visibility + '\\n');
  const bare = pathFor(slug);
  mkdirSync(bare, { recursive: true });
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', bare]);
  // A created repository is thereafter visible to \`repo view\`.
  appendFileSync(createdLog, slug + '\\n');
  console.log('Created repository ' + slug); process.exit(0);
}

console.error('stub gh: unhandled call: ' + args.join(' '));
process.exit(1);
`;

interface RunResult {
  readonly code: number;
  readonly stdout: string;
}

const run = (args: readonly string[], env: Record<string, string> = {}): RunResult => {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        PATH: `${stubBin}:${process.env.PATH ?? ''}`,
        GH_STUB_DIR: ghState,
        GH_STUB_LOGIN: 'Alpha-30-creator',
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        NO_COLOR: '1',
        ...env,
      },
    });
    return { code: 0, stdout };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failed.status ?? 1, stdout: `${failed.stdout ?? ''}${failed.stderr ?? ''}` };
  }
};

const gitIn = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim();

beforeAll(() => {
  workspace = join(tmpdir(), `agent-sync-init-remote-${process.pid}-${Date.now()}`);
  home = join(workspace, 'home');
  stubBin = join(workspace, 'bin');
  bareBin = join(workspace, 'bin-no-gh');
  ghState = join(workspace, 'gh-state');
  for (const dir of [home, stubBin, bareBin, ghState]) mkdirSync(dir, { recursive: true });
  for (const dir of ['.claude', '.codex', '.cursor']) {
    mkdirSync(join(home, dir), { recursive: true });
  }

  writeFileSync(join(stubBin, 'gh'), GH_STUB);
  chmodSync(join(stubBin, 'gh'), 0o755);

  // A PATH with git but no gh, to prove the "install the GitHub CLI" message.
  if (posix) {
    const gitBin = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    writeFileSync(join(bareBin, 'git'), `#!/bin/sh\nexec ${gitBin} "$@"\n`);
    chmodSync(join(bareBin, 'git'), 0o755);
  }
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(home, '.agent-sync'), { recursive: true, force: true });
  rmSync(ghState, { recursive: true, force: true });
  mkdirSync(ghState, { recursive: true });
});

describe.skipIf(!posix)('init --create-remote', () => {
  it('creates the repository, points the library at it, and pushes', () => {
    const result = run(['init', '--create-remote', 'agent-library', '--device', "Abdur's Mac"]);

    expect(result.code, result.stdout).toBe(0);
    expect(result.stdout).toContain('created private repository Alpha-30-creator/agent-library');
    expect(result.stdout).toContain('pushed your library to it');

    const store = join(home, '.agent-sync', 'store');
    const bare = join(ghState, 'Alpha-30-creator__agent-library.git');
    expect(gitIn(store, ['remote', 'get-url', 'origin'])).toBe(bare);
    // The push really happened: the bare repository has the store's commit on main.
    expect(gitIn(bare, ['log', '--oneline', '-1', 'main'])).toContain(
      'initialise agent-sync store',
    );
    expect(gitIn(bare, ['ls-tree', '--name-only', 'main'])).toContain('agent-sync.yaml');
  });

  it('defaults to private and makes public opt-in', () => {
    run(['init', '--create-remote', 'lib-a']);
    expect(run(['--json', 'init'], {}).code).toBe(0);

    rmSync(join(home, '.agent-sync'), { recursive: true, force: true });
    const result = run(['init', '--create-remote', 'lib-b', '--public']);
    expect(result.code, result.stdout).toBe(0);
    expect(result.stdout).toContain('created public repository');
  });

  it('honours an explicit owner', () => {
    const result = run(['init', '--create-remote', 'some-org/shared-library']);
    expect(result.code, result.stdout).toBe(0);
    expect(result.stdout).toContain('some-org/shared-library');
  });

  it('reports the repository in the json envelope', () => {
    const result = run(['--json', 'init', '--create-remote', 'agent-library']);
    expect(result.code, result.stdout).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      command: string;
      repository: string;
      published: boolean;
      remote: string;
    };
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe('init');
    expect(payload.repository).toBe('Alpha-30-creator/agent-library');
    expect(payload.published).toBe(true);
    expect(payload.remote).toContain('Alpha-30-creator__agent-library.git');
  });

  it('asks for the URL matching the protocol gh is configured for', () => {
    run(['init', '--create-remote', 'https-lib']);
    expect(readFileSync(join(ghState, 'calls.log'), 'utf8')).toContain('--json url');

    rmSync(join(home, '.agent-sync'), { recursive: true, force: true });
    rmSync(join(ghState, 'calls.log'), { force: true });
    run(['init', '--create-remote', 'ssh-lib'], { GH_STUB_PROTOCOL: 'ssh' });
    expect(readFileSync(join(ghState, 'calls.log'), 'utf8')).toContain('--json sshUrl');
  });

  it('refuses --remote and --create-remote together', () => {
    const result = run(['init', '--remote', 'git@github.com:me/lib.git', '--create-remote', 'lib']);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('contradict each other');
  });

  it('points a git URL at the flag that takes one', () => {
    const result = run(['init', '--create-remote', 'git@github.com:me/lib.git']);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('--remote');
  });

  it('refuses a repository that already exists, and suggests clone', () => {
    const result = run(['init', '--create-remote', 'agent-library'], {
      GH_STUB_EXISTING: 'Alpha-30-creator/agent-library',
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('already exists');
    expect(result.stdout).toContain('agent-sync clone');
  });

  it('explains an unauthenticated gh', () => {
    const result = run(['init', '--create-remote', 'agent-library'], { GH_STUB_LOGIN: '' });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('gh auth login');
  });

  it('explains a missing gh without pretending the name was wrong', () => {
    const result = run(['init', '--create-remote', 'agent-library'], { PATH: bareBin });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('GitHub CLI');
    expect(result.stdout).toContain('--remote');
  });

  it('writes nothing at all when the preflight fails', () => {
    const result = run(['init', '--create-remote', 'not a valid name']);
    expect(result.code).toBe(1);
    // The store is the user's library: a rejected invocation must not half-create it.
    expect(existsSync(join(home, '.agent-sync'))).toBe(false);
  });

  it('keeps the library when the repository cannot be created', () => {
    const result = run(['init', '--create-remote', 'agent-library'], { GH_STUB_FAIL_CREATE: '1' });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('your library is intact');
    // Local work survives a remote failure; only the remote is missing.
    expect(existsSync(join(home, '.agent-sync', 'store', 'agent-sync.yaml'))).toBe(true);
  });

  it('leaves plain init untouched', () => {
    const result = run(['init', '--device', 'plain']);
    expect(result.code, result.stdout).toBe(0);
    expect(result.stdout).not.toContain('repository');
    expect(existsSync(join(ghState, 'calls.log'))).toBe(false);
  });
});
