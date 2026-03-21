/**
 * C++ Behavioral Parity: MCV — Mobile Construction Vehicle
 *
 * Tests verify MCV behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with MCV (observable outcomes: HP, alive/dead,
 * mission, position changes, turret state), not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WARHEAD_VS_ARMOR, CONDITION_YELLOW,
  buildDefaultAlliances, armorIndex,
  PRODUCTION_ITEMS, COUNTRY_BONUSES,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  checkVehicleCrush,
  triggerRetaliation,
  aiScatterOnDamage,
  damageSpeedFactor,
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

// ── Stats Verification (rules.ini parity) ────────────────────────────────────
// C++ udata.cpp (unit type data) — MCV entry and RULES.INI [MCV] section

describe('MCV stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.MCV;

  it('HP is 600 (Strength=600)', () => {
    expect(stats.strength).toBe(600);
  });

  it('Armor is light (Armor=light) — high HP but vulnerable to AP', () => {
    expect(stats.armor).toBe('light');
  });

  it('Speed is 6 (Speed=6)', () => {
    expect(stats.speed).toBe(6);
  });

  it('isInfantry is false (vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('crusher is falsy (MCV has no Tracked=yes in rules.ini)', () => {
    expect(stats.crusher).toBeFalsy();
  });

  it('rot is 5 (ROT=5, standard vehicle rotation)', () => {
    expect(stats.rot).toBe(5);
  });

  it('sight is 4 (Sight=4)', () => {
    expect(stats.sight).toBe(4);
  });

  it('primaryWeapon is null (unarmed — cannot attack)', () => {
    expect(stats.primaryWeapon).toBeNull();
  });

  it('Entity constructor initializes HP to strength', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    expect(mcv.hp).toBe(600);
    expect(mcv.maxHp).toBe(600);
  });
});

// ── No Weapon (udata.cpp) ─────────────────────────────────────────────────────
// C++ udata.cpp — MCV has no primary or secondary weapon

describe('MCV has no weapon (udata.cpp)', () => {
  it('Entity.weapon is null (no primaryWeapon)', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    expect(mcv.weapon).toBeNull();
  });

  it('Entity.weapon2 is null (no secondaryWeapon)', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    expect(mcv.weapon2).toBeNull();
  });
});

// ── No Turret (unit.cpp hasTurret exclusion list) ─────────────────────────────
// C++ unit.cpp — MCV is in the exclusion list for turreted vehicles

describe('MCV has no turret (unit.cpp exclusion list)', () => {
  it('hasTurret is false', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    expect(mcv.hasTurret).toBe(false);
  });

  it('contrast: 2TNK has turret', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.hasTurret).toBe(true);
  });
});

// ── Light Armor Vulnerability (combat.cpp warhead tables) ─────────────────────
// C++ combat.cpp — MCV's light armor makes it vulnerable to AP warheads.
// Contrast with Harvester: same HP (600) but heavy armor.

describe('MCV light armor vulnerability (combat.cpp warhead tables)', () => {
  it('AP vs light armor: mult 0.75 (MCV takes 75% from AP rounds)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('light')];
    expect(mult).toBe(0.75);
  });

  it('AP vs heavy armor: mult 1.0 (full AP damage to heavy)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('heavy')];
    expect(mult).toBe(1.0);
  });

  it('MCV (light) takes MORE AP damage than SA damage: AP 0.75 vs SA 0.6', () => {
    const apMult = WARHEAD_VS_ARMOR.AP[armorIndex('light')];
    const saMult = WARHEAD_VS_ARMOR.SA[armorIndex('light')];
    expect(apMult).toBeGreaterThan(saMult);
  });

  it('MCV takes 75% of AP base damage (e.g. 100 base → 75 effective)', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.USSR, 10, 10);
    const hpBefore = mcv.hp;
    const baseDamage = 100;
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('light')];
    const effectiveDamage = Math.round(baseDamage * mult);
    mcv.takeDamage(effectiveDamage, 'AP');
    expect(hpBefore - mcv.hp).toBe(75);
  });

  it('Harvester (heavy armor, same 600 HP) takes MORE AP damage than MCV per hit', () => {
    // AP vs heavy = 1.0, AP vs light = 0.75
    // So heavy-armored units TAKE MORE from AP — this is the tradeoff:
    // MCV has light armor which is BETTER against AP (0.75 < 1.0)
    // but WORSE against SA (0.6 > 0.25) and HE (0.6 > 0.25)
    const apVsLight = WARHEAD_VS_ARMOR.AP[armorIndex('light')];
    const apVsHeavy = WARHEAD_VS_ARMOR.AP[armorIndex('heavy')];
    expect(apVsHeavy).toBeGreaterThan(apVsLight);
  });

  it('SA vs light armor: mult 0.6 — small arms are weak against MCV', () => {
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('light')];
    expect(mult).toBe(0.6);
  });

  it('HE vs light armor: mult 0.6 — explosives moderate vs MCV', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('light')];
    expect(mult).toBe(0.6);
  });
});

// ── Crusher (drive.cpp:Ok_To_Move) ────────────────────────────────────────────
// rules.ini [MCV] has no Tracked=yes — MCV is wheeled, cannot crush infantry

describe('MCV non-crusher (rules.ini: no Tracked=yes)', () => {
  it('MCV does NOT crush enemy infantry (no crusher flag)', () => {
    const infantry = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    const ctx = makeCombatCtx([infantry, mcv]);
    checkVehicleCrush(ctx, mcv);
    expect(infantry.alive).toBe(true);
  });

  it('MCV does NOT crush allied infantry', () => {
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    const ctx = makeCombatCtx([infantry, mcv]);
    checkVehicleCrush(ctx, mcv);
    expect(infantry.alive).toBe(true);
    expect(infantry.hp).toBe(infantry.maxHp);
  });

  it('MCV does NOT crush enemy infantry even when co-located', () => {
    const e1a = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const e1b = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    const ctx = makeCombatCtx([e1a, e1b, mcv]);
    checkVehicleCrush(ctx, mcv);
    expect(e1a.alive).toBe(true);
    expect(e1b.alive).toBe(true);
  });
});

// ── No Retaliation (techno.cpp) ──────────────────────────────────────────────
// C++ techno.cpp — MCV cannot retaliate because it has no weapon

describe('MCV cannot retaliate (techno.cpp)', () => {
  it('MCV has no weapon so triggerRetaliation does not assign a target', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    mcv.mission = Mission.GUARD;
    mcv.target = null;

    const ctx = makeCombatCtx([mcv, attacker]);
    triggerRetaliation(ctx, mcv, attacker);

    expect(mcv.target).toBeNull();
    expect(mcv.mission).toBe(Mission.GUARD);
  });

  it('MCV does not switch to ATTACK mission when hit', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    mcv.mission = Mission.GUARD;

    const ctx = makeCombatCtx([mcv, attacker]);
    triggerRetaliation(ctx, mcv, attacker);

    expect(mcv.mission).not.toBe(Mission.ATTACK);
  });
});

// ── AI Scatter on Damage (techno.cpp) ────────────────────────────────────────
// C++ techno.cpp — AI-controlled MCV on GUARD scatters when damaged

describe('MCV AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled MCV on GUARD mission scatters when damaged (IQ >= 2)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const mcv = entityAtCell(UnitType.V_MCV, House.USSR, 10, 10);
      mcv.mission = Mission.GUARD;
      const ctx = makeCombatCtx([mcv]);
      aiScatterOnDamage(ctx, mcv);
      if (mcv.mission === Mission.MOVE && mcv.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('player-controlled MCV does NOT scatter', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    mcv.mission = Mission.GUARD;

    const ctx = makeCombatCtx([mcv]);
    aiScatterOnDamage(ctx, mcv);

    expect(mcv.mission).toBe(Mission.GUARD);
    expect(mcv.moveTarget).toBeNull();
  });
});

// ── Movement: Stop-Rotate-Move (drive.cpp) ────────────────────────────────────
// C++ drive.cpp — vehicles stop to rotate before moving (unlike nimble infantry)

describe('MCV movement — stop-rotate-move (drive.cpp)', () => {
  it('MCV facing N toward target E: does NOT move until rotation completes', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    mcv.facing = Dir.N;
    mcv.desiredFacing = Dir.N;
    mcv.bodyFacing32 = Dir.N * 4;

    const startX = mcv.pos.x;
    const startY = mcv.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY };

    // One moveToward tick — vehicle should stop to rotate first
    const arrived = mcv.moveToward(targetPos, mcv.stats.speed);

    expect(arrived).toBe(false);
    // Position unchanged because vehicle stops to rotate
    expect(mcv.pos.x).toBe(startX);
    expect(mcv.pos.y).toBe(startY);
  });

  it('MCV rot=5 requires multiple ticks to rotate 90 degrees (N to E)', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    mcv.facing = Dir.N;
    mcv.desiredFacing = Dir.E;
    mcv.bodyFacing32 = Dir.N * 4;

    // Single tick should NOT complete rotation (rot=5, need 8 per visual step)
    const aligned = mcv.tickRotation();
    expect(aligned).toBe(false);
    expect(mcv.facing).not.toBe(Dir.E);
  });

  it('MCV eventually completes rotation and moves after enough ticks', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    mcv.facing = Dir.N;
    mcv.desiredFacing = Dir.N;
    mcv.bodyFacing32 = Dir.N * 4;

    const startX = mcv.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: mcv.pos.y };

    let moved = false;
    for (let i = 0; i < 100; i++) {
      // Reset rotation-tick guard each simulated tick
      mcv.rotTickedThisFrame = false;
      mcv.moveToward(targetPos, mcv.stats.speed);
      if (mcv.pos.x !== startX) {
        moved = true;
        break;
      }
    }
    expect(moved).toBe(true);
  });
});

// ── Damage Speed Reduction (drive.cpp:1157-1161) ─────────────────────────────
// C++ drive.cpp — vehicles at <=50% HP move at 75% speed (ConditionYellow)

describe('MCV damage speed reduction (drive.cpp)', () => {
  it('full HP MCV has speed factor 1.0', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    expect(damageSpeedFactor(mcv)).toBe(1.0);
  });

  it('MCV at exactly 50% HP has speed factor 0.75 (ConditionYellow threshold)', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    mcv.hp = Math.floor(mcv.maxHp * CONDITION_YELLOW); // 300
    expect(damageSpeedFactor(mcv)).toBe(0.75);
  });

  it('MCV at 25% HP has speed factor 0.75', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    mcv.hp = 150; // 25%
    expect(damageSpeedFactor(mcv)).toBe(0.75);
  });

  it('MCV at 51% HP still has speed factor 1.0 (above yellow threshold)', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    mcv.hp = Math.floor(mcv.maxHp * 0.51) + 1; // just above 50%
    expect(damageSpeedFactor(mcv)).toBe(1.0);
  });
});

// ── Death / Survivability (techno.cpp) ───────────────────────────────────────
// C++ techno.cpp — MCV has 600 HP, dies at 0

describe('MCV death / survivability (techno.cpp)', () => {
  it('MCV survives massive damage that leaves HP > 0', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    mcv.takeDamage(599, 'AP');
    expect(mcv.alive).toBe(true);
    expect(mcv.hp).toBe(1);
  });

  it('MCV dies when damage reduces HP to 0', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    const killed = mcv.takeDamage(600, 'AP');
    expect(killed).toBe(true);
    expect(mcv.alive).toBe(false);
    expect(mcv.hp).toBe(0);
    expect(mcv.mission).toBe(Mission.DIE);
    expect(mcv.animState).toBe(AnimState.DIE);
  });

  it('MCV does not take damage when invulnerable (Iron Curtain)', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    mcv.ironCurtainTick = 100;
    mcv.takeDamage(600, 'AP');
    expect(mcv.alive).toBe(true);
    expect(mcv.hp).toBe(600);
  });

  it('MCV is not infantry — no fear system, no prone', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    mcv.takeDamage(100, 'AP');
    expect(mcv.fear).toBe(0); // fear only increases for infantry
    expect(mcv.isProne).toBe(false);
  });
});

// ── Vehicle Animation (unit.cpp) ─────────────────────────────────────────────
// C++ unit.cpp — MCV uses vehicle sprite system (32-frame body rotation)

describe('MCV vehicle animation (unit.cpp)', () => {
  it('MCV isInfantry = false', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    expect(mcv.stats.isInfantry).toBe(false);
  });

  it('MCV isAnt = false', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    expect(mcv.isAnt).toBe(false);
  });

  it('MCV spriteFrame uses vehicle body rotation (not infantry or ant)', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    const frame = mcv.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('MCV starts in IDLE animState', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    expect(mcv.alive).toBe(true);
    expect(mcv.animState).toBe(AnimState.IDLE);
  });
});

// ── Faction Availability (rules.ini Owner=) ──────────────────────────────────
// C++ rules.ini [MCV] Owner=allies,soviet — both factions can own MCV

describe('MCV faction availability (rules.ini)', () => {
  it('MCV can be created for Allied house (Spain)', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    expect(mcv.house).toBe(House.Spain);
    expect(mcv.hp).toBe(600);
  });

  it('MCV can be created for Soviet house (USSR)', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.USSR, 10, 10);
    expect(mcv.house).toBe(House.USSR);
    expect(mcv.hp).toBe(600);
  });
});

// ── Harvester Contrast (same HP, different armor) ────────────────────────────
// Highlights the key design difference: MCV and HARV both have 600 HP but
// MCV has light armor while HARV has heavy armor, giving different survivability profiles.

describe('MCV vs Harvester — same HP, different armor (rules.ini contrast)', () => {
  it('both have 600 HP', () => {
    expect(UNIT_STATS.MCV.strength).toBe(600);
    expect(UNIT_STATS.HARV.strength).toBe(600);
  });

  it('MCV has light armor, Harvester has heavy armor', () => {
    expect(UNIT_STATS.MCV.armor).toBe('light');
    expect(UNIT_STATS.HARV.armor).toBe('heavy');
  });

  it('Harvester is a crusher but MCV is not (rules.ini parity)', () => {
    expect(UNIT_STATS.MCV.crusher).toBeFalsy();
    expect(UNIT_STATS.HARV.crusher).toBe(true);
  });

  it('same speed (6)', () => {
    expect(UNIT_STATS.MCV.speed).toBe(6);
    expect(UNIT_STATS.HARV.speed).toBe(6);
  });

  it('MCV takes more SA damage than Harvester (light 0.6 > heavy 0.25)', () => {
    const saVsLight = WARHEAD_VS_ARMOR.SA[armorIndex('light')];
    const saVsHeavy = WARHEAD_VS_ARMOR.SA[armorIndex('heavy')];
    expect(saVsLight).toBeGreaterThan(saVsHeavy);
  });
});
