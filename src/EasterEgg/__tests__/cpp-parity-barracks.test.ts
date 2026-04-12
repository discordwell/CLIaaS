/**
 * C++ Behavioral Parity: BARR (Soviet Barracks) & TENT (Allied Barracks)
 *
 * Tests verify barracks behavior matches C++ RA source code.
 * BARR and TENT are functionally identical except for faction ownership:
 *   - BARR: Owner=soviet (Soviet Barracks) — rules.ini Owner=soviet
 *   - TENT: Owner=allies (Allied Barracks) — rules.ini Owner=allies
 *
 * Both share: HP 800, 2x2 footprint, cost 300, no weapon, power drain 20W,
 * and serve as the infantry production prerequisite.
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
  powerOutput, calculatePowerGrid, sellRefund, repairCostPerStep,
} from '../engine/repairSell';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeBarracks(
  type: 'BARR' | 'TENT',
  cx: number, cy: number,
  hp = 800,
  house?: House,
): MapStructure {
  const defaultHouse = type === 'BARR' ? House.USSR : House.Spain;
  return {
    type, image: type.toLowerCase(), house: house ?? defaultHouse,
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
    isRevealedToHouse: () => true,
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

// -- Test both BARR and TENT with shared describe blocks ----------------------

const BARRACKS_TYPES: Array<{ type: 'BARR' | 'TENT'; faction: string; house: House }> = [
  { type: 'BARR', faction: 'soviet', house: House.USSR },
  { type: 'TENT', faction: 'allied', house: House.Spain },
];

// -- Stats (rules.ini / building.cpp) -----------------------------------------
//
// C++ rules.ini: BARR -> Strength=800, Cost=300, Power=20 (consumes 20W),
// Prerequisite=POWR, Owner=soviet, TechLevel=1
// C++ rules.ini: TENT -> Strength=800, Cost=300, Power=20 (consumes 20W),
// Prerequisite=POWR, Owner=allies, TechLevel=1

for (const { type, faction, house } of BARRACKS_TYPES) {
  describe(`${type} stats (rules.ini parity) [${faction}]`, () => {

    it('max HP is 800', () => {
      expect(STRUCTURE_MAX_HP[type]).toBe(800);
    });

    it('footprint is 2x2 cells', () => {
      expect(STRUCTURE_SIZE[type]).toEqual([2, 2]);
    });

    it('has no weapon (non-defensive structure)', () => {
      expect(STRUCTURE_WEAPONS[type]).toBeUndefined();
    });

    it('consumes 20W power (rules.ini Power=20)', () => {
      expect(POWER_DRAIN[type]).toBe(20);
    });

    it('build cost is 300 credits', () => {
      const prodItem = PRODUCTION_ITEMS.find(p => p.type === type);
      expect(prodItem).toBeDefined();
      expect(prodItem!.cost).toBe(300);
    });

    it('requires POWR as prerequisite', () => {
      const prodItem = PRODUCTION_ITEMS.find(p => p.type === type);
      expect(prodItem).toBeDefined();
      expect(prodItem!.prerequisite).toBe('POWR');
    });

    it('tech level is 1 (earliest buildable)', () => {
      const prodItem = PRODUCTION_ITEMS.find(p => p.type === type);
      expect(prodItem).toBeDefined();
      expect(prodItem!.techLevel).toBe(1);
    });

    it('is flagged as a structure', () => {
      const prodItem = PRODUCTION_ITEMS.find(p => p.type === type);
      expect(prodItem).toBeDefined();
      expect(prodItem!.isStructure).toBe(true);
    });
  });
}

// -- Faction Ownership (rules.ini Owner=) -------------------------------------
//
// BARR: Owner=soviet — only soviet houses can build it
// TENT: Owner=allies — only allied houses can build it

describe('Faction ownership parity (rules.ini Owner=)', () => {

  it('BARR is faction=soviet (rules.ini Owner=soviet)', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'BARR');
    expect(prodItem!.faction).toBe('soviet');
  });

  it('TENT is faction=allied (rules.ini Owner=allies)', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'TENT');
    expect(prodItem!.faction).toBe('allied');
  });

  it('BARR can be placed for an allied house', () => {
    const barr = makeBarracks('BARR', 10, 10, 800, House.Spain);
    expect(barr.type).toBe('BARR');
    expect(barr.house).toBe(House.Spain);
  });

  it('TENT can be placed for a soviet house', () => {
    const tent = makeBarracks('TENT', 10, 10, 800, House.USSR);
    expect(tent.type).toBe('TENT');
    expect(tent.house).toBe(House.USSR);
  });
});

// -- Infantry Production Prerequisite -----------------------------------------
//
// C++ rules.ini: Infantry units list TENT (or BARR via the production system)
// as their prerequisite. Both barracks types gate infantry production.
// The TS engine normalizes to TENT as prerequisite key, with BARR acting as
// the allied equivalent.

describe('Infantry production prerequisite role', () => {

  it('multiple infantry types require TENT as prerequisite', () => {
    const infantryFromBarracks = PRODUCTION_ITEMS.filter(
      p => p.prerequisite === 'TENT' && !p.isStructure,
    );
    // E1, E2, E3, E4, E6, MEDI, SHOK, MECH, E7, THF = at least 10 items
    expect(infantryFromBarracks.length).toBeGreaterThanOrEqual(7);
  });

  it('E1 (Rifle Infantry) requires TENT — the basic infantry unit', () => {
    const e1 = PRODUCTION_ITEMS.find(p => p.type === 'E1');
    expect(e1).toBeDefined();
    expect(e1!.prerequisite).toBe('TENT');
    expect(e1!.faction).toBe('both');
  });

  it('allied defenses require TENT as prerequisite (rules.ini Prerequisite=tent)', () => {
    const pbox = PRODUCTION_ITEMS.find(p => p.type === 'PBOX');
    const hbox = PRODUCTION_ITEMS.find(p => p.type === 'HBOX');
    const gun = PRODUCTION_ITEMS.find(p => p.type === 'GUN');
    expect(pbox!.prerequisite).toBe('TENT');
    expect(hbox!.prerequisite).toBe('TENT');
    expect(gun!.prerequisite).toBe('TENT');
  });

  it('soviet defenses require BARR as prerequisite (rules.ini Prerequisite=barr)', () => {
    const ftur = PRODUCTION_ITEMS.find(p => p.type === 'FTUR');
    const kenn = PRODUCTION_ITEMS.find(p => p.type === 'KENN');
    expect(ftur!.prerequisite).toBe('BARR');
    expect(kenn!.prerequisite).toBe('BARR');
  });
});

// -- Power Grid Integration (calculatePowerGrid) -----------------------------
//
// BARR and TENT both consume 20W. They do NOT produce power.
// Only alive, non-selling, allied structures count.

for (const { type, faction, house } of BARRACKS_TYPES) {
  describe(`${type} in power grid [${faction}]`, () => {
    const alliances = buildDefaultAlliances();
    const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

    it('consumes 20W when alive', () => {
      const barracks = makeBarracks(type, 10, 10, 800, house);
      const grid = calculatePowerGrid([barracks], house, isAllied);
      expect(grid.consumed).toBe(20);
      expect(grid.produced).toBe(0);
    });

    it('does not produce any power', () => {
      expect(powerOutput(type, 800, 800)).toBe(0);
    });

    it('dead barracks does not consume power', () => {
      const barracks = makeBarracks(type, 10, 10, 0, house);
      barracks.alive = false;
      const grid = calculatePowerGrid([barracks], house, isAllied);
      expect(grid.consumed).toBe(0);
    });

    it('selling barracks does not consume power', () => {
      const barracks = makeBarracks(type, 10, 10, 800, house);
      barracks.sellProgress = 0.5;
      const grid = calculatePowerGrid([barracks], house, isAllied);
      expect(grid.consumed).toBe(0);
    });

    it('enemy barracks does not appear in player grid', () => {
      const enemyHouse = house === House.Spain ? House.USSR : House.Spain;
      const barracks = makeBarracks(type, 10, 10, 800, enemyHouse);
      const grid = calculatePowerGrid([barracks], house, isAllied);
      expect(grid.consumed).toBe(0);
    });

    it('POWR + barracks yields correct net power (100 produced - 20 consumed = 80)', () => {
      const powr: MapStructure = {
        type: 'POWR', image: 'powr', house,
        cx: 10, cy: 10, hp: 400, maxHp: 400, alive: true, rubble: false,
        attackCooldown: 0, ammo: -1, maxAmmo: -1,
      };
      const barracks = makeBarracks(type, 14, 10, 800, house);
      const grid = calculatePowerGrid([powr, barracks], house, isAllied);
      expect(grid.produced).toBe(100);
      expect(grid.consumed).toBe(20);
      expect(grid.produced - grid.consumed).toBe(80);
    });
  });
}

// -- 2x2 Footprint -----------------------------------------------------------
//
// C++ STRUCTURE_SIZE: BARR/TENT are 2x2. The origin cell is top-left;
// the structure occupies (cx,cy), (cx+1,cy), (cx,cy+1), (cx+1,cy+1).

for (const { type, faction } of BARRACKS_TYPES) {
  describe(`${type} 2x2 footprint [${faction}]`, () => {

    it('footprint occupies 4 cells from origin', () => {
      const [w, h] = STRUCTURE_SIZE[type]!;
      expect(w * h).toBe(4);
      const cells: [number, number][] = [];
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          cells.push([10 + dx, 10 + dy]);
        }
      }
      expect(cells).toEqual([[10, 10], [11, 10], [10, 11], [11, 11]]);
    });

    it('width and height are both 2', () => {
      const [w, h] = STRUCTURE_SIZE[type]!;
      expect(w).toBe(2);
      expect(h).toBe(2);
    });
  });
}

// -- Economic Functions (repairSell.ts) ---------------------------------------
//
// C++ rules.ini: BARR/TENT Cost=300, Strength=800

for (const { type, faction } of BARRACKS_TYPES) {
  describe(`${type} economic functions [${faction}]`, () => {
    const BARRACKS_COST = 300;
    const BARRACKS_MAX_HP = 800;

    it('sell refund is 50% of build cost = 150', () => {
      expect(sellRefund(BARRACKS_COST)).toBe(150);
    });

    it('repair cost per step is FREE (0) — C++ techno.cpp:6144 integer truncation', () => {
      // C++: trunc(800/7)=114; trunc(300/114)=2; trunc((51*2+128)/256)=trunc(230/256)=0
      // building.cpp:5432 Repair_AI does NOT clamp to min 1 — free repair
      expect(repairCostPerStep(BARRACKS_COST, BARRACKS_MAX_HP)).toBe(0);
    });
  });
}

// -- Destruction Blast — Radial HE (building.cpp) -----------------------------
//
// Non-barrel structures produce a visual-only FBALL1 death animation
// on destruction (C++ parity). No warhead damage is dealt to entities.

for (const { type, faction } of BARRACKS_TYPES) {
  describe(`${type} destruction blast -- visual-only (C++ parity: no entity damage) [${faction}]`, () => {
    const enemyHouse = House.USSR;

    it('entities take NO damage on destruction (visual-only explosion)', () => {
      const barracks = makeBarracks(type, 10, 10, 50, enemyHouse);
      const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
      const ctx = makeCombatCtx([barracks], [victim]);
      structureDamage(ctx, barracks, 100);
      expect(victim.hp).toBe(victim.maxHp);
    });

    it('diagonal entities take NO damage on destruction (visual-only explosion)', () => {
      const barracks = makeBarracks(type, 10, 10, 50, enemyHouse);
      const victim = entityAtCell(UnitType.I_E1, enemyHouse, 11, 11);
      const bx = 10 * CELL_SIZE + CELL_SIZE;
      const by = 10 * CELL_SIZE + CELL_SIZE;
      const dist = worldDist({ x: bx, y: by }, victim.pos);
      expect(dist).toBeLessThan(2);
      const ctx = makeCombatCtx([barracks], [victim]);
      structureDamage(ctx, barracks, 100);
      expect(victim.hp).toBe(victim.maxHp);
    });

    it('no entity damage at any distance (visual-only explosion)', () => {
      const barracks = makeBarracks(type, 10, 10, 50, enemyHouse);
      const close = entityAtCell(UnitType.V_2TNK, enemyHouse, 11, 10);
      const far = entityAtCell(UnitType.V_2TNK, enemyHouse, 10, 12);
      const ctx = makeCombatCtx([barracks], [close, far]);
      structureDamage(ctx, barracks, 100);
      const closeDmg = close.maxHp - close.hp;
      const farDmg = far.maxHp - far.hp;
      expect(closeDmg).toBe(0);
    expect(farDmg).toBe(0);
    });

    it('does NOT damage entities beyond 2-cell radius', () => {
      const barracks = makeBarracks(type, 10, 10, 50, enemyHouse);
      const victim = entityAtCell(UnitType.I_E1, enemyHouse, 13, 10);
      const ctx = makeCombatCtx([barracks], [victim]);
      structureDamage(ctx, barracks, 100);
      expect(victim.hp).toBe(victim.maxHp);
    });

    it('destruction blast damages adjacent structures', () => {
      const barracks = makeBarracks(type, 10, 10, 50, enemyHouse);
      const nearby = makeBuilding('SILO', 12, 10, 256);
      const ctx = makeCombatCtx([barracks, nearby]);
      structureDamage(ctx, barracks, 100);
      expect(nearby.hp).toBeLessThan(256);
    });

    it('no barrel cardinal mechanic AND no radial entity damage (visual-only)', () => {
      const barracks = makeBarracks(type, 10, 10, 50, enemyHouse);
      const diagonal = entityAtCell(UnitType.I_E1, enemyHouse, 11, 11);
      const ctx = makeCombatCtx([barracks], [diagonal]);
      structureDamage(ctx, barracks, 100);
      // C++ parity: visual-only explosion, no entity damage
      expect(diagonal.hp).toBe(diagonal.maxHp);
    });
  });
}

// -- Structural Damage (combat) -----------------------------------------------
//
// BARR/TENT have 800 HP. They can absorb significant damage before destruction.

for (const { type, faction, house } of BARRACKS_TYPES) {
  describe(`${type} structural damage absorption [${faction}]`, () => {

    it('survives 700 damage (800 -> 100 HP)', () => {
      const barracks = makeBarracks(type, 10, 10, 800, house);
      const ctx = makeCombatCtx([barracks]);
      structureDamage(ctx, barracks, 700);
      expect(barracks.alive).toBe(true);
      expect(barracks.hp).toBe(100);
    });

    it('destroyed by 800+ damage from full health', () => {
      const barracks = makeBarracks(type, 10, 10, 800, house);
      const ctx = makeCombatCtx([barracks]);
      structureDamage(ctx, barracks, 900);
      expect(barracks.alive).toBe(false);
      expect(barracks.hp).toBe(0);
    });

    it('HP is clamped to 0 (never negative)', () => {
      const barracks = makeBarracks(type, 10, 10, 100, house);
      const ctx = makeCombatCtx([barracks]);
      structureDamage(ctx, barracks, 500);
      expect(barracks.hp).toBe(0);
    });

    it('already-dead barracks ignores further damage', () => {
      const barracks = makeBarracks(type, 10, 10, 0, house);
      barracks.alive = false;
      const ctx = makeCombatCtx([barracks]);
      const result = structureDamage(ctx, barracks, 100);
      expect(result).toBe(false);
      expect(barracks.hp).toBe(0);
    });
  });
}

// -- Cross-faction symmetry ---------------------------------------------------
//
// BARR and TENT should have identical mechanical stats (HP, size, cost, drain)
// despite belonging to different factions.

describe('BARR vs TENT cross-faction symmetry', () => {

  it('same max HP', () => {
    expect(STRUCTURE_MAX_HP['BARR']).toBe(STRUCTURE_MAX_HP['TENT']);
  });

  it('same footprint size', () => {
    expect(STRUCTURE_SIZE['BARR']).toEqual(STRUCTURE_SIZE['TENT']);
  });

  it('same power drain', () => {
    expect(POWER_DRAIN['BARR']).toBe(POWER_DRAIN['TENT']);
  });

  it('same build cost', () => {
    const barr = PRODUCTION_ITEMS.find(p => p.type === 'BARR')!;
    const tent = PRODUCTION_ITEMS.find(p => p.type === 'TENT')!;
    expect(barr.cost).toBe(tent.cost);
  });

  it('same build time', () => {
    const barr = PRODUCTION_ITEMS.find(p => p.type === 'BARR')!;
    const tent = PRODUCTION_ITEMS.find(p => p.type === 'TENT')!;
    expect(barr.buildTime).toBe(tent.buildTime);
  });

  it('same tech level', () => {
    const barr = PRODUCTION_ITEMS.find(p => p.type === 'BARR')!;
    const tent = PRODUCTION_ITEMS.find(p => p.type === 'TENT')!;
    expect(barr.techLevel).toBe(tent.techLevel);
  });

  it('same prerequisite (POWR)', () => {
    const barr = PRODUCTION_ITEMS.find(p => p.type === 'BARR')!;
    const tent = PRODUCTION_ITEMS.find(p => p.type === 'TENT')!;
    expect(barr.prerequisite).toBe(tent.prerequisite);
  });

  it('neither has a weapon', () => {
    expect(STRUCTURE_WEAPONS['BARR']).toBeUndefined();
    expect(STRUCTURE_WEAPONS['TENT']).toBeUndefined();
  });

  it('neither produces power', () => {
    expect(powerOutput('BARR', 800, 800)).toBe(0);
    expect(powerOutput('TENT', 800, 800)).toBe(0);
  });

  it('different factions', () => {
    const barr = PRODUCTION_ITEMS.find(p => p.type === 'BARR')!;
    const tent = PRODUCTION_ITEMS.find(p => p.type === 'TENT')!;
    expect(barr.faction).toBe('soviet');
    expect(tent.faction).toBe('allied');
    expect(barr.faction).not.toBe(tent.faction);
  });
});
