/**
 * Mission AI subsystem — unit-level mission state machines for ATTACK, HUNT,
 * GUARD, AREA_GUARD, RETREAT, AMBUSH, REPAIR, and force-fire behaviors.
 * Extracted from Game class (index.ts) to isolate mission-level AI logic.
 */

import {
  type WorldPos, type WeaponStats, type ArmorType,
  type WarheadType, type WarheadMeta, type WarheadProps,
  CELL_SIZE, LEPTON_SIZE,
  House, Mission, AnimState, UnitType, Stance,
  worldDist, directionTo, worldToCell,
  EXPLOSION_FRAMES, CONDITION_RED,
  calcProjectileTravelFrames, modifyDamage,
} from './types';
import { Entity, CloakState, CLOAK_TRANSITION_FRAMES } from './entity';
import { type MapStructure } from './scenario';
import { type Effect } from './renderer';
import { type GameMap, Terrain } from './map';
import { findPath } from './pathfinding';
import { canTargetNaval } from './aircraft';

// ── Context interface ───────────────────────────────────────────────────────

/** Context object providing mission AI functions access to game state and callbacks */
export interface MissionAIContext {
  // Data
  entities: Entity[];
  structures: MapStructure[];
  effects: Effect[];
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

  // Sound
  playSoundAt(name: string, x: number, y: number): void;
  playEva(name: string): void;
  playSound(name: string): void;
  weaponSound(name: string): string;

  // Combat delegation — these call back into the Game class / combat.ts wrappers
  damageEntity(target: Entity, amount: number, warhead: WarheadType, attacker?: Entity): boolean;
  damageStructure(s: MapStructure, damage: number): boolean;
  triggerRetaliation(victim: Entity, attacker: Entity): void;
  handleUnitDeath(victim: Entity, opts: {
    screenShake: number; explosionSize: number; debris: boolean;
    decal: { infantry: number; vehicle: number; opacity: number } | null;
    explodeLgSound: boolean; attackerIsPlayer: boolean; trackLoss: boolean;
  }): void;
  launchProjectile(
    attacker: Entity, target: Entity | null, weapon: WeaponStats,
    damage: number, impactX: number, impactY: number, directHit: boolean,
  ): void;
  applySplashDamage(
    center: WorldPos, weapon: { damage: number; warhead: WarheadType; splash?: number },
    primaryTargetId: number, attackerHouse: House, attacker?: Entity,
  ): void;

  // Warhead helpers
  getFirepowerBias(house: House): number;
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
}

// ── Local helpers ───────────────────────────────────────────────────────────

/** Infantry scatter: push infantry slightly away from attacker on direct hit.
 *  In original RA, infantry move randomly when shot at. */
function scatterInfantry(ctx: MissionAIContext, victim: Entity, attackerPos: WorldPos): void {
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

// ── Exported mission functions ──────────────────────────────────────────────

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
    // Resume saved move destination (AI units interrupted MOVE to attack)
    if (entity.savedMoveTarget) {
      const saved = entity.savedMoveTarget;
      entity.savedMoveTarget = null;
      entity.mission = Mission.MOVE;
      entity.moveTarget = { x: saved.x, y: saved.y };
      entity.path = findPath(ctx.map, entity.cell, worldToCell(saved.x, saved.y), true, entity.isNavalUnit, entity.stats.speedClass);
      entity.pathIndex = 0;
      return;
    }
    // Return to guard origin if player unit was auto-engaging (not given explicit attack order)
    if (entity.isPlayerUnit && entity.guardOrigin) {
      const d = worldDist(entity.pos, entity.guardOrigin);
      if (d > 1.5) { // worldDist returns cells
        entity.mission = Mission.MOVE;
        entity.moveTarget = { x: entity.guardOrigin.x, y: entity.guardOrigin.y };
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

  // Force-uncloak submarine when attacking
  if (entity.stats.isCloakable && (entity.cloakState === CloakState.CLOAKED || entity.cloakState === CloakState.CLOAKING) && entity.target) {
    entity.cloakState = CloakState.UNCLOAKING;
    entity.cloakTimer = CLOAK_TRANSITION_FRAMES;
  }

  // Minimum range check: artillery can't fire at point-blank
  if (entity.weapon?.minRange && entity.target) {
    const dist = worldDist(entity.pos, entity.target.pos);
    if (dist < entity.weapon.minRange) {
      ctx.retreatFromTarget(entity, entity.target.pos);
      return;
    }
  }

  if (entity.inRange(entity.target)) {
    // Check line of sight — can't fire through walls/rocks
    const ec = entity.cell;
    const tc = entity.target.cell;
    if (!ctx.map.hasLineOfSight(ec.cx, ec.cy, tc.cx, tc.cy)) {
      // LOS blocked — move toward target to get clear shot
      entity.animState = AnimState.WALK;
      entity.moveToward(entity.target.pos, ctx.movementSpeed(entity));
      if (entity.attackCooldown > 0) entity.attackCooldown--;
      if (entity.attackCooldown2 > 0) entity.attackCooldown2--;
      return;
    }

    // Turreted vehicles: turret tracks target, body may stay still
    if (entity.hasTurret) {
      entity.desiredTurretFacing = directionTo(entity.pos, entity.target.pos);
      entity.tickTurretRotation();
    } else {
      entity.desiredFacing = directionTo(entity.pos, entity.target.pos);
      const facingReady = entity.tickRotation();
      // NoMovingFire units must face target before attacking.
      // Exception: melee weapons (range <= 2) bypass facing check to prevent
      // rotation lock where ants never catch up to moving targets.
      const isMelee = entity.weapon && entity.weapon.range <= 2;
      if (entity.stats.noMovingFire && !facingReady && !isMelee) {
        entity.animState = AnimState.IDLE;
        return;
      }
    }
    entity.animState = AnimState.ATTACK;

    // S5: NoMovingFire setup time (C++ unit.cpp:1760-1764 — Arm = Rearm_Delay(true)/4 when stopping)
    // When a NoMovingFire unit transitions from moving to stationary, add ROF/4 warmup delay
    if (entity.stats.noMovingFire && entity.wasMoving && entity.weapon) {
      const setupTime = Math.floor(entity.weapon.rof / 4);
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

    // Dual-weapon selection (C++ TechnoClass::Fire_At / Can_Fire):
    // Select the best weapon based on target armor effectiveness and cooldown state.
    // Only one weapon fires per tick — they alternate based on cooldowns and effectiveness.
    const selectedWeapon = entity.selectWeapon(
      entity.target, (wh, ar) => ctx.getWarheadMult(wh, ar),
    );

    // If a burst is in progress, continue with the primary weapon (burst belongs to primary)
    const activeWeapon = entity.burstCount > 0 ? entity.weapon : selectedWeapon;
    const isSecondary = activeWeapon === entity.weapon2;

    if (activeWeapon && ((isSecondary ? entity.attackCooldown2 : entity.attackCooldown) <= 0)) {
      // C1: Set burst count for multi-shot weapons (e.g. MammothTusk burst: 2)
      const burst = activeWeapon.burst ?? 1;
      if (entity.burstCount > 0) {
        // Continuing burst — decrement
        entity.burstCount--;
        entity.burstDelay = 3; // 3 ticks between burst shots (C++ standard)
      } else {
        // CF12: IsSecondShot cadence for dual-weapon units (C++ techno.cpp:2857-2870)
        // First shot: 3-tick rearm (quick follow-up). Second shot: full ROF (reload delay).
        const isDualWeapon = entity.weapon && entity.weapon2;
        let rearmTime = activeWeapon.rof;
        if (isDualWeapon) {
          if (!entity.isSecondShot) {
            rearmTime = 3; // first shot: quick 3-tick rearm
          }
          entity.isSecondShot = !entity.isSecondShot;
        }
        if (isSecondary) {
          entity.attackCooldown2 = rearmTime;
        } else {
          entity.attackCooldown = rearmTime;
        }
        entity.burstCount = burst - 1; // remaining shots after this one
        if (entity.burstCount > 0) entity.burstDelay = 3;
      }
      // M6: C++ techno.cpp:3114-3117 — recoil only for turreted units
      if (entity.hasTurret) entity.isInRecoilState = true;

      // Gap #4: Reset spy disguise when attacking
      if (entity.disguisedAs) entity.disguisedAs = null;

      // Apply weapon inaccuracy — scatter the impact point
      let impactX = entity.target.pos.x;
      let impactY = entity.target.pos.y;
      let directHit = true;
      // C5: Moving-platform inaccuracy (C++ techno.cpp:3106-3108)
      const isMoving = entity.prevPos.x !== entity.pos.x || entity.prevPos.y !== entity.pos.y;
      const baseInaccuracy = activeWeapon.inaccuracy ?? 0;
      let effectiveInaccuracy = isMoving ? Math.max(baseInaccuracy, 1.0) : baseInaccuracy;
      // SC1: AP warheads force scatter vs infantry even with 0 weapon inaccuracy (C++ bullet.cpp:709-710)
      if (activeWeapon.warhead === 'AP' && entity.target.stats.isInfantry && effectiveInaccuracy <= 0) {
        effectiveInaccuracy = 0.5;
      }
      // WH5: IsInaccurate flag — forced scatter on every shot (C++ bullet.h)
      if (activeWeapon.isInaccurate && effectiveInaccuracy <= 0) {
        effectiveInaccuracy = 1.0;
      }
      if (effectiveInaccuracy > 0) {
        // SC3: Exact C++ scatter formula (bullet.cpp:710-730)
        // distance in leptons (1 cell = 256 leptons), convert from cells
        const targetDist = worldDist(entity.pos, entity.target.pos);
        const distLeptons = targetDist * LEPTON_SIZE;
        // C++ formula: scatterMax = max(0, (distance / 16) - 64)
        let scatterMax = Math.max(0, (distLeptons / 16) - 64);
        // Cap at HomingScatter(512) for homing, BallisticScatter(256) for ballistic
        const isHoming = (activeWeapon.projectileROT ?? 0) > 0;
        const scatterCap = isHoming ? 512 : 256;
        scatterMax = Math.min(scatterMax, scatterCap);
        // Convert scatter from leptons back to pixels: leptons * CELL_SIZE / LEPTON_SIZE
        const scatterPx = scatterMax * CELL_SIZE / LEPTON_SIZE;
        const dist = Math.random() * scatterPx;
        if (activeWeapon.isArcing) {
          // SC5+SC2: Arcing projectiles — circular scatter with ±5° angular jitter (C++ bullet.cpp:722)
          const baseAngle = Math.random() * Math.PI * 2;
          const jitterDeg = (Math.random() * 10 - 5); // ±5 degrees (C++ Random_Pick(0,10)-5)
          const angle = baseAngle + (jitterDeg * Math.PI / 180);
          impactX += Math.cos(angle) * dist;
          impactY += Math.sin(angle) * dist;
        } else {
          // SC2: Non-arcing projectiles — scatter along firing direction (overshoot/undershoot)
          const firingAngle = Math.atan2(
            entity.target.pos.y - entity.pos.y,
            entity.target.pos.x - entity.pos.x,
          );
          impactX += Math.cos(firingAngle) * dist;
          impactY += Math.sin(firingAngle) * dist;
        }
        // Check if scattered shot still hits the target (within half-cell)
        const dx = impactX - entity.target.pos.x;
        const dy = impactY - entity.target.pos.y;
        directHit = Math.sqrt(dx * dx + dy * dy) < CELL_SIZE * 0.6;
      }

      // CF7: Heal guard — negative damage weapons must pass proximity and armor checks (C++ combat.cpp:86-96)
      if (activeWeapon.damage < 0) {
        const healDist = worldDist(entity.pos, entity.target.pos);
        if (activeWeapon.warhead === 'Mechanical') {
          // GoodWrench/Mechanic: only heals armored targets (armor !== 'none') within 0.75 cells
          if (healDist >= 0.75 || entity.target.stats.armor === 'none') return;
        } else {
          // Heal warhead (Organic): only heals unarmored targets (armor === 'none') within 0.75 cells
          if (healDist >= 0.75 || entity.target.stats.armor !== 'none') return;
        }
        // Apply healing directly — modifyDamage clamps negative values to 0
        const healAmount = Math.abs(activeWeapon.damage);
        entity.target.hp = Math.min(entity.target.maxHp, entity.target.hp + healAmount);
        return;
      }

      // CF1: Apply C++ Modify_Damage formula — direct hit at distance 0 gets full damage
      const houseBias = ctx.getFirepowerBias(entity.house);
      const whMult = ctx.getWarheadMult(activeWeapon.warhead, entity.target.stats.armor);
      const damage = modifyDamage(activeWeapon.damage, activeWeapon.warhead, entity.target.stats.armor, 0, houseBias, whMult, ctx.getWarheadMeta(activeWeapon.warhead).spreadFactor);
      if (damage <= 0) {
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

      if (activeWeapon.projectileSpeed) {
        // Deferred damage: projectile must travel to target
        ctx.launchProjectile(entity, entity.target, activeWeapon, damage, impactX, impactY, directHit);
      } else {
        // Instant damage (melee, hitscan weapons)
        const killed = directHit ? ctx.damageEntity(entity.target, damage, activeWeapon.warhead, entity) : false;

        if (directHit && !killed) {
          ctx.triggerRetaliation(entity.target, entity);
          scatterInfantry(ctx, entity.target, entity.pos);
        }

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
          });
        }
      }

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
        if (projStyle !== 'bullet' || worldDist(entity.pos, entity.target.pos) > 2) {
          // Per-weapon projectile speed: compute travel frames from distance and projSpeed
          const projDistPx = Math.sqrt((impactX - sx) ** 2 + (impactY - sy) ** 2);
          const travelFrames = calcProjectileTravelFrames(projDistPx, activeWeapon.projSpeed);
          ctx.effects.push({
            type: 'projectile', x: sx, y: sy, frame: 0, maxFrames: travelFrames, size: 3,
            startX: sx, startY: sy, endX: impactX, endY: impactY, projStyle,
          } as Effect);
        }

        // R8: Impact explosion sprite from warhead's explosionSet (C++ warhead.cpp)
        // Water terrain uses water splash sprites (C++ bullet.cpp:1032)
        const impactCell = worldToCell(impactX, impactY);
        const isWaterImpact = ctx.map.getTerrain(impactCell.cx, impactCell.cy) === Terrain.WATER
          && !entity.target.isNavalUnit; // vessel targets still use normal explosions
        let impactSprite: string;
        if (isWaterImpact) {
          const waterSprites = ['h2o_exp1', 'h2o_exp2', 'h2o_exp3'];
          impactSprite = waterSprites[Math.floor(Math.random() * 3)];
        } else {
          impactSprite = ctx.getWarheadProps(activeWeapon.warhead)?.explosionSet ?? 'veh-hit1';
        }
        ctx.effects.push({ type: 'explosion', x: impactX, y: impactY, frame: 0,
          maxFrames: EXPLOSION_FRAMES[impactSprite] ?? 17, size: 8,
          sprite: impactSprite, spriteStart: 0 } as Effect);
      }

    }
  } else {
    // M5: Defensive stance: chase if target within weapon range of guard origin (C++ Threat_Range)
    // Only give up if target is too far from the home position, not current position
    if (entity.stance === Stance.DEFENSIVE) {
      const weaponRange = Math.max(entity.weapon?.range ?? 0, entity.weapon2?.range ?? 0) || 2;
      const origin = entity.guardOrigin ?? entity.pos;
      const distFromHome = worldDist(origin, entity.target.pos);
      if (distFromHome > weaponRange + 1) {
        // Target fled beyond guard perimeter — disengage
        entity.target = null;
        entity.forceFirePos = null;
        entity.targetStructure = null;
        entity.mission = ctx.idleMission(entity);
        entity.animState = AnimState.IDLE;
      } else {
        // Target still within guard perimeter — pursue briefly
        entity.animState = AnimState.WALK;
        entity.moveToward(entity.target.pos, ctx.movementSpeed(entity));
      }
    } else {
      entity.animState = AnimState.WALK;
      entity.moveToward(entity.target.pos, ctx.movementSpeed(entity));
    }
  }

  if (entity.attackCooldown > 0) entity.attackCooldown--;
  if (entity.attackCooldown2 > 0) entity.attackCooldown2--;
}

/** Hunt mode — move toward target and attack (C++ foot.cpp:654-703)
 *  Actively calls Target_Something_Nearby when target is null or dead. */
export function updateHunt(ctx: MissionAIContext, entity: Entity): void {
  if (!entity.target?.alive) {
    entity.target = null;
    // C++ foot.cpp:654-703 — Hunt actively scans for new targets with extended range
    const huntRange = entity.stats.sight * 2; // hunt has wider scan than guard
    const ec = entity.cell;
    let bestTarget: Entity | null = null;
    let bestScore = -Infinity;
    for (const other of ctx.entities) {
      if (!other.alive || ctx.entitiesAllied(entity, other)) continue;
      if (!canTargetNaval(entity, other)) continue;
      const dist = worldDist(entity.pos, other.pos);
      if (dist > huntRange) continue;
      if (!ctx.map.hasLineOfSight(ec.cx, ec.cy, other.cell.cx, other.cell.cy)) continue;
      const score = ctx.threatScore(entity, other, dist);
      if (score > bestScore) { bestScore = score; bestTarget = other; }
    }
    if (bestTarget) {
      // Found a new target — continue hunting
      entity.target = bestTarget;
    } else {
      // M3: No mobile targets — scan structures (C++ Target_Something_Nearby includes buildings)
      let bestStruct: MapStructure | null = null;
      let bestStructDist = huntRange;
      for (const s of ctx.structures) {
        if (!s.alive) continue;
        if (s.house === House.Neutral) continue;
        if (ctx.isAllied(entity.house, s.house)) continue;
        const sPos = { x: s.cx * CELL_SIZE + CELL_SIZE, y: s.cy * CELL_SIZE + CELL_SIZE };
        const dist = worldDist(entity.pos, sPos);
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
      // No targets found — resume move or return to idle
      if (entity.moveTarget) {
        entity.mission = Mission.MOVE;
        // Only recalc path if we don't have a valid one already
        if (entity.path.length === 0 || entity.pathIndex >= entity.path.length) {
          entity.path = findPath(ctx.map, entity.cell, worldToCell(entity.moveTarget.x, entity.moveTarget.y), true, entity.isNavalUnit, entity.stats.speedClass);
          entity.pathIndex = 0;
        }
      } else {
        entity.mission = ctx.idleMission(entity);
      }
      return;
    }
  }

  if (entity.inRange(entity.target)) {
    entity.mission = Mission.ATTACK;
    entity.animState = AnimState.ATTACK;
  } else {
    entity.animState = AnimState.WALK;
    // Use pathfinding to reach target (recalc only when path is exhausted or target moved significantly)
    const targetCell = worldToCell(entity.target.pos.x, entity.target.pos.y);
    const pathExhausted = entity.path.length === 0 || entity.pathIndex >= entity.path.length;
    // Only recalc on timer if target has moved >3 cells from path endpoint
    let targetMovedFar = false;
    if (!pathExhausted && ((ctx.tick + entity.id) % 15 === 0) && entity.path.length > 0) {
      const lastWp = entity.path[entity.path.length - 1];
      const dtx = lastWp.cx - targetCell.cx;
      const dty = lastWp.cy - targetCell.cy;
      targetMovedFar = (dtx * dtx + dty * dty) > 9; // >3 cells
    }
    if (pathExhausted || targetMovedFar) {
      entity.path = findPath(ctx.map, entity.cell, targetCell, true, entity.isNavalUnit, entity.stats.speedClass);
      entity.pathIndex = 0;
    }
    if (entity.path.length > 0 && entity.pathIndex < entity.path.length) {
      const nextCell = entity.path[entity.pathIndex];
      const wp: WorldPos = {
        x: nextCell.cx * CELL_SIZE + CELL_SIZE / 2,
        y: nextCell.cy * CELL_SIZE + CELL_SIZE / 2,
      };
      if (entity.moveToward(wp, ctx.movementSpeed(entity))) {
        entity.pathIndex++;
      }
    } else {
      // No path found — move directly
      entity.moveToward(entity.target.pos, ctx.movementSpeed(entity));
    }
  }
}

/** Guard mode — attack nearby enemies or auto-heal (rate-limited to every 15 ticks) */
export function updateGuard(ctx: MissionAIContext, entity: Entity): void {
  entity.animState = AnimState.IDLE;

  // Save guard origin when first entering guard stance (for return-after-chase)
  if (entity.isPlayerUnit && !entity.guardOrigin) {
    entity.guardOrigin = { x: entity.pos.x, y: entity.pos.y };
  }

  // Medic auto-heal: handled by updateMedic() — medics are non-combat, skip enemy targeting
  if (entity.type === UnitType.I_MEDI) {
    ctx.updateMedic(entity);
    return;
  }

  // Mechanic auto-heal: mirrors medic but for vehicles — non-combat, skip enemy targeting
  if (entity.type === UnitType.I_MECH) {
    ctx.updateMechanicUnit(entity);
    return;
  }

  // A3: Type-specific scan delays (C++ foot.cpp:589-612)
  const guardScanDelay = entity.stats.scanDelay ?? 15;
  if (ctx.tick - entity.lastGuardScan < guardScanDelay) return;
  entity.lastGuardScan = ctx.tick;

  // Civilians auto-flee nearby ants (SCA02EA evacuation behavior)
  if (entity.isCivilian && entity.isPlayerUnit) {
    let nearestAntDist = Infinity;
    let nearestAntPos: WorldPos | null = null;
    for (const other of ctx.entities) {
      if (!other.alive || !other.isAnt) continue;
      const dist = worldDist(entity.pos, other.pos);
      if (dist < 5 && dist < nearestAntDist) {
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
        x: Math.max(bx0 + CELL_SIZE, Math.min(bx1 - CELL_SIZE, fleeX)),
        y: Math.max(by0 + CELL_SIZE, Math.min(by1 - CELL_SIZE, fleeY)),
      };
      entity.mission = Mission.MOVE;
      entity.path = [];
      entity.pathIndex = 0;
    }
    return; // civilians don't auto-attack
  }

  // Hold fire stance: never auto-engage
  if (entity.stance === Stance.HOLD_FIRE) return;

  // Harvesters have no weapon — don't auto-engage (would chase forever)
  if (entity.type === UnitType.V_HARV) return;

  // Gap #4: Auto-disguise spies near enemies
  if (entity.type === UnitType.I_SPY && entity.alive && !entity.disguisedAs && entity.isPlayerUnit) {
    for (const other of ctx.entities) {
      if (!other.alive || ctx.entitiesAllied(entity, other)) continue;
      if (worldDist(entity.pos, other.pos) <= 4) { // worldDist returns cells
        ctx.spyDisguise(entity, other);
        break;
      }
    }
  }

  // Gap #4: Dog spy detection — dogs auto-target enemy spies within 3 cells
  if (entity.type === 'DOG' && entity.alive) {
    for (const other of ctx.entities) {
      if (!other.alive || other.type !== UnitType.I_SPY) continue;
      if (ctx.entitiesAllied(entity, other)) continue;
      if (worldDist(entity.pos, other.pos) <= 3) { // worldDist returns cells
        entity.target = other;
        entity.mission = Mission.ATTACK;
        return;
      }
    }
  }

  const ec = entity.cell;
  const isDog = entity.type === 'DOG';
  // Guard scan range: use guardRange if defined (from INI GuardRange=N), else sight
  // Defensive stance: reduced to weapon range only
  const baseRange = entity.stats.guardRange ?? entity.stats.sight;
  const scanRange = entity.stance === Stance.DEFENSIVE
    ? Math.min(baseRange, (entity.weapon?.range ?? 2) + 1)
    : baseRange;
  let bestTarget: Entity | null = null;
  let bestScore = -Infinity;
  for (const other of ctx.entities) {
    if (!other.alive) continue;
    if (ctx.entitiesAllied(entity, other)) continue;
    // M8: Dogs ONLY target infantry (C++ techno.cpp:2017-2026 — THREAT_INFANTRY)
    if (isDog && !other.stats.isInfantry) continue;
    // Naval combat target filtering
    if (!canTargetNaval(entity, other)) continue;
    // Air combat target filtering: ground units without AA weapons skip aircraft
    if (other.isAirUnit && other.flightAltitude > 0) {
      const hasAA = entity.weapon?.isAntiAir || entity.weapon2?.isAntiAir;
      if (!hasAA) continue;
    }
    const dist = worldDist(entity.pos, other.pos);
    if (dist >= scanRange) continue;
    // Check line of sight — can't target through walls (aircraft skip LOS check)
    if (!(other.isAirUnit && other.flightAltitude > 0)) {
      const oc = other.cell;
      if (!ctx.map.hasLineOfSight(ec.cx, ec.cy, oc.cx, oc.cy)) continue;
    }

    const score = ctx.threatScore(entity, other, dist);
    if (score > bestScore) {
      bestTarget = other; bestScore = score;
    }
  }
  if (bestTarget) {
    entity.mission = Mission.ATTACK;
    entity.target = bestTarget;
    return;
  }

  // M4: No mobile targets — check for enemy structures in range (C++ Target_Something_Nearby includes buildings)
  if (!isDog && entity.weapon) {
    let bestStruct: MapStructure | null = null;
    let bestStructDist = scanRange;
    for (const s of ctx.structures) {
      if (!s.alive) continue;
      if (s.house === House.Neutral) continue;
      if (ctx.isAllied(entity.house, s.house)) continue;
      const sPos = { x: s.cx * CELL_SIZE + CELL_SIZE, y: s.cy * CELL_SIZE + CELL_SIZE };
      const dist = worldDist(entity.pos, sPos);
      if (dist < bestStructDist) {
        bestStructDist = dist;
        bestStruct = s;
      }
    }
    if (bestStruct) {
      entity.mission = Mission.ATTACK;
      entity.targetStructure = bestStruct;
    }
  }
}

/** Area Guard — defend spawn area, attack nearby enemies but return if straying too far */
export function updateAreaGuard(ctx: MissionAIContext, entity: Entity): void {
  entity.animState = AnimState.IDLE;
  // A3: Type-specific scan delays (C++ foot.cpp:589-612)
  const areaGuardScanDelay = entity.stats.scanDelay ?? 15;
  if (ctx.tick - entity.lastGuardScan < areaGuardScanDelay) return;
  entity.lastGuardScan = ctx.tick;

  const origin = entity.guardOrigin ?? entity.pos;
  // A5: Scan from home position (C++ foot.cpp:967 — temporarily swaps coords)
  // Use origin position for distance checks so guards defend their post, not where they wandered
  const scanPos = origin;
  const scanCell = worldToCell(scanPos.x, scanPos.y);
  // AG1: C++ foot.cpp:996-1001 — leash = Threat_Range(1)/2 = weapon.range/2 from origin
  const weaponRange = entity.weapon?.range ?? entity.stats.sight;
  const leashRange = weaponRange / 2;
  const scanRange = Math.max(leashRange, entity.stats.sight);

  // If too far from origin (> leash range), return home — but still attack enemies en route
  const distFromOrigin = worldDist(entity.pos, origin);
  const ec = entity.cell;
  if (distFromOrigin > leashRange) {
    // Check for enemies while returning
    for (const other of ctx.entities) {
      if (!other.alive || ctx.entitiesAllied(entity, other)) continue;
      const dist = worldDist(entity.pos, other.pos);
      if (dist > entity.stats.sight) continue;
      const oc2 = other.cell;
      if (!ctx.map.hasLineOfSight(ec.cx, ec.cy, oc2.cx, oc2.cy)) continue;
      // Found an enemy — attack it
      entity.mission = Mission.ATTACK;
      entity.target = other;
      entity.animState = AnimState.WALK;
      return;
    }
    // AG1: Return home but stay in AREA_GUARD (C++ Assign_Destination, not Assign_Mission)
    entity.moveTarget = { x: origin.x, y: origin.y };
    entity.target = null;
    entity.targetStructure = null;
    entity.path = findPath(ctx.map, ec, worldToCell(origin.x, origin.y), true, entity.isNavalUnit, entity.stats.speedClass);
    entity.pathIndex = 0;
    entity.animState = AnimState.WALK;
    return;
  }

  // If moving back toward origin, continue moving
  if (entity.moveTarget) {
    const distToMove = worldDist(entity.pos, entity.moveTarget);
    if (distToMove > 1.0) {
      entity.animState = AnimState.WALK;
      entity.moveToward(entity.moveTarget, ctx.movementSpeed(entity));
      return;
    }
    entity.moveTarget = null;
    entity.path = [];
  }

  // A5: Look for enemies within scan range from HOME position (C++ foot.cpp:967)
  let bestTarget: Entity | null = null;
  let bestScore = -Infinity;
  for (const other of ctx.entities) {
    if (!other.alive || ctx.entitiesAllied(entity, other)) continue;
    // A5: Use scanPos (home) for distance check, not entity's current position
    const dist = worldDist(scanPos, other.pos);
    if (dist > scanRange) continue;
    const oc = other.cell;
    if (!ctx.map.hasLineOfSight(scanCell.cx, scanCell.cy, oc.cx, oc.cy)) continue;
    const score = ctx.threatScore(entity, other, dist);
    if (score > bestScore) { bestScore = score; bestTarget = other; }
  }

  if (bestTarget) {
    entity.mission = Mission.ATTACK;
    entity.target = bestTarget;
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
  entity.moveTarget = { x: tx * CELL_SIZE + CELL_SIZE / 2, y: ty * CELL_SIZE + CELL_SIZE / 2 };
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
  transport.moveTarget = { x: tx * CELL_SIZE + CELL_SIZE / 2, y: ty * CELL_SIZE + CELL_SIZE / 2 };
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
  const scanDelay = entity.stats.scanDelay ?? 15;
  if (ctx.tick - entity.lastGuardScan < scanDelay) return;
  entity.lastGuardScan = ctx.tick;
  const ec = entity.cell;
  for (const other of ctx.entities) {
    if (!other.alive || ctx.entitiesAllied(entity, other)) continue;
    if (worldDist(entity.pos, other.pos) > entity.stats.sight) continue;
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
  let bestPos: WorldPos | null = null;
  for (const s of ctx.structures) {
    if (!s.alive || s.type !== 'FIX') continue;
    if (!ctx.isAllied(s.house, entity.house)) continue;
    const sp: WorldPos = { x: s.cx * CELL_SIZE + CELL_SIZE, y: s.cy * CELL_SIZE + CELL_SIZE };
    const d = worldDist(entity.pos, sp);
    if (d < bestDist) { bestDist = d; bestPos = sp; }
  }
  if (bestPos) {
    entity.moveTarget = bestPos;
    entity.path = findPath(ctx.map, entity.cell, worldToCell(bestPos.x, bestPos.y), true, entity.isNavalUnit, entity.stats.speedClass);
    entity.pathIndex = 0;
  } else {
    // No depot found — fall back to guard
    entity.mission = Mission.GUARD;
  }
}

/** Attack a structure (building) — engineers capture instead */
export function updateAttackStructure(ctx: MissionAIContext, entity: Entity, s: MapStructure): void {
  const structPos: WorldPos = {
    x: s.cx * CELL_SIZE + CELL_SIZE,
    y: s.cy * CELL_SIZE + CELL_SIZE,
  };
  const dist = worldDist(entity.pos, structPos);
  const range = entity.weapon?.range ?? 2;

  // Minimum range check: artillery can't fire at point-blank structures
  if (entity.weapon?.minRange && dist < entity.weapon.minRange) {
    ctx.retreatFromTarget(entity, structPos);
    return;
  }

  if (dist <= range) {
    // Engineer capture/damage (C++ infantry.cpp:618 — capture requires ConditionRed)
    if (entity.type === UnitType.I_E6 && entity.isPlayerUnit) {
      // EN1: Friendly repair — engineer heals to FULL HP (C++ Renovate() behavior)
      if (ctx.isAllied(s.house, ctx.playerHouse) && s.hp < s.maxHp) {
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
      if (s.hp / s.maxHp <= CONDITION_RED) {
        // Capture: building at red health — convert to player
        s.house = ctx.playerHouse;
        s.hp = s.maxHp;
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
        const ox = (Math.random() - 0.5) * 20;
        const oy = (Math.random() - 0.5) * 20;
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
    entity.tickRotation();
    if (entity.stats.noMovingFire && entity.facing !== entity.desiredFacing) {
      entity.animState = AnimState.IDLE;
      return;
    }
    entity.animState = AnimState.ATTACK;
    if (entity.attackCooldown <= 0 && entity.weapon) {
      // C++ parity: use warhead-vs-armor lookup (structures have 'concrete' armor)
      const wh = entity.weapon.warhead as WarheadType;
      const mult = ctx.getWarheadMult(wh, 'concrete');
      const structHouseBias = ctx.getFirepowerBias(entity.house);
      const damage = mult <= 0 ? 0 : Math.max(1, Math.round(entity.weapon.damage * mult * structHouseBias));
      const destroyed = ctx.damageStructure(s, damage);
      entity.attackCooldown = entity.weapon.rof;
      if (entity.hasTurret) entity.isInRecoilState = true; // M6
      // Ground unit ammo consumption (C++ parity: V2RL fires once, civilians fire 10x)
      if (entity.ammo > 0) entity.ammo--;
      ctx.playSoundAt(ctx.weaponSound(entity.weapon.name), entity.pos.x, entity.pos.y);
      // Muzzle + impact effects (color by warhead — C++ parity)
      ctx.effects.push({
        type: 'muzzle', x: entity.pos.x, y: entity.pos.y,
        frame: 0, maxFrames: 4, size: 5, sprite: 'piff', spriteStart: 0,
        muzzleColor: ctx.warheadMuzzleColor(entity.weapon.warhead),
      } as Effect);
      // R8: Impact explosion sprite from warhead's explosionSet (C++ warhead.cpp)
      const structImpactSprite = ctx.getWarheadProps(entity.weapon.warhead)?.explosionSet ?? 'veh-hit1';
      ctx.effects.push({
        type: 'explosion', x: structPos.x, y: structPos.y,
        frame: 0, maxFrames: EXPLOSION_FRAMES[structImpactSprite] ?? 17, size: 8,
        sprite: structImpactSprite, spriteStart: 0,
      } as Effect);
      if (destroyed) {
        if (ctx.isPlayerControlled(entity)) ctx.killCount++;
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
    entity.moveToward(structPos, ctx.movementSpeed(entity));
  }
  if (entity.attackCooldown > 0) entity.attackCooldown--;
  if (entity.attackCooldown2 > 0) entity.attackCooldown2--;
}

/** Force-fire on ground — fire at a location with no target entity */
export function updateForceFireGround(ctx: MissionAIContext, entity: Entity): void {
  const target = entity.forceFirePos!;
  const dist = worldDist(entity.pos, target);
  const range = entity.weapon?.range ?? 2;

  if (dist <= range) {
    entity.desiredFacing = directionTo(entity.pos, target);
    const facingReady = entity.tickRotation();
    if (entity.stats.noMovingFire && !facingReady) {
      entity.animState = AnimState.IDLE;
      return;
    }
    entity.animState = AnimState.ATTACK;

    if (entity.attackCooldown <= 0 && entity.weapon) {
      entity.attackCooldown = entity.weapon.rof;
      if (entity.hasTurret) entity.isInRecoilState = true; // M6
      // Ground unit ammo consumption (C++ parity: V2RL fires once, civilians fire 10x)
      if (entity.ammo > 0) entity.ammo--;

      // Apply scatter
      let impactX = target.x;
      let impactY = target.y;
      if (entity.weapon.inaccuracy && entity.weapon.inaccuracy > 0) {
        const scatter = entity.weapon.inaccuracy * CELL_SIZE;
        const angle = Math.random() * Math.PI * 2;
        const d = Math.random() * scatter;
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
      // Per-weapon projectile speed: compute travel frames from distance and projSpeed
      const ffDistPx = Math.sqrt((impactX - sx) ** 2 + (impactY - sy) ** 2);
      const travelFrames = calcProjectileTravelFrames(ffDistPx, entity.weapon.projSpeed);
      ctx.effects.push({
        type: 'projectile', x: sx, y: sy, frame: 0, maxFrames: travelFrames, size: 3,
        startX: sx, startY: sy, endX: impactX, endY: impactY, projStyle,
      } as Effect);
      // R8: Impact explosion sprite from warhead's explosionSet (C++ warhead.cpp)
      const ffImpactSprite = ctx.getWarheadProps(entity.weapon.warhead)?.explosionSet ?? 'veh-hit1';
      ctx.effects.push({
        type: 'explosion', x: impactX, y: impactY,
        frame: 0, maxFrames: EXPLOSION_FRAMES[ffImpactSprite] ?? 17, size: 8, sprite: ffImpactSprite, spriteStart: 0,
      } as Effect);
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
    entity.moveToward(target, ctx.movementSpeed(entity));
  }
  if (entity.attackCooldown > 0) entity.attackCooldown--;
  if (entity.attackCooldown2 > 0) entity.attackCooldown2--;
}
