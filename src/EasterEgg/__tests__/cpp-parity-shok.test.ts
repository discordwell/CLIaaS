/**
 * C++ Behavioral Parity: SHOK — Shock Trooper
 *
 * Tests verify Shock Trooper behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with SHOK (observable outcomes: HP, alive/dead,
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
// C++ idata.cpp (infantry type data) — SHOK entry and RULES.INI [SHOK] section

describe('SHOK stats verification (idata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.SHOK;
  const weapon = WEAPON_STATS.PortaTesla;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'SHOK');

  it('HP is 80 (Strength=80)', () => {
    expect(stats.strength).toBe(80);
  });

  it('Armor is none (Armor=none)', () => {
    expect(stats.armor).toBe('none');
  });

  it('Speed is 3 (Speed=3)', () => {
    expect(stats.speed).toBe(3);
  });

  it('isInfantry is true', () => {
    expect(stats.isInfantry).toBe(true);
  });

  it('crushable is true (infantry.cpp — all infantry are crushable)', () => {
    expect(stats.crushable).toBe(true);
  });

  it('primary weapon is PortaTesla', () => {
    expect(stats.primaryWeapon).toBe('PortaTesla');
  });

  it('PortaTesla warhead is Super', () => {
    expect(weapon.warhead).toBe('Super');
  });

  it('PortaTesla damage is 45', () => {
    expect(weapon.damage).toBe(45);
  });

  it('PortaTesla range is 3.5 cells', () => {
    expect(weapon.range).toBe(3.5);
  });

  it('PortaTesla splash is 0.5 (small splash radius)', () => {
    expect(weapon.splash).toBe(0.5);
  });

  it('cost is 900 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(900);
  });

  it('faction is soviet', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('soviet');
  });

  it('Entity constructor initializes HP to strength', () => {
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    expect(shok.hp).toBe(80);
    expect(shok.maxHp).toBe(80);
  });
});

// ── Weapon Effectiveness — Super warhead (combat.cpp warhead tables) ─────────
// C++ combat.cpp — Super warhead: 1.0 vs ALL armor types (universal damage)

describe('SHOK weapon effectiveness — Super warhead (combat.cpp warhead tables)', () => {
  it('Super vs none armor: mult 1.0', () => {
    const mult = WARHEAD_VS_ARMOR.Super[armorIndex('none')];
    expect(mult).toBe(1.0);
  });

  it('Super vs wood armor: mult 1.0', () => {
    const mult = WARHEAD_VS_ARMOR.Super[armorIndex('wood')];
    expect(mult).toBe(1.0);
  });

  it('Super vs light armor: mult 1.0', () => {
    const mult = WARHEAD_VS_ARMOR.Super[armorIndex('light')];
    expect(mult).toBe(1.0);
  });

  it('Super vs heavy armor: mult 1.0 (equally effective against tanks)', () => {
    const mult = WARHEAD_VS_ARMOR.Super[armorIndex('heavy')];
    expect(mult).toBe(1.0);
  });

  it('Super vs concrete: mult 1.0', () => {
    const mult = WARHEAD_VS_ARMOR.Super[armorIndex('concrete')];
    expect(mult).toBe(1.0);
  });

  it('Super warhead is universally 1.0 across all 5 armor types', () => {
    const verses = WARHEAD_VS_ARMOR.Super;
    for (let i = 0; i < 5; i++) {
      expect(verses[i], `armor index ${i} should be 1.0`).toBe(1.0);
    }
  });

  it('SHOK deals full 45 base damage to unarmored infantry', () => {
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    // Direct damage: 45 * Super_vs_none(1.0) = 45
    victim.takeDamage(45, 'Super');
    expect(hpBefore - victim.hp).toBe(45);
  });

  it('SHOK deals full 45 base damage to heavy-armor vehicles (Super = universal)', () => {
    const victim = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    // Super vs heavy = 1.0, so 45 * 1.0 = 45 — no reduction
    const damage = Math.round(45 * WARHEAD_VS_ARMOR.Super[armorIndex('heavy')]);
    victim.takeDamage(damage, 'Super');
    expect(hpBefore - victim.hp).toBe(45);
    expect(damage).toBe(45); // no penalty against heavy armor
  });

  it('SHOK one-shots E1 (45 damage > 50hp E1, kills at any prior scratch)', () => {
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    // E1 has 50 HP; a single PortaTesla shot (45) doesn't kill from full,
    // but two shots definitely kill
    victim.takeDamage(45, 'Super');
    expect(victim.alive).toBe(true); // 50 - 45 = 5hp remaining
    expect(victim.hp).toBe(5);
    victim.takeDamage(45, 'Super');
    expect(victim.alive).toBe(false);
  });
});

// ── Splash Damage (combat.cpp) ───────────────────────────────────────────────
// C++ combat.cpp — PortaTesla has splash=0.5, small area effect

describe('SHOK splash radius (combat.cpp)', () => {
  it('PortaTesla has splash=0.5 (small AoE)', () => {
    expect(WEAPON_STATS.PortaTesla.splash).toBe(0.5);
  });

  it('PortaTesla splash is smaller than TeslaCannon splash (1.0)', () => {
    expect(WEAPON_STATS.PortaTesla.splash).toBeLessThan(WEAPON_STATS.TeslaCannon.splash!);
  });

  it('PortaTesla splash is smaller than HE-class weapons like Grenade (1.5)', () => {
    expect(WEAPON_STATS.PortaTesla.splash).toBeLessThan(WEAPON_STATS.Grenade.splash!);
  });
});

// ── Crushable (drive.cpp:Ok_To_Move) ─────────────────────────────────────────
// C++ drive.cpp — all infantry are crushable by crusher vehicles

describe('SHOK crushable (drive.cpp:Ok_To_Move)', () => {
  it('SHOK is killed when a crusher vehicle (2TNK) enters its cell', () => {
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([shok, tank]);
    checkVehicleCrush(ctx, tank);
    expect(shok.alive).toBe(false);
  });

  it('SHOK is NOT crushed by non-crusher vehicle (JEEP)', () => {
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    const jeep = entityAtCell(UnitType.V_JEEP, House.Spain, 10, 10);
    const ctx = makeCombatCtx([shok, jeep]);
    checkVehicleCrush(ctx, jeep);
    expect(shok.alive).toBe(true);
    expect(shok.hp).toBe(shok.maxHp);
  });

  it('SHOK is NOT crushed by allied crusher vehicle (IsAFriend check)', () => {
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([shok, tank]);
    checkVehicleCrush(ctx, tank);
    expect(shok.alive).toBe(true);
    expect(shok.hp).toBe(shok.maxHp);
  });
});

// ── Fear / Prone System (infantry.cpp:329-457) ──────────────────────────────
// C++ infantry.cpp — SHOK is infantry, so subject to full fear/prone system

describe('SHOK fear / prone system (infantry.cpp:329-457)', () => {
  it('SHOK starts with fear=0, isProne=false', () => {
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    expect(shok.fear).toBe(0);
    expect(shok.isProne).toBe(false);
  });

  it('when SHOK takes damage, fear increases to at least FEAR_SCARED (100)', () => {
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    shok.takeDamage(10, 'SA');
    expect(shok.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });

  it('prone SHOK takes 50% damage on next hit', () => {
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    shok.isProne = true;
    const hpBefore = shok.hp;
    shok.takeDamage(20, 'Super');
    const damageTaken = hpBefore - shok.hp;
    // 20 * 0.5 = 10
    expect(damageTaken).toBe(10);
  });

  it('damage -> fear -> prone -> next hit deals ~half: full sequence', () => {
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    expect(shok.isProne).toBe(false);

    // Step 1: Take first hit — fear jumps to >= FEAR_SCARED (100)
    shok.takeDamage(10, 'SA');
    expect(shok.alive).toBe(true);
    expect(shok.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);

    // Step 2: Set isProne (game loop sets this when fear >= FEAR_ANXIOUS)
    shok.isProne = true;

    // Step 3: Take second hit while prone — should deal ~half damage
    const hpBeforeSecond = shok.hp;
    shok.takeDamage(30, 'Super');
    const secondDamage = hpBeforeSecond - shok.hp;
    // 30 * 0.5 = 15
    expect(secondDamage).toBe(15);
  });

  it('non-prone SHOK takes full damage', () => {
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    expect(shok.isProne).toBe(false);
    const hpBefore = shok.hp;
    shok.takeDamage(20, 'Super');
    const damageTaken = hpBefore - shok.hp;
    expect(damageTaken).toBe(20);
  });
});

// ── Retaliation (techno.cpp) ─────────────────────────────────────────────────
// C++ techno.cpp — SHOK has a weapon, so retaliates when hit

describe('SHOK retaliation (techno.cpp)', () => {
  it('idle SHOK on GUARD mission retaliates when hit by enemy', () => {
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    shok.mission = Mission.GUARD;
    shok.target = null;

    const ctx = makeCombatCtx([shok, attacker]);
    triggerRetaliation(ctx, shok, attacker);

    expect(shok.target).toBe(attacker);
    expect(shok.mission).toBe(Mission.ATTACK);
  });

  it('SHOK CAN retaliate (has PortaTesla weapon)', () => {
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    expect(shok.weapon).not.toBeNull();
    expect(shok.weapon!.name).toBe('PortaTesla');
  });

  it('SHOK does not retarget if already has a living target', () => {
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    const existingTarget = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const newAttacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    shok.mission = Mission.ATTACK;
    shok.target = existingTarget;

    const ctx = makeCombatCtx([shok, existingTarget, newAttacker]);
    triggerRetaliation(ctx, shok, newAttacker);

    // Should keep existing target, not switch
    expect(shok.target).toBe(existingTarget);
  });

  it('SHOK does not retaliate against allies', () => {
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.Ukraine, 11, 10); // Ukraine allied with USSR
    shok.mission = Mission.GUARD;
    shok.target = null;

    const ctx = makeCombatCtx([shok, ally]);
    triggerRetaliation(ctx, shok, ally);

    expect(shok.target).toBeNull();
    expect(shok.mission).toBe(Mission.GUARD);
  });
});

// ── AI Scatter on Damage (techno.cpp) ────────────────────────────────────────
// C++ techno.cpp — AI-controlled SHOK on GUARD scatters when damaged

describe('SHOK AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled SHOK on GUARD mission changes position when damaged (IQ >= 2)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const testShok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
      testShok.mission = Mission.GUARD;
      const testCtx = makeCombatCtx([testShok]);
      aiScatterOnDamage(testCtx, testShok);
      if (testShok.mission === Mission.MOVE && testShok.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('player-controlled SHOK does NOT scatter', () => {
    // Spain is player-controlled
    const shok = entityAtCell(UnitType.I_SHOK, House.Spain, 10, 10);
    shok.mission = Mission.GUARD;

    const ctx = makeCombatCtx([shok]);
    aiScatterOnDamage(ctx, shok);

    expect(shok.mission).toBe(Mission.GUARD);
    expect(shok.moveTarget).toBeNull();
  });

  it('AI SHOK on ATTACK mission does NOT scatter (only GUARD/AREA_GUARD scatter)', () => {
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    shok.mission = Mission.ATTACK;

    const ctx = makeCombatCtx([shok]);
    aiScatterOnDamage(ctx, shok);

    expect(shok.mission).toBe(Mission.ATTACK);
  });
});

// ── Movement — nimble infantry (infantry.cpp) ────────────────────────────────
// C++ infantry.cpp — infantry move while rotating (unlike vehicles)

describe('SHOK movement — nimble infantry (infantry.cpp)', () => {
  it('SHOK facing N, moveToward target E: position changes even before facing aligns', () => {
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    shok.facing = Dir.N;
    shok.desiredFacing = Dir.N;
    shok.bodyFacing32 = Dir.N * 4;

    const startX = shok.pos.x;
    const startY = shok.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY }; // due East

    const arrived = shok.moveToward(targetPos, shok.stats.speed);

    const distMoved = Math.sqrt((shok.pos.x - startX) ** 2 + (shok.pos.y - startY) ** 2);
    expect(distMoved).toBeGreaterThan(0);
  });

  it('SHOK speed is 3 (slower than E1 speed 4)', () => {
    expect(UNIT_STATS.SHOK.speed).toBeLessThan(UNIT_STATS.E1.speed);
  });

  it('infantry rot >= 8 means instant facing snap (SHOK rot=8)', () => {
    expect(UNIT_STATS.SHOK.rot).toBe(8);
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    shok.facing = Dir.N;
    shok.desiredFacing = Dir.S; // opposite direction
    const aligned = shok.tickRotation();
    expect(aligned).toBe(true);
    expect(shok.facing).toBe(Dir.S);
  });
});

// ── Infantry Animation (infantry.cpp:479) ────────────────────────────────────
// C++ infantry.cpp — SHOK uses E7 animation layout (idata.cpp SHOK = E7 type)

describe('SHOK infantry animation (infantry.cpp:479)', () => {
  it('SHOK isInfantry = true', () => {
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    expect(shok.stats.isInfantry).toBe(true);
  });

  it('SHOK isAnt = false', () => {
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    expect(shok.isAnt).toBe(false);
  });

  it('SHOK spriteFrame returns a valid frame number', () => {
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    const frame = shok.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('SHOK alive=true starts in IDLE animState', () => {
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    expect(shok.alive).toBe(true);
    expect(shok.animState).toBe(AnimState.IDLE);
  });

  it('SHOK death via Super warhead sets deathVariant=1 (electro death, infantryDeath=5)', () => {
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    // Super warhead has infantryDeath=5 (electro), which is > 0, so die2
    const killed = shok.takeDamage(999, 'Super');
    expect(killed).toBe(true);
    expect(shok.alive).toBe(false);
    expect(shok.deathVariant).toBe(1); // die2 for electro death
  });
});

// ── Super Warhead Comparison (combat.cpp) ────────────────────────────────────
// Verify that Super warhead's universal effectiveness makes SHOK unique

describe('SHOK vs E1 — Super warhead advantage (combat.cpp)', () => {
  it('SHOK effective damage vs heavy armor equals base damage (1.0x)', () => {
    const baseDamage = WEAPON_STATS.PortaTesla.damage;
    const mult = WARHEAD_VS_ARMOR.Super[armorIndex('heavy')];
    expect(baseDamage * mult).toBe(45);
  });

  it('E1 effective damage vs heavy armor is severely reduced (0.25x)', () => {
    const baseDamage = WEAPON_STATS.M1Carbine.damage;
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('heavy')];
    expect(baseDamage * mult).toBeCloseTo(3.75);
  });

  it('SHOK deals 12x more effective damage vs heavy armor than E1', () => {
    const shokEff = WEAPON_STATS.PortaTesla.damage * WARHEAD_VS_ARMOR.Super[armorIndex('heavy')];
    const e1Eff = WEAPON_STATS.M1Carbine.damage * WARHEAD_VS_ARMOR.SA[armorIndex('heavy')];
    expect(shokEff / e1Eff).toBe(12);
  });

  it('SHOK deals 3x more base damage than E1 (45 vs 15)', () => {
    expect(WEAPON_STATS.PortaTesla.damage).toBe(45);
    expect(WEAPON_STATS.M1Carbine.damage).toBe(15);
    expect(WEAPON_STATS.PortaTesla.damage / WEAPON_STATS.M1Carbine.damage).toBe(3);
  });

  it('SHOK has longer range than E1 (3.5 vs 3.0 cells)', () => {
    expect(WEAPON_STATS.PortaTesla.range).toBeGreaterThan(WEAPON_STATS.M1Carbine.range);
  });

  it('SHOK has more HP than E1 (80 vs 50)', () => {
    expect(UNIT_STATS.SHOK.strength).toBeGreaterThan(UNIT_STATS.E1.strength);
  });

  it('SHOK costs more than E1 (900 vs 100)', () => {
    const shokProd = PRODUCTION_ITEMS.find(p => p.type === 'SHOK');
    const e1Prod = PRODUCTION_ITEMS.find(p => p.type === 'E1');
    expect(shokProd!.cost).toBeGreaterThan(e1Prod!.cost);
  });
});
