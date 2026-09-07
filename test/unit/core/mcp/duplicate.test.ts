import { describe, expect, it } from 'vitest';
import { connectionIdentity, duplicatesOf } from '../../../../src/core/mcp/duplicate.js';
import { severityOf } from '../../../../src/core/resolver/resolve.js';

describe('connectionIdentity', () => {
  it.each([
    ['remote server', { type: 'http', url: 'https://example/mcp' }, 'url:https://example/mcp'],
    ['surrounding whitespace', { url: '  https://example/mcp  ' }, 'url:https://example/mcp'],
    ['stdio with args', { command: 'npx', args: ['-y', 'pkg'] }, 'cmd:npx -y pkg'],
    ['stdio without args', { command: 'server' }, 'cmd:server'],
    ['non-string args', { command: 'run', args: [1, true] }, 'cmd:run 1 true'],
  ])('reads %s', (_label, entry, expected) => {
    expect(connectionIdentity(entry)).toBe(expected);
  });

  it.each([
    ['null', null],
    ['a string', 'not an object'],
    ['an array', ['url']],
    ['an empty object', {}],
    ['a blank url', { url: '   ' }],
    ['a blank command', { command: '' }],
  ])('cannot identify %s', (_label, entry) => {
    expect(connectionIdentity(entry)).toBeNull();
  });

  it('ignores the fields that differ between a hand-added entry and ours', () => {
    const ours = { type: 'http', url: 'https://example/mcp' };
    const theirs = { name: 'Docs by Example', url: 'https://example/mcp', headers: {} };
    expect(connectionIdentity(theirs)).toBe(connectionIdentity(ours));
  });
});

describe('duplicatesOf', () => {
  const managed = { type: 'http', url: 'https://docs.example/mcp' };

  it('finds an entry that reaches the same server under another name', () => {
    const entries = {
      'docs-example': managed,
      'Docs by Example': { name: 'Docs by Example', url: 'https://docs.example/mcp' },
    };
    expect(duplicatesOf(managed, 'docs-example', entries)).toEqual(['Docs by Example']);
  });

  it('never reports the managed entry against itself', () => {
    expect(duplicatesOf(managed, 'docs-example', { 'docs-example': managed })).toEqual([]);
  });

  it('leaves a different server alone', () => {
    const entries = {
      'docs-example': managed,
      other: { url: 'https://elsewhere/mcp' },
    };
    expect(duplicatesOf(managed, 'docs-example', entries)).toEqual([]);
  });

  it('matches a stdio server on command and arguments together', () => {
    const stdio = { command: 'npx', args: ['-y', 'server'] };
    const entries = {
      mine: stdio,
      same: { command: 'npx', args: ['-y', 'server'] },
      'different-args': { command: 'npx', args: ['-y', 'other'] },
    };
    expect(duplicatesOf(stdio, 'mine', entries)).toEqual(['same']);
  });

  it('reports several duplicates in a stable order', () => {
    const entries = {
      mine: managed,
      zebra: { url: 'https://docs.example/mcp' },
      alpha: { url: 'https://docs.example/mcp' },
    };
    expect(duplicatesOf(managed, 'mine', entries)).toEqual(['alpha', 'zebra']);
  });

  it('says nothing when the managed entry cannot be identified', () => {
    expect(duplicatesOf({ weird: true }, 'mine', { other: { url: 'https://x/mcp' } })).toEqual([]);
  });
});

describe('how a duplicate is graded', () => {
  it('is information, not a warning — nothing failed and nothing was touched', () => {
    // Exit 2 has to keep meaning "agent-sync could not do what you asked". A server the
    // user configured themselves, left exactly as it was, is not that.
    expect(
      severityOf({
        kind: 'duplicate-server',
        ref: 'mcp/docs',
        agent: 'cursor',
        message: 'cursor already reaches this server as "Docs"',
      }),
    ).toBe('info');
  });
});
