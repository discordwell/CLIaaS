/**
 * C++ parity test: reinforcement ground unit spawn position offset
 *
 * C++ source refs:
 * - display.cpp:2432-2460 (Calculated_Cell) — infers spawn edge from waypoint proximity
 * - display.cpp:2449-2459 — north/south (horz) edge: y = -1 or y = MapCellHeight
 * - display.cpp:2440-2447 — east/west (vert) edge: x = -1 or x = MapCellWidth
 * - display.cpp:2498 — punt cell: XY_Cell(x + MapCellX, y + MapCellY)
 * - display.cpp:2517-2527 — horizontal edge scan: trycell = XY_Cell(aligned_x, y + MapCellY)
 * - display.cpp:2505-2515 — vertical edge scan: trycell = XY_Cell(x + MapCellX, aligned_y)
 * - display.cpp:2537-2586 — Good_Reinforcement_Cell: outcell is OUTSIDE map, incell is INSIDE
 * - reinf.cpp:441 — Map.Calculated_Cell(source, origin, -1, speed)
 * - reinf.cpp:459 — newcell = cell; first unit spawns at Calculated_Cell result
 * - reinf.cpp:490-498 — Adjacent_Cell overflow for occupied cells
 *
 * ## Bug:
 * In SCG01EA, team rnf1 spawns 3 JEEPs at waypoint 11 (cell 5823 = cx=63, cy=45).
 * Map bounds: x=49, y=45, w=30, h=36. Waypoint is at the north edge.
 *
 * C++ Calculated_Cell for north edge sets y = -1 (display.cpp:2454), then computes
 * the spawn cell as XY_Cell(alignedX + MapCellX, y + MapCellY) = XY_Cell(63, 44).
 * The spawn cell is 1 cell ABOVE the map boundary (cy=44 vs boundary cy=45).
 *
 * TS calculateHouseEdgeSpawnCell was returning cy = boundsY (the map boundary itself),
 * placing units 1 cell too far south compared to C++.
 *
 * WASM JEEPs at tick 50: (62,50), (63,50), (64,50)
 * TS JEEPs at tick 50 (before fix): (62,51), (63,51), (64,50)
 * The 1-cell south offset persists unchanged from spawn through tick 1500.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateHouseEdgeSpawnCell,
  executeTriggerAction,
  type TeamType,
  type TriggerAction,
  type ScenarioTrigger,
} from '../engine/scenario';
import { House, type CellPos } from '../engine/types';

// C++ reinf.cpp trigger action type
const TACTION_REINFORCEMENTS = 7;

// SCG01EA map bounds
const SCG01EA_BOUNDS = { x: 49, y: 45, w: 30, h: 36 };

// Waypoint 11 = cell 5823 = (63, 45) — at the north edge of the map
const WP11: CellPos = { cx: 63, cy: 45 };

function makeTeam(overrides: Partial<TeamType> = {}): TeamType {
  return {
    name: 'rnf1',
    house: 1, // Greece
    flags: 0,
    origin: 11,
    trigger: -1,
    members: [{ type: 'JEEP', count: 2 }],
    missions: [{ mission: 3, data: 11 }, { mission: 3, data: 10 }],
    ...overrides,
  };
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

describe('Reinforcement spawn position — C++ parity (1-cell edge offset)', () => {
  // ============================================================
  // SECTION 1: C++ Calculated_Cell spawns 1 cell OUTSIDE map bounds
  // display.cpp:2449-2459: north edge y = -1, south edge y = MapCellHeight
  // display.cpp:2440-2447: west edge x = -1, east edge x = MapCellWidth
  // display.cpp:2498: punt = XY_Cell(x + MapCellX, y + MapCellY)
  // ============================================================

  describe('North edge: spawn cell is 1 row above map boundary — C++ display.cpp:2454', () => {
    it('SCG01EA WP11 (63,45) with boundsY=45: spawn cy should be 44 (boundsY - 1)', () => {
      // C++ Calculated_Cell: y = -1, trycell = XY_Cell(63, -1 + 45) = (63, 44)
      const edgeCell = calculateHouseEdgeSpawnCell(
        House.Greece,
        new Map([[House.Greece, 'north']]),
        SCG01EA_BOUNDS,
        WP11,
      );

      expect(edgeCell).toBeDefined();
      // C++ spawns 1 cell ABOVE the map boundary
      expect(
        edgeCell!.cy,
        `North edge spawn cy should be ${SCG01EA_BOUNDS.y - 1} (boundsY - 1), ` +
        `not ${SCG01EA_BOUNDS.y} (boundsY). C++ display.cpp:2454 sets y = -1.`
      ).toBe(SCG01EA_BOUNDS.y - 1);
      // X should be aligned to waypoint
      expect(edgeCell!.cx).toBe(63);
    });

    it('generic north edge: cy = boundsY - 1', () => {
      const bounds = { x: 10, y: 20, w: 40, h: 30 };
      const wp: CellPos = { cx: 30, cy: 25 };
      const edgeCell = calculateHouseEdgeSpawnCell(
        House.Greece,
        new Map([[House.Greece, 'north']]),
        bounds,
        wp,
      );

      expect(edgeCell).toBeDefined();
      expect(edgeCell!.cy).toBe(bounds.y - 1);
    });
  });

  describe('South edge: spawn cell is 1 row below map boundary — C++ display.cpp:2456', () => {
    it('south edge: cy = boundsY + h', () => {
      const bounds = { x: 10, y: 20, w: 40, h: 30 };
      // Waypoint near south edge so inferClosestMapEdge picks south
      const wp: CellPos = { cx: 30, cy: 49 };
      const edgeCell = calculateHouseEdgeSpawnCell(
        House.Greece,
        new Map([[House.Greece, 'south']]),
        bounds,
        wp,
      );

      expect(edgeCell).toBeDefined();
      // C++ display.cpp:2456: y = MapCellHeight, spawn at y + MapCellY = 30 + 20 = 50
      expect(
        edgeCell!.cy,
        `South edge spawn cy should be ${bounds.y + bounds.h} (boundsY + h), ` +
        `not ${bounds.y + bounds.h - 1}. C++ display.cpp:2456 sets y = MapCellHeight.`
      ).toBe(bounds.y + bounds.h);
    });
  });

  describe('West edge: spawn cell is 1 col left of map boundary — C++ display.cpp:2443', () => {
    it('west edge: cx = boundsX - 1', () => {
      const bounds = { x: 10, y: 20, w: 40, h: 30 };
      // Waypoint near west edge so inferClosestMapEdge picks west
      const wp: CellPos = { cx: 11, cy: 35 };
      const edgeCell = calculateHouseEdgeSpawnCell(
        House.Greece,
        new Map([[House.Greece, 'west']]),
        bounds,
        wp,
      );

      expect(edgeCell).toBeDefined();
      // C++ display.cpp:2443: x = -1, spawn at x + MapCellX = -1 + 10 = 9
      expect(
        edgeCell!.cx,
        `West edge spawn cx should be ${bounds.x - 1} (boundsX - 1), ` +
        `not ${bounds.x}. C++ display.cpp:2443 sets x = -1.`
      ).toBe(bounds.x - 1);
    });
  });

  describe('East edge: spawn cell is 1 col right of map boundary — C++ display.cpp:2445', () => {
    it('east edge: cx = boundsX + w', () => {
      const bounds = { x: 10, y: 20, w: 40, h: 30 };
      // Waypoint near east edge so inferClosestMapEdge picks east
      const wp: CellPos = { cx: 49, cy: 35 };
      const edgeCell = calculateHouseEdgeSpawnCell(
        House.Greece,
        new Map([[House.Greece, 'east']]),
        bounds,
        wp,
      );

      expect(edgeCell).toBeDefined();
      // C++ display.cpp:2445: x = MapCellWidth, spawn at x + MapCellX = 40 + 10 = 50
      expect(
        edgeCell!.cx,
        `East edge spawn cx should be ${bounds.x + bounds.w} (boundsX + w), ` +
        `not ${bounds.x + bounds.w - 1}. C++ display.cpp:2445 sets x = MapCellWidth.`
      ).toBe(bounds.x + bounds.w);
    });
  });

  // ============================================================
  // SECTION 2: SCG01EA rnf1 team — full spawn integration test
  // Team rnf1: origin=WP11 (63,45), members: JEEP x2
  // Expected: all JEEPs spawn at cy=44 (north edge, 1 cell above bounds)
  // ============================================================

  describe('SCG01EA rnf1 JEEP spawn integration — full executeTriggerAction', () => {
    it('JEEPs spawn at cy=44 (1 cell above boundsY=45), matching C++ WASM', () => {
      const waypoints = new Map<number, CellPos>([[11, WP11], [10, { cx: 62, cy: 50 }]]);
      const houseEdges = new Map<House, string>([[House.Greece, 'north']]);
      const team = makeTeam();
      const triggers: ScenarioTrigger[] = [makeTrigger()];

      const result = executeTriggerAction(
        makeAction(0),
        [team],
        waypoints,
        new Set(),
        triggers,
        0,
        houseEdges,
        SCG01EA_BOUNDS,
      );

      expect(result.spawned.length).toBe(2);
      for (const entity of result.spawned) {
        // World position: cellToWorld(63, 44) = { x: 63*24+12, y: 44*24+12 }
        // cy = Math.floor(entity.pos.y / 24) should be 44
        const spawnCy = Math.floor(entity.pos.y / 24);
        expect(
          spawnCy,
          `JEEP spawn cell cy should be 44 (boundsY-1), got ${spawnCy}. ` +
          `C++ display.cpp:2454 sets y = -1 for north edge.`
        ).toBe(44);
      }
    });
  });

  // ============================================================
  // SECTION 3: C++ SOURCE_NONE / no-waypoint fallback
  // display.cpp:2466-2492: when trycell == -1, use house edge
  // North: y = -1, South: y = MapCellHeight, West: x = -1, East: x = MapCellWidth
  // Same 1-cell-outside pattern applies to the fallback path.
  // ============================================================

  describe('House edge fallback (no waypoint) — also 1 cell outside bounds', () => {
    it('north fallback: cy = boundsY - 1', () => {
      const bounds = { x: 10, y: 20, w: 40, h: 30 };
      // No aligned cell — falls through to house edge
      const edgeCell = calculateHouseEdgeSpawnCell(
        House.Greece,
        new Map([[House.Greece, 'north']]),
        bounds,
        undefined,
        () => 0.5,
      );

      expect(edgeCell).toBeDefined();
      // C++ display.cpp:2471: y = -1 for SOURCE_NORTH fallback
      expect(edgeCell!.cy).toBe(bounds.y - 1);
    });

    it('south fallback: cy = boundsY + h', () => {
      const bounds = { x: 10, y: 20, w: 40, h: 30 };
      const edgeCell = calculateHouseEdgeSpawnCell(
        House.Greece,
        new Map([[House.Greece, 'south']]),
        bounds,
        undefined,
        () => 0.5,
      );

      expect(edgeCell).toBeDefined();
      // C++ display.cpp:2477: y = MapCellHeight for SOURCE_SOUTH fallback
      expect(edgeCell!.cy).toBe(bounds.y + bounds.h);
    });
  });
});
