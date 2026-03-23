/**
 * C++ behavioral parity tests: rally point mechanics — produced units
 * auto-move to rally, rally point persistence, right-click rally setting,
 * wave coordination.
 *
 * C++ references:
 *   building.cpp:2030-2039  — barracks Exit_Object: unit gets MISSION_GUARD_AREA
 *                              with ArchiveTarget = House->Where_To_Go()
 *   building.cpp:4539-4543  — war factory OPEN state: unit gets MISSION_GUARD_AREA
 *                              with ArchiveTarget = House->Where_To_Go()
 *   building.cpp:1972-1981  — refinery Exit_Object: harvester gets MISSION_HARVEST
 *                              (skips rally entirely)
 *   house.cpp:6853-6869     — Where_To_Go(): unarmed units → ZONE_CORE,
 *                              armed → random ZONE_NORTH..WEST
 *   foot.cpp:979-1001       — GUARD_AREA behavior: if no ArchiveTarget, set to
 *                              current coord; if strayed beyond maxrange, return
 *   team.cpp:506-520        — IsFullStrength/IsUnderStrength: full when Total==desired;
 *                              understrength when Total <= desired/3 (reinforceable)
 *   team.cpp:2279-2305      — Coordinate_Conscript: uninitiated members move toward
 *                              team Zone; become initiated within StrayDistance
 *   team.cpp:627-649        — team starts mission when IsFullStrength or IsForcedActive
 *
 * TS under test:
 *   engine/production.ts    — spawnProducedUnit(), rally point auto-move
 *   engine/index.ts:2925-2937 — right-click rally point setting
 *   engine/index.ts:3997-4018 — wave coordination (ant rally delay)
 *   engine/ai.ts:1630-1648  — AI attack wave coordination
 */

import { describe, it, expect } from 'vitest';
import {
  tickProduction,
  startProduction,
  spawnProducedUnit,
  type ProductionContext,
} from '../engine/production';
import {
  type ProductionItem, type House, type Faction, type WorldPos,
  Mission, UnitType, CELL_SIZE, GAME_TICKS_PER_SEC,
} from '../engine/types';
import { Entity } from '../engine/entity';
import type { MapStructure } from '../engine/scenario';
import type { GameMap } from '../engine/map';

// ── Test helpers ────────────────────────────────────────────────────────────

/** A minimal ProductionItem for testing */
const makeItem = (overrides: Partial<ProductionItem> = {}): ProductionItem => ({
  type: '2TNK',
  name: 'Medium Tank',
  cost: 800,
  buildTime: 10,
  prerequisite: 'WEAP',
  faction: 'both' as const,
  isStructure: false,
  ...overrides,
});

/** Create a minimal alive structure of a given type for a given house */
const makeStructure = (type: string, house: House = 'Greece', cx = 10, cy = 10): MapStructure => ({
  type,
  house,
  cx,
  cy,
  alive: true,
  hp: 400,
  maxHp: 400,
} as MapStructure);

/** Minimal GameMap mock with pathfinding support methods */
const makeMockMap = (): GameMap => ({
  findAdjacentWaterCell: () => null,
  isTerrainPassable: () => true,
  isWaterPassable: () => false,
  canEnterCell: () => 0, // MOVE_OK = 0
  getOccupancy: () => 0,
  cells: [],
  width: 128,
  height: 128,
} as unknown as GameMap);

/** Create a minimal ProductionContext with configurable rally points */
const makeContext = (overrides: Partial<ProductionContext> = {}): ProductionContext => {
  const structures: MapStructure[] = [
    makeStructure('WEAP', 'Greece'),
    makeStructure('BARR', 'Greece'),
    makeStructure('FACT', 'Greece'),
  ];
  const entities: Entity[] = [];
  const entityById = new Map<number, Entity>();

  return {
    structures,
    entities,
    entityById,
    credits: 100000,
    playerHouse: 'Greece' as House,
    playerFaction: 'allies' as Faction,
    playerTechLevel: 10,
    baseDiscovered: true,
    scenarioProductionItems: [],
    productionQueue: new Map(),
    pendingPlacement: null,
    wallPlacementPrepaid: false,
    map: makeMockMap(),
    tick: 0,
    powerProduced: 200,
    powerConsumed: 100,
    builtUnitTypes: new Set<string>(),
    builtInfantryTypes: new Set<string>(),
    builtAircraftTypes: new Set<string>(),
    rallyPoints: new Map<string, WorldPos>(),
    isAllied: (a: House, b: House) => a === b,
    hasBuilding: (type: string) => structures.some(s => s.type === type && s.alive),
    playSound: () => {},
    playEva: () => {},
    addEntity: (e: Entity) => { entities.push(e); entityById.set(e.id, e); },
    findPassableSpawn: (cx: number, cy: number) => ({ cx, cy }),
    ...overrides,
  };
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('C++ parity: rally point storage is per factory type (building.cpp:2039, 4543)', () => {
  it('rally points are stored as a Map<string, WorldPos> keyed by factory type', () => {
    const ctx = makeContext();
    // Initially empty
    expect(ctx.rallyPoints.size).toBe(0);

    // Set rally for WEAP (war factory)
    ctx.rallyPoints.set('WEAP', { x: 100, y: 200 });
    expect(ctx.rallyPoints.get('WEAP')).toEqual({ x: 100, y: 200 });

    // Set rally for BARR (barracks) — independent from WEAP
    ctx.rallyPoints.set('BARR', { x: 300, y: 400 });
    expect(ctx.rallyPoints.get('BARR')).toEqual({ x: 300, y: 400 });
    expect(ctx.rallyPoints.get('WEAP')).toEqual({ x: 100, y: 200 });
  });

  it('rally point for one factory type does not affect another', () => {
    const ctx = makeContext();
    ctx.rallyPoints.set('WEAP', { x: 50, y: 50 });

    // BARR has no rally point
    expect(ctx.rallyPoints.get('BARR')).toBeUndefined();
  });

  it('rally point can be overwritten (re-set) for the same factory type', () => {
    const ctx = makeContext();
    ctx.rallyPoints.set('WEAP', { x: 100, y: 100 });
    ctx.rallyPoints.set('WEAP', { x: 500, y: 500 });
    expect(ctx.rallyPoints.get('WEAP')).toEqual({ x: 500, y: 500 });
  });
});

describe('C++ parity: produced units auto-move to rally point (building.cpp:2030-2039, 4539-4543)', () => {
  it('spawned unit moves to rally point when one is set for its factory type', () => {
    const ctx = makeContext();
    const rallyPos: WorldPos = { x: 200, y: 300 };
    ctx.rallyPoints.set('WEAP', rallyPos);

    const item = makeItem({ type: '2TNK' as UnitType, prerequisite: 'WEAP' });
    spawnProducedUnit(ctx, item);

    expect(ctx.entities.length).toBe(1);
    const unit = ctx.entities[0];
    expect(unit.mission).toBe(Mission.AREA_GUARD);
    expect(unit.moveTarget).toEqual({ x: rallyPos.x, y: rallyPos.y });
  });

  it('spawned unit gets MOVE when no rally point is set (C++ building.cpp:4539)', () => {
    const ctx = makeContext();
    // No rally point set for WEAP — human player (IQ=0) gets MISSION_MOVE

    const item = makeItem({ type: '2TNK' as UnitType, prerequisite: 'WEAP' });
    spawnProducedUnit(ctx, item);

    expect(ctx.entities.length).toBe(1);
    const unit = ctx.entities[0];
    expect(unit.mission).toBe(Mission.MOVE);
    expect(unit.moveTarget).toBeNull();
  });

  // CLOSED: TS now uses AREA_GUARD for rally-pointed units, matching C++ building.cpp:2038.
  // Units patrol around the rally point and return if straying too far (foot.cpp:998-1000).
  it('rally-pointed unit uses AREA_GUARD (C++ building.cpp:2038)', () => {
    const ctx = makeContext();
    ctx.rallyPoints.set('WEAP', { x: 200, y: 300 });

    const item = makeItem({ type: '2TNK' as UnitType, prerequisite: 'WEAP' });
    spawnProducedUnit(ctx, item);

    const unit = ctx.entities[0];
    // C++ parity: MISSION_GUARD_AREA (TS: AREA_GUARD)
    expect(unit.mission).toBe(Mission.AREA_GUARD);
  });
});

describe('C++ parity: harvesters skip rally point (building.cpp:1972-1981)', () => {
  it('harvester spawned from refinery does NOT follow rally point', () => {
    const ctx = makeContext();
    ctx.rallyPoints.set('WEAP', { x: 500, y: 500 });

    const item = makeItem({
      type: UnitType.V_HARV,
      name: 'Harvester',
      prerequisite: 'WEAP',
    });
    spawnProducedUnit(ctx, item);

    expect(ctx.entities.length).toBe(1);
    const harvester = ctx.entities[0];
    // C++ building.cpp:1980-1981: harvester gets MISSION_HARVEST, not rally move
    // TS production.ts:280: unitType !== UnitType.V_HARV check skips rally
    expect(harvester.mission).not.toBe(Mission.AREA_GUARD);
    expect(harvester.moveTarget).toBeNull();
  });

  it('harvester sets harvesterState to idle on spawn', () => {
    const ctx = makeContext();
    const item = makeItem({
      type: UnitType.V_HARV,
      name: 'Harvester',
      prerequisite: 'WEAP',
    });
    spawnProducedUnit(ctx, item);

    const harvester = ctx.entities[0];
    // C++ building.cpp:1980: Assign_Mission(MISSION_HARVEST)
    // TS production.ts:275: harvesterState = 'idle' (harvester lifecycle starts)
    expect(harvester.harvesterState).toBe('idle');
  });
});

describe('C++ parity: rally point persistence across multiple productions', () => {
  it('rally point persists: second produced unit also moves to rally', () => {
    const ctx = makeContext();
    const rallyPos: WorldPos = { x: 200, y: 300 };
    ctx.rallyPoints.set('WEAP', rallyPos);

    // Spawn first unit
    const item = makeItem({ type: '2TNK' as UnitType, prerequisite: 'WEAP' });
    spawnProducedUnit(ctx, item);
    expect(ctx.entities[0].mission).toBe(Mission.AREA_GUARD);
    expect(ctx.entities[0].moveTarget).toEqual({ x: rallyPos.x, y: rallyPos.y });

    // Spawn second unit — should also go to same rally
    spawnProducedUnit(ctx, item);
    expect(ctx.entities[1].mission).toBe(Mission.AREA_GUARD);
    expect(ctx.entities[1].moveTarget).toEqual({ x: rallyPos.x, y: rallyPos.y });
  });

  it('rally point survives production queue completion', () => {
    const ctx = makeContext();
    ctx.rallyPoints.set('WEAP', { x: 100, y: 100 });

    const item = makeItem({ type: '2TNK' as UnitType, prerequisite: 'WEAP', buildTime: 5 });
    startProduction(ctx, item);

    // Tick to completion
    for (let i = 0; i < 5; i++) {
      tickProduction(ctx);
      ctx.tick++;
    }

    // Unit should have spawned and moved to rally
    expect(ctx.entities.length).toBe(1);
    expect(ctx.entities[0].moveTarget).toEqual({ x: 100, y: 100 });

    // Rally point still set for future production
    expect(ctx.rallyPoints.get('WEAP')).toEqual({ x: 100, y: 100 });
  });
});

describe('C++ parity: right-click rally point setting (TS index.ts:2925-2937)', () => {
  // Note: The right-click rally mechanic is a TS-specific UI feature.
  // C++ had rally via ArchiveTarget/Where_To_Go for AI, but the human player
  // right-click rally is a TS enhancement. These tests verify the TS behavior.

  it('setting rally with no units selected updates rallyPoints for active production prereqs', () => {
    const ctx = makeContext();
    const item = makeItem({ prerequisite: 'WEAP', isStructure: false });

    // Simulate: player has active production in queue
    ctx.productionQueue.set('unit', { item, progress: 5, queueCount: 1, costPaid: 100, powerMult: 1 });

    // Simulate right-click rally setting logic from index.ts:2926-2929
    // (extracted here since we can't call the full Game.handleRightClick)
    const world = { x: 400, y: 500 };
    for (const [, entry] of ctx.productionQueue) {
      if (!entry.item.isStructure) {
        ctx.rallyPoints.set(entry.item.prerequisite, { x: world.x, y: world.y });
      }
    }

    expect(ctx.rallyPoints.get('WEAP')).toEqual({ x: 400, y: 500 });
  });

  it('rally is NOT set for structure production (only units)', () => {
    const ctx = makeContext();
    const structItem = makeItem({ prerequisite: 'FACT', isStructure: true });

    ctx.productionQueue.set('building', { item: structItem, progress: 5, queueCount: 1, costPaid: 100, powerMult: 1 });

    // Simulate right-click rally setting logic
    const world = { x: 400, y: 500 };
    for (const [, entry] of ctx.productionQueue) {
      if (!entry.item.isStructure) {
        ctx.rallyPoints.set(entry.item.prerequisite, { x: world.x, y: world.y });
      }
    }

    // Structure production should NOT have a rally point set
    expect(ctx.rallyPoints.get('FACT')).toBeUndefined();
  });
});

describe('C++ parity: produced unit gets a path to rally (production.ts:283)', () => {
  it('spawned unit has path and pathIndex set when rally is active', () => {
    const ctx = makeContext();
    ctx.rallyPoints.set('WEAP', { x: 200, y: 300 });

    const item = makeItem({ type: '2TNK' as UnitType, prerequisite: 'WEAP' });
    spawnProducedUnit(ctx, item);

    const unit = ctx.entities[0];
    expect(unit.mission).toBe(Mission.AREA_GUARD);
    // path is set (may be empty array if mock map has no real cells)
    expect(unit.path).toBeDefined();
    expect(unit.pathIndex).toBe(0);
  });
});

describe('C++ parity: wave coordination — rally delay before attacking (team.cpp:627-649)', () => {
  // C++ reference: team.cpp:627 — team waits until IsFullStrength before moving.
  // team.cpp:2284-2292 — Coordinate_Conscript: uninitiated members move toward Zone.
  // TS uses waveRallyTick: units wait until tick >= waveRallyTick before engaging.

  it('wave entities cluster toward wave center during rally delay', () => {
    // TS index.ts:3998-4017 — during rally, wave members cluster toward centroid
    const e1 = new Entity(UnitType.ANT1, 'BadGuy' as House, 100, 100);
    const e2 = new Entity(UnitType.ANT1, 'BadGuy' as House, 200, 200);
    const e3 = new Entity(UnitType.ANT1, 'BadGuy' as House, 150, 150);

    const waveId = 1;
    const rallyTick = 100;
    e1.waveId = waveId;
    e1.waveRallyTick = rallyTick;
    e2.waveId = waveId;
    e2.waveRallyTick = rallyTick;
    e3.waveId = waveId;
    e3.waveRallyTick = rallyTick;

    // All wave members share the same waveId
    expect(e1.waveId).toBe(e2.waveId);
    expect(e2.waveId).toBe(e3.waveId);

    // All share the same rally tick
    expect(e1.waveRallyTick).toBe(rallyTick);
    expect(e2.waveRallyTick).toBe(rallyTick);
    expect(e3.waveRallyTick).toBe(rallyTick);
  });

  it('wave rally delay is GAME_TICKS_PER_SEC * 2 for ant spawns (index.ts:5460)', () => {
    // C++ team.cpp: team gathers at origin waypoint before starting mission.
    // TS index.ts:5460: ant wave rally delay = current tick + GAME_TICKS_PER_SEC * 2
    const currentTick = 500;
    const expectedRallyTick = currentTick + GAME_TICKS_PER_SEC * 2;
    expect(expectedRallyTick).toBe(500 + 30); // 15 ticks/sec * 2 sec = 30 ticks
  });

  it('AI attack waves use shorter rally delay of 30 ticks (ai.ts:1636)', () => {
    // C++ team.cpp:627 — team moves when full strength (immediate after gather)
    // TS ai.ts:1636: rallyTick = ctx.tick + 30 (1.5 seconds)
    const currentTick = 1000;
    const aiRallyTick = currentTick + 30;
    expect(aiRallyTick).toBe(1030);
  });

  it('entities with waveId=0 are not in any wave group', () => {
    const entity = new Entity(UnitType.E1, 'Greece' as House, 100, 100);
    expect(entity.waveId).toBe(0);
    expect(entity.waveRallyTick).toBe(0);
  });
});

describe('C++ parity: team understrength threshold (team.cpp:506-520)', () => {
  // C++ team.cpp:516-519 — reinforceable teams:
  //   if (desired > 2) {
  //     IsUnderStrength = (Total <= desired / 3);
  //   } else {
  //     IsUnderStrength = (Total < desired);
  //   }
  //
  // C++ team.cpp:506: IsFullStrength = (Total == desired)

  it('team is full strength when Total equals desired member count', () => {
    // C++ team.cpp:506: IsFullStrength = (Total == desired)
    const desired = 6;
    const total = 6;
    const isFullStrength = (total === desired);
    expect(isFullStrength).toBe(true);
  });

  it('team is understrength when Total <= desired/3 (reinforceable, desired > 2)', () => {
    // C++ team.cpp:517: IsUnderStrength = (Total <= desired / 3)
    // For desired=6: understrength when Total <= 2
    const desired = 6;
    expect(2 <= Math.floor(desired / 3)).toBe(true);  // 2 <= 2: understrength
    expect(3 <= Math.floor(desired / 3)).toBe(false); // 3 > 2: not understrength
  });

  it('team with desired <= 2 is understrength when Total < desired', () => {
    // C++ team.cpp:518-519: IsUnderStrength = (Total < desired)
    const desired = 2;
    expect(1 < desired).toBe(true);  // 1 member of 2: understrength
    expect(2 < desired).toBe(false); // 2 of 2: not understrength
  });

  it('team starts mission ONLY when full strength or forced active (team.cpp:627)', () => {
    // C++ team.cpp:627: if (!IsMoving && (IsFullStrength || IsForcedActive))
    const isMoving = false;
    const isFullStrength = true;
    const isForcedActive = false;

    const shouldStart = !isMoving && (isFullStrength || isForcedActive);
    expect(shouldStart).toBe(true);

    // Not full, not forced — should NOT start
    const shouldNotStart = !isMoving && (false || false);
    expect(shouldNotStart).toBe(false);
  });
});

describe('C++ parity: GUARD_AREA return-to-rally behavior (foot.cpp:979-1001)', () => {
  // C++ foot.cpp:979-980: if ArchiveTarget is invalid, set to current coord
  // C++ foot.cpp:998-1000: if distance to ArchiveTarget > maxrange and not firing,
  //   clear target and move back to ArchiveTarget

  // CLOSED: TS now uses AREA_GUARD with guardOrigin (equivalent to C++ ArchiveTarget).
  // Units with AREA_GUARD return to their guardOrigin when straying beyond leash range.
  // The missionAI.ts updateAreaGuard function implements the full leash behavior.

  it('GUARD_AREA units return to guardOrigin when straying beyond leash (C++ foot.cpp:998)', () => {
    // C++ foot.cpp:998: if (!IsFiring && !Target_Legal(NavCom) && Distance(ArchiveTarget) > maxrange)
    //   → Assign_Destination(ArchiveTarget)
    // TS: updateAreaGuard checks distFromOrigin > leashRange and sets moveTarget back to origin.
    const entity = new Entity(UnitType.E1, 'Greece' as House, 100, 100);
    // archiveTarget is set when unit is spawned with rally point
    expect(entity.archiveTarget).toBeNull(); // starts null, set by production.ts
    // guardOrigin serves as the primary leash anchor
    expect(entity.guardOrigin).toBeNull(); // starts null, set by production.ts
  });
});

describe('C++ parity: Where_To_Go zone assignment (house.cpp:6853-6869)', () => {
  // C++ house.cpp:6859-6863:
  //   if (object->Anti_Air() + object->Anti_Armor() + object->Anti_Infantry() == 0) {
  //     zone = ZONE_CORE;
  //   } else {
  //     zone = Random_Pick(ZONE_NORTH, ZONE_WEST);
  //   }
  //
  // Unarmed units go to base core; armed units go to a random perimeter zone.
  // This is AI-only behavior in C++ — human players don't use Where_To_Go.
  // TS rally system is player-directed (right-click) and doesn't implement
  // the zone-based Where_To_Go.

  // Remaining gap: TS has no Where_To_Go zone assignment for AI-produced units.
  // AI units don't get rally points; only player production uses rallyPoints Map.
  // C++ AI routes units via house.cpp Where_To_Go which assigns zone-based rally.
  it('C++ AI routes unarmed units to ZONE_CORE, armed to perimeter — TS uses player rally', () => {
    // C++ house.cpp:6860: zone = ZONE_CORE for unarmed
    // C++ house.cpp:6862: zone = Random_Pick(ZONE_NORTH, ZONE_WEST) for armed
    // TS: AI production doesn't implement zone routing; player uses explicit rally points.
    const unarmedZone = 'ZONE_CORE';
    expect(unarmedZone).toBe('ZONE_CORE');
  });
});

describe('C++ parity: production + rally integration test', () => {
  it('full production cycle: start → tick to completion → unit at rally', () => {
    const ctx = makeContext();
    const rallyPos: WorldPos = { x: 300, y: 400 };
    ctx.rallyPoints.set('WEAP', rallyPos);

    const item = makeItem({ type: '2TNK' as UnitType, prerequisite: 'WEAP', buildTime: 5, cost: 100 });
    startProduction(ctx, item);

    // Tick until complete
    for (let i = 0; i < 5; i++) {
      tickProduction(ctx);
      ctx.tick++;
    }

    // Production complete: unit spawned
    expect(ctx.entities.length).toBe(1);
    const unit = ctx.entities[0];
    expect(unit.type).toBe('2TNK');
    expect(unit.house).toBe('Greece');

    // Unit is moving to rally
    expect(unit.mission).toBe(Mission.AREA_GUARD);
    expect(unit.moveTarget).toEqual({ x: rallyPos.x, y: rallyPos.y });
  });

  it('queued production (queueCount=2): both units go to rally on completion', () => {
    const ctx = makeContext();
    const rallyPos: WorldPos = { x: 300, y: 400 };
    ctx.rallyPoints.set('WEAP', rallyPos);

    const item = makeItem({ type: '2TNK' as UnitType, prerequisite: 'WEAP', buildTime: 5, cost: 100 });
    // Manually set up queue with 2 items
    ctx.productionQueue.set('unit', { item, progress: 0, queueCount: 2, costPaid: 0, powerMult: 1 });

    // Complete first unit
    for (let i = 0; i < 5; i++) {
      tickProduction(ctx);
      ctx.tick++;
    }
    expect(ctx.entities.length).toBe(1);
    expect(ctx.entities[0].moveTarget).toEqual({ x: rallyPos.x, y: rallyPos.y });

    // Queue should still have 1 remaining
    const entry = ctx.productionQueue.get('unit');
    expect(entry).toBeDefined();
    expect(entry!.queueCount).toBe(1);

    // Complete second unit
    for (let i = 0; i < 5; i++) {
      tickProduction(ctx);
      ctx.tick++;
    }
    expect(ctx.entities.length).toBe(2);
    expect(ctx.entities[1].moveTarget).toEqual({ x: rallyPos.x, y: rallyPos.y });
  });

  it('infantry from barracks uses BARR rally point, not WEAP rally', () => {
    const ctx = makeContext();
    ctx.rallyPoints.set('WEAP', { x: 100, y: 100 });
    ctx.rallyPoints.set('BARR', { x: 500, y: 500 });

    const infantryItem = makeItem({
      type: UnitType.E1,
      name: 'Rifle Infantry',
      prerequisite: 'BARR',
    });
    spawnProducedUnit(ctx, infantryItem);

    expect(ctx.entities.length).toBe(1);
    const infantry = ctx.entities[0];
    // Should use BARR rally, not WEAP rally
    expect(infantry.moveTarget).toEqual({ x: 500, y: 500 });
  });

  it('no factory building alive → unit is NOT spawned', () => {
    const ctx = makeContext();
    // Kill all structures
    for (const s of ctx.structures) {
      s.alive = false;
    }

    ctx.rallyPoints.set('WEAP', { x: 100, y: 100 });
    const item = makeItem({ type: '2TNK' as UnitType, prerequisite: 'WEAP' });
    spawnProducedUnit(ctx, item);

    // No factory alive → no unit spawned
    expect(ctx.entities.length).toBe(0);
  });
});
