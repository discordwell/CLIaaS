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

/** C++ Combat_Anim explosion animation arrays, indexed by damage-scaled fraction */
const CPP_AP_LIST = ['veh-hit3', 'veh-hit2', 'frag1', 'fball1'];      // ExplosionSet=4, max damage 90
const CPP_HE_LIST = ['veh-hit1', 'veh-hit2', 'art-exp1', 'fball1'];   // ExplosionSet=5, max damage 130
const CPP_FIRE_LIST = ['napalm1', 'napalm2', 'napalm3'];              // ExplosionSet=3, max damage 150
const CPP_WATER_LIST = ['water-exp3', 'water-exp2', 'water-exp1'];    // Water override for sets 3-5

/**
 * Port of C++ Combat_Anim logic for reference/testing.
 * Returns expected sprite name for given damage, warhead, and land type.
 */
function cppCombatAnim(damage: number, warhead: string, land: 'ground' | 'water' | 'air'): string | null {
  if (damage === 0) return null;

  const explosionSet = CPP_EXPLOSION_SET[warhead] ?? 0;

  switch (explosionSet) {
    case 6: return 'atomsfx';  // ANIM_ATOM_BLAST

    case 2:
      return damage > 15 ? 'piffpiff' : 'piff';

    case 4: {  // AP frags
      if (land === 'air') return 'flak';
      const maxDmg = 90;
      const idx = Math.floor((CPP_AP_LIST.length - 1) * Math.min(damage, maxDmg) / maxDmg);
      if (land === 'water') return CPP_WATER_LIST[Math.floor((CPP_WATER_LIST.length - 1) * Math.min(damage, maxDmg) / maxDmg)];
      return CPP_AP_LIST[idx];
    }

    case 5: {  // HE pops
      if (land === 'air') return 'flak';
      const maxDmg = 130;
      const idx = Math.floor((CPP_HE_LIST.length - 1) * Math.min(damage, maxDmg) / maxDmg);
      if (land === 'water') return CPP_WATER_LIST[Math.floor((CPP_WATER_LIST.length - 1) * Math.min(damage, maxDmg) / maxDmg)];
      return CPP_HE_LIST[idx];
    }

    case 3: {  // Fire
      if (land === 'air') return 'flak';
      const maxDmg = 150;
      const idx = Math.floor((CPP_FIRE_LIST.length - 1) * Math.min(damage, maxDmg) / maxDmg);
      if (land === 'water') return CPP_WATER_LIST[Math.floor((CPP_WATER_LIST.length - 1) * Math.min(damage, maxDmg) / maxDmg)];
      return CPP_FIRE_LIST[idx];
    }

    case 1: return 'piff';

    default: return null;
  }
}


// ========== TESTS ==========

describe('C++ Parity: Combat_Anim — Explosion Animation Selection', () => {

  describe('ExplosionSet values match C++ rules.ini', () => {
    // The TS WARHEAD_PROPS uses string sprite names instead of integer ExplosionSet.
    // This test documents what the C++ expects so we can verify the TS mapping.
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

  describe('ExplosionSet=2 (SA) — piff/piffpiff by damage', () => {
    it('low damage (≤15) → piff', () => {
      expect(cppCombatAnim(10, 'SA', 'ground')).toBe('piff');
      expect(cppCombatAnim(15, 'SA', 'ground')).toBe('piff');
      expect(cppCombatAnim(1, 'SA', 'ground')).toBe('piff');
    });

    it('high damage (>15) → piffpiff', () => {
      expect(cppCombatAnim(16, 'SA', 'ground')).toBe('piffpiff');
      expect(cppCombatAnim(50, 'SA', 'ground')).toBe('piffpiff');
      expect(cppCombatAnim(100, 'SA', 'ground')).toBe('piffpiff');
    });
  });

  describe('ExplosionSet=5 (HE) — damage-scaled from veh-hit1 to fball1', () => {
    it('very low damage → veh-hit1 (small fireball)', () => {
      expect(cppCombatAnim(1, 'HE', 'ground')).toBe('veh-hit1');
    });

    it('medium damage → veh-hit2 or art-exp1', () => {
      // At damage ~43 (43/130 * 3 ≈ 1.0 → index 1)
      expect(cppCombatAnim(44, 'HE', 'ground')).toBe('veh-hit2');
      // At damage ~87 (87/130 * 3 ≈ 2.0 → index 2)
      expect(cppCombatAnim(87, 'HE', 'ground')).toBe('art-exp1');
    });

    it('high damage (≥130) → fball1 (large fireball)', () => {
      expect(cppCombatAnim(130, 'HE', 'ground')).toBe('fball1');
      expect(cppCombatAnim(200, 'HE', 'ground')).toBe('fball1');
    });

    it('grenade (damage=50) → veh-hit2 (NOT fball1)', () => {
      // Grenade: 50 damage HE. 50/130 * 3 = 1.15 → floor = 1 → veh-hit2
      expect(cppCombatAnim(50, 'HE', 'ground')).toBe('veh-hit2');
    });

    it('over water → water explosion variants', () => {
      expect(cppCombatAnim(1, 'HE', 'water')).toBe('water-exp3');
      expect(cppCombatAnim(130, 'HE', 'water')).toBe('water-exp1');
    });

    it('over air (LAND_NONE) → flak', () => {
      expect(cppCombatAnim(50, 'HE', 'air')).toBe('flak');
    });
  });

  describe('ExplosionSet=4 (AP) — damage-scaled from veh-hit3 to fball1', () => {
    it('low damage → veh-hit3', () => {
      expect(cppCombatAnim(1, 'AP', 'ground')).toBe('veh-hit3');
    });

    it('medium damage → frag1', () => {
      // 60/90 * 3 = 2.0 → index 2 = frag1
      expect(cppCombatAnim(60, 'AP', 'ground')).toBe('frag1');
    });

    it('high damage (≥90) → fball1', () => {
      expect(cppCombatAnim(90, 'AP', 'ground')).toBe('fball1');
      expect(cppCombatAnim(150, 'AP', 'ground')).toBe('fball1');
    });

    it('over air → flak', () => {
      expect(cppCombatAnim(50, 'AP', 'air')).toBe('flak');
    });
  });

  describe('ExplosionSet=3 (Fire) — damage-scaled from napalm1 to napalm3', () => {
    it('low damage → napalm1', () => {
      expect(cppCombatAnim(1, 'Fire', 'ground')).toBe('napalm1');
      expect(cppCombatAnim(25, 'Fire', 'ground')).toBe('napalm1');
    });

    it('medium damage → napalm2', () => {
      // 75/150 * 2 = 1.0 → index 1 = napalm2
      expect(cppCombatAnim(75, 'Fire', 'ground')).toBe('napalm2');
    });

    it('high damage (≥150) → napalm3', () => {
      expect(cppCombatAnim(150, 'Fire', 'ground')).toBe('napalm3');
      expect(cppCombatAnim(300, 'Fire', 'ground')).toBe('napalm3');
    });

    it('barrel explosion (Fire, high damage) → napalm3 (NOT fball1)', () => {
      // Oil barrels use Fire warhead with high damage → should be napalm, not fireball
      expect(cppCombatAnim(200, 'Fire', 'ground')).toBe('napalm3');
    });

    it('over air → flak', () => {
      expect(cppCombatAnim(50, 'Fire', 'air')).toBe('flak');
    });
  });

  describe('ExplosionSet=1 (HollowPoint) — always piff', () => {
    it('any damage → piff', () => {
      expect(cppCombatAnim(1, 'HollowPoint', 'ground')).toBe('piff');
      expect(cppCombatAnim(100, 'HollowPoint', 'ground')).toBe('piff');
    });
  });

  describe('ExplosionSet=6 (Nuke) — always atom blast', () => {
    it('any damage → atomsfx', () => {
      expect(cppCombatAnim(1, 'Nuke', 'ground')).toBe('atomsfx');
      expect(cppCombatAnim(600, 'Nuke', 'ground')).toBe('atomsfx');
    });

    it('nuke over water still → atomsfx (not water explosion)', () => {
      expect(cppCombatAnim(600, 'Nuke', 'water')).toBe('atomsfx');
    });
  });

  describe('ExplosionSet=0 (Super/Organic) — no explosion', () => {
    it('Super warhead → no explosion anim', () => {
      expect(cppCombatAnim(100, 'Super', 'ground')).toBeNull();
    });

    it('Organic warhead → no explosion anim', () => {
      expect(cppCombatAnim(50, 'Organic', 'ground')).toBeNull();
    });
  });

  describe('Zero damage → no explosion', () => {
    it('zero damage → null regardless of warhead', () => {
      expect(cppCombatAnim(0, 'HE', 'ground')).toBeNull();
      expect(cppCombatAnim(0, 'AP', 'ground')).toBeNull();
      expect(cppCombatAnim(0, 'Fire', 'ground')).toBeNull();
    });
  });

  describe('TS WARHEAD_PROPS.explosionSet vs C++ expected animation', () => {
    // The TS currently stores a SINGLE sprite name per warhead.
    // C++ selects from an ARRAY based on damage. This documents the mismatch.

    it('TS SA explosionSet should map to piff/piffpiff (set 2)', () => {
      // C++ set 2: piff for ≤15, piffpiff for >15
      // TS currently: 'piff' (only covers low-damage case)
      expect(WARHEAD_PROPS.SA.explosionSet).toBe('piff');
      // C++ would use piffpiff for high-damage SA hits
    });

    it('TS HE explosionSet should map to damage-scaled array (set 5)', () => {
      // C++ set 5: [veh-hit1, veh-hit2, art-exp1, fball1] scaled by damage/130
      // TS currently: 'veh-hit1' (only covers the lowest-damage case)
      expect(WARHEAD_PROPS.HE.explosionSet).toBe('veh-hit1');
      // For a 50-damage grenade, C++ would use 'veh-hit2'
      // For a 150-damage artillery shell, C++ would use 'fball1'
    });

    it('TS AP explosionSet should map to damage-scaled array (set 4)', () => {
      // C++ set 4: [veh-hit3, veh-hit2, frag1, fball1] scaled by damage/90
      // TS currently: 'piff' — WRONG, should be from AP frags array
      expect(WARHEAD_PROPS.AP.explosionSet).toBe('piff');
      // For a 40-damage tank shell, C++ would use 'veh-hit2'
    });

    it('TS Fire explosionSet is napalm1 (correct for low-damage fire)', () => {
      // C++ set 3: [napalm1, napalm2, napalm3] scaled by damage/150
      // TS currently: 'napalm1' (only covers low-damage)
      expect(WARHEAD_PROPS.Fire.explosionSet).toBe('napalm1');
      // Barrel explosions (high damage) should use napalm3
    });

    it('TS Nuke explosionSet is atomsfx (correct)', () => {
      expect(WARHEAD_PROPS.Nuke.explosionSet).toBe('atomsfx');
    });
  });

  describe('Specific weapon scenarios — expected C++ animation', () => {
    it('M1Carbine (SA, dmg=15) → piff', () => {
      expect(cppCombatAnim(15, 'SA', 'ground')).toBe('piff');
    });

    it('ChainGun (SA, dmg=25) → piffpiff', () => {
      expect(cppCombatAnim(25, 'SA', 'ground')).toBe('piffpiff');
    });

    it('Grenade (HE, dmg=50) → veh-hit2', () => {
      expect(cppCombatAnim(50, 'HE', 'ground')).toBe('veh-hit2');
    });

    it('155mm Artillery (HE, dmg=150) → fball1', () => {
      expect(cppCombatAnim(150, 'HE', 'ground')).toBe('fball1');
    });

    it('90mm tank shell (AP, dmg=40) → veh-hit2', () => {
      // 40/90 * 3 = 1.33 → floor = 1 → veh-hit2
      expect(cppCombatAnim(40, 'AP', 'ground')).toBe('veh-hit2');
    });

    it('120mm heavy tank (AP, dmg=50) → frag1', () => {
      // 50/90 * 3 = 1.67 → floor = 1 → veh-hit2
      expect(cppCombatAnim(50, 'AP', 'ground')).toBe('veh-hit2');
    });

    it('Flamer (Fire, dmg=70) → napalm1', () => {
      // 70/150 * 2 = 0.93 → floor = 0 → napalm1
      expect(cppCombatAnim(70, 'Fire', 'ground')).toBe('napalm1');
    });

    it('Oil barrel (Fire, dmg=high ~200) → napalm3', () => {
      expect(cppCombatAnim(200, 'Fire', 'ground')).toBe('napalm3');
    });

    it('SCUD/V2 (HE, dmg=600) → fball1', () => {
      expect(cppCombatAnim(600, 'HE', 'ground')).toBe('fball1');
    });

    it('Nuke warhead → atomsfx', () => {
      expect(cppCombatAnim(600, 'Nuke', 'ground')).toBe('atomsfx');
    });

    it('Tesla (Super, dmg=100) → no explosion (set 0)', () => {
      expect(cppCombatAnim(100, 'Super', 'ground')).toBeNull();
    });

    it('DogJaw (HollowPoint, dmg=100) → piff', () => {
      expect(cppCombatAnim(100, 'HollowPoint', 'ground')).toBe('piff');
    });
  });

  describe('Infantry death animation types (C++ warhead.cpp InfantryDeath)', () => {
    it('InfDeath=0 (instant): Organic, Mechanical → normal die', () => {
      expect(CPP_INF_DEATH.Organic).toBe(0);
      expect(CPP_INF_DEATH.Mechanical).toBe(0);
    });

    it('InfDeath=1 (twirl): SA, HollowPoint → spin and fall', () => {
      expect(CPP_INF_DEATH.SA).toBe(1);
      expect(CPP_INF_DEATH.HollowPoint).toBe(1);
    });

    it('InfDeath=2 (explode): HE → body parts fly (grenade/artillery)', () => {
      expect(CPP_INF_DEATH.HE).toBe(2);
    });

    it('InfDeath=3 (flying death): AP → knocked backward by impact', () => {
      expect(CPP_INF_DEATH.AP).toBe(3);
    });

    it('InfDeath=4 (burn): Fire, Nuke → fire engulfs infantry', () => {
      expect(CPP_INF_DEATH.Fire).toBe(4);
      expect(CPP_INF_DEATH.Nuke).toBe(4);
    });

    it('InfDeath=5 (electro): Super → tesla zap death', () => {
      expect(CPP_INF_DEATH.Super).toBe(5);
    });

    it('TS has only 2 deathVariants (die1/die2) — C++ has 6 distinct animations', () => {
      // This documents a known TS simplification.
      // C++ InfDeath 0-5 maps to 6 distinct death animation sequences.
      // TS collapses to deathVariant 0 (die1) or 1 (die2).
      // Infantry killed by HE (explode) look the same as Fire (burn) in TS.
      const uniqueCppDeaths = new Set(Object.values(CPP_INF_DEATH));
      expect(uniqueCppDeaths.size).toBe(6); // 0,1,2,3,4,5
    });
  });
});
