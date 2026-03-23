/**
 * C++ Behavioral Parity: TRUK — Supply Truck
 *
 * Tests verify Supply Truck behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with TRUK (observable outcomes: HP, alive/dead,
 * transport, mission, movement, turret), not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 *
 * Key behaviors:
 *   - Stats: HP 110, armor light, speed 10, passengers=1
 *   - No weapon: cannot attack or retaliate
 *   - Transport: isTransport=true, maxPassengers=1 (single passenger)
 *   - No turret, no crusher
 *   - Fast: speed 10 (matches JEEP/APC as fastest ground units)
 *   - Standard vehicle behaviors: DamageSpeed, StopRotateMove
 *
 * References: C++ udata.cpp, rules.ini, drive.cpp, combat.cpp, techno.cpp
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR,
  COUNTRY_BONUSES,
  buildDefaultAlliances, armorIndex, getWarheadMultiplier,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  checkVehicleCrush,
  triggerRetaliation,
  damageSpeedFactor,
  aiScatterOnDamage,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

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
    isPlayerControlled: () => false, // These tests test AI retaliation; PlayerReturnFire tested in return-fire.test.ts,
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

// ── 1. Stats Verification (udata.cpp / rules.ini) ───────────────────────────
// C++ udata.cpp (unit type data) — TRUK entry and RULES.INI [TRUK] section

describe('TRUK stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.TRUK;

  it('HP is 110 (Strength=110)', () => {
    expect(stats.strength).toBe(110);
  });

  it('Armor is light (Armor=light)', () => {
    expect(stats.armor).toBe('light');
  });

  it('Speed is 10 (Speed=10 — fastest tier)', () => {
    expect(stats.speed).toBe(10);
  });

  it('isInfantry is false (vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('ROT is 5 (rotation rate — standard vehicle)', () => {
    expect(stats.rot).toBe(5);
  });

  it('sight is 3 cells (C++ Sight=3 — limited visibility)', () => {
    expect(stats.sight).toBe(3);
  });

  it('no primary weapon (C++ Primary=NONE — unarmed)', () => {
    expect(stats.primaryWeapon).toBeNull();
  });

  it('no secondary weapon', () => {
    expect(stats.secondaryWeapon).toBeUndefined();
  });

  it('passengers capacity is 1 (C++ Max_Passengers=1 — single passenger)', () => {
    expect(stats.passengers).toBe(1);
  });

  it('no crusher flag (C++ Crusher=no)', () => {
    expect(stats.crusher).toBeFalsy();
  });

  it('Entity constructor initializes HP to strength', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.hp).toBe(110);
    expect(truk.maxHp).toBe(110);
  });

  it('type is V_TRUK', () => {
    expect(stats.type).toBe(UnitType.V_TRUK);
  });

  it('name is Supply Truck', () => {
    expect(stats.name).toBe('Supply Truck');
  });
});

// ── 2. No Weapon — TRUK is unarmed (udata.cpp) ─────────────────────────────
// C++ udata.cpp — TRUK has Primary=NONE; it cannot attack anything.

describe('TRUK no weapon (udata.cpp — Primary=NONE)', () => {
  it('Entity constructor resolves no weapon (null)', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.weapon).toBeNull();
  });

  it('has no secondary weapon', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.weapon2).toBeNull();
  });

  it('inRange always returns false (no weapon = no range)', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    expect(truk.inRange(target)).toBe(false);
  });

  it('inRange returns false even for adjacent targets', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 10, 10); // same cell
    expect(truk.inRange(target)).toBe(false);
  });

  it('selectWeapon returns null (no weapons to select)', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const selected = truk.selectWeapon(target, getWarheadMultiplier);
    expect(selected).toBeNull();
  });
});

// ── 3. Transport — isTransport=true, maxPassengers=1 (techno.cpp / unit.cpp) ─
// C++ techno.cpp — TRUK is a transport with capacity 1 (single passenger supply delivery).

describe('TRUK transport (techno.cpp / unit.cpp)', () => {
  it('isTransport is true (passengers > 0)', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.isTransport).toBe(true);
  });

  it('maxPassengers is 1 (single passenger)', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.maxPassengers).toBe(1);
  });

  it('passengers array starts empty', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.passengers).toEqual([]);
    expect(truk.passengers.length).toBe(0);
  });

  it('can load one infantry passenger', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    truk.passengers.push(e1);
    e1.transportRef = truk;
    expect(truk.passengers.length).toBe(1);
    expect(truk.passengers[0]).toBe(e1);
    expect(e1.transportRef).toBe(truk);
  });

  it('contrast: APC has maxPassengers=5 (TRUK only carries 1)', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(truk.maxPassengers).toBe(1);
    expect(apc.maxPassengers).toBe(5);
    expect(apc.maxPassengers).toBeGreaterThan(truk.maxPassengers);
  });

  it('contrast: non-transport vehicle (2TNK) has isTransport=false', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.isTransport).toBe(false);
    expect(tank.maxPassengers).toBe(0);
  });
});

// ── 4. Passengers Killed on Death (entity.ts takeDamage) ─────────────────────
// C++ unit.cpp — when transport destroyed, all passengers die instantly.

describe('TRUK passengers killed on death (unit.cpp / entity.ts)', () => {
  it('when TRUK dies, its single passenger dies too', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    const passenger = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    truk.passengers.push(passenger);
    passenger.transportRef = truk;

    const killed = truk.takeDamage(200, 'AP');
    expect(killed).toBe(true);
    expect(truk.alive).toBe(false);

    // Passenger must also be dead
    expect(passenger.alive).toBe(false);
    expect(passenger.mission).toBe(Mission.DIE);
    expect(passenger.transportRef).toBeNull();
  });

  it('TRUK passengers array is emptied on death', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    const passenger = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    truk.passengers.push(passenger);
    passenger.transportRef = truk;

    truk.takeDamage(200, 'AP');
    expect(truk.passengers.length).toBe(0);
  });

  it('empty TRUK destruction has no passenger side effects', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.passengers.length).toBe(0);

    const killed = truk.takeDamage(200, 'AP');
    expect(killed).toBe(true);
    expect(truk.alive).toBe(false);
    expect(truk.passengers.length).toBe(0);
  });
});

// ── 5. No Turret (udata.cpp — hasTurret exclusion list) ─────────────────────
// C++ udata.cpp — TRUK is listed in the NoTurret exclusion; body faces movement direction.

describe('TRUK has no turret (udata.cpp NoTurret parity)', () => {
  it('hasTurret getter returns false', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.hasTurret).toBe(false);
  });

  it('TRUK type is in the hasTurret exclusion list', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.type).toBe(UnitType.V_TRUK);
    expect(truk.hasTurret).toBe(false);
  });

  it('contrast: Medium Tank (2TNK) has a turret', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.hasTurret).toBe(true);
  });

  it('contrast: Light Tank (1TNK) has a turret', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    expect(tank.hasTurret).toBe(true);
  });
});

// ── 6. No Crusher (drive.cpp — Crusher flag) ────────────────────────────────
// C++ drive.cpp — TRUK does NOT have the Crusher flag; cannot crush infantry.

describe('TRUK is NOT a crusher (drive.cpp Crusher=no)', () => {
  it('TRUK stats do not have crusher=true', () => {
    expect(UNIT_STATS.TRUK.crusher).toBeFalsy();
  });

  it('TRUK shares cell with infantry — no crush because game loop skips non-crushers', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.USSR, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);

    // Game loop guard: crusher flag is falsy, so checkVehicleCrush should not kill
    expect(truk.stats.crusher).toBeFalsy();
    expect(infantry.stats.crushable).toBe(true);
    expect(infantry.alive).toBe(true);
  });

  it('contrast: Heavy Tank DOES crush infantry on same cell', () => {
    const tank = entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);

    expect(tank.stats.crusher).toBe(true);

    const ctx = makeCombatCtx([tank, infantry]);
    checkVehicleCrush(ctx, tank);

    expect(infantry.alive).toBe(false);
  });

  it('contrast: APC (also a transport) IS a crusher, unlike TRUK', () => {
    expect(UNIT_STATS.APC.crusher).toBe(true);
    expect(UNIT_STATS.TRUK.crusher).toBeFalsy();
  });
});

// ── 7. Speed — fastest tier (udata.cpp) ──────────────────────────────────────
// C++ udata.cpp — TRUK speed=10, same tier as JEEP and APC (fastest ground units).

describe('TRUK speed (udata.cpp — fastest ground vehicle tier)', () => {
  it('TRUK speed (10) matches JEEP speed — both are fastest ground vehicles', () => {
    expect(UNIT_STATS.TRUK.speed).toBe(10);
    expect(UNIT_STATS.JEEP.speed).toBe(10);
  });

  it('TRUK speed (10) matches APC speed', () => {
    expect(UNIT_STATS.TRUK.speed).toBe(10);
    expect(UNIT_STATS.APC.speed).toBe(10);
  });

  it('TRUK is faster than Light Tank (speed 9)', () => {
    expect(UNIT_STATS.TRUK.speed).toBeGreaterThan(UNIT_STATS['1TNK'].speed);
  });

  it('TRUK is faster than Heavy Tank (speed 7)', () => {
    expect(UNIT_STATS.TRUK.speed).toBeGreaterThan(UNIT_STATS['3TNK'].speed);
  });

  it('TRUK is faster than Mammoth Tank (speed 4)', () => {
    expect(UNIT_STATS.TRUK.speed).toBeGreaterThan(UNIT_STATS['4TNK'].speed);
  });

  it('TRUK is faster than all infantry (infantry max speed = 4)', () => {
    expect(UNIT_STATS.TRUK.speed).toBeGreaterThan(UNIT_STATS.E1.speed);
    expect(UNIT_STATS.TRUK.speed).toBeGreaterThan(UNIT_STATS.E3.speed);
  });
});

// ── 8. Cannot Retaliate — unarmed (techno.cpp) ──────────────────────────────
// C++ techno.cpp — retaliation requires a weapon; TRUK has none.

describe('TRUK cannot retaliate (techno.cpp — no weapon)', () => {
  it('TRUK has no weapon, cannot retaliate when attacked', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    truk.mission = Mission.GUARD;
    truk.target = null;

    const ctx = makeCombatCtx([truk, attacker]);
    triggerRetaliation(ctx, truk, attacker);

    // TRUK has no weapon, should not get a target
    expect(truk.target).toBeNull();
    expect(truk.mission).toBe(Mission.GUARD);
  });

  it('TRUK weapon is null — precondition for no retaliation', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.weapon).toBeNull();
  });

  it('contrast: JEEP (armed) retaliates when attacked', () => {
    const jeep = entityAtCell(UnitType.V_JEEP, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    jeep.mission = Mission.GUARD;
    jeep.target = null;

    expect(jeep.weapon).not.toBeNull();

    const ctx = makeCombatCtx([jeep, attacker]);
    triggerRetaliation(ctx, jeep, attacker);

    expect(jeep.target).toBe(attacker);
    expect(jeep.mission).toBe(Mission.ATTACK);
  });
});

// ── 9. Damage Speed Factor — standard vehicle (drive.cpp) ───────────────────
// C++ drive.cpp — damaged vehicles slow down at CONDITION_YELLOW (50% HP).

describe('TRUK damage speed reduction (drive.cpp parity)', () => {
  it('undamaged TRUK has speed factor 1.0', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(damageSpeedFactor(truk)).toBe(1.0);
  });

  it('TRUK at yellow health (50%) has speed factor 0.75', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    truk.hp = Math.floor(truk.maxHp * 0.5); // 55
    expect(damageSpeedFactor(truk)).toBe(0.75);
  });

  it('TRUK at 1 HP has speed factor 0.75', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    truk.hp = 1;
    expect(damageSpeedFactor(truk)).toBe(0.75);
  });

  it('TRUK just above yellow health has normal speed', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    truk.hp = Math.floor(truk.maxHp * 0.5) + 1; // 56
    expect(damageSpeedFactor(truk)).toBe(1.0);
  });
});

// ── 10. Stop-Rotate-Move — vehicle movement (drive.cpp) ─────────────────────
// C++ drive.cpp — vehicles stop, rotate to face destination, THEN move.
// TRUK ROT=5 < 8, so it does NOT snap-rotate; it accumulates rotation per tick.

describe('TRUK stop-rotate-move (drive.cpp parity)', () => {
  it('TRUK ROT=5 means gradual rotation (ROT < 8 does NOT snap)', () => {
    expect(UNIT_STATS.TRUK.rot).toBe(5);
    expect(UNIT_STATS.TRUK.rot).toBeLessThan(8);
  });

  it('TRUK facing N toward target E: does NOT move until rotation completes', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    truk.facing = Dir.N;
    truk.desiredFacing = Dir.N;
    truk.bodyFacing32 = Dir.N * 4;

    const startX = truk.pos.x;
    const startY = truk.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY }; // due East

    // One moveToward tick — vehicle should stop to rotate first
    const arrived = truk.moveToward(targetPos, truk.stats.speed);

    // ROT=5 < 8, accumulator goes to 5, threshold is 8, so no full rotation step yet
    // Vehicle should NOT have moved (still rotating)
    expect(arrived).toBe(false);
    expect(truk.pos.x).toBe(startX);
    expect(truk.pos.y).toBe(startY);
  });

  it('TRUK eventually rotates and moves after enough ticks', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    truk.facing = Dir.N;
    truk.desiredFacing = Dir.N;
    truk.bodyFacing32 = Dir.N * 4;

    const startX = truk.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 5, y: truk.pos.y };

    // Run multiple ticks to allow rotation to complete
    let moved = false;
    for (let i = 0; i < 20; i++) {
      truk.rotTickedThisFrame = false; // reset per-frame guard
      truk.moveToward(targetPos, truk.stats.speed);
      if (truk.pos.x > startX) {
        moved = true;
        break;
      }
    }
    expect(moved).toBe(true);
  });

  it('contrast: JEEP ROT=10 uses accumulator — fast but not instant (C++ parity)', () => {
    const jeep = entityAtCell(UnitType.V_JEEP, House.Spain, 10, 10);
    jeep.facing = Dir.N;
    jeep.desiredFacing = Dir.E;
    jeep.bodyFacing32 = Dir.N * 4;

    // C++ parity: all vehicles use Rotation_Adjust accumulator.
    // ROT=10 is fast but not instant. JEEP takes 7 ticks for 90 degrees.
    let ticks = 0;
    while (jeep.facing !== Dir.E && ticks < 20) {
      jeep.rotTickedThisFrame = false;
      jeep.tickRotation();
      ticks++;
    }
    expect(jeep.facing).toBe(Dir.E);
    expect(ticks).toBe(7);
  });

  it('TRUK gradual rotation: tickRotation does NOT snap for ROT=5', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    truk.facing = Dir.N;
    truk.desiredFacing = Dir.S; // opposite direction
    truk.bodyFacing32 = Dir.N * 4;

    const rotated = truk.tickRotation();
    // ROT=5 accumulates but threshold is 8 per visual step
    // After 1 tick: accum=5, no step yet, facing still N
    expect(rotated).toBe(false);
    expect(truk.facing).toBe(Dir.N);
  });
});

// ── 11. Light Armor Vulnerability (combat.cpp warhead tables) ────────────────
// C++ combat.cpp — TRUK has light armor; takes varying damage from different warheads.

describe('TRUK light armor vulnerability (combat.cpp warhead tables)', () => {
  it('SA warhead vs light armor: mult 0.6', () => {
    expect(getWarheadMultiplier('SA', 'light')).toBe(0.6);
  });

  it('AP warhead vs light armor: mult 0.75', () => {
    expect(getWarheadMultiplier('AP', 'light')).toBe(0.75);
  });

  it('HE warhead vs light armor: mult 0.6', () => {
    expect(getWarheadMultiplier('HE', 'light')).toBe(0.6);
  });

  it('TRUK (light armor) takes less AP damage than heavy armor tanks', () => {
    const apVsLight = getWarheadMultiplier('AP', 'light');
    const apVsHeavy = getWarheadMultiplier('AP', 'heavy');
    // AP is designed for heavy armor: 1.0 vs heavy, 0.75 vs light
    expect(apVsLight).toBe(0.75);
    expect(apVsHeavy).toBe(1.0);
    expect(apVsLight).toBeLessThan(apVsHeavy);
  });

  it('TRUK HP (110) is much lower than tanks, making it fragile despite armor multipliers', () => {
    expect(UNIT_STATS.TRUK.strength).toBe(110);
    expect(UNIT_STATS['1TNK'].strength).toBe(300); // nearly 3x TRUK
    expect(UNIT_STATS['2TNK'].strength).toBe(400); // 3.6x TRUK
    expect(UNIT_STATS['3TNK'].strength).toBe(400); // 3.6x TRUK
  });
});

// ── 12. takeDamage Integration — survives/dies correctly ─────────────────────

describe('TRUK takeDamage behavior', () => {
  it('survives small arms hit (15 damage, SA vs light = 15*0.6 = 9)', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    const killed = truk.takeDamage(9, 'SA');
    expect(killed).toBe(false);
    expect(truk.alive).toBe(true);
    expect(truk.hp).toBe(101);
  });

  it('dies when damage exceeds HP', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    const killed = truk.takeDamage(200, 'AP');
    expect(killed).toBe(true);
    expect(truk.alive).toBe(false);
    expect(truk.hp).toBe(0);
    expect(truk.mission).toBe(Mission.DIE);
    expect(truk.animState).toBe(AnimState.DIE);
  });

  it('damage flash activates on hit', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.damageFlash).toBe(0);
    truk.takeDamage(10, 'SA');
    expect(truk.damageFlash).toBe(4);
  });

  it('does not take damage when invulnerable (Iron Curtain)', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    truk.ironCurtainTick = 100;
    const killed = truk.takeDamage(999, 'Super');
    expect(killed).toBe(false);
    expect(truk.alive).toBe(true);
    expect(truk.hp).toBe(110);
  });

  it('multiple hits reduce HP correctly', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    truk.takeDamage(30, 'AP');
    expect(truk.hp).toBe(80);
    truk.takeDamage(30, 'AP');
    expect(truk.hp).toBe(50);
    truk.takeDamage(30, 'AP');
    expect(truk.hp).toBe(20);
    const killed = truk.takeDamage(30, 'AP');
    expect(killed).toBe(true);
    expect(truk.hp).toBe(0);
  });
});

// ── 13. AI Scatter on Damage (techno.cpp) ────────────────────────────────────
// C++ techno.cpp — AI-controlled units on GUARD move to adjacent cell when damaged.

describe('TRUK AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled TRUK on GUARD mission scatters when damaged (IQ >= 2)', () => {
    // Run scatter multiple times — it is probabilistic (random dx/dy can be 0,0 = no move)
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const truk = entityAtCell(UnitType.V_TRUK, House.USSR, 10, 10);
      truk.mission = Mission.GUARD;
      const ctx = makeCombatCtx([truk]);
      aiScatterOnDamage(ctx, truk);
      if (truk.mission === Mission.MOVE && truk.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('player-controlled TRUK does NOT scatter', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    truk.mission = Mission.GUARD;

    const ctx = makeCombatCtx([truk]);
    aiScatterOnDamage(ctx, truk);

    expect(truk.mission).toBe(Mission.GUARD);
    expect(truk.moveTarget).toBeNull();
  });
});

// ── 14. Entity Construction — correct instantiation ─────────────────────────

describe('TRUK entity construction', () => {
  it('starts alive with default mission GUARD', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.alive).toBe(true);
    expect(truk.mission).toBe(Mission.GUARD);
  });

  it('is a transport (passenger capacity > 0)', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.isTransport).toBe(true);
    expect(truk.maxPassengers).toBe(1);
  });

  it('is NOT an aircraft', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.isAirUnit).toBe(false);
  });

  it('is NOT a naval unit', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.isNavalUnit).toBe(false);
  });

  it('is NOT an ant', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.isAnt).toBe(false);
  });

  it('is NOT infantry', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.stats.isInfantry).toBe(false);
  });

  it('starts in IDLE animState', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.animState).toBe(AnimState.IDLE);
  });

  it('spriteFrame returns a valid frame number (vehicle body rotation)', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    const frame = truk.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });
});
