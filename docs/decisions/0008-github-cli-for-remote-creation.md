# 0008 — Create the store repository through the GitHub CLI

**Status:** accepted (2026-09-01)

**Context.** `init --remote <git-url>` assumed a repository that already existed, and said so
nowhere. The first real adoption run stopped on exactly that: the URL was accepted, the store was
created, and the mismatch only surfaced later as a failed push against a repository nobody had
made. Setting up the first machine meant leaving the terminal, creating a repository in a browser,
and coming back with a URL — the sort of step a tool whose whole premise is "one command per
machine" should not require.

**Decision.** `init --create-remote <name>` takes a repository *name* (`agent-library`, or
`owner/agent-library`) and creates it by shelling out to `gh`, then sets it as `origin` and pushes
the first commit. `gh` is an optional dependency: nothing else in agent-sync needs it, so its
absence is a message on this one path rather than a startup requirement. Repositories are private
by default. The URL handed to git follows the protocol `gh` itself is configured for (`gh config
get git_protocol`), rather than always the ssh form. `--remote` keeps its existing meaning and the
two flags are mutually exclusive.

**Consequences.** First-machine setup is one command. Every failure mode that can be detected
cheaply — no `gh`, not signed in, an invalid name, a repository that already exists — is checked
before the store directory is written, so a rejected invocation leaves nothing behind and a
half-made library is not a state the user can reach. A repository created but not pushed (no
network, no key) keeps the library and warns, because the local work is fine and `sync` will
retry. Cost: one more external binary on one path, and a GitHub-shaped assumption in a tool that
is otherwise forge-agnostic — the pure half (name parsing) is deliberately separate from the `gh`
half so a second forge is a new shell module, not a rewrite.

**Alternatives rejected.** Creating the repository over the GitHub REST API with a token
(agent-sync would have to acquire, store and refresh a credential — precisely the thing it refuses
to do for MCP servers, and `gh` already holds one); teaching `--remote` to create the repository
when the URL 404s (silently turning a typo'd URL into a new repository is exactly the kind of
liberty ADR 0003's "never guess" rule exists to prevent); leaving it manual and only improving the
error message (fixes the confusion, not the errand).
