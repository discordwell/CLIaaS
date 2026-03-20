/**
 * Rules.ini ↔ PRODUCTION_ITEMS faction parity test.
 *
 * Validates that the rules.ini import pipeline correctly derives
 * faction ownership and prerequisites from rules.ini.  If this test
 * fails, either rules.ini or types.ts has drifted.
 *
 * This test exists because BARR/TENT Owner= values were once swapped,
 * cascading into wrong prerequisites for PBOX, HBOX, GUN, FTUR, KENN,
 * and APC.  The pipeline + this test prevent that class of bug.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseIniSections, normalizeOwnerToFaction } from '../engine/parseIni';
import { getCanonicalProductionItems } from '../engine/rulesIniPipeline';
import { PRODUCTION_ITEMS as BASE_ITEMS } from '../engine/types';

const rulesIniPath = resolve(process.cwd(), 'public/ra/assets/rules.ini');
const sections = parseIniSections(readFileSync(rulesIniPath, 'utf-8'));
const ITEMS = getCanonicalProductionItems();

describe('rules.ini import pipeline', () => {
  it('patches PRODUCTION_ITEMS from rules.ini (not identity)', () => {
    // The pipeline should have applied at least some patches
    expect(ITEMS.length).toBe(BASE_ITEMS.length);
    expect(ITEMS).not.toBe(BASE_ITEMS); // different array reference
  });

  describe('faction ownership matches rules.ini Owner=', () => {
    const structureItems = ITEMS.filter(i => i.isStructure);

    for (const item of structureItems) {
      const section = sections.get(item.type);
      if (!section?.has('Owner')) continue;

      it(`${item.type} faction matches Owner=${section.get('Owner')}`, () => {
        const expected = normalizeOwnerToFaction(section.get('Owner'));
        expect(item.faction).toBe(expected);
      });
    }
  });

  describe('critical faction assignments (regression guard)', () => {
    it('BARR is Soviet (rules.ini Owner=soviet)', () => {
      const barr = ITEMS.find(i => i.type === 'BARR' && i.isStructure);
      expect(barr?.faction).toBe('soviet');
    });

    it('TENT is Allied (rules.ini Owner=allies)', () => {
      const tent = ITEMS.find(i => i.type === 'TENT' && i.isStructure);
      expect(tent?.faction).toBe('allied');
    });

    it('PBOX prerequisite is TENT (Allied barracks)', () => {
      const pbox = ITEMS.find(i => i.type === 'PBOX');
      expect(pbox?.prerequisite).toBe('TENT');
    });

    it('HBOX prerequisite is TENT (Allied barracks)', () => {
      const hbox = ITEMS.find(i => i.type === 'HBOX');
      expect(hbox?.prerequisite).toBe('TENT');
    });

    it('GUN prerequisite is TENT (Allied barracks)', () => {
      const gun = ITEMS.find(i => i.type === 'GUN');
      expect(gun?.prerequisite).toBe('TENT');
    });

    it('FTUR prerequisite is BARR (Soviet barracks)', () => {
      const ftur = ITEMS.find(i => i.type === 'FTUR');
      expect(ftur?.prerequisite).toBe('BARR');
    });

    it('KENN prerequisite is BARR (Soviet barracks)', () => {
      const kenn = ITEMS.find(i => i.type === 'KENN');
      expect(kenn?.prerequisite).toBe('BARR');
    });

    it('APC techPrereq is TENT (Allied barracks)', () => {
      const apc = ITEMS.find(i => i.type === 'APC');
      expect(apc?.techPrereq).toBe('TENT');
    });
  });

  describe('every structure with Owner= in rules.ini is covered', () => {
    const structureTypes = new Set(ITEMS.filter(i => i.isStructure).map(i => i.type));

    for (const [sectionName, fields] of sections) {
      if (!fields.has('Owner')) continue;
      if (!structureTypes.has(sectionName)) continue;

      it(`${sectionName} has matching faction`, () => {
        const item = ITEMS.find(i => i.type === sectionName && i.isStructure);
        expect(item, `${sectionName} should exist in PRODUCTION_ITEMS`).toBeDefined();
        const expectedFaction = normalizeOwnerToFaction(fields.get('Owner'));
        expect(item!.faction).toBe(expectedFaction);
      });
    }
  });
});
