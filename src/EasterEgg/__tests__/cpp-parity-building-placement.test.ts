/**
 * C++ Behavioral Parity: Building Placement — Footprints, Bibs, Adjacency
 *
 * Tests verify building placement data and logic matches C++ RA source code.
 * Each test documents the C++ source reference (file:line).
 *
 * Key C++ sources:
 *   bdata.cpp:150-2760  — BuildingTypeClass constructors (BSIZE_*, occupy/overlap lists)
 *   bdata.cpp:3530-3544 — Width() lookup table from BSizeType enum
 *   bdata.cpp:3561-3575 — Height() lookup table (+ bib row when IsBibbed)
 *   bdata.cpp:3597-3629 — Bib_And_Offset (SMUDGE_BIB1/2/3 for width 4/3/2)
 *   bdata.cpp:3775      — IsBibbed read from rules.ini "Bib" key (default false)
 *   defines.h:2888-2901 — BSizeType enum (BSIZE_11..BSIZE_55)
 *   display.cpp:706-778 — Passes_Proximity_Check (adjacency within 2 cells)
 *   rules.ini            — Bib=yes entries for specific buildings
 */

import { describe, it, expect } from 'vitest';
import {
  STRUCTURE_SIZE,
  BIBBED_BUILDINGS,
  getBibCells,
} from '../engine/scenario';

// ── C++ BSizeType → Width/Height mapping ─────────────────────────────────────
// From bdata.cpp:3530-3544 Width() and bdata.cpp:3561-3575 Height():
//   enum index:  0(11) 1(21) 2(12) 3(22) 4(23) 5(32) 6(33) 7(42) 8(55)
//   width[]:       1     2     1     2     2     3     3     4     5
//   height[]:      1     1     2     2     3     2     3     2     5

/**
 * Complete mapping of building string ID → C++ BSIZE → (width, height).
 * Derived from bdata.cpp constructor parameters for each BuildingTypeClass.
 * Format: [type, expectedWidth, expectedHeight, cppLine]
 */
const CPP_BUILDING_SIZES: [string, number, number, string][] = [
  // === Military Buildings ===
  // bdata.cpp:685 ClassConst "FACT" BSIZE_33 → 3x3
  ['FACT', 3, 3, 'bdata.cpp:685 BSIZE_33'],
  // bdata.cpp:415 ClassWeapon "WEAP" BSIZE_32 → 3x2
  ['WEAP', 3, 2, 'bdata.cpp:415 BSIZE_32'],
  // bdata.cpp:1015 ClassPower "POWR" BSIZE_22 → 2x2
  ['POWR', 2, 2, 'bdata.cpp:1015 BSIZE_22'],
  // bdata.cpp:1045 ClassAdvancedPower "APWR" BSIZE_33 → 3x3
  ['APWR', 3, 3, 'bdata.cpp:1045 BSIZE_33'],
  // bdata.cpp:1166 ClassBarracks "BARR" BSIZE_22 → 2x2
  ['BARR', 2, 2, 'bdata.cpp:1166 BSIZE_22'],
  // bdata.cpp:1196 ClassTent "TENT" BSIZE_22 → 2x2
  ['TENT', 2, 2, 'bdata.cpp:1196 BSIZE_22'],
  // bdata.cpp:775 ClassRefinery "PROC" BSIZE_33 → 3x3
  ['PROC', 3, 3, 'bdata.cpp:775 BSIZE_33'],
  // bdata.cpp:1347 ClassRepair "FIX" BSIZE_33 → 3x3
  ['FIX', 3, 3, 'bdata.cpp:1347 BSIZE_33'],
  // bdata.cpp:805 ClassStorage "SILO" BSIZE_11 → 1x1
  ['SILO', 1, 1, 'bdata.cpp:805 BSIZE_11'],
  // bdata.cpp:865 ClassCommand "DOME" BSIZE_22 → 2x2
  ['DOME', 2, 2, 'bdata.cpp:865 BSIZE_22'],
  // bdata.cpp:595 ClassTurret "GUN" BSIZE_11 → 1x1
  ['GUN', 1, 1, 'bdata.cpp:595 BSIZE_11'],
  // bdata.cpp:925 ClassSAM "SAM" BSIZE_21 → 2x1
  ['SAM', 2, 1, 'bdata.cpp:925 BSIZE_21'],
  // bdata.cpp:535 ClassCamoPillbox "HBOX" BSIZE_11 → 1x1
  ['HBOX', 1, 1, 'bdata.cpp:535 BSIZE_11'],
  // bdata.cpp:565 ClassTesla "TSLA" BSIZE_12 → 1x2
  ['TSLA', 1, 2, 'bdata.cpp:565 BSIZE_12'],
  // bdata.cpp:625 ClassAAGun "AGUN" BSIZE_12 → 1x2
  ['AGUN', 1, 2, 'bdata.cpp:625 BSIZE_12'],
  // bdata.cpp:895 ClassGapGenerator "GAP" BSIZE_12 → 1x2
  ['GAP', 1, 2, 'bdata.cpp:895 BSIZE_12'],
  // bdata.cpp:505 ClassPillbox "PBOX" BSIZE_11 → 1x1
  ['PBOX', 1, 1, 'bdata.cpp:505 BSIZE_11'],
  // bdata.cpp:835 ClassHelipad "HPAD" BSIZE_22 → 2x2
  ['HPAD', 2, 2, 'bdata.cpp:835 BSIZE_22'],
  // bdata.cpp:985 ClassAirStrip "AFLD" BSIZE_32 → 3x2
  ['AFLD', 3, 2, 'bdata.cpp:985 BSIZE_32'],
  // bdata.cpp:355 ClassAdvancedTech "ATEK" BSIZE_22 → 2x2
  ['ATEK', 2, 2, 'bdata.cpp:355 BSIZE_22'],
  // bdata.cpp:1075 ClassSovietTech "STEK" BSIZE_33 → 3x3
  ['STEK', 3, 3, 'bdata.cpp:1075 BSIZE_33'],
  // bdata.cpp:385 ClassChronosphere "PDOX" BSIZE_22 → 2x2
  ['PDOX', 2, 2, 'bdata.cpp:385 BSIZE_22'],
  // bdata.cpp:295 ClassIronCurtain "IRON" BSIZE_22 → 2x2
  ['IRON', 2, 2, 'bdata.cpp:295 BSIZE_22'],
  // bdata.cpp:955 ClassMissileSilo "MSLO" BSIZE_21 → 2x1
  ['MSLO', 2, 1, 'bdata.cpp:955 BSIZE_21'],
  // bdata.cpp:1226 ClassKennel "KENN" BSIZE_11 → 1x1
  ['KENN', 1, 1, 'bdata.cpp:1226 BSIZE_11'],
  // bdata.cpp:445 ClassShipYard "SYRD" BSIZE_33 → 3x3
  ['SYRD', 3, 3, 'bdata.cpp:445 BSIZE_33'],
  // bdata.cpp:475 ClassSubPen "SPEN" BSIZE_33 → 3x3
  ['SPEN', 3, 3, 'bdata.cpp:475 BSIZE_33'],
  // bdata.cpp:1135 ClassBioLab "BIO" BSIZE_22 → 2x2
  ['BIO', 2, 2, 'bdata.cpp:1135 BSIZE_22'],
  // bdata.cpp:1105 ClassHospital "HOSP" BSIZE_22 → 2x2
  ['HOSP', 2, 2, 'bdata.cpp:1105 BSIZE_22'],
  // bdata.cpp:655 ClassFlameTurret "FTUR" BSIZE_11 → 1x1
  ['FTUR', 1, 1, 'bdata.cpp:655 BSIZE_11'],
  // bdata.cpp:325 ClassForwardCom "FCOM" BSIZE_22 → 2x2
  ['FCOM', 2, 2, 'bdata.cpp:325 BSIZE_22'],
  // bdata.cpp:2485 ClassMission "MISS" BSIZE_32 → 3x2
  ['MISS', 3, 2, 'bdata.cpp:2485 BSIZE_32'],

  // === Fake buildings ===
  // bdata.cpp:715 ClassFakeConst "FACF" BSIZE_33 → 3x3
  ['FACF', 3, 3, 'bdata.cpp:715 BSIZE_33'],
  // bdata.cpp:1317 ClassFakeCommand "DOMF" BSIZE_22 → 2x2
  ['DOMF', 2, 2, 'bdata.cpp:1317 BSIZE_22'],
  // bdata.cpp:745 ClassFakeWeapon "WEAF" BSIZE_32 → 3x2
  ['WEAF', 3, 2, 'bdata.cpp:745 BSIZE_32'],

  // === Mines and barrels ===
  // bdata.cpp:235 ClassAVMine "MINV" BSIZE_11 → 1x1
  ['MINV', 1, 1, 'bdata.cpp:235 BSIZE_11'],
  // bdata.cpp:265 ClassAPMine "MINP" BSIZE_11 → 1x1
  ['MINP', 1, 1, 'bdata.cpp:265 BSIZE_11'],
  // bdata.cpp:175 ClassBarrel "BARL" BSIZE_11 → 1x1
  ['BARL', 1, 1, 'bdata.cpp:175 BSIZE_11'],
  // bdata.cpp:205 ClassBarrel3 "BRL3" BSIZE_11 → 1x1
  ['BRL3', 1, 1, 'bdata.cpp:205 BSIZE_11'],

  // === Walls ===
  // bdata.cpp:2516 Sandbag "SBAG" BSIZE_11 → 1x1
  ['SBAG', 1, 1, 'bdata.cpp:2516 BSIZE_11'],
  // bdata.cpp:2665 Fence "FENC" BSIZE_11 → 1x1
  ['FENC', 1, 1, 'bdata.cpp:2665 BSIZE_11'],
  // bdata.cpp:2606 Barbwire "BARB" BSIZE_11 → 1x1
  ['BARB', 1, 1, 'bdata.cpp:2606 BSIZE_11'],
  // bdata.cpp:2576 Brick "BRIK" BSIZE_11 → 1x1
  ['BRIK', 1, 1, 'bdata.cpp:2576 BSIZE_11'],
  // bdata.cpp:2636 Wood "WOOD" BSIZE_11 → 1x1
  ['WOOD', 1, 1, 'bdata.cpp:2636 BSIZE_11'],
  // bdata.cpp:2546 Cyclone "CYCL" BSIZE_11 → 1x1
  ['CYCL', 1, 1, 'bdata.cpp:2546 BSIZE_11'],

  // === Ant buildings (FIXIT_ANTS) ===
  // bdata.cpp:2697 ClassQueen "QUEE" BSIZE_21 → 2x1
  ['QUEE', 2, 1, 'bdata.cpp:2697 BSIZE_21'],
  // bdata.cpp:2726 ClassLarva1 "LAR1" BSIZE_11 → 1x1
  ['LAR1', 1, 1, 'bdata.cpp:2726 BSIZE_11'],
  // bdata.cpp:2755 ClassLarva2 "LAR2" BSIZE_11 → 1x1
  ['LAR2', 1, 1, 'bdata.cpp:2755 BSIZE_11'],

  // === Select civilian structures ===
  // bdata.cpp:1377 ClassV01 "V01" BSIZE_22 → 2x2
  ['V01', 2, 2, 'bdata.cpp:1377 BSIZE_22'],
  // bdata.cpp:1407 ClassV02 "V02" BSIZE_22 → 2x2
  ['V02', 2, 2, 'bdata.cpp:1407 BSIZE_22'],
  // bdata.cpp:1437 ClassV03 "V03" BSIZE_22 → 2x2
  ['V03', 2, 2, 'bdata.cpp:1437 BSIZE_22'],
  // bdata.cpp:1467 ClassV04 "V04" BSIZE_22 → 2x2
  ['V04', 2, 2, 'bdata.cpp:1467 BSIZE_22'],
  // bdata.cpp:1497 ClassV05 "V05" BSIZE_21 → 2x1
  ['V05', 2, 1, 'bdata.cpp:1497 BSIZE_21'],
  // bdata.cpp:1527 ClassV06 "V06" BSIZE_21 → 2x1
  ['V06', 2, 1, 'bdata.cpp:1527 BSIZE_21'],
  // bdata.cpp:1557 ClassV07 "V07" BSIZE_21 → 2x1
  ['V07', 2, 1, 'bdata.cpp:1557 BSIZE_21'],
  // bdata.cpp:1587 ClassV08 "V08" BSIZE_11 → 1x1
  ['V08', 1, 1, 'bdata.cpp:1587 BSIZE_11'],
  // bdata.cpp:1917 ClassV19 "V19" (Pump) BSIZE_11 → 1x1
  ['V19', 1, 1, 'bdata.cpp:1917 BSIZE_11'],
  // bdata.cpp:1947 ClassV20 "V20" BSIZE_22 → 2x2
  ['V20', 2, 2, 'bdata.cpp:1947 BSIZE_22'],
  // bdata.cpp:2007 ClassV22 "V22" BSIZE_21 → 2x1
  ['V22', 2, 1, 'bdata.cpp:2007 BSIZE_21'],
  // bdata.cpp:2456 ClassV37 "V37" BSIZE_42 → 4x2
  ['V37', 4, 2, 'bdata.cpp:2456 BSIZE_42'],
];

describe('C++ Parity: Building Footprint Sizes (STRUCTURE_SIZE)', () => {
  it.each(CPP_BUILDING_SIZES)(
    '%s should be %dx%d (%s)',
    (type, expectedW, expectedH, _ref) => {
      const size = STRUCTURE_SIZE[type];
      expect(size, `${type} should have an entry in STRUCTURE_SIZE`).toBeDefined();
      expect(size[0], `${type} width`).toBe(expectedW);
      expect(size[1], `${type} height`).toBe(expectedH);
    },
  );
});

// ── Key building sizes (named for readability) ──────────────────────────────

describe('C++ Parity: Key Building Size Spot-checks', () => {
  // bdata.cpp:685 FACT is BSIZE_33 → 3x3
  it('Construction Yard (FACT) is 3x3', () => {
    expect(STRUCTURE_SIZE['FACT']).toEqual([3, 3]);
  });

  // bdata.cpp:1015 POWR is BSIZE_22 → 2x2
  it('Power Plant (POWR) is 2x2', () => {
    expect(STRUCTURE_SIZE['POWR']).toEqual([2, 2]);
  });

  // bdata.cpp:1045 APWR is BSIZE_33 → 3x3
  it('Advanced Power Plant (APWR) is 3x3', () => {
    expect(STRUCTURE_SIZE['APWR']).toEqual([3, 3]);
  });

  // bdata.cpp:775 PROC is BSIZE_33 → 3x3
  it('Refinery (PROC) is 3x3', () => {
    expect(STRUCTURE_SIZE['PROC']).toEqual([3, 3]);
  });

  // bdata.cpp:415 WEAP is BSIZE_32 → 3x2
  it('War Factory (WEAP) is 3x2', () => {
    expect(STRUCTURE_SIZE['WEAP']).toEqual([3, 2]);
  });

  // bdata.cpp:985 AFLD is BSIZE_32 → 3x2
  it('Airstrip (AFLD) is 3x2', () => {
    expect(STRUCTURE_SIZE['AFLD']).toEqual([3, 2]);
  });

  // bdata.cpp:1347 FIX is BSIZE_33 → 3x3
  it('Repair Pad (FIX) is 3x3', () => {
    expect(STRUCTURE_SIZE['FIX']).toEqual([3, 3]);
  });

  // bdata.cpp:565 TSLA is BSIZE_12 → 1x2
  it('Tesla Coil (TSLA) is 1x2', () => {
    expect(STRUCTURE_SIZE['TSLA']).toEqual([1, 2]);
  });

  // bdata.cpp:625 AGUN is BSIZE_12 → 1x2
  it('AA Gun (AGUN) is 1x2', () => {
    expect(STRUCTURE_SIZE['AGUN']).toEqual([1, 2]);
  });

  // bdata.cpp:895 GAP is BSIZE_12 → 1x2
  it('Gap Generator (GAP) is 1x2', () => {
    expect(STRUCTURE_SIZE['GAP']).toEqual([1, 2]);
  });

  // bdata.cpp:955 MSLO is BSIZE_21 → 2x1
  it('Missile Silo (MSLO) is 2x1', () => {
    expect(STRUCTURE_SIZE['MSLO']).toEqual([2, 1]);
  });

  // bdata.cpp:1075 STEK is BSIZE_33 → 3x3
  it('Soviet Tech Center (STEK) is 3x3', () => {
    expect(STRUCTURE_SIZE['STEK']).toEqual([3, 3]);
  });

  // bdata.cpp:2697 QUEE is BSIZE_21 → 2x1
  it('Ant Queen (QUEE) is 2x1', () => {
    expect(STRUCTURE_SIZE['QUEE']).toEqual([2, 1]);
  });
});

// ── Bib tests ───────────────────────────────────────────────────────────────

/**
 * C++ bdata.cpp:2831: IsBibbed defaults to false in constructor.
 * C++ bdata.cpp:3775: IsBibbed = ini.Get_Bool(Name(), "Bib", IsBibbed)
 * Only buildings with Bib=yes in rules.ini get bibs.
 *
 * From rules.ini, these buildings have Bib=yes:
 *   FCOM, ATEK, WEAP, FACT, PROC, HPAD, DOME, POWR, APWR,
 *   STEK, HOSP, BIO, BARR, TENT, MISS, FACF, WEAF, DOMF
 *
 * These do NOT have Bib=yes in rules.ini (IsBibbed=false):
 *   FIX, AFLD, IRON, PDOX, SYRD, SPEN, MSLO, GUN, SAM, etc.
 */
const CPP_BIBBED_BUILDINGS = new Set([
  'FCOM', 'ATEK', 'WEAP', 'FACT', 'PROC', 'HPAD', 'DOME',
  'POWR', 'APWR', 'STEK', 'HOSP', 'BIO', 'BARR', 'TENT',
  'MISS', 'FACF', 'WEAF', 'DOMF', 'FENC', 'MINP',
]);

const CPP_NOT_BIBBED = [
  'FIX', 'AFLD', 'IRON', 'PDOX', 'SYRD', 'SPEN', 'MSLO',
  'GUN', 'SAM', 'SILO', 'PBOX', 'HBOX', 'TSLA', 'AGUN',
  'GAP', 'FTUR', 'KENN', 'MINV', 'BARL', 'BRL3',
  'SBAG', 'BARB', 'BRIK', 'WOOD', 'CYCL',
];

describe('C++ Parity: BIBBED_BUILDINGS (rules.ini Bib=yes)', () => {
  it('all C++ bibbed buildings are in TS BIBBED_BUILDINGS', () => {
    for (const type of CPP_BIBBED_BUILDINGS) {
      expect(BIBBED_BUILDINGS.has(type), `${type} should be bibbed (rules.ini Bib=yes)`).toBe(true);
    }
  });

  it('buildings without Bib=yes in rules.ini should NOT be in BIBBED_BUILDINGS', () => {
    for (const type of CPP_NOT_BIBBED) {
      expect(
        BIBBED_BUILDINGS.has(type),
        `${type} should NOT be bibbed (no Bib=yes in rules.ini, bdata.cpp:2831 default false)`,
      ).toBe(false);
    }
  });

  it('TS BIBBED_BUILDINGS has exactly the buildings from rules.ini Bib=yes', () => {
    // Check for TS extras not in C++
    for (const type of BIBBED_BUILDINGS) {
      expect(
        CPP_BIBBED_BUILDINGS.has(type),
        `${type} is in TS BIBBED_BUILDINGS but NOT in rules.ini Bib=yes`,
      ).toBe(true);
    }
    // Check for C++ entries missing from TS
    for (const type of CPP_BIBBED_BUILDINGS) {
      expect(
        BIBBED_BUILDINGS.has(type),
        `${type} is in rules.ini Bib=yes but NOT in TS BIBBED_BUILDINGS`,
      ).toBe(true);
    }
  });
});

// ── Bib cell generation ─────────────────────────────────────────────────────

describe('C++ Parity: getBibCells output', () => {
  // bdata.cpp:3597-3629 Bib_And_Offset:
  //   Width 2 → SMUDGE_BIB3 (2 cells wide)
  //   Width 3 → SMUDGE_BIB2 (3 cells wide)
  //   Width 4 → SMUDGE_BIB1 (4 cells wide)
  //   Width 1 → SMUDGE_NONE (no bib)
  //   Bib row = cy + height (no bib, just foundation height)
  //   The bib extends 1 row below the building footprint.

  it('FACT (3x3, bibbed) → 3-cell-wide bib at row cy+3', () => {
    const cells = getBibCells('FACT', 5, 5);
    expect(cells).toHaveLength(3);
    // Bib row is at cy + height = 5 + 3 = 8
    expect(cells).toEqual([
      { cx: 5, cy: 8 },
      { cx: 6, cy: 8 },
      { cx: 7, cy: 8 },
    ]);
  });

  it('WEAP (3x2, bibbed) → 3-cell-wide bib at row cy+2', () => {
    const cells = getBibCells('WEAP', 3, 3);
    expect(cells).toHaveLength(3);
    expect(cells).toEqual([
      { cx: 3, cy: 5 },
      { cx: 4, cy: 5 },
      { cx: 5, cy: 5 },
    ]);
  });

  it('POWR (2x2, bibbed) → 2-cell-wide bib at row cy+2', () => {
    const cells = getBibCells('POWR', 10, 10);
    expect(cells).toHaveLength(2);
    expect(cells).toEqual([
      { cx: 10, cy: 12 },
      { cx: 11, cy: 12 },
    ]);
  });

  it('DOME (2x2, bibbed) → 2-cell-wide bib at row cy+2', () => {
    const cells = getBibCells('DOME', 0, 0);
    expect(cells).toHaveLength(2);
    expect(cells).toEqual([
      { cx: 0, cy: 2 },
      { cx: 1, cy: 2 },
    ]);
  });

  it('SILO (1x1, not bibbed) → no bib cells', () => {
    expect(getBibCells('SILO', 5, 5)).toEqual([]);
  });

  it('GUN (1x1, not bibbed) → no bib cells', () => {
    expect(getBibCells('GUN', 5, 5)).toEqual([]);
  });

  // bdata.cpp:3601-3618: Width 1 → default case → SMUDGE_NONE
  // Even if somehow marked bibbed, a width-1 building gets no bib
  it('getBibCells returns [] for non-bibbed buildings regardless of size', () => {
    for (const type of CPP_NOT_BIBBED) {
      expect(getBibCells(type, 5, 5), `${type} should produce no bib cells`).toEqual([]);
    }
  });

  it('MISS (3x2, bibbed) → 3-cell-wide bib at row cy+2', () => {
    const cells = getBibCells('MISS', 0, 0);
    expect(cells).toHaveLength(3);
    expect(cells).toEqual([
      { cx: 0, cy: 2 },
      { cx: 1, cy: 2 },
      { cx: 2, cy: 2 },
    ]);
  });

  // FACF (3x3, bibbed via rules.ini Bib=yes) → 3-cell bib at cy+3
  it('FACF (3x3, bibbed) → 3-cell-wide bib at row cy+3', () => {
    const cells = getBibCells('FACF', 2, 2);
    expect(cells).toHaveLength(3);
    expect(cells).toEqual([
      { cx: 2, cy: 5 },
      { cx: 3, cy: 5 },
      { cx: 4, cy: 5 },
    ]);
  });
});

// ── Placement logic tests (adjacency + buildability) ────────────────────────

// Import the placement function and its context type
import { placeStructure, type PlacementContext } from '../engine/placement';
import { GameMap, Terrain } from '../engine/map';
import { Entity } from '../engine/entity';
import { House, CELL_SIZE, type ProductionItem } from '../engine/types';

function makePlacementCtx(overrides: Partial<PlacementContext> = {}): PlacementContext {
  const map = new GameMap(64, 64);
  // Make all cells buildable by default
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      map.setTerrain(x, y, Terrain.CLEAR);
    }
  }

  return {
    structures: [],
    entities: [],
    entityById: new Map(),
    credits: 50000,
    tick: 100,
    playerHouse: House.ALLIES,
    pendingPlacement: null,
    wallPlacementPrepaid: false,
    cachedAvailableItems: null,
    evaMessages: [],
    effects: [],
    map,
    isAllied: (a, b) => a === b,
    playSound: () => {},
    getAvailableItems: () => [],
    findPassableSpawn: (cx, cy) => ({ cx, cy }),
    ...overrides,
  };
}

function makeFriendlyStructure(type: string, cx: number, cy: number): {
  type: string; image: string; house: House;
  cx: number; cy: number; hp: number; maxHp: number;
  alive: boolean; rubble: boolean; attackCooldown: number;
  ammo: number; maxAmmo: number;
} {
  return {
    type, image: type.toLowerCase(), house: House.ALLIES,
    cx, cy, hp: 1000, maxHp: 1000, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function makeItem(type: string, cost = 300): ProductionItem {
  return { type, cost, buildTime: 100, prerequisites: [], side: 'allies', category: 'structure' } as any;
}

describe('C++ Parity: Placement adjacency check', () => {
  // display.cpp:706-778 Passes_Proximity_Check:
  // Buildings must be placed within 2 cells of an existing friendly structure.

  it('rejects placement with no nearby structures', () => {
    const ctx = makePlacementCtx({ pendingPlacement: makeItem('POWR') });
    const result = placeStructure(ctx, 30, 30);
    expect(result).toBe(false);
  });

  it('accepts placement adjacent to existing friendly structure (1 cell away)', () => {
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    // Place POWR (2x2) just to the right of FACT (3x3): at cx=13, cy=10
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(true);
  });

  it('accepts placement 2 cells away from existing structure', () => {
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    // FACT occupies (10,10) to (12,12). Place POWR at cx=14, cy=10 (1 gap cell)
    const result = placeStructure(ctx, 14, 10);
    expect(result).toBe(true);
  });

  it('rejects placement too far from any friendly structure', () => {
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    // FACT occupies (10,10) to (12,12). Place POWR at cx=16, cy=10 (3 gap cells)
    const result = placeStructure(ctx, 16, 10);
    expect(result).toBe(false);
  });
});

describe('C++ Parity: Placement on occupied cells', () => {
  // cell.cpp:498-503: cells must be buildable — WALL terrain is NOT buildable.

  it('rejects placement when footprint overlaps existing structure', () => {
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    // Mark FACT footprint cells as WALL (as the engine does on placement)
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        ctx.map.setTerrain(10 + dx, 10 + dy, Terrain.WALL);
      }
    }
    // Try to place POWR on top of FACT at (10, 10)
    const result = placeStructure(ctx, 10, 10);
    expect(result).toBe(false);
  });

  it('rejects placement on unbuildable terrain (ORE)', () => {
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    // Set the target area to ORE terrain
    ctx.map.setTerrain(13, 10, Terrain.ORE);
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });
});
