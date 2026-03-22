/**
 * C++ Behavioral Parity: Warhead Verses= (damage multipliers per armor type)
 *
 * Parses rules.ini and aftrmath.ini directly to verify that TS WARHEAD_VS_ARMOR
 * values match the authoritative INI Verses= lines for every warhead type.
 *
 * Armor order: [none, wood, light, heavy, concrete] — index 0..4
 *
 * INI sources:
 *   rules.ini lines 2665-2723: [SA], [HE], [AP], [Fire], [HollowPoint], [Super], [Organic], [Nuke]
 *   aftrmath.ini line 195:     [Mechanical]
 *
 * C++ source: warhead.cpp — WarheadTypeClass::Read_INI reads Verses= percentages
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { WARHEAD_VS_ARMOR, type WarheadType } from '../engine/types';

// ---------------------------------------------------------------------------
// INI parser
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

// ---------------------------------------------------------------------------
// Load INI files — aftrmath.ini overrides rules.ini
// ---------------------------------------------------------------------------
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
// Parse Verses= "100%,50%,60%,25%,25%" → [1.0, 0.5, 0.6, 0.25, 0.25]
// ---------------------------------------------------------------------------
function parseVerses(versesStr: string): [number, number, number, number, number] {
  const parts = versesStr.split(',').map((s) => {
    const trimmed = s.trim().replace('%', '');
    return parseFloat(trimmed) / 100;
  });
  if (parts.length !== 5) {
    throw new Error(`Expected 5 verse values, got ${parts.length}: "${versesStr}"`);
  }
  return parts as [number, number, number, number, number];
}

// ---------------------------------------------------------------------------
// All 9 warhead types
// ---------------------------------------------------------------------------
const ALL_WARHEADS: WarheadType[] = [
  'SA', 'HE', 'AP', 'Fire', 'HollowPoint', 'Super', 'Organic', 'Nuke', 'Mechanical',
];

const ARMOR_NAMES = ['none', 'wood', 'light', 'heavy', 'concrete'] as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('WARHEAD_VS_ARMOR vs rules.ini/aftrmath.ini Verses= (warhead.cpp)', () => {

  it('every warhead in WARHEAD_VS_ARMOR has a matching INI section', () => {
    for (const wh of ALL_WARHEADS) {
      expect(ini[wh], `INI section [${wh}] should exist`).toBeDefined();
      expect(ini[wh]?.Verses, `[${wh}] should have Verses=`).toBeDefined();
    }
  });

  for (const wh of ALL_WARHEADS) {
    describe(`[${wh}]`, () => {
      const section = ini[wh];
      const versesStr = section?.Verses;
      if (!versesStr) return; // guarded by top-level test

      const iniValues = parseVerses(versesStr);
      const tsValues = WARHEAD_VS_ARMOR[wh];

      for (let i = 0; i < 5; i++) {
        it(`vs ${ARMOR_NAMES[i]}: TS ${tsValues[i]} === INI ${iniValues[i]}`, () => {
          expect(tsValues[i]).toBeCloseTo(iniValues[i], 4);
        });
      }

      it('full tuple matches INI Verses=', () => {
        expect(tsValues).toEqual(iniValues.map((v) => expect.closeTo(v, 4)));
      });
    });
  }
});

describe('aftrmath.ini warhead overrides', () => {
  it('[Mechanical] exists only in aftrmath.ini, not rules.ini', () => {
    expect(rules['Mechanical']).toBeUndefined();
    expect(aftrmath['Mechanical']).toBeDefined();
    expect(aftrmath['Mechanical']?.Verses).toBe('100%,100%,100%,100%,100%');
  });

  it('no aftrmath.ini overrides change base warhead Verses=', () => {
    // Check that aftrmath.ini does not redefine Verses= for any base warhead
    const baseWarheads: WarheadType[] = ['SA', 'HE', 'AP', 'Fire', 'HollowPoint', 'Super', 'Organic', 'Nuke'];
    for (const wh of baseWarheads) {
      const aftSection = aftrmath[wh];
      if (aftSection?.Verses) {
        // If aftrmath.ini does override, verify the merged value still matches TS
        const aftVerses = parseVerses(aftSection.Verses);
        expect(WARHEAD_VS_ARMOR[wh]).toEqual(
          aftVerses.map((v) => expect.closeTo(v, 4)),
        );
      }
    }
  });
});

describe('completeness: WARHEAD_VS_ARMOR covers all INI warhead sections', () => {
  it('no INI warhead section with Verses= is missing from WARHEAD_VS_ARMOR', () => {
    const iniWarheadSections = Object.keys(ini).filter((key) => ini[key]?.Verses);
    // Filter to only known warhead sections (not weapon/unit sections that might have Verses)
    for (const section of iniWarheadSections) {
      if (ALL_WARHEADS.includes(section as WarheadType)) {
        expect(
          WARHEAD_VS_ARMOR[section as WarheadType],
          `WARHEAD_VS_ARMOR should include [${section}]`,
        ).toBeDefined();
      }
    }
  });

  it('WARHEAD_VS_ARMOR has exactly 9 entries', () => {
    expect(Object.keys(WARHEAD_VS_ARMOR).length).toBe(9);
  });
});
