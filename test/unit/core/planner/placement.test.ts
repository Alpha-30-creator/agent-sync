import { describe, expect, it } from 'vitest';
import type { AgentId } from '../../../../src/core/model/types.js';
import { type AgentPlacement, placeProjectSkill } from '../../../../src/core/planner/placement.js';

/** The verified project-scope reality: Cursor also reads the other agents' directories. */
const PLACEMENTS: readonly AgentPlacement[] = [
  { agent: 'claude', ownDir: '.claude/skills', alsoDiscovers: [] },
  { agent: 'codex', ownDir: '.codex/skills', alsoDiscovers: [] },
  {
    agent: 'cursor',
    ownDir: '.cursor/skills',
    alsoDiscovers: ['.claude/skills', '.codex/skills', '.agents/skills'],
  },
];

const place = (targets: readonly AgentId[]) => placeProjectSkill(targets, PLACEMENTS);

describe('minimum-copy placement', () => {
  it('writes one copy per agent when nothing overlaps', () => {
    expect(place(['claude', 'codex']).writes).toEqual([
      { dir: '.claude/skills', satisfies: ['claude'] },
      { dir: '.codex/skills', satisfies: ['codex'] },
    ]);
  });

  it('covers Cursor with Claude’s directory instead of writing a second copy', () => {
    const result = place(['claude', 'cursor']);
    expect(result.writes).toEqual([{ dir: '.claude/skills', satisfies: ['claude', 'cursor'] }]);
  });

  it('writes two copies, not three, for all three agents', () => {
    const result = place(['claude', 'codex', 'cursor']);
    expect(result.writes.map((w) => w.dir)).toEqual(['.claude/skills', '.codex/skills']);
    expect(result.writes[0]?.satisfies).toEqual(['claude', 'cursor']);
  });

  it('uses Cursor’s own directory when Cursor is the only target', () => {
    expect(place(['cursor']).writes).toEqual([{ dir: '.cursor/skills', satisfies: ['cursor'] }]);
  });

  it('covers Cursor via Codex when Claude is not routed', () => {
    expect(place(['codex', 'cursor']).writes).toEqual([
      { dir: '.codex/skills', satisfies: ['codex', 'cursor'] },
    ]);
  });

  it('writes nothing for an empty target set', () => {
    expect(place([])).toEqual({ writes: [], notExcludable: [] });
  });
});

describe('honest exclusion reporting', () => {
  it('reports that Cursor still sees a Claude-only skill', () => {
    const result = place(['claude']);
    expect(result.notExcludable).toEqual([{ agent: 'cursor', via: '.claude/skills' }]);
  });

  it('reports nothing when the excluded agent cannot see the chosen directory', () => {
    // Claude does not read Cursor's directory, so excluding Claude actually works.
    expect(place(['cursor']).notExcludable).toEqual([]);
  });

  it('says nothing when every agent is routed', () => {
    expect(place(['claude', 'codex', 'cursor']).notExcludable).toEqual([]);
  });

  it('never lists an agent as both satisfied and not-excludable', () => {
    for (const targets of [['claude'], ['codex'], ['cursor'], ['claude', 'codex']] as AgentId[][]) {
      const result = place(targets);
      const satisfied = result.writes.flatMap((w) => w.satisfies);
      expect(result.notExcludable.filter((n) => satisfied.includes(n.agent))).toEqual([]);
    }
  });
});
