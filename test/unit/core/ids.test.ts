import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  formatArtifactRef,
  parseAgentId,
  parseArtifactId,
  parseArtifactRef,
} from '../../../src/core/model/ids.js';
import { ARTIFACT_TYPES } from '../../../src/core/model/types.js';

describe('parseArtifactId', () => {
  it.each(['db-migrate', 'github', 'a', 'agent-sync-create-skill', 'x1-y2'])('accepts %s', (id) => {
    expect(parseArtifactId(id)).toEqual({ ok: true, value: id });
  });

  it.each([
    'MySkill',
    'has space',
    'trailing-',
    '-leading',
    'double--dash',
    'under_score',
    'dot.dot',
  ])('rejects %s', (id) => {
    expect(parseArtifactId(id)).toEqual({
      ok: false,
      error: { kind: 'invalid-format', value: id },
    });
  });

  it('rejects the empty string distinctly', () => {
    expect(parseArtifactId('')).toEqual({ ok: false, error: { kind: 'empty' } });
  });
});

describe('parseArtifactRef', () => {
  it('parses a fully qualified reference', () => {
    expect(parseArtifactRef('skill/db-migrate')).toEqual({
      ok: true,
      value: { type: 'skill', id: 'db-migrate' },
    });
  });

  it('parses a bare id with an unresolved type', () => {
    expect(parseArtifactRef('github')).toEqual({ ok: true, value: { type: null, id: 'github' } });
  });

  it('rejects a bare id with an invalid shape', () => {
    expect(parseArtifactRef('Bad Id')).toEqual({
      ok: false,
      error: { kind: 'invalid-format', value: 'Bad Id' },
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseArtifactRef('  mcp/github  ')).toEqual({
      ok: true,
      value: { type: 'mcp', id: 'github' },
    });
  });

  it('suggests a correction for a near-miss type', () => {
    expect(parseArtifactRef('skil/db-migrate')).toEqual({
      ok: false,
      error: { kind: 'unknown-type', value: 'skil', suggestion: 'skill' },
    });
  });

  it('offers no suggestion when the type is nowhere close', () => {
    expect(parseArtifactRef('wombat/db-migrate')).toEqual({
      ok: false,
      error: { kind: 'unknown-type', value: 'wombat', suggestion: null },
    });
  });

  it.each([
    ['', { kind: 'empty' }],
    ['   ', { kind: 'empty' }],
    ['skill/db migrate', { kind: 'invalid-format', value: 'db migrate' }],
    ['skill/', { kind: 'empty' }],
    ['skill/db/migrate', { kind: 'too-many-segments', value: 'skill/db/migrate' }],
  ])('rejects %s', (input, error) => {
    expect(parseArtifactRef(input)).toEqual({ ok: false, error });
  });
});

describe('formatArtifactRef', () => {
  it('renders both forms', () => {
    expect(formatArtifactRef({ type: 'skill', id: 'db-migrate' })).toBe('skill/db-migrate');
    expect(formatArtifactRef({ type: null, id: 'db-migrate' })).toBe('db-migrate');
  });

  it('round-trips any valid reference (property)', () => {
    const validId = fc
      .array(fc.stringMatching(/^[a-z0-9]+$/), { minLength: 1, maxLength: 4 })
      .map((parts) => parts.join('-'));

    fc.assert(
      fc.property(fc.constantFrom(...ARTIFACT_TYPES), validId, (type, id) => {
        const parsed = parseArtifactRef(formatArtifactRef({ type, id }));
        expect(parsed).toEqual({ ok: true, value: { type, id } });
      }),
    );
  });
});

describe('parseAgentId', () => {
  it.each(['claude', 'codex', 'cursor'])('accepts %s', (agent) => {
    expect(parseAgentId(agent)).toEqual({ ok: true, value: agent });
  });

  it('suggests the intended agent for a typo — the documented "corsur" case', () => {
    expect(parseAgentId('corsur')).toEqual({
      ok: false,
      error: { kind: 'unknown-agent', value: 'corsur', suggestion: 'cursor' },
    });
  });

  it('reports an unrelated agent without a misleading suggestion', () => {
    expect(parseAgentId('windsurf')).toEqual({
      ok: false,
      error: { kind: 'unknown-agent', value: 'windsurf', suggestion: null },
    });
  });
});
