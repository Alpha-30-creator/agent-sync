import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from '../../../../src/adapters/capability-table.js';
import { normalizeTomlEntry, renderTomlBlock } from '../../../../src/core/mcp/render-toml.js';
import {
  looksLikeSecret,
  type McpDefinition,
  parseMcpDefinition,
  parseReference,
  requiredSecrets,
} from '../../../../src/core/mcp/schema.js';
import { stableStringify, translate } from '../../../../src/core/mcp/translate.js';
import type { AgentId } from '../../../../src/core/model/types.js';

const GITHUB: McpDefinition = {
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  env: { GITHUB_TOKEN: '${secret:github-token}' },
};

const run = (
  definition: McpDefinition,
  agent: AgentId,
  secrets: Record<string, string> = { 'github-token': 'ghp_realvalue' },
  env: Record<string, string | undefined> = {},
) =>
  translate({
    id: 'github',
    definition,
    agent,
    support: CAPABILITIES[agent].mcpDialect,
    secrets,
    env,
  });

describe('translating one definition into three dialects', () => {
  it('produces Claude’s shape', () => {
    const result = run(GITHUB, 'claude');
    expect(result.value).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: 'ghp_realvalue' },
    });
    expect(result.warnings).toEqual([]);
  });

  it('produces Cursor’s shape, including its envFile extension', () => {
    const result = run({ ...GITHUB, agents: { cursor: { envFile: '.env.local' } } }, 'cursor');
    expect(result.value).toMatchObject({ type: 'stdio', command: 'npx', envFile: '.env.local' });
  });

  it('produces Codex’s shape with its own tweaks', () => {
    const result = run({ ...GITHUB, agents: { codex: { startup_timeout_sec: 30 } } }, 'codex');
    expect(result.value).toMatchObject({ command: 'npx', startup_timeout_sec: 30 });
  });

  it('translates remote servers', () => {
    const remote: McpDefinition = {
      transport: 'http',
      url: 'https://mcp.linear.app/mcp',
      headers: { Authorization: '${secret:linear}' },
    };
    const result = run(remote, 'claude', { linear: 'Bearer xyz' });
    expect(result.value).toEqual({
      type: 'http',
      url: 'https://mcp.linear.app/mcp',
      headers: { Authorization: 'Bearer xyz' },
    });
  });
});

describe('capability warnings instead of silent loss', () => {
  it('refuses a transport the agent cannot speak, and says so', () => {
    const sse: McpDefinition = { transport: 'sse', url: 'https://example.com/sse' };
    const result = run(sse, 'codex');
    expect(result.value).toBeNull();
    expect(result.warnings[0]?.message).toContain('does not support the "sse" transport');
    expect(result.warnings[0]?.message).toContain('supports: stdio, http');
  });

  it('keeps the same server for agents that do speak it', () => {
    const sse: McpDefinition = { transport: 'sse', url: 'https://example.com/sse' };
    expect(run(sse, 'cursor').value).toMatchObject({ type: 'sse' });
    expect(run(sse, 'claude').value).toMatchObject({ type: 'sse' });
  });

  it('drops an unsupported per-agent tweak with a warning rather than writing it', () => {
    const result = run({ ...GITHUB, agents: { codex: { envFile: '.env' } } }, 'codex');
    expect(result.value).not.toHaveProperty('envFile');
    expect(result.warnings.map((w) => w.message).join()).toContain(
      '"envFile" is not supported by codex',
    );
  });
});

describe('secrets and environment references', () => {
  it('resolves a secret from the device’s own store', () => {
    const result = run(GITHUB, 'claude', { 'github-token': 'ghp_abc' });
    expect(result.value).toMatchObject({ env: { GITHUB_TOKEN: 'ghp_abc' } });
  });

  it('leaves an unresolved secret visible instead of writing a blank', () => {
    const result = run(GITHUB, 'claude', {});
    // A silent empty string would look like a working config; a placeholder does not.
    expect(result.value).toMatchObject({ env: { GITHUB_TOKEN: '${secret:github-token}' } });
    expect(result.warnings[0]?.message).toContain('is not set on this device');
  });

  it('passes environment references through to agents that expand them', () => {
    const definition: McpDefinition = { ...GITHUB, env: { TOKEN: '${env:GITHUB_TOKEN}' } };
    expect(run(definition, 'claude', {}, { GITHUB_TOKEN: 'from-env' }).value).toMatchObject({
      env: { TOKEN: '${GITHUB_TOKEN}' },
    });
  });

  it('resolves environment references for agents that do not expand them', () => {
    const definition: McpDefinition = { ...GITHUB, env: { TOKEN: '${env:GITHUB_TOKEN}' } };
    expect(run(definition, 'codex', {}, { GITHUB_TOKEN: 'from-env' }).value).toMatchObject({
      env: { TOKEN: 'from-env' },
    });
  });

  it('warns when it cannot resolve an environment reference for such an agent', () => {
    const definition: McpDefinition = { ...GITHUB, env: { TOKEN: '${env:MISSING}' } };
    const result = run(definition, 'codex', {}, {});
    expect(result.warnings[0]?.message).toContain('MISSING is not set here');
  });

  it('collects secrets from env and headers together', () => {
    expect(
      requiredSecrets({
        transport: 'http',
        url: 'https://x',
        headers: { Authorization: '${secret:auth}' },
        env: { REGION: '${secret:region}', PLAIN: 'eu' },
      }),
    ).toEqual(['auth', 'region']);
  });

  it('collects secrets from a stdio definition’s env', () => {
    expect(
      requiredSecrets({ transport: 'stdio', command: 'node', env: { T: '${secret:t}' } }),
    ).toEqual(['t']);
  });

  it('needs no secrets when a definition has neither env nor headers', () => {
    expect(requiredSecrets({ transport: 'stdio', command: 'node' })).toEqual([]);
    expect(requiredSecrets({ transport: 'http', url: 'https://x' })).toEqual([]);
  });

  it('carries env through to a remote server that needs it', () => {
    const remote: McpDefinition = {
      transport: 'http',
      url: 'https://x/mcp',
      env: { REGION: 'eu-west' },
    };
    expect(run(remote, 'claude').value).toMatchObject({ env: { REGION: 'eu-west' } });
  });

  it('lists the secrets a definition needs', () => {
    expect(requiredSecrets(GITHUB)).toEqual(['github-token']);
    expect(
      requiredSecrets({
        transport: 'http',
        url: 'x',
        headers: { A: '${secret:b}', B: '${secret:a}' },
      }),
    ).toEqual(['a', 'b']);
  });

  it('parses reference syntax and rejects near-misses', () => {
    expect(parseReference('${secret:github-token}')).toEqual({
      kind: 'secret',
      name: 'github-token',
    });
    expect(parseReference('${env:PATH}')).toEqual({ kind: 'env', name: 'PATH' });
    expect(parseReference('ghp_literal')).toBeNull();
    expect(parseReference('${unknown:x}')).toBeNull();
  });

  it('spots a credential written inline, so it can be warned about before it is committed', () => {
    expect(looksLikeSecret('GITHUB_TOKEN', 'ghp_0123456789abcdef')).toBe(true);
    expect(looksLikeSecret('GITHUB_TOKEN', '${secret:gh}')).toBe(false);
    expect(looksLikeSecret('NODE_ENV', 'production')).toBe(false);
    expect(looksLikeSecret('API_KEY', 'short')).toBe(false);
  });
});

describe('schema validation', () => {
  it('accepts each transport', () => {
    expect(parseMcpDefinition({ transport: 'stdio', command: 'node' }).ok).toBe(true);
    expect(parseMcpDefinition({ transport: 'http', url: 'https://x' }).ok).toBe(true);
    expect(parseMcpDefinition({ transport: 'sse', url: 'https://x' }).ok).toBe(true);
  });

  it('rejects a stdio server with no command, pointing at the field', () => {
    const result = parseMcpDefinition({ transport: 'stdio' });
    if (result.ok) throw new Error('expected failure');
    expect(result.issues[0]?.path).toBe('command');
  });

  it('rejects unknown fields rather than dropping them silently', () => {
    expect(parseMcpDefinition({ transport: 'stdio', command: 'node', comand: 'typo' }).ok).toBe(
      false,
    );
  });

  it('rejects an unknown transport', () => {
    const result = parseMcpDefinition({ transport: 'grpc', url: 'x' });
    expect(result.ok).toBe(false);
  });
});

describe('codex TOML rendering', () => {
  it('renders a server and its env subtable', () => {
    const value = run(GITHUB, 'codex').value as Record<string, unknown>;
    expect(renderTomlBlock('github', value)).toBe(
      [
        '[mcp_servers.github]',
        'command = "npx"',
        'args = ["-y", "@modelcontextprotocol/server-github"]',
        '',
        '[mcp_servers.github.env]',
        'GITHUB_TOKEN = "ghp_realvalue"',
      ].join('\n'),
    );
  });

  it('omits the inferred transport key rather than inventing config', () => {
    expect(renderTomlBlock('github', { type: 'stdio', command: 'node' })).not.toContain('type');
  });

  it('keeps integers narrow, unlike Codex’s own CLI', () => {
    expect(renderTomlBlock('x', { command: 'node', startup_timeout_sec: 120 })).toContain(
      'startup_timeout_sec = 120',
    );
  });

  it('renders booleans and unusual values without breaking the document', () => {
    // `enabled` is a real Codex tweak; the fallback keeps anything odd quoted.
    expect(renderTomlBlock('x', { command: 'node', enabled: true })).toContain('enabled = true');
    expect(renderTomlBlock('x', { command: 'node', odd: null })).toContain('odd = "null"');
  });

  it('quotes keys only when they need it', () => {
    expect(renderTomlBlock('docs by langchain', { url: 'https://x' })).toContain(
      '[mcp_servers."docs by langchain"]',
    );
  });

  it('skips empty subtables', () => {
    expect(renderTomlBlock('x', { command: 'node', env: {} })).not.toContain('.env]');
  });

  it('re-derives the transport when reading a table back', () => {
    expect(normalizeTomlEntry({ command: 'node' })).toMatchObject({ type: 'stdio' });
    expect(normalizeTomlEntry({ url: 'https://x' })).toMatchObject({ type: 'http' });
  });
});

describe('stableStringify', () => {
  it('is independent of key order, so reformatting is not drift', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it('distinguishes genuinely different content', () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  it('renders undefined as null rather than producing an invalid hash input', () => {
    expect(stableStringify(undefined)).toBe('null');
  });

  it('handles nesting, arrays, and primitives', () => {
    expect(stableStringify({ a: [1, { c: 3, b: 2 }], d: null })).toBe(
      '{"a":[1,{"b":2,"c":3}],"d":null}',
    );
    expect(stableStringify('x')).toBe('"x"');
    expect(stableStringify(null)).toBe('null');
  });
});

describe('translation properties', () => {
  const definitionArb = fc.oneof(
    fc.record(
      {
        transport: fc.constant('stdio' as const),
        command: fc.constantFrom('npx', 'node', 'python'),
        args: fc.array(fc.constantFrom('-y', 'server', '--flag'), { maxLength: 3 }),
        env: fc.dictionary(
          fc.constantFrom('TOKEN', 'HOME_DIR'),
          fc.constantFrom('a', '${secret:s}'),
        ),
      },
      { requiredKeys: ['transport', 'command'] },
    ),
    fc.record(
      {
        transport: fc.constantFrom('http' as const, 'sse' as const),
        url: fc.constantFrom('https://a.example/mcp', 'https://b.example/sse'),
      },
      { requiredKeys: ['transport', 'url'] },
    ),
  );

  it('never throws, for any definition and any agent', () => {
    fc.assert(
      fc.property(
        definitionArb,
        fc.constantFrom<AgentId>('claude', 'codex', 'cursor'),
        (definition, agent) => {
          run(definition as McpDefinition, agent);
        },
      ),
    );
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(
        definitionArb,
        fc.constantFrom<AgentId>('claude', 'codex', 'cursor'),
        (definition, agent) => {
          expect(run(definition as McpDefinition, agent)).toEqual(
            run(definition as McpDefinition, agent),
          );
        },
      ),
    );
  });

  it('either produces a value or explains why it did not', () => {
    fc.assert(
      fc.property(
        definitionArb,
        fc.constantFrom<AgentId>('claude', 'codex', 'cursor'),
        (definition, agent) => {
          const result = run(definition as McpDefinition, agent);
          if (result.value === null) expect(result.warnings.length).toBeGreaterThan(0);
        },
      ),
    );
  });

  it('never leaks an unresolved secret reference without warning about it', () => {
    fc.assert(
      fc.property(
        definitionArb,
        fc.constantFrom<AgentId>('claude', 'codex', 'cursor'),
        (definition, agent) => {
          const result = run(definition as McpDefinition, agent, {});
          const serialized = JSON.stringify(result.value ?? {});
          if (serialized.includes('${secret:')) expect(result.warnings.length).toBeGreaterThan(0);
        },
      ),
    );
  });
});
