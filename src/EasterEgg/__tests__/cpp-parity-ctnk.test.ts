/**
 * C++ Behavioral Parity: CTNK — Chrono Tank
 *
 * Tests verify Chrono Tank behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with CTNK (observable outcomes: HP, alive/dead,
 * mission, turret state, chronoCooldown, position changes), not HOW the code implements it.
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
    playerHouse: House.Greece,
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
// C++ udata.cpp (unit type data) -- CTNK entry and RULES.INI [CTNK] section

describe('CTNK stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.CTNK;
  const weapon = WEAPON_STATS.APTusk;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'CTNK');

  it('HP is 350 (Strength=350)', () => {
    expect(stats.strength).toBe(350);
  });

  it('Armor is light (Armor=light) — unusual for a tank', () => {
    expect(stats.armor).toBe('light');
  });

  it('Speed is 5 (Speed=5)', () => {
    expect(stats.speed).toBe(5);
  });

  it('isInfantry is false (vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('crusher is true (can crush infantry)', () => {
    expect(stats.crusher).toBe(true);
  });

  it('primary weapon is APTusk', () => {
    expect(stats.primaryWeapon).toBe('APTusk');
  });

  it('ROT is 5 (standard vehicle rotation)', () => {
    expect(stats.rot).toBe(5);
  });

  it('sight is 5', () => {
    expect(stats.sight).toBe(5);
  });

  it('cost is 2400 credits (most expensive vehicle after 4TNK)', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(2400);
  });

  it('4TNK costs less than CTNK (CTNK is most expensive non-mammoth vehicle)', () => {
    const mammoth = PRODUCTION_ITEMS.find(p => p.type === '4TNK');
    expect(mammoth).toBeDefined();
    // 4TNK at 1700, CTNK at 2400 — CTNK is actually more expensive
    expect(prodItem!.cost).toBeGreaterThan(mammoth!.cost);
  });

  it('Entity constructor initializes HP to strength', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    expect(ctnk.hp).toBe(350);
    expect(ctnk.maxHp).toBe(350);
  });
});

// -- Weapon — APTusk (weapon.cpp / rules.ini) ---------------------------------
// C++ weapon.cpp — APTusk entry: AP warhead, 75 damage, range 5.0, burst 2

describe('CTNK weapon — APTusk (weapon.cpp / rules.ini)', () => {
  const weapon = WEAPON_STATS.APTusk;

  it('APTusk warhead is AP', () => {
    expect(weapon.warhead).toBe('AP');
  });

  it('APTusk damage is 75', () => {
    expect(weapon.damage).toBe(75);
  });

  it('APTusk range is 5.0 cells', () => {
    expect(weapon.range).toBe(5.0);
  });

  it('APTusk burst is 2 (marks primary as C++ two-shooter)', () => {
    expect(weapon.burst).toBe(2);
  });

  it('Entity weapon resolved correctly from stats', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    expect(ctnk.weapon).not.toBeNull();
    expect(ctnk.weapon!.name).toBe('APTusk');
    expect(ctnk.weapon!.damage).toBe(75);
    expect(ctnk.weapon!.burst).toBe(2);
  });

  it('CTNK has no secondary weapon', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    expect(ctnk.weapon2).toBeNull();
  });
});

// -- AP Warhead Effectiveness (combat.cpp warhead tables) ---------------------
// C++ combat.cpp — Modify_Damage uses WARHEAD_VS_ARMOR table
// AP: [0.3, 0.75, 0.75, 1.0, 0.5] = [none, wood, light, heavy, concrete]

describe('CTNK weapon effectiveness — AP warhead (combat.cpp warhead tables)', () => {
  it('AP vs none armor: mult 0.3 (poor vs infantry)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('none')];
    expect(mult).toBe(0.3);
  });

  it('AP vs light armor: mult 0.75', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('light')];
    expect(mult).toBe(0.75);
  });

  it('AP vs heavy armor: mult 1.0 (best vs heavy tanks)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('heavy')];
    expect(mult).toBe(1.0);
  });

  it('AP vs concrete: mult 0.5', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('concrete')];
    expect(mult).toBe(0.5);
  });

  it('AP vs wood: mult 0.75', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('wood')];
    expect(mult).toBe(0.75);
  });

  it('CTNK deals full 75 base damage to heavy-armor tanks', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const hpBefore = target.hp;
    // AP vs heavy = 1.0, so 75 * 1.0 = 75
    const damage = Math.round(75 * WARHEAD_VS_ARMOR.AP[armorIndex('heavy')]);
    target.takeDamage(damage, 'AP');
    expect(hpBefore - target.hp).toBe(75);
  });

  it('CTNK deals reduced damage to infantry (AP vs none = 0.3)', () => {
    const target = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const hpBefore = target.hp;
    // AP vs none = 0.3, so 75 * 0.3 = 22.5 -> round to 23
    const damage = Math.round(75 * WARHEAD_VS_ARMOR.AP[armorIndex('none')]);
    target.takeDamage(damage, 'AP');
    expect(hpBefore - target.hp).toBe(damage);
    expect(damage).toBeLessThan(75);
    expect(damage).toBe(23); // Math.round(75 * 0.3)
  });
});

// -- Light Armor Vulnerability (rules.ini / combat.cpp) -----------------------
// C++ rules.ini: CTNK Armor=light — unusual for a tank, makes it vulnerable to SA

describe('CTNK light armor vulnerability (rules.ini / combat.cpp)', () => {
  it('CTNK has light armor (unlike 2TNK/3TNK/4TNK which have heavy)', () => {
    expect(UNIT_STATS.CTNK.armor).toBe('light');
    expect(UNIT_STATS['2TNK'].armor).toBe('heavy');
    expect(UNIT_STATS['3TNK'].armor).toBe('heavy');
    expect(UNIT_STATS['4TNK'].armor).toBe('heavy');
  });

  it('SA warhead deals more damage to CTNK (light) than to heavy tanks', () => {
    const saVsLight = WARHEAD_VS_ARMOR.SA[armorIndex('light')];
    const saVsHeavy = WARHEAD_VS_ARMOR.SA[armorIndex('heavy')];
    // SA vs light = 0.6, SA vs heavy = 0.25
    expect(saVsLight).toBe(0.6);
    expect(saVsHeavy).toBe(0.25);
    expect(saVsLight).toBeGreaterThan(saVsHeavy);
  });

  it('E1 rifle does 9 damage to CTNK (light) vs 4 to 2TNK (heavy)', () => {
    // SA damage 15 * 0.6 (light) = 9
    const dmgVsCTNK = Math.round(15 * WARHEAD_VS_ARMOR.SA[armorIndex('light')]);
    // SA damage 15 * 0.25 (heavy) = 3.75 -> 4
    const dmgVs2TNK = Math.round(15 * WARHEAD_VS_ARMOR.SA[armorIndex('heavy')]);
    expect(dmgVsCTNK).toBe(9);
    expect(dmgVs2TNK).toBe(4);
    expect(dmgVsCTNK).toBeGreaterThan(dmgVs2TNK);
  });

  it('CTNK takes actual SA damage matching light armor multiplier', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    const hpBefore = ctnk.hp;
    const saBaseDamage = 15;
    const expected = Math.round(saBaseDamage * WARHEAD_VS_ARMOR.SA[armorIndex('light')]);
    ctnk.takeDamage(expected, 'SA');
    expect(hpBefore - ctnk.hp).toBe(expected);
    expect(expected).toBe(9);
  });
});

// -- Chrono Ability (unit.cpp / special ability) ------------------------------
// C++ unit.cpp — Chrono Tank has a teleport cooldown field

describe('CTNK chrono ability — chronoCooldown (unit.cpp)', () => {
  it('Entity has chronoCooldown field initialized to 0', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    expect(ctnk.chronoCooldown).toBe(0);
  });

  it('chronoCooldown can be set and read back', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    ctnk.chronoCooldown = 150;
    expect(ctnk.chronoCooldown).toBe(150);
  });

  it('chronoCooldown decrements correctly when manually ticked', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    ctnk.chronoCooldown = 10;
    // Simulate decrementing (game loop responsibility)
    ctnk.chronoCooldown--;
    expect(ctnk.chronoCooldown).toBe(9);
  });

  it('chronoCooldown does not exist on infantry (field exists but unused)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    // Field exists on all entities (default 0), but only meaningful for CTNK
    expect(e1.chronoCooldown).toBe(0);
  });
});

// -- No Turret (udata.cpp exclusion list) -------------------------------------
// C++ udata.cpp — CTNK is in the no-turret exclusion list for vehicles

describe('CTNK no turret (udata.cpp exclusion list)', () => {
  it('hasTurret is false for CTNK', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    expect(ctnk.hasTurret).toBe(false);
  });

  it('2TNK (standard tank) has turret for comparison', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.hasTurret).toBe(true);
  });

  it('other expansion no-turret vehicles also lack turret (except STNK)', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    const ttnk = entityAtCell(UnitType.V_TTNK, House.Spain, 10, 10);
    const qtnk = entityAtCell(UnitType.V_QTNK, House.Spain, 10, 10);
    const dtrk = entityAtCell(UnitType.V_DTRK, House.Spain, 10, 10);
    expect(stnk.hasTurret).toBe(true); // C++ udata.cpp:762 IsTurretEquipped=true
    expect(ttnk.hasTurret).toBe(false);
    expect(qtnk.hasTurret).toBe(false);
    expect(dtrk.hasTurret).toBe(false);
  });
});

// -- Crusher (drive.cpp:Ok_To_Move) -------------------------------------------
// C++ drive.cpp — CTNK has crusher=true, can crush infantry

describe('CTNK crusher (drive.cpp:Ok_To_Move)', () => {
  it('CTNK kills infantry when entering their cell', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([e1, ctnk]);
    checkVehicleCrush(ctx, ctnk);
    expect(e1.alive).toBe(false);
  });

  it('CTNK does NOT crush allied infantry', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([e1, ctnk]);
    checkVehicleCrush(ctx, ctnk);
    expect(e1.alive).toBe(true);
    expect(e1.hp).toBe(e1.maxHp);
  });

  it('CTNK does NOT crush cross-allied infantry (Greece allied with Spain)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Greece, 10, 10);
    const ctx = makeCombatCtx([e1, ctnk]);
    checkVehicleCrush(ctx, ctnk);
    expect(e1.alive).toBe(true);
  });

  it('CTNK crushes multiple infantry in the same cell', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const e2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([e1, e2, ctnk]);
    checkVehicleCrush(ctx, ctnk);
    expect(e1.alive).toBe(false);
    expect(e2.alive).toBe(false);
  });
});

// -- Vehicle Movement: Stop-Rotate-Move (drive.cpp) ---------------------------
// C++ drive.cpp — vehicles stop, rotate to face destination, THEN move.
// CTNK ROT=5 means it needs multiple ticks to rotate (unlike infantry rot >= 8).

describe('CTNK vehicle movement — stop-rotate-move (drive.cpp)', () => {
  it('CTNK facing N toward target E: does NOT move until rotation completes', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    ctnk.facing = Dir.N;
    ctnk.desiredFacing = Dir.N;
    ctnk.bodyFacing32 = Dir.N * 4;

    const startX = ctnk.pos.x;
    const startY = ctnk.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY }; // due East

    // One moveToward tick — vehicle should stop to rotate first
    const arrived = ctnk.moveToward(targetPos, ctnk.stats.speed);

    expect(arrived).toBe(false);
    // Position unchanged because vehicle stops to rotate
    expect(ctnk.pos.x).toBe(startX);
    expect(ctnk.pos.y).toBe(startY);
  });

  it('CTNK ROT=5 requires multiple ticks for 90-degree rotation', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    ctnk.facing = Dir.N;
    ctnk.desiredFacing = Dir.E; // 90 degrees clockwise
    ctnk.bodyFacing32 = Dir.N * 4;

    // ROT=5, threshold=8: first tick accumulates to 5 (< 8), no visual step
    const aligned1 = ctnk.tickRotation();
    expect(aligned1).toBe(false);

    // Reset per-frame guard
    ctnk.rotTickedThisFrame = false;

    // Second tick: accumulator = 5+5 = 10 >= 8, one visual step taken
    const aligned2 = ctnk.tickRotation();
    // Still not aligned — need to traverse 8 steps (N to E in 32-step ring)
    expect(aligned2).toBe(false);
  });

  it('CTNK eventually reaches target facing after enough rotation ticks', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    ctnk.facing = Dir.N;
    ctnk.desiredFacing = Dir.E;
    ctnk.bodyFacing32 = Dir.N * 4;

    // Rotate for enough ticks to complete N->E (8 visual steps, ROT=5)
    let aligned = false;
    for (let i = 0; i < 30; i++) {
      ctnk.rotTickedThisFrame = false;
      aligned = ctnk.tickRotation();
      if (aligned) break;
    }
    expect(aligned).toBe(true);
    expect(ctnk.facing).toBe(Dir.E);
  });
});

// -- Damage / Death Behavior (combat.cpp) -------------------------------------
// C++ combat.cpp — standard vehicle damage behavior

describe('CTNK damage and death (combat.cpp)', () => {
  it('CTNK takes exact damage from AP warhead', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    const hpBefore = ctnk.hp;
    ctnk.takeDamage(75, 'AP');
    expect(hpBefore - ctnk.hp).toBe(75);
    expect(ctnk.alive).toBe(true);
  });

  it('CTNK dies when HP reaches 0', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    ctnk.takeDamage(350, 'AP');
    expect(ctnk.hp).toBe(0);
    expect(ctnk.alive).toBe(false);
    expect(ctnk.mission).toBe(Mission.DIE);
    expect(ctnk.animState).toBe(AnimState.DIE);
  });

  it('CTNK dies when HP goes below 0 (overkill)', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    ctnk.takeDamage(500, 'AP');
    expect(ctnk.hp).toBe(0);
    expect(ctnk.alive).toBe(false);
  });

  it('CTNK survives at 1 HP', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    ctnk.takeDamage(349, 'AP');
    expect(ctnk.hp).toBe(1);
    expect(ctnk.alive).toBe(true);
  });

  it('dead CTNK takes no further damage', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    ctnk.takeDamage(350, 'AP');
    expect(ctnk.alive).toBe(false);
    // Further damage should be ignored
    const killed = ctnk.takeDamage(100, 'AP');
    expect(killed).toBe(false);
    expect(ctnk.hp).toBe(0);
  });

  it('CTNK is not infantry — no prone damage reduction', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    expect(ctnk.stats.isInfantry).toBe(false);
    // Vehicles don't have prone behavior — C++ only applies ProneDamageBias in infantry.cpp
    ctnk.isProne = true; // setting it shouldn't matter for non-infantry damage path
    const hpBefore = ctnk.hp;
    ctnk.takeDamage(100, 'AP');
    const damageTaken = hpBefore - ctnk.hp;
    // C++ infantry.cpp:329-330 — ProneDamageBias only applies to infantry, not vehicles
    expect(damageTaken).toBe(100);
  });
});

// -- Retaliation (techno.cpp) -------------------------------------------------
// C++ techno.cpp — idle/moving units counter-attack when hit by enemy

describe('CTNK retaliation (techno.cpp)', () => {
  it('idle CTNK on GUARD mission retaliates when hit by enemy', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    ctnk.mission = Mission.GUARD;
    ctnk.target = null;

    const ctx = makeCombatCtx([ctnk, attacker]);
    triggerRetaliation(ctx, ctnk, attacker);

    expect(ctnk.target).toBe(attacker);
    expect(ctnk.mission).toBe(Mission.GUARD);
  });

  it('CTNK CAN retaliate (has weapon)', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    expect(ctnk.weapon).not.toBeNull();
    expect(ctnk.weapon!.name).toBe('APTusk');
  });

  it('CTNK does not retarget if already has a living target', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    const existingTarget = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const newAttacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    ctnk.mission = Mission.ATTACK;
    ctnk.target = existingTarget;

    const ctx = makeCombatCtx([ctnk, existingTarget, newAttacker]);
    triggerRetaliation(ctx, ctnk, newAttacker);

    // Should keep existing target, not switch
    expect(ctnk.target).toBe(existingTarget);
  });

  it('CTNK does not retaliate against allies', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.Greece, 11, 10);
    ctnk.mission = Mission.GUARD;
    ctnk.target = null;

    const ctx = makeCombatCtx([ctnk, ally]);
    triggerRetaliation(ctx, ctnk, ally);

    expect(ctnk.target).toBeNull();
    expect(ctnk.mission).toBe(Mission.GUARD);
  });
});

// -- AI Scatter on Damage (techno.cpp) ----------------------------------------
// C++ techno.cpp — AI-controlled units on GUARD scatter when damaged

describe('CTNK AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled CTNK on GUARD mission changes position when damaged (IQ >= 2)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const ctnk = entityAtCell(UnitType.V_CTNK, House.USSR, 10, 10);
      ctnk.mission = Mission.GUARD;
      const testCtx = makeCombatCtx([ctnk]);
      aiScatterOnDamage(testCtx, ctnk);
      if (ctnk.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('player-controlled CTNK does NOT scatter', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    ctnk.mission = Mission.GUARD;

    const ctx = makeCombatCtx([ctnk]);
    ctx.playerHouse = House.Spain;
    aiScatterOnDamage(ctx, ctnk);

    expect(ctnk.mission).toBe(Mission.GUARD);
    expect(ctnk.moveTarget).toBeNull();
  });

  it('AI CTNK on ATTACK mission does NOT scatter (only GUARD/AREA_GUARD scatter)', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.USSR, 10, 10);
    ctnk.mission = Mission.ATTACK;

    const ctx = makeCombatCtx([ctnk]);
    aiScatterOnDamage(ctx, ctnk);

    expect(ctnk.mission).toBe(Mission.ATTACK);
  });
});

// -- Vehicle Animation (unit.cpp) ---------------------------------------------
// C++ unit.cpp — vehicle sprite frame uses 32-step BODY_SHAPE lookup

describe('CTNK vehicle animation (unit.cpp)', () => {
  it('CTNK isInfantry = false', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    expect(ctnk.stats.isInfantry).toBe(false);
  });

  it('CTNK isAnt = false', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    expect(ctnk.isAnt).toBe(false);
  });

  it('CTNK spriteFrame returns a valid frame number', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    const frame = ctnk.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('CTNK alive=true starts in IDLE animState', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    expect(ctnk.alive).toBe(true);
    expect(ctnk.animState).toBe(AnimState.IDLE);
  });

  it('CTNK spriteFrame differs for different facings', () => {
    const ctnk1 = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    ctnk1.facing = Dir.N;
    ctnk1.bodyFacing32 = Dir.N * 4;

    const ctnk2 = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    ctnk2.facing = Dir.E;
    ctnk2.bodyFacing32 = Dir.E * 4;

    expect(ctnk1.spriteFrame).not.toBe(ctnk2.spriteFrame);
  });
});

// -- Invulnerability Interactions (crate / Iron Curtain) ----------------------
// C++ combat.cpp — invulnerable entities take no damage

describe('CTNK invulnerability interactions (combat.cpp)', () => {
  it('CTNK with ironCurtainTick > 0 takes no damage', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    ctnk.ironCurtainTick = 100;
    const hpBefore = ctnk.hp;
    const killed = ctnk.takeDamage(200, 'AP');
    expect(killed).toBe(false);
    expect(ctnk.hp).toBe(hpBefore);
    expect(ctnk.alive).toBe(true);
  });

  it('CTNK with invulnTick > 0 takes no damage (crate)', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    ctnk.invulnTick = 50;
    const hpBefore = ctnk.hp;
    ctnk.takeDamage(200, 'AP');
    expect(ctnk.hp).toBe(hpBefore);
  });
});

// -- Crate Bias Interactions (crate.cpp) --------------------------------------
// C++ crate.cpp — armor and firepower bias from crate pickups

describe('CTNK crate bias interactions (crate.cpp)', () => {
  it('armorBias default is 1.0 (no damage reduction)', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    expect(ctnk.armorBias).toBe(1.0);
  });

  it('armorBias 2.0 halves incoming damage (crate pickup)', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    ctnk.armorBias = 2.0;
    const hpBefore = ctnk.hp;
    ctnk.takeDamage(100, 'AP');
    const damageTaken = hpBefore - ctnk.hp;
    // 100 / 2.0 = 50
    expect(damageTaken).toBe(50);
  });

  it('firepowerBias default is 1.0', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    expect(ctnk.firepowerBias).toBe(1.0);
  });

  it('speedBias default is 1.0', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    expect(ctnk.speedBias).toBe(1.0);
  });
});

// -- Burst Fire System (weapon.cpp) -------------------------------------------
// C++ weapon.cpp — APTusk Burst=2 makes the primary weapon a two-shooter.

describe('CTNK two-shooter cadence (weapon.cpp)', () => {
  it('legacy burst diagnostics start at zero', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    expect(ctnk.burstCount).toBe(0);
    expect(ctnk.burstDelay).toBe(0);
  });

  it('primary weapon Burst=2 makes CTNK a C++ two-shooter', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    expect(ctnk.weapon!.burst).toBe(2);
    expect(ctnk.isTwoShooter()).toBe(true);
    expect(ctnk.isSecondShot).toBe(false);
  });
});
