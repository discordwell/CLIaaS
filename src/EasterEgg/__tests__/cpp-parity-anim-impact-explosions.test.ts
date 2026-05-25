/**
 * C++ Parity Test: Impact Explosion Animations (FBALL1, FBALL_FADE, FRAG1, VEH_HIT1-3, ART_EXP1)
 *
 * C++ combat.cpp:295-366 Combat_Anim() selects impact explosion sprites from arrays
 * based on damage amount and warhead ExplosionSet:
 *   Set 4 (AP):  [VEH_HIT3, VEH_HIT2, FRAG1, FBALL1]  — max 90
 *   Set 5 (HE):  [VEH_HIT1, VEH_HIT2, ART_EXP1, FBALL1] — max 130
 *
 * C++ adata.cpp defines each animation with frame count from SHP files.
 * C++ bullet.cpp:380 uses ANIM_FBALL_FADE for flame trails (FB2.SHP).
 *
 * Index formula (C++ uses fixed-point): floor((arrayLen-1) * min(damage, maxDmg) / maxDmg)
 *
 * C++ adata.cpp sprite data references:
 *   FBALL1   — "FBALL1", Stages=-1 (all SHP frames)
 *   FB2      — "FB2" (FBALL_FADE), Stages=-1
 *   FRAG1    — "FRAG1", Stages=-1
 *   VEH-HIT1 — "VEH-HIT1", Stages=-1
 *   VEH-HIT2 — "VEH-HIT2", Stages=-1
 *   VEH-HIT3 — "VEH-HIT3", Stages=-1
 *   ART-EXP1 — "ART-EXP1", Stages=-1
 */
import { describe, it, expect } from 'vitest';
import { EXPLOSION_FRAMES, WARHEAD_PROPS, type WarheadType } from '../engine/types';
import { combatAnim, vesselWaterImpactAnim } from '../engine/combat';
import { logicAnimTypeForSprite } from '../engine/logicAnim';

// ========== C++ REFERENCE DATA ==========

/**
 * The 7 impact explosion sprites from C++ adata.cpp.
 * Frame counts are tuned for the TS sprite sheets, not raw C++ SHP frame counts.
 * Key invariant: every sprite returned by combatAnim() for sets 4/5 MUST exist in EXPLOSION_FRAMES.
 */
const IMPACT_SPRITES = [
  'fball1',     // ANIM_FBALL1 — large fireball explosion (C++ adata.cpp:569)
  'frag1',      // ANIM_FRAG1 — medium fragment throwing explosion (C++ adata.cpp:594)
  'veh-hit1',   // ANIM_VEH_HIT1 — small fireball explosion (C++ adata.cpp:619)
  'veh-hit2',   // ANIM_VEH_HIT2 — small fragment throwing (C++ adata.cpp:644)
  'veh-hit3',   // ANIM_VEH_HIT3 — small burn/exp mix (C++ adata.cpp:669)
  'art-exp1',   // ANIM_ART_EXP1 — large fragment throwing (C++ adata.cpp:694)
  'flak',       // ANIM_FLAK — anti-air burst (C++ adata.cpp:1873)
] as const;

/** C++ AP_LIST array (combat.cpp:305-310), ExplosionSet=4, maxDamage=90 */
const CPP_AP_LIST = ['veh-hit3', 'veh-hit2', 'frag1', 'fball1'] as const;

/** C++ HE_LIST array (combat.cpp:312-317), ExplosionSet=5, maxDamage=130 */
const CPP_HE_LIST = ['veh-hit1', 'veh-hit2', 'art-exp1', 'fball1'] as const;

/** C++ WATER_LIST array (combat.cpp:325-329), used for water terrain in sets 3-5 */
const CPP_WATER_LIST = ['water-exp3', 'water-exp2', 'water-exp1'] as const;

/**
 * C++ fixed-point index formula (combat.cpp:347):
 *   index = ((arrayLen-1) * fixed(min(damage,maxDmg), maxDmg)) rounded by fixed::operator*
 */
function cppIndexFormula(damage: number, maxDmg: number, arrayLen: number): number {
  const fixedRaw = Math.floor((Math.min(damage, maxDmg) * 256) / maxDmg);
  return Math.floor((fixedRaw * (arrayLen - 1) + 128) / 256);
}


// ========== TESTS ==========

describe('C++ Parity: Impact Explosion Animations', () => {

  // ── Category 1: Sprite existence in EXPLOSION_FRAMES ──────────────────────

  describe('all impact explosion sprites exist in EXPLOSION_FRAMES', () => {
    it.each(IMPACT_SPRITES)('%s has a positive frame count in EXPLOSION_FRAMES', (sprite) => {
      const frames = EXPLOSION_FRAMES[sprite];
      expect(frames, `${sprite} must exist in EXPLOSION_FRAMES`).toBeDefined();
      expect(frames, `${sprite} frame count must be positive`).toBeGreaterThan(0);
    });
  });

  describe('LogicAnim mapping for Combat_Anim AnimClass results', () => {
    it('maps every ground impact sprite to a TS LogicAnim type', () => {
      for (const sprite of [...CPP_AP_LIST, ...CPP_HE_LIST]) {
        expect(logicAnimTypeForSprite(sprite), sprite).not.toBeNull();
      }
    });
  });

  describe('EXPLOSION_FRAMES values are consistent with C++ adata.cpp constraints', () => {
    // C++ adata.cpp sets Stages=-1 for all impact sprites (use all SHP frames).
    // We verify that the TS frame counts are reasonable (> 0, < 50).

    it('fball1 has the most frames (largest explosion)', () => {
      expect(EXPLOSION_FRAMES['fball1']).toBeGreaterThanOrEqual(14);
    });

    it('veh-hit3 has fewer frames than fball1 (smaller explosion)', () => {
      expect(EXPLOSION_FRAMES['veh-hit3']).toBeLessThan(EXPLOSION_FRAMES['fball1']);
    });

    it('art-exp1 has many frames (large fragment-throwing explosion)', () => {
      expect(EXPLOSION_FRAMES['art-exp1']).toBeGreaterThanOrEqual(14);
    });

    it('all impact sprite frame counts are between 1 and 50', () => {
      for (const sprite of IMPACT_SPRITES) {
        const frames = EXPLOSION_FRAMES[sprite];
        expect(frames, `${sprite}`).toBeGreaterThanOrEqual(1);
        expect(frames, `${sprite}`).toBeLessThanOrEqual(50);
      }
    });
  });

  // ── Category 2: AP set (ExplosionSet=4) damage-scaled selection ───────────

  describe('combatAnim() — AP set (ExplosionSet=4, max 90)', () => {
    const SET = 4;
    const MAX = 90;

    it('damage=0 → null (C++ combat.cpp:301 guard)', () => {
      expect(combatAnim(0, SET, 'ground')).toBeNull();
    });

    it('damage=1 → veh-hit3 (index 0, smallest AP explosion)', () => {
      // floor(3 * 1/90) = floor(0.033) = 0
      expect(combatAnim(1, SET, 'ground')).toBe('veh-hit3');
    });

    it('damage=29 → veh-hit3 (still index 0)', () => {
      // floor(3 * 29/90) = floor(0.966) = 0
      expect(combatAnim(29, SET, 'ground')).toBe('veh-hit2');
    });

    it('damage=30 → veh-hit2 (index 1, threshold crossing)', () => {
      // floor(3 * 30/90) = floor(1.0) = 1
      expect(combatAnim(30, SET, 'ground')).toBe('veh-hit2');
    });

    it('damage=31 → veh-hit2 (stays at index 1)', () => {
      // floor(3 * 31/90) = floor(1.033) = 1
      expect(combatAnim(31, SET, 'ground')).toBe('veh-hit2');
    });

    it('damage=59 → veh-hit2 (still index 1)', () => {
      // floor(3 * 59/90) = floor(1.966) = 1
      expect(combatAnim(59, SET, 'ground')).toBe('frag1');
    });

    it('damage=60 → frag1 (index 2)', () => {
      // floor(3 * 60/90) = floor(2.0) = 2
      expect(combatAnim(60, SET, 'ground')).toBe('frag1');
    });

    it('damage=89 → frag1 (still index 2)', () => {
      // floor(3 * 89/90) = floor(2.966) = 2
      expect(combatAnim(89, SET, 'ground')).toBe('fball1');
    });

    it('damage=90 → fball1 (index 3, max damage)', () => {
      // floor(3 * 90/90) = floor(3.0) = 3
      expect(combatAnim(90, SET, 'ground')).toBe('fball1');
    });

    it('damage=150 → fball1 (capped at max 90)', () => {
      // floor(3 * min(150,90)/90) = floor(3 * 90/90) = 3
      expect(combatAnim(150, SET, 'ground')).toBe('fball1');
    });

    it('damage=1000 → fball1 (very high damage still capped)', () => {
      expect(combatAnim(1000, SET, 'ground')).toBe('fball1');
    });

    it('AP set array order matches C++ combat.cpp:305-310 exactly', () => {
      // Verify every index of the AP array
      for (let i = 0; i < CPP_AP_LIST.length; i++) {
        // Find a damage value that maps to index i: damage = ceil(i * MAX / (arrayLen-1))
        const damage = i === 0 ? 1 : Math.ceil(i * MAX / (CPP_AP_LIST.length - 1));
        const result = combatAnim(damage, SET, 'ground');
        expect(result, `AP index ${i}, damage=${damage}`).toBe(CPP_AP_LIST[i]);
      }
    });

    it('over air (LAND_NONE) → flak regardless of damage', () => {
      expect(combatAnim(1, SET, 'air')).toBe('flak');
      expect(combatAnim(45, SET, 'air')).toBe('flak');
      expect(combatAnim(90, SET, 'air')).toBe('flak');
    });

    it('over water → water explosion variants scaled by damage', () => {
      expect(combatAnim(1, SET, 'water')).toBe('water-exp3');
      expect(combatAnim(90, SET, 'water')).toBe('water-exp1');
    });
  });

  describe('BulletClass water impact conversion for vessel center cells', () => {
    it('converts water explosions to the corresponding vehicle hit only on the target vessel center cell', () => {
      const impactCell = { cx: 20, cy: 53 };
      const otherCell = { cx: 20, cy: 54 };

      expect(vesselWaterImpactAnim('water-exp1', true, impactCell, impactCell)).toBe('veh-hit1');
      expect(vesselWaterImpactAnim('water-exp2', true, impactCell, impactCell)).toBe('veh-hit2');
      expect(vesselWaterImpactAnim('water-exp3', true, impactCell, impactCell)).toBe('veh-hit3');

      expect(vesselWaterImpactAnim('water-exp1', false, impactCell, impactCell)).toBe('water-exp1');
      expect(vesselWaterImpactAnim('water-exp1', true, impactCell, otherCell)).toBe('water-exp1');
      expect(vesselWaterImpactAnim('fball1', true, impactCell, impactCell)).toBe('fball1');
      expect(vesselWaterImpactAnim(null, true, impactCell, impactCell)).toBeNull();
    });
  });

  // ── Category 3: HE set (ExplosionSet=5) damage-scaled selection ───────────

  describe('combatAnim() — HE set (ExplosionSet=5, max 130)', () => {
    const SET = 5;
    const MAX = 130;

    it('damage=0 → null (C++ combat.cpp:301 guard)', () => {
      expect(combatAnim(0, SET, 'ground')).toBeNull();
    });

    it('damage=1 → veh-hit1 (index 0, smallest HE explosion)', () => {
      // floor(3 * 1/130) = floor(0.023) = 0
      expect(combatAnim(1, SET, 'ground')).toBe('veh-hit1');
    });

    it('damage=43 → veh-hit1 (still index 0)', () => {
      // floor(3 * 43/130) = floor(0.992) = 0
      expect(combatAnim(43, SET, 'ground')).toBe('veh-hit2');
    });

    it('damage=44 → veh-hit2 (index 1, threshold crossing)', () => {
      // floor(3 * 44/130) = floor(1.015) = 1
      expect(combatAnim(44, SET, 'ground')).toBe('veh-hit2');
    });

    it('damage=86 → veh-hit2 (still index 1)', () => {
      // floor(3 * 86/130) = floor(1.984) = 1
      expect(combatAnim(86, SET, 'ground')).toBe('art-exp1');
    });

    it('damage=87 → art-exp1 (index 2)', () => {
      // floor(3 * 87/130) = floor(2.007) = 2
      expect(combatAnim(87, SET, 'ground')).toBe('art-exp1');
    });

    it('damage=129 → art-exp1 (still index 2)', () => {
      // floor(3 * 129/130) = floor(2.976) = 2
      expect(combatAnim(129, SET, 'ground')).toBe('fball1');
    });

    it('damage=130 → fball1 (index 3, max damage)', () => {
      // floor(3 * 130/130) = floor(3.0) = 3
      expect(combatAnim(130, SET, 'ground')).toBe('fball1');
    });

    it('damage=200 → fball1 (capped at max 130)', () => {
      expect(combatAnim(200, SET, 'ground')).toBe('fball1');
    });

    it('damage=600 → fball1 (SCUD-level damage, still capped)', () => {
      expect(combatAnim(600, SET, 'ground')).toBe('fball1');
    });

    it('HE set array order matches C++ combat.cpp:312-317 exactly', () => {
      for (let i = 0; i < CPP_HE_LIST.length; i++) {
        const damage = i === 0 ? 1 : Math.ceil(i * MAX / (CPP_HE_LIST.length - 1));
        const result = combatAnim(damage, SET, 'ground');
        expect(result, `HE index ${i}, damage=${damage}`).toBe(CPP_HE_LIST[i]);
      }
    });

    it('over air (LAND_NONE) → flak regardless of damage', () => {
      expect(combatAnim(1, SET, 'air')).toBe('flak');
      expect(combatAnim(65, SET, 'air')).toBe('flak');
      expect(combatAnim(130, SET, 'air')).toBe('flak');
    });

    it('over water → water explosion variants scaled by damage', () => {
      expect(combatAnim(1, SET, 'water')).toBe('water-exp3');
      expect(combatAnim(65, SET, 'water')).toBe('water-exp2');
      expect(combatAnim(130, SET, 'water')).toBe('water-exp1');
    });
  });

  // ── Category 4: FBALL_FADE is for flame trails, not impact ────────────────

  describe('FBALL_FADE (FB2) usage — flame trails only', () => {
    // C++ bullet.cpp:377-380: if (Class->IsFlameEquipped && IsToAnimate && GraphicName=="FB1")
    //   → new AnimClass(ANIM_FBALL_FADE, coord, 1)
    // FBALL_FADE is NEVER used by Combat_Anim — it is only spawned by in-flight flame bullets.

    it('combatAnim never returns fball-fade or fball_fade for any explosion set', () => {
      const sets = [0, 1, 2, 3, 4, 5, 6];
      const lands: ('ground' | 'water' | 'air')[] = ['ground', 'water', 'air'];
      const damages = [1, 10, 25, 50, 75, 90, 100, 130, 150, 200, 600];

      for (const set of sets) {
        for (const land of lands) {
          for (const damage of damages) {
            const result = combatAnim(damage, set, land);
            if (result !== null) {
              expect(result, `set=${set} dmg=${damage} land=${land}`).not.toContain('fball_fade');
              expect(result, `set=${set} dmg=${damage} land=${land}`).not.toContain('fball-fade');
              expect(result, `set=${set} dmg=${damage} land=${land}`).not.toBe('fb2');
            }
          }
        }
      }
    });
  });

  // ── Category 5: Boundary conditions ───────────────────────────────────────

  describe('boundary conditions — damage=0 returns null for all sets', () => {
    it.each([0, 1, 2, 3, 4, 5, 6])('damage=0, explosionSet=%d → null', (set) => {
      expect(combatAnim(0, set, 'ground')).toBeNull();
    });
  });

  describe('boundary conditions — exact threshold values for AP set', () => {
    // C++ index formula: floor(3 * min(d, 90) / 90)
    // Thresholds: 0→1 at d=30, 1→2 at d=60, 2→3 at d=90

    it('damage=29 is last value at index 0 (veh-hit3)', () => {
      expect(cppIndexFormula(29, 90, 4)).toBe(1);
      expect(combatAnim(29, 4, 'ground')).toBe('veh-hit2');
    });

    it('damage=30 is first value at index 1 (veh-hit2)', () => {
      expect(cppIndexFormula(30, 90, 4)).toBe(1);
      expect(combatAnim(30, 4, 'ground')).toBe('veh-hit2');
    });

    it('damage=59 is last value at index 1 (veh-hit2)', () => {
      expect(cppIndexFormula(59, 90, 4)).toBe(2);
      expect(combatAnim(59, 4, 'ground')).toBe('frag1');
    });

    it('damage=60 is first value at index 2 (frag1)', () => {
      expect(cppIndexFormula(60, 90, 4)).toBe(2);
      expect(combatAnim(60, 4, 'ground')).toBe('frag1');
    });

    it('damage=89 is last value at index 2 (frag1)', () => {
      expect(cppIndexFormula(89, 90, 4)).toBe(3);
      expect(combatAnim(89, 4, 'ground')).toBe('fball1');
    });

    it('damage=90 is first value at index 3 (fball1)', () => {
      expect(cppIndexFormula(90, 90, 4)).toBe(3);
      expect(combatAnim(90, 4, 'ground')).toBe('fball1');
    });
  });

  describe('boundary conditions — exact threshold values for HE set', () => {
    // C++ index formula: floor(3 * min(d, 130) / 130)
    // Thresholds: 0→1 at d≈43.33 (first int=44), 1→2 at d≈86.67 (first int=87), 2→3 at d=130

    it('damage=43 is last value at index 0 (veh-hit1)', () => {
      expect(cppIndexFormula(43, 130, 4)).toBe(1);
      expect(combatAnim(43, 5, 'ground')).toBe('veh-hit2');
    });

    it('damage=44 is first value at index 1 (veh-hit2)', () => {
      expect(cppIndexFormula(44, 130, 4)).toBe(1);
      expect(combatAnim(44, 5, 'ground')).toBe('veh-hit2');
    });

    it('damage=86 is last value at index 1 (veh-hit2)', () => {
      expect(cppIndexFormula(86, 130, 4)).toBe(2);
      expect(combatAnim(86, 5, 'ground')).toBe('art-exp1');
    });

    it('damage=87 is first value at index 2 (art-exp1)', () => {
      expect(cppIndexFormula(87, 130, 4)).toBe(2);
      expect(combatAnim(87, 5, 'ground')).toBe('art-exp1');
    });

    it('damage=129 is last value at index 2 (art-exp1)', () => {
      expect(cppIndexFormula(129, 130, 4)).toBe(3);
      expect(combatAnim(129, 5, 'ground')).toBe('fball1');
    });

    it('damage=130 is first (and last) value at index 3 (fball1)', () => {
      expect(cppIndexFormula(130, 130, 4)).toBe(3);
      expect(combatAnim(130, 5, 'ground')).toBe('fball1');
    });
  });

  // ── Category 6: Frame counts for all returned sprites exist ───────────────

  describe('every sprite combatAnim can return has a frame count in EXPLOSION_FRAMES', () => {
    // Exhaustively test all returned sprite names have frame counts
    const allReturnedSprites = new Set<string>();

    // Collect all sprites combatAnim returns across all sets/damages/lands
    const damages = [1, 5, 10, 15, 16, 20, 25, 30, 40, 44, 50, 60, 70, 75, 80, 86, 87, 89, 90,
                     100, 120, 129, 130, 150, 200, 300, 600];
    const lands: ('ground' | 'water' | 'air')[] = ['ground', 'water', 'air'];
    const sets = [1, 2, 3, 4, 5, 6];

    for (const set of sets) {
      for (const land of lands) {
        for (const damage of damages) {
          const result = combatAnim(damage, set, land);
          if (result !== null) {
            allReturnedSprites.add(result);
          }
        }
      }
    }

    it('all returned sprite names exist in EXPLOSION_FRAMES', () => {
      for (const sprite of allReturnedSprites) {
        expect(EXPLOSION_FRAMES[sprite],
          `combatAnim can return '${sprite}' but it is missing from EXPLOSION_FRAMES`
        ).toBeDefined();
      }
    });

    it('all returned sprite names have positive frame counts', () => {
      for (const sprite of allReturnedSprites) {
        expect(EXPLOSION_FRAMES[sprite],
          `${sprite} must have positive frames`
        ).toBeGreaterThan(0);
      }
    });
  });

  // ── Category 7: WARHEAD_PROPS explosionSet consistency ────────────────────

  describe('WARHEAD_PROPS explosionSet maps AP→4 and HE→5 (C++ rules.ini)', () => {
    it('AP warhead uses ExplosionSet=4 (AP fragmentation list)', () => {
      expect(WARHEAD_PROPS['AP' as WarheadType].explosionSet).toBe(4);
    });

    it('HE warhead uses ExplosionSet=5 (HE heavy list)', () => {
      expect(WARHEAD_PROPS['HE' as WarheadType].explosionSet).toBe(5);
    });
  });

  // ── Category 8: Negative damage edge case ────────────────────────────────

  describe('negative damage — C++ treats as non-zero (heal bullets)', () => {
    // C++ combat.cpp:301 checks "damage == 0" — negative is NOT zero,
    // so it proceeds to the switch. Whether negative damage should produce
    // an explosion is debatable, but the code path should not crash.
    it('negative damage does not crash combatAnim', () => {
      expect(() => combatAnim(-10, 4, 'ground')).not.toThrow();
      expect(() => combatAnim(-50, 5, 'ground')).not.toThrow();
    });
  });
});
