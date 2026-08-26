# Tech Stack

Concrete technology choices, each with its reasoning and the alternatives considered. Nothing here is exotic on purpose: this is an open-source tool that manipulates small text files — boring, proven technology is a feature.

---

## 1. Language & runtime: TypeScript on Node.js

**Choice: TypeScript (strict), Node.js ≥ 20 LTS.**

| Candidate | Verdict | Reasoning |
|-----------|---------|-----------|
| **TypeScript / Node** | ✅ chosen | The audience (people who write agent skills and configure MCP servers) overwhelmingly has Node installed and reads TS — maximizes OSS contributors. First-class JSON tooling; excellent YAML/TOML libraries including *format-preserving* ones, which §3 shows is a hard requirement. `npx agent-sync` gives zero-install trial. Strong typing is enough to enforce the pure-core discipline. |
| Go | Strong runner-up | Single static binary is genuinely nicer for distribution. Rejected mainly on contributor alignment and the JSON/YAML "edit-preserving-format" library story being weaker; also slower iteration for one maintainer. If distribution pain ever dominates, the pure core's plain-data design keeps a port feasible. |
| Rust | ❌ | Maximum robustness, minimum velocity. Overkill for a file-shuffling CLI; highest contributor barrier. |
| Python | ❌ | Runtime/env management pain on end-user machines (especially Windows) is exactly the kind of friction this tool exists to remove. |
| Bun/Deno as *required* runtime | ❌ | Fine tools, but requiring them shrinks the audience. We target Node; Bun compatibility is welcome but incidental. |

**TypeScript config:** `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. ESM only. The core is written in a functional style: `readonly` types, discriminated unions for `Operation`/`Diagnostic`/drift states, no classes holding mutable state, errors as returned values (`Result` types) inside the core — `throw` only at the shell boundary.

## 2. Package/toolchain

| Concern | Choice | Notes |
|---------|--------|-------|
| Package manager | **pnpm** | Fast, strict node_modules, standard for modern OSS TS |
| Monorepo? | **No — single package** | One CLI, one publishable unit. `core/`, `adapters/`, `shell/`, `cli/` are folders with lint-enforced boundaries, not packages. Split only if a real second consumer appears (e.g. a GUI). Premature monorepos are a tax. |
| Build | **tsc** → ESM output | Zero config risk for v0; revisit a bundler (tsdown/tsup) only if CLI startup time warrants it |
| Lint/format | **Biome** | One fast tool for both; plus `eslint-plugin-import` alternative if Biome's boundary rules prove insufficient — the *dependency-direction rule* (core imports no I/O) must be machine-enforced, via `dependency-cruiser` in CI |
| Test runner | **Vitest** | See [Testing](07-testing.md) |
| Property testing | **fast-check** | The resolver/planner invariants are property-shaped |
| CI | **GitHub Actions** | Matrix: {ubuntu, macos, windows} × {Node 22, 24} + a node 20 runtime-compat job |
| Releases | **Changesets** + npm publish via CI | Semver, changelog generation, provenance-signed publish |

## 3. Key libraries

Chosen for the unusual hard requirement: **editing user-owned config files without destroying their formatting or unmanaged content** (NFR-4).

| Purpose | Library | Why |
|---------|---------|-----|
| CLI framework | **commander** | Boring, ubiquitous, sufficient. (clipanion/oclif add structure we don't need.) |
| Schema validation | **zod** (v4) | Manifest/lockfile/device-file parsing with precise, human-mappable errors; types inferred from schemas so there's one source of truth |
| YAML | **yaml** (`eemeli/yaml`) | Full document model — preserves comments and formatting when we rewrite `agent-sync.yaml` after CLI edits |
| TOML (Codex config) | **smol-toml** for reading/verification + **our own text-span splicer** for writing | Spike complete ([ADR 0007](decisions/0007-surgical-config-editing.md)): `@ltd/j-toml` mangled 135 lines of a real config and was rejected; `smol-toml` round-trips almost cleanly (2 cosmetic lines) and preserves integer types, so it reads and verifies, but writes go through `src/core/formats/toml-edit.ts`, which never re-serializes the document. |
| JSON with comments/format | **jsonc-parser** (VS Code's) | Verified on a real 53 KB `~/.claude.json`: `modify()`/`applyEdits` confine changes to the managed key path and preserve comments. Caveat recorded in ADR 0007 — it may reflow formatting inside the object it edits. |
| Hashing | node `crypto` (SHA-256) | No dependency needed |
| Prompts | **@clack/prompts** | Pleasant interactive confirms; degrades to flags in non-TTY |
| Terminal output | **picocolors** + hand-rolled matrix rendering | Tiny; avoids heavyweight UI deps |
| Git | **system `git` via subprocess** | Users have git; shelling out inherits their auth (SSH agents, credential helpers, proxies) — reimplementing auth via a JS git lib (isomorphic-git) is where the pain lives. `doctor` verifies git presence. |

Explicitly avoided: any daemon/watcher dependency in v1 (chokidar only if/when `--watch` ships), any network library, any telemetry SDK.

## 4. Cross-platform strategy (G4)

- **Paths:** all path construction goes through one module (`shell/paths.ts` + pure locators) using `node:path`; home resolution via `os.homedir()`; never string-concatenated separators. Windows path shapes are unit-tested from any OS because locators are pure over injected machine facts.
- **No symlinks anywhere** ([Architecture §6](03-architecture.md)).
- **Line endings:** artifacts are written byte-for-byte as stored, and the store pins LF via
  `.gitattributes`. Comparison, however, folds CRLF to LF before hashing: a project-scoped skill is
  committed to the *user's* repository, whose git config we do not control, and git on Windows
  rewrites line endings on checkout. Comparing raw bytes there would report drift on a file nobody
  touched. Files containing a NUL byte are treated as binary and hashed exactly.
- **Atomic writes:** temp file + `rename` in the same directory (rename is atomic on all three OSes within a volume).
- **Case-insensitive filesystems** (macOS/Windows default): artifact ids are required lowercase-kebab to dodge collision surprises.
- **CI is the enforcement:** every PR runs the full suite on all three OSes; "works on my Mac" cannot merge. Linux is covered by CI even though the author can't test it by hand — which is precisely why it's in the matrix.

## 5. Distribution

1. **npm:** `npm i -g agent-sync` / `pnpm add -g` / one-off `npx agent-sync doctor`. Primary channel; audience has Node.
2. **Later (post-v1):** Homebrew tap and Scoop/winget manifests wrapping the npm package or a Node-SEA/`bun build --compile` single binary — only if issue traffic shows real demand from Node-less users.

Binary name: `agent-sync`. Alias `asy` considered and deferred: one canonical name until the CLI surface settles.

## 6. Dependency policy (open-source hygiene)

- Runtime dependency budget: **≤ 10 packages**, each justified in this doc; dev-deps unconstrained but reviewed.
- `pnpm-lock.yaml` committed; Renovate for updates; `pnpm audit` in CI.
- No postinstall scripts, ours or (where feasible) our dependencies'.
- npm publish with provenance from CI only.

## 7. Repository layout (implementation phase)

```
agent-sync/
├── docs/                  # these documents
├── src/
│   ├── core/              #   pure — see Architecture §2 for the full inner map
│   ├── adapters/
│   ├── store/
│   ├── shell/
│   ├── formats/
│   └── cli/
├── test/
│   ├── unit/              # mirrors src/core + pure adapter parts
│   ├── integration/       # temp-dir filesystem tests per adapter/writer
│   ├── e2e/               # full CLI flows against fabricated agent homes
│   └── fixtures/          # real-world sample configs (claude.json, config.toml, mcp.json…)
├── .github/workflows/     # ci.yml (3-OS matrix), release.yml
├── biome.json  tsconfig.json  vitest.config.ts  package.json
└── LICENSE (MIT)  CHANGELOG.md  CONTRIBUTING.md
```
