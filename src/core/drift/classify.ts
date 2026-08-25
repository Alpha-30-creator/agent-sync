/**
 * Three-way comparison between the store, the lockfile, and what is actually on disk
 * (docs/03-architecture.md §6). This is what turns "never destroy user work" from an
 * intention into a mechanism: nothing is overwritten until its state is classified.
 *
 * Pure: hashes are computed by the shell and handed in.
 */

/** What the lockfile remembers about one deployed target. */
export interface LockEntry {
  /** Hash of the artifact in the store when we last deployed it. */
  readonly sourceHash: string;
  /** Hash of the bytes we wrote to the target. */
  readonly deployedHash: string;
}

/** What the shell observed for one target path, right now. */
export interface Observation {
  /** Current hash of the artifact in the store. */
  readonly sourceHash: string;
  /** Current hash of the file on disk, or null when it does not exist. */
  readonly targetHash: string | null;
  /** Lockfile entry, or null when we have no record of deploying here. */
  readonly lock: LockEntry | null;
}

export type DriftState =
  /** Target matches what we deployed and the store has not moved. */
  | 'in-sync'
  /** Store changed, target untouched — a normal update. */
  | 'outdated'
  /** Target edited by hand since we wrote it. */
  | 'drifted'
  /** Both the store and the target changed. */
  | 'conflicted'
  /** We deployed here once; the file is gone. */
  | 'missing'
  /** Not in the lockfile, but the content already matches the store. */
  | 'adopted-in-place'
  /** Not in the lockfile, and something different is already there. */
  | 'unmanaged-collision';

/** True when apply may write without asking the user first. */
export const isSafeToWrite = (state: DriftState): boolean =>
  state === 'outdated' || state === 'missing' || state === 'adopted-in-place';

/** True when the state needs a human decision (exit code 3 in non-interactive runs). */
export const needsDecision = (state: DriftState): boolean =>
  state === 'drifted' || state === 'conflicted' || state === 'unmanaged-collision';

export const classify = (observation: Observation): DriftState => {
  const { sourceHash, targetHash, lock } = observation;

  if (lock === null) {
    if (targetHash === null) return 'missing';
    return targetHash === sourceHash ? 'adopted-in-place' : 'unmanaged-collision';
  }

  if (targetHash === null) return 'missing';

  const storeMoved = lock.sourceHash !== sourceHash;
  const targetMoved = lock.deployedHash !== targetHash;

  if (storeMoved && targetMoved) return targetHash === sourceHash ? 'in-sync' : 'conflicted';
  if (storeMoved) return 'outdated';
  if (targetMoved) return 'drifted';
  return 'in-sync';
};
