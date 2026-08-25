/** Core domain vocabulary. See docs/04-sync-model.md §1. */

export const AGENT_IDS = ['claude', 'codex', 'cursor'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const ARTIFACT_TYPES = ['skill', 'mcp', 'plugin'] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

/** A concrete artifact in the canonical store, e.g. `skill/db-migrate`. */
export interface ArtifactRef {
  readonly type: ArtifactType;
  readonly id: string;
}

/**
 * A reference as typed by a user or agent: the type may be omitted when it is
 * unambiguous in context (`db-migrate` rather than `skill/db-migrate`).
 */
export interface PartialArtifactRef {
  readonly type: ArtifactType | null;
  readonly id: string;
}

/** Where a deployment lands. Project instances carry the project's stable id, never a path. */
export type Scope =
  | { readonly kind: 'global' }
  | { readonly kind: 'project'; readonly projectId: string };

/** The set of agents an artifact is routed to in a given context. */
export type TargetSet = readonly AgentId[];
