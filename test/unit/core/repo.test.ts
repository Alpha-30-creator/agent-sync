import { describe, expect, it } from 'vitest';
import {
  describeRepoNameError,
  parseRepoName,
  type RepoNameError,
  repoSlug,
} from '../../../src/core/model/repo.js';

describe('parseRepoName', () => {
  const accepted: ReadonlyArray<[string, string | null, string]> = [
    ['agent-library', null, 'agent-library'],
    ['  agent-library  ', null, 'agent-library'],
    ['Alpha-30-creator/agent-library', 'Alpha-30-creator', 'agent-library'],
    ['my_library', null, 'my_library'],
    ['dot.in.name', null, 'dot.in.name'],
    ['UPPER', null, 'UPPER'],
    ['a', null, 'a'],
  ];

  it.each(accepted)('accepts %s', (input, owner, name) => {
    const result = parseRepoName(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ owner, name });
  });

  const rejected: ReadonlyArray<[string, RepoNameError['kind']]> = [
    ['', 'empty'],
    ['   ', 'empty'],
    ['owner/', 'empty'],
    ['git@github.com:me/lib.git', 'looks-like-url'],
    ['https://github.com/me/lib', 'looks-like-url'],
    ['me/lib.git', 'looks-like-url'],
    ['one/two/three', 'too-many-segments'],
    ['has space', 'invalid-name'],
    ['bad!chars', 'invalid-name'],
    ['.', 'invalid-name'],
    ['..', 'invalid-name'],
    ['-owner-/lib', 'invalid-owner'],
    [`${'x'.repeat(101)}`, 'too-long'],
  ];

  it.each(rejected)('rejects %s as %s', (input, kind) => {
    const result = parseRepoName(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe(kind);
  });

  it('names the flag that does take a URL', () => {
    const result = parseRepoName('git@github.com:me/lib.git');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(describeRepoNameError(result.error)).toContain('--remote');
  });

  it('explains every rejection without throwing', () => {
    for (const [input] of rejected) {
      const result = parseRepoName(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(describeRepoNameError(result.error).length).toBeGreaterThan(0);
    }
  });
});

describe('repoSlug', () => {
  it('falls back to the authenticated login when no owner is given', () => {
    expect(repoSlug({ owner: null, name: 'lib' }, 'me')).toBe('me/lib');
  });

  it('prefers an explicit owner', () => {
    expect(repoSlug({ owner: 'org', name: 'lib' }, 'me')).toBe('org/lib');
  });
});
