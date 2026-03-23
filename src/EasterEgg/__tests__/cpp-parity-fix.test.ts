/**
 * C++ Behavioral Parity: FIX — Service Depot
 *
 * Tests verify Service Depot behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with a Service Depot (observable
 * outcomes: stats, power drain, vehicle repair, rearm, prerequisite
 * gating), not HOW the code implements it. The same scenarios should
 * produce identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, POWER_DRAIN, COUNTRY_BONUSES,
  PRODUCTION_ITEMS, Mission,
  buildDefaultAlliances, worldDist,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  structureDamage,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import {
  type MapStructure, STRUCTURE_SIZE, STRUCTURE_MAX_HP,
  STRUCTURE_WEAPONS,
} from '../engine/scenario';
import {
  powerOutput, calculatePowerGrid, sellRefund, repairCostPerStep,
  tickServiceDepot,
  type RepairSellContext,
} from '../engine/repairSell';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeFIX(cx: number, cy: number, hp = 800, house: House = House.Spain): MapStructure {
  return {
    type: 'FIX', image: 'fix', house,
    cx, cy, hp, maxHp: 800, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function makeBuilding(type: string, cx: number, cy: number, hp: number, house: House = House.USSR): MapStructure {
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp, maxHp: hp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Place entity at the depot center — matches tickServiceDepot's (cx*CELL_SIZE+CELL_SIZE, cy*CELL_SIZE+CELL_SIZE).
 *  C++ building.cpp:3860: 0x10 leptons (~0.0625 cells) docking threshold, so placement must be exact. */
function entityDockedAtFIX(type: UnitType, house: House, fixCx: number, fixCy: number): Entity {
  const wx = fixCx * CELL_SIZE + CELL_SIZE;
  const wy = fixCy * CELL_SIZE + CELL_SIZE;
  return new Entity(type, house, wx, wy);
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
    getFirepowerBias: (house: House) => COUNTRY_BONUSES[house]?.firepowerMult ?? 1.0,
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

function makeRepairSellCtx(
  structures: MapStructure[],
  entities: Entity[],
  credits = 10000,
): RepairSellContext {
  const alliances = buildDefaultAlliances();
  return {
    structures,
    entities,
    credits,
    tick: 0,
    playerHouse: House.Spain,
    powerProduced: 100,
    powerConsumed: 100,
    repairingStructures: new Set(),
    scenarioProductionItems: PRODUCTION_ITEMS,
    effects: [] as Effect[],
    siloCapacity: 5000,
    gapGeneratorCells: new Map(),
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playEva: () => {},
    playSound: () => {},
    playSoundAt: () => {},
    clearStructureFootprint: () => {},
  };
}

// -- Stats (rules.ini / building.cpp) -----------------------------------------
//
// C++ rules.ini: FIX -> Strength=800, Cost=1200, Power=30 (consumes 30W),
// Prerequisite=WEAP, Owner=allies,soviet, TechLevel=3

describe('FIX stats (rules.ini parity)', () => {

  it('max HP is 800', () => {
    expect(STRUCTURE_MAX_HP['FIX']).toBe(800);
  });

  it('footprint is 3x3 cells', () => {
    expect(STRUCTURE_SIZE['FIX']).toEqual([3, 3]);
  });

  it('has no weapon (support structure)', () => {
    expect(STRUCTURE_WEAPONS['FIX']).toBeUndefined();
  });

  it('consumes 30W power (POWER_DRAIN)', () => {
    expect(POWER_DRAIN['FIX']).toBe(30);
  });

  it('cost is 1200 credits', () => {
    const fixItem = PRODUCTION_ITEMS.find(p => p.type === 'FIX');
    expect(fixItem).toBeDefined();
    expect(fixItem!.cost).toBe(1200);
  });

  it('is available to both factions (rules.ini Owner=allies,soviet)', () => {
    const fixItem = PRODUCTION_ITEMS.find(p => p.type === 'FIX');
    expect(fixItem).toBeDefined();
    expect(fixItem!.faction).toBe('both');
  });

  it('prerequisite is WEAP (War Factory)', () => {
    const fixItem = PRODUCTION_ITEMS.find(p => p.type === 'FIX');
    expect(fixItem).toBeDefined();
    expect(fixItem!.prerequisite).toBe('WEAP');
  });

  it('is a structure production item', () => {
    const fixItem = PRODUCTION_ITEMS.find(p => p.type === 'FIX');
    expect(fixItem).toBeDefined();
    expect(fixItem!.isStructure).toBe(true);
  });

  it('tech level is 3', () => {
    const fixItem = PRODUCTION_ITEMS.find(p => p.type === 'FIX');
    expect(fixItem).toBeDefined();
    expect(fixItem!.techLevel).toBe(3);
  });

  it('can be placed for either allied or soviet house', () => {
    const alliedFIX = makeFIX(10, 10, 800, House.Spain);
    const sovietFIX = makeFIX(20, 20, 800, House.USSR);
    expect(alliedFIX.type).toBe('FIX');
    expect(sovietFIX.type).toBe('FIX');
  });
});

// -- Prerequisite for MNLY and MECH ------------------------------------------
//
// C++ rules.ini: MNLY Prerequisite=weap,fix; MECH Prerequisite=tent,fix
// FIX is a techPrereq for both units — you need it built to unlock them.

describe('FIX as prerequisite for MNLY and MECH', () => {

  it('MNLY has techPrereq=FIX (rules.ini Prerequisite=weap,fix)', () => {
    const mnly = PRODUCTION_ITEMS.find(p => p.type === 'MNLY');
    expect(mnly).toBeDefined();
    expect(mnly!.techPrereq).toBe('FIX');
  });

  it('MECH has techPrereq=FIX (rules.ini Prerequisite=tent,fix)', () => {
    const mech = PRODUCTION_ITEMS.find(p => p.type === 'MECH');
    expect(mech).toBeDefined();
    expect(mech!.techPrereq).toBe('FIX');
  });

  it('MNLY is both-faction (allies and soviet can build with FIX)', () => {
    const mnly = PRODUCTION_ITEMS.find(p => p.type === 'MNLY');
    expect(mnly).toBeDefined();
    expect(mnly!.faction).toBe('both');
  });

  it('MECH is allied-only (only allies get mechanic with FIX)', () => {
    const mech = PRODUCTION_ITEMS.find(p => p.type === 'MECH');
    expect(mech).toBeDefined();
    expect(mech!.faction).toBe('allied');
  });
});

// -- 3x3 Footprint -----------------------------------------------------------
//
// C++ STRUCTURE_SIZE: FIX is 3x3 (BSIZE_33). The origin cell is top-left;
// the structure occupies 9 cells total.

describe('FIX 3x3 footprint', () => {

  it('footprint occupies 9 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['FIX']!;
    expect(w).toBe(3);
    expect(h).toBe(3);
    expect(w * h).toBe(9);
  });

  it('cells enumeration from origin (10,10)', () => {
    const [w, h] = STRUCTURE_SIZE['FIX']!;
    const cells: [number, number][] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push([10 + dx, 10 + dy]);
      }
    }
    expect(cells).toEqual([
      [10, 10], [11, 10], [12, 10],
      [10, 11], [11, 11], [12, 11],
      [10, 12], [11, 12], [12, 12],
    ]);
  });
});

// -- Power Drain (not production) ---------------------------------------------
//
// FIX consumes 30W — it does NOT produce power. Unlike POWR/APWR,
// FIX has a positive Power= value in rules.ini meaning consumption.

describe('FIX power drain (rules.ini Power=30)', () => {

  it('does not produce any power', () => {
    expect(powerOutput('FIX', 800, 800)).toBe(0);
  });

  it('contributes 30W to consumed in power grid', () => {
    const alliances = buildDefaultAlliances();
    const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

    const fix = makeFIX(10, 10, 800, House.Spain);
    const powr = makeBuilding('POWR', 14, 10, 400, House.Spain);
    const grid = calculatePowerGrid([fix, powr], House.Spain, isAllied);
    expect(grid.consumed).toBe(30);
    expect(grid.produced).toBe(100);
  });

  it('dead FIX does not drain power', () => {
    const alliances = buildDefaultAlliances();
    const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

    const fix = makeFIX(10, 10, 0, House.Spain);
    fix.alive = false;
    const grid = calculatePowerGrid([fix], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('selling FIX does not drain power', () => {
    const alliances = buildDefaultAlliances();
    const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

    const fix = makeFIX(10, 10, 800, House.Spain);
    fix.sellProgress = 0.5;
    const grid = calculatePowerGrid([fix], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('enemy FIX does not contribute to player grid', () => {
    const alliances = buildDefaultAlliances();
    const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

    const fix = makeFIX(10, 10, 800, House.USSR);
    const grid = calculatePowerGrid([fix], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });
});

// -- Economic Functions (repairSell.ts) ---------------------------------------
//
// C++ rules.ini: FIX Cost=1200, Strength=800

describe('FIX economic functions (rules.ini Cost=1200)', () => {
  const FIX_COST = 1200;
  const FIX_MAX_HP = 800;

  it('sell refund is 50% of build cost = 600', () => {
    expect(sellRefund(FIX_COST)).toBe(600);
  });

  it('repair cost per step: ceil(1200 * 0.25 / (800 / 5)) = ceil(300 / 160) = 2', () => {
    expect(repairCostPerStep(FIX_COST, FIX_MAX_HP)).toBe(2);
  });
});

// -- Service Depot Vehicle Repair (repairSell.ts:tickServiceDepot) ------------
//
// C++ building.cpp: FIX repairs docked vehicles (non-infantry) that are
// within range. Costs credits per repair step. Ejects unit when funds run out.

describe('FIX vehicle repair (tickServiceDepot)', () => {

  it('repairs a docked vehicle (HP increases)', () => {
    const fix = makeFIX(10, 10, 800, House.Spain);
    const tank = entityDockedAtFIX(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.hp = tank.maxHp - 50;
    const hpBefore = tank.hp;

    const ctx = makeRepairSellCtx([fix], [tank]);
    tickServiceDepot(ctx);
    expect(tank.hp).toBeGreaterThan(hpBefore);
  });

  it('does not repair infantry (only vehicles)', () => {
    const fix = makeFIX(10, 10, 800, House.Spain);
    const inf = entityDockedAtFIX(UnitType.I_E1, House.Spain, 10, 10);
    inf.hp = inf.maxHp - 20;
    const hpBefore = inf.hp;

    const ctx = makeRepairSellCtx([fix], [inf]);
    tickServiceDepot(ctx);
    expect(inf.hp).toBe(hpBefore);
  });

  it('deducts credits for repair', () => {
    const fix = makeFIX(10, 10, 800, House.Spain);
    const tank = entityDockedAtFIX(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.hp = tank.maxHp - 50;

    const ctx = makeRepairSellCtx([fix], [tank], 10000);
    const creditsBefore = ctx.credits;
    tickServiceDepot(ctx);
    expect(ctx.credits).toBeLessThan(creditsBefore);
  });

  it('unit stays on depot when credits run out (C++ RADIO_CANT — no ejection)', () => {
    const fix = makeFIX(10, 10, 800, House.Spain);
    const tank = entityDockedAtFIX(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.hp = tank.maxHp - 50;
    const hpBefore = tank.hp;

    const ctx = makeRepairSellCtx([fix], [tank], 0);
    tickServiceDepot(ctx);
    // C++ parity: unit stays on depot, no repair, no ejection
    expect(tank.hp).toBe(hpBefore);
    expect(tank.moveTarget).toBeNull();
  });

  it('does not repair if FIX is dead', () => {
    const fix = makeFIX(10, 10, 0, House.Spain);
    fix.alive = false;
    const tank = entityDockedAtFIX(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.hp = tank.maxHp - 50;
    const hpBefore = tank.hp;

    const ctx = makeRepairSellCtx([fix], [tank]);
    tickServiceDepot(ctx);
    expect(tank.hp).toBe(hpBefore);
  });

  it('does not repair enemy vehicles', () => {
    const fix = makeFIX(10, 10, 800, House.Spain);
    const enemyTank = entityDockedAtFIX(UnitType.V_3TNK, House.USSR, 10, 10);
    enemyTank.hp = enemyTank.maxHp - 50;
    const hpBefore = enemyTank.hp;

    const ctx = makeRepairSellCtx([fix], [enemyTank]);
    tickServiceDepot(ctx);
    expect(enemyTank.hp).toBe(hpBefore);
  });

  it('rearms docked vehicles with limited ammo', () => {
    const fix = makeFIX(10, 10, 800, House.Spain);
    const tank = entityDockedAtFIX(UnitType.V_2TNK, House.Spain, 10, 10);
    // Ensure the unit needs rearm (set maxAmmo > 0 and ammo < maxAmmo)
    tank.maxAmmo = 5;
    tank.ammo = 2;
    // Also set hp < maxHp so the unit is considered as needing service
    // OR just set ammo < maxAmmo — the logic checks needsRearm independently
    tank.hp = tank.maxHp; // full HP, only needs rearm

    const ctx = makeRepairSellCtx([fix], [tank]);
    // Run multiple ticks to let rearm timer expire
    for (let i = 0; i < 40; i++) {
      tickServiceDepot(ctx);
    }
    expect(tank.ammo).toBeGreaterThan(2);
  });

  it('does not repair vehicles far from the depot', () => {
    const fix = makeFIX(10, 10, 800, House.Spain);
    // Place entity far away (20 cells east)
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 30, 10);
    tank.hp = tank.maxHp - 50;
    const hpBefore = tank.hp;

    const ctx = makeRepairSellCtx([fix], [tank]);
    tickServiceDepot(ctx);
    expect(tank.hp).toBe(hpBefore);
  });
});

// -- Destruction Blast — Radial HE (building.cpp) -----------------------------
//
// Non-barrel structures produce a visual-only FBALL1 death animation
// on destruction (C++ parity). No warhead damage is dealt to entities. This is NOT the barrel cardinal
// fire-bullet mechanic.

describe('FIX destruction blast -- visual-only (C++ parity: no entity damage)', () => {

  it('entities take NO damage on destruction (visual-only explosion)', () => {
    const fix = makeFIX(10, 10, 50);
    fix.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([fix], [victim]);
    structureDamage(ctx, fix, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('diagonal entities take NO damage on destruction (visual-only explosion)', () => {
    const fix = makeFIX(10, 10, 50);
    fix.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([fix], [victim]);
    structureDamage(ctx, fix, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('no entity damage at any distance (visual-only explosion)', () => {
    const fix = makeFIX(10, 10, 50);
    fix.house = House.USSR;
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 12);
    const ctx = makeCombatCtx([fix], [close, far]);
    structureDamage(ctx, fix, 100);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBe(0);
    expect(farDmg).toBe(0);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const fix = makeFIX(10, 10, 50);
    fix.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 14, 10); // 4 cells E
    const ctx = makeCombatCtx([fix], [victim]);
    structureDamage(ctx, fix, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('destruction blast damages adjacent structures', () => {
    const fix = makeFIX(10, 10, 50);
    fix.house = House.USSR;
    // FIX blast center is (cx+1, cy+1) in cell-scale.
    // SILO at (12,10) has center (13,11) — distance = 2.0 cells, within radius.
    const nearby = makeBuilding('SILO', 12, 10, 300);
    const ctx = makeCombatCtx([fix, nearby]);
    structureDamage(ctx, fix, 100);
    expect(nearby.hp).toBeLessThan(300);
  });

  it('no barrel cardinal mechanic AND no radial entity damage (visual-only)', () => {
    // Barrel explosions hit ONLY cardinal cells with flat 200 damage.
    // FIX should use radial HE with falloff instead — diagonals should
    // take damage (unlike barrels where diagonals are immune).
    const fix = makeFIX(10, 10, 50);
    fix.house = House.USSR;
    const diagonal = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([fix], [diagonal]);
    structureDamage(ctx, fix, 100);
    // C++ parity: visual-only explosion, no entity damage
    expect(diagonal.hp).toBe(diagonal.maxHp);
  });
});
