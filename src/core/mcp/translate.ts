/**
 * Canonical MCP definition → each agent's dialect (docs/03-architecture.md §7).
 *
 * Three rules, all visible in the return type:
 *
 *  1. **Superset with warnings.** A field a dialect cannot express is dropped *and*
 *     reported. Never silently lost, never a hard failure.
 *  2. **Secrets are indirection.** `${secret:name}` is resolved here, from values the
 *     shell supplies; `${env:VAR}` is passed through to agents that expand it and
 *     resolved for those that do not.
 *  3. **Pure.** Data in, data out — the writers decide how it reaches disk.
 */
import type { AgentId } from '../model/types.js';
import { type McpDefinition, parseReference, type Transport } from './schema.js';

export interface DialectSupport {
  readonly transports: readonly Transport[];
  /** True when the agent expands `${VAR}` in its own config. */
  readonly expandsEnvReferences: boolean;
  /** Per-agent tweaks this dialect understands. */
  readonly tweaks: readonly ('startup_timeout_sec' | 'tool_timeout_sec' | 'envFile' | 'enabled')[];
}

export interface TranslateWarning {
  readonly ref: string;
  readonly agent: AgentId;
  readonly message: string;
}

export interface TranslateInput {
  readonly id: string;
  readonly definition: McpDefinition;
  readonly agent: AgentId;
  readonly support: DialectSupport;
  /** Secret values available on this device, by name. */
  readonly secrets: Readonly<Record<string, string>>;
  /** Environment values available on this device, by variable name. */
  readonly env: Readonly<Record<string, string | undefined>>;
}

export type TranslatedValue = Record<string, unknown>;

export interface TranslateResult {
  /** The dialect-shaped value, or null when the agent cannot host this server at all. */
  readonly value: TranslatedValue | null;
  readonly warnings: readonly TranslateWarning[];
}

const warn = (input: TranslateInput, message: string): TranslateWarning => ({
  ref: `mcp/${input.id}`,
  agent: input.agent,
  message: `mcp/${input.id} → ${input.agent}: ${message}`,
});

/**
 * Resolve one value's references. Returns the literal to write, plus any warning about
 * a reference that could not be satisfied.
 */
const resolveValue = (
  input: TranslateInput,
  key: string,
  value: string,
): { resolved: string; warning: TranslateWarning | null } => {
  const reference = parseReference(value);
  if (reference === null) return { resolved: value, warning: null };

  if (reference.kind === 'secret') {
    const secret = input.secrets[reference.name];
    if (secret === undefined) {
      return {
        // Write the reference through rather than an empty string: an unresolved
        // placeholder is obvious, a silent blank looks like a working config.
        resolved: value,
        warning: warn(
          input,
          `secret "${reference.name}" is not set on this device (${key} left unresolved)`,
        ),
      };
    }
    return { resolved: secret, warning: null };
  }

  // ${env:VAR}: leave it for agents that expand it themselves.
  if (input.support.expandsEnvReferences)
    return { resolved: `\${${reference.name}}`, warning: null };

  const fromEnv = input.env[reference.name];
  if (fromEnv === undefined) {
    return {
      resolved: value,
      warning: warn(
        input,
        `${input.agent} does not expand environment references and ${reference.name} is not set here (${key} left unresolved)`,
      ),
    };
  }
  return { resolved: fromEnv, warning: null };
};

const resolveMap = (
  input: TranslateInput,
  label: string,
  map: Readonly<Record<string, string>> | undefined,
): { resolved: Record<string, string> | undefined; warnings: TranslateWarning[] } => {
  if (map === undefined) return { resolved: undefined, warnings: [] };

  const resolved: Record<string, string> = {};
  const warnings: TranslateWarning[] = [];
  for (const [key, value] of Object.entries(map)) {
    const outcome = resolveValue(input, `${label}.${key}`, value);
    resolved[key] = outcome.resolved;
    if (outcome.warning !== null) warnings.push(outcome.warning);
  }
  return { resolved, warnings };
};

/** Translate a canonical definition into one agent's dialect. */
export const translate = (input: TranslateInput): TranslateResult => {
  const { definition, support } = input;
  const warnings: TranslateWarning[] = [];

  if (!support.transports.includes(definition.transport)) {
    return {
      value: null,
      warnings: [
        warn(
          input,
          `${input.agent} does not support the "${definition.transport}" transport (supports: ${support.transports.join(', ')})`,
        ),
      ],
    };
  }

  const env = resolveMap(input, 'env', definition.env);
  warnings.push(...env.warnings);

  const value: TranslatedValue = { type: definition.transport };

  if (definition.transport === 'stdio') {
    value.command = definition.command;
    if (definition.args !== undefined) value.args = [...definition.args];
    if (env.resolved !== undefined) value.env = env.resolved;
  } else {
    value.url = definition.url;
    const headers = resolveMap(input, 'headers', definition.headers);
    warnings.push(...headers.warnings);
    if (headers.resolved !== undefined) value.headers = headers.resolved;
    // Some servers still read configuration from the environment even over http.
    if (env.resolved !== undefined) value.env = env.resolved;
  }

  const tweaks = definition.agents?.[input.agent] ?? {};
  for (const [key, tweakValue] of Object.entries(tweaks)) {
    if (support.tweaks.includes(key as DialectSupport['tweaks'][number])) {
      value[key] = tweakValue;
      continue;
    }
    warnings.push(warn(input, `"${key}" is not supported by ${input.agent} and was ignored`));
  }

  return { value, warnings };
};

/**
 * Stable JSON of a translated value, used as the content hash for drift detection.
 *
 * MCP entries live inside files the user also edits, so drift is compared
 * *semantically* rather than byte-wise: reordering keys or reformatting the file must
 * not read as "someone changed my server".
 */
export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
};
