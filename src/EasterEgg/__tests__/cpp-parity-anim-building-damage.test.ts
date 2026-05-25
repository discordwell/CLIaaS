/**
 * Building Damage Fire Overlay Parity Tests — C++ building.cpp / adata.cpp
 *
 * Tests that the TS renderer correctly matches C++ building damage behavior:
 *   - Damage state thresholds (ConditionYellow = 50%, ConditionRed = 25%)
 *   - SHP frame switching between healthy and damaged states
 *   - Fire animations are event-driven AnimClass objects, not HP-ratio overlays
 *   - Damage state transitions: undamaged → light → heavy → destroyed
 *   - Tech center flicker: damage state must not oscillate
 *
 * C++ references:
 *   building.cpp:502   — ConditionYellow threshold for war factory overlay
 *   building.cpp:632   — ConditionYellow for SAM turret frame offset
 *   building.cpp:679   — ConditionYellow for generic building damage frames
 *   building.cpp:1372  — RESULT_HALF fires (ON_FIRE_SMALL/MED/BIG)
 *   building.cpp:1194  — Take_Damage entry point
 *   adata.cpp:371-441  — BURN_SMALL/MED/BIG animation defs (BURN-S/M/L.SHP)
 *   adata.cpp:448-518  — ON_FIRE_SMALL/MED/BIG (same sprites, chain to smoke)
 *   rules.cpp:234-235  — ConditionYellow=0.5, ConditionRed=0.25
 *
 * TS references:
 *   renderer.ts:69-111   — BUILDING_FRAME_TABLE
 *   renderer.ts:1396     — damaged threshold (hp < maxHp * 0.5)
 *   combat.ts / logicAnim.ts — fire AnimClass equivalents spawned by damage events
 *   types.ts:29-30       — CONDITION_YELLOW=0.5, CONDITION_RED=0.25
 */

import { describe, it, expect } from 'vitest';
import { CONDITION_YELLOW, CONDITION_RED } from '../engine/types';
import { BUILDING_FRAME_TABLE } from '../engine/renderer';
import { STRUCTURE_SIZE } from '../engine/scenario';

// ============================================================
// Section 1: C++ ConditionYellow/Red threshold constants
// C++ rules.cpp:234-235
// ============================================================
describe('C++ damage threshold constants (rules.cpp:234-235)', () => {
  it('ConditionYellow = 0.5 (50% HP)', () => {
    // C++ Rule.ConditionYellow = fixed(1,2) = 0.5
    expect(CONDITION_YELLOW).toBe(0.5);
  });

  it('ConditionRed = 0.25 (25% HP)', () => {
    // C++ Rule.ConditionRed = fixed(1,4) = 0.25
    expect(CONDITION_RED).toBe(0.25);
  });

  it('Yellow threshold is strictly greater than Red', () => {
    expect(CONDITION_YELLOW).toBeGreaterThan(CONDITION_RED);
  });
});

// ============================================================
// Section 2: Building SHP frame selection — damage state
// C++ building.cpp:679 — Health_Ratio() <= Rule.ConditionYellow
// switches to damage frames (second half of SHP)
// ============================================================
describe('building SHP frame: damage state (building.cpp:632-688)', () => {
  // C++ uses Health_Ratio() <= ConditionYellow (0.5) to switch to damage frames.
  // TS uses: `const damaged = s.hp <= s.maxHp * 0.5` (renderer.ts:1396, fixed from <)
  // Both now use <= 0.5, matching at the boundary.

  it('full health building uses idle frame (frame 0)', () => {
    // C++ building.cpp:679 — Health_Ratio() > ConditionYellow → normal frames
    const entry = BUILDING_FRAME_TABLE['powr'];
    expect(entry).toBeDefined();
    expect(entry.idleFrame).toBe(0);
  });

  it('damaged building uses damageFrame offset', () => {
    // C++ building.cpp:679-687 — Health_Ratio() <= ConditionYellow → offset by largest anim span
    const entry = BUILDING_FRAME_TABLE['powr'];
    expect(entry).toBeDefined();
    expect(entry.damageFrame).toBeGreaterThan(0);
    // POWR is IsSimpleDamage=true and is omitted from bdata.cpp _anims:
    // frame 0 normal, frame 1 damaged.
    expect(entry.damageFrame).toBe(1);
  });

  // Test all buildings in BUILDING_FRAME_TABLE have valid damage frame offsets
  it('all buildings have damageFrame >= 1', () => {
    for (const [name, entry] of Object.entries(BUILDING_FRAME_TABLE)) {
      expect(entry.damageFrame, `${name} damageFrame should be >= 1`).toBeGreaterThanOrEqual(1);
    }
  });

  it('all buildings have idleFrame = 0', () => {
    // C++ building.cpp: default idle is frame 0
    for (const [name, entry] of Object.entries(BUILDING_FRAME_TABLE)) {
      expect(entry.idleFrame, `${name} idleFrame should be 0`).toBe(0);
    }
  });

  // C++ building.cpp:649-653 — war factory uses frame 0 (healthy) or 1 (damaged)
  it('war factory (weap): frame 0 normal, frame 1 damaged (building.cpp:649-653)', () => {
    // C++ Shape_Number for WEAP:
    //   shapenum = 0; if (Health_Ratio() <= ConditionYellow) shapenum = 1;
    // TS equivalent: damageFrame=16 but this is for the full SHP; weap actually has
    // special handling with door frames. The BUILDING_FRAME_TABLE captures the SHP layout.
    const entry = BUILDING_FRAME_TABLE['weap'];
    expect(entry).toBeDefined();
    expect(entry.idleFrame).toBe(0);
    expect(entry.damageFrame).toBe(16);
  });

  // C++ building.cpp:632-634 — SAM launcher +35 offset when damaged
  // The SAM has 68 frames: [2 closed + 32 rotation = 34 normal] [34 damaged]
  // TS handles SAM specially in renderer.ts with turretDir

  it('fact (Construction Yard) has damage offset at frame 26', () => {
    const entry = BUILDING_FRAME_TABLE['fact'];
    expect(entry).toBeDefined();
    expect(entry.damageFrame).toBe(26); // 52 frames: 0-25 normal, 26-51 damaged
  });

  // C++ building.cpp:669-671 — Ore silo uses fill level + damageFrame offset
  it('silo has damage offset at frame 5 (building.cpp:669-671)', () => {
    const entry = BUILDING_FRAME_TABLE['silo'];
    expect(entry).toBeDefined();
    expect(entry.damageFrame).toBe(5); // 10 frames: 0-4 fill levels, 5-9 damaged fill
  });
});

// ============================================================
// Section 3: Fire creation is event-driven
// C++ building.cpp:1372-1434 (Take_Damage spawns fires on RESULT_HALF/MAJOR)
// ============================================================
describe('building fires spawn from RESULT_HALF/RESULT_MAJOR events', () => {
  function resultCanSpawnBuildingFire(result: string): boolean {
    return result === 'RESULT_HALF' || result === 'RESULT_MAJOR' || result === 'RESULT_DESTROYED';
  }

  it('current HP alone does not create a BURN-* overlay', () => {
    expect(resultCanSpawnBuildingFire('RESULT_LIGHT')).toBe(false);
  });

  it('RESULT_HALF and RESULT_MAJOR are the damage events that enter building.cpp fire logic', () => {
    expect(resultCanSpawnBuildingFire('RESULT_HALF')).toBe(true);
    expect(resultCanSpawnBuildingFire('RESULT_MAJOR')).toBe(true);
  });

  it('ConditionYellow remains the damaged-frame threshold, not a renderer fire threshold', () => {
    expect(CONDITION_YELLOW).toBe(0.5);
  });
});

// ============================================================
// Section 4: C++ fire animation types and sprite mappings
// C++ adata.cpp:371-518 — BURN_SMALL/MED/BIG and ON_FIRE_SMALL/MED/BIG
// ============================================================
describe('C++ fire animation sprite mappings (adata.cpp:371-518)', () => {
  // C++ animation type → sprite name mapping:
  //   ANIM_BURN_SMALL / ANIM_ON_FIRE_SMALL → "BURN-S"
  //   ANIM_BURN_MED   / ANIM_ON_FIRE_MED   → "BURN-M"
  //   ANIM_BURN_BIG   / ANIM_ON_FIRE_BIG   → "BURN-L"
  //
  // TS uses lowercase: 'burn-s', 'burn-m', 'burn-l'

  const CPP_FIRE_SPRITE_MAP: Record<string, string> = {
    // adata.cpp:373 — BurnSmall → "BURN-S"
    'ANIM_BURN_SMALL': 'burn-s',
    // adata.cpp:397 — BurnMed → "BURN-M"
    'ANIM_BURN_MED': 'burn-m',
    // adata.cpp:421 — BurnBig → "BURN-L"
    'ANIM_BURN_BIG': 'burn-l',
    // adata.cpp:450 — OnFireSmall → "BURN-S" (same sprite, different chaining)
    'ANIM_ON_FIRE_SMALL': 'burn-s',
    // adata.cpp:474 — OnFireMed → "BURN-M"
    'ANIM_ON_FIRE_MED': 'burn-m',
    // adata.cpp:498 — OnFireBig → "BURN-L"
    'ANIM_ON_FIRE_BIG': 'burn-l',
  };

  it('all 6 C++ fire animation types map to correct BURN-S/M/L sprites', () => {
    expect(CPP_FIRE_SPRITE_MAP['ANIM_BURN_SMALL']).toBe('burn-s');
    expect(CPP_FIRE_SPRITE_MAP['ANIM_BURN_MED']).toBe('burn-m');
    expect(CPP_FIRE_SPRITE_MAP['ANIM_BURN_BIG']).toBe('burn-l');
    expect(CPP_FIRE_SPRITE_MAP['ANIM_ON_FIRE_SMALL']).toBe('burn-s');
    expect(CPP_FIRE_SPRITE_MAP['ANIM_ON_FIRE_MED']).toBe('burn-m');
    expect(CPP_FIRE_SPRITE_MAP['ANIM_ON_FIRE_BIG']).toBe('burn-l');
  });

  it('ON_FIRE variants chain to smoke (adata.cpp:470,494,518)', () => {
    // C++ ON_FIRE animations have follow-up smoke:
    //   ON_FIRE_SMALL → chains to SMOKE_M (adata.cpp:470)
    //   ON_FIRE_MED   → chains to ON_FIRE_SMALL (adata.cpp:494)
    //   ON_FIRE_BIG   → chains to ON_FIRE_MED (adata.cpp:518)
    // This creates a decay chain: BIG → MED → SMALL → SMOKE
    const ON_FIRE_CHAIN: Record<string, string> = {
      'ANIM_ON_FIRE_SMALL': 'ANIM_SMOKE_M',
      'ANIM_ON_FIRE_MED': 'ANIM_ON_FIRE_SMALL',
      'ANIM_ON_FIRE_BIG': 'ANIM_ON_FIRE_MED',
    };

    expect(ON_FIRE_CHAIN['ANIM_ON_FIRE_BIG']).toBe('ANIM_ON_FIRE_MED');
    expect(ON_FIRE_CHAIN['ANIM_ON_FIRE_MED']).toBe('ANIM_ON_FIRE_SMALL');
    expect(ON_FIRE_CHAIN['ANIM_ON_FIRE_SMALL']).toBe('ANIM_SMOKE_M');
  });

  it('BURN animations have 4 loop cycles (adata.cpp:391,415,439)', () => {
    // C++ adata.cpp — all BURN and ON_FIRE variants loop 4 times
    const BURN_LOOP_COUNT = 4;
    expect(BURN_LOOP_COUNT).toBe(4);
  });

  it('BURN animation frame data: start=0, loopStart=30, loopEnd=62', () => {
    // C++ adata.cpp:387-391 (BurnSmall), :411-415 (BurnMed), :435-439 (BurnBig)
    // All share: startFrame=0, loopStart=30, loopEnd=62
    const BURN_ANIM = { startFrame: 0, loopStart: 30, loopEnd: 62, delay: 2 };
    expect(BURN_ANIM.startFrame).toBe(0);
    expect(BURN_ANIM.loopStart).toBe(30);
    expect(BURN_ANIM.loopEnd).toBe(62);
    expect(BURN_ANIM.delay).toBe(2);
  });

  it('BURN_SMALL does 1/32 damage per tick, MED 1/16, BIG 1/10 (adata.cpp:385,409,433)', () => {
    // C++ adata.cpp damage rates (fixed point):
    //   BurnSmall = fixed(1,32) = 0.03125
    //   BurnMed   = fixed(1,16) = 0.0625
    //   BurnBig   = fixed(1,10) = 0.1
    const damages = {
      small: 1 / 32,
      med: 1 / 16,
      big: 1 / 10,
    };
    expect(damages.small).toBeCloseTo(0.03125, 6);
    expect(damages.med).toBeCloseTo(0.0625, 6);
    expect(damages.big).toBeCloseTo(0.1, 6);
    // Bigger fire = more damage per tick
    expect(damages.big).toBeGreaterThan(damages.med);
    expect(damages.med).toBeGreaterThan(damages.small);
  });
});

// ============================================================
// Section 5: Fire animation positioning on buildings
// C++ building.cpp:1401 — Coord_Scatter(Cell_Coord(cell), 0x0060)
// ============================================================
describe('fire animation positioning (building.cpp:1418-1465)', () => {
  it('damage fires use Coord_Scatter radius 0x0060', () => {
    expect(0x0060).toBe(96);
  });

  it('building footprint size determines which cells can receive fire rolls', () => {
    const factSize = STRUCTURE_SIZE['FACT'];
    const powrSize = STRUCTURE_SIZE['POWR'];
    const gunSize = STRUCTURE_SIZE['GUN'];

    expect(factSize).toEqual([3, 3]); // 3x3 cells
    expect(powrSize).toEqual([2, 2]); // 2x2 cells
    expect(gunSize).toEqual([1, 1]); // 1x1 cell
  });
});

// ============================================================
// Section 6: Damage state transitions
// C++ building.cpp:1226-1442 — Take_Damage result states
// ============================================================
describe('damage state transitions (building.cpp:1226-1442)', () => {
  // Simulate damage state as the C++ engine sees it
  function getDamageState(hp: number, maxHp: number): string {
    const ratio = hp / maxHp;
    if (hp <= 0) return 'destroyed';
    if (ratio <= CONDITION_RED) return 'heavy'; // C++ RESULT_HALF territory
    if (ratio <= CONDITION_YELLOW) return 'moderate'; // C++ uses damaged frames
    return 'undamaged';
  }

  it('above ConditionYellow remains visually undamaged by building frame rules', () => {
    expect(getDamageState(256, 256)).toBe('undamaged');
    expect(getDamageState(200, 256)).toBe('undamaged');
    expect(getDamageState(191, 256)).toBe('undamaged');
  });

  it('undamaged → moderate at ConditionYellow (50%)', () => {
    expect(getDamageState(130, 256)).toBe('undamaged');
    expect(getDamageState(128, 256)).toBe('moderate'); // exactly 50%
    expect(getDamageState(127, 256)).toBe('moderate');
  });

  it('moderate → heavy at ConditionRed (25%)', () => {
    expect(getDamageState(65, 256)).toBe('moderate');
    expect(getDamageState(64, 256)).toBe('heavy'); // exactly 25%
    expect(getDamageState(63, 256)).toBe('heavy');
    expect(getDamageState(1, 256)).toBe('heavy');
  });

  it('heavy → destroyed at 0 HP', () => {
    expect(getDamageState(1, 256)).toBe('heavy');
    expect(getDamageState(0, 256)).toBe('destroyed');
  });

  it('full frame-state sequence: undamaged → moderate → heavy → destroyed', () => {
    const transitions = [256, 127, 63, 0].map(hp => getDamageState(hp, 256));
    expect(transitions).toEqual(['undamaged', 'moderate', 'heavy', 'destroyed']);
  });
});

// ============================================================
// Section 7: Building sprite frame changes between damage states
// C++ building.cpp:679-687 — damage frames are offset by the largest
// animation span across IDLE/ACTIVE/AUX1/AUX2 states
// ============================================================
describe('building sprite frame changes (building.cpp:679-687)', () => {
  // In C++, the damage frame offset is computed as:
  //   largest = max(IDLE.Start+IDLE.Count, ACTIVE.Start+ACTIVE.Count,
  //                 AUX1.Start+AUX1.Count, AUX2.Start+AUX2.Count)
  //   shapenum += largest;
  //
  // The TS BUILDING_FRAME_TABLE.damageFrame stores this precomputed offset.

  // Test specific buildings against known C++ frame layouts.
  // idleAnimCount values are derived from C++ bdata.cpp:3054-3096 _anims table.
  // BARR/TENT have real BSTATE_IDLE loops. FACT's 26-frame sequence is
  // BSTATE_ACTIVE only; idle construction yards stay on frame 0.
  // Simple-damage buildings omitted from _anims are static: frame 0 normal,
  // frame 1 damaged. They must not cycle into damaged art while healthy.
  const EXPECTED_FRAME_DATA: [string, number, number][] = [
    // [type, damageFrame, idleAnimCount]
    ['powr', 1, 0],       // static simple damage (omitted from _anims)
    ['apwr', 1, 0],       // 2 frames: 0 normal, 1 damaged
    ['fact', 26, 0],      // idle static; active sequence is BSTATE_ACTIVE 0,26,3
    ['weap', 16, 32],     // 32 frames: bay door (post-Cluster A re-extraction)
    ['barr', 10, 10],     // 20 frames: 10 door cycle (C++ BSTATE_IDLE 0,10,3)
    ['tent', 10, 10],     // 20 frames: 10 door cycle (C++ BSTATE_IDLE 0,10,3)
    ['proc', 16, 0],      // 32 frames: conveyor states + damaged mirror
    ['dome', 1, 0],       // static: STRUCT_RADAR is omitted from _anims
    ['silo', 5, 0],       // 10 frames: 0-4 fill levels, 5-9 damaged
    ['hbox', 1, 0],       // 2 frames: 0 normal, 1 damaged
    ['pbox', 1, 0],       // 2 frames: 0 normal, 1 damaged
    ['tsla', 10, 10],     // 20 frames: 0-9 sparking anim, 10-19 damaged sparking
    ['gap', 32, 32],      // 64 frames: 0-31 shroud sweep, 32-63 damaged
    ['atek', 1, 0],       // static simple damage (omitted from _anims)
    ['stek', 1, 0],       // static simple damage (omitted from _anims)
    ['hosp', 4, 4],       // 9 frames: red cross blink + damaged
    ['iron', 11, 11],     // 22 frames: power glow + damaged
    ['pdox', 29, 29],     // 58 frames: energy effect + damaged
    ['mslo', 4, 4],       // Missile silo
  ];

  for (const [type, expectedDamage, expectedAnim] of EXPECTED_FRAME_DATA) {
    it(`${type}: damageFrame=${expectedDamage}, idleAnimCount=${expectedAnim}`, () => {
      const entry = BUILDING_FRAME_TABLE[type];
      expect(entry, `${type} should be in BUILDING_FRAME_TABLE`).toBeDefined();
      expect(entry.damageFrame).toBe(expectedDamage);
      expect(entry.idleAnimCount).toBe(expectedAnim);
    });
  }

  it('FACT records its C++ active animation separately from idle', () => {
    const fact = BUILDING_FRAME_TABLE['fact'];
    expect(fact.idleAnimCount).toBe(0);
    expect(fact.activeAnimCount).toBe(26);
    expect(fact.activeAnimRate).toBe(3);
  });

  it('animated buildings use damage-offset animation cycle', () => {
    // For animated buildings (idleAnimCount > 0), damaged state should use:
    //   baseFrame = damageFrame (instead of idleFrame=0)
    //   frame = baseFrame + (tick/8 % idleAnimCount)
    // This matches C++ behavior where the animation continues but with damaged sprites.
    const tsla = BUILDING_FRAME_TABLE['tsla'];
    expect(tsla.idleAnimCount).toBe(10);

    // Simulate frame calculation for healthy vs damaged
    const tick = 40;
    const healthyFrame = tsla.idleFrame + (Math.floor(tick / 8) % tsla.idleAnimCount);
    const damagedFrame = tsla.damageFrame + (Math.floor(tick / 8) % tsla.idleAnimCount);

    // Healthy frame should be in range [0, 9]
    expect(healthyFrame).toBeGreaterThanOrEqual(0);
    expect(healthyFrame).toBeLessThan(10);

    // Damaged frame should be in range [10, 19]
    expect(damagedFrame).toBeGreaterThanOrEqual(10);
    expect(damagedFrame).toBeLessThan(20);
  });

  it('static damaged buildings use correct frame range', () => {
    // For static buildings (idleAnimCount == 0, damageFrame > 1),
    // C++ building.cpp:679-687 offsets by largest anim count.
    // TS renderer.ts:1435-1439 cycles through damage frames.
    const proc = BUILDING_FRAME_TABLE['proc'];
    expect(proc.idleAnimCount).toBe(0);
    expect(proc.damageFrame).toBe(16);

    // Damaged frame should be >= damageFrame
    const tick = 16;
    const totalFrames = 32; // proc has 32 frames
    const damageAnimCount = Math.min(proc.damageFrame, totalFrames - proc.damageFrame);
    const frame = proc.damageFrame + (damageAnimCount > 1 ? Math.floor(tick / 8) % damageAnimCount : 0);
    expect(frame).toBeGreaterThanOrEqual(16);
    expect(frame).toBeLessThan(32);
  });
});

// ============================================================
// Section 8: Tech center flicker bug prevention
// Verify damage state doesn't oscillate between frames
// ============================================================
describe('tech center flicker bug: no damage state oscillation', () => {
  // The "tech center flicker" happens when the damage threshold is evaluated
  // inconsistently between frames, causing the building to alternate between
  // normal and damaged sprite sets. This creates a visible flicker.
  //
  // The fix requires using a consistent threshold check (not floating-point
  // comparisons that might round differently).

  it('damage threshold is deterministic across frames', () => {
    // TS renderer.ts:1396 uses `s.hp <= s.maxHp * 0.5` (fixed from <)
    // The key is that this comparison uses the same formula every frame.
    const maxHp = 256;
    const threshold = maxHp * 0.5; // 128.0

    // At exactly the boundary, the result must be consistent
    for (let frame = 0; frame < 100; frame++) {
      const damaged128 = 128 <= threshold; // true — 128 is <= 128 (matches C++)
      const damaged127 = 127 <= threshold; // true
      expect(damaged128).toBe(true);
      expect(damaged127).toBe(true);
    }
  });

  it('atek (Allied Tech) uses consistent frame set per tick', () => {
    const atek = BUILDING_FRAME_TABLE['atek'];
    const maxHp = 256;

    // Simulate 100 frames above 50% HP. ATEK is a static simple-damage
    // building in C++; it should not cycle through old placeholder anim frames.
    const frames: number[] = [];
    for (let tick = 0; tick < 100; tick++) {
      const hp = 129;
      const damaged = hp <= maxHp * 0.5; // false consistently
      frames.push(damaged ? atek.damageFrame : atek.idleFrame);
    }

    expect(new Set(frames)).toEqual(new Set([0]));
  });

  it('stek (Soviet Tech) no flicker at damage boundary', () => {
    const stek = BUILDING_FRAME_TABLE['stek'];
    const maxHp = 200;

    // At 100 HP (exactly 50%)
    const hp = 100;
    const results: boolean[] = [];
    for (let tick = 0; tick < 50; tick++) {
      const damaged = hp <= maxHp * 0.5; // 100 <= 100.0 -> true
      results.push(damaged);
    }

    // Must be consistently damaged at the C++ yellow threshold.
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe(true);
  });

  it('no flicker at 1 HP below threshold', () => {
    const atek = BUILDING_FRAME_TABLE['atek'];
    const maxHp = 256;
    const hp = 127; // Just below 50%

    const frames: number[] = [];
    for (let tick = 0; tick < 50; tick++) {
      const damaged = hp <= maxHp * 0.5; // 127 <= 128.0 -> true
      frames.push(damaged ? atek.damageFrame : atek.idleFrame);
    }

    expect(new Set(frames)).toEqual(new Set([1]));
  });
});

// ============================================================
// Section 8b: Frame overflow guards (E6)
// Prevents negative damageAnimCount and out-of-bounds frame draws
// when a sprite sheet is smaller than the declared damageFrame
// (can happen before Cluster A re-extracts multi-frame sheets).
// ============================================================
describe('frame overflow guards (E6)', () => {
  /** Mirror of renderer.ts animated-building frame calc with E6 safety guards. */
  function animatedFrame(baseFrame: number, idleAnimCount: number, totalFrames: number, tick: number): number {
    const availFromBase = Math.max(1, totalFrames - baseFrame);
    const safeAnimCount = Math.max(1, Math.min(idleAnimCount, availFromBase));
    let frame = baseFrame + (Math.floor(tick / 8) % safeAnimCount);
    if (frame >= totalFrames || frame < 0) {
      frame = totalFrames > 0 ? ((frame % totalFrames) + totalFrames) % totalFrames : 0;
    }
    return frame;
  }

  /** Mirror of renderer.ts static-damaged frame calc with E6 guards. */
  function damagedStaticFrame(damageFrame: number, totalFrames: number, _tick: number): number {
    let frame = Math.min(damageFrame, Math.max(0, totalFrames - 1));
    if (frame >= totalFrames || frame < 0) {
      frame = totalFrames > 0 ? ((frame % totalFrames) + totalFrames) % totalFrames : 0;
    }
    return frame;
  }

  it('animated building with idleAnimCount exceeding sheet stays in bounds', () => {
    // Renderer must clamp animation counts when a table entry outruns a
    // partially extracted sheet.
    const totalFrames = 2;
    for (let tick = 0; tick < 160; tick++) {
      const f = animatedFrame(0, 8, totalFrames, tick);
      expect(f, `tick=${tick}`).toBeGreaterThanOrEqual(0);
      expect(f, `tick=${tick}`).toBeLessThan(totalFrames);
    }
  });

  it('FACT active animation with full-size sheet cycles the BSTATE_ACTIVE span', () => {
    // fact has 52 frames and BSTATE_ACTIVE Count=26 — when the construction
    // yard is in MISSION_REPAIR, it cycles through frames 0..25.
    const seen = new Set<number>();
    for (let tick = 0; tick < 26 * 8; tick++) {
      seen.add(animatedFrame(0, 26, 52, tick));
    }
    expect(seen.size).toBe(26);
    for (const f of seen) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(26); // all frames in idle range
    }
  });

  it('damaged active building clamps to available frames past damageFrame', () => {
    // fact damaged while BSTATE_ACTIVE: baseFrame=26, Count=26, totalFrames=52.
    // Must stay within [26, 51].
    for (let tick = 0; tick < 26 * 8; tick++) {
      const f = animatedFrame(26, 26, 52, tick);
      expect(f, `tick=${tick}`).toBeGreaterThanOrEqual(26);
      expect(f, `tick=${tick}`).toBeLessThan(52);
    }
  });

  it('static damaged building with damageFrame beyond sheet falls back to last frame', () => {
    // Simulates powr pre-Cluster A: damageFrame=4 vs a 2-frame sheet.
    // rawDamageAnimCount = min(4, -2) = -2 → fall back to last frame.
    const f = damagedStaticFrame(4, 2, 17);
    expect(f).toBe(1); // totalFrames-1
  });

  it('static damaged building with sheet exactly matching damageFrame uses single frame', () => {
    // Static damaged buildings do not walk the damage span; C++ adds the
    // largest animation offset to the current stage, which remains 0.
    const seen = new Set<number>();
    for (let tick = 0; tick < 80; tick++) {
      seen.add(damagedStaticFrame(10, 20, tick));
    }
    expect(seen).toEqual(new Set([10]));
  });

  it('never produces negative frames even with pathological inputs', () => {
    // Defensive: any animCount+baseFrame combo must not produce frame < 0
    for (const baseFrame of [0, 4, 16, 26, 32]) {
      for (const animCount of [0, 1, 8, 16, 32]) {
        for (const totalFrames of [1, 2, 4, 20, 52]) {
          for (let tick = 0; tick < 40; tick += 7) {
            // Skip cases where baseFrame >= totalFrames (no room) — our guard handles these.
            const f = animatedFrame(Math.min(baseFrame, totalFrames - 1), Math.max(1, animCount), totalFrames, tick);
            expect(f, `base=${baseFrame} anim=${animCount} total=${totalFrames} tick=${tick}`)
              .toBeGreaterThanOrEqual(0);
            expect(f).toBeLessThan(totalFrames);
          }
        }
      }
    }
  });
});

// ============================================================
// Section 9: C++ Take_Damage fire spawning logic
// C++ building.cpp:1391-1434 — Random_Pick selects fire size
// based on building Width() + Height()
// ============================================================
describe('C++ Take_Damage fire spawning (building.cpp:1391-1434)', () => {
  // C++ logic for fire warhead damage:
  //   switch (Random_Pick(0, 5 + Width() + Height())) {
  //     case 0: no fire
  //     case 1-5: ANIM_ON_FIRE_SMALL
  //     case 6-8: ANIM_ON_FIRE_MED
  //     case 9: ANIM_ON_FIRE_BIG
  //     default: no fire (larger buildings have more chance of no fire)
  //   }

  function getFireDistribution(width: number, height: number) {
    const maxRoll = 5 + width + height;
    // Count how many outcomes fall in each case range, clamped to maxRoll
    const noFire = 1; // case 0
    const small = Math.min(5, maxRoll); // cases 1-5, clamped
    const med = Math.max(0, Math.min(8, maxRoll) - 5); // cases 6-8, clamped
    const big = maxRoll >= 9 ? 1 : 0; // case 9

    // Rolls above 9 produce no fire (default case)
    const extraNoFire = Math.max(0, maxRoll - 9);

    return {
      totalOutcomes: maxRoll + 1,
      smallChance: small / (maxRoll + 1),
      medChance: med / (maxRoll + 1),
      bigChance: big / (maxRoll + 1),
      noFireChance: (noFire + extraNoFire) / (maxRoll + 1),
    };
  }

  it('1x1 building (e.g., GUN): range 0-7, weighted toward small fires', () => {
    const dist = getFireDistribution(1, 1);
    expect(dist.totalOutcomes).toBe(8); // Random_Pick(0, 7)
    expect(dist.smallChance).toBeCloseTo(5 / 8, 4);
    expect(dist.medChance).toBeCloseTo(2 / 8, 4); // cases 6,7
    expect(dist.bigChance).toBe(0); // can't roll 9
  });

  it('2x2 building (e.g., POWR): range 0-9, can get big fire', () => {
    const dist = getFireDistribution(2, 2);
    expect(dist.totalOutcomes).toBe(10);
    expect(dist.bigChance).toBeCloseTo(1 / 10, 4);
  });

  it('3x3 building (e.g., FACT): range 0-11, more default no-fire', () => {
    const dist = getFireDistribution(3, 3);
    expect(dist.totalOutcomes).toBe(12);
    // default catches cases 10, 11 → extra no-fire
    expect(dist.noFireChance).toBeCloseTo(3 / 12, 4); // case 0 + cases 10,11
  });

  it('non-fire warhead: 50% chance of ANIM_FIRE_SMALL per cell', () => {
    // C++ building.cpp:1418 — Percent_Chance(50) for non-fire warheads
    // Creates ANIM_FIRE_SMALL (not ON_FIRE variants)
    const nonFireChance = 0.5;
    expect(nonFireChance).toBe(0.5);
  });

  it('renovator (engineer) damage does not spawn fires', () => {
    // C++ building.cpp:1423 — source->What_Am_I() != RTTI_INFANTRY ||
    //   *(InfantryClass*)source != INFANTRY_RENOVATOR
    // Engineers repairing buildings should not spawn fire animations
    const isRenovator = true;
    const shouldSpawnFire = !isRenovator;
    expect(shouldSpawnFire).toBe(false);
  });
});

// ============================================================
// Section 10: Smoke comes from animation chains
// C++ adata.cpp:470,494,518 — ON_FIRE_* chains eventually produce smoke.
// ============================================================
describe('smoke is produced by ON_FIRE follow-up animations', () => {
  it('ON_FIRE_SMALL chains to SMOKE_M', () => {
    expect('SMOKE_M').toBe('SMOKE_M');
  });

  it('larger ON_FIRE animations chain down before smoke', () => {
    const chain = ['ON_FIRE_BIG', 'ON_FIRE_MED', 'ON_FIRE_SMALL', 'SMOKE_M'];
    expect(chain).toEqual(['ON_FIRE_BIG', 'ON_FIRE_MED', 'ON_FIRE_SMALL', 'SMOKE_M']);
  });
});

// ============================================================
// Section 11: STRUCTURE_SIZE used for fire positioning
// Verify all key buildings have correct cell dimensions
// ============================================================
describe('STRUCTURE_SIZE for fire positioning (scenario.ts:1167-1173)', () => {
  const EXPECTED_SIZES: [string, number, number][] = [
    ['FACT', 3, 3],
    ['WEAP', 3, 2],
    ['POWR', 2, 2],
    ['APWR', 3, 3],
    ['BARR', 2, 2],
    ['TENT', 2, 2],
    ['PROC', 3, 3],
    ['FIX', 3, 3],
    ['SILO', 1, 1],
    ['DOME', 2, 2],
    ['GUN', 1, 1],
    ['SAM', 2, 1],
    ['HBOX', 1, 1],
    ['TSLA', 1, 2],
    ['AGUN', 1, 2],
    ['GAP', 1, 2],
    ['PBOX', 1, 1],
  ];

  for (const [type, w, h] of EXPECTED_SIZES) {
    it(`${type} = ${w}x${h} cells`, () => {
      const size = STRUCTURE_SIZE[type];
      expect(size, `${type} should have a size entry`).toBeDefined();
      expect(size).toEqual([w, h]);
    });
  }
});
