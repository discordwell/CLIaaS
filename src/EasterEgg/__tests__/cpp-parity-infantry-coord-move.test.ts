/**
 * C++ Behavioral Parity: Infantry Coord_Move Lepton Truncation
 *
 * Tests verify that TypeScript infantry moveToward() produces per-tick
 * movement distances matching C++ coord.cpp Coord_Move with integer
 * lepton distance input.
 *
 * C++ source references:
 *   techno.cpp:6287  — _Scale_To_256: MaxSpeed = floor(Speed * 256 / 100)
 *   infantry.cpp:4019 — Coord_Move(Coord, dir, maxspeed * fixed(movespeed, 256))
 *   coord.cpp:419     — calcx(v, distance) = (v * distance) >> 7
 *   coord.cpp:437     — calcy(v, distance) = -((v * distance) >> 7)
 *   coord.cpp:480-516 — SinTable[0]=127 (cardinal north), SinTable[32]=90 (45deg diagonal)
 *
 * The bug: Without flooring effectiveSpeed/LP to integer leptons before
 * applying the sin/cos factor, fractional leptons (e.g. 10.24 for E1 Speed=4)
 * leak through the calculation and produce 10 leptons/tick instead of the
 * correct C++ value of 9 leptons/tick for cardinal movement.
 *
 *   C++: distance=floor(4*256/100)=10 → (10*127)>>7 = 1270>>7 = 9 leptons/tick
 *   TS (broken): floor(10.24*127/128) = floor(10.16) = 10 leptons/tick (11% too fast)
 *   TS (fixed):  floor(floor(10.24)*127/128) = floor(10*127/128) = 9 leptons/tick ✓
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission,
  UNIT_STATS, MPH_TO_PX,
  type WorldPos,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { LP } from '../engine/tracks';

beforeEach(() => resetEntityIds());

function makeEntity(type: string, house: House, x: number, y: number): Entity {
  const unitType = type as UnitType;
  const e = new Entity(unitType, house, x, y);
  e.mission = Mission.HUNT;
  return e;
}

// C++ reference: _Scale_To_256 + Coord_Move integer pipeline
function cppInfantryLeptonsPerTick(iniSpeed: number, isDiagonal: boolean): number {
  const maxSpeed = Math.floor(iniSpeed * 256 / 100); // _Scale_To_256
  // fixed(255, 256) ≈ 0.996 → maxspeed * fixed(255,256) ≈ maxspeed for most values
  // Exact: ((maxSpeed * 256) * 255) / 256 / 256, then round → maxSpeed for small values
  // C++ result: (fixed(maxSpeed) * fixed(255,256)).operator unsigned() = (maxSpeed*256*255/256 + 128)/256
  const fixedRaw = Math.floor((maxSpeed * 256 * 255) / 256);  // fixed multiply raw
  const distance = Math.floor((fixedRaw + 128) / 256);        // fixed to unsigned

  // Coord_Move: calcx/calcy use (table_value * distance) >> 7
  const sinFactor = isDiagonal ? 90 : 127;
  return (distance * sinFactor) >> 7;
}

describe('C++ infantry Coord_Move lepton truncation parity', () => {
  describe('per-tick lepton distance matches C++ calcx/calcy', () => {
    // Test all infantry types with their rules.ini Speed values
    const INFANTRY_SPEEDS: [string, number][] = [
      ['E1', 4],    // rules.ini [E1] Speed=4
      ['E2', 5],    // rules.ini [E2] Speed=5
      ['E3', 3],    // rules.ini [E3] Speed=3
      ['E4', 3],    // rules.ini [E4] Speed=3
      ['E6', 4],    // rules.ini [E6] Speed=4
      ['SPY', 4],   // rules.ini [SPY] Speed=4
      ['MEDI', 4],  // rules.ini [MEDI] Speed=4
      ['GNRL', 5],  // rules.ini [GNRL] Speed=5
      ['E7', 5],    // rules.ini [E7] Speed=5 (Tanya)
      ['THF', 4],   // rules.ini [THF] Speed=4
      ['SHOK', 4],  // rules.ini [SHOK] Speed=4 (Aftermath)
      ['MECH', 4],  // rules.ini [MECH] Speed=4 (Aftermath)
      ['C1', 4],    // rules.ini [C1] Speed=4
      ['C2', 4],    // rules.ini [C2] Speed=4
      ['C3', 4],    // rules.ini [C3] Speed=4
      ['C4', 4],    // rules.ini [C4] Speed=4
      ['C5', 4],    // rules.ini [C5] Speed=4
    ];

    for (const [type, iniSpeed] of INFANTRY_SPEEDS) {
      it(`${type} Speed=${iniSpeed} cardinal: C++ gives ${cppInfantryLeptonsPerTick(iniSpeed, false)} leptons/tick`, () => {
        const cppLeptons = cppInfantryLeptonsPerTick(iniSpeed, false);
        const entity = makeEntity(type, House.USSR, 500, 500);
        entity.facing = Dir.N;
        entity.desiredFacing = Dir.N;

        const startY = entity.pos.y;
        const farNorth: WorldPos = { x: 500, y: 0 };
        const speedPx = iniSpeed * MPH_TO_PX;

        entity.moveToward(farNorth, speedPx);

        const movedPx = startY - entity.pos.y;
        const movedLeptons = Math.round(movedPx / LP);
        expect(movedLeptons, `${type} should move ${cppLeptons} leptons/tick cardinal (C++ parity)`).toBe(cppLeptons);
      });
    }
  });

  it('E1 Speed=4 cardinal north: exactly 9 leptons/tick, not 10', () => {
    // This is the specific case that caused 1-cell position drift on SCG01EA.
    // C++: _Scale_To_256(4)=10, Coord_Move distance=10, calcx=(10*127)>>7 = 9
    // Without the floor fix, TS computes floor(10.24*127/128) = 10 (too fast!)
    const entity = makeEntity('E1', House.USSR, 1548, 1404);
    entity.facing = Dir.N;
    entity.desiredFacing = Dir.N;
    const farNorth: WorldPos = { x: 1548, y: 0 };
    const speedPx = 4 * MPH_TO_PX; // E1 Speed=4

    const startY = entity.pos.y;
    entity.moveToward(farNorth, speedPx);

    const movedPx = startY - entity.pos.y;
    const expectedPx = 9 * LP; // 9 leptons * 0.09375 px/lepton = 0.84375 px
    expect(movedPx).toBeCloseTo(expectedPx, 10);
  });

  it('E1 Speed=4 diagonal: 7 leptons/axis/tick (same in C++ and TS)', () => {
    // Diagonal case happens to be correct even without the fix because
    // floor(10.24*90/128) = floor(7.2) = 7, same as (10*90)>>7 = 7
    // But verify it stays correct with the fix applied.
    const entity = makeEntity('E1', House.USSR, 500, 500);
    entity.facing = Dir.NE;
    entity.desiredFacing = Dir.NE;
    const farNE: WorldPos = { x: 1000, y: 0 };
    const speedPx = 4 * MPH_TO_PX;

    const startX = entity.pos.x;
    const startY = entity.pos.y;
    entity.moveToward(farNE, speedPx);

    const movedX = entity.pos.x - startX;
    const movedY = startY - entity.pos.y;
    const expectedAxisPx = 7 * LP; // 7 leptons * 0.09375 = 0.65625 px
    expect(movedX).toBeCloseTo(expectedAxisPx, 10);
    expect(movedY).toBeCloseTo(expectedAxisPx, 10);
  });

  it('cumulative E1 position over 49 ticks matches C++ (SCG01EA repro)', () => {
    // SCG01EA infantry index 1: E1 at cell (64,58), Hunt toward player at ~(64,49)
    // Starting pixel center: (64*24+12, 58*24+12) = (1548, 1404)
    // C++ moves 9 leptons/tick northward = 0.84375 px/tick
    // After 49 ticks: 49 * 0.84375 = 41.34375 px north → Y = 1404 - 41.34375 = 1362.65625
    // Cell Y = floor(1362.65625 / 24) = 56 (which is 2 cells north of start)
    // But infantry moves cell-by-cell, so let's verify cumulative movement distance
    const entity = makeEntity('E1', House.USSR, 1548, 1404);
    entity.facing = Dir.N;
    entity.desiredFacing = Dir.N;
    const farNorth: WorldPos = { x: 1548, y: 0 };
    const speedPx = 4 * MPH_TO_PX;

    const startY = entity.pos.y;
    for (let tick = 0; tick < 49; tick++) {
      entity.moveToward(farNorth, speedPx);
    }

    const totalMovedPx = startY - entity.pos.y;
    const expectedPx = 49 * 9 * LP; // 49 ticks * 9 leptons/tick * 0.09375 px/lepton
    expect(totalMovedPx).toBeCloseTo(expectedPx, 8);
  });

  describe('DOG Speed=4 with 2x canine sprint: 18 leptons/tick cardinal', () => {
    it('DOG at 2x sprint matches C++ Coord_Move', () => {
      // Dog gets 2x movespeed when chasing target (infantry.cpp:3996-3997)
      // _Scale_To_256(4)=10, but movementSpeed() doubles it: effectiveSpeed = 8*0.24 = 1.92
      // floor(1.92 / LP) = floor(20.48) = 20
      // floor(20 * 127 / 128) = floor(19.84375) = 19
      // C++: _Scale_To_256(8)=20, (20*127)>>7 = 2540>>7 = 19
      const iniSpeed = 4;
      const dogSpeed = iniSpeed * 2 * MPH_TO_PX; // 2x canine sprint applied by movementSpeed()
      const entity = makeEntity('DOG', House.USSR, 500, 500);
      entity.facing = Dir.N;
      entity.desiredFacing = Dir.N;

      const startY = entity.pos.y;
      entity.moveToward({ x: 500, y: 0 }, dogSpeed);

      const movedPx = startY - entity.pos.y;
      // C++ reference: floor(floor(8*256/100)*127/128) = floor(20*127/128) = floor(19.84) = 19
      const expectedLeptons = 19;
      expect(Math.round(movedPx / LP)).toBe(expectedLeptons);
    });
  });
});
