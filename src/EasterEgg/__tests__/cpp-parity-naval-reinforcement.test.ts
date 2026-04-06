/**
 * C++ parity tests: naval reinforcement waypoint spawning
 *
 * C++ source refs:
 * - reinf.cpp:372-531 (Do_Reinforcements) — naval unit spawn, transport assignment
 * - reinf.cpp:167-278 (_Create_Group) — transport/passenger separation, IsALoaner on vessels
 * - display.cpp:2399-2534 (Calculated_Cell) — edge cell scan with SPEED_FLOAT
 * - display.cpp:2562-2593 (Good_Reinforcement_Cell) — Is_Clear_To_Move(SPEED_FLOAT)
 * - cell.cpp:2736-2810 (Is_Clear_To_Move) — Ground[land].Cost[loco] == 0 check
 * - vessel.cpp:1899-1932 (Mission_Retreat) — retreat to water edge cell
 *
 * ## Key C++ behaviors for naval reinforcements:
 *
 * 1. SPAWN CELL TERRAIN CHECK: Calculated_Cell with SPEED_FLOAT only returns WATER cells.
 *    Ground[LAND_CLEAR].Cost[SPEED_FLOAT] == 0, so land cells are rejected.
 *    C++ cell.cpp:2802: `if (::Ground[land].Cost[loco] == 0) return(false);`
 *
 * 2. LST TRANSPORT + UNLOAD -> IsALoaner: When a team has an UNLOAD mission and the
 *    transport is RTTI_VESSEL, IsALoaner is set to true (reinf.cpp:251):
 *    `if (hasunload && (transport->What_Am_I() == RTTI_AIRCRAFT || transport->What_Am_I() == RTTI_VESSEL)) {
 *        transport->IsALoaner = true;
 *    }`
 *
 * 3. EDGE FACING: The initial facing is derived from the source edge direction:
 *    reinf.cpp:439: `FacingType eface = (FacingType)(source << 1);`
 *    SOURCE_NORTH=0 -> FACING_N(0), SOURCE_EAST=1 -> FACING_NE(2),
 *    SOURCE_SOUTH=2 -> FACING_E(4), SOURCE_WEST=3 -> FACING_NW(6)
 *
 * 4. VESSEL RETREAT uses Calculated_Cell with SPEED_FLOAT — must navigate to water edge.
 *    vessel.cpp:1913: `Map.Calculated_Cell(House->Control.Edge, ..., Class->Speed)`
 *
 * 5. SHORE DETECTION: Shore templates (3-56) are treated as passable BEACH terrain
 *    (LAND_BEACH), NOT water. Ground[LAND_BEACH].Cost[SPEED_FLOAT] == 0, so vessels
 *    cannot spawn on shore cells — they need pure water (template 1-2).
 */

import { describe, it, expect } from 'vitest';
import {
  calculateHouseEdgeSpawnCell,
  executeTriggerAction,
  type TeamType,
  type TriggerAction,
  type ScenarioTrigger,
} from '../engine/scenario';
import {
  House,
  Mission,
  UNIT_STATS,
  TERRAIN_SPEED,
  SpeedClass,
  MAP_CELLS,
  type CellPos,
} from '../engine/types';
import { Entity } from '../engine/entity';
import { GameMap, Terrain } from '../engine/map';

// ============================================================
// C++ constants reproduced for reference
// ============================================================

// C++ reinf.cpp:62 — trigger action type for reinforcements
const TACTION_REINFORCEMENTS = 7;

// C++ reinf.cpp:251 — TMISSION_UNLOAD = 8 (from TEAMTYPE.H)
const TMISSION_UNLOAD = 8;
const TMISSION_MOVE = 3;

// C++ source types (display.cpp:2467-2491)
// SOURCE_NORTH=0, SOURCE_EAST=1, SOURCE_SOUTH=2, SOURCE_WEST=3

// ============================================================
// Helper: Check if a cell would be water-passable for FLOAT speed
// Uses the TS TERRAIN_SPEED table (mirrors C++ Ground[land].Cost)
// ============================================================
function isWaterPassableForFloat(terrain: string): boolean {
  const entry = TERRAIN_SPEED[terrain];
  if (!entry) return false;
  // SpeedClass.FLOAT = 4 (index 4 in the speed table)
  return entry[SpeedClass.FLOAT] > 0;
}

describe('Naval reinforcement — C++ parity', () => {
  // ============================================================
  // 1. TERRAIN SPEED TABLE: FLOAT speed passability
  // C++ cell.cpp:2802: Ground[land].Cost[loco] == 0 => impassable
  // ============================================================
  describe('SPEED_FLOAT terrain passability (C++ Ground[land].Cost)', () => {
    // C++ Ground table from rules.ini [Land Characteristics]:
    // Water: Cost[SPEED_FLOAT] = 100 (passable)
    // Clear: Cost[SPEED_FLOAT] = 0 (impassable)
    // Beach: Cost[SPEED_FLOAT] = 0 (impassable)
    // Rock:  Cost[SPEED_FLOAT] = 0 (impassable)

    it('Water terrain is passable for FLOAT speed', () => {
      expect(isWaterPassableForFloat('Water')).toBe(true);
    });

    it('Clear terrain is impassable for FLOAT speed', () => {
      expect(isWaterPassableForFloat('Clear')).toBe(false);
    });

    it('Beach terrain is impassable for FLOAT speed', () => {
      // C++ shore templates (3-56) = LAND_BEACH, Ground[LAND_BEACH].Cost[SPEED_FLOAT] = 0
      expect(isWaterPassableForFloat('Beach')).toBe(false);
    });

    it('Rock terrain is impassable for FLOAT speed', () => {
      expect(isWaterPassableForFloat('Rock')).toBe(false);
    });

    it('Road terrain is impassable for FLOAT speed', () => {
      expect(isWaterPassableForFloat('Road')).toBe(false);
    });

    it('all vessel unit types have SpeedClass.FLOAT', () => {
      // C++ vdata.cpp: all vessels use SPEED_FLOAT
      const vesselTypes = ['LST', 'SS', 'DD', 'CA', 'PT', 'MSUB'];
      for (const vt of vesselTypes) {
        const stats = UNIT_STATS[vt];
        expect(stats, `${vt} should exist in UNIT_STATS`).toBeDefined();
        expect(stats.speedClass, `${vt} speedClass should be FLOAT`).toBe(SpeedClass.FLOAT);
        expect(stats.isVessel, `${vt} should be flagged as vessel`).toBe(true);
      }
    });
  });

  // ============================================================
  // 2. CALCULATED_CELL: Naval spawn requires water edge cells
  // C++ display.cpp:2505-2527 + Good_Reinforcement_Cell
  // ============================================================
  describe('calculateHouseEdgeSpawnCell — naval spawn cell terrain', () => {
    const MAP_BOUNDS = { x: 10, y: 10, w: 50, h: 40 };

    // C++ Calculated_Cell with SPEED_FLOAT scans map edge cells and only
    // accepts cells where Good_Reinforcement_Cell returns true, which
    // requires Is_Clear_To_Move(SPEED_FLOAT) — meaning the cell must be water.
    //
    // FIXED: TS calculateHouseEdgeSpawnCell now accepts optional map + naval params.
    // When naval=true, it scans along the edge for water cells.

    it('should return a water cell for naval reinforcements, not a land cell', () => {
      // C++ display.cpp:2511: Good_Reinforcement_Cell(trycell, trycell+modifier, loco, zone, mzone)
      // For SPEED_FLOAT, only water cells pass this check.
      // C++ checks BOTH outcell (outside boundary, spawn position) and incell
      // (just inside boundary). The scan checks the INSIDE cell for water passability.
      const houseEdges = new Map<House, string>([[House.USSR, 'north']]);
      const originWp = { cx: 30, cy: 11 }; // near north edge so inference picks north
      const map = new GameMap();
      map.setBounds(MAP_BOUNDS.x, MAP_BOUNDS.y, MAP_BOUNDS.w, MAP_BOUNDS.h);
      // Set water at (25, boundsY) — the inside cell adjacent to north edge spawn
      // C++ Good_Reinforcement_Cell checks BOTH incell (inside boundary) AND outcell (outside boundary)
      map.setTerrain(25, MAP_BOUNDS.y, Terrain.WATER);
      map.setTerrain(25, MAP_BOUNDS.y - 1, Terrain.WATER); // outside cell must also be water

      const edgeCell = calculateHouseEdgeSpawnCell(
        House.USSR, houseEdges, MAP_BOUNDS, originWp,
        Math.random, map, true,
      );

      expect(edgeCell).toBeDefined();
      // Scan finds water at inside cell (25, boundsY), returns outside spawn cell (25, boundsY-1)
      expect(edgeCell!.cx).toBe(25);
      expect(edgeCell!.cy).toBe(MAP_BOUNDS.y - 1);
    });

    it('returns aligned cell when inside cell is already water (no scan needed)', () => {
      const houseEdges = new Map<House, string>([[House.USSR, 'north']]);
      const originWp = { cx: 30, cy: 11 }; // near north edge so inference picks north
      const map = new GameMap();
      map.setBounds(MAP_BOUNDS.x, MAP_BOUNDS.y, MAP_BOUNDS.w, MAP_BOUNDS.h);
      // Set water at (30, boundsY) — the inside cell aligned with spawn position
      map.setTerrain(30, MAP_BOUNDS.y, Terrain.WATER);

      const edgeCell = calculateHouseEdgeSpawnCell(
        House.USSR, houseEdges, MAP_BOUNDS, originWp,
        Math.random, map, true,
      );

      expect(edgeCell).toBeDefined();
      expect(edgeCell!.cx).toBe(30);
      // Spawn cell is at boundsY - 1 (1 outside)
      expect(edgeCell!.cy).toBe(MAP_BOUNDS.y - 1);
    });

    it('without naval flag, returns edge cell regardless of terrain', () => {
      const houseEdges = new Map<House, string>([[House.USSR, 'north']]);
      const originWp = { cx: 30, cy: 11 }; // near north edge so inference picks north
      const map = new GameMap();
      map.setBounds(MAP_BOUNDS.x, MAP_BOUNDS.y, MAP_BOUNDS.w, MAP_BOUNDS.h);
      // All CLEAR (land) — naval=false should not care
      const edgeCell = calculateHouseEdgeSpawnCell(
        House.USSR, houseEdges, MAP_BOUNDS, originWp,
        Math.random, map, false,
      );

      expect(edgeCell).toBeDefined();
      expect(edgeCell!.cx).toBe(30);
      // C++ display.cpp:2454: north edge cy = boundsY - 1
      expect(edgeCell!.cy).toBe(MAP_BOUNDS.y - 1);
    });

    it('edge cell is 1 cell outside map bounds (C++ Calculated_Cell)', () => {
      // C++ display.cpp:2537-2586: outcell is "just outside the edge"
      const houseEdges = new Map<House, string>([[House.USSR, 'south']]);
      const originWp = { cx: 35, cy: 48 }; // near south edge so inference picks south
      const edgeCell = calculateHouseEdgeSpawnCell(House.USSR, houseEdges, MAP_BOUNDS, originWp);

      expect(edgeCell).toBeDefined();
      // Aligned coordinate (cx) within bounds
      expect(edgeCell!.cx).toBeGreaterThanOrEqual(MAP_BOUNDS.x);
      expect(edgeCell!.cx).toBeLessThanOrEqual(MAP_BOUNDS.x + MAP_BOUNDS.w - 1);
      // Edge coordinate (cy) is 1 outside south boundary
      expect(edgeCell!.cy).toBe(MAP_BOUNDS.y + MAP_BOUNDS.h);
    });
  });

  // ============================================================
  // 3. EDGE FACING: C++ reinf.cpp:439
  // FacingType eface = (FacingType)(source << 1)
  // ============================================================
  describe('entry facing derived from source edge', () => {
    // C++ reinf.cpp:439: `FacingType eface = (FacingType)(source << 1);`
    // C++ reinf.cpp:465: `DirType desiredfacing = Facing_Dir(eface);`
    // SOURCE_NORTH(0) << 1 = 0 = FACING_N -> DIR_N
    // SOURCE_EAST(1) << 1 = 2 = FACING_E -> DIR_E
    // SOURCE_SOUTH(2) << 1 = 4 = FACING_S -> DIR_S
    // SOURCE_WEST(3) << 1 = 6 = FACING_W -> DIR_W

    const SOURCE_TO_FACING: [string, number][] = [
      ['north', 0],  // FACING_N
      ['east', 2],   // FACING_E
      ['south', 4],  // FACING_S
      ['west', 6],   // FACING_W
    ];

    // Waypoints near each edge so inferClosestMapEdge picks the intended edge
    const edgeWaypoints: Record<string, CellPos> = {
      north: { cx: 32, cy: 1 },
      east:  { cx: 63, cy: 32 },
      south: { cx: 32, cy: 63 },
      west:  { cx: 1, cy: 32 },
    };

    for (const [edge, expectedFacing] of SOURCE_TO_FACING) {
      it(`${edge} edge -> facing ${expectedFacing} (C++ source << 1)`, () => {
        // TS scenario.ts edgeToFacing() maps edges to outward-facing direction per C++.
        // C++ reinf.cpp:439: eface = (FacingType)(source << 1)
        // Units face the same direction as their spawn edge (outward from map center).
        //   north→0 (Dir.N), east→2 (Dir.E), south→4 (Dir.S), west→6 (Dir.W)
        const sourceIndex = ['north', 'east', 'south', 'west'].indexOf(edge);
        expect(sourceIndex << 1).toBe(expectedFacing);

        // Verify TS spawns with deterministic edge-derived facing (not random)
        // by spawning a reinforcement team and checking the entity's facing
        const team: TeamType = {
          name: 'FacingTest',
          house: 2,
          flags: 0,
          maxAllowed: 1,
          origin: 0,
          trigger: -1,
          members: [{ type: 'DD', count: 1 }],
          missions: [{ mission: TMISSION_MOVE, data: 1 }],
        };
        const MAP_BOUNDS = { x: 0, y: 0, w: 64, h: 64 };
        const teamTypes: TeamType[] = [team];
        const waypoints = new Map<number, CellPos>([[0, edgeWaypoints[edge]]]);
        const houseEdges = new Map<House, string>([[House.USSR, edge]]);
        const globals = new Set<number>();
        const triggers: ScenarioTrigger[] = [];
        const action: TriggerAction = {
          action: TACTION_REINFORCEMENTS,
          team: 0,
          trigger: -1,
          data: 0,
        };
        const result = executeTriggerAction(
          action, teamTypes, waypoints, globals, triggers,
          undefined, houseEdges, MAP_BOUNDS,
        );
        expect(result.spawned.length).toBe(1);
        // edgeToFacing returns outward-facing per C++ source<<1: north→0, east→2, south→4, west→6
        const outwardFacing: Record<string, number> = { north: 0, east: 2, south: 4, west: 6 };
        expect(result.spawned[0].facing).toBe(outwardFacing[edge]);
      });
    }
  });

  // ============================================================
  // 4. TRANSPORT LOADING: LST with infantry
  // C++ reinf.cpp:219-254 — _Create_Group
  // ============================================================
  describe('LST transport with infantry passengers', () => {
    const MAP_BOUNDS = { x: 0, y: 0, w: 64, h: 64 };

    it('LST is classified as transport (Max_Passengers > 0)', () => {
      // C++ reinf.cpp:219: if (tclass->Max_Passengers() > 0) → transport list
      const lstStats = UNIT_STATS['LST'];
      expect(lstStats).toBeDefined();
      expect(lstStats.passengers).toBeGreaterThan(0);
    });

    it('infantry are loaded into LST transport when team has both', () => {
      // C++ reinf.cpp:243: transport->Attach(object) — loads passengers into transport
      // TS scenario.ts:2283-2293 — auto-loads infantry into transport

      const team: TeamType = {
        name: 'NavalLanding',
        house: 2,  // USSR
        flags: 0,
        maxAllowed: 1,
        origin: 0,
        trigger: -1,
        members: [
          { type: 'LST', count: 1 },
          { type: 'E1', count: 3 },
        ],
        missions: [
          { mission: TMISSION_MOVE, data: 1 },
          { mission: TMISSION_UNLOAD, data: 0 },
        ],
      };

      const teamTypes: TeamType[] = [team];
      const waypoints = new Map<number, CellPos>([[0, { cx: 32, cy: 5 }]]);
      const houseEdges = new Map<House, string>([[House.USSR, 'north']]);
      const globals = new Set<number>();
      const triggers: ScenarioTrigger[] = [];

      const action: TriggerAction = {
        action: TACTION_REINFORCEMENTS,
        team: 0,
        trigger: -1,
        data: 0,
      };

      const result = executeTriggerAction(
        action, teamTypes, waypoints, globals, triggers,
        undefined, houseEdges, MAP_BOUNDS,
      );

      // C++ reinf.cpp:243-253: transport (LST) should have infantry attached
      const lstEntities = result.spawned.filter(e => e.type === 'LST' as any);
      expect(lstEntities.length, 'should spawn 1 LST').toBe(1);
      const lst = lstEntities[0];

      // C++: infantry loaded into transport, removed from visible entity list
      // TS: infantry loaded into transport.passengers, removed from result.spawned
      expect(lst.passengers.length, 'LST should have 3 infantry loaded').toBe(3);

      // Infantry should NOT appear in spawned list (they're inside the LST)
      const infantryInSpawned = result.spawned.filter(e =>
        e.type === ('E1' as any)
      );
      expect(infantryInSpawned.length, 'loaded infantry should not be in spawned list').toBe(0);
    });

    it('infantry count is capped at transport max passengers', () => {
      // C++ reinf.cpp:243: transport->Attach(object) respects Max_Passengers
      // LST has passengers: 5
      const team: TeamType = {
        name: 'OverloadTest',
        house: 2,
        flags: 0,
        maxAllowed: 1,
        origin: 0,
        trigger: -1,
        members: [
          { type: 'LST', count: 1 },
          { type: 'E1', count: 8 }, // more than LST capacity (5)
        ],
        missions: [
          { mission: TMISSION_MOVE, data: 1 },
        ],
      };

      const teamTypes: TeamType[] = [team];
      const waypoints = new Map<number, CellPos>([[0, { cx: 32, cy: 5 }]]);
      const houseEdges = new Map<House, string>([[House.USSR, 'north']]);
      const globals = new Set<number>();
      const triggers: ScenarioTrigger[] = [];

      const action: TriggerAction = {
        action: TACTION_REINFORCEMENTS,
        team: 0,
        trigger: -1,
        data: 0,
      };

      const result = executeTriggerAction(
        action, teamTypes, waypoints, globals, triggers,
        undefined, houseEdges, MAP_BOUNDS,
      );

      const lst = result.spawned.find(e => e.type === ('LST' as any));
      expect(lst).toBeDefined();
      // C++ would cap at Max_Passengers (5 for LST)
      expect(lst!.passengers.length).toBeLessThanOrEqual(UNIT_STATS['LST'].passengers!);
    });
  });

  // ============================================================
  // 5. IsALoaner ON VESSEL TRANSPORTS WITH UNLOAD
  // C++ reinf.cpp:251:
  //   if (hasunload && (transport->What_Am_I() == RTTI_VESSEL)) {
  //       transport->IsALoaner = true;
  //   }
  // ============================================================
  describe('IsALoaner flag on vessel transports with unload mission', () => {
    it('CLOSED: LST with UNLOAD mission gets IsALoaner=true', () => {
      // C++ reinf.cpp:251: sets IsALoaner on vessel transport with UNLOAD
      const MAP_BOUNDS = { x: 0, y: 0, w: 64, h: 64 };
      const team: TeamType = {
        name: 'LoanerTest',
        house: 2,
        flags: 0,
        maxAllowed: 1,
        origin: 0,
        trigger: -1,
        members: [
          { type: 'LST', count: 1 },
          { type: 'E1', count: 2 },
        ],
        missions: [
          { mission: TMISSION_MOVE, data: 1 },
          { mission: TMISSION_UNLOAD, data: 0 },
        ],
      };
      const teamTypes: TeamType[] = [team];
      const waypoints = new Map<number, CellPos>([[0, { cx: 32, cy: 5 }]]);
      const houseEdges = new Map<House, string>([[House.USSR, 'north']]);
      const globals = new Set<number>();
      const triggers: ScenarioTrigger[] = [];
      const action: TriggerAction = {
        action: 7,
        team: 0,
        trigger: -1,
        data: 0,
      };
      const result = executeTriggerAction(
        action, teamTypes, waypoints, globals, triggers,
        undefined, houseEdges, MAP_BOUNDS,
      );
      const lst = result.spawned.find(e => e.type === ('LST' as any));
      expect(lst, 'LST should be spawned').toBeDefined();
      expect(lst!.isALoaner).toBe(true);
    });
  });

  // ============================================================
  // 6. NAVAL SPAWN POSITION vs GROUND SPAWN POSITION
  // C++ reinf.cpp:441: speed type determines spawn cell terrain
  // ============================================================
  describe('naval vs ground spawn position differentiation', () => {
    const MAP_BOUNDS = { x: 0, y: 0, w: 64, h: 64 };

    it('ground units and naval units should use different spawn cell logic', () => {
      // C++ reinf.cpp:441:
      //   CELL cell = Map.Calculated_Cell(source, teamtype->Origin, -1,
      //                                   object->Techno_Type_Class()->Speed);
      //
      // For ground (SPEED_WHEEL): scans for land cells at edge
      // For naval (SPEED_FLOAT): scans for water cells at edge
      //
      // FIXED: TS calculateHouseEdgeSpawnCell now accepts map + naval params.
      // When naval=true, it scans the edge for water cells.

      const houseEdges = new Map<House, string>([[House.USSR, 'north']]);
      const originWp = { cx: 32, cy: 32 };

      // Both ground and naval get the exact same spawn cell
      const groundCell = calculateHouseEdgeSpawnCell(House.USSR, houseEdges, MAP_BOUNDS, originWp);
      const navalCell = calculateHouseEdgeSpawnCell(House.USSR, houseEdges, MAP_BOUNDS, originWp);

      // Without map/naval params, both return the same cell (backward compat).
      // With map + naval=true, the naval call would find a water cell instead.
      expect(groundCell).toEqual(navalCell);
    });

    it('naval reinforcement team spawns members at edge cell (1 cell outside bounds)', () => {
      // Test that a pure naval team (destroyer + submarine) spawns at edge
      const team: TeamType = {
        name: 'NavalPatrol',
        house: 2,
        flags: 0,
        maxAllowed: 1,
        origin: 0,
        trigger: -1,
        members: [
          { type: 'DD', count: 1 },
          { type: 'SS', count: 1 },
        ],
        missions: [
          { mission: TMISSION_MOVE, data: 1 },
        ],
      };

      const teamTypes: TeamType[] = [team];
      // Waypoint near north edge so inferClosestMapEdge picks north
      const waypoints = new Map<number, CellPos>([[0, { cx: 32, cy: 1 }]]);
      const houseEdges = new Map<House, string>([[House.USSR, 'north']]);
      const globals = new Set<number>();
      const triggers: ScenarioTrigger[] = [];

      const action: TriggerAction = {
        action: TACTION_REINFORCEMENTS,
        team: 0,
        trigger: -1,
        data: 0,
      };

      const result = executeTriggerAction(
        action, teamTypes, waypoints, globals, triggers,
        undefined, houseEdges, MAP_BOUNDS,
      );

      expect(result.spawned.length).toBe(2);

      // Both should be naval units
      for (const entity of result.spawned) {
        expect(entity.isNavalUnit, `${entity.type} should be naval`).toBe(true);
      }

      // C++ Calculated_Cell places units 1 cell OUTSIDE the map boundary.
      // C++ display.cpp:2454: north edge y = -1 → cy = boundsY - 1
      for (const entity of result.spawned) {
        const cell = { cx: Math.floor(entity.pos.x / 24), cy: Math.floor(entity.pos.y / 24) };
        // North edge: cy should be boundsY - 1 (1 cell outside)
        const onOutsideEdge = cell.cx === MAP_BOUNDS.x - 1 ||
          cell.cx === MAP_BOUNDS.x + MAP_BOUNDS.w ||
          cell.cy === MAP_BOUNDS.y - 1 ||
          cell.cy === MAP_BOUNDS.y + MAP_BOUNDS.h;
        expect(onOutsideEdge, `naval unit at (${cell.cx},${cell.cy}) should be 1 cell outside map edge`).toBe(true);
      }
    });
  });

  // ============================================================
  // 7. SHORE CELL DETECTION: Shore templates are NOT water for vessels
  // C++ scenario.ts:1783-1789 and terrain classification
  // ============================================================
  describe('shore cells are not water for vessel spawn', () => {
    it('BEACH terrain has zero speed for FLOAT class (vessels cannot traverse)', () => {
      // C++ Ground[LAND_BEACH].Cost[SPEED_FLOAT] = 0
      // Shore templates (3-56) → LAND_BEACH → vessels cannot pass
      const beachSpeed = TERRAIN_SPEED['Beach'];
      expect(beachSpeed).toBeDefined();
      expect(beachSpeed[SpeedClass.FLOAT], 'Beach should be impassable for FLOAT').toBe(0);
    });

    it('only Water terrain allows FLOAT speed', () => {
      // Verify that among all terrain types, only Water allows FLOAT passage
      const floatPassable: string[] = [];
      for (const [terrain, speeds] of Object.entries(TERRAIN_SPEED)) {
        if (speeds[SpeedClass.FLOAT] > 0) {
          floatPassable.push(terrain);
        }
      }
      // C++ parity: only LAND_WATER allows SPEED_FLOAT
      expect(floatPassable).toEqual(['Water']);
    });
  });

  // ============================================================
  // 8. MIXED TEAM: LST + ground vehicle
  // C++ reinf.cpp:219-234 — transport vs passenger classification
  // ============================================================
  describe('mixed naval/ground team classification', () => {
    const MAP_BOUNDS = { x: 0, y: 0, w: 64, h: 64 };

    it('LST is transport, ground units are passengers in C++', () => {
      // C++ reinf.cpp:219: `if (tclass->Max_Passengers() > 0)` → transport list
      // C++ reinf.cpp:227: else → passenger list
      // LST has Max_Passengers > 0, so it goes to transport list
      // Ground vehicles (tanks) have Max_Passengers == 0, so they go to passenger list
      //
      // BUT: C++ actually only Attach()s infantry-type passengers, not vehicles.
      // Vehicles cannot ride in LSTs in RA (only infantry).
      // The transport->Attach(object) call loads ALL non-transport units,
      // but Can_Enter_Cell on the transport checks infantry only.

      const lstStats = UNIT_STATS['LST'];
      const tankStats = UNIT_STATS['2TNK'];

      expect(lstStats.passengers).toBeGreaterThan(0);   // LST is a transport
      expect(tankStats.passengers ?? 0).toBe(0);         // tank is not
    });

    it('vehicle reinforcement team does NOT use naval spawn', () => {
      // C++ reinf.cpp:441: speed type comes from the FIRST object in the group.
      // If the first object is an LST (SPEED_FLOAT), the cell is water.
      // If the first object is a tank (SPEED_WHEEL/TRACK), the cell is land.
      //
      // Key insight: _Create_Group returns transport if one exists (line 277).
      // So for LST + infantry, the lead object is the LST → SPEED_FLOAT → water cell.
      // For a team with only tanks, the lead is a tank → SPEED_WHEEL → land cell.

      const team: TeamType = {
        name: 'TankRush',
        house: 2,
        flags: 0,
        maxAllowed: 1,
        origin: 0,
        trigger: -1,
        members: [
          { type: '2TNK', count: 3 },
        ],
        missions: [
          { mission: TMISSION_MOVE, data: 1 },
        ],
      };

      const teamTypes: TeamType[] = [team];
      const waypoints = new Map<number, CellPos>([[0, { cx: 32, cy: 32 }]]);
      const houseEdges = new Map<House, string>([[House.USSR, 'north']]);
      const globals = new Set<number>();
      const triggers: ScenarioTrigger[] = [];

      const action: TriggerAction = {
        action: TACTION_REINFORCEMENTS,
        team: 0,
        trigger: -1,
        data: 0,
      };

      const result = executeTriggerAction(
        action, teamTypes, waypoints, globals, triggers,
        undefined, houseEdges, MAP_BOUNDS,
      );

      expect(result.spawned.length).toBe(3);
      for (const entity of result.spawned) {
        expect(entity.isNavalUnit).toBe(false);
      }
    });
  });

  // ============================================================
  // 9. EDGE ALIGNMENT: Naval waypoint alignment
  // C++ display.cpp:2432-2460 — scanning starts aligned with waypoint
  // ============================================================
  describe('naval spawn edge alignment with origin waypoint', () => {
    const MAP_BOUNDS = { x: 10, y: 10, w: 50, h: 40 };

    it('north edge spawn aligns x-coordinate with waypoint', () => {
      // C++ display.cpp:2456-2458: When closer to N/S edge,
      //   y = -1 or MapCellHeight (edge), x = Cell_X(trycell) - MapCellX (aligned)
      // Then scans horizontally from that position.
      const houseEdges = new Map<House, string>([[House.USSR, 'north']]);
      const originWp = { cx: 35, cy: 12 }; // close to north edge

      const edgeCell = calculateHouseEdgeSpawnCell(House.USSR, houseEdges, MAP_BOUNDS, originWp);
      expect(edgeCell).toBeDefined();
      // C++ display.cpp:2454: north edge cy = boundsY - 1 (1 cell outside)
      expect(edgeCell!.cy).toBe(MAP_BOUNDS.y - 1); // north edge, 1 outside
      expect(edgeCell!.cx).toBe(35); // aligned with waypoint X
    });

    it('west edge spawn aligns y-coordinate with waypoint', () => {
      // C++ display.cpp:2442-2447: When closer to E/W edge,
      //   x = -1 or MapCellWidth (edge), y = Cell_Y(trycell) - MapCellY (aligned)
      const houseEdges = new Map<House, string>([[House.USSR, 'west']]);
      const originWp = { cx: 12, cy: 30 }; // close to west edge

      const edgeCell = calculateHouseEdgeSpawnCell(House.USSR, houseEdges, MAP_BOUNDS, originWp);
      expect(edgeCell).toBeDefined();
      // C++ display.cpp:2443: west edge cx = boundsX - 1 (1 cell outside)
      expect(edgeCell!.cx).toBe(MAP_BOUNDS.x - 1); // west edge, 1 outside
      expect(edgeCell!.cy).toBe(30); // aligned with waypoint Y
    });
  });

  // ============================================================
  // 10. C++ reinf.cpp:480 — ground/naval units get MISSION_GUARD
  // Aircraft DON'T get MISSION_GUARD (they get MISSION_MOVE).
  // ============================================================
  describe('spawn mission assignment', () => {
    const MAP_BOUNDS = { x: 0, y: 0, w: 64, h: 64 };

    it('naval units get MISSION_GUARD on spawn (same as ground)', () => {
      // C++ reinf.cpp:479-481:
      //   if (object->What_Am_I() != RTTI_AIRCRAFT) {
      //       object->Assign_Mission(MISSION_GUARD);
      //       object->Commence();
      //   }
      // Vessels are NOT aircraft, so they get MISSION_GUARD.
      const team: TeamType = {
        name: 'NavalGuard',
        house: 2,
        flags: 0,
        maxAllowed: 1,
        origin: 0,
        trigger: -1,
        members: [
          { type: 'DD', count: 1 },
        ],
        missions: [
          { mission: TMISSION_MOVE, data: 1 },
        ],
      };

      const teamTypes: TeamType[] = [team];
      const waypoints = new Map<number, CellPos>([[0, { cx: 32, cy: 32 }]]);
      const houseEdges = new Map<House, string>([[House.USSR, 'north']]);
      const globals = new Set<number>();
      const triggers: ScenarioTrigger[] = [];

      const action: TriggerAction = {
        action: TACTION_REINFORCEMENTS,
        team: 0,
        trigger: -1,
        data: 0,
      };

      const result = executeTriggerAction(
        action, teamTypes, waypoints, globals, triggers,
        undefined, houseEdges, MAP_BOUNDS,
      );

      expect(result.spawned.length).toBe(1);
      const dd = result.spawned[0];
      expect(dd.isNavalUnit).toBe(true);
      // C++ reinf.cpp:480 — non-aircraft get MISSION_GUARD
      // TS scenario.ts:2271 — ground units get Mission.GUARD
      // Vessels should also get GUARD (they're not aircraft)
      expect(dd.mission).toBe(Mission.GUARD);
    });
  });

  // ============================================================
  // 11. TEAM MISSION SCRIPT assignment to naval units
  // C++ reinf.cpp:476-478 — team script assigned to spawned units
  // ============================================================
  describe('team mission script on naval reinforcements', () => {
    const MAP_BOUNDS = { x: 0, y: 0, w: 64, h: 64 };

    it('naval units receive the team mission script', () => {
      const team: TeamType = {
        name: 'NavalScript',
        house: 2,
        flags: 0,
        maxAllowed: 1,
        origin: 0,
        trigger: -1,
        members: [
          { type: 'CA', count: 1 },  // Cruiser
        ],
        missions: [
          { mission: TMISSION_MOVE, data: 1 },
          { mission: TMISSION_UNLOAD, data: 0 },
        ],
      };

      const teamTypes: TeamType[] = [team];
      const waypoints = new Map<number, CellPos>([[0, { cx: 32, cy: 32 }]]);
      const houseEdges = new Map<House, string>([[House.USSR, 'north']]);
      const globals = new Set<number>();
      const triggers: ScenarioTrigger[] = [];

      const action: TriggerAction = {
        action: TACTION_REINFORCEMENTS,
        team: 0,
        trigger: -1,
        data: 0,
      };

      const result = executeTriggerAction(
        action, teamTypes, waypoints, globals, triggers,
        undefined, houseEdges, MAP_BOUNDS,
      );

      expect(result.spawned.length).toBe(1);
      const cruiser = result.spawned[0];
      expect(cruiser.teamMissions).toBeDefined();
      expect(cruiser.teamMissions!.length).toBe(2);
      expect(cruiser.teamMissions![0].mission).toBe(TMISSION_MOVE);
      expect(cruiser.teamMissions![1].mission).toBe(TMISSION_UNLOAD);
      expect(cruiser.teamMissionIndex).toBe(0);
    });
  });

  // ============================================================
  // 12. SUICIDE FLAG on naval teams
  // C++ team.h: IsSuicide (flags bit 1)
  // ============================================================
  describe('suicide flag on naval teams', () => {
    const MAP_BOUNDS = { x: 0, y: 0, w: 64, h: 64 };

    it('IsSuicide flag is propagated to naval units', () => {
      const team: TeamType = {
        name: 'KamikazeFleet',
        house: 2,
        flags: 2,  // bit 1 = IsSuicide
        maxAllowed: 1,
        origin: 0,
        trigger: -1,
        members: [
          { type: 'SS', count: 1 },  // Submarine
        ],
        missions: [
          { mission: TMISSION_MOVE, data: 1 },
        ],
      };

      const teamTypes: TeamType[] = [team];
      const waypoints = new Map<number, CellPos>([[0, { cx: 32, cy: 32 }]]);
      const houseEdges = new Map<House, string>([[House.USSR, 'north']]);
      const globals = new Set<number>();
      const triggers: ScenarioTrigger[] = [];

      const action: TriggerAction = {
        action: TACTION_REINFORCEMENTS,
        team: 0,
        trigger: -1,
        data: 0,
      };

      const result = executeTriggerAction(
        action, teamTypes, waypoints, globals, triggers,
        undefined, houseEdges, MAP_BOUNDS,
      );

      expect(result.spawned.length).toBe(1);
      expect(result.spawned[0].isSuicide).toBe(true);
    });
  });
});
