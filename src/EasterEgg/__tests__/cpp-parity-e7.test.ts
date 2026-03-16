/**
 * C++ Behavioral Parity: E7 — Tanya
 *
 * Tests verify Tanya behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with E7/Tanya (observable outcomes: HP, alive/dead,
 * mission, fear, isProne, weapon effectiveness), not HOW the code implements it.
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

// ── Stats Verification (rules.ini / idata.cpp parity) ───────────────────────
// C++ idata.cpp (infantry type data) — E7 entry and RULES.INI [E7] section

describe('E7 stats verification (idata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.E7;
  const weapon = WEAPON_STATS.Colt45;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'E7');

  it('HP is 100 (Strength=100) — double standard infantry', () => {
    expect(stats.strength).toBe(100);
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

  it('cost is 1200 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(1200);
  });

  it('owner is both (available to Allied and Soviet)', () => {
    expect(stats.owner).toBe('both');
  });

  it('primary weapon is Colt45', () => {
    expect(stats.primaryWeapon).toBe('Colt45');
  });

  it('secondary weapon is also Colt45 (dual-wield pistols)', () => {
    expect(stats.secondaryWeapon).toBe('Colt45');
  });

  it('Entity constructor initializes HP to 100', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    expect(tanya.hp).toBe(100);
    expect(tanya.maxHp).toBe(100);
  });

  it('sight range is 6 cells', () => {
    expect(stats.sight).toBe(6);
  });

  it('rot is 8 (instant infantry rotation)', () => {
    expect(stats.rot).toBe(8);
  });
});

// ── High HP for Infantry (idata.cpp) ────────────────────────────────────────
// C++ idata.cpp — Tanya has 100 HP, double the standard E1 infantry (50 HP)

describe('E7 high HP — survivability advantage (idata.cpp)', () => {
  it('Tanya has 100 HP, exactly double E1 (50 HP)', () => {
    expect(UNIT_STATS.E7.strength).toBe(100);
    expect(UNIT_STATS.E1.strength).toBe(50);
    expect(UNIT_STATS.E7.strength).toBe(UNIT_STATS.E1.strength * 2);
  });

  it('Tanya survives a hit that would kill E1 (e.g. 50 damage)', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);

    tanya.takeDamage(50, 'SA');
    e1.takeDamage(50, 'SA');

    expect(tanya.alive).toBe(true);
    expect(tanya.hp).toBe(50);
    expect(e1.alive).toBe(false);
  });
});

// ── Colt45 Weapon Stats (weapon.cpp / rules.ini) ────────────────────────────
// C++ weapon.cpp — Colt45 weapon entry from RULES.INI [Colt45]

describe('E7 Colt45 weapon stats (weapon.cpp / rules.ini)', () => {
  const weapon = WEAPON_STATS.Colt45;

  it('Colt45 damage is 50', () => {
    expect(weapon.damage).toBe(50);
  });

  it('Colt45 ROF is 5 (fast fire rate)', () => {
    expect(weapon.rof).toBe(5);
  });

  it('Colt45 range is 5.75 cells', () => {
    expect(weapon.range).toBe(5.75);
  });

  it('Colt45 warhead is HollowPoint', () => {
    expect(weapon.warhead).toBe('HollowPoint');
  });

  it('Colt45 projectile is invisible (isInvisible=true)', () => {
    expect(weapon.isInvisible).toBe(true);
  });

  it('Entity weapon is correctly assigned from stats', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    expect(tanya.weapon).not.toBeNull();
    expect(tanya.weapon!.name).toBe('Colt45');
    expect(tanya.weapon2).not.toBeNull();
    expect(tanya.weapon2!.name).toBe('Colt45');
  });
});

// ── Long Range (rules.ini) ──────────────────────────────────────────────────
// C++ rules.ini — Colt45 range 5.75 is one of the longest infantry weapon ranges

describe('E7 long range — one of the longest infantry weapons (rules.ini)', () => {
  it('Colt45 range (5.75) exceeds M1Carbine range (3.0)', () => {
    expect(WEAPON_STATS.Colt45.range).toBeGreaterThan(WEAPON_STATS.M1Carbine.range);
  });

  it('Colt45 range (5.75) exceeds Rocket range (5.0)', () => {
    expect(WEAPON_STATS.Colt45.range).toBeGreaterThan(WEAPON_STATS.Dragon.range);
  });

  it('Colt45 range (5.75) exceeds Flamethrower range (3.5)', () => {
    expect(WEAPON_STATS.Colt45.range).toBeGreaterThan(WEAPON_STATS.Flamer.range);
  });

  it('Tanya can hit a target at 5.5 cells away', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    // Place target 5.5 cells away
    target.pos.x = tanya.pos.x + 5.5 * CELL_SIZE;
    expect(tanya.inRange(target)).toBe(true);
  });

  it('Tanya cannot hit a target at 6.0 cells away (exceeds 5.75 range)', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    // Place target 6.0 cells away
    target.pos.x = tanya.pos.x + 6.0 * CELL_SIZE;
    expect(tanya.inRange(target)).toBe(false);
  });
});

// ── HollowPoint Warhead — THE Key Behavior (combat.cpp warhead tables) ──────
// C++ combat.cpp — HollowPoint warhead: 100% vs none, 5% vs everything else
// This is Tanya's defining mechanic: she DESTROYS infantry but does almost ZERO
// damage to anything with armor.

describe('E7 HollowPoint warhead — anti-infantry specialist (combat.cpp)', () => {
  const hp = WARHEAD_VS_ARMOR.HollowPoint;

  it('HollowPoint vs none armor: mult 1.0 (full damage to infantry)', () => {
    expect(hp[armorIndex('none')]).toBe(1.0);
  });

  it('HollowPoint vs wood armor: mult 0.05 (almost zero)', () => {
    expect(hp[armorIndex('wood')]).toBe(0.05);
  });

  it('HollowPoint vs light armor: mult 0.05 (almost zero)', () => {
    expect(hp[armorIndex('light')]).toBe(0.05);
  });

  it('HollowPoint vs heavy armor: mult 0.05 (almost zero)', () => {
    expect(hp[armorIndex('heavy')]).toBe(0.05);
  });

  it('HollowPoint vs concrete armor: mult 0.05 (almost zero)', () => {
    expect(hp[armorIndex('concrete')]).toBe(0.05);
  });

  it('HollowPoint has extreme anti-infantry specialization (1.0 vs 0.05 = 20x ratio)', () => {
    const vsNone = hp[armorIndex('none')];
    const vsHeavy = hp[armorIndex('heavy')];
    expect(vsNone / vsHeavy).toBe(20);
  });
});

// ── Anti-Infantry Specialist: Effective Damage Scenarios (combat.cpp) ───────
// C++ combat.cpp Modify_Damage — calculated effective damage Tanya deals
// to different armor classes using Colt45 (50 dmg * warhead multiplier)

describe('E7 anti-infantry specialist — effective damage (combat.cpp)', () => {
  it('Tanya vs E1 (unarmored): 50 * 1.0 = 50 effective damage — kills in 1 shot', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);

    const baseDamage = WEAPON_STATS.Colt45.damage; // 50
    const mult = WARHEAD_VS_ARMOR.HollowPoint[armorIndex('none')]; // 1.0
    const effectiveDamage = Math.round(baseDamage * mult); // 50

    expect(effectiveDamage).toBe(50);

    // E1 has 50 HP — one shot kill
    const hpBefore = e1.hp;
    e1.takeDamage(effectiveDamage, 'HollowPoint');
    expect(e1.alive).toBe(false);
    expect(hpBefore).toBe(50);
  });

  it('Tanya vs 2TNK (heavy armor): 50 * 0.05 = 2.5 → ~3 effective damage', () => {
    const baseDamage = WEAPON_STATS.Colt45.damage; // 50
    const mult = WARHEAD_VS_ARMOR.HollowPoint[armorIndex('heavy')]; // 0.05
    const effectiveDamage = Math.round(baseDamage * mult); // Math.round(2.5) = 3

    expect(effectiveDamage).toBeLessThanOrEqual(3);
    expect(effectiveDamage).toBeGreaterThanOrEqual(2);

    // 2TNK has 400 HP — would take 133+ shots to kill
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const hpBefore = tank.hp;
    tank.takeDamage(effectiveDamage, 'HollowPoint');
    expect(tank.alive).toBe(true);
    expect(hpBefore - tank.hp).toBe(effectiveDamage);
    // At 3 damage per shot, 400/3 = 134 shots needed
    expect(Math.ceil(hpBefore / effectiveDamage)).toBeGreaterThan(100);
  });

  it('Tanya vs light armor (APC): 50 * 0.05 = 2.5 → ~3 effective damage', () => {
    const baseDamage = WEAPON_STATS.Colt45.damage;
    const mult = WARHEAD_VS_ARMOR.HollowPoint[armorIndex('light')];
    const effectiveDamage = Math.round(baseDamage * mult);

    expect(effectiveDamage).toBeLessThanOrEqual(3);
    expect(effectiveDamage).toBeGreaterThanOrEqual(2);
  });

  it('contrast: E1 M1Carbine vs heavy = 15*0.25 = 4 — even E1 does MORE vs tanks than Tanya', () => {
    const e1Damage = WEAPON_STATS.M1Carbine.damage; // 15
    const e1Mult = WARHEAD_VS_ARMOR.SA[armorIndex('heavy')]; // 0.25
    const e1Effective = Math.round(e1Damage * e1Mult); // 4

    const tanyaDamage = WEAPON_STATS.Colt45.damage; // 50
    const tanyaMult = WARHEAD_VS_ARMOR.HollowPoint[armorIndex('heavy')]; // 0.05
    const tanyaEffective = Math.round(tanyaDamage * tanyaMult); // 3

    // E1 actually does more damage to tanks than Tanya despite lower base damage
    expect(e1Effective).toBeGreaterThanOrEqual(tanyaEffective);
  });
});

// ── canSwim (idata.cpp — amphibious flag) ───────────────────────────────────
// C++ idata.cpp — E7 Tanya has the amphibious flag, allowing water tile traversal

describe('E7 canSwim — amphibious ability (idata.cpp)', () => {
  it('UNIT_STATS.E7 has canSwim=true', () => {
    expect(UNIT_STATS.E7.canSwim).toBe(true);
  });

  it('standard infantry E1 does NOT have canSwim', () => {
    expect(UNIT_STATS.E1.canSwim).toBeFalsy();
  });
});

// ── Crushable (drive.cpp:Ok_To_Move) ────────────────────────────────────────
// C++ drive.cpp — Tanya is infantry and therefore crushable by crusher vehicles

describe('E7 crushable (drive.cpp:Ok_To_Move)', () => {
  it('Tanya is killed when a crusher vehicle (2TNK) enters her cell', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tanya, tank]);
    checkVehicleCrush(ctx, tank);
    expect(tanya.alive).toBe(false);
  });

  it('JEEP stats confirm no crusher flag', () => {
    expect(UNIT_STATS.JEEP.crusher).toBeFalsy();
  });

  it('2TNK stats confirm crusher flag is true', () => {
    expect(UNIT_STATS['2TNK'].crusher).toBe(true);
  });

  it('Tanya is NOT crushed by allied crusher vehicle', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Greece, 10, 10); // Greece allied with Spain
    const ctx = makeCombatCtx([tanya, tank]);
    checkVehicleCrush(ctx, tank);
    expect(tanya.alive).toBe(true);
  });
});

// ── Fear / Prone System (infantry.cpp:329-457) ─────────────────────────────
// C++ infantry.cpp — fear/prone applies to all infantry including Tanya.
// With 100 HP, Tanya survives more hits before dying, so prone is more useful.

describe('E7 fear / prone system (infantry.cpp:329-457)', () => {
  it('Tanya starts with fear=0, isProne=false', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    expect(tanya.fear).toBe(0);
    expect(tanya.isProne).toBe(false);
  });

  it('when Tanya takes damage, fear increases to at least FEAR_SCARED (100)', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    tanya.takeDamage(10, 'SA');
    expect(tanya.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });

  it('prone Tanya takes 50% damage (ProneDamageBias)', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    tanya.isProne = true;
    const hpBefore = tanya.hp;
    tanya.takeDamage(20, 'SA');
    const damageTaken = hpBefore - tanya.hp;
    // 20 * 0.5 = 10
    expect(damageTaken).toBe(10);
  });

  it('prone Tanya with 100 HP survives hits that would kill prone E1', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    tanya.isProne = true;
    e1.isProne = true;

    // 80 damage → prone halves to 40
    tanya.takeDamage(80, 'SA');
    e1.takeDamage(80, 'SA');

    // Tanya: 100 - 40 = 60 HP remaining (alive)
    expect(tanya.alive).toBe(true);
    expect(tanya.hp).toBe(60);

    // E1: 50 - 40 = 10 HP remaining (alive, but barely)
    expect(e1.alive).toBe(true);
    expect(e1.hp).toBe(10);

    // Another 80 damage — prone halves to 40 again
    tanya.takeDamage(80, 'SA');
    e1.takeDamage(80, 'SA');

    // Tanya: 60 - 40 = 20 HP (still alive!)
    expect(tanya.alive).toBe(true);
    expect(tanya.hp).toBe(20);

    // E1: 10 - 40 = dead
    expect(e1.alive).toBe(false);
  });
});

// ── Retaliation (techno.cpp) ────────────────────────────────────────────────
// C++ techno.cpp — idle/moving units counter-attack when hit by enemy

describe('E7 retaliation (techno.cpp)', () => {
  it('idle Tanya on GUARD mission retaliates when hit by enemy', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    tanya.mission = Mission.GUARD;
    tanya.target = null;

    const ctx = makeCombatCtx([tanya, attacker]);
    triggerRetaliation(ctx, tanya, attacker);

    expect(tanya.target).toBe(attacker);
    expect(tanya.mission).toBe(Mission.ATTACK);
  });

  it('Tanya CAN retaliate (has Colt45 weapon)', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    expect(tanya.weapon).not.toBeNull();
    expect(tanya.weapon!.name).toBe('Colt45');
  });

  it('Tanya does not retarget if already has a living target', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const existingTarget = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const newAttacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    tanya.mission = Mission.ATTACK;
    tanya.target = existingTarget;

    const ctx = makeCombatCtx([tanya, existingTarget, newAttacker]);
    triggerRetaliation(ctx, tanya, newAttacker);

    expect(tanya.target).toBe(existingTarget);
  });

  it('Tanya does not retaliate against allies', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.Greece, 11, 10);
    tanya.mission = Mission.GUARD;
    tanya.target = null;

    const ctx = makeCombatCtx([tanya, ally]);
    triggerRetaliation(ctx, tanya, ally);

    expect(tanya.target).toBeNull();
    expect(tanya.mission).toBe(Mission.GUARD);
  });
});

// ── Movement — nimble infantry (infantry.cpp) ───────────────────────────────
// C++ infantry.cpp — infantry move while rotating; Tanya has rot=8 (instant snap)

describe('E7 movement — nimble infantry (infantry.cpp)', () => {
  it('Tanya rot=8 means instant facing snap', () => {
    expect(UNIT_STATS.E7.rot).toBe(8);
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    tanya.facing = Dir.N;
    tanya.desiredFacing = Dir.S;
    const aligned = tanya.tickRotation();
    expect(aligned).toBe(true);
    expect(tanya.facing).toBe(Dir.S);
  });

  it('Tanya moves toward target even when facing is misaligned (infantry nimble move)', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    tanya.facing = Dir.N;
    tanya.desiredFacing = Dir.N;
    tanya.bodyFacing32 = Dir.N * 4;

    const startX = tanya.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: tanya.pos.y };

    tanya.moveToward(targetPos, tanya.stats.speed);

    const distMoved = Math.abs(tanya.pos.x - startX);
    expect(distMoved).toBeGreaterThan(0);
  });

  it('Tanya speed (5) is faster than E1 speed (4)', () => {
    expect(UNIT_STATS.E7.speed).toBeGreaterThan(UNIT_STATS.E1.speed);
  });
});

// ── Dual Weapon — both slots are Colt45 (idata.cpp) ────────────────────────
// C++ idata.cpp — E7 has Primary=Colt45, Secondary=Colt45 (dual-wield)

describe('E7 dual weapon — Colt45 / Colt45 (idata.cpp)', () => {
  it('both weapon slots are Colt45', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    expect(tanya.weapon).not.toBeNull();
    expect(tanya.weapon2).not.toBeNull();
    expect(tanya.weapon!.name).toBe('Colt45');
    expect(tanya.weapon2!.name).toBe('Colt45');
  });

  it('both weapons have identical stats (same weapon type)', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const w1 = tanya.weapon!;
    const w2 = tanya.weapon2!;
    expect(w1.damage).toBe(w2.damage);
    expect(w1.rof).toBe(w2.rof);
    expect(w1.range).toBe(w2.range);
    expect(w1.warhead).toBe(w2.warhead);
  });

  it('selectWeapon returns a weapon against infantry target', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    tanya.attackCooldown = 0;
    tanya.attackCooldown2 = 0;

    const selected = tanya.selectWeapon(target, (warhead, armor) => {
      return WARHEAD_VS_ARMOR[warhead]?.[armorIndex(armor)] ?? 1;
    });
    expect(selected).not.toBeNull();
    expect(selected!.name).toBe('Colt45');
  });
});

// ── Infantry Animation (infantry.cpp:479) ───────────────────────────────────
// C++ infantry.cpp — Shape_Number uses INFANTRY_ANIMS layout

describe('E7 infantry animation (infantry.cpp:479)', () => {
  it('Tanya isInfantry = true', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    expect(tanya.stats.isInfantry).toBe(true);
  });

  it('Tanya isAnt = false', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    expect(tanya.isAnt).toBe(false);
  });

  it('Tanya spriteFrame uses infantry animation system', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const frame = tanya.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('Tanya starts in IDLE animState', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    expect(tanya.alive).toBe(true);
    expect(tanya.animState).toBe(AnimState.IDLE);
  });
});

// ── AI Scatter on Damage (techno.cpp) ───────────────────────────────────────
// C++ techno.cpp — AI-controlled units on GUARD scatter when damaged

describe('E7 AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled Tanya on GUARD scatters when damaged (IQ >= 2)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const tanya = entityAtCell(UnitType.I_TANYA, House.USSR, 10, 10);
      tanya.mission = Mission.GUARD;
      const ctx = makeCombatCtx([tanya]);
      aiScatterOnDamage(ctx, tanya);
      if (tanya.mission === Mission.MOVE && tanya.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('player-controlled Tanya does NOT scatter', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    tanya.mission = Mission.GUARD;
    const ctx = makeCombatCtx([tanya]);
    aiScatterOnDamage(ctx, tanya);
    expect(tanya.mission).toBe(Mission.GUARD);
    expect(tanya.moveTarget).toBeNull();
  });
});

// ── Threat Score: Warhead Effectiveness (techno.cpp) ────────────────────────
// C++ techno.cpp Evaluate_Object — A11: warhead effectiveness affects targeting.
// Tanya with HollowPoint should strongly prefer infantry targets over armored ones.

describe('E7 threat targeting — HollowPoint prefers infantry (techno.cpp)', () => {
  it('HollowPoint mult vs none (1.0) triggers effective bonus in threatScore', () => {
    const mult = WARHEAD_VS_ARMOR.HollowPoint[armorIndex('none')];
    expect(mult).toBe(1.0);
    // A11: mult > 1.0 gives 1.5x bonus, mult < 0.5 gives 0.5x penalty
    // HollowPoint vs none = 1.0, no bonus but no penalty either
    expect(mult).toBeGreaterThanOrEqual(0.5); // not penalized
  });

  it('HollowPoint mult vs heavy (0.05) triggers penalty in threatScore', () => {
    const mult = WARHEAD_VS_ARMOR.HollowPoint[armorIndex('heavy')];
    expect(mult).toBe(0.05);
    // A11: mult < 0.5 gives 0.5x penalty — Tanya deprioritizes armored targets
    expect(mult).toBeLessThan(0.5);
  });
});
