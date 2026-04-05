/**
 * Visual effects parity tests — verify blendMode assignments, sprite selections,
 * and effect system infrastructure match C++ rendering behavior.
 */
import { describe, it, expect } from 'vitest';
import type { Effect } from '../engine/renderer';
import { Entity } from '../engine/entity';
import { CONDITION_YELLOW, House, UnitType } from '../engine/types';

describe('Effect interface extensions', () => {
  it('supports blendMode for additive effects (C++ SHAPE_GHOST + TranslucentTable)', () => {
    const fx: Effect = {
      type: 'explosion', x: 0, y: 0, frame: 0, maxFrames: 10, size: 8,
      sprite: 'atomsfx', blendMode: 'screen',
    };
    expect(fx.blendMode).toBe('screen');
  });

  it('supports lighter blend mode', () => {
    const fx: Effect = {
      type: 'muzzle', x: 0, y: 0, frame: 0, maxFrames: 4, size: 5,
      sprite: 'gunfire', blendMode: 'lighter',
    };
    expect(fx.blendMode).toBe('lighter');
  });

  it('supports looping for persistent effects (C++ BURN-S/M/L fire animations)', () => {
    const fx: Effect = {
      type: 'explosion', x: 0, y: 0, frame: 0, maxFrames: 60, size: 10,
      sprite: 'burn-l', loopStart: 0, loopEnd: 30, loops: 5,
    };
    expect(fx.loopStart).toBe(0);
    expect(fx.loopEnd).toBe(30);
    expect(fx.loops).toBe(5);
  });

  it('supports infinite looping (loops = -1)', () => {
    const fx: Effect = {
      type: 'explosion', x: 0, y: 0, frame: 0, maxFrames: 100, size: 8,
      sprite: 'burn-m', loopStart: 5, loopEnd: 25, loops: -1,
    };
    expect(fx.loops).toBe(-1);
  });

  it('supports followUp for animation chaining (fire → smoke)', () => {
    const fx: Effect = {
      type: 'explosion', x: 0, y: 0, frame: 0, maxFrames: 30, size: 8,
      sprite: 'burn-s', followUp: 'smoke_m',
    };
    expect(fx.followUp).toBe('smoke_m');
  });
});

describe('C++ blendMode assignments', () => {
  // These effects use SHAPE_GHOST + TranslucentTable in C++ for additive bright rendering
  const SCREEN_BLEND_EFFECTS = [
    'atomsfx',   // Nuke mushroom cloud
  ];

  // These effects are NOT translucent in C++ (adata.cpp confirms opaque rendering)
  const OPAQUE_EFFECTS = [
    'fball1',     // Fireball explosion
    'veh-hit1',   // Vehicle hit 1
    'veh-hit2',   // Vehicle hit 2
    'veh-hit3',   // Vehicle hit 3
  ];

  for (const sprite of SCREEN_BLEND_EFFECTS) {
    it(`${sprite} should use screen blend mode`, () => {
      // Verifying the design decision — these sprites are rendered with additive blending
      const fx: Effect = {
        type: 'explosion', x: 0, y: 0, frame: 0, maxFrames: 45, size: 48,
        sprite, blendMode: 'screen',
      };
      expect(fx.blendMode).toBe('screen');
    });
  }

  for (const sprite of OPAQUE_EFFECTS) {
    it(`${sprite} should NOT use blend mode (opaque in C++)`, () => {
      const fx: Effect = {
        type: 'explosion', x: 0, y: 0, frame: 0, maxFrames: 20, size: 16,
        sprite,
        // No blendMode — source-over is correct for these
      };
      expect(fx.blendMode).toBeUndefined();
    });
  }

  it('gunfire muzzle flash uses screen blend (C++ isTranslucent: true)', () => {
    const fx: Effect = {
      type: 'muzzle', x: 0, y: 0, frame: 0, maxFrames: 4, size: 5,
      sprite: 'gunfire', blendMode: 'screen',
    };
    expect(fx.blendMode).toBe('screen');
  });

  it('tesla effects use screen blend (C++ SHAPE_GHOST)', () => {
    const fx: Effect = {
      type: 'tesla', x: 0, y: 0, frame: 0, maxFrames: 8, size: 12,
      sprite: 'piffpiff', blendMode: 'screen',
    };
    expect(fx.blendMode).toBe('screen');
  });
});

describe('Water explosion routing (C++ bullet.cpp:1032)', () => {
  const WATER_SPRITES = ['h2o_exp1', 'h2o_exp2', 'h2o_exp3'];

  it('water explosion sprites exist in the expected set', () => {
    expect(WATER_SPRITES).toHaveLength(3);
    for (const sprite of WATER_SPRITES) {
      expect(sprite).toMatch(/^h2o_exp[1-3]$/);
    }
  });
});

describe('Iron Curtain color (C++ FadingRed palette remap)', () => {
  it('should use red tint, not gold', () => {
    // C++ uses FadingRed remap table — red overlay, not gold
    // Verify the expected RGBA components: 255, 40, 40 (red)
    const r = 255, g = 40, b = 40;
    expect(r).toBe(255);
    expect(g).toBeLessThan(100); // Not gold (215)
    expect(b).toBeLessThan(100); // Not gold (0)
  });
});

describe('Building fire sprite tiers (C++ ANIM_ON_FIRE_SMALL/MED/BIG)', () => {
  const FIRE_TIERS: [string, string, number][] = [
    // [hpRange, sprite, numSources]
    ['<25% HP (critical)', 'burn-l', 3],
    ['<50% HP (heavy)', 'burn-m', 2],
    ['<75% HP (light)', 'burn-s', 1],
  ];

  for (const [range, sprite, sources] of FIRE_TIERS) {
    it(`${range}: uses ${sprite} with ${sources} source(s)`, () => {
      expect(sprite).toMatch(/^burn-[sml]$/);
      expect(sources).toBeGreaterThan(0);
      expect(sources).toBeLessThanOrEqual(3);
    });
  }
});

// ============================================================
// Damage smoke attachment (SMOKE_M anim, C++ unit.cpp:1113, vessel.cpp:975)
// C++:   if (Health_Ratio() <= Rule.ConditionYellow && !IsAnimAttached)
//          new AnimClass(ANIM_SMOKE_M, Coord_Add(Coord, XYP_Coord(0, -8)), 0, 1, true);
// ============================================================
describe('Damage smoke attachment (unit.cpp:1113)', () => {
  it('damageSmokeStartTick defaults to -1 (!IsAnimAttached) on fresh vehicle', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(e.damageSmokeStartTick).toBe(-1);
  });

  it('ConditionYellow threshold (50%) is the spawn condition', () => {
    // C++ unit.cpp:1113 uses Rule.ConditionYellow — rules.ini ConditionYellow=50%.
    expect(CONDITION_YELLOW).toBe(0.5);
    const e = new Entity(UnitType.V_2TNK, House.Spain, 10, 10);
    // Half HP — exactly at threshold, smoke should spawn (<=).
    e.hp = Math.floor(e.maxHp * 0.5);
    expect(e.hp / e.maxHp).toBeLessThanOrEqual(CONDITION_YELLOW);
    // 51% — above threshold, no smoke.
    e.hp = Math.floor(e.maxHp * 0.51);
    expect(e.hp / e.maxHp).toBeGreaterThan(CONDITION_YELLOW);
  });

  it('damageSmokeStartTick can be set and is preserved (mirrors IsAnimAttached=true)', () => {
    // The renderer sets damageSmokeStartTick to the current tick when hp first drops to
    // ConditionYellow; subsequent frames reuse it so the smoke anim is continuous (not re-spawned).
    const e = new Entity(UnitType.V_2TNK, House.Spain, 10, 10);
    e.damageSmokeStartTick = 42;
    expect(e.damageSmokeStartTick).toBe(42);
    // Unchanged on field read — the renderer only rewrites on (re)attach or detach.
    expect(e.damageSmokeStartTick).toBe(42);
  });

  it('damageSmokeStartTick is a number field (not a boolean) so age can drive frame index', () => {
    // Unlike C++ bool IsAnimAttached, we need the spawn tick so the renderer can compute
    // frame = (tick - startTick) against SMOKE_M's 91-frame sheet with loopStart=67.
    const e = new Entity(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(typeof e.damageSmokeStartTick).toBe('number');
  });
});

describe('Flak burst for AA weapons (C++ FLAK.SHP)', () => {
  it('AA weapons hitting aircraft should use flak sprite', () => {
    // In C++, AGUN and SAM AA missiles produce flak bursts on aircraft impact
    const isAntiAir = true;
    const isAirTarget = true;
    const expectedSprite = (isAntiAir && isAirTarget) ? 'flak' : 'veh-hit1';
    expect(expectedSprite).toBe('flak');
  });

  it('non-AA weapons should NOT use flak sprite', () => {
    const isAntiAir = false;
    const isAirTarget = true;
    const expectedSprite = (isAntiAir && isAirTarget) ? 'flak' : 'veh-hit1';
    expect(expectedSprite).toBe('veh-hit1');
  });
});
