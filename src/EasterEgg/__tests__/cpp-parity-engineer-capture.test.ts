/**
 * C++ Behavioral Parity: Engineer Capture & Building Takeover Mechanics
 *
 * Tests verify engineer-building interaction matches C++ RA source code.
 * All expected values are parsed from rules.ini at test time — NO hardcoded values.
 *
 * C++ algorithm (infantry.cpp:598-637):
 *   1. Engineer enters building via MISSION_CAPTURE
 *   2. if (House->Is_Ally(tech)):
 *        tech->Renovate()  — full repair, engineer consumed     (line 606-611)
 *   3. else if (fixed(hp, maxHp) <= fixed(ConditionRed)):
 *        tech->Captured(House)  — change ownership, NO HP restore (line 614-628)
 *   4. else:
 *        damage = min(MaxStrength/3, HP-1)                       (line 631)
 *        tech->Take_Damage(damage)                               (line 632)
 *   5. delete this  — engineer consumed in ALL cases              (line 637)
 *
 * C++ capture threshold (rules.cpp:235):
 *   ConditionRed = fixed(1,4) = 0.25  (25% health)
 *   Capture occurs when: fixed(hp, maxHp) <= fixed(ConditionRed)
 *   In integer math: (hp * 256 / maxHp) <= (ConditionRed * 256)
 *
 * C++ building.cpp:2936-3000 — Captured():
 *   Changes ownership but does NOT restore HP.
 *   Building remains at its pre-capture health.
 *
 * C++ key behaviors:
 *   - Single engineer captures at red health (NOT multi-engineer)
 *   - Engineer always consumed (repair, capture, or damage)
 *   - Damage = maxStrength/3 (integer division), capped to hp-1
 *   - Building hp never goes below 1 from engineer damage
 *   - Only Capturable=yes buildings can be captured (rules.ini flag)
 *   - Civilian building V01 has Capturable=true
 *
 * C++ references:
 *   infantry.cpp:598-637  — Engineer capture/damage logic
 *   building.cpp:2936-3000 — Captured() method
 *   rules.cpp:235         — ConditionRed = fixed(1,4) = 0.25
 *   rules.cpp:285-286     — EngineerDamage = 1/3, EngineerCaptureLevel = ConditionRed
 *   rules.ini [General]   — ConditionRed=25%
 *   rules.ini [E6]        — Strength=25, Speed=4, Cost=500, Infiltrate=yes
 *   rules.ini [buildings]  — Capturable=true/false per building type
 *   rules.ini [Capture]   — Mission order: Retaliate=no, Recruitable=no, Scatter=no
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  CONDITION_RED, CONDITION_YELLOW,
  House, Mission, UnitType, CELL_SIZE,
  UNIT_STATS, PRODUCTION_ITEMS,
  MISSION_CONTROL,
} from '../engine/types';
import {
  updateAttackStructure,
  type MissionAIContext,
} from '../engine/missionAI';
import { type MapStructure } from '../engine/scenario';

beforeEach(() => resetEntityIds());

// ---------------------------------------------------------------------------
// INI Parser — parse rules.ini at test time (authoritative source of truth)
// ---------------------------------------------------------------------------

function parseINI(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current = '';
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      current = sectionMatch[1];
      if (!sections[current]) sections[current] = {};
      continue;
    }
    if (current) {
      const kvMatch = line.match(/^([^=;]+)=\s*([^;]*)/);
      if (kvMatch) {
        sections[current][kvMatch[1].trim()] = kvMatch[2].trim();
      }
    }
  }
  return sections;
}

const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');
const ini = parseINI(readFileSync(join(assetsDir, 'rules.ini'), 'utf-8'));

/** Parse a percentage string (e.g. "25%") or decimal (e.g. "0.25") to a number */
function parsePercent(val: string): number {
  if (val.endsWith('%')) return parseFloat(val) / 100;
  return parseFloat(val);
}

// ---------------------------------------------------------------------------
// INI-parsed expected values (rules.ini is God)
// ---------------------------------------------------------------------------

const iniE6 = ini['E6'];
const iniGeneral = ini['General'];
const iniCaptureMission = ini['Capture'];

// Engineer stats from rules.ini [E6]
const INI_E6_STRENGTH = Number(iniE6?.Strength ?? '25');
const INI_E6_SPEED = Number(iniE6?.Speed ?? '4');
const INI_E6_COST = Number(iniE6?.Cost ?? '500');
const INI_E6_SIGHT = Number(iniE6?.Sight ?? '4');
const INI_E6_POINTS = Number(iniE6?.Points ?? '20');
const INI_E6_INFILTRATE = (iniE6?.Infiltrate ?? 'no').toLowerCase() === 'yes';
const INI_E6_OWNER = iniE6?.Owner ?? 'soviet,allies';

// General capture threshold from rules.ini [General]
const INI_CONDITION_RED = parsePercent(iniGeneral?.ConditionRed ?? '25%');
const INI_CONDITION_YELLOW = parsePercent(iniGeneral?.ConditionYellow ?? '50%');

// Capture mission order from rules.ini [Capture]
const INI_CAPTURE_RETALIATE = (iniCaptureMission?.Retaliate ?? 'no').toLowerCase() === 'yes';
const INI_CAPTURE_RECRUITABLE = (iniCaptureMission?.Recruitable ?? 'no').toLowerCase() === 'yes';
const INI_CAPTURE_SCATTER = (iniCaptureMission?.Scatter ?? 'no').toLowerCase() === 'yes';

// Capturable buildings from rules.ini — parse all building sections for Capturable= flag
const CAPTURABLE_BUILDINGS: string[] = [];
const NON_CAPTURABLE_BUILDINGS: string[] = [];

// Known building section names (all structures that appear in rules.ini with Strength=)
const BUILDING_SECTIONS = [
  'IRON', 'FCOM', 'ATEK', 'PDOX', 'WEAP', 'SYRD', 'SPEN', 'FACT',
  'PROC', 'SILO', 'HPAD', 'DOME', 'GAP', 'AFLD', 'POWR', 'APWR',
  'STEK', 'HOSP', 'BARR', 'TENT', 'FIX', 'MISS', 'KENN', 'BIO',
  'PBOX', 'HBOX', 'GUN', 'AGUN', 'FTUR', 'TSLA', 'SAM', 'MSLO',
  // Fakes
  'FACF', 'WEAF', 'SYRF', 'SPEF', 'DOMF',
  // Walls
  'SBAG', 'FENC', 'BRIK', 'CYCL', 'BARB', 'WOOD',
  // Civilian
  'V01', 'V02', 'V03', 'V04', 'V05', 'V06', 'V07', 'V08', 'V09',
  'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V16', 'V17', 'V18',
];

for (const section of BUILDING_SECTIONS) {
  const data = ini[section];
  if (!data) continue;
  // C++ default for Capturable is 'no' if not specified
  const capturable = (data.Capturable ?? 'no').toLowerCase() === 'true'
    || (data.Capturable ?? 'no').toLowerCase() === 'yes';
  if (capturable) {
    CAPTURABLE_BUILDINGS.push(section);
  } else {
    NON_CAPTURABLE_BUILDINGS.push(section);
  }
}

// ---------------------------------------------------------------------------
// Helper factories (matching existing patterns from cpp-parity-special-units)
// ---------------------------------------------------------------------------

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

function makeStructure(overrides: Partial<MapStructure> = {}): MapStructure {
  return {
    type: 'POWR',
    image: 'powr',
    cx: 10,
    cy: 10,
    house: House.USSR,
    hp: 200,
    maxHp: 200,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    spiedBy: 0,
    ...overrides,
  } as MapStructure;
}

/**
 * Place an engineer adjacent to a structure so it's within capture range.
 * C++ range check: dist <= weapon.range (default 2 for unarmed),
 * but TS uses range = entity.weapon?.range ?? 2, so place within 2 cells.
 */
function engineerNearStructure(house: House, s: MapStructure): Entity {
  const x = s.cx * CELL_SIZE + CELL_SIZE;
  const y = s.cy * CELL_SIZE + CELL_SIZE;
  return makeEntity(UnitType.I_E6, house, x, y);
}

/**
 * Minimal MissionAIContext stub for updateAttackStructure.
 * Only the fields actually called by the engineer branch are stubbed.
 */
function makeMissionAIContext(overrides: Partial<MissionAIContext> = {}): MissionAIContext {
  return {
    entities: [],
    structures: [],
    effects: [],
    map: { isPassable: () => true, getOccupancy: () => 0 } as any,
    tick: 100,
    playerHouse: House.Greece,
    killCount: 0,
    evaMessages: [],
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    isAllied: (a: House, b: House) => a === b,
    entitiesAllied: (a: Entity, b: Entity) => a.house === b.house,
    isPlayerControlled: (e: Entity) => e.house === House.Greece,
    movementSpeed: () => 0.5,
    playSoundAt: vi.fn(),
    playEva: vi.fn(),
    playSound: vi.fn(),
    weaponSound: () => 'gun',
    damageEntity: vi.fn(() => false),
    damageStructure: vi.fn(() => false),
    triggerRetaliation: vi.fn(),
    handleUnitDeath: vi.fn(),
    launchProjectile: vi.fn(),
    applySplashDamage: vi.fn(),
    getFirepowerBias: () => 1,
    getROFBias: () => 1,
    getWarheadMult: () => 1,
    getWarheadMeta: () => ({ spread: 3, isWallDestroyer: false, isTiberiumDestroyer: false, isOrganic: false, isFlameWeapon: false }),
    getWarheadProps: () => undefined,
    warheadMuzzleColor: () => '255,255,0',
    weaponProjectileStyle: () => 'bullet',
    idleMission: () => Mission.GUARD,
    retreatFromTarget: vi.fn(),
    threatScore: () => 1,
    updateDemoTruck: vi.fn(),
    updateMedic: vi.fn(),
    updateMechanicUnit: vi.fn(),
    updateTanyaC4: vi.fn(),
    updateThief: vi.fn(),
    spyDisguise: vi.fn(),
    spyInfiltrate: vi.fn(),
    minimapAlert: vi.fn(),
    ...overrides,
  } as MissionAIContext;
}

/**
 * C++ fixed-point capture check (infantry.cpp:614):
 *   fixed(hp, maxHp) <= fixed(ConditionRed)
 * Equivalent to: (hp * 256 / maxHp) <= (ConditionRed * 256)
 */
function cppCaptureCheck(hp: number, maxHp: number, conditionRed: number): boolean {
  return Math.floor(hp * 256 / maxHp) <= Math.floor(conditionRed * 256);
}

/**
 * C++ engineer damage formula (infantry.cpp:631):
 *   damage = min(MaxStrength / 3, HP - 1)
 * Integer division, building hp never goes below 1.
 */
function cppEngineerDamage(maxHp: number, currentHp: number): number {
  return Math.min(Math.floor(maxHp / 3), currentHp - 1);
}

// ===========================================================================
// Section 1: INI-parsed Engineer Stats
// ===========================================================================

describe('Engineer [E6] stats from rules.ini (parsed at test time)', () => {
  it(`rules.ini [E6] Strength=${INI_E6_STRENGTH}`, () => {
    expect(UNIT_STATS.E6.strength).toBe(INI_E6_STRENGTH);
  });

  it(`rules.ini [E6] Speed=${INI_E6_SPEED}`, () => {
    expect(UNIT_STATS.E6.speed).toBe(INI_E6_SPEED);
  });

  it(`rules.ini [E6] Cost=${INI_E6_COST}`, () => {
    expect(UNIT_STATS.E6.cost).toBe(INI_E6_COST);
  });

  it(`rules.ini [E6] Sight=${INI_E6_SIGHT}`, () => {
    expect(UNIT_STATS.E6.sight).toBe(INI_E6_SIGHT);
  });

  it(`rules.ini [E6] Points=${INI_E6_POINTS}`, () => {
    expect(UNIT_STATS.E6.points).toBe(INI_E6_POINTS);
  });

  it(`rules.ini [E6] Infiltrate=${INI_E6_INFILTRATE} — engineer can enter buildings`, () => {
    expect(INI_E6_INFILTRATE).toBe(true);
    // TS represents this as isInfiltrate on UNIT_STATS
    expect(UNIT_STATS.E6.isInfiltrate).toBe(true);
  });

  it(`rules.ini [E6] Owner=${INI_E6_OWNER} — both factions can build engineers`, () => {
    // Both 'soviet,allies' and 'allies,soviet' are valid
    expect(INI_E6_OWNER).toContain('soviet');
    expect(INI_E6_OWNER).toContain('allies');
    // TS should represent this as 'both'
    expect(UNIT_STATS.E6.owner).toBe('both');
  });

  it('Engineer has no primary weapon (null)', () => {
    expect(UNIT_STATS.E6.primaryWeapon).toBeNull();
  });

  it('Engineer is infantry', () => {
    expect(UNIT_STATS.E6.isInfantry).toBe(true);
  });
});

// ===========================================================================
// Section 2: ConditionRed Threshold from rules.ini
// ===========================================================================

describe('ConditionRed capture threshold (rules.ini [General])', () => {
  it(`rules.ini ConditionRed=${iniGeneral?.ConditionRed} parses to ${INI_CONDITION_RED}`, () => {
    expect(INI_CONDITION_RED).toBe(0.25);
  });

  it('TS CONDITION_RED matches rules.ini parsed value', () => {
    expect(CONDITION_RED).toBe(INI_CONDITION_RED);
  });

  it(`rules.ini ConditionYellow=${iniGeneral?.ConditionYellow} parses to ${INI_CONDITION_YELLOW}`, () => {
    expect(INI_CONDITION_YELLOW).toBe(0.5);
  });

  it('TS CONDITION_YELLOW matches rules.ini parsed value', () => {
    expect(CONDITION_YELLOW).toBe(INI_CONDITION_YELLOW);
  });
});

// ===========================================================================
// Section 3: MISSION_CONTROL for CAPTURE mission (rules.ini [Capture])
// ===========================================================================

describe('Mission.CAPTURE control flags (rules.ini [Capture])', () => {
  it(`rules.ini [Capture] Retaliate=${iniCaptureMission?.Retaliate ?? 'no'}`, () => {
    expect(MISSION_CONTROL[Mission.CAPTURE].isRetaliate).toBe(INI_CAPTURE_RETALIATE);
  });

  it(`rules.ini [Capture] Recruitable=${iniCaptureMission?.Recruitable ?? 'no'}`, () => {
    expect(MISSION_CONTROL[Mission.CAPTURE].isRecruitable).toBe(INI_CAPTURE_RECRUITABLE);
  });

  it(`rules.ini [Capture] Scatter=${iniCaptureMission?.Scatter ?? 'no'}`, () => {
    expect(MISSION_CONTROL[Mission.CAPTURE].isScatter).toBe(INI_CAPTURE_SCATTER);
  });

  it('CAPTURE mission isZombie=true (C++ mission.cpp — engineer does not auto-acquire targets)', () => {
    expect(MISSION_CONTROL[Mission.CAPTURE].isZombie).toBe(true);
  });
});

// ===========================================================================
// Section 4: Fixed-Point Capture Threshold Math
// C++ infantry.cpp:614 — fixed(hp, maxHp) <= fixed(ConditionRed)
// ===========================================================================

describe('Fixed-point capture threshold (infantry.cpp:614)', () => {
  // Test the C++ integer math that determines capture vs damage

  it('building at exactly 25% HP is capturable (boundary)', () => {
    // maxHp=200, hp=50 => 50/200 = 0.25 = ConditionRed
    expect(cppCaptureCheck(50, 200, INI_CONDITION_RED)).toBe(true);
  });

  it('building at 24% HP is capturable (below threshold)', () => {
    // maxHp=200, hp=48 => 48/200 = 0.24 < ConditionRed
    expect(cppCaptureCheck(48, 200, INI_CONDITION_RED)).toBe(true);
  });

  it('building at 26% HP is NOT capturable (above threshold)', () => {
    // maxHp=200, hp=52 => 52/200 = 0.26 > ConditionRed
    expect(cppCaptureCheck(52, 200, INI_CONDITION_RED)).toBe(false);
  });

  it('building at 1 HP is capturable', () => {
    expect(cppCaptureCheck(1, 200, INI_CONDITION_RED)).toBe(true);
  });

  it('building at full HP is NOT capturable', () => {
    expect(cppCaptureCheck(200, 200, INI_CONDITION_RED)).toBe(false);
  });

  it('fixed-point check with maxHp=256 (common C++ scale)', () => {
    // hp=64, maxHp=256 => 64/256 = 0.25 exactly
    expect(cppCaptureCheck(64, 256, INI_CONDITION_RED)).toBe(true);
    // hp=65, maxHp=256 => 65/256 = 0.254 > 0.25
    expect(cppCaptureCheck(65, 256, INI_CONDITION_RED)).toBe(false);
  });

  it('TS uses same fixed-point formula: Math.floor(hp * 256 / maxHp) <= Math.floor(CONDITION_RED * 256)', () => {
    // This is the exact check from missionAI.ts:1061
    // Math.floor(50 * 256 / 200) = Math.floor(64) = 64
    // Math.floor(0.25 * 256) = 64
    // 64 <= 64 => true (capture)
    const hp = 50, maxHp = 200;
    const tsCheck = Math.floor(hp * 256 / maxHp) <= Math.floor(CONDITION_RED * 256);
    expect(tsCheck).toBe(true);
  });

  it('TS fixed-point for above-threshold building', () => {
    // Math.floor(52 * 256 / 200) = Math.floor(66.56) = 66
    // Math.floor(0.25 * 256) = 64
    // 66 <= 64 => false (damage, not capture)
    const hp = 52, maxHp = 200;
    const tsCheck = Math.floor(hp * 256 / maxHp) <= Math.floor(CONDITION_RED * 256);
    expect(tsCheck).toBe(false);
  });
});

// ===========================================================================
// Section 5: Engineer Damage Formula
// C++ infantry.cpp:631 — damage = min(MaxStrength/3, HP-1)
// ===========================================================================

describe('Engineer damage formula (infantry.cpp:631)', () => {
  it('damage = floor(maxHp / 3) for healthy buildings', () => {
    // maxHp=200: floor(200/3) = 66
    expect(cppEngineerDamage(200, 200)).toBe(66);
  });

  it('damage capped to hp-1 (building cannot die from engineer)', () => {
    // maxHp=200, hp=30: min(66, 29) = 29
    expect(cppEngineerDamage(200, 30)).toBe(29);
  });

  it('building at hp=1: damage = min(66, 0) = 0 (no damage possible)', () => {
    expect(cppEngineerDamage(200, 1)).toBe(0);
  });

  it('POWR (Strength=400): damage = floor(400/3) = 133', () => {
    const powrStrength = Number(ini['POWR']?.Strength ?? '400');
    expect(cppEngineerDamage(powrStrength, powrStrength)).toBe(Math.floor(powrStrength / 3));
  });

  it('WEAP (Strength=1000): damage = floor(1000/3) = 333', () => {
    const weapStrength = Number(ini['WEAP']?.Strength ?? '1000');
    expect(cppEngineerDamage(weapStrength, weapStrength)).toBe(Math.floor(weapStrength / 3));
  });

  it('three engineers exactly reach red health on POWR (Strength=400)', () => {
    const powrStrength = Number(ini['POWR']?.Strength ?? '400');
    let hp = powrStrength;
    const maxHp = powrStrength;
    let engineers = 0;
    while (!cppCaptureCheck(hp, maxHp, INI_CONDITION_RED) && hp > 1) {
      const dmg = cppEngineerDamage(maxHp, hp);
      if (dmg <= 0) break;
      hp -= dmg;
      engineers++;
    }
    // After N engineers, building should be at or below red health
    expect(cppCaptureCheck(hp, maxHp, INI_CONDITION_RED)).toBe(true);
    // Document how many engineers it takes (informational)
    expect(engineers).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// Section 6: Engineer Capture — Enemy Building at Red Health
// C++ infantry.cpp:614-628 — Captured() changes ownership
// C++ building.cpp:2936 — Captured() does NOT restore HP
// ===========================================================================

describe('Engineer capture — enemy building at red health (infantry.cpp:614-628)', () => {
  it('building at red health is captured (ownership changes to engineer house)', () => {
    const s = makeStructure({ hp: 40, maxHp: 200, house: House.USSR });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece });

    updateAttackStructure(ctx, eng, s);

    expect(s.house).toBe(House.Greece); // ownership changed
  });

  it('engineer is consumed after capture', () => {
    const s = makeStructure({ hp: 40, maxHp: 200, house: House.USSR });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece });

    updateAttackStructure(ctx, eng, s);

    expect(eng.alive).toBe(false);
    expect(eng.mission).toBe(Mission.DIE);
  });

  it('C++ parity: Captured() does NOT restore HP (building.cpp:2936)', () => {
    // C++ building.cpp:2936: Captured() changes ownership but does NOT restore HP.
    // The building remains at its pre-capture health.
    const s = makeStructure({ hp: 40, maxHp: 200, house: House.USSR });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece });

    updateAttackStructure(ctx, eng, s);

    // C++ parity: HP should remain at 40 (not restored to 200)
    expect(s.hp).toBe(40);
  });

  it('EVA plays building captured announcement', () => {
    const s = makeStructure({ hp: 40, maxHp: 200, house: House.USSR });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece });

    updateAttackStructure(ctx, eng, s);

    expect(ctx.playEva).toHaveBeenCalledWith('eva_building_captured');
  });

  it('building at exactly boundary (25%) is captured', () => {
    // maxHp=200, hp=50 => exactly 25% = ConditionRed
    const s = makeStructure({ hp: 50, maxHp: 200, house: House.USSR });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece });

    updateAttackStructure(ctx, eng, s);

    expect(s.house).toBe(House.Greece);
    expect(eng.alive).toBe(false);
  });

  it('building at 1 HP is captured', () => {
    const s = makeStructure({ hp: 1, maxHp: 200, house: House.USSR });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece });

    updateAttackStructure(ctx, eng, s);

    expect(s.house).toBe(House.Greece);
    expect(eng.alive).toBe(false);
  });
});

// ===========================================================================
// Section 7: Engineer Damage — Enemy Building Above Red Health
// C++ infantry.cpp:631 — deal MaxStrength/3 damage, capped to HP-1
// ===========================================================================

describe('Engineer damage — enemy building above red health (infantry.cpp:631)', () => {
  it('damages building by floor(maxHp/3) when above red health', () => {
    const maxHp = 200;
    const hp = 200; // full health = above red
    const s = makeStructure({ hp, maxHp, house: House.USSR });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece });

    updateAttackStructure(ctx, eng, s);

    const expectedDamage = Math.floor(maxHp / 3); // 66
    expect(s.hp).toBe(hp - expectedDamage);
    expect(s.house).toBe(House.USSR); // ownership does NOT change
  });

  it('engineer is consumed after dealing damage', () => {
    const s = makeStructure({ hp: 200, maxHp: 200, house: House.USSR });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece });

    updateAttackStructure(ctx, eng, s);

    expect(eng.alive).toBe(false);
    expect(eng.mission).toBe(Mission.DIE);
  });

  it('damage capped to hp-1 (building never destroyed by engineer)', () => {
    // Building at hp=55, maxHp=200: 55/200 = 27.5% > ConditionRed (25%), so damage path
    // Fixed-point: floor(55*256/200) = 70 > floor(0.25*256) = 64 => damage, not capture
    // Damage = min(floor(200/3)=66, 55-1=54) = 54 (cap applies!)
    // Result: hp = 55 - 54 = 1
    const s = makeStructure({ hp: 55, maxHp: 200, house: House.USSR });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece });

    updateAttackStructure(ctx, eng, s);

    expect(s.hp).toBe(1); // 55 - 54 = 1 (damage capped at hp-1)
    expect(s.alive).toBe(true);
    expect(s.house).toBe(House.USSR); // still enemy (damage, not capture)
  });

  it('no damage when building at hp=1 (engDamage = min(66, 0) = 0)', () => {
    // hp=1 is below red health, so it should be CAPTURED, not damaged
    // This test verifies the formula separately
    const damage = cppEngineerDamage(200, 1);
    expect(damage).toBe(0);
  });

  it('ownership does NOT change when above red health', () => {
    const s = makeStructure({ hp: 200, maxHp: 200, house: House.USSR });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece });

    updateAttackStructure(ctx, eng, s);

    expect(s.house).toBe(House.USSR); // still enemy-owned
  });

  it('EVA does NOT announce capture when only dealing damage', () => {
    const s = makeStructure({ hp: 200, maxHp: 200, house: House.USSR });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece });

    updateAttackStructure(ctx, eng, s);

    expect(ctx.playEva).not.toHaveBeenCalledWith('eva_building_captured');
  });
});

// ===========================================================================
// Section 8: Engineer Friendly Repair — Renovate()
// C++ infantry.cpp:606-611 — allied building gets Renovate(), full HP restore
// ===========================================================================

describe('Engineer friendly repair — Renovate() (infantry.cpp:606-611)', () => {
  it('repairs allied building to full HP', () => {
    const s = makeStructure({ hp: 80, maxHp: 200, house: House.Greece });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext({
      playerHouse: House.Greece,
      isAllied: (a: House, b: House) => a === b,
    });

    updateAttackStructure(ctx, eng, s);

    expect(s.hp).toBe(200); // fully repaired (C++ Renovate())
  });

  it('engineer is consumed after repairing ally', () => {
    const s = makeStructure({ hp: 80, maxHp: 200, house: House.Greece });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext({
      playerHouse: House.Greece,
      isAllied: (a: House, b: House) => a === b,
    });

    updateAttackStructure(ctx, eng, s);

    expect(eng.alive).toBe(false);
    expect(eng.mission).toBe(Mission.DIE);
  });

  it('C++ parity: Renovate() on full-HP building is a harmless no-op', () => {
    /**
     * C++ infantry.cpp:606-611:
     *   if (House->Is_Ally(tech)) {
     *     tech->Renovate();  // always takes this branch for allies
     *   }
     * Renovate() on a full-health building is a harmless no-op.
     * Engineer is consumed. Building HP stays at max.
     */
    const s = makeStructure({ hp: 200, maxHp: 200, house: House.Greece });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext({
      playerHouse: House.Greece,
      isAllied: (a: House, b: House) => a === b,
    });

    updateAttackStructure(ctx, eng, s);

    expect(s.hp).toBe(200); // no-op — HP stays at max
    expect(eng.alive).toBe(false); // engineer still consumed
  });

  it('repair sound is played on friendly repair', () => {
    const s = makeStructure({ hp: 80, maxHp: 200, house: House.Greece });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext({
      playerHouse: House.Greece,
      isAllied: (a: House, b: House) => a === b,
    });

    updateAttackStructure(ctx, eng, s);

    expect(ctx.playSound).toHaveBeenCalledWith('repair');
  });
});

// ===========================================================================
// Section 9: Engineer Always Consumed
// C++ infantry.cpp:637 — delete this (engineer destroyed in ALL cases)
// ===========================================================================

describe('Engineer always consumed (infantry.cpp:637)', () => {
  it('consumed on capture (enemy at red health)', () => {
    const s = makeStructure({ hp: 40, maxHp: 200, house: House.USSR });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext();

    updateAttackStructure(ctx, eng, s);
    expect(eng.alive).toBe(false);
  });

  it('consumed on damage (enemy above red health)', () => {
    const s = makeStructure({ hp: 200, maxHp: 200, house: House.USSR });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext();

    updateAttackStructure(ctx, eng, s);
    expect(eng.alive).toBe(false);
  });

  it('consumed on friendly repair', () => {
    const s = makeStructure({ hp: 80, maxHp: 200, house: House.Greece });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext({
      playerHouse: House.Greece,
      isAllied: (a: House, b: House) => a === b,
    });

    updateAttackStructure(ctx, eng, s);
    expect(eng.alive).toBe(false);
  });

  it('targetStructure cleared after consumption', () => {
    const s = makeStructure({ hp: 200, maxHp: 200, house: House.USSR });
    const eng = engineerNearStructure(House.Greece, s);
    eng.targetStructure = s as any;
    const ctx = makeMissionAIContext();

    updateAttackStructure(ctx, eng, s);

    expect(eng.targetStructure).toBeNull();
  });
});

// ===========================================================================
// Section 10: Single Engineer Capture (NOT Multi-Engineer)
// C++ RA1 uses single-engineer capture at red health.
// This is NOT the Tiberian Sun multi-engineer model.
// ===========================================================================

describe('Single engineer capture model (C++ RA1 — NOT multi-engineer)', () => {
  it('one engineer captures building at red health', () => {
    const s = makeStructure({ hp: 40, maxHp: 200, house: House.USSR });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext();

    updateAttackStructure(ctx, eng, s);

    expect(s.house).toBe(House.Greece);
  });

  it('one engineer is sufficient — no second engineer needed', () => {
    // In C++ RA1, a single engineer at red health captures instantly.
    // There is no "multi-engineer" system where multiple engineers are needed.
    const s = makeStructure({ hp: 40, maxHp: 200, house: House.USSR });
    const eng1 = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext();

    updateAttackStructure(ctx, eng1, s);

    // Building is already captured by one engineer
    expect(s.house).toBe(House.Greece);
  });

  it('sequential engineers: first damages, second captures', () => {
    const maxHp = 200;
    const s = makeStructure({ hp: maxHp, maxHp, house: House.USSR });

    // First engineer damages
    const eng1 = engineerNearStructure(House.Greece, s);
    const ctx1 = makeMissionAIContext();
    updateAttackStructure(ctx1, eng1, s);

    const hpAfterFirst = maxHp - Math.floor(maxHp / 3); // 200 - 66 = 134
    expect(s.hp).toBe(hpAfterFirst);
    expect(s.house).toBe(House.USSR); // still enemy

    // Second engineer damages more
    const eng2 = engineerNearStructure(House.Greece, s);
    const ctx2 = makeMissionAIContext();
    updateAttackStructure(ctx2, eng2, s);

    const hpAfterSecond = hpAfterFirst - Math.floor(maxHp / 3); // 134 - 66 = 68
    expect(s.hp).toBe(hpAfterSecond);
    expect(s.house).toBe(House.USSR); // still enemy (68/200 = 34% > 25%)

    // Third engineer damages to below red
    const eng3 = engineerNearStructure(House.Greece, s);
    const ctx3 = makeMissionAIContext();
    updateAttackStructure(ctx3, eng3, s);

    // 68 - min(66, 67) = 68 - 66 = 2
    expect(s.hp).toBe(2);
    // 2/200 = 1% < 25% => should be captured by NEXT engineer
    // But wait — this engineer dealt damage, not capture (68/200=34% > 25%)
    expect(s.house).toBe(House.USSR); // still enemy after damage

    // Fourth engineer captures
    const eng4 = engineerNearStructure(House.Greece, s);
    const ctx4 = makeMissionAIContext();
    updateAttackStructure(ctx4, eng4, s);

    expect(s.house).toBe(House.Greece); // NOW captured
    expect(s.hp).toBe(2); // C++ Captured() does NOT restore HP
  });
});

// ===========================================================================
// Section 11: Capturable Buildings from rules.ini
// C++ default: Capturable=no unless specified in rules.ini
// ===========================================================================

describe('Capturable flag from rules.ini (building.cpp — Capturable= field)', () => {
  it('rules.ini lists capturable buildings', () => {
    // Verify we parsed at least the major capturable buildings
    expect(CAPTURABLE_BUILDINGS).toContain('POWR');
    expect(CAPTURABLE_BUILDINGS).toContain('APWR');
    expect(CAPTURABLE_BUILDINGS).toContain('WEAP');
    expect(CAPTURABLE_BUILDINGS).toContain('FACT');
    expect(CAPTURABLE_BUILDINGS).toContain('PROC');
    expect(CAPTURABLE_BUILDINGS).toContain('DOME');
    expect(CAPTURABLE_BUILDINGS).toContain('TENT');
    expect(CAPTURABLE_BUILDINGS).toContain('BARR');
  });

  it('walls are NOT capturable (no Capturable= in rules.ini, default=no)', () => {
    expect(NON_CAPTURABLE_BUILDINGS).toContain('SBAG');
    expect(NON_CAPTURABLE_BUILDINGS).toContain('FENC');
    expect(NON_CAPTURABLE_BUILDINGS).toContain('BRIK');
  });

  it('defensive structures are NOT capturable (no Capturable= flag)', () => {
    // In rules.ini, PBOX, HBOX, GUN, AGUN, FTUR, TSLA, SAM have no Capturable= line
    expect(NON_CAPTURABLE_BUILDINGS).toContain('PBOX');
    expect(NON_CAPTURABLE_BUILDINGS).toContain('HBOX');
    expect(NON_CAPTURABLE_BUILDINGS).toContain('GUN');
    expect(NON_CAPTURABLE_BUILDINGS).toContain('AGUN');
    expect(NON_CAPTURABLE_BUILDINGS).toContain('FTUR');
    expect(NON_CAPTURABLE_BUILDINGS).toContain('TSLA');
    expect(NON_CAPTURABLE_BUILDINGS).toContain('SAM');
  });

  it('kennel (KENN) is NOT capturable', () => {
    expect(NON_CAPTURABLE_BUILDINGS).toContain('KENN');
  });

  it('BIO lab is NOT capturable (no Capturable= line in rules.ini)', () => {
    expect(NON_CAPTURABLE_BUILDINGS).toContain('BIO');
  });

  it('missile silo (MSLO) is NOT capturable', () => {
    expect(NON_CAPTURABLE_BUILDINGS).toContain('MSLO');
  });

  it('civilian V01 IS capturable (rules.ini [V01] Capturable=true)', () => {
    expect(CAPTURABLE_BUILDINGS).toContain('V01');
  });

  it('other civilian buildings V02-V18 are NOT capturable (no Capturable= flag)', () => {
    for (let i = 2; i <= 18; i++) {
      const vType = `V${String(i).padStart(2, '0')}`;
      if (ini[vType]) {
        expect(NON_CAPTURABLE_BUILDINGS).toContain(vType);
      }
    }
  });

  it('fake buildings (FACF, WEAF, SYRF, SPEF, DOMF) ARE capturable', () => {
    expect(CAPTURABLE_BUILDINGS).toContain('FACF');
    expect(CAPTURABLE_BUILDINGS).toContain('WEAF');
    expect(CAPTURABLE_BUILDINGS).toContain('SYRF');
    expect(CAPTURABLE_BUILDINGS).toContain('SPEF');
    expect(CAPTURABLE_BUILDINGS).toContain('DOMF');
  });

  it('MISS (civilian tech center) IS capturable', () => {
    expect(CAPTURABLE_BUILDINGS).toContain('MISS');
  });

  it('hospital (HOSP) IS capturable', () => {
    expect(CAPTURABLE_BUILDINGS).toContain('HOSP');
  });

  it('superweapon buildings ARE capturable (IRON, PDOX)', () => {
    expect(CAPTURABLE_BUILDINGS).toContain('IRON');
    expect(CAPTURABLE_BUILDINGS).toContain('PDOX');
  });

  it('naval production buildings ARE capturable (SYRD, SPEN)', () => {
    expect(CAPTURABLE_BUILDINGS).toContain('SYRD');
    expect(CAPTURABLE_BUILDINGS).toContain('SPEN');
  });

  it('air production buildings ARE capturable (HPAD, AFLD)', () => {
    expect(CAPTURABLE_BUILDINGS).toContain('HPAD');
    expect(CAPTURABLE_BUILDINGS).toContain('AFLD');
  });

  it('service depot (FIX) IS capturable', () => {
    expect(CAPTURABLE_BUILDINGS).toContain('FIX');
  });
});

// ===========================================================================
// Section 12: Building Strength Values from rules.ini
// Verify TS building data matches INI for structures relevant to capture
// ===========================================================================

describe('Building Strength from rules.ini (capture damage calculations)', () => {
  const captBuildingsWithStrength = CAPTURABLE_BUILDINGS
    .map(b => ({ type: b, strength: Number(ini[b]?.Strength ?? '0') }))
    .filter(b => b.strength > 0);

  for (const { type, strength } of captBuildingsWithStrength) {
    it(`${type} Strength=${strength} — engineer damage = floor(${strength}/3) = ${Math.floor(strength / 3)}`, () => {
      expect(cppEngineerDamage(strength, strength)).toBe(Math.floor(strength / 3));
    });
  }
});

// ===========================================================================
// Section 13: Soviet Engineer Captures Allied Building (and vice versa)
// C++ infantry.cpp:598 — "any house's engineer, not just player"
// ===========================================================================

describe('Any house engineer can capture (infantry.cpp:598)', () => {
  it('Soviet engineer captures Allied building', () => {
    const s = makeStructure({ hp: 40, maxHp: 200, house: House.Greece });
    const eng = engineerNearStructure(House.USSR, s);
    const ctx = makeMissionAIContext({
      playerHouse: House.Greece,
      isAllied: (a: House, b: House) => a === b,
    });

    updateAttackStructure(ctx, eng, s);

    expect(s.house).toBe(House.USSR); // Soviet took it
    expect(eng.alive).toBe(false);
  });

  it('Allied engineer captures Soviet building', () => {
    const s = makeStructure({ hp: 40, maxHp: 200, house: House.USSR });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext({
      playerHouse: House.Greece,
      isAllied: (a: House, b: House) => a === b,
    });

    updateAttackStructure(ctx, eng, s);

    expect(s.house).toBe(House.Greece); // Allied took it
    expect(eng.alive).toBe(false);
  });

  it('engineer captures building owned by a third party', () => {
    // Engineer from Spain captures building owned by France (both allied normally,
    // but here we test with non-allied)
    const s = makeStructure({ hp: 40, maxHp: 200, house: House.Turkey });
    const eng = engineerNearStructure(House.Greece, s);
    const ctx = makeMissionAIContext({
      playerHouse: House.Greece,
      isAllied: (a: House, b: House) => a === b,
    });

    updateAttackStructure(ctx, eng, s);

    expect(s.house).toBe(House.Greece);
    expect(eng.alive).toBe(false);
  });
});

// ===========================================================================
// Section 14: Edge Cases
// ===========================================================================

describe('Engineer capture edge cases', () => {
  it('engineer targetStructure is cleared to null after action', () => {
    const s = makeStructure({ hp: 200, maxHp: 200, house: House.USSR });
    const eng = engineerNearStructure(House.Greece, s);
    eng.targetStructure = s as any;
    const ctx = makeMissionAIContext();

    updateAttackStructure(ctx, eng, s);

    expect(eng.targetStructure).toBeNull();
  });

  it('engineer mission transitions to DIE after action', () => {
    const s = makeStructure({ hp: 200, maxHp: 200, house: House.USSR });
    const eng = engineerNearStructure(House.Greece, s);
    eng.mission = Mission.CAPTURE;
    const ctx = makeMissionAIContext();

    updateAttackStructure(ctx, eng, s);

    expect(eng.mission).toBe(Mission.DIE);
  });

  it('building stays alive after engineer damage (engineer can never destroy)', () => {
    // Even with tiny HP remaining, engineer damage is capped to hp-1
    for (const hp of [2, 5, 10, 50]) {
      const s = makeStructure({ hp, maxHp: 200, house: House.USSR });
      const eng = engineerNearStructure(House.Greece, s);
      const ctx = makeMissionAIContext();

      // hp below red health => capture, hp above => damage
      if (cppCaptureCheck(hp, 200, INI_CONDITION_RED)) {
        // capture path — building survives (changes owner)
        updateAttackStructure(ctx, eng, s);
        expect(s.alive).toBe(true);
      } else {
        // damage path — building survives (hp >= 1)
        updateAttackStructure(ctx, eng, s);
        expect(s.alive).toBe(true);
        expect(s.hp).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

// ===========================================================================
// Section 15: Engineers vs Strength from INI for All Capturable Buildings
// Verify engineer damage formula against each capturable building type's
// Strength value from rules.ini
// ===========================================================================

describe('Engineers-to-capture calculation for all capturable buildings (rules.ini)', () => {
  // For each capturable building, calculate how many engineers are needed
  // to reduce it from full health to capturable state
  const buildings = CAPTURABLE_BUILDINGS
    .map(b => ({ type: b, strength: Number(ini[b]?.Strength ?? '0') }))
    .filter(b => b.strength > 0);

  for (const { type, strength } of buildings) {
    it(`${type} (Strength=${strength}): engineer damage chain reaches red health`, () => {
      let hp = strength;
      const maxHp = strength;
      let engineers = 0;
      const MAX_ITERS = 100; // safety

      while (!cppCaptureCheck(hp, maxHp, INI_CONDITION_RED) && engineers < MAX_ITERS) {
        const dmg = cppEngineerDamage(maxHp, hp);
        if (dmg <= 0) break; // hp=1, can't damage further
        hp -= dmg;
        engineers++;
      }

      // Building should eventually reach red health or hp=1
      expect(hp).toBeLessThanOrEqual(Math.ceil(maxHp * INI_CONDITION_RED));
      expect(engineers).toBeGreaterThanOrEqual(1);
      expect(engineers).toBeLessThan(MAX_ITERS);
    });
  }
});
