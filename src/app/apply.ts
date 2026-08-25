/**
 * The apply pipeline (docs/03-architecture.md §5).
 *
 * Stages 1–3 — snapshot, resolve, plan — are identical whether or not the run is a
 * dry run, which is what makes `--dry-run` exactly truthful. Stage 5 only executes
 * operations the pure planner already approved.
 */

import { stringify as stringifyYaml } from 'yaml';
import { type McpLocation, supportsArtifact } from '../adapters/capability-table.js';
import { readMcpEntry, removeMcpEntry, writeMcpEntry } from '../adapters/mcp.js';
import {
  adoptSkill,
  deploySkill,
  skillSourcePath,
  skillTargetPath,
  undeploySkill,
} from '../adapters/skills.js';
import { adoptMcpEntry } from '../core/mcp/adopt.js';
import { AGENT_IDS, type AgentId } from '../core/model/types.js';
import { buildPlan, type Plan, type TargetState } from '../core/planner/plan.js';
import { type Deployment, resolveGlobal, resolveProjects } from '../core/resolver/resolve.js';
import { backupFile, treeHash, writeFileAtomic } from '../shell/fs.js';
import { runStamp } from '../shell/machine.js';
import { loadSecrets, setSecret } from '../shell/secrets.js';
import {
  forget,
  type Lockfile,
  liveKey,
  lookup,
  orphansOf,
  record,
  saveLockfile,
} from '../store/lockfile.js';
import { linkedProjects } from '../store/project.js';
import type { Context } from './context.js';
import { type McpTarget, mcpSourcePath, mcpTargets } from './mcp.js';
import { projectTargets } from './projects.js';

/** How to answer questions the plan raises, when running non-interactively. */
export type DriftAnswer = 'ask' | 'adopt' | 'overwrite';

export interface ApplyOptions {
  readonly dryRun: boolean;
  readonly answer: DriftAnswer;
  /** Restrict the run to these agents. */
  readonly agents?: readonly AgentId[];
  /** Restrict the run to one project. */
  readonly project?: string;
}

export interface ApplyResult {
  readonly plan: Plan;
  readonly written: readonly string[];
  readonly removed: readonly string[];
  readonly adopted: readonly string[];
  readonly unresolved: readonly string[];
  /** Files agent-sync declined to touch, with the reason. */
  readonly refusals: readonly string[];
}

const refOf = (deployment: Deployment): string => `${deployment.type}/${deployment.id}`;

/** Stage 1–2: resolve the manifest into targets that exist on this machine. */
export const resolveTargets = (context: Context, options: ApplyOptions) => {
  const input = {
    manifest: context.manifest,
    device: context.device,
    supports: supportsArtifact,
    allAgents: AGENT_IDS,
  };

  const global = resolveGlobal(input);
  const projects = linkedProjects(context.device, Object.keys(context.manifest.projects ?? {}));
  const projectRoutes = resolveProjects(input, projects);

  const wanted = options.agents;
  const wantedProject = options.project;

  const inScope = (deployment: Deployment): boolean =>
    (wanted === undefined || wanted.includes(deployment.agent)) &&
    (wantedProject === undefined ||
      (deployment.scope.kind === 'project' && deployment.scope.projectId === wantedProject));

  // Plugin deployment arrives in M4.
  const keep = (deployment: Deployment): boolean =>
    deployment.type === 'skill' && inScope(deployment);
  const keepMcp = (deployment: Deployment): boolean =>
    deployment.type === 'mcp' && inScope(deployment);

  const targets: TargetState[] = [];
  for (const deployment of global.deployments.filter(keep)) {
    const path = skillTargetPath(context.facts, deployment.agent, deployment.id);
    if (path === null) continue;

    const source = skillSourcePath(context.layout.skills, deployment.id);
    targets.push({
      deployment,
      path,
      observation: {
        sourceHash: treeHash(source) ?? '',
        targetHash: treeHash(path),
        lock: lookup(context.lockfile, refOf(deployment), deployment.agent, path),
      },
    });
  }

  const projectPaths = new Map(projects.map((project) => [project.id, project.localPath]));
  const fromProjects = projectTargets(
    context,
    projectRoutes.deployments.filter(keep),
    projectPaths,
  );

  const mcp = mcpTargets({
    context,
    deployments: [...global.deployments, ...projectRoutes.deployments].filter(keepMcp),
    secrets: loadSecrets(context.layout.secrets),
    env: process.env,
    projectPaths,
  });

  return {
    table: {
      deployments: [...global.deployments, ...projectRoutes.deployments],
      diagnostics: [
        ...global.diagnostics,
        ...projectRoutes.diagnostics,
        ...fromProjects.diagnostics,
        ...mcp.diagnostics,
      ],
    },
    targets: [...targets, ...fromProjects.targets, ...mcp.targets],
    mcpTargets: mcp.targets,
  };
};

/** Stages 1–3: everything a dry run needs. */
export const planApply = (
  context: Context,
  options: ApplyOptions,
): { plan: Plan; targets: readonly TargetState[]; mcpTargets: readonly McpTarget[] } => {
  const { table, targets, mcpTargets: mcp } = resolveTargets(context, options);

  const live = new Set(
    targets.map((t) => liveKey(refOf(t.deployment), t.deployment.agent, t.path)),
  );
  const orphans = orphansOf(context.lockfile, live).map((r) => ({
    type: r.ref.startsWith('mcp/') ? ('mcp' as const) : ('skill' as const),
    id: r.ref.slice(r.ref.indexOf('/') + 1),
    agent: r.agent as AgentId,
    path: r.path,
  }));

  return {
    plan: buildPlan({ targets, orphans, diagnostics: table.diagnostics }),
    targets,
    mcpTargets: mcp,
  };
};

/** Stages 1–5. With `dryRun`, stops after planning and reports what it would do. */
export const apply = (context: Context, options: ApplyOptions): ApplyResult => {
  const { plan, targets, mcpTargets: mcp } = planApply(context, options);
  const written: string[] = [];
  const removed: string[] = [];
  const adopted_: string[] = [];
  const unresolved: string[] = [];
  const refusals: string[] = [];

  if (options.dryRun) {
    return {
      plan,
      written: [],
      removed: [],
      adopted: [],
      refusals: [],
      unresolved: plan.operations.filter((o) => o.kind === 'ask').map((o) => o.ref),
    };
  }

  const byPath = new Map(targets.map((t) => [t.path, t]));
  const mcpByKey = new Map(
    mcp.map((target) => [`${refOf(target.deployment)}@${target.deployment.agent}`, target]),
  );
  let lockfile: Lockfile = context.lockfile;

  // Back up each shared config once per run, before its first edit.
  const stamp = runStamp(new Date());
  const backedUp = new Set<string>();
  const backupOnce = (path: string): void => {
    if (backedUp.has(path)) return;
    backedUp.add(path);
    backupFile(path, context.layout.backupDir, stamp);
  };

  /**
   * Pull a hand-edited MCP entry back into the library. Credential-looking literals are
   * split out into device-only secrets so the adoption cannot commit one to git.
   */
  const adoptMcp = (target: McpTarget): void => {
    const current = readMcpEntry(target.location, target.deployment.id);
    if (current.kind !== 'present') {
      unresolved.push(refOf(target.deployment));
      return;
    }

    const adopted = adoptMcpEntry(target.deployment.id, current.value);
    if (adopted.definition === null) {
      refusals.push(
        `${refOf(target.deployment)} at ${target.path} could not be adopted: ${adopted.notes.join('; ')}`,
      );
      unresolved.push(refOf(target.deployment));
      return;
    }

    for (const [name, value] of Object.entries(adopted.extractedSecrets)) {
      setSecret(context.layout.secrets, name, value);
    }
    writeFileAtomic(
      mcpSourcePath(context.layout.mcp, target.deployment.id),
      stringifyYaml(adopted.definition),
    );
    lockfile = record(lockfile, {
      ref: refOf(target.deployment),
      agent: target.deployment.agent,
      path: target.path,
      sourceHash: target.observation.targetHash ?? '',
      deployedHash: target.observation.targetHash ?? '',
    });
    adopted_.push(refOf(target.deployment));
  };

  const writeMcp = (target: McpTarget): boolean => {
    const outcome = writeMcpEntry(target.location, target.deployment.id, target.value, backupOnce);
    if (outcome.kind === 'refused') {
      refusals.push(outcome.message);
      return false;
    }
    lockfile = record(lockfile, {
      ref: refOf(target.deployment),
      agent: target.deployment.agent,
      path: target.path,
      sourceHash: target.observation.sourceHash,
      deployedHash: target.observation.sourceHash,
    });
    written.push(`${refOf(target.deployment)} → ${target.deployment.agent}`);
    return true;
  };

  const write = (target: TargetState): void => {
    const source = skillSourcePath(context.layout.skills, target.deployment.id);
    const { deployedHash } = deploySkill({
      deployment: target.deployment,
      source,
      target: target.path,
    });
    lockfile = record(lockfile, {
      ref: refOf(target.deployment),
      agent: target.deployment.agent,
      path: target.path,
      sourceHash: target.observation.sourceHash,
      deployedHash,
    });
    written.push(`${refOf(target.deployment)} → ${target.deployment.agent}`);
  };

  for (const operation of plan.operations) {
    const mcpTarget = mcpByKey.get(`${operation.ref}@${operation.agent}`);

    if (operation.kind === 'write') {
      if (mcpTarget !== undefined && mcpTarget.path === operation.path) {
        writeMcp(mcpTarget);
        continue;
      }
      const target = byPath.get(operation.path);
      if (target !== undefined) write(target);
      continue;
    }

    if (operation.kind === 'remove') {
      if (operation.ref.startsWith('mcp/')) {
        const location = mcpLocationForRemoval(operation.path);
        const outcome = removeMcpEntry(location, operation.ref.slice('mcp/'.length), backupOnce);
        if (outcome.kind === 'refused') {
          refusals.push(outcome.message);
          continue;
        }
      } else {
        undeploySkill(operation.path);
      }
      lockfile = forget(lockfile, operation.ref, operation.agent, operation.path);
      removed.push(`${operation.ref} → ${operation.agent}`);
      continue;
    }

    // 'ask': only act when the caller supplied a blanket answer; otherwise the
    // question is surfaced and nothing is touched (NFR-4).
    const target = byPath.get(operation.path);
    if (target === undefined || options.answer === 'ask') {
      unresolved.push(operation.ref);
      continue;
    }

    if (mcpTarget !== undefined) {
      if (options.answer === 'overwrite') {
        writeMcp(mcpTarget);
      } else {
        adoptMcp(mcpTarget);
      }
      continue;
    }

    if (options.answer === 'adopt') {
      const source = skillSourcePath(context.layout.skills, target.deployment.id);
      adoptSkill({ deployment: target.deployment, source, target: target.path });
      lockfile = record(lockfile, {
        ref: refOf(target.deployment),
        agent: target.deployment.agent,
        path: target.path,
        sourceHash: treeHash(source) ?? '',
        deployedHash: treeHash(target.path) ?? '',
      });
      adopted_.push(refOf(target.deployment));
      continue;
    }

    write(target);
  }

  saveLockfile(context.lockfilePath, lockfile);
  return { plan, written, removed, adopted: adopted_, unresolved, refusals };
};

/**
 * Rebuild a location from a lockfile path when removing an orphaned MCP entry: the
 * routing table no longer mentions it, so only the path and its format are known.
 */
const mcpLocationForRemoval = (path: string): McpLocation => ({
  path,
  format: path.endsWith('.toml') ? 'toml' : 'jsonc',
  container: path.endsWith('.toml') ? ['mcp_servers'] : ['mcpServers'],
  shared: true,
});
