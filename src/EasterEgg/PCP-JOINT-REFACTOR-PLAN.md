# PCP Joint Refactor Plan — Track-jump + Infantry PCP + Approach_Target + Team Start_Driver

**Status:** Design complete, not yet implemented. Targets SCG04 t36, SCG13 t101, SCG06 t76.

**Sessions:** 3 firm (one per family) + 1 optional (SCG11 t32).

**LOC estimate:** ~180-250 net, across `perCellProcess.ts`, `index.ts`, `team.ts`, `missionAI.ts`, `entity.ts`.

**Guiding rule:** Accuracy over metric. Each checkpoint ships behind a feature flag; regressions trigger flag-off, never abandonment.

---

## 1. Shared primitive

All 3 blockers are consumers of one missing TS primitive: **cell-boundary callback that re-enters mission dispatch within the same tick**. C++ chain:

```
DriveClass::AI / InfantryClass::Movement_AI
  → While_Moving()  /  Distance(Head_To_Coord()) < 0x0010
      → Per_Cell_Process(PCP_END)          ← unit.cpp:1756 / infantry.cpp:912-914
          → Commence()                     ← pops MissionQueue, Timer=0, Status=0
  → (next tick) MissionClass::AI           ← Timer==0 → Mission_Move/Mission_Guard
```

Current commits `c4310105` (PER_CELL_COMMENCE_ENABLED=true) + `79b13cb3` (same-tick post-Commence dispatch in Mission.GUARD) wired vehicle track-COMPLETE PCP_END. Remaining: **track-JUMP PCP_END for vehicles**, **cell-arrival PCP for infantry**, **path-shorten + Approach_Target re-call on PCP**.

## 2. Family mapping

| Family | Consumer | C++ path | TS gap |
|---|---|---|---|
| **SCG04 t36** vehicle track-jump PCP | UnitClass::Per_Cell_Process fires on track-JUMP PCP_END, not just track-COMPLETE | drive.cpp:773 (not :816) | `index.ts:6574` does `pathIndex++` at track-jump but skips `unitPerCellProcess(PCP_END)` |
| **SCG13 t101** infantry cell-arrival Enter_Idle_Mode | InfantryClass::Per_Cell_Process fires Enter_Idle_Mode when NavCom unreachable, then Commence | infantry.cpp:911-914 | Infantry cell-arrival (`index.ts:5637-5639`) just increments pathIndex — no Enter_Idle_Mode probe, no Commence |
| **SCG06 t76** pathwalk re-Approach_Target | FootClass::Per_Cell_Process shortens path when target in range + Mission_Guard_Area re-fires Approach_Target per timer | foot.cpp:1471-1483 + foot.cpp:1082-1084 | TS has `Approach_Target` but never re-invokes it once `moveTarget` is set; never shortens path on in-range target |

## 3. Vehicle vs infantry split

C++ is polymorphic: `UnitClass::Per_Cell_Process` vs `InfantryClass::Per_Cell_Process`, both chain to `FootClass::Per_Cell_Process`. They differ in:

**Vehicle (DriveClass + UnitClass):**
- Commence at PCP_END only (unit.cpp:1756)
- Pre-DriveClass Commence at unit.cpp:406 (!IsDriving && Is_Door_Closed gate)
- No `Distance < 0x10` infantry snap

**Infantry (FootClass + InfantryClass):**
- Commence at `Distance(Head_To_Coord()) < 0x0010` (infantry.cpp:3992)
- Same place PCP_END dispatched (infantry.cpp:3997) AND Enter_Idle_Mode (infantry.cpp:911-914)
- InfantryClass::AI calls Commence ONLY after MissionClass::AI (infantry.cpp:1210), not before

**Refactor:** split TS into `unitPerCellProcess` (vehicles, current) + `footPerCellProcess` (infantry, new). Both share `perCellNavComCheck` sub-case.

## 4. Files to change

**Primary:**
- `src/EasterEgg/engine/perCellProcess.ts` — expand PCP_END to include track-jump semantics; add `footPerCellProcess`. ~80-120 LOC.
- `src/EasterEgg/engine/index.ts:6542-6594` — wire `unitPerCellProcess` at track-jump site, gated by `PER_CELL_TRACK_JUMP_ENABLED=false`. ~15 LOC.
- `src/EasterEgg/engine/index.ts:5637-5639` — convert infantry free-form cell-advance to `footPerCellProcess(PCP_END)`. ~40 LOC.
- `src/EasterEgg/engine/index.ts:4100-4144` (HUNT) + `4244-4271` (AREA_GUARD) — add Approach_Target re-call from foot.cpp:1082-1084. ~20 LOC.
- `src/EasterEgg/engine/team.ts:815-930` — replace eager `isDriving=true` with genuine Start_Driver emulation (call findPath, store path, flip isDriving only when facing aligns). ~30 LOC.

**Secondary:**
- `src/EasterEgg/engine/entity.ts:1153-1302` — add debug `speedBudgetConsumed`, `cellBoundaryCrossings`, `_commenceFiredThisTick` fields.
- `src/EasterEgg/engine/missionAI.ts:1441-1610` (`updateAreaGuard`) — add Approach_Target re-fire gate.

**C++ reference (read-only):**
- `drive.cpp:661-834, 858-879, 1304-1399`
- `unit.cpp:397-474, 1610-1884`
- `infantry.cpp:562-914, 1165-1210, 3780-4058`
- `foot.cpp:520-539, 926-1098, 1435-1562`
- `mission.cpp:213-359`
- `facing.cpp:142-183`

## 5. Speed/accumulator parity measurement (Session 1 prereq)

Before any PCP timing change, measure TS vs WASM per-tick lepton advance. Suspected (a) sub-pixel drift in speedAccum vs (b) byte-identical advance but PCP call-site order off.

**Measure:**
1. Add `speedBudgetConsumed` + `cellBoundaryCrossings` debug counters to Entity.
2. Gate `DEBUG_PCP_LOG` env flag dumping per-tick `(entityId, tick, lx/ly, speedAccum, trackIndex, trackNumber, pathIndex, crossings)`.
3. Re-run SCG11EA t25-35 with dump. Compare against WASM `drive.cpp:481-490` (`agent_debug_log(80000,...)`).

**Expected outcome:** byte-identical lepton advance. `speedAdd = Math.floor((maxSpeedLeptons * 255 + 128) / 256)` in `entity.ts:1258` matches C++ `fixed(0xFF,256)` rounding. `speedAccum % PIXEL_LEPTON_W` matches `drive.cpp:832`. If (a) is observed, stop and separate session.

## 6. Track-jump PCP_END mechanism

**C++ at drive.cpp:773:**
```
1. track-jump condition met
2. Stop_Driver()                ← clears IsDriving
3. IsDriving = true              ← restored immediately
4. Per_Cell_Process(PCP_END)     ← fires Commence + NavCom-clear
5. IsDriving = false             ← cleared again
6. if (Start_Driver(c)) ...      ← re-engages new track + memmove Path[]
```

The `IsDriving=true/false` brackets around Per_Cell_Process are deliberate — Commence gate semantics.

**Current TS** at `index.ts:6574` does `pathIndex++` but skips `unitPerCellProcess`. Naive add regressed SCG04 36→24 AND SCG11 32→21.

**Why naive fails:** `PER_CELL_COMMENCE_ENABLED=true` + `same-tick post-Commence dispatch` (in Mission.GUARD case) means each Commence fires Mission_Move jitter. Track-jump fires a SECOND Commence on same tick → jitter fires twice → cascade.

**Correct fix — gated dual invocation with dedup:**
```ts
// at track-jump site
const r = unitPerCellProcess(entity, PCPType.PCP_END);
if (r.commenceFired && !entity._commenceFiredThisTick) {
  entity._commenceFiredThisTick = true;
  // allow same-tick post-Commence dispatch
}
```
`_commenceFiredThisTick` reset at top of `updateEntity`. Matches C++'s once-per-`obj->AI()` (mission.cpp:213-321 has no loop).

**SCG11 MCV-157 double-fire nuance:** WASM observed 3 Mission_Move fires at tick 28 with only 2 MCVs. One MCV fires twice → that's the second PCP on the same tick (the track-jump PCP). The dedup must be PER-PCP-BOUNDARY, not per-tick:
```ts
// use a Set<`${trackIndex}-${pathIndex}`> to dedup across PCP boundaries
```

## 7. Family interactions

**DAG:**
```
Speed measurement (§5) ─┐
                        ├──▶ (1) Vehicle track-jump PCP ──┐
                        │                                 ├──▶ (4) Team Start_Driver refactor
                        │                                 │    (cleans up coordinateMove eager isDriving)
                        └──▶ (2) Infantry cell-arrival ───┤
                               Enter_Idle_Mode            │
                                                          │
                               (3) Pathwalk re-Approach ──┘
                                   depends on (2)
```

- Fix (1) = pure vehicle. Affects SCG04 directly; SCG11 at risk (same scenario, same vehicles).
- Fix (2) = pure infantry. Affects SCG13 directly; SCG01/03/06/07 at HIGH risk (narrow fix regressed all 4 previously).
- Fix (3) = cross-cutting. Depends on (2). Affects SCG06 + all infantry patrol scenarios.
- Fix (4) = team.ts cleanup. Removes the eager-isDriving proxy that's been patching over missing Start_Driver semantics. Risky for SCG04 tick 3 vehicleClaims dance.

## 8. Sequenced plan

### Session 1 — Track-jump PCP + instrumentation (SCG04 t36)

**1.1** Add debug counters + `DEBUG_PCP_LOG`. Run SCG04 t30-40 + SCG11 t25-35. Ship as diagnostic-only commit.

**1.2** Add `PER_CELL_TRACK_JUMP_ENABLED=false` flag. Wire at `index.ts:6574`. Ship flag-off.

**1.3** Flip `PER_CELL_TRACK_JUMP_ENABLED=true`. Expected:
- SCG04: 36→≥37
- SCG11: stays at 32 (per-boundary dedup prevents double-fire)
- SCG01/03/06/07/13: unchanged

**Rollback:** flag off.

**LOC:** ~50. **Risk:** medium.

### Session 2 — Infantry cell-arrival Enter_Idle_Mode (SCG13 t101)

**2.1** Add `footPerCellProcess` stub in `perCellProcess.ts`, gated by `FOOT_PER_CELL_ENABLED=false`. Three sub-cases:
1. Path-shorten when target in range (foot.cpp:1479-1482)
2. Enter_Idle_Mode decision (infantry.cpp:911) — sets `missionQueue=GUARD` (or AREA_GUARD if `guardOrigin` set)
3. Commence pop (infantry.cpp:914)

**2.2** Wire at 3 sites: `index.ts:5637-5639`, `4120-4128` (HUNT), `4256-4264` (AREA_GUARD). Ship flag-off.

**2.3** Flip `FOOT_PER_CELL_ENABLED=true`. Expected:
- SCG13: 101→≥102
- SCG01/03/06/07: AT HIGH RISK

**Critical guard (infantry.cpp:911):** ALL FOUR conditions must hold:
```ts
entity.missionQueue === null
  && entity.moveTarget === null           // NavCom cleared
  && entity.target === null && entity.targetStructure === null   // TarCom cleared
  && !In_Radio_Contact   // TS: always false for infantry, drop the check but DOCUMENT
```

Prior narrow port probably dropped one of these → cascaded 4 scenarios.

**Note:** TS Mission.MOVE handler at `index.ts:4054-4064` already has this logic but fires at `missionTimerFired` not cell-arrival. 1-tick gap accounts for SCG13 delta.

**Fix:** fire it at cell-arrival via `footPerCellProcess`, set `missionQueue=GUARD` (not `mission=GUARD`) so subsequent Commence pop runs normally.

**Rollback:** flag off.

**LOC:** ~80. **Risk:** HIGH.

### Session 3 — Pathwalk re-Approach_Target + team Start_Driver cleanup (SCG06 t76)

**3.1** Path-shorten sub-case inside `footPerCellProcess`:
```ts
if (entity.target?.alive && entity.inRange(entity.target)
    && (mission === HUNT || mission === AREA_GUARD || mission === ATTACK)) {
  entity.moveTarget = null;
  entity.path = [];
  entity.pathIndex = 0;
}
```
Already partially in `index.ts:4139-4143` (HUNT only). Move into `footPerCellProcess`.

**3.2** Mission_Guard_Area Approach_Target re-fire (foot.cpp:1082-1084):
- `missionAI.ts:updateAreaGuard` currently calls `approachTarget` only on initial scan
- C++ re-calls every timer cycle when `Target_Legal(TarCom)`
- Add: if `hadTargetAtEntry && !inRange && !moveTarget`, call `approachTarget`
- Gate by cell-change to prevent infinite regen per tick (C++ doesn't, TS may need this)

**3.3** Remove eager `isDriving=true` from `team.coordinateMove`:
```
coordinateMove:
  unit.missionQueue = MOVE
  unit.moveTarget = target
  unit.path = findPath(unit.cell, target, ...)   ← currently MISSING
  unit.pathIndex = 0
  // Do NOT set isDriving. Let updateEntity Mission.GUARD handler
  // (drive-in-GUARD at index.ts:4163-4165) invoke updateMove,
  // which sets isDriving=true via followTrackStep when rotation aligns.
```

**vehicleClaims MUST STAY** (team.ts:886-928) — emulates C++ transient Basic_Path cell reservation for SCG04 tick 3.

**3.4** Run 7 scenarios. Expected:
- SCG06: 76→≥77
- SCG01/03/04/07/11/13: unchanged

**Rollback priority:** revert 3.3 first (riskiest). If SCG04 regresses from 3, bail and keep eager-isDriving heuristic.

**LOC:** ~40. **Risk:** HIGH for team.ts.

### Session 4 (optional) — SCG11 t32 SAM RNG over-fire

**NOT part of PCP refactor.** Investigate `_updateSingleStructureCombat` or `_repairAITick` in `combat.ts` with per-`ScenarioRandom.next()` call-site logger. Source-tag annotation matching WASM's `12000+logicIdx`. Compare SCG11 t31-33.

**Gate:** only proceeds if sessions 1-3 leave SCG11 at ≥32.

## 9. Checkpoint matrix

| Checkpoint | Flags | Expected ticks | Rollback |
|---|---|---|---|
| C1.1 (instr only) | all new flags off | identical | trivial |
| C1.2 (track-jump stub) | `PER_CELL_TRACK_JUMP_ENABLED=false` | identical | trivial |
| C1.3 (track-jump live) | `PER_CELL_TRACK_JUMP_ENABLED=true` | SCG04 ≥37 | moderate |
| C2.1 (foot PCP stub) | + `FOOT_PER_CELL_ENABLED=false` | identical to C1.3 | trivial |
| C2.2 (foot PCP live) | + `FOOT_PER_CELL_ENABLED=true` | SCG13 ≥102 | HIGH |
| C3.1 (path-shorten) | + `PCP_PATH_SHORTEN_ENABLED=true` | SCG06 ≥77 | moderate |
| C3.2 (Approach retry) | + `AREA_GUARD_APPROACH_RETRY=true` | SCG06 ≥77 | moderate |
| C3.3 (team Start_Driver) | team.ts refactor (no flag) | unchanged from C3.2 | HIGH |

Each checkpoint = its own commit. Regression → flag off (or revert) + docs-test update + move to next family.

## 10. Risky cascades (upfront)

**SCG04 tick 3** — most fragile. Depends on team.ts vehicleClaims + eager isDriving + UnitClass::AI:404 pre-Commence. Every change in sessions 1 & 3 must keep `cpp-parity-scg04-mission-move-stagger.test.ts` passing:
- Dedup counter `_commenceFiredThisTick` MUST NOT block pre-Commence at `index.ts:4003-4010` (fires BEFORE any Per_Cell_Process)
- team.ts refactor must still honor `prior && unit.isDriving=true` flip for same-cell competing teams

**SCG07 tick 17** — VESSEL teams. Vessels share DriveClass::AI but have `Is_Door_Closed()` gate (vessel.cpp:592) absent from land vehicles. Preserve vessel door check in `updateMove:5230-5233`.

**SCG01 tick 87** — RNG-tag/ordering, not movement. Unaffected by PCP refactor UNLESS `footPerCellProcess` accidentally fires in GUARD (not just MOVE/HUNT/AREA_GUARD). Guard the PCP call behind `mission !== GUARD`.

**SCG03 tick 238** — ARTY Mission_Guard Arm-return. In GUARD not MOVE → PCP should not fire. Instrument at C2.2 to verify.

## 11. Minimum-viable cuts

**1 session available:** ship Session 1 (track-jump PCP) with flag on. Smallest blast radius, highest probability of advancing SCG04.

**2 sessions:** add Session 2 scaffolding (flag off committed). Defer flag flip to WASM-side probe confirming Enter_Idle_Mode trigger for E1 id=109 t100→101.

**3 sessions:** land Session 3 only after 1-2 prove stable over 2-3 days of parity suite runs.

## 12. Non-goals

- **No** DriveClass::AI double-dispatch (drive.cpp:1340-1345). Current same-tick post-Commence already produces 3 RNG at SCG11 t28.
- **No** CDTimer end-of-tick decrement. Three prior attempts reverted: `4277d897`, `d6db5f97`, `2effbea4`.
- **No** `perCellNavComCheck` consolidation into per-cell-process module for PCP_DURING. Documented as "future consolidation" in `perCellProcess.ts:149-152`; touching risks crushable-overlay + Overrun_Square timing.
- **No** SCG11 t32 SAM fix as part of this refactor.

## 13. Critical files

- `/Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/perCellProcess.ts`
- `/Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/index.ts`
- `/Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/team.ts`
- `/Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/missionAI.ts`
- `/Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/entity.ts`
