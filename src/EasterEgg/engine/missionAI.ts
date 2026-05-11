/**
 * Mission AI subsystem — unit-level mission state machines for ATTACK, HUNT,
 * GUARD, AREA_GUARD, RETREAT, AMBUSH, REPAIR, and force-fire behaviors.
 * Extracted from Game class (index.ts) to isolate mission-level AI logic.
 */

import {
  type WorldPos, type WeaponStats, type ArmorType,
  type WarheadType, type WarheadMeta, type WarheadProps,
  CELL_SIZE, LEPTON_SIZE, MAP_CELLS,
  House, Mission, AnimState, UnitType, Stance, MISSION_CONTROL,
  leptonDist, pixelToLepton, directionTo, directionToLeptons, directionToLeptons256, worldToCell, DIR_DX, DIR_DY,
  EXPLOSION_FRAMES, CONDITION_RED,
  calcProjectileTravelFrames, modifyDamage, projectileVisualConfig,
  PRODUCTION_ITEMS, STRUCTURE_POINTS,
  getWarheadMultiplier, coordTargetRoundTripLepton, cellTargetToLepton,
} from './types';
import { Entity, CloakState, CLOAK_TRANSITION_FRAMES, dir256ToFacing8, dir256ToFacing32 } from './entity';
import {
  type MapStructure, CAPTURABLE_BUILDINGS, STRUCTURE_WEAPONS, STRUCTURE_SIZE,
  getStructureOccupyCells, structureCenterLeptons as cppStructureCenterLeptons,
  structureTargetLeptons as cppStructureTargetLeptons,
} from './scenario';
import { type Effect } from './renderer';
import { type GameMap, MoveResult, Terrain } from './map';
import { findPath } from './pathfinding';
import { canTargetNaval } from './aircraft';
import { combatAnim, entityTargetLeptons, entityTargetPixels } from './combat';
import { ScenarioRandom } from './random';
import { isScg01Jeep27DebugEnabled } from './perCellProcess';
import { type LogicAnim, spawnLogicAnimForSprite } from './logicAnim';
import { assignMission } from './missionLifecycle';

// ── Context interface ───────────────────────────────────────────────────────

/** Context object providing mission AI functions access to game state and callbacks */
export interface MissionAIContext {
  // Data
  entities: Entity[];
  structures: MapStructure[];
  effects: Effect[];
  logicAnims: LogicAnim[];
  map: GameMap;
  tick: number;
  playerHouse: House;
  killCount: number;
  evaMessages: { text: string; tick: number }[];
  warheadOverrides: Record<string, [number, number, number, number, number]>;
  scenarioWarheadMeta: Record<string, WarheadMeta>;
  scenarioWarheadProps: Record<string, WarheadProps>;

  // Alliance / ownership
  isAllied(a: House, b: House): boolean;
  entitiesAllied(a: Entity, b: Entity): boolean;
  isPlayerControlled(e: Entity): boolean;

  // Movement / speed
  movementSpeed(entity: Entity): number;
  /** C++ InfantryClass::Start_Driver — find sub-cell, atomic occupy-bit swap */
  infantryStartDriver(entity: Entity, destCX: number, destCY: number): { lx: number; ly: number } | null;
  /** C++ InfantryClass::Can_Enter_Cell — entity-aware scatter/path entry check */
  infantryCanEnterCell?: (entity: Entity, cx: number, cy: number, facing?: number) => MoveResult;
  /** C++ InfantryClass::Stop_Driver — clear Head_To_Coord claim, occupy current coord */
  stopInfantryDriver?: (entity: Entity) => void;
  /** C++ Movement_AI:3810 — validate next path cell, re-path if blocked */
  infantryValidatePath(entity: Entity): void;
  /** C++ FootClass::Approach_Target (foot.cpp:926) — find a passable cell within
   *  weapon range of entity.target and assign it as moveTarget. Called when a
   *  mission (HUNT, AREA_GUARD) has a legal TarCom but the target is out of range. */
  approachTarget(entity: Entity): void;

  // Sound
  playSoundAt(name: string, x: number, y: number): void;
  playEva(name: string): void;
  playSound(name: string): void;
  weaponSound(name: string): string;

  // Combat delegation — these call back into the Game class / combat.ts wrappers.
  // Retaliation is now embedded in damageEntity (C++ FootClass::Take_Damage unified
  // entry point — foot.cpp:1166-1234), so no separate callback is needed.
  damageEntity(target: Entity, amount: number, warhead: WarheadType, attacker?: Entity): boolean;
  damageStructure(s: MapStructure, damage: number): boolean;
  handleUnitDeath(victim: Entity, opts: {
    screenShake: number; explosionSize: number; debris: boolean;
    decal: { infantry: number; vehicle: number; opacity: number } | null;
    explodeLgSound: boolean; attackerIsPlayer: boolean; trackLoss: boolean;
    attacker?: Entity;
  }): void;
  launchProjectile(
    attacker: Entity, target: Entity | null, weapon: WeaponStats,
    damage: number, impactX: number, impactY: number, directHit: boolean,
    launchCoord?: { lx: number; ly: number },
  ): void;
  /** C++ TechnoClass::Fire_At (techno.cpp:3263-3265) — if a non-player
   *  shooter fires while hidden from PlayerPtr, it reveals a 2-cell radius
   *  around itself via Map.Sight_From(..., PlayerPtr, false). */
  revealShooterFromFire?(entity: Entity): void;
  applySplashDamage(
    center: WorldPos, weapon: { damage: number; warhead: WarheadType; splash?: number },
    primaryTargetId: number, attackerHouse: House, attacker?: Entity,
  ): void;

  // Warhead helpers
  getFirepowerBias(house: House): number;
  /** C++ house.cpp:293: ArmorBias — difficulty-scaled armor bonus */
  getArmorBias(house: House): number;
  /** C++ house.cpp:293,303: ROFBias — difficulty-scaled rate-of-fire */
  getROFBias(house: House): number;
  getWarheadMult(warhead: WarheadType, armor: ArmorType): number;
  getWarheadMeta(warhead: WarheadType): WarheadMeta;
  getWarheadProps(warhead: WarheadType | string | undefined): WarheadProps | undefined;
  warheadMuzzleColor(warhead: WarheadType | string): string;
  weaponProjectileStyle(name: string): 'bullet' | 'fireball' | 'shell' | 'rocket' | 'grenade';

  // Mission helpers
  idleMission(entity: Entity): Mission;
  retreatFromTarget(entity: Entity, targetPos: WorldPos): void;
  threatScore(scanner: Entity, target: Entity, dist: number): number;

  // Special unit delegation — these call back into Game class methods
  updateDemoTruck(entity: Entity): void;
  updateMedic(entity: Entity): void;
  updateMechanicUnit(entity: Entity): void;
  updateTanyaC4(entity: Entity): void;
  updateThief(entity: Entity): void;
  spyDisguise(spy: Entity, target: Entity): void;
  spyInfiltrate(spy: Entity, structure: MapStructure): void;

  // Minimap alert
  minimapAlert(cx: number, cy: number): void;

  // C++ techno.cpp:1529 Evaluate_Object checks strict PlayerPtr visibility:
  // candidate is valid if IsOwnedByPlayer OR IsDiscoveredByPlayer.
  isDiscoveredByPlayer?(entity: Entity): boolean;
  isDiscoveredStructureByPlayer?(structure: MapStructure): boolean;
  // Per-house fog-of-war — retained for older mission-specific approximations.
  isRevealedToHouse(cx: number, cy: number, houseIdx: number): boolean;
}

/** C++ TechnoClass::Fire_At ammo decrement + InfantryClass::Fire_At fraidy-cat
 *  empty-ammo panic side effect (techno.cpp:3249-3250, infantry.cpp:2198-2208).
 *  Applies only after a projectile/fire action was actually launched. */
function consumeAmmoAfterSuccessfulFire(entity: Entity): void {
  if (entity.ammo > 0) entity.ammo--;

  if (entity.stats.isInfantry && entity.stats.isFraidyCat && entity.ammo === 0) {
    entity.fear = Entity.FEAR_MAXIMUM;
    if (entity.mission === Mission.ATTACK || entity.mission === Mission.HUNT) {
      entity.mission = Mission.GUARD;
    }
  }
}

export interface GreatestThreatRangeContext {
  entities: Entity[];
  structures?: MapStructure[];
  map: GameMap;
  tick: number;
  playerHouse: House;
  entitiesAllied(a: Entity, b: Entity): boolean;
  isPlayerControlled(e: Entity): boolean;
  isDiscoveredByPlayer?(entity: Entity): boolean;
  isRevealedToHouse(cx: number, cy: number, houseIdx: number): boolean;
  getWarheadMult?(warhead: WarheadType, armor: ArmorType): number;
}

function weaponSelectionMult(
  ctx: GreatestThreatRangeContext,
  warhead: WarheadType,
  armor: ArmorType,
): number {
  return ctx.getWarheadMult?.(warhead, armor) ?? getWarheadMultiplier(warhead, armor);
}

function selectedWeaponForTarget(
  ctx: GreatestThreatRangeContext,
  entity: Entity,
  target: Entity,
): WeaponStats | null {
  return entity.selectWeapon(target, (warhead, armor) => weaponSelectionMult(ctx, warhead, armor));
}

function fireCoordForWeaponAtLatchedFacing(entity: Entity, weapon: WeaponStats, facing256: number): { lx: number; ly: number } {
  if (!entity.stats.isInfantry || facing256 < 0) return entity.fireCoordForWeapon(weapon);

  const savedBodyFacing256 = entity.bodyFacing256;
  const savedBodyFacing32 = entity.bodyFacing32;
  const savedFacing = entity.facing;
  try {
    entity.bodyFacing256 = facing256 & 0xFF;
    entity.bodyFacing32 = dir256ToFacing32(entity.bodyFacing256);
    entity.facing = dir256ToFacing8(entity.bodyFacing256);
    return entity.fireCoordForWeapon(weapon);
  } finally {
    entity.bodyFacing256 = savedBodyFacing256;
    entity.bodyFacing32 = savedBodyFacing32;
    entity.facing = savedFacing;
  }
}

/** C++ InfantryClass::Random_Animate cases 6-10:
 *  `PrimaryFacing.Set(Facing_Dir(Random_Pick(FACING_N, FACING_NW)))`.
 *  FacingType is 0..7 and Facing_Dir maps it to DirType by `facing << 5`. */
function setInfantryPrimaryFacingFromFacingType(entity: Entity, facing: number): void {
  const dir256 = (facing << 5) & 0xff;
  entity.bodyFacing256 = dir256;
  entity.bodyFacing32 = dir256ToFacing32(dir256);
  entity.facing = dir256ToFacing8(dir256);
  entity.desiredFacing = entity.facing;
}

function canScatterInfantryTo(ctx: MissionAIContext, entity: Entity, cx: number, cy: number, facing: number): boolean {
  const result: MoveResult | boolean = ctx.infantryCanEnterCell
    ? ctx.infantryCanEnterCell(entity, cx, cy, facing)
    : ctx.map.canEnterCell(cx, cy, entity.isNavalUnit, undefined, true, entity.id);
  return result === MoveResult.OK || result === true;
}

function scatterFraidyCatNoThreat(ctx: MissionAIContext, entity: Entity): void {
  if (entity.isDriving || !entity.isDoingInterruptible()) return;

  const fracX = entity.leptonX & 0xff;
  const fracY = entity.leptonY & 0xff;
  let toface = (fracX !== 0x80 || fracY !== 0x80)
    ? directionToLeptons(0x80, 0x80, fracX, fracY)
    : entity.facing;

  const saved = ScenarioRandom._sourceTag;
  ScenarioRandom._sourceTag = 53003;
  toface = (toface + ScenarioRandom.nextInRange(0, 4) - 2 + DIR_DX.length) % DIR_DX.length;
  ScenarioRandom._sourceTag = saved;

  const { cx, cy } = entity.cell;
  for (let face = 0; face < DIR_DX.length; face++) {
    const dir = (toface + face) % DIR_DX.length;
    const ncx = cx + DIR_DX[dir];
    const ncy = cy + DIR_DY[dir];
    if (ncx < 0 || ncx >= MAP_CELLS || ncy < 0 || ncy >= MAP_CELLS) continue;
    if (!canScatterInfantryTo(ctx, entity, ncx, ncy, dir)) continue;

    assignMission(entity, Mission.MOVE);
    entity.moveTarget = cellTargetToLepton(ncx, ncy);
    entity.path = [];
    entity.pathIndex = 0;
    entity.pathThreshold = 1; // C++ MOVE_CLOAK
    return;
  }
}

function randomAnimateFraidyCatImmediateScatter(ctx: MissionAIContext, entity: Entity): boolean {
  if (entity.stats.isFraidyCat && entity.house !== ctx.playerHouse && entity.fear > Entity.FEAR_ANXIOUS) {
    scatterFraidyCatNoThreat(ctx, entity);
    return true;
  }
  return false;
}

function randomAnimateCaseScatter(ctx: MissionAIContext, entity: Entity, animPick: number): void {
  if (animPick === 8 && entity.stats.isFraidyCat && entity.house !== ctx.playerHouse) {
    scatterFraidyCatNoThreat(ctx, entity);
  }
}

/** C++ InfantryClass::Random_Animate (infantry.cpp:1742-1838).
 *  Returns true when the idle animation gate was open and RNG was consumed. */
function runInfantryRandomAnimate(ctx: MissionAIContext, entity: Entity): boolean {
  if (!entity.isReadyToRandomAnimate()) return false;

  const saved = ScenarioRandom._sourceTag;
  ScenarioRandom._sourceTag = 30001;
  entity.idleAnimTimer = ScenarioRandom.nextInRange(44, 176);
  ScenarioRandom._sourceTag = saved;
  if (randomAnimateFraidyCatImmediateScatter(ctx, entity)) return true;

  ScenarioRandom._sourceTag = 30002;
  const animPick = ScenarioRandom.nextInRange(0, 10);
  ScenarioRandom._sourceTag = saved;

  if (animPick >= 1 && animPick <= 4) {
    if (entity.type === UnitType.I_SPY) {
      // C++ Do_Action: SPY gestures/salutes remap to DO_IDLE1/2 and consume
      // Random_Pick(0,1) under the caller's saved source tag.
      ScenarioRandom.nextInRange(0, 1);
      entity.doing = 'idle_anim';
    } else {
      entity.nonInterruptAnimTicks = entity.infantryGestureDurationTicks();
      entity.nonInterruptAnimSetTick = ctx.tick;
      entity.doing = 'gesture';
    }
  } else if (animPick === 5 || animPick === 7 || (animPick === 0 && entity.type === UnitType.I_DOG)) {
    entity.doing = 'idle_anim';
  }

  if (animPick >= 6) {
    ScenarioRandom._sourceTag = 30003;
    setInfantryPrimaryFacingFromFacingType(entity, ScenarioRandom.nextInRange(0, 7));
    ScenarioRandom._sourceTag = saved;
  }
  randomAnimateCaseScatter(ctx, entity, animPick);

  return true;
}

/** Per-house index mapping — mirrors Game.HOUSE_TO_INDEX for fog-of-war checks.
 *  C++ techno.cpp:1467+ Evaluate_Object checks Is_Discovered_By_House. */
const _HOUSE_IDX: Record<string, number> = {
  [House.Spain]: 0, [House.Greece]: 1, [House.USSR]: 2,
  [House.England]: 3, [House.Ukraine]: 4, [House.Germany]: 5,
  [House.France]: 6, [House.Turkey]: 7,
  [House.GoodGuy]: 8, [House.BadGuy]: 9, [House.Neutral]: 10,
};

const TECHNO_POINTS_BY_TYPE: Record<string, number> = {};
for (const item of PRODUCTION_ITEMS) {
  TECHNO_POINTS_BY_TYPE[item.type] = item.points ?? item.cost;
}

const OVERLAY_STRUCTURE_TYPES = new Set(['BARL', 'BRL3', 'SBAG', 'FENC', 'BARB', 'BRIK', 'WOOD', 'CYCL']);

function structureCenterLeptons(s: MapStructure): { lx: number; ly: number } {
  return cppStructureCenterLeptons(s);
}

function structureCenterWorld(s: MapStructure): WorldPos {
  const center = structureCenterLeptons(s);
  return {
    x: center.lx * CELL_SIZE / LEPTON_SIZE,
    y: center.ly * CELL_SIZE / LEPTON_SIZE,
  };
}

function structureTargetLeptons(s: MapStructure): { lx: number; ly: number } {
  return cppStructureTargetLeptons(s);
}

function structureTargetWorld(s: MapStructure): WorldPos {
  const target = structureTargetLeptons(s);
  return {
    x: target.lx * CELL_SIZE / LEPTON_SIZE,
    y: target.ly * CELL_SIZE / LEPTON_SIZE,
  };
}

function structureThreatScore(s: MapStructure, distLeptons: number): number {
  // C++ TechnoClass::Value() = Risk() + Reward() = 2 * Points.
  const points = STRUCTURE_POINTS[s.type] ?? TECHNO_POINTS_BY_TYPE[s.type] ??
    Math.max(1, Math.trunc((s.maxHp || 1) / 10));
  const value = Math.trunc(points * 2);
  const distCells = Math.floor(distLeptons / LEPTON_SIZE);
  return Math.max(1, Math.trunc((value * 32000) / (distCells + 1)));
}

function structureRangeBonusLeptons(s: MapStructure): number {
  const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
  return (sw + sh) * Math.trunc(LEPTON_SIZE / 4);
}

function structureGroundLayerSortKey(s: MapStructure): number {
  const center = structureCenterLeptons(s);
  return center.ly * 0x10000 + center.lx;
}

function isStructureVisibleToPlayer(ctx: MissionAIContext, s: MapStructure, center: { lx: number; ly: number }): boolean {
  if (s.house === ctx.playerHouse) return true;
  if (ctx.isDiscoveredStructureByPlayer) return ctx.isDiscoveredStructureByPlayer(s);
  const playerHouseIdx = _HOUSE_IDX[ctx.playerHouse] ?? -1;
  if (playerHouseIdx < 0) return false;
  return ctx.isRevealedToHouse(
    Math.floor(center.lx / LEPTON_SIZE),
    Math.floor(center.ly / LEPTON_SIZE),
    playerHouseIdx,
  );
}

function isStructureInCppThreatLayer(s: MapStructure): boolean {
  // C++ BuildingClass::Take_Damage leaves a zero-strength building active and
  // present in Map.Layer[LAYER_GROUND] until BuildingClass::AI sees CountDown
  // reach zero, calls Limbo(), then deletes it. Greatest_Threat still evaluates
  // that object; Assign_Target rejects it afterward because Strength == 0.
  return s.alive || (!s.debrisDropped && s.debrisCountdown !== undefined);
}

function isAutoTargetableStructure(ctx: MissionAIContext, entity: Entity, s: MapStructure): boolean {
  if (!isStructureInCppThreatLayer(s)) return false;
  if (s.house === House.Neutral) return false;
  if (ctx.isAllied(entity.house, s.house)) return false;
  // These scenario records represent overlay objects, not BuildingClass
  // Technos in C++, so Greatest_Threat never sees them as RTTI_BUILDING.
  if (OVERLAY_STRUCTURE_TYPES.has(s.type)) return false;
  return true;
}

function entityInRangeOfStructure(entity: Entity, s: MapStructure): boolean {
  const range = (entity.weapon?.range ?? 2) * LEPTON_SIZE +
    (entity.weapon ? structureRangeBonusLeptons(s) : 0);
  const target = structureTargetLeptons(s);
  const fireCoord = entity.weapon ? entity.fireCoordForWeapon(entity.weapon) : { lx: entity.leptonX, ly: entity.leptonY };
  return leptonDist(fireCoord.lx, fireCoord.ly, target.lx, target.ly) <= range;
}

function structureMatchesReachableZone(reachableZone: Uint8Array | null, s: MapStructure, center: { lx: number; ly: number }): boolean {
  if (!reachableZone) return true;
  const centerCX = Math.floor(center.lx / LEPTON_SIZE);
  const centerCY = Math.floor(center.ly / LEPTON_SIZE);
  return centerCX >= 0 && centerCX < MAP_CELLS && centerCY >= 0 && centerCY < MAP_CELLS &&
    !!reachableZone[centerCY * MAP_CELLS + centerCX];
}

function isAssignableObjectTarget(target: Entity | null | undefined): target is Entity {
  // C++ TechnoClass::Assign_Target rejects object targets that are inactive or
  // zero-strength (techno.cpp:2887-2889). Evaluate_Object can still return a
  // zero-strength object while it remains in the cell occupier chain; assigning
  // it clears TarCom.
  return !!target && !target.inLimbo && target.alive && target.hp > 0;
}

function assignTargetForTechno(entity: Entity, target: Entity | null): void {
  // C++ InfantryClass::Assign_Target starts with Path[0] = FACING_NONE before
  // delegating to FootClass::Assign_Target (infantry.cpp:1123-1134). It does
  // not clear NavCom. In TS, non-driving infantry need an empty path so the
  // InfantryClass::Movement_AI Basic_Path branch recomputes from moveTarget.
  //
  // Do not touch active drivers here: C++ keeps the current Head_To_Coord hop
  // alive even when Path[0] is cleared, and TS cannot safely invalidate the
  // cached path mid-hop without stalling the in-flight driver representation.
  if (entity.stats.isInfantry && !entity.isDriving) {
    entity.path = [];
    entity.pathIndex = 0;
  }
  entity.target = target;
}

// ── Infantry FireLaunch (pre-fire animation stage gate) ────────────────────
// C++ idata.cpp — per-InfantryTypeClass "Frame of projectile launch" constructor arg.
// InfantryClass::Firing_AI (infantry.cpp:3651) fires only when Fetch_Stage() == FireLaunch.
// DO_FIRE_WEAPON has rate=1 (infantry.cpp:103) so stage advances 1 per tick. Vehicles
// use UnitClass::Firing_AI (unit.cpp:643-687) which has no stage gate — fire same-tick.
export function infantryFireLaunch(type: string): number {
  switch (type) {
    case UnitType.I_DOG: return 1;              // Dog idata.cpp:384
    case UnitType.I_E1: return 2;               // Rifle idata.cpp:404
    case UnitType.I_E2: return 14;              // Grenadier idata.cpp:424
    case UnitType.I_E3: return 3;               // Rocket idata.cpp:444
    case UnitType.I_E4: return 2;               // Flamethrower idata.cpp:464
    case UnitType.I_E6: return 3;               // Engineer idata.cpp:484
    case UnitType.I_SPY: return 3;              // Spy idata.cpp:504
    case 'E9':                                  // Thief idata.cpp:524
    case 'THF': return 3;
    case UnitType.I_TANYA: return 2;            // Tanya/E7 idata.cpp:544
    case UnitType.I_MEDI: return 25;            // Medic idata.cpp:563
    case UnitType.I_MECH: return 25;            // Mechanic (Medic-based)
    case UnitType.I_GNRL: return 2;             // General/Stavros idata.cpp:582
    case UnitType.I_EINSTEIN: return 0;         // Einstein idata.cpp:793 — fires same-tick
    // Civilians, Delphi: FireLaunch=2 (CivilianDoControls, idata.cpp:601-854)
    default: return 2;
  }
}

// C++ idata.cpp — per-InfantryTypeClass "Frame of projectile launch while prone"
// constructor arg. InfantryClass::Firing_AI switches from FireLaunch to
// ProneLaunch when IsProne is set (infantry.cpp:3656-3658).
export function infantryProneLaunch(type: string): number {
  switch (type) {
    case UnitType.I_DOG: return 1;              // Dog idata.cpp:385
    case UnitType.I_E1: return 2;               // Rifle idata.cpp:405
    case UnitType.I_E2: return 6;               // Grenadier idata.cpp:425
    case UnitType.I_E3: return 3;               // Rocket idata.cpp:445
    case UnitType.I_E4: return 0;               // Flamethrower idata.cpp:465
    case UnitType.I_E6: return 3;               // Engineer idata.cpp:485
    case UnitType.I_SPY: return 3;              // Spy idata.cpp:505
    case 'E9':                                  // Thief idata.cpp:525
    case 'THF': return 3;
    case UnitType.I_TANYA: return 2;            // Tanya/E7 idata.cpp:545
    case UnitType.I_MEDI: return 25;            // Medic idata.cpp:564
    case UnitType.I_MECH: return 25;            // Mechanic (Medic-based)
    case UnitType.I_GNRL: return 2;             // General/Stavros idata.cpp:583
    case UnitType.I_EINSTEIN: return 0;         // Einstein idata.cpp:794
    // Civilians, Delphi: ProneLaunch=0 (CivilianDoControls, idata.cpp:603-854)
    default: return 0;
  }
}

// ── Exported mission functions ──────────────────────────────────────────────

/**
 * Phase 1 Checkpoint 1.B — Firing_AI extraction for DISPATCH_ORDER_REFACTOR.
 *
 * Mirrors C++ TechnoClass::Firing_AI (infantry.cpp:3651 / unit.cpp:2429). Runs
 * every tick for all missions where the entity has a legal TarCom, a ready
 * weapon, and the target is in range. This is currently inlined in the
 * Mission.MOVE / Mission.HUNT / Mission.GUARD (via updateGuard) / Mission.ATTACK
 * handlers; Phase 1 STAGE C lifts it to a single per-tick call so the order of
 * operations matches C++:
 *
 *   InfantryClass::AI (infantry.cpp:1237-1247):
 *     - MissionClass::AI()    ← dispatch
 *     - Firing_AI()           ← THIS function (stage fire-prep + Fire_At)
 *     - Movement_AI()         ← track / cell advance
 *     - Commence()            ← pop MissionQueue
 *
 * NOTE: Not currently called from `updateEntity`. Exists as a stub for
 * `DISPATCH_ORDER_REFACTOR` (ships OFF). See index.ts `updateEntity` STAGE C.
 *
 * The per-tick `firePrepStage++` bump still happens at the top of updateEntity
 * (C++ StageClass::Graphic_Logic runs before Firing_AI reads Fetch_Stage).
 * This function only handles the stage=FireLaunch gate + Fire_At dispatch, by
 * delegating to `updateAttack` when the gate conditions pass.
 *
 * ## C++ refs
 *   infantry.cpp:3651    InfantryClass::Firing_AI top
 *   infantry.cpp:1237    InfantryClass::AI Firing_AI dispatch
 *   infantry.cpp:1639    FIRE_MOVING gate (blocks fire while IsDriving)
 *   unit.cpp:2429        UnitClass Firing_AI call
 *   techno.cpp:2392      StageClass::Graphic_Logic (per-tick stage advance)
 */
export function runFiringAI(ctx: MissionAIContext, entity: Entity): void {
  if (!entity.weapon) return;
  if (entity.suppressFiringAITick === ctx.tick) return;

  if (entity.targetStructure?.alive) {
    if (entity.attackCooldown > 0) return;
    if (!entityInRangeOfStructure(entity, entity.targetStructure as MapStructure)) return;
    updateAttack(ctx, entity);
    return;
  }

  if (!entity.target?.alive) return;
  // C++ InfantryClass::Firing_AI calls Can_Fire even while Arm/rearm is nonzero.
  // InfantryClass::Can_Fire checks negative-damage weapons before delegating to
  // TechnoClass::Can_Fire's Arm gate, so medics clear fully healed/non-infantry
  // TarCom targets every tick instead of pinning Mission_Guard and suppressing
  // Random_Animate until the heal cooldown expires.
  if (clearIllegalNegativeDamageTarget(entity)) return;
  if (entity.attackCooldown > 0) return;
  if (!entity.inRange(entity.target)) return;
  // C++ infantry.cpp:1639 FIRE_MOVING — blocks fire while driving. Callers that
  // want the C++ pre-Movement_AI semantics (IsDriving reflects prior tick) must
  // clear isDriving before calling this function; the legacy Mission.MOVE inline
  // block does exactly that (temporarily clears + restores isDriving if firePrep
  // didn't latch).
  updateAttack(ctx, entity);
}

function clearIllegalNegativeDamageTarget(entity: Entity): boolean {
  if (!entity.stats.isInfantry || !entity.target?.alive || !entity.weapon) return false;
  if (entity.weapon.damage >= 0) return false;

  // RA non-FIXIT InfantryClass::Can_Fire treats negative damage as valid only
  // for injured infantry. Firing_AI handles FIRE_ILLEGAL by Assign_Target(NONE)
  // once the infantry target reaches ConditionGreen, and also clears non-infantry
  // targets. This check intentionally ignores rearm state, matching the C++
  // ordering before TechnoClass::Can_Fire's Arm gate.
  if (!entity.target.stats.isInfantry || entity.target.hp >= entity.target.maxHp) {
    entity.target = null;
    entity.firePrepActive = false;
    entity.firePrepStage = 0;
    entity.firePrepUsesDoingStage = false;
    entity.firePrepFacing256 = -1;
    return true;
  }

  return false;
}

/** Attack mission — main combat state machine for ground/naval units.
 *  Handles target acquisition, weapon selection, firing, projectiles, effects. */
export function updateAttack(ctx: MissionAIContext, entity: Entity): void {
  // Demo Truck kamikaze — intercepts normal attack to drive-and-explode
  if (entity.type === UnitType.V_DTRK) {
    ctx.updateDemoTruck(entity);
    return;
  }

  // Handle structure targets
  if (entity.targetStructure) {
    if (!entity.targetStructure.alive) {
      entity.targetStructure = null;
      entity.mission = ctx.idleMission(entity);
      entity.animState = AnimState.IDLE;
      return;
    }
    updateAttackStructure(ctx, entity, entity.targetStructure as MapStructure);
    return;
  }

  // Handle force-fire on ground (no entity target)
  if (entity.forceFirePos && !entity.target) {
    updateForceFireGround(ctx, entity);
    return;
  }

  if (!entity.target?.alive) {
    entity.target = null;
    entity.forceFirePos = null;
    // C++ infantry.cpp:3671-3677 — if !Target_Legal, clear IsFiring. Drop the
    // pre-fire animation state so the next target acquisition restarts the gate.
    entity.firePrepActive = false;
    entity.firePrepStage = 0;
    entity.firePrepUsesDoingStage = false;
    entity.firePrepFacing256 = -1;
    // Resume saved move destination (AI units interrupted MOVE to attack)
    if (entity.savedMoveTarget) {
      const saved = entity.savedMoveTarget;
      entity.savedMoveTarget = null;
      entity.mission = Mission.MOVE;
      entity.moveTarget = { lx: saved.lx, ly: saved.ly };
      entity.path = findPath(ctx.map, entity.cell, { cx: Math.floor(saved.lx / 256), cy: Math.floor(saved.ly / 256) }, true, entity.isNavalUnit, entity.stats.speedClass);
      entity.pathIndex = 0;
      return;
    }
    // Return to guard origin if player unit was auto-engaging (not given explicit attack order)
    if (entity.isPlayerUnit && entity.guardOrigin) {
      const d = leptonDist(entity.leptonX, entity.leptonY, pixelToLepton(entity.guardOrigin.x), pixelToLepton(entity.guardOrigin.y));
      if (d > 384) { // 1.5 cells * 256 leptons/cell
        entity.mission = Mission.MOVE;
        entity.moveTarget = { lx: pixelToLepton(entity.guardOrigin.x), ly: pixelToLepton(entity.guardOrigin.y) };
        entity.path = findPath(ctx.map, entity.cell, worldToCell(entity.guardOrigin.x, entity.guardOrigin.y), true, entity.isNavalUnit, entity.stats.speedClass);
        entity.pathIndex = 0;
        return;
      }
    }
    entity.mission = ctx.idleMission(entity);
    entity.animState = AnimState.IDLE;
    return;
  }

  // Naval target filtering
  if (entity.target) {
    // Submerged subs (cloaked) can only be targeted by weapons with isAntiSub
    if (entity.target.cloakState === CloakState.CLOAKED || entity.target.cloakState === CloakState.CLOAKING) {
      const canHitSub = (entity.weapon?.isAntiSub || entity.weapon2?.isAntiSub);
      if (!canHitSub) {
        entity.target = null;
        entity.mission = ctx.idleMission(entity);
        entity.animState = AnimState.IDLE;
        return;
      }
    }
    // Cruisers cannot target infantry (C++ vessel.cpp:1248 — exclude THREAT_INFANTRY)
    if (entity.type === UnitType.V_CA && entity.target.stats.isInfantry) {
      entity.target = null;
      entity.mission = ctx.idleMission(entity);
      entity.animState = AnimState.IDLE;
      return;
    }
    // Torpedoes (isSubSurface) can only hit naval units
    if (entity.weapon?.isSubSurface && !entity.target.isNavalUnit) {
      // Try secondary weapon if available
      if (entity.weapon2 && !entity.weapon2.isSubSurface) {
        // Can use secondary weapon — let selectWeapon handle it
      } else {
        entity.target = null;
        entity.mission = ctx.idleMission(entity);
        entity.animState = AnimState.IDLE;
        return;
      }
    }
  }

  // AA gate: ground units can't attack airborne aircraft without AA weapons
  if (entity.target && entity.target.isAirUnit && entity.target.flightAltitude > 0) {
    const hasAA = entity.weapon?.isAntiAir || entity.weapon2?.isAntiAir;
    if (!hasAA) {
      entity.target = null;
      entity.mission = ctx.idleMission(entity);
      entity.animState = AnimState.IDLE;
      return;
    }
  }

  // C++ techno.cpp:2747 — cannot fire unless fully UNCLOAKED. Start uncloaking and wait.
  if (entity.stats.isCloakable && entity.cloakState !== CloakState.UNCLOAKED && entity.target) {
    if (entity.cloakState === CloakState.CLOAKED || entity.cloakState === CloakState.CLOAKING) {
      entity.cloakState = CloakState.UNCLOAKING;
      entity.cloakTimer = CLOAK_TRANSITION_FRAMES;
    }
    return; // wait until fully uncloaked before firing
  }

  // Minimum range check: artillery can't fire at point-blank
  if (entity.weapon?.minRange && entity.target) {
    const dist = leptonDist(entity.leptonX, entity.leptonY, entity.target.leptonX, entity.target.leptonY);
    if (dist < entity.weapon.minRange * LEPTON_SIZE) {
      ctx.retreatFromTarget(entity, entity.target.pos);
      return;
    }
  }

  if (entity.inRange(entity.target)) {
    // C++ TechnoClass::Can_Fire + Unit/VesselClass::Can_Fire do not perform
    // a terrain LOS gate for object targets. Fire legality is rearm, range,
    // ammo, cloak, moving/NavCom, and facing. Target selection visibility is
    // handled earlier by Evaluate_Object/Target_Something_Nearby.

    // C++ UnitClass::Can_Fire / VesselClass::Can_Fire moving gates:
    //   unit.cpp:4150-4153   IsNoFireWhileMoving && Target_Legal(NavCom)
    //   vessel.cpp:1109-1112 !IsTurretEquipped && Target_Legal(NavCom)
    //
    // This is NavCom-based, not just IsDriving-based: a vessel/unit that still
    // has an assigned destination cannot fire from this class path even if it
    // is momentarily between track updates. SCG07EA's HUNTing sub at logic 73
    // has TarCom in range at tick 71/72 but NavCom is still legal, so C++
    // returns FIRE_MOVING and consumes no Fire_At RNG until the destination is
    // cleared.
    if (!entity.stats.isInfantry && entity.moveTarget) {
      if ((entity.isNavalUnit && !entity.hasTurret) || entity.stats.noMovingFire) {
        return;
      }
    }

    // Turreted vehicles: turret tracks target, body may stay still
    // C++ UnitClass::AI order (unit.cpp:425,437): Firing_AI runs BEFORE Rotation_AI.
    // That means Can_Fire sees the turret facing from the END of the previous tick's
    // Rotation_AI — NOT the rotation triggered by this tick's newly acquired target.
    // TS used to call tickTurretRotation() here (before the fire gate), which let
    // the turret rotate AND fire in the same tick — 1 tick earlier than WASM.
    // We now capture the pre-rotation 256-step SecondaryFacing for the FIRE_FACING
    // gate below, then tick the rotation after the gate decision is made.
    let fireGateTurretFacing256 = 0;
    let fireGateTurretWasRotating = false;
    let fireGateBodyFacing256 = entity.bodyFacing256 >= 0
      ? entity.bodyFacing256 & 0xFF
      : (entity.facing * 32) & 0xFF;
    let fireGateBodyWasRotating = false;
    if (entity.hasTurret) {
      const preRotTurretFacing256 = entity.turretFacing256 >= 0
        && dir256ToFacing32(entity.turretFacing256) === entity.turretFacing32
        && dir256ToFacing8(entity.turretFacing256) === entity.turretFacing
        ? entity.turretFacing256 & 0xFF
        : (entity.turretFacing32 * 8) & 0xFF;
      const preRotDesiredTurretFacing256 = entity.desiredTurretFacing256 >= 0
        ? entity.desiredTurretFacing256 & 0xFF
        : (entity.desiredTurretFacing * 32) & 0xFF;
      // C++ UnitClass::AI runs Firing_AI before Rotation_AI (unit.cpp:425,
      // :437). Can_Fire's FIRE_ROTATING gate therefore checks the IsRotating
      // state left by the previous tick's Rotation_AI, not whether rotation
      // happens to finish later in this tick. Preserve that pre-rotation flag.
      const preRotTurretWasRotating = preRotTurretFacing256 !== preRotDesiredTurretFacing256;
      entity.desiredTurretFacing256 = directionToLeptons256(
        entity.leptonX, entity.leptonY,
        entity.target.leptonX, entity.target.leptonY,
      );
      entity.desiredTurretFacing = dir256ToFacing8(entity.desiredTurretFacing256);
      const turretReadyAfterRotation = entity.tickTurretRotation();

      if (entity.isNavalUnit) {
        // C++ VesselClass::AI order is Rotation_AI then Combat_AI
        // (vessel.cpp:623-631), so VesselClass::Can_Fire sees the post-rotation
        // SecondaryFacing and post-rotation IsRotating flag. This lets a PT fire
        // on the same tick its turret reaches the target direction.
        fireGateTurretFacing256 = entity.turretFacing256 & 0xFF;
        fireGateTurretWasRotating = !turretReadyAfterRotation;
      } else {
        // C++ UnitClass::AI order is Firing_AI then Rotation_AI
        // (unit.cpp:425,437), so land units gate on the pre-rotation state.
        fireGateTurretFacing256 = preRotTurretFacing256;
        fireGateTurretWasRotating = preRotTurretWasRotating;
      }
    } else {
      let facingReady: boolean;
      if (entity.isNavalUnit) {
        // C++ VesselClass::Combat_AI does NOT rotate non-turret vessels here.
        // Can_Fire reads PrimaryFacing after DriveClass::AI has already had its
        // chance to rotate this tick; on FIRE_FACING the switch below only sets
        // PrimaryFacing.Desired(Direction(TarCom)). The actual Rotation_Adjust
        // happens in the next DriveClass::AI pass.
        if (entity.bodyFacing256 < 0) {
          entity.bodyFacing256 = (entity.facing * 32) & 0xff;
        }
        fireGateBodyFacing256 = entity.bodyFacing256 & 0xff;
        const previousDesired256 = entity.desiredFacing256 >= 0
          ? entity.desiredFacing256 & 0xff
          : fireGateBodyFacing256;
        fireGateBodyWasRotating = fireGateBodyFacing256 !== previousDesired256;
        facingReady = true;
      } else if (entity.stats.isInfantry) {
        if (entity.firePrepActive) {
          // C++ InfantryClass::Firing_AI sets PrimaryFacing when IsFiring starts
          // (infantry.cpp:3621-3623). Retargeting while the fire animation is
          // running must not rotate the muzzle or re-run Can_Fire facing gates.
          const latchedFacing = entity.firePrepFacing256 >= 0
            ? entity.firePrepFacing256 & 0xFF
            : (entity.bodyFacing256 >= 0 ? entity.bodyFacing256 & 0xFF : (entity.facing * 32) & 0xFF);
          fireGateBodyFacing256 = latchedFacing;
          fireGateBodyWasRotating = false;
          facingReady = true;
        } else {
          // C++ InfantryClass::Firing_AI calls Can_Fire before it snaps
          // PrimaryFacing toward TarCom. Can_Fire's In_Range check therefore
          // uses the muzzle coordinate for the old PrimaryFacing. Snapping here
          // first can incorrectly turn a one-lepton in-range shot into
          // FIRE_RANGE; snap only after FIRE_OK below.
          facingReady = true;
        }
      } else {
        // C++ UnitClass::AI order for fixed-body land units:
        //   DriveClass::AI() rotates PrimaryFacing first (drive.cpp:1369),
        //   Firing_AI()/Can_Fire() reads that pre-fire facing (unit.cpp:424),
        //   Rotation_AI() only sets the next PrimaryFacing.Desired() (unit.cpp:521).
        //
        // Do not call tickRotation() from this Firing_AI path. Doing so rotates
        // and fires in one TS pass; C++ waits until the next DriveClass::AI pass.
        const desired256 = directionToLeptons256(
          entity.leptonX, entity.leptonY,
          entity.target.leptonX, entity.target.leptonY,
        );
        fireGateBodyFacing256 = entity.bodyFacing256 >= 0
          ? entity.bodyFacing256 & 0xFF
          : (entity.facing * 32) & 0xFF;
        const previousDesired256 = entity.desiredFacing256 >= 0
          ? entity.desiredFacing256 & 0xFF
          : (entity.desiredFacing * 32) & 0xFF;
        fireGateBodyWasRotating = fireGateBodyFacing256 !== previousDesired256;
        entity.desiredFacing256 = desired256;
        entity.desiredFacing = dir256ToFacing8(desired256);
        facingReady = fireGateBodyFacing256 === desired256;
      }
      if (!entity.stats.isInfantry && !entity.isNavalUnit && !entity.hasTurret) {
        // Fixed-body land units use UnitClass::Can_Fire's PrimaryFacing
        // FIRE_FACING gate (unit.cpp:4167-4180). This is independent of
        // IsNoFireWhileMoving; e.g. ARTY must face within 8 dir steps before
        // Fire_At may consume RNG.
        // The active weapon is selected below, so the projectile ROT tolerance
        // is applied in the post-selection gate.
      } else {
        if (!entity.isNavalUnit) {
          if (!(entity.stats.isInfantry && entity.firePrepActive)) {
            fireGateBodyFacing256 = entity.bodyFacing256 >= 0
              ? entity.bodyFacing256 & 0xFF
              : (entity.facing * 32) & 0xFF;
          }
          fireGateBodyWasRotating = !facingReady;
        }
        // NoMovingFire units must face target before attacking.
        // Exception: melee weapons (range <= 2) bypass facing check to prevent
        // rotation lock where ants never catch up to moving targets.
        const isMelee = entity.weapon && entity.weapon.range <= 2;
        if (entity.stats.noMovingFire && !facingReady && !isMelee) {
          entity.animState = AnimState.IDLE;
          return;
        }
      }
    }
    entity.animState = AnimState.ATTACK;

    // S5: NoMovingFire setup time (C++ unit.cpp:1760-1764 — Arm = Rearm_Delay(true)/4 when stopping)
    // C++ Rearm_Delay(true) = weapon->ROF * House->ROFBias (techno.cpp:2867)
    // So setup = (ROF * ROFBias) / 4
    if (entity.stats.noMovingFire && entity.wasMoving && entity.weapon) {
      const rofBias = ctx.getROFBias(entity.house);
      const setupTime = Math.floor(entity.weapon.rof * rofBias / 4);
      if (entity.attackCooldown < setupTime) {
        entity.attackCooldown = setupTime;
      }
      entity.wasMoving = false; // consume the transition — only apply once
    }

    // C1: Burst fire continuation (C++ weapon.cpp:78 Weapon.Burst)
    // Between burst shots, count down burstDelay instead of using full ROF cooldown
    if (entity.burstCount > 0 && entity.burstDelay > 0) {
      entity.burstDelay--;
      if (entity.burstDelay > 0) return; // waiting between burst shots
      // burstDelay reached 0 — fire next burst shot (fall through to fire logic)
    }

    // Dual-weapon selection (C++ TechnoClass::What_Weapon_Should_I_Use):
    // Select the best weapon by warhead score and range bonus. Rearm/range do
    // not change selection; Can_Fire gates actual shooting below.
    const selectedWeapon = entity.selectWeapon(
      entity.target, (wh, ar) => ctx.getWarheadMult(wh, ar),
    );

    // If a burst is in progress, continue with the primary weapon (burst belongs to primary)
    const activeWeapon = entity.burstCount > 0 ? entity.weapon : selectedWeapon;
    const isSecondary = activeWeapon === entity.weapon2;

    if (!activeWeapon) return;

    // C++ TechnoClass::Can_Fire gates that do not affect What_Weapon_Should_I_Use:
    // FIRE_REARM and FIRE_RANGE stop this tick's shot but leave the selected
    // weapon intact for approach/path-shortening decisions.
    if (!entity.canWeaponTarget(entity.target, activeWeapon)) return;
    if (entity.attackCooldown > 0) return;
    if (!entity.inRangeWith(entity.target, activeWeapon)) return;

    // C++ TechnoClass::Can_Fire (techno.cpp:2754): Ammo == 0 returns
    // FIRE_AMMO before InfantryClass::Firing_AI can start a firing action.
    // Unlimited ammo is represented as -1 in both C++ and TS.
    if (entity.ammo === 0) {
      return;
    }

    // C++ InfantryClass::Can_Fire (infantry.cpp:1636-1641) — FIRE_MOVING gate.
    // Infantry cannot fire while IsDriving is set (actively moving between
    // sub-cells via Start_Driver). This is an infantry-only restriction —
    // UnitClass::Can_Fire has no IsDriving check, so vehicles fire on the
    // move. Without this gate, TS infantry fire during HUNT/GUARD movement
    // frames that C++ would reject with FIRE_MOVING.
    // SCG01EA tick 80: USSR E1 in HUNT with isDriving=true fires one shot
    // WASM never produces — the shot's invisible-bullet Coord_Scatter RNG
    // appears 5 ticks early vs WASM's later Mission_Guard-initiated fire.
    // C++ ref: infantry.cpp:1639 `if (IsDriving || ...) return(FIRE_MOVING);`
    if (entity.stats.isInfantry && entity.isDriving) {
      return;
    }

    // C++ UnitClass::Can_Fire (unit.cpp:4159-4181) — FIRE_ROTATING / FIRE_FACING gate.
    // C++ UnitClass::AI order: Firing_AI (unit.cpp:425) runs BEFORE Rotation_AI
    // (unit.cpp:437). That means Can_Fire checks the turret facing from END of
    // LAST tick's Rotation_AI — THIS tick's rotation has not happened yet.
    //
    // The gate is two-part:
    //   (A) FIRE_ROTATING (unit.cpp:4159): if the turret is still rotating toward
    //       the OLD desired facing AND the weapon is non-homing (Bullet->ROT==0),
    //       block fire.
    //   (B) FIRE_FACING  (unit.cpp:4163-4181): compute 256-step diff between target
    //       direction and CURRENT turret (pre-rotation this tick). If diff >= 8
    //       (with diff >>= 2 for homing), block fire.
    //
    // SCG01EA tick 87: Greek JEEP (63,50) acquires DOG target S via Mission_Guard.
    // In WASM, Firing_AI sees turret still facing body-dir (N or NE) — diff >> 8 →
    // FIRE_FACING. Rotation_AI then rotates the turret one step. Fire happens a
    // tick later.
    //
    // TS used to call tickTurretRotation() BEFORE this gate, allowing turret to
    // rotate AND fire in the same tick. Now the pre-rotation 256-step
    // SecondaryFacing (preRotTurretFacing256) is captured above and used here.
    if (entity.hasTurret && activeWeapon) {
      const projROT = (activeWeapon.projectileROT ?? 0) as number;
      // (A) FIRE_ROTATING: if the turret was still rotating at Firing_AI entry,
      // non-homing weapons must wait even if Rotation_AI would finish this tick.
      if (fireGateTurretWasRotating && projROT === 0) {
        return;
      }
      // (B) 256-step FIRE_FACING gate. Land units use pre-rotation facing;
      // vessels use post-rotation facing, matching their different C++ AI order.
      const dir256 = directionToLeptons256(
        entity.leptonX, entity.leptonY,
        entity.target.leptonX, entity.target.leptonY,
      );
      const turret256 = fireGateTurretFacing256 & 0xFF;
      // C++ facing.h:70 Difference: (int)(signed char)(desired - current).
      let diff = (dir256 - turret256) & 0xFF;
      if (diff > 127) diff -= 256;
      diff = Math.abs(diff);
      // Homing projectiles get 4× tolerance (diff >>= 2 → diff < 32 effective).
      if (projROT !== 0) diff >>= 2;
      if (diff >= 8) {
        return; // FIRE_FACING
      }
    } else if (entity.isNavalUnit && activeWeapon) {
      // C++ VesselClass::Can_Fire (vessel.cpp:1124-1136) also gates
      // non-turret vessels on PrimaryFacing. VesselClass::AI runs
      // DriveClass::AI before Combat_AI, so use the post-DriveClass body facing
      // captured above. On FIRE_FACING, VesselClass::Combat_AI sets
      // PrimaryFacing.Desired(Direction(TarCom)) but does not rotate or fire
      // until a later pass.
      const projROT = (activeWeapon.projectileROT ?? 0) as number;
      const dir256 = directionToLeptons256(
        entity.leptonX, entity.leptonY,
        entity.target.leptonX, entity.target.leptonY,
      );
      let diff = (dir256 - fireGateBodyFacing256) & 0xFF;
      if (diff > 127) diff -= 256;
      diff = Math.abs(diff);
      if (projROT !== 0) diff >>= 2;
      if (diff > 8) {
        if (!fireGateBodyWasRotating) {
          entity.desiredFacing256 = dir256;
          entity.desiredFacing = dir256ToFacing8(dir256);
        }
        return; // FIRE_FACING (vessel.cpp uses strict > 8)
      }
    } else if (!entity.stats.isInfantry && activeWeapon) {
      // C++ UnitClass::Can_Fire fixed-body path (unit.cpp:4167-4180):
      // compare target direction against PrimaryFacing as it existed when
      // Firing_AI began. UnitClass::Rotation_AI updates desired facing later,
      // but does not rotate PrimaryFacing until the next DriveClass::AI pass.
      const projROT = (activeWeapon.projectileROT ?? 0) as number;
      const dir256 = directionToLeptons256(
        entity.leptonX, entity.leptonY,
        entity.target.leptonX, entity.target.leptonY,
      );
      let diff = (dir256 - fireGateBodyFacing256) & 0xFF;
      if (diff > 127) diff -= 256;
      diff = Math.abs(diff);
      if (projROT !== 0) diff >>= 2;
      if (diff >= 8) {
        return; // FIRE_FACING (unit.cpp requires diff < 8)
      }
    }

    if (activeWeapon && entity.attackCooldown <= 0) {
      let fireAtFacing256 = -1;
      // C++ InfantryClass::Firing_AI (infantry.cpp:3580-3670) pre-fire animation gate:
      //   Tick N:  !IsFiring && FIRE_OK → Do_Action(DO_FIRE_WEAPON), Set_Stage(0), IsFiring=true.
      //            Check Fetch_Stage()==FireLaunch: stage=0 → skip Fire_At (unless FireLaunch=0).
      //   Tick N+1..N+(FireLaunch-1): StageClass::Graphic_Logic advances stage. Skip.
      //   Tick N+FireLaunch: stage==FireLaunch → Fire_At.
      // UnitClass::Firing_AI (unit.cpp:643-687) fires same-tick — no stage gate.
      // This delay pushes the invisible-bullet Coord_Scatter RNG from fire tick to
      // fire tick + FireLaunch, matching WASM's Bullet_Explodes timing.
      // SCG06EA tick 63: Greek E1 @(19,65) started firing animation; WASM Fire_At ran
      // at tick 65 (FireLaunch=2), producing the Coord_Scatter RNG at that tick.
      if (entity.stats.isInfantry) {
        const fireLaunch = entity.isProne
          ? infantryProneLaunch(entity.type)
          : infantryFireLaunch(entity.type);
        if (!entity.firePrepActive) {
          // C++ !IsFiring case: start firing animation. No bullet launch this tick
          // (unless FireLaunch==0 — Einstein and unarmed types).
          entity.firePrepActive = true;
          entity.firePrepStage = 0;
          // C++ InfantryClass::Firing_AI starts DO_FIRE_WEAPON / DO_FIRE_PRONE
          // through Do_Action, then gates Fire_At on StageClass::Fetch_Stage().
          // If Do_Action is blocked by an active non-interruptible sequence
          // (e.g. DO_LIE_DOWN/DO_GET_UP), C++ still sets IsFiring and reads the
          // existing StageClass stage. TS follows that path by using doingStage
          // whenever either the fire Do_Action succeeds or another Doing
          // animation is already running.
          const startedFireDoing = entity.startFireDoing(ctx.tick);
          entity.firePrepUsesDoingStage = startedFireDoing || entity.doingRate > 0;
          if (entity.target?.alive) {
            const targetCoord = entity.target.targetCoordLeptons();
            const fireFacing = directionToLeptons(
              entity.leptonX, entity.leptonY,
              targetCoord.lx, targetCoord.ly,
            );
            entity.facing = fireFacing;
            entity.desiredFacing = fireFacing;
            entity.bodyFacing256 = (fireFacing * 32) & 0xFF;
            entity.desiredFacing256 = entity.bodyFacing256;
            entity.bodyFacing32 = dir256ToFacing32(entity.bodyFacing256);
          }
          entity.firePrepFacing256 = entity.bodyFacing256 >= 0
            ? entity.bodyFacing256 & 0xFF
            : (entity.facing * 32) & 0xFF;

          // C++ infantry.cpp:3629-3636 — when a soldier starts firing and
          // TarCom == NavCom, clear NavCom and Path[0] so it stops pursuing the
          // same target it is now shooting. TS represents object NavCom as the
          // target's current lepton coordinate, so exact coordinate equality is
          // the narrow equivalent of TARGET equality here.
          if (entity.target?.alive && entity.moveTarget &&
              entity.moveTarget.lx === entity.target.leptonX &&
              entity.moveTarget.ly === entity.target.leptonY) {
            entity.moveTarget = null;
            entity.path = [];
            entity.pathIndex = 0;
            entity.navComClearedTick = ctx.tick;
          }
        }
        const prepStage = entity.firePrepUsesDoingStage ? entity.doingStage : entity.firePrepStage;
        if (prepStage < fireLaunch) {
          // Stage not yet at FireLaunch — keep the fire animation running, but do
          // NOT launch the bullet / consume Coord_Scatter RNG / set Arm yet.
          entity.animState = AnimState.ATTACK;
          return;
        }
        // Stage reached FireLaunch — reset prep state and fall through to Fire_At.
        fireAtFacing256 = entity.firePrepFacing256;
        entity.firePrepActive = false;
        entity.firePrepStage = 0;
        entity.firePrepUsesDoingStage = false;
      }

      // C1: Set burst count for multi-shot weapons (e.g. MammothTusk burst: 2)
      const burst = activeWeapon.burst ?? 1;
      if (entity.burstCount > 0) {
        // Continuing burst — decrement
        entity.burstCount--;
        entity.burstDelay = 3; // 3 ticks between burst shots (C++ standard)
      } else {
        // C++ techno.cpp:2918-2930 / 3180-3183:
        // TechnoClass has one shared Arm timer. IsSecondShot only applies to
        // TechnoTypeClass::Is_Two_Shooter() (Primary==Secondary or primary Burst>1),
        // not to ordinary primary/secondary pairs such as PT 2Inch+DepthCharge.
        const rofBias = ctx.getROFBias(entity.house);
        let rearmTime = Math.max(1, Math.round(activeWeapon.rof * rofBias));
        if (entity.isTwoShooter()) {
          if (!entity.isSecondShot) {
            rearmTime = 3; // first shot: quick 3-tick rearm
          }
          entity.isSecondShot = !entity.isSecondShot;
        } else {
          entity.isSecondShot = true;
        }
        entity.attackCooldown = rearmTime;
        // Legacy mirror for diagnostics/UI/tests. C++ has no Arm2.
        if (entity.weapon2) entity.attackCooldown2 = rearmTime;
        entity.burstCount = burst - 1; // remaining shots after this one
        if (entity.burstCount > 0) entity.burstDelay = 3;
      }
      // M6: C++ techno.cpp:3114-3117 — recoil only for turreted units
      if (entity.hasTurret) entity.isInRecoilState = true;

      // Gap #4: Reset spy disguise when attacking
      if (entity.disguisedAs) entity.disguisedAs = null;

      // C++ bullet.cpp:709 scatter condition:
      //   (IsInaccurate || Class->IsInaccurate ||
      //    ((Is_Target_Cell(TarCom) || Is_Target_Infantry(TarCom)) &&
      //     (Warhead == WARHEAD_AP || Class->IsFueled)))
      //
      // C++ BUG (bbdata.cpp:286): reads "Inaccuate" from INI — ALWAYS misses the
      // "Inaccurate=" rules.ini field. So Class->IsInaccurate is effectively
      // always false. Only the moving-platform IsInaccurate (techno.cpp:3107) and
      // the AP/Fueled vs infantry/cell branch ever trigger scatter.
      const targetCoord = entityTargetLeptons(entity.target);
      const targetPixels = entityTargetPixels(entity.target);
      let impactX = targetPixels.x;
      let impactY = targetPixels.y;
      let directHit = true;
      // C++ techno.cpp:3124 + bullet.cpp:700-730 — inaccurate bullet
      // scatter is computed from Fire_Coord(which), the same coordinate used
      // to Unlimbo the bullet. Center_Coord lags/shortens flame projectile
      // flights by several ticks in close-range infantry fire.
      const fireCoord = fireCoordForWeaponAtLatchedFacing(entity, activeWeapon, fireAtFacing256);
      if (fireAtFacing256 >= 0) entity.firePrepFacing256 = -1;
      // C++ techno.cpp:3106-3108 — bullet.IsInaccurate=true when firer Is_Foot() && IsDriving.
      // C++ IsDriving is set by Start_Driver for all FootClass units; TS only sets it for
      // infantry (entity.ts:1155) while vehicles use track-based movement that doesn't
      // flip the flag. To catch both cases, combine: isDriving OR visible movement.
      const isMovingPlatform = !!entity.isDriving ||
        entity.prevPos.x !== entity.pos.x || entity.prevPos.y !== entity.pos.y;
      const isAPvsSoft = (activeWeapon.warhead === 'AP' || activeWeapon.isFueled) && entity.target.stats.isInfantry;
      const doScatter = isMovingPlatform || isAPvsSoft;
      if (doScatter) {
        // SC3: Exact C++ scatter formula (bullet.cpp:710-730)
        // distance in leptons (1 cell = 256 leptons)
        const distLeptons = leptonDist(fireCoord.lx, fireCoord.ly, targetCoord.lx, targetCoord.ly);
        // C++ formula: scatterMax = max(0, (distance / 16) - 64)
        let scatterMax = Math.max(0, (distLeptons / 16) - 64);
        // Cap at HomingScatter(512) for homing, BallisticScatter(256) for ballistic
        const isHoming = (activeWeapon.projectileROT ?? 0) > 0;
        const scatterCap = isHoming ? 512 : 256;
        scatterMax = Math.min(scatterMax, scatterCap);
        const scatterLeptonsInt = Math.max(0, Math.floor(scatterMax));
        if (activeWeapon.isArcing) {
          // C++ bullet.cpp:709-723 arcing inaccurate scatter, in exact RNG order:
          //   [1] dir = (dir + (Random_Pick(0,10)-5)) & 0xFF  — firing dir jitter (cosmetic for arc)
          //   [2] tcoord = Coord_Scatter(tcoord, Random_Pick(0, scatterdist))
          //         Inside Coord_Scatter: Coord_Move(coord, Random_Pick(DIR_N=0, DIR_MAX=255), distance)
          //   Order: dir jitter → distance → scatter direction.
          ScenarioRandom.nextInRange(0, 10); // RNG #1: dir jitter (value discarded for arcing)
          const scatterDistLeptons = ScenarioRandom.nextInRange(0, scatterLeptonsInt); // RNG #2
          const scatterDir256 = ScenarioRandom.nextInRange(0, 255); // RNG #3 via Coord_Scatter→Coord_Move
          const angle = scatterDir256 * 2 * Math.PI / 256;
          const distPx = scatterDistLeptons * CELL_SIZE / LEPTON_SIZE;
          impactX += Math.cos(angle) * distPx;
          impactY += Math.sin(angle) * distPx;
        } else {
          // Non-arcing ballistic: C++ Coord_Move(tcoord, dir, Random_Pick(0, scatterdist))
          // Uses firing direction (no separate scatter direction RNG).
          const scatterDistLeptons = ScenarioRandom.nextInRange(0, scatterLeptonsInt);
          const distPx = scatterDistLeptons * CELL_SIZE / LEPTON_SIZE;
          const firingAngle = Math.atan2(
            targetCoord.ly - fireCoord.ly,
            targetCoord.lx - fireCoord.lx,
          );
          impactX += Math.cos(firingAngle) * distPx;
          impactY += Math.sin(firingAngle) * distPx;
        }
        // Check if scattered shot still hits the target (within half-cell)
        const dx = impactX - targetPixels.x;
        const dy = impactY - targetPixels.y;
        directHit = Math.sqrt(dx * dx + dy * dy) < CELL_SIZE * 0.6;
      }

      // CF7: Heal guard — negative damage weapons still fire normal C++ bullets.
      // C++ TechnoClass::Fire_At creates an Invisible BulletClass for Heal/
      // GoodWrench. Bullet_Explodes then applies Explosion_Damage and consumes
      // the invisible impact Coord_Scatter RNG. Do not apply healing directly
      // here; doing so skips the bullet AI and desynchronizes RNG.
      if (activeWeapon.damage < 0) {
        if (entity.target.hp >= entity.target.maxHp) {
          entity.target = null;
          return;
        }
        const targetArmor = entity.target.stats.armor;
        const canHealArmor = activeWeapon.warhead === 'Mechanical'
          ? targetArmor !== 'none'
          : targetArmor === 'none';
        if (!canHealArmor) {
          entity.target = null;
          return;
        }
        ctx.revealShooterFromFire?.(entity);
        if (activeWeapon.projSpeed !== undefined || activeWeapon.projectileSpeed !== undefined) {
          ctx.launchProjectile(entity, entity.target, activeWeapon, activeWeapon.damage, impactX, impactY, directHit, fireCoord);
        } else {
          ctx.damageEntity(entity.target, activeWeapon.damage, activeWeapon.warhead, entity);
        }
        return;
      }

      // C++ Modify_Damage (combat.cpp:72-129) — single-application sanity check:
      // "can this weapon damage this target at distance 0?" Used solely as a gate
      // for the dual-weapon fallback and the target-clear branch. The actual damage
      // applied at impact is computed inside applySplashDamage / damageEntity.
      const houseBias = ctx.getFirepowerBias(entity.house);
      const whMult = ctx.getWarheadMult(activeWeapon.warhead, entity.target.stats.armor);
      const damage = modifyDamage(activeWeapon.damage, activeWeapon.warhead, entity.target.stats.armor, 0, houseBias, whMult, ctx.getWarheadMeta(activeWeapon.warhead).spreadFactor);
      const isProjectileWeapon = activeWeapon.projSpeed !== undefined || activeWeapon.projectileSpeed !== undefined;
      if (damage <= 0 && !isProjectileWeapon) {
        // This weapon can't hurt the target. If dual-weapon, don't give up —
        // the other weapon might work. Only give up if neither weapon can damage.
        if (entity.weapon2 && !isSecondary) {
          // Primary can't hurt, but secondary might — don't clear target
        } else if (entity.weapon && isSecondary) {
          // Secondary can't hurt, but primary might — don't clear target
        } else {
          entity.target = null; // can't hurt this target with any weapon, give up
        }
        return;
      }

      ctx.revealShooterFromFire?.(entity);

      if (isProjectileWeapon) {
        // C++ bullet.cpp:478 — bullet strength at firing time = weapon.damage * FirepowerBias.
        // Warhead-vs-armor and distance falloff are applied ONCE on arrival via
        // applySplashDamage → modifyDamage (combat.cpp:106-125, 207). Passing already-modified
        // damage here would double-apply the warhead-vs-armor multiplier.
        //
        // Any non-invisible C++ weapon with rules.ini Speed= creates a
        // BulletClass, even if TS has no legacy projectileSpeed field. This
        // includes invisible Speed=100 bullets: C++ bullet.cpp:736-771 places
        // them at the target coord, arms a normal fuse, and processes damage +
        // Coord_Scatter in BulletClass::AI instead of inside Fire_At.
        const projStrength = Math.max(1, Math.round(activeWeapon.damage * houseBias));
        ctx.launchProjectile(entity, entity.target, activeWeapon, projStrength, impactX, impactY, directHit, fireCoord);
      } else {
        // Instant damage (melee, hitscan weapons).
        // C++ infantry.cpp:438-440 — Scatter fires exactly once per damage event
        // inside InfantryClass::Take_Damage. The scatter RNG is consumed inside
        // ctx.damageEntity() → damageEntity() → aiScatterOnDamage() (combat.ts).
        // Retaliation also runs inside damageEntity (unified C++ FootClass::Take_Damage
        // entry point — foot.cpp:1166-1234).
        let killed = false;
        killed = directHit ? ctx.damageEntity(entity.target, damage, activeWeapon.warhead, entity) : false;

        if (activeWeapon.splash && activeWeapon.splash > 0) {
          const splashCenter = { x: impactX, y: impactY };
          ctx.applySplashDamage(
            splashCenter, activeWeapon, directHit ? entity.target.id : -1,
            entity.house, entity,
          );
        }

        if (killed) {
          entity.creditKill();
          ctx.handleUnitDeath(entity.target, {
            screenShake: 8, explosionSize: 16, debris: true,
            decal: { infantry: 6, vehicle: 10, opacity: 0.6 },
            explodeLgSound: true,
            attackerIsPlayer: ctx.isPlayerControlled(entity),
            trackLoss: true,
            attacker: entity,
          });
        }
      }

      consumeAmmoAfterSuccessfulFire(entity);

      // Armor-based hit indicator at impact point (fires immediately regardless of projectile travel)
      {
        const armor = entity.target.stats.armor;
        if (armor === 'heavy') {
          ctx.effects.push({ type: 'muzzle', x: impactX, y: impactY,
            frame: 0, maxFrames: 3, size: 3, muzzleColor: '255,255,200' } as Effect);
        } else if (armor === 'light') {
          ctx.effects.push({ type: 'muzzle', x: impactX, y: impactY,
            frame: 0, maxFrames: 4, size: 2, muzzleColor: '180,160,120' } as Effect);
        }
      }

      // Play weapon sound (spatially positioned)
      ctx.playSoundAt(ctx.weaponSound(activeWeapon.name), entity.pos.x, entity.pos.y);

      // Spawn attack effects + projectiles (use activeWeapon for correct muzzle color/projectile style)
      const tx = entity.target.pos.x;
      const ty = entity.target.pos.y;
      const sx = entity.pos.x;
      const sy = entity.pos.y;

      if (entity.isAnt && (activeWeapon.name === 'TeslaZap' || activeWeapon.name === 'TeslaCannon')) {
        ctx.effects.push({ type: 'tesla', x: tx, y: ty, frame: 0, maxFrames: 8, size: 12,
          sprite: 'piffpiff', spriteStart: 0, startX: sx, startY: sy, endX: tx, endY: ty, blendMode: 'screen' } as Effect);
      } else if (entity.isAnt && activeWeapon.name === 'Napalm') {
        // Napalm ant: fire burst at target
        ctx.effects.push({ type: 'explosion', x: tx, y: ty, frame: 0, maxFrames: 10, size: 10,
          sprite: 'piffpiff', spriteStart: 0, muzzleColor: '255,140,30' } as Effect);
      } else if (entity.isAnt) {
        ctx.effects.push({ type: 'blood', x: tx, y: ty, frame: 0, maxFrames: 8, size: 6,
          sprite: 'piffpiff', spriteStart: 0 } as Effect);
      } else if (activeWeapon.name === 'TeslaCannon' || activeWeapon.name === 'TeslaZap') {
        // Tesla weapons: lightning bolt arc from source to target
        ctx.effects.push({ type: 'muzzle', x: sx, y: sy, frame: 0, maxFrames: 4, size: 5,
          sprite: 'piff', spriteStart: 0, muzzleColor: '120,180,255' } as Effect);
        ctx.effects.push({ type: 'tesla', x: tx, y: ty, frame: 0, maxFrames: 8, size: 12,
          sprite: 'piffpiff', spriteStart: 0, startX: sx, startY: sy, endX: tx, endY: ty, blendMode: 'screen' } as Effect);
      } else {
        // Muzzle flash at attacker — vehicles use GUNFIRE.SHP with screen blend (C++ isTranslucent)
        const muzzleSprite = (!entity.stats.isInfantry && activeWeapon.warhead !== 'Fire') ? 'gunfire' : 'piff';
        const muzzleBlend = (muzzleSprite === 'gunfire') ? 'screen' as const : undefined;
        ctx.effects.push({ type: 'muzzle', x: sx, y: sy, frame: 0, maxFrames: 4, size: 5,
          sprite: muzzleSprite, spriteStart: 0, muzzleColor: ctx.warheadMuzzleColor(activeWeapon.warhead),
          blendMode: muzzleBlend } as Effect);

        // Projectile travel from attacker to impact point (scattered for inaccurate weapons)
        const projStyle = ctx.weaponProjectileStyle(activeWeapon.name);
        const projCfg = projectileVisualConfig(activeWeapon.name);
        if (projStyle !== 'bullet' || leptonDist(entity.leptonX, entity.leptonY, entity.target.leptonX, entity.target.leptonY) > 512) { // 2 cells in leptons
          // Per-weapon projectile speed: compute travel frames from distance and projSpeed
          const projDistPx = Math.sqrt((impactX - sx) ** 2 + (impactY - sy) ** 2);
          const travelFrames = calcProjectileTravelFrames(projDistPx, activeWeapon.projSpeed);
          ctx.effects.push({
            type: 'projectile', x: sx, y: sy, frame: 0, maxFrames: travelFrames, size: 3,
            startX: sx, startY: sy, endX: impactX, endY: impactY, projStyle,
            ...projCfg,
          } as Effect);
        }

        // R8: Impact explosion sprite via C++ Combat_Anim — damage-scaled selection
        const impactCell = worldToCell(impactX, impactY);
        const impactExpSet = ctx.getWarheadProps(activeWeapon.warhead)?.explosionSet ?? 0;
        const impactLand: 'ground' | 'water' | 'air' =
          (entity.target.isAirUnit && entity.target.flightAltitude > 0) ? 'air' :
          (ctx.map.getTerrain(impactCell.cx, impactCell.cy) === Terrain.WATER && !entity.target.isNavalUnit) ? 'water' : 'ground';
        const impactSprite = combatAnim(activeWeapon.damage, impactExpSet, impactLand);
        if (impactSprite) {
          ctx.effects.push({ type: 'explosion', x: impactX, y: impactY, frame: 0,
            maxFrames: EXPLOSION_FRAMES[impactSprite] ?? 17, size: 8,
            sprite: impactSprite, spriteStart: 0 } as Effect);
          if (!activeWeapon.projectileSpeed) {
            spawnLogicAnimForSprite(ctx.logicAnims, ctx.effects, impactSprite, impactX, impactY);
          }
        }
      }

    }
  } else {
    // Out of range — target must be chased. Drop any pre-fire animation state
    // (C++ Firing_AI only runs when in range; moving breaks the fire gate).
    entity.firePrepActive = false;
    entity.firePrepStage = 0;
    entity.firePrepUsesDoingStage = false;
    entity.firePrepFacing256 = -1;
    if (entity.stats.isInfantry) {
      // C++ Firing_AI does not move infantry directly. Mission_Attack/Hunt/
      // Guard_Area call FootClass::Approach_Target on their timer fire, then
      // InfantryClass::Movement_AI walks the assigned NavCom. Direct
      // moveToward() here sets IsDriving without Head_To_Coord/NavCom and can
      // leave attacking infantry stuck mid-walk.
      entity.animState = AnimState.WALK;
      return;
    }
    // M5: Defensive stance: chase if target within weapon range of guard origin (C++ Threat_Range)
    // Only give up if target is too far from the home position, not current position
    if (entity.stance === Stance.DEFENSIVE) {
      const weaponRange = Math.max(entity.weapon?.range ?? 0, entity.weapon2?.range ?? 0) || 2;
      const origin = entity.guardOrigin ?? entity.pos;
      const originLX = pixelToLepton(origin.x);
      const originLY = pixelToLepton(origin.y);
      const distFromHome = leptonDist(originLX, originLY, entity.target.leptonX, entity.target.leptonY);
      if (distFromHome > (weaponRange + 1) * LEPTON_SIZE) {
        // Target fled beyond guard perimeter — disengage
        entity.target = null;
        entity.forceFirePos = null;
        entity.targetStructure = null;
        entity.mission = ctx.idleMission(entity);
        entity.animState = AnimState.IDLE;
      } else {
        // Target still within guard perimeter — pursue briefly
        entity.animState = AnimState.WALK;
        entity.moveToward({ lx: entity.target.leptonX, ly: entity.target.leptonY }, ctx.movementSpeed(entity));
      }
    } else {
      entity.animState = AnimState.WALK;
      entity.moveToward({ lx: entity.target.leptonX, ly: entity.target.leptonY }, ctx.movementSpeed(entity));
    }
  }

  // NOTE: cooldown decrement is handled at index.ts:3814 at start of every tick
  // for ALL entities (matching C++ TechnoClass::AI). Previously this function
  // also decremented at end, causing a double-decrement that made cooldowns
  // tick down 64 frames instead of the intended 65 for RoF=65 weapons.
}

function groundLayerSortKey(entity: Entity): number {
  // C++ Map.Layer[LAYER_GROUND] is kept in ObjectClass::Sort_Y order.
  // FootClass adds 0x30 to Y; UnitClass/AircraftClass add 0x80.
  const yOffset = entity.stats.isInfantry ? 0x30 : 0x80;
  return (entity.leptonY + yOffset) * 0x10000 + entity.leptonX;
}

/** Hunt mode — move toward target and attack (C++ foot.cpp:654-703)
 *  Actively calls Target_Something_Nearby when target is null or dead. */
export function updateHunt(ctx: MissionAIContext, entity: Entity): void {
  // Called only when missionTimer fires (gated by caller in index.ts).
  // C++ foot.cpp:654-702: Mission_Hunt scans for targets.
  if (entity.target && !entity.target.alive) entity.target = null;
  if (entity.targetStructure && !entity.targetStructure.alive) entity.targetStructure = null;

  if (!entity.target && !entity.targetStructure) {
    entity.target = null;
    entity.targetStructure = null;

    // C++ foot.cpp:657 — Mission_Hunt uses Target_Something_Nearby(THREAT_NORMAL).
    // THREAT_NORMAL = 0 → Threat_Range(-1) = unlimited range (entire map scan).
    // Note: foot.cpp:501 (Mission_MOVE) uses THREAT_RANGE, but HUNT uses THREAT_NORMAL.
    const huntRange = Infinity; // C++ parity: THREAT_NORMAL = no range limit
    const rttiMask = huntScanMask(entity, entity.house === ctx.playerHouse);
    if (rttiMask === 0) {
      // C++ FootClass::Mission_Hunt still calls Random_Animate when
      // Target_Something_Nearby finds no legal target. A zero scan mask is just
      // the no-legal-target case, not a full handler return.
      runInfantryRandomAnimate(ctx, entity);
      return;
    }
    const ec = entity.cell;
    // C++ techno.cpp:1999-2008 — full-map scans restrict ground movers to
    // their current movement zone. THREAT_RANGE scans skip this because range
    // is stricter; vessels/buildings/aircraft are exempt. Without this, HUNT
    // infantry can select high-value targets across unreachable terrain instead
    // of the best target in their own zone (SCG04EA opening USSR E1s).
    const huntReachableZone = (!entity.isNavalUnit && !entity.isAirUnit)
      ? movementZoneCells(ctx.map, ec, false, ctx.structures)
      : null;
    // C++ techno.cpp:1529 — Evaluate_Object checks candidate visibility against
    // the player discovery map (`IsDiscoveredByPlayer`), not the scanner's own
    // house. Candidate-owned-by-player is the only bypass.
    const playerHouseIdx = _HOUSE_IDX[ctx.playerHouse] ?? -1;
    let bestTarget: Entity | null = null;
    let bestStruct: MapStructure | null = null;
    let bestScore = -Infinity;
    let bestSortKey = Infinity;
    for (const other of ctx.entities) {
      if (!other.alive || other.inLimbo || ctx.entitiesAllied(entity, other)) continue;
      if (!isInCppGroundThreatLayer(other)) continue;
      // C++ Target_Something_Nearby delegates through class Greatest_Threat.
      // InfantryClass::Greatest_Threat ORs weapon Allowed_Threats, then clears
      // non-infantry targets for Organic warheads/dogs (infantry.cpp:2315-2326;
      // techno.cpp:2017-2038). Mission_Hunt must respect that same RTTI mask:
      // SCG01EA's USSR dog targets the nearby infantry at (63,49), not the JEEP.
      if (!(entityRttiBit(other) & rttiMask)) continue;
      if (!canTargetNaval(entity, other)) continue;
      if (huntReachableZone && !huntReachableZone[other.cell.cy * MAP_CELLS + other.cell.cx]) continue;
      // C++ parity: spies are INVISIBLE to all non-dog units (techno.cpp:1554-1564)
      if (other.type === UnitType.I_SPY && entity.type !== UnitType.I_DOG) continue;
      // C++ techno.cpp:1476-1479: units on IsNoThreat missions are invisible to hunt scan
      if (MISSION_CONTROL[other.mission]?.isNoThreat) continue;
      // C++ techno.cpp:1467-1470: fully cloaked units cannot be auto-targeted
      if (other.cloakState === CloakState.CLOAKED) continue;
      // C++ techno.cpp:1529: PlayerPtr-owned entities are always visible;
      // otherwise candidate must be discovered by PlayerPtr. This is strict
      // player ownership, not "allied with player".
      if (!isCandidateVisibleToPlayer(ctx, other, playerHouseIdx)) continue;
      // AA gate: ground units on hunt can't target airborne aircraft without AA weapons
      if (other.isAirUnit && other.flightAltitude > 0) {
        const hasAA = entity.weapon?.isAntiAir || entity.weapon2?.isAntiAir;
        if (!hasAA) continue;
      }
      const dist = leptonDist(entity.leptonX, entity.leptonY, other.leptonX, other.leptonY);
      if (dist > huntRange) continue;
      // C++ Evaluate_Object has no terrain LOS check for ANY scan mode.
      // The only visibility filter is IsDiscoveredByPlayer (fog of war).
      const score = ctx.threatScore(entity, other, dist / LEPTON_SIZE);
      const sortKey = groundLayerSortKey(other);
      if (score > bestScore || (score === bestScore && sortKey < bestSortKey)) {
        bestScore = score;
        bestSortKey = sortKey;
        bestTarget = other;
      }
    }

    // C++ full-map Greatest_Threat scans Map.Layer[LAYER_GROUND], where
    // BuildingClass objects and mobile ground objects compete by the same
    // Evaluate_Object score. Structures are not a fallback after mobiles.
    if (rttiMask & RTTI.BUILDING) {
      for (const s of ctx.structures) {
        if (!isAutoTargetableStructure(ctx, entity, s)) continue;
        const center = structureCenterLeptons(s);
        if (!structureMatchesReachableZone(huntReachableZone, s, center)) continue;
        if (!isStructureVisibleToPlayer(ctx, s, center)) continue;
        const targetCoord = structureTargetLeptons(s);
        const dist = leptonDist(entity.leptonX, entity.leptonY, targetCoord.lx, targetCoord.ly);
        if (dist > huntRange) continue;
        const score = structureThreatScore(s, dist);
        const sortKey = structureGroundLayerSortKey(s);
        if (score > bestScore || (score === bestScore && sortKey < bestSortKey)) {
          bestScore = score;
          bestSortKey = sortKey;
          bestTarget = null;
          bestStruct = s;
        }
      }
    }

    if (bestStruct) {
      if (!bestStruct.alive || bestStruct.hp <= 0) {
        // C++ returns the best object from Greatest_Threat, then
        // TechnoClass::Assign_Target clears zero-strength objects without
        // retrying the scan. This can intentionally leave HUNT targetless for
        // the current scan even when a lower-value live structure also exists.
        entity.target = null;
        entity.targetStructure = null;
        runInfantryRandomAnimate(ctx, entity);
        return;
      }
      // C++ FootClass::Mission_Hunt keeps Mission == HUNT for ordinary
      // targets. Target_Something_Nearby assigns TarCom, then Mission_Hunt
      // calls Approach_Target(); the class-specific Combat_AI/Firing_AI
      // later fires while the mission remains HUNT. Do not promote to
      // ATTACK here or hunt units stop rescanning and can hold stale targets
      // (SCG07EA SS stayed on PT @(13,51), launching a TS-only torpedo).
      entity.target = null;
      entity.targetStructure = bestStruct;
      return;
    }
    if (bestTarget) {
      // Found a new target — continue hunting.
      entity.target = bestTarget;
      entity.targetStructure = null;
    } else {
      // C++ foot.cpp:688 — Random_Animate when no target found (on scan tick)
      runInfantryRandomAnimate(ctx, entity);
      return;
    }
  }

  // C++ FootClass::Mission_Hunt: scan/assign TarCom, then Approach_Target().
  // It does NOT Assign_Mission(MISSION_ATTACK) for normal armed units. Firing
  // happens later via class-specific Firing_AI/Combat_AI while Mission remains
  // HUNT, preserving future hunt timer scans.
  if (entity.targetStructure?.alive) {
    entity.animState = entity.weapon && entityInRangeOfStructure(entity, entity.targetStructure)
      ? AnimState.ATTACK
      : AnimState.WALK;
    return;
  }

  if (entity.target?.alive && entity.inRange(entity.target)) {
    entity.animState = AnimState.ATTACK;
  } else {
    entity.animState = AnimState.WALK;
    // Movement happens in the between-scans code (index.ts HUNT else branch),
    // NOT here. C++ Mission_Hunt only sets target; Approach_Target moves.
  }
}

// ── C++ Greatest_Threat RTTI mask computation ─────────────────────────────────
//
// C++ weapon.cpp:317-327 WeaponTypeClass::Allowed_Threats:
//   threat = THREAT_NORMAL;
//   if (Bullet->IsAntiAircraft) threat |= THREAT_AIR;
//   if (Bullet->IsAntiGround)   threat |= THREAT_INFANTRY|THREAT_VEHICLES|THREAT_BOATS|THREAT_BUILDINGS;
//
// InfantryClass::Greatest_Threat (infantry.cpp:2314-2319) and UnitClass::
// Greatest_Threat (unit.cpp:4623-4628) OR the weapon's Allowed_Threats into the
// threat mask BEFORE calling FootClass/TechnoClass::Greatest_Threat. Then the
// base TechnoClass::Greatest_Threat (techno.cpp:2032-2040) converts threat bits
// to an RTTI mask, and Evaluate_Object (techno.cpp:1534-1542) rejects candidates
// whose RTTI type doesn't match the mask.
//
// Subclass overrides also apply AFTER the weapon OR:
//   - Organic warhead (dog/medic, infantry.cpp:2325-2326): clears BUILDINGS/
//     VEHICLES/BOATS/AIR → dog jaws and heal can only consider infantry.
//   - Human-controlled armed infantry (infantry.cpp:2332-2334): clears BUILDINGS
//     → player E1/E3 don't auto-fire on structures.
//   - Dog/medic branch at techno.cpp:2017-2026: method REPLACED with THREAT_INFANTRY
//     (medics) or THREAT_VEHICLES|THREAT_AIR (mechanics). This wipes weapon bits.
//   - THREAT_VEHICLES → mask also adds RTTI_AIRCRAFT (techno.cpp:2089-2091) so
//     landed aircraft count as vehicles.

/** RTTI flags matching C++ RTTIType bit positions (techno.cpp:2032-2040). */
const enum RTTI {
  INFANTRY = 1 << 1,
  UNIT     = 1 << 2, // vehicle
  VESSEL   = 1 << 3, // naval
  BUILDING = 1 << 4,
  AIRCRAFT = 1 << 5, // airborne
}

/**
 * Compute the RTTI mask this entity can target via Mission_Guard's Target_Something_
 * Nearby(THREAT_RANGE). Mirrors C++ InfantryClass/UnitClass/VesselClass::Greatest_Threat
 * + base TechnoClass::Greatest_Threat mask construction.
 *
 * Returns 0 when the scan is a complete no-op (no weapon, or unarmed civilian).
 * The `isHumanControlled` flag is ctx.playerHouse check for human buildings filter.
 */
function guardScanMask(entity: Entity, isHumanControlled: boolean): number {
  // Dog override (techno.cpp:2017-2019): method = THREAT_INFANTRY only.
  // Dog's DogJaw also has Organic warhead (infantry.cpp:2325-2326) which would
  // have the same effect, but dog branch wins via explicit IsDog check.
  if (entity.type === UnitType.I_DOG) return RTTI.INFANTRY;

  // Medic (Combat_Damage < 0, not mechanic): method = THREAT_INFANTRY.
  // Friendly/injured filtering is handled in cellBasedGuardScan, matching
  // techno.cpp:1831-1843 Evaluate_Cell and techno.cpp:1491-1506 Evaluate_Object.
  if (entity.type === UnitType.I_MEDI) return RTTI.INFANTRY;

  // Mechanic (FIXIT_CSII, Combat_Damage < 0): method = THREAT_VEHICLES | THREAT_AIR.
  if (entity.type === UnitType.I_MECH) return RTTI.UNIT | RTTI.AIRCRAFT;

  // VesselClass::Greatest_Threat (vessel.cpp:1223-1256). FootClass::
  // Mission_Guard calls Target_Something_Nearby(THREAT_RANGE) for vessels too;
  // the virtual VesselClass override rewrites/extends the threat bits before
  // delegating to TechnoClass::Greatest_Threat. SCG07EA tick 287: Greece PT at
  // (19,53) acquires the damaged USSR SS at (20,53), fires, and later Mission_
  // Guard returns Arm instead of consuming Random_Pick at tick 296.
  if (entity.isNavalUnit) {
    if (entity.type === UnitType.V_SS || entity.type === UnitType.V_MSUB) {
      // Submarines replace THREAT_RANGE with THREAT_BOATS plus buildings/factories.
      return RTTI.VESSEL | RTTI.BUILDING;
    }

    const w1 = entity.weapon;
    const w2 = entity.weapon2;
    if (!w1 && !w2) return 0;

    const anyAG = (!!w1 && w1.isAntiGround !== false) || (!!w2 && w2.isAntiGround !== false);
    const anyAA = !!(w1?.isAntiAir || w2?.isAntiAir);
    let mask = 0;
    if (anyAG) mask |= RTTI.INFANTRY | RTTI.UNIT | RTTI.VESSEL | RTTI.BUILDING;
    if (anyAA) mask |= RTTI.AIRCRAFT;
    if (mask & RTTI.UNIT) mask |= RTTI.AIRCRAFT;

    // vessel.cpp:1248 — cruisers can never hit infantry.
    if (entity.type === UnitType.V_CA) mask &= ~RTTI.INFANTRY;
    return mask;
  }

  // Regular armed unit path (UnitClass/InfantryClass override): need a primary weapon.
  const w1 = entity.weapon;
  const w2 = entity.weapon2;
  if (!w1 && !w2) return 0;

  // C++ weapon.Allowed_Threats:
  //   isAntiGround !== false  → THREAT_INFANTRY|VEHICLES|BOATS|BUILDINGS
  //   isAntiAir === true      → THREAT_AIR (airborne)
  // In TS, isAntiGround is only set explicitly to `false` for AA-only weapons
  // (RedEye/DepthCharge). Undefined means AG=yes.
  const w1AG = !!w1 && w1.isAntiGround !== false;
  const w2AG = !!w2 && w2.isAntiGround !== false;
  const w1AA = !!(w1 && w1.isAntiAir);
  const w2AA = !!(w2 && w2.isAntiAir);
  const anyAG = w1AG || w2AG;
  const anyAA = w1AA || w2AA;

  let mask = 0;
  if (anyAG) mask |= RTTI.INFANTRY | RTTI.UNIT | RTTI.VESSEL | RTTI.BUILDING;
  if (anyAA) mask |= RTTI.AIRCRAFT;
  // techno.cpp:2089-2091: if THREAT_VEHICLES set, also accept landed aircraft.
  if (mask & RTTI.UNIT) mask |= RTTI.AIRCRAFT;

  // Organic warhead (infantry.cpp:2325-2326): clears non-infantry for infantry
  // with an equipped organic-warhead weapon. In TS we guard on infantry only to
  // mirror C++ (`Is_Weapon_Equipped()` + InfantryClass-specific check).
  if (entity.stats.isInfantry && w1 && w1.warhead === 'Organic') {
    mask &= ~(RTTI.BUILDING | RTTI.UNIT | RTTI.VESSEL | RTTI.AIRCRAFT);
  }

  // Human-controlled armed infantry (infantry.cpp:2332-2334): clears BUILDINGS.
  if (entity.stats.isInfantry && isHumanControlled) {
    mask &= ~RTTI.BUILDING;
  }

  return mask;
}

/** C++ FootClass::Mission_Hunt calls Target_Something_Nearby(THREAT_NORMAL).
 *  For vessels, the virtual VesselClass::Greatest_Threat override still applies:
 *  submarines replace THREAT_NORMAL with BOATS|BUILDINGS|FACTORIES, while other
 *  vessels OR in weapon Allowed_Threats and cruisers drop INFANTRY. Keep the
 *  Mission_Guard vessel no-op above isolated to guard scans only. */
function huntScanMask(entity: Entity, isHumanControlled: boolean): number {
  if (!entity.isNavalUnit) {
    return guardScanMask(entity, isHumanControlled);
  }

  if (entity.type === UnitType.V_SS) {
    return RTTI.VESSEL | RTTI.BUILDING;
  }

  const w1 = entity.weapon;
  const w2 = entity.weapon2;
  if (!w1 && !w2) return 0;

  const anyAG = (!!w1 && w1.isAntiGround !== false) || (!!w2 && w2.isAntiGround !== false);
  const anyAA = !!(w1?.isAntiAir || w2?.isAntiAir);
  let mask = 0;
  if (anyAG) mask |= RTTI.INFANTRY | RTTI.UNIT | RTTI.VESSEL | RTTI.BUILDING;
  if (anyAA) mask |= RTTI.AIRCRAFT;
  if (mask & RTTI.UNIT) mask |= RTTI.AIRCRAFT;

  // vessel.cpp:1248 — cruisers cannot target infantry.
  if (entity.type === UnitType.V_CA) {
    mask &= ~RTTI.INFANTRY;
  }
  return mask;
}

/**
 * Map an entity to an RTTI bit for mask-matching. Airborne aircraft are RTTI.
 * AIRCRAFT; landed aircraft count as RTTI.UNIT in C++ (techno.cpp:2089-2091
 * explicitly sets mask |= RTTI_AIRCRAFT when THREAT_VEHICLES is on — so landed
 * aircraft can be targeted by vehicle-class weapons).
 */
function entityRttiBit(other: Entity): number {
  if (other.stats.isInfantry) return RTTI.INFANTRY;
  if (other.isNavalUnit) return RTTI.VESSEL;
  if (other.isAirUnit && other.flightAltitude > 0) return RTTI.AIRCRAFT;
  if (other.isAirUnit) return RTTI.AIRCRAFT; // landed — covered via UNIT|AIRCRAFT union above
  return RTTI.UNIT;
}

const CXX_GROUND_LAYER_HEIGHT_LEPTONS =
  Entity.FLIGHT_LEVEL_LEPTONS - Math.trunc(Entity.FLIGHT_LEVEL_LEPTONS / 3);

function isInCppGroundThreatLayer(other: Entity): boolean {
  // C++ ObjectClass::In_Which_Layer keeps non-air falling objects in LAYER_TOP
  // while Height >= FLIGHT_LEVEL - FLIGHT_LEVEL/3. FootClass::Mark converts
  // MARK_DOWN/MARK_UP to MARK_CHANGE outside LAYER_GROUND, so those objects are
  // absent from Cell_Occupier() and Map.Layer[LAYER_GROUND] threat scans until
  // the layer transition places their footprint down.
  if (other.isAirUnit) return true;
  if (!other.isFalling) return true;
  return other.fallHeightLeptons < CXX_GROUND_LAYER_HEIGHT_LEPTONS;
}

function isCandidateVisibleToPlayer(ctx: GreatestThreatRangeContext, other: Entity, playerHouseIdx: number): boolean {
  // C++ techno.cpp:624 + 1529: IsOwnedByPlayer is strict PlayerPtr ownership,
  // not "player allied". Non-PlayerPtr candidates require IsDiscoveredByPlayer.
  if (other.house === ctx.playerHouse) return true;
  if (ctx.isDiscoveredByPlayer) return ctx.isDiscoveredByPlayer(other);
  // Fallback for unit tests that have not wired discovery state yet.
  return playerHouseIdx >= 0 && ctx.isRevealedToHouse(other.cell.cx, other.cell.cy, playerHouseIdx);
}

function structureZonePassableCells(structures?: MapStructure[]): Set<number> | null {
  if (!structures?.length) return null;
  const cells = new Set<number>();
  for (const s of structures) {
    if (!s.alive) continue;
    for (const cell of getStructureOccupyCells(s.type, s.cx, s.cy)) {
      cells.add(cell.cy * MAP_CELLS + cell.cx);
    }
  }
  return cells;
}

export function movementZoneCells(
  map: GameMap,
  start: { cx: number; cy: number },
  naval: boolean,
  structures?: MapStructure[],
): Uint8Array {
  const structureCells = !naval ? structureZonePassableCells(structures) : null;
  const passable = (cx: number, cy: number) => {
    if (!naval && structureCells?.has(cy * MAP_CELLS + cx)) return true;
    return naval ? map.isWaterPassable(cx, cy) : map.isTerrainPassable(cx, cy);
  };

  const seen = new Uint8Array(MAP_CELLS * MAP_CELLS);
  if (start.cx < 0 || start.cx >= MAP_CELLS || start.cy < 0 || start.cy >= MAP_CELLS) return seen;
  if (!passable(start.cx, start.cy)) return seen;

  const qx: number[] = [start.cx];
  const qy: number[] = [start.cy];
  seen[start.cy * MAP_CELLS + start.cx] = 1;

  for (let head = 0; head < qx.length; head++) {
    const cx = qx[head];
    const cy = qy[head];
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= MAP_CELLS || ny < 0 || ny >= MAP_CELLS) continue;
      const idx = ny * MAP_CELLS + nx;
      if (seen[idx]) continue;
      if (!passable(nx, ny)) continue;
      seen[idx] = 1;
      qx.push(nx);
      qy.push(ny);
    }
  }

  return seen;
}

/**
 * C++ parity: cell-based guard scan matching techno.cpp Greatest_Threat with THREAT_RANGE.
 *
 * C++ scans cells in a radial outward pattern from the scanner's Fire_Coord cell:
 *   - For each ring radius 0..crange-1: top row, bottom row, left col, right col
 *   - For each cell: Evaluate_Cell picks the FIRST non-allied techno in the LIFO
 *     occupier chain — which is the MOST RECENTLY unlimboed entity in that cell
 *   - Calls Evaluate_Object to check range/validity and get threat value
 *   - BUG IN C++: bestval is never updated during cell scan (initialized to -1),
 *     so every valid target overwrites the previous one → last valid target wins
 *   - Early bailout at crange/4 and crange/2 if any target has been found
 *
 * This differs from a naive "scan all entities, pick highest score" approach because:
 *   1. Only one occupant per cell is evaluated (most recently unlimboed enemy)
 *   2. Scan order determines tiebreaking (last in order wins, not highest score)
 *   3. Early bailout means inner-ring targets are strongly preferred
 */
function cellBasedGuardScan(
  ctx: GreatestThreatRangeContext,
  entity: Entity,
  scanRange: number,
  rttiMask: number,
  opts?: {
    /** C++ TechnoClass::Greatest_Threat THREAT_AREA uses Threat_Range(1) directly.
     *  THREAT_RANGE uses range==0 and computes crange = weapon range + 1. */
    mode?: 'range' | 'area';
    /** Optional scan center/range source when C++ temporarily swaps Coord,
     *  e.g. FootClass::Mission_Guard_Area scans from ArchiveTarget. */
    sourceLX?: number;
    sourceLY?: number;
  },
): Entity | null {
  // C++ techno.cpp:2048-2053:
  //   THREAT_RANGE: range==0 → crange = max weapon range in cells + 1.
  //   THREAT_AREA:  range>0  → crange = Threat_Range(1) in cells.
  const mode = opts?.mode ?? 'range';
  const crange = mode === 'area' ? Math.floor(scanRange) : Math.floor(scanRange) + 1;
  const scanRangeLeptons = scanRange * LEPTON_SIZE;
  if (crange <= 0) return null;

  const sourceLX = opts?.sourceLX ?? entity.leptonX;
  const sourceLY = opts?.sourceLY ?? entity.leptonY;
  // C++ techno.cpp:2055: CELL cell = Coord_Cell(Fire_Coord(0)).
  // For THREAT_AREA, FootClass::Mission_Guard_Area temporarily swaps Coord to
  // ArchiveTarget before calling Target_Something_Nearby, so Fire_Coord(0) must
  // be evaluated from the temporary source coordinate, not the live unit coord.
  const scanFireCoord = mode === 'area'
    ? entity.fireCoordPrimaryFrom(sourceLX, sourceLY)
    : entity.fireCoordPrimary();
  const cellX = Math.floor(scanFireCoord.lx / LEPTON_SIZE);
  const cellY = Math.floor(scanFireCoord.ly / LEPTON_SIZE);

  // C++ TechnoClass::Evaluate_Object:
  //   THREAT_RANGE (range==0): calls In_Range(object, primary), which uses
  //   Fire_Coord(primary).
  //   THREAT_AREA (range>0): calls Distance(object), which uses the scanner's
  //   current Coord. FootClass::Mission_Guard_Area temporarily sets Coord to
  //   ArchiveTarget before calling Target_Something_Nearby(THREAT_AREA), so
  //   range checks must use sourceLX/sourceLY, not the unit's live fire coord.
  const rangeSrcLx = mode === 'area' ? sourceLX : scanFireCoord.lx;
  const rangeSrcLy = mode === 'area' ? sourceLY : scanFireCoord.ly;
  const debugJeep = isScg01Jeep27DebugEnabled() && entity.type === UnitType.V_JEEP;
  const cellKey = (cx: number, cy: number) => cy * 128 + cx;

  // C++ techno.cpp:1999-2008 + 1480-1484 — Greatest_Threat applies movement
  // zone filtering for non-THREAT_RANGE scans unless the scanner is a vessel,
  // building, or aircraft. Mission_Guard_Area temporarily swaps Coord to
  // ArchiveTarget before calling Target_Something_Nearby(THREAT_AREA), so the
  // zone source is that temporary Coord, not the unit's live position or muzzle.
  //
  // This is not a scenario rule: Evaluate_Object rejects candidates outside
  // Map[Center_Coord()].Zones[Techno_Type_Class()->MZone] when `zone != -1`.
  // TS already used this for full-map HUNT scans; AREA scans need it too.
  let reachableZone: Uint8Array | null = null;
  if (mode === 'area' && !entity.isNavalUnit && !entity.isAirUnit) {
    const zoneSource = {
      cx: Math.floor(sourceLX / LEPTON_SIZE),
      cy: Math.floor(sourceLY / LEPTON_SIZE),
    };
    reachableZone = movementZoneCells(ctx.map, zoneSource, false, ctx.structures);
    if (!reachableZone[cellKey(zoneSource.cx, zoneSource.cy)]) {
      // C++ zone can be -1 for invalid/unzoned cells; that disables the check.
      reachableZone = null;
    }
  }

  // Map bounds for clipping
  const mapX = ctx.map.boundsX;
  const mapY = ctx.map.boundsY;
  const mapW = ctx.map.boundsW;
  const mapH = ctx.map.boundsH;

  // Build cell→entity lookup: for each cell, store the LAST candidate techno.
  //
  // C++ Evaluate_Cell (techno.cpp:1831-1843) traverses the Cell_Occupier() linked list:
  //   - normal weapons pick the FIRST non-allied techno
  //   - negative-damage weapons pick the FIRST injured allied techno
  //
  // The occupier list is LIFO — Occupy_Up (cell.cpp:1189) prepends:
  // object->Next = OccupierPtr; OccupierPtr = object. So the FIRST in the LIFO
  // chain is the MOST RECENTLY unlimboed entity in that cell.
  //
  // ctx.entities is in INI/unlimbo order (oldest first). To match C++'s "most recently
  // unlimboed" selection, we always overwrite — the LAST entity per cell in our forward
  // iteration is the one that would be at the HEAD of C++'s LIFO occupier chain.
  const cellMap = new Map<number, Entity>();
  // C++ techno.cpp:1529 — visibility is checked on the candidate object:
  //   if (!object->IsOwnedByPlayer && !object->IsDiscoveredByPlayer && GAME_NORMAL)
  //       reject;
  //
  // This is NOT "if the scanner is player-controlled, bypass fog". The bypass only
  // applies when the candidate itself belongs to PlayerPtr. SCG06EA t87: Greece
  // JEEP's guard scan must reject an undiscovered BadGuy E1 and keep scanning to
  // the discovered USSR E1, matching C++.
  const playerHouseIdx = _HOUSE_IDX[ctx.playerHouse] ?? -1;
  const isDog = entity.type === UnitType.I_DOG;
  const isRepairWeapon = (entity.weapon?.damage ?? 0) < 0;
  for (const other of ctx.entities) {
    // C++ Evaluate_Object does NOT reject zero-strength ACTIVE objects. It can
    // select an object that is still in the Cell_Occupier chain with Strength=0;
    // only Assign_Target later clears that target (techno.cpp:2875-2889).
    //
    // TS `alive=false` ordinary infantry can still approximate a C++ active
    // zero-strength object during its death animation, so keep those candidates.
    // Dogs are the exception observed in C++: dog deaths are removed/limboed
    // from the occupier chain before they can poison later scans. SCG01EA t147:
    // a dead DOG record at (63,52) must not block the JEEP from selecting the
    // live E1 behind it, while SCG06EA t132 still needs a dead E1 blocker.
    if (other.inLimbo) continue;
    if (!isInCppGroundThreatLayer(other)) continue;
    // C++ infantry can remain in Cell_Occupier while playing death animation,
    // which is why dead non-dog infantry must still be visible to the scan in
    // a few parity cases. Destroyed vehicles/buildings are not valid occupiers
    // for TechnoClass::Evaluate_Cell in the same way; keeping them here lets
    // AREA_GUARD units target husks C++ has already removed (SCG07EA t177).
    if (!other.alive && !other.stats.isInfantry) continue;
    if (!other.alive && other.stats.isInfantry && other.isInfantryDeathAnimationComplete()) continue;
    if (!other.alive && other.type === UnitType.I_DOG) continue;
    const allied = ctx.entitiesAllied(entity, other);
    if (isRepairWeapon) {
      // C++ techno.cpp:1836:
      //   if (Combat_Damage() < 0) {
      //     if (tentative->Health_Ratio() < Rule.ConditionGreen
      //         && House->Is_Ally(tentative)) break;
      //   }
      //
      // Rule.ConditionGreen is fixed(1), so only not-full-health allies are
      // legal repair/heal targets. Enemies are not selected by Evaluate_Cell
      // for negative-damage scanners.
      if (!allied) continue;
      if (other.hp >= other.maxHp) continue;
    } else if (allied) {
      continue;
    }
    // C++ Evaluate_Object mask check (techno.cpp:1534-1542):
    //   if (!((1 << otype) & mask)) return false; // Mask failure.
    // rttiMask is computed by guardScanMask() from the scanner's weapon
    // Allowed_Threats (C++ weapon.cpp:317-327) plus subclass overrides.
    if (!(entityRttiBit(other) & rttiMask)) continue;
    // C++ techno.cpp:1554-1564: spies invisible to non-dogs
    if (other.type === UnitType.I_SPY && !isDog) continue;
    // C++ techno.cpp:1476-1479: units on IsNoThreat missions
    if (MISSION_CONTROL[other.mission]?.isNoThreat) continue;
    // C++ techno.cpp:1467-1470: fully cloaked units
    if (other.cloakState === CloakState.CLOAKED) continue;
    // C++ techno.cpp:1529: candidate-owned-by-player bypass is strict PlayerPtr
    // match; otherwise candidate must be IsDiscoveredByPlayer. Per-house sight
    // is not enough; SCG07EA England JEEP is player-allied but not PlayerPtr
    // and must not acquire undiscovered USSR E4s through its own allied sight.
    if (!isCandidateVisibleToPlayer(ctx, other, playerHouseIdx)) continue;
    // Naval combat filtering
    if (!canTargetNaval(entity, other)) continue;
    // Air combat filtering: airborne aircraft require AA weapon. Already covered
    // by rttiMask (AIRCRAFT bit only set when isAntiAir), but keep explicit guard
    // for the landed-aircraft-as-UNIT case where mask has AIRCRAFT via UNIT set.
    if (other.isAirUnit && other.flightAltitude > 0) {
      const hasAA = entity.weapon?.isAntiAir || entity.weapon2?.isAntiAir;
      if (!hasAA) continue;
    }
    // C++ Evaluate_Cell reads Map[cell].Cell_Occupier(). Infantry movement
    // reservation is separate: InfantryClass::Set_Occupy_Bit only toggles
    // Map[cell].Flag.Composite/InfType, not the Cell_Occupier linked list
    // (infantry.cpp:3021-3077). So targeting scans must use the infantry's
    // current Coord_Cell, not Head_To_Coord/claimedCellIdx. SCG01EA t87:
    // the dog reserves (63,52), but C++ cell occupiers show (63,52) empty;
    // using claimedCellIdx makes TS pick the dog instead of the wounded E1.
    const oc = other.cell;
    if (reachableZone && !reachableZone[cellKey(oc.cx, oc.cy)]) continue;
    const key = cellKey(oc.cx, oc.cy);
    // C++ LIFO: last unlimboed = head of chain = picked by Evaluate_Cell.
    // TS forward iteration: always overwrite so last (= most recently unlimboed) wins.
    cellMap.set(key, other);
  }

  let bestObject: Entity | null = null;
  // C++ BUG: bestval is initialized to -1 and NEVER updated in the cell scan loop
  // (techno.cpp:2122-2124 sets bestobject but not bestval). This means every valid
  // target overwrites the previous one — effectively "last valid target in scan order wins".

  // C++ techno.cpp:2108-2209: radiate outward ring by ring
  for (let radius = 0; radius < crange; radius++) {
    // Top and bottom rows of the "box" (C++ techno.cpp:2113-2150)
    for (let x = -radius; x <= radius; x++) {
      const cx = cellX + x;
      if (cx < mapX || cx >= mapX + mapW) continue;

      // Top row: y = cellY - radius
      const topY = cellY - radius;
      if (topY >= mapY && topY < mapY + mapH) {
        const ent = cellMap.get(cellKey(cx, topY));
        if (ent) {
          // C++ Evaluate_Object range check:
          //   THREAT_RANGE range==0: What_Weapon_Should_I_Use(object), then
          //     In_Range(object, selected weapon)
          //   THREAT_AREA  range>0: Distance(scanner Coord, Center_Coord) <= range
          const selectedWeapon = mode === 'range'
            ? selectedWeaponForTarget(ctx, entity, ent)
            : null;
          const dist = leptonDist(rangeSrcLx, rangeSrcLy, ent.leptonX, ent.leptonY);
          const inRange = mode === 'range'
            ? !!selectedWeapon && entity.inRangeWithCoord(ent.leptonX, ent.leptonY, selectedWeapon)
            : dist <= scanRangeLeptons;
          if (debugJeep) {
            // eslint-disable-next-line no-console
            console.debug(`[SCG01_JEEP] tick=${ctx.tick} jeep@(${cellX},${cellY}) ` +
              `scanning (${cx},${topY}) cand=${ent.type}#${ent.id} dist=${dist} ` +
              `rangeLeptons=${scanRangeLeptons} useFireCoord=true ` +
              `centerDist=${leptonDist(entity.leptonX, entity.leptonY, ent.leptonX, ent.leptonY)} ` +
              `accept=${inRange}`);
          }
          if (inRange) {
            // C++ bestval < value is always true (bestval stays -1) → always overwrite
            bestObject = ent;
          }
        }
      }

      // Bottom row: y = cellY + radius
      const botY = cellY + radius;
      if (botY >= mapY && botY < mapY + mapH) {
        // Avoid double-scanning center cell (radius==0: top==bottom)
        if (radius > 0 || x !== -radius) {
          const ent = cellMap.get(cellKey(cx, botY));
          if (ent) {
            const selectedWeapon = mode === 'range'
              ? selectedWeaponForTarget(ctx, entity, ent)
              : null;
            const dist = leptonDist(rangeSrcLx, rangeSrcLy, ent.leptonX, ent.leptonY);
            const inRange = mode === 'range'
              ? !!selectedWeapon && entity.inRangeWithCoord(ent.leptonX, ent.leptonY, selectedWeapon)
              : dist <= scanRangeLeptons;
            if (debugJeep) {
              // eslint-disable-next-line no-console
              console.debug(`[SCG01_JEEP] tick=${ctx.tick} jeep@(${cellX},${cellY}) ` +
                `scanning (${cx},${botY}) cand=${ent.type}#${ent.id} dist=${dist} ` +
                `rangeLeptons=${scanRangeLeptons} useFireCoord=true ` +
                `centerDist=${leptonDist(entity.leptonX, entity.leptonY, ent.leptonX, ent.leptonY)} ` +
                `accept=${inRange}`);
            }
            if (inRange) {
              bestObject = ent;
            }
          }
        }
      }
    }

    // Left and right columns of the "box" (C++ techno.cpp:2155-2192)
    // C++ range: y from -(radius-1) to radius-1 (exclusive of corners already scanned)
    for (let y = -(radius - 1); y < radius; y++) {
      const cy = cellY + y;
      if (cy < mapY || cy >= mapY + mapH) continue;

      // Left column: x = cellX - radius
      const leftX = cellX - radius;
      if (leftX >= mapX && leftX < mapX + mapW) {
        const ent = cellMap.get(cellKey(leftX, cy));
        if (ent) {
          const selectedWeapon = mode === 'range'
            ? selectedWeaponForTarget(ctx, entity, ent)
            : null;
          const dist = leptonDist(rangeSrcLx, rangeSrcLy, ent.leptonX, ent.leptonY);
          const inRange = mode === 'range'
            ? !!selectedWeapon && entity.inRangeWithCoord(ent.leptonX, ent.leptonY, selectedWeapon)
            : dist <= scanRangeLeptons;
          if (debugJeep) {
            // eslint-disable-next-line no-console
            console.debug(`[SCG01_JEEP] tick=${ctx.tick} jeep@(${cellX},${cellY}) ` +
              `scanning (${leftX},${cy}) cand=${ent.type}#${ent.id} dist=${dist} ` +
              `rangeLeptons=${scanRangeLeptons} useFireCoord=true ` +
              `centerDist=${leptonDist(entity.leptonX, entity.leptonY, ent.leptonX, ent.leptonY)} ` +
              `accept=${inRange}`);
          }
          if (inRange) {
            bestObject = ent;
          }
        }
      }

      // Right column: x = cellX + radius
      const rightX = cellX + radius;
      if (rightX >= mapX && rightX < mapX + mapW) {
        const ent = cellMap.get(cellKey(rightX, cy));
        if (ent) {
          const selectedWeapon = mode === 'range'
            ? selectedWeaponForTarget(ctx, entity, ent)
            : null;
          const dist = leptonDist(rangeSrcLx, rangeSrcLy, ent.leptonX, ent.leptonY);
          const inRange = mode === 'range'
            ? !!selectedWeapon && entity.inRangeWithCoord(ent.leptonX, ent.leptonY, selectedWeapon)
            : dist <= scanRangeLeptons;
          if (debugJeep) {
            // eslint-disable-next-line no-console
            console.debug(`[SCG01_JEEP] tick=${ctx.tick} jeep@(${cellX},${cellY}) ` +
              `scanning (${rightX},${cy}) cand=${ent.type}#${ent.id} dist=${dist} ` +
              `rangeLeptons=${scanRangeLeptons} useFireCoord=true ` +
              `centerDist=${leptonDist(entity.leptonX, entity.leptonY, ent.leptonX, ent.leptonY)} ` +
              `accept=${inRange}`);
          }
          if (inRange) {
            bestObject = ent;
          }
        }
      }
    }

    // C++ techno.cpp:2198-2205: Early bailout at crange/4 and crange/2
    if (bestObject !== null) {
      const q = Math.floor(crange / 4);
      const h = Math.floor(crange / 2);
      if (radius === q || radius === h) {
        return isAssignableObjectTarget(bestObject) ? bestObject : null;
      }
    }
  }

  return isAssignableObjectTarget(bestObject) ? bestObject : null;
}

/** C++ TechnoClass::Target_Something_Nearby(THREAT_RANGE).
 * Assigns TarCom when a nearby target is found; does not fire or change Mission.
 * Used by FootClass::Mission_Move (foot.cpp:530) and Mission_Guard.
 */
export function greatestThreatRangeTarget(ctx: GreatestThreatRangeContext, entity: Entity): Entity | null {
  const weaponMax = Math.max(entity.weapon?.range ?? 0, entity.weapon2?.range ?? 0);
  const scanMask = guardScanMask(entity, ctx.isPlayerControlled(entity));
  if (weaponMax <= 0 || scanMask === 0) return null;
  return cellBasedGuardScan(ctx, entity, weaponMax, scanMask);
}

export function targetSomethingNearbyRange(ctx: MissionAIContext, entity: Entity): Entity | null {
  const weaponMax = Math.max(entity.weapon?.range ?? 0, entity.weapon2?.range ?? 0);
  const scanMask = guardScanMask(entity, ctx.isPlayerControlled(entity));
  if (weaponMax <= 0 || scanMask === 0) {
    assignTargetForTechno(entity, null);
    return null;
  }

  if (isAssignableObjectTarget(entity.target)) {
    const selectedWeapon = selectedWeaponForTarget(ctx, entity, entity.target);
    if (selectedWeapon && entity.inRangeWith(entity.target, selectedWeapon)) return entity.target;
    assignTargetForTechno(entity, null);
  } else {
    assignTargetForTechno(entity, null);
  }

  const bestTarget = cellBasedGuardScan(ctx, entity, weaponMax, scanMask);
  assignTargetForTechno(entity, bestTarget);
  return bestTarget;
}

/** Guard mode — attack nearby enemies or auto-heal (rate-limited to every 15 ticks) */
export function updateGuard(ctx: MissionAIContext, entity: Entity, timerFired = true): void {
  entity.animState = AnimState.IDLE;

  // Save guard origin when first entering guard stance (for return-after-chase)
  if (entity.isPlayerUnit && !entity.guardOrigin) {
    entity.guardOrigin = { x: entity.pos.x, y: entity.pos.y };
  }

  // C++ FootClass::Mission_Guard has no separate medic/mechanic pre-pass.
  // Negative-damage units acquire injured allied targets through the normal
  // Target_Something_Nearby(THREAT_RANGE) path, via TechnoClass::Evaluate_Cell
  // and Evaluate_Object.

  // IdleTimer decremented in index.ts updateEntity (runs every tick for all missions)

  // Cooldowns are now ticked globally in index.ts (C++ TechnoClass::AI ticks Arm for ALL missions).

  // C++ MissionClass::Timer gates when Mission_Guard fires.
  // Timer and jitter are now handled by the caller (index.ts) via entity.missionTimer.
  // Only run the scan portion when the timer fires.
  if (!timerFired) return;

  // Civilians auto-flee nearby ants (SCA02EA evacuation behavior).
  // C++ parity: Mission_Guard doesn't early-return for civilians — after the
  // non-ant-threat scan fails, Random_Animate still fires (infantry.cpp:1748
  // IdleTimer pick + switch case). Only skip the cellBasedGuardScan weapon
  // target loop below when the civilian is actually weaponless. C++ does not
  // special-case armed civilians here: InfantryClass::Greatest_Threat returns
  // TARGET_NONE only when !Is_Weapon_Equipped() (infantry.cpp:2308-2311), while
  // human-controlled armed infantry merely clear THREAT_BUILDINGS
  // (infantry.cpp:2337-2341). Found via SCG04EA tick 938: a player-owned C1
  // survivor with Pistol acquires a BadGuy E1 and later fires.
  let civilianSkipScan = false;
  if (entity.isCivilian && entity.isPlayerUnit) {
    let nearestAntDist = Infinity;
    let nearestAntPos: WorldPos | null = null;
    for (const other of ctx.entities) {
      if (!other.alive || !other.isAnt) continue;
      const dist = leptonDist(entity.leptonX, entity.leptonY, other.leptonX, other.leptonY);
      if (dist < 1280 && dist < nearestAntDist) { // 5 cells * 256 leptons/cell
        nearestAntDist = dist;
        nearestAntPos = other.pos;
      }
    }
    if (nearestAntPos && !entity.moveTarget) {
      // Flee in opposite direction
      const dx = entity.pos.x - nearestAntPos.x;
      const dy = entity.pos.y - nearestAntPos.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const fleeDist = 4 * CELL_SIZE;
      const fleeX = entity.pos.x + (dx / len) * fleeDist;
      const fleeY = entity.pos.y + (dy / len) * fleeDist;
      // Clamp to map bounds
      const bx0 = ctx.map.boundsX * CELL_SIZE;
      const by0 = ctx.map.boundsY * CELL_SIZE;
      const bx1 = (ctx.map.boundsX + ctx.map.boundsW) * CELL_SIZE;
      const by1 = (ctx.map.boundsY + ctx.map.boundsH) * CELL_SIZE;
      entity.moveTarget = {
        lx: pixelToLepton(Math.max(bx0 + CELL_SIZE, Math.min(bx1 - CELL_SIZE, fleeX))),
        ly: pixelToLepton(Math.max(by0 + CELL_SIZE, Math.min(by1 - CELL_SIZE, fleeY))),
      };
      entity.mission = Mission.MOVE;
      entity.path = [];
      entity.pathIndex = 0;
      return;
    }
    // No ant threat — weaponless civilians still run Random_Animate like C++
    // Mission_Guard, but armed C1/C7 civilians must continue into the normal
    // Target_Something_Nearby scan.
    civilianSkipScan = !entity.weapon && !entity.weapon2;
  }

  // Hold fire stance: never auto-engage
  if (entity.stance === Stance.HOLD_FIRE) return;

  // Harvesters have no weapon — don't auto-engage (would chase forever)
  if (entity.type === UnitType.V_HARV) return;

  // C++ parity: spies don't auto-engage in guard mode. They only infiltrate
  // when given an explicit attack command by the player. Without this, the
  // spy auto-infiltrates the nearest enemy building on disembark, consuming
  // itself before the player/oracle can direct it.
  // Task #43: SPY must still reach Random_Animate (C++ FootClass::Mission_Guard
  // calls Random_Animate when no target found). Previously returned early here,
  // so TS SPY at SCG13EA (9,53) skipped animation RNG that WASM consumed.
  const spyPlayerSkipAutoTarget = entity.type === UnitType.I_SPY && entity.isPlayerUnit;

  // Gap #4: Auto-disguise spies near enemies
  if (entity.type === UnitType.I_SPY && entity.alive && !entity.disguisedAs && entity.isPlayerUnit) {
    for (const other of ctx.entities) {
      if (!other.alive || other.inLimbo || ctx.entitiesAllied(entity, other)) continue;
      if (leptonDist(entity.leptonX, entity.leptonY, other.leptonX, other.leptonY) <= 1024) { // 4 cells * 256 leptons/cell
        ctx.spyDisguise(entity, other);
        break;
      }
    }
  }

  // Gap #4: Dog spy detection — dogs auto-target enemy spies within 3 cells.
  // Note: the guardScanDelay check at line 671 already limits this to running
  // every scanDelay ticks, so no additional delay needed here.
  if (entity.type === 'DOG' && entity.alive) {
    for (const other of ctx.entities) {
      if (!other.alive || other.type !== UnitType.I_SPY) continue;
      if (ctx.entitiesAllied(entity, other)) continue;
      if (leptonDist(entity.leptonX, entity.leptonY, other.leptonX, other.leptonY) <= 768) { // 3 cells * 256 leptons/cell
        entity.target = other;
        entity.mission = Mission.ATTACK;
        return;
      }
    }
  }

  // C++ foot.cpp:1912-1914: cloakable human units on GUARD don't auto-target
  // This prevents phase transports and subs from breaking their own cloak.
  if (entity.isPlayerUnit && entity.stats.isCloakable) return;

  const isDog = entity.type === 'DOG';
  // C++ foot.cpp:593 — guard scan uses THREAT_RANGE → Threat_Range(0) = weapon range.
  // C++ techno.cpp:2048-2053: if Threat_Range returns 0 (no weapon), falls back to
  //   crange = max(Weapon_Range(0), Weapon_Range(1)) / ICON_LEPTON_W + 1
  // which is +1 cell (0 + 1 for weaponless units). NOT sight range.
  // Previous TS `|| sight` fallback scanned too widely for SPY/THF (no weapon),
  // causing them to find targets WASM never scans. Task #43 SCG13EA SPY (9,53)
  // at tick 43 fired Random_Animate in WASM (no target found) but auto-targeted
  // in TS (found target in sight), breaking RNG parity.
  const weaponMax = Math.max(entity.weapon?.range ?? 0, entity.weapon2?.range ?? 0);
  const weaponScanRange = weaponMax > 0 ? weaponMax : 1; // C++ +1 cell fallback
  const baseRange = entity.stats.guardRange ?? weaponScanRange;
  const scanRange = entity.stance === Stance.DEFENSIVE
    ? Math.min(baseRange, (entity.weapon?.range ?? 2) + 1)
    : baseRange;

  // ── C++ Target_Something_Nearby (techno.cpp:5251-5281) ──
  // Step 1: If existing target is still legal AND in range, KEEP IT — don't rescan.
  // C++ checks Target_Legal(TarCom) then In_Range(TarCom, primary).
  // Only if the existing target is invalid or out of range do we call Greatest_Threat.
  if (!spyPlayerSkipAutoTarget && isAssignableObjectTarget(entity.target)) {
    // C++ techno.cpp:5260-5266: check if existing target still in range (THREAT_RANGE mode)
    const selectedWeapon = selectedWeaponForTarget(ctx, entity, entity.target);
    if (selectedWeapon && entity.inRangeWith(entity.target, selectedWeapon)) {
      // Target still valid and in range — C++ keeps TarCom, skips Greatest_Threat.
      // Infantry/vehicle firing happens in the class AI pass after Mission_Guard
      // returns. For infantry that ordering matters because Commence() pops a
      // queued Scatter mission before Firing_AI can start DO_FIRE_WEAPON.
      return;
    }
    // C++ techno.cpp:5263-5264: target out of range → Assign_Target(TARGET_NONE)
    entity.target = null;
  } else {
    entity.target = null;
  }

  // C++ infantry.cpp:2295-2297: Tanya does NOT auto-fire when human-controlled.
  const tanyaSkip = entity.type === UnitType.I_TANYA && entity.house === ctx.playerHouse;

  // C++ foot.cpp:642 Mission_Guard calls Target_Something_Nearby(THREAT_RANGE)
  //   → Greatest_Threat(THREAT_RANGE) at techno.cpp:1987.
  //
  // The scan is NOT a no-op for armed regular infantry/vehicles: the subclass
  // overrides InfantryClass::Greatest_Threat (infantry.cpp:2283-2352) and
  // UnitClass::Greatest_Threat (unit.cpp:4620-4637) OR the weapon's
  // Allowed_Threats bits (weapon.cpp:317-327) into `threat` BEFORE delegating
  // to the base-class Greatest_Threat. An anti-ground primary weapon contributes
  // THREAT_INFANTRY | THREAT_VEHICLES | THREAT_BOATS | THREAT_BUILDINGS; anti-air
  // contributes THREAT_AIR. The resulting RTTI mask is non-zero, and
  // Evaluate_Object accepts matching candidates.
  //
  // Empirical confirmation (WASM fprintf traces): SCG06EA tick 62 Greek E1
  // rifleman acquires BadGuy E1 via Mission_Guard → Target_Something_Nearby →
  // Greatest_Threat → Assign_Target; SCG01EA tick 44 Greek JEEP acquires a
  // BadGuy infantry via the same path. Both are same-tick fires through
  // Firing_AI, producing the Coord_Scatter RNG the earlier "dog-only" gate
  // missed.
  //
  // Who is actually a no-op:
  //   - Human-controlled Tanya (infantry.cpp:2310-2312) — tanyaSkip below.
  //   - Player spies (TS parity: they only infiltrate on explicit order).
  //   - Civilians with no primary weapon — guardScanMask returns 0.
  //   - Unarmed harvesters / MCVs — guardScanMask returns 0.
  //
  // Dog/medic/mechanic overrides (techno.cpp:2017-2026) are folded into
  // guardScanMask.
  const isHumanControlled = entity.house === ctx.playerHouse;
  const scanMask = (tanyaSkip || spyPlayerSkipAutoTarget || civilianSkipScan)
    ? 0
    : guardScanMask(entity, isHumanControlled);
  const bestTarget = scanMask === 0
    ? null
    : cellBasedGuardScan(ctx, entity, scanRange, scanMask);
  if (bestTarget) {
    // C++ Mission_Guard calls Target_Something_Nearby → Assign_Target, then
    // the enclosing class AI runs Firing_AI once later in the same tick.
    // index.ts' Stage C/D class pass handles the follow-up fire after the
    // infantry Commence gate, preserving queued Scatter/MOVE/HUNT ordering.
    entity.target = bestTarget;
    return;
  }

  // C++ parity: structure auto-target in Mission_Guard is enabled for armed
  // non-human units whose weapon Allowed_Threats includes THREAT_BUILDINGS
  // (anti-ground weapons). Human-controlled armed infantry have BUILDING
  // cleared from the mask (infantry.cpp:2332-2334) so this block also no-ops
  // for them. Dogs/medics have organic warhead clearing BUILDING, so no-op too.
  //
  // Sub-surface weapon restriction: torpedoes can only hit naval-accessible
  // structures (sub pens, naval yards). The existing canTargetNaval filter
  // handles the entity scan above; for structures, we need a parallel guard:
  // skip the structure scan entirely for sub-surface-only weapons.
  const isSubSurfaceOnly = !!(entity.weapon?.isSubSurface && !entity.weapon2);
  if ((scanMask & RTTI.BUILDING) && entity.weapon && !isSubSurfaceOnly) {
    let bestStruct: MapStructure | null = null;
    let bestStructDist = Infinity;
    for (const s of ctx.structures) {
      if (!s.alive) continue;
      // C++ Evaluate_Object only skips ALLIED buildings.
      if (ctx.isAllied(entity.house, s.house)) continue;
      // C++ parity: BARL/BRL3 are OverlayClass (overlay), not BuildingClass.
      if (s.type === 'BARL' || s.type === 'BRL3') continue;
      // C++ techno.cpp:1610-1618: human/player-controlled units skip unarmed buildings.
      // (Guarded redundantly; for non-human mask already includes BUILDING.)
      if (entity.isPlayerUnit && !STRUCTURE_WEAPONS[s.type]) continue;
      const [fw, fh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
      const sLX = s.cx * LEPTON_SIZE + (fw * LEPTON_SIZE) / 2;
      const sLY = s.cy * LEPTON_SIZE + (fh * LEPTON_SIZE) / 2;
      const dist = leptonDist(entity.leptonX, entity.leptonY, sLX, sLY);
      if (dist > scanRange * LEPTON_SIZE) continue;
      if (dist < bestStructDist) {
        bestStructDist = dist;
        bestStruct = s;
      }
    }
    if (bestStruct) {
      entity.mission = Mission.ATTACK;
      entity.targetStructure = bestStruct;
      return;
    }
  }

  // C++ foot.cpp:594 — Random_Animate() when no target found (on scan tick).
  // Infantry consume 2-3 RNG values (IdleTimer + animation selection + optional facing).
  if (entity.isReadyToRandomAnimate()) {
    // C++ infantry.cpp:1748: IdleTimer = Random_Pick(RandomAnimateTime * TICKS_PER_MINUTE/2, RandomAnimateTime * TICKS_PER_MINUTE*2)
    // rules.ini IdleActionFrequency=.1 → fixed(.1)=25/256. C++ fixed*int: ((25*450)+128)/256=44, ((25*1800)+128)/256=176
    const saved = ScenarioRandom._sourceTag;
    ScenarioRandom._sourceTag = 30001;
    entity.idleAnimTimer = ScenarioRandom.nextInRange(44, 176);
    ScenarioRandom._sourceTag = saved;
    if (randomAnimateFraidyCatImmediateScatter(ctx, entity)) return;

    ScenarioRandom._sourceTag = 30002;
    const animPick = ScenarioRandom.nextInRange(0, 10);
    if (animPick >= 6) {
      ScenarioRandom._sourceTag = 30003;
      setInfantryPrimaryFacingFromFacingType(
        entity,
        ScenarioRandom.nextInRange(0, 7), // C++ Random_Pick(FACING_N, FACING_NW)
      );
    }
    ScenarioRandom._sourceTag = saved;
    if (animPick >= 1 && animPick <= 4) {
      if (entity.type === UnitType.I_SPY) {
        // C++ InfantryClass::Do_Action special-case (infantry.cpp:1975):
        // SPY gesture/salute requests become DO_IDLE1 + Random_Pick(0,1).
        ScenarioRandom.nextInRange(0, 1);
        entity.doing = 'idle_anim';
      } else {
        // C++ MasterDoControls: gestures and salutes (cases 1-4) are NOT interruptible.
        // idata.cpp supplies per-infantry Count (Tanya/dogs/civilians=1,
        // common combat infantry=3); MasterDoControls gesture Rate=2.
        entity.nonInterruptAnimTicks = entity.infantryGestureDurationTicks();
        entity.nonInterruptAnimSetTick = ctx.tick;
        // Phase 7B: track Doing as 'gesture' so isDoingInterruptible() blocks
        // Commence — mirrors C++ Do_Action(DO_GESTURE1/2 / DO_SALUTE1/2) all of
        // which have Interrupt=false in MasterDoControls (infantry.cpp:115-118).
        entity.doing = 'gesture';
      }
    } else if (animPick === 5 || animPick === 7 || (animPick === 0 && entity.type === UnitType.I_DOG)) {
      // C++ cases 5/7 and dog case 0 call Do_Action(DO_IDLE*).
      // Cases 8-10 only turn facing; case 8 may additionally scatter below.
      entity.doing = 'idle_anim';
    }
    randomAnimateCaseScatter(ctx, entity, animPick);
  }
}

function currentCoordArchiveOrigin(entity: Entity): { lx: number; ly: number; cell: { cx: number; cy: number } } {
  const lx = coordTargetRoundTripLepton(entity.leptonX);
  const ly = coordTargetRoundTripLepton(entity.leptonY);
  return { lx, ly, cell: { cx: Math.floor(lx / LEPTON_SIZE), cy: Math.floor(ly / LEPTON_SIZE) } };
}

function areaGuardArchiveOrigin(entity: Entity): { lx: number; ly: number; cell: { cx: number; cy: number } } {
  if (entity.archiveTargetEntity) {
    const target = entity.archiveTargetEntity;
    if (target.alive && !target.inLimbo) {
      const { lx, ly } = target.targetCoordLeptons();
      return { lx, ly, cell: { cx: Math.floor(lx / LEPTON_SIZE), cy: Math.floor(ly / LEPTON_SIZE) } };
    }
    // C++ Target_Legal(object ArchiveTarget) fails once the object dies/limbos;
    // Mission_Guard_Area then replaces ArchiveTarget with As_Target(Coord).
    entity.archiveTargetEntity = null;
    entity.archiveTarget = null;
    entity.archiveTargetLeptons = null;
    return currentCoordArchiveOrigin(entity);
  }
  if (entity.archiveTargetLeptons) {
    const { lx, ly } = entity.archiveTargetLeptons;
    return { lx, ly, cell: { cx: Math.floor(lx / LEPTON_SIZE), cy: Math.floor(ly / LEPTON_SIZE) } };
  }
  if (entity.archiveTarget) {
    const coord = cellTargetToLepton(entity.archiveTarget.cx, entity.archiveTarget.cy);
    return { ...coord, cell: { cx: entity.archiveTarget.cx, cy: entity.archiveTarget.cy } };
  }
  if (entity.guardOrigin) {
    const lx = coordTargetRoundTripLepton(pixelToLepton(entity.guardOrigin.x));
    const ly = coordTargetRoundTripLepton(pixelToLepton(entity.guardOrigin.y));
    return { lx, ly, cell: worldToCell(entity.guardOrigin.x, entity.guardOrigin.y) };
  }
  return currentCoordArchiveOrigin(entity);
}

/** Area Guard — defend spawn area, attack nearby enemies but return if straying too far */
export function updateAreaGuard(ctx: MissionAIContext, entity: Entity, timerFired = true): void {
  entity.animState = AnimState.IDLE;

  // C++ MissionClass::Timer gates when Mission_Guard_Area fires.
  // Timer and jitter handled by caller (index.ts) via entity.missionTimer.
  if (!timerFired) return;

  // C++ foot.cpp:1031-1042 distinguishes:
  //   - TarCom legal at entry: Approach_Target, fall through to dtime+Random_Pick(1,5)
  //   - TarCom not legal, scan finds target: return(1) — early exit, no Random_Pick
  //   - TarCom not legal, scan finds none: Random_Animate, fall through to dtime+Random_Pick(1,5)
  // Only the "scan just found new target" path sets timer=1 (no RNG).
  const archiveOrigin = areaGuardArchiveOrigin(entity);
  const isDog = entity.type === UnitType.I_DOG;
  // AG1: C++ foot.cpp:996-1001 — leash = Threat_Range(1)/2
  // C++ techno.cpp:4573-4581: Threat_Range(1) = min(2*weaponRange, 0x0A00=10 cells)
  // C++ foot.cpp:996: leash = Threat_Range(1)/2 = min(weaponRange, 5)
  const weaponRange = entity.weapon?.range ?? entity.stats.sight;
  const threatRange1 = Math.min(2 * weaponRange, 10); // C++ Threat_Range(1) in cells
  const leashRange = threatRange1 / 2; // min(weaponRange, 5) — C++ foot.cpp:996
  // C++ Greatest_Threat with THREAT_AREA uses Threat_Range(1) as the scan radius
  // (passed as 'range' to Evaluate_Object, which checks dist > range).
  const scanRange = threatRange1;

  // C++ foot.cpp:1049-1077 stores ArchiveTarget as a TARGET and later converts
  // it back through As_Coord before leash checks, pathing, and THREAT_AREA
  // scans. That coordinate target round-trip is lossy at 16-lepton precision.
  const originLX = archiveOrigin.lx;
  const originLY = archiveOrigin.ly;
  const distFromOrigin = leptonDist(entity.leptonX, entity.leptonY, originLX, originLY);
  const ec = entity.cell;

  // C++ foot.cpp:1072-1075: if the guard has strayed, clear TarCom and assign
  // NavCom to ArchiveTarget, then continue into the normal TarCom scan below.
  // Do not scan from the current position while returning; C++ scans from
  // ArchiveTarget after temporarily swapping Coord.
  if (!entity.firePrepActive && !entity.isFiringAnim && !entity.moveTarget &&
      distFromOrigin > leashRange * LEPTON_SIZE) {
    entity.target = null;
    entity.targetStructure = null;
    entity.moveTarget = { lx: originLX, ly: originLY };
    entity.path = findPath(ctx.map, ec, archiveOrigin.cell, true, entity.isNavalUnit, entity.stats.speedClass);
    entity.pathIndex = 0;
    entity.animState = AnimState.WALK;
  }

  if (entity.target?.alive || entity.targetStructure?.alive) {
    // C++ foot.cpp:1086-1088 — legal TarCom at entry takes the Approach_Target
    // branch and then falls through to the caller's dtime + Random_Pick(1,5).
    if (entity.target?.alive && !entity.inRange(entity.target) && ctx.approachTarget && !entity.moveTarget) {
      ctx.approachTarget(entity);
    }
    return;
  }

  // A5: Look for enemies within scan range from HOME position.
  // C++ foot.cpp:1073-1077 temporarily swaps Coord to ArchiveTarget, then calls
  // Target_Something_Nearby(THREAT_AREA). That funnels through the same
  // TechnoClass::Greatest_Threat cell-ring scan as Mission_Guard, not a
  // score-sorted all-entity loop.
  const isHumanControlled = entity.house === ctx.playerHouse;
  const scanMask = guardScanMask(entity, isHumanControlled);
  const bestTarget = scanMask === 0
    ? null
    : cellBasedGuardScan(ctx, entity, scanRange, scanMask, {
      mode: 'area',
      sourceLX: originLX,
      sourceLY: originLY,
    });

  if (bestTarget) {
    entity.target = bestTarget;
    // C++ foot.cpp:1077-1084: when Target_Something_Nearby finds a new TarCom,
    // Mission_Guard_Area returns 1 immediately. The enclosing InfantryClass::AI
    // still runs Firing_AI later in the same object AI pass (infantry.cpp:1237),
    // so an in-range newly acquired target starts its DO_FIRE animation
    // immediately. It does not call Approach_Target until the next timer fire,
    // when TarCom is legal at entry.
    entity.missionTimer = 1;
    if (entity.stats.isInfantry &&
        entity.weapon &&
        entity.suppressFiringAITick !== ctx.tick &&
        entity.attackCooldown <= 0 &&
        entity.inRange(bestTarget)) {
      entity.mission = Mission.ATTACK;
      updateAttack(ctx, entity);
      if ((entity.mission as Mission) === Mission.ATTACK) {
        entity.mission = Mission.AREA_GUARD;
      }
    }
    return;
  }

  // C++ Greatest_Threat also scans buildings at each cell (via Evaluate_Cell).
  // Add structure scan matching the GUARD handler's M4 scan.
  if (entity.weapon) {
    let bestStruct: MapStructure | null = null;
    let bestStructDist = Infinity;
    for (const s of ctx.structures) {
      if (!s.alive) continue;
      if (ctx.isAllied(entity.house, s.house)) continue;
      if (s.type === 'BARL' || s.type === 'BRL3') continue; // C++ OverlayClass, not BuildingClass
      if (entity.isPlayerUnit && !STRUCTURE_WEAPONS[s.type]) continue;
      // C++ Center_Coord: cell origin + half footprint. 1x1 buildings = +128, 2x2 = +256.
      const [fw, fh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
      const sLX = s.cx * LEPTON_SIZE + (fw * LEPTON_SIZE) / 2;
      const sLY = s.cy * LEPTON_SIZE + (fh * LEPTON_SIZE) / 2;
      const dist = leptonDist(originLX, originLY, sLX, sLY);
      if (dist > scanRange * LEPTON_SIZE) continue;
      if (dist < bestStructDist) {
        bestStructDist = dist;
        bestStruct = s;
      }
    }
    if (bestStruct) {
      // C++ parity: stay AREA_GUARD, set target. Newly-acquired target uses
      // timer=1 and does not approach until the next timer fire.
      entity.targetStructure = bestStruct;
      entity.missionTimer = 1;
      return;
    }
  }

  // C++ foot.cpp:1081 — Random_Animate when no target found.
  // Mirrors infantry.cpp:1742-1838 exactly for gameplay RNG:
  //   30001 IdleTimer, 30002 switch, 30003 facing cases.
  // Only switch cases 1-5 and 7 call Do_Action; facing-only cases leave Doing
  // unchanged. SPY gesture/salute requests are remapped by Do_Action and consume
  // Random_Pick(0,1) under the caller's saved logic-layer tag.
  if (entity.isReadyToRandomAnimate()) {
    const saved = ScenarioRandom._sourceTag;
    ScenarioRandom._sourceTag = 30001;
    entity.idleAnimTimer = ScenarioRandom.nextInRange(44, 176);
    ScenarioRandom._sourceTag = saved;
    if (randomAnimateFraidyCatImmediateScatter(ctx, entity)) return;

    ScenarioRandom._sourceTag = 30002;
    const animPick = ScenarioRandom.nextInRange(0, 10);
    ScenarioRandom._sourceTag = saved;

    if (animPick >= 1 && animPick <= 4) {
      if (entity.type === UnitType.I_SPY) {
        // C++ Do_Action: SPY gestures/salutes are remapped to DO_IDLE1/2,
        // consuming Random_Pick(0,1) under the caller's source tag.
        ScenarioRandom.nextInRange(0, 1);
        entity.doing = 'idle_anim';
      } else {
        entity.nonInterruptAnimTicks = entity.infantryGestureDurationTicks();
        entity.nonInterruptAnimSetTick = ctx.tick;
        // Phase 7B: gestures/salutes are non-interruptible per C++ MasterDoControls.
        entity.doing = 'gesture';
      }
    } else if (animPick === 5 || animPick === 7 || (animPick === 0 && entity.type === UnitType.I_DOG)) {
      entity.doing = 'idle_anim';
    }

    if (animPick >= 6) {
      ScenarioRandom._sourceTag = 30003;
      setInfantryPrimaryFacingFromFacingType(entity, ScenarioRandom.nextInRange(0, 7));
      ScenarioRandom._sourceTag = saved;
    }
    randomAnimateCaseScatter(ctx, entity, animPick);
  }
}

/** AI1: RETREAT mission — move to nearest map edge and exit the map (C++ foot.cpp) */
export function updateRetreat(ctx: MissionAIContext, entity: Entity): void {
  // If already at a move target, continue moving
  if (entity.moveTarget) {
    entity.animState = AnimState.WALK;
    const arrived = entity.moveToward(entity.moveTarget, ctx.movementSpeed(entity));
    if (arrived) {
      // Reached map edge — remove entity
      entity.alive = false;
      entity.mission = Mission.DIE;
    }
    return;
  }
  // Find nearest map edge
  const ec = entity.cell;
  const distLeft = ec.cx - ctx.map.boundsX;
  const distRight = (ctx.map.boundsX + ctx.map.boundsW - 1) - ec.cx;
  const distTop = ec.cy - ctx.map.boundsY;
  const distBottom = (ctx.map.boundsY + ctx.map.boundsH - 1) - ec.cy;
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);
  let tx = ec.cx, ty = ec.cy;
  if (minDist === distLeft) tx = ctx.map.boundsX;
  else if (minDist === distRight) tx = ctx.map.boundsX + ctx.map.boundsW - 1;
  else if (minDist === distTop) ty = ctx.map.boundsY;
  else ty = ctx.map.boundsY + ctx.map.boundsH - 1;
  entity.moveTarget = { lx: tx * 256 + 128, ly: ty * 256 + 128 };
  entity.path = findPath(ctx.map, ec, { cx: tx, cy: ty }, true, entity.isNavalUnit, entity.stats.speedClass);
  entity.pathIndex = 0;
}

/** C++ parity: transport auto-evacuates when a civilian/VIP boards.
 *  SCG01EA: after Einstein enters the Chinook, it flies to the nearest map edge
 *  to trigger TEVENT_EVAC_CIVILIAN and win the mission. Clears team missions so
 *  the LOOP script doesn't interfere with the player-triggered evacuation. */
export function orderTransportEvacuate(ctx: MissionAIContext, transport: Entity): void {
  // Compute nearest map edge exit point (one cell outside bounds for exit detection)
  const ec = transport.cell;
  const distLeft = ec.cx - ctx.map.boundsX;
  const distRight = (ctx.map.boundsX + ctx.map.boundsW - 1) - ec.cx;
  const distTop = ec.cy - ctx.map.boundsY;
  const distBottom = (ctx.map.boundsY + ctx.map.boundsH - 1) - ec.cy;
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);
  let tx = ec.cx, ty = ec.cy;
  // Target one cell OUTSIDE the bounds so the exit-map check triggers
  if (minDist === distLeft) tx = ctx.map.boundsX - 1;
  else if (minDist === distRight) tx = ctx.map.boundsX + ctx.map.boundsW;
  else if (minDist === distTop) ty = ctx.map.boundsY - 1;
  else ty = ctx.map.boundsY + ctx.map.boundsH;

  // Clear team missions so LOOP scripts don't override the evacuation order
  transport.teamMissions = [];
  transport.teamMissionIndex = 0;
  transport.mission = Mission.MOVE;
  transport.moveTarget = { lx: tx * 256 + 128, ly: ty * 256 + 128 };
  transport.target = null;
  transport.moveQueue = [];
  // Aircraft: ensure takeoff if landed
  if (transport.aircraftState === 'landed') {
    transport.aircraftState = 'takeoff';
  } else if (transport.aircraftState === 'returning' || transport.aircraftState === 'landing') {
    transport.aircraftState = 'flying';
  }
}

/** AI1: AMBUSH mission — sleep until enemy enters sight range, then HUNT */
export function updateAmbush(ctx: MissionAIContext, entity: Entity): void {
  entity.animState = AnimState.IDLE;
  // Scan for enemies within sight range
  const scanDelay = entity.stats.scanDelay ?? 22; // C++ Normal_Delay = 22 ticks
  if (ctx.tick - entity.lastGuardScan < scanDelay) return;
  entity.lastGuardScan = ctx.tick;
  const ec = entity.cell;
  for (const other of ctx.entities) {
    if (!other.alive || other.inLimbo || ctx.entitiesAllied(entity, other)) continue;
    if (!isInCppGroundThreatLayer(other)) continue;
    // C++ parity: spies invisible to non-dogs (techno.cpp:1554-1564)
    if (other.type === UnitType.I_SPY && entity.type !== UnitType.I_DOG) continue;
    if (leptonDist(entity.leptonX, entity.leptonY, other.leptonX, other.leptonY) > entity.stats.sight * LEPTON_SIZE) continue;
    const oc = other.cell;
    if (!ctx.map.hasLineOfSight(ec.cx, ec.cy, oc.cx, oc.cy)) continue;
    // Enemy spotted — switch to HUNT
    entity.mission = Mission.HUNT;
    entity.target = other;
    return;
  }
}

/** AI1: REPAIR mission — seek nearest FIX (Service Depot) and move to it */
export function updateRepairMission(ctx: MissionAIContext, entity: Entity): void {
  // If already moving to a target, continue
  if (entity.moveTarget) {
    entity.animState = AnimState.WALK;
    const arrived = entity.moveToward(entity.moveTarget, ctx.movementSpeed(entity));
    if (arrived) {
      // Reached depot — switch to guard (depot auto-repair handles the rest)
      entity.mission = Mission.GUARD;
      entity.moveTarget = null;
    }
    return;
  }
  // Find nearest FIX structure
  let bestDist = Infinity;
  let bestLPos: { lx: number; ly: number; cx: number; cy: number } | null = null;
  for (const s of ctx.structures) {
    if (!s.alive || s.type !== 'FIX') continue;
    if (!ctx.isAllied(s.house, entity.house)) continue;
    const sLX = s.cx * LEPTON_SIZE + LEPTON_SIZE;
    const sLY = s.cy * LEPTON_SIZE + LEPTON_SIZE;
    const d = leptonDist(entity.leptonX, entity.leptonY, sLX, sLY);
    if (d < bestDist) { bestDist = d; bestLPos = { lx: sLX, ly: sLY, cx: s.cx + 1, cy: s.cy + 1 }; }
  }
  if (bestLPos) {
    entity.moveTarget = { lx: bestLPos.lx, ly: bestLPos.ly };
    entity.path = findPath(ctx.map, entity.cell, { cx: bestLPos.cx, cy: bestLPos.cy }, true, entity.isNavalUnit, entity.stats.speedClass);
    entity.pathIndex = 0;
  } else {
    // No depot found — fall back to guard
    entity.mission = Mission.GUARD;
  }
}

/** Attack a structure (building) — engineers capture instead */
export function updateAttackStructure(ctx: MissionAIContext, entity: Entity, s: MapStructure): void {
  const structPos = structureTargetWorld(s);
  const structTarget = structureTargetLeptons(s);
  const structLX = structTarget.lx;
  const structLY = structTarget.ly;
  const dist = leptonDist(entity.leptonX, entity.leptonY, structLX, structLY);
  // C++ parity: spies infiltrate from adjacent cells (building edge), not center.
  // Buildings are 2x2 or 3x2 cells, so the edge can be 2-3 cells from center.
  // Unarmed units (spies, engineers) need range 4 to reach from adjacent cells.
  const range = entity.weapon?.range ?? 2;
  const rangeLeptons = range * LEPTON_SIZE + (entity.weapon ? structureRangeBonusLeptons(s) : 0);

  // Minimum range check: artillery can't fire at point-blank structures
  if (entity.weapon?.minRange && dist < entity.weapon.minRange * LEPTON_SIZE) {
    ctx.retreatFromTarget(entity, structPos);
    return;
  }

  if (dist <= rangeLeptons) {
    // Engineer capture/damage (C++ infantry.cpp:598-637 — any house's engineer, not just player)
    if (entity.type === UnitType.I_E6) {
      // EN1: Friendly repair — C++ always takes Renovate() branch for allies (infantry.cpp:606-611)
      // Renovate() on a full-health building is a harmless no-op. Engineer is consumed.
      if (ctx.isAllied(s.house, entity.house)) {
        s.hp = s.maxHp;
        // Engineer consumed on repair
        entity.alive = false;
        entity.mission = Mission.DIE;
        entity.targetStructure = null;
        ctx.playSound('repair');
        ctx.effects.push({
          type: 'explosion', x: structPos.x, y: structPos.y,
          frame: 0, maxFrames: 10, size: 8, sprite: 'piffpiff', spriteStart: 0,
        } as Effect);
        ctx.evaMessages.push({ text: 'BUILDING REPAIRED', tick: ctx.tick });
        return;
      }
      // Enemy capture/damage (existing logic below)
      // C++ infantry.cpp:614-618: only buildings with IsCaptureable (Capturable=yes in rules.ini) can be captured
      // C++ uses fixed-point: fixed(hp, maxHp) <= fixed(ConditionRed)
      const isCapturable = CAPTURABLE_BUILDINGS.has(s.type);
      if (isCapturable && Math.floor(s.hp * 256 / s.maxHp) <= Math.floor(CONDITION_RED * 256)) {
        // Capture: building at red health — convert to engineer's house
        // C++ building.cpp:2936: Captured() changes ownership but does NOT restore HP
        // C++ building.cpp:3509: track original house for survivor halving on sell
        if (!s.originalHouse) s.originalHouse = s.house;
        s.house = entity.house;
        ctx.playEva('eva_building_captured');
      } else {
        // Damage: deal MaxStrength/3 (capped to Strength-1) (C++ infantry.cpp:631)
        const engDamage = Math.min(Math.floor(s.maxHp / 3), s.hp - 1);
        if (engDamage > 0) s.hp -= engDamage;
      }
      // Kill the engineer (consumed either way)
      entity.alive = false;
      entity.mission = Mission.DIE;
      entity.targetStructure = null;
      ctx.playSound('eva_acknowledged');
      // Flash effect
      ctx.effects.push({
        type: 'explosion', x: structPos.x, y: structPos.y,
        frame: 0, maxFrames: 10, size: 10, sprite: 'piffpiff', spriteStart: 0,
      } as Effect);
      return;
    }

    // Spy infiltration: spy enters enemy building for special effects
    if (entity.type === UnitType.I_SPY && entity.isPlayerUnit) {
      if (!ctx.isAllied(s.house, ctx.playerHouse)) {
        ctx.spyInfiltrate(entity, s);
        return;
      }
    }

    // CHAN nest-gas: consume specialist, destroy LAR1/LAR2 nest (SCA03EA mechanic)
    if (entity.type === UnitType.I_CHAN && (s.type === 'LAR1' || s.type === 'LAR2')) {
      // Consume the CHAN specialist
      entity.alive = false;
      entity.mission = Mission.DIE;
      entity.targetStructure = null;
      // Destroy the nest
      ctx.damageStructure(s, s.maxHp + 1);
      ctx.killCount++;
      ctx.playSound('eva_acknowledged');
      // Green gas cloud effect — multiple expanding puffs
      for (let i = 0; i < 5; i++) {
        const ox = (ScenarioRandom.float() - 0.5) * 20;
        const oy = (ScenarioRandom.float() - 0.5) * 20;
        ctx.effects.push({
          type: 'explosion', x: structPos.x + ox, y: structPos.y + oy,
          frame: 0, maxFrames: 14, size: 10 + i * 2,
          sprite: 'smokey', spriteStart: 0,
        } as Effect);
      }
      return;
    }

    // Tanya C4: plants C4 on structure instead of shooting it
    if (entity.type === UnitType.I_TANYA) {
      ctx.updateTanyaC4(entity);
      return;
    }

    // Thief: steals credits from enemy PROC/SILO
    if (entity.type === UnitType.I_THF) {
      ctx.updateThief(entity);
      return;
    }

    entity.desiredFacing = directionTo(entity.pos, structPos);
    entity.desiredFacing256 = (entity.desiredFacing * 32) & 0xff;
    entity.tickRotation();
    if (entity.stats.noMovingFire && entity.facing !== entity.desiredFacing) {
      entity.animState = AnimState.IDLE;
      return;
    }
    entity.animState = AnimState.ATTACK;
    if (entity.attackCooldown <= 0 && entity.weapon) {
      // C++ TechnoClass::Can_Fire returns FIRE_AMMO before Fire_At.
      if (entity.ammo === 0) return;

      let fireAtFacing256 = -1;
      if (entity.stats.isInfantry) {
        const fireLaunch = entity.isProne
          ? infantryProneLaunch(entity.type)
          : infantryFireLaunch(entity.type);
        if (!entity.firePrepActive) {
          entity.firePrepActive = true;
          entity.firePrepStage = 0;
          const startedFireDoing = entity.startFireDoing(ctx.tick);
          entity.firePrepUsesDoingStage = startedFireDoing || entity.doingRate > 0;
          entity.firePrepFacing256 = entity.bodyFacing256 >= 0
            ? entity.bodyFacing256 & 0xFF
            : (entity.facing * 32) & 0xFF;
        }
        const prepStage = entity.firePrepUsesDoingStage ? entity.doingStage : entity.firePrepStage;
        if (prepStage < fireLaunch) {
          return;
        }
        fireAtFacing256 = entity.firePrepFacing256;
        entity.firePrepActive = false;
        entity.firePrepStage = 0;
        entity.firePrepUsesDoingStage = false;
      }

      // C++ parity: use warhead-vs-armor lookup for instant damage. Projectile
      // weapons pass raw bullet strength and apply armor/distance on detonation.
      const wh = entity.weapon.warhead as WarheadType;
      const mult = ctx.getWarheadMult(wh, 'concrete');
      const structHouseBias = ctx.getFirepowerBias(entity.house);
      const damage = mult <= 0 ? 0 : Math.max(1, Math.round(entity.weapon.damage * mult * structHouseBias));
      const projectileWeapon = entity.weapon.projSpeed !== undefined || entity.weapon.projectileSpeed !== undefined;
      const fireCoord = fireCoordForWeaponAtLatchedFacing(entity, entity.weapon, fireAtFacing256);
      if (fireAtFacing256 >= 0) entity.firePrepFacing256 = -1;
      let destroyed = false;
      ctx.revealShooterFromFire?.(entity);
      if (projectileWeapon) {
        const projStrength = Math.max(1, Math.round(entity.weapon.damage * structHouseBias));
        ctx.launchProjectile(
          entity, null, entity.weapon, projStrength,
          structPos.x, structPos.y, true,
          fireCoord,
        );
      } else {
        destroyed = ctx.damageStructure(s, damage);
      }
      // C++ house.cpp:293,303: ROFBias scales rearm delay
      entity.attackCooldown = Math.max(1, Math.round(entity.weapon.rof * ctx.getROFBias(entity.house)));
      if (entity.hasTurret) entity.isInRecoilState = true; // M6
      // C++ infantry.cpp:1190-1195: IsFiring stays true for the fire animation duration.
      // Infantry DO_FIRE_WEAPON animation: typically 4-8 frames at rate ~2.
      // Use 8 ticks as a conservative estimate matching most infantry fire animations.
      if (entity.stats.isInfantry) {
        entity.isFiringAnim = true;
        // E1 DO_FIRE_WEAPON: 8 frames at Rate=1 = 8 ticks, +1 tick for Doing_AI
        // transition to DO_STAND_READY (Rate=0) which clears IsFiring.
        // idata.cpp E1DoControls: DO_FIRE_WEAPON = {64, 8, 8} (Count=8).
        entity.firingAnimTicks = 9;
      }
      consumeAmmoAfterSuccessfulFire(entity);
      ctx.playSoundAt(ctx.weaponSound(entity.weapon.name), entity.pos.x, entity.pos.y);
      // Muzzle + impact effects (color by warhead — C++ parity)
      ctx.effects.push({
        type: 'muzzle', x: entity.pos.x, y: entity.pos.y,
        frame: 0, maxFrames: 4, size: 5, sprite: 'piff', spriteStart: 0,
        muzzleColor: ctx.warheadMuzzleColor(entity.weapon.warhead),
      } as Effect);
      if (projectileWeapon) {
        const projStyle = ctx.weaponProjectileStyle(entity.weapon.name);
        const projCfg = projectileVisualConfig(entity.weapon.name);
        const projectileDist = leptonDist(entity.leptonX, entity.leptonY, structLX, structLY);
        if (projStyle !== 'bullet' || projectileDist > 512) {
          const projDistPx = Math.sqrt((structPos.x - entity.pos.x) ** 2 + (structPos.y - entity.pos.y) ** 2);
          const travelFrames = calcProjectileTravelFrames(projDistPx, entity.weapon.projSpeed);
          ctx.effects.push({
            type: 'projectile', x: entity.pos.x, y: entity.pos.y,
            frame: 0, maxFrames: travelFrames, size: 3,
            startX: entity.pos.x, startY: entity.pos.y,
            endX: structPos.x, endY: structPos.y,
            projStyle, ...projCfg,
          } as Effect);
        }
      } else {
        // R8: Impact explosion sprite via C++ Combat_Anim — damage-scaled selection
        const structAttackExpSet = ctx.getWarheadProps(entity.weapon.warhead)?.explosionSet ?? 0;
        const structImpactSprite = combatAnim(entity.weapon.damage, structAttackExpSet, 'ground');
        if (structImpactSprite) {
          ctx.effects.push({
            type: 'explosion', x: structPos.x, y: structPos.y,
            frame: 0, maxFrames: EXPLOSION_FRAMES[structImpactSprite] ?? 17, size: 8,
            sprite: structImpactSprite, spriteStart: 0,
          } as Effect);
          spawnLogicAnimForSprite(ctx.logicAnims, ctx.effects, structImpactSprite, structPos.x, structPos.y);
        }
        if (destroyed) {
          if (ctx.isPlayerControlled(entity)) ctx.killCount++;
        }
      }
      // Out of ammo — stop attacking (C++ parity: unit must rearm at service depot)
      if (entity.ammo === 0 && entity.maxAmmo > 0 && !entity.isAirUnit) {
        entity.targetStructure = null;
        entity.mission = Mission.GUARD;
        entity.animState = AnimState.IDLE;
        return;
      }
    }
  } else {
    entity.animState = AnimState.WALK;
    // Follow A* path if available (set by harness attack_struct). This routes
    // around buildings instead of moveToward's straight line which gets stuck.
    if (entity.path && entity.path.length > 0 && entity.pathIndex < entity.path.length) {
      const nextCell = entity.path[entity.pathIndex];
      const wp = {
        lx: nextCell.cx * 256 + 128,
        ly: nextCell.cy * 256 + 128,
      };
      if (entity.moveToward(wp, ctx.movementSpeed(entity))) {
        entity.pathIndex++;
      }
    } else {
      entity.moveToward({ lx: pixelToLepton(structPos.x), ly: pixelToLepton(structPos.y) }, ctx.movementSpeed(entity));
    }
  }
  // Cooldown decrement handled at index.ts:3814 (per-tick, all entities).
}

/** Force-fire on ground — fire at a location with no target entity */
export function updateForceFireGround(ctx: MissionAIContext, entity: Entity): void {
  const target = entity.forceFirePos!;
  const dist = leptonDist(entity.leptonX, entity.leptonY, pixelToLepton(target.x), pixelToLepton(target.y));
  const range = entity.weapon?.range ?? 2;

  if (dist <= range * LEPTON_SIZE) {
    entity.desiredFacing = directionTo(entity.pos, target);
    entity.desiredFacing256 = (entity.desiredFacing * 32) & 0xff;
    const facingReady = entity.tickRotation();
    if (entity.stats.noMovingFire && !facingReady) {
      entity.animState = AnimState.IDLE;
      return;
    }
    entity.animState = AnimState.ATTACK;

    if (entity.attackCooldown <= 0 && entity.weapon) {
      // C++ TechnoClass::Can_Fire returns FIRE_AMMO before Fire_At.
      if (entity.ammo === 0) return;
      // C++ house.cpp:293,303: ROFBias scales rearm delay
      entity.attackCooldown = Math.max(1, Math.round(entity.weapon.rof * ctx.getROFBias(entity.house)));
      if (entity.hasTurret) entity.isInRecoilState = true; // M6
      // C++ infantry.cpp:3609: IsFiring = true during weapon fire animation
      if (entity.stats.isInfantry) {
        entity.isFiringAnim = true;
        // E1 DO_FIRE_WEAPON: 8 frames at Rate=1 = 8 ticks, +1 tick for Doing_AI
        // transition to DO_STAND_READY (Rate=0) which clears IsFiring.
        // idata.cpp E1DoControls: DO_FIRE_WEAPON = {64, 8, 8} (Count=8).
        entity.firingAnimTicks = 9;
      }
      consumeAmmoAfterSuccessfulFire(entity);

      // Apply scatter
      let impactX = target.x;
      let impactY = target.y;
      if (entity.weapon.inaccuracy && entity.weapon.inaccuracy > 0) {
        const scatter = entity.weapon.inaccuracy * CELL_SIZE;
        const angle = ScenarioRandom.float() * Math.PI * 2;
        const d = ScenarioRandom.float() * scatter;
        impactX += Math.cos(angle) * d;
        impactY += Math.sin(angle) * d;
      }

      // Splash damage at impact
      if (entity.weapon.splash && entity.weapon.splash > 0) {
        ctx.applySplashDamage(
          { x: impactX, y: impactY }, entity.weapon, -1,
          entity.house, entity,
        );
      }

      // Weapon sound + effects (spatially positioned)
      ctx.playSoundAt(ctx.weaponSound(entity.weapon.name), entity.pos.x, entity.pos.y);
      const sx = entity.pos.x;
      const sy = entity.pos.y;
      ctx.effects.push({
        type: 'muzzle', x: sx, y: sy,
        frame: 0, maxFrames: 4, size: 5, sprite: 'piff', spriteStart: 0,
        muzzleColor: ctx.warheadMuzzleColor(entity.weapon.warhead),
      } as Effect);
      const projStyle = ctx.weaponProjectileStyle(entity.weapon.name);
      const ffProjCfg = projectileVisualConfig(entity.weapon.name);
      // Per-weapon projectile speed: compute travel frames from distance and projSpeed
      const ffDistPx = Math.sqrt((impactX - sx) ** 2 + (impactY - sy) ** 2);
      const travelFrames = calcProjectileTravelFrames(ffDistPx, entity.weapon.projSpeed);
      ctx.effects.push({
        type: 'projectile', x: sx, y: sy, frame: 0, maxFrames: travelFrames, size: 3,
        startX: sx, startY: sy, endX: impactX, endY: impactY, projStyle,
        ...ffProjCfg,
      } as Effect);
      // R8: Impact explosion sprite via C++ Combat_Anim — damage-scaled selection
      const ffExpSet = ctx.getWarheadProps(entity.weapon.warhead)?.explosionSet ?? 0;
      const ffCell = worldToCell(impactX, impactY);
      const ffLand: 'ground' | 'water' | 'air' =
        (ctx.map.getTerrain(ffCell.cx, ffCell.cy) === Terrain.WATER) ? 'water' : 'ground';
      const ffImpactSprite = combatAnim(entity.weapon.damage, ffExpSet, ffLand);
      if (ffImpactSprite) {
        ctx.effects.push({
          type: 'explosion', x: impactX, y: impactY,
          frame: 0, maxFrames: EXPLOSION_FRAMES[ffImpactSprite] ?? 17, size: 8, sprite: ffImpactSprite, spriteStart: 0,
        } as Effect);
        if (!entity.weapon.projectileSpeed) {
          spawnLogicAnimForSprite(ctx.logicAnims, ctx.effects, ffImpactSprite, impactX, impactY);
        }
      }
      const tc = worldToCell(impactX, impactY);
      ctx.map.addDecal(tc.cx, tc.cy, 3, 0.3);
      // Out of ammo — stop attacking (C++ parity: unit must rearm at service depot)
      if (entity.ammo === 0 && entity.maxAmmo > 0 && !entity.isAirUnit) {
        entity.target = null;
        entity.mission = Mission.GUARD;
        entity.animState = AnimState.IDLE;
        return;
      }
    }
  } else {
    entity.animState = AnimState.WALK;
    entity.moveToward({ lx: pixelToLepton(target.x), ly: pixelToLepton(target.y) }, ctx.movementSpeed(entity));
  }
  // Cooldown decrement handled at index.ts:3814 (per-tick, all entities).
}
