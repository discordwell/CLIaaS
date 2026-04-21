/**
 * C++ parity test: reinforcement ground unit FACING derivation
 *
 * C++ source refs (RA/reinf.cpp:DeliverObject):
 *   428-431: SourceType source = HouseClass::As_Pointer(teamtype->House)->Control.Edge;
 *           if (source == SOURCE_NONE) source = SOURCE_NORTH;
 *   439:    FacingType eface = (FacingType)(source << 1);   // Facing to enter map.
 *   441:    CELL cell = Map.Calculated_Cell(source, teamtype->Origin, -1, speed);
 *   465:    DirType desiredfacing = Facing_Dir(eface);
 *   471:    object->Unlimbo(Cell_Coord(newcell), desiredfacing);
 *
 * Key observation — C++ uses TWO DIFFERENT edges:
 *   - `source` (raw house edge, NORTH default for SOURCE_NONE) → for facing.
 *   - `Calculated_Cell(source, origin, ...)` → for spawn cell position.
 *
 * Calculated_Cell (display.cpp:2432-2460) infers the spawn edge from the origin
 * waypoint's closest map edge WHEN a waypoint is provided. The raw `source`
 * only drives the cell when `trycell == -1` (no waypoint).
 *
 * BUT facing (eface) always uses the RAW source — independent of the waypoint
 * inference that Calculated_Cell does for the cell. This allows a team to spawn
 * near one map edge (inferred from waypoint) while facing a different direction
 * (the house's explicit Edge= or the NORTH default).
 *
 * ## Bug (pre-fix):
 * TS computed spawn facing via `getSpawnEdge(house, houseEdges, bounds, waypoint)`,
 * which inferred the edge from the waypoint (matching Calculated_Cell's cell-
 * positioning logic, but applied to the facing too). This mirrored the inferred
 * edge onto the facing, diverging from C++ reinf.cpp:439.
 *
 * ## Manifestation — SCG11EA:
 * Greece house has NO Edge= in SCG11EA.ini, defaulting to NORTH per C++.
 * TeamType `mcv1` has origin=wp1 (cell 22,103), near the south edge of a 90x85
 * map (boundsY=19, boundsH=85, so last row = 103). Calculated_Cell:
 *   - relX=5, relY=84, xDist=5, yDist=1 → horz=true (south edge closer).
 *   - y = MapCellHeight (south) → spawn cell cy = boundsY + h = 104.
 *
 * The spawn cell is (22, 104). In C++, the MCV faces NORTH (house default) and
 * can immediately drive northward toward its TMISSION_MOVE target (wp26=(22,100)).
 * TS (pre-fix) faced SOUTH (waypoint-inferred edge) — MCV then spent ~25 ticks
 * rotating 180° before its first movement, diverging from WASM within 1-2 ticks.
 */

import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TeamType,
  type TriggerAction,
  type ScenarioTrigger,
} from '../engine/scenario';
import { House, Dir, type CellPos } from '../engine/types';

const TACTION_REINFORCEMENTS = 7;

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

function makeAction(teamIndex: number): TriggerAction {
  return { action: TACTION_REINFORCEMENTS, team: teamIndex, data: 0 };
}

describe('Reinforcement facing — C++ parity (reinf.cpp:428-439)', () => {
  // C++ reinf.cpp:428-439: facing is derived from the RAW house edge (with
  // SOURCE_NONE → SOURCE_NORTH fallback), INDEPENDENT of waypoint-inferred
  // edge that Calculated_Cell uses for the spawn cell position.

  it('SCG11EA MCV: Greece has no Edge= → NORTH default facing (FACING_N=0)', () => {
    // SCG11EA.ini: no Edge= for Greece (defaults to SOURCE_NORTH per C++).
    // Waypoint 1 = cell (22, 103) is near the SOUTH map edge. Calculated_Cell
    // infers 'south' for the spawn cell. But facing should remain NORTH.
    const bounds = { x: 17, y: 19, w: 90, h: 85 };
    const wp1: CellPos = { cx: 22, cy: 103 };
    const waypoints = new Map<number, CellPos>([[1, wp1], [26, { cx: 22, cy: 100 }]]);
    const houseEdges = new Map<House, string>(); // no Edge= for Greece

    const team: TeamType = {
      name: 'mcv1',
      house: 1, // Greece
      flags: 0,
      origin: 1,
      trigger: -1,
      members: [{ type: 'MCV', count: 1 }],
      missions: [{ mission: 3, data: 26 }], // TMISSION_MOVE to wp26
    };

    const result = executeTriggerAction(
      makeAction(0), [team], waypoints, new Set(), [makeTrigger()],
      0, houseEdges, bounds,
    );

    expect(result.spawned.length).toBe(1);
    const mcv = result.spawned[0];

    // C++ reinf.cpp:439 — eface = SOURCE_NORTH << 1 = 0 = FACING_N
    // TS Dir enum: N=0. Before the fix, TS used waypoint-inferred edge ('south'),
    // setting facing=4 (FACING_S) — MCV faced away from the map.
    expect(
      mcv.facing,
      `MCV should face NORTH (Dir.N=0) per C++ reinf.cpp:439 with Greece ` +
      `house defaulting to SOURCE_NORTH. Waypoint-inferred edge is 'south', ` +
      `but facing is derived from the raw house source (NORTH default).`,
    ).toBe(Dir.N);

    // Spawn cell stays waypoint-inferred ((22, 104) = south edge, boundsY+h=104).
    // This matches C++ Calculated_Cell cell-positioning.
    const spawnCy = Math.floor(mcv.pos.y / 24);
    expect(
      spawnCy,
      `Spawn cell cy should be 104 (boundsY + h = south-edge outside cell), ` +
      `matching C++ Calculated_Cell with waypoint-inferred south edge.`,
    ).toBe(104);
  });

  it('Greece Edge=East with south-inferred waypoint: facing EAST, not SOUTH', () => {
    // Team house has an explicit Edge= — use it for facing. The waypoint may
    // infer a different edge (used only for cell position).
    const bounds = { x: 10, y: 20, w: 40, h: 30 };
    const wpSouth: CellPos = { cx: 30, cy: 49 }; // near south edge (y=49, boundsY+h=50)
    const waypoints = new Map<number, CellPos>([[7, wpSouth]]);
    const houseEdges = new Map<House, string>([[House.Greece, 'East']]);

    const team: TeamType = {
      name: 't', house: 1, flags: 0, origin: 7, trigger: -1,
      members: [{ type: 'JEEP', count: 1 }], missions: [],
    };

    const result = executeTriggerAction(
      makeAction(0), [team], waypoints, new Set(), [makeTrigger()],
      0, houseEdges, bounds,
    );

    expect(result.spawned.length).toBe(1);
    // C++ reinf.cpp:439 — eface = SOURCE_EAST << 1 = 2 = FACING_E. Dir.E=2.
    expect(
      result.spawned[0].facing,
      `JEEP should face EAST (Dir.E=2) per explicit Greece Edge=East, ` +
      `regardless of south-inferred waypoint edge.`,
    ).toBe(Dir.E);
  });

  it('House with explicit Edge=West and any waypoint: facing WEST', () => {
    const bounds = { x: 10, y: 20, w: 40, h: 30 };
    const wpNorth: CellPos = { cx: 30, cy: 21 }; // near north edge
    const waypoints = new Map<number, CellPos>([[0, wpNorth]]);
    const houseEdges = new Map<House, string>([[House.USSR, 'West']]);

    const team: TeamType = {
      name: 't', house: 2, flags: 0, origin: 0, trigger: -1,
      members: [{ type: 'JEEP', count: 1 }], missions: [],
    };

    const result = executeTriggerAction(
      makeAction(0), [team], waypoints, new Set(), [makeTrigger()],
      0, houseEdges, bounds,
    );

    expect(result.spawned.length).toBe(1);
    // C++ SOURCE_WEST=3, eface = 3<<1 = 6 = FACING_W. Dir.W=6.
    expect(result.spawned[0].facing).toBe(Dir.W);
  });
});
