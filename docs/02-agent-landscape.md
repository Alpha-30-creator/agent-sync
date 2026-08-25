# Agent Landscape

**Ground truth for the adapters.** This document records where each supported agent stores skills, MCP configuration, and plugins, and what capabilities each agent has. Everything in [Architecture](03-architecture.md) and the adapter implementations derives from this table.

> ⚠️ **Volatility warning.** All three agents ship fast and move their config around. This doc reflects research as of **August 2026** and must be re-verified against each agent's current release at the start of implementation (and encoded as a versioned capability table in code, not prose — see [Architecture §8](03-architecture.md)). Items marked **[verify]** are the ones most likely to have shifted.

---

## 1. The three artifact types, briefly

- **Skill** — a directory containing a `SKILL.md` file (YAML frontmatter: `name`, `description`; markdown body: instructions) plus optional supporting files/scripts. Originated with Claude Code; now a de-facto cross-agent standard adopted by both Codex and Cursor. **This is the best news for this project: the artifact format is already portable. Only discovery locations differ.**
- **MCP server definition** — how to launch/connect to a Model Context Protocol server: a command + args + env (stdio) or a URL + headers (HTTP/SSE). Conceptually identical across agents; syntactically different everywhere.
- **Plugin** — a Claude Code bundle (skills, slash commands, hooks, MCP servers, agents) installed from a "marketplace" (a git repo with a manifest). No Codex or Cursor equivalent exists.

## 2. Claude Code

| Concern | Global (user) scope | Project scope |
|---------|--------------------|---------------|
| Skills | `~/.claude/skills/<name>/SKILL.md` | `<project>/.claude/skills/<name>/SKILL.md` |
| MCP | `~/.claude.json` (user-scope servers, plus per-project state) | `<project>/.mcp.json` — key: `mcpServers` (shareable, checked in); "local" scope lives in `~/.claude.json` under the project's entry |
| Plugins | Installed under `~/.claude/plugins/` (marketplace clones + `installed_plugins.json` state); enabled via `enabledPlugins` map in `settings.json` (`"plugin@marketplace": true`) | `<project>/.claude/settings.json` can carry `enabledPlugins` and `extraKnownMarketplaces` for the project |
| Settings files | `~/.claude/settings.json` | `<project>/.claude/settings.json` (+ `.claude/settings.local.json`, gitignored) |

**MCP JSON shape (Claude):**

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    },
    "linear": { "type": "http", "url": "https://mcp.linear.app/mcp" }
  }
}
```

**Notes for the adapter:**
- `~/.claude.json` is a large mixed-purpose file (it also holds onboarding state, per-project history, etc.). The adapter must edit **only** the `mcpServers` keys it manages and leave everything else byte-stable. Project `.mcp.json` is simpler and effectively ours to manage (still merge-don't-replace: users may have unmanaged servers there).
- Plugin *state* (`installed_plugins.json`, marketplace clones) is machine-local cache. What agent-sync syncs is the *declaration*: marketplace source + plugin id + enabled state + scope. On apply, the adapter reconciles by invoking `claude plugin install/enable` (CLI available) or by writing the settings entries and letting Claude Code fetch. **[verify]** the exact non-interactive install path at implementation time.
- Skills support nesting and symlinks, but see [Architecture §6](03-architecture.md) for why we copy regardless.

## 3. OpenAI Codex (CLI / IDE extension / app)

| Concern | Global (user) scope | Project scope |
|---------|--------------------|---------------|
| Skills | `~/.codex/skills/<name>/SKILL.md` | `<project>/.codex/skills/<name>/SKILL.md` |
| MCP | `~/.codex/config.toml` under `[mcp_servers.<name>]` tables | `<project>/.codex/config.toml` (trusted projects only) **[verify]** |
| Plugins | ❌ No plugin system | — |

**MCP TOML shape (Codex):**

```toml
[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
env = { "GITHUB_TOKEN" = "..." }

[mcp_servers.linear]
url = "https://mcp.linear.app/mcp"
# optional: enabled = false, startup_timeout_sec, tool_timeout_sec
```

**Notes for the adapter:**
- `config.toml` is Codex's *entire* configuration — model, approval policy, everything. The adapter must do **surgical TOML editing**: touch only `[mcp_servers.*]` tables that agent-sync manages (tracked in the lockfile), preserve all other content and, as far as the TOML library allows, comments and formatting. This is the highest-risk write path in the whole system; it gets the heaviest testing.
- Codex shares this config across CLI, IDE extension, and the ChatGPT desktop app — one write covers all Codex surfaces. 
- Codex supports `enabled = false` per server — maps cleanly onto agent-sync's per-device disable (FR-11).
- Skills: Codex discovers any directory containing `SKILL.md` under the skills roots; same format as Claude. There is also a `$skill-installer` flow — irrelevant to us; we place files directly.

## 4. Cursor (editor + `cursor-agent` CLI)

| Concern | Global (user) scope | Project scope |
|---------|--------------------|---------------|
| Skills | `~/.cursor/skills/<name>/SKILL.md` **[verify]** | `<project>/.cursor/skills/` — and Cursor *also* reads `.agents/skills/`, `.claude/skills/`, `.codex/skills/` |
| MCP | `~/.cursor/mcp.json` — key: `mcpServers` | `<project>/.cursor/mcp.json` |
| Plugins | ❌ No plugin system (open feature request) | — |
| Rules (context) | — | `.cursor/rules/*.mdc`, `AGENTS.md` (not an artifact type in v1) |

**MCP JSON shape (Cursor):** same `mcpServers` object shape as Claude Code's, with minor extension differences (e.g. Cursor supports `type: "sse"`, an `envFile` field). Treat as a sibling dialect, not the identical format.

**Notes for the adapter:**
- Cursor reading `.claude/skills/` and `.codex/skills/` in projects creates an **overlap hazard**: if agent-sync deploys a project skill to Claude *and* Cursor, writing it to both `.claude/skills/` and `.cursor/skills/` may make Cursor see it twice, and routing "Claude only" may still expose it to Cursor. The resolver must model *discovery* (what an agent can see) separately from *placement* (where we write). Rule of thumb for v1: project-scope skills are written once to a preferred location per the routing set, using the overlap matrix in the capability table; when true exclusion is impossible (Cursor reads Claude's directory), `status`/`apply` say so honestly rather than pretending. See [Sync Model §7](04-sync-model.md).
- Global skills directory support in Cursor is newer and the exact path/behavior must be re-verified **[verify]**; if a given Cursor version lacks a global skills dir, the adapter degrades: global-scope skills routed to Cursor are deployed into each *linked project's* `.cursor/skills/` instead (the capability table drives this).

## 5. Capability matrix

| Capability | Claude Code | Codex | Cursor |
|---|---|---|---|
| `SKILL.md` skills — project scope | ✅ `.claude/skills` | ✅ `.codex/skills` | ✅ `.cursor/skills` (+ reads `.claude`/`.codex`/`.agents` skills) |
| Skills — global scope | ✅ `~/.claude/skills` | ✅ `~/.codex/skills` | ✅ **[verify path]** |
| MCP — project scope | ✅ `.mcp.json` (JSON) | ✅ `.codex/config.toml` (TOML) **[verify]** | ✅ `.cursor/mcp.json` (JSON) |
| MCP — global scope | ✅ `~/.claude.json` (JSON, shared file) | ✅ `~/.codex/config.toml` (TOML, shared file) | ✅ `~/.cursor/mcp.json` (JSON, dedicated file) |
| MCP stdio servers | ✅ | ✅ | ✅ |
| MCP remote servers | ✅ http/sse | ✅ streamable http | ✅ http/sse |
| Per-server enable/disable | ✅ (via config) | ✅ `enabled = false` | ✅ (UI toggle; config presence) |
| Plugins | ✅ marketplaces + `enabledPlugins` | ❌ | ❌ |
| CLI for scripted management | ✅ `claude mcp ...`, `claude plugin ...` | ✅ `codex mcp ...` | ⚠️ partial |

**Consequences for the design:**

1. **Skills are fully portable** → the skill artifact is stored once, byte-identical, and copied to N locations. No translation layer needed.
2. **MCP needs a canonical schema + three serializers** → see [Architecture §7](03-architecture.md). The canonical schema is a superset; when a field doesn't map to a target agent (e.g. Cursor's `envFile` has no Codex equivalent), apply emits a capability warning instead of failing or silently dropping.
3. **Plugins are a cross-device story only** → the plugin artifact type routes exclusively to Claude Code; the routing engine treats agent support as a constraint, and `status` shows plugins as `n/a` (not "missing") for Codex/Cursor.
4. **Two shared-file formats must be edited surgically** (`~/.claude.json`, `config.toml`); two are dedicated-file formats we can own more confidently (`.mcp.json`, `mcp.json`) but still merge rather than replace.

## 6. Sources

- [Cursor Docs — Agent Skills](https://cursor.com/docs/skills)
- [Cursor Docs — Using Agent in CLI](https://cursor.com/docs/cli/using)
- [OpenAI — Codex skills](https://developers.openai.com/codex/skills.md) and [openai/skills catalog](https://github.com/openai/skills)
- [OpenAI — Codex MCP](https://developers.openai.com/codex/mcp)
- [Composio — How to set up MCPs with Codex CLI](https://composio.dev/content/how-to-mcp-with-codex)
- [Claude Code Docs — Discover and install plugins](https://code.claude.com/docs/en/discover-plugins)
- [Understanding enabledPlugins in Claude Code](https://thejavaguy.org/posts/025-understanding-enabledplugins-in-claude-code/)
- [Skills in OpenAI Codex — blog.fsck.com](https://blog.fsck.com/2025/12/19/codex-skills/)
- [Cursor forum — Agent Plugins feature request](https://forum.cursor.com/t/agent-plugins-isolated-packaging-lifecycle-management-for-sub-agents-skills-hooks-rules-incl-agent-md-across-cursor-ide-cli/151250)
