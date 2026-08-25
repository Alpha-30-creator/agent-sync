# 0003 — Deploy by copying + a hash lockfile, never symlinks

**Status:** accepted (2026-08-25)

**Context.** The obvious dotfiles approach is symlinking store folders into agent directories.

**Decision.** Copy real files into each agent location and track `(artifact hash, target path,
deployed hash)` in a per-device lockfile kept outside the synced repo.

**Consequences.** Works identically on Windows (symlinks there need Developer Mode or elevation) and
inside project checkouts that get cloned or moved. The three-way hash comparison gives drift
detection for free, which is what makes "never destroy user work" mechanical rather than aspirational.
Cost: deployed copies can drift, so `apply` must classify and ask — by design.

**Alternatives rejected.** Symlinks (Windows friction, inconsistent agent/watcher behavior, breaks
when the store isn't present); hardlinks (same volume only, confusing edit semantics).
