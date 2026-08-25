/**
 * Surgical TOML editing by text span (ADR 0007).
 *
 * Codex's `config.toml` holds its entire state. Round-tripping it through a TOML
 * serializer rewrites unrelated content — Codex's own `codex mcp add` drops keys,
 * reorders env tables, and turns `120` into `120.0`. So agent-sync never re-serializes
 * the document: it locates the managed table's line span and splices only that region,
 * leaving every other byte untouched.
 *
 * Pure text in, text out. The caller re-parses the result with a real TOML parser and
 * compares the unmanaged regions before writing anything to disk.
 */

export interface TableSpan {
  /** Fully qualified table name, e.g. `mcp_servers.github`. */
  readonly name: string;
  /** First line of the header, inclusive. */
  readonly start: number;
  /** Line after the table's content, exclusive. */
  readonly end: number;
}

const HEADER = /^\s*\[\[?([^\]]+)\]\]?\s*(?:#.*)?$/;

/** Line spans of every table header in the document, in file order. */
export const tableSpans = (text: string): readonly TableSpan[] => {
  const lines = text.split('\n');
  const found: { name: string; start: number }[] = [];

  lines.forEach((line, index) => {
    const match = HEADER.exec(line);
    if (match?.[1] !== undefined) found.push({ name: match[1].trim(), start: index });
  });

  return found.map((entry, i) => ({
    name: entry.name,
    start: entry.start,
    end: found[i + 1]?.start ?? lines.length,
  }));
};

/** True when `name` is `root` itself or one of its subtables. */
export const belongsTo = (name: string, root: string): boolean =>
  name === root || name.startsWith(`${root}.`);

/**
 * Remove a table and its subtables. Every other line is preserved exactly,
 * including comments, spacing, and value formatting.
 *
 * Trailing blank lines left behind by the removal are collapsed to a single final
 * newline, which is what makes `upsert` followed by `remove` byte-identical to the
 * original. A removal that matches nothing returns the input untouched.
 */
export const removeTable = (text: string, root: string): string => {
  const lines = text.split('\n');
  const doomed = new Set<number>();

  for (const span of tableSpans(text)) {
    if (!belongsTo(span.name, root)) continue;
    for (let i = span.start; i < span.end; i += 1) doomed.add(i);
  }

  if (doomed.size === 0) return text;

  const kept = lines.filter((_, i) => !doomed.has(i)).join('\n');
  const trimmed = kept.replace(/\n+$/, '');
  return trimmed.length === 0 ? '' : `${trimmed}\n`;
};

/** True when the document already declares the table (or a subtable of it). */
export const hasTable = (text: string, root: string): boolean =>
  tableSpans(text).some((span) => belongsTo(span.name, root));

/**
 * Insert or replace a table. Existing occurrences are removed first, then the new
 * block is appended, so an upsert followed by a remove restores the original bytes.
 */
export const upsertTable = (text: string, root: string, block: string): string => {
  const withoutTable = removeTable(text, root).replace(/\n+$/, '');
  const body = block.trim();
  return withoutTable.length === 0 ? `${body}\n` : `${withoutTable}\n\n${body}\n`;
};

/** Quote a TOML key only when it cannot be written bare. */
export const formatKey = (key: string): string =>
  /^[A-Za-z0-9_-]+$/.test(key) ? key : `"${key.replace(/(["\\])/g, '\\$1')}"`;
