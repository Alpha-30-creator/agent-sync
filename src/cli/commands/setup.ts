/**
 * `setup` — the one entry point for putting agent-sync on a machine.
 *
 * Onboarding is several steps that a person (or an agent following INSTALL.md) should
 * not have to sequence themselves: make or fetch the library, register the device, and
 * deploy the interface skill pack so the agents can drive the tool from then on. This
 * command is that sequence, and it converges rather than insisting on a clean machine —
 * re-running it is the repair path for "my Cursor lost the skill pack".
 */
import { apply } from '../../app/apply.js';
import { describeFailure, loadContext } from '../../app/context.js';
import { BUILT_IN_SKILLS } from '../../core/model/builtins.js';
import { EXIT, type ExitCode, emitJson, failure, info, line, success, warn } from '../output.js';
import {
  type CloneOptions,
  type InitOptions,
  performClone,
  performInit,
  type StoreResult,
} from './init.js';

export interface SetupOptions {
  readonly storeOverride?: string;
  /** Sync through a repository that already exists. */
  readonly remote?: string;
  /** Set this machine up from an existing library. */
  readonly cloneUrl?: string;
  /** Create the repository, then sync through it. */
  readonly createRemote?: string;
  readonly visibility: 'private' | 'public';
  readonly deviceName?: string;
  readonly json: boolean;
}

/**
 * How this machine gets a library.
 *
 * The three flags answer the same question and cannot be combined, so saying which one
 * to keep is more useful than reporting that the command failed.
 */
const chooseSource = (options: SetupOptions): StoreResult | { readonly conflict: string } => {
  const given = [
    options.remote === undefined ? null : '--remote',
    options.cloneUrl === undefined ? null : '--clone',
    options.createRemote === undefined ? null : '--create-remote',
  ].filter((flag): flag is string => flag !== null);

  if (given.length > 1) {
    return {
      conflict:
        `${given.join(' and ')} answer the same question; pick one\n` +
        '  --clone <git-url>       this machine joins a library that already exists\n' +
        '  --remote <git-url>      first machine, repository already made\n' +
        '  --create-remote <name>  first machine, make the repository too',
    };
  }

  if (options.cloneUrl !== undefined) {
    const cloneOptions: CloneOptions = {
      url: options.cloneUrl,
      json: false,
      ...(options.storeOverride === undefined ? {} : { storeOverride: options.storeOverride }),
      ...(options.deviceName === undefined ? {} : { deviceName: options.deviceName }),
    };
    return performClone(cloneOptions);
  }

  // `init` already converges on a machine that has a store, so it covers the plain
  // "nothing yet" case and the repair case alike.
  const initOptions: InitOptions = {
    json: false,
    visibility: options.visibility,
    ...(options.storeOverride === undefined ? {} : { storeOverride: options.storeOverride }),
    ...(options.remote === undefined ? {} : { remote: options.remote }),
    ...(options.createRemote === undefined ? {} : { createRemote: options.createRemote }),
    ...(options.deviceName === undefined ? {} : { deviceName: options.deviceName }),
  };
  return performInit(initOptions);
};

export const runSetup = (options: SetupOptions): ExitCode => {
  const source = chooseSource(options);
  if ('conflict' in source) {
    if (options.json) emitJson('setup', false, { error: source.conflict });
    else failure(source.conflict);
    return EXIT.error;
  }
  if (!source.ok) {
    if (options.json) emitJson('setup', false, { error: source.message });
    else failure(source.message);
    return EXIT.error;
  }

  const outcome = source.value;
  const loaded = loadContext(options.storeOverride);
  if (!loaded.ok) {
    const message = describeFailure(loaded.failure);
    if (options.json) emitJson('setup', false, { error: message });
    else failure(message);
    return EXIT.error;
  }

  // Deploying is the step that puts the skill pack in front of the agents, and it also
  // brings across everything else the library already holds — which is the whole point
  // on a second machine.
  const result = apply(loaded.value, { dryRun: false, answer: 'ask' });
  const packDeployed = result.written.filter((item) =>
    BUILT_IN_SKILLS.some((id) => item.startsWith(`skill/${id} `)),
  );

  if (options.json) {
    emitJson('setup', true, {
      store: outcome.store,
      created: outcome.created,
      device: outcome.device,
      agents: outcome.agents,
      remote: outcome.remote,
      repository: outcome.repository,
      published: outcome.published,
      written: result.written,
      unresolved: result.unresolved,
      warnings: outcome.warnings,
    });
    return result.unresolved.length > 0 ? EXIT.needsDecision : EXIT.ok;
  }

  for (const message of outcome.warnings) warn(message);
  success(
    outcome.created ? `library ready at ${outcome.store}` : `library already at ${outcome.store}`,
  );
  if (outcome.repository !== null) {
    success(
      outcome.published
        ? `created ${options.visibility} repository ${outcome.repository} and pushed to it`
        : `created ${options.visibility} repository ${outcome.repository}`,
    );
  }
  success(`device registered as "${outcome.device}"`);

  if (outcome.agents.length === 0) {
    warn('no agents detected — install Claude Code, Codex, or Cursor, then run: agent-sync setup');
  } else {
    line(`  detected: ${outcome.agents.join(', ')}`);
    success(
      packDeployed.length > 0
        ? `deployed the agent-sync skills to ${outcome.agents.join(', ')}`
        : 'the agent-sync skills are already in place',
    );
  }
  if (result.written.length > 0) line(`  ${result.written.length} deployment(s) written`);

  if (result.unresolved.length > 0) {
    warn(`${result.unresolved.length} artifact(s) need a decision — run: agent-sync status`);
    return EXIT.needsDecision;
  }

  info(
    outcome.agents.length === 0
      ? '\nnext: install an agent, then run agent-sync setup again'
      : '\nyour agents can drive it now — try "sync my skills" in any of them',
  );
  return outcome.agents.length === 0 ? EXIT.warnings : EXIT.ok;
};
