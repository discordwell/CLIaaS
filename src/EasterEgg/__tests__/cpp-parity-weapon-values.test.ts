/**
 * C++ Behavioral Parity: Weapon Values
 *
 * Verifies WEAPON_STATS values match C++ rules.ini / aftrmath.ini weapon sections.
 * Tests Damage, ROF, Range, Warhead, Burst, and Speed for all weapons.
 *
 * C++ source: weapon.cpp, rules.ini lines 2068-2450, aftrmath.ini weapon sections
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { WEAPON_STATS } from '../engine/types';

// ---------------------------------------------------------------------------
// INI Parser
// ---------------------------------------------------------------------------

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
for (const [section, values] of Object.entries(rules)) {
  ini[section] = { ...values };
}
for (const [section, values] of Object.entries(aftrmath)) {
  ini[section] = { ...(ini[section] || {}), ...values };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All INI weapon section names (rules.ini + aftrmath.ini combined) */
const INI_WEAPON_NAMES = [
  // rules.ini weapons
  'Colt45', 'ZSU-23', 'Vulcan', 'Maverick', 'Camera', 'FireballLauncher',
  'Flamer', 'Sniper', 'ChainGun', 'Pistol', 'M1Carbine', 'Dragon',
  'Hellfire', 'Grenade', '75mm', '90mm', '105mm', '120mm', 'TurretGun',
  'MammothTusk', '155mm', 'M60mg', 'Napalm', 'TeslaZap', 'Nike', 'RedEye',
  '8Inch', 'Stinger', 'TorpTube', '2Inch', 'DepthCharge', 'ParaBomb',
  'DogJaw', 'Heal', 'SCUD',
  // aftrmath.ini weapons
  'AirAssault', 'PortaTesla', 'TTankZap', 'GoodWrench', 'SubSCUD',
  'APTusk', 'Democharge',
];

/** Structure-only weapons: present in INI but handled via STRUCTURE_WEAPONS, not WEAPON_STATS */
const STRUCTURE_ONLY_WEAPONS = [
  { name: 'Vulcan',     note: 'PBOX/HBOX primary' },
  { name: 'Nike',       note: 'SAM primary' },
  { name: 'ZSU-23',     note: 'AGUN primary' },
  { name: 'TurretGun',  note: 'GUN primary' },
];

/** Engine-custom weapons: present in WEAPON_STATS but NOT in rules.ini/aftrmath.ini */
const ENGINE_CUSTOM_WEAPONS = [
  { name: 'Tomahawk',     note: 'CA cruise missile - engine custom' },
  { name: 'SeaSerpent',   note: 'MSUB missile - engine custom' },
  { name: 'TeslaCannon',  note: 'TSLA building - separate from TeslaZap weapon' },
  { name: 'Mandible',     note: 'ant weapon - from scenario INI, not rules.ini' },
];

/** Ant-variant weapons: INI section exists but WEAPON_STATS uses scenario-specific values.
 *  The INI [TeslaZap] is the building version (damage=100, rof=120, range=8.5).
 *  WEAPON_STATS TeslaZap is the ANT3 variant (damage=60, rof=25, range=1.75).
 *  Building version lives in STRUCTURE_WEAPONS['TSLA']. */
const ANT_VARIANT_WEAPONS = new Set(['TeslaZap']);

// ---------------------------------------------------------------------------
// 1. Per-weapon INI parity checks
// ---------------------------------------------------------------------------

describe('C++ Parity: Weapon Values vs rules.ini/aftrmath.ini', () => {
  const tsWeaponNames = Object.keys(WEAPON_STATS);
  const iniOnlyNames = new Set(STRUCTURE_ONLY_WEAPONS.map(w => w.name));
  const engineOnlyNames = new Set(ENGINE_CUSTOM_WEAPONS.map(w => w.name));

  // Weapons that exist in both WEAPON_STATS and INI (excluding engine-custom and ant-variant)
  const sharedWeapons = tsWeaponNames.filter(
    name => ini[name] && !engineOnlyNames.has(name) && !ANT_VARIANT_WEAPONS.has(name),
  );

  describe('Damage parity', () => {
    for (const weaponName of sharedWeapons) {
      const iniSection = ini[weaponName];
      if (!iniSection || iniSection.Damage === undefined) continue;
      const expected = parseInt(iniSection.Damage, 10);
      it(`${weaponName} Damage=${expected}`, () => {
        expect(WEAPON_STATS[weaponName].damage).toBe(expected);
      });
    }
  });

  describe('ROF parity', () => {
    for (const weaponName of sharedWeapons) {
      const iniSection = ini[weaponName];
      if (!iniSection || iniSection.ROF === undefined) continue;
      const expected = parseInt(iniSection.ROF, 10);
      it(`${weaponName} ROF=${expected}`, () => {
        expect(WEAPON_STATS[weaponName].rof).toBe(expected);
      });
    }
  });

  describe('Range parity', () => {
    for (const weaponName of sharedWeapons) {
      const iniSection = ini[weaponName];
      if (!iniSection || iniSection.Range === undefined) continue;
      const expected = parseFloat(iniSection.Range);
      it(`${weaponName} Range=${expected}`, () => {
        expect(WEAPON_STATS[weaponName].range).toBe(expected);
      });
    }
  });

  describe('Warhead parity', () => {
    for (const weaponName of sharedWeapons) {
      const iniSection = ini[weaponName];
      if (!iniSection || iniSection.Warhead === undefined) continue;
      const expected = iniSection.Warhead;
      it(`${weaponName} Warhead=${expected}`, () => {
        expect(WEAPON_STATS[weaponName].warhead).toBe(expected);
      });
    }
  });

  describe('Burst parity', () => {
    for (const weaponName of sharedWeapons) {
      const iniSection = ini[weaponName];
      if (!iniSection) continue;
      const iniBurst = iniSection.Burst !== undefined ? parseInt(iniSection.Burst, 10) : 1;
      const tsBurst = WEAPON_STATS[weaponName].burst ?? 1;
      // Only test if INI has explicit Burst= or TS has explicit burst
      if (iniSection.Burst === undefined && WEAPON_STATS[weaponName].burst === undefined) continue;
      it(`${weaponName} Burst=${iniBurst}`, () => {
        expect(tsBurst).toBe(iniBurst);
      });
    }
  });

  describe('Speed (projSpeed) parity', () => {
    for (const weaponName of sharedWeapons) {
      const iniSection = ini[weaponName];
      if (!iniSection || iniSection.Speed === undefined) continue;
      const expected = parseInt(iniSection.Speed, 10);
      it(`${weaponName} Speed=${expected} → projSpeed`, () => {
        expect(WEAPON_STATS[weaponName].projSpeed).toBe(expected);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Known cross-check table — validates specific weapons against hardcoded
  // expected values to catch regressions in both INI and TS
  // -------------------------------------------------------------------------

  describe('Known value cross-checks', () => {
    const knownValues: Array<{
      weapon: string;
      damage: number;
      rof: number;
      range: number;
      warhead: string;
      speed: number;
      burst: number;
    }> = [
      { weapon: 'Colt45',       damage: 50,  rof: 5,   range: 5.75, warhead: 'HollowPoint', speed: 100, burst: 1 },
      { weapon: 'Stinger',      damage: 30,  rof: 60,  range: 9,    warhead: 'AP',          speed: 20,  burst: 2 },
      { weapon: 'DepthCharge',  damage: 80,  rof: 60,  range: 5,    warhead: 'AP',          speed: 5,   burst: 1 },
      { weapon: '8Inch',        damage: 500, rof: 160, range: 22,   warhead: 'HE',          speed: 6,   burst: 1 },
      // TeslaZap excluded: WEAPON_STATS has ant variant (dmg=60), INI is building version (dmg=100)
      { weapon: 'SCUD',         damage: 600, rof: 400, range: 10,   warhead: 'HE',          speed: 25,  burst: 1 },
      { weapon: 'MammothTusk',  damage: 75,  rof: 80,  range: 5,    warhead: 'HE',          speed: 30,  burst: 2 },
      { weapon: 'ParaBomb',     damage: 300, rof: 4,   range: 4.5,  warhead: 'HE',          speed: 5,   burst: 1 },
      { weapon: 'SubSCUD',      damage: 400, rof: 120, range: 14,   warhead: 'HE',          speed: 20,  burst: 2 },
      { weapon: 'APTusk',       damage: 75,  rof: 80,  range: 5,    warhead: 'AP',          speed: 30,  burst: 2 },
      { weapon: 'Democharge',   damage: 500, rof: 80,  range: 1.75, warhead: 'Nuke',        speed: 100, burst: 1 },
    ];

    for (const kv of knownValues) {
      describe(`${kv.weapon}`, () => {
        it(`INI Damage=${kv.damage}`, () => {
          expect(parseInt(ini[kv.weapon]?.Damage ?? '0', 10)).toBe(kv.damage);
        });
        it(`INI ROF=${kv.rof}`, () => {
          expect(parseInt(ini[kv.weapon]?.ROF ?? '0', 10)).toBe(kv.rof);
        });
        it(`INI Range=${kv.range}`, () => {
          expect(parseFloat(ini[kv.weapon]?.Range ?? '0')).toBe(kv.range);
        });
        it(`INI Warhead=${kv.warhead}`, () => {
          expect(ini[kv.weapon]?.Warhead).toBe(kv.warhead);
        });
        it(`INI Speed=${kv.speed}`, () => {
          expect(parseInt(ini[kv.weapon]?.Speed ?? '0', 10)).toBe(kv.speed);
        });
        it(`INI Burst=${kv.burst}`, () => {
          const iniBurst = ini[kv.weapon]?.Burst;
          expect(iniBurst !== undefined ? parseInt(iniBurst, 10) : 1).toBe(kv.burst);
        });
      });
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Catalog: INI-only weapons (structure weapons not in WEAPON_STATS)
// ---------------------------------------------------------------------------

describe('C++ Parity: INI-only weapons (STRUCTURE_WEAPONS, not in WEAPON_STATS)', () => {
  for (const { name, note } of STRUCTURE_ONLY_WEAPONS) {
    it(`${name} (${note}) — exists in INI but handled by STRUCTURE_WEAPONS`, () => {
      // Document that these INI weapon sections exist
      expect(ini[name]).toBeDefined();
      // And they are intentionally NOT in WEAPON_STATS (handled via STRUCTURE_WEAPONS)
      expect(WEAPON_STATS[name]).toBeUndefined();
    });
  }

  // Run a real assertion to verify the catalog is accurate
  it('all structure-only weapons exist in INI but not WEAPON_STATS', () => {
    for (const { name } of STRUCTURE_ONLY_WEAPONS) {
      expect(ini[name], `${name} should exist in INI`).toBeDefined();
      expect(WEAPON_STATS[name], `${name} should NOT be in WEAPON_STATS`).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Catalog: TS-only weapons (in WEAPON_STATS but NOT in INI)
// ---------------------------------------------------------------------------

describe('C++ Parity: TS-only weapons (engine custom, not in rules.ini/aftrmath.ini)', () => {
  for (const { name, note } of ENGINE_CUSTOM_WEAPONS) {
    it(`${name} (${note}) — exists in WEAPON_STATS but not INI`, () => {
      expect(WEAPON_STATS[name], `${name} should be in WEAPON_STATS`).toBeDefined();
      expect(ini[name], `${name} should NOT have an INI section`).toBeUndefined();
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Coverage: all INI weapon sections are accounted for
// ---------------------------------------------------------------------------

describe('C++ Parity: INI weapon section coverage', () => {
  it('every known INI weapon section is either in WEAPON_STATS, structure-only, or AirAssault', () => {
    const tsNames = new Set(Object.keys(WEAPON_STATS));
    const structNames = new Set(STRUCTURE_ONLY_WEAPONS.map(w => w.name));
    // AirAssault is an aftrmath.ini weapon with no TS equivalent (Hind secondary in expansion)
    const knownMissing = new Set(['AirAssault']);

    for (const weaponName of INI_WEAPON_NAMES) {
      const accounted =
        tsNames.has(weaponName) ||
        structNames.has(weaponName) ||
        knownMissing.has(weaponName) ||
        ANT_VARIANT_WEAPONS.has(weaponName);
      expect(accounted, `${weaponName} not accounted for in TS or structure weapons`).toBe(true);
    }
  });

  it('all INI weapon sections listed actually exist in the parsed INI', () => {
    for (const weaponName of INI_WEAPON_NAMES) {
      expect(ini[weaponName], `${weaponName} should exist in rules.ini or aftrmath.ini`).toBeDefined();
    }
  });
});
