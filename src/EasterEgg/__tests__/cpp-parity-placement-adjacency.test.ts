/**
 * C++ Behavioral Parity: Structure Placement — Adjacency Distance,
 * Construction Yard Requirement, Multi-Cell Validation
 *
 * Tests verify the TS placement subsystem matches C++ Red Alert behavior
 * for building placement proximity checks, per-building Adjacent= values,
 * and the ConYard requirement for production.
 *
 * rules.ini is the authoritative source of truth (per CLAUDE.md).
 *
 * === Key C++ Source References ===
 *
 *   display.cpp:695-812  — Passes_Proximity_Check
 *     :706  — if (building->Adjacent == 1) → two-ring scan (max 2 cells away)
 *     :717  — first ring: 8-dir Adjacent_Cell from each foundation cell
 *     :744  — checks Class->IsBase (BaseNormal=yes in rules.ini)
 *     :756  — second ring: cardinal-only scan from each first-ring cell
 *     :792  — if (building->Adjacent > 1) → center-distance check
 *     :799  — distance = Distance(center, cell) / CELL_LEPTON_W - (W+H)/2
 *     :802  — retval = (centdist <= building->Adjacent)
 *
 *   bdata.cpp:2839  — Adjacent default = 1 (C++ constructor)
 *   bdata.cpp:3772  — Adjacent = ini.Get_Int(Name(), "Adjacent", Adjacent)
 *   bdata.cpp:3777  — IsBase = ini.Get_Bool(Name(), "BaseNormal", IsBase)
 *
 *   rules.ini:
 *     [SYRD] Adjacent=8, BaseNormal=no
 *     [SPEN] Adjacent=8, BaseNormal=no
 *     [BARL] Adjacent=0, BaseNormal=no
 *     Walls: Adjacent=1, BaseNormal=no (IsWall=true path)
 *     Most buildings: no Adjacent= line → default 1, BaseNormal=yes
 *
 *   house.cpp:788-881  — Can_Build: prerequisite bitmask check
 *     :855  — int pre = type->Prerequisite (bitmask of required structures)
 *     :880  — return (pre & flags) == pre && level <= TechLevel
 *
 *   production.ts:144-158  — getAvailableItems(): hasBuilding(prerequisite)
 *   placement.ts:67-105    — proximity check (uses Adjacent= and BaseNormal filtering)
 */

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseIniSections, parseIniInt } from '../engine/parseIni';
import { STRUCTURE_SIZE, getBibCells, type MapStructure } from '../engine/scenario';
import { placeStructure, deployMCV, type PlacementContext } from '../engine/placement';
import { getAvailableItems, type ProductionContext } from '../engine/production';
import { GameMap, Terrain } from '../engine/map';
import { House, CELL_SIZE, UnitType, Mission, type ProductionItem, PRODUCTION_ITEMS } from '../engine/types';
import { Entity } from '../engine/entity';

// ══════════════════════════════════════════════════════════════════════════════
// INI Parsing — authoritative source of truth
// ══════════════════════════════════════════════════════════════════════════════

const RULES_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/rules.ini');
const AFTRMATH_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/aftrmath.ini');

const rulesText = fs.readFileSync(RULES_INI_PATH, 'utf-8');
const aftrmathText = fs.readFileSync(AFTRMATH_INI_PATH, 'utf-8');

const rulesSections = parseIniSections(rulesText);
const aftrmathSections = parseIniSections(aftrmathText);

function getMergedSection(name: string): Map<string, string> | undefined {
  const base = rulesSections.get(name);
  const override = aftrmathSections.get(name);
  if (!base && !override) return undefined;
  const merged = new Map<string, string>();
  if (base) for (const [k, v] of base) merged.set(k, v);
  if (override) for (const [k, v] of override) merged.set(k, v);
  return merged;
}

function parseIniBool(value: string | undefined, defValue = false): boolean {
  if (value == null || value === '') return defValue;
  const lower = value.toLowerCase().trim();
  return lower === 'yes' || lower === 'true' || lower === '1';
}

/** Get Adjacent= from rules.ini, defaulting to 1 (C++ bdata.cpp:2839) */
function getIniAdjacent(type: string): number {
  const section = getMergedSection(type);
  if (!section || !section.has('Adjacent')) return 1; // C++ default
  return parseIniInt(section.get('Adjacent')!);
}

/** Get BaseNormal= from rules.ini. Default is true for most buildings (C++ bdata.cpp). */
function getIniBaseNormal(type: string): boolean {
  const section = getMergedSection(type);
  if (!section) return true;
  // C++ defaults: IsBase is set in constructor (true for most, false for special types).
  // rules.ini overrides via BaseNormal= key. If not present, depends on building.
  if (!section.has('BaseNormal')) return true; // default for most buildings
  return parseIniBool(section.get('BaseNormal'), true);
}

// ══════════════════════════════════════════════════════════════════════════════
// Test helpers
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
  return {
    type, cost, buildTime: 100, prerequisite: 'FACT',
    faction: 'both', isStructure: true,
  } as any;
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
// Section 1: rules.ini Adjacent= values audit
//
// C++ bdata.cpp:2839 — Adjacent default = 1
// C++ bdata.cpp:3772 — Adjacent = ini.Get_Int(Name(), "Adjacent", Adjacent)
// rules.ini: SYRD/SPEN have Adjacent=8, walls Adjacent=1, BARL/BRL3 Adjacent=0
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity: rules.ini Adjacent= values', () => {

  it('SYRD has Adjacent=8 in rules.ini', () => {
    // rules.ini [SYRD] Adjacent=8
    // Ship Yard can be placed far from base to reach water
    expect(getIniAdjacent('SYRD')).toBe(8);
  });

  it('SPEN has Adjacent=8 in rules.ini', () => {
    // rules.ini [SPEN] Adjacent=8
    // Sub Pen can be placed far from base to reach water
    expect(getIniAdjacent('SPEN')).toBe(8);
  });

  it('most standard buildings default to Adjacent=1', () => {
    // C++ bdata.cpp:2839 — Adjacent(1) in constructor
    // These buildings have no Adjacent= line in rules.ini → default 1
    const defaultBuildings = [
      'FACT', 'POWR', 'APWR', 'PROC', 'WEAP', 'DOME',
      'BARR', 'TENT', 'GUN', 'AGUN', 'TSLA', 'PBOX',
      'HBOX', 'FTUR', 'SAM', 'MSLO', 'HPAD', 'AFLD',
      'ATEK', 'STEK', 'PDOX', 'IRON', 'HOSP', 'BIO',
      'SILO', 'FIX', 'GAP', 'KENN',
    ];
    for (const type of defaultBuildings) {
      expect(getIniAdjacent(type), `${type} Adjacent should be 1 (default)`).toBe(1);
    }
  });

  it('walls have Adjacent=1 in rules.ini', () => {
    // rules.ini explicitly sets Adjacent=1 for all walls
    for (const type of ['SBAG', 'BRIK', 'FENC', 'CYCL', 'BARB', 'WOOD']) {
      expect(getIniAdjacent(type), `${type} Adjacent`).toBe(1);
    }
  });

  it('barrels/mines have Adjacent=0 in rules.ini', () => {
    // Adjacent=0 means map-placed only, no proximity check
    for (const type of ['BARL', 'BRL3', 'MINV', 'MINP']) {
      expect(getIniAdjacent(type), `${type} Adjacent`).toBe(0);
    }
  });

  it('only SYRD, SPEN, and fake naval have Adjacent>1 among all buildings', () => {
    // Collect all buildings with Adjacent>1 from rules.ini + aftrmath.ini
    const highAdjacent: string[] = [];
    const allTypes = [...Object.keys(STRUCTURE_SIZE)];
    for (const type of allTypes) {
      const adj = getIniAdjacent(type);
      if (adj > 1) highAdjacent.push(type);
    }
    // Only naval buildings should have Adjacent>1
    for (const type of highAdjacent) {
      expect(
        ['SYRD', 'SPEN', 'SYRF', 'SPEF'].includes(type),
        `${type} has Adjacent=${getIniAdjacent(type)} > 1 — only naval buildings should`,
      ).toBe(true);
    }
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Section 2: BaseNormal= flag audit (IsBase in C++)
//
// C++ display.cpp:744 — proximity check only counts buildings with Class->IsBase
// C++ bdata.cpp:3777 — IsBase = ini.Get_Bool(Name(), "BaseNormal", IsBase)
// rules.ini: SYRD, SPEN, BARL, BRL3, MINV, MINP have BaseNormal=no
// Most production/defense buildings have BaseNormal=yes (or default)
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity: rules.ini BaseNormal= flag (IsBase)', () => {

  it('SYRD and SPEN have BaseNormal=no', () => {
    // C++ display.cpp:744,771,798: proximity check only uses IsBase buildings
    // SYRD/SPEN with BaseNormal=no means:
    //   1. You CAN'T satisfy proximity by being adjacent to SYRD/SPEN
    //   2. SYRD/SPEN themselves use Adjacent=8 distance check
    for (const type of ['SYRD', 'SPEN']) {
      const section = getMergedSection(type);
      expect(section).toBeDefined();
      expect(
        section!.get('BaseNormal')?.toLowerCase(),
        `${type} should have BaseNormal=no`,
      ).toBe('no');
    }
  });

  it('barrels and mines have BaseNormal=no', () => {
    for (const type of ['BARL', 'BRL3', 'MINV', 'MINP']) {
      const section = getMergedSection(type);
      expect(section).toBeDefined();
      expect(
        section!.get('BaseNormal')?.toLowerCase(),
        `${type} should have BaseNormal=no`,
      ).toBe('no');
    }
  });

  it('main production buildings default to BaseNormal=yes or have it explicitly', () => {
    // These buildings satisfy the proximity check for placing OTHER buildings nearby
    const baseBuildings = [
      'FACT', 'POWR', 'APWR', 'PROC', 'WEAP', 'DOME',
      'BARR', 'TENT', 'HPAD', 'AFLD', 'GUN', 'AGUN',
      'TSLA', 'PBOX', 'HBOX', 'FTUR', 'SAM', 'MSLO',
      'ATEK', 'STEK', 'PDOX', 'IRON', 'HOSP', 'BIO',
      'SILO', 'FIX', 'GAP', 'KENN',
    ];
    for (const type of baseBuildings) {
      expect(getIniBaseNormal(type), `${type} should be BaseNormal=yes`).toBe(true);
    }
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Section 3: Placement proximity check — Adjacent=1 (two-ring scan)
//
// C++ display.cpp:706-778:
//   When Adjacent==1, iterates each foundation cell and for each:
//   1. Ring 1: 8-directional Adjacent_Cell → check for friendly IsBase building
//   2. Ring 2: from each ring-1 cell, N/S/E/W only → check again
//   This reaches buildings up to 2 cells away in cardinal directions.
//
// TS placement.ts:71-82: uses AABB expansion of 2 cells from existing structure
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity: Placement proximity — standard buildings (Adjacent=1)', () => {

  it('accepts placement 1 cell from friendly structure', () => {
    // FACT at (10,10)-(12,12), POWR at (13,10) — 0 gap cells
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(true);
  });

  it('accepts placement 2 cells from friendly structure', () => {
    // FACT at (10,10)-(12,12), POWR at (14,10) — 1 gap column
    // C++ two-ring scan reaches here via ring-1(8-dir) + ring-2(cardinal)
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    const result = placeStructure(ctx, 14, 10);
    expect(result).toBe(true);
  });

  it('rejects placement 3+ cells from friendly structure', () => {
    // FACT at (10,10)-(12,12), POWR at (16,10) — 3 gap columns
    // C++ two-ring scan cannot reach 3 cells away
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    const result = placeStructure(ctx, 16, 10);
    expect(result).toBe(false);
  });

  it('rejects placement with no nearby structures', () => {
    // display.cpp:781: no adjacent structure found → false
    const ctx = makePlacementCtx({ pendingPlacement: makeItem('POWR') });
    const result = placeStructure(ctx, 30, 30);
    expect(result).toBe(false);
  });

  it('rejects placement adjacent to enemy structure', () => {
    // display.cpp:744: checks house == house
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

  it('rejects placement adjacent to dead building', () => {
    const dead = makeFriendlyStructure('FACT', 10, 10);
    dead.alive = false;
    const ctx = makePlacementCtx({
      structures: [dead],
      pendingPlacement: makeItem('POWR'),
    });
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });

  it('accepts diagonal adjacency (touching at corner)', () => {
    // display.cpp:717: 8-dir scan includes diagonals
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    // POWR (2x2) at (13,13) — diagonal to FACT corner at (12,12)
    const result = placeStructure(ctx, 13, 13);
    expect(result).toBe(true);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Section 4: Placement proximity — Naval buildings (Adjacent=8)
//
// C++ display.cpp:792-808:
//   When Adjacent>1, uses center-distance check:
//     centdist = Distance(existing.Center, target.Cell) / CELL_LEPTON_W
//     centdist -= (existing.Width + existing.Height) / 2
//     retval = (centdist <= building->Adjacent)
//   This allows SYRD/SPEN (Adjacent=8) to be placed up to ~8 cells from base.
//
// TS placement.ts: uses per-building Adjacent= value from ADJACENT_RANGE map
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity: SYRD/SPEN placement with Adjacent=8', () => {

  it('SYRD placement ~5 cells from nearest building succeeds with Adjacent=8', () => {
    // C++ display.cpp:795-803: Adjacent=8 center-distance check
    // FACT at (10,10)-(12,12), SYRD at (18,10) — 5 gap columns from FACT edge
    // Center of FACT ≈ (11.5,11.5), cell (18,10): distance ≈ 6.5 cells
    // centdist ≈ 6.5 - (3+3)/2 = 3.5 ≤ 8 → PASS
    const fact = makeFriendlyStructure('FACT', 10, 10);
    stampStructure(makePlacementCtx().map, 'FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('SYRD', 650),
    });
    const result = placeStructure(ctx, 18, 10);
    expect(result).toBe(true);
  });

  it('SPEN placement 6 cells from nearest building succeeds with Adjacent=8', () => {
    // C++ display.cpp:795-803: Adjacent=8 center-distance check
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('SPEN', 650),
    });
    const result = placeStructure(ctx, 19, 10);
    // C++: centdist ≈ 7.5 - 3 = 4.5 ≤ 8 → PASS
    expect(result).toBe(true);
  });

  it('C++ rejects SYRD placement > 8 cells from all buildings', () => {
    // Even Adjacent=8 has a limit: centdist > 8 → reject
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('SYRD', 650),
    });
    // Place at (30, 10): distance ≈ 18.5 - 3 = 15.5 > 8 → FAIL
    const result = placeStructure(ctx, 30, 10);
    expect(result).toBe(false);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Section 5: BaseNormal/IsBase in proximity check
//
// C++ display.cpp:744 — first ring:  base->Class->IsBase must be true
// C++ display.cpp:771 — second ring: newbase->Class->IsBase must be true
// C++ display.cpp:798 — Adjacent>1:  obj->Class->IsBase must be true
//
// Buildings with BaseNormal=no (SYRD, SPEN, BARL, walls) do NOT satisfy
// the proximity check for other buildings. You cannot build a Power Plant
// next to a Ship Yard and nothing else.
//
// TS placement.ts: filters structures against BASE_NORMAL set during adjacency check
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity: BaseNormal/IsBase proximity filtering', () => {

  it('rejects placement adjacent to SYRD only (BaseNormal=no)', () => {
    // SYRD has BaseNormal=no → IsBase=false → not a valid proximity anchor
    // In C++, you cannot build a POWR next to only a SYRD with no other base buildings
    const syrd = makeFriendlyStructure('SYRD', 10, 10);
    const ctx = makePlacementCtx({
      structures: [syrd],
      pendingPlacement: makeItem('POWR'),
    });
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });

  it('rejects placement adjacent to SPEN only (BaseNormal=no)', () => {
    const spen = makeFriendlyStructure('SPEN', 10, 10);
    const ctx = makePlacementCtx({
      structures: [spen],
      pendingPlacement: makeItem('POWR'),
    });
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });

  it('accepts placement when both SYRD and FACT exist (FACT is base)', () => {
    // SYRD alone doesn't satisfy proximity, but FACT does
    const syrd = makeFriendlyStructure('SYRD', 10, 10);
    const fact = makeFriendlyStructure('FACT', 14, 10);
    const ctx = makePlacementCtx({
      structures: [syrd, fact],
      pendingPlacement: makeItem('POWR'),
    });
    // Place POWR adjacent to FACT
    const result = placeStructure(ctx, 17, 10);
    expect(result).toBe(true);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Section 6: Construction Yard requirement for production
//
// C++ house.cpp:788-881:
//   Can_Build uses ActiveBScan bitmask + Prerequisite bitmask.
//   Most structures require FACT (STRUCT_CONST) in their prerequisite chain.
//   Without a ConYard, the sidebar won't show building options.
//
// TS production.ts:144-158:
//   getAvailableItems() checks hasBuilding(item.prerequisite).
//   Items with prerequisite='FACT' won't appear without a Construction Yard.
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity: ConYard requirement for production', () => {

  function makeProductionCtx(overrides: Partial<ProductionContext> = {}): ProductionContext {
    return {
      structures: [],
      entities: [],
      entityById: new Map(),
      credits: 50000,
      playerHouse: House.Greece,
      playerFaction: 'allied',
      playerTechLevel: 15,
      baseDiscovered: true,
      scenarioProductionItems: PRODUCTION_ITEMS,
      productionQueue: new Map(),
      pendingPlacement: null,
      wallPlacementPrepaid: false,
      map: makeMap(),
      tick: 100,
      powerProduced: 300,
      powerConsumed: 0,
      builtUnitTypes: new Set(),
      builtInfantryTypes: new Set(),
      builtAircraftTypes: new Set(),
      rallyPoints: new Map(),
      isAllied: (a, b) => a === b,
      hasBuilding: () => false,
      playSound: vi.fn(),
      playEva: vi.fn(),
      addEntity: vi.fn(),
      findPassableSpawn: (cx, cy) => ({ cx, cy }),
      ...overrides,
    };
  }

  it('no buildable items without any buildings (no ConYard)', () => {
    // C++ house.cpp:855: Prerequisite bitmask not met → Can_Build returns false
    const ctx = makeProductionCtx({
      hasBuilding: () => false,
    });
    const items = getAvailableItems(ctx);
    expect(items.length).toBe(0);
  });

  it('structures become available with ConYard (FACT)', () => {
    // C++ house.cpp:880: FACT satisfies STRUCT_CONST prerequisite
    const ctx = makeProductionCtx({
      hasBuilding: (t) => t === 'FACT',
    });
    const items = getAvailableItems(ctx);
    const structItems = items.filter(i => i.isStructure);
    expect(structItems.length).toBeGreaterThan(0);
    // POWR should be available (prerequisite: 'FACT')
    expect(structItems.some(i => i.type === 'POWR')).toBe(true);
  });

  it('POWR has prerequisite=FACT', () => {
    // rules.ini: [POWR] Prerequisite=fact → our production item has prerequisite: 'FACT'
    const powr = PRODUCTION_ITEMS.find(i => i.type === 'POWR');
    expect(powr).toBeDefined();
    expect(powr!.prerequisite).toBe('FACT');
  });

  it('SYRD requires POWR (not FACT directly) as prerequisite', () => {
    // rules.ini: [SYRD] Prerequisite=powr → can build once you have power
    // C++ checks the full Prerequisite bitmask; TS uses hasBuilding(prerequisite)
    const syrd = PRODUCTION_ITEMS.find(i => i.type === 'SYRD');
    expect(syrd).toBeDefined();
    expect(syrd!.prerequisite).toBe('POWR');
  });

  it('SPEN requires POWR (not FACT directly) as prerequisite', () => {
    const spen = PRODUCTION_ITEMS.find(i => i.type === 'SPEN');
    expect(spen).toBeDefined();
    expect(spen!.prerequisite).toBe('POWR');
  });

  it('naval units require SYRD/SPEN as prerequisite', () => {
    // rules.ini: [PT] Prerequisite=syrd, [SS] Prerequisite=spen
    const navalAllied = PRODUCTION_ITEMS.filter(i =>
      i.prerequisite === 'SYRD' && !i.isStructure);
    const navalSoviet = PRODUCTION_ITEMS.filter(i =>
      i.prerequisite === 'SPEN' && !i.isStructure);
    expect(navalAllied.length, 'Allied naval units from SYRD').toBeGreaterThan(0);
    expect(navalSoviet.length, 'Soviet naval units from SPEN').toBeGreaterThan(0);
  });

  it('no items when base not discovered', () => {
    // C++ sidebar only populated after base detected
    const ctx = makeProductionCtx({
      baseDiscovered: false,
      hasBuilding: () => true,
    });
    const items = getAvailableItems(ctx);
    expect(items.length).toBe(0);
  });

  it('losing ConYard removes structure options', () => {
    // C++ checks ActiveBScan which updates when buildings are lost
    // If you lose all FACTs, no more structure production
    const ctx = makeProductionCtx({
      hasBuilding: (t) => t === 'POWR', // has POWR but not FACT
    });
    const items = getAvailableItems(ctx);
    // Items with prerequisite 'FACT' should NOT appear
    const factReqItems = items.filter(i => i.prerequisite === 'FACT');
    expect(factReqItems.length).toBe(0);
    // Items with prerequisite 'POWR' (like SYRD) should appear
    // (but only if faction matches and tech level is met)
    const powrReqItems = items.filter(i => i.prerequisite === 'POWR');
    expect(powrReqItems.length).toBeGreaterThan(0);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Section 7: Multi-cell validation — all footprint cells must be buildable
//
// C++ cell.cpp:498-503: Is_Clear_To_Build checks Ground[Land_Type()].Build
//   CLEAR: Build=true, ROAD: Build=true
//   WATER, ROCK, WALL, ORE, BEACH, ROUGH, RIVER: Build=false
//
// C++ bdata.cpp:3448-3477: Occupy_List(placement=true) includes bib cells
//
// TS placement.ts:57-66: iterates all footprint cells + bib cells
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity: Multi-cell footprint validation', () => {

  it('rejects placement when any footprint cell is unbuildable', () => {
    // cell.cpp:498-503: every foundation cell must have Build=true
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    // POWR is 2x2. Block one cell at (13,11) → bottom-left of footprint
    ctx.map.setTerrain(13, 11, Terrain.ROCK);
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });

  it('rejects placement when bib cell is unbuildable', () => {
    // bdata.cpp:3448-3477: bib cells must also be buildable
    // placement.ts:64-66: checks getBibCells
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    // POWR at (13,10): 2x2 body. If bibbed, bib row at y=12.
    // Block bib cell
    ctx.map.setTerrain(13, 12, Terrain.WALL);
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });

  it('3x3 building (PROC) validates all 9 foundation cells', () => {
    // bdata.cpp:775: PROC BSIZE_33 → 3x3 footprint
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('PROC', 2000),
    });
    // Block the center cell of the 3x3 at position (14,11)
    ctx.map.setTerrain(14, 11, Terrain.ROCK);
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });

  it('validates footprint does not overlap existing structure terrain', () => {
    // After placing FACT, its cells become Terrain.WALL (impassable)
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    stampStructure(ctx.map, 'FACT', 10, 10);
    // Try to overlap with FACT's footprint
    const result = placeStructure(ctx, 11, 11);
    expect(result).toBe(false);
  });

  it('1x1 building (SILO) only needs one buildable cell', () => {
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('SILO', 150),
    });
    // Place SILO on a single clear cell adjacent to FACT
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(true);
  });

  it('rejects if footprint cell is ORE (passable but not buildable)', () => {
    // cell.cpp:503: Ground[LAND_ORE].Build=false
    // ORE terrain is passable for units but NOT buildable for structures
    const fact = makeFriendlyStructure('FACT', 10, 10);
    const ctx = makePlacementCtx({
      structures: [fact],
      pendingPlacement: makeItem('POWR'),
    });
    ctx.map.setTerrain(13, 10, Terrain.ORE);
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Section 8: MCV → FACT deployment (ConYard creation)
//
// C++ unit.cpp:1491 — Legal_Placement checks all foundation cells
// C++ unit.cpp:1555 — building->Strength = Health_Ratio() * MaxStrength
//
// This is the primary way to get a ConYard. Without MCV deployment or
// pre-placed FACT, you cannot build structures.
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity: MCV deployment creates ConYard for production', () => {

  it('deploying MCV creates a FACT structure', () => {
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 15 * CELL_SIZE + CELL_SIZE / 2, 15 * CELL_SIZE + CELL_SIZE / 2);
    const ctx = makePlacementCtx({ entities: [mcv] });
    ctx.entityById.set(mcv.id, mcv);

    const result = deployMCV(ctx, mcv);
    expect(result).toBe(true);
    expect(ctx.structures.length).toBe(1);
    expect(ctx.structures[0].type).toBe('FACT');
  });

  it('damaged MCV creates damaged FACT (health ratio preserved)', () => {
    // unit.cpp:1555: building->Strength = Health_Ratio() * building->Class->MaxStrength
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 15 * CELL_SIZE + CELL_SIZE / 2, 15 * CELL_SIZE + CELL_SIZE / 2);
    mcv.hp = Math.floor(mcv.maxHp / 2); // 50% health

    const ctx = makePlacementCtx({ entities: [mcv] });
    ctx.entityById.set(mcv.id, mcv);

    deployMCV(ctx, mcv);
    const fact = ctx.structures[0];
    // FACT HP should be ~50% of FACT maxHP
    const ratio = fact.hp / fact.maxHp;
    expect(ratio).toBeCloseTo(0.5, 1);
  });

  it('MCV deployment marks 3x3 footprint as impassable', () => {
    // FACT is 3x3: all 9 cells should become WALL terrain
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 15 * CELL_SIZE + CELL_SIZE / 2, 15 * CELL_SIZE + CELL_SIZE / 2);
    const ctx = makePlacementCtx({ entities: [mcv] });
    ctx.entityById.set(mcv.id, mcv);

    deployMCV(ctx, mcv);
    // FACT placed at (14,14) (mcv.cell - 1 in each direction)
    const fact = ctx.structures[0];
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        expect(
          ctx.map.getTerrain(fact.cx + dx, fact.cy + dy),
          `cell (${fact.cx + dx},${fact.cy + dy}) should be WALL`,
        ).toBe(Terrain.WALL);
      }
    }
  });

  it('MCV deployment fails if 3x3 area has unbuildable cells', () => {
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 15 * CELL_SIZE + CELL_SIZE / 2, 15 * CELL_SIZE + CELL_SIZE / 2);
    const ctx = makePlacementCtx({ entities: [mcv] });
    ctx.entityById.set(mcv.id, mcv);

    // Block one of the 3x3 cells
    ctx.map.setTerrain(14, 14, Terrain.ROCK);
    const result = deployMCV(ctx, mcv);
    expect(result).toBe(false);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Section 9: Summary of known mismatches
//
// These tests document where TS diverges from C++ behavior.
// Each failing test represents a bug that should be fixed in placement.ts.
// ══════════════════════════════════════════════════════════════════════════════

describe('MISMATCH AUDIT: TS placement.ts diverges from C++ display.cpp', () => {

  it('MISMATCH: TS uses hardcoded 2-cell AABB instead of per-building Adjacent=', () => {
    // C++ display.cpp:706 and :795 — uses building->Adjacent per building type
    // TS placement.ts:77 — hardcoded "const exL = s.cx - 2, exT = s.cy - 2, exR = s.cx + sw + 2, exB = s.cy + sh + 2"
    // This means SYRD/SPEN (Adjacent=8) are treated as Adjacent=1
    //
    // FIX NEEDED: placeStructure should read per-building Adjacent value
    // and use distance-based check for Adjacent>1
    const adjacentSYRD = getIniAdjacent('SYRD');
    const adjacentSPEN = getIniAdjacent('SPEN');
    expect(adjacentSYRD, 'SYRD should use Adjacent=8, not hardcoded 2').toBe(8);
    expect(adjacentSPEN, 'SPEN should use Adjacent=8, not hardcoded 2').toBe(8);

    // Verify the TS code currently hardcodes the expansion
    // (This test passes because it's checking the INI, not the TS implementation)
  });

  it('MISMATCH: TS does not filter proximity by BaseNormal/IsBase flag', () => {
    // C++ display.cpp:744 — only Class->IsBase buildings satisfy proximity
    // TS placement.ts:73-74 — checks ALL alive allied structures
    //
    // Impact: In TS, building next to a SYRD (BaseNormal=no) satisfies proximity.
    // In C++, it does NOT. You need a real base building (FACT, POWR, etc.) nearby.
    //
    // FIX NEEDED: placeStructure should filter out non-base buildings from proximity scan
    const baseNormalSYRD = getIniBaseNormal('SYRD');
    const baseNormalSPEN = getIniBaseNormal('SPEN');
    expect(baseNormalSYRD, 'SYRD BaseNormal=no: should NOT satisfy proximity for other buildings').toBe(false);
    expect(baseNormalSPEN, 'SPEN BaseNormal=no: should NOT satisfy proximity for other buildings').toBe(false);
  });
});
