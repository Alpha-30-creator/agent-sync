import { describe, expect, it } from 'vitest';
import { editDistance, suggest } from '../../../src/core/text/suggest.js';

describe('editDistance', () => {
  it.each([
    ['', '', 0],
    ['cursor', 'cursor', 0],
    ['corsur', 'cursor', 2],
    ['claude', '', 6],
    ['', 'codex', 5],
    ['skil', 'skill', 1],
  ])('distance(%s, %s) = %i', (a, b, expected) => {
    expect(editDistance(a, b)).toBe(expected);
  });

  it('is symmetric', () => {
    expect(editDistance('cursor', 'corsur')).toBe(editDistance('corsur', 'cursor'));
  });
});

describe('suggest', () => {
  const agents = ['claude', 'codex', 'cursor'] as const;

  it('suggests a near miss', () => {
    expect(suggest('corsur', agents)).toBe('cursor');
    expect(suggest('claud', agents)).toBe('claude');
  });

  it('is case-insensitive', () => {
    expect(suggest('CURSOR', agents)).toBe('cursor');
  });

  it('returns null when nothing is close enough', () => {
    expect(suggest('windsurf', agents)).toBeNull();
    expect(suggest('', agents)).toBeNull();
  });

  it('applies a tighter threshold to short inputs', () => {
    // 'mcp' vs 'skill'/'plugin' is far; a 3-char input tolerates only one edit.
    expect(suggest('xyz', ['skill', 'plugin'])).toBeNull();
  });

  it('returns null for an empty candidate list', () => {
    expect(suggest('cursor', [])).toBeNull();
  });
});
