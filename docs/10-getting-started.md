# Getting started

A guide for someone who has never used agent-sync. No prior context assumed.

---

## The problem, in one paragraph

You use more than one coding agent — Claude Code, Codex, Cursor — and more than one
computer. Every agent can be taught new tricks three ways: **skills** (a folder with a
`SKILL.md` telling the agent how to do something), **MCP servers** (connections to
outside tools like GitHub or a database), and **plugins** (bundles of the above). Each
agent keeps these in its own folders, in its own file formats. So a skill you write in
Claude Code doesn't exist in Cursor, an MCP server you set up on your laptop doesn't
exist on your desktop, and nothing tells you about the gaps.

## The idea, in one paragraph

Keep **one library** of these things — a plain folder, backed by git, that you own.
Write down **rules** about which agents should get what. Then run **one command** that
makes every agent on the machine match the library. Do the same on your other computer
and both machines agree. That's the whole tool.

## Five words you need

| Word | Means |
|---|---|
| **Library** | Your one canonical folder of skills, MCP servers, and plugin declarations. It's a git repository you own. Also called the *store*. |
| **Artifact** | One thing in the library: a skill, an MCP server, or a plugin. Referred to as `skill/db-migrate`, `mcp/github`. |
| **Route** | The rule that says which agents an artifact goes to. "This skill goes to Claude and Cursor, not Codex." |
| **Device** | One computer. Each device knows its own name, which agents are installed, and where your projects live locally. |
| **Project** | A specific codebase. Artifacts can be **global** (available in every project) or **project-scoped** (only inside one repo). |

## What it puts on your disk

```
~/.agent-sync/
├── store/              ← your library. a git repo. this is the thing that syncs.
│   ├── agent-sync.yaml ←   the rules: what exists, where it goes
│   ├── skills/         ←   one folder per skill
│   ├── mcp/            ←   one small file per MCP server
│   └── plugins/
├── device.yaml         ← this computer only: its name, its agents, its project paths
├── secrets.yaml        ← this computer only: API keys. never synced, never committed.
├── lock/               ← this computer only: a record of what was deployed where
└── backups/            ← copies of your agent configs, taken before any edit
```

Everything above `store/` is **local to the machine** and never leaves it. Only
`store/` is shared between your computers, and it never contains a credential.

Inside your agents, it writes to the places those agents already read:
`~/.claude/skills/`, `~/.codex/skills/`, `~/.cursor/skills/`, `~/.claude.json`,
`~/.codex/config.toml`, `~/.cursor/mcp.json`.

## Setting up the first machine

```bash
agent-sync init --create-remote agent-library
```

Creates the library, makes it a git repo, **creates the GitHub repository for you**, pushes
the first commit, and registers this computer. It detects which agents you have installed.

The repository is private unless you add `--public`, and it is made under the account your
GitHub CLI is signed in as — `agent-library` and `you/agent-library` both work. This needs
[the GitHub CLI](https://cli.github.com) (`gh auth login` once).

If you would rather make the repository yourself, or it already exists, point at it instead:

```bash
agent-sync init --remote git@github.com:you/agent-library.git
```

```bash
agent-sync import
```

Looks at what's already on the machine and lists skills and MCP servers that aren't in
your library yet. **It changes nothing** — it just shows you the list. Add `--adopt`
when you're happy with it, and those things move into the library. If a value looks
like a password or API key, it is pulled out into `secrets.yaml` on that machine only,
and the library gets a `${secret:name}` placeholder instead.

```bash
agent-sync apply
```

Makes the machine match the library. This is the command you'll run most.

## The daily loop

```bash
agent-sync new skill sql-review --description "Check migrations for danger"
# edit ~/.agent-sync/store/skills/sql-review/SKILL.md
agent-sync save
```

`new` creates the skill **inside the library**, so it's synced from birth — there's no
"now import it" step. `save` validates it, deploys it to every routed agent, commits,
and pushes. One command, complete.

On your other computer:

```bash
agent-sync sync
```

Pulls, applies, pushes. That's it.

## Setting up the second machine

```bash
agent-sync clone git@github.com:you/agent-library.git
agent-sync apply
```

Now both machines have the same skills and MCP servers in all their agents.

## Controlling where things go

```bash
agent-sync status              # what's deployed where, and what's out of date
agent-sync status --why        # …and which rule decided that
```

```bash
agent-sync route skill/commit-style --targets claude          # this skill: Claude only
agent-sync route --type mcp --targets claude cursor           # all MCP servers by default
agent-sync disable mcp/heavy-thing                            # off on this computer only
```

For a specific project, run inside it:

```bash
agent-sync link                                    # register this folder as a project
agent-sync include skill/db-migrate                # deploy this skill here
agent-sync route --type skill --project here --targets cursor    # in this project: Cursor only
agent-sync route skill/db-migrate --project here --add codex     # …except this one, also Codex
```

`link` writes a small `.agent-sync.yaml` file in the project. Commit it, and your other
computers recognise the project automatically — even though the folder lives at a
different path there.

## MCP servers and secrets

```bash
agent-sync add mcp github --command npx --args -y @modelcontextprotocol/server-github \
  --env 'GITHUB_TOKEN=${secret:github-token}'

printf %s 'ghp_yourtoken' | agent-sync secret set github-token --stdin
```

The library stores `${secret:github-token}`. The real value lives only on that machine,
in a file that is never committed and never synced. On another computer you set the
same secret name once, and everything works there too.

If you try to put a real credential directly into the library, agent-sync refuses and
tells you to use a secret instead. Secret values are never accepted as command
arguments, because arguments end up in your shell history.

## What it leaves alone

Each agent ships its own built-in skills, and those are never yours to sync. Happily,
every agent keeps them somewhere separate — Codex under `~/.codex/skills/.system/`,
Claude under `~/.claude/plugins/…` — so `import` simply never looks at them. Anything
beginning with a dot is treated as the agent's own.

MCP servers are harder, because an agent's own servers sit in the same list as yours.
Codex's `node_repl`, for instance, points at paths inside the ChatGPT app bundle;
copying that to another computer would produce configuration that cannot work. So
`import` flags anything containing an absolute path as **machine-specific** and does not
adopt it by default:

```
  mcp/github          claude  ~/.claude.json
· mcp/node_repl       codex   ~/.codex/config.toml
      contains an absolute path — looks specific to this machine…
```

The `·` marks what will be skipped. Use `--only mcp/github skill/x` to pick exactly what
you want, or `--include-machine-specific` to take everything. This is a hint, not
certainty: an agent can install a server that looks perfectly ordinary, which is why
import always reports before it adopts.

## Why you can trust it with your config

- **It never overwrites your edits.** If you hand-edit a deployed file, `apply` stops
  and asks: keep your version (`--adopt`, which copies it back into the library) or
  replace it (`--overwrite`). It never silently picks.
- **It only touches its own entries.** Your Codex `config.toml` holds your model
  settings, plugins, and project trust levels. agent-sync edits only the MCP entries it
  manages and leaves every other byte alone — including comments. (Codex's own CLI does
  not: it rewrote unrelated settings in testing.)
- **It refuses what it can't understand.** A config file it cannot parse is never
  written to. It says so and stops.
- **It backs up first.** Copies land in `~/.agent-sync/backups/` before any edit.
- **Nothing happens without you asking.** No background process, no daemon. It runs
  when you run it.
- **`--dry-run` is exact.** `agent-sync apply --dry-run` prints precisely what would
  happen and writes nothing.

## Exit codes, if you script it

`0` fine · `1` error · `2` done, with warnings · `3` needs a decision from you.
Every command accepts `--json` for machine-readable output.

## What it does not do yet

- **Plugins are not synced yet** (planned for v1.0). Claude Code and Codex both have
  plugin systems; agent-sync records them but does not yet install them for you.
- **Your agents can't drive it yet.** The plan is for agent-sync to install a skill into
  each agent so you can just say "make me a skill that does X" and it happens. That's
  v1.0 work; today it's a CLI you run yourself.
- **MCP server names must be lowercase** with hyphens or underscores. A server named
  `Docs by LangChain` in your Cursor config can't be imported under that name yet.
- **Rules files** (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules`) are not managed.
