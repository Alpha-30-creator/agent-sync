# Contributing

Thanks for looking at `agent-sync`. It's early — the design docs in `docs/` are ahead of the code,
which makes this a good time to argue about the design as well as the implementation.

## Orientation

1. `README.md` — what the tool is.
2. `docs/04-sync-model.md` — the routing/precedence model; the heart of the product.
3. `docs/03-architecture.md` — how the code is laid out and why.
4. `docs/decisions/` — short ADRs. If you want to change a settled decision, write one that
   supersedes it rather than drifting the code.

## Setup

```bash
corepack pnpm install    # or: npm i -g pnpm && pnpm install
pnpm verify              # typecheck + lint + boundary check + tests
```

Node ≥ 20. Everything is cross-platform: macOS, Windows, and Linux are all first-class and all
run in CI.

## The rules that matter

- **`src/core/` is pure.** No filesystem, network, clock, randomness, or `process.env` — decisions
  are pure functions over plain data, effects live in the shell. This is enforced by
  `pnpm check:deps`, not by good intentions.
- **Never destroy user work.** Anything that writes to a user's agent configuration merges
  surgically, backs up first, and refuses rather than guesses when it can't parse a file.
- **Tests ship with the change.** Core logic gets table-driven unit tests; model invariants get
  property tests; bug fixes start with the failing fixture that reproduces them.
- **Conventional commits** (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`), small and
  focused.

## Reporting agent-layout breakage

Agent vendors move their config paths and formats often. If `agent-sync` deploys somewhere your
agent no longer reads, open an issue with the agent name and version and the output of
`agent-sync doctor --json` — that maps directly onto the capability table the adapters are built on.
