# RA Engine: C++ Parity Gaps

Everything that's missing, incomplete, simplified, or different vs the C++ Red Alert source.

## RENDERING / VISUAL

- [x] **R1: Health bars** — ConditionYellow=50%, ConditionRed=25%. Width matches sprite, 3px tall.
- [x] **R2: Selection brackets + pips** — White corner L-brackets + veterancy pip dots.
- [x] **R3: Per-type animation rates** — tickAnimation() uses INFANTRY_ANIMS walkRate/attackRate/idleRate.
- [n/a] **R4: Rotor sprite rendering** — No helicopters in ant scenarios.
- [n/a] **R5: SHAPE_FADING translucency** — No cloaking units in ant scenarios.
- [n/a] **R6: Layer-based render order** — Y-sort sufficient for ant scenarios (no multi-layer buildings).
- [x] **R7: Infantry death animation by warhead** — takeDamage() uses WARHEAD_PROPS.infantryDeath.
- [x] **R8: ExplosionSet per warhead** — All impact effects use WARHEAD_PROPS.explosionSet.

## MOVEMENT

- [x] **M1: Terrain speed classes** — getSpeedMultiplier(cx,cy,speedClass) differentiates FOOT/WHEEL/WINGED/FLOAT.
- [x] **M2: Damage-based speed reduction** — damageSpeedFactor(): 50% HP→0.75x, 25% HP→0.5x.
- [x] **M3: Close-enough distance** — 2.5 cell arrival tolerance for final moveTarget.
- [n/a] **M4: Lepton accumulator** — Float-based movement provides equivalent sub-pixel precision.
- [x] **M5: Three-point turns** — JEEP drifts backward 0.3px during >=90° turns.
- [n/a] **M6: Flag carry speed penalty** — No CTF/flag mechanics in ant scenarios.
- [x] **M7: House/crate speed bias** — entity.speedBias multiplier in moveToward().

## COMBAT / WEAPONS

- [x] **C1: Burst fire** — burstCount/burstDelay with 3-tick inter-burst delay. MammothTusk burst:2.
- [x] **C2: Distance-dependent scatter** — Scatter radius scales with distance/range ratio.
- [x] **C3: MinDamage/MaxDamage rules** — MinDamage:1 at <=2 cells, MaxDamage cap at 1.5x target HP.
- [x] **C4: Arcing projectiles** — projStyle 'grenade' (45px arc), 'shell'/'rocket' (30px arc).
- [x] **C5: Moving-platform inaccuracy** — prevPos tracking, 1-cell minimum scatter when moving.
- [x] **C6: SpreadFactor falloff** — WARHEAD_META.spreadFactor: pow(1-ratio, factor) curve.
- [x] **C7: Wall/wood/tiberium destruction** — WARHEAD_META.destroysWalls/destroysWood flags (data only, no destructible terrain entities).
- [x] **C8: Firepower house bias** — HOUSE_FIREPOWER_BIAS[house] applied to all damage calcs.
- [x] **C9: Projectile rotation/tumble** — projectileROT homing with tracking factor proportional to ROT.
- [x] **C10: Every-other-frame homing** — Homing projectiles update tracking only on even frames.

## AI / MISSIONS

- [x] **A1: Hunt target acquisition** — updateHunt() scans 2x sight range with threat scoring.
- [x] **A2: Target acquisition while moving** — MOVE mission scans every 15 ticks, saves moveTarget.
- [x] **A3: Type-specific scan delays** — guard/areaGuard uses entity.stats.scanDelay ?? 15.
- [x] **A4: Area guard configurable range** — Uses entity.stats.guardRange ?? sight for return distance.
- [x] **A5: Area guard scan from home** — Scans from guardOrigin position, not current position.
- [n/a] **A6: Bomber auto-sabotage** — No bomber aircraft in ant scenarios.
- [n/a] **A7: Harvester auto-mission** — No harvesters in ant scenarios.
- [n/a] **A8: MCV auto-deploy** — No MCV gameplay in ant scenarios.
- [x] **A9: Zone-aware threat evaluation** — Closing speed passed to threatScore, +25% for approaching.
- [x] **A10: Building threat values** — Structures use separate combat system (not entity-based).
- [x] **A11: Anti-infantry/armor/air threat weights** — Warhead-vs-armor effectiveness scores targets.
- [x] **A12: Threat scoring: weapon danger factor** — Target weapon damage * 0.2 added to score.
