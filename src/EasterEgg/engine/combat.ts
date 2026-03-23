/**
 * Combat subsystem — damage calculation, projectiles, splash, and unit death.
 * Extracted from Game class (index.ts) to isolate combat logic.
 */

import {
  type WorldPos, type WeaponStats, type ArmorType, type WarheadType,
  type WarheadMeta, type WarheadProps,
  CELL_SIZE, MAP_CELLS, CONDITION_YELLOW, RULE_GRAVITY,
  WARHEAD_VS_ARMOR, WARHEAD_PROPS, WARHEAD_META, WEAPON_STATS,
  armorIndex, worldDist, worldToCell, modifyDamage,
  directionTo, calcProjectileTravelFrames,
  House, Mission, AnimState, UnitType, EXPLOSION_FRAMES,
  DIR_DX, DIR_DY, DIR_COUNT, MISSION_CONTROL,
  HOUSE_FACTION,
} from './types';
import { Entity, CloakState, CLOAK_TRANSITION_FRAMES } from './entity';
import { type MapStructure, STRUCTURE_SIZE, STRUCTURE_POWERED, STRUCTURE_WEAPONS, STRUCTURE_ARMOR, CREWED_BUILDINGS } from './scenario';
import { PRODUCTION_ITEMS } from './types';
import { type Effect } from './renderer';
import { type GameMap, type MapTree, Terrain, TREE_CENTER_OFFSET } from './map';
import { canTargetNaval } from './aircraft';
import { AI_BUILD_RULES } from './ai';

// ── Constants ──────────────────────────────────────────────────────────────────

/** CF3: Universal 1.5-cell splash radius (C++ Explosion_Damage uses ICON_LEPTON_W + ICON_LEPTON_W/2) */
export const SPLASH_RADIUS = 1.5;

const WALL_TYPES = new Set(['SBAG', 'FENC', 'BARB', 'BRIK', 'WOOD', 'CYCL']);

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
  getFirepowerBias(house: House): number;
  /** C++ house.cpp:292,302: ArmorBias — difficulty-scaled damage resistance */
  getArmorBias(house: House): number;
  /** C++ house.cpp:293,303: ROFBias — difficulty-scaled rate-of-fire */
  getROFBias(house: House): number;
  damageStructure(s: MapStructure, damage: number): boolean;
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
// Damage-scaled index formula: floor((arrayLen - 1) * min(damage, maxDamage) / maxDamage)

/** C++ Combat_Anim animation arrays, indexed by damage-scaled fraction */
const FIRE_LIST  = ['napalm1', 'napalm2', 'napalm3'];               // ExplosionSet=3, max 150
const AP_LIST    = ['veh-hit3', 'veh-hit2', 'frag1', 'fball1'];     // ExplosionSet=4, max 90
const HE_LIST    = ['veh-hit1', 'veh-hit2', 'art-exp1', 'fball1'];  // ExplosionSet=5, max 130
const WATER_LIST = ['water-exp3', 'water-exp2', 'water-exp1'];      // Water override for sets 3-5

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
      return list[Math.floor((list.length - 1) * Math.min(damage, maxDmg) / maxDmg)];
    }

    case 5: {  // HE pops
      if (land === 'air') return 'flak';
      const maxDmg = 130;
      const list = land === 'water' ? WATER_LIST : HE_LIST;
      return list[Math.floor((list.length - 1) * Math.min(damage, maxDmg) / maxDmg)];
    }

    case 3: {  // Fire
      if (land === 'air') return 'flak';
      const maxDmg = 150;
      const list = land === 'water' ? WATER_LIST : FIRE_LIST;
      return list[Math.floor((list.length - 1) * Math.min(damage, maxDmg) / maxDmg)];
    }

    case 1: return 'piff';  // HollowPoint — always piff

    default: return null;  // Set 0 (Super/Organic/Mechanical) — no explosion
  }
}

/** Damage-based speed reduction (C++ drive.cpp:1157-1161).
 *  Single tier: <=50% HP = 75% speed (ConditionYellow). */
export function damageSpeedFactor(entity: Entity): number {
  const ratio = entity.hp / entity.maxHp;
  if (ratio <= CONDITION_YELLOW) return 0.75;
  return 1.0;
}

// ── Internal Helpers (not exported) ────────────────────────────────────────────

/** Infantry scatter: push infantry slightly away from attacker on direct hit.
 *  In original RA, infantry move randomly when shot at. */
function scatterInfantry(ctx: CombatContext, victim: Entity, attackerPos: WorldPos): void {
  if (!victim.alive || !victim.stats.isInfantry || victim.isAnt) return;
  if (Math.random() > 0.4) return; // 40% chance to scatter per hit
  const angle = Math.atan2(victim.pos.y - attackerPos.y, victim.pos.x - attackerPos.x);
  const jitter = (Math.random() - 0.5) * 1.2; // add randomness to scatter direction
  const scatterX = victim.pos.x + Math.cos(angle + jitter) * CELL_SIZE * 0.5;
  const scatterY = victim.pos.y + Math.sin(angle + jitter) * CELL_SIZE * 0.5;
  const sc = worldToCell(scatterX, scatterY);
  if (ctx.map.isPassable(sc.cx, sc.cy)) {
    victim.pos.x = scatterX;
    victim.pos.y = scatterY;
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
 *  C++ house.cpp:292,302: ArmorBias — difficulty-scaled damage resistance applied here. */
export function damageEntity(
  ctx: CombatContext, target: Entity, amount: number,
  warhead: WarheadType, attacker?: Entity,
): boolean {
  // C++ parity: apply house-level armor bias from difficulty (house.cpp:292,302)
  // ArmorBias > 1 = tougher (less damage), < 1 = weaker (more damage)
  const houseArmorBias = ctx.getArmorBias(target.house);
  if (houseArmorBias !== 1.0 && amount > 0) {
    amount = Math.max(1, Math.round(amount / houseArmorBias));
  }
  const whProps = getWarheadProps(warhead, ctx.scenarioWarheadProps);
  const killed = target.takeDamage(amount, warhead, attacker, whProps);
  if (target.triggerName) ctx.attackedTriggerNames.add(target.triggerName);
  if (!killed && target.alive) aiScatterOnDamage(ctx, target, attacker);
  return killed;
}

/**
 * AI scatter — infantry scatter per C++ infantry.cpp:1852-1929 (InfantryClass::Scatter).
 *
 * Key C++ behaviors:
 *  - Called with forced=true from TakeDamage (C++ techno.cpp)
 *  - IsDriving (already moving) → forced=false (line 1860)
 *  - MissionControl[mission].isScatter must be true OR forced (line 1866)
 *  - If not IsFraidyCat AND has valid combat target AND not forced → skip (line 1872)
 *  - Must be forced OR IsFraidyCat to actually execute scatter (line 1885)
 *  - Calculate direction AWAY from threat with random +-2 facing offset
 *  - Try 8 directions starting from away-direction, pick first passable cell
 *  - Only infantry scatters directionally (non-infantry uses old random scatter)
 */
export function aiScatterOnDamage(ctx: CombatContext, entity: Entity, attacker?: Entity): void {
  // Player units don't AI-scatter (C++ infantry.cpp:1883 — human house check)
  if (entity.isPlayerUnit) return;

  // AI IQ gate (C++ techno.cpp scatter requires IQ >= [IQ] Scatter=3)
  if (ctx.aiIQ(entity.house) < 3) return;

  // Only infantry uses directional scatter (C++ infantry.cpp override)
  if (!entity.stats.isInfantry) {
    // Non-infantry: old random scatter for guard/area_guard missions only
    if (entity.mission !== Mission.GUARD && entity.mission !== Mission.AREA_GUARD) return;
    const dx = Math.floor(Math.random() * 3) - 1;
    const dy = Math.floor(Math.random() * 3) - 1;
    if (dx === 0 && dy === 0) return;
    const targetX = entity.pos.x + dx * CELL_SIZE;
    const targetY = entity.pos.y + dy * CELL_SIZE;
    const tcx = Math.floor(targetX / CELL_SIZE);
    const tcy = Math.floor(targetY / CELL_SIZE);
    if (!ctx.map.isPassable(tcx, tcy)) return;
    entity.moveTarget = { x: targetX, y: targetY };
    entity.mission = Mission.MOVE;
    return;
  }

  // ── Infantry directional scatter (C++ infantry.cpp:1852-1929) ──
  // C++ TakeDamage (infantry.cpp:439) calls Scatter(source_coord) with forced=false.

  // C++ infantry.cpp:1860 — IsDriving: already moving → forced stays false
  const isDriving = entity.moveTarget !== null;

  // C++ infantry.cpp:1866 — mission must allow scatter (MissionControl[Mission].IsScatter)
  const mc = MISSION_CONTROL[entity.mission];
  if (mc && !mc.isScatter) return;

  // C++ infantry.cpp:1872 — non-FraidyCat with valid combat target doesn't scatter
  if (!entity.stats.isFraidyCat && entity.target !== null) return;

  // C++ infantry.cpp:1885 — IsDriving non-FraidyCat infantry doesn't scatter
  // (IsDriving → forced=false; without forced, only FraidyCat scatters per C++)
  if (isDriving && !entity.stats.isFraidyCat) return;

  // Calculate scatter direction (C++ infantry.cpp:1888-1900)
  let awayDir: number;
  if (attacker) {
    // C++ infantry.cpp:1889 — Dir_Facing(Direction8(threat, Coord))
    // Direction from threat to infantry = away from threat
    awayDir = directionTo(attacker.pos, entity.pos);
  } else {
    // No threat source — use entity's current facing (C++ infantry.cpp:1897)
    awayDir = entity.facing;
  }

  // C++ infantry.cpp:1890 — Random_Pick(0,4)-2 → random +-2 facing offset
  const offset = Math.floor(Math.random() * 5) - 2; // -2, -1, 0, 1, or 2
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
    entity.moveTarget = {
      x: bestCell.cx * CELL_SIZE + CELL_SIZE / 2,
      y: bestCell.cy * CELL_SIZE + CELL_SIZE / 2,
    };
    entity.mission = Mission.MOVE;
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
  const destroyed = structureDamage(ctx, s, damage);
  if (destroyed) attacker.creditKill();
  ctx.effects.push({
    type: 'muzzle',
    x: attacker.pos.x, y: attacker.pos.y - attacker.flightAltitude,
    frame: 0, maxFrames: 4, size: 4, sprite: 'piff', spriteStart: 0,
  } as Effect);
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
  else if (victim.stats.isInfantry) ctx.playSoundAt('die_infantry', kx, ky);
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

  // Per-side casualty tracking for score screen bar graphs (C++ score.cpp:548-560)
  const faction = HOUSE_FACTION[victim.house] ?? 'allied';
  if (faction === 'soviet') {
    ctx.sovietUnitsLost++;
  } else if (faction !== 'both') {
    ctx.alliedUnitsLost++;
  }

  // C++ techno.cpp:3820-3834 — Explodes=yes death explosion (Wide_Area_Damage)
  // When a unit with Explodes=yes is destroyed, it deals area damage:
  //   damage  = MaxStrength (victim's full HP)
  //   warhead = primary weapon's warhead (default HE if no weapon)
  //   radius  = damage * Rule.ExplosionSpread (ExpSpread=.3 from rules.ini)
  //   radius is in leptons (1 cell = 256 leptons), so 110*0.3=33 leptons ≈ 0.13 cells
  if (victim.stats.explodesOnDeath) {
    const EXP_SPREAD = 0.3; // rules.ini [General] ExpSpread=.3
    const LEPTONS_PER_CELL = 256; // C++ ICON_LEPTON_W = 256
    const explosionDamage = victim.stats.strength; // C++ techno.cpp:3830: MaxStrength
    const primaryWeaponName = victim.stats.primaryWeapon;
    const explosionWarhead: WarheadType = primaryWeaponName
      ? ((WEAPON_STATS as Record<string, { warhead?: string }>)[primaryWeaponName]?.warhead ?? 'HE')
      : 'HE'; // C++ techno.cpp:3825: default WARHEAD_HE
    const radiusLeptons = explosionDamage * EXP_SPREAD; // C++ techno.cpp:3832
    const radiusCells = radiusLeptons / LEPTONS_PER_CELL;

    for (const other of ctx.entities) {
      if (!other.alive || other.inLimbo || other.id === victim.id) continue;
      const dist = worldDist(victim.pos, other.pos);
      if (dist > radiusCells) continue;
      // C++ Wide_Area_Damage has no alliance check — damages everyone
      damageEntity(ctx, other, explosionDamage, explosionWarhead);
    }
  }
}

/** Trigger retaliation: a damaged unit without a target attacks the shooter.
 *  In original RA, idle/moving units always counter-attack when hit. */
export function triggerRetaliation(ctx: CombatContext, victim: Entity, attacker: Entity): void {
  if (!victim.alive || !attacker.alive) return;
  // C++ rules.ini PlayerReturnFire=no (Rule.IsSmartDefense=false) — player units do NOT auto-retaliate
  // C++ techno.cpp:4976 exception: Tanya retaliates against infantry even without SmartDefense
  if (ctx.isPlayerControlled?.(victim)) {
    const isTanyaVsInfantry = victim.type === UnitType.I_TANYA && attacker.stats.isInfantry;
    if (!isTanyaVsInfantry) return;
  }
  if (ctx.entitiesAllied(victim, attacker)) return; // no friendly retaliation
  if (!victim.weapon) return; // unarmed units can't retaliate
  // Only retarget if no current target or current target is dead
  if (victim.target && victim.target.alive) return;
  // Don't interrupt scripted team missions (except HUNT which already attacks)
  if (victim.teamMissions.length > 0 && victim.mission !== Mission.HUNT) return;
  // AA gate: ground units can't retaliate against airborne aircraft without AA weapons
  if (attacker.isAirUnit && attacker.flightAltitude > 0) {
    const hasAA = victim.weapon?.isAntiAir || victim.weapon2?.isAntiAir;
    if (!hasAA) return;
  }
  // Naval gate: can't retaliate against untargetable naval units
  if (!canTargetNaval(victim, attacker)) return;
  victim.target = attacker;
  victim.mission = Mission.ATTACK;
  victim.animState = AnimState.ATTACK;
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
): void {
  const dist = worldDist(attacker.pos, { x: impactX, y: impactY });
  const speed = weapon.projectileSpeed!;
  const travelFrames = Math.max(1, Math.round(dist / speed));

  // C++ bullet.cpp:783-789 — ballistic arc initialization for isArcing weapons
  // Riser = ((Distance/2) / (speed+1)) * Rule.Gravity, min 10
  // This gives enough upward velocity to keep the projectile airborne for ~travelFrames ticks.
  const isArcing = !!weapon.isArcing;
  let arcHeight = 0;
  let arcRiser = 0;
  if (isArcing) {
    arcHeight = 1; // C++ bullet.cpp:786 — Height = 1
    // C++ formula: Riser = ((Distance(tcoord)/2) / (speed+1)) * Rule.Gravity
    // In our units, travelFrames ≈ Distance/speed, so Riser ≈ (travelFrames/2) * Gravity
    arcRiser = Math.max(10, Math.floor(travelFrames / 2) * RULE_GRAVITY);
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
    startX: attacker.pos.x,
    startY: attacker.pos.y,
    dogRiderId,
    // C++ fuse.cpp — IsFueled: fuel timer = range = (distance/speed) + 4, capped at 0xFF
    // When timer reaches 0 after arming delay, bullet force-explodes (runs out of fuel)
    fuelTimer: Math.min(0xFF, travelFrames + 4),
    isFueled: !!weapon.isFueled,
    // C++ bullet.cpp:790-802 — IsDropping: start at FLIGHT_LEVEL, fall with gravity
    isDropping: !!weapon.isDropping,
    dropHeight: weapon.isDropping ? 24 : 0,  // C++ FLIGHT_LEVEL = 24 pixels
    // C++ bullet.cpp:377-386 — IsFlameEquipped: flame trail toggle
    isFlameEquipped: !!weapon.isFlameEquipped,
    flameToggle: false,  // C++ IsToAnimate starts false
  });
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
      const curX = proj.startX + (proj.impactX - proj.startX) * Math.min(t, 1);
      const curY = proj.startY + (proj.impactY - proj.startY) * Math.min(t, 1);
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
      const curX = proj.startX + (proj.impactX - proj.startX) * Math.min(t, 1);
      const curY = proj.startY + (proj.impactY - proj.startY) * Math.min(t, 1);
      const cc = worldToCell(curX, curY);
      if (ctx.map.getTerrain(cc.cx, cc.cy) !== Terrain.WATER) {
        // Force-explode at cell center when torpedo leaves water (C++ coord = Cell_Coord(Coord_Cell(coord)))
        proj.impactX = cc.cx * CELL_SIZE + CELL_SIZE / 2;
        proj.impactY = cc.cy * CELL_SIZE + CELL_SIZE / 2;
        proj.travelFrames = proj.currentFrame; // land now
        arrived.push(proj);
        continue;
      }
    }

    // C++ bullet.cpp:946-948 — AA proximity detonation (Is_Forced_To_Explode)
    // Anti-air projectiles detonate when within half a cell (~0x0080 leptons) of an airborne target.
    if (proj.weapon.isAntiAir && target && target.alive && target.isAirUnit && target.flightAltitude > 0) {
      const t = proj.currentFrame / Math.max(1, proj.travelFrames);
      const curX = proj.startX + (proj.impactX - proj.startX) * Math.min(t, 1);
      const curY = proj.startY + (proj.impactY - proj.startY) * Math.min(t, 1);
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

    // Landing check: arcing projectiles land when height <= 0 (C++ object.cpp:241);
    // non-arcing projectiles land when travel frames are exhausted.
    const hasLanded = proj.isArcing
      ? (proj.arcHeight <= 0 && proj.currentFrame > 1)  // skip frame 1 since Height starts at 1
      : (proj.currentFrame >= proj.travelFrames);
    if (hasLanded) {
      arrived.push(proj);
    }
  }

  // Remove arrived projectiles
  ctx.inflightProjectiles = ctx.inflightProjectiles.filter(p => {
    // Dropping projectiles are removed when height reaches 0
    if (p.isDropping) return p.dropHeight > 0 || p.currentFrame === 0;
    // Fueled projectiles are removed when fuel runs out
    if (p.isFueled && p.fuelTimer <= 0) return false;
    if (p.isArcing) return p.arcHeight > 0 || p.currentFrame <= 1;
    return p.currentFrame < p.travelFrames;
  });

  // Apply damage for arrived projectiles
  for (const proj of arrived) {
    const target = ctx.entityById.get(proj.targetId);
    const attacker = ctx.entityById.get(proj.attackerId);

    // C++ bullet.cpp:478-480 — use degraded strength (proj.strength) instead of original damage
    const impactDamage = proj.strength;

    // C++ bullet.cpp:991 — Bullet_Explodes calls Explosion_Damage as the SOLE damage path.
    // There is NO separate direct-hit damage call in C++. All damage flows through Explosion_Damage,
    // which iterates all objects in the cell and adjacent cells, applying distance-based damage.
    // The direct-hit target is at distance ~0, so it gets full damage from the splash calculation.
    if (proj.weapon.splash && proj.weapon.splash > 0) {
      // Splash weapons: ALL damage through applySplashDamage (matches C++ Explosion_Damage)
      const attackerHouse = attacker?.house ?? (proj.attackerIsPlayer ? ctx.playerHouse : House.USSR);
      applySplashDamage(
        ctx, { x: proj.impactX, y: proj.impactY },
        { damage: impactDamage, warhead: proj.weapon.warhead, splash: proj.weapon.splash },
        -1,  // No entity excluded from splash (firer is already excluded inside applySplashDamage)
        attackerHouse, attacker ?? undefined,
      );
    } else if (proj.directHit && target && target.alive) {
      // Non-splash weapons (machine guns, etc.): direct hit only, no area effect
      const killed = damageEntity(ctx, target, impactDamage, proj.weapon.warhead, attacker);

      if (!killed && attacker) {
        triggerRetaliation(ctx, target, attacker);
        scatterInfantry(ctx, target, { x: proj.impactX, y: proj.impactY });
      }

      if (killed) {
        if (attacker) attacker.creditKill();
        handleUnitDeath(ctx, target, {
          screenShake: 8, explosionSize: 16, debris: true,
          decal: { infantry: 6, vehicle: 10, opacity: 0.6 },
          explodeLgSound: false,
          attackerIsPlayer: proj.attackerIsPlayer,
          trackLoss: true,
        });
      }
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
    if (isScud) {
      ctx.screenShake = Math.max(ctx.screenShake, 12);
      ctx.playSoundAt('building_explode', proj.impactX, proj.impactY);
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
            dog.pos.x = cx * CELL_SIZE + CELL_SIZE / 2;
            dog.pos.y = cy * CELL_SIZE + CELL_SIZE / 2;
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

  for (const other of ctx.entities) {
    if (!other.alive || other.inLimbo || other.id === sourceId) continue;
    // H2: Splash damage hits ALL units in radius including friendlies (C++ Explosion_Damage)
    const isFriendly = ctx.isAllied(other.house, attackerHouse);
    const distCells = worldDist(center, other.pos);
    if (distCells > splashRange) continue;

    // CF2: C++ inverse-proportional falloff via modifyDamage (combat.cpp:106-125)
    const distPixels = distCells * CELL_SIZE;
    const whMult = getWarheadMult(weapon.warhead, other.stats.armor, ctx.warheadOverrides);
    const splashDmg = modifyDamage(weapon.damage, weapon.warhead, other.stats.armor, distPixels, 1.0, whMult, getWarheadMeta(weapon.warhead, ctx.scenarioWarheadMeta).spreadFactor);
    if (splashDmg <= 0) continue;
    const killed = damageEntity(ctx, other, splashDmg, weapon.warhead, attacker);

    // Retaliation from splash damage
    if (!killed && attacker) {
      triggerRetaliation(ctx, other, attacker);
    }

    // Infantry scatter: push nearby infantry away from explosion
    if (other.alive && other.stats.isInfantry && distCells < splashRange * 0.8) {
      const angle = Math.atan2(other.pos.y - center.y, other.pos.x - center.x);
      const pushDist = CELL_SIZE * (1 - distCells / splashRange);
      const scatterX = other.pos.x + Math.cos(angle) * pushDist;
      const scatterY = other.pos.y + Math.sin(angle) * pushDist;
      // Only scatter to passable terrain
      const sc = worldToCell(scatterX, scatterY);
      if (ctx.map.isPassable(sc.cx, sc.cy)) {
        other.pos.x = scatterX;
        other.pos.y = scatterY;
      }
    }

    if (killed) {
      if (!isFriendly && attacker) attacker.creditKill();
      handleUnitDeath(ctx, other, {
        screenShake: 4, explosionSize: 12, debris: false,
        decal: null,
        explodeLgSound: false,
        attackerIsPlayer: !isFriendly && attackerIsPlayerControlled,
        trackLoss: !isFriendly,
        friendlyFireLoss: isFriendly && attackerIsPlayerControlled,
      });
    }
  }

  // C++ parity: Explosion_Damage (combat.cpp:205-237) iterates Cell_Occupier() chains which
  // include buildings. Structures within splash radius take damage proportional to distance.
  // Buildings at the impact cell get distance=0 (full damage, combat.cpp:227-228).
  const impactCell = worldToCell(center.x, center.y);
  for (const s of ctx.structures) {
    if (!s.alive) continue;
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
      distCells = worldDist(center, { x: swx, y: swy });
    }
    if (distCells > splashRange) continue;
    // Apply damage using per-building armor from rules.ini (C++ bdata.cpp)
    const distPixels = distCells * CELL_SIZE;
    const sArmor = s.armor ?? (STRUCTURE_ARMOR[s.type] ?? 'wood');
    const whMult = getWarheadMult(weapon.warhead, sArmor, ctx.warheadOverrides);
    const splashDmg = modifyDamage(weapon.damage, weapon.warhead, sArmor, distPixels, 1.0, whMult, getWarheadMeta(weapon.warhead, ctx.scenarioWarheadMeta).spreadFactor);
    if (splashDmg <= 0) continue;
    structureDamage(ctx, s, splashDmg);
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
      if (Math.floor(Math.random() * AI_BUILD_RULES.bridgeStrength) + 1 < weapon.damage) {
        const destroyed = ctx.map.destroyBridge(impactCell.cx, impactCell.cy, 3);
        if (destroyed > 0) {
          killBridgeOccupants(ctx, impactCell.cx, impactCell.cy, 3);
          ctx.bridgeCellCount = ctx.map.countBridgeCells();
          ctx.showEvaMessage(7); // "Bridge destroyed."
        }
      }
    }
  }

  // Terrain destruction: large explosions (splash >= 1.5) can destroy trees, walls, and ore in the blast radius
  const whMeta = getWarheadMeta(weapon.warhead, ctx.scenarioWarheadMeta);
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
        // CF8: Wall destruction from splash — warheads with IsWallDestroyer flag (C++ combat.cpp:244-270)
        if (whMeta.destroysWalls && ctx.map.getWallType(tx, ty) !== '') {
          ctx.map.clearWallType(tx, ty);
          ctx.map.addDecal(tx, ty, 4, 0.3); // rubble decal
          ctx.effects.push({
            type: 'explosion',
            x: tx * CELL_SIZE + CELL_SIZE / 2,
            y: ty * CELL_SIZE + CELL_SIZE / 2,
            frame: 0, maxFrames: 8, size: 6,
            sprite: 'piffpiff', spriteStart: 0,
          } as Effect);
        }
        // CF9: Ore destruction from splash — warheads with IsTiberiumDestroyer flag (C++ combat.cpp)
        if (whMeta.destroysOre) {
          const oreIdx = ty * MAP_CELLS + tx;
          if (tx >= 0 && tx < MAP_CELLS && ty >= 0 && ty < MAP_CELLS) {
            const ovl = ctx.map.overlay[oreIdx];
            if (ovl >= 0x03 && ovl <= 0x12) {
              // Reduce ore density by one level; fully depleted if at minimum
              if (ovl === 0x03 || ovl === 0x0F) {
                ctx.map.overlay[oreIdx] = 0xFF; // fully depleted
              } else {
                ctx.map.overlay[oreIdx] = ovl - 1;
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
export function structureDamage(ctx: CombatContext, s: MapStructure, damage: number): boolean {
  if (!s.alive) return false;
  // C++ house.cpp:2751 — Iron Curtain makes structures invulnerable (no damage taken)
  if (s.ironCurtainTicks && s.ironCurtainTicks > 0) return false;
  s.hp = Math.max(0, s.hp - damage);
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
      const ox = (Math.random() - 0.5) * fw * CELL_SIZE;
      const oy = (Math.random() - 0.5) * fh * CELL_SIZE;
      ctx.effects.push({
        type: 'explosion', x: wx + ox, y: wy + oy,
        frame: -i * 3, maxFrames: 12, size: 8, // staggered start via negative frame
        sprite: 'veh-hit1', spriteStart: 0,
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
    // Flying debris
    ctx.effects.push({
      type: 'debris', x: wx, y: wy,
      frame: 0, maxFrames: 20, size: fw * CELL_SIZE * 0.8,
    } as Effect);
    // Screen shake proportional to building size (1x1=8, 2x2=12, 3x3=16)
    const shakeIntensity = Math.min(20, 4 + Math.max(fw, fh) * 4);
    ctx.screenShake = Math.max(ctx.screenShake, shakeIntensity);
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
        const s2wx = s2.cx * CELL_SIZE + CELL_SIZE;
        const s2wy = s2.cy * CELL_SIZE + CELL_SIZE;
        const dist = worldDist({ x: wx, y: wy }, { x: s2wx, y: s2wy });
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
    // C++ building.cpp:1663-1716 — Drop_Debris: spawn infantry survivors on destruction
    // C++ building.cpp:3444: if (!IsCrewAble()) return 0 — only Crewed=yes buildings spawn survivors
    // Walls, barrels, kennels, silos, naval buildings etc. have no Crewed=yes in rules.ini.
    if (CREWED_BUILDINGS.has(s.type)) {
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
  const survivorCount = Math.min(5,
    Math.floor((buildCost * SURVIVOR_FRACTION) / E1_COST));

  // C++ building.cpp:3456-3463 — one engineer limit (applies to both sell and destruction)
  let engineerSpawned = false;
  const isUnarmed = !STRUCTURE_WEAPONS[s.type];

  for (let si = 0; si < survivorCount; si++) {
    let crewType: UnitType;
    switch (s.type) {
      case 'FACT':
        if (!engineerSpawned && Math.random() < 0.25) {
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
        if (isUnarmed && Math.random() < 0.15) {
          crewType = Math.random() < 0.5 ? UnitType.I_C1 : UnitType.I_C7;
        } else {
          crewType = UnitType.I_E1;
        }
        break;
    }
    const inf = new Entity(crewType, s.house, wx + (si % 3 - 1) * 6, wy + Math.floor(si / 3) * 6);
    // C++ building.cpp:1701 — destruction survivors get random HP (5 to MaxStrength)
    inf.hp = Math.max(5, Math.floor(Math.random() * inf.maxHp) + 5);
    inf.hp = Math.min(inf.hp, inf.maxHp);
    inf.mission = Mission.GUARD;
    // C++ building.cpp:1697 — IsTechnician: IsNominal infantry (E1) get technician star
    // Only buildings with buildup data (most constructed buildings) set this flag
    if (crewType === UnitType.I_E1) {
      inf.isTechnician = true;
    }
    ctx.entities.push(inf);
    ctx.entityById.set(inf.id, inf);
  }
}

/** Structure auto-fire — pillboxes, guard towers, tesla coils, SAM/AGUN fire at nearby enemies.
 *  Extracted from Game.updateStructureCombat (index.ts). */
export function updateStructureCombat(ctx: CombatContext): void {
  // C++ house.cpp:4164: low power when Power < Drain (including Power=0 with Drain>0)
  const isLowPower = ctx.powerConsumed > ctx.powerProduced;
  for (const s of ctx.structures) {
    if (!s.alive || !s.weapon || s.sellProgress !== undefined || s.buildProgress !== undefined) continue;
    // C++ parity PW1/PW3: powered defenses (TSLA, AGUN, GAP, PDOX, IRON, DOME) cannot fire during any power deficit.
    // Unpowered defenses (GUN, PBOX, HBOX, FTUR) always fire regardless of power.
    if (isLowPower && STRUCTURE_POWERED.has(s.type)) {
      continue;
    }
    // C++ building.cpp:882-883 — ammo instantly reloads to MaxAmmo each AI tick
    if (s.ammo === 0 && s.maxAmmo > 0) { s.ammo = s.maxAmmo; }
    if (s.ammo === 0) continue; // out of ammo (shouldn't reach here after reload)

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
      continue;
    }

    const sx = s.cx * CELL_SIZE + CELL_SIZE;
    const sy = s.cy * CELL_SIZE + CELL_SIZE;
    const structPos: WorldPos = { x: sx, y: sy };
    const range = s.weapon.range;

    // Find highest-threat enemy in range (C++ building.cpp — prioritize dangerous targets, not just closest)
    let bestTarget: Entity | null = null;
    let bestScore = -Infinity;
    for (const e of ctx.entities) {
      if (!e.alive || e.inLimbo) continue;
      if (ctx.isAllied(s.house, e.house)) continue; // don't shoot friendlies
      // human-requested: SAMs are air-only. Do NOT revert this line.
      if (s.weapon!.isAntiAir && (!e.isAirUnit || e.flightAltitude <= 0)) continue;
      if (e.isAirUnit && e.flightAltitude > 0 && !s.weapon!.isAntiAir) continue;
      const dist = worldDist(structPos, e.pos);
      if (dist >= range) continue;
      // LOS check
      const ec = e.cell;
      if (!ctx.map.hasLineOfSight(s.cx, s.cy, ec.cx, ec.cy)) continue;
      // C++ techno.cpp:1651-1752 Evaluate_Object threat scoring formula
      // value = 2 * Points + kills, then distance falloff: (value * 32000) / (distCells + 1)
      const points = e.stats.points ?? e.stats.strength ?? 5;
      const value = Math.trunc(points * 2) + (e.kills ?? 0);
      const distCells = Math.floor(dist); // dist from worldDist() is already in cell units
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
        const dist = worldDist(structPos, e.pos);
        if (dist < range && dist < bestAirDist) {
          bestAirTarget = e;
          bestAirDist = dist;
        }
      }
      if (bestAirTarget) {
        bestTarget = bestAirTarget;
      }
    }

    if (bestTarget) {
      // Update turret direction for turreted structures
      if (TURRETED_STRUCTURES.has(s.type)) {
        s.desiredTurretDir = directionTo(structPos, bestTarget.pos);
        // C++ Mission_Attack returns FIRE_FACING when turret is not aligned with target,
        // delaying fire until turret finishes rotating (building.cpp:2312-2318).
        // Both turretDir and desiredTurretDir are in 8-dir (0-7); compare directly.
        if (s.turretDir !== undefined && s.turretDir !== s.desiredTurretDir) continue; // turret not aligned — wait
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

      if (s.weapon.splash && s.weapon.splash > 0) {
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
      } else {
        // Projectile from structure to target — per-weapon projectile speed
        const structDistPx = Math.sqrt((bestTarget.pos.x - sx) ** 2 + (bestTarget.pos.y - sy) ** 2);
        const structTravelFrames = calcProjectileTravelFrames(structDistPx, s.weapon.projSpeed);
        ctx.effects.push({
          type: 'projectile', x: sx, y: sy, frame: 0, maxFrames: structTravelFrames, size: 3,
          startX: sx, startY: sy, endX: bestTarget.pos.x, endY: bestTarget.pos.y,
          projStyle: 'bullet',
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
}
