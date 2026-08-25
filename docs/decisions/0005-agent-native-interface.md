# 0005 — Agents are a first-class interface (three intent-split skills)

**Status:** accepted (2026-08-25)

**Context.** Without this, every new artifact costs the user several manual commands per device —
the friction the product exists to remove. The user's agents are already the place where skills and
MCP servers get created.

**Decision.** Three pillars: (1) an agent-readable `INSTALL.md` + idempotent `setup` command, so an
agent can install and configure the tool; (2) a self-hosted skill pack of **three** skills split by
user intent — `agent-sync-create-skill` and `agent-sync-add-mcp` (interceptors that redirect
creation into the store so artifacts are born synced) plus `agent-sync` (the manager); (3) ambient
sync in tiers — transactional auto-sync everywhere, opt-in session-start `heartbeat` hooks where the
agent supports them.

**Consequences.** The CLI must honor an agent-mode contract: never prompt when stdout is not a TTY,
`--json` with `schemaVersion` everywhere, a stable exit-code contract, and no secret values via argv.
Automation may only perform convergent, conflict-free work; anything needing judgment is surfaced
into the next conversation, never resolved unattended.

**Alternatives rejected.** One catch-all skill (a description enumerating every intent matches
nothing sharply; missed activation means the agent edits its own config and creates the very drift
we prevent). Five-plus skills (marginal splits share a vocabulary and compete with each other while
costing context in every session). Deeplink/marketplace-only install (installs one artifact into one
agent; cannot run the store/device/interview flow).
