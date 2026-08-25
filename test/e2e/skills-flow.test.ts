/**
 * End-to-end: the real CLI, driven against fabricated home directories.
 *
 * These are the golden scenarios from docs/07-testing.md §5 — the ones that prove the
 * product promise rather than any single module: a skill created once reaches all
 * three agents, a second device reaches parity, and a hand-edited file is never lost.
 */
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));

let workspace: string;
let deviceOne: string;
let deviceTwo: string;
let remote: string;

interface RunResult {
  readonly code: number;
  readonly stdout: string;
}

const run = (home: string, args: readonly string[]): RunResult => {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        // Keep the committer identity independent of whoever runs the suite.
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        NO_COLOR: '1',
      },
    });
    return { code: 0, stdout };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failed.status ?? 1, stdout: `${failed.stdout ?? ''}${failed.stderr ?? ''}` };
  }
};

const skillPath = (home: string, agentDir: string, id: string): string =>
  join(home, agentDir, 'skills', id, 'SKILL.md');

/**
 * Give a fabricated home the footprint of all three agents.
 *
 * Without this the suite silently depends on what happens to be installed on the host:
 * it passed on a developer machine with every agent on PATH and deployed nothing on a
 * bare CI runner. Agent detection keys on the CLI *or* the agent's home directory, so
 * creating the directories makes these tests deterministic everywhere.
 */
const fabricateAgents = (home: string): void => {
  for (const dir of ['.claude', '.codex', '.cursor']) {
    mkdirSync(join(home, dir), { recursive: true });
  }
};

beforeAll(() => {
  workspace = join(tmpdir(), `agent-sync-e2e-${process.pid}-${Date.now()}`);
  deviceOne = join(workspace, 'device-one');
  deviceTwo = join(workspace, 'device-two');
  remote = join(workspace, 'remote.git');
  mkdirSync(deviceOne, { recursive: true });
  mkdirSync(deviceTwo, { recursive: true });
  fabricateAgents(deviceOne);
  fabricateAgents(deviceTwo);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('scenario 1: a skill created once reaches every agent', () => {
  it('initialises a store and registers the device', () => {
    const result = run(deviceOne, ['init', '--device', 'device-one', '--remote', remote]);
    expect(result.code).toBe(0);
    expect(existsSync(join(deviceOne, '.agent-sync', 'store', 'agent-sync.yaml'))).toBe(true);
  });

  it('scaffolds a skill in the store, not in an agent directory', () => {
    const result = run(deviceOne, [
      'new',
      'skill',
      'sql-review',
      '--description',
      'Review migrations',
    ]);
    expect(result.code).toBe(0);
    // Born in the library: nothing is deployed until apply runs.
    expect(
      existsSync(join(deviceOne, '.agent-sync', 'store', 'skills', 'sql-review', 'SKILL.md')),
    ).toBe(true);
    expect(existsSync(skillPath(deviceOne, '.claude', 'sql-review'))).toBe(false);
  });

  it('shows the plan without touching anything (dry run)', () => {
    const result = run(deviceOne, ['apply', '--dry-run']);
    expect(result.stdout).toContain('nothing was written');
    expect(existsSync(skillPath(deviceOne, '.claude', 'sql-review'))).toBe(false);
  });

  it('deploys to claude, codex, and cursor', () => {
    expect(run(deviceOne, ['apply']).code).toBe(0);
    for (const dir of ['.claude', '.codex', '.cursor']) {
      expect(existsSync(skillPath(deviceOne, dir, 'sql-review'))).toBe(true);
    }
  });

  it('is idempotent: applying again changes nothing', () => {
    const result = run(deviceOne, ['apply']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('already in sync');
  });

  it('reports every deployment as synced in status', () => {
    const result = run(deviceOne, ['--json', 'status']);
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      targets: { agent: string }[];
      operations: unknown[];
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.targets.map((t) => t.agent).sort()).toEqual(['claude', 'codex', 'cursor']);
    expect(parsed.operations).toEqual([]);
  });
});

describe('scenario 2: a hand-edited deployment is never destroyed', () => {
  it('refuses to overwrite an edited file and asks instead (exit 3)', () => {
    appendFileSync(skillPath(deviceOne, '.claude', 'sql-review'), '\nHAND EDIT\n');
    const result = run(deviceOne, ['apply']);
    expect(result.code).toBe(3);
    expect(result.stdout).toContain('adopt the edit');
    expect(readFileSync(skillPath(deviceOne, '.claude', 'sql-review'), 'utf8')).toContain(
      'HAND EDIT',
    );
  });

  it('adopts the edit back into the library on request', () => {
    const result = run(deviceOne, ['apply', '--adopt']);
    expect(result.code).toBe(0);
    const stored = readFileSync(
      join(deviceOne, '.agent-sync', 'store', 'skills', 'sql-review', 'SKILL.md'),
      'utf8',
    );
    expect(stored).toContain('HAND EDIT');
  });

  it('propagates the adopted version to the other agents', () => {
    expect(run(deviceOne, ['apply']).code).toBe(0);
    expect(readFileSync(skillPath(deviceOne, '.codex', 'sql-review'), 'utf8')).toContain(
      'HAND EDIT',
    );
  });

  it('overwrites instead when asked to', () => {
    appendFileSync(skillPath(deviceOne, '.cursor', 'sql-review'), '\nTHROWAWAY\n');
    expect(run(deviceOne, ['apply', '--overwrite']).code).toBe(0);
    expect(readFileSync(skillPath(deviceOne, '.cursor', 'sql-review'), 'utf8')).not.toContain(
      'THROWAWAY',
    );
  });

  it('never touches a file it does not manage', () => {
    const foreign = join(deviceTwo, '.claude', 'skills', 'not-ours');
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, 'SKILL.md'), 'someone else wrote this');
    // device two is set up in scenario 3; this file must survive that whole flow.
    expect(readFileSync(join(foreign, 'SKILL.md'), 'utf8')).toBe('someone else wrote this');
  });
});

describe('scenario 3: a second device reaches parity', () => {
  it('pushes the library to the remote', () => {
    const result = run(deviceOne, ['save', '-m', 'add sql-review']);
    expect(result.code).toBe(0);
  });

  it('clones onto a fresh device', () => {
    const result = run(deviceTwo, ['clone', remote, '--device', 'device-two']);
    expect(result.code).toBe(0);
    expect(existsSync(join(deviceTwo, '.agent-sync', 'store', 'agent-sync.yaml'))).toBe(true);
  });

  it('deploys the same content to all three agents there', () => {
    expect(run(deviceTwo, ['apply']).code).toBe(0);
    const source = readFileSync(skillPath(deviceOne, '.codex', 'sql-review'), 'utf8');
    for (const dir of ['.claude', '.codex', '.cursor']) {
      expect(readFileSync(skillPath(deviceTwo, dir, 'sql-review'), 'utf8')).toBe(source);
    }
  });

  it('left the unmanaged skill on that device alone', () => {
    expect(readFileSync(join(deviceTwo, '.claude', 'skills', 'not-ours', 'SKILL.md'), 'utf8')).toBe(
      'someone else wrote this',
    );
  });

  it('propagates a change made on device two back to device one', () => {
    run(deviceTwo, ['new', 'skill', 'commit-style', '--description', 'House commit style']);
    expect(run(deviceTwo, ['save', '-m', 'add commit-style']).code).toBe(0);

    expect(run(deviceOne, ['sync']).code).toBe(0);
    expect(existsSync(skillPath(deviceOne, '.claude', 'commit-style'))).toBe(true);
  });
});

describe('scenario 4: removal cleans up every agent', () => {
  it('removes the artifact from the library and from all agents', () => {
    expect(run(deviceTwo, ['rm', 'skill/commit-style']).code).toBe(0);
    for (const dir of ['.claude', '.codex', '.cursor']) {
      expect(existsSync(skillPath(deviceTwo, dir, 'commit-style'))).toBe(false);
    }
    expect(existsSync(join(deviceTwo, '.agent-sync', 'store', 'skills', 'commit-style'))).toBe(
      false,
    );
  });
});

describe('agent-mode contract', () => {
  it('emits a versioned envelope for every command', () => {
    for (const args of [
      ['--json', 'status'],
      ['--json', 'doctor'],
      ['--json', 'apply', '--dry-run'],
    ]) {
      const parsed = JSON.parse(run(deviceOne, args).stdout) as {
        schemaVersion: number;
        command: string;
      };
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.command.length).toBeGreaterThan(0);
    }
  });

  it('reports a missing store as an error rather than hanging on a prompt', () => {
    const empty = join(workspace, 'no-store');
    mkdirSync(empty, { recursive: true });
    fabricateAgents(empty);
    const result = run(empty, ['--json', 'status']);
    expect(result.code).toBe(1);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('agent-sync init');
  });

  it('refuses contradictory flags', () => {
    const result = run(deviceOne, ['apply', '--adopt', '--overwrite']);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('contradict');
  });
});
