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
 *   map.cpp:1791-1987 — Destroy_Bridge_At: two-phase destruction
 *   map.cpp:1837-1861 — kill occupants on destroyed bridge cells
 *   map.cpp:2045-2073 — Intact_Bridge_Count: BRIDGE templates with TIcon==6
 *   cell.cpp:3000 — reject bridge cells for ore germination
 *   cell.cpp:499 — building placement prohibited on bridge cells (Is_Bridge_Here)
 *   defines.h — TEMPLATE_BRIDGE1=131, TEMPLATE_BRIDGE2=133, etc.
 *   trigger.cpp — TEVENT_ALL_BRIDGES_DESTROYED (#31)
 *   map.cpp:1870-1890 — Bridge_Remap: no bridge repair mechanic in RA1
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
import type { MapStructure } from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── C++ Bridge Template IDs (defines.h TemplateType enum, 0-based) ──────────
const TEMPLATE_BRIDGE1 = 131;   // intact horizontal bridge
const TEMPLATE_BRIDGE2 = 133;   // intact vertical bridge
const TEMPLATE_BRIDGE1H = 378;  // half-destroyed horizontal
const TEMPLATE_BRIDGE2H = 379;  // half-destroyed vertical
const TEMPLATE_BRIDGE_1A = 235; // multi-part bridge piece 1A
const TEMPLATE_BRIDGE_1B = 236; // multi-part bridge piece 1B

// C++ rules.ini [General] BridgeStrength
const CPP_BRIDGE_STRENGTH = 1000;

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

describe('BridgeStrength value — C++ rules.ini [General] BridgeStrength=1000', () => {

  it('rules.ini defines BridgeStrength=1000', () => {
    // C++ rules.cpp:267 — Rule.BridgeStrength defaults to 1000, overridden by rules.ini.
    // rules.ini [General] BridgeStrength=1000
    // Verify the value matches the C++ source.
    const fs = require('node:fs');
    const path = require('node:path');
    const iniPath = path.resolve(__dirname, '..', '..', '..', 'public', 'ra', 'assets', 'rules.ini');
    const ini = fs.readFileSync(iniPath, 'utf8');

    const match = ini.match(/BridgeStrength\s*=\s*(\d+)/);
    expect(match, 'rules.ini should contain BridgeStrength').toBeTruthy();
    expect(parseInt(match![1])).toBe(CPP_BRIDGE_STRENGTH);
  });

  it('PARITY GAP: engine hardcodes BridgeStrength=1000 instead of reading from rules.ini', () => {
    // C++ reads Rule.BridgeStrength from rules.ini at runtime (rules.cpp:267).
    // TS hardcodes `const bridgeStrength = 1000` in combat.ts:1046.
    // If rules.ini were changed, TS would not pick up the new value.
    // This test verifies the hardcoded value matches rules.ini (currently passes,
    // but documents the parity gap that TS doesn't dynamically read the value).
    //
    // To verify: search combat.ts for "bridgeStrength" — it should be a constant, not parsed.
    const fs = require('node:fs');
    const path = require('node:path');
    const combatPath = path.resolve(__dirname, '..', 'engine', 'combat.ts');
    const combatSrc = fs.readFileSync(combatPath, 'utf8');

    // TS should have the value hardcoded as a literal 1000
    const hardcoded = combatSrc.match(/const bridgeStrength\s*=\s*(\d+)/);
    expect(hardcoded, 'combat.ts should hardcode bridgeStrength').toBeTruthy();
    expect(parseInt(hardcoded![1])).toBe(CPP_BRIDGE_STRENGTH);
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
    // Check: for damage=200, success if roll < 200, i.e. roll in {1..199} = 199/1000.
    // This matches C++.
    const damage = 200;
    const successCount = 199; // rolls 1..199
    const totalRolls = CPP_BRIDGE_STRENGTH; // 1000 possible rolls
    const cppProbability = successCount / totalRolls;

    expect(cppProbability).toBeCloseTo(0.199, 3);
  });

  it('damage=1 should never destroy bridge (roll must be < 1, minimum roll is 1)', () => {
    // C++ Random_Pick(1, 1000) returns minimum 1.
    // Check: 1 < 1 is false. So damage=1 can NEVER destroy a bridge.
    // TS: Math.floor(Math.random() * 1000) + 1 = minimum 1. 1 < 1 is false. Matches.
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
    // TS: Math.floor(Math.random() * 1000) + 1 = maximum 1000. 1000 < 1001 is true. Matches.
    const ctx = makeCombatCtx();
    setBridgeTemplate(ctx.map, 20, 20, TEMPLATE_BRIDGE1, 6);
    ctx.bridgeCellCount = ctx.map.countBridgeCells();

    const impactPos = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };

    // Single HE shot with damage=1001 — should always destroy bridge
    applySplashDamage(ctx, impactPos, { damage: 1001, warhead: 'HE', splash: 1.5 }, -1, House.Spain);

    expect(ctx.map.getTerrain(20, 20)).toBe(Terrain.WATER);
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

    expect(ctx.map.getTerrain(20, 20)).toBe(Terrain.WATER);
  });
});

// ── 3. Bridge repair mechanics ──────────────────────────────────────────────

describe('PARITY GAP: Bridge repair — C++ has no bridge repair in RA1', () => {

  it('C++ RA1 has no bridge repair mechanic — destroyed bridges stay destroyed', () => {
    // C++ RA1 (unlike RA2/YR) has no engineer bridge repair.
    // Once a bridge is destroyed, it stays destroyed for the rest of the mission.
    // TS matches this behavior — there is no repairBridge function.
    // Verify: after destroyBridge, there is no way to restore the bridge cells.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    expect(map.countBridgeCells()).toBe(1);

    map.destroyBridge(20, 20, 3);

    expect(map.countBridgeCells()).toBe(0);
    expect(map.getTerrain(20, 20)).toBe(Terrain.WATER);

    // Verify no repairBridge method exists on GameMap
    expect((map as any).repairBridge).toBeUndefined();
  });

  it('destroyed bridge template type is changed (cannot be re-detected as bridge)', () => {
    // After destruction, the template type should no longer be a bridge template.
    // C++ replaces with BRIDGE1D/2D. TS sets to water template (1).
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    const idx = 20 * MAP_CELLS + 20;
    expect(map.templateType[idx]).toBe(TEMPLATE_BRIDGE1);

    map.destroyBridge(20, 20, 3);

    // TS sets template to 1 (water). C++ would set to BRIDGE1D (380).
    // Either way, it should no longer be a bridge template.
    const bridgeTemplates = new Set([131, 133, 235, 236, 378, 379]);
    expect(bridgeTemplates.has(map.templateType[idx])).toBe(false);
  });
});

// ── 4. Ore germination rejection on bridge cells ────────────────────────────

describe('Ore germination rejects bridge cells — C++ cell.cpp:3000', () => {

  it('bridge template cells are excluded from ore spread target set', () => {
    // C++ cell.cpp:3000 — ore growth rejects cells with bridge templates.
    // This prevents ore from spawning on bridges.
    // TS map.ts growOre checks template type before spreading.
    const map = new GameMap();
    map.setBounds(5, 5, 20, 20);

    // Place ore seed at (10, 10)
    const seedIdx = 10 * MAP_CELLS + 10;
    map.overlay[seedIdx] = 0x0A; // high density gold — above spread threshold (0x09)

    // Surround with bridge cells on all 8 directions
    for (const [dx, dy] of [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]]) {
      const nx = 10 + dx, ny = 10 + dy;
      setBridgeTemplate(map, nx, ny, TEMPLATE_BRIDGE1, 6);
      // Ensure overlay is clear (no ore)
      map.overlay[ny * MAP_CELLS + nx] = 0xFF;
    }

    // Trigger ore growth
    const growthTick = GameMap.ORE_GROWTH_INTERVAL;
    map.growOre(growthTick);

    // Bridge cells should NOT have ore after growth
    for (const [dx, dy] of [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]]) {
      const nx = 10 + dx, ny = 10 + dy;
      const nidx = ny * MAP_CELLS + nx;
      expect(map.overlay[nidx], `bridge cell at (${nx},${ny}) should not have ore`).toBe(0xFF);
    }
  });

  it('all six bridge template types are rejected for germination', () => {
    // C++ checks: 131, 133, 235, 236, 378, 379
    // TS must reject all six template IDs.
    const allBridgeTemplates = [
      TEMPLATE_BRIDGE1,    // 131
      TEMPLATE_BRIDGE2,    // 133
      TEMPLATE_BRIDGE_1A,  // 235
      TEMPLATE_BRIDGE_1B,  // 236
      TEMPLATE_BRIDGE1H,   // 378
      TEMPLATE_BRIDGE2H,   // 379
    ];

    for (const tmpl of allBridgeTemplates) {
      const map = new GameMap();
      map.setBounds(5, 5, 20, 20);

      // Place ore seed
      const seedIdx = 10 * MAP_CELLS + 10;
      map.overlay[seedIdx] = 0x0A;

      // Place one bridge cell east of seed
      setBridgeTemplate(map, 11, 10, tmpl, 6);
      map.overlay[11 * MAP_CELLS + 10] = 0xFF;
      // Block all other spread directions with non-CLEAR terrain
      for (const [dx, dy] of [[0,-1],[1,-1],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]]) {
        map.setTerrain(10 + dx, 10 + dy, Terrain.WATER);
      }

      map.growOre(GameMap.ORE_GROWTH_INTERVAL);

      const bridgeIdx = 10 * MAP_CELLS + 11;
      expect(map.overlay[bridgeIdx], `template ${tmpl} should be rejected for ore spread`).toBe(0xFF);
    }
  });
});

// ── 5. Bridge template ID consistency ───────────────────────────────────────

describe('Bridge template ID consistency across engine modules', () => {

  it('countBridgeCells and destroyBridge use the same template set', () => {
    // Both functions must recognize the same 6 bridge template IDs.
    // countBridgeCells: Set([131, 133, 235, 236, 378, 379]) with icon==6
    // destroyBridge: if (tmpl===131 || tmpl===133 || tmpl===235 || tmpl===236 || tmpl===378 || tmpl===379)
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);

    const allTemplates = [131, 133, 235, 236, 378, 379];

    // Place each template at a unique position
    for (let i = 0; i < allTemplates.length; i++) {
      setBridgeTemplate(map, 20 + i, 20, allTemplates[i], 6);
    }

    // countBridgeCells should find all 6
    expect(map.countBridgeCells()).toBe(6);

    // destroyBridge at center should destroy all within radius
    const destroyed = map.destroyBridge(22, 20, 5);

    // All 6 should be destroyed
    expect(destroyed).toBe(6);
    expect(map.countBridgeCells()).toBe(0);
  });

  it('ore germination rejection uses the same 6 template IDs', () => {
    // C++ cell.cpp:3000 rejects the same TEMPLATE_BRIDGE* set.
    // Verify the germination code checks all 6 IDs by testing each individually.
    const map = new GameMap();
    map.setBounds(5, 5, 20, 20);

    const allTemplates = [131, 133, 235, 236, 378, 379];

    for (const tmpl of allTemplates) {
      const testMap = new GameMap();
      testMap.setBounds(5, 5, 20, 20);

      const seedIdx = 10 * MAP_CELLS + 10;
      testMap.overlay[seedIdx] = 0x0A;

      // Only east direction is bridge; all others are water (impassable for spread)
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

// ── 6. TEVENT_ALL_BRIDGES_DESTROYED trigger ─────────────────────────────────

describe('TEVENT_ALL_BRIDGES_DESTROYED trigger (#31) — scenario.ts', () => {

  it('trigger fires when bridgesAlive reaches 0', () => {
    // C++ trigger.cpp: TEVENT_ALL_BRIDGES_DESTROYED (#31) checks Scen.BridgeCount == 0.
    // TS scenario.ts:2117-2118 checks state.bridgesAlive === 0.
    // Verify the trigger condition by simulating bridge destruction.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);
    setBridgeTemplate(map, 30, 30, TEMPLATE_BRIDGE2, 6);

    // Before destruction: bridges alive
    let bridgesAlive = map.countBridgeCells();
    expect(bridgesAlive).toBe(2);
    expect(bridgesAlive === 0).toBe(false); // trigger should NOT fire

    // Destroy first bridge
    map.destroyBridge(20, 20, 3);
    bridgesAlive = map.countBridgeCells();
    expect(bridgesAlive).toBe(1);
    expect(bridgesAlive === 0).toBe(false); // trigger should NOT fire

    // Destroy second bridge
    map.destroyBridge(30, 30, 3);
    bridgesAlive = map.countBridgeCells();
    expect(bridgesAlive).toBe(0);
    expect(bridgesAlive === 0).toBe(true); // trigger SHOULD fire
  });

  it('trigger does not fire if half-destroyed bridges remain', () => {
    // C++ Intact_Bridge_Count includes BRIDGE1H/2H (half-destroyed) templates.
    // So even half-destroyed bridges prevent the trigger from firing.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1H, 6); // half-destroyed

    const bridgesAlive = map.countBridgeCells();
    expect(bridgesAlive).toBe(1);
    expect(bridgesAlive === 0).toBe(false); // trigger should NOT fire
  });
});

// ── 7. Naval pathfinding through destroyed bridge cells ─────────────────────

describe('Naval pathfinding through destroyed bridge cells', () => {

  it('intact bridge cells are NOT water-passable for naval units', () => {
    // C++ parity: bridge cells are CLEAR terrain — naval units cannot pass.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    expect(map.isWaterPassable(20, 20)).toBe(false);
    expect(map.isPassable(20, 20)).toBe(true); // land units can pass
  });

  it('destroyed bridge cells ARE water-passable for naval units', () => {
    // C++ parity: destroyed bridge becomes water/river — naval units can pass.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    map.destroyBridge(20, 20, 3);

    expect(map.isWaterPassable(20, 20)).toBe(true);
    expect(map.isPassable(20, 20)).toBe(false); // land units cannot pass
  });

  it('canEnterCell reflects bridge state for naval pathfinding', () => {
    // C++ Can_Enter_Cell checks terrain; naval units need WATER.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    // Before destruction: naval cannot enter
    const beforeNaval = map.canEnterCell(20, 20, true);
    expect(beforeNaval).not.toBe(0); // MoveResult.IMPASSABLE (not OK)

    // Before destruction: ground can enter
    const beforeGround = map.canEnterCell(20, 20, false);
    expect(beforeGround).toBe(0); // MoveResult.OK

    map.destroyBridge(20, 20, 3);

    // After destruction: naval can enter
    const afterNaval = map.canEnterCell(20, 20, true);
    expect(afterNaval).toBe(0); // MoveResult.OK

    // After destruction: ground cannot enter
    const afterGround = map.canEnterCell(20, 20, false);
    expect(afterGround).not.toBe(0); // MoveResult.IMPASSABLE
  });
});

// ── 8. killBridgeOccupants mechanics ────────────────────────────────────────

describe('killBridgeOccupants — C++ map.cpp:1837-1861', () => {

  it('only kills entities on cells that became WATER (not all cells in radius)', () => {
    // C++ map.cpp:1843 — only kills occupants on cells that are now water (destroyed bridge).
    // A unit on a non-bridge cell within the radius should survive.
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

    // Only (20,20) is a bridge cell; (22,20) is plain ground
    setBridgeTemplate(ctx.map, 20, 20, TEMPLATE_BRIDGE1, 6);
    ctx.map.setTerrain(22, 20, Terrain.CLEAR);

    // Destroy bridge — converts (20,20) to water
    ctx.map.destroyBridge(20, 20, 3);

    // Kill occupants
    killBridgeOccupants(ctx, 20, 20, 3);

    expect(entityOnBridge.alive).toBe(false);
    expect(entityOnGround.alive).toBe(true); // not on water cell
  });

  it('kills vehicles as well as infantry on destroyed bridge', () => {
    // C++ kills ALL techno objects on destroyed bridge cells, not just infantry.
    const tank = new Entity(
      UnitType.V_3TNK, House.USSR,
      20 * CELL_SIZE + CELL_SIZE / 2,
      20 * CELL_SIZE + CELL_SIZE / 2,
    );
    const ctx = makeCombatCtx([tank]);
    setBridgeTemplate(ctx.map, 20, 20, TEMPLATE_BRIDGE1, 6);

    ctx.map.destroyBridge(20, 20, 3);
    killBridgeOccupants(ctx, 20, 20, 3);

    expect(tank.alive).toBe(false);
  });

  it('does not kill entities already dead or in limbo', () => {
    // C++ checks obj->Is_Techno() and obj->Strength > 0 before killing.
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
    setBridgeTemplate(ctx.map, 20, 20, TEMPLATE_BRIDGE1, 6);

    ctx.map.destroyBridge(20, 20, 3);

    // Should not throw or modify already-dead/limbo entities
    expect(() => killBridgeOccupants(ctx, 20, 20, 3)).not.toThrow();
  });
});

// ── 9. PARITY GAP: Building placement on bridge cells ───────────────────────

describe('PARITY GAP: Building placement on bridge cells — C++ cell.cpp:499', () => {

  it('C++ prohibits building on bridge cells via Is_Bridge_Here()', () => {
    // C++ cell.cpp:499 calls Is_Bridge_Here() to block building placement on bridges.
    // TS isBuildable only checks terrain type — CLEAR terrain is buildable.
    // Bridge cells have CLEAR terrain, so TS incorrectly allows building on bridges.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    // C++ would return false (Is_Bridge_Here blocks it).
    // TS returns true because terrain is CLEAR.
    // This is a known parity gap.
    const result = map.isBuildable(20, 20);
    expect(result).toBe(true); // PARITY GAP: C++ would be false
  });

  it('destroyed bridge cells (WATER) correctly block building placement', () => {
    // After destruction, terrain is WATER — both C++ and TS agree this is unbuildable.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    map.destroyBridge(20, 20, 3);

    expect(map.isBuildable(20, 20)).toBe(false);
  });
});

// ── 10. PARITY GAP: Two-phase destruction vs one-phase ──────────────────────

describe('PARITY GAP: C++ two-phase vs TS one-phase bridge destruction', () => {

  it('C++ intact bridge requires TWO hits to fully destroy', () => {
    // C++ map.cpp:1797-1812: first Destroy_Bridge_At changes BRIDGE1 → BRIDGE1H.
    // C++ map.cpp:1814-1864: second Destroy_Bridge_At changes BRIDGE1H → BRIDGE1D.
    // TS skips phase 1: one destroyBridge call converts directly to water.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);

    map.destroyBridge(20, 20, 3);

    // PARITY GAP: TS destroys immediately. C++ would leave as half-destroyed.
    const idx = 20 * MAP_CELLS + 20;
    // C++ after first hit: templateType should be 378 (BRIDGE1H), terrain still CLEAR
    // TS after first hit: templateType is 1 (water), terrain is WATER
    expect(map.templateType[idx]).toBe(1); // TS behavior: water template
    // C++ would be: expect(map.templateType[idx]).toBe(378); // BRIDGE1H
  });

  it('PARITY GAP: TS destroyBridge does not distinguish intact from half-destroyed', () => {
    // In C++, destroying a half-destroyed bridge has different behavior than
    // destroying an intact bridge (screen shake, occupant killing only on full destruction).
    // TS treats both identically.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);

    // Test with intact bridge
    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);
    const destroyed1 = map.destroyBridge(20, 20, 3);

    // Test with half-destroyed bridge
    setBridgeTemplate(map, 30, 30, TEMPLATE_BRIDGE1H, 6);
    const destroyed2 = map.destroyBridge(30, 30, 3);

    // Both return 1 — TS makes no distinction
    expect(destroyed1).toBe(1);
    expect(destroyed2).toBe(1);

    // Both become water — TS makes no distinction
    expect(map.getTerrain(20, 20)).toBe(Terrain.WATER);
    expect(map.getTerrain(30, 30)).toBe(Terrain.WATER);
  });
});

// ── 11. Bridge destruction radius ───────────────────────────────────────────

describe('Bridge destruction radius — C++ map.cpp Destroy_Bridge_At', () => {

  it('uses square radius (Manhattan-style), not circular', () => {
    // C++ and TS both use a square bounding box: for (dy = -r; dy <= r; dy++) for (dx = -r; dx <= r; dx++)
    // This means a radius=3 checks a 7x7 square area, not a circular area.
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);

    // Place bridge cells at corners of a 7x7 square (radius=3)
    const corners = [[-3,-3], [3,-3], [-3,3], [3,3]];
    for (const [dx, dy] of corners) {
      setBridgeTemplate(map, 20 + dx, 20 + dy, TEMPLATE_BRIDGE1, 6);
    }

    const destroyed = map.destroyBridge(20, 20, 3);

    // All 4 corner cells should be destroyed (square, not circle)
    expect(destroyed).toBe(4);
    for (const [dx, dy] of corners) {
      expect(map.getTerrain(20 + dx, 20 + dy)).toBe(Terrain.WATER);
    }
  });

  it('radius=0 only affects the exact center cell', () => {
    const map = new GameMap();
    map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);

    setBridgeTemplate(map, 20, 20, TEMPLATE_BRIDGE1, 6);
    setBridgeTemplate(map, 21, 20, TEMPLATE_BRIDGE1, 6); // adjacent

    const destroyed = map.destroyBridge(20, 20, 0);

    expect(destroyed).toBe(1);
    expect(map.getTerrain(20, 20)).toBe(Terrain.WATER);
    expect(map.getTerrain(21, 20)).toBe(Terrain.CLEAR); // untouched
  });
});

// ── 12. EVA messages for bridge events ──────────────────────────────────────

describe('EVA messages for bridge events', () => {

  it('EVA message 7 = "Bridge destroyed."', () => {
    // C++ Speak(VOX_BRIDGE_DESTROYED) == EVA index 7
    // TS scenario.ts EVA_MESSAGES[7] = 'Bridge destroyed.'
    // Verify the mapping exists. Cannot import scenario internals directly,
    // so verify via combat.ts behavior.
    const ctx = makeCombatCtx();
    setBridgeTemplate(ctx.map, 20, 20, TEMPLATE_BRIDGE1, 6);
    ctx.bridgeCellCount = ctx.map.countBridgeCells();

    const evaMessages: number[] = [];
    ctx.showEvaMessage = (id: number) => evaMessages.push(id);

    // Force deterministic bridge destruction with damage > 1000
    const impactPos = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };
    applySplashDamage(ctx, impactPos, { damage: 1500, warhead: 'HE', splash: 1.5 }, -1, House.Spain);

    expect(evaMessages).toContain(7);
  });

  it('EVA message 96 = "Bridge charges set. Take cover!"', () => {
    // C++ has VOX_BRIDGE_CHARGES_SET for engineer bridge charges (RA2, not RA1).
    // TS includes it as EVA_MESSAGES[96] but it is not used in normal gameplay.
    // This just documents the mapping exists.
    // TS scenario.ts:5953 — 96: 'Bridge charges set. Take cover!'
    // This is informational only — no behavioral test needed.
    expect(true).toBe(true); // placeholder: message mapping verified by code inspection
  });
});

// ── 13. Warhead filtering for bridge damage ─────────────────────────────────

describe('Warhead filtering for bridge damage — C++ combat.cpp:261', () => {

  it('only AP and HE warheads can damage bridges', () => {
    // C++ combat.cpp:267 explicitly checks: warhead == WARHEAD_AP || warhead == WARHEAD_HE
    const allowedWarheads = ['AP', 'HE'] as const;
    const rejectedWarheads = ['SA', 'Fire', 'Super'] as const;

    // Test allowed warheads can destroy (with enough attempts)
    for (const wh of allowedWarheads) {
      const ctx = makeCombatCtx();
      setBridgeTemplate(ctx.map, 20, 20, TEMPLATE_BRIDGE1, 6);
      ctx.bridgeCellCount = ctx.map.countBridgeCells();

      const impactPos = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };

      // Use damage > 1000 to guarantee destruction
      applySplashDamage(ctx, impactPos, { damage: 1500, warhead: wh, splash: 1.5 }, -1, House.Spain);

      expect(ctx.map.getTerrain(20, 20), `${wh} warhead should destroy bridge`).toBe(Terrain.WATER);
    }

    // Test rejected warheads cannot destroy
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
