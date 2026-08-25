/**
 * The apply pipeline (docs/03-architecture.md §5).
 *
 * Stages 1–3 — snapshot, resolve, plan — are identical whether or not the run is a
 * dry run, which is what makes `--dry-run` exactly truthful. Stage 5 only executes
 * operations the pure planner already approved.
 */
import { supportsArtifact } from '../adapters/capability-table.js';
import {
  adoptSkill,
  deploySkill,
  skillSourcePath,
  skillTargetPath,
  undeploySkill,
} from '../adapters/skills.js';
import { AGENT_IDS, type AgentId } from '../core/model/types.js';
import { buildPlan, type Plan, type TargetState } from '../core/planner/plan.js';
import { type Deployment, resolveGlobal } from '../core/resolver/resolve.js';
import { treeHash } from '../shell/fs.js';
import {
  forget,
  type Lockfile,
  liveKey,
  lookup,
  orphansOf,
  record,
  saveLockfile,
} from '../store/lockfile.js';
import type { Context } from './context.js';

/** How to answer questions the plan raises, when running non-interactively. */
export type DriftAnswer = 'ask' | 'adopt' | 'overwrite';

export interface ApplyOptions {
  readonly dryRun: boolean;
  readonly answer: DriftAnswer;
  /** Restrict the run to these agents. */
  readonly agents?: readonly AgentId[];
}

export interface ApplyResult {
  readonly plan: Plan;
  readonly written: readonly string[];
  readonly removed: readonly string[];
  readonly adopted: readonly string[];
  readonly unresolved: readonly string[];
}

const refOf = (deployment: Deployment): string => `${deployment.type}/${deployment.id}`;

/** Stage 1–2: resolve the manifest into targets that exist on this machine. */
export const resolveTargets = (context: Context, options: ApplyOptions) => {
  const table = resolveGlobal({
    manifest: context.manifest,
    device: context.device,
    supports: supportsArtifact,
    allAgents: AGENT_IDS,
  });

  const wanted = options.agents;
  const deployments = table.deployments.filter(
    (deployment) =>
      // M1 handles skills; mcp and plugin adapters arrive in M3 and M4.
      deployment.type === 'skill' && (wanted === undefined || wanted.includes(deployment.agent)),
  );

  const targets: TargetState[] = [];
  for (const deployment of deployments) {
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

  return { table, targets };
};

/** Stages 1–3: everything a dry run needs. */
export const planApply = (
  context: Context,
  options: ApplyOptions,
): { plan: Plan; targets: readonly TargetState[] } => {
  const { table, targets } = resolveTargets(context, options);

  const live = new Set(
    targets.map((t) => liveKey(refOf(t.deployment), t.deployment.agent, t.path)),
  );
  const orphans = orphansOf(context.lockfile, live)
    .filter((r) => r.ref.startsWith('skill/'))
    .map((r) => ({
      type: 'skill' as const,
      id: r.ref.slice('skill/'.length),
      agent: r.agent as AgentId,
      path: r.path,
    }));

  return {
    plan: buildPlan({ targets, orphans, diagnostics: table.diagnostics }),
    targets,
  };
};

/** Stages 1–5. With `dryRun`, stops after planning and reports what it would do. */
export const apply = (context: Context, options: ApplyOptions): ApplyResult => {
  const { plan, targets } = planApply(context, options);
  const written: string[] = [];
  const removed: string[] = [];
  const adopted: string[] = [];
  const unresolved: string[] = [];

  if (options.dryRun) {
    return {
      plan,
      written: [],
      removed: [],
      adopted: [],
      unresolved: plan.operations.filter((o) => o.kind === 'ask').map((o) => o.ref),
    };
  }

  const byPath = new Map(targets.map((t) => [t.path, t]));
  let lockfile: Lockfile = context.lockfile;

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
    if (operation.kind === 'write') {
      const target = byPath.get(operation.path);
      if (target !== undefined) write(target);
      continue;
    }

    if (operation.kind === 'remove') {
      undeploySkill(operation.path);
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
      adopted.push(refOf(target.deployment));
      continue;
    }

    write(target);
  }

  saveLockfile(context.lockfilePath, lockfile);
  return { plan, written, removed, adopted, unresolved };
};
