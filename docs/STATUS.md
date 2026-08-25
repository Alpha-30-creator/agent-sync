# STATUS — living handoff

> Purpose: a session with **zero prior context** can read this file and resume correctly.
> Update it at the end of every work session, and before any risky/long operation.

**Last updated:** 2026-08-25
**Current milestone:** M0 — spikes & verification ([roadmap](08-roadmap.md))

## Where things stand

- ✅ Full design doc set written and reviewed (`docs/01`–`09`), name settled as `agent-sync`.
- ✅ Repo scaffolding: TS/ESM, pnpm, vitest, biome, dependency-cruiser, 3-OS CI matrix (20/22/24).
- ✅ First core modules: `Result`, `suggest`, domain types, id/ref parsing (42 tests green).
- ✅ M0 probe tooling (`scripts/probe.mjs`) + **macOS verification done** — findings in `docs/02-agent-landscape.md §5a`.
- ✅ M0 — **Windows verification done**: same `%USERPROFILE%` dot-dir layout as macOS (Q6 resolved).
- ✅ M0 — positive MCP write-target tests done for all Claude scopes + Codex ([landscape §5b](02-agent-landscape.md)).
- ✅ M0 spike 2 — surgical edit strategy settled and implemented ([ADR 0007](decisions/0007-surgical-config-editing.md)):
  pure TOML text-span splicer + jsonc-parser, verified against the owner's real configs.
- ✅ M0 — first `capability-table.ts` with verified paths and `verifiedAgainst` versions.
- ⬜ **M0 is complete. Next: M1** — skills end to end (global scope, 3 agents, 2 devices).

## Next step (do this first)

**M0 is done.** Start M1 — the narrowest full slice: global-scope skills, all three agents, two
devices. Build order:

1. `src/core/model/` manifest + lockfile types and zod schemas; strict validation with located errors.
2. `src/core/resolver/` layers 4→2 (no projects yet) with provenance.
3. `src/core/drift/` + `src/core/planner/` — the seven-row drift table from architecture §6.
4. `src/store/` git wrapper + store layout; `src/shell/fs.ts` atomic writes and hashing.
5. Skill writers for the three agents (global scope) driven by `capability-table.ts`.
6. Commands: `init`, `clone`, `apply`, `status`, `sync`, `add skill`, `new`, `save`, `rm`, `doctor`.

Keep the agent-mode contract from the first command: non-TTY means non-interactive,
`--json` with `schemaVersion`, exit codes 0/1/2/3.

## Surprises worth remembering

- **Codex's own `codex mcp add` corrupts unrelated config** (drops keys, reorders env tables,
  turns `120` into `120.0`) and removing the server does not undo it. agent-sync's splicer is
  byte-exact — a genuine differentiator worth saying out loud in the README.
- **Claude's `mcpServers` key in `~/.claude.json` is created on demand**; its absence means "no
  servers configured", never "wrong file". Its CLI defaults to `local` scope, which writes
  `projects["<abs path>"].mcpServers`, not the top-level key.
- Claude gates `.mcp.json` servers behind `enabledMcpjsonServers` approval arrays.

- **Codex has a plugin system** (`[plugins."id@mkt"]` + `[marketplaces.*]` in `config.toml`) —
  the design docs originally said it didn't. `plugin` is a two-agent artifact type (Q9).
- Third-party tooling already **symlinks** skills from `~/.agents/skills` into `~/.codex/skills`
  and `~/.cursor/skills` on this machine. Import and drift logic must treat those as unmanaged
  and never clobber them (Q10).

## Environment facts (this dev machine)

- macOS, Node v25 (CI targets 20/22/24), pnpm via corepack, git 2.50.
- Agents present: `claude`, `codex`, `cursor-agent` all on PATH.
- GitHub: `Alpha-30-creator`; repo `agent-sync` (public). npm name `agent-sync` is free/unclaimed.

## Owner-only actions (blocked on the human)

- Windows probe run (M0).
- npm publish / org creation (M4).
- Anything touching his accounts or making the project's first public announcement.

## Open threads

See `docs/08-roadmap.md` "Open questions" (Q1–Q8). Nothing else outstanding.
