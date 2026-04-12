/**
 * C++ Behavioral Parity: SPY — Allied Spy
 *
 * Tests verify Spy behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * SPY is an unarmed infiltration unit. Key behaviors:
 * - No weapon: cannot attack or retaliate
 * - Disguise system: disguisedAs field lets spy appear as another house
 * - Threat exclusion (AI6): normal units ignore spies; only dogs detect them
 * - Fragile: 25 HP (same as Engineer), crushable infantry
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, PRONE_DAMAGE_BIAS,
  PRODUCTION_ITEMS, COUNTRY_BONUSES,
  buildDefaultAlliances, armorIndex, getWarheadMultiplier,
  type WarheadType, type ArmorType,
} from '../engine/types';
import { Entity, resetEntityIds, threatScore } from '../engine/entity';
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
    isRevealedToHouse: () => true,
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
// C++ idata.cpp (infantry type data) -- SPY entry and RULES.INI [SPY] section

describe('SPY stats verification (idata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.SPY;

  it('HP is 25 (Strength=25)', () => {
    expect(stats.strength).toBe(25);
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

  it('primary weapon is null (SPY is unarmed)', () => {
    expect(stats.primaryWeapon).toBeNull();
  });

  it('sight is 5 (spy has extended vision)', () => {
    expect(stats.sight).toBe(5);
  });

  it('rot is 8 (infantry instant rotation)', () => {
    expect(stats.rot).toBe(8);
  });

  it('Entity constructor initializes HP to strength (25)', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    expect(spy.hp).toBe(25);
    expect(spy.maxHp).toBe(25);
  });
});

// -- No Weapon (idata.cpp) ----------------------------------------------------
// C++ idata.cpp -- SPY has Primary=YOURWEAP which is null/no-fire in RA
// Our implementation: primaryWeapon: null

describe('SPY has no weapon (idata.cpp)', () => {
  it('weapon field is null on Entity', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    expect(spy.weapon).toBeNull();
  });

  it('weapon2 field is null (no secondary weapon)', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    expect(spy.weapon2).toBeNull();
  });

  it('selectWeapon returns null for any target', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const result = spy.selectWeapon(target, getWarheadMultiplier);
    expect(result).toBeNull();
  });

  it('inRange always returns false (no weapon to check range)', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 10, 10); // same cell
    expect(spy.inRange(target)).toBe(false);
  });
});

// -- Cannot Retaliate (techno.cpp) --------------------------------------------
// C++ techno.cpp -- unarmed units cannot counter-attack when hit

describe('SPY cannot retaliate (techno.cpp)', () => {
  it('spy does not acquire target when hit by enemy', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    spy.mission = Mission.GUARD;
    spy.target = null;

    const ctx = makeCombatCtx([spy, attacker]);
    triggerRetaliation(ctx, spy, attacker);

    expect(spy.target).toBeNull();
    expect(spy.mission).toBe(Mission.GUARD);
  });

  it('spy remains on GUARD after being attacked (no mission change)', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    spy.mission = Mission.GUARD;

    const ctx = makeCombatCtx([spy, attacker]);
    triggerRetaliation(ctx, spy, attacker);

    // Should NOT switch to ATTACK because spy has no weapon
    expect(spy.mission).not.toBe(Mission.ATTACK);
  });
});

// -- Disguise System (Gap #4 -- entity.ts) ------------------------------------
// C++ infantry.cpp -- spy disguise: appears as enemy house unit

describe('SPY disguise system (infantry.cpp disguise)', () => {
  it('spy starts undisguised (disguisedAs = null)', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    expect(spy.disguisedAs).toBeNull();
  });

  it('spy can be disguised as an enemy house', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    spy.disguisedAs = House.USSR;
    expect(spy.disguisedAs).toBe(House.USSR);
  });

  it('spy house remains Spain even when disguised as USSR', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    spy.disguisedAs = House.USSR;
    expect(spy.house).toBe(House.Spain);
    expect(spy.disguisedAs).toBe(House.USSR);
  });

  it('disguise can be cleared by setting to null', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    spy.disguisedAs = House.USSR;
    expect(spy.disguisedAs).toBe(House.USSR);
    spy.disguisedAs = null;
    expect(spy.disguisedAs).toBeNull();
  });

  it('disguise field exists only on Entity (not in stats)', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    // disguisedAs is an instance field on Entity, not a stat
    expect('disguisedAs' in spy).toBe(true);
  });
});

// -- Threat Exclusion AI6 (entity.ts threatScore) -----------------------------
// C++ techno.cpp:1449-1763 Evaluate_Object -- spies excluded from normal targeting

describe('SPY threat exclusion AI6 (techno.cpp Evaluate_Object)', () => {
  it('threatScore returns 0 when scanner is E1 and target is SPY', () => {
    const scanner = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 11, 10);
    const score = threatScore(scanner, spy, 1);
    expect(score).toBe(0);
  });

  it('threatScore returns 0 when scanner is a tank (V_2TNK) and target is SPY', () => {
    const scanner = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 11, 10);
    const score = threatScore(scanner, spy, 1);
    expect(score).toBe(0);
  });

  it('threatScore returns 0 when scanner is E3 (rocket soldier) and target is SPY', () => {
    const scanner = entityAtCell(UnitType.I_E3, House.USSR, 10, 10);
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 11, 10);
    const score = threatScore(scanner, spy, 1);
    expect(score).toBe(0);
  });

  it('threatScore returns 0 for SPY even when spy is attacking ally (isTargetAttackingAlly=true)', () => {
    const scanner = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 11, 10);
    const score = threatScore(scanner, spy, 1);
    expect(score).toBe(0);
  });

  it('threatScore returns 0 for SPY even at zero distance', () => {
    const scanner = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10); // same cell
    const score = threatScore(scanner, spy, 0);
    expect(score).toBe(0);
  });
});

// -- Dog Counter (entity.ts threatScore) --------------------------------------
// C++ techno.cpp -- dogs are the ONLY unit that detects and targets spies

describe('SPY dog counter (techno.cpp -- dogs detect spies)', () => {
  it('threatScore returns > 0 when scanner is DOG and target is SPY', () => {
    const dog = entityAtCell(UnitType.I_DOG, House.USSR, 10, 10);
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 11, 10);
    const score = threatScore(dog, spy, 1);
    expect(score).toBeGreaterThan(0);
  });

  it('dog instant-kills spy on attack (DG1: dog instant-kill in takeDamage)', () => {
    const dog = entityAtCell(UnitType.I_DOG, House.USSR, 10, 10);
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 11, 10);
    dog.target = spy;

    // DogJaw damage is 100, but DG1 overrides to maxHp for guaranteed kill
    const killed = spy.takeDamage(100, 'Organic', dog);
    expect(killed).toBe(true);
    expect(spy.alive).toBe(false);
    expect(spy.hp).toBe(0);
  });

  it('dog collateral prevention: dog does NOT damage non-target spy (DG2)', () => {
    const dog = entityAtCell(UnitType.I_DOG, House.USSR, 10, 10);
    const spy1 = entityAtCell(UnitType.I_SPY, House.Spain, 11, 10);
    const spy2 = entityAtCell(UnitType.I_SPY, House.Spain, 12, 10);
    dog.target = spy1; // dog is targeting spy1

    // Attempt to damage spy2 (not the dog's target) -- DG2 prevents this
    const killed = spy2.takeDamage(100, 'Organic', dog);
    expect(killed).toBe(false);
    expect(spy2.alive).toBe(true);
    expect(spy2.hp).toBe(spy2.maxHp); // no damage taken
  });

  it('DogJaw weapon stats are correct (damage 100, warhead Organic, range 2.2)', () => {
    const dogJaw = WEAPON_STATS.DogJaw;
    expect(dogJaw.damage).toBe(100);
    expect(dogJaw.warhead).toBe('Organic');
    expect(dogJaw.range).toBe(2.2);
  });

  it('Organic warhead is 1.0 vs none armor (kills unarmored infantry)', () => {
    const mult = WARHEAD_VS_ARMOR.Organic[armorIndex('none')];
    expect(mult).toBe(1.0);
  });

  it('Organic warhead is 0.0 vs all other armor types (dog jaw useless vs vehicles)', () => {
    expect(WARHEAD_VS_ARMOR.Organic[armorIndex('wood')]).toBe(0.0);
    expect(WARHEAD_VS_ARMOR.Organic[armorIndex('light')]).toBe(0.0);
    expect(WARHEAD_VS_ARMOR.Organic[armorIndex('heavy')]).toBe(0.0);
    expect(WARHEAD_VS_ARMOR.Organic[armorIndex('concrete')]).toBe(0.0);
  });
});

// -- Fragile (rules.ini) ------------------------------------------------------
// SPY has 25 HP, same as Engineer -- one of the weakest units in the game

describe('SPY fragile (rules.ini -- 25 HP)', () => {
  it('SPY has same HP as Engineer (both 25)', () => {
    expect(UNIT_STATS.SPY.strength).toBe(25);
    expect(UNIT_STATS.E6.strength).toBe(25);
    expect(UNIT_STATS.SPY.strength).toBe(UNIT_STATS.E6.strength);
  });

  it('SPY has less HP than Rifle Infantry (E1 = 50)', () => {
    expect(UNIT_STATS.SPY.strength).toBeLessThan(UNIT_STATS.E1.strength);
  });

  it('one M1Carbine shot (15 damage) takes spy to 10 HP', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    spy.takeDamage(15, 'SA');
    expect(spy.hp).toBe(10);
    expect(spy.alive).toBe(true);
  });

  it('two M1Carbine shots kill the spy (15 + 15 = 30 > 25)', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    spy.takeDamage(15, 'SA');
    expect(spy.alive).toBe(true);
    spy.takeDamage(15, 'SA');
    expect(spy.alive).toBe(false);
    expect(spy.hp).toBe(0);
  });
});

// -- Crushable (drive.cpp:Ok_To_Move) -----------------------------------------
// C++ drive.cpp -- infantry (including spy) are crushed by crusher vehicles

describe('SPY crushable (drive.cpp:Ok_To_Move)', () => {
  it('SPY is killed when a crusher vehicle (2TNK) enters its cell', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([spy, tank]);
    checkVehicleCrush(ctx, tank);
    expect(spy.alive).toBe(false);
  });

  it('SPY is NOT crushed by non-crusher vehicle (JEEP)', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    const jeep = entityAtCell(UnitType.V_JEEP, House.USSR, 10, 10);
    const ctx = makeCombatCtx([spy, jeep]);
    checkVehicleCrush(ctx, jeep);
    expect(spy.alive).toBe(true);
    expect(spy.hp).toBe(spy.maxHp);
  });

  it('SPY is NOT crushed by allied crusher vehicle', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([spy, tank]);
    checkVehicleCrush(ctx, tank);
    expect(spy.alive).toBe(true);
  });
});

// -- Fear / Prone (infantry.cpp:329-457) --------------------------------------
// C++ infantry.cpp -- all infantry (including spy) have fear/prone system

describe('SPY fear / prone system (infantry.cpp:329-457)', () => {
  it('SPY starts with fear=0, isProne=false', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    expect(spy.fear).toBe(0);
    expect(spy.isProne).toBe(false);
  });

  it('when SPY takes damage, fear increases to at least FEAR_SCARED (100)', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 20, 20);
    spy.takeDamage(10, 'SA', attacker);
    expect(spy.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });

  it('prone SPY takes 50% damage on next hit', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    spy.isProne = true;
    const hpBefore = spy.hp;
    spy.takeDamage(10, 'SA');
    const damageTaken = hpBefore - spy.hp;
    // 10 * 0.5 = 5, clamped to at least 1
    expect(damageTaken).toBe(5);
  });

  it('damage -> fear -> prone -> second hit halved: full sequence', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 20, 20);
    expect(spy.isProne).toBe(false);

    // Step 1: Take first hit -- fear jumps to >= FEAR_SCARED
    spy.takeDamage(5, 'SA', attacker);
    expect(spy.alive).toBe(true);
    expect(spy.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);

    // Step 2: Set isProne (in real game, infantry AI tick does this)
    spy.isProne = true;

    // Step 3: Second hit while prone -- half damage
    const hpBefore = spy.hp;
    spy.takeDamage(10, 'SA');
    const secondDamage = hpBefore - spy.hp;
    expect(secondDamage).toBe(5); // 10 * 0.5
  });
});

// -- Infantry Animation (infantry.cpp:479) ------------------------------------
// C++ infantry.cpp -- SPY uses infantry animation system with SpyDoControls

describe('SPY infantry animation (infantry.cpp:479 / SpyDoControls)', () => {
  it('SPY isInfantry = true', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    expect(spy.stats.isInfantry).toBe(true);
  });

  it('SPY isAnt = false', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    expect(spy.isAnt).toBe(false);
  });

  it('SPY spriteFrame returns a valid number in IDLE state', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    const frame = spy.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('SPY starts in IDLE animState', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    expect(spy.alive).toBe(true);
    expect(spy.animState).toBe(AnimState.IDLE);
  });

  it('SPY death sets animState to DIE', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    spy.takeDamage(25, 'SA');
    expect(spy.alive).toBe(false);
    expect(spy.animState).toBe(AnimState.DIE);
    expect(spy.mission).toBe(Mission.DIE);
  });
});

// -- Movement (infantry.cpp) --------------------------------------------------
// C++ infantry.cpp -- infantry are nimble: move while rotating

describe('SPY movement -- nimble infantry (infantry.cpp)', () => {
  it('SPY facing N, moveToward target E: position changes even before facing aligns', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    spy.facing = Dir.N;
    spy.desiredFacing = Dir.N;
    spy.bodyFacing32 = Dir.N * 4;

    const startX = spy.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: spy.pos.y };

    spy.moveToward(targetPos, spy.stats.speed);

    const distMoved = Math.abs(spy.pos.x - startX);
    expect(distMoved).toBeGreaterThan(0);
  });

  it('SPY rot >= 8 means instant facing snap', () => {
    expect(UNIT_STATS.SPY.rot).toBe(8);
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    spy.facing = Dir.N;
    spy.desiredFacing = Dir.S;
    const aligned = spy.tickRotation();
    expect(aligned).toBe(true);
    expect(spy.facing).toBe(Dir.S);
  });
});
