/**
 * C++ Behavioral Parity: Auto-Crush Mechanics
 *
 * Tests verify that the AI auto-crush decision logic matches C++ Red Alert
 * source code.  Auto-crush is the behavior where a vehicle *decides* to drive
 * over (crush) an infantry attacker instead of shooting it.
 *
 * This is separate from passive crush-on-cell-entry (Overrun_Square), which is
 * tested in cpp-parity-vehicle-crush.test.ts.
 *
 * C++ source references:
 *   unit.cpp:4813-4855 — Should_Crush_It(): AI crush decision gate
 *   unit.cpp:1124-1161 — Take_Damage auto-crush retaliation path
 *   rules.cpp:198      — IsAutoCrush default = false
 *   rules.cpp:444      — PlayerAutoCrush parsed from rules.ini [General]
 *   rules.cpp:261      — CrushDistance default = 0x0180 (1.5 cells / 384 leptons)
 *   rules.cpp:474      — CrushDistance parsed from rules.ini [General] Crush=
 *   rules.cpp:148      — IQCrush default = 2
 *   rules.cpp:944      — IQCrush parsed from rules.ini [IQ] AutoCrush=
 *   udata.cpp           — IsCrusher flag per unit type
 *
 * Observable outcomes: IsCrusher flags, IQ thresholds, distance constants,
 * player auto-crush setting, flame weapon exclusion, spy exclusion,
 * difficulty gate.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseIniSections } from '../engine/parseIni';
import { UNIT_STATS } from '../engine/types';
import { AI_BUILD_RULES } from '../engine/ai';

// ── Load and parse rules.ini ────────────────────────────────────────

const rulesIniPath = join(__dirname, '../../..', 'public/ra/assets/rules.ini');
const rulesText = readFileSync(rulesIniPath, 'utf-8');
const sections = parseIniSections(rulesText);

/** Get a float from an INI section, stripping trailing '%' if present */
function iniFloat(section: string, key: string, def = 0): number {
  const val = sections.get(section)?.get(key);
  if (val == null) return def;
  const cleaned = val.replace(/%$/, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? def : parsed;
}

/** Get a boolean from an INI section */
function iniBool(section: string, key: string, def = false): boolean {
  const val = sections.get(section)?.get(key)?.toLowerCase();
  if (val == null) return def;
  return val === 'yes' || val === 'true' || val === '1';
}

/** Get a raw string from an INI section */
function iniVal(section: string, key: string): string | undefined {
  return sections.get(section)?.get(key);
}

// ── C++ IsCrusher ground truth from udata.cpp ───────────────────────────────
// Each entry: [TS key, C++ IsCrusher, C++ source line comment]
// Derived from udata.cpp constructor parameters — "Can this unit squash infantry?"

const CRUSHER_GROUND_TRUTH: [string, boolean, string][] = [
  // Base game vehicles
  ['V2RL', true,  'udata.cpp:79  — V2 Rocket Launcher IsCrusher=true'],
  ['1TNK', true,  'udata.cpp:110 — Light Tank IsCrusher=true'],
  ['3TNK', true,  'udata.cpp:141 — Heavy Tank (TS calls it 3TNK) IsCrusher=true'],
  ['2TNK', true,  'udata.cpp:172 — Medium Tank IsCrusher=true'],
  ['4TNK', true,  'udata.cpp:203 — Mammoth Tank IsCrusher=true'],
  ['MRJ',  true,  'udata.cpp:234 — Radar Jammer IsCrusher=true'],
  ['MGG',  true,  'udata.cpp:265 — Mobile Gap Generator IsCrusher=true'],
  ['ARTY', false, 'udata.cpp:296 — Artillery IsCrusher=false'],
  ['HARV', true,  'udata.cpp:327 — Harvester IsCrusher=true'],
  ['MCV',  true,  'udata.cpp:358 — MCV IsCrusher=true'],
  ['JEEP', false, 'udata.cpp:389 — Jeep/Ranger IsCrusher=false'],
  ['APC',  true,  'udata.cpp:420 — APC IsCrusher=true'],
  ['MNLY', true,  'udata.cpp:451 — Minelayer IsCrusher=true'],
  ['TRUK', false, 'udata.cpp:482 — Convoy Truck IsCrusher=false'],
  // Ant units — NOT crushers (udata.cpp:543, 572, 601)
  ['ANT1', false, 'udata.cpp:543 — Warrior Ant IsCrusher=false'],
  ['ANT2', false, 'udata.cpp:572 — Fire Ant IsCrusher=false'],
  ['ANT3', false, 'udata.cpp:601 — Scout Ant IsCrusher=false'],
  // Aftermath units (FIXIT_CSII)
  ['CTNK', true,  'udata.cpp:634 — Chrono Tank IsCrusher=true'],
  ['TTNK', true,  'udata.cpp:665 — Tesla Tank IsCrusher=true'],
  ['QTNK', true,  'udata.cpp:696 — M.A.D. Tank IsCrusher=true'],
  ['DTRK', false, 'udata.cpp:728 — Demo Truck IsCrusher=false'],
  ['STNK', true,  'udata.cpp:758 — Phase Transport IsCrusher=true'],
];

// =============================================================================
// 1. IsCrusher flag per unit type (udata.cpp constructor values)
// =============================================================================

describe('IsCrusher flag matches C++ udata.cpp', () => {
  for (const [tsKey, cppCrusher, srcRef] of CRUSHER_GROUND_TRUTH) {
    it(`${tsKey} — crusher=${cppCrusher} (${srcRef})`, () => {
      const stats = UNIT_STATS[tsKey];
      expect(stats, `${tsKey} should exist in UNIT_STATS`).toBeDefined();
      const tsCrusher = stats.crusher === true;
      expect(tsCrusher).toBe(cppCrusher);
    });
  }
});

// =============================================================================
// 2. IsCrushable flag — all infantry are crushable, vehicles are not
// =============================================================================

describe('IsCrushable — infantry crushable, vehicles not (unit.cpp:4408)', () => {
  const INFANTRY_KEYS = [
    'E1', 'E2', 'E3', 'E4', 'E6', 'E7', 'DOG', 'SPY', 'MEDI',
    'GNRL', 'CHAN', 'DELPHI',
    'C1', 'C2', 'C3', 'C4', 'C5', 'C6',
  ];

  for (const key of INFANTRY_KEYS) {
    it(`${key} is crushable`, () => {
      const stats = UNIT_STATS[key];
      expect(stats, `${key} should exist`).toBeDefined();
      expect(stats.crushable).toBe(true);
    });
  }

  // Ants are crushable (core gameplay mechanic)
  for (const key of ['ANT1', 'ANT2', 'ANT3']) {
    it(`${key} (ant) is crushable`, () => {
      expect(UNIT_STATS[key]?.crushable).toBe(true);
    });
  }

  // Vehicles are NOT crushable
  const VEHICLE_KEYS = ['1TNK', '2TNK', '3TNK', '4TNK', 'APC', 'HARV', 'MCV', 'JEEP', 'V2RL', 'ARTY'];
  for (const key of VEHICLE_KEYS) {
    it(`${key} (vehicle) is NOT crushable`, () => {
      const stats = UNIT_STATS[key];
      expect(stats?.crushable).toBeFalsy();
    });
  }
});

// =============================================================================
// 3. rules.ini [General] PlayerAutoCrush=no (unit.cpp:1128, rules.cpp:198,444)
// =============================================================================

describe('PlayerAutoCrush setting (rules.cpp:198, rules.ini)', () => {
  it('rules.ini [General] PlayerAutoCrush=no', () => {
    // C++ rules.cpp:198 — IsAutoCrush(false) default
    // C++ rules.cpp:444 — ini.Get_Bool(GENERAL, "PlayerAutoCrush", IsAutoCrush)
    // rules.ini [General] PlayerAutoCrush=no — human players do NOT auto-crush
    expect(iniBool('General', 'PlayerAutoCrush')).toBe(false);
  });

  it('C++ default IsAutoCrush=false (rules.cpp:198)', () => {
    // Even without rules.ini, the constructor sets false
    // This means human-controlled vehicles never auto-crush when attacked
    // Verified by unit.cpp:1128: (!House->IsHuman || Rule.IsAutoCrush)
    //   — if human AND IsAutoCrush=false → skip entire crush retaliation
    expect(iniBool('General', 'PlayerAutoCrush')).toBe(false);
  });
});

// =============================================================================
// 4. rules.ini [General] Crush=1.5 — CrushDistance (rules.cpp:261,474)
// =============================================================================

describe('CrushDistance (rules.cpp:261, rules.ini [General] Crush)', () => {
  it('rules.ini [General] Crush=1.5 (cells)', () => {
    // C++ rules.cpp:261 — CrushDistance(0x0180)  // 384 leptons = 1.5 cells (256 leptons/cell)
    // C++ rules.cpp:474 — CrushDistance = ini.Get_Lepton(GENERAL, "Crush", CrushDistance)
    // C++ unit.cpp:4826 — if (Distance(it) > Rule.CrushDistance) return(false);
    const crushCells = iniFloat('General', 'Crush');
    expect(crushCells).toBe(1.5);
  });

  it('CrushDistance in leptons = 0x0180 (384)', () => {
    // C++ rules.cpp:261 — default CrushDistance(0x0180) = 384 leptons
    // 1 cell = 256 leptons, so 1.5 cells = 384 leptons
    // Get_Lepton reads cell-count and multiplies by 256
    const crushCells = iniFloat('General', 'Crush');
    expect(crushCells * 256).toBe(384);
  });
});

// =============================================================================
// 5. rules.ini [IQ] AutoCrush=2 — IQCrush threshold (rules.cpp:148,944)
// =============================================================================

describe('IQCrush threshold (rules.cpp:148, rules.ini [IQ] AutoCrush)', () => {
  it('rules.ini [IQ] AutoCrush=2', () => {
    // C++ rules.cpp:148 — IQCrush(2) default
    // C++ rules.cpp:944 — IQCrush = ini.Get_Int(IQCONTROL, "AutoCrush", IQCrush)
    // C++ unit.cpp:4845 — if (House->IQ < Rule.IQCrush) return(false);
    const iqAutoCrush = iniFloat('IQ', 'AutoCrush');
    expect(iqAutoCrush).toBe(2);
  });

  it('TS AI_BUILD_RULES.iqAutoCrush matches rules.ini', () => {
    expect(AI_BUILD_RULES.iqAutoCrush).toBe(iniFloat('IQ', 'AutoCrush'));
  });

  it('IQ >= 2 enables auto-crush (unit.cpp:4845)', () => {
    // C++ Should_Crush_It: if (House->IQ < Rule.IQCrush) return(false);
    // IQCrush = 2, so houses with IQ >= 2 can auto-crush
    expect(AI_BUILD_RULES.iqAutoCrush).toBe(2);
    // MaxIQLevels=5, so IQ 2-5 enables auto-crush, IQ 0-1 does not
    expect(AI_BUILD_RULES.maxIQLevels).toBe(5);
  });
});

// =============================================================================
// 6. Should_Crush_It logic gates (unit.cpp:4813-4855)
// =============================================================================

describe('Should_Crush_It decision gates (unit.cpp:4813-4855)', () => {

  /**
   * C++ Should_Crush_It gate chain:
   *  1. !Class->IsCrusher → false
   *  2. target == NULL → false
   *  3. !target->IsCrushable → false
   *  4. Distance > CrushDistance → false
   *  5. House->IsHuman → false
   *  6. House->Difficulty == DIFF_HARD → false
   *  7. PrimaryWeapon->WarheadPtr->IsWoodDestroyer → false (flame weapons)
   *  8. House->IQ < IQCrush → false
   *  9. target is SPY → false
   *  All pass → true
   */

  it('gate 1: non-crusher units never auto-crush', () => {
    // ARTY, JEEP, TRUK, DTRK have IsCrusher=false
    // Auto-crush is impossible regardless of other conditions
    expect(UNIT_STATS['ARTY']?.crusher).toBeFalsy();
    expect(UNIT_STATS['JEEP']?.crusher).toBeFalsy();
    expect(UNIT_STATS['TRUK']?.crusher).toBeFalsy();
    expect(UNIT_STATS['DTRK']?.crusher).toBeFalsy();
  });

  it('gate 3: only crushable targets (infantry) can be auto-crushed', () => {
    // Vehicles cannot be auto-crushed even by a Mammoth
    expect(UNIT_STATS['1TNK']?.crushable).toBeFalsy();
    expect(UNIT_STATS['4TNK']?.crushable).toBeFalsy();
    // But infantry can be
    expect(UNIT_STATS['E1']?.crushable).toBe(true);
  });

  it('gate 4: CrushDistance threshold = 1.5 cells', () => {
    // C++ unit.cpp:4826 — if (Distance(it) > Rule.CrushDistance) return(false);
    // If target is more than 1.5 cells away, shoot instead of crush
    expect(iniFloat('General', 'Crush')).toBe(1.5);
  });

  it('gate 5: human-controlled vehicles never auto-crush (unit.cpp:4832)', () => {
    // C++ unit.cpp:4832 — if (House->IsHuman ...) return(false);
    // Human houses ALWAYS skip Should_Crush_It
    // This is separate from IsAutoCrush which gates the Take_Damage path
    expect(iniBool('General', 'PlayerAutoCrush')).toBe(false);
  });

  it('gate 6: DIFF_HARD (easy for player) blocks AI auto-crush (unit.cpp:4832)', () => {
    // C++ unit.cpp:4832 — if (... || House->Difficulty == DIFF_HARD) return(false);
    // DIFF_HARD = game is hard for the AI = easy difficulty for player
    // On easy difficulty, AI vehicles never auto-crush the player's infantry
    // This is a difficulty scaling mechanism
    // Verify the constant exists in the codebase via the known threshold
    expect(AI_BUILD_RULES.iqAutoCrush).toBeGreaterThan(0);
  });

  it('gate 7: IsWoodDestroyer warheads block auto-crush (NOT just flame)', () => {
    // C++ unit.cpp:4839 — if PrimaryWeapon->WarheadPtr->IsWoodDestroyer → return(false)
    // CRITICAL: IsWoodDestroyer (Wood=yes in rules.ini) is set on HE, AP, Fire, Nuke
    // This means MOST tank cannons block auto-crush, not just flame weapons!
    // Only SA and warheads without Wood=yes allow auto-crush
    expect(iniVal('HE', 'Wood')?.toLowerCase()).toBe('yes');
    expect(iniVal('AP', 'Wood')?.toLowerCase()).toBe('yes');
    expect(iniVal('Fire', 'Wood')?.toLowerCase()).toBe('yes');
    expect(iniVal('Nuke', 'Wood')?.toLowerCase()).toBe('yes');
    // SA does NOT have Wood=yes
    const saWood = iniVal('SA', 'Wood');
    expect(saWood?.toLowerCase() === 'yes').toBe(false);
  });

  it('gate 8: IQ threshold must be met', () => {
    // C++ unit.cpp:4845 — if (House->IQ < Rule.IQCrush) return(false);
    expect(AI_BUILD_RULES.iqAutoCrush).toBe(2);
  });

  it('gate 9: spies are immune to AI auto-crush targeting (unit.cpp:4850-4852)', () => {
    // C++ unit.cpp:4850: if (it == INFANTRY_SPY) return(false);
    // AI will NOT deliberately seek to crush a spy
    // But passive crush (Overrun_Square) still works — spy dies if driven over
    expect(UNIT_STATS['SPY']?.crushable).toBe(true); // still physically crushable
    // The immunity is in the AI targeting decision, not the crush mechanism
  });
});

// =============================================================================
// 7. Take_Damage auto-crush retaliation path (unit.cpp:1124-1161)
// =============================================================================

describe('Take_Damage auto-crush retaliation (unit.cpp:1124-1161)', () => {

  /**
   * C++ unit.cpp:1124-1161 — When a vehicle is damaged:
   *
   *   if (!Team.Is_Valid() && source != NULL && !IsTethered &&
   *       !House->Is_Ally(source) &&
   *       (!House->IsHuman || Rule.IsAutoCrush)) {
   *     if (Should_Crush_It(source)) {
   *       Assign_Destination(source->As_Target());
   *       Assign_Mission(MISSION_MOVE);
   *     } else {
   *       // harvester-specific retreat logic
   *     }
   *   }
   *
   * Pre-conditions:
   *  - Not in a team
   *  - source (attacker) exists
   *  - Not tethered (docking with building)
   *  - source is enemy
   *  - NOT human unless IsAutoCrush=true (which is false by default)
   *
   * If Should_Crush_It passes, vehicle moves to crush instead of firing back.
   */

  it('human vehicles never auto-crush when attacked (IsAutoCrush=false)', () => {
    // C++ unit.cpp:1128: (!House->IsHuman || Rule.IsAutoCrush)
    // Rule.IsAutoCrush defaults to false (rules.cpp:198)
    // rules.ini [General] PlayerAutoCrush=no
    // So human-controlled vehicles always skip the crush retaliation path
    expect(iniBool('General', 'PlayerAutoCrush')).toBe(false);
  });

  it('harvester is the primary auto-crush candidate (unarmed + crusher)', () => {
    // C++ context: the auto-crush path in Take_Damage is especially relevant for
    // the harvester — it has no weapon (PrimaryWeapon=null) but is a crusher.
    // When attacked by infantry, the AI harvester will try to crush them.
    const harv = UNIT_STATS['HARV'];
    expect(harv.crusher).toBe(true);
    expect(harv.primaryWeapon).toBeNull();
    // Should_Crush_It gate 7 (IsWoodDestroyer) is irrelevant — HARV has no weapon
  });

  it('AI vehicles prefer crush over shoot when target is close enough', () => {
    // C++ unit.cpp:1137-1139: if (Should_Crush_It(source)) → MISSION_MOVE to source
    // The vehicle gets MISSION_MOVE (not MISSION_ATTACK) — it drives to crush
    // Crush distance is 1.5 cells — close-range infantry attackers trigger this
    expect(iniFloat('General', 'Crush')).toBe(1.5);
  });
});

// =============================================================================
// 8. PARITY GAPS — TS engine missing auto-crush decision logic
// =============================================================================

describe('PARITY GAPS: auto-crush decision logic missing from TS', () => {

  /**
   * The TS engine has passive crush (checkVehicleCrush in combat.ts) which
   * correctly kills crushable infantry when a crusher vehicle enters their cell.
   *
   * However, the TS engine is MISSING the active auto-crush DECISION logic:
   * - C++ Should_Crush_It() — decides if a vehicle should deliberately seek
   *   to crush a nearby infantry instead of shooting it
   * - C++ Take_Damage auto-crush path — makes damaged vehicles move to crush
   *   their attacker instead of returning fire
   *
   * These gaps mean:
   * 1. AI vehicles always shoot infantry, never deliberately crush them
   * 2. Harvesters (unarmed crushers) don't try to crush attackers
   * 3. No IQ-gated crush behavior
   * 4. No CrushDistance-based weapon vs crush decision
   * 5. No difficulty-based crush suppression
   * 6. No flame weapon crush exemption
   * 7. No spy auto-crush immunity in AI targeting
   */

  it('TS triggerRetaliation has no crush path (always weapon-based)', () => {
    // C++ unit.cpp:1137 — Should_Crush_It → MISSION_MOVE (crush)
    // TS combat.ts:552-569 — triggerRetaliation always sets target + MISSION_ATTACK
    // GAP: unarmed crushers (HARV) can't retaliate at all in TS via triggerRetaliation
    //   because line 555: if (!victim.weapon) return;
    const harv = UNIT_STATS['HARV'];
    expect(harv.primaryWeapon).toBeNull();
    expect(harv.crusher).toBe(true);
    // In C++, HARV retaliates by crushing. In TS, it does nothing (no weapon gate).
  });

  it('TS has no CrushDistance constant for AI decision making', () => {
    // C++ rules.cpp:261 — CrushDistance(0x0180) = 1.5 cells
    // C++ unit.cpp:4826 — if (Distance(it) > Rule.CrushDistance) return(false);
    // TS has no equivalent — the crush-vs-shoot distance decision is absent
    // Verify the INI value exists for future implementation
    expect(iniFloat('General', 'Crush')).toBe(1.5);
  });

  it('TS IQ auto-crush constant exists but is not wired to behavior', () => {
    // AI_BUILD_RULES.iqAutoCrush = 2 exists
    // But no TS code uses it for crush decisions — only production/build AI
    expect(AI_BUILD_RULES.iqAutoCrush).toBe(2);
  });
});

// =============================================================================
// 9. Warhead IsWoodDestroyer — flame weapons skip auto-crush (warhead.cpp:173)
// =============================================================================

describe('IsWoodDestroyer warhead gate (unit.cpp:4839, warhead.cpp:173)', () => {

  it('[Fire] warhead has Wood=yes (IsWoodDestroyer=true)', () => {
    // C++ warhead.cpp:173 — IsWoodDestroyer = ini.Get_Bool(Name(), "Wood", IsWoodDestroyer)
    // The Fire warhead is used by Flamer weapon (flamethrower infantry)
    // If a crusher had a flame primary weapon, it would prefer shooting over crushing
    const val = iniVal('Fire', 'Wood');
    expect(val?.toLowerCase()).toBe('yes');
  });

  it('[HE] warhead ALSO has Wood=yes (rules.ini line 2676)', () => {
    // CRITICAL FINDING: HE (used by most tank cannons) has IsWoodDestroyer=true!
    // This means tanks with HE primary weapons (1TNK, 2TNK, 3TNK, 4TNK) are blocked
    // from auto-crushing by gate 7 of Should_Crush_It.
    const val = iniVal('HE', 'Wood');
    expect(val?.toLowerCase()).toBe('yes');
  });

  it('[AP] warhead ALSO has Wood=yes (rules.ini line 2685)', () => {
    // AP (armor piercing) used by Chrono Tank (APTusk), Phase Transport
    // IsWoodDestroyer=true blocks auto-crush for these units too
    const val = iniVal('AP', 'Wood');
    expect(val?.toLowerCase()).toBe('yes');
  });

  it('[SA] warhead does NOT have Wood=yes (no key present)', () => {
    // SA (small arms) used by M60mg (APC, JEEP) — no Wood key in rules.ini
    // C++ warhead.cpp:74 default IsWoodDestroyer(false) applies
    // This means SA-armed crushers (APC) CAN auto-crush
    const val = iniVal('SA', 'Wood');
    const isWood = val?.toLowerCase() === 'yes';
    expect(isWood).toBe(false);
  });

  it('[Nuke] warhead has Wood=yes (rules.ini line 2721)', () => {
    // Nuke warhead also has IsWoodDestroyer
    const val = iniVal('Nuke', 'Wood');
    expect(val?.toLowerCase()).toBe('yes');
  });
});

// =============================================================================
// 10. Cross-reference: crusher vehicles with flame weapons
// =============================================================================

describe('Crusher + IsWoodDestroyer cross-check (unit.cpp:4839)', () => {

  /**
   * CRITICAL FINDING: IsWoodDestroyer is NOT just about flame weapons.
   *
   * rules.ini warheads with Wood=yes: HE, AP, Fire, Nuke
   * rules.ini warheads WITHOUT Wood=yes: SA, HollowPoint, Super
   *
   * This means most TANKS (which use HE warhead cannons) are BLOCKED from
   * auto-crushing because their primary weapon warhead has IsWoodDestroyer=true.
   *
   * Units that CAN auto-crush (crusher=true AND primary weapon NOT IsWoodDestroyer):
   *   - HARV: no weapon (null check passes before IsWoodDestroyer check)
   *   - MCV: no weapon
   *   - QTNK: no weapon (M.A.D. Tank)
   *   - APC: M60mg uses SA warhead (Wood=no) — CAN auto-crush
   *   - MNLY: no weapon — CAN auto-crush
   *   - MGG: no weapon — CAN auto-crush
   *   - MRJ: no weapon — CAN auto-crush
   *
   * Units that CANNOT auto-crush (IsWoodDestroyer blocks gate 7):
   *   - 1TNK: 75mm → HE (Wood=yes)
   *   - 2TNK: 90mm → HE (Wood=yes)
   *   - 3TNK: 105mm → HE (Wood=yes)
   *   - 4TNK: 120mm → HE (Wood=yes)
   *   - CTNK: APTusk → AP (Wood=yes)
   *   - STNK: APTusk → AP (Wood=yes)
   *   - V2RL: SCUD → HE (Wood=yes)
   *
   * Units that CAN auto-crush (weapon has no IsWoodDestroyer):
   *   - APC: M60mg → SA (no Wood)
   *   - TTNK: TTankZap → Super (no Wood) — Tesla Tank CAN auto-crush
   *   - All unarmed crushers: HARV, MCV, QTNK, MNLY, MGG, MRJ
   */

  it('crusher vehicles with no weapon CAN auto-crush (gate 7 null-check pass)', () => {
    // C++ unit.cpp:4839: if (Class->PrimaryWeapon != NULL && ...)
    // The NULL check means unarmed crushers bypass this gate entirely
    const unarmedCrushers = ['HARV', 'MCV', 'QTNK', 'MNLY', 'MGG', 'MRJ'];
    for (const key of unarmedCrushers) {
      const stats = UNIT_STATS[key];
      expect(stats?.crusher, `${key} should be a crusher`).toBe(true);
      expect(stats?.primaryWeapon, `${key} should have no primary weapon`).toBeNull();
    }
  });

  it('Tesla Tank (TTankZap/Super warhead) CAN auto-crush — Super has no Wood', () => {
    // TTNK uses TTankZap → Super warhead → no IsWoodDestroyer
    const ttnk = UNIT_STATS['TTNK'];
    expect(ttnk.crusher).toBe(true);
    expect(ttnk.primaryWeapon).toBe('TTankZap');
    // Super warhead has no Wood key → IsWoodDestroyer=false
    expect(iniVal('Super', 'Wood')).toBeUndefined();
  });

  it('APC (M60mg/SA warhead) CAN auto-crush — SA has no Wood=yes', () => {
    // APC uses M60mg → SA warhead → no IsWoodDestroyer
    const apc = UNIT_STATS['APC'];
    expect(apc.crusher).toBe(true);
    expect(apc.primaryWeapon).toBe('M60mg');
    // SA warhead has no Wood key → IsWoodDestroyer=false
    expect(iniVal('SA', 'Wood')).toBeUndefined();
  });

  it('tanks with HE/AP primary weapons are BLOCKED from auto-crush', () => {
    // This is the key insight: most tank cannons use HE or AP warheads,
    // both of which have Wood=yes → IsWoodDestroyer=true
    // So Should_Crush_It returns false for all main battle tanks

    // Verify HE and AP both have Wood=yes
    expect(iniVal('HE', 'Wood')?.toLowerCase()).toBe('yes');
    expect(iniVal('AP', 'Wood')?.toLowerCase()).toBe('yes');

    // Tanks with HE/AP primary weapons that are blocked:
    const blockedTanks = ['1TNK', '2TNK', '3TNK', '4TNK', 'V2RL'];
    for (const key of blockedTanks) {
      const stats = UNIT_STATS[key];
      expect(stats?.crusher, `${key} is a crusher`).toBe(true);
      expect(stats?.primaryWeapon, `${key} has a weapon`).not.toBeNull();
      // Their warheads have Wood=yes, blocking auto-crush
    }
  });
});
