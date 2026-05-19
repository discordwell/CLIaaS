/**
 * Aircraft state machine subsystem — takeoff, landing, attack runs, helicopter hover.
 * Extracted from Game class (index.ts) to isolate aircraft flight logic.
 */

import {
  type WorldPos, type WeaponStats, type LeptonPos,
  CELL_SIZE, LEPTON_SIZE, MAP_CELLS, Mission, AnimState, House, UnitType,
  worldDist, directionTo, directionToLeptons256, worldToCell, leptonDist, leptonToPixel, pixelToLepton, leptonToCell, DIR_DX, DIR_DY,
  CIVILIAN_UNIT_TYPES, cellTargetToLepton, coordTargetRoundTripLepton,
  COS_TABLE_256, SIN_TABLE_256, SUBCELL_LEPTON_OFFSETS,
} from './types';
// Re-export tables for backward compatibility (canonical definitions now in types.ts).
export { COS_TABLE_256, SIN_TABLE_256 };
import { Entity, CloakState, dir256ToFacing8, dir256ToFacing32, attachFallingParachuteAnim } from './entity';
import { LP, PIXEL_LEPTON_W } from './tracks';
import { type MapStructure, STRUCTURE_SIZE } from './scenario';
import { type GameMap, MoveResult } from './map';
import { ScenarioRandom } from './random';
import { assignMission } from './missionLifecycle';

/** Helper: convert LeptonPos to WorldPos (pixel space) for rendering/distance APIs */
function leptonPosToWorld(lp: LeptonPos): WorldPos {
  return { x: lp.lx * CELL_SIZE / LEPTON_SIZE, y: lp.ly * CELL_SIZE / LEPTON_SIZE };
}

function clearFootPath(entity: Entity): void {
  entity.path = [];
  entity.pathIndex = 0;
  entity.drivePathFacings = [];
  entity.drivePathHeadCleared = false;
}

/** Convert world positions to a C++ 256-step DirType facing (0=N, 64=E, 128=S, 192=W).
 *  C++ Direction() routes through Desired_Facing256: integer lepton math, not atan2. */
export function directionTo256(from: WorldPos, to: WorldPos): number {
  return directionToLeptons256(
    pixelToLepton(from.x),
    pixelToLepton(from.y),
    pixelToLepton(to.x),
    pixelToLepton(to.y),
  );
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

const ATTACK_VALIDATE_AZ = 0;
const ATTACK_PICK_ATTACK_LOCATION = 1;
const ATTACK_TAKE_OFF = 2;
const ATTACK_FLY_TO_POSITION = 3;
const ATTACK_FIRE_AT_TARGET = 4;
const ATTACK_FIRE_AT_TARGET2 = 5;
const ATTACK_RETURN_TO_BASE = 6;
const RETREAT_TAKE_OFF = 0;
const RETREAT_FACE_MAP_EDGE = 1;
const RETREAT_KEEP_FLYING = 2;

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
  fireWeaponAtCoord?(attacker: Entity, weapon: WeaponStats, impact: WorldPos): void;
  /** C++ CellClass::Incoming(threat, forced=true) for aircraft fire/drop target cells. */
  incomingThreatScatterCell?(cx: number, cy: number, threat: Entity): void;
  /** C++ HouseClass::IsHuman/player-control gate. */
  isHumanControlledHouse?: (house: House) => boolean;
  /** C++ house.cpp:293,303: ROFBias — difficulty-scaled rate-of-fire */
  getROFBias(house: House): number;
  /** C++ house.cpp:291,301: AirspeedBias; fixed-wing landing speed divides by this. */
  getAirspeedBias?(house: House): number;
  /** C++ house.cpp:4160: Power_Fraction() = Power/Drain, capped at 1.0.
   *  Used by building.cpp:4023 for rearm delay scaling. */
  getPowerFraction(house: House): number;
  /** Current C++-style Logic.Count() for a newly submitted object. */
  logicIndexHintForNewObject?: () => number;
  /** Release an object's current C++ Logic slot when Limbo/delete removes it. */
  releaseLogicSlotForEntity?: (entity: Entity) => void;
  /** Reserve one C++ AnimClass heap slot. */
  reserveAnimSlot?: () => boolean;
  /** C++ TeamClass::Remove path used when loaner aircraft break off to retreat. */
  removeFromTeamForRetreat?: (entity: Entity) => void;
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
    if (s.dockedAircraft !== undefined && s.dockedAircraft > 0 && s.dockedAircraft !== entity.id) {
      const occupant = ctx.entityById.get(s.dockedAircraft);
      if (occupant && occupant.alive && !occupant.inLimbo) continue; // occupied by another aircraft
      s.dockedAircraft = undefined;
    }
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

function getFixedWingAttackTargetPos(entity: Entity): WorldPos | null {
  const explicitTarget = getAircraftTargetPos(entity);
  if (explicitTarget) return explicitTarget;
  if (entity.isFixedWing &&
      entity.moveTarget &&
      (entity.mission === Mission.ATTACK || entity.mission === Mission.HUNT)) {
    return leptonPosToWorld(entity.moveTarget);
  }
  return null;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function currentAircraftFacing256(entity: Entity): number {
  if (entity.facing256 >= 0) return entity.facing256 & 0xff;
  if (entity.bodyFacing256 >= 0) return entity.bodyFacing256 & 0xff;
  return (entity.facing * 32) & 0xff;
}

function currentFixedWingSecondaryFacing256(entity: Entity): number {
  if (entity.turretFacing256 >= 0) return entity.turretFacing256 & 0xff;
  return currentAircraftFacing256(entity);
}

function currentDesiredAircraftFacing256(entity: Entity): number {
  if (entity.facing256 >= 0 && entity.desiredFacing256 >= 0) return entity.desiredFacing256 & 0xff;
  if (entity.desiredFacing256 >= 0) return entity.desiredFacing256 & 0xff;
  return (entity.desiredFacing * 32) & 0xff;
}

function facingDiff256(a: number, b: number): number {
  let diff = (a - b) & 0xff;
  if (diff > 127) diff -= 256;
  return Math.abs(diff);
}

function signedFacingDelta256(current: number, desired: number): number {
  let diff = (desired - current) & 0xff;
  if (diff >= 128) diff -= 256;
  return diff;
}

function setAircraftPrimaryFacing256(entity: Entity, dir256: number): void {
  const dir = dir256 & 0xff;
  entity.facing256 = dir;
  entity.desiredFacing256 = dir;
  entity.facing = dir256ToFacing8(dir);
  entity.desiredFacing = entity.facing;
  entity.bodyFacing32 = dir256ToFacing32(dir);
}

function setDesiredAircraftSecondaryFacing256(entity: Entity, dir256: number): void {
  const dir = dir256 & 0xff;
  entity.desiredTurretFacing256 = dir;
  entity.desiredTurretFacing = dir256ToFacing8(dir);
}

function rotateAircraftSecondaryFacing(entity: Entity): void {
  if (!entity.stats.isAircraft || entity.isFixedWing) return;

  if (entity.turretFacing256 < 0 ||
      dir256ToFacing32(entity.turretFacing256) !== entity.turretFacing32 ||
      dir256ToFacing8(entity.turretFacing256) !== entity.turretFacing) {
    entity.turretFacing32 = entity.turretFacing * 4;
    entity.turretFacing256 = (entity.turretFacing * 32) & 0xff;
  }
  if (entity.desiredTurretFacing256 < 0 ||
      dir256ToFacing8(entity.desiredTurretFacing256) !== entity.desiredTurretFacing) {
    entity.desiredTurretFacing256 = (entity.desiredTurretFacing * 32) & 0xff;
  }

  const desired256 = entity.desiredTurretFacing256 & 0xff;
  if (entity.turretFacing256 === desired256) {
    entity.turretIsRotating = false;
    entity.turretFacing = dir256ToFacing8(entity.turretFacing256);
    entity.desiredTurretFacing = dir256ToFacing8(desired256);
    entity.turretFacing32 = dir256ToFacing32(entity.turretFacing256);
    return;
  }
  if (entity.turretRotTickedThisFrame) return;
  entity.turretRotTickedThisFrame = true;

  const rate = Math.min(entity.stats.rot, 127);
  if (rate > 0) {
    let diff = (desired256 - entity.turretFacing256) & 0xff;
    if (diff >= 128) diff -= 256;
    if (Math.abs(diff) < rate) {
      entity.turretFacing256 = desired256;
    } else if (diff < 0) {
      entity.turretFacing256 = (entity.turretFacing256 - rate + 256) & 0xff;
    } else {
      entity.turretFacing256 = (entity.turretFacing256 + rate) & 0xff;
    }
  }

  entity.turretFacing = dir256ToFacing8(entity.turretFacing256);
  entity.desiredTurretFacing = dir256ToFacing8(desired256);
  entity.turretFacing32 = dir256ToFacing32(entity.turretFacing256);
  entity.turretIsRotating = entity.turretFacing256 !== desired256;
}

function syncFixedWingSecondaryFacing(entity: Entity): void {
  if (!entity.isFixedWing) return;
  const current = currentAircraftFacing256(entity);
  const desired = currentDesiredAircraftFacing256(entity);
  entity.turretFacing256 = current;
  entity.desiredTurretFacing256 = desired;
  entity.turretFacing = dir256ToFacing8(current);
  entity.desiredTurretFacing = dir256ToFacing8(desired);
  entity.turretFacing32 = dir256ToFacing32(current);
}

function setDesiredAircraftFacing256(entity: Entity, dir256: number): void {
  const dir = dir256 & 0xff;
  if (entity.facing256 >= 0) {
    entity.desiredFacing256 = dir;
    entity.desiredFacing = Math.round(dir / 32) & 7;
  } else {
    entity.desiredFacing256 = dir;
    entity.desiredFacing = Math.round(dir / 32) & 7;
  }
}

function fixedWingTargetLeptons(targetPos: WorldPos): { lx: number; ly: number } {
  return { lx: pixelToLepton(targetPos.x), ly: pixelToLepton(targetPos.y) };
}

type FixedWingFireState = 'ok' | 'ammo' | 'rearm' | 'range' | 'facing';
type HelicopterFireState = 'ok' | 'ammo' | 'rearm' | 'range' | 'cloaked' | 'cant';

function fixedWingCanFire(entity: Entity, targetPos: WorldPos, weapon: WeaponStats): FixedWingFireState {
  if (entity.attackCooldownAtLogicStart > 0) return 'rearm';
  if (entity.ammo === 0) return 'ammo';

  const target = fixedWingTargetLeptons(targetPos);
  const fireCoord = typeof entity.fireCoordForWeapon === 'function'
    ? entity.fireCoordForWeapon(weapon)
    : { lx: entity.leptonX, ly: entity.leptonY };
  if (leptonDist(fireCoord.lx, fireCoord.ly, target.lx, target.ly) > weapon.range * LEPTON_SIZE) {
    return 'range';
  }

  // C++ AircraftClass::Can_Fire: fixed-wing combat normally requires
  // ABS(PrimaryFacing.Difference(Direction(TarCom))) <= 8 DirType units.
  // Parachuted bullets set the C++ `fudge` flag and widen that to 16.
  const targetDir = directionToLeptons256(entity.leptonX, entity.leptonY, target.lx, target.ly);
  const facingTolerance = weapon.isParachuted ? 16 : 8;
  return facingDiff256(currentAircraftFacing256(entity), targetDir) > facingTolerance ? 'facing' : 'ok';
}

function fixedWingMissionHuntFinalDelay(entity: Entity): void {
  const prevTag = ScenarioRandom._sourceTag;
  ScenarioRandom._sourceTag = 40010;
  const jitter = ScenarioRandom.nextInRange(0, 2);
  ScenarioRandom._sourceTag = prevTag;
  entity.missionTimer = 13 + jitter;
}

function enterFixedWingDockingMission(ctx: AircraftContext, entity: Entity): void {
  if (entity.isALoaner) {
    entity.mission = Mission.RETREAT;
    entity.missionTimer = 0;
    entity.aircraftState = 'flying';
    entity.aircraftDockingStructure = -1;
    entity.moveTarget = null;
    entity.missionQueue = null;
    return;
  }

  const padIdx = findLandingPad(ctx, entity);
  if (padIdx >= 0) {
    entity.mission = Mission.ENTER;
    entity.missionTimer = 0;
    entity.aircraftState = 'returning';
    entity.aircraftEnterStatus = 0;
    entity.aircraftDockingStructure = padIdx;
    ctx.structures[padIdx].dockedAircraft = entity.id;
  } else {
    entity.mission = Mission.RETREAT;
    entity.missionTimer = 0;
    entity.aircraftState = 'flying';
    entity.aircraftDockingStructure = -1;
  }
  entity.moveTarget = null;
  entity.missionQueue = null;
}

function fixedWingForwardImpact(entity: Entity, weapon: WeaponStats): WorldPos {
  const distance = Math.max(0, Math.trunc(weapon.range * LEPTON_SIZE) - 0x0200);
  const dir = currentFixedWingSecondaryFacing256(entity);
  const rawLX = entity.leptonX + ((COS_TABLE_256[dir] * distance) >> 7);
  const rawLY = entity.leptonY - ((SIN_TABLE_256[dir] * distance) >> 7);
  const lx = coordTargetRoundTripLepton(rawLX);
  const ly = coordTargetRoundTripLepton(rawLY);
  return { x: lx * CELL_SIZE / LEPTON_SIZE, y: ly * CELL_SIZE / LEPTON_SIZE };
}

function fireFixedWingShot(
  ctx: AircraftContext,
  entity: Entity,
  weapon: WeaponStats,
  targetPos: WorldPos,
): void {
  const homing = (weapon.projectileROT ?? 0) > 0;
  if (!homing) {
    const impact = fixedWingForwardImpact(entity, weapon);
    if (ctx.fireWeaponAtCoord) {
      ctx.fireWeaponAtCoord(entity, weapon, impact);
      return;
    }
  }

  if (entity.target?.alive) {
    ctx.fireWeaponAt(entity, entity.target, weapon);
  } else if (entity.targetStructure && (entity.targetStructure as MapStructure).alive) {
    ctx.fireWeaponAtStructure(entity, entity.targetStructure as MapStructure, weapon);
  } else if (ctx.fireWeaponAtCoord) {
    ctx.fireWeaponAtCoord(entity, weapon, targetPos);
  }
}

/** C++ _Counts_As_Civ_Evac parity: checks CIVILIAN_UNIT_TYPES + IsTanyaEvac scenario flag.
 *  Source: aircraft.cpp:116-159. Tanya only counts when Scen.IsTanyaEvac is set. */
function countsAsCivEvac(ctx: AircraftContext, unitType: string): boolean {
  if (CIVILIAN_UNIT_TYPES.has(unitType)) return true;
  if (ctx.isTanyaEvac && unitType === 'E7') return true;
  return false;
}

const AIRCRAFT_FAST_MISSION_DELAY = 14;
const AIRCRAFT_GUARD_NORMAL_DELAY = 42;
const AIRCRAFT_AREA_GUARD_NORMAL_DELAY = 70;
const LOANER_RETREAT_DELAY = 88;
const TRANSPORT_GUARD_DELAY = TICKS_PER_SECOND * 3;
const ENTER_INITIAL = 0;
const ENTER_TAKEOFF = 1;
const ENTER_ALTITUDE = 2;
const ENTER_STACK = 3;
const ENTER_DOWNWIND = 4;
const ENTER_CROSSWIND = 5;
const ENTER_TRAVEL = 6;
const ENTER_LANDING = 7;
const FIXED_MOVE_TAKE_OFF = 0;
const FIXED_MOVE_FLY_TO_TARGET = 1;
const MOVE_VALIDATE_LZ = 0;
const MOVE_TAKE_OFF = 1;
const MOVE_FLY_TO_LZ = 2;
const MOVE_LAND = 3;
const AIRCRAFT_HEIGHT_STEP_LEPTONS = Math.trunc((LEPTON_SIZE + CELL_SIZE / 2) / CELL_SIZE);
const AIRCRAFT_GROUND_LAYER_HEIGHT =
  Entity.FLIGHT_LEVEL_LEPTONS - Math.trunc(Entity.FLIGHT_LEVEL_LEPTONS / 3);

function aircraftHeightToPixel(height: number): number {
  return Math.trunc((height * CELL_SIZE + LEPTON_SIZE / 2) / LEPTON_SIZE);
}

function pixelToAircraftHeight(pixel: number): number {
  return Math.trunc((pixel * LEPTON_SIZE + CELL_SIZE / 2) / CELL_SIZE);
}

function setAircraftHeight(entity: Entity, height: number): void {
  const clamped = Math.max(0, Math.min(Entity.FLIGHT_LEVEL_LEPTONS, Math.trunc(height)));
  entity.aircraftHeightLeptons = clamped;
  entity.flightAltitude = aircraftHeightToPixel(clamped);
}

function ensureAircraftHeight(entity: Entity): void {
  if (aircraftHeightToPixel(entity.aircraftHeightLeptons) !== entity.flightAltitude) {
    setAircraftHeight(entity, pixelToAircraftHeight(entity.flightAltitude));
  }
}

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

function xypCoordToLeptons(px: number, py: number): LeptonPos {
  return {
    lx: Math.trunc((px * LEPTON_SIZE) / CELL_SIZE),
    ly: Math.trunc((py * LEPTON_SIZE) / CELL_SIZE),
  };
}

function buildingCenterCell(s: MapStructure): { cx: number; cy: number } {
  const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
  // C++ BuildingClass::Center_Coord uses CenterOffset[BSIZE_*]. Coord_Cell()
  // floors 0xff sub-cell offsets back into the top/left cell for even sizes.
  return {
    cx: s.cx + Math.floor((w - 1) / 2),
    cy: s.cy + Math.floor((h - 1) / 2),
  };
}

function fixedWingLandingCheckpoint(ctx: AircraftContext, s: MapStructure, status: number): LeptonPos {
  const center = buildingCenterCell(s);
  let xoffset = 6;
  let yoffset = 5;
  if (status === ENTER_STACK) xoffset = 0;
  if (status === ENTER_CROSSWIND) yoffset = 0;
  if ((center.cx - ctx.map.boundsX) > ctx.map.boundsW / 2) xoffset = -xoffset;
  if ((center.cy - ctx.map.boundsY) > ctx.map.boundsH / 2) yoffset = -yoffset;
  return cellTargetToLepton(center.cx + xoffset, center.cy + yoffset);
}

function buildingDockingLeptons(s: MapStructure): LeptonPos {
  if (s.type === 'AFLD') {
    const off = xypCoordToLeptons(CELL_SIZE + CELL_SIZE / 2, 28);
    return { lx: s.cx * LEPTON_SIZE + off.lx, ly: s.cy * LEPTON_SIZE + off.ly };
  }
  if (s.type === 'HPAD') {
    const off = xypCoordToLeptons(24, 18);
    return { lx: s.cx * LEPTON_SIZE + off.lx, ly: s.cy * LEPTON_SIZE + off.ly };
  }
  const center = buildingCenterCell(s);
  return cellTargetToLepton(center.cx, center.cy);
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
  ignoreOccupancy = false,
): { lx: number; ly: number; subCell: number; cellIdx: number } | null {
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

  const slots = ignoreOccupancy ? undefined : ctx.map.subCellOccupancy.get(cellIdx);
  if (!ignoreOccupancy && ctx.map.hasVehicleOccupancy(cx, cy)) return null;
  const sequence: number[][] = [
    [1, 2, 3, 4],
    [0, 2, 3, 4],
    [0, 1, 4, 3],
    [0, 1, 4, 2],
    [0, 2, 3, 1],
  ];
  const alternate: number[][] = [
    [1, 2, 3, 4],
    [2, 3, 4, 1],
    [3, 4, 1, 2],
    [4, 1, 2, 3],
  ];
  let subCell = preferred;
  if (slots?.[subCell] && slots[subCell] !== passenger.id) {
    // C++ cell.cpp:1847-1850 randomizes the equidistant corner order only
    // when the requested center spot is occupied. The call inherits the current
    // source tag; for aircraft paradrops this shows up under Aircraft_FootAI.
    const candidates = preferred === 0
      ? alternate[ScenarioRandom.nextInRange(0, 3)]
      : sequence[preferred];
    for (const candidate of candidates) {
      if (!slots[candidate] || slots[candidate] === passenger.id) {
        subCell = candidate;
        break;
      }
    }
    if (slots[subCell] && slots[subCell] !== passenger.id) return null;
  }

  const spot = SUBCELL_LEPTON_OFFSETS[subCell];
  if (!ignoreOccupancy) {
    if (ctx.map.canEnterCell(cx, cy, false, undefined, true, passenger.id) !== MoveResult.OK) {
      return null;
    }
    const occupiedSlots = ctx.map.subCellOccupancy.get(cellIdx);
    if (occupiedSlots) {
      for (const occupantId of occupiedSlots) {
        if (occupantId === 0 || occupantId === passenger.id) continue;
        const occupant = ctx.entityById.get(occupantId);
        if (occupant?.stats.isInfantry && !ctx.isAllied(passenger.house, occupant.house)) {
          return null;
        }
      }
    }
  }
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
  const queuedMission = entity.missionQueue;
  entity.mission = entity.missionQueue;
  entity.missionQueue = null;
  entity.missionQueueSetTick = -1;
  entity.missionTimer = 0;
  if (queuedMission === Mission.MOVE && !entity.isFixedWing) {
    entity.aircraftMoveStatus = MOVE_TAKE_OFF;
    entity._flyToTicks = 0;
    const savedTag = ScenarioRandom._sourceTag;
    if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = 40040;
    entity.missionTimer = 14 + ScenarioRandom.nextInRange(0, 2);
    if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = savedTag;
  }
}

function aircraftMissionNormalDelay(entity: Entity): number {
  switch (entity.mission) {
    case Mission.GUARD:
      return AIRCRAFT_GUARD_NORMAL_DELAY;
    case Mission.AREA_GUARD:
      return AIRCRAFT_AREA_GUARD_NORMAL_DELAY;
    case Mission.RETREAT:
      return LOANER_RETREAT_DELAY;
    default:
      return AIRCRAFT_FAST_MISSION_DELAY;
  }
}

function aircraftMissionAttackFinalDelay(entity: Entity): void {
  const savedTag = ScenarioRandom._sourceTag;
  if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = 40050;
  // Aircraft timers are maintained inside the aircraft state machine instead of
  // the normal end-of-logic entity timer pass. C++ AircraftClass::Mission_Attack
  // returns MissionControl[Mission].Normal_Delay() after RETURN_TO_BASE may have
  // called Enter_Idle_Mode and changed Mission; store the post-frame CDTimer
  // value exposed by agent_get_state.
  entity.missionTimer = aircraftMissionNormalDelay(entity) - 1 + ScenarioRandom.nextInRange(0, 2);
  if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = savedTag;
}

function aircraftTargetLeptons(entity: Entity): LeptonPos | null {
  if (entity.target?.alive) {
    return { lx: entity.target.leptonX, ly: entity.target.leptonY };
  }
  const targetPos = getAircraftTargetPos(entity);
  return targetPos ? { lx: pixelToLepton(targetPos.x), ly: pixelToLepton(targetPos.y) } : null;
}

function coordMoveLeptons(coord: LeptonPos, dir256: number, distance: number): LeptonPos {
  const dir = dir256 & 0xff;
  return {
    lx: coord.lx + ((COS_TABLE_256[dir] * distance) >> 7),
    ly: coord.ly - ((SIN_TABLE_256[dir] * distance) >> 7),
  };
}

function aircraftCellSeemsOk(ctx: AircraftContext, entity: Entity, cx: number, cy: number, strict: boolean): boolean {
  for (const other of ctx.entities) {
    if (!other.alive || other.inLimbo || !other.isAirUnit) continue;
    if (!strict && other.id === entity.id) continue;
    if (other.cell.cx === cx && other.cell.cy === cy) return false;
    if (other.moveTarget) {
      const navCell = leptonToCell(other.moveTarget.lx, other.moveTarget.ly);
      if (navCell.cx === cx && navCell.cy === cy) return false;
    }
  }
  return true;
}

function goodFireLocation(ctx: AircraftContext, entity: Entity): LeptonPos | null {
  const target = aircraftTargetLeptons(entity);
  if (!target) return null;

  const range = Math.trunc((entity.weapon?.range ?? 5) * LEPTON_SIZE);
  let altcoord: LeptonPos | null = null;
  if (entity.target?.alive && entity.target.moveTarget) {
    altcoord = entity.target.moveTarget;
  }

  let bestCell: { cx: number; cy: number } | null = null;
  let best2Cell: { cx: number; cy: number } | null = null;
  let bestVal = -1;
  let best2Val = -1;

  for (let r = range - LEPTON_SIZE; r > LEPTON_SIZE; r -= LEPTON_SIZE) {
    for (let face = 0; face < 255; face += 16) {
      const newcoord = coordMoveLeptons(target, face, r);
      const newcell = leptonToCell(newcoord.lx, newcoord.ly);
      if (!ctx.map.inBounds(newcell.cx, newcell.cy)) continue;
      if (!aircraftCellSeemsOk(ctx, entity, newcell.cx, newcell.cy, true)) continue;

      const dist = altcoord
        ? leptonDist(newcoord.lx, newcoord.ly, altcoord.lx, altcoord.ly)
        : leptonDist(entity.leptonX, entity.leptonY, newcoord.lx, newcoord.ly);
      if (bestVal === -1 || dist < bestVal) {
        best2Val = bestVal;
        best2Cell = bestCell;
        bestVal = dist;
        bestCell = newcell;
      }
    }
    if (bestVal !== -1) break;
  }

  if (!bestCell) return null;
  if (best2Val === -1 || !best2Cell) best2Cell = bestCell;

  const savedTag = ScenarioRandom._sourceTag;
  ScenarioRandom._sourceTag = 40080;
  const chosen = ScenarioRandom.percentChance(50) ? bestCell : best2Cell;
  ScenarioRandom._sourceTag = savedTag;
  return cellTargetToLepton(chosen.cx, chosen.cy);
}

function setHelicopterAttackFacing(entity: Entity): void {
  const target = aircraftTargetLeptons(entity);
  if (!target) return;
  const dir = directionToLeptons256(entity.leptonX, entity.leptonY, target.lx, target.ly);
  entity.desiredFacing256 = dir;
  entity.desiredFacing = Math.round(dir / 32) & 7;
  setDesiredAircraftSecondaryFacing256(entity, dir);
}

function setHelicopterSecondaryFacingToTarget(entity: Entity): void {
  const target = aircraftTargetLeptons(entity);
  if (!target) return;
  setDesiredAircraftSecondaryFacing256(
    entity,
    directionToLeptons256(entity.leptonX, entity.leptonY, target.lx, target.ly),
  );
}

function setHelicopterSecondaryFacingToCoordFromFireCoord(entity: Entity, coord: LeptonPos): void {
  const fire = entity.fireCoordForWeapon(entity.weapon);
  setDesiredAircraftSecondaryFacing256(
    entity,
    directionToLeptons256(fire.lx, fire.ly, coord.lx, coord.ly),
  );
}

function aircraftFireRearmPostFrame(entity: Entity, weapon: WeaponStats, rofBias: number): number {
  let rearm = Math.max(1, Math.round(weapon.rof * rofBias));
  if (entity.isTwoShooter()) {
    if (!entity.isSecondShot) {
      rearm = 3;
    }
    entity.isSecondShot = !entity.isSecondShot;
  } else {
    entity.isSecondShot = true;
  }
  // C++ TechnoClass::Fire_At assigns Arm=Rearm_Delay(IsSecondShot), then the
  // CDTimer frame tick exposes Arm-1 in the post-logic harness state.
  return Math.max(0, rearm - 1);
}

function helicopterFireState(entity: Entity): HelicopterFireState {
  const weapon = entity.weapon;
  const target = aircraftTargetLeptons(entity);
  if (!weapon || !target) return 'cant';
  if (entity.target?.alive) {
    if (entity.target.cloakState === CloakState.CLOAKED) return 'cant';
    if (!entity.canWeaponTarget(entity.target, weapon)) return 'cant';
  } else if (entity.targetStructure && (entity.targetStructure as MapStructure).alive) {
    if (weapon.isAntiGround === false) return 'cant';
  } else {
    return 'cant';
  }
  if (entity.attackCooldownAtLogicStart > 0) return 'rearm';
  const fire = entity.fireCoordForWeapon(weapon);
  if (leptonDist(fire.lx, fire.ly, target.lx, target.ly) > weapon.range * LEPTON_SIZE) return 'range';
  if (entity.ammo === 0) return 'ammo';
  if (entity.stats.isCloakable && entity.cloakState !== CloakState.UNCLOAKED) return 'cloaked';
  return 'ok';
}

function helicopterInRange(entity: Entity): boolean {
  const weapon = entity.weapon;
  const target = aircraftTargetLeptons(entity);
  if (!weapon || !target) return false;
  const fire = entity.fireCoordForWeapon(weapon);
  return leptonDist(fire.lx, fire.ly, target.lx, target.ly) <= weapon.range * LEPTON_SIZE;
}

function fireHelicopterWeapon(ctx: AircraftContext, entity: Entity): HelicopterFireState {
  const fireState = helicopterFireState(entity);
  if (fireState !== 'ok') return fireState;
  const weapon = entity.weapon!;
  const target = aircraftTargetLeptons(entity)!;

  if (entity.target?.alive) {
    ctx.fireWeaponAt(entity, entity.target, weapon);
  } else if (entity.targetStructure && (entity.targetStructure as MapStructure).alive) {
    ctx.fireWeaponAtStructure(entity, entity.targetStructure as MapStructure, weapon);
  } else {
    return 'cant';
  }

  const targetCell = leptonToCell(target.lx, target.ly);
  ctx.incomingThreatScatterCell?.(targetCell.cx, targetCell.cy, entity);
  entity.attackCooldown = aircraftFireRearmPostFrame(
    entity,
    weapon,
    ctx.getROFBias(entity.house),
  );
  if (entity.ammo > 0) entity.ammo--;
  return 'ok';
}

function updateHelicopterMissionAttack(ctx: AircraftContext, entity: Entity): boolean {
  const flyCurrentFacing = () => {
    aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
  };

  if (entity.missionTimer > 0) {
    entity.missionTimer--;
    flyCurrentFacing();
    return true;
  }

  const hasTarget = !!getAircraftTargetPos(entity);

  switch (entity.aircraftAttackStatus) {
    case ATTACK_VALIDATE_AZ:
      entity.aircraftAttackStatus = hasTarget
        ? ATTACK_PICK_ATTACK_LOCATION
        : ATTACK_RETURN_TO_BASE;
      aircraftMissionAttackFinalDelay(entity);
      flyCurrentFacing();
      return true;

    case ATTACK_PICK_ATTACK_LOCATION: {
      if (!hasTarget) {
        entity.aircraftAttackStatus = ATTACK_RETURN_TO_BASE;
      } else {
        const fireLocation = goodFireLocation(ctx, entity);
        entity.moveTarget = fireLocation;
        entity.moveTargetEntityRef = null;
        entity.aircraftAttackStatus = fireLocation
          ? ATTACK_TAKE_OFF
          : ATTACK_RETURN_TO_BASE;
      }
      aircraftMissionAttackFinalDelay(entity);
      flyCurrentFacing();
      return true;
    }

    case ATTACK_TAKE_OFF:
      if (!hasTarget) {
        entity.aircraftAttackStatus = ATTACK_RETURN_TO_BASE;
        aircraftMissionAttackFinalDelay(entity);
        flyCurrentFacing();
        return true;
      }
      ensureAircraftHeight(entity);
      if (entity.aircraftHeightLeptons < Entity.FLIGHT_LEVEL_LEPTONS) {
        entity.aircraftState = 'takeoff';
        flyCurrentFacing();
        return true;
      }
      // C++ Process_Take_Off() still runs when the helicopter is already at
      // FLIGHT_LEVEL, and its FLIGHT_LEVEL case calls Set_Speed(0xFF) before
      // returning true. A prior close approach may have left Speed at zero.
      entity.aircraftSpeedFraction = 1.0;
      entity.aircraftAttackStatus = ATTACK_FLY_TO_POSITION;
      if (entity.moveTarget) {
        const dir = directionToLeptons256(entity.leptonX, entity.leptonY, entity.moveTarget.lx, entity.moveTarget.ly);
        const secondary = entity.turretFacing256 >= 0
          ? entity.turretFacing256 & 0xff
          : currentAircraftFacing256(entity);
        const diff = Math.max(-128, Math.min(128, signedFacingDelta256(secondary, dir)));
        setAircraftPrimaryFacing256(entity, secondary + diff);
      }
      flyCurrentFacing();
      return true;

    case ATTACK_FLY_TO_POSITION:
      if (!hasTarget) {
        entity.aircraftAttackStatus = ATTACK_RETURN_TO_BASE;
        flyCurrentFacing();
        return true;
      }
      if (!entity.moveTarget) {
        entity.aircraftAttackStatus = ATTACK_PICK_ATTACK_LOCATION;
        flyCurrentFacing();
        return true;
      }
      {
        const moveTarget = entity.moveTarget;
        const distance = leptonDist(entity.leptonX, entity.leptonY, moveTarget.lx, moveTarget.ly);
        if (distance < 0x0200) {
          setHelicopterSecondaryFacingToTarget(entity);
        } else {
          setHelicopterSecondaryFacingToCoordFromFireCoord(entity, moveTarget);
        }
        aircraftFlyInFacing(entity, moveTarget, ctx.movementSpeed(entity), 1);
        if (distance < 0x0010) {
          entity.aircraftAttackStatus = ATTACK_FIRE_AT_TARGET;
          entity.moveTarget = null;
          entity.moveTargetEntityRef = null;
        }
      }
      return true;

    case ATTACK_FIRE_AT_TARGET:
      if (!hasTarget) {
        entity.aircraftAttackStatus = ATTACK_RETURN_TO_BASE;
        flyCurrentFacing();
        return true;
      }
      setHelicopterAttackFacing(entity);
      {
        const fireState = fireHelicopterWeapon(ctx, entity);
        if (fireState === 'ok') {
          entity.aircraftAttackStatus = ATTACK_FIRE_AT_TARGET2;
        } else if (fireState === 'cloaked') {
          entity.cloakState = CloakState.UNCLOAKING;
        } else if (fireState !== 'rearm') {
          entity.aircraftAttackStatus = entity.ammo === 0
            ? ATTACK_RETURN_TO_BASE
            : ATTACK_FIRE_AT_TARGET2;
        }
      }
      flyCurrentFacing();
      return true;

    case ATTACK_FIRE_AT_TARGET2:
      if (!hasTarget) {
        entity.aircraftAttackStatus = ATTACK_RETURN_TO_BASE;
        flyCurrentFacing();
        return true;
      }
      setHelicopterAttackFacing(entity);
      {
        const fireState = fireHelicopterWeapon(ctx, entity);
        if (fireState === 'ok') {
          entity.aircraftAttackStatus = entity.ammo > 0
            ? ATTACK_FIRE_AT_TARGET
            : ATTACK_RETURN_TO_BASE;
        } else if (fireState === 'cloaked') {
          entity.cloakState = CloakState.UNCLOAKING;
        } else if (fireState !== 'rearm') {
          entity.aircraftAttackStatus = entity.ammo === 0
            ? ATTACK_RETURN_TO_BASE
            : helicopterInRange(entity)
              ? ATTACK_FIRE_AT_TARGET
              : ATTACK_PICK_ATTACK_LOCATION;
        }
      }
      aircraftMissionAttackFinalDelay(entity);
      flyCurrentFacing();
      return true;

    case ATTACK_RETURN_TO_BASE:
      if (!hasTarget || (entity.ammo === 0 && (entity.isALoaner || entity.isPlayerUnit))) {
        entity.target = null;
        entity.targetStructure = null;
        entity.forceFirePos = null;
      }
      entity.moveTarget = null;
      entity.moveTargetEntityRef = null;
      if (!entity.isFixedWing && entity.isALoaner && entity.ammo === 0 && entity.weapon) {
        ctx.removeFromTeamForRetreat?.(entity);
      }
      entity.mission = ctx.idleMission(entity);
      entity.missionQueue = null;
      entity.aircraftState = entity.mission === Mission.RETREAT ? 'flying' : 'returning';
      entity.aircraftAttackStatus = ATTACK_VALIDATE_AZ;
      aircraftMissionAttackFinalDelay(entity);
      flyCurrentFacing();
      return true;

    default:
      return false;
  }
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

function fixedWingLandingSpeedFraction(ctx: AircraftContext, entity: Entity): number {
  const airspeedBias = ctx.getAirspeedBias?.(entity.house) ?? 1.0;
  const speedByte = Math.trunc((entity.stats.landingSpeed ?? 0xFF) / airspeedBias);
  return Math.max(0, Math.min(0xFF, speedByte)) / 0xFF;
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

function moveAircraftCurrentFacing(entity: Entity, baseSpeed: number): void {
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

function aircraftFlyCurrentFacing(entity: Entity, baseSpeed: number): void {
  // C++ Mission_Retreat FACE_MAP_EDGE sets Desired facing once; Movement_AI then
  // rotates and applies Physics(Coord, PrimaryFacing) without a NavCom target.
  entity.rotTickedThisFrame = false;
  entity.turretRotTickedThisFrame = false;
  if (entity.facing256 >= 0) {
    entity.tickRotation256();
  } else {
    entity.tickRotation();
  }
  // C++ aircraft.cpp:4294-4295 — fixed-wing Rotation_AI copies
  // SecondaryFacing from PrimaryFacing before any secondary rotation.
  syncFixedWingSecondaryFacing(entity);
  rotateAircraftSecondaryFacing(entity);
  moveAircraftCurrentFacing(entity, baseSpeed);
}

function fixedWingProcessFlyTo(ctx: AircraftContext, entity: Entity, target: LeptonPos, speedByte?: number): number {
  if (speedByte !== undefined) {
    entity.aircraftSpeedFraction = Math.max(0, Math.min(0xff, speedByte)) / 0xff;
  }
  const distance = leptonDist(entity.leptonX, entity.leptonY, target.lx, target.ly);
  entity.rotTickedThisFrame = false;
  entity.turretRotTickedThisFrame = false;
  const desired = directionToLeptons256(entity.leptonX, entity.leptonY, target.lx, target.ly);
  entity.desiredFacing256 = desired;
  entity.desiredFacing = dir256ToFacing8(desired);
  entity.tickRotation256();
  syncFixedWingSecondaryFacing(entity);
  rotateAircraftSecondaryFacing(entity);
  moveAircraftCurrentFacing(entity, ctx.movementSpeed(entity));
  return distance;
}

function resolveFixedWingDockingStructure(ctx: AircraftContext, entity: Entity): number {
  const idx = entity.aircraftDockingStructure;
  if (idx >= 0 && idx < ctx.structures.length) {
    const s = ctx.structures[idx];
    if (s.alive && ctx.isAllied(entity.house, s.house) && s.type === entity.stats.landingBuilding) {
      return idx;
    }
  }
  const next = findLandingPad(ctx, entity);
  entity.aircraftDockingStructure = next;
  return next;
}

function landedServicePad(ctx: AircraftContext, entity: Entity): MapStructure | null {
  const idx = entity.landedAtStructure;
  if (idx < 0 || idx >= ctx.structures.length) return null;
  const pad = ctx.structures[idx];
  if (!pad.alive || pad.type !== entity.stats.landingBuilding) return null;
  return pad;
}

function enterPadRepairMission(ctx: AircraftContext, entity: Entity, pad: MapStructure, delay: number): void {
  pad.dockedAircraft = entity.id;
  pad.mission = Mission.REPAIR;
  pad.repairMissionStatus = 1; // BuildingClass::Mission_Repair DURING
  pad.missionTimer = delay;
  entity.mission = Mission.SLEEP;
  entity.missionQueue = null;
}

function leavePadRepairMission(ctx: AircraftContext, entity: Entity): void {
  const pad = landedServicePad(ctx, entity);
  if (!pad || pad.mission !== Mission.REPAIR || pad.dockedAircraft !== entity.id) return;
  pad.mission = Mission.GUARD;
  pad.repairMissionStatus = 0;
  pad.missionTimer = 1;
}

function enterPadRepairHandoff(ctx: AircraftContext, entity: Entity): void {
  const pad = landedServicePad(ctx, entity);
  if (!pad || (pad.type !== 'AFLD' && pad.type !== 'HPAD')) return;
  // Prepared aircraft report RADIO_IM_IN but do not require pad service.
  // Player-controlled pads still expose the same short handoff window observed
  // in C++: the airstrip enters Mission_Repair, sees RADIO_PREPARED, queues
  // GUARD, then lets the normal Guard jitter run. AI pads keep their live
  // GUARD cadence; synthesizing the same handoff there injects an extra
  // full-ammo landing jitter (SCU34EA).
  pad.dockedAircraft = entity.id;
  if (ctx.isHumanControlledHouse?.(entity.house)) {
    pad.missionQueue = Mission.REPAIR;
    pad.isReadyToCommence = false;
    pad.readyToCommenceTick = (ctx.tick ?? 0) + 2;
    return;
  }

  if (pad.missionQueue === Mission.REPAIR) pad.missionQueue = null;
  pad.isReadyToCommence = false;
  pad.readyToCommenceTick = undefined;
}

function updateFixedWingMissionEnter(ctx: AircraftContext, entity: Entity): boolean {
  if (entity.missionTimer > 0) {
    entity.missionTimer--;
    entity.animState = AnimState.WALK;
    aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
    return true;
  }

  entity.animState = AnimState.WALK;
  const padIdx = resolveFixedWingDockingStructure(ctx, entity);
  if (padIdx < 0) {
    entity.mission = Mission.RETREAT;
    entity.aircraftState = 'flying';
    entity.aircraftDockingStructure = -1;
    aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
    return true;
  }
  const pad = ctx.structures[padIdx];

  switch (entity.aircraftEnterStatus) {
    case ENTER_INITIAL:
      ensureAircraftHeight(entity);
      entity.aircraftEnterStatus = entity.flightAltitude < Entity.FLIGHT_ALTITUDE
        ? ENTER_TAKEOFF
        : ENTER_ALTITUDE;
      aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
      break;

    case ENTER_TAKEOFF:
      ensureAircraftHeight(entity);
      setAircraftHeight(entity, entity.aircraftHeightLeptons + AIRCRAFT_HEIGHT_STEP_LEPTONS);
      entity.aircraftSpeedFraction = 1.0;
      if (entity.landedAtStructure >= 0 && entity.landedAtStructure < ctx.structures.length) {
        ctx.structures[entity.landedAtStructure].dockedAircraft = undefined;
      }
      entity.landedAtStructure = -1;
      if (entity.aircraftHeightLeptons >= Entity.FLIGHT_LEVEL_LEPTONS) {
        entity.aircraftEnterStatus = ENTER_ALTITUDE;
      }
      aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
      break;

    case ENTER_ALTITUDE:
      entity.aircraftEnterStatus = ENTER_STACK;
      aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
      break;

    case ENTER_STACK: {
      const distance = fixedWingProcessFlyTo(ctx, entity, fixedWingLandingCheckpoint(ctx, pad, ENTER_STACK));
      if (distance < 0x0080) entity.aircraftEnterStatus = ENTER_DOWNWIND;
      break;
    }

    case ENTER_DOWNWIND: {
      const distance = fixedWingProcessFlyTo(ctx, entity, fixedWingLandingCheckpoint(ctx, pad, ENTER_DOWNWIND), 200);
      if (distance < 0x0080) entity.aircraftEnterStatus = ENTER_CROSSWIND;
      break;
    }

    case ENTER_CROSSWIND: {
      const distance = fixedWingProcessFlyTo(ctx, entity, fixedWingLandingCheckpoint(ctx, pad, ENTER_CROSSWIND), 140);
      if (distance < 0x0080) entity.aircraftEnterStatus = ENTER_TRAVEL;
      break;
    }

    case ENTER_TRAVEL: {
      const distance = fixedWingProcessFlyTo(ctx, entity, buildingDockingLeptons(pad));
      if (distance < 0x0400) {
        entity.aircraftEnterStatus = ENTER_LANDING;
        entity.aircraftState = 'landing';
        entity.landedAtStructure = padIdx;
        pad.dockedAircraft = entity.id;
      }
      break;
    }

    case ENTER_LANDING:
      entity.aircraftState = 'landing';
      entity.landedAtStructure = padIdx;
      pad.dockedAircraft = entity.id;
      aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
      applyAircraftLandingHeightStep(ctx, entity);
      break;

    default:
      entity.aircraftEnterStatus = ENTER_INITIAL;
      aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
      break;
  }
  entity.missionTimer = 0;
  return true;
}

function updateFixedWingMissionMove(ctx: AircraftContext, entity: Entity): boolean {
  entity.animState = AnimState.WALK;

  if (!entity.moveTarget) {
    entity.aircraftState = 'returning';
    aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
    return true;
  }

  if (entity.missionTimer > 0) {
    entity.missionTimer--;
    aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
    return true;
  }

  if (entity.aircraftMoveStatus === FIXED_MOVE_TAKE_OFF) {
    ensureAircraftHeight(entity);
    if (entity.aircraftHeightLeptons < Entity.FLIGHT_LEVEL_LEPTONS) {
      entity.aircraftState = 'takeoff';
      entity.missionTimer = 0;
      return true;
    }
    entity.aircraftMoveStatus = FIXED_MOVE_FLY_TO_TARGET;
    entity.aircraftSpeedFraction = 1.0;
    entity.missionTimer = 0;
    aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
    return true;
  }

  const target = entity.moveTarget;
  const desired = directionToLeptons256(entity.leptonX, entity.leptonY, target.lx, target.ly);
  entity.desiredFacing256 = desired;
  entity.desiredFacing = dir256ToFacing8(desired);
  entity.aircraftSpeedFraction = 1.0;

  const distance = leptonDist(entity.leptonX, entity.leptonY, target.lx, target.ly);
  if (distance < 0x00C0) {
    const arrCell = worldToCell(leptonToPixel(target.lx), leptonToPixel(target.ly));
    if (!ctx.map.inBounds(arrCell.cx, arrCell.cy)) {
      handleMapExit(ctx, entity);
      return true;
    }

    if (entity.moveQueue.length > 0) {
      entity.moveTarget = entity.moveQueue.shift()!;
      entity.missionTimer = 0;
    } else if (!entity.isALoaner) {
      enterFixedWingDockingMission(ctx, entity);
    } else if (!entity.teamRef) {
      entity.moveTarget = null;
      entity.mission = ctx.idleMission(entity);
      entity.missionQueue = null;
      entity.missionTimer = 0;
    } else {
      entity.missionTimer = 0;
    }

    aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
    return true;
  }

  // C++ fixed-wing Mission_Move returns 5 while en route; the frame timer has
  // already consumed one tick in the post-step state exposed by the harness.
  entity.missionTimer = 4;
  aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
  return true;
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
function aircraftFlyInFacing(
  entity: Entity,
  target: WorldPos | LeptonPos,
  baseSpeed: number,
  flyToIntervalOverride?: number,
): boolean {
  const targetLX = 'lx' in target ? target.lx : pixelToLepton(target.x);
  const targetLY = 'ly' in target ? target.ly : pixelToLepton(target.y);
  // Keep fractional pixel precision for facing. C++ Direction() receives a
  // COORDINATE, so converting a NavCom through integer render pixels here loses
  // the low 4-bit TARGET offset from target.cpp.
  const targetWorld = {
    x: targetLX * CELL_SIZE / LEPTON_SIZE,
    y: targetLY * CELL_SIZE / LEPTON_SIZE,
  };

  // C++ Process_Fly_To uses Distance(coord, target) — octagonal lepton distance.
  // All distance checks (flyToInterval, approach slowdown, stop threshold) must
  // use this metric. Euclidean pixel distance is ~15% shorter at diagonal angles,
  // causing approach slowdown to trigger too early and flight times to diverge.
  const distLeptons = leptonDist(entity.leptonX, entity.leptonY, targetLX, targetLY);
  // C++ Process_Fly_To always applies the stop-radius speed clear; it is not
  // gated by any course-update cadence. Leaving stale approach speed here lets
  // helicopters drift while FIRE_AT_TARGET is just waiting on rearm.
  if (distLeptons < 16) {
    entity.aircraftSpeedFraction = 0;
    return true;
  }

  // Step 1: Set desired facing toward target and rotate.
  entity.rotTickedThisFrame = false;
  entity.turretRotTickedThisFrame = false;

  // C++ Process_Fly_To runs every 5 ticks when far (dist>=256 leptons), 1 tick when close
  const flyToInterval = flyToIntervalOverride ?? (distLeptons >= 256 ? 5 : 1);
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
  syncFixedWingSecondaryFacing(entity);
  rotateAircraftSecondaryFacing(entity);

  // Step 2: C++ Process_Fly_To(true, NavCom) approach slowdown within 3 cells.
  // Uses octagonal lepton distance. Speed updated only on flyToInterval ticks.
  if (updateDesired) {
    let speedFraction = 1.0;
    if (distLeptons < 0x0300) { // < 3 cells in leptons (768)
      const rawSpeed = Math.floor(distLeptons / 3);
      const clampedSpeed = Math.max(0x20, Math.min(0xFF, rawSpeed));
      speedFraction = clampedSpeed / 0xFF;
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

    return leptonDist(entity.leptonX, entity.leptonY, targetLX, targetLY) < 16;
  }
}

/** Handle aircraft (and passengers) leaving the map */
function handleMapExit(ctx: AircraftContext, entity: Entity): void {
  // Leaving the map is evacuation/escape, not destruction. Keep leave-map
  // counters, but disarm TEVENT_DESTROYED attachments before marking dead.
  entity.triggerName = '';
  const occupiedLogicBefore = entity.occupiesCppLogic();
  entity.alive = false;
  entity.mission = Mission.DIE;
  if (occupiedLogicBefore && !entity.occupiesCppLogic()) ctx.releaseLogicSlotForEntity?.(entity);
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

function startParadropFall(ctx: AircraftContext, passenger: Entity): void {
  passenger.isFalling = true;
  passenger.fallHeightLeptons = Entity.FLIGHT_LEVEL_LEPTONS;
  passenger.fallRiser = 0;
  attachFallingParachuteAnim(
    passenger,
    ctx.logicIndexHintForNewObject,
    ctx.reserveAnimSlot,
  );
  passenger.flightAltitude = leptonToPixel(passenger.fallHeightLeptons);
}

function paradropOnePassenger(ctx: AircraftContext, entity: Entity): boolean {
  const passenger = entity.passengers[0];
  if (!passenger) return false;

  let spot: ReturnType<typeof closestInfantryUnlimboSpot> = null;
  if (passenger.stats.isInfantry) {
    // C++ AircraftClass::Paradrop_Cargo passes Center_Coord() to
    // InfantryClass::Paradrop, which runs InfantryClass::Unlimbo and snaps the
    // passenger to CellClass::Closest_Free_Spot before the falling AI begins.
    // If all sub-cells are occupied, Paradrop() fails and Paradrop_Cargo
    // re-attaches the passenger instead of forcing a mission-specific drop.
    spot = closestInfantryUnlimboSpot(ctx, passenger, entity.leptonX, entity.leptonY);
    if (!spot) return false;
  }

  entity.passengers.shift();
  passenger.alive = true;
  if (passenger.stats.isInfantry) {
    const infantrySpot = spot;
    if (!infantrySpot) return false;
    passenger.leptonX = infantrySpot.lx;
    passenger.leptonY = infantrySpot.ly;
    passenger.syncPosFromLeptons();
    passenger.subCell = infantrySpot.subCell;
    passenger.claimedCellIdx = infantrySpot.cellIdx;
    passenger.claimedSubCell = infantrySpot.subCell;
  } else {
    passenger.setPosition(entity.pos.x, entity.pos.y);
  }
  passenger.transportRef = null;
  passenger.isTethered = false;
  passenger.inLimbo = false;
  passenger.logicIndexHint = ctx.logicIndexHintForNewObject?.();
  ctx.entities.push(passenger);
  ctx.entityById.set(passenger.id, passenger);
  // C++ ObjectClass::Paradrop (object.cpp:1853-1866):
  // Height = FLIGHT_LEVEL; IsFalling = true; attach parachute anim.
  startParadropFall(ctx, passenger);
  // C++ AircraftClass::Paradrop_Cargo removes the passenger from the team,
  // then (bug-compatible unqualified call) assigns the aircraft GUARD/HUNT.
  if (entity.teamRef && passenger.teamRef) {
    if (ctx.removeFromTeamForRetreat) ctx.removeFromTeamForRetreat(passenger);
    else passenger.teamRef.remove(passenger);
  }
  assignMission(passenger, passenger.isPlayerUnit ? Mission.GUARD : Mission.HUNT);
  if (entity.teamRef) {
    entity.mission = passenger.isPlayerUnit ? Mission.GUARD : Mission.HUNT;
  }
  return true;
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

      const dist = leptonDist(
        entity.leptonX, entity.leptonY,
        entity.moveTarget.lx, entity.moveTarget.ly,
      );
      if (dist < 0x0200) {
        // C++ Can_Fire returns FIRE_OK here. Mission_Hunt immediately switches
        // to DROP_BOMBS and returns, so it does not refresh PrimaryFacing
        // desired on the same dispatch.
        entity.aircraftAttackStatus = DROP_BOMBS;
      } else {
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
        // C++ FLY_TO_TARGET returns TICKS_PER_SECOND/2. Because this TS
        // aircraft handler owns the countdown directly, store the end-of-frame
        // value observed after the C++ CDTimer tick.
        entity.missionTimer = Math.floor(TICKS_PER_SECOND / 2) - 1;
      }
      handled = true;
      break;
    }

    case DROP_BOMBS:
      if (entity.passengers.length > 0) {
        if (leptonDist(entity.leptonX, entity.leptonY, entity.moveTarget.lx, entity.moveTarget.ly) >= 0x0200) {
          entity.aircraftAttackStatus = FLY_TO_TARGET;
          entity.missionTimer = TICKS_PER_SECOND * 4 - 1;
          handled = true;
          break;
        }

        const missionAtDispatch = entity.mission;
        const targetCell = worldToCell(
          leptonToPixel(entity.moveTarget.lx),
          leptonToPixel(entity.moveTarget.ly),
        );
        if (missionAtDispatch === Mission.HUNT) {
          // C++ AircraftClass::Mission_Hunt calls Incoming(TarCom) before
          // Fire_At(), so the newly detached passenger is not in the occupier
          // list for this scatter pass.
          ctx.incomingThreatScatterCell?.(targetCell.cx, targetCell.cy, entity);
        }
        const dropped = paradropOnePassenger(ctx, entity);
        if (missionAtDispatch !== Mission.HUNT) {
          // C++ AircraftClass::Mission_Attack calls Fire_At() first, then
          // Incoming(TarCom). Passenger aircraft route Fire_At through
          // Paradrop_Cargo, so the dropped infantry can be part of the same
          // CellClass::Incoming scatter.
          ctx.incomingThreatScatterCell?.(targetCell.cx, targetCell.cy, entity);
        }
        if (!dropped) {
          entity.aircraftAttackStatus = DROP_BOMBS;
          entity.missionTimer = 0;
          handled = true;
          break;
        }
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
        if (entity.teamRef) {
          if (ctx.removeFromTeamForRetreat) ctx.removeFromTeamForRetreat(entity);
          else entity.teamRef.remove(entity);
        }
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

function applyAircraftLandingHeightStep(ctx: AircraftContext, entity: Entity): void {
  ensureAircraftHeight(entity);
  setAircraftHeight(entity, entity.aircraftHeightLeptons - AIRCRAFT_HEIGHT_STEP_LEPTONS);

  // C++ aircraft.cpp:4104-4111 — LZ blocked check at LAYER_GROUND transition.
  // TS does not model render layers separately, but the LZ legality guard belongs
  // to the exact Height value, not the rounded visible altitude.
  if (entity.isHelicopter &&
      entity.aircraftHeightLeptons > 0 &&
      entity.aircraftHeightLeptons < AIRCRAFT_GROUND_LAYER_HEIGHT) {
    const { cx, cy } = entity.cell;
    const cellKey = cy * MAP_CELLS + cx;
    if (ctx.map.vehicleOccupancy.has(cellKey)) {
      setAircraftHeight(entity, entity.aircraftHeightLeptons + AIRCRAFT_HEIGHT_STEP_LEPTONS);
      entity.aircraftState = 'takeoff';
      entity.aircraftSpeedFraction = 1.0;
      return;
    }
  }

  // C++ aircraft.cpp:2982-2998 — helicopter landing speed staging.
  if (entity.isHelicopter) {
    const halfLevel = Math.round(Entity.FLIGHT_ALTITUDE / 2);
    if (entity.flightAltitude <= halfLevel) {
      entity.aircraftSpeedFraction = 0;
    }
  }

  if (entity.aircraftHeightLeptons > 0) return;

  setAircraftHeight(entity, 0);
  // C++ aircraft.cpp:4062-4068 — fixed-wing crash on open ground.
  if (entity.isFixedWing && entity.landedAtStructure < 0) {
    entity.hp = 0;
    entity.alive = false;
    entity.mission = Mission.DIE;
    return;
  }

  entity.aircraftSpeedFraction = 1.0;
  if (entity.ammo >= 0 && entity.ammo < entity.maxAmmo) {
    entity.aircraftState = 'rearming';
    entity.rearmTimer = computeRearmDelay(ctx.getPowerFraction(entity.house));
    const pad = landedServicePad(ctx, entity);
    if (pad && (pad.type === 'AFLD' || pad.type === 'HPAD')) {
      enterPadRepairMission(ctx, entity, pad, entity.rearmTimer);
    }
  } else {
    entity.aircraftState = 'landed';
    enterPadRepairHandoff(ctx, entity);
  }
  if (entity.missionQueue === null) {
    entity.mission = Mission.GUARD;
  }
}

/** Aircraft state machine — returns true if aircraft handled this tick (skip normal update) */
export function updateAircraft(ctx: AircraftContext, entity: Entity): boolean {
  // Only process aircraft with active state
  if (!entity.stats.isAircraft) return false;

  // C++ Can_Fire reads Arm.Value() during MissionClass dispatch before the
  // frame timer exposes the post-tick value. Keep the entry snapshot for fire
  // gates, then decrement the visible timer used by post-state parity traces.
  entity.attackCooldownAtLogicStart = entity.attackCooldown;
  // Decrement attack cooldowns — aircraft skip normal mission processing.
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
      setAircraftHeight(entity, 0);
      entity.animState = AnimState.IDLE;
      if (entity.mission === Mission.ATTACK && (entity.target?.alive || entity.targetStructure)) {
        entity.aircraftState = 'takeoff';
      } else if (entity.mission === Mission.MOVE && entity.moveTarget) {
        if (entity.missionTimer > 0) {
          entity.missionTimer--;
        } else {
          entity.aircraftState = 'takeoff';
        }
      } else if (entity.mission === Mission.RETREAT) {
        // C++ aircraft.cpp:1309-1367 Mission_Retreat: TAKE_OFF stage
        // Loaner transport has finished unloading — take off to fly off-map
        entity.aircraftState = 'takeoff';
      }
      return true;
    }

    case 'takeoff': {
      // C++ Landing_Takeoff_AI stores exact Height in leptons and derives the
      // visible offset with rounded Lepton_To_Pixel.
      ensureAircraftHeight(entity);
      setAircraftHeight(entity, entity.aircraftHeightLeptons + AIRCRAFT_HEIGHT_STEP_LEPTONS);
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
      if (entity.aircraftHeightLeptons >= Entity.FLIGHT_LEVEL_LEPTONS) {
        entity.aircraftState = 'flying';
        entity.aircraftSpeedFraction = 1.0;
        if (!entity.isFixedWing &&
            entity.mission === Mission.RETREAT &&
            entity.aircraftAttackStatus <= RETREAT_TAKE_OFF) {
          // C++ Mission_Retreat owns helicopter takeoff: the dispatch whose
          // Process_Take_Off() reaches FLIGHT_LEVEL promotes Status to
          // FACE_MAP_EDGE before the next timer fire.
          entity.aircraftAttackStatus = RETREAT_FACE_MAP_EDGE;
          entity.missionTimer = 0;
        }
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

      if (entity.isFixedWing &&
          entity.mission === Mission.ATTACK &&
          getFixedWingAttackTargetPos(entity)) {
        entity.aircraftState = 'attacking';
        return updateFixedWingAttackRun(ctx, entity);
      }

      if (!entity.isFixedWing && entity.mission === Mission.ATTACK) {
        const handled = updateHelicopterMissionAttack(ctx, entity);
        if (handled) return true;
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
          const passenger = entity.passengers[0]!;
          let canDrop = true;
          let spot: ReturnType<typeof closestInfantryUnlimboSpot> = null;
          if (passenger.stats.isInfantry) {
            spot = closestInfantryUnlimboSpot(ctx, passenger, entity.leptonX, entity.leptonY);
            canDrop = !!spot;
          }
          if (canDrop) {
            entity.passengers.shift();
            passenger.alive = true;
            if (passenger.stats.isInfantry) {
              const infantrySpot = spot;
              if (!infantrySpot) return true;
              passenger.leptonX = infantrySpot.lx;
              passenger.leptonY = infantrySpot.ly;
              passenger.syncPosFromLeptons();
              passenger.subCell = infantrySpot.subCell;
              passenger.claimedCellIdx = infantrySpot.cellIdx;
              passenger.claimedSubCell = infantrySpot.subCell;
            } else {
              passenger.setPosition(entity.pos.x, entity.pos.y);
            }
            passenger.transportRef = null;
            passenger.isTethered = false;
            passenger.inLimbo = false;
            passenger.logicIndexHint = ctx.logicIndexHintForNewObject?.();
            ctx.entities.push(passenger);
            ctx.entityById.set(passenger.id, passenger);
            // C++ ObjectClass::Paradrop (object.cpp:1853-1866):
            //   Height = FLIGHT_LEVEL; IsFalling = true; attach parachute anim.
            // C++ TechnoClass::AI (techno.cpp:2346) returns early for non-aircraft
            // while Height > 0, so the newly appended passenger can enter Logic this
            // same tick without running infantry MissionClass::AI/RNG.
            startParadropFall(ctx, passenger);
            // C++ InfantryClass::Paradrop (infantry.cpp:4183-4194):
            // human player → MISSION_GUARD, AI → MISSION_HUNT. Route through
            // Assign_Mission so Commence timing remains C++-faithful after landing.
            assignMission(passenger, passenger.isPlayerUnit ? Mission.GUARD : Mission.HUNT);
          }

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
        const targetPos = entity.isFixedWing
          ? getFixedWingAttackTargetPos(entity)
          : getAircraftTargetPos(entity);
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
          // C++ fixed-wing Mission_Hunt only re-checks Can_Fire on the
          // MissionClass timer cadence while closing from out of range. This
          // preserves that pending half-second dispatch instead of firing on
          // the exact TS tick where the range threshold is crossed.
          if (entity.isFixedWing && entity.missionTimer <= 0) {
            entity.missionTimer = Math.floor(TICKS_PER_SECOND / 2);
          }
          return true;
        }
        // Fly toward target — C++ curved path via Rotation_AI + Physics(PrimaryFacing)
        aircraftFlyInFacing(entity, targetPos, ctx.movementSpeed(entity));
      } else if (entity.mission === Mission.RETREAT) {
        // C++ aircraft.cpp:1309-1367 Mission_Retreat.
        // Helicopters do not compute a NavCom/nearest-edge point here. FACE_MAP_EDGE
        // sets full speed and desired facing from House->Control.Edge, then
        // KEEP_FLYING just lets Movement_AI carry the aircraft off-map.
        if (entity.isFixedWing) {
          if (entity.missionTimer > 0) {
            entity.missionTimer--;
          } else {
            // Fixed-wing Mission_Retreat does not use Random_Pick. At flight
            // level C++ returns TICKS_PER_SECOND*10; below it returns 3 while
            // increasing Height. TS represents fixed-wing airborne state at
            // flight level in pixels.
            entity.missionTimer = TICKS_PER_SECOND * 10 - 1;
          }
          const ec = entity.cell;
          if (!ctx.map.inBounds(ec.cx, ec.cy)) {
            handleMapExit(ctx, entity);
            return true;
          }
          if (entity.moveTarget) {
            aircraftFlyInFacing(entity, entity.moveTarget, ctx.movementSpeed(entity));
          } else {
            aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
          }
        } else {
          if (entity.missionTimer > 0) {
            entity.missionTimer--;
            if (entity.aircraftAttackStatus < RETREAT_KEEP_FLYING) return true;
          } else if (entity.aircraftAttackStatus <= RETREAT_TAKE_OFF) {
            // C++ TAKE_OFF returns 1 even when already airborne; no retreat
            // speed/facing is set until the next Mission_Retreat dispatch.
            entity.aircraftAttackStatus = RETREAT_FACE_MAP_EDGE;
            entity.missionTimer = 0;
            return true;
          } else {
            if (entity.aircraftAttackStatus === RETREAT_FACE_MAP_EDGE) {
              entity.aircraftSpeedFraction = 1.0;
              entity.desiredFacing256 = houseEdgeDirection256(ctx, entity.house);
              entity.desiredFacing = Math.round(entity.desiredFacing256 / 32) & 7;
              entity.aircraftAttackStatus = RETREAT_KEEP_FLYING;
            }
            // C++ aircraft.cpp:1375-1377 — helicopter Mission_Retreat
            // FACE_MAP_EDGE/KEEP_FLYING returns MissionControl[RETREAT].
            // Normal_Delay() + Random_Pick(0,2). Store the observed post-frame
            // value exposed by agent_get_state.
            const prevTag = ScenarioRandom._sourceTag;
            ScenarioRandom._sourceTag = 40030;
            const jitter = ScenarioRandom.nextInRange(0, 2);
            ScenarioRandom._sourceTag = prevTag;
            entity.missionTimer = LOANER_RETREAT_DELAY - 1 + jitter;
          }

          const ec = entity.cell;
          if (!ctx.map.inBounds(ec.cx, ec.cy)) {
            handleMapExit(ctx, entity);
            return true;
          }
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

        if (!entity.isFixedWing) {
          // C++ helicopter Mission_Move is a timer-driven state machine:
          // VALIDATE_LZ consumes the normal-delay jitter, TAKE_OFF runs after
          // that timer expires, and only then does FLY_TO_LZ call Process_Fly_To
          // every tick. During the delay the aircraft keeps drifting on its
          // current facing; steering early makes transports reach the LZ too soon.
          if (entity.missionTimer > 0) {
            entity.missionTimer--;
            aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
            return true;
          }

          if (entity.aircraftMoveStatus === MOVE_VALIDATE_LZ) {
            entity.aircraftMoveStatus = MOVE_TAKE_OFF;
            const savedTag = ScenarioRandom._sourceTag;
            if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = 40040;
            entity.missionTimer = 14 + ScenarioRandom.nextInRange(0, 2);
            if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = savedTag;
            aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
            return true;
          }

          if (entity.aircraftMoveStatus === MOVE_TAKE_OFF) {
            ensureAircraftHeight(entity);
            if (entity.aircraftHeightLeptons < Entity.FLIGHT_LEVEL_LEPTONS) {
              entity.aircraftState = 'takeoff';
              return true;
            }
            entity.aircraftMoveStatus = MOVE_FLY_TO_LZ;
            entity.aircraftSpeedFraction = 1.0;
            aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
            return true;
          }

          const distance = leptonDist(entity.leptonX, entity.leptonY, entity.moveTarget.lx, entity.moveTarget.ly);
          aircraftFlyInFacing(entity, entity.moveTarget, ctx.movementSpeed(entity), 1);
          if (distance < 0x0080) {
            if (distance < 0x0010) {
              const arrCell = worldToCell(leptonToPixel(entity.moveTarget.lx), leptonToPixel(entity.moveTarget.ly));
              if (!ctx.map.inBounds(arrCell.cx, arrCell.cy)) {
                handleMapExit(ctx, entity);
                return true;
	              }
	              entity.aircraftMoveStatus = MOVE_LAND;
	              entity.moveTarget = null;
	              entity.aircraftState = 'landing';
	              // C++ Mission_Move only changes Status to LAND on this dispatch
	              // (aircraft.cpp:1813-1816). Process_Landing, which sets
	              // IsLanding and lets Landing_Takeoff_AI lower Height, starts on
	              // the next mission dispatch.
	            }
	            return true;
	          }
        } else {
          return updateFixedWingMissionMove(ctx, entity);
        }
      } else if (entity.mission === Mission.NONE) {
        // C++ MissionClass::AI default branch calls Mission_Sleep() for
        // MISSION_NONE, then AircraftClass::Movement_AI still advances airborne
        // aircraft at their current facing (aircraft.cpp:887-911, mission.cpp:232-236).
        if (entity.missionTimer > 0) {
          entity.missionTimer--;
        } else {
          entity.missionTimer = TICKS_PER_SECOND * 30 - 1;
        }
        aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
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
      // C++ LAND_ON_LZ/Landing_Takeoff_AI: descend by Pixel_To_Lepton(1)
      // in exact Height leptons; visible pixels can skip near ground.
      ensureAircraftHeight(entity);
      if (entity.aircraftHeightLeptons > 0) {
        setAircraftHeight(entity, entity.aircraftHeightLeptons - AIRCRAFT_HEIGHT_STEP_LEPTONS);
      }
      if (entity.aircraftHeightLeptons <= 0) {
        setAircraftHeight(entity, 0);
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
        const passenger = entity.passengers[0]!;
        const exitCell = findAircraftExitCell(ctx, entity, passenger);
        const exitTarget = {
          lx: exitCell.cx * LEPTON_SIZE + LEPTON_SIZE / 2,
          ly: exitCell.cy * LEPTON_SIZE + LEPTON_SIZE / 2,
        };

        // C++ Exit_Object: Unlimbo at transport Coord, then Assign_Mission(MOVE)
        // and Assign_Destination(adjacent cell) so the unit clears the LZ.
        passenger.alive = true;
        if (passenger.stats.isInfantry) {
          // C++ aircraft.cpp:1175-1186 picks the landed transport up from the
          // map before Exit_Object(), then places it down again afterwards.
          // That clears Flag.Occupy.Vehicle just for Closest_Free_Spot so the
          // passenger can unlimbo into a legal infantry sub-cell under the LZ.
          const transportCell = entity.cell;
          const pickedUpTransport =
            entity.flightAltitude === 0 &&
            ctx.map.getOccupancy(transportCell.cx, transportCell.cy) === entity.id &&
            ctx.map.hasVehicleOccupancy(transportCell.cx, transportCell.cy);
          if (pickedUpTransport) {
            ctx.map.clearVehicleOccupancy(transportCell.cx, transportCell.cy, entity.id);
          }
          let spot: ReturnType<typeof closestInfantryUnlimboSpot>;
          try {
            spot = closestInfantryUnlimboSpot(ctx, passenger, entity.leptonX, entity.leptonY);
          } finally {
            if (pickedUpTransport) {
              ctx.map.setVehicleOccupancy(transportCell.cx, transportCell.cy, entity.id);
            }
          }
          if (!spot) {
            entity.passengers.shift();
            passenger.alive = false;
            passenger.transportRef = null;
            entity.missionTimer = nextUnloadDelay;
            return true;
          }
          passenger.leptonX = spot.lx;
          passenger.leptonY = spot.ly;
          passenger.syncPosFromLeptons();
          passenger.subCell = spot.subCell;
          passenger.claimedCellIdx = spot.cellIdx;
          passenger.claimedSubCell = spot.subCell;
        } else {
          passenger.setPosition(entity.pos.x, entity.pos.y);
        }
        entity.passengers.shift();
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
        clearFootPath(passenger);
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
          setAircraftHeight(entity, 0);
          entity.aircraftSpeedFraction = 0;
        } else {
          entity.mission = ctx.idleMission(entity);
          entity.aircraftState = 'returning';
          setAircraftHeight(entity, AIRCRAFT_HEIGHT_STEP_LEPTONS); // start climbing
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
      if (entity.isFixedWing && entity.mission === Mission.ENTER) {
        return updateFixedWingMissionEnter(ctx, entity);
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
          applyAircraftLandingHeightStep(ctx, entity);
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
        applyAircraftLandingHeightStep(ctx, entity);
      } else {
        aircraftFlyInFacing(entity, padPos, ctx.movementSpeed(entity));
      }
      return true;
    }

    case 'landing': {
      ensureAircraftHeight(entity);
      // C++ AircraftClass::AI runs Movement_AI while IsLanding is true. Fixed-wing
      // aircraft keep moving forward at their LandingSpeed until touchdown.
      if (entity.isFixedWing && entity.aircraftHeightLeptons > 0) {
        entity.animState = AnimState.WALK;
        entity.aircraftSpeedFraction = fixedWingLandingSpeedFraction(ctx, entity);
        aircraftFlyCurrentFacing(entity, ctx.movementSpeed(entity));
      } else {
        entity.animState = AnimState.IDLE;
      }
      applyAircraftLandingHeightStep(ctx, entity);
      return true;
    }

    case 'rearming': {
      setAircraftHeight(entity, 0);
      entity.animState = AnimState.IDLE;
      // C++ techno.cpp:965: if (Ammo == MaxAmmo) return(RADIO_NEGATIVE);
      // Check BEFORE increment — ammo must never exceed maxAmmo (C++ parity).
      if (entity.ammo >= entity.maxAmmo) {
        entity.aircraftState = 'landed';
        leavePadRepairMission(ctx, entity);
        return true;
      }
      entity.rearmTimer--;
      if (entity.rearmTimer <= 0) {
        entity.ammo++;
        if (entity.ammo >= entity.maxAmmo) {
          entity.aircraftState = 'landed';
          leavePadRepairMission(ctx, entity);
        } else {
          // C++ building.cpp:4023-4025: building-driven rearm delay
          entity.rearmTimer = computeRearmDelay(ctx.getPowerFraction(entity.house));
          const pad = landedServicePad(ctx, entity);
          if (pad && (pad.type === 'AFLD' || pad.type === 'HPAD')) {
            enterPadRepairMission(ctx, entity, pad, entity.rearmTimer);
          }
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

  const targetPos = getFixedWingAttackTargetPos(entity);

  if (!targetPos) {
    entity.aircraftState = 'returning';
    entity.mission = Mission.GUARD;
    return true;
  }

  const speed = ctx.movementSpeed(entity);
  const flyCurrentFacing = () => {
    aircraftFlyCurrentFacing(entity, speed);
  };

  const LOOK_FOR_TARGET = 0;
  const TAKE_OFF = 1;
  const FLY_TO_TARGET = 2;
  const DROP_BOMBS = 3;
  const REGROUP = 4;

  if (entity.missionTimer > 0) {
    entity.missionTimer--;
    flyCurrentFacing();
    return true;
  }

  switch (entity.aircraftAttackStatus) {
    case LOOK_FOR_TARGET:
      entity.aircraftAttackStatus = TAKE_OFF;
      entity.attackRunPhase = 'flyToTarget';
      flyCurrentFacing();
      return true;

    case TAKE_OFF:
      // Reinforcement fixed-wing aircraft are already airborne at flight level,
      // so C++ Process_Take_Off succeeds immediately and advances to
      // FLY_TO_TARGET after this one Mission_Hunt dispatch.
      entity.aircraftAttackStatus = FLY_TO_TARGET;
      entity.attackRunPhase = 'flyToTarget';
      entity.aircraftSpeedFraction = 1.0;
      flyCurrentFacing();
      return true;
  }

  switch (entity.attackRunPhase) {
    case 'flyToTarget': {
      // C++ FLY_TO_TARGET: fly toward target, check Can_Fire() result
      entity.animState = AnimState.WALK;
      const weapon = entity.weapon;
      if (!weapon) {
        entity.attackRunPhase = 'regroup';
        entity.aircraftAttackStatus = REGROUP;
        flyCurrentFacing();
        break;
      }
      const fireState = fixedWingCanFire(entity, targetPos, weapon);
      switch (fireState) {
        case 'ok':
          entity.attackRunPhase = 'dropBombs';
          entity.aircraftAttackStatus = DROP_BOMBS;
          entity.circleBreakTimer = 0;
          entity.missionTimer = 0;
          break;

        case 'ammo':
          entity.attackRunPhase = 'regroup';
          entity.aircraftAttackStatus = REGROUP;
          entity.missionTimer = Math.floor(TICKS_PER_SECOND / 2) - 1;
          break;

        case 'facing': {
          const target = fixedWingTargetLeptons(targetPos);
          const inRange = leptonDist(entity.leptonX, entity.leptonY, target.lx, target.ly) <= weapon.range * LEPTON_SIZE;
          if (inRange) {
            // C++ anti-circle path: return TICKS_PER_SECOND*2 without changing
            // desired facing, giving the aircraft time to fly out of the turn.
            entity.missionTimer = TICKS_PER_SECOND * 2 - 1;
          } else if (currentAircraftFacing256(entity) === currentDesiredAircraftFacing256(entity)) {
            setDesiredAircraftFacing256(entity, directionToLeptons256(entity.leptonX, entity.leptonY, target.lx, target.ly));
            entity.missionTimer = Math.floor(TICKS_PER_SECOND / 2) - 1;
          } else {
            entity.missionTimer = Math.floor(TICKS_PER_SECOND / 2) - 1;
          }
          break;
        }

        case 'range':
        case 'rearm': {
          const target = fixedWingTargetLeptons(targetPos);
          if (currentAircraftFacing256(entity) === currentDesiredAircraftFacing256(entity)) {
            setDesiredAircraftFacing256(entity, directionToLeptons256(entity.leptonX, entity.leptonY, target.lx, target.ly));
          }
          entity.missionTimer = Math.floor(TICKS_PER_SECOND / 2) - 1;
          break;
        }
      }
      flyCurrentFacing();
      break;
    }

    case 'dropBombs': {
      // C++ DROP_BOMBS: fire at target when Can_Fire returns FIRE_OK
      entity.animState = AnimState.ATTACK;
      const weapon = entity.weapon;
      if (!weapon) {
        entity.attackRunPhase = 'regroup';
        entity.aircraftAttackStatus = REGROUP;
        flyCurrentFacing();
        break;
      }

      const fireState = fixedWingCanFire(entity, targetPos, weapon);
      if (fireState === 'ok') {
        const shots = entity.isTwoShooter() ? 2 : 1;
        let arm = Math.max(1, Math.round(weapon.rof * ctx.getROFBias(entity.house)));
        for (let i = 0; i < shots; i++) {
          fireFixedWingShot(ctx, entity, weapon, targetPos);
          const isSecond = entity.isSecondShot;
          arm = isSecond ? Math.max(1, Math.round(weapon.rof * ctx.getROFBias(entity.house))) : 3;
          if (entity.isTwoShooter()) entity.isSecondShot = !entity.isSecondShot;
          if (entity.ammo > 0) entity.ammo--;
        }
        const postFrameArm = Math.max(0, arm - 1);
        entity.attackCooldown = postFrameArm;
        entity.missionTimer = postFrameArm;
      } else if (fireState === 'range' || fireState === 'facing') {
        entity.attackRunPhase = 'flyToTarget';
        entity.aircraftAttackStatus = FLY_TO_TARGET;
        entity.missionTimer = TICKS_PER_SECOND * 4 - 1;
      } else if (fireState === 'ammo') {
        entity.attackRunPhase = 'regroup';
        entity.aircraftAttackStatus = REGROUP;
      }

      const targetLost = !getFixedWingAttackTargetPos(entity);
      if (targetLost) {
        entity.attackRunPhase = 'regroup';
        entity.aircraftAttackStatus = REGROUP;
      }
      flyCurrentFacing();
      break;
    }

    case 'regroup': {
      // C++ REGROUP does not use a geometric overshoot test. It resolves ammo,
      // team removal and idle/docking mission assignment, then falls through to
      // Mission_Hunt's final Normal_Delay + Random_Pick(0,2) return.
      entity.animState = AnimState.WALK;
      if (entity.ammo === 0) {
        if (entity.teamRef) {
          if (ctx.removeFromTeamForRetreat) ctx.removeFromTeamForRetreat(entity);
          else entity.teamRef.remove(entity);
        }
        if (!entity.teamRef) {
          enterFixedWingDockingMission(ctx, entity);
        }
      } else {
        entity.attackRunPhase = 'flyToTarget';
        entity.aircraftAttackStatus = LOOK_FOR_TARGET;
      }
      entity.aircraftAttackStatus = LOOK_FOR_TARGET;
      entity.attackRunPhase = 'flyToTarget';
      fixedWingMissionHuntFinalDelay(entity);
      flyCurrentFacing();
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
