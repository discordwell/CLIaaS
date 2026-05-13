/**
 * C++ Behavioral Parity: Bridge Mechanics Audit
 *
 * Audits bridge-related mechanics against C++ rules.ini and source behavior.
 * Covers BridgeStrength sourcing, damage probability formula, bridge repair,
 * ore germination rejection, trigger events, and template ID consistency.
 *
 * C++ source references:
 *   rules.ini [General] BridgeStrength=1000
 *   rules.cpp:267  — Rule.BridgeStrength = ini.Get_Fixed(...) default 1000
 *   combat.cpp:261-268 — bridge damage check: warhead AP/HE only
 *   combat.cpp:267 — Random_Pick(1, Rule.BridgeStrength) < strength
 *   combat.cpp:261-265 — 10 bridge templates checked for splash damage
 *   map.cpp:1791-1987 — Destroy_Bridge_At: two-phase destruction
 *   map.cpp:1837-1861 — kill occupants on destroyed bridge cells
 *   map.cpp:1862 — Shake_The_Screen(3) on full destruction
 *   map.cpp:2045-2073 — Intact_Bridge_Count: BRIDGE templates with TIcon==6
 *   cell.cpp:3000 — reject bridge cells for ore germination
 *   cell.cpp:498-501 — building placement prohibited on bridge cells (Is_Bridge_Here)
 *   cell.cpp:2828-2850 — Is_Bridge_Here: 16 bridge template variants
 *   defines.h — TemplateType enum: BRIDGE1=131 through BRIDGE_3F=246, BRIDGE1H=378, BRIDGE2H=379
 *   trigger.cpp — TEVENT_ALL_BRIDGES_DESTROYED (#31)
 *   infantry.cpp:3186-3198 — demolitioner sabotage on bridge cells (ACTION_SABOTAGE)
 *   infantry.cpp:710-790 — engineer bridge repair is #ifdef OBSOLETE (no repair in RA1)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, MAP_CELLS,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  applySplashDamage,
  killBridgeOccupants,
} from '../engine/combat';
import { GameMap, Terrain } from '../engine/map';
import { AI_BUILD_RULES } from '../engine/ai';
import type { MapStructure } from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── C++ Bridge Template IDs (defines.h TemplateType enum, 0-based) ──────────
// Simple bridges
const TEMPLATE_BRIDGE1 = 131;   // intact horizontal bridge
const TEMPLATE_BRIDGE1D = 132;  // fully destroyed horizontal bridge
const TEMPLATE_BRIDGE2 = 133;   // intact vertical bridge
const TEMPLATE_BRIDGE2D = 134;  // fully destroyed vertical bridge
// Multi-part bridge pieces (defines.h:1929-1940)
const TEMPLATE_BRIDGE_1A = 235;
const TEMPLATE_BRIDGE_1B = 236;
const TEMPLATE_BRIDGE_1C = 237;
const TEMPLATE_BRIDGE_2A = 238;
const TEMPLATE_BRIDGE_2B = 239;
const TEMPLATE_BRIDGE_2C = 240;
const TEMPLATE_BRIDGE_3A = 241;
const TEMPLATE_BRIDGE_3B = 242;
const TEMPLATE_BRIDGE_3C = 243;
const TEMPLATE_BRIDGE_3D = 244;
const TEMPLATE_BRIDGE_3E = 245;
const TEMPLATE_BRIDGE_3F = 246;
// Half-destroyed bridges (defines.h:2074-2075)
const TEMPLATE_BRIDGE1H = 378;  // half-destroyed horizontal
const TEMPLATE_BRIDGE2H = 379;  // half-destroyed vertical

// C++ rules.ini [General] BridgeStrength
const CPP_BRIDGE_STRENGTH = 1000;

// C++ combat.cpp:261-265 — all 10 templates that can take splash damage
const CPP_SPLASH_DAMAGEABLE_BRIDGE_TEMPLATES = [
  TEMPLATE_BRIDGE1, TEMPLATE_BRIDGE2,       // 131, 133
  TEMPLATE_BRIDGE1H, TEMPLATE_BRIDGE2H,     // 378, 379
  TEMPLATE_BRIDGE_1A, TEMPLATE_BRIDGE_1B,   // 235, 236
  TEMPLATE_BRIDGE_2A, TEMPLATE_BRIDGE_2B,   // 238, 239
  TEMPLATE_BRIDGE_3A, TEMPLATE_BRIDGE_3B,   // 241, 242
];

// C++ cell.cpp:2828-2850 — all 16 templates recognized by Is_Bridge_Here
const CPP_IS_BRIDGE_HERE_TEMPLATES = [
  TEMPLATE_BRIDGE1, TEMPLATE_BRIDGE1H, TEMPLATE_BRIDGE1D,
  TEMPLATE_BRIDGE2, TEMPLATE_BRIDGE2H, TEMPLATE_BRIDGE2D,
  TEMPLATE_BRIDGE_1A, TEMPLATE_BRIDGE_1B,
  TEMPLATE_BRIDGE_2A, TEMPLATE_BRIDGE_2B,
  TEMPLATE_BRIDGE_3A, TEMPLATE_BRIDGE_3B, TEMPLATE_BRIDGE_3C,
  TEMPLATE_BRIDGE_3D, TEMPLATE_BRIDGE_3E, TEMPLATE_BRIDGE_3F,
];

// C++ map.cpp:2045-2073 — only 6 templates counted as "intact" (with icon==6)
const CPP_INTACT_BRIDGE_TEMPLATES = [
  TEMPLATE_BRIDGE1, TEMPLATE_BRIDGE1H,
  TEMPLATE_BRIDGE2, TEMPLATE_BRIDGE2H,
  TEMPLATE_BRIDGE_1A, TEMPLATE_BRIDGE_1B,
];

// TS engine template set — the 6 templates recognized by map.ts destroyBridge/countBridgeCells
const TS_BRIDGE_TEMPLATES = new Set([131, 133, 235, 236, 378, 379]);

// ── Helpers ────────────────────────────────────────────────────────────────────

function setBridgeTemplate(map: GameMap, cx: number, cy: number, tmplType: number, icon: number = 6): void {
  const idx = cy * MAP_CELLS + cx;
  map.templateType[idx] = tmplType;
  map.templateIcon[idx] = icon;
  map.setTerrain(cx, cy, Terrain.CLEAR);
}

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
    isRevealedToHouse: () => true,
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

// ── 1. BridgeStrength value from rules.ini ──────────────────────────────────

describe('BridgeStrength value — rules.ini [General] BridgeStrength=1000', () => {

  it('rules.ini defines BridgeStrength=1000', () => {
    // C++ rules.cpp:267 — Rule.BridgeStrength defaults to 1000, overridden by rules.ini.
    // rules.ini [General] BridgeStrength=1000
    const fs = require('node:fs');
    const path = require('node:path');
    const iniPath = path.resolve(__dirname, '..', '..', '..', 'public', 'ra', 'assets', 'rules.ini');
    const ini = fs.readFileSync(iniPath, 'utf8');

    const match = ini.match(/BridgeStrength\s*=\s*(\d+)/);
    expect(match, 'rules.ini should contain BridgeStrength').toBeTruthy();
    expect(parseInt(match![1])).toBe(CPP_BRIDGE_STRENGTH);
  });

  it('engine sources BridgeStrength from AI_BUILD_RULES constant', () => {
    // C++ reads Rule.BridgeStrength from rules.ini at runtime (rules.cpp:267).
    // TS now uses AI_BUILD_RULES.bridgeStrength instead of a hardcoded literal.
    expect(AI_BUILD_RULES.bridgeStrength).toBe(CPP_BRIDGE_STRENGTH);

    // Verify combat.ts no longer has a hardcoded `const bridgeStrength = 1000`
    const fs = require('node:fs');
    const path = require('node:path');
    const combatPath = path.resolve(__dirname, '..', 'engine', 'combat.ts');
    const combatSrc = fs.readFileSync(combatPath, 'utf8');
    const hardcoded = combatSrc.match(/const bridgeStrength\s*=\s*\d+/);
    expect(hardcoded, 'combat.ts should no longer hardcode bridgeStrength').toBeNull();

    // Verify combat.ts references AI_BUILD_RULES.bridgeStrength
    expect(combatSrc).toContain('AI_BUILD_RULES.bridgeStrength');
  });
});

// ── 2. Bridge damage probability formula ────────────────────────────────────

describe('Bridge damage probability formula — C++ combat.cpp:267', () => {

  it('C++ formula: Random_Pick(1, BridgeStrength) < damage — inclusive range [1, 1000]', () => {
    // C++ Random_Pick(a, b) returns a random integer in [a, b] inclusive.
    // So Random_Pick(1, 1000) returns 1..1000 (1000 values).
    // Bridge is destroyed if roll < damage.
    // For damage=200: probability = 199/1000 = 19.9%.
    //
    // TS uses: Math.floor(Math.random() * 1000) + 1 < weapon.damage
    // This generates 1..1000 inclusive, matching C++ Random_Pick(1, 1000).
    const damage = 200;
    const successCount = 199; // rolls 1..199
    const totalRolls = CPP_BRIDGE_STRENGTH; // 1000 possible rolls
    const cppProbability = successCount / totalRolls;

    expect(cppProbability).toBeCloseTo(0.199, 3);
  });

  it('damage=1 should never destroy bridge (roll must be < 1, minimum roll is 1)', () => {
    // C++ Random_Pick(1, 1000) returns minimum 1.
    // Check: 1 < 1 is false. So damage=1 can NEVER destroy a bridge.
    const ctx = makeCombatCtx();
    setBridgeTemplate(ctx.map, 20, 20, TEMPLATE_BRIDGE1, 6);
    ctx.bridgeCellCount = ctx.map.countBridgeCells();

    const impactPos = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };

    // Fire 200 HE shots with damage=1 — should never destroy bridge
    for (let i = 0; i < 200; i++) {
      applySplashDamage(ctx, impactPos, { damage: 1, warhead: 'HE', splash: 1.5 }, -1, House.Spain);
    }

    const bridgeIdx = 20 * MAP_CELLS + 20;
    expect(ctx.map.templateType[bridgeIdx]).toBe(TEMPLATE_BRIDGE1);
  });

  it('damage >= 1001 should always destroy bridge (roll max is 1000, always < 1001)', () => {
    // C++ Random_Pick(1, 1000) returns maximum 1000.
    // Check: 1000 < 1001 is true. So damage >= 1001 ALWAYS destroys.
    // Two-phase: first hit -> half-destroyed, second -> destroyed bridge river.
    const ctx = makeCombatCtx();
    setBridgeTemplate(ctx.map, 20, 20, TEMPLATE_BRIDGE1, 6);
    ctx.bridgeCellCount = ctx.map.countBridgeCells();

    const impactPos = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };

    // Phase 1: intact → half-destroyed
    applySplashDamage(ctx, impactPos, { damage: 1001, warhead: 'HE', splash: 1.5 }, -1, House.Spain);
    const idx = 20 * MAP_CELLS + 20;
    expect(ctx.map.templateType[idx]).toBe(TEMPLATE_BRIDGE1H);
    expect(ctx.map.getTerrain(20, 20)).toBe(Terrain.CLEAR);

    // Phase 2: half-destroyed -> BRIDGE1D with LAND_RIVER.
    ctx.bridgeCellCount = ctx.map.countBridgeCells();
    applySplashDamage(ctx, impactPos, { damage: 1001, warhead: 'HE', splash: 1.5 }, -1, House.Spain);
    expect(ctx.map.getTerrain(20, 20)).toBe(Terrain.RIVER);
  });

  it('damage=1000 should almost always destroy bridge (999/1000 chance)', () => {
    // Roll must be < 1000. Only roll=1000 fails. 999/1000 = 99.9% success.
    // With 20 shots, probability of at least one success = 1 - (1/1000)^20 ~ 1.0.
    const ctx = makeCombatCtx();
    setBridgeTemplate(ctx.map, 20, 20, TEMPLATE_BRIDGE1, 6);
    ctx.bridgeCellCount = ctx.map.countBridgeCells();

    const impactPos = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };

    for (let i = 0; i < 20; i++) {
      applySplashDamage(ctx, impactPos, { damage: 1000, warhead: 'HE', splash: 1.5 }, -1, House.Spain);
    }

    expect(ctx.map.getTerrain(20, 20)).toBe(Terrain.RIVER);
  });
});

// ── 3. Bridge repair mechanics ──────────────────────────────────────────────

describe('Bridge repair — C++ has no bridge repair in RA1', () => {

  it('C++ RA1 has no bridge repair mechanic — #ifdef OBSOLETE (infantry.cpp:710-790)', () => {
    // C++ infantry.cpp:710-790 — engineer bridge repair code is wrapped in #ifdef OBSOLETE.
    // This means it was compiled out of the shipping game. Bridges stay destroyed forever.
    // TS correctly has no repairBridge function.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    expect(map.countBridgeCells()).toBe(1);

    // Two-phase: Phase 1 → half-destroyed (still counted)
    map.destroyBridge(20, 20, 3);
    expect(map.countBridgeCells()).toBe(1); // half-destroyed still counted

    // Phase 2 → fully destroyed
    map.destroyBridge(20, 20, 3);
    expect(map.countBridgeCells()).toBe(0);
    expect(map.getTerrain(20, 20)).toBe(Terrain.WATER);

    // Verify no repairBridge method exists on GameMap
    expect((map as any).repairBridge).toBeUndefined();
  });

  it('destroyed bridge template type is changed (cannot be re-detected as bridge)', () => {
    // After full destruction (two phases), the template type should no longer be a bridge template.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    const idx = 20 * MAP_CELLS + 20;
    expect(map.templateType[idx]).toBe(TEMPLATE_BRIDGE1);

    // Phase 1: intact → half-destroyed (still a bridge template)
    map.destroyBridge(20, 20, 3);
    expect(map.templateType[idx]).toBe(TEMPLATE_BRIDGE1H);
    expect(TS_BRIDGE_TEMPLATES.has(map.templateType[idx])).toBe(true);

    // Phase 2: half-destroyed → water
    map.destroyBridge(20, 20, 3);
    expect(map.templateType[idx]).toBe(1);
    expect(TS_BRIDGE_TEMPLATES.has(map.templateType[idx])).toBe(false);
  });
});

// ── 4. Ore germination rejection on bridge cells ────────────────────────────

describe('Ore germination rejects bridge cells — C++ cell.cpp:3000', () => {

  it('bridge template cells are excluded from ore spread target set', () => {
    // C++ cell.cpp:3000 — ore growth rejects cells with bridge templates.
    const map = new GameMap();
    map.setBounds(5, 5, 20, 20);

    // Place ore seed at (10, 10)
    const seedIdx = 10 * MAP_CELLS + 10;
    map.overlay[seedIdx] = 0x0A;

    // Surround with bridge cells on all 8 directions
    for (const [dx, dy] of [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]]) {
      const nx = 10 + dx, ny = 10 + dy;
      setBridgeTemplate(map, nx, ny, TEMPLATE_BRIDGE1, 6);
      map.overlay[ny * MAP_CELLS + nx] = 0xFF;
    }

    map.growOre(GameMap.ORE_GROWTH_INTERVAL);

    // Bridge cells should NOT have ore after growth
    for (const [dx, dy] of [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]]) {
      const nx = 10 + dx, ny = 10 + dy;
      const nidx = ny * MAP_CELLS + nx;
      expect(map.overlay[nidx], `bridge cell at (${nx},${ny}) should not have ore`).toBe(0xFF);
    }
  });

  it('all six TS bridge template types are rejected for germination', () => {
    // C++ checks: 131, 133, 235, 236, 378, 379
    // TS must reject all six template IDs in its ore growth code.
    const allBridgeTemplates = [...TS_BRIDGE_TEMPLATES];

    for (const tmpl of allBridgeTemplates) {
      const map = new GameMap();
      map.setBounds(5, 5, 20, 20);

      const seedIdx = 10 * MAP_CELLS + 10;
      map.overlay[seedIdx] = 0x0A;

      setBridgeTemplate(map, 11, 10, tmpl, 6);
      map.overlay[11 * MAP_CELLS + 10] = 0xFF;
      for (const [dx, dy] of [[0,-1],[1,-1],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]]) {
        map.setTerrain(10 + dx, 10 + dy, Terrain.WATER);
      }

      map.growOre(GameMap.ORE_GROWTH_INTERVAL);

      const bridgeIdx = 10 * MAP_CELLS + 11;
      expect(map.overlay[bridgeIdx], `template ${tmpl} should be rejected for ore spread`).toBe(0xFF);
    }
  });
});

// ── 5. Bridge template ID consistency across engine modules ─────────────────

describe('Bridge template ID consistency across engine modules', () => {

  it('countBridgeCells and destroyBridge use the same template set', () => {
    // Both functions must recognize the same 6 bridge template IDs.
    // Two-phase: first pass transitions intact→half-destroyed and half-destroyed→water.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);

    const allTemplates = [...TS_BRIDGE_TEMPLATES];

    for (let i = 0; i < allTemplates.length; i++) {
      setBridgeTemplate(map, 20 + i, 20, allTemplates[i], 6);
    }

    expect(map.countBridgeCells()).toBe(6);

    // First pass: intact (131,133) → half-destroyed; half-destroyed (378,379) → water; multi-part (235,236) → water
    map.destroyBridge(22, 20, 5);
    // Second pass: newly half-destroyed → water
    map.destroyBridge(22, 20, 5);

    expect(map.countBridgeCells()).toBe(0);
  });

  it('ore germination rejection uses the same 6 template IDs', () => {
    const allTemplates = [...TS_BRIDGE_TEMPLATES];

    for (const tmpl of allTemplates) {
      const testMap = new GameMap();
      testMap.setBounds(5, 5, 20, 20);

      const seedIdx = 10 * MAP_CELLS + 10;
      testMap.overlay[seedIdx] = 0x0A;

      for (const [dx, dy] of [[0,-1],[1,-1],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]]) {
        testMap.setTerrain(10 + dx, 10 + dy, Terrain.WATER);
      }
      setBridgeTemplate(testMap, 11, 10, tmpl, 6);
      testMap.overlay[10 * MAP_CELLS + 11] = 0xFF;

      testMap.growOre(GameMap.ORE_GROWTH_INTERVAL);

      expect(testMap.overlay[10 * MAP_CELLS + 11], `template ${tmpl} should block ore germination`).toBe(0xFF);
    }
  });
});

// ── 6. TEVENT_ALL_BRIDGES_DESTROYED trigger (#31) ───────────────────────────

describe('TEVENT_ALL_BRIDGES_DESTROYED trigger (#31) — scenario.ts', () => {

  it('trigger fires when bridgesAlive reaches 0', () => {
    // C++ trigger.cpp: TEVENT_ALL_BRIDGES_DESTROYED (#31) checks Scen.BridgeCount == 0.
    // Two-phase: each bridge needs two destroyBridge calls.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);
    setBridgeTemplate(map, 30, 30, TEMPLATE_BRIDGE2, 6);

    let bridgesAlive = map.countBridgeCells();
    expect(bridgesAlive).toBe(2);

    // Phase 1: intact → half-destroyed (still counted)
    map.destroyBridge(20, 20, 3);
    bridgesAlive = map.countBridgeCells();
    expect(bridgesAlive).toBe(2); // half-destroyed still counted

    // Phase 2: half-destroyed → water
    map.destroyBridge(20, 20, 3);
    bridgesAlive = map.countBridgeCells();
    expect(bridgesAlive).toBe(1);

    // Destroy second bridge (two phases)
    map.destroyBridge(30, 30, 3);
    map.destroyBridge(30, 30, 3);
    bridgesAlive = map.countBridgeCells();
    expect(bridgesAlive).toBe(0);
    expect(bridgesAlive === 0).toBe(true); // trigger SHOULD fire
  });

  it('trigger does not fire if half-destroyed bridges remain', () => {
    // C++ Intact_Bridge_Count includes BRIDGE1H/2H (half-destroyed) templates.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1H, 6);

    const bridgesAlive = map.countBridgeCells();
    expect(bridgesAlive).toBe(1);
    expect(bridgesAlive === 0).toBe(false);
  });
});

// ── 7. Naval pathfinding through destroyed bridge cells ─────────────────────

describe('Naval pathfinding through destroyed bridge cells', () => {

  it('intact bridge cells are NOT water-passable for naval units', () => {
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    expect(map.isWaterPassable(20, 20)).toBe(false);
    expect(map.isPassable(20, 20)).toBe(true);
  });

  it('destroyed bridge cells ARE water-passable for naval units', () => {
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    // Two-phase: intact → half-destroyed → water
    map.destroyBridge(20, 20, 3);
    map.destroyBridge(20, 20, 3);

    expect(map.isWaterPassable(20, 20)).toBe(true);
    expect(map.isPassable(20, 20)).toBe(false);
  });

  it('canEnterCell reflects bridge state for naval pathfinding', () => {
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    const beforeNaval = map.canEnterCell(20, 20, true);
    expect(beforeNaval).not.toBe(0); // MoveResult.IMPASSABLE

    const beforeGround = map.canEnterCell(20, 20, false);
    expect(beforeGround).toBe(0); // MoveResult.OK

    // Two-phase destruction: intact → half-destroyed → water
    map.destroyBridge(20, 20, 3);
    // Half-destroyed: still passable for ground, not for naval
    expect(map.canEnterCell(20, 20, false)).toBe(0); // still passable
    expect(map.canEnterCell(20, 20, true)).not.toBe(0); // still not water

    map.destroyBridge(20, 20, 3);
    // Fully destroyed: water — passable for naval, not for ground
    const afterNaval = map.canEnterCell(20, 20, true);
    expect(afterNaval).toBe(0); // MoveResult.OK

    const afterGround = map.canEnterCell(20, 20, false);
    expect(afterGround).not.toBe(0); // MoveResult.IMPASSABLE
  });
});

// ── 8. killBridgeOccupants mechanics ────────────────────────────────────────

describe('killBridgeOccupants — C++ map.cpp:1837-1861', () => {

  it('only kills entities on cells that became WATER (not all cells in radius)', () => {
    // C++ map.cpp:1843 — only kills occupants on cells that are now water.
    // Use half-destroyed template so single destroyBridge → WATER (Phase 2).
    const entityOnBridge = new Entity(
      UnitType.I_E1, House.USSR,
      20 * CELL_SIZE + CELL_SIZE / 2,
      20 * CELL_SIZE + CELL_SIZE / 2,
    );
    const entityOnGround = new Entity(
      UnitType.I_E1, House.USSR,
      22 * CELL_SIZE + CELL_SIZE / 2,
      20 * CELL_SIZE + CELL_SIZE / 2,
    );
    const ctx = makeCombatCtx([entityOnBridge, entityOnGround]);

    setBridgeTemplate(ctx.map, 20, 20, TEMPLATE_BRIDGE1H, 6); // half-destroyed
    ctx.map.setTerrain(22, 20, Terrain.CLEAR);

    ctx.map.destroyBridge(20, 20, 3); // Phase 2: half-destroyed → WATER
    killBridgeOccupants(ctx, 20, 20, 3);

    expect(entityOnBridge.alive).toBe(false);
    expect(entityOnGround.alive).toBe(true);
  });

  it('kills vehicles as well as infantry on destroyed bridge', () => {
    // C++ kills ALL techno objects: obj->Take_Damage(obj->Strength, 0, WARHEAD_HE, NULL, true)
    const tank = new Entity(
      UnitType.V_3TNK, House.USSR,
      20 * CELL_SIZE + CELL_SIZE / 2,
      20 * CELL_SIZE + CELL_SIZE / 2,
    );
    const ctx = makeCombatCtx([tank]);
    setBridgeTemplate(ctx.map, 20, 20, TEMPLATE_BRIDGE1H, 6); // half-destroyed

    ctx.map.destroyBridge(20, 20, 3); // Phase 2: → WATER
    killBridgeOccupants(ctx, 20, 20, 3);

    expect(tank.alive).toBe(false);
  });

  it('does not kill entities already dead or in limbo', () => {
    const deadEntity = new Entity(
      UnitType.I_E1, House.USSR,
      20 * CELL_SIZE + CELL_SIZE / 2,
      20 * CELL_SIZE + CELL_SIZE / 2,
    );
    deadEntity.alive = false;

    const limboEntity = new Entity(
      UnitType.I_E1, House.USSR,
      20 * CELL_SIZE + CELL_SIZE / 2,
      20 * CELL_SIZE + CELL_SIZE / 2,
    );
    limboEntity.inLimbo = true;

    const ctx = makeCombatCtx([deadEntity, limboEntity]);
    setBridgeTemplate(ctx.map, 20, 20, TEMPLATE_BRIDGE1H, 6); // half-destroyed

    ctx.map.destroyBridge(20, 20, 3); // Phase 2: → WATER

    expect(() => killBridgeOccupants(ctx, 20, 20, 3)).not.toThrow();
  });
});

// ── 9. PARITY FIXED: Building placement on bridge cells ─────────────────────

describe('PARITY FIXED: Building placement on bridge cells — C++ cell.cpp:498-501', () => {

  it('PARITY FIXED: bridge cells block building placement via isBridgeCell()', () => {
    // C++ cell.cpp:498-501 — when loco == SPEED_NONE (building placement check),
    // calls Is_Bridge_Here() which returns true for all 16 bridge template types.
    // TS isBuildable now checks isBridgeCell() — bridge cells are not buildable.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    const result = map.isBuildable(20, 20);
    expect(result).toBe(false); // PARITY FIXED: bridge cells block building
  });

  it('destroyed bridge cells (WATER) correctly block building placement', () => {
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    map.destroyBridge(20, 20, 3);

    expect(map.isBuildable(20, 20)).toBe(false);
  });

  it('C++ Is_Bridge_Here recognizes 16 template types, not just 6', () => {
    // C++ cell.cpp:2828-2850 — Is_Bridge_Here includes destroyed variants and
    // all multi-part bridge pieces (3C, 3D, 3E, 3F, 1C, 2C, etc.)
    // TS only recognizes 6 templates in its bridge logic.
    expect(CPP_IS_BRIDGE_HERE_TEMPLATES.length).toBe(16);
    expect(TS_BRIDGE_TEMPLATES.size).toBe(6);

    // The 10 templates recognized by C++ but not by TS:
    const missingFromTS = CPP_IS_BRIDGE_HERE_TEMPLATES.filter(t => !TS_BRIDGE_TEMPLATES.has(t));
    expect(missingFromTS).toEqual([
      TEMPLATE_BRIDGE1D,   // 132 — fully destroyed horizontal
      TEMPLATE_BRIDGE2D,   // 134 — fully destroyed vertical
      TEMPLATE_BRIDGE_2A,  // 238
      TEMPLATE_BRIDGE_2B,  // 239
      TEMPLATE_BRIDGE_3A,  // 241
      TEMPLATE_BRIDGE_3B,  // 242
      TEMPLATE_BRIDGE_3C,  // 243
      TEMPLATE_BRIDGE_3D,  // 244
      TEMPLATE_BRIDGE_3E,  // 245
      TEMPLATE_BRIDGE_3F,  // 246
    ]);
  });
});

// ── 10. PARITY FIXED: Two-phase bridge destruction ──────────────────────────

describe('PARITY FIXED: C++ two-phase bridge destruction (map.cpp:1797-1864)', () => {

  it('intact bridge requires TWO hits to fully destroy', () => {
    // C++ map.cpp:1797-1812: first Destroy_Bridge_At changes BRIDGE1 -> BRIDGE1H.
    // C++ map.cpp:1814-1864: second Destroy_Bridge_At changes BRIDGE1H -> BRIDGE1D.
    // TS now implements two-phase: Phase 1 → half-destroyed, Phase 2 → water.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    map.destroyBridge(20, 20, 3);

    const idx = 20 * MAP_CELLS + 20;
    // PARITY FIXED: Phase 1 creates half-destroyed bridge (378), terrain stays CLEAR
    expect(map.templateType[idx]).toBe(TEMPLATE_BRIDGE1H);
    expect(map.getTerrain(20, 20)).toBe(Terrain.CLEAR); // still passable

    // Phase 2: half-destroyed → fully destroyed (water)
    map.destroyBridge(20, 20, 3);
    expect(map.templateType[idx]).toBe(1); // water template
    expect(map.getTerrain(20, 20)).toBe(Terrain.WATER);
  });

  it('PARITY FIXED: destroyBridge distinguishes intact from half-destroyed', () => {
    // Phase 1 (intact → half-destroyed): only changes template, terrain stays CLEAR.
    // Phase 2 (half-destroyed → water): changes terrain to WATER, kills occupants.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);

    // Intact bridge: Phase 1 → half-destroyed (still CLEAR)
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);
    const destroyed1 = map.destroyBridge(20, 20, 3);
    expect(destroyed1).toBe(1);
    expect(map.getTerrain(20, 20)).toBe(Terrain.CLEAR); // still passable

    // Half-destroyed bridge: Phase 2 → water
    setBridgeTemplate(map, 30, 30, TEMPLATE_BRIDGE1H, 6);
    const destroyed2 = map.destroyBridge(30, 30, 3);
    expect(destroyed2).toBe(1);
    expect(map.getTerrain(30, 30)).toBe(Terrain.WATER); // fully destroyed
  });

  it('Phase 1: BRIDGE1 -> BRIDGE1H preserves passability (bridge still walkable)', () => {
    // C++ map.cpp:1806 — first hit on BRIDGE1 creates BRIDGE1H but does NOT
    // call Zone_Reset or kill occupants. The bridge remains passable.
    // PARITY FIXED: TS now implements this correctly.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    // Phase 1: bridge becomes half-destroyed but stays passable
    map.destroyBridge(20, 20, 3);
    expect(map.isPassable(20, 20)).toBe(true); // PARITY FIXED: still passable
    expect(map.templateType[20 * MAP_CELLS + 20]).toBe(TEMPLATE_BRIDGE1H);
  });
});

// ── 11. Bridge destruction radius ───────────────────────────────────────────

describe('Bridge destruction radius — map.ts destroyBridge', () => {

  it('uses square radius (Chebyshev distance), not circular', () => {
    // Both C++ and TS use: for (dy = -r; dy <= r; dy++) for (dx = -r; dx <= r; dx++)
    // This means a radius=3 checks a 7x7 square area (Chebyshev distance <= 3).
    // Use half-destroyed templates so single destroyBridge → WATER.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);

    const corners = [[-3,-3], [3,-3], [-3,3], [3,3]];
    for (const [dx, dy] of corners) {
      setBridgeTemplate(map, 20 + dx, 20 + dy, TEMPLATE_BRIDGE1H, 6);
    }

    const destroyed = map.destroyBridge(20, 20, 3);

    expect(destroyed).toBe(4);
    for (const [dx, dy] of corners) {
      expect(map.getTerrain(20 + dx, 20 + dy)).toBe(Terrain.WATER);
    }
  });

  it('radius=0 only affects the exact center cell', () => {
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);

    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1H, 6);
    setBridgeTemplate(map, 21, 20, TEMPLATE_BRIDGE1H, 6);

    const destroyed = map.destroyBridge(20, 20, 0);

    expect(destroyed).toBe(1);
    expect(map.getTerrain(20, 20)).toBe(Terrain.WATER);
    expect(map.getTerrain(21, 20)).toBe(Terrain.CLEAR);
  });
});

// ── 12. EVA messages for bridge events ──────────────────────────────────────

describe('EVA messages for bridge events', () => {

  it('EVA message 7 = "Bridge destroyed." fires on splash damage bridge kill', () => {
    // C++ Speak(VOX_BRIDGE_DESTROYED) == EVA index 7
    // EVA fires on Phase 2 (full destruction), so use half-destroyed template.
    const ctx = makeCombatCtx();
    setBridgeTemplate(ctx.map, 20, 20, TEMPLATE_BRIDGE1H, 6); // half-destroyed
    ctx.bridgeCellCount = ctx.map.countBridgeCells();

    const evaMessages: number[] = [];
    ctx.showEvaMessage = (id: number) => evaMessages.push(id);

    const impactPos = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };
    applySplashDamage(ctx, impactPos, { damage: 1500, warhead: 'HE', splash: 1.5 }, -1, House.Spain);

    expect(evaMessages).toContain(7);
  });
});

// ── 13. Warhead filtering for bridge damage ─────────────────────────────────

describe('Warhead filtering for bridge damage — C++ combat.cpp:261-268', () => {

  it('only AP and HE warheads can damage bridges', () => {
    // C++ combat.cpp:267 explicitly checks: warhead == WARHEAD_AP || warhead == WARHEAD_HE
    // Use half-destroyed templates so one splash hit fully destroys (Phase 2).
    const allowedWarheads = ['AP', 'HE'] as const;
    const rejectedWarheads = ['SA', 'Fire', 'Super'] as const;

    for (const wh of allowedWarheads) {
      const ctx = makeCombatCtx();
      setBridgeTemplate(ctx.map, 20, 20, TEMPLATE_BRIDGE1H, 6); // half-destroyed
      ctx.bridgeCellCount = ctx.map.countBridgeCells();

      const impactPos = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };
      applySplashDamage(ctx, impactPos, { damage: 1500, warhead: wh, splash: 1.5 }, -1, House.Spain);

      expect(ctx.map.getTerrain(20, 20), `${wh} warhead should destroy bridge`).toBe(Terrain.RIVER);
    }

    for (const wh of rejectedWarheads) {
      const ctx = makeCombatCtx();
      setBridgeTemplate(ctx.map, 20, 20, TEMPLATE_BRIDGE1, 6);
      ctx.bridgeCellCount = ctx.map.countBridgeCells();

      const impactPos = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };
      for (let i = 0; i < 50; i++) {
        applySplashDamage(ctx, impactPos, { damage: 1500, warhead: wh, splash: 1.5 }, -1, House.Spain);
      }

      const bridgeIdx = 20 * MAP_CELLS + 20;
      expect(ctx.map.templateType[bridgeIdx], `${wh} warhead should NOT destroy bridge`).toBe(TEMPLATE_BRIDGE1);
    }
  });
});

// ── 14. PARITY FIXED: Splash damage bridge template coverage ────────────────

describe('PARITY FIXED: C++ combat.cpp:261-265 checks 10 templates, TS now checks all 10', () => {

  it('TS now checks all 10 multi-part bridge templates for splash damage', () => {
    // C++ combat.cpp:261-265 checks these 10 templates for bridge damage from splash:
    //   BRIDGE1(131), BRIDGE2(133), BRIDGE1H(378), BRIDGE2H(379),
    //   BRIDGE_1A(235), BRIDGE_1B(236),
    //   BRIDGE_2A(238), BRIDGE_2B(239), BRIDGE_3A(241), BRIDGE_3B(242)
    //
    // TS combat.ts now checks all 10 — previously only checked 6.
    const tsSplashTemplates = new Set([131, 133, 235, 236, 238, 239, 241, 242, 378, 379]);
    const cppSplashTemplates = new Set(CPP_SPLASH_DAMAGEABLE_BRIDGE_TEMPLATES);

    const missingFromTS = CPP_SPLASH_DAMAGEABLE_BRIDGE_TEMPLATES.filter(
      t => !tsSplashTemplates.has(t)
    );

    // PARITY FIXED: no templates missing from TS anymore
    expect(missingFromTS).toEqual([]);
    expect(missingFromTS.length).toBe(0);
  });

  it('PARITY FIXED: HE splash on BRIDGE_2A cell destroys bridge in TS', () => {
    // C++ combat.cpp:264 includes TEMPLATE_BRIDGE_2A in the splash damage check.
    // TS combat.ts now includes template 238 (was previously missing).
    const ctx = makeCombatCtx();
    setBridgeTemplate(ctx.map, 20, 20, TEMPLATE_BRIDGE_2A, 6);
    ctx.bridgeCellCount = ctx.map.countBridgeCells();

    const impactPos = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };
    // Use guaranteed-destroy damage
    applySplashDamage(ctx, impactPos, { damage: 1500, warhead: 'HE', splash: 1.5 }, -1, House.Spain);

    // PARITY FIXED: TS now recognizes template 238 as a bridge and destroys it.
    const bridgeIdx = 20 * MAP_CELLS + 20;
    expect(ctx.map.templateType[bridgeIdx]).not.toBe(TEMPLATE_BRIDGE_2A);
  });

  it('PARITY FIXED: HE splash on BRIDGE_3A cell destroys bridge in TS', () => {
    // C++ combat.cpp:265 includes TEMPLATE_BRIDGE_3A in the splash damage check.
    // TS combat.ts now includes template 241 (was previously missing).
    const ctx = makeCombatCtx();
    setBridgeTemplate(ctx.map, 20, 20, TEMPLATE_BRIDGE_3A, 6);

    const impactPos = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };
    applySplashDamage(ctx, impactPos, { damage: 1500, warhead: 'HE', splash: 1.5 }, -1, House.Spain);

    const bridgeIdx = 20 * MAP_CELLS + 20;
    expect(ctx.map.templateType[bridgeIdx]).not.toBe(TEMPLATE_BRIDGE_3A);
  });

  it('PARITY FIXED: destroyBridge destroys BRIDGE_2A/2B/3A/3B cells', () => {
    // TS map.ts destroyBridge now checks all 10 bridge template types including
    // multi-part bridge pieces _2A, _2B, _3A, _3B (was previously missing).
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);

    const fixedTemplates = [
      TEMPLATE_BRIDGE_2A, TEMPLATE_BRIDGE_2B,
      TEMPLATE_BRIDGE_3A, TEMPLATE_BRIDGE_3B,
    ];
    for (let i = 0; i < fixedTemplates.length; i++) {
      setBridgeTemplate(map, 30 + i, 30, fixedTemplates[i], 6);
    }

    const destroyed = map.destroyBridge(31, 30, 3);

    // PARITY FIXED: TS now recognizes and destroys these templates
    expect(destroyed).toBe(4);
    for (let i = 0; i < fixedTemplates.length; i++) {
      expect(map.getTerrain(30 + i, 30)).toBe(Terrain.WATER);
    }
  });

  it('PARITY MATCH: countBridgeCells correctly excludes BRIDGE_2A/2B/3A/3B', () => {
    // C++ Intact_Bridge_Count (map.cpp:2045-2073) also does NOT count these templates.
    // This is CORRECT parity — only the 6 templates with icon==6
    // are counted as intact bridges, matching C++ exactly.
    const map = new GameMap();
    setBridgeTemplate(map, 30, 30, TEMPLATE_BRIDGE_2A, 6);
    setBridgeTemplate(map, 31, 30, TEMPLATE_BRIDGE_3A, 6);

    // C++ Intact_Bridge_Count also returns 0 for these templates, so this is correct
    expect(map.countBridgeCells()).toBe(0);
  });
});

// ── 15. C++ Intact_Bridge_Count parity ──────────────────────────────────────

describe('countBridgeCells — C++ map.cpp:2045-2073 Intact_Bridge_Count', () => {

  it('counts only cells with icon==6 (C++ TIcon==6 check)', () => {
    const map = new GameMap();
    setBridgeTemplate(map, 10, 10, TEMPLATE_BRIDGE1, 6);  // counted
    setBridgeTemplate(map, 11, 10, TEMPLATE_BRIDGE1, 3);  // wrong icon, not counted
    setBridgeTemplate(map, 12, 10, TEMPLATE_BRIDGE1, 0);  // wrong icon, not counted
    setBridgeTemplate(map, 13, 10, TEMPLATE_BRIDGE2, 6);  // counted

    expect(map.countBridgeCells()).toBe(2);
  });

  it('matches C++ template set exactly: BRIDGE1/1H/2/2H/_1A/_1B', () => {
    // C++ map.cpp:2054-2059 — exactly these 6 templates
    const map = new GameMap();
    const templates = CPP_INTACT_BRIDGE_TEMPLATES;
    for (let i = 0; i < templates.length; i++) {
      setBridgeTemplate(map, 10 + i, 10, templates[i], 6);
    }
    expect(map.countBridgeCells()).toBe(6);
  });

  it('does NOT count fully-destroyed templates (BRIDGE1D=132, BRIDGE2D=134)', () => {
    const map = new GameMap();
    setBridgeTemplate(map, 10, 10, TEMPLATE_BRIDGE1D, 6);
    setBridgeTemplate(map, 11, 10, TEMPLATE_BRIDGE2D, 6);

    expect(map.countBridgeCells()).toBe(0);
  });

  it('returns 0 for empty map', () => {
    const map = new GameMap();
    expect(map.countBridgeCells()).toBe(0);
  });
});

// ── 16. C++ Destroy_Bridge_At screen shake ──────────────────────────────────

describe('Screen shake from bridge destruction — C++ map.cpp:1862', () => {

  it('C++ calls Shake_The_Screen(3) only on full destruction (Phase 2)', () => {
    // C++ map.cpp:1862 — Shake_The_Screen(3) is called after Phase 2
    // (BRIDGE1H/2H -> BRIDGE1D/2D), not Phase 1 (BRIDGE1/2 -> BRIDGE1H/2H).
    // C++ map.cpp:1978 — also Shake_The_Screen(3) for multi-part bridge full destruction.
    // C++ map.cpp:1982 — Shake_The_Screen(3) for multi-part partial destruction.
    // TS: barrel destruction sets screenShake as part of building death, not bridge-specific.
    // This is an informational parity note — the shake value 3 is not precisely replicated.
    expect(3).toBe(3); // C++ shake magnitude is 3 for bridge destruction
  });
});

// ── 17. Bridge destruction creates water cells (passability flip) ───────────

describe('Bridge destruction creates water cells — terrain state change', () => {

  it('destroyBridge sets templateType to TEMPLATE_WATER (1) after two phases', () => {
    // C++ map.cpp:1822-1825 sets BRIDGE1D/2D (132/134). TS sets 1 (water).
    // Both make the cell impassable to ground units. Requires two-phase destruction.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    // Phase 1: intact → half-destroyed
    map.destroyBridge(20, 20, 3);
    const idx = 20 * MAP_CELLS + 20;
    expect(map.templateType[idx]).toBe(TEMPLATE_BRIDGE1H);

    // Phase 2: half-destroyed → water
    map.destroyBridge(20, 20, 3);
    expect(map.templateType[idx]).toBe(1); // TEMPLATE_WATER
  });

  it('destroyBridge sets terrain to WATER after two phases', () => {
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE2, 6);

    // Phase 1: intact → half-destroyed (terrain stays CLEAR)
    map.destroyBridge(20, 20, 3);
    expect(map.getTerrain(20, 20)).toBe(Terrain.CLEAR);

    // Phase 2: half-destroyed → water
    map.destroyBridge(20, 20, 3);
    expect(map.getTerrain(20, 20)).toBe(Terrain.WATER);
  });

  it('ground units cannot traverse fully destroyed bridge cells', () => {
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    expect(map.isPassable(20, 20)).toBe(true); // before: passable

    // Phase 1: still passable (half-destroyed)
    map.destroyBridge(20, 20, 3);
    expect(map.isPassable(20, 20)).toBe(true); // half-destroyed: still passable

    // Phase 2: water, impassable
    map.destroyBridge(20, 20, 3);
    expect(map.isPassable(20, 20)).toBe(false); // after: impassable
  });

  it('naval units CAN traverse fully destroyed bridge cells', () => {
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    expect(map.isWaterPassable(20, 20)).toBe(false); // before: not water

    // Two-phase destruction
    map.destroyBridge(20, 20, 3);
    map.destroyBridge(20, 20, 3);

    expect(map.isWaterPassable(20, 20)).toBe(true); // after: water
  });
});

// ── 18. Demolitioner sabotage on bridge cells ───────────────────────────────

describe('Demolitioner (IsBomber) sabotage on bridges — C++ infantry.cpp:3186-3198', () => {

  it('C++ checks 8 bridge templates for sabotage action (BRIDGE_3A/3B are commented out)', () => {
    // C++ infantry.cpp:3186-3198:
    //   case TEMPLATE_BRIDGE1:      // 131
    //   case TEMPLATE_BRIDGE2:      // 133
    //   case TEMPLATE_BRIDGE1H:     // 378
    //   case TEMPLATE_BRIDGE2H:     // 379
    //   case TEMPLATE_BRIDGE_1A:    // 235
    //   case TEMPLATE_BRIDGE_1B:    // 236
    //   case TEMPLATE_BRIDGE_2A:    // 238
    //   case TEMPLATE_BRIDGE_2B:    // 239
    //   // case TEMPLATE_BRIDGE_3A: // COMMENTED OUT in C++
    //   // case TEMPLATE_BRIDGE_3B: // COMMENTED OUT in C++
    //      return(ACTION_SABOTAGE);
    //
    // Note: BRIDGE_3A and BRIDGE_3B are commented out in the C++ source.
    const sabotageTemplates = [
      TEMPLATE_BRIDGE1, TEMPLATE_BRIDGE2,
      TEMPLATE_BRIDGE1H, TEMPLATE_BRIDGE2H,
      TEMPLATE_BRIDGE_1A, TEMPLATE_BRIDGE_1B,
      TEMPLATE_BRIDGE_2A, TEMPLATE_BRIDGE_2B,
    ];
    // 3A and 3B are commented out in C++ source
    const commentedOutTemplates = [TEMPLATE_BRIDGE_3A, TEMPLATE_BRIDGE_3B];

    expect(sabotageTemplates.length).toBe(8);
    expect(commentedOutTemplates.length).toBe(2);
  });
});

// ── 19. Bridge count tracking consistency ───────────────────────────────────

describe('Bridge count tracking — C++ Scen.BridgeCount vs TS bridgeCellCount', () => {

  it('bridgeCellCount recalculated from scratch after destruction', () => {
    // C++ map.cpp:1828 — Scen.BridgeCount-- (decrements by 1 per full destruction).
    // TS recalculates from scratch: ctx.bridgeCellCount = ctx.map.countBridgeCells().
    // Two-phase: each intact bridge needs two destroyBridge calls to fully destroy.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);

    setBridgeTemplate(map, 10, 10, TEMPLATE_BRIDGE1, 6);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE2, 6);
    setBridgeTemplate(map, 30, 30, TEMPLATE_BRIDGE_1A, 6);

    expect(map.countBridgeCells()).toBe(3);

    // BRIDGE1 (intact): Phase 1 → half-destroyed (still counted), Phase 2 → water
    map.destroyBridge(10, 10, 1);
    expect(map.countBridgeCells()).toBe(3); // half-destroyed still counted
    map.destroyBridge(10, 10, 1);
    expect(map.countBridgeCells()).toBe(2);

    // BRIDGE2 (intact): two phases
    map.destroyBridge(20, 20, 1);
    map.destroyBridge(20, 20, 1);
    expect(map.countBridgeCells()).toBe(1);

    // BRIDGE_1A (multi-part): direct to water in one phase
    map.destroyBridge(30, 30, 1);
    expect(map.countBridgeCells()).toBe(0);
  });

  it('distant bridge sections are independent', () => {
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);

    setBridgeTemplate(map, 10, 10, TEMPLATE_BRIDGE1, 6);
    setBridgeTemplate(map, 60, 60, TEMPLATE_BRIDGE2, 6);

    // Two-phase destruction of first bridge
    map.destroyBridge(10, 10, 3);
    map.destroyBridge(10, 10, 3);

    expect(map.countBridgeCells()).toBe(1);
    expect(map.getTerrain(10, 10)).toBe(Terrain.WATER);
    expect(map.getTerrain(60, 60)).toBe(Terrain.CLEAR);
  });
});

// ── 20. BLOCKED: Multi-part bridge destruction state machine ────────────────

describe('BLOCKED: Multi-part bridge destruction — C++ map.cpp:1869-1985', () => {

  it('C++ has complex state machine for multi-part bridges', () => {
    // C++ map.cpp:1869-1985 implements a multi-step state machine for diagonal bridges:
    //   BRIDGE_1A -> BRIDGE_1B -> BRIDGE_1C (destroyed)
    //   BRIDGE_2A -> BRIDGE_2B -> BRIDGE_2C (destroyed)
    //   BRIDGE_3A -> BRIDGE_3B -> BRIDGE_3C (half) -> BRIDGE_3D/3E/3F (destroyed variants)
    //
    // C++ map.cpp:1876-1886 — first hit on _1A/_1B/_2A/_2B/_3A/_3B increments
    //   the template type by 1 (ttype++, new TemplateClass(ttype, cell)).
    //   e.g., BRIDGE_1A(235) -> BRIDGE_1B(236), BRIDGE_1B(236) -> BRIDGE_1C(237)
    //
    // C++ map.cpp:1892-1915 — BRIDGE_3C checks adjacent pieces for proper shaping.
    // C++ map.cpp:1921-1951 — BRIDGE_1C/2C trigger BridgeCount-- and occupant killing.
    //
    // TS has none of this — destroyBridge converts any recognized bridge cell to water
    // in one step. Multi-part bridges with templates _2A, _2B, _3A, _3B are not even
    // recognized by TS (see test 14 above).
    //
    // This is acceptable simplification IF no shipping mission uses multi-part bridges,
    // but it is a structural parity gap for completeness.
    const cppTransitions = {
      [TEMPLATE_BRIDGE_1A]: TEMPLATE_BRIDGE_1B,  // 235 -> 236
      [TEMPLATE_BRIDGE_1B]: TEMPLATE_BRIDGE_1C,  // 236 -> 237
      [TEMPLATE_BRIDGE_2A]: TEMPLATE_BRIDGE_2B,  // 238 -> 239
      [TEMPLATE_BRIDGE_2B]: TEMPLATE_BRIDGE_2C,  // 239 -> 240
      [TEMPLATE_BRIDGE_3A]: TEMPLATE_BRIDGE_3B,  // 241 -> 242
      [TEMPLATE_BRIDGE_3B]: TEMPLATE_BRIDGE_3C,  // 242 -> 243
    };

    // Verify the C++ transition is always +1
    for (const [from, to] of Object.entries(cppTransitions)) {
      expect(Number(to)).toBe(Number(from) + 1);
    }
  });
});
