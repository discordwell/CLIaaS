/**
 * Combat subsystem — damage calculation, projectiles, splash, and unit death.
 * Extracted from Game class (index.ts) to isolate combat logic.
 */

import {
  type WorldPos, type WeaponStats, type ArmorType, type WarheadType,
  type WarheadMeta, type WarheadProps,
  CELL_SIZE, LEPTON_SIZE, MAP_CELLS, CONDITION_YELLOW, RULE_GRAVITY,
  WARHEAD_VS_ARMOR, WARHEAD_PROPS, WARHEAD_META, WEAPON_STATS,
  armorIndex, leptonDist, pixelToLepton, leptonToPixel, worldToCell, cellTargetToLepton, modifyDamage,
  directionTo, directionToLeptons, directionToLeptons256, calcProjectileTravelFrames, projectileVisualConfig,
  House, Mission, AnimState, UnitType, EXPLOSION_FRAMES,
  DIR_DX, DIR_DY, DIR_COUNT, MISSION_CONTROL, COS_TABLE_256, SIN_TABLE_256,
  HOUSE_FACTION, PRONE_DAMAGE_BIAS,
} from './types';
import { Entity, CloakState, CLOAK_TRANSITION_FRAMES, attachFallingParachuteAnim } from './entity';
import { type MapStructure, type StructureWeapon, STRUCTURE_SIZE, STRUCTURE_POWERED, STRUCTURE_WEAPONS, STRUCTURE_ARMOR, CREWED_BUILDINGS, INSIGNIFICANT_STRUCTURE_TYPES, isStructureUnderConstruction, getStructureOccupyCells, structureCenterLeptons as cppStructureCenterLeptons } from './scenario';
import { PRODUCTION_ITEMS } from './types';
import { type Effect } from './renderer';
import { type GameMap, type MapTree, MoveResult, Terrain, TREE_CENTER_OFFSET } from './map';
import { nearbyLocation } from './pathfinding';
import { type AircraftContext, canTargetNaval, closestInfantryUnlimboSpot } from './aircraft';
import { AI_BUILD_RULES } from './ai';
import { ScenarioRandom } from './random';
import { assignMission, commence } from './missionLifecycle';
import { type LogicAnim, type LogicAnimType, spawnLogicAnim, spawnLogicAnimForSprite } from './logicAnim';
import { getActiveTeams } from './team';

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
// C++ odata.cpp OverlayTypeClass::IsHigh: among RA wall overlays, only BRIK
// stops low-level bullets in BulletClass::Is_Forced_To_Explode.
const HIGH_WALL_TYPES = new Set(['BRIK']);
const CELL_CENTER_LEPTON = LEPTON_SIZE >> 1;
const TORPEDO_CENTER_HIT_RADIUS = Math.trunc(LEPTON_SIZE / 3);
const PIXEL_LEPTON_W = Math.trunc(LEPTON_SIZE / CELL_SIZE);
const LIGHT_SPEED = 255;
const BARREL_BULLET_SPEED = 30; // C++ MPH_MEDIUM_FAST used by BARL/BRL3 death bullets.
const AIRCRAFT_DROPPING_SPEED_ADD = Math.trunc((12 * 40 + 128) / 256);
const BASE_DEFENSE_SUSPEND_PRIORITY = 20;
const BASE_DEFENSE_DELAY_MINUTES = 0.25;
const OBJECT_TOP_LAYER_MIN_HEIGHT = Entity.FLIGHT_LEVEL_LEPTONS - Math.trunc(Entity.FLIGHT_LEVEL_LEPTONS / 3);
const OBJECT_TOP_LAYER_MIN_PIXEL = leptonToPixel(OBJECT_TOP_LAYER_MIN_HEIGHT);
const BARREL_FIRE_WEAPON: WeaponStats = {
  name: 'BarrelFire',
  damage: 200,
  rof: 0,
  range: 1,
  warhead: 'Fire',
  isInvisible: true,
};

function clearFootPath(entity: Entity): void {
  entity.path = [];
  entity.pathIndex = 0;
  entity.drivePathFacings = [];
  entity.drivePathHeadCleared = false;
}

function clearInfantryAssignTargetPathHead(entity: Entity): void {
  if (entity.stats.isInfantry && entity.isDriving) {
    entity.drivePathHeadCleared = true;
    return;
  }
  clearFootPath(entity);
}

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
 * Scenario-loaded buildings override this with the INI facing field.
 */
const TURRET_DEFAULT_FACING: Record<string, number> = {
  GUN: 6,   // West  (DirType 208)
  SAM: 0,   // North (DIR_N)
  AGUN: 1,  // NorthEast (DIR_NE)
};

const STRUCTURE_TURRET_DEFAULT_DIR256: Record<string, number> = {
  GUN: 208,
  SAM: 0,
  AGUN: 32,
};

/** C++ bdata.cpp BuildingTypeClass fire-coordinate offsets.
 *  TechnoClass::Fire_Coord first moves north by VerticalOffset + Height,
 *  then applies lateral and primary muzzle offsets in turret-facing space. */
const STRUCTURE_FIRE_COORD_OFFSETS: Record<string, { vertical: number; primary: number; lateral: number }> = {
  PBOX: { vertical: 0x0010, primary: 0x0040, lateral: 0x0000 },
  HBOX: { vertical: 0x0010, primary: 0x0040, lateral: 0x0000 },
  TSLA: { vertical: 0x00c8, primary: 0x0000, lateral: 0x0000 },
  GUN:  { vertical: 0x0030, primary: 0x0080, lateral: 0x0000 },
  SAM:  { vertical: 0x0030, primary: 0x0080, lateral: 0x0000 },
  AGUN: { vertical: 0x0000, primary: 0x0000, lateral: 0x0000 },
  FTUR: { vertical: 0x0000, primary: 0x0000, lateral: 0x0000 },
  QUEE: { vertical: 0x0000, primary: 0x0000, lateral: 0x0000 },
};

/** C++ rules.ini ROT for turreted buildings.
 *  Used in Rotation_AI (building.cpp:5347-5363) via FacingClass::Rotation_Adjust(ROT).
 *  TS stores 8-way facings, so the accumulator carries the missing 256-step
 *  sub-facing progress between visible 45-degree steps. */
const STRUCTURE_TURRET_ROT: Record<string, number> = {
  GUN: 12,
  AGUN: 15,
  SAM: 30,
};

// ── Interfaces ─────────────────────────────────────────────────────────────────

/** In-flight projectile for deferred damage */
export interface InflightProjectile {
  attackerId: number;
  attackerHouse?: House;  // structure-fired bullets have no Entity Payback in TS
  /** C++ BulletClass::Payback can point at a BuildingClass; preserve object identity across ctx.structures splices. */
  attackerStructure?: MapStructure;
  /** Launch-time structure slot retained for legacy callers and diagnostics; not authoritative when attackerStructure exists. */
  attackerStructureIndex?: number;
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
  // C++ bullet.cpp:790-802 — IsDropping: vertical drop from ObjectClass::FLIGHT_LEVEL.
  isDropping: boolean;   // true if weapon has IsDropping flag
  dropHeight: number;    // current altitude in leptons; starts at FLIGHT_LEVEL(256)
  dropRiser?: number;    // C++ ObjectClass::Riser; parachute-attached drops clamp at -3
  dropHasAttachedAnim?: boolean; // C++ IsAnimAttached branch for IsParachuted bombs
  // C++ bullet.cpp:377-386 — IsFlameEquipped: flame/smoke trail every other tick
  isFlameEquipped: boolean;
  flameTrailAnim?: 'smoke_puff' | 'fball_fade';
  flameToggle: boolean;  // alternates each tick; trail spawns when true (C++ IsToAnimate)
  // C++ FlyClass/FuseClass state for ordinary projectiles.
  logicalLX: number;
  logicalLY: number;
  headToLX: number;
  headToLY: number;
  homingTargetLX?: number;
  homingTargetLY?: number;
  facing256: number;
  desiredFacing256?: number;
  speedAccum: number;
  speedAdd: number;
  fuseTimer: number;
  armingTimer: number;
  proximity: number;
  /** C++ Logic vector index at submit time, used to model DynamicVector ordering. */
  logicIndexHint?: number;
  /** Logic tick when this BulletClass was submitted. New same-tick objects are not deletion-shift skips. */
  createdLogicTick?: number;
  /** Set when a partial Logic-cursor projectile flush has already run this bullet this tick. */
  processedLogicTick?: number;
}

type DamageSource = Entity | MapStructure;

function isEntitySource(source: DamageSource): source is Entity {
  return source instanceof Entity;
}

type LogicSkipRange = {
  after: number;
  through: number;
};

function sourceHouse(source: DamageSource): House {
  return source.house;
}

function sourceIsAlive(source: DamageSource): boolean {
  return source.alive && (!isEntitySource(source) || !source.inLimbo);
}

function sourceWeapon(source: DamageSource): WeaponStats | StructureWeapon | undefined {
  return isEntitySource(source) ? source.weapon ?? undefined : source.weapon;
}

function sourceArmor(source: DamageSource): ArmorType {
  return isEntitySource(source)
    ? source.stats.armor
    : (source.armor ?? STRUCTURE_ARMOR[source.type] ?? 'wood');
}

function sourcePos(source: DamageSource): WorldPos {
  if (isEntitySource(source)) return source.pos;
  const center = structureCenterLeptons(source);
  return {
    x: center.lx * CELL_SIZE / LEPTON_SIZE,
    y: center.ly * CELL_SIZE / LEPTON_SIZE,
  };
}

function structureCenterLeptons(s: MapStructure): { lx: number; ly: number } {
  return cppStructureCenterLeptons(s);
}

export function entityTargetLeptons(e: Entity): { lx: number; ly: number } {
  return e.targetCoordLeptons();
}

export function entityTargetPixels(e: Entity): { x: number; y: number } {
  const t = entityTargetLeptons(e);
  return {
    x: t.lx * CELL_SIZE / LEPTON_SIZE,
    y: t.ly * CELL_SIZE / LEPTON_SIZE,
  };
}

function moveCoordLeptons(coord: { lx: number; ly: number }, dir256: number, dist: number): { lx: number; ly: number } {
  const dir = dir256 & 0xff;
  return {
    lx: coord.lx + ((COS_TABLE_256[dir] * dist) >> 7),
    ly: coord.ly - ((SIN_TABLE_256[dir] * dist) >> 7),
  };
}

function aircraftFireDirection256(attacker: Entity, weapon: WeaponStats, targetCoord: { lx: number; ly: number }): number {
  if ((weapon.projectileROT ?? 0) !== 0 || weapon.isDropping) {
    if (attacker.turretFacing256 >= 0) return attacker.turretFacing256 & 0xff;
    if (attacker.facing256 >= 0) return attacker.facing256 & 0xff;
    return (attacker.facing * 32) & 0xff;
  }

  const fireCoord = typeof attacker.fireCoordForWeapon === 'function'
    ? attacker.fireCoordForWeapon(weapon)
    : { lx: attacker.leptonX, ly: attacker.leptonY };
  return directionToLeptons256(fireCoord.lx, fireCoord.ly, targetCoord.lx, targetCoord.ly);
}

function aircraftProjectileImpactAfterScatter(
  attacker: Entity,
  weapon: WeaponStats,
  fireCoord: { lx: number; ly: number },
  targetCoord: { lx: number; ly: number },
  targetPixels: WorldPos,
  targetIsInfantryOrCell: boolean,
): { impactX: number; impactY: number; directHit: boolean; facing256?: number } {
  const baseFireDir = aircraftFireDirection256(attacker, weapon, targetCoord);
  const projectileHasFireDirection = (weapon.projectileROT ?? 0) !== 0 || !!weapon.isDropping;
  let facing256: number | undefined = projectileHasFireDirection ? baseFireDir : undefined;
  let impactX = targetPixels.x;
  let impactY = targetPixels.y;
  let directHit = true;

  // C++ bullet.cpp:709-730. Aircraft helpers enter through TechnoClass::Fire_At
  // just like ground units, but they bypass missionAI.ts where ground projectile
  // scatter is precomputed. The INI typo in bbdata.cpp reads "Inaccuate", so
  // rules.ini "Inaccurate=yes" does not set Class->IsInaccurate; coordinate and
  // infantry AP/fueled shots still scatter through the explicit target-kind gate.
  // C++ TechnoClass::Fire_At marks moving-platform inaccuracy from
  // FootClass::IsDriving only. Fixed-wing aircraft can physically move while
  // attacking with IsDriving=false, so position deltas are not equivalent here.
  const movingPlatform = !!attacker.isDriving;
  const doScatter =
    movingPlatform ||
    (targetIsInfantryOrCell && (weapon.warhead === 'AP' || !!weapon.isFueled));

  if (!doScatter) {
    return { impactX, impactY, directHit, facing256 };
  }

  const savedTag = ScenarioRandom._sourceTag;
  if (attacker.isAirUnit) ScenarioRandom._sourceTag = 40001;
  try {
    const distLeptons = leptonDist(fireCoord.lx, fireCoord.ly, targetCoord.lx, targetCoord.ly);
    let scatterMax = Math.trunc(distLeptons / 16) - 0x0040;
    scatterMax = Math.max(0, scatterMax);
    scatterMax = Math.min(scatterMax, weapon.isArcing ? 0x0200 : 0x0100);

    if (weapon.isArcing) {
      const jitter = ScenarioRandom.nextInRange(0, 10);
      facing256 = (baseFireDir + jitter - 5) & 0xff;
      const scatterDist = ScenarioRandom.nextInRange(0, scatterMax);
      const coordScatterSavedTag = ScenarioRandom._sourceTag;
      ScenarioRandom._sourceTag = 50002;
      const scatterDir = ScenarioRandom.nextInRange(0, 255);
      ScenarioRandom._sourceTag = coordScatterSavedTag;
      const scattered = moveCoordLeptons(targetCoord, scatterDir, scatterDist);
      impactX = scattered.lx * CELL_SIZE / LEPTON_SIZE;
      impactY = scattered.ly * CELL_SIZE / LEPTON_SIZE;
    } else {
      const scatterDist = ScenarioRandom.nextInRange(0, scatterMax);
      const scatterDir = projectileHasFireDirection
        ? baseFireDir
        : directionToLeptons256(fireCoord.lx, fireCoord.ly, targetCoord.lx, targetCoord.ly);
      facing256 = scatterDir;
      const scattered = moveCoordLeptons(targetCoord, scatterDir, scatterDist);
      impactX = scattered.lx * CELL_SIZE / LEPTON_SIZE;
      impactY = scattered.ly * CELL_SIZE / LEPTON_SIZE;
    }
  } finally {
    ScenarioRandom._sourceTag = savedTag;
  }

  const dx = impactX - targetPixels.x;
  const dy = impactY - targetPixels.y;
  directHit = Math.sqrt(dx * dx + dy * dy) < CELL_SIZE * 0.6;
  return { impactX, impactY, directHit, facing256 };
}

function structureProjectileImpactAfterScatter(
  s: MapStructure,
  weapon: StructureWeapon,
  target: Entity,
  fireCoord: { lx: number; ly: number },
  targetCoord: { lx: number; ly: number },
): { targetLX: number; targetLY: number; impactX: number; impactY: number; directHit: boolean; facing256?: number } {
  const targetPixels = entityTargetPixels(target);
  let targetLX = targetCoord.lx;
  let targetLY = targetCoord.ly;
  let impactX = targetPixels.x;
  let impactY = targetPixels.y;
  let directHit = true;
  let facing256: number | undefined;

  const projectile = weapon as StructureWeapon & Pick<WeaponStats, 'isArcing' | 'isFueled' | 'projectileROT' | 'isDropping'>;
  const warhead = (weapon.warhead ?? 'HE') as WarheadType;
  const doScatter = target.stats.isInfantry && (warhead === 'AP' || !!projectile.isFueled);
  if (!doScatter) return { targetLX, targetLY, impactX, impactY, directHit };

  // C++ TechnoClass::Fire_At -> BulletClass::Unlimbo -> bullet.cpp:709-730.
  // Building firers are never FootClass moving platforms, but AP/fueled shots
  // against infantry still scatter at launch and consume scenario RNG.
  const savedTag = ScenarioRandom._sourceTag;
  if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = 70015;
  try {
    const distLeptons = leptonDist(fireCoord.lx, fireCoord.ly, targetCoord.lx, targetCoord.ly);
    let scatterMax = Math.trunc(distLeptons / 16) - 0x0040;
    scatterMax = Math.max(0, scatterMax);
    scatterMax = Math.min(scatterMax, projectile.isArcing ? 0x0200 : 0x0100);

    if (projectile.isArcing) {
      const baseDir = directionToLeptons256(
        fireCoord.lx, fireCoord.ly,
        targetCoord.lx, targetCoord.ly,
      );
      const jitter = ScenarioRandom.nextInRange(0, 10);
      facing256 = (baseDir + jitter - 5) & 0xff;
      const scatterDist = ScenarioRandom.nextInRange(0, scatterMax);
      const coordScatterSavedTag = ScenarioRandom._sourceTag;
      if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = 50002;
      const scatterDir = ScenarioRandom.nextInRange(0, 255);
      if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = coordScatterSavedTag;
      const scattered = moveCoordLeptons(targetCoord, scatterDir, scatterDist);
      targetLX = scattered.lx;
      targetLY = scattered.ly;
    } else {
      const scatterDist = ScenarioRandom.nextInRange(0, scatterMax);
      const projectileHasFireDirection = ((projectile.projectileROT ?? 0) !== 0) || !!projectile.isDropping;
      const dir256 = projectileHasFireDirection
        ? structureTurretFacing256(s, target)
        : directionToLeptons256(
            fireCoord.lx, fireCoord.ly,
            targetCoord.lx, targetCoord.ly,
          );
      facing256 = dir256;
      const scattered = moveCoordLeptons(targetCoord, dir256, scatterDist);
      targetLX = scattered.lx;
      targetLY = scattered.ly;
    }
  } finally {
    ScenarioRandom._sourceTag = savedTag;
  }

  impactX = targetLX * CELL_SIZE / LEPTON_SIZE;
  impactY = targetLY * CELL_SIZE / LEPTON_SIZE;
  const dx = impactX - targetPixels.x;
  const dy = impactY - targetPixels.y;
  directHit = Math.sqrt(dx * dx + dy * dy) < CELL_SIZE * 0.6;
  return { targetLX, targetLY, impactX, impactY, directHit, facing256 };
}

function structureTurretFacing256(s: MapStructure, target?: Entity): number {
  if (TURRETED_STRUCTURES.has(s.type)) {
    if (s.turretFacing256 !== undefined) return s.turretFacing256 & 0xff;
    if (s.turretDir !== undefined) return (s.turretDir * 32) & 0xff;
    return STRUCTURE_TURRET_DEFAULT_DIR256[s.type] ?? 0;
  }
  if (target) {
    const center = structureCenterLeptons(s);
    const targetCoord = entityTargetLeptons(target);
    return directionToLeptons256(center.lx, center.ly, targetCoord.lx, targetCoord.ly);
  }
  return 0;
}

function normalizeFacing256(value: number): number {
  return ((value % 256) + 256) & 0xff;
}

function signedFacingDelta256(current: number, desired: number): number {
  const delta = ((desired - current + 128) & 0xff) - 128;
  return delta === -128 ? 128 : delta;
}

function syncStructureTurretFacingFields(s: MapStructure): void {
  if (!TURRETED_STRUCTURES.has(s.type)) return;
  if (s.turretFacing256 === undefined) {
    s.turretFacing256 = s.turretDir !== undefined
      ? normalizeFacing256(s.turretDir * 32)
      : (STRUCTURE_TURRET_DEFAULT_DIR256[s.type] ?? 0);
  }
  if (s.desiredTurretFacing256 === undefined) {
    s.desiredTurretFacing256 = s.desiredTurretDir !== undefined
      ? normalizeFacing256(s.desiredTurretDir * 32)
      : s.turretFacing256;
  }
  s.turretDir = ((s.turretFacing256 + 16) >> 5) & 7;
  s.desiredTurretDir = ((s.desiredTurretFacing256 + 16) >> 5) & 7;
}

export function setStructureTurretDesired(s: MapStructure, target: Entity): void {
  if (!TURRETED_STRUCTURES.has(s.type)) return;
  syncStructureTurretFacingFields(s);
  // C++ BuildingClass::Can_Fire/Mission_Attack use Direction(TarCom),
  // which is Center_Coord() -> As_Coord(TarCom). Fire_Coord is only used
  // later for range checks and projectile launch.
  const center = structureCenterLeptons(s);
  const targetCoord = entityTargetLeptons(target);
  s.desiredTurretFacing256 = directionToLeptons256(center.lx, center.ly, targetCoord.lx, targetCoord.ly);
  s.desiredTurretDir = ((s.desiredTurretFacing256 + 16) >> 5) & 7;
  s.turretRotAccum = Math.abs(signedFacingDelta256(s.turretFacing256!, s.desiredTurretFacing256));
}

function setStructureTurretDesiredToTargetNone(s: MapStructure): void {
  if (!TURRETED_STRUCTURES.has(s.type)) return;
  syncStructureTurretFacingFields(s);
  const center = structureCenterLeptons(s);
  s.desiredTurretFacing256 = directionToLeptons256(center.lx, center.ly, 0, 0);
  s.desiredTurretDir = ((s.desiredTurretFacing256 + 16) >> 5) & 7;
  s.turretRotAccum = Math.abs(signedFacingDelta256(s.turretFacing256!, s.desiredTurretFacing256));
}

export function rotateStructureTurretTowardDesired(s: MapStructure): void {
  if (!TURRETED_STRUCTURES.has(s.type)) return;
  syncStructureTurretFacingFields(s);
  const current = s.turretFacing256!;
  const desired = s.desiredTurretFacing256!;
  const delta = signedFacingDelta256(current, desired);
  const rot = STRUCTURE_TURRET_ROT[s.type] ?? 5;
  if (delta !== 0) {
    const step = Math.min(Math.abs(delta), rot) * Math.sign(delta);
    s.turretFacing256 = normalizeFacing256(current + step);
  }
  s.turretDir = ((s.turretFacing256! + 16) >> 5) & 7;
  s.desiredTurretDir = ((s.desiredTurretFacing256! + 16) >> 5) & 7;
  s.turretRotAccum = Math.abs(signedFacingDelta256(s.turretFacing256!, s.desiredTurretFacing256!));
}

export function tickStructureTurretRotation(s: MapStructure, isLowPower: boolean): void {
  if (!TURRETED_STRUCTURES.has(s.type)) return;
  if (!s.alive || s.sellProgress !== undefined || isStructureUnderConstruction(s)) return;
  // C++ BuildingClass::Rotation_AI skips powered turrets while the house is low power.
  if (isLowPower && STRUCTURE_POWERED.has(s.type)) return;
  rotateStructureTurretTowardDesired(s);
  if (s.firingFlash !== undefined && s.firingFlash > 0) s.firingFlash--;
}

function structureTurretCanFire(s: MapStructure): boolean {
  if (!TURRETED_STRUCTURES.has(s.type)) return true;
  syncStructureTurretFacingFields(s);
  // C++ BuildingClass::Can_Fire allows GUN/AGUN to fire when PrimaryFacing
  // differs from Direction(TarCom) by at most 8 DirType units. SAM has a much
  // wider cone, handled here too even though its state machine is simplified.
  const tolerance = s.type === 'SAM' ? 64 : 8;
  return Math.abs(signedFacingDelta256(s.turretFacing256!, s.desiredTurretFacing256!)) <= tolerance;
}

export function structureFireLeptons(s: MapStructure, target?: Entity): { lx: number; ly: number } {
  const offsets = STRUCTURE_FIRE_COORD_OFFSETS[s.type];
  let coord = structureCenterLeptons(s);
  if (!offsets) return coord;

  coord = moveCoordLeptons(coord, 0, offsets.vertical);
  const turret256 = structureTurretFacing256(s, target);
  if (offsets.lateral !== 0) {
    coord = moveCoordLeptons(coord, turret256 + 192, offsets.lateral);
  }
  if (offsets.primary !== 0) {
    coord = moveCoordLeptons(coord, turret256, offsets.primary);
  }
  return coord;
}

function structureFirePixels(s: MapStructure, target?: Entity): { x: number; y: number } {
  const p = structureFireLeptons(s, target);
  return { x: p.lx * CELL_SIZE / LEPTON_SIZE, y: p.ly * CELL_SIZE / LEPTON_SIZE };
}

function withScenarioRandomSourceTag<T>(tag: number, fn: () => T): T {
  const saved = ScenarioRandom._sourceTag;
  ScenarioRandom._sourceTag = tag;
  try {
    return fn();
  } finally {
    ScenarioRandom._sourceTag = saved;
  }
}

function splashTrace(event: Record<string, unknown>): void {
  const trace = (globalThis as { __easterSplashTrace?: Array<Record<string, unknown>> }).__easterSplashTrace;
  if (trace) trace.push(event);
}

function projectileTrace(event: Record<string, unknown>): void {
  const trace = (globalThis as { __easterProjectileTrace?: Array<Record<string, unknown>> }).__easterProjectileTrace;
  if (trace) trace.push(event);
}

function damageTrace(event: Record<string, unknown>): void {
  const trace = (globalThis as { __easterDamageTrace?: Array<Record<string, unknown>> }).__easterDamageTrace;
  if (trace) {
    trace.push({
      ...event,
      stack: new Error().stack?.split('\n').slice(2, 7).map(line => line.trim()),
    });
  }
}

function entityInTopLayer(entity: Entity): boolean {
  // C++ AircraftClass::In_Which_Layer forces fixed-wing aircraft into TOP
  // for any nonzero Height. Non-fixed aircraft use ObjectClass' 2/3
  // FLIGHT_LEVEL threshold; TS stores their aircraft height in pixels.
  if (entity.stats.isAircraft) {
    if (entity.stats.isFixedWing) return entity.flightAltitude > 0;
    return entity.flightAltitude >= OBJECT_TOP_LAYER_MIN_PIXEL;
  }
  return entity.fallHeightLeptons >= OBJECT_TOP_LAYER_MIN_HEIGHT;
}

function entityOccupiesCellForExplosionDamage(entity: Entity): boolean {
  // Explosion_Damage snapshots Cell_Occupier() chains. Top-layer FootClass
  // objects are redrawn/submitted to the render layer, but MARK_DOWN does not
  // Place_Down into Cell_Occupier, so ground explosions cannot collect them.
  return !entityInTopLayer(entity);
}

function coordScatterFromCell(cellCx: number, cellCy: number, radiusLeptons: number): { x: number; y: number } {
  const dir = withScenarioRandomSourceTag(50002, () => ScenarioRandom.nextInRange(0, 255));
  const lx = cellCx * LEPTON_SIZE + CELL_CENTER_LEPTON + ((COS_TABLE_256[dir] * radiusLeptons) >> 7);
  const ly = cellCy * LEPTON_SIZE + CELL_CENTER_LEPTON - ((SIN_TABLE_256[dir] * radiusLeptons) >> 7);
  return {
    x: lx * CELL_SIZE / LEPTON_SIZE,
    y: ly * CELL_SIZE / LEPTON_SIZE,
  };
}

function reserveBuildingAnimSlot(ctx: CombatContext): boolean {
  return !ctx.reserveAnimSlot || ctx.reserveAnimSlot();
}

function submitBuildingFireSmall(
  ctx: CombatContext,
  x: number,
  y: number,
  delay: number,
  loop: number,
  animSlotReserved = false,
  attachedStructureIndex?: number,
): void {
  if (!animSlotReserved && !reserveBuildingAnimSlot(ctx)) return;
  const logicAnims = ctx.logicAnims ?? (ctx.logicAnims = []);
  if (delay === 0) {
    spawnLogicAnim(
      logicAnims, ctx.effects, 'fire_small', x, y, loop, true,
      ctx.logicAnimsAlreadyProcessed === true,
      ctx.logicIndexHintForNewObject?.(),
      ctx.logicIndexHintForNewObject,
      ctx.reserveAnimSlot,
      true,
      attachedStructureIndex,
      0,
      undefined,
      ctx.tick,
    );
    return;
  }
  logicAnims.push({
    type: 'fire_small',
    x,
    y,
    stage: 0,
    timer: 1,
    loops: Math.max(1, loop) * 2,
    delay,
    isBrandNew: ctx.logicAnimsAlreadyProcessed !== true,
    logicIndexHint: ctx.logicIndexHintForNewObject?.(),
    attachedStructureIndex,
    createdLogicTick: ctx.tick,
  });
  ctx.effects.push({
    type: 'explosion',
    x,
    y,
    frame: -delay,
    maxFrames: EXPLOSION_FRAMES.fire3 ?? 15,
    size: 8,
    sprite: 'fire3',
    spriteStart: 0,
  } as Effect);
}

function submitBuildingFireMedium(
  ctx: CombatContext,
  x: number,
  y: number,
  delay: number,
  loop: number,
  animSlotReserved = false,
  attachedStructureIndex?: number,
): void {
  if (!animSlotReserved && !reserveBuildingAnimSlot(ctx)) return;
  const logicAnims = ctx.logicAnims ?? (ctx.logicAnims = []);
  if (delay === 0) {
    spawnLogicAnim(
      logicAnims, ctx.effects, 'fire_med', x, y, loop, true,
      ctx.logicAnimsAlreadyProcessed === true,
      ctx.logicIndexHintForNewObject?.(),
      ctx.logicIndexHintForNewObject,
      ctx.reserveAnimSlot,
      true,
      attachedStructureIndex,
      0,
      undefined,
      ctx.tick,
    );
    return;
  }
  logicAnims.push({
    type: 'fire_med',
    x,
    y,
    stage: 0,
    timer: 1,
    loops: Math.max(1, loop) * 3,
    delay,
    isBrandNew: ctx.logicAnimsAlreadyProcessed !== true,
    logicIndexHint: ctx.logicIndexHintForNewObject?.(),
    attachedStructureIndex,
    createdLogicTick: ctx.tick,
  });
  submitBuildingFireEffect(ctx, 'fire2', x, y, delay, 12);
}

function submitBuildingFireEffect(ctx: CombatContext, sprite: string, x: number, y: number, delay: number, size: number): void {
  ctx.effects.push({
    type: 'explosion',
    x,
    y,
    frame: -delay,
    maxFrames: EXPLOSION_FRAMES[sprite] ?? 15,
    size,
    sprite,
    spriteStart: 0,
  } as Effect);
}

function submitBuildingAttachedLogicAnim(
  ctx: CombatContext,
  type: LogicAnimType,
  x: number,
  y: number,
  loop: number,
  attachedStructureIndex: number | undefined,
  animSlotReserved = false,
): void {
  if (!animSlotReserved && !reserveBuildingAnimSlot(ctx)) return;
  const logicAnims = ctx.logicAnims ?? (ctx.logicAnims = []);
  spawnLogicAnim(
    logicAnims,
    ctx.effects,
    type,
    x,
    y,
    loop,
    true,
    ctx.logicAnimsAlreadyProcessed === true,
    ctx.logicIndexHintForNewObject?.(),
    ctx.logicIndexHintForNewObject,
    ctx.reserveAnimSlot,
    true,
    attachedStructureIndex,
    0,
    undefined,
    ctx.tick,
  );
}

function submitOilfieldBurn(
  ctx: CombatContext,
  s: MapStructure,
  attachedStructureIndex: number | undefined,
): void {
  if (!reserveBuildingAnimSlot(ctx)) return;
  const logicAnims = ctx.logicAnims ?? (ctx.logicAnims = []);
  // C++ building.cpp:1409: Coord_Add(Coord, 0x00400130L). In RA's packed
  // coordinate this is +0x0130 leptons X and +0x0040 leptons Y.
  const x = s.cx * CELL_SIZE + 0x0130 * CELL_SIZE / LEPTON_SIZE;
  const y = s.cy * CELL_SIZE + 0x0040 * CELL_SIZE / LEPTON_SIZE;
  logicAnims.push({
    type: 'oilfield_burn',
    x,
    y,
    stage: 0,
    timer: 1,
    loops: 255,
    delay: 1,
    isBrandNew: ctx.logicAnimsAlreadyProcessed !== true,
    logicIndexHint: ctx.logicIndexHintForNewObject?.(),
    attachedStructureIndex,
    createdLogicTick: ctx.tick,
  });
  ctx.effects.push({
    type: 'explosion',
    x,
    y,
    frame: -1,
    maxFrames: EXPLOSION_FRAMES.flmspt ?? 66,
    size: 16,
    sprite: 'flmspt',
    spriteStart: 0,
  } as Effect);
}

function isRenovatorSource(source?: Entity): boolean {
  return source?.type === UnitType.I_MECH;
}

function runBuildingDamageStateEffects(ctx: CombatContext, s: MapStructure, warhead: WarheadType, source: Entity | undefined, isResultHalf: boolean): void {
  const cells = getStructureOccupyCells(s.type, s.cx, s.cy);
  const [width, height] = STRUCTURE_SIZE[s.type] ?? [1, 1];
  const attachedStructureIndex = ctx.structures.indexOf(s);
  const attachedIndex = attachedStructureIndex >= 0 ? attachedStructureIndex : undefined;

  if (isResultHalf && s.type === 'V19') {
    submitOilfieldBurn(ctx, s, attachedIndex);
  }

  for (const cell of cells) {
    if (warhead === 'Fire') {
      switch (ScenarioRandom.nextInRange(0, 5 + width + height)) {
        case 1:
        case 2:
        case 3:
        case 4:
        case 5: {
          if (reserveBuildingAnimSlot(ctx)) {
            const pos = coordScatterFromCell(cell.cx, cell.cy, 0x0060);
            const loop = ScenarioRandom.nextInRange(1, 3);
            submitBuildingAttachedLogicAnim(ctx, 'on_fire_small', pos.x, pos.y, loop, attachedIndex, true);
          }
          break;
        }
        case 6:
        case 7:
        case 8: {
          if (reserveBuildingAnimSlot(ctx)) {
            const pos = coordScatterFromCell(cell.cx, cell.cy, 0x0060);
            const loop = ScenarioRandom.nextInRange(1, 3);
            submitBuildingAttachedLogicAnim(ctx, 'on_fire_med', pos.x, pos.y, loop, attachedIndex, true);
          }
          break;
        }
        case 9: {
          if (reserveBuildingAnimSlot(ctx)) {
            const pos = coordScatterFromCell(cell.cx, cell.cy, 0x0060);
            submitBuildingAttachedLogicAnim(ctx, 'on_fire_big', pos.x, pos.y, 1, attachedIndex, true);
          }
          break;
        }
        default:
          break;
      }
      continue;
    }

    if (!ScenarioRandom.percentChance(50)) continue;
    if (isRenovatorSource(source)) continue;

    // C++ AnimClass::operator new runs before constructor arguments; when the
    // fixed heap is full, Coord_Scatter/start-frame/loop RNG are skipped.
    if (reserveBuildingAnimSlot(ctx)) {
      const pos = coordScatterFromCell(cell.cx, cell.cy, 0x0060);
      const delay = ScenarioRandom.nextInRange(0, 7);
      const loop = ScenarioRandom.nextInRange(1, 3);
      submitBuildingFireSmall(ctx, pos.x, pos.y, delay, loop, true, attachedIndex);
    }
  }
}

function detachStructureAttachedAnims(ctx: CombatContext, s: MapStructure): void {
  const attachedStructureIndex = ctx.structures.indexOf(s);
  if (attachedStructureIndex < 0) return;
  for (const anim of ctx.logicAnims ?? []) {
    if (anim.attachedStructureIndex === attachedStructureIndex) {
      anim.deleteOnNextProcess = true;
    }
  }
}

function detachStructureFromTargeting(ctx: CombatContext, s: MapStructure): void {
  s.targetEntityId = undefined;
  const structureIndex = ctx.structures.indexOf(s);
  for (const proj of ctx.inflightProjectiles) {
    const sourceMatches =
      proj.attackerStructure === s ||
      (!proj.attackerStructure && structureIndex >= 0 && proj.attackerStructureIndex === structureIndex);
    if (sourceMatches) {
      proj.attackerStructure = undefined;
      proj.attackerStructureIndex = undefined;
    }
  }
  for (const entity of ctx.entities) {
    if (entity.targetStructure !== s) continue;
    entity.targetStructure = null;
    entity.forceFirePos = null;
    entity.firePrepActive = false;
    entity.firePrepStage = 0;
    entity.firePrepUsesDoingStage = false;
    if (entity.stats.isInfantry) {
      entity.isFiringAnim = false;
      entity.firingAnimTicks = 0;
    }
  }
  for (const team of getActiveTeams()) {
    team.detachTargetStructure(s);
  }
}

function isCellTargetWorld(pos: WorldPos, cx: number, cy: number): boolean {
  const target = cellTargetToLepton(cx, cy);
  return pixelToLepton(pos.x) === target.lx && pixelToLepton(pos.y) === target.ly;
}

function detachCellTargetFromTargeting(ctx: CombatContext, cx: number, cy: number): void {
  const target = cellTargetToLepton(cx, cy);
  for (const entity of ctx.entities) {
    let detachedTarCom = false;
    if (entity.forceFirePos && isCellTargetWorld(entity.forceFirePos, cx, cy)) {
      entity.forceFirePos = null;
      detachedTarCom = true;
    }
    if (entity.moveTarget?.lx === target.lx && entity.moveTarget.ly === target.ly) {
      entity.moveTarget = null;
      clearFootPath(entity);
    }
    if (detachedTarCom) {
      entity.firePrepActive = false;
      entity.firePrepStage = 0;
      entity.firePrepUsesDoingStage = false;
      entity.firePrepFacing256 = -1;
      if (entity.stats.isInfantry) {
        entity.isFiringAnim = false;
        entity.firingAnimTicks = 0;
      }
    }
  }
  for (const team of getActiveTeams()) {
    team.detachTargetCell({ cx, cy });
  }
}

function clearSuspendedMission(entity: Entity): void {
  entity.suspendedMission = null;
  entity.suspendedTarget = null;
  entity.suspendedTargetStructure = null;
  entity.suspendedForceFirePos = null;
  entity.suspendedMoveTarget = null;
  entity.suspendedMoveTargetEntityRef = null;
}

function restoreSuspendedMissionAfterDetach(ctx: CombatContext, entity: Entity, detached: Entity): void {
  if (entity.suspendedTarget === detached) {
    clearSuspendedMission(entity);
    return;
  }
  if (entity.suspendedMission === null) return;

  const mission = entity.suspendedMission;
  const target = entity.suspendedTarget;
  const targetStructure = entity.suspendedTargetStructure;
  const forceFirePos = entity.suspendedForceFirePos;
  const moveTarget = entity.suspendedMoveTarget;
  const moveTargetEntityRef = entity.suspendedMoveTargetEntityRef;
  const moveTargetEntityRefLX = entity.suspendedMoveTargetEntityRefLX;
  const moveTargetEntityRefLY = entity.suspendedMoveTargetEntityRefLY;
  clearSuspendedMission(entity);

  assignMission(entity, mission);
  entity.target = target && target.alive && !target.inLimbo ? target : null;
  entity.targetStructure = targetStructure?.alive ? targetStructure : null;
  entity.forceFirePos = forceFirePos ? { ...forceFirePos } : null;
  if (moveTargetEntityRef && moveTargetEntityRef.alive && !moveTargetEntityRef.inLimbo) {
    entity.moveTargetEntityRef = moveTargetEntityRef;
    entity.moveTarget = { lx: moveTargetEntityRef.leptonX, ly: moveTargetEntityRef.leptonY };
    entity.moveTargetEntityRefLX = moveTargetEntityRef.leptonX;
    entity.moveTargetEntityRefLY = moveTargetEntityRef.leptonY;
  } else if (moveTarget) {
    entity.moveTarget = { ...moveTarget };
    entity.moveTargetEntityRef = null;
    entity.moveTargetEntityRefLX = moveTargetEntityRefLX;
    entity.moveTargetEntityRefLY = moveTargetEntityRefLY;
  } else {
    entity.moveTarget = null;
    entity.moveTargetEntityRef = null;
  }
  clearFootPath(entity);
  if (!entity.stats.isInfantry && !entity.isAirUnit && entity.moveTarget) {
    ctx.startDriveClassMove?.(entity);
  }
}

function submitBuildingFballEffect(
  ctx: CombatContext,
  x: number,
  y: number,
  delay: number,
  size = 10,
  animSlotReserved = false,
): void {
  if (!animSlotReserved && !reserveBuildingAnimSlot(ctx)) return;
  const logicAnims = ctx.logicAnims ?? (ctx.logicAnims = []);
  logicAnims.push({
    type: 'fball1',
    x,
    y,
    stage: 0,
    timer: 1,
    loops: 1,
    delay,
    isBrandNew: ctx.logicAnimsAlreadyProcessed !== true,
    logicIndexHint: ctx.logicIndexHintForNewObject?.(),
    createdLogicTick: ctx.tick,
  });
  ctx.effects.push({
    type: 'explosion',
    x,
    y,
    frame: -delay,
    maxFrames: EXPLOSION_FRAMES.fball1 ?? 18,
    size,
    sprite: 'fball1',
    spriteStart: 0,
  } as Effect);
}

function submitBuildingSmokeEffect(
  ctx: CombatContext,
  x: number,
  y: number,
  delay: number,
  loop: number,
  animSlotReserved = false,
): void {
  if (!animSlotReserved && !reserveBuildingAnimSlot(ctx)) return;
  const logicAnims = ctx.logicAnims ?? (ctx.logicAnims = []);
  spawnLogicAnim(
    logicAnims,
    ctx.effects,
    'smoke_m',
    x,
    y,
    loop,
    false,
    ctx.logicAnimsAlreadyProcessed === true,
    ctx.logicIndexHintForNewObject?.(),
    ctx.logicIndexHintForNewObject,
    ctx.reserveAnimSlot,
    true,
    undefined,
    delay,
    undefined,
    ctx.tick,
  );
  ctx.effects.push({
    type: 'explosion',
    x,
    y,
    frame: -delay,
    maxFrames: EXPLOSION_FRAMES.smoke_m ?? 91,
    size: 10,
    sprite: 'smoke_m',
    spriteStart: 0,
    loopStart: 67,
    loopEnd: EXPLOSION_FRAMES.smoke_m ?? 91,
    loops: Math.max(1, loop) * 6,
  } as Effect);
}

function treeKey(tree: MapTree): number {
  return tree.cy * MAP_CELLS + tree.cx;
}

function terrainBurnCoord(tree: MapTree, yOffsetLeptons: number): { x: number; y: number } {
  const centerOff = TREE_CENTER_OFFSET[tree.type] ?? [CELL_SIZE / 2, CELL_SIZE / 2];
  return {
    x: tree.cx * CELL_SIZE + centerOff[0],
    y: tree.cy * CELL_SIZE + centerOff[1] + yOffsetLeptons * CELL_SIZE / LEPTON_SIZE,
  };
}

function submitTreeBurnAnim(ctx: CombatContext, tree: MapTree, type: LogicAnimType, yOffsetLeptons: number, delay: number): void {
  if (ctx.reserveAnimSlot && !ctx.reserveAnimSlot()) return;
  const pos = terrainBurnCoord(tree, yOffsetLeptons);
  spawnLogicAnim(
    ctx.logicAnims,
    ctx.effects,
    type,
    pos.x,
    pos.y,
    1,
    true,
    ctx.logicAnimsAlreadyProcessed === true,
    ctx.logicIndexHintForNewObject?.(),
    ctx.logicIndexHintForNewObject,
    ctx.reserveAnimSlot,
    true,
    undefined,
    delay,
    treeKey(tree),
    ctx.tick,
  );
}

function catchTreeFire(ctx: CombatContext, tree: MapTree): boolean {
  if (tree.isCrumbling || tree.isOnFire || tree.immune) return false;
  submitTreeBurnAnim(ctx, tree, 'burn_big', -0x50, 0);
  submitTreeBurnAnim(ctx, tree, 'burn_med', -0xE0, 15);
  tree.isOnFire = true;
  return true;
}

function shortenTreeAttachedAnims(ctx: CombatContext, tree: MapTree): void {
  const key = treeKey(tree);
  for (const anim of ctx.logicAnims) {
    if (anim.attachedTreeKey === key) anim.loops = 0;
  }
}

function runBuildingDestroyedTakeDamageEffects(ctx: CombatContext, s: MapStructure): void {
  for (const cell of getStructureOccupyCells(s.type, s.cx, s.cy)) {
    // C++ building.cpp:1301 — Random_Pick(SMUDGE_CRATER1, SMUDGE_CRATER6).
    ScenarioRandom.nextInRange(1, 6);
    ctx.map.addDecal(cell.cx, cell.cy, 10, 0.5);

    if (ScenarioRandom.percentChance(50)) {
      // C++ allocation happens before constructor arguments, so a full heap
      // skips Coord_Scatter/start-frame/loop RNG for this AnimClass only.
      if (reserveBuildingAnimSlot(ctx)) {
        const smallPos = coordScatterFromCell(cell.cx, cell.cy, 0x0080);
        const smallDelay = ScenarioRandom.nextInRange(0, 7);
        const smallLoop = ScenarioRandom.nextInRange(1, 3);
        submitBuildingFireSmall(ctx, smallPos.x, smallPos.y, smallDelay, smallLoop, true);
      }

      if (ScenarioRandom.percentChance(50)) {
        if (reserveBuildingAnimSlot(ctx)) {
          const medPos = coordScatterFromCell(cell.cx, cell.cy, 0x0040);
          const medDelay = ScenarioRandom.nextInRange(0, 7);
          const medLoop = ScenarioRandom.nextInRange(1, 3);
          submitBuildingFireMedium(ctx, medPos.x, medPos.y, medDelay, medLoop, true);
        }
      }
    }

    if (reserveBuildingAnimSlot(ctx)) {
      const fballPos = coordScatterFromCell(cell.cx, cell.cy, 0x0040);
      const fballDelay = ScenarioRandom.nextInRange(0, 3);
      submitBuildingFballEffect(ctx, fballPos.x, fballPos.y, fballDelay, 10, true);
    }
  }
}

function launchBarrelDeathBullet(ctx: CombatContext, s: MapStructure, dx: number, dy: number): void {
  const start = structureCenterLeptons(s);
  const target = cellTargetToLepton(s.cx + dx, s.cy + dy);
  const fuseDist = leptonDist(start.lx, start.ly, target.lx, target.ly);
  const travelFrames = Math.min(0xFF, Math.max(1, Math.trunc(fuseDist / BARREL_BULLET_SPEED) + 4));
  const speedAdd = Math.trunc((BARREL_BULLET_SPEED * 255 + 128) / 256);
  const logicIndexHint = ctx.logicIndexHintForNewObject?.();

  ctx.inflightProjectiles.push({
    attackerId: -1,
    attackerHouse: s.house,
    targetId: -1,
    weapon: BARREL_FIRE_WEAPON,
    damage: BARREL_FIRE_WEAPON.damage,
    strength: BARREL_FIRE_WEAPON.damage,
    speed: BARREL_BULLET_SPEED,
    travelFrames,
    currentFrame: 0,
    directHit: true,
    impactX: target.lx * CELL_SIZE / LEPTON_SIZE,
    impactY: target.ly * CELL_SIZE / LEPTON_SIZE,
    attackerIsPlayer: false,
    isArcing: false,
    arcHeight: 0,
    arcRiser: 0,
    startX: start.lx * CELL_SIZE / LEPTON_SIZE,
    startY: start.ly * CELL_SIZE / LEPTON_SIZE,
    dogRiderId: -1,
    fuelTimer: travelFrames,
    isFueled: false,
    isDropping: false,
    dropHeight: 0,
    isFlameEquipped: false,
    flameToggle: false,
    logicalLX: start.lx,
    logicalLY: start.ly,
    headToLX: target.lx,
    headToLY: target.ly,
    facing256: directionToLeptons256(start.lx, start.ly, target.lx, target.ly),
    speedAccum: 0,
    speedAdd,
    fuseTimer: travelFrames,
    armingTimer: 0,
    proximity: fuseDist,
    logicIndexHint,
    createdLogicTick: ctx.tick,
  });
}

/** Minimal AI state slice needed by damageStructure */
export interface AiStateSlice {
  lastBaseAttackTick: number;
  underAttack: boolean;
  iq: number;
  isBaseBuilding?: boolean;
  /** C++ HouseClass::LAEnemy — house of the last building attacker. */
  lastAttackerEnemy?: House | null;
  /** C++ HouseClass::Enemy — persistent designated enemy for threat scoring. */
  designatedEnemy?: House | null;
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
  /** Current C++-style Logic.Count() for a newly submitted sentient object. */
  logicIndexHintForNewObject?: () => number;
  /** Move an existing object to the end of the C++ Logic order after Unlimbo. */
  resubmitEntityToLogicEnd?: (entity: Entity) => void;
  /** Release an object's current C++ Logic slot when Limbo/delete removes it. */
  releaseLogicSlotForEntity?: (entity: Entity) => void;
  /** Release a TerrainClass Logic slot when a tree/terrain object deletes. */
  releaseTerrainLogicSlot?: (terrain: MapTree) => void;
  /** Release a non-entity C++ Logic slot after its BulletClass/AnimClass deletes. */
  deferLogicSlotRelease?: (logicIndexHint: number | undefined) => void;
  /** Lowest original Logic index before a shifted-behind-cursor range. */
  shiftedLogicSkipHintAfter?: number;
  /** Highest original Logic index shifted behind the active C++ cursor this tick. */
  shiftedLogicSkipHintThrough?: number;
  /** Original Logic index ranges shifted behind the active C++ cursor this tick. */
  shiftedLogicSkipRanges?: LogicSkipRange[];
  /** Reserve one C++ AnimClass heap slot. Returns false when Rule.AnimMax is full. */
  reserveAnimSlot?: () => boolean;
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
  /** C++ ObjectClass::IsToDamage reentrancy guard for nested Explosion_Damage. */
  explosionDamageReservedEntityIds?: Set<number>;
  explosionDamageReservedStructures?: Set<MapStructure>;
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
  recordUnitLost?(house: House): void;
  recordBuildingLost?(house: House): void;
  isAllied(a: House, b: House): boolean;
  entitiesAllied(a: Entity, b: Entity): boolean;
  isPlayerControlled(e: Entity): boolean;
  playSoundAt(name: string, x: number, y: number): void;
  playEva(name: string): void;
  minimapAlert(cx: number, cy: number): void;
  movementSpeed(entity: Entity): number;
  /** C++ TechnoClass::Evaluate_Object visibility gate: PlayerPtr-owned or discovered by PlayerPtr. */
  isDiscoveredByPlayer?(entity: Entity): boolean;
  isRevealedToHouse?(cx: number, cy: number, houseIdx: number): boolean;
  /** C++ InfantryClass::Stop_Driver, used by InfantryClass::Assign_Destination. */
  stopInfantryDriver?(entity: Entity): void;
  /** C++ InfantryClass::Can_Enter_Cell, used by survivor Scatter(0,true). */
  infantryCanEnterCell?(entity: Entity, cx: number, cy: number, facing?: number): MoveResult;
  /** C++ Clear_Occupy_Bit(Coord) anonymous infantry bit clear. */
  clearInfantryOccupyBit?(cellIdx: number, subCell: number): void;
  /** C++ InfantryClass::Assign_Destination line 1046 clear-current-cell predicate. */
  canStopInfantryDriverForAssignDestination?(entity: Entity): boolean;
  /** C++ DriveClass::Assign_Destination immediate Start_Of_Move hook. */
  startDriveClassMove?(entity: Entity): void;
  /** C++ TechnoClass::Unlimbo -> Enter_Idle_Mode(true) mission selection. */
  idleMission?(entity: Entity): Mission;
  /** C++ TechnoClass::Revealed(PlayerPtr) side effect for newly unlimboed objects. */
  markDiscoveredIfPlayerVisible?(entity: Entity): void;
  getFirepowerBias(house: House): number;
  /** C++ house.cpp:292,302: ArmorBias — difficulty-scaled damage resistance */
  getArmorBias(house: House): number;
  /** C++ house.cpp:293,303: ROFBias — difficulty-scaled rate-of-fire */
  getROFBias(house: House): number;
  damageStructure(s: MapStructure, damage: number, source?: Entity, warhead?: WarheadType, options?: StructureDamageOptions): boolean;
  /** C++ TeamClass::Suspend_Teams, triggered from TechnoClass::Base_Is_Attacked. */
  suspendTeamsByPriority?(house: House, priority: number): void;
  /** C++ HouseClass::Control.TechLevel, used by TechnoClass::Base_Is_Attacked. */
  houseTechLevel?(house: House): number;
  /** C++ TechnoClass::Take_Damage object trigger spring for TEVENT_ATTACKED. */
  springAttackedTriggerByName?(triggerName: string): void;
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

export interface StructureDamageOptions {
  skipBaseAttack?: boolean;
  /** C++ BuildingClass::Take_Damage(..., forced): forced destruction suppresses survivors. */
  forced?: boolean;
}

// ── Pure Functions ─────────────────────────────────────────────────────────────

function recordStructureSourceAttack(ctx: CombatContext, s: MapStructure, source: Entity): void {
  const aiState = ctx.aiStates.get(s.house);
  if (!aiState) return;

  // C++ building.cpp:1240-1249 records LATime/LAEnemy before low-level damage
  // assessment. Non-allied building attackers also become House->Enemy, which
  // TechnoClass::Evaluate_Object later uses as the designated-enemy threat bonus.
  aiState.lastBaseAttackTick = ctx.tick;
  aiState.lastAttackerEnemy = source.house;
  if (!ctx.isAllied(s.house, source.house)) {
    aiState.designatedEnemy = source.house;
  }
}

function maybeAssignStructureReturnFireTarget(
  ctx: CombatContext,
  s: MapStructure,
  source: Entity | undefined,
): void {
  if (!source || !s.weapon) return;
  if (s.type === 'SAM' || s.type === 'AGUN') return;
  if (ctx.isAllied(s.house, source.house)) return;

  const currentTarget = s.targetEntityId !== undefined
    ? ctx.entityById.get(s.targetEntityId)
    : undefined;
  const hasLegalTarget = !!(currentTarget && currentTarget.alive && !currentTarget.inLimbo);
  if (hasLegalTarget && structureTargetInTarcomRange(s, currentTarget)) return;

  // C++ building.cpp:1496-1512 — weapon buildings snap their TarCom to the
  // non-aircraft source that damaged them when the existing TarCom is illegal
  // or out of range. PlayerReturnFire is disabled in rules.ini, so only the
  // actual human house declines this automatic retargeting.
  if (source.isAirUnit) return;
  if (s.house === ctx.playerHouse) return;
  if (!source.alive || source.inLimbo) return;

  s.targetEntityId = source.id;
}

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
 *  multiplier, so wounded infantry stays at normal walking speed.
 *  C++ aircraft.cpp:3560-3568 uses AircraftClass::Set_Speed/FlyClass with
 *  Class->MaxSpeed and AirspeedBias; it does not apply DriveClass damage
 *  throttle. */
export function damageSpeedFactor(entity: Entity): number {
  if (entity.stats.isInfantry || entity.stats.isAircraft) return 1.0;
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
    baseFacing = directionToLeptons(CELL_CENTER_LEPTON, CELL_CENTER_LEPTON, fracX, fracY);
  }
  const offset = withScenarioRandomSourceTag(53003, () => ScenarioRandom.nextInRange(0, 4)) - 2;
  const startFacing = ((baseFacing + offset) % DIR_COUNT + DIR_COUNT) % DIR_COUNT;

  let chosen: { cx: number; cy: number } | null = null;
  let bridgeFallback: { cx: number; cy: number } | null = null;
  const cx = crew.cell.cx;
  const cy = crew.cell.cy;
  for (let face = 0; face < DIR_COUNT; face++) {
    const dir = (startFacing + face) % DIR_COUNT;
    const ncx = cx + DIR_DX[dir];
    const ncy = cy + DIR_DY[dir];
    if (ncx < 0 || ncx >= MAP_CELLS || ncy < 0 || ncy >= MAP_CELLS) continue;
    const canEnter = ctx.infantryCanEnterCell
      ? ctx.infantryCanEnterCell(crew, ncx, ncy, dir)
      : (ctx.map.isPassable(ncx, ncy) ? MoveResult.OK : MoveResult.IMPASSABLE);
    if (canEnter !== MoveResult.OK) continue;

    const cell = { cx: ncx, cy: ncy };
    if (!bridgeFallback) bridgeFallback = cell;
    if (!ctx.map.isBridgeCell(ncx, ncy)) {
      chosen = cell;
      break;
    }
  }
  chosen ??= bridgeFallback;
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
  options: {
    skipProneBias?: boolean;
    skipEntityArmorBias?: boolean;
    skipHouseArmorBias?: boolean;
    sourceStructure?: MapStructure;
  } = {},
): boolean {
  // C++ AircraftClass::Take_Damage halves positive damage while the aircraft
  // has Height before FootClass/TechnoClass/ObjectClass apply the remaining
  // damage pipeline. Integer division truncates.
  if (amount > 0 && target.isAirUnit && target.flightAltitude > 0) {
    amount = Math.trunc(amount / 2);
  }
  if (amount === 0) return false;
  // C++ parity: apply house-level armor bias from difficulty (house.cpp:292,302)
  // ArmorBias > 1 = tougher (less damage), < 1 = weaker (more damage)
  const houseArmorBias = ctx.getArmorBias(target.house);
  if (!options.skipHouseArmorBias && houseArmorBias !== 1.0 && amount > 0) {
    amount = Math.max(1, Math.round(amount / houseArmorBias));
  }
  const occupiedLogicBefore = target.occupiesCppLogic();
  const hpBefore = target.hp;
  const whProps = getWarheadProps(warhead, ctx.scenarioWarheadProps);
  const passengerHouses = target.passengers.map(p => p.house);
  const killed = target.takeDamage(amount, warhead, attacker, whProps, {
    skipProneBias: options.skipProneBias,
    skipArmorBias: options.skipEntityArmorBias,
    hasDamageSource: attacker !== undefined || options.sourceStructure !== undefined,
  });
  if (killed) {
    updateInfantryDeathOccupancy(ctx, target);
    ctx.recordUnitLost?.(target.house);
    for (const passengerHouse of passengerHouses) ctx.recordUnitLost?.(passengerHouse);
    if (occupiedLogicBefore && !target.occupiesCppLogic()) {
      ctx.releaseLogicSlotForEntity?.(target);
    }
  }
  damageTrace({
    tick: ctx.tick,
    targetId: target.id,
    targetType: target.type,
    targetHouse: target.house,
    targetCx: target.cell.cx,
    targetCy: target.cell.cy,
    amount,
    warhead,
    hpBefore,
    hpAfter: target.hp,
    killed,
    attackerId: attacker?.id,
    attackerType: attacker?.type,
    attackerHouse: attacker?.house,
    sourceStructureType: options.sourceStructure?.type,
    sourceStructureHouse: options.sourceStructure?.house,
    sourceStructureCx: options.sourceStructure?.cx,
    sourceStructureCy: options.sourceStructure?.cy,
  });
  if (target.triggerName) {
    ctx.attackedTriggerNames.add(target.triggerName);
    if (attacker && amount > 0) ctx.springAttackedTriggerByName?.(target.triggerName);
  }
  // C++ negative damage is healing. TechnoClass::Take_Damage repairs strength,
  // but it must not flow into FootClass retaliation/scatter handling as if the
  // unit was attacked.
  if (amount < 0) return false;
  // C++ unit.cpp:1162-1167 — computer harvesters that survive damage call
  // TechnoClass::Base_Is_Attacked(source), which can suspend low-priority teams
  // for the harvester's house. This is the same base-defense hook used by
  // BuildingClass::Take_Damage, but UnitClass scopes it to UNIT_HARVESTER.
  if (!killed && target.alive && attacker && target.type === UnitType.V_HARV) {
    maybeSuspendTeamsForBaseAttack(ctx, attacker, target.house, false, target);
  }
  if (!killed && target.alive) {
    // C++ damage-response order:
	    //   1. FootClass::Take_Damage handles retaliation / team damage. If
	    //      retaliation is not allowed and the unit has no TarCom/NavCom, it
	    //      calls Scatter(0,true).
    //   2. InfantryClass::Take_Damage then calls Scatter(source_coord), whose
    //      Target_Legal(TarCom) guard suppresses voluntary scatter after a
    //      successful retaliation target assignment.
	    const damageSource: DamageSource | undefined = attacker ?? options.sourceStructure;
	    const didFootForcedScatter = shouldFootClassForcedScatter(ctx, target, damageSource);
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
	    let didPostRetaliationForcedScatter = false;
	    if (damageSource) {
	      triggerRetaliation(ctx, target, damageSource);
	      // C++ FootClass::Take_Damage calls Scatter(0,true) after
	      // Is_Allowed_To_Retaliate(source) returns false. That predicate can
	      // fail after its 50% threat-comparison RNG, so it cannot be fully
	      // predicted by shouldFootClassForcedScatter before triggerRetaliation.
	      if (shouldFootClassFallbackScatterNow(ctx, target)) {
	        aiScatterOnDamage(ctx, target);
	        didPostRetaliationForcedScatter = true;
	      }
	    }
	    if (damageSource && !didPostRetaliationForcedScatter) {
	      aiScatterOnDamage(ctx, target, damageSource);
	    }
	  }
	  return killed;
	}

/** C++ foot.cpp:1228-1230 fallback scatter gate.
 *  This is distinct from InfantryClass::Take_Damage's later source scatter:
 *  FootClass calls Scatter(0,true) only when individual retaliation is not
 *  allowed and the unit is free to move. */
function shouldFootClassForcedScatter(ctx: CombatContext, victim: Entity, attacker?: DamageSource): boolean {
  // Current TS non-infantry scatter is handled by the existing virtual scatter
  // path below. Keep this helper scoped to the infantry RNG path (53003).
  if (!victim.stats.isInfantry) return false;
  // C++ foot.cpp:1172 — team members delegate to Team->Took_Damage and skip
  // individual retaliation/scatter fallback.
  if (victim.teamRef) return false;

	  const mc = MISSION_CONTROL[victim.mission];
	  if (!mc?.isScatter) return false;
	  if (victim.isTethered || victim.isDriving) return false;
	  if (victim.target?.alive || victim.targetStructure?.alive || victim.moveTarget) return false;
	  if (victim.isAirUnit || victim.isNavalUnit) return false;
  // Rule.IsScatter defaults false; only non-human houses take this fallback.
  if (victim.house === ctx.playerHouse) return false;

  // If C++ Is_Allowed_To_Retaliate would pass, FootClass does not take the
  // fallback branch. Keep this deterministic; the later AI threat-comparison
  // RNG is intentionally not consumed from this predicate.
  if (!attacker || !sourceIsAlive(attacker)) return true;
  if (ctx.isAllied(victim.house, sourceHouse(attacker))) return true;
  if (!MISSION_CONTROL[victim.mission]?.isRetaliate) return true;
  if (victim.stats.isAircraft && victim.stats.isFixedWing) return true;

  const isVictimHumanHouse = victim.house === ctx.playerHouse;
  const houseIQ = ctx.aiIQ?.(victim.house) ?? 3;
  if (isEntitySource(attacker) && shouldCrushIt(victim, attacker, isVictimHumanHouse, houseIQ)) return false;

  if (!victim.weapon) return true;
  if (getWarheadMult(victim.weapon.warhead, sourceArmor(attacker), ctx.warheadOverrides ?? {}) <= 0) return true;
  if (isEntitySource(attacker) && (attacker.stats.isCanine || attacker.type === UnitType.I_DOG)) return true;
  if (isEntitySource(attacker) && attacker.isAirUnit && attacker.flightAltitude > 0) {
    const hasAA = victim.weapon?.isAntiAir || victim.weapon2?.isAntiAir;
    if (!hasAA) return true;
  }
  if (isEntitySource(attacker) && !canTargetNaval(victim, attacker)) return true;
  if (isVictimHumanHouse) {
    const isTanyaVsInfantry = victim.type === UnitType.I_TANYA && isEntitySource(attacker) && attacker.stats.isInfantry;
    if (!isTanyaVsInfantry) return true;
  }
  if (victim.isSuicide) return true;

	  return false;
	}

function shouldFootClassFallbackScatterNow(ctx: CombatContext, victim: Entity): boolean {
  if (victim.teamRef) return false;
  const mc = MISSION_CONTROL[victim.mission];
  if (!mc?.isScatter) return false;
  if (victim.isTethered || victim.isDriving) return false;
  if (victim.target?.alive || victim.targetStructure?.alive || victim.moveTarget) return false;
  if (victim.isAirUnit || victim.isNavalUnit) return false;
  // rules.ini PlayerScatter=no, so only non-human houses take this fallback.
  if (victim.house === ctx.playerHouse) return false;
  return true;
}

/** C++ InfantryClass::Assign_Destination for scatter-created cell targets.
 *  Scatter itself only chooses the cell; assigning that cell must still stop an
 *  active infantry driver when the current Coord is clear, clear Path[0], and
 *  reset PathThreshhold before queueing MOVE. */
function assignInfantryScatterDestination(ctx: CombatContext, entity: Entity, cell: { cx: number; cy: number }): void {
  if (entity.stats.isInfantry) {
    if (entity.isDriving && !entity.formationOffset &&
        (ctx.canStopInfantryDriverForAssignDestination?.(entity) ?? true)) {
      if (ctx.stopInfantryDriver) {
        ctx.stopInfantryDriver(entity);
      } else {
        entity.isDriving = false;
        entity.headToLX = 0;
        entity.headToLY = 0;
        entity.doStopDriverAction(ctx.tick);
      }
    }
    clearFootPath(entity);
    entity.pathThreshold = 1; // C++ MOVE_CLOAK
  }
  entity.moveTarget = cellTargetToLepton(cell.cx, cell.cy);
}

function structureOccupiesClearToMoveCell(s: MapStructure, cx: number, cy: number): boolean {
  if (!s.alive || s.rubble) return false;
  return getStructureOccupyCells(s.type, s.cx, s.cy).some(cell =>
    cell.cx === cx && cell.cy === cy);
}

function scatterNearbyCellIsClear(ctx: CombatContext, entity: Entity, cx: number, cy: number): boolean {
  if (ctx.structures.some(s => structureOccupiesClearToMoveCell(s, cx, cy))) {
    return false;
  }
  return ctx.map.canEnterCell(cx, cy, entity.isNavalUnit) === MoveResult.OK;
}

function releaseDestroyedUnitOccupancy(ctx: CombatContext, victim: Entity): void {
  if (victim.stats.isInfantry || victim.stats.isVessel) return;
  if (victim.isAirUnit && victim.flightAltitude > 0) return;
  ctx.map.clearVehicleTrackReservationsForEntity(victim.id);
  ctx.map.clearVehicleOccupancy(victim.cell.cx, victim.cell.cy, victim.id);
  victim.driveTrackFlagClearedCellIdx = -1;
}

function infantryDeathKeepsLogicObject(victim: Entity): boolean {
  return victim.deathVariant >= 1 && victim.deathVariant <= 4;
}

function infantrySpotIndex(lx: number, ly: number): number {
  const fracX = ((lx % LEPTON_SIZE) + LEPTON_SIZE) % LEPTON_SIZE;
  const fracY = ((ly % LEPTON_SIZE) + LEPTON_SIZE) % LEPTON_SIZE;
  if (leptonDist(fracX, fracY, 0x80, 0x80) < 60) return 0;
  let index = 0;
  if (fracX > 0x80) index |= 0x01;
  if (fracY > 0x80) index |= 0x02;
  return index + 1;
}

function clearInfantryOccupyBit(ctx: CombatContext, victim: Entity): void {
  if (victim.claimedCellIdx >= 0 && victim.claimedSubCell >= 0) {
    if (ctx.clearInfantryOccupyBit) {
      ctx.clearInfantryOccupyBit(victim.claimedCellIdx, victim.claimedSubCell);
    } else {
      ctx.map.vacateClaimedSubCell(victim.claimedCellIdx, victim.id, victim.claimedSubCell);
    }
  }
  victim.claimedCellIdx = -1;
  victim.claimedSubCell = -1;
}

function updateInfantryDeathOccupancy(ctx: CombatContext, victim: Entity): void {
  if (!victim.stats.isInfantry) return;

  if (infantryDeathKeepsLogicObject(victim)) {
    if (ctx.stopInfantryDriver) {
      ctx.stopInfantryDriver(victim);
      return;
    }

    clearInfantryOccupyBit(ctx, victim);
    const cellIdx = victim.cell.cy * MAP_CELLS + victim.cell.cx;
    const spot = infantrySpotIndex(victim.leptonX, victim.leptonY);
    if (ctx.map.occupyClaimedSubCell(cellIdx, victim.id, spot)) {
      victim.claimedCellIdx = cellIdx;
      victim.claimedSubCell = spot;
      victim.subCell = spot;
    }
    victim.isDriving = false;
    victim.headToLX = 0;
    victim.headToLY = 0;
    return;
  }

  clearInfantryOccupyBit(ctx, victim);
  ctx.map.vacateSubCell(victim.cell.cx, victim.cell.cy, victim.id);
  victim.isDriving = false;
  victim.headToLX = 0;
  victim.headToLY = 0;
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
 *  - Infantry scatters directionally; UnitClass zero-threat scatter uses
 *    Map.Nearby_Location and does not consume Scenario RNG.
 */
export function aiScatterOnDamage(ctx: CombatContext, entity: Entity, attacker?: DamageSource): void {
  // Only infantry uses directional scatter (C++ infantry.cpp override)
  if (!entity.stats.isInfantry) {
    // C++ FootClass::Take_Damage fallback scatter for DriveClass descendants
    // calls virtual Scatter(0,true). UnitClass overrides the zero-threat branch:
    // Assign_Destination(As_Target(Map.Nearby_Location(...))) with no Scenario
    // RNG. Threat-based DriveClass::Scatter is used only when threat != 0.
    if (entity.teamRef) return;
    if (entity.isAirUnit || entity.isNavalUnit) return;
    const mc = MISSION_CONTROL[entity.mission];
    if (mc && (!mc.isScatter || mc.isParalyzed)) return;
    if (entity.isDriving ||
        entity.target?.alive ||
        entity.targetStructure?.alive ||
        entity.forceFirePos ||
        entity.moveTarget) return;
    if (entity.house === ctx.playerHouse) return;
    if (entity.bodyFacing256 >= 0 &&
        entity.desiredFacing256 >= 0 &&
        entity.bodyFacing256 !== entity.desiredFacing256) return;

    const cell = nearbyLocation(
      ctx.map,
      entity.cell,
      entity.isNavalUnit,
      Math.max(0, ctx.tick - 1),
      (cx, cy) => scatterNearbyCellIsClear(ctx, entity, cx, cy),
    );
    if (cell) {
      entity.moveTarget = cellTargetToLepton(cell.cx, cell.cy);
      entity.pathThreshold = 1;
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
    awayDir = directionTo(sourcePos(attacker), entity.pos);
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
    assignInfantryScatterDestination(ctx, entity, bestCell);
    assignMission(entity, Mission.MOVE);
  }
}

/** Fire weapon at entity target (helper for aircraft) — uses full damage pipeline */
export function fireWeaponAt(
  ctx: CombatContext, attacker: Entity, target: Entity, weapon: WeaponStats,
): void {
  const houseBias = ctx.getFirepowerBias(attacker.house);
  if (weapon.projSpeed !== undefined || weapon.projectileSpeed !== undefined) {
    // AircraftClass::Fire_At routes through FootClass/TechnoClass::Fire_At in
    // C++, so even light-speed invisible aircraft weapons create BulletClass
    // objects. Damage and Coord_Scatter happen during BulletClass::AI.
    const targetCoord = entityTargetLeptons(target);
    const impact = entityTargetPixels(target);
    const fireCoord = typeof attacker.fireCoordForWeapon === 'function'
      ? attacker.fireCoordForWeapon(weapon)
      : { lx: attacker.leptonX, ly: attacker.leptonY };
    const scatter = aircraftProjectileImpactAfterScatter(
      attacker,
      weapon,
      fireCoord,
      targetCoord,
      impact,
      target.stats.isInfantry,
    );
    const strength = weapon.damage > 0
      ? Math.max(1, Math.round(weapon.damage * houseBias))
      : Math.round(weapon.damage * houseBias);
    launchProjectile(
      ctx,
      attacker,
      target,
      weapon,
      strength,
      scatter.impactX,
      scatter.impactY,
      scatter.directHit,
      fireCoord,
      scatter.facing256,
    );
    ctx.effects.push({
      type: 'muzzle',
      x: attacker.pos.x, y: attacker.pos.y - attacker.flightAltitude,
      frame: 0, maxFrames: 4, size: 4, sprite: 'piff', spriteStart: 0,
    } as Effect);
    return;
  }

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

/** Fire weapon at a map coordinate target.
 *  C++ fixed-wing DROP_BOMBS builds a coordinate TARGET in front of the
 *  aircraft for non-homing weapons, then still routes through TechnoClass::
 *  Fire_At. The target has no object id, but BulletClass detonation applies
 *  normal Explosion_Damage around that coordinate. */
export function fireWeaponAtCoord(
  ctx: CombatContext,
  attacker: Entity,
  weapon: WeaponStats,
  impact: WorldPos,
): void {
  const houseBias = ctx.getFirepowerBias(attacker.house);
  if (weapon.projSpeed !== undefined || weapon.projectileSpeed !== undefined) {
    const targetCoord = { lx: pixelToLepton(impact.x), ly: pixelToLepton(impact.y) };
    const fireCoord = typeof attacker.fireCoordForWeapon === 'function'
      ? attacker.fireCoordForWeapon(weapon)
      : { lx: attacker.leptonX, ly: attacker.leptonY };
    const scatter = aircraftProjectileImpactAfterScatter(
      attacker,
      weapon,
      fireCoord,
      targetCoord,
      impact,
      true,
    );
    const strength = weapon.damage > 0
      ? Math.max(1, Math.round(weapon.damage * houseBias))
      : Math.round(weapon.damage * houseBias);
    launchProjectile(
      ctx,
      attacker,
      null,
      weapon,
      strength,
      scatter.impactX,
      scatter.impactY,
      scatter.directHit,
      fireCoord,
      scatter.facing256,
      targetCoord,
    );
    ctx.effects.push({
      type: 'muzzle',
      x: attacker.pos.x, y: attacker.pos.y - attacker.flightAltitude,
      frame: 0, maxFrames: 4, size: 4, sprite: 'piff', spriteStart: 0,
    } as Effect);
    return;
  }

  applySplashDamage(
    ctx,
    impact,
    { damage: Math.round(weapon.damage * houseBias), warhead: weapon.warhead, splash: weapon.splash },
    -1,
    attacker.house,
    attacker,
  );
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
  const destroyed = structureDamage(ctx, s, damage, attacker, wh);
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
  attackedObject?: Entity | MapStructure,
): void {
  // C++ BuildingClass::Take_Damage calls TechnoClass::Base_Is_Attacked(source)
  // and UnitClass::Take_Damage does the same for surviving computer harvesters
  // after DriveClass::Take_Damage returns. Base_Is_Attacked returns unless:
  //   - target house is AI/non-human,
  //   - source is an enemy FootClass of RTTI_INFANTRY or RTTI_UNIT,
  //   - building cannot defend itself,
  // then TeamClass::Suspend_Teams(Rule.SuspendPriority=20, House) and recruits
  // nearby armed defenders for RESCUE/GUARD_AREA.
  if (!ctx.suspendTeamsByPriority) return;
  if (attackedHouse === ctx.playerHouse) return;
  if (ctx.isAllied(attackedHouse, attacker.house)) return;
  const attackerIsInfantryOrUnit =
    attacker.stats.isInfantry || (!attacker.isAirUnit && !attacker.isNavalUnit);
  if (!attackerIsInfantryOrUnit) return;
  if (attackedObjectHasPrimaryWeapon) return;
  if (!(attackedObject instanceof Entity) &&
      attackedObject &&
      INSIGNIFICANT_STRUCTURE_TYPES.has(attackedObject.type)) return;
  if (attacker.baseAttackTimer > 0) return;

  ctx.suspendTeamsByPriority(attackedHouse, BASE_DEFENSE_SUSPEND_PRIORITY);
  recruitBaseDefenders(ctx, attacker, attackedHouse, attackedObject);
}

function recruitBaseDefenders(
  ctx: CombatContext,
  attacker: Entity,
  attackedHouse: House,
  attackedObject?: Entity | MapStructure,
): void {
  let desired = technoRisk(attacker) * (ctx.houseTechLevel?.(attackedHouse) ?? 10);
  if (desired <= 0) return;

  const attackedCell = attackedObjectCell(attackedObject);
  const zone = attackedCell ? movementZoneCellsForBaseDefense(ctx.map, attackedCell) : undefined;
  const defenders: Array<{ entity: Entity; value: number }> = [];

  desired += collectBaseDefenders(ctx, attacker, attackedHouse, attackedObject, attackedCell, zone, true, defenders);
  if (desired <= 0) return;
  desired += collectBaseDefenders(ctx, attacker, attackedHouse, attackedObject, attackedCell, zone, false, defenders);
  if (desired <= 0) return;
  if (defenders.length === 0) return;

  defenders.sort((a, b) => b.value - a.value);
  let riskTotal = 0;
  const randomTag = takeDamageSourceTag(attackedObject);
  for (const { entity } of defenders.slice(0, 6)) {
    const rescue = randomTag !== undefined
      ? withScenarioRandomSourceTag(randomTag, () => ScenarioRandom.percentChance(50))
      : ScenarioRandom.percentChance(50);
    if (rescue) {
      assignMission(entity, Mission.RESCUE);
    } else {
      assignMission(entity, Mission.AREA_GUARD);
      if (attackedObject instanceof Entity) {
        entity.archiveTargetEntity = attackedObject;
        entity.archiveTarget = { cx: attackedObject.cell.cx, cy: attackedObject.cell.cy };
        entity.archiveTargetLeptons = null;
      } else {
        entity.archiveTargetEntity = null;
        if (attackedCell) entity.archiveTarget = { cx: attackedCell.cx, cy: attackedCell.cy };
        const archiveCoord = attackedObjectTargetLeptons(attackedObject);
        entity.archiveTargetLeptons = archiveCoord;
      }
    }
    assignEntityTarCom(entity, attacker);
    riskTotal += technoRisk(entity);
    if (riskTotal > desired) break;
  }

  if (riskTotal > desired) {
    attacker.baseAttackTimer = Math.max(1, Math.round(ctx.gameTicksPerSec * 60 * BASE_DEFENSE_DELAY_MINUTES));
  }
}

function collectBaseDefenders(
  ctx: CombatContext,
  attacker: Entity,
  attackedHouse: House,
  attackedObject: Entity | MapStructure | undefined,
  attackedCell: { cx: number; cy: number } | undefined,
  attackedZone: Set<number> | undefined,
  infantryPass: boolean,
  defenders: Array<{ entity: Entity; value: number }>,
): number {
  let desiredAdjustment = 0;
  for (const entity of ctx.entities) {
    if (!entity.alive || entity.inLimbo || entity.house !== attackedHouse) continue;
    if (infantryPass) {
      if (!entity.stats.isInfantry) continue;
    } else {
      if (entity.stats.isInfantry || entity.isAirUnit || entity.isNavalUnit) continue;
    }
    const weapon = entity.weapon;
    if (!weapon) continue;
    if (!MISSION_CONTROL[entity.mission]?.isRecruitable) continue;
    if (getWarheadMult(weapon.warhead, attacker.stats.armor, ctx.warheadOverrides) === 0) continue;
    if (attackedZone && !attackedZone.has(entity.cell.cy * MAP_CELLS + entity.cell.cx)) continue;

    let threat = rescueMissionThreat(ctx, entity, attacker, weapon);
    if (threat === 0) continue;
    const isProtectingAttackedObject = attackedObject instanceof Entity
      ? entity.archiveTargetEntity === attackedObject
      : attackedCell && entity.archiveTarget?.cx === attackedCell.cx && entity.archiveTarget?.cy === attackedCell.cy;
    if (isProtectingAttackedObject) {
      threat *= infantryPass ? 100 : 10;
    }
    if (threat < 0) {
      desiredAdjustment += threat;
      continue;
    }
    defenders.push({ entity, value: threat });
  }
  return desiredAdjustment;
}

function rescueMissionThreat(ctx: CombatContext, defender: Entity, attacker: Entity, weapon: WeaponStats): number {
  if (!attacker.alive || attacker.inLimbo) return 0;
  const risk = technoRisk(defender);
  if (risk <= 0) return 0;
  if (defender.target === attacker) return -risk;
  if (defender.target?.alive && defender.target.weapon) return 0;
  if (defender.teamRef || defender.mission === Mission.HARVEST) return 0;

  const target = attacker.targetCoordLeptons();
  const dist = leptonDist(defender.leptonX, defender.leptonY, target.lx, target.ly) -
    Math.round((weapon.range ?? 0) * LEPTON_SIZE);
  let threat = risk * 1024;
  if (dist > 0) {
    const speed = Math.max(1, iniSpeedToMph(defender.stats.speed ?? 1));
    const ratio = Math.max(Math.trunc(dist / speed), 1);
    threat = Math.max(Math.trunc(threat / ratio), 1);
  }
  return threat;
}

function technoRisk(entity: Entity): number {
  const points = entity.stats.points;
  if (points !== undefined) return Math.max(0, Math.trunc(points));
  const item = PRODUCTION_ITEMS.find(p => p.type === entity.type);
  if (item?.points !== undefined) return Math.max(0, Math.trunc(item.points));
  if (item?.cost !== undefined) return Math.max(1, Math.trunc(item.cost / 100));
  return Math.max(1, Math.trunc(entity.maxHp / 50));
}

function attackedObjectCell(attackedObject?: Entity | MapStructure): { cx: number; cy: number } | undefined {
  if (!attackedObject) return undefined;
  if (attackedObject instanceof Entity) return attackedObject.cell;
  return { cx: attackedObject.cx, cy: attackedObject.cy };
}

function attackedObjectTargetLeptons(attackedObject?: Entity | MapStructure): { lx: number; ly: number } | null {
  if (!attackedObject) return null;
  if (attackedObject instanceof Entity) return attackedObject.targetCoordLeptons();
  return structureCenterLeptons(attackedObject);
}

function takeDamageSourceTag(attackedObject?: Entity | MapStructure): number | undefined {
  if (!attackedObject) return undefined;
  if (!(attackedObject instanceof Entity)) return 52005; // RTTI_BUILDING
  if (attackedObject.stats.isInfantry) return 52013; // RTTI_INFANTRY
  if (attackedObject.isAirUnit) return 52001; // RTTI_AIRCRAFT
  if (attackedObject.isNavalUnit) return 52030; // RTTI_VESSEL
  return 52028; // RTTI_UNIT
}

function assignEntityTarCom(entity: Entity, target: Entity | null): void {
  entity.target = target;
  entity.targetStructure = null;
  entity.forceFirePos = null;
}

function movementZoneCellsForBaseDefense(map: GameMap, start: { cx: number; cy: number }): Set<number> {
  const result = new Set<number>();
  const startIdx = start.cy * MAP_CELLS + start.cx;
  if (!map.isTerrainPassable(start.cx, start.cy)) {
    result.add(startIdx);
    return result;
  }
  const queue: Array<{ cx: number; cy: number }> = [start];
  result.add(startIdx);
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    for (let dir = 0; dir < DIR_COUNT; dir += 2) {
      const nx = cur.cx + DIR_DX[dir];
      const ny = cur.cy + DIR_DY[dir];
      const idx = ny * MAP_CELLS + nx;
      if (result.has(idx)) continue;
      if (!map.isTerrainPassable(nx, ny)) continue;
      result.add(idx);
      queue.push({ cx: nx, cy: ny });
    }
  }
  return result;
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
	  const isGroundVehicle = !victim.stats.isInfantry && !victim.stats.isAircraft && !victim.stats.isVessel;
	  const deathExplosionSprite = isGroundVehicle ? 'frag1' : 'fball1';
	  if (isGroundVehicle) {
	    // C++ unit.cpp:1009-1020 creates UnitTypeClass::Explosion before
	    // crew/passenger ejection. RA's vehicle classes use ANIM_FRAG1 in udata.cpp,
	    // and the AnimClass occupies a Logic slot even when the renderer also draws
	    // a simple explosion effect.
	    spawnLogicAnimForSprite(
	      ctx.logicAnims,
	      ctx.effects,
	      deathExplosionSprite,
	      kx,
	      ky,
	      false,
	      ctx.logicAnimsAlreadyProcessed === true,
	      ctx.logicIndexHintForNewObject?.(),
	      ctx.logicIndexHintForNewObject,
	      ctx.reserveAnimSlot,
	    );
	  }
	  ctx.effects.push({
	    type: 'explosion',
	    x: kx,
	    y: ky,
	    frame: 0,
	    maxFrames: EXPLOSION_FRAMES[deathExplosionSprite] ?? 18,
	    size: opts.explosionSize,
	    sprite: deathExplosionSprite,
	    spriteStart: 0,
	  } as Effect);
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
      spawnLogicAnim(
        ctx.logicAnims, ctx.effects, 'elect_die', kx, ky, 1, true,
        false,
        ctx.logicIndexHintForNewObject?.(),
        ctx.logicIndexHintForNewObject,
        ctx.reserveAnimSlot,
        false,
        undefined,
        0,
        undefined,
        ctx.tick,
      );
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
  // For FootClass descendants, Detach_All first removes the object from its
  // team (foot.cpp:1844-1853). Dead team members must stop participating in
  // TeamClass::AI immediately; otherwise attack teams can keep issuing orders
  // to a zero-strength infantry object through the death-animation window.
  if (victim.teamRef) {
    victim.teamRef.remove(victim, ctx);
  }
  if (victim.isAirUnit) {
    for (const structure of ctx.structures) {
      if (structure.dockedAircraft === victim.id) {
        structure.dockedAircraft = undefined;
      }
    }
    victim.landedAtStructure = -1;
    victim.aircraftDockingStructure = -1;
  }
  // InfantryClass::Detach also drops IsFiring when TarCom is detached. Without
  // this, TS keeps stale object references to destroyed vehicles and later code
  // treats those references as live orders until the next mission timer happens
  // to validate them.
  victim.target = null;
  victim.targetStructure = null;
  victim.moveTarget = null;
  victim.moveTargetEntityRef = null;
  clearFootPath(victim);
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
      restoreSuspendedMissionAfterDetach(ctx, entity, victim);
      if (entity.stats.isInfantry) {
        // C++ ObjectClass::Detach_All reaches InfantryClass::Assign_Target
        // through TechnoClass::Detach; assigning TARGET_NONE clears Path[0]
        // without stopping the active Head_To_Coord hop.
        clearInfantryAssignTargetPathHead(entity);
        entity.isFiringAnim = false;
        entity.firingAnimTicks = 0;
      }
    }
    if (entity.moveTargetEntityRef === victim) {
      entity.moveTarget = null;
      entity.moveTargetEntityRef = null;
      clearFootPath(entity);
      restoreSuspendedMissionAfterDetach(ctx, entity, victim);
    }
  }
  for (const structure of ctx.structures) {
    if (structure.targetEntityId === victim.id) {
      // C++ TechnoClass::Detach only clears TarCom here. Mission_Attack later
      // notices TARGET_NONE, falls back to GUARD, and only then does a normal
      // guard scan pick the next target.
      structure.targetEntityId = undefined;
    }
  }
  for (const team of getActiveTeams()) {
    team.detachTargetEntity(victim);
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
      ctx.logicIndexHintForNewObject?.(),
      ctx.logicIndexHintForNewObject,
      ctx.reserveAnimSlot,
    );
    const radiusLeptons = Math.trunc(explosionDamage * EXP_SPREAD); // C++ fixed int multiply
    wideAreaDamage(ctx, victim.leptonX, victim.leptonY, radiusLeptons, explosionDamage, opts.attacker, explosionWarhead);
  }

  releaseDestroyedUnitOccupancy(ctx, victim);

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
    const spot = closestInfantryUnlimboSpot(ctx as unknown as AircraftContext, inf, victim.leptonX, victim.leptonY);
    if (spot) {
      inf.leptonX = spot.lx;
      inf.leptonY = spot.ly;
      inf.syncPosFromLeptons();
      inf.subCell = spot.subCell;
      if (ctx.map.occupyClaimedSubCell(spot.cellIdx, inf.id, spot.subCell)) {
        inf.claimedCellIdx = spot.cellIdx;
        inf.claimedSubCell = spot.subCell;
      } else {
        inf.claimedCellIdx = -1;
        inf.claimedSubCell = -1;
      }
      inf.logicIndexHint = ctx.logicIndexHintForNewObject?.();
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
  }

  // C++ aircraft.cpp:1599-1604 — Aircraft parachute survivors on destruction.
  // Conditions: IsCrew=true, 90% probability, clear foot-move cell, spawns E1
  // through InfantryClass::Paradrop (not a ground-level Unlimbo).
  if (victim.stats.crewed && victim.stats.isAircraft) {
    const savedSourceTag = ScenarioRandom._sourceTag;
    if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = 40060;
    const shouldParadropCrew = ScenarioRandom.percentChance(90);
    if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = savedSourceTag;

    const deathCell = victim.cell;
    const canParadropAtDeathCell =
      shouldParadropCrew &&
      ctx.map.isTerrainPassable(deathCell.cx, deathCell.cy) &&
      !ctx.map.hasVehicleOccupancy(deathCell.cx, deathCell.cy) &&
      ctx.map.hasAvailableSubCell(deathCell.cx, deathCell.cy);

    if (canParadropAtDeathCell) {
      const inf = new Entity(UnitType.I_E1, victim.house, kx, ky);
      inf.logicIndexHint = ctx.logicIndexHintForNewObject?.();
      const spot = closestInfantryUnlimboSpot(ctx as unknown as AircraftContext, inf, victim.leptonX, victim.leptonY);
      if (spot) {
        inf.leptonX = spot.lx;
        inf.leptonY = spot.ly;
        inf.syncPosFromLeptons();
        inf.subCell = spot.subCell;
        inf.claimedCellIdx = spot.cellIdx;
        inf.claimedSubCell = spot.subCell;

        // C++ ObjectClass::Paradrop sets Height=FLIGHT_LEVEL and IsFalling before
        // Unlimbo. TechnoClass::AI then returns early while this non-air infantry
        // still has Height > 0, so a survivor appended to Logic mid-frame cannot
        // immediately run Mission_Guard/HUNT RNG on the same tick.
        inf.isFalling = true;
        inf.fallHeightLeptons = Entity.FLIGHT_LEVEL_LEPTONS;
        inf.fallRiser = 0;
        inf.flightAltitude = leptonToPixel(inf.fallHeightLeptons);

        // TechnoClass::Unlimbo performs Enter_Idle_Mode(true)+Commence, then
        // InfantryClass::Paradrop queues the final human GUARD / AI HUNT mission.
        inf.mission = ctx.idleMission?.(inf) ?? Mission.GUARD;
        inf.missionTimer = 0;
        inf.missionQueue = null;
        assignMission(inf, inf.house === ctx.playerHouse ? Mission.GUARD : Mission.HUNT);

        ctx.entities.push(inf);
        ctx.entityById.set(inf.id, inf);
        attachFallingParachuteAnim(inf, ctx.logicIndexHintForNewObject, ctx.reserveAnimSlot);
        ctx.markDiscoveredIfPlayerVisible?.(inf);
      }
    }
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
export function triggerRetaliation(ctx: CombatContext, victim: Entity, attacker: DamageSource): void {
  // C++ techno.cpp:4929 — source == NULL (implied by null-check before call)
  if (!victim.alive || !sourceIsAlive(attacker)) return;

  // C++ foot.cpp:1176-1179 — team members delegate to Team->Took_Damage
  // immediately after TechnoClass::Take_Damage returns a non-NONE result. This
  // happens before the individual Is_Allowed_To_Retaliate gates below, so same-
  // house splash, non-retaliating missions, and other otherwise-blocked sources
  // can still update Team::Target.
  if (victim.teamRef) {
    victim.teamRef.tookDamage(victim, attacker, ctx);
    return;
  }

  const priorMission = victim.mission;

  // C++ techno.cpp:4934 — MissionControl[Mission].IsRetaliate must be true
  // Blocks HUNT, SLEEP, ENTER, CAPTURE, HARVEST, UNLOAD, RETREAT, HARMLESS,
  // CONSTRUCTION, DECONSTRUCTION retaliation.
  const mc = MISSION_CONTROL[victim.mission];
  if (mc && !mc.isRetaliate) return;

  // C++ techno.cpp:4939-4941 — fixed-wing aircraft cannot retaliate
  if (victim.stats.isAircraft && victim.stats.isFixedWing) return;

  // C++ techno.cpp:4947 — House->Is_Ally(source) blocks retaliation
  if (ctx.isAllied(victim.house, sourceHouse(attacker))) return;

  // C++ techno.cpp:4952 — Combat_Damage() <= 0 || !Is_Weapon_Equipped() blocks.
  // Unarmed TS exception: crusher vehicles without a weapon (HARV-style) still
  // pursue crush via unit.cpp:1124-1161 — evaluated below.
  // C++ House->IsHuman is strict PlayerPtr ownership, not "allied to PlayerPtr".
  // Game.isPlayerControlled() intentionally means player-or-ally for UI/scoring,
  // so do not use it for C++ retaliation/auto-crush gates. SCG07EA England is a
  // computer-controlled allied house and still auto-retaliates in C++.
  const isVictimHumanHouse = victim.house === ctx.playerHouse;

  // C++ unit.cpp:1124-1161: auto-crush retaliation path.
  const houseIQ = ctx.aiIQ?.(victim.house) ?? 3;
  if (isEntitySource(attacker) && shouldCrushIt(victim, attacker, isVictimHumanHouse, houseIQ)) {
    assignEntityTarCom(victim, attacker);
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
    const whMult = getWarheadMult(victim.weapon.warhead, sourceArmor(attacker), overrides);
    if (whMult <= 0) return;
  }

  // C++ techno.cpp:4968 — source is dog blocks retaliation
  if (isEntitySource(attacker) && (attacker.stats.isCanine || attacker.type === UnitType.I_DOG)) return;

  // C++ techno.cpp:4973 — source is aircraft, victim must have AA.
  // TS refinement: only block when aircraft is AIRBORNE (altitude > 0). Landed
  // aircraft are valid ground targets in TS (matching the pre-existing behavior
  // and covering unit test semantics: HPAD-landed HIND is treated as ground).
  if (isEntitySource(attacker) && attacker.isAirUnit && attacker.flightAltitude > 0) {
    const hasAA = victim.weapon?.isAntiAir || victim.weapon2?.isAntiAir;
    if (!hasAA) return;
  }

  // Naval gate: can't retaliate against untargetable naval units
  if (isEntitySource(attacker) && !canTargetNaval(victim, attacker)) return;

  // C++ techno.cpp:4980-4983 — human-controlled Tanya (IsBomber) cannot retaliate
  // against buildings.

  // C++ techno.cpp:4988 — human house + !IsSmartDefense (PlayerReturnFire=no) blocks
  // retaliation, EXCEPT Tanya vs infantry.
  // rules.ini [General] PlayerReturnFire=no → Rule.IsSmartDefense = false.
  if (isVictimHumanHouse) {
    const isTanyaVsInfantry = victim.type === UnitType.I_TANYA && isEntitySource(attacker) && attacker.stats.isInfantry;
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
    const source = sourceWeapon(attacker);
    const sourceVal = source && (isEntitySource(attacker) ? victim.inRange(attacker) : true)
      ? getWarheadMult((source.warhead ?? 'HE') as WarheadType, victim.stats.armor, overrides)
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
  if (isVictimHumanHouse && isEntitySource(attacker) && !victim.inRange(attacker)) return;

  // C++ foot.cpp:1206 — Assign_Target(source->As_Target()).
  // Assign_Target changes TarCom only; it does not force MISSION_ATTACK.
  if (isEntitySource(attacker)) {
    assignEntityTarCom(victim, attacker);
  } else {
    victim.target = null;
    victim.targetStructure = attacker;
  }

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
    // C++ unit.cpp:4407 — Distance(object->Center_Coord()) < CELL_LEPTON_W/2.
    // coord.cpp:124 Distance is the integer octagonal metric, not Euclidean distance.
    if (leptonDist(vehicle.leptonX, vehicle.leptonY, other.leptonX, other.leptonY) >= (LEPTON_SIZE >> 1)) continue;
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
  detachCellTargetFromTargeting(ctx, vc.cx, vc.cy);
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
  facing256Override?: number,
  homingTargetCoordOverride?: { lx: number; ly: number },
): void {
  // C++ techno.cpp:3124-3171 launches bullets from Fire_Coord(which), not
  // Center_Coord(). The fire coordinate feeds projectile range, facing, fuse
  // proximity, and the initial BulletClass::Unlimbo position.
  const fireCoord = launchCoordOverride ?? (
    typeof attacker.fireCoordForWeapon === 'function' ? attacker.fireCoordForWeapon(weapon) :
      weapon === attacker.weapon && typeof attacker.fireCoordPrimary === 'function' ? attacker.fireCoordPrimary() :
        { lx: attacker.leptonX, ly: attacker.leptonY }
  );
  // C++ techno.cpp:3200-3204: IsDropping bullets are a special case. They use
  // Center_Coord(), not Fire_Coord(), because they fall vertically from the
  // firer instead of flying toward the target.
  const launchCoord = weapon.isDropping
    ? { lx: attacker.leptonX, ly: attacker.leptonY }
    : fireCoord;
  const targetLX = pixelToLepton(impactX);
  const targetLY = pixelToLepton(impactY);
  const staticHomingTarget = homingTargetCoordOverride ?? (target === null ? { lx: targetLX, ly: targetLY } : undefined);
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
  // C++ bullet.cpp:747-750 leaves range at 0xff for IsDropping bullets. They
  // bypass Fuse_Checkup while falling and explode only through the forced
  // `IsDropping && !IsFalling` path.
  const travelFrames = weapon.isDropping ? 0xFF : Math.max(1, Math.trunc(fuseDist / maxSpeed) + 4);

  // C++ bullet.cpp:756-771 — arcing projectile ground speed is adjusted by
  // target distance after the fuse range is computed from MaxSpeed.
  const isArcing = !!weapon.isArcing;
  if (isArcing) {
    speed = Math.max(maxSpeed + Math.trunc(fuseDist / 32), 25);
  }

  const speedAdd = weapon.isDropping
    // C++ AircraftClass::Fire_At gives falling bullets drift after
    // BulletClass::Unlimbo skips the normal Fly_Speed setup.
    ? (attacker.isAirUnit ? AIRCRAFT_DROPPING_SPEED_ADD : 0)
    : (isLightSpeedInvisible || speed === LIGHT_SPEED
      ? 0
      : Math.trunc((speed * 255 + 128) / 256));
  const flameTrailAnim = projectileTrailAnimForWeapon(weapon);

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
    if (attacker.claimedCellIdx >= 0 && attacker.claimedSubCell >= 0) {
      ctx.map.vacateClaimedSubCell(attacker.claimedCellIdx, attacker.id, attacker.claimedSubCell);
    }
    ctx.map.vacateSubCell(attacker.cell.cx, attacker.cell.cy, attacker.id);
    attacker.claimedCellIdx = -1;
    attacker.claimedSubCell = -1;
    attacker.isDriving = false;
    attacker.headToLX = 0;
    attacker.headToLY = 0;
    attacker.inLimbo = true;
    ctx.releaseLogicSlotForEntity?.(attacker);
    attacker.dogRiderLimboStartTick = ctx.tick;
    dogRiderId = attacker.id;
  }

  const logicIndexHint = ctx.logicIndexHintForNewObject?.();
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
    // C++ bullet.cpp:790-802 — IsDropping starts at ObjectClass::FLIGHT_LEVEL
    // (256 leptons). IsParachuted attaches ANIM_PARA_BOMB, so ObjectClass::AI
    // uses the IsAnimAttached fall branch: Riser -= 1, clamped to -3.
    isDropping: !!weapon.isDropping,
    dropHeight: weapon.isDropping ? Entity.FLIGHT_LEVEL_LEPTONS : 0,
    dropRiser: 0,
    dropHasAttachedAnim: !!weapon.isParachuted,
    // C++ bullet.cpp:377-386 — IsFlameEquipped: flame trail toggle
    isFlameEquipped: flameTrailAnim !== undefined,
    flameTrailAnim,
    flameToggle: false,  // C++ IsToAnimate starts false
    logicalLX: bulletStartLX,
    logicalLY: bulletStartLY,
    headToLX: targetLX,
    headToLY: targetLY,
    homingTargetLX: staticHomingTarget?.lx,
    homingTargetLY: staticHomingTarget?.ly,
    facing256: facing256Override !== undefined
      ? (facing256Override & 0xff)
      : directionToLeptons256(bulletStartLX, bulletStartLY, targetLX, targetLY),
    desiredFacing256: facing256Override !== undefined
      ? (facing256Override & 0xff)
      : directionToLeptons256(bulletStartLX, bulletStartLY, targetLX, targetLY),
    speedAccum: 0,
    speedAdd,
    fuseTimer: Math.min(0xFF, travelFrames),
    armingTimer: 0,
    proximity: fuseDist,
    logicIndexHint,
    createdLogicTick: ctx.tick,
  });
}

/** Launch a projectile from a defensive structure.
 *  C++ BuildingClass::Fire_At still creates a BulletClass for invisible
 *  structure projectiles (Vulcan/Invisible, ZSU-23/Ack, TeslaZap/Invisible).
 *  Damage/scatter happens in BulletClass::AI, not synchronously in
 *  BuildingClass::Mission_Attack. */
function launchStructureProjectile(
  ctx: CombatContext,
  s: MapStructure,
  target: Entity,
  weapon: StructureWeapon,
): void {
  const { lx: launchLX, ly: launchLY } = structureFireLeptons(s, target);
  const targetCoord = entityTargetLeptons(target);
  const scatter = structureProjectileImpactAfterScatter(
    s,
    weapon,
    target,
    { lx: launchLX, ly: launchLY },
    targetCoord,
  );
  const targetLX = scatter.targetLX;
  const targetLY = scatter.targetLY;
  const maxSpeed = weapon.projSpeed !== undefined
    ? iniSpeedToMph(weapon.projSpeed)
    : LIGHT_SPEED;
  const isInvisible = !!weapon.isInvisible;
  const isLightSpeedInvisible = isInvisible && maxSpeed === LIGHT_SPEED;
  const bulletStartLX = isLightSpeedInvisible ? targetLX : launchLX;
  const bulletStartLY = isLightSpeedInvisible ? targetLY : launchLY;
  const fuseDist = leptonDist(bulletStartLX, bulletStartLY, targetLX, targetLY);
  const speed = isLightSpeedInvisible ? 0 : maxSpeed;
  const travelFrames = Math.max(1, Math.trunc(fuseDist / maxSpeed) + 4);
  const speedAdd = isLightSpeedInvisible || speed === LIGHT_SPEED
    ? 0
    : Math.trunc((speed * 255 + 128) / 256);
  const flameTrailAnim = projectileTrailAnimForWeaponName(weapon.weaponName ?? s.type);

  const logicIndexHint = ctx.logicIndexHintForNewObject?.();
  const attackerStructureIndex = ctx.structures.indexOf(s);
  ctx.inflightProjectiles.push({
    attackerId: -1,
    attackerHouse: s.house,
    attackerStructure: s,
    attackerStructureIndex: attackerStructureIndex >= 0 ? attackerStructureIndex : undefined,
    targetId: target.id,
    weapon: {
      name: weapon.weaponName ?? s.type,
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
    directHit: scatter.directHit,
    impactX: scatter.impactX,
    impactY: scatter.impactY,
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
    dropRiser: 0,
    dropHasAttachedAnim: false,
    isFlameEquipped: flameTrailAnim !== undefined,
    flameTrailAnim,
    flameToggle: false,
    logicalLX: bulletStartLX,
    logicalLY: bulletStartLY,
    headToLX: targetLX,
    headToLY: targetLY,
    facing256: scatter.facing256 ?? directionToLeptons256(bulletStartLX, bulletStartLY, targetLX, targetLY),
    desiredFacing256: scatter.facing256 ?? directionToLeptons256(bulletStartLX, bulletStartLY, targetLX, targetLY),
    speedAccum: 0,
    speedAdd,
    fuseTimer: Math.min(0xFF, travelFrames),
    armingTimer: 0,
    proximity: fuseDist,
    logicIndexHint,
    createdLogicTick: ctx.tick,
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

function projectileTrailAnimForWeaponName(weaponName: string): InflightProjectile['flameTrailAnim'] {
  const visual = projectileVisualConfig(weaponName);
  if (!visual.projFlameTrail) return undefined;
  return visual.projImage === 'fball1' ? 'fball_fade' : 'smoke_puff';
}

function projectileTrailAnimForWeapon(weapon: WeaponStats): InflightProjectile['flameTrailAnim'] {
  return weapon.isFlameEquipped
    ? (projectileVisualConfig(weapon.name).projImage === 'fball1' ? 'fball_fade' : 'smoke_puff')
    : projectileTrailAnimForWeaponName(weapon.name);
}

function spawnProjectileTrailAnim(ctx: CombatContext, proj: InflightProjectile): void {
  const pos = projectilePixelPosition(proj);
  const anim = proj.flameTrailAnim ??
    (projectileVisualConfig(proj.weapon.name).projImage === 'fball1' ? 'fball_fade' : 'smoke_puff');
  const isFballFade = anim === 'fball_fade';
  const type: LogicAnimType = isFballFade ? 'fball_fade' : 'smokey';
  const logicIndexHint = ctx.logicIndexHintForNewObject?.();
  const spawned = spawnLogicAnim(
    ctx.logicAnims,
    ctx.effects,
    type,
    pos.x,
    pos.y,
    1,
    true,
    false,
    logicIndexHint,
    ctx.logicIndexHintForNewObject,
    ctx.reserveAnimSlot,
    false,
    undefined,
    1,
    undefined,
    ctx.tick,
  );
  if (!spawned) {
    projectileTrace({
      event: 'trail-skip-full',
      tick: ctx.tick,
      weapon: proj.weapon.name,
      hint: proj.logicIndexHint,
      trailHint: logicIndexHint,
      currentFrame: proj.currentFrame,
      logicalLX: proj.logicalLX,
      logicalLY: proj.logicalLY,
    });
    return;
  }
  projectileTrace({
    event: 'trail',
    tick: ctx.tick,
    weapon: proj.weapon.name,
    hint: proj.logicIndexHint,
    trailHint: logicIndexHint,
    currentFrame: proj.currentFrame,
    logicalLX: proj.logicalLX,
    logicalLY: proj.logicalLY,
    x: pos.x,
    y: pos.y,
    lx: pixelToLepton(pos.x),
    ly: pixelToLepton(pos.y),
    anim,
  });
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

function rotateFacing256(current: number, desired: number, rate: number): number {
  const cappedRate = Math.min(rate, 127);
  if (cappedRate <= 0) return current & 0xff;
  let diff = (desired - current) & 0xff;
  if (diff > 127) diff -= 256;
  if (Math.abs(diff) < cappedRate) return desired & 0xff;
  return diff < 0
    ? (current - cappedRate + 256) & 0xff
    : (current + cappedRate) & 0xff;
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

type LogicPredecessorSnapshot = {
  entityIds: Set<number>;
  structures: Set<MapStructure>;
};

function snapshotProjectilePredecessors(ctx: CombatContext): LogicPredecessorSnapshot {
  return {
    entityIds: new Set(ctx.entities.filter(entityOccupiesCppLogic).map(e => e.id)),
    structures: new Set(ctx.structures.filter(structureOccupiesCppLogic)),
  };
}

function entityOccupiesCppLogic(entity: Entity | undefined): entity is Entity {
  return !!entity && entity.occupiesCppLogic();
}

function structureOccupiesCppLogic(s: MapStructure): boolean {
  // BuildingClass::Take_Damage leaves destroyed buildings in the Logic list
  // until BuildingClass::AI reaches Drop_Debris/Limbo. They must not count as
  // earlier Logic deletions while CountDown is still pending.
  return s.alive || (!s.debrisDropped && s.debrisCountdown !== undefined);
}

function countLiveProjectilePredecessors(ctx: CombatContext, snapshot: LogicPredecessorSnapshot): number {
  let live = 0;
  for (const id of snapshot.entityIds) {
    const e = ctx.entityById.get(id);
    if (entityOccupiesCppLogic(e)) live++;
  }
  for (const s of snapshot.structures) {
    if (structureOccupiesCppLogic(s)) live++;
  }
  return live;
}

function projectileRemainsInLogic(proj: InflightProjectile): boolean {
  if (proj.isDropping) return proj.dropHeight > 0 || proj.currentFrame === 0;
  if (proj.isFueled && proj.fuelTimer <= 0) return false;
  if (proj.isArcing) return proj.arcHeight > 0 || proj.currentFrame <= 1;
  return true;
}

/** Advance one BulletClass logic step; return true when it detonates/deletes itself. */
function advanceProjectileOneTick(ctx: CombatContext, proj: InflightProjectile): boolean {
  proj.currentFrame++;
  const target = ctx.entityById.get(proj.targetId);

  // C++ bullet.cpp:478-480 — IsDegenerate: projectile loses 1 strength per tick during flight (min 5)
  if (proj.weapon.isDegenerate && proj.strength > 5) {
    proj.strength--;
  }

  // C++ fuse.cpp:127 — fuel timer always decrements each tick (FuseClass::Fuse_Checkup)
  if (proj.fuelTimer > 0) {
    proj.fuelTimer--;
  }

  // C++ object.cpp:237-254 + bullet.cpp:790-802 — dropped bullets fall from
  // FLIGHT_LEVEL. ParaBombs have an attached parachute animation, so their
  // Riser decreases by 1 and clamps to -3; non-parachuted drops use Rule.Gravity.
  if (proj.isDropping && proj.dropHeight > 0) {
    const riser = proj.dropRiser ?? 0;
    proj.dropHeight += riser;
    if (proj.dropHeight <= 0) {
      proj.dropHeight = 0;
    }
    if (proj.dropHasAttachedAnim ?? !!proj.weapon.isParachuted) {
      proj.dropRiser = Math.max(riser - 1, -3);
    } else {
      proj.dropRiser = Math.max(riser - RULE_GRAVITY, -100);
    }
  }

  // C++ bullet.cpp:377-386 — IsFlameEquipped: spawn flame/smoke trail every other tick
  if (proj.isFlameEquipped) {
    if (proj.flameToggle) {
      // C++ bullet.cpp:380-385 creates ANIM_FBALL_FADE only for FB1
      // projectiles; other Animates=yes bullets create ANIM_SMOKE_PUFF.
      spawnProjectileTrailAnim(ctx, proj);
    }
    proj.flameToggle = !proj.flameToggle;  // C++ IsToAnimate = !IsToAnimate
  }

  // C++ bullet.cpp:368-397 — homing projectiles update DesiredFacing toward
  // TarCom on every other global game frame, then Rotation_Adjust happens before
  // physics. This is keyed to `Frame & 1`, not the projectile's age; otherwise
  // missiles spawned on the opposite parity turn one frame early.
  // FuseClass::HeadTo is separate and remains the scattered impact coordinate.
  const rot = proj.weapon.projectileROT ?? 0;
  if (rot > 0) {
    const homingTarget = target && target.alive
      ? entityTargetLeptons(target)
      : (proj.homingTargetLX !== undefined && proj.homingTargetLY !== undefined
        ? { lx: proj.homingTargetLX, ly: proj.homingTargetLY }
        : null);
    if (((ctx.tick & 0x01) === 0) && homingTarget) {
      proj.desiredFacing256 = directionToLeptons256(
        proj.logicalLX, proj.logicalLY,
        homingTarget.lx, homingTarget.ly,
      );
    }
    if (proj.desiredFacing256 !== undefined && proj.facing256 !== (proj.desiredFacing256 & 0xff)) {
      proj.facing256 = rotateFacing256(proj.facing256, proj.desiredFacing256 & 0xff, rot);
    }
  }

  // C++ BulletClass::AI always runs FlyClass::Physics before fuse handling.
  // Arcing projectiles are still normal BulletClass objects here: they move
  // horizontally via FlyClass and only their Height/Riser is special.
  const useFlyPhysicsCoord = !proj.isDropping || proj.speedAdd > 0;
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

  // C++ bullet.cpp:903-914 — wall collision check (Is_Forced_To_Explode)
  // Non-high bullets that enter a cell containing an IsHigh overlay explode on contact.
  // Dropping projectiles skip this check (C++ type.h:1383: "Dropping projectiles do not
  // calculate collision with terrain (such as walls)").
  if (!proj.weapon.isHigh && !proj.weapon.isDropping) {
    const t = proj.currentFrame / Math.max(1, proj.travelFrames);
    const cur = useFlyPhysicsCoord ? projectilePixelPosition(proj) : null;
    const curX = cur?.x ?? (proj.startX + (proj.impactX - proj.startX) * Math.min(t, 1));
    const curY = cur?.y ?? (proj.startY + (proj.impactY - proj.startY) * Math.min(t, 1));
    const cc = worldToCell(curX, curY);
    if (HIGH_WALL_TYPES.has(ctx.map.getWallType(cc.cx, cc.cy))) {
      // Force-explode at wall cell center (C++ coord = Cell_Coord(Coord_Cell(coord)))
      proj.impactX = cc.cx * CELL_SIZE + CELL_SIZE / 2;
      proj.impactY = cc.cy * CELL_SIZE + CELL_SIZE / 2;
      proj.travelFrames = proj.currentFrame; // land now
      return true;
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
      return true;
    }
  }

  // C++ bullet.cpp:946-948 — AA proximity detonation (Is_Forced_To_Explode)
  // Anti-air projectiles detonate when within half a cell (~0x0080 leptons) of an airborne target.
  if (proj.weapon.isAntiAir && target && target.alive && target.isAirUnit && target.flightAltitude > 0) {
    const t = proj.currentFrame / Math.max(1, proj.travelFrames);
    const cur = useFlyPhysicsCoord ? projectilePixelPosition(proj) : null;
    const curX = cur?.x ?? (proj.startX + (proj.impactX - proj.startX) * Math.min(t, 1));
    const curY = cur?.y ?? (proj.startY + (proj.impactY - proj.startY) * Math.min(t, 1));
    const targetCoord = entityTargetPixels(target);
    const distToTarget = Math.sqrt((curX - targetCoord.x) ** 2 + (curY - targetCoord.y) ** 2);
    // C++ Distance(TarCom) < 0x0080: 128 leptons = half a cell (CELL_LEPTON_W=256)
    if (distToTarget < CELL_SIZE / 2) {
      proj.impactX = targetCoord.x;
      proj.impactY = targetCoord.y;
      proj.travelFrames = proj.currentFrame; // detonate now
      return true;
    }
  }

  // C++ bullet.cpp:359-361 — IsDropping: force-explode when dropHeight reaches 0
  // (Class->IsDropping && !IsFalling): once height descends to 0, bullet lands
  if (proj.isDropping && proj.dropHeight <= 0 && proj.currentFrame > 0) {
    // C++ Bullet_Explodes(forced=true) does not snap Coord to Fuse_Target().
    // Damage is applied at the bullet's current Coord, i.e. the ground point
    // under the firer where the bomb was dropped.
    const cur = projectilePixelPosition(proj);
    proj.impactX = cur.x;
    proj.impactY = cur.y;
    return true;
  }

  // C++ fuse.cpp:139 — IsFueled: force-explode when fuel timer reaches 0 (ran out of fuel mid-air)
  // Fuse_Checkup returns true when Timer == 0 after arming delay expires
  if (proj.isFueled && proj.fuelTimer <= 0) {
    return true;
  }

  // C++ bullet.cpp:474 — only dropping projectiles bypass Fuse_Checkup.
  // Arcing projectiles still use the normal proximity/timer fuse and explode
  // at their current Coord; height<=0 is a forced explosion path.
  const hasLanded = proj.isArcing
    ? ((proj.arcHeight <= 0 && proj.currentFrame > 1) || tickProjectileFuse(proj))
    : (!proj.isDropping ? tickProjectileFuse(proj) : false);
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
      // C++ bullet.cpp:981-991 — normal fuse detonations for non-homing,
      // non-arcing projectiles snap Coord to Fuse_Target() before damage.
      // DogJaw has ROT but still takes this snap path because Payback is dog.
      // The projectile's current Coord can be a few leptons away when the
      // proximity fuse trips; damage still uses the stored target coord.
      if (proj.dogRiderId >= 0 || (proj.weapon.projectileROT ?? 0) === 0) {
        proj.impactX = proj.headToLX * CELL_SIZE / LEPTON_SIZE;
        proj.impactY = proj.headToLY * CELL_SIZE / LEPTON_SIZE;
      } else {
        const cur = projectilePixelPosition(proj);
        proj.impactX = cur.x;
        proj.impactY = cur.y;
      }
    }
    return true;
  }

  return false;
}

/** Advance in-flight projectiles; apply damage + splash on arrival.
 *  When `maxLogicIndexHint` is finite, only bullets submitted at or before
 *  that C++ Logic index are eligible. This lets the TS batched projectile pass
 *  run a BulletClass object before a later runtime-spawned infantry object,
 *  matching LogicClass::AI's re-read of Count(). */
export function updateInflightProjectiles(ctx: CombatContext, maxLogicIndexHint = Infinity): void {
  const processAll = maxLogicIndexHint === Infinity;
  const queue: InflightProjectile[] = [];
  const deferred: InflightProjectile[] = [];
  const alreadyProcessed: InflightProjectile[] = [];

  for (const proj of ctx.inflightProjectiles) {
    if (proj.processedLogicTick === ctx.tick) {
      alreadyProcessed.push(proj);
      continue;
    }
    if (processAll ||
        (proj.logicIndexHint !== undefined && proj.logicIndexHint <= maxLogicIndexHint)) {
      queue.push(proj);
    } else {
      deferred.push(proj);
    }
  }

  const survivors: InflightProjectile[] = [...alreadyProcessed];
  const predecessors = snapshotProjectilePredecessors(ctx);
  let shiftedBehindCursor = 0;
  const skipLogicHintRanges: LogicSkipRange[] = [];
  const spawnedThisPass = new Set<InflightProjectile>();

  ctx.inflightProjectiles = [...survivors, ...deferred];

  for (let i = 0; i < queue.length; i++) {
    const proj = queue[i];
    const skipRange = proj.logicIndexHint === undefined
      ? undefined
      : skipLogicHintRanges.find(range =>
          proj.logicIndexHint! >= range.after && proj.logicIndexHint! <= range.through);
    if (!spawnedThisPass.has(proj) &&
        proj.logicIndexHint !== undefined &&
        skipRange !== undefined) {
      projectileTrace({
        event: 'skip-shifted',
        tick: ctx.tick,
        weapon: proj.weapon.name,
        hint: proj.logicIndexHint,
        currentFrame: proj.currentFrame,
        fuelTimer: proj.fuelTimer,
        fuseTimer: proj.fuseTimer,
        skipLogicHintAfter: skipRange.after,
        skipLogicHintThrough: skipRange.through,
      });
      proj.processedLogicTick = ctx.tick;
      survivors.push(proj);
      continue;
    }
    if (proj.logicIndexHint === undefined && shiftedBehindCursor > 0) {
      projectileTrace({
        event: 'skip-unhinted',
        tick: ctx.tick,
        weapon: proj.weapon.name,
        currentFrame: proj.currentFrame,
        fuelTimer: proj.fuelTimer,
        fuseTimer: proj.fuseTimer,
        shiftedBehindCursor,
      });
      proj.processedLogicTick = ctx.tick;
      survivors.push(proj);
      shiftedBehindCursor--;
      continue;
    }

    projectileTrace({
      event: 'advance',
      tick: ctx.tick,
      weapon: proj.weapon.name,
      hint: proj.logicIndexHint,
      currentFrame: proj.currentFrame,
      fuelTimer: proj.fuelTimer,
      fuseTimer: proj.fuseTimer,
      headToLX: proj.headToLX,
      headToLY: proj.headToLY,
    });
    const arrived = advanceProjectileOneTick(ctx, proj);
    projectileTrace({
      event: arrived ? 'arrived' : 'survived',
      tick: ctx.tick,
      weapon: proj.weapon.name,
      hint: proj.logicIndexHint,
      currentFrame: proj.currentFrame,
      fuelTimer: proj.fuelTimer,
      fuseTimer: proj.fuseTimer,
      logicalLX: proj.logicalLX,
      logicalLY: proj.logicalLY,
      impactLX: pixelToLepton(proj.impactX),
      impactLY: pixelToLepton(proj.impactY),
    });
    if (!processAll) {
      proj.processedLogicTick = ctx.tick;
    }
    if (!arrived) {
      if (projectileRemainsInLogic(proj)) {
        survivors.push(proj);
      } else {
        ctx.deferLogicSlotRelease?.(proj.logicIndexHint);
      }
      continue;
    }

    const liveBefore = countLiveProjectilePredecessors(ctx, predecessors);
    const unprocessed = queue.slice(i + 1);
    const knownProjectiles = new Set<InflightProjectile>([...survivors, ...unprocessed, ...deferred]);
    ctx.inflightProjectiles = [...survivors, ...unprocessed, ...deferred];

    detonateProjectile(ctx, proj);
    ctx.deferLogicSlotRelease?.(proj.logicIndexHint);

    const spawnedProjectiles = ctx.inflightProjectiles.filter(p => !knownProjectiles.has(p));
    for (const spawned of spawnedProjectiles) {
      spawnedThisPass.add(spawned);
      projectileTrace({
        event: 'spawned',
        tick: ctx.tick,
        weapon: spawned.weapon.name,
        hint: spawned.logicIndexHint,
        currentFrame: spawned.currentFrame,
        fuelTimer: spawned.fuelTimer,
        fuseTimer: spawned.fuseTimer,
        headToLX: spawned.headToLX,
        headToLY: spawned.headToLY,
      });
      if (processAll ||
          (spawned.logicIndexHint !== undefined && spawned.logicIndexHint <= maxLogicIndexHint)) {
        queue.push(spawned);
      } else {
        deferred.push(spawned);
      }
    }
    ctx.inflightProjectiles = [...survivors, ...deferred];

    const liveAfter = countLiveProjectilePredecessors(ctx, predecessors);
    const earlierDeletes = Math.max(0, liveBefore - liveAfter);
    if (proj.logicIndexHint !== undefined) {
      // Deleting an earlier Logic predecessor can decrement following hints
      // before this local projectile skip is applied. Cover both the original
      // cursor neighborhood and the already-shifted representation.
      const skipLogicHintAfter = Math.max(0, proj.logicIndexHint - earlierDeletes);
      const skipLogicHintThrough = proj.logicIndexHint + earlierDeletes;
      if (skipLogicHintThrough > skipLogicHintAfter) {
        const range = { after: skipLogicHintAfter, through: skipLogicHintThrough };
        skipLogicHintRanges.push(range);
        (ctx.shiftedLogicSkipRanges ??= []).push(range);
        if (skipLogicHintThrough > (ctx.shiftedLogicSkipHintThrough ?? -Infinity)) {
          ctx.shiftedLogicSkipHintAfter = skipLogicHintAfter;
          ctx.shiftedLogicSkipHintThrough = skipLogicHintThrough;
        }
      }
      projectileTrace({
        event: 'delete-shift',
        tick: ctx.tick,
        weapon: proj.weapon.name,
        hint: proj.logicIndexHint,
        earlierDeletes,
        skipLogicHintAfter,
        skipLogicHintThrough,
      });
    } else {
      shiftedBehindCursor += Math.min(earlierDeletes, unprocessed.length);
    }
  }

  ctx.inflightProjectiles = [...survivors, ...deferred];
}

function dogUnlimboEnterIdleMode(ctx: CombatContext, dog: Entity): void {
  // C++ TechnoClass::Unlimbo calls InfantryClass::Enter_Idle_Mode(true) and
  // Commence() before BulletClass::~BulletClass starts DO_DOG_MAUL.
  const hasTarCom = !!(dog.target?.alive && !dog.target.inLimbo) ||
    !!(dog.targetStructure && dog.targetStructure.alive !== false);

  if (hasTarCom) {
    assignMission(dog, Mission.ATTACK);
    commence(dog, 'dog-unlimbo-enter-idle-target');
    return;
  }

  dog.target = null;
  dog.targetStructure = null;
  dog.forceFirePos = null;

  if (dog.moveTarget) {
    assignMission(dog, Mission.MOVE);
    commence(dog, 'dog-unlimbo-enter-idle-navcom');
    return;
  }

  const control = MISSION_CONTROL[dog.mission];
  if (dog.mission !== Mission.GUARD &&
      dog.mission !== Mission.AREA_GUARD &&
      !(dog.mission !== Mission.NONE && (control?.isParalyzed || control?.isZombie))) {
    const idle = ctx.idleMission?.(dog) ?? (ctx.isPlayerControlled(dog) || dog.teamRef ? Mission.GUARD : Mission.AREA_GUARD);
    if (idle === Mission.AREA_GUARD && dog.type === UnitType.I_DOG && !ctx.isPlayerControlled(dog) && !dog.teamRef) {
      dog.archiveTarget = { cx: dog.cell.cx, cy: dog.cell.cy };
      dog.archiveTargetEntity = null;
      dog.archiveTargetLeptons = null;
    }
    assignMission(dog, idle);
  }

  commence(dog, 'dog-unlimbo-enter-idle');
}

function detonateProjectile(ctx: CombatContext, proj: InflightProjectile): void {
    const target = ctx.entityById.get(proj.targetId);
    const attacker = ctx.entityById.get(proj.attackerId);
    const attackerStructure =
      proj.attackerStructure ??
      (proj.attackerStructureIndex !== undefined
        ? ctx.structures[proj.attackerStructureIndex]
        : undefined);
    // C++ BulletClass::Detach clears Payback when the firing object is detached
    // (object.cpp Detach_All -> bullet.cpp:636-649). If the source object died
    // before this projectile explodes, damage must see source=NULL; otherwise
    // InfantryClass::Take_Damage scatters away from a dead object instead of
    // using the no-threat Scatter(0) branch.
    const dogRiderPayback = proj.dogRiderId >= 0 && attacker?.id === proj.dogRiderId;
    const liveAttacker = attacker?.alive && (!attacker.inLimbo || dogRiderPayback) ? attacker : undefined;
    const liveAttackerStructure = attackerStructure?.alive ? attackerStructure : undefined;

    // C++ bullet.cpp:478-480 — use degraded strength (proj.strength) instead of original damage
    const impactDamage = proj.strength;

    // C++ bullet.cpp:991 — Bullet_Explodes calls Explosion_Damage at ORIGINAL coord, BEFORE
    // the Coord_Scatter for invisible projectiles (line 1012). Damage uses un-scattered
    // position; only anim/effect display uses scattered position.
    const attackerHouse = liveAttacker?.house ?? liveAttackerStructure?.house ?? proj.attackerHouse ?? (proj.attackerIsPlayer ? ctx.playerHouse : House.USSR);
    const targetIsTopLayerAircraft = !!(target && target.isAirUnit && entityInTopLayer(target));
    if (targetIsTopLayerAircraft && target) {
      // C++ bullet.cpp:996-1008: airborne aircraft targets bypass
      // Explosion_Damage entirely. They take direct aircraft damage only when
      // the bullet's current Coord is within 0x80 leptons of TarCom.
      const targetCoord = entityTargetLeptons(target);
      const impactLX = pixelToLepton(proj.impactX);
      const impactLY = pixelToLepton(proj.impactY);
      if (leptonDist(impactLX, impactLY, targetCoord.lx, targetCoord.ly) < 0x0080) {
        const wh = proj.weapon.warhead;
        const whMult = getWarheadMult(wh, target.stats.armor, ctx.warheadOverrides);
        const houseBias = ctx.getFirepowerBias(attackerHouse);
        const damage = modifyDamage(impactDamage, wh, target.stats.armor, 0, houseBias, whMult, getWarheadMeta(wh, ctx.scenarioWarheadMeta).spreadFactor);
        const killed = damageEntity(ctx, target, damage, wh, liveAttacker, {
          sourceStructure: liveAttackerStructure,
        });
        if (killed) {
          handleUnitDeath(ctx, target, {
            screenShake: 4, explosionSize: 12, debris: false,
            decal: null,
            explodeLgSound: false,
            attackerIsPlayer: ctx.isAllied(attackerHouse, ctx.playerHouse),
            trackLoss: !ctx.isAllied(target.house, attackerHouse),
            attacker: liveAttacker,
          });
        }
      }
    } else {
      // C++ combat.cpp:176: range = ICON_LEPTON_W + (ICON_LEPTON_W >> 1) = 1.5 cells
      // Use weapon splash if defined, otherwise default to SPLASH_RADIUS (1.5 cells)
      const splashRadius = (proj.weapon.splash && proj.weapon.splash > 0)
        ? proj.weapon.splash
        : SPLASH_RADIUS;
      applySplashDamage(
        ctx, { x: proj.impactX, y: proj.impactY },
        { damage: impactDamage, warhead: proj.weapon.warhead, splash: splashRadius },
        -1,  // No entity excluded from splash (firer is already excluded inside applySplashDamage)
        attackerHouse, liveAttacker, liveAttackerStructure,
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
      (projTarget && projTarget.isAirUnit && entityInTopLayer(projTarget)) ? 'air' :
      (ctx.map.getTerrain(projImpactCell.cx, projImpactCell.cy) === Terrain.WATER) ? 'water' : 'ground';
    const projImpactSprite = combatAnim(proj.strength, projExpSet, projLand);
    // V2RL SCUD: large explosion + screen shake on impact (C++ IsGigundo=true)
    const isScud = proj.weapon.name === 'SCUD';
    if (projImpactSprite) {
      ctx.effects.push({ type: 'explosion', x: proj.impactX, y: proj.impactY,
        frame: 0, maxFrames: EXPLOSION_FRAMES[projImpactSprite] ?? 17, size: isScud ? 20 : 8, sprite: projImpactSprite, spriteStart: 0 } as Effect);
      // C++ travelling bullets are Logic objects. When BulletClass::AI explodes and
      // creates an AnimClass, logic.cpp's dynamic Count() loop reaches the new anim
      // later in that same tick and consumes only its IsBrandNew skip. If TS has
      // already passed its AnimClass phase, pre-clear that skip so the next tick
      // starts at the same stage; otherwise leave IsBrandNew set for this tick's
      // anim phase to consume.
      spawnLogicAnimForSprite(
        ctx.logicAnims,
        ctx.effects,
        projImpactSprite,
        proj.impactX,
        proj.impactY,
        false,
        ctx.logicAnimsAlreadyProcessed === true,
        ctx.logicIndexHintForNewObject?.(),
        ctx.logicIndexHintForNewObject,
        ctx.reserveAnimSlot,
      );
    }
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
        for (let i = 0; i < offsets.length; i++) {
          const [dx, dy] = offsets[i];
          const cx = impactCell.cx + dx;
          const cy = impactCell.cy + dy;
          if (ctx.map.inBounds(cx, cy) && ctx.map.isPassable(cx, cy)) {
            const candidate = i === 0
              ? { lx: pixelToLepton(proj.impactX), ly: pixelToLepton(proj.impactY) }
              : cellTargetToLepton(cx, cy);
            const spot = closestInfantryUnlimboSpot(
              ctx as unknown as AircraftContext,
              dog,
              candidate.lx,
              candidate.ly,
              true,
            );
            if (!spot) continue;
            let slots = ctx.map.subCellOccupancy.get(spot.cellIdx);
            if (!slots) {
              slots = [0, 0, 0, 0, 0] as [number, number, number, number, number];
              ctx.map.subCellOccupancy.set(spot.cellIdx, slots);
            }
            slots[spot.subCell] = dog.id;
            if (ctx.map.occupancy[spot.cellIdx] === 0) ctx.map.occupancy[spot.cellIdx] = dog.id;
            dog.inLimbo = false;
            if (dog.dogRiderLimboStartTick >= 0) {
              const elapsed = Math.max(0, ctx.tick - dog.dogRiderLimboStartTick);
              dog.missionTimer = Math.max(0, dog.missionTimer - elapsed);
              dog.attackCooldown = Math.max(0, dog.attackCooldown - elapsed);
              dog.attackCooldown2 = Math.max(0, dog.attackCooldown2 - elapsed);
              dog.cooldownFrameSyncedTick = ctx.tick;
              dog.dogRiderLimboStartTick = -1;
            }
            dog.leptonX = spot.lx;
            dog.leptonY = spot.ly;
            dog.syncPosFromLeptons();
            dog.subCell = spot.subCell;
            dog.claimedCellIdx = spot.cellIdx;
            dog.claimedSubCell = spot.subCell;
            dog.firePrepActive = false;
            dog.firePrepStage = 0;
            dog.firePrepUsesDoingStage = false;
            dog.isFiringAnim = false;
            dog.firingAnimTicks = 0;
            dogUnlimboEnterIdleMode(ctx, dog);
            dog.missionTimerSetTick = ctx.tick;
            dog.resubmittedAfterLogicHint = proj.logicIndexHint ?? -1;
            // ObjectClass::Unlimbo submits the dog back into Logic at the
            // current end rather than restoring its original Infantry slot.
            ctx.resubmitEntityToLogicEnd?.(dog);
            // C++ bullet.cpp:152 — Do_Action(DO_DOG_MAUL, true).
            dog.startDogMaulDoing(ctx.tick);
            unlimboed = true;
            break;
          }
        }
        // C++ bullet.cpp:165-167 — if (!unlimbo) delete dog;
        if (!unlimboed) {
          dog.alive = false;
          dog.inLimbo = false;
          dog.dogRiderLimboStartTick = -1;
          dog.mission = Mission.DIE;
        }
      }
    }
}

/** Apply AOE splash damage to entities near an impact point.
 *  CF2/CF3: Uses fixed 1.5-cell radius and C++ inverse-proportional falloff via modifyDamage. */
export function applySplashDamage(
  ctx: CombatContext,
  center: WorldPos, weapon: { damage: number; warhead: WarheadType; splash?: number },
  primaryTargetId: number, attackerHouse: House, attacker?: Entity, attackerStructure?: MapStructure,
): void {
  // CF3: Universal 1.5-cell splash radius (C++ Explosion_Damage uses ICON_LEPTON_W + ICON_LEPTON_W/2)
  const splashRange = SPLASH_RADIUS;
  const attackerIsPlayerControlled = ctx.isAllied(attackerHouse, ctx.playerHouse);
  const impactCell = worldToCell(center.x, center.y);
  const centerLX = pixelToLepton(center.x);
  const centerLY = pixelToLepton(center.y);
  const splashRangeLeptons = splashRange * LEPTON_SIZE;

  // C++ combat.cpp:207 — splash excludes the FIRER (source), not the direct-hit target.
  // C++ bullet.cpp:991 — Explosion_Damage is the SOLE damage path; there is no separate
  // direct-hit call. The direct-hit target receives damage through this splash calculation
  // at distance ~0, getting full warhead damage.
  const sourceId = attacker?.id ?? -1;

  const damageEntityVictim = (other: Entity): void => {
    if (!other.alive || other.inLimbo || other.id === sourceId) return;
    // H2: Splash damage hits ALL units in radius including friendlies (C++ Explosion_Damage)
    const isFriendly = ctx.isAllied(other.house, attackerHouse);
    const distLeptons = leptonDist(centerLX, centerLY, other.leptonX, other.leptonY);
    // C++ combat.cpp:232 uses a strict bound: `distance < range`.
    // range is ICON_LEPTON_W + ICON_LEPTON_W/2 = 384 leptons, so an object
    // exactly 1.5 cells away is NOT damaged. TS previously used `>`, which
    // included the boundary and over-damaged SCG07EA E1 at (26,58).
    if (distLeptons >= splashRangeLeptons) return;
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
      if (rawDamage <= 0) return;
    }

    // CF2: C++ inverse-proportional falloff via modifyDamage (combat.cpp:106-125)
    const distPixels = distCells * CELL_SIZE;
    const whMult = getWarheadMult(weapon.warhead, other.stats.armor, ctx.warheadOverrides);
    const splashDmg = modifyDamage(rawDamage, weapon.warhead, other.stats.armor, distPixels, 1.0, whMult, getWarheadMeta(weapon.warhead, ctx.scenarioWarheadMeta).spreadFactor);
    const hpBefore = other.hp;
    splashTrace({
      event: 'damage-entity',
      tick: ctx.tick,
      centerLX,
      centerLY,
      victim: `${other.type}#${other.id}`,
      cell: `${other.cell.cx},${other.cell.cy}`,
      rawDamage,
      splashDmg,
      distLeptons,
      hpBefore,
      seed: ScenarioRandom.seed >>> 0,
    });
    if (splashDmg === 0) {
      // C++ Explosion_Damage still calls UnitClass::Take_Damage with raw
      // nonzero strength. ObjectClass may reduce HP damage to zero, but
      // UnitClass post-call side effects still run; computer harvesters can
      // trigger Base_Is_Attacked from harmless small-arms splash.
      if (rawDamage > 0 && attacker && other.type === UnitType.V_HARV) {
        maybeSuspendTeamsForBaseAttack(ctx, attacker, other.house, false, other);
      }
      return;
    }
    const killed = damageEntity(ctx, other, splashDmg, weapon.warhead, attacker, {
      skipProneBias: proneBiasApplied,
      sourceStructure: attackerStructure,
    });
    splashTrace({
      event: 'damaged-entity',
      tick: ctx.tick,
      victim: `${other.type}#${other.id}`,
      hpBefore,
      hpAfter: other.hp,
      alive: other.alive,
      killed,
      seed: ScenarioRandom.seed >>> 0,
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
  };

  const damageStructureVictim = (s: MapStructure, directImpactHead: boolean): void => {
    if (!s.alive) return;
    // Walls are C++ overlays, not ordinary BuildingClass damage targets in
    // Explosion_Damage. They are handled by the impact-cell Reduce_Wall path below.
    if (WALL_TYPES.has(s.type)) return;
    const structureCenter = structureCenterLeptons(s);
    const distLeptons = directImpactHead
      ? 0
      : leptonDist(centerLX, centerLY, structureCenter.lx, structureCenter.ly);
    if (distLeptons >= splashRangeLeptons) return;
    if (attacker) {
      // C++ combat.cpp:232-237 calls BuildingClass::Take_Damage for any
      // in-range building with the raw explosion strength. building.cpp:1250
      // then calls Base_Is_Attacked(source) before ObjectClass::Take_Damage
      // applies armor/distance falloff. Preserve that ordering: base defense can
      // suspend teams even when final structure HP damage is reduced to zero.
      recordStructureSourceAttack(ctx, s, attacker);
      maybeSuspendTeamsForBaseAttack(ctx, attacker, s.house, Boolean(STRUCTURE_WEAPONS[s.type]), s);
    }
    // Apply damage using per-building armor from rules.ini (C++ bdata.cpp)
    const distPixels = distLeptons * CELL_SIZE / LEPTON_SIZE;
    const sArmor = s.armor ?? (STRUCTURE_ARMOR[s.type] ?? 'wood');
    const whMult = getWarheadMult(weapon.warhead, sArmor, ctx.warheadOverrides);
    const splashDmg = modifyDamage(weapon.damage, weapon.warhead, sArmor, distPixels, 1.0, whMult, getWarheadMeta(weapon.warhead, ctx.scenarioWarheadMeta).spreadFactor);
    if (splashDmg <= 0) return;
    const hpBefore = s.hp;
    splashTrace({
      event: 'damage-structure',
      tick: ctx.tick,
      centerLX,
      centerLY,
      victim: `${s.type}@${s.cx},${s.cy}`,
      rawDamage: weapon.damage,
      splashDmg,
      distLeptons,
      directImpactHead,
      hpBefore,
      seed: ScenarioRandom.seed >>> 0,
    });
    withScenarioRandomSourceTag(52005, () => {
      structureDamage(ctx, s, splashDmg, attacker, weapon.warhead, { skipBaseAttack: true });
    });
    splashTrace({
      event: 'damaged-structure',
      tick: ctx.tick,
      victim: `${s.type}@${s.cx},${s.cy}`,
      hpBefore,
      hpAfter: s.hp,
      alive: s.alive,
      seed: ScenarioRandom.seed >>> 0,
    });
  };

  type SplashObject =
    | { kind: 'entity'; entity: Entity }
    | { kind: 'structure'; structure: MapStructure };

  const sameSplashObject = (a: SplashObject | null, b: SplashObject): boolean => {
    if (!a || a.kind !== b.kind) return false;
    if (a.kind === 'entity' && b.kind === 'entity') return a.entity === b.entity;
    if (a.kind === 'structure' && b.kind === 'structure') return a.structure === b.structure;
    return false;
  };

  const objectSortKey = (entity: Entity): number => entity.logicIndexHint ?? entity.id;
  const reservedEntityIds = ctx.explosionDamageReservedEntityIds ??= new Set<number>();
  const reservedStructures = ctx.explosionDamageReservedStructures ??= new Set<MapStructure>();
  const cellStructureCache = new Map<number, MapStructure[]>();
  const structuresInCell = (cx: number, cy: number): MapStructure[] => {
    const key = cy * MAP_CELLS + cx;
    const cached = cellStructureCache.get(key);
    if (cached) return cached;
    const found = ctx.structures.filter(s =>
      structureOccupiesCppLogic(s) &&
      !WALL_TYPES.has(s.type) &&
      getStructureOccupyCells(s.type, s.cx, s.cy).some(cell => cell.cx === cx && cell.cy === cy));
    cellStructureCache.set(key, found);
    return found;
  };

  const cellChain = (cx: number, cy: number): SplashObject[] => {
    const cellEntities = ctx.entities
      .filter(e =>
        e.alive && !e.inLimbo &&
        entityOccupiesCellForExplosionDamage(e) &&
        e.cell.cx === cx && e.cell.cy === cy)
      // C++ CellClass::Occupy_Down prepends non-buildings, so the newest
      // object to occupy a cell is encountered first.
      .sort((a, b) => objectSortKey(b) - objectSortKey(a))
      .map(entity => ({ kind: 'entity' as const, entity }));
    const cellStructures = structuresInCell(cx, cy)
      // C++ appends buildings at the tail of the Cell_Occupier chain.
      .map(structure => ({ kind: 'structure' as const, structure }));
    return [...cellEntities, ...cellStructures];
  };

  const scanOffsets = [
    { dx: 0, dy: 0 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 1, dy: 1 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: -1, dy: -1 },
  ];

  // C++ combat.cpp:188-222 first snapshots Cell_Occupier() pointers into
  // objects[32], then applies damage. Death side effects may create new
  // infantry, but those new objects are not part of the current explosion.
  const victims: SplashObject[] = [];
  const seenEntities = new Set<number>();
  const seenStructures = new Set<MapStructure>();
  let impactHead: SplashObject | null = null;

  for (const offset of scanOffsets) {
    const cx = impactCell.cx + offset.dx;
    const cy = impactCell.cy + offset.dy;
    if (!ctx.map.inBounds(cx, cy)) continue;
    const chain = cellChain(cx, cy);
    if (offset.dx === 0 && offset.dy === 0) {
      impactHead = chain[0] ?? null;
    }
    for (const object of chain) {
      if (object.kind === 'entity') {
        if (object.entity.id === sourceId ||
            seenEntities.has(object.entity.id) ||
            reservedEntityIds.has(object.entity.id)) continue;
        seenEntities.add(object.entity.id);
      } else {
        if (seenStructures.has(object.structure) || reservedStructures.has(object.structure)) continue;
        seenStructures.add(object.structure);
      }
      victims.push(object);
      if (object.kind === 'entity') {
        reservedEntityIds.add(object.entity.id);
      } else {
        reservedStructures.add(object.structure);
      }
      if (victims.length >= 32) break;
    }
    if (victims.length >= 32) break;
  }

  splashTrace({
    event: 'victims',
    tick: ctx.tick,
    centerLX,
    centerLY,
    damage: weapon.damage,
    warhead: weapon.warhead,
    victims: victims.map(v => v.kind === 'entity'
      ? `E:${v.entity.type}#${v.entity.id}@${v.entity.cell.cx},${v.entity.cell.cy}`
      : `S:${v.structure.type}@${v.structure.cx},${v.structure.cy}`),
    seed: ScenarioRandom.seed >>> 0,
  });

  const releaseVictim = (victim: SplashObject): void => {
    if (victim.kind === 'entity') {
      reservedEntityIds.delete(victim.entity.id);
    } else {
      reservedStructures.delete(victim.structure);
    }
  };

  try {
    for (const victim of victims) {
      // C++ clears ObjectClass::IsToDamage immediately before calling
      // Take_Damage. Nested death explosions can include the current object, but
      // must still skip later outer-list victims until their turn arrives.
      releaseVictim(victim);
      if (victim.kind === 'entity') {
        damageEntityVictim(victim.entity);
      } else {
        // C++ combat.cpp:227-228 gives distance=0 only when the impact cell's
        // Cell_Occupier head is this building, not merely when the footprint
        // includes the impact cell.
        damageStructureVictim(victim.structure, sameSplashObject(impactHead, victim));
      }
    }
  } finally {
    for (const victim of victims) {
      releaseVictim(victim);
    }
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
        const connectionIcon = ctx.map.getWallConnectionIcon(impactCell.cx, impactCell.cy, wallType);
        const clearsWithMissingDamagedArt = nextLevel === damageLevels - 1 && connectionIcon === 0;
        if (weapon.damage === -1 || nextLevel >= damageLevels || clearsWithMissingDamagedArt) {
          ctx.map.clearWallType(impactCell.cx, impactCell.cy);
          detachCellTargetFromTargeting(ctx, impactCell.cx, impactCell.cy);
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
        const bridgeResult = ctx.map.destroyBridgeAtCellIndex(bridgeIdx);
        if (bridgeResult.changedCells > 0) {
          if (bridgeResult.animationCell && Array.isArray(ctx.logicAnims) && Array.isArray(ctx.effects)) {
            spawnLogicAnim(
              ctx.logicAnims,
              ctx.effects,
              'napalm3',
              bridgeResult.animationCell.cx * CELL_SIZE + CELL_SIZE / 2,
              bridgeResult.animationCell.cy * CELL_SIZE + CELL_SIZE / 2,
              1,
              true,
              ctx.logicAnimsAlreadyProcessed ?? false,
              ctx.logicIndexHintForNewObject?.(),
              ctx.logicIndexHintForNewObject,
              ctx.reserveAnimSlot,
              false,
              undefined,
              0,
              undefined,
              ctx.tick,
            );
          }
          if (bridgeResult.fullyDestroyed) {
            killBridgeOccupants(ctx, impactCell.cx, impactCell.cy, 3);
            ctx.showEvaMessage(7); // "Bridge destroyed."
          }
          ctx.bridgeCellCount = ctx.map.countBridgeCells();
        } else {
          const destroyed = ctx.map.destroyBridge(impactCell.cx, impactCell.cy, 3);
          if (destroyed > 0) {
            killBridgeOccupants(ctx, impactCell.cx, impactCell.cy, 3);
            ctx.bridgeCellCount = ctx.map.countBridgeCells();
            ctx.showEvaMessage(7); // "Bridge destroyed."
          }
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
        // SA warhead cannot destroy terrain; non-fire hits do not damage a tree
        // that is already burning.
        const hitTree = ctx.map.getTreeAtCell(tx, ty);
        if (
          hitTree &&
          !hitTree.immune &&
          hitTree.hp > 0 &&
          weapon.warhead !== 'SA' &&
          (!hitTree.isOnFire || weapon.warhead === 'Fire') &&
          !damagedTrees.has(hitTree)
        ) {
          damagedTrees.add(hitTree);
          // C++ terrain.cpp Center_Coord: distance from explosion to tree center (not origin).
          // XYP_COORD gives pixel offset from origin cell's top-left to tree center.
          const centerOff = TREE_CENTER_OFFSET[hitTree.type];
          const treeCenterX = hitTree.cx * CELL_SIZE + (centerOff ? centerOff[0] : CELL_SIZE / 2);
          const treeCenterY = hitTree.cy * CELL_SIZE + (centerOff ? centerOff[1] : CELL_SIZE / 2);
          const distLeptons = leptonDist(centerLX, centerLY, pixelToLepton(treeCenterX), pixelToLepton(treeCenterY));
          if (distLeptons >= splashRangeLeptons) continue;
          const distPixels = distLeptons * CELL_SIZE / LEPTON_SIZE;
          const treeDmg = modifyDamage(weapon.damage, weapon.warhead, 'wood', distPixels);
          if (treeDmg > 0) {
            hitTree.hp = Math.max(0, hitTree.hp - treeDmg);
            if (weapon.warhead === 'Fire') {
              catchTreeFire(ctx, hitTree);
            }
            if (hitTree.hp <= 0) {
              if (hitTree.isOnFire) {
                shortenTreeAttachedAnims(ctx, hitTree);
              } else {
                // Tree destroyed — clear from map (C++ terrain.cpp Start_To_Crumble + destructor)
                ctx.map.destroyTree(hitTree);
                ctx.releaseTerrainLogicSlot?.(hitTree);
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
}

/** Damage a structure, return true if destroyed.
 *  Extracted from Game class (index.ts) — handles HP reduction, destruction effects,
 *  AI base attack tracking, EVA alerts, gap generator unjam, footprint clearing,
 *  bridge destruction, and structure explosion blast damage to nearby units. */
export function structureDamage(
  ctx: CombatContext,
  s: MapStructure,
  damage: number,
  source?: Entity,
  warhead: WarheadType = 'HE',
  options?: StructureDamageOptions,
): boolean {
  if (!s.alive || s.hp <= 0) return false;
  if (source) recordStructureSourceAttack(ctx, s, source);
  if (source && !options?.skipBaseAttack) maybeSuspendTeamsForBaseAttack(ctx, source, s.house, Boolean(STRUCTURE_WEAPONS[s.type]), s);
  // C++ house.cpp:2751 — Iron Curtain makes structures invulnerable (no damage taken)
  if (s.ironCurtainTicks && s.ironCurtainTicks > 0) return false;
  const oldHp = s.hp;
  const halfHp = s.maxHp >> 1;
  if (source && damage > 0 && !ctx.isAllied(s.house, source.house)) {
    s.isTickedOff = true;
  }
  s.hp = Math.max(0, s.hp - damage);
  if (damage > 0) {
    maybeAssignStructureReturnFireTarget(ctx, s, source);
  }
  const destroyedByThisHit = oldHp > 0 && s.hp <= 0;
  if (destroyedByThisHit) {
    // C++ ObjectClass::Take_Damage applies Strength=0 before Record_The_Kill()
    // springs ATTACKED/DESTROYED triggers. TACTION_DESTROY_OBJECT can then see
    // the triggering object as already dead and will not destroy it a second time.
    s.alive = false;
  }
  // C++ flasher.cpp:83-95 + house.cpp:2308 — Blushing damage flash.
  // Set FlashCount to 6 so 3 odd ticks (5, 3, 1) render the white "lightening" tint.
  // Keeps existing countdown if larger so repeated hits stack gracefully.
  s.flashCount = Math.max(s.flashCount ?? 0, 6);
  // Track attacked trigger names for TEVENT_ATTACKED. C++ only springs ATTACKED
  // when a real source object is supplied; source-less forced trigger damage
  // should not arm another ATTACKED event.
  if (s.triggerName && source && damage > 0) {
    ctx.attackedTriggerNames.add(s.triggerName);
  }
  // House attack state was recorded at function entry to match C++ ordering:
  // BuildingClass::Take_Damage updates LATime/LAEnemy/Enemy before applying
  // armor, immunity, or low-level ObjectClass damage.
  // EVA "base under attack" for player structures (throttled)
  if (ctx.isAllied(s.house, ctx.playerHouse) &&
      ctx.tick - ctx.lastBaseAttackEva > ctx.gameTicksPerSec * 60) {
    ctx.lastBaseAttackEva = ctx.tick;
    ctx.playEva('eva_base_attack');
    ctx.minimapAlert(s.cx, s.cy);
  }
  if (s.triggerName && source && damage > 0) {
    ctx.springAttackedTriggerByName?.(s.triggerName);
  }
  if (!destroyedByThisHit && !s.alive) {
    return true;
  }
  if (destroyedByThisHit) {
    // C++ ObjectClass::Take_Damage calls Detach_All() after Record_The_Kill()
    // and before RESULT_DESTROYED effects. Clear every TarCom/Team target that
    // points at this building so mission logic cannot keep attacking rubble.
    detachStructureFromTargeting(ctx, s);
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
    if (!WALL_TYPES.has(s.type) && !INSIGNIFICANT_STRUCTURE_TYPES.has(s.type)) {
      ctx.recordBuildingLost?.(s.house);
    }
    // Clear terrain footprint so units can walk through rubble
    ctx.clearStructureFootprint(s);
    const wx = s.cx * CELL_SIZE + CELL_SIZE;
    const wy = s.cy * CELL_SIZE + CELL_SIZE;
    const [fw, fh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
    // Attached AnimClass fires stay in the fixed Anims heap until their next
    // AI pass, but are marked to delete without running further logic.
    detachStructureAttachedAnims(ctx, s);
    // C++ building.cpp:1299-1308 — immediate RESULT_DESTROYED visuals run
    // during Take_Damage. Rubble smoke/survivors are delayed until Drop_Debris.
    runBuildingDestroyedTakeDamageEffects(ctx, s);
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
    // C++ building.cpp:1380-1405 — only BARL/BRL3 destruction creates
    // gameplay damage bullets. Ordinary building destruction is visual-only
    // here; it does not damage adjacent structures or units.
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
        launchBarrelDeathBullet(ctx, s, off.dx, off.dy);
      }
    }
    // Leave large scorch mark
    ctx.map.addDecal(s.cx, s.cy, 14, 0.6);
    // C++ building.cpp:1330-1334 — force-destroyed buildings and kennels
    // do not generate Drop_Debris survivors.
    if (options?.forced || s.type === 'KENN') {
      s.isSurvivorless = true;
    }
    // C++ building.cpp:1317-1320 — destroyed buildings remain in Logic for
    // CountDown frames. Drop_Debris (survivors, smoke, scorch/crater) runs
    // later from BuildingClass::AI, not inside Take_Damage.
    // C++ CDTimerClass starts counting from the frame CountDown is assigned.
    // BuildingClass::AI can run later in that same frame without elapsing a tick.
    s.debrisCountdown = s.mission === Mission.DECONSTRUCTION ? 0 : 8;
    s.debrisDropTick = ctx.tick + s.debrisCountdown;
    s.debrisDropped = false;
    return true;
  }
  const isResultHalf = oldHp >= halfHp && s.hp < halfHp;
  if (isResultHalf || s.hp === 1) {
    runBuildingDamageStateEffects(ctx, s, warhead, source, isResultHalf);
  }
  return false;
}

// ── Delayed Drop_Debris ──────────────────────────────────────────────────────

const SURVIVOR_FRACTION_RAW = 102; // C++ fixed(".4") => (256 * 4) / 10, truncated.
const E1_COST = 100;
const CIVILIAN_CREW_TYPES = [
  UnitType.I_C1, UnitType.I_C2, UnitType.I_C3, UnitType.I_C4, UnitType.I_C5,
  UnitType.I_C6, UnitType.I_C7, UnitType.I_C8, UnitType.I_C9,
] as const;

function buildingRawCost(type: string): number {
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === type);
  return prodItem?.rawCost ?? prodItem?.cost ?? 0;
}

function buildingSurvivorCount(s: MapStructure): number {
  if (s.isSurvivorless || !CREWED_BUILDINGS.has(s.type)) return 0;
  const isCaptured = s.originalHouse !== undefined && s.originalHouse !== s.house;
  let divisor = E1_COST;
  if (isCaptured) divisor *= 2;
  const survivorValue = Math.floor((buildingRawCost(s.type) * SURVIVOR_FRACTION_RAW + 128) / 256);
  const count = Math.floor(survivorValue / divisor);
  return Math.max(1, Math.min(5, count));
}

function buildingCrewType(ctx: CombatContext, s: MapStructure): UnitType | null {
  const isCaptured = s.originalHouse !== undefined && s.originalHouse !== s.house;
  switch (s.type) {
    case 'SILO':
      return ScenarioRandom.percentChance(50) ? UnitType.I_C1 : UnitType.I_C7;
    case 'FACT':
      if (!isCaptured && s.house === ctx.playerHouse && ScenarioRandom.percentChance(25)) {
        return UnitType.I_E6;
      }
      break;
    case 'KENN':
      return ScenarioRandom.percentChance(50) ? UnitType.I_DOG : null;
    case 'TENT':
    case 'BARR':
      return UnitType.I_E1;
    default:
      break;
  }

  if (!CREWED_BUILDINGS.has(s.type)) return null;
  if (s.house === House.Neutral || s.house === House.Turkey) {
    return CIVILIAN_CREW_TYPES[ScenarioRandom.nextInRange(0, CIVILIAN_CREW_TYPES.length - 1)];
  }
  if (!STRUCTURE_WEAPONS[s.type] && ScenarioRandom.percentChance(15)) {
    return ScenarioRandom.percentChance(50) ? UnitType.I_C1 : UnitType.I_C7;
  }
  return UnitType.I_E1;
}

function spawnDropDebrisSurvivor(ctx: CombatContext, s: MapStructure, cellCx: number, cellCy: number): void {
  const crewType = buildingCrewType(ctx, s);
  if (crewType == null) return;
  const inf = new Entity(
    crewType,
    s.house,
    cellCx * CELL_SIZE + CELL_SIZE / 2,
    cellCy * CELL_SIZE + CELL_SIZE / 2,
  );
  inf.logicIndexHint = ctx.logicIndexHintForNewObject?.();
  inf.scenarioInitUnlimbo = true;
  inf.mission = ctx.idleMission?.(inf) ?? Mission.GUARD;
  inf.missionTimer = 0;
  inf.missionQueue = null;
  if (crewType === UnitType.I_E1) {
    inf.isTechnician = true;
  }
  // C++ building.cpp:1701 — full infantry MaxStrength, not vehicle half-health.
  inf.hp = Math.min(inf.maxHp, ScenarioRandom.nextInRange(5, inf.maxHp));
  scatterVehicleCrew(ctx, inf);

  const source = s.whomToRepayEntityId !== undefined ? ctx.entityById.get(s.whomToRepayEntityId) : undefined;
  if (source && source.alive && !ctx.isAllied(s.house, source.house)) {
    assignEntityTarCom(inf, source);
    assignMission(inf, Mission.ATTACK);
  } else {
    assignMission(inf, s.house === ctx.playerHouse ? Mission.GUARD : Mission.HUNT);
  }

  ctx.entities.push(inf);
  ctx.entityById.set(inf.id, inf);
  ctx.markDiscoveredIfPlayerVisible?.(inf);
}

function runBuildingDropDebris(ctx: CombatContext, s: MapStructure): void {
  let count = buildingSurvivorCount(s);
  let odds = 2;
  const source = s.whomToRepayEntityId !== undefined ? ctx.entityById.get(s.whomToRepayEntityId) : undefined;
  if (source && source.alive) odds -= 1;
  if (s.originalHouse !== undefined && s.originalHouse !== s.house) odds += 6;

  for (const cell of getStructureOccupyCells(s.type, s.cx, s.cy)) {
    if (count > 0 && ScenarioRandom.nextInRange(0, odds) === 1) {
      const before = ctx.entities.length;
      spawnDropDebrisSurvivor(ctx, s, cell.cx, cell.cy);
      if (ctx.entities.length > before) count--;
    }

    if (!ctx.map.isTerrainPassable(cell.cx, cell.cy)) continue;

    switch (ScenarioRandom.nextInRange(0, 5)) {
      case 0:
      case 1:
      case 2: {
        if (reserveBuildingAnimSlot(ctx)) {
          // C++/WASM evaluates this AnimClass argument list right-to-left here:
          // loop, delay, then Coord_Scatter. The AnimClass allocation itself is
          // reserved first; if it fails, none of these constructor args run.
          const smokeLoop = ScenarioRandom.nextInRange(1, 2);
          const smokeDelay = ScenarioRandom.nextInRange(0, 5);
          const smokePos = coordScatterFromCell(cell.cx, cell.cy, 0x0050);
          submitBuildingSmokeEffect(ctx, smokePos.x, smokePos.y, smokeDelay, smokeLoop, true);
        }
        break;
      }
      default:
        break;
    }

    if (ScenarioRandom.percentChance(25)) {
      ScenarioRandom.nextInRange(1, 6);
      ctx.map.addDecal(cell.cx, cell.cy, 8, 0.4);
    } else {
      ScenarioRandom.nextInRange(1, 6);
      coordScatterFromCell(cell.cx, cell.cy, 0x0080);
      ctx.map.addDecal(cell.cx, cell.cy, 10, 0.5);
    }
  }
}

export function tickDestroyedStructureDebris(ctx: CombatContext, s: MapStructure): boolean {
  if (s.alive || s.debrisDropped || s.debrisCountdown === undefined) return false;

  if (s.debrisDropTick !== undefined) {
    const remaining = s.debrisDropTick - ctx.tick;
    if (remaining > 0) {
      s.debrisCountdown = remaining;
      return false;
    }
  } else if (s.debrisCountdown > 0) {
    s.debrisCountdown--;
    if (s.debrisCountdown > 0) return false;
  }
  // C++ BuildingClass::AI removes a zero-strength building by calling Limbo(),
  // and ObjectClass::Limbo calls Detach_All again at that removal point. Teams
  // can reacquire the dead building through Cell_Object during the CountDown
  // window, so the delayed detach is required in addition to the damage-time
  // detach.
  detachStructureFromTargeting(ctx, s);
  runBuildingDropDebris(ctx, s);
  s.debrisDropped = true;
  s.debrisCountdown = undefined;
  s.debrisDropTick = undefined;
  return true;
}

function structureThreatScanEntities(ctx: CombatContext): Entity[] {
  const airborneAircraft: Entity[] = [];
  const remaining: Entity[] = [];

  for (const entity of ctx.entities) {
    if (entity.stats.isAircraft && entityInTopLayer(entity)) {
      airborneAircraft.push(entity);
    } else {
      remaining.push(entity);
    }
  }

  // C++ TechnoClass::Greatest_Threat(THREAT_RANGE) scans airborne aircraft
  // through Aircraft.Count() before any cell/ring scan. Reinforcement Logic
  // order can be the reverse of the Aircraft pool order, so using ctx.entities
  // directly breaks equal-score target ties.
  airborneAircraft.sort((a, b) => a.id - b.id);
  return [...airborneAircraft, ...remaining];
}

const COMBAT_HOUSE_IDX: Record<string, number> = {
  [House.Spain]: 0, [House.Greece]: 1, [House.USSR]: 2,
  [House.England]: 3, [House.Ukraine]: 4, [House.Germany]: 5,
  [House.France]: 6, [House.Turkey]: 7,
  [House.GoodGuy]: 8, [House.BadGuy]: 9, [House.Neutral]: 10,
};

function structureThreatCellKey(cx: number, cy: number): number {
  return cy * MAP_CELLS + cx;
}

function entityLogicOrderKey(entity: Entity): number {
  return entity.logicIndexHint ?? entity.id;
}

function entityCellOccupierOrderKey(entity: Entity): number {
  return entity.cellOccupierSerial > 0
    ? entity.cellOccupierSerial
    : entityLogicOrderKey(entity);
}

function structureThreatCandidateVisible(ctx: CombatContext, e: Entity): boolean {
  // C++ techno.cpp:1551 skips the IsDiscoveredByPlayer visibility gate for
  // RTTI_AIRCRAFT candidates.
  if (e.isAirUnit) return true;
  if (e.house === ctx.playerHouse) return true;
  if (ctx.isDiscoveredByPlayer) return ctx.isDiscoveredByPlayer(e);
  const playerHouseIdx = COMBAT_HOUSE_IDX[ctx.playerHouse] ?? -1;
  if (playerHouseIdx >= 0 && ctx.isRevealedToHouse) {
    return ctx.isRevealedToHouse(e.cell.cx, e.cell.cy, playerHouseIdx);
  }
  return true;
}

function structureThreatScore(s: MapStructure, e: Entity): number {
  const centerCoord = structureCenterLeptons(s);
  const targetCoord = entityTargetLeptons(e);
  const scoreDistLeptons = leptonDist(centerCoord.lx, centerCoord.ly, targetCoord.lx, targetCoord.ly);
  const points = e.stats.points ?? e.stats.strength ?? 5;
  const value = Math.trunc(points * 2) + (e.kills ?? 0);
  return Math.max(Math.trunc((value * 32000) / (Math.floor(scoreDistLeptons / LEPTON_SIZE) + 1)), 1);
}

function entityOccupiesStructureThreatCell(e: Entity): boolean {
  if (e.inLimbo) return false;
  if (e.alive) return true;
  if (!e.stats.isInfantry) return false;
  if (e.type === UnitType.I_DOG) return false;
  return e.mission === Mission.DIE &&
    e.deathVariant >= 1 &&
    e.deathVariant <= 4 &&
    !e.isInfantryDeathAnimationComplete();
}

function structureThreatObjectIsAssignable(e: Entity): boolean {
  return e.alive && e.hp > 0 && !e.inLimbo;
}

function structureThreatObjectPassesEvaluate(
  ctx: CombatContext,
  s: MapStructure,
  e: Entity,
  fireCoord: { lx: number; ly: number },
  rangeLeptons: number,
): boolean {
  if (!s.weapon) return false;
  if (!entityOccupiesStructureThreatCell(e)) return false;
  if (!e.isAirUnit && entityInTopLayer(e)) return false;
  if (ctx.isAllied(s.house, e.house)) return false;
  if (MISSION_CONTROL[e.mission]?.isNoThreat) return false;
  if (e.cloakState === CloakState.CLOAKED) return false;
  // C++ techno.cpp:1579-1586 — spies are not legal auto-targets unless the
  // scanner is a dog. Buildings are never dogs.
  if (e.type === UnitType.I_SPY) return false;
  if (!structureThreatCandidateVisible(ctx, e)) return false;

  // Preserve the existing SAM/AGUN behavior: structure AA weapons in this
  // engine are air-only. Ground-capable building weapons use the cell ring scan.
  if (s.weapon.isAntiAir && (!e.isAirUnit || e.flightAltitude <= 0)) return false;
  if (e.isAirUnit && e.flightAltitude > 0 && !s.weapon.isAntiAir) return false;

  // C++ THREAT_RANGE passes range=0 into Evaluate_Object, which calls the
  // Object* In_Range overload: Fire_Coord(primary) to target Center_Coord().
  return leptonDist(fireCoord.lx, fireCoord.ly, e.leptonX, e.leptonY) <= rangeLeptons;
}

function structureThreatAirTarget(ctx: CombatContext, s: MapStructure): Entity | null {
  if (!s.weapon?.isAntiAir) return null;
  const fireCoord = structureFireLeptons(s);
  const rangeLeptons = Math.trunc(s.weapon.range * LEPTON_SIZE);
  let bestTarget: Entity | null = null;
  let bestScore = -Infinity;

  for (const e of structureThreatScanEntities(ctx)) {
    if (!e.isAirUnit || e.flightAltitude <= 0) continue;
    if (!structureThreatObjectPassesEvaluate(ctx, s, e, fireCoord, rangeLeptons)) continue;
    if (!structureThreatObjectIsAssignable(e)) continue;
    const score = structureThreatScore(s, e);
    if (score > bestScore) {
      bestTarget = e;
      bestScore = score;
    }
  }

  return bestTarget;
}

/** C++ BuildingClass::Greatest_Threat path used by weapon-equipped Mission_Guard.
 *  This is intentionally pure and RNG-free: C++ techno.cpp:2047-2210 scans
 *  nearby objects without consuming RNG.
 */
export function findStructureThreatTarget(ctx: CombatContext, s: MapStructure): Entity | null {
  if (!s.alive || !s.weapon || s.sellProgress !== undefined ||
      isStructureUnderConstruction(s)) return null;

  // Current structure AA weapons are air-only in TS; keep their existing
  // aircraft-pool scoring path. Ground-capable buildings use C++'s cell scan.
  if (s.weapon.isAntiAir) return structureThreatAirTarget(ctx, s);

  const range = s.weapon.range;
  const rangeLeptons = Math.trunc(range * LEPTON_SIZE);
  const fireCoord = structureFireLeptons(s);
  const scanCellX = Math.floor(fireCoord.lx / LEPTON_SIZE);
  const scanCellY = Math.floor(fireCoord.ly / LEPTON_SIZE);
  const crange = Math.floor(range) + 1;
  if (crange <= 0) return null;

  // C++ Evaluate_Cell walks Cell_Occupier() and stops at the first non-allied
  // techno in the LIFO chain. If that object then fails Evaluate_Object, C++
  // does not look behind it in the same cell. Build exactly that per-cell head.
  const cellHead = new Map<number, Entity>();
  for (const e of ctx.entities) {
    if (!entityOccupiesStructureThreatCell(e)) continue;
    if (!e.isAirUnit && entityInTopLayer(e)) continue;
    if (e.isAirUnit && e.flightAltitude > 0) continue;
    if (ctx.isAllied(s.house, e.house)) continue;
    const key = structureThreatCellKey(e.cell.cx, e.cell.cy);
    const current = cellHead.get(key);
    if (!current || entityCellOccupierOrderKey(e) > entityCellOccupierOrderKey(current)) {
      cellHead.set(key, e);
    }
  }

  const mapX = ctx.map.boundsX;
  const mapY = ctx.map.boundsY;
  const mapW = ctx.map.boundsW;
  const mapH = ctx.map.boundsH;
  let bestTarget: Entity | null = null;

  const scanCell = (cx: number, cy: number): void => {
    const candidate = cellHead.get(structureThreatCellKey(cx, cy));
    if (!candidate) return;
    if (structureThreatObjectPassesEvaluate(ctx, s, candidate, fireCoord, rangeLeptons)) {
      // C++ cell-scan bug: bestval is initialized before the ring scan but is
      // never updated when a cell candidate wins, so every later valid
      // positive-valued cell target overwrites the previous one until an early
      // bailout radius is reached.
      bestTarget = candidate;
    }
  };

  for (let radius = 0; radius < crange; radius++) {
    for (let x = -radius; x <= radius; x++) {
      const cx = scanCellX + x;
      if (cx < mapX || cx >= mapX + mapW) continue;

      const topY = scanCellY - radius;
      if (topY >= mapY && topY < mapY + mapH) scanCell(cx, topY);

      const bottomY = scanCellY + radius;
      if (bottomY >= mapY && bottomY < mapY + mapH) scanCell(cx, bottomY);
    }

    for (let y = -(radius - 1); y < radius; y++) {
      const cy = scanCellY + y;
      if (cy < mapY || cy >= mapY + mapH) continue;

      const leftX = scanCellX - radius;
      if (leftX >= mapX && leftX < mapX + mapW) scanCell(leftX, cy);

      const rightX = scanCellX + radius;
      if (rightX >= mapX && rightX < mapX + mapW) scanCell(rightX, cy);
    }

    if (bestTarget) {
      const quarter = Math.floor(crange / 4);
      const half = Math.floor(crange / 2);
      if (radius === quarter || radius === half) {
        return structureThreatObjectIsAssignable(bestTarget) ? bestTarget : null;
      }
    }
  }

  return bestTarget && structureThreatObjectIsAssignable(bestTarget) ? bestTarget : null;
}

function getAssignedStructureTarget(ctx: CombatContext, s: MapStructure): Entity | null {
  if (s.targetEntityId === undefined) return null;
  const target = ctx.entityById.get(s.targetEntityId);
  return target && target.alive && !target.inLimbo ? target : null;
}

function structureWeaponCanTarget(s: MapStructure, target: Entity): boolean {
  if (!s.weapon) return false;
  if (s.weapon.isAntiAir && (!target.isAirUnit || target.flightAltitude <= 0)) return false;
  if (target.isAirUnit && target.flightAltitude > 0 && !s.weapon.isAntiAir) return false;
  return true;
}

function structureTargetInTarcomRange(s: MapStructure, target: Entity): boolean {
  if (!s.weapon) return false;
  const fire = structureFireLeptons(s, target);
  const targetCoord = entityTargetLeptons(target);
  return leptonDist(fire.lx, fire.ly, targetCoord.lx, targetCoord.ly) <= Math.trunc(s.weapon.range * LEPTON_SIZE);
}

function clearStructureAttackTargetAfterCanFireFailure(s: MapStructure): void {
  s.targetEntityId = undefined;
  s.mission = Mission.GUARD;
  s.missionTimer = Math.max(s.missionTimer ?? 0, 1);
  // C++ BuildingClass::Mission_Attack falls through after FIRE_RANGE/CANT:
  // Assign_Target(TARGET_NONE), Assign_Mission(GUARD), then
  // PrimaryFacing.Set_Desired(Direction(TarCom)). With TarCom now NONE,
  // Direction resolves toward coordinate 0,0.
  setStructureTurretDesiredToTargetNone(s);
}

/** Per-building combat tick — extracted so it can be called per-building right after its
 *  mission timer tick, matching C++ BuildingClass::AI() which runs timer + Firing_AI
 *  sequentially for each building before advancing to the next.
 *  C++ building.cpp:Firing_AI + building.cpp:5347 Rotation_AI */
export function updateSingleStructureCombat(ctx: CombatContext, s: MapStructure, isLowPower: boolean): void {
    if (!s.alive || !s.weapon || s.sellProgress !== undefined ||
        isStructureUnderConstruction(s)) return;
    // C++ building.cpp:882-883 — ammo instantly reloads to MaxAmmo each AI tick
    if (s.ammo === 0 && s.maxAmmo > 0) { s.ammo = s.maxAmmo; }
    if (s.ammo === 0) return; // out of ammo (shouldn't reach here after reload)

    // Initialize turret facings before Mission_Attack logic. The actual
    // Rotation_AI tick runs after the mission decision in BuildingClass::AI();
    // callers invoke tickStructureTurretRotation() after this function.
    if (TURRETED_STRUCTURES.has(s.type)) {
      if (s.turretDir === undefined) s.turretDir = TURRET_DEFAULT_FACING[s.type] ?? 4; // C++ bdata.cpp per-building default
      syncStructureTurretFacingFields(s);
    }

    if (s.attackCooldown > 0) {
      // C++ BuildingClass::Mission_Attack returns Arm for FIRE_REARM.
      // Keep the mission dispatcher asleep for the same remaining arm delay;
      // otherwise a target detached during rearm can force ATTACK->GUARD one
      // frame before C++ re-enters Mission_Attack.
      s.missionTimer = Math.max(s.missionTimer ?? 0, s.attackCooldown);
      if (s.rearmFacingUpdatePending) {
        const rearmTarget = getAssignedStructureTarget(ctx, s);
        if (rearmTarget && TURRETED_STRUCTURES.has(s.type)) {
          setStructureTurretDesired(s, rearmTarget);
        }
        s.rearmFacingUpdatePending = false;
      }
      return;
    }

    const { x: sx, y: sy } = structureFirePixels(s);
    const assignedTarget = getAssignedStructureTarget(ctx, s);
    if (s.targetEntityId !== undefined && !assignedTarget) {
      s.targetEntityId = undefined;
      s.mission = Mission.GUARD;
      s.missionTimer = Math.max(s.missionTimer ?? 0, 1);
      return;
    }
    if (assignedTarget &&
        (!structureWeaponCanTarget(s, assignedTarget) || !structureTargetInTarcomRange(s, assignedTarget))) {
      clearStructureAttackTargetAfterCanFireFailure(s);
      return;
    }
    const bestTarget = assignedTarget ?? findStructureThreatTarget(ctx, s);

    if (bestTarget) {
      const bestTargetPixels = entityTargetPixels(bestTarget);
      // Update turret direction for turreted structures
      if (TURRETED_STRUCTURES.has(s.type)) {
        setStructureTurretDesired(s, bestTarget);
        // C++ Mission_Attack returns FIRE_FACING when turret is not aligned with target,
        // delaying fire until the 256-step facing is inside the firing cone
        // (building.cpp:2312-2318). TS stores only 8-way buckets, so allow the
        // adjacent bucket once accumulator progress indicates the true C++
        // facing has moved into tolerance.
        if (!structureTurretCanFire(s)) {
          // C++ BuildingClass::Mission_Attack returns 2 on FIRE_FACING. The
          // building mission timer, not the weapon arm timer, absorbs that
          // one-frame retry delay while Rotation_AI continues to turn.
          s.missionTimer = Math.max(s.missionTimer ?? 0, 2);
          return;
        }
      }
      // C++ BuildingClass::Can_Fire checks powered low-power FIRE_BUSY after
      // TechnoClass::Can_Fire has already validated target legality/range and
      // after the turret-facing gate. Low power blocks the shot, but it must
      // not preserve an illegal or out-of-range TarCom.
      if (isLowPower && STRUCTURE_POWERED.has(s.type)) {
        s.missionTimer = Math.max(s.missionTimer ?? 0, 1);
        return;
      }
      // H1: Buildings with Ammo>1 fire rapidly (1-tick rearm) then recharge (C++ techno.cpp:2861)
      // C++ house.cpp:293,303: ROFBias scales rearm delay
      const structRofBias = ctx.getROFBias(s.house);
      const isTwoShooter = !!s.weapon.secondaryWeaponName && s.weapon.secondaryWeaponName === s.weapon.weaponName;
      if (isTwoShooter) {
        // C++ TechnoClass::Rearm_Delay(second, which): true two-shooters
        // (Primary == Secondary) get a quick 3-frame first rearm, then full
        // weapon ROF after the second shot. Store the assigned Arm value here;
        // decrementStructureCdTimersEndOfLogic models the post-frame CDTimer
        // countdown independently of mission dispatch.
        const second = s.isSecondShot ?? false;
        const delay = second
          ? Math.max(1, Math.round(s.weapon.rof * structRofBias))
          : 3;
        s.attackCooldown = delay;
        s.isSecondShot = !second;
      } else if (s.ammo > 0) {
        s.ammo--;
        s.attackCooldown = s.ammo > 0 ? 1 : Math.max(1, Math.round(s.weapon.rof * structRofBias)); // rapid-fire until last shot
      } else {
        s.attackCooldown = Math.max(1, Math.round(s.weapon.rof * structRofBias)); // unlimited ammo (-1) uses normal ROF
      }
      if (TURRETED_STRUCTURES.has(s.type)) s.firingFlash = 4;
      s.rearmFacingUpdatePending = true;
      // C++ bullet.cpp:991 — Explosion_Damage is the SOLE damage path for splash weapons.
      const wh = (s.weapon.warhead ?? 'HE') as WarheadType;
      const houseBias = ctx.getFirepowerBias(s.house);
      const launchedStructureProjectile =
        s.weapon.projSpeed !== undefined ||
        !!s.weapon.isInvisible ||
        s.type === 'QUEE';
      let killed: boolean;

      if (launchedStructureProjectile) {
        launchStructureProjectile(ctx, s, bestTarget, s.weapon);
        killed = false;
      } else if (s.weapon.splash && s.weapon.splash > 0) {
        // Splash weapons: ALL damage through applySplashDamage (matches C++ Explosion_Damage)
        const hpBefore = bestTarget.hp;
        applySplashDamage(
          ctx, bestTargetPixels,
          { damage: s.weapon.damage, warhead: wh, splash: s.weapon.splash },
          -1, s.house, undefined, s,
        );
        killed = !bestTarget.alive || bestTarget.hp <= 0;
      } else {
        // Non-splash weapons: direct hit only
        const whMult = getWarheadMult(wh, bestTarget.stats.armor, ctx.warheadOverrides);
        const damage = modifyDamage(s.weapon.damage, wh, bestTarget.stats.armor, 0, houseBias, whMult, getWarheadMeta(wh, ctx.scenarioWarheadMeta).spreadFactor);
        killed = damageEntity(ctx, bestTarget, damage, wh, undefined, {
          sourceStructure: s,
        });
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
          type: 'tesla', x: bestTargetPixels.x, y: bestTargetPixels.y,
          frame: 0, maxFrames: 8, size: 12, sprite: 'piffpiff', spriteStart: 0,
          startX: sx, startY: sy, endX: bestTargetPixels.x, endY: bestTargetPixels.y,
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
        const structDistPx = Math.sqrt((bestTargetPixels.x - sx) ** 2 + (bestTargetPixels.y - sy) ** 2);
        const structTravelFrames = calcProjectileTravelFrames(structDistPx, s.weapon.projSpeed);
        const structWeaponName = s.weapon.weaponName ?? '';
        const structProjCfg = projectileVisualConfig(structWeaponName);
        // Pick projStyle by weapon family so procedural fallback still looks right.
        let structProjStyle: 'bullet' | 'fireball' | 'shell' | 'rocket' | 'grenade' = 'bullet';
        switch (structWeaponName) {
          case 'FireballLauncher': structProjStyle = 'fireball'; break;
          case 'TurretGun': structProjStyle = 'shell'; break;
          case 'Nike': structProjStyle = 'rocket'; break;
        }
        if (!launchedStructureProjectile) {
          ctx.effects.push({
            type: 'projectile', x: sx, y: sy, frame: 0, maxFrames: structTravelFrames, size: 3,
            startX: sx, startY: sy, endX: bestTargetPixels.x, endY: bestTargetPixels.y,
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
            : combatAnim(s.weapon.damage, structExpSet, structLand);
          if (aaImpactSprite) {
            ctx.effects.push({
              type: 'explosion', x: bestTargetPixels.x, y: bestTargetPixels.y,
              frame: 0, maxFrames: 10, size: 6,
              sprite: aaImpactSprite, spriteStart: 0,
            } as Effect);
            spawnLogicAnimForSprite(
              ctx.logicAnims,
              ctx.effects,
              aaImpactSprite,
              bestTargetPixels.x,
              bestTargetPixels.y,
              false,
              ctx.logicAnimsAlreadyProcessed === true,
              ctx.logicIndexHintForNewObject?.(),
              ctx.logicIndexHintForNewObject,
              ctx.reserveAnimSlot,
            );
          }
          // D5: Structure fire weapons (FTUR FireballLauncher) plant scorch marks at impact
          if (structLand === 'ground' && wh === 'Fire') {
            const impCell = worldToCell(bestTargetPixels.x, bestTargetPixels.y);
            ctx.map.addDecal(impCell.cx, impCell.cy, 7, 0.3);
          }
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

export function decrementStructureCdTimersEndOfLogic(s: MapStructure): void {
  // C++ structure mission timers and TechnoClass::Arm are
  // CDTimerClass<FrameTimerClass> values. MissionClass::AI sees the current
  // frame's Value(); the countdown advances only after the building has had its
  // AI pass for that frame.
  if ((s.missionTimer ?? 0) > 0) s.missionTimer--;
  if (s.attackCooldown > 0) s.attackCooldown--;
}

/** Structure auto-fire — pillboxes, guard towers, tesla coils, SAM/AGUN fire at nearby enemies.
 *  Bulk wrapper that calls updateSingleStructureCombat for each structure.
 *  NOTE: For C++ parity, prefer calling updateSingleStructureCombat per-building
 *  interleaved with timer ticks (see tickStructuresInterleaved in index.ts). */
export function updateStructureCombat(ctx: CombatContext): void {
  const isLowPower = ctx.powerConsumed > ctx.powerProduced;
  for (const s of ctx.structures) {
    updateSingleStructureCombat(ctx, s, isLowPower);
    tickStructureTurretRotation(s, isLowPower);
    decrementStructureCdTimersEndOfLogic(s);
  }
}
