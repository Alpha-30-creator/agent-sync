# Architecture

How agent-sync is built: the components, the data flow, and the reasoning behind each structural decision. Read [Agent Landscape](02-agent-landscape.md) first — the constraints there drive most of the choices here.

---

## 1. Architectural style: functional core, imperative shell

The single most important structural rule in this codebase:

> **Every decision is a pure function. Every effect is a dumb executor.**

agent-sync's job is fundamentally: *read state → decide what should change → change it*. We split that hard:

- **Core (pure):** takes plain-data snapshots (manifest, lockfile, observed file state, machine facts) and returns plain-data outputs (a resolved routing table, a plan of operations, diagnostics). No filesystem, no git, no clock, no environment reads, no randomness. Deterministic: same inputs → same outputs, always.
- **Shell (effectful):** two thin layers around the core. *Readers* snapshot the world into plain data (read files, hash them, ask git for status). *Executors* carry out a plan (write file, delete file, run git command) with no decision-making beyond error handling.

Why this matters here specifically:

1. **Testability (G5, G6):** the hairy logic — precedence resolution, drift classification, plan generation, format translation — is tested with plain-data in/out, no mocks, no temp dirs, on any OS. Cross-platform bugs concentrate in the small shell, which is where integration tests focus.
2. **Trust:** `--dry-run` is free and *exactly* truthful — it's the real plan, just not executed. A tool that rewrites agent config files needs this property structurally, not aspirationally.
3. **Explainability (NFR-6):** because resolution is a pure function over explicit inputs, every routing decision can carry its provenance ("matched project-default rule at `projects.acme.defaults.skill`") at no extra cost.

```
                    ┌───────────────────────────── shell (I/O) ─┐
   filesystem ──▶  READERS  ──▶ ┌──────────────────┐            │
   git        ──▶  (snapshot)   │       CORE       │            │
   env/os     ──▶               │  resolve → plan  │            │
                                │   (pure functions)│           │
                                └───────┬──────────┘            │
                                        ▼                       │
                                   EXECUTORS  ──▶ filesystem    │
                                   (apply plan)──▶ git          │
                    └───────────────────────────────────────────┘
```

## 2. Component map

```
agent-sync
├── core/                      # pure — no imports from shell/
│   ├── model/                 # types: Artifact, AgentId, Scope, Manifest, Lockfile,
│   │                          #        Snapshot, Plan, Operation, Diagnostic
│   ├── resolver/              # manifest + machine facts → RoutingTable (who gets what, where, why)
│   ├── planner/               # RoutingTable + Snapshot + Lockfile → Plan (list of Operations)
│   ├── drift/                 # hashes + lockfile → per-target drift classification
│   ├── translate/             # canonical MCP def ⇄ per-agent dialects (pure data→data)
│   │   ├── claude-json.ts
│   │   ├── cursor-json.ts
│   │   └── codex-toml.ts      # produces a TOML *edit script*, not raw text (see §7)
│   └── validate/              # schema validation + semantic checks for manifests
├── adapters/                  # per-agent knowledge, split pure/effectful
│   ├── capability-table.ts    # pure data: paths, formats, supports-matrix per agent (§8)
│   ├── claude/  codex/  cursor/
│   │   ├── locator.ts         # pure: (machine facts, scope, project) → target paths
│   │   ├── reader.ts          # shell: snapshot agent's current relevant state
│   │   └── writer.ts          # shell: execute operations against agent files
├── store/                     # canonical store access
│   ├── layout.ts              # pure: store path conventions
│   ├── reader.ts / writer.ts  # shell
│   └── git.ts                 # shell: clone/pull/push/status via CLI git
├── shell/                     # generic effect primitives
│   ├── fs.ts                  # atomic writes, hashing, backup-on-write
│   ├── proc.ts                # subprocess (git, optional agent CLIs)
│   └── prompt.ts              # interactive confirmations
├── cli/                       # command definitions; each = read → core → confirm → execute → report
├── skillpack/                 # the shipped interface skills (agent-sync-create-skill,
│                              #   agent-sync-add-mcp, agent-sync + shared references/), registered
│                              #   as built-in artifacts, deployed by the normal pipeline
├── hooks/                     # per-agent session-start hook installers (opt-in, via setup --hooks)
└── formats/                   # low-level parse/serialize: yaml, json (comment/format-preserving), toml
```

Dependency rule (enforced by lint): `core` imports nothing from `adapters`' effectful parts, `shell`, `store`, or `cli`. `capability-table`, `locator`, and `translate` are pure and usable from core. Anything in `core` must be callable in a unit test with literal data.

## 3. The canonical store

A single directory (default `~/.agent-sync/store`, configurable), which **is a git repository** the user owns.

```
store/
├── agent-sync.yaml           # the manifest: artifacts, projects, routing rules (§ see Sync Model)
├── skills/
│   └── db-migrate/          # artifact id = directory name
│       ├── SKILL.md
│       └── scripts/...
├── mcp/
│   └── github.yaml          # one canonical MCP server definition per file
├── plugins/
│   └── my-toolkit.yaml      # declaration: marketplace source, plugin id
└── README.md                # generated: explains the repo to a human reading it on GitHub
```

Outside the store (never committed, never synced):

```
~/.agent-sync/
├── device.yaml              # this device: id, registered project paths, per-device overrides
├── secrets.yaml             # MCP env secret values for this device (0600 perms)
└── lock/
    └── <device-id>.lock.yaml# deployment lockfile: what we deployed, where, content hashes
```

Design points:

- **The store is legible without the tool.** Skills are plain folders; MCP defs are small YAML files; the manifest is one readable YAML. If agent-sync disappears tomorrow, the user's library is still perfectly usable by hand. This is an explicit open-source trust property.
- **Artifact identity = stable id** (directory/file name), referenced by the manifest and lockfile. Renames are an explicit CLI operation (`agent-sync mv`) so history and lockfiles stay coherent.
- **The lockfile is per-device and lives outside the repo.** Two devices deploy to different paths with different local states; committing lockfiles would cause perpetual merge noise. Losing a lockfile is safe: the next `apply` re-derives state, treating unknown-but-identical files as already-converged and unknown-but-different files as drift (conservative default: ask).

## 4. Cross-device sync: why git

Requirement G1 needs state transport between machines. Options considered:

| Option | Verdict | Why |
|--------|---------|-----|
| **User-owned git repo** | ✅ **chosen** | Free; versioned (every skill edit has history, diffs, revert); offline-capable; conflict handling exists and is well-understood; zero infrastructure for an open-source project; the target audience already lives in git |
| Hosted sync service | ❌ | Requires running infra, accounts, trust; kills the "no lock-in" promise; unreasonable for v1 of an OSS side project |
| File-sync folder (Dropbox/iCloud/Syncthing) | ❌ as the mechanism | No merge semantics — concurrent edits corrupt silently; iCloud offloads files; but nothing *prevents* a user pointing their store inside one |
| Manual export/import bundles | ❌ | Punts the actual problem (staying in sync) back to the user |

`agent-sync sync` = `git pull --rebase` → re-`apply` locally → commit local store changes (made via `add`/`edit`/adopt-drift) → `git push`. Git conflicts are surfaced with artifact-level context ("both devices edited `skills/db-migrate/SKILL.md`") and standard resolution; because artifacts are small independent files, conflicts are rare and localized. The git dependency is the system `git` binary via subprocess — see [Tech Stack §4](05-tech-stack.md).

## 5. The apply pipeline

Every state-changing command runs the same five stages; commands differ only in which subset they run and whether execution is real or dry.

```
1. SNAPSHOT   (shell)  read manifest, device file, secrets keys (names only),
                       lockfile, and observed state of every potential target
2. RESOLVE    (core)   manifest + device facts → RoutingTable
                       = for each (artifact, scope-instance): the set of target
                         agents and concrete target locations, each with provenance
3. PLAN       (core)   RoutingTable + snapshot + lockfile → Plan
                       = ordered Operations: writeFile, editJson, editToml,
                         deleteManaged, warnCapability, askDrift...
                       every Operation carries its reason and a preview diff
4. CONFIRM    (shell)  dry-run stops here and prints the plan;
                       drift questions and destructive ops prompt the user
                       (flags: --yes, --adopt, --overwrite for non-interactive use)
5. EXECUTE    (shell)  run operations: atomic writes (temp + rename), backup of
                       shared files before first edit, then update lockfile
```

Properties guaranteed by construction:

- **Idempotent:** planning against an already-converged snapshot yields an empty plan.
- **Convergent:** apply moves reality toward the manifest regardless of starting state.
- **Honest dry-run:** stage 1–3 are identical for real and dry runs.
- **Explainable:** `--verbose` prints each operation's provenance chain from stage 2–3.

## 6. Deployment mechanism: copy + lockfile, not symlinks

The obvious dotfiles-manager approach is symlinking store folders into agent directories. Rejected:

- **Windows:** creating symlinks requires Developer Mode or elevation — unacceptable friction for G4, and directory junctions have their own sharp edges. The user's second machine *is* Windows; this is not a corner case.
- **Agent behavior:** file watchers, sandboxes, and future agent versions handling symlinks inconsistently is a class of bugs we simply opt out of.
- **Project-scope reality:** project skills live inside repos that get cloned, moved, or checked out where the store doesn't exist. Real files always work.

Instead: **copy, and track integrity in the lockfile.** For each deployed target the lockfile records `(artifact id, artifact content hash, target path, deployed content hash)`. On the next run, three-way comparison classifies each target:

| Store changed? | Target changed? | Classification | Action |
|---|---|---|---|
| no | no | in sync | nothing |
| yes | no | outdated | overwrite (normal update) |
| no | yes | **drifted** | ask: adopt into store / overwrite / ignore-once |
| yes | yes | **conflicted** | show both diffs; ask |
| — | target missing | missing | write |
| — | not in lockfile, exists, identical | adopted-in-place | record in lockfile |
| — | not in lockfile, exists, different | **unmanaged collision** | never overwrite; ask (import or skip) |

This is exactly a tiny content-addressed three-way merge, and it is what makes NFR-4 (never destroy user work) mechanical rather than hopeful.

## 7. MCP: canonical schema and translation

One canonical definition (YAML in `mcp/<id>.yaml`):

```yaml
name: github
transport: stdio            # stdio | http | sse
command: npx
args: ["-y", "@modelcontextprotocol/server-github"]
env:
  GITHUB_TOKEN: ${secret:github-token}    # resolved per-device at apply time
# transport http/sse instead: url, headers
# optional: timeouts, per-agent tweaks (agents.codex.startup_timeout_sec: 30)
```

Translation is pure `canonical → dialect` per agent (`core/translate/`). Three rules:

1. **Superset with warnings.** The canonical schema is the union of agent capabilities. A field with no mapping in a target dialect produces a `warnCapability` operation in the plan ("`envFile` not supported by Codex — ignored for that target"), never a silent drop and never a hard failure.
2. **Secrets are indirection.** `${secret:NAME}` is resolved from the device's `secrets.yaml` (or `${env:VAR}` left as an env reference where the agent supports it) during **planning**, so secret values exist only in the final written agent files on that device — never in the store, never in git, never in the lockfile (which hashes post-resolution content but stores only hashes).
3. **Shared files get edit scripts, not rewrites.** For dedicated files (`.mcp.json`, `.cursor/mcp.json`) the writer merges managed keys into the existing document. For shared files (`~/.claude.json`, Codex `config.toml`) the translator emits a *keyed edit script* ("upsert table `mcp_servers.github` with these values; delete table `mcp_servers.old-one` which the lockfile says we own") and the writer applies it with a format-preserving parser. The writer backs up the file before its first edit in a run, and a round-trip check (parse → edit → parse) guards against corrupting the user's broader config. Keys we didn't create are never touched.

## 8. Adapters and the capability table

Everything agent-specific is data first, code second. `capability-table.ts` declares, per agent and per artifact type: supported? global path template, project path template, file format, dialect quirks, and the skill-discovery overlap sets from [Agent Landscape §4–5](02-agent-landscape.md). Locators are pure functions from `(capabilityTable, machineFacts, scope)` to concrete paths — so path logic for all three OSes is unit-testable with fabricated machine facts (including Windows `%USERPROFILE%` shapes on a Mac CI runner and vice versa).

When an agent vendor moves things (they will — PRD Risk #1), the fix is: update the table, maybe a dialect module, bump the table's version, and `doctor` learns to recognize both old and new layouts.

Adding a *new* agent (Gemini CLI, Windsurf, whoever wins next quarter) = new table entry + locator + reader/writer + dialect. The core never changes. This is the modularity requirement (G5) made concrete.

## 9. Command architecture

Each CLI command is a thin composition of the pipeline (§5):

| Command | Stages | Notes |
|---|---|---|
| `status` | 1–3, render plan/drift as matrix | read-only |
| `apply` | 1–5 | the workhorse |
| `sync` | git pull → 1–5 → git commit/push | the daily loop |
| `add` / `rm` / `mv` / `edit` | store mutation + manifest edit, then 1–5 | mutations end per `autoSync` (commit+push by default) |
| `new` / `save` | store scaffold / validate + 1–5 + commit + push | the agent-native create transaction |
| `import` | agent readers → candidate artifacts → user selection → `add` | onboarding |
| `link` / `unlink` | device.yaml + marker file + manifest hint | project registration ([Sync Model §3a](04-sync-model.md)) |
| `setup` | install CLI/skill pack/hooks + `init`\|`clone` + probe | machine onboarding & repair ([Agent-Native §3](09-agent-native.md)) |
| `heartbeat` | 1–3 always; 4–5 only when conflict-free | ambient sync; judgment calls become printed notices, never actions |
| `doctor` | 1–2 + environment probes | diagnostics, no writes |

Full command surface with flags and example sessions: [CLI Spec](06-cli-spec.md).

## 10. Error-handling philosophy

- **Validation errors are for humans:** manifest problems report path, expected shape, and the offending value ("`projects.acme.defaults.skill.targets[1]`: unknown agent `"corsur"` — did you mean `cursor`?"). Fail fast at load; the core never sees invalid data.
- **Partial failure is safe failure:** operations are independent per target file; one failed write reports and continues (unless `--fail-fast`), and the lockfile records only what actually succeeded. Re-running `apply` resumes convergence — there is no "half-migrated" state because there is no migration, only convergence.
- **The shell may fail; the core may not.** Any `throw` from core code is a bug by definition, which keeps the property-based tests honest (see [Testing §4](07-testing.md)).

## 11. Security posture

- No network calls except user-initiated git operations to the user's own remote (and, if enabled, invoking agent CLIs locally for plugin reconciliation).
- Secrets: stored per-device with `0600` perms, never transported, never logged, never hashed into committed files; `doctor` warns if the store repo is public **and** any canonical MCP def contains an inline literal that looks like a credential.
- Skills are instruction files executed by *agents*, not by agent-sync — agent-sync never executes artifact content. Still, `import` shows full content before adopting anything into the library.
- Supply chain: minimal dependency tree (see [Tech Stack §6](05-tech-stack.md)), lockfile-pinned, no postinstall scripts.
