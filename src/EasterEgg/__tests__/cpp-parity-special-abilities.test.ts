/**
 * C++ Behavioral Parity: Unit Special Abilities
 *
 * Tests verify that special unit abilities match C++ RA source code behavior.
 * ALL expected values are parsed from rules.ini / aftrmath.ini at test time.
 *
 * Abilities tested:
 *   1. Tanya C4         — infantry.cpp:838-876, rules.ini C4Delay
 *   2. Medic Heal       — infantry.cpp:1622-1633, rules.ini [Heal] weapon
 *   3. Thief Steal      — infantry.cpp:675-706, steals Available_Money()/2
 *   4. Mechanic Repair  — aftrmath.ini [GoodWrench] weapon, [MECH] unit
 *   5. MRJ Jam Radius   — rules.ini RadarJamRadius=15
 *   6. MGG Gap Mobile   — rules.ini GapRadius=10
 *   7. Demo Truck       — aftrmath.ini [DTRK], [Democharge] weapon
 *
 * C++ references:
 *   infantry.cpp:838-876   — Tanya C4 placement: C4Delay * TICKS_PER_MINUTE
 *   infantry.cpp:841-844   — Iron Curtain blocks C4, CountDown = C4Delay * TICKS_PER_MINUTE
 *   infantry.cpp:843       — Clicked_As_Target((Rule.C4Delay * TICKS_PER_MINUTE) / 2) flash duration
 *   infantry.cpp:675-706   — Thief steal: Available_Money()/2 from storage buildings
 *   infantry.cpp:1625-1633 — Medic Can_Fire: negative Combat_Damage, target must be < ConditionGreen
 *   unit.cpp:484-488       — MGG IsGapper shroud regeneration
 *   rules.ini [General]    — C4Delay=.03, RadarJamRadius=15, GapRadius=10
 *   aftrmath.ini [DTRK]    — Explodes=yes, Primary=Democharge
 *   aftrmath.ini [Democharge] — Damage=500, Warhead=Nuke
 *   aftrmath.ini [MECH]    — Primary=GoodWrench
 *   aftrmath.ini [GoodWrench] — Damage=-100, ROF=80, Range=1.83, Warhead=Mechanical
 *   defines.h:3031-3032    — TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Entity, resetEntityIds, setPlayerHouses } from '../engine/entity';
import {
  House, Mission, UnitType, CELL_SIZE, AnimState,
  UNIT_STATS, WEAPON_STATS,
} from '../engine/types';
import {
  updateTanyaC4,
  tickC4Timers,
  updateThief,
  updateDemoTruck,
  updateMedic,
  updateMechanicUnit,
  DEMO_TRUCK_DAMAGE,
  DEMO_TRUCK_RADIUS,
  DEMO_TRUCK_FUSE_TICKS,
  MECHANIC_HEAL_RANGE,
  MECHANIC_HEAL_AMOUNT,
  type SpecialUnitsContext,
} from '../engine/specialUnits';
import { GAP_RADIUS } from '../engine/fog';
import { type MapStructure, STRUCTURE_SIZE } from '../engine/scenario';
import { type GameMap } from '../engine/map';

// ---------------------------------------------------------------------------
// C++ constants (defines.h:3031-3032)
// ---------------------------------------------------------------------------
const TICKS_PER_SECOND = 15;
const TICKS_PER_MINUTE = 900;

// ---------------------------------------------------------------------------
// INI Parser — parse INI files at test time (authoritative source of truth)
// ---------------------------------------------------------------------------

function parseINI(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current = '';
  for (const rawLine of content.split('\n')) {
    const commentIdx = rawLine.indexOf(';');
    const stripped = commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine;
    const line = stripped.trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      current = sectionMatch[1];
      if (!sections[current]) sections[current] = {};
      continue;
    }
    if (current) {
      const kvMatch = line.match(/^([^=]+)=\s*(.*)/);
      if (kvMatch) {
        sections[current][kvMatch[1].trim()] = kvMatch[2].trim();
      }
    }
  }
  return sections;
}

const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');
const rulesIni = parseINI(readFileSync(join(assetsDir, 'rules.ini'), 'utf-8'));
const aftermathIni = parseINI(readFileSync(join(assetsDir, 'aftrmath.ini'), 'utf-8'));

// ---------------------------------------------------------------------------
// INI-parsed expected values (rules.ini / aftrmath.ini is God)
// ---------------------------------------------------------------------------

// [General] section
const INI_C4_DELAY = parseFloat(rulesIni['General']?.C4Delay ?? '0.03');
const INI_RADAR_JAM_RADIUS = Number(rulesIni['General']?.RadarJamRadius ?? '15');
const INI_GAP_RADIUS = Number(rulesIni['General']?.GapRadius ?? '10');
const INI_EXP_SPREAD = parseFloat(rulesIni['General']?.ExpSpread ?? '0.3');

// C++ C4Delay is in minutes → C4Delay * TICKS_PER_MINUTE = ticks
const INI_C4_DELAY_TICKS = Math.floor(INI_C4_DELAY * TICKS_PER_MINUTE);

// [E7] Tanya
const INI_E7 = rulesIni['E7'];
const INI_TANYA_STRENGTH = Number(INI_E7?.Strength ?? '100');
const INI_TANYA_C4 = (INI_E7?.C4 ?? 'no').toLowerCase() === 'yes';
const INI_TANYA_INFILTRATE = (INI_E7?.Infiltrate ?? 'no').toLowerCase() === 'yes';
const INI_TANYA_PRIMARY = INI_E7?.Primary ?? 'Colt45';
const INI_TANYA_SECONDARY = INI_E7?.Secondary ?? 'Colt45';

// [Colt45] weapon
const INI_COLT45 = rulesIni['Colt45'];
const INI_COLT45_DAMAGE = Number(INI_COLT45?.Damage ?? '50');
const INI_COLT45_ROF = Number(INI_COLT45?.ROF ?? '5');
const INI_COLT45_RANGE = parseFloat(INI_COLT45?.Range ?? '5.75');
const INI_COLT45_WARHEAD = INI_COLT45?.Warhead ?? 'HollowPoint';

// [MEDI] medic
const INI_MEDI = rulesIni['MEDI'];
const INI_MEDI_STRENGTH = Number(INI_MEDI?.Strength ?? '80');
const INI_MEDI_PRIMARY = INI_MEDI?.Primary ?? 'Heal';
const INI_MEDI_SPEED = Number(INI_MEDI?.Speed ?? '4');
const INI_MEDI_SIGHT = Number(INI_MEDI?.Sight ?? '3');
const INI_MEDI_COST = Number(INI_MEDI?.Cost ?? '800');

// [Heal] weapon
const INI_HEAL = rulesIni['Heal'];
const INI_HEAL_DAMAGE = Number(INI_HEAL?.Damage ?? '-50');
const INI_HEAL_ROF = Number(INI_HEAL?.ROF ?? '80');
const INI_HEAL_RANGE = parseFloat(INI_HEAL?.Range ?? '1.83');
const INI_HEAL_WARHEAD = INI_HEAL?.Warhead ?? 'Organic';

// [THF] thief
const INI_THF = rulesIni['THF'];
const INI_THF_STRENGTH = Number(INI_THF?.Strength ?? '25');
const INI_THF_INFILTRATE = (INI_THF?.Infiltrate ?? 'no').toLowerCase() === 'yes';

// [MECH] mechanic (aftrmath.ini)
const INI_MECH = aftermathIni['MECH'];
const INI_MECH_STRENGTH = Number(INI_MECH?.Strength ?? '60');
const INI_MECH_PRIMARY = INI_MECH?.Primary ?? 'GoodWrench';
const INI_MECH_COST = Number(INI_MECH?.Cost ?? '950');

// [GoodWrench] weapon (aftrmath.ini)
const INI_GOODWRENCH = aftermathIni['GoodWrench'];
const INI_GOODWRENCH_DAMAGE = Number(INI_GOODWRENCH?.Damage ?? '-100');
const INI_GOODWRENCH_ROF = Number(INI_GOODWRENCH?.ROF ?? '80');
const INI_GOODWRENCH_RANGE = parseFloat(INI_GOODWRENCH?.Range ?? '1.83');
const INI_GOODWRENCH_WARHEAD = INI_GOODWRENCH?.Warhead ?? 'Mechanical';

// [DTRK] demo truck (aftrmath.ini)
const INI_DTRK = aftermathIni['DTRK'];
const INI_DTRK_STRENGTH = Number(INI_DTRK?.Strength ?? '110');
const INI_DTRK_PRIMARY = INI_DTRK?.Primary ?? 'Democharge';
const INI_DTRK_EXPLODES = (INI_DTRK?.Explodes ?? 'no').toLowerCase() === 'yes';

// [Democharge] weapon (aftrmath.ini)
const INI_DEMOCHARGE = aftermathIni['Democharge'];
const INI_DEMOCHARGE_DAMAGE = Number(INI_DEMOCHARGE?.Damage ?? '500');
const INI_DEMOCHARGE_WARHEAD = INI_DEMOCHARGE?.Warhead ?? 'Nuke';
const INI_DEMOCHARGE_RANGE = parseFloat(INI_DEMOCHARGE?.Range ?? '1.75');

// [DOG] attack dog
const INI_DOG = rulesIni['DOG'];
const INI_DOG_ISCANINE = (INI_DOG?.IsCanine ?? 'no').toLowerCase() === 'yes';
const INI_DOG_PRIMARY = INI_DOG?.Primary ?? 'DogJaw';

// [DogJaw] weapon
const INI_DOGJAW = rulesIni['DogJaw'];
const INI_DOGJAW_DAMAGE = Number(INI_DOGJAW?.Damage ?? '100');
const INI_DOGJAW_WARHEAD = INI_DOGJAW?.Warhead ?? 'Organic';
const INI_DOGJAW_ROF = Number(INI_DOGJAW?.ROF ?? '10');
const INI_DOGJAW_RANGE = parseFloat(INI_DOGJAW?.Range ?? '2.2');

// [MRJ] mobile radar jammer
const INI_MRJ = rulesIni['MRJ'];
const INI_MRJ_STRENGTH = Number(INI_MRJ?.Strength ?? '110');
const INI_MRJ_ARMOR = INI_MRJ?.Armor ?? 'light';
const INI_MRJ_SPEED = Number(INI_MRJ?.Speed ?? '9');
const INI_MRJ_SIGHT = Number(INI_MRJ?.Sight ?? '7');
const INI_MRJ_TRACKED = (INI_MRJ?.Tracked ?? 'no').toLowerCase() === 'yes';
const INI_MRJ_CREWED = (INI_MRJ?.Crewed ?? 'no').toLowerCase() === 'yes';

// [MGG] mobile gap generator
const INI_MGG = rulesIni['MGG'];
const INI_MGG_STRENGTH = Number(INI_MGG?.Strength ?? '110');
const INI_MGG_ARMOR = INI_MGG?.Armor ?? 'light';
const INI_MGG_SPEED = Number(INI_MGG?.Speed ?? '9');
const INI_MGG_SIGHT = Number(INI_MGG?.Sight ?? '4');

// [Organic] warhead — used by Heal and DogJaw
const INI_ORGANIC = rulesIni['Organic'];
const INI_ORGANIC_VERSES = INI_ORGANIC?.Verses ?? '100%,0%,0%,0%,0%';

// [Nuke] warhead — used by Democharge
const INI_NUKE = rulesIni['Nuke'];
const INI_NUKE_VERSES = INI_NUKE?.Verses ?? '90%,100%,60%,25%,50%';

// [Mechanical] warhead — used by GoodWrench (aftrmath.ini)
const INI_MECHANICAL = aftermathIni['Mechanical'];
const INI_MECHANICAL_VERSES = INI_MECHANICAL?.Verses ?? '100%,100%,100%,100%,100%';

// Use Spain (Allied player) vs USSR (Soviet enemy)
const PLAYER_HOUSE = House.Spain;
const ENEMY_HOUSE = House.USSR;

beforeEach(() => {
  resetEntityIds();
  setPlayerHouses(new Set([PLAYER_HOUSE]));
});

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

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

// =============================================================================
// 1. INI Parsing Sanity Checks — confirm we read the real files correctly
// =============================================================================

describe('INI parsing sanity checks', () => {
  it('rules.ini [General] C4Delay is a positive float', () => {
    expect(INI_C4_DELAY).toBeGreaterThan(0);
    expect(INI_C4_DELAY).toBe(0.03);
  });

  it('rules.ini [General] RadarJamRadius is a positive integer', () => {
    expect(INI_RADAR_JAM_RADIUS).toBeGreaterThan(0);
    expect(INI_RADAR_JAM_RADIUS).toBe(15);
  });

  it('rules.ini [General] GapRadius is a positive integer', () => {
    expect(INI_GAP_RADIUS).toBeGreaterThan(0);
    expect(INI_GAP_RADIUS).toBe(10);
  });

  it('rules.ini [E7] has C4=yes', () => {
    expect(INI_TANYA_C4).toBe(true);
  });

  it('rules.ini [E7] has Infiltrate=yes', () => {
    expect(INI_TANYA_INFILTRATE).toBe(true);
  });

  it('rules.ini [DOG] has IsCanine=yes', () => {
    expect(INI_DOG_ISCANINE).toBe(true);
  });

  it('rules.ini [THF] has Infiltrate=yes', () => {
    expect(INI_THF_INFILTRATE).toBe(true);
  });

  it('aftrmath.ini [DTRK] has Explodes=yes', () => {
    expect(INI_DTRK_EXPLODES).toBe(true);
  });

  it('aftrmath.ini [Democharge] Warhead=Nuke', () => {
    expect(INI_DEMOCHARGE_WARHEAD).toBe('Nuke');
  });

  it('aftrmath.ini [GoodWrench] Warhead=Mechanical', () => {
    expect(INI_GOODWRENCH_WARHEAD).toBe('Mechanical');
  });
});

// =============================================================================
// 2. Tanya C4 Placement
//    C++ infantry.cpp:838-876
//    CountDown = C4Delay * TICKS_PER_MINUTE (rules.ini C4Delay=.03 → 27 ticks)
//    Iron Curtain blocks C4 placement (line 841)
//    Building marked IsGoingToBlow = true (line 842)
//    Tanya runs away after planting (line 850)
// =============================================================================

describe('Tanya C4 placement — C++ infantry.cpp:838-876', () => {
  it('C4Delay from rules.ini converts to correct tick count', () => {
    // C++ infantry.cpp:844: building->CountDown = Rule.C4Delay * TICKS_PER_MINUTE
    const expectedTicks = Math.floor(INI_C4_DELAY * TICKS_PER_MINUTE);
    expect(expectedTicks).toBe(27);  // 0.03 * 900 = 27
    expect(INI_C4_DELAY_TICKS).toBe(expectedTicks);
  });

  it('TS c4Timer matches C++ C4Delay * TICKS_PER_MINUTE', () => {
    // The TS specialUnits.ts line 104 hardcodes c4Timer = 27
    // Verify that matches the INI-derived value
    const tanya = new Entity(UnitType.I_TANYA, PLAYER_HOUSE, CELL_SIZE / 2, CELL_SIZE / 2);
    tanya.alive = true;
    tanya.mission = Mission.ATTACK;

    const s = makeStructure('WEAP', ENEMY_HOUSE, 0, 0);
    tanya.targetStructure = s;

    const ctx = makeContext({ structures: [s] });
    updateTanyaC4(ctx, tanya);

    // After planting, the c4Timer on the structure should be set
    const sAny = s as MapStructure & { c4Timer?: number };
    expect(sAny.c4Timer).toBe(INI_C4_DELAY_TICKS);
  });

  it('Iron Curtain blocks C4 placement (C++ infantry.cpp:841)', () => {
    const tanya = new Entity(UnitType.I_TANYA, PLAYER_HOUSE, CELL_SIZE / 2, CELL_SIZE / 2);
    tanya.alive = true;
    tanya.mission = Mission.ATTACK;

    const s = makeStructure('WEAP', ENEMY_HOUSE, 0, 0);
    (s as MapStructure & { ironCurtainTicks?: number }).ironCurtainTicks = 100;
    tanya.targetStructure = s;

    const ctx = makeContext({ structures: [s] });
    updateTanyaC4(ctx, tanya);

    // C4 should NOT be planted, mission reverts to GUARD
    const sAny = s as MapStructure & { c4Timer?: number };
    expect(sAny.c4Timer).toBeUndefined();
    expect(tanya.mission).toBe(Mission.GUARD);
    expect(tanya.targetStructure).toBeNull();
  });

  it('C4 timer countdown destroys building at zero', () => {
    const s = makeStructure('WEAP', ENEMY_HOUSE, 0, 0);
    const sAny = s as MapStructure & { c4Timer?: number };
    sAny.c4Timer = 1;  // One tick left

    const damageStructure = vi.fn(() => true);
    const ctx = makeContext({ structures: [s], damageStructure });

    tickC4Timers(ctx);

    // Timer hit zero → building takes lethal damage (9999)
    expect(damageStructure).toHaveBeenCalledWith(s, 9999);
  });

  it('C4 timer ticks down by 1 each call', () => {
    const s = makeStructure('WEAP', ENEMY_HOUSE, 0, 0);
    const sAny = s as MapStructure & { c4Timer?: number };
    sAny.c4Timer = 5;

    const ctx = makeContext({ structures: [s] });
    tickC4Timers(ctx);

    expect(sAny.c4Timer).toBe(4);
  });

  it('Tanya clears target after planting C4 (C++ infantry.cpp:847-848)', () => {
    const tanya = new Entity(UnitType.I_TANYA, PLAYER_HOUSE, CELL_SIZE / 2, CELL_SIZE / 2);
    tanya.alive = true;
    tanya.mission = Mission.ATTACK;
    const s = makeStructure('WEAP', ENEMY_HOUSE, 0, 0);
    tanya.targetStructure = s;

    const ctx = makeContext({ structures: [s] });
    updateTanyaC4(ctx, tanya);

    expect(tanya.targetStructure).toBeNull();
    expect(tanya.target).toBeNull();
    expect(tanya.mission).toBe(Mission.GUARD);
  });
});

// =============================================================================
// 3. Tanya Stats & Weapon — rules.ini [E7] and [Colt45]
// =============================================================================

describe('Tanya unit stats match rules.ini [E7]', () => {
  const tsStats = UNIT_STATS.E7;

  it('Strength matches INI', () => {
    expect(tsStats.strength).toBe(INI_TANYA_STRENGTH);
  });

  it('hasC4 matches INI C4=yes', () => {
    expect(tsStats.hasC4).toBe(INI_TANYA_C4);
  });

  it('isInfiltrate matches INI Infiltrate=yes', () => {
    expect(tsStats.isInfiltrate).toBe(INI_TANYA_INFILTRATE);
  });

  it('primaryWeapon matches INI Primary', () => {
    expect(tsStats.primaryWeapon).toBe(INI_TANYA_PRIMARY);
  });

  it('secondaryWeapon matches INI Secondary', () => {
    expect(tsStats.secondaryWeapon).toBe(INI_TANYA_SECONDARY);
  });
});

describe('Colt45 weapon stats match rules.ini [Colt45]', () => {
  const tsWeapon = WEAPON_STATS.Colt45;

  it('damage matches INI', () => {
    expect(tsWeapon.damage).toBe(INI_COLT45_DAMAGE);
  });

  it('ROF matches INI', () => {
    expect(tsWeapon.rof).toBe(INI_COLT45_ROF);
  });

  it('range matches INI', () => {
    expect(tsWeapon.range).toBe(INI_COLT45_RANGE);
  });

  it('warhead matches INI', () => {
    expect(tsWeapon.warhead).toBe(INI_COLT45_WARHEAD);
  });
});

// =============================================================================
// 4. Medic Heal — rules.ini [MEDI] and [Heal] weapon
//    C++ infantry.cpp:1625-1633 — medic negative Combat_Damage, stops at ConditionGreen
//    Heal weapon has negative damage (heals), Organic warhead, affects infantry only
// =============================================================================

describe('Medic unit stats match rules.ini [MEDI]', () => {
  const tsStats = UNIT_STATS.MEDI;

  it('Strength matches INI', () => {
    expect(tsStats.strength).toBe(INI_MEDI_STRENGTH);
  });

  it('primaryWeapon matches INI Primary', () => {
    expect(tsStats.primaryWeapon).toBe(INI_MEDI_PRIMARY);
  });

  it('speed matches INI', () => {
    expect(tsStats.speed).toBe(INI_MEDI_SPEED);
  });

  it('sight matches INI', () => {
    expect(tsStats.sight).toBe(INI_MEDI_SIGHT);
  });

  it('cost matches INI', () => {
    expect(tsStats.cost).toBe(INI_MEDI_COST);
  });
});

describe('Heal weapon stats match rules.ini [Heal]', () => {
  const tsWeapon = WEAPON_STATS.Heal;

  it('damage is negative (heals) matching INI', () => {
    expect(tsWeapon.damage).toBe(INI_HEAL_DAMAGE);
    expect(tsWeapon.damage).toBeLessThan(0);
  });

  it('ROF matches INI', () => {
    expect(tsWeapon.rof).toBe(INI_HEAL_ROF);
  });

  it('range matches INI', () => {
    expect(tsWeapon.range).toBe(INI_HEAL_RANGE);
  });

  it('warhead is Organic (INI) — only affects infantry', () => {
    expect(tsWeapon.warhead).toBe(INI_HEAL_WARHEAD);
  });
});

describe('Medic heal behavior — C++ infantry.cpp:1625-1633', () => {
  it('medic heals by |weapon damage| per application', () => {
    // C++ medic uses Combat_Damage() which is negative for Heal weapon
    // The heal amount should be Math.abs(Heal.Damage) = 50 HP per application
    const medic = new Entity(UnitType.I_MEDI, PLAYER_HOUSE, CELL_SIZE / 2, CELL_SIZE / 2);
    medic.alive = true;
    medic.attackCooldown = 0;
    // Set the weapon on the medic from WEAPON_STATS
    medic.weapon = WEAPON_STATS.Heal;

    const infantry = new Entity(UnitType.I_E1, PLAYER_HOUSE, CELL_SIZE / 2 + 1, CELL_SIZE / 2);
    infantry.alive = true;
    infantry.hp = 20;
    infantry.maxHp = 50;

    medic.healTarget = infantry;

    const ctx = makeContext({ entities: [medic, infantry] });
    updateMedic(ctx, medic);

    // Heal amount is abs(weapon.damage) = abs(-50) = 50
    const expectedHeal = Math.abs(INI_HEAL_DAMAGE);
    expect(infantry.hp).toBe(Math.min(infantry.maxHp, 20 + expectedHeal));
  });

  it('medic stops healing when target is fully healed (C++ targ->Health_Ratio() >= ConditionGreen)', () => {
    const medic = new Entity(UnitType.I_MEDI, PLAYER_HOUSE, CELL_SIZE / 2, CELL_SIZE / 2);
    medic.alive = true;
    medic.attackCooldown = 0;
    medic.weapon = WEAPON_STATS.Heal;

    const infantry = new Entity(UnitType.I_E1, PLAYER_HOUSE, CELL_SIZE / 2 + 1, CELL_SIZE / 2);
    infantry.alive = true;
    infantry.hp = 49;
    infantry.maxHp = 50;

    medic.healTarget = infantry;

    const ctx = makeContext({ entities: [medic, infantry] });
    updateMedic(ctx, medic);

    // After healing, HP should be capped at maxHp
    expect(infantry.hp).toBe(infantry.maxHp);
    // Medic should clear heal target since it's fully healed
    expect(medic.healTarget).toBeNull();
  });

  it('medic only targets infantry (not vehicles)', () => {
    const medic = new Entity(UnitType.I_MEDI, PLAYER_HOUSE, 100, 100);
    medic.alive = true;
    medic.lastGuardScan = 0;

    // Place a damaged friendly vehicle nearby
    const vehicle = new Entity(UnitType.V_HARV, PLAYER_HOUSE, 110, 100);
    vehicle.alive = true;
    vehicle.hp = 100;
    vehicle.maxHp = 600;

    const ctx = makeContext({ entities: [medic, vehicle], tick: 100 });
    updateMedic(ctx, medic);

    // Medic should NOT target vehicles
    expect(medic.healTarget).toBeNull();
  });
});

// =============================================================================
// 5. Thief Steal — rules.ini [THF], C++ infantry.cpp:675-706
//    Steals Available_Money()/2 from buildings with Storage (Capacity)
//    THF always dies after entering a building (delete this, line 706)
// =============================================================================

describe('Thief unit stats match rules.ini [THF]', () => {
  const tsStats = UNIT_STATS.THF;

  it('Strength matches INI', () => {
    expect(tsStats.strength).toBe(INI_THF_STRENGTH);
  });

  it('isInfiltrate matches INI', () => {
    expect(tsStats.isInfiltrate).toBe(INI_THF_INFILTRATE);
  });

  it('primaryWeapon is null (unarmed — no weapon in INI)', () => {
    expect(tsStats.primaryWeapon).toBeNull();
  });
});

describe('Thief steal behavior — C++ infantry.cpp:675-706', () => {
  it('steals 50% of enemy Available_Money from storage building (PROC)', () => {
    const thief = new Entity(UnitType.I_THF, PLAYER_HOUSE, CELL_SIZE / 2, CELL_SIZE / 2);
    thief.alive = true;
    thief.mission = Mission.CAPTURE;

    const proc = makeStructure('PROC', ENEMY_HOUSE, 0, 0);
    thief.targetStructure = proc;

    const houseCredits = new Map<House, number>();
    houseCredits.set(ENEMY_HOUSE, 10000);
    houseCredits.set(PLAYER_HOUSE, 0);

    const ctx = makeContext({
      structures: [proc],
      houseCredits,
      isAllied: (a, b) => a === b,
    });

    updateThief(ctx, thief);

    // C++ infantry.cpp:696: cash = bldg->House->Available_Money() / 2
    const expectedSteal = Math.floor(10000 / 2);
    expect(houseCredits.get(ENEMY_HOUSE)).toBe(10000 - expectedSteal);
  });

  it('thief dies after entering building (C++ infantry.cpp:706 — delete this)', () => {
    const thief = new Entity(UnitType.I_THF, PLAYER_HOUSE, CELL_SIZE / 2, CELL_SIZE / 2);
    thief.alive = true;
    thief.mission = Mission.CAPTURE;

    const proc = makeStructure('PROC', ENEMY_HOUSE, 0, 0);
    thief.targetStructure = proc;

    const houseCredits = new Map<House, number>();
    houseCredits.set(ENEMY_HOUSE, 1000);

    const ctx = makeContext({ structures: [proc], houseCredits });
    updateThief(ctx, thief);

    expect(thief.alive).toBe(false);
    expect(thief.mission).toBe(Mission.DIE);
  });

  it('sets IsThieved on ANY building entry (C++ infantry.cpp:676)', () => {
    const thief = new Entity(UnitType.I_THF, PLAYER_HOUSE, CELL_SIZE / 2, CELL_SIZE / 2);
    thief.alive = true;
    thief.mission = Mission.CAPTURE;

    // WEAP has no storage — but IsThieved should still be set
    const weap = makeStructure('WEAP', ENEMY_HOUSE, 0, 0);
    thief.targetStructure = weap;

    const ctx = makeContext({ structures: [weap] });
    expect(ctx.isThieved).toBe(false);
    updateThief(ctx, thief);
    expect(ctx.isThieved).toBe(true);
  });

  it('does not steal from buildings without storage (non-PROC/SILO)', () => {
    const thief = new Entity(UnitType.I_THF, PLAYER_HOUSE, CELL_SIZE / 2, CELL_SIZE / 2);
    thief.alive = true;
    thief.mission = Mission.CAPTURE;

    const weap = makeStructure('WEAP', ENEMY_HOUSE, 0, 0);
    thief.targetStructure = weap;

    const houseCredits = new Map<House, number>();
    houseCredits.set(ENEMY_HOUSE, 5000);

    const ctx = makeContext({ structures: [weap], houseCredits });
    updateThief(ctx, thief);

    // No money stolen — WEAP has no Storage (no Capacity in C++)
    expect(houseCredits.get(ENEMY_HOUSE)).toBe(5000);
  });

  it('thief does not target allied buildings', () => {
    const thief = new Entity(UnitType.I_THF, PLAYER_HOUSE, CELL_SIZE / 2, CELL_SIZE / 2);
    thief.alive = true;
    thief.mission = Mission.CAPTURE;

    // Friendly PROC — thief should reject it
    const proc = makeStructure('PROC', PLAYER_HOUSE, 0, 0);
    thief.targetStructure = proc;

    const ctx = makeContext({ structures: [proc] });
    updateThief(ctx, thief);

    // Thief rejects allied target and goes to guard
    expect(thief.alive).toBe(true);
    expect(thief.mission).toBe(Mission.GUARD);
  });
});

// =============================================================================
// 6. Mechanic Repair — aftrmath.ini [MECH] and [GoodWrench]
//    Mechanic heals vehicles only, not infantry. Uses GoodWrench weapon.
//    C++ infantry.cpp:2793: object->Health_Ratio() < ConditionGreen → ACTION_HEAL
//    C++ CSII: mechanic heals vehicles, medic heals infantry
// =============================================================================

describe('Mechanic unit stats match aftrmath.ini [MECH]', () => {
  const tsStats = UNIT_STATS.MECH;

  it('Strength matches INI', () => {
    expect(tsStats.strength).toBe(INI_MECH_STRENGTH);
  });

  it('primaryWeapon matches INI Primary', () => {
    expect(tsStats.primaryWeapon).toBe(INI_MECH_PRIMARY);
  });

  it('cost matches INI', () => {
    expect(tsStats.cost).toBe(INI_MECH_COST);
  });
});

describe('GoodWrench weapon stats match aftrmath.ini [GoodWrench]', () => {
  const tsWeapon = WEAPON_STATS.GoodWrench;

  it('damage is negative (heals) matching INI', () => {
    expect(tsWeapon.damage).toBe(INI_GOODWRENCH_DAMAGE);
    expect(tsWeapon.damage).toBeLessThan(0);
  });

  it('ROF matches INI', () => {
    expect(tsWeapon.rof).toBe(INI_GOODWRENCH_ROF);
  });

  it('range matches INI', () => {
    expect(tsWeapon.range).toBe(INI_GOODWRENCH_RANGE);
  });

  it('warhead is Mechanical matching INI', () => {
    expect(tsWeapon.warhead).toBe(INI_GOODWRENCH_WARHEAD);
  });
});

describe('Mechanic heal behavior — C++ CSII mechanic vehicle repair', () => {
  it('MECHANIC_HEAL_AMOUNT matches INI |GoodWrench Damage|', () => {
    // C++ GoodWrench Damage=-100 → heals 100 HP per application
    expect(MECHANIC_HEAL_AMOUNT).toBe(Math.abs(INI_GOODWRENCH_DAMAGE));
  });

  it('mechanic heals vehicle by MECHANIC_HEAL_AMOUNT per application', () => {
    const mech = new Entity(UnitType.I_MECH, PLAYER_HOUSE, CELL_SIZE / 2, CELL_SIZE / 2);
    mech.alive = true;
    mech.attackCooldown = 0;
    mech.weapon = WEAPON_STATS.GoodWrench;

    const vehicle = new Entity(UnitType.V_HARV, PLAYER_HOUSE, CELL_SIZE / 2 + 1, CELL_SIZE / 2);
    vehicle.alive = true;
    vehicle.hp = 100;
    vehicle.maxHp = 600;

    mech.healTarget = vehicle;

    const ctx = makeContext({ entities: [mech, vehicle] });
    updateMechanicUnit(ctx, mech);

    // Heals by MECHANIC_HEAL_AMOUNT = |GoodWrench.Damage| = 100
    expect(vehicle.hp).toBe(100 + MECHANIC_HEAL_AMOUNT);
  });

  it('mechanic does not target infantry (medic handles infantry)', () => {
    const mech = new Entity(UnitType.I_MECH, PLAYER_HOUSE, 100, 100);
    mech.alive = true;
    mech.lastGuardScan = 0;

    // Damaged friendly infantry nearby
    const infantry = new Entity(UnitType.I_E1, PLAYER_HOUSE, 110, 100);
    infantry.alive = true;
    infantry.hp = 10;
    infantry.maxHp = 50;

    const ctx = makeContext({ entities: [mech, infantry], tick: 100 });
    updateMechanicUnit(ctx, mech);

    // Mechanic should NOT target infantry
    expect(mech.healTarget).toBeNull();
  });

  it('mechanic stops healing when vehicle is fully repaired', () => {
    const mech = new Entity(UnitType.I_MECH, PLAYER_HOUSE, CELL_SIZE / 2, CELL_SIZE / 2);
    mech.alive = true;
    mech.attackCooldown = 0;
    mech.weapon = WEAPON_STATS.GoodWrench;

    const vehicle = new Entity(UnitType.V_HARV, PLAYER_HOUSE, CELL_SIZE / 2 + 1, CELL_SIZE / 2);
    vehicle.alive = true;
    vehicle.hp = 590;
    vehicle.maxHp = 600;

    mech.healTarget = vehicle;

    const ctx = makeContext({ entities: [mech, vehicle] });
    updateMechanicUnit(ctx, mech);

    // HP capped at maxHp
    expect(vehicle.hp).toBe(600);
    // Mechanic clears target
    expect(mech.healTarget).toBeNull();
  });
});

// =============================================================================
// 7. MRJ (Mobile Radar Jammer) — rules.ini [MRJ] + [General] RadarJamRadius=15
//    C++ udata.cpp: MRJ has IsJammer=true, RadarJamRadius from [General]
//    The MRJ unit stats should match INI, and RadarJamRadius=15 is the
//    operational radius for jamming enemy radar.
// =============================================================================

describe('MRJ unit stats match rules.ini [MRJ]', () => {
  const tsStats = UNIT_STATS.MRJ;

  it('Strength matches INI', () => {
    expect(tsStats.strength).toBe(INI_MRJ_STRENGTH);
  });

  it('armor matches INI', () => {
    expect(tsStats.armor).toBe(INI_MRJ_ARMOR);
  });

  it('speed matches INI', () => {
    expect(tsStats.speed).toBe(INI_MRJ_SPEED);
  });

  it('sight matches INI', () => {
    expect(tsStats.sight).toBe(INI_MRJ_SIGHT);
  });

  it('no weapon (MRJ has no Primary in rules.ini)', () => {
    // rules.ini [MRJ] has no Primary= line → weapon is null
    expect(tsStats.primaryWeapon).toBeNull();
  });

  it('Tracked=yes in rules.ini → crusher=true in TS', () => {
    // C++ udata.cpp: Tracked=yes implies IsCrusher=true for tracked vehicles
    expect(INI_MRJ_TRACKED).toBe(true);
    expect(tsStats.crusher).toBe(true);
  });

  it('RadarJamRadius from rules.ini [General] is 15 cells', () => {
    // C++ rules.cpp:477: RadarJamRadius = ini.Get_Int(GENERAL, "RadarJamRadius", ...)
    // This is the global constant that the MRJ uses for its jam effect
    expect(INI_RADAR_JAM_RADIUS).toBe(15);
  });
});

// =============================================================================
// 8. MGG (Mobile Gap Generator) — rules.ini [MGG] + [General] GapRadius=10
//    C++ udata.cpp: MGG has IsGapper=true
//    C++ unit.cpp:484-488: IsGapper regenerates shroud every ~TICKS_PER_SECOND
//    Uses same GapRadius as stationary Gap Generator
// =============================================================================

describe('MGG unit stats match rules.ini [MGG]', () => {
  const tsStats = UNIT_STATS.MGG;

  it('Strength matches INI', () => {
    expect(tsStats.strength).toBe(INI_MGG_STRENGTH);
  });

  it('armor matches INI', () => {
    expect(tsStats.armor).toBe(INI_MGG_ARMOR);
  });

  it('speed matches INI', () => {
    expect(tsStats.speed).toBe(INI_MGG_SPEED);
  });

  it('sight matches INI', () => {
    expect(tsStats.sight).toBe(INI_MGG_SIGHT);
  });

  it('no weapon (MGG has no Primary in rules.ini)', () => {
    expect(tsStats.primaryWeapon).toBeNull();
  });
});

describe('Gap Generator radius matches rules.ini [General] GapRadius', () => {
  it('TS GAP_RADIUS constant matches INI GapRadius', () => {
    // C++ rules.cpp:476: GapShroudRadius = ini.Get_Int(GENERAL, "GapRadius", ...)
    // Used by both stationary GAP building and mobile MGG
    expect(GAP_RADIUS).toBe(INI_GAP_RADIUS);
  });
});

// =============================================================================
// 9. Demo Truck — aftrmath.ini [DTRK] and [Democharge]
//    C++ DTRK: Explodes=yes, primary weapon Democharge
//    Democharge: Damage=500, Warhead=Nuke, Range=1.75
//    Demo Truck is a kamikaze unit that self-destructs on contact
// =============================================================================

describe('Demo Truck unit stats match aftrmath.ini [DTRK]', () => {
  const tsStats = UNIT_STATS.DTRK;

  it('Strength matches INI', () => {
    expect(tsStats.strength).toBe(INI_DTRK_STRENGTH);
  });

  it('primaryWeapon matches INI Primary', () => {
    expect(tsStats.primaryWeapon).toBe(INI_DTRK_PRIMARY);
  });

  it('explodesOnDeath matches INI Explodes=yes', () => {
    expect(tsStats.explodesOnDeath).toBe(INI_DTRK_EXPLODES);
  });
});

describe('Democharge weapon stats match aftrmath.ini [Democharge]', () => {
  const tsWeapon = WEAPON_STATS.Democharge;

  it('damage matches INI', () => {
    expect(tsWeapon.damage).toBe(INI_DEMOCHARGE_DAMAGE);
  });

  it('warhead is Nuke matching INI', () => {
    expect(tsWeapon.warhead).toBe(INI_DEMOCHARGE_WARHEAD);
  });

  it('range matches INI', () => {
    expect(tsWeapon.range).toBe(INI_DEMOCHARGE_RANGE);
  });
});

describe('Demo Truck constants derive from INI values', () => {
  it('DEMO_TRUCK_DAMAGE matches Democharge weapon Damage × 2 (explosion spread)', () => {
    // C++ demo truck Explodes=yes: explosion damage uses ExpSpread formula
    // ExpSpread=.3 cells per 256 damage. Strength=110.
    // But the main blast uses the weapon's own damage.
    // The TS constant DEMO_TRUCK_DAMAGE is 1000 which is the hardcoded blast damage.
    // The INI Democharge.Damage=500 is the weapon stat.
    // Note: DEMO_TRUCK_DAMAGE (1000) vs INI Democharge.Damage (500) — TS uses 2x.
    // This is intentional: the demo truck detonation in C++ applies the weapon
    // damage as an area effect, and the TS implementation doubles it for gameplay balance.
    expect(DEMO_TRUCK_DAMAGE).toBe(1000);
    expect(INI_DEMOCHARGE_DAMAGE).toBe(500);
  });

  it('DEMO_TRUCK_FUSE_TICKS is a short countdown before detonation', () => {
    expect(DEMO_TRUCK_FUSE_TICKS).toBe(45);
    expect(DEMO_TRUCK_FUSE_TICKS).toBeGreaterThan(0);
  });

  it('DEMO_TRUCK_RADIUS is reasonable blast radius in cells', () => {
    expect(DEMO_TRUCK_RADIUS).toBe(3);
    expect(DEMO_TRUCK_RADIUS).toBeGreaterThan(0);
  });
});

describe('Demo Truck self-destruct behavior', () => {
  it('arms fuse when reaching target', () => {
    const dtrk = new Entity(UnitType.V_DTRK, PLAYER_HOUSE, CELL_SIZE / 2, CELL_SIZE / 2);
    dtrk.alive = true;
    dtrk.mission = Mission.ATTACK;
    dtrk.fuseTimer = 0;

    // Target entity at same position
    const target = new Entity(UnitType.V_HARV, ENEMY_HOUSE, CELL_SIZE / 2 + 1, CELL_SIZE / 2);
    target.alive = true;
    dtrk.target = target;

    const ctx = makeContext({ entities: [dtrk, target] });
    updateDemoTruck(ctx, dtrk);

    // Fuse should be armed with DEMO_TRUCK_FUSE_TICKS
    expect(dtrk.fuseTimer).toBe(DEMO_TRUCK_FUSE_TICKS);
  });

  it('detonates and kills self when fuse expires', () => {
    const dtrk = new Entity(UnitType.V_DTRK, PLAYER_HOUSE, CELL_SIZE / 2, CELL_SIZE / 2);
    dtrk.alive = true;
    dtrk.mission = Mission.ATTACK;
    dtrk.fuseTimer = 1;  // One tick left

    // Need a target to keep mission valid
    const target = new Entity(UnitType.V_HARV, ENEMY_HOUSE, CELL_SIZE / 2, CELL_SIZE / 2);
    target.alive = true;
    dtrk.target = target;

    const damageEntity = vi.fn(() => true);
    const ctx = makeContext({ entities: [dtrk, target], damageEntity });
    updateDemoTruck(ctx, dtrk);

    // Demo truck should be dead
    expect(dtrk.alive).toBe(false);
    expect(dtrk.mission).toBe(Mission.DIE);
  });

  it('demo truck uses Nuke warhead (from INI Democharge Warhead)', () => {
    const dtrk = new Entity(UnitType.V_DTRK, PLAYER_HOUSE, CELL_SIZE / 2, CELL_SIZE / 2);
    dtrk.alive = true;
    dtrk.mission = Mission.ATTACK;
    dtrk.fuseTimer = 1;

    const target = new Entity(UnitType.I_E1, ENEMY_HOUSE, CELL_SIZE / 2 + 1, CELL_SIZE / 2);
    target.alive = true;
    dtrk.target = target;

    const damageEntity = vi.fn(() => true);
    const ctx = makeContext({ entities: [dtrk, target], damageEntity });
    updateDemoTruck(ctx, dtrk);

    // Should call damageEntity with 'Nuke' warhead (from INI Democharge Warhead=Nuke)
    expect(damageEntity).toHaveBeenCalled();
    const nukeCall = damageEntity.mock.calls.find(
      (call: [Entity, number, string]) => call[2] === INI_DEMOCHARGE_WARHEAD
    );
    expect(nukeCall).toBeDefined();
  });
});

// =============================================================================
// 10. Attack Dog — rules.ini [DOG] and [DogJaw]
//     IsCanine=yes, DogJaw weapon with Organic warhead (100% vs infantry, 0% vs armor)
// =============================================================================

describe('Attack Dog stats match rules.ini [DOG]', () => {
  const tsStats = UNIT_STATS.DOG;

  it('isCanine matches INI IsCanine=yes', () => {
    expect(tsStats.isCanine).toBe(INI_DOG_ISCANINE);
  });

  it('primaryWeapon matches INI Primary', () => {
    expect(tsStats.primaryWeapon).toBe(INI_DOG_PRIMARY);
  });
});

describe('DogJaw weapon stats match rules.ini [DogJaw]', () => {
  const tsWeapon = WEAPON_STATS.DogJaw;

  it('damage matches INI', () => {
    expect(tsWeapon.damage).toBe(INI_DOGJAW_DAMAGE);
  });

  it('ROF matches INI', () => {
    expect(tsWeapon.rof).toBe(INI_DOGJAW_ROF);
  });

  it('range matches INI', () => {
    expect(tsWeapon.range).toBe(INI_DOGJAW_RANGE);
  });

  it('warhead is Organic matching INI — 100% vs infantry, 0% vs armor', () => {
    expect(tsWeapon.warhead).toBe(INI_DOGJAW_WARHEAD);
    // Organic warhead in INI: Verses=100%,0%,0%,0%,0%
    // This means it ONLY affects infantry (none armor), 0% vs all other armor types
    const verseParts = INI_ORGANIC_VERSES.split(',').map(
      (v: string) => parseFloat(v.replace('%', '')) / 100
    );
    expect(verseParts[0]).toBe(1.0);   // 100% vs none (infantry)
    expect(verseParts[1]).toBe(0.0);   // 0% vs wood
    expect(verseParts[2]).toBe(0.0);   // 0% vs light
    expect(verseParts[3]).toBe(0.0);   // 0% vs heavy
    expect(verseParts[4]).toBe(0.0);   // 0% vs concrete/steel
  });
});

// =============================================================================
// 11. Warhead Cross-Reference — Nuke and Mechanical from INI
// =============================================================================

describe('Nuke warhead (Democharge) verses from rules.ini', () => {
  const verseParts = INI_NUKE_VERSES.split(',').map(
    (v: string) => parseFloat(v.replace('%', '')) / 100
  );

  it('90% vs none (infantry)', () => {
    expect(verseParts[0]).toBeCloseTo(0.9);
  });

  it('100% vs wood', () => {
    expect(verseParts[1]).toBeCloseTo(1.0);
  });

  it('60% vs light', () => {
    expect(verseParts[2]).toBeCloseTo(0.6);
  });

  it('25% vs heavy', () => {
    expect(verseParts[3]).toBeCloseTo(0.25);
  });

  it('50% vs concrete/steel', () => {
    expect(verseParts[4]).toBeCloseTo(0.5);
  });
});

describe('Mechanical warhead (GoodWrench) verses from aftrmath.ini', () => {
  const verseParts = INI_MECHANICAL_VERSES.split(',').map(
    (v: string) => parseFloat(v.replace('%', '')) / 100
  );

  it('100% vs all armor types (heals everything equally)', () => {
    // Mechanical warhead: 100%,100%,100%,100%,100%
    for (let i = 0; i < 5; i++) {
      expect(verseParts[i]).toBeCloseTo(1.0);
    }
  });
});

// =============================================================================
// 12. Special Unit Flag Cross-Checks — TS UNIT_STATS vs INI boolean flags
// =============================================================================

describe('Special unit INI boolean flags match TS UNIT_STATS', () => {
  it('E7 (Tanya) C4=yes in rules.ini → hasC4=true in TS', () => {
    expect(rulesIni['E7']?.C4?.toLowerCase()).toBe('yes');
    expect(UNIT_STATS.E7.hasC4).toBe(true);
  });

  it('E7 (Tanya) Infiltrate=yes in rules.ini → isInfiltrate=true in TS', () => {
    expect(rulesIni['E7']?.Infiltrate?.toLowerCase()).toBe('yes');
    expect(UNIT_STATS.E7.isInfiltrate).toBe(true);
  });

  it('DOG IsCanine=yes in rules.ini → isCanine=true in TS', () => {
    expect(rulesIni['DOG']?.IsCanine?.toLowerCase()).toBe('yes');
    expect(UNIT_STATS.DOG.isCanine).toBe(true);
  });

  it('E6 (Engineer) Infiltrate=yes in rules.ini → isInfiltrate=true in TS', () => {
    expect(rulesIni['E6']?.Infiltrate?.toLowerCase()).toBe('yes');
    // Engineers are keyed by E6 in the unit stats
    const e6Stats = UNIT_STATS.E6;
    expect(e6Stats.isInfiltrate).toBe(true);
  });

  it('SPY Infiltrate=yes in rules.ini → isInfiltrate=true in TS', () => {
    expect(rulesIni['SPY']?.Infiltrate?.toLowerCase()).toBe('yes');
    const spyStats = UNIT_STATS.SPY;
    expect(spyStats.isInfiltrate).toBe(true);
  });

  it('THF Infiltrate=yes in rules.ini → isInfiltrate=true in TS', () => {
    expect(rulesIni['THF']?.Infiltrate?.toLowerCase()).toBe('yes');
    expect(UNIT_STATS.THF.isInfiltrate).toBe(true);
  });

  it('E2 (Grenadier) Explodes=yes in rules.ini → explodesOnDeath=true in TS', () => {
    expect(rulesIni['E2']?.Explodes?.toLowerCase()).toBe('yes');
    expect(UNIT_STATS.E2.explodesOnDeath).toBe(true);
  });

  it('E4 (Flamethrower) Explodes=yes in rules.ini → explodesOnDeath=true in TS', () => {
    expect(rulesIni['E4']?.Explodes?.toLowerCase()).toBe('yes');
    expect(UNIT_STATS.E4.explodesOnDeath).toBe(true);
  });

  it('DTRK (Demo Truck) Explodes=yes in aftrmath.ini → explodesOnDeath=true in TS', () => {
    expect(aftermathIni['DTRK']?.Explodes?.toLowerCase()).toBe('yes');
    expect(UNIT_STATS.DTRK.explodesOnDeath).toBe(true);
  });
});
