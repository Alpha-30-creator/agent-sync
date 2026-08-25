# 0007 — Never re-serialize a user's config: splice text spans

**Status:** accepted (2026-08-25)

**Context.** agent-sync writes into files it does not own: Codex's `config.toml` holds that
agent's entire state (model settings, plugins, marketplaces, per-project trust levels, an OS
section), and `~/.claude.json` is ~53 KB of mixed user state. NFR-4 promises we never destroy
user work.

Measured against the owner's real configs during M0:

- **Codex's own `codex mcp add` damages the file.** Adding one server dropped `args = []` from an
  unrelated server, reordered another server's `env` keys alphabetically, and rewrote
  `startup_timeout_sec = 120` as `120.0` — a type change in configuration it did not own. Removing
  the server afterwards did *not* undo any of it.
- **`@ltd/j-toml` round-trip:** 135 of 119 lines differed — reordering, restructuring, and quote
  style changes. Rejected.
- **`smol-toml` round-trip:** only 2 cosmetic lines differed (`["mcp"]` → `[ "mcp" ]`), and it
  preserved integer types correctly. Better than the vendor CLI, still not byte-stable.

**Decision.** Never re-serialize the document.

- **TOML:** a pure text-span splicer (`src/core/formats/toml-edit.ts`) locates the managed table's
  line range and splices only that region. `smol-toml` is used to *read* and to *verify* the result
  after editing, never to write.
- **JSON:** `jsonc-parser`'s `modify`/`applyEdits`, which confines changes to the managed key path
  and preserves comments elsewhere in the file.
- **Both:** re-parse after editing and compare the unmanaged regions before writing; back up the
  file before the first edit of a run; refuse to write when the original cannot be parsed.

**Consequences.** Verified against the owner's real 119-line `config.toml`: the untouched prefix is
byte-identical, removal is an exact inverse, comments survive, and an independent parser confirms
unrelated configuration is unchanged. agent-sync is measurably safer with a user's Codex config than
Codex's own CLI is — worth stating plainly in the README.

The splicer is pure text-in/text-out, so this highest-risk path lives in `src/core` with full unit
coverage rather than behind filesystem mocks.

Known limit: `jsonc-parser` may reflow formatting *within* the object it edits (a compact
`"mcpServers": {}` becomes expanded). It never touches content outside the managed key path, and the
result is semantically identical, which we accept and document.

**Alternatives rejected.** Parse-and-re-serialize with any TOML library (demonstrably lossy, and the
losses land in configuration the user owns); hand-rolling a full TOML parser (large surface, no
benefit over splicing); refusing to manage shared files at all (would drop Codex MCP support, the
main reason the tool exists).
