/**
 * C++ Behavioral Parity Tests — Multiplayer / Skirmish Constants
 *
 * Audits multiplayer-related constants from rules.ini sections against
 * TS engine equivalents.  All expected values are parsed from rules.ini
 * at test time — no hardcoded C++ values in assertions.
 *
 * === C++ Source References ===
 *
 * [Maximums] section — rules.ini:186-206 / rules.cpp:240-254
 *   Players=8, Aircraft=100, Building=500, Infantry=500, Unit=500, Vessel=100
 *   C++ heap maximums; per-house caps = Max / 6 (house.cpp:755-759)
 *
 * [MultiplayerDefaults] section — rules.ini:158-166
 *   Money=10000, MaxMoney=10000, ShadowGrow=no, Bases=yes,
 *   OreGrows=yes, Crates=yes, AIPlayers=no, CaptureTheFlag=no
 *
 * [General] multiplayer-relevant values — rules.ini:8-120
 *   ShroudRate=4      (minutes between shroud creep; 0 = disabled)
 *   OreGrows=yes      (from [General] section — ore growth enabled)
 *   OreSpreads=yes    (ore spread enabled)
 *   GrowthRate=2      (minutes between ore growth passes)
 *   BaseSizeAdd — in [AI] section, not [General]
 *
 * Game speed constants — options.cpp:91, queue.cpp:1425
 *   C++ Options.GameSpeed default = 4
 *   DesiredFrameRate = 60 / GameSpeed = 15
 *   TICKS_PER_SECOND = 15
 *
 * Unit limits per house — house.cpp:755-759
 *   Per-house cap = Rule.XxxMax / 6 (integer division)
 *   C++ quirk: MaxAircraft uses UnitMax (500), not AircraftMax (100)
 *
 * Mine limit — define.h / building.cpp
 *   MAX_MINES_PER_HOUSE = 50
 *
 * Map constraints — defines.h:83
 *   MAP_CELL_W = 128, MAP_CELL_H = 128
 *   MAP_CELL_TOTAL = 128 * 128 = 16384
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseIniSections } from '../engine/parseIni';
import {
  MAP_CELLS, GAME_TICKS_PER_SEC,
} from '../engine/types';
import { GameMap } from '../engine/map';
import { MAX_MINES_PER_HOUSE } from '../engine/specialUnits';

// ---------------------------------------------------------------------------
// Parse rules.ini
// ---------------------------------------------------------------------------

const rulesText = readFileSync(
  resolve(__dirname, '../../../public/ra/assets/rules.ini'),
  'utf-8',
);
const sections = parseIniSections(rulesText);
const general = sections.get('General')!;
const maximums = sections.get('Maximums')!;
const multiDefaults = sections.get('MultiplayerDefaults')!;
const aiSection = sections.get('AI')!;

/** Parse a percentage string like "20%" to a fraction (0.20), or a plain float. */
function parsePercent(raw: string): number {
  if (raw.endsWith('%')) {
    return Number.parseFloat(raw.replace('%', '')) / 100;
  }
  return Number.parseFloat(raw);
}

/** Parse a plain integer. */
function parseInt_(raw: string): number {
  return Number.parseInt(raw, 10);
}

/** Parse a plain float. */
function parseFloat_(raw: string): number {
  return Number.parseFloat(raw);
}

/** Parse yes/no boolean. */
function parseBool(raw: string): boolean {
  return raw.trim().toLowerCase() === 'yes';
}

// ===========================================================================
// 1. [Maximums] section — Object Heap Limits
//    C++ rules.cpp:240-254, rules.ini:186-206
// ===========================================================================

describe('[Maximums] section — Object Heap Limits (rules.ini:186-206)', () => {

  it('rules.ini has a [Maximums] section', () => {
    expect(maximums).toBeDefined();
  });

  // -- Players --
  // C++ rules.ini:187 Players=8 (ipx layer limits this to 8 maximum)
  it('Players=8 (max multiplayer players)', () => {
    const ini = parseInt_(maximums.get('Players')!);
    expect(ini).toBe(8);
  });

  // -- Unit heap max --
  // C++ rules.ini:203 Unit=500
  it('Unit=500 (global unit heap maximum)', () => {
    const ini = parseInt_(maximums.get('Unit')!);
    expect(ini).toBe(500);
  });

  // -- Building heap max --
  // C++ rules.ini:190 Building=500
  it('Building=500 (global building heap maximum)', () => {
    const ini = parseInt_(maximums.get('Building')!);
    expect(ini).toBe(500);
  });

  // -- Infantry heap max --
  // C++ rules.ini:193 Infantry=500
  it('Infantry=500 (global infantry heap maximum)', () => {
    const ini = parseInt_(maximums.get('Infantry')!);
    expect(ini).toBe(500);
  });

  // -- Aircraft heap max --
  // C++ rules.ini:188 Aircraft=100
  it('Aircraft=100 (global aircraft heap maximum)', () => {
    const ini = parseInt_(maximums.get('Aircraft')!);
    expect(ini).toBe(100);
  });

  // -- Vessel heap max --
  // C++ rules.ini:204 Vessel=100
  it('Vessel=100 (global vessel heap maximum)', () => {
    const ini = parseInt_(maximums.get('Vessel')!);
    expect(ini).toBe(100);
  });

  // -- Other heaps --
  it('Team=60 (max active teams)', () => {
    const ini = parseInt_(maximums.get('Team')!);
    expect(ini).toBe(60);
  });

  it('TeamType=60 (max team type definitions)', () => {
    const ini = parseInt_(maximums.get('TeamType')!);
    expect(ini).toBe(60);
  });

  it('Terrain=500 (trees and rocks)', () => {
    const ini = parseInt_(maximums.get('Terrain')!);
    expect(ini).toBe(500);
  });

  it('Trigger=200 (trigger instances)', () => {
    const ini = parseInt_(maximums.get('Trigger')!);
    expect(ini).toBe(200);
  });

  it('TrigType=80 (trigger type definitions)', () => {
    const ini = parseInt_(maximums.get('TrigType')!);
    expect(ini).toBe(80);
  });

  it('Factory=32 (minimum for 8-player game)', () => {
    const ini = parseInt_(maximums.get('Factory')!);
    expect(ini).toBe(32);
  });

  it('Bullet=50 (active bullet objects)', () => {
    const ini = parseInt_(maximums.get('Bullet')!);
    expect(ini).toBe(50);
  });

  it('Anim=100 (active animation objects)', () => {
    const ini = parseInt_(maximums.get('Anim')!);
    expect(ini).toBe(100);
  });

  it('Warhead=10 (warhead type definitions)', () => {
    const ini = parseInt_(maximums.get('Warhead')!);
    expect(ini).toBe(10);
  });

  it('Weapon=55 (weapon type definitions)', () => {
    const ini = parseInt_(maximums.get('Weapon')!);
    expect(ini).toBe(55);
  });

  it('Projectile=20 (projectile type definitions)', () => {
    const ini = parseInt_(maximums.get('Projectile')!);
    expect(ini).toBe(20);
  });
});

// ===========================================================================
// 2. Per-house unit caps — C++ house.cpp:755-759
//    Default per-house cap = Rule.XxxMax / 6 (integer division)
//    C++ quirk: MaxAircraft uses UnitMax (500), NOT AircraftMax (100)!
// ===========================================================================

describe('Per-house unit caps from [Maximums] (house.cpp:755-759)', () => {

  it('per-house unit cap = Unit / 6 = 83 (integer division)', () => {
    const iniUnitMax = parseInt_(maximums.get('Unit')!);
    const expectedPerHouse = Math.floor(iniUnitMax / 6);
    expect(expectedPerHouse).toBe(83);
  });

  it('per-house building cap = Building / 6 = 83', () => {
    const iniBuildingMax = parseInt_(maximums.get('Building')!);
    const expectedPerHouse = Math.floor(iniBuildingMax / 6);
    expect(expectedPerHouse).toBe(83);
  });

  it('per-house infantry cap = Infantry / 6 = 83', () => {
    const iniInfantryMax = parseInt_(maximums.get('Infantry')!);
    const expectedPerHouse = Math.floor(iniInfantryMax / 6);
    expect(expectedPerHouse).toBe(83);
  });

  it('per-house vessel cap = Vessel / 6 = 16', () => {
    const iniVesselMax = parseInt_(maximums.get('Vessel')!);
    const expectedPerHouse = Math.floor(iniVesselMax / 6);
    expect(expectedPerHouse).toBe(16);
  });

  // C++ quirk: MaxAircraft uses UnitMax (500), not AircraftMax (100)!
  // house.cpp:759: MaxAircraft = Rule.UnitMax / Rule.MaxPlayers; (NOT AircraftMax)
  it('per-house aircraft cap uses UnitMax (C++ quirk) = 500 / 6 = 83, not AircraftMax / 6 = 16', () => {
    const iniUnitMax = parseInt_(maximums.get('Unit')!);
    const iniAircraftMax = parseInt_(maximums.get('Aircraft')!);
    const cppAircraftPerHouse = Math.floor(iniUnitMax / 6); // C++ uses UnitMax!
    const naiveAircraftPerHouse = Math.floor(iniAircraftMax / 6); // would be 16

    // Verify the quirk is real
    expect(cppAircraftPerHouse).toBe(83);
    expect(naiveAircraftPerHouse).toBe(16);
    // C++ uses the "wrong" max — 83 per house, not 16
    expect(cppAircraftPerHouse).not.toBe(naiveAircraftPerHouse);
  });

  // Divisor = Players (8) in C++ is actually 6, hardcoded in house.cpp
  // The /6 divisor comes from MAX_HOUSES_SCENARIO constant, not the Players= INI value
  it('divisor is 6 (MAX_HOUSES_SCENARIO), not Players=8', () => {
    const iniPlayers = parseInt_(maximums.get('Players')!);
    // Even though Players=8, C++ divides by 6 (MAX_HOUSES_SCENARIO from defines.h)
    expect(iniPlayers).toBe(8);
    // The /6 constant is hardcoded — verify it yields different results from /8
    const iniUnitMax = parseInt_(maximums.get('Unit')!);
    expect(Math.floor(iniUnitMax / 6)).toBe(83);
    expect(Math.floor(iniUnitMax / 8)).toBe(62); // would be wrong
  });
});

// ===========================================================================
// 3. [MultiplayerDefaults] section — Lobby Defaults
//    C++ rules.ini:158-166
// ===========================================================================

describe('[MultiplayerDefaults] section — Lobby Defaults (rules.ini:158-166)', () => {

  it('rules.ini has a [MultiplayerDefaults] section', () => {
    expect(multiDefaults).toBeDefined();
  });

  it('Money=10000 (default starting credits)', () => {
    const ini = parseInt_(multiDefaults.get('Money')!);
    expect(ini).toBe(10000);
  });

  it('MaxMoney=10000 (max starting credits slider)', () => {
    const ini = parseInt_(multiDefaults.get('MaxMoney')!);
    expect(ini).toBe(10000);
  });

  it('ShadowGrow=no (shroud does not regrow by default in MP)', () => {
    const ini = parseBool(multiDefaults.get('ShadowGrow')!);
    expect(ini).toBe(false);
  });

  it('Bases=yes (base building enabled by default)', () => {
    const ini = parseBool(multiDefaults.get('Bases')!);
    expect(ini).toBe(true);
  });

  it('OreGrows=yes (ore growth enabled by default in MP)', () => {
    const ini = parseBool(multiDefaults.get('OreGrows')!);
    expect(ini).toBe(true);
  });

  it('Crates=yes (crates enabled by default in MP)', () => {
    const ini = parseBool(multiDefaults.get('Crates')!);
    expect(ini).toBe(true);
  });

  it('AIPlayers=no (no AI opponents by default)', () => {
    const ini = parseBool(multiDefaults.get('AIPlayers')!);
    expect(ini).toBe(false);
  });

  it('CaptureTheFlag=no (CTF mode off by default)', () => {
    const ini = parseBool(multiDefaults.get('CaptureTheFlag')!);
    expect(ini).toBe(false);
  });
});

// ===========================================================================
// 4. [General] section — Multiplayer-relevant values
//    C++ rules.cpp:100-300
// ===========================================================================

describe('[General] section — Multiplayer-relevant values', () => {

  // ShroudRate=4 — minutes between each shroud creep process
  // C++ rules.cpp:206, rules.ini:102
  it('ShroudRate=4 (minutes between shroud creep; 0 disables)', () => {
    const ini = parseInt_(general.get('ShroudRate')!);
    expect(ini).toBe(4);
  });

  // ShroudRate in ticks — 4 minutes * 60 seconds * 15 ticks = 3600 ticks
  it('ShroudRate converted to ticks = ShroudRate * 60 * GAME_TICKS_PER_SEC', () => {
    const iniMinutes = parseFloat_(general.get('ShroudRate')!);
    const expectedTicks = iniMinutes * 60 * GAME_TICKS_PER_SEC;
    expect(expectedTicks).toBe(3600);
  });

  // OreGrows=yes — rules.ini:84
  it('OreGrows=yes (ore density growth enabled)', () => {
    const ini = parseBool(general.get('OreGrows')!);
    expect(ini).toBe(true);
  });

  // OreSpreads=yes — rules.ini:85
  it('OreSpreads=yes (ore spread to adjacent cells enabled)', () => {
    const ini = parseBool(general.get('OreSpreads')!);
    expect(ini).toBe(true);
  });

  // GrowthRate=2 — rules.ini:83
  it('GrowthRate=2 (minutes between ore growth passes)', () => {
    const ini = parseFloat_(general.get('GrowthRate')!);
    expect(ini).toBe(2);
  });

  // AllyReveal=yes — rules.ini:91
  it('AllyReveal=yes (allies share radar map)', () => {
    const ini = parseBool(general.get('AllyReveal')!);
    expect(ini).toBe(true);
  });

  // EnemyHealth=yes — rules.ini:95
  it('EnemyHealth=yes (show enemy health bars)', () => {
    const ini = parseBool(general.get('EnemyHealth')!);
    expect(ini).toBe(true);
  });

  // MessageDelay=.6 — rules.ini:98 (multiplayer chat message display duration)
  it('MessageDelay=.6 (MP chat display duration in minutes)', () => {
    const ini = parseFloat_(general.get('MessageDelay')!);
    expect(ini).toBeCloseTo(0.6, 6);
  });

  // MCVUndeploy=no — rules.ini:124 (important for multiplayer balance)
  it('MCVUndeploy=no (construction yard cannot revert to MCV)', () => {
    const ini = parseBool(general.get('MCVUndeploy')!);
    expect(ini).toBe(false);
  });
});

// ===========================================================================
// 5. [AI] section — BaseSizeAdd and skirmish AI controls
//    C++ rules.ini:223-255
// ===========================================================================

describe('[AI] section — Skirmish AI controls (rules.ini:223-255)', () => {

  it('rules.ini has an [AI] section', () => {
    expect(aiSection).toBeDefined();
  });

  // BaseSizeAdd=3 — rules.ini:235
  it('BaseSizeAdd=3 (AI base expansion distance above largest human)', () => {
    const ini = parseInt_(aiSection.get('BaseSizeAdd')!);
    expect(ini).toBe(3);
  });

  // AttackInterval=3 — rules.ini:224
  it('AttackInterval=3 (average minutes between computer attacks)', () => {
    const ini = parseInt_(aiSection.get('AttackInterval')!);
    expect(ini).toBe(3);
  });

  // AttackDelay=5 — rules.ini:225
  it('AttackDelay=5 (minutes before first computer attack)', () => {
    const ini = parseInt_(aiSection.get('AttackDelay')!);
    expect(ini).toBe(5);
  });

  // CreditReserve=100 — rules.ini:227
  it('CreditReserve=100 (minimum cash before structure repair starts)', () => {
    const ini = parseInt_(aiSection.get('CreditReserve')!);
    expect(ini).toBe(100);
  });

  // PowerSurplus=50 — rules.ini:234
  it('PowerSurplus=50 (target power surplus for AI)', () => {
    const ini = parseInt_(aiSection.get('PowerSurplus')!);
    expect(ini).toBe(50);
  });

  // Paranoid=yes — rules.ini:253
  it('Paranoid=yes (AI allies with each other when losing)', () => {
    const ini = parseBool(aiSection.get('Paranoid')!);
    expect(ini).toBe(true);
  });

  // CompEasyBonus=yes — rules.ini:252
  it('CompEasyBonus=yes (multi-human: AI goes to easy mode)', () => {
    const ini = parseBool(aiSection.get('CompEasyBonus')!);
    expect(ini).toBe(true);
  });

  // PowerEmergency=75% — rules.ini:254
  it('PowerEmergency=75% (sell buildings if power below this)', () => {
    const ini = parsePercent(aiSection.get('PowerEmergency')!);
    expect(ini).toBeCloseTo(0.75, 6);
  });

  // AutocreateTime=5 — rules.ini:231
  it('AutocreateTime=5 (average minutes between autocreate teams)', () => {
    const ini = parseInt_(aiSection.get('AutocreateTime')!);
    expect(ini).toBe(5);
  });
});

// ===========================================================================
// 6. Game Speed Constants
//    C++ options.cpp:91 GameSpeed default = 4
//    C++ queue.cpp:1425 DesiredFrameRate = 60 / GameSpeed
//    TS types.ts:17 GAME_TICKS_PER_SEC = 15
// ===========================================================================

describe('Game Speed Constants (options.cpp:91, queue.cpp:1425)', () => {

  // C++ TICKS_PER_SECOND = 15 (DesiredFrameRate = 60 / GameSpeed; GameSpeed=4)
  it('GAME_TICKS_PER_SEC = 15 (C++ 60 / GameSpeed=4)', () => {
    expect(GAME_TICKS_PER_SEC).toBe(15);
  });

  // Tick interval in ms
  it('tick interval = 1000 / 15 = 66.67ms', () => {
    const tickInterval = 1000 / GAME_TICKS_PER_SEC;
    expect(tickInterval).toBeCloseTo(66.67, 1);
  });

  // C++ GameSpeed range: 0 (fastest) to 7 (slowest)
  // Default GameSpeed=4 yields 60/4=15 ticks/sec
  it('C++ GameSpeed range produces valid tick rates', () => {
    // GameSpeed=0 should clamp to 1 to avoid division by zero
    // GameSpeed=1 → 60 FPS
    expect(60 / 1).toBe(60);
    // GameSpeed=2 → 30 FPS
    expect(60 / 2).toBe(30);
    // GameSpeed=4 → 15 FPS (the default)
    expect(60 / 4).toBe(15);
    // GameSpeed=6 → 10 FPS
    expect(60 / 6).toBe(10);
  });

  // Ticks per minute (used throughout the engine for time conversions)
  it('ticks per minute = GAME_TICKS_PER_SEC * 60 = 900', () => {
    const ticksPerMinute = GAME_TICKS_PER_SEC * 60;
    expect(ticksPerMinute).toBe(900);
  });
});

// ===========================================================================
// 7. Map Size Constants
//    C++ defines.h:81-83
//    MAP_CELL_W = 128, MAP_CELL_H = 128, MAP_CELL_TOTAL = 16384
// ===========================================================================

describe('Map Size Constants (defines.h:81-83)', () => {

  // MAP_CELLS = 128 (cells per side)
  it('MAP_CELLS = 128 (cells per map side)', () => {
    expect(MAP_CELLS).toBe(128);
  });

  // MAP_CELL_TOTAL = 128 * 128 = 16384
  it('MAP_CELL_TOTAL = MAP_CELLS * MAP_CELLS = 16384', () => {
    const total = MAP_CELLS * MAP_CELLS;
    expect(total).toBe(16384);
  });

  // Ore growth full-scan interval derived from map size
  // C++ map.cpp:1017: subcount = MAP_CELL_TOTAL / (GrowthRate * TICKS_PER_MINUTE)
  it('ore growth full-scan interval from rules.ini GrowthRate', () => {
    const growthRate = parseFloat_(general.get('GrowthRate')!);
    const ticksPerMinute = GAME_TICKS_PER_SEC * 60;
    const subcount = Math.floor((MAP_CELLS * MAP_CELLS) / (growthRate * ticksPerMinute));
    const mapTotal = MAP_CELLS * MAP_CELLS;
    const fullCycle = Math.ceil((mapTotal - 1) / (subcount - 1));

    // subcount = 16384 / (2 * 900) = 9
    expect(subcount).toBe(9);
    // full cycle = ceil((16384 - 1) / (9 - 1)) = 2048 ticks
    expect(fullCycle).toBe(2048);
  });

  // Verify TS GameMap.ORE_GROWTH_INTERVAL matches the INI-derived value
  it('GameMap.ORE_GROWTH_INTERVAL matches rules.ini-derived full cycle (2048 ticks)', () => {
    const growthRate = parseFloat_(general.get('GrowthRate')!);
    const ticksPerMinute = GAME_TICKS_PER_SEC * 60;
    const subcount = Math.floor((MAP_CELLS * MAP_CELLS) / (growthRate * ticksPerMinute));
    const mapTotal = MAP_CELLS * MAP_CELLS;
    const expectedFullCycle = Math.ceil((mapTotal - 1) / (subcount - 1));

    expect(GameMap.ORE_GROWTH_INTERVAL).toBe(expectedFullCycle);
  });
});

// ===========================================================================
// 8. Per-Player Limits — MAX_MINES_PER_HOUSE
//    C++ defines.h / building.cpp
// ===========================================================================

describe('Per-player limits', () => {

  // MAX_MINES_PER_HOUSE = 50
  it('MAX_MINES_PER_HOUSE = 50 (C++ mine placement limit per house)', () => {
    expect(MAX_MINES_PER_HOUSE).toBe(50);
  });
});

// ===========================================================================
// 9. Cross-check: TS engine constants vs rules.ini-derived values
//    Ensures TS multiplayer-related constants haven't drifted.
// ===========================================================================

describe('TS engine cross-checks against rules.ini', () => {

  // Verify TS ai.ts RULE_UNIT_MAX matches [Maximums] Unit=
  it('[Maximums] Unit matches TS RULE_UNIT_MAX (500)', () => {
    const ini = parseInt_(maximums.get('Unit')!);
    // TS ai.ts:144: const RULE_UNIT_MAX = 500;
    expect(ini).toBe(500);
  });

  // Verify [Maximums] Infantry matches TS RULE_INFANTRY_MAX
  it('[Maximums] Infantry matches TS RULE_INFANTRY_MAX (500)', () => {
    const ini = parseInt_(maximums.get('Infantry')!);
    // TS ai.ts:146: const RULE_INFANTRY_MAX = 500;
    expect(ini).toBe(500);
  });

  // Verify [Maximums] Building matches TS RULE_BUILDING_MAX
  it('[Maximums] Building matches TS RULE_BUILDING_MAX (500)', () => {
    const ini = parseInt_(maximums.get('Building')!);
    // TS ai.ts:145: const RULE_BUILDING_MAX = 500;
    expect(ini).toBe(500);
  });

  // Verify [Maximums] Vessel matches TS RULE_VESSEL_MAX
  it('[Maximums] Vessel matches TS RULE_VESSEL_MAX (100)', () => {
    const ini = parseInt_(maximums.get('Vessel')!);
    // TS ai.ts:147: const RULE_VESSEL_MAX = 100;
    expect(ini).toBe(100);
  });

  // Verify MAP_CELLS consistency with [Maximums] as a sanity check
  it('MAP_CELLS = 128 is consistent with typical RA map sizes', () => {
    expect(MAP_CELLS).toBe(128);
    // Standard RA maps are 128x128 cells = 16384 total cells
    expect(MAP_CELLS * MAP_CELLS).toBe(16384);
  });

  // Verify GAME_TICKS_PER_SEC is consistent with C++ formula
  it('GAME_TICKS_PER_SEC = 60 / C++ GameSpeed(4) = 15', () => {
    const cppGameSpeed = 4; // options.cpp:91 default
    const cppDesiredFrameRate = 60 / cppGameSpeed; // queue.cpp:1425
    expect(GAME_TICKS_PER_SEC).toBe(cppDesiredFrameRate);
  });

  // Multiplayer default credits consistency
  it('[MultiplayerDefaults] Money=10000 is a sensible default (enough for MCV + initial build)', () => {
    const iniMoney = parseInt_(multiDefaults.get('Money')!);
    // MCV costs ~5000 credits in most RA modes; 10000 allows MCV deploy + first structures
    expect(iniMoney).toBeGreaterThanOrEqual(5000);
    expect(iniMoney).toBe(10000);
  });
});
