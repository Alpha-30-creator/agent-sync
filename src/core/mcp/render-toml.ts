/**
 * Rendering a translated MCP value as a Codex TOML block.
 *
 * Pure text generation only — the block is handed to the splicer
 * (`core/formats/toml-edit.ts`), which places it without re-serialising anything else
 * in the user's config (ADR 0007).
 */
import { formatKey } from '../formats/toml-edit.js';

const scalar = (value: unknown): string => {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return String(value);
  // `String` keeps an integer an integer. Codex's own CLI widens 120 to 120.0 when it
  // rewrites config; we do not (docs/02-agent-landscape.md §5a).
  if (typeof value === 'number') return String(value);
  return JSON.stringify(String(value));
};

const inlineArray = (values: readonly unknown[]): string => `[${values.map(scalar).join(', ')}]`;

/** Codex table name for a server, e.g. `mcp_servers.github`. */
export const tableNameFor = (id: string): string => `mcp_servers.${formatKey(id)}`;

/**
 * Render `[mcp_servers.<id>]` plus its `.env` and `.headers` subtables.
 *
 * `type` is dropped: Codex infers the transport from whether `command` or `url` is
 * present, and writing an unknown key into someone's config is exactly the kind of
 * liberty this tool refuses to take.
 */
export const renderTomlBlock = (id: string, value: Readonly<Record<string, unknown>>): string => {
  const table = tableNameFor(id);
  const lines: string[] = [`[${table}]`];
  const subTables: string[] = [];

  for (const [key, entry] of Object.entries(value)) {
    if (key === 'type' || entry === undefined) continue;

    if (Array.isArray(entry)) {
      lines.push(`${formatKey(key)} = ${inlineArray(entry)}`);
      continue;
    }

    if (entry !== null && typeof entry === 'object') {
      const nested = Object.entries(entry as Record<string, unknown>);
      if (nested.length === 0) continue;
      subTables.push(
        [
          `[${table}.${formatKey(key)}]`,
          ...nested.map(
            ([nestedKey, nestedValue]) => `${formatKey(nestedKey)} = ${scalar(nestedValue)}`,
          ),
        ].join('\n'),
      );
      continue;
    }

    lines.push(`${formatKey(key)} = ${scalar(entry)}`);
  }

  // Subtables are separated by a blank line, matching how Codex formats its own.
  return [lines.join('\n'), ...subTables].join('\n\n');
};

/**
 * Turn a parsed Codex table back into the shape `translate` produces, so the two can
 * be compared for drift without caring about TOML formatting.
 */
export const normalizeTomlEntry = (
  entry: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const value: Record<string, unknown> = { ...entry };
  // Codex infers transport; re-derive it so both sides of the comparison agree.
  value.type = typeof entry.url === 'string' ? 'http' : 'stdio';
  return value;
};
