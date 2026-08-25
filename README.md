# agent-sync

**One source of truth for your coding-agent setup — skills, MCP servers, and plugins — synced across devices and projected into every agent you use.**

If you use more than one coding agent (Claude Code, OpenAI Codex, Cursor) on more than one machine, you know the problem: you write a great skill in Claude Code on your Mac, and it doesn't exist in Codex, doesn't exist in Cursor, and doesn't exist on your Windows machine. You add an MCP server to Cursor and then hand-translate the same config into TOML for Codex. Every agent has its own dialect of the same three ideas, and none of them talk to each other.

`agent-sync` fixes this with a simple model:

1. **You keep one canonical library** of skills, MCP server definitions, and plugin declarations, versioned in a git repo you own.
2. **You declare routing rules** — which artifacts go to which agents, globally and per project, with per-artifact overrides.
3. **`agent-sync apply` makes reality match the declaration** on whatever machine you run it on, translating each artifact into each agent's native format and location.
4. **Your agents are the primary interface.** agent-sync installs a skill into every agent that teaches it the tool — so "create me a skill for X" in *any* agent authors it in your library, deploys it everywhere it's routed, commits, and pushes. One request, zero follow-up commands. Everything works without an agent too; the CLI is the complete fallback.

No server, no accounts, no lock-in. Just files, a resolver, and adapters.

**Install (agent-native):** paste this into any of your agents —

```
Read https://raw.githubusercontent.com/<owner>/agent-sync/main/INSTALL.md and follow it to set up agent-sync for me.
```

or do it yourself: `npx agent-sync@latest setup`.

## Status

📐 **Design phase.** This repository currently contains the full design documentation. Implementation follows the [roadmap](docs/08-roadmap.md).

## The docs

Read them in order — each builds on the previous one:

| # | Document | What it covers |
|---|----------|----------------|
| 1 | [PRD](docs/01-prd.md) | The problem, who it's for, goals, non-goals, user stories, requirements |
| 2 | [Agent Landscape](docs/02-agent-landscape.md) | Research: where Claude Code, Codex, and Cursor each store skills, MCP config, and plugins — the ground truth the adapters are built on |
| 3 | [Architecture](docs/03-architecture.md) | System design: canonical store, pure resolution core, adapters, apply engine, drift detection |
| 4 | [Sync Model](docs/04-sync-model.md) | The heart of the product: scopes, routing rules, precedence, manifest schemas, worked examples |
| 5 | [Tech Stack](docs/05-tech-stack.md) | Language and library choices with rationale, project layout, distribution |
| 6 | [CLI Spec](docs/06-cli-spec.md) | Every command, its flags, and example sessions |
| 7 | [Testing Strategy](docs/07-testing.md) | Test pyramid, cross-platform CI, how purity makes the core trivially testable |
| 8 | [Roadmap](docs/08-roadmap.md) | Milestones from v0.1 to v1.0, and open questions |
| 9 | [Agent-Native Design](docs/09-agent-native.md) | Agents as installer and interface: the paste-line install, the agent-sync skill pack, transactional auto-sync, and heartbeat hooks |

## The 30-second mental model

```
        ┌────────────────────────────┐
        │   Canonical store (git)    │   ← you edit here, once
        │  skills/  mcp/  plugins/   │
        │  manifest + routing rules  │
        └─────────────┬──────────────┘
                      │  agent-sync apply
                      ▼
        ┌────────────────────────────┐
        │     Resolver (pure fn)     │   ← manifest + machine facts → desired state
        └─────────────┬──────────────┘
          ┌───────────┼───────────┐
          ▼           ▼           ▼
     Claude Code    Codex       Cursor      ← adapters translate to native formats
     ~/.claude/   ~/.codex/   ~/.cursor/
     .claude/     .codex/     .cursor/
```

Cross-device sync is `git push` / `git pull` on the canonical store — `agent-sync` wraps it so you never have to think about it.

## Design principles

- **Declarative, not imperative.** The manifest describes the end state; `apply` converges to it. Running apply twice is a no-op.
- **Functional core, imperative shell.** All decision logic is pure functions over plain data. I/O lives at the edges. This is what makes the tool testable and trustworthy.
- **Never destroy user work.** Drift detection notices when a deployed file was hand-edited and asks before overwriting. Adopt-or-overwrite, never silent clobber.
- **Secrets never leave the machine.** MCP env values are referenced, not stored; each device keeps its own gitignored secrets file.
- **Degrade gracefully.** Agents have unequal capabilities (plugins are Claude-only). The tool is explicit about what maps where instead of pretending everything is portable.
- **One human action per intent.** Mutating commands are complete transactions (apply + commit + push); ambient hooks converge quietly when it's safe and speak up — in your agent's conversation — when something needs your judgment. Nothing that requires judgment is ever resolved unattended.

## License

MIT (planned).
