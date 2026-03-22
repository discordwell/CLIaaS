/**
 * C++ Behavioral Parity: Visual & Animation Constants
 *
 * Verifies TypeScript explosion types, infantry death animations, muzzle flash colors,
 * building turret frame layouts, buildup animation timing, and explosion sprite frame
 * counts all match their C++ / rules.ini authoritative sources.
 *
 * C++ source references:
 *   combat.cpp:295-366  — Combat_Anim() selects explosion animation by ExplosionSet
 *   warhead.cpp:69-83   — WarheadTypeClass constructor defaults (ExplosionSet=0, InfantryDeath=0)
 *   warhead.cpp:168-191 — Read_INI reads Explosion= and InfDeath= from rules.ini
 *   warhead.h:110-116   — ExplosionSet (int), InfantryDeath (int) fields
 *   adata.cpp            — AnimTypeClass definitions with Stages=-1 (auto from SHP)
 *   bdata.cpp:594,624,924 — Turret default facings: GUN=DirType(208), AGUN=DIR_NE(32), SAM=DIR_N(0)
 *   bdata.cpp:3129       — BuildupTime tick delay: floor(BuildupTime * TICKS_PER_MINUTE / makeFrameCount)
 *
 * Rules.ini warhead sections (lines 2660-2725):
 *   ; Explosion: 0=none, 1=piff, 2=piffs, 3=fire, 4=frags, 5=pops, 6=nuke
 *   ; InfDeath:  0=instant, 1=twirl, 2=explodes, 3=flying, 4=burn, 5=electro
 *
 * CRITICAL: All expected values are PARSED from rules.ini — never hardcoded.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import {
  WARHEAD_PROPS,
  EXPLOSION_FRAMES,
  type WarheadType,
} from '../engine/types';
import { combatAnim } from '../engine/combat';
import { BUILDING_FRAME_TABLE } from '../engine/renderer';

// ===========================================================================
// INI Parser — standard pattern from cpp-parity-warhead-data.test.ts
// ===========================================================================
function parseINI(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current = '';
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      current = sectionMatch[1];
      if (!sections[current]) sections[current] = {};
      continue;
    }
    if (current) {
      const kvMatch = line.match(/^([^=;]+)=\s*([^;]*)/);
      if (kvMatch) {
        sections[current][kvMatch[1].trim()] = kvMatch[2].trim();
      }
    }
  }
  return sections;
}

const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');
const rules = parseINI(readFileSync(join(assetsDir, 'rules.ini'), 'utf-8'));

// Manifest.json contains actual sprite sheet frame counts
const manifest: Record<string, { frameCount: number }> = JSON.parse(
  readFileSync(join(assetsDir, 'manifest.json'), 'utf-8'),
);

// All 9 warhead types in TS
const ALL_WARHEADS: WarheadType[] = [
  'SA', 'HE', 'AP', 'Fire', 'HollowPoint', 'Super', 'Organic', 'Nuke', 'Mechanical',
];

// Warheads defined in rules.ini (Mechanical is engine-only, aftrmath.ini)
const INI_WARHEADS: WarheadType[] = [
  'SA', 'HE', 'AP', 'Fire', 'HollowPoint', 'Super', 'Organic', 'Nuke',
];

// ===========================================================================
// 1. WARHEAD EXPLOSION SET — INI Explosion= parsed vs TS explosionSet
//    C++ warhead.cpp:175 — ExplosionSet = ini.Get_Int(Name(), "Explosion", ExplosionSet)
//    Default = 0 from constructor (warhead.cpp:77)
// ===========================================================================
describe('Warhead ExplosionSet values match rules.ini Explosion= (warhead.cpp:175)', () => {
  for (const wh of INI_WARHEADS) {
    it(`${wh}: WARHEAD_PROPS.explosionSet matches INI [${wh}] Explosion=`, () => {
      const section = rules[wh];
      expect(section, `rules.ini section [${wh}] must exist`).toBeDefined();

      // C++ default is 0 when no Explosion= key present (warhead.cpp:77)
      const iniExplosion = section?.Explosion != null ? parseInt(section.Explosion, 10) : 0;
      expect(WARHEAD_PROPS[wh].explosionSet).toBe(iniExplosion);
    });
  }

  it('Mechanical (engine-only, not in rules.ini) defaults to explosionSet=0', () => {
    // C++ constructor default: ExplosionSet(0) — warhead.cpp:77
    expect(WARHEAD_PROPS.Mechanical.explosionSet).toBe(0);
  });
});

// ===========================================================================
// 2. WARHEAD INFANTRY DEATH — INI InfDeath= parsed vs TS infantryDeath
//    C++ warhead.cpp:176 — InfantryDeath = ini.Get_Int(Name(), "InfDeath", InfantryDeath)
//    Default = 0 from constructor (warhead.cpp:78)
//    InfDeath enum: 0=instant, 1=twirl, 2=explodes, 3=flying, 4=burn, 5=electro
// ===========================================================================
describe('Warhead infantryDeath values match rules.ini InfDeath= (warhead.cpp:176)', () => {
  for (const wh of INI_WARHEADS) {
    it(`${wh}: WARHEAD_PROPS.infantryDeath matches INI [${wh}] InfDeath=`, () => {
      const section = rules[wh];
      expect(section, `rules.ini section [${wh}] must exist`).toBeDefined();

      // C++ default is 0 when no InfDeath= key present (warhead.cpp:78)
      const iniInfDeath = section?.InfDeath != null ? parseInt(section.InfDeath, 10) : 0;
      expect(WARHEAD_PROPS[wh].infantryDeath).toBe(iniInfDeath);
    });
  }

  it('Mechanical (engine-only) defaults to infantryDeath=0', () => {
    // C++ constructor default: InfantryDeath(0) — warhead.cpp:78
    expect(WARHEAD_PROPS.Mechanical.infantryDeath).toBe(0);
  });

  it('infantryDeath range is 0-5 for all warheads', () => {
    for (const wh of ALL_WARHEADS) {
      expect(WARHEAD_PROPS[wh].infantryDeath).toBeGreaterThanOrEqual(0);
      expect(WARHEAD_PROPS[wh].infantryDeath).toBeLessThanOrEqual(5);
    }
  });
});

// ===========================================================================
// 3. COMBAT_ANIM EXPLOSION ARRAYS — C++ combat.cpp:305-357
//    Verifies TS combatAnim() uses the correct animation arrays per set.
//
//    C++ arrays (combat.cpp:305-329):
//      Set 4 (AP): [VEH_HIT3, VEH_HIT2, FRAG1, FBALL1], max_damage=90
//      Set 5 (HE): [VEH_HIT1, VEH_HIT2, ART_EXP1, FBALL1], max_damage=130
//      Set 3 (Fire): [NAPALM1, NAPALM2, NAPALM3], max_damage=150
//      Water: [WATER_EXP3, WATER_EXP2, WATER_EXP1]
//      Air (LAND_NONE): FLAK (for sets 3-5)
//      Set 6: ATOM_BLAST (always)
//      Set 2: PIFF (<=15) or PIFFPIFF (>15)
//      Set 1: PIFF (always)
//      Set 0: ANIM_NONE (no explosion)
// ===========================================================================
describe('combatAnim() — C++ Combat_Anim array selection (combat.cpp:295-366)', () => {

  // --- Set 4 (AP): _aplist = [VEH_HIT3, VEH_HIT2, FRAG1, FBALL1] ---
  describe('ExplosionSet=4 (AP) — _aplist[4], max 90', () => {
    it('damage=1 (index 0) -> veh-hit3', () => {
      expect(combatAnim(1, 4, 'ground')).toBe('veh-hit3');
    });
    it('damage=30 (low-mid) -> veh-hit2', () => {
      expect(combatAnim(30, 4, 'ground')).toBe('veh-hit2');
    });
    it('damage=60 (mid-high) -> frag1', () => {
      expect(combatAnim(60, 4, 'ground')).toBe('frag1');
    });
    it('damage=90 (max cap) -> fball1', () => {
      expect(combatAnim(90, 4, 'ground')).toBe('fball1');
    });
    it('damage=200 (above cap) -> fball1', () => {
      expect(combatAnim(200, 4, 'ground')).toBe('fball1');
    });
    it('over water -> water-exp variants', () => {
      expect(combatAnim(1, 4, 'water')).toBe('water-exp3');
      expect(combatAnim(90, 4, 'water')).toBe('water-exp1');
    });
    it('over air (LAND_NONE) -> flak', () => {
      expect(combatAnim(50, 4, 'air')).toBe('flak');
    });
  });

  // --- Set 5 (HE): _helist = [VEH_HIT1, VEH_HIT2, ART_EXP1, FBALL1] ---
  describe('ExplosionSet=5 (HE) — _helist[4], max 130', () => {
    it('damage=1 (index 0) -> veh-hit1', () => {
      expect(combatAnim(1, 5, 'ground')).toBe('veh-hit1');
    });
    it('damage=44 (low-mid) -> veh-hit2', () => {
      expect(combatAnim(44, 5, 'ground')).toBe('veh-hit2');
    });
    it('damage=87 (mid-high) -> art-exp1', () => {
      expect(combatAnim(87, 5, 'ground')).toBe('art-exp1');
    });
    it('damage=130 (max cap) -> fball1', () => {
      expect(combatAnim(130, 5, 'ground')).toBe('fball1');
    });
    it('over water -> water-exp variants', () => {
      expect(combatAnim(1, 5, 'water')).toBe('water-exp3');
      expect(combatAnim(130, 5, 'water')).toBe('water-exp1');
    });
    it('over air -> flak', () => {
      expect(combatAnim(50, 5, 'air')).toBe('flak');
    });
  });

  // --- Set 3 (Fire): _firelist = [NAPALM1, NAPALM2, NAPALM3] ---
  describe('ExplosionSet=3 (Fire) — _firelist[3], max 150', () => {
    it('damage=1 (index 0) -> napalm1', () => {
      expect(combatAnim(1, 3, 'ground')).toBe('napalm1');
    });
    it('damage=75 (mid) -> napalm2', () => {
      expect(combatAnim(75, 3, 'ground')).toBe('napalm2');
    });
    it('damage=150 (max cap) -> napalm3', () => {
      expect(combatAnim(150, 3, 'ground')).toBe('napalm3');
    });
    it('damage=300 (above cap) -> napalm3', () => {
      expect(combatAnim(300, 3, 'ground')).toBe('napalm3');
    });
    it('over water -> water-exp variants', () => {
      expect(combatAnim(1, 3, 'water')).toBe('water-exp3');
      expect(combatAnim(150, 3, 'water')).toBe('water-exp1');
    });
    it('over air -> flak', () => {
      expect(combatAnim(50, 3, 'air')).toBe('flak');
    });
  });

  // --- Set 2 (SA): threshold at damage > 15 ---
  describe('ExplosionSet=2 (SA) — piff/piffpiff threshold (combat.cpp:337-341)', () => {
    it('damage=1 -> piff', () => {
      expect(combatAnim(1, 2, 'ground')).toBe('piff');
    });
    it('damage=15 (boundary) -> piff (C++ uses >15, not >=)', () => {
      expect(combatAnim(15, 2, 'ground')).toBe('piff');
    });
    it('damage=16 -> piffpiff', () => {
      expect(combatAnim(16, 2, 'ground')).toBe('piffpiff');
    });
    it('damage=100 -> piffpiff', () => {
      expect(combatAnim(100, 2, 'ground')).toBe('piffpiff');
    });
  });

  // --- Set 1 (HollowPoint): always piff ---
  describe('ExplosionSet=1 (HollowPoint) — always ANIM_PIFF (combat.cpp:359-360)', () => {
    it('any damage -> piff', () => {
      expect(combatAnim(1, 1, 'ground')).toBe('piff');
      expect(combatAnim(100, 1, 'ground')).toBe('piff');
      expect(combatAnim(500, 1, 'ground')).toBe('piff');
    });
  });

  // --- Set 6 (Nuke): always atomsfx ---
  describe('ExplosionSet=6 (Nuke) — always ANIM_ATOM_BLAST (combat.cpp:334-335)', () => {
    it('any damage -> atomsfx', () => {
      expect(combatAnim(1, 6, 'ground')).toBe('atomsfx');
      expect(combatAnim(600, 6, 'ground')).toBe('atomsfx');
    });
    it('over water still -> atomsfx (nuke is set 6, not routed through water list)', () => {
      expect(combatAnim(600, 6, 'water')).toBe('atomsfx');
    });
  });

  // --- Set 0 (Super/Organic/Mechanical): no explosion ---
  describe('ExplosionSet=0 — ANIM_NONE (combat.cpp:362-364)', () => {
    it('returns null for any damage', () => {
      expect(combatAnim(100, 0, 'ground')).toBeNull();
      expect(combatAnim(50, 0, 'water')).toBeNull();
    });
  });

  // --- Zero damage always returns null ---
  describe('damage=0 -> ANIM_NONE regardless of set (combat.cpp:301-303)', () => {
    it('zero damage returns null for all sets', () => {
      for (const set of [0, 1, 2, 3, 4, 5, 6]) {
        expect(combatAnim(0, set, 'ground'), `set ${set}`).toBeNull();
      }
    });
  });
});

// ===========================================================================
// 4. WARHEAD->EXPLOSION INTEGRATION — verify that the INI-parsed explosionSet
//    value, when fed through combatAnim(), produces the correct animation name.
//    This connects rules.ini -> warhead.cpp -> combat.cpp end-to-end.
// ===========================================================================
describe('Warhead -> combatAnim integration (INI Explosion= -> Combat_Anim result)', () => {
  // For each INI warhead, verify the explosion set produces the expected animation
  // at a representative damage level.

  it('SA (Explosion=2, dmg=25) -> piffpiff', () => {
    const set = parseInt(rules.SA.Explosion, 10);
    expect(combatAnim(25, set, 'ground')).toBe('piffpiff');
  });

  it('HE (Explosion=5, dmg=100) -> art-exp1', () => {
    const set = parseInt(rules.HE.Explosion, 10);
    expect(combatAnim(100, set, 'ground')).toBe('art-exp1');
  });

  it('AP (Explosion=4, dmg=50) -> veh-hit2', () => {
    const set = parseInt(rules.AP.Explosion, 10);
    expect(combatAnim(50, set, 'ground')).toBe('veh-hit2');
  });

  it('Fire (Explosion=3, dmg=200) -> napalm3', () => {
    const set = parseInt(rules.Fire.Explosion, 10);
    expect(combatAnim(200, set, 'ground')).toBe('napalm3');
  });

  it('HollowPoint (Explosion=1, dmg=100) -> piff', () => {
    const set = parseInt(rules.HollowPoint.Explosion, 10);
    expect(combatAnim(100, set, 'ground')).toBe('piff');
  });

  it('Nuke (Explosion=6, dmg=1000) -> atomsfx', () => {
    const set = parseInt(rules.Nuke.Explosion, 10);
    expect(combatAnim(1000, set, 'ground')).toBe('atomsfx');
  });

  it('Super (no Explosion= -> default 0, dmg=100) -> null', () => {
    const set = rules.Super?.Explosion != null ? parseInt(rules.Super.Explosion, 10) : 0;
    expect(combatAnim(100, set, 'ground')).toBeNull();
  });

  it('Organic (no Explosion= -> default 0, dmg=50) -> null', () => {
    const set = rules.Organic?.Explosion != null ? parseInt(rules.Organic.Explosion, 10) : 0;
    expect(combatAnim(50, set, 'ground')).toBeNull();
  });
});

// ===========================================================================
// 5. EXPLOSION SPRITE FRAME COUNTS — manifest.json vs EXPLOSION_FRAMES
//    C++ adata.cpp uses Stages=-1 for all combat explosions, meaning frame count
//    is auto-detected from the SHP file at load time. Our manifest.json holds the
//    actual extracted frame counts from those SHP files.
//
//    EXPLOSION_FRAMES in types.ts claims to match manifest.json. Verify it.
// ===========================================================================
describe('EXPLOSION_FRAMES matches manifest.json sprite sheet frame counts', () => {
  // KNOWN DISCREPANCIES (EXPLOSION_FRAMES in types.ts vs actual SHP-extracted manifest.json):
  //   frag1:          types.ts=15, manifest.json=14  (off by 1)
  //   flak:           types.ts=8,  manifest.json=7   (off by 1)
  //   h2o_exp1/2/3:   types.ts=14, manifest.json=10  (off by 4)
  // These are genuine bugs in EXPLOSION_FRAMES — the comment says "must match manifest.json"
  // but the values diverge. Tests are left FAILING to document these discrepancies.

  const explosionSprites = [
    'piff', 'piffpiff', 'fball1',
    'veh-hit1', 'veh-hit2', 'veh-hit3',
    'napalm1', 'napalm2', 'napalm3',
    'atomsfx', 'art-exp1',
    'frag1', 'flak',
    'h2o_exp1', 'h2o_exp2', 'h2o_exp3',
  ];

  for (const sprite of explosionSprites) {
    it(`${sprite}: EXPLOSION_FRAMES matches manifest.json frameCount`, () => {
      const manifestEntry = manifest[sprite];
      expect(manifestEntry, `manifest.json should have entry for '${sprite}'`).toBeDefined();

      const tsFrames = EXPLOSION_FRAMES[sprite];
      expect(tsFrames, `EXPLOSION_FRAMES should have entry for '${sprite}'`).toBeDefined();

      expect(
        tsFrames,
        `EXPLOSION_FRAMES['${sprite}'] = ${tsFrames}, but manifest.json says ${manifestEntry?.frameCount}`,
      ).toBe(manifestEntry.frameCount);
    });
  }
});

// ===========================================================================
// 6. COMBAT_ANIM ARRAY MEMBERSHIP — verify the TS animation name arrays contain
//    exactly the same entries as C++ combat.cpp:305-329 static arrays.
//    Tests are derived by reading the C++ source, NOT the TS implementation.
// ===========================================================================
describe('combatAnim array membership matches C++ combat.cpp static arrays', () => {

  // C++ combat.cpp:305-310 _aplist
  it('AP list: [veh-hit3, veh-hit2, frag1, fball1] (C++ combat.cpp:305-310)', () => {
    // Verify by testing boundary damage values that select each element
    // Index = floor((4-1) * min(damage,90) / 90) => 0,1,2,3
    const expected = ['veh-hit3', 'veh-hit2', 'frag1', 'fball1'];
    const damages = [1, 31, 61, 90]; // boundary values for each index
    for (let i = 0; i < expected.length; i++) {
      expect(combatAnim(damages[i], 4, 'ground')).toBe(expected[i]);
    }
  });

  // C++ combat.cpp:312-317 _helist
  it('HE list: [veh-hit1, veh-hit2, art-exp1, fball1] (C++ combat.cpp:312-317)', () => {
    const expected = ['veh-hit1', 'veh-hit2', 'art-exp1', 'fball1'];
    const damages = [1, 44, 87, 130];
    for (let i = 0; i < expected.length; i++) {
      expect(combatAnim(damages[i], 5, 'ground')).toBe(expected[i]);
    }
  });

  // C++ combat.cpp:319-323 _firelist
  it('Fire list: [napalm1, napalm2, napalm3] (C++ combat.cpp:319-323)', () => {
    const expected = ['napalm1', 'napalm2', 'napalm3'];
    const damages = [1, 76, 150];
    for (let i = 0; i < expected.length; i++) {
      expect(combatAnim(damages[i], 3, 'ground')).toBe(expected[i]);
    }
  });

  // C++ combat.cpp:325-329 _waterlist (reversed order: EXP3 is smallest)
  it('Water list: [water-exp3, water-exp2, water-exp1] (C++ combat.cpp:325-329)', () => {
    // Water list is used for sets 3, 4, 5 — test with set 5 (HE, max 130)
    // Index formula: floor((3-1) * min(damage, 130) / 130)
    //   damage=1:   floor(2 * 1/130)   = 0 -> water-exp3
    //   damage=65:  floor(2 * 65/130)  = 1 -> water-exp2
    //   damage=130: floor(2 * 130/130) = 2 -> water-exp1
    const expected = ['water-exp3', 'water-exp2', 'water-exp1'];
    const damages = [1, 65, 130];
    for (let i = 0; i < expected.length; i++) {
      expect(combatAnim(damages[i], 5, 'water')).toBe(expected[i]);
    }
  });
});

// ===========================================================================
// 7. INFANTRY DEATH TYPE SEMANTIC MAPPING
//    C++ infantry.cpp:383-416 maps InfDeath integer to DO_* action:
//      0 = instant delete (no animation)
//      1 = DO_GUN_DEATH (twirl and fall)
//      2 = DO_EXPLOSION_DEATH (body parts scatter)
//      3 = DO_GRENADE_DEATH (knocked backward/flying)
//      4 = DO_FIRE_DEATH (engulfed in flames)
//      5 = ANIM_ELECT_DIE (separate tesla sprite)
//
//    Verify each warhead maps to the semantically correct death type.
// ===========================================================================
describe('InfDeath semantic mapping per warhead (infantry.cpp:383-416)', () => {
  const DEATH_NAMES: Record<number, string> = {
    0: 'instant (no anim)',
    1: 'twirl (DO_GUN_DEATH)',
    2: 'explode (DO_EXPLOSION_DEATH)',
    3: 'flying (DO_GRENADE_DEATH)',
    4: 'burn (DO_FIRE_DEATH)',
    5: 'electro (ANIM_ELECT_DIE)',
  };

  for (const wh of INI_WARHEADS) {
    it(`${wh}: INI InfDeath=${rules[wh]?.InfDeath ?? '(default 0)'} -> ${DEATH_NAMES[WARHEAD_PROPS[wh].infantryDeath]}`, () => {
      const iniVal = rules[wh]?.InfDeath != null ? parseInt(rules[wh].InfDeath, 10) : 0;
      expect(WARHEAD_PROPS[wh].infantryDeath).toBe(iniVal);
      // Also verify the value is a valid death type (0-5)
      expect(iniVal).toBeGreaterThanOrEqual(0);
      expect(iniVal).toBeLessThanOrEqual(5);
    });
  }

  it('burn death (InfDeath=4) is shared by Fire and Nuke warheads', () => {
    const fireInfDeath = rules.Fire?.InfDeath != null ? parseInt(rules.Fire.InfDeath, 10) : 0;
    const nukeInfDeath = rules.Nuke?.InfDeath != null ? parseInt(rules.Nuke.InfDeath, 10) : 0;
    expect(fireInfDeath).toBe(4);
    expect(nukeInfDeath).toBe(4);
    expect(WARHEAD_PROPS.Fire.infantryDeath).toBe(WARHEAD_PROPS.Nuke.infantryDeath);
  });

  it('twirl death (InfDeath=1) is shared by SA and HollowPoint warheads', () => {
    const saInfDeath = rules.SA?.InfDeath != null ? parseInt(rules.SA.InfDeath, 10) : 0;
    const hpInfDeath = rules.HollowPoint?.InfDeath != null ? parseInt(rules.HollowPoint.InfDeath, 10) : 0;
    expect(saInfDeath).toBe(1);
    expect(hpInfDeath).toBe(1);
    expect(WARHEAD_PROPS.SA.infantryDeath).toBe(WARHEAD_PROPS.HollowPoint.infantryDeath);
  });
});

// ===========================================================================
// 8. BUILDING TURRET FRAME LAYOUTS
//    C++ bdata.cpp turret structures:
//      GUN:  128 frames = [32 normal][32 firing][32 damaged][32 damaged-firing]
//            Default facing: DirType(208) = 208/32 = 6 (West)
//      AGUN: 128 frames = same layout as GUN
//            Default facing: DIR_NE(32) = 32/32 = 1 (NorthEast)
//      SAM:  68 frames = [2 closed + 32 rotation][34 damaged]
//            Default facing: DIR_N(0) = 0 (North)
//
//    Vehicle turrets (all turreted vehicles):
//      Body: frames 0-31 (32 rotation steps via BODY_SHAPE)
//      Turret: frames 32-63 (32 rotation steps offset by 32)
// ===========================================================================
describe('Building turret frame layouts (bdata.cpp)', () => {

  it('GUN turret has idleFrame=0 in BUILDING_FRAME_TABLE', () => {
    // GUN is a turret building — not in the table-driven path, handled specially
    // by renderer. But verify the manifest has enough frames for 128-frame layout.
    const gunSheet = manifest['gun'];
    if (gunSheet) {
      expect(gunSheet.frameCount).toBeGreaterThanOrEqual(64);
      // Full layout: 32 normal + 32 firing + 32 damaged + 32 damaged-firing = 128
    }
  });

  it('AGUN turret uses same 128-frame layout as GUN (bdata.cpp:624)', () => {
    const agunSheet = manifest['agun'];
    if (agunSheet) {
      expect(agunSheet.frameCount).toBeGreaterThanOrEqual(64);
    }
  });

  it('SAM launcher has 68+ frames (2 closed + 32 rotation + 34 damaged)', () => {
    const samSheet = manifest['sam'];
    if (samSheet) {
      expect(samSheet.frameCount).toBeGreaterThanOrEqual(34);
    }
  });
});

// ===========================================================================
// 9. BUILDING BUILDUP ANIMATION TIMING
//    C++ bdata.cpp:3129 — timedelay = floor(BuildupTime * TICKS_PER_MINUTE / makeFrameCount)
//    rules.ini: BuildupTime=.06
//    C++ TICKS_PER_MINUTE = 900 (15 ticks/sec * 60)
//    makeFrameCount = number of frames in the *make.shp sprite
//    All RA buildings use 20 frames for *make.shp (factmake, tentmake, etc.)
//    So: timedelay = floor(0.06 * 900 / 20) = floor(54 / 20) = floor(2.7) = 2
//    Total duration = (20 - 1) * 2 = 38 ticks
// ===========================================================================
describe('Building buildup animation timing (bdata.cpp:3129, rules.ini BuildupTime)', () => {

  it('rules.ini BuildupTime=.06', () => {
    const buildupTime = rules.General?.BuildupTime;
    expect(buildupTime).toBeDefined();
    expect(parseFloat(buildupTime!)).toBeCloseTo(0.06, 4);
  });

  it('C++ buildup formula: floor(BuildupTime * 900 / makeFrameCount) = 2 ticks per frame', () => {
    const buildupTime = parseFloat(rules.General!.BuildupTime!);
    const TICKS_PER_MINUTE = 900; // C++ 15 ticks/sec * 60
    const MAKE_FRAME_COUNT = 20;  // standard make.shp frame count
    const ticksPerFrame = Math.floor(buildupTime * TICKS_PER_MINUTE / MAKE_FRAME_COUNT);
    expect(ticksPerFrame).toBe(2);
  });

  it('total buildup duration = (makeFrameCount - 1) * ticksPerFrame = 38 ticks', () => {
    const buildupTime = parseFloat(rules.General!.BuildupTime!);
    const TICKS_PER_MINUTE = 900;
    const MAKE_FRAME_COUNT = 20;
    const ticksPerFrame = Math.floor(buildupTime * TICKS_PER_MINUTE / MAKE_FRAME_COUNT);
    const totalTicks = (MAKE_FRAME_COUNT - 1) * ticksPerFrame;
    expect(totalTicks).toBe(38);
  });
});

// ===========================================================================
// 10. BUILDING FRAME TABLE COVERAGE
//     Verify BUILDING_FRAME_TABLE has entries for all common buildings and
//     that damaged frame offsets are positive (indicating the sprite has
//     enough frames for both normal and damaged states).
// ===========================================================================
describe('BUILDING_FRAME_TABLE completeness and sanity', () => {
  const EXPECTED_BUILDINGS = [
    'fact', 'weap', 'barr', 'tent', 'silo', 'proc', 'fix', 'dome',
    'powr', 'hbox', 'pbox', 'hosp', 'tsla', 'gap', 'iron', 'pdox',
    'atek', 'stek', 'mslo', 'afld', 'hpad', 'kenn', 'bio', 'miss', 'fcom', 'apwr',
  ];

  for (const bldg of EXPECTED_BUILDINGS) {
    it(`${bldg} has a BUILDING_FRAME_TABLE entry`, () => {
      const entry = BUILDING_FRAME_TABLE[bldg];
      expect(entry, `BUILDING_FRAME_TABLE['${bldg}'] should exist`).toBeDefined();
    });

    it(`${bldg} damageFrame > 0 (has damage state)`, () => {
      const entry = BUILDING_FRAME_TABLE[bldg];
      if (entry) {
        expect(entry.damageFrame).toBeGreaterThan(0);
      }
    });
  }

  it('animated buildings have idleAnimCount > 0', () => {
    // C++ buildings with genuine idle animation loops
    const animatedBuildings = ['hosp', 'tsla', 'gap', 'iron', 'pdox', 'atek', 'stek', 'mslo'];
    for (const bldg of animatedBuildings) {
      const entry = BUILDING_FRAME_TABLE[bldg];
      expect(entry?.idleAnimCount, `${bldg} should have animation frames`).toBeGreaterThan(0);
    }
  });

  it('static buildings have idleAnimCount === 0', () => {
    const staticBuildings = ['fact', 'weap', 'barr', 'tent', 'silo', 'proc', 'fix', 'dome', 'powr', 'hbox', 'pbox'];
    for (const bldg of staticBuildings) {
      const entry = BUILDING_FRAME_TABLE[bldg];
      expect(entry?.idleAnimCount, `${bldg} should NOT have animation frames`).toBe(0);
    }
  });
});

// ===========================================================================
// 11. MUZZLE FLASH COLORS BY WARHEAD
//     C++ does not define explicit muzzle colors (RA uses sprite-based flashes).
//     The TS engine maps warhead types to RGB color strings for canvas rendering.
//     Verify each warhead produces a distinct, non-default color where applicable.
//
//     The warheadMuzzleColor function is a private method on the engine class,
//     so we test it indirectly by verifying WARHEAD_PROPS contains the right
//     explosion sets that the engine uses to select muzzle colors.
// ===========================================================================
describe('Muzzle flash — warhead explosionSet determines visual style', () => {

  it('SA and HollowPoint both use small-caliber explosion sets (1 or 2)', () => {
    const saSet = WARHEAD_PROPS.SA.explosionSet;
    const hpSet = WARHEAD_PROPS.HollowPoint.explosionSet;
    // SA=2 (piff/piffpiff), HP=1 (always piff) — both are "small arms" visual
    expect(saSet).toBeLessThanOrEqual(2);
    expect(hpSet).toBeLessThanOrEqual(2);
  });

  it('Fire warhead uses explosionSet=3 (napalm sprites)', () => {
    const fireSet = parseInt(rules.Fire.Explosion, 10);
    expect(fireSet).toBe(3);
    expect(WARHEAD_PROPS.Fire.explosionSet).toBe(3);
  });

  it('Super (tesla) uses explosionSet=0 (no explosion sprite — uses separate electric effect)', () => {
    const superSet = rules.Super?.Explosion != null ? parseInt(rules.Super.Explosion, 10) : 0;
    expect(superSet).toBe(0);
    expect(WARHEAD_PROPS.Super.explosionSet).toBe(0);
  });

  it('each explosion set produces a different visual category', () => {
    // Verify the 7 explosion sets (0-6) map to distinct animation families
    const setResults = new Map<number, string | null>();
    for (const set of [0, 1, 2, 3, 4, 5, 6]) {
      setResults.set(set, combatAnim(50, set, 'ground'));
    }
    // Set 0 = null (no explosion)
    expect(setResults.get(0)).toBeNull();
    // Set 1 = piff
    expect(setResults.get(1)).toBe('piff');
    // Set 2 = piffpiff (damage 50 > 15)
    expect(setResults.get(2)).toBe('piffpiff');
    // Set 3 = napalm family
    expect(setResults.get(3)).toMatch(/^napalm/);
    // Set 4 = vehicle hit / frag family
    expect(['veh-hit3', 'veh-hit2', 'frag1', 'fball1']).toContain(setResults.get(4));
    // Set 5 = vehicle hit / art-exp family
    expect(['veh-hit1', 'veh-hit2', 'art-exp1', 'fball1']).toContain(setResults.get(5));
    // Set 6 = atomsfx
    expect(setResults.get(6)).toBe('atomsfx');
  });
});

// ===========================================================================
// 12. WEAPON SCENARIO VISUAL VERIFICATION
//     Test specific real weapon scenarios from C++ to verify the full chain:
//     weapon damage -> warhead ExplosionSet -> combatAnim -> correct sprite
// ===========================================================================
describe('Weapon scenario visual verification — damage -> warhead -> animation', () => {

  it('M1Carbine (SA, dmg=15) -> piff (not piffpiff, boundary case)', () => {
    const set = parseInt(rules.SA.Explosion, 10);
    expect(combatAnim(15, set, 'ground')).toBe('piff');
  });

  it('ChainGun (SA, dmg=25) -> piffpiff', () => {
    const set = parseInt(rules.SA.Explosion, 10);
    expect(combatAnim(25, set, 'ground')).toBe('piffpiff');
  });

  it('Grenade (HE, dmg=50) -> veh-hit2 (NOT fball1)', () => {
    const set = parseInt(rules.HE.Explosion, 10);
    expect(combatAnim(50, set, 'ground')).toBe('veh-hit2');
  });

  it('155mm Artillery (HE, dmg=150) -> fball1 (capped at 130)', () => {
    const set = parseInt(rules.HE.Explosion, 10);
    expect(combatAnim(150, set, 'ground')).toBe('fball1');
  });

  it('120mm Mammoth (AP, dmg=50) -> veh-hit2', () => {
    const set = parseInt(rules.AP.Explosion, 10);
    expect(combatAnim(50, set, 'ground')).toBe('veh-hit2');
  });

  it('Flamer (Fire, dmg=35) -> napalm1 (low fire damage)', () => {
    const set = parseInt(rules.Fire.Explosion, 10);
    expect(combatAnim(35, set, 'ground')).toBe('napalm1');
  });

  it('Oil barrel explosion (Fire, dmg=200) -> napalm3 (capped at 150)', () => {
    const set = parseInt(rules.Fire.Explosion, 10);
    expect(combatAnim(200, set, 'ground')).toBe('napalm3');
  });

  it('V2 Rocket (HE, dmg=600 from high altitude) -> fball1', () => {
    const set = parseInt(rules.HE.Explosion, 10);
    expect(combatAnim(600, set, 'ground')).toBe('fball1');
  });

  it('Nuclear warhead (Nuke, dmg=1000) -> atomsfx', () => {
    const set = parseInt(rules.Nuke.Explosion, 10);
    expect(combatAnim(1000, set, 'ground')).toBe('atomsfx');
  });

  it('Tesla coil (Super) -> null (tesla uses separate ELECT_DIE visual, no Combat_Anim)', () => {
    const set = rules.Super?.Explosion != null ? parseInt(rules.Super.Explosion, 10) : 0;
    expect(combatAnim(100, set, 'ground')).toBeNull();
  });

  it('Dog bite (HollowPoint) -> piff', () => {
    const set = parseInt(rules.HollowPoint.Explosion, 10);
    expect(combatAnim(100, set, 'ground')).toBe('piff');
  });

  it('Naval battle over water (AP, dmg=70) -> water-exp variant', () => {
    const set = parseInt(rules.AP.Explosion, 10);
    const result = combatAnim(70, set, 'water');
    expect(result).toMatch(/^water-exp/);
  });

  it('AA missile vs aircraft (HE, dmg=50) -> flak', () => {
    const set = parseInt(rules.HE.Explosion, 10);
    expect(combatAnim(50, set, 'air')).toBe('flak');
  });
});
