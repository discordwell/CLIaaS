/**
 * C++ parity test: Service Depot repair/rearm behavior.
 *
 * C++ source references:
 *   techno.cpp:973-1016  — RADIO_REPAIR handler (cost/step calc, funds check, minelayer rearm)
 *   techno.cpp:964-968   — RADIO_RELOAD handler (ammo refill)
 *   techno.cpp:6139-6145 — TechnoTypeClass::Repair_Cost() formula
 *   techno.cpp:6164-6170 — TechnoTypeClass::Repair_Step() formula
 *   building.cpp:3817-3987 — BuildingClass::Mission_Repair (service depot state machine)
 *   building.cpp:3860    — distance threshold 0x10 leptons (0x80 for fixed-wing aircraft)
 *   building.cpp:3891-3893 — repair only if Health_Ratio < ConditionGreen OR is minelayer
 *   building.cpp:3939-3977 — RADIO_REPAIR result handling (ROGER/CANT/ALL_DONE/NEGATIVE)
 *   rules.cpp:228-232    — RepairStep=5, URepairStep=5, RepairPercent=fixed(1,4), URepairPercent=fixed(1,4)
 *                           (overridden by rules.ini to URepairStep=10, URepairPercent=0.20)
 *   rules.cpp:233        — ConditionGreen=1 (100% health — repair proceeds while hp < maxHp)
 *
 * Key C++ behaviors tested:
 *   1. Repair cost = (Raw_Cost / (MaxStrength / URepairStep)) * URepairPercent, clamped min 1
 *   2. Each repair tick adds URepairStep HP, clamped to MaxStrength
 *   3. When hp reaches maxHp, C++ snaps Strength = MaxStrength (RADIO_ALL_DONE)
 *   4. Insufficient funds → RADIO_CANT → depot stops repairing (goes IDLE)
 *   5. Minelayer at depot: if ammo < maxAmmo, rearm to full immediately, SKIP repair (RADIO_NEGATIVE)
 *   6. Distance threshold: 0x10 leptons (~0.0625 cells) for ground units
 *   7. Full-health unit on depot: RADIO_NEGATIVE, no repair attempted
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  unitRepairCostPerStep,
  tickServiceDepot,
  type RepairSellContext,
} from '../engine/repairSell';
import {
  UREPAIR_STEP, UREPAIR_PERCENT, CELL_SIZE,
  Mission, House, UnitType,
  type ProductionItem,
} from '../engine/types';
import { Entity } from '../engine/entity';
import { type MapStructure } from '../engine/scenario';
import { type Effect } from '../engine/renderer';

// ---------------------------------------------------------------------------
// Test helpers — build minimal RepairSellContext and entities
// ---------------------------------------------------------------------------

function makeServiceDepot(cx: number, cy: number, house: House = House.Spain): MapStructure {
  return {
    type: 'FIX',
    image: 'fix',
    house,
    cx,
    cy,
    hp: 400,
    maxHp: 400,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
  };
}

/** Place entity at depot center (cx*24 + 24, cy*24 + 24) — exactly on depot */
function makeVehicleAtDepot(
  type: UnitType,
  depot: MapStructure,
  hp: number,
  maxHp: number,
  house: House = House.Spain,
): Entity {
  const sx = depot.cx * CELL_SIZE + CELL_SIZE;
  const sy = depot.cy * CELL_SIZE + CELL_SIZE;
  const e = new Entity(type, house, sx, sy);
  e.hp = hp;
  e.maxHp = maxHp;
  return e;
}

function makeCtx(overrides: Partial<RepairSellContext> = {}): RepairSellContext {
  return {
    structures: [],
    entities: [],
    credits: 10000,
    tick: 0,
    playerHouse: House.Spain,
    powerProduced: 100,
    powerConsumed: 100,
    repairingStructures: new Set(),
    scenarioProductionItems: [
      { type: '1TNK', name: 'Light Tank', cost: 700, buildTime: 120, prerequisite: 'WEAP', faction: 'allied', techLevel: 4 },
      { type: '2TNK', name: 'Med Tank', cost: 800, buildTime: 140, prerequisite: 'WEAP', faction: 'allied', techLevel: 6 },
      { type: '4TNK', name: 'Mammoth', cost: 1800, buildTime: 300, prerequisite: 'WEAP', faction: 'soviet', techLevel: 10 },
      { type: 'HARV', name: 'Harvester', cost: 1400, buildTime: 160, prerequisite: 'WEAP', faction: 'both', techLevel: 1 },
      { type: 'MNLY', name: 'Minelayer', cost: 800, buildTime: 120, prerequisite: 'WEAP', faction: 'both', techLevel: 3 },
      { type: 'ARTY', name: 'Artillery', cost: 600, buildTime: 120, prerequisite: 'WEAP', faction: 'soviet', techLevel: 5 },
      { type: 'APC', name: 'APC', cost: 800, buildTime: 120, prerequisite: 'WEAP', faction: 'both', techLevel: 2 },
    ] as ProductionItem[],
    effects: [],
    siloCapacity: 1000,
    gapGeneratorCells: new Map(),
    isAllied: (a, b) => a === b,
    isPlayerControlled: (e) => e.house === House.Spain,
    playEva: () => {},
    playSound: () => {},
    playSoundAt: () => {},
    clearStructureFootprint: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Repair cost per step formula (techno.cpp:6139-6145)
// ---------------------------------------------------------------------------

describe('C++ parity: unit repair cost formula (techno.cpp:6139-6145)', () => {
  // C++ formula for foot (unit) types:
  //   Repair_Cost = (Raw_Cost / (MaxStrength / URepairStep)) * URepairPercent
  //   Call site clamps: max(Repair_Cost(), 1) (techno.cpp:989)
  //
  // TS constants from rules.ini override:
  //   URepairStep = 10, URepairPercent = 0.20
  //   UREPAIR_PERCENT_RAW = floor(0.20 * 256) = 51
  //
  // Example: Light Tank (cost=700, maxHp=300)
  //   stepsToFull = trunc(300/10) = 30
  //   costPerFullStep = trunc(700/30) = 23
  //   fixedMul = trunc((51 * 23 + 128) / 256) = trunc((1173+128)/256) = trunc(5.08) = 5

  const UNIT_REPAIR_CASES = [
    { type: '1TNK', cost: 700,  maxHp: 300,  expected: 5 },
    { type: '2TNK', cost: 800,  maxHp: 400,  expected: 4 },
    { type: '4TNK', cost: 1800, maxHp: 600,  expected: 6 },
    { type: 'HARV', cost: 1400, maxHp: 600,  expected: 5 },
    { type: 'ARTY', cost: 600,  maxHp: 75,   expected: 17 },
    { type: 'APC',  cost: 800,  maxHp: 200,  expected: 8 },
  ];

  for (const { type, cost, maxHp, expected } of UNIT_REPAIR_CASES) {
    it(`${type} (cost=${cost}, maxHp=${maxHp}): repair cost per step = ${expected}`, () => {
      // Manually verify:
      const stepsToFull = Math.trunc(maxHp / UREPAIR_STEP);
      const costPerFullStep = Math.trunc(cost / stepsToFull);
      const raw = Math.floor(UREPAIR_PERCENT * 256); // 51
      const manualResult = Math.max(1, Math.trunc((raw * costPerFullStep + 128) / 256));
      expect(manualResult).toBe(expected);
      // TS implementation must match
      expect(unitRepairCostPerStep(cost, maxHp)).toBe(expected);
    });
  }

  it('cost is clamped to minimum 1 (techno.cpp:989: cost = max(cost, 1))', () => {
    // Very cheap unit with high HP: cost approaches 0
    // cost=10, maxHp=1000 → stepsToFull=100, costPerFullStep=0 → raw clamp=1
    expect(unitRepairCostPerStep(10, 1000)).toBe(1);
  });

  it('single-step unit: maxHp < URepairStep → guard clamp to 1', () => {
    // maxHp=5 with URepairStep=10 → stepsToFull = trunc(5/10) = 0 → guard returns 1
    expect(unitRepairCostPerStep(500, 5)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Repair step size (techno.cpp:6164-6170)
// ---------------------------------------------------------------------------

describe('C++ parity: unit repair step size (techno.cpp:6164-6170)', () => {
  it('URepairStep constant matches rules.ini override (default=5, rules.ini=10)', () => {
    // C++ rules.cpp:230 default = 5, overridden by rules.ini URepairStep=10
    expect(UREPAIR_STEP).toBe(10);
  });

  it('repair adds exactly URepairStep HP per tick', () => {
    const depot = makeServiceDepot(5, 5);
    const tank = makeVehicleAtDepot(UnitType.V_1TNK, depot, 100, 300);
    const ctx = makeCtx({
      structures: [depot],
      entities: [tank],
    });

    const hpBefore = tank.hp;
    tickServiceDepot(ctx);
    expect(tank.hp).toBe(hpBefore + UREPAIR_STEP);
  });

  it('hp is clamped to maxHp — never exceeds (techno.cpp:1009)', () => {
    // C++ sets Strength = MaxStrength when Health_Ratio >= ConditionGreen
    const depot = makeServiceDepot(5, 5);
    // HP is 295 (5 below max 300), so +10 step should clamp to 300
    const tank = makeVehicleAtDepot(UnitType.V_1TNK, depot, 295, 300);
    const ctx = makeCtx({
      structures: [depot],
      entities: [tank],
    });

    tickServiceDepot(ctx);
    expect(tank.hp).toBe(300); // snapped to maxHp
  });
});

// ---------------------------------------------------------------------------
// 3. ConditionGreen check — only repair if hp < maxHp (techno.cpp:987)
// ---------------------------------------------------------------------------

describe('C++ parity: ConditionGreen gate (techno.cpp:987, rules.cpp:233)', () => {
  it('full-health unit on depot is not repaired (returns RADIO_NEGATIVE)', () => {
    const depot = makeServiceDepot(5, 5);
    const tank = makeVehicleAtDepot(UnitType.V_1TNK, depot, 300, 300);
    const ctx = makeCtx({
      structures: [depot],
      entities: [tank],
    });

    const creditsBefore = ctx.credits;
    tickServiceDepot(ctx);
    // No credits spent, no HP change
    expect(ctx.credits).toBe(creditsBefore);
    expect(tank.hp).toBe(300);
  });

  it('slightly damaged unit (hp = maxHp - 1) IS repaired', () => {
    const depot = makeServiceDepot(5, 5);
    const tank = makeVehicleAtDepot(UnitType.V_1TNK, depot, 299, 300);
    const ctx = makeCtx({
      structures: [depot],
      entities: [tank],
    });

    const creditsBefore = ctx.credits;
    tickServiceDepot(ctx);
    // Should have been repaired (clamped to maxHp)
    expect(tank.hp).toBe(300);
    expect(ctx.credits).toBeLessThan(creditsBefore);
  });
});

// ---------------------------------------------------------------------------
// 4. Insufficient funds ejection (techno.cpp:1012-1013, building.cpp:3952-3956)
// ---------------------------------------------------------------------------

describe('C++ parity: insufficient funds handling (techno.cpp:1012-1013)', () => {
  it('no repair when credits < cost', () => {
    const depot = makeServiceDepot(5, 5);
    const tank = makeVehicleAtDepot(UnitType.V_1TNK, depot, 100, 300);
    const cost = unitRepairCostPerStep(700, 300); // = 5
    const ctx = makeCtx({
      structures: [depot],
      entities: [tank],
      credits: cost - 1, // not enough
    });

    const hpBefore = tank.hp;
    tickServiceDepot(ctx);
    expect(tank.hp).toBe(hpBefore); // no repair
  });

  it('unit stays on depot when funds run out mid-repair (C++ RADIO_CANT)', () => {
    const depot = makeServiceDepot(5, 5);
    const tank = makeVehicleAtDepot(UnitType.V_1TNK, depot, 100, 300);
    const cost = unitRepairCostPerStep(700, 300); // = 5
    const ctx = makeCtx({
      structures: [depot],
      entities: [tank],
      credits: cost, // exactly enough for one tick
    });

    // First tick: repair succeeds
    tickServiceDepot(ctx);
    expect(tank.hp).toBe(110);
    expect(ctx.credits).toBe(0);

    // Second tick: insufficient funds — C++ depot goes IDLE, unit stays put
    const missionBefore = tank.mission;
    tickServiceDepot(ctx);
    expect(tank.hp).toBe(110); // no further repair
    // C++ parity: unit is NOT ejected — stays on depot waiting for funds
    expect(tank.mission).toBe(missionBefore);
    expect(tank.moveTarget).toBeNull();
  });

  it('exact credits: repair succeeds, credits go to zero', () => {
    const depot = makeServiceDepot(5, 5);
    const tank = makeVehicleAtDepot(UnitType.V_1TNK, depot, 100, 300);
    const cost = unitRepairCostPerStep(700, 300);
    const ctx = makeCtx({
      structures: [depot],
      entities: [tank],
      credits: cost,
    });

    tickServiceDepot(ctx);
    expect(tank.hp).toBe(100 + UREPAIR_STEP);
    expect(ctx.credits).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Credits are correctly deducted (techno.cpp:998)
// ---------------------------------------------------------------------------

describe('C++ parity: credits deduction per step (techno.cpp:998)', () => {
  const DEDUCTION_CASES = [
    { type: UnitType.V_1TNK, typeName: '1TNK', cost: 700, maxHp: 300 },
    { type: UnitType.V_2TNK, typeName: '2TNK', cost: 800, maxHp: 400 },
    { type: UnitType.V_HARV, typeName: 'HARV', cost: 1400, maxHp: 600 },
  ];

  for (const { type, typeName, cost, maxHp } of DEDUCTION_CASES) {
    it(`${typeName}: deducts exactly unitRepairCostPerStep per tick`, () => {
      const depot = makeServiceDepot(5, 5);
      const tank = makeVehicleAtDepot(type, depot, maxHp - 50, maxHp);
      const ctx = makeCtx({
        structures: [depot],
        entities: [tank],
      });

      const expectedCost = unitRepairCostPerStep(cost, maxHp);
      const creditsBefore = ctx.credits;
      tickServiceDepot(ctx);
      expect(ctx.credits).toBe(creditsBefore - expectedCost);
    });
  }
});

// ---------------------------------------------------------------------------
// 6. Multiple repair ticks to full health
// ---------------------------------------------------------------------------

describe('C++ parity: multi-tick repair to full health', () => {
  it('light tank at 50% health requires correct number of ticks', () => {
    const depot = makeServiceDepot(5, 5);
    const tank = makeVehicleAtDepot(UnitType.V_1TNK, depot, 150, 300);
    const ctx = makeCtx({
      structures: [depot],
      entities: [tank],
    });

    const costPerStep = unitRepairCostPerStep(700, 300);
    let totalCost = 0;
    let ticks = 0;
    while (tank.hp < 300 && ticks < 100) {
      tickServiceDepot(ctx);
      totalCost += costPerStep;
      ticks++;
    }
    expect(tank.hp).toBe(300);
    // 150 damage / 10 per step = 15 ticks
    expect(ticks).toBe(15);
    expect(ctx.credits).toBe(10000 - 15 * costPerStep);
  });

  it('mammoth tank at 1 HP requires correct number of ticks', () => {
    const depot = makeServiceDepot(5, 5);
    const tank = makeVehicleAtDepot(UnitType.V_4TNK, depot, 1, 600);
    const ctx = makeCtx({
      structures: [depot],
      entities: [tank],
    });

    let ticks = 0;
    while (tank.hp < 600 && ticks < 200) {
      tickServiceDepot(ctx);
      ticks++;
    }
    expect(tank.hp).toBe(600);
    // 599 damage / 10 per step = 60 ticks (ceil), but Math.min clamps last step
    expect(ticks).toBe(Math.ceil(599 / UREPAIR_STEP));
  });
});

// ---------------------------------------------------------------------------
// 7. Distance threshold — only repair close units (building.cpp:3860)
// ---------------------------------------------------------------------------

describe('C++ parity: distance threshold (building.cpp:3860)', () => {
  // C++ uses 0x10 leptons for ground units. In RA, 256 leptons = 1 cell.
  // 0x10 = 16 leptons = 16/256 = 0.0625 cells

  it('unit exactly on depot center (dist=0) is repaired', () => {
    const depot = makeServiceDepot(5, 5);
    const tank = makeVehicleAtDepot(UnitType.V_1TNK, depot, 100, 300);
    const ctx = makeCtx({
      structures: [depot],
      entities: [tank],
    });

    tickServiceDepot(ctx);
    expect(tank.hp).toBe(100 + UREPAIR_STEP);
  });

  it('unit 1 cell away from depot center is NOT repaired (C++ parity)', () => {
    // C++ distance check is 0x10 leptons (~0.0625 cells).
    // TS uses 0.0625 cells matching C++.
    const depot = makeServiceDepot(5, 5);
    const sx = depot.cx * CELL_SIZE + CELL_SIZE;
    const sy = depot.cy * CELL_SIZE + CELL_SIZE + CELL_SIZE; // 1 cell below
    const tank = new Entity(UnitType.V_1TNK, House.Spain, sx, sy);
    tank.hp = 100;
    tank.maxHp = 300;

    const ctx = makeCtx({
      structures: [depot],
      entities: [tank],
    });

    tickServiceDepot(ctx);
    // dist = 1.0 > 0.0625 threshold — NOT repaired (matches C++ behavior)
    expect(tank.hp).toBe(100);
  });

  it('unit 2 cells away from depot center is NOT repaired', () => {
    const depot = makeServiceDepot(5, 5);
    const sx = depot.cx * CELL_SIZE + CELL_SIZE;
    const sy = depot.cy * CELL_SIZE + CELL_SIZE + CELL_SIZE * 2; // 2 cells below
    const tank = new Entity(UnitType.V_1TNK, House.Spain, sx, sy);
    tank.hp = 100;
    tank.maxHp = 300;

    const ctx = makeCtx({
      structures: [depot],
      entities: [tank],
    });

    const creditsBefore = ctx.credits;
    tickServiceDepot(ctx);
    expect(tank.hp).toBe(100); // too far
    expect(ctx.credits).toBe(creditsBefore);
  });
});

// ---------------------------------------------------------------------------
// 8. Minelayer rearm (techno.cpp:978-980)
// ---------------------------------------------------------------------------

describe('C++ parity: minelayer rearm at service depot (techno.cpp:978-980)', () => {
  // C++ behavior: In RADIO_REPAIR handler, if unit is a minelayer with ammo < maxAmmo,
  // rearm to full immediately and return RADIO_NEGATIVE (skip repair entirely).
  // This means: a damaged minelayer with low ammo gets rearmed but NOT repaired.
  //
  // TS behavior: tickServiceDepot repairs AND rearms simultaneously.
  // The rearm is done in a separate block after repair, with a timer.
  // This is a PARITY GAP.

  it('minelayer with low ammo gets rearmed instantly at depot', () => {
    const depot = makeServiceDepot(5, 5);
    const mnly = makeVehicleAtDepot(UnitType.V_MNLY, depot, 50, 100);
    mnly.ammo = 0;
    mnly.maxAmmo = 5;

    const ctx = makeCtx({
      structures: [depot],
      entities: [mnly],
    });

    // C++ parity: minelayer rearms to full in a single tick
    tickServiceDepot(ctx);
    expect(mnly.ammo).toBe(5);
  });

  it('C++ minelayer rearms instantly and skips repair (techno.cpp:978-980)', () => {
    // C++ techno.cpp:978-980: minelayer with ammo < maxAmmo →
    //   Ammo = Class->MaxAmmo; return RADIO_NEGATIVE;
    //   Repair is SKIPPED because RADIO_NEGATIVE short-circuits RADIO_REPAIR
    const depot = makeServiceDepot(5, 5);
    const mnly = makeVehicleAtDepot(UnitType.V_MNLY, depot, 50, 100);
    mnly.ammo = 0;
    mnly.maxAmmo = 5;

    const ctx = makeCtx({
      structures: [depot],
      entities: [mnly],
    });

    const hpBefore = mnly.hp;
    const creditsBefore = ctx.credits;
    tickServiceDepot(ctx);

    // C++ parity: ammo jumps to full instantly, repair is SKIPPED
    expect(mnly.ammo).toBe(5);
    expect(mnly.hp).toBe(hpBefore); // no repair — RADIO_NEGATIVE short-circuits
    expect(ctx.credits).toBe(creditsBefore); // no credits spent
  });
});

// ---------------------------------------------------------------------------
// 9. Rearm behavior — RADIO_RELOAD for non-minelayer (techno.cpp:964-968)
// ---------------------------------------------------------------------------

describe('C++ parity: rearm at depot via timer', () => {
  it('unit with low ammo gets rearmed alongside repair', () => {
    const depot = makeServiceDepot(5, 5);
    const tank = makeVehicleAtDepot(UnitType.V_1TNK, depot, 200, 300);
    // Simulate a unit with ammo system (not typical for tanks but tests the path)
    tank.ammo = 0;
    tank.maxAmmo = 3;

    const ctx = makeCtx({
      structures: [depot],
      entities: [tank],
    });

    // Tick enough times for rearm timer to trigger (TS uses 36-tick timer)
    for (let i = 0; i < 40; i++) {
      tickServiceDepot(ctx);
    }

    expect(tank.ammo).toBeGreaterThan(0);
  });

  it('full ammo unit does not get rearmed', () => {
    const depot = makeServiceDepot(5, 5);
    const tank = makeVehicleAtDepot(UnitType.V_1TNK, depot, 200, 300);
    tank.ammo = 3;
    tank.maxAmmo = 3;

    const ctx = makeCtx({
      structures: [depot],
      entities: [tank],
    });

    tickServiceDepot(ctx);
    expect(tank.ammo).toBe(3); // unchanged
  });
});

// ---------------------------------------------------------------------------
// 10. Infantry exclusion (building.cpp:190 — only RTTI_UNIT or RTTI_AIRCRAFT)
// ---------------------------------------------------------------------------

describe('C++ parity: infantry excluded from service depot (building.cpp:190)', () => {
  it('infantry near depot is NOT repaired', () => {
    const depot = makeServiceDepot(5, 5);
    const sx = depot.cx * CELL_SIZE + CELL_SIZE;
    const sy = depot.cy * CELL_SIZE + CELL_SIZE;
    const inf = new Entity(UnitType.E1, House.Spain, sx, sy);
    inf.hp = 20;
    inf.maxHp = 50;

    const ctx = makeCtx({
      structures: [depot],
      entities: [inf],
    });

    const creditsBefore = ctx.credits;
    tickServiceDepot(ctx);
    expect(inf.hp).toBe(20); // infantry not repaired at depot
    expect(ctx.credits).toBe(creditsBefore);
  });
});

// ---------------------------------------------------------------------------
// 11. Enemy unit exclusion — only player-controlled units
// ---------------------------------------------------------------------------

describe('C++ parity: only player-controlled units repaired', () => {
  it('enemy vehicle on depot is NOT repaired', () => {
    const depot = makeServiceDepot(5, 5);
    const sx = depot.cx * CELL_SIZE + CELL_SIZE;
    const sy = depot.cy * CELL_SIZE + CELL_SIZE;
    const enemyTank = new Entity(UnitType.V_1TNK, House.USSR, sx, sy);
    enemyTank.hp = 100;
    enemyTank.maxHp = 300;

    const ctx = makeCtx({
      structures: [depot],
      entities: [enemyTank],
    });

    const creditsBefore = ctx.credits;
    tickServiceDepot(ctx);
    expect(enemyTank.hp).toBe(100);
    expect(ctx.credits).toBe(creditsBefore);
  });
});

// ---------------------------------------------------------------------------
// 12. Multi-vehicle priority — closest vehicle gets repaired first
// ---------------------------------------------------------------------------

describe('C++ parity: multi-vehicle priority at depot', () => {
  it('closest damaged vehicle is repaired, farther one is not', () => {
    const depot = makeServiceDepot(5, 5);
    const sx = depot.cx * CELL_SIZE + CELL_SIZE;
    const sy = depot.cy * CELL_SIZE + CELL_SIZE;

    // Close tank — exactly on depot
    const closeTank = new Entity(UnitType.V_1TNK, House.Spain, sx, sy);
    closeTank.hp = 100;
    closeTank.maxHp = 300;

    // Far tank — 1 cell away (outside 0.0625 cell threshold)
    const farTank = new Entity(UnitType.V_2TNK, House.Spain, sx + CELL_SIZE, sy);
    farTank.hp = 100;
    farTank.maxHp = 400;

    const ctx = makeCtx({
      structures: [depot],
      entities: [closeTank, farTank],
    });

    tickServiceDepot(ctx);
    // Close tank should be repaired (it's the closest)
    expect(closeTank.hp).toBe(100 + UREPAIR_STEP);
    // Far tank should NOT be repaired (only one at a time)
    expect(farTank.hp).toBe(100);
  });

  it('if closest is at full health, second closest gets repaired', () => {
    const depot = makeServiceDepot(5, 5);
    const sx = depot.cx * CELL_SIZE + CELL_SIZE;
    const sy = depot.cy * CELL_SIZE + CELL_SIZE;

    // Close tank at full health
    const closeTank = new Entity(UnitType.V_1TNK, House.Spain, sx, sy);
    closeTank.hp = 300;
    closeTank.maxHp = 300;

    // Second tank 1 pixel away (~0.042 cells < 0.0625 threshold), damaged
    const secondTank = new Entity(UnitType.V_2TNK, House.Spain, sx + 1, sy);
    secondTank.hp = 100;
    secondTank.maxHp = 400;

    const ctx = makeCtx({
      structures: [depot],
      entities: [closeTank, secondTank],
    });

    const creditsBefore = ctx.credits;
    tickServiceDepot(ctx);
    // Close tank needs no repair and has no rearm needs → skipped
    expect(closeTank.hp).toBe(300);
    // Second tank should be repaired
    expect(secondTank.hp).toBe(100 + UREPAIR_STEP);
    expect(ctx.credits).toBeLessThan(creditsBefore);
  });
});

// ---------------------------------------------------------------------------
// 13. Multiple service depots — each repairs independently
// ---------------------------------------------------------------------------

describe('C++ parity: multiple service depots', () => {
  it('two depots can repair two different units simultaneously', () => {
    const depot1 = makeServiceDepot(5, 5);
    const depot2 = makeServiceDepot(15, 15);

    const tank1 = makeVehicleAtDepot(UnitType.V_1TNK, depot1, 100, 300);
    const tank2 = makeVehicleAtDepot(UnitType.V_2TNK, depot2, 200, 400);

    const ctx = makeCtx({
      structures: [depot1, depot2],
      entities: [tank1, tank2],
    });

    tickServiceDepot(ctx);
    expect(tank1.hp).toBe(100 + UREPAIR_STEP);
    expect(tank2.hp).toBe(200 + UREPAIR_STEP);
  });
});

// ---------------------------------------------------------------------------
// 14. Dead depot does not repair
// ---------------------------------------------------------------------------

describe('C++ parity: dead depot does not repair', () => {
  it('destroyed service depot does not repair docked unit', () => {
    const depot = makeServiceDepot(5, 5);
    depot.alive = false;

    const tank = makeVehicleAtDepot(UnitType.V_1TNK, depot, 100, 300);
    const ctx = makeCtx({
      structures: [depot],
      entities: [tank],
    });

    const creditsBefore = ctx.credits;
    tickServiceDepot(ctx);
    expect(tank.hp).toBe(100);
    expect(ctx.credits).toBe(creditsBefore);
  });
});

// ---------------------------------------------------------------------------
// 15. Enemy depot does not repair player units
// ---------------------------------------------------------------------------

describe('C++ parity: enemy depot does not repair player units', () => {
  it('enemy-owned depot does not repair player vehicle', () => {
    const depot = makeServiceDepot(5, 5, House.USSR);
    const tank = makeVehicleAtDepot(UnitType.V_1TNK, depot, 100, 300, House.Spain);

    const ctx = makeCtx({
      structures: [depot],
      entities: [tank],
    });

    const creditsBefore = ctx.credits;
    tickServiceDepot(ctx);
    expect(tank.hp).toBe(100);
    expect(ctx.credits).toBe(creditsBefore);
  });
});

// ---------------------------------------------------------------------------
// 16. Visual effect on repair
// ---------------------------------------------------------------------------

describe('C++ parity: repair visual effects', () => {
  it('repair tick produces a visual effect (muzzle/piff)', () => {
    const depot = makeServiceDepot(5, 5);
    const tank = makeVehicleAtDepot(UnitType.V_1TNK, depot, 100, 300);
    const ctx = makeCtx({
      structures: [depot],
      entities: [tank],
    });

    expect(ctx.effects.length).toBe(0);
    tickServiceDepot(ctx);
    expect(ctx.effects.length).toBeGreaterThan(0);
    expect(ctx.effects[0].type).toBe('muzzle');
  });
});

// ---------------------------------------------------------------------------
// 17. Dead entity on depot is not repaired
// ---------------------------------------------------------------------------

describe('C++ parity: dead entity on depot not repaired', () => {
  it('dead unit does not receive repair', () => {
    const depot = makeServiceDepot(5, 5);
    const tank = makeVehicleAtDepot(UnitType.V_1TNK, depot, 0, 300);
    tank.alive = false;

    const ctx = makeCtx({
      structures: [depot],
      entities: [tank],
    });

    tickServiceDepot(ctx);
    expect(tank.hp).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 18. Unknown unit type uses fallback cost (TS-specific behavior)
// ---------------------------------------------------------------------------

describe('TS-specific: unknown unit type fallback cost', () => {
  it('unit type not in production items uses fallback cost of 400', () => {
    const depot = makeServiceDepot(5, 5);
    // Use a unit type that won't be in scenarioProductionItems
    const sx = depot.cx * CELL_SIZE + CELL_SIZE;
    const sy = depot.cy * CELL_SIZE + CELL_SIZE;
    const unit = new Entity(UnitType.V_MCV, House.Spain, sx, sy);
    unit.hp = 100;
    unit.maxHp = 600;

    const ctx = makeCtx({
      structures: [depot],
      entities: [unit],
    });

    const creditsBefore = ctx.credits;
    tickServiceDepot(ctx);
    // Should repair with fallback cost=400
    expect(unit.hp).toBe(100 + UREPAIR_STEP);
    const fallbackCost = unitRepairCostPerStep(400, 600);
    expect(ctx.credits).toBe(creditsBefore - fallbackCost);
  });
});
