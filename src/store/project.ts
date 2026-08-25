/**
 * Project identity across devices (docs/04-sync-model.md §3a).
 *
 * A project's identity is never derived from its path — the same project lives at
 * `~/dev/acme` on one machine and `C:\dev\acme` on another. Identity is a stable id in
 * the manifest; each device keeps its own id → path mapping, and a small committed
 * marker file carries the id with the repository so the mapping fills itself in.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import type { Device } from '../core/manifest/schema.js';
import { ID_PATTERN } from '../core/model/ids.js';
import { readTextFile, writeFileAtomic } from '../shell/fs.js';
import { git, normalizeRemote, remoteUrl } from './git.js';

export const MARKER_FILE = '.agent-sync.yaml';

export interface Marker {
  readonly project: string;
}

const MARKER_HEADER = `# agent-sync project marker — safe to commit.
# It carries this project's identity between machines; it contains no paths and no secrets.
`;

/** Walk up from `startDir` looking for a project marker. */
export const findMarker = (startDir: string): { path: string; dir: string; id: string } | null => {
  let current = resolve(startDir);

  for (;;) {
    const candidate = join(current, MARKER_FILE);
    if (existsSync(candidate)) {
      const text = readTextFile(candidate);
      if (text !== null) {
        try {
          const parsed = parse(text) as Partial<Marker> | null;
          const id = parsed?.project;
          if (typeof id === 'string' && ID_PATTERN.test(id)) {
            return { path: candidate, dir: current, id };
          }
        } catch {
          // An unreadable marker is not fatal; doctor reports it.
        }
      }
    }

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

export const writeMarker = (projectDir: string, id: string): string => {
  const path = join(projectDir, MARKER_FILE);
  writeFileAtomic(path, `${MARKER_HEADER}${stringify({ project: id })}`);
  return path;
};

/** Normalised git remote of a directory, used only as a linking *hint*. */
export const projectRemote = (projectDir: string): string | null => {
  if (git(projectDir, ['rev-parse', '--is-inside-work-tree']).output !== 'true') return null;
  const url = remoteUrl(projectDir);
  return url === null ? null : normalizeRemote(url);
};

/** Register (or refresh) this device's path for a project. */
export const registerProject = (device: Device, id: string, localPath: string): Device => ({
  ...device,
  projects: { ...device.projects, [id]: localPath },
});

export const unregisterProject = (device: Device, id: string): Device => {
  const projects = { ...device.projects };
  delete projects[id];
  return { ...device, projects };
};

/**
 * Projects this device can act on: declared in the manifest *and* mapped to a path
 * that still exists here.
 */
export const linkedProjects = (
  device: Device,
  declared: readonly string[],
): readonly { id: string; localPath: string }[] =>
  Object.entries(device.projects ?? {})
    .filter(([id, path]) => declared.includes(id) && existsSync(path))
    .map(([id, localPath]) => ({ id, localPath }))
    .sort((a, b) => a.id.localeCompare(b.id));

/** Device mappings whose directory has disappeared — reported, never auto-pruned. */
export const staleProjects = (device: Device): readonly string[] =>
  Object.entries(device.projects ?? {})
    .filter(([, path]) => !existsSync(path))
    .map(([id]) => id);
