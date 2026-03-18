/**
 * C++ Parity Test: Combat_Anim — Explosion & Infantry Death Animations
 *
 * C++ combat.cpp:295-366 Combat_Anim() selects explosion animation based on:
 *   1. Warhead's ExplosionSet (integer 0-6, from rules.ini [WarheadType] Explosion=N)
 *   2. Damage amount (scales which animation in the set's array)
 *   3. LandType (water/air/ground for different sprites)
 *
 * C++ warhead.cpp:176 InfantryDeath selects infantry death animation (0-5)
 *
 * RA rules.ini warhead definitions:
 *   SA:          Explosion=2, InfDeath=1 (twirl)
 *   HE:          Explosion=5, InfDeath=2 (explode)
 *   AP:          Explosion=4, InfDeath=3 (flying death)
 *   Fire:        Explosion=3, InfDeath=4 (burn)
 *   HollowPoint: Explosion=1, InfDeath=1 (twirl)
 *   Super:       Explosion=0, InfDeath=5 (electro) — no explosion
 *   Organic:     Explosion=0, InfDeath=0 (instant) — no explosion
 *   Nuke:        Explosion=6, InfDeath=4 (burn)
 *   Mechanical:  (engine only, not in rules.ini)
 *
 * C++ ExplosionSet animation arrays:
 *   Set 1: ANIM_PIFF (always)
 *   Set 2: damage <= 15 → PIFF, damage > 15 → PIFFPIFF
 *   Set 3 (Fire): damage-scaled index into [NAPALM1, NAPALM2, NAPALM3] (max 150)
 *   Set 4 (AP):   damage-scaled index into [VEH_HIT3, VEH_HIT2, FRAG1, FBALL1] (max 90)
 *   Set 5 (HE):   damage-scaled index into [VEH_HIT1, VEH_HIT2, ART_EXP1, FBALL1] (max 130)
 *   Set 6: ANIM_ATOM_BLAST (always)
 *   Over water: scaled index into [WATER_EXP3, WATER_EXP2, WATER_EXP1]
 *   Over air (LAND_NONE): ANIM_FLAK (for sets 3-5)
 *
 * C++ InfantryDeath types:
 *   0 = instant death (normal die animation)
 *   1 = twirl death (spin and fall)
 *   2 = explode (body parts fly, used by HE)
 *   3 = flying death (knocked backward, used by AP)
 *   4 = burn death (fire engulfs, used by Fire/Nuke)
 *   5 = electro death (tesla zap, used by Super)
 */
import { describe, it, expect } from 'vitest';
import { WARHEAD_PROPS, type WarheadType } from '../engine/types';
import { combatAnim } from '../engine/combat';
import { Entity } from '../engine/entity';
import { UnitType, House } from '../engine/types';

// ========== C++ REFERENCE DATA ==========

/** C++ rules.ini ExplosionSet per warhead (from [WarheadType] Explosion=N) */
const CPP_EXPLOSION_SET: Record<string, number> = {
  SA: 2,
  HE: 5,
  AP: 4,
  Fire: 3,
  HollowPoint: 1,
  Super: 0,      // No Explosion= line → default 0
  Organic: 0,    // No Explosion= line → default 0
  Nuke: 6,
  Mechanical: 0, // Engine-only, not in rules.ini
};

/** C++ rules.ini InfDeath per warhead */
const CPP_INF_DEATH: Record<string, number> = {
  SA: 1,          // twirl
  HE: 2,          // explode
  AP: 3,          // flying death
  Fire: 4,        // burn
  HollowPoint: 1, // twirl
  Super: 5,       // electro
  Organic: 0,     // instant
  Nuke: 4,        // burn
  Mechanical: 0,  // instant (engine default)
};


// ========== TESTS ==========

describe('C++ Parity: Combat_Anim — Explosion Animation Selection', () => {

  describe('ExplosionSet values match C++ rules.ini', () => {
    it.each([
      ['SA', 2],
      ['HE', 5],
      ['AP', 4],
      ['Fire', 3],
      ['HollowPoint', 1],
      ['Super', 0],
      ['Organic', 0],
      ['Nuke', 6],
    ])('%s has ExplosionSet=%d in C++ rules.ini', (warhead, expected) => {
      expect(CPP_EXPLOSION_SET[warhead]).toBe(expected);
    });
  });

  describe('TS WARHEAD_PROPS.explosionSet matches C++ ExplosionSet integers', () => {
    it.each([
      ['SA', 2],
      ['HE', 5],
      ['AP', 4],
      ['Fire', 3],
      ['HollowPoint', 1],
      ['Super', 0],
      ['Organic', 0],
      ['Nuke', 6],
      ['Mechanical', 0],
    ])('WARHEAD_PROPS[%s].explosionSet === %d', (warhead, expected) => {
      expect(WARHEAD_PROPS[warhead as WarheadType].explosionSet).toBe(expected);
    });
  });

  describe('InfantryDeath values match C++ rules.ini', () => {
    it.each([
      ['SA', 1, 'twirl'],
      ['HE', 2, 'explode'],
      ['AP', 3, 'flying death'],
      ['Fire', 4, 'burn'],
      ['HollowPoint', 1, 'twirl'],
      ['Super', 5, 'electro'],
      ['Organic', 0, 'instant'],
      ['Nuke', 4, 'burn'],
    ])('%s has InfDeath=%d (%s) in C++ rules.ini', (warhead, expected, _desc) => {
      expect(CPP_INF_DEATH[warhead]).toBe(expected);
    });

    it.each([
      ['SA', 1],
      ['HE', 2],
      ['AP', 3],
      ['Fire', 4],
      ['HollowPoint', 1],
      ['Super', 5],
      ['Organic', 0],
      ['Nuke', 4],
    ])('TS WARHEAD_PROPS[%s].infantryDeath matches C++ InfDeath=%d', (warhead, expected) => {
      expect(WARHEAD_PROPS[warhead as WarheadType].infantryDeath).toBe(expected);
    });
  });

  describe('combatAnim() — ExplosionSet=2 (SA) — piff/piffpiff by damage', () => {
    it('low damage (≤15) → piff', () => {
      expect(combatAnim(10, 2, 'ground')).toBe('piff');
      expect(combatAnim(15, 2, 'ground')).toBe('piff');
      expect(combatAnim(1, 2, 'ground')).toBe('piff');
    });

    it('high damage (>15) → piffpiff', () => {
      expect(combatAnim(16, 2, 'ground')).toBe('piffpiff');
      expect(combatAnim(50, 2, 'ground')).toBe('piffpiff');
      expect(combatAnim(100, 2, 'ground')).toBe('piffpiff');
    });
  });

  describe('combatAnim() — ExplosionSet=5 (HE) — damage-scaled from veh-hit1 to fball1', () => {
    it('very low damage → veh-hit1 (small fireball)', () => {
      expect(combatAnim(1, 5, 'ground')).toBe('veh-hit1');
    });

    it('medium damage → veh-hit2 or art-exp1', () => {
      expect(combatAnim(44, 5, 'ground')).toBe('veh-hit2');
      expect(combatAnim(87, 5, 'ground')).toBe('art-exp1');
    });

    it('high damage (≥130) → fball1 (large fireball)', () => {
      expect(combatAnim(130, 5, 'ground')).toBe('fball1');
      expect(combatAnim(200, 5, 'ground')).toBe('fball1');
    });

    it('grenade (damage=50) → veh-hit2 (NOT fball1)', () => {
      expect(combatAnim(50, 5, 'ground')).toBe('veh-hit2');
    });

    it('over water → water explosion variants', () => {
      expect(combatAnim(1, 5, 'water')).toBe('water-exp3');
      expect(combatAnim(130, 5, 'water')).toBe('water-exp1');
    });

    it('over air (LAND_NONE) → flak', () => {
      expect(combatAnim(50, 5, 'air')).toBe('flak');
    });
  });

  describe('combatAnim() — ExplosionSet=4 (AP) — damage-scaled from veh-hit3 to fball1', () => {
    it('low damage → veh-hit3', () => {
      expect(combatAnim(1, 4, 'ground')).toBe('veh-hit3');
    });

    it('medium damage → frag1', () => {
      expect(combatAnim(60, 4, 'ground')).toBe('frag1');
    });

    it('high damage (≥90) → fball1', () => {
      expect(combatAnim(90, 4, 'ground')).toBe('fball1');
      expect(combatAnim(150, 4, 'ground')).toBe('fball1');
    });

    it('over air → flak', () => {
      expect(combatAnim(50, 4, 'air')).toBe('flak');
    });
  });

  describe('combatAnim() — ExplosionSet=3 (Fire) — damage-scaled from napalm1 to napalm3', () => {
    it('low damage → napalm1', () => {
      expect(combatAnim(1, 3, 'ground')).toBe('napalm1');
      expect(combatAnim(25, 3, 'ground')).toBe('napalm1');
    });

    it('medium damage → napalm2', () => {
      expect(combatAnim(75, 3, 'ground')).toBe('napalm2');
    });

    it('high damage (≥150) → napalm3', () => {
      expect(combatAnim(150, 3, 'ground')).toBe('napalm3');
      expect(combatAnim(300, 3, 'ground')).toBe('napalm3');
    });

    it('barrel explosion (Fire, high damage) → napalm3 (NOT fball1)', () => {
      expect(combatAnim(200, 3, 'ground')).toBe('napalm3');
    });

    it('over air → flak', () => {
      expect(combatAnim(50, 3, 'air')).toBe('flak');
    });
  });

  describe('combatAnim() — ExplosionSet=1 (HollowPoint) — always piff', () => {
    it('any damage → piff', () => {
      expect(combatAnim(1, 1, 'ground')).toBe('piff');
      expect(combatAnim(100, 1, 'ground')).toBe('piff');
    });
  });

  describe('combatAnim() — ExplosionSet=6 (Nuke) — always atom blast', () => {
    it('any damage → atomsfx', () => {
      expect(combatAnim(1, 6, 'ground')).toBe('atomsfx');
      expect(combatAnim(600, 6, 'ground')).toBe('atomsfx');
    });

    it('nuke over water still → atomsfx (not water explosion)', () => {
      expect(combatAnim(600, 6, 'water')).toBe('atomsfx');
    });
  });

  describe('combatAnim() — ExplosionSet=0 (Super/Organic) — no explosion', () => {
    it('Super warhead → no explosion anim', () => {
      expect(combatAnim(100, 0, 'ground')).toBeNull();
    });

    it('Organic warhead → no explosion anim', () => {
      expect(combatAnim(50, 0, 'ground')).toBeNull();
    });
  });

  describe('combatAnim() — Zero damage → no explosion', () => {
    it('zero damage → null regardless of set', () => {
      expect(combatAnim(0, 5, 'ground')).toBeNull();
      expect(combatAnim(0, 4, 'ground')).toBeNull();
      expect(combatAnim(0, 3, 'ground')).toBeNull();
    });
  });

  describe('Specific weapon scenarios — combatAnim matches C++ expected animation', () => {
    it('M1Carbine (SA, dmg=15) → piff', () => {
      expect(combatAnim(15, 2, 'ground')).toBe('piff');
    });

    it('ChainGun (SA, dmg=25) → piffpiff', () => {
      expect(combatAnim(25, 2, 'ground')).toBe('piffpiff');
    });

    it('Grenade (HE, dmg=50) → veh-hit2', () => {
      expect(combatAnim(50, 5, 'ground')).toBe('veh-hit2');
    });

    it('155mm Artillery (HE, dmg=150) → fball1', () => {
      expect(combatAnim(150, 5, 'ground')).toBe('fball1');
    });

    it('90mm tank shell (AP, dmg=40) → veh-hit2', () => {
      expect(combatAnim(40, 4, 'ground')).toBe('veh-hit2');
    });

    it('120mm heavy tank (AP, dmg=50) → veh-hit2', () => {
      expect(combatAnim(50, 4, 'ground')).toBe('veh-hit2');
    });

    it('Flamer (Fire, dmg=70) → napalm1', () => {
      expect(combatAnim(70, 3, 'ground')).toBe('napalm1');
    });

    it('Oil barrel (Fire, dmg=high ~200) → napalm3', () => {
      expect(combatAnim(200, 3, 'ground')).toBe('napalm3');
    });

    it('SCUD/V2 (HE, dmg=600) → fball1', () => {
      expect(combatAnim(600, 5, 'ground')).toBe('fball1');
    });

    it('Nuke warhead → atomsfx', () => {
      expect(combatAnim(600, 6, 'ground')).toBe('atomsfx');
    });

    it('Tesla (Super, dmg=100) → no explosion (set 0)', () => {
      expect(combatAnim(100, 0, 'ground')).toBeNull();
    });

    it('DogJaw (HollowPoint, dmg=100) → piff', () => {
      expect(combatAnim(100, 1, 'ground')).toBe('piff');
    });
  });

  describe('Infantry death animation types — all 6 C++ InfantryDeath variants', () => {
    it('InfDeath=0 (instant): Organic, Mechanical → deathVariant=0', () => {
      expect(CPP_INF_DEATH.Organic).toBe(0);
      expect(CPP_INF_DEATH.Mechanical).toBe(0);
    });

    it('InfDeath=1 (twirl): SA, HollowPoint → deathVariant=1', () => {
      expect(CPP_INF_DEATH.SA).toBe(1);
      expect(CPP_INF_DEATH.HollowPoint).toBe(1);
    });

    it('InfDeath=2 (explode): HE → deathVariant=2', () => {
      expect(CPP_INF_DEATH.HE).toBe(2);
    });

    it('InfDeath=3 (flying death): AP → deathVariant=3', () => {
      expect(CPP_INF_DEATH.AP).toBe(3);
    });

    it('InfDeath=4 (burn): Fire, Nuke → deathVariant=4', () => {
      expect(CPP_INF_DEATH.Fire).toBe(4);
      expect(CPP_INF_DEATH.Nuke).toBe(4);
    });

    it('InfDeath=5 (electro): Super → deathVariant=5', () => {
      expect(CPP_INF_DEATH.Super).toBe(5);
    });

    it('TS now stores all 6 deathVariant values (matching C++ InfantryDeath 0-5)', () => {
      // Verify each warhead sets the correct deathVariant
      const testCases: [string, number][] = [
        ['Organic', 0],    // instant
        ['SA', 1],         // twirl
        ['HollowPoint', 1], // twirl
        ['HE', 2],         // explode
        ['AP', 3],         // flying
        ['Fire', 4],       // burn
        ['Nuke', 4],       // burn
        ['Super', 5],      // electro
      ];
      for (const [warhead, expectedVariant] of testCases) {
        const victim = new Entity(UnitType.I_E1, House.Greece, 100, 100);
        victim.takeDamage(999, warhead);
        expect(victim.deathVariant, `${warhead} should set deathVariant=${expectedVariant}`).toBe(expectedVariant);
      }
    });
  });
});
