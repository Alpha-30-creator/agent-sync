# 0002 — Cross-device sync uses a user-owned git repo

**Status:** accepted (2026-08-25)

**Context.** State must move between machines (macOS + Windows), with history and conflict handling,
for an open-source tool with no budget for infrastructure.

**Decision.** The canonical store is a git repository the user owns; `agent-sync sync` wraps
pull/apply/commit/push. Git is invoked as the system binary via subprocess so it inherits the user's
existing auth (SSH agent, credential helpers, proxies).

**Consequences.** Zero infrastructure, offline-capable, every artifact edit has history and revert.
Requires git on PATH (checked by `doctor`). Merge conflicts are possible but rare and localized,
because artifacts are small independent files.

**Alternatives rejected.** A hosted service (infra + accounts + trust, kills the no-lock-in promise);
file-sync folders like Dropbox/iCloud (no merge semantics — concurrent edits corrupt silently);
manual export/import bundles (punts the actual problem back to the user).
