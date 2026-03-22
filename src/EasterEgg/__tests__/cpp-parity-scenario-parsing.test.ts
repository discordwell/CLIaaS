/**
 * cpp-parity-scenario-parsing.test.ts
 *
 * Audit scenario INI parsing accuracy — verify the TS parser (parseScenarioINI)
 * correctly reads key sections from actual campaign scenario files.
 *
 * All expected values are parsed from the raw INI text at test time.
 * NEVER hardcode C++ values in assertions.
 *
 * C++ refs:
 *   - scenario.cpp: Read_INI() — master scenario INI reader
 *   - house.cpp: Read_INI() — per-house Allies=, Credits=, Edge= parsing
 *   - teamtype.cpp: Read_INI() — team type parsing (8+N+1+M CSV format)
 *   - trigger.cpp: Read_INI() — trigger parsing (18-field CSV in [Trigs])
 *   - cell.cpp: Read_INI() — CellTriggers parsing
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { parseScenarioINI } from '../engine/scenario';
import { MAP_CELLS } from '../engine/types';

// ---------------------------------------------------------------------------
// Helpers: independent INI parser (reference implementation)
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
// Setup: load 3 scenario files (SCG01EA, SCG05EA, SCG03EA)
// ---------------------------------------------------------------------------

const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');

const SCENARIO_FILES = ['SCG01EA', 'SCG05EA', 'SCG03EA'];

const scenarios = SCENARIO_FILES.map(id => {
  const text = readFileSync(join(assetsDir, `${id}.ini`), 'utf-8');
  return { id, text, raw: parseINI(text), parsed: parseScenarioINI(text) };
});

// ---------------------------------------------------------------------------
// 1. [Basic] section parsing
//    C++ scenario.cpp Read_INI():
//      Scen.Name, Scen.BriefMovie, Scen.IntroMovie, etc.
// ---------------------------------------------------------------------------

describe('cpp-parity: [Basic] section parsing', () => {
  for (const { id, raw, parsed } of scenarios) {
    describe(id, () => {
      it('Player= is correctly parsed', () => {
        const expected = raw['Basic']?.['Player'] ?? '';
        expect(parsed.playerHouse, `${id} Player`).toBe(expected);
      });

      it('Name= is correctly parsed', () => {
        const expected = raw['Basic']?.['Name'] ?? 'Unknown Mission';
        expect(parsed.name, `${id} Name`).toBe(expected);
      });

      // C++ scenario.cpp: the Brief, Win, Lose, Action, Intro fields are movie names
      // stored in [Basic]. The TS parser exposes rawSections so we can check them.
      it('Intro= is preserved in rawSections', () => {
        const expected = raw['Basic']?.['Intro'] ?? '';
        const actual = parsed.rawSections.get('Basic')?.get('Intro') ?? '';
        expect(actual, `${id} Intro`).toBe(expected);
      });

      it('Brief= is preserved in rawSections', () => {
        const expected = raw['Basic']?.['Brief'] ?? '';
        const actual = parsed.rawSections.get('Basic')?.get('Brief') ?? '';
        expect(actual, `${id} Brief`).toBe(expected);
      });

      it('Win= is preserved in rawSections', () => {
        const expected = raw['Basic']?.['Win'] ?? '';
        const actual = parsed.rawSections.get('Basic')?.get('Win') ?? '';
        expect(actual, `${id} Win`).toBe(expected);
      });

      it('Lose= is preserved in rawSections', () => {
        const expected = raw['Basic']?.['Lose'] ?? '';
        const actual = parsed.rawSections.get('Basic')?.get('Lose') ?? '';
        expect(actual, `${id} Lose`).toBe(expected);
      });

      it('Action= is preserved in rawSections', () => {
        const expected = raw['Basic']?.['Action'] ?? '';
        const actual = parsed.rawSections.get('Basic')?.get('Action') ?? '';
        expect(actual, `${id} Action`).toBe(expected);
      });

      it('CivEvac= maps to isTanyaEvac', () => {
        const expected = (raw['Basic']?.['CivEvac'] ?? 'no').toLowerCase() === 'yes';
        expect(parsed.isTanyaEvac, `${id} isTanyaEvac`).toBe(expected);
      });

      it('ToCarryOver= is correctly parsed', () => {
        const expected = (raw['Basic']?.['ToCarryOver'] ?? 'no').toLowerCase() === 'yes';
        expect(parsed.toCarryOver, `${id} ToCarryOver`).toBe(expected);
      });

      it('ToInherit= is correctly parsed', () => {
        const expected = (raw['Basic']?.['ToInherit'] ?? 'no').toLowerCase() === 'yes';
        expect(parsed.toInherit, `${id} ToInherit`).toBe(expected);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 2. [Map] section parsing
//    C++ scenario.cpp: Map.X, Map.Y, Map.Width, Map.Height, Map.Theater
// ---------------------------------------------------------------------------

describe('cpp-parity: [Map] section parsing', () => {
  for (const { id, raw, parsed } of scenarios) {
    describe(id, () => {
      it('X= matches', () => {
        const expected = parseInt(raw['Map']?.['X'] ?? '0');
        expect(parsed.mapBounds.x, `${id} Map.X`).toBe(expected);
      });

      it('Y= matches', () => {
        const expected = parseInt(raw['Map']?.['Y'] ?? '0');
        expect(parsed.mapBounds.y, `${id} Map.Y`).toBe(expected);
      });

      it('Width= matches', () => {
        const expected = parseInt(raw['Map']?.['Width'] ?? '50');
        expect(parsed.mapBounds.w, `${id} Map.Width`).toBe(expected);
      });

      it('Height= matches', () => {
        const expected = parseInt(raw['Map']?.['Height'] ?? '50');
        expect(parsed.mapBounds.h, `${id} Map.Height`).toBe(expected);
      });

      it('Theater= maps to theatre field (uppercased)', () => {
        const expected = (raw['Map']?.['Theater'] ?? 'TEMPERATE').toUpperCase();
        expect(parsed.theatre, `${id} Theatre`).toBe(expected);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 3. [Waypoints] section parsing
//    C++ scenario.cpp: 98 waypoints (0-97), each maps to cell index
//    cell index → CellPos via cellIndexToPos (cx = idx % 128, cy = idx / 128)
// ---------------------------------------------------------------------------

describe('cpp-parity: [Waypoints] section parsing', () => {
  for (const { id, raw, parsed } of scenarios) {
    describe(id, () => {
      const rawWps = raw['Waypoints'] ?? {};
      const rawWpEntries = Object.entries(rawWps);

      it('waypoint count matches raw INI', () => {
        expect(parsed.waypoints.size, `${id} waypoint count`).toBe(rawWpEntries.length);
      });

      it('all waypoint cell positions are correct', () => {
        for (const [key, value] of rawWpEntries) {
          const wpIdx = parseInt(key);
          const cellIdx = parseInt(value);
          const expectedCx = cellIdx % MAP_CELLS;
          const expectedCy = Math.floor(cellIdx / MAP_CELLS);

          const pos = parsed.waypoints.get(wpIdx);
          expect(pos, `${id} waypoint ${wpIdx} exists`).toBeDefined();
          expect(pos!.cx, `${id} waypoint ${wpIdx} cx`).toBe(expectedCx);
          expect(pos!.cy, `${id} waypoint ${wpIdx} cy`).toBe(expectedCy);
        }
      });

      it('no phantom waypoints beyond raw INI', () => {
        // Verify the parser does not invent waypoints not in the INI
        for (const [wpIdx] of parsed.waypoints) {
          expect(
            rawWps[String(wpIdx)] !== undefined,
            `${id} waypoint ${wpIdx} should exist in raw INI`,
          ).toBe(true);
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 4. [TeamTypes] section parsing
//    C++ teamtype.cpp Read_INI():
//      Format: name=House,Flags,RecruitPriority,InitNum,MaxAllowed,Origin,Trigger,ClassCount,members...,MissionCount,missions...
// ---------------------------------------------------------------------------

describe('cpp-parity: [TeamTypes] section parsing', () => {
  for (const { id, raw, parsed } of scenarios) {
    describe(id, () => {
      const rawTeams = raw['TeamTypes'] ?? {};
      const rawEntries = Object.entries(rawTeams);

      it('team count matches raw INI', () => {
        expect(parsed.teamTypes.length, `${id} team count`).toBe(rawEntries.length);
      });

      for (const [name, value] of rawEntries) {
        it(`team "${name}": field-by-field match`, () => {
          const team = parsed.teamTypes.find(t => t.name === name);
          expect(team, `team "${name}" exists in parsed output`).toBeDefined();

          const parts = value.split(',');
          // field[0] = House
          expect(team!.house, `${name} house`).toBe(parseInt(parts[0]));
          // field[1] = Flags
          expect(team!.flags, `${name} flags`).toBe(parseInt(parts[1]) || 0);
          // field[2] = RecruitPriority
          expect(team!.recruitPriority, `${name} recruitPriority`).toBe(parseInt(parts[2]) || 7);
          // field[3] = InitNum
          expect(team!.initNum, `${name} initNum`).toBe(parseInt(parts[3]) || 0);
          // field[4] = MaxAllowed
          expect(team!.maxAllowed, `${name} maxAllowed`).toBe(parseInt(parts[4]) || 0);
          // field[5] = Origin waypoint
          expect(team!.origin, `${name} origin`).toBe(parseInt(parts[5]));
          // field[6] = Trigger index
          expect(team!.trigger, `${name} trigger`).toBe(parseInt(parts[6]));

          // field[7] = ClassCount
          const classCount = parseInt(parts[7]);
          expect(team!.members.length, `${name} member count`).toBe(classCount);

          // Members: field[8..8+classCount-1] = "TYPE:COUNT"
          for (let i = 0; i < classCount; i++) {
            const memberStr = parts[8 + i];
            const [mType, mCount] = memberStr.split(':');
            expect(team!.members[i].type, `${name} member[${i}] type`).toBe(mType);
            expect(team!.members[i].count, `${name} member[${i}] count`).toBe(parseInt(mCount) || 1);
          }

          // field[8+classCount] = MissionCount
          const missionCountIdx = 8 + classCount;
          const missionCount = parseInt(parts[missionCountIdx]) || 0;
          expect(team!.missions.length, `${name} mission count`).toBe(missionCount);

          // Missions: field[missionCountIdx+1..+missionCount] = "MISSION:DATA"
          for (let i = 0; i < missionCount; i++) {
            const missionStr = parts[missionCountIdx + 1 + i];
            const [mId, mData] = missionStr.split(':');
            expect(team!.missions[i].mission, `${name} mission[${i}] id`).toBe(parseInt(mId));
            expect(team!.missions[i].data, `${name} mission[${i}] data`).toBe(parseInt(mData) || 0);
          }
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 5. [Trigs] section parsing (trigger definitions)
//    C++ trigger.cpp Read_INI():
//      18-field CSV format:
//      PersType,House,EventControl,ActionControl,
//      E1.Event,E1.Team,E1.Data, E2.Event,E2.Team,E2.Data,
//      A1.Action,A1.Team,A1.Trigger,A1.Data, A2.Action,A2.Team,A2.Trigger,A2.Data
// ---------------------------------------------------------------------------

describe('cpp-parity: [Trigs] section parsing', () => {
  for (const { id, raw, parsed } of scenarios) {
    describe(id, () => {
      const rawTrigs = raw['Trigs'] ?? {};
      const rawEntries = Object.entries(rawTrigs);

      it('trigger count matches raw INI', () => {
        expect(parsed.triggers.length, `${id} trigger count`).toBe(rawEntries.length);
      });

      for (const [name, rawValue] of rawEntries) {
        it(`trigger "${name}": all 18 fields match`, () => {
          const f = rawValue.split(',').map(s => parseInt(s.trim()));
          expect(f.length, `${name} should have >= 18 fields`).toBeGreaterThanOrEqual(18);

          const t = parsed.triggers.find(tr => tr.name === name);
          expect(t, `parsed trigger "${name}" exists`).toBeDefined();

          expect(t!.persistence, `${name} f[0] persistence`).toBe(f[0]);
          expect(t!.house, `${name} f[1] house`).toBe(f[1]);
          expect(t!.eventControl, `${name} f[2] eventControl`).toBe(f[2]);
          expect(t!.actionControl, `${name} f[3] actionControl`).toBe(f[3]);
          expect(t!.event1.type, `${name} f[4] event1.type`).toBe(f[4]);
          expect(t!.event1.team, `${name} f[5] event1.team`).toBe(f[5]);
          expect(t!.event1.data, `${name} f[6] event1.data`).toBe(f[6]);
          expect(t!.event2.type, `${name} f[7] event2.type`).toBe(f[7]);
          expect(t!.event2.team, `${name} f[8] event2.team`).toBe(f[8]);
          expect(t!.event2.data, `${name} f[9] event2.data`).toBe(f[9]);
          expect(t!.action1.action, `${name} f[10] action1.action`).toBe(f[10]);
          expect(t!.action1.team, `${name} f[11] action1.team`).toBe(f[11]);
          expect(t!.action1.trigger, `${name} f[12] action1.trigger`).toBe(f[12]);
          expect(t!.action1.data, `${name} f[13] action1.data`).toBe(f[13]);
          expect(t!.action2.action, `${name} f[14] action2.action`).toBe(f[14]);
          expect(t!.action2.team, `${name} f[15] action2.team`).toBe(f[15]);
          expect(t!.action2.trigger, `${name} f[16] action2.trigger`).toBe(f[16]);
          expect(t!.action2.data, `${name} f[17] action2.data`).toBe(f[17]);
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 6. [CellTriggers] section parsing
//    C++ cell.cpp Read_INI(): maps cell indices to trigger names
// ---------------------------------------------------------------------------

describe('cpp-parity: [CellTriggers] section parsing', () => {
  for (const { id, raw, parsed } of scenarios) {
    describe(id, () => {
      const rawCT = raw['CellTriggers'] ?? {};
      const rawEntries = Object.entries(rawCT);

      it('cellTrigger count matches raw INI', () => {
        expect(parsed.cellTriggers.size, `${id} cellTrigger count`).toBe(rawEntries.length);
      });

      it('all cell→trigger mappings are correct', () => {
        for (const [cellStr, trigName] of rawEntries) {
          const cellIdx = parseInt(cellStr);
          const actual = parsed.cellTriggers.get(cellIdx);
          expect(actual, `${id} cell ${cellIdx} → ${trigName}`).toBe(trigName);
        }
      });

      it('no phantom cellTriggers beyond raw INI', () => {
        for (const [cellIdx, trigName] of parsed.cellTriggers) {
          expect(
            rawCT[String(cellIdx)] !== undefined,
            `${id} cell ${cellIdx} (→ ${trigName}) should exist in raw INI`,
          ).toBe(true);
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 7. Unit/Structure/Infantry placement parsing
//    C++ unit.cpp, infantry.cpp, building.cpp: Read_INI()
//    Unit format:    index=House,Type,HP,Cell,Facing,Mission,Trigger
//    Infantry format: index=House,Type,HP,Cell,SubCell,Mission,Facing,Trigger
//    Structure format: index=House,Type,HP,Cell,Facing,Trigger,Sellable,Repairable
// ---------------------------------------------------------------------------

describe('cpp-parity: Unit/Structure/Infantry placement parsing', () => {
  for (const { id, raw, parsed } of scenarios) {
    describe(id, () => {
      // --- UNITS ---
      it('unit count matches', () => {
        const rawUnitCount = Object.keys(raw['UNITS'] ?? {}).length;
        const rawShipCount = Object.keys(raw['SHIPS'] ?? {}).length;
        expect(parsed.units.length, `${id} unit count`).toBe(rawUnitCount + rawShipCount);
      });

      it('each unit field matches raw INI', () => {
        const rawUnits = raw['UNITS'] ?? {};
        const rawEntries = Object.entries(rawUnits);
        for (let i = 0; i < rawEntries.length; i++) {
          const [, value] = rawEntries[i];
          const parts = value.split(',');
          // Format: House,Type,HP,Cell,Facing,Mission,Trigger
          const unit = parsed.units[i];
          expect(unit, `${id} unit[${i}] exists`).toBeDefined();
          expect(unit.house, `${id} unit[${i}] house`).toBe(parts[0]);
          expect(unit.type, `${id} unit[${i}] type`).toBe(parts[1]);
          expect(unit.hp, `${id} unit[${i}] hp`).toBe(parseInt(parts[2]));
          expect(unit.cell, `${id} unit[${i}] cell`).toBe(parseInt(parts[3]));
          expect(unit.facing, `${id} unit[${i}] facing`).toBe(parseInt(parts[4]));
          expect(unit.mission, `${id} unit[${i}] mission`).toBe(parts[5]);
          expect(unit.trigger, `${id} unit[${i}] trigger`).toBe(parts[6]);
        }
      });

      // --- INFANTRY ---
      it('infantry count matches', () => {
        expect(parsed.infantry.length, `${id} infantry count`).toBe(
          Object.keys(raw['INFANTRY'] ?? {}).length,
        );
      });

      it('each infantry field matches raw INI', () => {
        const rawInf = raw['INFANTRY'] ?? {};
        const rawEntries = Object.entries(rawInf);
        for (let i = 0; i < rawEntries.length; i++) {
          const [, value] = rawEntries[i];
          const parts = value.split(',');
          // Format: House,Type,HP,Cell,SubCell,Mission,Facing,Trigger
          const inf = parsed.infantry[i];
          expect(inf, `${id} infantry[${i}] exists`).toBeDefined();
          expect(inf.house, `${id} infantry[${i}] house`).toBe(parts[0]);
          expect(inf.type, `${id} infantry[${i}] type`).toBe(parts[1]);
          expect(inf.hp, `${id} infantry[${i}] hp`).toBe(parseInt(parts[2]));
          expect(inf.cell, `${id} infantry[${i}] cell`).toBe(parseInt(parts[3]));
          expect(inf.subCell, `${id} infantry[${i}] subCell`).toBe(parseInt(parts[4]));
          expect(inf.mission, `${id} infantry[${i}] mission`).toBe(parts[5]);
          expect(inf.facing, `${id} infantry[${i}] facing`).toBe(parseInt(parts[6]));
          expect(inf.trigger, `${id} infantry[${i}] trigger`).toBe(parts[7]);
        }
      });

      // --- STRUCTURES ---
      it('structure count matches', () => {
        expect(parsed.structures.length, `${id} structure count`).toBe(
          Object.keys(raw['STRUCTURES'] ?? {}).length,
        );
      });

      it('each structure field matches raw INI', () => {
        const rawStr = raw['STRUCTURES'] ?? {};
        const rawEntries = Object.entries(rawStr);
        for (let i = 0; i < rawEntries.length; i++) {
          const [, value] = rawEntries[i];
          const parts = value.split(',');
          // Format: House,Type,HP,Cell,Facing,Trigger,...
          const str = parsed.structures[i];
          expect(str, `${id} structure[${i}] exists`).toBeDefined();
          expect(str.house, `${id} structure[${i}] house`).toBe(parts[0]);
          expect(str.type, `${id} structure[${i}] type`).toBe(parts[1]);
          expect(str.hp, `${id} structure[${i}] hp`).toBe(parseInt(parts[2]));
          expect(str.cell, `${id} structure[${i}] cell`).toBe(parseInt(parts[3]));
          expect(str.facing, `${id} structure[${i}] facing`).toBe(parseInt(parts[4]));
          expect(str.trigger, `${id} structure[${i}] trigger`).toBe(parts[5]);
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 8. Alliance settings
//    C++ house.cpp Read_INI(): per-house Allies= field
// ---------------------------------------------------------------------------

describe('cpp-parity: Alliance settings parsing', () => {
  for (const { id, raw, parsed } of scenarios) {
    describe(id, () => {
      const houseNames = [
        'Spain', 'Greece', 'USSR', 'England', 'Ukraine', 'Germany',
        'France', 'Turkey', 'GoodGuy', 'BadGuy', 'Neutral', 'Special',
      ];

      for (const houseName of houseNames) {
        const rawAllies = raw[houseName]?.['Allies'] ?? '';
        if (!rawAllies) continue;

        it(`${houseName} Allies= matches`, () => {
          const expectedAllies = rawAllies.split(',').map(s => s.trim()).filter(Boolean);
          const actualAllies = parsed.houseAllies.get(houseName) ?? [];
          expect(actualAllies, `${id} ${houseName} allies`).toEqual(expectedAllies);
        });
      }

      // Verify houses without Allies= in raw INI are not in parsed houseAllies
      for (const houseName of houseNames) {
        const rawAllies = raw[houseName]?.['Allies'] ?? '';
        if (rawAllies) continue;

        it(`${houseName} has no Allies= field`, () => {
          const actualAllies = parsed.houseAllies.get(houseName);
          expect(
            actualAllies,
            `${id} ${houseName} should not have allies`,
          ).toBeUndefined();
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 9. Per-house Credits, Edge, IQ, TechLevel, MaxUnit/Infantry/Building
//    C++ house.cpp Read_INI(): per-house settings
// ---------------------------------------------------------------------------

describe('cpp-parity: Per-house settings parsing', () => {
  for (const { id, raw, parsed } of scenarios) {
    describe(id, () => {
      const houseNames = [
        'Spain', 'Greece', 'USSR', 'England', 'Ukraine', 'Germany',
        'France', 'Turkey', 'GoodGuy', 'BadGuy', 'Neutral', 'Special',
      ];
      const playerHouse = raw['Basic']?.['Player'] ?? '';

      for (const houseName of houseNames) {
        const houseSection = raw[houseName];
        if (!houseSection) continue;

        // Edge=
        const rawEdge = houseSection['Edge'] ?? '';
        if (rawEdge) {
          it(`${houseName} Edge= matches`, () => {
            expect(parsed.houseEdges.get(houseName), `${id} ${houseName} Edge`).toBe(rawEdge);
          });
        }

        // IQ=
        const rawIQ = houseSection['IQ'] ?? '';
        if (rawIQ) {
          it(`${houseName} IQ= matches`, () => {
            expect(parsed.houseIQ.get(houseName), `${id} ${houseName} IQ`).toBe(parseInt(rawIQ));
          });
        }

        // TechLevel=
        const rawTL = houseSection['TechLevel'] ?? '';
        if (rawTL) {
          it(`${houseName} TechLevel= matches`, () => {
            expect(
              parsed.houseTechLevels.get(houseName),
              `${id} ${houseName} TechLevel`,
            ).toBe(parseInt(rawTL));
          });
        }

        // MaxUnit=
        const rawMaxU = houseSection['MaxUnit'] ?? '';
        if (rawMaxU) {
          it(`${houseName} MaxUnit= matches`, () => {
            expect(
              parsed.houseMaxUnit.get(houseName),
              `${id} ${houseName} MaxUnit`,
            ).toBe(parseInt(rawMaxU));
          });
        }

        // MaxInfantry=
        const rawMaxI = houseSection['MaxInfantry'] ?? '';
        if (rawMaxI) {
          it(`${houseName} MaxInfantry= matches`, () => {
            expect(
              parsed.houseMaxInfantry.get(houseName),
              `${id} ${houseName} MaxInfantry`,
            ).toBe(parseInt(rawMaxI));
          });
        }

        // MaxBuilding=
        const rawMaxB = houseSection['MaxBuilding'] ?? '';
        if (rawMaxB) {
          it(`${houseName} MaxBuilding= matches`, () => {
            expect(
              parsed.houseMaxBuilding.get(houseName),
              `${id} ${houseName} MaxBuilding`,
            ).toBe(parseInt(rawMaxB));
          });
        }

        // Credits= (note: the parser skips player house credits from houseCredits map)
        const rawCredits = houseSection['Credits'] ?? '';
        if (rawCredits && houseName !== playerHouse) {
          const creditsVal = parseInt(rawCredits);
          if (!isNaN(creditsVal) && creditsVal > 0) {
            it(`${houseName} Credits= matches`, () => {
              expect(
                parsed.houseCredits.get(houseName),
                `${id} ${houseName} Credits`,
              ).toBe(creditsVal);
            });
          }
        }

        // Player house credits go to playerCredits
        if (rawCredits && houseName === playerHouse) {
          it(`player house (${houseName}) Credits= maps to playerCredits`, () => {
            expect(parsed.playerCredits, `${id} playerCredits`).toBe(parseInt(rawCredits) || 0);
          });
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 10. Terrain features ([TERRAIN] section)
//     C++ terrain.cpp Read_INI(): cell=TYPE format
// ---------------------------------------------------------------------------

describe('cpp-parity: [TERRAIN] section parsing', () => {
  for (const { id, raw, parsed } of scenarios) {
    describe(id, () => {
      const rawTerrain = raw['TERRAIN'] ?? {};
      const rawEntries = Object.entries(rawTerrain);

      it('terrain count matches raw INI', () => {
        expect(parsed.terrain.length, `${id} terrain count`).toBe(rawEntries.length);
      });

      it('all terrain cell→type mappings are correct', () => {
        // Build lookup from parsed terrain
        const parsedTerrainMap = new Map(parsed.terrain.map(t => [t.cell, t.type]));

        for (const [cellStr, type] of rawEntries) {
          const cellIdx = parseInt(cellStr);
          expect(
            parsedTerrainMap.get(cellIdx),
            `${id} terrain at cell ${cellIdx}`,
          ).toBe(type);
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 11. [Briefing] section parsing
//     C++ scenario.cpp: numbered lines concatenated, @@ = paragraph break
// ---------------------------------------------------------------------------

describe('cpp-parity: [Briefing] section parsing', () => {
  for (const { id, raw, parsed } of scenarios) {
    describe(id, () => {
      const rawBriefing = raw['Briefing'] ?? {};
      const rawEntries = Object.entries(rawBriefing);

      if (rawEntries.length === 0) {
        it('no briefing section → empty briefing', () => {
          expect(parsed.briefing, `${id} briefing`).toBe('');
        });
      } else {
        it('briefing text is assembled from numbered lines', () => {
          // C++ concatenates all numbered lines (sorted numerically)
          const sortedKeys = rawEntries
            .map(([k]) => parseInt(k))
            .sort((a, b) => a - b);
          const expectedRaw = sortedKeys
            .map(k => rawBriefing[String(k)])
            .join('');
          // @@ → double newline
          const expected = expectedRaw.replace(/@@/g, '\n\n');
          expect(parsed.briefing, `${id} briefing`).toBe(expected);
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 12. [Base] section parsing
//     C++ base.cpp Read_INI(): Player=, Count=, then numbered entries TYPE,cell
// ---------------------------------------------------------------------------

describe('cpp-parity: [Base] section parsing', () => {
  for (const { id, raw, parsed } of scenarios) {
    describe(id, () => {
      const rawBase = raw['Base'] ?? {};
      // Count actual base structure entries (exclude Player= and Count=)
      const baseEntries = Object.entries(rawBase).filter(
        ([k]) => k !== 'Player' && k !== 'Count',
      );

      it('base structure count matches', () => {
        expect(parsed.baseStructures.length, `${id} base count`).toBe(baseEntries.length);
      });

      if (baseEntries.length > 0) {
        it('base Player= is used as house for all entries', () => {
          const expectedPlayer = rawBase['Player'] ?? 'Neutral';
          for (const bs of parsed.baseStructures) {
            expect(bs.house, `${id} base house`).toBe(expectedPlayer);
          }
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 13. rawSections completeness — verify all INI sections survive
//     C++ parity: the TS parser stores all sections in rawSections for
//     per-scenario rule overrides (scenarioRules.ts)
// ---------------------------------------------------------------------------

describe('cpp-parity: rawSections completeness', () => {
  for (const { id, raw, parsed } of scenarios) {
    describe(id, () => {
      it('every raw INI section exists in rawSections', () => {
        for (const sectionName of Object.keys(raw)) {
          expect(
            parsed.rawSections.has(sectionName),
            `${id} rawSections should have [${sectionName}]`,
          ).toBe(true);
        }
      });

      it('every key/value in each section matches', () => {
        for (const [sectionName, sectionData] of Object.entries(raw)) {
          const parsedSection = parsed.rawSections.get(sectionName);
          if (!parsedSection) continue; // already caught by previous test
          for (const [key, value] of Object.entries(sectionData)) {
            expect(
              parsedSection.get(key),
              `${id} [${sectionName}] ${key}`,
            ).toBe(value);
          }
        }
      });
    });
  }
});
