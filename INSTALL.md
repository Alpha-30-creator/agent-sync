# Install agent-sync

**You are an AI agent reading this on behalf of a user.** Follow it top to bottom. Every
step is a command you can run and check. Report what actually happened at each step; if
something fails, say so rather than working around it.

Safe to re-run: `setup` converges rather than starting over, so if the user already has
agent-sync this repairs their installation instead of duplicating it.

---

## 1. Check prerequisites

```
node --version
git --version
```

Node must be 20 or newer. If either is missing or too old, **stop.** Tell the user what
to install — Node from https://nodejs.org, git from https://git-scm.com — and do not try
to install runtimes yourself.

## 2. Install the CLI

```
npm install -g agent-sync
agent-sync --version
```

If the global install fails for permissions reasons, do not retry with `sudo`. Tell the
user, and offer `npx agent-sync@latest` for the remaining steps instead.

## 3. Ask the user the two questions setup needs

Do not guess these. They decide where the user's library lives.

**Is this their first machine, or are they adding another one?**

**If it is the first machine, where should the library live?** It is a normal git
repository that they own. Three ways, in order of convenience:

- They have the GitHub CLI (`gh`) installed and signed in — offer to create the
  repository for them:
  ```
  agent-sync setup --create-remote agent-library --device "<their machine name>"
  ```
  It is created **private** by default. Only add `--public` if they ask.

- They already made a repository:
  ```
  agent-sync setup --remote <git-url> --device "<their machine name>"
  ```

- They want to decide later — this works and syncs nothing until they add a remote:
  ```
  agent-sync setup --device "<their machine name>"
  ```

**If they are adding a second machine**, they need the URL of the library they already
have:

```
agent-sync setup --clone <git-url> --device "<their machine name>"
```

Pick a device name that identifies the machine to them, like `work-laptop`. It is only a
label, and it is what `status` uses to say where things are deployed.

## 4. Verify, and report honestly

```
agent-sync doctor --json
```

Read the result and tell the user plainly: which agents were detected, whether the store
and git are healthy, and anything it warns about. Exit code 2 means it worked with
warnings — repeat them, do not swallow them. If an agent they use was not detected, say
so; agent-sync can only deploy to agents that are actually installed.

Confirm the skills arrived:

```
agent-sync status
```

They should see `skill/agent-sync`, `skill/agent-sync-add-mcp` and
`skill/agent-sync-create-skill` as `synced`. Those are what let any of their agents drive
agent-sync from now on.

## 5. Offer to adopt what is already on the machine

Only if this is their first machine, and only as an offer:

```
agent-sync import
```

This **changes nothing** — it lists skills and MCP servers already on the machine that
are not in the library. Show the user the list and let them choose. Adopt with
`agent-sync import --adopt`, or `--only <ref>` for specific ones.

Some entries will be refused with a reason — an absolute path, a required working
directory, a command that only resolves here. That is correct: a definition that only
works on one computer should not be synced to another. Do not override it with
`--include-machine-specific` unless the user asks.

**Never handle credentials.** If a server needs a token, the user runs
`agent-sync secret set <name>` themselves. You must not ask for, type, or store the
value.

## 6. Tell them what they have

Say this in your own words:

- Their skills and MCP servers now live in one library, deployed into every agent they
  use on this machine.
- On another machine, they run this same install and choose "adding another machine".
- They can now just ask any of their agents — "create me a skill for X", "add the GitHub
  MCP server", "sync my skills" — and it will be done in the library and deployed
  everywhere. They do not need to remember the CLI.

---

## If something goes wrong

- **`agent-sync: command not found` after a successful install** — npm's global bin
  directory is not on their `PATH`. `npm prefix -g` prints the prefix; the binaries are
  in its `bin` subdirectory. Tell the user; do not edit their shell profile yourself.
- **`git was not found`** — install git first; agent-sync uses it to sync between
  machines.
- **A push failed** — the library is still set up and committed locally. It is a git
  auth problem, not an agent-sync one. They can fix access and run `agent-sync sync`.
- **Exit code 3** — agent-sync needs a decision from the user. Read the message, ask
  them, and never choose for them.

Full command reference: https://github.com/Alpha-30-creator/agent-sync/blob/main/docs/commands.md
