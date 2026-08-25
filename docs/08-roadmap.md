# Roadmap

Milestones sized for a single maintainer with dogfooding as the forcing function. Each milestone ends with something the author actually uses daily — the fastest way to find out which design assumptions are wrong.

---

## M0 — Spikes & verification (≈ 1 week)

De-risk the two things the whole design leans on, before writing product code.

- [x] **Probe tooling:** `scripts/probe.mjs` reports layout + file shape (never contents) on any OS.
- [x] **Landscape verification — macOS:** all three agents probed; Cursor global skills dir confirmed (Q1 resolved); **Codex plugin system discovered** (Q9 raised); symlinked third-party skills found in the wild (Q10 raised). Recorded in [Agent Landscape §5a](02-agent-landscape.md).
- [ ] **Landscape verification — Windows:** owner runs `node scripts/probe.mjs --json` on the Windows machine; record results and resolve Q6.
- [ ] **Positive MCP tests:** add a throwaway server via each agent's own CLI/UI, re-probe, and confirm exactly which file each agent writes (the Mac has no Claude MCP servers configured, so its location is still unconfirmed).
- [ ] Encode all of the above as the first `capability-table.ts` with `verifiedAgainst` versions.
- [ ] **TOML surgical-edit spike:** take the author's real Codex `config.toml`; upsert/delete `[mcp_servers.*]` tables via candidate libraries; measure fidelity of everything else (comments, ordering, formatting). Pick the approach ([Tech Stack §3](05-tech-stack.md)). Same exercise for `~/.claude.json` with jsonc-parser (expected easy; confirm).
- [ ] Scaffold: repo, pnpm, TS strict, Biome, Vitest, dependency-cruiser rule, 3-OS CI running one trivial test.

**Exit:** all [verify] markers resolved; write path proven safe on real config files; CI matrix green.

## M1 — Skills, end to end (v0.1) (≈ 2 weeks)

The narrowest full slice: **global-scope skills, all three agents, two devices.**

- [ ] Core model + manifest parsing/validation (skills only), resolver layers 4→2 (no projects yet)
- [ ] Store init/clone/sync (git wrapper), lockfile, drift classification, planner, apply pipeline with dry-run
- [ ] Skill deployment writers for all three agents (global scope)
- [ ] Commands: `init`, `clone`, `sync`, `apply`, `status`, `add skill`, `new`, `save`, `rm`, `doctor` (minimal)
- [ ] Agent-mode CLI contract from day one: non-TTY ⇒ non-interactive, `--json` + `schemaVersion`, exit codes; transactional `autoSync` ([Agent-Native §4.2, §5 tier 0](09-agent-native.md))
- [ ] Test layers 1–2 for everything above; e2e scenarios 1, 2, 4

**Exit:** the author's skills are managed by agent-sync on both machines. *Dogfood begins.*

## M2 — Projects & full routing (v0.2) (≈ 2 weeks)

- [ ] Project model: `link`/`unlink`, `include`/`exclude`, resolver layers 3 and 1, `add`/`remove` modifiers, device masks (`disable`/`enable`)
- [ ] `.agent-sync.yaml` project marker + auto-registration + git-remote suggestion ([Sync Model §3a](04-sync-model.md))
- [ ] First cut of the interface skill pack (`agent-sync-create-skill` + the `agent-sync` manager's routing/status flows) and `setup` deploying it — dogfood the "create me a skill" flow early, it will reshape the CLI ergonomics
- [ ] Project-scope skill deployment incl. the Cursor overlap/minimum-copy strategy + honest `status` reporting
- [ ] `route` command family; `status --why` provenance output
- [ ] Property-test suite for the resolver invariants
- [ ] e2e scenario 3 (the PRD scenario)

**Exit:** the full precedence ladder works and is explainable; the original requirement §2 example is a passing test *and* the author's real acme-equivalent project runs on it.

## M3 — MCP (v0.3) (≈ 2–3 weeks; the grind)

- [ ] Canonical MCP schema + zod validation; secrets file + `${secret:}`/`${env:}` indirection; `secret` commands
- [ ] Translators + round-trip property tests for the three dialects
- [ ] Surgical writers: `.mcp.json`, `~/.claude.json`, `.cursor/mcp.json`, `~/.cursor/mcp.json`, `config.toml` (global + project) — with backup-on-write and refuse-on-unparseable
- [ ] `add mcp` (flags, interactive, `--from <agent>`); capability warnings end-to-end
- [ ] `import` for MCP + skills (the onboarding scan)
- [ ] Skill pack: add-mcp reference incl. the secrets protocol (user runs `secret set` themselves)

**Exit:** zero hand-edited MCP config on either of the author's machines.

## M4 — Plugins + polish → public v1.0 (≈ 2 weeks)

- [ ] Plugin declarations; Claude reconciliation (CLI-first, settings-edit fallback); `n/a` semantics in status
- [ ] `heartbeat` + hook installers for Claude Code and Cursor (`setup --hooks`); `INSTALL.md` agent runbook + paste-line install tested end-to-end from all three agents
- [ ] `doctor` full checks; `edit`, `mv`; `--json` outputs; smoke checklist doc
- [ ] OSS packaging: LICENSE (MIT), CONTRIBUTING.md, issue templates, README quickstart rewritten from real usage, changesets release pipeline, npm publish with provenance
- [ ] A short screencast/GIF for the README (the status matrix sells the tool)

**Exit:** `npm i -g agent-sync` works for a stranger; announce.

## Post-v1 candidates (unordered, demand-driven)

- **Rules/memory artifact type:** `AGENTS.md` / `CLAUDE.md` / `.cursor/rules` as a fourth artifact with per-agent projection — most-requested-likely feature; excluded from v1 to keep scope honest.
- **Plugin skill extraction:** project skills bundled inside Claude plugins into Codex/Cursor.
- **`apply --watch`**, shell completions, `agent-sync diff <ref>`.
- **New agents:** Gemini CLI, Windsurf, etc. — each is a capability-table entry + adapter ([Architecture §8](03-architecture.md)).
- **Team mode:** shared store repo with read-only consumption + local overlay. Big; needs its own PRD.
- Homebrew/Scoop/winget distribution.

## Open questions

| # | Question | Blocking | Current lean |
|---|----------|----------|--------------|
| Q1 | Cursor global skills: exact path & discovery semantics in current release | M0 | Table-driven; degrade to per-project deployment if absent |
| Q2 | Codex project-scope `config.toml`: trust-gating behavior and whether project MCP is respected | M0 | Verify; if unreliable, project-scope MCP for Codex becomes a capability gap (warn) |
| Q3 | Claude plugin install non-interactively: CLI flags vs settings-write-and-let-fetch | M4 | CLI-first |
| Q4 | Should `sync` auto-commit store changes, or require explicit `agent-sync commit` for users who want curated history? | M1 | Auto-commit with generated messages; `--no-commit` escape hatch |
| Q5 | Manifest ergonomics: is the YAML nesting depth acceptable in practice, or does v1.1 need a flatter rule syntax? | dogfood | Decide from real usage, not speculation |
| Q6 | Windows: any agent storing per-user config under `%APPDATA%` rather than `%USERPROFILE%` dot-dirs? | M0 | Verify on the real Windows machine; encode in locators |
| Q7 | Cursor hooks: are the v1.7+ hook events stable/rich enough for the heartbeat, or is Cursor tier-0-only at launch? | M4 | Verify during M4; Claude Code hooks are the reference implementation either way |
| Q9 | Codex plugins: how do `[plugins."id@mkt"]` + `[marketplaces.*]` behave (install path, non-interactive enable, marketplace `source_type` values)? Can one plugin declaration target both Claude and Codex, or do they need per-agent sources? | M4 | Model `plugin` as a two-agent type with per-agent source fields; verify before building the adapter |
| Q10 | Should `~/.agents/skills` (shared convention seen in the wild, read by Cursor) be a first-class placement target that satisfies several agents at once? | M2 | Probably yes for project scope — it is exactly the minimum-copy strategy; verify which agents read it |
| Q8 | Skill-pack activation quality: do the three intent-split skills (`agent-sync-create-skill`, `agent-sync-add-mcp`, `agent-sync`) trigger reliably in all three agents — especially the two interceptors, which must beat the agent's native instinct? | dogfood (M2) | Three intent-based skills ([Agent-Native §4](09-agent-native.md)); tune descriptions on observed misses, merge only if redundant |
