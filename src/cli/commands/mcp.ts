/**
 * `add mcp` and the `secret` commands.
 *
 * Secret *values* are never accepted as arguments — argv lands in shell history and in
 * process listings, and agents drive this CLI. They come from stdin or an interactive
 * prompt only (docs/09-agent-native.md §4.2).
 */
import { existsSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import { describeFailure, loadContext } from '../../app/context.js';
import { mcpSourcePath } from '../../app/mcp.js';
import type { Manifest } from '../../core/manifest/schema.js';
import {
  looksLikeSecret,
  type McpDefinition,
  parseMcpDefinition,
  requiredSecrets,
} from '../../core/mcp/schema.js';
import { ID_PATTERN } from '../../core/model/ids.js';
import { AGENT_IDS, type AgentId } from '../../core/model/types.js';
import { readTextFile, writeFileAtomic } from '../../shell/fs.js';
import { loadSecrets, removeSecret, secretNames, setSecret } from '../../shell/secrets.js';
import { EXIT, type ExitCode, emitJson, failure, info, line, success, warn } from '../output.js';

const load = (storeOverride: string | undefined, json: boolean, command: string) => {
  const loaded = loadContext(storeOverride);
  if (!loaded.ok) {
    if (json) emitJson(command, false, { error: describeFailure(loaded.failure) });
    else failure(describeFailure(loaded.failure));
    return null;
  }
  return loaded.value;
};

export interface AddMcpOptions {
  readonly id: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly transport?: string;
  readonly env?: readonly string[];
  readonly header?: readonly string[];
  readonly targets?: readonly string[];
  readonly storeOverride?: string;
  readonly json: boolean;
}

const parsePairs = (values: readonly string[] | undefined): Record<string, string> | null => {
  if (values === undefined) return {};
  const out: Record<string, string> = {};
  for (const value of values) {
    const equals = value.indexOf('=');
    if (equals <= 0) return null;
    out[value.slice(0, equals)] = value.slice(equals + 1);
  }
  return out;
};

export const runAddMcp = (options: AddMcpOptions): ExitCode => {
  const context = load(options.storeOverride, options.json, 'add');
  if (context === null) return EXIT.error;

  if (!ID_PATTERN.test(options.id)) {
    failure(`"${options.id}" is not a valid id — use lowercase kebab-case`);
    return EXIT.error;
  }

  const env = parsePairs(options.env);
  const headers = parsePairs(options.header);
  if (env === null || headers === null) {
    failure('environment and header values are written as KEY=value');
    return EXIT.error;
  }

  const draft: Record<string, unknown> =
    options.url !== undefined
      ? {
          transport: options.transport === 'sse' ? 'sse' : 'http',
          url: options.url,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
          ...(Object.keys(env).length > 0 ? { env } : {}),
        }
      : {
          transport: 'stdio',
          command: options.command,
          ...(options.args === undefined || options.args.length === 0
            ? {}
            : { args: [...options.args] }),
          ...(Object.keys(env).length > 0 ? { env } : {}),
        };

  const parsed = parseMcpDefinition(draft);
  if (!parsed.ok) {
    const detail = parsed.issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n');
    if (options.json)
      emitJson('add', false, { error: 'invalid definition', issues: parsed.issues });
    else failure(`that is not a usable MCP definition:\n${detail}`);
    return EXIT.error;
  }

  // Refuse to put a literal credential into a git-backed library.
  const inline = [...Object.entries(env), ...Object.entries(headers)].filter(([key, value]) =>
    looksLikeSecret(key, value),
  );

  if (inline.length > 0) {
    const names = inline.map(([key]) => key).join(', ');
    failure(
      `${names} looks like a credential, and the library is a git repository.\n` +
        `Store it on this device instead:\n` +
        `  agent-sync secret set ${options.id}-token\n` +
        `then reference it as \${secret:${options.id}-token}`,
    );
    return EXIT.error;
  }

  writeFileAtomic(mcpSourcePath(context.layout.mcp, options.id), stringify(parsed.value));

  const raw = (parse(readTextFile(context.layout.manifest) ?? 'version: 1') as Manifest) ?? {
    version: 1,
  };
  const validTargets = (options.targets ?? []).filter((t): t is AgentId =>
    (AGENT_IDS as readonly string[]).includes(t),
  );
  const updated: Manifest = {
    ...raw,
    artifacts: {
      ...raw.artifacts,
      mcp: {
        ...raw.artifacts?.mcp,
        [options.id]: validTargets.length > 0 ? { targets: validTargets } : {},
      },
    },
  };
  writeFileAtomic(context.layout.manifest, stringify(updated));

  const needed = requiredSecrets(parsed.value);
  const have = loadSecrets(context.layout.secrets);
  const missing = needed.filter((name) => have[name] === undefined);

  if (options.json) {
    emitJson('add', true, { ref: `mcp/${options.id}`, missingSecrets: missing });
    return missing.length > 0 ? EXIT.warnings : EXIT.ok;
  }

  success(`added mcp/${options.id} to the library`);
  for (const name of missing) {
    warn(`this server needs a secret that is not set here — run: agent-sync secret set ${name}`);
  }
  info('next: agent-sync apply');
  return missing.length > 0 ? EXIT.warnings : EXIT.ok;
};

export interface SecretOptions {
  readonly action: 'set' | 'rm' | 'ls';
  readonly name?: string;
  readonly storeOverride?: string;
  readonly json: boolean;
  /** Reads the value from stdin, for scripts and agents. */
  readonly stdin: boolean;
}

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').trim();
};

export const runSecret = async (options: SecretOptions): Promise<ExitCode> => {
  const context = load(options.storeOverride, options.json, 'secret');
  if (context === null) return EXIT.error;

  if (options.action === 'ls') {
    const names = secretNames(context.layout.secrets);
    if (options.json) {
      // Names only. Values never leave this file.
      emitJson('secret', true, { secrets: names });
      return EXIT.ok;
    }
    if (names.length === 0) info('no secrets stored on this device');
    for (const name of names) line(`  ${name}`);
    return EXIT.ok;
  }

  const name = options.name;
  if (name === undefined || !ID_PATTERN.test(name)) {
    failure('a secret name is required, in lowercase kebab-case');
    return EXIT.error;
  }

  if (options.action === 'rm') {
    removeSecret(context.layout.secrets, name);
    if (options.json) emitJson('secret', true, { removed: name });
    else success(`removed secret "${name}" from this device`);
    return EXIT.ok;
  }

  if (!options.stdin && process.stdin.isTTY === true) {
    failure(
      'pipe the value in rather than typing it as an argument, so it stays out of your shell history:\n' +
        `  printf %s "<value>" | agent-sync secret set ${name} --stdin`,
    );
    return EXIT.error;
  }

  const value = await readStdin();
  if (value.length === 0) {
    failure('no value received on stdin');
    return EXIT.error;
  }

  setSecret(context.layout.secrets, name, value);
  if (options.json) emitJson('secret', true, { stored: name });
  else success(`stored secret "${name}" on this device only`);
  return EXIT.ok;
};

/** True when a definition file already exists — used by import to skip duplicates. */
export const definitionExists = (mcpRoot: string, id: string): boolean =>
  existsSync(mcpSourcePath(mcpRoot, id));

export type { McpDefinition };
