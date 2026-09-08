/**
 * `init` — create the canonical store and register this machine.
 * `clone` — the same, starting from an existing store on a git remote.
 */
import { existsSync, readFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import type { Device, Manifest } from '../../core/manifest/schema.js';
import { describeRepoNameError, parseRepoName, repoSlug } from '../../core/model/repo.js';
import type { AgentId } from '../../core/model/types.js';
import { ensureDir, writeFileAtomic } from '../../shell/fs.js';
import * as forge from '../../shell/github.js';
import { detectAgents, readMachineFacts } from '../../shell/machine.js';
import * as git from '../../store/git.js';
import { layoutFor } from '../../store/layout.js';
import { EXIT, type ExitCode, emitJson, failure, info, line, success, warn } from '../output.js';

const STORE_README = `# agent-sync store

This is your canonical library of coding-agent extensions: skills, MCP server
definitions, and plugin declarations, plus the routing rules that decide which agents
get what.

It is a normal git repository and a normal set of files. Everything here is readable
and editable by hand — if agent-sync disappeared tomorrow, your library would still
make sense.

- \`agent-sync.yaml\` — the manifest: artifacts and routing rules
- \`skills/<id>/SKILL.md\` — one directory per skill
- \`mcp/<id>.yaml\` — one canonical MCP server definition per file
- \`plugins/<id>.yaml\` — plugin declarations (marketplace + id)

Machine-specific state (which projects live where, secrets, deployment lockfiles) is
deliberately *not* here: it lives outside the repository so this stays portable.
`;

const GITATTRIBUTES = `# Deployed artifacts are hashed byte-exactly, so line endings must not depend on
# which machine cloned this repository.
* text=auto eol=lf
`;

const starterManifest = (): Manifest => ({ version: 1 });

export interface InitOptions {
  readonly storeOverride?: string;
  readonly remote?: string;
  /** Repository to create and then sync through: `name` or `owner/name`. */
  readonly createRemote?: string;
  readonly visibility: 'private' | 'public';
  readonly deviceName?: string;
  readonly json: boolean;
}

/**
 * Everything `--create-remote` needs before the store is touched.
 *
 * Creating a repository is the one irreversible thing `init` does, and the checks that
 * can fail (no gh, not signed in, a name the forge would reject, a repository that is
 * already there) are all cheap. Running them first means a bad invocation stops before
 * it has written anything at all.
 */
type RemotePlan =
  | { readonly kind: 'none' }
  | { readonly kind: 'existing'; readonly url: string }
  | { readonly kind: 'create'; readonly slug: string };

const planRemote = (options: InitOptions): RemotePlan | { readonly error: string } => {
  if (options.remote !== undefined && options.createRemote !== undefined) {
    return {
      error:
        '--remote and --create-remote contradict each other; pick one\n' +
        '  --remote <git-url>      sync through a repository that already exists\n' +
        '  --create-remote <name>  make the repository first, then sync through it',
    };
  }
  if (options.remote !== undefined) return { kind: 'existing', url: options.remote };
  if (options.createRemote === undefined) return { kind: 'none' };

  const name = parseRepoName(options.createRemote);
  if (!name.ok) return { error: describeRepoNameError(name.error) };

  if (!forge.isGhAvailable()) {
    return {
      error:
        'creating a repository needs the GitHub CLI, which was not found on PATH.\n' +
        '  install it from https://cli.github.com, then run: gh auth login\n' +
        '  or make the repository yourself and pass: agent-sync init --remote <git-url>',
    };
  }

  const login = forge.authenticatedLogin();
  if (!login.ok) return { error: login.message };

  const slug = repoSlug(name.value, login.value);
  if (forge.repoExists(slug)) {
    return {
      error:
        `${slug} already exists on GitHub, so there is nothing to create.\n` +
        '  to sync through it:            agent-sync init --remote <its-git-url>\n' +
        '  to set this machine up from it: agent-sync clone <its-git-url>',
    };
  }

  return { kind: 'create', slug };
};

/**
 * The name this machine already goes by, if it has one.
 *
 * Re-running setup or init without `--device` must not rename the device: the lockfile
 * that records what was deployed here is keyed by that name, so a rename orphans it and
 * agent-sync forgets everything it has written — every deployed file then looks like
 * somebody else's, which is exactly the state drift detection exists to avoid. Only an
 * explicit `--device` changes it.
 */
const existingDeviceName = (path: string): string | null => {
  if (!existsSync(path)) return null;
  try {
    const parsed = parse(readFileSync(path, 'utf8')) as { device?: unknown };
    return typeof parsed.device === 'string' && parsed.device.length > 0 ? parsed.device : null;
  } catch {
    return null;
  }
};

const deviceIdFrom = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'device';

/**
 * What setting up a store on this machine produced.
 *
 * `init`, `clone` and `setup` all do the same underlying work and differ only in how
 * they report it, so the work returns data and the commands render it. Warnings are
 * collected rather than printed for the same reason: `setup` folds them into its own
 * summary instead of interleaving them with a second command's output.
 */
export interface StoreOutcome {
  readonly store: string;
  /** False when a usable store was already here and was left alone. */
  readonly created: boolean;
  readonly device: string;
  readonly agents: readonly AgentId[];
  readonly remote: string | null;
  /** Repository created on the forge by `--create-remote`, if any. */
  readonly repository: string | null;
  readonly published: boolean;
  readonly warnings: readonly string[];
}

export type StoreResult =
  | { readonly ok: true; readonly value: StoreOutcome }
  | { readonly ok: false; readonly message: string };

export const performInit = (options: InitOptions): StoreResult => {
  const facts = readMachineFacts();
  const layout = layoutFor(facts.home, options.storeOverride);

  if (!git.isGitAvailable()) {
    return {
      ok: false,
      message:
        'git was not found on PATH — agent-sync uses it to sync your library between devices',
    };
  }

  const plan = planRemote(options);
  if ('error' in plan) return { ok: false, message: plan.error };

  const warnings: string[] = [];
  const alreadyExists = existsSync(layout.manifest);
  if (!alreadyExists) {
    ensureDir(layout.store);
    ensureDir(layout.skills);
    ensureDir(layout.mcp);
    ensureDir(layout.plugins);
    writeFileAtomic(layout.manifest, stringify(starterManifest()));
    writeFileAtomic(`${layout.store}/README.md`, STORE_README);
    writeFileAtomic(`${layout.store}/.gitattributes`, GITATTRIBUTES);

    if (!git.isRepository(layout.store)) git.init(layout.store);
    const commit = git.commitAll(layout.store, 'chore: initialise agent-sync store');
    if (commit.kind === 'failed') {
      // The store is usable; it simply has nothing committed yet. Say so rather than
      // failing the whole setup.
      warnings.push(commit.message);
    }
  }

  let created: string | null = null;
  let published = false;
  if (plan.kind === 'existing') {
    git.setRemote(layout.store, plan.url);
  } else if (plan.kind === 'create') {
    const repo = forge.createRepo(plan.slug, options.visibility);
    if (!repo.ok) {
      // The library itself is fine — only publishing failed. Say so, so that the user
      // does not think the store needs recreating.
      return {
        ok: false,
        message:
          `could not create ${plan.slug}:\n${repo.message}\n\n` +
          `your library is intact at ${layout.store}; once the repository exists, run:\n` +
          '  agent-sync init --remote <its-git-url>',
      };
    }
    created = plan.slug;
    git.setRemote(layout.store, repo.value);

    const pushed = git.push(layout.store);
    published = pushed.ok;
    if (!pushed.ok) {
      warnings.push(
        `created ${plan.slug} and pointed the library at it, but the first push failed:\n` +
          `${pushed.output}\n  fix the access above, then run: agent-sync sync`,
      );
    }
  }

  const agents = detectAgents(facts);
  const named =
    options.deviceName === undefined
      ? (existingDeviceName(layout.device) ?? `${facts.platform}-device`)
      : options.deviceName;
  const device: Device = { device: deviceIdFrom(named), agents: [...agents] };
  writeFileAtomic(layout.device, stringify(device));

  return {
    ok: true,
    value: {
      store: layout.store,
      created: !alreadyExists,
      device: device.device,
      agents,
      remote: git.remoteUrl(layout.store),
      repository: created,
      published,
      warnings,
    },
  };
};

export const runInit = (options: InitOptions): ExitCode => {
  const result = performInit(options);
  if (!result.ok) {
    if (options.json) emitJson('init', false, { error: result.message });
    else failure(result.message);
    return EXIT.error;
  }

  const outcome = result.value;
  if (options.json) {
    emitJson('init', true, {
      store: outcome.store,
      created: outcome.created,
      device: outcome.device,
      agents: outcome.agents,
      remote: outcome.remote,
      repository: outcome.repository,
      published: outcome.published,
      warnings: outcome.warnings,
    });
    return EXIT.ok;
  }

  for (const message of outcome.warnings) warn(message);
  success(
    outcome.created
      ? `store created at ${outcome.store}`
      : `store already present at ${outcome.store}`,
  );
  if (outcome.repository !== null) {
    success(
      outcome.published
        ? `created ${options.visibility} repository ${outcome.repository} and pushed your library to it`
        : `created ${options.visibility} repository ${outcome.repository}`,
    );
  }
  success(`device registered as "${outcome.device}"`);
  if (outcome.agents.length === 0) {
    line(
      '  no agents detected — install Claude Code, Codex, or Cursor, then run: agent-sync doctor',
    );
  } else {
    line(`  detected: ${outcome.agents.join(', ')}`);
  }
  info('\nnext: agent-sync add skill <path>   then   agent-sync apply');
  return outcome.agents.length === 0 ? EXIT.warnings : EXIT.ok;
};

export interface CloneOptions {
  readonly url: string;
  readonly storeOverride?: string;
  readonly deviceName?: string;
  readonly json: boolean;
}

export const performClone = (options: CloneOptions): StoreResult => {
  const facts = readMachineFacts();
  const layout = layoutFor(facts.home, options.storeOverride);

  if (existsSync(layout.manifest)) {
    return {
      ok: false,
      message: `a store already exists at ${layout.store} — use "agent-sync sync" to update it`,
    };
  }

  ensureDir(layout.root);
  const result = git.clone(options.url, layout.store);
  if (!result.ok) {
    return { ok: false, message: `could not clone ${options.url}:\n${result.output}` };
  }

  const agents = detectAgents(facts);
  const device: Device = {
    device: deviceIdFrom(options.deviceName ?? `${facts.platform}-device`),
    agents: [...agents],
  };
  writeFileAtomic(layout.device, stringify(device));

  return {
    ok: true,
    value: {
      store: layout.store,
      created: true,
      device: device.device,
      agents,
      remote: git.remoteUrl(layout.store),
      repository: null,
      published: false,
      warnings: [],
    },
  };
};

export const runClone = (options: CloneOptions): ExitCode => {
  const result = performClone(options);
  if (!result.ok) {
    if (options.json) emitJson('clone', false, { error: result.message });
    else failure(result.message);
    return EXIT.error;
  }

  const outcome = result.value;
  if (options.json) {
    emitJson('clone', true, {
      store: outcome.store,
      device: outcome.device,
      agents: outcome.agents,
    });
    return EXIT.ok;
  }

  success(`cloned into ${outcome.store}`);
  success(
    `device registered as "${outcome.device}" — detected: ${outcome.agents.join(', ') || 'none'}`,
  );
  info('\nnext: agent-sync apply');
  return EXIT.ok;
};
