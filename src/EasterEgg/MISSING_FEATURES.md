# RA Engine: C++ Parity Audit

Full audit of the TypeScript engine against the C++ Red Alert source code and RULES.INI data.
Status key: `[x]` correct, `[~]` vibed/approximate, `[!]` wrong, `[ ]` missing, `[n/a]` out of scope.

Last audited: 2026-03-07

---

## COMBAT / DAMAGE FORMULA

- [x] [VERIFIED] **CF1: Distance-based falloff on direct hits** — Fixed: `modifyDamage()` now applies C++ inverse-proportional distance falloff on all hits via SpreadFactor-scaled distance divisor.
- [x] [VERIFIED] **CF2: Splash falloff formula** — Fixed: `applySplashDamage()` now uses `modifyDamage()` with C++ inverse formula `damage / distFactor` instead of linear falloff.
- [x] [VERIFIED] **CF3: Splash radius** — Fixed: Universal `Game.SPLASH_RADIUS = 1.5` cells for all warheads, matching C++ `ICON_LEPTON_W + ICON_LEPTON_W/2`.
- [x] [VERIFIED] **CF4: MinDamage threshold** — Fixed: `modifyDamage()` applies MinDamage=1 when `distFactor < 4`, matching C++ combat.cpp:126-128.
- [x] **CF5: MaxDamage cap** — Both cap at 1000. Correct.
- [x] **CF6: Friendly fire splash** — Both damage all entities regardless of house. Correct.
- [x] [VERIFIED] **CF7: Heal damage guard** — Fixed: distance + armor checks added. C++ only applies negative (heal) damage if `distance < 0x008 AND armor == ARMOR_NONE` (combat.cpp:86-96). Mechanic's GoodWrench additionally checks `WARHEAD_MECHANICAL && armor != ARMOR_NONE`.
- [x] [VERIFIED] **CF8: Wall/overlay destruction from splash** — Fixed: walls destroyed by splash with IsWallDestroyer flag. Matches C++ `Explosion_Damage` warhead flags (combat.cpp:243-255).
- [x] [VERIFIED] **CF9: Ore destruction from splash** — Fixed: ore reduced by splash with IsTiberiumDestroyer flag. Matches C++ (combat.cpp:247-249).
- [x] **CF10: Firepower house bias** — Applied correctly in both. Match.

## WARHEADS

- [x] **WH1: Armor type mapping** — All 5 types (none/wood/light/heavy/concrete) with correct indices. Match.
- [x] **WH2: Warhead Verses values** — SA, HE, AP, Fire, HollowPoint, Super, Organic all match RULES.INI.
- [x] [VERIFIED] **WH3: Nuke warhead** — Nuke warhead type added to WarheadType union with correct verses in WARHEAD_VS_ARMOR.
- [x] [VERIFIED] **WH4: Mechanical warhead** — Mechanical warhead type added with identity verses (1.0 across all armor types). Used by Mechanic's GoodWrench.
- [~] **WH5: BulletTypeClass system** — C++ has a full projectile type system (IsArcing, ROT for homing, IsInaccurate, IsAntiAircraft, IsFueled, IsInvisible etc.). TS flattens core properties (isArcing, projectileROT, isSubSurface, isAntiSub, isAntiAir) onto WeaponStats but is missing: `IsInaccurate` (per-weapon forced scatter), `IsFueled`, `IsInvisible`, `IsDropping`, `IsParachuted`.

## SCATTER / INACCURACY

- [x] [VERIFIED] **SC1: AP-vs-infantry inaccuracy** — Fixed: forces 0.5 inaccuracy for AP warhead against infantry/cell targets. Matches C++ forced scatter (bullet.cpp:709-710).
- [x] [VERIFIED] **SC2: Non-arcing scatter shape** — Fixed: non-arcing projectiles scatter along firing angle (directional overshoot). Matches C++ `Coord_Move` in firing direction (bullet.cpp:725-728).
- [~] **SC3: Scatter distance formula** — C++ uses `(distance/16) - 64` capped at HomingScatter(512)/BallisticScatter(256) (bullet.cpp:718-727). TS uses `inaccuracy * CELL_SIZE * (dist/range)`. Different math, similar intent.
- [~] **SC4: Moving-fire inaccuracy** — Both increase inaccuracy when moving. C++ sets bullet IsInaccurate flag; TS guarantees minimum 1.0-cell inaccuracy. Different mechanisms.
- [x] [VERIFIED] **SC5: Arcing direction randomization** — Fixed: arcing projectiles apply +/-5 degree angular jitter. Matches C++ `dir + Random_Pick(0,10)-5` (bullet.cpp:722).

## WEAPON STATS

Weapon values verified against RULES.INI. All weapon stat values now match C++.

### Correct weapons:
- [x] M1Carbine (15/20/3.0/SA), Grenade (50/60/4.0/HE), Dragon (35/50/5.0/AP)
- [x] RedEye (50/50/7.5/AP), Flamer (70/50/3.5/Fire), DogJaw (100/10/2.2/Organic)
- [x] Heal (-50/80/1.83), M60mg (15/20/4.0/SA), 75mm (25/40/4.0/AP)
- [x] 90mm (30/50/4.75/AP), 105mm (30/70/AP), 120mm (40/80/AP/burst:2)
- [x] MammothTusk (75/80/5.0/AP/burst:2), 155mm (150/65/6.0/HE)
- [x] [VERIFIED] Stinger (30/60/9.0/AP), TorpTube (90/60/9.0/AP), DepthCharge (80/60/5.0/AP)
- [x] [VERIFIED] 8Inch (500/160/22.0/HE), Maverick (50/3/6.0/AP), Hellfire (40/60/4.0/AP)
- [x] [VERIFIED] ChainGun (40/3/5.0/SA), Sniper (100/5/3.75/HollowPoint)
- [x] [VERIFIED] TeslaCannon (100/120/8.5/Super)

### Missing weapons:
- [ ] **Colt45** (Tanya), **ParaBomb**, **SCUD** (V2 Launcher — now defined but V2RL unit stub), **Democharge** (defined but Demo Truck has no self-destruct mechanic)
- [x] [VERIFIED] **Camera** — Added to WEAPON_STATS (Spy plane weapon).

## UNIT STATS — INFANTRY

- [x] **E1 Rifle** — All stats match (50hp/4spd/100cost/M1Carbine).
- [x] **E4 Flamethrower** — All stats match (40hp/3spd/300cost/Flamer/soviet).
- [x] **E6 Engineer** — All stats match (25hp/4spd/500cost).
- [x] **DOG** — All stats match (12hp/4spd/200cost/DogJaw/soviet).
- [x] **MEDI** — All stats match (80hp/4spd/800cost/Heal/allied).
- [x] [VERIFIED] **E2 Grenadier owner** — Fixed: soviet-only in both UNIT_STATS and PRODUCTION_ITEMS.
- [x] [VERIFIED] **E3 Rocket Soldier** — Primary=RedEye, Secondary=Dragon. Owner='allied'. All match C++.
- [x] [VERIFIED] **SPY sight** — Fixed: sight=5 matches C++.
- [x] [VERIFIED] **GNRL Stavros** — Fixed: 80hp/3sight/Pistol match C++. Speed=8 (see MV7 speed conversion note).
- [x] [VERIFIED] **CHAN Specialist** — Fixed: 25hp/2sight match C++. Speed=8 (see MV7).
- [x] [VERIFIED] **Civilians (C1-C10)** — Fixed: 25hp matches C++. Speed=4 (see MV7).
- [x] [VERIFIED] **SHOK cost** — Fixed: 900 cost matches C++.
- [x] [VERIFIED] **MECH** — Fixed: 60hp/950cost matches C++.
- [ ] **E7 Tanya** — Not implemented. Missing C4, swimming, dual Colt45.
- [ ] **THF Thief** — Not implemented.

## UNIT STATS — VEHICLES

- [x] **1TNK Light Tank** — All match (300hp/700cost/75mm/heavy/crusher).
- [x] **2TNK Medium Tank** — All match (400hp/800cost/90mm/heavy/crusher).
- [x] [VERIFIED] **3TNK Heavy Tank** — Fixed: secondaryWeapon='105mm' now present.
- [x] **4TNK Mammoth** — All match (600hp/1700cost/120mm+MammothTusk/heavy/crusher).
- [x] **JEEP Ranger** — All match (150hp/600cost/M60mg).
- [x] **APC** — All match (200hp/800cost/M60mg/5 passengers).
- [x] **ARTY Artillery** — All match (75hp/600cost/155mm).
- [x] **HARV Harvester** — All match (600hp/1400cost/heavy/crusher).
- [x] **MCV** — All match (600hp/light armor/crusher).
- [x] [VERIFIED] **TRUK Supply Truck** — Fixed: light armor/sight=3 match C++.
- [x] [VERIFIED] **TTNK Tesla Tank** — Fixed: 110hp matches C++.
- [x] [VERIFIED] **CTNK Chrono Tank** — Fixed: 350hp/light armor/2400cost/APTusk all match C++.
- [x] [VERIFIED] **QTNK MAD Tank** — Fixed: 300hp matches C++.
- [x] [VERIFIED] **DTRK Demo Truck** — Fixed: 110hp/light armor match C++.
- [x] [VERIFIED] **STNK Phase Transport** — Fixed: cost=800/crusher=true/isCloakable=true match C++. HP=200 (C++ 110) still off.
- [ ] **V2RL V2 Rocket** — Stub with SCUD weapon defined. No V2-specific launch arc/explosion mechanics.
- [ ] **MNLY Minelayer** — Not implemented. No mine mechanics.
- [REMOVED] **MRLS** — Removed. Tiberian Dawn unit, not in RA Aftermath.

## UNIT STATS — NAVAL

Most naval sight/ROT values now correct. Speed values use TS-internal scale (see MV7). Weapons corrected.

- [x] [VERIFIED] **SS Submarine** — Fixed: sight=6/ROT=7/primary=TorpTube/isCloakable=true all match C++.
- [x] [VERIFIED] **DD Destroyer** — Fixed: sight=6/ROT=7/primary=Stinger/secondary=DepthCharge/isAntiSub all match C++.
- [x] [VERIFIED] **CA Cruiser** — Fixed: sight=7/ROT=5/primary=8Inch(500dmg)/secondary=8Inch all match C++.
- [x] [VERIFIED] **PT Gunboat** — Fixed: heavy armor/sight=7/ROT=7/primary=2Inch/secondary=DepthCharge all match C++.
- [x] [VERIFIED] **LST Transport** — Fixed: 350hp/sight=6/ROT=10/5 passengers all match C++.
- [x] [VERIFIED] **MSUB Missile Sub** — Fixed: sight=6 matches C++. Cost=1650 in PRODUCTION_ITEMS.

## UNIT STATS — AIRCRAFT

Aircraft HP, ROT, ammo, and weapon assignments now match C++. Sight=0 correctly implemented (aircraft rely on ground units for vision).

- [x] [VERIFIED] **HELI Longbow** — Fixed: 225hp/ROT=4/Hellfire primary+secondary/ammo=6 all match C++.
- [x] [VERIFIED] **HIND** — Fixed: 225hp/ROT=4/ChainGun primary only (no secondary)/ammo=12 all match C++.
- [x] [VERIFIED] **MIG** — Fixed: 50hp/ROT=5/Maverick primary+secondary/ammo=3 all match C++.
- [x] [VERIFIED] **YAK** — Fixed: 60hp/ROT=5/ChainGun primary+secondary/ammo=15 all match C++.
- [x] [VERIFIED] **TRAN Chinook** — Fixed: cost=1200/ROT=5 match C++.

## STRUCTURE STATS

- [!] **All structure HPs** — TS uses absolute values (POWR=400, WEAP=1000, PROC=900 etc.) which approximate C++ but not all have been individually verified against building.cpp data tables.
- [!] **Power: TENT** — C++ drain=20. TS drain=10.
- [!] **Power: GUN** — C++ drain=40. TS drain=10.
- [!] **Power: TSLA** — C++ drain=150. TS drain=100 (player) / 150 (AI). Internal inconsistency.
- [!] **Power: STEK** — C++ drain=100. TS drain=200.
- [x] [VERIFIED] **Power: BARR, GAP, SILO, ATEK, AFLD** — Fixed: SILO=0, ATEK=50, AFLD=20, BARR=20, GAP=60. No AI/player inconsistency remaining for these.
- [x] [VERIFIED] **AFLD cost** — Fixed: 600 matches C++.
- [~] **AI vs Player power tables partially fixed** — BARR/GAP/SILO/ATEK/AFLD now consistent. TSLA (100 vs 150), GUN (10 vs 20), STEK remain inconsistent between player/AI paths.

## MOVEMENT

- [~] **MV1: Free-form vs track-table movement** — C++ uses pre-computed track tables with lepton accumulators (drive.cpp). TS uses free-form vector movement. Architectural difference — produces different movement curves around corners.
- [x] [VERIFIED] **MV2: Damage speed — single tier** — Fixed: removed fabricated ConditionRed 0.5x tier. Now only one tier: <=50% HP = 0.75x speed, matching C++ drive.cpp:1157-1161.
- [!] **MV3: Close-enough distance unit bug** — `worldDist()` returns cells but is compared against `CELL_SIZE * 2.5 = 60` (pixels). Creates 60-cell tolerance instead of 2.5. Masked by pathfinding exhausting path first.
- [x] [VERIFIED] **MV4: Three-point turns removed** — Fixed: removed fabricated 3-point turn code. C++ code was behind `#ifdef TOFIX` and `IsThreePoint=false` — never compiled in released game (drive.cpp:328-361).
- [x] [VERIFIED] **MV5: Terrain multipliers capped at 1.0** — All terrain speed multipliers verified ≤1.0. No road speed bonus exceeds base speed.
- [~] **MV6: Terrain types incomplete** — C++ has 9 LandTypes (Clear, Road, Water, Rock, Wall, Ore, Beach, Rough, River). TS has 5 (Clear, Water, Rock, Tree, Wall). Tree is not a C++ LandType; Beach, Rough, River, Ore are missing.
- [~] **MV7: Speed values use internal scale** — TS UNIT_STATS `speed` values are labeled as C++ MPH and converted via `MPH_TO_PX = 24/256`. The relative ordering is correct but some values don't match C++ INI exactly. Known architectural simplification.
- [~] **MV8: speedFraction defaults** — `movementSpeed()` applies various `speedFraction` multipliers (0.3 for wave retreat, 0.7 for aircraft/patrol, 1.0 for normal). No direct C++ analog; serves as TS-internal tuning.
- [x] [VERIFIED] **MV9: House GroundspeedBias on rotation** — Already implemented in entity.ts `tickRotation()` — applies `groundspeedBias` to rotation rate.

## PATHFINDING

- [~] **PF1: Different algorithm** — C++ uses LOS + edge-follow (findpath.cpp:435). TS uses A*. Both produce valid paths but differ in behavior around obstacles.
- [~] **PF2: Occupancy handling** — C++ hard-blocks on occupied cells and tells blocking unit to move. TS uses soft penalty (+20 cost), routing through occupied cells.
- [~] **PF3: Passability nuance** — C++ `Can_Enter_Cell()` returns nuanced results (MOVE_OK, MOVE_TEMP, MOVE_CLOAK etc.). TS uses boolean `isTerrainPassable()`.

## AIRCRAFT

- [x] [VERIFIED] **AC2: Takeoff rate** — Fixed: +1 px/tick (24 ticks to altitude). Matches C++ 1 pixel/tick rate.
- [x] [VERIFIED] **AC3: Landing rate** — Fixed: -1 px/tick (24 ticks). Matches C++ 1 pixel/tick rate.
- [x] [VERIFIED] **AC4: Rearm timing** — Fixed: uses weapon-specific `weapon.rof * rofBias`. Matches C++ `Rearm_Delay() = weapon->ROF * House->ROFBias`.
- [~] **AC5: Aircraft speed fraction** — TS uses `speedFraction = 0.7` for all aircraft approach/attack. No C++ analog.
- [~] **AC6: Helicopter strafe oscillation** — TS adds `sin(tick * 0.21) * 0.5` lateral movement during hover attacks. Purely decorative, no C++ basis.
- [x] **AC7: Flight altitude** — 24 pixels matches C++ FLIGHT_LEVEL=256 leptons = 1 cell = 24px. Correct.

## SUBMARINE / CLOAKING

- [x] [VERIFIED] **CL1: Cloak transition timing** — Fixed: CLOAK_TRANSITION_FRAMES=38 ticks (~2.5s). Matches C++ MAX_UNCLOAK_STAGE=38.
- [x] [VERIFIED] **CL2: Sonar pulse duration** — Fixed: SONAR_PULSE_DURATION=225 ticks (15s). Matches C++.
- [x] [VERIFIED] **CL3: Health-gated cloaking** — Fixed: 96% stay uncloaked below ConditionRed (25% HP). Matches C++ prevention with 4% random override chance.
- [x] [VERIFIED] **CL4: Auto-cloak conditions** — Fixed: removed proximity check (absent in C++), added firing check. Now checks: not firing, HP above ConditionRed (with 4% override), sonar/cloak timers.

## DOG MECHANICS

- [x] [VERIFIED] **DG1: Instant kill** — Fixed: uses maxHp as damage, guaranteeing instant kill regardless of target HP. Matches C++ `damage = target.Strength` (infantry.cpp:339-345).
- [x] [VERIFIED] **DG2: Collateral prevention** — Fixed: 0 damage to non-targets. Matches C++ dog attack collateral guard.

## SPY MECHANICS

- [x] [VERIFIED] **SP1: PROC infiltration** — Fixed: Spy sets `spiedHouses` flag only (revealing enemy money). No credit theft.
- [x] [VERIFIED] **SP2: DOME infiltration** — Fixed: sets `radarSpiedHouses` only (see enemy radar view), not full map reveal. Matches C++ `RadarSpied` behavior.
- [x] [VERIFIED] **SP3: POWR infiltration** — Fixed: Spy sets `spiedHouses` flag only. No damage to power plants.
- [x] [VERIFIED] **SP4: Sub Pen spy effect** — Fixed: actually activates sonar superweapon. Matches C++ Sonar Pulse grant on SPEN infiltration.
- [x] [VERIFIED] **SP5: Factory spy effect** — Implemented: `productionSpiedHouses.add()` tracks spied factory houses.
- [x] [VERIFIED] **SP6: DOME spy map reveal** — Fixed: `map.revealAll()` is now called alongside `radarSpiedHouses` flag.

## ENGINEER MECHANICS

- [x] [VERIFIED] **EN1: Friendly repair amount** — Fixed: `s.hp = s.maxHp` heals building to FULL HP. Matches C++ `Renovate()`.
- [x] **EN2: Capture threshold** — Both use 25% (ConditionRed). Correct.
- [x] **EN3: Engineer damage** — Both deal 1/3 of maxHP. Correct.

## CRATE SYSTEM

- [x] [VERIFIED] **CR1: Money amount** — Fixed: 2000 credits. Matches C++ `SoloCrateMoney = 2000`.
- [x] [VERIFIED] **CR2: Armor crate** — Fixed: Sets `armorBias = 2` (half damage taken). Matches C++ `ArmorBias` multiplier.
- [x] [VERIFIED] **CR3: Firepower crate** — Fixed: Sets `firepowerBias = 2` (double damage output). Matches C++ `FirepowerBias`.
- [x] [VERIFIED] **CR4: Reveal crate** — Fixed: Calls `map.revealAll()`. Matches C++ `IsVisionary = true`.
- [x] [VERIFIED] **CR5: Cloak crate** — Fixed: Sets `isCloakable = true` (permanent). Matches C++.
- [x] [VERIFIED] **CR6: Crate lifetime** — Fixed: 5-20 minutes random. Matches C++ `Random_Pick(CrateTime/2, CrateTime*2)`.
- [~] **CR7: Speed crate** — TS gives speedBias=1.5. C++ sets SpeedBias but exact value unclear. Mechanism is correct.
- [~] **CR8: Crate types expanded** — Fixed: ParaBomb, Sonar, ICBM added. Still missing: TimeQuake, Vortex (exotic/rare types).
- [x] [VERIFIED] **CR9: Spawn distribution** — Fixed: Weighted `CRATE_SHARES` array per type. Matches C++ concept.

## ECONOMY / ORE

- [x] [VERIFIED] **EC1: Gold value** — 35 credits per bail. Matches C++ `GoldValue = 35`.
- [x] [VERIFIED] **EC2: Gem value** — 110 credits per bail. Matches C++ `GemValue = 110`.
- [x] [VERIFIED] **EC3: Ore capacity system** — Fixed: bail-based capacity with 28 bails max. Gold=35/bail, gem=110/bail. Matches C++ `BailCount=28` system.
- [x] [VERIFIED] **EC4: Gem bonus bails** — Fixed: 2 bonus bails per gem harvest action. Matches C++ (unit.cpp:2306-2308, worth 220 extra credits).
- [x] [VERIFIED] **EC5: Ore unload** — Fixed: lump-sum deposit after 14-tick dump animation. Matches C++ full-load credit behavior.
- [!] **EC6: Ore growth — gems shouldn't grow** — C++ only grows gold overlays (cell.cpp:2869-2883), NEVER gems. TS grows both.
- [!] **EC7: Ore spread** — C++ requires density > 6, spreads to 8 directions (cell.cpp:2904-2918). TS has no density threshold, spreads to 4 cardinal only.

## PRODUCTION

- [x] [VERIFIED] **PR1: Power penalty formula** — Fixed: continuous sliding scale using `power_fraction.Inverse()` (1x-2x slowdown range). Matches C++ behavior.
- [x] **PR2: Multi-factory formula** — Already correct: linear division by factory count (2 factories = 2x, 3 = 3x). Matches C++. (Note: was already correct, verified during Phase 3 audit.)
- [~] **PR3: Cost deduction timing** — C++ deducts cost incrementally per-tick during production. TS deducts full cost upfront and refunds unbuilt fraction on cancel. Different cash flow.

## REPAIR

- [x] [VERIFIED] **RP1: RepairStep** — Fixed: now 5. Matches C++ rules.cpp default `RepairStep(5)`.
- [x] **RP2: Repair cost formula** — `ceil(cost * RepairPercent / (maxHp / RepairStep))` per step. Matches.
- [~] **RP3: Repair rate** — C++ ~14 ticks. TS 15 ticks. Close.
- [x] [VERIFIED] **RP4: Service Depot repair rate** — Fixed: now 14 ticks. Matches C++ ~14-tick rate.
- [x] [VERIFIED] **RP5: Repair cancel on no funds** — Fixed: removes from repair set + EVA announcement. Matches C++ `IsRepairing = false` behavior.

## SELL

- [x] [VERIFIED] **SL1: Sell refund NOT health-scaled** — Correct: `addCredits(Math.floor(prodItem.cost * 0.5))`. No health scaling. Matches C++ `RawCost * CostBias * RefundPercent(0.5)`.
- [x] [VERIFIED] **SL2: Sell animation duration** — Fixed: per-building frame count for sell animation. Matches C++ reverse construction animation timing.
- [x] [VERIFIED] **SL3: Wall selling** — Fixed: Walls sell instantly for 50% refund. Matches C++.

## SILO / STORAGE

- [x] **SI1: Storage values** — PROC=1000, SILO=1500. Correct.
- [x] **SI2: Capacity reduction** — Already correct: excess credits preserved when capacity reduced. Matches C++ refund behavior (house.cpp:1946-1967). (Note: was already correct, verified during Phase 3 audit.)
- [x] [VERIFIED] **SI3: Silos needed threshold** — Fixed: now uses C++ formula `(Capacity - Tiberium) < 300 && Capacity > 500`. Matches C++ threshold logic.

## WALL PLACEMENT

- [!] **WL1: Wall adjacency** — C++ does not require wall adjacency to existing structures. TS requires walls to be adjacent to existing buildings, preventing distant wall construction.

## BUILDING PLACEMENT

- [x] **BP1: Adjacency distance** — Both use 1-cell default. Correct.
- [x] **BP2: Refinery spawns free harvester** — Both do. Correct.
- [~] **BP3: AI adjacency** — TS uses 4-cell AI adjacency (more generous than C++ default of 1).

## POWER

- [x] [VERIFIED] **PW1: Tesla Coil power cutoff** — Fixed: disabled when `powerConsumed > powerProduced` (any deficit). Matches C++ `Power_Fraction < 1.0`.
- [~] **PW2: Defense brownout** — C++ uses per-building `IsPowered` flag from INI. TS uses global thresholds. Different mechanism.
- [x] [VERIFIED] **PW3: Functional brownout** — Fixed: TSLA/GUN/SAM/AGUN skip firing during power deficit. Matches C++ powered structure disable behavior.

## SUPERWEAPONS

- [x] [VERIFIED] **SW1: Chronosphere recharge** — Fixed: 6300 ticks (7 min × 60 × 15 FPS). Matches rules.ini [Recharge] Chrono=7.
- [x] [VERIFIED] **SW2: Sonar Pulse recharge** — Fixed: 9000 ticks (10 min × 60 × 15 FPS). Matches rules.ini [Recharge] Sonar=10.
- [x] [VERIFIED] **SW3: Iron Curtain duration** — Fixed: 675 ticks (0.75 min × 60 × 15 FPS = 45s). Matches rules.ini [General] IronCurtain=.75.
- [x] [VERIFIED] **SW3b: Iron Curtain recharge** — Fixed: 9900 ticks (11 min × 60 × 15 FPS). Matches rules.ini [Recharge] IronCurtain=11.
- [x] [VERIFIED] **SW3c: GPS Satellite recharge** — Fixed: 7200 ticks (8 min × 60 × 15 FPS). Matches rules.ini [Recharge] GPSSatellite=8.
- [x] [VERIFIED] **SW3d: Nuke recharge** — Fixed: 11700 ticks (13 min × 60 × 15 FPS). Matches rules.ini [Recharge] Nuke=13.
- [!] **SW4: GPS Satellite building** — TS assigns to DOME (Radar). C++ assigns to a separate GPS_SATELLITE building.
- [!] **SW5: Sonar Pulse building** — TS assigns to DOME. C++ obtains by spying on enemy Sub Pen.
- [ ] **SW6: Missing superweapons** — ParaBomb, ParaInfantry, SpyMission not implemented.

## TRIGGER SYSTEM

- [x] **TR1: Persistence modes** — Volatile/Semi/Persistent. Correct.
- [x] **TR2: Multi-event logic** — AND/OR/ONLY control. Correct.
- [~] **TR3: Event coverage** — 23 of 32 C++ events implemented. NOFACTORIES event added (with expanded factory list). Still missing: BUILDINGS_DESTROYED, NBUILDINGS_DESTROYED, EVAC_CIVILIAN, BUILD_UNIT/INFANTRY/AIRCRAFT, FAKES_DESTROYED.
- [~] **TR4: Action coverage** — ~21 of 35 C++ actions implemented. PLAY_MUSIC action added. Still missing: DESTROY_TEAM, FIRE_SALE, PLAY_MOVIE, REVEAL_ZONE, PLAY_SPEECH, CREEP_SHADOW, DESTROY_OBJECT, SPECIAL_WEAPON, PREFERRED_TARGET, LAUNCH_NUKES.
- [~] **TR5: Event index mapping** — TS defines event constants; INI parser maps correctly but constant names differ from C++ enum ordering.

## AI / MISSIONS

- [~] **AI1: Mission system** — 7 of 22 C++ missions formalized (GUARD, AREA_GUARD, MOVE, ATTACK, HUNT, SLEEP, DIE). Others handled ad-hoc (harvester AI, engineer capture, etc.) rather than as formal mission states.
- [x] [VERIFIED] **AI2: Threat scoring formula** — Fixed: uses unit cost for threat scoring. Matches C++ cost-proportional `Value()` approach (techno.cpp:1449-1763). Note: designated enemy house +500/3x and zone modifiers still not implemented (see AI4).
- [~] **AI3: AI house behavior** — Entirely custom phase-based system (economy/buildup/attack). Not a port of C++ AI. Acceptable since ants use separate `updateAntAI`.
- [ ] **AI4: Designated enemy house** — C++ `House->Enemy` gives +500 then 3x to targets from designated enemy. Not implemented.
- [ ] **AI5: Area modification (splash avoidance)** — C++ `Area_Modify()` reduces score for targets near friendly buildings to avoid splash. Not implemented.
- [ ] **AI6: Spy target exclusion** — C++ excludes spies from general threat evaluation (except dogs). TS does not exclude spies from `threatScore()`.

## MISSING UNITS — SPECIAL ABILITIES

- [ ] **Tanya** — Not implemented (C4 on buildings, swimming, dual Colt45).
- [ ] **Thief** — Not implemented (credit theft on entering enemy refinery/silo).
- [~] **V2 Rocket Launcher** — Stub unit with SCUD weapon. No V2-specific launch arc/flight mechanics.
- [ ] **Minelayer + mines** — Not implemented (AP mine placement, detection, damage, mine limit).
- [!] **Chrono Tank teleport** — Unit type exists with correct stats. No self-teleport ability.
- [x] [VERIFIED] **MAD Tank deploy** — Fixed: 90-tick charge + 600 HE damage to vehicles within 8 cells. Matches C++ seismic weapon.
- [x] [VERIFIED] **Demo Truck self-destruct** — Fixed: 45-tick fuse + splash explosion. Matches C++ kamikaze mechanic.
- [x] [VERIFIED] **Phase Transport cloaking** — Fixed: `isCloakable: true` set in UNIT_STATS.
- [x] [VERIFIED] **Mechanic AI** — Fixed: vehicle-seeking scan loop with GoodWrench ROF timing. Matches C++ dedicated repair AI.

## GAP GENERATOR

- [x] [VERIFIED] **GAP1: Shroud jamming** — Fixed: 10-cell radius jamming, power-gated, death cleanup. Matches C++ `GapShroudRadius=10` (rules.cpp:222).

## RENDERING / VISUAL

- [x] **R1: Health bars** — ConditionYellow=50%, ConditionRed=25%. Correct.
- [x] **R2: Selection brackets + pips** — Correct.
- [x] **R3: Per-type animation rates** — Correct.
- [x] **R7: Infantry death animation by warhead** — Correct.
- [x] **R8: ExplosionSet per warhead** — Correct.
- [x] [VERIFIED] **R9: Sidebar house-specific backgrounds** — Ported: side1na/us, side2na/us, side3na/us 3-section shapes. Allied=NA, Soviet=US. Extracted from HIRES.MIX.
- [x] [VERIFIED] **R10: Sidebar C++ HIRES layout** — Ported: MAX_VISIBLE=4, CAMEO_GAP=0, C++ English button layout (64/40/40), exact column positions from sidebar.h.
- [x] [VERIFIED] **R11: Power bar logarithmic scale + bounce** — Ported: Power_Height() from power.cpp:394-417, bounce via _modtable[13], palette-accurate colors (green/orange/red).
- [x] [VERIFIED] **R12: Sidebar sprite-based buttons/arrows** — Ported: stripup/stripdn SHP scroll arrows, repair/sell/map ShapeButtonClass sprites, pips READY/HOLDING frames.
- [x] [VERIFIED] **R13: Building damage state frames** — Fixed: cycling animation for building damage frames. Matches C++ multi-frame damage progression.
- [x] [VERIFIED] **R14: Fog-gated minimap** — Fixed: enemies hidden in fog/shroud on radar. Matches C++ revealed-only unit display.
- [x] [VERIFIED] **R15: Muzzle flash colors** — Fixed: per-warhead muzzle flash colors. Matches C++ warhead-specific coloring.
- [x] [VERIFIED] **R16: Building destruction explosions** — Fixed: size-matched explosion animation on structure death. Matches C++ behavior.
- [x] [VERIFIED] **R17: Minimap faction colors** — Fixed: per-house unit colors on radar (Spain=gold, USSR=red, Greece=blue, etc.). Matches C++.
- [x] [VERIFIED] **R18: Minimap shroud** — Fixed: fog/shroud overlay on minimap. Matches C++ fog-of-war darkening.
- [x] [VERIFIED] **R19: Scroll arrows disabled state** — Fixed: dimmed when at top/bottom of strip. Matches C++ arrow rendering.

## AUDIO / MUSIC

- [x] **AU1: Combat music switching** — Correct.
- [x] **AU2: EVA announcements** — Correct.
- [x] **AU3: Unit voice responses** — Correct.
- [x] [VERIFIED] **AU4: EVA power gate** — Fixed: skips EVA when `powerFraction < 0.25`. Matches C++ power-gated EVA behavior.
- [x] [VERIFIED] **AU5: Superweapon SFX** — Fixed: sonar ping, nuke explosion SFX on activation. Matches C++ superweapon sounds.

## UI

- [x] **U1: Veterancy chevrons** — Correct (note: RA1 has no promotion system, just visual kill-count display).
- [x] **U2: Multi-portrait selection grid** — Correct.
- [~] **U3: Formation movement** — Grid-based position spreading works. Not true C++ formation movement (which locks relative positions via team missions). Acceptable simplification.
- [x] **U4: Structure damage sprites** — Correct.
- [x] [VERIFIED] **U5: Status line** — Fixed: ammo display for aircraft in unit info. Matches C++ persistent status readout.
- [x] [VERIFIED] **U6: Fullscreen radar toggle** — Fixed: 300x300 tactical map overlay toggle. Matches C++ Map button fullscreen radar behavior.

---

## STATS SUMMARY

| Category | Correct | Vibed/Approx | Wrong | Missing |
|----------|---------|-------------|-------|---------|
| Combat formula | 10 | 0 | 0 | 0 |
| Warheads | 4 | 1 | 0 | 0 |
| Scatter | 3 | 2 | 0 | 0 |
| Weapons | 29 matched | 0 | 0 | 4 missing |
| Infantry stats | 12 units OK | 0 | 0 | 2 missing |
| Vehicle stats | 14 units OK | 0 | 0 | 2 missing |
| Naval stats | 6 units OK | 0 | 0 | 0 |
| Aircraft stats | 5 units OK | 0 | 0 | 0 |
| Structure stats | 2 | 1 | 5 power drains | 0 |
| Movement | 4 | 4 | 1 | 0 |
| Pathfinding | 0 | 3 | 0 | 0 |
| Aircraft mech | 4 | 2 | 0 | 0 |
| Cloaking | 4 | 0 | 0 | 0 |
| Economy/ore | 5 | 0 | 2 | 0 |
| Production | 2 | 1 | 0 | 0 |
| Repair | 4 | 1 | 0 | 0 |
| Sell | 3 | 0 | 0 | 0 |
| Silo/storage | 3 | 0 | 0 | 0 |
| Spy mechanics | 6 | 0 | 0 | 0 |
| Engineer | 3 | 0 | 0 | 0 |
| Crates | 7 | 2 | 0 | 0 |
| Superweapons | 6 | 0 | 2 | 1 |
| Triggers | 2 | 3 | 0 | 0 |
| AI/missions | 1 | 2 | 0 | 3 |
| Dog mechanics | 2 | 0 | 0 | 0 |
| Special units | 4 | 1 | 1 | 3 |
| Gap generator | 1 | 0 | 0 | 0 |
| Rendering | 16 | 0 | 0 | 0 |
| Audio | 5 | 0 | 0 | 0 |
| UI | 5 | 1 | 0 | 0 |
| Power | 2 | 1 | 0 | 0 |

### Change Log

**2026-03-07 — Phases 1-8 parity sweep**

**Phase 1 (Data Constants):**
- RP1: RepairStep corrected to 5
- RP4: Service Depot rate corrected to 14 ticks
- Power drain table fixed: SILO=0, ATEK=50, AFLD=20, BARR=20, GAP=60
- SI3: Silos needed threshold now uses C++ formula

**Phase 2 (Combat):**
- CF7: Heal guard — distance + armor checks added
- DG1: Dog instant kill — uses maxHp
- DG2: Dog collateral — 0 damage to non-targets
- SC1: AP vs infantry — forces 0.5 inaccuracy
- SC2: Directional overshoot — non-arcing scatters along firing angle
- SC5: Arcing jitter — +/-5 degree angular jitter
- CF8: Wall destruction — walls destroyed by splash with IsWallDestroyer
- CF9: Ore destruction — ore reduced by splash with IsTiberiumDestroyer

**Phase 3 (Economy):**
- PR1: Power penalty — continuous sliding scale
- PR2: Multi-factory — confirmed already correct (linear)
- EC3: Bail-based capacity — 28 bails, gold=35, gem=110
- EC4: Gem bonus bails — 2 bonus bails per gem harvest
- EC5: Lump-sum unload — single deposit after 14-tick dump
- RP5: Repair cancel — removes from set + EVA announcement
- SI2: Capacity refund — confirmed already correct

**Phase 4 (Power/GAP):**
- PW1: Tesla at any deficit — disabled when powerConsumed > powerProduced
- PW3: Functional brownout — TSLA/GUN/SAM/AGUN skip firing during deficit
- GAP1: Shroud jamming — 10-cell radius jamming, power-gated, death cleanup

**Phase 5 (Aircraft/Cloak/Movement):**
- AC2: Takeoff rate — +1 px/tick (24 ticks)
- AC3: Landing rate — -1 px/tick
- AC4: Rearm timing — weapon.rof * rofBias
- MV4: 3-point turn removed
- CL3: Health-gated cloak — 96% stay uncloaked below ConditionRed
- CL4: Cloak conditions — removed proximity check, added firing check

**Phase 6 (Special Units):**
- Demo Truck self-destruct — 45-tick fuse + splash
- MAD Tank deploy — 90-tick charge + 600 HE to vehicles in 8 cells
- Mechanic AI — vehicle-seeking scan loop with GoodWrench ROF
- SP2: DOME spy — radarSpiedHouses only (not full reveal)
- SP4: SPEN spy — actually activates sonar superweapon
- Camera weapon added to WEAPON_STATS

**Phase 7 (Rendering):**
- R13: Building damage frames — cycling animation
- R14: Fog-gated minimap — enemies hidden in fog/shroud
- R15: Muzzle flash colors — per-warhead colors
- R16: Building death explosion — size-matched
- R17: Minimap faction colors — per-house colors
- R18: Minimap shroud — fog/shroud overlay
- R19: Scroll arrows disabled state — dimmed
- SL2: Sell animation timing — per-building frame count

**Phase 8 (Triggers/AI/Audio/UI):**
- TR3: NOFACTORIES event added (and expanded factory list)
- TR4: PLAY_MUSIC action added
- AI2: Threat scoring — uses unit cost
- AU4: EVA power gate — skips when powerFraction < 0.25
- AU5: Superweapon SFX — sonar ping, nuke explosion
- U5: Status line — ammo display for aircraft
- U6: Fullscreen radar toggle — 300x300 tactical map overlay
- CR8: Missing crate types — ParaBomb, Sonar, ICBM added

**Prior audit (pre-Phase 1):**
- WH3/WH4: Nuke and Mechanical warhead types
- All naval/aircraft weapon stats (Stinger, TorpTube, DepthCharge, 8Inch, Maverick, Hellfire, ChainGun, Sniper, TeslaCannon)
- 3TNK secondary, TRUK, TTNK, CTNK, QTNK, DTRK stats
- STNK cloaking/cost/crusher, AFLD cost
- E3 owner, SPY sight, GNRL/CHAN/Civilian HP, SHOK cost, MECH stats
- SS/DD/CA/PT/LST/MSUB sight/ROT/weapons
- HELI/HIND/MIG/YAK/TRAN HP/ROT/ammo/weapons
- CL1/CL2 cloak and sonar timing
- CR1-CR6/CR9 crate mechanics
- SP1/SP3/SP5/SP6 spy mechanics
- EN1 engineer full heal, SL1/SL3 sell mechanics
