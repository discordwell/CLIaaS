/**
 * C++ Behavioral Parity: AI Unit/Infantry/Building Cap Enforcement
 *
 * Tests verify that per-house production caps match C++ Red Alert source code.
 * C++ reference files:
 *   - house.h:87-91   — HouseStaticClass::MaxUnit, MaxBuilding, MaxInfantry, MaxVessel, MaxAircraft
 *   - house.cpp:755-759 — default cap values: MaxUnit=Rule.UnitMax/6, etc.
 *   - house.cpp:5795   — AI_Unit():   if (CurUnits >= Control.MaxUnit) return
 *   - house.cpp:6048   — AI_Infantry(): if (CurInfantry >= Control.MaxInfantry) return
 *   - house.cpp:5926   — AI_Vessel():  if (CurVessels >= Control.MaxVessel) return
 *   - house.cpp:6245   — AI_Aircraft(): if (CurAircraft >= Control.MaxAircraft) return
 *   - house.cpp:7141-7145 — Read_INI: MaxBuilding, MaxUnit, MaxInfantry, MaxVessel from scenario INI
 *   - house.cpp:7145   — if (MaxVessel == 0) MaxVessel = MaxUnit
 *   - house.cpp:4726-4740 — dynamic cap increase: caps raised to enemyAvg + 10
 *   - house.cpp:6355-6508 — Tracking_Add/Tracking_Remove: CurX++ / CurX--
 *   - rules.cpp:240-254 — default Rule values: UnitMax=500, BuildingMax=500,
 *                          InfantryMax=500, VesselMax=100, AircraftMax=100
 *
 * C++ cap enforcement pattern (same for all five categories):
 *   ```cpp
 *   // house.cpp:5795 (AI_Unit example)
 *   if (CurUnits >= Control.MaxUnit) return(TICKS_PER_SECOND);
 *   ```
 * The >= comparison means production STOPS when count EQUALS the cap.
 *
 * C++ default caps (HouseStaticClass constructor, house.cpp:755-759):
 *   ```cpp
 *   MaxUnit(Rule.UnitMax/6),       // 500/6 = 83
 *   MaxBuilding(Rule.BuildingMax/6), // 500/6 = 83
 *   MaxInfantry(Rule.InfantryMax/6), // 500/6 = 83
 *   MaxVessel(Rule.VesselMax/6),     // 100/6 = 16
 *   MaxAircraft(Rule.UnitMax/6),     // 500/6 = 83 (note: UnitMax, NOT AircraftMax!)
 *   ```
 *
 * C++ dynamic cap increase (house.cpp:4726-4740):
 *   ```cpp
 *   if (Control.MaxUnit < maxunit + 10) {
 *       Control.MaxUnit = maxunit + 10;
 *   }
 *   // ... same for MaxBuilding, MaxInfantry, MaxVessel, MaxAircraft
 *   ```
 *   Where maxunit is the average CurUnits across all enemies.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  House, UnitType, CELL_SIZE,
  PRODUCTION_ITEMS,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap, Terrain } from '../engine/map';
import { STRUCTURE_SIZE, STRUCTURE_MAX_HP, type MapStructure } from '../engine/scenario';
import {
  type AIContext, type AIHouseState, type Difficulty,
  AI_DIFFICULTY_MODS,
  createAIHouseState,
  updateAIProduction,
  updateAIConstruction,
  updateAIStrategicPlanner,
} from '../engine/ai';

beforeEach(() => resetEntityIds());

// =============================================================================
// Helpers
// =============================================================================

function makeStructure(
  type: string, house: House, cx = 50, cy = 50,
  opts: Partial<MapStructure> = {},
): MapStructure {
  const maxHp = opts.maxHp ?? STRUCTURE_MAX_HP[type] ?? 256;
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: opts.hp ?? maxHp,
    maxHp,
    alive: opts.alive ?? true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    ...opts,
  } as MapStructure;
}

function makeMockAIContext(overrides: Partial<AIContext> = {}): AIContext {
  const map = new GameMap();
  map.setBounds(40, 40, 30, 30);
  const alliances = buildDefaultAlliances();

  return {
    entities: [],
    entityById: new Map(),
    structures: [],
    map,
    tick: 0,
    playerHouse: House.Spain,
    scenarioId: 'SCG01EA',
    difficulty: 'normal' as Difficulty,

    aiStates: new Map(),
    houseCredits: new Map(),
    houseIQs: new Map(),
    houseTechLevels: new Map(),
    houseMaxUnits: new Map(),
    houseMaxInfantry: new Map(),
    houseMaxBuildings: new Map(),

    baseBlueprint: [],
    baseRebuildQueue: [],
    baseRebuildCooldown: 0,

    scenarioProductionItems: PRODUCTION_ITEMS,
    scenarioUnitStats: {},
    scenarioWeaponStats: {},

    nextWaveId: 0,

    autocreateEnabled: false,
    autocreateTeamCounts: new Map(),
    teamTypes: [],
    destroyedTeams: new Set(),
    waypoints: new Map(),
    houseEdges: new Map(),

    effects: [],

    isAllied: (a, b) => alliances.get(a)?.has(b) ?? false,
    isPlayerControlled: (e) => alliances.get(e.house)?.has(House.Spain) ?? false,
    clearStructureFootprint: vi.fn(),

    ...overrides,
  };
}

function addAIHouse(
  ctx: AIContext,
  house: House,
  overrides: Partial<AIHouseState> = {},
): AIHouseState {
  const state = createAIHouseState(ctx, house);
  Object.assign(state, overrides);
  ctx.aiStates.set(house, state);
  return state;
}

/** Create a mock infantry entity for cap counting */
function makeInfantryEntity(house: House, type: UnitType = UnitType.I_E1): Entity {
  const e = new Entity(type, house, 55 * CELL_SIZE, 55 * CELL_SIZE);
  return e;
}

/** Create a mock vehicle entity for cap counting */
function makeVehicleEntity(house: House, type: UnitType = UnitType.V_3TNK): Entity {
  const e = new Entity(type, house, 55 * CELL_SIZE, 55 * CELL_SIZE);
  return e;
}

/** Create a mock aircraft entity for cap counting */
function makeAircraftEntity(house: House, type: UnitType = UnitType.V_HIND): Entity {
  const e = new Entity(type, house, 55 * CELL_SIZE, 55 * CELL_SIZE);
  e.flightAltitude = Entity.FLIGHT_ALTITUDE;
  e.aircraftState = 'landed';
  return e;
}

/** Create a mock vessel entity for cap counting */
function makeVesselEntity(house: House, type: UnitType = UnitType.V_DD): Entity {
  const e = new Entity(type, house, 55 * CELL_SIZE, 55 * CELL_SIZE);
  return e;
}

/** Set up a base with FACT, TENT, and WEAP for production testing */
function setupProductionBase(
  ctx: AIContext,
  house: House = House.USSR,
  credits = 10000,
): AIHouseState {
  const fact = makeStructure('FACT', house, 50, 50);
  const tent = makeStructure('TENT', house, 54, 50);
  const weap = makeStructure('WEAP', house, 50, 54);
  ctx.structures.push(fact, tent, weap);

  // Mark footprints
  for (const s of [fact, tent, weap]) {
    const [fw, fh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        ctx.map.setTerrain(s.cx + dx, s.cy + dy, Terrain.WALL);
      }
    }
  }

  ctx.houseCredits.set(house, credits);
  const state = addAIHouse(ctx, house, {
    productionEnabled: true,
    iq: 3,
    maxUnit: -1,
    maxInfantry: -1,
    maxBuilding: -1,
  });
  return state;
}

/** Get the production interval for normal difficulty */
function getProductionTick(): number {
  const mods = AI_DIFFICULTY_MODS['normal'];
  return mods.productionInterval;
}

// =============================================================================
// 1. Infantry Cap Enforcement
// C++ house.cpp:6048: if (CurInfantry >= Control.MaxInfantry) return(TICKS_PER_SECOND);
// =============================================================================

describe('Infantry cap enforcement (C++ house.cpp:6048 AI_Infantry)', () => {
  it('blocks infantry production when CurInfantry >= MaxInfantry', () => {
    const prodTick = getProductionTick();
    const ctx = makeMockAIContext({ tick: prodTick });
    const state = setupProductionBase(ctx, House.USSR, 50000);
    state.maxInfantry = 3;

    // Pre-fill with 3 infantry (at cap)
    for (let i = 0; i < 3; i++) {
      const inf = makeInfantryEntity(House.USSR);
      ctx.entities.push(inf);
      ctx.entityById.set(inf.id, inf);
    }

    const countBefore = ctx.entities.length;
    updateAIProduction(ctx);

    // Should not produce any infantry (at cap)
    const infAfter = ctx.entities.filter(
      e => e.alive && e.house === House.USSR && e.stats.isInfantry
    ).length;
    expect(infAfter).toBe(3);
  });

  it('allows infantry production when CurInfantry < MaxInfantry', () => {
    const prodTick = getProductionTick();
    const ctx = makeMockAIContext({ tick: prodTick });
    const state = setupProductionBase(ctx, House.USSR, 50000);
    state.maxInfantry = 5;

    // Pre-fill with 2 infantry (below cap)
    for (let i = 0; i < 2; i++) {
      const inf = makeInfantryEntity(House.USSR);
      ctx.entities.push(inf);
      ctx.entityById.set(inf.id, inf);
    }

    updateAIProduction(ctx);

    const infAfter = ctx.entities.filter(
      e => e.alive && e.house === House.USSR && e.stats.isInfantry
    ).length;
    expect(infAfter).toBeGreaterThan(2);
  });

  it('allows unlimited infantry when maxInfantry is -1', () => {
    const prodTick = getProductionTick();
    const ctx = makeMockAIContext({ tick: prodTick });
    const state = setupProductionBase(ctx, House.USSR, 50000);
    state.maxInfantry = -1; // unlimited

    // Pre-fill with 100 infantry
    for (let i = 0; i < 100; i++) {
      const inf = makeInfantryEntity(House.USSR);
      ctx.entities.push(inf);
      ctx.entityById.set(inf.id, inf);
    }

    updateAIProduction(ctx);

    const infAfter = ctx.entities.filter(
      e => e.alive && e.house === House.USSR && e.stats.isInfantry
    ).length;
    // Should still produce because cap is -1 (unlimited)
    expect(infAfter).toBeGreaterThan(100);
  });

  it('C++ uses >= comparison: cap=5 with count=5 blocks production', () => {
    // C++ house.cpp:6048: if (CurInfantry >= Control.MaxInfantry) return
    // The >= means exactly AT the cap also blocks.
    const prodTick = getProductionTick();
    const ctx = makeMockAIContext({ tick: prodTick });
    const state = setupProductionBase(ctx, House.USSR, 50000);
    state.maxInfantry = 5;

    for (let i = 0; i < 5; i++) {
      const inf = makeInfantryEntity(House.USSR);
      ctx.entities.push(inf);
      ctx.entityById.set(inf.id, inf);
    }

    updateAIProduction(ctx);

    const infAfter = ctx.entities.filter(
      e => e.alive && e.house === House.USSR && e.stats.isInfantry
    ).length;
    expect(infAfter).toBe(5); // No new infantry should be produced
  });

  it('dead infantry do not count toward cap (C++ Tracking_Remove decrements CurInfantry)', () => {
    // C++ house.cpp:6373: CurInfantry-- in Tracking_Remove when infantry dies
    const prodTick = getProductionTick();
    const ctx = makeMockAIContext({ tick: prodTick });
    const state = setupProductionBase(ctx, House.USSR, 50000);
    state.maxInfantry = 3;

    // 3 infantry but one dead
    for (let i = 0; i < 3; i++) {
      const inf = makeInfantryEntity(House.USSR);
      if (i === 0) inf.alive = false; // one dead
      ctx.entities.push(inf);
      ctx.entityById.set(inf.id, inf);
    }

    updateAIProduction(ctx);

    // Count alive infantry only
    const infAfter = ctx.entities.filter(
      e => e.alive && e.house === House.USSR && e.stats.isInfantry
    ).length;
    // 2 alive + should produce 1 more (under cap of 3)
    expect(infAfter).toBeGreaterThanOrEqual(3);
  });
});

// =============================================================================
// 2. Vehicle (Unit) Cap Enforcement
// C++ house.cpp:5795: if (CurUnits >= Control.MaxUnit) return(TICKS_PER_SECOND);
// =============================================================================

describe('Vehicle cap enforcement (C++ house.cpp:5795 AI_Unit)', () => {
  it('blocks vehicle production when CurUnits >= MaxUnit', () => {
    const prodTick = getProductionTick();
    const ctx = makeMockAIContext({ tick: prodTick });
    const state = setupProductionBase(ctx, House.USSR, 50000);
    state.maxUnit = 2;

    // Pre-fill with 2 vehicles (at cap)
    for (let i = 0; i < 2; i++) {
      const veh = makeVehicleEntity(House.USSR);
      ctx.entities.push(veh);
      ctx.entityById.set(veh.id, veh);
    }

    updateAIProduction(ctx);

    const vehAfter = ctx.entities.filter(
      e => e.alive && e.house === House.USSR && !e.stats.isInfantry &&
           !e.isAnt && !e.stats.isAircraft && !e.stats.isVessel
    ).length;
    expect(vehAfter).toBe(2);
  });

  it('allows vehicle production when CurUnits < MaxUnit', () => {
    const prodTick = getProductionTick();
    const ctx = makeMockAIContext({ tick: prodTick });
    const state = setupProductionBase(ctx, House.USSR, 50000);
    state.maxUnit = 5;

    // Pre-fill with 1 vehicle (below cap)
    const veh = makeVehicleEntity(House.USSR);
    ctx.entities.push(veh);
    ctx.entityById.set(veh.id, veh);

    updateAIProduction(ctx);

    const vehAfter = ctx.entities.filter(
      e => e.alive && e.house === House.USSR && !e.stats.isInfantry &&
           !e.isAnt && !e.stats.isAircraft && !e.stats.isVessel
    ).length;
    expect(vehAfter).toBeGreaterThan(1);
  });

  it('vehicles and infantry have SEPARATE cap pools (C++ CurUnits vs CurInfantry)', () => {
    // C++ tracks units and infantry in separate counters
    const prodTick = getProductionTick();
    const ctx = makeMockAIContext({ tick: prodTick });
    const state = setupProductionBase(ctx, House.USSR, 50000);
    state.maxUnit = 2;
    state.maxInfantry = 10;

    // Fill vehicle cap
    for (let i = 0; i < 2; i++) {
      const veh = makeVehicleEntity(House.USSR);
      ctx.entities.push(veh);
      ctx.entityById.set(veh.id, veh);
    }

    updateAIProduction(ctx);

    // Vehicles should stay at 2 (capped)
    const vehAfter = ctx.entities.filter(
      e => e.alive && e.house === House.USSR && !e.stats.isInfantry &&
           !e.isAnt && !e.stats.isAircraft && !e.stats.isVessel
    ).length;
    expect(vehAfter).toBe(2);

    // Infantry should still be produced (separate cap)
    const infAfter = ctx.entities.filter(
      e => e.alive && e.house === House.USSR && e.stats.isInfantry
    ).length;
    expect(infAfter).toBeGreaterThan(0);
  });
});

// =============================================================================
// 3. Building Cap Enforcement
// C++ house.cpp AI_Building uses CurBuildings vs Control.MaxBuilding
// =============================================================================

describe('Building cap enforcement (C++ house.cpp AI_Building)', () => {
  it('blocks construction when building count >= maxBuilding', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupProductionBase(ctx, House.USSR, 50000);
    state.maxBuilding = 3; // We already have FACT + TENT + WEAP = 3
    state.buildQueue = ['SILO'];

    const countBefore = ctx.structures.filter(
      s => s.alive && s.house === House.USSR
    ).length;

    updateAIConstruction(ctx);

    const countAfter = ctx.structures.filter(
      s => s.alive && s.house === House.USSR
    ).length;
    // Should not build — already at cap
    expect(countAfter).toBe(countBefore);
  });

  it('allows construction when building count < maxBuilding', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupProductionBase(ctx, House.USSR, 50000);
    state.maxBuilding = 10; // Well above current 3
    state.buildQueue = ['SILO'];

    const countBefore = ctx.structures.filter(
      s => s.alive && s.house === House.USSR
    ).length;

    updateAIConstruction(ctx);

    const countAfter = ctx.structures.filter(
      s => s.alive && s.house === House.USSR
    ).length;
    expect(countAfter).toBeGreaterThan(countBefore);
  });

  it('unlimited building when maxBuilding is -1', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupProductionBase(ctx, House.USSR, 50000);
    state.maxBuilding = -1; // unlimited
    state.buildQueue = ['SILO'];

    const countBefore = ctx.structures.filter(
      s => s.alive && s.house === House.USSR
    ).length;

    updateAIConstruction(ctx);

    const countAfter = ctx.structures.filter(
      s => s.alive && s.house === House.USSR
    ).length;
    expect(countAfter).toBeGreaterThan(countBefore);
  });
});

// =============================================================================
// 4. Aircraft Cap Enforcement
// C++ house.cpp:6245: if (CurAircraft >= Control.MaxAircraft) return(TICKS_PER_SECOND);
// PARITY GAP: TS does not enforce MaxAircraft — aircraft production is only
// gated by pad/airstrip count, not by a house-level aircraft cap.
// =============================================================================

describe('Aircraft cap enforcement (C++ house.cpp:6245 AI_Aircraft)', () => {
  it('C++ blocks aircraft production when CurAircraft >= MaxAircraft', () => {
    // C++ house.cpp:6243-6245:
    //   if (!IsHuman && IQ >= Rule.IQAircraft) {
    //     if (BuildAircraft != AIRCRAFT_NONE) return(TICKS_PER_SECOND);
    //     if (CurAircraft >= Control.MaxAircraft) return(TICKS_PER_SECOND);
    //
    // TS has no MaxAircraft field on AIHouseState. Aircraft production is only
    // limited by helipad/airstrip count vs current aircraft count.
    // PARITY GAP: TS missing MaxAircraft cap enforcement.

    const state = createAIHouseState(
      makeMockAIContext(),
      House.USSR,
    );

    // C++ AIHouseState should have a maxAircraft field
    // In TS, the AIHouseState only has maxUnit, maxInfantry, maxBuilding
    expect('maxUnit' in state).toBe(true);
    expect('maxInfantry' in state).toBe(true);
    expect('maxBuilding' in state).toBe(true);

    // PARITY GAP: TS has no maxAircraft or maxVessel fields
    const hasMaxAircraft = 'maxAircraft' in state;
    const hasMaxVessel = 'maxVessel' in state;
    expect(hasMaxAircraft).toBe(true); // PARITY GAP — will fail until TS adds maxAircraft
    expect(hasMaxVessel).toBe(true);   // PARITY GAP — will fail until TS adds maxVessel
  });
});

// =============================================================================
// 5. Vessel Cap Enforcement
// C++ house.cpp:5926: if (CurVessels >= Control.MaxVessel) return(TICKS_PER_SECOND);
// PARITY GAP: TS does not enforce MaxVessel — naval production is not
// independently capped.
// =============================================================================

describe('Vessel cap enforcement (C++ house.cpp:5926 AI_Vessel)', () => {
  it('C++ blocks vessel production when CurVessels >= MaxVessel', () => {
    // C++ house.cpp:5924-5928:
    //   if (BuildVessel != VESSEL_NONE) return(TICKS_PER_SECOND);
    //   if (CurVessels >= Control.MaxVessel) {
    //       return(TICKS_PER_SECOND);
    //   }
    //
    // PARITY GAP: TS has no maxVessel field or vessel cap check.
    // This test documents the expected C++ behavior.

    const state = createAIHouseState(
      makeMockAIContext(),
      House.USSR,
    );

    // PARITY GAP: maxVessel should exist on AIHouseState
    const hasMaxVessel = 'maxVessel' in state;
    expect(hasMaxVessel).toBe(true); // PARITY GAP — will fail until TS adds maxVessel
  });
});

// =============================================================================
// 6. Default Cap Values
// C++ house.cpp:755-759 — HouseStaticClass constructor:
//   MaxUnit(Rule.UnitMax/6),         // 500/6 = 83
//   MaxBuilding(Rule.BuildingMax/6), // 500/6 = 83
//   MaxInfantry(Rule.InfantryMax/6), // 500/6 = 83
//   MaxVessel(Rule.VesselMax/6),     // 100/6 = 16
//   MaxAircraft(Rule.UnitMax/6),     // 500/6 = 83 (uses UnitMax!)
//
// PARITY GAP: TS defaults to -1 (unlimited) when caps not specified in INI.
// C++ always has positive default caps.
// =============================================================================

describe('Default cap values (C++ house.cpp:755-759)', () => {
  it('C++ defaults MaxUnit to Rule.UnitMax/6 = 83, TS defaults to -1 (unlimited)', () => {
    // C++ house.cpp:755: MaxUnit(Rule.UnitMax/6)
    // rules.cpp:253: UnitMax(500)
    // Therefore default MaxUnit = 500/6 = 83 (integer division)
    //
    // TS ai.ts:332: maxUnit: ctx.houseMaxUnits.get(house) ?? -1
    // When not specified in scenario INI, TS defaults to -1 (unlimited)
    //
    // PARITY GAP: C++ has positive defaults; TS defaults to unlimited

    const ctx = makeMockAIContext();
    // Don't set any houseMaxUnits
    const state = createAIHouseState(ctx, House.USSR);

    // C++ would default to 83
    const CPP_DEFAULT_MAX_UNIT = Math.floor(500 / 6); // = 83
    // PARITY GAP: TS defaults to -1 (unlimited) instead of 83
    expect(state.maxUnit).toBe(CPP_DEFAULT_MAX_UNIT); // PARITY GAP
  });

  it('C++ defaults MaxInfantry to Rule.InfantryMax/6 = 83, TS defaults to -1', () => {
    const ctx = makeMockAIContext();
    const state = createAIHouseState(ctx, House.USSR);

    const CPP_DEFAULT_MAX_INFANTRY = Math.floor(500 / 6); // = 83
    // PARITY GAP: TS defaults to -1 (unlimited) instead of 83
    expect(state.maxInfantry).toBe(CPP_DEFAULT_MAX_INFANTRY); // PARITY GAP
  });

  it('C++ defaults MaxBuilding to Rule.BuildingMax/6 = 83, TS defaults to -1', () => {
    const ctx = makeMockAIContext();
    const state = createAIHouseState(ctx, House.USSR);

    const CPP_DEFAULT_MAX_BUILDING = Math.floor(500 / 6); // = 83
    // PARITY GAP: TS defaults to -1 (unlimited) instead of 83
    expect(state.maxBuilding).toBe(CPP_DEFAULT_MAX_BUILDING); // PARITY GAP
  });

  it('C++ MaxAircraft defaults to Rule.UnitMax/6, NOT Rule.AircraftMax/6', () => {
    // C++ house.cpp:759: MaxAircraft(Rule.UnitMax/6)
    // This is a notable quirk: MaxAircraft uses UnitMax (500), not AircraftMax (100)
    // So default MaxAircraft = 500/6 = 83, not 100/6 = 16
    //
    // PARITY GAP: TS has no MaxAircraft at all
    const CPP_DEFAULT_MAX_AIRCRAFT = Math.floor(500 / 6); // = 83
    // Document the C++ value for when TS implements this
    expect(CPP_DEFAULT_MAX_AIRCRAFT).toBe(83);
  });
});

// =============================================================================
// 7. INI Override of Caps
// C++ house.cpp:7141-7145:
//   p->Control.MaxBuilding = ini.Get_Int(hname, "MaxBuilding", p->Control.MaxBuilding);
//   p->Control.MaxUnit = ini.Get_Int(hname, "MaxUnit", p->Control.MaxUnit);
//   p->Control.MaxInfantry = ini.Get_Int(hname, "MaxInfantry", p->Control.MaxInfantry);
//   p->Control.MaxVessel = ini.Get_Int(hname, "MaxVessel", p->Control.MaxVessel);
//   if (p->Control.MaxVessel == 0) p->Control.MaxVessel = p->Control.MaxUnit;
// =============================================================================

describe('INI override of caps (C++ house.cpp:7141-7145)', () => {
  it('scenario INI MaxUnit overrides default', () => {
    const ctx = makeMockAIContext();
    ctx.houseMaxUnits.set(House.USSR, 25);
    const state = createAIHouseState(ctx, House.USSR);
    expect(state.maxUnit).toBe(25);
  });

  it('scenario INI MaxInfantry overrides default', () => {
    const ctx = makeMockAIContext();
    ctx.houseMaxInfantry.set(House.USSR, 30);
    const state = createAIHouseState(ctx, House.USSR);
    expect(state.maxInfantry).toBe(30);
  });

  it('scenario INI MaxBuilding overrides default', () => {
    const ctx = makeMockAIContext();
    ctx.houseMaxBuildings.set(House.USSR, 15);
    const state = createAIHouseState(ctx, House.USSR);
    expect(state.maxBuilding).toBe(15);
  });

  it('C++ fallback: if MaxVessel==0, use MaxUnit value (house.cpp:7145)', () => {
    // C++ house.cpp:7145:
    //   if (p->Control.MaxVessel == 0) p->Control.MaxVessel = p->Control.MaxUnit;
    //
    // When scenario INI specifies MaxVessel=0, C++ falls back to MaxUnit.
    // PARITY GAP: TS has no MaxVessel field at all, let alone this fallback.

    const ctx = makeMockAIContext();
    ctx.houseMaxUnits.set(House.USSR, 50);
    // Simulate MaxVessel=0 scenario
    const state = createAIHouseState(ctx, House.USSR);

    // PARITY GAP: TS has no maxVessel field
    const hasMaxVessel = 'maxVessel' in state;
    expect(hasMaxVessel).toBe(true); // PARITY GAP
  });
});

// =============================================================================
// 8. Dynamic Cap Increase Based on Enemy Average
// C++ house.cpp:4726-4740:
//   if (Control.MaxUnit < maxunit + 10) {
//       Control.MaxUnit = maxunit + 10;
//   }
//   // Same for MaxBuilding, MaxInfantry, MaxVessel, MaxAircraft
//
// Where maxunit = average CurUnits across all active non-ally houses.
// This prevents the AI from being permanently capped below the human player.
//
// PARITY GAP: TS does not implement dynamic cap increases.
// =============================================================================

describe('Dynamic cap increase (C++ house.cpp:4726-4740)', () => {
  it('C++ raises caps when enemy average exceeds current cap minus 10', () => {
    // In C++, during AI() processing:
    // 1. Sum all enemy CurUnits, divide by enemy count = enemyAvg
    // 2. If Control.MaxUnit < enemyAvg + 10, set Control.MaxUnit = enemyAvg + 10
    //
    // Example: Soviet has MaxUnit=20, player has 50 units
    //   enemyAvg = 50
    //   Since 20 < 50+10=60, Soviet.MaxUnit becomes 60

    // Tick must be divisible by 150 for updateAIStrategicPlanner to run
    const ctx = makeMockAIContext({ tick: 150 });
    const state = setupProductionBase(ctx, House.USSR, 50000);
    state.maxUnit = 5;

    // Simulate: player (Spain) has 40 vehicles
    for (let i = 0; i < 40; i++) {
      const veh = makeVehicleEntity(House.Spain);
      ctx.entities.push(veh);
      ctx.entityById.set(veh.id, veh);
    }

    // In C++, the AI's cap would be raised to 40+10=50 during AI()
    // In TS, the cap stays at 5 forever.
    // We can't directly test this without running the strategic planner,
    // but we can verify the state was NOT modified (documenting the gap).
    updateAIStrategicPlanner(ctx);

    // PARITY GAP: TS does not implement dynamic cap increase.
    // C++ would set state.maxUnit to at least 50 (40 enemy units + 10).
    // TS keeps it at 5.
    expect(state.maxUnit).toBe(50); // PARITY GAP — TS keeps original value
  });
});

// =============================================================================
// 9. Tracking_Add / Tracking_Remove symmetry
// C++ house.cpp:6423-6508 (Tracking_Add) and 6355-6404 (Tracking_Remove)
// Every category (RTTI_BUILDING, RTTI_AIRCRAFT, RTTI_INFANTRY, RTTI_UNIT,
// RTTI_VESSEL) increments/decrements the corresponding CurX counter.
// =============================================================================

describe('Tracking symmetry (C++ house.cpp:6355-6508)', () => {
  it('infantry count only includes alive infantry of the same house', () => {
    const prodTick = getProductionTick();
    const ctx = makeMockAIContext({ tick: prodTick });
    const state = setupProductionBase(ctx, House.USSR, 50000);
    state.maxInfantry = 3;

    // 2 alive USSR infantry + 1 dead + 1 allied = should count as 2
    const inf1 = makeInfantryEntity(House.USSR);
    const inf2 = makeInfantryEntity(House.USSR);
    const inf3 = makeInfantryEntity(House.USSR);
    inf3.alive = false; // dead
    const inf4 = makeInfantryEntity(House.Spain); // different house
    ctx.entities.push(inf1, inf2, inf3, inf4);
    ctx.entityById.set(inf1.id, inf1);
    ctx.entityById.set(inf2.id, inf2);
    ctx.entityById.set(inf3.id, inf3);
    ctx.entityById.set(inf4.id, inf4);

    updateAIProduction(ctx);

    // Should have produced 1 more infantry (2 alive < cap of 3)
    const ussrInf = ctx.entities.filter(
      e => e.alive && e.house === House.USSR && e.stats.isInfantry
    ).length;
    expect(ussrInf).toBe(3);
  });

  it('vehicle count excludes infantry, ants, aircraft, and vessels (C++ RTTI_UNIT only)', () => {
    // C++ Tracking_Add/Remove tracks CurUnits only for RTTI_UNIT, which excludes:
    // - Infantry (RTTI_INFANTRY -> CurInfantry)
    // - Aircraft (RTTI_AIRCRAFT -> CurAircraft)
    // - Vessels (RTTI_VESSEL -> CurVessels)
    // - Buildings (RTTI_BUILDING -> CurBuildings)
    const prodTick = getProductionTick();
    const ctx = makeMockAIContext({ tick: prodTick });
    const state = setupProductionBase(ctx, House.USSR, 50000);
    state.maxUnit = 2;
    state.maxInfantry = 100;

    // Add aircraft and infantry — should NOT count toward unit cap
    const aircraft = makeAircraftEntity(House.USSR);
    const infantry = makeInfantryEntity(House.USSR);
    ctx.entities.push(aircraft, infantry);
    ctx.entityById.set(aircraft.id, aircraft);
    ctx.entityById.set(infantry.id, infantry);

    // Add 1 vehicle (below cap of 2)
    const veh = makeVehicleEntity(House.USSR);
    ctx.entities.push(veh);
    ctx.entityById.set(veh.id, veh);

    updateAIProduction(ctx);

    // Should have produced 1 more vehicle (only 1 vehicle counted, cap is 2)
    const vehAfter = ctx.entities.filter(
      e => e.alive && e.house === House.USSR && !e.stats.isInfantry &&
           !e.isAnt && !e.stats.isAircraft && !e.stats.isVessel
    ).length;
    expect(vehAfter).toBe(2);
  });
});

// =============================================================================
// 10. Per-house cap independence
// Each C++ HouseClass has its own Control.MaxUnit/MaxInfantry etc.
// One house's cap should not affect another house's production.
// =============================================================================

describe('Per-house cap independence (C++ each HouseClass has own Control)', () => {
  it('house A cap does not affect house B production', () => {
    const prodTick = getProductionTick();
    const ctx = makeMockAIContext({ tick: prodTick });

    // House USSR: maxInfantry=1 (tightly capped)
    setupProductionBase(ctx, House.USSR, 50000);
    const ussrState = ctx.aiStates.get(House.USSR)!;
    ussrState.maxInfantry = 1;

    // House Ukraine: maxInfantry=10 (generous cap)
    // Ukraine is allied with USSR (both enemies of player Spain),
    // so AI production will run for both houses.
    const ukraineFact = makeStructure('FACT', House.Ukraine, 55, 55);
    const ukraineTent = makeStructure('TENT', House.Ukraine, 59, 55);
    ctx.structures.push(ukraineFact, ukraineTent);
    for (const s of [ukraineFact, ukraineTent]) {
      const [fw, fh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
      for (let dy = 0; dy < fh; dy++) {
        for (let dx = 0; dx < fw; dx++) {
          ctx.map.setTerrain(s.cx + dx, s.cy + dy, Terrain.WALL);
        }
      }
    }
    ctx.houseCredits.set(House.Ukraine, 50000);
    const ukraineState = addAIHouse(ctx, House.Ukraine, {
      productionEnabled: true,
      iq: 3,
      maxInfantry: 10,
      maxUnit: -1,
      maxBuilding: -1,
    });

    // Pre-fill USSR with 1 infantry (at cap)
    const inf = makeInfantryEntity(House.USSR);
    ctx.entities.push(inf);
    ctx.entityById.set(inf.id, inf);

    updateAIProduction(ctx);

    // USSR should stay at 1 (capped)
    const ussrInf = ctx.entities.filter(
      e => e.alive && e.house === House.USSR && e.stats.isInfantry
    ).length;
    expect(ussrInf).toBe(1);

    // Ukraine should have produced infantry (separate cap, separate house)
    const ukraineInf = ctx.entities.filter(
      e => e.alive && e.house === House.Ukraine && e.stats.isInfantry
    ).length;
    expect(ukraineInf).toBeGreaterThan(0);
  });
});

// =============================================================================
// 11. Cap=0 means NO production (C++ zero cap blocks completely)
// C++ comparison is >=, so CurX (starting at 0) >= 0 is true immediately.
// =============================================================================

describe('Cap=0 blocks all production (C++ >= comparison)', () => {
  it('maxInfantry=0 blocks all infantry production', () => {
    const prodTick = getProductionTick();
    const ctx = makeMockAIContext({ tick: prodTick });
    const state = setupProductionBase(ctx, House.USSR, 50000);
    state.maxInfantry = 0;

    updateAIProduction(ctx);

    const infAfter = ctx.entities.filter(
      e => e.alive && e.house === House.USSR && e.stats.isInfantry
    ).length;
    expect(infAfter).toBe(0);
  });

  it('maxUnit=0 blocks all vehicle production', () => {
    const prodTick = getProductionTick();
    const ctx = makeMockAIContext({ tick: prodTick });
    const state = setupProductionBase(ctx, House.USSR, 50000);
    state.maxUnit = 0;

    updateAIProduction(ctx);

    const vehAfter = ctx.entities.filter(
      e => e.alive && e.house === House.USSR && !e.stats.isInfantry &&
           !e.isAnt && !e.stats.isAircraft && !e.stats.isVessel
    ).length;
    expect(vehAfter).toBe(0);
  });

  it('maxBuilding=0 blocks all building construction', () => {
    // This is special because we need at least a FACT to trigger construction,
    // but maxBuilding=0 means no buildings at all.
    // C++ house.cpp AI_Building has two gates:
    //   1. CurBuildings >= maxBuilding
    //   2. Has FACT
    // With maxBuilding=0, gate 1 blocks even if FACT exists.
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupProductionBase(ctx, House.USSR, 50000);
    state.maxBuilding = 0;
    state.buildQueue = ['SILO'];

    const countBefore = ctx.structures.filter(
      s => s.alive && s.house === House.USSR
    ).length;

    updateAIConstruction(ctx);

    const countAfter = ctx.structures.filter(
      s => s.alive && s.house === House.USSR
    ).length;
    expect(countAfter).toBe(countBefore);
  });
});
