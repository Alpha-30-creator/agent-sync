/**
 * Reading and writing MCP entries in each agent's own configuration.
 *
 * Every write here goes into a file the user owns and edits. Two rules, enforced in
 * this module rather than trusted to callers (ADR 0007, NFR-4):
 *
 *  1. A file that cannot be parsed is never written — we refuse instead of guessing.
 *  2. Shared files are edited surgically: only the managed key or table changes, and
 *     the file is backed up before the first edit of a run.
 */
import { existsSync } from 'node:fs';
import { applyEdits, modify, type ParseError, parse as parseJsonc } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import { removeTable, upsertTable } from '../core/formats/toml-edit.js';
import { normalizeTomlEntry, renderTomlBlock, tableNameFor } from '../core/mcp/render-toml.js';
import { stableStringify } from '../core/mcp/translate.js';
import { readTextFile, sha256, writeFileAtomic } from '../shell/fs.js';
import type { ConfigFormat, McpLocation } from './capability-table.js';

export type ReadOutcome =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly value: Record<string, unknown> }
  | { readonly kind: 'unparseable'; readonly message: string };

const jsonFormatting = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

/** Read one server's current definition from an agent's config. */
export const readMcpEntry = (location: McpLocation, id: string): ReadOutcome => {
  const text = readTextFile(location.path);
  if (text === null) return { kind: 'absent' };

  if (location.format === 'toml') {
    let document: Record<string, unknown>;
    try {
      document = parseToml(text) as Record<string, unknown>;
    } catch (error) {
      return { kind: 'unparseable', message: (error as Error).message };
    }
    const servers = document[location.container[0] as string];
    if (servers === undefined || typeof servers !== 'object') return { kind: 'absent' };
    const entry = (servers as Record<string, unknown>)[id];
    if (entry === undefined || typeof entry !== 'object') return { kind: 'absent' };
    return { kind: 'present', value: normalizeTomlEntry(entry as Record<string, unknown>) };
  }

  const errors: ParseError[] = [];
  const document = parseJsonc(text, errors, { allowTrailingComma: true }) as
    | Record<string, unknown>
    | undefined;
  if (errors.length > 0 || document === undefined) {
    return { kind: 'unparseable', message: `invalid JSON in ${location.path}` };
  }

  let cursor: unknown = document;
  for (const key of location.container) {
    if (cursor === null || typeof cursor !== 'object') return { kind: 'absent' };
    cursor = (cursor as Record<string, unknown>)[key];
  }
  if (cursor === null || typeof cursor !== 'object') return { kind: 'absent' };

  const entry = (cursor as Record<string, unknown>)[id];
  if (entry === undefined || typeof entry !== 'object' || entry === null) return { kind: 'absent' };
  return { kind: 'present', value: entry as Record<string, unknown> };
};

/** Hash of a server's current state, compared semantically rather than byte-wise. */
export const hashEntry = (value: Record<string, unknown> | null): string | null =>
  value === null ? null : sha256(stableStringify(value));

export type WriteOutcome =
  | { readonly kind: 'written' }
  | { readonly kind: 'refused'; readonly message: string };

const guardParseable = (location: McpLocation, text: string): string | null => {
  if (location.format === 'toml') {
    try {
      parseToml(text);
      return null;
    } catch (error) {
      return `cannot parse ${location.path}: ${(error as Error).message}`;
    }
  }
  const errors: ParseError[] = [];
  parseJsonc(text, errors, { allowTrailingComma: true });
  return errors.length > 0 ? `cannot parse ${location.path}` : null;
};

const emptyDocument = (format: ConfigFormat): string => (format === 'toml' ? '' : '{}\n');

/**
 * Upsert one server. `backup` is invoked with the existing text before the first edit
 * of a run, so callers can keep a copy without this module knowing where backups live.
 */
export const writeMcpEntry = (
  location: McpLocation,
  id: string,
  value: Record<string, unknown>,
  backup: (path: string) => void,
): WriteOutcome => {
  const existing = readTextFile(location.path);
  const text = existing ?? emptyDocument(location.format);

  if (existing !== null) {
    const problem = guardParseable(location, existing);
    if (problem !== null) {
      return {
        kind: 'refused',
        message: `${problem}\nrefusing to write rather than risk your configuration`,
      };
    }
    backup(location.path);
  }

  if (location.format === 'toml') {
    const updated = upsertTable(text, tableNameFor(id), renderTomlBlock(id, value));
    const problem = guardParseable(location, updated);
    if (problem !== null) {
      return { kind: 'refused', message: `the edit would have produced invalid TOML (${problem})` };
    }
    writeFileAtomic(location.path, updated);
    return { kind: 'written' };
  }

  const updated = applyEdits(
    text,
    modify(text, [...location.container, id], value, jsonFormatting),
  );
  const problem = guardParseable(location, updated);
  if (problem !== null) {
    return { kind: 'refused', message: `the edit would have produced invalid JSON (${problem})` };
  }
  writeFileAtomic(location.path, updated);
  return { kind: 'written' };
};

/** Remove a server we own, leaving everything else in the file untouched. */
export const removeMcpEntry = (
  location: McpLocation,
  id: string,
  backup: (path: string) => void,
): WriteOutcome => {
  const existing = readTextFile(location.path);
  if (existing === null) return { kind: 'written' };

  const problem = guardParseable(location, existing);
  if (problem !== null) return { kind: 'refused', message: problem };
  backup(location.path);

  if (location.format === 'toml') {
    writeFileAtomic(location.path, removeTable(existing, tableNameFor(id)));
    return { kind: 'written' };
  }

  const updated = applyEdits(
    existing,
    modify(existing, [...location.container, id], undefined, jsonFormatting),
  );
  writeFileAtomic(location.path, updated);
  return { kind: 'written' };
};

/** Every server currently declared in an agent's config — used by `import`. */
export const listMcpEntries = (location: McpLocation): Readonly<Record<string, unknown>> => {
  const text = readTextFile(location.path);
  if (text === null) return {};

  try {
    if (location.format === 'toml') {
      const document = parseToml(text) as Record<string, unknown>;
      const servers = document[location.container[0] as string];
      return servers !== undefined && typeof servers === 'object'
        ? (servers as Record<string, unknown>)
        : {};
    }

    const errors: ParseError[] = [];
    const document = parseJsonc(text, errors, { allowTrailingComma: true }) as
      | Record<string, unknown>
      | undefined;
    if (errors.length > 0 || document === undefined) return {};

    let cursor: unknown = document;
    for (const key of location.container) {
      if (cursor === null || typeof cursor !== 'object') return {};
      cursor = (cursor as Record<string, unknown>)[key];
    }
    return cursor !== null && typeof cursor === 'object' ? (cursor as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export const configExists = (location: McpLocation): boolean => existsSync(location.path);
