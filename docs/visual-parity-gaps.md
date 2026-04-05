# RA Visual Parity Gap List

Compiled from 7 parallel audit agents, 2026-04-05. Each gap has severity (HIGH/MED/LOW) and effort (trivial/small/medium/large).

## Cluster A: Sprite Asset Re-extraction
**Scope**: `scripts/extract-ra-assets.ts`, `scripts/ra-assets/`, `public/ra/assets/manifest.json`

- **A1** `powr.png` — 2/8 frames only, needs 8-frame blade rotation (HIGH, medium)
- **A2** `proc.png` — 2/32 frames only, needs docking/conveyor states (HIGH, medium)
- **A3** `dome.png` — 2/16 frames only, needs 16-frame radar sweep (HIGH, medium)
- **A4** `weap.png` — 2/32 frames only, needs bay door animation (HIGH, medium)
- **A5** Verify all projectile SHPs extracted: DOGBULLT, SPUTNIK, PARABOMB, LITNING (HIGH, medium)
- **A6** Verify CHRONBOX.SHP / CHRONO.SHP extracted for chronosphere (MED, small)

## Cluster B: Color/Palette Remap System
**Scope**: `public/ra/assets/remap-colors.json`, `src/EasterEgg/engine/assets.ts`, `src/EasterEgg/engine/renderer.ts`

- **B1** Add England/France palette rows to remap-colors.json (HIGH, small)
- **B2** Alias GoodGuy/BadGuy/Neutral/Special to LTBLUE/RED/GOLD (HIGH, trivial)
- **B3** Apply `getRemappedSheet()` to buildings in `renderer.ts:1673` (HIGH, small)
- **B4** Flag-carrier remap (LOW, medium)
- **B5** Blushing (damage flash) white tint (MED, small)
- **B6** Iron Curtain palette swap instead of multiply overlay (LOW, medium)
- **B7** Tighten pixel tolerance (currently ±2, should be exact index match) (LOW, trivial)

## Cluster C: Projectile Rendering Overhaul
**Scope**: `src/EasterEgg/engine/renderer.ts:2459-2527`, `src/EasterEgg/engine/index.ts:3342-3350`, `src/EasterEgg/engine/combat.ts`, `src/EasterEgg/engine/types.ts`

- **C1** Wire existing projectile PNGs (dragon, missile, 120mm, bomb, bomblet, v2rl) into effect path (HIGH, medium)
- **C2** Add 32-dir facing rotation to projectiles using `PrimaryFacing` (HIGH, small)
- **C3** Add `IsFlameEquipped` smoke/fireball trail for all weapons (not just hardcoded rockets) (HIGH, small)
- **C4** Fix torpedo rendering (currently falls through to yellow pixel) (HIGH, small)
- **C5** Add ground shadow for airborne projectiles based on height (MED, trivial)
- **C6** Distance-derived arc height (physics-based, not fixed sin(π·t)·30) (MED, small)
- **C7** Tumbling bullet frame cycling (Frames= in INI) (MED, trivial)
- **C8** `IsTranslucent` SHAPE_GHOST blending (LOW, trivial)
- **C9** Parachute bomb visual (MED, medium)
- **C10** NukeUp/NukeDown/GPS satellite visuals (LOW, small)
- **C11** Tesla LITNING.SHP sprites instead of procedural lightning (LOW, small)

## Cluster D: Explosion & VFX System
**Scope**: `src/EasterEgg/engine/combat.ts:213-246,1313-1345`, `src/EasterEgg/engine/renderer.ts:195-196,423-460,2431-2457`, `src/EasterEgg/engine/superweapon.ts`

- **D1** Alias water explosions (water-exp* → h2o_exp*) (HIGH, trivial)
- **D2** FIRE-SMALL/MED scatter on building death (MED, small)
- **D3** BURN-S/M/L persistent fire layers on destroyed/damaged buildings (MED, small)
- **D4** SMOKE_M persistent ground smoke after destruction (MED, small)
- **D5** SMUDGE_SCORCH1-6 scorch smudges under napalm/burn (MED, small)
- **D6** Nuke palette-fade whiteout vs yellow overlay (LOW, small)
- **D7** Screen shake `Cost_Of()/400` formula (LOW, trivial)
- **D8** Chronosphere ANIM_CHRONO_BOX sprite (MED, medium)
- **D9** Iron Curtain FadingRed palette swap (LOW, medium)
- **D10** FBALL_FADE proper sprite (LOW, trivial)
- **D11** SMOKEY/SPUFF rocket smoke trails (LOW, small)
- **D12** FLAK anti-air puff verification (LOW, trivial)
- **D13** SPUTDOOR/TWINKLE/MINE-EXP extraction (LOW, medium)
- **D14** Infantry burn/electro death variants (MED, small)

## Cluster E: Building Animations
**Scope**: `src/EasterEgg/engine/renderer.ts:61-117,1558-1615`, `src/EasterEgg/engine/placement.ts`, `src/EasterEgg/engine/combat.ts:1313-1345`

- **E1** Set FACT `idleAnimCount: 26` for pumping animation (MED, trivial)
- **E2** Set BARRACKS/TENT `idleAnimCount: 10` for door anim (MED, trivial)
- **E3** Set POWR/DOME/PROC/WEAP idle anim counts after re-extraction (MED, trivial)
- **E4** MCV deploy sets `buildProgress: 0` to trigger MAKE anim (MED, trivial)
- **E5** Building death FBALL1 burst + crater smudge + SMOKE_M scatter (MED, small)
- **E6** Frame overflow guard: `if damageFrame >= totalFrames` fallback (HIGH, trivial)
- **E7** Damage fire/smoke as one-shot attached anims, not always-on procedural (LOW, medium)

## Cluster F: Harvester & PROC Animations
**Scope**: `src/EasterEgg/engine/harvester.ts`, `src/EasterEgg/engine/renderer.ts:2060-2161`

- **F1** HARV rotates to DIR_W before unload (HIGH, small)
- **F2** HARV plays 22-frame Harvester_Dump_List animation during unload (HIGH, medium)
- **F3** HARV loaded vs empty visual states (use frames 32+) (HIGH, small)
- **F4** HARV 9-frame Harvester_Load_List during harvest (MED, small)
- **F5** PROC BSTATE_FULL docking lights (depends on A2 re-extraction) (HIGH, small after A2)
- **F6** PROC conveyor animation (depends on A2 re-extraction) (HIGH, small after A2)
- **F7** Dock cell calc: use `Adjacent_Cell(center, DIR_S)` exactly (LOW, trivial)
- **F8** HARV visually overlaps PROC dock during unload (MED, small)
- **F9** Credits lump-sum at end vs drip-feed (LOW, trivial)

## Cluster G: Infantry Animations
**Scope**: `src/EasterEgg/engine/entity.ts:562-598`, `src/EasterEgg/engine/types.ts:249-376`, `src/EasterEgg/engine/index.ts:1720-1725`

- **G1** Port DoControls tables for civilians, general, thief, einstein, spy from C++ `idata.cpp:249-367` (HIGH, small)
- **G2** 5 death variants: die1-die5 from DO_GUN/EXPLOSION/EXPLOSION2/GRENADE/FIRE_DEATH (MED, small)
- **G3** LIE_DOWN/GET_UP transition states (MED, medium)
- **G4** Set default walkRate=2 (C++ MasterDoControls) instead of 3 (MED, trivial)
- **G5** DO_STAND_GUARD uses `anim.guard` not `anim.ready` (LOW, trivial)
- **G6** Random_Animate frame-start randomization for walk/crawl (LOW, trivial)
- **G7** DO_IDLE1/IDLE2 re-randomize per trigger (LOW, trivial)
- **G8** DO_GESTURE1/2, DO_SALUTE1/2 (LOW, medium)

## Cluster H: Vehicle Trails Cleanup
**Scope**: `src/EasterEgg/engine/renderer.ts:2220-2255`

- **H1** DELETE fabricated dust trail behind moving vehicles (MED, trivial — just remove code)
- **H2** Replace damage smoke arcs with `smoke_m.png` sprite anchored to unit (MED, small)
- **H3** Use `Rule.ConditionYellow` from rules.ini instead of hardcoded 0.5 (LOW, trivial)
- **H4** Add `IsAnimAttached` equivalent guard to prevent double-spawn (LOW, small)

---

## Summary Counts
- **HIGH severity**: 23 gaps
- **MED severity**: 31 gaps
- **LOW severity**: 26 gaps
- **Total**: 80 gaps

## Dependency Order
1. **A** (asset re-extraction) → enables **E3, F5, F6**
2. **B, D, H** (independent cleanups) can run in parallel
3. **C** (projectiles) standalone
4. **E, F, G** can run in parallel after A
