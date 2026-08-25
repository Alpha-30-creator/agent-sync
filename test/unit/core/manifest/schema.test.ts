import { describe, expect, it } from 'vitest';
import {
  declaredArtifacts,
  parseDevice,
  parseManifest,
} from '../../../../src/core/manifest/schema.js';

const minimal = { version: 1 };

describe('parseManifest', () => {
  it('accepts a minimal manifest', () => {
    const result = parseManifest(minimal);
    expect(result.ok).toBe(true);
  });

  it('accepts the fully-featured example from the sync model doc', () => {
    const result = parseManifest({
      version: 1,
      defaults: {
        skill: { targets: ['claude', 'codex', 'cursor'] },
        mcp: { targets: ['claude', 'cursor'] },
      },
      artifacts: {
        skill: {
          'db-migrate': {},
          'commit-style': { targets: ['claude'] },
          'scratch-notes': { scope: 'project' },
        },
        mcp: { github: {} },
        plugin: { 'my-toolkit': { source: 'github.com/abdur/claude-plugins', scope: 'global' } },
      },
      projects: {
        'acme-app': {
          defaults: { skill: { targets: ['cursor'] } },
          include: ['skill/scratch-notes', 'mcp/github'],
          artifacts: { skill: { 'db-migrate': { targets: { add: ['codex'] } } } },
        },
      },
    });
    expect(result.ok).toBe(true);
  });

  it('reports a root-level error when the document is not an object', () => {
    const result = parseManifest('version: 1');
    if (result.ok) throw new Error('expected failure');
    expect(result.issues[0]?.path).toBe('<root>');
  });

  it('rejects an unknown version', () => {
    const result = parseManifest({ version: 2 });
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues[0]?.path).toBe('version');
  });

  it('locates an unknown agent and suggests the intended one', () => {
    const result = parseManifest({
      version: 1,
      artifacts: { skill: { 'db-migrate': { targets: ['claude', 'corsur'] } } },
    });
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    const issue = result.issues.find((i) => i.message.includes('corsur'));
    expect(issue?.path).toBe('artifacts.skill.db-migrate.targets[1]');
    expect(issue?.message).toContain('did you mean "cursor"?');
  });

  it('lists known agents when nothing is close', () => {
    const result = parseManifest({ version: 1, defaults: { skill: { targets: ['windsurf'] } } });
    if (result.ok) throw new Error('expected failure');
    expect(result.issues[0]?.message).toContain('known agents: claude, codex, cursor');
  });

  it('rejects unknown keys rather than silently ignoring them', () => {
    const result = parseManifest({
      version: 1,
      artifacts: { skill: { x: { targts: ['claude'] } } },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown artifact type', () => {
    expect(parseManifest({ version: 1, artifacts: { rules: {} } }).ok).toBe(false);
  });

  it('rejects ids that are not lowercase kebab-case', () => {
    const result = parseManifest({ version: 1, artifacts: { skill: { MySkill: {} } } });
    if (result.ok) throw new Error('expected failure');
    expect(result.issues[0]?.message).toContain('kebab-case');
  });

  it('accepts relative target adjustments', () => {
    expect(
      parseManifest({
        version: 1,
        artifacts: { skill: { x: { targets: { add: ['codex'], remove: ['claude'] } } } },
      }).ok,
    ).toBe(true);
  });

  it('rejects an empty relative adjustment', () => {
    const result = parseManifest({ version: 1, artifacts: { skill: { x: { targets: {} } } } });
    expect(result.ok).toBe(false);
  });
});

describe('parseDevice', () => {
  it('accepts a device file', () => {
    const result = parseDevice({
      device: 'macbook-m3',
      agents: ['claude', 'codex', 'cursor'],
      projects: { 'acme-app': '/Users/abdur/dev/acme-app' },
      disable: ['mcp/heavy-profiler'],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a device without agents', () => {
    expect(parseDevice({ device: 'win-desktop' }).ok).toBe(false);
  });
});

describe('declaredArtifacts', () => {
  it('lists artifacts grouped by type and sorted by id', () => {
    const parsed = parseManifest({
      version: 1,
      artifacts: { skill: { zebra: {}, alpha: {} }, mcp: { github: {} } },
    });
    if (!parsed.ok) throw new Error('fixture should parse');
    expect(declaredArtifacts(parsed.value).map((a) => `${a.type}/${a.id}`)).toEqual([
      'skill/alpha',
      'skill/zebra',
      'mcp/github',
    ]);
  });

  it('returns nothing for an empty manifest', () => {
    const parsed = parseManifest(minimal);
    if (!parsed.ok) throw new Error('fixture should parse');
    expect(declaredArtifacts(parsed.value)).toEqual([]);
  });
});

describe('semantic validation', () => {
  it('reports a project include that references an undeclared artifact', () => {
    const result = parseManifest({
      version: 1,
      artifacts: { skill: { 'db-migrate': {} } },
      projects: { acme: { include: ['skill/db-migrate', 'skill/db-migrat'] } },
    });
    if (result.ok) throw new Error('expected failure');
    expect(result.issues[0]?.path).toBe('projects.acme.include[1]');
    expect(result.issues[0]?.message).toContain('did you mean "skill/db-migrate"?');
  });

  it('reports a per-project override for an artifact that does not exist', () => {
    const result = parseManifest({
      version: 1,
      artifacts: { skill: {} },
      projects: { acme: { artifacts: { skill: { ghost: { targets: ['cursor'] } } } } },
    });
    if (result.ok) throw new Error('expected failure');
    expect(result.issues[0]?.path).toBe('projects.acme.artifacts.skill.ghost');
    expect(result.issues[0]?.message).toContain('not declared under artifacts');
  });

  it('validates references in a project private list', () => {
    const result = parseManifest({
      version: 1,
      artifacts: { mcp: { github: {} } },
      projects: { acme: { include: ['mcp/github'], private: ['mcp/ghost'] } },
    });
    if (result.ok) throw new Error('expected failure');
    expect(result.issues[0]?.path).toBe('projects.acme.private[0]');
  });

  it('accepts a project whose references all resolve', () => {
    expect(
      parseManifest({
        version: 1,
        artifacts: { mcp: { github: {} }, skill: { notes: {} } },
        projects: {
          acme: {
            include: ['mcp/github', 'skill/notes'],
            private: ['mcp/github'],
            artifacts: { skill: { notes: { targets: ['cursor'] } } },
            remote: 'github.com/abdur/acme',
          },
        },
      }).ok,
    ).toBe(true);
  });

  it('requires a marketplace source for plugins', () => {
    const result = parseManifest({ version: 1, artifacts: { plugin: { 'my-toolkit': {} } } });
    if (result.ok) throw new Error('expected failure');
    expect(result.issues[0]?.path).toBe('artifacts.plugin.my-toolkit.source');
  });

  it('reports an invalid project id', () => {
    const result = parseManifest({ version: 1, projects: { 'Acme App': {} } });
    if (result.ok) throw new Error('expected failure');
    expect(result.issues[0]?.message).toContain('invalid project id');
  });
});
