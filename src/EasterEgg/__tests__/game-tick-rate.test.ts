/**
 * Game tick rate parity test.
 * Verifies GAME_TICKS_PER_SEC matches C++ default GameSpeed=3 → 60/3 = 20 FPS.
 *
 * C++ sources:
 *   options.cpp:91   → GameSpeed(3)              (default value)
 *   queue.cpp:1425   → specified_frame_rate = 60 / Options.GameSpeed
 *   defines.h        → TIMER_SECOND = 60, TICKS_PER_SECOND = 15
 *
 * The original game runs at 60/GameSpeed FPS. At default GameSpeed=3, that's 20 FPS.
 * TICKS_PER_SECOND=15 is used for timer conversions but the actual tick rate depends
 * on GameSpeed. Our engine uses a fixed tick rate matching the default.
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

describe('Game tick rate matches C++ default GameSpeed=3', () => {
  // C++ queue.cpp:1425: specified_frame_rate = 60 / Options.GameSpeed
  // C++ options.cpp:91: GameSpeed(3) — default
  const CPP_TIMER_SECOND = 60;
  const CPP_DEFAULT_GAME_SPEED = 3;
  const CPP_DEFAULT_FPS = CPP_TIMER_SECOND / CPP_DEFAULT_GAME_SPEED; // 20

  it('GAME_TICKS_PER_SEC equals C++ default frame rate (20)', () => {
    expect(GAME_TICKS_PER_SEC).toBe(CPP_DEFAULT_FPS);
    expect(GAME_TICKS_PER_SEC).toBe(20);
  });

  it('MPH_TO_PX conversion matches C++ PIXEL_LEPTON_W inverse', () => {
    // C++ display.h: PIXEL_LEPTON_W = ICON_LEPTON_W / ICON_PIXEL_W = 256/24 ≈ 10.67
    // Our conversion: MPH_TO_PX = CELL_SIZE / LEPTON_SIZE = 24/256 = 1/PIXEL_LEPTON_W
    const CPP_PIXEL_LEPTON_W = LEPTON_SIZE / CELL_SIZE; // 256/24 ≈ 10.67
    expect(MPH_TO_PX).toBeCloseTo(1 / CPP_PIXEL_LEPTON_W, 6);
    expect(MPH_TO_PX).toBeCloseTo(0.09375, 6);
  });

  it('1TNK movement: pixels/sec matches C++ at GameSpeed=3', () => {
    const stats = UNIT_STATS[UnitType.V_1TNK];
    // C++ drive.cpp:671: actual = SpeedAccum + maxspeed * fixed(Speed, 256)
    // At full speed (Speed=255): maxspeed * 255/256 ≈ maxspeed
    // Distance per tick ≈ maxspeed leptons → maxspeed * MPH_TO_PX pixels
    const pxPerTick = stats.speed * MPH_TO_PX;
    const pxPerSec = pxPerTick * GAME_TICKS_PER_SEC;
    const cellsPerSec = pxPerSec / CELL_SIZE;

    // 1TNK Speed=9: 9 * 0.09375 * 20 = 16.875 px/sec = 0.703 cells/sec
    expect(pxPerTick).toBeCloseTo(0.844, 2);
    expect(pxPerSec).toBeCloseTo(16.875, 1);
    expect(cellsPerSec).toBeCloseTo(0.703, 2);
  });

  it('E1 infantry movement: cells/sec at default speed', () => {
    const stats = UNIT_STATS[UnitType.I_E1];
    const pxPerTick = stats.speed * MPH_TO_PX;
    const cellsPerSec = (pxPerTick * GAME_TICKS_PER_SEC) / CELL_SIZE;
    // E1 Speed=4: 4 * 0.09375 * 20 / 24 = 0.3125 cells/sec
    expect(cellsPerSec).toBeCloseTo(0.3125, 3);
  });

  it('tickInterval is 50ms (1000/20)', () => {
    const tickInterval = 1000 / GAME_TICKS_PER_SEC;
    expect(tickInterval).toBe(50);
  });

  it('rotation speed: 1TNK full rotation time matches C++ at 20fps', () => {
    const stats = UNIT_STATS[UnitType.V_1TNK];
    // ROT=5: accumulates 5 per tick, advances 1 of 32 steps when accumulator >= 8
    // Effective rate: rot/8 steps per tick = 5/8 = 0.625 steps/tick
    // Full rotation (32 steps): 32 / 0.625 = 51.2 ticks = 2.56 seconds at 20fps
    // C++ has 256-direction system: 256/rot = 256/5 = 51.2 ticks — same!
    const stepsPerTick = stats.rot / 8;
    const fullRotationTicks = 32 / stepsPerTick;
    const fullRotationSec = fullRotationTicks / GAME_TICKS_PER_SEC;
    expect(fullRotationTicks).toBeCloseTo(51.2, 1);
    expect(fullRotationSec).toBeCloseTo(2.56, 2);
  });
});
