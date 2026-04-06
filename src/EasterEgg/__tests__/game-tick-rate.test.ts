/**
 * Game tick rate parity test.
 * Verifies GAME_TICKS_PER_SEC matches C++ TICKS_PER_SECOND = 15.
 *
 * C++ sources:
 *   defines.h:3031   → TICKS_PER_SECOND = 15
 *   options.cpp:91   → GameSpeed(4)              (default value)
 *   queue.cpp:1425   → specified_frame_rate = 60 / Options.GameSpeed
 *
 * Our engine uses a fixed tick rate of 15 Hz, matching C++ TICKS_PER_SECOND.
 */

import { describe, it, expect } from 'vitest';
import {
  GAME_TICKS_PER_SEC,
  CELL_SIZE,
  LEPTON_SIZE,
  MPH_TO_PX,
  UNIT_STATS,
  UnitType,
} from '../engine/types';

describe('Game tick rate matches C++ TICKS_PER_SECOND=15', () => {
  // C++ defines.h:3031: TICKS_PER_SECOND = 15
  // C++ options.cpp:91: GameSpeed(4) — default → 60/4 = 15
  const CPP_TICKS_PER_SECOND = 15;

  it('GAME_TICKS_PER_SEC equals C++ TICKS_PER_SECOND (15)', () => {
    expect(GAME_TICKS_PER_SEC).toBe(CPP_TICKS_PER_SECOND);
    expect(GAME_TICKS_PER_SEC).toBe(15);
  });

  it('MPH_TO_PX conversion matches C++ Speed percentage scaling', () => {
    // C++ techno.cpp:6287: MaxSpeed = (Speed * 256) / 100  (_Scale_To_256)
    // Then movement: Coord_Move uses MaxSpeed leptons/tick → MaxSpeed * (CELL_SIZE/256) px/tick
    // Combined: px/tick = Speed * (256/100) * (CELL_SIZE/256) = Speed * CELL_SIZE/100
    // MPH_TO_PX = CELL_SIZE / 100 = 0.24
    expect(MPH_TO_PX).toBeCloseTo(CELL_SIZE / 100, 6);
    expect(MPH_TO_PX).toBeCloseTo(0.24, 6);
  });

  it('1TNK movement: pixels/sec matches C++ at 15fps', () => {
    const stats = UNIT_STATS[UnitType.V_1TNK];
    // C++ Speed is a percentage (0-100): Speed=9 → MaxSpeed = floor(9*256/100) = 23 leptons/tick
    // px/tick = Speed * MPH_TO_PX = 9 * 0.24 = 2.16
    const pxPerTick = stats.speed * MPH_TO_PX;
    const pxPerSec = pxPerTick * GAME_TICKS_PER_SEC;
    const cellsPerSec = pxPerSec / CELL_SIZE;

    // 1TNK Speed=9: 9 * 0.24 = 2.16 px/tick, 32.4 px/sec, 1.35 cells/sec
    expect(pxPerTick).toBeCloseTo(2.16, 2);
    expect(pxPerSec).toBeCloseTo(32.4, 1);
    expect(cellsPerSec).toBeCloseTo(1.35, 2);
  });

  it('E1 infantry movement: cells/sec at default speed', () => {
    const stats = UNIT_STATS[UnitType.I_E1];
    const pxPerTick = stats.speed * MPH_TO_PX;
    const cellsPerSec = (pxPerTick * GAME_TICKS_PER_SEC) / CELL_SIZE;
    // E1 Speed=4: 4 * 0.24 * 15 / 24 = 0.6 cells/sec
    expect(cellsPerSec).toBeCloseTo(0.6, 3);
  });

  it('tickInterval is ~66.67ms (1000/15)', () => {
    const tickInterval = 1000 / GAME_TICKS_PER_SEC;
    expect(tickInterval).toBeCloseTo(66.67, 1);
  });

  it('rotation speed: 1TNK full rotation time matches C++ at 15fps', () => {
    const stats = UNIT_STATS[UnitType.V_1TNK];
    // ROT=5: accumulates 5 per tick, advances 1 of 32 steps when accumulator >= 8
    // Effective rate: rot/8 steps per tick = 5/8 = 0.625 steps/tick
    // Full rotation (32 steps): 32 / 0.625 = 51.2 ticks = 3.41 seconds at 15fps
    // C++ has 256-direction system: 256/rot = 256/5 = 51.2 ticks — same!
    const stepsPerTick = stats.rot / 8;
    const fullRotationTicks = 32 / stepsPerTick;
    const fullRotationSec = fullRotationTicks / GAME_TICKS_PER_SEC;
    expect(fullRotationTicks).toBeCloseTo(51.2, 1);
    expect(fullRotationSec).toBeCloseTo(3.41, 2);
  });
});
