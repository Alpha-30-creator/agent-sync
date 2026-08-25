/**
 * Reverse translation: an agent's existing MCP entry → a canonical definition.
 *
 * Used by `import` to adopt what a user already has. Two judgement calls, both made
 * conservatively because this data ends up in a git repository:
 *
 *  - A value that looks like a credential becomes a `${secret:...}` reference, and the
 *    literal is handed back separately for the caller to store on the device only.
 *  - Anything the canonical schema cannot express is reported, not silently dropped.
 */
import { looksLikeSecret, type McpDefinition, parseMcpDefinition } from './schema.js';

export interface AdoptResult {
  readonly definition: McpDefinition | null;
  /** Secret name → literal value, to be stored on this device and never committed. */
  readonly extractedSecrets: Readonly<Record<string, string>>;
  readonly notes: readonly string[];
}

const asStringMap = (value: unknown): Record<string, string> | undefined => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
};

/** Convert credential-looking literals into references, collecting the values. */
const extractSecrets = (
  id: string,
  label: string,
  map: Record<string, string> | undefined,
): {
  map: Record<string, string> | undefined;
  secrets: Record<string, string>;
  notes: string[];
} => {
  if (map === undefined) return { map: undefined, secrets: {}, notes: [] };

  const out: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  const notes: string[] = [];

  for (const [key, value] of Object.entries(map)) {
    if (!looksLikeSecret(key, value)) {
      out[key] = value;
      continue;
    }
    const name = `${id}-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/-+/g, '-');
    out[key] = `\${secret:${name}}`;
    secrets[name] = value;
    notes.push(
      `${label}.${key} looked like a credential — kept on this device as secret "${name}"`,
    );
  }

  return { map: out, secrets, notes };
};

/** Adopt one entry from an agent's config into the canonical shape. */
export const adoptMcpEntry = (
  id: string,
  entry: Readonly<Record<string, unknown>>,
): AdoptResult => {
  const notes: string[] = [];
  const type = typeof entry.type === 'string' ? entry.type : undefined;
  const url = typeof entry.url === 'string' ? entry.url : undefined;
  const command = typeof entry.command === 'string' ? entry.command : undefined;

  const env = extractSecrets(id, 'env', asStringMap(entry.env));
  const headers = extractSecrets(id, 'headers', asStringMap(entry.headers));
  const secrets = { ...env.secrets, ...headers.secrets };
  notes.push(...env.notes, ...headers.notes);

  const draft: Record<string, unknown> =
    url !== undefined
      ? {
          transport: type === 'sse' ? 'sse' : 'http',
          url,
          ...(headers.map === undefined ? {} : { headers: headers.map }),
          ...(env.map === undefined ? {} : { env: env.map }),
        }
      : {
          transport: 'stdio',
          command,
          ...(Array.isArray(entry.args)
            ? { args: (entry.args as unknown[]).filter((a): a is string => typeof a === 'string') }
            : {}),
          ...(env.map === undefined ? {} : { env: env.map }),
        };

  // Fields the canonical schema does not carry are reported rather than dropped quietly.
  const known = new Set(['type', 'url', 'command', 'args', 'env', 'headers']);
  for (const key of Object.keys(entry)) {
    if (!known.has(key)) notes.push(`"${key}" is agent-specific and was not adopted`);
  }

  const parsed = parseMcpDefinition(draft);
  if (!parsed.ok) {
    return {
      definition: null,
      extractedSecrets: secrets,
      notes: [...notes, ...parsed.issues.map((issue) => `${issue.path}: ${issue.message}`)],
    };
  }

  return { definition: parsed.value, extractedSecrets: secrets, notes };
};
