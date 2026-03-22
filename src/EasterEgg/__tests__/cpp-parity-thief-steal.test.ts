/**
 * C++ Behavioral Parity: Thief (THF) Credit Stealing Mechanics
 *
 * Tests verify that updateThief() matches C++ RA source code behavior.
 * All INI-derived expected values are parsed from rules.ini at test time.
 *
 * C++ algorithm (infantry.cpp:675-706):
 *   1. Thief enters building via MISSION_CAPTURE (same path as spy/engineer)
 *   2. if (*this == INFANTRY_THIEF):
 *        tech->House->IsThieved = true  — ALWAYS, regardless of building type (line 676)
 *   3. if (tech->What_Am_I() == RTTI_BUILDING):
 *        BuildingClass* bldg = (BuildingClass*)tech
 *        if (bldg->Class->Capacity):  — i.e. Storage > 0 in rules.ini  (line 680)
 *          long cash = bldg->House->Available_Money() / 2              (line 696)
 *          bldg->House->Spend_Money(cash)                              (line 698)
 *          House->Refund_Money(cash)                                   (line 699)
 *   4. delete this  — thief consumed in ALL cases                       (line 706)
 *
 * C++ Available_Money() (house.cpp:1861-1866):
 *   return (Tiberium + Credits);  — total house money, NOT per-building
 *
 * C++ Spend_Money() (house.cpp:1886-1900):
 *   Spends from Tiberium first, then Credits.
 *
 * C++ Refund_Money() (house.cpp:1921-1926):
 *   Credits += money;  — always adds to Credits
 *
 * C++ key behaviors:
 *   - Thief can enter ANY building (via Infiltrate=yes), not just storage
 *   - IsThieved is set BEFORE the Capacity check (line 676)
 *   - Steal amount = Available_Money() / 2 (integer division, total house money)
 *   - Thief is ALWAYS consumed after entering (delete this, line 706)
 *   - Only buildings with Storage > 0 (Capacity) result in credit theft
 *   - In rules.ini, only PROC (Storage=2000) and SILO (Storage=1500) have Storage
 *
 * C++ references:
 *   infantry.cpp:675-706  — Thief steal logic
 *   house.cpp:1861-1866   — Available_Money() = Tiberium + Credits
 *   house.cpp:1886-1900   — Spend_Money() drains Tiberium first
 *   house.cpp:1921-1926   — Refund_Money() adds to Credits
 *   bdata.cpp:3771        — Capacity = ini.Get_Int(Name(), "Storage", Capacity)
 *   idata.cpp:509-527     — THF infantry type definition
 *   rules.ini [THF]       — Strength=25, Speed=4, Cost=500, Infiltrate=yes
 *   rules.ini [PROC]      — Storage=2000
 *   rules.ini [SILO]      — Storage=1500
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Entity, resetEntityIds, setPlayerHouses } from '../engine/entity';
import {
  House, Mission, UnitType, CELL_SIZE, AnimState,
  UNIT_STATS,
} from '../engine/types';
import {
  updateThief,
  type SpecialUnitsContext,
} from '../engine/specialUnits';
import { type MapStructure, STRUCTURE_SIZE } from '../engine/scenario';
import { type GameMap } from '../engine/map';

// Use Spain (Allied player) vs USSR (Soviet enemy) — proper House enum values
const PLAYER_HOUSE = House.Spain;
const ENEMY_HOUSE = House.USSR;

beforeEach(() => {
  resetEntityIds();
  setPlayerHouses(new Set([PLAYER_HOUSE]));
});

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

// ---------------------------------------------------------------------------
// INI-parsed expected values (rules.ini is God)
// ---------------------------------------------------------------------------

const iniTHF = ini['THF'];
const iniPROC = ini['PROC'];
const iniSILO = ini['SILO'];

// THF stats from rules.ini [THF]
const INI_THF_STRENGTH = Number(iniTHF?.Strength ?? '25');
const INI_THF_SPEED = Number(iniTHF?.Speed ?? '4');
const INI_THF_COST = Number(iniTHF?.Cost ?? '500');
const INI_THF_SIGHT = Number(iniTHF?.Sight ?? '5');
const INI_THF_POINTS = Number(iniTHF?.Points ?? '10');
const INI_THF_INFILTRATE = (iniTHF?.Infiltrate ?? 'no').toLowerCase() === 'yes';
const INI_THF_OWNER = iniTHF?.Owner ?? 'allies';

// Storage values from rules.ini — buildings with Storage > 0 are valid thief targets
const INI_PROC_STORAGE = Number(iniPROC?.Storage ?? '0');
const INI_SILO_STORAGE = Number(iniSILO?.Storage ?? '0');

// All building sections — find which have Storage > 0
const BUILDING_SECTIONS = [
  'IRON', 'FCOM', 'ATEK', 'PDOX', 'WEAP', 'SYRD', 'SPEN', 'FACT',
  'PROC', 'SILO', 'HPAD', 'DOME', 'GAP', 'AFLD', 'POWR', 'APWR',
  'STEK', 'HOSP', 'BARR', 'TENT', 'FIX', 'MISS', 'KENN', 'BIO',
  'PBOX', 'HBOX', 'GUN', 'AGUN', 'FTUR', 'TSLA', 'SAM', 'MSLO',
];

const STORAGE_BUILDINGS: string[] = [];
const NON_STORAGE_BUILDINGS: string[] = [];
for (const section of BUILDING_SECTIONS) {
  const storage = Number(ini[section]?.Storage ?? '0');
  if (storage > 0) {
    STORAGE_BUILDINGS.push(section);
  } else {
    NON_STORAGE_BUILDINGS.push(section);
  }
}

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeThief(house: House): Entity {
  const e = new Entity(UnitType.I_THF, house);
  e.alive = true;
  e.mission = Mission.CAPTURE;
  e.animState = AnimState.IDLE;
  e.pos = { x: CELL_SIZE / 2, y: CELL_SIZE / 2 }; // center of cell 0,0
  return e;
}

function makeStructure(type: string, house: House, cx = 0, cy = 0): MapStructure {
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: 256,
    maxHp: 256,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
  };
}

function makeContext(overrides: Partial<SpecialUnitsContext> = {}): SpecialUnitsContext {
  return {
    entities: [],
    entityById: new Map(),
    structures: [],
    mines: [],
    activeVortices: [],
    effects: [],
    tick: 100,
    playerHouse: PLAYER_HOUSE,
    credits: 0,
    houseCredits: new Map(),
    map: {} as GameMap,
    evaMessages: [],
    isThieved: false,
    isAllied: (a, b) => a === b,
    entitiesAllied: (a, b) => a.house === b.house,
    isPlayerControlled: (e) => e.house === PLAYER_HOUSE,
    playSoundAt: vi.fn(),
    playSound: vi.fn(),
    movementSpeed: () => 1,
    damageEntity: vi.fn(() => true),
    damageStructure: vi.fn(() => true),
    addEntity: vi.fn(),
    screenShake: 0,
    ...overrides,
  };
}

/** Place thief adjacent to structure center so dist <= 1.5 (within steal range) */
function placeThiefAtStructure(thief: Entity, structure: MapStructure): void {
  const [sw, sh] = STRUCTURE_SIZE[structure.type] ?? [2, 2];
  const scx = structure.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
  const scy = structure.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
  thief.pos = { x: scx, y: scy };
}

// =============================================================================
//  1. THF unit stats — rules.ini parity
// =============================================================================

describe('THF unit stats — rules.ini parity', () => {
  const tsStats = UNIT_STATS['THF'];

  it('rules.ini [THF] has Infiltrate=yes', () => {
    expect(INI_THF_INFILTRATE).toBe(true);
  });

  it('TS THF strength matches rules.ini Strength', () => {
    expect(tsStats.strength).toBe(INI_THF_STRENGTH);
  });

  it('TS THF speed matches rules.ini Speed', () => {
    expect(tsStats.speed).toBe(INI_THF_SPEED);
  });

  it('TS THF cost matches rules.ini Cost', () => {
    expect(tsStats.cost).toBe(INI_THF_COST);
  });

  it('TS THF sight matches rules.ini Sight', () => {
    expect(tsStats.sight).toBe(INI_THF_SIGHT);
  });

  it('TS THF points matches rules.ini Points', () => {
    expect(tsStats.points).toBe(INI_THF_POINTS);
  });

  it('TS THF isInfiltrate matches rules.ini Infiltrate=yes', () => {
    expect(tsStats.isInfiltrate).toBe(INI_THF_INFILTRATE);
  });

  it('TS THF owner matches rules.ini Owner', () => {
    // rules.ini Owner=allies → TS owner='allied'
    const iniOwner = INI_THF_OWNER.toLowerCase();
    if (iniOwner === 'allies') {
      expect(tsStats.owner).toBe('allied');
    } else {
      expect(tsStats.owner).toBe(iniOwner);
    }
  });

  it('TS THF has no weapon (C++ THF has no Primary/Secondary in rules.ini)', () => {
    expect(tsStats.primaryWeapon).toBeNull();
    expect(tsStats.secondaryWeapon).toBeNull();
  });

  it('TS THF type enum is I_THF', () => {
    expect(tsStats.type).toBe(UnitType.I_THF);
  });
});

// =============================================================================
//  2. Storage buildings — rules.ini parity
// =============================================================================

describe('Storage buildings — rules.ini parity', () => {
  it('only PROC and SILO have Storage > 0 in rules.ini', () => {
    expect(STORAGE_BUILDINGS).toEqual(['PROC', 'SILO']);
  });

  it('PROC Storage=2000 in rules.ini', () => {
    expect(INI_PROC_STORAGE).toBe(2000);
  });

  it('SILO Storage=1500 in rules.ini', () => {
    expect(INI_SILO_STORAGE).toBe(1500);
  });
});

// =============================================================================
//  3. Thief steal mechanics — C++ behavioral parity
// =============================================================================

describe('Thief steal mechanics — C++ behavioral parity', () => {

  // -----------------------------------------------------------------------
  //  3a. Steal from PROC — 50% of total house money
  //  C++ infantry.cpp:696: cash = bldg->House->Available_Money() / 2
  // -----------------------------------------------------------------------

  it('steals 50% of enemy credits from PROC (C++ Available_Money()/2)', () => {
    const thief = makeThief(PLAYER_HOUSE);
    const proc = makeStructure('PROC', ENEMY_HOUSE, 2, 2);
    thief.targetStructure = proc;
    placeThiefAtStructure(thief, proc);

    const ctx = makeContext({
      houseCredits: new Map([[ENEMY_HOUSE, 1000]]),
      credits: 0,
    });

    updateThief(ctx, thief);

    // C++ steals Available_Money()/2 = 1000/2 = 500
    expect(ctx.houseCredits.get(ENEMY_HOUSE)).toBe(500);
    expect(ctx.credits).toBe(500);
  });

  it('steals 50% from SILO', () => {
    const thief = makeThief(PLAYER_HOUSE);
    const silo = makeStructure('SILO', ENEMY_HOUSE, 2, 2);
    thief.targetStructure = silo;
    placeThiefAtStructure(thief, silo);

    const ctx = makeContext({
      houseCredits: new Map([[ENEMY_HOUSE, 2000]]),
      credits: 0,
    });

    updateThief(ctx, thief);

    expect(ctx.houseCredits.get(ENEMY_HOUSE)).toBe(1000);
    expect(ctx.credits).toBe(1000);
  });

  it('steal amount uses integer division (C++ long / 2)', () => {
    const thief = makeThief(PLAYER_HOUSE);
    const proc = makeStructure('PROC', ENEMY_HOUSE, 2, 2);
    thief.targetStructure = proc;
    placeThiefAtStructure(thief, proc);

    // Odd amount: 999 / 2 = 499 (integer division)
    const ctx = makeContext({
      houseCredits: new Map([[ENEMY_HOUSE, 999]]),
      credits: 0,
    });

    updateThief(ctx, thief);

    // C++ integer division: 999 / 2 = 499
    expect(ctx.houseCredits.get(ENEMY_HOUSE)).toBe(999 - 499);
    expect(ctx.credits).toBe(499);
  });

  it('steals 0 when enemy has 0 credits', () => {
    const thief = makeThief(PLAYER_HOUSE);
    const proc = makeStructure('PROC', ENEMY_HOUSE, 2, 2);
    thief.targetStructure = proc;
    placeThiefAtStructure(thief, proc);

    const ctx = makeContext({
      houseCredits: new Map([[ENEMY_HOUSE, 0]]),
      credits: 0,
    });

    updateThief(ctx, thief);

    expect(ctx.houseCredits.get(ENEMY_HOUSE)).toBe(0);
    expect(ctx.credits).toBe(0);
  });

  it('steals 0 when enemy has 1 credit (C++ 1/2=0 integer division)', () => {
    const thief = makeThief(PLAYER_HOUSE);
    const proc = makeStructure('PROC', ENEMY_HOUSE, 2, 2);
    thief.targetStructure = proc;
    placeThiefAtStructure(thief, proc);

    const ctx = makeContext({
      houseCredits: new Map([[ENEMY_HOUSE, 1]]),
      credits: 0,
    });

    updateThief(ctx, thief);

    // C++ integer division: 1 / 2 = 0
    expect(ctx.houseCredits.get(ENEMY_HOUSE)).toBe(1);
    expect(ctx.credits).toBe(0);
  });

  // -----------------------------------------------------------------------
  //  3b. Thief consumed after stealing
  //  C++ infantry.cpp:706: delete this
  // -----------------------------------------------------------------------

  it('thief is consumed (dies) after stealing from PROC (C++ delete this, line 706)', () => {
    const thief = makeThief(PLAYER_HOUSE);
    const proc = makeStructure('PROC', ENEMY_HOUSE, 2, 2);
    thief.targetStructure = proc;
    placeThiefAtStructure(thief, proc);

    const ctx = makeContext({
      houseCredits: new Map([[ENEMY_HOUSE, 1000]]),
    });

    updateThief(ctx, thief);

    expect(thief.alive).toBe(false);
    expect(thief.mission).toBe(Mission.DIE);
  });

  it('thief is consumed (dies) after stealing from SILO', () => {
    const thief = makeThief(PLAYER_HOUSE);
    const silo = makeStructure('SILO', ENEMY_HOUSE, 2, 2);
    thief.targetStructure = silo;
    placeThiefAtStructure(thief, silo);

    const ctx = makeContext({
      houseCredits: new Map([[ENEMY_HOUSE, 500]]),
    });

    updateThief(ctx, thief);

    expect(thief.alive).toBe(false);
  });

  // -----------------------------------------------------------------------
  //  3c. IsThieved flag
  //  C++ infantry.cpp:676: tech->House->IsThieved = true
  //  Set UNCONDITIONALLY before Capacity check
  // -----------------------------------------------------------------------

  it('IsThieved is set to true after stealing from PROC', () => {
    const thief = makeThief(PLAYER_HOUSE);
    const proc = makeStructure('PROC', ENEMY_HOUSE, 2, 2);
    thief.targetStructure = proc;
    placeThiefAtStructure(thief, proc);

    const ctx = makeContext({
      houseCredits: new Map([[ENEMY_HOUSE, 1000]]),
    });

    expect(ctx.isThieved).toBe(false);
    updateThief(ctx, thief);
    expect(ctx.isThieved).toBe(true);
  });

  it('IsThieved is set even when enemy has 0 credits (C++ line 676 is before Capacity steal)', () => {
    const thief = makeThief(PLAYER_HOUSE);
    const proc = makeStructure('PROC', ENEMY_HOUSE, 2, 2);
    thief.targetStructure = proc;
    placeThiefAtStructure(thief, proc);

    const ctx = makeContext({
      houseCredits: new Map([[ENEMY_HOUSE, 0]]),
    });

    updateThief(ctx, thief);

    // C++ sets IsThieved before checking Capacity, so even 0 credits → IsThieved
    expect(ctx.isThieved).toBe(true);
  });

  // -----------------------------------------------------------------------
  //  3d. MISMATCH: Thief entering non-storage building
  //  C++ infantry.cpp:676: IsThieved = true (ALWAYS on thief enter)
  //  C++ infantry.cpp:680: if (Capacity) — only steals if storage
  //  C++ infantry.cpp:706: delete this — consumed regardless
  //  TS: rejects non-PROC/SILO, thief returns to GUARD, NOT consumed
  // -----------------------------------------------------------------------

  it('[MISMATCH] C++ sets IsThieved on ANY building (line 676), TS only on PROC/SILO', () => {
    const thief = makeThief(PLAYER_HOUSE);
    // WEAP has no Storage in rules.ini
    const weap = makeStructure('WEAP', ENEMY_HOUSE, 2, 2);
    thief.targetStructure = weap;
    placeThiefAtStructure(thief, weap);

    const ctx = makeContext({
      houseCredits: new Map([[ENEMY_HOUSE, 1000]]),
    });

    updateThief(ctx, thief);

    // C++ expected: IsThieved = true (set on line 676 before Capacity check)
    // C++ expected: thief consumed (delete this, line 706)
    // C++ expected: no credits stolen (WEAP has Capacity=0)
    //
    // TS actual: thief redirected to GUARD, NOT consumed, IsThieved NOT set
    // This is a known parity gap.
    //
    // Test documents the TS behavior:
    expect(ctx.isThieved).toBe(false);  // TS: false (C++ would be true)
    expect(thief.alive).toBe(true);      // TS: alive (C++ would be deleted)
    expect(thief.mission).toBe(Mission.GUARD); // TS: redirected (C++ would be dead)
  });

  it('[MISMATCH] C++ thief consumed on non-storage building, TS thief survives', () => {
    const thief = makeThief(PLAYER_HOUSE);
    const powr = makeStructure('POWR', ENEMY_HOUSE, 2, 2);
    thief.targetStructure = powr;
    placeThiefAtStructure(thief, powr);

    const ctx = makeContext({
      houseCredits: new Map([[ENEMY_HOUSE, 500]]),
    });

    updateThief(ctx, thief);

    // C++ deletes thief on ANY building entry (line 706)
    // TS keeps thief alive on non-PROC/SILO
    expect(thief.alive).toBe(true);  // TS: alive (C++ parity would be false)
    expect(ctx.houseCredits.get(ENEMY_HOUSE)).toBe(500); // no credits stolen (correct)
  });

  // -----------------------------------------------------------------------
  //  3e. Allied buildings — no theft
  //  C++ infantry.cpp:640-672: allied building → spy path (not thief path)
  //  The broader MISSION_CAPTURE flow splits on spy vs thief vs engineer.
  //  C++ thief path (line 673-702) is only reached for enemy buildings.
  // -----------------------------------------------------------------------

  it('thief does not steal from allied PROC', () => {
    const thief = makeThief(PLAYER_HOUSE);
    const proc = makeStructure('PROC', PLAYER_HOUSE, 2, 2);
    thief.targetStructure = proc;
    placeThiefAtStructure(thief, proc);

    const ctx = makeContext({
      houseCredits: new Map([[PLAYER_HOUSE, 1000]]),
      credits: 500,
    });

    updateThief(ctx, thief);

    // Should not steal from own building
    expect(ctx.credits).toBe(500); // unchanged
    expect(ctx.isThieved).toBe(false);
  });

  // -----------------------------------------------------------------------
  //  3f. Non-player thief steals into houseCredits (not player credits)
  //  C++ House->Refund_Money(cash) — adds to the thief's house
  // -----------------------------------------------------------------------

  it('AI thief steals into houseCredits, not player credits', () => {
    // ENEMY_HOUSE is NOT in playerHouses, so thief.isPlayerUnit is false
    const thief = makeThief(ENEMY_HOUSE);
    const proc = makeStructure('PROC', PLAYER_HOUSE, 2, 2);
    thief.targetStructure = proc;
    placeThiefAtStructure(thief, proc);

    const ctx = makeContext({
      houseCredits: new Map([[PLAYER_HOUSE, 2000], [ENEMY_HOUSE, 100]]),
      credits: 2000, // player credits
      playerHouse: PLAYER_HOUSE,
      isAllied: (a, b) => a === b,
    });

    updateThief(ctx, thief);

    // Enemy thief steals from PLAYER house via houseCredits
    expect(ctx.houseCredits.get(PLAYER_HOUSE)).toBe(1000); // 2000 - 1000
    expect(ctx.houseCredits.get(ENEMY_HOUSE)).toBe(1100);   // 100 + 1000
    // Player ctx.credits should not change — AI thief adds to houseCredits
    expect(ctx.credits).toBe(2000); // unchanged
  });

  // -----------------------------------------------------------------------
  //  3g. EVA message on steal
  //  C++ infantry.cpp:687: Speak(VOX_MONEY_STOLEN) when player involved
  // -----------------------------------------------------------------------

  it('EVA message is generated when credits are stolen', () => {
    const thief = makeThief(PLAYER_HOUSE);
    const proc = makeStructure('PROC', ENEMY_HOUSE, 2, 2);
    thief.targetStructure = proc;
    placeThiefAtStructure(thief, proc);

    const ctx = makeContext({
      houseCredits: new Map([[ENEMY_HOUSE, 1000]]),
      credits: 0,
    });

    updateThief(ctx, thief);

    expect(ctx.evaMessages.length).toBe(1);
    expect(ctx.evaMessages[0].text).toContain('500');
  });

  it('no EVA message when 0 credits stolen', () => {
    const thief = makeThief(PLAYER_HOUSE);
    const proc = makeStructure('PROC', ENEMY_HOUSE, 2, 2);
    thief.targetStructure = proc;
    placeThiefAtStructure(thief, proc);

    const ctx = makeContext({
      houseCredits: new Map([[ENEMY_HOUSE, 0]]),
      credits: 0,
    });

    updateThief(ctx, thief);

    // When stolen=0, no EVA message
    expect(ctx.evaMessages.length).toBe(0);
  });

  // -----------------------------------------------------------------------
  //  3h. Thief out of range — should move toward, not steal
  // -----------------------------------------------------------------------

  it('thief out of range moves toward structure, does not steal', () => {
    const thief = makeThief(PLAYER_HOUSE);
    const proc = makeStructure('PROC', ENEMY_HOUSE, 10, 10); // far away
    thief.targetStructure = proc;
    thief.pos = { x: CELL_SIZE / 2, y: CELL_SIZE / 2 }; // at 0,0

    const ctx = makeContext({
      houseCredits: new Map([[ENEMY_HOUSE, 1000]]),
      credits: 0,
    });

    updateThief(ctx, thief);

    // Should not have stolen yet
    expect(ctx.houseCredits.get(ENEMY_HOUSE)).toBe(1000);
    expect(ctx.credits).toBe(0);
    expect(thief.alive).toBe(true);
    expect(ctx.isThieved).toBe(false);
    expect(thief.animState).toBe(AnimState.WALK);
  });

  // -----------------------------------------------------------------------
  //  3i. Dead thief — no-op
  // -----------------------------------------------------------------------

  it('dead thief does nothing', () => {
    const thief = makeThief(PLAYER_HOUSE);
    thief.alive = false;
    const proc = makeStructure('PROC', ENEMY_HOUSE, 2, 2);
    thief.targetStructure = proc;
    placeThiefAtStructure(thief, proc);

    const ctx = makeContext({
      houseCredits: new Map([[ENEMY_HOUSE, 1000]]),
      credits: 0,
    });

    updateThief(ctx, thief);

    expect(ctx.houseCredits.get(ENEMY_HOUSE)).toBe(1000);
    expect(ctx.isThieved).toBe(false);
  });

  // -----------------------------------------------------------------------
  //  3j. Non-thief unit — updateThief is a no-op
  // -----------------------------------------------------------------------

  it('non-thief entity is ignored by updateThief', () => {
    const rifleman = new Entity(UnitType.I_E1, PLAYER_HOUSE);
    rifleman.alive = true;
    rifleman.mission = Mission.CAPTURE;
    const proc = makeStructure('PROC', ENEMY_HOUSE, 2, 2);
    rifleman.targetStructure = proc;
    rifleman.pos = { x: CELL_SIZE / 2, y: CELL_SIZE / 2 };

    const ctx = makeContext({
      houseCredits: new Map([[ENEMY_HOUSE, 1000]]),
    });

    updateThief(ctx, rifleman);

    expect(ctx.houseCredits.get(ENEMY_HOUSE)).toBe(1000);
    expect(ctx.isThieved).toBe(false);
  });

  // -----------------------------------------------------------------------
  //  3k. Large credit amounts — verify no overflow / precision issues
  // -----------------------------------------------------------------------

  it('handles large credit amounts correctly', () => {
    const thief = makeThief(PLAYER_HOUSE);
    const proc = makeStructure('PROC', ENEMY_HOUSE, 2, 2);
    thief.targetStructure = proc;
    placeThiefAtStructure(thief, proc);

    const ctx = makeContext({
      houseCredits: new Map([[ENEMY_HOUSE, 100000]]),
      credits: 0,
    });

    updateThief(ctx, thief);

    expect(ctx.houseCredits.get(ENEMY_HOUSE)).toBe(50000);
    expect(ctx.credits).toBe(50000);
  });
});

// =============================================================================
//  4. Building eligibility — C++ Capacity check vs TS hardcoded types
// =============================================================================

describe('Building eligibility for thief — C++ Capacity vs TS type check', () => {

  it('C++ uses bldg->Class->Capacity (Storage > 0), TS checks type === PROC/SILO', () => {
    // Document that in rules.ini, only PROC and SILO have Storage > 0
    // So the C++ Capacity check and TS hardcoded PROC/SILO check are
    // equivalent IN PRACTICE for the standard rules.ini.
    expect(STORAGE_BUILDINGS.sort()).toEqual(['PROC', 'SILO']);
  });

  it('no non-storage building has Storage > 0 in rules.ini', () => {
    for (const section of NON_STORAGE_BUILDINGS) {
      const storage = Number(ini[section]?.Storage ?? '0');
      expect(storage, `${section} should have Storage=0`).toBe(0);
    }
  });

  it('[MISMATCH] TS rejects non-storage buildings early; C++ would enter and set IsThieved', () => {
    // For each non-storage building, verify TS behavior
    for (const type of ['WEAP', 'TENT', 'BARR', 'POWR', 'DOME'] as const) {
      const thief = makeThief(PLAYER_HOUSE);
      const bldg = makeStructure(type, ENEMY_HOUSE, 2, 2);
      thief.targetStructure = bldg;
      placeThiefAtStructure(thief, bldg);

      const ctx = makeContext({
        houseCredits: new Map([[ENEMY_HOUSE, 1000]]),
      });

      updateThief(ctx, thief);

      // TS redirects thief to GUARD, keeps alive
      expect(thief.alive, `thief entering ${type} should stay alive in TS`).toBe(true);
      expect(thief.mission, `thief entering ${type} should be GUARD in TS`).toBe(Mission.GUARD);
      // C++ would: set IsThieved=true, delete thief, steal nothing (Capacity=0)
      expect(ctx.isThieved, `isThieved after entering ${type}`).toBe(false); // TS: false (C++: true)
      expect(ctx.houseCredits.get(ENEMY_HOUSE), `credits unchanged after ${type}`).toBe(1000);
    }
  });
});
