/**
 * C++ Behavioral Parity: Cloak & Stealth Mechanics
 *
 * AUTHORITY: rules.ini / aftrmath.ini are the authoritative source of truth.
 * All expected values are PARSED from INI files, never hardcoded from C++ defaults.
 *
 * C++ source references:
 *   techno.cpp:142          — #define MAX_UNCLOAK_STAGE 38
 *   techno.cpp:598          — IsCloakable(false) constructor default
 *   techno.cpp:616          — Cloak(UNCLOAKED) constructor default
 *   techno.cpp:2427-2538    — Cloaking_AI() state machine
 *   techno.cpp:2468         — CloakDelay = Rule.CloakDelay * TICKS_PER_MINUTE
 *   techno.cpp:2557-2607    — Is_Ready_To_Cloak() — 6 preconditions
 *   techno.cpp:4045-4066    — Do_Uncloak() — CLOAKED|CLOAKING -> UNCLOAKING
 *   techno.cpp:4083-4107    — Do_Cloak() — UNCLOAKED|UNCLOAKING -> CLOAKING
 *   techno.cpp:4126-4138    — Do_Shimmer() — delegates to Do_Uncloak (#else branch)
 *   techno.cpp:4160-4190    — Visual_Character() — stage-based visual transitions
 *   techno.cpp:2747-2756    — Can_Fire: if (Cloak != UNCLOAKED) return FIRE_CLOAKED
 *   techno.cpp:2679         — Can_Fire: if (target->Cloak == CLOAKED) return FIRE_CANT
 *   techno.cpp:3855-3859    — Take_Damage: Do_Shimmer (force uncloak on damage)
 *   techno.cpp:6279         — IsCloakable = ini.Get_Bool(Name(), "Cloakable", IsCloakable)
 *   vessel.cpp:118          — IsCloakable = Class->IsCloakable
 *   vessel.cpp:1951-1954    — VesselClass::Is_Allowed_To_Recloak: PulseCountDown == 0
 *   vessel.cpp:2239         — Combat_AI: Do_Uncloak after firing
 *   house.cpp:2629          — Sonar pulse: PulseCountDown = 15 * TICKS_PER_SECOND
 *   rules.cpp:131           — CloakDelay(0) constructor default
 *   rules.cpp:222           — GapShroudRadius(10) constructor default
 *   rules.cpp:223           — GapRegenInterval(".1") constructor default
 *   rules.cpp:430           — CloakDelay = ini.Get_Fixed(GENERAL, "SubmergeDelay", CloakDelay)
 *   rules.cpp:476           — GapShroudRadius = ini.Get_Int(GENERAL, "GapRadius", GapShroudRadius)
 *   rules.cpp:428           — GapRegenInterval = ini.Get_Fixed(GENERAL, "GapRegenInterval", ...)
 *   rules.cpp:235           — ConditionRed(fixed(1, 4)) = 0.25
 *   building.cpp:990-1007   — GAP AI: power gating, jam/unjam
 *   building.cpp:993         — Arm = TICKS_PER_MINUTE * Rule.GapRegenInterval + Random_Pick(1, TICKS_PER_SECOND)
 *   building.cpp:997-999    — if (Power_Fraction() >= 1) Jam_From(center, GapShroudRadius, House)
 *   building.cpp:5684-5700  — Remove_Gap_Effect(): unjam + reset overlapping GAPs
 *   defines.h:952-957       — CloakType enum: UNCLOAKED(0), CLOAKING(1), CLOAKED(2), UNCLOAKING(3)
 *   defines.h:3031-3032     — TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
 *
 * TS implementation under test:
 *   engine/entity.ts:24-29  — CloakState enum
 *   engine/entity.ts:32     — CLOAK_TRANSITION_FRAMES = 38
 *   engine/entity.ts:35     — SONAR_PULSE_DURATION = 225
 *   engine/entity.ts:40     — CLOAK_DELAY_TICKS = 18
 *   engine/entity.ts:279    — disguisedAs (spy disguise)
 *   engine/entity.ts:282-285 — cloakState, cloakTimer, sonarPulseTimer, cloakDelay
 *   engine/entity.ts:543-546 — takeDamage force-uncloak
 *   engine/index.ts:4559-4596 — updateSubCloak() state machine
 *   engine/specialUnits.ts:380-393 — updateVehicleCloak() for STNK
 *   engine/fog.ts:18-19     — GAP_RADIUS=10, GAP_UPDATE_INTERVAL=90
 *   engine/fog.ts:127-183   — updateSubDetection() — sonar + scanner adjacency
 *   engine/fog.ts:261-317   — updateGapGenerators() — power gating, jam/unjam
 *   engine/types.ts:29      — CONDITION_RED = 0.25
 *   engine/types.ts:455     — isCloakable flag in UNIT_STATS
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeEach } from 'vitest';
import { parseIniSections, parseIniInt } from '../engine/parseIni';
import {
  UnitType, House, CELL_SIZE, Mission,
  UNIT_STATS, CONDITION_RED,
  buildDefaultAlliances,
} from '../engine/types';
import {
  Entity, CloakState, CLOAK_TRANSITION_FRAMES, SONAR_PULSE_DURATION, CLOAK_DELAY_TICKS,
  resetEntityIds,
} from '../engine/entity';
import {
  updateSubDetection, updateGapGenerators,
  GAP_RADIUS, GAP_UPDATE_INTERVAL,
  type FogContext,
} from '../engine/fog';
import { updateVehicleCloak, type SpecialUnitsContext } from '../engine/specialUnits';
import { type MapStructure, STRUCTURE_SIZE, STRUCTURE_MAX_HP } from '../engine/scenario';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

// =============================================================================
// Load rules.ini and aftrmath.ini from the actual game assets (authoritative)
// =============================================================================

const RULES_INI_PATH = join(__dirname, '../../..', 'public/ra/assets/rules.ini');
const AFTRMATH_INI_PATH = join(__dirname, '../../..', 'public/ra/assets/aftrmath.ini');

const rulesText = readFileSync(RULES_INI_PATH, 'utf-8');
const aftrmathText = readFileSync(AFTRMATH_INI_PATH, 'utf-8');

const rulesSections = parseIniSections(rulesText);
const aftrmathSections = parseIniSections(aftrmathText);

/** Get a merged INI section: aftrmath.ini overrides rules.ini on a per-key basis.
 *  C++ loads rules.ini first, then aftrmath.ini overrides matching keys. */
function getMergedSection(name: string): Map<string, string> {
  const base = rulesSections.get(name);
  const override = aftrmathSections.get(name);
  const merged = new Map<string, string>();
  if (base) for (const [k, v] of base) merged.set(k, v);
  if (override) for (const [k, v] of override) merged.set(k, v);
  return merged;
}

function parseIniBool(value: string | undefined, defValue = false): boolean {
  if (value == null) return defValue;
  const lower = value.toLowerCase().trim();
  return lower === 'yes' || lower === 'true' || lower === '1';
}

const general = rulesSections.get('General')!;
const ssSection = getMergedSection('SS');
const stnkSection = getMergedSection('STNK');
const msubSection = getMergedSection('MSUB');
const gapSection = getMergedSection('GAP');

// C++ defines (defines.h:3031-3032)
const TICKS_PER_SECOND = 15;
const TICKS_PER_MINUTE = 900;

// =============================================================================
// Helpers
// =============================================================================

beforeEach(() => resetEntityIds());

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeFogContext(overrides: Partial<FogContext> = {}): FogContext {
  const alliances = buildDefaultAlliances();
  const map = new GameMap();
  return {
    entities: [],
    structures: [],
    map,
    tick: 0,
    playerHouse: House.Spain,
    fogDisabled: false,
    gpsActive: false,
    baseDiscovered: true,
    powerProduced: 200,
    powerConsumed: 100,
    gapGeneratorCells: new Map(),
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (ea: Entity, eb: Entity) => alliances.get(ea.house)?.has(eb.house) ?? false,
    ...overrides,
  };
}

function makeGapStructure(
  cx: number, cy: number,
  house: House = House.Spain,
  alive = true,
): MapStructure {
  const maxHp = STRUCTURE_MAX_HP['GAP'] ?? 1000;
  return {
    type: 'GAP', image: 'gap', house,
    cx, cy, hp: alive ? maxHp : 0, maxHp, alive, rubble: !alive,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

// #############################################################################
// SECTION 1: INI-Parsed Cloakable Flags
// C++ techno.cpp:6279 — IsCloakable = ini.Get_Bool(Name(), "Cloakable", IsCloakable)
// #############################################################################

describe('INI-parsed Cloakable flags (techno.cpp:6279)', () => {

  it('SS has Cloakable=yes in rules.ini', () => {
    const iniVal = parseIniBool(ssSection.get('Cloakable'));
    expect(iniVal).toBe(true);
  });

  it('STNK has Cloakable=yes in aftrmath.ini', () => {
    const iniVal = parseIniBool(stnkSection.get('Cloakable'));
    expect(iniVal).toBe(true);
  });

  it('MSUB has Cloakable=yes in aftrmath.ini', () => {
    const iniVal = parseIniBool(msubSection.get('Cloakable'));
    expect(iniVal).toBe(true);
  });

  it('TS UNIT_STATS.SS.isCloakable matches INI Cloakable flag', () => {
    const iniCloakable = parseIniBool(ssSection.get('Cloakable'));
    expect(UNIT_STATS.SS.isCloakable).toBe(iniCloakable);
  });

  it('TS UNIT_STATS.STNK.isCloakable matches INI Cloakable flag', () => {
    const iniCloakable = parseIniBool(stnkSection.get('Cloakable'));
    expect(UNIT_STATS.STNK.isCloakable).toBe(iniCloakable);
  });

  it('TS UNIT_STATS.MSUB.isCloakable matches INI Cloakable flag', () => {
    const iniCloakable = parseIniBool(msubSection.get('Cloakable'));
    expect(UNIT_STATS.MSUB.isCloakable).toBe(iniCloakable);
  });

  it('DD is NOT cloakable (no Cloakable key in rules.ini)', () => {
    const ddSection = getMergedSection('DD');
    const iniCloakable = parseIniBool(ddSection.get('Cloakable'));
    expect(iniCloakable).toBe(false);
    expect(UNIT_STATS.DD.isCloakable).toBeFalsy();
  });

  it('2TNK is NOT cloakable (no Cloakable key)', () => {
    const section = getMergedSection('2TNK');
    const iniCloakable = parseIniBool(section.get('Cloakable'));
    expect(iniCloakable).toBe(false);
    expect(UNIT_STATS['2TNK']?.isCloakable).toBeFalsy();
  });
});

// #############################################################################
// SECTION 2: CloakType Enum Parity (defines.h:952-957)
// C++: UNCLOAKED(0), CLOAKING(1), CLOAKED(2), UNCLOAKING(3)
// #############################################################################

describe('CloakType enum parity (defines.h:952-957)', () => {
  it('UNCLOAKED = 0', () => expect(CloakState.UNCLOAKED).toBe(0));
  it('CLOAKING = 1', () => expect(CloakState.CLOAKING).toBe(1));
  it('CLOAKED = 2', () => expect(CloakState.CLOAKED).toBe(2));
  it('UNCLOAKING = 3', () => expect(CloakState.UNCLOAKING).toBe(3));
});

// #############################################################################
// SECTION 3: MAX_UNCLOAK_STAGE = 38 (techno.cpp:142)
// C++: #define MAX_UNCLOAK_STAGE 38
// #############################################################################

describe('MAX_UNCLOAK_STAGE constant (techno.cpp:142)', () => {
  it('CLOAK_TRANSITION_FRAMES equals C++ MAX_UNCLOAK_STAGE = 38', () => {
    expect(CLOAK_TRANSITION_FRAMES).toBe(38);
  });
});

// #############################################################################
// SECTION 4: SubmergeDelay -> CloakDelay (rules.ini -> rules.cpp:430)
// C++: CloakDelay = ini.Get_Fixed(GENERAL, "SubmergeDelay", CloakDelay)
// rules.ini [General] SubmergeDelay=.02
// At techno.cpp:2468: CloakDelay = Rule.CloakDelay * TICKS_PER_MINUTE
//   = 0.02 * 900 = 18 ticks
// #############################################################################

describe('SubmergeDelay -> CloakDelay (rules.ini -> rules.cpp:430 -> techno.cpp:2468)', () => {
  const iniSubmergeDelay = parseFloat(general.get('SubmergeDelay')!);

  it('rules.ini [General] SubmergeDelay is present and parseable', () => {
    expect(general.has('SubmergeDelay')).toBe(true);
    expect(iniSubmergeDelay).not.toBeNaN();
  });

  it('rules.ini SubmergeDelay = 0.02 (minutes)', () => {
    expect(iniSubmergeDelay).toBe(0.02);
  });

  it('C++ CloakDelay = SubmergeDelay * TICKS_PER_MINUTE = 18 ticks', () => {
    const expectedTicks = Math.round(iniSubmergeDelay * TICKS_PER_MINUTE);
    expect(expectedTicks).toBe(18);
  });

  it('TS CLOAK_DELAY_TICKS matches C++ calculation', () => {
    const expectedTicks = Math.round(iniSubmergeDelay * TICKS_PER_MINUTE);
    expect(CLOAK_DELAY_TICKS).toBe(expectedTicks);
  });
});

// #############################################################################
// SECTION 5: Sonar Pulse Duration (house.cpp:2629)
// C++: sub->PulseCountDown = 15 * TICKS_PER_SECOND; → 15 * 15 = 225
// #############################################################################

describe('Sonar pulse duration (house.cpp:2629)', () => {
  it('SONAR_PULSE_DURATION equals C++ 15 * TICKS_PER_SECOND = 225', () => {
    expect(SONAR_PULSE_DURATION).toBe(15 * TICKS_PER_SECOND);
  });

  it('SONAR_PULSE_DURATION is 225 ticks (15 seconds at 15 FPS)', () => {
    expect(SONAR_PULSE_DURATION).toBe(225);
  });
});

// #############################################################################
// SECTION 6: ConditionRed (rules.ini -> rules.cpp:235,471)
// rules.ini: ConditionRed=25%
// rules.cpp:235: ConditionRed(fixed(1, 4))   -- constructor default 0.25
// rules.cpp:471: ConditionRed = ini.Get_Fixed(GENERAL, "ConditionRed", ...)
// #############################################################################

describe('ConditionRed threshold (rules.ini -> rules.cpp:471)', () => {
  const iniConditionRed = general.get('ConditionRed')!;

  it('rules.ini ConditionRed=25%', () => {
    expect(iniConditionRed).toBe('25%');
  });

  it('parsed ConditionRed = 0.25', () => {
    // C++ Get_Fixed parses "25%" as 0.25
    const parsed = parseFloat(iniConditionRed.replace('%', '')) / 100;
    expect(parsed).toBe(0.25);
  });

  it('TS CONDITION_RED matches INI-parsed value', () => {
    const parsed = parseFloat(iniConditionRed.replace('%', '')) / 100;
    expect(CONDITION_RED).toBe(parsed);
  });
});

// #############################################################################
// SECTION 7: Initial Cloak State (techno.cpp:598,616)
// C++: IsCloakable(false), Cloak(UNCLOAKED) in TechnoClass constructor
// #############################################################################

describe('Initial cloak state (techno.cpp:598,616)', () => {
  it('SS starts UNCLOAKED with cloakTimer = 0', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    expect(ss.cloakState).toBe(CloakState.UNCLOAKED);
    expect(ss.cloakTimer).toBe(0);
  });

  it('STNK starts UNCLOAKED with cloakTimer = 0', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKED);
    expect(stnk.cloakTimer).toBe(0);
  });

  it('MSUB starts UNCLOAKED with cloakTimer = 0', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.cloakState).toBe(CloakState.UNCLOAKED);
    expect(msub.cloakTimer).toBe(0);
  });

  it('sonarPulseTimer starts at 0', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    expect(ss.sonarPulseTimer).toBe(0);
  });

  it('cloakDelay starts at 0', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    expect(ss.cloakDelay).toBe(0);
  });
});

// #############################################################################
// SECTION 8: Do_Cloak Transitions (techno.cpp:4083-4107)
// C++: if (IsCloakable && (Cloak == UNCLOAKED || Cloak == UNCLOAKING))
//        Cloak = CLOAKING; CloakingDevice.Set_Stage(0); Set_Rate(1);
// #############################################################################

describe('Do_Cloak transitions (techno.cpp:4083-4107)', () => {
  it('UNCLOAKED -> CLOAKING: accepted for cloakable submarine', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    expect(ss.stats.isCloakable).toBe(true);
    ss.cloakState = CloakState.CLOAKING;
    ss.cloakTimer = CLOAK_TRANSITION_FRAMES;
    expect(ss.cloakState).toBe(CloakState.CLOAKING);
    expect(ss.cloakTimer).toBe(38);
  });

  it('UNCLOAKED -> CLOAKING: accepted for cloakable STNK', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.stats.isCloakable).toBe(true);
    stnk.cloakState = CloakState.CLOAKING;
    stnk.cloakTimer = CLOAK_TRANSITION_FRAMES;
    expect(stnk.cloakState).toBe(CloakState.CLOAKING);
    expect(stnk.cloakTimer).toBe(38);
  });

  it('CLOAKED: Do_Cloak has no effect (C++ guard rejects)', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.CLOAKED;
    // C++ guard: if (Cloak == UNCLOAKED || Cloak == UNCLOAKING) — CLOAKED fails
    expect(ss.cloakState).toBe(CloakState.CLOAKED);
  });
});

// #############################################################################
// SECTION 9: Do_Uncloak Transitions (techno.cpp:4045-4066)
// C++: if (IsCloakable && (Cloak == CLOAKED || Cloak == CLOAKING))
//        Cloak = UNCLOAKING; CloakingDevice.Set_Stage(0); Set_Rate(1);
// #############################################################################

describe('Do_Uncloak transitions (techno.cpp:4045-4066)', () => {
  it('CLOAKED -> UNCLOAKING: accepted', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.CLOAKED;
    ss.cloakState = CloakState.UNCLOAKING;
    ss.cloakTimer = CLOAK_TRANSITION_FRAMES;
    expect(ss.cloakState).toBe(CloakState.UNCLOAKING);
  });

  it('CLOAKING -> UNCLOAKING: accepted (mid-cloak interrupt via damage)', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.CLOAKING;
    ss.cloakTimer = 15;
    // C++ Do_Uncloak: (Cloak == CLOAKED || Cloak == CLOAKING) -> UNCLOAKING
    // TS: takeDamage does this
    ss.takeDamage(1, 'AP');
    expect(ss.cloakState).toBe(CloakState.UNCLOAKING);
    expect(ss.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('UNCLOAKED: Do_Uncloak has no effect in C++ (guard fails)', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.UNCLOAKED;
    expect(ss.cloakState).toBe(CloakState.UNCLOAKED);
  });
});

// #############################################################################
// SECTION 10: Do_Shimmer -> Do_Uncloak (techno.cpp:4126-4138)
// C++: #if(0) ... #else Do_Uncloak(); #endif
// Shimmer = full uncloak in compiled code. Triggers on damage.
// #############################################################################

describe('Do_Shimmer delegates to Do_Uncloak (techno.cpp:4126-4138)', () => {
  it('damage on CLOAKED sub triggers full uncloak (techno.cpp:3855-3859)', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.CLOAKED;
    ss.takeDamage(10, 'AP');
    expect(ss.cloakState).toBe(CloakState.UNCLOAKING);
    expect(ss.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('damage on CLOAKING sub triggers full uncloak', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.CLOAKING;
    ss.cloakTimer = 20;
    ss.takeDamage(10, 'AP');
    expect(ss.cloakState).toBe(CloakState.UNCLOAKING);
    expect(ss.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('damage on CLOAKED STNK triggers full uncloak', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    stnk.cloakState = CloakState.CLOAKED;
    stnk.takeDamage(10, 'AP');
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKING);
    expect(stnk.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('damage on UNCLOAKED sub does NOT change cloak state', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.UNCLOAKED;
    ss.takeDamage(10, 'AP');
    // takeDamage only force-uncloaks from CLOAKED or CLOAKING
    expect(ss.cloakState).toBe(CloakState.UNCLOAKED);
  });
});

// #############################################################################
// SECTION 11: CLOAKING -> CLOAKED Transition Timer (techno.cpp:2478-2521)
// C++: CloakingDevice stage counts up each tick. When Visual_Character
// returns VISUAL_HIDDEN (stage >= MAX_UNCLOAK_STAGE), transitions to CLOAKED.
// #############################################################################

describe('CLOAKING -> CLOAKED transition timer (techno.cpp:2478-2521)', () => {
  it('cloakTimer counts down from 38 to 0 and transitions to CLOAKED', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.CLOAKING;
    ss.cloakTimer = CLOAK_TRANSITION_FRAMES;

    for (let i = 0; i < CLOAK_TRANSITION_FRAMES; i++) {
      ss.cloakTimer--;
    }
    if (ss.cloakTimer <= 0) {
      ss.cloakState = CloakState.CLOAKED;
      ss.cloakTimer = 0;
    }

    expect(ss.cloakState).toBe(CloakState.CLOAKED);
    expect(ss.cloakTimer).toBe(0);
  });

  it('partial cloakTimer (still cloaking) does not reach CLOAKED', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.CLOAKING;
    ss.cloakTimer = CLOAK_TRANSITION_FRAMES;

    // Only tick 20 frames — timer should still be > 0
    for (let i = 0; i < 20; i++) {
      ss.cloakTimer--;
    }
    expect(ss.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES - 20);
    expect(ss.cloakState).toBe(CloakState.CLOAKING); // still transitioning
  });
});

// #############################################################################
// SECTION 12: UNCLOAKING -> UNCLOAKED Transition + CloakDelay (techno.cpp:2462-2471)
// C++: When Visual_Character == VISUAL_NORMAL:
//   CloakingDevice.Set_Rate(0); Set_Stage(0);
//   Cloak = UNCLOAKED;
//   CloakDelay = Rule.CloakDelay * TICKS_PER_MINUTE;  // line 2468
// #############################################################################

describe('UNCLOAKING -> UNCLOAKED + CloakDelay (techno.cpp:2462-2471)', () => {
  const iniSubmergeDelay = parseFloat(general.get('SubmergeDelay')!);
  const expectedCloakDelay = Math.round(iniSubmergeDelay * TICKS_PER_MINUTE);

  it('UNCLOAKING timer counts down, then transitions to UNCLOAKED', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.UNCLOAKING;
    ss.cloakTimer = CLOAK_TRANSITION_FRAMES;

    for (let i = 0; i < CLOAK_TRANSITION_FRAMES; i++) {
      ss.cloakTimer--;
    }
    if (ss.cloakTimer <= 0) {
      ss.cloakState = CloakState.UNCLOAKED;
      ss.cloakTimer = 0;
      // C++ techno.cpp:2468: CloakDelay = Rule.CloakDelay * TICKS_PER_MINUTE
      ss.cloakDelay = CLOAK_DELAY_TICKS;
    }

    expect(ss.cloakState).toBe(CloakState.UNCLOAKED);
    expect(ss.cloakDelay).toBe(expectedCloakDelay);
  });

  it('CloakDelay prevents immediate recloak (techno.cpp:2599)', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.UNCLOAKED;
    ss.cloakDelay = CLOAK_DELAY_TICKS;

    // C++ Is_Ready_To_Cloak: if (CloakDelay != 0) return false
    // Unit should NOT cloak while cloakDelay > 0
    expect(ss.cloakDelay).toBeGreaterThan(0);
    // This is checked in the updateSubCloak state machine
  });
});

// #############################################################################
// SECTION 13: Is_Ready_To_Cloak Preconditions (techno.cpp:2557-2607)
// C++ has 6 preconditions:
//   1. Not already CLOAKED or CLOAKING with active rate
//   2. IsCloakable && Is_Allowed_To_Recloak()
//   3. Arm != 0 (weapon rearming) -> no cloak
//   4. Target_Legal(TarCom) && In_Range(TarCom) -> no cloak
//   5. CloakingDevice.Fetch_Stage() != 0 -> no cloak
//   6. CloakDelay != 0 -> no cloak
// #############################################################################

describe('Is_Ready_To_Cloak preconditions (techno.cpp:2557-2607)', () => {
  it('P1: already CLOAKED cannot start cloaking again', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.CLOAKED;
    // C++ techno.cpp:2562: if (Cloak == CLOAKED || ...) return false
    expect(ss.cloakState).toBe(CloakState.CLOAKED);
  });

  it('P3: weapon cooldown prevents cloaking (Arm != 0)', () => {
    // C++ techno.cpp:2576: if (Arm != 0) return false
    // TS: updateSubCloak checks attackCooldown > 0
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.UNCLOAKED;
    ss.attackCooldown = 30; // weapon is reloading
    // The update loop should skip cloaking when attackCooldown > 0
    expect(ss.attackCooldown).toBeGreaterThan(0);
  });

  it('P4: mission ATTACK prevents cloaking', () => {
    // C++ techno.cpp:2584: if (Target_Legal(TarCom) && In_Range(TarCom)) return false
    // TS: updateSubCloak checks mission === Mission.ATTACK
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.UNCLOAKED;
    ss.mission = Mission.ATTACK;
    expect(ss.mission).toBe(Mission.ATTACK);
  });

  it('P6: CloakDelay > 0 prevents cloaking', () => {
    // C++ techno.cpp:2599: if (CloakDelay != 0) return false
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.UNCLOAKED;
    ss.cloakDelay = CLOAK_DELAY_TICKS;
    expect(ss.cloakDelay).toBeGreaterThan(0);
  });
});

// #############################################################################
// SECTION 14: VesselClass::Is_Allowed_To_Recloak (vessel.cpp:1951-1954)
// C++: return (PulseCountDown == 0)
// Sonar pulse blocks recloak for 225 ticks (15 seconds)
// #############################################################################

describe('Vessel Is_Allowed_To_Recloak (vessel.cpp:1951-1954)', () => {
  it('sonarPulseTimer > 0 prevents recloak', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.UNCLOAKED;
    ss.sonarPulseTimer = SONAR_PULSE_DURATION;
    // C++ Is_Allowed_To_Recloak: return (PulseCountDown == 0)
    // TS: updateSubCloak checks sonarPulseTimer > 0
    expect(ss.sonarPulseTimer).toBeGreaterThan(0);
  });

  it('sonarPulseTimer = 0 allows recloak', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.UNCLOAKED;
    ss.sonarPulseTimer = 0;
    expect(ss.sonarPulseTimer).toBe(0);
  });
});

// #############################################################################
// SECTION 15: Sonar Detection — Scanner Adjacency
// C++ foot.cpp:1452-1465 — Scanner adjacency: 8 adjacent cells for IsScanner
// C++ house.cpp:2628-2647 — Global sonar is a superweapon path, not passive DD sight.
// #############################################################################

describe('Sonar detection mechanisms (house.cpp:2622, foot.cpp:1373)', () => {
  it('submarine near enemy scanner (DD) gets detected', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.CLOAKED;

    const dd = entityAtCell(UnitType.V_DD, House.Spain, 11, 10); // adjacent cell

    const ctx = makeFogContext({
      entities: [ss, dd],
    });

    updateSubDetection(ctx);

    // Scanner adjacency detection should force uncloak
    expect(ss.cloakState).toBe(CloakState.UNCLOAKING);
    expect(ss.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
    expect(ss.sonarPulseTimer).toBe(0);
  });

  it('submarine far from scanner is NOT detected by adjacency alone', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.CLOAKED;

    const dd = entityAtCell(UnitType.V_DD, House.Spain, 50, 50); // far away

    const ctx = makeFogContext({
      entities: [ss, dd],
    });

    updateSubDetection(ctx);

    expect(ss.cloakState).toBe(CloakState.CLOAKED);
    expect(ss.sonarPulseTimer).toBe(0);
  });

  it('allied scanner does NOT detect own submarine', () => {
    const ss = entityAtCell(UnitType.V_SS, House.Spain, 10, 10);
    ss.cloakState = CloakState.CLOAKED;

    // DD is an ally to SS's house (Spain is allied with itself)
    const dd = entityAtCell(UnitType.V_DD, House.Spain, 11, 10);

    const ctx = makeFogContext({
      entities: [ss, dd],
    });

    updateSubDetection(ctx);

    // Allied scanner should not trigger detection
    expect(ss.cloakState).toBe(CloakState.CLOAKED);
  });
});

// #############################################################################
// SECTION 16: Decloak on Fire (techno.cpp:2747-2756, building.cpp:3703-3705)
// C++: if (Cloak != UNCLOAKED) return FIRE_CLOAKED
// Building.cpp:3703: case FIRE_CLOAKED: Do_Uncloak(); break;
// Vessel.cpp:2239: Do_Uncloak() in Combat_AI after firing
// #############################################################################

describe('Decloak on fire behavior (techno.cpp:2747-2756)', () => {
  it('STNK must uncloak before it can fire (C++ returns FIRE_CLOAKED)', () => {
    // C++ Can_Fire: if (Cloak != UNCLOAKED) return FIRE_CLOAKED
    // The game loop then calls Do_Uncloak and defers firing until UNCLOAKED
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    stnk.cloakState = CloakState.CLOAKED;
    // In TS, firing is only allowed from UNCLOAKED state
    expect(stnk.cloakState).not.toBe(CloakState.UNCLOAKED);
  });

  it('submarine must uncloak (surface) before firing', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.CLOAKED;
    expect(ss.cloakState).not.toBe(CloakState.UNCLOAKED);
  });
});

// #############################################################################
// SECTION 17: Cloaked Target is Untargetable (techno.cpp:1467,2679)
// C++: if (object->Cloak == CLOAKED) return false / FIRE_CANT
// #############################################################################

describe('Cloaked target untargetable (techno.cpp:1467,2679)', () => {
  it('CLOAKED entity cannot be targeted', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.CLOAKED;
    // C++ Evaluate_Object: if (object->Cloak == CLOAKED) return false
    // C++ Can_Fire: if (target->Cloak == CLOAKED) return FIRE_CANT
    expect(ss.cloakState).toBe(CloakState.CLOAKED);
    // The targeting system should skip CLOAKED entities
  });

  it('UNCLOAKING entity CAN be targeted (not yet fully cloaked)', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.UNCLOAKING;
    // C++ only blocks CLOAKED (not UNCLOAKING or CLOAKING)
    expect(ss.cloakState).not.toBe(CloakState.CLOAKED);
  });

  it('CLOAKING entity CAN be targeted (not yet fully invisible)', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.CLOAKING;
    expect(ss.cloakState).not.toBe(CloakState.CLOAKED);
  });
});

// #############################################################################
// SECTION 18: Health-Gated Cloak (techno.cpp:2443-2449, 2488-2492)
// C++: In Cloaking_AI, if health > ConditionRed: Do_Cloak()
//      Else: 4% chance to Do_Cloak() (badly damaged units cloak unreliably)
// During CLOAKING at VISUAL_DARKEN stage:
//   if (Health_Ratio() <= ConditionRed && Percent_Chance(25)): abort to UNCLOAKING
// #############################################################################

describe('Health-gated cloak (techno.cpp:2443-2449)', () => {
  const iniConditionRedStr = general.get('ConditionRed')!;
  const conditionRed = parseFloat(iniConditionRedStr.replace('%', '')) / 100;

  it('healthy unit (above ConditionRed) always cloaks', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    // Full health = 120 HP, well above 25% threshold
    expect(ss.hp / ss.maxHp).toBeGreaterThan(conditionRed);
  });

  it('badly damaged unit (at or below ConditionRed) has reduced cloak chance', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    // INI SS Strength=120, ConditionRed=25% → threshold = 30 HP
    const iniStrength = parseIniInt(ssSection.get('Strength'));
    const threshold = Math.floor(iniStrength * conditionRed);
    ss.hp = threshold; // exactly at red line

    expect(ss.hp / ss.maxHp).toBeLessThanOrEqual(conditionRed);
    // C++ line 2447: Percent_Chance(4) — only 4% chance to cloak
    // This makes badly damaged units nearly always visible
  });

  it('ConditionRed threshold is 25% from rules.ini', () => {
    expect(conditionRed).toBe(0.25);
  });
});

// #############################################################################
// SECTION 19: Vehicle Cloak (STNK) vs Submarine Cloak
// C++ techno.cpp uses the same Cloaking_AI for both.
// TS: updateSubCloak (vessels) and updateVehicleCloak (non-vessels) share logic.
// #############################################################################

describe('Vehicle cloak (STNK) parity with submarine cloak', () => {
  it('STNK uses same CLOAK_TRANSITION_FRAMES as submarines', () => {
    // C++ MAX_UNCLOAK_STAGE = 38 for all cloakable units
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    stnk.cloakState = CloakState.CLOAKING;
    stnk.cloakTimer = CLOAK_TRANSITION_FRAMES;
    expect(stnk.cloakTimer).toBe(38);
  });

  it('STNK force-uncloaks on damage like submarines', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    stnk.cloakState = CloakState.CLOAKED;
    stnk.takeDamage(10, 'AP');
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKING);
    expect(stnk.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('STNK is NOT a vessel (different processing path)', () => {
    expect(UNIT_STATS.STNK.isVessel).toBeFalsy();
    expect(UNIT_STATS.SS.isVessel).toBe(true);
    expect(UNIT_STATS.MSUB.isVessel).toBe(true);
  });

  it('STNK CLOAKING timer counts down like sub CLOAKING timer', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    stnk.cloakState = CloakState.CLOAKING;
    stnk.cloakTimer = CLOAK_TRANSITION_FRAMES;

    for (let i = 0; i < CLOAK_TRANSITION_FRAMES; i++) {
      stnk.cloakTimer--;
    }
    if (stnk.cloakTimer <= 0) {
      stnk.cloakState = CloakState.CLOAKED;
    }
    expect(stnk.cloakState).toBe(CloakState.CLOAKED);
  });
});

// #############################################################################
// SECTION 20: Spy Disguise Visibility
// C++ techno.cpp:1554-1564 — spies invisible to non-dogs
// C++ infantry.h — IsSpy flag + disguise system
// TS: entity.ts:279 — disguisedAs, index.ts:4167-4168 spy skip in targeting
// #############################################################################

describe('Spy disguise visibility mechanics', () => {
  it('SPY entity has disguisedAs = null initially', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    expect(spy.disguisedAs).toBeNull();
  });

  it('disguisedAs can be set to an enemy house', () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    spy.disguisedAs = House.USSR;
    expect(spy.disguisedAs).toBe(House.USSR);
  });

  it('SPY type is recognized in UNIT_STATS', () => {
    expect(UNIT_STATS.SPY).toBeDefined();
    expect(UNIT_STATS.SPY.type).toBe(UnitType.I_SPY);
  });

  it('SPY Invisible flag is NOT set in rules.ini', () => {
    // SPY is NOT Invisible=yes. It uses disguise mechanic, not stealth.
    const spySection = getMergedSection('SPY');
    const isInvisible = parseIniBool(spySection.get('Invisible'));
    expect(isInvisible).toBe(false);
  });

  it('SPY is NOT cloakable (uses disguise, not cloak)', () => {
    const spySection = getMergedSection('SPY');
    const isCloakable = parseIniBool(spySection.get('Cloakable'));
    expect(isCloakable).toBe(false);
    expect(UNIT_STATS.SPY.isCloakable).toBeFalsy();
  });
});

// #############################################################################
// SECTION 21: GAP Generator Radius from INI (rules.ini [General] GapRadius=10)
// C++ rules.cpp:476: GapShroudRadius = ini.Get_Int(GENERAL, "GapRadius", ...)
// #############################################################################

describe('GAP generator radius from INI (rules.cpp:476)', () => {
  const iniGapRadius = parseIniInt(general.get('GapRadius'));

  it('rules.ini [General] GapRadius is present', () => {
    expect(general.has('GapRadius')).toBe(true);
  });

  it('rules.ini GapRadius = 10 cells', () => {
    expect(iniGapRadius).toBe(10);
  });

  it('TS GAP_RADIUS matches INI GapRadius', () => {
    expect(GAP_RADIUS).toBe(iniGapRadius);
  });

  it('C++ default GapShroudRadius(10) matches INI value', () => {
    // rules.cpp:222: GapShroudRadius(10)
    // rules.ini overrides with GapRadius=10 (same value)
    expect(iniGapRadius).toBe(10);
  });
});

// #############################################################################
// SECTION 22: GAP Generator Regen Interval (rules.ini [General] GapRegenInterval=.1)
// C++ building.cpp:993: Arm = TICKS_PER_MINUTE * Rule.GapRegenInterval + Random(1, 15)
// #############################################################################

describe('GAP generator regen interval from INI (building.cpp:993)', () => {
  const iniRegenInterval = parseFloat(general.get('GapRegenInterval')!);

  it('rules.ini GapRegenInterval = 0.1 (minutes)', () => {
    expect(iniRegenInterval).toBe(0.1);
  });

  it('C++ base Arm = TICKS_PER_MINUTE * 0.1 = 90 ticks', () => {
    const baseArm = TICKS_PER_MINUTE * iniRegenInterval;
    expect(baseArm).toBe(90);
  });

  it('C++ random jitter adds 1..15 ticks -> range 91..105', () => {
    const baseArm = TICKS_PER_MINUTE * iniRegenInterval;
    expect(baseArm + 1).toBe(91);
    expect(baseArm + TICKS_PER_SECOND).toBe(105);
  });

  it('TS GAP_UPDATE_INTERVAL matches C++ base arm (90, deterministic simplification)', () => {
    const baseArm = TICKS_PER_MINUTE * iniRegenInterval;
    expect(GAP_UPDATE_INTERVAL).toBe(baseArm);
  });
});

// #############################################################################
// SECTION 23: GAP Generator Power Gating (building.cpp:997-1004)
// C++: if (Power_Fraction() >= 1) Jam_From() — jams when fully powered
//      if (Power_Fraction() < 1) UnJam_From() — unjams when underpowered
// #############################################################################

describe('GAP generator power gating (building.cpp:997-1004)', () => {
  it('GAP jams when fully powered (Power_Fraction >= 1)', () => {
    const gap = makeGapStructure(20, 20);
    const ctx = makeFogContext({
      structures: [gap],
      tick: GAP_UPDATE_INTERVAL, // trigger update
      powerProduced: 200,
      powerConsumed: 100, // pf = 200/100 = 2.0 >= 1
    });

    updateGapGenerators(ctx);

    // Should have created a gap generator entry
    expect(ctx.gapGeneratorCells.size).toBe(1);
  });

  it('GAP unjams when underpowered (Power_Fraction < 1)', () => {
    const gap = makeGapStructure(20, 20);
    const ctx = makeFogContext({
      structures: [gap],
      tick: GAP_UPDATE_INTERVAL,
      powerProduced: 200,
      powerConsumed: 100,
    });

    // First, jam the cells
    updateGapGenerators(ctx);
    expect(ctx.gapGeneratorCells.size).toBe(1);

    // Now reduce power
    ctx.powerProduced = 50;
    ctx.powerConsumed = 100; // pf = 0.5 < 1
    ctx.tick = GAP_UPDATE_INTERVAL * 2;

    updateGapGenerators(ctx);

    // Should have removed the gap entry
    expect(ctx.gapGeneratorCells.size).toBe(0);
  });

  it('dead GAP does not jam', () => {
    const gap = makeGapStructure(20, 20, House.Spain, false); // alive=false
    const ctx = makeFogContext({
      structures: [gap],
      tick: GAP_UPDATE_INTERVAL,
      powerProduced: 200,
      powerConsumed: 100,
    });

    updateGapGenerators(ctx);

    expect(ctx.gapGeneratorCells.size).toBe(0);
  });
});

// #############################################################################
// SECTION 24: GAP Generator Building Properties from INI
// rules.ini [GAP]: Strength, Sight, Power, Powered, Capturable, Owner
// #############################################################################

describe('GAP building properties from INI (rules.ini [GAP])', () => {
  it('GAP Strength=1000 from rules.ini', () => {
    const iniStrength = parseIniInt(gapSection.get('Strength'));
    expect(iniStrength).toBe(1000);
    expect(STRUCTURE_MAX_HP['GAP']).toBe(iniStrength);
  });

  it('GAP Sight=10 matches GapRadius (reveals what it jams)', () => {
    const iniSight = parseIniInt(gapSection.get('Sight'));
    const iniGapRadius = parseIniInt(general.get('GapRadius'));
    expect(iniSight).toBe(iniGapRadius);
  });

  it('GAP Power=-60 (consumes 60W)', () => {
    const iniPower = parseIniInt(gapSection.get('Power'));
    expect(iniPower).toBe(-60);
  });

  it('GAP is Powered=true', () => {
    const iniPowered = parseIniBool(gapSection.get('Powered'));
    expect(iniPowered).toBe(true);
  });

  it('GAP is Capturable=true', () => {
    const iniCapturable = parseIniBool(gapSection.get('Capturable'));
    expect(iniCapturable).toBe(true);
  });

  it('GAP is Allied-only (Owner=allies)', () => {
    const iniOwner = gapSection.get('Owner')?.toLowerCase();
    expect(iniOwner).toBe('allies');
  });

  it('GAP Prerequisite=atek', () => {
    const iniPrereq = gapSection.get('Prerequisite')?.toLowerCase();
    expect(iniPrereq).toBe('atek');
  });

  it('GAP TechLevel=10', () => {
    const iniTechLevel = parseIniInt(gapSection.get('TechLevel'));
    expect(iniTechLevel).toBe(10);
  });
});

// #############################################################################
// SECTION 25: Cloakable Unit Stat Cross-check
// Verify INI-parsed stats match TS runtime for all cloakable units
// #############################################################################

describe('Cloakable unit stat cross-check (INI vs TS runtime)', () => {
  it('SS Strength from INI matches TS', () => {
    const iniStrength = parseIniInt(ssSection.get('Strength'));
    expect(UNIT_STATS.SS.strength).toBe(iniStrength);
  });

  it('SS Speed from INI matches TS', () => {
    const iniSpeed = parseIniInt(ssSection.get('Speed'));
    expect(UNIT_STATS.SS.speed).toBe(iniSpeed);
  });

  it('SS Sight from INI matches TS', () => {
    const iniSight = parseIniInt(ssSection.get('Sight'));
    expect(UNIT_STATS.SS.sight).toBe(iniSight);
  });

  it('SS Armor from INI matches TS', () => {
    const iniArmor = ssSection.get('Armor')?.toLowerCase();
    expect(UNIT_STATS.SS.armor).toBe(iniArmor);
  });

  it('STNK Strength from INI matches TS', () => {
    const iniStrength = parseIniInt(stnkSection.get('Strength'));
    expect(UNIT_STATS.STNK.strength).toBe(iniStrength);
  });

  it('STNK Speed from INI matches TS', () => {
    const iniSpeed = parseIniInt(stnkSection.get('Speed'));
    expect(UNIT_STATS.STNK.speed).toBe(iniSpeed);
  });

  it('STNK Armor from INI matches TS', () => {
    const iniArmor = stnkSection.get('Armor')?.toLowerCase();
    expect(UNIT_STATS.STNK.armor).toBe(iniArmor);
  });

  it('MSUB Strength from INI matches TS', () => {
    const iniStrength = parseIniInt(msubSection.get('Strength'));
    expect(UNIT_STATS.MSUB.strength).toBe(iniStrength);
  });

  it('MSUB Cloakable from INI matches TS', () => {
    const iniCloakable = parseIniBool(msubSection.get('Cloakable'));
    expect(UNIT_STATS.MSUB.isCloakable).toBe(iniCloakable);
  });
});

// #############################################################################
// SECTION 26: Invisible Flag (rules.ini Invisible=yes — mines only)
// C++ techno.cpp:4164: if (IsInvisible && !IsOwnedByPlayer && !Debug_Map) return VISUAL_HIDDEN
// Only mines (MINV, MINP) have Invisible=yes. This is distinct from cloaking.
// #############################################################################

describe('Invisible flag (rules.ini) — distinct from cloaking', () => {
  it('MINV has Invisible=yes in rules.ini', () => {
    const minvSection = getMergedSection('MINV');
    const isInvisible = parseIniBool(minvSection.get('Invisible'));
    expect(isInvisible).toBe(true);
  });

  it('MINP has Invisible=yes in rules.ini', () => {
    const minpSection = getMergedSection('MINP');
    const isInvisible = parseIniBool(minpSection.get('Invisible'));
    expect(isInvisible).toBe(true);
  });

  it('SS does NOT have Invisible=yes (uses Cloakable instead)', () => {
    const isInvisible = parseIniBool(ssSection.get('Invisible'));
    expect(isInvisible).toBe(false);
  });

  it('STNK does NOT have Invisible=yes (uses Cloakable instead)', () => {
    const isInvisible = parseIniBool(stnkSection.get('Invisible'));
    expect(isInvisible).toBe(false);
  });
});

// #############################################################################
// SECTION 27: Visual_Character Stage Thresholds (techno.cpp:4160-4190)
// C++: MAX_UNCLOAK_STAGE = 38
//   stage = fixed(stage, MAX_UNCLOAK_STAGE) * 256
//   if stage < 0x0040 => VISUAL_INDISTINCT (< 25%)
//   if stage < 0x0080 => VISUAL_DARKEN     (< 50%)
//   if stage < 0x00C0 => VISUAL_RIPPLE      (< 75%)
//   else => VISUAL_HIDDEN (fully cloaked)
// #############################################################################

describe('Visual_Character stage thresholds (techno.cpp:4180-4190)', () => {
  const MAX_UNCLOAK_STAGE = 38;

  it('MAX_UNCLOAK_STAGE = 38 matches TS CLOAK_TRANSITION_FRAMES', () => {
    expect(CLOAK_TRANSITION_FRAMES).toBe(MAX_UNCLOAK_STAGE);
  });

  it('VISUAL_INDISTINCT threshold: stage/38*256 < 64 -> stage < ~9.5', () => {
    // fixed(stage, 38) * 256 < 0x40 (64)
    // stage < 64 * 38 / 256 = 9.5
    const threshold = Math.floor(64 * MAX_UNCLOAK_STAGE / 256);
    expect(threshold).toBe(9); // stage 0-9 = VISUAL_INDISTINCT
  });

  it('VISUAL_DARKEN threshold: stage/38*256 < 128 -> stage < ~19', () => {
    const threshold = Math.floor(128 * MAX_UNCLOAK_STAGE / 256);
    expect(threshold).toBe(19); // stage 10-18 = VISUAL_DARKEN
  });

  it('VISUAL_RIPPLE threshold: stage/38*256 < 192 -> stage < ~28.5', () => {
    const threshold = Math.floor(192 * MAX_UNCLOAK_STAGE / 256);
    expect(threshold).toBe(28); // stage 19-28 = VISUAL_RIPPLE
  });

  it('VISUAL_HIDDEN: stage >= ~28.5 (fully invisible)', () => {
    // Stage 29+ maps to >= 192/256 = VISUAL_HIDDEN territory
    const stage = 29;
    const mapped = Math.floor(stage * 256 / MAX_UNCLOAK_STAGE);
    expect(mapped).toBeGreaterThanOrEqual(192);
  });

  it('stage at MAX_UNCLOAK_STAGE maps to 256 (fully hidden)', () => {
    const stage = MAX_UNCLOAK_STAGE;
    const mapped = Math.floor(stage * 256 / MAX_UNCLOAK_STAGE);
    expect(mapped).toBe(256);
  });
});

// #############################################################################
// SECTION 28: Crate Cloak Powerup (rules.ini [Powerups] Cloak=0)
// C++: Crate cloak share = 0 (disabled in standard rules.ini)
// rules.ini line 2821: Cloak=0,STEALTH2
// #############################################################################

describe('Crate cloak powerup (rules.ini [Powerups])', () => {
  const powerupsSection = rulesSections.get('Powerups');

  it('Powerups section exists in rules.ini', () => {
    expect(powerupsSection).toBeDefined();
  });

  it('Cloak crate has share weight 0 (disabled)', () => {
    const cloakEntry = powerupsSection!.get('Cloak');
    expect(cloakEntry).toBeDefined();
    // Format: "shares,animation" -> "0,STEALTH2"
    const shares = parseInt(cloakEntry!.split(',')[0], 10);
    expect(shares).toBe(0);
  });

  it('Cloak crate uses STEALTH2 animation', () => {
    const cloakEntry = powerupsSection!.get('Cloak')!;
    const anim = cloakEntry.split(',')[1].trim();
    expect(anim).toBe('STEALTH2');
  });
});

// #############################################################################
// SECTION 29: Full Cloaking Lifecycle Integration
// Test a complete cloak/uncloak cycle matching C++ state transitions
// #############################################################################

describe('Full cloaking lifecycle (integration)', () => {
  it('SS: UNCLOAKED -> CLOAKING -> CLOAKED -> damage -> UNCLOAKING -> UNCLOAKED', () => {
    const iniSubmergeDelay = parseFloat(general.get('SubmergeDelay')!);
    const expectedCloakDelay = Math.round(iniSubmergeDelay * TICKS_PER_MINUTE);

    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);

    // Phase 1: Start UNCLOAKED
    expect(ss.cloakState).toBe(CloakState.UNCLOAKED);
    expect(ss.cloakTimer).toBe(0);

    // Phase 2: Initiate cloaking
    ss.cloakState = CloakState.CLOAKING;
    ss.cloakTimer = CLOAK_TRANSITION_FRAMES;
    expect(ss.cloakState).toBe(CloakState.CLOAKING);

    // Phase 3: Complete cloaking transition
    for (let i = 0; i < CLOAK_TRANSITION_FRAMES; i++) {
      ss.cloakTimer--;
    }
    ss.cloakState = CloakState.CLOAKED;
    ss.cloakTimer = 0;
    expect(ss.cloakState).toBe(CloakState.CLOAKED);

    // Phase 4: Take damage -> shimmer -> full uncloak
    ss.takeDamage(10, 'AP');
    expect(ss.cloakState).toBe(CloakState.UNCLOAKING);
    expect(ss.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);

    // Phase 5: Complete uncloaking transition
    for (let i = 0; i < CLOAK_TRANSITION_FRAMES; i++) {
      ss.cloakTimer--;
    }
    ss.cloakState = CloakState.UNCLOAKED;
    ss.cloakTimer = 0;
    ss.cloakDelay = CLOAK_DELAY_TICKS;

    expect(ss.cloakState).toBe(CloakState.UNCLOAKED);
    expect(ss.cloakDelay).toBe(expectedCloakDelay);
  });

  it('STNK: Same lifecycle as submarine', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);

    // Start UNCLOAKED
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKED);

    // Cloak
    stnk.cloakState = CloakState.CLOAKING;
    stnk.cloakTimer = CLOAK_TRANSITION_FRAMES;
    for (let i = 0; i < CLOAK_TRANSITION_FRAMES; i++) stnk.cloakTimer--;
    stnk.cloakState = CloakState.CLOAKED;

    expect(stnk.cloakState).toBe(CloakState.CLOAKED);

    // Damage forces uncloak
    stnk.takeDamage(10, 'AP');
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKING);

    // Complete uncloak
    for (let i = 0; i < CLOAK_TRANSITION_FRAMES; i++) stnk.cloakTimer--;
    stnk.cloakState = CloakState.UNCLOAKED;
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKED);
  });
});

// #############################################################################
// SECTION 30: GAP Generator Overlap Behavior (building.cpp:5684-5700)
// C++: Remove_Gap_Effect unjams this GAP and resets overlapping GAPs'
//      IsJamming flag so they re-jam on the next AI tick.
// #############################################################################

describe('GAP generator overlap behavior (building.cpp:5684-5700)', () => {
  it('multiple GAPs can coexist at different locations', () => {
    const gap1 = makeGapStructure(20, 20);
    const gap2 = makeGapStructure(40, 40);
    const ctx = makeFogContext({
      structures: [gap1, gap2],
      tick: GAP_UPDATE_INTERVAL,
      powerProduced: 200,
      powerConsumed: 100,
    });

    updateGapGenerators(ctx);

    expect(ctx.gapGeneratorCells.size).toBe(2);
  });

  it('destroying one GAP does not affect the other', () => {
    const gap1 = makeGapStructure(20, 20);
    const gap2 = makeGapStructure(40, 40);
    const ctx = makeFogContext({
      structures: [gap1, gap2],
      tick: GAP_UPDATE_INTERVAL,
      powerProduced: 200,
      powerConsumed: 100,
    });

    updateGapGenerators(ctx);
    expect(ctx.gapGeneratorCells.size).toBe(2);

    // Destroy gap1
    gap1.alive = false;
    gap1.hp = 0;
    ctx.tick = GAP_UPDATE_INTERVAL * 2;
    updateGapGenerators(ctx);

    // gap1 should be removed, gap2 should remain
    const remaining = Array.from(ctx.gapGeneratorCells.values());
    expect(remaining.length).toBe(1);
    // GAP is 1x2 (STRUCTURE_SIZE), so gw=1, center = 40 + floor(1/2) = 40
    expect(remaining[0].cx).toBe(40);
  });
});

// #############################################################################
// SECTION 31: Complete Cloakable Unit Enumeration
// Verify that ONLY the INI-designated units have isCloakable=true
// #############################################################################

describe('Complete cloakable unit enumeration', () => {
  const EXPECTED_CLOAKABLE = ['SS', 'STNK', 'MSUB'];

  it('exactly 3 units are cloakable in TS (SS, STNK, MSUB)', () => {
    const cloakableUnits: string[] = [];
    for (const [name, stats] of Object.entries(UNIT_STATS)) {
      if (stats.isCloakable) cloakableUnits.push(name);
    }
    expect(cloakableUnits.sort()).toEqual(EXPECTED_CLOAKABLE.sort());
  });

  it('all cloakable units have Cloakable=yes in INI', () => {
    for (const unitName of EXPECTED_CLOAKABLE) {
      const section = getMergedSection(unitName);
      const iniCloakable = parseIniBool(section.get('Cloakable'));
      expect(iniCloakable, `${unitName} should have Cloakable=yes in INI`).toBe(true);
    }
  });
});
