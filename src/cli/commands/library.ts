/**
 * Library commands: `add skill`, `new skill`, `rm`, and `save`.
 *
 * `new` and `save` are the agent-native create flow (docs/09-agent-native.md §4.1):
 * the artifact is scaffolded *in the store*, so it is born synced, and `save` closes
 * the transaction — validate, apply, commit, push — in one command.
 */
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import { apply } from '../../app/apply.js';
import { type Context, describeFailure, loadContext } from '../../app/context.js';
import { type Manifest, parseManifest } from '../../core/manifest/schema.js';
import { ID_PATTERN, parseArtifactRef } from '../../core/model/ids.js';
import { AGENT_IDS, type AgentId } from '../../core/model/types.js';
import { copyTree, ensureDir, readTextFile, removeTree, writeFileAtomic } from '../../shell/fs.js';
import * as git from '../../store/git.js';
import { skillDir } from '../../store/layout.js';
import { EXIT, type ExitCode, emitJson, failure, info, line, success } from '../output.js';

const skillTemplate = (id: string, description: string): string =>
  `---
name: ${id}
description: ${description}
---

# ${id}

Describe when this skill should be used and what the agent should do.

## Steps

1. …
`;

const loadOrFail = (
  storeOverride: string | undefined,
  json: boolean,
  command: string,
): Context | null => {
  const loaded = loadContext(storeOverride);
  if (loaded.ok) return loaded.value;
  if (json) emitJson(command, false, { error: describeFailure(loaded.failure) });
  else failure(describeFailure(loaded.failure));
  return null;
};

const writeManifest = (context: Context, manifest: Manifest): void => {
  writeFileAtomic(context.layout.manifest, stringify(manifest));
};

/** Register an artifact in the manifest, preserving everything already there. */
const registerSkill = (
  context: Context,
  id: string,
  targets: readonly AgentId[] | undefined,
  scope: 'global' | 'project' | undefined,
): Manifest => {
  const raw = parse(readTextFile(context.layout.manifest) ?? 'version: 1') as Manifest;
  return {
    ...raw,
    artifacts: {
      ...raw.artifacts,
      skill: {
        ...raw.artifacts?.skill,
        [id]: {
          ...(targets === undefined ? {} : { targets: [...targets] }),
          // `project` means "only ever deployed where a project includes it" — no
          // global copy in the agents' home directories.
          ...(scope === 'project' ? { scope: 'project' as const } : {}),
        },
      },
    },
  };
};

const validTargets = (values: readonly string[] | undefined): readonly AgentId[] | undefined => {
  if (values === undefined || values.length === 0) return undefined;
  return values.filter((v): v is AgentId => (AGENT_IDS as readonly string[]).includes(v));
};

export interface AddSkillOptions {
  readonly path: string;
  readonly id?: string;
  readonly targets?: readonly string[];
  readonly scope?: 'global' | 'project';
  readonly storeOverride?: string;
  readonly json: boolean;
}

export const runAddSkill = (options: AddSkillOptions): ExitCode => {
  const context = loadOrFail(options.storeOverride, options.json, 'add');
  if (context === null) return EXIT.error;

  const source = resolve(options.path);
  if (!existsSync(source)) {
    failure(`no such directory: ${source}`);
    return EXIT.error;
  }
  if (!existsSync(`${source}/SKILL.md`)) {
    failure(`${source} has no SKILL.md — a skill is a directory containing one`);
    return EXIT.error;
  }

  const id = options.id ?? basename(source);
  if (!ID_PATTERN.test(id)) {
    failure(`"${id}" is not a valid id — use lowercase kebab-case, or pass --id`);
    return EXIT.error;
  }

  copyTree(source, skillDir(context.layout, id));
  writeManifest(context, registerSkill(context, id, validTargets(options.targets), options.scope));

  if (options.json) {
    emitJson('add', true, { ref: `skill/${id}`, store: skillDir(context.layout, id) });
    return EXIT.ok;
  }
  success(`added skill/${id} to the library`);
  info('next: agent-sync apply');
  return EXIT.ok;
};

export interface NewSkillOptions {
  readonly id: string;
  readonly description?: string;
  readonly targets?: readonly string[];
  readonly scope?: 'global' | 'project';
  readonly storeOverride?: string;
  readonly json: boolean;
}

export const runNewSkill = (options: NewSkillOptions): ExitCode => {
  const context = loadOrFail(options.storeOverride, options.json, 'new');
  if (context === null) return EXIT.error;

  if (!ID_PATTERN.test(options.id)) {
    failure(`"${options.id}" is not a valid id — use lowercase kebab-case`);
    return EXIT.error;
  }

  const directory = skillDir(context.layout, options.id);
  if (existsSync(directory)) {
    failure(`skill/${options.id} already exists at ${directory}`);
    return EXIT.error;
  }

  ensureDir(directory);
  const file = `${directory}/SKILL.md`;
  writeFileAtomic(
    file,
    skillTemplate(options.id, options.description ?? 'Describe when this skill applies.'),
  );
  writeManifest(
    context,
    registerSkill(context, options.id, validTargets(options.targets), options.scope),
  );

  if (options.json) {
    emitJson('new', true, { ref: `skill/${options.id}`, path: file, directory });
    return EXIT.ok;
  }
  success(`scaffolded skill/${options.id}`);
  line(`  ${file}`);
  info('edit it, then run: agent-sync save');
  return EXIT.ok;
};

export interface RemoveOptions {
  readonly ref: string;
  readonly storeOverride?: string;
  readonly json: boolean;
}

export const runRemove = (options: RemoveOptions): ExitCode => {
  const context = loadOrFail(options.storeOverride, options.json, 'rm');
  if (context === null) return EXIT.error;

  const parsed = parseArtifactRef(options.ref);
  if (!parsed.ok) {
    failure(`cannot understand "${options.ref}"`);
    return EXIT.error;
  }
  const id = parsed.value.id;

  const raw = parse(readTextFile(context.layout.manifest) ?? 'version: 1') as Manifest;
  const skills = { ...raw.artifacts?.skill };
  if (skills[id] === undefined) {
    failure(`skill/${id} is not in the library`);
    return EXIT.error;
  }
  delete skills[id];
  writeManifest(context, { ...raw, artifacts: { ...raw.artifacts, skill: skills } });
  removeTree(skillDir(context.layout, id));

  // Deployed copies are cleaned up by the planner as orphans on the next apply.
  const reloaded = loadContext(options.storeOverride);
  if (reloaded.ok) apply(reloaded.value, { dryRun: false, answer: 'ask' });

  if (options.json) {
    emitJson('rm', true, { ref: `skill/${id}` });
    return EXIT.ok;
  }
  success(`removed skill/${id} from the library and from every agent it was deployed to`);
  return EXIT.ok;
};

export interface SaveOptions {
  readonly message?: string;
  readonly storeOverride?: string;
  readonly json: boolean;
  readonly push: boolean;
}

/**
 * The transaction-closer: validate, apply, commit, and push. One command so an agent
 * cannot leave the library half-finished.
 */
export const runSave = (options: SaveOptions): ExitCode => {
  const context = loadOrFail(options.storeOverride, options.json, 'save');
  if (context === null) return EXIT.error;

  const manifestText = readTextFile(context.layout.manifest);
  const validation = parseManifest(parse(manifestText ?? ''));
  if (!validation.ok) {
    const detail = validation.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n');
    if (options.json)
      emitJson('save', false, { error: 'invalid manifest', issues: validation.issues });
    else failure(`the manifest is not valid, so nothing was saved:\n${detail}`);
    return EXIT.error;
  }

  const result = apply(context, { dryRun: false, answer: 'ask' });
  const committed = git.commitAll(context.layout.store, options.message ?? 'chore: update library');
  const pushed = options.push && committed ? git.push(context.layout.store).ok : false;

  if (options.json) {
    emitJson('save', true, {
      written: result.written,
      removed: result.removed,
      unresolved: result.unresolved,
      committed,
      pushed,
      pushPending: committed && options.push && !pushed,
    });
    return result.unresolved.length > 0 ? EXIT.needsDecision : EXIT.ok;
  }

  for (const item of result.written) success(`deployed ${item}`);
  if (committed) success('committed to the library');
  else info('nothing to commit');

  if (options.push && committed) {
    if (pushed) success('pushed to the remote');
    // Offline is normal and not an error: the next sync or heartbeat retries.
    else info('could not push (offline?) — applied locally, push still pending');
  }
  return result.unresolved.length > 0 ? EXIT.needsDecision : EXIT.ok;
};
