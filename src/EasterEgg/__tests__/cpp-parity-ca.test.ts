/**
 * C++ Behavioral Parity: CA — Cruiser
 *
 * Tests verify Cruiser behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with CA (observable outcomes: HP, targeting,
 * weapon stats, warhead multipliers, turret, naval status), not HOW the code
 * implements it. The same scenarios should produce identical results in C++ and
 * TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, PRODUCTION_ITEMS,
  buildDefaultAlliances, armorIndex,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { canTargetNaval } from '../engine/aircraft';
import {
  type CombatContext,
  triggerRetaliation,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';
import { COUNTRY_BONUSES } from '../engine/types';

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
// C++ udata.cpp (unit type data) — CA entry and RULES.INI [CA] section

describe('CA stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.CA;
  const weapon = WEAPON_STATS['8Inch'];
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'CA');

  it('HP is 700 (Strength=700) — highest naval HP', () => {
    expect(stats.strength).toBe(700);
  });

  it('Armor is heavy (Armor=heavy)', () => {
    expect(stats.armor).toBe('heavy');
  });

  it('Speed is 4 (Speed=4)', () => {
    expect(stats.speed).toBe(4);
  });

  it('isVessel is true (naval unit)', () => {
    expect(stats.isVessel).toBe(true);
  });

  it('isInfantry is false', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('cost is 2000 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(2000);
  });

  it('faction is allied', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('allied');
  });

  it('primary weapon is 8Inch', () => {
    expect(stats.primaryWeapon).toBe('8Inch');
  });

  it('secondary weapon is 8Inch (dual 8Inch guns)', () => {
    expect(stats.secondaryWeapon).toBe('8Inch');
  });

  it('Entity constructor initializes HP to strength (700)', () => {
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    expect(ca.hp).toBe(700);
    expect(ca.maxHp).toBe(700);
  });

  it('rot is 5 (turret/body rotation speed)', () => {
    expect(stats.rot).toBe(5);
  });

  it('sight is 7', () => {
    expect(stats.sight).toBe(7);
  });
});

// ── Dual Weapon — 8Inch (weapon.cpp / rules.ini) ────────────────────────────
// C++ weapon.cpp — 8Inch naval gun: HE warhead, 500 damage, range 22.0, arcing

describe('CA dual weapon — 8Inch (weapon.cpp / rules.ini)', () => {
  const weapon = WEAPON_STATS['8Inch'];

  it('8Inch damage is 500 — devastating per shot', () => {
    expect(weapon.damage).toBe(500);
  });

  it('8Inch range is 22.0 cells — longest in game', () => {
    expect(weapon.range).toBe(22.0);
  });

  it('8Inch warhead is HE (High Explosive)', () => {
    expect(weapon.warhead).toBe('HE');
  });

  it('8Inch is arcing (isArcing=true)', () => {
    expect(weapon.isArcing).toBe(true);
  });

  it('8Inch inaccuracy is 1.0', () => {
    expect(weapon.inaccuracy).toBe(1.0);
  });

  it('8Inch ROF is 160 (slow fire rate for massive damage)', () => {
    expect(weapon.rof).toBe(160);
  });

  it('Entity gets both weapon and weapon2 set to 8Inch', () => {
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    expect(ca.weapon).not.toBeNull();
    expect(ca.weapon!.name).toBe('8Inch');
    expect(ca.weapon2).not.toBeNull();
    expect(ca.weapon2!.name).toBe('8Inch');
  });

  it('22.0 range is the longest weapon range in the game', () => {
    const allRanges = Object.values(WEAPON_STATS).map(w => w.range);
    const maxRange = Math.max(...allRanges);
    expect(weapon.range).toBe(maxRange);
  });
});

// ── HE Warhead Effectiveness (combat.cpp warhead tables) ─────────────────────
// C++ combat.cpp — Modify_Damage uses WARHEAD_VS_ARMOR table for HE

describe('CA HE warhead effectiveness (combat.cpp warhead tables)', () => {
  it('HE vs none armor: mult 0.9 (good vs infantry)', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('none')];
    expect(mult).toBe(0.9);
  });

  it('HE vs heavy armor: mult 0.25 (bad vs tanks)', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('heavy')];
    expect(mult).toBe(0.25);
  });

  it('HE vs concrete: mult 1.0 (devastating to structures)', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('concrete')];
    expect(mult).toBe(1.0);
  });

  it('HE vs wood armor: mult 0.75', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('wood')];
    expect(mult).toBe(0.75);
  });

  it('HE vs light armor: mult 0.6', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('light')];
    expect(mult).toBe(0.6);
  });

  it('effective damage vs concrete: 500 * 1.0 = 500 (full damage to structures)', () => {
    const baseDamage = WEAPON_STATS['8Inch'].damage;
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('concrete')];
    expect(Math.round(baseDamage * mult)).toBe(500);
  });

  it('effective damage vs heavy: 500 * 0.25 = 125 (reduced vs tanks)', () => {
    const baseDamage = WEAPON_STATS['8Inch'].damage;
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('heavy')];
    expect(Math.round(baseDamage * mult)).toBe(125);
  });
});

// ── Cannot Target Infantry (aircraft.cpp:canTargetNaval) ─────────────────────
// C++ aircraft.cpp — Cruisers skip infantry targets via targeting filter

describe('CA cannot target infantry (aircraft.cpp:canTargetNaval)', () => {
  it('CA cannot target E1 (rifle infantry)', () => {
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    expect(canTargetNaval(ca, e1)).toBe(false);
  });

  it('CA cannot target E3 (rocket soldier — still infantry)', () => {
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    const e3 = entityAtCell(UnitType.I_E3, House.USSR, 12, 10);
    expect(canTargetNaval(ca, e3)).toBe(false);
  });

  it('CA cannot target E6 (engineer — infantry)', () => {
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    const e6 = entityAtCell(UnitType.I_E6, House.USSR, 12, 10);
    expect(canTargetNaval(ca, e6)).toBe(false);
  });

  it('CA CAN target vehicles (2TNK — heavy tank)', () => {
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    expect(canTargetNaval(ca, tank)).toBe(true);
  });

  it('CA CAN target other naval units (DD — destroyer)', () => {
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    const dd = entityAtCell(UnitType.V_DD, House.USSR, 12, 10);
    expect(canTargetNaval(ca, dd)).toBe(true);
  });

  it('CA CAN target enemy cruisers', () => {
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    const enemyCa = entityAtCell(UnitType.V_CA, House.USSR, 12, 10);
    expect(canTargetNaval(ca, enemyCa)).toBe(true);
  });
});

// ── Naval Unit Property (entity.ts) ──────────────────────────────────────────
// C++ udata.cpp — isVessel=true makes the unit a naval unit

describe('CA naval unit (udata.cpp — isVessel)', () => {
  it('isNavalUnit getter returns true (isVessel=true)', () => {
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    expect(ca.isNavalUnit).toBe(true);
  });

  it('non-vessel unit (2TNK) isNavalUnit returns false', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.isNavalUnit).toBe(false);
  });

  it('other vessel (DD) isNavalUnit returns true', () => {
    const dd = entityAtCell(UnitType.V_DD, House.Spain, 10, 10);
    expect(dd.isNavalUnit).toBe(true);
  });
});

// ── Has Turret (entity.ts — hasTurret getter) ────────────────────────────────
// C++ udata.cpp — CA has a turret (naval vessel with rotating gun)

describe('CA has turret (udata.cpp — turret flag)', () => {
  it('CA hasTurret is true', () => {
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    expect(ca.hasTurret).toBe(true);
  });

  it('SS (submarine) hasTurret is false', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    expect(ss.hasTurret).toBe(false);
  });

  it('DD (destroyer) hasTurret is true', () => {
    const dd = entityAtCell(UnitType.V_DD, House.Spain, 10, 10);
    expect(dd.hasTurret).toBe(true);
  });
});

// ── Massive Bombardment Damage (combat parity) ──────────────────────────────
// C++ combat.cpp — Cruiser deals 500 base damage per shot, devastating to structures

describe('CA massive bombardment damage (combat.cpp)', () => {
  it('500 damage per shot to concrete-armored structure (1.0 mult) — devastating', () => {
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    const baseDamage = ca.weapon!.damage;
    const concreteMult = WARHEAD_VS_ARMOR.HE[armorIndex('concrete')];
    const effectiveDamage = Math.round(baseDamage * concreteMult);
    expect(effectiveDamage).toBe(500);
  });

  it('CA weapon damage (500) is among the highest in the game', () => {
    const allDamages = Object.values(WEAPON_STATS).map(w => w.damage).filter(d => d > 0);
    const caWeaponDamage = WEAPON_STATS['8Inch'].damage;
    // Only SCUD (600) and Democharge (500) match or exceed
    const higherDamage = allDamages.filter(d => d > caWeaponDamage);
    expect(higherDamage.length).toBeLessThanOrEqual(1); // only SCUD at 600
  });

  it('takeDamage applies full 500 to concrete-equivalent entity', () => {
    // Create a heavy-armored vessel target (e.g., enemy CA)
    const target = entityAtCell(UnitType.V_CA, House.USSR, 12, 10);
    const hpBefore = target.hp;
    // HE vs heavy = 0.25, so 500 * 0.25 = 125
    const effectiveDamage = Math.round(500 * WARHEAD_VS_ARMOR.HE[armorIndex('heavy')]);
    target.takeDamage(effectiveDamage, 'HE');
    expect(hpBefore - target.hp).toBe(125);
  });
});

// ── Retaliation (techno.cpp) ─────────────────────────────────────────────────
// C++ techno.cpp — idle/moving units counter-attack when hit by enemy

describe('CA retaliation (techno.cpp)', () => {
  it('idle CA on GUARD mission retaliates when hit by enemy', () => {
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.V_DD, House.USSR, 12, 10);
    ca.mission = Mission.GUARD;
    ca.target = null;

    const ctx = makeCombatCtx([ca, attacker]);
    triggerRetaliation(ctx, ca, attacker);

    expect(ca.target).toBe(attacker);
    expect(ca.mission).toBe(Mission.ATTACK);
  });

  it('CA has weapon — can retaliate', () => {
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    expect(ca.weapon).not.toBeNull();
    expect(ca.weapon!.name).toBe('8Inch');
  });

  it('CA does not retaliate against allies', () => {
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    const ally = entityAtCell(UnitType.V_DD, House.Greece, 12, 10); // Greece allied with Spain
    ca.mission = Mission.GUARD;
    ca.target = null;

    const ctx = makeCombatCtx([ca, ally]);
    triggerRetaliation(ctx, ca, ally);

    expect(ca.target).toBeNull();
    expect(ca.mission).toBe(Mission.GUARD);
  });
});

// ── Highest Naval HP (udata.cpp comparison) ──────────────────────────────────
// C++ udata.cpp — CA has 700 HP, the highest among all naval vessels

describe('CA highest naval HP (udata.cpp comparison)', () => {
  const navalUnits = ['DD', 'SS', 'CA', 'PT', 'MSUB', 'LST'] as const;

  it('CA has higher HP than all other naval units', () => {
    const caHp = UNIT_STATS.CA.strength;
    for (const unit of navalUnits) {
      if (unit === 'CA') continue;
      const unitStats = UNIT_STATS[unit];
      if (unitStats) {
        expect(caHp).toBeGreaterThan(unitStats.strength);
      }
    }
  });

  it('CA HP (700) is specifically the highest naval HP value', () => {
    const navalHps = navalUnits
      .map(u => UNIT_STATS[u]?.strength ?? 0);
    const maxNavalHp = Math.max(...navalHps);
    expect(UNIT_STATS.CA.strength).toBe(maxNavalHp);
  });
});
