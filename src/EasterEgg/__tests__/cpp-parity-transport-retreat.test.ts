/**
 * C++ Behavioral Parity: Transport Retreat After Unload
 *
 * Covers: TRAN (Chinook) loaner transport auto-retreat after unloading passengers
 *
 * C++ source references:
 *   - reinf.cpp:251 — IsALoaner set on transports with TMISSION_UNLOAD
 *   - aircraft.cpp:1154-1186 — UNLOAD_PASSENGERS calls Enter_Idle_Mode() when empty
 *   - aircraft.cpp:1932-1948 — Enter_Idle_Mode: helicopter on ground, IsALoaner, no cargo → MISSION_RETREAT
 *   - aircraft.cpp:1309-1367 — Mission_Retreat: TAKE_OFF → FACE_MAP_EDGE → KEEP_FLYING → off-map delete
 *
 * SCG01EA parity observation:
 *   C++ WASM: TRAN flies away after unloading Tanya (E7) — by tick 300 at (68,46) heading off-map.
 *   TS engine: TRAN was stuck at (63,47) indefinitely. This fix ensures it retreats.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnitType, House, Mission, AnimState, CELL_SIZE,
  UNIT_STATS,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap } from '../engine/map';
import type { AircraftContext } from '../engine/aircraft';
import {
  updateAircraft,
  resetAircraftFrame,
} from '../engine/aircraft';

beforeEach(() => {
  resetEntityIds();
  resetAircraftFrame();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeMap(boundsX = 1, boundsY = 1, boundsW = 62, boundsH = 62): GameMap {
  const map = new GameMap();
  map.setBounds(boundsX, boundsY, boundsW, boundsH);
  return map;
}

function makeAircraftContext(overrides: Partial<AircraftContext> = {}): AircraftContext {
  return {
    structures: [],
    map: makeMap(),
    unitsLeftMap: 0,
    civiliansEvacuated: 0,
    isAllied: (a, b) => a === b,
    movementSpeed: () => 3,
    idleMission: () => Mission.GUARD,
    fireWeaponAt: vi.fn(),
    fireWeaponAtStructure: vi.fn(),
    getROFBias: () => 1.0,
    getPowerFraction: () => 1.0,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: isALoaner flag prerequisites
// C++ reinf.cpp:251 — IsALoaner on aircraft/vessel transports with UNLOAD mission
// ═══════════════════════════════════════════════════════════════════════════════

describe('isALoaner flag prerequisites (reinf.cpp:251)', () => {
  it('TRAN is an aircraft transport with 5 passengers capacity', () => {
    const stats = UNIT_STATS.TRAN;
    expect(stats.isAircraft).toBe(true);
    expect(stats.passengers).toBe(5);
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 30, 30);
    expect(tran.isTransport).toBe(true);
    expect(tran.isAirUnit).toBe(true);
  });

  it('isALoaner defaults to undefined (non-reinforcement units)', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 30, 30);
    expect(tran.isALoaner).toBeUndefined();
  });

  it('isALoaner can be set to true for reinforcement transports', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 30, 30);
    tran.isALoaner = true;
    expect(tran.isALoaner).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Aircraft state machine handles RETREAT from landed state
// C++ aircraft.cpp:1309-1367 — Mission_Retreat: TAKE_OFF → FACE_MAP_EDGE → KEEP_FLYING
// ═══════════════════════════════════════════════════════════════════════════════

describe('Aircraft RETREAT from landed state (aircraft.cpp:1309-1367)', () => {
  it('landed TRAN with RETREAT mission transitions to takeoff', () => {
    const ctx = makeAircraftContext();
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 30, 30);
    tran.aircraftState = 'landed';
    tran.flightAltitude = 0;
    tran.mission = Mission.RETREAT;
    tran.isALoaner = true;

    const handled = updateAircraft(ctx, tran);
    expect(handled).toBe(true);
    expect(tran.aircraftState).toBe('takeoff');
  });

  it('non-RETREAT landed TRAN stays landed (no spurious takeoff)', () => {
    const ctx = makeAircraftContext();
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 30, 30);
    tran.aircraftState = 'landed';
    tran.flightAltitude = 0;
    tran.mission = Mission.GUARD;

    const handled = updateAircraft(ctx, tran);
    expect(handled).toBe(true);
    expect(tran.aircraftState).toBe('landed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: TRAN ascends during takeoff phase then transitions to flying
// C++ aircraft.cpp:1332-1336 — Process_Take_Off(): Height++, Status=FACE_MAP_EDGE when done
// ═══════════════════════════════════════════════════════════════════════════════

describe('Takeoff ascent during retreat (aircraft.cpp:1332-1336)', () => {
  it('TRAN ascends 1px/tick during takeoff', () => {
    const ctx = makeAircraftContext();
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 30, 30);
    tran.aircraftState = 'takeoff';
    tran.flightAltitude = 0;
    tran.mission = Mission.RETREAT;
    tran.isALoaner = true;

    // Tick once
    updateAircraft(ctx, tran);
    expect(tran.flightAltitude).toBe(1);
    expect(tran.aircraftState).toBe('takeoff');
  });

  it('TRAN transitions to flying at flight altitude', () => {
    const ctx = makeAircraftContext();
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 30, 30);
    tran.aircraftState = 'takeoff';
    tran.flightAltitude = Entity.FLIGHT_ALTITUDE - 1; // one tick away
    tran.mission = Mission.RETREAT;
    tran.isALoaner = true;

    updateAircraft(ctx, tran);
    expect(tran.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
    expect(tran.aircraftState).toBe('flying');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: Flying RETREAT — compute edge target and fly toward it
// C++ aircraft.cpp:1341-1361 — FACE_MAP_EDGE: Set_Speed(0xFF), face friendly edge
// ═══════════════════════════════════════════════════════════════════════════════

describe('Flying retreat to map edge (aircraft.cpp:1341-1361)', () => {
  it('RETREAT in flying state computes map edge moveTarget', () => {
    const ctx = makeAircraftContext();
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 30, 30);
    tran.aircraftState = 'flying';
    tran.flightAltitude = Entity.FLIGHT_ALTITUDE;
    tran.mission = Mission.RETREAT;
    tran.isALoaner = true;
    tran.moveTarget = null;

    updateAircraft(ctx, tran);
    // Should have computed a moveTarget toward the nearest map edge
    expect(tran.moveTarget).not.toBeNull();
  });

  it('RETREAT moveTarget is outside map bounds (to trigger exit)', () => {
    const map = makeMap(1, 1, 62, 62); // bounds: x=1..62, y=1..62
    const ctx = makeAircraftContext({ map });
    // Place at cell (5, 30) — closest edge is left (x=1), distance=4
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 5, 30);
    tran.aircraftState = 'flying';
    tran.flightAltitude = Entity.FLIGHT_ALTITUDE;
    tran.mission = Mission.RETREAT;
    tran.isALoaner = true;
    tran.moveTarget = null;

    updateAircraft(ctx, tran);
    expect(tran.moveTarget).not.toBeNull();
    // Target should be at x=0 (boundsX - 1 = 0), which is outside bounds
    const targetCellX = Math.floor(tran.moveTarget!.x / CELL_SIZE);
    expect(targetCellX).toBe(0); // one cell outside left edge
  });

  it('TRAN at top edge: retreat target is above bounds', () => {
    const map = makeMap(1, 1, 62, 62);
    const ctx = makeAircraftContext({ map });
    // Place at cell (30, 3) — closest edge is top (y=1), distance=2
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 30, 3);
    tran.aircraftState = 'flying';
    tran.flightAltitude = Entity.FLIGHT_ALTITUDE;
    tran.mission = Mission.RETREAT;
    tran.moveTarget = null;

    updateAircraft(ctx, tran);
    expect(tran.moveTarget).not.toBeNull();
    const targetCellY = Math.floor(tran.moveTarget!.y / CELL_SIZE);
    expect(targetCellY).toBe(0); // one cell outside top edge
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: Map exit — TRAN is deleted when reaching map edge
// C++ aircraft.cpp:1356-1361 — KEEP_FLYING → auto-eliminated at edge
// ═══════════════════════════════════════════════════════════════════════════════

describe('Map exit on retreat (aircraft.cpp:1356-1361)', () => {
  it('TRAN at map edge during RETREAT is removed (alive=false)', () => {
    const map = makeMap(1, 1, 62, 62);
    const ctx = makeAircraftContext({ map });
    // Place at cell (1, 30) — AT the left boundary edge
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 1, 30);
    tran.aircraftState = 'flying';
    tran.flightAltitude = Entity.FLIGHT_ALTITUDE;
    tran.mission = Mission.RETREAT;
    tran.isALoaner = true;
    // Pre-set moveTarget so it doesn't get computed fresh
    tran.moveTarget = { x: 0 * CELL_SIZE + CELL_SIZE / 2, y: 30 * CELL_SIZE + CELL_SIZE / 2 };

    updateAircraft(ctx, tran);
    expect(tran.alive).toBe(false);
    expect(tran.mission).toBe(Mission.DIE);
  });

  it('TRAN at right edge during RETREAT is removed', () => {
    const map = makeMap(1, 1, 62, 62); // right edge = boundsX + boundsW - 1 = 62
    const ctx = makeAircraftContext({ map });
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 62, 30);
    tran.aircraftState = 'flying';
    tran.flightAltitude = Entity.FLIGHT_ALTITUDE;
    tran.mission = Mission.RETREAT;
    tran.isALoaner = true;
    tran.moveTarget = { x: 63 * CELL_SIZE + CELL_SIZE / 2, y: 30 * CELL_SIZE + CELL_SIZE / 2 };

    updateAircraft(ctx, tran);
    expect(tran.alive).toBe(false);
  });

  it('unitsLeftMap incremented on map exit', () => {
    const map = makeMap(1, 1, 62, 62);
    const ctx = makeAircraftContext({ map });
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 1, 30);
    tran.aircraftState = 'flying';
    tran.flightAltitude = Entity.FLIGHT_ALTITUDE;
    tran.mission = Mission.RETREAT;
    tran.isALoaner = true;
    tran.moveTarget = { x: 0 * CELL_SIZE + CELL_SIZE / 2, y: 30 * CELL_SIZE + CELL_SIZE / 2 };

    expect(ctx.unitsLeftMap).toBe(0);
    updateAircraft(ctx, tran);
    expect(ctx.unitsLeftMap).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: Full retreat lifecycle — landed → takeoff → flying → exit
// End-to-end simulation matching SCG01EA TRAN behavior
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full retreat lifecycle: landed → takeoff → flying → exit', () => {
  it('TRAN retreats from center of map and eventually exits', () => {
    const map = makeMap(1, 1, 62, 62);
    const ctx = makeAircraftContext({ map });
    // Place near left edge (cell 5, 30) — should retreat left
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 5, 30);
    tran.aircraftState = 'landed';
    tran.flightAltitude = 0;
    tran.mission = Mission.RETREAT;
    tran.isALoaner = true;
    tran.passengers = [];

    const startX = tran.pos.x;

    // Run up to 500 ticks — should be enough to take off and fly to edge
    let exitTick = -1;
    for (let tick = 0; tick < 500; tick++) {
      updateAircraft(ctx, tran);
      if (!tran.alive) {
        exitTick = tick;
        break;
      }
    }

    // Transport should have exited the map
    expect(tran.alive).toBe(false);
    expect(exitTick).toBeGreaterThan(0);
    expect(exitTick).toBeLessThan(500);
    // Should have moved from starting position
    expect(ctx.unitsLeftMap).toBe(1);
  });

  it('passengers aboard retreating TRAN are also removed on exit', () => {
    const map = makeMap(1, 1, 62, 62);
    const ctx = makeAircraftContext({ map });
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 2, 30);
    tran.aircraftState = 'landed';
    tran.flightAltitude = 0;
    tran.mission = Mission.RETREAT;
    tran.isALoaner = true;

    // Load a passenger that wasn't unloaded
    const rifleman = entityAtCell(UnitType.I_E1, House.Spain, 2, 30);
    tran.passengers = [rifleman];

    for (let tick = 0; tick < 500; tick++) {
      updateAircraft(ctx, tran);
      if (!tran.alive) break;
    }

    expect(tran.alive).toBe(false);
    expect(rifleman.alive).toBe(false);
    // Transport + 1 passenger = 2 units left map
    expect(ctx.unitsLeftMap).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: RETREAT overrides returning state
// C++ aircraft.cpp:1309 — retreat takes priority over return-to-base
// ═══════════════════════════════════════════════════════════════════════════════

describe('RETREAT overrides returning state (aircraft.cpp:1309)', () => {
  it('returning TRAN with RETREAT switches to flying', () => {
    const ctx = makeAircraftContext();
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 30, 30);
    tran.aircraftState = 'returning';
    tran.flightAltitude = Entity.FLIGHT_ALTITUDE;
    tran.mission = Mission.RETREAT;
    tran.isALoaner = true;

    updateAircraft(ctx, tran);
    expect(tran.aircraftState).toBe('flying');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: Non-loaner transport does NOT retreat
// C++ aircraft.cpp:1948-1953: non-loaners get MISSION_GUARD, not RETREAT
// ═══════════════════════════════════════════════════════════════════════════════

describe('Non-loaner transport stays after unload (aircraft.cpp:1948-1953)', () => {
  it('non-loaner TRAN with GUARD mission stays landed', () => {
    const ctx = makeAircraftContext();
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 30, 30);
    tran.aircraftState = 'landed';
    tran.flightAltitude = 0;
    tran.mission = Mission.GUARD;
    tran.isALoaner = false;
    tran.passengers = [];

    // Run several ticks
    for (let i = 0; i < 50; i++) {
      updateAircraft(ctx, tran);
    }

    expect(tran.alive).toBe(true);
    expect(tran.aircraftState).toBe('landed');
  });
});
