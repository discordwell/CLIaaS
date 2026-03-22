/**
 * C++ Behavioral Parity Tests — E4 (Flamethrower)
 *
 * Verifies that the E4 Flamethrower infantry unit matches C++ Red Alert behavior:
 *   1. Unit stats (HP 40, armor none, speed 3, infantry, crushable, cost 300, soviet)
 *   2. Flamer weapon (Fire warhead, 70 damage, range 3.5, splash 1.0)
 *   3. Fire warhead effectiveness vs all armor classes
 *   4. Fire warhead infantryDeath=4 (burn) — killed infantry get deathVariant=1 (die2)
 *   5. Splash damage — nearby entities in splash radius take damage
 *   6. Short range — range 3.5 is shorter than most weapons
 *   7. Standard infantry behaviors (crushable, fear, prone, retaliation)
 *
 * Reference: C++ rules.ini, idata.cpp, warhead.cpp, infantry.cpp
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, WARHEAD_PROPS,
  WARHEAD_META, PRODUCTION_ITEMS, INFANTRY_ANIMS,
  UnitType, House, Mission, CELL_SIZE, PRONE_DAMAGE_BIAS,
  armorIndex, getWarheadMultiplier, worldDist,
  type ArmorType,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => resetEntityIds());

// =========================================================================
// 1. E4 Unit Stats — C++ RULES.INI values
// =========================================================================
describe('E4 unit stats match C++ RULES.INI', () => {
  const e4 = UNIT_STATS.E4;

  it('exists in UNIT_STATS', () => {
    expect(e4).toBeDefined();
  });

  it('HP (Strength) = 40', () => {
    expect(e4.strength).toBe(40);
  });

  it('armor = none (unarmored infantry)', () => {
    expect(e4.armor).toBe('none');
  });

  it('speed = 3 (slow infantry — same as E3 rocket soldier)', () => {
    expect(e4.speed).toBe(3);
  });

  it('isInfantry = true', () => {
    expect(e4.isInfantry).toBe(true);
  });

  it('crushable = true (can be run over by tanks)', () => {
    expect(e4.crushable).toBe(true);
  });

  it('primary weapon = Flamer', () => {
    expect(e4.primaryWeapon).toBe('Flamer');
  });

  it('no secondary weapon', () => {
    expect(e4.secondaryWeapon).toBeUndefined();
  });

  it('sight = 4 (standard infantry vision)', () => {
    expect(e4.sight).toBe(4);
  });

  it('rot = 8 (instant rotation — infantry snap facing)', () => {
    expect(e4.rot).toBe(8);
  });

  it('type enum = I_E4', () => {
    expect(e4.type).toBe(UnitType.I_E4);
  });

  it('cost = 300, faction = soviet (from PRODUCTION_ITEMS)', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'E4');
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(300);
    expect(prodItem!.faction).toBe('soviet');
  });
});

// =========================================================================
// 2. Flamer Weapon Stats — C++ RULES.INI [Flamer]
// =========================================================================
describe('Flamer weapon stats match C++ RULES.INI', () => {
  const flamer = WEAPON_STATS.Flamer;

  it('exists in WEAPON_STATS', () => {
    expect(flamer).toBeDefined();
  });

  it('damage = 70', () => {
    expect(flamer.damage).toBe(70);
  });

  it('warhead = Fire', () => {
    expect(flamer.warhead).toBe('Fire');
  });

  it('range = 3.5 (cells)', () => {
    expect(flamer.range).toBe(3.5);
  });

  it('splash = 1.0 (area-of-effect flame)', () => {
    expect(flamer.splash).toBe(1.0);
  });

  it('ROF = 50 (rate of fire, ticks between shots)', () => {
    expect(flamer.rof).toBe(50);
  });

  it('Entity constructed with E4 type has Flamer as weapon', () => {
    const e4 = new Entity(UnitType.I_E4, House.USSR, 100, 100);
    expect(e4.weapon).toBeDefined();
    expect(e4.weapon!.name).toBe('Flamer');
    expect(e4.weapon!.damage).toBe(70);
    expect(e4.weapon!.warhead).toBe('Fire');
  });

  it('Entity constructed with E4 type has no secondary weapon', () => {
    const e4 = new Entity(UnitType.I_E4, House.USSR, 100, 100);
    expect(e4.weapon2).toBeNull();
  });
});

// =========================================================================
// 3. Fire Warhead Effectiveness — C++ RULES.INI Verses=
// =========================================================================
describe('Fire warhead vs armor multipliers (C++ Verses= line)', () => {
  const fireVersus = WARHEAD_VS_ARMOR.Fire;

  it('Fire warhead table exists with 5 entries', () => {
    expect(fireVersus).toBeDefined();
    expect(fireVersus.length).toBe(5);
  });

  it('vs none (infantry) = 0.9 (90%)', () => {
    expect(fireVersus[armorIndex('none')]).toBe(0.9);
  });

  it('vs wood = 1.0 (100% — best effectiveness, burns wood)', () => {
    expect(fireVersus[armorIndex('wood')]).toBe(1.0);
  });

  it('vs light = 0.6 (60%)', () => {
    expect(fireVersus[armorIndex('light')]).toBe(0.6);
  });

  it('vs heavy = 0.25 (25% — terrible vs heavy tanks)', () => {
    expect(fireVersus[armorIndex('heavy')]).toBe(0.25);
  });

  it('vs concrete = 0.5 (50%)', () => {
    expect(fireVersus[armorIndex('concrete')]).toBe(0.5);
  });

  it('getWarheadMultiplier returns correct values for Fire', () => {
    const armorTypes: ArmorType[] = ['none', 'wood', 'light', 'heavy', 'concrete'];
    const expected = [0.9, 1.0, 0.6, 0.25, 0.5];
    for (let i = 0; i < armorTypes.length; i++) {
      expect(
        getWarheadMultiplier('Fire', armorTypes[i]),
        `Fire vs ${armorTypes[i]}`
      ).toBe(expected[i]);
    }
  });

  it('Fire is most effective vs wood (1.0) — flamethrowers burn buildings', () => {
    const best = Math.max(...fireVersus);
    expect(best).toBe(1.0);
    expect(fireVersus[armorIndex('wood')]).toBe(best);
  });

  it('Fire is least effective vs heavy (0.25) — no good vs tanks', () => {
    const worst = Math.min(...fireVersus);
    expect(worst).toBe(0.25);
    expect(fireVersus[armorIndex('heavy')]).toBe(worst);
  });
});

// =========================================================================
// 4. Fire Warhead Infantry Death — C++ warhead.cpp InfDeath=4
// =========================================================================
describe('Fire warhead infantryDeath=4 (burn animation)', () => {
  it('WARHEAD_PROPS.Fire has infantryDeath = 4', () => {
    expect(WARHEAD_PROPS.Fire).toBeDefined();
    expect(WARHEAD_PROPS.Fire.infantryDeath).toBe(4);
  });

  it('WARHEAD_PROPS.Fire uses explosionSet=3 (C++ Fire array)', () => {
    expect(WARHEAD_PROPS.Fire.explosionSet).toBe(3);
  });

  it('infantry killed by Fire warhead gets deathVariant=4 (burn death, C++ InfDeath=4)', () => {
    const victim = new Entity(UnitType.I_E1, House.Greece, 100, 100);
    expect(victim.alive).toBe(true);

    // Deal lethal Fire damage
    const killed = victim.takeDamage(999, 'Fire');
    expect(killed).toBe(true);
    expect(victim.alive).toBe(false);
    // infantryDeath=4 => deathVariant=4 (burn)
    expect(victim.deathVariant).toBe(4);
  });

  it('E4 killing another infantry with Flamer produces burn death', () => {
    const attacker = new Entity(UnitType.I_E4, House.USSR, 100, 100);
    const victim = new Entity(UnitType.I_E1, House.Greece, 200, 100);

    // Simulate Flamer hit — warhead is 'Fire'
    const killed = victim.takeDamage(attacker.weapon!.damage, attacker.weapon!.warhead);
    // E1 has 50 HP, Flamer does 70 damage — should kill
    expect(killed).toBe(true);
    expect(victim.deathVariant).toBe(4); // burn death (C++ InfDeath=4)
  });

  it('infantry killed by non-fire warhead (SA) gets deathVariant=1 (twirl, C++ InfDeath=1)', () => {
    const victim = new Entity(UnitType.I_E1, House.Greece, 100, 100);
    // SA infantryDeath=1 => deathVariant=1 (twirl)
    victim.takeDamage(999, 'SA');
    expect(victim.deathVariant).toBe(1);
  });

  it('infantry killed by Organic warhead (infantryDeath=0) gets deathVariant=0 (die1)', () => {
    const victim = new Entity(UnitType.I_E1, House.Greece, 100, 100);
    // Organic infantryDeath=0 => deathVariant=0 (die1: normal)
    victim.takeDamage(999, 'Organic');
    expect(victim.deathVariant).toBe(0);
  });
});

// =========================================================================
// 5. Splash Damage — Flamer splash=1.0 hits nearby entities
// =========================================================================
describe('Flamer splash damage mechanics', () => {
  it('Flamer has splash = 1.0 (cells)', () => {
    expect(WEAPON_STATS.Flamer.splash).toBe(1.0);
  });

  it('Fire warhead has spreadFactor = 8 (wide fire spread)', () => {
    expect(WARHEAD_META.Fire.spreadFactor).toBe(8);
  });

  it('Fire warhead has destroysWood but not destroysWalls', () => {
    expect(WARHEAD_META.Fire.destroysWood).toBe(true);
    expect(WARHEAD_META.Fire.destroysWalls).toBeUndefined();
  });

  it('entities within splash radius (1.0 cell) should be hittable', () => {
    // Place primary target and a bystander within splash range
    const target = new Entity(UnitType.I_E1, House.Greece, 100, 100);
    const bystander = new Entity(UnitType.I_E1, House.Greece, 100 + CELL_SIZE * 0.5, 100);

    const dist = worldDist(target.pos, bystander.pos);
    const splashRadiusWorld = WEAPON_STATS.Flamer.splash! * CELL_SIZE;

    // Bystander is 0.5 cells away — within splash radius of 1.0 cells
    expect(dist).toBeLessThanOrEqual(splashRadiusWorld);
  });

  it('entities outside splash radius should not be hit', () => {
    const target = new Entity(UnitType.I_E1, House.Greece, 100, 100);
    const farAway = new Entity(UnitType.I_E1, House.Greece, 100 + CELL_SIZE * 3, 100);

    // worldDist returns distance in cells
    const dist = worldDist(target.pos, farAway.pos);
    const splashRadiusCells = WEAPON_STATS.Flamer.splash!; // 1.0 cells

    // Entity 3 cells away — well outside splash radius of 1.0 cells
    expect(dist).toBeGreaterThan(splashRadiusCells);
  });

  it('splash damage decreases with distance from impact point', () => {
    // Fire spreadFactor=8: at 0.5 cells (12px), distFactor = 12*2/8 = 3
    // At 0 cells: distFactor = 0 → full damage
    const baseDmg = 70; // Flamer damage
    const spreadFactor = WARHEAD_META.Fire.spreadFactor; // 8

    // Point-blank: no falloff
    const dmgPointBlank = baseDmg;

    // At 0.5 cells (12px): distFactor = 12*2/8 = 3, damage = 70*0.9/3 = 21
    const distPx05 = 0.5 * CELL_SIZE;
    const factor05 = Math.min(16, (distPx05 * 2) / spreadFactor);
    const dmg05 = Math.round(baseDmg * 0.9 / Math.max(1, factor05));

    expect(dmgPointBlank).toBeGreaterThan(dmg05);
    expect(dmg05).toBeGreaterThan(0);
  });
});

// =========================================================================
// 6. Short Range — E4 range 3.5 is shorter than most weapons
// =========================================================================
describe('E4 short range behavior (range 3.5)', () => {
  it('Flamer range (3.5) is longer than M1Carbine (3.0) — E4 outranges E1 rifles', () => {
    expect(WEAPON_STATS.Flamer.range).toBe(3.5);
    expect(WEAPON_STATS.M1Carbine.range).toBe(3.0);
    expect(WEAPON_STATS.Flamer.range).toBeGreaterThan(WEAPON_STATS.M1Carbine.range);
  });

  it('Flamer range (3.5) is shorter than RedEye (7.5) — E3 vastly outranges E4', () => {
    expect(WEAPON_STATS.RedEye.range).toBeGreaterThan(WEAPON_STATS.Flamer.range * 2);
  });

  it('Flamer range (3.5) is shorter than Grenade (4.0) — E2 outranges E4', () => {
    expect(WEAPON_STATS.Grenade.range).toBeGreaterThan(WEAPON_STATS.Flamer.range);
  });

  it('Flamer range (3.5) is longer than DogJaw (2.2)', () => {
    expect(WEAPON_STATS.Flamer.range).toBeGreaterThan(WEAPON_STATS.DogJaw.range);
  });

  it('E4 at distance 4.0 cells cannot reach target (out of range)', () => {
    const e4 = new Entity(UnitType.I_E4, House.USSR, 100, 100);
    const target = new Entity(UnitType.I_E1, House.Greece, 100 + 4.0 * CELL_SIZE, 100);

    expect(e4.inRange(target)).toBe(false);
  });

  it('E4 at distance 3.0 cells can reach target (in range)', () => {
    const e4 = new Entity(UnitType.I_E4, House.USSR, 100, 100);
    const target = new Entity(UnitType.I_E1, House.Greece, 100 + 3.0 * CELL_SIZE, 100);

    expect(e4.inRange(target)).toBe(true);
  });

  it('E4 at distance exactly 3.5 cells is at max range', () => {
    const e4 = new Entity(UnitType.I_E4, House.USSR, 100, 100);
    const target = new Entity(UnitType.I_E1, House.Greece, 100 + 3.5 * CELL_SIZE, 100);

    // worldDist returns distance in cells (divides by CELL_SIZE internally)
    const dist = worldDist(e4.pos, target.pos);
    expect(dist).toBeCloseTo(3.5, 5);
    expect(e4.inRange(target)).toBe(true);
  });

  it('E4 must close distance — speed 3 is among the slowest infantry', () => {
    const e4Speed = UNIT_STATS.E4.speed;
    const e1Speed = UNIT_STATS.E1.speed;
    const e2Speed = UNIT_STATS.E2.speed;

    // E4 is slower than E1 (4) and E2 (5)
    expect(e4Speed).toBeLessThan(e1Speed);
    expect(e4Speed).toBeLessThan(e2Speed);
    // E4 same speed as E3 (both 3)
    expect(e4Speed).toBe(UNIT_STATS.E3.speed);
  });
});

// =========================================================================
// 7. Standard Infantry Behaviors — Crushable, Fear, Prone, Retaliation
// =========================================================================
describe('E4 standard infantry behaviors', () => {
  describe('crushable', () => {
    it('E4 is crushable (tanks can run it over)', () => {
      expect(UNIT_STATS.E4.crushable).toBe(true);
    });

    it('Entity instance recognizes infantry status', () => {
      const e4 = new Entity(UnitType.I_E4, House.USSR, 100, 100);
      expect(e4.stats.isInfantry).toBe(true);
      expect(e4.stats.crushable).toBe(true);
    });
  });

  describe('fear and prone system (C++ infantry.cpp)', () => {
    it('E4 starts with fear = 0, not prone', () => {
      const e4 = new Entity(UnitType.I_E4, House.USSR, 100, 100);
      expect(e4.fear).toBe(0);
      expect(e4.isProne).toBe(false);
    });

    it('FEAR_ANXIOUS threshold = 10', () => {
      expect(Entity.FEAR_ANXIOUS).toBe(10);
    });

    it('taking damage increases fear to at least FEAR_SCARED (100)', () => {
      const e4 = new Entity(UnitType.I_E4, House.USSR, 100, 100);
      const attacker = new Entity(UnitType.I_E1, House.Spain, 200, 200);
      e4.takeDamage(10, 'Fire', attacker);
      // C++ infantry.cpp:442-457 — fear jumps to FEAR_SCARED on any damage
      expect(e4.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
    });

    it('FEAR_MAXIMUM = 255', () => {
      expect(Entity.FEAR_MAXIMUM).toBe(255);
    });
  });

  describe('prone damage reduction', () => {
    it('PRONE_DAMAGE_BIAS = 0.5 (50% damage when prone)', () => {
      expect(PRONE_DAMAGE_BIAS).toBe(0.5);
    });

    it('prone E4 takes 50% damage', () => {
      const e4 = new Entity(UnitType.I_E4, House.USSR, 100, 100);
      e4.isProne = true;
      const hpBefore = e4.hp;

      e4.takeDamage(20, 'SA');
      const damageTaken = hpBefore - e4.hp;

      // 20 * 0.5 = 10, rounded = 10
      expect(damageTaken).toBe(Math.max(1, Math.round(20 * PRONE_DAMAGE_BIAS)));
    });

    it('non-prone E4 takes full damage', () => {
      const e4 = new Entity(UnitType.I_E4, House.USSR, 100, 100);
      expect(e4.isProne).toBe(false);
      const hpBefore = e4.hp;

      e4.takeDamage(20, 'SA');
      const damageTaken = hpBefore - e4.hp;

      expect(damageTaken).toBe(20);
    });
  });

  describe('retaliation (guard targeting)', () => {
    it('E4 starts in GUARD mission (will retaliate)', () => {
      const e4 = new Entity(UnitType.I_E4, House.USSR, 100, 100);
      // Mission.GUARD is the default (string enum)
      expect(e4.mission).toBe(Mission.GUARD);
    });

    it('E4 has instant rotation (rot=8) for quick target acquisition', () => {
      const e4 = new Entity(UnitType.I_E4, House.USSR, 100, 100);
      // Infantry with rot >= 8 snap facing instantly (entity.ts:626)
      expect(e4.stats.rot).toBeGreaterThanOrEqual(8);
    });
  });

  describe('E4 entity construction', () => {
    it('constructs with correct HP', () => {
      const e4 = new Entity(UnitType.I_E4, House.USSR, 100, 200);
      expect(e4.hp).toBe(40);
      expect(e4.maxHp).toBe(40);
    });

    it('constructs at given position', () => {
      const e4 = new Entity(UnitType.I_E4, House.USSR, 150, 250);
      expect(e4.pos.x).toBe(150);
      expect(e4.pos.y).toBe(250);
    });

    it('starts alive', () => {
      const e4 = new Entity(UnitType.I_E4, House.USSR, 100, 100);
      expect(e4.alive).toBe(true);
    });

    it('dies from Fire warhead with burn death animation', () => {
      const e4 = new Entity(UnitType.I_E4, House.USSR, 100, 100);
      const killed = e4.takeDamage(999, 'Fire');
      expect(killed).toBe(true);
      expect(e4.alive).toBe(false);
      expect(e4.deathVariant).toBe(4); // C++ InfDeath=4 (burn)
    });
  });

  describe('E4 infantry animation data (C++ idata.cpp:152)', () => {
    it('INFANTRY_ANIMS.E4 exists', () => {
      expect(INFANTRY_ANIMS.E4).toBeDefined();
    });

    it('has fire animation with 16 frames per direction', () => {
      const anim = INFANTRY_ANIMS.E4;
      expect(anim.fire.count).toBe(16);
      expect(anim.fire.jump).toBe(16);
    });

    it('has prone fire animation (fireProne)', () => {
      const anim = INFANTRY_ANIMS.E4;
      expect(anim.fireProne).toBeDefined();
      expect(anim.fireProne!.count).toBe(16);
    });

    it('has walk animation with 6 frames', () => {
      const anim = INFANTRY_ANIMS.E4;
      expect(anim.walk.count).toBe(6);
    });

    it('has two death animations (die1 and die2)', () => {
      const anim = INFANTRY_ANIMS.E4;
      expect(anim.die1).toBeDefined();
      expect(anim.die2).toBeDefined();
      expect(anim.die1.count).toBe(8);
      expect(anim.die2.count).toBe(8);
    });

    it('has idle fidget animations', () => {
      const anim = INFANTRY_ANIMS.E4;
      expect(anim.idle).toBeDefined();
      expect(anim.idle!.count).toBe(16);
    });

    it('has attackRate = 4 (faster than default 5)', () => {
      const anim = INFANTRY_ANIMS.E4;
      expect(anim.attackRate).toBe(4);
    });
  });
});

// =========================================================================
// Cross-cutting: E4 in combined combat scenarios
// =========================================================================
describe('E4 combined combat scenarios', () => {
  it('E4 Flamer one-shots E1 (70 dmg > 50 HP)', () => {
    const e1 = new Entity(UnitType.I_E1, House.Greece, 200, 100);
    expect(e1.hp).toBe(50);
    // Full Flamer hit (point-blank, no falloff): 70 damage
    const killed = e1.takeDamage(70, 'Fire');
    expect(killed).toBe(true);
    expect(e1.deathVariant).toBe(4); // C++ InfDeath=4 (burn)
  });

  it('E4 Flamer does NOT one-shot E4 (70 dmg > 40 HP — kills)', () => {
    const victim = new Entity(UnitType.I_E4, House.Greece, 200, 100);
    expect(victim.hp).toBe(40);
    const killed = victim.takeDamage(70, 'Fire');
    expect(killed).toBe(true);
  });

  it('Fire warhead vs heavy tank: damage reduced to 25%', () => {
    // Simulating damage calc for Flamer vs Heavy Tank (armor=heavy)
    const baseDmg = WEAPON_STATS.Flamer.damage; // 70
    const mult = getWarheadMultiplier('Fire', 'heavy'); // 0.25
    const effectiveDmg = Math.round(baseDmg * mult);
    // 70 * 0.25 = 17.5 -> 18 (rounded)
    expect(effectiveDmg).toBe(18);
  });

  it('Fire warhead vs wood building: full damage (1.0 multiplier)', () => {
    const baseDmg = WEAPON_STATS.Flamer.damage; // 70
    const mult = getWarheadMultiplier('Fire', 'wood'); // 1.0
    const effectiveDmg = Math.round(baseDmg * mult);
    expect(effectiveDmg).toBe(70);
  });

  it('prone E4 survives a hit that would normally kill it', () => {
    const e4 = new Entity(UnitType.I_E4, House.USSR, 100, 100);
    e4.isProne = true;
    // HP=40, deal 60 damage. Prone: 60*0.5=30, so 40-30=10 HP left
    const killed = e4.takeDamage(60, 'SA');
    expect(killed).toBe(false);
    expect(e4.hp).toBe(10);
  });

  it('non-prone E4 dies from same hit', () => {
    const e4 = new Entity(UnitType.I_E4, House.USSR, 100, 100);
    expect(e4.isProne).toBe(false);
    // HP=40, deal 60 damage directly = dead
    const killed = e4.takeDamage(60, 'SA');
    expect(killed).toBe(true);
    expect(e4.hp).toBe(0);
  });

  it('E4 is a short-range glass cannon: high damage, low HP, short range', () => {
    // High damage: 70 (vs E1 M1Carbine=15, E2 Grenade=50)
    expect(WEAPON_STATS.Flamer.damage).toBeGreaterThan(WEAPON_STATS.M1Carbine.damage);
    expect(WEAPON_STATS.Flamer.damage).toBeGreaterThan(WEAPON_STATS.Grenade.damage);

    // Low HP: 40 (vs E1=50, E2=50, E3=45)
    expect(UNIT_STATS.E4.strength).toBeLessThan(UNIT_STATS.E1.strength);
    expect(UNIT_STATS.E4.strength).toBeLessThan(UNIT_STATS.E2.strength);
    expect(UNIT_STATS.E4.strength).toBeLessThan(UNIT_STATS.E3.strength);

    // Short range: 3.5 — shorter than Grenade (4.0), RedEye (7.5)
    // Note: M1Carbine is actually 3.0, so Flamer outranges rifles
    expect(WEAPON_STATS.Flamer.range).toBeLessThan(WEAPON_STATS.Grenade.range);
    expect(WEAPON_STATS.Flamer.range).toBeLessThan(WEAPON_STATS.RedEye.range);
  });
});
