/**
 * Loading the world: store, manifest, device file, and lockfile. Everything the
 * pipeline needs, read once (docs/03-architecture.md §5, stage 1).
 */
import { existsSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import {
  type Device,
  type Manifest,
  parseDevice,
  parseManifest,
  type ValidationIssue,
} from '../core/manifest/schema.js';
import type { MachineFacts } from '../core/model/machine.js';
import { ensureDir, readTextFile, writeFileAtomic } from '../shell/fs.js';
import { readMachineFacts } from '../shell/machine.js';
import { layoutFor, lockfileFor, type StoreLayout } from '../store/layout.js';
import { type Lockfile, loadLockfile } from '../store/lockfile.js';

export interface Context {
  readonly facts: MachineFacts;
  readonly layout: StoreLayout;
  readonly manifest: Manifest;
  readonly device: Device;
  readonly lockfile: Lockfile;
  readonly lockfilePath: string;
}

export type LoadFailure =
  | { readonly kind: 'no-store'; readonly path: string }
  | { readonly kind: 'no-device'; readonly path: string }
  | { readonly kind: 'invalid'; readonly path: string; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: 'unreadable'; readonly path: string; readonly message: string };

const readYaml = (
  path: string,
): { ok: true; value: unknown } | { ok: false; failure: LoadFailure } => {
  const text = readTextFile(path);
  if (text === null) return { ok: false, failure: { kind: 'no-store', path } };
  try {
    return { ok: true, value: parse(text) };
  } catch (error) {
    // Refuse rather than guess: a file we cannot parse is never rewritten (NFR-4).
    return {
      ok: false,
      failure: { kind: 'unreadable', path, message: (error as Error).message },
    };
  }
};

export const loadContext = (
  storeOverride?: string,
): { ok: true; value: Context } | { ok: false; failure: LoadFailure } => {
  const facts = readMachineFacts();
  const layout = layoutFor(facts.home, storeOverride);

  if (!existsSync(layout.manifest)) {
    return { ok: false, failure: { kind: 'no-store', path: layout.manifest } };
  }

  const manifestDoc = readYaml(layout.manifest);
  if (!manifestDoc.ok) return manifestDoc;

  const manifest = parseManifest(manifestDoc.value);
  if (!manifest.ok) {
    return {
      ok: false,
      failure: { kind: 'invalid', path: layout.manifest, issues: manifest.issues },
    };
  }

  if (!existsSync(layout.device)) {
    return { ok: false, failure: { kind: 'no-device', path: layout.device } };
  }

  const deviceDoc = readYaml(layout.device);
  if (!deviceDoc.ok) return deviceDoc;

  const device = parseDevice(deviceDoc.value);
  if (!device.ok) {
    return { ok: false, failure: { kind: 'invalid', path: layout.device, issues: device.issues } };
  }

  const lockfilePath = lockfileFor(layout, device.value.device);

  return {
    ok: true,
    value: {
      facts,
      layout,
      manifest: manifest.value,
      device: device.value,
      lockfile: loadLockfile(lockfilePath, device.value.device),
      lockfilePath,
    },
  };
};

export const saveManifest = (layout: StoreLayout, manifest: Manifest): void => {
  writeFileAtomic(layout.manifest, stringify(manifest));
};

export const saveDevice = (layout: StoreLayout, device: Device): void => {
  ensureDir(layout.root);
  writeFileAtomic(layout.device, stringify(device));
};

/** Human-readable rendering of a load failure, with the fix in the message. */
export const describeFailure = (failure: LoadFailure): string => {
  switch (failure.kind) {
    case 'no-store':
      return `no agent-sync store at ${failure.path} — run "agent-sync init" or "agent-sync clone <git-url>"`;
    case 'no-device':
      return `this machine is not registered — run "agent-sync init" (expected ${failure.path})`;
    case 'unreadable':
      return `cannot parse ${failure.path}: ${failure.message}\nrefusing to continue rather than guess at its contents`;
    case 'invalid':
      return [
        `${failure.path} is not valid:`,
        ...failure.issues.map((issue) => `  ${issue.path}: ${issue.message}`),
      ].join('\n');
  }
};
