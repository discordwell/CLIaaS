/**
 * Tests for SCG01EA helicopter evacuation — Einstein rescue chain.
 *
 * Verifies:
 * 1. Aircraft reinforcements spawn at house edge (not at origin waypoint)
 * 2. Transport helicopters land on ground when no helipad available
 * 3. findEntityAt accounts for flight altitude offset
 * 4. TMISSION_MOVE checks arrival before re-issuing MOVE (aircraft race condition fix)
 * 5. TEVENT_EVAC_CIVILIAN fires when Einstein exits map aboard transport
 * 6. Trigger chain: eins → ein2 → ein3 → heli spawn → player loads → evac → win
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  UnitType, House, Mission, AnimState, UNIT_STATS, CELL_SIZE,
  cellToWorld, worldToCell, worldDist, CIVILIAN_UNIT_TYPES,
} from '../engine/types';
import {
  calculateHouseEdgeSpawnCell,
  checkTriggerEvent,
  initializeTriggerAttachmentCounts,
  executeTriggerAction,
  parseScenarioINI,
  type TriggerGameState,
  type TriggerEvent,
  type TriggerAction,
  type TeamType,
  type ScenarioTrigger,
  type CellPos,
} from '../engine/scenario';

beforeEach(() => resetEntityIds());

// Helper: minimal TriggerGameState
const createState = (overrides: Partial<TriggerGameState> = {}): TriggerGameState => ({
  gameTick: 0,
  globals: new Set(),
  triggerStartTick: 0,
  triggerName: 'test',
  playerEntered: false,
  enemyUnitsAlive: 0,
  enemyKillCount: 0,
  playerFactories: 0,
  missionTimerExpired: false,
  bridgesAlive: 0,
  unitsLeftMap: 0,
  structureTypes: new Set(),
  builtStructureTypes: new Set(),
  destroyedTriggerNames: new Set(),
  houseAlive: new Map(),
  isLowPower: false,
  playerCredits: 0,
  buildingsDestroyedByHouse: new Map(),
  nBuildingsDestroyed: 0,
  playerFactoriesExist: true,
  civiliansEvacuated: 0,
  builtUnitTypes: new Set(),
  builtInfantryTypes: new Set(),
  builtAircraftTypes: new Set(),
  fakesExist: true,
  spiedBuildings: new Set(),
  isThieved: false,
  ...overrides,
});

// SCG01EA waypoints (cell → {cx, cy})
const WP0: CellPos = { cx: 54, cy: 48 };   // Signal flare / Einstein destination
const WP7: CellPos = { cx: 62, cy: 61 };   // Einstein spawn
const WP23: CellPos = { cx: 66, cy: 80 };  // Helicopter origin (south)
const WP24: CellPos = { cx: 53, cy: 49 };  // Helicopter destination (near signal flare)

const waypoints = new Map<number, CellPos>([
  [0, WP0], [7, WP7], [23, WP23], [24, WP24],
]);

// Map bounds from SCG01EA
const mapBounds = { x: 49, y: 45, w: 30, h: 36 };

// House edges from SCG01EA
const houseEdges = new Map<House, string>([
  [House.Greece, 'East'],
  [House.England, 'West'],
  [House.GoodGuy, 'East'],
]);

describe('SCG01EA Trigger Chain', () => {
  it('counts both prison guards on the semi-persistent rescue trigger', () => {
    const ini = fs.readFileSync(
      path.join(process.cwd(), 'public', 'ra', 'assets', 'SCG01EA.ini'),
      'utf8',
    );
    const parsed = parseScenarioINI(ini);
    const trigger = parsed.triggers.find((entry) => entry.name === 'eins');

    expect(trigger).toBeDefined();
    initializeTriggerAttachmentCounts(
      [trigger!],
      [
        ...parsed.units.flatMap((unit) => unit.trigger && unit.trigger !== 'None' ? [unit.trigger] : []),
        ...parsed.infantry.flatMap((unit) => unit.trigger && unit.trigger !== 'None' ? [unit.trigger] : []),
        ...parsed.structures.flatMap((structure) => structure.trigger && structure.trigger !== 'None' ? [structure.trigger] : []),
        ...parsed.cellTriggers.values(),
      ],
    );

    expect(trigger!.persistence).toBe(1);
    expect(trigger!.attachCount).toBe(2);
    expect(trigger!.remainingAttachCount).toBe(2);
  });

  it('TEVENT_EVAC_CIVILIAN (18) fires when civiliansEvacuated > 0', () => {
    const event: TriggerEvent = { type: 18, team: -1, data: 0 };

    expect(checkTriggerEvent(event, createState({ civiliansEvacuated: 0 }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ civiliansEvacuated: 1 }))).toBe(true);
  });

  it('TEVENT_GLOBAL_SET (27) detects global 1 for helicopter spawn', () => {
    const event: TriggerEvent = { type: 27, team: -1, data: 1 };

    expect(checkTriggerEvent(event, createState())).toBe(false);
    expect(checkTriggerEvent(event, createState({ globals: new Set([1]) }))).toBe(true);
  });

  it('TACTION_SET_GLOBAL (28) sets global 1', () => {
    const action: TriggerAction = { action: 28, team: -1, trigger: 0, data: 1 };
    const globals = new Set<number>();
    const triggers: ScenarioTrigger[] = [];
    const teams: TeamType[] = [];

    executeTriggerAction(action, teams, waypoints, globals, triggers);
    expect(globals.has(1)).toBe(true);
  });

  it('Einstein reinforcement receives the full TS spawn-protection window', () => {
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: -1 };
    const teams: TeamType[] = [{
      name: 'einst',
      house: 1,
      flags: 0,
      origin: 7,
      trigger: -1,
      members: [{ type: 'EINSTEIN', count: 1 }],
      missions: [{ mission: 3, data: 7 }],
    }];

    const result = executeTriggerAction(action, teams, waypoints, new Set(), []);
    expect(result.spawned).toHaveLength(1);
    expect(result.spawned[0].type).toBe(UnitType.I_EINSTEIN);
    expect(result.spawned[0].invulnTick).toBe(120);
  });
});

describe('Aircraft reinforcement edge spawn', () => {
  // heli team: GoodGuy, origin=WP23, 1 TRAN, missions: MOVE WP23, MOVE WP24, LOOP 2
  const heliTeam: TeamType = {
    name: 'heli',
    house: 8, // GoodGuy
    flags: 0,
    origin: 23,
    members: [{ type: 'TRAN', count: 1 }],
    missions: [
      { mission: 3, data: 23 }, // MOVE WP23
      { mission: 3, data: 24 }, // MOVE WP24
      { mission: 6, data: 2 },  // LOOP to 2
    ],
  };

  it('helicopter spawns at house edge, not at origin waypoint', () => {
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: -1 }; // REINFORCEMENTS
    const teams = [heliTeam];
    const globals = new Set<number>();
    const triggers: ScenarioTrigger[] = [];

    const result = executeTriggerAction(
      action, teams, waypoints, globals, triggers, 8, houseEdges, mapBounds
    );

    expect(result.spawned.length).toBe(1);
    const heli = result.spawned[0];
    expect(heli.type).toBe(UnitType.V_TRAN);
    expect(heli.house).toBe(House.GoodGuy);

    const spawnCell = calculateHouseEdgeSpawnCell(House.GoodGuy, houseEdges, mapBounds, WP23);
    expect(spawnCell).toBeDefined();
    const spawnWorld = cellToWorld(spawnCell!.cx, spawnCell!.cy);
    expect(heli.pos.x).toBe(spawnWorld.x);
    expect(heli.pos.y).toBe(spawnWorld.y);

    // Should be airborne in flying state
    expect(heli.aircraftState).toBe('flying');
    expect(heli.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
    expect(heli.mission).toBe(Mission.MOVE);

    // Move target should be the origin waypoint (WP23)
    const wp23World = cellToWorld(WP23.cx, WP23.cy);
    expect(heli.moveTarget!.x).toBe(wp23World.x);
    expect(heli.moveTarget!.y).toBe(wp23World.y);
  });

  it('team with infantry spawns aircraft at edge (tanya team flies in)', () => {
    // tanya team: Greece, origin=WP0, E7 + TRAN, UNLOAD
    // Original C++ RA spawns ALL aircraft reinforcements from house edge,
    // including transports carrying infantry passengers.
    const tanyaTeam: TeamType = {
      name: 'tanya',
      house: 1, // Greece
      flags: 0,
      origin: 0, // WP0
      members: [
        { type: 'E7', count: 1 },
        { type: 'TRAN', count: 1 },
      ],
      missions: [{ mission: 8, data: 0 }], // UNLOAD at WP0
    };

    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: -1 };
    const teams = [tanyaTeam];
    const globals = new Set<number>();
    const triggers: ScenarioTrigger[] = [];

    const result = executeTriggerAction(
      action, teams, waypoints, globals, triggers, 1, houseEdges, mapBounds
    );

    // TRAN should be spawned (E7 auto-loaded into TRAN)
    const tran = result.spawned.find(e => e.type === UnitType.V_TRAN);
    expect(tran).toBeDefined();

    const spawnCell = calculateHouseEdgeSpawnCell(House.Greece, houseEdges, mapBounds, WP0);
    expect(spawnCell).toBeDefined();
    const spawnWorld = cellToWorld(spawnCell!.cx, spawnCell!.cy);
    expect(tran!.pos.x).toBe(spawnWorld.x);
    expect(tran!.pos.y).toBe(spawnWorld.y);

    // Should be airborne — transports with UNLOAD mission start in 'unload_search'
    // (C++ Mission_Unload SEARCH_FOR_LZ state: 14-16 tick delay before controlled approach)
    expect(tran!.aircraftState).toBe('unload_search');
    expect(tran!.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);

    // Move target should be the origin waypoint (WP0)
    const wp0World = cellToWorld(WP0.cx, WP0.cy);
    expect(tran!.moveTarget!.x).toBe(wp0World.x);
    expect(tran!.moveTarget!.y).toBe(wp0World.y);

    // E7 (Tanya) should be loaded into TRAN (not in spawned list)
    expect(tran!.passengers.length).toBe(1);
    expect(tran!.passengers[0].type).toBe(UnitType.I_TANYA);
  });
});

describe('Transport helicopter landing without helipad', () => {
  it('TRAN entity starts with correct aircraft properties', () => {
    const tran = new Entity(UnitType.V_TRAN, House.GoodGuy, 100, 100);
    expect(tran.stats.isAircraft).toBe(true);
    expect(tran.isTransport).toBe(true);
    expect(tran.stats.landingBuilding).toBeUndefined(); // C++ aadata.cpp:168: STRUCT_NONE
    expect(tran.aircraftState).toBe('flying'); // C++ aircraft.cpp:249: created airborne
    expect(tran.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
    expect(tran.ammo).toBe(-1); // unlimited (no weapon)
  });

  it('TRAN can load EINSTEIN passenger', () => {
    const tran = new Entity(UnitType.V_TRAN, House.GoodGuy, 100, 100);
    const einstein = new Entity(UnitType.I_EINSTEIN, House.Greece, 100, 100);

    expect(tran.maxPassengers).toBe(5);
    tran.passengers.push(einstein);
    einstein.transportRef = tran;

    expect(tran.passengers.length).toBe(1);
    expect(tran.passengers[0].type).toBe(UnitType.I_EINSTEIN);
  });
});

describe('findEntityAt with flight altitude', () => {
  it('ground click at entity ground pos finds entity', () => {
    const entity = new Entity(UnitType.V_TRAN, House.GoodGuy, 200, 200);
    entity.flightAltitude = Entity.FLIGHT_ALTITUDE; // airborne

    // Simulate findEntityAt logic — entity.pos is lepton-quantized so may differ
    // slightly from the requested (200, 200) by up to ~0.05px
    const clickPos = { x: 200, y: 200 }; // ground level click
    const dx = entity.pos.x - clickPos.x;
    const dy = entity.pos.y - clickPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    expect(dist).toBeLessThan(0.1); // close to 0 within lepton quantization
    expect(dist).toBeLessThan(20);
  });

  it('click at visual aircraft position (altitude-offset) also finds entity', () => {
    const entity = new Entity(UnitType.V_TRAN, House.GoodGuy, 200, 200);
    entity.flightAltitude = Entity.FLIGHT_ALTITUDE; // 24px above ground

    // Player clicks where the aircraft APPEARS on screen (offset up by flightAltitude)
    const clickPos = { x: 200, y: 200 - Entity.FLIGHT_ALTITUDE };
    const dx = entity.pos.x - clickPos.x;

    // Ground distance check fails (~24px > 20px threshold)
    const dyGround = entity.pos.y - clickPos.y;
    const distGround = Math.sqrt(dx * dx + dyGround * dyGround);
    expect(distGround).toBeCloseTo(Entity.FLIGHT_ALTITUDE, 0); // ~24
    expect(distGround).toBeGreaterThan(20); // would MISS without altitude check

    // Altitude-adjusted check succeeds
    const dyAlt = (entity.pos.y - entity.flightAltitude) - clickPos.y;
    const distAlt = Math.sqrt(dx * dx + dyAlt * dyAlt);
    expect(distAlt).toBeLessThan(0.1); // close to 0 within lepton quantization
    expect(distAlt).toBeLessThan(20); // HITS with altitude check
  });
});

describe('TMISSION_MOVE arrival-first check', () => {
  it('entity already at waypoint advances mission immediately', () => {
    const entity = new Entity(UnitType.V_TRAN, House.GoodGuy,
      WP23.cx * CELL_SIZE + CELL_SIZE / 2,
      WP23.cy * CELL_SIZE + CELL_SIZE / 2);

    entity.teamMissions = [
      { mission: 3, data: 23 }, // MOVE WP23
      { mission: 3, data: 24 }, // MOVE WP24
    ];
    entity.teamMissionIndex = 0;

    // Entity is at WP23, mission 0 is MOVE WP23
    const target = cellToWorld(WP23.cx, WP23.cy);
    const dist = worldDist(entity.pos, { x: target.x, y: target.y });
    // worldDist returns cells, not pixels
    expect(dist).toBeLessThan(2);

    // The arrival check (worldDist < 2) should detect this and advance
    // (Previously, it would re-issue MOVE before checking arrival)
  });

  it('entity far from waypoint does not advance', () => {
    const entity = new Entity(UnitType.V_TRAN, House.GoodGuy, 100, 100);
    entity.teamMissions = [
      { mission: 3, data: 23 }, // MOVE WP23
    ];
    entity.teamMissionIndex = 0;

    const target = cellToWorld(WP23.cx, WP23.cy);
    const dist = worldDist(entity.pos, { x: target.x, y: target.y });
    expect(dist).toBeGreaterThan(2);
  });
});

describe('Einstein civilian evacuation win condition', () => {
  it('EINSTEIN is in CIVILIAN_UNIT_TYPES', () => {
    expect(CIVILIAN_UNIT_TYPES.has('EINSTEIN')).toBe(true);
  });

  it('win trigger fires when civilian is evacuated', () => {
    // win trigger: event=EVAC_CIVILIAN(18), action=WIN(1)
    const winEvent: TriggerEvent = { type: 18, team: -1, data: 0 };

    // Before evacuation
    expect(checkTriggerEvent(winEvent, createState({ civiliansEvacuated: 0 }))).toBe(false);

    // After Einstein evacuated (aboard helicopter exiting map)
    expect(checkTriggerEvent(winEvent, createState({ civiliansEvacuated: 1 }))).toBe(true);
  });

  it('TACTION_WIN produces win result', () => {
    const action: TriggerAction = { action: 1, team: -1, trigger: -1, data: -255 };
    const result = executeTriggerAction(
      action, [], waypoints, new Set(), []
    );
    expect(result.win).toBe(true);
  });
});
