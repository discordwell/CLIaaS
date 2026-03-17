/**
 * C++ Behavioral Parity: Splash Self-Exclusion
 *
 * Tests verify that splash damage exclusion matches C++ combat.cpp:207:
 *   if (!object->IsToDamage && object != source)
 *
 * In C++, the FIRER (source) is excluded from its own splash damage.
 * The direct-hit target takes splash damage on top of direct damage.
 * All other entities in splash radius take splash damage normally.
 *
 * C++ source references:
 *   combat.cpp:207 — `object != source` excludes firer from splash collection
 *   combat.cpp:222-237 — splash damage applied to all collected objects
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE,
  UNIT_STATS, buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  applySplashDamage,
  SPLASH_RADIUS,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Place an entity at an exact world position */
function entityAtPos(type: UnitType, house: House, x: number, y: number): Entity {
  return new Entity(type, house, x, y);
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

// ── Splash Self-Exclusion (combat.cpp:207) ─────────────────────────────────────

describe('Splash self-exclusion (combat.cpp:207: object != source)', () => {

  it('firer is excluded from its own splash damage', () => {
    // C++ combat.cpp:207 — the source/firer is excluded from the object list
    const attacker = entityAtCell(UnitType.I_E2, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const ctx = makeCombatCtx([attacker, target]);

    const attackerHpBefore = attacker.hp;

    // Splash centered on target, attacker is the firer
    applySplashDamage(
      ctx,
      target.pos,
      { damage: 100, warhead: 'HE', splash: 1.5 },
      target.id,
      House.Spain,
      attacker,
    );

    // Firer should take NO splash damage (C++ excludes source)
    expect(attacker.hp).toBe(attackerHpBefore);
  });

  it('direct-hit target takes splash damage on top of direct damage', () => {
    // C++ combat.cpp:207 — target is NOT excluded from splash collection
    // Only the firer (source) is excluded. Target gets both direct + splash.
    const attacker = entityAtCell(UnitType.I_E2, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const ctx = makeCombatCtx([attacker, target]);

    const targetHpBefore = target.hp;

    // Center splash on target's own position — target should take splash
    applySplashDamage(
      ctx,
      target.pos,
      { damage: 50, warhead: 'HE', splash: 1.5 },
      target.id,
      House.Spain,
      attacker,
    );

    // Target should take splash damage (distance=0 from splash center = full splash)
    expect(target.hp).toBeLessThan(targetHpBefore);
  });

  it('other entities in splash radius take splash damage', () => {
    // C++ combat.cpp:206-213 — all non-source entities in splash radius are collected
    const attacker = entityAtCell(UnitType.I_E2, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const bystander = entityAtCell(UnitType.I_E1, House.USSR, 11, 11); // ~1 cell from target
    const ctx = makeCombatCtx([attacker, target, bystander]);

    const bystanderHpBefore = bystander.hp;

    applySplashDamage(
      ctx,
      target.pos,
      { damage: 100, warhead: 'HE', splash: 1.5 },
      target.id,
      House.Spain,
      attacker,
    );

    // Bystander is ~1 cell from impact, within 1.5-cell splash radius
    expect(bystander.hp).toBeLessThan(bystanderHpBefore);
  });

  it('firer at distance 0 from explosion still takes no splash damage', () => {
    // Edge case: firer standing at the exact impact point should still be immune
    // C++ combat.cpp:207 checks object identity (object != source), not distance
    const attacker = entityAtPos(UnitType.I_E2, House.Spain, 200, 200);
    const target = entityAtPos(UnitType.I_E1, House.USSR, 200, 200); // same position
    const ctx = makeCombatCtx([attacker, target]);

    const attackerHpBefore = attacker.hp;

    // Splash centered exactly at attacker's position
    applySplashDamage(
      ctx,
      attacker.pos,
      { damage: 100, warhead: 'HE', splash: 1.5 },
      target.id,
      House.Spain,
      attacker,
    );

    // Firer immune regardless of position relative to explosion
    expect(attacker.hp).toBe(attackerHpBefore);
  });

  it('firer near splash center but not at distance 0 still takes no splash', () => {
    // Firer is 0.5 cells from explosion — inside splash radius but still immune
    const halfCell = CELL_SIZE / 2;
    const attacker = entityAtPos(UnitType.I_E2, House.Spain, 200, 200);
    const target = entityAtPos(UnitType.I_E1, House.USSR, 200 + halfCell, 200);
    const ctx = makeCombatCtx([attacker, target]);

    const attackerHpBefore = attacker.hp;

    // Splash centered on target, attacker is 0.5 cells away
    applySplashDamage(
      ctx,
      target.pos,
      { damage: 100, warhead: 'HE', splash: 1.5 },
      target.id,
      House.Spain,
      attacker,
    );

    expect(attacker.hp).toBe(attackerHpBefore);
  });

  it('entities at various distances within splash radius all take damage', () => {
    // Test that splash applies at multiple distances (not just adjacent cells)
    const attacker = entityAtCell(UnitType.I_E2, House.Spain, 0, 0); // far from explosion
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };

    // Place entities at ~0, ~0.5, ~1.0, ~1.4 cells from center
    const atCenter = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);        // 0 cells
    const halfCell = entityAtPos(UnitType.I_E1, House.USSR, center.x + CELL_SIZE / 2, center.y); // 0.5 cells
    const oneCell = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);          // 1 cell
    const ctx = makeCombatCtx([attacker, atCenter, halfCell, oneCell]);

    const hpBefore = [atCenter.hp, halfCell.hp, oneCell.hp];

    applySplashDamage(
      ctx, center,
      { damage: 100, warhead: 'HE', splash: 1.5 },
      -1,
      House.Spain,
      attacker,
    );

    // All entities within 1.5-cell radius should take damage
    expect(atCenter.hp).toBeLessThan(hpBefore[0]);
    expect(halfCell.hp).toBeLessThan(hpBefore[1]);
    expect(oneCell.hp).toBeLessThan(hpBefore[2]);

    // Closer entities take more damage (C++ inverse-proportional falloff)
    const dmgAtCenter = hpBefore[0] - atCenter.hp;
    const dmgHalfCell = hpBefore[1] - halfCell.hp;
    const dmgOneCell = hpBefore[2] - oneCell.hp;
    expect(dmgAtCenter).toBeGreaterThanOrEqual(dmgHalfCell);
    expect(dmgHalfCell).toBeGreaterThanOrEqual(dmgOneCell);
  });

  it('entity outside splash radius takes no damage regardless of firer position', () => {
    const attacker = entityAtCell(UnitType.I_E2, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const farAway = entityAtCell(UnitType.I_E1, House.USSR, 15, 15); // ~5.7 cells away
    const ctx = makeCombatCtx([attacker, target, farAway]);

    const farHpBefore = farAway.hp;

    applySplashDamage(
      ctx, target.pos,
      { damage: 100, warhead: 'HE', splash: 1.5 },
      target.id,
      House.Spain,
      attacker,
    );

    // Entity outside 1.5-cell radius takes no damage
    expect(farAway.hp).toBe(farHpBefore);
  });

  it('when no attacker is provided, no entity is excluded from splash', () => {
    // If attacker is undefined, sourceId defaults to -1, so no one is excluded
    const target = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const bystander = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([target, bystander]);

    const targetHpBefore = target.hp;
    const bystanderHpBefore = bystander.hp;

    applySplashDamage(
      ctx, target.pos,
      { damage: 100, warhead: 'HE', splash: 1.5 },
      target.id,
      House.Spain,
      undefined, // no attacker
    );

    // Both should take splash damage — no entity is excluded
    expect(target.hp).toBeLessThan(targetHpBefore);
    expect(bystander.hp).toBeLessThan(bystanderHpBefore);
  });

  it('friendly units of the firer take splash damage (C++ has no alliance check)', () => {
    // C++ Explosion_Damage applies to everyone except source — no friend check
    const attacker = entityAtCell(UnitType.I_E2, House.Spain, 10, 10);
    const friendlyUnit = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([attacker, friendlyUnit]);

    const friendlyHpBefore = friendlyUnit.hp;

    applySplashDamage(
      ctx, friendlyUnit.pos,
      { damage: 100, warhead: 'HE', splash: 1.5 },
      -1,
      House.Spain,
      attacker,
    );

    // Friendly units take splash damage (no alliance exclusion in C++)
    expect(friendlyUnit.hp).toBeLessThan(friendlyHpBefore);
  });

  it('all three roles: firer excluded, target hit, bystander hit (full scenario)', () => {
    // Complete scenario verifying all three roles simultaneously
    const attacker = entityAtCell(UnitType.I_E2, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const bystander = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([attacker, target, bystander]);

    const attackerHpBefore = attacker.hp;
    const targetHpBefore = target.hp;
    const bystanderHpBefore = bystander.hp;

    applySplashDamage(
      ctx, target.pos,
      { damage: 100, warhead: 'HE', splash: 1.5 },
      target.id,
      House.Spain,
      attacker,
    );

    // Firer excluded (combat.cpp:207)
    expect(attacker.hp).toBe(attackerHpBefore);
    // Target takes splash (only source is excluded, not target)
    expect(target.hp).toBeLessThan(targetHpBefore);
    // Bystander takes splash (within radius)
    expect(bystander.hp).toBeLessThan(bystanderHpBefore);
  });

  it('dead entities are not hit by splash', () => {
    const attacker = entityAtCell(UnitType.I_E2, House.Spain, 10, 10);
    const deadUnit = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    deadUnit.alive = false;
    deadUnit.hp = 0;
    const ctx = makeCombatCtx([attacker, deadUnit]);

    applySplashDamage(
      ctx, deadUnit.pos,
      { damage: 100, warhead: 'HE', splash: 1.5 },
      -1,
      House.Spain,
      attacker,
    );

    // Dead units are skipped (combat.ts checks !other.alive)
    expect(deadUnit.hp).toBe(0);
  });
});
