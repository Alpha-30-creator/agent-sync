# Release smoke checklist

Run on a real Mac and a real Windows machine before each release, after CI is green.

Everything here is deliberately outside what the test suite can prove. The suites verify
that agent-sync **writes** the right bytes to the right paths; they cannot verify that
the agents themselves then **discover and load** what was written. That gap is the whole
reason this checklist exists — a release can be perfectly green and still deploy skills
into a directory an agent stopped reading two versions ago.

Record the agent versions you ran against, and add them to `verifiedAgainst` in
`src/adapters/capability-table.ts` afterwards.

## 1. Install as a stranger

- [ ] `npm rm -g @abdur-codes/agent-sync` first, so nothing is served by a linked development checkout.
- [ ] `npm i -g @abdur-codes/agent-sync`, then `agent-sync --version` from a **new** shell in an
      unrelated directory.
- [ ] On Windows, confirm the `.cmd` shim runs from a normal shell, not only from the one
      the install happened in.

## 2. Set up from nothing

- [ ] `agent-sync setup --device <name>` against a scratch `HOME`.
- [ ] `agent-sync doctor` — all installed agents detected, versions reported.
- [ ] Run `setup` a second time: it must converge, keep the device name, and write nothing.

## 3. The agents actually load the pack — the part only a human can check

For each of Claude Code, Codex and Cursor, in a real session:

- [ ] The three `agent-sync*` skills appear in the agent's own skill list.
- [ ] Asking "create me a skill for X" activates `agent-sync-create-skill` rather than the
      agent's built-in behaviour. **This is the interceptor's whole purpose** — if the
      agent writes the skill into its own directory instead of the library, the
      description needs tuning, and that is a release-blocking defect.
- [ ] Asking "add an MCP server for X" activates `agent-sync-add-mcp`.
- [ ] Asking "sync my skills" activates `agent-sync`.
- [ ] Follow one flagship flow end to end: ask an agent to create a skill, and confirm it
      is authored in the library, deployed, committed and pushed with no follow-up
      command from you.

## 4. MCP round-trips into live agents

- [ ] Add a remote MCP server through agent-sync, `apply`, then **restart each agent** and
      confirm the server actually connects — not merely that the config file looks right.
- [ ] Open the config each agent wrote and confirm nothing else in it changed.

## 5. Nothing is destroyed

- [ ] Hand-edit a deployed skill, run `apply`: exit 3, refuses, names both ways out.
- [ ] `apply --adopt` keeps the edit; `apply --overwrite` restores it.
- [ ] Confirm a backup was written under `~/.agent-sync/backups/` before the first config
      edit of the run.
- [ ] Put an unmanaged file in an agent's skills directory and confirm `apply` leaves it
      untouched.

## 6. Two machines

- [ ] Make a change on machine A, `save`, `sync` on machine B, confirm it arrives.
- [ ] Make a change on B, send it back to A. Both directions, not just the first.
- [ ] On Windows specifically, confirm a config that uses CRLF still uses CRLF afterwards.

## 7. The install runbook

- [ ] Give an agent the paste-line from the README and let it drive `INSTALL.md`
      unaided, against a scratch `HOME`. Watch for any step where it has to guess.
