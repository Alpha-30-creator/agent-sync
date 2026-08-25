/**
 * Facts about a machine, injected into the pure core so that path logic for every OS
 * is testable from any OS (docs/05-tech-stack.md §4). Never read from the environment
 * inside core — the shell snapshots these and passes them in.
 */
export interface MachineFacts {
  readonly platform: 'darwin' | 'win32' | 'linux';
  /** Absolute home directory, e.g. `/Users/abdur` or `C:\Users\Abdur`. */
  readonly home: string;
}

export const isWindows = (facts: MachineFacts): boolean => facts.platform === 'win32';

export const separator = (facts: MachineFacts): '\\' | '/' => (isWindows(facts) ? '\\' : '/');

/**
 * Join path segments using the *target* machine's separator rather than the host's.
 * Deliberately not `node:path`: resolving a Windows layout while running on macOS is
 * a normal case here (tests, and reasoning about the other device).
 */
export const joinPath = (facts: MachineFacts, ...segments: readonly string[]): string => {
  const sep = separator(facts);
  const parts = segments.filter((s) => s.length > 0).map((s) => s.replace(/[\\/]+$/, ''));
  return parts.join(sep);
};

/** Expand a path template rooted at the machine's home directory. */
export const underHome = (facts: MachineFacts, ...segments: readonly string[]): string =>
  joinPath(facts, facts.home, ...segments);
