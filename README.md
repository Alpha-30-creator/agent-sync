# agent-sync

**One library of skills and MCP servers, synced across every coding agent you use and every machine you use them on.**

If you use more than one coding agent — Claude Code, OpenAI Codex, Cursor — on more than one machine, you know the problem. You write a good skill in Claude Code on your Mac, and it doesn't exist in Codex, doesn't exist in Cursor, and doesn't exist on your Windows machine. You add an MCP server to Cursor, then hand-translate the same config into TOML for Codex. Every agent speaks its own dialect of the same few ideas, and none of them talk to each other.

```bash
npm install -g agent-sync
agent-sync setup --create-remote agent-library
```

That creates a private git repository for your library, registers the machine, and deploys agent-sync's own skills into every agent it finds. From then on you can just ask any of them: *"create me a skill for reviewing SQL migrations"* — and it is written to your library, deployed to every agent, committed and pushed, with no second command.

On your next machine:

```bash
agent-sync setup --clone <your-library-url>
```

## What it looks like

```
$ agent-sync status
artifact                         claude        codex         cursor
skill/sql-migration-review       ✔ synced      ✔ synced      ✔ synced
skill/commit-style               ✔ synced      – excluded    – excluded
mcp/github                       ✔ synced      ✔ synced      ⟳ outdated
mcp/postgres                     ✔ synced      – excluded    ✔ synced
```

`agent-sync status --why` explains which rule produced every cell, so "why doesn't Cursor have this?" has an actual answer.

## It will not damage your config

This is the part worth being specific about, because the whole tool depends on it.

Adding an MCP server to a 4.3 KB Codex config with comments, nested env tables and typed values changes exactly this much:

```diff
+
+[mcp_servers.langchain-docs]
+url = "https://docs.langchain.com/mcp"
```

Nothing else moves. Comments stay, key order stays, `120` does not become `120.0`, and a file using CRLF still uses CRLF. Codex's own `codex mcp add` does not manage this — it drops keys, reorders env tables and rewrites numbers, and removing the server afterwards does not undo it.

Three more guarantees, each with tests behind it:

- **A hand-edited file is never silently overwritten.** agent-sync notices, stops with a distinct exit code, and asks whether to keep your edit or replace it.
- **A file it cannot parse is not touched at all.** It refuses rather than guessing.
- **Credentials never enter the library.** MCP values are references (`${secret:name}`); the value stays on the one device, outside git. The CLI refuses a literal credential rather than committing one.

## How it works

```
        ┌────────────────────────────┐
        │   Canonical store (git)    │   ← you edit here, once
        │   skills/   mcp/           │
        │   manifest + routing rules │
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

Routing rules decide what goes where — globally, per project, per agent, per device. Cross-device sync is `git push`/`git pull` on the store, wrapped so you don't think about it.

No server, no account, no lock-in. Your library is a normal git repository full of normal files: if agent-sync disappeared tomorrow, everything in it would still make sense.

## Installing through an agent

You can also let an agent do it. Paste this into any of them:

```
Read https://raw.githubusercontent.com/Alpha-30-creator/agent-sync/main/INSTALL.md and follow it to set up agent-sync for me.
```

It runs inspectable commands, asks you the two questions it genuinely cannot answer, and never handles a credential.

## Documentation

- **[Getting started](docs/getting-started.md)** — what it does, what it writes, and how to adopt an existing setup
- **[Command reference](docs/commands.md)** — every command and flag
- **[Contributing](CONTRIBUTING.md)** — how to work on it
- **[Design docs](docs/design/)** — the spec and the [decision log](docs/design/decisions/), written before the code and kept current

## Design principles

- **Declarative, not imperative.** The manifest describes the end state; `apply` converges to it. Running it twice is a no-op.
- **Functional core, imperative shell.** Decisions are pure functions over plain data; I/O lives at the edges. It is what makes the tool testable, and it is enforced by the build.
- **Never destroy user work.** Drift is surfaced and resolved by you, never silently.
- **Secrets never leave the machine.**
- **Degrade honestly.** Agents have unequal capabilities. agent-sync says what it cannot map rather than pretending everything is portable.
- **One action per intent.** Mutating commands are complete transactions: apply, commit, push.

## Status

Working and in daily use across macOS and Windows. Skills, MCP servers, project scoping and routing are all implemented and tested on three operating systems. Plugin declarations are the main thing not yet supported — both Claude Code and Codex have plugin systems, and they were cut from the first release to get the rest shipped. See the [roadmap](docs/design/08-roadmap.md).

## License

MIT — see [LICENSE](LICENSE).
