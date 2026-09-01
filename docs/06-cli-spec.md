# CLI Specification

The complete command surface for v1. Conventions first, then each command with its flags and behavior, then example sessions showing the intended feel.

---

## 1. Conventions

- Binary: `agent-sync`. Global flags: `--store <path>` (override store location), `--verbose` (print decision provenance), `--json` (machine-readable output for `status`/`doctor`/`apply --dry-run`), `--yes` (assume-yes for prompts; refuses to auto-resolve drift unless paired with `--adopt` or `--overwrite`), `--no-color`.
- Every mutating command supports `--dry-run` and prints the same plan it would execute ([Architecture §5](03-architecture.md)).
- Artifact references are `type/id` (`skill/db-migrate`, `mcp/github`, `plugin/my-toolkit`); bare ids are accepted when unambiguous.
- Exit codes: `0` ok / nothing to do; `1` error; `2` converged-with-warnings; `3` drift or conflicts require decisions (useful in scripts/CI).
- Commands run from anywhere; commands that take a project context infer it from cwd when inside a linked project (overridable with `--project <id>`).

- **Agent-mode contract** (see [Agent-Native §4.2](09-agent-native.md)): when stdout is not a TTY, no command ever prompts — it exits 3 with JSON naming the flag that answers the question. All `--json` output carries `schemaVersion` and provenance data. Secret values are never accepted via argv.

## 2. Setup & sync commands

### `agent-sync setup [--hooks] [--remote <git-url>] [--clone <git-url>]`
Machine onboarding and repair, for humans and agents ([Agent-Native §3](09-agent-native.md)): install/confirm CLI, run `init` or `clone`, probe agents, write `device.yaml`, deploy the interface skill pack into every detected agent, and (with `--hooks`, opt-in) install session-start heartbeat hooks for agents that support them. Idempotent — re-run any time to converge a machine's installation.

### `agent-sync init [--remote <git-url>] [--create-remote <name> [--public]]`
Create the canonical store (default `~/.agent-sync/store`), `git init`, write starter manifest + store README, optionally set remote. Also writes `~/.agent-sync/device.yaml` after asking for a device name and probing which agents are installed.

`--remote` points at a repository that already exists. `--create-remote` takes a *name* (`agent-library`, or `owner/agent-library`), makes the repository through the GitHub CLI, sets it as `origin`, and pushes the first commit — so first-machine setup is one command and no browser tab ([ADR 0008](decisions/0008-github-cli-for-remote-creation.md)). Repositories are private unless `--public` is passed, and the remote URL follows the protocol `gh` is configured for. The two flags are mutually exclusive. Every reason the creation could fail (no `gh`, not signed in, a name the forge would reject, a repository already there) is checked *before* the store is written, so a rejected invocation leaves nothing behind.

### `agent-sync clone <git-url>`
Second-machine onboarding: clone the store, create `device.yaml` (probe agents, name device), then print next steps (`link` your projects, `apply`).

### `agent-sync sync [--no-push] [--no-apply]`
The daily loop: commit local store changes → pull --rebase → `apply` → push. Git conflicts stop the pipeline with artifact-level explanation and standard git resolution instructions; `agent-sync sync --continue` resumes after resolution.

### `agent-sync apply [--dry-run] [--agent <a>...] [--project <id>...] [--adopt|--overwrite]`
Converge this device to the manifest. Filters restrict the plan to given agents/projects. Drift prompts per [Architecture §6](03-architecture.md); `--adopt`/`--overwrite` set a blanket answer for non-interactive use.

### `agent-sync status [--why] [--project <id>]`
Read-only matrix of deployments and their state. `--why` appends provenance per cell.

```
$ agent-sync status
skill                claude        codex         cursor
  db-migrate         ✔ synced      ✔ synced      ✔ synced
  commit-style       ✔ synced      – excluded    – excluded
  review-checklist   ⟳ outdated    ⟳ outdated    ⚠ drifted
mcp
  github             ✔ synced      – excluded    ✔ synced
  heavy-profiler     – excluded    ✔ synced      – excluded
plugin
  my-toolkit         ✔ enabled     n/a           n/a

project acme-app (~/dev/acme-app)
  skill/db-migrate   – excluded    ✔ synced      ✔ synced
  skill/scratch-notes  – excluded  – excluded    ✔ synced

2 outdated, 1 drifted → run `agent-sync apply`
```

### `agent-sync heartbeat`
The ambient-sync probe run by session-start hooks (installable by humans too, e.g. from a scheduler): fast staleness check; pull + apply **only when conflict-free**; auto-register the current project via its marker file; print one-line notices for anything needing judgment (drift, conflicts, unmanaged artifacts). Never resolves drift unattended. See [Agent-Native §5](09-agent-native.md).

### `agent-sync doctor`
Diagnostics, no writes: agents detected (binaries + config dirs) vs `device.yaml`; store git health (remote, ahead/behind, dirty); unmanaged agent config that `import` could adopt; capability-table version vs detected agent layouts; secrets file permissions; public-repo credential heuristic ([Architecture §11](03-architecture.md)).

## 3. Library commands

Every mutating library command finishes according to the store's `autoSync` setting (`full` = apply + commit + push, default; `apply`; `off`) — one command is a complete transaction ([Agent-Native §5](09-agent-native.md), tier 0).

### `agent-sync new skill <id> [--targets ...] [--scope ...] [--project <id>]`
Scaffold a new empty skill **in the store** (template `SKILL.md`, manifest entry) and print its path (`--json` for agents). Authoring happens directly in the store — the artifact is born synced; finish with `save`. This is the first step of the flagship agent flow ([Agent-Native §4.1](09-agent-native.md)).

### `agent-sync save [<ref>] [--message <msg>]`
The transaction-closer: validate the artifact(s), apply, commit, push — one command, safe to re-run (offline push failures are reported and retried by the next heartbeat/sync). With no `<ref>`, saves all pending store changes.

### `agent-sync add skill <path> [--id <id>] [--targets <a,...>] [--scope global|project] [--project <id>]`
Copy an *existing* skill folder into the store, register it in the manifest (with optional layer-2 rule), then run apply for it. Validates `SKILL.md` frontmatter. (For creating from scratch, use `new`.)

### `agent-sync add mcp [<name>] [--from <agent>] [--command ...|--url ...] [--env K=V|K=${secret:x}...] [--targets ...]`
Create a canonical MCP definition — interactively, from flags, or by importing an existing definition from one agent's config (`--from cursor`). Values that look secret trigger a prompt to convert to `${secret:...}` and store the value in the device secrets file.

### `agent-sync add plugin <plugin>@<marketplace> [--scope ...]`
Register a Claude plugin declaration.

### `agent-sync rm <ref>` / `agent-sync mv <ref> <new-id>`
Remove (or rename) an artifact: store + manifest + a plan that cleans up deployed copies the lockfile owns (with confirmation). Never touches drifted or unmanaged files without asking.

### `agent-sync edit <ref>`
Open the artifact (skill folder / canonical YAML) in `$EDITOR`; on close, validate and offer `apply`.

### `agent-sync import [--agent <a>] [--project <id>]`
Onboarding workhorse: scan agent homes (and the current project if linked) for skills/MCP servers/plugins not in the library; interactive picker; adopts selections via the `add` machinery, records existing deployed copies in the lockfile as already-synced.

## 4. Routing & scope commands

All of these are sugar over manifest edits (comment-preserving YAML update), followed by an offer to apply.

```
agent-sync route <ref> --targets claude,cursor            # layer 2
agent-sync route <ref> --project acme --targets cursor    # layer 1
agent-sync route <ref> --project acme --add codex         # layer 1, relative
agent-sync route --type skill --targets all               # layer 4
agent-sync route --type skill --project acme --targets cursor   # layer 3
agent-sync route <ref> --clear [--project acme]           # delete a rule (fall up the ladder)
```

### `agent-sync link [<project-id>]` / `unlink`
Run inside a project directory: register cwd as `<project-id>` (default: directory name) in `device.yaml`, create the project entry in the manifest if new, and write the committed `.agent-sync.yaml` marker + record the git remote hint ([Sync Model §3a](04-sync-model.md)). On other devices the marker makes linking automatic — any agent-sync command (including `heartbeat`) run inside the checkout registers the path. `unlink` removes the device mapping only (the marker stays with the repo).

### `agent-sync include <ref> [--private]` / `exclude <ref>`
Manage a project's `include` list from inside the project.

### `agent-sync disable <ref>` / `enable <ref>`
Per-device mask in `device.yaml` ([Sync Model §2](04-sync-model.md)).

### `agent-sync secret set <name>` / `secret ls`
Manage the device secrets file (values prompted, never echoed, never in argv history via flag).

## 5. Example sessions

**First machine:**

```
$ agent-sync init --create-remote agent-library --device "macbook"
✔ store created at ~/.agent-sync/store
✔ created private repository abdur/agent-library and pushed your library to it
✔ device registered as "macbook" — detected: claude, codex, cursor
$ agent-sync import
found 12 skills, 5 mcp servers, 2 plugins across 3 agents — select to adopt… ✔ adopted 14
$ agent-sync sync
✔ pushed 14 artifacts
```

**Second machine (Windows):**

```
> agent-sync clone git@github.com:abdur/agent-library.git
✔ device registered as "win-desktop" — detected: claude, cursor  (codex: not found)
> agent-sync apply
plan: 26 writes across claude, cursor  (codex: masked — not installed)
✔ converged in 0.4s
```

**The scenario from the PRD:**

```
$ cd ~/dev/acme-app && agent-sync link acme-app
$ agent-sync route --type skill --project acme-app --targets cursor
$ agent-sync include skill/db-migrate
$ agent-sync route skill/db-migrate --project acme-app --add codex
$ agent-sync apply --dry-run
acme-app:
  + write .cursor/skills/db-migrate/        (project default: cursor)
  + write .codex/skills/db-migrate/         (override: +codex)
  ⚠ cursor also discovers .codex/skills — single copy strategy: keeping both (targets require both agents)
```

## 6. Non-interactive & scripting

Every prompt has a flag equivalent; `--json` output is stable and versioned (`"schemaVersion"` field) so shell scripts and future GUIs can build on it. A `agent-sync sync` cron/launchd/Task-Scheduler recipe ships in the README post-v1 — but scheduled runs use `--dry-run`-then-notify semantics for drift rather than auto-resolving (never destroy work unattended).
