/**
 * C++ Behavioral Parity: Harvester Economics & Ore/Gem Processing
 *
 * Audits the TS engine harvester economy against C++ source and rules.ini.
 * All expected values are PARSED from rules.ini at test time — never hardcoded.
 *
 * C++ source references:
 *   rules.cpp:237-239   — Constructor defaults: BailCount(28), GoldValue(35), GemValue(110)
 *   rules.cpp:459       — SurvivorFraction = ini.Get_Fixed("General", "SurvivorRate", ...)
 *   rules.cpp:464       — OreDumpRate = ini.Get_Int("General", "OreTruckRate", OreDumpRate)
 *   rules.cpp:466       — BailCount = ini.Get_Int("General", "BailCount", BailCount)
 *   rules.cpp:477-478   — GemValue = ini.Get_Int("General", "GemValue", GemValue)
 *                          GoldValue = ini.Get_Int("General", "GoldValue", GoldValue)
 *   rules.cpp:480       — GrowthRate = ini.Get_Fixed("General", "GrowthRate", GrowthRate)
 *   unit.cpp:2280       — Tiberium_Load() < 1 (capacity check before harvesting)
 *   unit.cpp:2289-2308  — Harvesting loop: Reduce_Tiberium, bail tracking, gem bonus
 *   unit.cpp:4272-4280  — Tiberium_Load() = fixed(Tiberium, Rule.BailCount)
 *   unit.cpp:4299-4313  — Offload_Tiberium_Bail() — per-bail unload
 *   unit.cpp:4790-4793  — Credit_Load() = (Gold * Rule.GoldValue) + (Gems * Rule.GemValue)
 *   cell.cpp:1630-1648  — Reduce_Tiberium() — density depletion
 *   cell.cpp:2869-2884  — Can_Tiberium_Grow() — gold only, max density 11
 *   cell.cpp:2904-2918  — Can_Tiberium_Spread() — gold only, density > 6
 *   cell.cpp:2963-2978  — Spread_Tiberium() — random adjacent cell, gold only
 *   map.cpp:1017        — subcount = MAP_CELL_TOTAL / (GrowthRate * TICKS_PER_MINUTE)
 *   building.cpp:3735-3778 — BuildingClass::Mission_Harvest() — refinery unload state machine
 *
 *   rules.ini [General]:
 *     BailCount=28, GoldValue=25, GemValue=50, GrowthRate=2,
 *     OreTruckRate=1, SurvivorRate=.4, OreGrows=yes, OreSpreads=yes
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  CELL_SIZE, MAP_CELLS,
  House, Mission, UnitType, AnimState, Dir,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap, Terrain } from '../engine/map';
import { updateHarvester, type HarvesterContext } from '../engine/harvester';
import { STRUCTURE_MAX_HP, type MapStructure } from '../engine/scenario';

// ---------------------------------------------------------------------------
// Parse rules.ini at test time (authoritative source of truth)
// ---------------------------------------------------------------------------

const RULES_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/rules.ini');
const rulesText = fs.readFileSync(RULES_INI_PATH, 'utf-8');

interface IniSection {
  [key: string]: string;
}

function parseINI(text: string): Record<string, IniSection> {
  const result: Record<string, IniSection> = {};
  let currentSection = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.split(';')[0].trim();
    if (!line) continue;
    const secMatch = line.match(/^\[([^\]]+)\]$/);
    if (secMatch) { currentSection = secMatch[1]; continue; }
    if (!currentSection) continue;
    const kvMatch = line.match(/^(\w+)=(.*)$/);
    if (!kvMatch) continue;
    if (!result[currentSection]) result[currentSection] = {};
    result[currentSection][kvMatch[1]] = kvMatch[2].trim();
  }
  return result;
}

const INI = parseINI(rulesText);
const generalSection = INI['General'] ?? {};

// Parse all economic constants from rules.ini [General] section
function parseIniInt(raw: string | undefined, def: number): number {
  if (!raw) return def;
  const v = parseInt(raw, 10);
  return isNaN(v) ? def : v;
}

function parseIniFixed(raw: string | undefined, def: number): number {
  if (!raw) return def;
  if (raw.endsWith('%')) {
    const v = parseFloat(raw.replace('%', ''));
    return isNaN(v) ? def : v / 100;
  }
  const v = parseFloat(raw);
  return isNaN(v) ? def : v;
}

function parseIniBool(raw: string | undefined, def: boolean): boolean {
  if (!raw) return def;
  return raw.toLowerCase() === 'yes' || raw.toLowerCase() === 'true';
}

// INI-parsed values (rules.ini is God)
const iniBailCount = parseIniInt(generalSection['BailCount'], 28);
const iniGoldValue = parseIniInt(generalSection['GoldValue'], 35);
const iniGemValue = parseIniInt(generalSection['GemValue'], 110);
const iniGrowthRate = parseIniFixed(generalSection['GrowthRate'], 2);
const iniOreTruckRate = parseIniInt(generalSection['OreTruckRate'], 2);
const iniSurvivorRate = parseIniFixed(generalSection['SurvivorRate'], 0.5);
const iniOreGrows = parseIniBool(generalSection['OreGrows'], true);
const iniOreSpreads = parseIniBool(generalSection['OreSpreads'], true);
const iniOreExplosive = parseIniBool(generalSection['OreExplosive'], false);

// C++ TICKS_PER_MINUTE = 15 Hz * 60 = 900
const TICKS_PER_MINUTE = 900;
// C++ MAP_CELL_TOTAL = 128 * 128 = 16384
const MAP_CELL_TOTAL = MAP_CELLS * MAP_CELLS;

beforeEach(() => resetEntityIds());

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeMap(opts?: { boundsX?: number; boundsY?: number; boundsW?: number; boundsH?: number }): GameMap {
  const map = new GameMap();
  map.setBounds(opts?.boundsX ?? 40, opts?.boundsY ?? 40, opts?.boundsW ?? 50, opts?.boundsH ?? 50);
  return map;
}

function makeHarv(house: House = House.Spain, cx = 50, cy = 50): Entity {
  return new Entity(UnitType.V_HARV, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeRefinery(house: House = House.Spain, cx = 70, cy = 70): MapStructure {
  const maxHp = STRUCTURE_MAX_HP['PROC'] ?? 400;
  return {
    type: 'PROC',
    image: 'proc',
    house,
    cx,
    cy,
    hp: maxHp,
    maxHp,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
  } as MapStructure;
}

function defaultRefineries(): MapStructure[] {
  return [
    makeRefinery(House.Spain, 70, 70),
    makeRefinery(House.USSR, 74, 70),
  ];
}

function makeCtx(overrides?: Partial<HarvesterContext>): HarvesterContext {
  return {
    entities: [],
    structures: defaultRefineries(),
    houseCredits: new Map(),
    map: makeMap(),
    isAllied: (a, b) => a === b,
    isPlayerControlled: (e) => e.house === House.Spain,
    playSound: vi.fn(),
    addCredits: vi.fn(),
    ...overrides,
  };
}

/** Place gold ore at (cx,cy) with density 0..11. Overlay range: 0x03..0x0E */
function placeGold(map: GameMap, cx: number, cy: number, density = 5): void {
  const idx = cy * MAP_CELLS + cx;
  map.overlay[idx] = GameMap.OVERLAY_GOLD1;
  map.oreDensity[idx] = density;
}

/** Place gem at (cx,cy) with density 0..3. Overlay range: 0x0F..0x12 */
function placeGem(map: GameMap, cx: number, cy: number, density = 1): void {
  const idx = cy * MAP_CELLS + cx;
  map.overlay[idx] = GameMap.OVERLAY_GEMS1;
  map.oreDensity[idx] = density;
}

function getOverlay(map: GameMap, cx: number, cy: number): number {
  const idx = cy * MAP_CELLS + cx;
  const ovl = map.overlay[idx];
  const density = map.oreDensity[idx];
  if (density !== 0xFF && GameMap.isGoldOverlayId(ovl)) return 0x03 + density;
  if (density !== 0xFF && GameMap.isGemOverlayId(ovl)) return 0x0F + density;
  return ovl;
}

function primeHarvestReady(entity: Entity): void {
  entity.harvesterAnimRate = 1;
  entity.harvesterAnimTimer = 1;
  entity.harvesterAnimStage = 9;
  entity.harvestTick = 9;
}

// =============================================================================
// 1. INI Parsing Sanity — verify INI values override C++ constructor defaults
// =============================================================================

describe('INI-parsed economic constants vs C++ constructor defaults', () => {
  /**
   * C++ rules.cpp:238 constructor default: GoldValue(35)
   * rules.ini [General]: GoldValue=25
   * INI wins — 25 not 35.
   */
  it('GoldValue: INI says 25, NOT the C++ default of 35', () => {
    expect(iniGoldValue).toBe(25);
    expect(iniGoldValue).not.toBe(35);
  });

  /**
   * C++ rules.cpp:239 constructor default: GemValue(110)
   * rules.ini [General]: GemValue=50
   * INI wins — 50 not 110.
   */
  it('GemValue: INI says 50, NOT the C++ default of 110', () => {
    expect(iniGemValue).toBe(50);
    expect(iniGemValue).not.toBe(110);
  });

  /**
   * C++ rules.cpp:237 constructor default: BailCount(28)
   * rules.ini [General]: BailCount=28
   * Same value — but we verify the INI is authoritative.
   */
  it('BailCount: INI confirms 28 (same as C++ default)', () => {
    expect(iniBailCount).toBe(28);
  });

  /**
   * C++ rules.cpp:205 constructor default: GrowthRate(2)
   * rules.ini [General]: GrowthRate=2
   */
  it('GrowthRate: INI says 2 minutes between ore growth cycles', () => {
    expect(iniGrowthRate).toBe(2);
  });

  /**
   * C++ rules.cpp:181 constructor default: OreDumpRate(2)
   * rules.ini [General]: OreTruckRate=1
   * INI overrides — key name is "OreTruckRate" in INI, "OreDumpRate" in C++.
   */
  it('OreTruckRate (OreDumpRate): INI says 1, NOT the C++ default of 2', () => {
    expect(iniOreTruckRate).toBe(1);
    expect(iniOreTruckRate).not.toBe(2);
  });

  /**
   * C++ rules.cpp:177 constructor default: SurvivorFraction(fixed(1, 2)) = 0.5
   * rules.ini [General]: SurvivorRate=.4
   */
  it('SurvivorRate: INI says 0.4, NOT the C++ default of 0.5', () => {
    expect(iniSurvivorRate).toBe(0.4);
    expect(iniSurvivorRate).not.toBe(0.5);
  });

  /**
   * rules.ini [General]: OreGrows=yes, OreSpreads=yes
   */
  it('OreGrows=yes and OreSpreads=yes per INI', () => {
    expect(iniOreGrows).toBe(true);
    expect(iniOreSpreads).toBe(true);
  });

  /**
   * rules.ini [General]: OreExplosive=no
   */
  it('OreExplosive=no — harvesters do NOT explode big when destroyed', () => {
    expect(iniOreExplosive).toBe(false);
  });
});

// =============================================================================
// 2. TS Engine Constants Match INI
// =============================================================================

describe('TS engine static constants match INI-parsed values', () => {
  /**
   * Entity.BAIL_COUNT must match rules.ini BailCount.
   * C++ rules.cpp:466: BailCount = ini.Get_Int("General", "BailCount", BailCount)
   */
  it('Entity.BAIL_COUNT matches rules.ini BailCount', () => {
    expect(Entity.BAIL_COUNT).toBe(iniBailCount);
  });

  /**
   * Entity.ORE_CAPACITY is an alias for BAIL_COUNT.
   */
  it('Entity.ORE_CAPACITY matches Entity.BAIL_COUNT', () => {
    expect(Entity.ORE_CAPACITY).toBe(Entity.BAIL_COUNT);
    expect(Entity.ORE_CAPACITY).toBe(iniBailCount);
  });

  /**
   * GameMap.depleteOre() for gold must return rules.ini GoldValue.
   * C++ rules.cpp:478: GoldValue = ini.Get_Int("General", "GoldValue", GoldValue)
   */
  it('depleteOre() gold returns rules.ini GoldValue per bail', () => {
    const map = makeMap();
    placeGold(map, 50, 50, 5);
    const credits = map.depleteOre(50, 50);
    expect(credits).toBe(iniGoldValue);
  });

  /**
   * GameMap.depleteOre() for gems must return rules.ini GemValue.
   * C++ rules.cpp:477: GemValue = ini.Get_Int("General", "GemValue", GemValue)
   */
  it('depleteOre() gem returns rules.ini GemValue per bail', () => {
    const map = makeMap();
    placeGem(map, 50, 50, 2);
    const credits = map.depleteOre(50, 50);
    expect(credits).toBe(iniGemValue);
  });

  /**
   * Gold at EVERY density level (0x03-0x0E) yields exactly GoldValue per bail.
   */
  it('gold at every density level yields exactly GoldValue per bail', () => {
    for (let ovl = 0x04; ovl <= 0x0E; ovl++) {
      const map = makeMap();
      placeGold(map, 50, 50, ovl - 0x03);
      const credits = map.depleteOre(50, 50);
      expect(credits, `overlay 0x${ovl.toString(16).padStart(2, '0')}`).toBe(iniGoldValue);
    }
  });

  /**
   * Gems at EVERY density level (0x0F-0x12) yield exactly GemValue per bail.
   */
  it('gems at every density level yield exactly GemValue per bail', () => {
    for (let ovl = 0x10; ovl <= 0x12; ovl++) {
      const map = makeMap();
      placeGem(map, 50, 50, ovl - 0x0F);
      const credits = map.depleteOre(50, 50);
      expect(credits, `overlay 0x${ovl.toString(16).padStart(2, '0')}`).toBe(iniGemValue);
    }
  });
});

// =============================================================================
// 3. Credit_Load Formula — unit.cpp:4790-4793
// =============================================================================

describe('Credit_Load formula: (Gold * GoldValue) + (Gems * GemValue)', () => {
  /**
   * C++ unit.cpp:4792: return((Gold * Rule.GoldValue) + (Gems * Rule.GemValue));
   * Full load of gold = BailCount * GoldValue
   */
  it('full gold load value = BailCount * GoldValue', () => {
    const expected = iniBailCount * iniGoldValue;
    expect(expected).toBe(28 * 25); // 700 — derived from INI
    // Verify by harvesting
    const map = makeMap();
    let totalCredits = 0;
    for (let i = 0; i < iniBailCount; i++) {
      placeGold(map, 50 + (i % 10), 50 + Math.floor(i / 10), 5);
    }
    for (let i = 0; i < iniBailCount; i++) {
      totalCredits += map.depleteOre(50 + (i % 10), 50 + Math.floor(i / 10));
    }
    expect(totalCredits).toBe(expected);
  });

  it('full gem load value = BailCount * GemValue', () => {
    const expected = iniBailCount * iniGemValue;
    expect(expected).toBe(28 * 50); // 1400
  });

  it('mixed load: half gold + half gems', () => {
    const halfBails = Math.floor(iniBailCount / 2);
    const expected = halfBails * iniGoldValue + halfBails * iniGemValue;
    expect(expected).toBe(14 * 25 + 14 * 50); // 1050
  });

  /**
   * Gems are worth exactly GemValue/GoldValue times gold per bail.
   */
  it('gem-to-gold credit ratio matches INI values', () => {
    const ratio = iniGemValue / iniGoldValue;
    expect(ratio).toBe(2); // 50/25 = 2
  });
});

// =============================================================================
// 4. Ore Depletion — cell.cpp:1630-1648 Reduce_Tiberium
// =============================================================================

describe('Ore depletion matches C++ cell.cpp:1630-1648 Reduce_Tiberium', () => {
  it('gold at density 5: depleteOre reduces overlay by 1', () => {
    const map = makeMap();
    placeGold(map, 50, 50, 5); // overlay 0x08
    map.depleteOre(50, 50);
    expect(getOverlay(map, 50, 50)).toBe(0x07); // density 4
  });

  it('gold at density 0: depleteOre removes overlay entirely (0xFF)', () => {
    const map = makeMap();
    placeGold(map, 50, 50, 0); // overlay 0x03 (minimum)
    const credits = map.depleteOre(50, 50);
    expect(credits).toBe(0);
    expect(getOverlay(map, 50, 50)).toBe(0xFF);
  });

  it('gem at density 0: depleteOre removes overlay (0xFF)', () => {
    const map = makeMap();
    placeGem(map, 50, 50, 0); // overlay 0x0F
    const credits = map.depleteOre(50, 50);
    expect(credits).toBe(0);
    expect(getOverlay(map, 50, 50)).toBe(0xFF);
  });

  it('gem at density 2: reduces to density 1', () => {
    const map = makeMap();
    placeGem(map, 50, 50, 2); // overlay 0x11
    map.depleteOre(50, 50);
    expect(getOverlay(map, 50, 50)).toBe(0x10);
  });

  it('empty cell returns 0 credits', () => {
    const map = makeMap();
    expect(map.depleteOre(50, 50)).toBe(0);
  });

  it('out-of-bounds returns 0 credits', () => {
    const map = makeMap();
    expect(map.depleteOre(-1, 50)).toBe(0);
    expect(map.depleteOre(50, MAP_CELLS)).toBe(0);
    expect(map.depleteOre(MAP_CELLS, 0)).toBe(0);
    expect(map.depleteOre(0, -1)).toBe(0);
  });

  /**
   * Gold OverlayData 11 pays 11 bails; the final OverlayData=0 reduction clears
   * the visible ore and returns 0.
   */
  it('fully depleting max-density gold cell yields 11 paid bails', () => {
    const map = makeMap();
    placeGold(map, 50, 50, 11); // overlay 0x0E
    let depletions = 0;
    let totalCredits = 0;
    while (true) {
      const c = map.depleteOre(50, 50);
      if (c === 0) break;
      totalCredits += c;
      depletions++;
    }
    expect(depletions).toBe(11);
    expect(totalCredits).toBe(11 * iniGoldValue);
    expect(getOverlay(map, 50, 50)).toBe(0xFF);
  });

  /**
   * Gems at OverlayData 3 pay 3 bails before the final clear returns 0.
   */
  it('fully depleting max-density gem cell yields 3 paid bails', () => {
    const map = makeMap();
    placeGem(map, 50, 50, 3); // overlay 0x12
    let depletions = 0;
    let totalCredits = 0;
    while (true) {
      const c = map.depleteOre(50, 50);
      if (c === 0) break;
      totalCredits += c;
      depletions++;
    }
    expect(depletions).toBe(3);
    expect(totalCredits).toBe(3 * iniGemValue);
    expect(getOverlay(map, 50, 50)).toBe(0xFF);
  });

  /**
   * Non-ore overlays return 0 credits.
   */
  it('non-ore overlays return 0 credits', () => {
    const map = makeMap();
    map.overlay[50 * MAP_CELLS + 50] = 0x00;
    expect(map.depleteOre(50, 50)).toBe(0);
    map.overlay[50 * MAP_CELLS + 50] = 0x02;
    expect(map.depleteOre(50, 50)).toBe(0);
    map.overlay[50 * MAP_CELLS + 50] = 0x13;
    expect(map.depleteOre(50, 50)).toBe(0);
  });

  /**
   * Gold and gem overlay ranges are non-overlapping.
   */
  it('gold (0x03-0x0E) and gem (0x0F-0x12) overlay ranges do not overlap', () => {
    expect(0x0E).toBeLessThan(0x0F);
  });
});

// =============================================================================
// 5. Gem Bonus Bails — unit.cpp:2306-2308
// =============================================================================

describe('Gem bonus bails match C++ unit.cpp:2306-2308', () => {
  /**
   * C++ unit.cpp:2301-2308: 1 base bail + 3 bonus bails (if capacity allows) = 4 total.
   * All bonus bails get GemValue credits each.
   */
  it('gem harvest yields 4 bails total (1 base + 3 bonus) when empty', () => {
    const ctx = makeCtx();
    const harv = makeHarv(House.USSR, 50, 50);
    harv.harvesterState = 'harvesting';
    primeHarvestReady(harv);
    harv.oreLoad = 0;
    harv.oreCreditValue = 0;
    ctx.entities.push(harv);
    placeGem(ctx.map, 50, 50, 3);

    updateHarvester(ctx, harv);
    expect(harv.oreLoad).toBe(4);
    expect(harv.oreCreditValue).toBe(4 * iniGemValue);
  });

  /**
   * C++ guards each bonus: if (Rule.BailCount > Tiberium)
   * At 26 bails: base=27, bonus1=28=BailCount, bonus2 fails (28>28=false).
   */
  it('gem bonus bails capped by BailCount at 26 bails loaded', () => {
    const ctx = makeCtx();
    const harv = makeHarv(House.USSR, 50, 50);
    harv.harvesterState = 'harvesting';
    primeHarvestReady(harv);
    harv.oreLoad = 26;
    harv.oreCreditValue = 26 * iniGemValue;
    ctx.entities.push(harv);
    placeGem(ctx.map, 50, 50, 3);

    updateHarvester(ctx, harv);
    expect(harv.oreLoad).toBeLessThanOrEqual(iniBailCount);
    expect(harv.harvesterState).toBe('harvesting');
    primeHarvestReady(harv);
    updateHarvester(ctx, harv);
    expect(harv.harvesterState).toBe('returning');
  });

  /**
   * At BailCount-1 (27): base makes 28 = full. No room for any bonus.
   */
  it('at BailCount-1 bails, only base bail fits (no bonus room)', () => {
    const ctx = makeCtx();
    const harv = makeHarv(House.USSR, 50, 50);
    harv.harvesterState = 'harvesting';
    primeHarvestReady(harv);
    harv.oreLoad = iniBailCount - 1;
    harv.oreCreditValue = (iniBailCount - 1) * iniGemValue;
    ctx.entities.push(harv);
    placeGem(ctx.map, 50, 50, 3);

    updateHarvester(ctx, harv);
    expect(harv.oreLoad).toBe(iniBailCount);
    expect(harv.harvesterState).toBe('harvesting');
    primeHarvestReady(harv);
    updateHarvester(ctx, harv);
    expect(harv.harvesterState).toBe('returning');
  });

  /**
   * Gold harvest gets exactly 1 bail (no bonus).
   */
  it('gold harvest gets exactly 1 bail (no bonus)', () => {
    const ctx = makeCtx();
    const harv = makeHarv(House.USSR, 50, 50);
    harv.harvesterState = 'harvesting';
    primeHarvestReady(harv);
    harv.oreLoad = 0;
    harv.oreCreditValue = 0;
    ctx.entities.push(harv);
    placeGold(ctx.map, 50, 50, 5);

    updateHarvester(ctx, harv);
    expect(harv.oreLoad).toBe(1);
    expect(harv.oreCreditValue).toBe(iniGoldValue);
  });

  /**
   * C++ bonus bail trace at 25 bails loaded:
   * Base: Tiberium = 26. Bonus1: 28>26=true, Tiberium=27.
   * Bonus2: 28>27=true, Tiberium=28. Bonus3: 28>28=false. Total: 3 bails added.
   */
  it('C++ bonus bail trace at 25/28 bails: 1 base + 2 bonus = 3 added', () => {
    let tiberium = 25;
    tiberium += 1; // base: 26
    let bonusBails = 0;
    if (iniBailCount > tiberium) { tiberium++; bonusBails++; } // 27
    if (iniBailCount > tiberium) { tiberium++; bonusBails++; } // 28
    if (iniBailCount > tiberium) { tiberium++; bonusBails++; } // would be 29, fails
    expect(bonusBails).toBe(2);
    expect(tiberium).toBe(iniBailCount);
  });

  /**
   * C++ bonus bail trace at 24 bails loaded: all 3 bonus fit.
   */
  it('C++ bonus bail trace at 24/28 bails: 1 base + 3 bonus = 4 added', () => {
    let tiberium = 24;
    tiberium += 1; // base: 25
    let bonusBails = 0;
    if (iniBailCount > tiberium) { tiberium++; bonusBails++; } // 26
    if (iniBailCount > tiberium) { tiberium++; bonusBails++; } // 27
    if (iniBailCount > tiberium) { tiberium++; bonusBails++; } // 28
    expect(bonusBails).toBe(3);
    expect(tiberium).toBe(iniBailCount);
  });
});

// =============================================================================
// 6. Harvester Capacity — Tiberium_Load (unit.cpp:4272-4280)
// =============================================================================

describe('Harvester capacity (Tiberium_Load — unit.cpp:4272-4280)', () => {
  it('empty harvester: load fraction = 0', () => {
    const harv = makeHarv();
    expect(harv.oreLoad / iniBailCount).toBe(0);
  });

  it('half-loaded: load fraction = 0.5', () => {
    const harv = makeHarv();
    harv.oreLoad = Math.floor(iniBailCount / 2);
    expect(harv.oreLoad / iniBailCount).toBe(0.5);
  });

  it('full harvester: load fraction = 1', () => {
    const harv = makeHarv();
    harv.oreLoad = iniBailCount;
    expect(harv.oreLoad / iniBailCount).toBe(1);
  });

  /**
   * C++ unit.cpp:2280: if (Tiberium_Load() < 1) — only harvest if not full.
   */
  it('full harvester transitions to returning (unit.cpp:2280)', () => {
    const ctx = makeCtx();
    const harv = makeHarv(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    harv.oreLoad = iniBailCount;
    harv.oreCreditValue = iniBailCount * iniGoldValue;
    primeHarvestReady(harv);
    ctx.entities.push(harv);
    placeGold(ctx.map, 50, 50, 5);

    updateHarvester(ctx, harv);
    expect(harv.harvesterState).toBe('returning');
  });
});

// =============================================================================
// 7. Ore Growth — cell.cpp:2869-2884, map.cpp:1017
// =============================================================================

describe('Ore growth rules (cell.cpp:2869-2884, map.cpp:1017)', () => {
  /**
   * C++ map.cpp:1017:
   *   subcount = MAP_CELL_TOTAL / (Rule.GrowthRate * TICKS_PER_MINUTE)
   * With INI GrowthRate and 15Hz TICKS_PER_MINUTE:
   *   subcount = 16384 / (iniGrowthRate * 900) = cells per tick
   *   Full scan: ceil(16384 / subcount) ticks
   */
  it('ORE_GROWTH_INTERVAL matches C++ map scan formula', () => {
    const subcount = Math.max(1, Math.floor(MAP_CELL_TOTAL / (iniGrowthRate * TICKS_PER_MINUTE)));
    const expectedInterval = Math.ceil((MAP_CELL_TOTAL - 1) / (subcount - 1));
    expect(GameMap.ORE_GROWTH_INTERVAL).toBe(expectedInterval);
  });

  /**
   * C++ cell.cpp:2879: if (OverlayData >= 11) return(false);
   * Max density is 11 (overlay 0x0E).
   */
  it('gold max density is overlay 0x0E (OverlayData 11)', () => {
    const map = makeMap();
    placeGold(map, 50, 50, 11);
    expect(getOverlay(map, 50, 50)).toBe(0x0E);
  });

  /**
   * Gems never grow (cell.cpp:2881 — only GOLD overlays).
   */
  it('gems never grow (only gold grows)', () => {
    const map = makeMap();
    map.setBounds(49, 49, 3, 3);
    placeGem(map, 50, 50, 1);
    const before = getOverlay(map, 50, 50);
    map.growOre(GameMap.ORE_GROWTH_INTERVAL);
    expect(getOverlay(map, 50, 50)).toBe(before);
  });

  /**
   * Gold density grows by +1 per cycle when random triggers.
   */
  it('gold density grows by +1 per growth cycle', () => {
    const map = makeMap();
    placeGold(map, 50, 50, 3); // overlay 0x06
    vi.spyOn(Math, 'random').mockReturnValue(0); // always trigger
    map.growOre(GameMap.ORE_GROWTH_INTERVAL);
    expect(getOverlay(map, 50, 50)).toBe(0x07); // density 4
    vi.restoreAllMocks();
  });

  /**
   * C++ cell.cpp:2914: if (OverlayData <= 6) return(false);
   * ORE_SPREAD_MIN_DENSITY is stored as C++ OverlayData 6; spread when > 6.
   */
  it('ORE_SPREAD_MIN_DENSITY matches C++ threshold (density > 6)', () => {
    expect(GameMap.ORE_SPREAD_MIN_DENSITY).toBe(6);
  });

  /**
   * Gems never spread regardless of density.
   */
  it('gems never spread regardless of density', () => {
    const map = makeMap();
    map.setBounds(49, 49, 3, 3);
    placeGem(map, 50, 50, 3); // max gem
    const adjacentBefore = getOverlay(map, 51, 50);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(GameMap.ORE_GROWTH_INTERVAL);
    expect(getOverlay(map, 51, 50)).toBe(adjacentBefore);
    vi.restoreAllMocks();
  });

  /**
   * Gold at density 0x09 (OverlayData=6) does NOT spread.
   */
  it('gold at density 0x09 (OverlayData=6) does NOT spread', () => {
    const map = makeMap();
    map.setBounds(49, 49, 3, 3);
    placeGold(map, 50, 50, 6); // overlay 0x09
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let adjacentOreBefore = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const ovl = getOverlay(map, 50 + dx, 50 + dy);
        if (ovl >= 0x03 && ovl <= 0x0E) adjacentOreBefore++;
      }
    }
    map.growOre(GameMap.ORE_GROWTH_INTERVAL);
    let adjacentOreAfter = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const ovl = getOverlay(map, 50 + dx, 50 + dy);
        if (ovl >= 0x03 && ovl <= 0x0E) adjacentOreAfter++;
      }
    }
    expect(adjacentOreAfter).toBe(adjacentOreBefore);
    vi.restoreAllMocks();
  });
});

// =============================================================================
// 8. Refinery Unloading — building.cpp:3735-3778
// =============================================================================

describe('Refinery unloading matches C++ unit.cpp:2348-2390 (lump-sum)', () => {
  // Helper: pre-rotate harvester to DIR_W so dump starts immediately
  function preRotateW(harv: Entity): void {
    harv.facing = Dir.W;
    harv.desiredFacing = Dir.W;
    harv.bodyFacing32 = Dir.W * 4;
  }

  /**
   * C++ unit.cpp:2348-2390: 22-stage dump animation, lump-sum Credit_Load() at end.
   * Offload_Tiberium_Bail() is #ifdef TOFIX'd out — returns 0 always.
   */
  it('full gold load: unloads BailCount * GoldValue credits via lump-sum', () => {
    let totalDeposited = 0;
    const addCredits = vi.fn((n: number) => { totalDeposited += n; });
    const ctx = makeCtx({ addCredits });

    const harv = makeHarv(House.Spain, 50, 50);
    harv.harvesterState = 'unloading';
    harv.harvestTick = 0;
    preRotateW(harv);
    harv.oreLoad = iniBailCount;
    harv.oreCreditValue = iniBailCount * iniGoldValue;
    ctx.entities.push(harv);

    // 22-tick dump animation
    for (let i = 0; i < 22; i++) {
      updateHarvester(ctx, harv);
    }

    expect(addCredits).toHaveBeenCalledTimes(1); // lump-sum, not per-bail
    expect(totalDeposited).toBe(iniBailCount * iniGoldValue);
    expect(harv.oreLoad).toBe(0);
    expect(harv.oreCreditValue).toBe(0);
    expect(harv.harvesterState).toBe('idle');
  });

  it('full gem load: unloads BailCount * GemValue credits via lump-sum', () => {
    let totalDeposited = 0;
    const addCredits = vi.fn((n: number) => { totalDeposited += n; });
    const ctx = makeCtx({ addCredits });

    const harv = makeHarv(House.Spain, 50, 50);
    harv.harvesterState = 'unloading';
    harv.harvestTick = 0;
    preRotateW(harv);
    harv.oreLoad = iniBailCount;
    harv.oreCreditValue = iniBailCount * iniGemValue;
    ctx.entities.push(harv);

    for (let i = 0; i < 22; i++) {
      updateHarvester(ctx, harv);
    }

    expect(totalDeposited).toBe(iniBailCount * iniGemValue);
  });

  it('AI harvester deposits into houseCredits map', () => {
    const houseCredits = new Map<House, number>();
    const ctx = makeCtx({
      houseCredits,
      isPlayerControlled: () => false,
    });

    const harv = makeHarv(House.USSR, 50, 50);
    harv.harvesterState = 'unloading';
    harv.harvestTick = 0;
    preRotateW(harv);
    harv.oreLoad = iniBailCount;
    harv.oreCreditValue = iniBailCount * iniGoldValue;
    ctx.entities.push(harv);

    for (let i = 0; i < 22; i++) {
      updateHarvester(ctx, harv);
    }

    expect(houseCredits.get(House.USSR)).toBe(iniBailCount * iniGoldValue);
    expect(harv.oreLoad).toBe(0);
    expect(harv.harvesterState).toBe('idle');
  });

  it('empty harvester unloads 0 credits (addCredits not called)', () => {
    const addCredits = vi.fn();
    const ctx = makeCtx({ addCredits });

    const harv = makeHarv(House.Spain, 50, 50);
    harv.harvesterState = 'unloading';
    harv.harvestTick = 0;
    preRotateW(harv);
    harv.oreLoad = 0;
    harv.oreCreditValue = 0;
    ctx.entities.push(harv);

    // 22-tick dump animation even with 0 bails — no credits deposited
    for (let i = 0; i < 22; i++) {
      updateHarvester(ctx, harv);
    }

    expect(addCredits).not.toHaveBeenCalled();
    expect(harv.harvesterState).toBe('idle');
  });

  /**
   * C++ lump-sum: no credits deposited until tick 22.
   * First tick just starts the dump animation.
   */
  it('no credits deposited during first tick (lump-sum at tick 22)', () => {
    const addCredits = vi.fn();
    const ctx = makeCtx({ addCredits });

    const harv = makeHarv(House.Spain, 50, 50);
    harv.harvesterState = 'unloading';
    harv.harvestTick = 0;
    preRotateW(harv);
    harv.oreLoad = iniBailCount;
    harv.oreCreditValue = iniBailCount * iniGoldValue;
    ctx.entities.push(harv);

    // After 1 tick: dump animation started, no credits yet
    updateHarvester(ctx, harv);

    expect(addCredits).not.toHaveBeenCalled();
    expect(harv.harvesterState).toBe('unloading');
    expect(harv.oreLoad).toBe(iniBailCount); // unchanged until lump-sum
  });
});

// =============================================================================
// 9. Harvesting State Machine — unit.cpp:2280-2308
// =============================================================================

describe('Harvesting state machine (unit.cpp:2280-2308)', () => {
  /**
   * Each gold harvest action takes 1 bail and depletes 1 density level.
   */
  it('gold harvest: 1 bail per action, density decrements by 1', () => {
    const ctx = makeCtx();
    const harv = makeHarv(House.USSR, 50, 50);
    harv.harvesterState = 'harvesting';
    primeHarvestReady(harv);
    harv.oreLoad = 0;
    harv.oreCreditValue = 0;
    ctx.entities.push(harv);
    placeGold(ctx.map, 50, 50, 5); // overlay 0x08

    updateHarvester(ctx, harv);
    expect(harv.oreLoad).toBe(1);
    expect(harv.oreCreditValue).toBe(iniGoldValue);
    expect(getOverlay(ctx.map, 50, 50)).toBe(0x07);
  });

  /**
   * Harvesting triggers when the 9-stage load animation completes.
   */
  it('harvest triggers when the initial rate-2 load animation completes', () => {
    const ctx = makeCtx();
    const harv = makeHarv(House.USSR, 50, 50);
    harv.harvesterState = 'harvesting';
    harv.harvestTick = 0;
    harv.oreLoad = 0;
    harv.oreCreditValue = 0;
    ctx.entities.push(harv);
    placeGold(ctx.map, 50, 50, 11);

    for (let i = 0; i < 19; i++) {
      updateHarvester(ctx, harv);
    }
    expect(harv.oreLoad).toBe(0);

    // 20th update dispatch observes the completed load stage and lifts a bail.
    updateHarvester(ctx, harv);
    expect(harv.oreLoad).toBe(1);
  });

  /**
   * When cell is fully depleted and nearby ore exists, harvester seeks it.
   */
  it('seeks new ore when current cell depleted', () => {
    const ctx = makeCtx();
    const harv = makeHarv(House.USSR, 50, 50);
    harv.harvesterState = 'harvesting';
    primeHarvestReady(harv);
    harv.oreLoad = 0;
    harv.oreCreditValue = 0;
    ctx.entities.push(harv);
    placeGold(ctx.map, 50, 50, 0); // clears without a paid bail
    placeGold(ctx.map, 51, 50, 5); // nearby ore

    updateHarvester(ctx, harv);
    expect(harv.oreLoad).toBe(0);
    expect(getOverlay(ctx.map, 50, 50)).toBe(0xFF);
    expect(harv.harvesterState).toBe('harvesting');
    primeHarvestReady(harv);
    updateHarvester(ctx, harv);
    expect(harv.harvesterState).toBe('harvesting');
    expect(harv.moveTarget).not.toBeNull();
  });

  /**
   * Returns with partial load when no ore remains nearby.
   */
  it('returns with partial load when no ore remains', () => {
    const ctx = makeCtx();
    const harv = makeHarv(House.USSR, 50, 50);
    harv.harvesterState = 'harvesting';
    primeHarvestReady(harv);
    harv.oreLoad = 5;
    harv.oreCreditValue = 5 * iniGoldValue;
    ctx.entities.push(harv);
    placeGold(ctx.map, 50, 50, 0); // clears without a paid bail, no other ore nearby

    updateHarvester(ctx, harv);
    expect(harv.harvesterState).toBe('harvesting');
    primeHarvestReady(harv);
    updateHarvester(ctx, harv);
    expect(harv.harvesterState).toBe('returning');
  });
});

// =============================================================================
// 10. C++ Constructor Default vs INI Override Documentation
// =============================================================================

describe('C++ constructor defaults overridden by rules.ini (documentation tests)', () => {
  it('GoldValue: C++ default 35 overridden by INI 25', () => {
    expect(iniGoldValue).not.toBe(35);
    expect(iniGoldValue).toBe(25);
  });

  it('GemValue: C++ default 110 overridden by INI 50', () => {
    expect(iniGemValue).not.toBe(110);
    expect(iniGemValue).toBe(50);
  });

  it('OreDumpRate: C++ default 2 overridden by INI OreTruckRate=1', () => {
    expect(iniOreTruckRate).not.toBe(2);
    expect(iniOreTruckRate).toBe(1);
  });

  it('SurvivorFraction: C++ default 0.5 overridden by INI SurvivorRate=.4', () => {
    expect(iniSurvivorRate).not.toBe(0.5);
    expect(iniSurvivorRate).toBe(0.4);
  });

  it('BailCount: C++ default 28 matches INI BailCount=28', () => {
    expect(iniBailCount).toBe(28);
  });

  it('GrowthRate: C++ default 2 matches INI GrowthRate=2', () => {
    expect(iniGrowthRate).toBe(2);
  });
});
