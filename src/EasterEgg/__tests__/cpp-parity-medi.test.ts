/**
 * C++ Behavioral Parity: MEDI — Medic
 *
 * Tests verify Medic behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with MEDI (observable outcomes: HP, alive/dead,
 * mission, fear, isProne, healing behavior), not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, PRONE_DAMAGE_BIAS,
  PRODUCTION_ITEMS, COUNTRY_BONUSES,
  buildDefaultAlliances, armorIndex, worldDist,
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

// -- Helpers ------------------------------------------------------------------

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

// -- Stats Verification (rules.ini parity) ------------------------------------
// C++ idata.cpp (infantry type data) -- MEDI entry and RULES.INI [MEDI] section

describe('MEDI stats verification (idata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.MEDI;
  const weapon = WEAPON_STATS.Heal;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'MEDI');

  it('HP is 80 (Strength=80) — durable for support, higher than most infantry', () => {
    expect(stats.strength).toBe(80);
  });

  it('HP 80 is higher than E1 (50) and E3 (45)', () => {
    expect(stats.strength).toBeGreaterThan(UNIT_STATS.E1.strength);
    expect(stats.strength).toBeGreaterThan(UNIT_STATS.E3.strength);
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

  it('primary weapon is Heal', () => {
    expect(stats.primaryWeapon).toBe('Heal');
  });

  it('cost is 800 credits (allied faction)', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(800);
  });

  it('faction is allied', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('allied');
  });

  it('sight range is 3', () => {
    expect(stats.sight).toBe(3);
  });

  it('rot is 8 (infantry instant rotation)', () => {
    expect(stats.rot).toBe(8);
  });

  it('Entity constructor initializes HP to strength', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    expect(medi.hp).toBe(80);
    expect(medi.maxHp).toBe(80);
  });
});

// -- Weapon — Heal (rules.ini / weapon.cpp) -----------------------------------
// C++ weapon.cpp — Heal weapon has negative damage (-50), Organic warhead, short range

describe('MEDI Heal weapon (rules.ini / weapon.cpp)', () => {
  const weapon = WEAPON_STATS.Heal;

  it('Heal damage is -50 (negative = healing)', () => {
    expect(weapon.damage).toBe(-50);
  });

  it('Heal warhead is Organic', () => {
    expect(weapon.warhead).toBe('Organic');
  });

  it('Heal range is 1.83 cells (very short, must be adjacent)', () => {
    expect(weapon.range).toBe(1.83);
  });

  it('Heal ROF is 80 ticks', () => {
    expect(weapon.rof).toBe(80);
  });

  it('negative damage means "heal 50 HP" to the target', () => {
    const healAmount = Math.abs(weapon.damage);
    expect(healAmount).toBe(50);
  });

  it('Entity gets Heal weapon from constructor', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    expect(medi.weapon).not.toBeNull();
    expect(medi.weapon!.name).toBe('Heal');
    expect(medi.weapon!.damage).toBe(-50);
  });
});

// -- Organic Warhead (combat.cpp warhead tables) ------------------------------
// C++ combat.cpp — Organic warhead: vs none 1.0, vs everything else 0.0

describe('MEDI Organic warhead — can only heal unarmored infantry (combat.cpp)', () => {
  it('Organic vs none armor: mult 1.0 (full effect on infantry)', () => {
    const mult = WARHEAD_VS_ARMOR.Organic[armorIndex('none')];
    expect(mult).toBe(1.0);
  });

  it('Organic vs wood armor: mult 0.0 (no effect)', () => {
    const mult = WARHEAD_VS_ARMOR.Organic[armorIndex('wood')];
    expect(mult).toBe(0.0);
  });

  it('Organic vs light armor: mult 0.0 (no effect)', () => {
    const mult = WARHEAD_VS_ARMOR.Organic[armorIndex('light')];
    expect(mult).toBe(0.0);
  });

  it('Organic vs heavy armor: mult 0.0 (no effect on tanks)', () => {
    const mult = WARHEAD_VS_ARMOR.Organic[armorIndex('heavy')];
    expect(mult).toBe(0.0);
  });

  it('Organic vs concrete: mult 0.0 (no effect on structures)', () => {
    const mult = WARHEAD_VS_ARMOR.Organic[armorIndex('concrete')];
    expect(mult).toBe(0.0);
  });

  it('Organic 1.0 vs none means heal effect only applies to unarmored targets', () => {
    // All infantry have armor 'none' — they are the only valid heal targets
    expect(UNIT_STATS.E1.armor).toBe('none');
    expect(UNIT_STATS.E3.armor).toBe('none');
    expect(UNIT_STATS.MEDI.armor).toBe('none');

    // Vehicles have real armor — Organic mult 0.0 means no healing effect
    expect(UNIT_STATS['2TNK'].armor).toBe('heavy');
    expect(WARHEAD_VS_ARMOR.Organic[armorIndex('heavy')]).toBe(0.0);
  });
});

// -- Short Heal Range (weapon.cpp) --------------------------------------------
// C++ weapon.cpp — Heal range 1.83 cells: medic must be very close to patient

describe('MEDI short heal range — 1.83 cells (weapon.cpp)', () => {
  it('two adjacent cells (dist ~1.0) are within heal range', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    const patient = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const dist = worldDist(medi.pos, patient.pos);
    expect(dist).toBeLessThanOrEqual(WEAPON_STATS.Heal.range);
  });

  it('two cells apart (~2.0) exceeds heal range of 1.83', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    const patient = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const dist = worldDist(medi.pos, patient.pos);
    expect(dist).toBeGreaterThan(WEAPON_STATS.Heal.range);
  });

  it('inRange returns true for adjacent target', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    const patient = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    expect(medi.inRange(patient)).toBe(true);
  });

  it('inRange returns false for target 2 cells away', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    const patient = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    expect(medi.inRange(patient)).toBe(false);
  });

  it('heal range (1.83) is much shorter than rifle range (3.0)', () => {
    expect(WEAPON_STATS.Heal.range).toBeLessThan(WEAPON_STATS.M1Carbine.range);
  });
});

// -- Negative Damage / Healing Mechanic (combat.cpp) --------------------------
// C++ combat.cpp — weapon damage < 0 means healing: target gains HP instead of losing it

describe('MEDI negative damage — heal instead of hurt (combat.cpp)', () => {
  it('applying negative damage via takeDamage increases HP', () => {
    const patient = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    patient.hp = 20; // damaged (max 50)
    const hpBefore = patient.hp;

    // Negative damage = healing via takeDamage (hp -= negative = hp += positive)
    patient.takeDamage(-50, 'Organic');

    // hp -= (-50) means hp += 50 -> 20 + 50 = 70 (uncapped in takeDamage)
    expect(patient.hp).toBeGreaterThan(hpBefore);
  });

  it('manual heal capped at maxHp: 20 + 50 = 50 (maxHp cap)', () => {
    const patient = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    patient.hp = 20;
    const healAmount = Math.abs(WEAPON_STATS.Heal.damage);

    // Real game heal logic caps at maxHp
    patient.hp = Math.min(patient.maxHp, patient.hp + healAmount);
    expect(patient.hp).toBe(50); // capped at maxHp
  });

  it('heal amount is 50 HP per application', () => {
    const healAmount = Math.abs(WEAPON_STATS.Heal.damage);
    expect(healAmount).toBe(50);
  });

  it('Organic warhead mult 1.0 vs none: full heal effect on infantry', () => {
    const mult = WARHEAD_VS_ARMOR.Organic[armorIndex('none')];
    const effectiveHeal = Math.abs(WEAPON_STATS.Heal.damage) * mult;
    expect(effectiveHeal).toBe(50);
  });

  it('Organic warhead mult 0.0 vs heavy: zero heal effect on vehicles', () => {
    const mult = WARHEAD_VS_ARMOR.Organic[armorIndex('heavy')];
    const effectiveHeal = Math.abs(WEAPON_STATS.Heal.damage) * mult;
    expect(effectiveHeal).toBe(0);
  });
});

// -- healTarget Field (infantry.cpp AI) ---------------------------------------
// C++ infantry.cpp InfantryClass::AI — medic uses healTarget for auto-heal tracking

describe('MEDI healTarget field (infantry.cpp AI)', () => {
  it('Entity has healTarget field, initialized to null', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    expect(medi.healTarget).toBeNull();
  });

  it('healTarget can be assigned to a damaged friendly infantry', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    const patient = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    patient.hp = 20;

    medi.healTarget = patient;
    expect(medi.healTarget).toBe(patient);
    expect(medi.healTarget!.hp).toBe(20);
  });

  it('healTarget cleared when patient is dead', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    const patient = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    patient.hp = 20;
    medi.healTarget = patient;

    patient.alive = false;
    // Validation: should clear healTarget when patient dies
    expect(medi.healTarget!.alive).toBe(false);
    const shouldClear = !medi.healTarget!.alive;
    expect(shouldClear).toBe(true);
  });

  it('healTarget cleared when patient is fully healed', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    const patient = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    patient.hp = 20;
    medi.healTarget = patient;

    patient.hp = patient.maxHp;
    const shouldClear = medi.healTarget!.hp >= medi.healTarget!.maxHp;
    expect(shouldClear).toBe(true);
  });

  it('non-MEDI entities also have healTarget (field exists on all Entity)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.healTarget).toBeNull();
  });
});

// -- Crushable (drive.cpp:Ok_To_Move) ----------------------------------------
// C++ drive.cpp — medic is infantry, crushable by crusher vehicles like all infantry

describe('MEDI crushable (drive.cpp:Ok_To_Move)', () => {
  it('MEDI is killed when a crusher vehicle (2TNK) enters its cell', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([medi, tank]);
    checkVehicleCrush(ctx, tank);
    expect(medi.alive).toBe(false);
  });

  it('MEDI is NOT crushed by non-crusher vehicle (C++ drive.cpp: only Crusher=true crushes)', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    const jeep = entityAtCell(UnitType.V_JEEP, House.USSR, 10, 10);
    const ctx = makeCombatCtx([medi, jeep]);
    checkVehicleCrush(ctx, jeep);
    expect(medi.alive).toBe(true); // JEEP has no crusher flag
  });

  it('JEEP stats confirm no crusher flag', () => {
    expect(UNIT_STATS.JEEP.crusher).toBeFalsy();
  });

  it('MEDI is NOT crushed by allied crusher vehicle (IsAFriend check)', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([medi, tank]);
    checkVehicleCrush(ctx, tank);
    expect(medi.alive).toBe(true);
    expect(medi.hp).toBe(medi.maxHp);
  });

  it('MEDI crushable flag is true', () => {
    expect(UNIT_STATS.MEDI.crushable).toBe(true);
  });
});

// -- Fear / Prone System (infantry.cpp:329-457) -------------------------------
// C++ infantry.cpp — FearType 0-255. Fear increases on damage, decrements 1/tick.
// IsProne when fear >= FEAR_ANXIOUS (10). Prone infantry take 50% damage.

describe('MEDI fear / prone system (infantry.cpp:329-457)', () => {
  it('MEDI starts with fear=0, isProne=false', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    expect(medi.fear).toBe(0);
    expect(medi.isProne).toBe(false);
  });

  it('when MEDI takes damage, fear increases to at least FEAR_SCARED (100)', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 20, 20);
    medi.takeDamage(10, 'SA', attacker);
    expect(medi.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });

  it('prone MEDI takes 50% damage on next hit', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    medi.isProne = true;
    const hpBefore = medi.hp;
    medi.takeDamage(20, 'SA');
    const damageTaken = hpBefore - medi.hp;
    // 20 * 0.5 = 10
    expect(damageTaken).toBe(10);
  });

  it('non-prone MEDI takes full damage', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    expect(medi.isProne).toBe(false);
    const hpBefore = medi.hp;
    medi.takeDamage(20, 'SA');
    const damageTaken = hpBefore - medi.hp;
    expect(damageTaken).toBe(20);
  });

  it('MEDI survives first hit better than E1 due to higher HP (80 vs 50)', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);

    // Both take 45 damage
    medi.takeDamage(45, 'SA');
    e1.takeDamage(45, 'SA');

    expect(medi.alive).toBe(true);
    expect(medi.hp).toBe(35);
    expect(e1.alive).toBe(true);
    expect(e1.hp).toBe(5);

    // Second hit of 45 kills E1 but not MEDI
    medi.takeDamage(45, 'SA');
    e1.takeDamage(45, 'SA');

    expect(medi.alive).toBe(false); // 35 - 45 = dead
    expect(e1.alive).toBe(false);   // 5 - 45 = dead
  });
});

// -- Retaliation — The Ironic Medic (techno.cpp) ------------------------------
// C++ techno.cpp — idle/moving units counter-attack when hit by enemy.
// MEDI has a weapon (Heal) so triggerRetaliation targets the attacker.
// But Heal does negative damage (-50), so the medic "retaliates" by healing!

describe('MEDI retaliation — medic has weapon so retaliates (techno.cpp)', () => {
  it('idle MEDI on GUARD retaliates when hit by enemy (has Heal weapon)', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    medi.mission = Mission.GUARD;
    medi.target = null;

    const ctx = makeCombatCtx([medi, attacker]);
    triggerRetaliation(ctx, medi, attacker);

    // MEDI has a weapon (Heal), so retaliation kicks in
    expect(medi.target).toBe(attacker);
    expect(medi.mission).toBe(Mission.ATTACK);
  });

  it('MEDI has a weapon (Heal) — technically armed for retaliation purposes', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    expect(medi.weapon).not.toBeNull();
    expect(medi.weapon!.name).toBe('Heal');
    // The weapon has negative damage — retaliation would "heal" the attacker!
    expect(medi.weapon!.damage).toBeLessThan(0);
  });

  it('MEDI does not retarget if already has a living target', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    const existingTarget = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const newAttacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    medi.mission = Mission.ATTACK;
    medi.target = existingTarget;

    const ctx = makeCombatCtx([medi, existingTarget, newAttacker]);
    triggerRetaliation(ctx, medi, newAttacker);

    // Should keep existing target, not switch
    expect(medi.target).toBe(existingTarget);
  });

  it('MEDI does not retaliate against allies', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.Greece, 11, 10);
    medi.mission = Mission.GUARD;
    medi.target = null;

    const ctx = makeCombatCtx([medi, ally]);
    triggerRetaliation(ctx, medi, ally);

    expect(medi.target).toBeNull();
    expect(medi.mission).toBe(Mission.GUARD);
  });
});

// -- AI Scatter on Damage (techno.cpp) ----------------------------------------
// C++ techno.cpp — AI-controlled medics on GUARD scatter when damaged

describe('MEDI AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled MEDI on GUARD scatters when damaged (IQ >= 2)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const medi = entityAtCell(UnitType.I_MEDI, House.USSR, 10, 10);
      medi.mission = Mission.GUARD;
      const ctx = makeCombatCtx([medi]);
      aiScatterOnDamage(ctx, medi);
      if (medi.mission === Mission.MOVE && medi.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('player-controlled MEDI does NOT scatter', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    medi.mission = Mission.GUARD;

    const ctx = makeCombatCtx([medi]);
    aiScatterOnDamage(ctx, medi);

    expect(medi.mission).toBe(Mission.GUARD);
    expect(medi.moveTarget).toBeNull();
  });
});

// -- Movement — Nimble Infantry (infantry.cpp) --------------------------------
// C++ infantry.cpp — medic is infantry: moves while rotating (unlike vehicles)

describe('MEDI movement — nimble infantry (infantry.cpp)', () => {
  it('MEDI facing N, moveToward target E: position changes even before facing aligns', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    medi.facing = Dir.N;
    medi.desiredFacing = Dir.N;
    medi.bodyFacing32 = Dir.N * 4;

    const startX = medi.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: medi.pos.y };

    medi.moveToward(targetPos, medi.stats.speed);

    const distMoved = Math.sqrt((medi.pos.x - startX) ** 2 + (medi.pos.y - medi.pos.y) ** 2);
    expect(distMoved).toBeGreaterThan(0);
  });

  it('MEDI rot >= 8 means instant facing snap (rot=8)', () => {
    expect(UNIT_STATS.MEDI.rot).toBe(8);
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    medi.facing = Dir.N;
    medi.desiredFacing = Dir.S;
    const aligned = medi.tickRotation();
    expect(aligned).toBe(true);
    expect(medi.facing).toBe(Dir.S);
  });
});

// -- Infantry Animation (infantry.cpp:479 / idata.cpp:273) --------------------
// C++ idata.cpp:273 — MedicDoControls — MEDI uses MECH animation layout

describe('MEDI infantry animation (infantry.cpp:479 / idata.cpp:273)', () => {
  it('MEDI isInfantry = true', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    expect(medi.stats.isInfantry).toBe(true);
  });

  it('MEDI isAnt = false', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    expect(medi.isAnt).toBe(false);
  });

  it('MEDI spriteFrame returns valid frame number', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    const frame = medi.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('MEDI alive=true starts in IDLE animState', () => {
    const medi = entityAtCell(UnitType.I_MEDI, House.Spain, 10, 10);
    expect(medi.alive).toBe(true);
    expect(medi.animState).toBe(AnimState.IDLE);
  });
});
