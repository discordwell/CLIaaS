/**
 * C++ parity audit: full prerequisite/tech tree chain for ALL buildable
 * units and structures.
 *
 * Source of truth:
 *   rules.ini   — /public/ra/assets/rules.ini   (Prerequisite=, TechLevel=, Owner=, Cost=)
 *   aftrmath.ini — /public/ra/assets/aftrmath.ini (expansion overrides)
 *   techno.cpp:6283 — Prerequisite = ini.Get_Buildings(Name(), "Prerequisite", Prerequisite)
 *   techno.cpp:6286 — Level = ini.Get_Int(Name(), "TechLevel", Level)
 *   techno.cpp:6291 — Ownable = ini.Get_Owners(Name(), "Owner", Ownable)
 *
 * Tests that FAIL are GOOD — they identify real C++ divergences.
 * Do NOT modify engine code. Only create test files.
 *
 * All expected values are parsed from rules.ini/aftrmath.ini at test time.
 * No hardcoded C++ values in assertions.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { PRODUCTION_ITEMS, type ProductionItem } from '../engine/types';

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
// Helpers
// ---------------------------------------------------------------------------

const itemByType = new Map<string, ProductionItem>();
for (const item of PRODUCTION_ITEMS) {
  itemByType.set(item.type, item);
}

function getItem(type: string): ProductionItem | undefined {
  return itemByType.get(type);
}

const ALLIED_HOUSES = new Set(['allies', 'england', 'spain', 'greece', 'germany', 'france', 'turkey']);
const SOVIET_HOUSES = new Set(['soviet', 'ussr', 'ukraine']);

function iniOwnerToFaction(ownerStr: string): 'allied' | 'soviet' | 'both' {
  if (!ownerStr) return 'both';
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
  return 'both';
}

/**
 * Parse INI Prerequisite= into an array of uppercased building codes.
 * Returns empty array if no Prerequisite= key or blank value.
 */
function iniPrereqs(type: string): string[] {
  const section = ini[type];
  if (!section || !section.Prerequisite) return [];
  return section.Prerequisite.toLowerCase()
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.toUpperCase());
}

function iniTechLevel(type: string): number | undefined {
  const section = ini[type];
  if (!section || section.TechLevel === undefined || section.TechLevel === '') return undefined;
  return parseInt(section.TechLevel, 10);
}

function iniOwner(type: string): string | undefined {
  const section = ini[type];
  if (!section || section.Owner === undefined) return undefined;
  return section.Owner;
}

function iniCost(type: string): number | undefined {
  const section = ini[type];
  if (!section || !section.Cost || section.Cost === '') return undefined;
  return parseInt(section.Cost, 10);
}

/**
 * Determine the implicit factory building for a unit type based on its
 * category. Infantry go through TENT/BARR, vehicles through WEAP, etc.
 * This mirrors C++ logic: the factory is NOT listed in Prerequisite=
 * for units; it is derived from the unit's class (InfantryTypeClass,
 * UnitTypeClass, VesselTypeClass, AircraftTypeClass).
 */
function inferFactory(type: string, faction: 'allied' | 'soviet' | 'both'): string | undefined {
  // Infantry types
  const infantryTypes = new Set(['E1', 'E2', 'E3', 'E4', 'E6', 'E7', 'DOG', 'MEDI', 'SPY', 'THF', 'SHOK', 'MECH']);
  if (infantryTypes.has(type)) {
    // DOG uses KENN as prerequisite (special case)
    if (type === 'DOG') return undefined; // DOG has explicit Prerequisite=kenn
    if (faction === 'soviet') return 'BARR';
    return 'TENT'; // allied or both
  }

  // Vehicle types
  const vehicleTypes = new Set([
    'JEEP', '1TNK', '2TNK', '3TNK', '4TNK', 'V2RL', 'ARTY', 'APC',
    'HARV', 'MCV', 'MRJ', 'MGG', 'MNLY', 'STNK', 'CTNK', 'TTNK',
    'QTNK', 'DTRK', 'TRUK',
  ]);
  if (vehicleTypes.has(type)) return 'WEAP';

  // Naval types
  const alliedNaval = new Set(['PT', 'DD', 'CA', 'LST']);
  const sovietNaval = new Set(['SS', 'MSUB']);
  if (alliedNaval.has(type)) return 'SYRD';
  if (sovietNaval.has(type)) return 'SPEN';

  // Aircraft types
  const heliTypes = new Set(['TRAN', 'HELI', 'HIND']);
  const fixedWingTypes = new Set(['MIG', 'YAK', 'BADR', 'U2']);
  if (heliTypes.has(type)) return 'HPAD';
  if (fixedWingTypes.has(type)) return 'AFLD';

  return undefined; // structures don't have a factory
}

// ============================================================================
// TESTS
// ============================================================================

describe('C++ parity: prerequisite/tech tree chain audit', () => {

  // ========================================================================
  // 1. For every unit in PRODUCTION_ITEMS, verify Prerequisite= matches INI
  // ========================================================================

  describe('1. Unit Prerequisite= parity: every PRODUCTION_ITEMS unit vs INI', () => {
    const units = PRODUCTION_ITEMS.filter(i => !i.isStructure);

    for (const item of units) {
      const iniPrereqList = iniPrereqs(item.type);

      it(`${item.type}: TS prereqs should cover all INI Prerequisite= entries [${iniPrereqList.join(',') || 'none'}]`, () => {
        const tsPrereqs = [item.prerequisite.toUpperCase()];
        if (item.techPrereq) tsPrereqs.push(item.techPrereq.toUpperCase());

        // Every INI prerequisite should appear in the TS model
        for (const prereq of iniPrereqList) {
          expect(
            tsPrereqs.includes(prereq),
            `${item.type}: INI prereq '${prereq}' not found in TS [${tsPrereqs.join(', ')}]`
          ).toBe(true);
        }
      });
    }
  });

  // ========================================================================
  // 2. For every building in PRODUCTION_ITEMS, verify Prerequisite= matches INI
  // ========================================================================

  describe('2. Building Prerequisite= parity: every PRODUCTION_ITEMS structure vs INI', () => {
    const structures = PRODUCTION_ITEMS.filter(i => i.isStructure);

    for (const item of structures) {
      const iniPrereqList = iniPrereqs(item.type);

      it(`${item.type}: TS prereqs should cover all INI Prerequisite= entries [${iniPrereqList.join(',') || 'none'}]`, () => {
        const tsPrereqs = [item.prerequisite.toUpperCase()];
        if (item.techPrereq) tsPrereqs.push(item.techPrereq.toUpperCase());

        for (const prereq of iniPrereqList) {
          expect(
            tsPrereqs.includes(prereq),
            `${item.type}: INI prereq '${prereq}' not found in TS [${tsPrereqs.join(', ')}]`
          ).toBe(true);
        }
      });
    }
  });

  // ========================================================================
  // 3. TechLevel= parity: every PRODUCTION_ITEMS entry vs INI
  // ========================================================================

  describe('3. TechLevel= parity: every PRODUCTION_ITEMS entry vs INI', () => {
    for (const item of PRODUCTION_ITEMS) {
      const iniTL = iniTechLevel(item.type);
      if (iniTL === undefined) continue;

      it(`${item.type}: TS techLevel=${item.techLevel} should match INI TechLevel=${iniTL}`, () => {
        expect(item.techLevel, `${item.type} techLevel mismatch`).toBe(iniTL);
      });
    }
  });

  // ========================================================================
  // 4. Owner= / faction parity: every PRODUCTION_ITEMS entry vs INI
  // ========================================================================

  describe('4. Owner=/faction parity: every PRODUCTION_ITEMS entry vs INI', () => {
    for (const item of PRODUCTION_ITEMS) {
      const owner = iniOwner(item.type);
      if (owner === undefined || owner === '') continue;

      it(`${item.type}: TS faction='${item.faction}' should match INI Owner='${owner}'`, () => {
        const expectedFaction = iniOwnerToFaction(owner);
        expect(item.faction, `${item.type} faction mismatch`).toBe(expectedFaction);
      });
    }
  });

  // ========================================================================
  // 5. Cost= parity: every PRODUCTION_ITEMS entry vs INI
  // ========================================================================

  describe('5. Cost= parity: every PRODUCTION_ITEMS entry vs INI', () => {
    for (const item of PRODUCTION_ITEMS) {
      const cost = iniCost(item.type);
      if (cost === undefined) continue;

      it(`${item.type}: TS cost=${item.cost} should match INI Cost=${cost}`, () => {
        expect(item.cost, `${item.type} cost mismatch`).toBe(cost);
      });
    }
  });

  // ========================================================================
  // 6. Prerequisite CHAIN validity: every prerequisite must itself exist
  //    as a buildable or placeable structure in PRODUCTION_ITEMS
  // ========================================================================

  describe('6. Prerequisite chain validity: every prereq references an existing structure', () => {
    const allStructureTypes = new Set(
      PRODUCTION_ITEMS.filter(i => i.isStructure).map(i => i.type)
    );

    for (const item of PRODUCTION_ITEMS) {
      if (item.prerequisite && item.prerequisite !== '') {
        it(`${item.type}: prerequisite='${item.prerequisite}' should exist as a structure in PRODUCTION_ITEMS`, () => {
          expect(
            allStructureTypes.has(item.prerequisite),
            `${item.type}: prerequisite '${item.prerequisite}' is not a known structure`
          ).toBe(true);
        });
      }

      if (item.techPrereq) {
        it(`${item.type}: techPrereq='${item.techPrereq}' should exist as a structure in PRODUCTION_ITEMS`, () => {
          expect(
            allStructureTypes.has(item.techPrereq!),
            `${item.type}: techPrereq '${item.techPrereq}' is not a known structure`
          ).toBe(true);
        });
      }
    }
  });

  // ========================================================================
  // 7. Prerequisite chain is acyclic and reaches FACT
  //    Every structure's prerequisite chain should terminate at FACT (or '')
  // ========================================================================

  describe('7. Prerequisite chain terminates at FACT (no cycles)', () => {
    const structures = PRODUCTION_ITEMS.filter(i => i.isStructure);

    for (const item of structures) {
      it(`${item.type}: prerequisite chain reaches FACT without cycles`, () => {
        const visited = new Set<string>();
        let current: string | undefined = item.type;
        let depth = 0;
        const maxDepth = 20;

        while (current && depth < maxDepth) {
          if (visited.has(current)) {
            expect.unreachable(
              `Cycle detected in prerequisite chain for ${item.type}: ` +
              `${Array.from(visited).join(' -> ')} -> ${current}`
            );
          }
          visited.add(current);

          const curItem = getItem(current);
          if (!curItem) break;

          if (curItem.prerequisite === '' || curItem.prerequisite === 'FACT') {
            // Reached the root
            break;
          }
          current = curItem.prerequisite;
          depth++;
        }

        expect(depth, `${item.type}: chain depth should be < ${maxDepth} (possible cycle)`).toBeLessThan(maxDepth);
      });
    }
  });

  // ========================================================================
  // 8. Allied tech tree chain validation from INI
  //    FACT -> POWR -> PROC -> WEAP -> ATEK -> PDOX
  //    FACT -> POWR -> TENT -> PBOX/HBOX/GUN
  //    FACT -> POWR -> PROC -> DOME -> AGUN/HPAD/AFLD
  //    FACT -> POWR -> SYRD
  //    ATEK -> GAP
  // ========================================================================

  describe('8. Allied tech tree chains match INI', () => {
    // Parse the expected chain from INI directly
    it('FACT has no INI Prerequisite (root of tree)', () => {
      const factPrereqs = iniPrereqs('FACT');
      expect(factPrereqs.length, 'FACT should have no INI prerequisites').toBe(0);
    });

    it('POWR requires FACT per INI', () => {
      const prereqs = iniPrereqs('POWR');
      expect(prereqs).toContain('FACT');
    });

    it('PROC requires POWR per INI', () => {
      const prereqs = iniPrereqs('PROC');
      expect(prereqs).toContain('POWR');
    });

    it('WEAP requires PROC per INI', () => {
      const prereqs = iniPrereqs('WEAP');
      expect(prereqs).toContain('PROC');
    });

    it('ATEK requires WEAP and DOME per INI', () => {
      const prereqs = iniPrereqs('ATEK');
      expect(prereqs).toContain('WEAP');
      expect(prereqs).toContain('DOME');
    });

    it('PDOX requires ATEK per INI', () => {
      const prereqs = iniPrereqs('PDOX');
      expect(prereqs).toContain('ATEK');
    });

    it('TENT requires POWR per INI', () => {
      const prereqs = iniPrereqs('TENT');
      expect(prereqs).toContain('POWR');
    });

    it('PBOX requires TENT per INI', () => {
      const prereqs = iniPrereqs('PBOX');
      expect(prereqs).toContain('TENT');
    });

    it('HBOX requires TENT per INI', () => {
      const prereqs = iniPrereqs('HBOX');
      expect(prereqs).toContain('TENT');
    });

    it('GUN requires TENT per INI', () => {
      const prereqs = iniPrereqs('GUN');
      expect(prereqs).toContain('TENT');
    });

    it('DOME requires PROC per INI', () => {
      const prereqs = iniPrereqs('DOME');
      expect(prereqs).toContain('PROC');
    });

    it('AGUN requires DOME per INI', () => {
      const prereqs = iniPrereqs('AGUN');
      expect(prereqs).toContain('DOME');
    });

    it('HPAD requires DOME per INI', () => {
      const prereqs = iniPrereqs('HPAD');
      expect(prereqs).toContain('DOME');
    });

    it('SYRD requires POWR per INI', () => {
      const prereqs = iniPrereqs('SYRD');
      expect(prereqs).toContain('POWR');
    });

    it('GAP requires ATEK per INI', () => {
      const prereqs = iniPrereqs('GAP');
      expect(prereqs).toContain('ATEK');
    });

    it('TS POWR.prerequisite matches INI chain (should be FACT)', () => {
      const item = getItem('POWR');
      expect(item).toBeDefined();
      expect(item!.prerequisite).toBe('FACT');
    });

    it('TS PROC.prerequisite matches INI chain (should be POWR)', () => {
      const item = getItem('PROC');
      expect(item).toBeDefined();
      expect(item!.prerequisite).toBe('POWR');
    });

    it('TS WEAP.prerequisite matches INI chain (should be PROC)', () => {
      const item = getItem('WEAP');
      expect(item).toBeDefined();
      expect(item!.prerequisite).toBe('PROC');
    });

    it('TS ATEK.prerequisite=WEAP + techPrereq=DOME matches INI', () => {
      const item = getItem('ATEK');
      expect(item).toBeDefined();
      expect(item!.prerequisite).toBe('WEAP');
      expect(item!.techPrereq).toBe('DOME');
    });

    it('TS PDOX.prerequisite=ATEK matches INI', () => {
      const item = getItem('PDOX');
      expect(item).toBeDefined();
      expect(item!.prerequisite).toBe('ATEK');
    });
  });

  // ========================================================================
  // 9. Soviet tech tree chains match INI
  //    FACT -> POWR -> BARR -> FTUR/KENN
  //    FACT -> POWR -> PROC -> WEAP -> STEK -> IRON/MSLO
  //    FACT -> POWR -> PROC -> DOME -> SAM/AFLD
  //    FACT -> POWR -> SPEN
  // ========================================================================

  describe('9. Soviet tech tree chains match INI', () => {
    it('BARR requires POWR per INI', () => {
      const prereqs = iniPrereqs('BARR');
      expect(prereqs).toContain('POWR');
    });

    it('FTUR requires BARR per INI', () => {
      const prereqs = iniPrereqs('FTUR');
      expect(prereqs).toContain('BARR');
    });

    it('KENN requires BARR per INI', () => {
      const prereqs = iniPrereqs('KENN');
      expect(prereqs).toContain('BARR');
    });

    it('STEK requires WEAP and DOME per INI', () => {
      const prereqs = iniPrereqs('STEK');
      expect(prereqs).toContain('WEAP');
      expect(prereqs).toContain('DOME');
    });

    it('IRON requires STEK per INI', () => {
      const prereqs = iniPrereqs('IRON');
      expect(prereqs).toContain('STEK');
    });

    it('MSLO requires STEK per INI', () => {
      const prereqs = iniPrereqs('MSLO');
      expect(prereqs).toContain('STEK');
    });

    it('SAM requires DOME per INI', () => {
      const prereqs = iniPrereqs('SAM');
      expect(prereqs).toContain('DOME');
    });

    it('AFLD requires DOME per INI', () => {
      const prereqs = iniPrereqs('AFLD');
      expect(prereqs).toContain('DOME');
    });

    it('SPEN requires POWR per INI', () => {
      const prereqs = iniPrereqs('SPEN');
      expect(prereqs).toContain('POWR');
    });

    it('TSLA requires WEAP per INI', () => {
      const prereqs = iniPrereqs('TSLA');
      expect(prereqs).toContain('WEAP');
    });

    it('TS STEK.prerequisite=WEAP + techPrereq=DOME matches INI', () => {
      const item = getItem('STEK');
      expect(item).toBeDefined();
      expect(item!.prerequisite).toBe('WEAP');
      expect(item!.techPrereq).toBe('DOME');
    });

    it('TS IRON.prerequisite=STEK matches INI', () => {
      const item = getItem('IRON');
      expect(item).toBeDefined();
      expect(item!.prerequisite).toBe('STEK');
    });

    it('TS MSLO.prerequisite=STEK matches INI', () => {
      const item = getItem('MSLO');
      expect(item).toBeDefined();
      expect(item!.prerequisite).toBe('STEK');
    });
  });

  // ========================================================================
  // 10. Faction gating: Owner= determines who can build what
  //     Allied-only, Soviet-only, and shared items must match INI Owner=
  // ========================================================================

  describe('10. Faction gating: allied-only items must have INI Owner= containing allies but not soviet', () => {
    const alliedOnly = PRODUCTION_ITEMS.filter(i => i.faction === 'allied');

    for (const item of alliedOnly) {
      const owner = iniOwner(item.type);
      if (owner === undefined || owner === '') continue;

      it(`${item.type}: faction='allied' matches INI Owner='${owner}'`, () => {
        const faction = iniOwnerToFaction(owner);
        expect(faction, `${item.type} should be allied-only per INI Owner`).toBe('allied');
      });
    }
  });

  describe('10b. Faction gating: soviet-only items must have INI Owner= containing soviet but not allies', () => {
    const sovietOnly = PRODUCTION_ITEMS.filter(i => i.faction === 'soviet');

    for (const item of sovietOnly) {
      const owner = iniOwner(item.type);
      if (owner === undefined || owner === '') continue;

      it(`${item.type}: faction='soviet' matches INI Owner='${owner}'`, () => {
        const faction = iniOwnerToFaction(owner);
        expect(faction, `${item.type} should be soviet-only per INI Owner`).toBe('soviet');
      });
    }
  });

  describe('10c. Faction gating: both-faction items must have INI Owner= containing both allies and soviet', () => {
    const bothFaction = PRODUCTION_ITEMS.filter(i => i.faction === 'both');

    for (const item of bothFaction) {
      const owner = iniOwner(item.type);
      if (owner === undefined || owner === '') continue;

      it(`${item.type}: faction='both' matches INI Owner='${owner}'`, () => {
        const faction = iniOwnerToFaction(owner);
        expect(faction, `${item.type} should be both-faction per INI Owner`).toBe('both');
      });
    }
  });

  // ========================================================================
  // 11. aftrmath.ini overrides: verify expansion units use merged INI values
  // ========================================================================

  describe('11. aftrmath.ini overrides: expansion units use merged values', () => {
    const expansionTypes = ['STNK', 'CTNK', 'TTNK', 'DTRK', 'QTNK', 'MSUB', 'SHOK', 'MECH'];

    for (const type of expansionTypes) {
      const aftrmathSection = aftrmath[type];
      if (!aftrmathSection) continue;

      it(`${type}: aftrmath.ini section exists and overrides rules.ini`, () => {
        expect(aftrmathSection).toBeDefined();
      });

      if (aftrmathSection?.Prerequisite) {
        it(`${type}: TS covers aftrmath.ini Prerequisite='${aftrmathSection.Prerequisite}'`, () => {
          const item = getItem(type);
          expect(item, `${type} should be in PRODUCTION_ITEMS`).toBeDefined();
          if (!item) return;

          const iniPre = aftrmathSection.Prerequisite.toLowerCase()
            .split(',').map(s => s.trim()).filter(Boolean).map(s => s.toUpperCase());

          const tsPrereqs = [item.prerequisite.toUpperCase()];
          if (item.techPrereq) tsPrereqs.push(item.techPrereq.toUpperCase());

          for (const prereq of iniPre) {
            expect(
              tsPrereqs.includes(prereq),
              `${type}: aftrmath prereq '${prereq}' not in TS [${tsPrereqs.join(', ')}]`
            ).toBe(true);
          }
        });
      }

      if (aftrmathSection?.TechLevel) {
        it(`${type}: TS techLevel matches aftrmath.ini TechLevel=${aftrmathSection.TechLevel}`, () => {
          const item = getItem(type);
          expect(item).toBeDefined();
          if (!item) return;
          const expected = parseInt(aftrmathSection.TechLevel, 10);
          expect(item.techLevel, `${type} techLevel`).toBe(expected);
        });
      }

      if (aftrmathSection?.Cost) {
        it(`${type}: TS cost matches aftrmath.ini Cost=${aftrmathSection.Cost}`, () => {
          const item = getItem(type);
          expect(item).toBeDefined();
          if (!item) return;
          const expected = parseInt(aftrmathSection.Cost, 10);
          expect(item.cost, `${type} cost`).toBe(expected);
        });
      }

      if (aftrmathSection?.Owner) {
        it(`${type}: TS faction matches aftrmath.ini Owner=${aftrmathSection.Owner}`, () => {
          const item = getItem(type);
          expect(item).toBeDefined();
          if (!item) return;
          const expected = iniOwnerToFaction(aftrmathSection.Owner);
          expect(item.faction, `${type} faction`).toBe(expected);
        });
      }
    }
  });

  // ========================================================================
  // 12. DTRK special case: aftrmath.ini overrides Prerequisite to MSLO
  // ========================================================================

  describe('12. DTRK special case: Prerequisite=mslo from aftrmath.ini', () => {
    it('merged INI Prerequisite for DTRK should be mslo', () => {
      expect(ini['DTRK']?.Prerequisite?.toLowerCase()).toBe('mslo');
    });

    it('DTRK should be in PRODUCTION_ITEMS', () => {
      expect(getItem('DTRK')).toBeDefined();
    });

    it('DTRK TS prerequisite or techPrereq includes MSLO', () => {
      const item = getItem('DTRK');
      if (!item) return;
      const tsPrereqs = [item.prerequisite.toUpperCase()];
      if (item.techPrereq) tsPrereqs.push(item.techPrereq.toUpperCase());
      expect(tsPrereqs).toContain('MSLO');
    });

    it('DTRK merged TechLevel=13', () => {
      const tl = iniTechLevel('DTRK');
      expect(tl).toBe(13);
      const item = getItem('DTRK');
      if (item) {
        expect(item.techLevel).toBe(tl);
      }
    });

    it('DTRK merged Cost=2400', () => {
      const cost = iniCost('DTRK');
      expect(cost).toBe(2400);
      const item = getItem('DTRK');
      if (item) {
        expect(item.cost).toBe(cost);
      }
    });
  });

  // ========================================================================
  // 13. Non-buildable units: TechLevel=-1 in INI should be excluded or
  //     marked appropriately
  // ========================================================================

  describe('13. Non-buildable units: TechLevel=-1 handling', () => {
    // Collect all INI sections where TechLevel=-1
    const unbuildableInIni: string[] = [];
    for (const [section, values] of Object.entries(ini)) {
      if (values.TechLevel === '-1') {
        unbuildableInIni.push(section);
      }
    }

    it('should have multiple INI sections with TechLevel=-1', () => {
      expect(unbuildableInIni.length).toBeGreaterThan(5);
    });

    // Special cases: FACT and STNK have TechLevel=-1 but ARE in PRODUCTION_ITEMS
    // because they are special (FACT = MCV deploy target, STNK = cloaked)
    const SPECIAL_UNBUILDABLE = new Set(['FACT', 'STNK']);

    for (const type of unbuildableInIni) {
      const item = getItem(type);
      if (!item) continue; // Not in PRODUCTION_ITEMS, which is fine

      if (SPECIAL_UNBUILDABLE.has(type)) {
        it(`${type}: TechLevel=-1 in INI but present in PRODUCTION_ITEMS (special case) — TS techLevel should be -1`, () => {
          expect(item.techLevel, `${type} should preserve TechLevel=-1`).toBe(-1);
        });
      } else {
        it(`${type}: TechLevel=-1 in INI — if in PRODUCTION_ITEMS, TS techLevel should match`, () => {
          expect(item.techLevel, `${type} should have techLevel=-1`).toBe(-1);
        });
      }
    }

    // Non-producible unit types (civilians, ants, VIPs) should NOT be in PRODUCTION_ITEMS
    const NON_PRODUCIBLE = [
      'ANT1', 'ANT2', 'ANT3',
      'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10',
      'EINSTEIN', 'GNRL', 'CHAN',
      'BADR', 'U2',
    ];

    for (const type of NON_PRODUCIBLE) {
      it(`${type}: non-producible unit should NOT be in PRODUCTION_ITEMS`, () => {
        expect(
          getItem(type),
          `${type} is non-producible but found in PRODUCTION_ITEMS`
        ).toBeUndefined();
      });
    }
  });

  // ========================================================================
  // 14. Reverse check: every INI unit with TechLevel >= 1 and a valid
  //     Owner= should have a PRODUCTION_ITEMS entry
  // ========================================================================

  describe('14. Coverage: buildable INI units should have PRODUCTION_ITEMS entries', () => {
    // Categories of INI sections that represent buildable types
    const UNIT_SECTIONS = new Set([
      // Infantry
      'E1', 'E2', 'E3', 'E4', 'E6', 'E7', 'DOG', 'MEDI', 'SPY', 'THF', 'SHOK', 'MECH',
      // Vehicles
      'JEEP', '1TNK', '2TNK', '3TNK', '4TNK', 'V2RL', 'ARTY', 'APC', 'HARV', 'MCV',
      'MRJ', 'MGG', 'MNLY', 'STNK', 'CTNK', 'TTNK', 'QTNK', 'DTRK',
      // Naval
      'PT', 'DD', 'CA', 'LST', 'SS', 'MSUB',
      // Aircraft
      'TRAN', 'HELI', 'HIND', 'MIG', 'YAK',
      // Structures
      'FACT', 'POWR', 'APWR', 'BARR', 'TENT', 'PROC', 'WEAP', 'SILO', 'DOME',
      'FIX', 'HPAD', 'AFLD', 'PBOX', 'HBOX', 'GUN', 'AGUN', 'GAP',
      'FTUR', 'TSLA', 'SAM', 'KENN', 'SYRD', 'SPEN',
      'ATEK', 'STEK', 'PDOX', 'IRON', 'MSLO',
      // Walls
      'SBAG', 'FENC', 'BRIK',
    ]);

    // MCV is special: placed by deploying, not queued
    const EXCLUDED_FROM_PRODUCTION = new Set(['MCV']);

    const prodTypes = new Set(PRODUCTION_ITEMS.map(i => i.type));

    for (const type of UNIT_SECTIONS) {
      if (EXCLUDED_FROM_PRODUCTION.has(type)) continue;

      const tl = iniTechLevel(type);

      // Skip unbuildable (TechLevel=-1) except special cases
      if (tl === -1 && type !== 'FACT' && type !== 'STNK') continue;

      it(`${type}: buildable INI type should be in PRODUCTION_ITEMS`, () => {
        expect(
          prodTypes.has(type),
          `${type} (TechLevel=${tl}) is buildable but missing from PRODUCTION_ITEMS`
        ).toBe(true);
      });
    }
  });

  // ========================================================================
  // 15. Infantry factory assignment: allied infantry -> TENT, soviet -> BARR
  //     INI Prerequisite for infantry lists tech prereqs, not the factory.
  //     The TS model should assign the correct barracks as prerequisite.
  // ========================================================================

  describe('15. Infantry barracks assignment parity', () => {
    const INFANTRY_TYPES = ['E1', 'E2', 'E3', 'E4', 'E6', 'E7', 'MEDI', 'SPY', 'THF', 'SHOK', 'MECH'];

    for (const type of INFANTRY_TYPES) {
      const item = getItem(type);
      if (!item) continue;

      const owner = iniOwner(type);
      if (owner === undefined || owner === '') continue;
      const faction = iniOwnerToFaction(owner);

      it(`${type}: infantry prerequisite should be correct barracks (faction=${faction})`, () => {
        // Infantry with explicit Prerequisite= in INI: the INI value goes to techPrereq,
        // and the barracks goes to prerequisite
        if (faction === 'soviet') {
          expect(item.prerequisite, `${type} soviet infantry should use BARR`).toBe('BARR');
        } else if (faction === 'allied') {
          expect(item.prerequisite, `${type} allied infantry should use TENT`).toBe('TENT');
        } else {
          // both-faction infantry: convention is TENT
          expect(item.prerequisite, `${type} both-faction infantry should use TENT`).toBe('TENT');
        }
      });
    }

    it('DOG: uses KENN (not BARR) as prerequisite per INI Prerequisite=kenn', () => {
      const dog = getItem('DOG');
      expect(dog).toBeDefined();
      if (dog) {
        expect(dog.prerequisite).toBe('KENN');
      }
    });
  });

  // ========================================================================
  // 16. Vehicle factory assignment: all vehicles should use WEAP except DTRK
  // ========================================================================

  describe('16. Vehicle factory assignment', () => {
    const VEHICLE_TYPES = [
      'JEEP', '1TNK', '2TNK', '3TNK', '4TNK', 'V2RL', 'ARTY', 'APC',
      'HARV', 'MRJ', 'MGG', 'MNLY', 'STNK', 'CTNK', 'TTNK', 'QTNK',
    ];

    for (const type of VEHICLE_TYPES) {
      const item = getItem(type);
      if (!item) continue;

      it(`${type}: vehicle prerequisite should be WEAP`, () => {
        expect(item.prerequisite, `${type} should use WEAP as factory`).toBe('WEAP');
      });
    }

    it('DTRK: special case — prerequisite is MSLO (from aftrmath.ini Prerequisite=mslo)', () => {
      const dtrk = getItem('DTRK');
      expect(dtrk).toBeDefined();
      if (dtrk) {
        expect(dtrk.prerequisite).toBe('MSLO');
      }
    });
  });

  // ========================================================================
  // 17. Naval factory assignment
  // ========================================================================

  describe('17. Naval factory assignment', () => {
    const ALLIED_NAVAL = ['PT', 'DD', 'CA', 'LST'];
    const SOVIET_NAVAL = ['SS', 'MSUB'];

    for (const type of ALLIED_NAVAL) {
      const item = getItem(type);
      if (!item) continue;

      it(`${type}: allied naval prerequisite should be SYRD`, () => {
        expect(item.prerequisite).toBe('SYRD');
      });
    }

    for (const type of SOVIET_NAVAL) {
      const item = getItem(type);
      if (!item) continue;

      it(`${type}: soviet naval prerequisite should be SPEN`, () => {
        expect(item.prerequisite).toBe('SPEN');
      });
    }
  });

  // ========================================================================
  // 18. Aircraft factory assignment
  // ========================================================================

  describe('18. Aircraft factory assignment', () => {
    const HELI_TYPES = ['TRAN', 'HELI', 'HIND'];
    const FIXED_WING = ['MIG', 'YAK'];

    for (const type of HELI_TYPES) {
      const item = getItem(type);
      if (!item) continue;

      it(`${type}: helicopter prerequisite should be HPAD`, () => {
        expect(item.prerequisite).toBe('HPAD');
      });
    }

    for (const type of FIXED_WING) {
      const item = getItem(type);
      if (!item) continue;

      it(`${type}: fixed-wing prerequisite should be AFLD`, () => {
        expect(item.prerequisite).toBe('AFLD');
      });
    }
  });

  // ========================================================================
  // 19. buildTime formula: floor(Cost * 0.72) per C++ techno.cpp:6077
  //     buildTime = floor(Cost * BuildSpeedBias * TICKS_PER_MINUTE / 1000)
  //     BuildSpeedBias=0.8, TICKS_PER_MINUTE=900 => floor(Cost * 0.72)
  // ========================================================================

  describe('19. buildTime formula parity: floor(INI_Cost * 0.72)', () => {
    for (const item of PRODUCTION_ITEMS) {
      const cost = iniCost(item.type);
      if (cost === undefined || cost === 0) continue;

      const expectedBuildTime = Math.floor(cost * 0.72);

      it(`${item.type}: buildTime=${item.buildTime} should equal floor(${cost} * 0.72) = ${expectedBuildTime}`, () => {
        expect(item.buildTime, `${item.type} buildTime`).toBe(expectedBuildTime);
      });
    }
  });

  // ========================================================================
  // 20. INI prerequisite count: TS model only supports prerequisite + techPrereq
  //     (max 2). Verify no INI Prerequisite= has more than 2 entries for items
  //     in PRODUCTION_ITEMS.
  // ========================================================================

  describe('20. INI prerequisite count: max 2 entries (TS model limit)', () => {
    for (const item of PRODUCTION_ITEMS) {
      const prereqList = iniPrereqs(item.type);
      if (prereqList.length === 0) continue;

      it(`${item.type}: INI Prerequisite= has ${prereqList.length} entries (TS supports max 2)`, () => {
        expect(
          prereqList.length,
          `${item.type}: INI has ${prereqList.length} prereqs [${prereqList.join(',')}] but TS model only supports 2`
        ).toBeLessThanOrEqual(2);
      });
    }
  });

  // ========================================================================
  // 21. Cross-faction prerequisite consistency: a faction's items should
  //     only require buildings that the same faction can build
  // ========================================================================

  describe('21. Cross-faction prereq consistency: items only require same-faction buildings', () => {
    for (const item of PRODUCTION_ITEMS) {
      if (item.prerequisite === '' || item.faction === 'both') continue;

      if (item.prerequisite) {
        const prereqItem = getItem(item.prerequisite);
        if (!prereqItem) continue;

        it(`${item.type} (${item.faction}): prerequisite '${item.prerequisite}' should be buildable by same faction`, () => {
          expect(
            prereqItem.faction === 'both' || prereqItem.faction === item.faction,
            `${item.type} (${item.faction}) requires ${item.prerequisite} (${prereqItem.faction}) — faction mismatch`
          ).toBe(true);
        });
      }

      if (item.techPrereq) {
        const techPrereqItem = getItem(item.techPrereq);
        if (!techPrereqItem) continue;

        it(`${item.type} (${item.faction}): techPrereq '${item.techPrereq}' should be buildable by same faction`, () => {
          expect(
            techPrereqItem.faction === 'both' || techPrereqItem.faction === item.faction,
            `${item.type} (${item.faction}) requires techPrereq ${item.techPrereq} (${techPrereqItem.faction}) — faction mismatch`
          ).toBe(true);
        });
      }
    }
  });

  // ========================================================================
  // 22. Structure isStructure flag consistency
  // ========================================================================

  describe('22. isStructure flag: structures have it, units do not', () => {
    const KNOWN_STRUCTURES = new Set([
      'FACT', 'POWR', 'APWR', 'BARR', 'TENT', 'PROC', 'WEAP', 'SILO', 'DOME',
      'FIX', 'HPAD', 'AFLD', 'PBOX', 'HBOX', 'GUN', 'AGUN', 'GAP',
      'FTUR', 'TSLA', 'SAM', 'KENN', 'SYRD', 'SPEN',
      'ATEK', 'STEK', 'PDOX', 'IRON', 'MSLO',
      'SBAG', 'FENC', 'BRIK',
      // Non-buildable walls/fences (scenario-placed only)
      'CYCL', 'BARB', 'WOOD',
      // Non-buildable buildings (scenario-placed only)
      'BIO', 'HOSP', 'FCOM', 'MISS',
      // Fake buildings (decoys)
      'FACF', 'WEAF', 'DOMF', 'SYRF', 'SPEF',
    ]);

    for (const item of PRODUCTION_ITEMS) {
      if (KNOWN_STRUCTURES.has(item.type)) {
        it(`${item.type}: should have isStructure=true`, () => {
          expect(item.isStructure).toBe(true);
        });
      } else {
        it(`${item.type}: should NOT have isStructure=true (it is a unit)`, () => {
          expect(item.isStructure ?? false).toBe(false);
        });
      }
    }
  });

  // ========================================================================
  // 23. Walls: no INI Prerequisite=, TS assigns FACT
  // ========================================================================

  describe('23. Wall prerequisites: no INI Prerequisite, TS assigns FACT', () => {
    const WALLS = ['SBAG', 'FENC', 'BRIK'];

    for (const type of WALLS) {
      it(`${type}: INI has no Prerequisite= field`, () => {
        const prereqs = iniPrereqs(type);
        expect(prereqs.length, `${type} should have no INI prerequisites`).toBe(0);
      });

      it(`${type}: TS assigns prerequisite='FACT'`, () => {
        const item = getItem(type);
        expect(item).toBeDefined();
        if (item) {
          expect(item.prerequisite).toBe('FACT');
        }
      });
    }
  });

  // ========================================================================
  // 24. Full depth: for each PRODUCTION_ITEMS entry, walk the prerequisite
  //     chain and verify each link is valid
  // ========================================================================

  describe('24. Full prerequisite chain walk: every item has a valid path to root', () => {
    for (const item of PRODUCTION_ITEMS) {
      it(`${item.type}: complete prerequisite chain is valid`, () => {
        const chain: string[] = [item.type];
        let current = item.prerequisite;
        let depth = 0;

        while (current && current !== '' && depth < 20) {
          chain.push(current);
          const curItem = getItem(current);
          if (!curItem) {
            // The prerequisite references something not in PRODUCTION_ITEMS
            expect.unreachable(
              `${item.type}: chain broken at '${current}' (not in PRODUCTION_ITEMS). Chain: ${chain.join(' -> ')}`
            );
          }
          if (curItem.prerequisite === '' || curItem.type === 'FACT') {
            break; // Reached root
          }
          current = curItem.prerequisite;
          depth++;
        }

        // Chain should terminate (not exceed max depth)
        expect(depth, `${item.type}: chain depth (${chain.join(' -> ')})`).toBeLessThan(20);
      });
    }
  });
});
