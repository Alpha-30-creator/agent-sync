/**
 * Project-scope deployment: turning resolved project routes into concrete paths,
 * honouring the placement rules that Cursor's cross-agent discovery forces on us
 * (docs/04-sync-model.md §7).
 */
import { join } from 'node:path';
import { CAPABILITIES } from '../adapters/capability-table.js';
import { skillSourcePath } from '../adapters/skills.js';
import { AGENT_IDS, type AgentId } from '../core/model/types.js';
import { type AgentPlacement, placeProjectSkill } from '../core/planner/placement.js';
import type { TargetState } from '../core/planner/plan.js';
import type { Deployment, Diagnostic } from '../core/resolver/resolve.js';
import { treeHash } from '../shell/fs.js';
import { lookup } from '../store/lockfile.js';
import type { Context } from './context.js';

/** Project-relative skill directories, derived from the capability table. */
const placementsFor = (): readonly AgentPlacement[] =>
  AGENT_IDS.map((agent) => ({
    agent,
    ownDir: `.${agent}/skills`,
    alsoDiscovers: [...CAPABILITIES[agent].alsoDiscovers],
  }));

const refOf = (deployment: Deployment): string => `${deployment.type}/${deployment.id}`;

export interface ProjectTargets {
  readonly targets: readonly TargetState[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Expand project-scope deployments into filesystem targets.
 *
 * Several agents can share one written copy, so the deployment chosen to represent a
 * directory is the first agent it satisfies; the rest are reported as covered rather
 * than written twice.
 */
export const projectTargets = (
  context: Context,
  deployments: readonly Deployment[],
  projectPaths: ReadonlyMap<string, string>,
): ProjectTargets => {
  const targets: TargetState[] = [];
  const diagnostics: Diagnostic[] = [];
  const placements = placementsFor();

  // Group by (project, artifact) so placement sees the whole routed set at once.
  const groups = new Map<string, { deployments: Deployment[]; projectId: string }>();
  for (const deployment of deployments) {
    if (deployment.scope.kind !== 'project' || deployment.type !== 'skill') continue;
    const key = `${deployment.scope.projectId}::${refOf(deployment)}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { deployments: [deployment], projectId: deployment.scope.projectId });
    } else {
      existing.deployments.push(deployment);
    }
  }

  for (const [, group] of groups) {
    const projectDir = projectPaths.get(group.projectId);
    if (projectDir === undefined) continue;

    const routed = group.deployments.map((d) => d.agent);
    const placement = placeProjectSkill(routed, placements);
    const first = group.deployments[0];
    if (first === undefined) continue;

    const source = skillSourcePath(context.layout.skills, first.id);

    for (const write of placement.writes) {
      const owner = group.deployments.find((d) => d.agent === write.satisfies[0]);
      if (owner === undefined) continue;

      const path = join(projectDir, write.dir, first.id);
      targets.push({
        deployment: owner,
        path,
        covers: [...write.satisfies],
        observation: {
          sourceHash: treeHash(source) ?? '',
          targetHash: treeHash(path),
          lock: lookup(context.lockfile, refOf(owner), owner.agent, path),
        },
      });

      const alsoServed = write.satisfies.slice(1);
      if (alsoServed.length > 0) {
        diagnostics.push({
          kind: 'placement-shared',
          ref: refOf(first),
          agent: alsoServed[0] as AgentId,
          message: `${refOf(first)} in ${group.projectId}: one copy at ${write.dir} also serves ${alsoServed.join(', ')}`,
        });
      }
    }

    for (const leak of placement.notExcludable) {
      diagnostics.push({
        kind: 'not-excludable',
        ref: refOf(first),
        agent: leak.agent,
        message: `${refOf(first)} in ${group.projectId}: ${leak.agent} can still see it via ${leak.via} — that directory is not excludable`,
      });
    }
  }

  return { targets, diagnostics };
};
