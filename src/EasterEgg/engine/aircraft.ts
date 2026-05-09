/**
 * Aircraft state machine subsystem — takeoff, landing, attack runs, helicopter hover.
 * Extracted from Game class (index.ts) to isolate aircraft flight logic.
 */

import {
  type WorldPos, type WeaponStats, type LeptonPos,
  CELL_SIZE, LEPTON_SIZE, MAP_CELLS, Mission, AnimState, House, UnitType,
  worldDist, directionTo, worldToCell, leptonDist, leptonToPixel, pixelToLepton, DIR_DX, DIR_DY,
  CIVILIAN_UNIT_TYPES, cellTargetToLepton,
  COS_TABLE_256, SIN_TABLE_256, SUBCELL_LEPTON_OFFSETS,
} from './types';
// Re-export tables for backward compatibility (canonical definitions now in types.ts).
export { COS_TABLE_256, SIN_TABLE_256 };
import { Entity, CloakState } from './entity';
import { LP, PIXEL_LEPTON_W } from './tracks';
import { type MapStructure, STRUCTURE_SIZE } from './scenario';
import { type GameMap, MoveResult } from './map';
import { ScenarioRandom } from './random';
import { assignMission } from './missionLifecycle';

/** Helper: convert LeptonPos to WorldPos (pixel space) for rendering/distance APIs */
function leptonPosToWorld(lp: LeptonPos): WorldPos {
  return { x: leptonToPixel(lp.lx), y: leptonToPixel(lp.ly) };
}

/** Convert world positions to a C++ 256-step DirType facing (0=N, 64=E, 128=S, 192=W).
 *  C++ Direction() in facing.h: atan2-based conversion to 256-step byte. */
export function directionTo256(from: WorldPos, to: WorldPos): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return 0;
  // atan2(dx, -dy): dx as "east" component, -dy as "north" component
  // gives 0 for north, PI/2 for east, etc. — matching C++ DirType convention
  const angle = Math.atan2(dx, -dy); // radians, 0=north, positive=clockwise
  // Convert to 0-255: full circle = 2*PI maps to 256
  const dir256 = Math.round(((angle + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * 256) & 0xFF;
  return dir256;
}

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
  entities: Entity[];
  entityById: Map<number, Entity>;
  structures: MapStructure[];
  map: GameMap;
  houseEdges?: Map<House, string>;
  tick?: number;

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

const LOANER_RETREAT_DELAY = 88;
const TRANSPORT_GUARD_DELAY = TICKS_PER_SECOND * 3;

const AIRCRAFT_EXIT_CELLS = [
  { dx: 0, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: 1, dy: 1 },
  { dx: -1, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: 0, dy: -1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
] as const;

function findAircraftExitCell(ctx: AircraftContext, transport: Entity, passenger: Entity): { cx: number; cy: number } {
  for (const face of AIRCRAFT_EXIT_CELLS) {
    const cx = transport.cell.cx + face.dx;
    const cy = transport.cell.cy + face.dy;
    if (ctx.map.canEnterCell(cx, cy, false, undefined, passenger.stats.isInfantry) === MoveResult.OK) {
      return { cx, cy };
    }
  }
  return { ...transport.cell };
}

/** C++ InfantryClass::Unlimbo calls CellClass::Closest_Free_Spot on the
 *  aircraft's Coord before ObjectClass::Coord_Fixup. This snaps unloaded
 *  infantry to a legal sub-cell in the aircraft's current cell; movement then
 *  starts from that sub-cell, not the aircraft's exact lepton coordinate.
 */
export function closestInfantryUnlimboSpot(
  ctx: AircraftContext,
  passenger: Entity,
  lx: number,
  ly: number,
): { lx: number; ly: number; subCell: number; cellIdx: number } {
  const cx = Math.max(0, Math.min(MAP_CELLS - 1, Math.floor(lx / LEPTON_SIZE)));
  const cy = Math.max(0, Math.min(MAP_CELLS - 1, Math.floor(ly / LEPTON_SIZE)));
  const cellIdx = cy * MAP_CELLS + cx;

  const fracX = ((lx % LEPTON_SIZE) + LEPTON_SIZE) % LEPTON_SIZE;
  const fracY = ((ly % LEPTON_SIZE) + LEPTON_SIZE) % LEPTON_SIZE;
  let preferred = 0;
  if (leptonDist(fracX, fracY, 0x80, 0x80) >= 60) {
    if (fracX > 0x80) preferred |= 0x01;
    if (fracY > 0x80) preferred |= 0x02;
    preferred += 1;
  }

  const slots = ctx.map.subCellOccupancy.get(cellIdx);
  const order: number[][] = [
    [0, 1, 2, 3, 4],
    [1, 0, 2, 3, 4],
    [2, 0, 1, 4, 3],
    [3, 0, 1, 4, 2],
    [4, 0, 2, 3, 1],
  ];
  let subCell = preferred;
  if (slots?.[subCell] && slots[subCell] !== passenger.id) {
    for (const candidate of order[preferred]) {
      if (!slots[candidate] || slots[candidate] === passenger.id) {
        subCell = candidate;
        break;
      }
    }
  }

  const spot = SUBCELL_LEPTON_OFFSETS[subCell];
  return {
    lx: cx * LEPTON_SIZE + spot.lx,
    ly: cy * LEPTON_SIZE + spot.ly,
    subCell,
    cellIdx,
  };
}

function aircraftCanCommence(entity: Entity): boolean {
  // C++ aircraft.cpp:879,896 — AircraftClass::AI calls Commence() only when
  // neither IsLanding nor IsTakingOff. TS represents landing/takeoff through
  // these state-machine labels.
  return entity.aircraftState !== 'takeoff' &&
    entity.aircraftState !== 'landing' &&
    entity.aircraftState !== 'unload_land';
}

function commenceAircraft(ctx: AircraftContext, entity: Entity): void {
  if (entity.missionQueue === null || !aircraftCanCommence(entity)) return;
  if (ctx.tick !== undefined && entity.missionQueueSetTick === ctx.tick) return;
  entity.mission = entity.missionQueue;
  entity.missionQueue = null;
  entity.missionQueueSetTick = -1;
  entity.missionTimer = 0;
}

function beginTransportMissionUnload(entity: Entity): void {
  // C++ aircraft.cpp:1077-1225 — Mission_Unload SEARCH_FOR_LZ for helicopters.
  // When the transport is already on the ground, SEARCH_FOR_LZ first falls
  // through to the final Normal_Delay + Random_Pick(0,2) return with Status
  // still at 0. On the next Mission_Unload dispatch it transitions to
  // UNLOAD_PASSENGERS and consumes another delay before ejecting cargo.
  if (!entity.moveTarget && entity.teamRef?.origin) {
    const originCell = worldToCell(entity.teamRef.origin.x, entity.teamRef.origin.y);
    entity.moveTarget = cellTargetToLepton(originCell.cx, originCell.cy);
  }
  entity.aircraftState = 'unload_wait';
  entity.missionTimer = 13 + ScenarioRandom.nextInRange(0, 2);
}

/** C++ fixed(speed, 256) * maxspeed rounds with +128 before dividing by 256. */
function aircraftSpeedAdd(maxSpeedLeptons: number, speedFraction = 1.0): number {
  const speedByte = Math.max(0, Math.min(0xFF, Math.round(speedFraction * 0xFF)));
  return Math.floor((maxSpeedLeptons * speedByte + 128) / 256);
}

function houseEdgeDirection256(ctx: AircraftContext, house: House): number {
  // C++ aircraft.cpp:1353-1361:
  // PrimaryFacing.Set_Desired((DirType)((House->Control.Edge & 0x03) << 6)).
  // SourceType enum: NORTH=0, EAST=1, SOUTH=2, WEST=3. Missing Edge defaults
  // to NORTH in HouseClass setup.
  switch ((ctx.houseEdges?.get(house) ?? 'north').toLowerCase()) {
    case 'east': return 64;
    case 'south': return 128;
    case 'west': return 192;
    case 'north':
    default: return 0;
  }
}

function aircraftFlyCurrentFacing(entity: Entity, baseSpeed: number): void {
  // C++ Mission_Retreat FACE_MAP_EDGE sets Desired facing once; Movement_AI then
  // rotates and applies Physics(Coord, PrimaryFacing) without a NavCom target.
  entity.rotTickedThisFrame = false;
  if (entity.facing256 >= 0) {
    entity.tickRotation256();
  } else {
    entity.tickRotation();
  }

  const maxSpeedLeptons = Math.floor((baseSpeed * entity.speedBias) / LP);
  const speedAdd = aircraftSpeedAdd(maxSpeedLeptons, entity.aircraftSpeedFraction ?? 1.0);
  const actual = speedAdd + entity.speedAccum;
  const remainder = actual % PIXEL_LEPTON_W;
  entity.speedAccum = remainder;
  const moveLeptons = actual - remainder;
  if (moveLeptons <= 0) return;

  if (entity.facing256 >= 0) {
    const f256 = entity.facing256;
    const cosVal = COS_TABLE_256[f256];
    const sinVal = SIN_TABLE_256[f256];
    entity.leptonX += (moveLeptons * cosVal) >> 7;
    entity.leptonY -= (moveLeptons * sinVal) >> 7;
    entity.syncPosFromLeptons();
  } else {
    const face = entity.facing;
    const fdx = DIR_DX[face];
    const fdy = DIR_DY[face];
    const isDiagonal = fdx !== 0 && fdy !== 0;
    const sinFactor8 = isDiagonal ? 90 : 127;
    const axisLeptons8 = (moveLeptons * sinFactor8) >> 7;
    entity.leptonX += fdx * axisLeptons8;
    entity.leptonY += fdy * axisLeptons8;
    entity.syncPosFromLeptons();
  }
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
function aircraftFlyInFacing(entity: Entity, target: WorldPos | LeptonPos, baseSpeed: number): boolean {
  const targetLX = 'lx' in target ? target.lx : pixelToLepton(target.x);
  const targetLY = 'ly' in target ? target.ly : pixelToLepton(target.y);
  // Keep fractional pixel precision for facing. C++ Direction() receives a
  // COORDINATE, so converting a NavCom through integer render pixels here loses
  // the low 4-bit TARGET offset from target.cpp.
  const targetWorld = {
    x: targetLX * CELL_SIZE / LEPTON_SIZE,
    y: targetLY * CELL_SIZE / LEPTON_SIZE,
  };
  const dx = targetWorld.x - entity.pos.x;
  const dy = targetWorld.y - entity.pos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist <= 0.5) {
    entity.setPosition(targetWorld.x, targetWorld.y);
    entity.speedAccum = 0;
    return true; // arrived
  }

  // C++ Process_Fly_To uses Distance(coord, target) — octagonal lepton distance.
  // All distance checks (flyToInterval, approach slowdown, stop threshold) must
  // use this metric. Euclidean pixel distance is ~15% shorter at diagonal angles,
  // causing approach slowdown to trigger too early and flight times to diverge.
  const distLeptons = leptonDist(entity.leptonX, entity.leptonY, targetLX, targetLY);

  // Step 1: Set desired facing toward target and rotate.
  entity.rotTickedThisFrame = false;

  // C++ Process_Fly_To runs every 5 ticks when far (dist>=256 leptons), 1 tick when close
  const flyToInterval = distLeptons >= 256 ? 5 : 1;
  if (!entity._flyToTicks) entity._flyToTicks = 0;
  entity._flyToTicks++;
  const updateDesired = entity._flyToTicks >= flyToInterval;
  if (updateDesired) entity._flyToTicks = 0;

  const use256 = entity.facing256 >= 0;
  if (use256) {
    if (updateDesired) entity.desiredFacing256 = directionTo256(entity.pos, targetWorld);
    entity.tickRotation256();
  } else {
    if (updateDesired) entity.desiredFacing = directionTo(entity.pos, targetWorld);
    entity.tickRotation();
  }

  // Step 2: C++ Process_Fly_To(true, NavCom) approach slowdown within 3 cells.
  // Uses octagonal lepton distance. Speed updated only on flyToInterval ticks.
  if (updateDesired) {
    let speedFraction = 1.0;
    if (distLeptons < 0x0300) { // < 3 cells in leptons (768)
      const rawSpeed = Math.floor(distLeptons / 3);
      const clampedSpeed = Math.max(0x20, Math.min(0xFF, rawSpeed));
      speedFraction = clampedSpeed / 0xFF;
    }
    // C++ Process_Fly_To: Set_Speed(0) and report distance=0 when the
    // aircraft is inside the 0x10-lepton stopping radius. Movement_AI still
    // runs after this in C++, but with SpeedAdd=0, so the aircraft lands from
    // its actual close coordinate rather than snapping to NavCom.
    if (distLeptons < 16) {
      entity.aircraftSpeedFraction = 0;
      return true;
    }
    entity.aircraftSpeedFraction = speedFraction;
  }

  // Lepton accumulator (C++ fly.cpp:62-106) — same math as entity.moveToward
  const maxSpeedLeptons = Math.floor((baseSpeed * entity.speedBias) / LP);
  const speedAdd = aircraftSpeedAdd(maxSpeedLeptons, entity.aircraftSpeedFraction ?? 1.0);
  const actual = speedAdd + entity.speedAccum;
  const remainder = actual % PIXEL_LEPTON_W;
  entity.speedAccum = remainder;
  const moveLeptons = actual - remainder;

  if (moveLeptons <= 0) {
    return false; // not enough accumulated for a pixel step this tick
  }

  const movePixels = moveLeptons * LP;

  // Step 3: Move in current facing direction, NOT desired.
  // C++ Physics(Coord, PrimaryFacing) — aircraft follows curved path as facing catches up.
  if (use256) {
    // C++ Coord_Move (coord.cpp:440):
    //   x += calcy(CosTable[dir], distance)  — COS gives X component
    //   y -= calcy(CosTable[dir], distance)  — SIN gives Y component (negated)
    // where calcy = (distance * table_value) >> 7  — INTEGER truncation in lepton space.
    //
    // The integer >>7 truncation is critical: small lateral components floor to 0,
    // preventing sub-lepton drift that would cause aircraft to spiral away from targets.
    // No per-axis clamping — C++ Coord_Move applies unconditionally.
    const f256 = entity.facing256;
    const cosVal = COS_TABLE_256[f256]; // X component
    const sinVal = SIN_TABLE_256[f256]; // Y component
    // Integer math in lepton space matching C++ calcy = (dist * table) >> 7
    const dxLeptons = (moveLeptons * cosVal) >> 7;
    const dyLeptons = -((moveLeptons * sinVal) >> 7);
    entity.leptonX += dxLeptons;
    entity.leptonY += dyLeptons;
    entity.syncPosFromLeptons();

    return leptonDist(entity.leptonX, entity.leptonY, targetLX, targetLY) < 16;
  } else {
    // Legacy 8-dir path for non-256 aircraft (fallback)
    const face = entity.facing;
    const fdx = DIR_DX[face];
    const fdy = DIR_DY[face];
    const isDiagonal = fdx !== 0 && fdy !== 0;
    const axisDist = isDiagonal ? movePixels * Math.SQRT1_2 : movePixels;

    // Integer lepton movement for 8-dir aircraft
    const sinFactor8 = isDiagonal ? 90 : 127;
    const axisLeptons8 = (moveLeptons * sinFactor8) >> 7;
    const tLX = targetLX;
    const tLY = targetLY;
    const dxL = tLX - entity.leptonX;
    const dyL = tLY - entity.leptonY;
    const stepLX = Math.min(Math.abs(fdx * axisLeptons8), Math.abs(dxL)) * Math.sign(dxL || fdx);
    const stepLY = Math.min(Math.abs(fdy * axisLeptons8), Math.abs(dyL)) * Math.sign(dyL || fdy);
    entity.leptonX += stepLX;
    entity.leptonY += stepLY;
    entity.syncPosFromLeptons();

    const totalStep = Math.abs(stepLX) + Math.abs(stepLY);
    return totalStep >= dist - 0.5;
  }
}

/** Handle aircraft (and passengers) leaving the map */
function handleMapExit(ctx: AircraftContext, entity: Entity): void {
  // Leaving the map is evacuation/escape, not destruction. Keep leave-map
  // counters, but disarm TEVENT_DESTROYED attachments before marking dead.
  entity.triggerName = '';
  entity.alive = false;
  entity.mission = Mission.DIE;
  ctx.unitsLeftMap++;
  if (countsAsCivEvac(ctx, entity.type)) {
    ctx.civiliansEvacuated++;
  }
  if (entity.passengers && entity.passengers.length > 0) {
    for (const p of entity.passengers) {
      p.triggerName = '';
      p.alive = false;
      ctx.unitsLeftMap++;
      if (countsAsCivEvac(ctx, p.type)) {
        ctx.civiliansEvacuated++;
      }
    }
    entity.passengers = [];
  }
}

function paradropOnePassenger(ctx: AircraftContext, entity: Entity): void {
  const passenger = entity.passengers.shift()!;
  passenger.alive = true;
  if (passenger.stats.isInfantry) {
    // C++ AircraftClass::Paradrop_Cargo passes Center_Coord() to
    // InfantryClass::Paradrop, which runs InfantryClass::Unlimbo and snaps the
    // passenger to CellClass::Closest_Free_Spot before the falling AI begins.
    const spot = closestInfantryUnlimboSpot(ctx, passenger, entity.leptonX, entity.leptonY);
    passenger.leptonX = spot.lx;
    passenger.leptonY = spot.ly;
    passenger.syncPosFromLeptons();
    passenger.subCell = spot.subCell;
    passenger.claimedCellIdx = spot.cellIdx;
    passenger.claimedSubCell = spot.subCell;
  } else {
    passenger.setPosition(entity.pos.x, entity.pos.y);
  }
  passenger.transportRef = null;
  passenger.isTethered = false;
  passenger.inLimbo = false;
  // C++ ObjectClass::Paradrop (object.cpp:1853-1866):
  // Height = FLIGHT_LEVEL; IsFalling = true; attach parachute anim.
  passenger.isFalling = true;
  passenger.fallHeightLeptons = Entity.FLIGHT_LEVEL_LEPTONS;
  passenger.fallRiser = 0;
  passenger.fallHasAttachedAnim = true;
  passenger.flightAltitude = leptonToPixel(passenger.fallHeightLeptons);
  // C++ AircraftClass::Paradrop_Cargo removes the passenger from the team,
  // then (bug-compatible unqualified call) assigns the aircraft GUARD/HUNT.
  if (entity.teamRef && passenger.teamRef) {
    passenger.teamRef.remove(passenger);
  }
  assignMission(passenger, passenger.isPlayerUnit ? Mission.GUARD : Mission.HUNT);
  ctx.entities.push(passenger);
  ctx.entityById.set(passenger.id, passenger);
  if (entity.teamRef) {
    entity.mission = passenger.isPlayerUnit ? Mission.GUARD : Mission.HUNT;
  }
}

function updateFixedWingPassengerHunt(ctx: AircraftContext, entity: Entity): boolean {
  if (!entity.moveTarget) return false;

  // C++ fixed-wing Mission_Hunt status values.
  const LOOK_FOR_TARGET = 0;
  const TAKE_OFF = 1;
  const FLY_TO_TARGET = 2;
  const DROP_BOMBS = 3;
  const REGROUP = 4;

  let handled = false;
  const flyCurrentFacing = () => {
    // C++ AircraftClass::AI runs MissionClass dispatch first, then Rotation_AI,
    // then Movement_AI. Fixed-wing Mission_Hunt only changes PrimaryFacing
    // desired during mission dispatch; physical movement then uses the current
    // PrimaryFacing after Rotation_AI.
    aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
  };

  if (entity.missionTimer > 0) {
    entity.missionTimer--;
    flyCurrentFacing();
    return true;
  }

  switch (entity.aircraftAttackStatus) {
    case LOOK_FOR_TARGET:
      entity.aircraftAttackStatus = TAKE_OFF;
      handled = true;
      break;

    case TAKE_OFF:
      // Reinforcement BADRs are already airborne at FLIGHT_LEVEL, so
      // Process_Take_Off succeeds immediately and Status advances.
      entity.aircraftAttackStatus = FLY_TO_TARGET;
      handled = true;
      break;

    case FLY_TO_TARGET: {
      if (entity.passengers.length === 0) {
        // C++ Can_Fire: Passenger && !Is_Something_Attached() => FIRE_AMMO.
        // Mission_Hunt handles FIRE_AMMO by entering REGROUP and returning the
        // final Normal_Delay + Random_Pick path after the delay below expires.
        entity.aircraftAttackStatus = REGROUP;
        entity.missionTimer = Math.floor(TICKS_PER_SECOND / 2) - 1; // end-of-tick value 6
        handled = true;
        break;
      }

      // C++ Mission_Hunt FLY_TO_TARGET: when Can_Fire does not produce FIRE_OK
      // and PrimaryFacing is not already rotating, set desired facing toward
      // TarCom during the mission dispatch. Rotation_AI then applies this in
      // the same AircraftClass::AI pass before Movement_AI.
      if (entity.facing256 >= 0) {
        if (entity.facing256 === entity.desiredFacing256) {
          const targetWorld = leptonPosToWorld(entity.moveTarget);
          entity.desiredFacing256 = directionTo256(entity.pos, targetWorld);
          entity.desiredFacing = entity.facing;
        }
      } else if (entity.facing === entity.desiredFacing) {
        entity.desiredFacing = directionTo(entity.pos, leptonPosToWorld(entity.moveTarget));
      }

      const dist = leptonDist(
        entity.leptonX, entity.leptonY,
        entity.moveTarget.lx, entity.moveTarget.ly,
      );
      if (dist < 0x0200) {
        entity.aircraftAttackStatus = DROP_BOMBS;
      } else {
        // C++ FLY_TO_TARGET returns TICKS_PER_SECOND/2. Because this TS
        // aircraft handler owns the countdown directly, store the end-of-frame
        // value observed after the C++ CDTimer tick.
        entity.missionTimer = Math.floor(TICKS_PER_SECOND / 2) - 1;
      }
      handled = true;
      break;
    }

    case DROP_BOMBS:
      if (entity.passengers.length > 0 &&
          leptonDist(entity.leptonX, entity.leptonY, entity.moveTarget.lx, entity.moveTarget.ly) < 0x0200) {
        paradropOnePassenger(ctx, entity);
      }
      entity.aircraftAttackStatus = LOOK_FOR_TARGET;
      entity.missionTimer = 0;
      handled = true;
      break;

    case REGROUP: {
      // C++ REGROUP for an empty passenger loaner assigns RETREAT/Commence, but
      // Mission_Hunt still consumes its final Random_Pick(0,2) before returning.
      const prevTag = ScenarioRandom._sourceTag;
      ScenarioRandom._sourceTag = 40010;
      ScenarioRandom.nextInRange(0, 2);
      ScenarioRandom._sourceTag = prevTag;
      if (entity.isALoaner) {
        if (entity.teamRef) entity.teamRef.remove(entity);
        entity.mission = Mission.RETREAT;
        entity.missionQueue = null;
        entity.missionTimer = LOANER_RETREAT_DELAY;
        entity.aircraftAttackStatus = LOOK_FOR_TARGET;
        entity.aircraftState = 'flying';
      }
      handled = true;
      break;
    }

    default:
      entity.aircraftAttackStatus = LOOK_FOR_TARGET;
      handled = true;
      break;
  }

  if (handled && entity.alive) {
    flyCurrentFacing();
  }
  return true;
}

// ── State Machine ──────────────────────────────────────────────────────────────

/** Aircraft state machine — returns true if aircraft handled this tick (skip normal update) */
export function updateAircraft(ctx: AircraftContext, entity: Entity): boolean {
  // Only process aircraft with active state
  if (!entity.stats.isAircraft) return false;

  // Decrement attack cooldowns — aircraft skip normal mission processing
  if (entity.attackCooldown > 0) entity.attackCooldown--;
  if (entity.attackCooldown2 > 0) entity.attackCooldown2--;

  commenceAircraft(ctx, entity);
  if (entity.mission === Mission.UNLOAD &&
      entity.isTransport &&
      !entity.isFixedWing &&
      entity.aircraftState === 'landed') {
    beginTransportMissionUnload(entity);
    return true;
  }

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

      if (entity.isFixedWing &&
          entity.aircraftPassengerCarrier &&
          entity.moveTarget &&
          (entity.mission === Mission.ATTACK || entity.mission === Mission.HUNT)) {
        return updateFixedWingPassengerHunt(ctx, entity);
      }

      // ── C++ Paradrop_Cargo (aircraft.cpp:1442-1468, 1489-1501) ────────────────
      // Fixed-wing passenger transports (BADR) paradrop passengers onto the
      // target cell instead of bombing. C++ Fire_At detects Is_Something_Attached()
      // and dispatches to Paradrop_Cargo, ejecting ONE passenger per firing call
      // with Arm=0 (no rearm delay). Can_Fire (aircraft.cpp:3985-3992) returns
      // FIRE_OK when Distance(target) < 0x0200 leptons (2 cells).
      //
      // Trigger: fixed-wing with passengers + a moveTarget (set by the team
      // script's TMISSION_ATT_WAYPT in team.ts:coordinateAttack). When within
      // 2 cells of the drop cell, eject one passenger per tick. After the last
      // passenger is dropped, switch to RETREAT so the BADR (IsALoaner) flies
      // off-map instead of trying to land at a non-existent airfield.
      if (entity.isFixedWing && entity.passengers.length > 0 && entity.moveTarget) {
        const dropDist = worldDist(entity.pos, leptonPosToWorld(entity.moveTarget));
        if (dropDist <= 2) { // worldDist returns cells; 2 cells ≈ 0x0200 leptons
          const passenger = entity.passengers.shift()!;
          passenger.alive = true;
          if (passenger.stats.isInfantry) {
            const spot = closestInfantryUnlimboSpot(ctx, passenger, entity.leptonX, entity.leptonY);
            passenger.leptonX = spot.lx;
            passenger.leptonY = spot.ly;
            passenger.syncPosFromLeptons();
            passenger.subCell = spot.subCell;
            passenger.claimedCellIdx = spot.cellIdx;
            passenger.claimedSubCell = spot.subCell;
          } else {
            passenger.setPosition(entity.pos.x, entity.pos.y);
          }
          passenger.transportRef = null;
          passenger.isTethered = false;
          passenger.inLimbo = false;
          // C++ ObjectClass::Paradrop (object.cpp:1853-1866):
          //   Height = FLIGHT_LEVEL; IsFalling = true; attach parachute anim.
          // C++ TechnoClass::AI (techno.cpp:2346) returns early for non-aircraft
          // while Height > 0, so the newly appended passenger can enter Logic this
          // same tick without running infantry MissionClass::AI/RNG.
          passenger.isFalling = true;
          passenger.fallHeightLeptons = Entity.FLIGHT_LEVEL_LEPTONS;
          passenger.fallRiser = 0;
          passenger.fallHasAttachedAnim = true;
          passenger.flightAltitude = leptonToPixel(passenger.fallHeightLeptons);
          // C++ InfantryClass::Paradrop (infantry.cpp:4183-4194):
          // human player → MISSION_GUARD, AI → MISSION_HUNT. Route through
          // Assign_Mission so Commence timing remains C++-faithful after landing.
          assignMission(passenger, passenger.isPlayerUnit ? Mission.GUARD : Mission.HUNT);
          ctx.entities.push(passenger);
          ctx.entityById.set(passenger.id, passenger);

          // Do not force RETREAT after the last drop. C++ Paradrop_Cargo only
          // detaches the passenger (and may assign a mission through the normal
          // aircraft mission queue); IsALoaner retreat happens later in
          // Mission_Hunt REGROUP (aircraft.cpp:802-818), not at detach time.
          // Continue flight this tick (do not return early so the BADR keeps
          // moving forward — fixed-wings can't stop in midair).
        }
      }

      // If we have an attack target, close to weapon range
      if (entity.mission === Mission.ATTACK) {
        const targetPos = getAircraftTargetPos(entity);
        if (!targetPos) {
          // C++ team.cpp:1705 — Coordinate_Attack assigns MISSION_ATTACK but
          // leaves TarCom as the mission target (waypoint cell) for TMISSION_ATT_WAYPT.
          // For fixed-wing passenger transports (BADR), that's a paradrop run:
          // keep flying toward the drop cell via moveTarget. The paradrop check
          // above ejects passengers when within 2 cells; returning to base here
          // would crash-land the BADR (no airfield for fixed-wings).
          if (entity.isFixedWing && entity.moveTarget && entity.passengers.length > 0) {
            aircraftFlyInFacing(entity, entity.moveTarget, ctx.movementSpeed(entity));
            return true;
          }
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
        // C++ aircraft.cpp:1309-1367 Mission_Retreat.
        // Helicopters do not compute a NavCom/nearest-edge point here. FACE_MAP_EDGE
        // sets full speed and desired facing from House->Control.Edge, then
        // KEEP_FLYING just lets Movement_AI carry the aircraft off-map.
        if (entity.missionTimer > 0) {
          entity.missionTimer--;
        } else if (!entity.isFixedWing) {
          // C++ aircraft.cpp:1375-1377 — helicopter Mission_Retreat KEEP_FLYING
          // returns MissionControl[RETREAT].Normal_Delay() + Random_Pick(0,2).
          // Store the observed end-of-frame value: the C++ CDTimer has already
          // consumed one tick by the time agent_get_state reports `mt`.
          const prevTag = ScenarioRandom._sourceTag;
          ScenarioRandom._sourceTag = 40030;
          const jitter = ScenarioRandom.nextInRange(0, 2);
          ScenarioRandom._sourceTag = prevTag;
          entity.missionTimer = LOANER_RETREAT_DELAY - 1 + jitter;
        } else {
          // Fixed-wing Mission_Retreat does not use Random_Pick. At flight
          // level C++ returns TICKS_PER_SECOND*10; below it returns 3 while
          // increasing Height. TS represents fixed-wing airborne state at
          // flight level in pixels.
          entity.missionTimer = TICKS_PER_SECOND * 10 - 1;
        }
        if (!entity.isFixedWing) {
          entity.aircraftSpeedFraction = 1.0;
          entity.desiredFacing256 = houseEdgeDirection256(ctx, entity.house);
          entity.desiredFacing = Math.round(entity.desiredFacing256 / 32) & 7;
        }
        // Check if at map edge — exit
        const ec = entity.cell;
        if (ec.cx <= ctx.map.boundsX || ec.cx >= ctx.map.boundsX + ctx.map.boundsW - 1 ||
            ec.cy <= ctx.map.boundsY || ec.cy >= ctx.map.boundsY + ctx.map.boundsH - 1) {
          handleMapExit(ctx, entity);
          return true;
        }
        if (entity.isFixedWing && entity.moveTarget) {
          aircraftFlyInFacing(entity, entity.moveTarget, ctx.movementSpeed(entity));
        } else {
          aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
        }
      } else if (entity.mission === Mission.MOVE && entity.moveTarget) {
        // Check if aircraft is at map edge with out-of-bounds target — exit map
        const ec = entity.cell;
        const tc = worldToCell(leptonToPixel(entity.moveTarget.lx), leptonToPixel(entity.moveTarget.ly));
        if (!ctx.map.inBounds(tc.cx, tc.cy) &&
            (ec.cx <= ctx.map.boundsX || ec.cx >= ctx.map.boundsX + ctx.map.boundsW - 1 ||
             ec.cy <= ctx.map.boundsY || ec.cy >= ctx.map.boundsY + ctx.map.boundsH - 1)) {
          handleMapExit(ctx, entity);
          return true;
        }
        // Simple move — fly to destination (C++ curved path)
        if (aircraftFlyInFacing(entity, entity.moveTarget, ctx.movementSpeed(entity))) {
          // Arrived — check if destination was out of bounds (aircraft map exit)
          const arrCell = worldToCell(leptonToPixel(entity.moveTarget.lx), leptonToPixel(entity.moveTarget.ly));
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

    // ── C++ AircraftClass::Mission_Unload state machine (aircraft.cpp:1068-1216) ──
    // Helicopters with cargo: SEARCH_FOR_LZ → FLY_TO_LZ → LAND → UNLOAD → TAKE_OFF

    case 'unload_search': {
      // C++ SEARCH_FOR_LZ → sets Status=FLY_TO_LZ → falls through to
      // return(Normal_Delay + Random_Pick(0,2)) = 14-16 tick delay.
      //
      // Empirical WASM data shows:
      //   tick 1-5: TRAN at (63,44) — stationary (SpeedAdd=0 from FlyClass constructor)
      //   tick 10: TRAN at (62,45) — started moving (speed set by some init code)
      //   tick 50: TRAN at (61,48) — continued flying
      //
      // The TRAN is stationary for the first ~7 ticks, then begins drifting
      // in its initial facing before the FLY_TO_LZ controlled approach starts.
      entity._unloadSearchTicks++;

      // C++ AircraftClass::AI sets speed when at FLIGHT_LEVEL — drift begins
      // immediately in initial facing. Process_Fly_To hasn't been called yet,
      // so no course correction. Drift at full speed from tick 1.
      if (entity.facing256 >= 0) {
        const speed = ctx.movementSpeed(entity);
        const maxSpeedLeptons = Math.floor(speed * entity.speedBias / LP);
        const speedAdd = aircraftSpeedAdd(maxSpeedLeptons);
        const actual = speedAdd + entity.speedAccum;
        const remainder = actual % PIXEL_LEPTON_W;
        entity.speedAccum = remainder;
        const moveLeptons = actual - remainder;
        if (moveLeptons > 0) {
          const f = entity.facing256;
          entity.leptonX += (moveLeptons * COS_TABLE_256[f]) >> 7;
          entity.leptonY -= (moveLeptons * SIN_TABLE_256[f]) >> 7;
          entity.syncPosFromLeptons();
        }
      }

      if (entity._unloadSearchTicks >= 14) {
        entity._unloadSearchTicks = 0;
        // C++ SEARCH_FOR_LZ returns into MissionClass timing before the first
        // FLY_TO_LZ Process_Fly_To course update. Empirically this leaves one
        // more initial-facing step, then updates facing/speed on the next tick.
        entity._flyToTicks = 3;
        entity.aircraftState = 'unload_fly';
      }
      return true;
    }

    case 'unload_fly': {
      // C++ FLY_TO_LZ (lines 1120-1138): fly toward LZ with approach slowdown.
      // The slowdown approximates WASM's ~139 tick total deployment time (search
      // 14 + approach 104 + land 24 + eject 1 = 143 ≈ WASM's 139).
      if (!entity.moveTarget) { entity.aircraftState = 'returning'; return true; }
      const arrived = aircraftFlyInFacing(entity, entity.moveTarget, ctx.movementSpeed(entity));
      if (arrived) {
        entity.aircraftState = 'unload_land';
      }
      return true;
    }

    case 'unload_land': {
      // C++ LAND_ON_LZ (lines 1144-1152): descend. Height decrements each tick.
      if (entity.flightAltitude > 0) {
        entity.flightAltitude--;
      }
      if (entity.flightAltitude <= 0) {
        entity.flightAltitude = 0;
        entity.aircraftSpeedFraction = 0;
        // C++ aircraft.cpp:1837-1848 Mission_Move LAND:
        // Process_Landing clears IsLanding. If no queue is pending, it enters
        // idle mode; for a passenger-carrying loaner transport, Enter_Idle_Mode
        // selects MISSION_GUARD while the team keeps MISSION_UNLOAD queued via
        // TMission_Unload. Do not jump directly to UNLOAD_PASSENGERS here.
        entity.moveTarget = null;
        if (entity.missionQueue === null) {
          entity.mission = Mission.GUARD;
          entity.missionTimer = TRANSPORT_GUARD_DELAY;
        }
        entity.aircraftState = 'landed';
      }
      return true;
    }

    case 'unload_wait': {
      // C++ SEARCH_FOR_LZ -> UNLOAD_PASSENGERS transition. The transition itself
      // returns MissionControl[UNLOAD].Normal_Delay() + Random_Pick(0,2), so no
      // passenger is detached on this dispatch.
      if (entity.missionTimer > 0) {
        entity.missionTimer--;
        return true;
      }
      entity.aircraftState = 'unload_eject';
      entity.missionTimer = 13 + ScenarioRandom.nextInRange(0, 2);
      return true;
    }

    case 'unload_eject': {
      if (entity.mission === Mission.RETREAT && entity.passengers.length === 0) {
        if (entity.missionTimer > 0) {
          entity.missionTimer--;
          return true;
        }
        entity.aircraftState = 'takeoff';
        return true;
      }

      if (entity.missionTimer > 0) {
        entity.missionTimer--;
        return true;
      }

      // C++ UNLOAD_PASSENGERS (aircraft.cpp:1164-1187): a transport does not
      // detach the next passenger while it is still tethered to the previously
      // unloaded passenger. The function still falls through to the final
      // Mission_Unload Random_Pick(0,2), so the next check is delayed by the
      // normal unload cadence.
      const nextUnloadDelay = 13 + ScenarioRandom.nextInRange(0, 2);
      if (entity.isTethered) {
        entity.missionTimer = nextUnloadDelay;
        return true;
      }
      if (entity.passengers.length > 0) {
        const passenger = entity.passengers.shift()!;
        const exitCell = findAircraftExitCell(ctx, entity, passenger);
        const exitTarget = {
          lx: exitCell.cx * LEPTON_SIZE + LEPTON_SIZE / 2,
          ly: exitCell.cy * LEPTON_SIZE + LEPTON_SIZE / 2,
        };

        // C++ Exit_Object: Unlimbo at transport Coord, then Assign_Mission(MOVE)
        // and Assign_Destination(adjacent cell) so the unit clears the LZ.
        passenger.alive = true;
        if (passenger.stats.isInfantry) {
          const spot = closestInfantryUnlimboSpot(ctx, passenger, entity.leptonX, entity.leptonY);
          passenger.leptonX = spot.lx;
          passenger.leptonY = spot.ly;
          passenger.syncPosFromLeptons();
          passenger.subCell = spot.subCell;
          passenger.claimedCellIdx = spot.cellIdx;
          passenger.claimedSubCell = spot.subCell;
        } else {
          passenger.setPosition(entity.pos.x, entity.pos.y);
        }
        // C++ TechnoClass::Unlimbo runs Enter_Idle_Mode(true) + Commence before
        // AircraftClass::Exit_Object queues MISSION_MOVE. This resets stale
        // cargo animation state (for example a team-activation gesture) and
        // leaves the passenger in GUARD with Timer=0, so its same-tick
        // FootClass::AI can run Mission_Guard before Commence promotes MOVE.
        passenger.mission = ctx.idleMission(passenger);
        passenger.missionQueue = null;
        passenger.missionTimer = 0;
        // TechnoClass::Unlimbo starts from DO_NOTHING; InfantryClass::AI's
        // Commence gate allows DO_NOTHING, but Is_Ready_To_Random_Animate does
        // not. This prevents an unloaded passenger from taking a random idle
        // animation before its queued MOVE commences in the same tick.
        passenger.doing = 'nothing';
        passenger.nonInterruptAnimTicks = 0;
        passenger.nonInterruptAnimSetTick = -1;
        passenger.firePrepActive = false;
        passenger.isFiringAnim = false;
        assignMission(passenger, Mission.MOVE);
        passenger.moveTarget = exitTarget;
        passenger.moveQueue = [];
        passenger.path = [];
        passenger.pathIndex = 0;
        passenger.isDriving = false;
        if (!passenger.stats.isInfantry) {
          passenger.claimedCellIdx = -1;
          passenger.claimedSubCell = -1;
        }
        passenger.teamMissions = [];
        passenger.teamMissionIndex = 0;
        passenger.teamMissionWaiting = 0;
        // C++ AircraftClass::Exit_Object establishes radio contact via
        // RADIO_HELLO/RADIO_UNLOAD. InfantryClass::Per_Cell_Process cuts this
        // tether at the first cell boundary, then starts the unload gesture
        // (infantry.cpp:878-906), which blocks Commence until the gesture ends.
        passenger.transportRef = entity;
        passenger.isTethered = true;
        entity.isTethered = true;
        passenger.inLimbo = false;
        ctx.entities.push(passenger);
        ctx.entityById.set(passenger.id, passenger);
      }
      if (entity.passengers.length === 0) {
        // All passengers unloaded — enter idle or retreat
        entity.moveTarget = null;
        entity.missionQueue = null;
        if (entity.isALoaner) {
          entity.mission = Mission.RETREAT;
          entity.missionTimer = LOANER_RETREAT_DELAY;
          entity.aircraftState = 'unload_eject';
          entity.flightAltitude = 0;
          entity.aircraftSpeedFraction = 0;
        } else {
          entity.mission = ctx.idleMission(entity);
          entity.aircraftState = 'returning';
          entity.flightAltitude = 1; // start climbing
        }
      } else {
        entity.missionTimer = nextUnloadDelay;
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
        entity.setPosition(padPos.x, padPos.y);
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
  // C++ aircraft.cpp: paratrooper transports (BADRs with passengers) do not
  // execute attack runs — they fly to the drop cell and Paradrop_Cargo. The
  // Mission_Attack path is for empty BADRs/MIGs/YAKs strafing real targets.
  // Without this check, a BADR carrying SCG04EA's para1 E1s was firing its
  // ParaBomb weapon (300 HE damage) at the player MCV en route, killing it.
  if (entity.passengers.length > 0) {
    // Switch back to flying state — let the 'flying' case in updateAircraft
    // handle the paradrop check (within 2 cells of moveTarget → eject one).
    entity.aircraftState = 'flying';
    entity.target = null;
    entity.targetStructure = null;
    return true;
  }

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
  entity.rotTickedThisFrame = false;
  if (entity.facing256 >= 0) {
    entity.desiredFacing256 = directionTo256(entity.pos, targetPos);
    entity.tickRotation256();
  } else {
    entity.desiredFacing = directionTo(entity.pos, targetPos);
    entity.tickRotation();
  }

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
