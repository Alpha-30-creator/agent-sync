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
  pure TOML text-span splicer + jsonc-parser, verified against real, in-the-wild configs.
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
- ✅ Docs for users: [getting started](../getting-started.md) and the full
  [command reference](../commands.md).
- ✅ Post-M3 fixes: `import` now finds MCP servers configured inside projects and discovers project
  skills without mistaking them for global ones; artifact comparison ignores line endings; `secret
  set` prompts for the value instead of demanding a pipeline.
- 🔄 **M3.5 in progress** — adoption of the tool on a real machine has begun. Two friction points
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

**Finish M3.5 — the acceptance phase** ([roadmap](08-roadmap.md)), where the tool is adopted
for real on both machines.

The blanket "rehearse everything in a sandbox first" rule is **waived** (2026-09-01):
adoption runs against a real `~`. Keep rehearsing new write paths in a sandbox `HOME` before
handing them over — `init --create-remote` was exercised that way, with a stub `gh` and a real
git push — but do not block adoption on a full sandbox pass.

**One setup gap left**, from the first real `init` attempt:

- `agent-sync` is not on `PATH` — the package has never been linked or installed globally, and
  pnpm's global bin dir (`~/Library/pnpm/bin`) is itself missing from `PATH` (only its parent is),
  so `pnpm link --global` alone would not be enough; `pnpm setup` has to run first. Until v1.0
  ships to npm, the rehearsal can also run the built entry point directly
  (`node dist/cli/index.js`).

The second gap from that attempt — the store repository not existing — is now the tool's job
rather than an errand: `init --create-remote agent-library` creates it, pushes, and registers the
device in one command ([ADR 0008](decisions/0008-github-cli-for-remote-creation.md)). It needs the
GitHub CLI, which must be installed and signed in. Note that `gh`
here is configured for **https**, so the remote it writes is the https URL, not ssh.

Then **M4**: the agent-native pieces (the three interface skills, `INSTALL.md`, `setup`, heartbeat
hooks) and OSS packaging for v1.0. **Plugins were cut from v1 on 2026-09-08** — publishing matters
more, nothing in daily use depends on them, and they are the one area still needing fresh research
in two dialects (Q9). They are the first post-v1 candidate; the `plugin` type stays in the schema
and reports `n/a`.

Carried into M4, decided in M3: agent-sync does **not** write Claude's `enabledMcpjsonServers`
approval array. Writing `.mcp.json` leaves a project server pending Claude's own approval prompt,
which is a security decision that belongs to the user. An opt-in flag can come later if the
friction proves real during dogfooding.

**Dogfooding is deliberately deferred to one acceptance phase before v1.0** — the intent is to
adopt the finished tool once, not migrate his real setup at each milestone. Do not stop and ask for
per-milestone dogfooding.

Because that removes the usual early-feedback loop, compensate: build fixtures from the *real*
config shapes captured in `docs/02-agent-landscape.md` §5a/§5b, and keep the rehearsal path
(`--store` + a sandbox `HOME`) working so the full tool can be exercised against a realistic
machine without touching `~`.

## v0.1.0 is published (2026-09-08)

Live on npm as **`@abdur-codes/agent-sync`**, released from CI over OIDC with a SLSA provenance
attestation and no token stored anywhere. The Mac now runs the published package rather than a
linked checkout, and it drives the existing library unchanged.

Three packaging faults were found in the space of one release attempt, all of them invisible to a
green CI run:

1. **npm refuses the name `agent-sync`** — blocked as too similar to `agentsync`, an existing
   package in the same niche. `npm view` returning 404 means *not published*, not *registrable*;
   the similarity check only runs at publish time. Hence the scope ([ADR 0009](decisions/0009-scoped-npm-package.md)).
   The command is still `agent-sync`.
2. **npm stripped the `bin` entry** because of a leading `./` in its path — the one field that
   decides whether installing gives you a command at all.
3. **`smol-toml` was a devDependency while shipped code imported it**, so every install crashed on
   its first command. Found by installing the published bootstrap into an empty directory. The
   suites could not have caught it: they run where dev dependencies exist. There is now a test that
   reads the built output and requires every bare import to be a declared runtime dependency.

The release workflow also failed once on its own tarball check, which read `npm pack --json` —
whose shape differs across npm versions, and the workflow upgrades npm on every run. It lists the
archive now. Nothing was published under the failed tag.

**Note for whoever develops next:** the global `agent-sync` on the Mac is the published package. To
work on the code again, `npm rm -g @abdur-codes/agent-sync` and `pnpm build && npm link` from the
repo.

## Both machines run the published package (2026-09-08)

Windows installed `@abdur-codes/agent-sync@0.1.0` from npm and passes: the `.cmd` shim works from a
normal shell (the earlier junction problem was the cross-drive dev link, never the shim), `doctor`
is healthy, and all twelve artifacts are synced across all three agents. The reverse round-trip is
confirmed from that side too — the marker removal made on the Mac is gone from the store and both
deployed copies there.

Three findings from that run, all now addressed:

1. **`doctor` said "everything looks healthy" with nine artifacts undeployed.** It checked git, the
   store and the agents but never convergence — the one question it is run to answer, and the one
   INSTALL.md tells an agent to trust. It reports pending work now.
2. **Installing a new version deploys nothing** until `setup`/`apply`/`sync`. That is correct — an
   npm install must not write to agent configuration — but it was undocumented, so the upgrade path
   is now written down in [getting started](../getting-started.md).
3. **Removing a dev link after its directory is already gone orphans the shims**, and the next
   global install fails with `EEXIST`. A contributor-path hazard; recorded in `CONTRIBUTING.md`.

A fourth was a stale checkout rather than a defect: the four `agent-sync-dev-*` skills did not
deploy on Windows because that clone predates the committed `.agent-sync.yaml` marker. The marker
is the mechanism that carries project identity between machines; a project's `remote:` field is
only a linking *hint* and never auto-links.

## Acceptance-phase findings (M3.5, from adopting a real machine)

**Drift is dogfooded (2026-09-08).** A hand-edit to a deployed `a-project-debug` was detected on the
next `apply`, which refused with exit 3 and named both ways out; `status` showed `⚠ drifted` for
claude and cursor and `✔ synced` for codex, which had not been touched. The edit and the library
copy were both intact afterwards, and `--overwrite` restored the deployed file byte-for-byte.
Non-negotiable #3 verified outside the test suite.

**MCP is dogfooded (2026-09-08).** `import` adopted Cursor's `Docs by LangChain` as
`mcp/langchain-docs` and it deployed to all three agents, then published for Windows. The
byte-exactness claim is now verified on a real config rather than a fixture: the only change to a
4.3 KB `~/.codex/config.toml` full of comments, env tables and numeric values was the three added
lines of `[mcp_servers.langchain-docs]`. Claude's much larger `~/.claude.json` and Cursor's `mcp.json`
likewise changed only where they had to, and backups were taken before the first edit. `import`
also refused all three of the machine's Codex servers with specific reasons (absolute path,
relative command, needs a `cwd`, switched off) rather than adopting something that could not
travel.

**Fixed in the same pass, all found by adoption rather than by tests:**

- `import --only mcp/<the agent's own name>` matched nothing, adopted nothing and printed
  *nothing at all* before exiting 0 — while the listing that told you to rename showed exactly that
  name. `--only` now accepts either the agent's name or the library id, and an adopt that matches
  nothing says so and exits 1. The old e2e test passed because it used the post-rename id.
- `import` run from the home directory listed everything in the global Cursor/Claude config twice,
  once as global and once as an unregistered project, because in `$HOME` the project-scope path
  resolves to the same file. Comparison is by real path now, since `HOME` may be `/var/...` while
  `cwd` reports `/private/var/...`.
- `doctor` printed Node's DEP0190 security warning on every Windows run: `agentVersion` passed an
  args array together with `shell: true`, which Node deprecated. Windows uses one command string
  now. (The agent that reported it believed the call site was clean — it was not.)
- `link` told you to commit the marker so other devices would link automatically, in a directory
  that is not a repository. It now says so and gives the exact `link <id>` command for the other
  machine, and sends you to `apply` rather than `include` when the project already carries
  artifacts.
- `package.json` had no `packageManager`, so a fresh machine got whatever corepack defaulted to
  (10.6.2 on one machine, 11.x on another). Pinned, and the now-conflicting `version` input
  dropped from the CI workflow.

**The Mac side of M3.5 is done (2026-09-08).** A real project's skills are adopted and live: 8
skills project-scoped to `a-project`, deployed into `.claude/skills` and `.codex/skills` (Cursor is
served by the `.claude` copy), published to the private library remote, and the old
hand-made symlinks in `.cursor/skills`, `.agents/skills` and the `a-project-refine-skill` alias
removed. `apply` is idempotent, `doctor` is healthy. Windows is next.

- **Fixed:** `sync` could not complete on a store created by `init --remote`. It pulled before the
  branch had an upstream, which git rejects outright, so the first sync of a new machine died.
  Never caught because the e2e suite publishes with `save`, which does not pull.
- **Open — project apply silently replaces an unmanaged symlink** with a real directory. The
  content survives (the symlink's target is untouched), but Q10 says third-party symlinks should be
  treated as unmanaged and left alone, or at least reported. Deploying over one is currently
  indistinguishable from deploying into an empty directory.
- **Fixed:** `status` column widths broke when an id was long — the artifact column was a fixed 28
  characters, so `skill/a-project-create-refine-skill` ran into the first status cell and the matrix
  stopped lining up. The column now sizes to the longest id. Notes were also printing
  double-spaced, one blank line each.
- **Fixed:** a skill directory with no `SKILL.md` still cannot enter the library — correct — but
  the adoption showed why that matters: five skills link to a sibling
  `../a-project-shared/reference.md`, so the companion directory had to become a real skill (a
  `SKILL.md` whose body points at `reference.md`) before any of them could be adopted. It works,
  and the relative links resolve in every deployed copy on both platforms. A first-class
  "companion directory" concept is still worth considering.

## Surprises worth remembering

- **Codex's own `codex mcp add` corrupts unrelated config** (drops keys, reorders env tables,
  turns `120` into `120.0`) and removing the server does not undo it. agent-sync's splicer is
  byte-exact — a genuine differentiator worth saying out loud in the README.
- **Claude's `mcpServers` key in `~/.claude.json` is created on demand**; its absence means "no
  servers configured", never "wrong file". Its CLI defaults to `local` scope, which writes
  `projects["<abs path>"].mcpServers`, not the top-level key.
- Claude gates `.mcp.json` servers behind `enabledMcpjsonServers` approval arrays.

- **Windows CI is slow enough to trip vitest's 5s default timeout** on the first e2e test in a
  file — one spawns the CLI which spawns git, and it timed out at 5.6s while passing on every
  other runner; re-running the same commit went green. Timeouts are now 30s (`vitest.config.ts`).
  A red Windows job that mentions a timeout rather than an assertion is this, not a regression.

- **Codex has a plugin system** (`[plugins."id@mkt"]` + `[marketplaces.*]` in `config.toml`) —
  the design docs originally said it didn't. `plugin` is a two-agent artifact type (Q9).
- Third-party tooling already **symlinks** skills from `~/.agents/skills` into `~/.codex/skills`
  and `~/.cursor/skills` on this machine. Import and drift logic must treat those as unmanaged
  and never clobber them (Q10).

## Environment facts (the development machines)

- macOS, Node v25 (CI targets 20/22/24), pnpm via corepack, git 2.50.
- Agents present: `claude`, `codex`, `cursor-agent` all on PATH.
- Repo `agent-sync` (public); the npm name was unclaimed as of 2026-09-08.

## Maintainer-only actions (blocked on a human)

- Install or link the CLI so `agent-sync` resolves on the development machine.
- ~~Windows probe run (M0).~~ Done 2026-08-25.
- npm publish / org creation (M4).
- Anything touching his accounts or making the project's first public announcement.

## Open threads

See `docs/08-roadmap.md` "Open questions" (Q1–Q8). Nothing else outstanding.
