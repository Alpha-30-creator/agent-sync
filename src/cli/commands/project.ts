/**
 * Project commands: `link`, `unlink`, `include`, `exclude`, `route`, `disable`,
 * `enable`. All of them are sugar over manifest and device-file edits, followed by an
 * offer to apply — the CLI never encodes routing logic itself.
 */
import { basename, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import { describeFailure, loadContext } from '../../app/context.js';
import { type Manifest, type ProjectEntry, parseManifest } from '../../core/manifest/schema.js';
import { ID_PATTERN, parseArtifactRef } from '../../core/model/ids.js';
import {
  AGENT_IDS,
  type AgentId,
  ARTIFACT_TYPES,
  type ArtifactType,
} from '../../core/model/types.js';
import { readTextFile, writeFileAtomic } from '../../shell/fs.js';
import {
  findMarker,
  projectRemote,
  registerProject,
  unregisterProject,
  writeMarker,
} from '../../store/project.js';
import { EXIT, type ExitCode, emitJson, failure, info, line, success } from '../output.js';

const load = (storeOverride: string | undefined, json: boolean, command: string) => {
  const loaded = loadContext(storeOverride);
  if (!loaded.ok) {
    if (json) emitJson(command, false, { error: describeFailure(loaded.failure) });
    else failure(describeFailure(loaded.failure));
    return null;
  }
  return loaded.value;
};

const readRawManifest = (path: string): Manifest =>
  (parse(readTextFile(path) ?? 'version: 1') as Manifest) ?? { version: 1 };

const saveManifest = (path: string, manifest: Manifest, json: boolean): boolean => {
  const validated = parseManifest(manifest);
  if (!validated.ok) {
    const detail = validated.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n');
    if (json) emitJson('route', false, { error: 'invalid manifest', issues: validated.issues });
    else failure(`that change would make the manifest invalid, so nothing was written:\n${detail}`);
    return false;
  }
  writeFileAtomic(path, stringify(manifest));
  return true;
};

const projectOf = (manifest: Manifest, id: string): ProjectEntry => manifest.projects?.[id] ?? {};

const withProject = (manifest: Manifest, id: string, entry: ProjectEntry): Manifest => ({
  ...manifest,
  projects: { ...manifest.projects, [id]: entry },
});

export interface LinkOptions {
  readonly id?: string;
  readonly dir: string;
  readonly storeOverride?: string;
  readonly json: boolean;
}

export const runLink = (options: LinkOptions): ExitCode => {
  const context = load(options.storeOverride, options.json, 'link');
  if (context === null) return EXIT.error;

  const dir = resolve(options.dir);
  const id = options.id ?? basename(dir);
  if (!ID_PATTERN.test(id)) {
    failure(`"${id}" is not a valid project id — use lowercase kebab-case, or pass an id`);
    return EXIT.error;
  }

  const raw = readRawManifest(context.layout.manifest);
  const remote = projectRemote(dir);
  const entry: ProjectEntry = {
    ...projectOf(raw, id),
    ...(remote === null ? {} : { remote }),
  };
  if (!saveManifest(context.layout.manifest, withProject(raw, id, entry), options.json)) {
    return EXIT.error;
  }

  const marker = writeMarker(dir, id);
  writeFileAtomic(context.layout.device, stringify(registerProject(context.device, id, dir)));

  if (options.json) {
    emitJson('link', true, { project: id, dir, marker, remote });
    return EXIT.ok;
  }
  success(`linked ${dir} as project "${id}"`);
  line(`  wrote ${marker} — commit it, and other devices will link this project automatically`);
  info('next: agent-sync include skill/<id>');
  return EXIT.ok;
};

export interface UnlinkOptions {
  readonly id?: string;
  readonly dir: string;
  readonly storeOverride?: string;
  readonly json: boolean;
}

export const runUnlink = (options: UnlinkOptions): ExitCode => {
  const context = load(options.storeOverride, options.json, 'unlink');
  if (context === null) return EXIT.error;

  const found = options.id ?? findMarker(options.dir)?.id;
  if (found === undefined) {
    failure('no project marker here — pass the project id explicitly');
    return EXIT.error;
  }

  writeFileAtomic(context.layout.device, stringify(unregisterProject(context.device, found)));
  if (options.json) {
    emitJson('unlink', true, { project: found });
    return EXIT.ok;
  }
  success(`unlinked "${found}" from this device`);
  info('the marker file stays with the repository, so other devices are unaffected');
  return EXIT.ok;
};

const currentProject = (dir: string, explicit: string | undefined): string | null =>
  explicit ?? findMarker(dir)?.id ?? null;

export interface IncludeOptions {
  readonly ref: string;
  readonly project?: string;
  readonly dir: string;
  readonly remove: boolean;
  readonly storeOverride?: string;
  readonly json: boolean;
}

export const runInclude = (options: IncludeOptions): ExitCode => {
  const context = load(options.storeOverride, options.json, 'include');
  if (context === null) return EXIT.error;

  const projectId = currentProject(options.dir, options.project);
  if (projectId === null) {
    failure('not inside a linked project — run "agent-sync link" here, or pass --project');
    return EXIT.error;
  }

  const parsed = parseArtifactRef(options.ref);
  if (!parsed.ok || parsed.value.type === null) {
    failure(`use a full reference like "skill/${options.ref}"`);
    return EXIT.error;
  }
  const reference = `${parsed.value.type}/${parsed.value.id}`;

  const raw = readRawManifest(context.layout.manifest);
  const entry = projectOf(raw, projectId);
  const include = new Set(entry.include ?? []);
  if (options.remove) include.delete(reference);
  else include.add(reference);

  const updated = withProject(raw, projectId, { ...entry, include: [...include].sort() });
  if (!saveManifest(context.layout.manifest, updated, options.json)) return EXIT.error;

  if (options.json) {
    emitJson(options.remove ? 'exclude' : 'include', true, { project: projectId, ref: reference });
    return EXIT.ok;
  }
  success(
    options.remove
      ? `${reference} will no longer deploy into ${projectId}`
      : `${reference} will deploy into ${projectId}`,
  );
  info('next: agent-sync apply');
  return EXIT.ok;
};

export interface RouteOptions {
  readonly ref?: string;
  readonly type?: string;
  readonly project?: string;
  readonly dir: string;
  readonly targets?: readonly string[];
  readonly add?: readonly string[];
  readonly remove?: readonly string[];
  readonly clear: boolean;
  readonly storeOverride?: string;
  readonly json: boolean;
}

const asAgents = (values: readonly string[] | undefined): readonly AgentId[] | null => {
  if (values === undefined) return null;
  const expanded = values.flatMap((value) => (value === 'all' ? [...AGENT_IDS] : [value]));
  const unknown = expanded.filter((value) => !(AGENT_IDS as readonly string[]).includes(value));
  if (unknown.length > 0) return null;
  return expanded as readonly AgentId[];
};

/** Write a routing rule at whichever layer the flags describe. */
export const runRoute = (options: RouteOptions): ExitCode => {
  const context = load(options.storeOverride, options.json, 'route');
  if (context === null) return EXIT.error;

  const targets = asAgents(options.targets);
  const add = asAgents(options.add);
  const remove = asAgents(options.remove);
  if (
    (options.targets !== undefined && targets === null) ||
    (options.add !== undefined && add === null) ||
    (options.remove !== undefined && remove === null)
  ) {
    failure(`unknown agent — known agents: ${AGENT_IDS.join(', ')}`);
    return EXIT.error;
  }

  const spec =
    targets !== null
      ? [...targets]
      : add !== null || remove !== null
        ? {
            ...(add === null ? {} : { add: [...add] }),
            ...(remove === null ? {} : { remove: [...remove] }),
          }
        : null;

  if (spec === null && !options.clear) {
    failure('say what to route: --targets, --add, --remove, or --clear');
    return EXIT.error;
  }

  const projectId =
    options.project === undefined && options.ref === undefined && options.type === undefined
      ? null
      : options.project === 'here'
        ? currentProject(options.dir, undefined)
        : (options.project ?? null);

  const raw = readRawManifest(context.layout.manifest);
  let updated: Manifest;
  let where: string;

  if (options.ref !== undefined) {
    const parsed = parseArtifactRef(options.ref);
    if (!parsed.ok || parsed.value.type === null) {
      failure(`use a full reference like "skill/${options.ref}"`);
      return EXIT.error;
    }
    const { type, id } = parsed.value as { type: ArtifactType; id: string };

    if (projectId === null) {
      // Layer 2: per artifact, everywhere.
      const existing = raw.artifacts?.[type]?.[id] ?? {};
      const entry = options.clear
        ? { ...existing, targets: undefined }
        : { ...existing, targets: spec ?? undefined };
      updated = {
        ...raw,
        artifacts: {
          ...raw.artifacts,
          [type]: { ...raw.artifacts?.[type], [id]: stripUndefined(entry) },
        },
      };
      where = `artifacts.${type}.${id}.targets`;
    } else {
      // Layer 1: per artifact, in one project.
      const project = projectOf(raw, projectId);
      const existing = project.artifacts?.[type]?.[id] ?? {};
      const entry = options.clear
        ? { ...existing, targets: undefined }
        : { ...existing, targets: spec ?? undefined };
      updated = withProject(raw, projectId, {
        ...project,
        artifacts: {
          ...project.artifacts,
          [type]: { ...project.artifacts?.[type], [id]: stripUndefined(entry) },
        },
      });
      where = `projects.${projectId}.artifacts.${type}.${id}.targets`;
    }
  } else {
    const type = options.type;
    if (type === undefined || !(ARTIFACT_TYPES as readonly string[]).includes(type)) {
      failure(`--type must be one of: ${ARTIFACT_TYPES.join(', ')}`);
      return EXIT.error;
    }
    const artifactType = type as ArtifactType;

    if (projectId === null) {
      // Layer 4: global default for a type.
      const defaults = { ...raw.defaults };
      if (options.clear) delete defaults[artifactType];
      else defaults[artifactType] = { targets: spec ?? undefined };
      updated = { ...raw, defaults };
      where = `defaults.${artifactType}.targets`;
    } else {
      // Layer 3: default for a type inside one project.
      const project = projectOf(raw, projectId);
      const defaults = { ...project.defaults };
      if (options.clear) delete defaults[artifactType];
      else defaults[artifactType] = { targets: spec ?? undefined };
      updated = withProject(raw, projectId, { ...project, defaults });
      where = `projects.${projectId}.defaults.${artifactType}.targets`;
    }
  }

  if (!saveManifest(context.layout.manifest, updated, options.json)) return EXIT.error;

  if (options.json) {
    emitJson('route', true, { rule: where, cleared: options.clear, spec });
    return EXIT.ok;
  }
  success(options.clear ? `cleared ${where}` : `set ${where}`);
  info('next: agent-sync apply');
  return EXIT.ok;
};

/** Drop keys explicitly set to undefined so they do not serialise as nulls. */
const stripUndefined = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

export interface ToggleOptions {
  readonly ref: string;
  readonly enable: boolean;
  readonly storeOverride?: string;
  readonly json: boolean;
}

/** Per-device mask: subtracts on this machine only, never grants. */
export const runToggle = (options: ToggleOptions): ExitCode => {
  const context = load(options.storeOverride, options.json, options.enable ? 'enable' : 'disable');
  if (context === null) return EXIT.error;

  const parsed = parseArtifactRef(options.ref);
  if (!parsed.ok || parsed.value.type === null) {
    failure(`use a full reference like "mcp/${options.ref}"`);
    return EXIT.error;
  }
  const reference = `${parsed.value.type}/${parsed.value.id}`;

  const disable = new Set(context.device.disable ?? []);
  if (options.enable) disable.delete(reference);
  else disable.add(reference);

  writeFileAtomic(
    context.layout.device,
    stringify({ ...context.device, disable: [...disable].sort() }),
  );

  if (options.json) {
    emitJson(options.enable ? 'enable' : 'disable', true, {
      ref: reference,
      device: context.device.device,
    });
    return EXIT.ok;
  }
  success(
    options.enable
      ? `${reference} is enabled again on "${context.device.device}"`
      : `${reference} is disabled on "${context.device.device}" only`,
  );
  return EXIT.ok;
};
