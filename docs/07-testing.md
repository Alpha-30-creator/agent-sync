# Testing Strategy

The architecture was chosen to make testing easy; this doc says how we cash that in. Requirement G6 ("a proper testing suite") is satisfied by four layers, each with a distinct job, plus a CI matrix that makes cross-platform correctness enforced rather than hoped.

---

## 1. Principles

1. **Test the core exhaustively, the shell representatively.** All decision logic is pure ([Architecture §1](03-architecture.md)), so the vast majority of tests are fast, deterministic, plain-data unit tests with **no mocks and no filesystem**. The effectful shell is small and gets integration tests against real temp directories.
2. **Never mock what you can inject.** The core takes snapshots as arguments; tests hand it literal data. Mocking frameworks are a smell here — if a core test needs one, the code under test is leaking I/O and the design is being violated.
3. **Fixtures are real-world artifacts.** `test/fixtures/` holds genuine (sanitized) examples of `~/.claude.json`, Codex `config.toml` with comments and unrelated settings, Cursor `mcp.json`, and messy `SKILL.md` files. Every bug found in the wild adds its triggering fixture.
4. **The spec docs are executable.** Every worked example in [Sync Model §6](04-sync-model.md) and every invariant in §9 exists as a named test. Doc and code drifting apart should fail CI, not linger.

## 2. Layer 1 — Unit tests (core): the bulk

Target: **~100% branch coverage of `src/core`** (enforced threshold; the core has no excuse for untested branches — it's all data-in/data-out).

Coverage by module:

- **resolver/** — the precedence ladder: every layer alone, every pair of layers, `add`/`remove` modifiers, device masks, capability filtering, provenance chains. Table-driven: each case = `(manifest fragment, device, expected routing table)`.
- **planner/** — routing table + snapshot + lockfile → plan: the full drift classification table from [Architecture §6](03-architecture.md) (each of the seven rows is a named test), minimum-copy placement for the Cursor overlap matrix ([Sync Model §7](04-sync-model.md)), plan emptiness on converged state (idempotence), deletion planning on `rm`/route-shrink.
- **translate/** — canonical MCP → each dialect: stdio/http/sse, env and secret indirection, unsupported-field warnings, and **round-trip properties** (translate → parse-back → semantic equality) per dialect.
- **validate/** — every schema violation class produces the right error path/message; error-message snapshot tests keep them humane.
- **drift/** — hash classification edge cases: missing lockfile, lockfile referencing deleted artifacts, identical-content-unknown-provenance adoption.

## 3. Layer 2 — Integration tests (shell + adapters)

Real filesystem, temp directories, no mocks — these verify the thin effectful layer actually does what plans say, per OS.

- **Surgical writers (the high-risk code):** given fixture `config.toml` / `~/.claude.json` files full of unrelated content and comments → apply an edit script → assert managed section correct **and** everything else byte-identical (or, where the format library can't preserve comments, semantically identical with the deviation explicitly asserted so regressions are visible). Corrupt-input fixtures assert we refuse to write rather than "fix" a file we can't parse.
- **Atomicity & safety:** write interrupted by injected fault → original file intact + backup present; permissions preserved; `0600` on secrets.
- **Store & git:** `init`/`clone`/`sync` against a local bare repo fixture; conflict scenario produces the guided-stop behavior, `--continue` completes.
- **Readers/import:** fabricated agent home directories → correct snapshot/candidate extraction.

## 4. Layer 3 — Property-based tests (fast-check)

The resolver and planner invariants ([Sync Model §9](04-sync-model.md)) are properties over generated manifests/devices/snapshots:

- resolution is total, deterministic, declaration-order-independent
- masks and capability filters only shrink; every shrink leaves a diagnostic
- **plan idempotence:** `plan(apply-simulated(snapshot, plan(snapshot))) = ∅`
- **convergence:** from any generated starting snapshot, one simulated apply reaches the desired state
- translate round-trips preserve semantics for all generated canonical MCP defs
- the core never throws on any generated valid input (and `validate` rejects all generated *invalid* manifests with a located error)

Simulated apply is itself pure (apply a plan to an in-memory snapshot), so these run thousands of cases in seconds.

## 5. Layer 4 — End-to-end tests (CLI)

Spawn the built CLI with `HOME`/`USERPROFILE` and store path pointed at a fabricated environment; drive real command sequences; assert on real resulting trees and exit codes.

Golden scenarios (mirroring [CLI Spec §5](06-cli-spec.md)):
1. init → add skill → apply → skill present in all three agents' global dirs
2. Full second-machine onboarding: clone → link → apply → parity with machine one (two fake HOMEs, one bare repo)
3. The PRD scenario: project default cursor-only + one-skill `add: codex` override
4. Drift: hand-edit a deployed skill → `apply` exits 3 → `--adopt` pulls the edit into the store → `sync` → second machine receives it
5. `import` adoption of a pre-populated agent home
6. Non-interactive: every prompt path covered by its flag equivalent (`--yes --overwrite`, etc.)

Agent-native additions ([Agent-Native §6](09-agent-native.md)):
7. **Skill-pack conformance:** a scripted "agent" (a test harness, not an LLM) executes the flagship create-skill flow using *only* the commands named in the skill pack's references and the CLI's JSON outputs — proving the documented flow and the real CLI never drift apart. Same for the add-mcp and routing references.
8. **Agent-mode contract:** every command run with non-TTY stdout: zero prompts, valid `schemaVersion`'d JSON, correct exit codes; property-style sweep over the command surface.
9. **Heartbeat safety:** given drifted/conflicted fixtures, heartbeat provably performs no writes and emits the notice; given clean-behind fixtures, it converges.
10. **Hook installers:** install → fabricated agent settings contain the hook → uninstall restores byte-identical config (the surgical-edit guarantees apply to our own hooks too).

E2E count stays small (~20 scenarios); they're the slowest and least precise layer — breadth lives below. (True LLM-in-the-loop evals of the skill pack are a release-checklist item alongside the manual smoke test, not CI — nondeterministic and paid.)

## 6. CI matrix & gates

```
GitHub Actions, per PR:
  test:      {ubuntu-latest, macos-latest, windows-latest} × {node 22, 24} (+ node 20 runtime-compat job)
             → typecheck, lint, dependency-direction check (dependency-cruiser),
               unit + property + integration + e2e, coverage upload
  gates:     core branch coverage = 100%*
             no `src/core` → shell imports; no new runtime deps without docs/05 update
```

\* 100% is realistic *because* the core is pure and plain-data; the threshold is the point — it
keeps effectful code from sneaking into `core/`, since untestable branches show up as coverage
failures. In practice it has already paid for itself: reaching it forced unreachable defensive
fallbacks out of the reference parser and turned provenance into a union type that cannot be
half-populated.

There is deliberately **no global coverage threshold**. The e2e suite drives the built CLI as a
subprocess, so the shell code it exercises hardest is not instrumented, and a global number would
mostly measure that artefact rather than real risk. The shell's safety properties are asserted
directly instead — atomic writes, backups, byte-exact config edits, and the golden CLI scenarios.

Windows runs are not optional or allow-fail. Most real-world breakage will be Windows paths/attributes; the author can hand-test Windows but Linux only via CI — which is exactly what the matrix covers.

## 7. Test data honesty

- Fixtures must be periodically re-validated against live agents ("does Claude Code still parse this `.mcp.json`?"). A **manual smoke checklist** (docs/checklists/smoke.md, written at v0.1) covers the one thing automation can't: that the *agents themselves* actually discover and load what we deploy. Run on the author's Mac + Windows before each release.
- The capability table carries a `verifiedAgainst` version per agent (e.g. `cursor: "2.4.x"`); `doctor` surfaces staleness, and releases bump these deliberately.
