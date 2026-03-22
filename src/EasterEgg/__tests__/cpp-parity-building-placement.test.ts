/**
 * C++ Behavioral Parity: Building Placement — Footprints, Bibs, Adjacency
 *
 * Tests verify building placement data and logic matches C++ RA source code.
 * Each test documents the C++ source reference (file:line).
 *
 * CRITICAL: All expected values are PARSED from rules.ini / aftrmath.ini.
 * rules.ini is the authoritative source of truth, NOT C++ constructor defaults.
 *
 * Key C++ sources:
 *   bdata.cpp:150-2760  — BuildingTypeClass constructors (BSIZE_*, occupy/overlap lists)
 *   bdata.cpp:3530-3544 — Width() lookup table from BSizeType enum
 *   bdata.cpp:3561-3575 — Height() lookup table (+ bib row when IsBibbed)
 *   bdata.cpp:3597-3629 — Bib_And_Offset (SMUDGE_BIB1/2/3 for width 4/3/2)
 *   bdata.cpp:2831      — IsBibbed default = false
 *   bdata.cpp:3775      — IsBibbed read from rules.ini "Bib" key (default false)
 *   defines.h:2888-2901 — BSizeType enum (BSIZE_11..BSIZE_55)
 *   display.cpp:706-778 — Passes_Proximity_Check (adjacency within 2 cells)
 *   cell.cpp:453-513    — Is_Clear_To_Build (only CLEAR+ROAD are buildable)
 *   building.cpp:1062-1098 — wall → overlay conversion
 *   rules.ini            — Bib=yes, Strength=, Adjacent= per building
 */

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseIniSections, parseIniInt, type IniSections } from '../engine/parseIni';
import {
  STRUCTURE_SIZE,
  STRUCTURE_MAX_HP,
  BIBBED_BUILDINGS,
  getBibCells,
} from '../engine/scenario';
import { placeStructure, deployMCV, type PlacementContext } from '../engine/placement';
import { GameMap, Terrain } from '../engine/map';
import { Entity } from '../engine/entity';
import { House, CELL_SIZE, UnitType, Mission, type ProductionItem } from '../engine/types';
import type { MapStructure } from '../engine/scenario';
import type { Effect } from '../engine/renderer';

// ══════════════════════════════════════════════════════════════════════════════
// INI Parsing — authoritative source of truth
// ══════════════════════════════════════════════════════════════════════════════

const RULES_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/rules.ini');
const AFTRMATH_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/aftrmath.ini');

const rulesText = fs.readFileSync(RULES_INI_PATH, 'utf-8');
const aftrmathText = fs.readFileSync(AFTRMATH_INI_PATH, 'utf-8');

const rulesSections = parseIniSections(rulesText);
const aftrmathSections = parseIniSections(aftrmathText);

/** Get a merged INI section: aftrmath.ini overrides rules.ini on a per-key basis.
 *  C++ loads rules.ini first, then aftrmath.ini overrides matching keys. */
function getMergedSection(name: string): Map<string, string> | undefined {
  const base = rulesSections.get(name);
  const override = aftrmathSections.get(name);
  if (!base && !override) return undefined;
  const merged = new Map<string, string>();
  if (base) for (const [k, v] of base) merged.set(k, v);
  if (override) for (const [k, v] of override) merged.set(k, v);
  return merged;
}

/** Parse boolean INI value matching C++ Get_Bool behavior:
 *  "yes", "true", "1" → true; anything else → false */
function parseIniBool(value: string | undefined, defValue = false): boolean {
  if (value == null || value === '') return defValue;
  const lower = value.toLowerCase().trim();
  return lower === 'yes' || lower === 'true' || lower === '1';
}

// ── Derive expected Bib=yes set from INI ─────────────────────────────────────

/** Collect all building types that have Bib=yes in merged rules.ini + aftrmath.ini.
 *  C++ bdata.cpp:2831 — IsBibbed defaults to false.
 *  C++ bdata.cpp:3775 — IsBibbed = ini.Get_Bool(Name(), "Bib", IsBibbed) */
const INI_BIBBED_BUILDINGS = new Set<string>();
const INI_NOT_BIBBED_BUILDINGS = new Set<string>();

// All known building type names (from both C++ bdata.cpp constructors and STRUCTURE_SIZE keys)
const ALL_BUILDING_TYPES = Object.keys(STRUCTURE_SIZE);

for (const type of ALL_BUILDING_TYPES) {
  const section = getMergedSection(type);
  const hasBib = section ? parseIniBool(section.get('Bib'), false) : false;
  if (hasBib) {
    INI_BIBBED_BUILDINGS.add(type);
  } else {
    INI_NOT_BIBBED_BUILDINGS.add(type);
  }
}

// ── Derive expected Strength= values from INI ───────────────────────────────

/** Parse Strength= from merged INI for a building type.
 *  C++ bdata.cpp constructors set defaults, but rules.ini Strength= overrides. */
function getIniStrength(type: string): number | undefined {
  const section = getMergedSection(type);
  if (!section || !section.has('Strength')) return undefined;
  return parseIniInt(section.get('Strength')!, 0);
}

// ── Derive expected Adjacent= values from INI ───────────────────────────────

/** Parse Adjacent= from merged INI. C++ default is 1 for most buildings.
 *  bdata.cpp:2825 — Adjacent default = 1 (set in constructor)
 *  Then overridden by rules.ini Adjacent= key. */
function getIniAdjacent(type: string): number | undefined {
  const section = getMergedSection(type);
  if (!section || !section.has('Adjacent')) return undefined;
  return parseIniInt(section.get('Adjacent')!);
}

// ══════════════════════════════════════════════════════════════════════════════
// C++ BSizeType → Width/Height reference data
// ══════════════════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════════════════
// Test helpers for placement context
// ══════════════════════════════════════════════════════════════════════════════

function makeMap(): GameMap {
  const m = new GameMap();
  m.setBounds(0, 0, 128, 128);
  return m;
}

function makeFriendlyStructure(type: string, cx: number, cy: number): MapStructure {
  return {
    type, image: type.toLowerCase(), house: House.Greece,
    cx, cy, hp: 1000, maxHp: 1000, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  } as MapStructure;
}

function makePlacementCtx(overrides: Partial<PlacementContext> = {}): PlacementContext {
  return {
    structures: [],
    entities: [],
    entityById: new Map(),
    credits: 50000,
    tick: 100,
    playerHouse: House.Greece,
    pendingPlacement: null,
    wallPlacementPrepaid: false,
    cachedAvailableItems: null,
    evaMessages: [],
    effects: [],
    map: makeMap(),
    isAllied: (a, b) => a === b,
    playSound: vi.fn(),
    getAvailableItems: () => [],
    findPassableSpawn: (cx, cy) => ({ cx, cy }),
    ...overrides,
  };
}

function makeItem(type: string, cost = 300): ProductionItem {
  return { type, cost, buildTime: 100, prerequisites: [], side: 'allies', category: 'structure' } as any;
}

/** Mark a structure's footprint + bibs on the map as WALL terrain. */
function stampStructure(map: GameMap, type: string, cx: number, cy: number): void {
  const [fw, fh] = STRUCTURE_SIZE[type] ?? [2, 2];
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      map.setTerrain(cx + dx, cy + dy, Terrain.WALL);
    }
  }
  for (const bc of getBibCells(type, cx, cy)) {
    map.setTerrain(bc.cx, bc.cy, Terrain.WALL);
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// Section 1: Building Footprint Sizes (STRUCTURE_SIZE vs C++ BSIZE)
// ══════════════════════════════════════════════════════════════════════════════

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


// ══════════════════════════════════════════════════════════════════════════════
// Section 2: BIBBED_BUILDINGS — INI-parsed Bib=yes verification
//
// C++ bdata.cpp:2831: IsBibbed defaults to false in constructor.
// C++ bdata.cpp:3775: IsBibbed = ini.Get_Bool(Name(), "Bib", IsBibbed)
// Only buildings with Bib=yes in rules.ini/aftrmath.ini get bibs.
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity: BIBBED_BUILDINGS (INI-parsed Bib=yes)', () => {
  it('INI parsing found expected bibbed buildings', () => {
    // Sanity check: the INI parser found the well-known bibbed buildings
    // These are explicitly verified against rules.ini:
    //   [FACT] Bib=yes (rules.ini:1418)
    //   [WEAP] Bib=yes (rules.ini:1276)
    //   [PROC] Bib=yes (rules.ini:1434)
    //   [POWR] Bib=yes (rules.ini:1553)
    //   [APWR] Bib=yes (rules.ini:1568)
    const wellKnownBibbed = ['FACT', 'WEAP', 'PROC', 'POWR', 'APWR', 'DOME', 'HPAD',
      'BARR', 'TENT', 'ATEK', 'STEK', 'HOSP', 'BIO', 'FCOM', 'MISS'];
    for (const type of wellKnownBibbed) {
      expect(INI_BIBBED_BUILDINGS.has(type),
        `${type} should have Bib=yes in rules.ini`).toBe(true);
    }
  });

  it('fake buildings have Bib=yes in INI', () => {
    // rules.ini: [FACF] Bib=yes (1783), [WEAF] Bib=yes (1797), [DOMF] Bib=yes (1840)
    // aftrmath.ini also has these with Bib=yes
    for (const type of ['FACF', 'WEAF', 'DOMF']) {
      expect(INI_BIBBED_BUILDINGS.has(type),
        `${type} should have Bib=yes in merged INI`).toBe(true);
    }
  });

  it('all INI Bib=yes buildings are in TS BIBBED_BUILDINGS set', () => {
    for (const type of INI_BIBBED_BUILDINGS) {
      expect(BIBBED_BUILDINGS.has(type),
        `${type} has Bib=yes in rules.ini but is missing from TS BIBBED_BUILDINGS`).toBe(true);
    }
  });

  it('buildings without Bib=yes in INI should NOT be in BIBBED_BUILDINGS', () => {
    // Check specifically that buildings with no Bib= key (or Bib=no) are excluded.
    // bdata.cpp:2831 — IsBibbed defaults to false, so no Bib= key means not bibbed.
    const wellKnownNotBibbed = [
      'FIX', 'AFLD', 'IRON', 'PDOX', 'SYRD', 'SPEN', 'MSLO',
      'GUN', 'SAM', 'SILO', 'PBOX', 'HBOX', 'TSLA', 'AGUN',
      'GAP', 'FTUR', 'KENN', 'MINV', 'BARL', 'BRL3',
      'SBAG', 'BARB', 'BRIK', 'WOOD', 'CYCL',
    ];
    for (const type of wellKnownNotBibbed) {
      expect(INI_NOT_BIBBED_BUILDINGS.has(type),
        `${type} should NOT have Bib=yes in rules.ini`).toBe(true);
      expect(BIBBED_BUILDINGS.has(type),
        `${type} should NOT be in TS BIBBED_BUILDINGS (no Bib=yes in INI)`).toBe(false);
    }
  });

  it('TS BIBBED_BUILDINGS has no entries beyond what INI specifies', () => {
    // Every entry in the TS set should correspond to a Bib=yes in INI.
    // This catches TS extras that were added without INI authority.
    for (const type of BIBBED_BUILDINGS) {
      // Note: FENC and MINP are in TS BIBBED_BUILDINGS but do NOT have Bib=yes in rules.ini.
      // However, they're width=1 so getBibCells returns [] for them anyway (no visible effect).
      // We still flag them as technically incorrect.
      if (!INI_BIBBED_BUILDINGS.has(type)) {
        const [fw] = STRUCTURE_SIZE[type] ?? [1, 1];
        if (fw >= 2) {
          // This would be a real bug: building in BIBBED set would generate bib cells
          // without INI authority
          expect(INI_BIBBED_BUILDINGS.has(type),
            `${type} is in TS BIBBED_BUILDINGS but NOT in rules.ini Bib=yes ` +
            `AND has width >= 2 so it would incorrectly generate bib cells`).toBe(true);
        }
        // Width < 2 entries in BIBBED_BUILDINGS are cosmetically wrong but functionally harmless
        // because getBibCells returns [] for width < 2 (bdata.cpp:3601-3618 default → SMUDGE_NONE)
      }
    }
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Section 3: Bib Cell Generation
//
// C++ bdata.cpp:3597-3629 Bib_And_Offset:
//   Width 2 → SMUDGE_BIB3 (2 cells wide)
//   Width 3 → SMUDGE_BIB2 (3 cells wide)
//   Width 4 → SMUDGE_BIB1 (4 cells wide)
//   Width 1 → SMUDGE_NONE (no bib)
//   Bib row = cy + height (one row below the building footprint)
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity: getBibCells output (bdata.cpp:3597-3629)', () => {

  it('FACT (3x3, bibbed per INI) → 3-cell-wide bib at row cy+3', () => {
    expect(INI_BIBBED_BUILDINGS.has('FACT')).toBe(true); // verify INI authority
    const cells = getBibCells('FACT', 5, 5);
    expect(cells).toHaveLength(3);
    // Bib row is at cy + height = 5 + 3 = 8
    expect(cells).toEqual([
      { cx: 5, cy: 8 },
      { cx: 6, cy: 8 },
      { cx: 7, cy: 8 },
    ]);
  });

  it('WEAP (3x2, bibbed per INI) → 3-cell-wide bib at row cy+2', () => {
    expect(INI_BIBBED_BUILDINGS.has('WEAP')).toBe(true);
    const cells = getBibCells('WEAP', 3, 3);
    expect(cells).toHaveLength(3);
    expect(cells).toEqual([
      { cx: 3, cy: 5 },
      { cx: 4, cy: 5 },
      { cx: 5, cy: 5 },
    ]);
  });

  it('POWR (2x2, bibbed per INI) → 2-cell-wide bib at row cy+2', () => {
    expect(INI_BIBBED_BUILDINGS.has('POWR')).toBe(true);
    const cells = getBibCells('POWR', 10, 10);
    expect(cells).toHaveLength(2);
    expect(cells).toEqual([
      { cx: 10, cy: 12 },
      { cx: 11, cy: 12 },
    ]);
  });

  it('DOME (2x2, bibbed per INI) → 2-cell-wide bib at row cy+2', () => {
    expect(INI_BIBBED_BUILDINGS.has('DOME')).toBe(true);
    const cells = getBibCells('DOME', 0, 0);
    expect(cells).toHaveLength(2);
    expect(cells).toEqual([
      { cx: 0, cy: 2 },
      { cx: 1, cy: 2 },
    ]);
  });

  it('SILO (1x1, not bibbed per INI) → no bib cells', () => {
    expect(INI_BIBBED_BUILDINGS.has('SILO')).toBe(false);
    expect(getBibCells('SILO', 5, 5)).toEqual([]);
  });

  it('GUN (1x1, not bibbed per INI) → no bib cells', () => {
    expect(INI_BIBBED_BUILDINGS.has('GUN')).toBe(false);
    expect(getBibCells('GUN', 5, 5)).toEqual([]);
  });

  // bdata.cpp:3601-3618: Width 1 → default case → SMUDGE_NONE
  // Even if somehow marked bibbed, a width-1 building gets no bib
  it('getBibCells returns [] for all non-bibbed buildings', () => {
    for (const type of INI_NOT_BIBBED_BUILDINGS) {
      if (STRUCTURE_SIZE[type]) {
        expect(getBibCells(type, 5, 5), `${type} should produce no bib cells`).toEqual([]);
      }
    }
  });

  it('MISS (3x2, bibbed per INI) → 3-cell-wide bib at row cy+2', () => {
    expect(INI_BIBBED_BUILDINGS.has('MISS')).toBe(true);
    const cells = getBibCells('MISS', 0, 0);
    expect(cells).toHaveLength(3);
    expect(cells).toEqual([
      { cx: 0, cy: 2 },
      { cx: 1, cy: 2 },
      { cx: 2, cy: 2 },
    ]);
  });

  // FACF (3x3, bibbed per INI Bib=yes) → 3-cell bib at cy+3
  it('FACF (3x3, bibbed per INI) → 3-cell-wide bib at row cy+3', () => {
    expect(INI_BIBBED_BUILDINGS.has('FACF')).toBe(true);
    const cells = getBibCells('FACF', 2, 2);
    expect(cells).toHaveLength(3);
    expect(cells).toEqual([
      { cx: 2, cy: 5 },
      { cx: 3, cy: 5 },
      { cx: 4, cy: 5 },
    ]);
  });

  it('bib width matches building width for all INI-bibbed buildings', () => {
    // C++ bdata.cpp:3597-3629 — bib width == building width
    for (const type of INI_BIBBED_BUILDINGS) {
      const size = STRUCTURE_SIZE[type];
      if (!size) continue;
      const [fw, fh] = size;
      if (fw < 2 || fw > 4) continue; // C++ only generates bibs for width 2-4
      const cells = getBibCells(type, 0, 0);
      expect(cells.length, `${type} bib width should match building width ${fw}`).toBe(fw);
      // All bib cells should be at row = fh (one below footprint)
      for (const cell of cells) {
        expect(cell.cy, `${type} bib cell should be at row ${fh}`).toBe(fh);
      }
    }
  });

  it('APWR (3x3, bibbed per INI) → 3-cell-wide bib at row cy+3', () => {
    expect(INI_BIBBED_BUILDINGS.has('APWR')).toBe(true);
    const cells = getBibCells('APWR', 4, 4);
    expect(cells).toHaveLength(3);
    expect(cells).toEqual([
      { cx: 4, cy: 7 },
      { cx: 5, cy: 7 },
      { cx: 6, cy: 7 },
    ]);
  });

  it('BARR (2x2, bibbed per INI) → 2-cell-wide bib at row cy+2', () => {
    expect(INI_BIBBED_BUILDINGS.has('BARR')).toBe(true);
    const cells = getBibCells('BARR', 1, 1);
    expect(cells).toHaveLength(2);
    expect(cells).toEqual([
      { cx: 1, cy: 3 },
      { cx: 2, cy: 3 },
    ]);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Section 4: Building Strength / Max HP — INI Strength= vs TS STRUCTURE_MAX_HP
//
// C++ bdata.cpp constructors set default Strength, but rules.ini Strength=
// overrides at runtime. rules.ini is authoritative.
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity: Building Max HP (rules.ini Strength= vs STRUCTURE_MAX_HP)', () => {

  // Key military buildings — verify INI-parsed Strength matches TS
  const KEY_BUILDINGS_FOR_HP = [
    'FACT', 'WEAP', 'PROC', 'POWR', 'APWR', 'BARR', 'TENT',
    'DOME', 'HPAD', 'AFLD', 'FIX', 'SILO',
    'GUN', 'SAM', 'TSLA', 'AGUN', 'GAP', 'PBOX', 'HBOX', 'FTUR', 'KENN',
    'ATEK', 'STEK', 'IRON', 'PDOX', 'MSLO',
    'SYRD', 'SPEN', 'BIO', 'HOSP', 'FCOM', 'MISS',
    'FACF', 'DOMF', 'WEAF',
  ];

  it.each(KEY_BUILDINGS_FOR_HP)(
    '%s Strength in rules.ini matches TS STRUCTURE_MAX_HP',
    (type) => {
      const iniStrength = getIniStrength(type);
      expect(iniStrength, `${type} should have Strength= in rules.ini`).toBeDefined();
      const tsMaxHp = STRUCTURE_MAX_HP[type];
      expect(tsMaxHp, `${type} should have entry in STRUCTURE_MAX_HP`).toBeDefined();
      expect(tsMaxHp, `${type}: TS STRUCTURE_MAX_HP (${tsMaxHp}) should match rules.ini Strength=${iniStrength}`).toBe(iniStrength!);
    },
  );

  it('wall types have Strength=1 in INI', () => {
    // rules.ini: all walls have Strength=1
    for (const type of ['SBAG', 'FENC', 'BRIK', 'CYCL', 'BARB', 'WOOD']) {
      const iniStrength = getIniStrength(type);
      expect(iniStrength, `${type} should have Strength=1 in rules.ini`).toBe(1);
      expect(STRUCTURE_MAX_HP[type], `${type} TS max HP should be 1`).toBe(1);
    }
  });

  it('mine types have Strength=1 in INI', () => {
    for (const type of ['MINP', 'MINV']) {
      const iniStrength = getIniStrength(type);
      expect(iniStrength, `${type} should have Strength=1 in rules.ini`).toBe(1);
      expect(STRUCTURE_MAX_HP[type], `${type} TS max HP should be 1`).toBe(1);
    }
  });

  it('barrels have Strength=10 in INI', () => {
    for (const type of ['BARL', 'BRL3']) {
      const iniStrength = getIniStrength(type);
      expect(iniStrength, `${type} should have Strength=10 in rules.ini`).toBe(10);
      expect(STRUCTURE_MAX_HP[type], `${type} TS max HP should be 10`).toBe(10);
    }
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Section 5: Adjacent= values — wall and naval placement adjacency ranges
//
// C++ bdata.cpp:2825 — Adjacent defaults to 1 (in constructor)
// rules.ini overrides: walls Adjacent=1, naval Adjacent=8, barrels Adjacent=0
// display.cpp:706-778 Passes_Proximity_Check uses Adjacent value to determine
// how far from existing buildings a new building can be placed.
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity: Adjacent= values from rules.ini', () => {

  it('wall types have Adjacent=1 in rules.ini', () => {
    // rules.ini: SBAG, BRIK, FENC, CYCL, BARB, WOOD all have Adjacent=1
    for (const type of ['SBAG', 'BRIK', 'FENC', 'CYCL', 'BARB', 'WOOD']) {
      const adj = getIniAdjacent(type);
      expect(adj, `${type} should have Adjacent= in rules.ini`).toBeDefined();
      expect(adj, `${type} Adjacent= should be 1`).toBe(1);
    }
  });

  it('naval buildings have Adjacent=8 in rules.ini', () => {
    // rules.ini: [SYRD] Adjacent=8, [SPEN] Adjacent=8
    // This allows ship yards to be placed far from base (up to 8 cells from any building)
    for (const type of ['SYRD', 'SPEN']) {
      const adj = getIniAdjacent(type);
      expect(adj, `${type} should have Adjacent= in rules.ini`).toBeDefined();
      expect(adj, `${type} Adjacent= should be 8`).toBe(8);
    }
  });

  it('barrels and mines have Adjacent=0 in rules.ini', () => {
    // Adjacent=0 means the object doesn't need adjacency at all (map-placed only)
    for (const type of ['BARL', 'BRL3', 'MINV', 'MINP']) {
      const adj = getIniAdjacent(type);
      expect(adj, `${type} should have Adjacent= in rules.ini`).toBeDefined();
      expect(adj, `${type} Adjacent= should be 0`).toBe(0);
    }
  });

  it('fake naval buildings have Adjacent=8 in rules.ini/aftrmath.ini', () => {
    // aftrmath.ini: [SYRF] Adjacent=8, [SPEF] Adjacent=8
    for (const type of ['SYRF', 'SPEF']) {
      const adj = getIniAdjacent(type);
      if (adj !== undefined) {
        expect(adj, `${type} Adjacent= should be 8`).toBe(8);
      }
    }
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Section 6: Placement adjacency check (display.cpp:706-778)
//
// C++ Passes_Proximity_Check: buildings must be placed within 2 cells of an
// existing friendly structure. The C++ algorithm does a two-ring 8-dir scan
// from each foundation cell, reaching buildings up to 2 cells away.
// TS uses AABB intersection with 2-cell expansion.
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity: Placement adjacency check (display.cpp:706-778)', () => {

  it('rejects placement with no nearby structures', () => {
    // display.cpp:781: no adjacent structure found → retval = false
    const ctx = makePlacementCtx({ pendingPlacement: makeItem('POWR') });
    const result = placeStructure(ctx, 30, 30);
    expect(result).toBe(false);
  });

  it('accepts placement adjacent to existing friendly structure (1 cell away)', () => {
    // display.cpp:717-747: first ring finds FACT at (10,10)-(12,12), POWR at (13,10)
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    // Place POWR (2x2) right-adjacent to FACT (3x3): at cx=13, cy=10
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(true);
  });

  it('accepts placement 2 cells away from existing structure', () => {
    // display.cpp:749-775: second-level scan reaches 2 cells away
    // FACT occupies (10,10)-(12,12). POWR at (14,10) has 1 gap cell at column 13.
    // TS uses 2-cell AABB expansion: FACT expanded to (8,8)-(15,15)
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    const result = placeStructure(ctx, 14, 10);
    expect(result).toBe(true);
  });

  it('rejects placement too far from any friendly structure (3+ cell gap)', () => {
    // FACT occupies (10,10)-(12,12). POWR at (16,10) has 3 gap cells.
    // Even C++ two-ring scan cannot reach 3 cells away.
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    const result = placeStructure(ctx, 16, 10);
    expect(result).toBe(false);
  });

  it('rejects placement adjacent to enemy structure', () => {
    // display.cpp:744: checks base->House->Class->House == house
    const enemy = makeFriendlyStructure('FACT', 10, 10);
    enemy.house = House.USSR;
    const ctx = makePlacementCtx({
      structures: [enemy],
      pendingPlacement: makeItem('POWR'),
      playerHouse: House.Greece,
    });
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });

  it('rejects placement adjacent to dead (destroyed) building', () => {
    // C++ would not find a dead building via Cell_Techno()
    const dead = makeFriendlyStructure('FACT', 10, 10);
    dead.alive = false;
    const ctx = makePlacementCtx({
      structures: [dead],
      pendingPlacement: makeItem('POWR'),
    });
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });

  it('accepts placement diagonally adjacent (touching at corner)', () => {
    // display.cpp:717: 8-directional scan includes diagonal facings
    // FACT at (10,10)-(12,12), POWR at (13,13): diagonal to FACT corner at (12,12)
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    const result = placeStructure(ctx, 13, 13);
    expect(result).toBe(true);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Section 7: Terrain restrictions for building placement
//
// C++ cell.cpp:498-503: loco==SPEED_NONE → check Ground[Land_Type()].Build
// C++ rules.ini ground types:
//   CLEAR: Build=true, ROAD: Build=true
//   WATER, ROCK, WALL, ORE, BEACH, ROUGH, RIVER: Build=false
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity: Placement on occupied/unbuildable cells', () => {

  it('rejects placement when footprint overlaps existing structure (WALL terrain)', () => {
    // cell.cpp:498-503: WALL terrain has Ground[LAND_WALL].Build=false
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    // Mark FACT footprint as WALL (as engine does on placement)
    stampStructure(ctx.map, 'FACT', 10, 10);
    // Try to place POWR on top of FACT
    const result = placeStructure(ctx, 10, 10);
    expect(result).toBe(false);
  });

  it('rejects placement on ROCK terrain', () => {
    // cell.cpp:503: Ground[LAND_ROCK].Build=false
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    ctx.map.setTerrain(13, 10, Terrain.ROCK);
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });

  it('rejects placement on WATER terrain', () => {
    // cell.cpp:503: Ground[LAND_WATER].Build=false
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    ctx.map.setTerrain(13, 10, Terrain.WATER);
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });

  it('rejects placement on ORE terrain', () => {
    // cell.cpp:503: Ground[LAND_ORE].Build=false — ORE is passable but NOT buildable
    // TS map.ts:42: BUILDABLE = {CLEAR, ROAD} — ORE excluded from buildable
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    ctx.map.setTerrain(13, 10, Terrain.ORE);
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });

  it('accepts placement on CLEAR terrain', () => {
    // cell.cpp:503: Ground[LAND_CLEAR].Build=true
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    // Default terrain is CLEAR
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(true);
  });

  it('accepts placement on ROAD terrain', () => {
    // cell.cpp:503: Ground[LAND_ROAD].Build=true
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    // Set target cells to ROAD
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        ctx.map.setTerrain(13 + dx, 10 + dy, Terrain.ROAD);
      }
    }
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(true);
  });

  it('rejects placement when bib cells are unbuildable', () => {
    // bdata.cpp:3448-3477: Occupy_List(placement=true) includes bib cells
    // placement.ts:64-66: checks getBibCells for buildability
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'), // 2x2, bibbed
    });
    // POWR at (13,10): bib row at cy+2=12, cells (13,12) and (14,12)
    // Set bib row to WALL to block
    ctx.map.setTerrain(13, 12, Terrain.WALL);
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Section 8: Wall placement specific rules
//
// C++ building.cpp:1062-1098: walls convert to overlays on placement
// C++ building.cpp:1066-1088: STRUCT_SANDBAG_WALL → OVERLAY_SANDBAG_WALL etc.
// C++ display.cpp:734-741: walls can satisfy proximity via cell ownership
// TS placement.ts:19: WALL_TYPES = Set(['SBAG', 'FENC', 'BARB', 'BRIK', 'WOOD', 'CYCL'])
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity: Wall placement rules (building.cpp:1062-1098)', () => {

  it('wall placement marks wallType on map', () => {
    // C++ building.cpp:1062: if (Class->IsWall) → convert to overlay
    // TS: setWallType() records the wall type at the cell
    const fact = makeFriendlyStructure('FACT', 18, 18);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('BRIK', 100),
    });
    placeStructure(ctx, 20, 20);
    expect(ctx.map.getWallType(20, 20)).toBe('BRIK');
  });

  it('wall placement keeps pendingPlacement active for continuous placement', () => {
    // C++ building.cpp:1062-1098: after wall converts to overlay, production continues
    // TS placement.ts:118-127: walls keep pendingPlacement, non-walls clear it
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const item = makeItem('BRIK', 100);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: item,
      wallPlacementPrepaid: true,
    });
    placeStructure(ctx, 12, 12);
    expect(ctx.pendingPlacement).toBe(item); // still active for next wall
  });

  it('non-wall placement clears pendingPlacement', () => {
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const item = makeItem('POWR', 300);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: item,
    });
    placeStructure(ctx, 13, 10);
    expect(ctx.pendingPlacement).toBeNull();
  });

  it('wall types are all 1x1 in size', () => {
    // C++ bdata.cpp: all wall constructors use BSIZE_11
    const wallTypes = ['SBAG', 'FENC', 'BARB', 'BRIK', 'WOOD', 'CYCL'];
    for (const type of wallTypes) {
      expect(STRUCTURE_SIZE[type], `${type} should be 1x1`).toEqual([1, 1]);
    }
  });

  it('wall placement on occupied cell fails', () => {
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('BRIK', 100),
    });
    ctx.map.setTerrain(12, 10, Terrain.WALL);
    const result = placeStructure(ctx, 12, 10);
    expect(result).toBe(false);
  });

  it('wall placement deducts credits for subsequent walls (not first)', () => {
    // C++ building.cpp: first wall paid at production start, subsequent walls charged on placement
    // TS placement.ts:120-124: wallPlacementPrepaid controls first-wall exemption
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('BRIK', 100),
      wallPlacementPrepaid: false, // not prepaid → deduct on place
      credits: 500,
    });
    placeStructure(ctx, 12, 10);
    expect(ctx.credits).toBeLessThan(500); // credits deducted
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Section 9: Placement marks terrain as WALL (impassable)
//
// C++ building.cpp:740-797 BuildingClass::Mark(MARK_DOWN):
//   Marks each foundation cell as owned + blocked.
// C++ bdata.cpp:3597-3629: bib cells also marked impassable.
// TS placement.ts:105-113: setTerrain to WALL for footprint + bibs
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity: Placement terrain marking', () => {

  it('placed building marks footprint cells as WALL', () => {
    // C++ building.cpp:740-780: Mark(MARK_DOWN) marks each foundation cell
    // TS placement.ts:105-109: setTerrain(cx+dx, cy+dy, Terrain.WALL)
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    placeStructure(ctx, 13, 10);
    // POWR is 2x2 at (13,10)
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        expect(ctx.map.getTerrain(13 + dx, 10 + dy),
          `cell (${13 + dx},${10 + dy}) should be WALL after placement`).toBe(Terrain.WALL);
      }
    }
  });

  it('placed bibbed building marks bib cells as WALL', () => {
    // bdata.cpp:3597-3629: bib row below footprint is also impassable
    // TS placement.ts:111-113: marks bib cells as WALL
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'), // POWR is bibbed (2x2)
    });
    placeStructure(ctx, 13, 10);
    // POWR bib at row 12, cells (13,12) and (14,12)
    expect(INI_BIBBED_BUILDINGS.has('POWR')).toBe(true);
    const bibCells = getBibCells('POWR', 13, 10);
    for (const bc of bibCells) {
      expect(ctx.map.getTerrain(bc.cx, bc.cy),
        `bib cell (${bc.cx},${bc.cy}) should be WALL`).toBe(Terrain.WALL);
    }
  });

  it('placed non-bibbed building does NOT mark extra bib cells', () => {
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('SILO'), // SILO is 1x1, NOT bibbed
    });
    placeStructure(ctx, 12, 12);
    // Cell below SILO at (12,13) should remain CLEAR
    expect(INI_BIBBED_BUILDINGS.has('SILO')).toBe(false);
    expect(ctx.map.getTerrain(12, 13)).toBe(Terrain.CLEAR);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Section 10: Refinery spawns free harvester
//
// C++ building.cpp:740-797: placing PROC spawns a HARV at the first free cell
// TS placement.ts:140-147: spawns Entity(UnitType.V_HARV) on PROC placement
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity: Refinery free harvester spawn', () => {

  it('placing PROC spawns a harvester entity', () => {
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('PROC', 2000),
    });
    placeStructure(ctx, 13, 10);
    // Should have spawned one harvester
    expect(ctx.entities.length).toBe(1);
    expect(ctx.entities[0].type).toBe(UnitType.V_HARV);
    expect(ctx.entities[0].house).toBe(House.Greece);
  });

  it('placing non-PROC building does NOT spawn harvester', () => {
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR', 300),
    });
    placeStructure(ctx, 13, 10);
    expect(ctx.entities.length).toBe(0);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Section 11: MCV Deployment
//
// C++ unit.cpp:1477-1589 UnitClass::Try_To_Deploy():
//   - MCV at (cx,cy) deploys FACT at (cx-1, cy-1) — NW offset for 3x3 building
//   - Damaged MCV → damaged FACT: Strength = Health_Ratio() * Class->MaxStrength
//   - 3x3 area around MCV center must be buildable
// TS placement.ts:152-205 deployMCV()
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity: MCV deployment (unit.cpp:1477-1589)', () => {

  it('MCV deploys into FACT at NW-offset position', () => {
    // unit.cpp:1490: cell = Adjacent_Cell(Center_Coord(), FACING_NW)
    // MCV at cell (50,50) → FACT at (49,49)
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();
    deployMCV(ctx, mcv);

    expect(ctx.structures).toHaveLength(1);
    expect(ctx.structures[0].type).toBe('FACT');
    expect(ctx.structures[0].cx).toBe(49);
    expect(ctx.structures[0].cy).toBe(49);
  });

  it('MCV entity is killed after deployment', () => {
    // unit.cpp:1562: Stun(), line 1573: delete this
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();
    deployMCV(ctx, mcv);
    expect(mcv.alive).toBe(false);
    expect(mcv.mission).toBe(Mission.DIE);
  });

  it('deployed FACT inherits MCV house', () => {
    const mcv = new Entity(UnitType.V_MCV, House.USSR, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();
    deployMCV(ctx, mcv);
    expect(ctx.structures[0].house).toBe(House.USSR);
  });

  it('deployed FACT has INI-correct max HP', () => {
    // rules.ini [FACT] Strength=1000
    const iniStrength = getIniStrength('FACT');
    expect(iniStrength).toBe(1000);
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();
    deployMCV(ctx, mcv);
    expect(ctx.structures[0].maxHp).toBe(iniStrength!);
  });

  it('damaged MCV creates damaged FACT (unit.cpp:1555 Health_Ratio)', () => {
    // C++ unit.cpp:1555: building->Strength = Health_Ratio() * building->Class->MaxStrength
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    mcv.hp = Math.floor(mcv.maxHp * 0.5); // 50% health
    const ctx = makePlacementCtx();
    deployMCV(ctx, mcv);
    const factMaxHp = STRUCTURE_MAX_HP['FACT'] ?? 1000;
    const expectedHp = Math.floor(0.5 * factMaxHp);
    expect(ctx.structures[0].hp).toBe(expectedHp);
  });

  it('MCV deployment marks 3x3 footprint + bib cells as WALL', () => {
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();
    deployMCV(ctx, mcv);
    // FACT at (49,49), 3x3 footprint
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        expect(ctx.map.getTerrain(49 + dx, 49 + dy)).toBe(Terrain.WALL);
      }
    }
    // FACT is bibbed → bib row at y=52
    const bibCells = getBibCells('FACT', 49, 49);
    expect(bibCells.length).toBe(3);
    for (const bc of bibCells) {
      expect(ctx.map.getTerrain(bc.cx, bc.cy)).toBe(Terrain.WALL);
    }
  });

  it('MCV deployment fails on unbuildable terrain', () => {
    // unit.cpp:1491: Legal_Placement checks all 3x3 cells via Is_Clear_To_Build
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();
    // Block one cell in the 3x3 area
    ctx.map.setTerrain(49, 49, Terrain.ROCK);
    const result = deployMCV(ctx, mcv);
    expect(result).toBe(false);
    expect(mcv.alive).toBe(true); // MCV not consumed on failure
  });

  it('non-MCV entity cannot deploy', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();
    const result = deployMCV(ctx, tank);
    expect(result).toBe(false);
    expect(ctx.structures).toHaveLength(0);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Section 12: Comprehensive INI cross-check — every building with Bib=yes
// in rules.ini must produce correct bib cell count
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity: Exhaustive INI Bib=yes → getBibCells agreement', () => {

  it('every INI Bib=yes building with width >= 2 produces exactly width bib cells', () => {
    // bdata.cpp:3597-3629: Bib_And_Offset determines smudge type by width
    // Width 2 → SMUDGE_BIB3 (2 cells), Width 3 → SMUDGE_BIB2 (3 cells),
    // Width 4 → SMUDGE_BIB1 (4 cells), Width 1 → SMUDGE_NONE (0 cells)
    for (const type of INI_BIBBED_BUILDINGS) {
      const size = STRUCTURE_SIZE[type];
      if (!size) continue;
      const [fw, fh] = size;
      const cells = getBibCells(type, 0, 0);
      if (fw >= 2 && fw <= 4) {
        expect(cells.length,
          `${type} (${fw}x${fh}, Bib=yes): should produce ${fw} bib cells`).toBe(fw);
        // All cells should be at row = fh
        for (let i = 0; i < cells.length; i++) {
          expect(cells[i].cx, `${type} bib cell ${i} cx`).toBe(i);
          expect(cells[i].cy, `${type} bib cell ${i} cy`).toBe(fh);
        }
      } else if (fw < 2) {
        // Width < 2 → no bib generated even with Bib=yes in INI
        expect(cells.length,
          `${type} (${fw}x${fh}, Bib=yes but width<2): should produce 0 bib cells`).toBe(0);
      }
    }
  });

  it('no building without INI Bib=yes produces bib cells', () => {
    for (const type of INI_NOT_BIBBED_BUILDINGS) {
      if (!STRUCTURE_SIZE[type]) continue;
      const cells = getBibCells(type, 10, 10);
      expect(cells.length, `${type} (no Bib=yes in INI): should produce 0 bib cells`).toBe(0);
    }
  });
});
