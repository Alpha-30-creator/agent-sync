/**
 * The riskiest write path in the system: editing MCP entries inside configuration
 * files the user owns and also edits by hand.
 *
 * These assert the property that protects people — everything outside the managed
 * entry survives, and a file we cannot parse is never written at all.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpLocation } from '../../src/adapters/capability-table.js';
import {
  hashEntry,
  listMcpEntries,
  readMcpEntry,
  removeMcpEntry,
  writeMcpEntry,
} from '../../src/adapters/mcp.js';

let root: string;
const noBackup = (): void => {};

const CODEX_CONFIG = readFileSync(
  new URL('../fixtures/codex-config.toml', import.meta.url),
  'utf8',
);

const CURSOR_CONFIG = `{
  // servers my team shares — this comment must survive
  "mcpServers": {
    "existing": { "command": "node", "args": ["server.js"] }
  }
}
`;

beforeEach(() => {
  root = join(tmpdir(), `agent-sync-mcp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const tomlLocation = (): McpLocation => {
  const path = join(root, 'config.toml');
  writeFileSync(path, CODEX_CONFIG);
  return { path, format: 'toml', container: ['mcp_servers'], shared: true };
};

const jsonLocation = (contents = CURSOR_CONFIG): McpLocation => {
  const path = join(root, 'mcp.json');
  writeFileSync(path, contents);
  return { path, format: 'jsonc', container: ['mcpServers'], shared: false };
};

const SERVER = { type: 'stdio', command: 'npx', args: ['-y', 'server'], env: { TOKEN: 'x' } };

describe('editing a Codex config', () => {
  it('adds a server without disturbing anything else', () => {
    const location = tomlLocation();
    expect(writeMcpEntry(location, 'github', SERVER, noBackup)).toEqual({ kind: 'written' });

    const after = readFileSync(location.path, 'utf8');
    expect(after.startsWith(CODEX_CONFIG.replace(/\n+$/, ''))).toBe(true);
    expect(after).toContain('# Codex configuration — hand written');
    expect(after).toContain('[mcp_servers.github]');
  });

  it('leaves unrelated servers and their value types alone', () => {
    const location = tomlLocation();
    writeMcpEntry(location, 'github', SERVER, noBackup);

    const document = parseToml(readFileSync(location.path, 'utf8')) as {
      mcp_servers: { node_repl: { startup_timeout_sec: number; args: string[] } };
    };
    expect(document.mcp_servers.node_repl.startup_timeout_sec).toBe(120);
    expect(document.mcp_servers.node_repl.args).toEqual(['mcp']);
  });

  it('replaces rather than duplicating on a second write', () => {
    const location = tomlLocation();
    writeMcpEntry(location, 'github', SERVER, noBackup);
    writeMcpEntry(location, 'github', { ...SERVER, command: 'bunx' }, noBackup);

    const after = readFileSync(location.path, 'utf8');
    expect(after.match(/\[mcp_servers\.github\]/g)).toHaveLength(1);
    expect(after).toContain('command = "bunx"');
  });

  it('restores the original file when the server is removed', () => {
    const location = tomlLocation();
    writeMcpEntry(location, 'github', SERVER, noBackup);
    removeMcpEntry(location, 'github', noBackup);
    expect(readFileSync(location.path, 'utf8')).toBe(CODEX_CONFIG);
  });

  it('refuses to write a file it cannot parse', () => {
    const location = tomlLocation();
    writeFileSync(location.path, 'this = = broken\n');
    const outcome = writeMcpEntry(location, 'github', SERVER, noBackup);

    expect(outcome.kind).toBe('refused');
    expect(outcome.kind === 'refused' && outcome.message).toContain('refusing to write');
    // The damaged file is left exactly as it was, for the user to fix.
    expect(readFileSync(location.path, 'utf8')).toBe('this = = broken\n');
  });

  it('backs up before the first edit', () => {
    const location = tomlLocation();
    const backedUp: string[] = [];
    writeMcpEntry(location, 'github', SERVER, (path) => backedUp.push(path));
    expect(backedUp).toEqual([location.path]);
  });

  it('creates a config that does not exist yet', () => {
    const location: McpLocation = {
      path: join(root, 'new', 'config.toml'),
      format: 'toml',
      container: ['mcp_servers'],
      shared: true,
    };
    expect(writeMcpEntry(location, 'github', SERVER, noBackup)).toEqual({ kind: 'written' });
    expect(readFileSync(location.path, 'utf8')).toContain('[mcp_servers.github]');
  });
});

describe('editing a JSON config', () => {
  it('adds a server while preserving comments and existing entries', () => {
    const location = jsonLocation();
    expect(writeMcpEntry(location, 'github', SERVER, noBackup)).toEqual({ kind: 'written' });

    const after = readFileSync(location.path, 'utf8');
    expect(after).toContain('// servers my team shares');
    expect(after).toContain('"existing"');
    expect(after).toContain('"github"');
  });

  it('removes only the managed entry', () => {
    const location = jsonLocation();
    writeMcpEntry(location, 'github', SERVER, noBackup);
    removeMcpEntry(location, 'github', noBackup);

    const after = readFileSync(location.path, 'utf8');
    expect(after).not.toContain('"github"');
    expect(after).toContain('"existing"');
    expect(after).toContain('// servers my team shares');
  });

  it('refuses invalid JSON rather than replacing it', () => {
    const location = jsonLocation('{ this is not json');
    const outcome = writeMcpEntry(location, 'github', SERVER, noBackup);
    expect(outcome.kind).toBe('refused');
    expect(readFileSync(location.path, 'utf8')).toBe('{ this is not json');
  });

  it('writes into a nested container, leaving sibling state untouched', () => {
    // Shaped like ~/.claude.json: a large file where mcpServers is one key of many.
    const location = jsonLocation('{\n  "numStartups": 42,\n  "projects": {}\n}\n');
    writeMcpEntry(location, 'github', SERVER, noBackup);

    const after = JSON.parse(readFileSync(location.path, 'utf8')) as Record<string, unknown>;
    expect(after.numStartups).toBe(42);
    expect(after.projects).toEqual({});
    expect(after.mcpServers).toHaveProperty('github');
  });
});

describe('reading entries back', () => {
  it('reports absent, present, and unparseable distinctly', () => {
    const location = jsonLocation();
    expect(readMcpEntry(location, 'nope').kind).toBe('absent');
    expect(readMcpEntry(location, 'existing').kind).toBe('present');

    writeFileSync(location.path, '{ broken');
    expect(readMcpEntry(location, 'existing').kind).toBe('unparseable');
  });

  it('re-derives the transport when reading a Codex table', () => {
    const location = tomlLocation();
    const entry = readMcpEntry(location, 'node_repl');
    expect(entry.kind === 'present' && entry.value.type).toBe('stdio');
  });

  it('hashes semantically, so reformatting is not drift', () => {
    expect(hashEntry({ a: 1, b: 2 })).toBe(hashEntry({ b: 2, a: 1 }));
    expect(hashEntry(null)).toBeNull();
  });

  it('lists every declared server, for import', () => {
    expect(Object.keys(listMcpEntries(tomlLocation()))).toContain('node_repl');
    expect(Object.keys(listMcpEntries(jsonLocation()))).toEqual(['existing']);
  });

  it('lists nothing rather than throwing when a config is unreadable', () => {
    const location = jsonLocation('{ broken');
    expect(listMcpEntries(location)).toEqual({});
  });
});
