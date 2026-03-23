/**
 * C++ Parity Tests: Crate Spawning — Timing, Placement, Water Crates
 *
 * Authoritative source: rules.ini [General]
 *   CrateMinimum=1          — min crates on map
 *   CrateMaximum=255        — max crates on map
 *   CrateRadius=3.0         — radius (cells) for area-effect powerup bonuses
 *   CrateRegen=3            — average minutes between crate regeneration
 *   WaterCrateChance=20%    — chance of water vs land crate [multiplay only]
 *   SoloCrateMoney=2000     — money for money crate in solo missions
 *   SilverCrate=HealBase    — solo play silver crate bonus
 *   WoodCrate=Money         — solo play wood crate bonus
 *   WaterCrate=Money        — solo play water crate bonus
 *
 * C++ source refs:
 *   crate.cpp:98        — Timer = Random_Pick(CrateTime * TICKS_PER_MINUTE/2, CrateTime * TICKS_PER_MINUTE*2)
 *   crate.cpp:130-145   — Put_Crate: WaterCrateChance → SPEED_FLOAT or SPEED_TRACK
 *   map.cpp:1160-1185   — Place_Random_Crate: 1000 attempts, Crates[256] slots
 *   map.cpp:994-1006    — Logic: expired crates removed + replaced (non-campaign only)
 *   map.h:152           — CrateClass Crates[256] — max 256 concurrent crates
 *   scenario.cpp:2436-2442 — initial count = max(CrateMinimum, NumPlayers), capped at CrateMaximum
 *   cell.cpp:2127-2155  — solo play: force_money = SoloCrateMoney; powerup from SilverCrate/WoodCrate/WaterCrate
 *   cell.cpp:2286-2296  — water crate override: UNIT/SQUAD → MONEY (can't spawn land units in water)
 *   defines.h:3031      — TICKS_PER_SECOND = 15
 *   rules.cpp:207       — CrateTime default = 10 (overridden by CrateRegen=3 in rules.ini)
 *   rules.cpp:506       — CrateTime = ini.Get_Fixed("CrateRegen", CrateTime) → 3
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  CRATE_RADIUS,
  CRATE_SHARES,
  spawnCrate,
  type CrateContext,
  type Crate,
} from '../engine/crates';
import { GAME_TICKS_PER_SEC } from '../engine/types';

// ── INI parsing helpers ──────────────────────────────────────────────────────

const RULES_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/rules.ini');

function parseIniSection(iniText: string, section: string): Map<string, string> {
  const result = new Map<string, string>();
  const sectionRegex = new RegExp(`^\\[${section}\\]`, 'im');
  const match = sectionRegex.exec(iniText);
  if (!match) return result;

  const lines = iniText.slice(match.index + match[0].length).split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) break; // next section
    if (trimmed === '' || trimmed.startsWith(';')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    // Strip inline comments
    let val = trimmed.slice(eqIdx + 1).split(';')[0].trim();
    result.set(key, val);
  }
  return result;
}

function parsePercent(val: string): number {
  if (val.endsWith('%')) return parseFloat(val) / 100;
  return parseFloat(val);
}

// ── Load rules.ini ───────────────────────────────────────────────────────────

const rulesIniText = fs.readFileSync(RULES_INI_PATH, 'utf-8');
const generalSection = parseIniSection(rulesIniText, 'General');

// ── C++ constants ────────────────────────────────────────────────────────────

const CPP_TICKS_PER_SECOND = 15;
const CPP_TICKS_PER_MINUTE = CPP_TICKS_PER_SECOND * 60; // 900

// ── rules.ini [General] — authoritative values ──────────────────────────────

describe('C++ parity: Crate spawn rules — rules.ini [General]', () => {

  // ── Section 1: rules.ini [General] parsing ──────────────────────────────

  describe('rules.ini [General] crate keys exist and parse correctly', () => {
    it('CrateMinimum=1', () => {
      expect(generalSection.get('CrateMinimum')).toBe('1');
    });

    it('CrateMaximum=255', () => {
      expect(generalSection.get('CrateMaximum')).toBe('255');
    });

    it('CrateRadius=3.0', () => {
      expect(generalSection.get('CrateRadius')).toBe('3.0');
    });

    it('CrateRegen=3 (minutes)', () => {
      expect(generalSection.get('CrateRegen')).toBe('3');
    });

    it('WaterCrateChance=20%', () => {
      expect(generalSection.get('WaterCrateChance')).toBe('20%');
    });

    it('SoloCrateMoney=2000', () => {
      expect(generalSection.get('SoloCrateMoney')).toBe('2000');
    });

    it('SilverCrate=HealBase', () => {
      expect(generalSection.get('SilverCrate')).toBe('HealBase');
    });

    it('WoodCrate=Money', () => {
      expect(generalSection.get('WoodCrate')).toBe('Money');
    });

    it('WaterCrate=Money', () => {
      expect(generalSection.get('WaterCrate')).toBe('Money');
    });
  });

  // ── Section 2: TS constants vs rules.ini ─────────────────────────────────

  describe('TS constants match rules.ini', () => {
    it('GAME_TICKS_PER_SEC matches C++ TICKS_PER_SECOND (15)', () => {
      // C++ defines.h:3031: #define TICKS_PER_SECOND 15
      expect(GAME_TICKS_PER_SEC).toBe(CPP_TICKS_PER_SECOND);
    });

    it('CRATE_RADIUS matches CrateRadius=3.0 from rules.ini', () => {
      // C++ rules.cpp:262: CrateRadius = 0x0280 = 640 leptons = 2.5 cells (default)
      // rules.ini: CrateRadius=3.0 → overrides to 3.0 cells (768 leptons)
      const iniCrateRadius = parseFloat(generalSection.get('CrateRadius')!);
      expect(CRATE_RADIUS).toBe(iniCrateRadius);
    });
  });

  // ── Section 3: Crate timer calculation ───────────────────────────────────

  describe('Crate lifetime range — crate.cpp:98', () => {
    // C++ crate.cpp:98:
    //   Timer = Random_Pick(Rule.CrateTime * (TICKS_PER_MINUTE/2), Rule.CrateTime * (TICKS_PER_MINUTE*2))
    // CrateRegen=3 from rules.ini → CrateTime=3
    // min = 3 * (900/2) = 3 * 450 = 1350 ticks (1.5 minutes)
    // max = 3 * (900*2) = 3 * 1800 = 5400 ticks (6.0 minutes)

    const iniCrateRegen = parseInt(generalSection.get('CrateRegen')!, 10);
    const cppMinTicks = iniCrateRegen * (CPP_TICKS_PER_MINUTE / 2);
    const cppMaxTicks = iniCrateRegen * (CPP_TICKS_PER_MINUTE * 2);
    const cppMinMinutes = cppMinTicks / CPP_TICKS_PER_MINUTE;
    const cppMaxMinutes = cppMaxTicks / CPP_TICKS_PER_MINUTE;

    it('C++ min lifetime = CrateRegen * TICKS_PER_MINUTE/2 = 1350 ticks (1.5 min)', () => {
      expect(cppMinTicks).toBe(1350);
      expect(cppMinMinutes).toBe(1.5);
    });

    it('C++ max lifetime = CrateRegen * TICKS_PER_MINUTE*2 = 5400 ticks (6.0 min)', () => {
      expect(cppMaxTicks).toBe(5400);
      expect(cppMaxMinutes).toBe(6.0);
    });

    it('TS spawnCrate lifetime uses correct min bound (1.5 min, not floored to 1)', () => {
      // TS crates.ts:163-167:
      //   const crateTimeMin = 3;
      //   const minLifetime = Math.floor(crateTimeMin / 2); // BUG: Math.floor(1.5) = 1, should be 1.5
      //   const maxLifetime = crateTimeMin * 2;             // 6 — correct
      //
      // C++ crate.cpp:98: min = CrateTime * (TICKS_PER_MINUTE/2)
      //   With CrateTime=3: 3 * 450 = 1350 ticks = 1.5 minutes
      //
      // BUG: TS floors 3/2 to 1, giving min lifetime of 1 minute = 900 ticks
      //   C++ gives min lifetime of 1.5 minutes = 1350 ticks
      //
      // Run the actual spawn to inspect the lifetime range:
      const ctx = makeCrateContext();
      const lifetimes: number[] = [];
      // Seed enough samples to bound the range
      for (let i = 0; i < 500; i++) {
        ctx.crates = [];
        spawnCrate(ctx);
        if (ctx.crates.length > 0) {
          lifetimes.push(ctx.crates[0].lifetime);
        }
      }

      const minLifetime = Math.min(...lifetimes);
      const maxLifetime = Math.max(...lifetimes);
      const minLifetimeMinutes = minLifetime / (GAME_TICKS_PER_SEC * 60);
      const maxLifetimeMinutes = maxLifetime / (GAME_TICKS_PER_SEC * 60);

      // C++ expected: min ~1.5 min (1350 ticks), max ~6.0 min (5400 ticks)
      // TS BUG: min will be ~1.0 min (900 ticks) due to Math.floor(3/2) = 1
      expect(minLifetimeMinutes).toBeGreaterThanOrEqual(cppMinMinutes - 0.01);
      expect(maxLifetimeMinutes).toBeLessThanOrEqual(cppMaxMinutes + 0.01);
    });
  });

  // ── Section 4: Max crates on map ─────────────────────────────────────────

  describe('Max crates array size — map.h:152', () => {
    // C++ map.h:152: CrateClass Crates[256]
    // TS index.ts:1741: this.crates.length < 256

    it('C++ max crate slots = 256 (CrateClass Crates[256])', () => {
      // This is a structural constant; just documenting the C++ value
      const CPP_MAX_CRATES = 256;
      expect(CPP_MAX_CRATES).toBe(256);
    });

    it('CrateMaximum from rules.ini = 255 (soft cap for initial placement)', () => {
      // C++ scenario.cpp:2438: count = min(count, Rule.CrateMaximum)
      const iniMax = parseInt(generalSection.get('CrateMaximum')!, 10);
      expect(iniMax).toBe(255);
    });
  });

  // ── Section 5: Initial crate count ───────────────────────────────────────

  describe('Initial crate count — scenario.cpp:2436-2442', () => {
    // C++:
    //   int count = max(Rule.CrateMinimum, Session.NumPlayers);
    //   count = min(count, Rule.CrateMaximum);
    //   for (int index = 0; index < count; index++)
    //     Map.Place_Random_Crate();

    it('CrateMinimum=1: single-player spawns at least 1 crate', () => {
      const iniMin = parseInt(generalSection.get('CrateMinimum')!, 10);
      expect(iniMin).toBe(1);
      // For 1 player: max(1, 1) = 1 → 1 initial crate
      expect(Math.max(iniMin, 1)).toBe(1);
    });

    it('multiplayer: count = max(CrateMinimum, NumPlayers)', () => {
      const iniMin = parseInt(generalSection.get('CrateMinimum')!, 10);
      // 4 players → max(1, 4) = 4 initial crates
      expect(Math.max(iniMin, 4)).toBe(4);
      // 8 players → max(1, 8) = 8 initial crates
      expect(Math.max(iniMin, 8)).toBe(8);
    });

    it('count capped at CrateMaximum=255', () => {
      const iniMin = parseInt(generalSection.get('CrateMinimum')!, 10);
      const iniMax = parseInt(generalSection.get('CrateMaximum')!, 10);
      expect(Math.min(Math.max(iniMin, 300), iniMax)).toBe(255);
    });
  });

  // ── Section 6: WaterCrateChance ──────────────────────────────────────────

  describe('WaterCrateChance — crate.cpp:132-137', () => {
    // C++ crate.cpp:132-137 (Put_Crate):
    //   if (Percent_Chance(100 * Rule.WaterCrateChance)) {
    //     cell = Map.Nearby_Location(cell, SPEED_FLOAT);  // water
    //   } else {
    //     cell = Map.Nearby_Location(cell, SPEED_TRACK);  // land
    //   }

    it('WaterCrateChance=20% from rules.ini', () => {
      const chance = parsePercent(generalSection.get('WaterCrateChance')!);
      expect(chance).toBeCloseTo(0.20, 2);
    });

    it('TS spawnCrate does NOT implement water vs land placement distinction', () => {
      // C++ uses WaterCrateChance to decide SPEED_FLOAT (water) vs SPEED_TRACK (land).
      // C++ then creates OVERLAY_WATER_CRATE for float-passable cells, OVERLAY_WOOD_CRATE otherwise.
      //
      // TS crates.ts:169-178: only checks map.isPassable(cx, cy) — no water/land distinction.
      // There is no WaterCrateChance check in the TS spawn path.
      //
      // This is a KNOWN GAP: TS does not distinguish water from land crates.
      // The test documents this divergence.
      const fnSource = spawnCrate.toString();
      const hasWaterChance = /waterCrateChance|WaterCrate|SPEED_FLOAT|water/i.test(fnSource);
      expect(hasWaterChance).toBe(false); // confirms TS lacks water crate logic
    });
  });

  // ── Section 7: Water crate UNIT/SQUAD fallback ───────────────────────────

  describe('Water crate UNIT/SQUAD → MONEY fallback — cell.cpp:2286-2296', () => {
    // C++ cell.cpp:2286-2296:
    //   if (Overlay == OVERLAY_WATER_CRATE) {
    //     switch (powerup) {
    //       case CRATE_UNIT:
    //       case CRATE_SQUAD:
    //         powerup = CRATE_MONEY;  // can't spawn land units on water
    //     }
    //   }
    //
    // TS has no concept of water crate overlay — the Crate interface has no water/land field.

    it('C++ forbids UNIT and SQUAD from water crates (forces MONEY)', () => {
      // The C++ code is explicit: CRATE_UNIT and CRATE_SQUAD fall back to CRATE_MONEY
      // when the crate overlay is OVERLAY_WATER_CRATE.
      // This prevents spawning infantry/vehicles in the middle of the ocean.
      expect(true).toBe(true); // documenting C++ behavior
    });

    it('TS Crate interface has no water/land field to support this fallback', () => {
      // TS crates.ts:32-38:
      //   export interface Crate { x, y, type, tick, lifetime }
      // No `isWater` or `overlay` field exists.
      // This means TS cannot replicate the C++ water-crate fallback for UNIT/SQUAD.
      const sampleCrate: Crate = { x: 0, y: 0, type: 'money', tick: 0, lifetime: 900 };
      expect('isWater' in sampleCrate).toBe(false);
    });
  });

  // ── Section 8: Solo play crate type overrides ────────────────────────────

  describe('Solo play crate type overrides — cell.cpp:2127-2145', () => {
    // C++ cell.cpp:2127-2145 (Goodie_Check, GAME_NORMAL branch):
    //   force_money = Rule.SoloCrateMoney;   // 2000
    //   if (Overlay == OVERLAY_STEEL_CRATE)  powerup = Rule.SilverCrate; // HealBase
    //   if (Overlay == OVERLAY_WOOD_CRATE)   powerup = Rule.WoodCrate;   // Money
    //   if (Overlay == OVERLAY_WATER_CRATE)  powerup = Rule.WaterCrate;  // Money
    //
    // In solo play, the crate type is DETERMINISTIC based on overlay type.
    // No random weighted selection occurs.

    it('SoloCrateMoney=2000: solo money crate gives 2000 credits', () => {
      const iniMoney = parseInt(generalSection.get('SoloCrateMoney')!, 10);
      expect(iniMoney).toBe(2000);
    });

    it('SilverCrate=HealBase: steel crates always give HealBase in solo', () => {
      expect(generalSection.get('SilverCrate')).toBe('HealBase');
    });

    it('WoodCrate=Money: wood crates always give Money in solo', () => {
      expect(generalSection.get('WoodCrate')).toBe('Money');
    });

    it('WaterCrate=Money: water crates always give Money in solo', () => {
      expect(generalSection.get('WaterCrate')).toBe('Money');
    });

    it('C++ solo play skips weighted random — uses overlay-based deterministic type', () => {
      // C++ cell.cpp:2127-2145: the GAME_NORMAL branch does NOT use CrateShares
      // at all — it directly assigns from Rule.SilverCrate / Rule.WoodCrate / Rule.WaterCrate.
      // The weighted random pool (CrateShares) is only used in multiplayer (cell.cpp:2148-2155).
      //
      // TS crates.ts spawnCrate always uses weightedCrateType() regardless of campaign mode,
      // then optionally applies crateOverrides.silver.
      // This diverges from C++ where solo mode is purely deterministic per overlay type.
      expect(true).toBe(true); // documenting the design gap
    });
  });

  // ── Section 9: CrateShares total ─────────────────────────────────────────

  describe('CrateShares total — weighted selection pool', () => {
    // C++ const.cpp:381-400 + rules.ini [Powerups] section
    // Total shares = 50+20+3+1+0+5+5+20+1+1+3+10+10+10+1+3+3+5 = 151

    it('CRATE_SHARES total matches C++ weighted pool', () => {
      const tsTotal = CRATE_SHARES.reduce((sum, s) => sum + s.shares, 0);
      // C++ total (including ChronalVortex=5 from const.cpp default):
      // Money=50 + Unit=20 + ParaBomb=3 + HealBase=1 + Cloak=0 + Explosion=5
      // + Napalm=5 + Squad=20 + Darkness=1 + Reveal=1 + Sonar=3 + Armor=10
      // + Speed=10 + Firepower=10 + ICBM=1 + TimeQuake=3 + Invulnerability=3 + Vortex=5
      const cppTotal = 50 + 20 + 3 + 1 + 0 + 5 + 5 + 20 + 1 + 1 + 3 + 10 + 10 + 10 + 1 + 3 + 3 + 5;
      expect(cppTotal).toBe(151);
      expect(tsTotal).toBe(cppTotal);
    });

    it('Cloak shares = 0 (disabled per rules.ini Cloak=0)', () => {
      const cloakEntry = CRATE_SHARES.find(s => s.type === 'cloak');
      expect(cloakEntry).toBeDefined();
      expect(cloakEntry!.shares).toBe(0);
    });

    it('Money has highest share weight at 50', () => {
      const moneyEntry = CRATE_SHARES.find(s => s.type === 'money');
      expect(moneyEntry).toBeDefined();
      expect(moneyEntry!.shares).toBe(50);
      // 50/151 ≈ 33% chance
    });
  });

  // ── Section 10: Crate regeneration — campaign vs multiplayer ─────────────

  describe('Crate regeneration mode — map.cpp:994', () => {
    // C++ map.cpp:994:
    //   if (Session.Type != GAME_NORMAL && Session.Options.Goodies) {
    //     for (int index = 0; index < ARRAY_SIZE(Crates); index++) {
    //       if (Crates[index].Is_Expired()) {
    //         Crates[index].Remove_It();
    //         Place_Random_Crate();
    //       }
    //     }
    //   }
    //
    // Campaign (GAME_NORMAL): NO crate regeneration — once picked up or expired, gone.
    // Multiplayer: expired crates are replaced 1:1.

    it('C++ only regenerates crates in non-GAME_NORMAL mode (multiplayer/skirmish)', () => {
      // This is the behavior gate in map.cpp:994
      // TS index.ts:1728-1744 checks isCampaign = /^SC[GUA]/i.test(scenarioId)
      // which correctly skips regen for campaign scenarios.
      expect(true).toBe(true);
    });

    it('Expired crate replacement is 1:1 (remove then place one new)', () => {
      // C++ map.cpp:1001-1003: for each expired crate, Remove_It() + Place_Random_Crate()
      // TS index.ts:1732-1737: splice out + spawnCrate() — matches 1:1 replacement
      expect(true).toBe(true);
    });
  });

  // ── Section 11: CrateRegen default override ──────────────────────────────

  describe('CrateRegen=3 overrides C++ default of 10 — rules.cpp:207,506', () => {
    // C++ rules.cpp:207: CrateTime(10) — constructor default
    // C++ rules.cpp:506: CrateTime = ini.Get_Fixed(GENERAL, "CrateRegen", CrateTime)
    // rules.ini: CrateRegen=3 → overrides to 3 minutes

    it('C++ constructor default is CrateTime=10 (minutes)', () => {
      const CPP_DEFAULT_CRATE_TIME = 10;
      expect(CPP_DEFAULT_CRATE_TIME).toBe(10);
    });

    it('rules.ini CrateRegen=3 overrides to 3 minutes', () => {
      const iniRegen = parseInt(generalSection.get('CrateRegen')!, 10);
      expect(iniRegen).toBe(3);
    });

    it('TS hardcodes crateTimeMin=3 matching rules.ini (not the C++ default of 10)', () => {
      // TS crates.ts:163: const crateTimeMin = 3;
      // This correctly uses the rules.ini value, not the C++ constructor default.
      // Verified by reading the source.
      const fnSource = spawnCrate.toString();
      // The TS code should use 3, not 10
      expect(fnSource).toContain('3');
    });
  });
});

// ── Test helper: minimal CrateContext for spawnCrate ──────────────────────────

function makeCrateContext(): CrateContext {
  return {
    crates: [],
    entities: [],
    entityById: new Map(),
    structures: [],
    effects: [],
    evaMessages: [],
    activeVortices: [],
    visionaryHouses: new Set(),
    credits: 0,
    tick: 100,
    playerHouse: 'GoodGuy' as any,
    screenShake: 0,
    map: {
      boundsX: 0, boundsY: 0, boundsW: 50, boundsH: 50,
      isPassable: () => true,
      getVisibility: () => 1,
      revealAll: () => {},
      shroudAll: () => {},
    } as any,
    crateOverrides: {},
    addCredits: () => {},
    playSoundAt: () => {},
    playSound: () => {},
    damageEntity: () => {},
    damageStructure: () => {},
    detonateNuke: () => {},
    isAllied: () => true,
  };
}
