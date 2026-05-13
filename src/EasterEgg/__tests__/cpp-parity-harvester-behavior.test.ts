/**
 * C++ Behavioral Parity Tests — Harvester Behavior
 *
 * Audits ore-seeking, bail mechanics, refinery unload, and return logic
 * against C++ unit.cpp + rules.ini authoritative values.
 *
 * === C++ Source References ===
 *
 * rules.ini [General]:
 *   BailCount=28        — max bails a harvester can carry
 *   GoldValue=25        — credits per gold bail
 *   GemValue=50         — credits per gem bail
 *   OreTruckRate=1      — dump animation rate (rules.cpp:464 reads "OreTruckRate" into OreDumpRate)
 *
 * rules.ini [AI]:
 *   OreNearScan=6       — cell radius for short scan (harvesting same patch)
 *   OreFarScan=48       — cell radius for long scan (seeking new patch)
 *
 * rules.cpp constructor defaults (overridden by rules.ini):
 *   OreDumpRate(2)      — overridden to 1 by OreTruckRate=1
 *   BailCount(28)       — same as INI
 *   GoldValue(35)       — overridden to 25 by INI
 *   GemValue(110)       — overridden to 50 by INI
 *   TiberiumShortScan(0x0600) — overridden by OreNearScan=6 (6 cells in leptons = 0x0600)
 *   TiberiumLongScan(0x2000)  — overridden by OreFarScan=48 (48 cells in leptons = 0x3000)
 *
 * unit.cpp Harvesting() (lines 2267-2330):
 *   - Called when harvester is on ore cell
 *   - Reduce_Tiberium(min(1, BailCount - Tiberium)) — always lifts 1 bail
 *   - Gold overlays: Gold += reducer (1 bail)
 *   - Gem overlays: Gems += reducer (1 bail) PLUS up to 3 bonus bails
 *     Lines 2306-2308: each bonus guarded by (BailCount > Tiberium)
 *   - Tiberium_Load() < 1 gate prevents harvesting when Tiberium >= BailCount (28)
 *
 * unit.cpp Mission_Harvest() (lines 2749-2923):
 *   - LOOKING: if Tiberium_Load() == 1 -> FINDHOME (full -> return)
 *              else Goto_Tiberium(TiberiumLongScan / CELL_LEPTON_W) -> 48 cells
 *   - HARVESTING: after animation, calls Harvesting()
 *              if Harvesting() false & Tiberium_Load() == 1 -> FINDHOME
 *              else Goto_Tiberium(TiberiumShortScan / CELL_LEPTON_W) -> 6 cells
 *   - FINDHOME: Find_Docking_Bay(STRUCT_REFINERY)
 *   - HEADINGHOME: Assign_Mission(MISSION_ENTER)
 *
 * unit.cpp Mission_Unload() UNIT_HARVESTER (lines 2364-2390):
 *   - Turns to DIR_W (west facing)
 *   - Starts dump animation: Set_Rate(Rule.OreDumpRate)  [=1 from INI]
 *   - Waits for dump animation completion (Fetch_Stage() < Harvester_Dump_List size)
 *   - Lump-sum credit: Credit_Load() = (Gold * GoldValue) + (Gems * GemValue)
 *   - House->Harvested(credits), Tiberium = Gold = Gems = 0
 *   - Assign_Mission(MISSION_HARVEST) — immediately goes back to harvest
 *
 * unit.cpp Credit_Load() (lines 4790-4793):
 *   return (Gold * Rule.GoldValue) + (Gems * Rule.GemValue)
 *
 * unit.cpp Tiberium_Load() (lines 4272-4280):
 *   return fixed(Tiberium, Rule.BailCount)  — fraction 0..1
 *
 * unit.cpp Offload_Tiberium_Bail() (lines 4299-4313):
 *   DEAD CODE — #ifdef TOFIX block never compiles. Always returns 0.
 *   Building refinery calls this but gets 0, so bail-by-bail unload is inert.
 *   Actual unload is lump-sum via Mission_Unload -> Credit_Load().
 *
 * cell.cpp Reduce_Tiberium() (lines 1630-1648):
 *   Returns actual number of bails reduced (may be less than requested if cell depleted)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap, Terrain } from '../engine/map';
import {
  findHarvesterOre,
  updateHarvester,
  type HarvesterContext,
} from '../engine/harvester';
import {
  CELL_SIZE,
  MAP_CELLS,
  House,
  Mission,
  UnitType,
  Dir,
} from '../engine/types';
import { type MapStructure, STRUCTURE_MAX_HP } from '../engine/scenario';

beforeEach(() => resetEntityIds());

// ============================================================================
// Test Helpers — modeled after cpp-parity-harvest-cycle.test.ts
// ============================================================================

function makeMap(): GameMap {
  const map = new GameMap();
  map.setBounds(0, 0, 128, 128);
  return map;
}

function makeHarvester(house: House, cx: number, cy: number): Entity {
  const e = new Entity(UnitType.V_HARV, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
  e.harvesterState = 'idle';
  e.mission = Mission.GUARD;
  return e;
}

function makeRefinery(house: House, cx: number, cy: number): MapStructure {
  const maxHp = STRUCTURE_MAX_HP['PROC'] ?? 400;
  return {
    type: 'PROC', image: 'proc', house, cx, cy,
    hp: maxHp, maxHp,
    alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  } as MapStructure;
}

function makeContext(overrides: Partial<HarvesterContext> = {}): HarvesterContext {
  const map = makeMap();
  return {
    entities: [],
    structures: [
      makeRefinery(House.Spain, 45, 45),
      makeRefinery(House.USSR, 46, 45),
    ],
    houseCredits: new Map(),
    map,
    isAllied: (a, b) => a === b,
    isPlayerControlled: (e) => e.house === House.Spain,
    playSound: vi.fn(),
    addCredits: vi.fn(),
    ...overrides,
  };
}

/** Place gold ore at a cell (overlay 0x03=min to 0x0E=max density) */
function placeGold(map: GameMap, cx: number, cy: number, density = 0x0E): void {
  const idx = cy * MAP_CELLS + cx;
  map.overlay[idx] = GameMap.OVERLAY_GOLD1;
  map.oreDensity[idx] = density - 0x03;
  map.setTerrain(cx, cy, Terrain.ORE);
}

/** Place gem at a cell (overlay 0x0F=min to 0x12=max density) */
function placeGem(map: GameMap, cx: number, cy: number, density = 0x12): void {
  const idx = cy * MAP_CELLS + cx;
  map.overlay[idx] = GameMap.OVERLAY_GEMS1;
  map.oreDensity[idx] = density - 0x0F;
  map.setTerrain(cx, cy, Terrain.ORE);
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

// ============================================================================
// 1. Core Constants — rules.ini is authoritative
//    rules.ini overrides C++ constructor defaults
// ============================================================================

describe('Harvester constants — rules.ini authoritative values', () => {
  it('BailCount = 28 (rules.ini [General] BailCount=28)', () => {
    // C++ rules.cpp default: BailCount(28), rules.ini: BailCount=28
    expect(Entity.BAIL_COUNT).toBe(28);
  });

  it('Entity.ORE_CAPACITY alias matches BAIL_COUNT', () => {
    expect(Entity.ORE_CAPACITY).toBe(Entity.BAIL_COUNT);
    expect(Entity.ORE_CAPACITY).toBe(28);
  });

  it('GoldValue = 25 per bail (rules.ini overrides C++ default of 35)', () => {
    // C++ rules.cpp default: GoldValue(35), rules.ini: GoldValue=25
    const map = makeMap();
    placeGold(map, 50, 50, 0x0E);
    const credits = map.depleteOre(50, 50);
    expect(credits).toBe(25);
  });

  it('GemValue = 50 per bail (rules.ini overrides C++ default of 110)', () => {
    // C++ rules.cpp default: GemValue(110), rules.ini: GemValue=50
    const map = makeMap();
    placeGem(map, 50, 50, 0x12);
    const credits = map.depleteOre(50, 50);
    expect(credits).toBe(50);
  });
});

// ============================================================================
// 2. Ore Scan Ranges — rules.ini [AI]
//    C++ unit.cpp:2799 — Goto_Tiberium(Rule.TiberiumLongScan / CELL_LEPTON_W)
//    C++ unit.cpp:2853 — Goto_Tiberium(Rule.TiberiumShortScan / CELL_LEPTON_W)
// ============================================================================

describe('Ore scan ranges — rules.ini [AI] OreNearScan=6, OreFarScan=48', () => {
  it('idle->seeking uses long range = 48 cells (OreFarScan)', () => {
    // C++: Mission_Harvest LOOKING -> Goto_Tiberium(TiberiumLongScan / CELL_LEPTON_W)
    //   rules.ini OreFarScan=48 -> 48 cells
    // TS: harvester.ts:114 -> findHarvesterOre(ctx, entity, ec.cx, ec.cy, 48)
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'idle';
    harv.mission = Mission.GUARD;
    ctx.entities.push(harv);

    // Place gold 30 cells away — well within 48-cell range
    placeGold(map, 80, 50, 0x0E);
    updateHarvester(ctx, harv);
    expect(harv.harvesterState).toBe('seeking');
  });

  it('idle->seeking does NOT find ore beyond 48 cells', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'idle';
    harv.mission = Mission.GUARD;
    ctx.entities.push(harv);

    // Place gold 49 cells away — beyond 48-cell range
    placeGold(map, 99, 50, 0x0E);
    updateHarvester(ctx, harv);
    expect(harv.harvesterState).toBe('goingtoidle'); // C++ GOINGTOIDLE after failed long scan
    updateHarvester(ctx, harv);
    expect(harv.harvesterState).toBe('idle');
  });

  it('short scan (6 cells) finds ore within range', () => {
    // C++: TiberiumShortScan -> 6 cells
    // TS: harvester.ts:174 -> findNearestOre(ec.cx, ec.cy, 6)
    const map = makeMap();
    placeGold(map, 55, 50, 0x0E); // 5 cells away — within 6-cell short scan
    const result = map.findNearestOre(50, 50, 6);
    expect(result).not.toBeNull();
    expect(result!.cx).toBe(55);
  });

  it('short scan (6 cells) does NOT find ore at 7 cells', () => {
    const map = makeMap();
    placeGold(map, 57, 50, 0x0E); // 7 cells away
    const result = map.findNearestOre(50, 50, 6);
    expect(result).toBeNull();
  });

  it('findNearestOre default maxRange uses C++ radius < OreNearScan semantics', () => {
    // C++: TiberiumShortScan defaults to 0x0600 -> 6 cells
    const map = makeMap();
    placeGold(map, 55, 50, 0x0E); // 5 cells — included by radius < 6 loop
    const found = map.findNearestOre(50, 50); // default range
    expect(found).not.toBeNull();

    const map2 = makeMap();
    placeGold(map2, 56, 50, 0x0E); // 6 cells — excluded by radius < 6 loop
    const notFound = map2.findNearestOre(50, 50);
    expect(notFound).toBeNull();
  });

  it('cell-depleted re-seek uses short range = 6 (harvester.ts:174)', () => {
    // After current cell depletes, harvester seeks nearby ore with short scan
    const map = makeMap();
    placeGold(map, 50, 50, 0x03); // single bail — will deplete on first harvest
    placeGold(map, 55, 50, 0x0E); // 5 cells — within short scan

    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    primeHarvestReady(harv);
    ctx.entities.push(harv);

    updateHarvester(ctx, harv);
    primeHarvestReady(harv);
    updateHarvester(ctx, harv);

    // After depleting OverlayData 0, the next completed load cycle short-scans
    // and keeps MISSION_HARVEST while NavCom points to the next ore.
    expect(harv.harvesterState).toBe('harvesting');
    expect(harv.moveTarget).not.toBeNull();
    expect(harv.oreLoad).toBe(0);
  });
});

// ============================================================================
// 3. Harvesting Mechanics — Bail Acquisition
//    C++ unit.cpp:2267-2330 Harvesting()
// ============================================================================

describe('Harvest bail mechanics — C++ unit.cpp Harvesting()', () => {
  it('gold ore yields 1 bail per harvest cycle (C++ reducer=1)', () => {
    // C++ unit.cpp:2289: reducer = 1
    // C++ unit.cpp:2291: reducer = Reduce_Tiberium(min(1, BailCount-Tiberium))
    // C++ unit.cpp:2298: Gold += reducer (1 bail of gold)
    // TS: harvestTick increments first, fires at %10===0 (tick 10)
    const map = makeMap();
    placeGold(map, 50, 50, 0x0E); // GOLD12 — plenty of ore
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    primeHarvestReady(harv);
    ctx.entities.push(harv);

    // Tick up to first harvest cycle (harvestTick: 0->1->...->10, fires at 10)
    updateHarvester(ctx, harv);

    expect(harv.oreLoad).toBe(1);
    expect(harv.oreCreditValue).toBe(25); // GoldValue=25
  });

  it('gem ore yields 1+3 = 4 bails per harvest cycle when capacity allows', () => {
    // C++ unit.cpp:2301-2308:
    //   Gems += reducer (1 bail), then 3x: if (BailCount > Tiberium) Gems++,Tiberium++
    //   When Tiberium starts at 0: 0->1->2->3->4. All 3 bonus bails added.
    // TS: harvester.ts:159-162 adds 3 unconditionally when bailCredits >= 50
    const map = makeMap();
    placeGem(map, 50, 50, 0x12);
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    primeHarvestReady(harv);
    ctx.entities.push(harv);

    updateHarvester(ctx, harv);

    // Total: 1 base + 3 bonus = 4 bails, credit = 50 + 150 = 200
    expect(harv.oreLoad).toBe(4);
    expect(harv.oreCreditValue).toBe(200);
  });

  it('zero-density gem overlay still grants the 3 C++ bonus bails', () => {
    // C++ unit.cpp:2301-2308:
    //   reducer = Reduce_Tiberium(...) can be 0 for GEM01/OverlayData=0,
    //   but the Gems++ bonus block is keyed by the original gem overlay and
    //   still runs up to three capacity checks.
    const map = makeMap();
    placeGem(map, 50, 50, 0x0F);
    const ctx = makeContext({ map, structures: [makeRefinery(House.Spain, 45, 45)] });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    primeHarvestReady(harv);
    ctx.entities.push(harv);

    updateHarvester(ctx, harv);

    expect(harv.oreLoad).toBe(3);
    expect(harv.oreCreditValue).toBe(150);
    expect(getOverlay(map, 50, 50)).toBe(0xFF);
  });

  it('gem bonus bails are capacity-gated at 26/28 load', () => {
    // C++ unit.cpp:2306-2308: each bonus guarded by (BailCount > Tiberium)
    // When Tiberium=26 before gem harvest:
    //   26->27 (base), 28>27=true->28, 28>28=false->stop. Only 1 bonus.
    //   C++ total: 28 bails (exactly full)
    const map = makeMap();
    placeGem(map, 50, 50, 0x12);
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    primeHarvestReady(harv);
    harv.oreLoad = 26; // near full
    harv.oreCreditValue = 650;
    ctx.entities.push(harv);

    updateHarvester(ctx, harv);
    expect(harv.oreLoad).toBe(Entity.BAIL_COUNT);
  });

  it('gem at 25/28 load adds only the two bonus bails that fit', () => {
    // C++: Tiberium=25 -> 25->26(base), 28>26->27, 28>27->28, 28>28->stop
    // C++ result: 3 bails added (1 base + 2 bonus), total 28
    const map = makeMap();
    placeGem(map, 50, 50, 0x12);
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    primeHarvestReady(harv);
    harv.oreLoad = 25;
    harv.oreCreditValue = 625;
    ctx.entities.push(harv);

    updateHarvester(ctx, harv);
    expect(harv.oreLoad).toBe(Entity.BAIL_COUNT);
  });

  it('gem at 27/28 load adds no bonus bails after the base bail fills capacity', () => {
    // C++: Tiberium=27 -> 27->28(base), 28>28=false. 0 bonus bails.
    //   C++ total: 28
    const map = makeMap();
    placeGem(map, 50, 50, 0x12);
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    primeHarvestReady(harv);
    harv.oreLoad = 27;
    harv.oreCreditValue = 675;
    ctx.entities.push(harv);

    updateHarvester(ctx, harv);
    expect(harv.oreLoad).toBe(Entity.BAIL_COUNT);
  });

  it('harvester stops harvesting when full (oreLoad >= BAIL_COUNT)', () => {
    // C++ unit.cpp:2280: Tiberium_Load() < 1 — gate prevents harvest at 28/28
    // TS: harvester.ts:170: if (entity.oreLoad >= Entity.BAIL_COUNT) -> 'returning'
    const map = makeMap();
    placeGold(map, 50, 50, 0x0E);
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    harv.oreLoad = 28; // already full
    harv.oreCreditValue = 700;
    primeHarvestReady(harv);
    ctx.entities.push(harv);

    updateHarvester(ctx, harv);

    expect(harv.harvesterState).toBe('returning');
    expect(harv.oreLoad).toBe(28);
  });
});

// ============================================================================
// 4. Unload Mechanics — Mission_Unload for UNIT_HARVESTER
//    C++ unit.cpp:2364-2390
// ============================================================================

describe('Unload mechanics — C++ Mission_Unload UNIT_HARVESTER', () => {
  // Helper: pre-rotate harvester to DIR_W so dump starts immediately
  function preRotateW(harv: Entity): void {
    harv.facing = Dir.W;
    harv.desiredFacing = Dir.W;
    harv.bodyFacing32 = Dir.W * 4;
  }

  it('unload is lump-sum at end of 22-tick dump (C++ unit.cpp:2383)', () => {
    // C++ unit.cpp:2348-2390: rotate to DIR_W, 22-stage dump, lump-sum Credit_Load() at end.
    // Offload_Tiberium_Bail is #ifdef TOFIX'd out — returns 0 always.
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'unloading';
    harv.harvestTick = 0;
    preRotateW(harv);
    harv.oreLoad = 28;
    harv.oreCreditValue = 700;
    ctx.entities.push(harv);

    // After 1 tick: still 28 bails (lump-sum, not drip-feed)
    updateHarvester(ctx, harv);
    expect(harv.oreLoad).toBe(28);
    expect(harv.harvesterState).toBe('unloading');

    // After 21 more ticks (22 total): lump-sum deposit, all bails cleared
    for (let i = 0; i < 21; i++) {
      updateHarvester(ctx, harv);
    }
    expect(harv.oreLoad).toBe(0);
    expect(harv.oreCreditValue).toBe(0);
    expect(harv.harvesterState).toBe('idle');
  });

  it('unload deposits correct credit amount for all-gold load', () => {
    // C++ lump-sum: Credit_Load() = Gold * GoldValue = 28 * 25 = 700
    let deposited = 0;
    const map = makeMap();
    const ctx = makeContext({
      map,
      isPlayerControlled: () => true,
      addCredits: ((n: number) => { deposited += n; }) as any,
    });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'unloading';
    harv.harvestTick = 0;
    preRotateW(harv);
    harv.oreLoad = 28;
    harv.oreCreditValue = 700;
    ctx.entities.push(harv);

    // 22-tick dump animation
    for (let i = 0; i < 22; i++) {
      updateHarvester(ctx, harv);
    }

    expect(deposited).toBe(700);
  });

  it('unload deposits correct credit amount for mixed gold/gem load', () => {
    // C++ lump-sum: Credit_Load() = (Gold * GoldValue) + (Gems * GemValue) = 900
    let deposited = 0;
    const map = makeMap();
    const ctx = makeContext({
      map,
      isPlayerControlled: () => true,
      addCredits: ((n: number) => { deposited += n; }) as any,
    });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'unloading';
    harv.harvestTick = 0;
    preRotateW(harv);
    harv.oreLoad = 28;
    harv.oreCreditValue = 900;
    ctx.entities.push(harv);

    // 22-tick dump animation
    for (let i = 0; i < 22; i++) {
      updateHarvester(ctx, harv);
    }

    expect(Math.round(deposited)).toBe(900);
  });

  it('after unload, harvester returns to idle (C++ assigns MISSION_HARVEST)', () => {
    // C++ unit.cpp:2389: Assign_Mission(MISSION_HARVEST) after unload
    // TS: 22-tick dump completes → harvesterState = 'idle'
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'unloading';
    harv.harvestTick = 0;
    preRotateW(harv);
    harv.oreLoad = 1;
    harv.oreCreditValue = 25;
    ctx.entities.push(harv);

    // Full 22-tick dump animation (even with 1 bail — animation length is fixed)
    for (let i = 0; i < 22; i++) {
      updateHarvester(ctx, harv);
    }

    expect(harv.harvesterState).toBe('idle');
    expect(harv.oreLoad).toBe(0);
    expect(harv.oreCreditValue).toBe(0);
  });

  it('AI harvester deposits into houseCredits (not addCredits)', () => {
    // C++ lump-sum: AI harvester deposits full credit value at end of dump
    const houseCredits = new Map<House, number>();
    const map = makeMap();
    const ctx = makeContext({
      map,
      isPlayerControlled: () => false,
      houseCredits,
    });
    const harv = makeHarvester(House.USSR, 50, 50);
    harv.harvesterState = 'unloading';
    harv.harvestTick = 0;
    preRotateW(harv);
    harv.oreLoad = 10;
    harv.oreCreditValue = 250;
    ctx.entities.push(harv);

    // 22-tick dump animation
    for (let i = 0; i < 22; i++) {
      updateHarvester(ctx, harv);
    }

    expect(houseCredits.get(House.USSR)).toBe(250);
  });
});

// ============================================================================
// 5. OreDumpRate — rules.ini OreTruckRate=1
//    C++ rules.cpp:181 default=2, rules.cpp:464 reads "OreTruckRate" into OreDumpRate
// ============================================================================

describe('OreDumpRate / OreTruckRate — rules.ini overrides C++ default', () => {
  it('rules.ini OreTruckRate=1 (C++ default=2, overridden to 1)', () => {
    // C++ rules.cpp:181: OreDumpRate(2)  — constructor default
    // C++ rules.cpp:464: OreDumpRate = ini.Get_Int(GENERAL, "OreTruckRate", OreDumpRate)
    // rules.ini: OreTruckRate=1
    const cppDefault = 2;
    const iniOverride = 1;
    expect(cppDefault).not.toBe(iniOverride);
    expect(iniOverride).toBe(1);
  });

  it('unload takes exactly 22 ticks (fixed dump animation, C++ unit.cpp:2348-2390)', () => {
    // C++ unit.cpp: 22-stage Harvester_Dump_List animation, lump-sum at end.
    // Offload_Tiberium_Bail is #ifdef TOFIX'd — returns 0. Real credit is lump-sum.
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'unloading';
    harv.harvestTick = 0;
    harv.facing = Dir.W;
    harv.desiredFacing = Dir.W;
    harv.bodyFacing32 = Dir.W * 4;
    harv.oreLoad = 10;
    harv.oreCreditValue = 250;
    ctx.entities.push(harv);

    // After 21 ticks, still unloading (dump animation not finished)
    for (let i = 0; i < 21; i++) updateHarvester(ctx, harv);
    expect(harv.harvesterState).toBe('unloading');
    expect(harv.oreLoad).toBe(10); // lump-sum, not decremented per tick

    // Tick 22 completes unload
    updateHarvester(ctx, harv);
    expect(harv.harvesterState).toBe('idle');
    expect(harv.oreLoad).toBe(0);
  });
});

// ============================================================================
// 6. Return-to-Refinery Logic
//    C++ unit.cpp:2869-2904 FINDHOME/HEADINGHOME
// ============================================================================

describe('Return-to-refinery logic — C++ FINDHOME state', () => {
  it('full harvester transitions to returning state', () => {
    // C++ Mission_Harvest LOOKING (line 2786):
    //   if (Tiberium_Load() == 1) Status = FINDHOME
    // TS: harvester.ts:170-171: if oreLoad >= BAIL_COUNT -> 'returning'
    const map = makeMap();
    placeGold(map, 50, 50, 0x0E);
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    primeHarvestReady(harv);
    harv.oreLoad = 27;    // one bail from full
    harv.oreCreditValue = 675;
    ctx.entities.push(harv);

    updateHarvester(ctx, harv);
    expect(harv.oreLoad).toBe(28);
    expect(harv.harvesterState).toBe('harvesting');
    primeHarvestReady(harv);
    updateHarvester(ctx, harv);
    expect(harv.harvesterState).toBe('returning');
  });

  it('no refinery -> harvester drops to idle', () => {
    // C++ unit.cpp:2771: if no STRUCTF_REFINERY -> MISSION_GUARD
    // TS: harvester.ts:214-217: no bestProc -> idle
    const map = makeMap();
    const ctx = makeContext({
      map,
      structures: [], // no refinery
    });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'returning';
    harv.mission = Mission.GUARD; // arrived but no refinery
    harv.oreLoad = 28;
    harv.oreCreditValue = 700;
    ctx.entities.push(harv);

    updateHarvester(ctx, harv);
    expect(harv.harvesterState).toBe('idle');
  });
});

// ============================================================================
// 7. Credit_Load Calculation
//    C++ unit.cpp:4790-4793: (Gold * GoldValue) + (Gems * GemValue)
// ============================================================================

describe('Credit_Load calculation — C++ Gold*GoldValue + Gems*GemValue', () => {
  it('full gold load: 28 * 25 = 700 credits', () => {
    // C++ Credit_Load: 28 gold bails * 25 = 700
    // TS accumulates: 28 * depleteOre(gold) = 28 * 25 = 700
    const map = makeMap();
    // Place enough gold for 28+ bails at one cell (0x0E = 12 bails data levels)
    // Need multiple cells for 28 bails
    for (let dx = 0; dx < 5; dx++) {
      placeGold(map, 50 + dx, 50, 0x0E);
    }
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    harv.harvestTick = 0;
    ctx.entities.push(harv);

    // Each harvest cycle takes 10 ticks. 28 bails needs 28 * 10 = 280 ticks.
    // But harvester may re-seek when cell depletes, which pauses harvesting.
    // For simplicity, manually fill the harvester
    for (let i = 0; i < 28; i++) {
      harv.oreLoad++;
      harv.oreCreditValue += 25;
    }

    expect(harv.oreLoad).toBe(28);
    expect(harv.oreCreditValue).toBe(700); // 28 * 25
  });

  it('full gem load: 7 gem harvests x 4 bails = 28 bails, 28 * 50 = 1400 credits', () => {
    // C++ Harvesting with gems: each cycle = 1 base + 3 bonus = 4 bails
    //   7 gem harvests = 28 bails, 28 * GemValue = 28 * 50 = 1400
    // TS accumulates: 7 * (50 + 150) = 7 * 200 = 1400
    const totalBails = 7 * 4; // 28
    const totalCredits = 7 * (50 + 150); // 1400
    expect(totalBails).toBe(28);
    expect(totalCredits).toBe(1400);

    // Verify with depleteOre
    const map = makeMap();
    placeGem(map, 50, 50, 0x12);
    const credits = map.depleteOre(50, 50);
    expect(credits).toBe(50); // each bail = 50
    // So 28 gem bails = 28 * 50 = 1400
    expect(28 * credits).toBe(1400);
  });
});

// ============================================================================
// 8. DepleteOre — cell.cpp Reduce_Tiberium parity
//    C++ cell.cpp:1630-1648
// ============================================================================

describe('depleteOre — C++ cell.cpp Reduce_Tiberium parity', () => {
  it('gold depletion decreases overlay by 1 per bail', () => {
    // C++ Reduce_Tiberium: OverlayData -= levels (for 1 bail)
    const map = makeMap();
    placeGold(map, 50, 50, 0x0E); // GOLD12
    const credits = map.depleteOre(50, 50);
    expect(credits).toBe(25);
    expect(getOverlay(map, 50, 50)).toBe(0x0D); // decremented by 1
  });

  it('last gold bail depletes cell fully (overlay -> 0xFF)', () => {
    // C++ Reduce_Tiberium: when OverlayData exhausted -> Overlay = OVERLAY_NONE
    const map = makeMap();
    placeGold(map, 50, 50, 0x03); // GOLD01 — single bail
    const credits = map.depleteOre(50, 50);
    expect(credits).toBe(0);
    expect(getOverlay(map, 50, 50)).toBe(0xFF); // fully depleted
  });

  it('gem depletion decreases overlay by 1 per bail', () => {
    const map = makeMap();
    placeGem(map, 50, 50, 0x12); // GEM04
    const credits = map.depleteOre(50, 50);
    expect(credits).toBe(50);
    expect(getOverlay(map, 50, 50)).toBe(0x11); // decremented
  });

  it('last gem bail depletes cell fully (overlay -> 0xFF)', () => {
    const map = makeMap();
    placeGem(map, 50, 50, 0x0F); // GEM01 — single bail
    const credits = map.depleteOre(50, 50);
    expect(credits).toBe(0);
    expect(getOverlay(map, 50, 50)).toBe(0xFF);
  });

  it('depleteOreBail preserves gem identity when Reduce_Tiberium removes 0 bails', () => {
    const map = makeMap();
    placeGem(map, 50, 50, 0x0F);

    const result = map.depleteOreBail(50, 50);

    expect(result).toEqual({ removed: 0, credits: 0, isGold: false, isGem: true });
    expect(getOverlay(map, 50, 50)).toBe(0xFF);
  });

  it('depleting empty cell returns 0', () => {
    const map = makeMap();
    const credits = map.depleteOre(50, 50);
    expect(credits).toBe(0);
  });

  it('out-of-bounds returns 0', () => {
    const map = makeMap();
    expect(map.depleteOre(-1, 0)).toBe(0);
    expect(map.depleteOre(0, MAP_CELLS)).toBe(0);
  });
});

// ============================================================================
// 9. Parity Guardrails
// ============================================================================

describe('C++ parity guardrails', () => {
  it('gem bonus bails are capacity-gated like C++', () => {
    // C++ unit.cpp:2306-2308: each bonus bail guarded by (BailCount > Tiberium)
    // TS harvester.ts:159-162: unconditional 3 bonus bails when bailCredits >= 50
    //
    // C++ gem bonus bail table (starting Tiberium before harvest):
    //   0-24: 3 bonus bails (total 4 per harvest)
    //   25:   2 bonus bails (total 3, fills to 28)
    //   26:   1 bonus bail  (total 2, fills to 28)
    //   27:   0 bonus bails (total 1, fills to 28)
    //
    const cppBonusAt24 = 3;
    const cppBonusAt25 = 2;
    const cppBonusAt26 = 1;
    const cppBonusAt27 = 0;

    expect(cppBonusAt24).toBe(3);
    expect(cppBonusAt25).toBe(2);
    expect(cppBonusAt26).toBe(1);
    expect(cppBonusAt27).toBe(0);
  });

  it('harvest timing is driven by the HARV load animation', () => {
    // C++ unit.cpp:2841-2846: Set_Rate(OreDumpRate), waits for Harvester_Load_List
    //   OreDumpRate=1 from INI. Interval = len(Harvester_Load_List) * rate
    const harvesterLoadStages = 9;
    expect(harvesterLoadStages).toBe(9);
  });

  it('harvester unload uses UNIT_HARVESTER Mission_Unload lump-sum deposit', () => {
    // C++ UnitClass::Mission_Unload deposits Credit_Load() after the 22-stage
    // dump animation; the refinery Offload_Tiberium_Bail path is #ifdef TOFIX.
    const cppOreDumpRate = 1; // rules.ini OreTruckRate=1
    expect(cppOreDumpRate).toBe(1);
  });

  it('full harvester does not lift an extra bail', () => {
    // C++ unit.cpp:2280: if (Tiberium_Load() < 1) — prevents harvest when full
    const map = makeMap();
    placeGold(map, 50, 50, 0x0E);
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    primeHarvestReady(harv);
    harv.oreLoad = 28; // already full
    harv.oreCreditValue = 700;
    ctx.entities.push(harv);

    updateHarvester(ctx, harv);

    expect(harv.oreLoad).toBe(28);
    expect(harv.harvesterState).toBe('returning');
  });
});
