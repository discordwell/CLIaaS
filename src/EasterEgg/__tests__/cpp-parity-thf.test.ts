/**
 * C++ Behavioral Parity: THF — Thief
 *
 * Tests verify Thief behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * THF is an unarmed Allied infiltration unit: 25 HP, no weapon, no armor,
 * crushable infantry. These tests describe WHAT happens with THF (observable
 * outcomes: stats, weapon nullity, death, fear, prone, crushing), not HOW
 * the code implements it. The same scenarios should produce identical results
 * in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, PRONE_DAMAGE_BIAS,
  PRODUCTION_ITEMS, CIVILIAN_UNIT_TYPES,
  COUNTRY_BONUSES,
  buildDefaultAlliances,
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

// -- Stats Verification (rules.ini / idata.cpp parity) ------------------------
// C++ idata.cpp (infantry type data) -- THF entry and RULES.INI [THF] section

describe('THF stats verification (idata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.THF;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'THF');

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

  it('cost is 500 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(500);
  });

  it('owner is allied faction', () => {
    expect(stats.owner).toBe('allied');
  });

  it('primaryWeapon is null (unarmed)', () => {
    expect(stats.primaryWeapon).toBeNull();
  });

  it('secondaryWeapon is null (unarmed)', () => {
    expect(stats.secondaryWeapon).toBeNull();
  });

  it('sight is 5', () => {
    expect(stats.sight).toBe(5);
  });

  it('rot is 8 (instant facing snap for infantry)', () => {
    expect(stats.rot).toBe(8);
  });

  it('Entity constructor initializes HP to strength (25)', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    expect(thf.hp).toBe(25);
    expect(thf.maxHp).toBe(25);
  });
});

// -- No Weapon (unarmed unit) -------------------------------------------------
// C++ idata.cpp -- THF has Primary=YOURWEAPON:NONE, no weapon assigned

describe('THF has no weapon (idata.cpp)', () => {
  it('Entity.weapon is null after construction', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    expect(thf.weapon).toBeNull();
  });

  it('Entity.weapon2 is null (no secondary)', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    expect(thf.weapon2).toBeNull();
  });

  it('selectWeapon returns null for any target', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const getWarheadMult = () => 1.0;
    const result = thf.selectWeapon(target, getWarheadMult);
    expect(result).toBeNull();
  });

  it('inRange always returns false (no weapon range)', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    const adjacent = entityAtCell(UnitType.I_E1, House.USSR, 10, 10); // same cell
    expect(thf.inRange(adjacent)).toBe(false);
  });
});

// -- Cannot Retaliate (techno.cpp) --------------------------------------------
// C++ techno.cpp -- triggerRetaliation requires a weapon to fire back

describe('THF cannot retaliate (techno.cpp)', () => {
  it('THF does not acquire a target when hit by enemy (no weapon)', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    thf.mission = Mission.GUARD;
    thf.target = null;

    const ctx = makeCombatCtx([thf, attacker]);
    triggerRetaliation(ctx, thf, attacker);

    expect(thf.target).toBeNull();
    expect(thf.mission).toBe(Mission.GUARD);
  });

  it('THF stays on GUARD mission after being attacked', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    thf.mission = Mission.GUARD;

    const ctx = makeCombatCtx([thf, attacker]);
    triggerRetaliation(ctx, thf, attacker);

    expect(thf.mission).toBe(Mission.GUARD);
  });
});

// -- Fragile (25 HP -- lowest infantry HP) ------------------------------------
// C++ rules.ini -- THF Strength=25 makes it the most fragile infantry unit

describe('THF fragility (25 HP)', () => {
  it('THF dies in one hit from 25+ damage', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    const killed = thf.takeDamage(25, 'SA');
    expect(killed).toBe(true);
    expect(thf.alive).toBe(false);
    expect(thf.hp).toBe(0);
  });

  it('THF dies from two moderate hits (15 + 15 > 25)', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    const killed1 = thf.takeDamage(15, 'SA');
    expect(killed1).toBe(false);
    expect(thf.alive).toBe(true);
    expect(thf.hp).toBe(10);

    const killed2 = thf.takeDamage(15, 'SA');
    expect(killed2).toBe(true);
    expect(thf.alive).toBe(false);
  });

  it('THF enters DIE mission and animState on death', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    thf.takeDamage(25, 'SA');
    expect(thf.mission).toBe(Mission.DIE);
    expect(thf.animState).toBe(AnimState.DIE);
  });

  it('THF HP is lower than E1 HP (25 < 50)', () => {
    expect(UNIT_STATS.THF.strength).toBeLessThan(UNIT_STATS.E1.strength);
  });
});

// -- Crushable (drive.cpp:Ok_To_Move) ----------------------------------------
// C++ drive.cpp -- crusher vehicles kill crushable infantry in the same cell

describe('THF crushable (drive.cpp:Ok_To_Move)', () => {
  it('THF is killed when a crusher vehicle (2TNK) enters its cell', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([thf, tank]);
    checkVehicleCrush(ctx, tank);
    expect(thf.alive).toBe(false);
  });

  it('THF crushable stat is true', () => {
    expect(UNIT_STATS.THF.crushable).toBe(true);
  });

  it('THF is NOT crushed by allied crusher vehicle (IsAFriend check)', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([thf, tank]);
    checkVehicleCrush(ctx, tank);
    expect(thf.alive).toBe(true);
    expect(thf.hp).toBe(thf.maxHp);
  });
});

// -- Fear / Prone System (infantry.cpp:329-457) -------------------------------
// C++ infantry.cpp -- FearType 0-255. Fear increases on damage, decrements 1/tick.
// IsProne when fear >= FEAR_ANXIOUS (10). Prone infantry take 50% damage.

describe('THF fear / prone system (infantry.cpp:329-457)', () => {
  it('THF starts with fear=0, isProne=false', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    expect(thf.fear).toBe(0);
    expect(thf.isProne).toBe(false);
  });

  it('when THF takes damage, fear increases to at least FEAR_SCARED (100)', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    thf.takeDamage(5, 'SA');
    expect(thf.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });

  it('prone THF takes 50% damage on next hit', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    thf.isProne = true;
    const hpBefore = thf.hp;
    thf.takeDamage(10, 'SA');
    const damageTaken = hpBefore - thf.hp;
    // 10 * 0.5 = 5, clamped to at least 1
    expect(damageTaken).toBe(5);
  });

  it('non-prone THF takes full damage', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    expect(thf.isProne).toBe(false);
    const hpBefore = thf.hp;
    thf.takeDamage(10, 'SA');
    const damageTaken = hpBefore - thf.hp;
    expect(damageTaken).toBe(10);
  });

  it('damage -> fear -> prone -> next hit deals ~half: full sequence', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    expect(thf.isProne).toBe(false);

    // Step 1: Take first hit -- fear should jump to >= FEAR_SCARED (100)
    thf.takeDamage(5, 'SA');
    expect(thf.alive).toBe(true);
    expect(thf.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);

    // Step 2: Since fear >= FEAR_ANXIOUS (10), set isProne
    // (In the real game loop, this would be done by the infantry AI tick)
    thf.isProne = true;

    // Step 3: Take second hit while prone -- should deal ~half damage
    const hpBeforeSecond = thf.hp;
    thf.takeDamage(10, 'SA');
    const secondDamage = hpBeforeSecond - thf.hp;
    // 10 * 0.5 = 5
    expect(secondDamage).toBe(5);
  });
});

// -- Not a Civilian (infantry.cpp) --------------------------------------------
// C++ infantry.cpp -- THF is not in the civilian category; civilians are C1-C10

describe('THF is not a civilian', () => {
  it('isCivilian property returns false', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    expect(thf.isCivilian).toBe(false);
  });

  it('THF type is not in CIVILIAN_UNIT_TYPES set', () => {
    expect(CIVILIAN_UNIT_TYPES.has(UnitType.I_THF)).toBe(false);
    expect(CIVILIAN_UNIT_TYPES.has('THF')).toBe(false);
  });
});

// -- Infantry Animation / Identity (infantry.cpp:479) -------------------------
// C++ infantry.cpp -- THF uses infantry animation system

describe('THF infantry identity (infantry.cpp)', () => {
  it('THF isInfantry = true', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    expect(thf.stats.isInfantry).toBe(true);
  });

  it('THF isAnt = false', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    expect(thf.isAnt).toBe(false);
  });

  it('THF isNavalUnit = false', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    expect(thf.isNavalUnit).toBe(false);
  });

  it('THF isAirUnit = false', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    expect(thf.isAirUnit).toBe(false);
  });

  it('THF spriteFrame returns a valid frame number', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    const frame = thf.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('THF alive=true starts in IDLE animState', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    expect(thf.alive).toBe(true);
    expect(thf.animState).toBe(AnimState.IDLE);
  });

  it('THF rot >= 8 means instant facing snap', () => {
    expect(UNIT_STATS.THF.rot).toBe(8);
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    thf.facing = Dir.N;
    thf.desiredFacing = Dir.S;
    const aligned = thf.tickRotation();
    expect(aligned).toBe(true);
    expect(thf.facing).toBe(Dir.S);
  });
});

// -- Movement (infantry.cpp) --------------------------------------------------
// C++ infantry.cpp -- infantry are nimble: they move while rotating

describe('THF movement -- nimble infantry (infantry.cpp)', () => {
  it('THF moves while rotating (nimble infantry behavior)', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    thf.facing = Dir.N;
    thf.desiredFacing = Dir.N;
    thf.bodyFacing32 = Dir.N * 4;

    const startX = thf.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: thf.pos.y }; // due East

    const arrived = thf.moveToward(targetPos, thf.stats.speed);

    // Position should have changed (moved toward target)
    const distMoved = Math.sqrt((thf.pos.x - startX) ** 2);
    expect(distMoved).toBeGreaterThan(0);
  });

  it('THF speed matches stat (4)', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    expect(thf.stats.speed).toBe(4);
  });
});

// -- AI Scatter on Damage (techno.cpp) ----------------------------------------
// C++ techno.cpp -- AI-controlled units on GUARD scatter when damaged

describe('THF AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled THF on GUARD scatters when damaged (IQ >= 2)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const thf = entityAtCell(UnitType.I_THF, House.USSR, 10, 10);
      thf.mission = Mission.GUARD;
      const ctx = makeCombatCtx([thf]);
      aiScatterOnDamage(ctx, thf);
      if (thf.mission === Mission.MOVE && thf.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('player-controlled THF does NOT scatter', () => {
    const thf = entityAtCell(UnitType.I_THF, House.Spain, 10, 10);
    thf.mission = Mission.GUARD;

    const ctx = makeCombatCtx([thf]);
    aiScatterOnDamage(ctx, thf);

    expect(thf.mission).toBe(Mission.GUARD);
    expect(thf.moveTarget).toBeNull();
  });
});
