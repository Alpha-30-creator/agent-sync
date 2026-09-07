/**
 * Skill deployment. Skills are the one artifact type that needs no translation: all
 * three agents read the same `SKILL.md` format, so deployment is a directory copy into
 * whichever location the capability table names (docs/02-agent-landscape.md §1).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBuiltInSkill } from '../core/model/builtins.js';
import type { MachineFacts } from '../core/model/machine.js';
import type { AgentId } from '../core/model/types.js';
import type { Deployment } from '../core/resolver/resolve.js';
import { copyTree, removeTree, treeHash } from '../shell/fs.js';
import { CAPABILITIES } from './capability-table.js';

/**
 * Absolute path a skill deploys to, or null when the agent has nowhere to put it on
 * this machine (the capability table degrades rather than inventing a location).
 */
export const skillTargetPath = (
  facts: MachineFacts,
  agent: AgentId,
  id: string,
  projectDir?: string,
): string | null => {
  const capabilities = CAPABILITIES[agent];

  if (projectDir !== undefined) {
    return join(capabilities.projectSkillsRoot(facts, projectDir), id);
  }

  const root = capabilities.globalSkillsRoot(facts);
  return root === null ? null : join(root, id);
};

/**
 * Directory holding the shipped interface skill pack.
 *
 * Resolved relative to this module so it works the same from `src/` under vitest and
 * from `dist/` once published — the build mirrors the layout into `dist/skillpack/`.
 */
export const skillPackRoot = (): string => fileURLToPath(new URL('../skillpack', import.meta.url));

/**
 * Path of a skill's source.
 *
 * Normally the canonical store, but the shipped pack comes from the installed package:
 * routing them through the one function every caller already uses means the planner,
 * the drift classifier and the writers need to know nothing about built-ins at all.
 */
/**
 * Where an adopted copy is written.
 *
 * Always the user's store, even for a shipped skill: `skillSourcePath` deliberately
 * falls back to the package when no store copy exists yet, and adopting through it would
 * write the user's edit into the installed package — under `node_modules` on a real
 * install, discarded by the next upgrade. Taking ownership means putting it in the store,
 * after which `skillSourcePath` finds it there.
 */
export const skillAdoptPath = (skillsRoot: string, id: string): string => join(skillsRoot, id);

export const skillSourcePath = (skillsRoot: string, id: string): string => {
  const inStore = join(skillsRoot, id);
  if (!isBuiltInSkill(id)) return inStore;
  // A copy in the store wins, which is what makes `apply --adopt` mean something for a
  // shipped skill: the user takes ownership of it, and later releases stop overwriting
  // their version instead of silently discarding the edit they asked us to keep.
  return existsSync(inStore) ? inStore : join(skillPackRoot(), id);
};

export interface SkillTarget {
  readonly deployment: Deployment;
  readonly source: string;
  readonly target: string;
}

/** Copy a skill into an agent's directory, replacing whatever was there. */
export const deploySkill = (target: SkillTarget): { deployedHash: string } => {
  copyTree(target.source, target.target);
  return { deployedHash: treeHash(target.target) ?? '' };
};

/** Remove a deployed skill we own. */
export const undeploySkill = (path: string): void => {
  removeTree(path);
};

/** Copy a hand-edited deployment back into the store — the "adopt" answer to drift. */
export const adoptSkill = (target: SkillTarget): void => {
  copyTree(target.target, target.source);
};
