---
name: agent-sync
description: Manage the user's agent-sync setup - check what is deployed where, sync devices, resolve drift, change routing, adopt existing config, or diagnose why a skill or MCP server is missing from an agent. Use when the user says sync my skills, what is deployed, why does Cursor not have X, my skills are out of date, adopt what is on this machine, or asks to route an artifact to particular agents.
---

# Driving agent-sync

The user keeps one canonical library of skills and MCP servers, versioned in git, and
agent-sync projects it into every agent on every device they own. This skill covers
running it. To *create* things, use `agent-sync-create-skill` or `agent-sync-add-mcp`.

Every command takes `--json` and returns a stable, versioned envelope. Prefer it — branch
on the data, not on prose.

## Exit codes are the contract

| Code | Meaning | What to do |
|---|---|---|
| 0 | done | report it |
| 1 | error | read the message; do not retry blindly |
| 2 | done, with warnings | report the warnings — something could not be fully honoured |
| 3 | needs a decision | **ask the user**; never choose for them |

## Where things stand

```
agent-sync status --json
```

A matrix of every artifact against every agent. `synced` is converged, `outdated` means
the library moved on, `drifted` means the deployed copy was edited by hand, `conflicted`
means both sides changed, `collision` means something unmanaged is already sitting in
that spot, `excluded` means routing deliberately sends it elsewhere, and `missing` means
it should be there and is not. An asterisk in the human output means one copy is serving several agents that
read the same directory — that is intended, not a bug.

`agent-sync status --why` explains which rule produced each deployment, which is the
answer to "why does Cursor not have this?".

## The daily loop

```
agent-sync sync
```

Pull, apply, push. Run it when the user wants their devices in step, or when a change
made on another machine has not shown up here.

## Drift: never resolve it silently

If `apply` or `sync` exits 3, someone edited a deployed file by hand. agent-sync will not
guess. Show the user what drifted and ask which they want:

- `agent-sync apply --adopt` keeps the edit and copies it back into the library
- `agent-sync apply --overwrite` discards the edit and restores the library version

Both are destructive in one direction. Ask; do not pick.

## Routing

```
agent-sync route skill/<id> --targets claude cursor   # exactly these agents
agent-sync route skill/<id> --add codex               # one more
agent-sync route --type skill --targets all           # default for every skill
agent-sync disable skill/<id>                         # off on this device only
```

## Adopting what is already on the machine

```
agent-sync import
```

Reports what it found and changes nothing. Review it with the user, then adopt with
`--adopt`, or `--only <ref>` for a specific one. Servers that cannot travel between
machines are refused with a reason — that is correct behaviour, not a failure.

## Diagnosing

```
agent-sync doctor
```

Reports the store, git, and which agents are installed with their versions. Start here
when something is missing. If an agent's version is outside the range agent-sync has
verified, it says so — layouts may have moved.

For failures, warnings and drift in detail, see [troubleshoot.md](troubleshoot.md).

## What next?

Invoke with `/skill-name` in Cursor or Claude Code, `$skill-name` in Codex.

- `agent-sync-create-skill` — when the user wants a new or improved skill
- `agent-sync-add-mcp` — when the user wants to connect an MCP server
