/**
 * C++ Behavioral Parity: KENN (Kennel)
 *
 * Tests verify Kennel structure stats and behavior match C++ RA source code.
 * KENN is a 1x1 Soviet structure used as a prerequisite for DOG training.
 * It has no defensive weapon — purely a production-enabling building.
 *
 * C++ references: rules.ini KENN section, bdata.cpp structure definitions
 */

import { describe, it, expect } from 'vitest';
import {
  STRUCTURE_SIZE,
  STRUCTURE_MAX_HP,
  STRUCTURE_WEAPONS,
} from '../engine/scenario';
import { PRODUCTION_ITEMS } from '../engine/types';

// ── Stats (rules.ini: KENN — HP 400, size 1x1, cost 200, soviet) ────────────

describe('KENN structure stats (rules.ini parity)', () => {

  it('max HP is 400', () => {
    expect(STRUCTURE_MAX_HP['KENN']).toBe(400);
  });

  it('footprint is 1x1', () => {
    expect(STRUCTURE_SIZE['KENN']).toEqual([1, 1]);
  });

  it('build cost is 200 credits', () => {
    const kenn = PRODUCTION_ITEMS.find(i => i.type === 'KENN');
    expect(kenn).toBeDefined();
    expect(kenn!.cost).toBe(200);
  });

  it('faction is soviet', () => {
    const kenn = PRODUCTION_ITEMS.find(i => i.type === 'KENN');
    expect(kenn).toBeDefined();
    expect(kenn!.faction).toBe('soviet');
  });

  it('is a structure (isStructure flag)', () => {
    const kenn = PRODUCTION_ITEMS.find(i => i.type === 'KENN');
    expect(kenn).toBeDefined();
    expect(kenn!.isStructure).toBe(true);
  });

  it('prerequisite is TENT (Soviet Barracks)', () => {
    const kenn = PRODUCTION_ITEMS.find(i => i.type === 'KENN');
    expect(kenn).toBeDefined();
    expect(kenn!.prerequisite).toBe('TENT');
  });
});

// ── No Weapon (KENN has no defensive capability) ─────────────────────────────

describe('KENN has no defensive weapon', () => {

  it('is NOT in STRUCTURE_WEAPONS', () => {
    expect(STRUCTURE_WEAPONS).not.toHaveProperty('KENN');
  });

  it('other defense structures ARE in STRUCTURE_WEAPONS (sanity check)', () => {
    // Confirm the map is populated — KENN's absence is meaningful
    expect(STRUCTURE_WEAPONS).toHaveProperty('GUN');
    expect(STRUCTURE_WEAPONS).toHaveProperty('TSLA');
    expect(STRUCTURE_WEAPONS).toHaveProperty('SAM');
  });
});

// ── Production Prerequisite: KENN enables DOG training ───────────────────────

describe('KENN is prerequisite for DOG training (rules.ini line 781)', () => {

  it('DOG prerequisite is KENN', () => {
    const dog = PRODUCTION_ITEMS.find(i => i.type === 'DOG');
    expect(dog).toBeDefined();
    expect(dog!.prerequisite).toBe('KENN');
  });

  it('DOG is soviet faction', () => {
    const dog = PRODUCTION_ITEMS.find(i => i.type === 'DOG');
    expect(dog).toBeDefined();
    expect(dog!.faction).toBe('soviet');
  });

  it('no other unit besides DOG requires KENN as prerequisite', () => {
    const kennDependents = PRODUCTION_ITEMS.filter(
      i => i.prerequisite === 'KENN'
    );
    expect(kennDependents).toHaveLength(1);
    expect(kennDependents[0].type).toBe('DOG');
  });
});

// ── Cheapest Structure (among non-wall, non-silo buildings) ──────────────────

describe('KENN is the cheapest buildable structure (cost 200)', () => {

  it('no non-wall structure costs less than KENN', () => {
    // Wall types (SBAG, FENC, BRIK, BARB, WOOD) are excluded — they are
    // barriers, not buildings. SILO (150) is a storage structure.
    // KENN at 200 is the cheapest actual building.
    const wallTypes = new Set(['SBAG', 'FENC', 'BRIK', 'BARB', 'WOOD']);
    const structures = PRODUCTION_ITEMS.filter(
      i => i.isStructure && !wallTypes.has(i.type) && i.type !== 'SILO'
    );
    const cheaperThanKenn = structures.filter(s => s.cost < 200);
    expect(cheaperThanKenn, 'no building should be cheaper than KENN at 200').toHaveLength(0);
  });

  it('KENN costs less than the next cheapest buildings (POWR/BARR/TENT at 300)', () => {
    const kenn = PRODUCTION_ITEMS.find(i => i.type === 'KENN');
    const powr = PRODUCTION_ITEMS.find(i => i.type === 'POWR');
    const tent = PRODUCTION_ITEMS.find(i => i.type === 'TENT');
    const barr = PRODUCTION_ITEMS.find(i => i.type === 'BARR');
    expect(kenn!.cost).toBeLessThan(powr!.cost);
    expect(kenn!.cost).toBeLessThan(tent!.cost);
    expect(kenn!.cost).toBeLessThan(barr!.cost);
  });
});
