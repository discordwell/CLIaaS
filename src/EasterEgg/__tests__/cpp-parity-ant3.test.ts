/**
 * C++ Behavioral Parity: ANT3 — Scout Ant
 *
 * Tests verify Scout Ant behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * ANT3 is unique among the three ant types: light armor (not heavy),
 * slowest speed (12 vs 14), TeslaZap weapon with Super warhead,
 * and slightly longer melee range (1.75 vs ANT1's 1.5).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, ANT_ANIM,
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
    getFirepowerBias: () => 1.0,
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
// C++ udata.cpp — ANT3 entry and RULES.INI [ANT3] section

describe('ANT3 stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.ANT3;
  const weapon = WEAPON_STATS.TeslaZap;

  it('HP is 85 (Strength=85)', () => {
    expect(stats.strength).toBe(85);
  });

  it('Armor is light (only ant with light armor)', () => {
    expect(stats.armor).toBe('light');
  });

  it('Speed is 12 (slowest ant: ANT1/ANT2 are 14)', () => {
    expect(stats.speed).toBe(12);
    expect(UNIT_STATS.ANT1.speed).toBe(14);
    expect(UNIT_STATS.ANT2.speed).toBe(14);
    expect(stats.speed).toBeLessThan(UNIT_STATS.ANT1.speed);
  });

  it('isInfantry is false (ants are not infantry)', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('crushable is true (ants are crushable by heavy vehicles)', () => {
    expect(stats.crushable).toBe(true);
  });

  it('noMovingFire is true (must stop to attack)', () => {
    expect(stats.noMovingFire).toBe(true);
  });

  it('primary weapon is TeslaZap', () => {
    expect(stats.primaryWeapon).toBe('TeslaZap');
  });

  it('TeslaZap warhead is Super', () => {
    expect(weapon.warhead).toBe('Super');
  });

  it('TeslaZap damage is 60', () => {
    expect(weapon.damage).toBe(60);
  });

  it('TeslaZap range is 1.75 cells (melee, slightly longer than Mandible at 1.5)', () => {
    expect(weapon.range).toBe(1.75);
    expect(WEAPON_STATS.Mandible.range).toBe(1.5);
    expect(weapon.range).toBeGreaterThan(WEAPON_STATS.Mandible.range);
  });

  it('TeslaZap ROF is 25', () => {
    expect(weapon.rof).toBe(25);
  });

  it('Entity constructor initializes HP to strength', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    expect(ant3.hp).toBe(85);
    expect(ant3.maxHp).toBe(85);
  });
});

// ── isAnt flag (entity.ts) ────────────────────────────────────────────────────

describe('ANT3 isAnt flag (entity.ts)', () => {
  it('isAnt is true for ANT3', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    expect(ant3.isAnt).toBe(true);
  });

  it('isAnt is true for all three ant types', () => {
    const ant1 = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 11);
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 12);
    expect(ant1.isAnt).toBe(true);
    expect(ant2.isAnt).toBe(true);
    expect(ant3.isAnt).toBe(true);
  });

  it('non-ant unit isAnt is false', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.isAnt).toBe(false);
  });
});

// ── Light Armor Differentiation (rules.ini) ──────────────────────────────────
// ANT3 is the ONLY ant with light armor; ANT1 and ANT2 have heavy

describe('ANT3 light armor differentiation (rules.ini)', () => {
  it('ANT3 has light armor, ANT1/ANT2 have heavy', () => {
    expect(UNIT_STATS.ANT3.armor).toBe('light');
    expect(UNIT_STATS.ANT1.armor).toBe('heavy');
    expect(UNIT_STATS.ANT2.armor).toBe('heavy');
  });

  it('light armor takes more SA damage than heavy armor', () => {
    const saVsLight = WARHEAD_VS_ARMOR.SA[armorIndex('light')];
    const saVsHeavy = WARHEAD_VS_ARMOR.SA[armorIndex('heavy')];
    expect(saVsLight).toBeGreaterThan(saVsHeavy);
  });

  it('ANT3 takes more SA damage than ANT1 (light vs heavy armor)', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    const ant1 = entityAtCell(UnitType.ANT1, House.USSR, 10, 11);

    const saVsLight = WARHEAD_VS_ARMOR.SA[armorIndex('light')];
    const saVsHeavy = WARHEAD_VS_ARMOR.SA[armorIndex('heavy')];

    // 15 base damage × mult
    const dmgToAnt3 = Math.round(15 * saVsLight);
    const dmgToAnt1 = Math.round(15 * saVsHeavy);
    expect(dmgToAnt3).toBeGreaterThan(dmgToAnt1);
  });
});

// ── Weapon Effectiveness — Super warhead (combat.cpp warhead tables) ─────────
// C++ combat.cpp — Super warhead deals 1.0 multiplier vs ALL armor types

describe('ANT3 weapon effectiveness — Super warhead (combat.cpp warhead tables)', () => {
  it('Super vs none armor: mult 1.0', () => {
    expect(WARHEAD_VS_ARMOR.Super[armorIndex('none')]).toBe(1.0);
  });

  it('Super vs wood armor: mult 1.0', () => {
    expect(WARHEAD_VS_ARMOR.Super[armorIndex('wood')]).toBe(1.0);
  });

  it('Super vs light armor: mult 1.0', () => {
    expect(WARHEAD_VS_ARMOR.Super[armorIndex('light')]).toBe(1.0);
  });

  it('Super vs heavy armor: mult 1.0', () => {
    expect(WARHEAD_VS_ARMOR.Super[armorIndex('heavy')]).toBe(1.0);
  });

  it('Super vs concrete: mult 1.0', () => {
    expect(WARHEAD_VS_ARMOR.Super[armorIndex('concrete')]).toBe(1.0);
  });

  it('TeslaZap deals full 60 damage to unarmored targets', () => {
    // Use ANT1 as victim (125 HP, heavy armor) — but Super warhead deals 1.0 vs all armor
    // We need a target with > 60 HP and 'none' armor to test pure damage.
    // E1 only has 50 HP so it dies before taking full 60.
    // Instead, verify the math: 60 * Super_vs_none(1.0) = 60, and apply to a high-HP target.
    const victim = entityAtCell(UnitType.ANT3, House.Spain, 11, 10); // 85 HP, light armor
    const hpBefore = victim.hp;
    // Super vs light = 1.0, so full 60 damage
    victim.takeDamage(60, 'Super');
    expect(hpBefore - victim.hp).toBe(60);
  });

  it('TeslaZap deals full 60 damage to heavy-armor vehicles (Super warhead ignores armor)', () => {
    const victim = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    const mult = WARHEAD_VS_ARMOR.Super[armorIndex('heavy')];
    const damage = Math.round(60 * mult);
    victim.takeDamage(damage, 'Super');
    expect(hpBefore - victim.hp).toBe(60);
    expect(damage).toBe(60); // Super vs heavy = 1.0, no reduction
  });
});

// ── Crushable (drive.cpp:Ok_To_Move) ─────────────────────────────────────────
// C++ drive.cpp — ANT3 is crushable; heavy tanks can crush it

describe('ANT3 crushable (drive.cpp:Ok_To_Move)', () => {
  it('ANT3 is killed when a crusher vehicle (2TNK) enters its cell', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([ant3, tank]);
    checkVehicleCrush(ctx, tank);
    expect(ant3.alive).toBe(false);
  });

  it('ANT3 is NOT crushed by non-crusher vehicle (JEEP)', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    const jeep = entityAtCell(UnitType.V_JEEP, House.Spain, 10, 10);
    const ctx = makeCombatCtx([ant3, jeep]);
    checkVehicleCrush(ctx, jeep);
    expect(ant3.alive).toBe(true);
    expect(ant3.hp).toBe(ant3.maxHp);
  });

  it('ANT3 is NOT crushed by allied vehicle (same house)', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([ant3, tank]);
    checkVehicleCrush(ctx, tank);
    expect(ant3.alive).toBe(true);
  });
});

// ── Retaliation (techno.cpp) ─────────────────────────────────────────────────
// C++ techno.cpp — idle units counter-attack when hit by enemy

describe('ANT3 retaliation (techno.cpp)', () => {
  it('idle ANT3 on GUARD mission retaliates when hit by enemy', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    ant3.mission = Mission.GUARD;
    ant3.target = null;

    const ctx = makeCombatCtx([ant3, attacker]);
    triggerRetaliation(ctx, ant3, attacker);

    expect(ant3.target).toBe(attacker);
    expect(ant3.mission).toBe(Mission.ATTACK);
  });

  it('ANT3 has a weapon (TeslaZap) so CAN retaliate', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    expect(ant3.weapon).not.toBeNull();
    expect(ant3.weapon!.name).toBe('TeslaZap');
  });

  it('ANT3 does not retarget if already has a living target', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    const existingTarget = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const newAttacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    ant3.mission = Mission.ATTACK;
    ant3.target = existingTarget;

    const ctx = makeCombatCtx([ant3, existingTarget, newAttacker]);
    triggerRetaliation(ctx, ant3, newAttacker);

    expect(ant3.target).toBe(existingTarget);
  });
});

// ── AI Scatter on Damage (techno.cpp) ────────────────────────────────────────
// C++ techno.cpp — AI-controlled units on GUARD scatter when damaged

describe('ANT3 AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled ANT3 on GUARD mission can scatter when damaged (IQ >= 2)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
      ant3.mission = Mission.GUARD;
      const ctx = makeCombatCtx([ant3]);
      aiScatterOnDamage(ctx, ant3);
      if (ant3.mission === Mission.MOVE && ant3.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('AI ANT3 on ATTACK mission does NOT scatter', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    ant3.mission = Mission.ATTACK;

    const ctx = makeCombatCtx([ant3]);
    aiScatterOnDamage(ctx, ant3);

    expect(ant3.mission).toBe(Mission.ATTACK);
  });
});

// ── Rotation (drive.cpp / entity.ts) ─────────────────────────────────────────
// ANT3 rot=9 (>= 8) means instant facing snap, like infantry

describe('ANT3 rotation — rot=9 snap (drive.cpp)', () => {
  it('ANT3 rot is 9 (>= 8 threshold for instant snap)', () => {
    expect(UNIT_STATS.ANT3.rot).toBe(9);
  });

  it('ANT3 facing snaps instantly since rot >= 8', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    ant3.facing = Dir.N;
    ant3.desiredFacing = Dir.S; // opposite direction
    ant3.bodyFacing32 = Dir.N * 4;
    const aligned = ant3.tickRotation();
    expect(aligned).toBe(true);
    expect(ant3.facing).toBe(Dir.S);
  });

  it('ANT2 rot is 6 (< 8) — does NOT snap instantly (contrast with ANT3)', () => {
    expect(UNIT_STATS.ANT2.rot).toBe(6);
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    ant2.facing = Dir.N;
    ant2.desiredFacing = Dir.S;
    ant2.bodyFacing32 = Dir.N * 4;
    const aligned = ant2.tickRotation();
    // rot=6 < 8, so it does NOT snap — still rotating
    expect(aligned).toBe(false);
  });
});

// ── Movement — stop-rotate-move (drive.cpp) ─────────────────────────────────
// ANT3 is NOT infantry: it follows vehicle movement rules (stop to rotate, then move)
// However, since rot=9 (>= 8), rotation snap means effectively no pause.

describe('ANT3 movement — non-infantry vehicle rules (drive.cpp)', () => {
  it('ANT3 isInfantry is false (uses vehicle movement model)', () => {
    expect(UNIT_STATS.ANT3.isInfantry).toBe(false);
  });

  it('ANT3 moves toward target (rot=9 snaps instantly, so no stall)', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    ant3.facing = Dir.N;
    ant3.desiredFacing = Dir.N;
    ant3.bodyFacing32 = Dir.N * 4;

    const startX = ant3.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: ant3.pos.y }; // due East

    const arrived = ant3.moveToward(targetPos, ant3.stats.speed);

    // Despite facing N and target E, rot=9 means instant snap → movement happens
    const distMoved = Math.sqrt((ant3.pos.x - startX) ** 2 + (ant3.pos.y - ant3.pos.y) ** 2);
    expect(distMoved).toBeGreaterThan(0);
  });

  it('ANT3 speed is 12 (slowest ant)', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    expect(ant3.stats.speed).toBe(12);
  });
});

// ── Ant Animation System (entity.ts spriteFrame) ────────────────────────────
// C++ — ANT3 uses ANT_ANIM layout (112-frame sheet), NOT infantry animation

describe('ANT3 animation system — ANT_ANIM layout (entity.ts)', () => {
  it('ANT3 isAnt = true (uses ant animation, not infantry)', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    expect(ant3.isAnt).toBe(true);
    expect(ant3.stats.isInfantry).toBe(false);
  });

  it('ANT_ANIM layout constants are correct', () => {
    expect(ANT_ANIM.standBase).toBe(0);
    expect(ANT_ANIM.walkBase).toBe(8);
    expect(ANT_ANIM.walkCount).toBe(8);
    expect(ANT_ANIM.attackBase).toBe(72);
    expect(ANT_ANIM.attackCount).toBe(4);
    expect(ANT_ANIM.deathBase).toBe(104);
    expect(ANT_ANIM.deathCount).toBe(8);
  });

  it('ANT3 IDLE spriteFrame uses standBase + dir', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    ant3.animState = AnimState.IDLE;
    ant3.facing = Dir.E;
    expect(ant3.spriteFrame).toBe(ANT_ANIM.standBase + Dir.E);
  });

  it('ANT3 WALK spriteFrame uses walkBase + dir * walkCount + animFrame', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    ant3.animState = AnimState.WALK;
    ant3.facing = Dir.S;
    ant3.animFrame = 3;
    const expected = ANT_ANIM.walkBase + Dir.S * ANT_ANIM.walkCount + (3 % ANT_ANIM.walkCount);
    expect(ant3.spriteFrame).toBe(expected);
  });

  it('ANT3 ATTACK spriteFrame uses attackBase + dir * attackCount + animFrame', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    ant3.animState = AnimState.ATTACK;
    ant3.facing = Dir.NW;
    ant3.animFrame = 2;
    const expected = ANT_ANIM.attackBase + Dir.NW * ANT_ANIM.attackCount + (2 % ANT_ANIM.attackCount);
    expect(ant3.spriteFrame).toBe(expected);
  });

  it('ANT3 DIE spriteFrame uses deathBase + clamped animFrame', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    ant3.animState = AnimState.DIE;
    ant3.animFrame = 5;
    const expected = ANT_ANIM.deathBase + Math.min(5, ANT_ANIM.deathCount - 1);
    expect(ant3.spriteFrame).toBe(expected);
  });

  it('ANT3 death animation frame clamps at deathCount - 1', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    ant3.animState = AnimState.DIE;
    ant3.animFrame = 100; // way past deathCount
    expect(ant3.spriteFrame).toBe(ANT_ANIM.deathBase + ANT_ANIM.deathCount - 1);
  });

  it('ANT3 alive=true starts in IDLE animState', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    expect(ant3.alive).toBe(true);
    expect(ant3.animState).toBe(AnimState.IDLE);
  });
});

// ── Damage & Death (combat.cpp) ──────────────────────────────────────────────
// ANT3 has light armor — takes different damage profile than ANT1/ANT2

describe('ANT3 damage & death (combat.cpp)', () => {
  it('ANT3 dies when HP reaches 0', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    ant3.takeDamage(85, 'Super');
    expect(ant3.alive).toBe(false);
    expect(ant3.hp).toBe(0);
    expect(ant3.mission).toBe(Mission.DIE);
    expect(ant3.animState).toBe(AnimState.DIE);
  });

  it('ANT3 survives damage that leaves HP > 0', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    ant3.takeDamage(84, 'Super');
    expect(ant3.alive).toBe(true);
    expect(ant3.hp).toBe(1);
  });

  it('ANT3 is not infantry, so fear/prone system does not apply', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    expect(ant3.stats.isInfantry).toBe(false);
    // Take damage — fear should NOT increase (fear system is infantry-only)
    ant3.takeDamage(10, 'Super');
    expect(ant3.fear).toBe(0);
    expect(ant3.isProne).toBe(false);
  });

  it('TeslaZap one-shots an E1 (60 damage > 50 HP)', () => {
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    expect(victim.hp).toBe(50);
    victim.takeDamage(60, 'Super');
    expect(victim.alive).toBe(false);
  });

  it('ANT3 takes full HE damage (HE vs light = 0.6)', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    const hpBefore = ant3.hp;
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('light')];
    expect(mult).toBe(0.6);
    const damage = Math.round(100 * mult); // 100 base HE → 60 to light
    ant3.takeDamage(damage, 'HE');
    expect(hpBefore - ant3.hp).toBe(60);
  });

  it('ANT3 takes more SA damage than heavy-armored ANT1 from same attack', () => {
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    const ant1 = entityAtCell(UnitType.ANT1, House.USSR, 10, 11);

    const baseDmg = 15;
    const dmg3 = Math.round(baseDmg * WARHEAD_VS_ARMOR.SA[armorIndex('light')]);   // 15 * 0.6 = 9
    const dmg1 = Math.round(baseDmg * WARHEAD_VS_ARMOR.SA[armorIndex('heavy')]);   // 15 * 0.25 = 4

    ant3.takeDamage(dmg3, 'SA');
    ant1.takeDamage(dmg1, 'SA');

    expect(85 - ant3.hp).toBe(dmg3);
    expect(125 - ant1.hp).toBe(dmg1);
    expect(dmg3).toBeGreaterThan(dmg1);
  });
});

// ── Comparative: ANT3 vs ANT1 vs ANT2 ───────────────────────────────────────
// Documents the three ant types' key stat differences

describe('ANT3 comparative stats (ANT1 vs ANT2 vs ANT3)', () => {
  it('ANT3 is the only ant with light armor', () => {
    expect(UNIT_STATS.ANT1.armor).toBe('heavy');
    expect(UNIT_STATS.ANT2.armor).toBe('heavy');
    expect(UNIT_STATS.ANT3.armor).toBe('light');
  });

  it('ANT3 is the slowest ant (speed 12 vs 14)', () => {
    expect(UNIT_STATS.ANT3.speed).toBe(12);
    expect(UNIT_STATS.ANT1.speed).toBe(14);
    expect(UNIT_STATS.ANT2.speed).toBe(14);
  });

  it('all three ants are crushable', () => {
    expect(UNIT_STATS.ANT1.crushable).toBe(true);
    expect(UNIT_STATS.ANT2.crushable).toBe(true);
    expect(UNIT_STATS.ANT3.crushable).toBe(true);
  });

  it('all three ants have noMovingFire', () => {
    expect(UNIT_STATS.ANT1.noMovingFire).toBe(true);
    expect(UNIT_STATS.ANT2.noMovingFire).toBe(true);
    expect(UNIT_STATS.ANT3.noMovingFire).toBe(true);
  });

  it('TeslaZap has slightly longer range (1.75) than Mandible (1.5)', () => {
    expect(WEAPON_STATS.TeslaZap.range).toBe(1.75);
    expect(WEAPON_STATS.Mandible.range).toBe(1.5);
  });

  it('TeslaZap damage (60) is between Mandible (50) and FireballLauncher (125)', () => {
    expect(WEAPON_STATS.TeslaZap.damage).toBe(60);
    expect(WEAPON_STATS.Mandible.damage).toBe(50);
    expect(WEAPON_STATS.FireballLauncher.damage).toBe(125);
    expect(WEAPON_STATS.TeslaZap.damage).toBeGreaterThan(WEAPON_STATS.Mandible.damage);
    expect(WEAPON_STATS.TeslaZap.damage).toBeLessThan(WEAPON_STATS.FireballLauncher.damage);
  });

  it('ANT3 HP (85) is between ANT2 (75) and ANT1 (125)', () => {
    expect(UNIT_STATS.ANT3.strength).toBe(85);
    expect(UNIT_STATS.ANT2.strength).toBe(75);
    expect(UNIT_STATS.ANT1.strength).toBe(125);
  });
});
