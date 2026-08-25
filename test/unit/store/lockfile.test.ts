import { describe, expect, it } from 'vitest';
import {
  emptyLockfile,
  forget,
  type Lockfile,
  type LockRecord,
  liveKey,
  lookup,
  orphansOf,
  record,
} from '../../../src/store/lockfile.js';

const entry = (over: Partial<LockRecord> = {}): LockRecord => ({
  ref: 'skill/db-migrate',
  agent: 'claude',
  path: '/home/u/.claude/skills/db-migrate',
  sourceHash: 'a',
  deployedHash: 'a',
  ...over,
});

const withRecords = (...records: LockRecord[]): Lockfile =>
  records.reduce(record, emptyLockfile('macbook'));

describe('lockfile records', () => {
  it('looks a record up by artifact, agent, and path', () => {
    const lockfile = withRecords(entry());
    expect(
      lookup(lockfile, 'skill/db-migrate', 'claude', '/home/u/.claude/skills/db-migrate'),
    ).toMatchObject({ sourceHash: 'a', deployedHash: 'a' });
  });

  it('returns null for an unknown target', () => {
    expect(lookup(emptyLockfile('macbook'), 'skill/x', 'claude', '/p')).toBeNull();
  });

  it('treats the same artifact in different agents as different records', () => {
    const lockfile = withRecords(
      entry(),
      entry({ agent: 'codex', path: '/home/u/.codex/skills/db-migrate' }),
    );
    expect(lockfile.records).toHaveLength(2);
  });

  it('replaces rather than duplicates when re-recording the same target', () => {
    const lockfile = withRecords(entry(), entry({ sourceHash: 'b', deployedHash: 'b' }));
    expect(lockfile.records).toHaveLength(1);
    expect(lockfile.records[0]?.sourceHash).toBe('b');
  });

  it('keeps records sorted so the file does not churn between runs', () => {
    const forward = withRecords(entry({ ref: 'skill/a' }), entry({ ref: 'skill/b' }));
    const backward = withRecords(entry({ ref: 'skill/b' }), entry({ ref: 'skill/a' }));
    expect(forward.records).toEqual(backward.records);
  });

  it('forgets a target', () => {
    const lockfile = forget(
      withRecords(entry()),
      'skill/db-migrate',
      'claude',
      '/home/u/.claude/skills/db-migrate',
    );
    expect(lockfile.records).toEqual([]);
  });

  it('leaves other records alone when forgetting one', () => {
    const lockfile = forget(
      withRecords(entry(), entry({ ref: 'skill/other', path: '/p/other' })),
      'skill/db-migrate',
      'claude',
      '/home/u/.claude/skills/db-migrate',
    );
    expect(lockfile.records.map((r) => r.ref)).toEqual(['skill/other']);
  });
});

describe('orphans', () => {
  it('finds records the current routing no longer covers', () => {
    const lockfile = withRecords(
      entry(),
      entry({ ref: 'skill/gone', path: '/home/u/.claude/skills/gone' }),
    );
    const live = new Set([
      liveKey('skill/db-migrate', 'claude', '/home/u/.claude/skills/db-migrate'),
    ]);
    expect(orphansOf(lockfile, live).map((r) => r.ref)).toEqual(['skill/gone']);
  });

  it('finds nothing when routing still covers everything', () => {
    const lockfile = withRecords(entry());
    const live = new Set([
      liveKey('skill/db-migrate', 'claude', '/home/u/.claude/skills/db-migrate'),
    ]);
    expect(orphansOf(lockfile, live)).toEqual([]);
  });
});
