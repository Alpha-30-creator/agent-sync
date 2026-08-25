/**
 * What each agent supports and where it keeps things.
 *
 * This is *data*, verified against real installations rather than documentation
 * (docs/02-agent-landscape.md §5a). When a vendor moves something, this table and its
 * `verifiedAgainst` versions are the fix — the core never changes.
 *
 * Pure: locators are functions of MachineFacts, so a Windows layout can be resolved
 * while running on macOS.
 */
import type { DialectSupport } from '../core/mcp/translate.js';
import { joinPath, type MachineFacts, underHome } from '../core/model/machine.js';
import type { AgentId, ArtifactType } from '../core/model/types.js';

/** How an agent's config file is encoded — decides which surgical editor applies. */
export type ConfigFormat = 'json' | 'jsonc' | 'toml';

export interface McpLocation {
  readonly path: string;
  readonly format: ConfigFormat;
  /** Property path (JSON) or table prefix (TOML) holding servers. */
  readonly container: readonly string[];
  /** True when the file holds unrelated user state and must be edited surgically. */
  readonly shared: boolean;
}

export interface AgentCapabilities {
  readonly id: AgentId;
  readonly label: string;
  /** Agent releases these locations were verified against, oldest first. */
  readonly verifiedAgainst: readonly string[];
  readonly supports: Readonly<Record<ArtifactType, boolean>>;
  /** Global (user-scope) skills root, or null when the agent has none. */
  readonly globalSkillsRoot: (facts: MachineFacts) => string | null;
  /** Project-scope skills root, relative to a project directory. */
  readonly projectSkillsRoot: (facts: MachineFacts, projectDir: string) => string;
  /** Directories this agent *also* reads skills from — placement overlap (docs/04 §7). */
  readonly alsoDiscovers: readonly string[];
  readonly globalMcp: (facts: MachineFacts) => McpLocation | null;
  readonly projectMcp: (facts: MachineFacts, projectDir: string) => McpLocation | null;
  /** What this agent's MCP dialect can express. */
  readonly mcpDialect: DialectSupport;
}

export const CAPABILITIES: Readonly<Record<AgentId, AgentCapabilities>> = {
  claude: {
    id: 'claude',
    label: 'Claude Code',
    verifiedAgainst: ['2.1.153', '2.1.245'],
    supports: { skill: true, mcp: true, plugin: true },
    globalSkillsRoot: (f) => underHome(f, '.claude', 'skills'),
    projectSkillsRoot: (f, dir) => joinPath(f, dir, '.claude', 'skills'),
    alsoDiscovers: [],
    // Verified by `claude mcp add --scope user`: a top-level `mcpServers` key,
    // created on demand, inside a ~53 KB file of unrelated user state.
    globalMcp: (f) => ({
      path: underHome(f, '.claude.json'),
      format: 'json',
      container: ['mcpServers'],
      shared: true,
    }),
    // Verified by `claude mcp add --scope project`: a dedicated, shareable file.
    projectMcp: (f, dir) => ({
      path: joinPath(f, dir, '.mcp.json'),
      format: 'jsonc',
      container: ['mcpServers'],
      shared: false,
    }),
    mcpDialect: {
      transports: ['stdio', 'http', 'sse'],
      // Claude Code expands ${VAR} in its own config, so env references stay symbolic.
      expandsEnvReferences: true,
      tweaks: [],
    },
  },
  codex: {
    id: 'codex',
    label: 'OpenAI Codex',
    verifiedAgainst: ['0.134.0', '0.149.1'],
    supports: { skill: true, mcp: true, plugin: true },
    globalSkillsRoot: (f) => underHome(f, '.codex', 'skills'),
    projectSkillsRoot: (f, dir) => joinPath(f, dir, '.codex', 'skills'),
    alsoDiscovers: [],
    // config.toml is Codex's entire state (model, trust levels, plugins, per-OS
    // sections). Codex's own CLI rewrites the whole file when adding a server;
    // agent-sync splices text spans instead (ADR 0007).
    globalMcp: (f) => ({
      path: underHome(f, '.codex', 'config.toml'),
      format: 'toml',
      container: ['mcp_servers'],
      shared: true,
    }),
    projectMcp: (f, dir) => ({
      path: joinPath(f, dir, '.codex', 'config.toml'),
      format: 'toml',
      container: ['mcp_servers'],
      shared: true,
    }),
    mcpDialect: {
      // Codex speaks stdio and streamable HTTP; sse has no equivalent there.
      transports: ['stdio', 'http'],
      expandsEnvReferences: false,
      tweaks: ['startup_timeout_sec', 'tool_timeout_sec', 'enabled'],
    },
  },
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    verifiedAgainst: ['2026.05.09', '2026.08.11'],
    supports: { skill: true, mcp: true, plugin: false },
    globalSkillsRoot: (f) => underHome(f, '.cursor', 'skills'),
    projectSkillsRoot: (f, dir) => joinPath(f, dir, '.cursor', 'skills'),
    // Cursor also reads these project directories, so a skill placed for another
    // agent is visible to Cursor whether or not it was routed there (docs/04 §7).
    alsoDiscovers: ['.claude/skills', '.codex/skills', '.agents/skills'],
    globalMcp: (f) => ({
      path: underHome(f, '.cursor', 'mcp.json'),
      format: 'jsonc',
      container: ['mcpServers'],
      shared: false,
    }),
    projectMcp: (f, dir) => ({
      path: joinPath(f, dir, '.cursor', 'mcp.json'),
      format: 'jsonc',
      container: ['mcpServers'],
      shared: false,
    }),
    mcpDialect: {
      transports: ['stdio', 'http', 'sse'],
      expandsEnvReferences: true,
      tweaks: ['envFile'],
    },
  },
};

export const supportsArtifact = (agent: AgentId, type: ArtifactType): boolean =>
  CAPABILITIES[agent].supports[type];

/** Agents that support a given artifact type — used to filter resolved routes. */
export const agentsSupporting = (type: ArtifactType): readonly AgentId[] =>
  (Object.keys(CAPABILITIES) as AgentId[]).filter((a) => supportsArtifact(a, type));
