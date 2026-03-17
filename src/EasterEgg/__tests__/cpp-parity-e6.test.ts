/**
 * C++ Behavioral Parity: E6 — Engineer
 *
 * Tests verify Engineer behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with E6 (observable outcomes: HP, alive/dead,
 * mission, fear, isProne, weapon state), not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, PRONE_DAMAGE_BIAS,
  PRODUCTION_ITEMS, COUNTRY_BONUSES, INFANTRY_ANIMS,
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
// C++ idata.cpp (infantry type data) -- E6 entry and RULES.INI [E6] section

describe('E6 stats verification (idata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.E6;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'E6');

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

  it('primaryWeapon is null (Engineer has no weapon)', () => {
    expect(stats.primaryWeapon).toBeNull();
  });

  it('cost is 500 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(500);
  });

  it('faction is both (available to allied and soviet)', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('both');
  });

  it('Entity constructor initializes HP to strength', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    expect(e6.hp).toBe(25);
    expect(e6.maxHp).toBe(25);
  });

  it('rot is 8 (infantry instant facing snap)', () => {
    expect(stats.rot).toBe(8);
  });
});

// -- No Weapon (idata.cpp -- Engineer primaryWeapon=null) ---------------------
// C++ idata.cpp -- E6 entry: Primary=YOURWEAPON=null, no weapon assigned

describe('E6 no weapon (idata.cpp)', () => {
  it('Entity.weapon is null after construction', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    expect(e6.weapon).toBeNull();
  });

  it('Entity.weapon2 is null (no secondary weapon)', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    expect(e6.weapon2).toBeNull();
  });

  it('inRange always returns false (no weapon range to check)', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 11, 10); // 1 cell away
    expect(e6.inRange(target)).toBe(false);
  });

  it('inRange returns false even at point-blank (same cell)', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    expect(e6.inRange(target)).toBe(false);
  });
});

// -- selectWeapon returns null (techno.cpp:Can_Fire) --------------------------
// C++ techno.cpp -- selectWeapon: no primary or secondary means null

describe('E6 selectWeapon returns null (techno.cpp:Can_Fire)', () => {
  it('selectWeapon returns null against any target', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const getWarheadMult = (warhead: string, armor: string) => 1.0;
    const result = e6.selectWeapon(target, getWarheadMult as any);
    expect(result).toBeNull();
  });

  it('selectWeapon returns null against a vehicle', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const getWarheadMult = (warhead: string, armor: string) => 1.0;
    const result = e6.selectWeapon(tank, getWarheadMult as any);
    expect(result).toBeNull();
  });
});

// -- Cannot Retaliate (techno.cpp) --------------------------------------------
// C++ techno.cpp -- triggerRetaliation skips units with no weapon

describe('E6 cannot retaliate (techno.cpp)', () => {
  it('E6 on GUARD does not acquire target when attacked', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    e6.mission = Mission.GUARD;
    e6.target = null;

    const ctx = makeCombatCtx([e6, attacker]);
    triggerRetaliation(ctx, e6, attacker);

    expect(e6.target).toBeNull();
    expect(e6.mission).toBe(Mission.GUARD);
  });

  it('E6 does not switch to ATTACK mission after being hit', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    e6.mission = Mission.GUARD;

    const ctx = makeCombatCtx([e6, attacker]);
    triggerRetaliation(ctx, e6, attacker);

    expect(e6.mission).not.toBe(Mission.ATTACK);
  });

  it('E6 does not retaliate even when hit multiple times', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    e6.mission = Mission.GUARD;

    const ctx = makeCombatCtx([e6, attacker]);

    // Hit 3 times -- never retaliates
    for (let i = 0; i < 3; i++) {
      e6.takeDamage(5, 'SA');
      triggerRetaliation(ctx, e6, attacker);
    }

    expect(e6.target).toBeNull();
    expect(e6.mission).toBe(Mission.GUARD);
  });
});

// -- Fragile: 25 HP, lowest non-civilian infantry (idata.cpp) -----------------
// C++ idata.cpp -- E6 Strength=25 is the lowest among combatant infantry

describe('E6 fragile -- 25 HP (idata.cpp)', () => {
  it('E6 HP (25) is lower than E1 (50)', () => {
    expect(UNIT_STATS.E6.strength).toBeLessThan(UNIT_STATS.E1.strength);
  });

  it('E6 HP (25) is lower than E3 Rocket Soldier (45)', () => {
    expect(UNIT_STATS.E6.strength).toBeLessThan(UNIT_STATS.E3.strength);
  });

  it('E6 HP (25) is lower than E4 Flamethrower (40)', () => {
    expect(UNIT_STATS.E6.strength).toBeLessThan(UNIT_STATS.E4.strength);
  });

  it('E6 dies in 2 hits from M1Carbine (15 dmg each)', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    expect(e6.hp).toBe(25);

    e6.takeDamage(15, 'SA');
    expect(e6.alive).toBe(true);
    expect(e6.hp).toBe(10);

    const killed = e6.takeDamage(15, 'SA');
    expect(killed).toBe(true);
    expect(e6.alive).toBe(false);
    expect(e6.hp).toBe(0);
  });

  it('E6 dies from a single heavy hit (25+ damage)', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    const killed = e6.takeDamage(25, 'HE');
    expect(killed).toBe(true);
    expect(e6.alive).toBe(false);
  });

  it('on death, mission becomes DIE and animState becomes DIE', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    e6.takeDamage(30, 'SA');
    expect(e6.mission).toBe(Mission.DIE);
    expect(e6.animState).toBe(AnimState.DIE);
  });
});

// -- Crushable (drive.cpp:Ok_To_Move) -----------------------------------------
// C++ drive.cpp -- E6 is infantry and crushable, killed by crusher vehicles

describe('E6 crushable (drive.cpp:Ok_To_Move)', () => {
  it('E6 is killed when a crusher vehicle (2TNK) enters its cell', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([e6, tank]);
    checkVehicleCrush(ctx, tank);
    expect(e6.alive).toBe(false);
  });

  it('E6 is NOT crushed by non-crusher vehicle (JEEP)', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    const jeep = entityAtCell(UnitType.V_JEEP, House.USSR, 10, 10);
    const ctx = makeCombatCtx([e6, jeep]);
    checkVehicleCrush(ctx, jeep);
    expect(e6.alive).toBe(true);
    expect(e6.hp).toBe(e6.maxHp);
  });

  it('E6 is NOT crushed by allied crusher vehicle', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([e6, tank]);
    checkVehicleCrush(ctx, tank);
    expect(e6.alive).toBe(true);
    expect(e6.hp).toBe(e6.maxHp);
  });
});

// -- Fear / Prone System (infantry.cpp:329-457) -------------------------------
// C++ infantry.cpp -- E6 has fear/prone like all infantry, even though unarmed

describe('E6 fear / prone system (infantry.cpp:329-457)', () => {
  it('E6 starts with fear=0, isProne=false', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    expect(e6.fear).toBe(0);
    expect(e6.isProne).toBe(false);
  });

  it('when E6 takes damage, fear increases to at least FEAR_SCARED (100)', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    e6.takeDamage(5, 'SA');
    expect(e6.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });

  it('prone E6 takes 50% damage on next hit', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    e6.isProne = true;
    const hpBefore = e6.hp;
    e6.takeDamage(10, 'SA');
    const damageTaken = hpBefore - e6.hp;
    // 10 * 0.5 = 5, clamped to at least 1
    expect(damageTaken).toBe(5);
  });

  it('damage -> fear -> prone -> next hit deals ~half: full sequence', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    expect(e6.isProne).toBe(false);

    // Step 1: Take first hit -- fear jumps to >= FEAR_SCARED
    e6.takeDamage(5, 'SA');
    expect(e6.alive).toBe(true);
    expect(e6.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);

    // Step 2: Set prone (game loop responsibility)
    e6.isProne = true;

    // Step 3: Take second hit while prone -- should deal ~half damage
    const hpBeforeSecond = e6.hp;
    e6.takeDamage(10, 'SA');
    const secondDamage = hpBeforeSecond - e6.hp;
    // 10 * 0.5 = 5
    expect(secondDamage).toBe(5);
  });

  it('E6 has prone animation in INFANTRY_ANIMS (goes prone even without weapon)', () => {
    const anim = INFANTRY_ANIMS.E6;
    expect(anim).toBeDefined();
    expect(anim.prone).toBeDefined();
    expect(anim.prone!.frame).toBeGreaterThanOrEqual(0);
  });

  it('E6 has crawl animation in INFANTRY_ANIMS', () => {
    const anim = INFANTRY_ANIMS.E6;
    expect(anim.crawl).toBeDefined();
    expect(anim.crawl!.count).toBeGreaterThan(0);
  });
});

// -- No Attack Animation (idata.cpp:176) --------------------------------------
// C++ E6DoControls -- fire: { frame:0, count:0, jump:0 } means no fire animation

describe('E6 no attack animation (idata.cpp:176 E6DoControls)', () => {
  it('INFANTRY_ANIMS.E6.fire.count is 0 (no fire frames)', () => {
    const anim = INFANTRY_ANIMS.E6;
    expect(anim.fire.count).toBe(0);
  });

  it('spriteFrame in ATTACK animState returns 0 (fallback for no fire anim)', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    e6.animState = AnimState.ATTACK;
    e6.animFrame = 0;
    // C++ infantry.cpp:421: "if (!d.count) return 0;" -- engineers with no fire anim
    expect(e6.spriteFrame).toBe(0);
  });

  it('E6 does NOT have fireProne animation', () => {
    const anim = INFANTRY_ANIMS.E6;
    expect(anim.fireProne).toBeUndefined();
  });

  it('E6 does NOT have idle2 animation (simpler sprite sheet than E1)', () => {
    const anim = INFANTRY_ANIMS.E6;
    expect(anim.idle2).toBeUndefined();
  });
});

// -- AI Scatter on Damage (techno.cpp) ----------------------------------------
// C++ techno.cpp -- AI E6 on GUARD scatters when damaged (same as all infantry)

describe('E6 AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled E6 on GUARD scatters when damaged (IQ >= 2)', () => {
    // Probabilistic -- run multiple times
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const e6 = entityAtCell(UnitType.I_E6, House.USSR, 10, 10);
      e6.mission = Mission.GUARD;
      const ctx = makeCombatCtx([e6]);
      aiScatterOnDamage(ctx, e6);
      if (e6.mission === Mission.MOVE && e6.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('player-controlled E6 does NOT scatter', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    e6.mission = Mission.GUARD;
    const ctx = makeCombatCtx([e6]);
    aiScatterOnDamage(ctx, e6);
    expect(e6.mission).toBe(Mission.GUARD);
    expect(e6.moveTarget).toBeNull();
  });
});

// -- Infantry Animation Basics (infantry.cpp:479) -----------------------------
// C++ infantry.cpp -- E6 uses infantry animation system

describe('E6 infantry animation (infantry.cpp:479)', () => {
  it('E6 isInfantry = true', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    expect(e6.stats.isInfantry).toBe(true);
  });

  it('E6 isAnt = false', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    expect(e6.isAnt).toBe(false);
  });

  it('E6 starts in IDLE animState', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    expect(e6.animState).toBe(AnimState.IDLE);
  });

  it('E6 spriteFrame returns valid frame number in IDLE', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    const frame = e6.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('E6 WALK animation has 6 frames', () => {
    const anim = INFANTRY_ANIMS.E6;
    expect(anim.walk.count).toBe(6);
  });

  it('E6 die1 animation has 8 frames', () => {
    const anim = INFANTRY_ANIMS.E6;
    expect(anim.die1.count).toBe(8);
  });

  it('E6 die2 animation has 8 frames', () => {
    const anim = INFANTRY_ANIMS.E6;
    expect(anim.die2.count).toBe(8);
  });
});

// -- Movement (infantry.cpp) --------------------------------------------------
// C++ infantry.cpp -- E6 moves like all infantry: nimble, moves while rotating

describe('E6 movement -- nimble infantry (infantry.cpp)', () => {
  it('E6 moves while rotating (infantry nimbleness)', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    e6.facing = Dir.N;
    e6.desiredFacing = Dir.N;
    e6.bodyFacing32 = Dir.N * 4;

    const startX = e6.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: e6.pos.y }; // due East

    e6.moveToward(targetPos, e6.stats.speed);

    const distMoved = Math.sqrt((e6.pos.x - startX) ** 2 + (e6.pos.y - e6.pos.y) ** 2);
    expect(e6.pos.x).not.toBe(startX); // position changed
  });

  it('E6 rot=8 means instant facing snap', () => {
    const e6 = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    e6.facing = Dir.N;
    e6.desiredFacing = Dir.S;
    const aligned = e6.tickRotation();
    expect(aligned).toBe(true);
    expect(e6.facing).toBe(Dir.S);
  });
});
