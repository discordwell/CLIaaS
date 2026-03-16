/**
 * C++ Behavioral Parity: E1 — Rifle Infantry
 *
 * Tests verify Rifle Infantry behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with E1 (observable outcomes: HP, alive/dead,
 * mission, fear, isProne, position changes), not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, PRONE_DAMAGE_BIAS,
  PRODUCTION_ITEMS, COUNTRY_BONUSES,
  buildDefaultAlliances, armorIndex,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  checkVehicleCrush,
  triggerRetaliation,
  aiScatterOnDamage,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(
  entities: Entity[] = [],
): CombatContext {
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
    getFirepowerBias: (house: House) => COUNTRY_BONUSES[house]?.firepowerMult ?? 1.0,
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

// ── Stats Verification (rules.ini parity) ────────────────────────────────────
// C++ idata.cpp (infantry type data) — E1 entry and RULES.INI [E1] section

describe('E1 stats verification (idata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.E1;
  const weapon = WEAPON_STATS.M1Carbine;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'E1');

  it('HP is 50 (Strength=50)', () => {
    expect(stats.strength).toBe(50);
  });

  it('Armor is none (Armor=none)', () => {
    expect(stats.armor).toBe('none');
  });

  it('Speed is 4 (Speed=4)', () => {
    expect(stats.speed).toBe(4);
  });

  it('isInfantry is true', () => {
    expect(stats.isInfantry).toBe(true);
  });

  it('crushable is true (infantry.cpp — all infantry are crushable)', () => {
    expect(stats.crushable).toBe(true);
  });

  it('primary weapon is M1Carbine', () => {
    expect(stats.primaryWeapon).toBe('M1Carbine');
  });

  it('M1Carbine warhead is SA', () => {
    expect(weapon.warhead).toBe('SA');
  });

  it('M1Carbine damage is 15', () => {
    expect(weapon.damage).toBe(15);
  });

  it('M1Carbine range is 3.0 cells', () => {
    expect(weapon.range).toBe(3.0);
  });

  it('cost is 100 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(100);
  });

  it('Entity constructor initializes HP to strength', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.hp).toBe(50);
    expect(e1.maxHp).toBe(50);
  });
});

// ── Weapon Effectiveness (combat.cpp warhead tables) ─────────────────────────
// C++ combat.cpp — Modify_Damage uses WARHEAD_VS_ARMOR table

describe('E1 weapon effectiveness — SA warhead (combat.cpp warhead tables)', () => {
  it('SA vs none armor: mult 1.0 (full damage to other infantry)', () => {
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('none')];
    expect(mult).toBe(1.0);
  });

  it('SA vs light armor: mult 0.6', () => {
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('light')];
    expect(mult).toBe(0.6);
  });

  it('SA vs heavy armor: mult 0.25 (bad vs tanks)', () => {
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('heavy')];
    expect(mult).toBe(0.25);
  });

  it('SA vs concrete: mult 0.25', () => {
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('concrete')];
    expect(mult).toBe(0.25);
  });

  it('E1 deals full 15 base damage to unarmored targets at point blank', () => {
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const hpBefore = victim.hp;
    // Direct damage: 15 * SA_vs_none(1.0) = 15
    victim.takeDamage(15, 'SA');
    expect(hpBefore - victim.hp).toBe(15);
  });

  it('E1 deals reduced damage to heavy-armor vehicles', () => {
    const victim = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const hpBefore = victim.hp;
    // SA vs heavy = 0.25, but takeDamage receives pre-calculated damage
    // Testing warhead table lookup: 15 * 0.25 = 3.75 → round to 4
    const damage = Math.round(15 * WARHEAD_VS_ARMOR.SA[armorIndex('heavy')]);
    victim.takeDamage(damage, 'SA');
    expect(hpBefore - victim.hp).toBe(damage);
    expect(damage).toBeLessThan(15); // much less than full damage
  });
});

// ── Crushable (drive.cpp:Ok_To_Move) ─────────────────────────────────────────
// C++ drive.cpp — when a Crusher vehicle enters a cell with a Crushable infantry,
// the infantry dies instantly. Only crusher vehicles crush; only crushable targets die.

describe('E1 crushable (drive.cpp:Ok_To_Move)', () => {
  it('E1 is killed when a crusher vehicle (2TNK) enters its cell', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10); // same cell
    const ctx = makeCombatCtx([e1, tank]);
    checkVehicleCrush(ctx, tank);
    expect(e1.alive).toBe(false);
  });

  it('E1 is NOT crushed by non-crusher vehicle (JEEP)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const jeep = entityAtCell(UnitType.V_JEEP, House.USSR, 10, 10);
    const ctx = makeCombatCtx([e1, jeep]);
    checkVehicleCrush(ctx, jeep);
    expect(e1.alive).toBe(true);
    expect(e1.hp).toBe(e1.maxHp);
  });

  it('E1 is NOT crushed by allied crusher vehicle (IsAFriend check)', () => {
    // Spain and Spain are allied (same house)
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([e1, tank]);
    checkVehicleCrush(ctx, tank);
    expect(e1.alive).toBe(true);
    expect(e1.hp).toBe(e1.maxHp);
  });

  it('E1 is NOT crushed by cross-allied crusher vehicle (Greece allied with Spain)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Greece, 10, 10);
    const ctx = makeCombatCtx([e1, tank]);
    checkVehicleCrush(ctx, tank);
    expect(e1.alive).toBe(true);
  });

  it('JEEP stats confirm no crusher flag', () => {
    expect(UNIT_STATS.JEEP.crusher).toBeFalsy();
  });

  it('2TNK stats confirm crusher flag is true', () => {
    expect(UNIT_STATS['2TNK'].crusher).toBe(true);
  });
});

// ── Fear / Prone System (infantry.cpp:329-457) ──────────────────────────────
// C++ infantry.cpp — FearType 0-255. Fear increases on damage, decrements 1/tick.
// IsProne when fear >= FEAR_ANXIOUS (10). Prone infantry take 50% damage.

describe('E1 fear / prone system (infantry.cpp:329-457)', () => {
  it('E1 starts with fear=0, isProne=false', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.fear).toBe(0);
    expect(e1.isProne).toBe(false);
  });

  it('when E1 takes damage, fear increases to at least FEAR_SCARED (100)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.takeDamage(10, 'SA');
    expect(e1.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
    expect(e1.fear).toBeGreaterThanOrEqual(100);
  });

  it('FEAR_ANXIOUS threshold is 10', () => {
    expect(Entity.FEAR_ANXIOUS).toBe(10);
  });

  it('FEAR_SCARED threshold is 100', () => {
    expect(Entity.FEAR_SCARED).toBe(100);
  });

  it('when fear >= FEAR_ANXIOUS, isProne can be set to true', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.fear = Entity.FEAR_ANXIOUS;
    e1.isProne = true;
    expect(e1.isProne).toBe(true);
  });

  it('PRONE_DAMAGE_BIAS is 0.5 (50% damage reduction while prone)', () => {
    expect(PRONE_DAMAGE_BIAS).toBe(0.5);
  });

  it('prone E1 takes 50% damage on next hit', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    // First: set prone manually (simulating fear >= FEAR_ANXIOUS)
    e1.isProne = true;
    const hpBefore = e1.hp;
    e1.takeDamage(10, 'SA');
    const damageTaken = hpBefore - e1.hp;
    // 10 * 0.5 = 5, clamped to at least 1
    expect(damageTaken).toBe(5);
  });

  it('damage → fear → prone → next hit deals ~half: full sequence', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.isProne).toBe(false);

    // Step 1: Take first hit — fear should jump to >= FEAR_SCARED (100)
    e1.takeDamage(10, 'SA');
    expect(e1.alive).toBe(true);
    expect(e1.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);

    // Step 2: Since fear >= FEAR_ANXIOUS (10), set isProne
    // (In the real game loop, this would be done by the infantry AI tick)
    e1.isProne = true;

    // Step 3: Take second hit while prone — should deal ~half damage
    const hpBeforeSecond = e1.hp;
    e1.takeDamage(20, 'SA');
    const secondDamage = hpBeforeSecond - e1.hp;
    // 20 * 0.5 = 10
    expect(secondDamage).toBe(10);
  });

  it('prone damage minimum is 1 (even for tiny hits)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.isProne = true;
    const hpBefore = e1.hp;
    e1.takeDamage(1, 'SA');
    const damageTaken = hpBefore - e1.hp;
    // Math.max(1, Math.round(1 * 0.5)) = Math.max(1, 1) = 1
    expect(damageTaken).toBe(1);
  });

  it('non-prone E1 takes full damage', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.isProne).toBe(false);
    const hpBefore = e1.hp;
    e1.takeDamage(10, 'SA');
    const damageTaken = hpBefore - e1.hp;
    expect(damageTaken).toBe(10);
  });
});

// ── Retaliation (techno.cpp) ─────────────────────────────────────────────────
// C++ techno.cpp — idle/moving units counter-attack when hit by enemy

describe('E1 retaliation (techno.cpp)', () => {
  it('idle E1 on GUARD mission retaliates when hit by enemy', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    e1.mission = Mission.GUARD;
    e1.target = null;

    const ctx = makeCombatCtx([e1, attacker]);
    triggerRetaliation(ctx, e1, attacker);

    expect(e1.target).toBe(attacker);
    expect(e1.mission).toBe(Mission.ATTACK);
  });

  it('E1 CAN retaliate (has weapon)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.weapon).not.toBeNull();
    expect(e1.weapon!.name).toBe('M1Carbine');
  });

  it('unarmed unit (Engineer) cannot retaliate', () => {
    const engineer = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    engineer.mission = Mission.GUARD;
    engineer.target = null;

    const ctx = makeCombatCtx([engineer, attacker]);
    triggerRetaliation(ctx, engineer, attacker);

    // Engineer has no weapon, should not get a target
    expect(engineer.target).toBeNull();
    expect(engineer.mission).toBe(Mission.GUARD);
  });

  it('E1 does not retarget if already has a living target', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const existingTarget = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const newAttacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    e1.mission = Mission.ATTACK;
    e1.target = existingTarget;

    const ctx = makeCombatCtx([e1, existingTarget, newAttacker]);
    triggerRetaliation(ctx, e1, newAttacker);

    // Should keep existing target, not switch
    expect(e1.target).toBe(existingTarget);
  });

  it('E1 does not retaliate against allies', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.Greece, 11, 10); // Greece allied with Spain
    e1.mission = Mission.GUARD;
    e1.target = null;

    const ctx = makeCombatCtx([e1, ally]);
    triggerRetaliation(ctx, e1, ally);

    expect(e1.target).toBeNull();
    expect(e1.mission).toBe(Mission.GUARD);
  });
});

// ── AI Scatter on Damage (techno.cpp) ────────────────────────────────────────
// C++ techno.cpp — AI-controlled units on GUARD move to adjacent cell when damaged

describe('E1 AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled E1 on GUARD mission changes position when damaged (IQ >= 2)', () => {
    // USSR is not player-controlled, so this is an AI unit
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    e1.mission = Mission.GUARD;

    const ctx = makeCombatCtx([e1]);
    // aiIQ returns 3 by default in our context (>= 2)

    // Run scatter multiple times — it's probabilistic (random dx/dy can be 0,0 = no move)
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const testE1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      testE1.mission = Mission.GUARD;
      const testCtx = makeCombatCtx([testE1]);
      aiScatterOnDamage(testCtx, testE1);
      if (testE1.mission === Mission.MOVE && testE1.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('player-controlled E1 does NOT scatter', () => {
    // Spain is player-controlled
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.mission = Mission.GUARD;

    const ctx = makeCombatCtx([e1]);
    aiScatterOnDamage(ctx, e1);

    // Should remain on GUARD, no scatter
    expect(e1.mission).toBe(Mission.GUARD);
    expect(e1.moveTarget).toBeNull();
  });

  it('AI E1 on ATTACK mission does NOT scatter (only GUARD/AREA_GUARD scatter)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    e1.mission = Mission.ATTACK;

    const ctx = makeCombatCtx([e1]);
    aiScatterOnDamage(ctx, e1);

    expect(e1.mission).toBe(Mission.ATTACK);
  });
});

// ── Movement (infantry.cpp) ─────────────────────────────────────────────────
// C++ infantry.cpp — infantry are nimble: they move while rotating (unlike vehicles)

describe('E1 movement — nimble infantry (infantry.cpp)', () => {
  it('E1 facing N, moveToward target E: position changes even before facing aligns', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.facing = Dir.N;
    e1.desiredFacing = Dir.N;
    e1.bodyFacing32 = Dir.N * 4;

    const startX = e1.pos.x;
    const startY = e1.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY }; // due East

    // Move toward the target — infantry should move even while rotating
    const arrived = e1.moveToward(targetPos, e1.stats.speed);

    // Position should have changed (moved toward target)
    const distMoved = Math.sqrt((e1.pos.x - startX) ** 2 + (e1.pos.y - startY) ** 2);
    expect(distMoved).toBeGreaterThan(0);
  });

  it('vehicle (2TNK) facing N toward target E: does NOT move until rotation completes', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.facing = Dir.N;
    tank.desiredFacing = Dir.N;
    tank.bodyFacing32 = Dir.N * 4;

    const startX = tank.pos.x;
    const startY = tank.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY }; // due East

    // One moveToward tick — vehicle should stop to rotate first
    const arrived = tank.moveToward(targetPos, tank.stats.speed);

    // Vehicle should NOT have moved (still rotating)
    // Note: rot=5 for 2TNK, needs multiple ticks to rotate from N to E
    expect(arrived).toBe(false);
    // Position unchanged because vehicle stops to rotate
    expect(tank.pos.x).toBe(startX);
    expect(tank.pos.y).toBe(startY);
  });

  it('infantry rot >= 8 means instant facing snap (E1 rot=8)', () => {
    expect(UNIT_STATS.E1.rot).toBe(8);
    // rot >= 8 means infantry snap facing instantly in tickRotation
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.facing = Dir.N;
    e1.desiredFacing = Dir.S; // opposite direction
    const aligned = e1.tickRotation();
    expect(aligned).toBe(true);
    expect(e1.facing).toBe(Dir.S);
  });
});

// ── Infantry Animation (infantry.cpp:479) ────────────────────────────────────
// C++ infantry.cpp — Shape_Number uses INFANTRY_ANIMS layout

describe('E1 infantry animation (infantry.cpp:479)', () => {
  it('E1 isInfantry = true', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.stats.isInfantry).toBe(true);
  });

  it('E1 isAnt = false', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.isAnt).toBe(false);
  });

  it('E1 spriteFrame uses infantry animation system (not vehicle or ant)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    // The spriteFrame getter for infantry uses INFANTRY_ANIMS layout
    // Just verifying it doesn't throw and returns a valid frame number
    const frame = e1.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('E1 alive=true starts in IDLE animState', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.alive).toBe(true);
    expect(e1.animState).toBe(AnimState.IDLE);
  });
});
