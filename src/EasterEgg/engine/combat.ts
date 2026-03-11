/**
 * Combat subsystem — damage calculation, projectiles, splash, and unit death.
 * Extracted from Game class (index.ts) to isolate combat logic.
 */

import {
  type WorldPos, type WeaponStats, type ArmorType, type WarheadType,
  type WarheadMeta, type WarheadProps,
  CELL_SIZE, MAP_CELLS, CONDITION_YELLOW,
  WARHEAD_VS_ARMOR, WARHEAD_PROPS, WARHEAD_META,
  armorIndex, worldDist, worldToCell, modifyDamage,
  directionTo, calcProjectileTravelFrames,
  House, Mission, AnimState, EXPLOSION_FRAMES,
} from './types';
import { type Entity } from './entity';
import { type MapStructure, STRUCTURE_SIZE, STRUCTURE_POWERED } from './scenario';
import { type Effect } from './renderer';
import { type GameMap, Terrain } from './map';
import { canTargetNaval } from './aircraft';

// ── Constants ──────────────────────────────────────────────────────────────────

/** CF3: Universal 1.5-cell splash radius (C++ Explosion_Damage uses ICON_LEPTON_W + ICON_LEPTON_W/2) */
export const SPLASH_RADIUS = 1.5;

const WALL_TYPES = new Set(['SBAG', 'FENC', 'BARB', 'BRIK']);

/** Turreted structure types — turret rotates to face target (GUN/SAM) */
const TURRETED_STRUCTURES = new Set(['GUN', 'SAM']);

// ── Interfaces ─────────────────────────────────────────────────────────────────

/** In-flight projectile for deferred damage */
export interface InflightProjectile {
  attackerId: number;
  targetId: number;
  weapon: WeaponStats;
  damage: number;
  speed: number;         // cells per tick
  travelFrames: number;  // total frames to travel
  currentFrame: number;
  directHit: boolean;    // was the shot accurate (for inaccurate weapons)
  impactX: number;       // final impact position (may be scattered)
  impactY: number;
  attackerIsPlayer: boolean;
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

// ── Mutating Functions ─────────────────────────────────────────────────────────

/** Apply damage to entity, track triggers, scatter idle AI units on hit */
export function damageEntity(
  ctx: CombatContext, target: Entity, amount: number,
  warhead: WarheadType, attacker?: Entity,
): boolean {
  const whProps = getWarheadProps(warhead, ctx.scenarioWarheadProps);
  const killed = target.takeDamage(amount, warhead, attacker, whProps);
  if (target.triggerName) ctx.attackedTriggerNames.add(target.triggerName);
  if (!killed && target.alive) aiScatterOnDamage(ctx, target);
  return killed;
}

/** AI scatter — idle AI units move to random adjacent cell when attacked (IQ >= 2, C++ techno.cpp) */
export function aiScatterOnDamage(ctx: CombatContext, entity: Entity): void {
  if (entity.isPlayerUnit) return;
  if (entity.mission !== Mission.GUARD && entity.mission !== Mission.AREA_GUARD) return;

  if (ctx.aiIQ(entity.house) < 2) return;

  // Move to random adjacent cell
  const dx = Math.floor(Math.random() * 3) - 1; // -1, 0, or 1
  const dy = Math.floor(Math.random() * 3) - 1;
  if (dx === 0 && dy === 0) return;

  const targetX = entity.pos.x + dx * CELL_SIZE;
  const targetY = entity.pos.y + dy * CELL_SIZE;

  // Check passability
  const tcx = Math.floor(targetX / CELL_SIZE);
  const tcy = Math.floor(targetY / CELL_SIZE);
  if (!ctx.map.isPassable(tcx, tcy)) return;

  entity.moveTarget = { x: targetX, y: targetY };
  entity.mission = Mission.MOVE;
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
  const whMult = getWarheadMult(wh, 'concrete', ctx.warheadOverrides);
  const damage = modifyDamage(weapon.damage, wh, 'concrete', 0, houseBias, whMult, getWarheadMeta(wh, ctx.scenarioWarheadMeta).spreadFactor);
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
}

/** Trigger retaliation: a damaged unit without a target attacks the shooter.
 *  In original RA, idle/moving units always counter-attack when hit. */
export function triggerRetaliation(ctx: CombatContext, victim: Entity, attacker: Entity): void {
  if (!victim.alive || !attacker.alive) return;
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
  const vc = vehicle.cell;
  for (const other of ctx.entities) {
    if (!other.alive || other.id === vehicle.id) continue;
    if (!other.stats.crushable) continue; // only crushable targets (infantry, ants)
    if (ctx.isAllied(vehicle.house, other.house)) continue; // C++ IsAFriend — don't crush allies
    const oc = other.cell;
    if (oc.cx === vc.cx && oc.cy === vc.cy) {
      damageEntity(ctx, other, other.hp + 10, 'Super'); // instant kill, always die2
      vehicle.creditKill();
      ctx.effects.push({
        type: 'blood', x: other.pos.x, y: other.pos.y,
        frame: 0, maxFrames: 6, size: 4, sprite: 'piffpiff', spriteStart: 0,
      } as Effect);
      // Use appropriate death sound based on unit type
      const crushSound = other.isAnt ? 'die_ant' : 'die_infantry';
      ctx.playSoundAt(crushSound, other.pos.x, other.pos.y);
      ctx.map.addDecal(oc.cx, oc.cy, 3, 0.3);
      if (ctx.isPlayerControlled(vehicle)) ctx.killCount++;
      else {
        ctx.lossCount++;
        ctx.playEva('eva_unit_lost');
        const alertCell = other.cell;
        ctx.minimapAlert(alertCell.cx, alertCell.cy);
      }
    }
  }
}

/** Launch a projectile with travel time — damage is deferred until arrival */
export function launchProjectile(
  ctx: CombatContext, attacker: Entity, target: Entity | null, weapon: WeaponStats,
  damage: number, impactX: number, impactY: number, directHit: boolean,
): void {
  const dist = worldDist(attacker.pos, { x: impactX, y: impactY });
  const speed = weapon.projectileSpeed!;
  const travelFrames = Math.max(1, Math.round(dist / speed));

  ctx.inflightProjectiles.push({
    attackerId: attacker.id,
    targetId: target?.id ?? -1,
    weapon,
    damage,
    speed,
    travelFrames,
    currentFrame: 0,
    directHit,
    impactX,
    impactY,
    attackerIsPlayer: ctx.isPlayerControlled(attacker),
  });
}

/** Advance in-flight projectiles; apply damage + splash on arrival */
export function updateInflightProjectiles(ctx: CombatContext): void {
  const arrived: InflightProjectile[] = [];

  for (const proj of ctx.inflightProjectiles) {
    proj.currentFrame++;

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

    if (proj.currentFrame >= proj.travelFrames) {
      arrived.push(proj);
    }
  }

  // Remove arrived projectiles
  ctx.inflightProjectiles = ctx.inflightProjectiles.filter(p => p.currentFrame < p.travelFrames);

  // Apply damage for arrived projectiles
  for (const proj of arrived) {
    const target = ctx.entityById.get(proj.targetId);
    const attacker = ctx.entityById.get(proj.attackerId);

    if (proj.directHit && target && target.alive) {
      const killed = damageEntity(ctx, target, proj.damage, proj.weapon.warhead, attacker);

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

    // Splash damage at impact point
    if (proj.weapon.splash && proj.weapon.splash > 0) {
      const attackerHouse = attacker?.house ?? (proj.attackerIsPlayer ? ctx.playerHouse : House.USSR);
      applySplashDamage(
        ctx, { x: proj.impactX, y: proj.impactY }, proj.weapon,
        proj.directHit && target ? target.id : -1,
        attackerHouse, attacker ?? undefined,
      );
    }

    // R8: Impact explosion sprite from warhead's explosionSet (C++ warhead.cpp)
    const projImpactSprite = getWarheadProps(proj.weapon.warhead, ctx.scenarioWarheadProps)?.explosionSet ?? 'veh-hit1';
    // V2RL SCUD: large explosion + screen shake on impact (C++ IsGigundo=true)
    const isScud = proj.weapon.name === 'SCUD';
    ctx.effects.push({ type: 'explosion', x: proj.impactX, y: proj.impactY,
      frame: 0, maxFrames: EXPLOSION_FRAMES[projImpactSprite] ?? 17, size: isScud ? 20 : 8, sprite: projImpactSprite, spriteStart: 0 } as Effect);
    if (isScud) {
      ctx.screenShake = Math.max(ctx.screenShake, 12);
      ctx.playSoundAt('building_explode', proj.impactX, proj.impactY);
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

  for (const other of ctx.entities) {
    if (!other.alive || other.id === primaryTargetId) continue;
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

  // Terrain destruction: large explosions (splash >= 1.5) can destroy trees, walls, and ore in the blast radius
  const whMeta = getWarheadMeta(weapon.warhead, ctx.scenarioWarheadMeta);
  if (splashRange >= 1.5 && weapon.damage >= 30) {
    const cc = worldToCell(center.x, center.y);
    const r = Math.ceil(splashRange);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > splashRange * splashRange) continue;
        const tx = cc.cx + dx;
        const ty = cc.cy + dy;
        if (ctx.map.getTerrain(tx, ty) === Terrain.TREE) {
          // 40% chance to destroy tree per explosion
          if (Math.random() < 0.4) {
            ctx.map.setTerrain(tx, ty, Terrain.CLEAR);
            ctx.map.clearTreeType(tx, ty);
            ctx.map.addDecal(tx, ty, 6, 0.4); // stump/scorch mark
            ctx.effects.push({
              type: 'explosion',
              x: tx * CELL_SIZE + CELL_SIZE / 2,
              y: ty * CELL_SIZE + CELL_SIZE / 2,
              frame: 0, maxFrames: 10, size: 8,
              sprite: 'piffpiff', spriteStart: 0,
            } as Effect);
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
      ctx.tick - ctx.lastBaseAttackEva > ctx.gameTicksPerSec * 5) {
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
    if (ctx.isAllied(s.house, ctx.playerHouse)) {
      ctx.structuresLost++;
      ctx.playEva('eva_unit_lost'); // reuse unit_lost for building destruction
      // C++ parity: recalculate silo capacity when storage structure destroyed
      if (s.type === 'PROC' || s.type === 'SILO') {
        ctx.recalculateSiloCapacity();
      }
    }
    // Structure explosion damages nearby units (2-cell radius, ~100 base damage)
    const blastRadius = 2;
    for (const e of ctx.entities) {
      if (!e.alive) continue;
      const dist = worldDist({ x: wx, y: wy }, e.pos);
      if (dist > blastRadius) continue;
      const falloff = 1 - (dist / blastRadius) * 0.6;
      const blastDmg = Math.max(1, Math.round(100 * falloff));
      damageEntity(ctx, e, blastDmg, 'HE');
    }
    // Leave large scorch mark
    ctx.map.addDecal(s.cx, s.cy, 14, 0.6);
    // Barrel explosion: barrels always explode. Only destroy bridge if barrel is near bridge cells.
    if (s.type === 'BARL' || s.type === 'BRL3') {
      const destroyed = ctx.map.destroyBridge(s.cx, s.cy, 3);
      if (destroyed > 0) {
        ctx.bridgeCellCount = ctx.map.countBridgeCells();
        ctx.showEvaMessage(7); // "Bridge destroyed."
      }
    }
    return true;
  }
  return false;
}

/** Structure auto-fire — pillboxes, guard towers, tesla coils, SAM/AGUN fire at nearby enemies.
 *  Extracted from Game.updateStructureCombat (index.ts). */
export function updateStructureCombat(ctx: CombatContext): void {
  const isLowPower = ctx.powerConsumed > ctx.powerProduced && ctx.powerProduced > 0;
  for (const s of ctx.structures) {
    if (!s.alive || !s.weapon || s.sellProgress !== undefined) continue;
    // C++ parity PW1/PW3: powered defenses (TSLA, GUN, SAM, AGUN) cannot fire during any power deficit.
    // Unpowered defenses (PBOX, HBOX, FTUR) always fire regardless of power.
    if (isLowPower && STRUCTURE_POWERED.has(s.type)) {
      continue;
    }
    // C++ building.cpp:882-883 — ammo instantly reloads to MaxAmmo each AI tick
    if (s.ammo === 0 && s.maxAmmo > 0) { s.ammo = s.maxAmmo; }
    if (s.ammo === 0) continue; // out of ammo (shouldn't reach here after reload)

    // Turret rotation tick (every frame, independent of cooldown)
    if (TURRETED_STRUCTURES.has(s.type)) {
      if (s.turretDir === undefined) s.turretDir = 4; // default: South
      if (s.desiredTurretDir === undefined) s.desiredTurretDir = s.turretDir;
      if (s.turretDir !== s.desiredTurretDir) {
        const diff = (s.desiredTurretDir - s.turretDir + 8) % 8;
        s.turretDir = diff <= 4
          ? (s.turretDir + 1) % 8
          : (s.turretDir + 7) % 8;
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
      if (!e.alive) continue;
      if (ctx.isAllied(s.house, e.house)) continue; // don't shoot friendlies
      // AA gate: non-AA structures can't target airborne aircraft
      if (e.isAirUnit && e.flightAltitude > 0 && !s.weapon!.isAntiAir) continue;
      const dist = worldDist(structPos, e.pos);
      if (dist >= range) continue;
      // LOS check
      const ec = e.cell;
      if (!ctx.map.hasLineOfSight(s.cx, s.cy, ec.cx, ec.cy)) continue;
      // Threat scoring: prioritize dangerous/wounded enemies over merely close ones
      const isAttackingAlly = e.targetStructure?.alive && ctx.isAllied(s.house, (e.targetStructure.house as House) ?? House.Neutral);
      let score = e.stats.isInfantry ? 10 : 25;
      score += (e.weapon?.damage ?? 0) * 0.2;
      if (e.hp < e.maxHp * 0.5) score *= 1.5; // wounded bonus
      if (isAttackingAlly) score *= 2; // retaliation
      score *= Math.max(0.3, 1 - (dist / range) * 0.7); // distance weighting
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
        if (!e.alive || !e.isAirUnit || e.flightAltitude <= 0) continue;
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
      }
      // H1: Buildings with Ammo>1 fire rapidly (1-tick rearm) then recharge (C++ techno.cpp:2861)
      if (s.ammo > 0) {
        s.ammo--;
        s.attackCooldown = s.ammo > 0 ? 1 : s.weapon.rof; // rapid-fire until last shot
      } else {
        s.attackCooldown = s.weapon.rof; // unlimited ammo (-1) uses normal ROF
      }
      if (TURRETED_STRUCTURES.has(s.type)) s.firingFlash = 4;
      // CF1: Apply C++ Modify_Damage — structure direct hit at distance 0
      const wh = (s.weapon.warhead ?? 'HE') as WarheadType;
      const houseBias = ctx.getFirepowerBias(s.house);
      const whMult = getWarheadMult(wh, bestTarget.stats.armor, ctx.warheadOverrides);
      const damage = modifyDamage(s.weapon.damage, wh, bestTarget.stats.armor, 0, houseBias, whMult, getWarheadMeta(wh, ctx.scenarioWarheadMeta).spreadFactor);
      const killed = damageEntity(ctx, bestTarget, damage, wh);

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
        const aaImpactSprite = (s.weapon.isAntiAir && bestTarget.isAirUnit && bestTarget.flightAltitude > 0)
          ? 'flak'
          : (getWarheadProps(wh, ctx.scenarioWarheadProps)?.explosionSet ?? 'veh-hit1');
        ctx.effects.push({
          type: 'explosion', x: bestTarget.pos.x, y: bestTarget.pos.y,
          frame: 0, maxFrames: 10, size: 6,
          sprite: aaImpactSprite, spriteStart: 0,
        } as Effect);
        ctx.playSoundAt('machinegun', sx, sy);
      }

      // Splash damage
      if (s.weapon.splash && s.weapon.splash > 0) {
        applySplashDamage(
          ctx, bestTarget.pos,
          { damage: s.weapon.damage, warhead: wh, splash: s.weapon.splash },
          bestTarget.id, s.house,
        );
      }

      if (killed) {
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
