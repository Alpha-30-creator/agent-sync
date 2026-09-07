---
name: agent-sync-create-skill
description: Create, write, or improve an agent skill when agent-sync manages this machine. Use when the user says create a skill, write a skill, make a skill for X, add a skill, improve or refine an existing skill, or asks you to turn a repeated workflow into a reusable skill. Authors it in the canonical library so it reaches every agent and every device instead of only the one in front of you.
---

# Create a skill in the library, not in this agent

The user's skills live in one canonical library that agent-sync deploys into every agent
on every one of their machines. A skill written directly into this agent's own skills
directory exists in exactly one place, and agent-sync will later report it as unmanaged
drift. **Write it in the library instead — then it is born synced.**

## The flow

1. **Scaffold in the library.**

   ```
   agent-sync new skill <id> --description "<one line>" --json
   ```

   The id is lowercase, digits, hyphens and underscores only. The command prints the
   path it created inside the library — that path is where you write.

2. **Write the skill there.** Author `SKILL.md` at the path step 1 printed, plus any
   reference files it needs beside it. Do not create anything in `~/.claude/skills`,
   `~/.codex/skills`, `~/.cursor/skills`, or a project's agent directories.

3. **Ship it in one transaction.**

   ```
   agent-sync save skill/<id> --json
   ```

   That validates, deploys to every routed agent, commits, and pushes. If the push fails
   because the machine is offline, the local work is still applied and committed — say so
   and move on; the next sync retries.

4. **Report what happened.** Read `save`'s JSON and tell the user which agents received
   it, and that their other devices pick it up on the next `agent-sync sync`.

## Writing a good skill

The `description` is the only part always in an agent's context, so it decides whether
the skill is ever used. Write it as *when to use this*, in the user's vocabulary, not as
a summary of the contents. Name the trigger phrases someone would actually say.

Keep the body tool-neutral: no `.cursor/`-specific or `.claude/`-specific paths, so the
same file works in all three agents.

## Routing it somewhere specific

By default a skill deploys to every agent that supports skills. To narrow it:

```
agent-sync route skill/<id> --targets cursor codex
agent-sync route skill/<id> --project here --targets cursor
```

For a skill that only makes sense inside one project, scope it to that project rather
than deploying it everywhere:

```
agent-sync add skill <path> --scope project
agent-sync include skill/<id>
```

## If something goes wrong

`save` exits non-zero and says why. Exit 3 means it needs a decision from the user — read
the message and ask them, do not guess. See [troubleshoot.md](troubleshoot.md).

## What next?

Invoke with `/skill-name` in Cursor or Claude Code, `$skill-name` in Codex.

- `agent-sync` — check where things are deployed, fix drift, sync other devices
- `agent-sync-add-mcp` — if what the user actually wants is an MCP server, not a skill
