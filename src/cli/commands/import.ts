/**
 * `import` — adopt what is already on this machine.
 *
 * Nobody starts from an empty library, so this is the command that makes agent-sync
 * usable on day one: it scans every agent for skills and MCP servers that are not yet
 * managed, and copies them into the library.
 *
 * Deliberately conservative: it never removes or rewrites what it finds, it treats
 * credential-looking values as secrets to keep out of git, and by default it reports
 * rather than adopts, so you see the list before anything is written.
 */
import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { CAPABILITIES, type McpLocation } from '../../adapters/capability-table.js';
import { hashEntry, listMcpEntries, readMcpEntry } from '../../adapters/mcp.js';
import { describeFailure, loadContext } from '../../app/context.js';
import { mcpSourcePath } from '../../app/mcp.js';
import type { Manifest } from '../../core/manifest/schema.js';
import { adoptMcpEntry } from '../../core/mcp/adopt.js';
import { ID_PATTERN } from '../../core/model/ids.js';
import { AGENT_IDS, type AgentId } from '../../core/model/types.js';
import { copyTree, readTextFile, writeFileAtomic } from '../../shell/fs.js';
import { setSecret } from '../../shell/secrets.js';
import { skillDir } from '../../store/layout.js';
import { type Lockfile, record, saveLockfile } from '../../store/lockfile.js';
import { findMarker, linkedProjects } from '../../store/project.js';
import { EXIT, type ExitCode, emitJson, failure, info, line, success, warn } from '../output.js';

export interface ImportCandidate {
  readonly type: 'skill' | 'mcp';
  readonly id: string;
  readonly agent: AgentId;
  readonly source: string;
  /** The name the agent uses, when it differs from the library id (see `--as`). */
  readonly originalId?: string;
  /** Project this was found in, when it was not in the agent's global directory. */
  readonly project?: string;
  readonly notes: readonly string[];
  /**
   * True when the artifact looks tied to this machine — an absolute path in its
   * configuration, for instance. Such things are listed but not adopted by default,
   * because copying them to another computer produces configuration that cannot work.
   */
  readonly machineSpecific: boolean;
}

export interface ImportOptions {
  readonly adopt: boolean;
  readonly agents?: readonly string[];
  /** Adopt only these references, e.g. `mcp/github`. */
  readonly only?: readonly string[];
  /** Rename on the way in: `original=new-id`, for names that cannot be ids. */
  readonly as?: readonly string[];
  /** Adopt machine-specific candidates too. */
  readonly includeMachineSpecific: boolean;
  readonly storeOverride?: string;
  readonly json: boolean;
}

const ABSOLUTE_PATH = /(^|["\s=])(\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\)/;

/**
 * Reasons a server should not be copied to another computer.
 *
 * Two of these are about *faithfulness* rather than portability: a relative command
 * only resolves against a working directory, and `cwd` is a field the canonical schema
 * does not carry — so adopting such a server would produce a definition that cannot
 * run. Codex's bundled `computer-use` is exactly this shape. Better to leave it alone
 * and say why than to deploy something broken.
 *
 * These are hints, not certainties, which is why import reports before it adopts.
 */
const machineSpecificReasons = (entry: Readonly<Record<string, unknown>>): readonly string[] => {
  const reasons: string[] = [];
  const command = typeof entry.command === 'string' ? entry.command : '';

  if (JSON.stringify(entry).match(ABSOLUTE_PATH) !== null) {
    reasons.push('contains an absolute path, so it is tied to this machine');
  }
  if (/^\.{1,2}[\\/]/.test(command)) {
    reasons.push('its command is a relative path, which only resolves on this machine');
  }
  if (typeof entry.cwd === 'string') {
    reasons.push('it needs a working directory, which a portable definition cannot carry');
  }
  if (entry.enabled === false) {
    reasons.push('it is switched off here, and adopting it would turn it on elsewhere');
  }

  return reasons;
};

/**
 * Parse `--as original=new-id` pairs.
 *
 * Agents name MCP servers freely — `Docs by LangChain` is a perfectly ordinary name —
 * but a library id has to be filesystem-safe and case-stable. Rather than rename
 * silently, agent-sync asks you to choose.
 */
const parseRenames = (
  values: readonly string[] | undefined,
): { ok: true; value: Map<string, string> } | { ok: false; message: string } => {
  const map = new Map<string, string>();
  for (const value of values ?? []) {
    const equals = value.lastIndexOf('=');
    if (equals <= 0) {
      return { ok: false, message: `--as expects "original=new-id", not "${value}"` };
    }
    const original = value.slice(0, equals).trim();
    const renamed = value.slice(equals + 1).trim();
    if (!ID_PATTERN.test(renamed)) {
      return {
        ok: false,
        message: `"${renamed}" is not a valid id — lowercase letters, digits, - and _ only`,
      };
    }
    map.set(original, renamed);
  }
  return { ok: true, value: map };
};

export const runImport = (options: ImportOptions): ExitCode => {
  const loaded = loadContext(options.storeOverride);
  if (!loaded.ok) {
    if (options.json) emitJson('import', false, { error: describeFailure(loaded.failure) });
    else failure(describeFailure(loaded.failure));
    return EXIT.error;
  }
  const context = loaded.value;

  const wanted = (options.agents ?? []).filter((a): a is AgentId =>
    (AGENT_IDS as readonly string[]).includes(a),
  );
  const agents = wanted.length > 0 ? wanted : context.device.agents;

  const manifest = (parse(readTextFile(context.layout.manifest) ?? 'version: 1') as Manifest) ?? {
    version: 1,
  };
  const knownSkills = new Set(Object.keys(manifest.artifacts?.skill ?? {}));
  const knownMcp = new Set(Object.keys(manifest.artifacts?.mcp ?? {}));

  const renames = parseRenames(options.as);
  if (!renames.ok) {
    if (options.json) emitJson('import', false, { error: renames.message });
    else failure(renames.message);
    return EXIT.error;
  }
  const renameOf = (id: string): string => renames.value.get(id) ?? id;

  const candidates: ImportCandidate[] = [];
  const secretsToStore: Record<string, string> = {};
  const definitions = new Map<string, unknown>();

  /**
   * Scan one skills directory. Entries beginning with a dot are the agent's own:
   * Codex keeps its bundled skills in `.system`, and Claude keeps plugin-provided
   * skills in a separate tree entirely. Neither is yours to sync.
   */
  const scanSkills = (
    agent: AgentId,
    root: string | null,
    project: string | undefined,
    unlinkedProject = false,
  ): void => {
    if (root === null || !existsSync(root)) return;

    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const found = entry.name;
      const id = renameOf(found);
      if (found.startsWith('.') || knownSkills.has(id)) continue;
      if (!existsSync(join(root, found, 'SKILL.md'))) continue;
      if (candidates.some((c) => c.type === 'skill' && c.id === id && c.project === project))
        continue;

      const notes: string[] = [];
      // Third-party tooling symlinks skills between agents; adopting the *content* is
      // fine, but say so — applying afterwards replaces the link with a real folder.
      if (entry.isSymbolicLink()) {
        notes.push(
          'this is a symlink from other tooling — applying will replace it with a real copy',
        );
      }
      if (!ID_PATTERN.test(id)) {
        notes.push(`"${id}" cannot be used as an id (lowercase letters, digits, - and _ only)`);
      }
      if (unlinkedProject) {
        notes.push(
          'found in this directory, which is not a registered project yet — run "agent-sync link" here first, then import again',
        );
      }
      candidates.push({
        type: 'skill',
        id,
        agent,
        source: join(root, found),
        ...(found === id ? {} : { originalId: found }),
        ...(project === undefined ? {} : { project }),
        notes,
        machineSpecific: false,
      });
    }
  };

  // Directories to look in for project-scoped skills: every project this device has
  // linked, plus — importantly — the one you are standing in. Without the latter,
  // `import` could only ever find projects it already knew about, which is useless for
  // the case that matters: a project whose skills are not managed yet.
  const marker = findMarker(process.cwd());
  const here = marker?.dir ?? process.cwd();
  const linked = linkedProjects(context.device, Object.keys(manifest.projects ?? {}));
  const places: { dir: string; project: string | undefined; unlinked: boolean }[] = [
    ...linked.map((project) => ({ dir: project.localPath, project: project.id, unlinked: false })),
  ];
  if (!linked.some((project) => project.localPath === here)) {
    places.push({ dir: here, project: marker?.id, unlinked: true });
  }

  for (const agent of agents) {
    const capabilities = CAPABILITIES[agent];
    scanSkills(agent, capabilities.globalSkillsRoot(context.facts), undefined);

    for (const place of places) {
      scanSkills(
        agent,
        capabilities.projectSkillsRoot(context.facts, place.dir),
        place.project,
        place.unlinked,
      );
    }

    // MCP servers declared in this agent's configuration — globally, and inside each
    // project we are looking at. Project MCP files are where credentials tend to sit in
    // plain text, so leaving them undiscovered would miss the case that matters most.
    const mcpPlaces: {
      location: McpLocation | null;
      project: string | undefined;
      unlinked: boolean;
    }[] = [
      { location: capabilities.globalMcp(context.facts), project: undefined, unlinked: false },
      ...places.map((place) => ({
        location: capabilities.projectMcp(context.facts, place.dir),
        project: place.project,
        unlinked: place.unlinked,
      })),
    ];

    for (const place of mcpPlaces) {
      scanMcp(agent, place.location, place.project, place.unlinked);
    }
  }

  function scanMcp(
    agent: AgentId,
    location: McpLocation | null,
    project: string | undefined,
    unlinkedProject: boolean,
  ): void {
    if (location === null) return;
    for (const [found, entry] of Object.entries(listMcpEntries(location))) {
      const id = renameOf(found);
      if (knownMcp.has(id) || definitions.has(id)) continue;
      if (entry === null || typeof entry !== 'object') continue;

      const adopted = adoptMcpEntry(id, entry as Record<string, unknown>);
      if (adopted.definition === null) {
        candidates.push({
          type: 'mcp',
          id,
          agent,
          source: location.path,
          ...(found === id ? {} : { originalId: found }),
          notes: ['could not be adopted', ...adopted.notes],
          machineSpecific: false,
        });
        continue;
      }

      const notes = [...adopted.notes];
      const reasons = machineSpecificReasons(entry as Record<string, unknown>);
      const machineSpecific = reasons.length > 0;
      notes.push(...reasons.map((reason) => `not adopted by default: ${reason}`));
      if (found !== id) {
        // Adopting under a new name leaves the agent's own entry in place; agent-sync
        // will add a second one rather than rewriting something it does not manage.
        notes.push(
          `adopted as "${id}"; the agent's own "${found}" entry stays where it is — remove it yourself once you are happy`,
        );
      }
      if (unlinkedProject) {
        notes.push(
          'found in this directory, which is not a registered project yet — run "agent-sync link" here first, then import again',
        );
      }
      if (!ID_PATTERN.test(id)) {
        notes.push(
          `"${found}" cannot be used as an id (lowercase letters, digits, - and _ only) — re-run with --as "${found}=some-id"`,
        );
      } else {
        definitions.set(id, adopted.definition);
        Object.assign(secretsToStore, adopted.extractedSecrets);
      }
      candidates.push({
        type: 'mcp',
        id,
        agent,
        source: location.path,
        ...(found === id ? {} : { originalId: found }),
        ...(project === undefined ? {} : { project }),
        notes,
        machineSpecific,
      });
    }
  }

  const only = new Set(options.only ?? []);
  const adoptable = candidates.filter((candidate) => {
    if (candidate.notes.includes('could not be adopted')) return false;
    // Adopting a project skill before the project exists would silently turn it into a
    // global one, which is not what anyone means.
    if (candidate.notes.some((note) => note.includes('not a registered project yet'))) return false;
    if (!ID_PATTERN.test(candidate.id)) return false;
    // An explicit selection means exactly that, machine-specific or not.
    if (only.size > 0) return only.has(`${candidate.type}/${candidate.id}`);
    return options.includeMachineSpecific || !candidate.machineSpecific;
  });

  if (!options.adopt) {
    if (options.json) {
      emitJson('import', true, { candidates, adoptable: adoptable.length, dryRun: true });
      return EXIT.ok;
    }
    if (candidates.length === 0) {
      success('nothing to import — everything on this machine is already in the library');
      return EXIT.ok;
    }
    line(`found ${candidates.length} unmanaged artifact(s):`);
    for (const candidate of candidates) {
      const where =
        candidate.project === undefined
          ? candidate.agent
          : `${candidate.agent} · ${candidate.project}`;
      // A leading dot marks something --adopt will skip, so the list itself shows what
      // will and will not be taken.
      const mark = adoptable.includes(candidate) ? ' ' : '·';
      line(
        `${mark} ${`${candidate.type}/${candidate.id}`.padEnd(30)} ${where}  ${candidate.source}`,
      );
      for (const note of candidate.notes) info(`      ${note}`);
    }
    info(`\nnothing was changed. --adopt takes the ${adoptable.length} unmarked one(s).`);
    if (adoptable.length < candidates.length) {
      info('the ones marked · are skipped — use --only <ref>... to choose exactly what to adopt');
    }
    return EXIT.ok;
  }

  const adoptedRefs: string[] = [];
  let updated: Manifest = manifest;
  // Everything adopted came *from* these agent files, so record them as already
  // deployed. Otherwise the next apply would ask about entries import just took in.
  let lockfile: Lockfile = context.lockfile;

  for (const candidate of adoptable) {
    if (candidate.type === 'skill') {
      copyTree(candidate.source, skillDir(context.layout, candidate.id));

      // A skill found inside a project stays a project skill: it is marked
      // project-scoped and added to that project's include list, rather than quietly
      // becoming a global one deployed into every agent everywhere.
      const scoped = candidate.project !== undefined;
      updated = {
        ...updated,
        artifacts: {
          ...updated.artifacts,
          skill: {
            ...updated.artifacts?.skill,
            [candidate.id]: scoped ? { scope: 'project' as const } : {},
          },
        },
      };

      if (candidate.project !== undefined) {
        const project = updated.projects?.[candidate.project] ?? {};
        const include = new Set([...(project.include ?? []), `skill/${candidate.id}`]);
        updated = {
          ...updated,
          projects: {
            ...updated.projects,
            [candidate.project]: { ...project, include: [...include].sort() },
          },
        };
      }
    } else {
      const definition = definitions.get(candidate.id);
      if (definition === undefined) continue;
      writeFileAtomic(mcpSourcePath(context.layout.mcp, candidate.id), stringify(definition));

      // A server configured inside a project belongs to that project, not to every
      // agent on every machine.
      const scoped = candidate.project !== undefined;
      updated = {
        ...updated,
        artifacts: {
          ...updated.artifacts,
          mcp: {
            ...updated.artifacts?.mcp,
            [candidate.id]: scoped ? { scope: 'project' as const } : {},
          },
        },
      };

      if (candidate.project !== undefined) {
        const project = updated.projects?.[candidate.project] ?? {};
        const include = new Set([...(project.include ?? []), `mcp/${candidate.id}`]);
        updated = {
          ...updated,
          projects: {
            ...updated.projects,
            [candidate.project]: { ...project, include: [...include].sort() },
          },
        };
      }

      const location = CAPABILITIES[candidate.agent].globalMcp(context.facts);
      // Renamed artifacts are not yet deployed under the new id, so there is nothing
      // to record as already-synced.
      const current =
        location === null || candidate.originalId !== undefined
          ? null
          : readMcpEntry(location, candidate.id);
      if (location !== null && current !== null && current.kind === 'present') {
        const hash = hashEntry(current.value) ?? '';
        lockfile = record(lockfile, {
          ref: `mcp/${candidate.id}`,
          agent: candidate.agent,
          path: location.path,
          sourceHash: hash,
          deployedHash: hash,
        });
      }
    }
    adoptedRefs.push(`${candidate.type}/${candidate.id}`);
  }

  for (const [name, value] of Object.entries(secretsToStore)) {
    setSecret(context.layout.secrets, name, value);
  }

  writeFileAtomic(context.layout.manifest, stringify(updated));
  saveLockfile(context.lockfilePath, lockfile);

  if (options.json) {
    emitJson('import', true, {
      adopted: adoptedRefs,
      secretsStored: Object.keys(secretsToStore),
      skipped: candidates.filter((c) => !adoptable.includes(c)).map((c) => `${c.type}/${c.id}`),
    });
    return EXIT.ok;
  }

  for (const ref of adoptedRefs) success(`adopted ${ref}`);
  for (const name of Object.keys(secretsToStore)) {
    info(`  kept a credential on this device as secret "${name}" — it is not in the library`);
  }
  // With an explicit selection, everything else was skipped on purpose; listing it all
  // as a warning would bury the result.
  if (only.size === 0) {
    for (const candidate of candidates.filter((c) => !adoptable.includes(c))) {
      warn(`skipped ${candidate.type}/${candidate.id}: ${candidate.notes.join('; ')}`);
    }
  }
  if (adoptedRefs.length > 0) info('\nnext: agent-sync apply, then agent-sync save');
  return EXIT.ok;
};

/** Exported for tests: the id an imported directory would take. */
export const idForPath = (path: string): string => basename(path);
