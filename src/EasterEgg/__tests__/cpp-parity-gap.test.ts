/**
 * C++ Behavioral Parity: GAP — Gap Generator
 *
 * Tests verify Gap Generator behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference.
 *
 * GAP Generator is an Allied 1x1 structure that shrouds an area of the map
 * from the enemy. On destruction, the jammed area is unjammed (GAP1 behavior).
 * It has no weapon, but the highest HP-to-size ratio of any 1x1 structure (1000 HP).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnitType, House, CELL_SIZE,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  structureDamage,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import {
  type MapStructure,
  STRUCTURE_SIZE, STRUCTURE_MAX_HP, STRUCTURE_WEAPONS, STRUCTURE_POWERED,
} from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeGAP(cx: number, cy: number, hp?: number, house: House = House.Greece): MapStructure {
  const maxHp = hp ?? STRUCTURE_MAX_HP['GAP'] ?? 1000;
  return {
    type: 'GAP', image: 'gap', house,
    cx, cy, hp: hp ?? maxHp, maxHp, alive: true, rubble: false,
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
    getFirepowerBias: () => 1.0,
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

// ── GAP Stats (rules.ini parity) ────────────────────────────────────────────

describe('GAP stats (rules.ini parity)', () => {

  it('HP is 1000 — the highest for any 1x1 structure', () => {
    expect(STRUCTURE_MAX_HP['GAP']).toBe(1000);
  });

  it('size is 1x1', () => {
    expect(STRUCTURE_SIZE['GAP']).toEqual([1, 1]);
  });

  it('has NO weapon — not in STRUCTURE_WEAPONS', () => {
    expect(STRUCTURE_WEAPONS['GAP']).toBeUndefined();
  });

  it('is a powered structure (IsPowered=true)', () => {
    expect(STRUCTURE_POWERED.has('GAP')).toBe(true);
  });

  it('1000 HP is the highest HP-to-size ratio of any 1x1 structure', () => {
    // Collect all 1x1 structure HP values
    const oneByOneTypes: string[] = [];
    for (const [type, [w, h]] of Object.entries(STRUCTURE_SIZE)) {
      if (w === 1 && h === 1) oneByOneTypes.push(type);
    }
    const gapHp = STRUCTURE_MAX_HP['GAP'] ?? 256;
    for (const type of oneByOneTypes) {
      const hp = STRUCTURE_MAX_HP[type] ?? 256;
      expect(hp, `${type} (${hp} HP) should not exceed GAP (${gapHp} HP)`).toBeLessThanOrEqual(gapHp);
    }
  });
});

// ── GAP1: Unjam on Destruction (building.cpp gap generator cleanup) ─────────

describe('GAP1 — unjam shroud on destruction (building.cpp)', () => {

  it('destroying GAP removes its entry from gapGeneratorCells', () => {
    const gap = makeGAP(20, 20, 50);
    const ctx = makeCombatCtx([gap]);
    // Set up gap generator entry at structure index 0
    const si = ctx.structures.indexOf(gap);
    ctx.gapGeneratorCells.set(si, { cx: 20, cy: 20, radius: 5 });
    expect(ctx.gapGeneratorCells.has(si)).toBe(true);

    structureDamage(ctx, gap, 100); // kill it (50 HP, 100 damage)

    expect(gap.alive).toBe(false);
    expect(ctx.gapGeneratorCells.has(si)).toBe(false);
  });

  it('destroying GAP calls map.unjamRadius with the stored cx, cy, radius', () => {
    const gap = makeGAP(20, 20, 50);
    const ctx = makeCombatCtx([gap]);
    const si = ctx.structures.indexOf(gap);
    ctx.gapGeneratorCells.set(si, { cx: 20, cy: 20, radius: 5 });

    const unjamSpy = vi.spyOn(ctx.map, 'unjamRadius');
    structureDamage(ctx, gap, 100);

    expect(unjamSpy).toHaveBeenCalledWith(20, 20, 5);
    unjamSpy.mockRestore();
  });

  it('destroying GAP actually unjams cells that were jammed', () => {
    const gap = makeGAP(20, 20, 50);
    const ctx = makeCombatCtx([gap]);
    const si = ctx.structures.indexOf(gap);
    const radius = 3;
    ctx.gapGeneratorCells.set(si, { cx: 20, cy: 20, radius });

    // Manually jam cells in the radius to simulate an active gap generator
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          ctx.map.jamCell(20 + dx, 20 + dy);
        }
      }
    }
    // Verify at least one cell is jammed
    expect(ctx.map.jammedCells.size).toBeGreaterThan(0);

    structureDamage(ctx, gap, 100);

    // All jammed cells should be unjammed
    expect(ctx.map.jammedCells.size).toBe(0);
  });

  it('GAP without gapGeneratorCells entry does NOT crash on destruction', () => {
    const gap = makeGAP(20, 20, 50);
    const ctx = makeCombatCtx([gap]);
    // No gapGeneratorCells entry for this GAP
    expect(ctx.gapGeneratorCells.size).toBe(0);

    // Should not throw
    expect(() => structureDamage(ctx, gap, 100)).not.toThrow();
    expect(gap.alive).toBe(false);
  });

  it('only the destroyed GAP\'s entry is removed — other GAPs stay', () => {
    const gap1 = makeGAP(20, 20, 50);
    const gap2 = makeGAP(30, 30, 1000);
    const ctx = makeCombatCtx([gap1, gap2]);

    const si1 = ctx.structures.indexOf(gap1);
    const si2 = ctx.structures.indexOf(gap2);
    ctx.gapGeneratorCells.set(si1, { cx: 20, cy: 20, radius: 5 });
    ctx.gapGeneratorCells.set(si2, { cx: 30, cy: 30, radius: 5 });

    structureDamage(ctx, gap1, 100); // destroy gap1

    expect(ctx.gapGeneratorCells.has(si1)).toBe(false);
    expect(ctx.gapGeneratorCells.has(si2)).toBe(true);
    expect(gap2.alive).toBe(true);
  });
});

// ── GAP Destruction Behavior ────────────────────────────────────────────────

describe('GAP destruction — non-barrel radial HE blast', () => {

  it('GAP uses non-barrel radial HE blast on destruction (not barrel cardinal mechanic)', () => {
    // GAP is NOT a barrel, so it should use the generic 2-cell radial HE blast
    const gap = makeGAP(10, 10, 50);
    // Place entity at diagonal — barrels don't damage diagonals, but radial HE does
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([gap], [victim]);
    structureDamage(ctx, gap, 100);

    // Radial HE should damage the diagonal entity (distance ~1.4, within 2-cell radius)
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('sets alive=false and rubble=true when destroyed', () => {
    const gap = makeGAP(10, 10, 50);
    const ctx = makeCombatCtx([gap]);
    structureDamage(ctx, gap, 100);
    expect(gap.alive).toBe(false);
    expect(gap.rubble).toBe(true);
  });

  it('does NOT die when damage is less than HP', () => {
    const gap = makeGAP(10, 10, 1000);
    const ctx = makeCombatCtx([gap]);
    structureDamage(ctx, gap, 500);
    expect(gap.alive).toBe(true);
    expect(gap.hp).toBe(500);
  });

  it('HP cannot go below 0', () => {
    const gap = makeGAP(10, 10, 50);
    const ctx = makeCombatCtx([gap]);
    structureDamage(ctx, gap, 200);
    expect(gap.hp).toBe(0);
    expect(gap.alive).toBe(false);
  });
});

// ── GAP High HP (tankiness validation) ──────────────────────────────────────

describe('GAP high HP — tank test', () => {

  it('survives 900 damage (1000 HP)', () => {
    const gap = makeGAP(10, 10);
    const ctx = makeCombatCtx([gap]);
    structureDamage(ctx, gap, 900);
    expect(gap.alive).toBe(true);
    expect(gap.hp).toBe(100);
  });

  it('dies to exactly 1000 damage', () => {
    const gap = makeGAP(10, 10);
    const ctx = makeCombatCtx([gap]);
    structureDamage(ctx, gap, 1000);
    expect(gap.alive).toBe(false);
    expect(gap.hp).toBe(0);
  });

  it('survives multiple hits that total less than 1000', () => {
    const gap = makeGAP(10, 10);
    const ctx = makeCombatCtx([gap]);
    structureDamage(ctx, gap, 300);
    expect(gap.alive).toBe(true);
    structureDamage(ctx, gap, 300);
    expect(gap.alive).toBe(true);
    structureDamage(ctx, gap, 300);
    expect(gap.alive).toBe(true);
    expect(gap.hp).toBe(100);
  });

  it('dies on the hit that crosses 0 HP threshold', () => {
    const gap = makeGAP(10, 10);
    const ctx = makeCombatCtx([gap]);
    structureDamage(ctx, gap, 999);
    expect(gap.alive).toBe(true);
    expect(gap.hp).toBe(1);
    structureDamage(ctx, gap, 1);
    expect(gap.alive).toBe(false);
    expect(gap.hp).toBe(0);
  });
});
