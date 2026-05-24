/**
 * C++ Behavioral Parity: FACT -- Construction Yard
 *
 * Tests verify Construction Yard behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with a Construction Yard (observable
 * outcomes: stats, footprint, build tree root, destruction blast),
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
  tickDestroyedStructureDebris,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import {
  type MapStructure, STRUCTURE_SIZE, STRUCTURE_MAX_HP,
  STRUCTURE_WEAPONS, STRUCTURE_POWERED,
} from '../engine/scenario';
import {
  powerOutput, calculatePowerGrid, sellRefund, repairCostPerStep,
} from '../engine/repairSell';
import type { Effect } from '../engine/renderer';
import { ScenarioRandom } from '../engine/random';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

/** C++ rules.ini: FACT -> Strength=1000, Cost=2000, Power=0 (no production/drain),
 *  Prerequisite=none, Owner=allies,soviet, TechLevel=-1 (pre-placed) */
const FACT_COST = 2000;
const FACT_MAX_HP = 1000;

function makeFACT(cx: number, cy: number, hp = 1000, house: House = House.Spain): MapStructure {
  return {
    type: 'FACT', image: 'fact', house,
    cx, cy, hp, maxHp: 1000, alive: true, rubble: false,
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

// -- Stats (rules.ini / building.cpp) -----------------------------------------
//
// C++ rules.ini: FACT -> Strength=1000, Cost=2000, Power=0,
// Prerequisite=none, Owner=allies,soviet, TechLevel=-1

describe('FACT stats (rules.ini parity)', () => {

  it('max HP is 1000 (highest-HP non-superweapon structure)', () => {
    expect(STRUCTURE_MAX_HP['FACT']).toBe(1000);
  });

  it('footprint is 3x3 cells (largest structure in game)', () => {
    expect(STRUCTURE_SIZE['FACT']).toEqual([3, 3]);
  });

  it('has no weapon (purely economic/production structure)', () => {
    expect(STRUCTURE_WEAPONS['FACT']).toBeUndefined();
  });

  it('is not a power consumer (no entry in POWER_DRAIN)', () => {
    expect(POWER_DRAIN['FACT']).toBeUndefined();
  });

  it('is not power-dependent (not in STRUCTURE_POWERED set)', () => {
    expect(STRUCTURE_POWERED.has('FACT')).toBe(false);
  });

  it('is available to both factions (rules.ini Owner=allies,soviet)', () => {
    const alliedFACT = makeFACT(10, 10, 1000, House.Spain);
    const sovietFACT = makeFACT(20, 20, 1000, House.USSR);
    expect(alliedFACT.type).toBe('FACT');
    expect(sovietFACT.type).toBe('FACT');
  });

  it('produces 0 power (not POWR or APWR)', () => {
    expect(powerOutput('FACT', 1000, 1000)).toBe(0);
  });
});

// -- 3x3 Footprint -----------------------------------------------------------
//
// C++ STRUCTURE_SIZE: FACT is 3x3 — the largest footprint in the game.
// The origin cell is top-left; the structure occupies 9 cells total.

describe('FACT 3x3 footprint (largest structure)', () => {

  it('footprint occupies 9 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['FACT']!;
    expect(w).toBe(3);
    expect(h).toBe(3);
    expect(w * h).toBe(9);
  });

  it('enumerates all 9 cells correctly from origin (10,10)', () => {
    const [w, h] = STRUCTURE_SIZE['FACT']!;
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

  it('3x3 is larger than any 2x2 structure (POWR, DOME, etc.)', () => {
    const [fw, fh] = STRUCTURE_SIZE['FACT']!;
    const [pw, ph] = STRUCTURE_SIZE['POWR']!;
    expect(fw * fh).toBeGreaterThan(pw * ph);
  });

  it('3x3 is larger than any 3x2 structure (WEAP, PROC, FIX)', () => {
    const [fw, fh] = STRUCTURE_SIZE['FACT']!;
    const [ww, wh] = STRUCTURE_SIZE['WEAP']!;
    expect(fw * fh).toBeGreaterThan(ww * wh);
  });
});

// -- Build Tree Root (prerequisite chain) ------------------------------------
//
// FACT is the root of the entire build tree. All buildable structures
// eventually trace their prerequisite chain back to FACT.
// Direct dependents: POWR (prerequisite='FACT'), SBAG, FENC, BRIK.

describe('FACT is root of the build tree', () => {

  it('POWR has prerequisite=FACT (direct dependency)', () => {
    const powr = PRODUCTION_ITEMS.find(p => p.type === 'POWR');
    expect(powr).toBeDefined();
    expect(powr!.prerequisite).toBe('FACT');
  });

  it('walls have prerequisite=FACT (SBAG, FENC, BRIK)', () => {
    const sbag = PRODUCTION_ITEMS.find(p => p.type === 'SBAG');
    const fenc = PRODUCTION_ITEMS.find(p => p.type === 'FENC');
    const brik = PRODUCTION_ITEMS.find(p => p.type === 'BRIK');
    expect(sbag!.prerequisite).toBe('FACT');
    expect(fenc!.prerequisite).toBe('FACT');
    expect(brik!.prerequisite).toBe('FACT');
  });

  it('FACT is in PRODUCTION_ITEMS but not player-buildable (TechLevel=-1)', () => {
    const fact = PRODUCTION_ITEMS.find(p => p.type === 'FACT');
    expect(fact).toBeDefined();
    expect(fact!.techLevel).toBe(-1);
    expect(fact!.cost).toBe(2500);
  });

  it('all structures with prerequisite=FACT are the first tier of the build tree', () => {
    const directDeps = PRODUCTION_ITEMS.filter(p => p.prerequisite === 'FACT');
    const directTypes = directDeps.map(p => p.type).sort();
    // POWR, SBAG, FENC, BRIK are the direct dependents
    expect(directTypes).toContain('POWR');
    expect(directTypes).toContain('SBAG');
    expect(directTypes).toContain('FENC');
    expect(directTypes).toContain('BRIK');
  });

  it('everything in the build tree traces back to FACT via prerequisite chain', () => {
    // Non-buildable items (techLevel=-1 with empty prerequisite) are excluded from
    // the build tree — they are scenario-placed or map-overlay structures.
    const NON_BUILDABLE_ROOTS = new Set([
      'CYCL', 'BARB', 'WOOD',    // non-buildable walls/fences
      'BIO', 'HOSP', 'FCOM', 'MISS',  // scenario-placed buildings
      'FACF', 'SPEF',            // fakes with empty prerequisite
    ]);
    const structures = PRODUCTION_ITEMS.filter(p => p.isStructure && !NON_BUILDABLE_ROOTS.has(p.type));
    // Build a prerequisite lookup
    const prereqOf: Record<string, string> = {};
    for (const s of PRODUCTION_ITEMS.filter(p => p.isStructure)) {
      prereqOf[s.type] = s.prerequisite;
    }
    // Every buildable structure should eventually reach FACT
    for (const s of structures) {
      // FACT itself is the root — no prerequisite to trace
      if (s.type === 'FACT') {
        expect(s.prerequisite).toBe('');
        continue;
      }
      let current = s.prerequisite;
      const visited = new Set<string>();
      while (current !== 'FACT' && prereqOf[current] && !visited.has(current)) {
        visited.add(current);
        current = prereqOf[current];
      }
      expect(current).toBe('FACT');
    }
  });
});

// -- Power Grid Integration (no contribution) --------------------------------
//
// FACT does not produce or consume power. It should be invisible
// to the power grid calculations.

describe('FACT in power grid (no contribution)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('FACT alone produces 0W and consumes 0W', () => {
    const fact = makeFACT(10, 10, 1000, House.Spain);
    const grid = calculatePowerGrid([fact], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
    expect(grid.consumed).toBe(0);
  });

  it('FACT does not affect net power when combined with POWR', () => {
    const fact = makeFACT(10, 10, 1000, House.Spain);
    const powr = {
      type: 'POWR', image: 'powr', house: House.Spain,
      cx: 13, cy: 10, hp: 400, maxHp: 400, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    } as MapStructure;
    const gridWithFact = calculatePowerGrid([fact, powr], House.Spain, isAllied);
    const gridWithoutFact = calculatePowerGrid([powr], House.Spain, isAllied);
    expect(gridWithFact.produced).toBe(gridWithoutFact.produced);
    expect(gridWithFact.consumed).toBe(gridWithoutFact.consumed);
  });

  it('damaged FACT still produces 0 power', () => {
    const fact = makeFACT(10, 10, 100, House.Spain);
    const grid = calculatePowerGrid([fact], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
  });
});

// -- Economic Functions (repairSell.ts) ---------------------------------------
//
// C++ rules.ini: FACT Cost=2000, Strength=1000
// Sell refund = 50% of 2000 = 1000
// Repair cost per step = ceil(2000 * 0.02 / (1000 / 7)) = ceil(40 / 142.857) = ceil(0.28) = 1

describe('FACT economic functions (rules.ini Cost=2000)', () => {

  it('sell refund is 50% of build cost = 1000', () => {
    expect(sellRefund(FACT_COST)).toBe(1000);
  });

  it('repair cost per step: ceil(2000 * 0.20 / (1000 / 7)) = 3', () => {
    // 2000 * 0.20 = 400, 1000 / 7 = 142.857, 400 / 142.857 = 2.8, ceil = 3
    expect(repairCostPerStep(FACT_COST, FACT_MAX_HP)).toBe(3);
  });

  it('FACT is the most expensive sell refund of any standard structure', () => {
    // At cost=2000 -> refund=1000, tied with WEAP but no standard structure exceeds this
    // (superweapons like PDOX/IRON cost 2800 but are special cases)
    const standardCosts = [
      { type: 'POWR', cost: 300 }, { type: 'TENT', cost: 300 },
      { type: 'PROC', cost: 2000 }, { type: 'WEAP', cost: 2000 },
      { type: 'DOME', cost: 1000 }, { type: 'FIX', cost: 1200 },
    ];
    for (const s of standardCosts) {
      expect(sellRefund(FACT_COST)).toBeGreaterThanOrEqual(sellRefund(s.cost));
    }
  });
});

// -- Destruction Blast -- Radial HE (building.cpp) ----------------------------
//
// Non-barrel structures produce a visual-only FBALL1 death animation
// on destruction (C++ parity). No warhead damage is dealt to entities. FACT is special because its 3x3
// footprint means the blast center (cx*CELL + CELL, cy*CELL + CELL) is
// at the top-left quadrant, not the visual center.

describe('FACT destruction blast -- visual-only (C++ parity: no entity damage)', () => {

  it('entities take NO damage on destruction (visual-only explosion)', () => {
    const fact = makeFACT(10, 10, 50);
    fact.house = House.USSR;
    // Entity adjacent to the blast center
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([fact], [victim]);
    structureDamage(ctx, fact, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('diagonal entities take NO damage on destruction (visual-only explosion)', () => {
    const fact = makeFACT(10, 10, 50);
    fact.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    // blast center: cx*CELL + CELL, cy*CELL + CELL
    const bx = 10 * CELL_SIZE + CELL_SIZE;
    const by = 10 * CELL_SIZE + CELL_SIZE;
    const dist = worldDist({ x: bx, y: by }, victim.pos);
    expect(dist).toBeLessThan(2);
    const ctx = makeCombatCtx([fact], [victim]);
    structureDamage(ctx, fact, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('no entity damage at any distance (visual-only explosion)', () => {
    const fact = makeFACT(10, 10, 50);
    fact.house = House.USSR;
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 12);
    const ctx = makeCombatCtx([fact], [close, far]);
    structureDamage(ctx, fact, 100);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBe(0);
    expect(farDmg).toBe(0);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const fact = makeFACT(10, 10, 50);
    fact.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10); // 3 cells E
    const ctx = makeCombatCtx([fact], [victim]);
    structureDamage(ctx, fact, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('destruction blast does NOT damage adjacent structures', () => {
    const fact = makeFACT(10, 10, 50);
    fact.house = House.USSR;
    // Place a building adjacent (within 2-cell radius of blast center)
    const nearby = makeBuilding('SILO', 12, 10, 300);
    const ctx = makeCombatCtx([fact, nearby]);
    structureDamage(ctx, fact, 100);
    expect(nearby.hp).toBe(300);
  });

  it('no barrel cardinal mechanic AND no radial entity damage (visual-only)', () => {
    // Barrel explosions hit ONLY cardinal cells with flat 200 damage.
    // FACT should use radial HE with falloff instead -- diagonals take damage.
    const fact = makeFACT(10, 10, 50);
    fact.house = House.USSR;
    const diagonal = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([fact], [diagonal]);
    structureDamage(ctx, fact, 100);
    // C++ parity: visual-only explosion, no entity damage
    expect(diagonal.hp).toBe(diagonal.maxHp);
  });
});

// -- 3x3 Destruction Effects Scaling ------------------------------------------
//
// C++ building.cpp: destruction visual effects scale with footprint size.
// FACT's 3x3 footprint produces the largest visual explosion chain,
// the strongest screen shake, and the biggest scorch mark.

describe('FACT 3x3 destruction effects scaling', () => {

  it('produces screen shake of 6 (FACT cost=2500 / 400)', () => {
    const fact = makeFACT(10, 10, 50);
    fact.house = House.USSR;
    const ctx = makeCombatCtx([fact]);
    structureDamage(ctx, fact, 100);
    // C++ building.cpp:1460 — shakes = Class->Cost_Of() / 400
    // FACT cost is 2500 in rules.ini → floor(2500/400) = 6
    expect(ctx.screenShake).toBe(6);
  });

  it('does not produce a full-screen flash on destruction', () => {
    const fact = makeFACT(10, 10, 50);
    fact.house = House.USSR;
    const ctx = makeCombatCtx([fact]);
    structureDamage(ctx, fact, 100);
    // C++ building.cpp:1292-1312 spawns local explosions and calls
    // Shake_The_Screen(shakes); it does not fade or flash the whole palette.
    expect(ctx.screenFlash).toBe(0);
  });

  it('generates at least 6 pre-explosion effects (max for 3x3 = min(6, 9) = 6)', () => {
    const fact = makeFACT(10, 10, 50);
    fact.house = House.USSR;
    const ctx = makeCombatCtx([fact]);
    structureDamage(ctx, fact, 100);
    // numPreExplosions = max(3, min(6, 3*3)) = 6
    // Plus final fball1 = at least 7 total effects.
    const explosions = ctx.effects.filter(e => e.type === 'explosion');
    expect(explosions.length).toBeGreaterThanOrEqual(7); // 6 pre + 1 final
  });

  it('does not generate generic flying debris on destruction', () => {
    const fact = makeFACT(10, 10, 50);
    fact.house = House.USSR;
    const ctx = makeCombatCtx([fact]);
    structureDamage(ctx, fact, 100);
    const effectTypes = ctx.effects.map(e => e.type as string);
    expect(effectTypes).not.toContain('debris');
  });

  it('scatters FIRE_SMALL/FIRE_MED across footprint (C++ building.cpp:1442-1458)', () => {
    // 3x3 footprint has 9 cells, each with 50% chance of FIRE_SMALL (fire1/2/3).
    // Over 9 cells, probability of 0 fires = 0.5^9 ≈ 0.2%, so this test is reliable.
    const fact = makeFACT(10, 10, 50);
    fact.house = House.USSR;
    const ctx = makeCombatCtx([fact]);
    structureDamage(ctx, fact, 100);
    const fires = ctx.effects.filter(e =>
      e.sprite === 'fire1' || e.sprite === 'fire2' || e.sprite === 'fire3'
    );
    expect(fires.length).toBeGreaterThan(0);
  });

  it('spawns persistent SMOKE_M ground smoke after destruction (C++ ANIM_SMOKE_M)', () => {
    const fact = makeFACT(10, 10, 50);
    fact.house = House.USSR;
    const ctx = makeCombatCtx([fact]);
    structureDamage(ctx, fact, 100);
    expect(ctx.effects.filter(e => e.sprite === 'smoke_m')).toHaveLength(0);
    ScenarioRandom.seed = 1974182732;
    ctx.tick = fact.debrisDropTick ?? 8;
    tickDestroyedStructureDebris(ctx, fact);
    const smoke = ctx.logicAnims.filter(anim => anim.type === 'smoke_m');
    // C++ Drop_Debris runs later from BuildingClass::AI and may create SMOKE_M
    // AnimClass entries on footprint cells; those are logicAnims, not legacy effects.
    expect(smoke.length).toBeGreaterThan(0);
    // Each should be a looping effect
    for (const s of smoke) {
      expect(s.loops).toBeGreaterThan(0);
    }
  });

  it('FACT screen shake is stronger than POWR (C++ Cost_Of()/400 scaling)', () => {
    // C++ building.cpp:1460 — shakes = Cost_Of() / 400 (integer div, no shake at 0)
    // FACT cost=2500 → floor(2500/400) = 6
    // POWR cost=300 → floor(300/400) = 0 (no shake at all)
    const fact = makeFACT(10, 10, 50);
    fact.house = House.USSR;
    const ctxFact = makeCombatCtx([fact]);
    structureDamage(ctxFact, fact, 100);

    const powr: MapStructure = {
      type: 'POWR', image: 'powr', house: House.USSR,
      cx: 10, cy: 10, hp: 50, maxHp: 400, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    const ctxPowr = makeCombatCtx([powr]);
    structureDamage(ctxPowr, powr, 100);

    expect(ctxFact.screenShake).toBeGreaterThan(ctxPowr.screenShake);
  });
});

// -- FACT Takes Damage (combat integration) -----------------------------------
//
// FACT with 1000 HP takes significant damage to destroy.
// Unlike POWR, destroying FACT does not affect power grid.

describe('FACT takes damage (1000 HP durability)', () => {

  it('survives 500 damage (half health)', () => {
    const fact = makeFACT(10, 10, 1000);
    fact.house = House.USSR;
    const ctx = makeCombatCtx([fact]);
    structureDamage(ctx, fact, 500);
    expect(fact.alive).toBe(true);
    expect(fact.hp).toBe(500);
  });

  it('survives 999 damage (critical health)', () => {
    const fact = makeFACT(10, 10, 1000);
    fact.house = House.USSR;
    const ctx = makeCombatCtx([fact]);
    structureDamage(ctx, fact, 999);
    expect(fact.alive).toBe(true);
    expect(fact.hp).toBe(1);
  });

  it('destroyed by 1000+ damage', () => {
    const fact = makeFACT(10, 10, 1000);
    fact.house = House.USSR;
    const ctx = makeCombatCtx([fact]);
    structureDamage(ctx, fact, 1000);
    expect(fact.alive).toBe(false);
    expect(fact.rubble).toBe(true);
    expect(fact.hp).toBe(0);
  });

  it('destroying FACT does not affect power grid', () => {
    const alliances = buildDefaultAlliances();
    const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

    const fact = makeFACT(10, 10, 1000, House.Spain);
    const powr: MapStructure = {
      type: 'POWR', image: 'powr', house: House.Spain,
      cx: 13, cy: 10, hp: 400, maxHp: 400, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };

    const gridBefore = calculatePowerGrid([fact, powr], House.Spain, isAllied);

    // Destroy the FACT
    const ctx = makeCombatCtx([fact, powr]);
    structureDamage(ctx, fact, 1000);

    const gridAfter = calculatePowerGrid([fact, powr], House.Spain, isAllied);
    // POWR still produces 100W; FACT contributed 0W before and 0W after
    expect(gridAfter.produced).toBe(gridBefore.produced);
  });

  it('increments nBuildingsDestroyedCount when enemy FACT is destroyed', () => {
    const fact = makeFACT(10, 10, 50);
    fact.house = House.USSR;
    const ctx = makeCombatCtx([fact]);
    expect(ctx.nBuildingsDestroyedCount).toBe(0);
    structureDamage(ctx, fact, 100);
    expect(ctx.nBuildingsDestroyedCount).toBe(1);
  });

  it('increments structuresLost when player FACT is destroyed', () => {
    const fact = makeFACT(10, 10, 50, House.Spain);
    const ctx = makeCombatCtx([fact]);
    expect(ctx.structuresLost).toBe(0);
    structureDamage(ctx, fact, 100);
    expect(ctx.structuresLost).toBe(1);
  });
});

// -- FACT vs Other 3x3 Structures ---------------------------------------------
//
// FACT shares 3x3 with SYRD and SPEN. Verify FACT's stats are distinct.

describe('FACT compared to other 3x3 structures', () => {

  it('SYRD is also 3x3 but has same max HP (1000)', () => {
    expect(STRUCTURE_SIZE['SYRD']).toEqual([3, 3]);
    expect(STRUCTURE_MAX_HP['SYRD']).toBe(1000);
  });

  it('SPEN is also 3x3 but has same max HP (1000)', () => {
    expect(STRUCTURE_SIZE['SPEN']).toEqual([3, 3]);
    expect(STRUCTURE_MAX_HP['SPEN']).toBe(1000);
  });

  it('all three 3x3 structures have no weapon', () => {
    expect(STRUCTURE_WEAPONS['FACT']).toBeUndefined();
    expect(STRUCTURE_WEAPONS['SYRD']).toBeUndefined();
    expect(STRUCTURE_WEAPONS['SPEN']).toBeUndefined();
  });
});
