/**
 * Aircraft state machine subsystem — takeoff, landing, attack runs, helicopter hover.
 * Extracted from Game class (index.ts) to isolate aircraft flight logic.
 */

import {
  type WorldPos, type WeaponStats,
  CELL_SIZE, MAP_CELLS, Mission, AnimState, House, UnitType,
  worldDist, directionTo, worldToCell, DIR_DX, DIR_DY,
  CIVILIAN_UNIT_TYPES,
} from './types';
import { Entity, CloakState } from './entity';
import { LP, PIXEL_LEPTON_W } from './tracks';
import { type MapStructure, STRUCTURE_SIZE } from './scenario';
import { type GameMap } from './map';

// ── C++ Hover Jitter (aircraft.cpp:441-445) ──────────────────────────────────

/** C++ aircraft.cpp:443-444 — helicopter hover jitter pattern.
 *  Applied when at FLIGHT_LEVEL and speed < 3 (effectively hovering/stationary).
 *  Values are pixel offsets: {0,0,0,0,1,1,1,0,0,0,0,0,-1,-1,-1,0}
 *  Indexed by global frame counter % 16. Sum is 0 — no net displacement. */
export const HOVER_JITTER = [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, -1, -1, -1, 0] as const;

/** Module-level frame counter for hover jitter (C++ ::Frame). Incremented by updateAircraft callers. */
let _aircraftFrame = 0;
/** Advance the aircraft frame counter. Call once per game tick. */
export function advanceAircraftFrame(): void { _aircraftFrame++; }
/** Get current aircraft frame (for tests). */
export function getAircraftFrame(): number { return _aircraftFrame; }
/** Reset frame counter (for tests). */
export function resetAircraftFrame(): void { _aircraftFrame = 0; }

// ── C++ Rearm Constants (rules.ini / defines.h) ─────────────────────────────

/** C++ defines.h:3031 — 15 ticks per second */
export const TICKS_PER_SECOND = 15;
/** C++ defines.h:3032 — 900 ticks per minute */
export const TICKS_PER_MINUTE = TICKS_PER_SECOND * 60;
/** rules.ini [General] ReloadRate=.04 — minutes per ammo point (overrides rules.cpp:178 default of .05) */
export const RELOAD_RATE = 0.04;

/**
 * C++ building.cpp:4023-4025 — compute ticks between each RADIO_RELOAD.
 *   pfrac = Saturate(Power_Fraction(), 1), clamped to min 0.5
 *   time = Inverse(pfrac) * Rule.ReloadRate * TICKS_PER_MINUTE
 * At full power (1.0): 1.0 * 0.04 * 900 = 36 ticks per ammo point
 * At half power (0.5): 2.0 * 0.04 * 900 = 72 ticks per ammo point
 */
export function computeRearmDelay(powerFraction: number): number {
  // C++ building.cpp:4023: Saturate to [0, 1]
  let pfrac = Math.min(Math.max(powerFraction, 0), 1);
  // C++ building.cpp:4024: clamp to min 0.5
  if (pfrac < 0.5) pfrac = 0.5;
  const time = (1.0 / pfrac) * RELOAD_RATE * TICKS_PER_MINUTE;
  return Math.max(1, Math.round(time));
}

// ── Interfaces ─────────────────────────────────────────────────────────────────

/** Context object providing aircraft functions access to game state and callbacks */
export interface AircraftContext {
  structures: MapStructure[];
  map: GameMap;

  // Mutable counters
  unitsLeftMap: number;
  civiliansEvacuated: number;

  /** C++ Scen.IsTanyaEvac — scenario flag (CivEvac=yes in [Basic]). When true, Tanya (E7)
   *  counts as civilian evacuation. Set per-scenario, NOT a global constant.
   *  Source: aircraft.cpp:143 — if (Scen.IsTanyaEvac && *inf == INFANTRY_TANYA) return(true); */
  isTanyaEvac?: boolean;

  // Callbacks
  isAllied(a: House, b: House): boolean;
  movementSpeed(entity: Entity): number;
  idleMission(entity: Entity): Mission;
  fireWeaponAt(attacker: Entity, target: Entity, weapon: WeaponStats): void;
  fireWeaponAtStructure(attacker: Entity, s: MapStructure, weapon: WeaponStats): void;
  /** C++ house.cpp:293,303: ROFBias — difficulty-scaled rate-of-fire */
  getROFBias(house: House): number;
  /** C++ house.cpp:4160: Power_Fraction() = Power/Drain, capped at 1.0.
   *  Used by building.cpp:4023 for rearm delay scaling. */
  getPowerFraction(house: House): number;
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

/** C++ _Counts_As_Civ_Evac parity: checks CIVILIAN_UNIT_TYPES + IsTanyaEvac scenario flag.
 *  Source: aircraft.cpp:116-159. Tanya only counts when Scen.IsTanyaEvac is set. */
function countsAsCivEvac(ctx: AircraftContext, unitType: string): boolean {
  if (CIVILIAN_UNIT_TYPES.has(unitType)) return true;
  if (ctx.isTanyaEvac && unitType === 'E7') return true;
  return false;
}

/** C++ aircraft movement: rotate toward target, then move in CURRENT facing.
 *  Unlike entity.moveToward() which moves in desiredFacing, this replicates C++
 *  Rotation_AI() + Physics(Coord, PrimaryFacing) — the aircraft follows a curved
 *  path as it gradually rotates toward the target heading.
 *
 *  Also applies C++ Process_Fly_To approach slowdown within 3 cells:
 *    speed = min(distance, 0x0300); speed = Bound(speed/3, 0x0020, 0x00FF)
 *
 *  @param entity  The aircraft entity
 *  @param target  World position to fly toward
 *  @param baseSpeed  Base movement speed in px/tick (from ctx.movementSpeed)
 *  @returns true if arrived at target */
function aircraftFlyInFacing(entity: Entity, target: WorldPos, baseSpeed: number): boolean {
  const dx = target.x - entity.pos.x;
  const dy = target.y - entity.pos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist <= 0.5) {
    entity.pos.x = target.x;
    entity.pos.y = target.y;
    entity.speedAccum = 0;
    return true; // arrived
  }

  // Step 1: Set desired facing toward target and let rotation system handle gradual turning.
  // Reset rotation guard — in the real game loop, rotTickedThisFrame is cleared once per tick
  // before entity processing (index.ts:1652). Aircraft return early from updateAircraft(),
  // so tickRotation() is only called once per tick here. The guard reset ensures correct
  // behavior both in-game and in unit tests that don't simulate the full game loop.
  entity.desiredFacing = directionTo(entity.pos, target);
  entity.rotTickedThisFrame = false;
  entity.tickRotation();

  // Step 2: C++ Process_Fly_To(true, NavCom) approach slowdown within 3 cells.
  //   int speed = min(distance, 0x0300);        // cap at 768 leptons (~3 cells)
  //   speed = Bound(speed/3, 0x0020, 0x00FF);   // clamp to [32, 255] out of 255 max
  // Convert to a fraction: at 3+ cells → 1.0, at ~0.375 cells → 0x20/0xFF ≈ 0.125
  const distInCells = dist / CELL_SIZE;
  let speedFraction = 1.0;
  if (distInCells < 3.0) {
    // Distance in leptons equivalent: distInCells * 256
    const distLeptons = distInCells * 256;
    const cappedLeptons = Math.min(distLeptons, 0x0300); // cap at 768 (3 cells)
    const rawSpeed = Math.floor(cappedLeptons / 3);
    const clampedSpeed = Math.max(0x20, Math.min(0xFF, rawSpeed));
    speedFraction = clampedSpeed / 0xFF;
  }

  const effectiveSpeed = baseSpeed * entity.speedBias * speedFraction;

  // Step 3: Move in entity.facing (current facing), NOT desiredFacing.
  // This replicates C++ Physics(Coord, PrimaryFacing) — the aircraft follows
  // a curved path as facing gradually catches up to desired heading.
  const face = entity.facing;
  const fdx = DIR_DX[face];
  const fdy = DIR_DY[face];

  // Lepton accumulator (C++ fly.cpp:62-106) — same math as entity.moveToward
  const maxSpeedLeptons = Math.floor(effectiveSpeed / LP);
  const speedAdd = Math.floor((maxSpeedLeptons * 255) / 256);
  const actual = speedAdd + entity.speedAccum;
  const remainder = actual % PIXEL_LEPTON_W;
  entity.speedAccum = remainder;
  const moveLeptons = actual - remainder;

  if (moveLeptons <= 0) {
    return false; // not enough accumulated for a pixel step this tick
  }

  const movePixels = moveLeptons * LP;
  const isDiagonal = fdx !== 0 && fdy !== 0;
  const axisDist = isDiagonal ? movePixels * Math.SQRT1_2 : movePixels;

  // Clamp to remaining distance to prevent overshoot
  const stepX = Math.min(Math.abs(fdx * axisDist), Math.abs(dx)) * Math.sign(dx || fdx);
  const stepY = Math.min(Math.abs(fdy * axisDist), Math.abs(dy)) * Math.sign(dy || fdy);
  entity.pos.x += stepX;
  entity.pos.y += stepY;

  const totalStep = Math.sqrt(stepX * stepX + stepY * stepY);
  return totalStep >= dist - 0.5;
}

/** Handle aircraft (and passengers) leaving the map */
function handleMapExit(ctx: AircraftContext, entity: Entity): void {
  entity.alive = false;
  entity.mission = Mission.DIE;
  ctx.unitsLeftMap++;
  if (countsAsCivEvac(ctx, entity.type)) {
    ctx.civiliansEvacuated++;
  }
  if (entity.passengers && entity.passengers.length > 0) {
    for (const p of entity.passengers) {
      p.alive = false;
      ctx.unitsLeftMap++;
      if (countsAsCivEvac(ctx, p.type)) {
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
      } else if (entity.mission === Mission.RETREAT) {
        // C++ aircraft.cpp:1309-1367 Mission_Retreat: TAKE_OFF stage
        // Loaner transport has finished unloading — take off to fly off-map
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
      // C++ aircraft.cpp:2899-2928 — helicopter takeoff 5-stage speed ramp.
      // C++ uses switch(Height) with thresholds in leptons; TS converts to pixel equivalents.
      //   Stage 1: Height=0             → speed=0x00 (close door)
      //   Stage 2: Height=FLIGHT_LEVEL/2 (128 leptons=12px) → speed=0x00 (face navcom)
      //   Stage 3: Height=FLIGHT_LEVEL-FLIGHT_LEVEL/3 (170 leptons=16px) → speed=0x20
      //   Stage 4: Height=FLIGHT_LEVEL-FLIGHT_LEVEL/5 (204 leptons=19px) → speed=0x40
      //   Stage 5: Height=FLIGHT_LEVEL (256 leptons=24px) → speed=0xFF (full)
      if (entity.isHelicopter) {
        const FA = Entity.FLIGHT_ALTITUDE; // 24
        const alt = entity.flightAltitude;
        const halfLevel = Math.round(FA / 2);             // 12px (C++ FLIGHT_LEVEL/2 = 128 leptons)
        const stage3 = Math.round(FA * 170 / 256);        // 16px (C++ FLIGHT_LEVEL - FLIGHT_LEVEL/3 = 170)
        const stage4 = Math.round(FA * 204 / 256);        // 19px (C++ FLIGHT_LEVEL - FLIGHT_LEVEL/5 = 204)
        if (alt < halfLevel) {
          // Stages 1-2: speed 0 — helicopter lifting off, doors closing, facing navcom
          entity.aircraftSpeedFraction = 0;
        } else if (alt < stage3) {
          // Below stage 3 threshold: still speed 0 (between half and 2/3 height)
          entity.aircraftSpeedFraction = 0;
        } else if (alt < stage4) {
          // Stage 3: speed 0x20 = 12.5% — slow forward movement
          entity.aircraftSpeedFraction = 0x20 / 0xFF; // ~0.125
        } else if (alt < FA) {
          // Stage 4: speed 0x40 = 25% — medium speed
          entity.aircraftSpeedFraction = 0x40 / 0xFF; // ~0.25
        } else {
          // Stage 5: at FLIGHT_ALTITUDE — full speed
          entity.aircraftSpeedFraction = 1.0;
        }
      } else {
        // C++ aircraft.cpp:2893-2897 — fixed-wing: full speed immediately on takeoff
        entity.aircraftSpeedFraction = 1.0;
      }
      if (entity.flightAltitude >= Entity.FLIGHT_ALTITUDE) {
        entity.aircraftState = 'flying';
        entity.aircraftSpeedFraction = 1.0;
      }
      return true;
    }

    case 'flying': {
      entity.animState = AnimState.WALK;
      // C++ aircraft.cpp:441-445 — helicopter hover jitter when at FLIGHT_ALTITUDE and slow
      // Apply small vertical bobbing to hovering (non-moving) helicopters
      if (entity.isHelicopter && entity.flightAltitude === Entity.FLIGHT_ALTITUDE) {
        entity.hoverJitter = HOVER_JITTER[_aircraftFrame % 16];
      } else {
        entity.hoverJitter = 0;
      }
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
          entity.attackRunPhase = 'flyToTarget';
          entity.circleBreakTimer = 0;
          return true;
        }
        // Fly toward target — C++ curved path via Rotation_AI + Physics(PrimaryFacing)
        aircraftFlyInFacing(entity, targetPos, ctx.movementSpeed(entity));
      } else if (entity.mission === Mission.RETREAT) {
        // C++ aircraft.cpp:1309-1367 Mission_Retreat — fly to nearest map edge and exit.
        // FACE_MAP_EDGE: compute exit point if not already set, then KEEP_FLYING toward it.
        if (!entity.moveTarget) {
          // Compute nearest map edge exit point (one cell OUTSIDE bounds so exit triggers)
          const ec = entity.cell;
          const distLeft = ec.cx - ctx.map.boundsX;
          const distRight = (ctx.map.boundsX + ctx.map.boundsW - 1) - ec.cx;
          const distTop = ec.cy - ctx.map.boundsY;
          const distBottom = (ctx.map.boundsY + ctx.map.boundsH - 1) - ec.cy;
          const minDist = Math.min(distLeft, distRight, distTop, distBottom);
          let tx = ec.cx, ty = ec.cy;
          if (minDist === distLeft) tx = ctx.map.boundsX - 1;
          else if (minDist === distRight) tx = ctx.map.boundsX + ctx.map.boundsW;
          else if (minDist === distTop) ty = ctx.map.boundsY - 1;
          else ty = ctx.map.boundsY + ctx.map.boundsH;
          entity.moveTarget = { x: tx * CELL_SIZE + CELL_SIZE / 2, y: ty * CELL_SIZE + CELL_SIZE / 2 };
        }
        // Check if at map edge — exit
        const ec = entity.cell;
        if (ec.cx <= ctx.map.boundsX || ec.cx >= ctx.map.boundsX + ctx.map.boundsW - 1 ||
            ec.cy <= ctx.map.boundsY || ec.cy >= ctx.map.boundsY + ctx.map.boundsH - 1) {
          handleMapExit(ctx, entity);
          return true;
        }
        // Fly toward the edge — C++ curved path
        aircraftFlyInFacing(entity, entity.moveTarget, ctx.movementSpeed(entity));
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
        // Simple move — fly to destination (C++ curved path)
        if (aircraftFlyInFacing(entity, entity.moveTarget, ctx.movementSpeed(entity))) {
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
      // C++ aircraft.cpp:1309-1367: RETREAT overrides return-to-base — fly to map edge instead
      if (entity.mission === Mission.RETREAT) {
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
        aircraftFlyInFacing(entity, padPos, ctx.movementSpeed(entity));
      }
      return true;
    }

    case 'landing': {
      // Descend 1px/tick (C++ AIRCRAFT.CPP — matches takeoff rate)
      entity.flightAltitude = Math.max(0, entity.flightAltitude - 1);
      entity.animState = AnimState.IDLE;
      // C++ aircraft.cpp:4104-4111 — LZ blocked check at LAYER_GROUND transition.
      // When helicopter enters ground layer (altitude < 16px) and the LZ is occupied,
      // abort landing and retake off. Does NOT apply to fixed-wing.
      const LAYER_GROUND_THRESHOLD = Math.round(Entity.FLIGHT_ALTITUDE * 2 / 3); // 16px (C++ FLIGHT_LEVEL - FLIGHT_LEVEL/3 = 171 leptons)
      if (entity.isHelicopter && entity.flightAltitude > 0 && entity.flightAltitude < LAYER_GROUND_THRESHOLD) {
        const { cx, cy } = entity.cell;
        const cellKey = cy * MAP_CELLS + cx;
        if (ctx.map.vehicleOccupancy.has(cellKey)) {
          // LZ blocked — abort landing, take back off
          entity.flightAltitude = Math.min(Entity.FLIGHT_ALTITUDE, entity.flightAltitude + 1);
          entity.aircraftState = 'takeoff';
          entity.aircraftSpeedFraction = 1.0;
          return true;
        }
      }
      // C++ aircraft.cpp:2982-2998 — helicopter landing speed staging
      // At half flight level (12px), helicopter stops horizontal movement
      if (entity.isHelicopter) {
        const halfLevel = Math.round(Entity.FLIGHT_ALTITUDE / 2); // 12px
        if (entity.flightAltitude <= halfLevel) {
          entity.aircraftSpeedFraction = 0; // Set_Speed(0) — stop horizontal movement
        }
      }
      if (entity.flightAltitude <= 0) {
        entity.flightAltitude = 0;
        // C++ aircraft.cpp:4062-4068 — fixed-wing crash on open ground
        // Fixed-wing aircraft that touch down without an airstrip are destroyed
        if (entity.isFixedWing && entity.landedAtStructure < 0) {
          entity.hp = 0;
          entity.alive = false;
          entity.mission = Mission.DIE;
          return true;
        }
        entity.aircraftSpeedFraction = 1.0; // reset speed for landed state
        if (entity.ammo >= 0 && entity.ammo < entity.maxAmmo) {
          entity.aircraftState = 'rearming';
          // C++ building.cpp:4023-4025: building-driven rearm delay
          // time = Inverse(pfrac) * Rule.ReloadRate * TICKS_PER_MINUTE
          entity.rearmTimer = computeRearmDelay(ctx.getPowerFraction(entity.house));
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
      // C++ techno.cpp:965: if (Ammo == MaxAmmo) return(RADIO_NEGATIVE);
      // Check BEFORE increment — ammo must never exceed maxAmmo (C++ parity).
      if (entity.ammo >= entity.maxAmmo) {
        entity.aircraftState = 'landed';
        return true;
      }
      entity.rearmTimer--;
      if (entity.rearmTimer <= 0) {
        entity.ammo++;
        if (entity.ammo >= entity.maxAmmo) {
          entity.aircraftState = 'landed';
        } else {
          // C++ building.cpp:4023-4025: building-driven rearm delay
          entity.rearmTimer = computeRearmDelay(ctx.getPowerFraction(entity.house));
        }
      }
      return true;
    }

    default:
      return false;
  }
}

/** Fixed-wing attack run: C++ Mission_Hunt 5-phase state machine (building.cpp)
 *  flyToTarget → dropBombs → regroup → (loop or RTB)
 *  Key C++ behaviors: facing check before firing, anti-circle delay,
 *  continuous fire during dropBombs, explicit regroup phase. */
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
    case 'flyToTarget': {
      // C++ FLY_TO_TARGET: fly toward target, check Can_Fire() result
      entity.animState = AnimState.WALK;
      aircraftFlyInFacing(entity, targetPos, speed);

      if (dist <= weaponRange) {
        // Check facing alignment (C++ FIRE_FACING return — must face target within ~45°)
        const targetDir = directionTo(entity.pos, targetPos);
        const facingDiff = ((entity.facing - targetDir + 8) % 8 + 8) % 8;
        const normalizedDiff = facingDiff > 4 ? 8 - facingDiff : facingDiff;

        if (normalizedDiff <= 1) {
          // Facing aligned — transition to dropBombs (C++ FIRE_OK)
          entity.attackRunPhase = 'dropBombs';
          entity.circleBreakTimer = 0;
        } else {
          // C++ anti-circle delay: in range but can't face target (tight circle)
          // Wait ~30 ticks (2 seconds) then force regroup to break out
          entity.circleBreakTimer++;
          if (entity.circleBreakTimer > 30) {
            entity.attackRunPhase = 'regroup';
            entity.circleBreakTimer = 0;
          }
        }
      } else {
        entity.circleBreakTimer = 0;
      }
      break;
    }

    case 'dropBombs': {
      // C++ DROP_BOMBS: fire at target when Can_Fire returns FIRE_OK
      // Continuous fire — fire every tick cooldown allows (multi-shot per pass)
      entity.animState = AnimState.ATTACK;
      // Keep moving forward (fixed-wing can't stop)
      aircraftFlyInFacing(entity, targetPos, speed);

      // Check facing alignment for continued firing
      const targetDir = directionTo(entity.pos, targetPos);
      const facingDiff = ((entity.facing - targetDir + 8) % 8 + 8) % 8;
      const normalizedDiff = facingDiff > 4 ? 8 - facingDiff : facingDiff;

      // Fire if cooldown ready and facing still OK (within 1 direction)
      if (entity.attackCooldown <= 0 && entity.weapon && normalizedDiff <= 1) {
        if (entity.target?.alive) {
          ctx.fireWeaponAt(entity, entity.target, entity.weapon);
        } else if (entity.targetStructure && (entity.targetStructure as MapStructure).alive) {
          ctx.fireWeaponAtStructure(entity, entity.targetStructure as MapStructure, entity.weapon);
        }
        // C++ house.cpp:293,303: ROFBias scales rearm delay
        entity.attackCooldown = Math.max(1, Math.round(entity.weapon.rof * ctx.getROFBias(entity.house)));
        if (entity.ammo > 0) entity.ammo--;
      }

      // Transition out: ammo depleted, target lost, or facing drifted too far
      const targetLost = !(entity.target?.alive) &&
        !(entity.targetStructure && (entity.targetStructure as MapStructure).alive);
      if (entity.ammo === 0 || targetLost || normalizedDiff > 2) {
        entity.attackRunPhase = 'regroup';
      }
      break;
    }

    case 'regroup': {
      // C++ REGROUP: fly straight ~3 cells past target, then re-engage or RTB
      entity.animState = AnimState.WALK;
      const overshootDist = 3 * CELL_SIZE;
      const dx = entity.pos.x - targetPos.x;
      const dy = entity.pos.y - targetPos.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const overshootPos = {
        x: targetPos.x + (dx / len) * overshootDist,
        y: targetPos.y + (dy / len) * overshootDist,
      };
      aircraftFlyInFacing(entity, overshootPos, speed);
      // worldDist returns cells; compare in cells (3 cells overshoot * 0.8 threshold)
      if (worldDist(entity.pos, targetPos) > 3 * 0.8) {
        const targetAlive = (entity.target?.alive) ||
          (entity.targetStructure && (entity.targetStructure as MapStructure).alive);
        if (entity.ammo > 0 && targetAlive) {
          // Circle back for another pass (C++ re-enter LOOK_FOR_TARGET)
          entity.attackRunPhase = 'flyToTarget';
          entity.circleBreakTimer = 0;
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
    // Close to weapon range — C++ curved path
    entity.animState = AnimState.WALK;
    aircraftFlyInFacing(entity, targetPos, ctx.movementSpeed(entity));
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
    // C++ house.cpp:293,303: ROFBias scales rearm delay
    entity.attackCooldown = Math.max(1, Math.round(entity.weapon.rof * ctx.getROFBias(entity.house)));
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
