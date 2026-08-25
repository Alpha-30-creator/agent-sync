# Agent-Native Design

agent-sync is not just a CLI a human runs — **the coding agents themselves are a first-class interface**. This doc covers the three pillars that make that true: agent-driven installation, the interface skill pack, and ambient sync (eliminating the "now run a separate sync command" step). It also defines the friction budget the whole feature exists to meet.

The prime directive, inherited from the PRD: **agent-native is additive.** Every flow here is sugar over the same CLI and the same pure core. A user with no agent open (or an agent vendor that breaks something) can always do everything by hand. No capability exists *only* through an agent.

---

## 1. The friction problem

Without this design, the lifecycle of a new artifact looks like:

> create skill somewhere → remember agent-sync exists → `agent-sync add` → `agent-sync apply` → `agent-sync sync` → repeat on the other machine

Five manual steps, two of them easy to forget, one per device. The target lifecycle:

> tell any agent "make me a skill that does X" → **done** (created in the store, deployed to the routed agents, committed, pushed; the other machine converges on its next heartbeat)

Friction budget: **one human action per intent.** Creating, routing, and syncing are one conversational request; second-device convergence is zero actions (ambient) or one (`agent-sync sync`).

## 2. How the ecosystem does it (research summary)

| Pattern | Who | What we take from it |
|---|---|---|
| `npx skills add <owner/repo>` — one CLI installs skills into 75+ agents | [vercel-labs/skills](https://github.com/vercel-labs/skills) | Skills-as-distribution works; npx as the zero-install runner; multi-agent targeting from one command |
| "Paste this into your agent" install blocks | Widespread in skill/MCP READMEs | The agent *is* the installer: it can run commands, verify results, and troubleshoot interactively — better than a shell script for non-experts |
| Agent-readable install docs (`install.md` / `llms.txt` style) | OSS tooling convention | Ship instructions written *for the agent*, versioned with the code, fetched at install time |
| One-click deeplinks (`cursor://anysphere.cursor-deeplink/mcp/install?...`) | [Cursor MCP install links](https://cursor.com/docs/context/mcp/install-links) | Nice channel for *one* artifact; wrong shape for installing a whole tool — noted for future "share this MCP def" export, not for agent-sync's own install |
| `$skill-installer` (a skill that installs skills) | Codex | Validates the self-hosting move: the tool's own agent interface ships as a skill |
| Lifecycle hooks (Claude Code: 15+ events incl. `SessionStart`; Cursor: hooks since v1.7; Codex: `notify` only) | [Claude Code hooks](https://code.claude.com/docs/en/hooks-guide) | Ambient behavior must be *tiered by agent capability* — hooks are an enhancement, never a dependency |

## 3. Pillar 1 — Installation: the agent is the installer

### The paste-line

The README's install section is one copyable line addressed to *any* agent:

```
Read https://raw.githubusercontent.com/<owner>/agent-sync/main/INSTALL.md and follow it to set up agent-sync for me.
```

`INSTALL.md` is a versioned, agent-readable runbook maintained in this repo. It instructs the agent to:

1. **Check prerequisites** — `node --version` (≥ 20), `git --version`; if missing, stop and give the user the human install links (the agent must not install runtimes itself).
2. **Run the one real entry point** — `npx agent-sync@latest setup`.
3. **Interview the user for the two decisions setup needs** (agents are good at this): first machine (`init`) or additional machine (`clone <remote>`)? And which git remote to use — including offering to create a private GitHub repo via `gh` if the user wants.
4. **Verify** with `agent-sync doctor --json` and report the result honestly.
5. **Offer the two opt-ins**: `agent-sync import` (adopt existing setup) and `agent-sync setup --hooks` (ambient sync, §5).

Design rules for `INSTALL.md`: idempotent (safe to re-run; `setup` detects existing installs and converges), no `curl | bash` (the agent runs inspectable commands), pinned to the same repo version it documents, and it never asks the agent to handle credentials — git auth is whatever the user's git already does.

### `agent-sync setup`

One command owns machine onboarding, for humans and agents alike:

- installs/updates the CLI globally (or confirms the npx-only mode),
- runs `init`/`clone` (flag-driven or interactive),
- probes agents and writes `device.yaml`,
- **installs the interface skill pack (§4) into every detected agent**, and
- with `--hooks`, installs the ambient-sync hooks (§5) — always opt-in, never default.

The same command re-run later is a repair tool ("my Cursor lost the skill pack") — it just converges, like everything else.

### Why not a deeplink / marketplace install?

Deeplinks install *one artifact into one agent*; agent-sync setup is *N artifacts into M agents plus a store and device identity*. The conversational installer handles the genuinely interactive parts (remote choice, import selection) that a link click can't. We *publish through* those channels instead: the skill pack repo stays layout-compatible with `npx skills add <owner>/agent-sync-skills` and Claude plugin marketplaces as secondary discovery channels that funnel into the same `setup`.

## 4. Pillar 2 — The interface skill pack

agent-sync ships **three skills, split by user intent — not by CLI feature** — deployed to all three agents:

```
skillpack/
├── agent-sync-create-skill/SKILL.md   # INTERCEPTOR: "create/write/improve a skill …"
├── agent-sync-add-mcp/SKILL.md        # INTERCEPTOR: "add/connect/set up an MCP server …"
├── agent-sync/SKILL.md                # MANAGER: sync, status, routing, drift, troubleshooting
└── references/                       # shared single-source workflows, materialized into each
    ├── create-flow.md                #   skill's folder at deploy time (skills stay self-
    ├── mcp-flow.md                   #   contained on disk; one source of truth here)
    ├── routing.md
    ├── status-sync.md
    └── troubleshoot.md
```

All three names carry the `agent-sync` prefix so users (and agents) can see at a glance in any skill list that these belong to agent-sync — activation is driven by descriptions, so the verbose names cost nothing there.

**Why three, and why these three.** A skill's description is its routing surface — the only part always in the agent's context, and what decides activation. The costly failure isn't clutter; it's a *missed* activation: if "add the GitHub MCP to this project" doesn't trigger our skill, the agent edits its own native config, silently creating the out-of-band drift agent-sync exists to prevent. The user's natural phrasings fall into three distinct vocabularies — creating skills, adding MCP servers, and managing sync — and the first two usually never mention agent-sync at all. Three tight descriptions, each owning one vocabulary, trigger far more reliably than one description enumerating everything. The first two are deliberately **interceptors**: they compete with the agent's native instinct (and with third-party skill-creator skills) to redirect creation into the store, so artifacts are born synced (§4.1).

**Why not more.** Further splits (routing vs status vs troubleshooting) would share one distinctive vocabulary and start competing with *each other*, while every added description costs context in every session in every agent. Three tight descriptions ≈ the token cost of one bloated one; that's the optimum. If dogfooding shows redundancy, merging is a cheap change ([Roadmap Q8](08-roadmap.md)).

**Self-hosting:** the skill pack ships inside the CLI package and is registered in the manifest as three built-in artifacts (`skill/agent-sync-create-skill`, `skill/agent-sync-add-mcp`, `skill/agent-sync`; pinned `targets: all`). It is deployed, updated, and version-tracked by agent-sync's own apply pipeline — the tool's first user is itself. A CLI upgrade that changes the pack shows up as a normal `outdated → apply` transition. (A user can even route it away from an agent, and `doctor` will tell them why that agent went quiet.)

### 4.1 The flagship flow: "create me a skill"

User, in any agent: *"Create a skill that reviews my SQL migrations for danger, and make it available everywhere."*

The `agent-sync-create-skill` interceptor directs the agent to:

```
1. agent-sync new skill sql-migration-review --json
      → scaffolds skills/sql-migration-review/SKILL.md in the STORE, prints its path
2. write the skill content there (agent authors SKILL.md + any reference files)
3. agent-sync save skill/sql-migration-review
      → validate → apply (deploys to routed agents) → commit → push
4. report: where it deployed (from save's JSON output), and that other
   devices pick it up on their next sync/heartbeat
```

Two properties matter. **The store is the write target** — the agent never creates the skill in its own directory first; there is no "now import it" second step, and the skill is *born synced*. **`save` is the transaction** — validate + apply + commit + push as one command, so the agent can't half-finish (and if push fails offline, save reports "applied locally, push pending"; the next heartbeat retries).

Equivalent flows exist for MCP (`add mcp` conversationally, with the secrets protocol below) and routing ("make this project cursor-only" → `agent-sync route --type skill --project <id> --targets cursor`).

### 4.2 Agent-mode CLI contract

The CLI meets agents halfway — these are hard requirements on every command, tested in CI:

- **Non-interactive by default when stdout is not a TTY**; anything that would prompt instead fails with exit 3 and a JSON body saying exactly which flag answers the question. Agents never hang on a hidden prompt.
- **`--json` everywhere**, versioned (`schemaVersion`), stable field names. Human output is a rendering of the same data.
- **Exit-code contract** (0 ok / 1 error / 2 warnings / 3 needs-decision) so the skill pack can branch without parsing prose.
- **Provenance in output** (`--why` data included in JSON) so the agent can *explain* routing to the user instead of guessing.
- **Secrets protocol:** the CLI never accepts secret values in argv. When an MCP def needs one, the flow is `agent-sync secret set <name> --stdin` and the skill pack instructs the agent to have **the user** run that command themselves (or paste into the CLI's stdin prompt in their terminal) — secret values should not transit the agent conversation. This rule is stated in the skill pack itself.

## 5. Pillar 3 — Ambient sync

Three tiers, by agent capability — each tier is optional and additive:

**Tier 0 — transactional auto-sync (all agents, no hooks; the default).** Every mutating command (`save`, `add`, `route`, `rm`, ...) finishes with apply + commit + push, controlled by store config `autoSync: full | apply | off` (default `full`). This alone removes the "separate action" — one command is always a complete, synced transaction. Users who want curated commits set `apply` and push manually.

**Tier 1 — heartbeat on session start (Claude Code + Cursor hooks; opt-in via `setup --hooks`).** A `SessionStart`-class hook runs `agent-sync heartbeat`:

```
heartbeat = fast staleness probe (target < 300ms perceived; long ops backgrounded):
  fetch remote (background, cached, rate-limited to ~1/15min)
  behind remote + clean?        → pull + apply quietly
  drift or conflicts detected?  → DO NOTHING; emit one context line:
      "agent-sync: 1 drifted artifact on this machine — say 'sync my skills' to resolve"
  unmanaged artifacts detected? → emit: "agent-sync: found 2 unmanaged MCP servers — 'import' to adopt"
  in a project dir with a marker file? → auto-register path in device.yaml (see Sync Model §3a)
```

The hook's stdout lands in the agent's context, so the *agent* becomes the notification surface — and resolution happens conversationally, with the skill pack, under the user's eyes. Codex (no rich hooks) gets tier 0 plus the same staleness note printed by any agent-sync command the agent happens to run.

**Tier 2 — scheduled heartbeat (OS-level, post-v1).** launchd / Task Scheduler / systemd timer recipe running `heartbeat` a few times a day for machines where no agent session happens for days.

**The unattended-safety rule** (restating NFR-4 for automation): ambient tiers may only do *convergent, conflict-free* work — pull-and-apply when nothing is drifted, register a project path, print notices. Anything requiring judgment (drift, conflicts, adopting unmanaged config) is **never** resolved unattended; it is surfaced into the next conversation. An automation layer that can destroy work while you sleep is worse than friction.

## 6. What this changes elsewhere (delta summary)

- **CLI:** new commands `setup`, `new`, `save`, `heartbeat`; the agent-mode contract (§4.2) — see [CLI Spec](06-cli-spec.md).
- **Store/manifest:** built-in skill-pack artifacts; `autoSync` setting; project **marker file** `.agent-sync.yaml` for portable project identity — see [Sync Model §3a](04-sync-model.md).
- **Architecture:** `skillpack/` ships in the package; heartbeat is a pipeline subset (snapshot → resolve → plan, execute only if conflict-free); hooks installers live in the per-agent adapters — see [Architecture](03-architecture.md).
- **Testing:** the skill pack gets its own eval-style e2e (drive a scripted "agent" through the flagship flow using only skill-pack instructions + JSON outputs); hook installers get integration tests — see [Testing §5](07-testing.md).
- **Roadmap:** agent-native work lands incrementally (contract in M1, skill pack + setup in M2–M3, hooks in M4) — see [Roadmap](08-roadmap.md).

## 7. Sources

- [vercel-labs/skills — `npx skills`](https://github.com/vercel-labs/skills) and [Vercel Agent Skills docs](https://vercel.com/docs/agent-resources/skills)
- [Cursor — MCP install links (deeplinks)](https://cursor.com/docs/context/mcp/install-links)
- [Claude Code — Automate actions with hooks](https://code.claude.com/docs/en/hooks-guide)
- [Claude Code hooks lifecycle overview](https://claudefa.st/blog/tools/hooks/hooks-guide)
- [Installing agent skills in Codex (`$skill-installer`)](https://www.openagentskill.com/guides/install-agent-skills-in-codex)
