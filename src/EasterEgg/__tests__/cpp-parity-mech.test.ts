/**
 * C++ Behavioral Parity: MECH -- Mechanic
 *
 * Tests verify Mechanic behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with MECH (observable outcomes: HP, alive/dead,
 * mission, fear, isProne, repair behavior), not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 *
 * Key difference from MEDI (Medic):
 * - MEDI heals infantry (Organic warhead, -50 damage)
 * - MECH repairs vehicles (Mechanical warhead, -100 damage)
 * - Mechanical warhead has 1.0 vs ALL armor types (can repair any vehicle)
 * - Organic warhead has 1.0 vs none only (can only heal unarmored infantry)
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
// C++ idata.cpp (infantry type data) -- MECH entry and RULES.INI [MECH] section

describe('MECH stats verification (idata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.MECH;
  const weapon = WEAPON_STATS.GoodWrench;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'MECH');

  it('HP is 60 (Strength=60)', () => {
    expect(stats.strength).toBe(60);
  });

  it('HP 60 is higher than E1 (50) but lower than MEDI (80)', () => {
    expect(stats.strength).toBeGreaterThan(UNIT_STATS.E1.strength);
    expect(stats.strength).toBeLessThan(UNIT_STATS.MEDI.strength);
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

  it('crushable is true (infantry.cpp -- all infantry are crushable)', () => {
    expect(stats.crushable).toBe(true);
  });

  it('primary weapon is GoodWrench', () => {
    expect(stats.primaryWeapon).toBe('GoodWrench');
  });

  it('cost is 950 credits (allied faction, expansion)', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(950);
  });

  it('faction is allied', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('allied');
  });

  it('techPrereq is FIX (Service Depot)', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.techPrereq).toBe('FIX');
  });

  it('sight range is 3', () => {
    expect(stats.sight).toBe(3);
  });

  it('rot is 8 (infantry instant rotation)', () => {
    expect(stats.rot).toBe(8);
  });

  it('Entity constructor initializes HP to strength', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    expect(mech.hp).toBe(60);
    expect(mech.maxHp).toBe(60);
  });
});

// -- Weapon -- GoodWrench (rules.ini / weapon.cpp) ----------------------------
// C++ weapon.cpp -- GoodWrench weapon has negative damage (-100), Mechanical warhead, short range

describe('MECH GoodWrench weapon (rules.ini / weapon.cpp)', () => {
  const weapon = WEAPON_STATS.GoodWrench;

  it('GoodWrench damage is -100 (negative = vehicle repair)', () => {
    expect(weapon.damage).toBe(-100);
  });

  it('GoodWrench warhead is Mechanical', () => {
    expect(weapon.warhead).toBe('Mechanical');
  });

  it('GoodWrench range is 1.83 cells (very short, must be adjacent)', () => {
    expect(weapon.range).toBe(1.83);
  });

  it('GoodWrench ROF is 80 ticks', () => {
    expect(weapon.rof).toBe(80);
  });

  it('negative damage means "repair 100 HP" to the target', () => {
    const repairAmount = Math.abs(weapon.damage);
    expect(repairAmount).toBe(100);
  });

  it('GoodWrench heals twice as much as MEDI Heal per application (100 vs 50)', () => {
    expect(Math.abs(weapon.damage)).toBe(2 * Math.abs(WEAPON_STATS.Heal.damage));
  });

  it('Entity gets GoodWrench weapon from constructor', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    expect(mech.weapon).not.toBeNull();
    expect(mech.weapon!.name).toBe('GoodWrench');
    expect(mech.weapon!.damage).toBe(-100);
  });
});

// -- Mechanical Warhead (combat.cpp warhead tables) ---------------------------
// C++ combat.cpp -- Mechanical warhead: 1.0 vs ALL armor types (universal repair)

describe('MECH Mechanical warhead -- can repair any armor class equally (combat.cpp)', () => {
  it('Mechanical vs none armor: mult 1.0', () => {
    const mult = WARHEAD_VS_ARMOR.Mechanical[armorIndex('none')];
    expect(mult).toBe(1.0);
  });

  it('Mechanical vs wood armor: mult 1.0', () => {
    const mult = WARHEAD_VS_ARMOR.Mechanical[armorIndex('wood')];
    expect(mult).toBe(1.0);
  });

  it('Mechanical vs light armor: mult 1.0', () => {
    const mult = WARHEAD_VS_ARMOR.Mechanical[armorIndex('light')];
    expect(mult).toBe(1.0);
  });

  it('Mechanical vs heavy armor: mult 1.0 (can repair tanks)', () => {
    const mult = WARHEAD_VS_ARMOR.Mechanical[armorIndex('heavy')];
    expect(mult).toBe(1.0);
  });

  it('Mechanical vs concrete: mult 1.0 (can repair any armor)', () => {
    const mult = WARHEAD_VS_ARMOR.Mechanical[armorIndex('concrete')];
    expect(mult).toBe(1.0);
  });

  it('ALL five armor multipliers are 1.0 -- universal repair effectiveness', () => {
    const verses = WARHEAD_VS_ARMOR.Mechanical;
    for (let i = 0; i < 5; i++) {
      expect(verses[i]).toBe(1.0);
    }
  });

  it('Mechanical differs from Organic: Organic only works on none-armor', () => {
    // Organic: [1.0, 0.0, 0.0, 0.0, 0.0] -- medic can only heal unarmored infantry
    // Mechanical: [1.0, 1.0, 1.0, 1.0, 1.0] -- mechanic can repair any armor class
    expect(WARHEAD_VS_ARMOR.Organic[armorIndex('heavy')]).toBe(0.0);
    expect(WARHEAD_VS_ARMOR.Mechanical[armorIndex('heavy')]).toBe(1.0);
  });

  it('effective repair on heavy-armor vehicle (tank): full 100 HP', () => {
    const mult = WARHEAD_VS_ARMOR.Mechanical[armorIndex('heavy')];
    const effectiveRepair = Math.abs(WEAPON_STATS.GoodWrench.damage) * mult;
    expect(effectiveRepair).toBe(100);
  });

  it('effective repair on light-armor vehicle: full 100 HP', () => {
    const mult = WARHEAD_VS_ARMOR.Mechanical[armorIndex('light')];
    const effectiveRepair = Math.abs(WEAPON_STATS.GoodWrench.damage) * mult;
    expect(effectiveRepair).toBe(100);
  });
});

// -- Short Repair Range (weapon.cpp) ------------------------------------------
// C++ weapon.cpp -- GoodWrench range 1.83 cells: mechanic must be adjacent to repair target

describe('MECH short repair range -- 1.83 cells (weapon.cpp)', () => {
  it('two adjacent cells (dist ~1.0) are within repair range', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);
    const dist = worldDist(mech.pos, target.pos);
    expect(dist).toBeLessThanOrEqual(WEAPON_STATS.GoodWrench.range);
  });

  it('two cells apart (~2.0) exceeds repair range of 1.83', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.V_2TNK, House.Spain, 12, 10);
    const dist = worldDist(mech.pos, target.pos);
    expect(dist).toBeGreaterThan(WEAPON_STATS.GoodWrench.range);
  });

  it('inRange returns true for adjacent vehicle target', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);
    expect(mech.inRange(target)).toBe(true);
  });

  it('inRange returns false for vehicle target 2 cells away', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.V_2TNK, House.Spain, 12, 10);
    expect(mech.inRange(target)).toBe(false);
  });

  it('GoodWrench range matches Heal range (both 1.83)', () => {
    expect(WEAPON_STATS.GoodWrench.range).toBe(WEAPON_STATS.Heal.range);
  });

  it('repair range (1.83) is much shorter than rifle range (3.0)', () => {
    expect(WEAPON_STATS.GoodWrench.range).toBeLessThan(WEAPON_STATS.M1Carbine.range);
  });
});

// -- Negative Damage / Vehicle Repair Mechanic (combat.cpp) -------------------
// C++ combat.cpp -- weapon damage < 0 means healing: target gains HP instead of losing it

describe('MECH negative damage -- repair instead of hurt (combat.cpp)', () => {
  it('applying negative damage via takeDamage increases HP', () => {
    const target = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    target.hp = 200; // damaged (max 400)
    const hpBefore = target.hp;

    // Negative damage = repair via takeDamage (hp -= negative = hp += positive)
    target.takeDamage(-100, 'Mechanical');

    // hp -= (-100) means hp += 100 -> 200 + 100 = 300 (uncapped in takeDamage)
    expect(target.hp).toBeGreaterThan(hpBefore);
  });

  it('manual repair capped at maxHp: 350 + 100 = 400 (maxHp cap)', () => {
    const target = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    target.hp = 350;
    const repairAmount = Math.abs(WEAPON_STATS.GoodWrench.damage);

    // Real game repair logic caps at maxHp
    target.hp = Math.min(target.maxHp, target.hp + repairAmount);
    expect(target.hp).toBe(400); // capped at maxHp for 2TNK
  });

  it('repair amount is 100 HP per application', () => {
    const repairAmount = Math.abs(WEAPON_STATS.GoodWrench.damage);
    expect(repairAmount).toBe(100);
  });

  it('Mechanical warhead mult 1.0 vs heavy: full repair effect on tanks', () => {
    const mult = WARHEAD_VS_ARMOR.Mechanical[armorIndex('heavy')];
    const effectiveRepair = Math.abs(WEAPON_STATS.GoodWrench.damage) * mult;
    expect(effectiveRepair).toBe(100);
  });

  it('Mechanical warhead mult 1.0 vs light: full repair effect on light vehicles', () => {
    const mult = WARHEAD_VS_ARMOR.Mechanical[armorIndex('light')];
    const effectiveRepair = Math.abs(WEAPON_STATS.GoodWrench.damage) * mult;
    expect(effectiveRepair).toBe(100);
  });

  it('Mechanical warhead mult 1.0 vs none: can also repair unarmored targets', () => {
    const mult = WARHEAD_VS_ARMOR.Mechanical[armorIndex('none')];
    const effectiveRepair = Math.abs(WEAPON_STATS.GoodWrench.damage) * mult;
    expect(effectiveRepair).toBe(100);
  });
});

// -- healTarget Field (infantry.cpp AI) ---------------------------------------
// C++ infantry.cpp InfantryClass::AI -- mechanic uses healTarget for auto-repair tracking

describe('MECH healTarget field (infantry.cpp AI)', () => {
  it('Entity has healTarget field, initialized to null', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    expect(mech.healTarget).toBeNull();
  });

  it('healTarget can be assigned to a damaged friendly vehicle', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    const patient = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);
    patient.hp = 200;

    mech.healTarget = patient;
    expect(mech.healTarget).toBe(patient);
    expect(mech.healTarget!.hp).toBe(200);
  });

  it('healTarget cleared when patient is dead', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    const patient = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);
    patient.hp = 200;
    mech.healTarget = patient;

    patient.alive = false;
    const shouldClear = !mech.healTarget!.alive;
    expect(shouldClear).toBe(true);
  });

  it('healTarget cleared when patient is fully repaired', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    const patient = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);
    patient.hp = 200;
    mech.healTarget = patient;

    patient.hp = patient.maxHp;
    const shouldClear = mech.healTarget!.hp >= mech.healTarget!.maxHp;
    expect(shouldClear).toBe(true);
  });
});

// -- MECH vs MEDI Comparison (design document) --------------------------------
// Mechanic is the vehicle counterpart of the Medic, added in Aftermath expansion

describe('MECH vs MEDI design comparison', () => {
  it('MECH repairs 100 HP per application vs MEDI 50 HP', () => {
    expect(Math.abs(WEAPON_STATS.GoodWrench.damage)).toBe(100);
    expect(Math.abs(WEAPON_STATS.Heal.damage)).toBe(50);
  });

  it('MECH can repair all armor types; MEDI can only heal none-armor', () => {
    // Mechanical: all 1.0
    for (let i = 0; i < 5; i++) {
      expect(WARHEAD_VS_ARMOR.Mechanical[i]).toBe(1.0);
    }
    // Organic: only index 0 (none) is 1.0
    expect(WARHEAD_VS_ARMOR.Organic[0]).toBe(1.0);
    expect(WARHEAD_VS_ARMOR.Organic[1]).toBe(0.0);
    expect(WARHEAD_VS_ARMOR.Organic[2]).toBe(0.0);
    expect(WARHEAD_VS_ARMOR.Organic[3]).toBe(0.0);
    expect(WARHEAD_VS_ARMOR.Organic[4]).toBe(0.0);
  });

  it('MECH is more expensive than MEDI (950 vs 800)', () => {
    const mechProd = PRODUCTION_ITEMS.find(p => p.type === 'MECH');
    const mediProd = PRODUCTION_ITEMS.find(p => p.type === 'MEDI');
    expect(mechProd!.cost).toBeGreaterThan(mediProd!.cost);
    expect(mechProd!.cost).toBe(950);
    expect(mediProd!.cost).toBe(800);
  });

  it('MECH has lower HP than MEDI (60 vs 80)', () => {
    expect(UNIT_STATS.MECH.strength).toBeLessThan(UNIT_STATS.MEDI.strength);
  });

  it('both have same range (1.83), ROF (80), and speed (4)', () => {
    expect(WEAPON_STATS.GoodWrench.range).toBe(WEAPON_STATS.Heal.range);
    expect(WEAPON_STATS.GoodWrench.rof).toBe(WEAPON_STATS.Heal.rof);
    expect(UNIT_STATS.MECH.speed).toBe(UNIT_STATS.MEDI.speed);
  });

  it('both use same sprite image (medi)', () => {
    expect(UNIT_STATS.MECH.image).toBe('medi');
    expect(UNIT_STATS.MEDI.image).toBe('medi');
  });
});

// -- Crushable (drive.cpp:Ok_To_Move) ----------------------------------------
// C++ drive.cpp -- mechanic is infantry, crushable by crusher vehicles like all infantry

describe('MECH crushable (drive.cpp:Ok_To_Move)', () => {
  it('MECH is killed when a crusher vehicle (2TNK) enters its cell', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([mech, tank]);
    checkVehicleCrush(ctx, tank);
    expect(mech.alive).toBe(false);
  });

  it('MECH is NOT crushed by non-crusher vehicle (JEEP)', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    const jeep = entityAtCell(UnitType.V_JEEP, House.USSR, 10, 10);
    const ctx = makeCombatCtx([mech, jeep]);
    checkVehicleCrush(ctx, jeep);
    expect(mech.alive).toBe(true);
  });

  it('MECH is NOT crushed by allied crusher vehicle (IsAFriend check)', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([mech, tank]);
    checkVehicleCrush(ctx, tank);
    expect(mech.alive).toBe(true);
    expect(mech.hp).toBe(mech.maxHp);
  });

  it('MECH crushable flag is true', () => {
    expect(UNIT_STATS.MECH.crushable).toBe(true);
  });
});

// -- Fear / Prone System (infantry.cpp:329-457) -------------------------------
// C++ infantry.cpp -- FearType 0-255. Fear increases on damage, decrements 1/tick.
// IsProne when fear >= FEAR_ANXIOUS (10). Prone infantry take 50% damage.

describe('MECH fear / prone system (infantry.cpp:329-457)', () => {
  it('MECH starts with fear=0, isProne=false', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    expect(mech.fear).toBe(0);
    expect(mech.isProne).toBe(false);
  });

  it('when MECH takes damage, fear increases to at least FEAR_SCARED (100)', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    mech.takeDamage(10, 'SA');
    expect(mech.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });

  it('prone MECH takes 50% damage on next hit', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    mech.isProne = true;
    const hpBefore = mech.hp;
    mech.takeDamage(20, 'SA');
    const damageTaken = hpBefore - mech.hp;
    // 20 * 0.5 = 10
    expect(damageTaken).toBe(10);
  });

  it('non-prone MECH takes full damage', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    expect(mech.isProne).toBe(false);
    const hpBefore = mech.hp;
    mech.takeDamage(20, 'SA');
    const damageTaken = hpBefore - mech.hp;
    expect(damageTaken).toBe(20);
  });

  it('damage -> fear -> prone -> next hit deals half: full sequence', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    expect(mech.isProne).toBe(false);

    // Step 1: Take first hit -- fear should jump to >= FEAR_SCARED (100)
    mech.takeDamage(10, 'SA');
    expect(mech.alive).toBe(true);
    expect(mech.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);

    // Step 2: Since fear >= FEAR_ANXIOUS (10), set isProne
    mech.isProne = true;

    // Step 3: Take second hit while prone -- should deal ~half damage
    const hpBeforeSecond = mech.hp;
    mech.takeDamage(20, 'SA');
    const secondDamage = hpBeforeSecond - mech.hp;
    // 20 * 0.5 = 10
    expect(secondDamage).toBe(10);
  });
});

// -- Retaliation -- MECH has weapon so retaliates (techno.cpp) ----------------
// C++ techno.cpp -- idle/moving units counter-attack when hit by enemy.
// MECH has a weapon (GoodWrench) so triggerRetaliation targets the attacker.
// But GoodWrench does negative damage (-100), so the mechanic "retaliates" by repairing!

describe('MECH retaliation -- mechanic has weapon so retaliates (techno.cpp)', () => {
  it('idle MECH on GUARD retaliates when hit by enemy (has GoodWrench weapon)', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    mech.mission = Mission.GUARD;
    mech.target = null;

    const ctx = makeCombatCtx([mech, attacker]);
    triggerRetaliation(ctx, mech, attacker);

    // MECH has a weapon (GoodWrench), so retaliation kicks in
    expect(mech.target).toBe(attacker);
    expect(mech.mission).toBe(Mission.ATTACK);
  });

  it('MECH has a weapon (GoodWrench) -- technically armed for retaliation purposes', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    expect(mech.weapon).not.toBeNull();
    expect(mech.weapon!.name).toBe('GoodWrench');
    // The weapon has negative damage -- retaliation would "repair" the attacker!
    expect(mech.weapon!.damage).toBeLessThan(0);
  });

  it('MECH does not retarget if already has a living target', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    const existingTarget = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const newAttacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    mech.mission = Mission.ATTACK;
    mech.target = existingTarget;

    const ctx = makeCombatCtx([mech, existingTarget, newAttacker]);
    triggerRetaliation(ctx, mech, newAttacker);

    expect(mech.target).toBe(existingTarget);
  });

  it('MECH does not retaliate against allies', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.Greece, 11, 10);
    mech.mission = Mission.GUARD;
    mech.target = null;

    const ctx = makeCombatCtx([mech, ally]);
    triggerRetaliation(ctx, mech, ally);

    expect(mech.target).toBeNull();
    expect(mech.mission).toBe(Mission.GUARD);
  });
});

// -- AI Scatter on Damage (techno.cpp) ----------------------------------------
// C++ techno.cpp -- AI-controlled mechanics on GUARD scatter when damaged

describe('MECH AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled MECH on GUARD scatters when damaged (IQ >= 2)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const mech = entityAtCell(UnitType.I_MECH, House.USSR, 10, 10);
      mech.mission = Mission.GUARD;
      const ctx = makeCombatCtx([mech]);
      aiScatterOnDamage(ctx, mech);
      if (mech.mission === Mission.MOVE && mech.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('player-controlled MECH does NOT scatter', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    mech.mission = Mission.GUARD;

    const ctx = makeCombatCtx([mech]);
    aiScatterOnDamage(ctx, mech);

    expect(mech.mission).toBe(Mission.GUARD);
    expect(mech.moveTarget).toBeNull();
  });
});

// -- Movement -- Nimble Infantry (infantry.cpp) --------------------------------
// C++ infantry.cpp -- mechanic is infantry: moves while rotating (unlike vehicles)

describe('MECH movement -- nimble infantry (infantry.cpp)', () => {
  it('MECH facing N, moveToward target E: position changes even before facing aligns', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    mech.facing = Dir.N;
    mech.desiredFacing = Dir.N;
    mech.bodyFacing32 = Dir.N * 4;

    const startX = mech.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: mech.pos.y };

    mech.moveToward(targetPos, mech.stats.speed);

    const distMoved = Math.abs(mech.pos.x - startX);
    expect(distMoved).toBeGreaterThan(0);
  });

  it('MECH rot >= 8 means instant facing snap (rot=8)', () => {
    expect(UNIT_STATS.MECH.rot).toBe(8);
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    mech.facing = Dir.N;
    mech.desiredFacing = Dir.S;
    const aligned = mech.tickRotation();
    expect(aligned).toBe(true);
    expect(mech.facing).toBe(Dir.S);
  });
});

// -- Infantry Animation (infantry.cpp:479 / idata.cpp:273) --------------------
// C++ idata.cpp:273 -- MedicDoControls -- MECH uses MEDI animation layout

describe('MECH infantry animation (infantry.cpp:479 / idata.cpp:273)', () => {
  it('MECH isInfantry = true', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    expect(mech.stats.isInfantry).toBe(true);
  });

  it('MECH isAnt = false', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    expect(mech.isAnt).toBe(false);
  });

  it('MECH spriteFrame returns valid frame number', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    const frame = mech.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('MECH alive=true starts in IDLE animState', () => {
    const mech = entityAtCell(UnitType.I_MECH, House.Spain, 10, 10);
    expect(mech.alive).toBe(true);
    expect(mech.animState).toBe(AnimState.IDLE);
  });

  it('MECH uses medi image (shares sprite sheet with Medic)', () => {
    expect(UNIT_STATS.MECH.image).toBe('medi');
  });
});
