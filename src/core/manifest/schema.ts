/**
 * The manifest schema (docs/04-sync-model.md §4) and its validation.
 *
 * Validation is the gate that keeps malformed data out of the pure core: everything
 * downstream may assume a Manifest is structurally valid. Errors carry the exact
 * manifest path and, where possible, a suggestion — they are read by humans and by
 * agents, not by developers with a debugger (NFR-6).
 */
import { z } from 'zod';
import { ID_PATTERN } from '../model/ids.js';
import { AGENT_IDS, type AgentId, ARTIFACT_TYPES, type ArtifactType } from '../model/types.js';
import { suggest } from '../text/suggest.js';

const agentId = z.string().superRefine((value, ctx) => {
  if ((AGENT_IDS as readonly string[]).includes(value)) return;
  const hint = suggest(value, AGENT_IDS);
  ctx.addIssue({
    code: 'custom',
    message:
      hint === null
        ? `unknown agent "${value}" — known agents: ${AGENT_IDS.join(', ')}`
        : `unknown agent "${value}" — did you mean "${hint}"?`,
  });
}) as unknown as z.ZodType<AgentId>;

// Record *keys* are validated in the semantic pass below rather than here: zod
// replaces key-level messages with a generic "Invalid key in record", which is
// exactly the kind of unhelpful error NFR-6 forbids.
const identifier = z.string();

/**
 * Targets are either an absolute set, or a relative adjustment of whatever the next
 * rule up the precedence ladder resolved to.
 */
export const targetSpecSchema = z.union([
  z.array(agentId),
  z
    .object({ add: z.array(agentId).optional(), remove: z.array(agentId).optional() })
    .strict()
    .refine((v) => v.add !== undefined || v.remove !== undefined, {
      message: 'expected at least one of "add" or "remove"',
    }),
]);

export type TargetSpec = z.infer<typeof targetSpecSchema>;

export const artifactEntrySchema = z
  .object({
    targets: targetSpecSchema.optional(),
    scope: z.enum(['global', 'project']).optional(),
    /** Marketplace source; plugins only. */
    source: z.string().min(1).optional(),
  })
  .strict();

export type ArtifactEntry = z.infer<typeof artifactEntrySchema>;

const artifactMap = z.record(identifier, artifactEntrySchema);
const typeDefaults = z.object({ targets: targetSpecSchema.optional() }).strict();

const byType = <T extends z.ZodTypeAny>(value: T) =>
  z
    .object({
      skill: value.optional(),
      mcp: value.optional(),
      plugin: value.optional(),
    })
    .strict();

export const projectEntrySchema = z
  .object({
    defaults: byType(typeDefaults).optional(),
    /** `type/id` references deployed into this project. */
    include: z.array(z.string()).optional(),
    private: z.array(z.string()).optional(),
    artifacts: byType(artifactMap).optional(),
    /** Normalized git remote, recorded as a linking hint only. */
    remote: z.string().optional(),
  })
  .strict();

export const manifestSchema = z
  .object({
    version: z.literal(1),
    defaults: byType(typeDefaults).optional(),
    artifacts: byType(artifactMap).optional(),
    projects: z.record(identifier, projectEntrySchema).optional(),
  })
  .strict();

export type Manifest = z.infer<typeof manifestSchema>;
export type ProjectEntry = z.infer<typeof projectEntrySchema>;

export const deviceSchema = z
  .object({
    device: identifier,
    agents: z.array(agentId),
    projects: z.record(identifier, z.string()).optional(),
    /** `type/id` references switched off on this machine only. */
    disable: z.array(z.string()).optional(),
  })
  .strict();

export type Device = z.infer<typeof deviceSchema>;

/** A validation failure, located in the document a human can open and fix. */
export interface ValidationIssue {
  /** Dotted manifest path, e.g. `artifacts.skill.db-migrate.targets[1]`. */
  readonly path: string;
  readonly message: string;
}

const formatPath = (segments: readonly PropertyKey[]): string =>
  segments.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    return acc.length === 0 ? String(segment) : `${acc}.${String(segment)}`;
  }, '');

const toIssues = (error: z.ZodError): readonly ValidationIssue[] =>
  error.issues.map((issue) => ({
    path: formatPath(issue.path) || '<root>',
    message: issue.message,
  }));

const idIssue = (path: string, kind: string, value: string): ValidationIssue => ({
  path,
  message: `invalid ${kind} id "${value}" — must be lowercase kebab-case (a-z, 0-9, hyphens)`,
});

/**
 * Checks the schema cannot express: id shape, and references that must resolve to
 * something declared. Structural validity is assumed — run this only after parsing.
 */
export const semanticIssues = (manifest: Manifest): readonly ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const declared = new Set<string>();

  for (const type of ARTIFACT_TYPES) {
    const entries = manifest.artifacts?.[type] ?? {};
    for (const [id, entry] of Object.entries(entries)) {
      if (!ID_PATTERN.test(id)) issues.push(idIssue(`artifacts.${type}.${id}`, 'artifact', id));
      declared.add(`${type}/${id}`);
      if (type === 'plugin' && entry.source === undefined) {
        issues.push({
          path: `artifacts.plugin.${id}.source`,
          message: 'a plugin needs a "source" — the marketplace it is installed from',
        });
      }
    }
  }

  const checkReference = (path: string, reference: string): void => {
    if (declared.has(reference)) return;
    const hint = suggest(reference, [...declared]);
    issues.push({
      path,
      message:
        hint === null
          ? `"${reference}" is not declared under artifacts`
          : `"${reference}" is not declared under artifacts — did you mean "${hint}"?`,
    });
  };

  for (const [projectId, project] of Object.entries(manifest.projects ?? {})) {
    if (!ID_PATTERN.test(projectId))
      issues.push(idIssue(`projects.${projectId}`, 'project', projectId));

    project.include?.forEach((reference, index) => {
      checkReference(`projects.${projectId}.include[${index}]`, reference);
    });
    project.private?.forEach((reference, index) => {
      checkReference(`projects.${projectId}.private[${index}]`, reference);
    });

    for (const type of ARTIFACT_TYPES) {
      const overrides = project.artifacts?.[type] ?? {};
      for (const id of Object.keys(overrides)) {
        checkReference(`projects.${projectId}.artifacts.${type}.${id}`, `${type}/${id}`);
      }
    }
  }

  return issues;
};

/**
 * Parse and fully validate a manifest, returning located issues rather than throwing.
 * Semantic checks run only once the structure is known good, so paths are meaningful.
 */
export const parseManifest = (
  input: unknown,
): { ok: true; value: Manifest } | { ok: false; issues: readonly ValidationIssue[] } => {
  const result = manifestSchema.safeParse(input);
  if (!result.success) return { ok: false, issues: toIssues(result.error) };

  const issues = semanticIssues(result.data);
  return issues.length === 0 ? { ok: true, value: result.data } : { ok: false, issues };
};

/** Parse a device file, returning located issues rather than throwing. */
export const parseDevice = (
  input: unknown,
): { ok: true; value: Device } | { ok: false; issues: readonly ValidationIssue[] } => {
  const result = deviceSchema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: toIssues(result.error) };
};

/** Every artifact declared in the manifest, in a stable order. */
export const declaredArtifacts = (
  manifest: Manifest,
): readonly { type: ArtifactType; id: string; entry: ArtifactEntry }[] =>
  ARTIFACT_TYPES.flatMap((type) => {
    const entries = manifest.artifacts?.[type] ?? {};
    return Object.keys(entries)
      .sort()
      .map((id) => ({ type, id, entry: entries[id] as ArtifactEntry }));
  });
