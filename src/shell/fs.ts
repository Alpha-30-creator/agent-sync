/**
 * Filesystem effects. Everything here is deliberately dumb: decisions were already
 * made by the pure core (ADR 0004), so these functions only carry them out — and do so
 * safely, because they write into directories the user owns.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

export const sha256 = (content: string | Buffer): string =>
  createHash('sha256').update(content).digest('hex');

export const fileHash = (path: string): string | null =>
  existsSync(path) ? sha256(readFileSync(path)) : null;

/**
 * Hash of a directory tree: every file's relative path and content, in sorted order.
 * Paths are normalised to forward slashes so a skill hashes identically on Windows
 * and macOS — the same artifact must not look "drifted" merely by crossing machines.
 */
export const treeHash = (root: string): string | null => {
  if (!existsSync(root)) return null;
  const hash = createHash('sha256');
  for (const relativePath of listFiles(root)) {
    hash.update(relativePath.split(sep).join('/'));
    hash.update(readFileSync(join(root, relativePath)));
  }
  return hash.digest('hex');
};

/** Every file under `root`, relative to it, sorted for deterministic hashing. */
export const listFiles = (root: string): readonly string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(dir, entry.name);
      // Symlinks are followed for reading but never created (ADR 0003); a symlinked
      // entry planted by other tooling is content we read, not something we own.
      if (entry.isDirectory()) walk(full);
      else out.push(relative(root, full));
    }
  };
  walk(root);
  return out.sort();
};

export const ensureDir = (path: string): void => {
  mkdirSync(path, { recursive: true });
};

/**
 * Write atomically: a temp file in the same directory, then rename. Rename is atomic
 * within a volume on macOS, Windows, and Linux, so a crash mid-write can never leave
 * the user with a half-written config file.
 */
export const writeFileAtomic = (path: string, content: string): void => {
  ensureDir(dirname(path));
  const temp = `${path}.agent-sync-${process.pid}.tmp`;
  try {
    writeFileSync(temp, content, 'utf8');
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
};

/** Copy a directory tree, replacing whatever is at the destination. */
export const copyTree = (from: string, to: string): void => {
  rmSync(to, { recursive: true, force: true });
  for (const relativePath of listFiles(from)) {
    const target = join(to, relativePath);
    ensureDir(dirname(target));
    copyFileSync(join(from, relativePath), target);
  }
};

export const removeTree = (path: string): void => {
  rmSync(path, { recursive: true, force: true });
};

export const isDirectory = (path: string): boolean =>
  existsSync(path) && statSync(path).isDirectory();

export const readTextFile = (path: string): string | null =>
  existsSync(path) ? readFileSync(path, 'utf8') : null;

/**
 * Back up a file before the first edit of a run. Returns the backup path, or null when
 * there was nothing to back up.
 */
export const backupFile = (path: string, backupDir: string, stamp: string): string | null => {
  if (!existsSync(path)) return null;
  ensureDir(backupDir);
  const name = path.split(sep).join('-').replace(/^-+/, '');
  const destination = join(backupDir, `${stamp}-${name}`);
  copyFileSync(path, destination);
  return destination;
};
