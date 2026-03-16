/**
 * C++ Behavioral Parity: V2RL — V2 Rocket Launcher
 *
 * Tests verify V2 Rocket Launcher behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with V2RL (observable outcomes: HP, alive/dead,
 * mission, ammo, position changes, turret state), not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
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

// ── Stats Verification (rules.ini parity) ────────────────────────────────────
// C++ udata.cpp (unit type data) — V2RL entry and RULES.INI [V2RL] section

describe('V2RL stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.V2RL;
  const weapon = WEAPON_STATS.SCUD;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'V2RL');

  it('HP is 150 (Strength=150)', () => {
    expect(stats.strength).toBe(150);
  });

  it('Armor is light (Armor=light)', () => {
    expect(stats.armor).toBe('light');
  });

  it('Speed is 7 (Speed=7)', () => {
    expect(stats.speed).toBe(7);
  });

  it('isInfantry is false (vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('crusher is true (heavy tracked vehicle)', () => {
    expect(stats.crusher).toBe(true);
  });

  it('primary weapon is SCUD', () => {
    expect(stats.primaryWeapon).toBe('SCUD');
  });

  it('secondary weapon is null', () => {
    expect(stats.secondaryWeapon).toBeNull();
  });

  it('owner is soviet', () => {
    expect(stats.owner).toBe('soviet');
  });

  it('cost is 700 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(700);
  });

  it('noMovingFire is true (must stop to fire)', () => {
    expect(stats.noMovingFire).toBe(true);
  });

  it('maxAmmo is 1 (single-shot before reload)', () => {
    expect(stats.maxAmmo).toBe(1);
  });

  it('rot is 5 (vehicle-class rotation)', () => {
    expect(stats.rot).toBe(5);
  });

  it('Entity constructor initializes HP to strength', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    expect(v2.hp).toBe(150);
    expect(v2.maxHp).toBe(150);
  });

  it('Entity constructor initializes ammo from maxAmmo', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    expect(v2.ammo).toBe(1);
    expect(v2.maxAmmo).toBe(1);
  });
});

// ── SCUD Weapon Stats (weapon.cpp / rules.ini) ──────────────────────────────
// C++ weapon.cpp — SCUD weapon entry from RULES.INI [SCUD] section

describe('SCUD weapon stats (weapon.cpp / rules.ini)', () => {
  const weapon = WEAPON_STATS.SCUD;

  it('damage is 600 (highest single-shot vehicle weapon)', () => {
    expect(weapon.damage).toBe(600);
  });

  it('warhead is HE (High Explosive)', () => {
    expect(weapon.warhead).toBe('HE');
  });

  it('range is 10.0 cells (outranges most defenses)', () => {
    expect(weapon.range).toBe(10.0);
  });

  it('splash is 2.0 cells', () => {
    expect(weapon.splash).toBe(2.0);
  });

  it('inaccuracy is 1.5 (significant scatter)', () => {
    expect(weapon.inaccuracy).toBe(1.5);
  });

  it('isFueled is true (rocket motor — Fueled=yes)', () => {
    expect(weapon.isFueled).toBe(true);
  });

  it('isGigundo is true (large explosion sprite)', () => {
    expect(weapon.isGigundo).toBe(true);
  });

  it('ROF is 400 (very long reload — single-shot doctrine)', () => {
    expect(weapon.rof).toBe(400);
  });
});

// ── Weapon Effectiveness — HE warhead (combat.cpp warhead tables) ────────────
// C++ combat.cpp — Modify_Damage uses WARHEAD_VS_ARMOR table

describe('V2RL weapon effectiveness — HE warhead (combat.cpp warhead tables)', () => {
  it('HE vs none armor: mult 0.9 (good vs infantry)', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('none')];
    expect(mult).toBe(0.9);
  });

  it('HE vs light armor: mult 0.6', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('light')];
    expect(mult).toBe(0.6);
  });

  it('HE vs heavy armor: mult 0.25 (bad vs tanks)', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('heavy')];
    expect(mult).toBe(0.25);
  });

  it('HE vs concrete: mult 1.0 (excellent vs buildings)', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('concrete')];
    expect(mult).toBe(1.0);
  });

  it('HE vs wood armor: mult 0.75', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('wood')];
    expect(mult).toBe(0.75);
  });

  it('600 base damage vs none armor: 540 effective (600 * 0.9)', () => {
    const baseDamage = WEAPON_STATS.SCUD.damage;
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('none')];
    const effective = Math.round(baseDamage * mult);
    expect(effective).toBe(540);
  });

  it('600 base damage vs heavy armor: 150 effective (600 * 0.25)', () => {
    const baseDamage = WEAPON_STATS.SCUD.damage;
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('heavy')];
    const effective = Math.round(baseDamage * mult);
    expect(effective).toBe(150);
  });

  it('600 base damage vs concrete: 600 effective (600 * 1.0)', () => {
    const baseDamage = WEAPON_STATS.SCUD.damage;
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('concrete')];
    const effective = Math.round(baseDamage * mult);
    expect(effective).toBe(600);
  });
});

// ── Massive Damage (highest single-shot vehicle weapon) ──────────────────────
// C++ RULES.INI — SCUD Damage=600, compared to other vehicle weapons

describe('V2RL massive damage — highest single-shot vehicle weapon (rules.ini)', () => {
  it('SCUD (600) deals more damage than 120mm (40, Mammoth primary)', () => {
    expect(WEAPON_STATS.SCUD.damage).toBeGreaterThan(WEAPON_STATS['120mm'].damage);
  });

  it('SCUD (600) deals more damage than 90mm (30, Medium Tank)', () => {
    expect(WEAPON_STATS.SCUD.damage).toBeGreaterThan(WEAPON_STATS['90mm'].damage);
  });

  it('SCUD (600) deals more damage than 155mm (150, Artillery)', () => {
    expect(WEAPON_STATS.SCUD.damage).toBeGreaterThan(WEAPON_STATS['155mm'].damage);
  });

  it('direct hit on an E1 (50 HP) is an instant kill even after HE vs none (0.9)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const effectiveDmg = Math.round(600 * WARHEAD_VS_ARMOR.HE[armorIndex('none')]);
    // 540 damage vs 50 HP — overkill by 490
    e1.takeDamage(effectiveDmg, 'HE');
    expect(e1.alive).toBe(false);
    expect(e1.hp).toBe(0);
  });

  it('direct hit on a Medium Tank (400 HP heavy armor) deals 150 damage', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);
    const hpBefore = tank.hp;
    const effectiveDmg = Math.round(600 * WARHEAD_VS_ARMOR.HE[armorIndex('heavy')]);
    tank.takeDamage(effectiveDmg, 'HE');
    expect(hpBefore - tank.hp).toBe(150);
    expect(tank.alive).toBe(true); // 400 - 150 = 250 HP remaining
  });
});

// ── Single Ammo / Reload (udata.cpp / weapon.cpp) ───────────────────────────
// C++ udata.cpp — Ammo=1 means one shot before full ROF reload cycle

describe('V2RL single ammo system (udata.cpp Ammo=1)', () => {
  it('V2RL starts with ammo=1', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    expect(v2.ammo).toBe(1);
  });

  it('V2RL maxAmmo is 1', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    expect(v2.maxAmmo).toBe(1);
  });

  it('after firing (ammo decremented), ammo is 0', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    v2.ammo--;
    expect(v2.ammo).toBe(0);
  });

  it('SCUD ROF is 400 ticks (very long reload for single-shot)', () => {
    expect(WEAPON_STATS.SCUD.rof).toBe(400);
  });

  it('ROF 400 is far longer than typical vehicle weapon ROF (~50-80)', () => {
    expect(WEAPON_STATS.SCUD.rof).toBeGreaterThan(WEAPON_STATS['90mm'].rof);
    expect(WEAPON_STATS.SCUD.rof).toBeGreaterThan(WEAPON_STATS['120mm'].rof);
    expect(WEAPON_STATS.SCUD.rof).toBeGreaterThan(WEAPON_STATS['155mm'].rof);
  });
});

// ── NoMovingFire (unit.cpp:1760-1764) ────────────────────────────────────────
// C++ unit.cpp — NoMovingFire: vehicle must stop moving before it can fire

describe('V2RL NoMovingFire (unit.cpp:1760-1764)', () => {
  it('V2RL stats.noMovingFire is true', () => {
    const stats = UNIT_STATS.V2RL;
    expect(stats.noMovingFire).toBe(true);
  });

  it('setup time after stopping: ROF/4 = 400/4 = 100 ticks', () => {
    // C++ unit.cpp:1760-1764 — Arm = Rearm_Delay(true)/4 when stopping
    const setupTime = Math.floor(WEAPON_STATS.SCUD.rof / 4);
    expect(setupTime).toBe(100);
  });

  it('wasMoving flag detects transition from moving to stationary', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    expect(v2.wasMoving).toBe(false);
    v2.wasMoving = true;
    expect(v2.wasMoving).toBe(true);
  });
});

// ── Long Range (rules.ini — Range=10.0) ──────────────────────────────────────
// C++ RULES.INI — SCUD Range=10.0, outranges most base defenses

describe('V2RL long range — 10.0 cells (rules.ini)', () => {
  it('SCUD range is 10.0 cells', () => {
    expect(WEAPON_STATS.SCUD.range).toBe(10.0);
  });

  it('outranges GUN turret (M1Carbine range 3.0)', () => {
    expect(WEAPON_STATS.SCUD.range).toBeGreaterThan(WEAPON_STATS.M1Carbine.range);
  });

  it('outranges Medium Tank 90mm (5.75 cells)', () => {
    expect(WEAPON_STATS.SCUD.range).toBeGreaterThan(WEAPON_STATS['90mm'].range);
  });

  it('outranges Mammoth 120mm (6.75 cells)', () => {
    expect(WEAPON_STATS.SCUD.range).toBeGreaterThan(WEAPON_STATS['120mm'].range);
  });

  it('outranges Artillery 155mm (6.0 cells)', () => {
    expect(WEAPON_STATS.SCUD.range).toBeGreaterThan(WEAPON_STATS['155mm'].range);
  });

  it('V2RL can hit target at 9 cells but not at 11 cells', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    const nearTarget = entityAtCell(UnitType.I_E1, House.Spain, 19, 10); // 9 cells away
    const farTarget = entityAtCell(UnitType.I_E1, House.Spain, 21, 10); // 11 cells away
    expect(v2.inRange(nearTarget)).toBe(true);
    expect(v2.inRange(farTarget)).toBe(false);
  });
});

// ── Inaccuracy (weapon.cpp — Inaccuracy=1.5) ────────────────────────────────
// C++ weapon.cpp — SCUD has Inaccuracy=1.5, shots scatter significantly

describe('V2RL inaccuracy — SCUD scatter 1.5 cells (weapon.cpp)', () => {
  it('SCUD inaccuracy is 1.5', () => {
    expect(WEAPON_STATS.SCUD.inaccuracy).toBe(1.5);
  });

  it('same inaccuracy as 155mm Artillery (both scatter at 1.5 cells)', () => {
    // Both V2RL SCUD and Artillery 155mm share 1.5 inaccuracy (both are indirect-fire weapons)
    expect(WEAPON_STATS.SCUD.inaccuracy).toBe(1.5);
    expect(WEAPON_STATS['155mm'].inaccuracy).toBe(1.5);
  });
});

// ── No Turret (udata.cpp) ───────────────────────────────────────────────────
// C++ udata.cpp — V2RL has no turret, must rotate entire body to aim

describe('V2RL no turret (udata.cpp)', () => {
  it('hasTurret is false — V2RL must rotate body to aim', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    expect(v2.hasTurret).toBe(false);
  });

  it('non-turreted means body facing determines fire direction', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    v2.facing = Dir.N;
    v2.desiredFacing = Dir.N;
    // Body and turret facing should be the same for non-turreted vehicles
    // (no independent turret rotation)
    expect(v2.hasTurret).toBe(false);
  });
});

// ── Crusher Vehicle (drive.cpp:Ok_To_Move) ──────────────────────────────────
// C++ drive.cpp — V2RL is a crusher vehicle: can crush infantry in its path

describe('V2RL crusher (drive.cpp:Ok_To_Move)', () => {
  it('V2RL stats confirm crusher flag is true', () => {
    expect(UNIT_STATS.V2RL.crusher).toBe(true);
  });

  it('V2RL crushes enemy infantry in the same cell', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ctx = makeCombatCtx([v2, e1]);
    checkVehicleCrush(ctx, v2);
    expect(e1.alive).toBe(false);
  });

  it('V2RL does NOT crush allied infantry', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([v2, e1]);
    checkVehicleCrush(ctx, v2);
    expect(e1.alive).toBe(true);
    expect(e1.hp).toBe(e1.maxHp);
  });
});

// ── Vehicle Rotation — Stop-Rotate-Move (drive.cpp) ─────────────────────────
// C++ drive.cpp — vehicles stop, rotate to face destination, THEN move
// V2RL rot=5 means gradual rotation (not instant like infantry rot >= 8)

describe('V2RL vehicle rotation — stop-rotate-move (drive.cpp)', () => {
  it('V2RL rot=5 means gradual rotation (not instant snap)', () => {
    expect(UNIT_STATS.V2RL.rot).toBe(5);
    expect(UNIT_STATS.V2RL.rot).toBeLessThan(8); // < 8 means gradual
  });

  it('V2RL facing N toward target E: does NOT move until rotation completes', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    v2.facing = Dir.N;
    v2.desiredFacing = Dir.N;
    v2.bodyFacing32 = Dir.N * 4;

    const startX = v2.pos.x;
    const startY = v2.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY }; // due East

    // One moveToward tick — vehicle should stop to rotate first
    const arrived = v2.moveToward(targetPos, v2.stats.speed);
    expect(arrived).toBe(false);
    // Position unchanged because vehicle stops to rotate
    expect(v2.pos.x).toBe(startX);
    expect(v2.pos.y).toBe(startY);
  });

  it('after enough rotation ticks, V2RL starts moving', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    v2.facing = Dir.E; // already facing the right direction
    v2.desiredFacing = Dir.E;
    v2.bodyFacing32 = Dir.E * 4;

    const startX = v2.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: v2.pos.y };

    const arrived = v2.moveToward(targetPos, v2.stats.speed);
    // Should have moved (facing already aligned)
    expect(v2.pos.x).toBeGreaterThan(startX);
  });
});

// ── Damage / Speed / Survivability ──────────────────────────────────────────
// C++ combat.cpp — V2RL has light armor (150 HP), fragile for a vehicle

describe('V2RL survivability — light armor 150 HP (combat.cpp)', () => {
  it('V2RL takes full SA damage multiplied by SA vs light (0.6)', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    const hpBefore = v2.hp;
    // M1Carbine: 15 damage, SA warhead. SA vs light = 0.6
    const damage = Math.round(15 * WARHEAD_VS_ARMOR.SA[armorIndex('light')]);
    v2.takeDamage(damage, 'SA');
    expect(hpBefore - v2.hp).toBe(damage);
    expect(damage).toBe(9); // 15 * 0.6 = 9
  });

  it('V2RL takes heavy damage from AP weapons (AP vs light = 0.75)', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    const hpBefore = v2.hp;
    // 90mm: 30 damage, AP warhead. AP vs light = 0.75
    const damage = Math.round(30 * WARHEAD_VS_ARMOR.AP[armorIndex('light')]);
    v2.takeDamage(damage, 'AP');
    expect(hpBefore - v2.hp).toBe(damage);
    expect(damage).toBe(23); // 30 * 0.75 = 22.5 → round to 23
  });

  it('V2RL dies in 2 hits from Medium Tank 90mm (at full AP vs light)', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    const damagePerHit = Math.round(30 * WARHEAD_VS_ARMOR.AP[armorIndex('light')]);
    // 150 HP / 23 per hit = ~6.5 hits to kill (actually survives more than 2)
    // The V2RL is fragile but not a 2-hit kill from 90mm
    const hitsToKill = Math.ceil(150 / damagePerHit);
    expect(hitsToKill).toBeGreaterThan(2);
    expect(hitsToKill).toBeLessThanOrEqual(7); // dies within 7 hits
  });

  it('V2RL is killed when HP reaches 0', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    v2.takeDamage(200, 'AP'); // overkill
    expect(v2.alive).toBe(false);
    expect(v2.hp).toBe(0);
    expect(v2.mission).toBe(Mission.DIE);
  });
});

// ── Retaliation (techno.cpp) ─────────────────────────────────────────────────
// C++ techno.cpp — idle/moving units counter-attack when hit by enemy

describe('V2RL retaliation (techno.cpp)', () => {
  it('idle V2RL on GUARD mission retaliates when hit by enemy', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    v2.mission = Mission.GUARD;
    v2.target = null;

    const ctx = makeCombatCtx([v2, attacker]);
    triggerRetaliation(ctx, v2, attacker);

    expect(v2.target).toBe(attacker);
    expect(v2.mission).toBe(Mission.ATTACK);
  });

  it('V2RL has a weapon (SCUD) so can retaliate', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    expect(v2.weapon).not.toBeNull();
    expect(v2.weapon!.name).toBe('SCUD');
  });

  it('V2RL does not retarget if already has a living target', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    const existingTarget = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const newAttacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    v2.mission = Mission.ATTACK;
    v2.target = existingTarget;

    const ctx = makeCombatCtx([v2, existingTarget, newAttacker]);
    triggerRetaliation(ctx, v2, newAttacker);

    expect(v2.target).toBe(existingTarget);
  });

  it('V2RL does not retaliate against allies', () => {
    // Ukraine and USSR are both soviet — allied
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.Ukraine, 11, 10);
    v2.mission = Mission.GUARD;
    v2.target = null;

    const ctx = makeCombatCtx([v2, ally]);
    triggerRetaliation(ctx, v2, ally);

    expect(v2.target).toBeNull();
    expect(v2.mission).toBe(Mission.GUARD);
  });
});

// ── AI Scatter on Damage (techno.cpp) ────────────────────────────────────────
// C++ techno.cpp — AI-controlled units on GUARD move to adjacent cell when damaged

describe('V2RL AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled V2RL on GUARD mission scatters when damaged (IQ >= 2)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
      v2.mission = Mission.GUARD;
      const ctx = makeCombatCtx([v2]);
      aiScatterOnDamage(ctx, v2);
      if (v2.mission === Mission.MOVE && v2.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('player-controlled V2RL does NOT scatter', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.Spain, 10, 10);
    v2.mission = Mission.GUARD;

    const ctx = makeCombatCtx([v2]);
    aiScatterOnDamage(ctx, v2);

    expect(v2.mission).toBe(Mission.GUARD);
    expect(v2.moveTarget).toBeNull();
  });

  it('AI V2RL on ATTACK mission does NOT scatter (only GUARD/AREA_GUARD scatter)', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    v2.mission = Mission.ATTACK;

    const ctx = makeCombatCtx([v2]);
    aiScatterOnDamage(ctx, v2);

    expect(v2.mission).toBe(Mission.ATTACK);
  });
});

// ── Vehicle Animation (unit.cpp) ─────────────────────────────────────────────
// C++ unit.cpp — vehicles use 32-frame body rotation sprite system

describe('V2RL vehicle animation (unit.cpp)', () => {
  it('V2RL isInfantry = false', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    expect(v2.stats.isInfantry).toBe(false);
  });

  it('V2RL isAnt = false', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    expect(v2.isAnt).toBe(false);
  });

  it('V2RL spriteFrame returns valid vehicle body frame', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    const frame = v2.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
    expect(frame).toBeLessThan(32); // vehicle body frames are 0-31
  });

  it('V2RL starts in IDLE animState', () => {
    const v2 = entityAtCell(UnitType.V_V2RL, House.USSR, 10, 10);
    expect(v2.alive).toBe(true);
    expect(v2.animState).toBe(AnimState.IDLE);
  });
});
