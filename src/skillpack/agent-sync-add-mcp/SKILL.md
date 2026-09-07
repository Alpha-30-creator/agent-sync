---
name: agent-sync-add-mcp
description: Add, connect, or set up an MCP server when agent-sync manages this machine. Use when the user says add an MCP server, connect a server, set up MCP for X, install an MCP integration, or asks to make a tool or service available to their agents. Defines it once in the canonical library so every agent and every device gets it, instead of hand-editing one agent's config.
---

# Add the MCP server to the library, not to this agent's config

Every agent stores MCP servers in its own format and its own file — Claude in
`~/.claude.json`, Codex in TOML, Cursor in its own JSON. agent-sync keeps one canonical
definition and translates it into each dialect. **Edit the library; never hand-edit an
agent's config**, or agent-sync will report it as drift and the other agents and devices
will never see it.

## Never put a credential in the command line

This is the rule that matters most. Tokens, API keys and passwords must not appear in
argv — they end up in shell history, and anything in the library is committed to git.

**You cannot do this step for the user.** Ask *them* to run:

```
agent-sync secret set <name>
```

It prompts for the value and stores it on that device only, outside the library. Then
reference it in the server definition as `${secret:<name>}`, which is what gets committed.
For a value that is already an environment variable on every machine, use `${env:VAR}`
instead. `agent-sync add mcp` refuses a literal credential rather than committing one.

## The flow

1. **Find out what kind of server it is.** Remote servers have a URL; local ones have a
   command to run. Ask if it is not clear from what the user gave you.

2. **Add it.**

   Remote:

   ```
   agent-sync add mcp <id> --url https://example.com/mcp --json
   ```

   Local, with a credential the user has already stored:

   ```
   agent-sync add mcp <id> --command npx --args -y some-server \
     --env API_KEY='${secret:some-key}' --json
   ```

3. **Deploy and publish.**

   ```
   agent-sync save --json
   ```

4. **Report** which agents got it, and repeat any capability warnings verbatim — some
   servers cannot be represented in every agent's dialect, and agent-sync says so rather
   than writing something that will not work.

## Only some agents, or only one project

```
agent-sync route mcp/<id> --targets claude cursor
agent-sync include mcp/<id>          # inside a project directory
```

A server defined inside a project stays with that project rather than deploying
everywhere.

## Things that will not travel

agent-sync refuses to adopt servers tied to one machine — absolute paths, a required
working directory, a relative command. That is deliberate: a definition that only works
on one computer is worse than none. If the user needs one anyway, tell them it has to be
configured in that agent directly, and it will show up as unmanaged.

If a command fails or asks for a decision, see [troubleshoot.md](troubleshoot.md).

## What next?

Invoke with `/skill-name` in Cursor or Claude Code, `$skill-name` in Codex.

- `agent-sync` — check what is deployed where, resolve drift, sync other devices
- `agent-sync-create-skill` — if what the user wants is a skill, not a server
