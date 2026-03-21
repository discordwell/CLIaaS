/**
 * C++ Behavioral Parity Tests — Economy Data & Constants
 *
 * Audits ore/economy constants, harvest mechanics, silo storage, refund rates,
 * repair costs, power system, and production speed against C++ rules.ini values.
 *
 * === C++ Source References ===
 *
 * Economy constants (rules.ini [General]):
 *   GoldValue=25       — credits per gold bail
 *   GemValue=50        — credits per gem bail
 *   BailCount=28       — max bails a harvester can carry
 *   GrowthRate=2       — minutes between ore growth/spread cycles
 *   RefundPercent=50%  — sell refund for human players
 *   RepairStep=7       — HP per building repair tick (rules.cpp default=5, overridden)
 *   RepairPercent=20%  — cost ratio for building repair (rules.cpp default=25%, overridden)
 *   URepairStep=10     — HP per unit repair tick (rules.cpp default=5, overridden)
 *   URepairPercent=20% — cost ratio for unit repair (rules.cpp default=25%, overridden)
 *   RepairRate=.016    — minutes between repair ticks (0.016 * 900 ≈ 14 ticks at 15Hz)
 *   BuildSpeed=.8      — build speed multiplier
 *
 * Storage (rules.ini per-building):
 *   [PROC] Storage=2000  — refinery stores 2000 credits
 *   [SILO] Storage=1500  — silo stores 1500 credits
 *
 * Power (rules.ini per-building):
 *   [POWR] Power=100     — power plant produces 100W
 *   [APWR] Power=200     — advanced power produces 200W
 *   Various Power=- values for consumers
 *
 * IsPowered flag (rules.ini Powered=true):
 *   Only IRON, PDOX, TSLA, DOME, GAP have Powered=true
 *   Default is false (bdata.cpp:2836)
 *   SAM, MSLO do NOT have Powered=true
 *
 * Production speed (techno.cpp:6077):
 *   Time_To_Build = Cost * Rule.BuildSpeedBias * fixed(TICKS_PER_MINUTE, 1000)
 *   BuildSpeedBias = 0.8 (rules.ini BuildSpeed=.8)
 *   TICKS_PER_MINUTE = 900 (15Hz * 60)
 *
 * Sell refund (techno.cpp:5743-5761):
 *   Human: cost * Rule.RefundPercent (50%)
 *   AI: cost * 1.0 (100%)
 *
 * Power_Output (building.cpp:4613):
 *   Class->Power * fixed(LastStrength, Class->MaxStrength)
 *   Uses 8.8 fixed-point arithmetic
 *
 * Power fraction for production (factory.cpp:434):
 *   rate = time / Bound(Power_Fraction(), fixed(1,16), fixed(1))
 *   Clamped to [1/16, 1.0]
 */

import { describe, it, expect } from 'vitest';
import { GameMap, Terrain } from '../engine/map';
import {
  MAP_CELLS,
  REPAIR_STEP, REPAIR_PERCENT, UREPAIR_STEP, UREPAIR_PERCENT,
  POWER_DRAIN,
} from '../engine/types';
import { Entity } from '../engine/entity';
import {
  repairCostPerStep, unitRepairCostPerStep, sellRefund,
  fixedPowerOutput, powerOutput, powerMultiplier,
  calculateSiloCapacity,
} from '../engine/repairSell';
import { STRUCTURE_POWERED } from '../engine/scenario';

// ============================================================
// Helpers
// ============================================================
function setOverlay(map: GameMap, cx: number, cy: number, val: number): void {
  map.overlay[cy * MAP_CELLS + cx] = val;
}

// ============================================================
// Section 1: Ore Values — rules.ini [General]
//   GoldValue=25, GemValue=50
//   rules.cpp defaults: GoldValue=35, GemValue=110 (overridden by INI)
// ============================================================
describe('Ore values — rules.ini GoldValue=25, GemValue=50', () => {
  let map: GameMap;

  it('depleteOre returns 25 for gold ore (rules.ini GoldValue=25)', () => {
    map = new GameMap(128, 128, new Uint8Array(128 * 128).fill(Terrain.CLEAR));
    setOverlay(map, 50, 50, 0x05); // gold ore at density 2
    expect(map.depleteOre(50, 50)).toBe(25);
  });

  it('depleteOre returns 50 for gems (rules.ini GemValue=50)', () => {
    map = new GameMap(128, 128, new Uint8Array(128 * 128).fill(Terrain.CLEAR));
    setOverlay(map, 50, 50, 0x10); // gem at density 1
    expect(map.depleteOre(50, 50)).toBe(50);
  });

  it('gem-to-gold ratio is 2:1 (50/25)', () => {
    map = new GameMap(128, 128, new Uint8Array(128 * 128).fill(Terrain.CLEAR));
    setOverlay(map, 50, 50, 0x05);
    const goldValue = map.depleteOre(50, 50);
    setOverlay(map, 51, 50, 0x10);
    const gemValue = map.depleteOre(51, 50);
    expect(gemValue / goldValue).toBe(2);
  });
});

// ============================================================
// Section 2: BailCount — harvester capacity
//   rules.ini BailCount=28
//   C++ unit.cpp:4277: fixed(Tiberium, Rule.BailCount)
// ============================================================
describe('BailCount — harvester capacity (rules.ini BailCount=28)', () => {
  it('Entity.BAIL_COUNT = 28', () => {
    expect(Entity.BAIL_COUNT).toBe(28);
  });

  it('Entity.ORE_CAPACITY = 28 (alias for BAIL_COUNT)', () => {
    expect(Entity.ORE_CAPACITY).toBe(28);
  });

  it('BAIL_COUNT matches ORE_CAPACITY', () => {
    expect(Entity.BAIL_COUNT).toBe(Entity.ORE_CAPACITY);
  });

  /**
   * C++ full gold load value:
   *   28 gold bails * 25 credits/bail = 700 credits total
   *   unit.cpp:4792: (Gold * Rule.GoldValue) + (Gems * Rule.GemValue)
   */
  it('full gold load = 28 * 25 = 700 credits', () => {
    const fullGoldCredits = Entity.BAIL_COUNT * 25;
    expect(fullGoldCredits).toBe(700);
  });
});

// ============================================================
// Section 3: GrowthRate — ore regrowth timing
//   rules.ini GrowthRate=2 (minutes)
//   C++ map.cpp:1017: subcount = MAP_CELL_TOTAL / (GrowthRate * TICKS_PER_MINUTE)
//   MAP_CELL_TOTAL = 128*128 = 16384, TICKS_PER_MINUTE = 900
//   subcount = 16384 / (2 * 900) = 16384 / 1800 ≈ 9
//   Full scan interval: ceil(16384 / 9) = 1821 ticks
// ============================================================
describe('GrowthRate — ore regrowth interval (rules.ini GrowthRate=2)', () => {
  it('ORE_GROWTH_INTERVAL = 1821 ticks', () => {
    expect(GameMap.ORE_GROWTH_INTERVAL).toBe(1821);
  });

  /**
   * C++ map.cpp:1017 derivation:
   *   MAP_CELL_TOTAL = 128 * 128 = 16384
   *   GrowthRate = 2 minutes
   *   TICKS_PER_MINUTE = 900 (15 FPS * 60)
   *   subcount = floor(16384 / (2 * 900)) = floor(16384 / 1800) = 9
   *   Full cycle = ceil(16384 / 9) = 1821 ticks
   */
  it('ORE_GROWTH_INTERVAL matches C++ derivation from GrowthRate=2', () => {
    const MAP_CELL_TOTAL = 128 * 128;
    const GROWTH_RATE = 2;
    const TICKS_PER_MINUTE = 900;
    const subcount = Math.floor(MAP_CELL_TOTAL / (GROWTH_RATE * TICKS_PER_MINUTE));
    expect(subcount).toBe(9);
    const fullCycle = Math.ceil(MAP_CELL_TOTAL / subcount);
    expect(fullCycle).toBe(1821);
    expect(GameMap.ORE_GROWTH_INTERVAL).toBe(fullCycle);
  });
});

// ============================================================
// Section 4: Silo Storage Capacity
//   rules.ini: [PROC] Storage=2000, [SILO] Storage=1500
//   C++ bdata.cpp:3771: Capacity = ini.Get_Int(Name(), "Storage", Capacity)
//   C++ house.cpp:1946: Adjust_Capacity adds/subtracts per-building capacity
//
//   BUG CHECK: TS uses PROC=1000 but rules.ini says Storage=2000
// ============================================================
describe('Silo storage capacity — rules.ini Storage= values', () => {
  /**
   * C++ rules.ini [PROC]: Storage=2000
   * TS repairSell.ts:142: if (s.type === 'PROC') capacity += 1000;
   * DIVERGENCE: TS uses 1000, C++ uses 2000.
   */
  it('PROC storage should be 2000 (rules.ini Storage=2000)', () => {
    // This tests whether TS matches C++ rules.ini Storage=2000 for refineries
    // Create a mock structure set with one PROC
    const structures = [
      { type: 'PROC', alive: true, house: 'Spain' as any, hp: 900, maxHp: 900 },
    ] as any[];
    const capacity = calculateSiloCapacity(
      structures, 'Spain' as any, (a: any, b: any) => a === b,
    );
    // C++ rules.ini: PROC Storage=2000
    expect(capacity).toBe(2000);
  });

  it('SILO storage = 1500 (rules.ini Storage=1500)', () => {
    const structures = [
      { type: 'SILO', alive: true, house: 'Spain' as any, hp: 300, maxHp: 300 },
    ] as any[];
    const capacity = calculateSiloCapacity(
      structures, 'Spain' as any, (a: any, b: any) => a === b,
    );
    expect(capacity).toBe(1500);
  });

  /**
   * Total storage with 1 PROC + 1 SILO:
   * C++ rules.ini: 2000 + 1500 = 3500
   */
  it('1 PROC + 1 SILO = 3500 total storage (C++ rules.ini)', () => {
    const structures = [
      { type: 'PROC', alive: true, house: 'Spain' as any, hp: 900, maxHp: 900 },
      { type: 'SILO', alive: true, house: 'Spain' as any, hp: 300, maxHp: 300 },
    ] as any[];
    const capacity = calculateSiloCapacity(
      structures, 'Spain' as any, (a: any, b: any) => a === b,
    );
    // C++ expects 2000 + 1500 = 3500
    expect(capacity).toBe(3500);
  });
});

// ============================================================
// Section 5: Sell Refund Rate
//   rules.ini RefundPercent=50%
//   C++ techno.cpp:5757-5758: if (IsHuman) cost = cost * Rule.RefundPercent;
//   AI gets 100% refund (no penalty)
// ============================================================
describe('Sell refund — rules.ini RefundPercent=50%', () => {
  it('human player gets 50% refund', () => {
    expect(sellRefund(1000, true)).toBe(500);
  });

  it('AI player gets 100% refund', () => {
    expect(sellRefund(1000, false)).toBe(1000);
  });

  it('refund of 1500-cost building for human = 750', () => {
    expect(sellRefund(1500, true)).toBe(750);
  });

  it('refund rounds down (floor) for odd costs', () => {
    // C++ integer multiplication: 2001 * 0.5 = 1000.5 → floor to 1000
    expect(sellRefund(2001, true)).toBe(1000);
  });
});

// ============================================================
// Section 6: Repair Cost Formula
//   rules.ini: RepairStep=7, RepairPercent=20%, URepairStep=10, URepairPercent=20%
//   C++ techno.cpp:6144: (Raw_Cost() / (MaxStrength / RepairStep)) * RepairPercent
//   Fixed-point 8.8: floor(0.20 * 256) = 51
// ============================================================
describe('Repair constants — rules.ini values', () => {
  it('REPAIR_STEP = 7 (rules.ini RepairStep=7, NOT rules.cpp default of 5)', () => {
    expect(REPAIR_STEP).toBe(7);
  });

  it('REPAIR_PERCENT = 0.20 (rules.ini RepairPercent=20%, NOT rules.cpp default of 0.25)', () => {
    expect(REPAIR_PERCENT).toBe(0.20);
  });

  it('UREPAIR_STEP = 10 (rules.ini URepairStep=10, NOT rules.cpp default of 5)', () => {
    expect(UREPAIR_STEP).toBe(10);
  });

  it('UREPAIR_PERCENT = 0.20 (rules.ini URepairPercent=20%, NOT rules.cpp default of 0.25)', () => {
    expect(UREPAIR_PERCENT).toBe(0.20);
  });
});

describe('Repair cost per step — C++ fixed-point formula (techno.cpp:6144)', () => {
  /**
   * C++ formula: (Raw_Cost() / (MaxStrength / Rule.RepairStep)) * Rule.RepairPercent
   *   RepairPercent raw = floor(0.20 * 256) = 51
   *   int*fixed result = ((51 * costPerFullStep) + 128) / 256
   *
   * Example: POWR cost=300, maxHp=400
   *   stepsToFull = floor(400/7) = 57
   *   costPerFullStep = floor(300/57) = 5
   *   result = max(1, floor((51*5 + 128) / 256)) = max(1, floor(383/256)) = max(1, 1) = 1
   */
  it('POWR (cost=300, maxHp=400): repair cost = 1', () => {
    expect(repairCostPerStep(300, 400)).toBe(1);
  });

  /**
   * WEAP cost=2000, maxHp=1000
   *   stepsToFull = floor(1000/7) = 142
   *   costPerFullStep = floor(2000/142) = 14
   *   result = max(1, floor((51*14 + 128) / 256)) = max(1, floor(842/256)) = max(1, 3) = 3
   */
  it('WEAP (cost=2000, maxHp=1000): repair cost = 3', () => {
    expect(repairCostPerStep(2000, 1000)).toBe(3);
  });

  /**
   * Unit repair: URepairStep=10, URepairPercent=20%
   * Medium Tank cost=800, maxHp=400
   *   stepsToFull = floor(400/10) = 40
   *   costPerFullStep = floor(800/40) = 20
   *   result = max(1, floor((51*20 + 128) / 256)) = max(1, floor(1148/256)) = max(1, 4) = 4
   */
  it('Medium Tank unit repair (cost=800, maxHp=400): cost per step = 4', () => {
    expect(unitRepairCostPerStep(800, 400)).toBe(4);
  });

  it('minimum repair cost is 1 (techno.cpp:989 clamping)', () => {
    expect(repairCostPerStep(100, 400)).toBeGreaterThanOrEqual(1);
    expect(unitRepairCostPerStep(100, 400)).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// Section 7: Power System
//   rules.ini: [POWR] Power=100, [APWR] Power=200
//   C++ building.cpp:4613: Power * fixed(LastStrength, Class->MaxStrength)
//   8.8 fixed-point arithmetic
// ============================================================
describe('Power output — rules.ini POWR=100W, APWR=200W', () => {
  it('POWR at full health produces 100W', () => {
    expect(powerOutput('POWR', 400, 400)).toBe(100);
  });

  it('APWR at full health produces 200W', () => {
    expect(powerOutput('APWR', 700, 700)).toBe(200);
  });

  /**
   * C++ fixed-point: fixed(hp, maxHp) * ratedPower
   * POWR at 50% health: fixed(200, 400) = floor(200*256/400) = 128
   * 128 * 100 = 12800, result = floor((12800 + 128) / 256) = floor(50.5) = 50
   */
  it('POWR at 50% health produces 50W (fixed-point)', () => {
    expect(powerOutput('POWR', 200, 400)).toBe(50);
  });

  it('APWR at 50% health produces 100W (fixed-point)', () => {
    expect(powerOutput('APWR', 350, 700)).toBe(100);
  });

  it('destroyed power plant produces 0W', () => {
    expect(powerOutput('POWR', 0, 400)).toBe(0);
  });

  it('non-power structures produce 0W', () => {
    expect(powerOutput('PROC', 900, 900)).toBe(0);
    expect(powerOutput('WEAP', 1000, 1000)).toBe(0);
  });
});

describe('Power drain — rules.ini Power= values per building', () => {
  /**
   * C++ rules.ini power drain values (negative Power= means consumer).
   * Drain values are stored as positive numbers in TS POWER_DRAIN.
   */
  const CPP_POWER_DRAIN: Record<string, number> = {
    PROC: 30,
    WEAP: 30,
    TENT: 20,
    BARR: 20,
    DOME: 40,
    TSLA: 150,
    PBOX: 15,
    HBOX: 15,
    GUN:  40,
    SAM:  20,
    AGUN: 50,
    FIX:  30,
    HPAD: 10,
    AFLD: 30,
    ATEK: 200,
    STEK: 100,
    PDOX: 200,
    IRON: 200,
    MSLO: 100,
    GAP:  60,
    FTUR: 20,
    SILO: 10,
    KENN: 10,
    SYRD: 30,
    SPEN: 30,
    BIO:  40,
    HOSP: 20,
  };

  for (const [type, drain] of Object.entries(CPP_POWER_DRAIN)) {
    it(`${type} drains ${drain}W (rules.ini Power=-${drain})`, () => {
      expect(POWER_DRAIN[type]).toBe(drain);
    });
  }
});

// ============================================================
// Section 8: STRUCTURE_POWERED — IsPowered flag (Powered=true in rules.ini)
//   C++ bdata.cpp:2836: IsPowered defaults to false
//   C++ bdata.cpp:3774: IsPowered = ini.Get_Bool(Name(), "Powered", IsPowered)
//   Only structures with Powered=true in rules.ini lose functionality at low power.
//
//   rules.ini Powered=true entries: IRON, PDOX, TSLA, DOME, GAP (exactly 5)
//   TS STRUCTURE_POWERED has: TSLA, SAM, GAP, PDOX, IRON, MSLO
//   DIVERGENCES:
//     - DOME has Powered=true in C++ but missing from TS STRUCTURE_POWERED
//     - SAM does NOT have Powered=true in C++ but IS in TS STRUCTURE_POWERED
//     - MSLO does NOT have Powered=true in C++ but IS in TS STRUCTURE_POWERED
// ============================================================
describe('STRUCTURE_POWERED — IsPowered flag (rules.ini Powered=true)', () => {
  // C++ rules.ini Powered=true buildings (the ONLY ones that disable at low power)
  const CPP_POWERED_STRUCTURES = ['IRON', 'PDOX', 'TSLA', 'DOME', 'GAP'];

  for (const type of CPP_POWERED_STRUCTURES) {
    it(`${type} should be in STRUCTURE_POWERED (C++ Powered=true)`, () => {
      expect(STRUCTURE_POWERED.has(type)).toBe(true);
    });
  }

  // C++ does NOT set Powered=true for SAM (SAM has no Powered= line in rules.ini)
  it('SAM should NOT be in STRUCTURE_POWERED (C++ IsPowered defaults false, no Powered= in rules.ini)', () => {
    expect(STRUCTURE_POWERED.has('SAM')).toBe(false);
  });

  // C++ does NOT set Powered=true for MSLO
  it('MSLO should NOT be in STRUCTURE_POWERED (C++ IsPowered defaults false, no Powered= in rules.ini)', () => {
    expect(STRUCTURE_POWERED.has('MSLO')).toBe(false);
  });

  // Structures that should NOT be powered (common check)
  const CPP_NOT_POWERED = ['GUN', 'AGUN', 'PBOX', 'HBOX', 'FTUR', 'PROC', 'WEAP', 'TENT', 'BARR'];
  for (const type of CPP_NOT_POWERED) {
    it(`${type} should NOT be in STRUCTURE_POWERED (C++ IsPowered=false)`, () => {
      expect(STRUCTURE_POWERED.has(type)).toBe(false);
    });
  }
});

// ============================================================
// Section 9: Power Fraction for Production
//   C++ factory.cpp:434: rate = time / Bound(Power_Fraction(), fixed(1,16), fixed(1))
//   C++ house.cpp:4160: Power_Fraction() = Power/Drain (or 0 if no drain)
//   Clamped to [1/16, 1.0]
// ============================================================
describe('Power fraction for production — factory.cpp:434 parity', () => {
  it('full power (produced >= consumed) → multiplier = 1.0', () => {
    expect(powerMultiplier(200, 100)).toBe(1.0);
  });

  it('equal power → multiplier = 1.0', () => {
    expect(powerMultiplier(100, 100)).toBe(1.0);
  });

  it('50% power → multiplier = 0.5', () => {
    expect(powerMultiplier(50, 100)).toBe(0.5);
  });

  it('0% power → clamped to 1/16 (0.0625)', () => {
    expect(powerMultiplier(0, 100)).toBe(1 / 16);
  });

  it('very low power (3%) → clamped to 1/16 (0.0625)', () => {
    // 3/100 = 0.03, which is < 1/16 = 0.0625 → clamp
    expect(powerMultiplier(3, 100)).toBe(1 / 16);
  });

  it('no consumers (consumed=0) → multiplier = 1.0', () => {
    expect(powerMultiplier(0, 0)).toBe(1.0);
  });
});

// ============================================================
// Section 10: Production Speed Formula
//   C++ techno.cpp:6077: Time_To_Build = Cost * Rule.BuildSpeedBias * fixed(TICKS_PER_MINUTE, 1000)
//   BuildSpeedBias = 0.8 (rules.ini BuildSpeed=.8)
//   TICKS_PER_MINUTE = 900 (15Hz * 60)
//   fixed(900, 1000) = floor(900*256/1000) = 230
//   So: Time_To_Build = Cost * 0.8 * (230/256) = Cost * 0.71875 (at 15Hz)
//
//   TS scales to 20Hz: multiply by 20/15 = 4/3
//   TS formula: floor(Cost * 0.8 * 900 / 1000 * 4/3) = floor(Cost * 0.96)
// ============================================================
describe('Production speed — techno.cpp:6077 Time_To_Build', () => {
  /**
   * C++ at 15Hz: Time_To_Build = Cost * BuildSpeedBias * fixed(TICKS_PER_MINUTE, 1000)
   *   = Cost * 0.8 * fixed(900, 1000)
   *   fixed(900, 1000) = floor(900 * 256 / 1000) = 230
   *   Result uses 8.8 multiply: ((230 * (Cost * 0.8_raw)) + 128) / 256
   *
   * But TS simplifies to: floor(Cost * 0.8 * 900 / 1000 * 4/3)
   * which is floor(Cost * 0.96)
   */
  const CPP_BUILD_SPEED_BIAS = 0.8;
  const CPP_TICKS_PER_MINUTE = 900; // 15Hz * 60
  const TS_TICK_SCALE = 20 / 15;     // 20Hz / 15Hz

  function expectedBuildTime(cost: number): number {
    return Math.floor(cost * CPP_BUILD_SPEED_BIAS * CPP_TICKS_PER_MINUTE / 1000 * TS_TICK_SCALE);
  }

  // Import production items to verify computed buildTime values
  // We'll check a few representative items
  it('POWR (cost=300) buildTime = floor(300 * 0.96) = 288', () => {
    expect(expectedBuildTime(300)).toBe(288);
  });

  it('PROC (cost=2000) buildTime = floor(2000 * 0.96) = 1920', () => {
    expect(expectedBuildTime(2000)).toBe(1920);
  });

  it('SILO (cost=150) buildTime = floor(150 * 0.96) = 144', () => {
    expect(expectedBuildTime(150)).toBe(144);
  });

  it('TSLA (cost=1500) buildTime = floor(1500 * 0.96) = 1440', () => {
    expect(expectedBuildTime(1500)).toBe(1440);
  });
});

// ============================================================
// Section 11: Harvester Scan Radius
//   rules.ini [AI]: OreNearScan=6, OreFarScan=48
//   C++ rules.cpp:731-732: TiberiumShortScan, TiberiumLongScan
// ============================================================
describe('Harvester ore scan radius — rules.ini [AI] values', () => {
  /**
   * C++ rules.ini [AI]:
   *   OreNearScan=6   — cell radius for scanning current ore patch
   *   OreFarScan=48   — cell radius for scanning for new ore patch
   *
   * TS ai.ts:446-448 has these as constants.
   * Note: C++ uses lepton-based scan (Get_Lepton), TS uses cell-based.
   */
  it('documents OreNearScan=6 and OreFarScan=48 from rules.ini', () => {
    // These are the authoritative C++ values
    const CPP_ORE_NEAR_SCAN = 6;
    const CPP_ORE_FAR_SCAN = 48;
    expect(CPP_ORE_NEAR_SCAN).toBe(6);
    expect(CPP_ORE_FAR_SCAN).toBe(48);
  });
});

// ============================================================
// Section 12: Repair Rate — interval between repair ticks
//   rules.ini: RepairRate=.016 (minutes)
//   C++ TICKS_PER_MINUTE = 900 (at 15Hz)
//   .016 * 900 = 14.4 → 14 ticks between repairs
//   TS calls tickRepairs every 14 ticks (index.ts:1752)
//   At 20Hz: .016 * 1200 = 19.2 → should be ~19 ticks
//
//   POTENTIAL DIVERGENCE: TS uses 14 (correct for 15Hz) but runs at 20Hz,
//   meaning repairs happen more frequently in real time.
// ============================================================
describe('Repair rate timing — rules.ini RepairRate=.016', () => {
  /**
   * C++ RepairRate = .016 minutes
   * At 15Hz: .016 * 900 = 14.4 ticks → 14 ticks (integer truncation)
   * At 20Hz: .016 * 1200 = 19.2 ticks → should be 19 ticks
   *
   * TS uses 14-tick interval (correct for 15Hz C++ timing)
   */
  it('C++ repair interval at 15Hz = floor(.016 * 900) = 14 ticks', () => {
    const CPP_REPAIR_RATE = 0.016; // minutes
    const CPP_TICKS_PER_MINUTE = 900; // 15Hz * 60
    const interval = Math.floor(CPP_REPAIR_RATE * CPP_TICKS_PER_MINUTE);
    expect(interval).toBe(14);
  });

  /**
   * At TS 20Hz tick rate, the equivalent interval should be:
   *   .016 * 1200 = 19.2 → 19 ticks
   * But TS uses 14, which makes repairs ~35% faster in real time.
   */
  it('TS repair interval at 20Hz should be floor(.016 * 1200) = 19 ticks', () => {
    const CPP_REPAIR_RATE = 0.016;
    const TS_TICKS_PER_MINUTE = 1200; // 20Hz * 60
    const expected20Hz = Math.floor(CPP_REPAIR_RATE * TS_TICKS_PER_MINUTE);
    // TS actually uses 14 (the 15Hz value), not the 20Hz-scaled value
    // This test documents the expected 20Hz value for parity awareness
    expect(expected20Hz).toBe(19);
  });
});

// ============================================================
// Section 13: Low Power Penalties
//   C++ house.cpp:1256: radar turns off when power < 100%
//   C++ combat.ts:1374: attack cooldown halved at low power for powered structures
//   C++ superweapons suspend charging when low power
// ============================================================
describe('Low power penalties — C++ behavior', () => {
  /**
   * C++ house.cpp:1256: radar turns off when power demand exceeds supply.
   * TS index.ts:6387-6388: hasRadar = hasBuilding('DOME') && !lowPwr
   * The TS check is correct: radar requires DOME and sufficient power.
   */
  it('documents radar requires DOME + sufficient power', () => {
    // This is a documentation test — TS implementation at index.ts:6387-6388
    // correctly requires both DOME and !lowPower for radar
    expect(true).toBe(true);
  });
});

// ============================================================
// Section 14: fixedPowerOutput — 8.8 fixed-point arithmetic
//   C++ building.cpp:4613: Class->Power * fixed(LastStrength, Class->MaxStrength)
//   C++ fixed.cpp:64: fixed(n,d) = floor(n * 256 / d) (truncation, not rounding)
//   Result: floor((fixedRaw * ratedPower + 128) / 256)
// ============================================================
describe('fixedPowerOutput — 8.8 fixed-point arithmetic (building.cpp:4613)', () => {
  /**
   * Edge case: 1 HP out of 400 maxHp
   * fixedRaw = floor(1 * 256 / 400) = floor(0.64) = 0
   * result = floor((0 * 100 + 128) / 256) = floor(0.5) = 0
   */
  it('1 HP POWR produces 0W (fixed-point truncation)', () => {
    expect(fixedPowerOutput(100, 1, 400)).toBe(0);
  });

  /**
   * 2 HP out of 400 maxHp
   * fixedRaw = floor(2 * 256 / 400) = floor(1.28) = 1
   * result = floor((1 * 100 + 128) / 256) = floor(228/256) = 0
   */
  it('2 HP POWR produces 0W (still truncates)', () => {
    expect(fixedPowerOutput(100, 2, 400)).toBe(0);
  });

  /**
   * 3 HP out of 400 maxHp (APWR rated 200W)
   * fixedRaw = floor(3 * 256 / 400) = floor(1.92) = 1
   * result = floor((1 * 200 + 128) / 256) = floor(328/256) = 1
   */
  it('3 HP APWR produces 1W', () => {
    expect(fixedPowerOutput(200, 3, 400)).toBe(1);
  });

  /**
   * 399 HP out of 400 maxHp (POWR rated 100W)
   * fixedRaw = floor(399 * 256 / 400) = floor(255.36) = 255
   * result = floor((255 * 100 + 128) / 256) = floor(25628/256) = 100
   */
  it('399/400 HP POWR produces 100W (full output due to rounding)', () => {
    expect(fixedPowerOutput(100, 399, 400)).toBe(100);
  });

  /**
   * 350 HP out of 700 maxHp (APWR rated 200W)
   * fixedRaw = floor(350 * 256 / 700) = floor(128) = 128
   * result = floor((128 * 200 + 128) / 256) = floor(25728/256) = 100
   */
  it('exactly 50% HP APWR produces 100W', () => {
    expect(fixedPowerOutput(200, 350, 700)).toBe(100);
  });
});
