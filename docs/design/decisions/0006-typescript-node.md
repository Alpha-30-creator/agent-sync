# 0006 — TypeScript on Node, single package, pnpm

**Status:** accepted (2026-08-25)

**Context.** One maintainer, an open-source CLI that shuffles small text files, an audience that
already lives in Node tooling.

**Decision.** TypeScript (strict, ESM) on Node ≥ 20, one publishable package (not a monorepo), pnpm,
vitest, biome, `tsc` for build. Runtime dependency budget ≤ 10, each justified in `docs/05-tech-stack.md`.

**Consequences.** `npx agent-sync` gives zero-install trial; contributors need no unfamiliar toolchain.
Best-in-class format-preserving parsers (jsonc-parser, `yaml`, TOML libs) are available here, which the
surgical-edit requirement depends on. Cost: users need Node; single-binary distribution is a post-v1
question.

**Alternatives rejected.** Go (nicer distribution, weaker format-preserving-edit story, smaller
contributor overlap with this audience); Rust (velocity); Python (env friction on Windows — exactly
the pain this tool removes); requiring Bun/Deno (shrinks audience).
