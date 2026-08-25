import { err, ok, type Result } from '../result.js';
import { suggest } from '../text/suggest.js';
import {
  AGENT_IDS,
  type AgentId,
  ARTIFACT_TYPES,
  type ArtifactType,
  type PartialArtifactRef,
} from './types.js';

/**
 * Ids are lowercase kebab-case. Enforced rather than normalized: macOS and Windows
 * filesystems are case-insensitive by default, so `MySkill` and `myskill` would collide
 * on one machine and not another (docs/05-tech-stack.md §4).
 */
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type IdError =
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid-format'; readonly value: string };

export type RefError =
  | IdError
  | { readonly kind: 'unknown-type'; readonly value: string; readonly suggestion: string | null }
  | { readonly kind: 'too-many-segments'; readonly value: string };

export type AgentError = {
  readonly kind: 'unknown-agent';
  readonly value: string;
  readonly suggestion: string | null;
};

const parseId = (raw: string): Result<string, IdError> => {
  if (raw.length === 0) return err({ kind: 'empty' });
  if (!ID_PATTERN.test(raw)) return err({ kind: 'invalid-format', value: raw });
  return ok(raw);
};

/** Validate an artifact or project id. */
export const parseArtifactId = parseId;

/** Parse `type/id` or a bare `id` into a reference. */
export const parseArtifactRef = (raw: string): Result<PartialArtifactRef, RefError> => {
  const input = raw.trim();
  if (input.length === 0) return err({ kind: 'empty' });

  const slash = input.indexOf('/');
  if (slash === -1) {
    const bare = parseId(input);
    return bare.ok ? ok({ type: null, id: bare.value }) : err(bare.error);
  }

  const rawType = input.slice(0, slash);
  const remainder = input.slice(slash + 1);
  if (remainder.includes('/')) return err({ kind: 'too-many-segments', value: input });

  const type = ARTIFACT_TYPES.find((t): t is ArtifactType => t === rawType);
  if (type === undefined) {
    return err({
      kind: 'unknown-type',
      value: rawType,
      suggestion: suggest(rawType, ARTIFACT_TYPES),
    });
  }

  const id = parseId(remainder);
  return id.ok ? ok({ type, id: id.value }) : err(id.error);
};

/** Render a reference back to its canonical `type/id` form. */
export const formatArtifactRef = (ref: { type: ArtifactType | null; id: string }): string =>
  ref.type === null ? ref.id : `${ref.type}/${ref.id}`;

/** Parse an agent name, with a suggestion for near misses (`corsur` → `cursor`). */
export const parseAgentId = (raw: string): Result<AgentId, AgentError> => {
  const input = raw.trim();
  const match = AGENT_IDS.find((a): a is AgentId => a === input);
  if (match !== undefined) return ok(match);
  return err({ kind: 'unknown-agent', value: input, suggestion: suggest(input, AGENT_IDS) });
};
