import { describe, expect, it } from 'vitest';
import {
  classify,
  isSafeToWrite,
  needsDecision,
  type Observation,
} from '../../../src/core/drift/classify.js';

const A = 'hash-a';
const B = 'hash-b';
const C = 'hash-c';

const observe = (o: Partial<Observation>): Observation => ({
  sourceHash: A,
  targetHash: A,
  lock: { sourceHash: A, deployedHash: A },
  ...o,
});

describe('classify — the table from architecture §6', () => {
  it('in-sync: neither side moved', () => {
    expect(classify(observe({}))).toBe('in-sync');
  });

  it('outdated: the store changed, the target did not', () => {
    expect(classify(observe({ sourceHash: B }))).toBe('outdated');
  });

  it('drifted: the target was hand-edited', () => {
    expect(classify(observe({ targetHash: B }))).toBe('drifted');
  });

  it('conflicted: both sides changed, differently', () => {
    expect(classify(observe({ sourceHash: B, targetHash: C }))).toBe('conflicted');
  });

  it('in-sync: both sides changed but landed on the same content', () => {
    expect(classify(observe({ sourceHash: B, targetHash: B }))).toBe('in-sync');
  });

  it('missing: we deployed here, the file is gone', () => {
    expect(classify(observe({ targetHash: null }))).toBe('missing');
  });

  it('missing: no lock entry and nothing on disk', () => {
    expect(classify(observe({ targetHash: null, lock: null }))).toBe('missing');
  });

  it('adopted-in-place: unknown to the lockfile but already identical', () => {
    expect(classify(observe({ lock: null }))).toBe('adopted-in-place');
  });

  it('unmanaged-collision: unknown to the lockfile and different', () => {
    expect(classify(observe({ lock: null, targetHash: B }))).toBe('unmanaged-collision');
  });
});

describe('write safety', () => {
  it('only converging states may be written unattended', () => {
    expect((['outdated', 'missing', 'adopted-in-place'] as const).every(isSafeToWrite)).toBe(true);
    expect(
      (['drifted', 'conflicted', 'unmanaged-collision', 'in-sync'] as const).some(isSafeToWrite),
    ).toBe(false);
  });

  it('states needing a decision are exactly the ones we never write unattended', () => {
    expect((['drifted', 'conflicted', 'unmanaged-collision'] as const).every(needsDecision)).toBe(
      true,
    );
    expect(needsDecision('in-sync')).toBe(false);
    expect(needsDecision('outdated')).toBe(false);
  });

  it('no state is both safe to write and in need of a decision', () => {
    const states = [
      'in-sync',
      'outdated',
      'drifted',
      'conflicted',
      'missing',
      'adopted-in-place',
      'unmanaged-collision',
    ] as const;
    for (const state of states) {
      expect(isSafeToWrite(state) && needsDecision(state)).toBe(false);
    }
  });
});
