/**
 * C++ parity tests: reinforcement spawn behavior
 *
 * C++ source: reinf.cpp Do_Reinforcements (line 372-531)
 * C++ source: scenario.cpp Clip_Scatter (line 3300-3355)
 *
 * Key C++ behavior:
 * 1. Ground reinforcements spawn at the MAP EDGE, not at the origin waypoint
 *    (reinf.cpp:441 — Map.Calculated_Cell picks edge entry cell)
 * 2. Units get MISSION_GUARD on spawn; team script assigns MOVE later
 *    (reinf.cpp:480 — Assign_Mission(MISSION_GUARD))
 * 3. Aircraft spawn at edge and fly to origin waypoint
 * 4. Spawn positions are always within map bounds
 *    (scenario.cpp:3328-3335 — Clip_Scatter clamps to MapCellX..MapCellX+MapCellWidth-1)
 */

import { describe, it, expect } from 'vitest';
import {
  calculateHouseEdgeSpawnCell,
  resolveTeamOriginCell,
} from '../engine/scenario';
import { House, Mission } from '../engine/types';

describe('Reinforcement spawn — C++ parity', () => {
  const MAP_BOUNDS = { x: 23, y: 57, w: 87, h: 54 };

  describe('calculateHouseEdgeSpawnCell', () => {
    // C++ reinf.cpp:441 — Calculated_Cell picks a cell at the house edge
    // aligned with the origin waypoint

    it('returns a cell at the map edge, not at the origin waypoint', () => {
      const houseEdges = new Map<House, string>([[House.Greece, 'west']]);
      const originWp = { cx: 26, cy: 64 };
      const edgeCell = calculateHouseEdgeSpawnCell(House.Greece, houseEdges, MAP_BOUNDS, originWp);

      expect(edgeCell).toBeDefined();
      // Edge cell must be ON the map boundary
      const onEdge = edgeCell!.cx === MAP_BOUNDS.x ||
        edgeCell!.cx === MAP_BOUNDS.x + MAP_BOUNDS.w - 1 ||
        edgeCell!.cy === MAP_BOUNDS.y ||
        edgeCell!.cy === MAP_BOUNDS.y + MAP_BOUNDS.h - 1;
      expect(onEdge, `(${edgeCell!.cx},${edgeCell!.cy}) should be on map edge`).toBe(true);
    });

    it('aligns edge cell with origin waypoint coordinate', () => {
      const houseEdges = new Map<House, string>([[House.Greece, 'west']]);
      const originWp = { cx: 26, cy: 64 };
      const edgeCell = calculateHouseEdgeSpawnCell(House.Greece, houseEdges, MAP_BOUNDS, originWp);

      // West edge: cx should be boundsX, cy should match waypoint
      expect(edgeCell).toBeDefined();
      expect(edgeCell!.cx).toBe(MAP_BOUNDS.x); // west edge
      expect(edgeCell!.cy).toBe(64); // aligned with waypoint Y
    });

    it('clamps aligned coordinate to map bounds (C++ Clip_Scatter clamping)', () => {
      const houseEdges = new Map<House, string>([[House.Greece, 'north']]);
      // Waypoint with out-of-bounds cx — should clamp to map boundary
      const originWp = { cx: 10, cy: 57 }; // cx=10 is below boundsX=23, cy=57 is top edge
      const edgeCell = calculateHouseEdgeSpawnCell(House.Greece, houseEdges, MAP_BOUNDS, originWp);

      expect(edgeCell).toBeDefined();
      // With aligned cell, edge is inferred from closest map edge (north, since cy=57=boundsY)
      // cx should be clamped to boundsX minimum
      expect(edgeCell!.cx).toBeGreaterThanOrEqual(MAP_BOUNDS.x);
      expect(edgeCell!.cx).toBeLessThanOrEqual(MAP_BOUNDS.x + MAP_BOUNDS.w - 1);
      expect(edgeCell!.cy).toBeGreaterThanOrEqual(MAP_BOUNDS.y);
      expect(edgeCell!.cy).toBeLessThanOrEqual(MAP_BOUNDS.y + MAP_BOUNDS.h - 1);
    });

    it('spawn cell is always within map bounds', () => {
      // Test many random seeds to ensure no out-of-bounds spawns
      const houseEdges = new Map<House, string>([[House.Greece, 'west']]);
      for (let i = 0; i < 100; i++) {
        const edgeCell = calculateHouseEdgeSpawnCell(
          House.Greece, houseEdges, MAP_BOUNDS, { cx: 23, cy: 64 },
          () => i / 100,
        );
        expect(edgeCell).toBeDefined();
        expect(edgeCell!.cx).toBeGreaterThanOrEqual(MAP_BOUNDS.x);
        expect(edgeCell!.cx).toBeLessThanOrEqual(MAP_BOUNDS.x + MAP_BOUNDS.w - 1);
        expect(edgeCell!.cy).toBeGreaterThanOrEqual(MAP_BOUNDS.y);
        expect(edgeCell!.cy).toBeLessThanOrEqual(MAP_BOUNDS.y + MAP_BOUNDS.h - 1);
      }
    });
  });

  describe('resolveTeamOriginCell', () => {
    // C++ reinf.cpp:441 — uses origin waypoint to determine edge alignment,
    // NOT as the spawn location itself

    it('returns the waypoint cell when origin exists', () => {
      const waypoints = new Map<number, { cx: number; cy: number }>([
        [0, { cx: 23, cy: 64 }],
      ]);
      const cell = resolveTeamOriginCell(0, House.Greece, waypoints);
      expect(cell).toEqual({ cx: 23, cy: 64 });
    });

    it('falls back to house edge when origin waypoint is missing', () => {
      const waypoints = new Map<number, { cx: number; cy: number }>();
      const houseEdges = new Map<House, string>([[House.Greece, 'west']]);
      const cell = resolveTeamOriginCell(99, House.Greece, waypoints, houseEdges, MAP_BOUNDS);
      expect(cell).toBeDefined();
      // Should be on the west edge
      expect(cell!.cx).toBe(MAP_BOUNDS.x);
    });
  });

  describe('SCG08EA MCV reinforcement — regression test', () => {
    // The MCV team in SCG08EA has origin waypoint 0 = (23, 64).
    // Map bounds start at x=23, so the waypoint is at the leftmost column.
    // C++ spawns at the edge (west) and the team TMISSION_MOVE walks the MCV in.
    // The MCV must NOT spawn outside map bounds.

    it('edge spawn cell for SCG08EA MCV is within map bounds', () => {
      const houseEdges = new Map<House, string>([[House.Greece, 'west']]);
      const originWp = { cx: 23, cy: 64 }; // WP0 in SCG08EA

      for (let i = 0; i < 50; i++) {
        const edgeCell = calculateHouseEdgeSpawnCell(
          House.Greece, houseEdges, MAP_BOUNDS, originWp,
          () => i / 50,
        );
        expect(edgeCell).toBeDefined();
        expect(edgeCell!.cx, `iteration ${i}: cx out of bounds`).toBeGreaterThanOrEqual(MAP_BOUNDS.x);
        expect(edgeCell!.cy, `iteration ${i}: cy out of bounds`).toBeGreaterThanOrEqual(MAP_BOUNDS.y);
      }
    });
  });
});
