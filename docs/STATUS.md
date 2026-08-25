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
- ⬜ M0 — positive MCP location tests (add a dummy server per agent, re-probe).
- ⬜ M0 spike 2 — surgical TOML/JSON edit fidelity against real config files.
- ⬜ M1 — skills end to end (global scope, 3 agents, 2 devices).

## Next step (do this first)

Finish M0: (1) positive MCP location tests — add a throwaway MCP server through each agent's own
CLI, re-run the probe, and record which file actually changed; (2) the TOML/JSON surgical-edit
spike against the real `~/.codex/config.toml` (4 KB, holds Codex's entire state) and
`~/.claude.json` (52 KB of mixed state); (3) encode everything as
`src/adapters/capability-table.ts` with `verifiedAgainst` versions. Windows probe is owner-blocked
and can land in parallel.

## Surprises worth remembering

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
