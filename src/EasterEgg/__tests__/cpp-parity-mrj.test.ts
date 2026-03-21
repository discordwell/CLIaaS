/**
 * C++ Behavioral Parity Tests — MRJ (Radar Jammer)
 *
 * Verifies that the MRJ unit matches C++ Red Alert engine behavior:
 *   - Stats: HP 110, armor light, speed 9, cost 600, allied faction
 *   - No weapon: support vehicle, primaryWeapon=null — cannot attack or retaliate
 *   - No turret: hasTurret=false (in explicit exclusion list)
 *   - Fast support: speed 9 with light armor, crusher=true
 *   - Standard vehicle behaviors: crusher, damageSpeed, stop-rotate-move
 *
 * References: C++ udata.cpp, rules.ini, drive.cpp, techno.cpp
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, UNIT_STATS, CELL_SIZE,
  WARHEAD_VS_ARMOR,
  type WarheadType, type ArmorType,
  armorIndex, getWarheadMultiplier, Mission, AnimState, Dir,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext, type AiStateSlice,
  checkVehicleCrush, triggerRetaliation, damageSpeedFactor,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

/** Build a minimal CombatContext for behavioral tests */
function makeCombatContext(entities: Entity[]): CombatContext {
  const map = new GameMap();
  const entityById = new Map(entities.map(e => [e.id, e]));
  return {
    entities,
    entityById,
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
    attackedTriggerNames: new Set(),
    map,
    aiStates: new Map<House, AiStateSlice>(),
    lastBaseAttackEva: 0,
    gameTicksPerSec: 15,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    powerConsumed: 0,
    powerProduced: 0,
    isAllied: (a, b) => a === b,
    entitiesAllied: (a, b) => a.house === b.house,
    isPlayerControlled: (e) => e.house === House.Spain,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    movementSpeed: () => 1,
    getFirepowerBias: () => 1,
    getArmorBias: () => 1.0,
    getROFBias: () => 1.0,
    damageStructure: () => false,
    aiIQ: () => 3,
    warheadMuzzleColor: () => '255,200,60',
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => {},
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
  } as CombatContext;
}


// ============================================================
// 1. MRJ Stats — C++ udata.cpp / rules.ini parity
// ============================================================
describe('MRJ stats (C++ udata.cpp parity)', () => {
  const stats = UNIT_STATS.MRJ;

  it('HP is 110 (C++ Strength=110)', () => {
    expect(stats.strength).toBe(110);
  });

  it('armor is light (C++ Armor=light)', () => {
    expect(stats.armor).toBe('light');
  });

  it('speed is 9 (C++ Speed=9)', () => {
    expect(stats.speed).toBe(9);
  });

  it('cost is 600 credits (C++ rules.ini Cost=600)', () => {
    expect(stats.cost).toBe(600);
  });

  it('sight is 7 cells (C++ Sight=7)', () => {
    expect(stats.sight).toBe(7);
  });

  it('rot is 5 (C++ ROT=5)', () => {
    expect(stats.rot).toBe(5);
  });

  it('is NOT infantry (C++ is a vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('owner is allied (C++ Owner=allies)', () => {
    expect(stats.owner).toBe('allied');
  });

  it('crusher is true (C++ Crusher=yes — heavy support vehicle)', () => {
    expect(stats.crusher).toBe(true);
  });

  it('primary weapon is null (C++ no weapon — support unit)', () => {
    expect(stats.primaryWeapon).toBeNull();
  });

  it('has no secondary weapon', () => {
    expect(stats.secondaryWeapon).toBeUndefined();
  });

  it('type enum is V_MRJ', () => {
    expect(stats.type).toBe(UnitType.V_MRJ);
  });

  it('name is Radar Jammer', () => {
    expect(stats.name).toBe('Radar Jammer');
  });
});


// ============================================================
// 2. No Weapon — support vehicle cannot attack
//    (C++ udata.cpp: Primary=YOURWEAPON is absent for MRJ)
// ============================================================
describe('MRJ has no weapon — pure support vehicle (C++ udata.cpp parity)', () => {
  it('Entity constructor resolves weapon to null', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    expect(mrj.weapon).toBeNull();
  });

  it('Entity constructor resolves weapon2 to null', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    expect(mrj.weapon2).toBeNull();
  });

  it('inRange always returns false (no weapon means no range)', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100);
    expect(mrj.inRange(target)).toBe(false);
  });

  it('inRange returns false even at point blank (0 distance)', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    expect(mrj.inRange(target)).toBe(false);
  });

  it('selectWeapon returns null (no weapons to select)', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100);
    const selected = mrj.selectWeapon(target, getWarheadMultiplier);
    expect(selected).toBeNull();
  });
});


// ============================================================
// 3. No Retaliation — unarmed units cannot counter-attack
//    (C++ techno.cpp: retaliation requires a weapon)
// ============================================================
describe('MRJ cannot retaliate (C++ techno.cpp — unarmed check)', () => {
  it('MRJ does not acquire target when attacked', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    const attacker = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    mrj.mission = Mission.GUARD;
    mrj.target = null;

    const ctx = makeCombatContext([mrj, attacker]);
    triggerRetaliation(ctx, mrj, attacker);

    expect(mrj.target).toBeNull();
    expect(mrj.mission).toBe(Mission.GUARD);
  });

  it('MRJ stays on GUARD after repeated attacks', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    const attacker = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    mrj.mission = Mission.GUARD;

    const ctx = makeCombatContext([mrj, attacker]);

    // Simulate multiple attacks — MRJ should never switch to ATTACK
    for (let i = 0; i < 5; i++) {
      triggerRetaliation(ctx, mrj, attacker);
    }

    expect(mrj.target).toBeNull();
    expect(mrj.mission).toBe(Mission.GUARD);
  });

  it('contrast: armed JEEP DOES retaliate when attacked', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    const attacker = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    jeep.mission = Mission.GUARD;

    const ctx = makeCombatContext([jeep, attacker]);
    triggerRetaliation(ctx, jeep, attacker);

    expect(jeep.target).toBe(attacker);
    expect(jeep.mission).toBe(Mission.ATTACK);
  });
});


// ============================================================
// 4. No Turret — hasTurret=false (explicit exclusion list)
//    (C++ udata.cpp NoTurret flag for MRJ)
// ============================================================
describe('MRJ has no turret (C++ NoTurret parity)', () => {
  it('hasTurret getter returns false', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    expect(mrj.hasTurret).toBe(false);
  });

  it('MRJ type V_MRJ is in the hasTurret exclusion list', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    expect(mrj.type).toBe(UnitType.V_MRJ);
    expect(mrj.hasTurret).toBe(false);
  });

  it('contrast: Light Tank (1TNK) has a turret', () => {
    const tank = makeEntity(UnitType.V_1TNK, House.Spain, 100, 100);
    expect(tank.hasTurret).toBe(true);
  });

  it('contrast: Medium Tank (2TNK) has a turret', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(tank.hasTurret).toBe(true);
  });

  it('sibling support vehicle MGG also has no turret', () => {
    const mgg = makeEntity(UnitType.V_MGG, House.Spain, 100, 100);
    expect(mgg.hasTurret).toBe(false);
  });
});


// ============================================================
// 5. Crusher — MRJ can crush infantry
//    (C++ drive.cpp: Crusher=yes, heavy 8-wheeled vehicle)
// ============================================================
describe('MRJ is a crusher (C++ drive.cpp Crusher=yes)', () => {
  it('MRJ stats have crusher=true', () => {
    expect(UNIT_STATS.MRJ.crusher).toBe(true);
  });

  it('MRJ crushes enemy infantry on same cell', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    const infantry = makeEntity(UnitType.I_E1, House.USSR, 100, 100);

    const ctx = makeCombatContext([mrj, infantry]);
    checkVehicleCrush(ctx, mrj);

    expect(infantry.alive).toBe(false);
  });

  it('MRJ does NOT crush allied infantry (IsAFriend check)', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    const ally = makeEntity(UnitType.I_E1, House.Spain, 100, 100);

    const ctx = makeCombatContext([mrj, ally]);
    checkVehicleCrush(ctx, mrj);

    expect(ally.alive).toBe(true);
    expect(ally.hp).toBe(ally.maxHp);
  });

  it('MRJ crushes enemy dog on same cell', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    const dog = makeEntity(UnitType.I_DOG, House.USSR, 100, 100);

    const ctx = makeCombatContext([mrj, dog]);
    checkVehicleCrush(ctx, mrj);

    expect(dog.alive).toBe(false);
  });

  it('MRJ does NOT crush non-crushable targets (vehicles)', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    const jeep = makeEntity(UnitType.V_JEEP, House.USSR, 100, 100);

    // Vehicles are not crushable (no crushable flag on vehicles)
    expect(jeep.stats.crushable).toBeFalsy();

    const ctx = makeCombatContext([mrj, jeep]);
    checkVehicleCrush(ctx, mrj);

    expect(jeep.alive).toBe(true);
  });

  it('contrast: JEEP is NOT a crusher', () => {
    expect(UNIT_STATS.JEEP.crusher).toBeFalsy();
  });
});


// ============================================================
// 6. Fast Support Vehicle — speed 9 with light armor
//    (C++ udata.cpp: one of the faster ground vehicles)
// ============================================================
describe('MRJ speed and armor class (C++ udata.cpp parity)', () => {
  it('MRJ speed 9 matches Light Tank speed', () => {
    expect(UNIT_STATS.MRJ.speed).toBe(9);
    expect(UNIT_STATS['1TNK'].speed).toBe(9);
  });

  it('MRJ speed 9 matches sibling MGG speed', () => {
    expect(UNIT_STATS.MRJ.speed).toBe(UNIT_STATS.MGG.speed);
  });

  it('MRJ is faster than Medium Tank (speed 8)', () => {
    expect(UNIT_STATS.MRJ.speed).toBeGreaterThan(UNIT_STATS['2TNK'].speed);
  });

  it('MRJ is faster than Heavy Tank (speed 7)', () => {
    expect(UNIT_STATS.MRJ.speed).toBeGreaterThan(UNIT_STATS['3TNK'].speed);
  });

  it('MRJ is faster than Mammoth Tank (speed 4)', () => {
    expect(UNIT_STATS.MRJ.speed).toBeGreaterThan(UNIT_STATS['4TNK'].speed);
  });

  it('MRJ is faster than all infantry (infantry max speed = 4)', () => {
    expect(UNIT_STATS.MRJ.speed).toBeGreaterThan(UNIT_STATS.E1.speed);
    expect(UNIT_STATS.MRJ.speed).toBeGreaterThan(UNIT_STATS.E3.speed);
  });

  it('MRJ is slower than JEEP (speed 10)', () => {
    expect(UNIT_STATS.MRJ.speed).toBeLessThan(UNIT_STATS.JEEP.speed);
  });

  it('MRJ light armor takes SA at 0.6 multiplier', () => {
    expect(UNIT_STATS.MRJ.armor).toBe('light');
    expect(getWarheadMultiplier('SA', 'light')).toBe(0.6);
  });

  it('MRJ light armor takes AP at 0.75 multiplier', () => {
    expect(getWarheadMultiplier('AP', 'light')).toBe(0.75);
  });

  it('MRJ light armor takes HE at 0.6 multiplier', () => {
    expect(getWarheadMultiplier('HE', 'light')).toBe(0.6);
  });
});


// ============================================================
// 7. Damage Speed Factor — standard vehicle behavior
//    (C++ drive.cpp: damaged vehicles slow down at yellow health)
// ============================================================
describe('MRJ damage speed reduction (C++ drive.cpp parity)', () => {
  it('undamaged MRJ has speed factor 1.0', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    expect(damageSpeedFactor(mrj)).toBe(1.0);
  });

  it('MRJ at yellow health (50%) has speed factor 0.75', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    mrj.hp = Math.floor(mrj.maxHp * 0.5);
    expect(damageSpeedFactor(mrj)).toBe(0.75);
  });

  it('MRJ at 1 HP has speed factor 0.75', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    mrj.hp = 1;
    expect(damageSpeedFactor(mrj)).toBe(0.75);
  });

  it('MRJ just above yellow health has normal speed', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    mrj.hp = Math.floor(mrj.maxHp * 0.5) + 1;
    expect(damageSpeedFactor(mrj)).toBe(1.0);
  });
});


// ============================================================
// 8. Stop-Rotate-Move — vehicles stop, rotate, then move
//    (C++ drive.cpp: vehicles don't slide sideways while turning)
// ============================================================
describe('MRJ stop-rotate-move (C++ drive.cpp parity)', () => {
  it('MRJ ROT=5 means gradual rotation (ROT < 8, no instant snap)', () => {
    expect(UNIT_STATS.MRJ.rot).toBe(5);
    expect(UNIT_STATS.MRJ.rot).toBeLessThan(8);
  });

  it('MRJ facing N toward target E: does NOT move until rotation progresses', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    mrj.facing = Dir.N;
    mrj.desiredFacing = Dir.N;
    mrj.bodyFacing32 = Dir.N * 4;

    const startX = mrj.pos.x;
    const startY = mrj.pos.y;
    const target = { x: startX + CELL_SIZE * 3, y: startY }; // due East

    // First moveToward tick — ROT=5 < 8, vehicle stops to rotate
    const arrived = mrj.moveToward(target, mrj.stats.speed);

    expect(arrived).toBe(false);
    // ROT=5: accumulator goes to 5, threshold is 8, so no rotation step on first tick
    // Vehicle should not have moved yet
    expect(mrj.pos.x).toBe(startX);
    expect(mrj.pos.y).toBe(startY);
  });

  it('MRJ eventually rotates and moves after enough ticks', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    mrj.facing = Dir.N;
    mrj.desiredFacing = Dir.N;
    mrj.bodyFacing32 = Dir.N * 4;

    const startX = mrj.pos.x;
    const target = { x: startX + CELL_SIZE * 3, y: mrj.pos.y }; // due East

    // Tick multiple times to allow rotation to accumulate and complete
    let moved = false;
    for (let i = 0; i < 30; i++) {
      mrj.rotTickedThisFrame = false; // reset per-frame guard
      mrj.moveToward(target, mrj.stats.speed);
      if (mrj.pos.x > startX) {
        moved = true;
        break;
      }
    }

    expect(moved).toBe(true);
  });

  it('contrast: JEEP (ROT=10) rotates fast but still uses accumulator (7 ticks for 90 degrees)', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    jeep.facing = Dir.N;
    jeep.bodyFacing32 = Dir.N * 4;

    const startX = jeep.pos.x;
    const target = { x: startX + CELL_SIZE * 3, y: jeep.pos.y };

    // C++ parity: all vehicles use Rotation_Adjust accumulator (no instant snap).
    // First tick starts rotation but JEEP hasn't aligned yet.
    jeep.moveToward(target, jeep.stats.speed);
    expect(jeep.pos.x).toBe(startX); // still rotating, no movement yet

    // Complete rotation and move
    for (let i = 0; i < 10; i++) {
      jeep.rotTickedThisFrame = false;
      jeep.moveToward(target, jeep.stats.speed);
    }
    expect(jeep.facing).toBe(Dir.E);
    expect(jeep.pos.x).toBeGreaterThan(startX);
  });

  it('MRJ tickRotation with ROT=5 does not snap-rotate', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    mrj.facing = Dir.N;
    mrj.desiredFacing = Dir.S; // opposite direction
    mrj.bodyFacing32 = Dir.N * 4;

    const rotated = mrj.tickRotation();

    // ROT=5 < 8: should NOT snap instantly
    expect(rotated).toBe(false);
    expect(mrj.facing).not.toBe(Dir.S);
  });
});


// ============================================================
// 9. Entity Construction — MRJ instantiates correctly
// ============================================================
describe('MRJ entity construction', () => {
  it('constructor sets HP to max (110)', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    expect(mrj.hp).toBe(110);
    expect(mrj.maxHp).toBe(110);
  });

  it('starts alive with default mission GUARD', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    expect(mrj.alive).toBe(true);
    expect(mrj.mission).toBe(Mission.GUARD);
  });

  it('starts in IDLE animation state', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    expect(mrj.animState).toBe(AnimState.IDLE);
  });

  it('is NOT a transport (no passenger capacity)', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    expect(mrj.isTransport).toBe(false);
    expect(mrj.maxPassengers).toBe(0);
  });

  it('is NOT an aircraft', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    expect(mrj.isAirUnit).toBe(false);
  });

  it('is NOT a naval unit', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    expect(mrj.isNavalUnit).toBe(false);
  });

  it('is NOT infantry', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    expect(mrj.stats.isInfantry).toBe(false);
  });

  it('is NOT an ant', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    expect(mrj.isAnt).toBe(false);
  });

  it('position matches constructor arguments', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 200, 300);
    expect(mrj.pos.x).toBe(200);
    expect(mrj.pos.y).toBe(300);
  });
});


// ============================================================
// 10. takeDamage — MRJ survives/dies correctly
// ============================================================
describe('MRJ takeDamage behavior', () => {
  it('survives small arms hit (15 damage)', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    const killed = mrj.takeDamage(15, 'SA');
    expect(killed).toBe(false);
    expect(mrj.alive).toBe(true);
    expect(mrj.hp).toBe(95);
  });

  it('dies when damage exceeds HP', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    const killed = mrj.takeDamage(200, 'AP');
    expect(killed).toBe(true);
    expect(mrj.alive).toBe(false);
    expect(mrj.hp).toBe(0);
    expect(mrj.mission).toBe(Mission.DIE);
    expect(mrj.animState).toBe(AnimState.DIE);
  });

  it('dies at exactly 0 HP', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    const killed = mrj.takeDamage(110, 'AP');
    expect(killed).toBe(true);
    expect(mrj.alive).toBe(false);
    expect(mrj.hp).toBe(0);
  });

  it('damage flash activates on hit', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    expect(mrj.damageFlash).toBe(0);
    mrj.takeDamage(10, 'SA');
    expect(mrj.damageFlash).toBe(4);
  });

  it('does not take damage when invulnerable (Iron Curtain)', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    mrj.ironCurtainTick = 100;
    const killed = mrj.takeDamage(999, 'Super');
    expect(killed).toBe(false);
    expect(mrj.alive).toBe(true);
    expect(mrj.hp).toBe(110);
  });

  it('does not take damage when dead', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    mrj.alive = false;
    const killed = mrj.takeDamage(50, 'SA');
    expect(killed).toBe(false);
  });
});


// ============================================================
// 11. Vehicle sprite frame — uses 32-step body rotation
//     (C++ Dir_To_32, BodyShape lookup — no turret overlay)
// ============================================================
describe('MRJ sprite frame (C++ vehicle SHP parity)', () => {
  it('spriteFrame returns a valid number', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    const frame = mrj.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('spriteFrame uses bodyFacing32 (not turret — no turret exists)', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    mrj.bodyFacing32 = 0;  // facing N
    const frameN = mrj.spriteFrame;

    mrj.bodyFacing32 = 8;  // facing E
    const frameE = mrj.spriteFrame;

    // Different facing should produce different frames
    expect(frameN).not.toBe(frameE);
  });

  it('no turretFrame needed (hasTurret=false)', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    expect(mrj.hasTurret).toBe(false);
    // turretFrame getter still exists but should not be rendered for MRJ
    // Verify it does not throw
    const tf = mrj.turretFrame;
    expect(typeof tf).toBe('number');
  });
});


// ============================================================
// 12. MRJ shares stats pattern with MGG (sibling support vehicles)
//     Both are Allied, unarmed, fast, light armor, crusher
// ============================================================
describe('MRJ and MGG sibling stats (C++ udata.cpp parity)', () => {
  it('same HP: 110', () => {
    expect(UNIT_STATS.MRJ.strength).toBe(UNIT_STATS.MGG.strength);
    expect(UNIT_STATS.MRJ.strength).toBe(110);
  });

  it('same armor: light', () => {
    expect(UNIT_STATS.MRJ.armor).toBe(UNIT_STATS.MGG.armor);
    expect(UNIT_STATS.MRJ.armor).toBe('light');
  });

  it('same speed: 9', () => {
    expect(UNIT_STATS.MRJ.speed).toBe(UNIT_STATS.MGG.speed);
    expect(UNIT_STATS.MRJ.speed).toBe(9);
  });

  it('same cost: 600', () => {
    expect(UNIT_STATS.MRJ.cost).toBe(UNIT_STATS.MGG.cost);
    expect(UNIT_STATS.MRJ.cost).toBe(600);
  });

  it('both unarmed (primaryWeapon=null)', () => {
    expect(UNIT_STATS.MRJ.primaryWeapon).toBeNull();
    expect(UNIT_STATS.MGG.primaryWeapon).toBeNull();
  });

  it('MRJ is crusher, MGG is not (no Tracked=yes in rules.ini for MGG)', () => {
    expect(UNIT_STATS.MRJ.crusher).toBe(true);
    expect(UNIT_STATS.MGG.crusher).toBeFalsy();
  });

  it('both allied owner', () => {
    expect(UNIT_STATS.MRJ.owner).toBe('allied');
    expect(UNIT_STATS.MGG.owner).toBe('allied');
  });

  it('both have no turret', () => {
    const mrj = makeEntity(UnitType.V_MRJ, House.Spain, 100, 100);
    const mgg = makeEntity(UnitType.V_MGG, House.Spain, 200, 200);
    expect(mrj.hasTurret).toBe(false);
    expect(mgg.hasTurret).toBe(false);
  });

  it('different sight range (MRJ=7 vs MGG=4)', () => {
    expect(UNIT_STATS.MRJ.sight).toBe(7);
    expect(UNIT_STATS.MGG.sight).toBe(4);
    expect(UNIT_STATS.MRJ.sight).toBeGreaterThan(UNIT_STATS.MGG.sight);
  });
});
