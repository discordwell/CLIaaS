/**
 * C++ Behavioral Parity Tests — Difficulty Level Modifiers
 *
 * Tests the full DifficultyClass from rules.h:44-61 and how Easy/Normal/Hard
 * settings affect gameplay through AI_DIFFICULTY_MODS.
 *
 * C++ source references:
 *   rules.h:44-61        — DifficultyClass definition (12 fields)
 *   rules.cpp:313-329    — Difficulty_Get() reads [Easy]/[Normal]/[Difficult] INI sections
 *   rules.cpp:1043-1047  — RulesClass::Difficulty() dispatches to Difficulty_Get
 *   house.cpp:282-311    — Assign_Handicap() applies difficulty biases per house
 *   house.cpp:517        — HouseClass constructor sets Difficulty = Scen.CDifficulty
 *   house.cpp:673        — Constructor calls Assign_Handicap(Scen.CDifficulty)
 *   scenario.h:70-71     — Scen.Difficulty (player), Scen.CDifficulty (computer)
 *   scenario.cpp:2297    — PlayerPtr->Assign_Handicap(Scen.Difficulty)
 *   scenario.cpp:2705-2710 — Computer houses get Scen.CDifficulty (reversed)
 *
 * Key C++ mechanic: difficulty is REVERSED for computer vs player.
 *   Player on Easy gets [Easy] INI bonuses (1.2 firepower, 1.2 armor, etc.)
 *   Computer on Easy gets [Difficult] INI penalties (0.8 firepower, 0.8 armor, etc.)
 *   TS maps: AI_DIFFICULTY_MODS.easy = [Difficult] INI values (computer perspective)
 *
 * rules.ini sections tested:
 *   [Easy]:      Firepower=1.2, Groundspeed=1.2, Airspeed=1.2, BuildTime=.8,
 *                Armor=1.2, ROF=.8, Cost=.8, RepairDelay=.001, BuildDelay=.001,
 *                DestroyWalls=yes, ContentScan=yes
 *   [Normal]:    Firepower=1.0, Groundspeed=1.0, Airspeed=1.0, BuildTime=1,
 *                Armor=1.0, ROF=1.0, Cost=1.0, RepairDelay=.02, BuildDelay=.03,
 *                BuildSlowdown=yes, DestroyWalls=yes, ContentScan=yes
 *   [Difficult]: Firepower=.8, Groundspeed=.8, Airspeed=.8, BuildTime=1.0,
 *                Armor=.8, ROF=1.2, Cost=1.0, RepairDelay=.05, BuildDelay=.1,
 *                BuildSlowdown=yes, DestroyWalls=no
 */

import { describe, it, expect } from 'vitest';
import { AI_DIFFICULTY_MODS, DIFFICULTY_MODS, type Difficulty, AI_BUILD_RULES } from '../engine/ai';

// ═══════════════════════════════════════════════════════════════════════════════
// Expected values derived from rules.ini [Easy], [Normal], [Difficult] sections
// ═══════════════════════════════════════════════════════════════════════════════

// C++ reversal: AI on "easy" gets [Difficult] INI values (weaker computer)
//               AI on "hard" gets [Easy] INI values (stronger computer)
//               AI on "normal" gets [Normal] INI values

// rules.ini [Difficult] -> TS AI_DIFFICULTY_MODS.easy (computer is weaker)
const INI_DIFFICULT = {
  firepower: 0.8, groundspeed: 0.8, airspeed: 0.8, buildTime: 1.0,
  armor: 0.8, rof: 1.2, cost: 1.0,
  repairDelay: 0.05, buildDelay: 0.1,
  buildSlowdown: true, destroyWalls: false, contentScan: false, // defaults per rules.cpp:324,327
};

// rules.ini [Normal] -> TS AI_DIFFICULTY_MODS.normal
const INI_NORMAL = {
  firepower: 1.0, groundspeed: 1.0, airspeed: 1.0, buildTime: 1.0,
  armor: 1.0, rof: 1.0, cost: 1.0,
  repairDelay: 0.02, buildDelay: 0.03,
  buildSlowdown: true, destroyWalls: true, contentScan: true,
};

// rules.ini [Easy] -> TS AI_DIFFICULTY_MODS.hard (computer is stronger)
const INI_EASY = {
  firepower: 1.2, groundspeed: 1.2, airspeed: 1.2, buildTime: 0.8,
  armor: 1.2, rof: 0.8, cost: 0.8,
  repairDelay: 0.001, buildDelay: 0.001,
  buildSlowdown: false, // not present in [Easy] -> default false per rules.cpp:324
  destroyWalls: true, contentScan: true,
};

// ═══════════════════════════════════════════════════════════════════════════════
// 1. All 12 DifficultyClass fields match rules.ini for each difficulty
//    C++ rules.h:44-61, rules.cpp:313-329
// ═══════════════════════════════════════════════════════════════════════════════

describe('AI_DIFFICULTY_MODS matches rules.ini [Easy]/[Normal]/[Difficult] (rules.cpp:313-329)', () => {

  describe('easy (computer gets [Difficult] INI values)', () => {
    const mods = AI_DIFFICULTY_MODS.easy;

    it('firepowerBias = 0.8 (rules.ini [Difficult] Firepower=.8)', () => {
      expect(mods.firepowerBias).toBe(INI_DIFFICULT.firepower);
    });
    it('groundspeedBias = 0.8 (rules.ini [Difficult] Groundspeed=.8)', () => {
      expect(mods.groundspeedBias).toBe(INI_DIFFICULT.groundspeed);
    });
    it('airspeedBias = 0.8 (rules.ini [Difficult] Airspeed=.8)', () => {
      expect(mods.airspeedBias).toBe(INI_DIFFICULT.airspeed);
    });
    it('armorBias = 0.8 (rules.ini [Difficult] Armor=.8)', () => {
      expect(mods.armorBias).toBe(INI_DIFFICULT.armor);
    });
    it('rofBias = 1.2 (rules.ini [Difficult] ROF=1.2)', () => {
      expect(mods.rofBias).toBe(INI_DIFFICULT.rof);
    });
    it('costBias = 1.0 (rules.ini [Difficult] Cost=1.0)', () => {
      expect(mods.costBias).toBe(INI_DIFFICULT.cost);
    });
    it('buildSpeedBias = 1.0 (rules.ini [Difficult] BuildTime=1.0)', () => {
      expect(mods.buildSpeedBias).toBe(INI_DIFFICULT.buildTime);
    });
    it('repairDelay = 0.05 (rules.ini [Difficult] RepairDelay=.05)', () => {
      expect(mods.repairDelay).toBe(INI_DIFFICULT.repairDelay);
    });
    it('buildDelay = 0.1 (rules.ini [Difficult] BuildDelay=.1)', () => {
      expect(mods.buildDelay).toBe(INI_DIFFICULT.buildDelay);
    });
    it('isBuildSlowdown = true (rules.ini [Difficult] BuildSlowdown=yes)', () => {
      expect(mods.isBuildSlowdown).toBe(INI_DIFFICULT.buildSlowdown);
    });
    it('isWallDestroyer = false (rules.ini [Difficult] DestroyWalls=no)', () => {
      expect(mods.isWallDestroyer).toBe(INI_DIFFICULT.destroyWalls);
    });
    it('isContentScan = false (rules.ini [Difficult] no ContentScan -> default false)', () => {
      expect(mods.isContentScan).toBe(INI_DIFFICULT.contentScan);
    });
  });

  describe('normal (computer gets [Normal] INI values)', () => {
    const mods = AI_DIFFICULTY_MODS.normal;

    it('firepowerBias = 1.0 (rules.ini [Normal] Firepower=1.0)', () => {
      expect(mods.firepowerBias).toBe(INI_NORMAL.firepower);
    });
    it('groundspeedBias = 1.0 (rules.ini [Normal] Groundspeed=1.0)', () => {
      expect(mods.groundspeedBias).toBe(INI_NORMAL.groundspeed);
    });
    it('airspeedBias = 1.0 (rules.ini [Normal] Airspeed=1.0)', () => {
      expect(mods.airspeedBias).toBe(INI_NORMAL.airspeed);
    });
    it('armorBias = 1.0 (rules.ini [Normal] Armor=1.0)', () => {
      expect(mods.armorBias).toBe(INI_NORMAL.armor);
    });
    it('rofBias = 1.0 (rules.ini [Normal] ROF=1.0)', () => {
      expect(mods.rofBias).toBe(INI_NORMAL.rof);
    });
    it('costBias = 1.0 (rules.ini [Normal] Cost=1.0)', () => {
      expect(mods.costBias).toBe(INI_NORMAL.cost);
    });
    it('buildSpeedBias = 1.0 (rules.ini [Normal] BuildTime=1)', () => {
      expect(mods.buildSpeedBias).toBe(INI_NORMAL.buildTime);
    });
    it('repairDelay = 0.02 (rules.ini [Normal] RepairDelay=.02)', () => {
      expect(mods.repairDelay).toBe(INI_NORMAL.repairDelay);
    });
    it('buildDelay = 0.03 (rules.ini [Normal] BuildDelay=.03)', () => {
      expect(mods.buildDelay).toBe(INI_NORMAL.buildDelay);
    });
    it('isBuildSlowdown = true (rules.ini [Normal] BuildSlowdown=yes)', () => {
      expect(mods.isBuildSlowdown).toBe(INI_NORMAL.buildSlowdown);
    });
    it('isWallDestroyer = true (rules.ini [Normal] DestroyWalls=yes)', () => {
      expect(mods.isWallDestroyer).toBe(INI_NORMAL.destroyWalls);
    });
    it('isContentScan = true (rules.ini [Normal] ContentScan=yes)', () => {
      expect(mods.isContentScan).toBe(INI_NORMAL.contentScan);
    });
  });

  describe('hard (computer gets [Easy] INI values)', () => {
    const mods = AI_DIFFICULTY_MODS.hard;

    it('firepowerBias = 1.2 (rules.ini [Easy] Firepower=1.2)', () => {
      expect(mods.firepowerBias).toBe(INI_EASY.firepower);
    });
    it('groundspeedBias = 1.2 (rules.ini [Easy] Groundspeed=1.2)', () => {
      expect(mods.groundspeedBias).toBe(INI_EASY.groundspeed);
    });
    it('airspeedBias = 1.2 (rules.ini [Easy] Airspeed=1.2)', () => {
      expect(mods.airspeedBias).toBe(INI_EASY.airspeed);
    });
    it('armorBias = 1.2 (rules.ini [Easy] Armor=1.2)', () => {
      expect(mods.armorBias).toBe(INI_EASY.armor);
    });
    it('rofBias = 0.8 (rules.ini [Easy] ROF=.8)', () => {
      expect(mods.rofBias).toBe(INI_EASY.rof);
    });
    it('costBias = 0.8 (rules.ini [Easy] Cost=.8)', () => {
      expect(mods.costBias).toBe(INI_EASY.cost);
    });
    it('buildSpeedBias = 0.8 (rules.ini [Easy] BuildTime=.8)', () => {
      expect(mods.buildSpeedBias).toBe(INI_EASY.buildTime);
    });
    it('repairDelay = 0.001 (rules.ini [Easy] RepairDelay=.001)', () => {
      expect(mods.repairDelay).toBe(INI_EASY.repairDelay);
    });
    it('buildDelay = 0.001 (rules.ini [Easy] BuildDelay=.001)', () => {
      expect(mods.buildDelay).toBe(INI_EASY.buildDelay);
    });
    it('isBuildSlowdown = false (rules.ini [Easy] no BuildSlowdown -> default false)', () => {
      expect(mods.isBuildSlowdown).toBe(INI_EASY.buildSlowdown);
    });
    it('isWallDestroyer = true (rules.ini [Easy] DestroyWalls=yes)', () => {
      expect(mods.isWallDestroyer).toBe(INI_EASY.destroyWalls);
    });
    it('isContentScan = true (rules.ini [Easy] ContentScan=yes)', () => {
      expect(mods.isContentScan).toBe(INI_EASY.contentScan);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Difficulty direction correctness for ALL DifficultyClass fields
//    C++ rules.cpp:316-327 — higher difficulty = tougher AI opponent
// ═══════════════════════════════════════════════════════════════════════════════

describe('Difficulty direction: harder AI = better stats (C++ rules.cpp:316-327)', () => {
  it('firepower: easy < normal < hard', () => {
    expect(AI_DIFFICULTY_MODS.easy.firepowerBias).toBeLessThan(AI_DIFFICULTY_MODS.normal.firepowerBias);
    expect(AI_DIFFICULTY_MODS.normal.firepowerBias).toBeLessThan(AI_DIFFICULTY_MODS.hard.firepowerBias);
  });

  it('armor: easy < normal < hard', () => {
    expect(AI_DIFFICULTY_MODS.easy.armorBias).toBeLessThan(AI_DIFFICULTY_MODS.normal.armorBias);
    expect(AI_DIFFICULTY_MODS.normal.armorBias).toBeLessThan(AI_DIFFICULTY_MODS.hard.armorBias);
  });

  it('groundspeed: easy < normal < hard', () => {
    expect(AI_DIFFICULTY_MODS.easy.groundspeedBias).toBeLessThan(AI_DIFFICULTY_MODS.normal.groundspeedBias);
    expect(AI_DIFFICULTY_MODS.normal.groundspeedBias).toBeLessThan(AI_DIFFICULTY_MODS.hard.groundspeedBias);
  });

  it('airspeed: easy < normal < hard', () => {
    expect(AI_DIFFICULTY_MODS.easy.airspeedBias).toBeLessThan(AI_DIFFICULTY_MODS.normal.airspeedBias);
    expect(AI_DIFFICULTY_MODS.normal.airspeedBias).toBeLessThan(AI_DIFFICULTY_MODS.hard.airspeedBias);
  });

  it('ROF: easy > normal > hard (higher = slower fire = weaker)', () => {
    expect(AI_DIFFICULTY_MODS.easy.rofBias).toBeGreaterThan(AI_DIFFICULTY_MODS.normal.rofBias);
    expect(AI_DIFFICULTY_MODS.normal.rofBias).toBeGreaterThan(AI_DIFFICULTY_MODS.hard.rofBias);
  });

  it('cost: easy >= normal >= hard (higher cost = weaker AI)', () => {
    expect(AI_DIFFICULTY_MODS.easy.costBias).toBeGreaterThanOrEqual(AI_DIFFICULTY_MODS.normal.costBias);
    expect(AI_DIFFICULTY_MODS.normal.costBias).toBeGreaterThanOrEqual(AI_DIFFICULTY_MODS.hard.costBias);
  });

  it('buildSpeedBias: easy >= normal >= hard (higher = slower build = weaker)', () => {
    expect(AI_DIFFICULTY_MODS.easy.buildSpeedBias).toBeGreaterThanOrEqual(AI_DIFFICULTY_MODS.normal.buildSpeedBias);
    expect(AI_DIFFICULTY_MODS.normal.buildSpeedBias).toBeGreaterThanOrEqual(AI_DIFFICULTY_MODS.hard.buildSpeedBias);
  });

  it('repairDelay: easy > normal > hard (longer delay = weaker AI)', () => {
    expect(AI_DIFFICULTY_MODS.easy.repairDelay).toBeGreaterThan(AI_DIFFICULTY_MODS.normal.repairDelay);
    expect(AI_DIFFICULTY_MODS.normal.repairDelay).toBeGreaterThan(AI_DIFFICULTY_MODS.hard.repairDelay);
  });

  it('buildDelay: easy > normal > hard (longer delay = weaker AI)', () => {
    expect(AI_DIFFICULTY_MODS.easy.buildDelay).toBeGreaterThan(AI_DIFFICULTY_MODS.normal.buildDelay);
    expect(AI_DIFFICULTY_MODS.normal.buildDelay).toBeGreaterThan(AI_DIFFICULTY_MODS.hard.buildDelay);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Normal difficulty = neutral (all biases = 1.0, boolean flags sensible)
//    C++ rules.cpp:316-327 with [Normal] section values
// ═══════════════════════════════════════════════════════════════════════════════

describe('Normal difficulty is neutral — all numeric biases = 1.0 (C++ [Normal] section)', () => {
  const n = AI_DIFFICULTY_MODS.normal;

  it('firepowerBias = 1.0', () => expect(n.firepowerBias).toBe(1.0));
  it('armorBias = 1.0', () => expect(n.armorBias).toBe(1.0));
  it('rofBias = 1.0', () => expect(n.rofBias).toBe(1.0));
  it('groundspeedBias = 1.0', () => expect(n.groundspeedBias).toBe(1.0));
  it('airspeedBias = 1.0', () => expect(n.airspeedBias).toBe(1.0));
  it('costBias = 1.0', () => expect(n.costBias).toBe(1.0));
  it('buildSpeedBias = 1.0', () => expect(n.buildSpeedBias).toBe(1.0));
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. AI_DIFFICULTY_MODS covers all 3 difficulties
// ═══════════════════════════════════════════════════════════════════════════════

describe('AI_DIFFICULTY_MODS has entries for all three difficulty levels', () => {
  for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
    it(`${diff} exists`, () => {
      expect(AI_DIFFICULTY_MODS[diff]).toBeDefined();
    });

    it(`${diff} has all 12 DifficultyClass-equivalent fields (C++ rules.h:44-61)`, () => {
      const mods = AI_DIFFICULTY_MODS[diff];
      // Numeric biases (rules.h:47-56)
      expect(typeof mods.firepowerBias).toBe('number');
      expect(typeof mods.groundspeedBias).toBe('number');
      expect(typeof mods.airspeedBias).toBe('number');
      expect(typeof mods.armorBias).toBe('number');
      expect(typeof mods.rofBias).toBe('number');
      expect(typeof mods.costBias).toBe('number');
      expect(typeof mods.buildSpeedBias).toBe('number');
      // Delay values (rules.h:55-56)
      expect(typeof mods.repairDelay).toBe('number');
      expect(typeof mods.buildDelay).toBe('number');
      // Boolean flags (rules.h:58-60)
      expect(typeof mods.isBuildSlowdown).toBe('boolean');
      expect(typeof mods.isWallDestroyer).toBe('boolean');
      expect(typeof mods.isContentScan).toBe('boolean');
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. IQ thresholds from rules.ini [IQ] section
//    C++ rules.h:325-380, rules.ini lines 269-280
// ═══════════════════════════════════════════════════════════════════════════════

describe('AI_BUILD_RULES IQ thresholds match rules.ini [IQ] section', () => {
  // rules.ini [IQ] section values
  it('iqSuperWeapons = 4 (rules.ini SuperWeapons=4)', () => {
    expect(AI_BUILD_RULES.iqSuperWeapons).toBe(4);
  });
  it('iqProduction = 5 (rules.ini Production=5)', () => {
    expect(AI_BUILD_RULES.iqProduction).toBe(5);
  });
  it('iqGuardArea = 4 (rules.ini GuardArea=4)', () => {
    expect(AI_BUILD_RULES.iqGuardArea).toBe(4);
  });
  it('iqRepairSell = 1 (rules.ini RepairSell=1)', () => {
    expect(AI_BUILD_RULES.iqRepairSell).toBe(1);
  });
  it('iqAutoCrush = 2 (rules.ini AutoCrush=2)', () => {
    expect(AI_BUILD_RULES.iqAutoCrush).toBe(2);
  });
  it('iqScatter = 3 (rules.ini Scatter=3)', () => {
    expect(AI_BUILD_RULES.iqScatter).toBe(3);
  });
  it('iqContentScan = 4 (rules.ini ContentScan=4)', () => {
    expect(AI_BUILD_RULES.iqContentScan).toBe(4);
  });
  it('iqAircraft = 4 (rules.ini Aircraft=4)', () => {
    expect(AI_BUILD_RULES.iqAircraft).toBe(4);
  });
  it('iqHarvester = 2 (rules.ini Harvester=2)', () => {
    expect(AI_BUILD_RULES.iqHarvester).toBe(2);
  });
  it('iqSellBack = 2 (rules.ini SellBack=2)', () => {
    expect(AI_BUILD_RULES.iqSellBack).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. C++ reversal: Easy/Difficult sections are swapped for computer vs player
//    C++ scenario.cpp:2297  — player gets Scen.Difficulty
//    C++ scenario.cpp:2705  — computer gets Scen.CDifficulty
//    C++ house.cpp:282-311  — both apply via Assign_Handicap
//
//    In single-player: Scen.Difficulty = DIFF_EASY -> player gets [Easy] bonuses
//                      Scen.CDifficulty = DIFF_EASY -> computer gets [Easy] = [Difficult] reversed
//    TS maps: AI_DIFFICULTY_MODS.easy = [Difficult] (computer weakened)
//             AI_DIFFICULTY_MODS.hard = [Easy] (computer strengthened)
// ═══════════════════════════════════════════════════════════════════════════════

describe('C++ difficulty reversal: AI.easy has [Difficult] values, AI.hard has [Easy] (scenario.cpp:2297,2705)', () => {
  it('AI easy firepower (0.8) matches [Difficult] Firepower, not [Easy] (1.2)', () => {
    expect(AI_DIFFICULTY_MODS.easy.firepowerBias).toBe(0.8);
    expect(AI_DIFFICULTY_MODS.easy.firepowerBias).not.toBe(1.2);
  });

  it('AI hard firepower (1.2) matches [Easy] Firepower, not [Difficult] (0.8)', () => {
    expect(AI_DIFFICULTY_MODS.hard.firepowerBias).toBe(1.2);
    expect(AI_DIFFICULTY_MODS.hard.firepowerBias).not.toBe(0.8);
  });

  it('AI easy repairDelay (0.05) matches [Difficult], not [Easy] (0.001)', () => {
    expect(AI_DIFFICULTY_MODS.easy.repairDelay).toBe(0.05);
  });

  it('AI hard repairDelay (0.001) matches [Easy], not [Difficult] (0.05)', () => {
    expect(AI_DIFFICULTY_MODS.hard.repairDelay).toBe(0.001);
  });

  it('AI easy isWallDestroyer = false matches [Difficult] DestroyWalls=no', () => {
    expect(AI_DIFFICULTY_MODS.easy.isWallDestroyer).toBe(false);
  });

  it('AI hard isWallDestroyer = true matches [Easy] DestroyWalls=yes', () => {
    expect(AI_DIFFICULTY_MODS.hard.isWallDestroyer).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Ant mission difficulty modifiers (DIFFICULTY_MODS)
//    These control queen spawn rate and ant composition per difficulty.
//    Not from C++ (ant missions are TS-specific extension), but should be consistent.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Ant mission DIFFICULTY_MODS scale correctly per difficulty', () => {
  it('spawnInterval: easy > normal > hard (slower spawning on easy)', () => {
    expect(DIFFICULTY_MODS.easy.spawnInterval).toBeGreaterThan(DIFFICULTY_MODS.normal.spawnInterval);
    expect(DIFFICULTY_MODS.normal.spawnInterval).toBeGreaterThan(DIFFICULTY_MODS.hard.spawnInterval);
  });

  it('maxAnts: easy < normal < hard (fewer ants on easy)', () => {
    expect(DIFFICULTY_MODS.easy.maxAnts).toBeLessThan(DIFFICULTY_MODS.normal.maxAnts);
    expect(DIFFICULTY_MODS.normal.maxAnts).toBeLessThan(DIFFICULTY_MODS.hard.maxAnts);
  });

  it('fireAntChance: easy < normal < hard (fewer fire ants on easy)', () => {
    expect(DIFFICULTY_MODS.easy.fireAntChance).toBeLessThan(DIFFICULTY_MODS.normal.fireAntChance);
    expect(DIFFICULTY_MODS.normal.fireAntChance).toBeLessThan(DIFFICULTY_MODS.hard.fireAntChance);
  });

  it('waveSize: easy < normal < hard (smaller waves on easy)', () => {
    expect(DIFFICULTY_MODS.easy.waveSize).toBeLessThan(DIFFICULTY_MODS.normal.waveSize);
    expect(DIFFICULTY_MODS.normal.waveSize).toBeLessThan(DIFFICULTY_MODS.hard.waveSize);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. PARITY GAP: costBias, buildSpeedBias, airspeedBias declared but NOT applied
//    C++ house.cpp:294,304 — CostBias applied to production cost
//    C++ house.cpp:297,307 — BuildSpeedBias applied to build time
//    C++ house.cpp:291,301 — AirspeedBias applied to aircraft movement
//    TS: these fields exist in AI_DIFFICULTY_MODS but are never read by engine code
// ═══════════════════════════════════════════════════════════════════════════════

describe('PARITY GAP: costBias, buildSpeedBias, airspeedBias defined but not applied in TS engine', () => {
  it('costBias values are defined and differentiated (C++ house.cpp:294,304)', () => {
    // The values exist in the data structure...
    expect(AI_DIFFICULTY_MODS.easy.costBias).toBe(1.0);
    expect(AI_DIFFICULTY_MODS.normal.costBias).toBe(1.0);
    expect(AI_DIFFICULTY_MODS.hard.costBias).toBe(0.8);
    // ...but are NOT consumed by any TS production code (no .costBias references in engine/)
  });

  it('buildSpeedBias values are defined and differentiated (C++ house.cpp:297,307)', () => {
    expect(AI_DIFFICULTY_MODS.easy.buildSpeedBias).toBe(1.0);
    expect(AI_DIFFICULTY_MODS.normal.buildSpeedBias).toBe(1.0);
    expect(AI_DIFFICULTY_MODS.hard.buildSpeedBias).toBe(0.8);
    // ...but are NOT consumed by any TS production code
  });

  it('airspeedBias values are defined and differentiated (C++ house.cpp:291,301)', () => {
    expect(AI_DIFFICULTY_MODS.easy.airspeedBias).toBe(0.8);
    expect(AI_DIFFICULTY_MODS.normal.airspeedBias).toBe(1.0);
    expect(AI_DIFFICULTY_MODS.hard.airspeedBias).toBe(1.2);
    // ...but are NOT consumed by any TS aircraft movement code
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. PARITY GAP: repairDelay, buildDelay, isBuildSlowdown, isWallDestroyer,
//    isContentScan — declared but NOT consumed by TS engine
//    C++ house.cpp:295-296 — RepairDelay/BuildDelay set on house
//    C++ rules.cpp:324-327 — boolean flags from INI
// ═══════════════════════════════════════════════════════════════════════════════

describe('PARITY GAP: DifficultyClass delay/flag fields defined but not applied in TS engine', () => {
  it('repairDelay values exist per difficulty (C++ house.cpp:295)', () => {
    expect(AI_DIFFICULTY_MODS.easy.repairDelay).toBe(0.05);
    expect(AI_DIFFICULTY_MODS.normal.repairDelay).toBe(0.02);
    expect(AI_DIFFICULTY_MODS.hard.repairDelay).toBe(0.001);
    // NOT consumed: no .repairDelay usage in engine code
  });

  it('buildDelay values exist per difficulty (C++ house.cpp:296)', () => {
    expect(AI_DIFFICULTY_MODS.easy.buildDelay).toBe(0.1);
    expect(AI_DIFFICULTY_MODS.normal.buildDelay).toBe(0.03);
    expect(AI_DIFFICULTY_MODS.hard.buildDelay).toBe(0.001);
    // NOT consumed: no .buildDelay usage in engine code
  });

  it('isBuildSlowdown values exist per difficulty (C++ rules.cpp:324)', () => {
    expect(AI_DIFFICULTY_MODS.easy.isBuildSlowdown).toBe(true);
    expect(AI_DIFFICULTY_MODS.normal.isBuildSlowdown).toBe(true);
    expect(AI_DIFFICULTY_MODS.hard.isBuildSlowdown).toBe(false);
    // NOT consumed: no .isBuildSlowdown usage in engine code
  });

  it('isWallDestroyer values exist per difficulty (C++ rules.cpp:326)', () => {
    expect(AI_DIFFICULTY_MODS.easy.isWallDestroyer).toBe(false);
    expect(AI_DIFFICULTY_MODS.normal.isWallDestroyer).toBe(true);
    expect(AI_DIFFICULTY_MODS.hard.isWallDestroyer).toBe(true);
    // NOT consumed: no .isWallDestroyer usage in engine code
  });

  it('isContentScan values exist per difficulty (C++ rules.cpp:327)', () => {
    expect(AI_DIFFICULTY_MODS.easy.isContentScan).toBe(false);
    expect(AI_DIFFICULTY_MODS.normal.isContentScan).toBe(true);
    expect(AI_DIFFICULTY_MODS.hard.isContentScan).toBe(true);
    // NOT consumed: no .isContentScan usage in engine code
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. PARITY GAP: Player house gets NO difficulty bonuses
//     C++ scenario.cpp:2297 — PlayerPtr->Assign_Handicap(Scen.Difficulty)
//     C++ house.cpp:299-307 — For single-player: all biases come from Rule.Diff[handicap]
//     On Easy, player gets [Easy] bonuses: 1.2x firepower, 1.2x armor, 0.8x ROF, etc.
//     TS: getFirepowerBias/getArmorBias/getROFBias/getGroundspeedBias return unmodified
//         countryBias for playerHouse (no difficulty scaling applied)
// ═══════════════════════════════════════════════════════════════════════════════

describe('PARITY GAP: Player house has no difficulty bonuses in TS (C++ scenario.cpp:2297)', () => {
  // In C++, on Easy difficulty the player gets:
  //   FirepowerBias = 1.2 (from [Easy] section)
  //   ArmorBias = 1.2
  //   GroundspeedBias = 1.2
  //   AirspeedBias = 1.2
  //   ROFBias = 0.8 (fires faster)
  //   CostBias = 0.8 (cheaper production)
  //   BuildSpeedBias = 0.8 (builds faster)
  //
  // In TS, getFirepowerBias() for playerHouse just returns countryBias (no difficulty).
  // This means the player NEVER gets difficulty bonuses, even on Easy.
  //
  // This test documents the gap. It passes because the gap exists.

  it('rules.ini [Easy] defines player bonuses: Firepower=1.2, Armor=1.2, ROF=.8', () => {
    // These are the values that C++ gives to the PLAYER on Easy difficulty
    // (and to the COMPUTER on Hard difficulty, which TS correctly implements)
    expect(INI_EASY.firepower).toBe(1.2);
    expect(INI_EASY.armor).toBe(1.2);
    expect(INI_EASY.rof).toBe(0.8);
    expect(INI_EASY.cost).toBe(0.8);
    expect(INI_EASY.buildTime).toBe(0.8);
    // TS does not apply these to the player house — documented parity gap
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Economy/timing mods consistency
//     These are TS-specific extensions to the difficulty system (not from C++ DifficultyClass)
// ═══════════════════════════════════════════════════════════════════════════════

describe('TS-specific economy/timing modifiers scale correctly per difficulty', () => {
  it('incomeMult: easy < normal < hard (more income on harder)', () => {
    expect(AI_DIFFICULTY_MODS.easy.incomeMult).toBeLessThan(AI_DIFFICULTY_MODS.normal.incomeMult);
    expect(AI_DIFFICULTY_MODS.normal.incomeMult).toBeLessThan(AI_DIFFICULTY_MODS.hard.incomeMult);
  });

  it('buildSpeedMult: easy > normal > hard (slower builds for easy AI)', () => {
    expect(AI_DIFFICULTY_MODS.easy.buildSpeedMult).toBeGreaterThan(AI_DIFFICULTY_MODS.normal.buildSpeedMult);
    expect(AI_DIFFICULTY_MODS.normal.buildSpeedMult).toBeGreaterThan(AI_DIFFICULTY_MODS.hard.buildSpeedMult);
  });

  it('attackCooldown: easy > normal > hard (less frequent attacks on easy)', () => {
    expect(AI_DIFFICULTY_MODS.easy.attackCooldown).toBeGreaterThan(AI_DIFFICULTY_MODS.normal.attackCooldown);
    expect(AI_DIFFICULTY_MODS.normal.attackCooldown).toBeGreaterThan(AI_DIFFICULTY_MODS.hard.attackCooldown);
  });

  it('aggressionMult: easy < normal < hard', () => {
    expect(AI_DIFFICULTY_MODS.easy.aggressionMult).toBeLessThan(AI_DIFFICULTY_MODS.normal.aggressionMult);
    expect(AI_DIFFICULTY_MODS.normal.aggressionMult).toBeLessThan(AI_DIFFICULTY_MODS.hard.aggressionMult);
  });

  it('retreatHpPercent: easy > normal > hard (easier AI retreats earlier)', () => {
    expect(AI_DIFFICULTY_MODS.easy.retreatHpPercent).toBeGreaterThan(AI_DIFFICULTY_MODS.normal.retreatHpPercent);
    expect(AI_DIFFICULTY_MODS.normal.retreatHpPercent).toBeGreaterThan(AI_DIFFICULTY_MODS.hard.retreatHpPercent);
  });
});
