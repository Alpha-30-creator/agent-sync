/**
 * Per-device secret storage.
 *
 * Secrets never enter the canonical store, never reach git, and never appear in the
 * lockfile: the library holds `${secret:name}` references, and the value is supplied
 * here, on the machine that needs it (docs/03-architecture.md §11).
 */
import { chmodSync, existsSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import { readTextFile, writeFileAtomic } from './fs.js';

export type Secrets = Readonly<Record<string, string>>;

const HEADER = `# agent-sync secrets — this device only.
# Never committed, never synced. Referenced from the library as \${secret:<name>}.
`;

export const loadSecrets = (path: string): Secrets => {
  const text = readTextFile(path);
  if (text === null) return {};
  try {
    const parsed = parse(text) as Record<string, unknown> | null;
    if (parsed === null || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
};

export const saveSecrets = (path: string, secrets: Secrets): void => {
  const sorted = Object.fromEntries(Object.entries(secrets).sort(([a], [b]) => a.localeCompare(b)));
  writeFileAtomic(path, `${HEADER}${stringify(sorted)}`);
  // Best effort: on Windows this is a no-op, and the file still never leaves the machine.
  try {
    chmodSync(path, 0o600);
  } catch {
    /* ignore */
  }
};

export const setSecret = (path: string, name: string, value: string): void => {
  saveSecrets(path, { ...loadSecrets(path), [name]: value });
};

export const removeSecret = (path: string, name: string): void => {
  const secrets = { ...loadSecrets(path) };
  delete secrets[name];
  saveSecrets(path, secrets);
};

/** Names only — values are never listed, logged, or printed. */
export const secretNames = (path: string): readonly string[] =>
  Object.keys(loadSecrets(path)).sort();

export const secretsFileExists = (path: string): boolean => existsSync(path);
