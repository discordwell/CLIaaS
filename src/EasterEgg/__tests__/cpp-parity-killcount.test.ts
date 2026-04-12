/**
 * C++ Behavioral Parity: killCount / lossCount sync regression
 *
 * Bug: killCount was always 0 because _runMissionAI's snapshot of killCount
 * overwrote the live value set by _runCombat's sync. The fix uses a
 * getter/setter on the MissionAIContext to keep killCount in sync with the
 * Game instance (index.ts:1028-1029).
 *
 * C++ refs:
 * - techno.cpp — Record_Is_Killed increments house kill tracking
 * - score.cpp:546-597 — kill/loss score bookkeeping
 * - house.cpp:292,302 — ArmorBias (difficulty-scaled damage resistance)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE,
  UNIT_STATS, WEAPON_STATS,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  fireWeaponAt,
  handleUnitDeath,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';
import { COUNTRY_BONUSES } from '../engine/types';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(entities: Entity[] = []): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures: [],
    inflightProjectiles: [],
    effects: [] as Effect[],
    tick: 0,
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

// =========================================================================
// KC1: fireWeaponAt increments killCount on player-controlled kill
// C++ techno.cpp — Record_Is_Killed; score.cpp:546-597
// =========================================================================
describe('KC1: fireWeaponAt increments killCount when player unit kills enemy', () => {
  it('killCount increments from 0 to 1 after a single kill', () => {
    const attacker = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.V_3TNK, House.USSR, 6, 5);
    target.hp = 1; // ensure one-shot kill
    const ctx = makeCombatCtx([attacker, target]);

    expect(ctx.killCount).toBe(0);
    const weapon = WEAPON_STATS[UNIT_STATS['2TNK'].primaryWeapon!];
    fireWeaponAt(ctx, attacker, target, weapon);

    expect(target.alive).toBe(false);
    expect(ctx.killCount).toBe(1);
    expect(attacker.kills).toBe(1);
  });

  it('killCount does NOT increment when enemy kills player unit', () => {
    const attacker = entityAtCell(UnitType.V_3TNK, House.USSR, 5, 5);
    const target = entityAtCell(UnitType.V_2TNK, House.Spain, 6, 5);
    target.hp = 1;
    const ctx = makeCombatCtx([attacker, target]);

    const weapon = WEAPON_STATS[UNIT_STATS['3TNK'].primaryWeapon!];
    fireWeaponAt(ctx, attacker, target, weapon);

    expect(target.alive).toBe(false);
    // killCount tracks player kills only — enemy killing player does not increment
    expect(ctx.killCount).toBe(0);
    // But attacker still gets entity-level kill credit
    expect(attacker.kills).toBe(1);
  });
});

// =========================================================================
// KC2: Multiple kills in the same context accumulate correctly
// Regression: snapshot-based context would lose intermediate increments
// =========================================================================
describe('KC2: Multiple kills accumulate within the same context', () => {
  it('three consecutive kills yield killCount === 3', () => {
    const attacker = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    const t1 = entityAtCell(UnitType.I_E1, House.USSR, 6, 5);
    const t2 = entityAtCell(UnitType.I_E1, House.USSR, 6, 6);
    const t3 = entityAtCell(UnitType.I_E1, House.USSR, 6, 7);
    t1.hp = 1; t2.hp = 1; t3.hp = 1;

    const ctx = makeCombatCtx([attacker, t1, t2, t3]);
    const weapon = WEAPON_STATS[UNIT_STATS['2TNK'].primaryWeapon!];

    fireWeaponAt(ctx, attacker, t1, weapon);
    fireWeaponAt(ctx, attacker, t2, weapon);
    fireWeaponAt(ctx, attacker, t3, weapon);

    expect(ctx.killCount).toBe(3);
    expect(attacker.kills).toBe(3);
  });
});

// =========================================================================
// KC3: lossCount tracks player unit deaths
// C++ score.cpp — loss tracking when player-owned units die
// =========================================================================
describe('KC3: lossCount increments when player-controlled unit dies', () => {
  it('lossCount increments when enemy kills a player unit', () => {
    const attacker = entityAtCell(UnitType.V_3TNK, House.USSR, 5, 5);
    const victim = entityAtCell(UnitType.V_2TNK, House.Spain, 6, 5);
    victim.hp = 1;
    const ctx = makeCombatCtx([attacker, victim]);

    expect(ctx.lossCount).toBe(0);
    const weapon = WEAPON_STATS[UNIT_STATS['3TNK'].primaryWeapon!];
    fireWeaponAt(ctx, attacker, victim, weapon);

    expect(victim.alive).toBe(false);
    expect(ctx.lossCount).toBe(1);
  });

  it('lossCount does NOT increment when enemy unit dies', () => {
    const attacker = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.V_3TNK, House.USSR, 6, 5);
    target.hp = 1;
    const ctx = makeCombatCtx([attacker, target]);

    const weapon = WEAPON_STATS[UNIT_STATS['2TNK'].primaryWeapon!];
    fireWeaponAt(ctx, attacker, target, weapon);

    expect(target.alive).toBe(false);
    expect(ctx.lossCount).toBe(0);
  });
});

// =========================================================================
// KC4: Getter/setter pattern on MissionAIContext keeps killCount live
// This is the core regression: a plain property snapshot would go stale
// when _runCombat updates Game.killCount during _runMissionAI execution.
// =========================================================================
describe('KC4: getter/setter on MissionAIContext prevents stale snapshot', () => {
  it('getter/setter on context object reads/writes through to backing store', () => {
    // Simulate the pattern from index.ts:1016-1029 —
    // MissionAIContext uses get/set killCount that proxy to the Game instance.
    const gameState = { killCount: 0, lossCount: 0 };

    // Build a context with getter/setter (mirrors _missionAICtx)
    const missionCtx = {
      get killCount() { return gameState.killCount; },
      set killCount(v: number) { gameState.killCount = v; },
    };

    // Simulate _runCombat updating gameState.killCount directly (via _combatCtx sync)
    gameState.killCount = 5;

    // MissionAI context should see the live value — NOT a stale snapshot of 0
    expect(missionCtx.killCount).toBe(5);

    // MissionAI can also increment (e.g. ant nest kills in missionAI.ts:1131)
    missionCtx.killCount++;
    expect(gameState.killCount).toBe(6);
    expect(missionCtx.killCount).toBe(6);
  });

  it('plain property snapshot WOULD lose combat updates (demonstrates the bug)', () => {
    const gameState = { killCount: 0 };

    // BAD pattern (the bug): snapshot captures value at construction time
    const snapshotCtx = { killCount: gameState.killCount }; // copies 0

    // _runCombat updates gameState
    gameState.killCount = 3;

    // Snapshot is stale — still 0
    expect(snapshotCtx.killCount).toBe(0); // BUG: lost the 3 kills

    // When _runMissionAI returns, it would overwrite gameState.killCount with 0
    // gameState.killCount = snapshotCtx.killCount; // <-- the bug line (now removed)
  });
});
