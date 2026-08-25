/**
 * The deployment lockfile: what we deployed, where, and the hashes at the time
 * (docs/03-architecture.md §3). Per-device and never committed — two machines deploy
 * to different paths, so a shared lockfile would be permanent merge noise.
 *
 * Losing it is safe: the next apply re-derives state, treating an identical unknown
 * file as adopted and a different one as an unmanaged collision to ask about.
 */
import { parse, stringify } from 'yaml';
import type { LockEntry } from '../core/drift/classify.js';
import { readTextFile, writeFileAtomic } from '../shell/fs.js';

export interface LockRecord extends LockEntry {
  readonly ref: string;
  readonly agent: string;
  readonly path: string;
}

export interface Lockfile {
  readonly version: 1;
  readonly device: string;
  readonly records: readonly LockRecord[];
}

export const emptyLockfile = (device: string): Lockfile => ({ version: 1, device, records: [] });

export const loadLockfile = (path: string, device: string): Lockfile => {
  const text = readTextFile(path);
  if (text === null) return emptyLockfile(device);

  try {
    const parsed = parse(text) as Partial<Lockfile> | null;
    if (parsed === null || !Array.isArray(parsed.records)) return emptyLockfile(device);
    return { version: 1, device: parsed.device ?? device, records: parsed.records };
  } catch {
    // A corrupt lockfile is a cache miss, never a hard failure: re-deriving state is
    // conservative by design.
    return emptyLockfile(device);
  }
};

export const saveLockfile = (path: string, lockfile: Lockfile): void => {
  writeFileAtomic(path, stringify(lockfile));
};

/** Identity of a deployment: one artifact, in one agent, at one path. */
export const liveKey = (ref: string, agent: string, path: string): string =>
  `${ref} ${agent} ${path}`;

export const lookup = (
  lockfile: Lockfile,
  ref: string,
  agent: string,
  path: string,
): LockEntry | null =>
  lockfile.records.find((r) => liveKey(r.ref, r.agent, r.path) === liveKey(ref, agent, path)) ??
  null;

/** Replace or insert a record, keyed by (ref, agent, path). */
export const record = (lockfile: Lockfile, entry: LockRecord): Lockfile => ({
  ...lockfile,
  records: [
    ...lockfile.records.filter(
      (r) => liveKey(r.ref, r.agent, r.path) !== liveKey(entry.ref, entry.agent, entry.path),
    ),
    entry,
  ].sort((a, b) => liveKey(a.ref, a.agent, a.path).localeCompare(liveKey(b.ref, b.agent, b.path))),
});

export const forget = (lockfile: Lockfile, ref: string, agent: string, path: string): Lockfile => ({
  ...lockfile,
  records: lockfile.records.filter(
    (r) => liveKey(r.ref, r.agent, r.path) !== liveKey(ref, agent, path),
  ),
});

/** Records the lockfile holds that the current routing no longer covers. */
export const orphansOf = (lockfile: Lockfile, live: ReadonlySet<string>): readonly LockRecord[] =>
  lockfile.records.filter((r) => !live.has(liveKey(r.ref, r.agent, r.path)));
