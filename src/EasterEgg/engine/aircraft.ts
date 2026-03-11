/**
 * Aircraft state machine subsystem — takeoff, landing, attack runs, helicopter hover.
 * Extracted from Game class (index.ts) to isolate aircraft flight logic.
 */

import {
  type WorldPos, type WeaponStats,
  CELL_SIZE, Mission, AnimState, House, UnitType,
  worldDist, directionTo, worldToCell,
  CIVILIAN_UNIT_TYPES, COUNTRY_BONUSES,
} from './types';
import { Entity, CloakState } from './entity';
import { type MapStructure, STRUCTURE_SIZE } from './scenario';
import { type GameMap } from './map';

// ── Interfaces ─────────────────────────────────────────────────────────────────

/** Context object providing aircraft functions access to game state and callbacks */
export interface AircraftContext {
  structures: MapStructure[];
  map: GameMap;

  // Mutable counters
  unitsLeftMap: number;
  civiliansEvacuated: number;

  // Callbacks
  isAllied(a: House, b: House): boolean;
  movementSpeed(entity: Entity): number;
  idleMission(entity: Entity): Mission;
  fireWeaponAt(attacker: Entity, target: Entity, weapon: WeaponStats): void;
  fireWeaponAtStructure(attacker: Entity, s: MapStructure, weapon: WeaponStats): void;
}

// ── Pure Functions ─────────────────────────────────────────────────────────────

/** Cloaked subs only targetable by isAntiSub weapons; cruisers skip infantry; torpedo-only skip land */
export function canTargetNaval(scanner: Entity, target: Entity): boolean {
  // Cloaked subs only targetable by isAntiSub weapons
  if (target.cloakState === CloakState.CLOAKED || target.cloakState === CloakState.CLOAKING) {
    if (!scanner.weapon?.isAntiSub && !scanner.weapon2?.isAntiSub) return false;
  }
  // Cruisers cannot target infantry
  if (scanner.type === UnitType.V_CA && target.stats.isInfantry) return false;
  // Torpedo-only units can't target land units
  if (scanner.weapon?.isSubSurface && !scanner.weapon2 && !target.isNavalUnit) return false;
  return true;
}

/** Find a landing pad for this aircraft. Returns structure index or -1. */
export function findLandingPad(ctx: AircraftContext, entity: Entity): number {
  const padType = entity.stats.landingBuilding;
  if (!padType) return -1;
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < ctx.structures.length; i++) {
    const s = ctx.structures[i];
    if (!s.alive || s.type !== padType) continue;
    if (!ctx.isAllied(entity.house, s.house)) continue;
    if (s.dockedAircraft !== undefined && s.dockedAircraft > 0) continue; // occupied
    const sx = s.cx * CELL_SIZE + CELL_SIZE;
    const sy = s.cy * CELL_SIZE + CELL_SIZE;
    const dist = worldDist(entity.pos, { x: sx, y: sy });
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Get target position for an aircraft's current target (entity or structure) */
export function getAircraftTargetPos(entity: Entity): WorldPos | null {
  if (entity.target?.alive) return entity.target.pos;
  if (entity.targetStructure && (entity.targetStructure as MapStructure).alive) {
    const s = entity.targetStructure as MapStructure;
    return { x: s.cx * CELL_SIZE + CELL_SIZE, y: s.cy * CELL_SIZE + CELL_SIZE };
  }
  return null;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/** Handle aircraft (and passengers) leaving the map */
function handleMapExit(ctx: AircraftContext, entity: Entity): void {
  entity.alive = false;
  entity.mission = Mission.DIE;
  ctx.unitsLeftMap++;
  if (CIVILIAN_UNIT_TYPES.has(entity.type)) {
    ctx.civiliansEvacuated++;
  }
  if (entity.passengers && entity.passengers.length > 0) {
    for (const p of entity.passengers) {
      p.alive = false;
      ctx.unitsLeftMap++;
      if (CIVILIAN_UNIT_TYPES.has(p.type)) {
        ctx.civiliansEvacuated++;
      }
    }
    entity.passengers = [];
  }
}

// ── State Machine ──────────────────────────────────────────────────────────────

/** Aircraft state machine — returns true if aircraft handled this tick (skip normal update) */
export function updateAircraft(ctx: AircraftContext, entity: Entity): boolean {
  // Only process aircraft with active state
  if (!entity.stats.isAircraft) return false;

  // Decrement attack cooldowns — aircraft skip normal mission processing
  if (entity.attackCooldown > 0) entity.attackCooldown--;
  if (entity.attackCooldown2 > 0) entity.attackCooldown2--;

  switch (entity.aircraftState) {
    case 'landed': {
      // On pad, flightAltitude=0. Wait for attack/move order
      entity.flightAltitude = 0;
      entity.animState = AnimState.IDLE;
      if (entity.mission === Mission.ATTACK && (entity.target?.alive || entity.targetStructure)) {
        entity.aircraftState = 'takeoff';
      } else if (entity.mission === Mission.MOVE && entity.moveTarget) {
        entity.aircraftState = 'takeoff';
      }
      return true;
    }

    case 'takeoff': {
      // Ascend 1px/tick until at flight altitude (C++ AIRCRAFT.CPP — 24 ticks to reach altitude)
      entity.flightAltitude = Math.min(Entity.FLIGHT_ALTITUDE, entity.flightAltitude + 1);
      entity.animState = AnimState.WALK;
      // Undock from pad
      if (entity.landedAtStructure >= 0 && entity.landedAtStructure < ctx.structures.length) {
        ctx.structures[entity.landedAtStructure].dockedAircraft = undefined;
      }
      entity.landedAtStructure = -1;
      if (entity.flightAltitude >= Entity.FLIGHT_ALTITUDE) {
        entity.aircraftState = 'flying';
      }
      return true;
    }

    case 'flying': {
      entity.animState = AnimState.WALK;
      // If we have an attack target, close to weapon range
      if (entity.mission === Mission.ATTACK) {
        const targetPos = getAircraftTargetPos(entity);
        if (!targetPos) {
          // Target lost — RTB
          entity.aircraftState = 'returning';
          return true;
        }
        const dist = worldDist(entity.pos, targetPos);
        const weaponRange = entity.weapon?.range ?? 5;
        if (dist <= weaponRange) {
          entity.aircraftState = 'attacking';
          entity.attackRunPhase = 'approach';
          return true;
        }
        // Fly toward target
        entity.moveToward(targetPos, ctx.movementSpeed(entity));
      } else if (entity.mission === Mission.MOVE && entity.moveTarget) {
        // Check if aircraft is at map edge with out-of-bounds target — exit map
        const ec = entity.cell;
        const tc = worldToCell(entity.moveTarget.x, entity.moveTarget.y);
        if (!ctx.map.inBounds(tc.cx, tc.cy) &&
            (ec.cx <= ctx.map.boundsX || ec.cx >= ctx.map.boundsX + ctx.map.boundsW - 1 ||
             ec.cy <= ctx.map.boundsY || ec.cy >= ctx.map.boundsY + ctx.map.boundsH - 1)) {
          handleMapExit(ctx, entity);
          return true;
        }
        // Simple move — fly to destination
        if (entity.moveToward(entity.moveTarget, ctx.movementSpeed(entity))) {
          // Arrived — check if destination was out of bounds (aircraft map exit)
          const arrCell = worldToCell(entity.moveTarget.x, entity.moveTarget.y);
          if (!ctx.map.inBounds(arrCell.cx, arrCell.cy)) {
            handleMapExit(ctx, entity);
            return true;
          }
          entity.moveTarget = null;
          if (entity.moveQueue.length > 0) {
            entity.moveTarget = entity.moveQueue.shift()!;
          } else {
            entity.mission = ctx.idleMission(entity);
            entity.aircraftState = 'returning';
          }
        }
      } else {
        // No mission — return to base
        entity.aircraftState = 'returning';
      }
      return true;
    }

    case 'attacking': {
      if (entity.isFixedWing) {
        return updateFixedWingAttackRun(ctx, entity);
      } else {
        return updateHelicopterAttack(ctx, entity);
      }
    }

    case 'returning': {
      // Check for new orders — break out of return-to-base
      if ((entity.mission === Mission.MOVE && entity.moveTarget) ||
          (entity.mission === Mission.ATTACK && (entity.target?.alive || entity.targetStructure))) {
        entity.aircraftState = 'flying';
        return true;
      }
      entity.animState = AnimState.WALK;
      // Find home pad
      const padIdx = findLandingPad(ctx, entity);
      if (padIdx < 0) {
        // No pad available — transport helicopters land on the ground (C++ aircraft.cpp)
        // Chinooks can land anywhere; combat aircraft orbit until a pad frees up
        if (entity.isTransport) {
          entity.aircraftState = 'landing';
          entity.landedAtStructure = -1;
        }
        // Combat aircraft orbit in place
        return true;
      }
      const pad = ctx.structures[padIdx];
      const [pw, ph] = STRUCTURE_SIZE[pad.type] ?? [2, 2];
      const padPos = { x: (pad.cx + pw / 2) * CELL_SIZE, y: (pad.cy + ph / 2) * CELL_SIZE };
      const dist = worldDist(entity.pos, padPos);
      if (dist <= CELL_SIZE) {
        entity.pos.x = padPos.x;
        entity.pos.y = padPos.y;
        entity.aircraftState = 'landing';
        entity.landedAtStructure = padIdx;
        pad.dockedAircraft = entity.id;
      } else {
        entity.moveToward(padPos, ctx.movementSpeed(entity));
      }
      return true;
    }

    case 'landing': {
      // Descend 1px/tick (C++ AIRCRAFT.CPP — matches takeoff rate)
      entity.flightAltitude = Math.max(0, entity.flightAltitude - 1);
      entity.animState = AnimState.IDLE;
      if (entity.flightAltitude <= 0) {
        entity.flightAltitude = 0;
        if (entity.ammo >= 0 && entity.ammo < entity.maxAmmo) {
          entity.aircraftState = 'rearming';
          // C++ AIRCRAFT.CPP: rearm delay = weapon ROF * house ROF bias
          const rofBias = COUNTRY_BONUSES[entity.house]?.rofMult ?? 1.0;
          entity.rearmTimer = Math.max(1, Math.round((entity.weapon?.rof ?? 30) * rofBias));
        } else {
          entity.aircraftState = 'landed';
        }
        entity.mission = Mission.GUARD;
      }
      return true;
    }

    case 'rearming': {
      entity.flightAltitude = 0;
      entity.animState = AnimState.IDLE;
      entity.rearmTimer--;
      if (entity.rearmTimer <= 0) {
        entity.ammo++;
        if (entity.ammo >= entity.maxAmmo) {
          entity.aircraftState = 'landed';
        } else {
          // C++ AIRCRAFT.CPP: rearm delay = weapon ROF * house ROF bias
          const nextRofBias = COUNTRY_BONUSES[entity.house]?.rofMult ?? 1.0;
          entity.rearmTimer = Math.max(1, Math.round((entity.weapon?.rof ?? 30) * nextRofBias));
        }
      }
      return true;
    }

    default:
      return false;
  }
}

/** Fixed-wing attack run: approach -> fire -> pullaway -> circle back or RTB */
export function updateFixedWingAttackRun(ctx: AircraftContext, entity: Entity): boolean {
  const targetPos = getAircraftTargetPos(entity);

  if (!targetPos) {
    entity.aircraftState = 'returning';
    entity.mission = Mission.GUARD;
    return true;
  }

  const speed = ctx.movementSpeed(entity);
  const dist = worldDist(entity.pos, targetPos);
  const weaponRange = entity.weapon?.range ?? 5;

  switch (entity.attackRunPhase) {
    case 'approach':
      entity.animState = AnimState.WALK;
      entity.moveToward(targetPos, speed);
      if (dist <= weaponRange) {
        entity.attackRunPhase = 'firing';
      }
      break;

    case 'firing':
      entity.animState = AnimState.ATTACK;
      // Keep moving forward (fixed-wing can't stop)
      entity.moveToward(targetPos, speed);
      // Fire weapon if cooldown ready, then transition to pullaway
      if (entity.attackCooldown <= 0 && entity.weapon) {
        if (entity.target?.alive) {
          ctx.fireWeaponAt(entity, entity.target, entity.weapon);
        } else if (entity.targetStructure && (entity.targetStructure as MapStructure).alive) {
          ctx.fireWeaponAtStructure(entity, entity.targetStructure as MapStructure, entity.weapon);
        }
        entity.attackCooldown = entity.weapon.rof;
        if (entity.ammo > 0) entity.ammo--;
        entity.attackRunPhase = 'pullaway';
      }
      break;

    case 'pullaway':
      entity.animState = AnimState.WALK;
      // Overshoot ~3 cells past target
      const overshootDist = 3 * CELL_SIZE;
      const dx = entity.pos.x - targetPos.x;
      const dy = entity.pos.y - targetPos.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const overshootPos = {
        x: targetPos.x + (dx / len) * overshootDist,
        y: targetPos.y + (dy / len) * overshootDist,
      };
      entity.moveToward(overshootPos, speed);
      if (worldDist(entity.pos, targetPos) > overshootDist * 0.8) {
        if (entity.ammo > 0 && (entity.target?.alive || entity.targetStructure)) {
          // Circle back for another pass
          entity.attackRunPhase = 'approach';
        } else {
          // Out of ammo or target dead — RTB
          entity.aircraftState = 'returning';
          entity.mission = Mission.GUARD;
          entity.target = null;
          entity.targetStructure = null;
        }
      }
      break;
  }
  return true;
}

/** Helicopter hover attack: close to weapon range, face target, fire */
export function updateHelicopterAttack(ctx: AircraftContext, entity: Entity): boolean {
  const targetPos = getAircraftTargetPos(entity);

  if (!targetPos) {
    entity.aircraftState = 'returning';
    entity.mission = Mission.GUARD;
    return true;
  }

  const dist = worldDist(entity.pos, targetPos);
  const weaponRange = entity.weapon?.range ?? 5;

  if (dist > weaponRange) {
    // Close to weapon range
    entity.animState = AnimState.WALK;
    entity.moveToward(targetPos, ctx.movementSpeed(entity));
    return true;
  }

  // In range — hover and fire
  entity.animState = AnimState.ATTACK;
  entity.desiredFacing = directionTo(entity.pos, targetPos);
  entity.tickRotation();

  // Fire on cooldown
  if (entity.attackCooldown <= 0 && entity.weapon) {
    if (entity.target?.alive) {
      ctx.fireWeaponAt(entity, entity.target, entity.weapon);
    } else if (entity.targetStructure && (entity.targetStructure as MapStructure).alive) {
      ctx.fireWeaponAtStructure(entity, entity.targetStructure as MapStructure, entity.weapon);
    }
    entity.attackCooldown = entity.weapon.rof;
    if (entity.ammo > 0) entity.ammo--;
  }

  // Out of ammo — RTB
  if (entity.ammo === 0) {
    entity.aircraftState = 'returning';
    entity.mission = Mission.GUARD;
    entity.target = null;
    entity.targetStructure = null;
  }

  return true;
}
