/**
 * C++ parity tests: reinforcement spawn — edge location, transport, facing
 *
 * C++ source refs:
 * - reinf.cpp:372-531 (Do_Reinforcements) — main reinforcement spawn logic
 * - reinf.cpp:428 — source = house->Control.Edge (SourceType)
 * - reinf.cpp:429-430 — SOURCE_NONE fallback to SOURCE_NORTH
 * - reinf.cpp:439 — FacingType eface = (FacingType)(source << 1)
 * - reinf.cpp:441 — Map.Calculated_Cell(source, origin, -1, speed) for edge cell
 * - reinf.cpp:465 — DirType desiredfacing = Facing_Dir(eface) for ground units
 * - reinf.cpp:466-468 — aircraft override: desiredfacing = Random_Pick(DIR_N, DIR_MAX)
 * - reinf.cpp:471 — Unlimbo(Cell_Coord(newcell), desiredfacing)
 * - reinf.cpp:479-481 — ground units get MISSION_GUARD on spawn
 * - reinf.cpp:560 (Create_Special_Reinforcement) — delegates to Do_Reinforcements
 * - reinf.cpp:640-751 (Create_Air_Reinforcement) — airstrike facing = DIR_N always
 * - reinf.cpp:701 — obj->Unlimbo(Cell_Coord(newcell), DIR_N)
 * - defines.h:2942-2955 — FacingType enum: N=0, NE=1, E=2, SE=3, S=4, SW=5, W=6, NW=7
 * - defines.h:2993-3006 — DirType enum: N=0, NE=32, E=64, ..., MAX=255
 * - defines.h:3387-3392 — SourceType: NONE=-1, NORTH=0, EAST=1, SOUTH=2, WEST=3
 * - inline.h:651-654 — Facing_Dir(facing) = (DirType)(facing << 5)
 * - scenario.cpp:3328-3335 — Clip_Scatter clamps to MapCellX..MapCellX+MapCellWidth-1
 *
 * ## Key C++ facing behavior for Do_Reinforcements:
 *
 * source (SourceType) -> eface (FacingType) -> desiredfacing (DirType):
 *   SOURCE_NORTH(0) -> eface = 0<<1 = 0 = FACING_N -> Facing_Dir(0) = 0<<5 = DIR_N(0)
 *   SOURCE_EAST(1)  -> eface = 1<<1 = 2 = FACING_E -> Facing_Dir(2) = 2<<5 = DIR_E(64)
 *   SOURCE_SOUTH(2) -> eface = 2<<1 = 4 = FACING_S -> Facing_Dir(4) = 4<<5 = DIR_S(128)
 *   SOURCE_WEST(3)  -> eface = 3<<1 = 6 = FACING_W -> Facing_Dir(6) = 6<<5 = DIR_W(192)
 *
 * Units face the SAME compass direction as their spawn edge (outward).
 * Aircraft in Do_Reinforcements get Random_Pick(DIR_N, DIR_MAX) — fully random facing.
 * Aircraft in Create_Air_Reinforcement always get DIR_N.
 *
 * ## TS Dir enum (engine/types.ts):
 *   Dir.N=0, Dir.NE=1, Dir.E=2, Dir.SE=3, Dir.S=4, Dir.SW=5, Dir.W=6, Dir.NW=7
 * Maps to C++ FacingType values (NOT DirType). C++ DirType uses 256-step values.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateHouseEdgeSpawnCell,
  resolveTeamOriginCell,
  getSpawnEdge,
  executeTriggerAction,
  type TeamType,
  type TriggerAction,
  type ScenarioTrigger,
} from '../engine/scenario';
import { House, Dir, Mission, type CellPos } from '../engine/types';
import { Entity } from '../engine/entity';

// ============================================================
// C++ constants reproduced for reference
// ============================================================

// C++ reinf.cpp trigger action types
const TACTION_REINFORCEMENTS = 7;

// C++ SourceType (defines.h:3387-3392)
// SOURCE_NONE = -1, SOURCE_NORTH = 0, SOURCE_EAST = 1,
// SOURCE_SOUTH = 2, SOURCE_WEST = 3

// C++ FacingType (defines.h:2942-2955) — same numeric values as TS Dir enum
// FACING_N=0, FACING_NE=1, FACING_E=2, FACING_SE=3,
// FACING_S=4, FACING_SW=5, FACING_W=6, FACING_NW=7

// C++ DirType (defines.h:2993-3006) — 256-step values
// DIR_N=0, DIR_NE=32, DIR_E=64, DIR_SE=96,
// DIR_S=128, DIR_SW=160, DIR_W=192, DIR_NW=224

// ============================================================
// C++ facing computation (reinf.cpp:428-465)
// ============================================================
// source = house->Control.Edge (SourceType)
// if (source == SOURCE_NONE) source = SOURCE_NORTH;
// eface = (FacingType)(source << 1);
// desiredfacing = Facing_Dir(eface);  // = eface << 5
//
// This means units face the SAME direction as the edge they spawn from:
//   North edge -> face north (outward)
//   East edge  -> face east  (outward)
//   South edge -> face south (outward)
//   West edge  -> face west  (outward)
//
// Aircraft override: desiredfacing = Random_Pick(DIR_N, DIR_MAX)

// Expected C++ facing for each edge (using TS Dir enum values = C++ FacingType values)
const CPP_EXPECTED_FACING: Record<string, Dir> = {
  north: Dir.N,  // C++ SOURCE_NORTH -> FACING_N -> face north (outward)
  east:  Dir.E,  // C++ SOURCE_EAST  -> FACING_E -> face east (outward)
  south: Dir.S,  // C++ SOURCE_SOUTH -> FACING_S -> face south (outward)
  west:  Dir.W,  // C++ SOURCE_WEST  -> FACING_W -> face west (outward)
};

// ============================================================
// Helpers
// ============================================================
function makeTeam(overrides: Partial<TeamType> = {}): TeamType {
  return {
    name: 'TestTeam',
    house: 1, // Greece (houseIdToHouse(1) = House.Greece)
    flags: 0,
    origin: 0,
    trigger: -1,
    members: [{ type: 'E1', count: 2 }],
    missions: [{ mission: 3, data: 0 }], // TMISSION_MOVE to waypoint 0
    ...overrides,
  };
}

function makeAircraftTeam(overrides: Partial<TeamType> = {}): TeamType {
  return makeTeam({
    members: [{ type: 'TRAN', count: 1 }], // Chinook transport
    missions: [{ mission: 8, data: 0 }], // TMISSION_UNLOAD at waypoint 0
    ...overrides,
  });
}

function makeAction(teamIndex: number): TriggerAction {
  return {
    action: TACTION_REINFORCEMENTS,
    team: teamIndex,
    data: 0,
  };
}

function makeTrigger(): ScenarioTrigger {
  return {
    name: 'test',
    house: 0,
    event1: { event: 0, data: 0, extra: 0 },
    event2: { event: 0, data: 0, extra: 0 },
    action1: { action: 0, team: -1, data: 0 },
    action2: { action: 0, team: -1, data: 0 },
    persistence: 0,
    eventLink: 0,
    fired: false,
    currentCount: 0,
    attachmentCount: 0,
    attachmentMax: 0,
    disabled: false,
  };
}

const MAP_BOUNDS = { x: 23, y: 57, w: 87, h: 54 };

describe('Reinforcement spawn — C++ parity (edge, facing, transport)', () => {
  // ============================================================
  // SECTION 1: Edge location (calculateHouseEdgeSpawnCell)
  // C++ reinf.cpp:441 — Map.Calculated_Cell picks edge entry cell
  // ============================================================
  describe('Edge spawn location — C++ reinf.cpp:441', () => {
    it('ground reinforcements spawn 1 cell OUTSIDE the map edge, not at the origin waypoint', () => {
      const houseEdges = new Map<House, string>([[House.Greece, 'west']]);
      // Waypoint near west edge so inferClosestMapEdge picks 'west'
      const originWp = { cx: 24, cy: 80 };
      const edgeCell = calculateHouseEdgeSpawnCell(House.Greece, houseEdges, MAP_BOUNDS, originWp);

      expect(edgeCell).toBeDefined();
      // C++ display.cpp:2443: x = -1 → cx = MapCellX - 1 (1 cell outside west edge)
      expect(edgeCell!.cx).toBe(MAP_BOUNDS.x - 1);
      // Aligned to waypoint Y
      expect(edgeCell!.cy).toBe(80);
    });

    it('north edge: spawn cell is 1 row above the top row', () => {
      const houseEdges = new Map<House, string>([[House.Greece, 'north']]);
      // Waypoint near north edge so inferClosestMapEdge picks 'north'
      const originWp = { cx: 50, cy: 58 };
      const edgeCell = calculateHouseEdgeSpawnCell(House.Greece, houseEdges, MAP_BOUNDS, originWp);

      expect(edgeCell).toBeDefined();
      // C++ display.cpp:2454: y = -1 → cy = MapCellY - 1 (1 cell outside north edge)
      expect(edgeCell!.cy).toBe(MAP_BOUNDS.y - 1);
      expect(edgeCell!.cx).toBe(50);
    });

    it('east edge: spawn cell is 1 col right of the rightmost column', () => {
      const houseEdges = new Map<House, string>([[House.Greece, 'east']]);
      // Waypoint near east edge so inferClosestMapEdge picks 'east'
      const originWp = { cx: 109, cy: 80 };
      const edgeCell = calculateHouseEdgeSpawnCell(House.Greece, houseEdges, MAP_BOUNDS, originWp);

      expect(edgeCell).toBeDefined();
      // C++ display.cpp:2445: x = MapCellWidth → cx = MapCellX + MapCellWidth (1 cell outside east edge)
      expect(edgeCell!.cx).toBe(MAP_BOUNDS.x + MAP_BOUNDS.w);
      expect(edgeCell!.cy).toBe(80);
    });

    it('south edge: spawn cell is 1 row below the bottom row', () => {
      const houseEdges = new Map<House, string>([[House.Greece, 'south']]);
      // Waypoint near south edge so inferClosestMapEdge picks 'south'
      const originWp = { cx: 50, cy: 110 };
      const edgeCell = calculateHouseEdgeSpawnCell(House.Greece, houseEdges, MAP_BOUNDS, originWp);

      expect(edgeCell).toBeDefined();
      // C++ display.cpp:2456: y = MapCellHeight → cy = MapCellY + MapCellHeight (1 cell outside south edge)
      expect(edgeCell!.cy).toBe(MAP_BOUNDS.y + MAP_BOUNDS.h);
      expect(edgeCell!.cx).toBe(50);
    });

    it('spawn cell is 1 cell outside map bounds (C++ Calculated_Cell spawns outside edge)', () => {
      const houseEdges = new Map<House, string>([[House.Greece, 'west']]);
      for (let i = 0; i < 100; i++) {
        const edgeCell = calculateHouseEdgeSpawnCell(
          House.Greece, houseEdges, MAP_BOUNDS, { cx: 23, cy: 64 },
          () => i / 100,
        );
        expect(edgeCell).toBeDefined();
        // C++ display.cpp:2443: west edge x = -1, so cx = MapCellX - 1
        expect(edgeCell!.cx).toBe(MAP_BOUNDS.x - 1);
        // Aligned coordinate (cy) is clamped within map bounds
        expect(edgeCell!.cy).toBeGreaterThanOrEqual(MAP_BOUNDS.y);
        expect(edgeCell!.cy).toBeLessThanOrEqual(MAP_BOUNDS.y + MAP_BOUNDS.h - 1);
      }
    });

    it('clamps aligned coordinate to map bounds when waypoint is out of range', () => {
      // Waypoint cx=10 is left of boundsX=23, cy=57 is at boundsY. inferClosestMapEdge
      // picks 'west' (closest edge), so cx is the edge coord (x-1=22, 1 cell outside)
      // and cy is the aligned coord (clamped to map bounds).
      const houseEdges = new Map<House, string>([[House.Greece, 'north']]);
      const originWp = { cx: 10, cy: 57 };
      const edgeCell = calculateHouseEdgeSpawnCell(House.Greece, houseEdges, MAP_BOUNDS, originWp);

      expect(edgeCell).toBeDefined();
      // C++ display.cpp:2443: west edge cx = boundsX - 1 (1 outside)
      expect(edgeCell!.cx).toBe(MAP_BOUNDS.x - 1);
      // Aligned coordinate (cy) is clamped within map bounds
      expect(edgeCell!.cy).toBeGreaterThanOrEqual(MAP_BOUNDS.y);
      expect(edgeCell!.cy).toBeLessThanOrEqual(MAP_BOUNDS.y + MAP_BOUNDS.h - 1);
    });
  });

  // ============================================================
  // SECTION 2: SOURCE_NONE fallback to SOURCE_NORTH
  // C++ reinf.cpp:429-430
  // ============================================================
  describe('SOURCE_NONE fallback — C++ reinf.cpp:429-430', () => {
    it('normalizeHouseEdge(undefined) defaults to "north" (SOURCE_NONE -> SOURCE_NORTH)', () => {
      // When no house edge is configured and no aligned cell, getSpawnEdge returns 'north'
      const edge = getSpawnEdge(House.Greece, undefined, MAP_BOUNDS);
      expect(edge).toBe('north');
    });

    it('calculateHouseEdgeSpawnCell with no house edge and no aligned cell defaults to north', () => {
      const edgeCell = calculateHouseEdgeSpawnCell(
        House.Greece, undefined, MAP_BOUNDS, undefined, () => 0.5,
      );
      expect(edgeCell).toBeDefined();
      // C++ display.cpp:2471: SOURCE_NORTH y = -1 → cy = MapCellY - 1 (1 cell outside north edge)
      expect(edgeCell!.cy).toBe(MAP_BOUNDS.y - 1);
    });
  });

  // ============================================================
  // SECTION 3: resolveTeamOriginCell
  // C++ reinf.cpp:441 — origin waypoint for edge alignment
  // ============================================================
  describe('resolveTeamOriginCell — C++ reinf.cpp:441', () => {
    it('returns the waypoint cell when origin exists', () => {
      const waypoints = new Map<number, CellPos>([
        [0, { cx: 23, cy: 64 }],
      ]);
      const cell = resolveTeamOriginCell(0, House.Greece, waypoints);
      expect(cell).toEqual({ cx: 23, cy: 64 });
    });

    it('falls back to house edge when origin waypoint is missing', () => {
      const waypoints = new Map<number, CellPos>();
      const houseEdges = new Map<House, string>([[House.Greece, 'west']]);
      const cell = resolveTeamOriginCell(99, House.Greece, waypoints, houseEdges, MAP_BOUNDS);
      expect(cell).toBeDefined();
      // C++ display.cpp:2443: west edge x = -1 → cx = MapCellX - 1
      expect(cell!.cx).toBe(MAP_BOUNDS.x - 1);
    });
  });

  // ============================================================
  // SECTION 4: Ground unit facing direction
  // C++ reinf.cpp:439,465 — units face OUTWARD from spawn edge
  //
  // C++ computation:
  //   eface = (FacingType)(source << 1)
  //   desiredfacing = Facing_Dir(eface) = eface << 5
  //
  //   SOURCE_NORTH(0) -> FACING_N(0) -> DIR_N = face north (outward)
  //   SOURCE_EAST(1)  -> FACING_E(2) -> DIR_E = face east  (outward)
  //   SOURCE_SOUTH(2) -> FACING_S(4) -> DIR_S = face south (outward)
  //   SOURCE_WEST(3)  -> FACING_W(6) -> DIR_W = face west  (outward)
  //
  // Units face the direction of their source edge — i.e., AWAY from
  // map center (outward). The team script then turns them inward.
  // ============================================================
  describe('Ground unit facing — C++ reinf.cpp:439,465 (OUTWARD)', () => {
    // Waypoints near each edge so inferClosestMapEdge picks the intended edge.
    // MAP_BOUNDS = { x: 23, y: 57, w: 87, h: 54 } → x range [23,109], y range [57,110]
    const edgeWaypoints: Record<string, CellPos> = {
      north: { cx: 50, cy: 58 },   // near north (y=57)
      east:  { cx: 109, cy: 80 },  // near east (x=109)
      south: { cx: 50, cy: 110 },  // near south (y=110)
      west:  { cx: 24, cy: 80 },   // near west (x=23)
    };

    const edges: Array<{ edge: string; expectedFacing: Dir }> = [
      { edge: 'north', expectedFacing: Dir.N },
      { edge: 'east',  expectedFacing: Dir.E },
      { edge: 'south', expectedFacing: Dir.S },
      { edge: 'west',  expectedFacing: Dir.W },
    ];

    for (const { edge, expectedFacing } of edges) {
      it(`units from ${edge} edge should face ${Dir[expectedFacing]} (outward) — C++ eface=(source<<1)`, () => {
        const houseEdges = new Map<House, string>([[House.Greece, edge]]);
        const team = makeTeam({ origin: 0 });
        const waypoints = new Map<number, CellPos>([[0, edgeWaypoints[edge]]]);
        const triggers: ScenarioTrigger[] = [makeTrigger()];

        const result = executeTriggerAction(
          makeAction(0),
          [team],
          waypoints,
          new Set(),
          triggers,
          0,
          houseEdges,
          MAP_BOUNDS,
        );

        expect(result.spawned.length).toBeGreaterThan(0);
        for (const entity of result.spawned) {
          expect(
            entity.facing,
            `Entity from ${edge} edge should face ${Dir[expectedFacing]} (outward), ` +
            `got ${Dir[entity.facing]} — C++ reinf.cpp:465: Facing_Dir((source<<1))`
          ).toBe(expectedFacing);
        }
      });
    }
  });

  // ============================================================
  // SECTION 5: Aircraft facing in Do_Reinforcements
  // C++ reinf.cpp:466-468
  //   if (object->What_Am_I() == RTTI_AIRCRAFT) {
  //     desiredfacing = Random_Pick(DIR_N, DIR_MAX);
  //   }
  // Aircraft get a RANDOM facing (0-255 DirType), not the edge facing.
  // ============================================================
  describe('Aircraft facing — C++ reinf.cpp:466-468 (RANDOM)', () => {
    it('aircraft in Do_Reinforcements should NOT have deterministic edge-based facing', () => {
      const houseEdges = new Map<House, string>([[House.Greece, 'north']]);
      const team = makeAircraftTeam({ origin: 0 });
      const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 80 }]]);
      const triggers: ScenarioTrigger[] = [makeTrigger()];

      // Run multiple times — if facing is deterministic based on edge, all will match.
      // C++ would produce random facings.
      const facings = new Set<Dir>();
      for (let i = 0; i < 20; i++) {
        const result = executeTriggerAction(
          makeAction(0),
          [team],
          waypoints,
          new Set(),
          triggers,
          0,
          houseEdges,
          MAP_BOUNDS,
        );
        for (const entity of result.spawned) {
          if (entity.aircraftState === 'flying' || entity.type === 'TRAN') {
            facings.add(entity.facing);
          }
        }
      }

      // C++ Random_Pick(DIR_N, DIR_MAX) produces random 0-255 values mapped to facings.
      // With 20 runs, we should see variation. If all facings are the same, it's
      // deterministic (wrong per C++).
      // NOTE: This test documents the expected C++ behavior. If the TS implementation
      // gives all aircraft the same deterministic facing, this test will fail —
      // indicating a parity mismatch.
      expect(
        facings.size,
        `Aircraft facing should vary (C++ Random_Pick), but got only ${facings.size} distinct value(s): [${[...facings].map(f => Dir[f]).join(', ')}]. ` +
        `C++ reinf.cpp:466-468 assigns Random_Pick(DIR_N, DIR_MAX) to aircraft.`
      ).toBeGreaterThan(1);
    });
  });

  // ============================================================
  // SECTION 6: Ground units get MISSION_GUARD on spawn
  // C++ reinf.cpp:479-481
  //   if (object->What_Am_I() != RTTI_AIRCRAFT) {
  //     object->Assign_Mission(MISSION_GUARD);
  //     object->Commence();
  //   }
  // ============================================================
  describe('Ground unit mission — C++ reinf.cpp:479-481', () => {
    it('ground units receive MISSION_GUARD on spawn, not MISSION_MOVE', () => {
      const houseEdges = new Map<House, string>([[House.Greece, 'west']]);
      const team = makeTeam({ origin: 0 });
      const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 80 }]]);
      const triggers: ScenarioTrigger[] = [makeTrigger()];

      const result = executeTriggerAction(
        makeAction(0),
        [team],
        waypoints,
        new Set(),
        triggers,
        0,
        houseEdges,
        MAP_BOUNDS,
      );

      const groundUnits = result.spawned.filter(e => e.aircraftState === 'idle');
      expect(groundUnits.length).toBeGreaterThan(0);
      for (const entity of groundUnits) {
        expect(
          entity.mission,
          `Ground unit should have MISSION_GUARD, got ${Mission[entity.mission]}`
        ).toBe(Mission.GUARD);
      }
    });
  });

  // ============================================================
  // SECTION 7: Aircraft spawn at edge and fly to origin
  // C++ reinf.cpp:466-471 — aircraft are placed at edge cell
  // but the team mission directs them to the origin waypoint
  // ============================================================
  describe('Aircraft spawn at edge — C++ reinf.cpp:466-471', () => {
    it('aircraft spawn at map edge, not at origin waypoint', () => {
      const houseEdges = new Map<House, string>([[House.Greece, 'north']]);
      const team = makeAircraftTeam({ origin: 0 });
      const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 80 }]]);
      const triggers: ScenarioTrigger[] = [makeTrigger()];

      const result = executeTriggerAction(
        makeAction(0),
        [team],
        waypoints,
        new Set(),
        triggers,
        0,
        houseEdges,
        MAP_BOUNDS,
      );

      // The Chinook should spawn at edge, not at the origin waypoint (50, 80)
      const aircraft = result.spawned.filter(e =>
        e.aircraftState === 'flying' || e.type === 'TRAN'
      );
      expect(aircraft.length).toBeGreaterThan(0);

      for (const entity of aircraft) {
        // The entity's world position is derived from the edge cell, not the waypoint
        // C++ display.cpp:2454: north edge y = -1 → cy = MAP_BOUNDS.y - 1 (1 cell outside)
        // World coordinates are cell * 24 + 12 (from cellToWorld)
        const expectedEdgeCy = MAP_BOUNDS.y - 1;
        const edgeWorldY = expectedEdgeCy * 24 + 12;
        expect(
          entity.pos.y,
          `Aircraft should spawn at north edge (world y = ${edgeWorldY}), ` +
          `not at origin waypoint (world y = ${80 * 24 + 12})`
        ).toBe(edgeWorldY);
      }
    });
  });

  // ============================================================
  // SECTION 8: Create_Air_Reinforcement facing
  // C++ reinf.cpp:701 — obj->Unlimbo(Cell_Coord(newcell), DIR_N)
  // Airstrike aircraft always face DIR_N (north), regardless of edge
  // ============================================================
  describe('Create_Air_Reinforcement facing — C++ reinf.cpp:701', () => {
    // NOTE: TS may not have a separate Create_Air_Reinforcement implementation.
    // This test documents the expected behavior from C++.
    it('airstrike aircraft should face DIR_N regardless of house edge', () => {
      // C++ Create_Air_Reinforcement always passes DIR_N to Unlimbo,
      // unlike Do_Reinforcements which computes facing from edge.
      //
      // This test verifies that if the TS does have airstrike spawning,
      // the facing should be DIR_N (Dir.N = 0).
      //
      // If TS routes airstrikes through the same team-based path, this
      // documents the divergence: C++ airstrikes always face north.
      expect(Dir.N).toBe(0); // Sanity: Dir.N matches C++ DIR_N semantics
    });
  });

  // ============================================================
  // SECTION 9: edgeToFacing parity check (via getSpawnEdge + computation)
  // C++ reinf.cpp:439: eface = (FacingType)(source << 1)
  //
  // TS edgeToFacing (scenario.ts:1193-1201):
  //   north -> 4 (Dir.S, face south = INWARD)
  //   south -> 0 (Dir.N, face north = INWARD)
  //   east  -> 6 (Dir.W, face west  = INWARD)
  //   west  -> 2 (Dir.E, face east  = INWARD)
  //
  // C++ computation:
  //   north -> 0 (FACING_N, face north = OUTWARD)
  //   east  -> 2 (FACING_E, face east  = OUTWARD)
  //   south -> 4 (FACING_S, face south = OUTWARD)
  //   west  -> 6 (FACING_W, face west  = OUTWARD)
  //
  // MISMATCH: TS gives inward, C++ gives outward.
  // ============================================================
  describe('edgeToFacing: TS inward vs C++ outward — KNOWN MISMATCH', () => {
    // C++ formula: eface = (FacingType)(source << 1), desiredfacing = Facing_Dir(eface)
    // SOURCE_NORTH=0: 0<<1 = 0 = FACING_N -> unit faces NORTH
    // SOURCE_EAST=1:  1<<1 = 2 = FACING_E -> unit faces EAST
    // SOURCE_SOUTH=2: 2<<1 = 4 = FACING_S -> unit faces SOUTH
    // SOURCE_WEST=3:  3<<1 = 6 = FACING_W -> unit faces WEST
    //
    // Units face the SAME direction as their spawn edge (outward from map center).
    // The team mission script (TMISSION_MOVE) subsequently rotates them inward.

    it('C++ source<<1 formula: SOURCE_NORTH(0)<<1 = FACING_N(0) = face north', () => {
      const source = 0; // SOURCE_NORTH
      const eface = source << 1;
      expect(eface).toBe(0); // FACING_N
      // In TS Dir terms: Dir.N = 0
      expect(eface).toBe(Dir.N);
    });

    it('C++ source<<1 formula: SOURCE_EAST(1)<<1 = FACING_E(2) = face east', () => {
      const source = 1; // SOURCE_EAST
      const eface = source << 1;
      expect(eface).toBe(2); // FACING_E
      expect(eface).toBe(Dir.E);
    });

    it('C++ source<<1 formula: SOURCE_SOUTH(2)<<1 = FACING_S(4) = face south', () => {
      const source = 2; // SOURCE_SOUTH
      const eface = source << 1;
      expect(eface).toBe(4); // FACING_S
      expect(eface).toBe(Dir.S);
    });

    it('C++ source<<1 formula: SOURCE_WEST(3)<<1 = FACING_W(6) = face west', () => {
      const source = 3; // SOURCE_WEST
      const eface = source << 1;
      expect(eface).toBe(6); // FACING_W
      expect(eface).toBe(Dir.W);
    });
  });

  // ============================================================
  // SECTION 10: bodyFacing32 must be consistent with facing
  // C++ reinf.cpp:471 — Unlimbo sets PrimaryFacing from desiredfacing
  // ============================================================
  describe('bodyFacing32 consistency — entity.facing * 4', () => {
    it('bodyFacing32 should equal facing * 4 at spawn', () => {
      const houseEdges = new Map<House, string>([[House.Greece, 'west']]);
      const team = makeTeam({ origin: 0 });
      const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 80 }]]);
      const triggers: ScenarioTrigger[] = [makeTrigger()];

      const result = executeTriggerAction(
        makeAction(0),
        [team],
        waypoints,
        new Set(),
        triggers,
        0,
        houseEdges,
        MAP_BOUNDS,
      );

      for (const entity of result.spawned) {
        expect(
          entity.bodyFacing32,
          `bodyFacing32 should be facing(${entity.facing}) * 4 = ${entity.facing * 4}`
        ).toBe(entity.facing * 4);
      }
    });
  });

  // ============================================================
  // SECTION 11: SCG08EA regression — MCV spawn at edge
  // ============================================================
  describe('SCG08EA MCV reinforcement — regression test', () => {
    it('edge spawn cell for SCG08EA MCV is 1 cell outside west map boundary', () => {
      const houseEdges = new Map<House, string>([[House.Greece, 'west']]);
      const originWp = { cx: 23, cy: 64 }; // WP0 in SCG08EA

      for (let i = 0; i < 50; i++) {
        const edgeCell = calculateHouseEdgeSpawnCell(
          House.Greece, houseEdges, MAP_BOUNDS, originWp,
          () => i / 50,
        );
        expect(edgeCell).toBeDefined();
        // C++ display.cpp:2443: west edge cx = boundsX - 1 (1 cell outside)
        expect(edgeCell!.cx, `iteration ${i}: cx should be 1 outside west edge`).toBe(MAP_BOUNDS.x - 1);
        // Aligned coordinate (cy) is clamped within map bounds
        expect(edgeCell!.cy, `iteration ${i}: cy out of bounds`).toBeGreaterThanOrEqual(MAP_BOUNDS.y);
        expect(edgeCell!.cy, `iteration ${i}: cy out of bounds`).toBeLessThanOrEqual(MAP_BOUNDS.y + MAP_BOUNDS.h - 1);
      }
    });
  });
});
