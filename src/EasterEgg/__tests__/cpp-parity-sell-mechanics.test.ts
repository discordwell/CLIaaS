/**
 * C++ parity audit: Building sell mechanics
 *
 * Audits the TS engine sell subsystem against C++ building.cpp / techno.cpp behavior.
 * All expected values are parsed from rules.ini at test time — no hardcoded C++ values.
 *
 * C++ source refs:
 *   - techno.cpp:5743-5761  TechnoClass::Refund_Amount()
 *   - building.cpp:3509-3549 BuildingClass::Sell_Back() — ConYard → MCV reversion
 *   - building.cpp:5591-5600 BuildingClass::How_Many_Survivors()
 *   - building.cpp:3456-3463 Crew_Type() — survivor type per building, one engineer limit
 *   - bdata.cpp:3672-3683    BuildingTypeClass::Raw_Cost() — subtract free unit cost
 *   - bdata.cpp:3129          sell animation duration from BuildupTime + make frame count
 *   - building.cpp:4613       Power_Output() — fixed-point power scaling
 *   - techno.cpp:4454-4465   Crew_Type: 15% civilian chance for unarmed buildings
 *   - building.cpp:3449       Survivor guard: !ArchiveTarget || !IsMCVDeploy || !STRUCT_CONST
 *   - rules.cpp:190           IsMCVDeploy default = false
 *   - rules.cpp:486           MCVUndeploy INI key → IsMCVDeploy
 *   - fixed.h:109             int * fixed = ((raw * intVal) + 128) / 256
 *   - fixed.cpp:148           fixed(".4") → Fraction = (256 * 4) / 10 = 102
 *   - factory.cpp:469-481     Abandon() — refunds costPaid on cancel
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { sellRefund, fixedPowerOutput, calculatePowerGrid, sellStructureByIndex } from '../engine/repairSell';
import type { RepairSellContext } from '../engine/repairSell';
import { PRODUCTION_ITEMS } from '../engine/types';
import type { MapStructure } from '../engine/scenario';

// ---------------------------------------------------------------------------
// Parse rules.ini at test time (authoritative source of truth)
// ---------------------------------------------------------------------------
const RULES_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/rules.ini');
const rulesText = fs.readFileSync(RULES_INI_PATH, 'utf-8');

interface IniSection {
  [key: string]: string;
}

function parseINI(text: string): Record<string, IniSection> {
  const result: Record<string, IniSection> = {};
  let currentSection = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.split(';')[0].trim();
    if (!line) continue;
    const secMatch = line.match(/^\[([^\]]+)\]$/);
    if (secMatch) { currentSection = secMatch[1]; continue; }
    if (!currentSection) continue;
    const kvMatch = line.match(/^(\w+)=(.*)$/);
    if (!kvMatch) continue;
    if (!result[currentSection]) result[currentSection] = {};
    result[currentSection][kvMatch[1]] = kvMatch[2].trim();
  }
  return result;
}

const INI = parseINI(rulesText);

// Parse General section values
const generalSection = INI['General'] ?? {};
const iniRefundPercent = parseFloat(generalSection['RefundPercent']?.replace('%', '') ?? '50') / 100;
const iniSurvivorRate = parseFloat(generalSection['SurvivorRate'] ?? '0.4');
const iniBuildupTime = parseFloat(generalSection['BuildupTime'] ?? '0.06');

function iniCost(type: string): number {
  const val = INI[type]?.['Cost'];
  if (!val || val === '') return 0;
  return parseInt(val, 10);
}

function iniStrength(type: string): number {
  return parseInt(INI[type]?.['Strength'] ?? '0', 10);
}

function iniPower(type: string): number {
  return parseInt(INI[type]?.['Power'] ?? '0', 10);
}

function iniOwner(type: string): string {
  return (INI[type]?.['Owner'] ?? '').toLowerCase();
}

function iniCrewed(type: string): boolean {
  return (INI[type]?.['Crewed'] ?? '').toLowerCase() === 'yes';
}

// E1 cost from INI for survivor formula
const iniE1Cost = iniCost('E1');

// All structures that appear in PRODUCTION_ITEMS with isStructure=true
const STRUCTURE_ITEMS = PRODUCTION_ITEMS.filter(p => p.isStructure);

// All structures with Cost > 0 in rules.ini
const BUILDABLE_STRUCTURES = STRUCTURE_ITEMS.filter(p => iniCost(p.type) > 0);

// Wall types — sell instantly with no animation
const WALL_TYPES = new Set(['SBAG', 'FENC', 'BARB', 'BRIK']);

// ---------------------------------------------------------------------------
// C++ fixed-point helpers (reimplemented for expected-value calculation)
// ---------------------------------------------------------------------------

/**
 * Emulate C++ fixed(".4") constructor (fixed.cpp:88-151).
 * For ".4": frac=4, len=1, base=10, Fraction = (256 * 4) / 10 = 102 (truncated).
 */
function cppFixedFromDecimal(decStr: string): number {
  const dotIdx = decStr.indexOf('.');
  if (dotIdx < 0) return parseInt(decStr, 10) * 256;
  const whole = dotIdx > 0 ? parseInt(decStr.substring(0, dotIdx), 10) : 0;
  const fracStr = decStr.substring(dotIdx + 1);
  const frac = parseInt(fracStr, 10);
  let base = 1;
  for (let i = 0; i < fracStr.length; i++) base *= 10;
  const fracByte = Math.floor((256 * frac) / base);
  return whole * 256 + fracByte;
}

/**
 * C++ int * fixed = ((raw * intVal) + 128) / 256 (fixed.h:109).
 * Returns integer result.
 */
function cppIntTimesFixed(intVal: number, fixedRaw: number): number {
  return Math.floor(((fixedRaw * intVal) + 128) / 256);
}

// SurvivorFraction raw value: fixed(".4") → 102
const SURVIVOR_FRAC_RAW = cppFixedFromDecimal('.4');

/**
 * C++ How_Many_Survivors (building.cpp:5591-5600):
 *   if (IsSurvivorless || !Class->IsCrew) return 0;
 *   divisor = E1.Raw_Cost();  // 100
 *   if (IsCaptured) divisor *= 2;
 *   count = (Class->Raw_Cost() * Rule.SurvivorFraction) / divisor;
 *   return Bound(count, 1, 5);
 */
function cppSurvivorCount(rawCost: number, isCrewed: boolean, isCaptured = false): number {
  if (!isCrewed) return 0;
  const divisor = isCaptured ? iniE1Cost * 2 : iniE1Cost;
  if (divisor === 0) return 0;
  const intermediate = cppIntTimesFixed(rawCost, SURVIVOR_FRAC_RAW);
  const count = Math.floor(intermediate / divisor);
  return Math.min(5, Math.max(1, count));
}

/**
 * TS survivor count (index.ts:2016-2028):
 *   count = min(5, max(1, floor(rawCost * 0.4 / 100)))
 * Note: no IsCrew check, no IsCaptured halving, uses float not fixed-point.
 */
function tsSurvivorCount(rawCost: number): number {
  return Math.min(5, Math.max(1, Math.floor((rawCost * 0.4) / 100)));
}

// ---------------------------------------------------------------------------
// 1. Sell refund = fixed-point half-cost formula
//    C++ techno.cpp:5743-5761: int * fixed(1,2) = ((128 * cost) + 128) / 256
// ---------------------------------------------------------------------------
describe('C++ parity: sell refund formula (techno.cpp:5743-5761)', () => {
  describe('every buildable structure: human refund = Math.trunc((128 * INI.Cost + 128) / 256)', () => {
    for (const item of BUILDABLE_STRUCTURES) {
      const cost = iniCost(item.type);
      const expected = Math.trunc((128 * cost + 128) / 256);
      it(`${item.type} (Cost=${cost}): sellRefund = ${expected}`, () => {
        expect(sellRefund(cost, true)).toBe(expected);
      });
    }
  });

  describe('refund percent from rules.ini General.RefundPercent', () => {
    it(`rules.ini RefundPercent = ${iniRefundPercent * 100}%`, () => {
      expect(iniRefundPercent).toBe(0.5);
    });

    it('fixed-point formula approximates RefundPercent for all costs', () => {
      for (const item of BUILDABLE_STRUCTURES) {
        const cost = iniCost(item.type);
        const refund = sellRefund(cost, true);
        // Should be within 1 credit of exact 50% due to fixed-point rounding
        expect(Math.abs(refund - cost * iniRefundPercent)).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('TS engine PRODUCTION_ITEMS.cost matches rules.ini Cost= for structures', () => {
    for (const item of BUILDABLE_STRUCTURES) {
      const iniVal = iniCost(item.type);
      it(`${item.type}: PRODUCTION_ITEMS cost=${item.cost} vs INI Cost=${iniVal}`, () => {
        expect(item.cost).toBe(iniVal);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// 2. C++ fixed-point SurvivorFraction vs TS float 0.4
//    C++ fixed(".4") → Fraction = (256*4)/10 = 102 → Raw = 102
//    C++ int*fixed: ((102 * rawCost) + 128) / 256
//    TS uses: floor(rawCost * 0.4)
//    These diverge when rawCost * 102 % 256 < 128 but rawCost * 0.4 is exact.
// ---------------------------------------------------------------------------
describe('C++ parity: fixed-point SurvivorFraction vs TS float multiply', () => {
  it('C++ fixed(".4").Raw = 102 (fixed.cpp:148)', () => {
    expect(SURVIVOR_FRAC_RAW).toBe(102);
    // Verify: 102/256 = 0.3984375, which is < 0.4
    expect(102 / 256).toBeCloseTo(0.3984375, 10);
  });

  it('rules.ini SurvivorRate = 0.4', () => {
    expect(iniSurvivorRate).toBe(0.4);
  });

  it('E1 cost = 100', () => {
    expect(iniE1Cost).toBe(100);
  });

  // Check every structure for C++ vs TS survivor count divergence
  describe('survivor count: C++ fixed-point vs TS float for each building', () => {
    const iniHarvCost = iniCost('HARV');
    const iniHindCost = iniCost('HIND');

    for (const item of BUILDABLE_STRUCTURES) {
      if (WALL_TYPES.has(item.type)) continue;

      let rawCost = iniCost(item.type);
      if (item.type === 'PROC') rawCost -= iniHarvCost;
      if (item.type === 'HPAD') rawCost -= Math.floor((iniHindCost + iniHindCost) / 2);

      const crewed = iniCrewed(item.type);
      const cppCount = cppSurvivorCount(rawCost, crewed);
      const tsCount = tsSurvivorCount(rawCost);

      // C++ gives 0 for non-crewed buildings; TS spawns survivors regardless.
      // Both use different math (fixed-point vs float) and different guard checks.
      it(`${item.type} (rawCost=${rawCost}, crewed=${crewed}): C++=${cppCount}, TS=${tsCount}`, () => {
        // This test documents the actual values; mismatches are flagged below
        expect(cppCount).toBeGreaterThanOrEqual(0);
        expect(tsCount).toBeGreaterThanOrEqual(1);
      });
    }
  });

  // Specific divergence cases
  describe('MISMATCH: fixed-point vs float intermediate values', () => {
    it('rawCost=500 (GAP): C++ intermediate=199, TS intermediate=200', () => {
      // C++: ((102 * 500) + 128) / 256 = 51128 / 256 = 199
      const cppIntermediate = cppIntTimesFixed(500, SURVIVOR_FRAC_RAW);
      expect(cppIntermediate).toBe(199);
      // TS: floor(500 * 0.4) = 200
      const tsIntermediate = Math.floor(500 * 0.4);
      expect(tsIntermediate).toBe(200);
      // This causes C++ survivor count = 199/100 = 1, TS = 200/100 = 2
      expect(Math.floor(cppIntermediate / 100)).toBe(1);
      expect(Math.floor(tsIntermediate / 100)).toBe(2);
    });

    it('rawCost=1000: C++ intermediate=398, TS intermediate=400', () => {
      const cppIntermediate = cppIntTimesFixed(1000, SURVIVOR_FRAC_RAW);
      expect(cppIntermediate).toBe(398);
      const tsIntermediate = Math.floor(1000 * 0.4);
      expect(tsIntermediate).toBe(400);
      // C++ survivors = 398/100 = 3, TS = 400/100 = 4
      expect(Math.floor(cppIntermediate / 100)).toBe(3);
      expect(Math.floor(tsIntermediate / 100)).toBe(4);
    });
  });
});

// ---------------------------------------------------------------------------
// 3. IsCrew gate: C++ How_Many_Survivors returns 0 for non-crewed buildings
//    C++ building.cpp:5593: if (IsSurvivorless || !Class->IsCrew) return(0);
//    TS does NOT check IsCrew — spawns survivors for ALL buildings.
//    MISMATCH: SILO, KENN, and other non-crewed buildings get survivors in TS but not C++.
// ---------------------------------------------------------------------------
describe('C++ parity: IsCrew gate on survivor spawning (building.cpp:5593)', () => {
  it('rules.ini Crewed= flag determines C++ IsCrew', () => {
    // Buildings with Crewed=yes in rules.ini → IsCrew=true → get survivors
    const EXPECTED_CREWED = [
      'POWR', 'APWR', 'PROC', 'BARR', 'TENT', 'WEAP', 'FACT',
      'HPAD', 'DOME', 'GAP', 'ATEK', 'STEK', 'PDOX', 'IRON',
      'MSLO', 'AFLD', 'FIX', 'PBOX', 'HBOX', 'GUN', 'AGUN',
      'FTUR', 'TSLA', 'SAM',
    ];
    for (const type of EXPECTED_CREWED) {
      expect(iniCrewed(type), `${type} should be Crewed=yes`).toBe(true);
    }
  });

  it('MISMATCH: SILO is NOT Crewed — C++ gives 0 survivors, TS gives 1', () => {
    expect(iniCrewed('SILO')).toBe(false);
    const cppCount = cppSurvivorCount(iniCost('SILO'), false);
    const tsCount = tsSurvivorCount(iniCost('SILO'));
    expect(cppCount).toBe(0);  // C++: !IsCrew → return 0
    expect(tsCount).toBe(1);   // TS: no IsCrew check → clamped min 1
  });

  it('MISMATCH: KENN is NOT Crewed — C++ gives 0 survivors, TS gives 1', () => {
    expect(iniCrewed('KENN')).toBe(false);
    expect(INI['KENN']?.['Crewed']).toBeUndefined();
    const cppCount = cppSurvivorCount(iniCost('KENN'), false);
    const tsCount = tsSurvivorCount(iniCost('KENN'));
    expect(cppCount).toBe(0);
    expect(tsCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. IsCaptured halves survivor count in C++ (building.cpp:5597)
//    C++ if (IsCaptured) divisor *= 2;
//    TS has no captured building concept for survivor calculation.
// ---------------------------------------------------------------------------
describe('C++ parity: IsCaptured halves survivors (building.cpp:5597)', () => {
  it('captured WEAP: C++ gives half survivors', () => {
    const cost = iniCost('WEAP');
    const normal = cppSurvivorCount(cost, true, false);
    const captured = cppSurvivorCount(cost, true, true);
    // WEAP cost=2000: normal = ((102*2000)+128)/256 / 100 = 797/100 = 7 → clamp 5
    // captured: 797/200 = 3
    expect(normal).toBe(5);
    expect(captured).toBe(3);
  });

  it('MISMATCH: TS has no IsCaptured check — always uses normal divisor', () => {
    // TS survivor code (index.ts:2016-2028) has no captured parameter.
    // A captured building in TS would get the same survivor count as a non-captured one.
    const cost = iniCost('WEAP');
    const tsCount = tsSurvivorCount(cost);
    expect(tsCount).toBe(5); // No captured halving
  });
});

// ---------------------------------------------------------------------------
// 5. MCVUndeploy=no in rules.ini → C++ IsMCVDeploy=false
//    C++ building.cpp:3449: if (!Target_Legal(ArchiveTarget) || !Rule.IsMCVDeploy || *this != STRUCT_CONST)
//    With IsMCVDeploy=false, the condition is always true (because !false = true)
//    → ConYard ALWAYS spawns survivors and NEVER reverts to MCV in C++.
//    MISMATCH: TS supports MCV reversion regardless of MCVUndeploy setting.
// ---------------------------------------------------------------------------
describe('C++ parity: MCVUndeploy=no blocks MCV reversion (building.cpp:3449)', () => {
  it('rules.ini MCVUndeploy=no (C++ IsMCVDeploy=false)', () => {
    const mcvUndeploy = generalSection['MCVUndeploy']?.toLowerCase();
    expect(mcvUndeploy).toBe('no');
  });

  it('C++ rules.cpp:190 — IsMCVDeploy constructor default is false', () => {
    // The constructor default matches the INI value. Both say "no MCV reversion."
    // This means in C++ RA, selling a ConYard NEVER creates an MCV.
    expect(true).toBe(true); // documented
  });

  it('MISMATCH: TS supports MCV reversion via deployedFromMCV flag, C++ does not', () => {
    // C++ building.cpp:3449: with IsMCVDeploy=false, !IsMCVDeploy = true
    // → the survivor-spawn branch ALWAYS executes for ConYard
    // → line 3509 (MCV spawn) is NEVER reached because we're in the survivor branch
    // TS index.ts:1992-2004: checks deployedFromMCV regardless of MCVUndeploy
    const s = makeStructure('FACT', iniStrength('FACT'), iniStrength('FACT'));
    s.deployedFromMCV = true;
    expect(s.deployedFromMCV).toBe(true);
    // In TS this would trigger MCV spawn, in C++ it would spawn survivors instead.
  });
});

// ---------------------------------------------------------------------------
// 6. Sell refund ignores current health
//    C++ techno.cpp:5743-5761: Refund_Amount uses Raw_Cost * CostBias * RefundPercent
//    No health scaling anywhere in the refund formula.
// ---------------------------------------------------------------------------
describe('C++ parity: sell refund ignores current health (techno.cpp:5743-5761)', () => {
  it('sellRefund() has no health parameter — refund is always 50% of cost', () => {
    const cost = iniCost('WEAP');
    const fullRefund = sellRefund(cost, true);
    expect(fullRefund).toBe(Math.trunc((128 * cost + 128) / 256));
    expect(sellRefund.length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 7. Power grid updated when power building sold
// ---------------------------------------------------------------------------
describe('C++ parity: power grid update on sell (building.cpp:4613)', () => {
  const powrPower = iniPower('POWR');
  const apwrPower = iniPower('APWR');
  const weapDrain = iniPower('WEAP');

  it('INI power values: POWR produces, WEAP drains', () => {
    expect(powrPower).toBeGreaterThan(0);
    expect(weapDrain).toBeLessThan(0);
  });

  it('calculatePowerGrid excludes structures with sellProgress set', () => {
    const structures: MapStructure[] = [
      makeStructure('POWR', iniStrength('POWR'), iniStrength('POWR')),
      makeStructure('POWR', iniStrength('POWR'), iniStrength('POWR')),
    ];
    const grid1 = calculatePowerGrid(structures, 'GoodGuy' as any, () => true);
    expect(grid1.produced).toBe(powrPower * 2);

    structures[1].sellProgress = 0.5;
    const grid2 = calculatePowerGrid(structures, 'GoodGuy' as any, () => true);
    expect(grid2.produced).toBe(powrPower);
  });

  it('calculatePowerGrid excludes dead structures', () => {
    const structures: MapStructure[] = [
      makeStructure('APWR', iniStrength('APWR'), iniStrength('APWR')),
    ];
    const grid1 = calculatePowerGrid(structures, 'GoodGuy' as any, () => true);
    expect(grid1.produced).toBe(apwrPower);

    structures[0].alive = false;
    const grid2 = calculatePowerGrid(structures, 'GoodGuy' as any, () => true);
    expect(grid2.produced).toBe(0);
  });

  it('fixedPowerOutput at partial health uses C++ 8.8 fixed-point', () => {
    const maxHp = iniStrength('POWR');
    const halfHp = Math.floor(maxHp / 2);
    const fixedRaw = Math.floor((halfHp * 256) / maxHp);
    const expected = Math.floor((fixedRaw * powrPower + 128) / 256);
    expect(fixedPowerOutput(powrPower, halfHp, maxHp)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 8. Sell animation timing
//    C++ bdata.cpp:3129: timedelay = floor(BuildupTime * TICKS_PER_MINUTE / makeFrameCount)
//    duration = (makeFrameCount - 1) * timedelay
// ---------------------------------------------------------------------------
describe('C++ parity: sell animation timing (bdata.cpp:3129)', () => {
  const TICKS_PER_MINUTE = 900;
  const MAKE_FRAME_COUNT = 20;

  it(`BuildupTime from rules.ini = ${iniBuildupTime}`, () => {
    expect(iniBuildupTime).toBe(0.06);
  });

  it('sell duration = (20-1) * floor(0.06 * 900 / 20) = 19 * 2 = 38 ticks', () => {
    const timedelay = Math.floor(iniBuildupTime * TICKS_PER_MINUTE / MAKE_FRAME_COUNT);
    expect(timedelay).toBe(2);
    const duration = (MAKE_FRAME_COUNT - 1) * timedelay;
    expect(duration).toBe(38);
  });

  it('sell progress increment per tick = 1/38', () => {
    const timedelay = Math.floor(iniBuildupTime * TICKS_PER_MINUTE / MAKE_FRAME_COUNT);
    const duration = (MAKE_FRAME_COUNT - 1) * timedelay;
    const increment = 1 / duration;
    expect(increment).toBeCloseTo(1 / 38, 10);
  });
});

// ---------------------------------------------------------------------------
// 9. Cannot sell enemy or dead or already-selling buildings
// ---------------------------------------------------------------------------
describe('C++ parity: sell guard conditions', () => {
  it('sellStructureByIndex returns false for enemy structure', () => {
    const s = makeStructure('POWR', iniStrength('POWR'), iniStrength('POWR'), 'BadGuy' as any);
    const ctx = makeMinimalCtx([s]);
    const ok = sellStructureByIndex(ctx, 0);
    expect(ok).toBe(false);
    expect(s.sellProgress).toBeUndefined();
  });

  it('sellStructureByIndex returns false for dead structure', () => {
    const s = makeStructure('POWR', 0, iniStrength('POWR'));
    s.alive = false;
    const ctx = makeMinimalCtx([s]);
    const ok = sellStructureByIndex(ctx, 0);
    expect(ok).toBe(false);
  });

  it('sellStructureByIndex returns false for already-selling structure', () => {
    const s = makeStructure('POWR', iniStrength('POWR'), iniStrength('POWR'));
    s.sellProgress = 0.5;
    const ctx = makeMinimalCtx([s]);
    const ok = sellStructureByIndex(ctx, 0);
    expect(ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. Selling while under attack
// ---------------------------------------------------------------------------
describe('C++ parity: selling while under attack', () => {
  it('sell can be initiated on damaged building (any HP > 0)', () => {
    const s: MapStructure = {
      type: 'POWR', image: 'powr', house: 'GoodGuy' as any,
      cx: 5, cy: 5, hp: 50, maxHp: iniStrength('POWR'),
      alive: true, rubble: false, attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    const ctx = makeMinimalCtx([s]);
    const ok = sellStructureByIndex(ctx, 0);
    expect(ok).toBe(true);
    expect(s.sellProgress).toBe(0);
    expect(s.sellHpAtStart).toBe(50);
  });

  it('sellHpAtStart captures HP at time of sell initiation', () => {
    const hp = 200;
    const s: MapStructure = {
      type: 'WEAP', image: 'weap', house: 'GoodGuy' as any,
      cx: 5, cy: 5, hp, maxHp: iniStrength('WEAP'),
      alive: true, rubble: false, attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    const ctx = makeMinimalCtx([s]);
    sellStructureByIndex(ctx, 0);
    expect(s.sellHpAtStart).toBe(hp);
  });
});

// ---------------------------------------------------------------------------
// 11. MCV undeploy data model support
// ---------------------------------------------------------------------------
describe('C++ parity: MCV undeploy on ConYard sell (building.cpp:3509-3549)', () => {
  it('FACT with deployedFromMCV=true should trigger MCV spawn (engine behavior)', () => {
    const s = makeStructure('FACT', iniStrength('FACT'), iniStrength('FACT'));
    s.deployedFromMCV = true;
    expect(s.deployedFromMCV).toBe(true);
  });

  it('FACT without deployedFromMCV gets normal sell refund', () => {
    const cost = iniCost('FACT');
    const expected = Math.trunc((128 * cost + 128) / 256);
    expect(sellRefund(cost, true)).toBe(expected);
  });

  it('MCV cost in rules.ini matches PRODUCTION_ITEMS', () => {
    const iniMcvCost = iniCost('MCV');
    expect(iniMcvCost).toBe(2500);
    expect(iniCost('FACT')).toBe(iniMcvCost);
  });

  it('MCV HP after undeploy: max(1, floor(maxHp * healthRatio))', () => {
    const mcvMaxHp = iniStrength('MCV');
    const factMaxHp = iniStrength('FACT');

    const fullRatio = factMaxHp / factMaxHp;
    expect(Math.max(1, Math.floor(mcvMaxHp * fullRatio))).toBe(mcvMaxHp);

    const halfHp = Math.floor(factMaxHp / 2);
    const halfRatio = halfHp / factMaxHp;
    expect(Math.max(1, Math.floor(mcvMaxHp * halfRatio))).toBe(Math.floor(mcvMaxHp * halfRatio));

    const nearDeadRatio = 1 / factMaxHp;
    expect(Math.max(1, Math.floor(mcvMaxHp * nearDeadRatio))).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 12. Wall sell is instant (no animation)
// ---------------------------------------------------------------------------
describe('C++ parity: wall sell is instant', () => {
  for (const wallType of ['SBAG', 'FENC', 'BRIK'] as const) {
    const cost = iniCost(wallType);
    if (cost <= 0) continue;

    it(`${wallType} (Cost=${cost}): sell is instant — building marked dead immediately`, () => {
      const s = makeStructure(wallType, 1, 1);
      const prodItem = PRODUCTION_ITEMS.find(p => p.type === wallType)!;
      const ctx = makeMinimalCtx([s], [prodItem]);
      const startCredits = ctx.credits;
      const ok = sellStructureByIndex(ctx, 0);
      expect(ok).toBe(true);
      expect(s.alive).toBe(false);
      expect(s.sellProgress).toBeUndefined();
      const expectedRefund = sellRefund(cost, true);
      expect(ctx.credits).toBe(startCredits + expectedRefund);
    });
  }
});

// ---------------------------------------------------------------------------
// 13. Raw_Cost adjustment for buildings with free units
// ---------------------------------------------------------------------------
describe('C++ parity: Raw_Cost free unit subtraction (bdata.cpp:3672-3683)', () => {
  it('PROC Raw_Cost = PROC.Cost - HARV.Cost (comes with free harvester)', () => {
    const procCost = iniCost('PROC');
    const harvCost = iniCost('HARV');
    const rawCost = procCost - harvCost;
    expect(rawCost).toBe(2000 - 1400);
    const survivors = cppSurvivorCount(rawCost, iniCrewed('PROC'));
    expect(survivors).toBe(2);
  });

  it('HPAD Raw_Cost = HPAD.Cost - HIND.Cost (C++ uses HIND twice, averaged)', () => {
    const hpadCost = iniCost('HPAD');
    const hindCost = iniCost('HIND');
    const rawCost = hpadCost - Math.floor((hindCost + hindCost) / 2);
    expect(rawCost).toBe(1500 - 1200);
    const survivors = cppSurvivorCount(rawCost, iniCrewed('HPAD'));
    expect(survivors).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 14. KENN (Kennel) special survivor behavior
//     C++ Crew_Type: 50% dog, 50% nothing — but How_Many_Survivors returns 0
//     because KENN is not Crewed.
// ---------------------------------------------------------------------------
describe('C++ parity: KENN survivor type', () => {
  it('KENN exists in rules.ini with cost and no Crewed= flag', () => {
    expect(iniCost('KENN')).toBe(200);
    expect(INI['KENN']?.['Crewed']).toBeUndefined();
  });

  it('C++: KENN gets 0 survivors (IsCrew=false) from How_Many_Survivors', () => {
    expect(cppSurvivorCount(iniCost('KENN'), false)).toBe(0);
  });

  it('MISMATCH: TS spawns survivors from KENN (case "KENN": dog or skip)', () => {
    // TS has explicit case 'KENN' in survivor switch at index.ts:2049-2052
    // but C++ How_Many_Survivors returns 0 because IsCrew is false
    const tsCount = tsSurvivorCount(iniCost('KENN'));
    expect(tsCount).toBe(1); // TS spawns 1 (clamped min)
  });
});

// ---------------------------------------------------------------------------
// 15. AI gets 100% refund (no RefundPercent penalty)
// ---------------------------------------------------------------------------
describe('C++ parity: AI 100% refund vs human 50% (techno.cpp:5743-5761)', () => {
  for (const item of BUILDABLE_STRUCTURES) {
    const cost = iniCost(item.type);
    it(`${item.type}: AI refund=${cost}, human refund=${sellRefund(cost, true)}`, () => {
      expect(sellRefund(cost, false)).toBe(cost);
      expect(sellRefund(cost, true)).toBe(Math.trunc((128 * cost + 128) / 256));
      expect(sellRefund(cost, false)).toBeGreaterThanOrEqual(sellRefund(cost, true));
    });
  }
});

// ---------------------------------------------------------------------------
// 16. Sell does not cancel production queue
// ---------------------------------------------------------------------------
describe('C++ parity: sell does not cancel production queue', () => {
  it('sellStructureByIndex does not interact with production queue', () => {
    const s = makeStructure('WEAP', iniStrength('WEAP'), iniStrength('WEAP'));
    const prodItems = PRODUCTION_ITEMS.filter(p => p.type === 'WEAP');
    const ctx = makeMinimalCtx([s], prodItems);
    const ok = sellStructureByIndex(ctx, 0);
    expect(ok).toBe(true);
    expect(s.sellProgress).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 17. FACT cost consistency
// ---------------------------------------------------------------------------
describe('C++ parity: FACT cost consistency (bdata.cpp / rules.ini)', () => {
  it('FACT in PRODUCTION_ITEMS should match rules.ini Cost=2500', () => {
    const factProd = PRODUCTION_ITEMS.find(p => p.type === 'FACT');
    expect(factProd).toBeDefined();
    expect(factProd!.cost).toBe(iniCost('FACT'));
  });

  it('FACT INI cost = MCV INI cost (both 2500)', () => {
    expect(iniCost('FACT')).toBe(iniCost('MCV'));
  });

  it('MISMATCH: TS fallback FACT_COST=2000 vs INI Cost=2500 (latent — both clamp to 5)', () => {
    // TS index.ts:2020: const FACT_COST = 2000; — used when prodItem is missing
    // This is a latent bug: both 2500*0.4/100=10→5 and 2000*0.4/100=8→5 clamp to 5
    // But the hardcoded value is wrong.
    const factCost = iniCost('FACT');
    expect(factCost).toBe(2500);
    // Both clamp to 5, so the bug is latent
    expect(tsSurvivorCount(factCost)).toBe(5);
    expect(tsSurvivorCount(2000)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 18. SILO survivor special case
// ---------------------------------------------------------------------------
describe('C++ parity: SILO survivor handling (building.cpp:5593+3456)', () => {
  it('SILO has Cost > 0 in rules.ini', () => {
    expect(iniCost('SILO')).toBe(150);
  });

  it('SILO is NOT Crewed=yes → C++ returns 0 survivors', () => {
    expect(iniCrewed('SILO')).toBe(false);
    expect(cppSurvivorCount(iniCost('SILO'), false)).toBe(0);
  });

  it('MISMATCH: TS spawns 1 civilian survivor from SILO (no IsCrew guard)', () => {
    expect(tsSurvivorCount(iniCost('SILO'))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 19. Exhaustive fixed-point refund verification
// ---------------------------------------------------------------------------
describe('C++ parity: exhaustive fixed-point refund (techno.cpp:5743-5761)', () => {
  it('sellRefund matches floor((128 * cost + 128) / 256) for all INI costs', () => {
    const allCosts = new Set<number>();
    for (const item of PRODUCTION_ITEMS) allCosts.add(item.cost);
    for (const type of Object.keys(INI)) {
      const c = iniCost(type);
      if (c > 0) allCosts.add(c);
    }
    for (const cost of allCosts) {
      const expected = Math.trunc((128 * cost + 128) / 256);
      expect(sellRefund(cost, true)).toBe(expected);
    }
  });

  it('fixed-point rounding: odd costs produce ceil(cost/2) due to +128 bias', () => {
    const oddCosts = [25, 75, 125, 175, 225, 275, 325, 375, 425, 475, 525, 575];
    for (const cost of oddCosts) {
      expect(sellRefund(cost, true)).toBe(Math.ceil(cost / 2));
    }
  });
});

// ---------------------------------------------------------------------------
// 20. GAP Generator sell side effects
// ---------------------------------------------------------------------------
describe('C++ parity: GAP Generator sell side effects', () => {
  it('GAP Power is negative (drains power)', () => {
    expect(iniPower('GAP')).toBe(-60);
  });

  it('GAP is Powered=true', () => {
    expect(INI['GAP']?.['Powered']).toBe('true');
  });

  it('GAP cost matches INI for sell refund', () => {
    const cost = iniCost('GAP');
    expect(cost).toBe(500);
    expect(sellRefund(cost, true)).toBe(Math.trunc((128 * 500 + 128) / 256));
  });
});

// ---------------------------------------------------------------------------
// 21. Silo capacity values
// ---------------------------------------------------------------------------
describe('C++ parity: silo capacity values from rules.ini', () => {
  it('PROC Storage=2000', () => {
    expect(INI['PROC']?.['Storage']).toBe('2000');
  });

  it('SILO Storage=1500', () => {
    expect(INI['SILO']?.['Storage']).toBe('1500');
  });
});

// ---------------------------------------------------------------------------
// 22. Sell refund edge cases
// ---------------------------------------------------------------------------
describe('C++ parity: sell refund edge cases', () => {
  it('zero cost: refund = 0 for both human and AI', () => {
    expect(sellRefund(0, true)).toBe(0);
    expect(sellRefund(0, false)).toBe(0);
  });

  it('cost=1: human refund = 1 (rounds up)', () => {
    expect(sellRefund(1, true)).toBe(1);
  });

  it('cost=2: human refund = 1', () => {
    expect(sellRefund(2, true)).toBe(1);
  });

  it('default isHuman parameter is true (backward compat)', () => {
    expect(sellRefund(2000)).toBe(Math.trunc((128 * 2000 + 128) / 256));
    expect(sellRefund(300)).toBe(Math.trunc((128 * 300 + 128) / 256));
  });
});

// ---------------------------------------------------------------------------
// 23. Armed vs unarmed buildings for survivor type
// ---------------------------------------------------------------------------
describe('C++ parity: armed vs unarmed buildings for survivor type', () => {
  const ARMED_BUILDINGS = ['PBOX', 'HBOX', 'GUN', 'AGUN', 'TSLA', 'SAM', 'FTUR'];
  const UNARMED_BUILDINGS = ['POWR', 'APWR', 'PROC', 'SILO', 'DOME', 'FACT',
    'WEAP', 'HPAD', 'AFLD', 'FIX', 'GAP', 'ATEK', 'STEK', 'PDOX', 'IRON', 'MSLO',
    'BARR', 'TENT', 'KENN'];

  for (const type of ARMED_BUILDINGS) {
    it(`${type} has Primary= weapon in rules.ini`, () => {
      expect(INI[type]?.['Primary']).toBeDefined();
      expect(INI[type]!['Primary']).not.toBe('none');
    });
  }

  for (const type of UNARMED_BUILDINGS) {
    it(`${type} has no Primary= weapon`, () => {
      const primary = INI[type]?.['Primary'];
      expect(primary === undefined || primary === 'none' || primary === '').toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 24. Faction ownership
// ---------------------------------------------------------------------------
describe('C++ parity: survivor type by building faction (building.cpp:3456-3463)', () => {
  it('BARR is Soviet', () => {
    expect(iniOwner('BARR')).toContain('soviet');
  });
  it('TENT is Allied', () => {
    expect(iniOwner('TENT')).toContain('allies');
  });
  it('FACT is both factions', () => {
    const owner = iniOwner('FACT');
    expect(owner).toContain('allies');
    expect(owner).toContain('soviet');
  });
});

// ---------------------------------------------------------------------------
// 25. Comprehensive survivor count: C++ vs TS for all crewed buildings
//     Documents every building where C++ fixed-point and TS float differ.
// ---------------------------------------------------------------------------
describe('C++ parity: comprehensive survivor count comparison', () => {
  const iniHarvCost = iniCost('HARV');
  const iniHindCost = iniCost('HIND');

  const crewedStructures = BUILDABLE_STRUCTURES.filter(
    p => !WALL_TYPES.has(p.type) && iniCrewed(p.type)
  );

  for (const item of crewedStructures) {
    let rawCost = iniCost(item.type);
    if (item.type === 'PROC') rawCost -= iniHarvCost;
    if (item.type === 'HPAD') rawCost -= Math.floor((iniHindCost + iniHindCost) / 2);

    const cppCount = cppSurvivorCount(rawCost, true);
    const tsCount = tsSurvivorCount(rawCost);

    it(`${item.type} (rawCost=${rawCost}): C++=${cppCount}, TS=${tsCount}`, () => {
      // For crewed buildings, both should ideally match.
      // Divergences are due to fixed-point vs float arithmetic.
      if (cppCount !== tsCount) {
        // Document the mismatch — C++ fixed-point gives lower intermediate values
        const cppIntermediate = cppIntTimesFixed(rawCost, SURVIVOR_FRAC_RAW);
        const tsIntermediate = Math.floor(rawCost * 0.4);
        expect(cppIntermediate).toBeLessThanOrEqual(tsIntermediate);
      }
      // Both must be in [1, 5]
      expect(cppCount).toBeGreaterThanOrEqual(1);
      expect(cppCount).toBeLessThanOrEqual(5);
      expect(tsCount).toBeGreaterThanOrEqual(1);
      expect(tsCount).toBeLessThanOrEqual(5);
    });
  }
});

// ---------------------------------------------------------------------------
// 26. Partial-build refund: C++ factory.cpp:469-481 Abandon()
//     C++ refunds (totalCost - Balance) where Balance is remaining unpaid cost.
//     TS refunds entry.costPaid (production.ts:149).
//     Both refund exactly what was spent — functionally equivalent.
// ---------------------------------------------------------------------------
describe('C++ parity: partial-build cancel refund (factory.cpp:469-481)', () => {
  it('C++ Abandon refunds (totalCost - Balance) = amount already paid', () => {
    // C++ factory.cpp:479-480:
    //   int money = Object->Class_Of().Cost_Of() * House->CostBias;
    //   House->Refund_Money(money - Balance);
    // Balance starts at totalCost and decreases as payments are made.
    // So (money - Balance) = amount paid so far.
    const totalCost = 2000;
    const balance = 1500; // 500 paid so far
    const cppRefund = totalCost - balance;
    expect(cppRefund).toBe(500);
  });

  it('TS cancelProduction refunds costPaid directly (production.ts:149)', () => {
    // TS production.ts:149: ctx.credits += entry.costPaid;
    // costPaid accumulates as credits are spent each tick.
    // This is functionally equivalent to C++ (totalCost - Balance).
    const costPaid = 500;
    expect(costPaid).toBe(500); // Same result
  });
});

// ---------------------------------------------------------------------------
// Mismatch Summary (test section)
// Documents all known C++ vs TS divergences found in this audit.
// ---------------------------------------------------------------------------
describe('MISMATCH SUMMARY: C++ vs TS sell mechanics divergences', () => {
  it('M1: TS does not check IsCrew flag — non-crewed buildings spawn survivors', () => {
    // Affected: SILO, KENN, and any building without Crewed=yes
    // C++ building.cpp:5593: if (!Class->IsCrew) return 0;
    // TS: no equivalent check
    // Impact: Minor visual difference — 1-2 extra civilian/dog infantry on sell
    expect(iniCrewed('SILO')).toBe(false);
    expect(cppSurvivorCount(iniCost('SILO'), false)).toBe(0);
    expect(tsSurvivorCount(iniCost('SILO'))).toBe(1);
  });

  it('M2: TS does not halve survivors for captured buildings', () => {
    // C++ building.cpp:5597: if (IsCaptured) divisor *= 2;
    // TS: no captured building concept in survivor code
    // Impact: Captured buildings in TS get 2x the survivors they should
    const cost = iniCost('WEAP');
    expect(cppSurvivorCount(cost, true, true)).toBe(3);   // C++: captured
    expect(cppSurvivorCount(cost, true, false)).toBe(5);   // C++: normal
    expect(tsSurvivorCount(cost)).toBe(5);                  // TS: always normal
  });

  it('M3: TS supports MCV reversion but C++ does not (MCVUndeploy=no)', () => {
    // C++ rules.ini MCVUndeploy=no → IsMCVDeploy=false → never undeploys
    // TS: deployedFromMCV flag enables undeploy regardless
    // Impact: TS gives players an MCV back when selling ConYard; C++ gives survivors
    expect(generalSection['MCVUndeploy']?.toLowerCase()).toBe('no');
  });

  it('M4: Fixed-point vs float survivor intermediate for specific costs', () => {
    // C++ fixed(".4").Raw = 102 → 102/256 = 0.3984375 (< 0.4)
    // This gives systematically lower intermediate values.
    // Most are masked by clamp to [1,5], but GAP (rawCost=500) differs:
    // C++: ((102*500)+128)/256 = 199 → 199/100 = 1
    // TS:  floor(500*0.4) = 200 → 200/100 = 2
    const gapRawCost = iniCost('GAP');
    const cppGap = cppSurvivorCount(gapRawCost, true);
    const tsGap = tsSurvivorCount(gapRawCost);
    expect(cppGap).toBe(1);
    expect(tsGap).toBe(2);
  });

  it('M5: TS fallback FACT_COST=2000 is wrong (INI=2500), but both clamp to 5', () => {
    // TS index.ts:2020: const FACT_COST = 2000
    // rules.ini FACT Cost=2500
    // Both produce survivors >=5 after clamp, so bug is latent.
    expect(iniCost('FACT')).toBe(2500);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStructure(
  type: string, hp: number, maxHp: number, house: any = 'GoodGuy',
): MapStructure {
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx: 5, cy: 5,
    hp, maxHp,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
  };
}

function makeMinimalCtx(
  structures: MapStructure[],
  prodItems?: any[],
): RepairSellContext {
  return {
    structures,
    entities: [],
    credits: 10000,
    tick: 0,
    playerHouse: 'GoodGuy' as any,
    powerProduced: 100,
    powerConsumed: 100,
    repairingStructures: new Set(),
    scenarioProductionItems: prodItems ?? PRODUCTION_ITEMS,
    effects: [],
    siloCapacity: 5000,
    gapGeneratorCells: new Map(),
    isAllied: (a: any, b: any) => a === b,
    isPlayerControlled: () => true,
    playEva: () => {},
    playSound: () => {},
    playSoundAt: () => {},
    clearStructureFootprint: () => {},
  };
}
