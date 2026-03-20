/**
 * C++ Behavioral Parity: Warhead Data
 *
 * Verifies TypeScript warhead tables (WARHEAD_VS_ARMOR, WARHEAD_META, WARHEAD_PROPS)
 * match C++ rules.ini / aftrmath.ini warhead section values exactly.
 *
 * C++ source: warhead.cpp, rules.ini lines 2641-2724, aftrmath.ini [Mechanical]
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import {
  WARHEAD_VS_ARMOR,
  WARHEAD_META,
  WARHEAD_PROPS,
  type WarheadType,
} from '../engine/types';

// ---------------------------------------------------------------------------
// INI parser — identical to ini-parity pattern
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

// Merge: aftrmath overrides rules
const ini: Record<string, Record<string, string>> = {};
for (const [section, values] of Object.entries(rules)) {
  ini[section] = { ...values };
}
for (const [section, values] of Object.entries(aftrmath)) {
  ini[section] = { ...(ini[section] || {}), ...values };
}

// ---------------------------------------------------------------------------
// All 9 warhead types from WarheadType
// ---------------------------------------------------------------------------
const ALL_WARHEADS: WarheadType[] = [
  'SA', 'HE', 'AP', 'Fire', 'HollowPoint', 'Super', 'Organic', 'Nuke', 'Mechanical',
];

// ---------------------------------------------------------------------------
// Helper: parse a Verses= string like "100%,50%,60%,25%,25%" into [1.0, 0.5, 0.6, 0.25, 0.25]
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
// 1. WARHEAD_VS_ARMOR — Verses= values
//    C++ source: warhead.cpp, rules.ini [SA] through [Mechanical] Verses= lines
// ---------------------------------------------------------------------------
describe('WARHEAD_VS_ARMOR — Verses= parity (warhead.cpp)', () => {
  for (const wh of ALL_WARHEADS) {
    it(`${wh}: Verses= values match INI`, () => {
      const section = ini[wh];
      expect(section, `INI section [${wh}] should exist`).toBeDefined();

      const versesStr = section?.Verses;
      expect(versesStr, `[${wh}] should have a Verses= key`).toBeDefined();

      const expected = parseVerses(versesStr!);
      const actual = WARHEAD_VS_ARMOR[wh];
      expect(actual, `WARHEAD_VS_ARMOR['${wh}'] should exist`).toBeDefined();

      for (let i = 0; i < 5; i++) {
        const armorNames = ['none', 'wood', 'light', 'heavy', 'concrete'];
        expect(actual[i]).toBeCloseTo(
          expected[i],
          4,
          // assertion context is the 3rd arg of toBeCloseTo — not supported,
          // so we use a descriptive it-block name instead
        );
      }

      // Also verify as a tuple for a single clear comparison
      expect(actual).toEqual(expected.map((v) => expect.closeTo(v, 4)));
    });
  }
});

// ---------------------------------------------------------------------------
// 2. WARHEAD_META — Spread, Wall, Wood, Ore
//    C++ source: warhead.cpp:72 (spreadFactor), combat.cpp:244-270 (wall/wood/ore)
// ---------------------------------------------------------------------------
describe('WARHEAD_META — Spread/Wall/Wood/Ore parity (warhead.cpp, combat.cpp)', () => {
  for (const wh of ALL_WARHEADS) {
    describe(`${wh}`, () => {
      it('spreadFactor matches INI Spread=', () => {
        const section = ini[wh];
        if (!section) {
          // Mechanical only exists in aftrmath.ini; if missing, skip
          if (wh === 'Mechanical') return;
          throw new Error(`INI section [${wh}] not found`);
        }
        const iniSpread = section.Spread != null ? parseInt(section.Spread, 10) : 0;
        expect(WARHEAD_META[wh].spreadFactor).toBe(iniSpread);
      });

      it('destroysWalls matches INI Wall=yes', () => {
        const section = ini[wh];
        const iniWall = section?.Wall?.toLowerCase() === 'yes';
        if (iniWall) {
          expect(
            WARHEAD_META[wh].destroysWalls,
          ).toBe(true);
        } else {
          expect(
            WARHEAD_META[wh].destroysWalls,
          ).toBeFalsy();
        }
      });

      it('destroysWood matches INI Wood=yes', () => {
        const section = ini[wh];
        const iniWood = section?.Wood?.toLowerCase() === 'yes';
        if (iniWood) {
          expect(
            WARHEAD_META[wh].destroysWood,
          ).toBe(true);
        } else {
          expect(
            WARHEAD_META[wh].destroysWood,
          ).toBeFalsy();
        }
      });

      it('destroysOre matches INI Ore=yes', () => {
        const section = ini[wh];
        const iniOre = section?.Ore?.toLowerCase() === 'yes';

        // KNOWN DISCREPANCY: HE warhead in TS has destroysOre: true but
        // rules.ini [HE] does NOT have Ore=yes. Only [Nuke] has Ore=yes.
        // This is an intentional gameplay decision in the TS implementation
        // that diverges from C++ rules.ini. The test is left failing to
        // document this discrepancy.
        if (iniOre) {
          expect(
            WARHEAD_META[wh].destroysOre,
          ).toBe(true);
        } else {
          expect(
            WARHEAD_META[wh].destroysOre,
          ).toBeFalsy();
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 3. WARHEAD_PROPS — InfDeath, Explosion
//    C++ source: warhead.cpp InfDeath= / Explosion= fields
// ---------------------------------------------------------------------------
describe('WARHEAD_PROPS — InfDeath/Explosion parity (warhead.cpp)', () => {
  for (const wh of ALL_WARHEADS) {
    describe(`${wh}`, () => {
      it('infantryDeath matches INI InfDeath=', () => {
        const section = ini[wh];
        if (!section) {
          if (wh === 'Mechanical') return;
          throw new Error(`INI section [${wh}] not found`);
        }
        const iniInfDeath = section.InfDeath != null ? parseInt(section.InfDeath, 10) : 0;
        expect(WARHEAD_PROPS[wh].infantryDeath).toBe(iniInfDeath);
      });

      it('explosionSet matches INI Explosion= (default 0)', () => {
        const section = ini[wh];
        if (!section) {
          if (wh === 'Mechanical') return;
          throw new Error(`INI section [${wh}] not found`);
        }
        const iniExplosion = section.Explosion != null ? parseInt(section.Explosion, 10) : 0;
        expect(WARHEAD_PROPS[wh].explosionSet).toBe(iniExplosion);
      });
    });
  }
});
