#!/usr/bin/env node
/**
 * agent-sync landscape probe (M0).
 *
 * Reports WHERE each coding agent stores skills, MCP config, and plugins on this machine,
 * and the SHAPE of those files — never their contents. Values are replaced by type
 * descriptors, so the output is safe to paste into an issue or a chat.
 *
 * Usage:  node scripts/probe.mjs                     # human-readable
 *         node scripts/probe.mjs --json              # machine-readable to stdout
 *         node scripts/probe.mjs --out probe.json    # machine-readable to a UTF-8 file
 *
 * Prefer --out on Windows: PowerShell's `>` redirect writes UTF-16, which is awkward
 * to read back and lands in git as a binary blob.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, platform, release } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const asJson = process.argv.includes('--json');
const outIndex = process.argv.indexOf('--out');
const outPath = outIndex === -1 ? null : process.argv[outIndex + 1];
const IS_WINDOWS = platform() === 'win32';

const describe = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === 'object') return `object{${Object.keys(value).join(',')}}`;
  return typeof value;
};

const safe = (fn) => {
  try {
    return fn();
  } catch (error) {
    return `<${String(error.code ?? error.message ?? error)}>`;
  }
};

/** Version of an agent CLI, if it is on PATH. */
const cliVersion = (bin) =>
  safe(() =>
    execFileSync(bin, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
      shell: IS_WINDOWS,
    }).trim().split('\n')[0],
  );

const look = (path) => {
  if (!existsSync(path)) return { path, exists: false };
  const linkStat = lstatSync(path);
  if (linkStat.isSymbolicLink()) {
    return { path, exists: true, kind: 'symlink', target: safe(() => readlinkSync(path)) };
  }
  const stat = statSync(path);
  if (stat.isDirectory()) {
    let entries = [];
    try {
      entries = readdirSync(path, { withFileTypes: true }).map((e) => {
        const full = join(path, e.name);
        const link = e.isSymbolicLink();
        // Third-party tooling symlinks skills between agent dirs; agent-sync must
        // recognise those as unmanaged rather than clobbering them.
        return {
          name: e.name,
          kind: link ? 'symlink' : e.isDirectory() ? 'dir' : 'file',
          ...(link ? { target: safe(() => readlinkSync(full)) } : {}),
          hasSkillMd: existsSync(join(full, 'SKILL.md')),
        };
      });
    } catch (error) {
      return { path, exists: true, kind: 'dir', error: String(error.message ?? error) };
    }
    return { path, exists: true, kind: 'dir', entryCount: entries.length, entries };
  }
  return { path, exists: true, kind: 'file', bytes: stat.size, shape: shapeOf(path) };
};

/** Structure only: key names and value *types*. No values, no secrets. */
const shapeOf = (path) => {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { error: String(error.message ?? error) };
  }

  if (path.endsWith('.toml')) {
    const tables = [...text.matchAll(/^\s*\[([^\]]+)\]/gm)].map((m) => m[1]);
    const topKeys = [...text.matchAll(/^\s*([A-Za-z_][\w-]*)\s*=/gm)].map((m) => m[1]);
    return {
      format: 'toml',
      tables,
      topLevelKeys: [...new Set(topKeys)],
      hasComments: /^\s*#/m.test(text),
      mcpServerTables: tables.filter((t) => t.startsWith('mcp_servers')),
    };
  }

  try {
    const parsed = JSON.parse(text);
    const shape = { format: 'json', topLevelKeys: Object.keys(parsed) };
    const servers = parsed.mcpServers;
    if (servers && typeof servers === 'object') {
      shape.mcpServers = Object.fromEntries(
        Object.entries(servers).map(([name, def]) => [
          name,
          def && typeof def === 'object'
            ? Object.fromEntries(Object.entries(def).map(([k, v]) => [k, describe(v)]))
            : describe(def),
        ]),
      );
    }
    if (parsed.enabledPlugins) shape.enabledPlugins = Object.keys(parsed.enabledPlugins);
    if (parsed.extraKnownMarketplaces) shape.extraKnownMarketplaces = Object.keys(parsed.extraKnownMarketplaces);
    return shape;
  } catch {
    return { format: 'unparsed', firstLine: text.split('\n')[0]?.slice(0, 40) ?? '' };
  }
};

const APPDATA = process.env.APPDATA ?? '';
const LOCALAPPDATA = process.env.LOCALAPPDATA ?? '';

/**
 * Windows question (roadmap Q6): do any agents store per-user config under
 * %APPDATA%/%LOCALAPPDATA% rather than %USERPROFILE% dot-directories?
 */
const windowsRoots = () => {
  if (!IS_WINDOWS) return null;
  const out = {};
  for (const [label, base] of [['APPDATA', APPDATA], ['LOCALAPPDATA', LOCALAPPDATA]]) {
    if (base === '') continue;
    for (const name of ['Claude', 'claude', 'Claude Code', 'Codex', 'codex', 'Cursor', 'cursor', 'anthropic', 'OpenAI']) {
      const candidate = join(base, name);
      if (existsSync(candidate)) out[`${label}/${name}`] = look(candidate);
    }
  }
  return out;
};

const report = {
  probeVersion: 2,
  system: {
    platform: platform(),
    release: release(),
    node: process.version,
    home: HOME,
    ...(IS_WINDOWS ? { appData: APPDATA, localAppData: LOCALAPPDATA } : {}),
  },
  cliVersions: {
    claude: cliVersion('claude'),
    codex: cliVersion('codex'),
    'cursor-agent': cliVersion('cursor-agent'),
    git: cliVersion('git'),
  },
  agents: {
    claude: {
      skillsGlobal: look(join(HOME, '.claude', 'skills')),
      mcpGlobal: look(join(HOME, '.claude.json')),
      settings: look(join(HOME, '.claude', 'settings.json')),
      pluginsDir: look(join(HOME, '.claude', 'plugins')),
    },
    codex: {
      skillsGlobal: look(join(HOME, '.codex', 'skills')),
      config: look(join(HOME, '.codex', 'config.toml')),
    },
    cursor: {
      skillsGlobal: look(join(HOME, '.cursor', 'skills')),
      mcpGlobal: look(join(HOME, '.cursor', 'mcp.json')),
      cursorDir: look(join(HOME, '.cursor')),
    },
  },
  // Shared cross-agent convention used by third-party skill installers.
  sharedAgentsDir: look(join(HOME, '.agents', 'skills')),
  windowsRoots: windowsRoots(),
};

if (outPath) {
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${outPath} (UTF-8). Structure only — no file contents, no secrets.`);
} else if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`agent-sync probe — ${report.system.platform} ${report.system.release}, node ${report.system.node}`);
  console.log('(structure only: no file contents, no secrets)\n');
  console.log('agent CLIs:');
  for (const [bin, version] of Object.entries(report.cliVersions)) {
    console.log(`  ${bin.padEnd(14)} ${version}`);
  }
  console.log();
  for (const [agent, places] of Object.entries(report.agents)) {
    console.log(`${agent}:`);
    for (const [what, info] of Object.entries(places)) {
      const detail = !info.exists
        ? 'missing'
        : info.kind === 'dir'
          ? `dir, ${info.entryCount} entries`
          : `file, ${info.bytes}b, ${info.shape?.format ?? '?'}`;
      console.log(`  ${what.padEnd(14)} ${detail}  ${info.path}`);
    }
    console.log();
  }
  const shared = report.sharedAgentsDir;
  console.log(`shared ~/.agents/skills: ${shared.exists ? `${shared.entryCount} entries` : 'missing'}`);
  if (report.windowsRoots) {
    const keys = Object.keys(report.windowsRoots);
    console.log(`windows app-data dirs: ${keys.length > 0 ? keys.join(', ') : 'none found'}`);
  }
  console.log('\nFull detail: node scripts/probe.mjs --json');
}
