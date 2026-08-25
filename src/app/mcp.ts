/**
 * MCP deployment: resolved routes → concrete config edits.
 *
 * Unlike skills, an MCP server is not a file we own — it is an entry inside a file the
 * agent (and the user) also writes. So drift is compared semantically, and every write
 * goes through the surgical editors.
 */

import { join } from 'node:path';
import { parse } from 'yaml';
import { CAPABILITIES, type McpLocation } from '../adapters/capability-table.js';
import { hashEntry, readMcpEntry } from '../adapters/mcp.js';
import { type McpDefinition, parseMcpDefinition } from '../core/mcp/schema.js';
import { stableStringify, type TranslateWarning, translate } from '../core/mcp/translate.js';
import type { AgentId } from '../core/model/types.js';
import type { TargetState } from '../core/planner/plan.js';
import type { Deployment, Diagnostic } from '../core/resolver/resolve.js';
import { readTextFile, sha256 } from '../shell/fs.js';
import { lookup } from '../store/lockfile.js';
import type { Context } from './context.js';

export interface McpPlanInput {
  readonly context: Context;
  readonly deployments: readonly Deployment[];
  readonly secrets: Readonly<Record<string, string>>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly projectPaths: ReadonlyMap<string, string>;
}

export interface McpTarget extends TargetState {
  /** The dialect value to write, ready for the adapter. */
  readonly value: Record<string, unknown>;
  readonly location: McpLocation;
}

export interface McpPlan {
  readonly targets: readonly McpTarget[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Path of a canonical MCP definition inside the store. */
export const mcpSourcePath = (mcpRoot: string, id: string): string => join(mcpRoot, `${id}.yaml`);

export const loadDefinition = (
  mcpRoot: string,
  id: string,
): { ok: true; value: McpDefinition } | { ok: false; message: string } => {
  const text = readTextFile(mcpSourcePath(mcpRoot, id));
  if (text === null) return { ok: false, message: `mcp/${id} has no definition in the library` };

  let document: unknown;
  try {
    document = parse(text);
  } catch (error) {
    return { ok: false, message: `mcp/${id}: ${(error as Error).message}` };
  }

  const parsed = parseMcpDefinition(document);
  if (!parsed.ok) {
    const detail = parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
    return { ok: false, message: `mcp/${id} is not valid (${detail})` };
  }
  return { ok: true, value: parsed.value };
};

const locationFor = (
  context: Context,
  agent: AgentId,
  deployment: Deployment,
  projectPaths: ReadonlyMap<string, string>,
): McpLocation | null => {
  const capabilities = CAPABILITIES[agent];
  if (deployment.scope.kind === 'global') return capabilities.globalMcp(context.facts);

  const projectDir = projectPaths.get(deployment.scope.projectId);
  return projectDir === undefined ? null : capabilities.projectMcp(context.facts, projectDir);
};

const asDiagnostic = (warning: TranslateWarning): Diagnostic => ({
  kind: 'capability-unsupported',
  ref: warning.ref,
  agent: warning.agent,
  message: warning.message,
});

/** Expand resolved MCP routes into writable targets. */
export const mcpTargets = (input: McpPlanInput): McpPlan => {
  const { context, deployments, secrets, env, projectPaths } = input;
  const targets: McpTarget[] = [];
  const diagnostics: Diagnostic[] = [];
  const definitions = new Map<string, McpDefinition | null>();

  for (const deployment of deployments) {
    if (deployment.type !== 'mcp') continue;

    if (!definitions.has(deployment.id)) {
      const loaded = loadDefinition(context.layout.mcp, deployment.id);
      if (!loaded.ok) {
        definitions.set(deployment.id, null);
        diagnostics.push({
          kind: 'capability-unsupported',
          ref: `mcp/${deployment.id}`,
          agent: deployment.agent,
          message: loaded.message,
        });
      } else {
        definitions.set(deployment.id, loaded.value);
      }
    }

    const definition = definitions.get(deployment.id);
    if (definition === null || definition === undefined) continue;

    const location = locationFor(context, deployment.agent, deployment, projectPaths);
    if (location === null) continue;

    const translated = translate({
      id: deployment.id,
      definition,
      agent: deployment.agent,
      support: CAPABILITIES[deployment.agent].mcpDialect,
      secrets,
      env,
    });
    diagnostics.push(...translated.warnings.map(asDiagnostic));
    if (translated.value === null) continue;

    const current = readMcpEntry(location, deployment.id);
    if (current.kind === 'unparseable') {
      diagnostics.push({
        kind: 'capability-unsupported',
        ref: `mcp/${deployment.id}`,
        agent: deployment.agent,
        message: `${location.path} cannot be parsed, so agent-sync will not touch it: ${current.message}`,
      });
      continue;
    }

    const ref = `mcp/${deployment.id}`;
    targets.push({
      deployment,
      path: location.path,
      location,
      value: translated.value,
      observation: {
        sourceHash: sha256(stableStringify(translated.value)),
        targetHash: current.kind === 'present' ? hashEntry(current.value) : null,
        lock: lookup(context.lockfile, ref, deployment.agent, location.path),
      },
    });
  }

  return { targets, diagnostics };
};
