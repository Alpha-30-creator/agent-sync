import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseDevice, parseManifest } from '../../../../src/core/manifest/schema.js';
import { AGENT_IDS, type AgentId, type ArtifactType } from '../../../../src/core/model/types.js';
import { explain, resolveGlobal } from '../../../../src/core/resolver/resolve.js';

/** Matches the real capability table: only claude and codex support plugins. */
const supports = (agent: AgentId, type: ArtifactType): boolean =>
  type === 'plugin' ? agent !== 'cursor' : true;

const resolve = (manifestInput: unknown, deviceInput?: unknown) => {
  const manifest = parseManifest(manifestInput);
  if (!manifest.ok) throw new Error(`fixture invalid: ${JSON.stringify(manifest.issues)}`);
  const device = parseDevice(
    deviceInput ?? { device: 'macbook', agents: ['claude', 'codex', 'cursor'] },
  );
  if (!device.ok) throw new Error('device fixture invalid');
  return resolveGlobal({
    manifest: manifest.value,
    device: device.value,
    supports,
    allAgents: AGENT_IDS,
  });
};

const agentsFor = (table: ReturnType<typeof resolve>, ref: string) =>
  table.deployments.filter((d) => `${d.type}/${d.id}` === ref).map((d) => d.agent);

describe('the precedence ladder', () => {
  it('example A: a new skill lands in all three agents by built-in default', () => {
    const table = resolve({ version: 1, artifacts: { skill: { 'review-checklist': {} } } });
    expect(agentsFor(table, 'skill/review-checklist')).toEqual(['claude', 'codex', 'cursor']);
    expect(table.deployments[0]?.provenance.rule).toBe('<built-in>');
  });

  it('layer 4: a global default per artifact type wins over the built-in', () => {
    const table = resolve({
      version: 1,
      defaults: { skill: { targets: ['cursor'] } },
      artifacts: { skill: { a: {} } },
    });
    expect(agentsFor(table, 'skill/a')).toEqual(['cursor']);
    expect(table.deployments[0]?.provenance.rule).toBe('defaults.skill.targets');
  });

  it('layer 2: a per-artifact rule replaces the type default entirely', () => {
    const table = resolve({
      version: 1,
      defaults: { skill: { targets: ['cursor', 'codex'] } },
      artifacts: { skill: { a: {}, 'commit-style': { targets: ['claude'] } } },
    });
    expect(agentsFor(table, 'skill/a')).toEqual(['cursor', 'codex']);
    expect(agentsFor(table, 'skill/commit-style')).toEqual(['claude']);
  });

  it('derives a relative rule from the next rule up, recording provenance', () => {
    const table = resolve({
      version: 1,
      defaults: { skill: { targets: ['cursor'] } },
      artifacts: { skill: { 'db-migrate': { targets: { add: ['codex'] } } } },
    });
    expect(agentsFor(table, 'skill/db-migrate')).toEqual(['cursor', 'codex']);
    const deployment = table.deployments[0];
    expect(deployment?.provenance).toMatchObject({
      rule: 'artifacts.skill.db-migrate.targets',
      derivedFrom: 'defaults.skill.targets',
      modifiers: ['+codex'],
    });
    expect(explain(deployment as never)).toBe(
      'defaults.skill.targets then artifacts.skill.db-migrate.targets (+codex)',
    );
  });

  it('subtracts with remove, and ignores an add that is already present', () => {
    const table = resolve({
      version: 1,
      artifacts: { skill: { a: { targets: { remove: ['claude'], add: ['cursor'] } } } },
    });
    expect(agentsFor(table, 'skill/a')).toEqual(['codex', 'cursor']);
  });

  it('ignores project-scoped artifacts when resolving global scope', () => {
    const table = resolve({ version: 1, artifacts: { skill: { notes: { scope: 'project' } } } });
    expect(table.deployments).toEqual([]);
  });
});

describe('filtering', () => {
  it('example D: an unsupported target is filtered with a visible note, not an error', () => {
    const table = resolve({
      version: 1,
      defaults: { plugin: { targets: ['claude', 'codex', 'cursor'] } },
      artifacts: { plugin: { toolkit: { source: 'github.com/x/y' } } },
    });
    expect(agentsFor(table, 'plugin/toolkit')).toEqual(['claude', 'codex']);
    expect(table.diagnostics).toContainEqual({
      kind: 'capability-unsupported',
      ref: 'plugin/toolkit',
      agent: 'cursor',
      message: 'plugin/toolkit → cursor: cursor has no plugin support',
    });
  });

  it('example E: a device without codex masks those deployments', () => {
    const table = resolve(
      { version: 1, artifacts: { skill: { a: {} } } },
      { device: 'win-desktop', agents: ['claude', 'cursor'] },
    );
    expect(agentsFor(table, 'skill/a')).toEqual(['claude', 'cursor']);
    expect(table.diagnostics).toContainEqual({
      kind: 'device-masked',
      ref: 'skill/a',
      agent: 'codex',
      message: 'skill/a → codex: not installed on device "win-desktop"',
    });
  });

  it('drops an artifact disabled on this device', () => {
    const table = resolve(
      { version: 1, artifacts: { mcp: { 'heavy-profiler': {} } } },
      { device: 'macbook', agents: ['claude', 'codex', 'cursor'], disable: ['mcp/heavy-profiler'] },
    );
    expect(table.deployments).toEqual([]);
    expect(table.diagnostics[0]).toMatchObject({ kind: 'artifact-disabled' });
  });

  it('built-in defaults already exclude agents that cannot support the type', () => {
    const table = resolve({
      version: 1,
      artifacts: { plugin: { toolkit: { source: 'github.com/x/y' } } },
    });
    expect(agentsFor(table, 'plugin/toolkit')).toEqual(['claude', 'codex']);
    expect(table.diagnostics).toEqual([]);
  });
});

describe('invariants (docs/04-sync-model.md §9)', () => {
  const specArb = fc.oneof(
    fc.uniqueArray(fc.constantFrom(...AGENT_IDS)),
    fc.record(
      {
        add: fc.uniqueArray(fc.constantFrom(...AGENT_IDS)),
        remove: fc.uniqueArray(fc.constantFrom(...AGENT_IDS)),
      },
      { requiredKeys: ['add'] },
    ),
  );

  const manifestArb = fc
    .record({
      defaultTargets: fc.option(fc.uniqueArray(fc.constantFrom(...AGENT_IDS)), { nil: undefined }),
      artifacts: fc.dictionary(
        fc.constantFrom('alpha', 'beta', 'gamma'),
        fc.option(specArb, { nil: undefined }),
        {
          minKeys: 1,
        },
      ),
    })
    .map(({ defaultTargets, artifacts }) => ({
      version: 1,
      ...(defaultTargets === undefined ? {} : { defaults: { skill: { targets: defaultTargets } } }),
      artifacts: {
        skill: Object.fromEntries(
          Object.entries(artifacts).map(([id, targets]) => [
            id,
            targets === undefined ? {} : { targets },
          ]),
        ),
      },
    }));

  it('is total: every manifest resolves without throwing', () => {
    fc.assert(
      fc.property(manifestArb, (manifest) => {
        resolve(manifest);
      }),
    );
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(manifestArb, (manifest) => {
        expect(resolve(manifest)).toEqual(resolve(manifest));
      }),
    );
  });

  it('never emits a duplicate (artifact, agent) pair', () => {
    fc.assert(
      fc.property(manifestArb, (manifest) => {
        const keys = resolve(manifest).deployments.map((d) => `${d.type}/${d.id}@${d.agent}`);
        expect(new Set(keys).size).toBe(keys.length);
      }),
    );
  });

  it('a device mask can only shrink the target set, and always explains itself', () => {
    fc.assert(
      fc.property(
        manifestArb,
        fc.uniqueArray(fc.constantFrom(...AGENT_IDS), { minLength: 1 }),
        (manifest, agents) => {
          const full = resolve(manifest).deployments.length;
          const masked = resolve(manifest, { device: 'partial', agents });
          expect(masked.deployments.length).toBeLessThanOrEqual(full);
          const missing = full - masked.deployments.length;
          expect(masked.diagnostics.filter((d) => d.kind === 'device-masked')).toHaveLength(
            missing,
          );
        },
      ),
    );
  });

  it('every deployment carries a non-empty provenance chain', () => {
    fc.assert(
      fc.property(manifestArb, (manifest) => {
        for (const deployment of resolve(manifest).deployments) {
          expect(deployment.provenance.rule.length).toBeGreaterThan(0);
        }
      }),
    );
  });
});
