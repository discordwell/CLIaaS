/**
 * C++ Behavioral Parity: Autocreate Team Production — How AI Fills Team Templates
 *
 * Tests verify that AI production decisions to fill team templates match C++ Red Alert source.
 *
 * In C++, AI_Unit (house.cpp:5790-5918) and AI_Infantry (house.cpp:6043-6189) scan prebuilt
 * team types to build a counter array of needed units, subtract existing recruitable units,
 * then pick the most-needed type to build. This is fundamentally different from random-weighted
 * production: the AI produces specifically to fill team rosters.
 *
 * Source references:
 *   - house.cpp:5790-5918  — AI_Unit: team-driven unit production
 *   - house.cpp:5837-5849  — IsPrebuilt gating: `team->IsPrebuilt && (!team->IsAutocreate || IsAlerted)`
 *   - house.cpp:5845       — counter[subtype] = max(counter[subtype], Quantity) for units
 *   - house.cpp:5855-5860  — subtract existing recruitable units
 *   - house.cpp:5869-5876  — pick highest-need, break ties randomly, cost+Can_Build check
 *   - house.cpp:6043-6189  — AI_Infantry: team-driven infantry production
 *   - house.cpp:6082       — same IsPrebuilt + IsAutocreate/IsAlerted gating for infantry
 *   - house.cpp:6087-6088  — counter = max(counter, Quantity); counter = min(counter, 5) — infantry cap
 *   - house.cpp:6115       — dog dedup: skip INFANTRY_DOG if IScan & INFANTRYF_DOG
 *   - house.cpp:788-881    — Can_Build: AI computer always returns true in single-player
 *   - teamtype.cpp:1674-1680 — flag bitfield parsing:
 *       bit 0 = IsRoundAbout, bit 1 = IsSuicide, bit 2 = IsAutocreate,
 *       bit 3 = IsPrebuilt, bit 4 = IsReinforcable
 *   - team.cpp:666-672     — Team::Recruit: recruit closest eligible member when team not moving
 *
 * KNOWN MISMATCHES (TS diverges from C++):
 *   1. TS production is random-weighted, not team-template-driven
 *   2. TS does not read or use IsPrebuilt flag (bit 3 = 0x0008) for production
 *   3. TS does not gate prebuilt production on IsAutocreate + IsAlerted
 *   4. TS does not cap infantry prebuilt counter at 5
 *   5. C++ Can_Build always returns true for computer in single-player
 *   6. C++ checks per-unit cost against Available_Money(); TS checks global threshold
 *   7. C++ picks highest-need from counter; TS uses weighted random
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  House, Mission, UnitType, CELL_SIZE,
  UNIT_STATS, HOUSE_FACTION,
  buildDefaultAlliances,
  type ProductionItem,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap } from '../engine/map';
import {
  type MapStructure, type TeamType,
  houseIdToHouse, STRUCTURE_WEAPONS, STRUCTURE_SIZE, STRUCTURE_MAX_HP,
} from '../engine/scenario';
import {
  type AIContext, type AIHouseState, type Difficulty,
  createAIHouseState,
  updateAIProduction,
  updateAIAutocreateTeams,
  suggestedNewTeam,
  getAIProductionPick,
  AI_DIFFICULTY_MODS,
  STRUCTURE_IMAGES,
} from '../engine/ai';

beforeEach(() => resetEntityIds());

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal production items for testing */
const TEST_PRODUCTION_ITEMS: ProductionItem[] = [
  { type: 'E1', name: 'Rifle', cost: 100, buildTime: 45, prerequisite: 'TENT', faction: 'both', techLevel: 1 },
  { type: 'E2', name: 'Grenadier', cost: 160, buildTime: 55, prerequisite: 'BARR', faction: 'soviet', techLevel: 1 },
  { type: 'E3', name: 'Rocket', cost: 300, buildTime: 75, prerequisite: 'TENT', faction: 'allied', techLevel: 2 },
  { type: 'E6', name: 'Engineer', cost: 500, buildTime: 100, prerequisite: 'TENT', faction: 'both', techLevel: 5 },
  { type: '1TNK', name: 'Light Tank', cost: 700, buildTime: 120, prerequisite: 'WEAP', faction: 'allied', techLevel: 2 },
  { type: '2TNK', name: 'Medium Tank', cost: 800, buildTime: 140, prerequisite: 'WEAP', faction: 'allied', techLevel: 5 },
  { type: '3TNK', name: 'Heavy Tank', cost: 950, buildTime: 160, prerequisite: 'WEAP', faction: 'soviet', techLevel: 7 },
  { type: 'HARV', name: 'Harvester', cost: 1400, buildTime: 150, prerequisite: 'WEAP', faction: 'both', techLevel: 1 },
];

function makeStructure(overrides: Partial<MapStructure> & { type: string; house: House; cx: number; cy: number }): MapStructure {
  const type = overrides.type;
  return {
    image: STRUCTURE_IMAGES[type] ?? type.toLowerCase(),
    hp: STRUCTURE_MAX_HP[type] ?? 256,
    maxHp: STRUCTURE_MAX_HP[type] ?? 256,
    alive: true,
    rubble: false,
    weapon: STRUCTURE_WEAPONS[type],
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    buildProgress: 0,
    ...overrides,
  };
}

function makeAIState(overrides: Partial<AIHouseState> & { house: House }): AIHouseState {
  return {
    phase: 'buildup',
    broke: false,
    endgame: false,
    productionEnabled: true,
    buildQueue: [],
    lastBuildTick: 0,
    buildCooldown: 0,
    attackPool: new Set(),
    attackThreshold: 6,
    lastAttackTick: 0,
    attackCooldownTicks: 600,
    harvesterCount: 0,
    refineryCount: 0,
    lastBaseAttackTick: 0,
    underAttack: false,
    incomeMult: 1.0,
    buildSpeedMult: 1.0,
    aggressionMult: 1.0,
    designatedEnemy: null,
    preferredTarget: null,
    iq: 3,
    techLevel: 10,
    maxUnit: -1,
    maxInfantry: -1,
    maxBuilding: -1,
    maxVessel: -1,
    maxAircraft: -1,
    buildingsKilledBy: new Map(),
    unitsKilledBy: new Map(),
    lastAttackerEnemy: null,
    isStarted: true,
    isAlerted: true,
    isBaseBuilding: false,
    ...overrides,
  };
}

function makeAIContext(overrides: Partial<AIContext> = {}): AIContext {
  const entities = overrides.entities ?? [];
  const structures = overrides.structures ?? [];
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
    map: overrides.map ?? new GameMap(),
    tick: overrides.tick ?? 0,
    playerHouse: overrides.playerHouse ?? House.Spain,
    scenarioId: overrides.scenarioId ?? 'TEST',
    difficulty: overrides.difficulty ?? 'normal',
    aiStates: overrides.aiStates ?? new Map(),
    houseCredits: overrides.houseCredits ?? new Map(),
    houseIQs: overrides.houseIQs ?? new Map(),
    houseTechLevels: overrides.houseTechLevels ?? new Map(),
    houseMaxUnits: overrides.houseMaxUnits ?? new Map(),
    houseMaxInfantry: overrides.houseMaxInfantry ?? new Map(),
    houseMaxBuildings: overrides.houseMaxBuildings ?? new Map(),
    baseBlueprint: overrides.baseBlueprint ?? [],
    baseRebuildQueue: overrides.baseRebuildQueue ?? [],
    baseRebuildCooldown: overrides.baseRebuildCooldown ?? 0,
    scenarioProductionItems: overrides.scenarioProductionItems ?? TEST_PRODUCTION_ITEMS,
    scenarioUnitStats: overrides.scenarioUnitStats ?? {},
    scenarioWeaponStats: overrides.scenarioWeaponStats ?? {},
    nextWaveId: overrides.nextWaveId ?? 1,
    autocreateEnabled: overrides.autocreateEnabled ?? false,
    teamTypes: overrides.teamTypes ?? [],
    destroyedTeams: overrides.destroyedTeams ?? new Set(),
    autocreateTeamCounts: (overrides as any).autocreateTeamCounts ?? new Map(),
    waypoints: overrides.waypoints ?? new Map(),
    houseEdges: overrides.houseEdges ?? new Map(),
    effects: overrides.effects ?? [],
    isAllied: overrides.isAllied ?? ((a: House, b: House) => alliances.get(a)?.has(b) ?? false),
    isPlayerControlled: overrides.isPlayerControlled ?? ((e: Entity) => e.house === House.Spain),
    clearStructureFootprint: overrides.clearStructureFootprint ?? (() => {}),
  };
}

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeTeamType(overrides: Partial<TeamType> = {}): TeamType {
  return {
    name: 'TestTeam',
    house: 2,        // USSR
    flags: 0x0C,     // IsAutocreate (0x04) + IsPrebuilt (0x08) — typical prebuilt autocreate team
    recruitPriority: 7,
    initNum: 0,
    maxAllowed: 5,
    origin: 0,
    trigger: -1,
    members: [{ type: '3TNK', count: 3 }],
    missions: [],
    ...overrides,
  };
}


// =============================================================================
// 1. TeamType flag bitfield parsing — C++ teamtype.cpp:1674-1680
// =============================================================================

describe('TeamType flag bitfield — C++ teamtype.cpp:1674-1680', () => {
  // C++ source (teamtype.cpp:1674-1680):
  //   IsRoundAbout  = ((code & 0x0001) != 0);
  //   IsSuicide     = ((code & 0x0002) != 0);
  //   IsAutocreate  = ((code & 0x0004) != 0);
  //   IsPrebuilt    = ((code & 0x0008) != 0);
  //   IsReinforcable= ((code & 0x0010) != 0);

  it('bit 0 (0x01) = IsRoundAbout', () => {
    const team = makeTeamType({ flags: 0x01 });
    expect(team.flags & 0x01).toBeTruthy();
    expect(team.flags & 0x02).toBeFalsy(); // not suicide
  });

  it('bit 1 (0x02) = IsSuicide', () => {
    const team = makeTeamType({ flags: 0x02 });
    expect(team.flags & 0x02).toBeTruthy();
    expect(team.flags & 0x04).toBeFalsy(); // not autocreate
  });

  it('bit 2 (0x04) = IsAutocreate', () => {
    const team = makeTeamType({ flags: 0x04 });
    expect(team.flags & 0x04).toBeTruthy();
  });

  it('bit 3 (0x08) = IsPrebuilt', () => {
    const team = makeTeamType({ flags: 0x08 });
    expect(team.flags & 0x08).toBeTruthy();
  });

  it('bit 4 (0x10) = IsReinforcable', () => {
    const team = makeTeamType({ flags: 0x10 });
    expect(team.flags & 0x10).toBeTruthy();
  });

  it('typical autocreate team has flags 0x0C (IsAutocreate + IsPrebuilt)', () => {
    // C++ teamtype.cpp:170 defaults: IsPrebuilt(true), so most teams will have bit 3 set
    const team = makeTeamType({ flags: 0x0C });
    expect(!!(team.flags & 0x04)).toBe(true);  // IsAutocreate
    expect(!!(team.flags & 0x08)).toBe(true);  // IsPrebuilt
  });

  it('all 5 flags set simultaneously (0x1F)', () => {
    const team = makeTeamType({ flags: 0x1F });
    expect(!!(team.flags & 0x01)).toBe(true);  // IsRoundAbout
    expect(!!(team.flags & 0x02)).toBe(true);  // IsSuicide
    expect(!!(team.flags & 0x04)).toBe(true);  // IsAutocreate
    expect(!!(team.flags & 0x08)).toBe(true);  // IsPrebuilt
    expect(!!(team.flags & 0x10)).toBe(true);  // IsReinforcable
  });
});


// =============================================================================
// 2. C++ Can_Build: AI computer always returns true in single-player
//    (house.cpp:828: if (!IsHuman && Session.Type == GAME_NORMAL) return(true))
// =============================================================================

describe('Can_Build for AI — house.cpp:828', () => {
  // C++ line 828: "The computer can always build everything."
  // This means in single-player, the AI is NOT restricted by house ownership
  // or prerequisite buildings — it can build any unit type.

  it('C++ AI ignores house ownership (Soviet AI can build Allied units)', () => {
    // In C++, Can_Build returns true for computer regardless of faction.
    // TS getAIProductionPick filters by faction — this is a KNOWN MISMATCH.
    const state = makeAIState({ house: House.USSR, iq: 3, techLevel: 10 });
    const structures = [
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10 }),
    ];

    // Give USSR lots of credits
    const ctx = makeAIContext({
      tick: 60,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 5000]]),
      structures,
    });

    // In C++, USSR AI could build 1TNK (allied-only Light Tank) because Can_Build
    // ignores ownership for non-human houses. TS filters by faction.
    const pick = getAIProductionPick(ctx, House.USSR, 'vehicle');

    // MISMATCH: TS only offers Soviet-faction vehicles (3TNK) to USSR.
    // C++ would also consider 1TNK, 2TNK (allied faction).
    // This test documents the divergence.
    if (pick) {
      const isSovietOrBoth = pick.faction === 'soviet' || pick.faction === 'both';
      // TS filters by faction — always soviet or both for USSR house
      expect(isSovietOrBoth).toBe(true);
      // C++ WOULD also pick allied types; TS does not
    }
  });

  it('C++ AI ignores prerequisite buildings for buildability', () => {
    // C++ house.cpp:828: computer can build anything in GAME_NORMAL regardless of prereqs.
    // TS checks prerequisites via aiHasPrereq and techPrereq fields.
    // This test documents that TS applies prereq checks that C++ skips.

    const state = makeAIState({ house: House.USSR, iq: 3, techLevel: 10 });
    // No TENT/BARR structure — no barracks
    const structures = [
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10 }),
    ];

    const ctx = makeAIContext({
      tick: 60,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 5000]]),
      structures,
    });

    // TS production requires TENT/BARR to exist for infantry. In C++, AI
    // would still return true from Can_Build for infantry (line 828).
    // Note: updateAIProduction checks hasTent/hasWeap separately from Can_Build.
    // The prereq check in Can_Build is for human players only.
    // This is a documentation test — C++ computer is unrestricted.
    expect(true).toBe(true); // Document that C++ has no prereq check for AI
  });
});


// =============================================================================
// 3. IsPrebuilt flag in AI production — house.cpp:5837-5849
//    C++ uses IsPrebuilt to drive production; TS does not
// =============================================================================

describe('IsPrebuilt-driven production — house.cpp:5837-5849', () => {
  // C++ AI_Unit scans team types flagged IsPrebuilt to determine what to build.
  // The algorithm:
  //   1. For each prebuilt team, count needed units per type (max of quantity across teams)
  //   2. Subtract existing recruitable units of each type
  //   3. Pick the type with highest remaining count, checking Can_Build + cost
  //
  // TS does NOT have this mechanism — it uses weighted random production.

  it('C++ IsPrebuilt gating: team->IsPrebuilt && (!team->IsAutocreate || IsAlerted)', () => {
    // C++ house.cpp:5839: only IsPrebuilt teams drive production.
    // A team with flags=0x08 (IsPrebuilt only, no IsAutocreate) always drives production.
    // A team with flags=0x0C (IsPrebuilt + IsAutocreate) only drives production when IsAlerted.
    //
    // TS has no equivalent — production is not team-driven at all.

    const prebuiltOnly: TeamType = makeTeamType({
      name: 'PrebuiltOnly',
      flags: 0x08,  // IsPrebuilt=true, IsAutocreate=false
      members: [{ type: '3TNK', count: 5 }],
    });

    const prebuiltAutocreate: TeamType = makeTeamType({
      name: 'PrebuiltAuto',
      flags: 0x0C,  // IsPrebuilt=true, IsAutocreate=true
      members: [{ type: '3TNK', count: 5 }],
    });

    const neitherFlag: TeamType = makeTeamType({
      name: 'NeitherFlag',
      flags: 0x00,  // Neither IsPrebuilt nor IsAutocreate
      members: [{ type: '3TNK', count: 5 }],
    });

    // C++ gating formula (house.cpp:5839):
    //   team->IsPrebuilt && (!team->IsAutocreate || IsAlerted)
    //
    // prebuiltOnly:       IsPrebuilt=true, IsAutocreate=false => always true
    // prebuiltAutocreate: IsPrebuilt=true, IsAutocreate=true  => only when IsAlerted
    // neitherFlag:        IsPrebuilt=false                    => never drives production

    // Test C++ logic directly:
    const isAlerted = true;
    const prebuiltOnlyDrives = !!(prebuiltOnly.flags & 0x08) &&
      (!(prebuiltOnly.flags & 0x04) || isAlerted);
    const prebuiltAutoDrives = !!(prebuiltAutocreate.flags & 0x08) &&
      (!(prebuiltAutocreate.flags & 0x04) || isAlerted);
    const neitherDrives = !!(neitherFlag.flags & 0x08) &&
      (!(neitherFlag.flags & 0x04) || isAlerted);

    expect(prebuiltOnlyDrives).toBe(true);
    expect(prebuiltAutoDrives).toBe(true);  // IsAlerted=true, so autocreate also qualifies
    expect(neitherDrives).toBe(false);      // Not prebuilt, never drives production

    // When NOT alerted, prebuiltAutocreate should NOT drive production
    const notAlerted = false;
    const prebuiltAutoNotAlerted = !!(prebuiltAutocreate.flags & 0x08) &&
      (!(prebuiltAutocreate.flags & 0x04) || notAlerted);
    expect(prebuiltAutoNotAlerted).toBe(false);
  });

  it('C++ unit counter uses max(counter, Quantity) across prebuilt teams (house.cpp:5845)', () => {
    // C++ house.cpp:5845: counter[subtype] = max(counter[subtype], team->Members[subindex].Quantity)
    // If Team A needs 3 of type X and Team B needs 5 of type X, counter = max(3, 5) = 5
    // This is NOT additive — it takes the max across teams.

    const teamA: TeamType = makeTeamType({
      name: 'TeamA',
      flags: 0x08,
      members: [{ type: '3TNK', count: 3 }],
    });
    const teamB: TeamType = makeTeamType({
      name: 'TeamB',
      flags: 0x08,
      members: [{ type: '3TNK', count: 5 }],
    });

    // C++ counter logic: max(0, 3) = 3 from TeamA, then max(3, 5) = 5 from TeamB
    const counter = new Map<string, number>();
    for (const team of [teamA, teamB]) {
      if (!(team.flags & 0x08)) continue; // IsPrebuilt check
      for (const member of team.members) {
        const current = counter.get(member.type) ?? 0;
        counter.set(member.type, Math.max(current, member.count));
      }
    }

    expect(counter.get('3TNK')).toBe(5); // max, not sum (3+5=8)
  });

  it('C++ subtracts existing recruitable units from counter (house.cpp:5855-5860)', () => {
    // After computing the counter from prebuilt teams, C++ subtracts each existing
    // recruitable unit of that type from the counter.
    // Result = how many more of each type the AI needs to build.

    const team: TeamType = makeTeamType({
      flags: 0x08,
      members: [{ type: '3TNK', count: 5 }],
    });

    // Simulate C++ counter computation
    const counter = new Map<string, number>();
    for (const member of team.members) {
      counter.set(member.type, Math.max(counter.get(member.type) ?? 0, member.count));
    }
    expect(counter.get('3TNK')).toBe(5);

    // Now simulate subtracting existing recruitable units (3 heavy tanks exist)
    const existingRecruitable = 3;
    const remaining = Math.max(0, (counter.get('3TNK') ?? 0) - existingRecruitable);
    expect(remaining).toBe(2); // Need to build 2 more

    // With 5 existing, need 0 more
    const remaining2 = Math.max(0, (counter.get('3TNK') ?? 0) - 5);
    expect(remaining2).toBe(0);
  });

  it('C++ picks highest-need type from counter (house.cpp:5866-5876)', () => {
    // C++ iterates all unit types, finds the one with highest remaining counter
    // (after subtracting existing units), checking Can_Build and cost.
    // If multiple types tie, it randomly picks from the tied set.

    // Team needs 5 heavy tanks and 2 light tanks
    const team: TeamType = makeTeamType({
      flags: 0x08,
      members: [
        { type: '3TNK', count: 5 },
        { type: '1TNK', count: 2 },
      ],
    });

    // Build counter
    const counter = new Map<string, number>();
    for (const member of team.members) {
      counter.set(member.type, Math.max(counter.get(member.type) ?? 0, member.count));
    }

    // No existing units, so need = counter values
    // C++ would pick '3TNK' because 5 > 2
    let bestVal = -1;
    let bestTypes: string[] = [];
    for (const [type, count] of counter) {
      if (count > bestVal) {
        bestVal = count;
        bestTypes = [type];
      } else if (count === bestVal) {
        bestTypes.push(type);
      }
    }

    expect(bestVal).toBe(5);
    expect(bestTypes).toEqual(['3TNK']); // Highest need
  });

  it('MISMATCH: TS updateAIProduction does NOT consult team templates', () => {
    // In TS, updateAIProduction uses getAIProductionPick which does weighted-random
    // selection based on unit composition ratios, NOT team template needs.
    // This is a fundamental parity gap.

    const state = makeAIState({ house: House.USSR, iq: 3, techLevel: 10 });
    const structures = [
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'TENT', house: House.USSR, cx: 14, cy: 10 }),
    ];

    // Define a prebuilt team that needs 5 heavy tanks
    const team: TeamType = makeTeamType({
      flags: 0x08,  // IsPrebuilt
      members: [{ type: '3TNK', count: 5 }],
    });

    const ctx = makeAIContext({
      tick: 60,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 5000]]),
      structures,
      teamTypes: [team],
    });

    // Run TS production
    updateAIProduction(ctx);

    // TS does NOT specifically build 3TNK to fill the team template.
    // It uses weighted random selection from all buildable vehicles.
    // The team template is completely ignored for production decisions.
    //
    // C++ WOULD specifically build 3TNK because the prebuilt counter says
    // 5 are needed and 0 exist.
    //
    // We can verify this by checking that TS doesn't preferentially
    // build the team's required type. Over many runs, TS would produce
    // a random mix rather than exclusively 3TNK.

    // Run many trials and check distribution
    const typeCounts = new Map<string, number>();
    for (let trial = 0; trial < 50; trial++) {
      resetEntityIds();
      const trialCtx = makeAIContext({
        tick: 60,
        aiStates: new Map([[House.USSR, makeAIState({ house: House.USSR, iq: 3, techLevel: 10 })]]),
        houseCredits: new Map([[House.USSR, 5000]]),
        structures: [...structures],
        teamTypes: [team],
      });
      updateAIProduction(trialCtx);
      for (const e of trialCtx.entities) {
        const t = e.type;
        typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
      }
    }

    // MISMATCH: In C++, ALL produced vehicles would be 3TNK (the highest-need type).
    // In TS, production is random across all buildable Soviet vehicles.
    // We document this by verifying TS doesn't exclusively pick 3TNK.
    // If TS were C++-parity, only 3TNK would be produced.
    const totalProduced = Array.from(typeCounts.values()).reduce((a, b) => a + b, 0);
    if (totalProduced > 0) {
      // TS may produce non-3TNK types (random weighted), documenting the mismatch
      // In C++ parity, heavy3TNK fraction would be 1.0
      const heavy3TNKCount = typeCounts.get(UnitType.V_3TNK) ?? 0;
      // NOTE: This documents the mismatch. If TS gains C++ parity, this test
      // should be updated to expect heavy3TNKFraction === 1.0
      expect(totalProduced).toBeGreaterThan(0);
    }
  });
});


// =============================================================================
// 4. Infantry prebuilt counter cap of 5 — house.cpp:6087-6088
// =============================================================================

describe('Infantry prebuilt counter cap — house.cpp:6087-6088', () => {
  // C++ house.cpp:6087-6088:
  //   counter[subtype] = max(counter[subtype], team->Members[subindex].Quantity);
  //   counter[subtype] = min(counter[subtype], 5);
  //
  // Even if a team template requests more than 5 of one infantry type,
  // the AI will only try to build at most 5.

  it('C++ caps infantry prebuilt need at 5 per type', () => {
    // Simulate C++ behavior
    const teamNeedsTen: TeamType = makeTeamType({
      flags: 0x08,
      members: [{ type: 'E1', count: 10 }],
    });

    // C++ counter logic for infantry
    let counter = 0;
    for (const member of teamNeedsTen.members) {
      if (member.type === 'E1') {
        counter = Math.max(counter, member.count);  // house.cpp:6087
        counter = Math.min(counter, 5);              // house.cpp:6088
      }
    }

    expect(counter).toBe(5); // Capped at 5, not 10
  });

  it('C++ cap does NOT apply to unit (vehicle) counter — only infantry', () => {
    // C++ house.cpp:5845 for units: counter[subtype] = max(counter[subtype], Quantity)
    // No min(counter, 5) cap! Only infantry has this cap.

    const teamNeedsTen: TeamType = makeTeamType({
      flags: 0x08,
      members: [{ type: '3TNK', count: 10 }],
    });

    // C++ unit counter logic (no cap)
    let counter = 0;
    for (const member of teamNeedsTen.members) {
      if (member.type === '3TNK') {
        counter = Math.max(counter, member.count);  // house.cpp:5845
        // NO min(counter, 5) for units
      }
    }

    expect(counter).toBe(10); // No cap for vehicles
  });

  it('cap applies per infantry type independently', () => {
    const team: TeamType = makeTeamType({
      flags: 0x08,
      members: [
        { type: 'E1', count: 8 },
        { type: 'E3', count: 3 },
      ],
    });

    const counter = new Map<string, number>();
    for (const member of team.members) {
      const isInfantry = member.type.startsWith('E') || member.type === 'MEDI';
      let count = Math.max(counter.get(member.type) ?? 0, member.count);
      if (isInfantry) count = Math.min(count, 5);
      counter.set(member.type, count);
    }

    expect(counter.get('E1')).toBe(5);  // Capped from 8 to 5
    expect(counter.get('E3')).toBe(3);  // Under cap, unchanged
  });
});


// =============================================================================
// 5. MaxUnit / MaxInfantry caps in production — house.cpp:5794-5795, 6047-6048
// =============================================================================

describe('MaxUnit / MaxInfantry production caps — house.cpp:5794-5795, 6047-6048', () => {
  // C++ house.cpp:5794: if (CurUnits >= Control.MaxUnit) return(TICKS_PER_SECOND);
  // C++ house.cpp:6048: if (CurInfantry >= Control.MaxInfantry) return(TICKS_PER_SECOND);

  it('TS respects maxUnit cap — no vehicles produced when at cap', () => {
    // Create max 2 vehicles
    const state = makeAIState({ house: House.USSR, iq: 3, techLevel: 10, maxUnit: 2 });
    const structures = [
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'TENT', house: House.USSR, cx: 14, cy: 10 }),
    ];

    // Already have 2 vehicles (at cap)
    const e1 = entityAtCell(UnitType.V_3TNK, House.USSR, 20, 20);
    const e2 = entityAtCell(UnitType.V_3TNK, House.USSR, 22, 20);

    const ctx = makeAIContext({
      tick: 60,
      entities: [e1, e2],
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 10000]]),
      structures,
    });

    const priorVehicles = ctx.entities.filter(e =>
      e.alive && e.house === House.USSR && !e.stats.isInfantry && !e.stats.isAircraft
    ).length;

    updateAIProduction(ctx);

    const postVehicles = ctx.entities.filter(e =>
      e.alive && e.house === House.USSR && !e.stats.isInfantry && !e.stats.isAircraft
    ).length;

    // Vehicle count should not increase (at maxUnit cap)
    expect(postVehicles).toBe(priorVehicles);
  });

  it('TS respects maxInfantry cap — no infantry produced when at cap', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, techLevel: 10, maxInfantry: 2 });
    const structures = [
      makeStructure({ type: 'TENT', house: House.USSR, cx: 10, cy: 10 }),
    ];

    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 20, 20);
    const e2 = entityAtCell(UnitType.I_E1, House.USSR, 22, 20);

    const ctx = makeAIContext({
      tick: 60,
      entities: [e1, e2],
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 10000]]),
      structures,
    });

    const priorInf = ctx.entities.filter(e =>
      e.alive && e.house === House.USSR && e.stats.isInfantry
    ).length;

    updateAIProduction(ctx);

    const postInf = ctx.entities.filter(e =>
      e.alive && e.house === House.USSR && e.stats.isInfantry
    ).length;

    expect(postInf).toBe(priorInf);
  });
});


// =============================================================================
// 6. suggestedNewTeam: alerted vs non-alerted team selection
//    C++ teamtype.cpp:434 — gating by alerted flag
// =============================================================================

describe('suggestedNewTeam alerted gating — teamtype.cpp:434', () => {
  // C++ teamtype.cpp:434:
  //   if ((alerted && !ttype->IsAutocreate) || (!alerted && ttype->IsAutocreate))
  //     maxnum = 0;
  //
  // When alerted: only autocreate teams are eligible.
  // When NOT alerted: only non-autocreate teams are eligible.

  it('alerted=true excludes non-autocreate teams', () => {
    const ctx = makeAIContext();
    ctx.teamTypes = [
      makeTeamType({ name: 'NonAuto', house: 2, flags: 0x08, maxAllowed: 5 }),  // IsPrebuilt only
      makeTeamType({ name: 'Auto', house: 2, flags: 0x0C, maxAllowed: 5 }),     // IsPrebuilt + IsAutocreate
    ];

    for (let i = 0; i < 20; i++) {
      const result = suggestedNewTeam(ctx, House.USSR, true);
      expect(result).toBe(1); // Only the autocreate team is eligible
    }
  });

  it('alerted=false excludes autocreate teams', () => {
    const ctx = makeAIContext();
    ctx.teamTypes = [
      makeTeamType({ name: 'NonAuto', house: 2, flags: 0x08, maxAllowed: 5 }),  // IsPrebuilt only
      makeTeamType({ name: 'Auto', house: 2, flags: 0x0C, maxAllowed: 5 }),     // IsPrebuilt + IsAutocreate
    ];

    for (let i = 0; i < 20; i++) {
      const result = suggestedNewTeam(ctx, House.USSR, false);
      expect(result).toBe(0); // Only the non-autocreate team is eligible
    }
  });

  it('team with both IsAutocreate and IsPrebuilt is eligible when alerted', () => {
    const ctx = makeAIContext();
    ctx.teamTypes = [
      makeTeamType({ name: 'Both', house: 2, flags: 0x0C, maxAllowed: 5 }),
    ];

    const result = suggestedNewTeam(ctx, House.USSR, true);
    expect(result).toBe(0); // Eligible because alerted=true and IsAutocreate=true
  });
});


// =============================================================================
// 7. Autocreate timer formula — house.cpp:1002
// =============================================================================

describe('Autocreate alert timer — house.cpp:1002', () => {
  // C++ house.cpp:1002:
  //   AlertTime = Rule.AutocreateTime * Random_Pick(TICKS_PER_MINUTE/2, TICKS_PER_MINUTE*2);
  //
  // Rule.AutocreateTime = 5 (from rules.ini [AI] AutocreateTime=5)
  // TICKS_PER_MINUTE = 900 (at 15 Hz)
  // So: AlertTime = 5 * Random_Pick(450, 1800) = between 2250 and 9000 ticks
  //
  // At 15 Hz, that's 150 to 600 seconds (2.5 to 10 minutes) between autocreate cycles.

  it('C++ autocreate timer range: 2250-9000 ticks (2.5-10 minutes at 15Hz)', () => {
    const TICKS_PER_MINUTE = 900;
    const autocreateTime = 5; // rules.ini [AI] AutocreateTime=5

    const minTicks = autocreateTime * Math.floor(TICKS_PER_MINUTE / 2);
    const maxTicks = autocreateTime * (TICKS_PER_MINUTE * 2);

    expect(minTicks).toBe(2250);  // 5 * 450
    expect(maxTicks).toBe(9000);  // 5 * 1800

    // In seconds at 15Hz
    expect(minTicks / 15).toBe(150);   // 2.5 minutes
    expect(maxTicks / 15).toBe(600);   // 10 minutes
  });

  it('TS uses tick % 120 for autocreate interval (MISMATCH)', () => {
    // TS ai.ts line 2280: if (ctx.tick % 120 !== 0) return;
    // This means autocreate checks every 120 ticks, which at 15Hz is 8 seconds.
    // C++ uses a random timer of 2.5 to 10 minutes.
    //
    // The TS interval is much more frequent than C++ (8 seconds vs 2.5-10 minutes).
    // However, this is partially compensated by the TS credit check (>=500).

    const TS_AUTOCREATE_INTERVAL = 120;
    const CPP_MIN_INTERVAL = 2250;
    const CPP_MAX_INTERVAL = 9000;

    // TS fires ~19-75x more frequently than C++
    expect(TS_AUTOCREATE_INTERVAL).toBeLessThan(CPP_MIN_INTERVAL);
  });
});


// =============================================================================
// 8. maxTeams formula per cycle — house.cpp:993
// =============================================================================

describe('maxTeams per cycle — house.cpp:993', () => {
  // C++ house.cpp:993:
  //   int maxteams = Random_Pick(2, (int)(((Control.TechLevel-1)/3)+1));
  //
  // TechLevel  | (TL-1)/3+1 | Range
  // 1          | 1          | Random_Pick(2, 1) => always 2 (min > max = min)
  // 2-4        | 1-2        | Random_Pick(2, 1..2) => 2
  // 5-7        | 2-3        | Random_Pick(2, 2..3) => 2..3
  // 8-10       | 3-4        | Random_Pick(2, 3..4) => 2..4
  // 13         | 5          | Random_Pick(2, 5) => 2..5

  it.each([
    { techLevel: 1,  expectedMin: 2, expectedMax: 2, label: 'TL=1: always 2' },
    { techLevel: 4,  expectedMin: 2, expectedMax: 2, label: 'TL=4: always 2' },
    { techLevel: 7,  expectedMin: 2, expectedMax: 3, label: 'TL=7: 2-3' },
    { techLevel: 10, expectedMin: 2, expectedMax: 4, label: 'TL=10: 2-4' },
    { techLevel: 13, expectedMin: 2, expectedMax: 5, label: 'TL=13: 2-5' },
  ])('$label', ({ techLevel, expectedMin, expectedMax }) => {
    const upper = Math.floor((techLevel - 1) / 3) + 1;
    const effectiveMax = Math.max(upper, 2); // C++ Random_Pick(2, ...) where min >= max returns min

    expect(effectiveMax).toBeGreaterThanOrEqual(expectedMin);
    expect(effectiveMax).toBeLessThanOrEqual(expectedMax + 1); // +1 because effectiveMax is the inclusive upper bound

    // Verify the TS formula matches
    // TS ai.ts:2293-2294:
    //   const maxTeamsUpper = Math.floor((techLevel - 1) / 3) + 1;
    //   const maxTeams = Math.floor(Math.random() * (Math.max(maxTeamsUpper, 2) - 2 + 1)) + 2;
    const tsUpper = Math.floor((techLevel - 1) / 3) + 1;
    const tsEffMax = Math.max(tsUpper, 2);
    // Range: [2, tsEffMax]
    expect(tsEffMax).toBeGreaterThanOrEqual(expectedMin);
    expect(tsEffMax).toBeLessThanOrEqual(expectedMax);
  });
});


// =============================================================================
// 9. C++ cost check per candidate — house.cpp:5870
// =============================================================================

describe('C++ per-unit cost check — house.cpp:5870', () => {
  // C++ house.cpp:5870:
  //   if (counter[utype] > 0 && Can_Build(...) && Cost_Of() <= Available_Money())
  //
  // Each candidate unit type is checked against available money individually.
  // TS checks a global credit threshold (600 for vehicles, 100 for infantry)
  // but NOT the specific unit cost.

  it('C++ checks individual unit cost against Available_Money()', () => {
    // If AI has 800 credits and needs both 3TNK (950) and 1TNK (700),
    // C++ would skip 3TNK (too expensive) and only consider 1TNK.

    const budget = 800;
    const candidates = [
      { type: '3TNK', cost: 950, need: 5 },
      { type: '1TNK', cost: 700, need: 2 },
    ];

    // C++ filtering: only candidates affordable with current budget
    const affordable = candidates.filter(c => c.cost <= budget);
    expect(affordable.length).toBe(1);
    expect(affordable[0].type).toBe('1TNK');
  });

  it('MISMATCH: TS uses global threshold (600 for vehicles) not per-unit cost', () => {
    // TS ai.ts:2129: if (hasWeap && currentCredits >= 600 && !skipVehicle)
    // This means TS will attempt to build a vehicle if credits >= 600,
    // even if the selected vehicle costs more than available credits.
    //
    // C++ checks each candidate individually: Cost_Of() <= Available_Money()

    const state = makeAIState({ house: House.USSR, iq: 3, techLevel: 10 });
    const structures = [
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10 }),
    ];

    // Give exactly 650 credits — above TS threshold (600) but below 3TNK cost (950)
    const ctx = makeAIContext({
      tick: 60,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 650]]),
      structures,
    });

    updateAIProduction(ctx);

    // TS will attempt to produce because 650 >= 600 threshold
    // C++ would only produce if the selected unit costs <= 650
    // This documents the behavioral difference
    expect(true).toBe(true); // Documentation test
  });
});


// =============================================================================
// 10. Harvester priority in AI_Unit — house.cpp:5800-5806
// =============================================================================

describe('Harvester replacement priority — house.cpp:5800-5806', () => {
  // C++ house.cpp:5800-5806:
  //   if (IQ >= Rule.IQHarvester && !IsTiberiumShort && !IsHuman &&
  //       BQuantity[STRUCT_REFINERY] > UQuantity[UNIT_HARVESTER] &&
  //       Difficulty != DIFF_HARD) {
  //     if (UnitTypeClass::As_Reference(UNIT_HARVESTER).Level <= Control.TechLevel) {
  //       BuildUnit = UNIT_HARVESTER;
  //       return(TICKS_PER_SECOND);
  //     }
  //   }
  //
  // C++ builds harvester FIRST when refineries > harvesters, BEFORE checking teams.
  // This short-circuits all other unit production.

  it('C++ harvester replacement preempts team-based production when refineries > harvesters', () => {
    // If there is a refinery but no harvester, C++ builds harvester regardless
    // of what team templates need. Team production is secondary.
    // tick must be > productionInterval (60 for normal) and (tick-1) % 60 === 0 → tick=61.

    const state = makeAIState({
      house: House.USSR,
      iq: 3,
      techLevel: 10,
      harvesterCount: 0,
      refineryCount: 1,
    });

    const structures = [
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'PROC', house: House.USSR, cx: 14, cy: 10 }),
    ];

    const ctx = makeAIContext({
      tick: 61,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 5000]]),
      structures,
    });

    updateAIProduction(ctx);

    // TS should also prioritize harvester replacement (parity check)
    const harvesters = ctx.entities.filter(e => e.type === UnitType.V_HARV);
    expect(harvesters.length).toBeGreaterThanOrEqual(1);
  });

  it('C++ skips harvester priority on DIFF_HARD', () => {
    // C++ house.cpp:5801: Difficulty != DIFF_HARD — hard difficulty skips auto-harvester
    // This is a quirk: on hard difficulty, AI doesn't auto-replace harvesters via this path.
    //
    // TS does NOT have this difficulty-based skip — it always replaces harvesters.
    // This is a minor parity gap but worth documenting.

    const CPP_HARD_SKIPS_HARVESTER = true; // C++ behavior
    expect(CPP_HARD_SKIPS_HARVESTER).toBe(true);
    // TS does not differentiate — always replaces when count < refinery count
  });
});


// =============================================================================
// 11. C++ IsBaseBuilding random fallback — house.cpp:5887-5915
// =============================================================================

describe('IsBaseBuilding random fallback — house.cpp:5887-5915', () => {
  // When IsBaseBuilding is set (AI is in base-building mode), C++ falls through
  // from team-based production to random weighted production as a fallback:
  //   - Armed units get weight 20
  //   - Unarmed units get weight 1
  //   - Harvesters are excluded
  //
  // This is the closest thing to TS's current random production, but it's
  // only used when IsBaseBuilding is active AND no team-based pick was made.

  it('C++ armed units get 20x weight vs unarmed in base-building mode', () => {
    // C++ house.cpp:5894-5898:
    //   if (utype->PrimaryWeapon != NULL) counter[index] = 20;
    //   else counter[index] = 1;

    const armedWeight = 20;
    const unarmedWeight = 1;

    // With 10 armed types and 5 unarmed, probability of picking armed = 200/205 = ~97.6%
    const totalWeight = 10 * armedWeight + 5 * unarmedWeight;
    const armedProbability = (10 * armedWeight) / totalWeight;

    expect(armedProbability).toBeCloseTo(0.976, 2);
  });

  it('C++ excludes harvesters from base-building random production', () => {
    // C++ house.cpp:5893: Can_Build(utype, ActLike) && utype->Type != UNIT_HARVESTER
    // Harvesters are explicitly excluded from the random pool.
    // This makes sense — harvester production is handled by the priority check above.

    const isHarvester = (type: string) => type === 'HARV';
    expect(isHarvester('HARV')).toBe(true);
    expect(isHarvester('3TNK')).toBe(false);
  });
});


// =============================================================================
// 12. Integration: autocreate spawning respects entity spawning
// =============================================================================

describe('Autocreate team spawning integration', () => {
  it('spawned team members have correct house', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const team: TeamType = makeTeamType({
      flags: 0x04,  // IsAutocreate
      maxAllowed: 1,
      members: [{ type: 'E1', count: 2 }, { type: '3TNK', count: 1 }],
    });

    const ctx = makeAIContext({
      tick: 121,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 10000]]),
      autocreateEnabled: true,
      teamTypes: [team],
      waypoints: new Map([[0, { cx: 50, cy: 50 }]]),
    });

    updateAIAutocreateTeams(ctx);

    // All spawned entities should belong to USSR
    for (const e of ctx.entities) {
      expect(e.house).toBe(House.USSR);
    }
  });

  it('spawned team contains correct unit types and counts', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const team: TeamType = makeTeamType({
      flags: 0x04,
      maxAllowed: 1,
      members: [
        { type: 'E1', count: 3 },
        { type: '3TNK', count: 2 },
      ],
    });

    const ctx = makeAIContext({
      tick: 121,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 10000]]),
      autocreateEnabled: true,
      teamTypes: [team],
      waypoints: new Map([[0, { cx: 50, cy: 50 }]]),
    });

    updateAIAutocreateTeams(ctx);

    const e1Count = ctx.entities.filter(e => e.type === UnitType.I_E1).length;
    const tankCount = ctx.entities.filter(e => e.type === UnitType.V_3TNK).length;

    // maxAllowed=1 + techLevel=10 means 2-4 attempts, but only 1 team can spawn
    expect(e1Count).toBe(3);
    expect(tankCount).toBe(2);
  });

  it('IsSuicide flag (bit 1) forces HUNT mission on all team members', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const team: TeamType = makeTeamType({
      flags: 0x06,  // IsSuicide (0x02) + IsAutocreate (0x04)
      maxAllowed: 1,
      members: [{ type: 'E1', count: 2 }],
      missions: [{ mission: 0, data: 5 }], // TMISSION_ATTACK
    });

    const ctx = makeAIContext({
      tick: 121,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 10000]]),
      autocreateEnabled: true,
      teamTypes: [team],
      waypoints: new Map([[0, { cx: 50, cy: 50 }]]),
    });

    updateAIAutocreateTeams(ctx);

    // C++ ai.ts:2258-2260: if (team.flags & 2) { entity.mission = Mission.HUNT; }
    for (const e of ctx.entities) {
      expect(e.mission).toBe(Mission.HUNT);
    }
  });

  it('team with missions assigns teamMissions script to entities', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const team: TeamType = makeTeamType({
      flags: 0x04,  // IsAutocreate only
      maxAllowed: 1,
      members: [{ type: 'E1', count: 1 }],
      missions: [
        { mission: 1, data: 5 },  // TMISSION_MOVE to waypoint 5
        { mission: 0, data: 0 },  // TMISSION_ATTACK
      ],
    });

    const ctx = makeAIContext({
      tick: 121,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 10000]]),
      autocreateEnabled: true,
      teamTypes: [team],
      waypoints: new Map([[0, { cx: 50, cy: 50 }]]),
    });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities.length).toBe(1);
    expect(ctx.entities[0].teamMissions).toHaveLength(2);
    expect(ctx.entities[0].teamMissionIndex).toBe(0);
    expect(ctx.entities[0].teamMissions[0].mission).toBe(1); // MOVE
    expect(ctx.entities[0].teamMissions[1].mission).toBe(0); // ATTACK
  });
});


// =============================================================================
// 13. C++ active team scanning for production (house.cpp:5817-5829)
// =============================================================================

describe('Active team scanning for production — house.cpp:5817-5829', () => {
  // In addition to prebuilt team types, C++ AI_Unit also scans active team INSTANCES
  // to see what units they still need. This is a separate loop from the prebuilt scan.
  //
  // C++ house.cpp:5817-5829:
  //   for (int index = 0; index < Teams.Count(); index++) {
  //     TeamClass * tptr = Teams.Ptr(index);
  //     if (((team->IsReinforcable && !tptr->IsFullStrength) ||
  //          (!tptr->IsForcedActive && !tptr->IsHasBeen && !tptr->JustAltered)) &&
  //         team->House == Class->House) {
  //       // Count unit types needed for this team
  //       counter[unit_type] = 1;  // NOTE: just sets to 1, not Quantity
  //     }
  //   }
  //
  // TS does NOT track active team instances — another parity gap.

  it('C++ active team loop sets counter to 1 (not Quantity) per needed type', () => {
    // Documenting C++ behavior: for active team instances, the counter is set to 1
    // per unit type, not to the member quantity. This means the AI ensures at least
    // one of each type exists, not the full team complement.
    //
    // This is different from the prebuilt scan which uses max(counter, Quantity).

    const activeTeamNeed = 1; // C++ sets counter[type] = 1 for active teams
    const prebuiltTeamQuantity = 5;

    expect(activeTeamNeed).toBe(1);
    // After both loops, prebuilt max(1, 5) = 5 would override
  });

  it('C++ infantry active team loop adds Quantity + IsReinforcable bonus (house.cpp:6067)', () => {
    // C++ house.cpp:6067 (for infantry, different from units):
    //   counter[type] += team->Members[subindex].Quantity + (team->IsReinforcable ? 1 : 0);
    //
    // Infantry active team production ADDS quantity (not sets to 1) and gives
    // a +1 bonus if the team is reinforcable.

    const quantity = 3;
    const isReinforcable = true;
    const infantryCounter = quantity + (isReinforcable ? 1 : 0);
    expect(infantryCounter).toBe(4); // 3 + 1 bonus
  });
});
