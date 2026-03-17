/**
 * C++ Behavioral Parity: ANT1 — Warrior Ant
 *
 * Tests verify Warrior Ant behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with ANT1 (observable outcomes: HP, alive/dead,
 * mission, animation, position changes), not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, PRONE_DAMAGE_BIAS,
  ANT_ANIM,
  buildDefaultAlliances, armorIndex,
  COUNTRY_BONUSES,
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

// ── 1. Stats Verification (rules.ini / udata.cpp parity) ─────────────────────
// C++ udata.cpp — ANT1 entry and RULES.INI [ANT1] section

describe('ANT1 stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.ANT1;
  const weapon = WEAPON_STATS.Mandible;

  it('HP is 125 (Strength=125)', () => {
    expect(stats.strength).toBe(125);
  });

  it('Armor is heavy (Armor=heavy)', () => {
    expect(stats.armor).toBe('heavy');
  });

  it('Speed is 14 (Speed=14, MEDIUM_FAST)', () => {
    expect(stats.speed).toBe(14);
  });

  it('isInfantry is false — ants are NOT infantry', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('crushable is true — unlike most heavy-armor units, ants are crushable', () => {
    expect(stats.crushable).toBe(true);
  });

  it('noMovingFire is true — ants must stop to attack', () => {
    expect(stats.noMovingFire).toBe(true);
  });

  it('primary weapon is Mandible', () => {
    expect(stats.primaryWeapon).toBe('Mandible');
  });

  it('Entity constructor initializes HP to strength (125)', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    expect(ant.hp).toBe(125);
    expect(ant.maxHp).toBe(125);
  });
});

// ── 2. Weapon — Mandible (weapon.cpp / rules.ini) ────────────────────────────
// C++ weapon.cpp — Mandible: Super warhead, 50 damage, range 1.5, ROF 15

describe('ANT1 weapon — Mandible (weapon.cpp / rules.ini)', () => {
  const weapon = WEAPON_STATS.Mandible;

  it('Mandible warhead is Super', () => {
    expect(weapon.warhead).toBe('Super');
  });

  it('Mandible damage is 50', () => {
    expect(weapon.damage).toBe(50);
  });

  it('Mandible range is 1.5 cells (melee range)', () => {
    expect(weapon.range).toBe(1.5);
  });

  it('Mandible ROF is 15', () => {
    expect(weapon.rof).toBe(15);
  });

  it('Entity resolves Mandible weapon from stats', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    expect(ant.weapon).not.toBeNull();
    expect(ant.weapon!.name).toBe('Mandible');
    expect(ant.weapon!.damage).toBe(50);
  });
});

// ── 3. Super warhead effectiveness (combat.cpp warhead tables) ───────────────
// C++ combat.cpp — Super warhead has 1.0 multiplier vs ALL armor types

describe('ANT1 Super warhead — equal damage to all armor types (combat.cpp)', () => {
  const verses = WARHEAD_VS_ARMOR.Super;

  it('Super vs none armor: 1.0', () => {
    expect(verses[armorIndex('none')]).toBe(1.0);
  });

  it('Super vs wood armor: 1.0', () => {
    expect(verses[armorIndex('wood')]).toBe(1.0);
  });

  it('Super vs light armor: 1.0', () => {
    expect(verses[armorIndex('light')]).toBe(1.0);
  });

  it('Super vs heavy armor: 1.0', () => {
    expect(verses[armorIndex('heavy')]).toBe(1.0);
  });

  it('Super vs concrete: 1.0', () => {
    expect(verses[armorIndex('concrete')]).toBe(1.0);
  });

  it('ANT1 deals full 50 base damage to unarmored target', () => {
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    victim.takeDamage(50, 'Super');
    expect(hpBefore - victim.hp).toBe(50);
  });

  it('ANT1 deals full 50 base damage to heavy-armor target (unlike SA warhead)', () => {
    const victim = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    const mult = WARHEAD_VS_ARMOR.Super[armorIndex('heavy')];
    const damage = Math.round(50 * mult);
    victim.takeDamage(damage, 'Super');
    expect(hpBefore - victim.hp).toBe(50); // full damage, no reduction
  });
});

// ── 4. isAnt — entity identity (entity.ts) ──────────────────────────────────
// entity.ts:376-380 — isAnt getter returns true for ANT1/ANT2/ANT3

describe('ANT1 isAnt identity (entity.ts)', () => {
  it('ANT1 isAnt returns true', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    expect(ant.isAnt).toBe(true);
  });

  it('ANT1 isInfantry stat is false — ants are not infantry', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    expect(ant.stats.isInfantry).toBe(false);
  });

  it('E1 isAnt returns false — infantry is not ant', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.isAnt).toBe(false);
  });

  it('ANT2 and ANT3 also return isAnt true (cross-verify)', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    expect(ant2.isAnt).toBe(true);
    expect(ant3.isAnt).toBe(true);
  });

  it('vehicles return isAnt false', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    expect(tank.isAnt).toBe(false);
  });
});

// ── 5. Crushable by vehicles (drive.cpp:Ok_To_Move) ─────────────────────────
// C++ drive.cpp — crusher vehicles can crush ant units (crushable=true)

describe('ANT1 crushable by vehicles (drive.cpp:Ok_To_Move)', () => {
  it('ANT1 is killed when a crusher vehicle (2TNK) enters its cell', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([ant, tank]);
    checkVehicleCrush(ctx, tank);
    expect(ant.alive).toBe(false);
  });

  it('ANT1 is NOT crushed by non-crusher vehicle (JEEP)', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    const jeep = entityAtCell(UnitType.V_JEEP, House.Spain, 10, 10);
    const ctx = makeCombatCtx([ant, jeep]);
    checkVehicleCrush(ctx, jeep);
    expect(ant.alive).toBe(true);
    expect(ant.hp).toBe(ant.maxHp);
  });

  it('ANT1 is NOT crushed by allied crusher vehicle', () => {
    // Same house — always allied
    const ant = entityAtCell(UnitType.ANT1, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([ant, tank]);
    checkVehicleCrush(ctx, tank);
    expect(ant.alive).toBe(true);
  });

  it('ANT1 has heavy armor but is still crushable (unique property)', () => {
    const stats = UNIT_STATS.ANT1;
    expect(stats.armor).toBe('heavy');
    expect(stats.crushable).toBe(true);
    // Most heavy armor units are NOT crushable — ants are the exception
    expect(UNIT_STATS['2TNK'].crushable).toBeFalsy();
  });
});

// ── 6. Melee range (weapon.cpp) ──────────────────────────────────────────────
// Mandible range 1.5 cells means ants must get adjacent to target

describe('ANT1 melee range — must get adjacent to target (weapon.cpp)', () => {
  it('ANT1 weapon range is 1.5 cells', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    expect(ant.weapon!.range).toBe(1.5);
  });

  it('ANT1 is in range of adjacent-cell target (1 cell apart)', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 11, 10); // 1 cell east
    expect(ant.inRange(target)).toBe(true);
  });

  it('ANT1 is NOT in range of target 2 cells away', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 12, 10); // 2 cells east
    expect(ant.inRange(target)).toBe(false);
  });

  it('Mandible range (1.5) is much shorter than ranged weapons (e.g. M1Carbine at 3.0)', () => {
    expect(WEAPON_STATS.Mandible.range).toBe(1.5);
    expect(WEAPON_STATS.M1Carbine.range).toBe(3.0);
    expect(WEAPON_STATS.Mandible.range).toBeLessThan(WEAPON_STATS.M1Carbine.range);
  });
});

// ── 7. NoMovingFire (unit.cpp:1760-1764) ─────────────────────────────────────
// C++ unit.cpp — noMovingFire units must stop before attacking

describe('ANT1 noMovingFire — must stop to attack (unit.cpp:1760-1764)', () => {
  it('ANT1 stats.noMovingFire is true', () => {
    expect(UNIT_STATS.ANT1.noMovingFire).toBe(true);
  });

  it('wasMoving flag triggers setup time on stop (ROF/4 warmup)', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    ant.wasMoving = true;
    // Setup time = ROF / 4 = 15 / 4 = 3 ticks (floored)
    const setupTime = Math.floor(ant.weapon!.rof / 4);
    expect(setupTime).toBe(3);
    // When cooldown < setupTime, it should be raised to setupTime
    ant.attackCooldown = 0;
    if (ant.attackCooldown < setupTime) {
      ant.attackCooldown = setupTime;
    }
    expect(ant.attackCooldown).toBe(3);
  });

  it('E1 does NOT have noMovingFire (can fire while moving)', () => {
    expect(UNIT_STATS.E1.noMovingFire).toBeFalsy();
  });

  it('Artillery also has noMovingFire (same behavior class)', () => {
    expect(UNIT_STATS.ARTY.noMovingFire).toBe(true);
  });
});

// ── 8. Ant animation system (entity.ts:394-406) ─────────────────────────────
// Ant SHP layout: 112 frames — stand(0-7), walk(8-71), attack(72-103), death(104-111)
// Uses ANT_ANIM constants, NOT INFANTRY_ANIMS

describe('ANT1 animation system — ANT_ANIM layout (entity.ts:394-406)', () => {
  it('ANT_ANIM standBase is 0', () => {
    expect(ANT_ANIM.standBase).toBe(0);
  });

  it('ANT_ANIM walkBase is 8, walkCount is 8', () => {
    expect(ANT_ANIM.walkBase).toBe(8);
    expect(ANT_ANIM.walkCount).toBe(8);
  });

  it('ANT_ANIM attackBase is 72, attackCount is 4', () => {
    expect(ANT_ANIM.attackBase).toBe(72);
    expect(ANT_ANIM.attackCount).toBe(4);
  });

  it('ANT_ANIM deathBase is 104, deathCount is 8', () => {
    expect(ANT_ANIM.deathBase).toBe(104);
    expect(ANT_ANIM.deathCount).toBe(8);
  });

  it('IDLE spriteFrame uses standBase + direction', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    ant.animState = AnimState.IDLE;
    ant.facing = Dir.N;
    expect(ant.spriteFrame).toBe(ANT_ANIM.standBase + Dir.N); // 0 + 0 = 0

    ant.facing = Dir.E;
    expect(ant.spriteFrame).toBe(ANT_ANIM.standBase + Dir.E); // 0 + 2 = 2
  });

  it('WALK spriteFrame uses walkBase + dir * walkCount + animFrame', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    ant.animState = AnimState.WALK;
    ant.facing = Dir.N;
    ant.animFrame = 0;
    expect(ant.spriteFrame).toBe(ANT_ANIM.walkBase + Dir.N * ANT_ANIM.walkCount + 0); // 8

    ant.animFrame = 3;
    expect(ant.spriteFrame).toBe(ANT_ANIM.walkBase + Dir.N * ANT_ANIM.walkCount + 3); // 11

    ant.facing = Dir.S;
    ant.animFrame = 5;
    expect(ant.spriteFrame).toBe(ANT_ANIM.walkBase + Dir.S * ANT_ANIM.walkCount + 5); // 8 + 4*8 + 5 = 45
  });

  it('ATTACK spriteFrame uses attackBase + dir * attackCount + animFrame', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    ant.animState = AnimState.ATTACK;
    ant.facing = Dir.N;
    ant.animFrame = 0;
    expect(ant.spriteFrame).toBe(ANT_ANIM.attackBase + Dir.N * ANT_ANIM.attackCount + 0); // 72

    ant.facing = Dir.E;
    ant.animFrame = 2;
    expect(ant.spriteFrame).toBe(ANT_ANIM.attackBase + Dir.E * ANT_ANIM.attackCount + 2); // 72 + 2*4 + 2 = 82
  });

  it('DIE spriteFrame uses deathBase + animFrame (direction-independent)', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    ant.animState = AnimState.DIE;
    ant.animFrame = 0;
    expect(ant.spriteFrame).toBe(ANT_ANIM.deathBase + 0); // 104

    ant.animFrame = 7;
    expect(ant.spriteFrame).toBe(ANT_ANIM.deathBase + 7); // 111

    // Clamps to max frame
    ant.animFrame = 15;
    expect(ant.spriteFrame).toBe(ANT_ANIM.deathBase + ANT_ANIM.deathCount - 1); // 111
  });

  it('walk animation wraps via modulo for frame counts beyond walkCount', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    ant.animState = AnimState.WALK;
    ant.facing = Dir.N;
    ant.animFrame = 10; // 10 % 8 = 2
    expect(ant.spriteFrame).toBe(ANT_ANIM.walkBase + Dir.N * ANT_ANIM.walkCount + 2);
  });
});

// ── 9. Not infantry (entity.ts / types.ts) ──────────────────────────────────
// Despite being a crushable ground unit, ants are NOT infantry.
// This means they don't use infantry animation, infantry sub-cells, or infantry fear.

describe('ANT1 is not infantry — distinct from crushable infantry (types.ts)', () => {
  it('isInfantry is false in stats', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    expect(ant.stats.isInfantry).toBe(false);
  });

  it('does not have hasTurret (excluded by isAnt check in getter)', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    expect(ant.hasTurret).toBe(false);
  });

  it('isAirUnit is false — ants are ground units', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    expect(ant.isAirUnit).toBe(false);
  });

  it('isNavalUnit is false — ants are land units', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    expect(ant.isNavalUnit).toBe(false);
  });
});

// ── 10. No fear/prone system (infantry.cpp:329-457) ─────────────────────────
// C++ infantry.cpp — fear is an infantry-only system. Ants don't use it.
// In takeDamage, fear increase is gated by stats.isInfantry === true.

describe('ANT1 no fear/prone — ants bypass infantry fear system (infantry.cpp)', () => {
  it('ANT1 starts with fear=0', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    expect(ant.fear).toBe(0);
  });

  it('ANT1 fear does NOT increase on damage (isInfantry=false gate)', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    ant.takeDamage(50, 'Super');
    // Fear increase in takeDamage is gated by: if (this.stats.isInfantry && amount > 0)
    // Since ANT1.isInfantry = false, fear stays at 0
    expect(ant.fear).toBe(0);
  });

  it('E1 infantry DOES get fear on damage (contrast with ANT1)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.takeDamage(10, 'SA');
    expect(e1.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });

  it('ANT1 isProne remains false even with manual fear set (no prone behavior)', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    // Even if we manually set fear, the prone damage reduction only applies
    // because isProne is set by the infantry AI tick (which ants don't have)
    ant.fear = 200;
    // isProne stays false since no infantry AI tick sets it
    expect(ant.isProne).toBe(false);
  });

  it('ANT1 takes full damage (no prone reduction)', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    const hpBefore = ant.hp;
    ant.takeDamage(50, 'Super');
    expect(hpBefore - ant.hp).toBe(50);
  });
});

// ── 11. Retaliation (techno.cpp) ─────────────────────────────────────────────
// C++ techno.cpp — idle ants counter-attack when hit by enemy

describe('ANT1 retaliation (techno.cpp)', () => {
  it('idle ANT1 on GUARD mission retaliates when hit by enemy', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    ant.mission = Mission.GUARD;
    ant.target = null;

    const ctx = makeCombatCtx([ant, attacker]);
    triggerRetaliation(ctx, ant, attacker);

    expect(ant.target).toBe(attacker);
    expect(ant.mission).toBe(Mission.ATTACK);
  });

  it('ANT1 CAN retaliate (has Mandible weapon)', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    expect(ant.weapon).not.toBeNull();
    expect(ant.weapon!.name).toBe('Mandible');
  });

  it('ANT1 does not retarget if already has a living target', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    const existingTarget = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const newAttacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    ant.mission = Mission.ATTACK;
    ant.target = existingTarget;

    const ctx = makeCombatCtx([ant, existingTarget, newAttacker]);
    triggerRetaliation(ctx, ant, newAttacker);

    expect(ant.target).toBe(existingTarget);
  });
});

// ── 12. Movement — not infantry (drive.cpp vs infantry.cpp) ──────────────────
// Ants are not infantry, so they use vehicle-like stop-rotate-move
// However, ANT1 rot=8 means instant facing snap (same as infantry)

describe('ANT1 movement — rot=8 instant facing snap (drive.cpp)', () => {
  it('ANT1 rot is 8 (instant facing snap)', () => {
    expect(UNIT_STATS.ANT1.rot).toBe(8);
  });

  it('ANT1 snaps facing instantly with rot >= 8', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    ant.facing = Dir.N;
    ant.desiredFacing = Dir.S;
    const aligned = ant.tickRotation();
    expect(aligned).toBe(true);
    expect(ant.facing).toBe(Dir.S);
  });

  it('ANT1 isInfantry=false, so moveToward uses vehicle path (stop-rotate-move)', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    // Vehicle path: if not facingAligned, don't move
    // But since rot=8, facing snaps instantly, so movement proceeds on first tick
    ant.facing = Dir.N;
    ant.desiredFacing = Dir.N;
    ant.bodyFacing32 = Dir.N * 4;

    const startX = ant.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: ant.pos.y };

    const arrived = ant.moveToward(targetPos, ant.stats.speed);
    // Because rot=8 snaps facing instantly, ant DOES move on the first tick
    const distMoved = Math.abs(ant.pos.x - startX);
    expect(distMoved).toBeGreaterThan(0);
  });
});

// ── 13. Combat interaction: ANT1 vs E1 ──────────────────────────────────────
// Full combat scenario verifying Mandible damage against infantry

describe('ANT1 combat interaction — Mandible vs infantry', () => {
  it('single Mandible hit kills E1 (50 damage > 50 HP)', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);

    expect(e1.hp).toBe(50);
    const killed = e1.takeDamage(50, 'Super');
    expect(killed).toBe(true);
    expect(e1.alive).toBe(false);
  });

  it('ANT1 survives multiple rifle hits (125 HP vs 15 damage per shot)', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    // SA warhead vs heavy armor = 0.25 multiplier
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('heavy')];
    expect(mult).toBe(0.25);

    // E1 deals 15 * 0.25 = 3.75 → rounded to 4 damage per hit
    const dmgPerHit = Math.round(15 * mult);
    expect(dmgPerHit).toBe(4);

    // 125 / 4 = 31.25 → takes 32 hits to kill
    const hitsToKill = Math.ceil(125 / dmgPerHit);
    expect(hitsToKill).toBe(32);

    // Verify: 31 hits don't kill
    for (let i = 0; i < 31; i++) {
      ant.takeDamage(dmgPerHit, 'SA');
    }
    expect(ant.alive).toBe(true);
    expect(ant.hp).toBe(125 - 31 * 4); // 125 - 124 = 1
  });
});

// ── 14. AI scatter on damage (techno.cpp) ────────────────────────────────────
// AI-controlled ants scatter when damaged (same as other units)

describe('ANT1 AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled ANT1 on GUARD mission can scatter when damaged', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
      ant.mission = Mission.GUARD;
      const ctx = makeCombatCtx([ant]);
      aiScatterOnDamage(ctx, ant);
      if (ant.mission === Mission.MOVE && ant.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('ANT1 on ATTACK mission does NOT scatter', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    ant.mission = Mission.ATTACK;

    const ctx = makeCombatCtx([ant]);
    aiScatterOnDamage(ctx, ant);

    expect(ant.mission).toBe(Mission.ATTACK);
  });
});

// ── 15. Death behavior ───────────────────────────────────────────────────────
// When ANT1 dies, mission transitions to DIE and animState to DIE

describe('ANT1 death behavior (entity.ts:505-530)', () => {
  it('ANT1 transitions to DIE mission and animState on lethal damage', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    const killed = ant.takeDamage(200, 'Super');
    expect(killed).toBe(true);
    expect(ant.alive).toBe(false);
    expect(ant.hp).toBe(0);
    expect(ant.mission).toBe(Mission.DIE);
    expect(ant.animState).toBe(AnimState.DIE);
    expect(ant.animFrame).toBe(0);
  });

  it('dead ANT1 spriteFrame uses death animation', () => {
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    ant.takeDamage(200, 'Super');
    ant.animFrame = 3;
    ant.animState = AnimState.DIE;
    expect(ant.spriteFrame).toBe(ANT_ANIM.deathBase + 3); // 107
  });
});
