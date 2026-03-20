/**
 * C++ Behavioral Parity: Projectile Property FIX Assertions
 *
 * This file converts the "KNOWN MISSING" documentation from cpp-parity-projectile-props.test.ts
 * into REAL failing assertions. The existing file documents gaps but doesn't fail on them —
 * it asserts the ABSENCE of the property (i.e., "yes it's missing, pass").
 * This file asserts the PRESENCE of each property, so tests FAIL when TS is missing INI data.
 *
 * Every test here that fails represents a real parity gap that needs fixing.
 *
 * C++ source: bullet.cpp, bbdata.cpp, rules.ini lines 2452-2638, aftrmath.ini
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { WEAPON_STATS } from '../engine/types';

// ── INI Parser ───────────────────────────────────────────────────────────────

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
const aftrmath = parseINI(readFileSync(join(assetsDir, 'aftrmath.ini'), 'utf-8'));
const ini: Record<string, Record<string, string>> = {};
for (const [s, v] of Object.entries(rules)) ini[s] = { ...v };
for (const [s, v] of Object.entries(aftrmath)) ini[s] = { ...(ini[s] || {}), ...v };

// ── Helpers ──────────────────────────────────────────────────────────────────

/** INI typo map: Camera has Projectile=Inivisble (typo for Invisible) */
const PROJECTILE_TYPO_MAP: Record<string, string> = {
  'Inivisble': 'Invisible',
};

/** Resolve a weapon's projectile section from INI, applying typo corrections */
function getProjectileSection(weaponName: string): { projName: string; section: Record<string, string> } | null {
  const weaponIni = ini[weaponName];
  if (!weaponIni?.Projectile) return null;
  const rawProj = weaponIni.Projectile;
  const projName = PROJECTILE_TYPO_MAP[rawProj] || rawProj;
  const section = ini[projName];
  if (!section) return null;
  return { projName, section };
}

/** Check if an INI value is truthy (yes/true/1) */
function iniBool(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  return v === 'yes' || v === 'true' || v === '1';
}

// ── Test: Stinger (Projectile=LaserGuided) ───────────────────────────────────

describe('C++ Parity FIX: Stinger (Projectile=LaserGuided)', () => {
  const ts = WEAPON_STATS['Stinger'];
  const proj = getProjectileSection('Stinger');

  it('INI confirms LaserGuided has AA=yes', () => {
    expect(proj).not.toBeNull();
    expect(iniBool(proj!.section['AA'])).toBe(true);
  });

  it('isAntiAir should be true', () => {
    expect(ts.isAntiAir, 'Stinger.isAntiAir should be true (INI [LaserGuided] AA=yes)').toBe(true);
  });

  it('isHigh should be true', () => {
    expect(ts.isHigh, 'Stinger.isHigh should be true (INI [LaserGuided] High=yes)').toBe(true);
  });

  it('isFueled should be true', () => {
    expect(ts.isFueled, 'Stinger.isFueled should be true (INI [LaserGuided] Ranged=yes)').toBe(true);
  });

  it('projectileROT should be 20', () => {
    expect(ts.projectileROT, 'Stinger.projectileROT should be 20 (INI [LaserGuided] ROT=20)').toBe(20);
  });
});

// ── Test: DepthCharge (Projectile=Catapult) ──────────────────────────────────

describe('C++ Parity FIX: DepthCharge (Projectile=Catapult)', () => {
  const ts = WEAPON_STATS['DepthCharge'];
  const proj = getProjectileSection('DepthCharge');

  it('INI confirms Catapult has Arcing=yes, High=yes, Inaccurate=yes', () => {
    expect(proj).not.toBeNull();
    expect(iniBool(proj!.section['Arcing'])).toBe(true);
    expect(iniBool(proj!.section['High'])).toBe(true);
    expect(iniBool(proj!.section['Inaccurate'])).toBe(true);
  });

  it('isArcing should be true', () => {
    expect(ts.isArcing, 'DepthCharge.isArcing should be true (INI [Catapult] Arcing=yes)').toBe(true);
  });

  it('isHigh should be true', () => {
    expect(ts.isHigh, 'DepthCharge.isHigh should be true (INI [Catapult] High=yes)').toBe(true);
  });

  it('isInaccurate should be true', () => {
    expect(ts.isInaccurate, 'DepthCharge.isInaccurate should be true (INI [Catapult] Inaccurate=yes)').toBe(true);
  });
});

// ── Test: HeatSeeker weapons (Dragon, Hellfire, Maverick, MammothTusk, SubSCUD, APTusk)

describe('C++ Parity FIX: HeatSeeker projectile weapons', () => {
  // HeatSeeker INI: Inaccurate=yes, Ranged=yes, AA=yes, ROT=5, High=yes
  // Note on AA: In C++, projectile AA=yes means "projectile can track airborne targets",
  // not necessarily "this weapon is designated anti-air." The game checks both weapon
  // and projectile AA flags for targeting. Including the assertion since the INI flag
  // IS present on the projectile section and should be reflected in TS data.

  const heatSeekerWeapons = ['Dragon', 'Hellfire', 'Maverick', 'MammothTusk', 'SubSCUD', 'APTusk'] as const;

  for (const wName of heatSeekerWeapons) {
    describe(wName, () => {
      const ts = WEAPON_STATS[wName];

      it('isInaccurate should be true', () => {
        expect(ts.isInaccurate, `${wName}.isInaccurate should be true (INI [HeatSeeker] Inaccurate=yes)`).toBe(true);
      });

      it('isFueled should be true', () => {
        expect(ts.isFueled, `${wName}.isFueled should be true (INI [HeatSeeker] Ranged=yes)`).toBe(true);
      });

      // C++ AA flag means "projectile can track airborne targets" — HeatSeeker has AA=yes.
      // Whether each weapon SHOULD be anti-air is debatable (e.g., Dragon is a ground bazooka),
      // but the data says AA=yes on the projectile type shared by all these weapons.
      it('isAntiAir should be true (HeatSeeker AA=yes — projectile can track airborne targets)', () => {
        expect(ts.isAntiAir, `${wName}.isAntiAir should be true (INI [HeatSeeker] AA=yes)`).toBe(true);
      });
    });
  }

  // APTusk specifically: HeatSeeker ROT=5, verify projectileROT
  it('APTusk: projectileROT should be 5', () => {
    const ts = WEAPON_STATS['APTusk'];
    expect(ts.projectileROT, 'APTusk.projectileROT should be 5 (INI [HeatSeeker] ROT=5)').toBe(5);
  });
});

// ── Test: RedEye (Projectile=AAMissile) ──────────────────────────────────────

describe('C++ Parity FIX: RedEye (Projectile=AAMissile)', () => {
  const ts = WEAPON_STATS['RedEye'];
  const proj = getProjectileSection('RedEye');

  it('INI confirms AAMissile has Ranged=yes, ROT=20', () => {
    expect(proj).not.toBeNull();
    expect(iniBool(proj!.section['Ranged'])).toBe(true);
    expect(proj!.section['ROT']).toBe('20');
  });

  it('isFueled should be true', () => {
    expect(ts.isFueled, 'RedEye.isFueled should be true (INI [AAMissile] Ranged=yes)').toBe(true);
  });

  it('projectileROT should be 20', () => {
    expect(ts.projectileROT, 'RedEye.projectileROT should be 20 (INI [AAMissile] ROT=20)').toBe(20);
  });
});

// ── Test: DogJaw (Projectile=LeapDog) ────────────────────────────────────────

describe('C++ Parity FIX: DogJaw (Projectile=LeapDog)', () => {
  const ts = WEAPON_STATS['DogJaw'];
  const proj = getProjectileSection('DogJaw');

  it('INI confirms LeapDog has ROT=20', () => {
    expect(proj).not.toBeNull();
    expect(proj!.section['ROT']).toBe('20');
  });

  it('projectileROT should be 20', () => {
    expect(ts.projectileROT, 'DogJaw.projectileROT should be 20 (INI [LeapDog] ROT=20)').toBe(20);
  });
});

// ── Test: Grenade (Projectile=Lobbed) ────────────────────────────────────────

describe('C++ Parity FIX: Grenade (Projectile=Lobbed)', () => {
  const ts = WEAPON_STATS['Grenade'];
  const proj = getProjectileSection('Grenade');

  it('INI confirms Lobbed has High=yes, Inaccurate=yes', () => {
    expect(proj).not.toBeNull();
    expect(iniBool(proj!.section['High'])).toBe(true);
    expect(iniBool(proj!.section['Inaccurate'])).toBe(true);
  });

  it('isHigh should be true', () => {
    expect(ts.isHigh, 'Grenade.isHigh should be true (INI [Lobbed] High=yes)').toBe(true);
  });

  it('isInaccurate should be true', () => {
    expect(ts.isInaccurate, 'Grenade.isInaccurate should be true (INI [Lobbed] Inaccurate=yes)').toBe(true);
  });
});

// ── Test: 155mm (Projectile=Ballistic) ───────────────────────────────────────

describe('C++ Parity FIX: 155mm (Projectile=Ballistic)', () => {
  const ts = WEAPON_STATS['155mm'];
  const proj = getProjectileSection('155mm');

  it('INI confirms Ballistic has High=yes', () => {
    expect(proj).not.toBeNull();
    expect(iniBool(proj!.section['High'])).toBe(true);
  });

  it('isHigh should be true', () => {
    expect(ts.isHigh, '155mm.isHigh should be true (INI [Ballistic] High=yes)').toBe(true);
  });
});

// ── Test: 8Inch (Projectile=Ballistic) ───────────────────────────────────────

describe('C++ Parity FIX: 8Inch (Projectile=Ballistic)', () => {
  const ts = WEAPON_STATS['8Inch'];
  const proj = getProjectileSection('8Inch');

  it('INI confirms Ballistic has High=yes, Inaccurate=yes', () => {
    expect(proj).not.toBeNull();
    expect(iniBool(proj!.section['High'])).toBe(true);
    expect(iniBool(proj!.section['Inaccurate'])).toBe(true);
  });

  it('isHigh should be true', () => {
    expect(ts.isHigh, '8Inch.isHigh should be true (INI [Ballistic] High=yes)').toBe(true);
  });

  it('isInaccurate should be true', () => {
    expect(ts.isInaccurate, '8Inch.isInaccurate should be true (INI [Ballistic] Inaccurate=yes)').toBe(true);
  });
});

// ── Test: SCUD (Projectile=FROG) ─────────────────────────────────────────────

describe('C++ Parity FIX: SCUD (Projectile=FROG)', () => {
  const ts = WEAPON_STATS['SCUD'];
  const proj = getProjectileSection('SCUD');

  it('INI confirms FROG has Inaccurate=yes', () => {
    expect(proj).not.toBeNull();
    expect(iniBool(proj!.section['Inaccurate'])).toBe(true);
  });

  it('isInaccurate should be true', () => {
    expect(ts.isInaccurate, 'SCUD.isInaccurate should be true (INI [FROG] Inaccurate=yes)').toBe(true);
  });
});

// ── Test: ParaBomb (Projectile=Parachute) ────────────────────────────────────

describe('C++ Parity FIX: ParaBomb (Projectile=Parachute)', () => {
  const ts = WEAPON_STATS['ParaBomb'];
  const proj = getProjectileSection('ParaBomb');

  it('INI confirms Parachute has High=yes', () => {
    expect(proj).not.toBeNull();
    expect(iniBool(proj!.section['High'])).toBe(true);
  });

  it('isHigh should be true', () => {
    expect(ts.isHigh, 'ParaBomb.isHigh should be true (INI [Parachute] High=yes)').toBe(true);
  });
});

// ── Test: Napalm (Projectile=Bomblet) ────────────────────────────────────────

describe('C++ Parity FIX: Napalm (Projectile=Bomblet)', () => {
  const ts = WEAPON_STATS['Napalm'];
  const proj = getProjectileSection('Napalm');

  it('INI confirms Bomblet has High=yes, Dropping=yes', () => {
    expect(proj).not.toBeNull();
    expect(iniBool(proj!.section['High'])).toBe(true);
    expect(iniBool(proj!.section['Dropping'])).toBe(true);
  });

  it('isHigh should be true', () => {
    expect(ts.isHigh, 'Napalm.isHigh should be true (INI [Bomblet] High=yes)').toBe(true);
  });

  it('isDropping should be true', () => {
    expect(ts.isDropping, 'Napalm.isDropping should be true (INI [Bomblet] Dropping=yes)').toBe(true);
  });
});

// ── Test: Invisible-projectile weapons missing isInvisible ───────────────────

describe('C++ Parity FIX: Invisible-projectile weapons should have isInvisible=true', () => {
  // All these weapons use Projectile=Invisible (or Inivisble typo for Camera),
  // which has Inviso=yes. TS should set isInvisible=true for each.
  const invisibleWeapons = [
    'Heal',
    'PortaTesla',
    'GoodWrench',
    'TTankZap',
    'TeslaZap',
    'Camera',      // INI typo: Projectile=Inivisble -> maps to Invisible
    'Democharge',
    'ChainGun',
    'Pistol',
  ];

  for (const wName of invisibleWeapons) {
    it(`${wName}: isInvisible should be true (Projectile=Invisible, Inviso=yes)`, () => {
      const ts = WEAPON_STATS[wName];
      expect(ts, `${wName} should exist in WEAPON_STATS`).toBeDefined();

      // Verify INI chain: weapon -> Invisible projectile -> Inviso=yes
      const proj = getProjectileSection(wName);
      expect(proj, `${wName} should have a resolvable projectile in INI`).not.toBeNull();
      expect(proj!.projName).toBe('Invisible');
      expect(iniBool(proj!.section['Inviso'])).toBe(true);

      // The actual parity assertion — this SHOULD FAIL if TS is missing isInvisible
      expect(ts.isInvisible, `${wName}.isInvisible should be true (INI [Invisible] Inviso=yes)`).toBe(true);
    });
  }
});

// ── Test: Cross-validation — INI projectile sections exist ───────────────────

describe('C++ Parity FIX: INI projectile chain validation', () => {
  it('all tested weapons exist in WEAPON_STATS', () => {
    const testedWeapons = [
      'Stinger', 'DepthCharge', 'Dragon', 'Hellfire', 'Maverick',
      'MammothTusk', 'SubSCUD', 'APTusk', 'RedEye', 'DogJaw',
      'Grenade', '155mm', '8Inch', 'SCUD', 'ParaBomb', 'Napalm',
      'Heal', 'PortaTesla', 'GoodWrench', 'TTankZap', 'TeslaZap',
      'Camera', 'Democharge', 'ChainGun', 'Pistol',
    ];
    for (const w of testedWeapons) {
      expect(WEAPON_STATS[w], `${w} should exist in WEAPON_STATS`).toBeDefined();
    }
  });

  it('all tested weapons have INI sections with Projectile= field', () => {
    const testedWeapons = [
      'Stinger', 'DepthCharge', 'Dragon', 'Hellfire', 'Maverick',
      'MammothTusk', 'SubSCUD', 'APTusk', 'RedEye', 'DogJaw',
      'Grenade', '155mm', '8Inch', 'SCUD', 'ParaBomb', 'Napalm',
      'Heal', 'PortaTesla', 'GoodWrench', 'TTankZap', 'TeslaZap',
      'Camera', 'Democharge', 'ChainGun', 'Pistol',
    ];
    for (const w of testedWeapons) {
      const proj = getProjectileSection(w);
      expect(proj, `${w} should have a resolvable projectile section in INI`).not.toBeNull();
    }
  });
});
