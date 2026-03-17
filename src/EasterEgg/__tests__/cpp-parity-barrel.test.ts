/**
 * C++ Behavioral Parity: Barrel Explosions
 *
 * Tests verify barrel explosion behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens when a barrel explodes (observable
 * outcomes: HP changes, alive/dead, chain propagation), not HOW the
 * code implements it. The same scenarios should produce identical results
 * in C++ (building.cpp) and TypeScript (combat.ts).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, COUNTRY_BONUSES,
  buildDefaultAlliances, worldDist,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  structureDamage,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { MapStructure } from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeBarrel(cx: number, cy: number, hp = 1): MapStructure {
  return {
    type: 'BARL', image: 'barl', house: House.Neutral,
    cx, cy, hp, maxHp: hp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function makeBRL3(cx: number, cy: number, hp = 1): MapStructure {
  return {
    type: 'BRL3', image: 'brl3', house: House.Neutral,
    cx, cy, hp, maxHp: hp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function makeBuilding(type: string, cx: number, cy: number, hp: number): MapStructure {
  return {
    type, image: type.toLowerCase(), house: House.USSR,
    cx, cy, hp, maxHp: hp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

/** Place an entity at the center of a cell */
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

// ── Barrel Cardinal Fire-Bullets (building.cpp:1344-1369) ──────────────────────
//
// C++ spawns 4 invisible BULLET_INVISIBLE projectiles with WARHEAD_FIRE,
// 200 damage each, aimed at Adjacent_Cell in cardinal directions only (N/E/S/W).
// No distance falloff — flat 200 damage to anything in those 4 cells.

describe('Barrel cardinal fire-bullets (building.cpp:1344-1369)', () => {

  // ── Damage Pattern: Cardinal Cells ──

  describe('damages entities in cardinal cells', () => {
    it('North cell (cx, cy-1)', () => {
      const barrel = makeBarrel(10, 10);
      const victim = entityAtCell(UnitType.I_E1, House.USSR, 10, 9); // N
      const hpBefore = victim.hp;
      const ctx = makeCombatCtx([barrel], [victim]);
      structureDamage(ctx, barrel, 100);
      expect(victim.hp).toBeLessThan(hpBefore);
    });

    it('East cell (cx+1, cy)', () => {
      const barrel = makeBarrel(10, 10);
      const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 10); // E
      const hpBefore = victim.hp;
      const ctx = makeCombatCtx([barrel], [victim]);
      structureDamage(ctx, barrel, 100);
      expect(victim.hp).toBeLessThan(hpBefore);
    });

    it('South cell (cx, cy+1)', () => {
      const barrel = makeBarrel(10, 10);
      const victim = entityAtCell(UnitType.I_E1, House.USSR, 10, 11); // S
      const hpBefore = victim.hp;
      const ctx = makeCombatCtx([barrel], [victim]);
      structureDamage(ctx, barrel, 100);
      expect(victim.hp).toBeLessThan(hpBefore);
    });

    it('West cell (cx-1, cy)', () => {
      const barrel = makeBarrel(10, 10);
      const victim = entityAtCell(UnitType.I_E1, House.USSR, 9, 10); // W
      const hpBefore = victim.hp;
      const ctx = makeCombatCtx([barrel], [victim]);
      structureDamage(ctx, barrel, 100);
      expect(victim.hp).toBeLessThan(hpBefore);
    });

    it('all 4 cardinal entities are damaged simultaneously', () => {
      const barrel = makeBarrel(10, 10);
      const north = entityAtCell(UnitType.I_E1, House.USSR, 10, 9);
      const east  = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
      const south = entityAtCell(UnitType.I_E1, House.USSR, 10, 11);
      const west  = entityAtCell(UnitType.I_E1, House.USSR, 9, 10);
      const ctx = makeCombatCtx([barrel], [north, east, south, west]);
      structureDamage(ctx, barrel, 100);
      for (const v of [north, east, south, west]) {
        expect(v.hp, `entity at (${v.cell.cx},${v.cell.cy})`).toBeLessThan(v.maxHp);
      }
    });

    it('multiple entities sharing the same cardinal cell all take damage', () => {
      const barrel = makeBarrel(10, 10);
      const v1 = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
      const v2 = entityAtCell(UnitType.I_E2, House.USSR, 11, 10);
      const ctx = makeCombatCtx([barrel], [v1, v2]);
      structureDamage(ctx, barrel, 100);
      expect(v1.hp).toBeLessThan(v1.maxHp);
      expect(v2.hp).toBeLessThan(v2.maxHp);
    });
  });

  // ── Damage Pattern: Diagonal Immunity ──

  describe('does NOT damage entities in diagonal cells', () => {
    it('NE cell (cx+1, cy-1)', () => {
      const barrel = makeBarrel(10, 10);
      const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 9);
      const ctx = makeCombatCtx([barrel], [victim]);
      structureDamage(ctx, barrel, 100);
      expect(victim.hp).toBe(victim.maxHp);
    });

    it('SE cell (cx+1, cy+1)', () => {
      const barrel = makeBarrel(10, 10);
      const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
      const ctx = makeCombatCtx([barrel], [victim]);
      structureDamage(ctx, barrel, 100);
      expect(victim.hp).toBe(victim.maxHp);
    });

    it('SW cell (cx-1, cy+1)', () => {
      const barrel = makeBarrel(10, 10);
      const victim = entityAtCell(UnitType.I_E1, House.USSR, 9, 11);
      const ctx = makeCombatCtx([barrel], [victim]);
      structureDamage(ctx, barrel, 100);
      expect(victim.hp).toBe(victim.maxHp);
    });

    it('NW cell (cx-1, cy-1)', () => {
      const barrel = makeBarrel(10, 10);
      const victim = entityAtCell(UnitType.I_E1, House.USSR, 9, 9);
      const ctx = makeCombatCtx([barrel], [victim]);
      structureDamage(ctx, barrel, 100);
      expect(victim.hp).toBe(victim.maxHp);
    });
  });

  // ── Damage Pattern: Range Limit ──

  describe('does NOT damage entities beyond 1 cell (cardinal)', () => {
    it('2 cells North is out of range', () => {
      const barrel = makeBarrel(10, 10);
      const victim = entityAtCell(UnitType.I_E1, House.USSR, 10, 8);
      const ctx = makeCombatCtx([barrel], [victim]);
      structureDamage(ctx, barrel, 100);
      expect(victim.hp).toBe(victim.maxHp);
    });

    it('3 cells East is out of range', () => {
      const barrel = makeBarrel(10, 10);
      const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
      const ctx = makeCombatCtx([barrel], [victim]);
      structureDamage(ctx, barrel, 100);
      expect(victim.hp).toBe(victim.maxHp);
    });
  });

  // ── Warhead & Damage Amount ──

  describe('warhead and damage (WARHEAD_FIRE, 200 damage)', () => {
    it('deals exactly 200 base damage to structures in cardinal cells', () => {
      const barrel = makeBarrel(10, 10);
      // Use a 1x1 structure with high HP to measure exact damage
      const target = makeBarrel(11, 10, 500); // East, 500 HP
      const ctx = makeCombatCtx([barrel, target]);
      structureDamage(ctx, barrel, 100);
      // Should take exactly 200 damage (no falloff)
      expect(target.hp).toBe(300);
    });

    it('no distance falloff within cardinal cell (flat 200)', () => {
      const barrel = makeBarrel(10, 10);
      // Both structures are exactly 1 cell away (cardinal)
      const eastTarget = makeBarrel(11, 10, 500);
      const northTarget = makeBarrel(10, 9, 500);
      const ctx = makeCombatCtx([barrel, eastTarget, northTarget]);
      structureDamage(ctx, barrel, 100);
      // Both should take identical 200 damage (no falloff based on distance)
      expect(eastTarget.hp).toBe(300);
      expect(northTarget.hp).toBe(300);
    });

    it('BRL3 barrel type uses the same cardinal fire-bullet mechanic', () => {
      const barrel = makeBRL3(10, 10);
      const target = makeBarrel(11, 10, 500);
      const ctx = makeCombatCtx([barrel, target]);
      structureDamage(ctx, barrel, 100);
      expect(target.hp).toBe(300);
    });
  });

  // ── Chain Explosions ──

  describe('chain explosions along cardinal lines', () => {
    it('3 barrels in E-W line: all die', () => {
      const b1 = makeBarrel(10, 10);
      const b2 = makeBarrel(11, 10);
      const b3 = makeBarrel(12, 10);
      const ctx = makeCombatCtx([b1, b2, b3]);
      structureDamage(ctx, b1, 100);
      expect(b1.alive).toBe(false);
      expect(b2.alive).toBe(false);
      expect(b3.alive).toBe(false);
    });

    it('3 barrels in N-S line: all die', () => {
      const b1 = makeBarrel(10, 10);
      const b2 = makeBarrel(10, 11);
      const b3 = makeBarrel(10, 12);
      const ctx = makeCombatCtx([b1, b2, b3]);
      structureDamage(ctx, b1, 100);
      expect(b1.alive).toBe(false);
      expect(b2.alive).toBe(false);
      expect(b3.alive).toBe(false);
    });

    it('L-shaped barrel chain: all die (N then E)', () => {
      const b1 = makeBarrel(10, 10);
      const b2 = makeBarrel(10, 9);  // N of b1
      const b3 = makeBarrel(11, 9);  // E of b2
      const ctx = makeCombatCtx([b1, b2, b3]);
      structureDamage(ctx, b1, 100);
      expect(b1.alive).toBe(false);
      expect(b2.alive).toBe(false);
      expect(b3.alive).toBe(false);
    });

    it('2 barrels diagonally: do NOT chain', () => {
      const b1 = makeBarrel(10, 10);
      const b2 = makeBarrel(11, 11); // SE diagonal
      const ctx = makeCombatCtx([b1, b2]);
      structureDamage(ctx, b1, 100);
      expect(b1.alive).toBe(false);
      expect(b2.alive).toBe(true);
    });

    it('2 barrels 2+ cells apart on cardinal: do NOT chain', () => {
      const b1 = makeBarrel(10, 10);
      const b2 = makeBarrel(12, 10); // 2 cells E
      const ctx = makeCombatCtx([b1, b2]);
      structureDamage(ctx, b1, 100);
      expect(b1.alive).toBe(false);
      expect(b2.alive).toBe(true);
    });

    it('barrel chains to non-barrel structure (damages but may not destroy)', () => {
      const barrel = makeBarrel(10, 10);
      const building = makeBuilding('POWR', 11, 10, 256);
      const ctx = makeCombatCtx([barrel, building]);
      structureDamage(ctx, barrel, 100);
      expect(barrel.alive).toBe(false);
      expect(building.alive).toBe(true); // 256-200=56 HP survives
      expect(building.hp).toBe(56);
    });
  });
});

// ── Non-Barrel Structure Blast (regression) ────────────────────────────────────
//
// Non-barrel structures use a generic 2-cell radial HE blast with distance
// falloff on destruction. This should NOT change when barrel logic is modified.

describe('Non-barrel structure blast — radial HE (regression)', () => {
  it('damages entities in diagonal cells (within 2-cell radius)', () => {
    const building = makeBuilding('POWR', 10, 10, 50);
    // Entity at diagonal (11,11) — distance ~1.4 cells, within 2-cell radius
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    // Position at center of structure for distance calc
    const bx = 10 * CELL_SIZE + CELL_SIZE;
    const by = 10 * CELL_SIZE + CELL_SIZE;
    const dist = worldDist({ x: bx, y: by }, victim.pos);
    expect(dist).toBeLessThan(2); // confirm within blast radius
    const ctx = makeCombatCtx([building], [victim]);
    structureDamage(ctx, building, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('uses distance falloff (closer = more damage)', () => {
    // Two entities at different distances from a dying building
    const building = makeBuilding('POWR', 10, 10, 50);
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10); // ~0.5 cells
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 12);   // ~1.6 cells
    const ctx = makeCombatCtx([building], [close, far]);
    structureDamage(ctx, building, 100);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBeGreaterThan(farDmg);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const building = makeBuilding('POWR', 10, 10, 50);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10); // 3 cells E
    const ctx = makeCombatCtx([building], [victim]);
    structureDamage(ctx, building, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('non-barrel structures damage structures in radial blast (chain)', () => {
    const building = makeBuilding('POWR', 10, 10, 50);
    const nearby = makeBuilding('SILO', 11, 10, 256);
    const ctx = makeCombatCtx([building, nearby]);
    structureDamage(ctx, building, 100);
    expect(nearby.hp).toBeLessThan(256);
  });
});
