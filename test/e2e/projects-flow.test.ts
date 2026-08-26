/**
 * End-to-end: project scope and the full precedence ladder.
 *
 * The headline scenario is the one from the PRD: in this project, skills go to Cursor
 * only — except one, which also goes to Codex.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));

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

describe('a second machine recognises the project from its committed marker', () => {
  let otherHome: string;
  let checkout: string;

  const runThere = (args: readonly string[], cwd: string) => {
    try {
      return {
        code: 0,
        stdout: execFileSync(process.execPath, [CLI, ...args], {
          cwd,
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: otherHome,
            USERPROFILE: otherHome,
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
    // Publish the library, and the project repo with its marker inside.
    const bareLibrary = join(workspace, 'library.git');
    const bareProject = join(workspace, 'acme.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bareLibrary]);
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bareProject]);

    const git = (args: readonly string[], cwd: string): void => {
      execFileSync('git', [...args], {
        cwd,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'test',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'test',
          GIT_COMMITTER_EMAIL: 'test@example.com',
        },
      });
    };

    run(['link', 'acme-app']);
    run(['include', 'skill/db-migrate']);
    // Always go through `run`: it carries the git identity these commits need. Calling
    // the CLI directly picked up whatever identity the developer's machine happened to
    // have, which is exactly the kind of hidden dependency this suite exists to catch.
    run(['save', '-m', 'library']);
    execFileSync('git', ['remote', 'add', 'origin', bareLibrary], {
      cwd: join(home, '.agent-sync', 'store'),
    });
    git(['push', '-q', 'origin', 'HEAD'], join(home, '.agent-sync', 'store'));

    git(['remote', 'add', 'origin', bareProject], projectDir);
    git(['add', '-A'], projectDir);
    git(['commit', '-q', '-m', 'project with marker'], projectDir);
    git(['push', '-q', 'origin', 'HEAD'], projectDir);

    // A second machine, with the project cloned to a deliberately different path.
    otherHome = join(workspace, 'other-home');
    for (const dir of ['.claude', '.codex', '.cursor']) {
      mkdirSync(join(otherHome, dir), { recursive: true });
    }
    checkout = join(otherHome, 'somewhere', 'else', 'acme-checkout');
    mkdirSync(join(otherHome, 'somewhere', 'else'), { recursive: true });
    runThere(['clone', bareLibrary, '--device', 'second'], otherHome);
    execFileSync('git', ['clone', '-q', bareProject, checkout]);
  });

  it('starts with no idea where any project lives', () => {
    const device = readFileSync(join(otherHome, '.agent-sync', 'device.yaml'), 'utf8');
    expect(device).not.toContain('acme-app');
  });

  it('learns the local path from the marker, with no link step', () => {
    const result = runThere(['apply'], checkout);
    expect(result.code, result.stdout).toBe(0);

    const device = readFileSync(join(otherHome, '.agent-sync', 'device.yaml'), 'utf8');
    const diagnosis = [
      `apply said: ${result.stdout}`,
      `marker present: ${existsSync(join(checkout, '.agent-sync.yaml'))}`,
      `marker: ${existsSync(join(checkout, '.agent-sync.yaml')) ? readFileSync(join(checkout, '.agent-sync.yaml'), 'utf8') : '-'}`,
      `cloned manifest: ${readFileSync(join(otherHome, '.agent-sync', 'store', 'agent-sync.yaml'), 'utf8')}`,
      `device: ${device}`,
    ].join('\n');
    expect(device, diagnosis).toContain('acme-app');
    // The path is this machine's, not the one from the other computer.
    expect(device).toContain('acme-checkout');
  });

  it('deploys the project skill into the checkout', () => {
    expect(existsSync(join(checkout, '.cursor', 'skills', 'db-migrate', 'SKILL.md'))).toBe(true);
  });

  it('works from a subdirectory of the checkout too', () => {
    const nested = join(checkout, 'src');
    mkdirSync(nested, { recursive: true });
    expect(runThere(['status'], nested).stdout).toContain('db-migrate');
  });
});

describe('finding skills that already live inside a project', () => {
  let bare: string;
  let other: string;

  beforeAll(() => {
    // A project with skills nobody has told agent-sync about yet.
    bare = join(workspace, 'unmanaged-project');
    mkdirSync(join(bare, '.claude', 'skills', 'house-style'), { recursive: true });
    writeFileSync(
      join(bare, '.claude', 'skills', 'house-style', 'SKILL.md'),
      '---\nname: house-style\ndescription: repo conventions\n---\n',
    );
    other = join(workspace, 'other-place');
    mkdirSync(other, { recursive: true });
  });

  it('does not see them from somewhere else', () => {
    const parsed = JSON.parse(
      execFileSync(process.execPath, [CLI, '--json', 'import'], {
        cwd: other,
        encoding: 'utf8',
        env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1' },
      }),
    ) as { candidates: { id: string }[] };
    expect(parsed.candidates.map((c) => c.id)).not.toContain('house-style');
  });

  it('finds them when run inside the project, and says it must be linked first', () => {
    const parsed = JSON.parse(
      execFileSync(process.execPath, [CLI, '--json', 'import'], {
        cwd: bare,
        encoding: 'utf8',
        env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1' },
      }),
    ) as { candidates: { id: string; notes: string[] }[]; adoptable: number };

    const found = parsed.candidates.find((c) => c.id === 'house-style');
    expect(found).toBeDefined();
    expect(found?.notes.join()).toContain('not a registered project yet');
    // Adopting now would turn a project skill into a global one, so it is held back.
    expect(parsed.adoptable).toBe(0);
  });

  it('adopts it as a project skill once the project is linked', () => {
    const runIn = (args: readonly string[]) =>
      execFileSync(process.execPath, [CLI, ...args], {
        cwd: bare,
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
      });

    runIn(['link', 'unmanaged-project']);
    runIn(['import', '--adopt', '--only', 'skill/house-style']);

    const manifest = readFileSync(join(home, '.agent-sync', 'store', 'agent-sync.yaml'), 'utf8');
    // Project-scoped, and included in that project — not silently made global.
    expect(manifest).toContain('scope: project');
    expect(manifest).toContain('skill/house-style');
    expect(manifest).toContain('unmanaged-project');
  });
});
