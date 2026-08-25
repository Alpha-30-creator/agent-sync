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
import { CAPABILITIES } from '../../adapters/capability-table.js';
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
import { EXIT, type ExitCode, emitJson, failure, info, line, success, warn } from '../output.js';

export interface ImportCandidate {
  readonly type: 'skill' | 'mcp';
  readonly id: string;
  readonly agent: AgentId;
  readonly source: string;
  readonly notes: readonly string[];
}

export interface ImportOptions {
  readonly adopt: boolean;
  readonly agents?: readonly string[];
  readonly storeOverride?: string;
  readonly json: boolean;
}

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

  const candidates: ImportCandidate[] = [];
  const secretsToStore: Record<string, string> = {};
  const definitions = new Map<string, unknown>();

  for (const agent of agents) {
    const capabilities = CAPABILITIES[agent];

    // Skills: any directory with a SKILL.md that the library does not already have.
    const skillsRoot = capabilities.globalSkillsRoot(context.facts);
    if (skillsRoot !== null && existsSync(skillsRoot)) {
      for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
        const id = entry.name;
        if (id.startsWith('.') || knownSkills.has(id)) continue;
        if (!existsSync(join(skillsRoot, id, 'SKILL.md'))) continue;

        const notes: string[] = [];
        // Third-party tooling symlinks skills between agents; adopting the *content*
        // is fine, but say so, because the original stays where it is.
        if (entry.isSymbolicLink()) notes.push('this entry is a symlink created by other tooling');
        if (!ID_PATTERN.test(id)) {
          notes.push('id is not lowercase kebab-case — rename it before adopting');
        }
        candidates.push({ type: 'skill', id, agent, source: join(skillsRoot, id), notes });
      }
    }

    // MCP servers declared in this agent's own configuration.
    const location = capabilities.globalMcp(context.facts);
    if (location === null) continue;
    for (const [id, entry] of Object.entries(listMcpEntries(location))) {
      if (knownMcp.has(id) || definitions.has(id)) continue;
      if (entry === null || typeof entry !== 'object') continue;

      const adopted = adoptMcpEntry(id, entry as Record<string, unknown>);
      if (adopted.definition === null) {
        candidates.push({
          type: 'mcp',
          id,
          agent,
          source: location.path,
          notes: ['could not be adopted', ...adopted.notes],
        });
        continue;
      }

      const notes = [...adopted.notes];
      if (!ID_PATTERN.test(id)) {
        // The id has to mirror the key inside the agent's own config, so agent-sync
        // cannot quietly rename it. Say what to do instead.
        notes.push(
          `"${id}" cannot be used as an id (lowercase letters, digits, - and _ only) — add it manually with a valid id`,
        );
      } else {
        definitions.set(id, adopted.definition);
        Object.assign(secretsToStore, adopted.extractedSecrets);
      }
      candidates.push({ type: 'mcp', id, agent, source: location.path, notes });
    }
  }

  const adoptable = candidates.filter(
    (candidate) =>
      !candidate.notes.includes('could not be adopted') && ID_PATTERN.test(candidate.id),
  );

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
      line(
        `  ${`${candidate.type}/${candidate.id}`.padEnd(32)} ${candidate.agent}  ${candidate.source}`,
      );
      for (const note of candidate.notes) info(`      ${note}`);
    }
    info('\nnothing was changed. re-run with --adopt to bring these into your library');
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
      updated = {
        ...updated,
        artifacts: {
          ...updated.artifacts,
          skill: { ...updated.artifacts?.skill, [candidate.id]: {} },
        },
      };
    } else {
      const definition = definitions.get(candidate.id);
      if (definition === undefined) continue;
      writeFileAtomic(mcpSourcePath(context.layout.mcp, candidate.id), stringify(definition));
      updated = {
        ...updated,
        artifacts: { ...updated.artifacts, mcp: { ...updated.artifacts?.mcp, [candidate.id]: {} } },
      };

      const location = CAPABILITIES[candidate.agent].globalMcp(context.facts);
      const current = location === null ? null : readMcpEntry(location, candidate.id);
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
  for (const candidate of candidates.filter((c) => !adoptable.includes(c))) {
    warn(`skipped ${candidate.type}/${candidate.id}: ${candidate.notes.join('; ')}`);
  }
  if (adoptedRefs.length > 0) info('\nnext: agent-sync apply, then agent-sync save');
  return EXIT.ok;
};

/** Exported for tests: the id an imported directory would take. */
export const idForPath = (path: string): string => basename(path);
