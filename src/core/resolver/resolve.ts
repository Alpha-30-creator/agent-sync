/**
 * The precedence ladder (docs/04-sync-model.md §2), as one pure function.
 *
 * For each artifact, the most specific rule that exists wins *entirely* — a more
 * specific rule replaces the less specific set rather than merging with it, so every
 * answer traces to exactly one rule. Relative specs (`add`/`remove`) are the ergonomic
 * exception: still one winning rule, just written in terms of the next rule up.
 *
 * Device masks and capability filtering are applied afterwards and may only *shrink*
 * the target set; each shrink leaves a diagnostic so `status --why` can explain itself.
 */
import type { Device, Manifest, TargetSpec } from '../manifest/schema.js';
import { formatArtifactRef } from '../model/ids.js';
import type { AgentId, ArtifactType, Scope } from '../model/types.js';

/** Where a target set came from, for `--why` output. */
export interface Provenance {
  /** Manifest path of the winning rule, or `<built-in>`. */
  readonly rule: string;
  /** Rule the winning spec was derived from, when it used add/remove. */
  readonly derivedFrom?: string;
  /** Human-readable modifiers applied, e.g. `+codex`, `-claude`. */
  readonly modifiers?: readonly string[];
}

export interface Deployment {
  readonly type: ArtifactType;
  readonly id: string;
  readonly scope: Scope;
  readonly agent: AgentId;
  readonly provenance: Provenance;
}

export type Diagnostic =
  | {
      readonly kind: 'capability-unsupported';
      readonly ref: string;
      readonly agent: AgentId;
      readonly message: string;
    }
  | {
      readonly kind: 'device-masked';
      readonly ref: string;
      readonly agent: AgentId;
      readonly message: string;
    }
  | { readonly kind: 'artifact-disabled'; readonly ref: string; readonly message: string };

export interface RoutingTable {
  readonly deployments: readonly Deployment[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface ResolveInput {
  readonly manifest: Manifest;
  readonly device: Device;
  /** Agents that support a given artifact type — injected so core stays pure. */
  readonly supports: (agent: AgentId, type: ArtifactType) => boolean;
  /** All agents known to the build, in display order. */
  readonly allAgents: readonly AgentId[];
}

interface Rule {
  readonly path: string;
  readonly spec: TargetSpec;
}

/**
 * Walk the ladder from most specific to least, applying relative specs to whatever
 * the next rule up produced.
 */
const applyLadder = (
  rules: readonly (Rule | null)[],
  builtIn: readonly AgentId[],
): { targets: readonly AgentId[]; provenance: Provenance } => {
  const [rule, ...rest] = rules;

  if (rule === undefined) return { targets: builtIn, provenance: { rule: '<built-in>' } };
  if (rule === null) return applyLadder(rest, builtIn);

  const spec = rule.spec;
  if (Array.isArray(spec)) {
    return { targets: [...spec], provenance: { rule: rule.path } };
  }

  // Relative spec: derive from whatever the next rule up the ladder resolved to.
  const base = applyLadder(rest, builtIn);
  const removed = new Set(spec.remove ?? []);
  const kept = base.targets.filter((agent) => !removed.has(agent));
  const added = (spec.add ?? []).filter((agent) => !kept.includes(agent));

  const modifiers = [
    ...(spec.add ?? []).map((a) => `+${a}`),
    ...(spec.remove ?? []).map((a) => `-${a}`),
  ];

  return {
    targets: [...kept, ...added],
    provenance: { rule: rule.path, derivedFrom: base.provenance.rule, modifiers },
  };
};

const ruleFor = (path: string, spec: TargetSpec | undefined): Rule | null =>
  spec === undefined ? null : { path, spec };

/**
 * Resolve global-scope deployments. Project scope arrives in M2; the ladder below is
 * written so project layers slot in ahead of the artifact rule without restructuring.
 */
export const resolveGlobal = (input: ResolveInput): RoutingTable => {
  const { manifest, device, supports, allAgents } = input;
  const deployments: Deployment[] = [];
  const diagnostics: Diagnostic[] = [];

  const disabled = new Set(device.disable ?? []);
  const deviceAgents = new Set<AgentId>(device.agents);
  const scope: Scope = { kind: 'global' };

  for (const type of ['skill', 'mcp', 'plugin'] as const) {
    const entries = manifest.artifacts?.[type] ?? {};

    for (const id of Object.keys(entries).sort()) {
      const entry = entries[id];
      if (entry === undefined) continue;

      const ref = formatArtifactRef({ type, id });
      if (entry.scope === 'project') continue; // deployed only via project includes

      if (disabled.has(ref)) {
        diagnostics.push({
          kind: 'artifact-disabled',
          ref,
          message: `${ref} is disabled on device "${device.device}"`,
        });
        continue;
      }

      const { targets, provenance } = applyLadder(
        [
          ruleFor(`artifacts.${type}.${id}.targets`, entry.targets),
          ruleFor(`defaults.${type}.targets`, manifest.defaults?.[type]?.targets),
        ],
        allAgents.filter((agent) => supports(agent, type)),
      );

      for (const agent of targets) {
        if (!supports(agent, type)) {
          diagnostics.push({
            kind: 'capability-unsupported',
            ref,
            agent,
            message: `${ref} → ${agent}: ${agent} has no ${type} support`,
          });
          continue;
        }
        if (!deviceAgents.has(agent)) {
          diagnostics.push({
            kind: 'device-masked',
            ref,
            agent,
            message: `${ref} → ${agent}: not installed on device "${device.device}"`,
          });
          continue;
        }
        deployments.push({ type, id, scope, agent, provenance });
      }
    }
  }

  return { deployments, diagnostics };
};

/** One-line explanation of why a deployment happened, for `status --why`. */
export const explain = (deployment: Deployment): string => {
  const { rule, derivedFrom, modifiers } = deployment.provenance;
  if (derivedFrom === undefined) return rule;
  return `${derivedFrom} then ${rule} (${(modifiers ?? []).join(' ')})`;
};
