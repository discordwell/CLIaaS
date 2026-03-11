/**
 * Scenario Parity Verification
 *
 * Validates that parseScenarioINI() correctly reads all scenario INI files
 * and that parsed data is structurally valid and internally consistent.
 * Compares parsed output against raw INI comma-split values.
 *
 * Covers all 60 scenarios: 4 ant, 21 Allied, 19 Soviet, 16 Counterstrike.
 *
 * This test is the permanent source of truth for scenario parsing correctness.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { parseScenarioINI, STRUCTURE_MAX_HP } from '../engine/scenario';
import { UNIT_STATS, MAP_CELLS } from '../engine/types';

// ---------------------------------------------------------------------------
// INI Parser (inline — same pattern as ini-parity.test.ts)
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

// ---------------------------------------------------------------------------
// Setup: discover and parse all scenario INI files
// ---------------------------------------------------------------------------

const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');
const SCENARIO_IDS = readdirSync(assetsDir)
  .filter(f => /^SC[AGUC]\d+E[AB]\.ini$/i.test(f))
  .map(f => f.replace('.ini', ''))
  .sort();

const scenarios = SCENARIO_IDS.map(id => {
  const text = readFileSync(join(assetsDir, `${id}.ini`), 'utf-8');
  return { id, raw: parseINI(text), parsed: parseScenarioINI(text) };
});

// All C++ team mission types (TMISSION_* from TEAMTYPE.H)
const VALID_TMISSIONS = new Set([
  0,  // ATTACK
  1,  // ATT_WAYPT
  2,  // CHANGE_FORMATION
  3,  // MOVE
  // 4 = MOVECELL (not used in shipped scenarios)
  5,  // GUARD
  6,  // LOOP
  // 7 = ATTACKTARCOM (not used in shipped scenarios)
  8,  // UNLOAD
  9,  // DEPLOY
  10, // HOUND_DOG
  11, // DO
  12, // SET_GLOBAL
  13, // IDLE
  14, // LOAD
  15, // SPY
  16, // PATROL
]);

// Maximum valid cell index (128×128 map)
const MAX_CELL = MAP_CELLS * MAP_CELLS - 1;

// Unit/infantry types not yet implemented in the TS engine (campaign-only)
const EXEMPT_UNIT_TYPES = new Set([
  'MGG',  // Mobile Gap Generator
  'MRJ',  // Mobile Radar Jammer
]);

// Aircraft/ship types used in team compositions but not in UNIT_STATS
// (TS engine handles aircraft/ships separately or not yet)
const EXEMPT_TEAM_MEMBER_TYPES = new Set([
  'BADR', // Soviet bomber (aircraft)
  'U2',   // Spy plane (aircraft)
  'MGG',  // Mobile Gap Generator
  'MRJ',  // Mobile Radar Jammer
  'DD',   // Destroyer (ship)
  'CA',   // Cruiser (ship)
  'SS',   // Submarine (ship)
  'PT',   // Patrol boat (ship)
  'LST',  // Landing craft (ship)
  'MSUB', // Missile sub (ship)
]);

// ---------------------------------------------------------------------------
// 1. Trigger Field Parsing — compare all 18 parsed fields against raw INI
// ---------------------------------------------------------------------------

describe('Scenario Parity: Trigger Field Parsing', () => {
  for (const { id, raw, parsed } of scenarios) {
    const rawTrigs = raw['Trigs'] ?? {};

    // Build name→value lookup from raw INI (avoids JS object integer-key reordering)
    const parsedByName = new Map(parsed.triggers.map(t => [t.name, t]));

    describe(id, () => {
      for (const [name, rawValue] of Object.entries(rawTrigs)) {
        it(`${name}: 18 fields match raw INI`, () => {
          const f = rawValue.split(',').map(s => parseInt(s.trim()));
          expect(f.length, `${name} should have 18 comma fields`).toBeGreaterThanOrEqual(18);

          const t = parsedByName.get(name);
          expect(t, `parsed trigger "${name}" exists`).toBeDefined();
          expect(t!.name, 'name').toBe(name);
          expect(t!.persistence, 'f[0] persistence').toBe(f[0]);
          expect(t!.house, 'f[1] house').toBe(f[1]);
          expect(t!.eventControl, 'f[2] eventControl').toBe(f[2]);
          expect(t!.actionControl, 'f[3] actionControl').toBe(f[3]);
          expect(t!.event1.type, 'f[4] event1.type').toBe(f[4]);
          expect(t!.event1.team, 'f[5] event1.team').toBe(f[5]);
          expect(t!.event1.data, 'f[6] event1.data').toBe(f[6]);
          expect(t!.event2.type, 'f[7] event2.type').toBe(f[7]);
          expect(t!.event2.team, 'f[8] event2.team').toBe(f[8]);
          expect(t!.event2.data, 'f[9] event2.data').toBe(f[9]);
          expect(t!.action1.action, 'f[10] action1.action').toBe(f[10]);
          expect(t!.action1.team, 'f[11] action1.team').toBe(f[11]);
          expect(t!.action1.trigger, 'f[12] action1.trigger').toBe(f[12]);
          expect(t!.action1.data, 'f[13] action1.data').toBe(f[13]);
          expect(t!.action2.action, 'f[14] action2.action').toBe(f[14]);
          expect(t!.action2.team, 'f[15] action2.team').toBe(f[15]);
          expect(t!.action2.trigger, 'f[16] action2.trigger').toBe(f[16]);
          expect(t!.action2.data, 'f[17] action2.data').toBe(f[17]);
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Scenario Parsing Parity — counts and values match raw INI
// ---------------------------------------------------------------------------

describe('Scenario Parity: Parsing', () => {
  for (const { id, raw, parsed } of scenarios) {
    describe(id, () => {
      it('map bounds', () => {
        expect(parsed.mapBounds.x).toBe(parseInt(raw['Map']?.X ?? '0'));
        expect(parsed.mapBounds.y).toBe(parseInt(raw['Map']?.Y ?? '0'));
        expect(parsed.mapBounds.w).toBe(parseInt(raw['Map']?.Width ?? '50'));
        expect(parsed.mapBounds.h).toBe(parseInt(raw['Map']?.Height ?? '50'));
      });

      it('waypoint count and values', () => {
        const rawWps = raw['Waypoints'] ?? {};
        const rawWpCount = Object.keys(rawWps).length;
        expect(parsed.waypoints.size, 'waypoint count').toBe(rawWpCount);

        for (const [key, value] of Object.entries(rawWps)) {
          const wpIdx = parseInt(key);
          const cellIdx = parseInt(value);
          const pos = parsed.waypoints.get(wpIdx);
          expect(pos, `waypoint ${wpIdx} exists`).toBeDefined();
          expect(pos!.cx, `waypoint ${wpIdx} cx`).toBe(cellIdx % MAP_CELLS);
          expect(pos!.cy, `waypoint ${wpIdx} cy`).toBe(Math.floor(cellIdx / MAP_CELLS));
        }
      });

      it('unit count', () => {
        const rawUnitCount = Object.keys(raw['UNITS'] ?? {}).length;
        const rawShipCount = Object.keys(raw['SHIPS'] ?? {}).length;
        expect(parsed.units.length).toBe(rawUnitCount + rawShipCount);
      });

      it('infantry count', () => {
        expect(parsed.infantry.length).toBe(Object.keys(raw['INFANTRY'] ?? {}).length);
      });

      it('structure count', () => {
        expect(parsed.structures.length).toBe(Object.keys(raw['STRUCTURES'] ?? {}).length);
      });

      it('trigger count', () => {
        expect(parsed.triggers.length).toBe(Object.keys(raw['Trigs'] ?? {}).length);
      });

      it('cellTrigger count', () => {
        expect(parsed.cellTriggers.size).toBe(Object.keys(raw['CellTriggers'] ?? {}).length);
      });

      it('team count with member/mission sub-counts', () => {
        const rawTeams = raw['TeamTypes'] ?? {};
        const teamEntries = Object.entries(rawTeams);
        expect(parsed.teamTypes.length, 'team count').toBe(teamEntries.length);

        for (let i = 0; i < teamEntries.length; i++) {
          const [name, value] = teamEntries[i];
          const parts = value.split(',');
          const classCount = parseInt(parts[7]);
          const missionCountIdx = 8 + classCount;
          const missionCount = parseInt(parts[missionCountIdx]) || 0;

          const team = parsed.teamTypes[i];
          expect(team.name, `team[${i}] name`).toBe(name);
          expect(team.members.length, `${name} member count`).toBe(classCount);
          expect(team.missions.length, `${name} mission count`).toBe(missionCount);
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Trigger Structural Validation — ranges and refs
// ---------------------------------------------------------------------------

describe('Scenario Parity: Trigger Structural Validation', () => {
  for (const { id, parsed } of scenarios) {
    describe(id, () => {
      for (const t of parsed.triggers) {
        it(`${t.name}: valid ranges and refs`, () => {
          // Persistence: 0=volatile, 1=semi, 2=persistent
          expect(t.persistence, 'persistence ∈ [0..2]').toBeGreaterThanOrEqual(0);
          expect(t.persistence).toBeLessThanOrEqual(2);

          // Event control: 0=only, 1=and, 2=or, 3=linked (C++ TEventControl)
          expect(t.eventControl, 'eventControl ∈ [0..3]').toBeGreaterThanOrEqual(0);
          expect(t.eventControl).toBeLessThanOrEqual(3);

          // Action control: 0=only, 1=and
          expect(t.actionControl, 'actionControl ∈ [0..1]').toBeGreaterThanOrEqual(0);
          expect(t.actionControl).toBeLessThanOrEqual(1);

          // Event types [0..32] (TEVENT_NONE..TEVENT_BUILDING_EXISTS)
          expect(t.event1.type, 'event1.type').toBeGreaterThanOrEqual(0);
          expect(t.event1.type).toBeLessThanOrEqual(32);
          expect(t.event2.type, 'event2.type').toBeGreaterThanOrEqual(0);
          expect(t.event2.type).toBeLessThanOrEqual(32);

          // Action types [0..36] (TACTION_NONE..TACTION_LAUNCH_NUKES)
          expect(t.action1.action, 'action1.action').toBeGreaterThanOrEqual(0);
          expect(t.action1.action).toBeLessThanOrEqual(36);
          expect(t.action2.action, 'action2.action').toBeGreaterThanOrEqual(0);
          expect(t.action2.action).toBeLessThanOrEqual(36);

          // Team refs: if >= 0, must be valid index
          if (t.action1.team >= 0) {
            expect(t.action1.team, 'action1.team ref').toBeLessThan(parsed.teamTypes.length);
          }
          if (t.action2.team >= 0) {
            expect(t.action2.team, 'action2.team ref').toBeLessThan(parsed.teamTypes.length);
          }

          // Trigger refs: if >= 0, must be valid index
          if (t.action1.trigger >= 0) {
            expect(t.action1.trigger, 'action1.trigger ref').toBeLessThan(parsed.triggers.length);
          }
          if (t.action2.trigger >= 0) {
            expect(t.action2.trigger, 'action2.trigger ref').toBeLessThan(parsed.triggers.length);
          }
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 4. TeamType Validation — member types, mission types, origin waypoints
// ---------------------------------------------------------------------------

describe('Scenario Parity: TeamType Validation', () => {
  for (const { id, parsed } of scenarios) {
    describe(id, () => {
      for (const team of parsed.teamTypes) {
        it(`${team.name}: valid members, missions, origin`, () => {
          // Each member type must exist in UNIT_STATS or be an exempt type
          for (const member of team.members) {
            if (!EXEMPT_TEAM_MEMBER_TYPES.has(member.type)) {
              expect(
                UNIT_STATS[member.type],
                `member type ${member.type} in UNIT_STATS`,
              ).toBeDefined();
            }
            expect(member.count, `${member.type} count > 0`).toBeGreaterThan(0);
          }

          // Each mission type must be in VALID_TMISSIONS
          for (const mission of team.missions) {
            expect(
              VALID_TMISSIONS.has(mission.mission),
              `mission ${mission.mission} in VALID_TMISSIONS`,
            ).toBe(true);
          }

          // Origin waypoint should exist if defined in Waypoints section
          // Some campaign teams use edge-of-map waypoints (93, 96) that are
          // dynamically resolved by the C++ engine and not in [Waypoints]
          if (team.origin >= 0 && parsed.waypoints.has(team.origin)) {
            const pos = parsed.waypoints.get(team.origin)!;
            expect(pos.cx, `origin wp ${team.origin} cx`).toBeGreaterThanOrEqual(0);
            expect(pos.cy, `origin wp ${team.origin} cy`).toBeGreaterThanOrEqual(0);
          }
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Starting Conditions — types, HP, cells, home waypoint
// ---------------------------------------------------------------------------

describe('Scenario Parity: Starting Conditions', () => {
  for (const { id, parsed } of scenarios) {
    describe(id, () => {
      it('unit types exist and values in range', () => {
        for (const u of parsed.units) {
          if (!EXEMPT_UNIT_TYPES.has(u.type)) {
            expect(UNIT_STATS[u.type], `unit type ${u.type} in UNIT_STATS`).toBeDefined();
          }
          expect(u.hp, `${u.type} hp ∈ [1..256]`).toBeGreaterThanOrEqual(1);
          expect(u.hp).toBeLessThanOrEqual(256);
          expect(u.cell, `${u.type} cell ∈ [0..${MAX_CELL}]`).toBeGreaterThanOrEqual(0);
          expect(u.cell).toBeLessThanOrEqual(MAX_CELL);
        }
      });

      it('infantry types exist and values in range', () => {
        for (const inf of parsed.infantry) {
          if (!EXEMPT_UNIT_TYPES.has(inf.type)) {
            expect(UNIT_STATS[inf.type], `infantry type ${inf.type} in UNIT_STATS`).toBeDefined();
          }
          expect(inf.hp, `${inf.type} hp ∈ [1..256]`).toBeGreaterThanOrEqual(1);
          expect(inf.hp).toBeLessThanOrEqual(256);
          expect(inf.cell, `${inf.type} cell ∈ [0..${MAX_CELL}]`).toBeGreaterThanOrEqual(0);
          expect(inf.cell).toBeLessThanOrEqual(MAX_CELL);
        }
      });

      it('structure types exist and values in range', () => {
        for (const s of parsed.structures) {
          expect(
            STRUCTURE_MAX_HP[s.type],
            `structure type ${s.type} in STRUCTURE_MAX_HP`,
          ).toBeDefined();
          expect(s.hp, `${s.type} hp ∈ [1..256]`).toBeGreaterThanOrEqual(1);
          expect(s.hp).toBeLessThanOrEqual(256);
          expect(s.cell, `${s.type} cell ∈ [0..${MAX_CELL}]`).toBeGreaterThanOrEqual(0);
          expect(s.cell).toBeLessThanOrEqual(MAX_CELL);
        }
      });

      it('waypoint 98 (home) exists', () => {
        // All RA scenarios use WP98 as player home/map center
        if (parsed.waypoints.size > 0) {
          expect(parsed.waypoints.has(98), 'waypoint 98 exists').toBe(true);
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 6. Cross-References — trigger names in cellTriggers, units, infantry, structures
// ---------------------------------------------------------------------------

describe('Scenario Parity: Cross-References', () => {
  for (const { id, parsed } of scenarios) {
    const triggerNames = new Set(parsed.triggers.map(t => t.name));

    describe(id, () => {
      it('cellTrigger names reference existing triggers', () => {
        for (const [cell, name] of parsed.cellTriggers) {
          expect(
            triggerNames.has(name),
            `cellTrigger at ${cell} → "${name}" exists in [Trigs]`,
          ).toBe(true);
        }
      });

      it('unit trigger names reference existing triggers', () => {
        for (const u of parsed.units) {
          if (u.trigger && u.trigger !== 'None') {
            expect(
              triggerNames.has(u.trigger),
              `unit ${u.type} trigger "${u.trigger}" exists in [Trigs]`,
            ).toBe(true);
          }
        }
      });

      it('infantry trigger names reference existing triggers', () => {
        for (const inf of parsed.infantry) {
          if (inf.trigger && inf.trigger !== 'None') {
            expect(
              triggerNames.has(inf.trigger),
              `infantry ${inf.type} trigger "${inf.trigger}" exists in [Trigs]`,
            ).toBe(true);
          }
        }
      });

      it('structure trigger names reference existing triggers', () => {
        for (const s of parsed.structures) {
          if (s.trigger && s.trigger !== 'None') {
            expect(
              triggerNames.has(s.trigger),
              `structure ${s.type} trigger "${s.trigger}" exists in [Trigs]`,
            ).toBe(true);
          }
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 7. House Configuration — credits, tech level, alliances
// ---------------------------------------------------------------------------

describe('Scenario Parity: House Configuration', () => {
  for (const { id, parsed } of scenarios) {
    describe(id, () => {
      it('player house has valid Credits and TechLevel', () => {
        expect(parsed.playerCredits, 'playerCredits >= 0').toBeGreaterThanOrEqual(0);
        expect(parsed.playerTechLevel, 'playerTechLevel >= 0').toBeGreaterThanOrEqual(0);
      });

      it('alliance data parsed and ally names reference known houses', () => {
        // C++ allows unidirectional alliances (A allies B but B doesn't ally A),
        // and INI files use aliases ("soviet" for "USSR") and multiplayer houses
        // (Multi1-Multi8). Validate that the data is parsed and non-empty.
        const knownHouses = new Set([
          'Spain', 'Greece', 'USSR', 'England', 'Ukraine', 'Germany',
          'France', 'Turkey', 'GoodGuy', 'BadGuy', 'Neutral', 'Special',
          // INI aliases and multiplayer names
          'soviet', 'allies',
          'Multi1', 'Multi2', 'Multi3', 'Multi4',
          'Multi5', 'Multi6', 'Multi7', 'Multi8',
        ]);
        expect(parsed.houseAllies.size, 'at least one house has allies').toBeGreaterThan(0);
        for (const [house, allies] of parsed.houseAllies) {
          expect(knownHouses.has(house), `${house} is a known house`).toBe(true);
          expect(allies.length, `${house} has at least one ally`).toBeGreaterThan(0);
          for (const ally of allies) {
            expect(knownHouses.has(ally), `${house} ally "${ally}" is a known house`).toBe(true);
          }
        }
      });
    });
  }
});
