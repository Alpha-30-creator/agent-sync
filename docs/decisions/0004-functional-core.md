# 0004 — Functional core, imperative shell (machine-enforced)

**Status:** accepted (2026-08-25)

**Context.** The tool rewrites user-owned config files across three agents and three OSes. Trust and
testability dominate; the hard logic is precedence resolution, drift classification, planning, and
format translation.

**Decision.** All decision logic lives in `src/core/` as pure functions over plain data — no I/O,
clock, env, or randomness. Effects live in a thin shell (readers snapshot the world; executors apply
a plan). The dependency direction is enforced in CI by dependency-cruiser, not by discipline.

**Consequences.** `--dry-run` is exactly truthful because stages 1–3 are identical for real and dry
runs. Core tests need no mocks and no temp dirs, so ~100% branch coverage of core is realistic and is
set as a CI gate. Cross-platform bugs concentrate in a small, well-tested shell. Any `throw` from core
is by definition a bug.

**Alternatives rejected.** Conventional service/class layering with injected fs (mock-heavy tests,
purity unenforceable, dry-run drifts from real behavior over time).
