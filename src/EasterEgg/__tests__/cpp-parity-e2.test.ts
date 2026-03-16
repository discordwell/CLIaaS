/**
 * C++ Behavioral Parity: E2 — Grenadier
 *
 * Tests verify Grenadier behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with E2 (observable outcomes: HP, alive/dead,
 * mission, fear, isProne, weapon properties, splash), not HOW the code implements it.
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
// C++ idata.cpp (infantry type data) — E2 entry and RULES.INI [E2] section

describe('E2 stats verification (idata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.E2;
  const weapon = WEAPON_STATS.Grenade;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'E2');

  it('HP is 50 (Strength=50)', () => {
    expect(stats.strength).toBe(50);
  });

  it('Armor is none (Armor=none)', () => {
    expect(stats.armor).toBe('none');
  });

  it('Speed is 5 (Speed=5)', () => {
    expect(stats.speed).toBe(5);
  });

  it('isInfantry is true', () => {
    expect(stats.isInfantry).toBe(true);
  });

  it('crushable is true (infantry.cpp — all infantry are crushable)', () => {
    expect(stats.crushable).toBe(true);
  });

  it('primary weapon is Grenade', () => {
    expect(stats.primaryWeapon).toBe('Grenade');
  });

  it('cost is 160 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(160);
  });

  it('owner is soviet faction', () => {
    expect(stats.owner).toBe('soviet');
  });

  it('Entity constructor initializes HP to strength', () => {
    const e2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    expect(e2.hp).toBe(50);
    expect(e2.maxHp).toBe(50);
  });
});

// ── Weapon — Grenade (rules.ini / weapon.cpp) ──────────────────────────────────
// C++ weapon.cpp — Grenade weapon stats from RULES.INI [Grenade]

describe('E2 weapon — Grenade (rules.ini / weapon.cpp)', () => {
  const weapon = WEAPON_STATS.Grenade;

  it('Grenade warhead is HE (High Explosive)', () => {
    expect(weapon.warhead).toBe('HE');
  });

  it('Grenade damage is 50', () => {
    expect(weapon.damage).toBe(50);
  });

  it('Grenade range is 4.0 cells', () => {
    expect(weapon.range).toBe(4.0);
  });

  it('Grenade splash radius is 1.5 cells', () => {
    expect(weapon.splash).toBe(1.5);
  });

  it('Grenade inaccuracy is 0.5 cells', () => {
    expect(weapon.inaccuracy).toBe(0.5);
  });

  it('Grenade isArcing is true (lobbed projectile — bullet.cpp:359)', () => {
    expect(weapon.isArcing).toBe(true);
  });

  it('E2 entity resolves Grenade weapon from stats', () => {
    const e2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    expect(e2.weapon).not.toBeNull();
    expect(e2.weapon!.name).toBe('Grenade');
    expect(e2.weapon!.damage).toBe(50);
    expect(e2.weapon!.warhead).toBe('HE');
    expect(e2.weapon!.isArcing).toBe(true);
  });
});

// ── HE Warhead Effectiveness (combat.cpp warhead tables) ─────────────────────
// C++ combat.cpp — Modify_Damage uses WARHEAD_VS_ARMOR table
// HE = [0.9, 0.75, 0.6, 0.25, 1.0] → [none, wood, light, heavy, concrete]

describe('E2 weapon effectiveness — HE warhead (combat.cpp warhead tables)', () => {
  it('HE vs none armor: mult 0.9 (good vs infantry)', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('none')];
    expect(mult).toBe(0.9);
  });

  it('HE vs wood armor: mult 0.75', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('wood')];
    expect(mult).toBe(0.75);
  });

  it('HE vs light armor: mult 0.6', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('light')];
    expect(mult).toBe(0.6);
  });

  it('HE vs heavy armor: mult 0.25 (bad vs tanks)', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('heavy')];
    expect(mult).toBe(0.25);
  });

  it('HE vs concrete: mult 1.0 (great vs buildings)', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('concrete')];
    expect(mult).toBe(1.0);
  });

  it('E2 Grenade deals 45 base damage to unarmored targets (50 * 0.9)', () => {
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    // HE vs none = 0.9, so 50 * 0.9 = 45
    const damage = Math.round(50 * WARHEAD_VS_ARMOR.HE[armorIndex('none')]);
    victim.takeDamage(damage, 'HE');
    expect(hpBefore - victim.hp).toBe(45);
  });

  it('E2 Grenade deals reduced damage to heavy-armor vehicles (50 * 0.25 = 13)', () => {
    const victim = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    const damage = Math.round(50 * WARHEAD_VS_ARMOR.HE[armorIndex('heavy')]);
    victim.takeDamage(damage, 'HE');
    expect(hpBefore - victim.hp).toBe(damage);
    expect(damage).toBe(13); // 50 * 0.25 = 12.5 → round to 13
  });
});

// ── Splash Damage (combat.cpp Explosion_Damage) ─────────────────────────────
// C++ combat.cpp — Grenade has splash=1.5, damages nearby units in blast radius

describe('E2 splash damage — Grenade splash=1.5 (combat.cpp Explosion_Damage)', () => {
  it('Grenade weapon has splash property of 1.5 cells', () => {
    const weapon = WEAPON_STATS.Grenade;
    expect(weapon.splash).toBe(1.5);
  });

  it('SPLASH_RADIUS constant is 1.5 cells (C++ ICON_LEPTON_W + ICON_LEPTON_W/2)', () => {
    expect(SPLASH_RADIUS).toBe(1.5);
  });

  it('nearby entity within splash radius takes splash damage', () => {
    const attacker = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    const primaryTarget = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const bystander = entityAtCell(UnitType.I_E1, House.Spain, 11, 11); // adjacent cell = ~1 cell away
    const ctx = makeCombatCtx([attacker, primaryTarget, bystander]);

    const bystanderHpBefore = bystander.hp;
    applySplashDamage(
      ctx,
      primaryTarget.pos,
      { damage: 50, warhead: 'HE', splash: 1.5 },
      primaryTarget.id,
      House.USSR,
      attacker,
    );

    // Bystander is ~1 cell from explosion center (within 1.5 splash radius)
    // Should have taken some splash damage
    expect(bystander.hp).toBeLessThan(bystanderHpBefore);
  });

  it('entity far outside splash radius takes no damage', () => {
    const attacker = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    const primaryTarget = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const farAway = entityAtCell(UnitType.I_E1, House.Spain, 15, 15); // ~7 cells away
    const ctx = makeCombatCtx([attacker, primaryTarget, farAway]);

    const farHpBefore = farAway.hp;
    applySplashDamage(
      ctx,
      primaryTarget.pos,
      { damage: 50, warhead: 'HE', splash: 1.5 },
      primaryTarget.id,
      House.USSR,
      attacker,
    );

    expect(farAway.hp).toBe(farHpBefore); // no damage taken
  });

  it('splash damage hits friendly units too (C++ Explosion_Damage has no friend check)', () => {
    const attacker = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    const primaryTarget = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    // Friendly unit near the explosion
    const friendlyBystander = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([attacker, primaryTarget, friendlyBystander]);

    const friendlyHpBefore = friendlyBystander.hp;
    applySplashDamage(
      ctx,
      primaryTarget.pos,
      { damage: 50, warhead: 'HE', splash: 1.5 },
      primaryTarget.id,
      House.USSR,
      attacker,
    );

    // Friendly bystander should also take splash damage
    expect(friendlyBystander.hp).toBeLessThan(friendlyHpBefore);
  });
});

// ── Arcing Projectile (bullet.cpp:359) ────────────────────────────────────────
// C++ bullet.cpp:359 — arcing projectiles lob over obstacles, follow ballistic arc

describe('E2 arcing projectile (bullet.cpp:359)', () => {
  it('Grenade isArcing=true (lobbed trajectory)', () => {
    expect(WEAPON_STATS.Grenade.isArcing).toBe(true);
  });

  it('non-arcing weapons (M1Carbine) have isArcing undefined/false', () => {
    expect(WEAPON_STATS.M1Carbine.isArcing).toBeFalsy();
  });

  it('other arcing weapon (155mm artillery) also has isArcing=true', () => {
    expect(WEAPON_STATS['155mm'].isArcing).toBe(true);
  });

  it('E2 entity weapon has arcing flag set', () => {
    const e2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    expect(e2.weapon!.isArcing).toBe(true);
  });
});

// ── Inaccuracy (weapon.cpp scatter) ──────────────────────────────────────────
// C++ weapon.cpp — inaccuracy causes shots to scatter around the target

describe('E2 inaccuracy — Grenade scatter (weapon.cpp)', () => {
  it('Grenade inaccuracy is 0.5 cells', () => {
    expect(WEAPON_STATS.Grenade.inaccuracy).toBe(0.5);
  });

  it('precise weapons (M1Carbine) have no inaccuracy', () => {
    expect(WEAPON_STATS.M1Carbine.inaccuracy).toBeUndefined();
  });

  it('155mm artillery has larger inaccuracy (1.5) than Grenade (0.5)', () => {
    expect(WEAPON_STATS['155mm'].inaccuracy).toBe(1.5);
    expect(WEAPON_STATS.Grenade.inaccuracy!).toBeLessThan(WEAPON_STATS['155mm'].inaccuracy!);
  });
});

// ── Crushable (drive.cpp:Ok_To_Move) ─────────────────────────────────────────
// C++ drive.cpp — when a Crusher vehicle enters a cell with a Crushable infantry,
// the infantry dies instantly. Only crusher vehicles crush; only crushable targets die.

describe('E2 crushable (drive.cpp:Ok_To_Move)', () => {
  it('E2 is killed when a crusher vehicle (2TNK) enters its cell', () => {
    const e2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([e2, tank]);
    checkVehicleCrush(ctx, tank);
    expect(e2.alive).toBe(false);
  });

  it('E2 is NOT crushed by non-crusher vehicle (JEEP)', () => {
    const e2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    const jeep = entityAtCell(UnitType.V_JEEP, House.Spain, 10, 10);
    const ctx = makeCombatCtx([e2, jeep]);
    checkVehicleCrush(ctx, jeep);
    expect(e2.alive).toBe(true);
    expect(e2.hp).toBe(e2.maxHp);
  });

  it('E2 is NOT crushed by allied crusher vehicle (IsAFriend check)', () => {
    const e2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10); // same house
    const ctx = makeCombatCtx([e2, tank]);
    checkVehicleCrush(ctx, tank);
    expect(e2.alive).toBe(true);
    expect(e2.hp).toBe(e2.maxHp);
  });

  it('E2 crushable stat is true', () => {
    expect(UNIT_STATS.E2.crushable).toBe(true);
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

describe('E2 fear / prone system (infantry.cpp:329-457)', () => {
  it('E2 starts with fear=0, isProne=false', () => {
    const e2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    expect(e2.fear).toBe(0);
    expect(e2.isProne).toBe(false);
  });

  it('when E2 takes damage, fear increases to at least FEAR_SCARED (100)', () => {
    const e2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    e2.takeDamage(10, 'HE');
    expect(e2.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
    expect(e2.fear).toBeGreaterThanOrEqual(100);
  });

  it('PRONE_DAMAGE_BIAS is 0.5 (50% damage reduction while prone)', () => {
    expect(PRONE_DAMAGE_BIAS).toBe(0.5);
  });

  it('prone E2 takes 50% damage on next hit', () => {
    const e2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    e2.isProne = true;
    const hpBefore = e2.hp;
    e2.takeDamage(10, 'HE');
    const damageTaken = hpBefore - e2.hp;
    // 10 * 0.5 = 5, clamped to at least 1
    expect(damageTaken).toBe(5);
  });

  it('damage -> fear -> prone -> next hit deals ~half: full sequence', () => {
    const e2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    expect(e2.isProne).toBe(false);

    // Step 1: Take first hit — fear should jump to >= FEAR_SCARED (100)
    e2.takeDamage(10, 'HE');
    expect(e2.alive).toBe(true);
    expect(e2.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);

    // Step 2: Since fear >= FEAR_ANXIOUS (10), set isProne
    // (In the real game loop, this would be done by the infantry AI tick)
    e2.isProne = true;

    // Step 3: Take second hit while prone — should deal ~half damage
    const hpBeforeSecond = e2.hp;
    e2.takeDamage(20, 'HE');
    const secondDamage = hpBeforeSecond - e2.hp;
    // 20 * 0.5 = 10
    expect(secondDamage).toBe(10);
  });

  it('prone damage minimum is 1 (even for tiny hits)', () => {
    const e2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    e2.isProne = true;
    const hpBefore = e2.hp;
    e2.takeDamage(1, 'HE');
    const damageTaken = hpBefore - e2.hp;
    // Math.max(1, Math.round(1 * 0.5)) = Math.max(1, 1) = 1
    expect(damageTaken).toBe(1);
  });

  it('non-prone E2 takes full damage', () => {
    const e2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    expect(e2.isProne).toBe(false);
    const hpBefore = e2.hp;
    e2.takeDamage(10, 'HE');
    // Fear effect adds additional damage via fear increase, but direct damage is 10
    // However takeDamage always deducts the passed amount (before prone check)
    // Since not prone: full 10 damage
    const damageTaken = hpBefore - e2.hp;
    expect(damageTaken).toBe(10);
  });
});

// ── Retaliation (techno.cpp) ─────────────────────────────────────────────────
// C++ techno.cpp — idle/moving units counter-attack when hit by enemy

describe('E2 retaliation (techno.cpp)', () => {
  it('idle E2 on GUARD mission retaliates when hit by enemy', () => {
    const e2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    e2.mission = Mission.GUARD;
    e2.target = null;

    const ctx = makeCombatCtx([e2, attacker]);
    triggerRetaliation(ctx, e2, attacker);

    expect(e2.target).toBe(attacker);
    expect(e2.mission).toBe(Mission.ATTACK);
  });

  it('E2 CAN retaliate (has Grenade weapon)', () => {
    const e2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    expect(e2.weapon).not.toBeNull();
    expect(e2.weapon!.name).toBe('Grenade');
  });

  it('E2 does not retarget if already has a living target', () => {
    const e2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    const existingTarget = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const newAttacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    e2.mission = Mission.ATTACK;
    e2.target = existingTarget;

    const ctx = makeCombatCtx([e2, existingTarget, newAttacker]);
    triggerRetaliation(ctx, e2, newAttacker);

    // Should keep existing target, not switch
    expect(e2.target).toBe(existingTarget);
  });

  it('E2 does not retaliate against allies', () => {
    const e2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.Ukraine, 11, 10); // Ukraine allied with USSR
    e2.mission = Mission.GUARD;
    e2.target = null;

    const ctx = makeCombatCtx([e2, ally]);
    triggerRetaliation(ctx, e2, ally);

    expect(e2.target).toBeNull();
    expect(e2.mission).toBe(Mission.GUARD);
  });
});
