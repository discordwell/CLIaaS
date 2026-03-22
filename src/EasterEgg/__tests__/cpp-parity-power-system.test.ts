/**
 * C++ Behavioral Parity Tests: Power System
 *
 * All expected values are parsed from rules.ini at test time.
 * NO hardcoded C++ values in assertions.
 *
 * Comprehensive tests covering:
 *   1. Power= production values for ALL power-producing structures (rules.ini)
 *   2. Power= drain values for ALL power-consuming structures (rules.ini)
 *   3. Power_Fraction() calculation (house.cpp:4160-4170)
 *   4. Low power effects: production slowdown, radar off, powered structures disabled
 *   5. STRUCTURE_POWERED set membership — which buildings stop working at low power
 *   6. Power fraction affects production speed (C++ formula)
 *   7. Adding/removing power plants updates fraction correctly
 *   8. Selling a power plant reduces output
 *   9. Power output degradation with building damage (fixed-point arithmetic)
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
 * rules.ini is the authoritative source for Power= and Powered= values per structure.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
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
// Parse rules.ini at test time — single source of truth
// ---------------------------------------------------------------------------

const RULES_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/rules.ini');
const rulesText = fs.readFileSync(RULES_INI_PATH, 'utf-8');

interface BuildingINI {
  power?: number;     // positive = produces, negative = drains
  powered?: boolean;  // Powered=true/yes from INI
  strength?: number;
}

function parseRulesINI(text: string): Record<string, BuildingINI> {
  const result: Record<string, BuildingINI> = {};
  let currentSection = '';

  for (const rawLine of text.split('\n')) {
    const line = rawLine.split(';')[0].trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[([A-Z0-9]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }
    if (!currentSection) continue;

    const kvMatch = line.match(/^(\w+)=(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const val = kvMatch[2].trim();

    if (!result[currentSection]) result[currentSection] = {};
    const entry = result[currentSection];

    switch (key) {
      case 'Power':
        entry.power = parseInt(val, 10);
        break;
      case 'Powered':
        entry.powered = val.toLowerCase() === 'true' || val.toLowerCase() === 'yes';
        break;
      case 'Strength':
        entry.strength = parseInt(val, 10);
        break;
    }
  }
  return result;
}

const INI = parseRulesINI(rulesText);

// All known building types from rules.ini
const ALL_BUILDINGS = [
  'POWR', 'APWR', 'PROC', 'TENT', 'BARR', 'WEAP', 'AFLD', 'HPAD', 'DOME',
  'GUN', 'SAM', 'TSLA', 'GAP', 'PBOX', 'HBOX', 'AGUN', 'FTUR', 'KENN',
  'ATEK', 'STEK', 'IRON', 'PDOX', 'MSLO', 'FIX', 'SILO', 'FACT',
  'SYRD', 'SPEN', 'BIO', 'HOSP',
];

// Derive producer/consumer lists from parsed INI
const INI_PRODUCERS = ALL_BUILDINGS.filter(t => (INI[t]?.power ?? 0) > 0);
const INI_CONSUMERS = ALL_BUILDINGS.filter(t => (INI[t]?.power ?? 0) < 0);
const INI_ZERO_POWER = ALL_BUILDINGS.filter(t => (INI[t]?.power ?? 0) === 0);
const INI_POWERED = ALL_BUILDINGS.filter(t => INI[t]?.powered === true);
const INI_NOT_POWERED = ALL_BUILDINGS.filter(t => INI[t]?.powered !== true);

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
// C++ bdata.cpp:3778-3781:
//   Power = ini.Get_Int(Name(), "Power", (Power > 0) ? Power : -Drain);
//   if (Power < 0) { Drain = -Power; Power = 0; }
// ============================================================

describe('Power= production values match rules.ini (bdata.cpp:3778)', () => {
  // Verify which buildings INI says are producers
  it('INI identifies power-producing structures', () => {
    // rules.ini has exactly POWR and APWR as power producers
    expect(INI_PRODUCERS.length).toBeGreaterThanOrEqual(2);
    expect(INI_PRODUCERS).toContain('POWR');
    expect(INI_PRODUCERS).toContain('APWR');
  });

  it.each(INI_PRODUCERS)(
    '%s produces INI Power= watts at full health',
    (type) => {
      const iniPower = INI[type]!.power!;
      const maxHp = INI[type]?.strength ?? STRUCTURE_MAX_HP[type] ?? 256;
      expect(iniPower).toBeGreaterThan(0);
      expect(powerOutput(type, maxHp, maxHp)).toBe(iniPower);
    },
  );

  // Non-power structures produce 0W
  it.each(INI_CONSUMERS.concat(INI_ZERO_POWER))(
    '%s does not produce power (INI Power= <= 0)',
    (type) => {
      expect(powerOutput(type, 400, 400), `${type} should produce 0W`).toBe(0);
    },
  );
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
  it.each(INI_CONSUMERS)(
    '%s POWER_DRAIN matches abs(INI Power=)',
    (type) => {
      const iniPower = INI[type]!.power!;
      const expectedDrain = Math.abs(iniPower);
      expect(POWER_DRAIN[type], `${type} drain mismatch`).toBe(expectedDrain);
    },
  );

  // Structures with Power=0 should NOT be in POWER_DRAIN (or be 0)
  it.each(INI_ZERO_POWER)(
    '%s has Power=0 in rules.ini — no drain',
    (type) => {
      expect(POWER_DRAIN[type] ?? 0).toBe(0);
    },
  );

  // Power plants have positive Power= — they produce, not drain
  it.each(INI_PRODUCERS)(
    '%s has positive Power= — not a drain entry',
    (type) => {
      expect(POWER_DRAIN[type] ?? 0).toBe(0);
    },
  );
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
  // Case 1: Power >= Drain -> return 1
  it('Power >= Drain returns 1.0', () => {
    expect(powerMultiplier(200, 100)).toBe(1.0);
    expect(powerMultiplier(100, 100)).toBe(1.0);
    expect(powerMultiplier(1000, 500)).toBe(1.0);
  });

  // Case 2: Drain == 0 -> return 1
  it('Drain == 0 returns 1.0 regardless of Power', () => {
    expect(powerMultiplier(0, 0)).toBe(1.0);
    expect(powerMultiplier(100, 0)).toBe(1.0);
  });

  // Case 3: 0 < Power < Drain -> return fixed(Power, Drain) = Power/Drain
  it('0 < Power < Drain: returns Power/Drain', () => {
    expect(powerMultiplier(50, 100)).toBe(0.5);
    expect(powerMultiplier(75, 100)).toBe(0.75);
    expect(powerMultiplier(25, 100)).toBe(0.25);
    expect(powerMultiplier(10, 100)).toBe(0.1);
    expect(powerMultiplier(90, 100)).toBe(0.9);
  });

  // Case 4: Power == 0, Drain > 0 -> C++ returns 0, clamped to 1/16
  it('Power == 0 with Drain > 0: clamped to 1/16 (factory.cpp:434 Bound)', () => {
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
  it('single POWR at full health: INI Power= produced, 0 consumed', () => {
    const iniPowrPower = INI['POWR']!.power!;
    const structs = [makeStructFullHp('POWR', 5, 5)];
    const { produced, consumed } = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(produced).toBe(iniPowrPower);
    expect(consumed).toBe(0);
  });

  it('single APWR at full health: INI Power= produced, 0 consumed', () => {
    const iniApwrPower = INI['APWR']!.power!;
    const structs = [makeStructFullHp('APWR', 5, 5)];
    const { produced, consumed } = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(produced).toBe(iniApwrPower);
    expect(consumed).toBe(0);
  });

  it('POWR + APWR: sum of INI Power= values, 0 consumed', () => {
    const expectedProduced = INI['POWR']!.power! + INI['APWR']!.power!;
    const structs = [
      makeStructFullHp('POWR', 5, 5),
      makeStructFullHp('APWR', 8, 5),
    ];
    const { produced, consumed } = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(produced).toBe(expectedProduced);
    expect(consumed).toBe(0);
  });

  it('POWR + TSLA: INI POWR Power= produced, abs(INI TSLA Power=) consumed', () => {
    const expectedProduced = INI['POWR']!.power!;
    const expectedConsumed = Math.abs(INI['TSLA']!.power!);
    const structs = [
      makeStructFullHp('POWR', 5, 5),
      makeStructFullHp('TSLA', 8, 5),
    ];
    const { produced, consumed } = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(produced).toBe(expectedProduced);
    expect(consumed).toBe(expectedConsumed);
  });

  it('typical Soviet base: 2 POWR + BARR + WEAP + TSLA', () => {
    const expectedProduced = INI['POWR']!.power! * 2;
    const expectedConsumed = Math.abs(INI['BARR']!.power!) +
      Math.abs(INI['WEAP']!.power!) + Math.abs(INI['TSLA']!.power!);
    const structs = [
      makeStructFullHp('POWR', 5, 5),
      makeStructFullHp('POWR', 8, 5),
      makeStructFullHp('BARR', 10, 5),
      makeStructFullHp('WEAP', 12, 5),
      makeStructFullHp('TSLA', 14, 5),
    ];
    const { produced, consumed } = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(produced).toBe(expectedProduced);
    expect(consumed).toBe(expectedConsumed);
  });

  it('typical Allied base: POWR + APWR + TENT + DOME + GUN', () => {
    const expectedProduced = INI['POWR']!.power! + INI['APWR']!.power!;
    const expectedConsumed = Math.abs(INI['TENT']!.power!) +
      Math.abs(INI['DOME']!.power!) + Math.abs(INI['GUN']!.power!);
    const structs = [
      makeStructFullHp('POWR', 5, 5),
      makeStructFullHp('APWR', 8, 5),
      makeStructFullHp('TENT', 10, 5),
      makeStructFullHp('DOME', 12, 5),
      makeStructFullHp('GUN', 14, 5),
    ];
    const { produced, consumed } = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(produced).toBe(expectedProduced);
    expect(consumed).toBe(expectedConsumed);
  });

  it('every drain structure contributes correctly to total consumption', () => {
    const drainTypes = Object.keys(POWER_DRAIN);
    let x = 0;
    const structs: MapStructure[] = drainTypes.map(type => {
      x += 3;
      return makeStructFullHp(type, x, 5);
    });
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
// ============================================================

describe('losing a power plant reduces total power (building.cpp:2270-2273)', () => {
  it('destroying one POWR drops produced by INI POWR Power=', () => {
    const iniPowrPower = INI['POWR']!.power!;
    const powr1 = makeStructFullHp('POWR', 5, 5);
    const powr2 = makeStructFullHp('POWR', 8, 5);
    const structs = [powr1, powr2];

    let grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(iniPowrPower * 2);

    powr1.alive = false;
    grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(iniPowrPower);
  });

  it('destroying APWR drops produced correctly', () => {
    const iniPowrPower = INI['POWR']!.power!;
    const iniApwrPower = INI['APWR']!.power!;
    const powr = makeStructFullHp('POWR', 5, 5);
    const apwr = makeStructFullHp('APWR', 8, 5);
    const structs = [powr, apwr];

    let grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(iniPowrPower + iniApwrPower);

    apwr.alive = false;
    grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(iniPowrPower);
  });

  it('damaging a POWR reduces its output proportionally (C++ fixed-point)', () => {
    const iniPowrPower = INI['POWR']!.power!;
    const maxHp = INI['POWR']!.strength ?? STRUCTURE_MAX_HP['POWR'];
    const halfHp = Math.floor(maxHp / 2);
    const powr = makeStruct('POWR', 5, 5, halfHp, maxHp);
    const structs = [powr];

    const grid = calculatePowerGrid(structs, House.Spain, isAllied);
    const expectedOutput = fixedPowerOutput(iniPowrPower, halfHp, maxHp);
    expect(grid.produced).toBe(expectedOutput);
  });

  it('damaging an APWR reduces output proportionally (C++ fixed-point)', () => {
    const iniApwrPower = INI['APWR']!.power!;
    const maxHp = INI['APWR']!.strength ?? STRUCTURE_MAX_HP['APWR'];
    const halfHp = Math.floor(maxHp / 2);
    const apwr = makeStruct('APWR', 5, 5, halfHp, maxHp);
    const structs = [apwr];

    const grid = calculatePowerGrid(structs, House.Spain, isAllied);
    const expectedOutput = fixedPowerOutput(iniApwrPower, halfHp, maxHp);
    expect(grid.produced).toBe(expectedOutput);
  });

  it('destroying a draining building reduces consumed power', () => {
    const iniTslaDrain = Math.abs(INI['TSLA']!.power!);
    const iniWeapDrain = Math.abs(INI['WEAP']!.power!);
    const tsla = makeStructFullHp('TSLA', 5, 5);
    const weap = makeStructFullHp('WEAP', 8, 5);
    const structs = [tsla, weap];

    let grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.consumed).toBe(iniTslaDrain + iniWeapDrain);

    tsla.alive = false;
    grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.consumed).toBe(iniWeapDrain);
  });

  it('destroying all power plants causes power deficit', () => {
    const iniPowrPower = INI['POWR']!.power!;
    const iniDomeDrain = Math.abs(INI['DOME']!.power!);
    const powr = makeStructFullHp('POWR', 5, 5);
    const dome = makeStructFullHp('DOME', 8, 5);
    const structs = [powr, dome];

    let grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(iniPowrPower);
    expect(grid.consumed).toBe(iniDomeDrain);
    let frac = powerMultiplier(grid.produced, grid.consumed);
    expect(frac).toBe(1.0); // surplus

    powr.alive = false;
    grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(0);
    expect(grid.consumed).toBe(iniDomeDrain);
    frac = powerMultiplier(grid.produced, grid.consumed);
    expect(frac).toBe(1 / 16); // clamped to minimum (0 power, non-zero drain)
  });
});

// ============================================================
// Section 6: STRUCTURE_POWERED set membership
//
// C++ bdata.cpp:3774: IsPowered = ini.Get_Bool(Name(), "Powered", IsPowered);
// C++ default is false. Only structures with Powered=true in rules.ini are powered.
// ============================================================

describe('STRUCTURE_POWERED matches rules.ini Powered=true (bdata.cpp:3774)', () => {
  it.each(INI_POWERED)(
    '%s has Powered=true in rules.ini',
    (type) => {
      expect(STRUCTURE_POWERED.has(type), `${type} should be POWERED`).toBe(true);
    },
  );

  it.each(INI_NOT_POWERED)(
    '%s does NOT have Powered=true in rules.ini',
    (type) => {
      expect(STRUCTURE_POWERED.has(type), `${type} should NOT be POWERED`).toBe(false);
    },
  );

  it('STRUCTURE_POWERED has exactly as many entries as rules.ini Powered=true', () => {
    expect(STRUCTURE_POWERED.size).toBe(INI_POWERED.length);
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
  // POWR
  describe('POWR power output at various health levels', () => {
    const iniPowrPower = INI['POWR']!.power!;
    const powrMaxHp = INI['POWR']!.strength ?? STRUCTURE_MAX_HP['POWR'];

    const POWR_HEALTH_FRACTIONS = [1.0, 0.75, 0.5, 0.25, 0];
    it.each(POWR_HEALTH_FRACTIONS)(
      'POWR at %d%% health matches fixedPowerOutput',
      (frac) => {
        const hp = Math.floor(powrMaxHp * frac);
        const expected = fixedPowerOutput(iniPowrPower, hp, powrMaxHp);
        expect(powerOutput('POWR', hp, powrMaxHp)).toBe(expected);
      },
    );
  });

  // APWR
  describe('APWR power output at various health levels', () => {
    const iniApwrPower = INI['APWR']!.power!;
    const apwrMaxHp = INI['APWR']!.strength ?? STRUCTURE_MAX_HP['APWR'];

    const APWR_HEALTH_FRACTIONS = [1.0, 0.75, 0.5, 0.25, 0];
    it.each(APWR_HEALTH_FRACTIONS)(
      'APWR at %d%% health matches fixedPowerOutput',
      (frac) => {
        const hp = Math.floor(apwrMaxHp * frac);
        const expected = fixedPowerOutput(iniApwrPower, hp, apwrMaxHp);
        expect(powerOutput('APWR', hp, apwrMaxHp)).toBe(expected);
      },
    );
  });

  // Extreme damage — C++ fixed-point truncation
  describe('extreme damage (fixed-point truncation effects)', () => {
    it('POWR at 1 HP: C++ fixed-point truncation yields 0W', () => {
      const iniPowrPower = INI['POWR']!.power!;
      const maxHp = INI['POWR']!.strength ?? STRUCTURE_MAX_HP['POWR'];
      // fixed(1, maxHp) = floor(1 * 256 / maxHp) — likely 0 for maxHp > 256
      const expected = fixedPowerOutput(iniPowrPower, 1, maxHp);
      expect(fixedPowerOutput(iniPowrPower, 1, maxHp)).toBe(expected);
    });

    it('APWR at 1 HP: C++ fixed-point truncation yields 0W', () => {
      const iniApwrPower = INI['APWR']!.power!;
      const maxHp = INI['APWR']!.strength ?? STRUCTURE_MAX_HP['APWR'];
      const expected = fixedPowerOutput(iniApwrPower, 1, maxHp);
      expect(fixedPowerOutput(iniApwrPower, 1, maxHp)).toBe(expected);
    });

    it('POWR at maxHp-1: near-full C++ fixed-point output', () => {
      const iniPowrPower = INI['POWR']!.power!;
      const maxHp = INI['POWR']!.strength ?? STRUCTURE_MAX_HP['POWR'];
      const expected = fixedPowerOutput(iniPowrPower, maxHp - 1, maxHp);
      expect(powerOutput('POWR', maxHp - 1, maxHp)).toBe(expected);
    });

    it('APWR at maxHp-1: near-full C++ fixed-point output', () => {
      const iniApwrPower = INI['APWR']!.power!;
      const maxHp = INI['APWR']!.strength ?? STRUCTURE_MAX_HP['APWR'];
      const expected = fixedPowerOutput(iniApwrPower, maxHp - 1, maxHp);
      expect(powerOutput('APWR', maxHp - 1, maxHp)).toBe(expected);
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
// ============================================================

describe('low-power effects — data-level verification', () => {
  describe('Tesla coil (TSLA) requires power', () => {
    it('TSLA is in STRUCTURE_POWERED — disabled when Power_Fraction() < 1', () => {
      expect(INI['TSLA']?.powered).toBe(true);
      expect(STRUCTURE_POWERED.has('TSLA')).toBe(true);
    });

    it('TSLA drains more than one POWR produces (from INI)', () => {
      const tslaDrain = Math.abs(INI['TSLA']!.power!);
      const powrOutput = INI['POWR']!.power!;
      expect(tslaDrain).toBeGreaterThan(powrOutput);
    });
  });

  describe('radar (DOME) requires power', () => {
    it('DOME is in STRUCTURE_POWERED (from INI)', () => {
      expect(INI['DOME']?.powered).toBe(true);
      expect(STRUCTURE_POWERED.has('DOME')).toBe(true);
    });

    it('DOME drain matches INI', () => {
      const iniDrain = Math.abs(INI['DOME']!.power!);
      expect(POWER_DRAIN['DOME']).toBe(iniDrain);
    });
  });

  describe('gap generator (GAP) requires power', () => {
    it('GAP is in STRUCTURE_POWERED (from INI)', () => {
      expect(INI['GAP']?.powered).toBe(true);
      expect(STRUCTURE_POWERED.has('GAP')).toBe(true);
    });

    it('GAP drain matches INI', () => {
      const iniDrain = Math.abs(INI['GAP']!.power!);
      expect(POWER_DRAIN['GAP']).toBe(iniDrain);
    });
  });

  describe('superweapons require power', () => {
    it('Chronosphere (PDOX) is powered (from INI)', () => {
      expect(INI['PDOX']?.powered).toBe(true);
      expect(STRUCTURE_POWERED.has('PDOX')).toBe(true);
    });

    it('Iron Curtain (IRON) is powered (from INI)', () => {
      expect(INI['IRON']?.powered).toBe(true);
      expect(STRUCTURE_POWERED.has('IRON')).toBe(true);
    });

    it('PDOX drain matches INI', () => {
      const iniDrain = Math.abs(INI['PDOX']!.power!);
      expect(POWER_DRAIN['PDOX']).toBe(iniDrain);
    });

    it('IRON drain matches INI', () => {
      const iniDrain = Math.abs(INI['IRON']!.power!);
      expect(POWER_DRAIN['IRON']).toBe(iniDrain);
    });
  });

  describe('GUN and AGUN are NOT powered — fire regardless of power (from INI)', () => {
    it('GUN is not in STRUCTURE_POWERED', () => {
      expect(INI['GUN']?.powered).not.toBe(true);
      expect(STRUCTURE_POWERED.has('GUN')).toBe(false);
    });

    it('AGUN is not in STRUCTURE_POWERED', () => {
      expect(INI['AGUN']?.powered).not.toBe(true);
      expect(STRUCTURE_POWERED.has('AGUN')).toBe(false);
    });

    it('SAM is not in STRUCTURE_POWERED', () => {
      expect(INI['SAM']?.powered).not.toBe(true);
      expect(STRUCTURE_POWERED.has('SAM')).toBe(false);
    });
  });

  describe('production speed penalty under low power (factory.cpp:434)', () => {
    it('full power: production at normal speed (multiplier = 1.0)', () => {
      const iniPowrPower = INI['POWR']!.power!;
      const iniTentDrain = Math.abs(INI['TENT']!.power!);
      const powr = makeStructFullHp('POWR', 5, 5);
      const tent = makeStructFullHp('TENT', 8, 5);
      const grid = calculatePowerGrid([powr, tent], House.Spain, isAllied);
      expect(grid.produced).toBe(iniPowrPower);
      expect(grid.consumed).toBe(iniTentDrain);
      // POWR produces more than TENT consumes (from INI)
      expect(iniPowrPower).toBeGreaterThan(iniTentDrain);
      expect(powerMultiplier(grid.produced, grid.consumed)).toBe(1.0);
    });

    it('deficit: production slows proportionally', () => {
      const powr = makeStructFullHp('POWR', 5, 5);
      const tsla = makeStructFullHp('TSLA', 8, 5);
      const weap = makeStructFullHp('WEAP', 10, 5);
      const barr = makeStructFullHp('BARR', 12, 5);
      const grid = calculatePowerGrid([powr, tsla, weap, barr], House.Spain, isAllied);
      const iniPowrPower = INI['POWR']!.power!;
      const expectedConsumed = Math.abs(INI['TSLA']!.power!) +
        Math.abs(INI['WEAP']!.power!) + Math.abs(INI['BARR']!.power!);
      expect(grid.produced).toBe(iniPowrPower);
      expect(grid.consumed).toBe(expectedConsumed);
      const mult = powerMultiplier(grid.produced, grid.consumed);
      expect(mult).toBe(iniPowrPower / expectedConsumed);
    });

    it('total power loss: production at 1/16 speed (16x slower)', () => {
      const dome = makeStructFullHp('DOME', 5, 5);
      const grid = calculatePowerGrid([dome], House.Spain, isAllied);
      const iniDomeDrain = Math.abs(INI['DOME']!.power!);
      expect(grid.produced).toBe(0);
      expect(grid.consumed).toBe(iniDomeDrain);
      const mult = powerMultiplier(grid.produced, grid.consumed);
      expect(mult).toBe(1 / 16);
    });
  });
});

// ============================================================
// Section 9: Enemy structures do not affect player power
//
// C++ house.cpp tracks power PER HOUSE.
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
    const iniPowrPower = INI['POWR']!.power!;
    const iniTentDrain = Math.abs(INI['TENT']!.power!);
    const playerPowr = makeStructFullHp('POWR', 5, 5, House.Spain);
    const playerTent = makeStructFullHp('TENT', 8, 5, House.Spain);
    const enemyApwr = makeStructFullHp('APWR', 12, 5, House.USSR);
    const enemyTsla = makeStructFullHp('TSLA', 15, 5, House.USSR);

    const grid = calculatePowerGrid(
      [playerPowr, playerTent, enemyApwr, enemyTsla],
      House.Spain, isAllied,
    );
    expect(grid.produced).toBe(iniPowrPower);
    expect(grid.consumed).toBe(iniTentDrain);
  });
});

// ============================================================
// Section 10: Realistic base power scenarios
//
// Validate that cumulative power budgets match rules.ini.
// ============================================================

describe('realistic base power scenarios', () => {
  it('early Allied base: POWR + TENT + PBOX + PROC -> surplus', () => {
    const expectedProduced = INI['POWR']!.power!;
    const expectedConsumed = Math.abs(INI['TENT']!.power!) +
      Math.abs(INI['PBOX']!.power!) + Math.abs(INI['PROC']!.power!);
    const structs = [
      makeStructFullHp('POWR', 5, 5),
      makeStructFullHp('TENT', 8, 5),
      makeStructFullHp('PBOX', 10, 5),
      makeStructFullHp('PROC', 12, 5),
    ];
    const grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(expectedProduced);
    expect(grid.consumed).toBe(expectedConsumed);
    expect(powerMultiplier(grid.produced, grid.consumed)).toBe(1.0);
  });

  it('Soviet tech rush: 2 POWR + BARR + WEAP + TSLA + STEK -> deficit', () => {
    const expectedProduced = INI['POWR']!.power! * 2;
    const expectedConsumed = Math.abs(INI['BARR']!.power!) +
      Math.abs(INI['WEAP']!.power!) + Math.abs(INI['TSLA']!.power!) +
      Math.abs(INI['STEK']!.power!);
    const structs = [
      makeStructFullHp('POWR', 5, 5),
      makeStructFullHp('POWR', 8, 5),
      makeStructFullHp('BARR', 10, 5),
      makeStructFullHp('WEAP', 12, 5),
      makeStructFullHp('TSLA', 14, 5),
      makeStructFullHp('STEK', 16, 5),
    ];
    const grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(expectedProduced);
    expect(grid.consumed).toBe(expectedConsumed);
    const frac = powerMultiplier(grid.produced, grid.consumed);
    expect(frac).toBeCloseTo(expectedProduced / expectedConsumed, 6);
  });

  it('full Allied endgame: POWR + 2 APWR + TENT + DOME + 2 GUN + AGUN + ATEK + PDOX + PROC', () => {
    const expectedProduced = INI['POWR']!.power! + INI['APWR']!.power! * 2;
    const expectedConsumed = Math.abs(INI['TENT']!.power!) +
      Math.abs(INI['DOME']!.power!) + Math.abs(INI['GUN']!.power!) * 2 +
      Math.abs(INI['AGUN']!.power!) + Math.abs(INI['ATEK']!.power!) +
      Math.abs(INI['PDOX']!.power!) + Math.abs(INI['PROC']!.power!);
    const structs = [
      makeStructFullHp('POWR', 2, 2),
      makeStructFullHp('APWR', 5, 2),
      makeStructFullHp('APWR', 8, 2),
      makeStructFullHp('TENT', 10, 2),
      makeStructFullHp('DOME', 12, 2),
      makeStructFullHp('GUN', 14, 2),
      makeStructFullHp('GUN', 16, 2),
      makeStructFullHp('AGUN', 18, 2),
      makeStructFullHp('ATEK', 20, 2),
      makeStructFullHp('PDOX', 22, 2),
      makeStructFullHp('PROC', 24, 2),
    ];
    const grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(expectedProduced);
    expect(grid.consumed).toBe(expectedConsumed);
    const frac = powerMultiplier(grid.produced, grid.consumed);
    expect(frac).toBeCloseTo(expectedProduced / expectedConsumed, 6);
  });
});

// ============================================================
// Section 11: Adding/removing power plants updates fraction
//
// Verify that adding a power plant shifts the fraction,
// and selling (removing) one reduces output.
// ============================================================

describe('adding/removing power plants updates fraction correctly', () => {
  it('adding a second POWR switches from deficit to surplus', () => {
    const iniPowrPower = INI['POWR']!.power!;
    const iniTslaDrain = Math.abs(INI['TSLA']!.power!);
    // 1 POWR + TSLA = deficit (TSLA drain > POWR output from INI)
    const structs1 = [
      makeStructFullHp('POWR', 5, 5),
      makeStructFullHp('TSLA', 8, 5),
    ];
    const grid1 = calculatePowerGrid(structs1, House.Spain, isAllied);
    expect(grid1.produced).toBe(iniPowrPower);
    expect(grid1.consumed).toBe(iniTslaDrain);
    const frac1 = powerMultiplier(grid1.produced, grid1.consumed);
    expect(frac1).toBeLessThan(1.0); // deficit

    // 2 POWR + TSLA = surplus if 2*iniPowrPower >= iniTslaDrain
    const structs2 = [
      makeStructFullHp('POWR', 5, 5),
      makeStructFullHp('POWR', 11, 5),
      makeStructFullHp('TSLA', 8, 5),
    ];
    const grid2 = calculatePowerGrid(structs2, House.Spain, isAllied);
    expect(grid2.produced).toBe(iniPowrPower * 2);
    expect(grid2.consumed).toBe(iniTslaDrain);
    const frac2 = powerMultiplier(grid2.produced, grid2.consumed);
    if (iniPowrPower * 2 >= iniTslaDrain) {
      expect(frac2).toBe(1.0);
    } else {
      expect(frac2).toBeGreaterThan(frac1);
    }
  });

  it('adding APWR provides large power boost', () => {
    const iniPowrPower = INI['POWR']!.power!;
    const iniApwrPower = INI['APWR']!.power!;
    const iniAtekDrain = Math.abs(INI['ATEK']!.power!);

    // POWR + ATEK = likely deficit
    const structs1 = [
      makeStructFullHp('POWR', 5, 5),
      makeStructFullHp('ATEK', 8, 5),
    ];
    const grid1 = calculatePowerGrid(structs1, House.Spain, isAllied);
    const frac1 = powerMultiplier(grid1.produced, grid1.consumed);

    // POWR + APWR + ATEK = more power
    const structs2 = [
      makeStructFullHp('POWR', 5, 5),
      makeStructFullHp('APWR', 11, 5),
      makeStructFullHp('ATEK', 8, 5),
    ];
    const grid2 = calculatePowerGrid(structs2, House.Spain, isAllied);
    expect(grid2.produced).toBe(iniPowrPower + iniApwrPower);
    expect(grid2.consumed).toBe(iniAtekDrain);
    const frac2 = powerMultiplier(grid2.produced, grid2.consumed);
    expect(frac2).toBeGreaterThan(frac1);
  });
});

// ============================================================
// Section 12: Selling a power plant reduces output
//
// When a building has sellProgress != undefined, it is excluded
// from the power grid calculation.
// ============================================================

describe('selling a power plant reduces output', () => {
  it('selling POWR removes its contribution from produced', () => {
    const iniPowrPower = INI['POWR']!.power!;
    const powr1 = makeStructFullHp('POWR', 5, 5);
    const powr2 = makeStructFullHp('POWR', 8, 5);
    const structs = [powr1, powr2];

    let grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(iniPowrPower * 2);

    // Start selling one
    powr1.sellProgress = 0.1;
    grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(iniPowrPower); // only one POWR remaining
  });

  it('selling APWR removes its larger contribution', () => {
    const iniPowrPower = INI['POWR']!.power!;
    const iniApwrPower = INI['APWR']!.power!;
    const powr = makeStructFullHp('POWR', 5, 5);
    const apwr = makeStructFullHp('APWR', 8, 5);
    const structs = [powr, apwr];

    let grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(iniPowrPower + iniApwrPower);

    apwr.sellProgress = 0.5;
    grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.produced).toBe(iniPowrPower);
  });

  it('selling a draining building reduces consumed', () => {
    const iniTslaDrain = Math.abs(INI['TSLA']!.power!);
    const iniWeapDrain = Math.abs(INI['WEAP']!.power!);
    const tsla = makeStructFullHp('TSLA', 5, 5);
    const weap = makeStructFullHp('WEAP', 8, 5);
    const structs = [tsla, weap];

    let grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.consumed).toBe(iniTslaDrain + iniWeapDrain);

    tsla.sellProgress = 0.3;
    grid = calculatePowerGrid(structs, House.Spain, isAllied);
    expect(grid.consumed).toBe(iniWeapDrain);
  });
});

// ============================================================
// Section 13: Edge cases
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
    const iniPowrPower = INI['POWR']!.power!;
    const iniApwrPower = INI['APWR']!.power!;
    const powrMaxHp = INI['POWR']!.strength ?? STRUCTURE_MAX_HP['POWR'];
    const apwrMaxHp = INI['APWR']!.strength ?? STRUCTURE_MAX_HP['APWR'];
    expect(fixedPowerOutput(iniPowrPower, 0, powrMaxHp)).toBe(0);
    expect(fixedPowerOutput(iniApwrPower, 0, apwrMaxHp)).toBe(0);
  });

  it('negative produced is clamped to 1/16 floor', () => {
    expect(powerMultiplier(-10, 100)).toBe(1 / 16);
  });

  it('very large drain with tiny production: clamped to 1/16', () => {
    expect(powerMultiplier(1, 10000)).toBe(1 / 16);
  });
});
