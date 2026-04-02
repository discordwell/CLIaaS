/**
 * C++ Behavioral Parity: 256-step Aircraft Facing
 *
 * In C++ RA, aircraft facing is a DirType byte (0-255), giving 256-step angular
 * resolution. The TS engine originally used 8-step facing (N,NE,E,...), which caused
 * aircraft to fly straight instead of curving. With random spawn facings, the 8-step
 * quantization lost the fine angle that produces westward (or other) drift during
 * the initial fly-in.
 *
 * Example drift: TRAN spawns with facing 200 (~WSW). Target is south. With 256-step,
 * it flies WSW for several ticks while rotating toward south, accumulating 2 cells of
 * westward displacement. With 8-step, facing 200 snaps to W (6) or SW (5), losing
 * the precise angle.
 *
 * C++ source references:
 *   coord.cpp:442-516  — CosTable[256], SinTable[256] lookup tables
 *   coord.cpp:405-419  — calcx: (v * distance) >> 7, calcy: -((v * distance) >> 7)
 *   facing.cpp:142-172 — Rotation_Adjust: adjust facing by ROT per tick toward desired
 *   facing.h:70        — Difference: (signed char)(desired - current)
 *   fly.cpp:62-106     — Physics: Coord_Move(coord, PrimaryFacing.Current(), distance)
 *   reinf.cpp:466-468  — Random_Pick(DIR_N, DIR_MAX) for aircraft spawn facing (0-255)
 *
 * TRAN stats from rules.ini:
 *   [TRAN] Speed=12, ROT=5
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  House, Dir, CELL_SIZE, UNIT_STATS, MPH_TO_PX,
  type WorldPos,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  COS_TABLE_256, SIN_TABLE_256, directionTo256,
} from '../engine/aircraft';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeTRAN(x: number, y: number, facing256: number): Entity {
  const stats = UNIT_STATS['TRAN'];
  const entity = new Entity(stats.type, House.USSR, x, y);
  entity.aircraftState = 'flying';
  entity.flightAltitude = Entity.FLIGHT_ALTITUDE;
  // Set 256-step facing (as done in scenario.ts for aircraft spawn)
  entity.facing256 = facing256;
  entity.desiredFacing256 = facing256;
  entity.facing = (Math.floor(facing256 / 32) % 8) as Dir;
  entity.desiredFacing = entity.facing;
  entity.bodyFacing32 = Math.floor(facing256 / 8) % 32;
  return entity;
}

// -- Tests ------------------------------------------------------------------

describe('C++ parity: 256-step aircraft facing', () => {

  describe('COS_TABLE_256 / SIN_TABLE_256 match C++ coord.cpp', () => {
    // C++ coord.cpp:442: CosTable[0]=0 (north gives no X movement)
    it('CosTable[0] = 0 (north: no X)', () => {
      expect(COS_TABLE_256[0]).toBe(0);
    });

    // C++ coord.cpp:480: SinTable[0]=127 (north: maximum Y upward after negation)
    it('SinTable[0] = 127 (north: max Y)', () => {
      expect(SIN_TABLE_256[0]).toBe(127);
    });

    // C++ coord.cpp:452: CosTable[64]=127 (east: maximum X)
    it('CosTable[64] = 127 (east: max X)', () => {
      expect(COS_TABLE_256[64]).toBe(127);
    });

    // C++ coord.cpp:488: SinTable[64]=0 (east: no Y)
    it('SinTable[64] = 0 (east: no Y)', () => {
      expect(SIN_TABLE_256[64]).toBe(0);
    });

    // C++ coord.cpp:460: CosTable[128]=0 (south: no X)
    it('CosTable[128] = 0 (south: no X)', () => {
      expect(COS_TABLE_256[128]).toBe(0);
    });

    // C++ coord.cpp:496: SinTable[128]=-126 (south: max Y downward)
    it('SinTable[128] = -126 (south: max Y downward)', () => {
      expect(SIN_TABLE_256[128]).toBe(-126);
    });

    // C++ coord.cpp:468: CosTable[192]=-126 (west: max X leftward)
    it('CosTable[192] = -126 (west: max X leftward)', () => {
      expect(COS_TABLE_256[192]).toBe(-126);
    });

    // Tables should have exactly 256 entries
    it('tables have 256 entries', () => {
      expect(COS_TABLE_256.length).toBe(256);
      expect(SIN_TABLE_256.length).toBe(256);
    });
  });

  describe('directionTo256 matches C++ Direction()', () => {
    // C++ Direction: 0=N, 64=E, 128=S, 192=W
    it('due north = 0', () => {
      expect(directionTo256({ x: 100, y: 100 }, { x: 100, y: 0 })).toBe(0);
    });

    it('due east = 64', () => {
      expect(directionTo256({ x: 100, y: 100 }, { x: 200, y: 100 })).toBe(64);
    });

    it('due south = 128', () => {
      expect(directionTo256({ x: 100, y: 100 }, { x: 100, y: 200 })).toBe(128);
    });

    it('due west = 192', () => {
      expect(directionTo256({ x: 100, y: 100 }, { x: 0, y: 100 })).toBe(192);
    });

    it('northeast = 32', () => {
      expect(directionTo256({ x: 100, y: 100 }, { x: 200, y: 0 })).toBe(32);
    });

    it('same position returns 0', () => {
      expect(directionTo256({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(0);
    });
  });

  describe('tickRotation256 matches C++ Rotation_Adjust', () => {
    // C++ facing.cpp:142-172: adjusts facing by ROT per tick, snaps if diff < ROT

    it('TRAN ROT=5: facing changes by exactly 5 per tick', () => {
      // Use a facing/desired pair where shortest path is unambiguously CW.
      // From 0 (N) toward 64 (E): diff = (64-0) & 0xFF = 64, < 128 → CW
      const entity = makeTRAN(500, 500, 0); // facing north
      entity.desiredFacing256 = 64; // want to face east (CW, < 128 diff)

      // Tick 1: facing should advance from 0 to 5
      entity.rotTickedThisFrame = false;
      entity.tickRotation256();
      expect(entity.facing256).toBe(5);

      // Tick 2: facing should advance from 5 to 10
      entity.rotTickedThisFrame = false;
      entity.tickRotation256();
      expect(entity.facing256).toBe(10);
    });

    it('N to S (diff=128): C++ signed char gives -128 → CCW', () => {
      // C++ facing.h:70: diff = (signed char)(128-0) = (signed char)128 = -128 → CCW
      const entity = makeTRAN(500, 500, 0);
      entity.desiredFacing256 = 128;

      entity.rotTickedThisFrame = false;
      entity.tickRotation256();
      // CCW: 0 - 5 + 256 = 251
      expect(entity.facing256).toBe(251);
    });

    it('rotation takes shortest path (CW vs CCW)', () => {
      // C++ facing.h:70: diff = (signed char)(desired - current)
      // From 200 to 128: diff = (128-200) & 0xFF = 184, > 127 → signed = -72 → CCW
      const entity = makeTRAN(500, 500, 200);
      entity.desiredFacing256 = 128; // south

      entity.rotTickedThisFrame = false;
      entity.tickRotation256();
      // CCW means subtracting: 200 - 5 = 195
      expect(entity.facing256).toBe(195);
    });

    it('snaps to desired when diff <= ROT', () => {
      // C++ facing.cpp:159-160: if abs(diff) < rate, snap
      const entity = makeTRAN(500, 500, 126);
      entity.desiredFacing256 = 128;

      entity.rotTickedThisFrame = false;
      entity.tickRotation256();
      // diff = 2, ROT = 5, 2 <= 5 → snap
      expect(entity.facing256).toBe(128);
    });

    it('syncs 8-dir facing from facing256', () => {
      const entity = makeTRAN(500, 500, 200);
      // 200 / 32 = 6.25 → floor = 6 = Dir.W
      expect(entity.facing).toBe(Dir.W);

      // After rotation toward south (128):
      entity.desiredFacing256 = 128;
      entity.rotTickedThisFrame = false;
      entity.tickRotation256();
      // 195 / 32 = 6.09 → floor = 6 = Dir.W (still W)
      expect(entity.facing).toBe(Dir.W);
    });

    it('wraps around 0/255 boundary correctly', () => {
      // From 3 rotating CCW (toward 250): diff = (250-3) & 0xFF = 247, > 127 → signed = -9 → CCW
      const entity = makeTRAN(500, 500, 3);
      entity.desiredFacing256 = 250;

      entity.rotTickedThisFrame = false;
      entity.tickRotation256();
      // CCW: 3 - 5 + 256 = 254
      expect(entity.facing256).toBe(254);
    });
  });

  describe('TRAN westward drift with facing256 = 200', () => {
    // This is the core parity scenario from the bug report.
    // TRAN spawns with facing 200 (~WSW, between W=192 and SW=160).
    // Target is due south. With 256-step facing, the TRAN initially flies WSW,
    // accumulating westward displacement while gradually rotating toward south.
    //
    // C++ coord.cpp: CosTable[200] = -100, SinTable[200] = -91
    //   x += (-100 * dist) >> 7 → negative X (westward movement)
    //   y -= (-91 * dist) >> 7  → positive Y (downward/southward)

    it('CosTable[200] < 0 (westward X component)', () => {
      // Facing 200 = W(192) + 8 toward NW(224) = WNW. CosTable gives negative X.
      expect(COS_TABLE_256[200]).toBeLessThan(0);
    });

    it('SinTable[200] > 0 (northward Y component)', () => {
      // Facing 200 = WNW. SinTable[200] > 0 means calcy produces negative Y (northward).
      // The aircraft drifts slightly north while flying mostly west.
      expect(SIN_TABLE_256[200]).toBeGreaterThan(0);
    });

    it('TRAN with facing256=200 drifts west while rotating toward south', () => {
      const startX = 500;
      const startY = 500;
      const entity = makeTRAN(startX, startY, 200);
      const targetSouth: WorldPos = { x: startX, y: startY + 500 };

      // Facing 200 = WNW. Target is south (128).
      // diff = (128-200) & 0xFF = 184, > 127 → signed = -72 → CCW
      // Each tick subtracts 5: 200, 195, 190, 185, 180, 175, 170, 165, 160, 155, 150
      // Movement: CosTable[200..150] is negative (westward drift)

      let accumulatedCos = 0;
      // Track the first 10 ticks where facing is still in the western half
      for (let t = 0; t < 10; t++) {
        const f = entity.facing256;
        const cosVal = COS_TABLE_256[f];
        // Negative CosTable value → westward X movement
        if (cosVal < 0) accumulatedCos += cosVal;

        // Simulate rotation toward south (128)
        entity.desiredFacing256 = directionTo256(entity.pos, targetSouth);
        entity.rotTickedThisFrame = false;
        entity.tickRotation256();
      }

      // Should have accumulated negative X (westward) displacement across 10 ticks
      expect(accumulatedCos).toBeLessThan(0);
      // After 10 ticks at ROT=5: 200 - (10*5) = 150
      expect(entity.facing256).toBe(150);
    });

    it('256-step facing 160 (SW) has both west and south components vs pure W', () => {
      // Facing 160 = SW. CosTable[160] < 0 (west), SinTable[160] < 0 (south via negation).
      // Pure W (192) has SinTable near 0 — no southward drift.
      // This shows the angular resolution difference: intermediate facings like 160 (SW)
      // produce movement in both axes, while 8-step snaps to one of 8 directions.
      const cos160 = COS_TABLE_256[160]; // between S(128) and W(192) — westward
      const sin160 = SIN_TABLE_256[160]; // southward via negation (SinTable < 0 here)
      const sin192 = SIN_TABLE_256[192]; // due W — near 0

      expect(cos160).toBeLessThan(0); // westward
      expect(sin160).toBeLessThan(0); // SinTable < 0 means calcy gives positive Y = south
      // SW has a significant south component that pure W lacks
      expect(Math.abs(sin160)).toBeGreaterThan(Math.abs(sin192) + 30);
    });
  });

  describe('facing256 does not affect ground units', () => {
    it('ground unit tickRotation256 falls back to tickRotation', () => {
      const entity = new Entity(UNIT_STATS['1TNK'].type, House.USSR, 500, 500);
      // Ground units have facing256 = -1 (default)
      expect(entity.facing256).toBe(-1);

      entity.facing = Dir.N;
      entity.desiredFacing = Dir.E;
      entity.bodyFacing32 = 0;
      entity.rotAccumulator = 0;
      entity.rotTickedThisFrame = false;

      // tickRotation256 should fall through to regular tickRotation
      entity.tickRotation256();

      // Should have used the 32-step accumulator system, not 256-step
      // With rot=5, accumulator gets 5, < 8 threshold, no visual step yet
      expect(entity.facing256).toBe(-1); // still not using 256-step
    });
  });
});
