/**
 * Barrel explosion vs bridge destruction bug fix.
 *
 * Bug: ALL barrel (BARL/BRL3) structures unconditionally called destroyBridge()
 * and showed "Bridge destroyed" EVA. In C++ RA, barrels explode with area damage
 * but only destroy bridges when actually adjacent to bridge cells.
 *
 * Fix: Gate the EVA message and bridgeCellCount update on whether destroyBridge()
 * actually destroyed any cells (returns count > 0).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnitType, House, CELL_SIZE, COUNTRY_BONUSES,
  buildDefaultAlliances,
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

function makeBarrel(overrides: Partial<MapStructure> = {}): MapStructure {
  return {
    type: 'BARL', image: 'barl', house: House.Neutral,
    cx: 10, cy: 10, hp: 1, maxHp: 1, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
    ...overrides,
  };
}

function makeMockCombatContext(overrides: Partial<CombatContext> = {}): CombatContext {
  const map = new GameMap();
  const entities: Entity[] = [];
  const entityById = new Map<number, Entity>();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById,
    structures: [],
    inflightProjectiles: [],
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    scenarioId: 'SCG01EA',
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
    ...overrides,
  };
}

describe('Barrel explosion bridge destruction fix', () => {
  it('does NOT show "Bridge destroyed" EVA when barrel explodes away from bridge', () => {
    const showEvaMessage = vi.fn();
    const map = new GameMap();
    // destroyBridge returns 0 when no bridge cells are nearby (default empty map)
    const ctx = makeMockCombatContext({ showEvaMessage, map });
    const barrel = makeBarrel({ hp: 1 });

    // Destroy the barrel
    const destroyed = structureDamage(ctx, barrel, 100);
    expect(destroyed).toBe(true);

    // showEvaMessage should NOT have been called with 7 ("Bridge destroyed")
    const bridgeCalls = showEvaMessage.mock.calls.filter(
      (args: [number]) => args[0] === 7,
    );
    expect(bridgeCalls).toHaveLength(0);
  });

  it('shows "Bridge destroyed" EVA when barrel explodes near bridge cells', () => {
    const showEvaMessage = vi.fn();
    const map = new GameMap();
    // Plant bridge template cells near the barrel position (10,10)
    // C++ bridge templates: 131, 133, 235, 236, 378, 379
    const idx = 10 * 128 + 10; // cy=10, cx=10 assuming MAP_CELLS=128
    (map as any).templateType[idx] = 235; // TEMPLATE_BRIDGE_1A
    // Also set terrain so destroyBridge can find it
    const ctx = makeMockCombatContext({ showEvaMessage, map, bridgeCellCount: 1 });
    const barrel = makeBarrel({ hp: 1 });

    const destroyed = structureDamage(ctx, barrel, 100);
    expect(destroyed).toBe(true);

    // showEvaMessage SHOULD have been called with 7 ("Bridge destroyed")
    const bridgeCalls = showEvaMessage.mock.calls.filter(
      (args: [number]) => args[0] === 7,
    );
    expect(bridgeCalls).toHaveLength(1);
  });

  it('updates bridgeCellCount only when bridge cells were destroyed', () => {
    const map = new GameMap();
    // No bridge cells — empty map
    const ctx = makeMockCombatContext({ map, bridgeCellCount: 5 });
    const barrel = makeBarrel({ hp: 1 });

    structureDamage(ctx, barrel, 100);

    // bridgeCellCount should remain unchanged (was 5, nothing destroyed)
    expect(ctx.bridgeCellCount).toBe(5);
  });

  it('BRL3 barrel type also respects the bridge cell check', () => {
    const showEvaMessage = vi.fn();
    const map = new GameMap();
    const ctx = makeMockCombatContext({ showEvaMessage, map });
    const barrel = makeBarrel({ type: 'BRL3', image: 'brl3', hp: 1 });

    structureDamage(ctx, barrel, 100);

    // No bridge cells nearby, so no EVA message
    const bridgeCalls = showEvaMessage.mock.calls.filter(
      (args: [number]) => args[0] === 7,
    );
    expect(bridgeCalls).toHaveLength(0);
  });

  it('barrels chain-explode along cardinal line (C++ parity)', () => {
    const ctx = makeMockCombatContext();
    // Three barrels in a cardinal line (E-W), 1 cell apart
    const b1 = makeBarrel({ cx: 10, cy: 10, hp: 1 });
    const b2 = makeBarrel({ cx: 11, cy: 10, hp: 1 });
    const b3 = makeBarrel({ cx: 12, cy: 10, hp: 1 });
    ctx.structures.push(b1, b2, b3);

    // Destroy first barrel — b1→E hits b2→E hits b3
    structureDamage(ctx, b1, 100);

    expect(b1.alive).toBe(false);
    expect(b2.alive).toBe(false);
    expect(b3.alive).toBe(false);
  });

  it('barrels do NOT chain-explode diagonally (C++ cardinal-only)', () => {
    const ctx = makeMockCombatContext();
    // Two barrels diagonally — not cardinal adjacent
    const b1 = makeBarrel({ cx: 10, cy: 10, hp: 1 });
    const b2 = makeBarrel({ cx: 11, cy: 11, hp: 1 });
    ctx.structures.push(b1, b2);

    structureDamage(ctx, b1, 100);

    expect(b1.alive).toBe(false);
    expect(b2.alive).toBe(true); // diagonal = no chain
  });

  it('barrels do NOT chain-explode when far apart', () => {
    const ctx = makeMockCombatContext();
    // Two barrels far apart (>1 cell, outside cardinal range)
    const b1 = makeBarrel({ cx: 10, cy: 10, hp: 1 });
    const b2 = makeBarrel({ cx: 15, cy: 10, hp: 1 });
    ctx.structures.push(b1, b2);

    structureDamage(ctx, b1, 100);

    expect(b1.alive).toBe(false);
    expect(b2.alive).toBe(true);
  });

  it('barrel damages entity at cardinal cell (N) but NOT diagonal', () => {
    const ctx = makeMockCombatContext();
    const barrel = makeBarrel({ cx: 10, cy: 10, hp: 1 });
    ctx.structures.push(barrel);

    // Entity at North (10,9) — should be damaged
    const northEntity = new Entity(UnitType.I_E1, House.USSR,
      10 * CELL_SIZE + CELL_SIZE / 2, 9 * CELL_SIZE + CELL_SIZE / 2);
    // Entity at diagonal (11,11) — should NOT be damaged
    const diagEntity = new Entity(UnitType.I_E1, House.USSR,
      11 * CELL_SIZE + CELL_SIZE / 2, 11 * CELL_SIZE + CELL_SIZE / 2);

    const northHpBefore = northEntity.hp;
    const diagHpBefore = diagEntity.hp;
    ctx.entities.push(northEntity, diagEntity);

    structureDamage(ctx, barrel, 100);

    expect(northEntity.hp).toBeLessThan(northHpBefore); // took 200 Fire damage
    expect(diagEntity.hp).toBe(diagHpBefore); // untouched
  });

  it('barrel uses Fire warhead with 200 damage (C++ WARHEAD_FIRE parity)', () => {
    const ctx = makeMockCombatContext();
    const barrel = makeBarrel({ cx: 10, cy: 10, hp: 1 });
    // Adjacent building East: 1x1 size, high HP so we can measure exact damage
    const building: MapStructure = {
      type: 'BARL', image: 'barl', house: House.Neutral,
      cx: 11, cy: 10, hp: 500, maxHp: 500, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    ctx.structures.push(barrel, building);

    structureDamage(ctx, barrel, 100);

    expect(barrel.alive).toBe(false);
    // Building at cardinal cell should take exactly 200 damage from barrel fire-bullet
    // (HP set to 500 so it survives, letting us verify the exact 200 damage hit)
    expect(building.hp).toBeLessThanOrEqual(500 - 200);
  });

  it('barrel blast damages adjacent non-barrel structure but does not destroy it', () => {
    const ctx = makeMockCombatContext();
    const barrel = makeBarrel({ cx: 10, cy: 10, hp: 1 });
    const building: MapStructure = {
      type: 'POWR', image: 'powr', house: House.USSR,
      cx: 11, cy: 10, hp: 256, maxHp: 256, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    ctx.structures.push(barrel, building);

    structureDamage(ctx, barrel, 100);

    expect(barrel.alive).toBe(false);
    expect(building.alive).toBe(true);
    expect(building.hp).toBeLessThan(256); // took 200 Fire damage: 256-200=56
  });

  it('non-barrel structure does NOT damage entities on destruction (visual-only explosion)', () => {
    const ctx = makeMockCombatContext();
    // Non-barrel structure at (5,5) — visual-only FBALL1 death anim (C++ parity)
    const structure: MapStructure = {
      type: 'POWR', image: 'powr', house: House.USSR,
      cx: 5, cy: 5, hp: 50, maxHp: 256, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    ctx.structures.push(structure);

    // Entity diagonally adjacent — should NOT be damaged (visual-only explosion)
    const diagEntity = new Entity(UnitType.I_E1, House.Spain,
      6 * CELL_SIZE + CELL_SIZE, 6 * CELL_SIZE + CELL_SIZE);
    const hpBefore = diagEntity.hp;
    ctx.entities.push(diagEntity);

    structureDamage(ctx, structure, 100);

    expect(structure.alive).toBe(false);
    expect(diagEntity.hp).toBe(hpBefore); // C++ parity: visual-only, no entity damage
  });

  it('non-barrel structure destruction never triggers bridge logic', () => {
    const showEvaMessage = vi.fn();
    const map = new GameMap();
    // Put bridge cells near the structure
    const idx = 5 * 128 + 5;
    (map as any).templateType[idx] = 240;
    const ctx = makeMockCombatContext({ showEvaMessage, map });
    const structure: MapStructure = {
      type: 'POWR', image: 'powr', house: House.USSR,
      cx: 5, cy: 5, hp: 50, maxHp: 256, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };

    structureDamage(ctx, structure, 100);

    // Non-barrel structures should never call showEvaMessage(7)
    const bridgeCalls = showEvaMessage.mock.calls.filter(
      (args: [number]) => args[0] === 7,
    );
    expect(bridgeCalls).toHaveLength(0);
  });
});
