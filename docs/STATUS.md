# STATUS — living handoff

> Purpose: a session with **zero prior context** can read this file and resume correctly.
> Update it at the end of every work session, and before any risky/long operation.

**Last updated:** 2026-08-25
**Current milestone:** M0 — spikes & verification ([roadmap](08-roadmap.md))

## Where things stand

- ✅ Full design doc set written and reviewed (`docs/01`–`09`), name settled as `agent-sync`.
- ✅ Repo scaffolding: TS/ESM, pnpm, vitest, biome, dependency-cruiser, 3-OS CI matrix (20/22/24).
- ✅ First core modules: `Result`, `suggest`, domain types, id/ref parsing (42 tests green).
- ⬜ M0 spike 1 — landscape re-verification on real machines (Mac done? / Windows pending).
- ⬜ M0 spike 2 — surgical TOML/JSON edit fidelity against real config files.
- ⬜ M1 — skills end to end (global scope, 3 agents, 2 devices).

## Next step (do this first)

Run the M0 verification: probe this Mac's actual agent layouts, then have the owner run
`scripts/probe.mjs` on the Windows machine and paste the JSON back. Record findings in
`docs/02-agent-landscape.md` (resolve every **[verify]** marker) and encode them as the first
`src/adapters/capability-table.ts` with `verifiedAgainst` versions.

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
