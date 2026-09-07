import { describe, expect, it } from 'vitest';
import type { Manifest } from '../../../src/core/manifest/schema.js';
import {
  BUILT_IN_SKILLS,
  isBuiltInRef,
  isBuiltInSkill,
  withBuiltInSkills,
} from '../../../src/core/model/builtins.js';

describe('identifying a shipped skill', () => {
  it.each(BUILT_IN_SKILLS)('recognises %s', (id) => {
    expect(isBuiltInSkill(id)).toBe(true);
  });

  it.each(['agent-sync-dev-plan', 'my-skill', 'agent-syncish', ''])('rejects %s', (id) => {
    expect(isBuiltInSkill(id)).toBe(false);
  });

  it('only counts them as built-in for the skill type', () => {
    expect(isBuiltInRef('skill', 'agent-sync')).toBe(true);
    expect(isBuiltInRef('mcp', 'agent-sync')).toBe(false);
  });
});

describe('seeding the pack into a manifest', () => {
  it('adds all three to an empty library', () => {
    const seeded = withBuiltInSkills({ version: 1 });
    expect(Object.keys(seeded.artifacts?.skill ?? {}).sort()).toEqual([...BUILT_IN_SKILLS].sort());
  });

  it('leaves the user’s own skills alone', () => {
    const manifest: Manifest = { version: 1, artifacts: { skill: { mine: { scope: 'project' } } } };
    const seeded = withBuiltInSkills(manifest);
    expect(seeded.artifacts?.skill?.mine).toEqual({ scope: 'project' });
  });

  it('never overrides an entry the user has configured', () => {
    // This is what keeps `route skill/agent-sync --remove codex` working across runs.
    const routed: Manifest = {
      version: 1,
      artifacts: { skill: { 'agent-sync': { targets: ['claude'] } } },
    };
    expect(withBuiltInSkills(routed).artifacts?.skill?.['agent-sync']).toEqual({
      targets: ['claude'],
    });
  });

  it('returns the same manifest when nothing is missing', () => {
    const full: Manifest = {
      version: 1,
      artifacts: { skill: Object.fromEntries(BUILT_IN_SKILLS.map((id) => [id, {}])) },
    };
    expect(withBuiltInSkills(full)).toBe(full);
  });

  it('preserves everything else in the manifest', () => {
    const manifest: Manifest = {
      version: 1,
      projects: { app: { include: ['skill/mine'] } },
      artifacts: { mcp: { github: {} } },
    };
    const seeded = withBuiltInSkills(manifest);
    expect(seeded.projects).toEqual(manifest.projects);
    expect(seeded.artifacts?.mcp).toEqual({ github: {} });
  });
});
