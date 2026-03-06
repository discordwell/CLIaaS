# RA Engine: C++ Parity Audit

Full audit of the TypeScript engine against the C++ Red Alert source code and RULES.INI data.
Status key: `[x]` correct, `[~]` vibed/approximate, `[!]` wrong, `[ ]` missing, `[n/a]` out of scope.

Last audited: 2026-03-02

---

## COMBAT / DAMAGE FORMULA

- [x] [VERIFIED] **CF1: Distance-based falloff on direct hits** — Fixed: `modifyDamage()` now applies C++ inverse-proportional distance falloff on all hits via SpreadFactor-scaled distance divisor.
- [x] [VERIFIED] **CF2: Splash falloff formula** — Fixed: `applySplashDamage()` now uses `modifyDamage()` with C++ inverse formula `damage / distFactor` instead of linear falloff.
- [x] [VERIFIED] **CF3: Splash radius** — Fixed: Universal `Game.SPLASH_RADIUS = 1.5` cells for all warheads, matching C++ `ICON_LEPTON_W + ICON_LEPTON_W/2`.
- [x] [VERIFIED] **CF4: MinDamage threshold** — Fixed: `modifyDamage()` applies MinDamage=1 when `distFactor < 4`, matching C++ combat.cpp:126-128.
- [x] **CF5: MaxDamage cap** — Both cap at 1000. Correct.
- [x] **CF6: Friendly fire splash** — Both damage all entities regardless of house. Correct.
- [ ] **CF7: Heal damage guard** — C++ only applies negative (heal) damage if `distance < 0x008 AND armor == ARMOR_NONE` (combat.cpp:86-96). TS has no range/armor check for healing.
- [ ] **CF8: Wall/overlay destruction from splash** — C++ `Explosion_Damage` destroys walls/wood overlays based on warhead `IsWallDestroyer`/`IsWoodDestroyer` flags (combat.cpp:243-255). TS `applySplashDamage` does not destroy walls.
- [ ] **CF9: Ore destruction from splash** — C++ reduces ore when `IsTiberiumDestroyer` (combat.cpp:247-249). Not in TS.
- [x] **CF10: Firepower house bias** — Applied correctly in both. Match.

## WARHEADS

- [x] **WH1: Armor type mapping** — All 5 types (none/wood/light/heavy/concrete) with correct indices. Match.
- [x] **WH2: Warhead Verses values** — SA, HE, AP, Fire, HollowPoint, Super, Organic all match RULES.INI.
- [ ] **WH3: Nuke warhead** — C++ has `WARHEAD_NUKE` (index 7). Not in TS WarheadType union. Nuke damage is hard-coded elsewhere.
- [ ] **WH4: Mechanical warhead** — C++ has `WARHEAD_MECHANICAL` (index 8, used by Mechanic's GoodWrench). Not in TS WarheadType.
- [ ] **WH5: BulletTypeClass system** — C++ has a full projectile type system (IsArcing, ROT for homing, IsInaccurate, IsAntiAircraft, IsFueled, IsInvisible etc.). TS flattens all properties onto WeaponStats, losing bullet-weapon distinction.

## SCATTER / INACCURACY

- [!] **SC1: AP-vs-infantry inaccuracy** — C++ forces scatter for AP warhead against infantry/cell targets even with no inherent weapon inaccuracy (bullet.cpp:710). TS does not implement this.
- [!] **SC2: Non-arcing scatter shape** — C++ non-arcing projectiles overshoot along flight path via `Coord_Move` (bullet.cpp:725-728). TS always scatters circularly. Artillery should overshoot, not scatter in a circle.
- [~] **SC3: Scatter distance formula** — C++ uses `(distance/16) - 64` capped at HomingScatter(512)/BallisticScatter(256) (bullet.cpp:718-727). TS uses `inaccuracy * CELL_SIZE * (dist/range)`. Different math, similar intent.
- [~] **SC4: Moving-fire inaccuracy** — Both increase inaccuracy when moving. C++ sets bullet IsInaccurate flag; TS guarantees minimum 1.0-cell inaccuracy. Different mechanisms.
- [ ] **SC5: Arcing direction randomization** — C++ adds `dir + Random_Pick(0,10)-5` for arcing scatter (bullet.cpp:722). Not in TS.

## WEAPON STATS

Weapon values verified against RULES.INI. Infantry/vehicle primary weapons mostly correct; naval/aircraft weapons are extensively wrong.

### Correct weapons:
- [x] M1Carbine (15/20/3.0/SA), Grenade (50/60/4.0/HE), Dragon (35/50/5.0/AP)
- [x] RedEye (50/50/7.5/AP), Flamer (70/50/3.5/Fire), DogJaw (100/10/2.2/Organic)
- [x] Heal (-50/80/1.83), M60mg (15/20/4.0/SA), 75mm (25/40/4.0/AP)
- [x] 90mm (30/50/4.75/AP), 105mm (30/70/AP), 120mm (40/80/AP)
- [x] MammothTusk (75/80/5.0/AP/burst:2), 155mm (150/65/6.0/HE)

### Wrong weapons:
- [!] **120mm burst** — C++ Burst=2. TS does not set burst. (Mammoth main gun should double-fire)
- [!] **Stinger** — TS: 15/20/5.0. C++: 30/60/9.0. All three values wrong.
- [!] **TorpTube** — TS: 50/60/5.0. C++: 90/60/9.0. Damage and range wrong.
- [!] **DepthCharge** — TS: 40/30/3.0. C++: 80/60/5.0. All three values wrong.
- [!] **8Inch (CA weapon)** — C++ Cruiser uses 8Inch (damage 500). TS uses fictional "Tomahawk" (damage 50). 10x damage difference.
- [!] **2Inch (PT weapon)** — C++ Gunboat uses 2Inch. TS uses Stinger. Wrong weapon entirely.
- [!] **Maverick** — TS: 60/50/5.0. C++: 50/3/6.0. ROF is 17x too slow.
- [!] **Hellfire** — TS: 30/40/5.0. C++: 40/60/4.0. All three wrong.
- [!] **ChainGun** — TS: 15/10/4.0/AP. C++: 40/3/5.0/SA. Damage, ROF, range, and warhead all wrong.
- [REMOVED] **Nike (SAM)** — Removed. MRLS was a Tiberian Dawn unit, not in RA. Nike weapon only used by MRLS.
- [!] **Sniper** — TS: 125/5.0. C++: 100/3.75. Damage and range wrong.
- [!] **TeslaCannon (building)** — TS: 80/40/7.0. C++: ~100/120/8.5. All wrong.

### Missing weapons:
- [ ] **Colt45** (Tanya), **Pistol** (Stavros), **TurretGun** (GUN building), **8Inch** (Cruiser), **2Inch** (Gunboat), **ParaBomb**, **SCUD** (V2 Launcher), **Democharge**, **Camera** (Spy plane)

## UNIT STATS — INFANTRY

- [x] **E1 Rifle** — All stats match (50hp/4spd/100cost/M1Carbine).
- [x] **E4 Flamethrower** — All stats match (40hp/3spd/300cost/Flamer/soviet).
- [x] **E6 Engineer** — All stats match (25hp/4spd/500cost).
- [x] **DOG** — All stats match (12hp/4spd/200cost/DogJaw/soviet).
- [x] **MEDI** — All stats match (80hp/4spd/800cost/Heal/allied).
- [x] [VERIFIED] **E2 Grenadier owner** — Fixed: soviet-only in both UNIT_STATS and PRODUCTION_ITEMS.
- [x] [VERIFIED] **E3 Rocket Soldier weapons** — Primary=RedEye, Secondary=Dragon. Matches C++.
- [!] **E3 owner** — C++ allies-only. TS says both factions.
- [~] **SPY sight** — C++ 5. TS 4.
- [!] **GNRL Stavros** — C++ 80hp/5spd/3sight/Pistol. TS 100hp/4spd/4sight/Sniper. All wrong.
- [!] **CHAN Specialist** — C++ 25hp/5spd/2sight. TS 50hp/4spd/3sight.
- [!] **Civilians (C1-C10)** — C++ 25hp/5spd. TS 5hp/3spd.
- [!] **SHOK cost** — C++ 900. TS 400.
- [!] **MECH** — C++ 60hp/950cost. TS 70hp/500cost.
- [ ] **E7 Tanya** — Not implemented. Missing C4, swimming, dual Colt45.
- [ ] **THF Thief** — Not implemented.

## UNIT STATS — VEHICLES

- [x] **1TNK Light Tank** — All match (300hp/9spd/700cost/75mm).
- [x] **2TNK Medium Tank** — All match (400hp/8spd/800cost/90mm).
- [x] **4TNK Mammoth** — All match (600hp/4spd/1700cost/120mm+MammothTusk).
- [x] **JEEP Ranger** — All match (150hp/10spd/600cost/M60mg).
- [x] **APC** — All match (200hp/10spd/800cost/M60mg/5 passengers).
- [x] **ARTY Artillery** — All match (75hp/6spd/600cost/155mm).
- [x] **HARV Harvester** — All match (600hp/6spd/1400cost).
- [x] **MCV** — All match (600hp/6spd/light armor).
- [!] **3TNK Heavy Tank secondary** — C++ has Secondary=105mm. TS has none.
- [!] **TRUK Supply Truck** — C++ light armor/10spd/3sight. TS heavy/8spd/2sight.
- [!] **TTNK Tesla Tank** — C++ 110hp/8spd. TS 300hp/5spd. HP is 3x too high, speed too slow.
- [!] **CTNK Chrono Tank** — C++ 350hp/5spd/light/2400cost/APTusk. TS 200hp/7spd/heavy/1200cost/90mm. Nearly every stat wrong.
- [!] **QTNK MAD Tank** — C++ 300hp/3spd. TS 200hp/6spd.
- [!] **DTRK Demo Truck** — C++ 110hp/light/8spd. TS 100hp/none/10spd.
- [!] **STNK Phase Transport** — C++ 800cost/crusher. TS 1100cost/no crusher. Missing cloakable flag.
- [ ] **V2RL V2 Rocket** — Not implemented.
- [ ] **MNLY Minelayer** — Not implemented. No mine mechanics.
- [REMOVED] **MRLS** — Removed. Tiberian Dawn unit, not in RA Aftermath.

## UNIT STATS — NAVAL

Nearly every naval stat is wrong. All ROT values are lower than C++. Weapons are substituted.

- [!] **SS Submarine** — C++ sight=6/ROT=7. TS sight=3/ROT=4.
- [!] **DD Destroyer** — C++ speed=6/sight=6/ROT=7. TS speed=9/sight=5/ROT=4.
- [!] **CA Cruiser** — C++ speed=4/sight=7/ROT=5/Primary=8Inch(500dmg). TS speed=6/sight=6/ROT=4/Primary=Tomahawk(50dmg).
- [!] **PT Gunboat** — C++ heavy armor/speed=9/sight=7/ROT=7/Primary=2Inch/Secondary=DepthCharge. TS light/10/5/6/Stinger/none.
- [!] **LST Transport** — C++ 350hp/speed=14/sight=6/ROT=10/5 passengers. TS 400hp/6/3/4/8 passengers.
- [~] **MSUB Missile Sub** — C++ sight=6/1650cost. TS sight=4/1500cost.

## UNIT STATS — AIRCRAFT

Nearly every aircraft stat is wrong. C++ aircraft have Sight=0 (rely on ground units for vision). All ammo values are wrong.

- [!] **HELI Longbow** — C++ 225hp/16spd/ROT=4/1200cost/ammo=6. TS 100hp/10spd/ROT=8/1500cost/ammo=2.
- [!] **HIND** — C++ 225hp/12spd/ROT=4/no secondary/ammo=12. TS 125hp/10spd/ROT=8/Hellfire secondary/ammo=4.
- [!] **MIG** — C++ 50hp/20spd/ROT=5/Maverick primary+secondary/ammo=3. TS 60hp/12spd/ROT=4/Maverick primary only/ammo=2.
- [!] **YAK** — C++ 60hp/16spd/ROT=5/ChainGun primary+secondary/ammo=15. TS 50hp/12spd/ROT=4/Maverick(wrong weapon)/ammo=1.
- [!] **TRAN Chinook** — C++ 1200cost/ROT=5. TS 700cost/ROT=8.
- [!] **MIG/YAK HP swapped** — MIG should be 50 (TS has 60), YAK should be 60 (TS has 50).

## STRUCTURE STATS

- [!] **All structure HPs** — TS uses normalized 0-256 scale with ad-hoc overrides. C++ uses absolute values (300-1000). No structure HP matches. Examples: POWR C++=400 TS=256, WEAP C++=1000 TS=256, PROC C++=900 TS=256.
- [!] **Power: TENT** — C++ drain=20. TS drain=10.
- [!] **Power: GUN** — C++ drain=40. TS drain=10.
- [!] **Power: TSLA** — C++ drain=150. TS drain=100 (player) / 150 (AI). Internal inconsistency.
- [!] **Power: STEK** — C++ drain=100. TS drain=200.
- [ ] **Power: BARR, GAP, SILO** — Not in TS power calculation at all.
- [!] **AFLD cost** — C++ 600. TS 2000.
- [!] **AI vs Player power tables inconsistent** — TSLA (100 vs 150), GUN (10 vs 20), ATEK (200 vs 50), AFLD (30 vs 20) differ between player and AI code paths within TS itself.

## MOVEMENT

- [~] **MV1: Free-form vs track-table movement** — C++ uses pre-computed track tables with lepton accumulators (drive.cpp). TS uses free-form vector movement. Architectural difference — produces different movement curves around corners.
- [x] [VERIFIED] **MV2: Damage speed — single tier** — Fixed: removed fabricated ConditionRed 0.5x tier. Now only one tier: <=50% HP = 0.75x speed, matching C++ drive.cpp:1157-1161.
- [!] **MV3: Close-enough distance unit bug** — `worldDist()` returns cells but is compared against `CELL_SIZE * 2.5 = 60` (pixels). Creates 60-cell tolerance instead of 2.5. Masked by pathfinding exhausting path first.
- [!] **MV4: Three-point turns are fabricated** — The C++ three-point turn code is behind `#ifdef TOFIX` and `IsThreePoint=false` — it is NOT COMPILED in the released game (drive.cpp:328-361). The TS 0.3px backward drift for JEEPs has zero C++ basis.
- [x] [VERIFIED] **MV5: Terrain multipliers capped at 1.0** — All terrain speed multipliers verified ≤1.0. No road speed bonus exceeds base speed.
- [~] **MV6: Terrain types incomplete** — C++ has 9 LandTypes (Clear, Road, Water, Rock, Wall, Ore, Beach, Rough, River). TS has 5 (Clear, Water, Rock, Tree, Wall). Tree is not a C++ LandType; Beach, Rough, River, Ore are missing.
- [~] **MV7: Speed values are vibed** — TS speed integers don't map to C++ MPHType (0-255) via any conversion. Ground unit values happen to match raw INI integers but aircraft/naval deviate.
- [~] **MV8: speedFraction = 0.5 default** — No C++ analog. Appears to be a tuning knob for 15 FPS / 24px cells.
- [x] [VERIFIED] **MV9: House GroundspeedBias on rotation** — Already implemented in entity.ts `tickRotation()` — applies `groundspeedBias` to rotation rate.

## PATHFINDING

- [~] **PF1: Different algorithm** — C++ uses LOS + edge-follow (findpath.cpp:435). TS uses A*. Both produce valid paths but differ in behavior around obstacles.
- [~] **PF2: Occupancy handling** — C++ hard-blocks on occupied cells and tells blocking unit to move. TS uses soft penalty (+20 cost), routing through occupied cells.
- [~] **PF3: Passability nuance** — C++ `Can_Enter_Cell()` returns nuanced results (MOVE_OK, MOVE_TEMP, MOVE_CLOAK etc.). TS uses boolean `isTerrainPassable()`.

## AIRCRAFT

- [!] **AC1: Aircraft ammo values** — All wrong. MIG: TS=2, C++=3. YAK: TS=1, C++=15. HELI: TS=2, C++=6. HIND: TS=4, C++=12.
- [~] **AC2: Takeoff rate** — C++ 1 pixel/tick (~24 ticks to altitude) with 5-stage speed ramping. TS 3px/tick (8 ticks). 3x too fast, no speed stages.
- [~] **AC3: Landing rate** — C++ 1 pixel/tick (~24 ticks). TS 2px/tick (12 ticks). 2x too fast.
- [~] **AC4: Rearm timing** — C++ uses weapon-specific `Rearm_Delay()`. TS uses fixed 30 ticks for all weapons.
- [~] **AC5: Aircraft speed fraction** — TS uses `speedFraction = 0.7` for all aircraft. No C++ analog.
- [~] **AC6: Helicopter strafe oscillation** — TS adds `sin(tick * 0.21) * 0.5` lateral movement during hover attacks. Purely decorative, no C++ basis.
- [x] **AC7: Flight altitude** — 24 pixels matches C++ FLIGHT_LEVEL=256 leptons = 1 cell = 24px. Correct.

## SUBMARINE / CLOAKING

- [!] **CL1: Cloak transition timing** — C++ MAX_UNCLOAK_STAGE=38 ticks (~2.5s). TS CLOAK_TRANSITION_FRAMES=15 (1.0s). Transitions 2.5x too fast.
- [!] **CL2: Sonar pulse duration** — C++ 225 ticks (15s). TS 150 ticks (10s). 33% too short.
- [ ] **CL3: Health-gated cloaking** — C++ prevents auto-cloak below ConditionRed (25% HP) with 4% random override chance. TS always allows cloaking regardless of HP.
- [~] **CL4: Auto-cloak conditions diverge** — C++ checks: not firing, not damaged below red, CloakDelay expired, stage==0. TS checks: sonarPulseTimer==0, not ATTACK mission, no enemies within 3 cells. TS adds a proximity check absent in C++, misses firing/health checks.

## DOG MECHANICS

- [!] **DG1: Instant kill not implemented** — C++ dogs set `damage = target.Strength` (infantry.cpp:339-345) — guaranteed instant kill regardless of target HP. TS DogJaw deals flat 100 damage. A 200hp spy survives a dog bite in TS.
- [ ] **DG2: Collateral prevention** — C++ dog attacks do 0 damage to non-targets. TS has no such guard — splash to nearby unarmored infantry is possible.

## SPY MECHANICS

- [!] **SP1: PROC infiltration is Thief's ability** — C++ Spy does NOT steal credits (infantry.cpp:645-676). Credit theft is the Thief's ability (infantry.cpp:675). Spy on PROC just sets `SpiedBy` flag revealing enemy money. TS incorrectly gives Spy the Thief's credit-stealing mechanic.
- [!] **SP2: DOME infiltration wrong** — C++ spy on Radar Dome sets `RadarSpied` (lets you see enemy radar view). Does NOT reveal entire map. TS gives 60s of full map reveal.
- [!] **SP3: POWR infiltration invented** — C++ spy does NOT damage power plants. Setting `SpiedBy` on POWR reveals nothing useful. TS reduces HP to 25%, which is a custom mechanic.
- [ ] **SP4: Sub Pen spy effect** — C++ spy on Sub Pen grants Sonar Pulse superweapon. Not implemented.
- [ ] **SP5: Factory spy effect** — C++ spy on factory reveals what it's building. Not implemented.
- [!] **SP6: DOME spy bug** — Even by TS's own design, `fogDisabled = true` is set but `map.revealAll()` is never called. Already-shrouded cells stay dark.

## ENGINEER MECHANICS

- [!] **EN1: Friendly repair amount** — C++ `Renovate()` heals building to FULL HP (building.cpp). TS heals only +33% of maxHp.
- [x] **EN2: Capture threshold** — Both use 25% (ConditionRed). Correct.
- [x] **EN3: Engineer damage** — Both deal 1/3 of maxHP. Correct.

## CRATE SYSTEM

- [!] **CR1: Money amount** — C++ `SoloCrateMoney = 2000` (rules.cpp:126). TS gives 500. 4x too low.
- [!] **CR2: Armor crate** — C++ sets `ArmorBias` (damage reduction multiplier). TS doubles maxHp AND fully heals. Completely different mechanic.
- [!] **CR3: Firepower crate** — C++ sets `FirepowerBias` (damage multiplier). TS heals unit to full + gives 500 credits. Entirely wrong.
- [!] **CR4: Reveal crate** — C++ reveals entire map (`IsVisionary = true`). TS reveals 5x5 cell area. Major mismatch.
- [!] **CR5: Cloak crate** — C++ makes unit permanently cloakable (`IsCloakable = true`). TS gives 30s temporary cloak. Major mismatch.
- [!] **CR6: Crate lifetime** — C++ crates last 5-20 minutes (`Random_Pick(CrateTime/2, CrateTime*2)`, default CrateTime=10min). TS expires after 3 minutes.
- [~] **CR7: Speed crate** — TS gives speedBias=1.5. C++ sets SpeedBias but exact value unclear. Mechanism is correct.
- [ ] **CR8: Missing crate types** — ParaBomb, Sonar, ICBM, TimeQuake, Vortex not implemented.
- [~] **CR9: Spawn distribution** — C++ uses weighted `CrateShares[]` array per type. TS uses flat equal probability.

## ECONOMY / ORE

- [x] [VERIFIED] **EC1: Gold value** — 35 credits per bail. Matches C++ `GoldValue = 35`.
- [x] [VERIFIED] **EC2: Gem value** — 110 credits per bail. Matches C++ `GemValue = 110`.
- [!] **EC3: Ore capacity system** — C++ counts bails (28 max, `BailCount=28`). Full gold load = 28*35 = 980 credits. TS uses credit cap of 700. Different system, wrong values.
- [ ] **EC4: Gem bonus bails** — C++ gives 2 extra bonus bails per gem harvest action (unit.cpp:2306-2308, worth 220 extra credits). TS has no bonus mechanic.
- [!] **EC5: Ore unload** — C++ credits full load as lump sum after dump animation completes. TS trickles 50 credits/tick incrementally.
- [!] **EC6: Ore growth — gems shouldn't grow** — C++ only grows gold overlays (cell.cpp:2869-2883), NEVER gems. TS grows both.
- [!] **EC7: Ore spread** — C++ requires density > 6, spreads to 8 directions (cell.cpp:2904-2918). TS has no density threshold, spreads to 4 cardinal only.

## PRODUCTION

- [!] **PR1: Power penalty formula** — C++ uses continuous sliding scale: `power_fraction.Inverse()` (range 1x-2x slowdown). TS uses binary 25% speed or 100%. C++ at 75% power = 1.33x slower; TS would be full speed.
- [!] **PR2: Multi-factory formula** — C++ divides build time by factory count (linear: 2 factories = 2x, 3 = 3x). TS uses diminishing returns (1.5x/1.75x/2x max).
- [~] **PR3: Cost deduction timing** — C++ deducts cost incrementally per-tick during production. TS deducts full cost upfront and refunds unbuilt fraction on cancel. Different cash flow.

## REPAIR

- [x] **RP1: RepairStep / RepairPercent** — Both use 5 HP / 0.25 cost ratio. Correct.
- [x] **RP2: Repair cost formula** — `ceil(cost * 1.25 / maxHp)` per step. Matches.
- [~] **RP3: Repair rate** — C++ ~14 ticks. TS 15 ticks. Close.
- [!] **RP4: Service Depot repair rate** — TS repairs every 3 ticks. C++ uses same ~14-tick rate. TS depot is 4.7x too fast.
- [!] **RP5: Repair cancel on no funds** — C++ cancels repair entirely (`IsRepairing = false`). TS merely pauses (continues checking next tick).

## SELL

- [!] **SL1: Sell refund NOT health-scaled** — C++ refund = `RawCost * CostBias * RefundPercent(0.5)`. Health does NOT affect refund (techno.cpp:5743-5761). TS scales refund by HP ratio. Selling a damaged building in TS gives less than it should.
- [~] **SL2: Sell animation duration** — C++ plays construction animation in reverse (varies per building). TS uses fixed 15-tick (1s) for all.
- [ ] **SL3: Wall selling** — C++ allows selling placed walls for 50% refund. TS does not support wall selling.

## SILO / STORAGE

- [x] **SI1: Storage values** — PROC=1000, SILO=1500. Correct (note: previous doc had PROC=2000 which was wrong; actual C++ is 1000).
- [!] **SI2: Capacity reduction** — C++ refunds excess tiberium to cash Credits when capacity reduced gracefully (house.cpp:1946-1967). TS always loses excess.
- [~] **SI3: Silos needed threshold** — C++ triggers when `(Capacity - Tiberium) < 300 && Capacity > 500`. TS triggers at 80% capacity.

## WALL PLACEMENT

- [!] **WL1: Wall adjacency** — C++ does not require wall adjacency to existing structures. TS requires walls to be adjacent to existing buildings, preventing distant wall construction.

## BUILDING PLACEMENT

- [x] **BP1: Adjacency distance** — Both use 1-cell default. Correct.
- [x] **BP2: Refinery spawns free harvester** — Both do. Correct.
- [~] **BP3: AI adjacency** — TS uses 4-cell AI adjacency (more generous than C++ default of 1).

## POWER

- [!] **PW1: Tesla Coil power cutoff** — C++ disables at any power deficit (Power_Fraction < 1.0). TS uses 1.5x threshold for full disable, half-rate cooldown at mild deficit. Different behavior.
- [~] **PW2: Defense brownout** — C++ uses per-building `IsPowered` flag from INI. TS uses global thresholds (1.5x severe, any deficit mild). Different mechanism.

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
- [~] **TR3: Event coverage** — 22 of 32 C++ events implemented. Missing: SPIED, BUILDINGS_DESTROYED, NBUILDINGS_DESTROYED, NOFACTORIES, EVAC_CIVILIAN, BUILD_UNIT/INFANTRY/AIRCRAFT, FAKES_DESTROYED.
- [~] **TR4: Action coverage** — ~20 of 35 C++ actions implemented. Missing: DESTROY_TEAM, FIRE_SALE, PLAY_MOVIE, WINLOSE, REVEAL_ZONE, PLAY_MUSIC/SPEECH, CREEP_SHADOW, DESTROY_OBJECT, SPECIAL_WEAPON, PREFERRED_TARGET, LAUNCH_NUKES.
- [~] **TR5: Event index mapping** — TS defines event constants with different indices than C++ enum (e.g. LOW_POWER=15 in TS, 30 in C++; THIEVED=17 in TS, 3 in C++). Works if INI parser maps correctly, but constants are misleading.

## AI / MISSIONS

- [~] **AI1: Mission system** — 7 of 22 C++ missions formalized (GUARD, AREA_GUARD, MOVE, ATTACK, HUNT, SLEEP, DIE). Others handled ad-hoc (harvester AI, engineer capture, etc.) rather than as formal mission states.
- [!] **AI2: Threat scoring formula** — C++ uses cost-proportional `Value()` (100-800+) with designated enemy house +500/3x, zone modifiers, and hyperbolic distance falloff `(value * 32000) / (dist + 1)` (techno.cpp:1449-1763). TS uses flat constants (10-30) with linear distance falloff. Completely different system.
- [~] **AI3: AI house behavior** — Entirely custom phase-based system (economy/buildup/attack). Not a port of C++ AI. Acceptable since ants use separate `updateAntAI`.
- [ ] **AI4: Designated enemy house** — C++ `House->Enemy` gives +500 then 3x to targets from designated enemy. Not implemented.
- [ ] **AI5: Area modification (splash avoidance)** — C++ `Area_Modify()` reduces score for targets near friendly buildings to avoid splash. Not implemented.
- [ ] **AI6: Spy target exclusion** — C++ excludes spies from general threat evaluation (except dogs). TS does not exclude spies from `threatScore()`.

## MISSING UNITS — SPECIAL ABILITIES

- [ ] **Tanya** — Not implemented (C4 on buildings, swimming, dual Colt45).
- [ ] **Thief** — Not implemented (credit theft on entering enemy refinery/silo).
- [ ] **V2 Rocket Launcher** — Not implemented.
- [ ] **Minelayer + mines** — Not implemented (AP mine placement, detection, damage, mine limit).
- [!] **Chrono Tank teleport** — Unit type exists as stub. No self-teleport ability.
- [!] **MAD Tank shockwave** — Unit type exists as stub. No seismic weapon.
- [!] **Demo Truck kamikaze** — Unit type exists as stub. No self-destruct explosion.
- [!] **Phase Transport cloaking** — Unit type exists. Missing `isCloakable` flag.
- [~] **Mechanic AI** — GoodWrench weapon defined. No dedicated vehicle-healing AI loop (medic has one for infantry).

## GAP GENERATOR

- [!] **GAP1: No shroud effect** — C++ GAP building jams enemy vision in 10-cell radius (rules.cpp:222 `GapShroudRadius=10`), re-shrouds every ~90 ticks, power-gated. TS GAP building exists, renders, costs power, but produces zero gameplay effect.

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

## AUDIO / MUSIC

- [x] **AU1: Combat music switching** — Correct.
- [x] **AU2: EVA announcements** — Correct.
- [x] **AU3: Unit voice responses** — Correct.

## UI

- [x] **U1: Veterancy chevrons** — Correct (note: RA1 has no promotion system, just visual kill-count display).
- [x] **U2: Multi-portrait selection grid** — Correct.
- [~] **U3: Formation movement** — Grid-based position spreading works. Not true C++ formation movement (which locks relative positions via team missions). Acceptable simplification.
- [x] **U4: Structure damage sprites** — Correct.

---

## STATS SUMMARY

| Category | Correct | Vibed/Approx | Wrong | Missing |
|----------|---------|-------------|-------|---------|
| Combat formula | 6 | 0 | 0 | 3 |
| Warheads | 2 | 0 | 0 | 3 |
| Scatter | 0 | 2 | 2 | 1 |
| Infantry weapons | 14 matched | 0 | 2 | 1 |
| Vehicle weapons | 10 matched | 0 | 1 | 0 |
| Naval weapons | 0 | 0 | 5 | 2 |
| Aircraft weapons | 0 | 0 | 3 | 0 |
| Structure weapons | 0 | 0 | 3 | 1 |
| Infantry stats | 7 units OK | 1 | 3 | 2 |
| Vehicle stats | 8 units OK | 0 | 7 | 3 |
| Naval stats | 0 | 1 | 5 | 0 |
| Aircraft stats | 0 | 0 | 5 | 0 |
| Structure stats | 0 | 0 | All HPs | 3 power entries |
| Movement | 3 | 4 | 2 | 0 |
| Economy/ore | 2 | 0 | 5 | 1 |
| Production | 0 | 1 | 2 | 0 |
| Repair | 2 | 1 | 2 | 0 |
| Sell | 0 | 1 | 1 | 1 |
| Spy mechanics | 0 | 0 | 4 | 2 |
| Crates | 0 | 2 | 6 | 1 |
| Superweapons | 0 | 0 | 5 | 1 |
| Triggers | 2 | 3 | 0 | 0 |
| AI/missions | 0 | 2 | 1 | 3 |
| Special units | 0 | 1 | 4 | 5 |
| Rendering | 4 | 0 | 0 | 0 |
| Audio | 3 | 0 | 0 | 0 |
| UI | 3 | 1 | 0 | 0 |
