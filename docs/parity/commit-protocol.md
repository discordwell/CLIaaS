# TS/C++ Parity Commit Protocol

Mandatory format for any commit that modifies TS engine code (`src/EasterEgg/engine/**`)
or WASM source (`src/EasterEgg/CnC_and_Red_Alert/RA/**`) for parity reasons.

## Required commit message structure

```
<type>(<scope>): <session/phase tag> — <one-line summary>

<motivation paragraph>

C++ ref:
  <file>:<line> <function/comment>
  [additional refs as needed]

Tests:
  <pinning test name(s) added or updated>

Before/after divergence:
  SCG01EA: <X> → <Y>
  ...

Regression checks (all must pass before commit):
  [x] vitest src/EasterEgg --exclude dual-runtime (51,365+ tests)
  [x] npm run test:dual-runtime:fast
  [x] bash scripts/smoke-scg05.sh
  [x] SCENARIOS=all MAX=300 first-divergence
  [x] golden-rng-stream
  [ ] visual wet-test (combat changes only)

Co-Authored-By: <model>
```

## Acceptable commit outcomes

A commit may land if it satisfies one of:

1. **Improvement** — first-divergence advances on at least one scenario, no regressions.
2. **C++-faithful refactor** — no tick movement but the change matches a specific
   C++ pattern. The `C++ ref:` must cite the file:line of the equivalent C++ code,
   and the commit message should explain why the prior TS approach was a TS-only
   shortcut. Sessions 19-24 queue-routing refactors are the model.
3. **Partial win** — at least 2 scenarios advance, ≤1 regresses by ≤2 ticks.
   Trade-off must be explicit in commit message.

## Hard rejections (do not commit)

- Any failure in `scripts/smoke-scg05.sh` (SCG05EA spy tests).
- Any failure in `dual-runtime:fast` test subset.
- `golden-rng-stream` test fails without explicit `UPDATE_GOLDEN=1` justification
  in commit message.
- Visual wet-test reveals a combat regression (unit stuck, no-fire, geometry broken)
  for combat-mechanism changes.
- Any scenario regresses by more than 2 ticks.
- Any of `cpp-parity-*.test.ts` fail without an updated assertion paired with a
  documented C++ semantic change.

## Per-fix workflow (Phase 4)

1. Open `docs/parity/divergence-classification.md`, find the row for the mechanism
   being targeted. If the row is missing or untagged, return to Phase 1/2.
2. Verify the mechanism dossier (`docs/parity/dossiers/<tag>.md`) has a
   CONFIRMED hypothesis from Phase 3 WASM instrumentation. If not, return to Phase 3.
3. Write a failing cpp-parity pinning test in `src/EasterEgg/__tests__/cpp-parity-*.test.ts`
   that captures expected C++ behavior. Include `C++ ref:` in the test docstring.
4. Make the minimal TS code change to pass the test.
5. Run regression battery (see commit message template above).
6. If any regression: revert, re-analyze, narrow the fix.
7. If clean: write the commit message per template, commit, push, deploy.

## Reverting

If a fix is reverted (post-commit), do NOT delete the cpp-parity test —
mark it `it.skip(...)` with a `// REVERTED: <reason>` comment so the next
attempt can re-enable it.

## Why this rigor

Two prior vessel door-gate attempts (Sessions 7 and Round-2 Session 25) committed
without dual-runtime checks and either broke SCG05 spy delivery or regressed SCG07.
Both were eventually reverted, costing two full sessions. This protocol exists so
that future regressions are caught BEFORE commit.
