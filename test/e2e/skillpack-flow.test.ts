/**
 * End-to-end: the interface skill pack agent-sync ships with itself.
 *
 * The property worth protecting is that it is not special. It is registered as ordinary
 * artifacts, so it deploys, drifts, routes and converges through exactly the same code
 * as anything the user wrote — which is what makes an upgrade a normal `outdated →
 * apply` transition instead of a bespoke updater.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));
const PACK = fileURLToPath(new URL('../../dist/skillpack', import.meta.url));
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

const deployed = (agentDir: string, id: string): string =>
  join(home, agentDir, 'skills', id, 'SKILL.md');

beforeAll(() => {
  workspace = join(tmpdir(), `agent-sync-pack-${process.pid}-${Date.now()}`);
  home = join(workspace, 'home');
  for (const dir of ['.claude', '.codex', '.cursor']) {
    mkdirSync(join(home, dir), { recursive: true });
  }
  run(['init', '--device', 'pack-test']);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('the pack agent-sync ships with itself', () => {
  it('deploys to every agent without the user adding anything', () => {
    const result = run(['apply']);
    expect(result.code, result.stdout).toBe(0);
    for (const id of SHIPPED) {
      for (const dir of ['.claude', '.codex', '.cursor']) {
        expect(existsSync(deployed(dir, id)), `${id} in ${dir}`).toBe(true);
      }
    }
  });

  it('leaves each deployed skill self-contained', () => {
    // The shared reference is materialised beside every SKILL.md that links to it: an
    // agent reads a skill directory, not a sibling tree.
    for (const id of SHIPPED) {
      expect(existsSync(join(home, '.claude', 'skills', id, 'troubleshoot.md'))).toBe(true);
    }
  });

  it('is idempotent', () => {
    expect(run(['apply']).stdout).toContain('already in sync');
  });

  it('appears in status like any other artifact', () => {
    const parsed = JSON.parse(run(['--json', 'status']).stdout) as {
      rows?: unknown[];
      artifacts?: unknown[];
    };
    expect(JSON.stringify(parsed)).toContain('skill/agent-sync-create-skill');
  });

  it('protects a hand-edited copy exactly like a user skill', () => {
    const path = deployed('.claude', 'agent-sync');
    const before = readFileSync(path, 'utf8');
    appendFileSync(path, '\n<!-- edited by hand -->\n');

    const result = run(['apply']);
    expect(result.code).toBe(3);
    expect(result.stdout).toContain('edited by hand');
    expect(readFileSync(path, 'utf8')).not.toBe(before);

    run(['apply', '--overwrite']);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('adopts an edit into the store, never back into the installed package', () => {
    // Writing to the package would land under node_modules on a real install and be
    // discarded by the next upgrade — losing the edit the user asked us to keep.
    const packFile = join(PACK, 'agent-sync-add-mcp', 'SKILL.md');
    const packBefore = readFileSync(packFile, 'utf8');

    appendFileSync(deployed('.claude', 'agent-sync-add-mcp'), '\n<!-- mine -->\n');
    expect(run(['apply', '--adopt']).code).toBe(0);

    expect(readFileSync(packFile, 'utf8')).toBe(packBefore);
    const inStore = join(home, '.agent-sync', 'store', 'skills', 'agent-sync-add-mcp', 'SKILL.md');
    expect(readFileSync(inStore, 'utf8')).toContain('<!-- mine -->');

    // Owned by the user now: the edit reaches the other agents and survives applying.
    run(['apply']);
    expect(readFileSync(deployed('.codex', 'agent-sync-add-mcp'), 'utf8')).toContain(
      '<!-- mine -->',
    );
  });

  it('can be routed away from an agent', () => {
    run(['route', 'skill/agent-sync-create-skill', '--targets', 'claude']);
    expect(run(['apply']).code).toBe(0);
    expect(existsSync(deployed('.claude', 'agent-sync-create-skill'))).toBe(true);
    expect(existsSync(deployed('.codex', 'agent-sync-create-skill'))).toBe(false);
  });

  it('is never offered for adoption by import', () => {
    // import re-reads the manifest from disk so its writes cannot clobber the file, and
    // that raw copy has no pack in it. Deciding "already managed" from it would offer
    // agent-sync's own skills back to the user as if they had written them.
    const parsed = JSON.parse(run(['--json', 'import']).stdout) as {
      candidates: { type: string; id: string }[];
    };
    const ids = parsed.candidates.filter((c) => c.type === 'skill').map((c) => c.id);
    for (const shipped of SHIPPED) expect(ids).not.toContain(shipped);
  });

  it('explains that a shipped skill cannot be removed from the library', () => {
    const result = run(['rm', 'skill/agent-sync']);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('ships with agent-sync');
    expect(result.stdout).toContain('agent-sync route skill/agent-sync');
    // Still deployed: refusing must not half-remove it.
    expect(existsSync(deployed('.claude', 'agent-sync'))).toBe(true);
  });
});
