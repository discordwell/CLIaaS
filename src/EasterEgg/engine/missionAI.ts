/**
 * Mission AI subsystem — unit-level mission state machines for ATTACK, HUNT,
 * GUARD, AREA_GUARD, RETREAT, AMBUSH, REPAIR, and force-fire behaviors.
 * Extracted from Game class (index.ts) to isolate mission-level AI logic.
 */

import {
  type WorldPos, type WeaponStats, type ArmorType,
  type WarheadType, type WarheadMeta, type WarheadProps,
  CELL_SIZE, LEPTON_SIZE,
  House, Mission, AnimState, UnitType, Stance, MISSION_CONTROL,
  leptonDist, pixelToLepton, directionTo, worldToCell, DIR_DX, DIR_DY,
  EXPLOSION_FRAMES, CONDITION_RED,
  calcProjectileTravelFrames, modifyDamage, projectileVisualConfig,
} from './types';
import { Entity, CloakState, CLOAK_TRANSITION_FRAMES } from './entity';
import { type MapStructure, CAPTURABLE_BUILDINGS, STRUCTURE_WEAPONS, STRUCTURE_SIZE } from './scenario';
import { type Effect } from './renderer';
import { type GameMap, Terrain } from './map';
import { findPath } from './pathfinding';
import { canTargetNaval } from './aircraft';
import { combatAnim } from './combat';
import { ScenarioRandom } from './random';

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
  /** C++ InfantryClass::Start_Driver — find sub-cell, atomic occupy-bit swap */
  infantryStartDriver(entity: Entity, destCX: number, destCY: number): { lx: number; ly: number };
  /** C++ Movement_AI:3810 — validate next path cell, re-path if blocked */
  infantryValidatePath(entity: Entity): void;

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
  }): void;
  launchProjectile(
    attacker: Entity, target: Entity | null, weapon: WeaponStats,
    damage: number, impactX: number, impactY: number, directHit: boolean,
  ): void;
  /** Queue a Coord_Scatter RNG for NEXT tick. C++ BulletClass::AI creates the
   *  invisible bullet at target coord on fire tick, then Bullet_Explodes fires
   *  Coord_Scatter on the NEXT AI tick via Fuse_Checkup. TS's instant-damage path
   *  otherwise consumes the RNG at fire time — 1+ ticks too early. */
  deferInvisibleScatter(): void;
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

  // Per-house fog-of-war — C++ techno.cpp:1467+ Evaluate_Object checks Is_Discovered_By_House
  isRevealedToHouse(cx: number, cy: number, houseIdx: number): boolean;
}

/** Per-house index mapping — mirrors Game.HOUSE_TO_INDEX for fog-of-war checks.
 *  C++ techno.cpp:1467+ Evaluate_Object checks Is_Discovered_By_House. */
const _HOUSE_IDX: Record<string, number> = {
  [House.Spain]: 0, [House.Greece]: 1, [House.USSR]: 2,
  [House.England]: 3, [House.Ukraine]: 4, [House.Germany]: 5,
  [House.France]: 6, [House.Turkey]: 7,
  [House.GoodGuy]: 8, [House.BadGuy]: 9, [House.Neutral]: 10,
};

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
    // C++ infantry.cpp:3671-3677 — if !Target_Legal, clear IsFiring. Drop the
    // pre-fire animation state so the next target acquisition restarts the gate.
    entity.firePrepActive = false;
    entity.firePrepStage = 0;
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
    // Check line of sight — can't fire through walls/rocks
    const ec = entity.cell;
    const tc = entity.target.cell;
    if (!ctx.map.hasLineOfSight(ec.cx, ec.cy, tc.cx, tc.cy)) {
      // LOS blocked — move toward target to get clear shot.
      // Cooldown decrement handled at index.ts:3814 (per-tick, all entities).
      // C++ Firing_AI clears IsFiring when Target_Legal fails (infantry.cpp:3671);
      // moving out of fire conditions likewise aborts the pre-fire animation.
      entity.firePrepActive = false;
      entity.firePrepStage = 0;
      entity.animState = AnimState.WALK;
      entity.moveToward({ lx: entity.target.leptonX, ly: entity.target.leptonY }, ctx.movementSpeed(entity));
      return;
    }

    // Turreted vehicles: turret tracks target, body may stay still
    let turretFacingReady = true;
    if (entity.hasTurret) {
      entity.desiredTurretFacing = directionTo(entity.pos, entity.target.pos);
      turretFacingReady = entity.tickTurretRotation();
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

    // Dual-weapon selection (C++ TechnoClass::Fire_At / Can_Fire):
    // Select the best weapon based on target armor effectiveness and cooldown state.
    // Only one weapon fires per tick — they alternate based on cooldowns and effectiveness.
    const selectedWeapon = entity.selectWeapon(
      entity.target, (wh, ar) => ctx.getWarheadMult(wh, ar),
    );

    // If a burst is in progress, continue with the primary weapon (burst belongs to primary)
    const activeWeapon = entity.burstCount > 0 ? entity.weapon : selectedWeapon;
    const isSecondary = activeWeapon === entity.weapon2;

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
    // Turreted vehicles must have turret within 8/256 (≈11°) of target direction before
    // firing. Non-homing projectiles (Bullet->ROT == 0) block fire while IsRotating.
    // Homing projectiles skip the gate (diff >>= 2 tolerance).
    // Without this gate, TS vehicles fire the moment they acquire a target via
    // Mission_Guard scan, consuming an invisible-bullet Coord_Scatter RNG
    // (bullet.cpp:1012-1014) one or more ticks ahead of WASM.
    // SCG01EA tick 87: Greek JEEP#27 (63,50) and JEEP#30 (64,50) acquire DOG/E1
    // targets from Mission_Guard scan; WASM waits one tick for turret to face,
    // TS fires same-tick. 2 extra Coord_Scatter RNG calls tagged `aircraft[51]`
    // (source_tag leak from aircraft loop → pendingInvisibleScatters flush).
    if (entity.hasTurret && activeWeapon && !turretFacingReady) {
      // C++ checks weapon->Bullet->ROT (projectile rotation rate). Homing
      // projectiles (ROT != 0) bypass facing requirement; non-homing must face.
      const projROT = (activeWeapon.projectileROT ?? 0) as number;
      if (projROT === 0) {
        return;
      }
    }

    if (activeWeapon && ((isSecondary ? entity.attackCooldown2 : entity.attackCooldown) <= 0)) {
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
      if (entity.stats.isInfantry && !isSecondary) {
        const fireLaunch = infantryFireLaunch(entity.type);
        if (!entity.firePrepActive) {
          // C++ !IsFiring case: start firing animation. No bullet launch this tick
          // (unless FireLaunch==0 — Einstein and unarmed types).
          entity.firePrepActive = true;
          entity.firePrepStage = 0;
        }
        if (entity.firePrepStage < fireLaunch) {
          // Stage not yet at FireLaunch — keep the fire animation running, but do
          // NOT launch the bullet / consume Coord_Scatter RNG / set Arm yet.
          entity.animState = AnimState.ATTACK;
          return;
        }
        // Stage reached FireLaunch — reset prep state and fall through to Fire_At.
        entity.firePrepActive = false;
        entity.firePrepStage = 0;
      }

      // C1: Set burst count for multi-shot weapons (e.g. MammothTusk burst: 2)
      const burst = activeWeapon.burst ?? 1;
      if (entity.burstCount > 0) {
        // Continuing burst — decrement
        entity.burstCount--;
        entity.burstDelay = 3; // 3 ticks between burst shots (C++ standard)
      } else {
        // CF12: IsSecondShot cadence for dual-weapon units (C++ techno.cpp:2857-2870)
        // First shot: 3-tick rearm (quick follow-up). Second shot: full ROF (reload delay).
        // C++ house.cpp:293,303: ROFBias scales rearm delay (techno.cpp Rearm_Delay)
        const isDualWeapon = entity.weapon && entity.weapon2;
        const rofBias = ctx.getROFBias(entity.house);
        let rearmTime = Math.max(1, Math.round(activeWeapon.rof * rofBias));
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

      // C++ bullet.cpp:709 scatter condition:
      //   (IsInaccurate || Class->IsInaccurate ||
      //    ((Is_Target_Cell(TarCom) || Is_Target_Infantry(TarCom)) &&
      //     (Warhead == WARHEAD_AP || Class->IsFueled)))
      //
      // C++ BUG (bbdata.cpp:286): reads "Inaccuate" from INI — ALWAYS misses the
      // "Inaccurate=" rules.ini field. So Class->IsInaccurate is effectively
      // always false. Only the moving-platform IsInaccurate (techno.cpp:3107) and
      // the AP/Fueled vs infantry/cell branch ever trigger scatter.
      let impactX = entity.target.pos.x;
      let impactY = entity.target.pos.y;
      let directHit = true;
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
        const distLeptons = leptonDist(entity.leptonX, entity.leptonY, entity.target.leptonX, entity.target.leptonY);
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
            entity.target.pos.y - entity.pos.y,
            entity.target.pos.x - entity.pos.x,
          );
          impactX += Math.cos(firingAngle) * distPx;
          impactY += Math.sin(firingAngle) * distPx;
        }
        // Check if scattered shot still hits the target (within half-cell)
        const dx = impactX - entity.target.pos.x;
        const dy = impactY - entity.target.pos.y;
        directHit = Math.sqrt(dx * dx + dy * dy) < CELL_SIZE * 0.6;
      }

      // CF7: Heal guard — negative damage weapons must pass proximity and armor checks (C++ combat.cpp:86-96)
      if (activeWeapon.damage < 0) {
        const healDist = leptonDist(entity.leptonX, entity.leptonY, entity.target.leptonX, entity.target.leptonY);
        const HEAL_PROXIMITY = 192; // 0.75 cells * 256 leptons/cell
        if (activeWeapon.warhead === 'Mechanical') {
          // GoodWrench/Mechanic: only heals armored targets (armor !== 'none') within 0.75 cells
          if (healDist >= HEAL_PROXIMITY || entity.target.stats.armor === 'none') return;
        } else {
          // Heal warhead (Organic): only heals unarmored targets (armor === 'none') within 0.75 cells
          if (healDist >= HEAL_PROXIMITY || entity.target.stats.armor !== 'none') return;
        }
        // Apply healing directly — modifyDamage clamps negative values to 0
        const healAmount = Math.abs(activeWeapon.damage);
        entity.target.hp = Math.min(entity.target.maxHp, entity.target.hp + healAmount);
        return;
      }

      // C++ Modify_Damage (combat.cpp:72-129) — single-application sanity check:
      // "can this weapon damage this target at distance 0?" Used solely as a gate
      // for the dual-weapon fallback and the target-clear branch. The actual damage
      // applied at impact is computed inside applySplashDamage / damageEntity.
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
        // C++ bullet.cpp:478 — bullet strength at firing time = weapon.damage * FirepowerBias.
        // Warhead-vs-armor and distance falloff are applied ONCE on arrival via
        // applySplashDamage → modifyDamage (combat.cpp:106-125, 207). Passing already-modified
        // damage here would double-apply the warhead-vs-armor multiplier.
        const projStrength = Math.max(1, Math.round(activeWeapon.damage * houseBias));
        ctx.launchProjectile(entity, entity.target, activeWeapon, projStrength, impactX, impactY, directHit);
      } else {
        // C++ bullet.cpp:736-738 + 1012-1014 — invisible weapons (Speed=100 →
        // MPH_LIGHT_SPEED) are constructed AT the target coord (Coord = tcoord)
        // and Arm_Fuse'd with proximity 0. logic.cpp:285 re-evaluates Count()
        // each iteration, so the Submit'd bullet (at high Logic idx) gets its
        // AI call inside the SAME tick as the fire: Fuse_Checkup returns true
        // (distance=0 < 0x10) → Bullet_Explodes → Coord_Scatter.
        // Net: the scatter Random_Pick(0,255) fires on the SAME tick as the
        // firing entity, but AFTER all lower-idx entities have been processed.
        // Defer so the flush (end of entity-AI phase in Game.update()) matches
        // WASM's end-of-Logic-loop position.
        if (activeWeapon.isInvisible) {
          ctx.deferInvisibleScatter();
        }

        // Instant damage (melee, hitscan weapons).
        // C++ infantry.cpp:438-440 — Scatter fires exactly once per damage event
        // inside InfantryClass::Take_Damage. The scatter RNG is consumed inside
        // ctx.damageEntity() → damageEntity() → aiScatterOnDamage() (combat.ts).
        // Retaliation also runs inside damageEntity (unified C++ FootClass::Take_Damage
        // entry point — foot.cpp:1166-1234).
        const killed = directHit ? ctx.damageEntity(entity.target, damage, activeWeapon.warhead, entity) : false;

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
        const impactSprite = combatAnim(activeWeapon.damage, impactExpSet, impactLand) ?? 'veh-hit1';
        ctx.effects.push({ type: 'explosion', x: impactX, y: impactY, frame: 0,
          maxFrames: EXPLOSION_FRAMES[impactSprite] ?? 17, size: 8,
          sprite: impactSprite, spriteStart: 0 } as Effect);
      }

    }
  } else {
    // Out of range — target must be chased. Drop any pre-fire animation state
    // (C++ Firing_AI only runs when in range; moving breaks the fire gate).
    entity.firePrepActive = false;
    entity.firePrepStage = 0;
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

/** Hunt mode — move toward target and attack (C++ foot.cpp:654-703)
 *  Actively calls Target_Something_Nearby when target is null or dead. */
export function updateHunt(ctx: MissionAIContext, entity: Entity): void {
  // Called only when missionTimer fires (gated by caller in index.ts).
  // C++ foot.cpp:654-702: Mission_Hunt scans for targets.
  if (!entity.target?.alive) {
    entity.target = null;

    // C++ foot.cpp:657 — Mission_Hunt uses Target_Something_Nearby(THREAT_NORMAL).
    // THREAT_NORMAL = 0 → Threat_Range(-1) = unlimited range (entire map scan).
    // Note: foot.cpp:501 (Mission_MOVE) uses THREAT_RANGE, but HUNT uses THREAT_NORMAL.
    const huntRange = Infinity; // C++ parity: THREAT_NORMAL = no range limit
    const ec = entity.cell;
    // C++ parity: player units use the player's fog (effectively everything visible
    // when fogDisabled=true in agent harness). Only AI houses use per-house fog.
    const huntHouseIdx = entity.isPlayerUnit ? -1 : (_HOUSE_IDX[entity.house] ?? -1);
    let bestTarget: Entity | null = null;
    let bestScore = -Infinity;
    for (const other of ctx.entities) {
      if (!other.alive || other.inLimbo || ctx.entitiesAllied(entity, other)) continue;
      if (!canTargetNaval(entity, other)) continue;
      // C++ parity: spies are INVISIBLE to all non-dog units (techno.cpp:1554-1564)
      if (other.type === UnitType.I_SPY && entity.type !== UnitType.I_DOG) continue;
      // C++ techno.cpp:1476-1479: units on IsNoThreat missions are invisible to hunt scan
      if (MISSION_CONTROL[other.mission]?.isNoThreat) continue;
      // C++ techno.cpp:1467-1470: fully cloaked units cannot be auto-targeted
      if (other.cloakState === CloakState.CLOAKED) continue;
      // C++ techno.cpp:1467+ Is_Discovered_By_House — per-house fog check
      // C++ techno.cpp:1529: player-owned entities always visible (bypass fog check)
      if (huntHouseIdx >= 0 && !other.isPlayerUnit && !ctx.isRevealedToHouse(other.cell.cx, other.cell.cy, huntHouseIdx)) continue;
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
        // C++ parity: BARL/BRL3 are OverlayClass, not BuildingClass — never auto-targeted.
        if (s.type === 'BARL' || s.type === 'BRL3') continue;
        // Structure center in leptons: cell * 256 + 256 (for 2x2 buildings, center offset by 1 cell)
        const sLX = s.cx * LEPTON_SIZE + LEPTON_SIZE;
        const sLY = s.cy * LEPTON_SIZE + LEPTON_SIZE;
        const dist = leptonDist(entity.leptonX, entity.leptonY, sLX, sLY);
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
      // C++ foot.cpp:688 — Random_Animate when no target found (on scan tick)
      if (entity.isReadyToRandomAnimate()) {
        // C++ infantry.cpp:1748: IdleTimer = Random_Pick(RandomAnimateTime * TICKS_PER_MINUTE/2, RandomAnimateTime * TICKS_PER_MINUTE*2)
        // rules.ini IdleActionFrequency=.1 → fixed(.1)=25/256. C++ fixed*int: ((25*450)+128)/256=44, ((25*1800)+128)/256=176
        entity.idleAnimTimer = ScenarioRandom.nextInRange(44, 176);
        const animPick = ScenarioRandom.nextInRange(0, 10);
        if (animPick >= 6) ScenarioRandom.nextInRange(0, 7);
        entity.doing = 'idle_anim';
      }
      return;
    }
  }

  // C++ Mission_Hunt: only scans for targets and switches to ATTACK if in range.
  // Does NOT move the infantry — movement happens in the per-tick AI loop (Approach_Target).
  // Moving here would give an extra movement tick on the scan tick.
  if (entity.inRange(entity.target)) {
    entity.mission = Mission.ATTACK;
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
  // TS medics are dispatched via updateMedic before the guard scan, so their
  // scan target here is enemy infantry (C++ equivalent behavior).
  if (entity.type === UnitType.I_MEDI) return RTTI.INFANTRY;

  // Mechanic (FIXIT_CSII, Combat_Damage < 0): method = THREAT_VEHICLES | THREAT_AIR.
  if (entity.type === UnitType.I_MECH) return RTTI.UNIT | RTTI.AIRCRAFT;

  // VesselClass::Greatest_Threat (vessel.cpp:1223-1256) — vessels have per-
  // type overrides that DIFFER from the weapon-OR path used by UnitClass/
  // InfantryClass. However, the Mission_Guard scan for vessels is NOT gated
  // here in the same way — VesselClass::Combat_AI (vessel.cpp:2208-2243) only
  // fires on an EXISTING TarCom, and vessel TarCom acquisition happens via
  // team attack missions, retaliation, or explicit orders rather than same-
  // tick Mission_Guard scans. Empirical (SCG07EA tick 1): enabling vessel
  // scans here introduces +12 RNG calls that WASM doesn't consume at tick 1.
  // The WASM traces show vessels do not acquire Mission_Guard scan targets on
  // the first Mission_Guard tick in the same way infantry/vehicles do.
  //
  // Safer parity: return 0 (no-op scan) for vessels. They still react to
  // retaliation (existing entity.target path) and to explicit team orders.
  if (entity.isNavalUnit) return 0;

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
  ctx: MissionAIContext, entity: Entity, scanRange: number, rttiMask: number,
): Entity | null {
  // C++ techno.cpp:2048-2053: crange = weapon range in cells + 1
  // scanRange is in cells; convert to cell scan radius and lepton threshold
  const crange = Math.floor(scanRange) + 1;
  const scanRangeLeptons = scanRange * LEPTON_SIZE;
  if (crange <= 0) return null;

  // C++ techno.cpp:2055: CELL cell = Coord_Cell(Fire_Coord(0))
  // Fire_Coord has weapon offsets from Center_Coord, but for infantry/units the offset
  // is typically small. Use entity.cell (derived from lepton coords) as approximation.
  const cellX = entity.cell.cx;
  const cellY = entity.cell.cy;

  // Map bounds for clipping
  const mapX = ctx.map.boundsX;
  const mapY = ctx.map.boundsY;
  const mapW = ctx.map.boundsW;
  const mapH = ctx.map.boundsH;

  // Build cell→entity lookup: for each cell, store the LAST non-allied enemy techno.
  //
  // C++ Evaluate_Cell (techno.cpp:1831-1843) traverses the Cell_Occupier() linked list
  // and picks the FIRST non-allied techno (break on first match). The occupier list is
  // LIFO — Occupy_Up (cell.cpp:1189) prepends: object->Next = OccupierPtr; OccupierPtr = object.
  // So the FIRST in the LIFO chain is the MOST RECENTLY unlimboed entity in that cell.
  //
  // ctx.entities is in INI/unlimbo order (oldest first). To match C++'s "most recently
  // unlimboed" selection, we always overwrite — the LAST entity per cell in our forward
  // iteration is the one that would be at the HEAD of C++'s LIFO occupier chain.
  const cellMap = new Map<number, Entity>();
  const cellKey = (cx: number, cy: number) => cy * 128 + cx;
  // C++ techno.cpp:624,3781 — IsOwnedByPlayer is STRICTLY (PlayerPtr == House),
  // true only for the player's direct house, NOT player-allied houses. Using
  // entity.isPlayerUnit here (which covers Greece + allied England) makes allied
  // scanners bypass fog filtering that C++ enforces on non-PlayerPtr houses.
  // SCG07EA tick 1: England JEEP (player-allied) was scanning through fog and
  // finding USSR targets that C++'s Evaluate_Object rejects (!IsOwnedByPlayer &&
  // !IsDiscoveredByPlayer at techno.cpp:1529). Fix: use strict PlayerPtr match.
  const isStrictPlayer = entity.house === ctx.playerHouse;
  const guardHouseIdx = isStrictPlayer ? -1 : (_HOUSE_IDX[entity.house] ?? -1);
  const isDog = entity.type === UnitType.I_DOG;
  for (const other of ctx.entities) {
    if (!other.alive || other.inLimbo) continue;
    if (ctx.entitiesAllied(entity, other)) continue;
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
    // C++ techno.cpp:1529: IsOwnedByPlayer bypass is STRICT PlayerPtr-match only
    // (see SCG07EA fix in updateAreaGuard — same rationale applies here).
    if (guardHouseIdx >= 0 && other.house !== ctx.playerHouse && !ctx.isRevealedToHouse(other.cell.cx, other.cell.cy, guardHouseIdx)) continue;
    // Naval combat filtering
    if (!canTargetNaval(entity, other)) continue;
    // Air combat filtering: airborne aircraft require AA weapon. Already covered
    // by rttiMask (AIRCRAFT bit only set when isAntiAir), but keep explicit guard
    // for the landed-aircraft-as-UNIT case where mask has AIRCRAFT via UNIT set.
    if (other.isAirUnit && other.flightAltitude > 0) {
      const hasAA = entity.weapon?.isAntiAir || entity.weapon2?.isAntiAir;
      if (!hasAA) continue;
    }
    const oc = other.cell;
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
          // C++ Evaluate_Object range check: when range==0 (THREAT_RANGE), use In_Range
          // In_Range: Distance(Fire_Coord(which), target->Center_Coord()) <= Weapon_Range(which)
          const dist = leptonDist(entity.leptonX, entity.leptonY, ent.leptonX, ent.leptonY);
          if (dist <= scanRangeLeptons) {
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
            const dist = leptonDist(entity.leptonX, entity.leptonY, ent.leptonX, ent.leptonY);
            if (dist <= scanRangeLeptons) {
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
          const dist = leptonDist(entity.leptonX, entity.leptonY, ent.leptonX, ent.leptonY);
          if (dist <= scanRangeLeptons) {
            bestObject = ent;
          }
        }
      }

      // Right column: x = cellX + radius
      const rightX = cellX + radius;
      if (rightX >= mapX && rightX < mapX + mapW) {
        const ent = cellMap.get(cellKey(rightX, cy));
        if (ent) {
          const dist = leptonDist(entity.leptonX, entity.leptonY, ent.leptonX, ent.leptonY);
          if (dist <= scanRangeLeptons) {
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
        return bestObject;
      }
    }
  }

  return bestObject;
}

/** Guard mode — attack nearby enemies or auto-heal (rate-limited to every 15 ticks) */
export function updateGuard(ctx: MissionAIContext, entity: Entity, timerFired = true): void {
  entity.animState = AnimState.IDLE;

  // Save guard origin when first entering guard stance (for return-after-chase)
  if (entity.isPlayerUnit && !entity.guardOrigin) {
    entity.guardOrigin = { x: entity.pos.x, y: entity.pos.y };
  }

  // C++ Mission_Guard does NOT have special medic handling — medics scan for enemies
  // and can fire like any other infantry. Medic heal is handled separately by Firing_AI
  // when the medic has a friendly injured target. Don't early-return for medics.
  // Mechanic heal is similar — don't skip guard scan.
  if (entity.type === UnitType.I_MEDI) {
    ctx.updateMedic(entity);
    // Fall through to guard scan — C++ parity: medics participate in enemy targeting
  }
  if (entity.type === UnitType.I_MECH) {
    ctx.updateMechanicUnit(entity);
    // Fall through to guard scan
  }

  // IdleTimer decremented in index.ts updateEntity (runs every tick for all missions)

  // Cooldowns are now ticked globally in index.ts (C++ TechnoClass::AI ticks Arm for ALL missions).

  // C++ unit.cpp:425 Firing_AI — runs EVERY tick, independent of guard scan timer.
  // If the entity has a target from a previous guard scan and weapon is ready, fire.
  // This is how C++ units continue shooting between 45-tick guard scan intervals.
  if (entity.target?.alive && entity.weapon && entity.attackCooldown <= 0) {
    if (entity.inRange(entity.target)) {
      // Temporarily switch to ATTACK for updateAttack's fire logic, then restore GUARD
      entity.mission = Mission.ATTACK;
      updateAttack(ctx, entity);
      if (entity.mission === Mission.ATTACK) {
        entity.mission = Mission.GUARD;
      }
      return; // fired this tick — skip scan
    } else {
      entity.target = null; // target moved out of range, clear for next scan
    }
  }

  // C++ MissionClass::Timer gates when Mission_Guard fires.
  // Timer and jitter are now handled by the caller (index.ts) via entity.missionTimer.
  // Only run the scan portion when the timer fires.
  if (!timerFired) return;

  // Civilians auto-flee nearby ants (SCA02EA evacuation behavior).
  // C++ parity: Mission_Guard doesn't early-return for civilians — after the
  // non-ant-threat scan fails, Random_Animate still fires (infantry.cpp:1748
  // IdleTimer pick + switch case). Only skip the cellBasedGuardScan weapon
  // target loop below (civilians have no Primary weapon and shouldn't auto-
  // target enemies). Found via SCG01EA tick 44: C8 England (Greek ally) skipped
  // Random_Animate here, missing 4 RNGs WASM fires. See infantry.cpp:1742-1838.
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
    // No ant threat — civilians don't auto-target enemies (skip cellBasedGuardScan
    // and structure scan), but STILL run Random_Animate like C++ Mission_Guard.
    civilianSkipScan = true;
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
  if (!spyPlayerSkipAutoTarget && entity.target?.alive && !entity.target.inLimbo) {
    // C++ techno.cpp:5260-5266: check if existing target still in range (THREAT_RANGE mode)
    if (entity.inRange(entity.target)) {
      // Target still valid and in range — C++ keeps TarCom, skips Greatest_Threat.
      // Fire via Firing_AI equivalent:
      if (entity.weapon && entity.attackCooldown <= 0) {
        entity.mission = Mission.ATTACK;
        updateAttack(ctx, entity);
        if (entity.mission === Mission.ATTACK) {
          entity.mission = Mission.GUARD;
        }
      }
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
    // C++ infantry.cpp:1237 / unit.cpp:425 — after MissionClass::AI dispatch
    // (Mission_Guard calls Target_Something_Nearby → Assign_Target), Firing_AI
    // runs SAME TICK and fires if target is in range with Arm=0. Mission stays
    // MISSION_GUARD (C++ Target_Something_Nearby never reassigns mission).
    // Without this same-tick fire, TS's top-of-updateGuard Firing_AI block
    // only fires on the NEXT tick, putting TS's scatter RNG 1 tick behind
    // WASM's (SCG03 tick 247 / SCG06 tick 64 after 9a334f4b's same-tick
    // scatter refactor). For infantry the FireLaunch gate in updateAttack
    // defers the actual bullet launch to tick N+FireLaunch; this call starts
    // the firing animation (firePrepActive) on the target-acquisition tick.
    entity.target = bestTarget;
    if (entity.weapon && entity.attackCooldown <= 0 && entity.inRange(bestTarget)) {
      // Temporarily switch to ATTACK so updateAttack's fire path runs, then
      // restore GUARD. C++ keeps Mission==GUARD throughout.
      entity.mission = Mission.ATTACK;
      updateAttack(ctx, entity);
      if ((entity.mission as Mission) === Mission.ATTACK) {
        entity.mission = Mission.GUARD;
      }
    }
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
    ScenarioRandom._sourceTag = 30002;
    const animPick = ScenarioRandom.nextInRange(0, 10);
    if (animPick >= 6) {
      ScenarioRandom._sourceTag = 30003;
      ScenarioRandom.nextInRange(0, 7); // C++ facing change: Random_Pick(FACING_N, FACING_NW)
    }
    ScenarioRandom._sourceTag = saved;
    // C++ MasterDoControls: gestures and salutes (cases 1-4) are NOT interruptible.
    // idata.cpp: DO_SALUTE1/2, DO_GESTURE1/2 = {Count:3, Rate:2} = 3*2=6 ticks.
    // +1 accounts for the C++ Commence→Mission_Move dispatch delay that TS's queue
    // promote doesn't naturally replicate (see team.ts activation niat=8).
    if (animPick >= 1 && animPick <= 4) {
      entity.nonInterruptAnimTicks = 7;
    }
    entity.doing = 'idle_anim';
  }
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
  const hadTargetAtEntry = !!(entity.target && entity.target.alive);

  const origin = entity.guardOrigin ?? entity.pos;
  const isDog = entity.type === UnitType.I_DOG;
  // A5: Scan from home position (C++ foot.cpp:967 — temporarily swaps coords)
  // Use origin position for distance checks so guards defend their post, not where they wandered
  const scanPos = origin;
  // AG1: C++ foot.cpp:996-1001 — leash = Threat_Range(1)/2
  // C++ techno.cpp:4573-4581: Threat_Range(1) = min(2*weaponRange, 0x0A00=10 cells)
  // C++ foot.cpp:996: leash = Threat_Range(1)/2 = min(weaponRange, 5)
  const weaponRange = entity.weapon?.range ?? entity.stats.sight;
  const threatRange1 = Math.min(2 * weaponRange, 10); // C++ Threat_Range(1) in cells
  const leashRange = threatRange1 / 2; // min(weaponRange, 5) — C++ foot.cpp:996
  // C++ Greatest_Threat with THREAT_AREA uses Threat_Range(1) as the scan radius
  // (passed as 'range' to Evaluate_Object, which checks dist > range).
  const scanRange = threatRange1;

  // If too far from origin (> leash range), return home — but still attack enemies en route
  const originLX = pixelToLepton(origin.x);
  const originLY = pixelToLepton(origin.y);
  const distFromOrigin = leptonDist(entity.leptonX, entity.leptonY, originLX, originLY);
  const ec = entity.cell;
  const areaGuardHouseIdx = entity.isPlayerUnit ? -1 : (_HOUSE_IDX[entity.house] ?? -1);
  if (distFromOrigin > leashRange * LEPTON_SIZE) {
    // Check for enemies while returning
    for (const other of ctx.entities) {
      if (!other.alive || other.inLimbo || ctx.entitiesAllied(entity, other)) continue;
      // C++ parity: spies invisible to non-dogs (techno.cpp:1554-1564)
      if (other.type === UnitType.I_SPY && !isDog) continue;
      // C++ techno.cpp:1476-1479: units on IsNoThreat missions are invisible
      if (MISSION_CONTROL[other.mission]?.isNoThreat) continue;
      // C++ techno.cpp:1467-1470: fully cloaked units cannot be auto-targeted
      if (other.cloakState === CloakState.CLOAKED) continue;
      // C++ techno.cpp:1529 Evaluate_Object: `!IsOwnedByPlayer && !IsDiscoveredByPlayer` rejects target.
      // `IsOwnedByPlayer = (PlayerPtr == House)` (techno.cpp:624) is STRICTLY the player's own house,
      // not player-allied. TS's `isPlayerUnit` covers all allied houses (_playerHouses set), which
      // made the bypass too permissive — SCG07EA tick 0 E4 USSR targeting England's JEEP that C++
      // filters (England != PlayerPtr=Greece, and not yet IsDiscoveredByPlayer at tick 0).
      if (areaGuardHouseIdx >= 0 && other.house !== ctx.playerHouse && !ctx.isRevealedToHouse(other.cell.cx, other.cell.cy, areaGuardHouseIdx)) continue;
      const dist = leptonDist(entity.leptonX, entity.leptonY, other.leptonX, other.leptonY);
      if (dist > entity.stats.sight * LEPTON_SIZE) continue;
      // C++ Evaluate_Object has no terrain LOS check — removed for parity.
      // Found an enemy — attack it
      entity.mission = Mission.ATTACK;
      entity.target = other;
      entity.animState = AnimState.WALK;
      return;
    }
    // AG1: Return home but stay in AREA_GUARD (C++ Assign_Destination, not Assign_Mission)
    entity.moveTarget = { lx: pixelToLepton(origin.x), ly: pixelToLepton(origin.y) };
    entity.target = null;
    entity.targetStructure = null;
    entity.path = findPath(ctx.map, ec, worldToCell(origin.x, origin.y), true, entity.isNavalUnit, entity.stats.speedClass);
    entity.pathIndex = 0;
    entity.animState = AnimState.WALK;
    return;
  }

  // If moving back toward origin, continue moving
  if (entity.moveTarget) {
    const distToMove = leptonDist(entity.leptonX, entity.leptonY, entity.moveTarget.lx, entity.moveTarget.ly);
    if (distToMove > 256) { // 1.0 cell in leptons
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
    if (!other.alive || other.inLimbo || ctx.entitiesAllied(entity, other)) continue;
    // C++ parity: spies invisible to non-dogs (techno.cpp:1554-1564)
    if (other.type === UnitType.I_SPY && !isDog) continue;
    // C++ techno.cpp:1476-1479: units on IsNoThreat missions are invisible
    if (MISSION_CONTROL[other.mission]?.isNoThreat) continue;
    // C++ techno.cpp:1467-1470: fully cloaked units cannot be auto-targeted
    if (other.cloakState === CloakState.CLOAKED) continue;
    // C++ techno.cpp:1529 Evaluate_Object: `!IsOwnedByPlayer && !IsDiscoveredByPlayer` rejects target.
    // IsOwnedByPlayer is STRICTLY `(PlayerPtr == House)` — see leash-scan block above for full
    // explanation of the SCG07EA tick 0 E4 USSR + England JEEP case this prevents.
    if (areaGuardHouseIdx >= 0 && other.house !== ctx.playerHouse && !ctx.isRevealedToHouse(other.cell.cx, other.cell.cy, areaGuardHouseIdx)) continue;
    // A5: Use scanPos (home) for distance check, not entity's current position
    const dist = leptonDist(originLX, originLY, other.leptonX, other.leptonY);
    if (dist > scanRange * LEPTON_SIZE) continue;
    // C++ Evaluate_Object has no terrain LOS check — removed for parity.
    const score = ctx.threatScore(entity, other, dist / LEPTON_SIZE);
    if (score > bestScore) { bestScore = score; bestTarget = other; }
  }

  if (bestTarget) {
    entity.target = bestTarget;
    // C++ foot.cpp:1036-1037: ONLY newly-acquired targets (scan just found one) return(1).
    // If TarCom was already legal at entry, C++ falls through to dtime+Random_Pick(1,5).
    if (!hadTargetAtEntry) {
      entity.missionTimer = 1;
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
      // C++ parity: stay AREA_GUARD, set target. Newly-acquired target uses timer=1.
      entity.targetStructure = bestStruct;
      if (!hadTargetAtEntry && !entity.targetStructure) {
        entity.missionTimer = 1;
      }
      return;
    }
  }

  // C++ foot.cpp:1011 — Random_Animate when no target found.
  // C++ Is_Ready_To_Random_Animate checks Doing != DO_STAND_GUARD/READY → blocks.
  // At tick 1: Doing = DO_NOTHING (set by constructor, Doing_AI hasn't run yet).
  // After tick 1: Doing_AI transitions to DO_STAND_READY → RA can run on future ticks.
  // TS doing='nothing' matches this — isReadyToRandomAnimate blocks at tick 1.
  if (entity.isReadyToRandomAnimate()) {
    entity.idleAnimTimer = ScenarioRandom.nextInRange(44, 176);
    const animPick = ScenarioRandom.nextInRange(0, 10);
    if (animPick >= 6) ScenarioRandom.nextInRange(0, 7);
    if (animPick >= 1 && animPick <= 4) {
      entity.nonInterruptAnimTicks = 8;
    }
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
  const structPos: WorldPos = {
    x: s.cx * CELL_SIZE + CELL_SIZE,
    y: s.cy * CELL_SIZE + CELL_SIZE,
  };
  // Structure center in leptons
  const structLX = s.cx * LEPTON_SIZE + LEPTON_SIZE;
  const structLY = s.cy * LEPTON_SIZE + LEPTON_SIZE;
  const dist = leptonDist(entity.leptonX, entity.leptonY, structLX, structLY);
  // C++ parity: spies infiltrate from adjacent cells (building edge), not center.
  // Buildings are 2x2 or 3x2 cells, so the edge can be 2-3 cells from center.
  // Unarmed units (spies, engineers) need range 4 to reach from adjacent cells.
  const range = entity.weapon?.range ?? 2;
  const rangeLeptons = range * LEPTON_SIZE;

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
      // Ground unit ammo consumption (C++ parity: V2RL fires once, civilians fire 10x)
      if (entity.ammo > 0) entity.ammo--;
      ctx.playSoundAt(ctx.weaponSound(entity.weapon.name), entity.pos.x, entity.pos.y);
      // Muzzle + impact effects (color by warhead — C++ parity)
      ctx.effects.push({
        type: 'muzzle', x: entity.pos.x, y: entity.pos.y,
        frame: 0, maxFrames: 4, size: 5, sprite: 'piff', spriteStart: 0,
        muzzleColor: ctx.warheadMuzzleColor(entity.weapon.warhead),
      } as Effect);
      // R8: Impact explosion sprite via C++ Combat_Anim — damage-scaled selection
      const structAttackExpSet = ctx.getWarheadProps(entity.weapon.warhead)?.explosionSet ?? 0;
      const structImpactSprite = combatAnim(entity.weapon.damage, structAttackExpSet, 'ground') ?? 'veh-hit1';
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
    const facingReady = entity.tickRotation();
    if (entity.stats.noMovingFire && !facingReady) {
      entity.animState = AnimState.IDLE;
      return;
    }
    entity.animState = AnimState.ATTACK;

    if (entity.attackCooldown <= 0 && entity.weapon) {
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
      // Ground unit ammo consumption (C++ parity: V2RL fires once, civilians fire 10x)
      if (entity.ammo > 0) entity.ammo--;

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
      const ffImpactSprite = combatAnim(entity.weapon.damage, ffExpSet, ffLand) ?? 'veh-hit1';
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
    entity.moveToward({ lx: pixelToLepton(target.x), ly: pixelToLepton(target.y) }, ctx.movementSpeed(entity));
  }
  // Cooldown decrement handled at index.ts:3814 (per-tick, all entities).
}
