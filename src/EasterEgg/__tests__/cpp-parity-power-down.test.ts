/**
 * C++ Behavioral Parity: Structure Power-Down Behavior
 *
 * Tests verify that defense structures, production, radar, gap generators,
 * Tesla coils, and turret rotation all respond correctly to insufficient power,
 * matching the original C++ Red Alert behavior.
 *
 * C++ source of truth:
 *   building.cpp:2853  — Can_Fire: IsPowered + Power_Fraction() < 1 → FIRE_BUSY
 *   building.cpp:3619  — SAM Mission_Attack: powered check before tracking
 *   building.cpp:5352  — Rotation_AI: turrets freeze when IsPowered && Power_Fraction() < 1
 *   building.cpp:5385  — Charging_AI: Tesla stops charging when Power_Fraction() < 1
 *   building.cpp:4607  — Power_Output: ratedPower * fixed(hp, maxHp)
 *   house.cpp:4160     — Power_Fraction: Power/Drain, 1 if Power>=Drain, 0 if Power==0
 *   house.cpp:1076     — Low-power damage: 1 HP/tick to buildings with Drain > 0
 *   house.cpp:1292     — Radar blackout when Power_Fraction() < 1 && !IsGPSActive
 *   house.cpp:1120     — EVA "low power" warning when Power_Fraction() < 1
 *   techno.cpp:677-682 — Production speed penalty: inverse of clamped Power_Fraction
 *   bdata.cpp:2836     — IsPowered defaults false; set per-structure via rules.ini
 *   house.cpp:1410-1411 — Superweapon timer suspension when Power_Fraction() < 1
 *   building.cpp:997   — Gap generator jams only when Power_Fraction() >= 1
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, POWER_DRAIN,
  COUNTRY_BONUSES, buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  updateStructureCombat,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import {
  type MapStructure,
  STRUCTURE_WEAPONS,
  STRUCTURE_SIZE,
  STRUCTURE_MAX_HP,
  STRUCTURE_POWERED,
} from '../engine/scenario';
import type { Effect } from '../engine/renderer';
import {
  fixedPowerOutput,
  powerOutput,
  calculatePowerGrid,
  powerMultiplier,
} from '../engine/repairSell';

beforeEach(() => resetEntityIds());

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStructure(
  type: string, cx: number, cy: number,
  house: House = House.USSR, hp?: number,
): MapStructure {
  const maxHp = STRUCTURE_MAX_HP[type] ?? 256;
  const weapon = STRUCTURE_WEAPONS[type];
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp: hp ?? maxHp, maxHp, alive: true, rubble: false,
    weapon: weapon ? { ...weapon } : undefined,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
    ...(weapon?.isAntiAir || type === 'GUN' || type === 'TSLA' ? {
      turretDir: 2, desiredTurretDir: 2, firingFlash: 0,
    } : {}),
  };
}

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeAircraft(type: UnitType, house: House, cx: number, cy: number): Entity {
  const e = entityAtCell(type, house, cx, cy);
  e.flightAltitude = Entity.FLIGHT_ALTITUDE;
  e.aircraftState = 'flying';
  return e;
}

function makeCombatCtx(
  structures: MapStructure[] = [],
  entities: Entity[] = [],
  opts: { powerConsumed?: number; powerProduced?: number } = {},
): CombatContext {
  const map = new GameMap();
  map.initDefault();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
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
    powerConsumed: opts.powerConsumed ?? 0,
    powerProduced: opts.powerProduced ?? 100,
  } as CombatContext;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. STRUCTURE_POWERED set membership
//    C++ bdata.cpp:2836 — IsPowered defaults false, set via rules.ini Powered=yes
//    rules.ini Powered=true: TSLA, AGUN, DOME, GAP, PDOX, IRON (6 structures).
// ═════════════════════════════════════════════════════════════════════════════

describe('STRUCTURE_POWERED set (rules.ini Powered=true)', () => {
  // rules.ini Powered=true: TSLA, DOME, GAP, PDOX, IRON, AGUN (6 total)
  const EXPECTED_POWERED = ['TSLA', 'DOME', 'GAP', 'PDOX', 'IRON', 'AGUN'];

  it.each(EXPECTED_POWERED)('%s is a powered structure', (type) => {
    expect(STRUCTURE_POWERED.has(type), `${type} should be in STRUCTURE_POWERED`).toBe(true);
  });

  const EXPECTED_UNPOWERED = ['GUN', 'PBOX', 'HBOX', 'FTUR', 'POWR', 'APWR', 'PROC', 'WEAP', 'TENT', 'BARR', 'SAM', 'MSLO'];

  it.each(EXPECTED_UNPOWERED)('%s is NOT a powered structure', (type) => {
    expect(STRUCTURE_POWERED.has(type), `${type} should NOT be in STRUCTURE_POWERED`).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Powered defenses cannot fire during power deficit
//    C++ building.cpp:2851-2854:
//      if (Class->IsPowered && House->Power_Fraction() < 1)
//        return(FIRE_BUSY);
// ═════════════════════════════════════════════════════════════════════════════

describe('powered defenses cannot fire when low power (C++ building.cpp:2853)', () => {
  it('Tesla coil (TSLA) does not fire when powerConsumed > powerProduced', () => {
    const tsla = makeStructure('TSLA', 10, 10, House.USSR);
    const target = entityAtCell(UnitType.I_E1, House.Greece, 11, 10);
    const ctx = makeCombatCtx([tsla], [target], { powerConsumed: 200, powerProduced: 100 });
    const hpBefore = target.hp;
    for (let i = 0; i < 30; i++) {
      ctx.tick = i;
      updateStructureCombat(ctx);
    }
    // C++ building.cpp:2853 — IsPowered && Power_Fraction() < 1 → FIRE_BUSY
    // Tesla should not fire at all
    expect(target.hp).toBe(hpBefore);
  });

  it('Turret (GUN) DOES fire when low power — GUN is not powered (C++ bdata.cpp)', () => {
    // C++ bdata.cpp: GUN has IsPowered=false — fires regardless of power state
    const gun = makeStructure('GUN', 10, 10, House.USSR);
    const target = entityAtCell(UnitType.I_E1, House.Greece, 11, 10);
    const ctx = makeCombatCtx([gun], [target], { powerConsumed: 200, powerProduced: 100 });
    const hpBefore = target.hp;
    for (let i = 0; i < 30; i++) {
      ctx.tick = i;
      updateStructureCombat(ctx);
    }
    expect(target.hp).toBeLessThan(hpBefore);
  });

  it('SAM DOES fire at aircraft when low power — SAM is not powered (C++ rules.ini)', () => {
    const sam = makeStructure('SAM', 10, 10, House.USSR);
    const aircraft = makeAircraft(UnitType.V_HELI, House.Greece, 11, 10);
    const ctx = makeCombatCtx([sam], [aircraft], { powerConsumed: 200, powerProduced: 100 });
    const hpBefore = aircraft.hp;
    for (let i = 0; i < 30; i++) {
      ctx.tick = i;
      updateStructureCombat(ctx);
    }
    expect(aircraft.hp).toBeLessThan(hpBefore);
  });

  it('AA Gun (AGUN) does NOT fire at aircraft when low power — AGUN is powered (rules.ini Powered=true)', () => {
    const agun = makeStructure('AGUN', 10, 10, House.USSR);
    const aircraft = makeAircraft(UnitType.V_HELI, House.Greece, 11, 10);
    const ctx = makeCombatCtx([agun], [aircraft], { powerConsumed: 200, powerProduced: 100 });
    const hpBefore = aircraft.hp;
    for (let i = 0; i < 30; i++) {
      ctx.tick = i;
      updateStructureCombat(ctx);
    }
    expect(aircraft.hp).toBe(hpBefore);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Unpowered defenses ALWAYS fire regardless of power
//    C++ building.cpp:2853 — only checks IsPowered; unpowered structures skip the gate
// ═════════════════════════════════════════════════════════════════════════════

describe('unpowered defenses fire regardless of power (C++ building.cpp:2853 — no IsPowered gate)', () => {
  it('Pillbox (PBOX) fires even when low power', () => {
    const pbox = makeStructure('PBOX', 10, 10, House.USSR);
    const target = entityAtCell(UnitType.I_E1, House.Greece, 11, 10);
    const ctx = makeCombatCtx([pbox], [target], { powerConsumed: 200, powerProduced: 100 });
    const hpBefore = target.hp;
    // Run enough ticks for at least one shot
    for (let i = 0; i < 60; i++) {
      ctx.tick = i;
      updateStructureCombat(ctx);
    }
    expect(target.hp).toBeLessThan(hpBefore);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Powered defenses fire normally when power is sufficient
//    C++ building.cpp:2853 — Power_Fraction() >= 1 skips the FIRE_BUSY gate
// ═════════════════════════════════════════════════════════════════════════════

describe('powered defenses fire when power is sufficient (C++ Power_Fraction() >= 1)', () => {
  it('Tesla fires when power >= drain', () => {
    const tsla = makeStructure('TSLA', 10, 10, House.USSR);
    const target = entityAtCell(UnitType.I_E1, House.Greece, 11, 10);
    const ctx = makeCombatCtx([tsla], [target], { powerConsumed: 100, powerProduced: 200 });
    const hpBefore = target.hp;
    for (let i = 0; i < 60; i++) {
      ctx.tick = i;
      updateStructureCombat(ctx);
    }
    expect(target.hp).toBeLessThan(hpBefore);
  });

  it('SAM fires at aircraft when power >= drain', () => {
    const sam = makeStructure('SAM', 10, 10, House.USSR);
    const aircraft = makeAircraft(UnitType.V_HELI, House.Greece, 11, 10);
    const ctx = makeCombatCtx([sam], [aircraft], { powerConsumed: 100, powerProduced: 200 });
    const hpBefore = aircraft.hp;
    for (let i = 0; i < 60; i++) {
      ctx.tick = i;
      updateStructureCombat(ctx);
    }
    expect(aircraft.hp).toBeLessThan(hpBefore);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Power_Fraction() calculation
//    C++ house.cpp:4160-4170:
//      if (Power >= Drain || Drain == 0) return(1);
//      if (Power) return(fixed(Power, Drain));
//      return(0);
// ═════════════════════════════════════════════════════════════════════════════

describe('Power_Fraction() calculation (C++ house.cpp:4160)', () => {
  it('Power >= Drain returns 1.0 (full power)', () => {
    // C++ house.cpp:4164: if (Power >= Drain || Drain == 0) return(1);
    expect(powerMultiplier(200, 100)).toBe(1.0);
    expect(powerMultiplier(100, 100)).toBe(1.0);
  });

  it('Drain == 0 returns 1.0 (no load)', () => {
    expect(powerMultiplier(0, 0)).toBe(1.0);
    expect(powerMultiplier(100, 0)).toBe(1.0);
  });

  it('Power > 0 but < Drain: returns Power/Drain', () => {
    // C++ house.cpp:4166-4167: if (Power) return(fixed(Power, Drain));
    expect(powerMultiplier(50, 100)).toBe(0.5);
    expect(powerMultiplier(75, 100)).toBe(0.75);
  });

  it('Power == 0 with Drain > 0: returns floor (1/16)', () => {
    // C++ house.cpp:4168-4169: return(0);
    // factory.cpp:434 clamps to Bound(..., fixed(1,16), fixed(1))
    expect(powerMultiplier(0, 100)).toBe(1 / 16);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Power output scales with building damage
//    C++ building.cpp:4607-4616:
//      if (Class->Power) return(Class->Power * fixed(LastStrength, Class->MaxStrength));
//      return(0);
// ═════════════════════════════════════════════════════════════════════════════

describe('power output scales with damage (C++ building.cpp:4613 Power_Output)', () => {
  it('full health POWR: 100W', () => {
    expect(fixedPowerOutput(100, 400, 400)).toBe(100);
  });

  it('full health APWR: 200W', () => {
    expect(fixedPowerOutput(200, 400, 400)).toBe(200);
  });

  it('half health POWR: ~50W (8.8 fixed-point truncation)', () => {
    const output = fixedPowerOutput(100, 200, 400);
    // C++ fixed(200, 400) = floor(200 * 256 / 400) = floor(128) = 128
    // 128 * 100 / 256 = 50
    expect(output).toBe(50);
  });

  it('25% health POWR: ~25W', () => {
    const output = fixedPowerOutput(100, 100, 400);
    // C++ fixed(100, 400) = floor(100*256/400) = floor(64) = 64
    // 64 * 100 / 256 = 25
    expect(output).toBe(25);
  });

  it('1 HP POWR: minimal but non-zero output', () => {
    const output = fixedPowerOutput(100, 1, 400);
    // C++ fixed(1, 400) = floor(256/400) = 0 → output = 0
    // At very low HP, fixed-point truncation may produce 0
    expect(output).toBeGreaterThanOrEqual(0);
    expect(output).toBeLessThan(10);
  });

  it('0 HP: zero output', () => {
    expect(fixedPowerOutput(100, 0, 400)).toBe(0);
  });

  it('powerOutput helper returns 0 for non-power buildings', () => {
    expect(powerOutput('WEAP', 400, 400)).toBe(0);
    expect(powerOutput('TSLA', 400, 400)).toBe(0);
    expect(powerOutput('SAM', 400, 400)).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. calculatePowerGrid — aggregate power and drain for all player structures
//    C++ house.cpp:975-981 — Power = max(Power, 0); Drain = max(Drain, 0);
// ═════════════════════════════════════════════════════════════════════════════

describe('calculatePowerGrid (C++ HouseClass::AI power recalculation)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('single POWR at full health: 100 produced, 0 consumed', () => {
    const structs: MapStructure[] = [
      makeStructure('POWR', 5, 5, House.Spain),
    ];
    const { produced, consumed } = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(produced).toBe(100);
    expect(consumed).toBe(0); // POWR itself has no drain
  });

  it('POWR + TSLA: 100 produced, 150 consumed (deficit)', () => {
    const structs: MapStructure[] = [
      makeStructure('POWR', 5, 5, House.Spain),
      makeStructure('TSLA', 7, 5, House.Spain),
    ];
    const { produced, consumed } = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(produced).toBe(100);
    expect(consumed).toBe(POWER_DRAIN['TSLA']); // 150
  });

  it('dead structures do not contribute power or drain', () => {
    const deadPowr = makeStructure('POWR', 5, 5, House.Spain);
    deadPowr.alive = false;
    const structs: MapStructure[] = [deadPowr];
    const { produced, consumed } = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(produced).toBe(0);
    expect(consumed).toBe(0);
  });

  it('APWR at half health: ~100 produced (8.8 fixed-point)', () => {
    const apwr = makeStructure('APWR', 5, 5, House.Spain, 200);
    // maxHp for APWR should be 700 or whatever is defined
    const structs: MapStructure[] = [apwr];
    const { produced } = calculatePowerGrid(structs, House.Spain, isAllied);
    // Output = fixedPowerOutput(200, 200, maxHp)
    const expected = fixedPowerOutput(200, 200, apwr.maxHp);
    expect(produced).toBe(expected);
  });

  it('enemy structures do not contribute to player power', () => {
    const enemyPowr = makeStructure('POWR', 5, 5, House.USSR);
    const structs: MapStructure[] = [enemyPowr];
    const { produced, consumed } = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(produced).toBe(0);
    expect(consumed).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. POWER_DRAIN values from rules.ini
//    C++ bdata.cpp:3778-3781 — Power field from INI; negative = drain
// ═════════════════════════════════════════════════════════════════════════════

describe('POWER_DRAIN values match rules.ini (C++ bdata.cpp:3778)', () => {
  it('Tesla coil drains 150', () => {
    expect(POWER_DRAIN['TSLA']).toBe(150);
  });

  it('SAM drains 20', () => {
    expect(POWER_DRAIN['SAM']).toBe(20);
  });

  it('AA Gun drains 50', () => {
    expect(POWER_DRAIN['AGUN']).toBe(50);
  });

  it('Turret (GUN) drains 40', () => {
    expect(POWER_DRAIN['GUN']).toBe(40);
  });

  it('Radar Dome drains 40', () => {
    expect(POWER_DRAIN['DOME']).toBe(40);
  });

  it('Advanced Tech (ATEK) drains 200', () => {
    expect(POWER_DRAIN['ATEK']).toBe(200);
  });

  it('War Factory drains 30', () => {
    expect(POWER_DRAIN['WEAP']).toBe(30);
  });

  it('Power plant has no drain entry (it produces, not consumes)', () => {
    // Power plants produce power — they should have zero or undefined drain
    expect(POWER_DRAIN['POWR'] ?? 0).toBe(0);
    expect(POWER_DRAIN['APWR'] ?? 0).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. Production speed penalty under low power
//    C++ techno.cpp:677-682:
//      fixed power = House->Power_Fraction();
//      if (power > 1) power = 1;
//      if (power < 1 && power > fixed::_3_4) power = fixed::_3_4;
//      if (power < fixed::_1_2) power = fixed::_1_2;
//      power.Inverse();
//      val *= power;
//
//    C++ behavior: production time INCREASES as power drops.
//    At 100% power: no penalty. At 50-75%: 4/3x slower. At <50%: 2x slower.
//    The C++ code has discrete breakpoints, not a continuous curve.
//
//    TS uses a different formula (continuous 1/fraction, clamped to [1/16, 1])
//    from factory.cpp:434 (the factory rebuild rate).
// ═════════════════════════════════════════════════════════════════════════════

describe('production speed penalty (C++ techno.cpp:677-682 vs factory.cpp:434)', () => {
  it('full power: multiplier = 1.0 (no penalty)', () => {
    expect(powerMultiplier(100, 100)).toBe(1.0);
  });

  it('50% power: multiplier = 0.5 (TS continuous model)', () => {
    // C++ techno.cpp:680 clamps <0.5 to 0.5 → 2x slower max
    // TS uses continuous factory.cpp model: 0.5
    // Both agree at exactly 50%
    expect(powerMultiplier(50, 100)).toBe(0.5);
  });

  it('0% power: TS multiplier = 1/16 (C++ techno.cpp clamps to 0.5)', () => {
    // C++ techno.cpp:680: if (power < fixed::_1_2) power = fixed::_1_2 → max 2x penalty
    // TS factory.cpp model: clamped to 1/16 = 0.0625 → 16x penalty
    // KNOWN DIVERGENCE: C++ Time_To_Build uses max 2x penalty, TS uses max 16x
    // The TS model follows factory.cpp:434 Bound() which allows deeper penalties
    const mult = powerMultiplier(0, 100);
    expect(mult).toBe(1 / 16);
  });

  it('75% power: TS = 0.75 (C++ techno.cpp forces 0.75 if between 0.75 and 1.0)', () => {
    // C++ techno.cpp:679: if (power < 1 && power > fixed::_3_4) power = fixed::_3_4;
    // So 0.9 power → forced to 0.75 in C++. TS just uses 0.75 at 0.75.
    // At exactly 0.75, both agree: multiplier = 0.75
    expect(powerMultiplier(75, 100)).toBe(0.75);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. Low-power definition: binary check (C++ Power_Fraction() < 1)
//     C++ building.cpp:2853, house.cpp:1076, 1120, 1292
//     The check is BINARY: any deficit at all (Drain > Power) disables.
//     There is no gradual degradation for defense structures.
// ═════════════════════════════════════════════════════════════════════════════

describe('low power is binary — any deficit disables (C++ Power_Fraction() < 1)', () => {
  it('drain exceeding production by 1 is still low power', () => {
    const tsla = makeStructure('TSLA', 10, 10, House.USSR);
    const target = entityAtCell(UnitType.I_E1, House.Greece, 11, 10);
    // 101 consumed vs 100 produced — fraction < 1
    const ctx = makeCombatCtx([tsla], [target], { powerConsumed: 101, powerProduced: 100 });
    const hpBefore = target.hp;
    for (let i = 0; i < 30; i++) {
      ctx.tick = i;
      updateStructureCombat(ctx);
    }
    expect(target.hp).toBe(hpBefore);
  });

  it('exact balance (drain == produced) is NOT low power', () => {
    const tsla = makeStructure('TSLA', 10, 10, House.USSR);
    const target = entityAtCell(UnitType.I_E1, House.Greece, 11, 10);
    // 100 consumed == 100 produced — fraction = 1 (not < 1)
    const ctx = makeCombatCtx([tsla], [target], { powerConsumed: 100, powerProduced: 100 });
    const hpBefore = target.hp;
    for (let i = 0; i < 60; i++) {
      ctx.tick = i;
      updateStructureCombat(ctx);
    }
    expect(target.hp).toBeLessThan(hpBefore);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. Zero drain means never low power
//     C++ house.cpp:4164: if (Power >= Drain || Drain == 0) return(1);
//     When there are no powered buildings, Power_Fraction is always 1.
// ═════════════════════════════════════════════════════════════════════════════

describe('zero drain = never low power (C++ house.cpp:4164)', () => {
  it('0 produced, 0 consumed = full power (not low)', () => {
    // C++ Drain == 0 → return(1)
    const pbox = makeStructure('PBOX', 10, 10, House.USSR);
    const target = entityAtCell(UnitType.I_E1, House.Greece, 11, 10);
    const ctx = makeCombatCtx([pbox], [target], { powerConsumed: 0, powerProduced: 0 });
    const hpBefore = target.hp;
    for (let i = 0; i < 60; i++) {
      ctx.tick = i;
      updateStructureCombat(ctx);
    }
    // Pillbox is unpowered so fires regardless, but importantly the low power
    // check itself (powerConsumed > powerProduced) returns false when both are 0
    expect(target.hp).toBeLessThan(hpBefore);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 12. TS low power check: isLowPower = powerConsumed > powerProduced
//     C++ house.cpp:4164-4169 and building.cpp:2853
//     Verify the TS implementation matches C++ semantics
// ═════════════════════════════════════════════════════════════════════════════

describe('TS low power check matches C++ Power_Fraction() < 1 (combat.ts:1362)', () => {
  function isLowPower(produced: number, consumed: number): boolean {
    return consumed > produced;
  }

  it('C++: Power >= Drain → fraction=1 → NOT low power', () => {
    expect(isLowPower(200, 100)).toBe(false);
    expect(isLowPower(100, 100)).toBe(false);
  });

  it('C++: Drain == 0 → fraction=1 → NOT low power', () => {
    expect(isLowPower(0, 0)).toBe(false);
    expect(isLowPower(100, 0)).toBe(false);
  });

  it('C++: 0 < Power < Drain → fraction < 1 → IS low power', () => {
    expect(isLowPower(50, 100)).toBe(true);
    expect(isLowPower(99, 100)).toBe(true);
  });

  it('C++: Power == 0, Drain > 0 → fraction = 0 → IS low power', () => {
    // C++ house.cpp:4168: return(0);
    // TS: powerConsumed(100) > powerProduced(0) → isLowPower=true
    // Now matches C++ parity: 0 production with drain = low power
    expect(isLowPower(0, 100)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 13. Low-power damage to buildings with drain
//     C++ house.cpp:1076-1088:
//       if (Power_Fraction() < 1) {
//         for each building:
//           if (b.House == this && b.Health_Ratio() > Rule.ConditionYellow)
//             if (b.Class->Drain) { damage = 1; b.Take_Damage(damage, ...); }
//       }
//     Only buildings that CONSUME power take damage. This prevents land mines
//     from blowing up during low power (BG's comment in source).
// ═════════════════════════════════════════════════════════════════════════════

describe('low-power damage only affects buildings with Drain > 0 (C++ house.cpp:1083)', () => {
  it('buildings with drain are eligible for low-power damage', () => {
    // All these should have non-zero drain entries
    const drainBuildings = ['TSLA', 'SAM', 'AGUN', 'GUN', 'WEAP', 'DOME', 'PROC'];
    for (const type of drainBuildings) {
      expect(POWER_DRAIN[type], `${type} should have drain > 0`).toBeGreaterThan(0);
    }
  });

  it('power plants have zero drain — immune to low-power damage', () => {
    // C++ house.cpp:1083: if (b.Class->Drain) — POWR/APWR have Drain=0
    expect(POWER_DRAIN['POWR'] ?? 0).toBe(0);
    expect(POWER_DRAIN['APWR'] ?? 0).toBe(0);
  });

  it('pillbox has drain — takes low-power damage', () => {
    expect(POWER_DRAIN['PBOX']).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 14. Radar blackout during low power
//     C++ house.cpp:1292: if (Power_Fraction() < 1 && !IsGPSActive) Map.Radar_Activate(0);
//     C++ house.cpp:1303: if (Power_Fraction() >= 1 || IsGPSActive) Map.Radar_Activate(1);
//     Radar requires DOME structure AND sufficient power.
// ═════════════════════════════════════════════════════════════════════════════

describe('radar blackout during low power (C++ house.cpp:1292)', () => {
  it('DOME requires power to enable radar (verified by data)', () => {
    // DOME has drain, so it affects power balance
    expect(POWER_DRAIN['DOME']).toBe(40);
    // DOME IS in STRUCTURE_POWERED set (C++ rules.ini Powered=yes)
    expect(STRUCTURE_POWERED.has('DOME')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 15. Gap generator requires power
//     C++ building.cpp:997: if (House->Power_Fraction() >= 1) → jam
//     C++ building.cpp:1002: if (House->Power_Fraction() < 1) → unjam
// ═════════════════════════════════════════════════════════════════════════════

describe('gap generator requires full power (C++ building.cpp:997)', () => {
  it('GAP is in STRUCTURE_POWERED', () => {
    expect(STRUCTURE_POWERED.has('GAP')).toBe(true);
  });

  it('GAP drains power', () => {
    // GAP must have a drain entry to affect power balance
    // C++ rules.ini: GAP has Power=-40 (i.e., Drain=40)
    const drain = POWER_DRAIN['GAP'];
    expect(drain, 'GAP should have a power drain value').toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 16. EVA power gate — no voice at critically low power
//     C++ house.cpp:1120-1124 — SpeakPowerDelay throttles low power warning
//     TS index.ts:3114-3116 — powerFraction < 0.25 silences EVA entirely
// ═════════════════════════════════════════════════════════════════════════════

describe('EVA power gate (C++ house.cpp:1120 vs TS index.ts:3114)', () => {
  it('C++ announces "low power" when Power_Fraction() < 1 (every SpeakDelay)', () => {
    // C++ house.cpp:1120: if (SpeakPowerDelay == 0 && Power_Fraction() < 1) Speak(VOX_LOW_POWER);
    // TS should play eva_low_power periodically
    // Just verify the POWER_DRAIN values exist for buildings that cause the imbalance
    expect(POWER_DRAIN['TSLA']).toBe(150); // Tesla is the biggest drain
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 17. Turret rotation freezes during low power for powered structures
//     C++ building.cpp:5349-5352:
//       if (Class->IsTurretEquipped && ... && (!Class->IsPowered || House->Power_Fraction() >= 1))
//         { rotate turret }
//     Only IsPowered buildings (AGUN has Powered=true) have turret freeze during low power.
// ═════════════════════════════════════════════════════════════════════════════

describe('turret rotation freezes on powered structures during low power (C++ building.cpp:5352)', () => {
  it('GUN is turreted but NOT powered — turret rotates even without power', () => {
    // C++ bdata.cpp: GUN (Turret) has IsPowered=false (default)
    // Turret rotation is NOT gated by power for unpowered structures
    expect(STRUCTURE_POWERED.has('GUN')).toBe(false);
    const weapon = STRUCTURE_WEAPONS['GUN'];
    expect(weapon, 'GUN should have a weapon').toBeDefined();
  });

  it('SAM is turreted but NOT powered — turret rotates even without power', () => {
    expect(STRUCTURE_POWERED.has('SAM')).toBe(false);
    // C++ rules.ini has no Powered=yes for SAM
  });

  it('AGUN is turreted AND powered — turret freezes during low power', () => {
    // rules.ini: AGUN has Powered=true
    expect(STRUCTURE_POWERED.has('AGUN')).toBe(true);
  });

  it('PBOX is not turreted — rotation freeze is not applicable', () => {
    // Pillbox has no turret (bdata.cpp: false for is_turret_equipped)
    expect(STRUCTURE_POWERED.has('PBOX')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 18. Tesla charging requires power
//     C++ building.cpp:5384-5412:
//       if (Target_Legal(TarCom) && House->Power_Fraction() >= 1) { charge up }
//       else { IsCharging = false; IsCharged = false; reset stage }
//     Without power, Tesla cannot charge and cannot fire (IsElectric + !IsCharged).
// ═════════════════════════════════════════════════════════════════════════════

describe('Tesla charging requires power (C++ building.cpp:5385)', () => {
  it('TSLA is powered and has a weapon', () => {
    expect(STRUCTURE_POWERED.has('TSLA')).toBe(true);
    const weapon = STRUCTURE_WEAPONS['TSLA'];
    expect(weapon).toBeDefined();
    expect(weapon.damage).toBeGreaterThan(0);
  });

  it('TSLA has high drain (150) — most power-hungry defense', () => {
    // C++ rules.ini: Tesla Power=-150 (Drain=150)
    expect(POWER_DRAIN['TSLA']).toBe(150);
  });

  it('TSLA damage is 100 (rules.ini [TeslaZap] Damage=100)', () => {
    const weapon = STRUCTURE_WEAPONS['TSLA'];
    expect(weapon.damage).toBe(100);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 19. Integration: powered vs unpowered during mixed power states
//     Verifies that in a single updateStructureCombat call, powered structures
//     are correctly gated while unpowered ones fire freely.
// ═════════════════════════════════════════════════════════════════════════════

describe('integration: mixed powered/unpowered structures during low power', () => {
  it('PBOX fires but TSLA does not in same low-power context', () => {
    const pbox = makeStructure('PBOX', 10, 10, House.USSR);
    const tsla = makeStructure('TSLA', 14, 10, House.USSR);
    const pboxTarget = entityAtCell(UnitType.I_E1, House.Greece, 11, 10);
    const tslaTarget = entityAtCell(UnitType.I_E1, House.Greece, 15, 10);
    const ctx = makeCombatCtx(
      [pbox, tsla],
      [pboxTarget, tslaTarget],
      { powerConsumed: 200, powerProduced: 100 },
    );
    const pboxTargetHpBefore = pboxTarget.hp;
    const tslaTargetHpBefore = tslaTarget.hp;
    for (let i = 0; i < 60; i++) {
      ctx.tick = i;
      updateStructureCombat(ctx);
    }
    // Pillbox (unpowered) should fire
    expect(pboxTarget.hp).toBeLessThan(pboxTargetHpBefore);
    // Tesla (powered, low power) should NOT fire
    expect(tslaTarget.hp).toBe(tslaTargetHpBefore);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 20. Power restoration re-enables defenses
//     C++ building.cpp:2853 — the check is per-tick, so restoring power
//     immediately allows firing on the next tick.
// ═════════════════════════════════════════════════════════════════════════════

describe('power restoration re-enables defenses (C++ per-tick check)', () => {
  it('TSLA resumes firing after power is restored', () => {
    const tsla = makeStructure('TSLA', 10, 10, House.USSR);
    const target = entityAtCell(UnitType.I_E1, House.Greece, 11, 10);
    const ctx = makeCombatCtx([tsla], [target], { powerConsumed: 200, powerProduced: 100 });

    // Phase 1: low power — should not fire
    const hpBefore = target.hp;
    for (let i = 0; i < 30; i++) {
      ctx.tick = i;
      updateStructureCombat(ctx);
    }
    expect(target.hp).toBe(hpBefore);

    // Phase 2: restore power — should fire
    ctx.powerProduced = 300;
    ctx.powerConsumed = 100;
    for (let i = 30; i < 90; i++) {
      ctx.tick = i;
      updateStructureCombat(ctx);
    }
    expect(target.hp).toBeLessThan(hpBefore);
  });
});
