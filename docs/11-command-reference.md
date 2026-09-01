# Command reference

Every command, every option, what it means, and an example. Generated against the real
CLI surface — if this and `agent-sync --help` disagree, the CLI is right and this is a bug.

---

## Global options

These work on any command and go **before** the command name.

| Option | Meaning |
|---|---|
| `--store <path>` | Use a different library location instead of `~/.agent-sync`. Useful for rehearsing against a throwaway store without touching your real one. |
| `--json` | Machine-readable output with a stable `schemaVersion`. Every command supports it. |
| `-V, --version` | Print the version. |
| `-h, --help` | Help for the CLI or for any command. |

```bash
agent-sync --store /tmp/rehearsal import      # scan, but keep the library out of the way
agent-sync --json status                      # for scripts and agents
```

## Exit codes

Every command uses the same contract, so you can branch on it in scripts.

| Code | Meaning |
|---|---|
| `0` | Fine — did what was asked, or nothing needed doing. |
| `1` | Error — something was wrong and nothing was changed. |
| `2` | Done, with warnings — converged, but something did not go where you asked. |
| `3` | Needs a decision from you — a hand-edited file, a conflict. Nothing was overwritten. |

---

# Setting up

## `init` — create the library, register this machine

```bash
agent-sync init
agent-sync init --create-remote agent-library --device macbook
agent-sync init --remote git@github.com:you/agent-library.git --device macbook
```

| Option | Meaning |
|---|---|
| `--create-remote <name>` | Create the repository on GitHub, set it as `origin`, and push. Takes `name` or `owner/name` — not a URL. Needs the GitHub CLI, signed in. |
| `--public` | Make the created repository public. Only meaningful with `--create-remote`; the default is private. |
| `--remote <git-url>` | Git remote to sync the library through, for a repository that already exists. Can be added later with `git remote add` inside the store. |
| `--device <name>` | Name for this machine. Defaults to something derived from the platform. Names are lowercase-kebab. |

Creates `~/.agent-sync/`, makes the store a git repo, and detects which agents are
installed. Safe to re-run: an existing store is left alone.

`--remote` and `--create-remote` are mutually exclusive. `--create-remote` checks
everything it needs — the GitHub CLI is installed, you are signed in, the name is valid,
the repository does not already exist — before writing anything, so a rejected command
leaves no half-made library behind. If the repository is created but the first push fails,
the library is kept and pointed at the remote; fix the access and run `agent-sync sync`.

Exit code `1` with `already exists` means the repository is there already: use `--remote`
to sync through it, or `agent-sync clone` if this machine has no library yet.

## `clone` — set up an additional machine

```bash
agent-sync clone git@github.com:you/agent-library.git --device windows-desktop
```

| Argument / option | Meaning |
|---|---|
| `<git-url>` | The library repository to clone. |
| `--device <name>` | Name for this machine. |

Refuses if a library already exists here — use `sync` for that.

---

# The everyday commands

## `apply` — make this machine match the library

```bash
agent-sync apply
agent-sync apply --dry-run
agent-sync apply --adopt
agent-sync apply --agent cursor --project acme-app
```

| Option | Meaning |
|---|---|
| `--dry-run` | Print exactly what would happen and change nothing. |
| `--adopt` | For anything you hand-edited: keep your version and copy it back into the library. |
| `--overwrite` | For anything you hand-edited: replace it with the library's version. |
| `--agent <agent...>` | Only touch these agents. `claude`, `codex`, `cursor`. |
| `--project <id>` | Only touch this project's deployments. |

`--adopt` and `--overwrite` contradict each other; passing both is an error. Without
either, a hand-edited file stops the run with exit `3` and is left untouched.

## `status` — what is deployed where

```bash
agent-sync status
agent-sync status --why
```

| Option | Meaning |
|---|---|
| `--why` | Also print which rule decided each deployment. |

```
artifact                    codex         cursor
skill/db-migrate            ✔ synced      ✔ synced*
skill/scratch-notes         – excluded    ✔ synced

* served by a copy written for another agent, which also reads that directory
```

`✔ synced` · `⟳ outdated` · `⚠ drifted` (you edited it) · `⚠ collision` (something is
there that agent-sync does not manage) · `· missing` · `– excluded` (not routed here).

## `sync` — the daily loop

```bash
agent-sync sync
agent-sync sync --no-push
```

| Option | Meaning |
|---|---|
| `--no-push` | Pull and apply, but do not push your local changes. |

Commits local library changes, pulls, applies, pushes. Stops with guidance if git hits a
conflict.

## `doctor` — check this machine

```bash
agent-sync doctor
agent-sync --json doctor
```

No options. Reports the store location, git availability, the remote, which agents are
detected and their versions, and whether any agent version falls outside what agent-sync
has been verified against.

---

# Building your library

## `new skill` — scaffold a skill in the library

```bash
agent-sync new skill sql-review --description "Check migrations for danger"
agent-sync new skill house-style --scope project --targets cursor
```

| Option | Meaning |
|---|---|
| `--description <text>` | One line describing when the skill applies. Goes into the SKILL.md frontmatter. |
| `--targets <agent...>` | Which agents get it. Defaults to all that support skills. |
| `--scope <scope>` | `global` (default) or `project`. A project skill deploys only where a project includes it. |

Creates the skill **inside the library**, so it is synced from birth. Edit the file it
prints, then run `save`.

## `add skill` — bring an existing folder in

```bash
agent-sync add skill ./my-skill
agent-sync add skill ~/somewhere/review --id code-review --targets claude cursor
```

| Argument / option | Meaning |
|---|---|
| `<path>` | Directory containing a `SKILL.md`. |
| `--id <id>` | Store it under this id instead of the folder name. |
| `--targets <agent...>` | Which agents get it. |
| `--scope <scope>` | `global` or `project`. |

## `add mcp` — add an MCP server

```bash
# a local (stdio) server
agent-sync add mcp github --command npx --args -y @modelcontextprotocol/server-github \
  --env 'GITHUB_TOKEN=${secret:github-token}'

# a remote server
agent-sync add mcp linear --url https://mcp.linear.app/mcp \
  --header 'Authorization=${secret:linear-token}'
```

| Option | Meaning |
|---|---|
| `--command <command>` | Executable to launch, for local servers. |
| `--args <arg...>` | Arguments for that command. |
| `--url <url>` | Endpoint, for remote servers. |
| `--transport <transport>` | `http` (default when `--url` is given) or `sse`. |
| `--env <pair...>` | Environment values as `KEY=value`. Use `${secret:name}` for anything sensitive. |
| `--header <pair...>` | Headers as `KEY=value`, for remote servers. |
| `--targets <agent...>` | Which agents get it. |

If a value looks like a real credential, the command refuses and tells you to store it as
a secret instead — the library is a git repository.

## `save` — validate, deploy, commit, push

```bash
agent-sync save
agent-sync save -m "add sql review skill"
agent-sync save --no-push
```

| Option | Meaning |
|---|---|
| `-m, --message <text>` | Commit message. |
| `--no-push` | Commit without pushing. |

One transaction, so a half-finished change is not left lying around.

## `rm` — remove an artifact everywhere

```bash
agent-sync rm skill/sql-review
agent-sync rm mcp/github
```

| Argument | Meaning |
|---|---|
| `<ref>` | `skill/<id>`, `mcp/<id>`, or `plugin/<id>`. A bare id works when only one type uses it. |

Removes it from the library **and** from every agent it was deployed to. Anything
agent-sync does not manage is left alone.

## `import` — adopt what is already on this machine

```bash
agent-sync import                                    # report only, changes nothing
agent-sync import --adopt                            # take everything it is confident about
agent-sync import --adopt --only skill/x mcp/github  # take exactly these
agent-sync import --adopt --as "Docs by LangChain=docs-langchain"
```

| Option | Meaning |
|---|---|
| `--adopt` | Actually bring things in. Without it, `import` only reports. |
| `--agent <agent...>` | Only scan these agents. |
| `--only <ref...>` | Adopt exactly these references and nothing else. |
| `--as <mapping...>` | Rename on the way in: `"Original Name=chosen-id"`. For names that cannot be ids. |
| `--include-machine-specific` | Also take artifacts that look tied to this machine. |

Scans each agent's global directories, every linked project, **and the directory you run
it from**. Run it inside a project to find that project's skills and MCP servers.

Entries marked `·` in the listing are skipped by default, with the reason underneath.

---

# Projects

## `link` — register this directory as a project

```bash
cd ~/dev/acme-app
agent-sync link              # id defaults to the folder name
agent-sync link acme-app
```

| Argument | Meaning |
|---|---|
| `[id]` | Project id. Defaults to the directory name. |

Writes a small `.agent-sync.yaml` marker into the project. **Commit it** — your other
machines then recognise the project automatically, wherever they keep it.

## `unlink` — stop managing a project on this machine

```bash
agent-sync unlink
agent-sync unlink acme-app
```

| Argument | Meaning |
|---|---|
| `[id]` | Defaults to the marker in the current directory. |

An explicit opt-out: walking back into the project will not silently re-link it. The
marker stays with the repository, so other machines are unaffected.

## `include` / `exclude` — what deploys into a project

```bash
cd ~/dev/acme-app
agent-sync include skill/db-migrate
agent-sync exclude skill/db-migrate
agent-sync include mcp/github --project acme-app
```

| Argument / option | Meaning |
|---|---|
| `<ref>` | `skill/<id>` or `mcp/<id>`. |
| `--project <id>` | Which project. Defaults to the one you are standing in. |

---

# Routing: deciding which agents get what

## `route`

```bash
# this skill, everywhere: Claude only
agent-sync route skill/commit-style --targets claude

# all skills, by default: every agent
agent-sync route --type skill --targets all

# inside this project, skills go to Cursor only
agent-sync route --type skill --project here --targets cursor

# …except this one, which also goes to Codex
agent-sync route skill/db-migrate --project here --add codex

# delete a rule, falling back to the next one up
agent-sync route skill/db-migrate --project here --clear
```

| Argument / option | Meaning |
|---|---|
| `[ref]` | The artifact to route. Omit it and use `--type` to set a default for a whole type. |
| `--type <type>` | `skill`, `mcp`, or `plugin`. Sets the default for that type. |
| `--project <id>` | Scope the rule to a project. `here` means the project you are standing in. |
| `--targets <agent...>` | The exact set of agents. `all` means every agent. |
| `--add <agent...>` | Add agents to whatever the next rule up resolves to. |
| `--remove <agent...>` | Remove agents from whatever the next rule up resolves to. |
| `--clear` | Delete this rule so the next rule up applies again. |

**Which rule wins.** Most specific first:

1. this artifact, in this project — `route <ref> --project here`
2. this artifact, everywhere — `route <ref>`
3. all artifacts of a type, in this project — `route --type skill --project here`
4. all artifacts of a type, everywhere — `route --type skill`
5. the built-in default: every agent that supports the type

A more specific rule *replaces* the less specific one. `--add` and `--remove` are the
exception: they adjust whatever the next rule up produced. `status --why` always tells
you which rule was responsible.

## `disable` / `enable` — this machine only

```bash
agent-sync disable mcp/heavy-profiler
agent-sync enable mcp/heavy-profiler
```

| Argument | Meaning |
|---|---|
| `<ref>` | The artifact to switch off or on here. |

A per-device mask. It can only take things away, never grant them — and it never leaves
this machine.

---

# Secrets

Stored on the machine, never in the library, never in git.

```bash
agent-sync secret set github-token          # asks you for the value; typing is hidden
agent-sync secret ls
agent-sync secret rm github-token

printf %s 'ghp_yourtoken' | agent-sync secret set github-token --stdin   # for scripts
```

| Command | Meaning |
|---|---|
| `secret set <name>` | Store a value. At a terminal it asks you and hides your typing; with `--stdin` it reads the value from a pipe, for scripts and agents. |
| `secret rm <name>` | Remove a secret from this machine. |
| `secret ls` | List secret **names**. Values are never printed. |

Values are never accepted as command arguments, because arguments end up in shell
history and process listings. Reference them from an MCP definition as
`${secret:github-token}`.
