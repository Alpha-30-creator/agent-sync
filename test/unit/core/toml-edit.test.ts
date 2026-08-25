import { describe, expect, it } from 'vitest';
import {
  belongsTo,
  formatKey,
  hasTable,
  removeTable,
  tableSpans,
  upsertTable,
} from '../../../src/core/formats/toml-edit.js';

// Shaped like a real Codex config: unrelated settings, comments, an array of
// tables, and a server with a subtable.
const SAMPLE = `# Codex config — hand written
model = "gpt-5"  # inline comment
notify = ["a", "b"]

[features]
web_search = true

# my favourite server
[mcp_servers.node_repl]
command = "node"
args = ["mcp"]
startup_timeout_sec = 120

[mcp_servers.node_repl.env]
CODEX_HOME = "/Users/abdur/.codex"

[projects."/Users/abdur/dev"]
trust_level = "trusted"
`;

describe('tableSpans', () => {
  it('finds every table in file order', () => {
    expect(tableSpans(SAMPLE).map((s) => s.name)).toEqual([
      'features',
      'mcp_servers.node_repl',
      'mcp_servers.node_repl.env',
      'projects."/Users/abdur/dev"',
    ]);
  });

  it('ends each span where the next begins, and the last at EOF', () => {
    const spans = tableSpans(SAMPLE);
    const lineCount = SAMPLE.split('\n').length;
    expect(spans[0]?.end).toBe(spans[1]?.start);
    expect(spans.at(-1)?.end).toBe(lineCount);
  });

  it('ignores headers inside comments and returns nothing for a table-free document', () => {
    expect(tableSpans('a = 1\n# [not.a.table]\n')).toEqual([]);
  });
});

describe('belongsTo', () => {
  it.each([
    ['mcp_servers.github', 'mcp_servers.github', true],
    ['mcp_servers.github.env', 'mcp_servers.github', true],
    ['mcp_servers.github-2', 'mcp_servers.github', false],
    ['mcp_servers', 'mcp_servers.github', false],
  ])('%s in %s = %s', (name, root, expected) => {
    expect(belongsTo(name, root)).toBe(expected);
  });
});

describe('removeTable', () => {
  it('removes a table and its subtables, leaving everything else byte-identical', () => {
    const result = removeTable(SAMPLE, 'mcp_servers.node_repl');
    expect(result).not.toContain('node_repl');
    expect(result).toContain('# Codex config — hand written');
    expect(result).toContain('model = "gpt-5"  # inline comment');
    expect(result).toContain('notify = ["a", "b"]');
    expect(result).toContain('[projects."/Users/abdur/dev"]');
    expect(result).toContain('web_search = true');
  });

  it('is a no-op when the table is absent', () => {
    expect(removeTable(SAMPLE, 'mcp_servers.absent')).toBe(SAMPLE);
  });

  it('never removes a table whose name merely shares a prefix', () => {
    const text = '[mcp_servers.gh]\na = 1\n\n[mcp_servers.gh-extra]\nb = 2\n';
    expect(removeTable(text, 'mcp_servers.gh')).toContain('gh-extra');
  });
});

describe('upsertTable', () => {
  const block = '[mcp_servers.probe]\ncommand = "echo"';

  it('appends without disturbing the existing prefix', () => {
    const result = upsertTable(SAMPLE, 'mcp_servers.probe', block);
    expect(result.startsWith(SAMPLE.replace(/\n+$/, ''))).toBe(true);
    expect(result).toContain('[mcp_servers.probe]');
  });

  it('round-trips: upsert then remove restores the original bytes', () => {
    const added = upsertTable(SAMPLE, 'mcp_servers.probe', block);
    expect(removeTable(added, 'mcp_servers.probe')).toBe(SAMPLE);
  });

  it('leaves a document empty when its only table is removed', () => {
    expect(removeTable(upsertTable('', 'mcp_servers.probe', block), 'mcp_servers.probe')).toBe('');
  });

  it('replaces an existing table rather than duplicating it', () => {
    const once = upsertTable(
      SAMPLE,
      'mcp_servers.node_repl',
      '[mcp_servers.node_repl]\ncommand = "deno"',
    );
    expect(once.match(/\[mcp_servers\.node_repl\]/g)).toHaveLength(1);
    expect(once).toContain('command = "deno"');
    // the replaced table's old subtable goes with it
    expect(once).not.toContain('CODEX_HOME');
  });

  it('handles an empty document', () => {
    expect(upsertTable('', 'mcp_servers.probe', block)).toBe(`${block}\n`);
  });

  it('preserves comments through add and remove', () => {
    const added = upsertTable(SAMPLE, 'mcp_servers.probe', block);
    expect(removeTable(added, 'mcp_servers.probe')).toContain('# my favourite server');
  });
});

describe('hasTable', () => {
  it('detects presence via the table or a subtable', () => {
    expect(hasTable(SAMPLE, 'mcp_servers.node_repl')).toBe(true);
    expect(hasTable(SAMPLE, 'mcp_servers.nope')).toBe(false);
  });
});

describe('formatKey', () => {
  it.each([
    ['github', 'github'],
    ['agent-sync-probe', 'agent-sync-probe'],
    ['node_repl', 'node_repl'],
    ['Docs by LangChain', '"Docs by LangChain"'],
    ['with"quote', '"with\\"quote"'],
  ])('%s -> %s', (input, expected) => {
    expect(formatKey(input)).toBe(expected);
  });
});
