import { describe, expect, it } from 'vitest';
import { adoptMcpEntry } from '../../../../src/core/mcp/adopt.js';

const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

describe('adopting an existing entry into the canonical shape', () => {
  it('adopts a stdio server', () => {
    const result = adoptMcpEntry('github', {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'server-github'],
      env: { LOG_LEVEL: 'debug' },
    });
    expect(result.definition).toEqual({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'server-github'],
      env: { LOG_LEVEL: 'debug' },
    });
    expect(result.extractedSecrets).toEqual({});
  });

  it('adopts a remote server, preserving its transport', () => {
    expect(adoptMcpEntry('linear', { type: 'sse', url: 'https://x/sse' }).definition).toEqual({
      transport: 'sse',
      url: 'https://x/sse',
    });
    expect(adoptMcpEntry('linear', { url: 'https://x/mcp' }).definition).toMatchObject({
      transport: 'http',
    });
  });

  it('infers stdio when the entry has no explicit type, as Codex tables do', () => {
    expect(adoptMcpEntry('repl', { command: 'node' }).definition).toMatchObject({
      transport: 'stdio',
    });
  });
});

describe('keeping credentials out of the library', () => {
  it('replaces a credential-looking value with a reference and hands back the literal', () => {
    const result = adoptMcpEntry('github', {
      command: 'npx',
      env: { GITHUB_TOKEN: TOKEN, LOG_LEVEL: 'debug' },
    });

    expect(result.definition).toMatchObject({
      env: { GITHUB_TOKEN: '${secret:github-github-token}', LOG_LEVEL: 'debug' },
    });
    expect(result.extractedSecrets).toEqual({ 'github-github-token': TOKEN });
    expect(JSON.stringify(result.definition)).not.toContain(TOKEN);
  });

  it('does the same for headers on a remote server', () => {
    const result = adoptMcpEntry('linear', {
      url: 'https://x/mcp',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(Object.keys(result.extractedSecrets)).toEqual(['linear-authorization']);
    expect(result.definition).toMatchObject({
      headers: { Authorization: '${secret:linear-authorization}' },
    });
  });

  it('says what it moved, so the user is not surprised', () => {
    const result = adoptMcpEntry('github', { command: 'npx', env: { GITHUB_TOKEN: TOKEN } });
    expect(result.notes.join()).toContain('looked like a credential');
  });

  it('leaves ordinary values alone', () => {
    const result = adoptMcpEntry('x', { command: 'node', env: { NODE_ENV: 'production' } });
    expect(result.definition).toMatchObject({ env: { NODE_ENV: 'production' } });
    expect(result.extractedSecrets).toEqual({});
  });

  it('builds a usable secret name from an awkward key', () => {
    const result = adoptMcpEntry('my-server', { command: 'node', env: { 'API.KEY_1': TOKEN } });
    expect(Object.keys(result.extractedSecrets)[0]).toBe('my-server-api-key-1');
  });
});

describe('honesty about what could not be adopted', () => {
  it('reports agent-specific fields rather than dropping them silently', () => {
    const result = adoptMcpEntry('x', {
      command: 'node',
      startup_timeout_sec: 30,
      envFile: '.env',
    });
    expect(result.notes.join()).toContain('"startup_timeout_sec" is agent-specific');
    expect(result.notes.join()).toContain('"envFile" is agent-specific');
  });

  it('returns no definition when the entry cannot be understood', () => {
    // Neither a command nor a url: nothing usable to adopt.
    const result = adoptMcpEntry('broken', { note: 'this is not a server' });
    expect(result.definition).toBeNull();
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('still returns extracted secrets when adoption fails, so nothing is lost', () => {
    const result = adoptMcpEntry('broken', { env: { API_KEY: TOKEN } });
    expect(result.definition).toBeNull();
    expect(Object.keys(result.extractedSecrets)).toHaveLength(1);
  });

  it('ignores non-string values rather than coercing them', () => {
    const result = adoptMcpEntry('x', { command: 'node', args: ['a', 42, 'b'], env: { A: 1 } });
    expect(result.definition).toMatchObject({ args: ['a', 'b'] });
    expect(result.definition?.env).toBeUndefined();
  });
});

describe('remote servers without optional maps', () => {
  it('adopts a bare url with neither headers nor env', () => {
    const result = adoptMcpEntry('plain', { url: 'https://x/mcp' });
    expect(result.definition).toEqual({ transport: 'http', url: 'https://x/mcp' });
  });

  it('adopts a remote server that also carries env values', () => {
    const result = adoptMcpEntry('remote', { url: 'https://x/mcp', env: { REGION: 'eu' } });
    expect(result.definition).toMatchObject({ env: { REGION: 'eu' } });
  });
});
