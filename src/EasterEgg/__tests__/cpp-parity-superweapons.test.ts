/**
 * C++ Behavioral Parity: Superweapon Structures — PDOX, IRON, MSLO
 *
 * Tests verify superweapon structure behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * - PDOX (Chronosphere): Allied superweapon, teleports units
 * - IRON (Iron Curtain): Soviet superweapon, grants temporary invulnerability
 * - MSLO (Missile Silo): Both factions, launches nuclear missile
 *
 * These tests describe WHAT happens with superweapon structures (observable
 * outcomes: stats, power drain, superweapon charging, activation effects),
 * not HOW the code implements it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, POWER_DRAIN, PRODUCTION_ITEMS,
  buildDefaultAlliances, worldDist,
  SuperweaponType, SUPERWEAPON_DEFS,
  IRON_CURTAIN_DURATION, CHRONO_SHIFT_VISUAL_TICKS,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  structureDamage,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import {
  type MapStructure, STRUCTURE_SIZE, STRUCTURE_MAX_HP,
  STRUCTURE_WEAPONS, STRUCTURE_POWERED,
} from '../engine/scenario';
import {
  calculatePowerGrid, sellRefund, repairCostPerStep,
} from '../engine/repairSell';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeStructure(
  type: string, cx: number, cy: number,
  hp?: number, house: House = House.Spain,
): MapStructure {
  const maxHp = STRUCTURE_MAX_HP[type] ?? 256;
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp: hp ?? maxHp, maxHp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(
  structures: MapStructure[] = [],
  entities: Entity[] = [],
): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
    inflightProjectiles: [],
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    scenarioId: 'TEST',
    killCount: 0,
    lossCount: 0,
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    attackedTriggerNames: new Set<string>(),
    map,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    movementSpeed: () => 1,
    getFirepowerBias: (house: House) => 1.0,
    getArmorBias: () => 1.0,
    getROFBias: () => 1.0,
    damageStructure: () => false,
    aiIQ: () => 3,
    warheadMuzzleColor: () => '#fff',
    aiStates: new Map(),
    lastBaseAttackEva: -Infinity,
    gameTicksPerSec: 15,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => {},
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
    powerConsumed: 0,
    powerProduced: 100,
  } as CombatContext;
}

// =============================================================================
// PDOX — Chronosphere (Allied Superweapon)
// =============================================================================

// -- Stats (rules.ini) --------------------------------------------------------
//
// C++ rules.ini: PDOX -> Strength=400, Cost=2800, Power=200 (consumes 200W),
// Prerequisite=ATEK, Owner=allies, TechLevel=12

describe('PDOX stats (rules.ini parity)', () => {

  it('max HP is 400', () => {
    expect(STRUCTURE_MAX_HP['PDOX']).toBe(400);
  });

  it('footprint is 2x2 cells', () => {
    expect(STRUCTURE_SIZE['PDOX']).toEqual([2, 2]);
  });

  it('has no weapon (superweapon structure, not defensive)', () => {
    expect(STRUCTURE_WEAPONS['PDOX']).toBeUndefined();
  });

  it('consumes 200W power (heavy drain)', () => {
    expect(POWER_DRAIN['PDOX']).toBe(200);
  });

  it('is a powered structure (disabled during low power)', () => {
    expect(STRUCTURE_POWERED.has('PDOX')).toBe(true);
  });

  it('production item has correct cost (2800) and prerequisite (ATEK)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'PDOX');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(2800);
    expect(item!.prerequisite).toBe('ATEK');
  });

  it('is Allied faction only', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'PDOX');
    expect(item!.faction).toBe('allied');
  });
});

// -- Superweapon Def (types.ts / C++ house.cpp) --------------------------------

describe('PDOX superweapon definition (Chronosphere)', () => {

  const def = SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE];

  it('is linked to PDOX building', () => {
    expect(def.building).toBe('PDOX');
  });

  it('requires a target (player clicks destination)', () => {
    expect(def.needsTarget).toBe(true);
    expect(def.targetMode).toBe('ground');
  });

  it('requires power to charge', () => {
    expect(def.requiresPower).toBe(true);
  });

  it('is Allied faction', () => {
    expect(def.faction).toBe('allied');
  });

  it('recharge time is 6300 ticks (7 minutes at 15 FPS)', () => {
    expect(def.rechargeTicks).toBe(6300);
  });
});

// -- Chronoshift Effect (entity.ts) -------------------------------------------
//
// C++ building.cpp / house.cpp: Chronoshifted units get a visual timer
// and are teleported to the target position.

describe('PDOX chronoshift entity effect', () => {

  it('entity has chronoShiftTick property (defaults to 0)', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(unit.chronoShiftTick).toBe(0);
  });

  it('chronoShiftTick can be set to CHRONO_SHIFT_VISUAL_TICKS (30)', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    unit.chronoShiftTick = CHRONO_SHIFT_VISUAL_TICKS;
    expect(unit.chronoShiftTick).toBe(30);
  });

  it('CHRONO_SHIFT_VISUAL_TICKS is 30 (blue flash duration)', () => {
    expect(CHRONO_SHIFT_VISUAL_TICKS).toBe(30);
  });
});

// -- PDOX Power Grid Integration ---------------------------------------------

describe('PDOX in power grid (calculatePowerGrid)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('PDOX consumes 200W from the grid', () => {
    const pdox = makeStructure('PDOX', 10, 10, 400, House.Spain);
    const grid = calculatePowerGrid([pdox], House.Spain, isAllied);
    expect(grid.consumed).toBe(200);
    expect(grid.produced).toBe(0); // PDOX does not produce power
  });

  it('PDOX + POWR: net power = 100 - 200 = -100 (power deficit)', () => {
    const pdox = makeStructure('PDOX', 10, 10, 400, House.Spain);
    const powr = makeStructure('POWR', 14, 10, 400, House.Spain);
    const grid = calculatePowerGrid([pdox, powr], House.Spain, isAllied);
    expect(grid.produced).toBe(100);
    expect(grid.consumed).toBe(200);
    expect(grid.produced - grid.consumed).toBe(-100);
  });

  it('dead PDOX does not consume power', () => {
    const pdox = makeStructure('PDOX', 10, 10, 0, House.Spain);
    pdox.alive = false;
    const grid = calculatePowerGrid([pdox], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('selling PDOX does not count in grid', () => {
    const pdox = makeStructure('PDOX', 10, 10, 400, House.Spain);
    pdox.sellProgress = 0.5;
    const grid = calculatePowerGrid([pdox], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('enemy PDOX does not affect player grid', () => {
    const pdox = makeStructure('PDOX', 10, 10, 400, House.USSR);
    const grid = calculatePowerGrid([pdox], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });
});

// -- PDOX Economic Functions --------------------------------------------------

describe('PDOX economic functions (rules.ini Cost=2800)', () => {
  const PDOX_COST = 2800;
  const PDOX_MAX_HP = 400;

  it('sell refund is 50% of build cost = 1400', () => {
    expect(sellRefund(PDOX_COST)).toBe(1400);
  });

  it('repair cost per step: stepsToFull=400/7=57, costPerStep=2800/57=49, (51*49+128)/256=10', () => {
    expect(repairCostPerStep(PDOX_COST, PDOX_MAX_HP)).toBe(10);
  });
});

// -- PDOX 2x2 Footprint -------------------------------------------------------

describe('PDOX 2x2 footprint', () => {

  it('footprint occupies 4 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['PDOX']!;
    expect(w * h).toBe(4);
    const cells: [number, number][] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push([10 + dx, 10 + dy]);
      }
    }
    expect(cells).toEqual([[10, 10], [11, 10], [10, 11], [11, 11]]);
  });
});

// -- PDOX Destruction Blast ---------------------------------------------------

describe('PDOX destruction blast -- visual-only (C++ parity: no entity damage)', () => {

  it('entities take NO damage on destruction (visual-only explosion)', () => {
    const pdox = makeStructure('PDOX', 10, 10, 50, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([pdox], [victim]);
    structureDamage(ctx, pdox, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const pdox = makeStructure('PDOX', 10, 10, 50, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx = makeCombatCtx([pdox], [victim]);
    structureDamage(ctx, pdox, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });
});

// =============================================================================
// IRON — Iron Curtain (Soviet Superweapon)
// =============================================================================

// -- Stats (rules.ini) --------------------------------------------------------
//
// C++ rules.ini: IRON -> Strength=400, Cost=2800, Power=200 (consumes 200W),
// Prerequisite=STEK, Owner=soviet, TechLevel=12

describe('IRON stats (rules.ini parity)', () => {

  it('max HP is 400', () => {
    expect(STRUCTURE_MAX_HP['IRON']).toBe(400);
  });

  it('footprint is 2x2 cells', () => {
    expect(STRUCTURE_SIZE['IRON']).toEqual([2, 2]);
  });

  it('has no weapon (superweapon structure, not defensive)', () => {
    expect(STRUCTURE_WEAPONS['IRON']).toBeUndefined();
  });

  it('consumes 200W power (heavy drain)', () => {
    expect(POWER_DRAIN['IRON']).toBe(200);
  });

  it('is a powered structure (disabled during low power)', () => {
    expect(STRUCTURE_POWERED.has('IRON')).toBe(true);
  });

  it('production item has correct cost (2800) and prerequisite (STEK)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'IRON');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(2800);
    expect(item!.prerequisite).toBe('STEK');
  });

  it('is Soviet faction only', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'IRON');
    expect(item!.faction).toBe('soviet');
  });
});

// -- Superweapon Def (types.ts / C++ house.cpp) --------------------------------

describe('IRON superweapon definition (Iron Curtain)', () => {

  const def = SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN];

  it('is linked to IRON building', () => {
    expect(def.building).toBe('IRON');
  });

  it('requires a target (player clicks a unit)', () => {
    expect(def.needsTarget).toBe(true);
    expect(def.targetMode).toBe('unit');
  });

  it('requires power to charge', () => {
    expect(def.requiresPower).toBe(true);
  });

  it('is Soviet faction', () => {
    expect(def.faction).toBe('soviet');
  });

  it('recharge time is 9900 ticks (11 minutes at 15 FPS)', () => {
    expect(def.rechargeTicks).toBe(9900);
  });
});

// -- Iron Curtain Invulnerability (entity.ts) ---------------------------------
//
// C++ building.cpp / house.cpp: Iron Curtain grants temporary invulnerability
// via ironCurtainTick on the target entity.

describe('IRON curtain entity invulnerability', () => {

  it('entity has ironCurtainTick property (defaults to 0)', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    expect(unit.ironCurtainTick).toBe(0);
  });

  it('entity is NOT invulnerable when ironCurtainTick = 0', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    expect(unit.isInvulnerable).toBe(false);
  });

  it('setting ironCurtainTick > 0 makes entity invulnerable', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    unit.ironCurtainTick = IRON_CURTAIN_DURATION;
    expect(unit.isInvulnerable).toBe(true);
  });

  it('IRON_CURTAIN_DURATION is 675 ticks (45 seconds at 15 FPS) — C++ parity', () => {
    // C++ rules.cpp:483 reads IronCurtain=.75 from rules.ini → 0.75 * 900 = 675
    expect(IRON_CURTAIN_DURATION).toBe(675);
  });

  it('ironCurtainTick = 1 still makes entity invulnerable (last tick)', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    unit.ironCurtainTick = 1;
    expect(unit.isInvulnerable).toBe(true);
  });

  it('invulnerability from iron curtain and invulnTick are independent', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    // Only ironCurtainTick set
    unit.ironCurtainTick = 100;
    expect(unit.isInvulnerable).toBe(true);
    // Reset ironCurtainTick, set invulnTick instead
    unit.ironCurtainTick = 0;
    unit.invulnTick = 100;
    expect(unit.isInvulnerable).toBe(true);
    // Both at 0
    unit.invulnTick = 0;
    expect(unit.isInvulnerable).toBe(false);
  });
});

// -- IRON Power Grid Integration ----------------------------------------------

describe('IRON in power grid (calculatePowerGrid)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('IRON consumes 200W from the grid', () => {
    const iron = makeStructure('IRON', 10, 10, 400, House.USSR);
    const grid = calculatePowerGrid([iron], House.USSR, isAllied);
    expect(grid.consumed).toBe(200);
    expect(grid.produced).toBe(0);
  });

  it('dead IRON does not consume power', () => {
    const iron = makeStructure('IRON', 10, 10, 0, House.USSR);
    iron.alive = false;
    const grid = calculatePowerGrid([iron], House.USSR, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('selling IRON does not count in grid', () => {
    const iron = makeStructure('IRON', 10, 10, 400, House.USSR);
    iron.sellProgress = 0.5;
    const grid = calculatePowerGrid([iron], House.USSR, isAllied);
    expect(grid.consumed).toBe(0);
  });
});

// -- IRON Economic Functions --------------------------------------------------

describe('IRON economic functions (rules.ini Cost=2800)', () => {
  const IRON_COST = 2800;
  const IRON_MAX_HP = 400;

  it('sell refund is 50% of build cost = 1400', () => {
    expect(sellRefund(IRON_COST)).toBe(1400);
  });

  it('repair cost per step: stepsToFull=400/7=57, costPerStep=2800/57=49, (51*49+128)/256=10', () => {
    expect(repairCostPerStep(IRON_COST, IRON_MAX_HP)).toBe(10);
  });
});

// -- IRON 2x2 Footprint -------------------------------------------------------

describe('IRON 2x2 footprint', () => {

  it('footprint occupies 4 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['IRON']!;
    expect(w * h).toBe(4);
    const cells: [number, number][] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push([10 + dx, 10 + dy]);
      }
    }
    expect(cells).toEqual([[10, 10], [11, 10], [10, 11], [11, 11]]);
  });
});

// -- IRON Destruction Blast ---------------------------------------------------

describe('IRON destruction blast -- visual-only (C++ parity: no entity damage)', () => {

  it('entities take NO damage on destruction (visual-only explosion)', () => {
    const iron = makeStructure('IRON', 10, 10, 50, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([iron], [victim]);
    structureDamage(ctx, iron, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const iron = makeStructure('IRON', 10, 10, 50, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx = makeCombatCtx([iron], [victim]);
    structureDamage(ctx, iron, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('no entity damage at any distance (visual-only explosion)', () => {
    const iron = makeStructure('IRON', 10, 10, 50, House.USSR);
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 12);
    const ctx = makeCombatCtx([iron], [close, far]);
    structureDamage(ctx, iron, 100);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBe(0);
    expect(farDmg).toBe(0);
  });
});

// =============================================================================
// MSLO — Missile Silo (Both Factions Superweapon)
// =============================================================================

// -- Stats (rules.ini) --------------------------------------------------------
//
// C++ rules.ini: MSLO -> Strength=400, Cost=2500, Power=100 (consumes 100W),
// Prerequisite=STEK, Owner=allies,soviet, TechLevel=13

describe('MSLO stats (rules.ini parity)', () => {

  it('max HP is 400', () => {
    expect(STRUCTURE_MAX_HP['MSLO']).toBe(400);
  });

  it('footprint is 2x1 cells', () => {
    expect(STRUCTURE_SIZE['MSLO']).toEqual([2, 1]);
  });

  it('has no weapon (superweapon structure, not defensive)', () => {
    expect(STRUCTURE_WEAPONS['MSLO']).toBeUndefined();
  });

  it('consumes 100W power', () => {
    expect(POWER_DRAIN['MSLO']).toBe(100);
  });

  it('is NOT a powered structure (C++ rules.ini has no Powered=yes for MSLO)', () => {
    expect(STRUCTURE_POWERED.has('MSLO')).toBe(false);
  });

  it('production item has correct cost (2500) and prerequisite (STEK)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'MSLO');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(2500);
    expect(item!.prerequisite).toBe('STEK');
  });

  it('is available to both factions (rules.ini Owner=allies,soviet)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'MSLO');
    expect(item!.faction).toBe('both');
  });
});

// -- Superweapon Def (types.ts / C++ house.cpp) --------------------------------

describe('MSLO superweapon definition (Nuclear Strike)', () => {

  const def = SUPERWEAPON_DEFS[SuperweaponType.NUKE];

  it('is linked to MSLO building', () => {
    expect(def.building).toBe('MSLO');
  });

  it('requires a target (player clicks ground)', () => {
    expect(def.needsTarget).toBe(true);
    expect(def.targetMode).toBe('ground');
  });

  it('requires power to charge', () => {
    expect(def.requiresPower).toBe(true);
  });

  it('faction is soviet in SUPERWEAPON_DEFS', () => {
    expect(def.faction).toBe('soviet');
  });

  it('recharge time is 11700 ticks (13 minutes at 15 FPS)', () => {
    expect(def.rechargeTicks).toBe(11700);
  });
});

// -- MSLO Power Grid Integration ----------------------------------------------

describe('MSLO in power grid (calculatePowerGrid)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('MSLO consumes 100W from the grid', () => {
    const mslo = makeStructure('MSLO', 10, 10, 400, House.USSR);
    const grid = calculatePowerGrid([mslo], House.USSR, isAllied);
    expect(grid.consumed).toBe(100);
    expect(grid.produced).toBe(0);
  });

  it('MSLO + 2x APWR: plenty of power for charging', () => {
    const mslo = makeStructure('MSLO', 10, 10, 400, House.USSR);
    const apwr1 = makeStructure('APWR', 14, 10, 700, House.USSR);
    const apwr2 = makeStructure('APWR', 18, 10, 700, House.USSR);
    const grid = calculatePowerGrid([mslo, apwr1, apwr2], House.USSR, isAllied);
    expect(grid.produced).toBe(400); // 2x 200W APWR
    expect(grid.consumed).toBe(100);
    expect(grid.produced - grid.consumed).toBe(300);
  });

  it('dead MSLO does not consume power', () => {
    const mslo = makeStructure('MSLO', 10, 10, 0, House.USSR);
    mslo.alive = false;
    const grid = calculatePowerGrid([mslo], House.USSR, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('selling MSLO does not count in grid', () => {
    const mslo = makeStructure('MSLO', 10, 10, 400, House.USSR);
    mslo.sellProgress = 0.5;
    const grid = calculatePowerGrid([mslo], House.USSR, isAllied);
    expect(grid.consumed).toBe(0);
  });
});

// -- MSLO Economic Functions --------------------------------------------------

describe('MSLO economic functions (rules.ini Cost=2500)', () => {
  const MSLO_COST = 2500;
  const MSLO_MAX_HP = 400;

  it('sell refund is 50% of build cost = 1250', () => {
    expect(sellRefund(MSLO_COST)).toBe(1250);
  });

  it('repair cost per step: stepsToFull=400/7=57, costPerStep=2500/57=43, (51*43+128)/256=9', () => {
    expect(repairCostPerStep(MSLO_COST, MSLO_MAX_HP)).toBe(9);
  });
});

// -- MSLO 2x1 Footprint -------------------------------------------------------

describe('MSLO 2x1 footprint', () => {

  it('footprint occupies 2 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['MSLO']!;
    expect(w * h).toBe(2);
    const cells: [number, number][] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push([10 + dx, 10 + dy]);
      }
    }
    expect(cells).toEqual([[10, 10], [11, 10]]);
  });
});

// -- MSLO Destruction Blast ---------------------------------------------------

describe('MSLO destruction blast -- visual-only (C++ parity: no entity damage)', () => {

  it('entities take NO damage on destruction (visual-only explosion)', () => {
    const mslo = makeStructure('MSLO', 10, 10, 50, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([mslo], [victim]);
    structureDamage(ctx, mslo, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const mslo = makeStructure('MSLO', 10, 10, 50, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx = makeCombatCtx([mslo], [victim]);
    structureDamage(ctx, mslo, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('damages adjacent structures on destruction', () => {
    const mslo = makeStructure('MSLO', 10, 10, 50, House.USSR);
    const nearby = makeStructure('SILO', 12, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([mslo, nearby]);
    const origHp = nearby.hp;
    structureDamage(ctx, mslo, 100);
    expect(nearby.hp).toBeLessThan(origHp);
  });
});

// =============================================================================
// Cross-Cutting: All Three Superweapon Structures
// =============================================================================

describe('superweapon structures — shared behavioral invariants', () => {

  it('PDOX and IRON are 2x2, MSLO is 2x1', () => {
    expect(STRUCTURE_SIZE['PDOX']).toEqual([2, 2]);
    expect(STRUCTURE_SIZE['IRON']).toEqual([2, 2]);
    expect(STRUCTURE_SIZE['MSLO']).toEqual([2, 1]);
  });

  it('all three have 400 max HP', () => {
    for (const type of ['PDOX', 'IRON', 'MSLO']) {
      expect(STRUCTURE_MAX_HP[type]).toBe(400);
    }
  });

  it('PDOX and IRON are powered structures; MSLO is not', () => {
    expect(STRUCTURE_POWERED.has('PDOX')).toBe(true);
    expect(STRUCTURE_POWERED.has('IRON')).toBe(true);
    expect(STRUCTURE_POWERED.has('MSLO')).toBe(false);
  });

  it('none have weapons (superweapon buildings are unarmed)', () => {
    for (const type of ['PDOX', 'IRON', 'MSLO']) {
      expect(STRUCTURE_WEAPONS[type]).toBeUndefined();
    }
  });

  it('all three are high-cost structures (>= 2500)', () => {
    for (const type of ['PDOX', 'IRON', 'MSLO']) {
      const item = PRODUCTION_ITEMS.find(p => p.type === type);
      expect(item).toBeDefined();
      expect(item!.cost).toBeGreaterThanOrEqual(2500);
    }
  });

  it('all three require advanced prerequisites (tech centers)', () => {
    const pdox = PRODUCTION_ITEMS.find(p => p.type === 'PDOX')!;
    const iron = PRODUCTION_ITEMS.find(p => p.type === 'IRON')!;
    const mslo = PRODUCTION_ITEMS.find(p => p.type === 'MSLO')!;
    expect(pdox.prerequisite).toBe('ATEK');
    expect(iron.prerequisite).toBe('STEK');
    expect(mslo.prerequisite).toBe('STEK');
  });

  it('each structure maps to a distinct superweapon type', () => {
    const chronoDef = SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE];
    const icDef = SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN];
    const nukeDef = SUPERWEAPON_DEFS[SuperweaponType.NUKE];
    expect(chronoDef.building).toBe('PDOX');
    expect(icDef.building).toBe('IRON');
    expect(nukeDef.building).toBe('MSLO');
  });

  it('all three superweapons require power to charge', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].requiresPower).toBe(true);
    expect(SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN].requiresPower).toBe(true);
    expect(SUPERWEAPON_DEFS[SuperweaponType.NUKE].requiresPower).toBe(true);
  });

  it('all three superweapons require a player-selected target', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].needsTarget).toBe(true);
    expect(SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN].needsTarget).toBe(true);
    expect(SUPERWEAPON_DEFS[SuperweaponType.NUKE].needsTarget).toBe(true);
  });

  it('PDOX and IRON are symmetric in cost and HP (2800 / 400)', () => {
    const pdoxItem = PRODUCTION_ITEMS.find(p => p.type === 'PDOX')!;
    const ironItem = PRODUCTION_ITEMS.find(p => p.type === 'IRON')!;
    expect(pdoxItem.cost).toBe(ironItem.cost);
    expect(STRUCTURE_MAX_HP['PDOX']).toBe(STRUCTURE_MAX_HP['IRON']);
  });

  it('PDOX and IRON have symmetric power drain (200W each)', () => {
    expect(POWER_DRAIN['PDOX']).toBe(200);
    expect(POWER_DRAIN['IRON']).toBe(200);
  });

  it('MSLO is cheaper (2500 vs 2800) but has lower power drain (100W vs 200W)', () => {
    const msloItem = PRODUCTION_ITEMS.find(p => p.type === 'MSLO')!;
    const pdoxItem = PRODUCTION_ITEMS.find(p => p.type === 'PDOX')!;
    expect(msloItem.cost).toBeLessThan(pdoxItem.cost);
    expect(POWER_DRAIN['MSLO']!).toBeLessThan(POWER_DRAIN['PDOX']!);
  });
});

// -- Power grid with multiple superweapons ------------------------------------

describe('multiple superweapon structures in power grid', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('IRON + MSLO (soviet base) consumes 300W total', () => {
    const iron = makeStructure('IRON', 10, 10, 400, House.USSR);
    const mslo = makeStructure('MSLO', 14, 10, 400, House.USSR);
    const grid = calculatePowerGrid([iron, mslo], House.USSR, isAllied);
    expect(grid.consumed).toBe(300);
  });

  it('PDOX (allied) + IRON (soviet) on different sides do not combine', () => {
    const pdox = makeStructure('PDOX', 10, 10, 400, House.Spain);
    const iron = makeStructure('IRON', 14, 10, 400, House.USSR);

    const alliedGrid = calculatePowerGrid([pdox, iron], House.Spain, isAllied);
    expect(alliedGrid.consumed).toBe(200); // Only PDOX

    const sovietGrid = calculatePowerGrid([pdox, iron], House.USSR, isAllied);
    expect(sovietGrid.consumed).toBe(200); // Only IRON
  });
});
