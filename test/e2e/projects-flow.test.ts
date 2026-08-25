/**
 * End-to-end: project scope and the full precedence ladder.
 *
 * The headline scenario is the one from the PRD: in this project, skills go to Cursor
 * only — except one, which also goes to Codex.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));
const REPO = fileURLToPath(new URL('../..', import.meta.url));

let workspace: string;
let home: string;
let projectDir: string;

const run = (args: readonly string[], cwd = projectDir) => {
  try {
    return {
      code: 0,
      stdout: execFileSync(process.execPath, [CLI, ...args], {
        cwd,
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

const projectSkill = (agentDir: string, id: string): string =>
  join(projectDir, agentDir, 'skills', id, 'SKILL.md');

beforeAll(() => {
  execFileSync('node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], {
    cwd: REPO,
  });

  workspace = join(tmpdir(), `agent-sync-projects-${process.pid}-${Date.now()}`);
  home = join(workspace, 'home');
  projectDir = join(workspace, 'acme-app');
  for (const dir of ['.claude', '.codex', '.cursor'])
    mkdirSync(join(home, dir), { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  execFileSync('git', ['init', '-q', projectDir]);

  run(['init', '--device', 'mac'], home);
  run(['new', 'skill', 'db-migrate', '--scope', 'project'], home);
  run(['new', 'skill', 'scratch-notes', '--scope', 'project'], home);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('linking a project', () => {
  it('writes a marker that carries the identity between machines', () => {
    const result = run(['link', 'acme-app']);
    expect(result.code).toBe(0);
    const marker = readFileSync(join(projectDir, '.agent-sync.yaml'), 'utf8');
    expect(marker).toContain('project: acme-app');
    // No paths in the marker: they differ per device by definition.
    expect(marker).not.toContain(projectDir);
  });

  it('records the git remote only as a hint, when there is one', () => {
    const parsed = JSON.parse(run(['--json', 'link', 'acme-app']).stdout) as {
      remote: string | null;
    };
    expect(parsed.remote).toBeNull(); // this fixture repo has no origin
  });

  it('finds the project from a subdirectory', () => {
    const nested = join(projectDir, 'src', 'deep');
    mkdirSync(nested, { recursive: true });
    const result = run(['include', 'skill/db-migrate'], nested);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('acme-app');
  });
});

describe('the PRD scenario: cursor-only project, one skill also on codex', () => {
  it('routes the project default to cursor', () => {
    expect(run(['route', '--type', 'skill', '--project', 'here', '--targets', 'cursor']).code).toBe(
      0,
    );
    expect(run(['include', 'skill/scratch-notes']).code).toBe(0);
  });

  it('adds codex for one skill only', () => {
    expect(run(['route', 'skill/db-migrate', '--project', 'here', '--add', 'codex']).code).toBe(0);
  });

  it('deploys the minimum number of copies', () => {
    expect(run(['apply']).code).toBe(0);

    // db-migrate is routed to cursor + codex. Cursor reads .codex/skills, so one copy
    // serves both — writing a second into .cursor/skills would be redundant.
    expect(existsSync(projectSkill('.codex', 'db-migrate'))).toBe(true);
    expect(existsSync(projectSkill('.cursor', 'db-migrate'))).toBe(false);

    // scratch-notes is cursor-only, so it goes in cursor's own directory.
    expect(existsSync(projectSkill('.cursor', 'scratch-notes'))).toBe(true);
    expect(existsSync(projectSkill('.codex', 'scratch-notes'))).toBe(false);
    expect(existsSync(projectSkill('.claude', 'scratch-notes'))).toBe(false);
  });

  it('keeps project-scoped skills out of the global agent directories', () => {
    for (const dir of ['.claude', '.codex', '.cursor']) {
      expect(existsSync(join(home, dir, 'skills', 'db-migrate'))).toBe(false);
      expect(existsSync(join(home, dir, 'skills', 'scratch-notes'))).toBe(false);
    }
  });

  it('credits every agent a shared copy serves, rather than calling it excluded', () => {
    const parsed = JSON.parse(run(['--json', 'status']).stdout) as {
      targets: { ref: string; serves: string[] }[];
    };
    const dbMigrate = parsed.targets.find((t) => t.ref === 'skill/db-migrate');
    expect(dbMigrate?.serves.sort()).toEqual(['codex', 'cursor']);
  });

  it('explains which rule produced the extra agent', () => {
    const result = run(['status', '--why']);
    expect(result.stdout).toContain('projects.acme-app.artifacts.skill.db-migrate.targets');
    expect(result.stdout).toContain('+codex');
  });

  it('is idempotent', () => {
    expect(run(['apply']).stdout).toContain('already in sync');
  });
});

describe('changing routing rules', () => {
  it('removes deployments that a narrowed rule no longer covers', () => {
    expect(
      run(['route', 'skill/db-migrate', '--project', 'here', '--targets', 'cursor']).code,
    ).toBe(0);
    expect(run(['apply']).code).toBe(0);
    // Now cursor-only: the copy moves out of codex's directory into cursor's.
    expect(existsSync(projectSkill('.codex', 'db-migrate'))).toBe(false);
    expect(existsSync(projectSkill('.cursor', 'db-migrate'))).toBe(true);
  });

  it('falls back up the ladder when a rule is cleared', () => {
    expect(run(['route', 'skill/db-migrate', '--project', 'here', '--clear']).code).toBe(0);
    const result = run(['status', '--why']);
    expect(result.stdout).toContain('projects.acme-app.defaults.skill.targets');
  });

  it('stops deploying an artifact that is excluded from the project', () => {
    expect(run(['exclude', 'skill/scratch-notes']).code).toBe(0);
    expect(run(['apply']).code).toBe(0);
    expect(existsSync(projectSkill('.cursor', 'scratch-notes'))).toBe(false);
  });

  it('rejects an unknown agent with a helpful message', () => {
    const result = run(['route', 'skill/db-migrate', '--targets', 'corsur']);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('known agents');
  });
});

describe('per-device masking', () => {
  it('disables an artifact on this device only, then re-enables it', () => {
    expect(run(['disable', 'skill/db-migrate']).code).toBe(0);
    expect(run(['apply']).code).toBe(0);
    expect(existsSync(projectSkill('.cursor', 'db-migrate'))).toBe(false);

    expect(run(['enable', 'skill/db-migrate']).code).toBe(0);
    expect(run(['apply']).code).toBe(0);
    expect(existsSync(projectSkill('.cursor', 'db-migrate'))).toBe(true);
  });
});

describe('unlinking', () => {
  it('stops deploying here but leaves the marker for other devices', () => {
    expect(run(['unlink']).code).toBe(0);
    expect(run(['apply']).code).toBe(0);
    expect(existsSync(projectSkill('.cursor', 'db-migrate'))).toBe(false);
    expect(existsSync(join(projectDir, '.agent-sync.yaml'))).toBe(true);
  });

  it('re-links automatically from the marker when asked again', () => {
    expect(run(['link']).code).toBe(0);
    expect(run(['apply']).code).toBe(0);
    expect(existsSync(projectSkill('.cursor', 'db-migrate'))).toBe(true);
  });
});
