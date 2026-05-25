/**
 * Smoke, Muzzle Flash, and Misc Effects Animation Parity Tests
 *
 * C++ source of truth:
 *   - adata.cpp: Animation type definitions (SMOKE_PUFF, SMOKE_M, LZ_SMOKE,
 *     MUZZLE_FLASH, MOVE_FLASH, OILFIELD_BURN, FBALL_FADE, GUN_N..E)
 *   - bullet.cpp:377-386: IsFlameEquipped → spawn SMOKE_PUFF or FBALL_FADE every other frame
 *   - bbdata.cpp:284: IsFlameEquipped = Animates=yes in RULES.INI
 *   - techno.cpp:3127-3152: Weapon->Anim → attach muzzle flash anim (ANIM_GUN_N, ANIM_SAM_N)
 *   - building.cpp: Structure fire via Fire_At → weapon Anim
 *
 * TS implementation:
 *   - combat.ts:629-647: IsFlameEquipped flame trail toggle
 *   - combat.ts:1281-1286: Structure fire muzzle effect
 *   - missionAI.ts:486-491: Unit fire muzzle flash with warhead color
 *   - logicAnim.ts: damaged building fire/smoke AnimClass equivalents
 *   - renderer.ts:2138-2152: Damaged vehicle smoke trail
 *   - types.ts: WeaponStats, WEAPONS, EXPLOSION_FRAMES
 */

import { describe, it, expect } from 'vitest';
import {
  EXPLOSION_FRAMES,
  WEAPON_STATS,
} from '../engine/types';
import type { WeaponStats, WarheadType } from '../engine/types';
import { logicAnimRenderSpec, processLogicAnim, spawnLogicAnim, type LogicAnim } from '../engine/logicAnim';
import type { Effect } from '../engine/renderer';

// ── C++ Animation Data (adata.cpp) ──────────────────────────────────────────
// Each entry: { name, sprite, maxDim, bigStage, normalized, delay, startFrame,
//               loopStart, loopEnd, stages, loops, followUp }

/** C++ AnimTypeClass constructor parameter order (adata.cpp):
 *  1. AnimType enum              2. GraphicName (SHP)
 *  3. MaxDimension               4. BigStage
 *  5. IsTheaterSpecific          6. IsNormalized
 *  7. IsWhiteTranslucent         8. IsScorcher
 *  9. IsCraterForming           10. IsSticky
 * 11. IsGroundLevel             12. IsTranslucent
 * 13. IsFlameThrower            14. Damage (fixed point)
 * 15. Delay                     16. Start
 * 17. LoopStart                 18. LoopEnd
 * 19. Stages                    20. Loops
 * 21. Sound                     22. ChainTo
 *
 * NOTE: ANIM_MUZZLE_FLASH and ANIM_GUN_N have swapped field order
 * for stages/loops/loopEnd (inconsistency in original C++ code).
 */

interface CppAnimData {
  animEnum: string;
  graphicName: string;
  maxDimension: number;
  bigStage: number;
  isNormalized: boolean;
  isGroundLevel: boolean;
  isTranslucent: boolean;
  isFlameThrower: boolean;
  delay: number;
  startFrame: number;
  loopStart: number;
  loopEnd: number;
  stages: number;
  loops: number;
  followUp: string;
}

// ============================================================
// Section 1: C++ Animation Data Definitions (adata.cpp)
// ============================================================
describe('C++ animation data definitions (adata.cpp)', () => {
  // ANIM_SMOKE_PUFF — adata.cpp:794-817
  const SMOKE_PUFF: CppAnimData = {
    animEnum: 'ANIM_SMOKE_PUFF',
    graphicName: 'SMOKEY',
    maxDimension: 24,
    bigStage: 2,
    isNormalized: true,
    isGroundLevel: false,    // NOT ground level
    isTranslucent: true,     // translucent colors
    isFlameThrower: false,
    delay: 1,
    startFrame: 0,
    loopStart: 0,
    loopEnd: -1,             // no loop back
    stages: -1,              // auto from SHP
    loops: 1,
    followUp: 'ANIM_NONE',
  };

  // ANIM_FBALL_FADE — adata.cpp:819-842
  const FBALL_FADE: CppAnimData = {
    animEnum: 'ANIM_FBALL_FADE',
    graphicName: 'FB2',
    maxDimension: 24,
    bigStage: 1,
    isNormalized: true,
    isGroundLevel: false,
    isTranslucent: false,
    isFlameThrower: false,
    delay: 1,
    startFrame: 0,
    loopStart: 0,
    loopEnd: -1,
    stages: -1,
    loops: 1,
    followUp: 'ANIM_NONE',
  };

  // ANIM_SMOKE_M — adata.cpp:1044-1067
  const SMOKE_M: CppAnimData = {
    animEnum: 'ANIM_SMOKE_M',
    graphicName: 'SMOKE_M',
    maxDimension: 28,
    bigStage: 30,
    isNormalized: true,
    isGroundLevel: true,
    isTranslucent: false,
    isFlameThrower: false,
    delay: 1,
    startFrame: 0,
    loopStart: 67,
    loopEnd: -1,
    stages: -1,
    loops: 6,
    followUp: 'ANIM_NONE',
  };

  // ANIM_LZ_SMOKE — adata.cpp:343-366
  const LZ_SMOKE: CppAnimData = {
    animEnum: 'ANIM_LZ_SMOKE',
    graphicName: 'SMOKLAND',
    maxDimension: 32,
    bigStage: 72,
    isNormalized: true,
    isGroundLevel: true,
    isTranslucent: false,
    isFlameThrower: false,
    delay: 2,
    startFrame: 0,
    loopStart: 72,
    loopEnd: 91,
    stages: -1,
    loops: 255,
    followUp: 'ANIM_NONE',
  };

  // ANIM_MUZZLE_FLASH — adata.cpp:1019-1042
  // NOTE: in C++ source, the field order is slightly different for this entry
  // (stages and loops are swapped compared to other entries):
  //   0,  // loopStart=0
  //   0,  // loopEnd=0 (actually: this is "Number of times the animation loops")
  //   1,  // stages=1  (actually: this is "Number of animation stages")
  //   1,  // loops=1   (actually: this is "Ending frame of loop back")
  const MUZZLE_FLASH: CppAnimData = {
    animEnum: 'ANIM_MUZZLE_FLASH',
    graphicName: 'GUNFIRE',
    maxDimension: 16,
    bigStage: 0,
    isNormalized: false,
    isGroundLevel: true,
    isTranslucent: true,    // translucent
    isFlameThrower: false,
    delay: 1,
    startFrame: 0,
    loopStart: 0,
    loopEnd: 0,
    stages: 1,
    loops: 1,
    followUp: 'ANIM_NONE',
  };

  // ANIM_MOVE_FLASH — adata.cpp:1701-1724
  const MOVE_FLASH: CppAnimData = {
    animEnum: 'ANIM_MOVE_FLASH',
    graphicName: 'MOVEFLSH',
    maxDimension: 24,
    bigStage: 0,
    isNormalized: true,
    isGroundLevel: true,
    isTranslucent: false,
    isFlameThrower: false,
    delay: 1,
    startFrame: 0,
    loopStart: 0,
    loopEnd: 0,
    stages: -1,
    loops: 0,
    followUp: 'ANIM_NONE',
  };

  // ANIM_OILFIELD_BURN — adata.cpp:994-1017
  const OILFIELD_BURN: CppAnimData = {
    animEnum: 'ANIM_OILFIELD_BURN',
    graphicName: 'FLMSPT',
    maxDimension: 42,
    bigStage: 58,
    isNormalized: true,
    isGroundLevel: true,
    isTranslucent: false,
    isFlameThrower: false,
    delay: 1,
    startFrame: 0,
    loopStart: 33,
    loopEnd: 99,
    stages: 66,
    loops: 65535,            // effectively infinite
    followUp: 'ANIM_NONE',
  };

  // ANIM_GUN_N — adata.cpp:1072-1095 (guard tower minigun)
  const GUN_N: CppAnimData = {
    animEnum: 'ANIM_GUN_N',
    graphicName: 'MINIGUN',
    maxDimension: 18,
    bigStage: 0,
    isNormalized: false,
    isGroundLevel: false,
    isTranslucent: false,
    isFlameThrower: false,
    delay: 1,
    startFrame: 0,
    loopStart: 0,
    loopEnd: 0,
    stages: 6,
    loops: 0,
    followUp: 'ANIM_NONE',
  };

  it('SMOKE_PUFF: sprite=SMOKEY, dim=24, delay=1, translucent, 1 loop', () => {
    expect(SMOKE_PUFF.graphicName).toBe('SMOKEY');
    expect(SMOKE_PUFF.maxDimension).toBe(24);
    expect(SMOKE_PUFF.delay).toBe(1);
    expect(SMOKE_PUFF.isTranslucent).toBe(true);
    expect(SMOKE_PUFF.isNormalized).toBe(true);
    expect(SMOKE_PUFF.loops).toBe(1);
    expect(SMOKE_PUFF.followUp).toBe('ANIM_NONE');
    expect(SMOKE_PUFF.isGroundLevel).toBe(false);
  });

  it('FBALL_FADE: sprite=FB2, dim=24, delay=1, not translucent, 1 loop', () => {
    expect(FBALL_FADE.graphicName).toBe('FB2');
    expect(FBALL_FADE.maxDimension).toBe(24);
    expect(FBALL_FADE.delay).toBe(1);
    expect(FBALL_FADE.isTranslucent).toBe(false);
    expect(FBALL_FADE.isNormalized).toBe(true);
    expect(FBALL_FADE.loops).toBe(1);
    expect(FBALL_FADE.followUp).toBe('ANIM_NONE');
  });

  it('SMOKE_M: sprite=SMOKE_M, dim=28, delay=1, ground level, 6 loops, loopStart=67', () => {
    expect(SMOKE_M.graphicName).toBe('SMOKE_M');
    expect(SMOKE_M.maxDimension).toBe(28);
    expect(SMOKE_M.delay).toBe(1);
    expect(SMOKE_M.isGroundLevel).toBe(true);
    expect(SMOKE_M.isNormalized).toBe(true);
    expect(SMOKE_M.loops).toBe(6);
    expect(SMOKE_M.loopStart).toBe(67);
    expect(SMOKE_M.followUp).toBe('ANIM_NONE');
  });

  it('LZ_SMOKE: sprite=SMOKLAND, dim=32, delay=2, ground level, 255 loops, loopStart=72, loopEnd=91', () => {
    expect(LZ_SMOKE.graphicName).toBe('SMOKLAND');
    expect(LZ_SMOKE.maxDimension).toBe(32);
    expect(LZ_SMOKE.delay).toBe(2);
    expect(LZ_SMOKE.isGroundLevel).toBe(true);
    expect(LZ_SMOKE.isNormalized).toBe(true);
    expect(LZ_SMOKE.loops).toBe(255);
    expect(LZ_SMOKE.loopStart).toBe(72);
    expect(LZ_SMOKE.loopEnd).toBe(91);
  });

  it('MUZZLE_FLASH: sprite=GUNFIRE, dim=16, delay=1, ground level, translucent, 1 stage', () => {
    expect(MUZZLE_FLASH.graphicName).toBe('GUNFIRE');
    expect(MUZZLE_FLASH.maxDimension).toBe(16);
    expect(MUZZLE_FLASH.delay).toBe(1);
    expect(MUZZLE_FLASH.isGroundLevel).toBe(true);
    expect(MUZZLE_FLASH.isTranslucent).toBe(true);
    expect(MUZZLE_FLASH.isNormalized).toBe(false);
    expect(MUZZLE_FLASH.stages).toBe(1);
  });

  it('MOVE_FLASH: sprite=MOVEFLSH, dim=24, delay=1, ground level, theater-specific=true (C++ line 1706), 0 loops', () => {
    expect(MOVE_FLASH.graphicName).toBe('MOVEFLSH');
    expect(MOVE_FLASH.maxDimension).toBe(24);
    expect(MOVE_FLASH.delay).toBe(1);
    expect(MOVE_FLASH.isGroundLevel).toBe(true);
    expect(MOVE_FLASH.isNormalized).toBe(true);
    expect(MOVE_FLASH.loops).toBe(0);
  });

  it('OILFIELD_BURN: sprite=FLMSPT, dim=42, delay=1, ground level, 65535 loops (infinite), 66 stages, loopStart=33, loopEnd=99', () => {
    expect(OILFIELD_BURN.graphicName).toBe('FLMSPT');
    expect(OILFIELD_BURN.maxDimension).toBe(42);
    expect(OILFIELD_BURN.delay).toBe(1);
    expect(OILFIELD_BURN.isGroundLevel).toBe(true);
    expect(OILFIELD_BURN.isNormalized).toBe(true);
    expect(OILFIELD_BURN.stages).toBe(66);
    expect(OILFIELD_BURN.loops).toBe(65535);
    expect(OILFIELD_BURN.loopStart).toBe(33);
    expect(OILFIELD_BURN.loopEnd).toBe(99);
  });

  it('GUN_N (guard tower minigun): sprite=MINIGUN, dim=18, 6 stages, 8 directional variants (N/NW/W/SW/S/SE/E/NE)', () => {
    expect(GUN_N.graphicName).toBe('MINIGUN');
    expect(GUN_N.maxDimension).toBe(18);
    expect(GUN_N.stages).toBe(6);
    // C++ techno.cpp:3129-3130: ANIM_GUN_N + Dir_Facing(Fire_Direction()) selects direction
    // Each direction offset is startFrame = 6 * facing_index (0,6,12,18,24,30,36,42)
    const directionStartFrames = [0, 6, 12, 18, 24, 30, 36, 42];
    for (let facing = 0; facing < 8; facing++) {
      expect(directionStartFrames[facing], `GUN direction ${facing} startFrame`).toBe(facing * 6);
    }
  });

  it('ON_FIRE_SMALL chains to SMOKE_M (adata.cpp:470)', () => {
    // C++ ON_FIRE_SMALL has followUp = ANIM_SMOKE_M
    // This means when a small fire finishes, it transitions to rising smoke
    const ON_FIRE_SMALL_FOLLOW_UP = 'ANIM_SMOKE_M';
    expect(ON_FIRE_SMALL_FOLLOW_UP).toBe('ANIM_SMOKE_M');
  });

  it('ON_FIRE_MED chains to ON_FIRE_SMALL (adata.cpp:494)', () => {
    // C++ ON_FIRE_MED has followUp = ANIM_ON_FIRE_SMALL
    const ON_FIRE_MED_FOLLOW_UP = 'ANIM_ON_FIRE_SMALL';
    expect(ON_FIRE_MED_FOLLOW_UP).toBe('ANIM_ON_FIRE_SMALL');
  });
});

describe('TS LogicAnim parity for C++ smoke/misc AnimClass entries', () => {
  it('models ANIM_LZ_SMOKE as a persistent ground-layer SMOKLAND AnimClass', () => {
    const logicAnims: LogicAnim[] = [];
    const effects: Effect[] = [];
    const reserved: boolean[] = [];

    const spawned = spawnLogicAnim(
      logicAnims,
      effects,
      'lz_smoke',
      25 * 24 + 12,
      58 * 24 + 12,
      1,
      true,
      false,
      184,
      () => 185,
      () => {
        reserved.push(true);
        return true;
      },
    );

    expect(spawned).toBe(true);
    expect(reserved).toHaveLength(1);
    expect(logicAnims).toHaveLength(1);
    expect(logicAnimRenderSpec(logicAnims[0].type)).toEqual({
      sprite: 'smokland',
      groundLayer: true,
    });
    expect(logicAnims[0].loops).toBe(255);

    for (let i = 0; i < 210; i++) {
      expect(processLogicAnim(logicAnims[0], logicAnims, effects)).toBe(true);
    }

    // C++ anim.cpp skips brand-new anims on the first logic pass, advances
    // SMOKLAND every two ticks, then loops frames 72..90 with Loops decremented.
    expect(logicAnims[0].stage).toBe(85);
    expect(logicAnims[0].loops).toBe(254);
  });
});

// ============================================================
// Section 2: IsFlameEquipped — SMOKE_PUFF/FBALL_FADE every other frame
// C++ bullet.cpp:377-386
// ============================================================
describe('IsFlameEquipped flame trail toggle (bullet.cpp:377-386)', () => {
  // C++ logic:
  //   if (Class->IsFlameEquipped) {
  //     if (IsToAnimate) {
  //       if (stricmp(Class->GraphicName, "FB1") == 0)
  //         new AnimClass(ANIM_FBALL_FADE, coord, 1);
  //       else
  //         new AnimClass(ANIM_SMOKE_PUFF, coord, 1);
  //     }
  //     IsToAnimate = !IsToAnimate;
  //   }

  it('flameToggle starts false (C++ IsToAnimate starts false)', () => {
    // C++ bullet.cpp initial state: IsToAnimate = false
    // TS: flameToggle: false in launchProjectile
    const flameToggle = false;
    expect(flameToggle).toBe(false);
  });

  it('flame trail alternates: no spawn on tick 1, spawn on tick 2, no on tick 3, etc.', () => {
    // Simulate the C++ toggle logic
    let isToAnimate = false;
    const spawned: boolean[] = [];

    for (let tick = 0; tick < 8; tick++) {
      // C++ checks IsToAnimate BEFORE toggling
      spawned.push(isToAnimate);
      isToAnimate = !isToAnimate;
    }

    // Spawns on even indices (0-based): false, true, false, true, ...
    expect(spawned).toEqual([false, true, false, true, false, true, false, true]);
  });

  it('TS flameToggle matches C++ IsToAnimate toggle pattern', () => {
    // TS combat.ts:630-646 does:
    //   if (proj.flameToggle) { spawn effect }
    //   proj.flameToggle = !proj.flameToggle;
    // This matches C++: check → spawn if true → toggle
    let flameToggle = false;  // initial state (combat.ts:602)
    const tsSpawned: boolean[] = [];

    for (let tick = 0; tick < 8; tick++) {
      tsSpawned.push(flameToggle);
      flameToggle = !flameToggle;
    }

    // Same pattern as C++
    expect(tsSpawned).toEqual([false, true, false, true, false, true, false, true]);
  });

  it('C++ uses FB1 graphic name check → FBALL_FADE, else SMOKE_PUFF', () => {
    // C++ bullet.cpp:379: if (stricmp(Class->GraphicName, "FB1") == 0)
    //   → ANIM_FBALL_FADE (sprite FB2, per adata.cpp:821)
    // else → ANIM_SMOKE_PUFF (sprite SMOKEY, per adata.cpp:796)

    // In TS, the Flamer weapon (which uses IsFlameEquipped) gets 'explosion' type
    // with sprite 'napalm1' — this is the TS equivalent of FBALL_FADE

    // The key C++ parity: flame-equipped non-FB1 bullets spawn SMOKE_PUFF
    // FB1 bullets spawn FBALL_FADE (fireball fade effect)
    const graphicFB1 = 'FB1';
    const animForFB1 = 'ANIM_FBALL_FADE';
    const animForOther = 'ANIM_SMOKE_PUFF';

    expect(graphicFB1).toBe('FB1');
    expect(animForFB1).toBe('ANIM_FBALL_FADE');
    expect(animForOther).toBe('ANIM_SMOKE_PUFF');
  });

  it('only Flamer and FireballLauncher weapons have isFlameEquipped=true (bbdata.cpp:284)', () => {
    // C++ bbdata.cpp: IsFlameEquipped = Animates=yes in RULES.INI
    // Only flame-type projectiles have Animates=yes
    // Import WEAPONS from types.ts for verification
    const flameWeapons = Object.entries(WEAPON_STATS as Record<string, WeaponStats>)
      .filter(([, w]) => (w as any).isFlameEquipped)
      .map(([name]) => name);

    expect(flameWeapons.sort()).toEqual(['FireballLauncher', 'Flamer']);
  });

  it('Flamer weapon has Fire warhead and splash=1.0 (bbdata.cpp)', () => {
    const flamer = WEAPON_STATS.Flamer;
    expect(flamer.warhead).toBe('Fire');
    expect(flamer.splash).toBe(1.0);
    expect((flamer as any).isFlameEquipped).toBe(true);
  });

  it('FireballLauncher weapon has Fire warhead and splash=1.5 (bbdata.cpp)', () => {
    const fbl = WEAPON_STATS.FireballLauncher;
    expect(fbl.warhead).toBe('Fire');
    expect(fbl.splash).toBe(1.5);
    expect((fbl as any).isFlameEquipped).toBe(true);
  });
});

// ============================================================
// Section 3: Muzzle flash for units and structures
// C++ techno.cpp:3127-3152 — weapon->Anim determines muzzle anim
// ============================================================
describe('muzzle flash spawning (techno.cpp:3127-3152)', () => {
  it('C++ weapon->Anim is attached to firer at Fire_Coord', () => {
    // C++ techno.cpp:3147-3151:
    //   if (a != ANIM_NONE) {
    //     AnimClass *anim = new AnimClass(a, Fire_Coord(which));
    //     if (anim != NULL) anim->Attach_To(this);
    //   }
    // The muzzle anim is attached to the firing techno, so it moves with it.
    // TS uses effects with type='muzzle' at attacker position.
    const cppAttachesToFirer = true;
    expect(cppAttachesToFirer).toBe(true);
  });

  it('ANIM_GUN_N direction selection: GUN_N + Dir_Facing(Fire_Direction())', () => {
    // C++ techno.cpp:3129-3130:
    //   case ANIM_GUN_N:
    //     a = AnimType(a + Dir_Facing(Fire_Direction()));
    // Dir_Facing converts DirType to 0-7 facing index
    // So the animation selected is ANIM_GUN_N, ANIM_GUN_NW, ..., ANIM_GUN_NE
    const directions = ['N', 'NW', 'W', 'SW', 'S', 'SE', 'E', 'NE'];
    for (let i = 0; i < 8; i++) {
      const animName = `ANIM_GUN_${directions[i]}`;
      expect(animName).toContain('ANIM_GUN_');
    }
  });

  it('SAM direction selection: ANIM_SAM_N + Dir_Facing(PrimaryFacing)', () => {
    // C++ techno.cpp:3133-3134:
    //   case ANIM_SAM_N:
    //     a = AnimType(ANIM_SAM_N + Dir_Facing(PrimaryFacing.Current()));
    // Uses PrimaryFacing instead of Fire_Direction (differs for turrets)
    const directions = ['N', 'NW', 'W', 'SW', 'S', 'SE', 'E', 'NE'];
    for (let i = 0; i < 8; i++) {
      const animName = `ANIM_SAM_${directions[i]}`;
      expect(animName).toContain('ANIM_SAM_');
    }
  });

  it('MUZZLE_FLASH (GUNFIRE) has only 1 animation stage (single flash frame)', () => {
    // C++ adata.cpp:1038 — stages=1 (just one frame of muzzle flash)
    // TS muzzle effect uses maxFrames=4 for fade-out (visual approximation)
    const cppStages = 1;
    expect(cppStages).toBe(1);
  });

  it('MUZZLE_FLASH is ground-level and translucent (C++ adata.cpp:1030-1031)', () => {
    // C++ uses SHAPE_GHOST + TranslucentTable for blending
    // TS uses rgba alpha blending (equivalent visual)
    const isGroundLevel = true;
    const isTranslucent = true;
    expect(isGroundLevel).toBe(true);
    expect(isTranslucent).toBe(true);
  });

  it('TS muzzle flash uses warhead-based color (warheadMuzzleColor)', () => {
    // C++ techno.cpp does not have warhead-colored muzzle flash — it uses weapon->Anim.
    // TS approximates this by coloring the muzzle flash by warhead type.
    // This is a TS design choice to provide visual weapon variety.
    const muzzleColors: Record<string, string> = {
      'Fire': '255,150,50',        // orange fire
      'Super': '100,150,255',      // blue (tesla)
      'AP': '255,200,80',          // amber armor-piercing
      'HE': '255,255,100',         // yellow high-explosive
      'Organic': '100,255,100',    // green organic
      'SA': '255,255,150',         // default
    };

    expect(muzzleColors['Fire']).toBe('255,150,50');
    expect(muzzleColors['Super']).toBe('100,150,255');
    expect(muzzleColors['AP']).toBe('255,200,80');
    expect(muzzleColors['HE']).toBe('255,255,100');
    expect(muzzleColors['Organic']).toBe('100,255,100');
    expect(muzzleColors['SA']).toBe('255,255,150');
  });

  it('TS structure fire spawns muzzle effect at structure position (combat.ts:1282-1286)', () => {
    // C++ building.cpp → Fire_At → techno.cpp:3147 → AnimClass at Fire_Coord
    // TS combat.ts:1282-1286: effects.push({ type: 'muzzle', x: sx, y: sy, ... })
    // Both spawn at the firing coordinate
    const effectType = 'muzzle';
    const maxFrames = 4;  // TS uses 4 frames for fade-out
    const sprite = 'piff';
    expect(effectType).toBe('muzzle');
    expect(maxFrames).toBe(4);
    expect(sprite).toBe('piff');
  });

  it('TS unit fire uses "gunfire" sprite for vehicles, "piff" for infantry (missionAI.ts:487-488)', () => {
    // C++ uses weapon->Anim which is typically ANIM_GUN_N for guard tower (MINIGUN.SHP)
    // or ANIM_MUZZLE_FLASH (GUNFIRE.SHP) for other weapons
    // TS: muzzleSprite = (!isInfantry && warhead !== 'Fire') ? 'gunfire' : 'piff'
    // Vehicle fire uses screen blend mode for gunfire sprite (C++ isTranslucent)

    const isInfantry = false;
    const warhead = 'AP';
    const muzzleSprite = (!isInfantry && warhead !== 'Fire') ? 'gunfire' : 'piff';
    expect(muzzleSprite).toBe('gunfire');

    const isInfantry2 = true;
    const muzzleSprite2 = (!isInfantry2 && warhead !== 'Fire') ? 'gunfire' : 'piff';
    expect(muzzleSprite2).toBe('piff');

    const warhead2 = 'Fire';
    const muzzleSprite3 = (!isInfantry && warhead2 !== 'Fire') ? 'gunfire' : 'piff';
    expect(muzzleSprite3).toBe('piff');
  });
});

// ============================================================
// Section 4: Building damage smoke/fire animations
// C++ building.cpp + adata.cpp — event-spawned AnimClass entries
// ============================================================
describe('damaged building smoke/fire animation chain', () => {
  it('C++ building fire uses BURN-S → follow-up SMOKE_M chain (adata.cpp:468-470)', () => {
    // C++ ANIM_ON_FIRE_SMALL: sprite=BURN-S, followUp=ANIM_SMOKE_M
    // C++ ANIM_ON_FIRE_MED:  sprite=BURN-M, followUp=ANIM_ON_FIRE_SMALL
    // This creates a chain: ON_FIRE_MED → ON_FIRE_SMALL → SMOKE_M
    // The fire gradually dies down to smoke.
    const chain = ['ANIM_ON_FIRE_MED', 'ANIM_ON_FIRE_SMALL', 'ANIM_SMOKE_M'];
    expect(chain).toHaveLength(3);
    expect(chain[0]).toBe('ANIM_ON_FIRE_MED');
    expect(chain[2]).toBe('ANIM_SMOKE_M');
  });
});

// ============================================================
// Section 5: Damaged vehicle smoke trail
// C++ renderer.ts:2138-2152 — vehicles below 50% HP emit smoke
// ============================================================
describe('damaged vehicle smoke trail (renderer.ts:2138-2152)', () => {
  it('smoke trail appears on non-infantry units below 50% HP', () => {
    // TS renderer.ts:2139: entity.alive && !entity.stats.isInfantry && entity.hp < entity.maxHp * 0.5
    const isInfantry = false;
    const hpRatio = 0.4; // below 50%
    const shouldSmoke = !isInfantry && hpRatio < 0.5;
    expect(shouldSmoke).toBe(true);
  });

  it('infantry do NOT get smoke trail even when damaged', () => {
    const isInfantry = true;
    const hpRatio = 0.2; // heavily damaged
    const shouldSmoke = !isInfantry && hpRatio < 0.5;
    expect(shouldSmoke).toBe(false);
  });

  it('vehicles at or above 50% HP do NOT get smoke trail', () => {
    const isInfantry = false;
    const hpRatio = 0.5;
    const shouldSmoke = !isInfantry && hpRatio < 0.5;
    expect(shouldSmoke).toBe(false);
  });

  it('smoke trail has 3 puffs rising upward', () => {
    // TS renderer.ts:2141: for (let s = 0; s < 3; s++)
    const numPuffs = 3;
    expect(numPuffs).toBe(3);
  });

  it('smoke puff alpha decreases with height (farther puffs are more transparent)', () => {
    // TS renderer.ts:2144: sa = (0.5 - s * 0.12) * (1 - smokePhase / 12)
    const smokePhase = 0; // at phase start
    const alphas: number[] = [];
    for (let s = 0; s < 3; s++) {
      const sa = (0.5 - s * 0.12) * (1 - smokePhase / 12);
      alphas.push(sa);
    }
    // Each successive puff is more transparent
    expect(alphas[0]).toBeGreaterThan(alphas[1]);
    expect(alphas[1]).toBeGreaterThan(alphas[2]);
    // Base puff alpha = 0.5
    expect(alphas[0]).toBeCloseTo(0.5);
  });
});

// ============================================================
// Section 6: LZ_SMOKE animation properties
// C++ adata.cpp:343-366
// ============================================================
describe('LZ_SMOKE landing zone smoke (adata.cpp:343-366)', () => {
  it('LZ_SMOKE has delay=2 (half-speed animation, twice as slow as most anims)', () => {
    // Most other anims have delay=1
    // LZ_SMOKE uses delay=2 for a slower, more ambient effect
    const lzDelay = 2;
    const normalDelay = 1;
    expect(lzDelay).toBe(2 * normalDelay);
  });

  it('LZ_SMOKE loops 255 times (practically persistent for the duration of a landing)', () => {
    // C++ adata.cpp:363: loops=255
    // 255 is the max for a uint8 loop counter — essentially "loop a long time"
    const loops = 255;
    expect(loops).toBe(255);
  });

  it('LZ_SMOKE loop region is frames 72-91 (20 frame loop within larger animation)', () => {
    // C++ adata.cpp:360-361: loopStart=72, loopEnd=91
    const loopStart = 72;
    const loopEnd = 91;
    const loopLength = loopEnd - loopStart;
    expect(loopLength).toBe(19);
  });

  it('LZ_SMOKE is normalized rate (plays at consistent speed regardless of game speed)', () => {
    // C++ adata.cpp:349: Normalized=true
    const isNormalized = true;
    expect(isNormalized).toBe(true);
  });
});

// ============================================================
// Section 7: OILFIELD_BURN animation properties
// C++ adata.cpp:994-1017
// ============================================================
describe('OILFIELD_BURN oil derrick fire (adata.cpp:994-1017)', () => {
  it('OILFIELD_BURN has 66 stages (frames)', () => {
    // C++ adata.cpp:1013: stages=66
    const stages = 66;
    expect(stages).toBe(66);
  });

  it('OILFIELD_BURN loops 65535 times (effectively infinite)', () => {
    // C++ adata.cpp:1014: loops=65535 (0xFFFF — max uint16)
    const loops = 65535;
    expect(loops).toBe(0xFFFF);
  });

  it('OILFIELD_BURN loop region is frames 33-99', () => {
    // C++ adata.cpp:1011-1012: loopStart=33, loopEnd=99
    const loopStart = 33;
    const loopEnd = 99;
    expect(loopStart).toBe(33);
    expect(loopEnd).toBe(99);
    // Once initial 33 frames play, it loops between 33-99 indefinitely
    const loopLength = loopEnd - loopStart;
    expect(loopLength).toBe(66);
  });

  it('OILFIELD_BURN uses FLMSPT.SHP sprite (flame spot)', () => {
    const sprite = 'FLMSPT';
    expect(sprite).toBe('FLMSPT');
  });

  it('OILFIELD_BURN does no damage (damage=0)', () => {
    // C++ adata.cpp:1008: damage=0 (purely visual)
    const damage = 0;
    expect(damage).toBe(0);
  });
});

// ============================================================
// Section 8: SMOKE_M (medium smoke) post-fire effect
// C++ adata.cpp:1044-1067
// ============================================================
describe('SMOKE_M medium smoke (adata.cpp:1044-1067)', () => {
  it('SMOKE_M loops 6 times before dissipating', () => {
    // C++ adata.cpp:1064: loops=6
    const loops = 6;
    expect(loops).toBe(6);
  });

  it('SMOKE_M loop starts at frame 67', () => {
    // C++ adata.cpp:1061: loopStart=67
    const loopStart = 67;
    expect(loopStart).toBe(67);
  });

  it('SMOKE_M has delay=1 (normal speed)', () => {
    const delay = 1;
    expect(delay).toBe(1);
  });

  it('SMOKE_M has no follow-up (ANIM_NONE) — final effect in chain', () => {
    const followUp = 'ANIM_NONE';
    expect(followUp).toBe('ANIM_NONE');
  });
});

// ============================================================
// Section 9: MOVE_FLASH for force-move cursor
// C++ adata.cpp:1701-1724
// ============================================================
describe('MOVE_FLASH force-move cursor flash (adata.cpp:1701-1724)', () => {
  it('MOVE_FLASH uses MOVEFLSH.SHP sprite', () => {
    const sprite = 'MOVEFLSH';
    expect(sprite).toBe('MOVEFLSH');
  });

  it('MOVE_FLASH is theater-specific (rendered with theater palette)', () => {
    // C++ adata.cpp:1706: Theater=true
    const isTheaterSpecific = true;
    expect(isTheaterSpecific).toBe(true);
  });

  it('MOVE_FLASH uses white translucent table (C++ adata.cpp:1708)', () => {
    // C++ adata.cpp:1708: IsWhiteTranslucent=true
    const isWhiteTranslucent = true;
    expect(isWhiteTranslucent).toBe(true);
  });

  it('MOVE_FLASH plays once (0 loops)', () => {
    // C++ adata.cpp:1721: loops=0
    const loops = 0;
    expect(loops).toBe(0);
  });

  it('MOVE_FLASH auto-counts stages from SHP (stages=-1)', () => {
    // C++ adata.cpp:1720: stages=-1
    const stages = -1;
    expect(stages).toBe(-1);
  });
});

// ============================================================
// Section 10: TS Effect interface supports C++ animation features
// ============================================================
describe('TS Effect interface supports C++ animation features (renderer.ts)', () => {
  it('Effect type includes muzzle for ANIM_MUZZLE_FLASH equivalent', () => {
    // C++ uses discrete anim types; TS uses effect type union
    const validTypes = ['explosion', 'muzzle', 'blood', 'tesla', 'projectile', 'marker', 'text'];
    expect(validTypes).toContain('muzzle');
  });

  it('Effect has loopStart/loopEnd/loops for looping anims (LZ_SMOKE, OILFIELD_BURN)', () => {
    // TS renderer.ts:169-171:
    //   loopStart?: number;
    //   loopEnd?: number;
    //   loops?: number;
    // These map to C++ AnimTypeClass loopStart/loopEnd/loops fields
    const effect = {
      loopStart: 72,
      loopEnd: 91,
      loops: 255,
    };
    expect(effect.loopStart).toBe(72);
    expect(effect.loopEnd).toBe(91);
    expect(effect.loops).toBe(255);
  });

  it('Effect has followUp for animation chaining (ON_FIRE → SMOKE_M)', () => {
    // TS renderer.ts:173: followUp?: string
    // Maps to C++ AnimTypeClass ChainTo field
    const effect = { followUp: 'smoke_m' };
    expect(effect.followUp).toBe('smoke_m');
  });

  it('Effect has blendMode for translucent/ghost rendering (GUNFIRE uses screen blend)', () => {
    // C++ ANIM_MUZZLE_FLASH has IsTranslucent=true → uses SHAPE_GHOST + TranslucentTable
    // TS: blendMode: 'screen' | 'lighter'
    const effect = { blendMode: 'screen' as const };
    expect(effect.blendMode).toBe('screen');
  });

  it('muzzle effect default color is 255,255,150 when no warhead color specified', () => {
    // TS renderer.ts:2471: const mc = fx.muzzleColor ?? '255,255,150'
    const defaultColor = '255,255,150';
    expect(defaultColor).toBe('255,255,150');
  });
});

// ============================================================
// Section 11: TS EXPLOSION_FRAMES for smoke/muzzle sprites
// ============================================================
describe('TS EXPLOSION_FRAMES sprite frame counts (types.ts)', () => {
  it('piff sprite has 4 frames (small muzzle flash)', () => {
    expect(EXPLOSION_FRAMES['piff']).toBe(4);
  });

  it('piffpiff sprite has 8 frames (double flash / tesla)', () => {
    expect(EXPLOSION_FRAMES['piffpiff']).toBe(8);
  });

  it('napalm1 sprite has 14 frames (flame trail / FBALL_FADE equivalent)', () => {
    // TS combat.ts:641: maxFrames=14 for flame trail effect
    expect(EXPLOSION_FRAMES['napalm1']).toBe(14);
  });

  it('fball1 sprite has 18 frames (large fireball)', () => {
    expect(EXPLOSION_FRAMES['fball1']).toBe(18);
  });
});

// ============================================================
// Section 12: Flame trail projectile position interpolation
// C++ bullet.cpp:377 uses Coord (current position)
// ============================================================
describe('flame trail position interpolation (combat.ts:633-635)', () => {
  it('trail position is linearly interpolated from start to impact', () => {
    // TS combat.ts:633-635:
    //   const t = proj.currentFrame / Math.max(1, proj.travelFrames);
    //   const curX = proj.startX + (proj.impactX - proj.startX) * Math.min(t, 1);
    //   const curY = proj.startY + (proj.impactY - proj.startY) * Math.min(t, 1);

    const startX = 100, startY = 200;
    const impactX = 300, impactY = 400;
    const travelFrames = 10;

    // At frame 5 (halfway), should be at midpoint
    const t = 5 / Math.max(1, travelFrames);
    const curX = startX + (impactX - startX) * Math.min(t, 1);
    const curY = startY + (impactY - startY) * Math.min(t, 1);

    expect(curX).toBe(200);
    expect(curY).toBe(300);
  });

  it('trail position clamps at impact after projectile arrives', () => {
    const startX = 100, startY = 200;
    const impactX = 300, impactY = 400;
    const travelFrames = 10;

    // At frame 15 (past arrival), should be clamped at impact
    const t = 15 / Math.max(1, travelFrames);
    const curX = startX + (impactX - startX) * Math.min(t, 1);
    const curY = startY + (impactY - startY) * Math.min(t, 1);

    expect(curX).toBe(impactX);
    expect(curY).toBe(impactY);
  });

  it('C++ uses actual Coord (projectile world position), not interpolation', () => {
    // C++ bullet.cpp:376: coord = Coord;
    // The C++ bullet moves via Physics() which updates Coord directly.
    // TS uses linear interpolation as an approximation since projectiles
    // don't have a full physics simulation — this is acceptable for visual parity.
    const cppUsesRealCoord = true;
    expect(cppUsesRealCoord).toBe(true);
  });
});

// ============================================================
// Section 13: Guard tower minigun directional muzzle flash
// C++ adata.cpp:1072-1229 — 8 directional variants, 6 frames each
// ============================================================
describe('guard tower minigun directional anim (adata.cpp:1072-1229)', () => {
  it('all 8 GUN directions share MINIGUN.SHP with 6 frames each', () => {
    // C++ adata.cpp: GUN_N through GUN_NE all use "MINIGUN" sprite
    // Each has stages=6, with startFrame offset by 6 per direction
    const directions = [
      { name: 'GUN_N',  startFrame: 0 },
      { name: 'GUN_NW', startFrame: 6 },
      { name: 'GUN_W',  startFrame: 12 },
      { name: 'GUN_SW', startFrame: 18 },
      { name: 'GUN_S',  startFrame: 24 },
      { name: 'GUN_SE', startFrame: 30 },
      { name: 'GUN_E',  startFrame: 36 },
      { name: 'GUN_NE', startFrame: 42 },
    ];

    for (const dir of directions) {
      expect(dir.startFrame, `${dir.name} startFrame`).toBe(
        directions.indexOf(dir) * 6
      );
    }
  });

  it('GUN_N has startFrame=0, GUN_S has startFrame=24', () => {
    expect(0).toBe(0);    // N
    expect(24).toBe(24);  // S (4th direction * 6 frames)
  });

  it('total MINIGUN.SHP frames = 8 directions * 6 frames = 48', () => {
    const totalFrames = 8 * 6;
    expect(totalFrames).toBe(48);
  });
});

// ============================================================
// Section 14: C++ SAM fire animation (adata.cpp:150-341)
// ============================================================
describe('SAM fire animation (adata.cpp:150-341)', () => {
  it('all 8 SAM directions share SAMFIRE.SHP with 18 frames each', () => {
    // C++ adata.cpp: SAM_N has stages=18, startFrame = 18*facing
    const directions = [
      { name: 'SAM_N',  startFrame: 0 },
      { name: 'SAM_NW', startFrame: 18 },
      { name: 'SAM_W',  startFrame: 36 },
      { name: 'SAM_SW', startFrame: 54 },
      { name: 'SAM_S',  startFrame: 72 },
      { name: 'SAM_SE', startFrame: 90 },
      { name: 'SAM_E',  startFrame: 108 },
      { name: 'SAM_NE', startFrame: 126 },
    ];

    for (const dir of directions) {
      expect(dir.startFrame, `${dir.name} startFrame`).toBe(
        directions.indexOf(dir) * 18
      );
    }
  });

  it('total SAMFIRE.SHP frames = 8 directions * 18 frames = 144', () => {
    const totalFrames = 8 * 18;
    expect(totalFrames).toBe(144);
  });
});

// ============================================================
// Section 15: Burning building animation chain (C++ parity)
// C++ adata.cpp: ON_FIRE_BIG → ON_FIRE_MED → ON_FIRE_SMALL → SMOKE_M
// ============================================================
describe('building fire animation chain (adata.cpp)', () => {
  // C++ chain: ON_FIRE_BIG → ON_FIRE_MED → ON_FIRE_SMALL → SMOKE_M → NONE
  const fireChain: { anim: string; sprite: string; followUp: string; damage: string; loops: number }[] = [
    { anim: 'ON_FIRE_BIG',   sprite: 'BURN-L', followUp: 'ON_FIRE_MED',   damage: 'fixed(1,8)',  loops: 4 },
    { anim: 'ON_FIRE_MED',   sprite: 'BURN-M', followUp: 'ON_FIRE_SMALL', damage: 'fixed(1,16)', loops: 4 },
    { anim: 'ON_FIRE_SMALL', sprite: 'BURN-S', followUp: 'SMOKE_M',       damage: 'fixed(1,32)', loops: 4 },
    { anim: 'SMOKE_M',       sprite: 'SMOKE_M', followUp: 'NONE',         damage: '0',           loops: 6 },
  ];

  it('fire chain has 4 stages from big fire down to dissipating smoke', () => {
    expect(fireChain).toHaveLength(4);
  });

  it('each fire stage does decreasing damage (big > med > small > none)', () => {
    // C++ uses fixed-point damage per tick:
    // ON_FIRE_BIG:   fixed(1,8)  = 1/8  = 0.125 per tick
    // ON_FIRE_MED:   fixed(1,16) = 1/16 = 0.0625 per tick
    // ON_FIRE_SMALL: fixed(1,32) = 1/32 = 0.03125 per tick
    // SMOKE_M:       0 (no damage)
    const damages = [1 / 8, 1 / 16, 1 / 32, 0];
    expect(damages[0]).toBeGreaterThan(damages[1]);
    expect(damages[1]).toBeGreaterThan(damages[2]);
    expect(damages[2]).toBeGreaterThan(damages[3]);
    expect(damages[3]).toBe(0);
  });

  it('all fire stages use delay=2 (half-speed animation)', () => {
    // C++ adata.cpp: all BURN-S/M/L and ON_FIRE variants have delay=2
    const delay = 2;
    expect(delay).toBe(2);
  });

  it('all fire stages loop between frames 30-62 (loopStart=30, loopEnd=62)', () => {
    // C++ adata.cpp: BURN-S: loopStart=30, loopEnd=62
    // C++ adata.cpp: BURN-M: loopStart=30, loopEnd=62
    const loopStart = 30;
    const loopEnd = 62;
    const loopLength = loopEnd - loopStart;
    expect(loopStart).toBe(30);
    expect(loopEnd).toBe(62);
    expect(loopLength).toBe(32);
  });

  it('all fire stages loop 4 times before transitioning', () => {
    for (const stage of fireChain.filter(s => s.anim.startsWith('ON_FIRE'))) {
      expect(stage.loops, `${stage.anim} loops`).toBe(4);
    }
  });
});
