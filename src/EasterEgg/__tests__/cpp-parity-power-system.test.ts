/**
 * C++ Behavioral Parity Tests: Power System
 *
 * Comprehensive tests covering:
 *   1. Power= production values for ALL power-producing structures (rules.ini)
 *   2. Power= drain values for ALL power-consuming structures (rules.ini)
 *   3. Power_Fraction() calculation (house.cpp:4160-4170)
 *   4. Low-power effects: radar, gap generators, tesla coils, superweapons
 *   5. Power grid recalculation when buildings are destroyed
 *   6. STRUCTURE_POWERED set membership (IsPowered from rules.ini Powered= field)
 *   7. Power output degradation with building damage (fixed-point arithmetic)
 *
 * C++ source of truth:
 *   house.cpp:4160-4170    Power_Fraction(): Power/Drain, 1 if Power>=Drain, 0 if Power==0
 *   house.cpp:7557-7561    Adjust_Power(): Power += adjust
 *   house.cpp:7580-7583    Adjust_Drain(): Drain += adjust
 *   building.cpp:4607-4616 Power_Output(): Class->Power * fixed(LastStrength, Class->MaxStrength)
 *   building.cpp:2270-2273 Limbo: Adjust_Power(-Power_Output()); Adjust_Drain(-Class->Drain)
 *   building.cpp:2395      Grand_Opening: Adjust_Drain(Class->Drain)
 *   building.cpp:2853      Can_Fire: IsPowered && Power_Fraction() < 1 -> FIRE_BUSY
 *   building.cpp:997-1002  Gap generator jam/unjam based on Power_Fraction()
 *   house.cpp:1292-1303    Radar blackout when Power_Fraction() < 1 && !IsGPSActive
 *   house.cpp:1410-1411    Superweapon suspension when Power_Fraction() < 1
 *   factory.cpp:434        Production rate: time / Bound(Power_Fraction(), 1/16, 1)
 *   bdata.cpp:3778-3781    INI parsing: Power field (positive=produces, negative=drain)
 *   bdata.cpp:3774         IsPowered from INI Powered= field
 *
 * rules.ini is the authoritative source for Power= values per structure.
 * C++ bdata.cpp constructor defaults are Power=0, Drain=0; rules.ini overrides.
 */

import { describe, it, expect } from 'vitest';
import {
  POWER_DRAIN,
  House,
  buildDefaultAlliances,
} from '../engine/types';
import {
  fixedPowerOutput,
  powerOutput,
  calculatePowerGrid,
  powerMultiplier,
} from '../engine/repairSell';
import {
  STRUCTURE_MAX_HP,
  STRUCTURE_POWERED,
} from '../engine/scenario';
import type { MapStructure } from '../engine/scenario';

// ---------------------------------------------------------------------------
// Helper to build MapStructure for calculatePowerGrid tests
// ---------------------------------------------------------------------------

function makeStruct(
  type: string, cx: number, cy: number, hp: number, maxHp: number,
  house: House = House.Spain,
): MapStructure {
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp, maxHp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function makeStructFullHp(type: string, cx: number, cy: number, house: House = House.Spain): MapStructure {
  const maxHp = STRUCTURE_MAX_HP[type] ?? 256;
  return makeStruct(type, cx, cy, maxHp, maxHp, house);
}

const alliances = buildDefaultAlliances();
const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

// ============================================================
// Section 1: Power= PRODUCTION values for all power-producing structures
//
// C++ rules.ini Power= field (positive = produces power)
// Only POWR and APWR produce power in Red Alert.
//
// C++ bdata.cpp:3778-3781:
//   Power = ini.Get_Int(Name(), "Power", (Power > 0) ? Power : -Drain);
//   if (Power < 0) { Drain = -Power; Power = 0; }
// ============================================================

describe('Power= production values match rules.ini (bdata.cpp:3778)', () => {
  // C++ rules.ini [POWR] Power=100
  it('POWR produces 100W at full health (rules.ini [POWR] Power=100)', () => {
    const maxHp = STRUCTURE_MAX_HP['POWR']; // 400
    expect(maxHp).toBe(400);
    expect(powerOutput('POWR', maxHp, maxHp)).toBe(100);
  });

  // C++ rules.ini [APWR] Power=200
  it('APWR produces 200W at full health (rules.ini [APWR] Power=200)', () => {
    const maxHp = STRUCTURE_MAX_HP['APWR']; // 700
    expect(maxHp).toBe(700);
    expect(powerOutput('APWR', maxHp, maxHp)).toBe(200);
  });

  // No other structures produce power
  it('non-power structures produce 0W', () => {
    const nonPower = [
      'WEAP', 'PROC', 'TENT', 'BARR', 'DOME', 'TSLA', 'GUN', 'AGUN',
      'SAM', 'PBOX', 'HBOX', 'FTUR', 'FACT', 'SILO', 'HPAD', 'AFLD',
      'ATEK', 'STEK', 'PDOX', 'IRON', 'MSLO', 'GAP', 'FIX', 'KENN',
      'SYRD', 'SPEN', 'BIO', 'HOSP',
    ];
    for (const type of nonPower) {
      expect(powerOutput(type, 400, 400), `${type} should produce 0W`).toBe(0);
    }
  });
});

// ============================================================
// Section 2: Power= DRAIN values for ALL power-consuming structures
//
// C++ rules.ini Power= field (negative value = drain)
// In C++ bdata.cpp:3779-3781: if (Power < 0) { Drain = -Power; Power = 0; }
//
// The TS POWER_DRAIN table should contain the absolute value of
// each negative Power= entry from rules.ini.
// ============================================================

describe('Power= drain values match rules.ini (bdata.cpp:3779-3781)', () => {
  // Complete mapping of rules.ini Power= (negative) to TS POWER_DRAIN
  // Source: public/ra/assets/rules.ini — each [SECTION] Power=<value>
  const RULES_INI_DRAIN: [string, number][] = [
    // [type, absolute drain from rules.ini]
    ['PROC',  30],   // rules.ini [PROC]  Power=-30
    ['WEAP',  30],   // rules.ini [WEAP]  Power=-30
    ['TENT',  20],   // rules.ini [TENT]  Power=-20
    ['BARR',  20],   // rules.ini [BARR]  Power=-20
    ['DOME',  40],   // rules.ini [DOME]  Power=-40
    ['TSLA', 150],   // rules.ini [TSLA]  Power=-150
    ['PBOX',  15],   // rules.ini [PBOX]  Power=-15
    ['HBOX',  15],   // rules.ini [HBOX]  Power=-15
    ['GUN',   40],   // rules.ini [GUN]   Power=-40
    ['SAM',   20],   // rules.ini [SAM]   Power=-20
    ['AGUN',  50],   // rules.ini [AGUN]  Power=-50
    ['FIX',   30],   // rules.ini [FIX]   Power=-30
    ['HPAD',  10],   // rules.ini [HPAD]  Power=-10
    ['AFLD',  30],   // rules.ini [AFLD]  Power=-30
    ['ATEK', 200],   // rules.ini [ATEK]  Power=-200
    ['STEK', 100],   // rules.ini [STEK]  Power=-100
    ['PDOX', 200],   // rules.ini [PDOX]  Power=-200
    ['IRON', 200],   // rules.ini [IRON]  Power=-200
    ['MSLO', 100],   // rules.ini [MSLO]  Power=-100
    ['GAP',   60],   // rules.ini [GAP]   Power=-60
    ['FTUR',  20],   // rules.ini [FTUR]  Power=-20
    ['SILO',  10],   // rules.ini [SILO]  Power=-10
    ['KENN',  10],   // rules.ini [KENN]  Power=-10
    ['SYRD',  30],   // rules.ini [SYRD]  Power=-30
    ['SPEN',  30],   // rules.ini [SPEN]  Power=-30
    ['BIO',   40],   // rules.ini [BIO]   Power=-40
    ['HOSP',  20],   // rules.ini [HOSP]  Power=-20
  ];

  it.each(RULES_INI_DRAIN)(
    '%s drains %d (rules.ini Power=-%d)',
    (type, drain) => {
      expect(POWER_DRAIN[type], `${type} drain mismatch`).toBe(drain);
    },
  );

  // Structures with Power=0 should NOT be in POWER_DRAIN (or be 0)
  it('FACT has Power=0 in rules.ini — no drain', () => {
    expect(POWER_DRAIN['FACT'] ?? 0).toBe(0);
  });

  // Power plants have positive Power= — they produce, not drain
  it('POWR has Power=100 (positive) — not a drain entry', () => {
    expect(POWER_DRAIN['POWR'] ?? 0).toBe(0);
  });

  it('APWR has Power=200 (positive) — not a drain entry', () => {
    expect(POWER_DRAIN['APWR'] ?? 0).toBe(0);
  });
});

// ============================================================
// Section 3: Power_Fraction() calculation
//
// C++ house.cpp:4160-4170:
//   fixed HouseClass::Power_Fraction(void) const {
//     if (Power >= Drain || Drain == 0) return(1);
//     if (Power) return(fixed(Power, Drain));
//     return(0);
//   }
//
// TS powerMultiplier() wraps this with factory.cpp:434 clamp:
//   Bound(Power_Fraction(), fixed(1,16), fixed(1))
// ============================================================

describe('Power_Fraction() calculation (house.cpp:4160-4170)', () => {
  // Case 1: Power >= Drain → return 1
  it('Power >= Drain returns 1.0', () => {
    expect(powerMultiplier(200, 100)).toBe(1.0);
    expect(powerMultiplier(100, 100)).toBe(1.0);
    expect(powerMultiplier(1000, 500)).toBe(1.0);
  });

  // Case 2: Drain == 0 → return 1
  it('Drain == 0 returns 1.0 regardless of Power', () => {
    expect(powerMultiplier(0, 0)).toBe(1.0);
    expect(powerMultiplier(100, 0)).toBe(1.0);
  });

  // Case 3: 0 < Power < Drain → return fixed(Power, Drain) = Power/Drain
  it('0 < Power < Drain: returns Power/Drain', () => {
    expect(powerMultiplier(50, 100)).toBe(0.5);
    expect(powerMultiplier(75, 100)).toBe(0.75);
    expect(powerMultiplier(25, 100)).toBe(0.25);
    expect(powerMultiplier(10, 100)).toBe(0.1);
    expect(powerMultiplier(90, 100)).toBe(0.9);
  });

  // Case 4: Power == 0, Drain > 0 → C++ returns 0, clamped to 1/16
  it('Power == 0 with Drain > 0: clamped to 1/16 (factory.cpp:434 Bound)', () => {
    // C++ house.cpp:4168: return(0)
    // factory.cpp:434: Bound(0, fixed(1,16), fixed(1)) = 1/16
    expect(powerMultiplier(0, 100)).toBe(1 / 16);
    expect(powerMultiplier(0, 500)).toBe(1 / 16);
  });

  // Clamp floor at 1/16 for very low fractions
  it('very low fractions clamped to 1/16 minimum', () => {
    expect(powerMultiplier(3, 100)).toBe(1 / 16);  // 0.03 < 0.0625
    expect(powerMultiplier(1, 100)).toBe(1 / 16);  // 0.01 < 0.0625
    expect(powerMultiplier(6, 100)).toBe(1 / 16);  // 0.06 < 0.0625
    expect(powerMultiplier(6.25, 100)).toBe(1 / 16); // exactly 0.0625
    expect(powerMultiplier(7, 100)).toBeGreaterThan(1 / 16); // 0.07 > 0.0625
  });

  // Monotonicity: higher power fraction = higher multiplier
  it('multiplier is monotonically non-decreasing with power fraction', () => {
    const drain = 100;
    let prevMult = 0;
    for (let power = 0; power <= drain; power++) {
      const mult = powerMultiplier(power, drain);
      expect(mult, `power=${power}`).toBeGreaterThanOrEqual(prevMult);
      prevMult = mult;
    }
  });
});

// ============================================================
// Section 4: Power grid aggregate calculation
//
// C++ house.cpp:975-981 recalculates Power and Drain each tick.
// C++ building.cpp:2270-2273 (Limbo):
//   House->Adjust_Power(-Power_Output());
//   House->Adjust_Drain(-Class->Drain);
// C++ building.cpp:2395 (Grand_Opening):
//   House->Adjust_Drain(Class->Drain);
// ============================================================

describe('calculatePowerGrid aggregate (house.cpp Adjust_Power/Adjust_Drain)', () => {
  it('single POWR at full health: 100 produced, 0 consumed', () => {
    const structs = [makeStructFullHp('POWR', 5, 5)];
    const { produced, consumed } = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(produced).toBe(100);
    expect(consumed).toBe(0);
  });

  it('single APWR at full health: 200 produced, 0 consumed', () => {
    const structs = [makeStructFullHp('APWR', 5, 5)];
    const { produced, consumed } = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(produced).toBe(200);
    expect(consumed).toBe(0);
  });

  it('POWR + APWR: 300 produced, 0 consumed', () => {
    const structs = [
      makeStructFullHp('POWR', 5, 5),
      makeStructFullHp('APWR', 8, 5),
    ];
    const { produced, consumed } = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(produced).toBe(300);
    expect(consumed).toBe(0);
  });

  it('POWR + TSLA: 100 produced, 150 consumed (deficit)', () => {
    const structs = [
      makeStructFullHp('POWR', 5, 5),
      makeStructFullHp('TSLA', 8, 5),
    ];
    const { produced, consumed } = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(produced).toBe(100);
    expect(consumed).toBe(150);
  });

  it('typical Soviet base: 2 POWR + BARR + WEAP + TSLA', () => {
    const structs = [
      makeStructFullHp('POWR', 5, 5),
      makeStructFullHp('POWR', 8, 5),
      makeStructFullHp('BARR', 10, 5),
      makeStructFullHp('WEAP', 12, 5),
      makeStructFullHp('TSLA', 14, 5),
    ];
    const { produced, consumed } = calculatePowerGrid(structs, House.Spain, isAllied);
    // 2 * 100 = 200 produced
    // 20 (BARR) + 30 (WEAP) + 150 (TSLA) = 200 consumed
    expect(produced).toBe(200);
    expect(consumed).toBe(200);
  });

  it('typical Allied base: POWR + APWR + TENT + DOME + GUN', () => {
    const structs = [
      makeStructFullHp('POWR', 5, 5),
      makeStructFullHp('APWR', 8, 5),
      makeStructFullHp('TENT', 10, 5),
      makeStructFullHp('DOME', 12, 5),
      makeStructFullHp('GUN', 14, 5),
    ];
    const { produced, consumed } = calculatePowerGrid(structs, House.Spain, isAllied);
    // 100 + 200 = 300 produced
    // 20 (TENT) + 40 (DOME) + 40 (GUN) = 100 consumed
    expect(produced).toBe(300);
    expect(consumed).toBe(100);
  });

  it('every drain structure contributes correctly to total consumption', () => {
    // Build one of every draining structure
    const drainTypes = Object.keys(POWER_DRAIN);
    let x = 0;
    const structs: MapStructure[] = drainTypes.map(type => {
      x += 3;
      return makeStructFullHp(type, x, 5);
    });

    // Add a POWR to keep things defined
    structs.push(makeStructFullHp('POWR', 0, 5));

    const { consumed } = calculatePowerGrid(structs, House.Spain, isAllied);
    const expectedTotal = drainTypes.reduce((sum, t) => sum + POWER_DRAIN[t], 0);
    expect(consumed).toBe(expectedTotal);
  });
});

// ============================================================
// Section 5: Losing a power plant reduces total power
//
// C++ building.cpp:2270-2273 (Limbo):
//   House->Adjust_Power(-Power_Output());
//   House->Adjust_Drain(-Class->Drain);
// When a power plant is destroyed (alive=false), it should no longer
// contribute to total produced power.
// ============================================================

describe('losing a power plant reduces total power (building.cpp:2270-2273)', () => {
  it('destroying one POWR drops produced from 200 to 100', () => {
    const powr1 = makeStructFullHp('POWR', 5, 5);
    const powr2 = makeStructFullHp('POWR', 8, 5);
    const structs = [powr1, powr2];

    // Before destruction
    let grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(200);

    // Destroy one
    powr1.alive = false;
    grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(100);
  });

  it('destroying APWR drops produced from 300 to 100', () => {
    const powr = makeStructFullHp('POWR', 5, 5);
    const apwr = makeStructFullHp('APWR', 8, 5);
    const structs = [powr, apwr];

    let grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(300);

    apwr.alive = false;
    grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(100);
  });

  it('damaging a POWR reduces its output proportionally (C++ fixed-point)', () => {
    const maxHp = STRUCTURE_MAX_HP['POWR']; // 400
    const powr = makeStruct('POWR', 5, 5, maxHp / 2, maxHp);
    const structs = [powr];

    const grid = calculatePowerGrid(structs, House.Spain, isAllied);
    // C++ fixed-point: fixedPowerOutput(100, 200, 400) = 50
    expect(grid.produced).toBe(50);
  });

  it('damaging an APWR reduces output proportionally (C++ fixed-point)', () => {
    const maxHp = STRUCTURE_MAX_HP['APWR']; // 700
    const apwr = makeStruct('APWR', 5, 5, maxHp / 2, maxHp);
    const structs = [apwr];

    const grid = calculatePowerGrid(structs, House.Spain, isAllied);
    // C++ fixed-point: fixedPowerOutput(200, 350, 700) = 100
    expect(grid.produced).toBe(100);
  });

  it('destroying a draining building reduces consumed power', () => {
    const tsla = makeStructFullHp('TSLA', 5, 5);
    const weap = makeStructFullHp('WEAP', 8, 5);
    const structs = [tsla, weap];

    let grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.consumed).toBe(150 + 30); // TSLA + WEAP

    tsla.alive = false;
    grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.consumed).toBe(30); // only WEAP
  });

  it('destroying all power plants causes power deficit', () => {
    const powr = makeStructFullHp('POWR', 5, 5);
    const dome = makeStructFullHp('DOME', 8, 5);
    const structs = [powr, dome];

    let grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(100);
    expect(grid.consumed).toBe(40);
    let frac = powerMultiplier(grid.produced, grid.consumed);
    expect(frac).toBe(1.0); // surplus

    // Destroy power plant
    powr.alive = false;
    grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(0);
    expect(grid.consumed).toBe(40);
    frac = powerMultiplier(grid.produced, grid.consumed);
    expect(frac).toBe(1 / 16); // clamped to minimum (0 power, non-zero drain)
  });
});

// ============================================================
// Section 6: STRUCTURE_POWERED set membership
//
// C++ bdata.cpp:3774: IsPowered = ini.Get_Bool(Name(), "Powered", IsPowered);
// C++ default is false. Only structures with Powered=true in rules.ini are powered.
//
// rules.ini Powered=true entries:
//   [IRON] Powered=true   (line 1217)
//   [PDOX] Powered=true   (line 1261)
//   [TSLA] Powered=true   (line 1355)
//   [DOME] Powered=true   (line 1478)
//   [GAP]  Powered=true   (line 1494)
// ============================================================

describe('STRUCTURE_POWERED matches rules.ini Powered=true (bdata.cpp:3774)', () => {
  const POWERED_IN_RULES_INI = ['IRON', 'PDOX', 'TSLA', 'DOME', 'GAP'];

  it.each(POWERED_IN_RULES_INI)(
    '%s has Powered=true in rules.ini',
    (type) => {
      expect(STRUCTURE_POWERED.has(type), `${type} should be POWERED`).toBe(true);
    },
  );

  // All other structures have IsPowered=false (default from bdata.cpp:2836)
  const NOT_POWERED_IN_RULES_INI = [
    'POWR', 'APWR', 'PROC', 'WEAP', 'TENT', 'BARR', 'PBOX', 'HBOX',
    'GUN', 'SAM', 'AGUN', 'FTUR', 'FACT', 'SILO', 'HPAD', 'AFLD',
    'ATEK', 'STEK', 'MSLO', 'FIX', 'KENN', 'SYRD', 'SPEN', 'BIO', 'HOSP',
  ];

  it.each(NOT_POWERED_IN_RULES_INI)(
    '%s does NOT have Powered=true in rules.ini',
    (type) => {
      expect(STRUCTURE_POWERED.has(type), `${type} should NOT be POWERED`).toBe(false);
    },
  );

  it('STRUCTURE_POWERED has exactly 5 entries', () => {
    expect(STRUCTURE_POWERED.size).toBe(5);
  });
});

// ============================================================
// Section 7: Power output degradation with building damage
//
// C++ building.cpp:4607-4616:
//   int BuildingClass::Power_Output(void) const {
//     if (Class->Power) {
//       return(Class->Power * fixed(LastStrength, Class->MaxStrength));
//     }
//     return(0);
//   }
//
// fixed(n, d) = floor(n * 256 / d)                     (truncation)
// fixed * int = floor((fixedRaw * rvalue + 128) / 256)  (rounded)
// ============================================================

describe('power output degradation with damage (building.cpp:4613)', () => {
  // POWR: rated 100W, maxHp = 400
  describe('POWR (100W rated, 400 maxHp)', () => {
    const POWR_CASES: [number, number][] = [
      // [hp, expected C++ output]
      [400, 100],   // full health
      [300, 75],    // 75%
      [200, 50],    // 50%
      [100, 25],    // 25%
      [0,   0],     // dead
    ];

    it.each(POWR_CASES)(
      'hp=%d -> %dW',
      (hp, expected) => {
        expect(fixedPowerOutput(100, hp, 400)).toBe(expected);
        expect(powerOutput('POWR', hp, 400)).toBe(expected);
      },
    );
  });

  // APWR: rated 200W, maxHp = 700
  describe('APWR (200W rated, 700 maxHp)', () => {
    const APWR_CASES: [number, number][] = [
      // [hp, expected C++ output]
      [700, 200],   // full health
      [525, 150],   // 75%
      [350, 100],   // 50%
      [175, 50],    // 25%
      [0,   0],     // dead
    ];

    it.each(APWR_CASES)(
      'hp=%d -> %dW',
      (hp, expected) => {
        expect(fixedPowerOutput(200, hp, 700)).toBe(expected);
        expect(powerOutput('APWR', hp, 700)).toBe(expected);
      },
    );
  });

  // Extreme damage scenarios — C++ fixed-point truncation matters
  describe('extreme damage (fixed-point truncation effects)', () => {
    it('POWR at 1 HP: C++ fixed-point truncation yields 0W', () => {
      // fixed(1, 400) = floor(1 * 256 / 400) = floor(0.64) = 0
      // 0 * 100 = 0
      expect(fixedPowerOutput(100, 1, 400)).toBe(0);
    });

    it('APWR at 1 HP: C++ fixed-point truncation yields 0W', () => {
      // fixed(1, 700) = floor(1 * 256 / 700) = floor(0.365) = 0
      expect(fixedPowerOutput(200, 1, 700)).toBe(0);
    });

    it('POWR at 2 HP: C++ fixed-point truncation yields 0W', () => {
      // fixed(2, 400) = floor(2 * 256 / 400) = floor(1.28) = 1
      // floor((1 * 100 + 128) / 256) = floor(0.890625) = 0
      expect(fixedPowerOutput(100, 2, 400)).toBe(0);
    });

    it('POWR at 399 HP: C++ fixed-point yields 99W', () => {
      // fixed(399, 400) = floor(399 * 256 / 400) = floor(255.36) = 255
      // floor((255 * 100 + 128) / 256) = floor(100.109375) = 100
      // Wait: 255 * 100 = 25500; 25500 + 128 = 25628; 25628 / 256 = 100.109375 → 100
      expect(fixedPowerOutput(100, 399, 400)).toBe(100);
    });

    it('APWR at 699 HP: C++ fixed-point yields 199W', () => {
      // fixed(699, 700) = floor(699 * 256 / 700) = floor(255.634...) = 255
      // floor((255 * 200 + 128) / 256) = floor(199.71875) = 199
      expect(fixedPowerOutput(200, 699, 700)).toBe(199);
    });
  });
});

// ============================================================
// Section 8: Low-power effects integration
//
// When Power_Fraction() < 1, multiple systems are affected:
//   - Powered defenses can't fire (building.cpp:2853)
//   - Radar goes dark (house.cpp:1292)
//   - Gap generators stop jamming (building.cpp:997-1002)
//   - Superweapons are suspended (house.cpp:1410-1411)
//   - Production slows (factory.cpp:434)
//
// These tests verify the DATA relationships that underpin these effects,
// not the full combat/render integration (those are in cpp-parity-power-down.test.ts).
// ============================================================

describe('low-power effects — data-level verification', () => {
  describe('Tesla coil (TSLA) requires power', () => {
    it('TSLA is in STRUCTURE_POWERED — disabled when Power_Fraction() < 1', () => {
      expect(STRUCTURE_POWERED.has('TSLA')).toBe(true);
    });

    it('TSLA drains 150 — a significant fraction of one POWR (100)', () => {
      // One TSLA instantly causes power deficit with one POWR
      expect(POWER_DRAIN['TSLA']).toBe(150);
      expect(POWER_DRAIN['TSLA']).toBeGreaterThan(100); // > 1 POWR
    });
  });

  describe('radar (DOME) requires power', () => {
    it('DOME is in STRUCTURE_POWERED', () => {
      expect(STRUCTURE_POWERED.has('DOME')).toBe(true);
    });

    it('DOME drains 40', () => {
      expect(POWER_DRAIN['DOME']).toBe(40);
    });
  });

  describe('gap generator (GAP) requires power', () => {
    it('GAP is in STRUCTURE_POWERED', () => {
      expect(STRUCTURE_POWERED.has('GAP')).toBe(true);
    });

    it('GAP drains 60', () => {
      expect(POWER_DRAIN['GAP']).toBe(60);
    });
  });

  describe('superweapons require power', () => {
    // C++ house.cpp:1410-1411: if (IsPowered) super->Suspend(Power_Fraction() < 1)
    it('Chronosphere (PDOX) is powered', () => {
      expect(STRUCTURE_POWERED.has('PDOX')).toBe(true);
    });

    it('Iron Curtain (IRON) is powered', () => {
      expect(STRUCTURE_POWERED.has('IRON')).toBe(true);
    });

    it('PDOX drains 200', () => {
      expect(POWER_DRAIN['PDOX']).toBe(200);
    });

    it('IRON drains 200', () => {
      expect(POWER_DRAIN['IRON']).toBe(200);
    });
  });

  describe('GUN and AGUN are NOT powered — fire regardless of power', () => {
    // C++ bdata.cpp: GUN and AGUN have IsPowered=false (default)
    // They fire even during total power blackout
    it('GUN is not in STRUCTURE_POWERED', () => {
      expect(STRUCTURE_POWERED.has('GUN')).toBe(false);
    });

    it('AGUN is not in STRUCTURE_POWERED', () => {
      expect(STRUCTURE_POWERED.has('AGUN')).toBe(false);
    });

    it('SAM is not in STRUCTURE_POWERED', () => {
      expect(STRUCTURE_POWERED.has('SAM')).toBe(false);
    });
  });

  describe('production speed penalty under low power (factory.cpp:434)', () => {
    it('full power: production at normal speed (multiplier = 1.0)', () => {
      const powr = makeStructFullHp('POWR', 5, 5);
      const tent = makeStructFullHp('TENT', 8, 5);
      const grid = calculatePowerGrid([powr, tent], House.Spain, isAllied);
      // 100 produced, 20 consumed — surplus
      expect(powerMultiplier(grid.produced, grid.consumed)).toBe(1.0);
    });

    it('deficit: production slows proportionally', () => {
      const powr = makeStructFullHp('POWR', 5, 5);
      const tsla = makeStructFullHp('TSLA', 8, 5);
      const weap = makeStructFullHp('WEAP', 10, 5);
      const barr = makeStructFullHp('BARR', 12, 5);
      const grid = calculatePowerGrid([powr, tsla, weap, barr], House.Spain, isAllied);
      // 100 produced, 150+30+20=200 consumed
      expect(grid.produced).toBe(100);
      expect(grid.consumed).toBe(200);
      const mult = powerMultiplier(grid.produced, grid.consumed);
      expect(mult).toBe(0.5); // 100/200 = 0.5 → 2x slower
    });

    it('total power loss: production at 1/16 speed (16x slower)', () => {
      const dome = makeStructFullHp('DOME', 5, 5);
      const grid = calculatePowerGrid([dome], House.Spain, isAllied);
      // 0 produced, 40 consumed
      expect(grid.produced).toBe(0);
      expect(grid.consumed).toBe(40);
      const mult = powerMultiplier(grid.produced, grid.consumed);
      expect(mult).toBe(1 / 16);
    });
  });
});

// ============================================================
// Section 9: Enemy structures do not affect player power
//
// C++ house.cpp tracks power PER HOUSE. Enemy buildings contribute
// to their own house's power grid, not the player's.
// ============================================================

describe('enemy structures excluded from player power grid', () => {
  it('enemy POWR does not add to player produced', () => {
    const enemyPowr = makeStructFullHp('POWR', 5, 5, House.USSR);
    const grid = calculatePowerGrid([enemyPowr], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
    expect(grid.consumed).toBe(0);
  });

  it('enemy TSLA does not add to player consumed', () => {
    const enemyTsla = makeStructFullHp('TSLA', 5, 5, House.USSR);
    const grid = calculatePowerGrid([enemyTsla], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
    expect(grid.consumed).toBe(0);
  });

  it('mixed player + enemy: only player structures count', () => {
    const playerPowr = makeStructFullHp('POWR', 5, 5, House.Spain);
    const playerTent = makeStructFullHp('TENT', 8, 5, House.Spain);
    const enemyApwr = makeStructFullHp('APWR', 12, 5, House.USSR);
    const enemyTsla = makeStructFullHp('TSLA', 15, 5, House.USSR);

    const grid = calculatePowerGrid(
      [playerPowr, playerTent, enemyApwr, enemyTsla],
      House.Spain, isAllied,
    );
    expect(grid.produced).toBe(100);
    expect(grid.consumed).toBe(20); // only TENT
  });
});

// ============================================================
// Section 10: Realistic base power scenarios
//
// Test complete power budgets for typical base configurations,
// validating that the cumulative effect of all buildings matches
// rules.ini expected values.
// ============================================================

describe('realistic base power scenarios', () => {
  it('early Allied base: POWR + TENT + PBOX + PROC → surplus', () => {
    const structs = [
      makeStructFullHp('POWR', 5, 5),   // +100
      makeStructFullHp('TENT', 8, 5),   // -20
      makeStructFullHp('PBOX', 10, 5),  // -15
      makeStructFullHp('PROC', 12, 5),  // -30
    ];
    const grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(100);
    expect(grid.consumed).toBe(65);   // 20+15+30
    expect(powerMultiplier(grid.produced, grid.consumed)).toBe(1.0);
  });

  it('Soviet tech rush: 2 POWR + BARR + WEAP + TSLA + STEK → deficit', () => {
    const structs = [
      makeStructFullHp('POWR', 5, 5),   // +100
      makeStructFullHp('POWR', 8, 5),   // +100
      makeStructFullHp('BARR', 10, 5),  // -20
      makeStructFullHp('WEAP', 12, 5),  // -30
      makeStructFullHp('TSLA', 14, 5),  // -150
      makeStructFullHp('STEK', 16, 5),  // -100
    ];
    const grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(200);
    expect(grid.consumed).toBe(300);   // 20+30+150+100
    const frac = powerMultiplier(grid.produced, grid.consumed);
    expect(frac).toBeCloseTo(200 / 300, 6); // ~0.667
  });

  it('full Allied endgame: POWR + 2 APWR + TENT + DOME + 2 GUN + AGUN + ATEK + PDOX + PROC', () => {
    const structs = [
      makeStructFullHp('POWR', 2, 2),   // +100
      makeStructFullHp('APWR', 5, 2),   // +200
      makeStructFullHp('APWR', 8, 2),   // +200
      makeStructFullHp('TENT', 10, 2),  // -20
      makeStructFullHp('DOME', 12, 2),  // -40
      makeStructFullHp('GUN', 14, 2),   // -40
      makeStructFullHp('GUN', 16, 2),   // -40
      makeStructFullHp('AGUN', 18, 2),  // -50
      makeStructFullHp('ATEK', 20, 2),  // -200
      makeStructFullHp('PDOX', 22, 2),  // -200
      makeStructFullHp('PROC', 24, 2),  // -30
    ];
    const grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(500);    // 100+200+200
    expect(grid.consumed).toBe(620);    // 20+40+40+40+50+200+200+30
    const frac = powerMultiplier(grid.produced, grid.consumed);
    expect(frac).toBeCloseTo(500 / 620, 6); // ~0.806
  });
});

// ============================================================
// Section 11: Edge cases
// ============================================================

describe('power system edge cases', () => {
  it('zero structures: 0 produced, 0 consumed', () => {
    const grid = calculatePowerGrid([], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
    expect(grid.consumed).toBe(0);
    expect(powerMultiplier(grid.produced, grid.consumed)).toBe(1.0);
  });

  it('dead POWR produces 0 power', () => {
    const powr = makeStructFullHp('POWR', 5, 5);
    powr.alive = false;
    const grid = calculatePowerGrid([powr], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
  });

  it('dead draining structure consumes 0 power', () => {
    const tsla = makeStructFullHp('TSLA', 5, 5);
    tsla.alive = false;
    const grid = calculatePowerGrid([tsla], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('POWR at exactly 0 HP outputs 0W (fixedPowerOutput guard)', () => {
    expect(fixedPowerOutput(100, 0, 400)).toBe(0);
    expect(fixedPowerOutput(200, 0, 700)).toBe(0);
  });

  it('negative produced is clamped to 1/16 floor', () => {
    expect(powerMultiplier(-10, 100)).toBe(1 / 16);
  });

  it('very large drain with tiny production: clamped to 1/16', () => {
    expect(powerMultiplier(1, 10000)).toBe(1 / 16);
  });
});
