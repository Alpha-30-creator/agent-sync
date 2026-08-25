/**
 * `sync` — the daily loop: commit local changes, pull, apply, push.
 * `doctor` — diagnostics only; never writes.
 */
import { existsSync } from 'node:fs';
import { CAPABILITIES } from '../../adapters/capability-table.js';
import { apply } from '../../app/apply.js';
import { describeFailure, loadContext } from '../../app/context.js';
import { AGENT_IDS } from '../../core/model/types.js';
import { agentVersion, detectAgents, readMachineFacts } from '../../shell/machine.js';
import * as git from '../../store/git.js';
import { layoutFor } from '../../store/layout.js';
import { EXIT, type ExitCode, emitJson, failure, info, line, success, warn } from '../output.js';

export interface SyncOptions {
  readonly storeOverride?: string;
  readonly json: boolean;
  readonly push: boolean;
}

export const runSync = (options: SyncOptions): ExitCode => {
  const loaded = loadContext(options.storeOverride);
  if (!loaded.ok) {
    if (options.json) emitJson('sync', false, { error: describeFailure(loaded.failure) });
    else failure(describeFailure(loaded.failure));
    return EXIT.error;
  }
  const context = loaded.value;
  const store = context.layout.store;

  const committed = git.commitAll(store, 'chore: update library');
  const hasRemote = git.remoteUrl(store) !== null;
  const pulled = hasRemote ? git.pull(store) : { ok: true, output: 'no remote configured' };

  if (!pulled.ok) {
    // Conflicts stop the pipeline with the artifact-level context a human needs.
    if (options.json) emitJson('sync', false, { stage: 'pull', error: pulled.output });
    else {
      failure(`pull failed:\n${pulled.output}`);
      info('resolve the conflict in the store, then run "agent-sync sync" again');
      info(`store: ${store}`);
    }
    return EXIT.error;
  }

  // Re-load: the pull may have changed the manifest under us.
  const after = loadContext(options.storeOverride);
  if (!after.ok) {
    failure(describeFailure(after.failure));
    return EXIT.error;
  }

  const result = apply(after.value, { dryRun: false, answer: 'ask' });
  const pushed = options.push && hasRemote ? git.push(store).ok : false;

  if (options.json) {
    emitJson('sync', true, {
      committed,
      pulled: hasRemote,
      pushed,
      written: result.written,
      removed: result.removed,
      unresolved: result.unresolved,
    });
    return result.unresolved.length > 0 ? EXIT.needsDecision : EXIT.ok;
  }

  for (const item of result.written) success(`deployed ${item}`);
  for (const item of result.removed) success(`removed ${item}`);
  if (result.written.length === 0 && result.removed.length === 0) success('already in sync');
  if (options.push && hasRemote && !pushed)
    info('could not push (offline?) — will retry next sync');
  else if (pushed) success('pushed to the remote');
  if (!hasRemote) info('no git remote configured — this device is syncing locally only');

  for (const ref of result.unresolved)
    warn(`${ref} needs a decision — run "agent-sync apply" to see it`);
  return result.unresolved.length > 0 ? EXIT.needsDecision : EXIT.ok;
};

export interface DoctorOptions {
  readonly storeOverride?: string;
  readonly json: boolean;
}

export const runDoctor = (options: DoctorOptions): ExitCode => {
  const facts = readMachineFacts();
  const layout = layoutFor(facts.home, options.storeOverride);
  const problems: string[] = [];
  const notes: string[] = [];

  if (!git.isGitAvailable())
    problems.push('git is not on PATH — agent-sync needs it to sync between devices');

  const storeExists = existsSync(layout.manifest);
  if (!storeExists)
    problems.push(
      `no store at ${layout.store} — run "agent-sync init" or "agent-sync clone <url>"`,
    );

  const loaded = storeExists ? loadContext(options.storeOverride) : null;
  if (loaded !== null && !loaded.ok) problems.push(describeFailure(loaded.failure));

  const detected = detectAgents(facts);
  const versions = Object.fromEntries(
    detected.map((agent) => {
      const version = agentVersion(agent);
      const verified = CAPABILITIES[agent].verifiedAgainst;
      if (version !== null && !verified.some((v) => version.includes(v))) {
        // Layouts are verified per version; an unknown one is a warning, not a failure.
        notes.push(
          `${agent} reports "${version}", outside the versions agent-sync verified (${verified.join(', ')}) — layouts may have moved`,
        );
      }
      return [agent, version];
    }),
  );

  const registered = loaded?.ok === true ? loaded.value.device.agents : [];
  const missing = detected.filter((agent) => !registered.includes(agent));
  const stale = registered.filter((agent) => !detected.includes(agent));
  if (loaded?.ok === true) {
    for (const agent of missing)
      notes.push(`${agent} is installed but not registered on this device`);
    for (const agent of stale) notes.push(`${agent} is registered but no longer detected`);
  }

  if (options.json) {
    emitJson('doctor', problems.length === 0, {
      store: layout.store,
      storeExists,
      git: git.isGitAvailable(),
      remote: storeExists ? git.remoteUrl(layout.store) : null,
      agents: { detected, registered, versions },
      problems,
      notes,
    });
    return problems.length > 0 ? EXIT.error : notes.length > 0 ? EXIT.warnings : EXIT.ok;
  }

  line(`store    ${storeExists ? layout.store : 'not initialised'}`);
  line(`git      ${git.isGitAvailable() ? 'available' : 'MISSING'}`);
  line(`remote   ${storeExists ? (git.remoteUrl(layout.store) ?? 'none') : '—'}`);
  line('agents');
  for (const agent of AGENT_IDS) {
    const version = versions[agent];
    line(
      `  ${agent.padEnd(8)} ${detected.includes(agent) ? (version ?? 'installed') : 'not found'}`,
    );
  }

  for (const note of notes) warn(note);
  for (const problem of problems) failure(problem);
  if (problems.length === 0 && notes.length === 0) success('everything looks healthy');

  return problems.length > 0 ? EXIT.error : notes.length > 0 ? EXIT.warnings : EXIT.ok;
};
