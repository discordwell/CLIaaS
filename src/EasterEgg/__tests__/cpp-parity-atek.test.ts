/**
 * C++ Behavioral Parity: ATEK — Allied Technology Center
 *
 * Tests verify Allied Tech Center behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with an ATEK (observable
 * outcomes: stats, power drain, tech-gating, destruction blast),
 * not HOW the code implements it. The same scenarios should produce
 * identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, POWER_DRAIN, COUNTRY_BONUSES,
  PRODUCTION_ITEMS,
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
  calculatePowerGrid, sellRefund, repairCostPerStep,
} from '../engine/repairSell';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeATEK(cx: number, cy: number, hp = 400, house: House = House.Spain): MapStructure {
  return {
    type: 'ATEK', image: 'atek', house,
    cx, cy, hp, maxHp: 400, alive: true, rubble: false,
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

// -- Stats (rules.ini / building.cpp) -----------------------------------------
//
// C++ rules.ini: ATEK -> Strength=400, Cost=1500, Power=200 (drains 200W),
// Prerequisite=WEAP (+ techPrereq DOME), Owner=allies, TechLevel=10

describe('ATEK stats (rules.ini parity)', () => {

  it('max HP is 400', () => {
    expect(STRUCTURE_MAX_HP['ATEK']).toBe(400);
  });

  it('footprint is 2x2 cells', () => {
    expect(STRUCTURE_SIZE['ATEK']).toEqual([2, 2]);
  });

  it('has no weapon (purely tech/economic)', () => {
    expect(STRUCTURE_WEAPONS['ATEK']).toBeUndefined();
  });

  it('consumes 200W power (POWER_DRAIN = 200)', () => {
    expect(POWER_DRAIN['ATEK']).toBe(200);
  });

  it('build cost is 1500 credits', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'ATEK');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(1500);
  });

  it('is allied faction only (Owner=allies)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'ATEK');
    expect(item).toBeDefined();
    expect(item!.faction).toBe('allied');
  });

  it('prerequisite is WEAP (War Factory)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'ATEK');
    expect(item).toBeDefined();
    expect(item!.prerequisite).toBe('WEAP');
  });

  it('techPrereq is DOME (Radar Dome required)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'ATEK');
    expect(item).toBeDefined();
    expect(item!.techPrereq).toBe('DOME');
  });

  it('is classified as a structure (isStructure=true)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'ATEK');
    expect(item).toBeDefined();
    expect(item!.isStructure).toBe(true);
  });

  it('techLevel is 10', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'ATEK');
    expect(item).toBeDefined();
    expect(item!.techLevel).toBe(10);
  });
});

// -- Tech Gating (rules.ini Prerequisite= references to ATEK) ----------------
//
// ATEK is a techPrereq for several advanced Allied units and structures.
// C++ rules.ini: E7 (Tanya), THF (Thief), CA (Cruiser), CTNK (Chrono Tank),
// STNK (Phase Transport), PDOX (Chronosphere) all require ATEK.

describe('ATEK tech gating — units/structures requiring ATEK', () => {

  it('E7 (Tanya) requires ATEK as techPrereq', () => {
    const e7 = PRODUCTION_ITEMS.find(p => p.type === 'E7');
    expect(e7).toBeDefined();
    expect(e7!.techPrereq).toBe('ATEK');
  });

  it('THF (Thief) requires ATEK as techPrereq', () => {
    const thf = PRODUCTION_ITEMS.find(p => p.type === 'THF');
    expect(thf).toBeDefined();
    expect(thf!.techPrereq).toBe('ATEK');
  });

  it('CA (Cruiser) requires ATEK as techPrereq', () => {
    const ca = PRODUCTION_ITEMS.find(p => p.type === 'CA');
    expect(ca).toBeDefined();
    expect(ca!.techPrereq).toBe('ATEK');
  });

  it('CTNK (Chrono Tank) requires ATEK as techPrereq', () => {
    const ctnk = PRODUCTION_ITEMS.find(p => p.type === 'CTNK');
    expect(ctnk).toBeDefined();
    expect(ctnk!.techPrereq).toBe('ATEK');
  });

  it('STNK (Phase Transport) requires ATEK as techPrereq', () => {
    const stnk = PRODUCTION_ITEMS.find(p => p.type === 'STNK');
    expect(stnk).toBeDefined();
    expect(stnk!.techPrereq).toBe('ATEK');
  });

  it('PDOX (Chronosphere) requires ATEK as prerequisite', () => {
    const pdox = PRODUCTION_ITEMS.find(p => p.type === 'PDOX');
    expect(pdox).toBeDefined();
    expect(pdox!.prerequisite).toBe('ATEK');
  });

  it('GAP (Gap Generator) requires ATEK as prerequisite', () => {
    const gap = PRODUCTION_ITEMS.find(p => p.type === 'GAP');
    expect(gap).toBeDefined();
    expect(gap!.prerequisite).toBe('ATEK');
  });

  it('exactly 5 production items have ATEK as techPrereq', () => {
    const gated = PRODUCTION_ITEMS.filter(p => p.techPrereq === 'ATEK');
    expect(gated.map(p => p.type).sort()).toEqual(['CA', 'CTNK', 'E7', 'STNK', 'THF']);
  });

  it('exactly 2 production items have ATEK as prerequisite', () => {
    const gated = PRODUCTION_ITEMS.filter(p => p.prerequisite === 'ATEK');
    expect(gated.map(p => p.type).sort()).toEqual(['GAP', 'PDOX']);
  });
});

// -- Power Grid Integration (calculatePowerGrid) -----------------------------
//
// ATEK consumes 200W from the power grid. It does NOT produce power.
// Only alive, non-selling, allied structures contribute to consumption.

describe('ATEK in power grid (calculatePowerGrid)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('single ATEK consumes 200W, produces 0W', () => {
    const atek = makeATEK(10, 10, 400, House.Spain);
    const grid = calculatePowerGrid([atek], House.Spain, isAllied);
    expect(grid.consumed).toBe(200);
    expect(grid.produced).toBe(0);
  });

  it('ATEK + POWR: 200W consumed, 100W produced -> net -100W', () => {
    const atek = makeATEK(10, 10, 400, House.Spain);
    const powr = makeBuilding('POWR', 14, 10, 400, House.Spain);
    const grid = calculatePowerGrid([atek, powr], House.Spain, isAllied);
    expect(grid.consumed).toBe(200);
    expect(grid.produced).toBe(100);
    expect(grid.produced - grid.consumed).toBe(-100);
  });

  it('dead ATEK does not consume power', () => {
    const atek = makeATEK(10, 10, 0, House.Spain);
    atek.alive = false;
    const grid = calculatePowerGrid([atek], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('selling ATEK does not consume power', () => {
    const atek = makeATEK(10, 10, 400, House.Spain);
    atek.sellProgress = 0.5;
    const grid = calculatePowerGrid([atek], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('enemy ATEK does not contribute to player grid', () => {
    const atek = makeATEK(10, 10, 400, House.USSR);
    const grid = calculatePowerGrid([atek], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('two ATEKs consume 400W total', () => {
    const a1 = makeATEK(10, 10, 400, House.Spain);
    const a2 = makeATEK(14, 10, 400, House.Spain);
    const grid = calculatePowerGrid([a1, a2], House.Spain, isAllied);
    expect(grid.consumed).toBe(400);
  });
});

// -- Economic Functions (repairSell.ts) ---------------------------------------
//
// C++ rules.ini: ATEK Cost=1500, Strength=400

describe('ATEK economic functions (rules.ini Cost=1500)', () => {
  const ATEK_COST = 1500;
  const ATEK_MAX_HP = 400;

  it('sell refund is 50% of build cost = 750', () => {
    expect(sellRefund(ATEK_COST)).toBe(750);
  });

  it('repair cost per step: ceil(1500 * 0.20 / (400 / 7)) = ceil(300 / 57.14) = 6', () => {
    expect(repairCostPerStep(ATEK_COST, ATEK_MAX_HP)).toBe(6);
  });
});

// -- 2x2 Footprint -----------------------------------------------------------
//
// C++ STRUCTURE_SIZE: ATEK is 2x2. The origin cell is top-left;
// the structure occupies (cx,cy), (cx+1,cy), (cx,cy+1), (cx+1,cy+1).

describe('ATEK 2x2 footprint', () => {

  it('footprint occupies 4 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['ATEK']!;
    expect(w * h).toBe(4);
    // Origin at (10,10) -> cells: (10,10), (11,10), (10,11), (11,11)
    const cells: [number, number][] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push([10 + dx, 10 + dy]);
      }
    }
    expect(cells).toEqual([[10, 10], [11, 10], [10, 11], [11, 11]]);
  });
});

// -- Destruction Blast — Radial HE (building.cpp) -----------------------------
//
// Non-barrel structures (including ATEK) use a generic 2-cell radial HE blast
// with distance falloff on destruction. This is NOT the barrel cardinal
// fire-bullet mechanic.

describe('ATEK destruction blast — radial HE (non-barrel)', () => {

  it('damages entities within 2-cell radius on destruction', () => {
    const atek = makeATEK(10, 10, 50);
    atek.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([atek], [victim]);
    structureDamage(ctx, atek, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('damages entities in diagonal cells (within 2-cell radius)', () => {
    const atek = makeATEK(10, 10, 50);
    atek.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const bx = 10 * CELL_SIZE + CELL_SIZE;
    const by = 10 * CELL_SIZE + CELL_SIZE;
    const dist = worldDist({ x: bx, y: by }, victim.pos);
    expect(dist).toBeLessThan(2);
    const ctx = makeCombatCtx([atek], [victim]);
    structureDamage(ctx, atek, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('uses distance falloff (closer = more damage)', () => {
    const atek = makeATEK(10, 10, 50);
    atek.house = House.USSR;
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 12);
    const ctx = makeCombatCtx([atek], [close, far]);
    structureDamage(ctx, atek, 100);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBeGreaterThan(farDmg);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const atek = makeATEK(10, 10, 50);
    atek.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10); // 3 cells E
    const ctx = makeCombatCtx([atek], [victim]);
    structureDamage(ctx, atek, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('destruction blast damages adjacent structures', () => {
    const atek = makeATEK(10, 10, 50);
    atek.house = House.USSR;
    const nearby = makeBuilding('SILO', 12, 10, 256);
    const ctx = makeCombatCtx([atek, nearby]);
    structureDamage(ctx, atek, 100);
    expect(nearby.hp).toBeLessThan(256);
  });

  it('does NOT use barrel cardinal fire-bullet mechanic', () => {
    const atek = makeATEK(10, 10, 50);
    atek.house = House.USSR;
    const diagonal = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([atek], [diagonal]);
    structureDamage(ctx, atek, 100);
    // Radial HE hits diagonals — unlike barrel cardinal-only
    expect(diagonal.hp).toBeLessThan(diagonal.maxHp);
  });
});
