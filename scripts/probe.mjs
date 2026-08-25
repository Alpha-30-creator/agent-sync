#!/usr/bin/env node
/**
 * agent-sync landscape probe (M0).
 *
 * Reports WHERE each coding agent stores skills, MCP config, and plugins on this machine,
 * and the SHAPE of those files — never their contents. Values are replaced by type
 * descriptors, so the output is safe to paste into an issue or a chat.
 *
 * Usage:  node scripts/probe.mjs            # human-readable
 *         node scripts/probe.mjs --json     # machine-readable
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir, platform, release } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const asJson = process.argv.includes('--json');

const describe = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === 'object') return `object{${Object.keys(value).join(',')}}`;
  return typeof value;
};

const look = (path) => {
  if (!existsSync(path)) return { path, exists: false };
  const stat = statSync(path);
  if (stat.isDirectory()) {
    let entries = [];
    try {
      entries = readdirSync(path, { withFileTypes: true }).map((e) => ({
        name: e.name,
        kind: e.isDirectory() ? 'dir' : 'file',
        hasSkillMd: e.isDirectory() && existsSync(join(path, e.name, 'SKILL.md')),
      }));
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

const report = {
  probeVersion: 1,
  system: { platform: platform(), release: release(), node: process.version, home: HOME },
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
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`agent-sync probe — ${report.system.platform} ${report.system.release}, node ${report.system.node}`);
  console.log('(structure only: no file contents, no secrets)\n');
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
  console.log('Full detail: node scripts/probe.mjs --json');
}
