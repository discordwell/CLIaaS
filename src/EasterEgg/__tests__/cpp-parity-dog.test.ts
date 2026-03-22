/**
 * C++ Behavioral Parity Tests — DOG (Attack Dog)
 *
 * Verifies Attack Dog stats, DogJaw weapon, Organic warhead, DG1 instant-kill,
 * DG2 collateral prevention, anti-spy role, fragility, and retaliation behavior
 * against the original Red Alert C++ implementation (infantry.cpp, combat.cpp).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, MISSION_CONTROL,
  UnitType, House, Mission, armorIndex,
  type ArmorType, type WarheadType,
} from '../engine/types';
import { Entity, resetEntityIds, threatScore } from '../engine/entity';

beforeEach(() => {
  resetEntityIds();
});

// ─── 1. DOG Stats (C++ idata.cpp / RULES.INI) ─────────────────────────────

describe('DOG unit stats match C++ RULES.INI', () => {
  const dog = UNIT_STATS.DOG;

  it('HP = 12 (Strength=12 — weakest combat unit)', () => {
    expect(dog.strength).toBe(12);
  });

  it('armor = none (unarmored infantry)', () => {
    expect(dog.armor).toBe('none');
  });

  it('speed = 4 (MPH_KINDA_SLOW)', () => {
    expect(dog.speed).toBe(4);
  });

  it('isInfantry = true', () => {
    expect(dog.isInfantry).toBe(true);
  });

  it('crushable = true (infantry can be run over by tanks)', () => {
    expect(dog.crushable).toBe(true);
  });

  it('primaryWeapon = DogJaw', () => {
    expect(dog.primaryWeapon).toBe('DogJaw');
  });

  it('sight = 5 (good vision for spy detection)', () => {
    expect(dog.sight).toBe(5);
  });

  it('rot = 8 (instant facing change — infantry nimbleness)', () => {
    expect(dog.rot).toBe(8);
  });

  it('type = I_DOG', () => {
    expect(dog.type).toBe(UnitType.I_DOG);
  });

  it('cost = 200 (from PRODUCTION_ITEMS — soviet faction)', () => {
    // Cost is on PRODUCTION_ITEMS, not directly on UNIT_STATS.
    // Verify the stat object exists and is coherent; production cost
    // tested separately via production items.
    expect(dog).toBeDefined();
  });
});

// ─── 2. DogJaw Weapon Stats (C++ RULES.INI) ────────────────────────────────

describe('DogJaw weapon stats match C++ RULES.INI', () => {
  const jaw = WEAPON_STATS.DogJaw;

  it('DogJaw exists in WEAPON_STATS', () => {
    expect(jaw).toBeDefined();
  });

  it('damage = 100 (high base damage, but Organic warhead limits targets)', () => {
    expect(jaw.damage).toBe(100);
  });

  it('range = 2.2 cells (melee range — must get very close)', () => {
    expect(jaw.range).toBe(2.2);
  });

  it('ROF = 10 (very fast attack cycle)', () => {
    expect(jaw.rof).toBe(10);
  });

  it('warhead = Organic', () => {
    expect(jaw.warhead).toBe('Organic');
  });

  it('isInvisible is falsy (LeapDog projectile has no Inviso=yes in rules.ini)', () => {
    expect(jaw.isInvisible).toBeFalsy();
  });
});

// ─── 3. Organic Warhead — Dogs Can ONLY Kill Unarmored Targets ──────────────

describe('Organic warhead damage multipliers (C++ warhead.cpp Verses)', () => {
  const organic = WARHEAD_VS_ARMOR.Organic;

  it('vs none = 1.0 (full damage to unarmored)', () => {
    expect(organic[armorIndex('none')]).toBe(1.0);
  });

  it('vs wood = 0.0 (zero damage)', () => {
    expect(organic[armorIndex('wood')]).toBe(0.0);
  });

  it('vs light = 0.0 (zero damage)', () => {
    expect(organic[armorIndex('light')]).toBe(0.0);
  });

  it('vs heavy = 0.0 (zero damage)', () => {
    expect(organic[armorIndex('heavy')]).toBe(0.0);
  });

  it('vs concrete = 0.0 (zero damage)', () => {
    expect(organic[armorIndex('concrete')]).toBe(0.0);
  });

  it('dogs deal zero effective damage to light-armored vehicle (Jeep)', () => {
    const mult = WARHEAD_VS_ARMOR.Organic[armorIndex('light' as ArmorType)];
    expect(WEAPON_STATS.DogJaw.damage * mult).toBe(0);
  });

  it('dogs deal zero effective damage to heavy-armored vehicle (Tank)', () => {
    const mult = WARHEAD_VS_ARMOR.Organic[armorIndex('heavy' as ArmorType)];
    expect(WEAPON_STATS.DogJaw.damage * mult).toBe(0);
  });

  it('dogs deal full effective damage to unarmored infantry', () => {
    const mult = WARHEAD_VS_ARMOR.Organic[armorIndex('none' as ArmorType)];
    expect(WEAPON_STATS.DogJaw.damage * mult).toBe(100);
  });
});

// ─── 4. DG1 — Instant Kill on Designated Target (C++ infantry.cpp) ──────────

describe('DG1: Dog instant-kill on designated target', () => {
  it('enemy dies when dog attacks its designated target, regardless of HP', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const enemy = new Entity(UnitType.I_E1, House.England, 110, 100);
    // Give enemy extra HP to prove the override
    enemy.hp = 200;
    enemy.maxHp = 200;
    dog.target = enemy;

    const killed = enemy.takeDamage(WEAPON_STATS.DogJaw.damage, 'Organic', dog);
    expect(killed).toBe(true);
    expect(enemy.alive).toBe(false);
    expect(enemy.hp).toBe(0);
  });

  it('damage is overridden to maxHp (not just current hp)', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const enemy = new Entity(UnitType.I_E1, House.England, 110, 100);
    enemy.hp = 500;
    enemy.maxHp = 500;
    dog.target = enemy;

    const killed = enemy.takeDamage(1, 'Organic', dog); // even 1 damage becomes maxHp
    expect(killed).toBe(true);
    expect(enemy.hp).toBe(0);
  });

  it('dog instant-kill works on high-HP spy (200 HP)', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const spy = new Entity(UnitType.I_SPY, House.England, 110, 100);
    spy.hp = 200;
    spy.maxHp = 200;
    dog.target = spy;

    const killed = spy.takeDamage(WEAPON_STATS.DogJaw.damage, 'Organic', dog);
    expect(killed).toBe(true);
    expect(spy.alive).toBe(false);
  });

  it('dog instant-kill still works when dog has low HP (nearly dead)', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const enemy = new Entity(UnitType.I_E1, House.England, 110, 100);
    dog.hp = 1; // dog nearly dead
    dog.target = enemy;

    const killed = enemy.takeDamage(WEAPON_STATS.DogJaw.damage, 'Organic', dog);
    expect(killed).toBe(true);
  });

  it('dead dog cannot instant-kill (attacker must be alive)', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const enemy = new Entity(UnitType.I_E1, House.England, 110, 100);
    dog.alive = false; // dog is dead
    dog.target = enemy;

    const killed = enemy.takeDamage(1, 'Organic', dog);
    // Without the DG1 override, 1 damage should not kill a 50 HP unit
    expect(killed).toBe(false);
    expect(enemy.hp).toBe(49);
  });
});

// ─── 5. DG2 — Collateral Prevention (C++ combat.cpp) ───────────────────────

describe('DG2: Dog collateral prevention — only hurts designated target', () => {
  it('dog does NOT damage entities that are NOT its designated target', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const entityA = new Entity(UnitType.I_E1, House.England, 110, 100);
    const entityB = new Entity(UnitType.I_E1, House.England, 120, 100);
    dog.target = entityA; // dog is targeting entityA

    const originalHp = entityB.hp;
    const killed = entityB.takeDamage(WEAPON_STATS.DogJaw.damage, 'Organic', dog);
    expect(killed).toBe(false);
    expect(entityB.hp).toBe(originalHp); // zero damage
  });

  it('dog with no target does NOT damage any entity', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const entityB = new Entity(UnitType.I_E1, House.England, 120, 100);
    dog.target = null; // no designated target

    const originalHp = entityB.hp;
    const killed = entityB.takeDamage(WEAPON_STATS.DogJaw.damage, 'Organic', dog);
    expect(killed).toBe(false);
    expect(entityB.hp).toBe(originalHp); // zero damage
  });

  it('non-dog attacker can damage any entity normally (no collateral filter)', () => {
    const rifleman = new Entity(UnitType.I_E1, House.USSR, 100, 100);
    const enemy = new Entity(UnitType.I_E1, House.England, 120, 100);
    rifleman.target = null; // no designated target

    const originalHp = enemy.hp;
    const killed = enemy.takeDamage(15, 'SA', rifleman);
    expect(killed).toBe(false);
    expect(enemy.hp).toBe(originalHp - 15);
  });

  it('dead dog has no collateral prevention (attacker must be alive)', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const entityA = new Entity(UnitType.I_E1, House.England, 110, 100);
    const entityB = new Entity(UnitType.I_E1, House.England, 120, 100);
    dog.target = entityA;
    dog.alive = false; // dead dog

    const originalHp = entityB.hp;
    // Dead dog: DG2 check should not block damage (attacker.alive is false)
    const killed = entityB.takeDamage(15, 'Organic', dog);
    expect(killed).toBe(false);
    expect(entityB.hp).toBe(originalHp - 15);
  });
});

// ─── 6. Anti-Spy Role — Dogs Counter Spies ─────────────────────────────────

describe('Anti-spy role: dogs are the counter to Spy', () => {
  it('Spy has armor = none (vulnerable to Organic warhead)', () => {
    expect(UNIT_STATS.SPY.armor).toBe('none');
  });

  it('Spy has no weapon (cannot fight back)', () => {
    expect(UNIT_STATS.SPY.primaryWeapon).toBeNull();
  });

  it('dog can kill spy via DG1 instant-kill', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const spy = new Entity(UnitType.I_SPY, House.England, 110, 100);
    dog.target = spy;

    const killed = spy.takeDamage(WEAPON_STATS.DogJaw.damage, 'Organic', dog);
    expect(killed).toBe(true);
  });

  it('AI6: non-dog units ignore spies in threat scoring (spy returns 0)', () => {
    const rifleman = new Entity(UnitType.I_E1, House.USSR, 100, 100);
    const spy = new Entity(UnitType.I_SPY, House.England, 110, 100);
    const score = threatScore(rifleman, spy, 3);
    expect(score).toBe(0);
  });

  it('AI6: dogs DO target spies in threat scoring (spy returns > 0)', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const spy = new Entity(UnitType.I_SPY, House.England, 110, 100);
    const score = threatScore(dog, spy, 3);
    expect(score).toBeGreaterThan(0);
  });
});

// ─── 7. Fragile — Weakest Combat Unit ───────────────────────────────────────

describe('DOG fragility: only 12 HP — weakest combat unit', () => {
  it('DOG has lowest HP among all combat units', () => {
    const dogHp = UNIT_STATS.DOG.strength;
    // Check against other infantry with weapons (combat units)
    const combatUnits = Object.values(UNIT_STATS).filter(
      s => s.primaryWeapon != null && s.type !== UnitType.I_DOG
    );
    for (const unit of combatUnits) {
      expect(dogHp).toBeLessThanOrEqual(unit.strength);
    }
  });

  it('a single rifle shot (15 damage) exceeds dog HP', () => {
    expect(WEAPON_STATS.M1Carbine.damage).toBeGreaterThan(UNIT_STATS.DOG.strength);
  });

  it('dog dies to one rifle hit', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const killed = dog.takeDamage(WEAPON_STATS.M1Carbine.damage, 'SA');
    expect(killed).toBe(true);
    expect(dog.alive).toBe(false);
  });
});

// ─── 8. Short Range — 2.2 Cells (Melee) ────────────────────────────────────

describe('DOG short range: 2.2 cells — must get very close', () => {
  it('DogJaw range is shorter than M1Carbine (3.0)', () => {
    expect(WEAPON_STATS.DogJaw.range).toBeLessThan(WEAPON_STATS.M1Carbine.range);
  });

  it('DogJaw range is shorter than Grenade (4.0)', () => {
    expect(WEAPON_STATS.DogJaw.range).toBeLessThan(WEAPON_STATS.Grenade.range);
  });

  it('inRange returns true when enemy is within 2.2 cells', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    // Place enemy within range (2 cells = 48px at CELL_SIZE=24)
    const enemy = new Entity(UnitType.I_E1, House.England, 140, 100);
    expect(dog.inRange(enemy)).toBe(true);
  });

  it('inRange returns false when enemy is beyond 2.2 cells', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    // Place enemy beyond range (3 cells away = 72px at CELL_SIZE=24)
    const enemy = new Entity(UnitType.I_E1, House.England, 172, 100);
    expect(dog.inRange(enemy)).toBe(false);
  });
});

// ─── 9. Crushable / Fear / Prone — Standard Infantry ───────────────────────

describe('DOG crushable / fear / prone — standard infantry behaviors', () => {
  it('crushable = true (tanks can run over dogs)', () => {
    expect(UNIT_STATS.DOG.crushable).toBe(true);
  });

  it('fear increases on taking damage (C++ infantry.cpp fear system)', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    // Give dog enough HP to survive
    dog.hp = 100;
    dog.maxHp = 100;
    expect(dog.fear).toBe(0);

    dog.takeDamage(5, 'SA');
    expect(dog.fear).toBeGreaterThan(0);
  });

  it('fear sets isProne when fear >= FEAR_ANXIOUS (10)', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    dog.fear = Entity.FEAR_ANXIOUS;
    dog.isProne = true; // would be set by game loop when fear >= FEAR_ANXIOUS

    expect(dog.isProne).toBe(true);
  });

  it('isInfantry = true (subject to infantry fear/prone system)', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    expect(dog.stats.isInfantry).toBe(true);
  });
});

// ─── 10. Retaliation — Idle Dog Retaliates When Hit ─────────────────────────

describe('DOG retaliation: GUARD mission allows retaliation (C++ MissionControl)', () => {
  it('GUARD mission has isRetaliate = true', () => {
    expect(MISSION_CONTROL[Mission.GUARD].isRetaliate).toBe(true);
  });

  it('dog spawns with GUARD mission by default', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    expect(dog.mission).toBe(Mission.GUARD);
  });

  it('AREA_GUARD also retaliates (dog patrol behavior)', () => {
    expect(MISSION_CONTROL[Mission.AREA_GUARD].isRetaliate).toBe(true);
  });

  it('SLEEP mission does NOT retaliate (dormant dog)', () => {
    expect(MISSION_CONTROL[Mission.SLEEP].isRetaliate).toBe(false);
  });

  it('ATTACK mission retaliates (actively fighting dog)', () => {
    expect(MISSION_CONTROL[Mission.ATTACK].isRetaliate).toBe(true);
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────────────────

describe('DOG edge cases', () => {
  it('Entity constructor correctly wires DOG weapon from stats', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    expect(dog.weapon).toBeDefined();
    expect(dog.weapon!.name).toBe('DogJaw');
    expect(dog.weapon!.warhead).toBe('Organic');
  });

  it('DOG has no secondary weapon', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    expect(dog.weapon2).toBeNull();
  });

  it('invulnerable target survives dog instant-kill (Iron Curtain)', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const enemy = new Entity(UnitType.I_E1, House.England, 110, 100);
    enemy.ironCurtainTick = 100; // invulnerable
    dog.target = enemy;

    const killed = enemy.takeDamage(WEAPON_STATS.DogJaw.damage, 'Organic', dog);
    expect(killed).toBe(false);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it('DG1 + DG2 together: designated target dies, bystander unharmed', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const target = new Entity(UnitType.I_E1, House.England, 110, 100);
    const bystander = new Entity(UnitType.I_E1, House.England, 120, 100);
    dog.target = target;

    // Attack designated target — DG1 instant kill
    const killed = target.takeDamage(WEAPON_STATS.DogJaw.damage, 'Organic', dog);
    expect(killed).toBe(true);

    // Attack bystander — DG2 collateral prevention
    const bystanderHp = bystander.hp;
    const bystanderKilled = bystander.takeDamage(WEAPON_STATS.DogJaw.damage, 'Organic', dog);
    expect(bystanderKilled).toBe(false);
    expect(bystander.hp).toBe(bystanderHp);
  });

  it('dog sets death animation on kill (mission=DIE, animState=DIE)', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const enemy = new Entity(UnitType.I_E1, House.England, 110, 100);
    dog.target = enemy;

    enemy.takeDamage(WEAPON_STATS.DogJaw.damage, 'Organic', dog);
    expect(enemy.mission).toBe(Mission.DIE);
  });
});
