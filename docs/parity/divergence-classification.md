# Divergence Classification (Phase 1 output)

Generated: 2026-04-24 (round-3 session after Phase 0 landed)

For each scenario's first-divergence tick, this document records the
failing RNG call (tag, entity), the C++ source location that fires it,
the equivalent TS site, and the hypothesis for the root cause mechanism.

Used as input to Phase 2 (analysis) and Phase 3 (WASM confirmation).

---

## Summary table

| Scenario | Tick | Δcalls | Tag name | Tag # | Entity | Family | Status |
|---|---|---|---|---|---|---|---|
| SCG01EA | 87 | −1 | Coord_Scatter | 50002 | (bullet impact) | combat-cascade | unanalyzed |
| SCG03EA | 238 | −1 | Mission_Guard_general | 60040 | unit[0] | mission-timing | **NEW finding** |
| SCG04EA | 24 | −1 | Mission_Move_foot | 60010 | unit[2] | mission-timing | analyzed (Round-2 S17) |
| SCG06EA | 76 | +2 | Coord_Scatter + bullet[115] | 50002, 15115 | bullet[115] | combat-cascade | unanalyzed |
| SCG07EA | 4 | −1 | Mission_Move_foot | 60010 | vessel[37] | vessel | analyzed (R1 S7, R2 S25) |
| SCG11EA | 19 | −1 | (entity-level) | — | unit[8] | mission-timing | unanalyzed |
| SCG13EA | 101 | +1 | Mission_Guard_infantry_E1E3 | 60043 | infantry[192] | combat-cascade | unanalyzed |

`Δcalls = wasm_calls - ts_calls`. Negative means TS fires more (TS over-fires or fires earlier).
Positive means WASM fires more (TS under-fires or fires later).

---

## Per-scenario detail

### SCG01EA tick 87 — Coord_Scatter over-fire (TS)

```
WASM(6 calls) TS(7 calls) Δcalls=-1
[6] WASM: (none)  TS: [Coord_Scatter seed=1228302660 stag=50002] << TS extra
```

- **Tag**: `50002` Coord_Scatter (coord.cpp)
- **Triggered by**: bullet impact → `CellClass::Incoming()` → `CellClass::Scatter()` fires
  `Random_Pick(0, 0xFF)` per unit in the cell.
- **Family**: combat-cascade — TS has a bullet impact at a cell WASM doesn't.
  Root cause is upstream: some earlier tick where TS/WASM units moved to different
  cells, so bullet lands differently.
- **C++ site**: `cell.cpp:1919-1952 CellClass::Incoming` → `Scatter` via coord.cpp
- **TS site**: `src/EasterEgg/engine/combat.ts` or index.ts — need to grep for
  scatter/incoming implementations.
- **Phase 3 confirmation needed**: WASM instrumentation on `CellClass::Incoming`
  logging bullet ID + cell + frame for Frame 80-90. Diff against TS.

### SCG03EA tick 238 — Mission_Guard_general 1-tick lead (TS)

```
tick 237: ✓  both fire Mission_Guard_infantry_E1E3 for infantry[121]
tick 238: ✗  WASM(0) TS(1) — TS fires unit[0] Mission_Guard_general
tick 239: ✗  WASM(1) TS(0) — WASM fires unit[84] Mission_Guard_general
tick 240: ✓  back in sync
```

- **Tag**: `60040` Mission_Guard_general (unit.cpp Mission_Guard handler)
- **Family**: mission-timing. TS unit[0] fires guard RNG 1 tick before WASM fires
  the equivalent call on unit[84]. Entity-index mismatch (0 vs 84) — same unit,
  different Logic array positions.
- **Hypothesis**: Same class as SCG04/SCG11 — TS Mission_Guard handler fires
  one tick ahead because of PCP chain over-fire OR different iteration order
  causes unit[0] to hit the handler before unit[84] equivalent.
- **Phase 3**: compare unit[84] WASM Mission timer trajectory near t237-t239
  against TS unit[0]'s.

### SCG04EA tick 24 — Mission_Move_foot jitter 1-tick early (TS)

```
WASM(0) TS(1) Δcalls=-1
[0] TS: [Mission_Move_foot seed=1558147430 stag=11002] — unit[2] 3TNK at (41,35)
```

- **Tag**: `60010` Mission_Move_foot (foot.cpp:535 Random_Pick(0,2) jitter)
- **Family**: mission-timing
- **Mechanism** (already analyzed Round-2 S17):
  - TS unit arrives at cell (41,35), chain-loop PCP_END fires `Commence` → pops
    `mq=MOVE` → Mission=MOVE, timer=0 → STAGE B dispatches Mission_Move → fires
    `Random_Pick(0,2)` jitter at foot.cpp:535.
  - WASM at same arrival does NOT fire PCP_END Commence because drive.cpp:816
    only fires PCP at track completion with `actual=0` (speed exhausted). For
    single-direction straight paths, intermediate cells don't trigger PCP.
- **C++ ref**: `drive.cpp:816` (PCP at `actual==0`), `foot.cpp:535` (jitter)
- **TS ref**: `src/EasterEgg/engine/index.ts:6294,6356,6373` chain-loop
  `perCellNavComCheck(true)` (Session 16 made skipCommence the default).
- **Session 16 improvement**: PCP chain now skips Commence — but STAGE E still
  pops at end-of-tick because `followTrackStep` sets `isDriving=false` on
  track completion (index.ts:7269,7283). So STAGE E's `blockCommenceDrive`
  gate opens → pop fires → same net effect.
- **Phase 3**: confirm WASM keeps `IsDriving=true` across adjacent-cell
  arrivals on straight paths (track reuse, not track restart). Add WASM
  instrumentation at `FootClass::IsDriving` flip sites.

### SCG06EA tick 76 — WASM bullet[115] extras (+2)

```
WASM(32 calls) TS(30 calls) Δcalls=+2
[30] WASM: [bullet[115]      seed=1770944671 stag=15115 ent=bullet[115]] << TS missing
[31] WASM: [Coord_Scatter    seed=73661932 stag=50002 ent=bullet[115]]   << TS missing
```

- **Tag**: `15115` bullet[115] AI, `50002` its Coord_Scatter call
- **Family**: combat-cascade. WASM has a live projectile at tick 76 TS never
  fired. Some unit fired a bullet earlier in WASM that TS didn't, or TS already
  killed the unit that would have fired.
- **Phase 3**: trace backward — at what tick does bullet[115] first appear in
  WASM? What unit spawned it? Is that unit alive+same-position in TS at that
  earlier tick?

### SCG07EA tick 4 — Vessel Mission_Move_foot over-fire (TS)

```
WASM(3 calls) TS(4 calls) Δcalls=-1
[0-2] both fire Mission_Move_foot for vessel[35],[36] (TS) = vessel[85],[86] (WASM)
[3] TS: [Mission_Move_foot vessel[37]] << WASM MISSING (fires at t6 instead)
```

- **Tag**: `60010` Mission_Move_foot
- **Family**: vessel double-Commence with IsDoorClosed gate
- **C++ ref**: `vessel.cpp:592,659` — two Commence gates both gated on
  `!IsDriving && Is_Door_Closed()`
- **Prior attempts reverted**:
  - R1 Session 7: broad `isVessel && doorOpen` gate on STAGE A broke SCG05 spy.
  - R2 Session 25: narrower `missionQueue ∈ {MOVE,ATTACK}` gate regressed
    SCG07 to tick 2 (TS now fires 6 while WASM fires 7 at t2 — gate too strict).
- **Phase 3**: WASM instrumentation on `VesselClass::AI` at both Commence sites,
  logging `IsDriving`, `Is_Door_Closed()`, `DoorShutCountDown`, `MissionQueue`,
  `Mission` per vessel per frame 0-10. Identify exactly which vessels+states
  WASM blocks vs allows.

### SCG11EA tick 19 — (same as SCG04 mechanism?)

```
WASM(0) TS(1) Δcalls=-1
[0] TS: unit[8] (likely 4TNK) — Mission_Move jitter or similar
```

- **Family**: mission-timing (presumed same as SCG04)
- **Phase 3**: confirm by inspecting tick 19 detail — which granular tag
  does unit[8] fire? If 60010 Mission_Move_foot, same root cause as SCG04.

### SCG13EA tick 101 — WASM infantry guard extra (+1)

```
WASM(7 calls) TS(6 calls) Δcalls=+1
[6] WASM: [Mission_Guard_infantry_E1E3 seed=3475184432 stag=60043 ent=infantry[192]] << TS missing
```

- **Tag**: `60043` Mission_Guard_infantry_E1E3 (infantry.cpp guard handler for E1/E3 types)
- **Family**: combat-cascade. TS's infantry[192]-equivalent isn't in Mission=GUARD
  or has a different timer state — could be dead, sleeping, or in a different
  mission.
- **Phase 3**: compare per-cell state for E1/E3 infantry at t100-t102. Use
  `test-per-cell-diff.ts`.

---

## Next steps (Phase 2 + 3)

1. **Grep TS codebase** for equivalents of `Coord_Scatter`, `CellClass::Incoming`,
   `Mission_Guard_general`, `Mission_Guard_infantry_E1E3` to locate the TS call sites.
2. **Produce mechanism dossiers** at `docs/parity/dossiers/<tag>.md` — one per
   unique mechanism (not per scenario). Most mission-timing scenarios share root
   causes.
3. **WASM instrumentation** per dossier (Phase 3) to confirm hypotheses.

## Mechanism-class priorities for Phase 4

Ranked by cascade leverage (earliest ticks first):

1. **Vessel double-Commence IsDoorClosed** (SCG07 t4) — Phase 3 needed to
   avoid the 3rd revert.
2. **Mission-timing / PCP chain over-fire** (SCG04 t24, SCG11 t19, possibly SCG03 t238)
3. **Combat-cascade root causes** (SCG01 t87, SCG06 t76, SCG13 t101) — these
   may self-resolve once the earlier fixes land.
