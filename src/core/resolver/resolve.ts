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

/**
 * Where a target set came from, for `--why` output. A derived provenance always
 * carries its modifiers, so no consumer has to handle a half-populated chain.
 */
export type Provenance =
  /** Manifest path of the winning rule, or `<built-in>`. */
  | { readonly rule: string }
  | {
      readonly rule: string;
      /** Rule the winning spec was derived from. */
      readonly derivedFrom: string;
      /** Modifiers applied, e.g. `+codex`, `-claude`. */
      readonly modifiers: readonly string[];
    };

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
  | { readonly kind: 'artifact-disabled'; readonly ref: string; readonly message: string }
  /** One written copy serves several agents, because they read the same directory. */
  | {
      readonly kind: 'placement-shared';
      readonly ref: string;
      readonly agent: AgentId;
      readonly message: string;
    }
  /**
   * An agent that was *not* routed can still see the artifact, because it discovers a
   * directory we had to write for another agent. Reported rather than hidden, since
   * pretending the exclusion worked would be a lie (docs/04-sync-model.md §7).
   */
  | {
      readonly kind: 'not-excludable';
      readonly ref: string;
      readonly agent: AgentId;
      readonly message: string;
    };

/**
 * Not every diagnostic is a problem. "One copy also serves Cursor" is how correct
 * placement *works*; "you routed this to an agent that cannot support it" is the tool
 * failing to do what you asked. Only the latter should colour the exit code, otherwise
 * exit 2 stops meaning anything.
 */
export type Severity = 'info' | 'warning';

export const severityOf = (diagnostic: Diagnostic): Severity => {
  switch (diagnostic.kind) {
    case 'placement-shared':
    // The user asked for this one explicitly on this device.
    case 'artifact-disabled':
      return 'info';
    case 'capability-unsupported':
    case 'device-masked':
    case 'not-excludable':
      return 'warning';
  }
};

export const warnings = (diagnostics: readonly Diagnostic[]): readonly Diagnostic[] =>
  diagnostics.filter((diagnostic) => severityOf(diagnostic) === 'warning');

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

/** A project the manifest declares *and* this device has a local path for. */
export interface LinkedProject {
  readonly id: string;
  readonly localPath: string;
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

    for (const [id, entry] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
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

/**
 * Resolve project-scope deployments for the projects this device has linked.
 *
 * The ladder gains its two project layers here. Note the documented ordering: a global
 * per-artifact rule (layer 2) is *more* specific than a project default (layer 3), so
 * "this skill is claude-only everywhere" survives a project that otherwise routes
 * skills to Cursor. Use a per-artifact-per-project rule to override that.
 */
export const resolveProjects = (
  input: ResolveInput,
  projects: readonly LinkedProject[],
): RoutingTable => {
  const { manifest, device, supports, allAgents } = input;
  const deployments: Deployment[] = [];
  const diagnostics: Diagnostic[] = [];

  const disabled = new Set(device.disable ?? []);
  const deviceAgents = new Set<AgentId>(device.agents);

  for (const project of projects) {
    const declared = manifest.projects?.[project.id];
    if (declared === undefined) continue;

    const scope: Scope = { kind: 'project', projectId: project.id };

    for (const reference of declared.include ?? []) {
      const parsed = parseIncludeReference(reference);
      if (parsed === null) continue;
      const { type, id } = parsed;

      const ref = formatArtifactRef({ type, id });
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
          ruleFor(
            `projects.${project.id}.artifacts.${type}.${id}.targets`,
            declared.artifacts?.[type]?.[id]?.targets,
          ),
          ruleFor(`artifacts.${type}.${id}.targets`, manifest.artifacts?.[type]?.[id]?.targets),
          ruleFor(
            `projects.${project.id}.defaults.${type}.targets`,
            declared.defaults?.[type]?.targets,
          ),
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

/**
 * `type/id` as written in a project's include list.
 *
 * Manifest validation already rejects references that are malformed or point at
 * undeclared artifacts, so the null results are unreachable from `resolveProjects`.
 * They are kept, exported, and tested anyway: resolution must stay total (invariant 1)
 * even if validation is ever loosened.
 */
export const parseIncludeReference = (
  reference: string,
): { type: ArtifactType; id: string } | null => {
  const slash = reference.indexOf('/');
  if (slash === -1) return null;
  const type = reference.slice(0, slash);
  const id = reference.slice(slash + 1);
  if (type !== 'skill' && type !== 'mcp' && type !== 'plugin') return null;
  return { type, id };
};

/** One-line explanation of why a deployment happened, for `status --why`. */
export const explain = (deployment: Deployment): string => {
  const provenance = deployment.provenance;
  if (!('derivedFrom' in provenance)) return provenance.rule;
  return `${provenance.derivedFrom} then ${provenance.rule} (${provenance.modifiers.join(' ')})`;
};
