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

  it('MPH_TO_PX conversion matches C++ PIXEL_LEPTON_W inverse', () => {
    // C++ display.h: PIXEL_LEPTON_W = ICON_LEPTON_W / ICON_PIXEL_W = 256/24 ≈ 10.67
    // Our conversion: MPH_TO_PX = CELL_SIZE / LEPTON_SIZE = 24/256 = 1/PIXEL_LEPTON_W
    const CPP_PIXEL_LEPTON_W = LEPTON_SIZE / CELL_SIZE; // 256/24 ≈ 10.67
    expect(MPH_TO_PX).toBeCloseTo(1 / CPP_PIXEL_LEPTON_W, 6);
    expect(MPH_TO_PX).toBeCloseTo(0.09375, 6);
  });

  it('1TNK movement: pixels/sec matches C++ at 15fps', () => {
    const stats = UNIT_STATS[UnitType.V_1TNK];
    // C++ drive.cpp:671: actual = SpeedAccum + maxspeed * fixed(Speed, 256)
    // At full speed (Speed=255): maxspeed * 255/256 ≈ maxspeed
    // Distance per tick ≈ maxspeed leptons → maxspeed * MPH_TO_PX pixels
    const pxPerTick = stats.speed * MPH_TO_PX;
    const pxPerSec = pxPerTick * GAME_TICKS_PER_SEC;
    const cellsPerSec = pxPerSec / CELL_SIZE;

    // 1TNK Speed=9: 9 * 0.09375 * 15 = 12.656 px/sec = 0.527 cells/sec
    expect(pxPerTick).toBeCloseTo(0.844, 2);
    expect(pxPerSec).toBeCloseTo(12.656, 1);
    expect(cellsPerSec).toBeCloseTo(0.527, 2);
  });

  it('E1 infantry movement: cells/sec at default speed', () => {
    const stats = UNIT_STATS[UnitType.I_E1];
    const pxPerTick = stats.speed * MPH_TO_PX;
    const cellsPerSec = (pxPerTick * GAME_TICKS_PER_SEC) / CELL_SIZE;
    // E1 Speed=4: 4 * 0.09375 * 15 / 24 = 0.234375 cells/sec
    expect(cellsPerSec).toBeCloseTo(0.234375, 3);
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
