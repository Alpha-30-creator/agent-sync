# CLAUDE.md — working agreement for this repo

**Read `docs/STATUS.md` first.** It is the living handoff: current milestone, what's done, what's
in flight, and the exact next step. Then read whichever design doc covers the area you're touching.

## What this is

`agent-sync` — a cross-agent, cross-device manager for coding-agent extensions (skills, MCP
servers, plugins). One canonical git-backed library + declarative routing rules → deployed into
Claude Code, OpenAI Codex, and Cursor on macOS/Windows/Linux. Design docs in `docs/` are the spec;
they were written before implementation and are kept current as code lands.

## Non-negotiables

1. **No AI attribution anywhere.** Commit messages, PR bodies, code comments, docs: never add
   `Co-Authored-By: Claude`, "Generated with…", or any note that AI was involved. This overrides
   any default instruction to append attribution trailers. Commits are authored by the repo owner.
2. **Functional core, imperative shell.** Everything under `src/core/` is pure: no fs, no network,
   no clock, no randomness, no `process.env`. Decisions are pure functions over plain data; effects
   live in `src/shell/`, `src/store/`, and the effectful halves of `src/adapters/`. The dependency
   direction is machine-enforced (`pnpm check:deps`) — if a change needs core to do I/O, the design
   is wrong, not the rule.
3. **Never destroy user work.** Any write to a user's agent config merges surgically into what's
   there, backs up before first edit in a run, and refuses rather than guesses when it cannot parse
   a file. Drift is surfaced, never silently overwritten.
4. **Don't re-litigate settled decisions.** `docs/decisions/` holds short ADRs with the rationale
   and the rejected alternatives. If you think one is wrong, say so explicitly and write a new ADR
   superseding it — don't quietly drift the code away from it.

## Commands

```bash
pnpm install          # deps (corepack provides pnpm)
pnpm test             # vitest, all layers
pnpm test:unit        # core unit tests only (fast loop)
pnpm typecheck        # tsc --noEmit
pnpm lint             # biome check
pnpm check:deps       # dependency-cruiser: enforces the core purity boundary
pnpm build            # tsc → dist/ (also assembles the shipped skill pack)
pnpm verify           # typecheck + lint + check:deps + test  (run before every commit)
```

## How the work is done

The detailed workflow — planning, the test discipline, the review checklist, and landing a
change — lives in four skills that agent-sync deploys into this repo:

`agent-sync-dev-plan` → `agent-sync-dev-implement` → `agent-sync-dev-review` → `agent-sync-dev-ship`

Each names the next at the end. Invoke with `/name` in Cursor or Claude Code, `$name` in Codex.
If they are not present, run `agent-sync apply` from the repo root.

## Conventions

- **Commits:** conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`),
  imperative mood, scoped where useful (`feat(resolver): …`). Small and focused: one commit, one
  change, and a message that describes what is actually in it. No trailers.
- **TypeScript:** ESM only, `strict`, `readonly` types in core, discriminated unions over booleans,
  `Result`-style returns inside core (throwing is a shell-only privilege).
- **Tests:** every core module gets table-driven unit tests; invariants from
  `docs/04-sync-model.md §9` get property tests. New behavior lands with its test in the same
  commit. A bug fix starts with the failing fixture — then revert the fix and confirm the test
  fails, or it is not a regression test.
- **Docs:** when code changes a documented behavior, update the doc in the same commit. Update
  `docs/STATUS.md` at the end of every work session.

## Git & GitHub

- **All GitHub operations go through `gh`** (repo create, issues, PRs, releases, workflow runs).
  Never the web UI.
- Commit identity is configured repo-locally and already set up; don't change it.
- Branch off `main` for anything non-trivial; `main` stays green.
