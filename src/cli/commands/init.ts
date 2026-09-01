/**
 * `init` — create the canonical store and register this machine.
 * `clone` — the same, starting from an existing store on a git remote.
 */
import { existsSync } from 'node:fs';
import { stringify } from 'yaml';
import type { Device, Manifest } from '../../core/manifest/schema.js';
import { describeRepoNameError, parseRepoName, repoSlug } from '../../core/model/repo.js';
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

const deviceIdFrom = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'device';

export const runInit = (options: InitOptions): ExitCode => {
  const facts = readMachineFacts();
  const layout = layoutFor(facts.home, options.storeOverride);

  if (!git.isGitAvailable()) {
    failure('git was not found on PATH — agent-sync uses it to sync your library between devices');
    return EXIT.error;
  }

  const plan = planRemote(options);
  if ('error' in plan) {
    failure(plan.error);
    return EXIT.error;
  }

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
      warn(commit.message);
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
      failure(
        `could not create ${plan.slug}:\n${repo.message}\n\n` +
          `your library is intact at ${layout.store}; once the repository exists, run:\n` +
          '  agent-sync init --remote <its-git-url>',
      );
      return EXIT.error;
    }
    created = plan.slug;
    git.setRemote(layout.store, repo.value);

    const pushed = git.push(layout.store);
    published = pushed.ok;
    if (!pushed.ok) {
      warn(
        `created ${plan.slug} and pointed the library at it, but the first push failed:\n` +
          `${pushed.output}\n  fix the access above, then run: agent-sync sync`,
      );
    }
  }

  const agents = detectAgents(facts);
  const device: Device = {
    device: deviceIdFrom(options.deviceName ?? `${facts.platform}-device`),
    agents: [...agents],
  };
  writeFileAtomic(layout.device, stringify(device));

  if (options.json) {
    emitJson('init', true, {
      store: layout.store,
      created: !alreadyExists,
      device: device.device,
      agents,
      remote: git.remoteUrl(layout.store),
      repository: created,
      published,
    });
    return EXIT.ok;
  }

  success(
    alreadyExists ? `store already present at ${layout.store}` : `store created at ${layout.store}`,
  );
  if (created !== null) {
    success(
      published
        ? `created ${options.visibility} repository ${created} and pushed your library to it`
        : `created ${options.visibility} repository ${created}`,
    );
  }
  success(`device registered as "${device.device}"`);
  if (agents.length === 0) {
    line(
      '  no agents detected — install Claude Code, Codex, or Cursor, then run: agent-sync doctor',
    );
  } else {
    line(`  detected: ${agents.join(', ')}`);
  }
  info('\nnext: agent-sync add skill <path>   then   agent-sync apply');
  return agents.length === 0 ? EXIT.warnings : EXIT.ok;
};

export interface CloneOptions {
  readonly url: string;
  readonly storeOverride?: string;
  readonly deviceName?: string;
  readonly json: boolean;
}

export const runClone = (options: CloneOptions): ExitCode => {
  const facts = readMachineFacts();
  const layout = layoutFor(facts.home, options.storeOverride);

  if (existsSync(layout.manifest)) {
    failure(`a store already exists at ${layout.store} — use "agent-sync sync" to update it`);
    return EXIT.error;
  }

  ensureDir(layout.root);
  const result = git.clone(options.url, layout.store);
  if (!result.ok) {
    failure(`could not clone ${options.url}:\n${result.output}`);
    return EXIT.error;
  }

  const agents = detectAgents(facts);
  const device: Device = {
    device: deviceIdFrom(options.deviceName ?? `${facts.platform}-device`),
    agents: [...agents],
  };
  writeFileAtomic(layout.device, stringify(device));

  if (options.json) {
    emitJson('clone', true, { store: layout.store, device: device.device, agents });
    return EXIT.ok;
  }

  success(`cloned into ${layout.store}`);
  success(`device registered as "${device.device}" — detected: ${agents.join(', ') || 'none'}`);
  info('\nnext: agent-sync apply');
  return EXIT.ok;
};
