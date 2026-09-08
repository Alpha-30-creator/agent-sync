/**
 * End-to-end: `setup`, the single entry point INSTALL.md sends an agent to.
 *
 * The promise is convergence — it is both the installer and the repair tool, so running
 * it twice must be indistinguishable from running it once, and running it on a damaged
 * machine must fix exactly what is damaged.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));
const SHIPPED = ['agent-sync', 'agent-sync-add-mcp', 'agent-sync-create-skill'];

let workspace: string;
let home: string;

const run = (args: readonly string[]) => {
  try {
    return {
      code: 0,
      stdout: execFileSync(process.execPath, [CLI, ...args], {
        cwd: home,
        encoding: 'utf8',
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

beforeEach(() => {
  workspace = join(tmpdir(), `agent-sync-setup-${process.pid}-${Date.now()}-${Math.random()}`);
  home = join(workspace, 'home');
  for (const dir of ['.claude', '.codex', '.cursor'])
    mkdirSync(join(home, dir), { recursive: true });
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('setting up a machine in one command', () => {
  it('creates the library, registers the device, and deploys the skills', () => {
    const result = run(['setup', '--device', 'my-mac']);
    expect(result.code, result.stdout).toBe(0);
    expect(result.stdout).toContain('device registered as "my-mac"');

    for (const id of SHIPPED) {
      expect(existsSync(join(home, '.claude', 'skills', id, 'SKILL.md')), id).toBe(true);
    }
  });

  it('converges instead of redoing the work', () => {
    run(['setup', '--device', 'my-mac']);
    const again = run(['setup']);
    expect(again.code, again.stdout).toBe(0);
    expect(again.stdout).toContain('already in place');
    expect(again.stdout).not.toContain('deployment(s) written');
  });

  it('keeps the device name when re-run without --device', () => {
    // The lockfile recording what was deployed here is keyed by the device name, so a
    // silent rename orphans it: agent-sync forgets every file it wrote and they all
    // start looking like somebody else's work.
    run(['setup', '--device', 'my-mac']);
    run(['setup']);

    expect(readFileSync(join(home, '.agent-sync', 'device.yaml'), 'utf8')).toContain(
      'device: my-mac',
    );
    expect(readdirSync(join(home, '.agent-sync', 'lock'))).toEqual(['my-mac.lock.yaml']);
  });

  it('renames only when asked to', () => {
    run(['setup', '--device', 'my-mac']);
    run(['setup', '--device', 'renamed']);
    expect(readFileSync(join(home, '.agent-sync', 'device.yaml'), 'utf8')).toContain(
      'device: renamed',
    );
  });

  it('repairs an agent that lost the skill pack', () => {
    run(['setup', '--device', 'my-mac']);
    rmSync(join(home, '.cursor', 'skills', 'agent-sync'), { recursive: true, force: true });

    const repair = run(['setup']);
    expect(repair.code, repair.stdout).toBe(0);
    expect(existsSync(join(home, '.cursor', 'skills', 'agent-sync', 'SKILL.md'))).toBe(true);
  });

  it('says so when the machine is not converged, and stops saying it once it is', () => {
    // doctor reported "everything looks healthy" on a machine with nine artifacts not
    // deployed. It is the command INSTALL.md tells an agent to trust, so it has to
    // answer the question people actually run it for.
    run(['init', '--device', 'my-mac']);

    const before = run(['--json', 'doctor']);
    const pendingBefore = (JSON.parse(before.stdout) as { pending: number }).pending;
    expect(pendingBefore).toBeGreaterThan(0);
    expect(run(['doctor']).stdout).toContain('not deployed');

    run(['apply']);
    const after = run(['--json', 'doctor']);
    expect((JSON.parse(after.stdout) as { pending: number }).pending).toBe(0);
    expect(run(['doctor']).stdout).toContain('everything looks healthy');
  });

  it('refuses flags that answer the same question', () => {
    const result = run(['setup', '--remote', 'git@x:y/z.git', '--clone', 'git@x:y/z.git']);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('answer the same question');
    // Nothing should have been made on the way to rejecting the command.
    expect(existsSync(join(home, '.agent-sync'))).toBe(false);
  });

  it('emits exactly one json envelope', () => {
    // setup composes init and apply; if either printed its own, an agent parsing stdout
    // would hit a second document and fail.
    const result = run(['--json', 'setup', '--device', 'my-mac']);
    const parsed = JSON.parse(result.stdout) as {
      command: string;
      device: string;
      agents: string[];
    };
    expect(parsed.command).toBe('setup');
    expect(parsed.device).toBe('my-mac');
    expect(parsed.agents.sort()).toEqual(['claude', 'codex', 'cursor']);
  });

  it('joins an existing library with --clone', () => {
    const origin = join(workspace, 'origin.git');
    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin]);
    run(['setup', '--device', 'first', '--remote', origin]);
    run(['new', 'skill', 'shared-one', '--description', 'From the first machine']);
    run(['save', '-m', 'add shared-one']);

    const second = join(workspace, 'second');
    for (const dir of ['.claude', '.codex', '.cursor'])
      mkdirSync(join(second, dir), { recursive: true });
    const previous = home;
    home = second;
    const joined = run(['setup', '--clone', origin, '--device', 'second']);
    expect(joined.code, joined.stdout).toBe(0);
    expect(existsSync(join(second, '.claude', 'skills', 'shared-one', 'SKILL.md'))).toBe(true);
    home = previous;
  });
});
