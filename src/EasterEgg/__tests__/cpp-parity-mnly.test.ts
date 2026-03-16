/**
 * C++ Behavioral Parity: MNLY -- Minelayer
 *
 * Tests verify Minelayer behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * MNLY is a support vehicle that lays anti-personnel mines instead of
 * shooting. It has no weapon, no turret, carries 5 mines (maxAmmo=5),
 * heavy armor (100 HP), speed 9, and can crush infantry.
 *
 * C++ references: udata.cpp (unit stats), unit.cpp (minelayer logic),
 * drive.cpp (crusher/rotation), techno.cpp (retaliation/Can_Fire).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, PRODUCTION_ITEMS,
  COUNTRY_BONUSES,
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

// -- 1. Stats Verification (udata.cpp / rules.ini) ---------------------------
// C++ udata.cpp defines MNLY as:
//   HitPoints=100, Armor=heavy, Speed=9, ROT=5, Crusher=true,
//   PrimaryWeapon=none, IsInfantry=false, Owner=allies,soviet, MaxAmmo=5

describe('MNLY stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.MNLY;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'MNLY');

  it('HP is 100 (Strength=100)', () => {
    expect(stats.strength).toBe(100);
  });

  it('armor is heavy', () => {
    expect(stats.armor).toBe('heavy');
  });

  it('speed is 9 (fast for a tracked vehicle)', () => {
    expect(stats.speed).toBe(9);
  });

  it('ROT is 5 (moderate body rotation)', () => {
    expect(stats.rot).toBe(5);
  });

  it('crusher is true (drives over infantry)', () => {
    expect(stats.crusher).toBe(true);
  });

  it('isInfantry is false', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('primaryWeapon is null (lays mines instead of shooting)', () => {
    expect(stats.primaryWeapon).toBeNull();
  });

  it('secondaryWeapon is null', () => {
    expect(stats.secondaryWeapon).toBeNull();
  });

  it('owner is both (available to allies and soviet)', () => {
    expect(stats.owner).toBe('both');
  });

  it('maxAmmo is 5 (carries 5 mines)', () => {
    expect(stats.maxAmmo).toBe(5);
  });

  it('cost is 800 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(800);
  });

  it('Entity constructor initializes HP to strength', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    expect(mnly.hp).toBe(100);
    expect(mnly.maxHp).toBe(100);
  });

  it('Entity constructor initializes ammo from maxAmmo', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    expect(mnly.ammo).toBe(5);
    expect(mnly.maxAmmo).toBe(5);
  });

  it('type is V_MNLY', () => {
    expect(stats.type).toBe(UnitType.V_MNLY);
  });

  it('name is Minelayer', () => {
    expect(stats.name).toBe('Minelayer');
  });

  it('image asset is mnly', () => {
    expect(stats.image).toBe('mnly');
  });
});

// -- 2. No Weapon (udata.cpp -- primaryWeapon=none) ---------------------------
// C++ udata.cpp: MNLY has no weapon entry. It lays mines instead of shooting.
// This means weapon is null on the Entity, making it unable to attack or retaliate.

describe('MNLY no weapon system (udata.cpp)', () => {
  it('Entity.weapon is null (no primary weapon)', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    expect(mnly.weapon).toBeNull();
  });

  it('Entity.weapon2 is null (no secondary weapon)', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    expect(mnly.weapon2).toBeNull();
  });

  it('inRange always returns false (no weapon to check range with)', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    expect(mnly.inRange(target)).toBe(false);
  });

  it('inRange returns false even for adjacent targets', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 10, 10); // same cell
    expect(mnly.inRange(target)).toBe(false);
  });
});

// -- 3. Ammo System (unit.cpp -- maxAmmo=5, mine placement) -------------------
// C++ unit.cpp: MNLY carries 5 mines (maxAmmo=5). Each mine placement
// decrements ammo by 1. When ammo reaches 0, no more mines can be placed.

describe('MNLY ammo system (unit.cpp)', () => {
  it('starts with 5 ammo (maxAmmo=5)', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    expect(mnly.ammo).toBe(5);
  });

  it('ammo can be decremented to track mine placement', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.ammo--;
    expect(mnly.ammo).toBe(4);
  });

  it('ammo reaches 0 after 5 decrements', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    for (let i = 0; i < 5; i++) {
      mnly.ammo--;
    }
    expect(mnly.ammo).toBe(0);
  });

  it('maxAmmo stays at 5 regardless of current ammo', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.ammo = 0;
    expect(mnly.maxAmmo).toBe(5);
  });

  it('mineCount starts at 0', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    expect(mnly.mineCount).toBe(0);
  });
});

// -- 4. No Turret (udata.cpp -- hasTurret=false) ------------------------------
// C++ udata.cpp: MNLY has no turret. Like ARTY and APC, it must rotate its
// entire body to face targets/movement direction.

describe('MNLY no turret (udata.cpp)', () => {
  it('hasTurret is false for MNLY', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    expect(mnly.hasTurret).toBe(false);
  });

  it('facing starts at N (Dir.N = 0)', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    expect(mnly.facing).toBe(Dir.N);
  });
});

// -- 5. Cannot Retaliate (techno.cpp -- no weapon means no retaliation) -------
// C++ techno.cpp: triggerRetaliation checks Can_Fire which requires a weapon.
// MNLY has no weapon, so it never retaliates when attacked.

describe('MNLY cannot retaliate (techno.cpp)', () => {
  it('MNLY does not retaliate when hit by enemy (no weapon)', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    mnly.mission = Mission.GUARD;
    mnly.target = null;

    const ctx = makeCombatCtx([mnly, attacker]);
    triggerRetaliation(ctx, mnly, attacker);

    // MNLY has no weapon, should not get a target or switch to ATTACK
    expect(mnly.target).toBeNull();
    expect(mnly.mission).toBe(Mission.GUARD);
  });

  it('MNLY on MOVE mission does not retaliate', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    mnly.mission = Mission.MOVE;
    mnly.target = null;

    const ctx = makeCombatCtx([mnly, attacker]);
    triggerRetaliation(ctx, mnly, attacker);

    expect(mnly.target).toBeNull();
    expect(mnly.mission).toBe(Mission.MOVE);
  });

  it('contrast: armed vehicle (2TNK) DOES retaliate', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    tank.mission = Mission.GUARD;
    tank.target = null;

    const ctx = makeCombatCtx([tank, attacker]);
    triggerRetaliation(ctx, tank, attacker);

    expect(tank.target).toBe(attacker);
    expect(tank.mission).toBe(Mission.ATTACK);
  });
});

// -- 6. Crusher -- crushes infantry (drive.cpp:Ok_To_Move) --------------------
// C++ drive.cpp: crusher vehicles kill crushable infantry when entering
// their cell. MNLY has crusher=true and heavy armor.

describe('MNLY crusher (drive.cpp:Ok_To_Move)', () => {
  it('MNLY crushes enemy infantry on same cell', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    const ctx = makeCombatCtx([e1, mnly]);
    checkVehicleCrush(ctx, mnly);
    expect(e1.alive).toBe(false);
  });

  it('MNLY does NOT crush allied infantry', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    const ctx = makeCombatCtx([e1, mnly]);
    checkVehicleCrush(ctx, mnly);
    expect(e1.alive).toBe(true);
    expect(e1.hp).toBe(e1.maxHp);
  });

  it('MNLY does NOT crush cross-allied infantry (Greece allied with Spain)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const mnly = entityAtCell(UnitType.V_MNLY, House.Greece, 10, 10);
    const ctx = makeCombatCtx([e1, mnly]);
    checkVehicleCrush(ctx, mnly);
    expect(e1.alive).toBe(true);
  });

  it('MNLY stats confirm crusher flag is true', () => {
    expect(UNIT_STATS.MNLY.crusher).toBe(true);
  });
});

// -- 7. Damage and Survivability (combat.cpp -- heavy armor) ------------------
// C++ combat.cpp: MNLY has 100 HP with heavy armor. Heavy armor reduces
// incoming damage from most warheads significantly.

describe('MNLY damage and survivability (combat.cpp)', () => {
  it('takeDamage kills MNLY with 100+ damage', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    const killed = mnly.takeDamage(100);
    expect(killed).toBe(true);
    expect(mnly.alive).toBe(false);
    expect(mnly.hp).toBe(0);
  });

  it('takeDamage does not kill MNLY with 99 damage', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    const killed = mnly.takeDamage(99);
    expect(killed).toBe(false);
    expect(mnly.alive).toBe(true);
    expect(mnly.hp).toBe(1);
  });

  it('heavy armor resists SA warhead (SA vs heavy = 0.25)', () => {
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('heavy')];
    expect(mult).toBe(0.25);
  });

  it('heavy armor resists HE warhead (HE vs heavy = 0.25)', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('heavy')];
    expect(mult).toBe(0.25);
  });

  it('AP warhead is most effective vs heavy armor (AP vs heavy = 1.0)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('heavy')];
    expect(mult).toBe(1.0);
  });

  it('infantry rifles deal minimal effective damage: 15 * 0.25 = 3.75 -> 4', () => {
    const rifDamage = WEAPON_STATS.M1Carbine.damage;
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('heavy')];
    const effective = Math.round(rifDamage * mult);
    expect(effective).toBe(4);
    // Would take 25 rifle hits to kill MNLY (100 / 4 = 25)
    expect(Math.ceil(100 / effective)).toBe(25);
  });
});

// -- 8. Stop-Rotate-Move (drive.cpp -- vehicle movement) ----------------------
// C++ drive.cpp: Vehicles stop, rotate to face destination, THEN move.
// MNLY is a vehicle (not infantry) so it follows stop-rotate-move behavior.

describe('MNLY stop-rotate-move (drive.cpp)', () => {
  it('MNLY facing N, target E: does NOT move until rotation completes', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.facing = Dir.N;
    mnly.desiredFacing = Dir.N;
    mnly.bodyFacing32 = Dir.N * 4;

    const startX = mnly.pos.x;
    const startY = mnly.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY }; // due East

    // One moveToward tick -- vehicle should stop to rotate first
    const arrived = mnly.moveToward(targetPos, mnly.stats.speed);

    expect(arrived).toBe(false);
    // Vehicle should NOT have moved (still rotating)
    expect(mnly.pos.x).toBe(startX);
    expect(mnly.pos.y).toBe(startY);
  });

  it('MNLY moves once facing is aligned', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.facing = Dir.E;
    mnly.bodyFacing32 = Dir.E * 4;
    mnly.desiredFacing = Dir.E;

    const startX = mnly.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: mnly.pos.y };

    mnly.rotTickedThisFrame = false;
    mnly.moveToward(targetPos, mnly.stats.speed);

    // Should have moved east
    expect(mnly.pos.x).toBeGreaterThan(startX);
  });

  it('ROT=5 rotation: does NOT snap facing instantly (requires ROT >= 8)', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.desiredFacing = Dir.S; // 180 degrees opposite from N
    mnly.rotTickedThisFrame = false;
    const aligned = mnly.tickRotation();
    // ROT=5 is too slow to snap in one tick
    expect(aligned).toBe(false);
    expect(mnly.facing).not.toBe(Dir.S);
  });

  it('takes multiple ticks to rotate 180 degrees (N to S) with ROT=5', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.desiredFacing = Dir.S;
    let ticks = 0;
    while (mnly.facing !== Dir.S && ticks < 100) {
      mnly.rotTickedThisFrame = false;
      mnly.tickRotation();
      ticks++;
    }
    // Should take more than 1 tick but finish within reasonable time
    expect(ticks).toBeGreaterThan(1);
    expect(ticks).toBeLessThan(50);
    expect(mnly.facing).toBe(Dir.S);
  });

  it('contrast: infantry (E1) moves while rotating (nimble)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.facing = Dir.N;
    e1.desiredFacing = Dir.N;
    e1.bodyFacing32 = Dir.N * 4;

    const startX = e1.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: e1.pos.y };
    e1.moveToward(targetPos, e1.stats.speed);

    // Infantry should move even while rotating
    const distMoved = Math.sqrt((e1.pos.x - startX) ** 2 + (e1.pos.y - startX) ** 2);
    expect(e1.pos.x).toBeGreaterThan(startX);
  });
});

// -- 9. AI Scatter on Damage (techno.cpp) -------------------------------------
// C++ techno.cpp: AI-controlled units on GUARD scatter when damaged.

describe('MNLY AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled MNLY on GUARD scatters when damaged (IQ >= 2)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const mnly = entityAtCell(UnitType.V_MNLY, House.USSR, 10, 10);
      mnly.mission = Mission.GUARD;
      const ctx = makeCombatCtx([mnly]);
      aiScatterOnDamage(ctx, mnly);
      if (mnly.mission === Mission.MOVE && mnly.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('player-controlled MNLY does NOT scatter', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.mission = Mission.GUARD;
    const ctx = makeCombatCtx([mnly]);
    aiScatterOnDamage(ctx, mnly);

    expect(mnly.mission).toBe(Mission.GUARD);
    expect(mnly.moveTarget).toBeNull();
  });

  it('AI MNLY on MOVE mission does NOT scatter', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.USSR, 10, 10);
    mnly.mission = Mission.MOVE;
    const ctx = makeCombatCtx([mnly]);
    aiScatterOnDamage(ctx, mnly);

    expect(mnly.mission).toBe(Mission.MOVE);
  });
});

// -- 10. Vehicle Animation (unit.cpp -- vehicle SHP layout) -------------------
// C++ unit.cpp: Vehicles use 32-frame body rotation via BodyShape lookup.
// MNLY uses the vehicle sprite system, not infantry animations.

describe('MNLY vehicle animation (unit.cpp)', () => {
  it('isInfantry is false', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    expect(mnly.stats.isInfantry).toBe(false);
  });

  it('isAnt is false', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    expect(mnly.isAnt).toBe(false);
  });

  it('spriteFrame returns valid vehicle frame number', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    const frame = mnly.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('starts in IDLE animState', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    expect(mnly.alive).toBe(true);
    expect(mnly.animState).toBe(AnimState.IDLE);
  });

  it('bodyFacing32 initializes to facing * 4', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    expect(mnly.bodyFacing32).toBe(Dir.N * 4);
  });
});

// -- 11. Production Identity (rules.ini) --------------------------------------
// C++ rules.ini: MNLY is built at WEAP (War Factory), requires FIX (Service Depot),
// available to both factions, techLevel 3.

describe('MNLY production identity (rules.ini)', () => {
  it('production item exists', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'MNLY');
    expect(item).toBeDefined();
  });

  it('cost is 800 credits', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'MNLY')!;
    expect(item.cost).toBe(800);
  });

  it('buildTime is 120', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'MNLY')!;
    expect(item.buildTime).toBe(120);
  });

  it('prerequisite is WEAP (War Factory)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'MNLY')!;
    expect(item.prerequisite).toBe('WEAP');
  });

  it('techPrereq is FIX (Service Depot)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'MNLY')!;
    expect(item.techPrereq).toBe('FIX');
  });

  it('faction is both (allies and soviet)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'MNLY')!;
    expect(item.faction).toBe('both');
  });

  it('techLevel is 3 (early game unit)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'MNLY')!;
    expect(item.techLevel).toBe(3);
  });
});

// -- 12. Comparison with Similar Units ----------------------------------------
// MNLY vs V2RL: both use ammo system but serve very different roles.
// MNLY: 100 HP, heavy armor, no weapon, 5 ammo (mines), speed 9
// V2RL: 150 HP, light armor, SCUD weapon, 1 ammo (rocket), speed 7

describe('MNLY vs V2RL -- ammo-based vehicle comparison', () => {
  it('MNLY has more ammo than V2RL (5 vs 1)', () => {
    expect(UNIT_STATS.MNLY.maxAmmo).toBe(5);
    expect(UNIT_STATS.V2RL.maxAmmo).toBe(1);
  });

  it('V2RL has more HP than MNLY (150 vs 100)', () => {
    expect(UNIT_STATS.V2RL.strength).toBe(150);
    expect(UNIT_STATS.MNLY.strength).toBe(100);
  });

  it('MNLY has heavy armor; V2RL has light armor', () => {
    expect(UNIT_STATS.MNLY.armor).toBe('heavy');
    expect(UNIT_STATS.V2RL.armor).toBe('light');
  });

  it('MNLY is faster than V2RL (speed 9 vs 7)', () => {
    expect(UNIT_STATS.MNLY.speed).toBe(9);
    expect(UNIT_STATS.V2RL.speed).toBe(7);
  });

  it('MNLY has no weapon; V2RL has SCUD', () => {
    expect(UNIT_STATS.MNLY.primaryWeapon).toBeNull();
    expect(UNIT_STATS.V2RL.primaryWeapon).toBe('SCUD');
  });

  it('both are crushers', () => {
    expect(UNIT_STATS.MNLY.crusher).toBe(true);
    expect(UNIT_STATS.V2RL.crusher).toBe(true);
  });

  it('MNLY costs more than V2RL (800 vs 700)', () => {
    const mnlyProd = PRODUCTION_ITEMS.find(p => p.type === 'MNLY')!;
    const v2rlProd = PRODUCTION_ITEMS.find(p => p.type === 'V2RL')!;
    expect(mnlyProd.cost).toBe(800);
    expect(v2rlProd.cost).toBe(700);
  });
});

// -- 13. Death Behavior (unit.cpp) --------------------------------------------
// C++ unit.cpp: When a vehicle dies, its mission transitions to DIE,
// animState goes to DIE, and passengers (if any) are killed.

describe('MNLY death behavior (unit.cpp)', () => {
  it('death sets mission to DIE and animState to DIE', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.takeDamage(200);
    expect(mnly.alive).toBe(false);
    expect(mnly.mission).toBe(Mission.DIE);
    expect(mnly.animState).toBe(AnimState.DIE);
  });

  it('death sets hp to 0', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.takeDamage(200);
    expect(mnly.hp).toBe(0);
  });

  it('overkill damage: 300 damage on 100 HP still results in hp=0', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.takeDamage(300);
    expect(mnly.hp).toBe(0);
    expect(mnly.alive).toBe(false);
  });

  it('dead MNLY does not take further damage', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.takeDamage(100); // kill it
    expect(mnly.alive).toBe(false);
    const result = mnly.takeDamage(50); // try to damage again
    expect(result).toBe(false); // should return false (already dead)
    expect(mnly.hp).toBe(0);
  });
});
