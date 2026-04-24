# Dossier: Combat-cascade divergences (bullet scatter + infantry guard)

**Affects:** SCG01EA t87, SCG06EA t76, SCG13EA t101

Unlike the mission-timing dossier, these are NOT single-mechanism bugs. They
are **downstream of** accumulated micro-drift from earlier ticks. Fixing them
at the surface is likely impossible; fixing earlier ticks may resolve them
automatically.

## Common family: bullet trajectory divergence

### C++ flow for a bullet that scatters nearby units

1. Unit fires weapon → `BulletClass` allocated, trajectory computed
2. Each tick `BulletClass::AI` (bullet.cpp) advances the bullet
3. On impact: weapon warhead applies damage, `CellClass::Incoming()`
   at cell.cpp:1919 is invoked for the impact cell
4. `Incoming` iterates adjacent cells, calls `Scatter(0, true, true)` on
   each — which rolls `Random_Pick(0, 0xFF)` to determine scatter direction
5. Every unit in those cells gets `Override_Mission` if conditions apply,
   causing RNG consumption

### Why TS diverges

If TS fires a bullet at a different tick or from a different unit:
- At the bullet's impact tick, TS has (or lacks) the Coord_Scatter call
- From Phase 1 classification:
  - **SCG01EA t87**: TS fires 1 Coord_Scatter WASM doesn't
  - **SCG06EA t76**: WASM fires bullet[115].AI + Coord_Scatter TS doesn't have

To fix: identify the FIRST tick where TS/WASM unit positions or fire events
diverge pre-impact. This is usually **before** the first-divergence tick
reported by `test-first-divergence.ts` because positional divergence doesn't
cause RNG divergence until something rolls a die.

## SCG13 specific: infantry Mission_Guard_E1E3 missing

WASM fires `Mission_Guard_infantry_E1E3 (tag 60043)` for `infantry[192]` at
t101 that TS doesn't fire.

Possible root causes:
- TS infantry[192]-equivalent is dead (killed earlier by diverged combat)
- TS infantry is sleeping (different mission state)
- TS infantry is in MOVE/ATTACK/other non-GUARD mission

## Phase 3 investigation strategy

1. **Pre-first-divergence state diff** — for each combat-cascade scenario,
   run `test-per-cell-diff.ts` at every tick from 1 to first-divergence-1,
   looking for position/state mismatches on entities that could affect
   combat (any unit with alive=true and a TarCom target).

2. **Bullet ID trace** — instrument WASM `BulletClass::BulletClass`
   constructor to log Frame + shooter ID + target cell. Compare to TS bullet
   spawns.

3. **For SCG13**: identify infantry[192] in WASM (type, house, cell at t100).
   Find the TS entity at the same (type, house, cell) and inspect its Mission
   and history. If dead, trace back to when/how it died.

## Why Phase 4 deprioritizes these

Per the plan: fixing earlier ticks (SCG07 t4, SCG11 t19, SCG04 t24) should
reduce cumulative drift, potentially resolving later cascades automatically.
If after Phase 4 fixes the combat-cascade scenarios still diverge at the same
ticks, then Phase 3 investigation targets them individually.

## C++ refs

- `bullet.cpp` BulletClass::AI
- `cell.cpp:1919-1952` CellClass::Incoming
- `coord.cpp` Scatter implementation
- `infantry.cpp:1200+` Mission_Guard handler (E1/E3 specific path)

## TS refs

- `src/EasterEgg/engine/bullet.ts` (if exists — TBC via grep)
- `src/EasterEgg/engine/combat.ts` — Scatter/Incoming equivalents
- `src/EasterEgg/engine/missionAI.ts` — Mission_Guard handler for infantry
