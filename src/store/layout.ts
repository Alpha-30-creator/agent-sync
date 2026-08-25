/** Where things live on disk. Pure path conventions; no I/O. */
import { join } from 'node:path';

export interface StoreLayout {
  /** agent-sync's own directory: `~/.agent-sync`. */
  readonly root: string;
  /** The git-backed canonical library. */
  readonly store: string;
  readonly manifest: string;
  readonly skills: string;
  readonly mcp: string;
  readonly plugins: string;
  /** Per-device, never synced. */
  readonly device: string;
  readonly secrets: string;
  readonly lockDir: string;
  readonly backupDir: string;
}

export const layoutFor = (home: string, override?: string): StoreLayout => {
  const root = override ?? join(home, '.agent-sync');
  const store = join(root, 'store');
  return {
    root,
    store,
    manifest: join(store, 'agent-sync.yaml'),
    skills: join(store, 'skills'),
    mcp: join(store, 'mcp'),
    plugins: join(store, 'plugins'),
    device: join(root, 'device.yaml'),
    secrets: join(root, 'secrets.yaml'),
    lockDir: join(root, 'lock'),
    backupDir: join(root, 'backups'),
  };
};

export const lockfileFor = (layout: StoreLayout, deviceId: string): string =>
  join(layout.lockDir, `${deviceId}.lock.yaml`);

/** Directory holding one skill artifact in the store. */
export const skillDir = (layout: StoreLayout, id: string): string => join(layout.skills, id);
