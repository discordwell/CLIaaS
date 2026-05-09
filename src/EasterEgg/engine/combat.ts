/**
 * Combat subsystem — damage calculation, projectiles, splash, and unit death.
 * Extracted from Game class (index.ts) to isolate combat logic.
 */

import {
  type WorldPos, type WeaponStats, type ArmorType, type WarheadType,
  type WarheadMeta, type WarheadProps,
  CELL_SIZE, LEPTON_SIZE, MAP_CELLS, CONDITION_YELLOW, RULE_GRAVITY,
  WARHEAD_VS_ARMOR, WARHEAD_PROPS, WARHEAD_META, WEAPON_STATS,
  armorIndex, leptonDist, pixelToLepton, worldToCell, cellTargetToLepton, modifyDamage,
  directionTo, directionToLeptons, directionToLeptons256, calcProjectileTravelFrames, projectileVisualConfig,
  House, Mission, AnimState, UnitType, EXPLOSION_FRAMES,
  DIR_DX, DIR_DY, DIR_COUNT, MISSION_CONTROL, COS_TABLE_256, SIN_TABLE_256,
  HOUSE_FACTION, PRONE_DAMAGE_BIAS,
} from './types';
import { Entity, CloakState, CLOAK_TRANSITION_FRAMES } from './entity';
import { type MapStructure, type StructureWeapon, STRUCTURE_SIZE, STRUCTURE_POWERED, STRUCTURE_WEAPONS, STRUCTURE_ARMOR, CREWED_BUILDINGS } from './scenario';
import { PRODUCTION_ITEMS } from './types';
import { type Effect } from './renderer';
import { type GameMap, type MapTree, Terrain, TREE_CENTER_OFFSET } from './map';
import { canTargetNaval } from './aircraft';
import { AI_BUILD_RULES } from './ai';
import { ScenarioRandom, NonCriticalRandom } from './random';
import { assignMission } from './missionLifecycle';
import { type LogicAnim, spawnLogicAnim, spawnLogicAnimForSprite } from './logicAnim';

// ── Constants ──────────────────────────────────────────────────────────────────

/** CF3: Universal 1.5-cell splash radius (C++ Explosion_Damage uses ICON_LEPTON_W + ICON_LEPTON_W/2) */
export const SPLASH_RADIUS = 1.5;

const WALL_TYPES = new Set(['SBAG', 'FENC', 'BARB', 'BRIK', 'WOOD', 'CYCL']);
const WALL_DAMAGE_POINTS: Record<string, number> = {
  SBAG: 20, // odata.cpp Sandbag DamagePoints
  CYCL: 10, // Cyclone fence
  BRIK: 70, // Brick wall
  BARB: 2,  // Barbwire
  WOOD: 2,  // Wood wall
  FENC: 10, // Fence
};
const WALL_DAMAGE_LEVELS: Record<string, number> = {
  SBAG: 1,
  CYCL: 2,
  BRIK: 3,
  BARB: 1,
  WOOD: 1,
  FENC: 2,
};
const WOODEN_WALL_TYPES = new Set(['WOOD']);
const CELL_CENTER_LEPTON = LEPTON_SIZE >> 1;
const TORPEDO_CENTER_HIT_RADIUS = Math.trunc(LEPTON_SIZE / 3);
const PIXEL_LEPTON_W = Math.trunc(LEPTON_SIZE / CELL_SIZE);
const LIGHT_SPEED = 255;

/** C++ ini.cpp Get_MPHType: rules.ini Speed= is a percentage of 256
 *  leptons/tick, clamped at MPH_LIGHT_SPEED (255). Example: TorpTube
 *  Speed=15 becomes MaxSpeed=38, matching BulletClass::MaxSpeed in WASM. */
function iniSpeedToMph(rawSpeed: number): number {
  return Math.max(1, Math.min(LIGHT_SPEED, Math.trunc((rawSpeed * LEPTON_SIZE) / 100)));
}

/** Turreted structure types — turret rotates to face target (GUN/SAM/AGUN)
 *  C++ bdata.cpp:571 (GUN), bdata.cpp:601 (AGUN), bdata.cpp:901 (SAM) — IsTurretEquipped=true */
const TURRETED_STRUCTURES = new Set(['GUN', 'SAM', 'AGUN']);

/**
 * C++ bdata.cpp per-building default turret facings (8-dir, derived from DirType / 32):
 *   GUN:  DirType(208) → 208/32 = 6 (West)     — bdata.cpp:594
 *   SAM:  DIR_N (0)    → 0/32   = 0 (North)     — bdata.cpp:924
 *   AGUN: DIR_NE (32)  → 32/32  = 1 (NorthEast) — bdata.cpp:624
 */
const TURRET_DEFAULT_FACING: Record<string, number> = {
  GUN: 6,   // West  (DirType 208)
  SAM: 0,   // North (DIR_N)
  AGUN: 1,  // NE    (DIR_NE)
};

/** C++ rules.ini ROT=5 for all turreted buildings (GUN, SAM, AGUN).
 *  Used in Rotation_AI (building.cpp:5347-5363) via FacingClass::Rotation_Adjust(ROT).
 *  C++ 256-step DirType / 32-step visual = 8 accumulator units per visual step.
 *  ROT=5 means 90-degree rotation (8 steps) takes ceil(8 * 8/5) = 13 ticks, matching C++. */
const STRUCTURE_TURRET_ROT = 5;

// ── Interfaces ─────────────────────────────────────────────────────────────────

/** In-flight projectile for deferred damage */
export interface InflightProjectile {
  attackerId: number;
  attackerHouse?: House;  // structure-fired bullets have no Entity Payback in TS
  targetId: number;
  weapon: WeaponStats;
  damage: number;
  strength: number;      // C++ bullet.cpp:478-480 — current damage, decremented each tick if isDegenerate (min 5)
  speed: number;         // cells per tick
  travelFrames: number;  // total frames to travel
  currentFrame: number;
  directHit: boolean;    // was the shot accurate (for inaccurate weapons)
  impactX: number;       // final impact position (may be scattered)
  impactY: number;
  attackerIsPlayer: boolean;
  // Ballistic arc fields (C++ bullet.cpp:783-789, object.cpp:237-254)
  isArcing: boolean;     // true if weapon has ballistic arc trajectory
  arcHeight: number;     // current vertical position (leptons); starts at 1 for arcing
  arcRiser: number;      // vertical velocity; decremented by RULE_GRAVITY each tick
  // C++ bullet.cpp:903-913 — wall collision fields
  startX: number;        // origin X position (attacker pos at launch)
  startY: number;        // origin Y position (attacker pos at launch)
  // C++ bullet.cpp:96-175 — dog-rides-bullet: dog entity ID riding this projectile (enters limbo on fire, unlimbos on impact)
  dogRiderId: number;    // entity ID of dog riding this bullet (-1 = none)
  // C++ fuse.cpp — IsFueled: fuel timer counts down; when 0, force-explode mid-air (bullet.cpp:710, fuse.h:62)
  fuelTimer: number;     // ticks remaining before fuel-forced explosion (0xFF max, 0 = explode now)
  isFueled: boolean;     // true if weapon has IsFueled flag (SCUD/V2)
  // C++ bullet.cpp:790-802 — IsDropping: vertical drop from FLIGHT_LEVEL (parabombs)
  isDropping: boolean;   // true if weapon has IsDropping flag
  dropHeight: number;    // current altitude in pixels; starts at FLIGHT_LEVEL(24), falls by RULE_GRAVITY each tick
  // C++ bullet.cpp:377-386 — IsFlameEquipped: flame/smoke trail every other tick
  isFlameEquipped: boolean;
  flameToggle: boolean;  // alternates each tick; trail spawns when true (C++ IsToAnimate)
  // C++ FlyClass/FuseClass state for ordinary projectiles.
  logicalLX: number;
  logicalLY: number;
  headToLX: number;
  headToLY: number;
  facing256: number;
  speedAccum: number;
  speedAdd: number;
  fuseTimer: number;
  armingTimer: number;
  proximity: number;
}

function structureFireLeptons(s: MapStructure): { lx: number; ly: number } {
  const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
  // C++ building.cpp CenterOffset table. Building Coord is fixed to the
  // upper-left cell corner by BuildingTypeClass::Coord_Fixup; Fire_Coord for
  // structures with zero primary offset starts from Center_Coord.
  const offsets: Record<string, { lx: number; ly: number }> = {
    '1x1': { lx: 0x0080, ly: 0x0080 },
    '2x1': { lx: 0x00ff, ly: 0x0080 },
    '1x2': { lx: 0x0080, ly: 0x00ff },
    '2x2': { lx: 0x00ff, ly: 0x00ff },
    '2x3': { lx: 0x00ff, ly: 0x0180 },
    '3x2': { lx: 0x0180, ly: 0x00ff },
    '3x3': { lx: 0x0180, ly: 0x0180 },
    '4x2': { lx: 0x0200, ly: 0x00ff },
    '5x5': { lx: 0x0280, ly: 0x0280 },
  };
  const off = offsets[`${w}x${h}`] ?? { lx: Math.trunc((w * LEPTON_SIZE) / 2), ly: Math.trunc((h * LEPTON_SIZE) / 2) };
  return {
    lx: s.cx * LEPTON_SIZE + off.lx,
    ly: s.cy * LEPTON_SIZE + off.ly,
  };
}

function structureFirePixels(s: MapStructure): { x: number; y: number } {
  const p = structureFireLeptons(s);
  return { x: p.lx * CELL_SIZE / LEPTON_SIZE, y: p.ly * CELL_SIZE / LEPTON_SIZE };
}

/** Minimal AI state slice needed by damageStructure */
export interface AiStateSlice {
  lastBaseAttackTick: number;
  underAttack: boolean;
  iq: number;
}

/** Context object providing combat functions access to game state and callbacks */
export interface CombatContext {
  entities: Entity[];
  entityById: Map<number, Entity>;
  structures: MapStructure[];
  inflightProjectiles: InflightProjectile[];
  effects: Effect[];
  logicAnims: LogicAnim[];
  /** True after this frame's AnimClass Logic pass has run.
   *  C++ new AnimClass objects are appended to the same Logic array; if the
   *  current loop has already passed the anim phase in TS, their first
   *  brand-new skip must be considered consumed for parity. */
  logicAnimsAlreadyProcessed?: boolean;
  tick: number;
  playerHouse: House;
  scenarioId: string;
  killCount: number;
  lossCount: number;
  // C++ score tracking (score.cpp:546-597, techno.cpp PointTotal)
  pointTotal: number;
  alliedUnitsLost: number;
  sovietUnitsLost: number;
  alliedBuildingsLost: number;
  sovietBuildingsLost: number;
  warheadOverrides: Record<string, [number, number, number, number, number]>;
  scenarioWarheadMeta: Record<string, WarheadMeta>;
  scenarioWarheadProps: Record<string, WarheadProps>;
  attackedTriggerNames: Set<string>;
  map: GameMap;

  // damageStructure state
  aiStates: Map<House, AiStateSlice>;
  lastBaseAttackEva: number;
  gameTicksPerSec: number;
  gapGeneratorCells: Map<number, { cx: number; cy: number; radius: number }>;
  nBuildingsDestroyedCount: number;
  structuresLost: number;
  bridgeCellCount: number;

  // Structure combat state
  powerConsumed: number;
  powerProduced: number;

  // Callbacks
  isAllied(a: House, b: House): boolean;
  entitiesAllied(a: Entity, b: Entity): boolean;
  isPlayerControlled(e: Entity): boolean;
  playSoundAt(name: string, x: number, y: number): void;
  playEva(name: string): void;
  minimapAlert(cx: number, cy: number): void;
  movementSpeed(entity: Entity): number;
  /** C++ TechnoClass::Unlimbo -> Enter_Idle_Mode(true) mission selection. */
  idleMission?(entity: Entity): Mission;
  /** C++ TechnoClass::Revealed(PlayerPtr) side effect for newly unlimboed objects. */
  markDiscoveredIfPlayerVisible?(entity: Entity): void;
  getFirepowerBias(house: House): number;
  /** C++ house.cpp:292,302: ArmorBias — difficulty-scaled damage resistance */
  getArmorBias(house: House): number;
  /** C++ house.cpp:293,303: ROFBias — difficulty-scaled rate-of-fire */
  getROFBias(house: House): number;
  damageStructure(s: MapStructure, damage: number): boolean;
  /** C++ TeamClass::Suspend_Teams, triggered from TechnoClass::Base_Is_Attacked. */
  suspendTeamsByPriority?(house: House, priority: number): void;
  aiIQ(house: House): number;
  warheadMuzzleColor(warhead: string): string;

  // damageStructure callbacks
  clearStructureFootprint(s: MapStructure): void;
  recalculateSiloCapacity(): void;
  showEvaMessage(id: number): void;

  // Renderer access
  screenShake: number;
  screenFlash: number;
}

// ── Pure Functions ─────────────────────────────────────────────────────────────

/** Warhead vs armor multiplier — checks scenario overrides first */
export function getWarheadMult(
  warhead: WarheadType, armor: ArmorType,
  warheadOverrides: Record<string, [number, number, number, number, number]>,
): number {
  const idx = armorIndex(armor);
  const overridden = warheadOverrides[warhead];
  if (overridden) return overridden[idx] ?? 1;
  return WARHEAD_VS_ARMOR[warhead]?.[idx] ?? 1;
}

/** Warhead meta — checks scenario overrides first */
export function getWarheadMeta(
  warhead: WarheadType,
  scenarioWarheadMeta: Record<string, WarheadMeta>,
): WarheadMeta {
  return scenarioWarheadMeta[warhead] ?? WARHEAD_META[warhead] ?? { spreadFactor: 1 };
}

/** Warhead props — checks scenario overrides first */
export function getWarheadProps(
  warhead: WarheadType | string | undefined,
  scenarioWarheadProps: Record<string, WarheadProps>,
): WarheadProps | undefined {
  if (!warhead) return undefined;
  return scenarioWarheadProps[warhead] ?? WARHEAD_PROPS[warhead as WarheadType];
}

// ── C++ Combat_Anim — damage-scaled explosion sprite selection ──────────────
// C++ combat.cpp:295-366 selects explosion animations from arrays based on:
//   1. Warhead's ExplosionSet (integer 0-6)
//   2. Damage amount (scales which animation in the set's array)
//   3. LandType (water/air/ground for different sprites)
//
// Damage-scaled index formula:
//   C++ combat.cpp: _list[(len - 1) * fixed(min(damage, max), max)]
//   fixed.cpp constructor truncates raw 8.8 value, then fixed.h `int * fixed`
//   rounds to nearest integer with +128 before /256.

/** C++ Combat_Anim animation arrays, indexed by damage-scaled fraction */
const FIRE_LIST  = ['napalm1', 'napalm2', 'napalm3'];               // ExplosionSet=3, max 150
const AP_LIST    = ['veh-hit3', 'veh-hit2', 'frag1', 'fball1'];     // ExplosionSet=4, max 90
const HE_LIST    = ['veh-hit1', 'veh-hit2', 'art-exp1', 'fball1'];  // ExplosionSet=5, max 130
const WATER_LIST = ['water-exp3', 'water-exp2', 'water-exp1'];      // Water override for sets 3-5

function combatAnimScaledIndex(listLength: number, damage: number, maxDamage: number): number {
  if (listLength <= 1) return 0;
  const clampedDamage = Math.max(0, Math.min(damage, maxDamage));
  // C++ fixed(min(damage,max), max): Raw = (numerator * 256) / denominator, truncating.
  const fixedRaw = Math.floor((clampedDamage * 256) / maxDamage);
  // C++ fixed::operator*(int): (((unsigned)Raw * rvalue) + 128) / 256.
  return Math.floor((fixedRaw * (listLength - 1) + 128) / 256);
}

/**
 * C++ Combat_Anim() — select explosion sprite based on damage, explosion set, and land type.
 * @param damage   Raw damage amount (before armor/spread modifiers)
 * @param explosionSet  Integer 0-6 from WarheadProps.explosionSet
 * @param land     'ground' | 'water' | 'air' (LAND_NONE for aircraft targets)
 * @returns Sprite name or null if no explosion (set 0 or damage 0)
 */
export function combatAnim(damage: number, explosionSet: number, land: 'ground' | 'water' | 'air'): string | null {
  if (damage === 0) return null;

  switch (explosionSet) {
    case 6: return 'atomsfx';  // ANIM_ATOM_BLAST — always

    case 2:  // SA piffs: piff for ≤15, piffpiff for >15
      return damage > 15 ? 'piffpiff' : 'piff';

    case 4: {  // AP frags
      if (land === 'air') return 'flak';
      const maxDmg = 90;
      const list = land === 'water' ? WATER_LIST : AP_LIST;
      return list[combatAnimScaledIndex(list.length, damage, maxDmg)];
    }

    case 5: {  // HE pops
      if (land === 'air') return 'flak';
      const maxDmg = 130;
      const list = land === 'water' ? WATER_LIST : HE_LIST;
      return list[combatAnimScaledIndex(list.length, damage, maxDmg)];
    }

    case 3: {  // Fire
      if (land === 'air') return 'flak';
      const maxDmg = 150;
      const list = land === 'water' ? WATER_LIST : FIRE_LIST;
      return list[combatAnimScaledIndex(list.length, damage, maxDmg)];
    }

    case 1: return 'piff';  // HollowPoint — always piff

    default: return null;  // Set 0 (Super/Organic/Mechanical) — no explosion
  }
}

/** Damage-based speed reduction.
 *  C++ drive.cpp:1182-1187 applies this only in DriveClass speed setup.
 *  C++ infantry.cpp:4016-4049 computes infantry movement without a health
 *  multiplier, so wounded infantry stays at normal walking speed. */
export function damageSpeedFactor(entity: Entity): number {
  if (entity.stats.isInfantry) return 1.0;
  const ratio = entity.hp / entity.maxHp;
  if (ratio <= CONDITION_YELLOW) return 0.75;
  return 1.0;
}

// ── Internal Helpers (not exported) ────────────────────────────────────────────

/** Infantry scatter: push infantry toward a nearby cell when hit.
 *  C++ infantry.cpp:1852-1907 InfantryClass::Scatter
 *  C++ always scatters when forced (the 25% random check is commented out at line 1885).
 *  Direction: facing away from threat + Random_Pick(0, 4) - 2 offset.
 *  Uses exactly 1 ScenarioRandom call (matching C++ RNG consumption). */
function scatterInfantry(ctx: CombatContext, victim: Entity, attackerPos: WorldPos): void {
  if (!victim.alive || !victim.stats.isInfantry || victim.isAnt) return;
  // C++ infantry.cpp:1888-1890: direction = away from threat + Random_Pick(0,4)-2
  const baseFacing = Math.round(Math.atan2(victim.pos.y - attackerPos.y, victim.pos.x - attackerPos.x) / (Math.PI / 4)) & 7;
  const offset = ScenarioRandom.nextInRange(0, 4) - 2; // C++ parity: exactly 1 RNG call
  const scatterFacing = ((baseFacing + offset) + 8) % 8;
  const dx = DIR_DX[scatterFacing];
  const dy = DIR_DY[scatterFacing];
  const scatterX = victim.pos.x + dx * CELL_SIZE * 0.5;
  const scatterY = victim.pos.y + dy * CELL_SIZE * 0.5;
  const sc = worldToCell(scatterX, scatterY);
  if (ctx.map.isPassable(sc.cx, sc.cy)) {
    victim.setPosition(scatterX, scatterY);
  }
}

/** C++ unit.cpp:1058-1060 survivor Scatter(0, true).
 *  Vehicle crews are spawned at the destroyed unit's Coord, get a random
 *  half-health Strength, then immediately pick a scatter facing before the
 *  final HUNT/GUARD mission is queued. This helper mirrors the no-threat
 *  branch of InfantryClass::Scatter (infantry.cpp:1888-1927). */
function scatterVehicleCrew(ctx: CombatContext, crew: Entity): void {
  const fracX = ((crew.leptonX % LEPTON_SIZE) + LEPTON_SIZE) % LEPTON_SIZE;
  const fracY = ((crew.leptonY % LEPTON_SIZE) + LEPTON_SIZE) % LEPTON_SIZE;
  let baseFacing = crew.facing;
  if (fracX !== CELL_CENTER_LEPTON || fracY !== CELL_CENTER_LEPTON) {
    baseFacing = Math.round(Math.atan2(fracY - CELL_CENTER_LEPTON, fracX - CELL_CENTER_LEPTON) / (Math.PI / 4)) & 7;
  }
  const offset = ScenarioRandom.nextInRange(0, 4) - 2;
  const startFacing = ((baseFacing + offset) % DIR_COUNT + DIR_COUNT) % DIR_COUNT;

  let chosen: { cx: number; cy: number } | null = null;
  const cx = crew.cell.cx;
  const cy = crew.cell.cy;
  for (let face = 0; face < DIR_COUNT; face++) {
    const dir = (startFacing + face) % DIR_COUNT;
    const ncx = cx + DIR_DX[dir];
    const ncy = cy + DIR_DY[dir];
    if (ncx >= 0 && ncx < MAP_CELLS && ncy >= 0 && ncy < MAP_CELLS && ctx.map.isPassable(ncx, ncy)) {
      chosen = { cx: ncx, cy: ncy };
      break;
    }
  }
  if (chosen) {
    // InfantryClass::Scatter assigns ::As_Target(newcell); As_Coord() reads
    // that back as cell*256+0x88, not the visual center.
    crew.moveTarget = cellTargetToLepton(chosen.cx, chosen.cy);
    assignMission(crew, Mission.MOVE);
  }
}

/** C++ map.cpp:1837-1861 — Kill all entities on destroyed bridge cells.
 *  When a bridge is fully destroyed, all occupants on those cells die instantly
 *  with full-strength HE damage: obj->Take_Damage(obj->Strength, 0, WARHEAD_HE, NULL, true) */
export function killBridgeOccupants(ctx: CombatContext, cx: number, cy: number, radius: number): void {
  for (const e of ctx.entities) {
    if (!e.alive || e.inLimbo) continue;
    const ec = e.cell;
    // Check if entity is within the bridge destruction radius
    const dx = ec.cx - cx;
    const dy = ec.cy - cy;
    if (Math.abs(dx) > radius || Math.abs(dy) > radius) continue;
    // Only kill if the entity's cell is now water (was part of the destroyed bridge)
    if (ctx.map.getTerrain(ec.cx, ec.cy) !== Terrain.WATER) continue;
    // C++ map.cpp:1843 — obj->Take_Damage(obj->Strength, 0, WARHEAD_HE) — instant kill
    const killed = damageEntity(ctx, e, e.hp + 10, 'HE');
    if (killed) {
      handleUnitDeath(ctx, e, {
        screenShake: 4, explosionSize: 12, debris: true,
        decal: null,
        explodeLgSound: false,
        attackerIsPlayer: false,
        trackLoss: ctx.isPlayerControlled(e),
      });
    }
  }
}

// ── Mutating Functions ─────────────────────────────────────────────────────────

/** Apply damage to entity, track triggers, scatter idle AI units on hit.
 *  C++ house.cpp:292,302: ArmorBias — difficulty-scaled damage resistance applied here.
 *
 *  C++ FootClass::Take_Damage (foot.cpp:1166-1234) is the unified retaliation entry
 *  point — when a unit takes damage, the attacker becomes its TarCom so Firing_AI
 *  fires back next tick. We run the equivalent here so EVERY damage event (direct
 *  hit, splash, projectile detonation, structure fire, AOE) triggers retaliation. */
export function damageEntity(
  ctx: CombatContext, target: Entity, amount: number,
  warhead: WarheadType, attacker?: Entity,
  options: { skipProneBias?: boolean; skipEntityArmorBias?: boolean; skipHouseArmorBias?: boolean } = {},
): boolean {
  // C++ parity: apply house-level armor bias from difficulty (house.cpp:292,302)
  // ArmorBias > 1 = tougher (less damage), < 1 = weaker (more damage)
  const houseArmorBias = ctx.getArmorBias(target.house);
  if (!options.skipHouseArmorBias && houseArmorBias !== 1.0 && amount > 0) {
    amount = Math.max(1, Math.round(amount / houseArmorBias));
  }
  const whProps = getWarheadProps(warhead, ctx.scenarioWarheadProps);
  const killed = target.takeDamage(amount, warhead, attacker, whProps, {
    skipProneBias: options.skipProneBias,
    skipArmorBias: options.skipEntityArmorBias,
  });
  if (target.triggerName) ctx.attackedTriggerNames.add(target.triggerName);
  // C++ negative damage is healing. TechnoClass::Take_Damage repairs strength,
  // but it must not flow into FootClass retaliation/scatter handling as if the
  // unit was attacked.
  if (amount < 0) return false;
  // C++ unit.cpp:1162-1167 — computer harvesters that survive damage call
  // TechnoClass::Base_Is_Attacked(source), which can suspend low-priority teams
  // for the harvester's house. This is the same base-defense hook used by
  // BuildingClass::Take_Damage, but UnitClass scopes it to UNIT_HARVESTER.
  if (!killed && target.alive && attacker && target.type === UnitType.V_HARV) {
    maybeSuspendTeamsForBaseAttack(ctx, attacker, target.house, false);
  }
  if (!killed && target.alive) {
    // C++ damage-response order:
    //   1. FootClass::Take_Damage handles retaliation / team damage. If
    //      retaliation is not allowed and the unit has no TarCom/NavCom, it
    //      calls Scatter(0,true).
    //   2. InfantryClass::Take_Damage then calls Scatter(source_coord), whose
    //      Target_Legal(TarCom) guard suppresses voluntary scatter after a
    //      successful retaliation target assignment.
    const didFootForcedScatter = shouldFootClassForcedScatter(ctx, target, attacker);
    if (didFootForcedScatter) aiScatterOnDamage(ctx, target);
    // C++ infantry.cpp:432-436 — damaged non-human engineers guarding the
    // battlefield are forced into HUNT after FootClass::Take_Damage has run.
    // This ordering is important: FootClass may have queued a MOVE scatter, and
    // Assign_Mission(HUNT) overwrites that queue while preserving the scatter
    // NavCom. The engineer then drives under Mission_HUNT instead of arriving
    // as Mission_MOVE and idling to GUARD.
    if (target.stats.isInfantry &&
        target.type === UnitType.I_E6 &&
        target.house !== ctx.playerHouse &&
        (target.mission === Mission.GUARD || target.mission === Mission.AREA_GUARD)) {
      assignMission(target, Mission.HUNT);
    }
    if (attacker) triggerRetaliation(ctx, target, attacker);
    if (attacker || !didFootForcedScatter) aiScatterOnDamage(ctx, target, attacker);
  }
  return killed;
}

/** C++ foot.cpp:1228-1230 fallback scatter gate.
 *  This is distinct from InfantryClass::Take_Damage's later source scatter:
 *  FootClass calls Scatter(0,true) only when individual retaliation is not
 *  allowed and the unit is free to move. */
function shouldFootClassForcedScatter(ctx: CombatContext, victim: Entity, attacker?: Entity): boolean {
  // Current TS non-infantry scatter is handled by the existing virtual scatter
  // path below. Keep this helper scoped to the infantry RNG path (53003).
  if (!victim.stats.isInfantry) return false;
  // C++ foot.cpp:1172 — team members delegate to Team->Took_Damage and skip
  // individual retaliation/scatter fallback.
  if (victim.teamRef) return false;

  const mc = MISSION_CONTROL[victim.mission];
  if (!mc?.isScatter) return false;
  if (victim.isDriving) return false;
  if (victim.target?.alive || victim.targetStructure?.alive || victim.moveTarget) return false;
  if (victim.isAirUnit || victim.isNavalUnit) return false;
  // Rule.IsScatter defaults false; only non-human houses take this fallback.
  if (victim.house === ctx.playerHouse) return false;

  // If C++ Is_Allowed_To_Retaliate would pass, FootClass does not take the
  // fallback branch. Keep this deterministic; the later AI threat-comparison
  // RNG is intentionally not consumed from this predicate.
  if (!attacker || !attacker.alive) return true;
  if (ctx.entitiesAllied(victim, attacker)) return true;
  if (!MISSION_CONTROL[victim.mission]?.isRetaliate) return true;
  if (victim.stats.isAircraft && victim.stats.isFixedWing) return true;

  const isVictimHumanHouse = victim.house === ctx.playerHouse;
  const houseIQ = ctx.aiIQ?.(victim.house) ?? 3;
  if (shouldCrushIt(victim, attacker, isVictimHumanHouse, houseIQ)) return false;

  if (!victim.weapon) return true;
  if (getWarheadMult(victim.weapon.warhead, attacker.stats.armor, ctx.warheadOverrides ?? {}) <= 0) return true;
  if (attacker.stats.isCanine || attacker.type === UnitType.I_DOG) return true;
  if (attacker.isAirUnit && attacker.flightAltitude > 0) {
    const hasAA = victim.weapon?.isAntiAir || victim.weapon2?.isAntiAir;
    if (!hasAA) return true;
  }
  if (!canTargetNaval(victim, attacker)) return true;
  if (isVictimHumanHouse) {
    const isTanyaVsInfantry = victim.type === UnitType.I_TANYA && attacker.stats.isInfantry;
    if (!isTanyaVsInfantry) return true;
  }
  if (victim.isSuicide) return true;

  return false;
}

/**
 * AI scatter — infantry scatter per C++ infantry.cpp:1852-1929 (InfantryClass::Scatter).
 *
 * Key C++ behaviors:
 *  - InfantryClass::Take_Damage calls Scatter(source_coord) with forced=false
 *  - FootClass fallback/no-source paths call Scatter(0, true)
 *  - IsDriving (already moving) → forced=false (line 1860)
 *  - MissionControl[mission].isScatter must be true OR forced (line 1866)
 *  - If not IsFraidyCat AND has valid combat target AND not forced → skip (line 1872)
 *  - Must be forced OR IsFraidyCat to actually execute scatter (line 1885)
 *  - Calculate direction AWAY from threat with random +-2 facing offset
 *  - Try 8 directions starting from away-direction, pick first passable cell
 *  - Only infantry scatters directionally (non-infantry uses old random scatter)
 */
export function aiScatterOnDamage(ctx: CombatContext, entity: Entity, attacker?: Entity): void {
  // Only infantry uses directional scatter (C++ infantry.cpp override)
  if (!entity.stats.isInfantry) {
    // C++ FootClass::Take_Damage fallback scatter for DriveClass descendants
    // (foot.cpp:1221-1227) only fires when the object did not retaliate, has no
    // TarCom/NavCom, is not driving, is not aircraft/vessel, and its mission is
    // scatterable. DriveClass::Scatter(0,true) then consumes exactly one
    // Random_Pick(0,2) facing offset and Assign_Destination(cell); it does not
    // switch the mission to MOVE.
    if (entity.teamRef) return;
    if (entity.isAirUnit || entity.isNavalUnit) return;
    const mc = MISSION_CONTROL[entity.mission];
    if (mc && !mc.isScatter) return;
    if (entity.isDriving || entity.target?.alive || entity.moveTarget) return;
    if (entity.house === ctx.playerHouse) return;

    const offset = ScenarioRandom.nextInRange(0, 2) - 1;
    const startFacing = ((entity.facing + offset) % DIR_COUNT + DIR_COUNT) % DIR_COUNT;
    const cx = entity.cell.cx;
    const cy = entity.cell.cy;
    for (let face = 0; face < DIR_COUNT; face++) {
      const dir = (startFacing + face) % DIR_COUNT;
      const ncx = cx + DIR_DX[dir];
      const ncy = cy + DIR_DY[dir];
      if (ncx >= 0 && ncx < MAP_CELLS && ncy >= 0 && ncy < MAP_CELLS &&
          ctx.map.isPassable(ncx, ncy)) {
        entity.moveTarget = cellTargetToLepton(ncx, ncy);
        break;
      }
    }
    return;
  }

  // ── Infantry directional scatter (C++ infantry.cpp:1852-1929) ──
  // C++ InfantryClass::Take_Damage (infantry.cpp:439) calls Scatter(source_coord)
  // with forced=false. FootClass fallback paths call Scatter(0,true), represented
  // here by the no-attacker branch.
  let forced = attacker === undefined;

  // C++ infantry.cpp:1875 — IsDriving: already moving clears forced.
  // IsDriving is the cell-to-cell driver state, not NavCom/moveTarget.
  if (entity.isDriving) forced = false;

  // C++ infantry.cpp:1866 — mission must allow scatter (MissionControl[Mission].IsScatter)
  const mc = MISSION_CONTROL[entity.mission];
  if (mc && !mc.isScatter && !forced) return;

  // C++ infantry.cpp:1872 — non-FraidyCat with a legal combat target doesn't
  // scatter. Target_Legal(TarCom) rejects destroyed objects, so a stale pointer
  // to a just-killed target must not suppress scatter.
  const hasLegalCombatTarget =
    (entity.target?.alive ?? false) ||
    (entity.targetStructure?.alive ?? false);
  if (!entity.stats.isFraidyCat && hasLegalCombatTarget && !forced) return;

  // C++ infantry.cpp:1892 — non-interruptible Doing blocks scatter.
  if (!entity.isDoingInterruptible()) return;

  // C++ infantry.cpp:1898 — human-house infantry only skip voluntary scatter
  // when they are not in a team. FootClass's source==NULL damage path calls
  // Scatter(0,true), and forced scatter bypasses this gate.
  if (!forced && entity.house === ctx.playerHouse && !entity.teamRef) return;

  // C++ infantry.cpp:1900 — actual scatter only happens when forced or the
  // infantry type is FraidyCat. Non-fraidy infantry hit by a source calls
  // Scatter(source_coord) with forced=false, passes the earlier gates, then
  // exits here without consuming the Random_Pick(0,4) facing offset.
  if (!forced && !entity.stats.isFraidyCat) return;

  // Calculate scatter direction (C++ infantry.cpp:1888-1900)
  let awayDir: number;
  if (attacker) {
    // C++ infantry.cpp:1889 — Dir_Facing(Direction8(threat, Coord))
    // Direction from threat to infantry = away from threat
    awayDir = directionTo(attacker.pos, entity.pos);
  } else {
    // C++ infantry.cpp:1893-1897 — no threat source uses cell-fraction
    // direction unless the infantry is exactly at cell center.
    const fracX = entity.leptonX & 0xff;
    const fracY = entity.leptonY & 0xff;
    awayDir = (fracX !== CELL_CENTER_LEPTON || fracY !== CELL_CENTER_LEPTON)
      ? directionToLeptons(CELL_CENTER_LEPTON, CELL_CENTER_LEPTON, fracX, fracY)
      : entity.facing;
  }

  // C++ infantry.cpp:1890 — Random_Pick(0,4)-2 → random +-2 facing offset
  const savedSourceTag = ScenarioRandom._sourceTag;
  if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = attacker ? 53002 : 53003;
  const offset = ScenarioRandom.nextInRange(0, 4) - 2; // -2, -1, 0, 1, or 2
  ScenarioRandom._sourceTag = savedSourceTag;
  awayDir = ((awayDir + offset) % DIR_COUNT + DIR_COUNT) % DIR_COUNT;

  // C++ infantry.cpp:1905-1915 — try 8 directions starting from away-direction
  const entityCX = Math.floor(entity.pos.x / CELL_SIZE);
  const entityCY = Math.floor(entity.pos.y / CELL_SIZE);

  let bestCell: { cx: number; cy: number } | null = null;
  for (let face = 0; face < DIR_COUNT; face++) {
    const newFace = (awayDir + face) % DIR_COUNT;
    const ncx = entityCX + DIR_DX[newFace];
    const ncy = entityCY + DIR_DY[newFace];

    if (ncx >= 0 && ncx < MAP_CELLS && ncy >= 0 && ncy < MAP_CELLS &&
        ctx.map.isPassable(ncx, ncy)) {
      bestCell = { cx: ncx, cy: ncy };
      break; // C++ infantry.cpp:1911 — take first passable cell
    }
  }

  // C++ infantry.cpp:1924-1927 — assign MOVE mission to best cell
  if (bestCell) {
    entity.moveTarget = cellTargetToLepton(bestCell.cx, bestCell.cy);
    assignMission(entity, Mission.MOVE);
  }
}

/** Fire weapon at entity target (helper for aircraft) — uses full damage pipeline */
export function fireWeaponAt(
  ctx: CombatContext, attacker: Entity, target: Entity, weapon: WeaponStats,
): void {
  const houseBias = ctx.getFirepowerBias(attacker.house);
  const whMult = getWarheadMult(weapon.warhead, target.stats.armor, ctx.warheadOverrides);
  const damage = modifyDamage(weapon.damage, weapon.warhead, target.stats.armor, 0, houseBias, whMult, getWarheadMeta(weapon.warhead, ctx.scenarioWarheadMeta).spreadFactor);
  const killed = damageEntity(ctx, target, damage, weapon.warhead, attacker);
  if (killed) {
    attacker.creditKill();
    handleUnitDeath(ctx, target, {
      screenShake: 8, explosionSize: 16, debris: true,
      decal: { infantry: 6, vehicle: 10, opacity: 0.6 },
      explodeLgSound: false,
      attackerIsPlayer: ctx.isPlayerControlled(attacker),
      trackLoss: true,
      attacker,
    });
  }
  // Fire effect
  ctx.effects.push({
    type: 'muzzle',
    x: attacker.pos.x, y: attacker.pos.y - attacker.flightAltitude,
    frame: 0, maxFrames: 4, size: 4, sprite: 'piff', spriteStart: 0,
  } as Effect);
}

/** Fire weapon at structure target (helper for aircraft) — uses full damage pipeline */
export function fireWeaponAtStructure(
  ctx: CombatContext, attacker: Entity, s: MapStructure, weapon: WeaponStats,
): void {
  const wh = (weapon.warhead ?? 'HE') as WarheadType;
  const houseBias = ctx.getFirepowerBias(attacker.house);
  const armor = s.armor ?? (STRUCTURE_ARMOR[s.type] ?? 'wood');
  const whMult = getWarheadMult(wh, armor, ctx.warheadOverrides);
  const damage = modifyDamage(weapon.damage, wh, armor, 0, houseBias, whMult, getWarheadMeta(wh, ctx.scenarioWarheadMeta).spreadFactor);
  const destroyed = structureDamage(ctx, s, damage, attacker);
  if (destroyed) attacker.creditKill();
  ctx.effects.push({
    type: 'muzzle',
    x: attacker.pos.x, y: attacker.pos.y - attacker.flightAltitude,
    frame: 0, maxFrames: 4, size: 4, sprite: 'piff', spriteStart: 0,
  } as Effect);
}

function maybeSuspendTeamsForBaseAttack(
  ctx: CombatContext,
  attacker: Entity,
  attackedHouse: House,
  attackedObjectHasPrimaryWeapon: boolean,
): void {
  // C++ BuildingClass::Take_Damage calls TechnoClass::Base_Is_Attacked(source)
  // and UnitClass::Take_Damage does the same for surviving computer harvesters.
  // before applying damage. Base_Is_Attacked returns unless:
  //   - target house is AI/non-human,
  //   - source is an enemy FootClass of RTTI_INFANTRY or RTTI_UNIT,
  //   - building cannot defend itself,
  // then TeamClass::Suspend_Teams(Rule.SuspendPriority=20, House).
  if (!ctx.suspendTeamsByPriority) return;
  if (attackedHouse === ctx.playerHouse) return;
  if (ctx.isAllied(attackedHouse, attacker.house)) return;
  const attackerIsInfantryOrUnit =
    attacker.stats.isInfantry || (!attacker.isAirUnit && !attacker.isNavalUnit);
  if (!attackerIsInfantryOrUnit) return;
  if (attackedObjectHasPrimaryWeapon) return;
  ctx.suspendTeamsByPriority(attackedHouse, 20);
}

function cppCoordDistanceUnits(dx: number, dy: number): number {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  return ady > adx ? ady + (adx >> 1) : adx + (ady >> 1);
}

function cppFixedRaw(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.trunc((numerator * 256) / denominator) & 0xffff;
}

function cppFixedInverseRaw(raw: number): number {
  return raw !== 0 && raw !== 256 ? Math.trunc((256 * 256) / raw) & 0xffff : 256;
}

function cppFixedMulInt(raw: number, value: number): number {
  return Math.trunc(((raw * value) + 128) / 256);
}

function wideAreaDamage(
  ctx: CombatContext,
  centerLX: number,
  centerLY: number,
  radiusLeptons: number,
  rawDamage: number,
  source: Entity | undefined,
  warhead: WarheadType,
): void {
  const cellRadius = Math.trunc((radiusLeptons + LEPTON_SIZE - 1) / LEPTON_SIZE);
  const centerCx = Math.floor(centerLX / LEPTON_SIZE);
  const centerCy = Math.floor(centerLY / LEPTON_SIZE);
  const sourceHouse = source?.house ?? House.USSR;

  for (let x = -cellRadius; x <= cellRadius; x++) {
    for (let y = -cellRadius; y <= cellRadius; y++) {
      const cx = centerCx + x;
      const cy = centerCy + y;
      if (!ctx.map.inBounds(cx, cy)) continue;

      // C++ combat.cpp:426 uses XY_Coord(x+cell_radius, y+cell_radius), so this
      // distance is in integer grid units, not leptons.
      const distFromCenter = cppCoordDistanceUnits(x, y);
      const damage = cppFixedMulInt(
        cppFixedInverseRaw(cppFixedRaw(cellRadius, distFromCenter)),
        rawDamage,
      );
      if (damage === 0) continue;

      applySplashDamage(
        ctx,
        { x: cx * CELL_SIZE + CELL_SIZE / 2, y: cy * CELL_SIZE + CELL_SIZE / 2 },
        { damage, warhead },
        -1,
        sourceHouse,
        source,
      );
    }
  }
}

/** Shared death aftermath — explosion, debris, decal, sound, kill/loss tracking.
 *  Parameterized to handle the 4 death contexts (direct, defense, projectile, splash). */
export function handleUnitDeath(ctx: CombatContext, victim: Entity, opts: {
  screenShake: number;
  explosionSize: number;
  debris: boolean;
  decal: { infantry: number; vehicle: number; opacity: number } | null;
  explodeLgSound: boolean;
  attackerIsPlayer: boolean;
  trackLoss: boolean;
  friendlyFireLoss?: boolean;
  attacker?: Entity;
}): void {
  const kx = victim.pos.x;
  const ky = victim.pos.y;
  ctx.effects.push({ type: 'explosion', x: kx, y: ky, frame: 0, maxFrames: 18,
    size: opts.explosionSize, sprite: 'fball1', spriteStart: 0 } as Effect);
  if (opts.debris && !victim.stats.isInfantry) {
    ctx.effects.push({ type: 'debris', x: kx, y: ky, frame: 0, maxFrames: 12, size: 18 } as Effect);
  }
  ctx.screenShake = Math.max(ctx.screenShake, opts.screenShake);
  if (opts.decal) {
    const tc = worldToCell(kx, ky);
    ctx.map.addDecal(tc.cx, tc.cy,
      victim.stats.isInfantry ? opts.decal.infantry : opts.decal.vehicle, opts.decal.opacity);
  }
  if (victim.isAnt) ctx.playSoundAt('die_ant', kx, ky);
  else if (victim.stats.isInfantry) {
    ctx.playSoundAt('die_infantry', kx, ky);
    // C++ infantry.cpp:383-416 — Warhead InfDeath=5 (Tesla/Super) deletes
    // the infantry and creates ANIM_ELECT_DIE. adata.cpp marks ELECTRO as an
    // immediate scorcher (Biggest=0), so AnimClass::Start -> Middle consumes
    // Random_Pick(SMUDGE_SCORCH1, SMUDGE_SCORCH6) before BulletClass does its
    // invisible Coord_Scatter.
    if (victim.deathVariant === 5) {
      spawnLogicAnim(ctx.logicAnims, ctx.effects, 'elect_die', kx, ky, 1, true);
    }
  }
  else ctx.playSoundAt('die_vehicle', kx, ky);
  if (opts.explodeLgSound) ctx.playSoundAt('explode_lg', kx, ky);
  if (opts.attackerIsPlayer) ctx.killCount++;
  if (opts.trackLoss && ctx.isPlayerControlled(victim)) {
    ctx.lossCount++;
    ctx.playEva('eva_unit_lost');
    const tc = worldToCell(kx, ky);
    ctx.minimapAlert(tc.cx, tc.cy);
  }
  if (opts.friendlyFireLoss) {
    ctx.lossCount++;
    ctx.playEva('eva_unit_lost');
    const tc = worldToCell(kx, ky);
    ctx.minimapAlert(tc.cx, tc.cy);
  }

  // C++ score tracking: PointTotal += points for enemy kills, -= points for own losses
  // (techno.cpp:3911: source->House->PointTotal += points; techno.cpp:3990: House->PointTotal -= points)
  const unitPoints = victim.stats.points ?? victim.stats.strength ?? 0;
  if (opts.attackerIsPlayer) {
    ctx.pointTotal += unitPoints;
  }
  if ((opts.trackLoss && ctx.isPlayerControlled(victim)) || opts.friendlyFireLoss) {
    ctx.pointTotal -= unitPoints;
  }

  // C++ ObjectClass::Detach_All -> Detach_This_From_All(As_Target()) clears
  // every TarCom pointing at the destroyed object before death explosions and
  // post-death logic continue (object.cpp:1466-1483, techno.cpp:3872-3896).
  // InfantryClass::Detach also drops IsFiring when TarCom is detached. Without
  // this, TS keeps stale object references to destroyed vehicles and later code
  // treats those references as live orders until the next mission timer happens
  // to validate them.
  victim.target = null;
  victim.targetStructure = null;
  victim.moveTarget = null;
  victim.path = [];
  victim.pathIndex = 0;
  victim.firePrepActive = false;
  victim.firePrepStage = 0;
  victim.firePrepUsesDoingStage = false;
  for (const entity of ctx.entities) {
    if (entity.id === victim.id) continue;
    if (entity.target === victim) {
      entity.target = null;
      entity.firePrepActive = false;
      entity.firePrepStage = 0;
      entity.firePrepUsesDoingStage = false;
      if (entity.stats.isInfantry) {
        entity.isFiringAnim = false;
        entity.firingAnimTicks = 0;
      }
    }
  }
  for (const proj of ctx.inflightProjectiles) {
    // C++ BulletClass::Detach clears Payback when the firing object detaches
    // (except dog riders, which TS tracks separately with dogRiderId). It also
    // clears TarCom when the bullet target is detached during full Detach_All.
    // Keeping the dead attacker as Payback makes splash damage pass a bogus
    // source into Take_Damage, changing infantry scatter direction.
    if (proj.attackerId === victim.id && proj.dogRiderId !== victim.id) {
      proj.attackerId = -1;
    }
    if (proj.targetId === victim.id) {
      proj.targetId = -1;
    }
  }

  // Per-side casualty tracking for score screen bar graphs (C++ score.cpp:548-560)
  const faction = HOUSE_FACTION[victim.house] ?? 'allied';
  if (faction === 'soviet') {
    ctx.sovietUnitsLost++;
  } else if (faction !== 'both') {
    ctx.alliedUnitsLost++;
  }

  // C++ techno.cpp:3881-3895 — Explodes=yes death explosion (Wide_Area_Damage)
  // When a unit with Explodes=yes is destroyed, it deals area damage:
  //   damage  = MaxStrength (victim's full HP)
  //   warhead = primary weapon's warhead (default HE if no weapon)
  //   radius  = damage * Rule.ExplosionSpread (ExpSpread=.3 from rules.ini)
  // Wide_Area_Damage then calls Explosion_Damage once per covered cell, which
  // matters for retaliation RNG because the same nearby infantry can be touched
  // by multiple cell-centered explosions.
  if (victim.stats.explodesOnDeath) {
    const EXP_SPREAD = 0.3; // rules.ini [General] ExpSpread=.3
    const explosionDamage = victim.stats.strength; // C++ techno.cpp:3830: MaxStrength
    const primaryWeaponName = victim.stats.primaryWeapon;
    const explosionWarhead: WarheadType = primaryWeaponName
      ? ((WEAPON_STATS as Record<string, { warhead?: string }>)[primaryWeaponName]?.warhead as WarheadType ?? 'HE')
      : 'HE'; // C++ techno.cpp:3825: default WARHEAD_HE
    // C++ techno.cpp:3888-3890 creates the damage-scaled Combat_Anim at the
    // destroyed unit's center before Wide_Area_Damage. For Fire warheads this
    // is a NAPALM AnimClass that later consumes gameplay RNG in AnimClass::Middle.
    const explosionSet = getWarheadProps(explosionWarhead, ctx.scenarioWarheadProps)?.explosionSet ?? 0;
    const deathCell = worldToCell(kx, ky);
    const deathLand: 'ground' | 'water' | 'air' =
      ctx.map.getTerrain(deathCell.cx, deathCell.cy) === Terrain.WATER ? 'water' : 'ground';
    const deathAnimSprite = combatAnim(explosionDamage, explosionSet, deathLand);
    spawnLogicAnimForSprite(
      ctx.logicAnims,
      ctx.effects,
      deathAnimSprite ?? undefined,
      kx,
      ky,
      true,
      ctx.logicAnimsAlreadyProcessed === true,
    );
    const radiusLeptons = Math.trunc(explosionDamage * EXP_SPREAD); // C++ fixed int multiply
    wideAreaDamage(ctx, victim.leptonX, victim.leptonY, radiusLeptons, explosionDamage, opts.attacker, explosionWarhead);
  }

  // C++ unit.cpp:1046-1069 — Vehicle crew spawning on destruction
  // Conditions: IsCrew=true, Max_Passengers==0 (not a transport), 50% probability
  if (victim.stats.crewed && !victim.stats.isAircraft && !victim.stats.isInfantry &&
      (victim.stats.passengers ?? 0) === 0 && ScenarioRandom.percentChance(50)) {
    // C++ unit.cpp:1049-1054 death path: unarmed -> C1 technician,
    // armed -> E1 soldier. Do not call UnitClass::Crew_Type() here; that
    // separate helper has a C1/C7 random branch, but UnitClass::Take_Damage
    // bypasses it when spawning vehicle death crew.
    let crewType: UnitType;
    if (!victim.stats.primaryWeapon) {
      crewType = UnitType.I_C1;
    } else {
      crewType = UnitType.I_E1;
    }
    const inf = new Entity(crewType, victim.house, kx, ky);
    if (crewType === UnitType.I_C1) {
      // C++ unit.cpp:1051 — i->IsTechnician = true for unarmed vehicle crew.
      inf.isTechnician = true;
    }
    // C++ new InfantryClass starts at MISSION_NONE, but Unlimbo immediately
    // calls TechnoClass::Enter_Idle_Mode(true) + Commence() before UnitClass
    // death code sets crew HP, Scatter(), and Assign_Mission(HUNT/GUARD).
    //
    // That current idle mission matters: on the same Logic.AI pass that
    // re-reads Logic.Count(), the newly spawned infantry dispatches
    // Mission_Guard before Commence pops the queued HUNT from below.
    inf.mission = ctx.idleMission?.(inf) ?? Mission.GUARD;
    inf.missionTimer = 0;
    inf.missionQueue = null;
    // C++ unit.cpp:1058: i->Strength = Random_Pick(5, (int)i->Class->MaxStrength/2)
    inf.hp = Math.max(5, ScenarioRandom.nextInRange(5, Math.floor(inf.maxHp / 2)));
    inf.hp = Math.min(inf.hp, inf.maxHp);
    scatterVehicleCrew(ctx, inf);
    assignMission(inf, inf.house === ctx.playerHouse ? Mission.GUARD : Mission.HUNT);
    ctx.entities.push(inf);
    ctx.entityById.set(inf.id, inf);
    ctx.markDiscoveredIfPlayerVisible?.(inf);
  }

  // C++ aircraft.cpp:1588-1594 — Aircraft parachute survivors on destruction
  // Conditions: IsCrew=true, 90% probability, spawns E1 (no civilian variant)
  if (victim.stats.crewed && victim.stats.isAircraft &&
      ScenarioRandom.percentChance(90)) {
    const inf = new Entity(UnitType.I_E1, victim.house, kx, ky);
    // C++ aircraft survivors get full health (no HP reduction like vehicles)
    inf.mission = Mission.GUARD;
    ctx.entities.push(inf);
    ctx.entityById.set(inf.id, inf);
    ctx.markDiscoveredIfPlayerVisible?.(inf);
  }
}

/** C++ unit.cpp:4813-4855 — Should_Crush_It: AI auto-crush decision gate.
 *  Returns true if a crusher vehicle should deliberately drive over (crush) a target
 *  infantry instead of shooting it. Called from Take_Damage retaliation path.
 *
 *  Gate chain (all must pass):
 *   1. vehicle.crusher — only crusher vehicles can auto-crush
 *   2. target must be alive
 *   3. target.crushable — only crushable targets (infantry/ants)
 *   4. Distance <= CrushDistance (1.5 cells, rules.ini [General] Crush=1.5)
 *   5. NOT human-controlled (unit.cpp:4832)
 *   6. NOT DIFF_HARD (easy for player = AI doesn't crush) (unit.cpp:4832)
 *   7. Primary weapon warhead NOT IsWoodDestroyer (unit.cpp:4839) — or no weapon
 *   8. House IQ >= IQCrush (2) (unit.cpp:4845)
 *   9. target is NOT a spy (unit.cpp:4850) */
export function shouldCrushIt(
  crusher: Entity,
  target: Entity,
  isPlayerControlled: boolean,
  houseIQ: number,
  difficulty: 'easy' | 'normal' | 'hard' = 'normal',
): boolean {
  // Gate 1: only crusher vehicles
  if (!crusher.stats.crusher) return false;
  // Gate 2: target must be alive
  if (!target.alive) return false;
  // Gate 3: only crushable targets
  if (!target.stats.crushable) return false;
  // Gate 4: CrushDistance = 1.5 cells (384 leptons) — rules.ini [General] Crush=1.5
  const dx = crusher.pos.x - target.pos.x;
  const dy = crusher.pos.y - target.pos.y;
  const distCells = Math.sqrt(dx * dx + dy * dy) / CELL_SIZE;
  if (distCells > 1.5) return false;
  // Gate 5: human-controlled vehicles never auto-crush
  if (isPlayerControlled) return false;
  // Gate 6: DIFF_HARD (easy for player) blocks AI auto-crush
  if (difficulty === 'easy') return false;
  // Gate 7: primary weapon IsWoodDestroyer blocks auto-crush (unless unarmed)
  if (crusher.weapon) {
    const meta = WARHEAD_META[crusher.weapon.warhead];
    if (meta?.destroysWood) return false;
  }
  // Gate 8: IQ threshold — IQCrush = 2
  if (houseIQ < AI_BUILD_RULES.iqAutoCrush) return false;
  // Gate 9: spies are immune to AI auto-crush targeting
  if (target.type === UnitType.I_SPY) return false;

  return true;
}

/** Trigger retaliation: a damaged unit acquires the attacker as its TarCom so
 *  Firing_AI fires back next tick. C++ implementation chain:
 *   - foot.cpp:1166-1234 FootClass::Take_Damage — unified retaliation entry point
 *     (called via TechnoClass::Take_Damage → FootClass::Take_Damage for all Foot
 *     descendants: Infantry, Drive/Unit, Vessel, Aircraft).
 *   - foot.cpp:1202-1207 — after `Is_Allowed_To_Retaliate(source)` passes, calls
 *     `Assign_Target(source->As_Target())` gated by `In_Range(source, primary) || !House->IsHuman`.
 *   - techno.cpp:4924-5030 TechnoClass::Is_Allowed_To_Retaliate — full gate chain.
 *
 *  All C++ gates (techno.cpp:4924-5030, in order) are enforced here. */
export function triggerRetaliation(ctx: CombatContext, victim: Entity, attacker: Entity): void {
  // C++ techno.cpp:4929 — source == NULL (implied by null-check before call)
  if (!victim.alive || !attacker.alive) return;

  const priorMission = victim.mission;

  // C++ techno.cpp:4934 — MissionControl[Mission].IsRetaliate must be true
  // Blocks HUNT, SLEEP, ENTER, CAPTURE, HARVEST, UNLOAD, RETREAT, HARMLESS,
  // CONSTRUCTION, DECONSTRUCTION retaliation.
  const mc = MISSION_CONTROL[victim.mission];
  if (mc && !mc.isRetaliate) return;

  // C++ techno.cpp:4939-4941 — fixed-wing aircraft cannot retaliate
  if (victim.stats.isAircraft && victim.stats.isFixedWing) return;

  // C++ techno.cpp:4947 — House->Is_Ally(source) blocks retaliation
  if (ctx.entitiesAllied(victim, attacker)) return;

  // C++ foot.cpp:1172 — FootClass::Take_Damage delegates team members to
  // Team->Took_Damage and returns. It does NOT run the individual
  // Is_Allowed_To_Retaliate/TarCom path for team members. Team->Took_Damage
  // may change Team->Target to the attacker (team.cpp:1613), after which
  // Coordinate_Move/Attack reassigns member NavCom/TarCom through the team.
  if (victim.teamRef) {
    victim.teamRef.tookDamage(victim, attacker, ctx);
    return;
  }

  // C++ techno.cpp:4952 — Combat_Damage() <= 0 || !Is_Weapon_Equipped() blocks.
  // Unarmed TS exception: crusher vehicles without a weapon (HARV-style) still
  // pursue crush via unit.cpp:1124-1161 — evaluated below.
  // C++ House->IsHuman is strict PlayerPtr ownership, not "allied to PlayerPtr".
  // Game.isPlayerControlled() intentionally means player-or-ally for UI/scoring,
  // so do not use it for C++ retaliation/auto-crush gates. SCG07EA England is a
  // computer-controlled allied house and still auto-retaliates in C++.
  const isVictimHumanHouse = victim.house === ctx.playerHouse;

  // Don't interrupt scripted team missions (except HUNT which already attacks)
  if (victim.teamMissions.length > 0 && victim.mission !== Mission.HUNT) return;

  // C++ unit.cpp:1124-1161: auto-crush retaliation path.
  const houseIQ = ctx.aiIQ?.(victim.house) ?? 3;
  if (shouldCrushIt(victim, attacker, isVictimHumanHouse, houseIQ)) {
    victim.target = attacker;
    victim.mission = Mission.MOVE; // C++ unit.cpp:1137-1139: MISSION_MOVE to crush target
    victim.moveTarget = { lx: attacker.leptonX, ly: attacker.leptonY };
    return;
  }

  // Now enforce weapon requirement (C++ techno.cpp:4952)
  if (!victim.weapon) return;

  // C++ techno.cpp:4958-4962 — warhead modifier vs source armor == 0 blocks retaliation.
  // Use primary weapon warhead (PrimaryWeapon->WarheadPtr->Modifier[source->armor]).
  {
    const overrides = ctx.warheadOverrides ?? {};
    const whMult = getWarheadMult(victim.weapon.warhead, attacker.stats.armor, overrides);
    if (whMult <= 0) return;
  }

  // C++ techno.cpp:4968 — source is dog blocks retaliation
  if (attacker.stats.isCanine || attacker.type === UnitType.I_DOG) return;

  // C++ techno.cpp:4973 — source is aircraft, victim must have AA.
  // TS refinement: only block when aircraft is AIRBORNE (altitude > 0). Landed
  // aircraft are valid ground targets in TS (matching the pre-existing behavior
  // and covering unit test semantics: HPAD-landed HIND is treated as ground).
  if (attacker.isAirUnit && attacker.flightAltitude > 0) {
    const hasAA = victim.weapon?.isAntiAir || victim.weapon2?.isAntiAir;
    if (!hasAA) return;
  }

  // Naval gate: can't retaliate against untargetable naval units
  if (!canTargetNaval(victim, attacker)) return;

  // C++ techno.cpp:4980-4983 — human-controlled Tanya (IsBomber) cannot retaliate
  // against buildings. TS doesn't target structures via triggerRetaliation (they are
  // MapStructure, not Entity), so this gate is structurally satisfied.

  // C++ techno.cpp:4988 — human house + !IsSmartDefense (PlayerReturnFire=no) blocks
  // retaliation, EXCEPT Tanya vs infantry.
  // rules.ini [General] PlayerReturnFire=no → Rule.IsSmartDefense = false.
  if (isVictimHumanHouse) {
    const isTanyaVsInfantry = victim.type === UnitType.I_TANYA && attacker.stats.isInfantry;
    if (!isTanyaVsInfantry) return;
  }

  // C++ techno.cpp:4993 — suicide team members cannot retaliate
  if (victim.isSuicide) return;

  // C++ techno.cpp:5027-5045 — AI-only 50% threat comparison. This consumes
  // Percent_Chance(50) even when the unit keeps its existing TarCom. That call is
  // visible in RNG traces during invisible-bullet BulletClass::AI, before
  // Bullet_Explodes runs Coord_Scatter.
  const currentTarget = victim.target && victim.target.alive ? victim.target : null;
  // C++ techno.cpp:5001 calls Percent_Chance(50) for every non-human
  // Is_Allowed_To_Retaliate check, before it knows whether TarCom is legal.
  // If TarCom is empty, current_val remains 0 and the unit usually proceeds,
  // but the RNG call has still happened.
  if (!isVictimHumanHouse && ScenarioRandom.percentChance(50)) {
    const overrides = ctx.warheadOverrides ?? {};
    const sourceVal = attacker.weapon && victim.inRange(attacker)
      ? getWarheadMult(attacker.weapon.warhead, victim.stats.armor, overrides)
      : 0;
    const currentVal = currentTarget?.weapon && victim.inRange(currentTarget)
      ? getWarheadMult(currentTarget.weapon.warhead, victim.stats.armor, overrides)
      : 0;
    if (sourceVal <= currentVal) return;
  }

  // C++ foot.cpp:1202-1206 — Assign_Target gated by In_Range(source, primary) || !IsHuman.
  // Human houses only retarget if attacker is in weapon range. AI houses, including
  // player-allied computer houses, always retarget. For retaliation we've already
  // blocked non-Tanya player units above, so
  // this check only matters for the Tanya-vs-infantry exception.
  if (isVictimHumanHouse && !victim.inRange(attacker)) return;

  // C++ foot.cpp:1206 — Assign_Target(source->As_Target()).
  // Assign_Target changes TarCom only; it does not force MISSION_ATTACK.
  victim.target = attacker;

  // C++ foot.cpp:1209-1211 — MISSION_AMBUSH transitions to HUNT on retaliation.
  if (priorMission === Mission.AMBUSH) assignMission(victim, Mission.HUNT);
}

/** Vehicle crush — heavy tracked vehicles (crusher=true) instantly kill crushable units on cell entry.
 *  C++ DriveClass::Ok_To_Move (drive.cpp): when a Crusher vehicle enters a cell with a Crushable unit,
 *  the crushable unit dies instantly. Only crusher vehicles crush; only crushable targets are affected.
 *  Infantry and ants are crushable; vehicles are not. The crusher does NOT stop — it drives through.
 *  C++ checks IsAFriend() — friendly/allied infantry are NOT crushed. */
export function checkVehicleCrush(ctx: CombatContext, vehicle: Entity): void {
  // C++ drive.cpp:Ok_To_Move — only vehicles with Tracks=true (crusher flag) can crush infantry
  if (!vehicle.stats.crusher) return;
  const vc = vehicle.cell;
  let crushed = false;
  for (const other of ctx.entities) {
    if (!other.alive || other.id === vehicle.id) continue;
    if (!other.stats.crushable) continue; // only crushable targets (infantry, ants)
    if (ctx.isAllied(vehicle.house, other.house)) continue; // C++ IsAFriend — don't crush allies
    const oc = other.cell;
    if (oc.cx !== vc.cx || oc.cy !== vc.cy) continue;
    // C++ unit.cpp:4408 — Distance(object->Center_Coord()) < CELL_LEPTON_W/2
    // Sub-cell distance check: crush only if within half a cell (C++ CELL_LEPTON_W/2 = 128 leptons)
    const dx = vehicle.pos.x - other.pos.x;
    const dy = vehicle.pos.y - other.pos.y;
    const distSq = dx * dx + dy * dy;
    const halfCell = CELL_SIZE / 2;
    if (distSq >= halfCell * halfCell) continue;
    {
      damageEntity(ctx, other, other.hp + 10, 'Super'); // instant kill, always die2
      vehicle.creditKill();
      crushed = true;
      ctx.effects.push({
        type: 'blood', x: other.pos.x, y: other.pos.y,
        frame: 0, maxFrames: 6, size: 4, sprite: 'piffpiff', spriteStart: 0,
      } as Effect);
      // Use appropriate death sound based on unit type
      const crushSound = other.isAnt ? 'die_ant' : 'die_infantry';
      ctx.playSoundAt(crushSound, other.pos.x, other.pos.y);
      ctx.map.addDecal(oc.cx, oc.cy, 3, 0.3);
      const crushPoints = other.stats.points ?? other.stats.strength ?? 0;
      if (ctx.isPlayerControlled(vehicle)) {
        ctx.killCount++;
        ctx.pointTotal += crushPoints;
      } else {
        ctx.lossCount++;
        ctx.pointTotal -= crushPoints;
        ctx.playEva('eva_unit_lost');
        const alertCell = other.cell;
        ctx.minimapAlert(alertCell.cx, alertCell.cy);
      }
      // Per-side casualty (C++ score.cpp:548-560)
      const crushFaction = HOUSE_FACTION[other.house] ?? 'allied';
      if (crushFaction === 'soviet') ctx.sovietUnitsLost++;
      else if (crushFaction !== 'both') ctx.alliedUnitsLost++;
    }
  }
  // C++ unit.cpp:4447 — Do_Uncloak() after crushing at least one unit
  if (crushed && vehicle.stats.isCloakable) {
    vehicle.cloakState = CloakState.UNCLOAKING;
    vehicle.cloakTimer = CLOAK_TRANSITION_FRAMES;
  }
}

/** Crushable wall types — C++ odata.cpp IsCrushable flag.
 *  SBAG (sandbag), FENC (fence), BARB (barbwire), WOOD (wood wall), CYCL (cyclone fence)
 *  are crushable. BRIK (brick/concrete) is NOT crushable. */
export const CRUSHABLE_WALLS = new Set(['SBAG', 'FENC', 'BARB', 'WOOD', 'CYCL']);

/** Wall crush — crusher vehicles destroy crushable walls on cell entry.
 *  C++ unit.cpp:1855-1871: Per_Cell_Process checks IsCrusher && overlay IsCrushable.
 *  Crushable walls (SBAG, FENC, BARB, WOOD) are destroyed instantly.
 *  Non-crushable walls (BRIK) are left intact. Calls Reduce_Wall(-1) in C++. */
export function checkWallCrush(ctx: CombatContext, vehicle: Entity): void {
  if (!vehicle.stats.crusher) return;
  const vc = vehicle.cell;
  const wallType = ctx.map.getWallType(vc.cx, vc.cy);
  if (wallType === '' || !CRUSHABLE_WALLS.has(wallType)) return;

  // C++ unit.cpp:3108-3109 — wall crush checks wall owner alliance.
  // Only crush enemy/neutral walls, not allied walls.
  let wallStruct: MapStructure | undefined;
  for (const s of ctx.structures) {
    if (s.alive && s.cx === vc.cx && s.cy === vc.cy && s.type === wallType) {
      wallStruct = s;
      break;
    }
  }
  // If we found the wall structure, check alliance — don't crush allied walls
  if (wallStruct && ctx.isAllied(vehicle.house, wallStruct.house)) return;

  // Destroy the wall overlay on the map
  ctx.map.clearWallType(vc.cx, vc.cy);
  ctx.map.addDecal(vc.cx, vc.cy, 4, 0.3);

  // Destroy the corresponding wall structure (mark dead, clear footprint)
  if (wallStruct) {
    wallStruct.alive = false;
    wallStruct.rubble = true;
    ctx.clearStructureFootprint(wallStruct);
  }

  // C++ unit.cpp:1864-1868: sandbag gets VOC_SANDBAG, others get VOC_WALLKILL2
  const crushSound = wallType === 'SBAG' ? 'wallkill_sand' : 'wallkill2';
  ctx.playSoundAt(crushSound, vc.cx * CELL_SIZE + CELL_SIZE / 2, vc.cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Launch a projectile with travel time — damage is deferred until arrival */
export function launchProjectile(
  ctx: CombatContext, attacker: Entity, target: Entity | null, weapon: WeaponStats,
  damage: number, impactX: number, impactY: number, directHit: boolean,
  launchCoordOverride?: { lx: number; ly: number },
): void {
  // C++ techno.cpp:3124-3171 launches bullets from Fire_Coord(which), not
  // Center_Coord(). The fire coordinate feeds projectile range, facing, fuse
  // proximity, and the initial BulletClass::Unlimbo position.
  const launchCoord = launchCoordOverride ?? (
    typeof attacker.fireCoordForWeapon === 'function' ? attacker.fireCoordForWeapon(weapon) :
      weapon === attacker.weapon && typeof attacker.fireCoordPrimary === 'function' ? attacker.fireCoordPrimary() :
        { lx: attacker.leptonX, ly: attacker.leptonY }
  );
  const targetLX = pixelToLepton(impactX);
  const targetLY = pixelToLepton(impactY);
  const dist = leptonDist(launchCoord.lx, launchCoord.ly, targetLX, targetLY);
  // C++ weapon Speed is an MPHType already expressed in lepton-speed units.
  // Older TS projectileSpeed fields are cells/tick approximations; prefer the
  // rules.ini Speed (`projSpeed`) whenever present.
  const maxSpeed = weapon.projSpeed !== undefined
    ? iniSpeedToMph(weapon.projSpeed)
    : Math.max(1, Math.trunc(weapon.projectileSpeed! * LEPTON_SIZE));
  // C++ bullet.cpp:736-771 — Speed=100/Inviso=yes bullets are placed at the
  // target coordinate, converted to MPH_IMMOBILE for FlyClass, then armed with
  // a normal fuse. They still exist as BulletClass objects; damage/scatter
  // happens in BulletClass::AI, not inside InfantryClass::Fire_At.
  const isLightSpeedInvisible = weapon.isInvisible && maxSpeed === LIGHT_SPEED;
  const bulletStartLX = isLightSpeedInvisible ? targetLX : launchCoord.lx;
  const bulletStartLY = isLightSpeedInvisible ? targetLY : launchCoord.ly;
  const fuseDist = leptonDist(bulletStartLX, bulletStartLY, targetLX, targetLY);
  let speed = isLightSpeedInvisible ? 0 : maxSpeed;
  const travelFrames = Math.max(1, Math.trunc(fuseDist / maxSpeed) + 4);

  // C++ bullet.cpp:756-771 — arcing projectile ground speed is adjusted by
  // target distance after the fuse range is computed from MaxSpeed.
  const isArcing = !!weapon.isArcing;
  if (isArcing) {
    speed = Math.max(maxSpeed + Math.trunc(fuseDist / 32), 25);
  }

  const speedAdd = isLightSpeedInvisible || speed === LIGHT_SPEED
    ? 0
    : Math.trunc((speed * 255 + 128) / 256);

  // C++ bullet.cpp:1012-1014 — invisible projectiles Coord_Scatter on DETONATION.
  // Verified via WASM tag 50002 (Coord_Scatter dir pick) at SCG03EA tick 267 bullet[282].
  // Scatter is consumed when bullet.AI → Bullet_Explodes runs, NOT at launch. For
  // non-instant invisible bullets (Dumbullet: Speed=100, Inviso=yes), launch tick ≠
  // detonation tick, so firing at launch put the RNG 1+ tick early. The RNG is now
  // consumed at detonation time in updateInflightProjectiles.

  // C++ bullet.cpp:783-789 — ballistic arc initialization for isArcing weapons
  // Riser = ((Distance/2) / (speed+1)) * Rule.Gravity, min 10
  // This gives enough upward velocity to keep the projectile airborne for ~travelFrames ticks.
  let arcHeight = 0;
  let arcRiser = 0;
  if (isArcing) {
    arcHeight = 1; // C++ bullet.cpp:786 — Height = 1
    // C++ formula: Riser = ((Distance(tcoord)/2) / (speed+1)) * Rule.Gravity
    arcRiser = Math.max(10, Math.trunc(Math.trunc(fuseDist / 2) / (speed + 1)) * RULE_GRAVITY);
  }

  // C++ infantry.cpp:3649-3654 — dog-rides-bullet: dog enters limbo when firing
  // The dog is removed from the map, becomes invisible and untargetable,
  // and rides the bullet to the target. On impact, the dog unlimbos at the impact point.
  let dogRiderId = -1;
  if (attacker.type === UnitType.I_DOG && attacker.alive) {
    attacker.inLimbo = true;
    dogRiderId = attacker.id;
  }

  ctx.inflightProjectiles.push({
    attackerId: attacker.id,
    targetId: target?.id ?? -1,
    weapon,
    damage,
    strength: damage,  // C++ bullet.cpp:478 — initialized to weapon damage, decremented if IsDegenerate
    speed,
    travelFrames,
    currentFrame: 0,
    directHit,
    impactX,
    impactY,
    attackerIsPlayer: ctx.isPlayerControlled(attacker),
    isArcing,
    arcHeight,
    arcRiser,
    startX: bulletStartLX * CELL_SIZE / LEPTON_SIZE,
    startY: bulletStartLY * CELL_SIZE / LEPTON_SIZE,
    dogRiderId,
    // C++ fuse.cpp — Timer = range = (distance/speed) + 4, capped at 0xFF.
    // `travelFrames` already includes bullet.cpp's +4 range bias.
    fuelTimer: Math.min(0xFF, travelFrames),
    isFueled: !!weapon.isFueled,
    // C++ bullet.cpp:790-802 — IsDropping: start at FLIGHT_LEVEL, fall with gravity
    isDropping: !!weapon.isDropping,
    dropHeight: weapon.isDropping ? 24 : 0,  // C++ FLIGHT_LEVEL = 24 pixels
    // C++ bullet.cpp:377-386 — IsFlameEquipped: flame trail toggle
    isFlameEquipped: !!weapon.isFlameEquipped,
    flameToggle: false,  // C++ IsToAnimate starts false
    logicalLX: bulletStartLX,
    logicalLY: bulletStartLY,
    headToLX: targetLX,
    headToLY: targetLY,
    facing256: directionToLeptons256(bulletStartLX, bulletStartLY, targetLX, targetLY),
    speedAccum: 0,
    speedAdd,
    fuseTimer: Math.min(0xFF, travelFrames),
    armingTimer: 0,
    proximity: fuseDist,
  });
}

/** Launch a projectile from a defensive structure.
 *  C++ BuildingClass::Fire_At still creates a BulletClass for invisible
 *  electric weapons (TeslaZap). Damage/scatter happens in BulletClass::AI,
 *  not synchronously in BuildingClass::Mission_Attack. */
function launchStructureProjectile(
  ctx: CombatContext,
  s: MapStructure,
  target: Entity,
  weapon: StructureWeapon,
): void {
  const targetLX = target.leptonX;
  const targetLY = target.leptonY;
  const targetX = targetLX * CELL_SIZE / LEPTON_SIZE;
  const targetY = targetLY * CELL_SIZE / LEPTON_SIZE;
  const { lx: launchLX, ly: launchLY } = structureFireLeptons(s);
  const maxSpeed = weapon.projSpeed !== undefined
    ? iniSpeedToMph(weapon.projSpeed)
    : LIGHT_SPEED;
  const isInvisible = maxSpeed === LIGHT_SPEED;
  const bulletStartLX = isInvisible ? targetLX : launchLX;
  const bulletStartLY = isInvisible ? targetLY : launchLY;
  const fuseDist = leptonDist(bulletStartLX, bulletStartLY, targetLX, targetLY);
  const speed = isInvisible ? 0 : maxSpeed;
  const travelFrames = Math.max(1, Math.trunc(fuseDist / maxSpeed) + 4);
  const speedAdd = isInvisible || speed === LIGHT_SPEED
    ? 0
    : Math.trunc((speed * 255 + 128) / 256);

  ctx.inflightProjectiles.push({
    attackerId: -1,
    attackerHouse: s.house,
    targetId: target.id,
    weapon: {
      name: s.type === 'TSLA' ? 'TeslaZap' : s.type,
      damage: weapon.damage,
      rof: weapon.rof,
      range: weapon.range,
      warhead: (weapon.warhead ?? 'HE') as WarheadType,
      splash: weapon.splash,
      projSpeed: weapon.projSpeed,
      isInvisible,
      isAntiAir: weapon.isAntiAir,
    },
    damage: weapon.damage,
    strength: weapon.damage,
    speed,
    travelFrames,
    currentFrame: 0,
    directHit: true,
    impactX: targetX,
    impactY: targetY,
    attackerIsPlayer: ctx.isAllied(s.house, ctx.playerHouse),
    isArcing: false,
    arcHeight: 0,
    arcRiser: 0,
    startX: bulletStartLX * CELL_SIZE / LEPTON_SIZE,
    startY: bulletStartLY * CELL_SIZE / LEPTON_SIZE,
    dogRiderId: -1,
    fuelTimer: Math.min(0xFF, travelFrames),
    isFueled: false,
    isDropping: false,
    dropHeight: 0,
    isFlameEquipped: false,
    flameToggle: false,
    logicalLX: bulletStartLX,
    logicalLY: bulletStartLY,
    headToLX: targetLX,
    headToLY: targetLY,
    facing256: directionToLeptons256(bulletStartLX, bulletStartLY, targetLX, targetLY),
    speedAccum: 0,
    speedAdd,
    fuseTimer: Math.min(0xFF, travelFrames),
    armingTimer: 0,
    proximity: fuseDist,
  });
}

function findCellTechno(ctx: CombatContext, cx: number, cy: number, paybackId: number): Entity | null {
  // C++ CellClass::Cell_Techno() returns an object physically in this cell.
  // Do not use TS occupancy here: it can contain track reservations and infantry
  // destination claims, while torpedo collision only cares about actual technos.
  for (const e of ctx.entities) {
    if (!e.alive || e.inLimbo || e.id === paybackId) continue;
    if (e.isAirUnit && e.flightAltitude > 0) continue;
    if (e.cell.cx === cx && e.cell.cy === cy) return e;
  }
  return null;
}

function projectilePixelPosition(proj: InflightProjectile): WorldPos {
  return {
    x: proj.logicalLX * CELL_SIZE / LEPTON_SIZE,
    y: proj.logicalLY * CELL_SIZE / LEPTON_SIZE,
  };
}

function tickProjectilePhysics(proj: InflightProjectile): void {
  if (proj.speedAdd <= 0) return;
  const actualWithAccum = proj.speedAdd + proj.speedAccum;
  const rem = actualWithAccum % PIXEL_LEPTON_W;
  const actual = actualWithAccum - rem;
  proj.speedAccum = rem;
  if (actual <= 0) return;
  proj.logicalLX += (COS_TABLE_256[proj.facing256] * actual) >> 7;
  proj.logicalLY -= (SIN_TABLE_256[proj.facing256] * actual) >> 7;
}

function tickProjectileFuse(proj: InflightProjectile): boolean {
  if (proj.fuseTimer > 0) proj.fuseTimer--;
  if (proj.armingTimer > 0) {
    proj.armingTimer--;
    return false;
  }
  if (proj.fuseTimer <= 0) return true;

  const proximity = leptonDist(proj.logicalLX, proj.logicalLY, proj.headToLX, proj.headToLY);
  if (proximity < 0x0010) return true;
  if (proximity < LEPTON_SIZE && proximity > proj.proximity) return true;
  proj.proximity = proximity;
  return false;
}

/** Advance in-flight projectiles; apply damage + splash on arrival */
export function updateInflightProjectiles(ctx: CombatContext): void {
  const arrived: InflightProjectile[] = [];

  for (const proj of ctx.inflightProjectiles) {
    proj.currentFrame++;

    // C++ bullet.cpp:478-480 — IsDegenerate: projectile loses 1 strength per tick during flight (min 5)
    if (proj.weapon.isDegenerate && proj.strength > 5) {
      proj.strength--;
    }

    // C++ fuse.cpp:127 — fuel timer always decrements each tick (FuseClass::Fuse_Checkup)
    if (proj.fuelTimer > 0) {
      proj.fuelTimer--;
    }

    // C++ bullet.cpp:790-802 — IsDropping: vertical drop from FLIGHT_LEVEL with gravity
    // dropHeight decreases by RULE_GRAVITY each tick; when it reaches 0, bullet lands
    if (proj.isDropping && proj.dropHeight > 0) {
      proj.dropHeight -= RULE_GRAVITY;
    }

    // C++ bullet.cpp:377-386 — IsFlameEquipped: spawn flame/smoke trail every other tick
    if (proj.isFlameEquipped) {
      if (proj.flameToggle) {
        // Spawn visual flame trail at projectile's current interpolated position
        const t = proj.currentFrame / Math.max(1, proj.travelFrames);
        const curX = proj.startX + (proj.impactX - proj.startX) * Math.min(t, 1);
        const curY = proj.startY + (proj.impactY - proj.startY) * Math.min(t, 1);
        ctx.effects.push({
          type: 'explosion',
          x: curX,
          y: curY,
          frame: 0,
          maxFrames: 14,  // ANIM_FBALL_FADE frame count
          size: 8,
          sprite: 'napalm1',  // closest match to FBALL_FADE in our sprite set
        });
      }
      proj.flameToggle = !proj.flameToggle;  // C++ IsToAnimate = !IsToAnimate
    }

    // C++ BulletClass::AI always runs FlyClass::Physics before fuse handling.
    // Arcing projectiles are still normal BulletClass objects here: they move
    // horizontally via FlyClass and only their Height/Riser is special.
    const useFlyPhysicsCoord = !proj.isDropping;
    if (useFlyPhysicsCoord) {
      tickProjectilePhysics(proj);
    }

    // C++ object.cpp:237-254 — ballistic arc gravity simulation
    // Each tick: Height += Riser; Riser -= Rule.Gravity
    // When Height <= 0, the bullet has landed → explode (bullet.cpp:359: forced = IsArcing && !IsFalling)
    if (proj.isArcing) {
      proj.arcHeight += proj.arcRiser;
      proj.arcRiser -= RULE_GRAVITY;
      // C++ object.cpp:254 — clamp riser to prevent runaway negative velocity
      proj.arcRiser = Math.max(proj.arcRiser, -100);
    }

    // C9/C10: Homing projectile tracking (C++ bullet.cpp:368,517)
    // projectileROT = homing turn rate. C10: homing updates every other frame.
    const target = ctx.entityById.get(proj.targetId);
    if (target && target.alive) {
      const rot = proj.weapon.projectileROT ?? 0;
      if (rot > 0) {
        // C10: Only update homing every other frame (C++ bullet.cpp:368)
        if (proj.currentFrame % 2 === 0) {
          // Homing: strong tracking based on ROT (higher ROT = better tracking)
          const trackFactor = Math.min(1.0, rot * 0.15);
          proj.impactX += (target.pos.x - proj.impactX) * trackFactor;
          proj.impactY += (target.pos.y - proj.impactY) * trackFactor;
        }
      }
      // Non-homing projectiles (rot=0) fly straight — no tracking (C++ bullet.cpp)
    }

    // C++ bullet.cpp:903-913 — wall collision check (Is_Forced_To_Explode)
    // Non-high bullets that enter a cell containing a wall (high overlay) explode on contact.
    // Dropping projectiles skip this check (C++ type.h:1383: "Dropping projectiles do not
    // calculate collision with terrain (such as walls)").
    if (!proj.weapon.isHigh && !proj.weapon.isDropping) {
      const t = proj.currentFrame / Math.max(1, proj.travelFrames);
      const cur = useFlyPhysicsCoord ? projectilePixelPosition(proj) : null;
      const curX = cur?.x ?? (proj.startX + (proj.impactX - proj.startX) * Math.min(t, 1));
      const curY = cur?.y ?? (proj.startY + (proj.impactY - proj.startY) * Math.min(t, 1));
      const cc = worldToCell(curX, curY);
      if (ctx.map.getWallType(cc.cx, cc.cy) !== '') {
        // Force-explode at wall cell center (C++ coord = Cell_Coord(Coord_Cell(coord)))
        proj.impactX = cc.cx * CELL_SIZE + CELL_SIZE / 2;
        proj.impactY = cc.cy * CELL_SIZE + CELL_SIZE / 2;
        proj.travelFrames = proj.currentFrame; // land now
        arrived.push(proj);
        continue;
      }
    }

    // C++ bullet.cpp:920-941 — torpedo water boundary check (Is_Forced_To_Explode)
    // Subsurface projectiles (torpedoes) check land type each frame and explode if they leave water.
    if (proj.weapon.isSubSurface) {
      const t = proj.currentFrame / Math.max(1, proj.travelFrames);
      const cur = useFlyPhysicsCoord ? projectilePixelPosition(proj) : null;
      const curX = cur?.x ?? (proj.startX + (proj.impactX - proj.startX) * Math.min(t, 1));
      const curY = cur?.y ?? (proj.startY + (proj.impactY - proj.startY) * Math.min(t, 1));
      const cc = worldToCell(curX, curY);
      const curLX = pixelToLepton(curX);
      const curLY = pixelToLepton(curY);
      const fracLX = ((curLX % LEPTON_SIZE) + LEPTON_SIZE) % LEPTON_SIZE;
      const fracLY = ((curLY % LEPTON_SIZE) + LEPTON_SIZE) % LEPTON_SIZE;
      const centerDist = leptonDist(fracLX, fracLY, CELL_CENTER_LEPTON, CELL_CENTER_LEPTON);
      const cellTechno = centerDist < TORPEDO_CENTER_HIT_RADIUS
        ? findCellTechno(ctx, cc.cx, cc.cy, proj.attackerId)
        : null;

      if (ctx.map.getTerrain(cc.cx, cc.cy) !== Terrain.WATER || cellTechno) {
        // C++ bullet.cpp:920-941: subsurface bullets force-explode when they
        // leave water or pass through a cell center containing a techno object
        // other than Payback. If Cell_Techno exists, explosion coord becomes
        // that object's Target_Coord; otherwise it remains the bullet Coord.
        if (cellTechno) {
          proj.impactX = cellTechno.pos.x;
          proj.impactY = cellTechno.pos.y;
        } else {
          proj.impactX = curX;
          proj.impactY = curY;
        }
        proj.travelFrames = proj.currentFrame; // land now
        arrived.push(proj);
        continue;
      }
    }

    // C++ bullet.cpp:946-948 — AA proximity detonation (Is_Forced_To_Explode)
    // Anti-air projectiles detonate when within half a cell (~0x0080 leptons) of an airborne target.
    if (proj.weapon.isAntiAir && target && target.alive && target.isAirUnit && target.flightAltitude > 0) {
      const t = proj.currentFrame / Math.max(1, proj.travelFrames);
      const cur = useFlyPhysicsCoord ? projectilePixelPosition(proj) : null;
      const curX = cur?.x ?? (proj.startX + (proj.impactX - proj.startX) * Math.min(t, 1));
      const curY = cur?.y ?? (proj.startY + (proj.impactY - proj.startY) * Math.min(t, 1));
      const distToTarget = Math.sqrt((curX - target.pos.x) ** 2 + (curY - target.pos.y) ** 2);
      // C++ Distance(TarCom) < 0x0080: 128 leptons = half a cell (CELL_LEPTON_W=256)
      if (distToTarget < CELL_SIZE / 2) {
        proj.impactX = target.pos.x;
        proj.impactY = target.pos.y;
        proj.travelFrames = proj.currentFrame; // detonate now
        arrived.push(proj);
        continue;
      }
    }

    // C++ bullet.cpp:359-361 — IsDropping: force-explode when dropHeight reaches 0
    // (Class->IsDropping && !IsFalling): once height descends to 0, bullet lands
    if (proj.isDropping && proj.dropHeight <= 0 && proj.currentFrame > 0) {
      arrived.push(proj);
      continue;
    }

    // C++ fuse.cpp:139 — IsFueled: force-explode when fuel timer reaches 0 (ran out of fuel mid-air)
    // Fuse_Checkup returns true when Timer == 0 after arming delay expires
    if (proj.isFueled && proj.fuelTimer <= 0) {
      arrived.push(proj);
      continue;
    }

    // C++ bullet.cpp:474 — only dropping projectiles bypass Fuse_Checkup.
    // Arcing projectiles still use the normal proximity/timer fuse and explode
    // at their current Coord; height<=0 is a forced explosion path.
    const hasLanded = proj.isArcing
      ? ((proj.arcHeight <= 0 && proj.currentFrame > 1) || tickProjectileFuse(proj))
      : (!proj.isDropping ? tickProjectileFuse(proj) : (proj.currentFrame >= proj.travelFrames));
    if (hasLanded) {
      // C++ parity (bullet.cpp:446-483): arcing bullets detonate at their CURRENT
      // Coord when Height <= 0. The bullet moves horizontally by velocity each tick
      // via FlyClass::Physics, then ObjectClass::AI updates Height via Riser/Gravity.
      // When Height <= 0 the bullet lands at whatever horizontal position it has
      // reached — which can UNDERSHOOT or OVERSHOOT the original scattered tcoord
      // depending on how flight time (governed by Riser) compares to travel time
      // (dist/speed). Override impactX/Y to the bullet's actual current position.
      if (proj.isArcing) {
        const cur = projectilePixelPosition(proj);
        proj.impactX = cur.x;
        proj.impactY = cur.y;
      } else if (!proj.isDropping) {
        // C++ bullet.cpp:981-985 — normal fuse detonations for non-homing,
        // non-arcing projectiles snap Coord to Fuse_Target() before damage.
        // The projectile's current Coord can be a few leptons away when the
        // proximity fuse trips; damage still uses the stored target coord.
        if ((proj.weapon.projectileROT ?? 0) === 0) {
          proj.impactX = proj.headToLX * CELL_SIZE / LEPTON_SIZE;
          proj.impactY = proj.headToLY * CELL_SIZE / LEPTON_SIZE;
        } else {
          const cur = projectilePixelPosition(proj);
          proj.impactX = cur.x;
          proj.impactY = cur.y;
        }
      }
      arrived.push(proj);
    }
  }

  // Remove arrived projectiles
  ctx.inflightProjectiles = ctx.inflightProjectiles.filter(p => {
    if (arrived.includes(p)) return false;
    // Dropping projectiles are removed when height reaches 0
    if (p.isDropping) return p.dropHeight > 0 || p.currentFrame === 0;
    // Fueled projectiles are removed when fuel runs out
    if (p.isFueled && p.fuelTimer <= 0) return false;
    if (p.isArcing) return p.arcHeight > 0 || p.currentFrame <= 1;
    return !arrived.includes(p);
  });

  // Apply damage for arrived projectiles
  for (const proj of arrived) {
    const target = ctx.entityById.get(proj.targetId);
    const attacker = ctx.entityById.get(proj.attackerId);
    // C++ BulletClass::Detach clears Payback when the firing object is detached
    // (object.cpp Detach_All -> bullet.cpp:636-649). If the source object died
    // before this projectile explodes, damage must see source=NULL; otherwise
    // InfantryClass::Take_Damage scatters away from a dead object instead of
    // using the no-threat Scatter(0) branch.
    const liveAttacker = attacker?.alive && !attacker.inLimbo ? attacker : undefined;

    // C++ bullet.cpp:478-480 — use degraded strength (proj.strength) instead of original damage
    const impactDamage = proj.strength;

    // C++ bullet.cpp:991 — Bullet_Explodes calls Explosion_Damage at ORIGINAL coord, BEFORE
    // the Coord_Scatter for invisible projectiles (line 1012). Damage uses un-scattered
    // position; only anim/effect display uses scattered position.
    {
      const attackerHouse = liveAttacker?.house ?? proj.attackerHouse ?? (proj.attackerIsPlayer ? ctx.playerHouse : House.USSR);
      // C++ combat.cpp:176: range = ICON_LEPTON_W + (ICON_LEPTON_W >> 1) = 1.5 cells
      // Use weapon splash if defined, otherwise default to SPLASH_RADIUS (1.5 cells)
      const splashRadius = (proj.weapon.splash && proj.weapon.splash > 0)
        ? proj.weapon.splash
        : SPLASH_RADIUS;
      applySplashDamage(
        ctx, { x: proj.impactX, y: proj.impactY },
        { damage: impactDamage, warhead: proj.weapon.warhead, splash: splashRadius },
        -1,  // No entity excluded from splash (firer is already excluded inside applySplashDamage)
        attackerHouse, liveAttacker,
      );
    }

    // C++ bullet.cpp:1012-1014 — invisible projectiles Coord_Scatter AFTER damage applied.
    // Consumes 1 Random_Pick(DIR_N, DIR_MAX) via Coord_Scatter → Coord_Move.
    // Tag 50002 verified at SCG03EA tick 267 bullet[282].
    if (proj.weapon.isInvisible) {
      if (ScenarioRandom._tagLogging) {
        ScenarioRandom._sourceTag = 50002;
      }
      const scatterDir256 = ScenarioRandom.nextInRange(0, 255);
      // 0x0020 leptons = 32 leptons = 32 * CELL_SIZE / LEPTON_SIZE pixels
      const scatterPx = 32 * CELL_SIZE / LEPTON_SIZE;
      const angle = scatterDir256 * 2 * Math.PI / 256;
      proj.impactX += Math.cos(angle) * scatterPx;
      proj.impactY += Math.sin(angle) * scatterPx;
    }

    // R8: Impact explosion sprite via C++ Combat_Anim — damage-scaled selection
    const projExpSet = getWarheadProps(proj.weapon.warhead, ctx.scenarioWarheadProps)?.explosionSet ?? 0;
    // Determine land type: air targets at altitude use flak, water terrain uses water sprites
    const projImpactCell = worldToCell(proj.impactX, proj.impactY);
    const projTarget = ctx.entityById.get(proj.targetId);
    const projLand: 'ground' | 'water' | 'air' =
      (projTarget && projTarget.isAirUnit && projTarget.flightAltitude > 0) ? 'air' :
      (ctx.map.getTerrain(projImpactCell.cx, projImpactCell.cy) === Terrain.WATER) ? 'water' : 'ground';
    const projImpactSprite = combatAnim(proj.strength, projExpSet, projLand) ?? 'veh-hit1';
    // V2RL SCUD: large explosion + screen shake on impact (C++ IsGigundo=true)
    const isScud = proj.weapon.name === 'SCUD';
    ctx.effects.push({ type: 'explosion', x: proj.impactX, y: proj.impactY,
      frame: 0, maxFrames: EXPLOSION_FRAMES[projImpactSprite] ?? 17, size: isScud ? 20 : 8, sprite: projImpactSprite, spriteStart: 0 } as Effect);
    // C++ travelling bullets are Logic objects. When BulletClass::AI explodes and
    // creates an AnimClass, logic.cpp's dynamic Count() loop reaches the new anim
    // later in that same tick and consumes its IsBrandNew skip immediately.
    // TS batches projectile arrival after the object loop, so mark that first
    // brand-new skip as already accounted for to preserve AnimClass stage timing.
    spawnLogicAnimForSprite(ctx.logicAnims, ctx.effects, projImpactSprite, proj.impactX, proj.impactY, false, true);
    if (isScud) {
      ctx.screenShake = Math.max(ctx.screenShake, 12);
      ctx.playSoundAt('building_explode', proj.impactX, proj.impactY);
    }

    // D5: C++ anim.cpp — IsScorcher=true animations (napalm, fire) plant SMUDGE_SCORCH on ground.
    // Fire warhead (ExplosionSet=3) leaves scorch marks at impact cell.
    // Nuke warhead also scorches (InfDeath=4 = burn). Only on ground, not water/air.
    if (projLand === 'ground' && (proj.weapon.warhead === 'Fire' || proj.weapon.warhead === 'Nuke')) {
      ctx.map.addDecal(projImpactCell.cx, projImpactCell.cy, 7, 0.3);
    }

    // C++ bullet.cpp:112-175 — dog-rides-bullet unlimbo: when bullet arrives, dog exits limbo at impact point
    if (proj.dogRiderId >= 0) {
      const dog = ctx.entityById.get(proj.dogRiderId);
      if (dog && dog.alive) {
        // C++ bullet.cpp:134-161 — Try impact point first, then 8 adjacent cells.
        // If all 9 positions fail (impassable), delete the dog.
        let unlimboed = false;
        const impactCell = worldToCell(proj.impactX, proj.impactY);
        // C++ bullet.cpp:145 — for (int i = -1; i < 8; i++)  (-1 = impact cell, 0-7 = adjacent)
        const offsets: [number, number][] = [
          [0, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0],
        ];
        for (const [dx, dy] of offsets) {
          const cx = impactCell.cx + dx;
          const cy = impactCell.cy + dy;
          if (ctx.map.inBounds(cx, cy) && ctx.map.isPassable(cx, cy)) {
            dog.inLimbo = false;
            dog.setPosition(cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
            // C++ bullet.cpp:152 — Do_Action(DO_DOG_MAUL, true): dog performs maul animation after landing
            dog.animState = AnimState.ATTACK;
            dog.animFrame = 0;
            unlimboed = true;
            break;
          }
        }
        // C++ bullet.cpp:165-167 — if (!unlimbo) delete dog;
        if (!unlimboed) {
          dog.alive = false;
          dog.inLimbo = false;
          dog.mission = Mission.DIE;
        }
      }
    }
  }
}

/** Apply AOE splash damage to entities near an impact point.
 *  CF2/CF3: Uses fixed 1.5-cell radius and C++ inverse-proportional falloff via modifyDamage. */
export function applySplashDamage(
  ctx: CombatContext,
  center: WorldPos, weapon: { damage: number; warhead: WarheadType; splash?: number },
  primaryTargetId: number, attackerHouse: House, attacker?: Entity,
): void {
  // CF3: Universal 1.5-cell splash radius (C++ Explosion_Damage uses ICON_LEPTON_W + ICON_LEPTON_W/2)
  const splashRange = SPLASH_RADIUS;
  const splashRangePixels = splashRange * CELL_SIZE;
  const attackerIsPlayerControlled = ctx.isAllied(attackerHouse, ctx.playerHouse);

  // C++ combat.cpp:207 — splash excludes the FIRER (source), not the direct-hit target.
  // C++ bullet.cpp:991 — Explosion_Damage is the SOLE damage path; there is no separate
  // direct-hit call. The direct-hit target receives damage through this splash calculation
  // at distance ~0, getting full warhead damage.
  const sourceId = attacker?.id ?? -1;

  // C++ combat.cpp:188-222 first snapshots Cell_Occupier() pointers into
  // objects[32], then applies damage. Death side effects may create new
  // infantry, but those new objects are not part of the current explosion.
  // Iterate a snapshot so vehicle crew spawned by handleUnitDeath cannot be
  // damaged by the same blast that created it.
  const entityDamageList = ctx.entities.slice();
  for (const other of entityDamageList) {
    if (!other.alive || other.inLimbo || other.id === sourceId) continue;
    // H2: Splash damage hits ALL units in radius including friendlies (C++ Explosion_Damage)
    const isFriendly = ctx.isAllied(other.house, attackerHouse);
    const distLeptons = leptonDist(pixelToLepton(center.x), pixelToLepton(center.y), other.leptonX, other.leptonY);
    const splashRangeLeptons = splashRange * LEPTON_SIZE;
    // C++ combat.cpp:232 uses a strict bound: `distance < range`.
    // range is ICON_LEPTON_W + ICON_LEPTON_W/2 = 384 leptons, so an object
    // exactly 1.5 cells away is NOT damaged. TS previously used `>`, which
    // included the boundary and over-damaged SCG07EA E1 at (26,58).
    if (distLeptons >= splashRangeLeptons) continue;
    const distCells = distLeptons / LEPTON_SIZE;

    // C++ damage order is:
    //   InfantryClass::Take_Damage prone bias (infantry.cpp:329)
    //   -> TechnoClass bias
    //   -> ObjectClass::Modify_Damage distance falloff (object.cpp:1581).
    //
    // This ordering matters for low splash damage: 15 SA against prone infantry
    // at splash distance becomes 8 before falloff, then truncates to 0. Applying
    // falloff before prone bias incorrectly produces 1 damage and a retaliation
    // RNG call (SCG07EA t279).
    let rawDamage = weapon.damage;
    const proneBiasApplied =
      rawDamage > 0 && other.stats.isInfantry && other.isProne;
    if (proneBiasApplied) {
      rawDamage = Math.round(rawDamage * PRONE_DAMAGE_BIAS);
      if (rawDamage <= 0) continue;
    }

    // CF2: C++ inverse-proportional falloff via modifyDamage (combat.cpp:106-125)
    const distPixels = distCells * CELL_SIZE;
    const whMult = getWarheadMult(weapon.warhead, other.stats.armor, ctx.warheadOverrides);
    const splashDmg = modifyDamage(rawDamage, weapon.warhead, other.stats.armor, distPixels, 1.0, whMult, getWarheadMeta(weapon.warhead, ctx.scenarioWarheadMeta).spreadFactor);
    if (splashDmg === 0) continue;
    const killed = damageEntity(ctx, other, splashDmg, weapon.warhead, attacker, {
      skipProneBias: proneBiasApplied,
    });
    // Retaliation is now handled inside damageEntity (C++ FootClass::Take_Damage
    // unified entry point — foot.cpp:1166-1234).

    if (killed) {
      if (!isFriendly && attacker) attacker.creditKill();
      handleUnitDeath(ctx, other, {
        screenShake: 4, explosionSize: 12, debris: false,
        decal: null,
        explodeLgSound: false,
        attackerIsPlayer: !isFriendly && attackerIsPlayerControlled,
        trackLoss: !isFriendly,
        friendlyFireLoss: isFriendly && attackerIsPlayerControlled,
        attacker,
      });
    }
  }

  // C++ parity: Explosion_Damage (combat.cpp:205-237) iterates Cell_Occupier() chains which
  // include buildings. Structures within splash radius take damage proportional to distance.
  // Buildings at the impact cell get distance=0 (full damage, combat.cpp:227-228).
  const impactCell = worldToCell(center.x, center.y);
  for (const s of ctx.structures) {
    if (!s.alive) continue;
    // Walls are C++ overlays, not ordinary BuildingClass damage targets in
    // Explosion_Damage. They are handled by the impact-cell Reduce_Wall path below.
    if (WALL_TYPES.has(s.type)) continue;
    const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
    // Structure world center (matches structureDamage explosion origin)
    const swx = s.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
    const swy = s.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
    // C++ combat.cpp:227-228: if building occupies the impact cell, distance = 0
    const occupiesImpactCell =
      impactCell.cx >= s.cx && impactCell.cx < s.cx + sw &&
      impactCell.cy >= s.cy && impactCell.cy < s.cy + sh;
    let distCells: number;
    if (occupiesImpactCell) {
      distCells = 0;
    } else {
      distCells = leptonDist(pixelToLepton(center.x), pixelToLepton(center.y), pixelToLepton(swx), pixelToLepton(swy)) / LEPTON_SIZE;
    }
    if (distCells > splashRange) continue;
    if (attacker) {
      // C++ combat.cpp:232-237 calls BuildingClass::Take_Damage for any
      // in-range building with the raw explosion strength. building.cpp:1250
      // then calls Base_Is_Attacked(source) before ObjectClass::Take_Damage
      // applies armor/distance falloff. Preserve that ordering: base defense can
      // suspend teams even when final structure HP damage is reduced to zero.
      maybeSuspendTeamsForBaseAttack(ctx, attacker, s.house, Boolean(STRUCTURE_WEAPONS[s.type]));
    }
    // Apply damage using per-building armor from rules.ini (C++ bdata.cpp)
    const distPixels = distCells * CELL_SIZE;
    const sArmor = s.armor ?? (STRUCTURE_ARMOR[s.type] ?? 'wood');
    const whMult = getWarheadMult(weapon.warhead, sArmor, ctx.warheadOverrides);
    const splashDmg = modifyDamage(weapon.damage, weapon.warhead, sArmor, distPixels, 1.0, whMult, getWarheadMeta(weapon.warhead, ctx.scenarioWarheadMeta).spreadFactor);
    if (splashDmg <= 0) continue;
    structureDamage(ctx, s, splashDmg);
  }

  const whMeta = getWarheadMeta(weapon.warhead, ctx.scenarioWarheadMeta);

  // C++ combat.cpp:240-257 — overlay wall damage is impact-cell only.
  // If the impact cell contains a wall and the warhead can damage that wall type,
  // CellClass::Reduce_Wall(strength) either destroys immediately when strength is
  // high enough, or consumes Random_Pick(0, DamagePoints) for probabilistic damage.
  {
    const wallType = ctx.map.getWallType(impactCell.cx, impactCell.cy);
    const canDamageWall =
      wallType !== '' &&
      (whMeta.destroysWalls || (whMeta.destroysWood && WOODEN_WALL_TYPES.has(wallType)));

    if (canDamageWall) {
      const damagePoints = WALL_DAMAGE_POINTS[wallType] ?? 1;
      const damageLevels = WALL_DAMAGE_LEVELS[wallType] ?? 1;
      const reduced =
        weapon.damage === -1 ||
        weapon.damage >= damagePoints ||
        ScenarioRandom.nextInRange(0, damagePoints) < weapon.damage;

      if (reduced) {
        const nextLevel = ctx.map.getWallDamageLevel(impactCell.cx, impactCell.cy) + 1;
        const clearsWithUndamagedShape = nextLevel === damageLevels - 1;
        if (weapon.damage === -1 || nextLevel >= damageLevels || clearsWithUndamagedShape) {
          ctx.map.clearWallType(impactCell.cx, impactCell.cy);
          ctx.map.addDecal(impactCell.cx, impactCell.cy, 4, 0.3);
          const wallStruct = ctx.structures.find(s =>
            s.alive && s.cx === impactCell.cx && s.cy === impactCell.cy && s.type === wallType);
          if (wallStruct) {
            wallStruct.alive = false;
            wallStruct.rubble = true;
            ctx.clearStructureFootprint(wallStruct);
          }
        } else {
          ctx.map.setWallDamageLevel(impactCell.cx, impactCell.cy, nextLevel);
        }
      }
    }
  }

  // C++ combat.cpp:242-246 — tiberium/ore overlay reduction is also impact-cell
  // only. Wide_Area_Damage reaches multiple cells by calling Explosion_Damage for
  // each cell, not by making one explosion reduce every ore cell in radius.
  if (whMeta.destroysOre) {
    ctx.map.reduceOreLevel(impactCell.cx, impactCell.cy);
  }

  // C++ combat.cpp:261-268 — bridge destruction from splash damage.
  // Only AP and HE warheads can damage bridges. Damage chance:
  // Random_Pick(1, BridgeStrength=1000) < damage. For damage=200, ~20% chance.
  if ((weapon.warhead === 'AP' || weapon.warhead === 'HE') && ctx.map.templateType) {
    const impactCell = worldToCell(center.x, center.y);
    const bridgeIdx = impactCell.cy * MAP_CELLS + impactCell.cx;
    const tmpl = ctx.map.templateType[bridgeIdx];
    // C++ bridge template IDs: 131,133 (intact), 235,236 (1A/1B), 238,239 (2A/2B), 241,242 (3A/3B), 378,379 (half-destroyed)
    // combat.cpp:261-265 checks all 10 bridge template types for splash damage
    if (tmpl === 131 || tmpl === 133 || tmpl === 235 || tmpl === 236 || tmpl === 238 || tmpl === 239 || tmpl === 241 || tmpl === 242 || tmpl === 378 || tmpl === 379) {
      // C++ combat.cpp:267 — Random_Pick(1, Rule.BridgeStrength) < strength
      // BridgeStrength sourced from AI_BUILD_RULES (rules.ini [General] BridgeStrength=1000)
      if (ScenarioRandom.nextInRange(1, AI_BUILD_RULES.bridgeStrength) < weapon.damage) {
        const destroyed = ctx.map.destroyBridge(impactCell.cx, impactCell.cy, 3);
        if (destroyed > 0) {
          killBridgeOccupants(ctx, impactCell.cx, impactCell.cy, 3);
          ctx.bridgeCellCount = ctx.map.countBridgeCells();
          ctx.showEvaMessage(7); // "Bridge destroyed."
        }
      }
    }
  }

  // Terrain destruction: trees are TerrainClass objects and take radius damage.
  if (splashRange >= 1.5 && weapon.damage >= 30) {
    const cc = worldToCell(center.x, center.y);
    const r = Math.ceil(splashRange);
    const damagedTrees = new Set<MapTree>(); // dedup: same tree may span multiple cells in blast
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > splashRange * splashRange) continue;
        const tx = cc.cx + dx;
        const ty = cc.cy + dy;
        // C++ parity: tree damage — deterministic HP-based (RA terrain.cpp:108-151).
        // Trees have 600 HP and ARMOR_WOOD. Immune trees (clumps) skip damage.
        // SA warhead cannot destroy terrain (terrain.cpp:118).
        const hitTree = ctx.map.getTreeAtCell(tx, ty);
        if (hitTree && !hitTree.immune && hitTree.hp > 0 && weapon.warhead !== 'SA' && !damagedTrees.has(hitTree)) {
          damagedTrees.add(hitTree);
          // C++ terrain.cpp Center_Coord: distance from explosion to tree center (not origin).
          // XYP_COORD gives pixel offset from origin cell's top-left to tree center.
          const centerOff = TREE_CENTER_OFFSET[hitTree.type];
          const treeCenterX = hitTree.cx * CELL_SIZE + (centerOff ? centerOff[0] : CELL_SIZE / 2);
          const treeCenterY = hitTree.cy * CELL_SIZE + (centerOff ? centerOff[1] : CELL_SIZE / 2);
          const distPixels = Math.sqrt(
            (center.x - treeCenterX) ** 2 + (center.y - treeCenterY) ** 2,
          );
          const treeDmg = modifyDamage(weapon.damage, weapon.warhead, 'wood', distPixels);
          if (treeDmg > 0) {
            hitTree.hp = Math.max(0, hitTree.hp - treeDmg);
            if (hitTree.hp <= 0) {
              // Tree destroyed — clear from map (C++ terrain.cpp Start_To_Crumble + destructor)
              ctx.map.destroyTree(hitTree);
              ctx.map.addDecal(hitTree.cx, hitTree.cy, 6, 0.4); // stump/scorch mark
              ctx.effects.push({
                type: 'explosion',
                x: hitTree.cx * CELL_SIZE + CELL_SIZE / 2,
                y: hitTree.cy * CELL_SIZE + CELL_SIZE / 2,
                frame: 0, maxFrames: 10, size: 8,
                sprite: 'piffpiff', spriteStart: 0,
              } as Effect);
            }
          }
        }
      }
    }
  }
}

/** Damage a structure, return true if destroyed.
 *  Extracted from Game class (index.ts) — handles HP reduction, destruction effects,
 *  AI base attack tracking, EVA alerts, gap generator unjam, footprint clearing,
 *  bridge destruction, and structure explosion blast damage to nearby units. */
export function structureDamage(ctx: CombatContext, s: MapStructure, damage: number, source?: Entity): boolean {
  if (!s.alive) return false;
  if (source) maybeSuspendTeamsForBaseAttack(ctx, source, s.house, Boolean(STRUCTURE_WEAPONS[s.type]));
  // C++ house.cpp:2751 — Iron Curtain makes structures invulnerable (no damage taken)
  if (s.ironCurtainTicks && s.ironCurtainTicks > 0) return false;
  s.hp = Math.max(0, s.hp - damage);
  // C++ flasher.cpp:83-95 + house.cpp:2308 — Blushing damage flash.
  // Set FlashCount to 6 so 3 odd ticks (5, 3, 1) render the white "lightening" tint.
  // Keeps existing countdown if larger so repeated hits stack gracefully.
  s.flashCount = Math.max(s.flashCount ?? 0, 6);
  // Track attacked trigger names for TEVENT_ATTACKED
  if (s.triggerName) ctx.attackedTriggerNames.add(s.triggerName);
  // Record base attack for AI defense system
  const aiState = ctx.aiStates.get(s.house);
  if (aiState) {
    aiState.lastBaseAttackTick = ctx.tick;
    aiState.underAttack = true;
  }
  // EVA "base under attack" for player structures (throttled)
  if (ctx.isAllied(s.house, ctx.playerHouse) &&
      ctx.tick - ctx.lastBaseAttackEva > ctx.gameTicksPerSec * 60) {
    ctx.lastBaseAttackEva = ctx.tick;
    ctx.playEva('eva_base_attack');
    ctx.minimapAlert(s.cx, s.cy);
  }
  if (s.hp <= 0) {
    s.alive = false;
    s.rubble = true;
    // GAP1: unjam shroud when Gap Generator is destroyed
    if (s.type === 'GAP') {
      const si = ctx.structures.indexOf(s);
      if (si >= 0 && ctx.gapGeneratorCells.has(si)) {
        const prev = ctx.gapGeneratorCells.get(si)!;
        ctx.map.unjamRadius(prev.cx, prev.cy, prev.radius);
        ctx.gapGeneratorCells.delete(si);
      }
    }
    // Track enemy building destruction count (excluding walls)
    if (!ctx.isAllied(s.house, ctx.playerHouse) && !WALL_TYPES.has(s.type)) {
      ctx.nBuildingsDestroyedCount++;
    }
    // Clear terrain footprint so units can walk through rubble
    ctx.clearStructureFootprint(s);
    // Spawn destruction explosion chain — small pops then big blast (like original RA)
    const wx = s.cx * CELL_SIZE + CELL_SIZE;
    const wy = s.cy * CELL_SIZE + CELL_SIZE;
    const [fw, fh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
    // Small pre-explosions scattered across the building footprint (scale with building size)
    const numPreExplosions = Math.max(3, Math.min(6, fw * fh));
    for (let i = 0; i < numPreExplosions; i++) {
      const ox = (ScenarioRandom.float() - 0.5) * fw * CELL_SIZE;
      const oy = (ScenarioRandom.float() - 0.5) * fh * CELL_SIZE;
      ctx.effects.push({
        type: 'explosion', x: wx + ox, y: wy + oy,
        frame: -i * 3, maxFrames: 12, size: 8, // staggered start via negative frame
        sprite: 'veh-hit1', spriteStart: 0,
      } as Effect);
    }
    // C++ building.cpp:1442-1458 — per-cell fire scatter across the building footprint.
    // For every occupied cell: 50% chance ANIM_FIRE_SMALL (fire1/fire2/fire3), then within
    // that, 50% chance ANIM_FIRE_MED on top — yielding 50%/25% per cell.
    // C++ Random_Pick(0, 7) chooses the start frame; Random_Pick(1, 3) sets delay.
    const FIRE_SMALL_SPRITES = ['fire1', 'fire2', 'fire3']; // ANIM_FIRE_SMALL*
    const FIRE_MED_SPRITES   = ['fire1', 'fire2'];          // ANIM_FIRE_MED variants
    for (let cy = 0; cy < fh; cy++) {
      for (let cx = 0; cx < fw; cx++) {
        // C++ Coord_Scatter(0x0080) — half-cell random offset (0x0080 = 128 leptons = 0.5 cell)
        const cellWx = (s.cx + cx) * CELL_SIZE + CELL_SIZE / 2;
        const cellWy = (s.cy + cy) * CELL_SIZE + CELL_SIZE / 2;
        if (ScenarioRandom.float() < 0.5) {
          const sx = cellWx + (ScenarioRandom.float() - 0.5) * CELL_SIZE;
          const sy = cellWy + (ScenarioRandom.float() - 0.5) * CELL_SIZE;
          const sprite = FIRE_SMALL_SPRITES[ScenarioRandom.nextInRange(0, FIRE_SMALL_SPRITES.length - 1)];
          ctx.effects.push({
            type: 'explosion', x: sx, y: sy,
            frame: -ScenarioRandom.nextInRange(1, 3), // staggered start (C++ delay)
            maxFrames: EXPLOSION_FRAMES[sprite] ?? 14, size: 8,
            sprite, spriteStart: 0,
          } as Effect);
          if (ScenarioRandom.float() < 0.5) {
            const mx = cellWx + (ScenarioRandom.float() - 0.5) * (CELL_SIZE / 2);
            const my = cellWy + (ScenarioRandom.float() - 0.5) * (CELL_SIZE / 2);
            const msprite = FIRE_MED_SPRITES[ScenarioRandom.nextInRange(0, FIRE_MED_SPRITES.length - 1)];
            ctx.effects.push({
              type: 'explosion', x: mx, y: my,
              frame: -ScenarioRandom.nextInRange(1, 3),
              maxFrames: EXPLOSION_FRAMES[msprite] ?? 14, size: 12,
              sprite: msprite, spriteStart: 0,
            } as Effect);
          }
        }
      }
    }
    // D4: SMOKE_M trailing smoke — 2-3 persistent ground-smoke puffs near the debris
    // (C++ anim.cpp ANIM_SMOKE_M is a looping smoke column left on the ground).
    const numSmoke = 2 + Math.floor(ScenarioRandom.float() * 2); // 2-3
    for (let si = 0; si < numSmoke; si++) {
      const sx = wx + (ScenarioRandom.float() - 0.5) * fw * CELL_SIZE;
      const sy = wy + (ScenarioRandom.float() - 0.5) * fh * CELL_SIZE;
      ctx.effects.push({
        type: 'explosion', x: sx, y: sy,
        frame: 0, maxFrames: 80, size: 10,
        sprite: 'smoke_m', spriteStart: 0,
        loopStart: 0, loopEnd: 20, loops: 4, // loop 4× so it persists ~80 ticks
      } as Effect);
    }
    // Final large explosion — size-matched to building footprint (C++ parity)
    const maxDimPx = Math.max(fw, fh) * CELL_SIZE;
    const deathExplosionRadius = Math.round(maxDimPx * 0.6);
    ctx.effects.push({
      type: 'explosion', x: wx, y: wy,
      frame: 0, maxFrames: EXPLOSION_FRAMES['fball1'] ?? 18, size: deathExplosionRadius,
      sprite: 'fball1', spriteStart: 0,
    } as Effect);
    // C++ building.cpp:1257-1273 — per-footprint-cell destruction scatter:
    // always a crater smudge + FBALL1 scattered 0x0040 leptons; 50% FIRE-SMALL
    // scattered 0x0080, and within that 50% a FIRE-MED at 0x0040.
    // 0x0040 leptons = 64/256 cell = 6px; 0x0080 leptons = 128/256 cell = 12px at CELL_SIZE=24.
    // NOTE: scatter and fire chance use NonCriticalRandom to avoid disturbing the
    // deterministic game RNG (ScenarioRandom) — C++ drives these via Scen.Random, but
    // matching the full per-cell Random_Pick sequence is fragile and visual-only here.
    const LEPTON_40_PX = (0x40 / 256) * CELL_SIZE; // 6px
    const LEPTON_80_PX = (0x80 / 256) * CELL_SIZE; // 12px
    for (let fy = 0; fy < fh; fy++) {
      for (let fx = 0; fx < fw; fx++) {
        const cellCx = s.cx + fx;
        const cellCy = s.cy + fy;
        const cellWx = cellCx * CELL_SIZE + CELL_SIZE / 2;
        const cellWy = cellCy * CELL_SIZE + CELL_SIZE / 2;
        // Always: crater smudge (C++ SmudgeClass SMUDGE_CRATER1..6)
        ctx.map.addDecal(cellCx, cellCy, 10, 0.5);
        // Always: scattered FBALL1 at this cell (C++ ANIM_FBALL1 scatter 0x0040)
        const fbDx = (NonCriticalRandom.float() - 0.5) * LEPTON_40_PX * 2;
        const fbDy = (NonCriticalRandom.float() - 0.5) * LEPTON_40_PX * 2;
        ctx.effects.push({
          type: 'explosion', x: cellWx + fbDx, y: cellWy + fbDy,
          frame: -NonCriticalRandom.nextInRange(0, 3), // C++ Random_Pick(0,3) stagger
          maxFrames: EXPLOSION_FRAMES['fball1'] ?? 18, size: 10,
          sprite: 'fball1', spriteStart: 0,
        } as Effect);
        // 50% chance: FIRE-SMALL scattered 0x0080 (we reuse 'smokey' as the fire/smoke sprite)
        if (NonCriticalRandom.float() < 0.5) {
          const fsDx = (NonCriticalRandom.float() - 0.5) * LEPTON_80_PX * 2;
          const fsDy = (NonCriticalRandom.float() - 0.5) * LEPTON_80_PX * 2;
          ctx.effects.push({
            type: 'explosion', x: cellWx + fsDx, y: cellWy + fsDy,
            frame: -NonCriticalRandom.nextInRange(0, 7), // C++ Random_Pick(0,7) stagger
            maxFrames: 14, size: 6,
            sprite: 'smokey', spriteStart: 0,
          } as Effect);
          // Within that 50%: a second FIRE-MED at 0x0040 scatter
          if (NonCriticalRandom.float() < 0.5) {
            const fmDx = (NonCriticalRandom.float() - 0.5) * LEPTON_40_PX * 2;
            const fmDy = (NonCriticalRandom.float() - 0.5) * LEPTON_40_PX * 2;
            ctx.effects.push({
              type: 'explosion', x: cellWx + fmDx, y: cellWy + fmDy,
              frame: -NonCriticalRandom.nextInRange(0, 7),
              maxFrames: 14, size: 9,
              sprite: 'smokey', spriteStart: 0,
            } as Effect);
          }
        }
      }
    }
    // Flying debris
    ctx.effects.push({
      type: 'debris', x: wx, y: wy,
      frame: 0, maxFrames: 20, size: fw * CELL_SIZE * 0.8,
    } as Effect);
    // C++ building.cpp:1460 — shakes = Class->Cost_Of() / 400
    // Only shakes if result > 0 (cheap buildings like walls/silos don't shake).
    const prodItemForShake = PRODUCTION_ITEMS.find(p => p.type === s.type);
    const buildingCost = prodItemForShake?.cost ?? 0;
    const shakeIntensity = Math.floor(buildingCost / 400);
    if (shakeIntensity > 0) {
      ctx.screenShake = Math.max(ctx.screenShake, shakeIntensity);
    }
    ctx.screenFlash = Math.max(ctx.screenFlash, Math.min(8, fw * 2));
    ctx.playSoundAt('building_explode', wx, wy);
    // Per-side building casualty tracking (C++ score.cpp:548-560)
    const bFaction = HOUSE_FACTION[s.house] ?? 'allied';
    if (bFaction === 'soviet') ctx.sovietBuildingsLost++;
    else if (bFaction !== 'both') ctx.alliedBuildingsLost++;
    if (ctx.isAllied(s.house, ctx.playerHouse)) {
      ctx.structuresLost++;
      ctx.playEva('eva_unit_lost'); // reuse unit_lost for building destruction
      // C++ parity: recalculate silo capacity when storage structure destroyed
      if (s.type === 'PROC' || s.type === 'SILO') {
        ctx.recalculateSiloCapacity();
      }
    }
    // C++ parity: Barrel explosions use directional fire-bullet mechanic,
    // non-barrel structures use generic radial HE blast.
    if (s.type === 'BARL' || s.type === 'BRL3') {
      // C++ building.cpp:1344-1369 — 4 invisible WARHEAD_FIRE bullets,
      // 200 damage each, cardinal directions only (N/E/S/W, 1 cell away)
      const cardinalOffsets = [
        { dx: 0, dy: -1 }, // N
        { dx: 1, dy: 0 },  // E
        { dx: 0, dy: 1 },  // S
        { dx: -1, dy: 0 }, // W
      ];
      for (const off of cardinalOffsets) {
        const targetCx = s.cx + off.dx;
        const targetCy = s.cy + off.dy;
        // Damage entities in cardinal cell — flat 200 Fire damage, no falloff
        for (const e of ctx.entities) {
          if (!e.alive || e.inLimbo) continue;
          const ec = e.cell;
          if (ec.cx === targetCx && ec.cy === targetCy) {
            damageEntity(ctx, e, 200, 'Fire');
          }
        }
        // Damage structures whose footprint overlaps cardinal cell (chain explosions)
        // C++ applies Fire warhead vs armor modifier before structure damage
        for (const s2 of ctx.structures) {
          if (!s2.alive || s2 === s) continue;
          const [s2w, s2h] = STRUCTURE_SIZE[s2.type] ?? [2, 2];
          if (targetCx >= s2.cx && targetCx < s2.cx + s2w &&
              targetCy >= s2.cy && targetCy < s2.cy + s2h) {
            const s2Armor: ArmorType = s2.armor ?? (STRUCTURE_ARMOR[s2.type] ?? 'wood');
            const fireVs = WARHEAD_VS_ARMOR['Fire'][armorIndex(s2Armor)];
            structureDamage(ctx, s2, Math.max(1, Math.round(200 * fireVs)));
          }
        }
      }
    } else {
      // Non-barrel: building death explosions are visual-only for entities.
      // C++ building.cpp death anims (FBALL1) don't create warhead damage circles
      // against units — only barrels have the cardinal-direction bullet mechanic.
      // Structure-to-structure chain damage still applies.
      // Non-barrel: structure-to-structure chain damage (2-cell radius)
      const structBlastRadius = 2;
      for (const s2 of ctx.structures) {
        if (!s2.alive || s2 === s) continue;
        // Structure centers in leptons for distance check
        const s2lx = s2.cx * LEPTON_SIZE + LEPTON_SIZE;
        const s2ly = s2.cy * LEPTON_SIZE + LEPTON_SIZE;
        const wlx = s.cx * LEPTON_SIZE + LEPTON_SIZE;
        const wly = s.cy * LEPTON_SIZE + LEPTON_SIZE;
        const distLeptons = leptonDist(wlx, wly, s2lx, s2ly);
        const dist = distLeptons / LEPTON_SIZE;
        if (dist > structBlastRadius) continue;
        const falloff = 1 - (dist / structBlastRadius) * 0.6;
        const blastDmg = Math.max(1, Math.round(100 * falloff));
        structureDamage(ctx, s2, blastDmg);
      }
    }
    // Leave large scorch mark
    ctx.map.addDecal(s.cx, s.cy, 14, 0.6);
    // Barrel explosion: barrels always explode. Only destroy bridge if barrel is near bridge cells.
    if (s.type === 'BARL' || s.type === 'BRL3') {
      const destroyed = ctx.map.destroyBridge(s.cx, s.cy, 3);
      if (destroyed > 0) {
        killBridgeOccupants(ctx, s.cx, s.cy, 3);
        ctx.bridgeCellCount = ctx.map.countBridgeCells();
        ctx.showEvaMessage(7); // "Bridge destroyed."
      }
    }
    // C++ building.cpp:1298 — IsSurvivorless: kennels and force-destroyed buildings get no survivors
    // C++ sets IsSurvivorless = true when (forced || *this == STRUCT_KENNEL)
    if (s.type === 'KENN') {
      s.isSurvivorless = true;
    }
    // C++ building.cpp:1663-1716 — Drop_Debris: spawn infantry survivors on destruction
    // C++ building.cpp:3444: if (!IsCrewAble()) return 0 — only Crewed=yes buildings spawn survivors
    // C++ building.cpp:5593: if (IsSurvivorless || !Class->IsCrew) return 0
    // Walls, barrels, kennels, silos, naval buildings etc. have no Crewed=yes in rules.ini.
    if (CREWED_BUILDINGS.has(s.type) && !s.isSurvivorless) {
      spawnDestructionSurvivors(ctx, s, wx, wy);
    }
    return true;
  }
  return false;
}

// ── Destruction Survivors ────────────────────────────────────────────────────

/** C++ building costs for survivor count calculation */
const FACT_COST = 2500;  // rules.ini [FACT] Cost=2500
const HARVESTER_COST = 1400;
const HIND_COST = 1200;
const SURVIVOR_FRACTION = 0.4;
const E1_COST = 100;

/**
 * C++ building.cpp:1663-1716 — Drop_Debris: spawn infantry survivors when a building is destroyed.
 * Uses same survivor count formula as sell (How_Many_Survivors), but spawning is probabilistic
 * per occupy cell (1/3 chance normally, simplified here to guaranteed spawning like sell path).
 * Only called for buildings with Crewed=yes (CREWED_BUILDINGS gate at call site).
 *
 * C++ Crew_Type per building (building.cpp:4667-4701):
 *   FACT → 25% E6 (1 max), else E1 | TENT/BARR → E1
 *   default → E1, with 15% civilian (C1/C7) if building has no weapon
 */
function spawnDestructionSurvivors(ctx: CombatContext, s: MapStructure, wx: number, wy: number): void {
  // Calculate survivor count: C++ How_Many_Survivors (building.cpp:5591-5600)
  // C++ building.cpp:3444: if (!IsCrewAble()) return 0 — no min-1 fallback
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === s.type);
  let buildCost = prodItem?.cost ?? (s.type === 'FACT' ? FACT_COST : 300);
  if (s.type === 'PROC') buildCost -= HARVESTER_COST;
  if (s.type === 'HPAD') buildCost -= (HIND_COST + HIND_COST) / 2;
  // C++ building.cpp:5597: if (IsCaptured) divisor *= 2 — captured buildings halve survivor count
  const isCaptured = s.originalHouse !== undefined && s.originalHouse !== s.house;
  let divisor = E1_COST;
  if (isCaptured) divisor *= 2;
  const survivorCount = Math.max(1, Math.min(5,
    Math.floor((buildCost * SURVIVOR_FRACTION) / divisor)));

  // C++ building.cpp:3456-3463 — one engineer limit (applies to both sell and destruction)
  let engineerSpawned = false;
  const isUnarmed = !STRUCTURE_WEAPONS[s.type];

  for (let si = 0; si < survivorCount; si++) {
    let crewType: UnitType;
    switch (s.type) {
      case 'FACT':
        // C++ building.cpp:4680-4684: captured ConYard NEVER spawns an engineer
        if (!isCaptured && !engineerSpawned && ScenarioRandom.float() < 0.25) {
          crewType = UnitType.I_E6;
          engineerSpawned = true;
        } else {
          crewType = UnitType.I_E1;
        }
        break;
      case 'TENT': case 'BARR':
        crewType = UnitType.I_E1;
        break;
      default:
        // C++ techno.cpp:4454-4465 — 15% civilian chance if building has no weapon
        if (isUnarmed && ScenarioRandom.float() < 0.15) {
          crewType = ScenarioRandom.float() < 0.5 ? UnitType.I_C1 : UnitType.I_C7;
        } else {
          crewType = UnitType.I_E1;
        }
        break;
    }
    const inf = new Entity(crewType, s.house, wx + (si % 3 - 1) * 6, wy + Math.floor(si / 3) * 6);
    // C++ building.cpp:1701 — destruction survivors get random HP (5 to MaxStrength)
    inf.hp = Math.max(5, ScenarioRandom.nextInRange(5, inf.maxHp + 4));
    inf.hp = Math.min(inf.hp, inf.maxHp);
    inf.mission = Mission.GUARD;
    // C++ building.cpp:1697 — IsTechnician: IsNominal infantry (E1) get technician star
    // Only buildings with buildup data (most constructed buildings) set this flag
    if (crewType === UnitType.I_E1) {
      inf.isTechnician = true;
    }
    inf.scenarioInitUnlimbo = true;
    ctx.entities.push(inf);
    ctx.entityById.set(inf.id, inf);
  }
}

/** C++ BuildingClass::Greatest_Threat path used by weapon-equipped Mission_Guard.
 *  This is intentionally pure and RNG-free: C++ techno.cpp:2047-2210 scans
 *  nearby objects and returns the highest-scoring target without consuming RNG.
 */
export function findStructureThreatTarget(ctx: CombatContext, s: MapStructure): Entity | null {
    if (!s.alive || !s.weapon || s.sellProgress !== undefined || s.buildProgress !== undefined) return null;
    const range = s.weapon.range;
    let bestTarget: Entity | null = null;
    let bestScore = -Infinity;
    for (const e of ctx.entities) {
      if (!e.alive || e.inLimbo) continue;
      if (ctx.isAllied(s.house, e.house)) continue; // don't shoot friendlies
      // human-requested: SAMs are air-only. Do NOT revert this line.
      if (s.weapon.isAntiAir && (!e.isAirUnit || e.flightAltitude <= 0)) continue;
      if (e.isAirUnit && e.flightAltitude > 0 && !s.weapon.isAntiAir) continue;
      const { lx: structLX, ly: structLY } = structureFireLeptons(s);
      const distLeptons = leptonDist(structLX, structLY, e.leptonX, e.leptonY);
      const dist = distLeptons / LEPTON_SIZE;
      // C++ techno.cpp:1519 In_Range uses <= (lepton distance <= weapon range in leptons).
      // dist is in cells; range is cells. Use > to match C++ <= (reject only strictly out of range).
      if (dist > range) continue;
      // C++ Evaluate_Object (techno.cpp:1470-1763) does NOT check line-of-sight for buildings.
      // C++ techno.cpp:1651-1752 Evaluate_Object threat scoring formula:
      // value = 2 * Points + kills, then distance falloff: (value * 32000) / (distCells + 1)
      const points = e.stats.points ?? e.stats.strength ?? 5;
      const value = Math.trunc(points * 2) + (e.kills ?? 0);
      const distCells = Math.floor(dist);
      const score = Math.max(Math.trunc((value * 32000) / (distCells + 1)), 1);
      if (score > bestScore) {
        bestTarget = e;
        bestScore = score;
      }
    }

    // AA override: SAM/AGUN prefer airborne aircraft over ground targets
    if (s.weapon.isAntiAir && bestTarget) {
      let bestAirTarget: Entity | null = null;
      let bestAirDist = Infinity;
      for (const e of ctx.entities) {
        if (!e.alive || e.inLimbo || !e.isAirUnit || e.flightAltitude <= 0) continue;
        if (ctx.isAllied(s.house, e.house)) continue;
        const { lx: structLX, ly: structLY } = structureFireLeptons(s);
        const distAA = leptonDist(structLX, structLY, e.leptonX, e.leptonY) / LEPTON_SIZE;
        if (distAA < range && distAA < bestAirDist) {
          bestAirTarget = e;
          bestAirDist = distAA;
        }
      }
      if (bestAirTarget) bestTarget = bestAirTarget;
    }
    return bestTarget;
}

function getAssignedStructureTarget(ctx: CombatContext, s: MapStructure): Entity | null {
  if (s.targetEntityId === undefined) return null;
  const target = ctx.entityById.get(s.targetEntityId);
  return target && target.alive && !target.inLimbo ? target : null;
}

/** Per-building combat tick — extracted so it can be called per-building right after its
 *  mission timer tick, matching C++ BuildingClass::AI() which runs timer + Firing_AI
 *  sequentially for each building before advancing to the next.
 *  C++ building.cpp:Firing_AI + building.cpp:5347 Rotation_AI */
export function updateSingleStructureCombat(ctx: CombatContext, s: MapStructure, isLowPower: boolean): void {
    if (!s.alive || !s.weapon || s.sellProgress !== undefined || s.buildProgress !== undefined) return;
    // C++ parity PW1/PW3: powered defenses (TSLA, AGUN, GAP, PDOX, IRON, DOME) cannot fire during any power deficit.
    // Unpowered defenses (GUN, PBOX, HBOX, FTUR) always fire regardless of power.
    if (isLowPower && STRUCTURE_POWERED.has(s.type)) {
      return;
    }
    // C++ building.cpp:882-883 — ammo instantly reloads to MaxAmmo each AI tick
    if (s.ammo === 0 && s.maxAmmo > 0) { s.ammo = s.maxAmmo; }
    if (s.ammo === 0) return; // out of ammo (shouldn't reach here after reload)

    // Turret rotation tick (every frame, independent of cooldown)
    // C++ building.cpp:5347-5363 Rotation_AI + facing.cpp:142-183 Rotation_Adjust:
    //   256-step DirType, ROT=5 per tick → 90° (64 units) takes 13 ticks.
    // TS uses 8-dir facing with ROT accumulator: each tick adds ROT (5) to accumulator,
    // one 8-dir step (= 32 DirType units) fires when accumulator >= 32.
    if (TURRETED_STRUCTURES.has(s.type)) {
      if (s.turretDir === undefined) s.turretDir = TURRET_DEFAULT_FACING[s.type] ?? 4; // C++ bdata.cpp per-building default
      if (s.desiredTurretDir === undefined) s.desiredTurretDir = s.turretDir;
      if (s.turretRotAccum === undefined) s.turretRotAccum = 0;
      if (s.turretDir !== s.desiredTurretDir) {
        // Accumulate ROT units each tick (C++ FacingClass::Rotation_Adjust)
        s.turretRotAccum += STRUCTURE_TURRET_ROT;
        // One 8-dir step = 32 DirType units in C++ 256-step system
        if (s.turretRotAccum >= 32) {
          s.turretRotAccum -= 32;
          const diff = (s.desiredTurretDir - s.turretDir + 8) % 8;
          s.turretDir = diff <= 4
            ? (s.turretDir + 1) % 8
            : (s.turretDir + 7) % 8;
        }
      } else {
        s.turretRotAccum = 0; // Reset accumulator when aligned
      }
      if (s.firingFlash !== undefined && s.firingFlash > 0) s.firingFlash--;
    }

    if (s.attackCooldown > 0) {
      if (!isLowPower || ctx.tick % 2 === 0) s.attackCooldown--;
      return;
    }

    const { x: sx, y: sy } = structureFirePixels(s);
    const structPos: WorldPos = { x: sx, y: sy };
    const bestTarget = getAssignedStructureTarget(ctx, s) ?? findStructureThreatTarget(ctx, s);

    if (bestTarget) {
      // Update turret direction for turreted structures
      if (TURRETED_STRUCTURES.has(s.type)) {
        s.desiredTurretDir = directionTo(structPos, bestTarget.pos);
        // C++ Mission_Attack returns FIRE_FACING when turret is not aligned with target,
        // delaying fire until turret finishes rotating (building.cpp:2312-2318).
        // Both turretDir and desiredTurretDir are in 8-dir (0-7); compare directly.
        if (s.turretDir !== undefined && s.turretDir !== s.desiredTurretDir) return; // turret not aligned — wait
      }
      // H1: Buildings with Ammo>1 fire rapidly (1-tick rearm) then recharge (C++ techno.cpp:2861)
      // C++ house.cpp:293,303: ROFBias scales rearm delay
      const structRofBias = ctx.getROFBias(s.house);
      if (s.ammo > 0) {
        s.ammo--;
        s.attackCooldown = s.ammo > 0 ? 1 : Math.max(1, Math.round(s.weapon.rof * structRofBias)); // rapid-fire until last shot
      } else {
        s.attackCooldown = Math.max(1, Math.round(s.weapon.rof * structRofBias)); // unlimited ammo (-1) uses normal ROF
      }
      if (TURRETED_STRUCTURES.has(s.type)) s.firingFlash = 4;
      // C++ bullet.cpp:991 — Explosion_Damage is the SOLE damage path for splash weapons.
      const wh = (s.weapon.warhead ?? 'HE') as WarheadType;
      const houseBias = ctx.getFirepowerBias(s.house);
      let killed: boolean;

      if (s.type === 'TSLA' || s.type === 'QUEE') {
        launchStructureProjectile(ctx, s, bestTarget, s.weapon);
        killed = false;
      } else if (s.weapon.splash && s.weapon.splash > 0) {
        // Splash weapons: ALL damage through applySplashDamage (matches C++ Explosion_Damage)
        const hpBefore = bestTarget.hp;
        applySplashDamage(
          ctx, bestTarget.pos,
          { damage: s.weapon.damage, warhead: wh, splash: s.weapon.splash },
          -1, s.house,
        );
        killed = !bestTarget.alive || bestTarget.hp <= 0;
      } else {
        // Non-splash weapons: direct hit only
        const whMult = getWarheadMult(wh, bestTarget.stats.armor, ctx.warheadOverrides);
        const damage = modifyDamage(s.weapon.damage, wh, bestTarget.stats.armor, 0, houseBias, whMult, getWarheadMeta(wh, ctx.scenarioWarheadMeta).spreadFactor);
        killed = damageEntity(ctx, bestTarget, damage, wh);
      }

      // Fire effects — color by warhead type (C++ parity)
      ctx.effects.push({
        type: 'muzzle', x: sx, y: sy,
        frame: 0, maxFrames: 4, size: 5, sprite: 'piff', spriteStart: 0,
        muzzleColor: ctx.warheadMuzzleColor(wh),
      } as Effect);

      // Tesla coil and Queen Ant get special effect
      if (s.type === 'TSLA' || s.type === 'QUEE') {
        ctx.effects.push({
          type: 'tesla', x: bestTarget.pos.x, y: bestTarget.pos.y,
          frame: 0, maxFrames: 8, size: 12, sprite: 'piffpiff', spriteStart: 0,
          startX: sx, startY: sy, endX: bestTarget.pos.x, endY: bestTarget.pos.y,
          blendMode: 'screen',
        } as Effect);
        ctx.playSoundAt('teslazap', sx, sy);
        if (s.type === 'TSLA') {
          // C++ TechnoClass::Fire_At electric branch: firing a building
          // TeslaZap clears IsCharged and stops the charge animation.
          s.isCharged = false;
          s.isCharging = false;
          s.chargeStage = 0;
          s.chargeRateCounter = 0;
        }
      } else {
        // Projectile from structure to target — per-weapon projectile speed
        const structDistPx = Math.sqrt((bestTarget.pos.x - sx) ** 2 + (bestTarget.pos.y - sy) ** 2);
        const structTravelFrames = calcProjectileTravelFrames(structDistPx, s.weapon.projSpeed);
        // Map structure type → weapon name (STRUCTURE_WEAPONS doesn't carry weapon name).
        // Traces rules.ini: HBOX/PBOX→Vulcan, GUN→TurretGun, SAM→Nike, AGUN→Ack(→AAMissile),
        // FTUR→FireballLauncher, TSLA/QUEE→TeslaZap.
        let structWeaponName = '';
        switch (s.type) {
          case 'GUN':  structWeaponName = 'TurretGun'; break;
          case 'SAM':  structWeaponName = 'Nike'; break;
          case 'AGUN': structWeaponName = 'TurretGun'; break;
          case 'FTUR': structWeaponName = 'FireballLauncher'; break;
          case 'HBOX': case 'PBOX': structWeaponName = 'Vulcan'; break;
        }
        const structProjCfg = projectileVisualConfig(structWeaponName);
        // Pick projStyle by weapon family so procedural fallback still looks right.
        let structProjStyle: 'bullet' | 'fireball' | 'shell' | 'rocket' | 'grenade' = 'bullet';
        switch (structWeaponName) {
          case 'FireballLauncher': structProjStyle = 'fireball'; break;
          case 'TurretGun': structProjStyle = 'shell'; break;
          case 'Nike': structProjStyle = 'rocket'; break;
        }
        ctx.effects.push({
          type: 'projectile', x: sx, y: sy, frame: 0, maxFrames: structTravelFrames, size: 3,
          startX: sx, startY: sy, endX: bestTarget.pos.x, endY: bestTarget.pos.y,
          projStyle: structProjStyle,
          ...structProjCfg,
        } as Effect);
        // AA weapons hitting aircraft use flak burst sprite (C++ FLAK.SHP)
        // Non-AA: use C++ Combat_Anim damage-scaled selection
        const structExpSet = getWarheadProps(wh, ctx.scenarioWarheadProps)?.explosionSet ?? 0;
        const structLand: 'ground' | 'water' | 'air' =
          (bestTarget.isAirUnit && bestTarget.flightAltitude > 0) ? 'air' : 'ground';
        const aaImpactSprite = (s.weapon.isAntiAir && bestTarget.isAirUnit && bestTarget.flightAltitude > 0)
          ? 'flak'
          : (combatAnim(s.weapon.damage, structExpSet, structLand) ?? 'veh-hit1');
        ctx.effects.push({
          type: 'explosion', x: bestTarget.pos.x, y: bestTarget.pos.y,
          frame: 0, maxFrames: 10, size: 6,
          sprite: aaImpactSprite, spriteStart: 0,
        } as Effect);
        spawnLogicAnimForSprite(ctx.logicAnims, ctx.effects, aaImpactSprite, bestTarget.pos.x, bestTarget.pos.y);
        // D5: Structure fire weapons (FTUR FireballLauncher) plant scorch marks at impact
        if (structLand === 'ground' && wh === 'Fire') {
          const impCell = worldToCell(bestTarget.pos.x, bestTarget.pos.y);
          ctx.map.addDecal(impCell.cx, impCell.cy, 7, 0.3);
        }
        ctx.playSoundAt('machinegun', sx, sy);
      }

      // For non-splash weapons, handle death here. Splash weapons already handle
      // death inside applySplashDamage (C++ Explosion_Damage handles everything).
      if (killed && !(s.weapon.splash && s.weapon.splash > 0)) {
        handleUnitDeath(ctx, bestTarget, {
          screenShake: 4, explosionSize: 16, debris: false,
          decal: { infantry: 4, vehicle: 8, opacity: 0.5 },
          explodeLgSound: false,
          attackerIsPlayer: ctx.isAllied(s.house, ctx.playerHouse),
          trackLoss: false,
        });
      }
    }
}

/** Structure auto-fire — pillboxes, guard towers, tesla coils, SAM/AGUN fire at nearby enemies.
 *  Bulk wrapper that calls updateSingleStructureCombat for each structure.
 *  NOTE: For C++ parity, prefer calling updateSingleStructureCombat per-building
 *  interleaved with timer ticks (see tickStructuresInterleaved in index.ts). */
export function updateStructureCombat(ctx: CombatContext): void {
  const isLowPower = ctx.powerConsumed > ctx.powerProduced;
  for (const s of ctx.structures) {
    updateSingleStructureCombat(ctx, s, isLowPower);
  }
}
