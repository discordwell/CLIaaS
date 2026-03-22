/**
 * C++ Parity Tests: STRUCTURE_WEAPONS vs rules.ini
 *
 * Source of truth: /public/ra/assets/rules.ini
 * TS implementation: /src/EasterEgg/engine/scenario.ts  STRUCTURE_WEAPONS
 *
 * For each defensive building (GUN, SAM, AGUN, TSLA, PBOX, HBOX, FTUR):
 *   1. Building section [XXX] → Primary= weapon name
 *   2. Weapon section [WeaponName] → Damage, ROF, Range, Speed, Warhead, Projectile
 *   3. Projectile section [ProjName] → AA, AG flags
 *   4. Compare against TS STRUCTURE_WEAPONS entry
 *
 * QUEE is NOT in rules.ini (ant-mission-only, defined in SCA0xEA.ini).
 * Its weapon (TeslaZap) is overridden per-mission, so it cannot be parity-tested
 * against base rules.ini.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { STRUCTURE_WEAPONS } from '../engine/scenario';

// ---------------------------------------------------------------------------
// Minimal INI parser — handles rules.ini's flat [Section] Key=Value format
// ---------------------------------------------------------------------------
interface IniData {
  [section: string]: { [key: string]: string };
}

function parseIni(text: string): IniData {
  const data: IniData = {};
  let currentSection = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/;.*$/, '').trim();        // strip comments
    if (!line) continue;
    const secMatch = line.match(/^\[(.+)\]$/);
    if (secMatch) {
      currentSection = secMatch[1];
      if (!data[currentSection]) data[currentSection] = {};
      continue;
    }
    const kvMatch = line.match(/^([^=]+)=(.*)$/);
    if (kvMatch && currentSection) {
      data[currentSection][kvMatch[1].trim()] = kvMatch[2].trim();
    }
  }
  return data;
}

// ---------------------------------------------------------------------------
// Load rules.ini once
// ---------------------------------------------------------------------------
let ini: IniData;

beforeAll(() => {
  const rulesPath = resolve(__dirname, '../../../public/ra/assets/rules.ini');
  ini = parseIni(readFileSync(rulesPath, 'utf-8'));
});

// ---------------------------------------------------------------------------
// Expected data derived from rules.ini (authoritative source)
// ---------------------------------------------------------------------------
//
// Building → Primary weapon → weapon stats → projectile AA/AG
//
// [PBOX] Primary=Vulcan   → [Vulcan]  Damage=40,  ROF=40,  Range=5,   Speed=100, Warhead=SA,    Projectile=Invisible → AA=false, AG=true
// [HBOX] Primary=Vulcan   → [Vulcan]  Damage=40,  ROF=40,  Range=5,   Speed=100, Warhead=SA,    Projectile=Invisible → AA=false, AG=true
// [GUN]  Primary=TurretGun→ [TurretGun] Damage=40, ROF=50, Range=6,   Speed=40,  Warhead=AP,    Projectile=Cannon    → AA=false, AG=true
// [TSLA] Primary=TeslaZap → [TeslaZap] Damage=100, ROF=120, Range=8.5, Speed=100, Warhead=Super, Projectile=Invisible → AA=false, AG=true
// [SAM]  Primary=Nike     → [Nike]    Damage=50,  ROF=20,  Range=7.5, Speed=50,  Warhead=AP,    Projectile=AAMissile → AA=yes,   AG=no
// [AGUN] Primary=ZSU-23   → [ZSU-23]  Damage=25,  ROF=10,  Range=6,   Speed=100, Warhead=AP,    Projectile=Ack       → AA=true,  AG=false
// [FTUR] Primary=FireballLauncher → [FireballLauncher] Damage=125, ROF=50, Range=4, Speed=12, Warhead=Fire, Projectile=Fireball → AA=false, AG=true
//

/** Buildings to test and their expected Primary weapon from rules.ini */
const BUILDING_WEAPONS: Record<string, string> = {
  PBOX: 'Vulcan',
  HBOX: 'Vulcan',
  GUN:  'TurretGun',
  TSLA: 'TeslaZap',
  SAM:  'Nike',
  AGUN: 'ZSU-23',
  FTUR: 'FireballLauncher',
};

describe('STRUCTURE_WEAPONS vs rules.ini parity', () => {

  // -------------------------------------------------------------------------
  // Test 1: Each building has a Primary= weapon in rules.ini
  // -------------------------------------------------------------------------
  describe('building → primary weapon mapping', () => {
    for (const [building, expectedWeapon] of Object.entries(BUILDING_WEAPONS)) {
      it(`[${building}] Primary=${expectedWeapon}`, () => {
        const section = ini[building];
        expect(section, `[${building}] section must exist in rules.ini`).toBeDefined();
        expect(section.Primary).toBe(expectedWeapon);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Test 2: Weapon Damage matches rules.ini
  // -------------------------------------------------------------------------
  describe('weapon damage', () => {
    for (const [building, weaponName] of Object.entries(BUILDING_WEAPONS)) {
      it(`${building} damage matches [${weaponName}] Damage=`, () => {
        const iniDamage = Number(ini[weaponName].Damage);
        const tsDamage = STRUCTURE_WEAPONS[building].damage;
        expect(tsDamage, `${building}: TS damage=${tsDamage}, rules.ini [${weaponName}] Damage=${iniDamage}`).toBe(iniDamage);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Test 3: Weapon ROF matches rules.ini
  // -------------------------------------------------------------------------
  describe('weapon ROF', () => {
    for (const [building, weaponName] of Object.entries(BUILDING_WEAPONS)) {
      it(`${building} rof matches [${weaponName}] ROF=`, () => {
        const iniROF = Number(ini[weaponName].ROF);
        const tsROF = STRUCTURE_WEAPONS[building].rof;
        expect(tsROF, `${building}: TS rof=${tsROF}, rules.ini [${weaponName}] ROF=${iniROF}`).toBe(iniROF);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Test 4: Weapon Range matches rules.ini
  // -------------------------------------------------------------------------
  describe('weapon range', () => {
    for (const [building, weaponName] of Object.entries(BUILDING_WEAPONS)) {
      it(`${building} range matches [${weaponName}] Range=`, () => {
        const iniRange = Number(ini[weaponName].Range);
        const tsRange = STRUCTURE_WEAPONS[building].range;
        expect(tsRange, `${building}: TS range=${tsRange}, rules.ini [${weaponName}] Range=${iniRange}`).toBe(iniRange);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Test 5: Weapon Speed matches rules.ini
  // -------------------------------------------------------------------------
  describe('weapon speed (projSpeed)', () => {
    for (const [building, weaponName] of Object.entries(BUILDING_WEAPONS)) {
      it(`${building} projSpeed matches [${weaponName}] Speed=`, () => {
        const iniSpeed = Number(ini[weaponName].Speed);
        const tsProjSpeed = STRUCTURE_WEAPONS[building].projSpeed;
        expect(tsProjSpeed, `${building}: TS projSpeed=${tsProjSpeed}, rules.ini [${weaponName}] Speed=${iniSpeed}`).toBe(iniSpeed);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Test 6: Weapon Warhead matches rules.ini
  // -------------------------------------------------------------------------
  describe('weapon warhead', () => {
    for (const [building, weaponName] of Object.entries(BUILDING_WEAPONS)) {
      it(`${building} warhead matches [${weaponName}] Warhead=`, () => {
        const iniWarhead = ini[weaponName].Warhead;
        const tsWarhead = STRUCTURE_WEAPONS[building].warhead;
        expect(tsWarhead, `${building}: TS warhead=${tsWarhead}, rules.ini [${weaponName}] Warhead=${iniWarhead}`).toBe(iniWarhead);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Test 7: Anti-air flag matches projectile AA= in rules.ini
  // -------------------------------------------------------------------------
  describe('isAntiAir matches projectile AA flag', () => {
    const AA_BUILDINGS: Record<string, { projName: string; expectedAA: boolean }> = {
      SAM:  { projName: 'AAMissile', expectedAA: true },
      AGUN: { projName: 'Ack',       expectedAA: true },
      GUN:  { projName: 'Cannon',    expectedAA: false },
      PBOX: { projName: 'Invisible', expectedAA: false },
      HBOX: { projName: 'Invisible', expectedAA: false },
      TSLA: { projName: 'Invisible', expectedAA: false },
      FTUR: { projName: 'Fireball',  expectedAA: false },
    };

    for (const [building, { projName, expectedAA }] of Object.entries(AA_BUILDINGS)) {
      it(`${building} isAntiAir=${expectedAA} (projectile [${projName}])`, () => {
        const projSection = ini[projName];
        expect(projSection, `[${projName}] projectile section must exist in rules.ini`).toBeDefined();

        // In rules.ini, AA defaults to false/no if not specified
        const iniAA = projSection.AA;
        const iniAABool = iniAA === 'true' || iniAA === 'yes';

        expect(iniAABool, `[${projName}] AA=${iniAA ?? '(unset, default false)'}`).toBe(expectedAA);

        // TS side: isAntiAir defaults to undefined/false
        const tsAA = STRUCTURE_WEAPONS[building].isAntiAir ?? false;
        expect(tsAA, `${building}: TS isAntiAir=${tsAA}, expected=${expectedAA}`).toBe(expectedAA);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Test 8: Air-only weapons have AG=false/no in projectile
  //         (SAM and AGUN should NOT be able to target ground)
  // -------------------------------------------------------------------------
  describe('air-only weapons have AG=false in projectile', () => {
    const AIR_ONLY: Record<string, string> = {
      SAM:  'AAMissile',
      AGUN: 'Ack',
    };

    for (const [building, projName] of Object.entries(AIR_ONLY)) {
      it(`${building} projectile [${projName}] AG=false/no`, () => {
        const projSection = ini[projName];
        const iniAG = projSection.AG;
        const iniAGBool = iniAG === 'true' || iniAG === 'yes';
        expect(iniAGBool, `[${projName}] AG=${iniAG} — should be false/no for air-only weapon`).toBe(false);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Test 9: Weapon → Projectile mapping matches rules.ini
  // -------------------------------------------------------------------------
  describe('weapon projectile reference', () => {
    const EXPECTED_PROJECTILES: Record<string, string> = {
      Vulcan:            'Invisible',
      TurretGun:         'Cannon',
      TeslaZap:          'Invisible',
      'ZSU-23':          'Ack',
      Nike:              'AAMissile',
      FireballLauncher:  'Fireball',
    };

    for (const [weaponName, expectedProj] of Object.entries(EXPECTED_PROJECTILES)) {
      it(`[${weaponName}] Projectile=${expectedProj}`, () => {
        const weaponSection = ini[weaponName];
        expect(weaponSection, `[${weaponName}] weapon section must exist`).toBeDefined();
        expect(weaponSection.Projectile).toBe(expectedProj);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Test 10: QUEE is NOT in rules.ini (ant-mission-only building)
  // -------------------------------------------------------------------------
  it('QUEE is NOT defined in base rules.ini (ant-mission-only)', () => {
    expect(ini['QUEE']).toBeUndefined();
  });

  it('QUEE IS defined in STRUCTURE_WEAPONS (custom ant weapon)', () => {
    expect(STRUCTURE_WEAPONS['QUEE']).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Test 11: All 7 rules.ini buildings are present in STRUCTURE_WEAPONS
  // -------------------------------------------------------------------------
  it('all 7 INI-defined defensive buildings have STRUCTURE_WEAPONS entries', () => {
    for (const building of Object.keys(BUILDING_WEAPONS)) {
      expect(STRUCTURE_WEAPONS[building], `${building} must be in STRUCTURE_WEAPONS`).toBeDefined();
    }
  });
});
