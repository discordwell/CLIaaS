# Red Alert Parity Workflow

Parity has to be proven in layers. Hand-written TS tests are useful for regression control, but they do not prove agreement with the original game on their own.

## 1. Source Truth

Run `pnpm parity:source`.

This compares the TypeScript data tables against the extracted original INI data in `public/ra/assets/`:

- unit stats
- weapon stats
- warhead verses and flags
- production metadata

The report is written to `test-results/parity/source-parity.json` and `test-results/parity/source-parity.md`.

## 2. Runtime Differential

Run `pnpm parity:agent`.

This boots both engines, pauses them, and drives them through the same agent API:

- initial snapshot
- idle stepping
- scripted unit movement

The report is written to `test-results/parity/agent-parity.json` and `test-results/parity/agent-parity.md`.

## 3. Visual Verification

Run `pnpm compare`.

This remains the fastest way to inspect rendering, tile composition, and obvious map-state drift.

## 4. Promotion To Gate

The path to a real guarantee is:

1. Burn down the source-parity mismatches until `pnpm parity:source --strict` is clean.
2. Expand the agent scenarios until every major subsystem has a runtime differential check.
3. Promote the strict variants into CI only after the known-difference set is empty or explicitly allowlisted.

Until those three layers are green together, parity is still an audit effort rather than a proof.
