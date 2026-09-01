# STATUS — living handoff

> Purpose: a session with **zero prior context** can read this file and resume correctly.
> Update it at the end of every work session, and before any risky/long operation.

**Last updated:** 2026-09-01
**Current milestone:** M3.5 — acceptance / dogfooding ([roadmap](08-roadmap.md))

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
- ✅ **M0 complete.**
- ✅ **M3 complete** — MCP servers end to end: canonical schema with `${secret:}` / `${env:}`
  indirection, three dialect translators with capability warnings, surgical writers for all four
  config shapes, device-only secret storage, `add mcp`, `secret set/rm/ls`, and `import` for
  onboarding an existing machine. Credentials never enter the git-backed library.
- ✅ **M2 complete** — projects and the full ladder: `.agent-sync.yaml` marker with
  auto-registration, resolver layers 3 and 1, project-scope deployment with minimum-copy placement
  for Cursor's cross-agent discovery, and `link`/`unlink`/`include`/`exclude`/`route`/`disable`/
  `enable`. The PRD scenario (project default cursor-only, one skill also on codex) is an e2e test.
- ✅ **M1 complete** — skills end to end. Manifest schema + two-pass validation, the precedence
  resolver with provenance, drift classification, the pure planner, git-backed store, lockfile,
  atomic-write shell, and the CLI (`init`, `clone`, `apply`, `status`, `sync`, `add skill`,
  `new skill`, `save`, `rm`, `doctor`). CI green on 3 OSes.
- ✅ Docs for users: [getting started](10-getting-started.md) and the full
  [command reference](11-command-reference.md).
- ✅ Post-M3 fixes: `import` now finds MCP servers configured inside projects and discovers project
  skills without mistaking them for global ones; artifact comparison ignores line endings; `secret
  set` prompts for the value instead of demanding a pipeline.
- 🔄 **M3.5 in progress** — the owner has begun adopting the tool on the Mac. Two friction points
  found immediately: the CLI is not installed as a global command (see *Next step*), and `init`
  silently assumed the store repository already existed. The second is fixed — `init
  --create-remote <name>` now creates it via `gh`, pushes, and registers the device in one command
  ([ADR 0008](decisions/0008-github-cli-for-remote-creation.md)).

**Verified green on 2026-09-01** (re-run, not inherited from an earlier session): `typecheck`
clean; `check:deps` clean (52 modules, no violations); **386 tests across 23 files**; `build` +
CLI smoke good. The `--create-remote` e2e drives the real CLI against a stub `gh` that makes real
bare repositories, so the push is genuinely exercised without touching GitHub; it is POSIX-only,
because Node will not spawn the `.cmd` shim Windows would need for a stub on `PATH`.

Known cosmetic issue: `pnpm lint` emits 23 `noTemplateCurlyInString` warnings, every one a false
positive on the deliberate `${secret:…}` / `${env:…}` indirection literals. Worth a Biome override
so real findings are not buried.

## Next step (do this first)

**Finish M3.5 — the acceptance phase** ([roadmap](08-roadmap.md)), where the owner adopts the tool
for real on both machines. Rehearse against a sandbox `HOME` seeded from the probe output first;
nothing touches `~` until that is clean.

**One setup gap left**, from the owner's first real `init` attempt:

- `agent-sync` is not on `PATH` — the package has never been linked or installed globally, and
  pnpm's global bin dir (`~/Library/pnpm/bin`) is itself missing from `PATH` (only its parent is),
  so `pnpm link --global` alone would not be enough; `pnpm setup` has to run first. Until v1.0
  ships to npm, the rehearsal can also run the built entry point directly
  (`node dist/cli/index.js`).

The second gap from that attempt — the store repository not existing — is now the tool's job
rather than an errand: `init --create-remote agent-library` creates it, pushes, and registers the
device in one command ([ADR 0008](decisions/0008-github-cli-for-remote-creation.md)). It needs the
GitHub CLI, which is installed and signed in as `Alpha-30-creator` on this Mac. Note that `gh`
here is configured for **https**, so the remote it writes is the https URL, not ssh.

Then **M4**: plugin declarations (Claude *and* Codex — see Q9), the agent-native pieces (the three
interface skills, `INSTALL.md`, `setup`, heartbeat hooks), and OSS packaging for v1.0.

Carried into M4, decided in M3: agent-sync does **not** write Claude's `enabledMcpjsonServers`
approval array. Writing `.mcp.json` leaves a project server pending Claude's own approval prompt,
which is a security decision that belongs to the user. An opt-in flag can come later if the
friction proves real during dogfooding.

**Dogfooding is deliberately deferred to one acceptance phase before v1.0** — the owner wants to
adopt the finished tool once, not migrate his real setup at each milestone. Do not stop and ask for
per-milestone dogfooding.

Because that removes the usual early-feedback loop, compensate: build fixtures from the *real*
config shapes captured in `docs/02-agent-landscape.md` §5a/§5b, and keep the rehearsal path
(`--store` + a sandbox `HOME`) working so the full tool can be exercised against a realistic
machine without touching `~`.

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

- Install/link the CLI so `agent-sync` resolves on this Mac (M3.5): `pnpm setup`, then
  `pnpm build && pnpm link --global`.
- ~~Windows probe run (M0).~~ Done 2026-08-25.
- npm publish / org creation (M4).
- Anything touching his accounts or making the project's first public announcement.

## Open threads

See `docs/08-roadmap.md` "Open questions" (Q1–Q8). Nothing else outstanding.
