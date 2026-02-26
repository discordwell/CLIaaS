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

## ECONOMY / PRODUCTION

- [x] **[VERIFIED] E1: Repair depot cost** — RepairStep=5 HP/tick, RepairPercent=0.25 (index.ts:640-658). Credits checked, deducted per step, repair stops when credits exhausted.
- [x] **[VERIFIED] E2: Low power production penalty** — Production runs at 25% speed when powerConsumed > powerProduced (index.ts:4535-4552). Uses 0.25 multiplier, not tick-skipping.
- [x] **[VERIFIED] E3: AI army building** — AI houses produce infantry/vehicles when credits available + barracks/factory present (index.ts:5286-5345). Passive income from refineries.
- [x] **[VERIFIED] E4: Wall/sandbag placement** — SBAG/FENC/BRIK/BARB production items with 1x1 continuous placement mode. Cost deducted per wall placed.

## TRIGGER SYSTEM

- [x] **[VERIFIED] T1: Extended trigger events** — LOW_POWER, THIEVED, CROSS_HORIZONTAL/VERTICAL, UNITS_DESTROYED, CREDITS (scenario.ts:1360-1392).
- [x] **[VERIFIED] T2: Extended trigger actions** — AIRSTRIKE, NUKE, REVEAL_MAP, CENTER_VIEW, CHANGE_HOUSE (scenario.ts:1560-1610). Results handled in game tick.

## SPY / SPECIAL UNIT MECHANICS

- [x] **[VERIFIED] S1: Spy infiltration** — Spies enter enemy buildings: PROC steals 50% credits, DOME reveals map for 60s, POWR/APWR damages building. Auto-disguise near enemies.
- [x] **[VERIFIED] S2: Engineer friendly repair** — Engineers heal allied buildings +33% HP (consumed on use, index.ts:3434-3446).
- [x] **[VERIFIED] S3: Dog spy detection** — Dogs auto-target enemy spies within 3 cells (index.ts:3249-3260).

## CRATE SYSTEM

- [x] **[VERIFIED] C11: Extended crate types** — reveal, darkness, explosion, squad, heal_base, napalm, cloak (30s), invulnerability (20s). Weighted spawn distribution.

## AUDIO / MUSIC

- [x] **[VERIFIED] AU1: Combat music switching** — CALM/ACTION track pools. setCombatMode() called per tick. 30s cooldown on combat→calm transition.
- [x] **[VERIFIED] AU2: EVA announcements** — unit_lost, building_captured, building_lost, insufficient_funds, silos_needed. Throttled (max 1 per 3s per type).
- [x] **[VERIFIED] AU3: Unit voice responses** — Select/move/attack acknowledgment sounds per unit type with 0.5s throttle.

## UI

- [x] **[VERIFIED] U1: Veterancy chevrons** — Silver (1) and gold (2) chevrons rendered above units. Always visible, not just when selected.
- [x] **[VERIFIED] U2: Multi-portrait selection grid** — 2x2, 3x3, 4x4 grids for multi-unit selection. Mini sprite + HP bar per portrait.
- [x] **[VERIFIED] U3: Formation movement** — Grid-based formation spread with jitter for group move orders. Supports shift-click waypoint queues.
- [x] **[VERIFIED] U4: Structure damage sprites** — Damaged frame selection at 50% HP for GUN, SAM, and generic buildings (renderer.ts:966-991).
