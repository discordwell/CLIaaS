/**
 * C++ Behavioral Parity: FCOM (Forward Command) & MISS (Mission Control)
 *
 * Tests verify FCOM and MISS behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * Both are scenario-only structures (not buildable by the player).
 * FCOM: 2x2, HP 400, no weapon, Power=-200 (drain), no power output.
 * MISS: 3x2, HP 400, no weapon, no power drain/output.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, POWER_DRAIN, COUNTRY_BONUSES,
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
  powerOutput, calculatePowerGrid,
} from '../engine/repairSell';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeStructure(
  type: string, cx: number, cy: number, hp: number, house: House = House.Spain,
): MapStructure {
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp, maxHp: STRUCTURE_MAX_HP[type] ?? hp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function makeFCOM(cx: number, cy: number, hp = 400, house: House = House.Spain): MapStructure {
  return makeStructure('FCOM', cx, cy, hp, house);
}

function makeMISS(cx: number, cy: number, hp = 400, house: House = House.Spain): MapStructure {
  return makeStructure('MISS', cx, cy, hp, house);
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

// =============================================================================
//  FCOM — Forward Command Post
// =============================================================================

describe('FCOM stats (rules.ini parity)', () => {

  it('max HP is 400', () => {
    expect(STRUCTURE_MAX_HP['FCOM']).toBe(400);
  });

  it('footprint is 2x2 cells', () => {
    expect(STRUCTURE_SIZE['FCOM']).toEqual([2, 2]);
  });

  it('has no weapon (scenario-only, no defensive capability)', () => {
    expect(STRUCTURE_WEAPONS['FCOM']).toBeUndefined();
  });

  it('drains 200 power (rules.ini [FCOM] Power=-200)', () => {
    expect(POWER_DRAIN['FCOM']).toBe(200);
  });

  it('is not a power producer', () => {
    expect(powerOutput('FCOM', 400, 400)).toBe(0);
  });

  it('appears as consumer in power grid calculations', () => {
    const alliances = buildDefaultAlliances();
    const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;
    const fcom = makeFCOM(10, 10, 400, House.Spain);
    const grid = calculatePowerGrid([fcom], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
    expect(grid.consumed).toBe(200);
  });
});

// -- FCOM 2x2 Footprint -------------------------------------------------------

describe('FCOM 2x2 footprint', () => {

  it('footprint occupies 4 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['FCOM']!;
    expect(w * h).toBe(4);
    const cells: [number, number][] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push([10 + dx, 10 + dy]);
      }
    }
    expect(cells).toEqual([[10, 10], [11, 10], [10, 11], [11, 11]]);
  });

  it('width equals 2 cells', () => {
    expect(STRUCTURE_SIZE['FCOM']![0]).toBe(2);
  });

  it('height equals 2 cells', () => {
    expect(STRUCTURE_SIZE['FCOM']![1]).toBe(2);
  });
});

// -- FCOM Destruction Blast — Radial HE (non-barrel) --------------------------
//
// Non-barrel structures use a generic 2-cell radial HE blast with distance
// falloff on destruction. FCOM has no barrel.

describe('FCOM destruction blast -- visual-only (C++ parity: no entity damage)', () => {

  it('entities take NO damage on destruction (visual-only explosion)', () => {
    const fcom = makeFCOM(10, 10, 50, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([fcom], [victim]);
    structureDamage(ctx, fcom, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('diagonal entities take NO damage on destruction (visual-only explosion)', () => {
    const fcom = makeFCOM(10, 10, 50, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const bx = 10 * CELL_SIZE + CELL_SIZE;
    const by = 10 * CELL_SIZE + CELL_SIZE;
    const dist = worldDist({ x: bx, y: by }, victim.pos);
    expect(dist).toBeLessThan(2);
    const ctx = makeCombatCtx([fcom], [victim]);
    structureDamage(ctx, fcom, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('no entity damage at any distance (visual-only explosion)', () => {
    const fcom = makeFCOM(10, 10, 50, House.USSR);
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 12);
    const ctx = makeCombatCtx([fcom], [close, far]);
    structureDamage(ctx, fcom, 100);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBe(0);
    expect(farDmg).toBe(0);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const fcom = makeFCOM(10, 10, 50, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10); // 3 cells E
    const ctx = makeCombatCtx([fcom], [victim]);
    structureDamage(ctx, fcom, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('destruction blast damages adjacent structures', () => {
    const fcom = makeFCOM(10, 10, 50, House.USSR);
    const nearby = makeStructure('SILO', 12, 10, 256, House.USSR);
    const ctx = makeCombatCtx([fcom, nearby]);
    structureDamage(ctx, fcom, 100);
    expect(nearby.hp).toBeLessThan(256);
  });

  it('no barrel cardinal mechanic AND no radial entity damage (visual-only)', () => {
    const fcom = makeFCOM(10, 10, 50, House.USSR);
    const diagonal = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([fcom], [diagonal]);
    structureDamage(ctx, fcom, 100);
    // C++ parity: visual-only explosion, no entity damage
    expect(diagonal.hp).toBe(diagonal.maxHp);
  });
});

// -- FCOM Damage Behavior -----------------------------------------------------
//
// FCOM has no power output to degrade, but HP tracking and alive/rubble
// state transitions should work identically to any other structure.

describe('FCOM damage and destruction behavior', () => {

  it('starts alive and not rubble at full HP', () => {
    const fcom = makeFCOM(10, 10, 400);
    expect(fcom.alive).toBe(true);
    expect(fcom.rubble).toBe(false);
    expect(fcom.hp).toBe(400);
  });

  it('survives partial damage', () => {
    const fcom = makeFCOM(10, 10, 400, House.USSR);
    const ctx = makeCombatCtx([fcom]);
    structureDamage(ctx, fcom, 100);
    expect(fcom.alive).toBe(true);
    expect(fcom.hp).toBeLessThan(400);
    expect(fcom.hp).toBeGreaterThan(0);
  });

  it('is destroyed when damage exceeds remaining HP', () => {
    const fcom = makeFCOM(10, 10, 50, House.USSR);
    const ctx = makeCombatCtx([fcom]);
    structureDamage(ctx, fcom, 200);
    expect(fcom.alive).toBe(false);
  });
});

// =============================================================================
//  MISS — Mission Control Center
// =============================================================================

describe('MISS stats (rules.ini parity)', () => {

  it('max HP is 400', () => {
    expect(STRUCTURE_MAX_HP['MISS']).toBe(400);
  });

  it('footprint is 3x2 cells', () => {
    expect(STRUCTURE_SIZE['MISS']).toEqual([3, 2]);
  });

  it('has no weapon (scenario-only, no defensive capability)', () => {
    expect(STRUCTURE_WEAPONS['MISS']).toBeUndefined();
  });

  it('is not a power consumer (no entry in POWER_DRAIN)', () => {
    expect(POWER_DRAIN['MISS']).toBeUndefined();
  });

  it('is not a power producer', () => {
    expect(powerOutput('MISS', 400, 400)).toBe(0);
  });

  it('does not appear in power grid calculations', () => {
    const alliances = buildDefaultAlliances();
    const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;
    const miss = makeMISS(10, 10, 400, House.Spain);
    const grid = calculatePowerGrid([miss], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
    expect(grid.consumed).toBe(0);
  });
});

// -- MISS 3x2 Footprint -------------------------------------------------------

describe('MISS 3x2 footprint', () => {

  it('footprint occupies 6 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['MISS']!;
    expect(w * h).toBe(6);
    const cells: [number, number][] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push([10 + dx, 10 + dy]);
      }
    }
    // 3 wide x 2 tall from (10,10)
    expect(cells).toEqual([
      [10, 10], [11, 10], [12, 10],
      [10, 11], [11, 11], [12, 11],
    ]);
  });

  it('width equals 3 cells', () => {
    expect(STRUCTURE_SIZE['MISS']![0]).toBe(3);
  });

  it('height equals 2 cells', () => {
    expect(STRUCTURE_SIZE['MISS']![1]).toBe(2);
  });
});

// -- MISS Destruction Blast — Radial HE (non-barrel) --------------------------
//
// Same radial HE blast as FCOM and POWR. MISS has no barrel.

describe('MISS destruction blast -- visual-only (C++ parity: no entity damage)', () => {

  it('entities take NO damage on destruction (visual-only explosion)', () => {
    const miss = makeMISS(10, 10, 50, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([miss], [victim]);
    structureDamage(ctx, miss, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('diagonal entities take NO damage on destruction (visual-only explosion)', () => {
    const miss = makeMISS(10, 10, 50, House.USSR);
    // For 3x2 building, center is at (11.5, 11) in cell coords
    // Entity at (12,11) is within the footprint / adjacent
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([miss], [victim]);
    structureDamage(ctx, miss, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('no entity damage at any distance (visual-only explosion)', () => {
    const miss = makeMISS(10, 10, 50, House.USSR);
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 12);
    const ctx = makeCombatCtx([miss], [close, far]);
    structureDamage(ctx, miss, 100);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBe(0);
    expect(farDmg).toBe(0);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const miss = makeMISS(10, 10, 50, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 14, 10); // 4 cells E (beyond 3-wide + 2-cell blast)
    const ctx = makeCombatCtx([miss], [victim]);
    structureDamage(ctx, miss, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('destruction blast damages adjacent structures', () => {
    const miss = makeMISS(10, 10, 50, House.USSR);
    // Place SILO at (12, 10) — overlapping the 3x2 footprint's east edge
    const nearby = makeStructure('SILO', 12, 10, 256, House.USSR);
    const ctx = makeCombatCtx([miss, nearby]);
    structureDamage(ctx, miss, 100);
    expect(nearby.hp).toBeLessThan(256);
  });

  it('no barrel cardinal mechanic AND no radial entity damage (visual-only)', () => {
    const miss = makeMISS(10, 10, 50, House.USSR);
    const diagonal = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([miss], [diagonal]);
    structureDamage(ctx, miss, 100);
    // C++ parity: visual-only explosion, no entity damage
    expect(diagonal.hp).toBe(diagonal.maxHp);
  });
});

// -- MISS Damage Behavior -----------------------------------------------------

describe('MISS damage and destruction behavior', () => {

  it('starts alive and not rubble at full HP', () => {
    const miss = makeMISS(10, 10, 400);
    expect(miss.alive).toBe(true);
    expect(miss.rubble).toBe(false);
    expect(miss.hp).toBe(400);
  });

  it('survives partial damage', () => {
    const miss = makeMISS(10, 10, 400, House.USSR);
    const ctx = makeCombatCtx([miss]);
    structureDamage(ctx, miss, 100);
    expect(miss.alive).toBe(true);
    expect(miss.hp).toBeLessThan(400);
    expect(miss.hp).toBeGreaterThan(0);
  });

  it('is destroyed when damage exceeds remaining HP', () => {
    const miss = makeMISS(10, 10, 50, House.USSR);
    const ctx = makeCombatCtx([miss]);
    structureDamage(ctx, miss, 200);
    expect(miss.alive).toBe(false);
  });
});

// -- Cross-structure: FCOM vs MISS comparison ---------------------------------
//
// Both are scenario-only, HP 400, no weapon, no power. The ONLY difference
// is the footprint: FCOM is 2x2, MISS is 3x2.

describe('FCOM vs MISS: same HP, different footprint', () => {

  it('both have identical max HP (400)', () => {
    expect(STRUCTURE_MAX_HP['FCOM']).toBe(STRUCTURE_MAX_HP['MISS']);
    expect(STRUCTURE_MAX_HP['FCOM']).toBe(400);
  });

  it('both lack weapons', () => {
    expect(STRUCTURE_WEAPONS['FCOM']).toBeUndefined();
    expect(STRUCTURE_WEAPONS['MISS']).toBeUndefined();
  });

  it('FCOM drains 200, MISS has no drain', () => {
    expect(POWER_DRAIN['FCOM']).toBe(200);
    expect(POWER_DRAIN['MISS']).toBeUndefined();
  });

  it('both produce 0 power', () => {
    expect(powerOutput('FCOM', 400, 400)).toBe(0);
    expect(powerOutput('MISS', 400, 400)).toBe(0);
  });

  it('FCOM is 2x2 (4 cells), MISS is 3x2 (6 cells)', () => {
    const [fw, fh] = STRUCTURE_SIZE['FCOM']!;
    const [mw, mh] = STRUCTURE_SIZE['MISS']!;
    expect(fw * fh).toBe(4);
    expect(mw * mh).toBe(6);
    expect(fw).toBe(2);
    expect(mw).toBe(3);
    expect(fh).toBe(mh); // same height
  });
});
