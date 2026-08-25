/**
 * Skill deployment. Skills are the one artifact type that needs no translation: all
 * three agents read the same `SKILL.md` format, so deployment is a directory copy into
 * whichever location the capability table names (docs/02-agent-landscape.md §1).
 */
import { join } from 'node:path';
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

/** Path of a skill inside the canonical store. */
export const skillSourcePath = (skillsRoot: string, id: string): string => join(skillsRoot, id);

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
