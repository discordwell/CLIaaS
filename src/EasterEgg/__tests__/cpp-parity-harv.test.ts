/**
 * C++ Behavioral Parity: HARV — Ore Harvester
 *
 * Tests verify that the Harvester unit matches C++ RA source code behavior.
 * Each describe block documents the C++ source reference.
 *
 * Observable outcomes: stats values, state machine transitions, weapon nullity,
 * ore capacity constants, crusher flag, turret exclusion, rotation behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, Dir, CELL_SIZE,
  Mission, AnimState,
  UNIT_STATS, PRODUCTION_ITEMS,
  getWarheadMultiplier,
} from '../engine/types';
import type { WarheadType, ArmorType } from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeHarv(house: House = House.Spain, x = 200, y = 200): Entity {
  return new Entity(UnitType.V_HARV, house, x, y);
}

function makeEnemy(type: UnitType = UnitType.I_E1, x = 300, y = 300): Entity {
  return new Entity(type, House.USSR, x, y);
}

// =============================================================================
// 1. Stats (C++ udata.cpp HARV entry)
// =============================================================================

describe('HARV stats match C++ udata.cpp', () => {
  const stats = UNIT_STATS.HARV;

  it('HP = 600 (Strength in rules.ini)', () => {
    expect(stats.strength).toBe(600);
  });

  it('armor = heavy (ArmorType in udata.cpp)', () => {
    expect(stats.armor).toBe('heavy');
  });

  it('speed = 6 (MPH_MEDIUM_SLOW in udata.cpp)', () => {
    expect(stats.speed).toBe(6);
  });

  it('sight = 4 (C++ udata.cpp Sight)', () => {
    expect(stats.sight).toBe(4);
  });

  it('rot = 5 (C++ udata.cpp ROT)', () => {
    expect(stats.rot).toBe(5);
  });

  it('isInfantry = false (vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('primaryWeapon = null (unarmed)', () => {
    expect(stats.primaryWeapon).toBeNull();
  });

  it('crusher = true (heavy tracked vehicle)', () => {
    expect(stats.crusher).toBe(true);
  });

  it('type enum = V_HARV', () => {
    expect(stats.type).toBe(UnitType.V_HARV);
  });

  it('name = Harvester', () => {
    expect(stats.name).toBe('Harvester');
  });
});

// =============================================================================
// 2. Cost (C++ rules.ini Cost=1400, faction=both)
// =============================================================================

describe('HARV production cost (rules.ini)', () => {
  const item = PRODUCTION_ITEMS.find(p => p.type === 'HARV');

  it('exists in PRODUCTION_ITEMS', () => {
    expect(item).toBeDefined();
  });

  it('cost = 1400', () => {
    expect(item!.cost).toBe(1400);
  });

  it('faction = both (allies and soviets can build)', () => {
    expect(item!.faction).toBe('both');
  });

  it('prerequisite = WEAP (War Factory)', () => {
    expect(item!.prerequisite).toBe('WEAP');
  });

  it('techPrereq = PROC (Refinery gate)', () => {
    expect(item!.techPrereq).toBe('PROC');
  });
});

// =============================================================================
// 3. No Weapon — cannot attack (C++ udata.cpp PrimaryWeapon=WEAPON_NONE)
// =============================================================================

describe('HARV has no weapon (udata.cpp WEAPON_NONE)', () => {
  it('entity.weapon is null after construction', () => {
    const harv = makeHarv();
    expect(harv.weapon).toBeNull();
  });

  it('entity.weapon2 is null (no secondary either)', () => {
    const harv = makeHarv();
    expect(harv.weapon2).toBeNull();
  });

  it('selectWeapon returns null against any target', () => {
    const harv = makeHarv();
    const enemy = makeEnemy();
    const result = harv.selectWeapon(enemy, getWarheadMultiplier as (w: WarheadType, a: ArmorType) => number);
    expect(result).toBeNull();
  });

  it('inRange always returns false (no weapon = no range)', () => {
    const harv = makeHarv(House.Spain, 200, 200);
    // Place enemy right next to harvester
    const enemy = makeEnemy(UnitType.I_E1, 201, 200);
    expect(harv.inRange(enemy)).toBe(false);
  });
});

// =============================================================================
// 4. No Turret (C++ hasTurret exclusion list includes HARV)
// =============================================================================

describe('HARV has no turret (entity.ts hasTurret exclusion)', () => {
  it('hasTurret = false', () => {
    const harv = makeHarv();
    expect(harv.hasTurret).toBe(false);
  });
});

// =============================================================================
// 5. Harvester State Machine (C++ unit.cpp / drive.cpp harvest AI)
// =============================================================================

describe('Harvester state machine (unit.cpp harvest cycle)', () => {
  it('harvesterState defaults to idle', () => {
    const harv = makeHarv();
    expect(harv.harvesterState).toBe('idle');
  });

  it('harvesterState can transition through all states', () => {
    const harv = makeHarv();
    const states: Array<'idle' | 'seeking' | 'harvesting' | 'returning' | 'unloading'> =
      ['idle', 'seeking', 'harvesting', 'returning', 'unloading'];

    for (const state of states) {
      harv.harvesterState = state;
      expect(harv.harvesterState).toBe(state);
    }
  });

  it('harvestTick starts at 0', () => {
    const harv = makeHarv();
    expect(harv.harvestTick).toBe(0);
  });

  it('oreLoad starts at 0', () => {
    const harv = makeHarv();
    expect(harv.oreLoad).toBe(0);
  });

  it('oreCreditValue starts at 0', () => {
    const harv = makeHarv();
    expect(harv.oreCreditValue).toBe(0);
  });
});

// =============================================================================
// 6. Ore Capacity Constants (C++ UnitTypeClass::Max_Pips / BAIL_COUNT)
// =============================================================================

describe('Ore capacity constants (C++ UnitTypeClass::Max_Pips)', () => {
  it('BAIL_COUNT = 28', () => {
    expect(Entity.BAIL_COUNT).toBe(28);
  });

  it('ORE_CAPACITY = 28 (alias for BAIL_COUNT)', () => {
    expect(Entity.ORE_CAPACITY).toBe(28);
  });

  it('BAIL_COUNT === ORE_CAPACITY (same value)', () => {
    expect(Entity.BAIL_COUNT).toBe(Entity.ORE_CAPACITY);
  });

  it('oreLoad can be set up to BAIL_COUNT', () => {
    const harv = makeHarv();
    harv.oreLoad = Entity.BAIL_COUNT;
    expect(harv.oreLoad).toBe(28);
  });
});

// =============================================================================
// 7. Crusher — can crush infantry (C++ udata.cpp Crusher=true)
// =============================================================================

describe('HARV crusher behavior (udata.cpp Crusher flag)', () => {
  it('stats.crusher = true', () => {
    const harv = makeHarv();
    expect(harv.stats.crusher).toBe(true);
  });

  it('infantry are crushable (E1.crushable = true)', () => {
    const e1 = makeEnemy(UnitType.I_E1);
    expect(e1.stats.crushable).toBe(true);
  });
});

// =============================================================================
// 8. HP 600 with Heavy Armor — most durable non-mammoth
//    Same as MCV and 4TNK (C++ udata.cpp Strength comparisons)
// =============================================================================

describe('HARV durability (600 HP heavy armor, udata.cpp)', () => {
  it('constructed with full HP = 600', () => {
    const harv = makeHarv();
    expect(harv.hp).toBe(600);
    expect(harv.maxHp).toBe(600);
  });

  it('same HP as MCV (600)', () => {
    const mcv = new Entity(UnitType.V_MCV, House.Spain, 100, 100);
    expect(mcv.maxHp).toBe(600);
    expect(makeHarv().maxHp).toBe(mcv.maxHp);
  });

  it('same HP as 4TNK Mammoth Tank (600)', () => {
    const mammoth = new Entity(UnitType.V_4TNK, House.USSR, 100, 100);
    expect(mammoth.maxHp).toBe(600);
    expect(makeHarv().maxHp).toBe(mammoth.maxHp);
  });

  it('more HP than Medium Tank (400)', () => {
    const med = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(makeHarv().maxHp).toBeGreaterThan(med.maxHp);
  });

  it('more HP than Heavy Tank (400)', () => {
    const heavy = new Entity(UnitType.V_3TNK, House.USSR, 100, 100);
    expect(makeHarv().maxHp).toBeGreaterThan(heavy.maxHp);
  });

  it('heavy armor (same as tanks, not light like MCV)', () => {
    expect(UNIT_STATS.HARV.armor).toBe('heavy');
    expect(UNIT_STATS['4TNK'].armor).toBe('heavy');
    // MCV is actually light armor — HARV is more armored than MCV
    expect(UNIT_STATS.MCV.armor).toBe('light');
  });
});

// =============================================================================
// 9. takeDamage behavior — survives hits, eventually dies
// =============================================================================

describe('HARV takeDamage (C++ techno.cpp TakeDamage)', () => {
  it('takes damage and reduces HP', () => {
    const harv = makeHarv();
    const killed = harv.takeDamage(100);
    expect(killed).toBe(false);
    expect(harv.hp).toBe(500);
  });

  it('survives massive damage if HP remains > 0', () => {
    const harv = makeHarv();
    harv.takeDamage(599);
    expect(harv.alive).toBe(true);
    expect(harv.hp).toBe(1);
  });

  it('dies when damage exceeds remaining HP', () => {
    const harv = makeHarv();
    const killed = harv.takeDamage(600);
    expect(killed).toBe(true);
    expect(harv.alive).toBe(false);
    expect(harv.hp).toBe(0);
  });

  it('mission transitions to DIE on death', () => {
    const harv = makeHarv();
    harv.takeDamage(600);
    expect(harv.mission).toBe(Mission.DIE);
    expect(harv.animState).toBe(AnimState.DIE);
  });

  it('damageFlash is set on hit', () => {
    const harv = makeHarv();
    harv.takeDamage(50);
    expect(harv.damageFlash).toBe(4);
  });

  it('invulnerable when ironCurtainTick > 0', () => {
    const harv = makeHarv();
    harv.ironCurtainTick = 100;
    const killed = harv.takeDamage(9999);
    expect(killed).toBe(false);
    expect(harv.hp).toBe(600);
  });
});

// =============================================================================
// 10. Stop-Rotate-Move behavior (C++ drive.cpp — vehicles stop, rotate, move)
// =============================================================================

describe('HARV stop-rotate-move (drive.cpp vehicle rotation)', () => {
  it('does not move while rotating to face target direction', () => {
    const harv = makeHarv(House.Spain, 200, 200);
    harv.facing = Dir.N;
    harv.desiredFacing = Dir.N;
    harv.bodyFacing32 = Dir.N * 4;
    // Target is to the East — requires rotation
    const target = { x: 200 + 5 * CELL_SIZE, y: 200 };
    const posBefore = { ...harv.pos };

    // moveToward should NOT move while still rotating
    const arrived = harv.moveToward(target, harv.stats.speed);

    // Facing should have started changing but not yet aligned
    // (rot=5, needs multiple ticks for 90 degree turn)
    if (harv.facing !== Dir.E) {
      // Still rotating — should not have moved
      expect(harv.pos.x).toBe(posBefore.x);
      expect(harv.pos.y).toBe(posBefore.y);
      expect(arrived).toBe(false);
    }
  });

  it('moves once facing is aligned with target direction', () => {
    const harv = makeHarv(House.Spain, 200, 200);
    // Pre-align facing to East
    harv.facing = Dir.E;
    harv.desiredFacing = Dir.E;
    harv.bodyFacing32 = Dir.E * 4;
    // Target directly East
    const target = { x: 200 + 5 * CELL_SIZE, y: 200 };
    const posBefore = { ...harv.pos };

    harv.moveToward(target, harv.stats.speed);

    // Should have moved East
    expect(harv.pos.x).toBeGreaterThan(posBefore.x);
  });
});

// =============================================================================
// 11. Rotation rate (C++ ROT=5, 32-step system)
// =============================================================================

describe('HARV rotation (C++ 32-step ROT system, ROT=5)', () => {
  it('tickRotation returns true when facing matches desired', () => {
    const harv = makeHarv();
    harv.facing = Dir.N;
    harv.desiredFacing = Dir.N;
    harv.bodyFacing32 = Dir.N * 4;
    expect(harv.tickRotation()).toBe(true);
  });

  it('tickRotation does NOT snap instantly (ROT=5 < 8)', () => {
    const harv = makeHarv();
    harv.facing = Dir.N;
    harv.desiredFacing = Dir.E; // 90 degrees away
    harv.bodyFacing32 = Dir.N * 4;
    harv.rotTickedThisFrame = false;

    const aligned = harv.tickRotation();

    // ROT=5 < 8, so vehicle uses gradual 32-step rotation
    // After 1 tick: accumulator = 5, threshold = 8, so no visual step yet
    expect(aligned).toBe(false);
  });

  it('accumulates rotation and eventually aligns over multiple ticks', () => {
    const harv = makeHarv();
    harv.facing = Dir.N;
    harv.desiredFacing = Dir.E;
    harv.bodyFacing32 = Dir.N * 4;

    // Simulate multiple ticks of rotation
    let aligned = false;
    for (let i = 0; i < 50; i++) {
      harv.rotTickedThisFrame = false;
      aligned = harv.tickRotation();
      if (aligned) break;
    }

    expect(aligned).toBe(true);
    expect(harv.facing).toBe(Dir.E);
  });
});

// =============================================================================
// 12. Not an infantry / not an aircraft / not naval (classification)
// =============================================================================

describe('HARV classification (vehicle, not infantry/aircraft/naval)', () => {
  it('isInfantry is false (stats)', () => {
    const harv = makeHarv();
    expect(harv.stats.isInfantry).toBe(false);
  });

  it('isAirUnit is false', () => {
    const harv = makeHarv();
    expect(harv.isAirUnit).toBe(false);
  });

  it('isNavalUnit is false', () => {
    const harv = makeHarv();
    expect(harv.isNavalUnit).toBe(false);
  });

  it('isAnt is false', () => {
    const harv = makeHarv();
    expect(harv.isAnt).toBe(false);
  });

  it('isTransport is false (no passenger capacity)', () => {
    const harv = makeHarv();
    expect(harv.isTransport).toBe(false);
  });

  it('isCivilian is false', () => {
    const harv = makeHarv();
    expect(harv.isCivilian).toBe(false);
  });
});

// =============================================================================
// 13. Both factions can own HARV
// =============================================================================

describe('HARV faction ownership (rules.ini Owner=allies,soviet)', () => {
  it('Allied house can own a harvester', () => {
    const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
    expect(harv.house).toBe(House.Spain);
    expect(harv.alive).toBe(true);
  });

  it('Soviet house can own a harvester', () => {
    const harv = new Entity(UnitType.V_HARV, House.USSR, 100, 100);
    expect(harv.house).toBe(House.USSR);
    expect(harv.alive).toBe(true);
  });
});

// =============================================================================
// 14. HARVEST mission properties (C++ mission.cpp MissionClass)
// =============================================================================

describe('HARVEST mission (mission.cpp properties)', () => {
  it('Mission.HARVEST enum value exists', () => {
    expect(Mission.HARVEST).toBe('HARVEST');
  });
});

// =============================================================================
// 15. Sprite frame uses bodyFacing32 (vehicle rendering, not infantry)
// =============================================================================

describe('HARV sprite rendering (vehicle body shape)', () => {
  it('spriteFrame uses bodyFacing32 BODY_SHAPE lookup (not infantry anims)', () => {
    const harv = makeHarv();
    harv.facing = Dir.N;
    harv.bodyFacing32 = Dir.N * 4; // facing32 = 0
    harv.animState = AnimState.IDLE;

    // BODY_SHAPE[0] = 0 for facing North
    expect(harv.spriteFrame).toBe(0);
  });

  it('spriteFrame changes with bodyFacing32', () => {
    const harv = makeHarv();
    harv.bodyFacing32 = Dir.E * 4; // facing32 = 8
    harv.animState = AnimState.IDLE;

    const frameN = (() => {
      const h = makeHarv();
      h.bodyFacing32 = Dir.N * 4;
      h.animState = AnimState.IDLE;
      return h.spriteFrame;
    })();

    // Different facing should give different sprite frame
    expect(harv.spriteFrame).not.toBe(frameN);
  });
});

// =============================================================================
// 16. DamageSpeed — speed reduction when damaged (standard vehicle behavior)
// =============================================================================

describe('HARV crate biases (M7/MV9/CR2 — standard vehicle)', () => {
  it('speedBias defaults to 1.0', () => {
    const harv = makeHarv();
    expect(harv.speedBias).toBe(1.0);
  });

  it('groundspeedBias defaults to 1.0', () => {
    const harv = makeHarv();
    expect(harv.groundspeedBias).toBe(1.0);
  });

  it('armorBias defaults to 1.0', () => {
    const harv = makeHarv();
    expect(harv.armorBias).toBe(1.0);
  });

  it('speed crate boosts effective movement speed', () => {
    const harv = makeHarv(House.Spain, 200, 200);
    harv.facing = Dir.E;
    harv.desiredFacing = Dir.E;
    harv.bodyFacing32 = Dir.E * 4;
    const target = { x: 200 + 10 * CELL_SIZE, y: 200 };

    // Move without speed bias
    const harv1 = makeHarv(House.Spain, 200, 200);
    harv1.facing = Dir.E;
    harv1.desiredFacing = Dir.E;
    harv1.bodyFacing32 = Dir.E * 4;
    harv1.moveToward(target, harv1.stats.speed);
    const normalDist = harv1.pos.x - 200;

    // Move with speed bias
    const harv2 = makeHarv(House.Spain, 200, 200);
    harv2.facing = Dir.E;
    harv2.desiredFacing = Dir.E;
    harv2.bodyFacing32 = Dir.E * 4;
    harv2.speedBias = 1.5;
    harv2.moveToward(target, harv2.stats.speed);
    const boostedDist = harv2.pos.x - 200;

    expect(boostedDist).toBeGreaterThan(normalDist);
  });

  it('armor crate reduces incoming damage', () => {
    const harv1 = makeHarv();
    harv1.takeDamage(100);
    const normalDmg = 600 - harv1.hp;

    const harv2 = makeHarv();
    harv2.armorBias = 2.0; // half damage
    harv2.takeDamage(100);
    const reducedDmg = 600 - harv2.hp;

    expect(reducedDmg).toBeLessThan(normalDmg);
  });
});

// =============================================================================
// 17. Iron Curtain interaction — harvester can be made invulnerable
// =============================================================================

describe('HARV Iron Curtain (superweapon interaction)', () => {
  it('ironCurtainTick = 0 by default (not invulnerable)', () => {
    const harv = makeHarv();
    expect(harv.ironCurtainTick).toBe(0);
    expect(harv.isInvulnerable).toBe(false);
  });

  it('isInvulnerable = true when ironCurtainTick > 0', () => {
    const harv = makeHarv();
    harv.ironCurtainTick = 150;
    expect(harv.isInvulnerable).toBe(true);
  });

  it('blocks all damage when invulnerable', () => {
    const harv = makeHarv();
    harv.ironCurtainTick = 100;
    harv.takeDamage(9999);
    expect(harv.hp).toBe(600);
    expect(harv.alive).toBe(true);
  });
});
