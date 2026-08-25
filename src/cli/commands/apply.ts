/**
 * `apply` and `status`. Both run the same pipeline; status simply stops after planning
 * and renders, which is why its report can never disagree with what apply would do.
 */
import { type ApplyOptions, apply, type DriftAnswer, planApply } from '../../app/apply.js';
import { type Context, describeFailure, loadContext } from '../../app/context.js';
import { AGENT_IDS, type AgentId } from '../../core/model/types.js';
import { exitCodeFor, exitCodeFrom } from '../../core/planner/plan.js';
import { explain } from '../../core/resolver/resolve.js';
import { EXIT, type ExitCode, emitJson, failure, info, line, success, warn } from '../output.js';

export interface ApplyCommandOptions {
  readonly storeOverride?: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly adopt: boolean;
  readonly overwrite: boolean;
  readonly agents?: readonly string[];
}

const answerFrom = (options: ApplyCommandOptions): DriftAnswer =>
  options.adopt ? 'adopt' : options.overwrite ? 'overwrite' : 'ask';

const parseAgents = (values: readonly string[] | undefined): readonly AgentId[] | undefined => {
  if (values === undefined || values.length === 0) return undefined;
  return values.filter((value): value is AgentId =>
    (AGENT_IDS as readonly string[]).includes(value),
  );
};

const withContext = (
  storeOverride: string | undefined,
  json: boolean,
  command: string,
  run: (context: Context) => ExitCode,
): ExitCode => {
  const loaded = loadContext(storeOverride);
  if (!loaded.ok) {
    if (json)
      emitJson(command, false, {
        error: describeFailure(loaded.failure),
        kind: loaded.failure.kind,
      });
    else failure(describeFailure(loaded.failure));
    return EXIT.error;
  }
  return run(loaded.value);
};

export const runApply = (options: ApplyCommandOptions): ExitCode =>
  withContext(options.storeOverride, options.json, 'apply', (context) => {
    const selected = parseAgents(options.agents);
    const applyOptions: ApplyOptions = {
      dryRun: options.dryRun,
      answer: answerFrom(options),
      ...(selected === undefined ? {} : { agents: selected }),
    };

    const result = apply(context, applyOptions);
    // Questions answered by --adopt/--overwrite are settled; only what is still
    // outstanding may push the exit code to "needs a decision".
    const code = exitCodeFrom(result.unresolved.length, result.plan.diagnostics.length);

    if (options.json) {
      emitJson('apply', true, {
        dryRun: options.dryRun,
        operations: result.plan.operations,
        diagnostics: result.plan.diagnostics,
        unchanged: result.plan.unchanged,
        written: result.written,
        removed: result.removed,
        adopted: result.adopted,
        unresolved: result.unresolved,
        exitCode: code,
      });
      return code;
    }

    if (result.plan.operations.length === 0) {
      success(
        `already in sync${result.plan.unchanged.length > 0 ? ` (${result.plan.unchanged.length} deployments)` : ''}`,
      );
    } else if (options.dryRun) {
      line('planned changes:');
      for (const operation of result.plan.operations) {
        const detail = operation.kind === 'ask' ? operation.question : `${operation.path}`;
        line(`  ${operation.kind.padEnd(7)} ${operation.ref} → ${operation.agent}  ${detail}`);
      }
      info('\nnothing was written — this was a dry run');
    } else {
      for (const item of result.written) success(`deployed ${item}`);
      for (const item of result.removed) success(`removed ${item}`);
      for (const item of result.adopted) success(`adopted ${item} back into the library`);
      for (const operation of result.plan.operations) {
        if (operation.kind === 'ask' && result.unresolved.includes(operation.ref)) {
          warn(operation.question);
        }
      }
    }

    for (const diagnostic of result.plan.diagnostics) info(`  note: ${diagnostic.message}`);

    if (result.unresolved.length > 0) {
      info(
        '\nre-run with --adopt to keep your edits, or --overwrite to replace them with the library version',
      );
    }
    return code;
  });

export interface StatusOptions {
  readonly storeOverride?: string;
  readonly json: boolean;
  readonly why: boolean;
}

const SYMBOL: Record<string, string> = {
  'in-sync': '✔ synced',
  outdated: '⟳ outdated',
  drifted: '⚠ drifted',
  conflicted: '⚠ conflicted',
  missing: '· missing',
  'adopted-in-place': '✔ adopted',
  'unmanaged-collision': '⚠ collision',
};

export const runStatus = (options: StatusOptions): ExitCode =>
  withContext(options.storeOverride, options.json, 'status', (context) => {
    const { plan, targets } = planApply(context, { dryRun: true, answer: 'ask' });
    const code = exitCodeFor(plan);

    if (options.json) {
      emitJson('status', true, {
        targets: targets.map((target) => ({
          ref: `${target.deployment.type}/${target.deployment.id}`,
          agent: target.deployment.agent,
          path: target.path,
          why: explain(target.deployment),
        })),
        operations: plan.operations,
        diagnostics: plan.diagnostics,
        unchanged: plan.unchanged,
        exitCode: code,
      });
      return code;
    }

    if (targets.length === 0) {
      info('nothing deployed yet — add a skill with "agent-sync add skill <path>"');
      return code;
    }

    const stateByKey = new Map<string, string>();
    for (const operation of plan.operations) {
      if (operation.kind !== 'remove') {
        stateByKey.set(`${operation.ref}@${operation.agent}`, operation.reason);
      }
    }

    const refs = [...new Set(targets.map((t) => `${t.deployment.type}/${t.deployment.id}`))].sort();
    const agents = [...new Set(targets.map((t) => t.deployment.agent))];

    line(`${'artifact'.padEnd(28)}${agents.map((a) => a.padEnd(14)).join('')}`);
    for (const ref of refs) {
      const cells = agents.map((agent) => {
        const target = targets.find(
          (t) => `${t.deployment.type}/${t.deployment.id}` === ref && t.deployment.agent === agent,
        );
        if (target === undefined) return '– excluded'.padEnd(14);
        return (SYMBOL[stateByKey.get(`${ref}@${agent}`) ?? 'in-sync'] ?? '?').padEnd(14);
      });
      line(`${ref.padEnd(28)}${cells.join('')}`);
      if (options.why) {
        const target = targets.find((t) => `${t.deployment.type}/${t.deployment.id}` === ref);
        if (target !== undefined) info(`${' '.repeat(28)}why: ${explain(target.deployment)}`);
      }
    }

    for (const diagnostic of plan.diagnostics) info(`\nnote: ${diagnostic.message}`);
    if (plan.operations.length > 0)
      info(`\n${plan.operations.length} change(s) pending — run "agent-sync apply"`);
    return code;
  });
