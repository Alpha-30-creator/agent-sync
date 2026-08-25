/**
 * The canonical MCP server definition (docs/03-architecture.md §7).
 *
 * One definition, three dialects. The schema is deliberately a *superset* of what the
 * agents support: a field a target cannot express produces a visible warning at apply
 * time rather than a silent drop or a hard failure.
 *
 * Secrets are never stored here. `env` values may reference `${secret:name}` (resolved
 * from the device's own secrets file) or `${env:VAR}` (an environment variable, passed
 * through to agents that expand it themselves).
 */
import { z } from 'zod';

export const TRANSPORTS = ['stdio', 'http', 'sse'] as const;
export type Transport = (typeof TRANSPORTS)[number];

const perAgentTweaks = z
  .object({
    /** Codex only: seconds to wait for the server to start. */
    startup_timeout_sec: z.number().positive().optional(),
    /** Codex only: seconds to wait for a tool call. */
    tool_timeout_sec: z.number().positive().optional(),
    /** Cursor only: path to a dotenv file the agent loads for this server. */
    envFile: z.string().min(1).optional(),
    /** Deploy the definition but leave it switched off. */
    enabled: z.boolean().optional(),
  })
  .strict();

const common = {
  /** Extra settings that only some agents understand. */
  agents: z
    .object({
      claude: perAgentTweaks.optional(),
      codex: perAgentTweaks.optional(),
      cursor: perAgentTweaks.optional(),
    })
    .strict()
    .optional(),
  env: z.record(z.string(), z.string()).optional(),
};

export const mcpDefinitionSchema = z.discriminatedUnion('transport', [
  z
    .object({
      transport: z.literal('stdio'),
      command: z.string().min(1),
      args: z.array(z.string()).optional(),
      ...common,
    })
    .strict(),
  z
    .object({
      transport: z.literal('http'),
      url: z.string().min(1),
      headers: z.record(z.string(), z.string()).optional(),
      ...common,
    })
    .strict(),
  z
    .object({
      transport: z.literal('sse'),
      url: z.string().min(1),
      headers: z.record(z.string(), z.string()).optional(),
      ...common,
    })
    .strict(),
]);

export type McpDefinition = z.infer<typeof mcpDefinitionSchema>;

export interface McpIssue {
  readonly path: string;
  readonly message: string;
}

export const parseMcpDefinition = (
  input: unknown,
): { ok: true; value: McpDefinition } | { ok: false; issues: readonly McpIssue[] } => {
  const result = mcpDefinitionSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };

  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.') || '<root>',
      message: issue.message,
    })),
  };
};

/** A `${secret:name}` or `${env:VAR}` reference inside a value. */
export interface Reference {
  readonly kind: 'secret' | 'env';
  readonly name: string;
}

const REFERENCE = /^\$\{(secret|env):([A-Za-z0-9_.-]+)\}$/;

export const parseReference = (value: string): Reference | null => {
  const match = REFERENCE.exec(value.trim());
  if (match === null) return null;
  return { kind: match[1] as 'secret' | 'env', name: match[2] as string };
};

/** Every secret a definition needs, so `doctor` can report what is missing. */
export const requiredSecrets = (definition: McpDefinition): readonly string[] => {
  // Both maps are optional; collecting them uniformly avoids a defensive branch that
  // could never be reached, and therefore never tested.
  const maps = [definition.env, 'headers' in definition ? definition.headers : undefined];
  const values = maps.flatMap((map) => (map === undefined ? [] : Object.values(map)));
  return [
    ...new Set(
      values.flatMap((value) => {
        const reference = parseReference(value);
        return reference?.kind === 'secret' ? [reference.name] : [];
      }),
    ),
  ].sort();
};

/**
 * A value that looks like a credential written inline rather than referenced.
 * Used to warn before such a thing is committed to a git repository.
 */
export const looksLikeSecret = (key: string, value: string): boolean => {
  if (parseReference(value) !== null) return false;
  const suspiciousKey = /(token|secret|key|password|passwd|credential|auth)/i.test(key);
  const suspiciousValue =
    /^(sk-|ghp_|gho_|github_pat_|xox[baprs]-|AKIA)/.test(value) || value.length > 40;
  return suspiciousKey && suspiciousValue;
};
