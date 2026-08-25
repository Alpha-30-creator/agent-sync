# Product Requirements Document

**Product:** agent-sync
**Status:** Draft v1
**Author:** Abdur Rahman Saad
**Last updated:** 2026-08-25

---

## 1. Problem statement

Developers increasingly use *multiple* coding agents side by side — picking Claude Code, OpenAI Codex, or Cursor depending on the task, the project, or simply mood. All three agents are extended the same three ways:

- **Skills** — folders containing a `SKILL.md` (plus supporting files) that teach the agent a reusable workflow. All three agents now support the same `SKILL.md` format, but each discovers skills from its *own* directories.
- **MCP servers** — Model Context Protocol servers giving agents access to external tools. All three agents support MCP, but each configures it in a *different file and format* (two JSON dialects and one TOML).
- **Plugins** — bundles of skills/commands/hooks/MCP config. Currently a Claude Code concept with no equivalent in Codex or Cursor.

This creates two compounding problems:

**Problem A — cross-agent drift.** A skill written for Claude Code doesn't exist in Codex or Cursor until manually copied. An MCP server added to Cursor must be hand-translated into Codex's TOML. Configuration diverges silently; the user never knows which agent has which capabilities.

**Problem B — cross-device drift.** The same user works on a Mac and a Windows machine. Even for a *single* agent, there is no built-in way to keep skills and MCP config in sync between machines. Every improvement made on one machine is missing on the other.

Today the "solution" is manual copying, ad-hoc dotfile repos with symlink scripts, or simply living with drift. None of these handle format translation, per-project scoping, or per-artifact routing.

## 2. Vision

One canonical, git-versioned library of agent extensions, with declarative routing rules that say *which* artifacts appear in *which* agents at *which* scope — and a single command that makes every machine converge to that declaration.

The user's mental model shifts from "I configured Cursor on my Mac" to "I own a library of capabilities, and I decide where they show up."

## 3. Target users

### Primary persona: the multi-agent power user

- Uses 2–3 coding agents interchangeably (Claude Code, Codex, Cursor).
- Works on 2+ machines across OSes (macOS + Windows is the canonical pair; Linux must also work).
- Authors their own skills; accumulates MCP servers and plugins.
- Comfortable with git and a CLI; allergic to cloud accounts for local tooling.

### Secondary persona: the team lead (post-v1)

- Wants to distribute a curated set of skills/MCP servers to a team.
- Same mechanics (a shared canonical repo), different trust and review needs.
- Explicitly **out of scope for v1**, but the architecture must not preclude it.

## 4. Goals

| # | Goal | Measure of success |
|---|------|--------------------|
| G1 | Sync skills, MCP servers, and plugins across devices | Edit on machine A, `sync` on machine B, artifact present and correct |
| G2 | Manage artifact availability per agent | A new skill appears in all 3 agents (or exactly the subset the rules say) after one `apply` |
| G3 | Layered preferences: global defaults → project defaults → per-artifact overrides | The worked examples in [Sync Model](04-sync-model.md) all resolve correctly |
| G4 | Cross-platform: macOS, Windows, Linux | CI green on all three; no platform-conditional user workflow |
| G5 | Modular, pure, well-practiced codebase | Core is 100% pure functions; adapters isolated; see [Architecture](03-architecture.md) |
| G6 | Proper test suite | See [Testing Strategy](07-testing.md); core at ~100% branch coverage |
| G7 | Open-source ready | MIT license, contributor docs, no proprietary dependencies, no telemetry by default |
| G8 | Agent-native: agents install, operate, and stay synced through agent-sync with **one human action per intent** | "Create me a skill" in any agent yields a created, deployed, committed, pushed artifact in one conversational request; see [Agent-Native](09-agent-native.md) |

## 5. Non-goals (v1)

- **No hosted service.** No accounts, no server, no cloud storage owned by the project. Git (any remote the user chooses) is the transport.
- **No skill marketplace / discovery.** agent-sync manages *your* library; finding new skills is other tools' job.
- **No team/multi-user features.** Single user, multiple devices.
- **No agent-conversation features.** agent-sync manages configuration at rest; it never talks to the agents at runtime.
- **No sync of agent settings beyond skills/MCP/plugins.** Themes, keybindings, model choices, `AGENTS.md`/`CLAUDE.md` memory files — out of scope for v1 (candidate for later; the artifact model is designed to be extensible).
- **No secrets syncing.** Secrets are referenced, never stored or transported. This is a feature, not a limitation.
- **No GUI.** CLI first. A TUI/GUI can come later on top of the same core.

## 6. User stories

### Epic 1 — Library and cross-device sync

- **US-1.1** As a user, I can `agent-sync init` to create my canonical store and connect it to a git remote I own.
- **US-1.2** As a user, I can `agent-sync add skill ./my-skill` to bring an existing skill folder into the library.
- **US-1.3** As a user, I can `agent-sync add mcp` to capture an MCP server definition once, in a canonical format.
- **US-1.4** As a user on a second machine, I can `agent-sync clone <repo>` and then `agent-sync apply` to get my entire setup.
- **US-1.5** As a user, `agent-sync sync` pulls remote changes, re-applies locally, and pushes my local changes — one command for the daily loop.
- **US-1.6** As a user, I can `agent-sync import` to scan my machine for *existing* skills and MCP configs in all three agents and adopt them into the library (crucial for onboarding — nobody starts from zero).

### Epic 2 — Cross-agent routing

- **US-2.1** As a user, when I add a skill with default settings, it becomes available in all three agents after `apply`.
- **US-2.2** As a user, I can set a **global default** per artifact type, e.g. "skills go to all agents; MCP servers go to Claude Code and Cursor only."
- **US-2.3** As a user, I can set a **project default**, e.g. "in project `acme-app`, skills sync only to Cursor."
- **US-2.4** As a user, I can set a **per-artifact override**, e.g. "in `acme-app`, the skill `db-migrate` also goes to Codex" — overriding the project default for that one artifact.
- **US-2.5** As a user, I can `agent-sync status` to see a matrix of artifact × agent × scope showing what is deployed where, and what's out of date.

### Epic 3 — Scoping

- **US-3.1** As a user, I can mark artifacts **global** (available everywhere) or **project-scoped** (deployed only into a given project's directories).
- **US-3.2** As a user, I can `agent-sync link` inside a project directory to register that directory as a known project on this device (project identity is stable across devices even though paths differ).
- **US-3.3** As a user, a project-scoped skill deploys into the project's agent directories (`.claude/skills/`, `.codex/skills/`, `.cursor/skills/`) so it travels with the repo checkout — respecting the routing rules.

### Epic 4 — Safety and trust

- **US-4.1** As a user, if I hand-edited a deployed file, `apply` detects the drift and asks: adopt my edit back into the library, or overwrite it — never silently clobber.
- **US-4.2** As a user, `agent-sync apply --dry-run` shows me exactly what would change before anything is touched.
- **US-4.3** As a user, my MCP secrets (API keys in `env` blocks) are stored per-device in a gitignored file and merged in at apply time; they never enter the git repo.
- **US-4.4** As a user, `agent-sync doctor` diagnoses my setup: missing agents, unmanaged config, git state, permission problems.

### Epic 5 — Agent-native operation ([full design](09-agent-native.md))

- **US-5.1** As a user, I can paste one line into any of my agents and have the agent install and set up agent-sync for me (prerequisite checks, init/clone interview, verification via `doctor`).
- **US-5.2** As a user, setup installs a agent-sync interface skill into all my agents, so every agent knows how to create skills, add MCP servers, change routing, and sync — conversationally.
- **US-5.3** As a user, saying "create a skill that does X" to any agent results in the skill being authored in the store, deployed to the routed agents, committed, and pushed — one request, zero follow-up commands.
- **US-5.4** As a user, every mutating command is a complete transaction (apply + commit + push by default), so there is never a separate "now sync it" step.
- **US-5.5** As a user, I can opt into session-start hooks so my agents quietly pull-and-apply when it's safe, and *tell me in conversation* when something needs my judgment (drift, conflicts, unmanaged artifacts) — never resolving those unattended.
- **US-5.6** As a user, everything the agents can do, I can do myself with the same CLI — agent-native is additive, never required.

## 7. Functional requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Canonical store: a git-repo directory holding all artifacts + manifest | Must |
| FR-2 | Artifact types: `skill`, `mcp`, `plugin` (extensible enum) | Must |
| FR-3 | Adapters for Claude Code, Codex, Cursor (skills + MCP each; plugins where supported) | Must |
| FR-4 | Scope model: `global` and `project`; project identity portable across devices | Must |
| FR-5 | Routing precedence: per-artifact-per-project > per-artifact > project default > global default > built-in default | Must |
| FR-6 | Idempotent `apply` with dry-run and drift detection (hash lockfile) | Must |
| FR-7 | MCP format translation: canonical ⇄ Claude JSON, Cursor JSON, Codex TOML | Must |
| FR-8 | Secrets referenced via `${env:VAR}` / per-device secrets file, never synced | Must |
| FR-9 | `import` to adopt pre-existing agent config into the library | Must |
| FR-10 | `status` matrix view; `doctor` diagnostics | Must |
| FR-11 | Per-device overrides (e.g. an MCP server disabled on the work laptop) | Should |
| FR-12 | Claude Code plugin sync across devices (marketplace + enabled state, declaratively) | Should |
| FR-13 | Conflict handling on `sync` (git conflicts surfaced with guidance, artifact-level resolution helpers) | Should |
| FR-14 | Watch mode (`apply --watch`) re-applying on store changes | Could |
| FR-15 | Extraction of skills from Claude plugins for projection into other agents | Could (post-v1) |
| FR-16 | Agent-driven install: agent-readable `INSTALL.md` + idempotent `setup` command that deploys the interface skill pack to all detected agents | Must |
| FR-17 | Interface skill pack (three intent-split built-in artifacts, all `agent-sync`-prefixed: `agent-sync-create-skill`, `agent-sync-add-mcp`, `agent-sync`) + agent-mode CLI contract: non-interactive when non-TTY, `--json` with `schemaVersion`, exit-code contract, no secrets via argv | Must |
| FR-18 | Transactional auto-sync: mutating commands end apply+commit+push per `autoSync` setting; `new` + `save` commands for the create-flow | Must |
| FR-19 | `heartbeat` + opt-in session-start hooks (Claude Code, Cursor): conflict-free convergence only; judgment calls surfaced into conversation, never auto-resolved | Should |
| FR-20 | Committed project marker `.agent-sync.yaml` for automatic cross-device project registration; git-remote match as suggestion fallback | Must |

## 8. Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | **Cross-platform:** identical behavior on macOS, Windows, Linux. No symlink dependence (Windows symlinks require elevation/dev-mode); paths handled abstractly; CRLF-safe. |
| NFR-2 | **Purity:** all planning/resolution logic is pure (no I/O, no clock, no randomness). Effects confined to a thin shell. |
| NFR-3 | **Idempotence:** `apply` twice = `apply` once. Every mutation is convergent. |
| NFR-4 | **Non-destruction:** never delete or overwrite unmanaged or drifted files without explicit consent. Writes to shared agent config files (e.g. Codex's `config.toml`, which holds more than MCP config) must surgically edit only managed sections and preserve everything else, including comments where the format allows. |
| NFR-5 | **Performance:** `status`/`apply` complete in under ~1s for a library of hundreds of artifacts. (It's file hashing and small-file writes; this is easily met and worth stating so it stays true.) |
| NFR-6 | **Observability:** `--verbose` explains every decision the resolver made ("skill X → cursor only, because project default in acme-app"). Users must be able to answer *why* something deployed where it did. |
| NFR-7 | **No telemetry** by default. Open-source hygiene: license, changelog, semver. |
| NFR-8 | **Resilience to agent evolution:** agent formats/locations are isolated in adapters + a versioned capability table, so an agent changing its layout is a one-module fix. |

## 9. Key design decisions (summary — details in linked docs)

| Decision | Choice | Why (short) | Doc |
|----------|--------|-------------|-----|
| Sync transport | User-owned git repo | Free, versioned, offline-capable, no infra to run, natural for the audience | [Architecture §4](03-architecture.md) |
| Deploy mechanism | Copy + hash lockfile (no symlinks) | Windows symlink restrictions; agents/watchers behave better with real files; enables drift detection | [Architecture §6](03-architecture.md) |
| Canonical MCP format | Neutral schema, translated per agent | One definition, three outputs; superset-with-capability-warnings | [Architecture §7](03-architecture.md) |
| Manifest format | YAML with strict schema validation | Human-editable, comment-friendly; validated hard at load | [Sync Model](04-sync-model.md) |
| Language | TypeScript / Node.js | Audience alignment, ecosystem, velocity; see full trade-off analysis | [Tech Stack](05-tech-stack.md) |
| Agent interface | Self-hosted skill pack + agent-run installer + opt-in hooks | Agents are the primary UI; the CLI remains the complete fallback | [Agent-Native](09-agent-native.md) |
| Project identity | Committed `.agent-sync.yaml` marker; per-device path registry | Identity travels with the repo; paths never leave the device | [Sync Model §3a](04-sync-model.md) |

## 10. Success metrics (post-launch)

- **Time-to-parity:** minutes from fresh machine to fully configured (target: < 5 min including git clone).
- **Convergence trust:** zero reported cases of silent data loss (drifted file overwritten without consent).
- **Adoption signal:** GitHub stars/issues from multi-agent users; skills-adjacent communities linking to it.
- **Dogfood test:** the author's own Mac + Windows setup runs entirely through agent-sync within one week of v0.2.

## 11. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Agent vendors change config locations/formats | High (they do, constantly) | Medium | Adapter isolation (NFR-8); capability table versioned per agent; `doctor` detects unknown layouts |
| Agents gain native sync (vendor lock-in flavored) | Medium | Medium | agent-sync's value is *cross*-agent; a single vendor's sync doesn't cover it |
| Shared-file editing bugs (e.g. corrupting Codex `config.toml`) | Medium | High | Surgical managed-section editing, backup before write, round-trip tests, atomic writes |
| Windows path/permission edge cases | High | Medium | Windows CI from day one (G4), no symlinks, `%USERPROFILE%` handling in one module |
| Scope creep toward marketplace/team features | Medium | Medium | Non-goals section; roadmap gates |

## 12. Open questions

Tracked in [Roadmap §Open questions](08-roadmap.md). Highlights: exact handling of Cursor global skills directory (verify against current Cursor release during implementation), whether `AGENTS.md`/rules files become a fourth artifact type, and how far plugin→skill extraction should go.
