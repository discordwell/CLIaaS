/**
 * C++ behavioral parity tests: sidebar production strip ordering.
 *
 * C++ reference: sidebar.cpp:445 — SidebarClass::Which_Column():
 *   int SidebarClass::Which_Column(RTTIType type)
 *   {
 *       if (type == RTTI_BUILDINGTYPE || type == RTTI_BUILDING) {
 *           return(0);
 *       }
 *       return(1);
 *   }
 *
 * Column 0 (left strip)  = structures only (RTTI_BUILDING / RTTI_BUILDINGTYPE)
 * Column 1 (right strip) = everything else: infantry, units, vehicles, aircraft,
 *                           vessels, special weapons (RTTI_INFANTRYTYPE, RTTI_UNITTYPE,
 *                           RTTI_AIRCRAFTTYPE, RTTI_VESSELTYPE, RTTI_SPECIAL)
 *
 * C++ sidebar.cpp:669 — SidebarClass::Add():
 *   Uses Which_Column(type) to route items to Column[0] or Column[1].
 *   Each column is an independent StripClass with its own BuildableCount,
 *   scroll position (TopIndex), and factory link.
 *
 * C++ sidebar.h:106 — COLUMNS=2 (exactly two strips, no more)
 * C++ sidebar.h:193 — MAX_BUILDABLES=75 per strip
 * C++ sidebar.h:197 — MAX_VISIBLE=4 (4 cameo slots visible at once per strip)
 *
 * TS implementation:
 *   types.ts:905-910 — StripType 'left' | 'right', getStripSide() routes by isStructure
 *   production.ts:110 — startProduction() uses getStripSide() as the queue key
 *   renderer.ts:3520-3521 — Filters sidebarItems into leftItems/rightItems via getStripSide()
 */

import { describe, it, expect } from 'vitest';
import {
  type ProductionItem,
  type StripType,
  getStripSide,
  getFactoryType,
  type FactoryType,
  PRODUCTION_ITEMS,
} from '../engine/types';
import {
  startProduction,
  cancelProduction,
  tickProduction,
  getAvailableItems,
  type ProductionContext,
} from '../engine/production';
import type { House, Faction, WorldPos } from '../engine/types';
import type { MapStructure } from '../engine/scenario';
import type { GameMap } from '../engine/map';

// ── Test helpers ────────────────────────────────────────────────────────────

const makeItem = (overrides: Partial<ProductionItem> = {}): ProductionItem => ({
  type: '2TNK',
  name: 'Medium Tank',
  cost: 800,
  buildTime: 100,
  prerequisite: 'WEAP',
  faction: 'both' as const,
  isStructure: false,
  ...overrides,
});

const makeStructure = (type: string, house: House = 'Greece'): MapStructure => ({
  type,
  house,
  cx: 10,
  cy: 10,
  alive: true,
  hp: 400,
  maxHp: 400,
} as MapStructure);

const makeContext = (overrides: Partial<ProductionContext> = {}): ProductionContext => {
  const structures: MapStructure[] = [
    makeStructure('FACT', 'Greece'),
    makeStructure('WEAP', 'Greece'),
    makeStructure('TENT', 'Greece'),
    makeStructure('BARR', 'Greece'),
    makeStructure('POWR', 'Greece'),
    makeStructure('PROC', 'Greece'),
    makeStructure('DOME', 'Greece'),
    makeStructure('AFLD', 'Greece'),
    makeStructure('SYRD', 'Greece'),
    makeStructure('SPEN', 'Greece'),
  ];

  return {
    structures,
    entities: [],
    entityById: new Map(),
    credits: 100000,
    playerHouse: 'Greece' as House,
    playerFaction: 'allied' as Faction,
    playerTechLevel: 15,
    baseDiscovered: true,
    scenarioProductionItems: PRODUCTION_ITEMS,
    productionQueue: new Map(),
    pendingPlacement: null,
    wallPlacementPrepaid: false,
    map: {} as GameMap,
    tick: 0,
    powerProduced: 500,
    powerConsumed: 100,
    builtUnitTypes: new Set(),
    builtInfantryTypes: new Set(),
    builtAircraftTypes: new Set(),
    rallyPoints: new Map(),
    isAllied: (a: House, b: House) => a === b,
    hasBuilding: (type: string) => structures.some(s => s.type === type && s.alive),
    playSound: () => {},
    playEva: () => {},
    addEntity: () => {},
    findPassableSpawn: (cx, cy) => ({ cx, cy }),
    ...overrides,
  };
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('C++ parity: sidebar strip assignment — Which_Column (sidebar.cpp:445)', () => {

  // ── Core routing: structures → left (column 0), everything else → right (column 1) ──

  it('structures route to left strip (column 0)', () => {
    // C++ sidebar.cpp:447: if (type == RTTI_BUILDINGTYPE || type == RTTI_BUILDING) return(0);
    const structureItems = PRODUCTION_ITEMS.filter(i => i.isStructure);
    expect(structureItems.length).toBeGreaterThan(0);

    for (const item of structureItems) {
      expect(getStripSide(item), `${item.type} should route to left strip`).toBe('left');
    }
  });

  it('infantry routes to right strip (column 1)', () => {
    // C++ sidebar.cpp:450: return(1); — all non-building types go to column 1
    const infantryItems = PRODUCTION_ITEMS.filter(i =>
      ['E1', 'E2', 'E3', 'E4', 'E6', 'E7', 'DOG', 'SHOK', 'MEDI', 'SPY', 'THF', 'MECH'].includes(i.type)
    );
    expect(infantryItems.length).toBeGreaterThan(0);

    for (const item of infantryItems) {
      expect(getStripSide(item), `infantry ${item.type} should route to right strip`).toBe('right');
    }
  });

  it('vehicles route to right strip (column 1)', () => {
    const vehicleItems = PRODUCTION_ITEMS.filter(i =>
      ['2TNK', '1TNK', '3TNK', '4TNK', 'JEEP', 'APC', 'ARTY', 'HARV', 'MCV', 'V2RL', 'MRJ', 'MGG', 'MNLY', 'CTNK'].includes(i.type)
    );
    expect(vehicleItems.length).toBeGreaterThan(0);

    for (const item of vehicleItems) {
      expect(getStripSide(item), `vehicle ${item.type} should route to right strip`).toBe('right');
    }
  });

  it('aircraft routes to right strip (column 1)', () => {
    const aircraftItems = PRODUCTION_ITEMS.filter(i =>
      ['HIND', 'HELI', 'MIG', 'YAK', 'TRAN', 'BADR'].includes(i.type)
    );
    // Some aircraft may not be in PRODUCTION_ITEMS if not buildable
    for (const item of aircraftItems) {
      expect(getStripSide(item), `aircraft ${item.type} should route to right strip`).toBe('right');
    }
  });

  it('vessels route to right strip (column 1)', () => {
    const vesselItems = PRODUCTION_ITEMS.filter(i =>
      ['SS', 'DD', 'CA', 'PT', 'MSUB'].includes(i.type)
    );
    for (const item of vesselItems) {
      expect(getStripSide(item), `vessel ${item.type} should route to right strip`).toBe('right');
    }
  });

  // ── Exhaustive: every PRODUCTION_ITEM obeys the rule ──

  it('every production item routes to correct strip: structures→left, non-structures→right', () => {
    // C++ sidebar.cpp:445-451: Which_Column is a simple binary check
    for (const item of PRODUCTION_ITEMS) {
      const expected: StripType = item.isStructure ? 'left' : 'right';
      expect(getStripSide(item), `${item.type} (isStructure=${item.isStructure})`).toBe(expected);
    }
  });

  // ── Exactly two strips (C++ sidebar.h:106 — COLUMNS=2) ──

  it('strip system has exactly two values: left and right', () => {
    // C++ sidebar.h:106: COLUMNS=2
    const strips = new Set<StripType>();
    for (const item of PRODUCTION_ITEMS) {
      strips.add(getStripSide(item));
    }
    // Must have both strips populated
    expect(strips.has('left')).toBe(true);
    expect(strips.has('right')).toBe(true);
    expect(strips.size).toBe(2);
  });
});

describe('C++ parity: independent strip queues (sidebar.cpp:669)', () => {

  // ── Each strip has its own independent production queue ──

  it('left and right strips have independent queues', () => {
    // C++ sidebar.cpp:669-689: SidebarClass::Add routes to Column[Which_Column(type)]
    // Each Column is its own StripClass with its own Buildables[] array
    const ctx = makeContext();
    const structureItem = makeItem({ type: 'POWR', name: 'Power Plant', cost: 300, buildTime: 100, prerequisite: 'FACT', isStructure: true });
    const unitItem = makeItem({ type: '2TNK', name: 'Medium Tank', cost: 800, buildTime: 100, prerequisite: 'WEAP', isStructure: false });

    startProduction(ctx, structureItem);
    startProduction(ctx, unitItem);

    // Both queues should exist simultaneously (using factory type keys)
    expect(ctx.productionQueue.has('building')).toBe(true);
    expect(ctx.productionQueue.has('unit')).toBe(true);
  });

  it('cancelling one strip does not affect the other', () => {
    // C++ sidebar.cpp:2305-2308: Abandon_Production routes via Which_Column
    // cancelling a building does not affect unit strip and vice versa
    const ctx = makeContext();
    const structureItem = makeItem({ type: 'POWR', name: 'Power Plant', cost: 300, buildTime: 100, prerequisite: 'FACT', isStructure: true });
    const unitItem = makeItem({ type: '2TNK', name: 'Medium Tank', cost: 800, buildTime: 100, prerequisite: 'WEAP', isStructure: false });

    startProduction(ctx, structureItem);
    startProduction(ctx, unitItem);

    // Cancel the structure — unit should still be building
    cancelProduction(ctx, 'building');
    expect(ctx.productionQueue.has('building')).toBe(false);
    expect(ctx.productionQueue.has('unit')).toBe(true);
  });

  it('production progress on one strip is independent of the other', () => {
    // C++ factory.cpp:206: each FactoryClass runs independently
    const ctx = makeContext();
    const structureItem = makeItem({ type: 'POWR', name: 'Power Plant', cost: 300, buildTime: 100, prerequisite: 'FACT', isStructure: true });
    const unitItem = makeItem({ type: '2TNK', name: 'Medium Tank', cost: 800, buildTime: 200, prerequisite: 'WEAP', isStructure: false });

    startProduction(ctx, structureItem);
    startProduction(ctx, unitItem);

    // Tick 50 times
    for (let i = 0; i < 50; i++) {
      tickProduction(ctx);
      ctx.tick++;
    }

    const leftProgress = ctx.productionQueue.get('building')?.progress;
    const rightProgress = ctx.productionQueue.get('unit')?.progress;

    // Both should have advanced independently at 1 per tick (full power)
    expect(leftProgress).toBe(50);
    expect(rightProgress).toBe(50);
  });

  it('structure completing does not interrupt unit production', () => {
    // C++ sidebar.cpp:669: each Column is independent
    const ctx = makeContext();
    const structureItem = makeItem({ type: 'POWR', name: 'Power Plant', cost: 300, buildTime: 20, prerequisite: 'FACT', isStructure: true });
    const unitItem = makeItem({ type: '2TNK', name: 'Medium Tank', cost: 800, buildTime: 100, prerequisite: 'WEAP', isStructure: false });

    startProduction(ctx, structureItem);
    startProduction(ctx, unitItem);

    // Tick past structure completion
    for (let i = 0; i < 30; i++) {
      tickProduction(ctx);
      ctx.tick++;
    }

    // Structure should be complete (pendingPlacement set)
    expect(ctx.pendingPlacement).not.toBeNull();
    // Unit should still be building
    expect(ctx.productionQueue.has('unit')).toBe(true);
    expect(ctx.productionQueue.get('unit')?.progress).toBe(30);
  });
});

describe('C++ parity: strip item routing for specific RTTI types', () => {

  // ── C++ defines.h:405-440 RTTI enum → Which_Column mapping ──

  it('RTTI_BUILDING and RTTI_BUILDINGTYPE → column 0 (left)', () => {
    // C++ sidebar.cpp:447-448: these two types go to column 0
    // In TS, these are items with isStructure: true
    const structures = PRODUCTION_ITEMS.filter(i => i.isStructure);
    expect(structures.length).toBeGreaterThan(5); // there are many structures

    // Known C++ structures that must be on left strip
    const knownStructures = ['POWR', 'APWR', 'PROC', 'WEAP', 'DOME', 'FIX', 'SILO'];
    for (const type of knownStructures) {
      const item = PRODUCTION_ITEMS.find(i => i.type === type);
      if (item) {
        expect(getStripSide(item), `${type} = RTTI_BUILDINGTYPE → column 0`).toBe('left');
      }
    }
  });

  it('RTTI_INFANTRYTYPE → column 1 (right)', () => {
    // C++ sidebar.cpp:450: everything non-building → column 1
    // Infantry have prerequisite TENT or BARR, isStructure is NOT set
    const infantry = PRODUCTION_ITEMS.filter(i =>
      (i.prerequisite === 'TENT' || i.prerequisite === 'BARR' || i.prerequisite === 'KENN') && !i.isStructure
    );
    expect(infantry.length).toBeGreaterThan(0);

    for (const item of infantry) {
      expect(getStripSide(item), `infantry ${item.type} → column 1`).toBe('right');
    }
  });

  it('RTTI_UNITTYPE → column 1 (right)', () => {
    // Vehicles built from WEAP, not structures
    const vehicles = PRODUCTION_ITEMS.filter(i => i.prerequisite === 'WEAP' && !i.isStructure);
    expect(vehicles.length).toBeGreaterThan(0);

    for (const item of vehicles) {
      expect(getStripSide(item), `vehicle ${item.type} → column 1`).toBe('right');
    }
  });

  it('RTTI_AIRCRAFTTYPE → column 1 (right)', () => {
    // Aircraft built from AFLD or HPAD
    const aircraft = PRODUCTION_ITEMS.filter(i =>
      (i.prerequisite === 'AFLD' || i.prerequisite === 'HPAD') && !i.isStructure
    );

    for (const item of aircraft) {
      expect(getStripSide(item), `aircraft ${item.type} → column 1`).toBe('right');
    }
  });

  it('RTTI_VESSELTYPE → column 1 (right)', () => {
    // Vessels built from SYRD or SPEN
    const vessels = PRODUCTION_ITEMS.filter(i =>
      (i.prerequisite === 'SYRD' || i.prerequisite === 'SPEN') && !i.isStructure
    );

    for (const item of vessels) {
      expect(getStripSide(item), `vessel ${item.type} → column 1`).toBe('right');
    }
  });
});

describe('C++ parity: production queue key matches getFactoryType (house.cpp:6961-6990)', () => {

  it('starting a structure uses "building" as the queue key', () => {
    // C++ house.cpp:6961: Fetch_Factory(RTTI_BUILDING) → BuildingFactory
    const ctx = makeContext();
    const item = makeItem({ type: 'POWR', cost: 300, buildTime: 100, prerequisite: 'FACT', isStructure: true });

    startProduction(ctx, item);
    expect(ctx.productionQueue.has('building')).toBe(true);
    expect(ctx.productionQueue.size).toBe(1);
  });

  it('starting a unit uses "unit" as the queue key', () => {
    const ctx = makeContext();
    const item = makeItem({ type: '2TNK', cost: 800, buildTime: 100, prerequisite: 'WEAP', isStructure: false });

    startProduction(ctx, item);
    expect(ctx.productionQueue.has('unit')).toBe(true);
    expect(ctx.productionQueue.size).toBe(1);
  });

  it('starting infantry uses "infantry" as the queue key (separate from vehicles)', () => {
    // C++ house.cpp:6966: Fetch_Factory(RTTI_INFANTRY) → InfantryFactory
    // Infantry and vehicles have SEPARATE factories in C++.
    const ctx = makeContext();
    const item = makeItem({ type: 'E1', name: 'Rifle', cost: 100, buildTime: 45, prerequisite: 'TENT', isStructure: false });

    startProduction(ctx, item);
    expect(ctx.productionQueue.has('infantry')).toBe(true);
    expect(ctx.productionQueue.size).toBe(1);
  });
});

describe('C++ parity: strip constants (sidebar.h)', () => {

  it('MAX_BUILDABLES is 75 per strip', () => {
    // C++ sidebar.h:193: MAX_BUILDABLES=75
    // Verify PRODUCTION_ITEMS per strip doesn't exceed this limit
    const leftCount = PRODUCTION_ITEMS.filter(i => i.isStructure).length;
    const rightCount = PRODUCTION_ITEMS.filter(i => !i.isStructure).length;

    expect(leftCount).toBeLessThanOrEqual(75);
    expect(rightCount).toBeLessThanOrEqual(75);
  });

  it('exactly 2 columns exist', () => {
    // C++ sidebar.h:106: COLUMNS=2
    // The TS type is 'left' | 'right' — exactly two possible values
    const allStrips = PRODUCTION_ITEMS.map(i => getStripSide(i));
    const uniqueStrips = new Set(allStrips);
    expect(uniqueStrips.size).toBe(2);
  });
});

describe('C++ parity: duplicate rejection — one item per factory (house.cpp:2413)', () => {

  it('starting production of the same factory type item twice increments queue count', () => {
    // C++ house.cpp:2413: if factory Is_Building → queue (up to max)
    // TS production.ts: checks existing entry and either increments queueCount or returns
    const ctx = makeContext();
    const item = makeItem({ type: '2TNK', cost: 800, buildTime: 100, prerequisite: 'WEAP' });

    startProduction(ctx, item);
    startProduction(ctx, item); // second call — should queue, not create separate entry

    // Should still have exactly one entry in the 'unit' factory
    expect(ctx.productionQueue.size).toBe(1);
    expect(ctx.productionQueue.get('unit')?.queueCount).toBe(2);
  });

  it('infantry and vehicles produce simultaneously (different factory types)', () => {
    // C++ house.cpp:6961-6990: InfantryFactory and UnitFactory are separate
    const ctx = makeContext();
    const tank = makeItem({ type: '2TNK', cost: 800, buildTime: 100, prerequisite: 'WEAP' });
    const infantry = makeItem({ type: 'E1', name: 'Rifle', cost: 100, buildTime: 45, prerequisite: 'TENT' });

    startProduction(ctx, tank);
    startProduction(ctx, infantry); // different factory type → starts simultaneously

    // Both should be building on separate factories
    expect(ctx.productionQueue.get('unit')?.item.type).toBe('2TNK');
    expect(ctx.productionQueue.get('infantry')?.item.type).toBe('E1');
    expect(ctx.productionQueue.size).toBe(2);
  });
});

describe('C++ parity: one active production per factory type (house.cpp:6957)', () => {

  it('only one structure can build at a time on building factory', () => {
    // C++ house.cpp:6957: one BuildingFactory per house
    const ctx = makeContext();
    const powr = makeItem({ type: 'POWR', cost: 300, buildTime: 100, prerequisite: 'FACT', isStructure: true });
    const proc = makeItem({ type: 'PROC', cost: 2000, buildTime: 200, prerequisite: 'POWR', isStructure: true });

    startProduction(ctx, powr);
    startProduction(ctx, proc); // should not start — building factory already occupied

    // Only POWR should be building
    expect(ctx.productionQueue.get('building')?.item.type).toBe('POWR');
    expect(ctx.productionQueue.size).toBe(1);
  });

  it('infantry and vehicles can build simultaneously (different factory types)', () => {
    // C++ house.cpp:6961-6990: InfantryFactory and UnitFactory are separate
    const ctx = makeContext();
    const tank = makeItem({ type: '2TNK', cost: 800, buildTime: 100, prerequisite: 'WEAP' });
    const infantry = makeItem({ type: 'E1', cost: 100, buildTime: 45, prerequisite: 'TENT' });

    startProduction(ctx, tank);
    startProduction(ctx, infantry); // different factory type — starts simultaneously

    // Both building on separate factories
    expect(ctx.productionQueue.get('unit')?.item.type).toBe('2TNK');
    expect(ctx.productionQueue.get('infantry')?.item.type).toBe('E1');
    expect(ctx.productionQueue.size).toBe(2);
  });

  it('can build structure AND unit simultaneously (different factory types)', () => {
    // C++ house.cpp:6957: each factory type is independent
    const ctx = makeContext();
    const powr = makeItem({ type: 'POWR', cost: 300, buildTime: 100, prerequisite: 'FACT', isStructure: true });
    const tank = makeItem({ type: '2TNK', cost: 800, buildTime: 100, prerequisite: 'WEAP' });

    startProduction(ctx, powr);
    startProduction(ctx, tank);

    // Both should be building simultaneously — each on its own factory
    expect(ctx.productionQueue.has('building')).toBe(true);
    expect(ctx.productionQueue.has('unit')).toBe(true);
    expect(ctx.productionQueue.get('building')?.item.type).toBe('POWR');
    expect(ctx.productionQueue.get('unit')?.item.type).toBe('2TNK');
  });
});
