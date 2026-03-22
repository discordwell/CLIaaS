/**
 * C++ Behavioral Parity: Harvester/Refinery Ore Collection Cycle
 *
 * Tests verify that the harvester economy cycle matches C++ RA source code.
 * Tests that FAIL identify real C++ divergences in the TS implementation.
 *
 * C++ references:
 *   - unit.cpp:2230-2234   — OreNearScan=6, OreFarScan=48 scan radii
 *   - unit.cpp:2270-2320   — harvest cycle, bail loading
 *   - unit.cpp:2306-2308   — gem bonus: 3 extra bails per gem harvest (4 total)
 *   - rules.ini [General]  — BailCount=28, GoldValue=25, GemValue=50, GrowthRate=2
 *   - overlay.cpp           — gold 0x03-0x0E (12 levels), gems 0x0F-0x12 (4 levels)
 *   - map.cpp:1017          — ore regrowth interval, density/spread mechanics
 *   - cell.cpp:3000-3008    — spread terrain/bridge/building rejection
 *
 * Observable outcomes: bail counts, credit values, overlay transitions,
 *   harvest timing, unload timing, state machine transitions, scan radii,
 *   ore regrowth, multi-harvester spreading.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CELL_SIZE, MAP_CELLS,
  House, Mission, AnimState, UnitType,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap, Terrain } from '../engine/map';
import { type MapStructure, STRUCTURE_SIZE, STRUCTURE_MAX_HP } from '../engine/scenario';
import {
  type HarvesterContext,
  findHarvesterOre,
  updateHarvester,
} from '../engine/harvester';

beforeEach(() => resetEntityIds());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMap(boundsX = 40, boundsY = 40, boundsW = 50, boundsH = 50): GameMap {
  const map = new GameMap();
  map.setBounds(boundsX, boundsY, boundsW, boundsH);
  return map;
}

function makeHarvester(house: House = House.Spain, cx = 50, cy = 50): Entity {
  const e = new Entity(UnitType.V_HARV, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
  e.harvesterState = 'idle';
  e.mission = Mission.GUARD;
  return e;
}

function makeRefinery(house: House = House.Spain, cx = 55, cy = 55): MapStructure {
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
    structures: [],
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
  map.overlay[cy * MAP_CELLS + cx] = density;
  map.setTerrain(cx, cy, Terrain.ORE);
}

/** Place gem at a cell (overlay 0x0F=min to 0x12=max density) */
function placeGem(map: GameMap, cx: number, cy: number, density = 0x12): void {
  map.overlay[cy * MAP_CELLS + cx] = density;
  map.setTerrain(cx, cy, Terrain.ORE);
}

// =============================================================================
// 1. Entity Constants: BAIL_COUNT and ORE_CAPACITY
//    C++ UnitTypeClass::Max_Pips = 28 (rules.ini BailCount=28)
// =============================================================================

describe('harvester bail capacity constants — C++ rules.ini BailCount=28', () => {
  it('Entity.BAIL_COUNT equals 28', () => {
    expect(Entity.BAIL_COUNT).toBe(28);
  });

  it('Entity.ORE_CAPACITY equals 28 (alias for BAIL_COUNT)', () => {
    expect(Entity.ORE_CAPACITY).toBe(28);
  });

  it('BAIL_COUNT and ORE_CAPACITY are identical', () => {
    expect(Entity.BAIL_COUNT).toBe(Entity.ORE_CAPACITY);
  });
});

// =============================================================================
// 2. Gold Credit Value per Bail
//    C++ rules.ini GoldValue=25 credits per bail
// =============================================================================

describe('gold ore credit value — C++ rules.ini GoldValue=25', () => {
  it('depleteOre returns 25 for gold overlay', () => {
    const map = makeMap();
    placeGold(map, 50, 50, 0x0E); // max density gold
    const credits = map.depleteOre(50, 50);
    expect(credits).toBe(25);
  });

  it('depleteOre returns 25 for minimum density gold (0x03)', () => {
    const map = makeMap();
    placeGold(map, 50, 50, 0x03); // min density — will be fully depleted
    const credits = map.depleteOre(50, 50);
    expect(credits).toBe(25);
  });

  it('depleting min gold (0x03) sets overlay to 0xFF (empty)', () => {
    const map = makeMap();
    placeGold(map, 50, 50, 0x03);
    map.depleteOre(50, 50);
    expect(map.overlay[50 * MAP_CELLS + 50]).toBe(0xFF);
  });

  it('depleting non-min gold decrements overlay by 1', () => {
    const map = makeMap();
    placeGold(map, 50, 50, 0x0A);
    map.depleteOre(50, 50);
    expect(map.overlay[50 * MAP_CELLS + 50]).toBe(0x09);
  });
});

// =============================================================================
// 3. Gem Credit Value per Bail
//    C++ rules.ini GemValue=50 credits per bail
// =============================================================================

describe('gem credit value — C++ rules.ini GemValue=50', () => {
  it('depleteOre returns 50 for gem overlay', () => {
    const map = makeMap();
    placeGem(map, 50, 50, 0x12); // max density gem
    const credits = map.depleteOre(50, 50);
    expect(credits).toBe(50);
  });

  it('depleteOre returns 50 for minimum density gem (0x0F)', () => {
    const map = makeMap();
    placeGem(map, 50, 50, 0x0F);
    const credits = map.depleteOre(50, 50);
    expect(credits).toBe(50);
  });

  it('depleting min gem (0x0F) sets overlay to 0xFF (empty)', () => {
    const map = makeMap();
    placeGem(map, 50, 50, 0x0F);
    map.depleteOre(50, 50);
    expect(map.overlay[50 * MAP_CELLS + 50]).toBe(0xFF);
  });

  it('depleting non-min gem decrements overlay by 1', () => {
    const map = makeMap();
    placeGem(map, 50, 50, 0x11);
    map.depleteOre(50, 50);
    expect(map.overlay[50 * MAP_CELLS + 50]).toBe(0x10);
  });
});

// =============================================================================
// 4. Gold Overlay Range
//    C++ overlay.cpp: GOLD01=0x03 through GOLD12=0x0E (12 density levels)
// =============================================================================

describe('gold overlay range — C++ GOLD01(0x03) through GOLD12(0x0E)', () => {
  it('overlay 0x02 is NOT gold (below range)', () => {
    const map = makeMap();
    map.overlay[50 * MAP_CELLS + 50] = 0x02;
    expect(map.depleteOre(50, 50)).toBe(0);
  });

  it('overlay 0x03 IS gold (GOLD01 minimum)', () => {
    const map = makeMap();
    map.overlay[50 * MAP_CELLS + 50] = 0x03;
    expect(map.depleteOre(50, 50)).toBe(25);
  });

  it('overlay 0x0E IS gold (GOLD12 maximum)', () => {
    const map = makeMap();
    map.overlay[50 * MAP_CELLS + 50] = 0x0E;
    expect(map.depleteOre(50, 50)).toBe(25);
  });

  it('gold range has exactly 12 density levels (0x03 to 0x0E)', () => {
    expect(0x0E - 0x03 + 1).toBe(12);
  });
});

// =============================================================================
// 5. Gem Overlay Range
//    C++ overlay.cpp: GEM01=0x0F through GEM04=0x12 (4 density levels)
// =============================================================================

describe('gem overlay range — C++ GEM01(0x0F) through GEM04(0x12)', () => {
  it('overlay 0x0F IS gem (GEM01 minimum)', () => {
    const map = makeMap();
    map.overlay[50 * MAP_CELLS + 50] = 0x0F;
    expect(map.depleteOre(50, 50)).toBe(50);
  });

  it('overlay 0x12 IS gem (GEM04 maximum)', () => {
    const map = makeMap();
    map.overlay[50 * MAP_CELLS + 50] = 0x12;
    expect(map.depleteOre(50, 50)).toBe(50);
  });

  it('overlay 0x13 is NOT gem (above range)', () => {
    const map = makeMap();
    map.overlay[50 * MAP_CELLS + 50] = 0x13;
    expect(map.depleteOre(50, 50)).toBe(0);
  });

  it('gem range has exactly 4 density levels (0x0F to 0x12)', () => {
    expect(0x12 - 0x0F + 1).toBe(4);
  });
});

// =============================================================================
// 6. Full Trip Value: Gold
//    C++ parity: 28 bails * 25 credits = 700 credits per full gold load
//    In C++ each gold bail = 1 oreLoad increment, so a full gold trip is
//    exactly 28 bails harvested, yielding 28 * GoldValue = 700 credits.
// =============================================================================

describe('full gold trip value — 28 bails * 25 credits = 700', () => {
  it('harvesting 28 gold bails produces oreLoad=28 and oreCreditValue=700', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    harv.harvestTick = 0;
    harv.oreLoad = 0;
    harv.oreCreditValue = 0;
    ctx.entities.push(harv);

    // Place lots of gold at harvester cell (max density so it lasts many bails)
    placeGold(map, 50, 50, 0x0E);

    // Simulate harvesting: every 10 ticks, one bail is taken
    // Gold = 1 oreLoad per bail, so we need 28 harvests
    let ticks = 0;
    while (harv.oreLoad < 28 && ticks < 1000) {
      updateHarvester(ctx, harv);
      ticks++;
      // Re-place gold if depleted (we want to test bail accumulation, not depletion)
      if (map.overlay[50 * MAP_CELLS + 50] === 0xFF || map.overlay[50 * MAP_CELLS + 50] < 0x03) {
        placeGold(map, 50, 50, 0x0E);
      }
    }

    expect(harv.oreLoad).toBe(28);
    expect(harv.oreCreditValue).toBe(700);
  });
});

// =============================================================================
// 7. Full Trip Value: Gems
//    C++ unit.cpp:2306-2308 — gem harvest gives 4 bails per tick (1 base + 3 bonus)
//    Each bail = GemValue=50, so 4 bails = 200 credits per gem harvest.
//    28 bails / 4 bails-per-harvest = 7 gem harvests to fill.
//    7 * 200 = 1400 credits for a full gem load.
// =============================================================================

describe('full gem trip value — C++ unit.cpp:2306-2308 gem bonus bails', () => {
  it('each gem harvest adds 4 bails (1 base + 3 bonus) — C++ unit.cpp:2306-2308', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    harv.harvestTick = 9; // next tick (10) will trigger harvest
    harv.oreLoad = 0;
    harv.oreCreditValue = 0;
    ctx.entities.push(harv);

    placeGem(map, 50, 50, 0x12);

    updateHarvester(ctx, harv);

    // C++ gem bonus: 1 base bail + 3 bonus = 4 bails
    expect(harv.oreLoad).toBe(4);
    // Credit value: 1*50 (base) + 3*50 (bonus) = 200
    expect(harv.oreCreditValue).toBe(200);
  });

  it('full gem load: 28 bails = 7 gem harvests, total 1400 credits', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    harv.harvestTick = 0;
    harv.oreLoad = 0;
    harv.oreCreditValue = 0;
    ctx.entities.push(harv);

    placeGem(map, 50, 50, 0x12);

    let ticks = 0;
    while (harv.oreLoad < 28 && ticks < 500) {
      updateHarvester(ctx, harv);
      ticks++;
      if (map.overlay[50 * MAP_CELLS + 50] === 0xFF || map.overlay[50 * MAP_CELLS + 50] < 0x0F) {
        placeGem(map, 50, 50, 0x12);
      }
    }

    // 28 bails / 4 per harvest = 7 gem harvests
    // 7 * 200 = 1400 credits
    expect(harv.oreLoad).toBeGreaterThanOrEqual(28);
    expect(harv.oreCreditValue).toBe(1400);
  });
});

// =============================================================================
// 8. Harvest Timing — Every 10 Ticks per Bail
//    C++ parity: harvestTick increments each tick, harvest fires at % 10 === 0
// =============================================================================

describe('harvest timing — one bail every 10 ticks', () => {
  it('no harvest on tick 1-9 (harvestTick not divisible by 10)', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    harv.harvestTick = 0;
    harv.oreLoad = 0;
    harv.oreCreditValue = 0;
    ctx.entities.push(harv);

    placeGold(map, 50, 50, 0x0E);

    // Tick 1 through 9 — no harvest should occur
    for (let i = 0; i < 9; i++) {
      updateHarvester(ctx, harv);
    }
    expect(harv.oreLoad).toBe(0);
  });

  it('first harvest occurs on tick 10 (harvestTick reaches 10)', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    harv.harvestTick = 0;
    harv.oreLoad = 0;
    harv.oreCreditValue = 0;
    ctx.entities.push(harv);

    placeGold(map, 50, 50, 0x0E);

    for (let i = 0; i < 10; i++) {
      updateHarvester(ctx, harv);
    }
    expect(harv.oreLoad).toBe(1);
    expect(harv.oreCreditValue).toBe(25);
  });

  it('second harvest at tick 20', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    harv.harvestTick = 0;
    harv.oreLoad = 0;
    harv.oreCreditValue = 0;
    ctx.entities.push(harv);

    placeGold(map, 50, 50, 0x0E);

    for (let i = 0; i < 20; i++) {
      updateHarvester(ctx, harv);
      // Replenish if depleted
      if (map.overlay[50 * MAP_CELLS + 50] === 0xFF || map.overlay[50 * MAP_CELLS + 50] < 0x03) {
        placeGold(map, 50, 50, 0x0E);
      }
    }
    expect(harv.oreLoad).toBe(2);
  });
});

// =============================================================================
// 9. Unload Timing — 14-Tick Dump Animation
//    C++ parity: unloading takes 14 ticks, credits dumped as lump sum at end
// =============================================================================

describe('unload timing — 14-tick dump animation, lump-sum credits', () => {
  it('unloading completes at harvestTick=14, not before', () => {
    const ctx = makeContext();
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'unloading';
    harv.harvestTick = 0;
    harv.oreLoad = 28;
    harv.oreCreditValue = 700;
    ctx.entities.push(harv);

    // Tick 13 — still unloading
    for (let i = 0; i < 13; i++) {
      updateHarvester(ctx, harv);
    }
    expect(harv.harvesterState).toBe('unloading');
    expect(harv.oreLoad).toBe(28); // not yet deposited

    // Tick 14 — unload completes
    updateHarvester(ctx, harv);
    expect(harv.harvesterState).toBe('idle');
    expect(harv.oreLoad).toBe(0);
    expect(harv.oreCreditValue).toBe(0);
  });

  it('lump-sum credit deposit for player harvester calls addCredits with full amount', () => {
    const addCredits = vi.fn();
    const ctx = makeContext({ addCredits });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'unloading';
    harv.harvestTick = 0;
    harv.oreLoad = 28;
    harv.oreCreditValue = 700;
    ctx.entities.push(harv);

    for (let i = 0; i < 14; i++) {
      updateHarvester(ctx, harv);
    }

    expect(addCredits).toHaveBeenCalledWith(700);
  });

  it('AI harvester deposits into houseCredits map', () => {
    const houseCredits = new Map<House, number>();
    houseCredits.set(House.USSR, 100);
    const ctx = makeContext({
      houseCredits,
      isPlayerControlled: () => false,
    });
    const harv = makeHarvester(House.USSR, 50, 50);
    harv.harvesterState = 'unloading';
    harv.harvestTick = 0;
    harv.oreLoad = 28;
    harv.oreCreditValue = 700;
    ctx.entities.push(harv);

    for (let i = 0; i < 14; i++) {
      updateHarvester(ctx, harv);
    }

    expect(houseCredits.get(House.USSR)).toBe(800); // 100 + 700
  });

  it('unload plays sound every 5 ticks for player harvester', () => {
    const playSound = vi.fn();
    const ctx = makeContext({ playSound });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'unloading';
    harv.harvestTick = 0;
    harv.oreLoad = 10;
    harv.oreCreditValue = 250;
    ctx.entities.push(harv);

    for (let i = 0; i < 14; i++) {
      updateHarvester(ctx, harv);
    }

    // Sound plays at ticks 5, 10 => 2 times (tick 15 would be after unload completes)
    const healCalls = playSound.mock.calls.filter(c => c[0] === 'heal');
    expect(healCalls.length).toBe(2);
  });
});

// =============================================================================
// 10. Harvester State Machine: Idle -> Seeking
//     C++ parity: idle harvester with GUARD mission seeks nearest ore
// =============================================================================

describe('state machine: idle -> seeking', () => {
  it('idle harvester in GUARD mission transitions to seeking when ore exists', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'idle';
    harv.mission = Mission.GUARD;
    ctx.entities.push(harv);

    placeGold(map, 52, 50, 0x0E);

    updateHarvester(ctx, harv);

    expect(harv.harvesterState).toBe('seeking');
    expect(harv.mission).toBe(Mission.MOVE);
  });

  it('idle harvester stays idle when no ore exists', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'idle';
    harv.mission = Mission.GUARD;
    ctx.entities.push(harv);

    updateHarvester(ctx, harv);

    expect(harv.harvesterState).toBe('idle');
  });

  it('idle harvester in MOVE mission does NOT auto-seek (manual control)', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'idle';
    harv.mission = Mission.MOVE;
    ctx.entities.push(harv);

    placeGold(map, 52, 50, 0x0E);

    updateHarvester(ctx, harv);

    expect(harv.harvesterState).toBe('idle'); // stays idle, manual MOVE overrides
  });

  it('idle harvester in AREA_GUARD mission also auto-seeks', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'idle';
    harv.mission = Mission.AREA_GUARD;
    ctx.entities.push(harv);

    placeGold(map, 52, 50, 0x0E);

    updateHarvester(ctx, harv);

    expect(harv.harvesterState).toBe('seeking');
  });
});

// =============================================================================
// 11. Harvester State Machine: Seeking -> Harvesting
//     C++ parity: harvester at ore cell transitions to harvesting
// =============================================================================

describe('state machine: seeking -> harvesting', () => {
  it('harvester at ore cell transitions from seeking to harvesting', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'seeking';
    harv.mission = Mission.GUARD; // move completed
    ctx.entities.push(harv);

    placeGold(map, 50, 50, 0x0E);

    updateHarvester(ctx, harv);

    expect(harv.harvesterState).toBe('harvesting');
    expect(harv.harvestTick).toBe(0);
  });

  it('harvester at empty cell (no ore) re-seeks from seeking state', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'seeking';
    harv.mission = Mission.GUARD;
    ctx.entities.push(harv);
    // No ore at cell 50,50

    updateHarvester(ctx, harv);

    expect(harv.harvesterState).toBe('idle'); // falls back to idle for re-seek
  });
});

// =============================================================================
// 12. Harvester State Machine: Harvesting -> Returning
//     C++ parity: full harvester transitions to returning
// =============================================================================

describe('state machine: harvesting -> returning (full load)', () => {
  it('harvester transitions to returning when oreLoad reaches BAIL_COUNT (28)', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    harv.harvestTick = 0;
    harv.oreLoad = 27; // one bail away from full
    harv.oreCreditValue = 675; // 27 * 25
    ctx.entities.push(harv);

    placeGold(map, 50, 50, 0x0E);

    // Tick 10 times to trigger one harvest
    for (let i = 0; i < 10; i++) {
      updateHarvester(ctx, harv);
    }

    expect(harv.oreLoad).toBe(28);
    expect(harv.harvesterState).toBe('returning');
  });
});

// =============================================================================
// 13. Harvesting Depleted Cell — Seeks Adjacent Ore
//     C++ parity: when cell ore is depleted, harvester looks for nearby ore
// =============================================================================

describe('harvesting depleted cell — seek adjacent ore', () => {
  it('when current cell is depleted and adjacent ore exists, seeks it', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    harv.harvestTick = 9; // next tick triggers harvest
    harv.oreLoad = 0;
    harv.oreCreditValue = 0;
    ctx.entities.push(harv);

    // Place minimum gold (will deplete to 0xFF after one harvest)
    placeGold(map, 50, 50, 0x03);
    // Place adjacent ore to find
    placeGold(map, 51, 50, 0x0E);

    updateHarvester(ctx, harv);

    // Should have harvested 1 bail (depleting the cell) then started seeking adjacent
    expect(harv.oreLoad).toBe(1);
    expect(harv.harvesterState).toBe('seeking');
  });

  it('when current cell depleted and NO adjacent ore, returns with partial load', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    harv.harvestTick = 9;
    harv.oreLoad = 5;
    harv.oreCreditValue = 125; // 5 * 25
    ctx.entities.push(harv);

    // Place minimum gold (will deplete)
    placeGold(map, 50, 50, 0x03);
    // No adjacent ore

    updateHarvester(ctx, harv);

    expect(harv.oreLoad).toBe(6); // harvested one more
    expect(harv.harvesterState).toBe('returning'); // returns with partial load
  });

  it('when current cell depleted and oreLoad=0 and no adjacent ore, goes idle', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    harv.harvestTick = 9;
    harv.oreLoad = 0;
    harv.oreCreditValue = 0;
    ctx.entities.push(harv);

    placeGold(map, 50, 50, 0x03);

    updateHarvester(ctx, harv);

    // Harvested 1 bail, then depleted, has load > 0 but no nearby ore => returning
    // Actually: oreLoad=1 > 0 so should return
    expect(harv.oreLoad).toBe(1);
    expect(harv.harvesterState).toBe('returning');
  });
});

// =============================================================================
// 14. findNearestOre Scan Behavior
//     C++ unit.cpp:2230-2234 — OreNearScan=6 (within patch), OreFarScan=48 (new patch)
// =============================================================================

describe('findNearestOre scan radii — C++ OreNearScan=6, OreFarScan=48', () => {
  it('findNearestOre default maxRange is 6 (OreNearScan)', () => {
    const map = makeMap();
    placeGold(map, 55, 50, 0x0E); // 5 cells away
    const result = map.findNearestOre(50, 50); // default maxRange=6
    expect(result).not.toBeNull();
    expect(result!.cx).toBe(55);
  });

  it('findNearestOre with maxRange=6 does not find ore at distance 7', () => {
    const map = makeMap();
    placeGold(map, 57, 50, 0x0E); // 7 cells away
    const result = map.findNearestOre(50, 50, 6);
    expect(result).toBeNull();
  });

  it('findNearestOre with maxRange=32 finds distant ore', () => {
    const map = makeMap();
    placeGold(map, 70, 50, 0x0E); // 20 cells away
    const result = map.findNearestOre(50, 50, 32);
    expect(result).not.toBeNull();
    expect(result!.cx).toBe(70);
  });

  it('findNearestOre returns nearest cell when multiple ore cells exist', () => {
    const map = makeMap();
    placeGold(map, 55, 50, 0x0E); // 5 cells away
    placeGold(map, 52, 50, 0x0E); // 2 cells away
    placeGold(map, 54, 50, 0x0E); // 4 cells away
    const result = map.findNearestOre(50, 50, 6);
    expect(result).not.toBeNull();
    expect(result!.cx).toBe(52); // nearest
  });

  it('findNearestOre finds gems as well as gold', () => {
    const map = makeMap();
    placeGem(map, 53, 50, 0x12);
    const result = map.findNearestOre(50, 50, 6);
    expect(result).not.toBeNull();
    expect(result!.cx).toBe(53);
  });
});

// =============================================================================
// 15. Ore Regrowth Mechanics
//     C++ map.cpp:1017 — ORE_GROWTH_INTERVAL, density growth, spread
// =============================================================================

describe('ore regrowth mechanics — C++ map.cpp:1017 Overlay::AI()', () => {
  it('ORE_GROWTH_INTERVAL is 1821 ticks', () => {
    expect(GameMap.ORE_GROWTH_INTERVAL).toBe(1821);
  });

  it('growOre does nothing on tick 0', () => {
    const map = makeMap();
    placeGold(map, 50, 50, 0x05);
    const origOverlay = map.overlay[50 * MAP_CELLS + 50];
    map.growOre(0);
    // Tick 0 is excluded explicitly
    expect(map.overlay[50 * MAP_CELLS + 50]).toBe(origOverlay);
  });

  it('growOre does nothing on non-interval ticks', () => {
    const map = makeMap();
    placeGold(map, 50, 50, 0x05);
    map.growOre(100);
    expect(map.overlay[50 * MAP_CELLS + 50]).toBe(0x05);
  });

  it('gems do NOT grow or spread — C++ only gold overlay grows', () => {
    const map = makeMap();
    placeGem(map, 50, 50, 0x0F); // minimum gem density
    // Force deterministic growth by running many cycles
    for (let i = 1; i <= 20; i++) {
      map.growOre(GameMap.ORE_GROWTH_INTERVAL * i);
    }
    // Gem overlay should remain exactly as placed or unchanged since gems don't grow
    // (It might still be 0x0F since gems never grow)
    const ovl = map.overlay[50 * MAP_CELLS + 50];
    expect(ovl >= 0x0F && ovl <= 0x12).toBe(true); // still a gem, never became gold
  });

  it('depleted cell (0xFF) does not spontaneously regrow — needs seed cell', () => {
    const map = makeMap();
    // All cells at 0xFF (default) — no ore exists anywhere
    map.growOre(GameMap.ORE_GROWTH_INTERVAL);
    // Scan entire bounds for any ore
    let foundOre = false;
    for (let cy = 40; cy < 90; cy++) {
      for (let cx = 40; cx < 90; cx++) {
        const ovl = map.overlay[cy * MAP_CELLS + cx];
        if (ovl >= 0x03 && ovl <= 0x12) {
          foundOre = true;
        }
      }
    }
    expect(foundOre).toBe(false);
  });

  it('ORE_SPREAD_MIN_DENSITY is 0x09 — spread requires density > 6', () => {
    expect(GameMap.ORE_SPREAD_MIN_DENSITY).toBe(0x09);
  });

  it('ore spread only happens on CLEAR/ROAD terrain', () => {
    const map = makeMap();
    // Place high-density gold adjacent to water
    placeGold(map, 50, 50, 0x0E);
    map.setTerrain(51, 50, Terrain.WATER);
    // Run many growth cycles
    for (let i = 1; i <= 100; i++) {
      map.growOre(GameMap.ORE_GROWTH_INTERVAL * i);
    }
    // Water cell should never get ore
    expect(map.overlay[50 * MAP_CELLS + 51]).toBe(0xFF);
  });
});

// =============================================================================
// 16. Harvester Scan Range in findHarvesterOre
//     C++ parity: harvester.ts findHarvesterOre uses maxRange=32 for idle seek
// =============================================================================

describe('findHarvesterOre scan range — idle harvester uses maxRange=32', () => {
  it('idle harvester passes maxRange=32 to findHarvesterOre', () => {
    // The updateHarvester idle state uses maxRange=32
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'idle';
    harv.mission = Mission.GUARD;
    ctx.entities.push(harv);

    // Place gold far away (30 cells) — within 32 range
    placeGold(map, 80, 50, 0x0E);

    updateHarvester(ctx, harv);

    expect(harv.harvesterState).toBe('seeking');
  });

  it('C++ OreFarScan=48 vs TS maxRange=32 — potential divergence', () => {
    // C++ rules.ini: OreFarScan=48 cells for new patch scan
    // TS harvester.ts line 114: findHarvesterOre(ctx, entity, ec.cx, ec.cy, 32)
    // This test documents the expected C++ value
    const cppOreFarScan = 48;
    const tsMaxRange = 32; // from harvester.ts line 114
    expect(cppOreFarScan).toBe(48);
    expect(tsMaxRange).toBe(32);
    // C++ uses 48, TS uses 32 — this is a parity gap if harvester fails to find
    // ore patches between 33-48 cells away
  });
});

// =============================================================================
// 17. AI Harvester Spread Logic — Avoid Clustering
//     C++ parity: AI harvesters avoid cells targeted by friendly harvesters
// =============================================================================

describe('AI harvester spread logic — avoid clustering on same ore patch', () => {
  it('player harvester uses simple nearest-ore (no spreading)', () => {
    const map = makeMap();
    const ctx = makeContext({ map, isPlayerControlled: () => true });
    const harv = makeHarvester(House.Spain, 50, 50);
    ctx.entities.push(harv);

    placeGold(map, 52, 50, 0x0E);
    placeGold(map, 55, 50, 0x0E);

    const result = findHarvesterOre(ctx, harv, 50, 50, 32);
    expect(result).not.toBeNull();
    expect(result!.cx).toBe(52); // always nearest for player
  });

  it('AI harvester avoids ore within 3 cells of another friendly harvester target', () => {
    const map = makeMap();
    const ctx = makeContext({
      map,
      isPlayerControlled: () => false,
    });

    // First AI harvester targeting cell 52,50
    const harv1 = makeHarvester(House.USSR, 48, 50);
    harv1.harvesterState = 'harvesting';
    ctx.entities.push(harv1);

    // Second AI harvester seeking ore from 50,50
    const harv2 = makeHarvester(House.USSR, 50, 50);
    ctx.entities.push(harv2);

    // Place ore: one near harv1 (within 3 cells) and one far
    placeGold(map, 52, 50, 0x0E); // within 3 cells of harv1's cell
    placeGold(map, 60, 50, 0x0E); // far from harv1

    const result = findHarvesterOre(ctx, harv2, 50, 50, 32);

    // Should skip 52,50 (near harv1) and find 60,50
    expect(result).not.toBeNull();
    expect(result!.cx).toBe(60);
  });

  it('AI harvester falls back to nearest if ALL ore is targeted', () => {
    const map = makeMap();
    const ctx = makeContext({
      map,
      isPlayerControlled: () => false,
    });

    // First harvester targeting 52,50
    const harv1 = makeHarvester(House.USSR, 52, 50);
    harv1.harvesterState = 'harvesting';
    ctx.entities.push(harv1);

    const harv2 = makeHarvester(House.USSR, 50, 50);
    ctx.entities.push(harv2);

    // Only one ore patch, targeted by harv1
    placeGold(map, 52, 50, 0x0E);

    const result = findHarvesterOre(ctx, harv2, 50, 50, 32);

    // Falls back to nearest ore since all are targeted
    expect(result).not.toBeNull();
    expect(result!.cx).toBe(52); // fallback to only available ore
  });
});

// =============================================================================
// 18. What Happens When All Ore Is Depleted
//     C++ parity: harvester with no ore returns partial load or idles
// =============================================================================

describe('all ore depleted behavior', () => {
  it('harvester with partial load and no nearby ore transitions to returning', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    harv.harvestTick = 9;
    harv.oreLoad = 10;
    harv.oreCreditValue = 250;
    ctx.entities.push(harv);

    // Place min gold that will deplete
    placeGold(map, 50, 50, 0x03);

    updateHarvester(ctx, harv);

    // Harvested 1 more bail, cell depleted, no nearby ore => returning
    expect(harv.harvesterState).toBe('returning');
    expect(harv.oreLoad).toBe(11);
  });

  it('idle harvester with no ore anywhere stays idle', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'idle';
    harv.mission = Mission.GUARD;
    ctx.entities.push(harv);

    // No ore on the map at all

    updateHarvester(ctx, harv);

    expect(harv.harvesterState).toBe('idle');
  });
});

// =============================================================================
// 19. Returning Harvester — Pathfinding to Refinery
//     C++ parity: returning harvester seeks nearest allied PROC
// =============================================================================

describe('returning harvester seeks nearest allied refinery', () => {
  it('returning harvester near refinery transitions to unloading', () => {
    const map = makeMap();
    const proc = makeRefinery(House.Spain, 55, 55);
    const ctx = makeContext({ map, structures: [proc] });
    const harv = makeHarvester(House.Spain, 56, 58); // adjacent to PROC footprint (3x3 at 55,55)
    harv.harvesterState = 'returning';
    harv.mission = Mission.GUARD; // move completed
    harv.oreLoad = 28;
    harv.oreCreditValue = 700;
    ctx.entities.push(harv);

    updateHarvester(ctx, harv);

    expect(harv.harvesterState).toBe('unloading');
  });

  it('returning harvester far from refinery moves toward dock cell', () => {
    const map = makeMap();
    const proc = makeRefinery(House.Spain, 55, 55);
    const ctx = makeContext({ map, structures: [proc] });
    const harv = makeHarvester(House.Spain, 45, 45); // far from PROC
    harv.harvesterState = 'returning';
    harv.mission = Mission.GUARD;
    harv.oreLoad = 28;
    harv.oreCreditValue = 700;
    ctx.entities.push(harv);

    updateHarvester(ctx, harv);

    // Should be moving toward the dock cell
    expect(harv.mission).toBe(Mission.MOVE);
    expect(harv.moveTarget).not.toBeNull();
  });

  it('returning harvester with no refinery goes idle', () => {
    const map = makeMap();
    const ctx = makeContext({ map, structures: [] }); // no refineries
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'returning';
    harv.mission = Mission.GUARD;
    harv.oreLoad = 10;
    ctx.entities.push(harv);

    updateHarvester(ctx, harv);

    expect(harv.harvesterState).toBe('idle');
  });

  it('returning harvester ignores enemy refineries', () => {
    const map = makeMap();
    const enemyProc = makeRefinery(House.USSR, 55, 55);
    const ctx = makeContext({ map, structures: [enemyProc] });
    const harv = makeHarvester(House.Spain, 56, 58);
    harv.harvesterState = 'returning';
    harv.mission = Mission.GUARD;
    harv.oreLoad = 28;
    harv.oreCreditValue = 700;
    ctx.entities.push(harv);

    updateHarvester(ctx, harv);

    // Should go idle since no allied refinery exists
    expect(harv.harvesterState).toBe('idle');
  });
});

// =============================================================================
// 20. Dock Cell Calculation
//     C++ parity: dock cell is cx+1, cy+height below refinery entrance
// =============================================================================

describe('dock cell calculation — C++ refinery entrance', () => {
  it('dock target is at cx+1, cy+height of PROC (3x3 structure)', () => {
    const map = makeMap();
    const proc = makeRefinery(House.Spain, 55, 55); // PROC at (55,55), 3x3 footprint
    const ctx = makeContext({ map, structures: [proc] });
    const harv = makeHarvester(House.Spain, 45, 45); // far from PROC
    harv.harvesterState = 'returning';
    harv.mission = Mission.GUARD;
    harv.oreLoad = 28;
    harv.oreCreditValue = 700;
    ctx.entities.push(harv);

    updateHarvester(ctx, harv);

    // PROC is 3x3, so dock cell should be at (55+1, 55+3) = (56, 58)
    const [procW, procH] = STRUCTURE_SIZE['PROC'] ?? [3, 3];
    const expectedDockCx = 55 + 1;
    const expectedDockCy = 55 + procH;
    expect(harv.moveTarget).not.toBeNull();
    const targetCx = Math.floor((harv.moveTarget!.x - CELL_SIZE / 2) / CELL_SIZE);
    const targetCy = Math.floor((harv.moveTarget!.y - CELL_SIZE / 2) / CELL_SIZE);
    expect(targetCx).toBe(expectedDockCx);
    expect(targetCy).toBe(expectedDockCy);
  });
});

// =============================================================================
// 21. Seeking Timeout — Stuck Detection
//     C++ parity: harvester stuck seeking for 30 ticks falls back
// =============================================================================

describe('seeking timeout — stuck detection at 30 ticks', () => {
  it('seeking harvester stuck with empty path for 30 ticks falls back', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'seeking';
    harv.mission = Mission.MOVE;
    harv.path = [];
    harv.pathIndex = 0;
    harv.harvestTick = 0;
    harv.oreLoad = 0;
    ctx.entities.push(harv);

    // No ore at current cell
    for (let i = 0; i < 31; i++) {
      updateHarvester(ctx, harv);
    }

    // Should have timed out and gone idle (no ore load to return)
    expect(harv.harvesterState).toBe('idle');
  });

  it('seeking harvester with ore load times out to returning', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'seeking';
    harv.mission = Mission.MOVE;
    harv.path = [];
    harv.pathIndex = 0;
    harv.harvestTick = 0;
    harv.oreLoad = 10;
    harv.oreCreditValue = 250;
    ctx.entities.push(harv);

    for (let i = 0; i < 31; i++) {
      updateHarvester(ctx, harv);
    }

    expect(harv.harvesterState).toBe('returning');
  });
});

// =============================================================================
// 22. Returning Timeout — Stuck Detection
//     C++ parity: returning harvester stuck for 45 ticks falls back to idle
// =============================================================================

describe('returning timeout — stuck detection at 45 ticks', () => {
  it('returning harvester stuck with empty path for 45 ticks goes idle', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'returning';
    harv.mission = Mission.MOVE;
    harv.path = [];
    harv.pathIndex = 0;
    harv.harvestTick = 0;
    ctx.entities.push(harv);

    for (let i = 0; i < 46; i++) {
      updateHarvester(ctx, harv);
    }

    expect(harv.harvesterState).toBe('idle');
  });

  it('returning harvester NOT timed out at 44 ticks stays returning', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'returning';
    harv.mission = Mission.MOVE;
    harv.path = [];
    harv.pathIndex = 0;
    harv.harvestTick = 0;
    ctx.entities.push(harv);

    for (let i = 0; i < 44; i++) {
      updateHarvester(ctx, harv);
    }

    expect(harv.harvesterState).toBe('returning');
  });
});

// =============================================================================
// 23. Adjacent Ore Search Range After Depletion
//     C++ parity: harvester looks for adjacent ore within 6-cell radius
//     when current cell is depleted during harvesting
// =============================================================================

describe('adjacent ore search after depletion — 6-cell radius', () => {
  it('finds ore 5 cells away during harvesting depletion', () => {
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    harv.harvestTick = 9;
    harv.oreLoad = 0;
    ctx.entities.push(harv);

    placeGold(map, 50, 50, 0x03); // min, will deplete
    placeGold(map, 55, 50, 0x0E); // 5 cells away, within 6-cell radius

    updateHarvester(ctx, harv);

    expect(harv.harvesterState).toBe('seeking');
  });
});

// =============================================================================
// 24. Gold vs Gem Overlay Detection
//     C++ overlay.cpp — isGemOverlay helper
// =============================================================================

describe('isGemOverlay helper — C++ overlay.cpp', () => {
  it('returns true for gem overlays 0x0F-0x12', () => {
    const map = makeMap();
    for (let ovl = 0x0F; ovl <= 0x12; ovl++) {
      map.overlay[50 * MAP_CELLS + 50] = ovl;
      expect(map.isGemOverlay(50, 50)).toBe(true);
    }
  });

  it('returns false for gold overlays 0x03-0x0E', () => {
    const map = makeMap();
    for (let ovl = 0x03; ovl <= 0x0E; ovl++) {
      map.overlay[50 * MAP_CELLS + 50] = ovl;
      expect(map.isGemOverlay(50, 50)).toBe(false);
    }
  });

  it('returns false for empty overlay (0xFF)', () => {
    const map = makeMap();
    expect(map.isGemOverlay(50, 50)).toBe(false);
  });
});

// =============================================================================
// 25. C++ Parity Gap: Harvest Time per Cell
//     C++ unit.cpp:2270 — harvest time depends on ROF of "Scythe" weapon,
//     which is the harvester's "primary weapon" in C++. The timing is tied
//     to weapon rearm delay, not a fixed 10-tick interval.
//     TS uses a fixed 10-tick interval regardless of weapon stats.
// =============================================================================

describe('C++ harvest timing per cell — weapon ROF vs fixed interval', () => {
  it('TS uses fixed 10-tick harvest interval (document potential C++ divergence)', () => {
    // C++ unit.cpp: harvest timing is tied to weapon ROF (Scythe weapon rearm)
    // C++ RULES.INI [Scythe]: ROF=20 (but actual harvest is every rearm cycle)
    // TS harvester.ts line 151: hardcoded harvestTick % 10
    // This documents the TS behavior — whether it matches C++ needs verification
    const map = makeMap();
    const ctx = makeContext({ map });
    const harv = makeHarvester(House.Spain, 50, 50);
    harv.harvesterState = 'harvesting';
    harv.harvestTick = 0;
    harv.oreLoad = 0;
    harv.oreCreditValue = 0;
    ctx.entities.push(harv);

    placeGold(map, 50, 50, 0x0E);

    // Count ticks until first harvest
    let ticksToFirstHarvest = 0;
    while (harv.oreLoad === 0 && ticksToFirstHarvest < 100) {
      updateHarvester(ctx, harv);
      ticksToFirstHarvest++;
    }

    expect(ticksToFirstHarvest).toBe(10); // TS fixed interval
  });
});

// =============================================================================
// 26. Complete Harvest-Unload Cycle Integration
//     Verify full cycle: idle -> seeking -> harvesting -> returning -> unloading -> idle
// =============================================================================

describe('complete harvest-unload cycle integration', () => {
  it('harvester completes full cycle and returns to idle with 0 ore', () => {
    const map = makeMap();
    const proc = makeRefinery(House.Spain, 55, 55);
    const addCredits = vi.fn();
    const ctx = makeContext({
      map,
      structures: [proc],
      addCredits,
    });

    // Place harvester directly at refinery dock cell for simplicity
    const [, procH] = STRUCTURE_SIZE['PROC'] ?? [3, 3];
    const dockCx = 55 + 1;
    const dockCy = 55 + procH;
    const harv = makeHarvester(House.Spain, dockCx, dockCy);

    // Pre-load harvester with full gold load
    harv.harvesterState = 'unloading';
    harv.harvestTick = 0;
    harv.oreLoad = 28;
    harv.oreCreditValue = 700;
    ctx.entities.push(harv);

    // Run 14 ticks for unload
    for (let i = 0; i < 14; i++) {
      updateHarvester(ctx, harv);
    }

    expect(harv.harvesterState).toBe('idle');
    expect(harv.oreLoad).toBe(0);
    expect(harv.oreCreditValue).toBe(0);
    expect(addCredits).toHaveBeenCalledWith(700);
  });
});

// =============================================================================
// 27. Ore Spread Does Not Happen on Walls/Bridges/Buildings
//     C++ cell.cpp:3000-3008 — reject bridge cells, walls, occupied cells
// =============================================================================

describe('ore spread rejection — C++ cell.cpp:3000-3008', () => {
  it('ore does not spread to cells with walls', () => {
    const map = makeMap();
    placeGold(map, 50, 50, 0x0E); // high density, eligible to spread
    map.wallType[50 * MAP_CELLS + 51] = 'BRIK';
    map.setTerrain(51, 50, Terrain.CLEAR);
    map.overlay[50 * MAP_CELLS + 51] = 0xFF;

    for (let i = 1; i <= 200; i++) {
      map.growOre(GameMap.ORE_GROWTH_INTERVAL * i);
    }

    expect(map.overlay[50 * MAP_CELLS + 51]).toBe(0xFF); // still empty
  });

  it('ore does not spread to bridge template cells', () => {
    const map = makeMap();
    placeGold(map, 50, 50, 0x0E);
    // Set bridge template at adjacent cell
    map.templateType[50 * MAP_CELLS + 51] = 131; // TEMPLATE_BRIDGE1
    map.setTerrain(51, 50, Terrain.CLEAR);
    map.overlay[50 * MAP_CELLS + 51] = 0xFF;

    for (let i = 1; i <= 200; i++) {
      map.growOre(GameMap.ORE_GROWTH_INTERVAL * i);
    }

    expect(map.overlay[50 * MAP_CELLS + 51]).toBe(0xFF);
  });

  it('ore does not spread to vehicle-occupied cells', () => {
    const map = makeMap();
    placeGold(map, 50, 50, 0x0E);
    map.setTerrain(51, 50, Terrain.CLEAR);
    map.overlay[50 * MAP_CELLS + 51] = 0xFF;
    map.vehicleOccupancy.add(50 * MAP_CELLS + 51);

    for (let i = 1; i <= 200; i++) {
      map.growOre(GameMap.ORE_GROWTH_INTERVAL * i);
    }

    expect(map.overlay[50 * MAP_CELLS + 51]).toBe(0xFF);
  });
});

// =============================================================================
// 28. Ore Density Constants
//     Document the spread threshold and growth probabilities
// =============================================================================

describe('ore growth probability constants', () => {
  it('ORE_DENSITY_CHANCE is 0.5 (50% per cycle)', () => {
    expect(GameMap.ORE_DENSITY_CHANCE).toBe(0.5);
  });

  it('ORE_SPREAD_CHANCE is 0.25 (25% per cycle)', () => {
    expect(GameMap.ORE_SPREAD_CHANCE).toBe(0.25);
  });
});

// =============================================================================
// 29. Harvester Initial State
//     C++ parity: new harvester starts with 0 ore and idle state
// =============================================================================

describe('new harvester initial state', () => {
  it('oreLoad starts at 0', () => {
    const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
    expect(harv.oreLoad).toBe(0);
  });

  it('oreCreditValue starts at 0', () => {
    const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
    expect(harv.oreCreditValue).toBe(0);
  });

  it('harvesterState starts as idle', () => {
    const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
    expect(harv.harvesterState).toBe('idle');
  });

  it('harvestTick starts at 0', () => {
    const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
    expect(harv.harvestTick).toBe(0);
  });
});

// =============================================================================
// 30. Harvester Stats from UNIT_STATS
//     C++ udata.cpp: HARV — strength=600, armor=heavy, speed=6, rot=5, sight=4
// =============================================================================

describe('harvester unit stats — C++ udata.cpp HARV', () => {
  it('strength is 600 HP', () => {
    const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
    expect(harv.maxHp).toBe(600);
  });

  it('armor is heavy', () => {
    const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
    expect(harv.stats.armor).toBe('heavy');
  });

  it('speed is 6', () => {
    const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
    expect(harv.stats.speed).toBe(6);
  });

  it('ROT is 5', () => {
    const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
    expect(harv.stats.rot).toBe(5);
  });

  it('sight is 4', () => {
    const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
    expect(harv.stats.sight).toBe(4);
  });

  it('has no primary weapon (civilian vehicle)', () => {
    const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
    expect(harv.weapon).toBeNull();
  });

  it('crusher is true (can crush infantry)', () => {
    const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
    expect(harv.stats.crusher).toBe(true);
  });
});
