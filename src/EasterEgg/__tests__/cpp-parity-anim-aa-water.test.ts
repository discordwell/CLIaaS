/**
 * C++ Parity Test: AA/Water Explosions (FLAK, WATER_EXP1-3)
 *
 * C++ combat.cpp:295-366 Combat_Anim() handles air and water land types:
 *   - Sets 3 (Fire), 4 (AP), 5 (HE) check LAND_NONE -> ANIM_FLAK (anti-air burst)
 *   - Sets 3, 4, 5 check LAND_WATER -> WATER_EXP3/2/1 (damage-scaled water splash)
 *   - Sets 1, 2, 6 do NOT check land type (no FLAK, no water override)
 *
 * C++ adata.cpp sprite data:
 *   FLAK       — "FLAK", dim=8, Stages=-1 (all SHP frames), NormalRate=true
 *   WATER_EXP1 — "H2O_EXP1", dim=64, Stages=-1, GroundLevel=true, Sound=VOC_SPLASH
 *   WATER_EXP2 — "H2O_EXP2", dim=40, Stages=-1, GroundLevel=true, Sound=VOC_SPLASH
 *   WATER_EXP3 — "H2O_EXP3", dim=32, Stages=-1, GroundLevel=true, Sound=VOC_SPLASH
 *
 * C++ WATER_LIST array order (combat.cpp:325-329):
 *   [WATER_EXP3, WATER_EXP2, WATER_EXP1]  — smallest to largest
 *
 * Water damage-scaled index formula (same as ground):
 *   index = floor((arrayLen-1) * min(damage, maxDmg) / maxDmg)
 *   Set 3: maxDmg=150, Set 4: maxDmg=90, Set 5: maxDmg=130
 *
 * Weapon context (C++ rules.ini / types.ts):
 *   SAM site:      warhead=AP (explosionSet=4), isAntiAir=true
 *   TorpTube:      warhead=AP (explosionSet=4), isSubSurface=true (submarine torpedo)
 *   DepthCharge:   warhead=AP (explosionSet=4), isAntiSub=true
 */
import { describe, it, expect } from 'vitest';
import { EXPLOSION_FRAMES, WARHEAD_PROPS, type WarheadType } from '../engine/types';
import { combatAnim } from '../engine/combat';

// ========== C++ REFERENCE DATA ==========

/** C++ WATER_LIST array (combat.cpp:325-329): smallest to largest water splash */
const CPP_WATER_LIST = ['water-exp3', 'water-exp2', 'water-exp1'] as const;

/** Sets that check land type for FLAK/water overrides (C++ combat.cpp:344-357) */
const LAND_AWARE_SETS = [3, 4, 5] as const;

/** Sets that do NOT check land type — always use their ground animation (C++ combat.cpp:334-341,359-360) */
const LAND_UNAWARE_SETS = [1, 2, 6] as const;

/** Max damage caps per explosion set (C++ combat.cpp:346-357) */
const MAX_DAMAGE: Record<number, number> = { 3: 150, 4: 90, 5: 130 };

/**
 * C++ fixed-point index formula (combat.cpp:346):
 *   index = floor((arrayLen-1) * min(damage, maxDmg) / maxDmg)
 */
function cppIndexFormula(damage: number, maxDmg: number, arrayLen: number): number {
  return Math.floor((arrayLen - 1) * Math.min(damage, maxDmg) / maxDmg);
}


// ========== TESTS ==========

describe('C++ Parity: AA/Water Explosion Animations', () => {

  // ── Category 1: FLAK returned for sets 3,4,5 when land='air' ──────────────

  describe('FLAK returned for sets 3,4,5 when land=air (LAND_NONE)', () => {
    // C++ combat.cpp:344,350,355: if (land == LAND_NONE) return(ANIM_FLAK);

    it.each(LAND_AWARE_SETS)(
      'explosionSet=%d, any damage over air → flak',
      (set) => {
        const damages = [1, 10, 25, 50, 75, 100, 150, 200, 600];
        for (const dmg of damages) {
          expect(
            combatAnim(dmg, set, 'air'),
            `set=${set} dmg=${dmg} land=air should be flak`
          ).toBe('flak');
        }
      }
    );

    it('FLAK is independent of damage amount — all produce same sprite', () => {
      // C++ does not scale FLAK by damage; it is always the same animation.
      // The return is immediate before the damage-scaling index formula.
      for (const set of LAND_AWARE_SETS) {
        const results = [1, 50, 150, 600].map(d => combatAnim(d, set, 'air'));
        expect(new Set(results).size, `set=${set}: all air damages should return same sprite`).toBe(1);
        expect(results[0]).toBe('flak');
      }
    });
  });

  // ── Category 2: FLAK NOT returned for sets 1,2,6 ──────────────────────────

  describe('FLAK NOT returned for sets 1,2,6 (land type ignored)', () => {
    // C++ combat.cpp:334-341,359-360: sets 1,2,6 never check land type

    it.each(LAND_UNAWARE_SETS)(
      'explosionSet=%d over air does NOT return flak',
      (set) => {
        const damages = [1, 15, 16, 50, 100, 150];
        for (const dmg of damages) {
          const result = combatAnim(dmg, set, 'air');
          expect(result, `set=${set} dmg=${dmg} land=air`).not.toBe('flak');
        }
      }
    );

    it('set=1 (HollowPoint) returns piff regardless of land type', () => {
      // C++ combat.cpp:359: case 1: return(ANIM_PIFF);
      expect(combatAnim(50, 1, 'air')).toBe('piff');
      expect(combatAnim(50, 1, 'water')).toBe('piff');
      expect(combatAnim(50, 1, 'ground')).toBe('piff');
    });

    it('set=2 (SA) returns piff/piffpiff regardless of land type', () => {
      // C++ combat.cpp:338-341: checks damage > 15, not land
      expect(combatAnim(10, 2, 'air')).toBe('piff');
      expect(combatAnim(10, 2, 'water')).toBe('piff');
      expect(combatAnim(20, 2, 'air')).toBe('piffpiff');
      expect(combatAnim(20, 2, 'water')).toBe('piffpiff');
    });

    it('set=6 (Nuke) returns atomsfx regardless of land type', () => {
      // C++ combat.cpp:334-335: case 6: return(ANIM_ATOM_BLAST);
      expect(combatAnim(100, 6, 'air')).toBe('atomsfx');
      expect(combatAnim(100, 6, 'water')).toBe('atomsfx');
      expect(combatAnim(100, 6, 'ground')).toBe('atomsfx');
    });
  });

  // ── Category 3: WATER_EXP3/2/1 for sets 3,4,5 when land='water' ───────────

  describe('water explosions for sets 3,4,5 when land=water', () => {
    // C++ combat.cpp:346,351,356: if (land == LAND_WATER) return(_waterlist[...])

    describe('set=3 (Fire, max 150) water scaling', () => {
      const SET = 3;
      const MAX = 150;

      it('low damage → water-exp3 (smallest splash, index 0)', () => {
        // floor(2 * 1/150) = 0
        expect(combatAnim(1, SET, 'water')).toBe('water-exp3');
      });

      it('damage=49 → water-exp3 (still index 0)', () => {
        // floor(2 * 49/150) = floor(0.653) = 0
        expect(combatAnim(49, SET, 'water')).toBe('water-exp3');
      });

      it('damage=75 → water-exp2 (index 1, threshold crossing)', () => {
        // floor(2 * 75/150) = floor(1.0) = 1
        expect(combatAnim(75, SET, 'water')).toBe('water-exp2');
      });

      it('damage=150 → water-exp1 (largest splash, index 2)', () => {
        // floor(2 * 150/150) = floor(2.0) = 2
        expect(combatAnim(150, SET, 'water')).toBe('water-exp1');
      });

      it('damage=300 → water-exp1 (capped at max 150)', () => {
        expect(combatAnim(300, SET, 'water')).toBe('water-exp1');
      });
    });

    describe('set=4 (AP, max 90) water scaling', () => {
      const SET = 4;
      const MAX = 90;

      it('low damage → water-exp3 (index 0)', () => {
        expect(combatAnim(1, SET, 'water')).toBe('water-exp3');
      });

      it('damage=44 → water-exp3 (still index 0)', () => {
        // floor(2 * 44/90) = floor(0.977) = 0
        expect(combatAnim(44, SET, 'water')).toBe('water-exp3');
      });

      it('damage=45 → water-exp2 (index 1)', () => {
        // floor(2 * 45/90) = floor(1.0) = 1
        expect(combatAnim(45, SET, 'water')).toBe('water-exp2');
      });

      it('damage=89 → water-exp2 (still index 1)', () => {
        // floor(2 * 89/90) = floor(1.977) = 1
        expect(combatAnim(89, SET, 'water')).toBe('water-exp2');
      });

      it('damage=90 → water-exp1 (index 2, max damage)', () => {
        // floor(2 * 90/90) = floor(2.0) = 2
        expect(combatAnim(90, SET, 'water')).toBe('water-exp1');
      });
    });

    describe('set=5 (HE, max 130) water scaling', () => {
      const SET = 5;
      const MAX = 130;

      it('low damage → water-exp3 (index 0)', () => {
        expect(combatAnim(1, SET, 'water')).toBe('water-exp3');
      });

      it('damage=64 → water-exp3 (still index 0)', () => {
        // floor(2 * 64/130) = floor(0.984) = 0
        expect(combatAnim(64, SET, 'water')).toBe('water-exp3');
      });

      it('damage=65 → water-exp2 (index 1)', () => {
        // floor(2 * 65/130) = floor(1.0) = 1
        expect(combatAnim(65, SET, 'water')).toBe('water-exp2');
      });

      it('damage=129 → water-exp2 (still index 1)', () => {
        // floor(2 * 129/130) = floor(1.984) = 1
        expect(combatAnim(129, SET, 'water')).toBe('water-exp2');
      });

      it('damage=130 → water-exp1 (index 2, max damage)', () => {
        // floor(2 * 130/130) = floor(2.0) = 2
        expect(combatAnim(130, SET, 'water')).toBe('water-exp1');
      });
    });
  });

  // ── Category 4: Water explosion damage scaling matches C++ formula ─────────

  describe('water explosion index formula matches C++ fixed-point arithmetic', () => {
    // C++ combat.cpp:346: _waterlist[(ARRAY_SIZE(_waterlist)-1) * fixed(min(damage, 90), 90)]
    // ARRAY_SIZE(_waterlist) = 3, so (3-1) * fixed(min(d,90), 90) = 2 * d/90

    it.each(LAND_AWARE_SETS)(
      'set=%d: exhaustive threshold verification against C++ formula',
      (set) => {
        const maxDmg = MAX_DAMAGE[set];
        const arrayLen = CPP_WATER_LIST.length;

        // Test every damage value from 1 to maxDmg+10
        for (let dmg = 1; dmg <= maxDmg + 10; dmg++) {
          const expectedIndex = cppIndexFormula(dmg, maxDmg, arrayLen);
          const expectedSprite = CPP_WATER_LIST[expectedIndex];
          const actual = combatAnim(dmg, set, 'water');
          expect(actual, `set=${set} dmg=${dmg}: expected index ${expectedIndex} → ${expectedSprite}`).toBe(expectedSprite);
        }
      }
    );

    it('water list order is smallest-to-largest (water-exp3 < water-exp2 < water-exp1)', () => {
      // C++ adata.cpp: WATER_EXP3 dim=32, WATER_EXP2 dim=40, WATER_EXP1 dim=64
      // The WATER_LIST starts with the smallest (lowest damage) and ends with largest (highest damage)
      for (const set of LAND_AWARE_SETS) {
        const maxDmg = MAX_DAMAGE[set];
        const lowDmg = combatAnim(1, set, 'water');
        const highDmg = combatAnim(maxDmg, set, 'water');
        expect(lowDmg, `set=${set} low damage`).toBe('water-exp3');
        expect(highDmg, `set=${set} max damage`).toBe('water-exp1');
      }
    });
  });

  // ── Category 5: SAM missile hitting aircraft -> flak animation ──────────────

  describe('SAM missile hitting aircraft produces flak animation', () => {
    // SAM site: warhead=AP, explosionSet=4, isAntiAir=true (types.ts:1125)
    // C++ combat.cpp:344: case 4, land==LAND_NONE -> ANIM_FLAK

    it('SAM warhead (AP) has explosionSet=4', () => {
      expect(WARHEAD_PROPS['AP' as WarheadType].explosionSet).toBe(4);
    });

    it('SAM damage (50) with explosionSet=4 over air → flak', () => {
      // SAM does 50 damage (types.ts scenario.ts:1125)
      const samDamage = 50;
      const samExpSet = WARHEAD_PROPS['AP' as WarheadType].explosionSet; // 4
      expect(combatAnim(samDamage, samExpSet, 'air')).toBe('flak');
    });

    it('any AP-warhead weapon hitting airborne target → flak', () => {
      // All weapons with AP warhead (Dragon, RedEye, Stinger, TorpTube, etc.)
      // produce flak when hitting an airborne target
      const apExpSet = WARHEAD_PROPS['AP' as WarheadType].explosionSet;
      const apWeaponDamages = [35, 50, 30, 90, 80]; // Dragon, SAM/RedEye, Stinger, TorpTube, DepthCharge
      for (const dmg of apWeaponDamages) {
        expect(combatAnim(dmg, apExpSet, 'air'), `AP dmg=${dmg} air`).toBe('flak');
      }
    });
  });

  // ── Category 6: Torpedo hitting ship on water -> water explosion ─────────────

  describe('torpedo hitting ship on water produces water explosion', () => {
    // TorpTube: warhead=AP (explosionSet=4), damage=90, isSubSurface=true
    // C++ combat.cpp:346: case 4, land==LAND_WATER -> _waterlist[...scaled by damage...]

    it('torpedo (TorpTube) damage=90 with AP set=4 over water → water-exp1', () => {
      // floor(2 * min(90, 90) / 90) = floor(2.0) = 2 → water-exp1 (largest)
      const torpDamage = 90;
      const torpExpSet = WARHEAD_PROPS['AP' as WarheadType].explosionSet; // 4
      expect(combatAnim(torpDamage, torpExpSet, 'water')).toBe('water-exp1');
    });

    it('torpedo impact over water selects from WATER_LIST, not AP_LIST', () => {
      const torpDamage = 90;
      const torpExpSet = WARHEAD_PROPS['AP' as WarheadType].explosionSet;
      const result = combatAnim(torpDamage, torpExpSet, 'water');
      // Must be one of the water sprites, NOT an AP ground sprite
      expect(CPP_WATER_LIST).toContain(result);
      expect(['veh-hit3', 'veh-hit2', 'frag1', 'fball1']).not.toContain(result);
    });

    it('lower-damage torpedo would produce smaller water splash', () => {
      // A hypothetical 30-damage torpedo: floor(2 * 30/90) = floor(0.666) = 0 → water-exp3
      const torpExpSet = WARHEAD_PROPS['AP' as WarheadType].explosionSet;
      expect(combatAnim(30, torpExpSet, 'water')).toBe('water-exp3');
    });
  });

  // ── Category 7: Depth charge -> water explosion ──────────────────────────────

  describe('depth charge produces water explosion', () => {
    // DepthCharge: warhead=AP (explosionSet=4), damage=80, isAntiSub=true
    // C++ combat.cpp:346: case 4, land==LAND_WATER -> _waterlist[...scaled by damage...]

    it('depth charge damage=80 with AP set=4 over water → water-exp2', () => {
      // floor(2 * min(80, 90) / 90) = floor(1.777) = 1 → water-exp2
      const dcDamage = 80;
      const dcExpSet = WARHEAD_PROPS['AP' as WarheadType].explosionSet; // 4
      expect(combatAnim(dcDamage, dcExpSet, 'water')).toBe('water-exp2');
    });

    it('depth charge impact over water selects from WATER_LIST', () => {
      const dcDamage = 80;
      const dcExpSet = WARHEAD_PROPS['AP' as WarheadType].explosionSet;
      const result = combatAnim(dcDamage, dcExpSet, 'water');
      expect(CPP_WATER_LIST).toContain(result);
    });
  });

  // ── Category 8: Frame counts for FLAK and WATER_EXP sprites ─────────────────

  describe('frame counts for FLAK and WATER_EXP sprites in EXPLOSION_FRAMES', () => {

    it('flak sprite exists in EXPLOSION_FRAMES with positive frame count', () => {
      // C++ adata.cpp:1873-1896: ANIM_FLAK, "FLAK", dim=8, Stages=-1
      expect(EXPLOSION_FRAMES['flak']).toBeDefined();
      expect(EXPLOSION_FRAMES['flak']).toBeGreaterThan(0);
    });

    it('flak has 8 frames (C++ FLAK.SHP, dimension=8)', () => {
      // C++ adata.cpp:1876: Maximum dimension = 8
      // EXPLOSION_FRAMES['flak'] = 8 (types.ts:520)
      expect(EXPLOSION_FRAMES['flak']).toBe(8);
    });

    it.each(CPP_WATER_LIST)(
      '%s exists in EXPLOSION_FRAMES with positive frame count',
      (sprite) => {
        expect(EXPLOSION_FRAMES[sprite], `${sprite} must exist`).toBeDefined();
        expect(EXPLOSION_FRAMES[sprite], `${sprite} must be positive`).toBeGreaterThan(0);
      }
    );

    it('water explosion sprites all have consistent frame counts', () => {
      // C++ adata.cpp: all three WATER_EXP use Stages=-1 (all SHP frames), NormalRate=true
      // They should all have the same frame count in the TS sprite sheets
      const counts = CPP_WATER_LIST.map(s => EXPLOSION_FRAMES[s]);
      expect(new Set(counts).size, 'all water-exp sprites should have same frame count').toBe(1);
    });

    it('water explosion frame count is 14', () => {
      // types.ts:523: 'water-exp1': 14, 'water-exp2': 14, 'water-exp3': 14
      for (const sprite of CPP_WATER_LIST) {
        expect(EXPLOSION_FRAMES[sprite]).toBe(14);
      }
    });

    it('h2o_exp alias frame counts also exist and match water-exp names', () => {
      // types.ts:521: 'h2o_exp1': 14, 'h2o_exp2': 14, 'h2o_exp3': 14
      // These are aliases matching the C++ SHP file names (H2O_EXP1.SHP etc.)
      expect(EXPLOSION_FRAMES['h2o_exp1']).toBe(EXPLOSION_FRAMES['water-exp1']);
      expect(EXPLOSION_FRAMES['h2o_exp2']).toBe(EXPLOSION_FRAMES['water-exp2']);
      expect(EXPLOSION_FRAMES['h2o_exp3']).toBe(EXPLOSION_FRAMES['water-exp3']);
    });
  });

  // ── Category 9: damage=0 guard applies to all sets including air/water ─────

  describe('damage=0 returns null even for air/water land types', () => {
    // C++ combat.cpp:301: if (damage == 0 || warhead == WARHEAD_NONE) return(ANIM_NONE);

    it.each(LAND_AWARE_SETS)(
      'damage=0, explosionSet=%d, land=air → null',
      (set) => {
        expect(combatAnim(0, set, 'air')).toBeNull();
      }
    );

    it.each(LAND_AWARE_SETS)(
      'damage=0, explosionSet=%d, land=water → null',
      (set) => {
        expect(combatAnim(0, set, 'water')).toBeNull();
      }
    );
  });

  // ── Category 10: Cross-validation — combatAnim returns consistent results ──

  describe('cross-validation: ground vs water vs air for same set/damage', () => {

    it.each(LAND_AWARE_SETS)(
      'set=%d: ground, water, and air all return different sprite families',
      (set) => {
        const dmg = 50;
        const ground = combatAnim(dmg, set, 'ground');
        const water = combatAnim(dmg, set, 'water');
        const air = combatAnim(dmg, set, 'air');

        // Air always returns flak
        expect(air).toBe('flak');

        // Water always returns a water-exp sprite
        expect(CPP_WATER_LIST).toContain(water);

        // Ground never returns flak or water sprite
        expect(ground).not.toBe('flak');
        expect(CPP_WATER_LIST).not.toContain(ground);
      }
    );
  });
});
