/**
 * The interface skill pack: skills agent-sync ships and deploys to teach agents how to
 * drive it (docs/design/09-agent-native.md §4).
 *
 * They are registered as ordinary artifacts rather than handled specially, so they flow
 * through the same resolver, planner, drift classifier and lockfile as anything a user
 * wrote. That is what makes upgrading them free: a new release ships different bytes,
 * the deployed copies stop matching, `status` says `outdated`, and `apply` converges.
 * No bespoke updater, and a hand-edited copy is protected exactly like any other.
 *
 * Seeding is *additive*: an entry the user already has wins, so routing one away with
 * `route skill/agent-sync --remove codex` survives. An artifact with no entry of its own
 * already resolves to every agent that supports it, which is the intended default.
 */
import type { Manifest } from '../manifest/schema.js';

export const BUILT_IN_SKILLS = [
  'agent-sync',
  'agent-sync-add-mcp',
  'agent-sync-create-skill',
] as const;

export type BuiltInSkill = (typeof BUILT_IN_SKILLS)[number];

export const isBuiltInSkill = (id: string): id is BuiltInSkill =>
  (BUILT_IN_SKILLS as readonly string[]).includes(id);

/** True for a reference like `skill/agent-sync` that names a shipped skill. */
export const isBuiltInRef = (type: string, id: string): boolean =>
  type === 'skill' && isBuiltInSkill(id);

/**
 * Add the shipped skills to a manifest, leaving any the user has already configured
 * exactly as they are.
 *
 * The result is used for resolution only and is never written back — every command that
 * saves the manifest re-reads it from disk first, so these entries cannot leak into the
 * user's library file.
 */
export const withBuiltInSkills = (manifest: Manifest): Manifest => {
  const existing = manifest.artifacts?.skill ?? {};
  const missing = BUILT_IN_SKILLS.filter((id) => existing[id] === undefined);
  if (missing.length === 0) return manifest;

  const seeded = Object.fromEntries(missing.map((id) => [id, {}]));
  return {
    ...manifest,
    artifacts: {
      ...manifest.artifacts,
      skill: { ...seeded, ...existing },
    },
  };
};
