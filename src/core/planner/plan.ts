/**
 * Turns a routing table plus observed state into an ordered list of operations
 * (docs/03-architecture.md §5, stage 3).
 *
 * Planning is pure, which is what makes `--dry-run` exactly truthful: the plan printed
 * is the plan executed. An already-converged snapshot yields an empty plan, so running
 * apply twice is the same as running it once.
 */
import {
  classify,
  type DriftState,
  isSafeToWrite,
  needsDecision,
  type Observation,
} from '../drift/classify.js';
import type { AgentId, ArtifactType } from '../model/types.js';
import type { Deployment, Diagnostic } from '../resolver/resolve.js';

/** One deployment target, with everything needed to decide and to act. */
export interface TargetState {
  readonly deployment: Deployment;
  /** Absolute path the artifact deploys to on this machine. */
  readonly path: string;
  readonly observation: Observation;
}

export type Operation =
  | {
      readonly kind: 'write';
      readonly ref: string;
      readonly agent: AgentId;
      readonly path: string;
      readonly reason: DriftState;
      readonly provenance: string;
    }
  | {
      readonly kind: 'remove';
      readonly ref: string;
      readonly agent: AgentId;
      readonly path: string;
      readonly reason: 'no-longer-routed';
    }
  | {
      readonly kind: 'ask';
      readonly ref: string;
      readonly agent: AgentId;
      readonly path: string;
      readonly reason: DriftState;
      readonly question: string;
    };

export interface Plan {
  readonly operations: readonly Operation[];
  readonly diagnostics: readonly Diagnostic[];
  /** Targets already converged; kept for reporting, not acted on. */
  readonly unchanged: readonly { ref: string; agent: AgentId }[];
}

/** Targets the lockfile says we own but the routing table no longer includes. */
export interface OrphanTarget {
  readonly type: ArtifactType;
  readonly id: string;
  readonly agent: AgentId;
  readonly path: string;
}

export interface PlanInput {
  readonly targets: readonly TargetState[];
  readonly orphans: readonly OrphanTarget[];
  readonly diagnostics: readonly Diagnostic[];
}

const refOf = (deployment: Deployment): string => `${deployment.type}/${deployment.id}`;

const questionFor = (state: DriftState, ref: string, path: string): string => {
  switch (state) {
    case 'drifted':
      return `${ref} was edited by hand at ${path} — adopt the edit into the library, or overwrite it?`;
    case 'conflicted':
      return `${ref} changed in the library and at ${path} — keep which side?`;
    default:
      return `${path} already exists and is not managed by agent-sync — import it, or skip ${ref}?`;
  }
};

/**
 * Build the plan. Operations are ordered writes-then-removes-then-questions so that a
 * partial run always leaves the machine closer to the manifest, never further from it.
 */
export const buildPlan = (input: PlanInput): Plan => {
  const writes: Operation[] = [];
  const asks: Operation[] = [];
  const unchanged: { ref: string; agent: AgentId }[] = [];

  for (const target of input.targets) {
    const ref = refOf(target.deployment);
    const state = classify(target.observation);

    if (state === 'in-sync') {
      unchanged.push({ ref, agent: target.deployment.agent });
      continue;
    }

    if (isSafeToWrite(state)) {
      writes.push({
        kind: 'write',
        ref,
        agent: target.deployment.agent,
        path: target.path,
        reason: state,
        provenance: target.deployment.provenance.rule,
      });
      continue;
    }

    if (needsDecision(state)) {
      asks.push({
        kind: 'ask',
        ref,
        agent: target.deployment.agent,
        path: target.path,
        reason: state,
        question: questionFor(state, ref, target.path),
      });
    }
  }

  const removes: Operation[] = input.orphans.map((orphan) => ({
    kind: 'remove',
    ref: `${orphan.type}/${orphan.id}`,
    agent: orphan.agent,
    path: orphan.path,
    reason: 'no-longer-routed',
  }));

  return {
    operations: [...writes, ...removes, ...asks],
    diagnostics: input.diagnostics,
    unchanged,
  };
};

/** True when there is nothing to do — the machine already matches the manifest. */
export const isConverged = (plan: Plan): boolean => plan.operations.length === 0;

/** True when the plan cannot complete without a human answering something. */
export const requiresDecision = (plan: Plan): boolean =>
  plan.operations.some((operation) => operation.kind === 'ask');

/** Exit code contract from docs/06-cli-spec.md §1. */
export const exitCodeFor = (plan: Plan): 0 | 2 | 3 => {
  if (requiresDecision(plan)) return 3;
  return plan.diagnostics.length > 0 ? 2 : 0;
};
