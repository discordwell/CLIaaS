/**
 * C++ Behavioral Parity: Bridge Destruction Mechanics
 *
 * Tests verify bridge destruction behavior matches C++ combat.cpp:257-270
 * and map.cpp:1791-1987 (Destroy_Bridge_At, Intact_Bridge_Count).
 *
 * C++ source references:
 *   combat.cpp:261-265 — bridge template check on impact cell
 *   combat.cpp:267 — only WARHEAD_AP or WARHEAD_HE can damage bridges
 *   combat.cpp:267 — damage chance: Random_Pick(1, BridgeStrength) < strength
 *   rules.cpp:267 — BridgeStrength defaults to 1000
 *   map.cpp:1791-1987 — Destroy_Bridge_At: two-phase destruction, occupant killing
 *   map.cpp:1797-1812 — Phase 1: intact (BRIDGE1/2) → half-destroyed (BRIDGE1H/2H)
 *   map.cpp:1814-1864 — Phase 2: half-destroyed → fully destroyed (BRIDGE1D/2D)
 *   map.cpp:1828-1829 — BridgeCount-- and IsBridgeChanged on full destruction
 *   map.cpp:1837-1861 — Kill all occupants on destroyed bridge cells
 *   map.cpp:1862 — Shake_The_Screen(3) on destruction
 *   map.cpp:2045-2073 — Intact_Bridge_Count: count cells with bridge template + TIcon==6
 *   cell.cpp:2828-2850 — Is_Bridge_Here: all bridge template variants
 *   cell.cpp:499 — building placement prohibited on bridge cells
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, MAP_CELLS,
  UNIT_STATS, buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  structureDamage,
  applySplashDamage,
} from '../engine/combat';
import { GameMap, Terrain } from '../engine/map';
import { type MapStructure, STRUCTURE_MAX_HP } from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── C++ Bridge Template IDs (defines.h TemplateType enum) ──────────────────
// These match the values used in map.ts:509-512
const TEMPLATE_BRIDGE1 = 131;   // intact horizontal bridge
const TEMPLATE_BRIDGE2 = 133;   // intact vertical bridge
const TEMPLATE_BRIDGE1H = 378;  // half-destroyed horizontal
const TEMPLATE_BRIDGE2H = 379;  // half-destroyed vertical
const TEMPLATE_BRIDGE_1A = 235; // multi-part bridge piece 1A
const TEMPLATE_BRIDGE_1B = 236; // multi-part bridge piece 1B
// Multi-part bridge variants (combat.cpp:261-265, map.cpp:1869)
const TEMPLATE_BRIDGE_2A = 238; // multi-part bridge piece 2A
const TEMPLATE_BRIDGE_2B = 239; // multi-part bridge piece 2B
const TEMPLATE_BRIDGE_3A = 241; // multi-part bridge piece 3A
const TEMPLATE_BRIDGE_3B = 242; // multi-part bridge piece 3B
// Destroyed variants (not in countBridgeCells set)
const TEMPLATE_BRIDGE1D = 380;  // fully destroyed horizontal
const TEMPLATE_BRIDGE2D = 381;  // fully destroyed vertical

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Set a cell's template type and icon (simulating bridge placement) */
function setBridgeTemplate(map: GameMap, cx: number, cy: number, tmplType: number, icon: number = 6): void {
  const idx = cy * MAP_CELLS + cx;
  map.templateType[idx] = tmplType;
  map.templateIcon[idx] = icon;
  // Bridge cells are passable (CLEAR terrain) when intact
  map.setTerrain(cx, cy, Terrain.CLEAR);
}

/** Create a barrel structure at a specific cell position */
function makeBarrel(cx: number, cy: number, type: 'BARL' | 'BRL3' = 'BARL'): MapStructure {
  return {
    type,
    image: type.toLowerCase(),
    house: House.Neutral,
    cx, cy,
    hp: STRUCTURE_MAX_HP[type] ?? 10,
    maxHp: STRUCTURE_MAX_HP[type] ?? 10,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
  };
}

/** Create a minimal CombatContext for testing */
function makeCombatCtx(entities: Entity[] = [], structures: MapStructure[] = []): CombatContext {
  const map = new GameMap();
  map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
    inflightProjectiles: [],
    effects: [] as Effect[],
    tick: 100,
    playerHouse: House.Spain,
    scenarioId: 'TEST',
    killCount: 0,
    lossCount: 0,
    pointTotal: 0,
    alliedUnitsLost: 0,
    sovietUnitsLost: 0,
    alliedBuildingsLost: 0,
    sovietBuildingsLost: 0,
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

// ── countBridgeCells (map.cpp:2045-2073 Intact_Bridge_Count) ────────────────

describe('countBridgeCells — C++ map.cpp:2045-2073 Intact_Bridge_Count', () => {

  it('counts cells with bridge templates and TIcon==6', () => {
    // C++ counts only TEMPLATE_BRIDGE1/1H/2/2H/1A/1B with TIcon==6
    const map = new GameMap();
    setBridgeTemplate(map, 10, 10, TEMPLATE_BRIDGE1, 6);
    setBridgeTemplate(map, 11, 10, TEMPLATE_BRIDGE1, 3); // wrong icon, not counted
    setBridgeTemplate(map, 12, 10, TEMPLATE_BRIDGE2, 6);
    setBridgeTemplate(map, 13, 10, TEMPLATE_BRIDGE_1A, 6);
    setBridgeTemplate(map, 14, 10, TEMPLATE_BRIDGE_1B, 6);
    setBridgeTemplate(map, 15, 10, TEMPLATE_BRIDGE1H, 6); // half-destroyed, still counted
    setBridgeTemplate(map, 16, 10, TEMPLATE_BRIDGE2H, 6);

    expect(map.countBridgeCells()).toBe(6);
  });

  it('does not count fully-destroyed bridge templates', () => {
    // C++ Intact_Bridge_Count does NOT include BRIDGE1D/2D (fully destroyed)
    const map = new GameMap();
    setBridgeTemplate(map, 10, 10, TEMPLATE_BRIDGE1D, 6);
    setBridgeTemplate(map, 11, 10, TEMPLATE_BRIDGE2D, 6);

    expect(map.countBridgeCells()).toBe(0);
  });

  it('returns 0 for empty map with no bridges', () => {
    const map = new GameMap();
    expect(map.countBridgeCells()).toBe(0);
  });

  it('does not count non-bridge templates even with icon==6', () => {
    // Random terrain templates should not be counted
    const map = new GameMap();
    setBridgeTemplate(map, 10, 10, 50, 6);  // some random template
    setBridgeTemplate(map, 11, 10, 100, 6); // another random template

    expect(map.countBridgeCells()).toBe(0);
  });

  it('half-destroyed bridges (BRIDGE1H/2H) are counted as intact', () => {
    // C++ Intact_Bridge_Count includes BRIDGE1H and BRIDGE2H — they are damaged but
    // still passable (units can walk over them). Only BRIDGE1D/2D are fully destroyed.
    const map = new GameMap();
    setBridgeTemplate(map, 10, 10, TEMPLATE_BRIDGE1H, 6);
    setBridgeTemplate(map, 11, 10, TEMPLATE_BRIDGE2H, 6);

    expect(map.countBridgeCells()).toBe(2);
  });
});

// ── destroyBridge (map.ts:524-542) ──────────────────────────────────────────

describe('destroyBridge — bridge cell destruction within radius', () => {

  it('converts half-destroyed bridge cells to water terrain (Phase 2)', () => {
    // C++ map.cpp:1814-1864 Phase 2: half-destroyed → fully destroyed (WATER).
    // Phase 1 converts intact → half-destroyed first.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1H, 6); // half-destroyed

    const destroyed = map.destroyBridge(20, 20, 3);

    expect(destroyed).toBeGreaterThan(0);
    expect(map.getTerrain(20, 20)).toBe(Terrain.WATER);
  });

  it('destroys all half-destroyed bridge cells within the specified radius', () => {
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    // Place a 5-cell bridge spanning horizontally (half-destroyed for Phase 2 test)
    for (let dx = -2; dx <= 2; dx++) {
      setBridgeTemplate(map, 20 + dx, 20, TEMPLATE_BRIDGE2H, 6);
    }

    // Radius 3 should cover all 5 cells
    const destroyed = map.destroyBridge(20, 20, 3);

    expect(destroyed).toBe(5);
    for (let dx = -2; dx <= 2; dx++) {
      expect(map.getTerrain(20 + dx, 20)).toBe(Terrain.WATER);
    }
  });

  it('does not destroy non-bridge cells', () => {
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    map.setTerrain(20, 20, Terrain.CLEAR);

    const destroyed = map.destroyBridge(20, 20, 3);

    expect(destroyed).toBe(0);
    expect(map.getTerrain(20, 20)).toBe(Terrain.CLEAR);
  });

  it('returns count of destroyed cells', () => {
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);
    setBridgeTemplate(map, 21, 20, TEMPLATE_BRIDGE1, 3);
    setBridgeTemplate(map, 22, 20, TEMPLATE_BRIDGE2, 0);

    const destroyed = map.destroyBridge(20, 20, 3);

    // All 3 are bridge templates regardless of icon — destroyBridge checks template type, not icon
    expect(destroyed).toBe(3);
  });

  it('bridge cells outside radius are unaffected', () => {
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);
    setBridgeTemplate(map, 30, 30, TEMPLATE_BRIDGE1, 6); // far away

    const destroyed = map.destroyBridge(20, 20, 3);

    expect(destroyed).toBe(1);
    // Far bridge should be untouched
    expect(map.getTerrain(30, 30)).toBe(Terrain.CLEAR);
    const farIdx = 30 * MAP_CELLS + 30;
    expect(map.templateType[farIdx]).toBe(TEMPLATE_BRIDGE1);
  });

  it('also destroys half-destroyed bridge templates', () => {
    // Both BRIDGE1H (378) and BRIDGE2H (379) should be destroyable
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1H, 6);
    setBridgeTemplate(map, 21, 20, TEMPLATE_BRIDGE2H, 6);

    const destroyed = map.destroyBridge(20, 20, 3);

    expect(destroyed).toBe(2);
    expect(map.getTerrain(20, 20)).toBe(Terrain.WATER);
    expect(map.getTerrain(21, 20)).toBe(Terrain.WATER);
  });

  it('destroys multi-part bridge variants 2A/2B/3A/3B (combat.cpp:263-264)', () => {
    // C++ combat.cpp:261-265 checks 10 bridge template types including BRIDGE_2A/2B/3A/3B.
    // C++ map.cpp:1869 — Destroy_Bridge_At covers TEMPLATE_BRIDGE_1A through TEMPLATE_BRIDGE_3E.
    // These 4 templates were previously missing from the TS bridge check.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE_2A, 6);
    setBridgeTemplate(map, 21, 20, TEMPLATE_BRIDGE_2B, 6);
    setBridgeTemplate(map, 22, 20, TEMPLATE_BRIDGE_3A, 6);
    setBridgeTemplate(map, 23, 20, TEMPLATE_BRIDGE_3B, 6);

    const destroyed = map.destroyBridge(20, 20, 4);

    expect(destroyed).toBe(4);
    expect(map.getTerrain(20, 20)).toBe(Terrain.WATER);
    expect(map.getTerrain(21, 20)).toBe(Terrain.WATER);
    expect(map.getTerrain(22, 20)).toBe(Terrain.WATER);
    expect(map.getTerrain(23, 20)).toBe(Terrain.WATER);
  });
});

// ── Passability after bridge destruction ────────────────────────────────────

describe('Bridge passability changes after destruction', () => {

  it('intact bridge cells are passable (CLEAR terrain)', () => {
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    expect(map.isPassable(20, 20)).toBe(true);
  });

  it('fully destroyed bridge cells become impassable water (two-phase)', () => {
    // C++ map.cpp:1831 Zone_Reset(MZONEF_ALL) — recalculates passability zones
    // after bridge destruction. Two-phase: intact → half-destroyed → water.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    // Phase 1: half-destroyed, still passable
    map.destroyBridge(20, 20, 3);
    expect(map.isPassable(20, 20)).toBe(true);

    // Phase 2: water, impassable
    map.destroyBridge(20, 20, 3);
    expect(map.isPassable(20, 20)).toBe(false);
    expect(map.getTerrain(20, 20)).toBe(Terrain.WATER);
  });

  it('fully destroyed bridge cells become navigable by naval units (two-phase)', () => {
    // C++ parity: destroyed bridge becomes water — naval units can pass through
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    // Before destruction: not water
    expect(map.isWaterPassable(20, 20)).toBe(false);

    // Two-phase destruction
    map.destroyBridge(20, 20, 3);
    map.destroyBridge(20, 20, 3);

    // After destruction: water
    expect(map.isWaterPassable(20, 20)).toBe(true);
  });
});

// ── Barrel explosion triggers bridge destruction ────────────────────────────

describe('Barrel explosion bridge destruction (structureDamage → destroyBridge)', () => {

  it('barrel (BARL) destruction destroys nearby half-destroyed bridge cells', () => {
    // C++ building.cpp barrel explosion chain → map.cpp Destroy_Bridge_At
    // TS: structureDamage for BARL/BRL3 calls map.destroyBridge(cx, cy, 3)
    // With two-phase, barrel on half-destroyed bridge → water (Phase 2).
    const barrel = makeBarrel(20, 20, 'BARL');
    const ctx = makeCombatCtx([], [barrel]);
    setBridgeTemplate(ctx.map, 21, 20, TEMPLATE_BRIDGE1H, 6); // half-destroyed
    setBridgeTemplate(ctx.map, 22, 20, TEMPLATE_BRIDGE1H, 6);
    ctx.bridgeCellCount = ctx.map.countBridgeCells();

    // Destroy barrel with damage > HP
    structureDamage(ctx, barrel, 100);

    expect(barrel.alive).toBe(false);
    expect(ctx.map.getTerrain(21, 20)).toBe(Terrain.WATER);
    expect(ctx.map.getTerrain(22, 20)).toBe(Terrain.WATER);
    expect(ctx.bridgeCellCount).toBe(0);
  });

  it('BRL3 barrel also triggers bridge destruction on half-destroyed bridges', () => {
    const barrel = makeBarrel(20, 20, 'BRL3');
    const ctx = makeCombatCtx([], [barrel]);
    setBridgeTemplate(ctx.map, 19, 20, TEMPLATE_BRIDGE2H, 6); // half-destroyed
    ctx.bridgeCellCount = ctx.map.countBridgeCells();

    structureDamage(ctx, barrel, 100);

    expect(barrel.alive).toBe(false);
    expect(ctx.map.getTerrain(19, 20)).toBe(Terrain.WATER);
    expect(ctx.bridgeCellCount).toBe(0);
  });

  it('EVA message 7 ("Bridge destroyed.") plays when bridge is destroyed by barrel', () => {
    const barrel = makeBarrel(20, 20, 'BARL');
    const ctx = makeCombatCtx([], [barrel]);
    setBridgeTemplate(ctx.map, 21, 20, TEMPLATE_BRIDGE1, 6);
    ctx.bridgeCellCount = ctx.map.countBridgeCells();

    const evaMessages: number[] = [];
    ctx.showEvaMessage = (id: number) => evaMessages.push(id);

    structureDamage(ctx, barrel, 100);

    expect(evaMessages).toContain(7);
  });

  it('no EVA message when barrel explodes but no bridge cells are nearby', () => {
    const barrel = makeBarrel(20, 20, 'BARL');
    const ctx = makeCombatCtx([], [barrel]);
    // No bridge cells placed

    const evaMessages: number[] = [];
    ctx.showEvaMessage = (id: number) => evaMessages.push(id);

    structureDamage(ctx, barrel, 100);

    expect(evaMessages).not.toContain(7);
  });

  it('bridgeCellCount is recalculated after barrel destroys half-destroyed bridge', () => {
    const barrel = makeBarrel(20, 20, 'BARL');
    const ctx = makeCombatCtx([], [barrel]);
    setBridgeTemplate(ctx.map, 21, 20, TEMPLATE_BRIDGE1H, 6); // half-destroyed
    setBridgeTemplate(ctx.map, 60, 60, TEMPLATE_BRIDGE2, 6); // far bridge, untouched
    ctx.bridgeCellCount = ctx.map.countBridgeCells();

    expect(ctx.bridgeCellCount).toBe(2);

    structureDamage(ctx, barrel, 100);

    // Near bridge fully destroyed (Phase 2), far one remains
    expect(ctx.bridgeCellCount).toBe(1);
  });
});

// ── Splash damage bridge destruction (combat.cpp:261-268) ──────────────────
// C++ combat.cpp:261-268 — Explosion_Damage checks for bridge templates at the
// impact cell and calls Destroy_Bridge_At if warhead is AP or HE and
// Random_Pick(1, BridgeStrength) < strength. This means ANY sufficiently
// powerful AP/HE explosion on a bridge cell can destroy the bridge.

describe('Splash damage bridge destruction (combat.cpp:261-268)', () => {

  it('AP/HE splash on bridge cell destroys bridge probabilistically', () => {
    // C++ combat.cpp:267 — Random_Pick(1, BridgeStrength=1000) < damage.
    // For damage=200 this is a ~20% chance per hit.
    // With 50 hits, probability of at least one success ≈ 1-(0.8^50) ≈ 99.998%.
    const ctx = makeCombatCtx();
    setBridgeTemplate(ctx.map, 20, 20, TEMPLATE_BRIDGE1, 6);
    ctx.bridgeCellCount = ctx.map.countBridgeCells();

    const impactPos = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };

    // Fire 50 HE explosions at the bridge cell — probabilistic, but almost certain to succeed
    for (let i = 0; i < 50; i++) {
      applySplashDamage(
        ctx,
        impactPos,
        { damage: 200, warhead: 'HE', splash: 1.5 },
        -1,
        House.Spain,
      );
    }

    // Bridge should be destroyed after 50 hits with ~20% chance each
    expect(ctx.map.getTerrain(20, 20)).toBe(Terrain.WATER);
  });

  it('AP/HE splash on multi-part bridge templates 2A/2B/3A/3B destroys bridge', () => {
    // C++ combat.cpp:261-265 checks BRIDGE_2A (238), BRIDGE_2B (239),
    // BRIDGE_3A (241), BRIDGE_3B (242) for splash damage bridge destruction.
    for (const tmpl of [TEMPLATE_BRIDGE_2A, TEMPLATE_BRIDGE_2B, TEMPLATE_BRIDGE_3A, TEMPLATE_BRIDGE_3B]) {
      const ctx = makeCombatCtx();
      setBridgeTemplate(ctx.map, 20, 20, tmpl, 6);
      ctx.bridgeCellCount = ctx.map.countBridgeCells();

      const impactPos = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };

      // Fire 50 HE explosions — probabilistic but nearly certain to succeed
      for (let i = 0; i < 50; i++) {
        applySplashDamage(ctx, impactPos, { damage: 200, warhead: 'HE', splash: 1.5 }, -1, House.Spain);
      }

      expect(ctx.map.getTerrain(20, 20), `template ${tmpl} should be destroyed`).toBe(Terrain.WATER);
    }
  });

  it('only AP and HE warheads can damage bridges, not SA/Fire/Super', () => {
    // C++ combat.cpp:267 explicitly checks: warhead == WARHEAD_AP || warhead == WARHEAD_HE
    // SA, Fire, and Super warheads cannot damage bridges.
    const ctx = makeCombatCtx();
    setBridgeTemplate(ctx.map, 20, 20, TEMPLATE_BRIDGE1, 6);

    const impactPos = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };

    // These warheads should NOT damage bridges
    for (const wh of ['SA', 'Fire', 'Super'] as const) {
      for (let i = 0; i < 20; i++) {
        applySplashDamage(ctx, impactPos, { damage: 500, warhead: wh, splash: 1.5 }, -1, House.Spain);
      }
    }

    const bridgeIdx = 20 * MAP_CELLS + 20;
    // Bridge remains intact — SA/Fire/Super cannot damage bridges
    expect(ctx.map.templateType[bridgeIdx]).toBe(TEMPLATE_BRIDGE1);
  });
});

// ── PARITY FIXED: Two-phase bridge destruction ──────────────────────────────
// C++ map.cpp:1797-1864 implements two-phase destruction:
//   Phase 1: BRIDGE1 → BRIDGE1H (intact → half-destroyed, still passable)
//   Phase 2: BRIDGE1H → BRIDGE1D (half-destroyed → fully destroyed, impassable)
// TS now implements two-phase destruction matching C++ behavior.

describe('PARITY FIXED: Two-phase bridge destruction (map.cpp:1797-1864)', () => {

  it('Phase 1: intact bridge becomes half-destroyed, not fully destroyed', () => {
    // PARITY FIXED — C++ map.cpp:1797-1812: first hit on intact bridge transitions to
    // half-destroyed (BRIDGE1H/BRIDGE2H). The bridge remains passable.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    map.destroyBridge(20, 20, 3);

    // PARITY FIXED: Phase 1 creates half-destroyed bridge, terrain stays CLEAR
    expect(map.templateType[20 * MAP_CELLS + 20]).toBe(TEMPLATE_BRIDGE1H);
    expect(map.getTerrain(20, 20)).toBe(Terrain.CLEAR); // still passable
  });

  it('C++ Phase 2: half-destroyed bridge should become fully destroyed', () => {
    // PARITY GAP — C++ requires a SECOND hit on BRIDGE1H/2H to destroy fully.
    // TS treats half-destroyed the same as intact — one destroyBridge call removes it.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1H, 6);

    const countBefore = map.countBridgeCells();
    expect(countBefore).toBe(1); // half-destroyed bridge still counts as intact

    map.destroyBridge(20, 20, 3);

    // TS correctly converts to water, matching C++ Phase 2 end result
    expect(map.getTerrain(20, 20)).toBe(Terrain.WATER);
    expect(map.countBridgeCells()).toBe(0);
  });
});

// ── Bridge destruction kills occupants (map.cpp:1837-1861) ─────────────────
// C++ map.cpp:1837-1861 — when a bridge is fully destroyed, ALL occupants
// (units on the bridge cells) are killed instantly with full-strength WARHEAD_HE
// damage. TS killBridgeOccupants implements this behavior.

describe('Bridge destruction kills occupants (map.cpp:1837-1861)', () => {

  it('barrel explosion on half-destroyed bridge kills all units standing on destroyed cells', () => {
    // C++ map.cpp:1843 — obj->Take_Damage(obj->Strength, 0, WARHEAD_HE, NULL, true)
    // Units on the bridge when it's fully destroyed are killed instantly.
    // Occupant killing only happens on Phase 2 (half-destroyed → WATER).
    const infantryOnBridge = new Entity(
      UnitType.I_E1, House.USSR,
      21 * CELL_SIZE + CELL_SIZE / 2,
      20 * CELL_SIZE + CELL_SIZE / 2,
    );
    const barrel = makeBarrel(20, 20, 'BARL');
    const ctx = makeCombatCtx([infantryOnBridge], [barrel]);
    setBridgeTemplate(ctx.map, 21, 20, TEMPLATE_BRIDGE1H, 6); // half-destroyed
    ctx.bridgeCellCount = ctx.map.countBridgeCells();

    // Destroy barrel — triggers Phase 2 bridge destruction and occupant killing
    structureDamage(ctx, barrel, 100);

    // Infantry on the bridge cell should be dead (fell into water)
    expect(infantryOnBridge.alive).toBe(false);
  });

  it('units NOT on bridge cells are unaffected by bridge destruction', () => {
    const infantryOffBridge = new Entity(
      UnitType.I_E1, House.USSR,
      25 * CELL_SIZE + CELL_SIZE / 2,
      20 * CELL_SIZE + CELL_SIZE / 2,
    );
    const barrel = makeBarrel(20, 20, 'BARL');
    const ctx = makeCombatCtx([infantryOffBridge], [barrel]);
    setBridgeTemplate(ctx.map, 21, 20, TEMPLATE_BRIDGE1H, 6); // half-destroyed
    ctx.bridgeCellCount = ctx.map.countBridgeCells();

    const hpBefore = infantryOffBridge.hp;

    structureDamage(ctx, barrel, 100);

    // Infantry far from bridge should be alive (may take blast damage but not bridge-kill)
    // The bridge occupant killer only kills units on cells that became water
    expect(infantryOffBridge.alive).toBe(true);
  });
});

// ── PARITY GAP: Screen shake on bridge destruction ─────────────────────────
// C++ map.cpp:1862 — Shake_The_Screen(3) when bridge is fully destroyed.
// C++ map.cpp:1982 — Shake_The_Screen(3) for multi-part bridge destruction.

describe('Screen shake from bridge destruction', () => {

  it('barrel explosion causes screen shake (indirect bridge effect)', () => {
    // structureDamage sets screenShake for barrel explosions as part of the
    // building destruction effect chain — not specifically for bridge destruction.
    const barrel = makeBarrel(20, 20, 'BARL');
    const ctx = makeCombatCtx([], [barrel]);
    setBridgeTemplate(ctx.map, 21, 20, TEMPLATE_BRIDGE1, 6);
    ctx.bridgeCellCount = ctx.map.countBridgeCells();

    structureDamage(ctx, barrel, 100);

    // Screen shake comes from barrel building destruction, not bridge specifically
    expect(ctx.screenShake).toBeGreaterThan(0);
  });
});

// ── Building placement prohibition on bridges ──────────────────────────────

describe('PARITY FIXED: Building placement on bridges (cell.cpp:499)', () => {

  it('bridge cells with CLEAR terrain block building placement via isBridgeCell()', () => {
    // C++ cell.cpp:499 explicitly prohibits building on bridge cells via Is_Bridge_Here().
    // TS isBuildable now checks isBridgeCell() — bridge cells are not buildable.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    // PARITY FIXED: bridge cells block building placement
    expect(map.isBuildable(20, 20)).toBe(false);
  });
});

// ── Barrel chain explosion to adjacent bridge barrels ──────────────────────

describe('Barrel chain explosions near bridges', () => {

  it('barrel explosion chain can destroy multiple bridge sections', () => {
    // C++ barrel explosions fire 4 cardinal bullets (building.cpp:1344-1369).
    // If another barrel is in a cardinal cell, it chains. TS replicates this.
    const barrel1 = makeBarrel(20, 20, 'BARL');
    const barrel2 = makeBarrel(21, 20, 'BARL'); // 1 cell east
    const ctx = makeCombatCtx([], [barrel1, barrel2]);

    // Place bridge cells near both barrels
    setBridgeTemplate(ctx.map, 19, 20, TEMPLATE_BRIDGE1, 6);
    setBridgeTemplate(ctx.map, 22, 20, TEMPLATE_BRIDGE1, 6);
    ctx.bridgeCellCount = ctx.map.countBridgeCells();

    expect(ctx.bridgeCellCount).toBe(2);

    // Destroy first barrel — it should chain to second barrel
    structureDamage(ctx, barrel1, 100);

    // Both barrels should be destroyed (chain explosion)
    expect(barrel1.alive).toBe(false);
    expect(barrel2.alive).toBe(false);

    // Both bridge sections should be destroyed
    expect(ctx.map.getTerrain(19, 20)).toBe(Terrain.WATER);
    expect(ctx.map.getTerrain(22, 20)).toBe(Terrain.WATER);
  });
});

// ── Bridge count tracking ──────────────────────────────────────────────────

describe('Bridge count tracking (Scen.BridgeCount / ctx.bridgeCellCount)', () => {

  it('bridgeCellCount updates after barrel destroys bridge', () => {
    // C++ map.cpp:1828 — Scen.BridgeCount-- on full bridge destruction
    // TS recalculates count from scratch after barrel explosion
    // Use half-destroyed bridges near barrel for Phase 2 destruction.
    const barrel = makeBarrel(20, 20, 'BARL');
    const ctx = makeCombatCtx([], [barrel]);

    setBridgeTemplate(ctx.map, 21, 20, TEMPLATE_BRIDGE1H, 6); // half-destroyed
    setBridgeTemplate(ctx.map, 22, 20, TEMPLATE_BRIDGE1H, 6); // half-destroyed
    setBridgeTemplate(ctx.map, 50, 50, TEMPLATE_BRIDGE2, 6); // far away, intact
    ctx.bridgeCellCount = ctx.map.countBridgeCells();

    expect(ctx.bridgeCellCount).toBe(3);

    structureDamage(ctx, barrel, 100);

    // Near bridge cells fully destroyed (Phase 2), far one remains
    expect(ctx.bridgeCellCount).toBe(1);
  });

  it('multiple bridge count: each bridge section tracked independently', () => {
    const map = new GameMap();

    // 3 separate bridge sections
    setBridgeTemplate(map, 10, 10, TEMPLATE_BRIDGE1, 6);
    setBridgeTemplate(map, 30, 30, TEMPLATE_BRIDGE2, 6);
    setBridgeTemplate(map, 50, 50, TEMPLATE_BRIDGE_1A, 6);

    expect(map.countBridgeCells()).toBe(3);

    // Destroy only one — two-phase for intact bridges
    map.destroyBridge(10, 10, 1); // Phase 1: half-destroyed (still counted)
    expect(map.countBridgeCells()).toBe(3); // half-destroyed still counted

    map.destroyBridge(10, 10, 1); // Phase 2: water (no longer counted)
    expect(map.countBridgeCells()).toBe(2);
  });
});
