/**
 * The contract the skill pack branches on (docs/09-agent-native.md §4.2, testing §5.8).
 *
 * An agent drives this CLI without a human watching, so the guarantees it relies on are
 * structural: no command may block on a prompt, `--json` must always be one parseable
 * envelope with a version on it, and the exit code has to carry the meaning so nothing
 * has to read prose. A command added later that quietly breaks one of these would be
 * discovered by an agent hanging, which is the worst place to discover it.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));

let home: string;

/** Every command, with arguments that are valid but change nothing. */
const COMMANDS: readonly (readonly string[])[] = [
  ['status'],
  ['status', '--why'],
  ['apply', '--dry-run'],
  ['doctor'],
  ['import'],
  ['secret', 'ls'],
  ['route', 'skill/nothing-here'],
  ['rm', 'skill/nothing-here'],
  ['include', 'skill/nothing-here'],
  ['exclude', 'skill/nothing-here'],
  ['disable', 'skill/nothing-here'],
  ['enable', 'skill/nothing-here'],
  ['unlink', 'nothing-here'],
  ['add', 'skill', '/nonexistent/path'],
  ['add', 'mcp', 'x', '--url', 'https://example/mcp'],
  ['new', 'skill', 'scratch-skill', '--description', 'A scratch skill'],
];

const run = (args: readonly string[]) => {
  try {
    return {
      code: 0,
      stdout: execFileSync(process.execPath, [CLI, ...args], {
        cwd: home,
        encoding: 'utf8',
        timeout: 20_000,
        // Closed stdin: anything that tries to prompt gets EOF rather than waiting, so a
        // command that would have blocked an agent fails the run instead of hanging it.
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          GIT_AUTHOR_NAME: 'test',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'test',
          GIT_COMMITTER_EMAIL: 'test@example.com',
          NO_COLOR: '1',
        },
      }),
    };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failed.status ?? 1, stdout: `${failed.stdout ?? ''}${failed.stderr ?? ''}` };
  }
};

beforeAll(() => {
  home = join(tmpdir(), `agent-sync-contract-${process.pid}-${Date.now()}`);
  for (const dir of ['.claude', '.codex', '.cursor']) {
    mkdirSync(join(home, dir), { recursive: true });
  }
  run(['setup', '--device', 'contract']);
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('the agent-mode contract, across the whole command surface', () => {
  it.each(COMMANDS.map((args) => [args.join(' '), args] as const))(
    '%s returns one versioned envelope under --json',
    (_label, args) => {
      const result = run(['--json', ...args]);

      let parsed: { schemaVersion?: number; command?: string; ok?: boolean };
      try {
        parsed = JSON.parse(result.stdout) as typeof parsed;
      } catch {
        throw new Error(`not a single JSON document:\n${result.stdout}`);
      }

      expect(parsed.schemaVersion).toBe(1);
      expect(typeof parsed.command).toBe('string');
      expect(typeof parsed.ok).toBe('boolean');
      // `ok` and the exit code must agree, or branching on either is a coin toss.
      expect(parsed.ok, `${_label} reported ok=${parsed.ok} with exit ${result.code}`).toBe(
        result.code === 0 || result.code === 2,
      );
    },
  );

  it.each(COMMANDS.map((args) => [args.join(' '), args] as const))(
    '%s uses only the documented exit codes',
    (_label, args) => {
      expect([0, 1, 2, 3]).toContain(run(args).code);
    },
  );

  it('never waits for input when stdin is closed', () => {
    // `secret set` is the one genuinely interactive command: with no TTY it must refuse
    // and say how, rather than reading from a stdin that will never answer.
    const result = run(['secret', 'set', 'some-token']);
    expect([1, 2, 3]).toContain(result.code);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it('reports a missing store as an error rather than a crash', () => {
    const empty = join(home, 'elsewhere');
    mkdirSync(empty, { recursive: true });
    const result = run(['--store', empty, '--json', 'status']);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; error?: string };
    expect(parsed.ok).toBe(false);
    expect(result.code).toBe(1);
  });
});
