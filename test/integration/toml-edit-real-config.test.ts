import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { removeTable, upsertTable } from '../../src/core/formats/toml-edit.js';

/**
 * The splicer is pure, so the unit tests cover its logic. This suite checks the
 * property that actually protects users: editing a realistic, comment-laden Codex
 * config changes the managed table and *nothing* else — verified both byte-wise and
 * through an independent TOML parser.
 */
const fixture = readFileSync(
  fileURLToPath(new URL('../fixtures/codex-config.toml', import.meta.url)),
  'utf8',
);

const BLOCK = `[mcp_servers.agent-sync-probe]
command = "echo"
args = ["hello"]

[mcp_servers.agent-sync-probe.env]
PROBE_KEY = "placeholder"`;

describe('splicing a realistic codex config', () => {
  const added = upsertTable(fixture, 'mcp_servers.agent-sync-probe', BLOCK);

  it('leaves every pre-existing byte untouched', () => {
    expect(added.startsWith(fixture.replace(/\n+$/, ''))).toBe(true);
  });

  it('produces a document a real TOML parser accepts', () => {
    const parsed = parse(added) as Record<string, Record<string, unknown>>;
    expect(parsed.mcp_servers?.['agent-sync-probe']).toEqual({
      command: 'echo',
      args: ['hello'],
      env: { PROBE_KEY: 'placeholder' },
    });
  });

  it('changes nothing else semantically', () => {
    const before = parse(fixture) as Record<string, Record<string, unknown>>;
    const after = parse(added) as Record<string, Record<string, unknown>>;
    const { 'agent-sync-probe': _added, ...afterServers } = after.mcp_servers ?? {};
    expect(afterServers).toEqual(before.mcp_servers);
    expect(after.plugins).toEqual(before.plugins);
    expect(after.projects).toEqual(before.projects);
    expect(after.windows).toEqual(before.windows);
  });

  it('preserves integer types that a naive re-serializer would widen', () => {
    // Codex's own `codex mcp add` rewrites this as 120.0 (docs/02 §5a).
    const after = parse(added) as { mcp_servers: { node_repl: { startup_timeout_sec: number } } };
    const serialized = added.split('\n').find((l) => l.startsWith('startup_timeout_sec'));
    expect(after.mcp_servers.node_repl.startup_timeout_sec).toBe(120);
    expect(serialized).toBe('startup_timeout_sec = 120');
  });

  it('restores the file exactly when the managed table is removed', () => {
    expect(removeTable(added, 'mcp_servers.agent-sync-probe')).toBe(fixture);
  });

  it('keeps comments intact through a full add/remove cycle', () => {
    const restored = removeTable(added, 'mcp_servers.agent-sync-probe');
    expect(restored).toContain('# Codex configuration — hand written');
    expect(restored).toContain('# The MCP servers below are managed by hand');
  });
});

/**
 * The same config with Windows line endings.
 *
 * A Windows dogfooding run found every real config on that machine was bare LF, so
 * CRLF preservation went unproven there. It cannot be proven with a committed fixture
 * either: `.gitattributes` normalises the whole tree to LF on checkout, so a stored
 * CRLF file would silently arrive as LF on every machine, including Windows CI. The
 * only honest way to test it is to build the CRLF content here — the same approach
 * test/integration/fs.test.ts already takes for hashing.
 */
describe('splicing a config that uses CRLF line endings', () => {
  const crlfFixture = fixture.replace(/\r?\n/g, '\r\n');
  const crlfBlock = BLOCK.replace(/\r?\n/g, '\r\n');
  const added = upsertTable(crlfFixture, 'mcp_servers.agent-sync-probe', crlfBlock);

  it('does not convert any pre-existing line to LF', () => {
    const original = crlfFixture.split('\r\n');
    // Every line that was there before must still be present with its ending intact.
    for (const line of original.filter((l) => l.length > 0)) {
      expect(added).toContain(`${line}\r\n`);
    }
  });

  it('leaves no bare LF behind anywhere in the file', () => {
    expect(added.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('still parses, and the spliced table is correct', () => {
    const parsed = parse(added) as Record<string, Record<string, { command?: string }>>;
    expect(parsed.mcp_servers?.['agent-sync-probe']?.command).toBe('echo');
  });

  it('round-trips back to the original when the table is removed', () => {
    expect(removeTable(added, 'mcp_servers.agent-sync-probe').trimEnd()).toBe(
      crlfFixture.trimEnd(),
    );
  });
});
