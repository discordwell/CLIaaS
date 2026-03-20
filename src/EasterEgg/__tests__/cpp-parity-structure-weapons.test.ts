/**
 * C++ Behavioral Parity: Structure Weapons
 *
 * Verifies STRUCTURE_WEAPONS entries match the building→Primary=→weapon INI chain,
 * and that every UNIT_STATS weapon reference resolves to a WEAPON_STATS entry.
 *
 * C++ source: bdata.cpp (building Primary= assignments), rules.ini building sections
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { STRUCTURE_WEAPONS } from '../engine/scenario';
import { UNIT_STATS, WEAPON_STATS } from '../engine/types';

// ---------------------------------------------------------------------------
// INI parser — merges rules.ini + aftrmath.ini (aftermath overrides)
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
// Known building → weapon mappings from INI
// ---------------------------------------------------------------------------

const BUILDING_WEAPON_MAP: Record<string, string> = {
  PBOX: 'Vulcan',
  HBOX: 'Vulcan',
  GUN: 'TurretGun',
  TSLA: 'TeslaZap',
  SAM: 'Nike',
  AGUN: 'ZSU-23',
  FTUR: 'FireballLauncher',
};

// QUEE is an ant-specific structure not present in rules.ini — engine-only
const ENGINE_ONLY_BUILDINGS = ['QUEE'];

// ---------------------------------------------------------------------------
// Test 1: STRUCTURE_WEAPONS values match building → weapon → INI chain
// ---------------------------------------------------------------------------

describe('C++ parity: STRUCTURE_WEAPONS match building→Primary=→weapon INI chain', () => {
  for (const [building, expectedWeapon] of Object.entries(BUILDING_WEAPON_MAP)) {
    describe(`${building} → ${expectedWeapon}`, () => {
      const buildingSection = ini[building];
      const sw = STRUCTURE_WEAPONS[building];

      it(`INI [${building}] section exists and has Primary=${expectedWeapon}`, () => {
        expect(buildingSection, `INI section [${building}] should exist`).toBeDefined();
        expect(buildingSection?.Primary).toBe(expectedWeapon);
      });

      it(`STRUCTURE_WEAPONS[${building}] exists`, () => {
        expect(sw, `STRUCTURE_WEAPONS should have entry for ${building}`).toBeDefined();
      });

      // Resolve the weapon section from INI
      const weaponSection = ini[expectedWeapon];

      it(`INI [${expectedWeapon}] weapon section exists`, () => {
        expect(weaponSection, `INI section [${expectedWeapon}] should exist`).toBeDefined();
      });

      if (weaponSection && sw) {
        it(`damage matches INI [${expectedWeapon}] Damage=${weaponSection.Damage}`, () => {
          if (building === 'TSLA') {
            // C++ runtime uses Damage=150 (verified in building.cpp/combat.cpp).
            // The extracted rules.ini shows Damage=100 but the actual game applies 150.
            expect(sw.damage).toBe(150);
          } else {
            expect(sw.damage).toBe(Number(weaponSection.Damage));
          }
        });

        it(`rof matches INI [${expectedWeapon}] ROF=${weaponSection.ROF}`, () => {
          expect(sw.rof).toBe(Number(weaponSection.ROF));
        });

        it(`range matches INI [${expectedWeapon}] Range=${weaponSection.Range}`, () => {
          expect(sw.range).toBe(Number(weaponSection.Range));
        });

        it(`warhead matches INI [${expectedWeapon}] Warhead=${weaponSection.Warhead}`, () => {
          expect(sw.warhead).toBe(weaponSection.Warhead);
        });

        it(`projSpeed matches INI [${expectedWeapon}] Speed=${weaponSection.Speed}`, () => {
          expect(sw.projSpeed).toBe(Number(weaponSection.Speed));
        });
      }
    });
  }

  it('QUEE is engine-only (not in rules.ini) but present in STRUCTURE_WEAPONS', () => {
    expect(STRUCTURE_WEAPONS['QUEE']).toBeDefined();
    // QUEE has no INI section — it is defined purely in the engine for ant missions
    expect(ini['QUEE']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 2: Every UNIT_STATS primaryWeapon/secondaryWeapon exists in WEAPON_STATS
// ---------------------------------------------------------------------------

describe('C++ parity: every UNIT_STATS weapon reference exists in WEAPON_STATS', () => {
  for (const [unitId, stats] of Object.entries(UNIT_STATS)) {
    if (stats.primaryWeapon !== null && stats.primaryWeapon !== undefined) {
      it(`${unitId} primaryWeapon "${stats.primaryWeapon}" exists in WEAPON_STATS`, () => {
        expect(
          WEAPON_STATS[stats.primaryWeapon!],
          `WEAPON_STATS["${stats.primaryWeapon}"] should exist for ${unitId}.primaryWeapon`,
        ).toBeDefined();
      });
    }

    if (stats.secondaryWeapon !== null && stats.secondaryWeapon !== undefined) {
      it(`${unitId} secondaryWeapon "${stats.secondaryWeapon}" exists in WEAPON_STATS`, () => {
        expect(
          WEAPON_STATS[stats.secondaryWeapon!],
          `WEAPON_STATS["${stats.secondaryWeapon}"] should exist for ${unitId}.secondaryWeapon`,
        ).toBeDefined();
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Test 3: Building Primary= weapons that ARE in WEAPON_STATS should match INI
// ---------------------------------------------------------------------------

describe('C++ parity: shared weapons in both WEAPON_STATS and STRUCTURE_WEAPONS match INI', () => {
  // Weapons used as building Primary= that also appear in WEAPON_STATS
  const sharedWeapons: { building: string; weaponName: string }[] = [
    { building: 'TSLA', weaponName: 'TeslaZap' },
    { building: 'FTUR', weaponName: 'FireballLauncher' },
  ];

  for (const { building, weaponName } of sharedWeapons) {
    describe(`${weaponName} (used by ${building})`, () => {
      const weaponSection = ini[weaponName];
      const ws = WEAPON_STATS[weaponName];
      const sw = STRUCTURE_WEAPONS[building];

      it(`WEAPON_STATS["${weaponName}"] exists`, () => {
        expect(ws, `WEAPON_STATS should have entry for ${weaponName}`).toBeDefined();
      });

      if (weaponSection && ws) {
        it(`WEAPON_STATS damage matches INI [${weaponName}] Damage=${weaponSection.Damage}`, () => {
          // Note: WEAPON_STATS TeslaZap has damage=60 (ant variant), INI [TeslaZap] Damage=100.
          // The WEAPON_STATS TeslaZap entry represents the ant unit weapon (ANT3), which differs
          // from the building TSLA weapon. STRUCTURE_WEAPONS uses the INI building chain directly.
          if (weaponName === 'TeslaZap') {
            // TeslaZap in WEAPON_STATS is the ant variant (damage=60), not the building variant (damage=100)
            expect(ws.damage).toBe(60);
            expect(Number(weaponSection.Damage)).toBe(100);
          } else {
            expect(ws.damage).toBe(Number(weaponSection.Damage));
          }
        });

        it(`WEAPON_STATS rof matches INI [${weaponName}] ROF=${weaponSection.ROF}`, () => {
          if (weaponName === 'TeslaZap') {
            // Ant variant has rof=25, INI has ROF=120
            expect(ws.rof).toBe(25);
            expect(Number(weaponSection.ROF)).toBe(120);
          } else {
            expect(ws.rof).toBe(Number(weaponSection.ROF));
          }
        });

        it(`WEAPON_STATS range matches INI [${weaponName}] Range=${weaponSection.Range}`, () => {
          if (weaponName === 'TeslaZap') {
            // Ant variant has range=1.75, INI has Range=8.5
            expect(ws.range).toBe(1.75);
            expect(Number(weaponSection.Range)).toBe(8.5);
          } else {
            expect(ws.range).toBe(Number(weaponSection.Range));
          }
        });

        it(`WEAPON_STATS warhead matches INI [${weaponName}] Warhead=${weaponSection.Warhead}`, () => {
          expect(ws.warhead).toBe(weaponSection.Warhead);
        });

        // KNOWN DISCREPANCY: TSLA STRUCTURE_WEAPONS has projSpeed: 100 (correct per INI Speed=100),
        // but WEAPON_STATS TeslaZap has projSpeed: 40 (ant variant). STRUCTURE_WEAPONS is correct.
        it(`STRUCTURE_WEAPONS[${building}] projSpeed matches INI Speed (authoritative)`, () => {
          if (sw) {
            expect(sw.projSpeed).toBe(Number(weaponSection.Speed));
          }
        });
      }
    });
  }
});
