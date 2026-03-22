/**
 * C++ parity audit: production data (costs, build times, prerequisites, faction ownership)
 *
 * Reads rules.ini + aftrmath.ini directly and cross-references against:
 *   - UNIT_STATS (cost, owner fields)
 *   - PRODUCTION_ITEMS (cost, buildTime, prerequisite, techLevel, techPrereq, faction)
 *
 * Tests that FAIL are GOOD -- they identify real discrepancies between
 * the TypeScript engine and the authoritative C++ INI data.
 *
 * INI source files:
 *   rules.ini  -- base Red Alert rules
 *   aftrmath.ini -- Aftermath/Counterstrike expansion overrides
 *
 * C++ build time formula (techno.cpp:6075-6078):
 *   Time_To_Build = Cost * Rule.BuildSpeedBias * TICKS_PER_MINUTE / 1000
 *   With BuildSpeedBias=0.8, TICKS_PER_MINUTE=900 (15Hz):
 *   buildTime = floor(Cost * 0.8 * 900 / 1000) = floor(Cost * 0.72)
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { UNIT_STATS, PRODUCTION_ITEMS } from '../engine/types';

// ---------------------------------------------------------------------------
// INI Parser (same pattern as ini-parity.test.ts)
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
// Load and merge INI files (aftrmath overrides rules)
// ---------------------------------------------------------------------------

const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');
const rules = parseINI(readFileSync(join(assetsDir, 'rules.ini'), 'utf-8'));
const aftrmath = parseINI(readFileSync(join(assetsDir, 'aftrmath.ini'), 'utf-8'));

// Merge: per-key override within each section (Aftermath takes precedence)
const ini: Record<string, Record<string, string>> = {};
for (const [section, values] of Object.entries(rules)) {
  ini[section] = { ...values };
}
for (const [section, values] of Object.entries(aftrmath)) {
  ini[section] = { ...(ini[section] || {}), ...values };
}

// ---------------------------------------------------------------------------
// Helper: map INI Owner= to TS faction ('allied'|'soviet'|'both')
// ---------------------------------------------------------------------------

const ALLIED_HOUSES = new Set(['allies', 'england', 'spain', 'greece', 'germany', 'france', 'turkey']);
const SOVIET_HOUSES = new Set(['soviet', 'ussr', 'ukraine']);

function iniOwnerToFaction(ownerStr: string): 'allied' | 'soviet' | 'both' {
  if (!ownerStr) return 'both'; // no Owner= means universal
  const houses = ownerStr.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  let hasAllied = false;
  let hasSoviet = false;
  for (const h of houses) {
    if (ALLIED_HOUSES.has(h)) hasAllied = true;
    if (SOVIET_HOUSES.has(h)) hasSoviet = true;
  }
  if (hasAllied && hasSoviet) return 'both';
  if (hasAllied) return 'allied';
  if (hasSoviet) return 'soviet';
  return 'both'; // fallback
}

// ---------------------------------------------------------------------------
// Helper: C++ build time formula
// ---------------------------------------------------------------------------

function cppBuildTime(cost: number): number {
  // techno.cpp:6077: Cost * BuildSpeedBias * TICKS_PER_MINUTE / 1000
  // BuildSpeedBias=0.8, TICKS_PER_MINUTE=900 (15Hz, no scaling needed)
  return Math.floor(cost * 0.8 * 900 / 1000);
}

// ---------------------------------------------------------------------------
// Units/buildings to skip in coverage checks
// ---------------------------------------------------------------------------

// Non-buildable: scenario-only ants, civilians, non-producible aircraft, special units
const NON_BUILDABLE = new Set([
  'ANT1', 'ANT2', 'ANT3',                                     // scenario-only ants
  'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', // civilians
  'EINSTEIN', 'GNRL', 'CHAN',                                   // VIPs / scenario specialists
  'BADR', 'U2',                                                 // non-buildable aircraft
  'TRUK',                                                       // convoy truck (not player-buildable)
  'MCV',                                                        // MCV is placed, not queued in all scenarios
]);

// ---------------------------------------------------------------------------
// 1. Unit costs: UNIT_STATS.cost vs INI Cost=
// ---------------------------------------------------------------------------

describe('1. Unit costs: UNIT_STATS cost vs INI Cost=', () => {
  for (const [unitId, stats] of Object.entries(UNIT_STATS)) {
    if (stats.cost === undefined) continue; // skip units without cost in TS
    const iniSection = ini[unitId];
    if (!iniSection || !iniSection.Cost) continue; // skip if no INI section

    it(`${unitId}: UNIT_STATS.cost=${stats.cost} should match INI Cost=${iniSection.Cost}`, () => {
      const iniCost = parseInt(iniSection.Cost, 10);
      expect(stats.cost, `${unitId} cost mismatch`).toBe(iniCost);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. PRODUCTION_ITEMS costs vs INI Cost=
// ---------------------------------------------------------------------------

describe('2. PRODUCTION_ITEMS cost vs INI Cost=', () => {
  for (const item of PRODUCTION_ITEMS) {
    const iniSection = ini[item.type];
    if (!iniSection || !iniSection.Cost) continue;

    it(`${item.type}: PRODUCTION_ITEMS.cost=${item.cost} should match INI Cost=${iniSection.Cost}`, () => {
      const iniCost = parseInt(iniSection.Cost, 10);
      expect(item.cost, `${item.type} cost mismatch`).toBe(iniCost);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Unit Owner (faction) — UNIT_STATS.owner vs INI Owner=
// ---------------------------------------------------------------------------

describe('3. Unit faction: UNIT_STATS.owner vs INI Owner=', () => {
  for (const [unitId, stats] of Object.entries(UNIT_STATS)) {
    if (!stats.owner) continue; // skip units without owner in TS
    const iniSection = ini[unitId];
    if (!iniSection || iniSection.Owner === undefined) continue;

    it(`${unitId}: UNIT_STATS.owner='${stats.owner}' should match INI Owner='${iniSection.Owner}'`, () => {
      const iniFaction = iniOwnerToFaction(iniSection.Owner);
      expect(stats.owner, `${unitId} owner/faction mismatch`).toBe(iniFaction);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. PRODUCTION_ITEMS faction vs INI Owner=
// ---------------------------------------------------------------------------

describe('4. PRODUCTION_ITEMS faction vs INI Owner=', () => {
  for (const item of PRODUCTION_ITEMS) {
    const iniSection = ini[item.type];
    if (!iniSection || iniSection.Owner === undefined) continue;

    it(`${item.type}: faction='${item.faction}' should match INI Owner='${iniSection.Owner}'`, () => {
      const iniFaction = iniOwnerToFaction(iniSection.Owner);
      expect(item.faction, `${item.type} faction mismatch`).toBe(iniFaction);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Build times: PRODUCTION_ITEMS.buildTime vs C++ formula floor(Cost*0.72)
// ---------------------------------------------------------------------------

describe('5. Build times: PRODUCTION_ITEMS.buildTime vs C++ formula', () => {
  for (const item of PRODUCTION_ITEMS) {
    it(`${item.type}: buildTime=${item.buildTime} should equal floor(${item.cost} * 0.72) = ${cppBuildTime(item.cost)}`, () => {
      expect(item.buildTime, `${item.type} buildTime mismatch`).toBe(cppBuildTime(item.cost));
    });
  }
});

// ---------------------------------------------------------------------------
// 6. TechLevel: PRODUCTION_ITEMS.techLevel vs INI TechLevel=
// ---------------------------------------------------------------------------

describe('6. TechLevel: PRODUCTION_ITEMS.techLevel vs INI TechLevel=', () => {
  for (const item of PRODUCTION_ITEMS) {
    if (item.techLevel === undefined) continue;
    const iniSection = ini[item.type];
    if (!iniSection || !iniSection.TechLevel) continue;

    it(`${item.type}: techLevel=${item.techLevel} should match INI TechLevel=${iniSection.TechLevel}`, () => {
      const iniTechLevel = parseInt(iniSection.TechLevel, 10);
      expect(item.techLevel, `${item.type} techLevel mismatch`).toBe(iniTechLevel);
    });
  }
});

// ---------------------------------------------------------------------------
// 7. Prerequisites: PRODUCTION_ITEMS.prerequisite vs INI Prerequisite=
// ---------------------------------------------------------------------------

describe('7. Prerequisites: PRODUCTION_ITEMS.prerequisite vs INI Prerequisite=', () => {
  // INI Prerequisite= lists comma-separated building types (lowercase).
  // TS PRODUCTION_ITEMS has:
  //   - prerequisite: primary required building (first in INI list, or faction-specific)
  //   - techPrereq: secondary required building (second in INI list, if any)
  //
  // Special cases:
  //   - Infantry get TENT (allied) or BARR (soviet) as prerequisite from their faction,
  //     not from the INI (INI may not list a Prerequisite for infantry base building).
  //   - Some items have no INI Prerequisite= (e.g. E1 defaults to TENT/BARR).

  // For items with INI Prerequisite=, verify the INI prereqs are captured in TS
  for (const item of PRODUCTION_ITEMS) {
    const iniSection = ini[item.type];
    if (!iniSection || !iniSection.Prerequisite) continue;

    const iniPrereqs = iniSection.Prerequisite.toLowerCase()
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.toUpperCase());

    if (iniPrereqs.length === 0) continue;

    it(`${item.type}: TS prerequisite='${item.prerequisite}' + techPrereq='${item.techPrereq ?? 'none'}' should cover INI Prerequisite='${iniSection.Prerequisite}'`, () => {
      // The primary prerequisite from INI should appear as either
      // item.prerequisite or item.techPrereq in the TS data.
      // For infantry, the barracks type (TENT/BARR) is the TS prerequisite,
      // and INI Prerequisite is typically the techPrereq.
      const tsPrereqs = [item.prerequisite.toUpperCase()];
      if (item.techPrereq) tsPrereqs.push(item.techPrereq.toUpperCase());

      // Every INI prerequisite should be covered by TS prerequisite + techPrereq
      for (const iniPrereq of iniPrereqs) {
        expect(
          tsPrereqs.includes(iniPrereq),
          `${item.type}: INI prereq '${iniPrereq}' not found in TS prereqs [${tsPrereqs.join(', ')}]`
        ).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 8. Cost consistency: PRODUCTION_ITEMS.cost should match UNIT_STATS.cost
//    (where both exist for the same type)
// ---------------------------------------------------------------------------

describe('8. Cost consistency: PRODUCTION_ITEMS vs UNIT_STATS', () => {
  for (const item of PRODUCTION_ITEMS) {
    const stats = UNIT_STATS[item.type];
    if (!stats || stats.cost === undefined) continue;

    it(`${item.type}: PRODUCTION_ITEMS.cost=${item.cost} should match UNIT_STATS.cost=${stats.cost}`, () => {
      expect(item.cost, `${item.type} cost inconsistency between PRODUCTION_ITEMS and UNIT_STATS`).toBe(stats.cost);
    });
  }
});

// ---------------------------------------------------------------------------
// 9. Faction consistency: PRODUCTION_ITEMS.faction should match UNIT_STATS.owner
//    (where both exist for the same type)
// ---------------------------------------------------------------------------

describe('9. Faction consistency: PRODUCTION_ITEMS vs UNIT_STATS', () => {
  for (const item of PRODUCTION_ITEMS) {
    if (item.isStructure) continue; // structures don't have UNIT_STATS
    const stats = UNIT_STATS[item.type];
    if (!stats || !stats.owner) continue;

    it(`${item.type}: PRODUCTION_ITEMS.faction='${item.faction}' should match UNIT_STATS.owner='${stats.owner}'`, () => {
      expect(item.faction, `${item.type} faction inconsistency`).toBe(stats.owner);
    });
  }
});

// ---------------------------------------------------------------------------
// 10. Coverage check: every UNIT_STATS unit with an INI section should have
//     a PRODUCTION_ITEMS entry (excluding non-buildable units)
// ---------------------------------------------------------------------------

describe('10. Coverage: buildable UNIT_STATS units should have PRODUCTION_ITEMS entries', () => {
  const prodTypes = new Set(PRODUCTION_ITEMS.map(i => i.type));

  for (const [unitId, stats] of Object.entries(UNIT_STATS)) {
    if (NON_BUILDABLE.has(unitId)) continue;

    const iniSection = ini[unitId];
    if (!iniSection) continue; // no INI section means not a standard unit

    // Skip units with TechLevel=-1 (non-buildable in rules.ini)
    const techLevel = iniSection.TechLevel ? parseInt(iniSection.TechLevel, 10) : undefined;
    if (techLevel === -1) continue;

    it(`${unitId}: should have a PRODUCTION_ITEMS entry`, () => {
      expect(
        prodTypes.has(unitId),
        `${unitId} is in UNIT_STATS with INI section but missing from PRODUCTION_ITEMS`
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 11. INI Cost sanity: every PRODUCTION_ITEMS entry should have a matching
//     INI section with a Cost= field
// ---------------------------------------------------------------------------

describe('11. INI coverage: every PRODUCTION_ITEMS entry has an INI section with Cost=', () => {
  // Some non-buildable items may lack an INI section or Cost= field
  const KNOWN_NO_COST = new Set([
    'WOOD',  // no Cost= in INI, map decoration only
    'MISS',  // civilian tech center, no INI section in rules.ini/aftrmath.ini
  ]);
  for (const item of PRODUCTION_ITEMS) {
    if (KNOWN_NO_COST.has(item.type)) {
      it(`${item.type}: KNOWN — no INI Cost= (non-buildable)`, () => {
        // Document: this item has no Cost= in INI
        expect(item.cost).toBe(0);
      });
    } else {
      it(`${item.type}: should have INI section with Cost= field`, () => {
        const iniSection = ini[item.type];
        expect(iniSection, `${item.type} has no INI section`).toBeDefined();
        expect(iniSection?.Cost, `${item.type} INI section has no Cost= field`).toBeDefined();
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 12. Expansion unit cost parity (aftrmath.ini overrides)
// ---------------------------------------------------------------------------

describe('12. Aftermath expansion cost overrides', () => {
  // These units are defined in aftrmath.ini with different costs than rules.ini
  const expansionUnits = ['STNK', 'CTNK', 'TTNK', 'DTRK', 'QTNK', 'MSUB', 'SHOK', 'MECH'];

  for (const unitId of expansionUnits) {
    const iniSection = ini[unitId]; // merged with aftrmath overrides
    if (!iniSection || !iniSection.Cost) continue;

    const prodItem = PRODUCTION_ITEMS.find(i => i.type === unitId);
    if (!prodItem) continue;

    it(`${unitId}: PRODUCTION_ITEMS.cost=${prodItem.cost} should match merged INI Cost=${iniSection.Cost}`, () => {
      const iniCost = parseInt(iniSection.Cost, 10);
      expect(prodItem.cost, `${unitId} expansion cost mismatch`).toBe(iniCost);
    });
  }
});

// ---------------------------------------------------------------------------
// 13. Expansion unit prerequisite parity (aftrmath.ini overrides)
// ---------------------------------------------------------------------------

describe('13. Aftermath expansion prerequisite overrides', () => {
  const expansionUnits = ['STNK', 'CTNK', 'TTNK', 'DTRK', 'QTNK', 'MSUB', 'SHOK', 'MECH'];

  for (const unitId of expansionUnits) {
    const iniSection = ini[unitId];
    if (!iniSection || !iniSection.Prerequisite) continue;

    const prodItem = PRODUCTION_ITEMS.find(i => i.type === unitId);
    if (!prodItem) continue;

    const iniPrereqs = iniSection.Prerequisite.toLowerCase()
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.toUpperCase());

    it(`${unitId}: TS prereqs should cover INI Prerequisite='${iniSection.Prerequisite}'`, () => {
      const tsPrereqs = [prodItem.prerequisite.toUpperCase()];
      if (prodItem.techPrereq) tsPrereqs.push(prodItem.techPrereq.toUpperCase());

      for (const iniPrereq of iniPrereqs) {
        expect(
          tsPrereqs.includes(iniPrereq),
          `${unitId}: INI prereq '${iniPrereq}' not found in TS [${tsPrereqs.join(', ')}]`
        ).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 14. Expansion unit TechLevel parity (aftrmath.ini overrides)
// ---------------------------------------------------------------------------

describe('14. Aftermath expansion TechLevel overrides', () => {
  const expansionUnits = ['STNK', 'CTNK', 'TTNK', 'DTRK', 'QTNK', 'MSUB', 'SHOK', 'MECH'];

  for (const unitId of expansionUnits) {
    const iniSection = ini[unitId];
    if (!iniSection || !iniSection.TechLevel) continue;

    const prodItem = PRODUCTION_ITEMS.find(i => i.type === unitId);
    if (!prodItem || prodItem.techLevel === undefined) continue;

    it(`${unitId}: techLevel=${prodItem.techLevel} should match merged INI TechLevel=${iniSection.TechLevel}`, () => {
      const iniTechLevel = parseInt(iniSection.TechLevel, 10);
      expect(prodItem.techLevel, `${unitId} expansion techLevel mismatch`).toBe(iniTechLevel);
    });
  }
});

// ---------------------------------------------------------------------------
// 15. Structure costs vs INI Cost=
// ---------------------------------------------------------------------------

describe('15. Structure costs vs INI Cost=', () => {
  const structures = PRODUCTION_ITEMS.filter(i => i.isStructure);

  for (const item of structures) {
    const iniSection = ini[item.type];
    if (!iniSection || !iniSection.Cost) continue;

    it(`${item.type}: cost=${item.cost} should match INI Cost=${iniSection.Cost}`, () => {
      const iniCost = parseInt(iniSection.Cost, 10);
      expect(item.cost, `${item.type} structure cost mismatch`).toBe(iniCost);
    });
  }
});

// ---------------------------------------------------------------------------
// 16. Structure faction vs INI Owner=
// ---------------------------------------------------------------------------

describe('16. Structure faction vs INI Owner=', () => {
  const structures = PRODUCTION_ITEMS.filter(i => i.isStructure);

  for (const item of structures) {
    const iniSection = ini[item.type];
    if (!iniSection || iniSection.Owner === undefined) continue;

    it(`${item.type}: faction='${item.faction}' should match INI Owner='${iniSection.Owner}'`, () => {
      const iniFaction = iniOwnerToFaction(iniSection.Owner);
      expect(item.faction, `${item.type} structure faction mismatch`).toBe(iniFaction);
    });
  }
});

// ---------------------------------------------------------------------------
// 17. Structure prerequisite vs INI Prerequisite=
// ---------------------------------------------------------------------------

describe('17. Structure prerequisites vs INI Prerequisite=', () => {
  const structures = PRODUCTION_ITEMS.filter(i => i.isStructure);

  for (const item of structures) {
    const iniSection = ini[item.type];
    if (!iniSection || !iniSection.Prerequisite) continue;

    const iniPrereqs = iniSection.Prerequisite.toLowerCase()
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.toUpperCase());

    if (iniPrereqs.length === 0) continue;

    it(`${item.type}: prereqs should cover INI Prerequisite='${iniSection.Prerequisite}'`, () => {
      const tsPrereqs = [item.prerequisite.toUpperCase()];
      if (item.techPrereq) tsPrereqs.push(item.techPrereq.toUpperCase());

      for (const iniPrereq of iniPrereqs) {
        expect(
          tsPrereqs.includes(iniPrereq),
          `${item.type}: INI prereq '${iniPrereq}' not in TS [${tsPrereqs.join(', ')}]`
        ).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 18. Structure TechLevel vs INI TechLevel=
// ---------------------------------------------------------------------------

describe('18. Structure TechLevel vs INI TechLevel=', () => {
  const structures = PRODUCTION_ITEMS.filter(i => i.isStructure);

  for (const item of structures) {
    if (item.techLevel === undefined) continue;
    const iniSection = ini[item.type];
    if (!iniSection || !iniSection.TechLevel) continue;

    it(`${item.type}: techLevel=${item.techLevel} should match INI TechLevel=${iniSection.TechLevel}`, () => {
      const iniTechLevel = parseInt(iniSection.TechLevel, 10);
      expect(item.techLevel, `${item.type} structure techLevel mismatch`).toBe(iniTechLevel);
    });
  }
});

// ---------------------------------------------------------------------------
// 19. Infantry barracks mapping: allied infantry -> TENT, soviet -> BARR
// ---------------------------------------------------------------------------

describe('19. Infantry barracks assignment parity', () => {
  const infantryItems = PRODUCTION_ITEMS.filter(i =>
    !i.isStructure && UNIT_STATS[i.type]?.isInfantry
  );

  for (const item of infantryItems) {
    const iniSection = ini[item.type];
    if (!iniSection) continue;

    // In C++, infantry training building depends on the side:
    //   Allied infantry -> TENT (Allied barracks)
    //   Soviet infantry -> BARR (Soviet barracks)
    //   Both-faction infantry -> TENT (convention in TS)
    it(`${item.type}: infantry prerequisite='${item.prerequisite}' should be correct barracks type`, () => {
      if (item.faction === 'allied' || item.faction === 'both') {
        // Allied or both-faction infantry: prerequisite should be TENT (or KENN for DOG)
        if (item.type === 'DOG') {
          expect(item.prerequisite).toBe('KENN');
        } else {
          expect(item.prerequisite).toBe('TENT');
        }
      } else if (item.faction === 'soviet') {
        // Soviet-only infantry: prerequisite should be BARR (or KENN for DOG)
        if (item.type === 'DOG') {
          expect(item.prerequisite).toBe('KENN');
        } else {
          expect(item.prerequisite).toBe('BARR');
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 20. DTRK (Demo Truck) special: aftrmath.ini overrides prerequisite to MSLO
// ---------------------------------------------------------------------------

describe('20. DTRK special case: Aftermath changes prerequisite to MSLO', () => {
  it('DTRK merged INI Prerequisite should be mslo (from aftrmath.ini)', () => {
    const iniSection = ini['DTRK'];
    expect(iniSection).toBeDefined();
    expect(iniSection?.Prerequisite?.toLowerCase()).toBe('mslo');
  });

  it('DTRK PRODUCTION_ITEMS should reflect the MSLO prerequisite', () => {
    const dtrk = PRODUCTION_ITEMS.find(i => i.type === 'DTRK');
    if (!dtrk) {
      // DTRK may not be in PRODUCTION_ITEMS (identified as a gap)
      expect(dtrk, 'DTRK should be in PRODUCTION_ITEMS').toBeDefined();
      return;
    }
    const tsPrereqs = [dtrk.prerequisite.toUpperCase()];
    if (dtrk.techPrereq) tsPrereqs.push(dtrk.techPrereq.toUpperCase());
    expect(tsPrereqs).toContain('MSLO');
  });

  it('DTRK merged INI Cost should be 2400 (from aftrmath.ini)', () => {
    const iniSection = ini['DTRK'];
    expect(iniSection?.Cost).toBe('2400');
  });

  it('DTRK merged INI TechLevel should be 13 (from aftrmath.ini)', () => {
    const iniSection = ini['DTRK'];
    expect(iniSection?.TechLevel).toBe('13');
  });
});

// ---------------------------------------------------------------------------
// 21. MCV special case: Cost=2500 in rules.ini, not in PRODUCTION_ITEMS
// ---------------------------------------------------------------------------

describe('21. MCV data parity', () => {
  it('MCV INI Cost=2500', () => {
    const iniSection = ini['MCV'];
    expect(iniSection).toBeDefined();
    expect(iniSection?.Cost).toBe('2500');
  });

  it('MCV INI TechLevel=11', () => {
    const iniSection = ini['MCV'];
    expect(iniSection?.TechLevel).toBe('11');
  });

  it('MCV INI Owner=allies,soviet', () => {
    const iniSection = ini['MCV'];
    expect(iniOwnerToFaction(iniSection?.Owner ?? '')).toBe('both');
  });
});
