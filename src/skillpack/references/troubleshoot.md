# When an agent-sync command does not do what you expected

Shared by every agent-sync skill. Read the exit code first — it tells you which of these
sections applies.

## Exit 3 — a decision is needed

agent-sync never resolves a judgement call on its own. Exit 3 always means "a human has
to choose". **Ask the user. Do not pick a flag for them.**

The commonest cause is drift: a deployed file was edited by hand, so the library copy and
the deployed copy disagree. `agent-sync status` names which artifact and which agent.
The two ways out are `apply --adopt` (keep the edit, copy it back into the library) and
`apply --overwrite` (discard the edit, restore the library version). Each destroys one
side. That is why it asks.

## Exit 2 — it worked, with warnings

Something could not be fully honoured. Common cases:

- A server cannot be expressed in one agent's dialect, so that agent was skipped.
- An artifact is routed to an agent that is not installed here.
- A `${secret:...}` reference has no stored value on this device. The user runs
  `agent-sync secret set <name>` themselves — you must never handle the value.
- An agent's version is outside the range agent-sync has verified. Layouts may have
  moved; report it rather than assuming it is fine.

Report warnings verbatim. They are not noise.

## Exit 1 — it failed

Read the message before retrying. Frequent causes:

- **No store on this machine.** `agent-sync init` (first machine) or
  `agent-sync clone <git-url>` (an additional one).
- **A config file cannot be parsed.** agent-sync refuses to touch a file it does not
  understand rather than guessing. The user fixes the file; agent-sync will not.
- **A name is not a valid id.** Ids are lowercase letters, digits, `-` and `_`.
  `import` accepts `--as "Original Name=new-id"` to rename on the way in.
- **Git could not push.** Usually offline or an auth prompt. Local work is already
  applied and committed; the next sync retries.

## Nothing appears in one agent

Ask `agent-sync status --why`. Routing may deliberately exclude it, the device may have
it disabled, or the agent may not support that artifact type. `--why` names the exact
rule responsible, so you can explain rather than speculate.

Note that one copy can serve several agents that read the same directory. The human
output marks those with an asterisk. It is intended.

## Never do these

- Never edit a deployed file in an agent's own directory to "fix" a sync problem — that
  creates the drift the tool exists to prevent. Edit the library and apply.
- Never put a credential in a command line or in the library.
- Never delete an entry agent-sync reports as unmanaged. It belongs to the user.
