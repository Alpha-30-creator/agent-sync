## What this changes, and why

<!-- The diff says what. Say why: the behaviour that was wrong, or the thing that was missing. -->

## Checklist

- [ ] `pnpm verify` is green
- [ ] New behaviour has a test in this same commit
- [ ] For a bug fix: I reverted the fix and confirmed the test fails without it
- [ ] Documented behaviour that changed is updated in this same commit
- [ ] No AI attribution anywhere — no `Co-Authored-By`, no "generated with"

<!--
Two things this project cares about more than most:

- Nothing under src/core/ touches the filesystem, network, clock, randomness or the
  environment. `pnpm check:deps` enforces it.
- Writes into a user's agent config merge surgically, back up first, and refuse rather
  than guess. If this change can overwrite something a user made, say so explicitly.
-->
