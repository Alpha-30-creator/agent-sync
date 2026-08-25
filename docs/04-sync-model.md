# Sync Model

This is the heart of the product: **how agent-sync decides which artifact appears in which agent, at which scope, on which device** — and the file formats you use to express that. If you read only one design doc, read this one.

---

## 1. Vocabulary

| Term | Meaning |
|------|---------|
| **Artifact** | A thing being managed: a skill, an MCP server definition, or a plugin declaration. Identified by a stable id (`db-migrate`, `github`, `my-toolkit`). |
| **Agent** | A supported coding agent: `claude`, `codex`, `cursor`. |
| **Scope** | Where an artifact is deployed: `global` (the agent's user-level directories, available everywhere) or `project` (inside a specific project's directories, travels with the repo). |
| **Project** | A logical project with a stable id, registered to a concrete path per device via `agent-sync link`. The same project can live at `~/dev/acme` on the Mac and `C:\dev\acme` on Windows. |
| **Targets** | The set of agents an artifact is routed to in a given context, e.g. `[claude, cursor]`. |
| **Routing rule** | A declaration, at some precedence layer, of targets for some (artifact-type or artifact) × (scope or project). |
| **Device** | One machine, with an id and local facts (OS, registered project paths, per-device overrides, secrets). |

## 2. The precedence ladder

Targets for an artifact in a given context are decided by the **most specific rule that exists**, walking from bottom (most specific) to top (least specific):

```
5.  Built-in default                       "every artifact type → all agents that support it"
4.  Global default per artifact type       defaults.skill.targets: [claude, codex, cursor]
3.  Project default per artifact type      projects.acme.defaults.skill.targets: [cursor]
2.  Per-artifact rule                      artifacts.skill.db-migrate.targets: [claude]
1.  Per-artifact, per-project rule         projects.acme.artifacts.skill.db-migrate.targets: [cursor, codex]
```

Rules:

- **Most specific wins, entirely.** A more specific rule *replaces* the less specific target set; it does not merge with it. (Merging sounds convenient and makes reasoning miserable; replacement keeps every answer traceable to exactly one rule.) For ergonomics, a rule may use the modifiers `add: [codex]` / `remove: [claude]` to *derive* its target set from the next rule up the ladder — this is still a single winning rule, just written relatively.
- **Capability filtering happens after resolution.** If a rule routes a plugin to `codex`, resolution succeeds but the capability table filters it out with a visible note (`plugin → codex: unsupported`). Rules never fail because a vendor lacks a feature; you just get told.
- **Device overrides are a final mask, not a layer.** `device.yaml` can disable specific artifacts or agents on this machine (`disable: [mcp/heavy-profiler]`, or `agents: [claude, cursor]` if Codex isn't installed on the work laptop). This subtracts, never adds — a device can't grant itself something the manifest doesn't route.
- Every resolved decision carries **provenance**: which rule (by manifest path) produced it. `status --why` and `apply --verbose` print it.

## 3. Scope semantics

- **Global scope**: the artifact is deployed to each target agent's user-level location (`~/.claude/skills/...`, `~/.codex/config.toml`, `~/.cursor/mcp.json`, ...). Every artifact has a `scope`, defaulting to `global`.
- **Project scope**: the artifact is deployed into the project's checkout on each device where that project is linked (`<project>/.claude/skills/...`, `<project>/.cursor/mcp.json`, ...). If a device hasn't linked the project, there's nothing to do there — no error.
- An artifact can be global *and* pinned into projects (`scope: global` + listed under a project's `include`) — e.g. a personal skill you also want committed into one repo for teammates. The project instance is a separate deployment with its own routing context.
- Project-scoped files land inside a git repo the user controls. Whether they get committed is the user's call; `agent-sync` can maintain `.gitignore` entries for deployed-but-personal artifacts (`private: true` on the project include).

## 3a. Project identity across devices

Paths differ per machine (`~/dev/acme-app` on the Mac, `C:\dev\acme-app` on Windows), so **identity is never derived from a path**. A project's identity is its stable id in the manifest; each device maintains its own id → local-path mapping. Three mechanisms keep that mapping populated, from most to least automatic:

1. **The marker file (primary).** `agent-sync link` writes a tiny committed file at the project root:

   ```yaml
   # .agent-sync.yaml — safe to commit; contains no paths, no secrets
   project: acme-app
   ```

   Because it's committed, the identity travels with every clone. Whenever any agent-sync command (including `heartbeat`) runs inside a directory containing a marker whose id exists in the manifest, the device mapping is registered/refreshed automatically — on a second machine, cloning the repo and opening an agent session in it is enough; no manual `link`.

2. **Git-remote matching (fallback hint).** `link` also records the project's normalized git remote URL in the manifest. `doctor` and `import` use it to *suggest* identities for unlinked directories ("this repo's remote matches project `acme-app` — link it?"). Suggestion only, never auto-registration: remotes aren't unique (forks, mirrors, monorepo splits).

3. **Manual `link` (always available).** For non-git projects, unusual layouts, or overriding either mechanism above.

Precision rules: a marker id not present in the manifest is reported by `doctor` (likely a store not yet synced — pull first), not invented; two directories claiming the same project id on one device is an error surfaced at snapshot time; moving a project is just re-running any command inside it at the new location (the marker re-registers; `doctor` prunes mappings whose paths no longer exist, with confirmation).

## 4. The manifest — `agent-sync.yaml`

Lives at the root of the canonical store. Complete annotated example:

```yaml
version: 1

# ── Layer 4: global defaults per artifact type ─────────────────────────
defaults:
  skill:
    targets: [claude, codex, cursor]     # explicit, though this matches built-in
  mcp:
    targets: [claude, cursor]            # e.g. keep Codex lean by default
  plugin:
    targets: [claude]                    # only claude supports them anyway

# ── Artifact registry (+ Layer 2: per-artifact rules) ──────────────────
artifacts:
  skill:
    db-migrate: {}                       # exists in store; all defaults apply
    commit-style:
      targets: [claude]                  # Layer 2: this skill is claude-only everywhere
    scratch-notes:
      scope: project                     # only ever deployed via project includes
  mcp:
    github: {}
    heavy-profiler:
      targets: [codex]
  plugin:
    my-toolkit:
      source: github.com/abdur/claude-plugins   # marketplace
      scope: global

# ── Projects (+ Layers 3 and 1) ────────────────────────────────────────
projects:
  acme-app:
    defaults:
      skill:
        targets: [cursor]                # Layer 3: in this project, skills → cursor only
    include:                             # project-scoped deployments
      - skill/scratch-notes
      - skill/db-migrate
      - mcp/github
    artifacts:
      skill:
        db-migrate:
          targets: {add: [codex]}        # Layer 1: cursor (from layer 3) + codex
  side-quest:
    include: [mcp/github]
    private: [mcp/github]                # deploy, but gitignore in the project
```

The manifest is validated strictly on load (unknown keys, unknown agent names, references to artifacts that don't exist in the store, cycles — all hard errors with precise locations). You can edit it by hand or through CLI commands (`agent-sync route ...`); the CLI is sugar over the same file.

### Per-device file — `~/.agent-sync/device.yaml` (not synced)

```yaml
device: macbook-m3
agents: [claude, codex, cursor]          # agents present on this machine (doctor keeps honest)
projects:                                # project id → local path; auto-registered via the
  acme-app: ~/dev/acme-app               #   committed .agent-sync.yaml marker (§3a) or `link`
  side-quest: ~/Development/side-quest
disable: []                              # e.g. [mcp/heavy-profiler]
```

## 5. The resolution function

The entire model above reduces to one pure function (this *is* the spec for `core/resolver`):

```
resolve(manifest, device, capabilityTable) → RoutingTable

RoutingTable = list of Deployment {
  artifact:    (type, id)
  scopeInst:   global | project(id, localPath)
  agent:       claude | codex | cursor
  provenance:  [rule paths walked, winning rule, modifiers applied, device mask, capability filter]
}
```

For each artifact × scope-instance: walk the ladder (§2) → apply device mask → apply capability filter → emit deployments with provenance. The planner then turns each deployment into concrete file operations using the locators.

## 6. Worked examples

These are the acceptance tests for the resolver, straight from the original requirements.

**Example A — "a new skill becomes available in all 3 agents."**
`agent-sync add skill ./review-checklist` registers `artifacts.skill.review-checklist: {}`. No layer-1/2/3 rule exists; layer 4 says `[claude, codex, cursor]`. After `apply`: deployed to `~/.claude/skills/`, `~/.codex/skills/`, and Cursor's global skills location on every device that syncs.

**Example B — "in this project, my skills go only to Cursor."**
`projects.acme-app.defaults.skill.targets: [cursor]` (layer 3). Every skill included in `acme-app` deploys only to `acme-app/.cursor/skills/`. Global-scope skills are untouched — the project default governs the project's deployments, not the world.

**Example C — "…but this one skill also goes to Codex."**
Layer 1: `projects.acme-app.artifacts.skill.db-migrate.targets: {add: [codex]}` → resolves to `[cursor, codex]` for `db-migrate` in `acme-app`, while every other skill in the project remains cursor-only. Provenance: `layer 3 (cursor) + add codex @ layer 1`.

**Example D — plugin routed everywhere.**
`defaults.plugin.targets: [claude, codex, cursor]` would resolve fine, then capability-filter to `[claude]` with two visible `unsupported` notes in `status`. Nothing breaks; nothing lies.

**Example E — device without Codex.**
Windows machine's `device.yaml` has `agents: [claude, cursor]`. All Codex deployments are masked out on that device with provenance `device mask`. The Mac still gets them. When Codex is later installed, `doctor` notices the binary, suggests adding it, and the next `apply` converges.

## 7. The Cursor overlap problem

From [Agent Landscape §4](02-agent-landscape.md): in project scope, Cursor also reads `.claude/skills/` and `.codex/skills/`. Two consequences the model handles explicitly:

1. **Duplication:** routing a project skill to all three agents naively writes three copies, and Cursor sees up to three. Placement strategy: the planner consults the capability table's *discovery matrix* and writes the **minimum set of copies that satisfies the routed agents** — e.g. targets `[claude, cursor]` → write only `.claude/skills/` (Cursor discovers it there); targets `[cursor]` only → write `.cursor/skills/`; targets `[claude, codex, cursor]` → write `.claude/` + `.codex/` (both discovered by Cursor; no third copy).
2. **Exclusion limits:** targets `[claude]` in a project still leaves the skill visible to Cursor-in-that-project, because Cursor reads Claude's directory and we can't stop it. `status` reports this as `cursor: visible (via .claude/skills — not excludable)` instead of pretending exclusion worked. Honesty over illusion; if Cursor ships an ignore mechanism later, the capability table picks it up.

Global scope has no overlap (each agent reads only its own home directories), so none of this applies there.

## 8. What syncing a plugin means

A plugin artifact is a *declaration*: `{marketplace source, plugin id, enabled, scope}`. Deploying it to Claude Code on a device means converging that device's Claude installation: marketplace known → plugin installed → `enabledPlugins` entry set at the right scope. Reconciliation prefers the `claude` CLI when available, falling back to settings-file edits per the adapter. Plugin *content* is never stored in agent-sync's repo — the marketplace is already a git repo; we store the pointer. (Skills-inside-plugins projected to other agents: deliberately post-v1, see [Roadmap](08-roadmap.md).)

## 9. Invariants

Kept true by the resolver's property tests ([Testing §4](07-testing.md)):

1. Resolution is **total**: every artifact × scope-instance resolves to a (possibly empty) target set — never an error.
2. Resolution is **deterministic** and independent of rule declaration order.
3. Removing a more specific rule always yields the next rule up the ladder — no ghost state.
4. A device mask can only shrink a target set.
5. Capability filtering can only shrink a target set, and always leaves a note when it does.
6. Every deployment's provenance chain is non-empty and replayable (re-running resolution with the same inputs cites the same chain).
