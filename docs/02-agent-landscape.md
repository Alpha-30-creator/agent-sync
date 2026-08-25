# Agent Landscape

**Ground truth for the adapters.** This document records where each supported agent stores skills, MCP configuration, and plugins, and what capabilities each agent has. Everything in [Architecture](03-architecture.md) and the adapter implementations derives from this table.

> ⚠️ **Volatility warning.** All three agents ship fast and move their config around. This doc reflects research as of **August 2026** and must be re-verified against each agent's current release at the start of implementation (and encoded as a versioned capability table in code, not prose — see [Architecture §8](03-architecture.md)). Items marked **[verify]** are the ones most likely to have shifted.

---

## 1. The three artifact types, briefly

- **Skill** — a directory containing a `SKILL.md` file (YAML frontmatter: `name`, `description`; markdown body: instructions) plus optional supporting files/scripts. Originated with Claude Code; now a de-facto cross-agent standard adopted by both Codex and Cursor. **This is the best news for this project: the artifact format is already portable. Only discovery locations differ.**
- **MCP server definition** — how to launch/connect to a Model Context Protocol server: a command + args + env (stdio) or a URL + headers (HTTP/SSE). Conceptually identical across agents; syntactically different everywhere.
- **Plugin** — a bundle (skills, slash commands, hooks, MCP servers, agents) installed from a "marketplace". Claude Code and **Codex** both have one (verified on a real machine, 2026-08-25); the two use different manifests and storage, so plugins are portable in *concept* but not as files. Cursor has no equivalent (open feature request).

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
| Skills | `~/.codex/skills/<name>/SKILL.md` ✔ verified | `<project>/.codex/skills/<name>/SKILL.md` |
| MCP | `~/.codex/config.toml` under `[mcp_servers.<name>]` tables ✔ verified | `<project>/.codex/config.toml` (trusted projects only) **[verify]** |
| Plugins | ✔ **Codex has plugins** — `[plugins."<id>@<marketplace>"] enabled = true` plus `[marketplaces.<name>]` (`source_type`, `source`, `last_updated`) in `config.toml` | **[verify]** |

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
| Skills | `~/.cursor/skills/<name>/SKILL.md` ✔ verified | `<project>/.cursor/skills/` — and Cursor *also* reads `.agents/skills/`, `.claude/skills/`, `.codex/skills/` |
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
| Skills — global scope | ✅ `~/.claude/skills` | ✅ `~/.codex/skills` | ✅ `~/.cursor/skills` (verified) |
| MCP — project scope | ✅ `.mcp.json` (JSON) | ✅ `.codex/config.toml` (TOML) **[verify]** | ✅ `.cursor/mcp.json` (JSON) |
| MCP — global scope | ✅ `~/.claude.json` (JSON, shared file) | ✅ `~/.codex/config.toml` (TOML, shared file) | ✅ `~/.cursor/mcp.json` (JSON, dedicated file) |
| MCP stdio servers | ✅ | ✅ | ✅ |
| MCP remote servers | ✅ http/sse | ✅ streamable http | ✅ http/sse |
| Per-server enable/disable | ✅ (via config) | ✅ `enabled = false` | ✅ (UI toggle; config presence) |
| Plugins | ✅ marketplaces + `enabledPlugins` (JSON) | ✅ `[plugins."id@mkt"]` + `[marketplaces.*]` (TOML) | ❌ |
| CLI for scripted management | ✅ `claude mcp ...`, `claude plugin ...` | ✅ `codex mcp ...` | ⚠️ partial |

**Consequences for the design:**

1. **Skills are fully portable** → the skill artifact is stored once, byte-identical, and copied to N locations. No translation layer needed.
2. **MCP needs a canonical schema + three serializers** → see [Architecture §7](03-architecture.md). The canonical schema is a superset; when a field doesn't map to a target agent (e.g. Cursor's `envFile` has no Codex equivalent), apply emits a capability warning instead of failing or silently dropping.
3. **Plugins are a cross-device story only** → the plugin artifact type routes exclusively to Claude Code; the routing engine treats agent support as a constraint, and `status` shows plugins as `n/a` (not "missing") for Codex/Cursor.
4. **Two shared-file formats must be edited surgically** (`~/.claude.json`, `config.toml`); two are dedicated-file formats we can own more confidently (`.mcp.json`, `mcp.json`) but still merge rather than replace.

## 5a. Verified findings (M0 probe)

Run `node scripts/probe.mjs` on any machine; it reports layout and file *shape* only (never
contents), so its output is safe to paste into an issue.

**macOS, 2026-08-25** — verified against Claude Code `2.1.153`, `codex-cli 0.134.0`,
`cursor-agent 2026.05.09` (these become the `verifiedAgainst` values in the capability table):

| Finding | Consequence |
|---|---|
| `~/.cursor/skills` exists | Resolves open question Q1: Cursor has a global skills dir; no per-project degradation needed |
| `~/.codex/skills`, `~/.claude/skills` exist as expected | Skill placement confirmed for all three agents |
| **Codex has a plugin system** (`[plugins."x@mkt"]`, `[marketplaces.*]` in `config.toml`) | Contradicts earlier research. `plugin` is a two-agent artifact type — see open question Q9 |
| Codex `config.toml` also holds `[projects."<abs path>"]` (with `trust_level`), `[features]`, `[desktop.*]`, model settings | Confirms the surgical-edit requirement: this one file is Codex's entire state, including absolute paths that must never be synced |
| `~/.claude.json` is ~52 KB of mixed state (9 project entries, onboarding/telemetry caches) with **no** `mcpServers` key on this machine | Confirms the highest-risk write target. Where Claude puts *global* MCP servers still needs a positive test — add one via `claude mcp add` and re-probe |
| `~/.codex/skills/<name>` and `~/.cursor/skills/<name>` are **symlinks** into `~/.agents/skills/` (created by another skills tool) | Two consequences: (a) `import`/drift logic must recognize symlinked entries as *unmanaged* and never clobber them; (b) `~/.agents/skills` is an emerging shared convention worth supporting as a placement target |
| Codex `config.toml` currently has no comments | Slightly lowers TOML round-trip risk for this user, but the requirement stands for everyone else |

**Windows 11 (10.0.22631), 2026-08-25** — verified against Claude Code `2.1.245`,
`codex-cli 0.149.1`, `cursor-agent 2026.08.11`:

| Finding | Consequence |
|---|---|
| All three agents use `%USERPROFILE%` dot-directories, exactly as on macOS: `C:\Users\<u>\.claude\`, `.claude.json`, `.codex\`, `.cursor\` | **Resolves Q6.** No `%APPDATA%` variants for agent *config* — locators differ only by separator and home resolution, not by layout |
| The one `%APPDATA%` hit is `AppData\Roaming\Cursor` — Electron app state (`Cache`, `IndexedDB`, `languagepacks.json`, `Backups`) | Editor application state, **not** agent config. Never a deployment target; `doctor` should not report it as a candidate |
| `~/.claude/skills`, `~/.claude/plugins`, and `~/.cursor/skills` **do not exist** on this machine | Agents create these lazily. Writers must create the full directory chain, and their absence means "no skills yet", never "agent missing" — agent detection keys on the CLI/config, not on skill dirs |
| Codex on Windows also carries `[plugins."…@…"]` + `[marketplaces.*]`, plus a platform-specific `[windows]` table | Confirms the Codex plugin system is not a macOS-only preview (Q9). The `[windows]` table is another region of `config.toml` the surgical editor must leave alone |
| Codex `config.toml` has **no** `projects.*` tables here (macOS has 8) | Those accrue with use; project-scope Codex behaviour must be probed on a machine that has them |
| `~/.claude.json` again has **no** `mcpServers` key (35 KB of other state) | Claude's global MCP location remains unconfirmed on *both* machines — the positive test (add a server via `claude mcp add`, re-probe) is still the outstanding M0 item |
| `~/.agents/skills` does not exist here, though it does on macOS | The shared-convention directory is created by third-party tooling, not by the agents. Support it opportunistically (Q10); never assume it |
| Agent versions differ across the owner's own two machines (Claude 2.1.153 vs 2.1.245, codex 0.134.0 vs 0.149.1, cursor-agent May vs Aug) | `verifiedAgainst` in the capability table must be a *range or list*, not a single version, and `doctor` should flag an installed version outside the verified set rather than assuming the layout holds |

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
