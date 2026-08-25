import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Observation } from '../../../../src/core/drift/classify.js';
import {
  buildPlan,
  exitCodeFor,
  isConverged,
  type PlanInput,
  requiresDecision,
  type TargetState,
} from '../../../../src/core/planner/plan.js';
import type { Deployment } from '../../../../src/core/resolver/resolve.js';

const deployment = (id: string, agent: Deployment['agent'] = 'claude'): Deployment => ({
  type: 'skill',
  id,
  scope: { kind: 'global' },
  agent,
  provenance: { rule: 'defaults.skill.targets' },
});

const target = (
  id: string,
  observation: Partial<Observation>,
  agent?: Deployment['agent'],
): TargetState => ({
  deployment: deployment(id, agent),
  path: `/home/u/.claude/skills/${id}`,
  observation: {
    sourceHash: 'a',
    targetHash: 'a',
    lock: { sourceHash: 'a', deployedHash: 'a' },
    ...observation,
  },
});

const plan = (input: Partial<PlanInput>) =>
  buildPlan({ targets: [], orphans: [], diagnostics: [], ...input });

describe('buildPlan', () => {
  it('is empty when everything is already converged (idempotence)', () => {
    const result = plan({ targets: [target('a', {})] });
    expect(isConverged(result)).toBe(true);
    expect(result.unchanged).toEqual([{ ref: 'skill/a', agent: 'claude' }]);
  });

  it('writes outdated and missing targets without asking', () => {
    const result = plan({
      targets: [target('a', { sourceHash: 'b' }), target('b', { targetHash: null })],
    });
    expect(
      result.operations.map((o) => [o.kind, o.ref, o.kind === 'write' ? o.reason : null]),
    ).toEqual([
      ['write', 'skill/a', 'outdated'],
      ['write', 'skill/b', 'missing'],
    ]);
    expect(requiresDecision(result)).toBe(false);
  });

  it('asks rather than writing when a target was hand-edited', () => {
    const result = plan({ targets: [target('a', { targetHash: 'edited' })] });
    expect(result.operations).toHaveLength(1);
    const [operation] = result.operations;
    expect(operation?.kind).toBe('ask');
    expect(operation?.kind === 'ask' && operation.question).toContain('adopt the edit');
    expect(requiresDecision(result)).toBe(true);
  });

  it('asks before touching a file it does not manage', () => {
    const result = plan({ targets: [target('a', { lock: null, targetHash: 'someone-elses' })] });
    expect(result.operations[0]?.kind).toBe('ask');
    expect(result.operations[0]?.reason).toBe('unmanaged-collision');
  });

  it('adopts an identical unmanaged file instead of asking', () => {
    const result = plan({ targets: [target('a', { lock: null })] });
    expect(result.operations[0]).toMatchObject({ kind: 'write', reason: 'adopted-in-place' });
  });

  it('removes targets that are no longer routed', () => {
    const result = plan({
      orphans: [{ type: 'skill', id: 'gone', agent: 'codex', path: '/home/u/.codex/skills/gone' }],
    });
    expect(result.operations[0]).toMatchObject({
      kind: 'remove',
      ref: 'skill/gone',
      reason: 'no-longer-routed',
    });
  });

  it('orders writes before removals before questions', () => {
    const result = plan({
      targets: [target('drift', { targetHash: 'x' }), target('old', { sourceHash: 'b' })],
      orphans: [{ type: 'skill', id: 'gone', agent: 'codex', path: '/p' }],
    });
    expect(result.operations.map((o) => o.kind)).toEqual(['write', 'remove', 'ask']);
  });

  it('carries provenance into write operations for --verbose', () => {
    const result = plan({ targets: [target('a', { sourceHash: 'b' })] });
    expect(result.operations[0]).toMatchObject({ provenance: 'defaults.skill.targets' });
  });
});

describe('exit code contract', () => {
  it('0 when converged, 2 with diagnostics, 3 when a decision is needed', () => {
    expect(exitCodeFor(plan({}))).toBe(0);
    expect(
      exitCodeFor(
        plan({
          diagnostics: [
            { kind: 'device-masked', ref: 'skill/a', agent: 'codex', message: 'masked' },
          ],
        }),
      ),
    ).toBe(2);
    expect(exitCodeFor(plan({ targets: [target('a', { targetHash: 'x' })] }))).toBe(3);
  });

  it('a needed decision outranks diagnostics', () => {
    const result = plan({
      targets: [target('a', { targetHash: 'x' })],
      diagnostics: [{ kind: 'device-masked', ref: 'skill/a', agent: 'codex', message: 'masked' }],
    });
    expect(exitCodeFor(result)).toBe(3);
  });
});

describe('convergence (property)', () => {
  const observationArb = fc.record({
    sourceHash: fc.constantFrom('a', 'b'),
    targetHash: fc.constantFrom('a', 'b', null),
    lock: fc.option(
      fc.record({ sourceHash: fc.constantFrom('a', 'b'), deployedHash: fc.constantFrom('a', 'b') }),
      { nil: null },
    ),
  });

  it('applying the writes in a plan converges those targets', () => {
    fc.assert(
      fc.property(fc.array(observationArb, { maxLength: 8 }), (observations) => {
        const targets = observations.map((observation, i) => target(`s${i}`, observation));
        const first = buildPlan({ targets, orphans: [], diagnostics: [] });

        // Simulate executing every write: the target now holds the store's bytes and
        // the lockfile records it.
        const written = new Set(
          first.operations.filter((o) => o.kind === 'write').map((o) => o.ref),
        );
        const after = targets.map((t) =>
          written.has(`skill/${t.deployment.id}`)
            ? {
                ...t,
                observation: {
                  sourceHash: t.observation.sourceHash,
                  targetHash: t.observation.sourceHash,
                  lock: {
                    sourceHash: t.observation.sourceHash,
                    deployedHash: t.observation.sourceHash,
                  },
                },
              }
            : t,
        );

        const second = buildPlan({ targets: after, orphans: [], diagnostics: [] });
        // Nothing that was written needs writing again; only questions remain.
        expect(second.operations.every((o) => o.kind === 'ask')).toBe(true);
      }),
    );
  });

  it('never plans both a write and a question for the same target', () => {
    fc.assert(
      fc.property(fc.array(observationArb, { maxLength: 8 }), (observations) => {
        const result = buildPlan({
          targets: observations.map((o, i) => target(`s${i}`, o)),
          orphans: [],
          diagnostics: [],
        });
        const writes = result.operations.filter((o) => o.kind === 'write').map((o) => o.ref);
        const asks = result.operations.filter((o) => o.kind === 'ask').map((o) => o.ref);
        expect(writes.filter((ref) => asks.includes(ref))).toEqual([]);
      }),
    );
  });
});

describe('exitCodeFrom', () => {
  it('reports a needed decision only while one is outstanding', async () => {
    const { exitCodeFrom } = await import('../../../../src/core/planner/plan.js');
    expect(exitCodeFrom(0, 0)).toBe(0);
    expect(exitCodeFrom(0, 3)).toBe(2);
    expect(exitCodeFrom(1, 0)).toBe(3);
    // A question answered by --adopt is settled, even though the plan still lists it.
    expect(exitCodeFrom(0, 1)).toBe(2);
  });
});
