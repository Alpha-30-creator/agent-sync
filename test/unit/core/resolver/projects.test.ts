import { describe, expect, it } from 'vitest';
import { parseDevice, parseManifest } from '../../../../src/core/manifest/schema.js';
import { AGENT_IDS, type AgentId, type ArtifactType } from '../../../../src/core/model/types.js';
import {
  explain,
  type LinkedProject,
  resolveProjects,
} from '../../../../src/core/resolver/resolve.js';

const supports = (agent: AgentId, type: ArtifactType): boolean =>
  type === 'plugin' ? agent !== 'cursor' : true;

const ACME: LinkedProject = { id: 'acme-app', localPath: '/dev/acme-app' };

const resolve = (
  manifestInput: unknown,
  projects: readonly LinkedProject[] = [ACME],
  deviceInput?: unknown,
) => {
  const manifest = parseManifest(manifestInput);
  if (!manifest.ok) throw new Error(`fixture invalid: ${JSON.stringify(manifest.issues)}`);
  const device = parseDevice(
    deviceInput ?? {
      device: 'macbook',
      agents: ['claude', 'codex', 'cursor'],
      projects: { 'acme-app': '/dev/acme-app' },
    },
  );
  if (!device.ok) throw new Error('device fixture invalid');
  return resolveProjects(
    { manifest: manifest.value, device: device.value, supports, allAgents: AGENT_IDS },
    projects,
  );
};

const agentsFor = (table: ReturnType<typeof resolve>, ref: string) =>
  table.deployments.filter((d) => `${d.type}/${d.id}` === ref).map((d) => d.agent);

describe('project-scope resolution', () => {
  it('example B: a project default routes every included skill to one agent', () => {
    const table = resolve({
      version: 1,
      artifacts: { skill: { 'db-migrate': {}, notes: {} } },
      projects: {
        'acme-app': {
          defaults: { skill: { targets: ['cursor'] } },
          include: ['skill/db-migrate', 'skill/notes'],
        },
      },
    });
    expect(agentsFor(table, 'skill/db-migrate')).toEqual(['cursor']);
    expect(agentsFor(table, 'skill/notes')).toEqual(['cursor']);
    expect(table.deployments[0]?.scope).toEqual({ kind: 'project', projectId: 'acme-app' });
  });

  it('example C: one skill adds an extra agent on top of the project default', () => {
    const table = resolve({
      version: 1,
      artifacts: { skill: { 'db-migrate': {}, notes: {} } },
      projects: {
        'acme-app': {
          defaults: { skill: { targets: ['cursor'] } },
          include: ['skill/db-migrate', 'skill/notes'],
          artifacts: { skill: { 'db-migrate': { targets: { add: ['codex'] } } } },
        },
      },
    });
    expect(agentsFor(table, 'skill/db-migrate')).toEqual(['cursor', 'codex']);
    expect(agentsFor(table, 'skill/notes')).toEqual(['cursor']);

    const deployment = table.deployments.find((d) => d.id === 'db-migrate');
    expect(explain(deployment as never)).toBe(
      'projects.acme-app.defaults.skill.targets then projects.acme-app.artifacts.skill.db-migrate.targets (+codex)',
    );
  });

  it('a global per-artifact rule outranks a project default, as documented', () => {
    const table = resolve({
      version: 1,
      artifacts: { skill: { 'commit-style': { targets: ['claude'] } } },
      projects: {
        'acme-app': {
          defaults: { skill: { targets: ['cursor'] } },
          include: ['skill/commit-style'],
        },
      },
    });
    expect(agentsFor(table, 'skill/commit-style')).toEqual(['claude']);
  });

  it('a per-project rule overrides even a global per-artifact rule', () => {
    const table = resolve({
      version: 1,
      artifacts: { skill: { 'commit-style': { targets: ['claude'] } } },
      projects: {
        'acme-app': {
          include: ['skill/commit-style'],
          artifacts: { skill: { 'commit-style': { targets: ['cursor'] } } },
        },
      },
    });
    expect(agentsFor(table, 'skill/commit-style')).toEqual(['cursor']);
  });

  it('falls back to the global type default, then the built-in', () => {
    const withDefault = resolve({
      version: 1,
      defaults: { skill: { targets: ['codex'] } },
      artifacts: { skill: { a: {} } },
      projects: { 'acme-app': { include: ['skill/a'] } },
    });
    expect(agentsFor(withDefault, 'skill/a')).toEqual(['codex']);

    const builtIn = resolve({
      version: 1,
      artifacts: { skill: { a: {} } },
      projects: { 'acme-app': { include: ['skill/a'] } },
    });
    expect(agentsFor(builtIn, 'skill/a')).toEqual(['claude', 'codex', 'cursor']);
  });

  it('deploys nothing for a project this device has not linked', () => {
    const table = resolve(
      {
        version: 1,
        artifacts: { skill: { a: {} } },
        projects: { 'acme-app': { include: ['skill/a'] } },
      },
      [],
    );
    expect(table.deployments).toEqual([]);
  });

  it('ignores a linked project the manifest does not declare', () => {
    const table = resolve({ version: 1 }, [{ id: 'unknown', localPath: '/dev/unknown' }]);
    expect(table.deployments).toEqual([]);
  });

  it('deploys nothing for a freshly linked project that includes nothing yet', () => {
    // This is the state immediately after `agent-sync link`: the project exists in the
    // manifest and is mapped on this device, but nothing has been included.
    const table = resolve({
      version: 1,
      artifacts: { skill: { a: {} } },
      projects: { 'acme-app': { remote: 'github.com/abdur/acme-app' } },
    });
    expect(table.deployments).toEqual([]);
    expect(table.diagnostics).toEqual([]);
  });

  it('deploys only what the project includes', () => {
    const table = resolve({
      version: 1,
      artifacts: { skill: { included: {}, excluded: {} } },
      projects: { 'acme-app': { include: ['skill/included'] } },
    });
    // One deployment per routed agent, but only for the included artifact.
    expect([...new Set(table.deployments.map((d) => d.id))]).toEqual(['included']);
    expect(table.deployments).toHaveLength(3);
  });

  it('applies the device mask and capability filter inside projects too', () => {
    const masked = resolve(
      {
        version: 1,
        artifacts: { skill: { a: {} } },
        projects: { 'acme-app': { include: ['skill/a'] } },
      },
      [ACME],
      { device: 'win', agents: ['claude', 'cursor'], projects: { 'acme-app': 'C:\\dev\\acme' } },
    );
    expect(agentsFor(masked, 'skill/a')).toEqual(['claude', 'cursor']);
    expect(masked.diagnostics.some((d) => d.kind === 'device-masked')).toBe(true);

    const unsupported = resolve({
      version: 1,
      artifacts: { plugin: { toolkit: { source: 'github.com/x/y' } } },
      projects: {
        'acme-app': {
          include: ['plugin/toolkit'],
          artifacts: { plugin: { toolkit: { targets: ['cursor'] } } },
        },
      },
    });
    expect(unsupported.deployments).toEqual([]);
    expect(unsupported.diagnostics[0]?.kind).toBe('capability-unsupported');
  });

  it('drops an artifact disabled on this device', () => {
    const table = resolve(
      {
        version: 1,
        artifacts: { skill: { heavy: {} } },
        projects: { 'acme-app': { include: ['skill/heavy'] } },
      },
      [ACME],
      {
        device: 'macbook',
        agents: ['claude', 'codex', 'cursor'],
        projects: { 'acme-app': '/dev/acme-app' },
        disable: ['skill/heavy'],
      },
    );
    expect(table.deployments).toEqual([]);
    expect(table.diagnostics[0]?.kind).toBe('artifact-disabled');
  });

  it('resolves several projects independently', () => {
    const table = resolve(
      {
        version: 1,
        artifacts: { skill: { shared: {} } },
        projects: {
          'acme-app': { defaults: { skill: { targets: ['cursor'] } }, include: ['skill/shared'] },
          'side-quest': { defaults: { skill: { targets: ['claude'] } }, include: ['skill/shared'] },
        },
      },
      [ACME, { id: 'side-quest', localPath: '/dev/side-quest' }],
      {
        device: 'macbook',
        agents: ['claude', 'codex', 'cursor'],
        projects: { 'acme-app': '/dev/acme-app', 'side-quest': '/dev/side-quest' },
      },
    );
    const byProject = table.deployments.map((d) => [
      d.scope.kind === 'project' ? d.scope.projectId : 'global',
      d.agent,
    ]);
    expect(byProject).toEqual([
      ['acme-app', 'cursor'],
      ['side-quest', 'claude'],
    ]);
  });
});

describe('include reference parsing', () => {
  it('parses a well-formed reference', async () => {
    const { parseIncludeReference } = await import('../../../../src/core/resolver/resolve.js');
    expect(parseIncludeReference('skill/db-migrate')).toEqual({ type: 'skill', id: 'db-migrate' });
    expect(parseIncludeReference('mcp/github')).toEqual({ type: 'mcp', id: 'github' });
  });

  it('refuses anything validation would have rejected, rather than guessing', async () => {
    const { parseIncludeReference } = await import('../../../../src/core/resolver/resolve.js');
    // No type prefix.
    expect(parseIncludeReference('db-migrate')).toBeNull();
    // Unknown artifact type.
    expect(parseIncludeReference('rules/house-style')).toBeNull();
  });
});

describe('totality (invariant 1)', () => {
  it('skips a malformed include instead of throwing, even on unvalidated input', () => {
    // Deliberately bypasses parseManifest: resolution must stay total for *any* input
    // shape, so that a future change to validation cannot turn a bad reference into a
    // crash in the middle of an apply.
    const manifest = {
      version: 1 as const,
      artifacts: { skill: { good: {} } },
      projects: { 'acme-app': { include: ['not-a-reference', 'skill/good'] } },
    };
    const device = parseDevice({
      device: 'macbook',
      agents: ['claude'],
      projects: { 'acme-app': '/dev/acme-app' },
    });
    if (!device.ok) throw new Error('device fixture invalid');

    const table = resolveProjects(
      { manifest, device: device.value, supports, allAgents: AGENT_IDS },
      [ACME],
    );
    expect(table.deployments.map((d) => d.id)).toEqual(['good']);
  });
});
