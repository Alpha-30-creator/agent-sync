# 0009 — Publish under a scoped npm package, keep `agent-sync` as the command

**Status:** accepted (2026-09-08)

**Context.** The npm registry refuses the name `agent-sync`: it is blocked as too similar to
`agentsync`, an existing package which — awkwardly — describes itself as infrastructure for AI
coding agent configuration management. npm's check ignores punctuation, so the two names are
identical to it. This was not discoverable in advance: `npm view agent-sync` returned 404 right up
until the publish attempt, because 404 means *not published*, not *registrable*. Similarity
blocking only runs at publish time.

**Decision.** Publish as `@abdur-codes/agent-sync`. The `bin` stays `agent-sync`, so the command
people type is unchanged. The repository, the artifact ids, the shipped skill names, and
[ADR 0001](0001-name.md)'s reasoning about the name are all unaffected — only the npm coordinate
moves.

**Consequences.** The install line is longer (`npm i -g @abdur-codes/agent-sync`), and scoped
packages must be published with `--access public` or they default to private. In exchange the name
is available immediately with no further guessing, and every daily interaction — `agent-sync
status`, `agent-sync sync`, the skill pack, the docs — reads exactly as designed. It also avoids
shipping a near-identical name to a package in the same niche, which would have been confusing for
users of both projects regardless of who registered first.

Scoped names skip the similarity check, so this also removes the class of failure entirely rather
than trading one uncertain name for another.

**Alternatives rejected.** A different unscoped name (every candidate is a gamble until the publish
attempt, anything near "agentsync" risks the same block, and it would have rippled through ADR
0001, the README, the three shipped skill ids and the docs for a marginally shorter install line);
disputing the block with npm support (slow, and `agentsync` has both prior registration and a
genuinely similar purpose, so the likely answer is no while publishing stalls).
