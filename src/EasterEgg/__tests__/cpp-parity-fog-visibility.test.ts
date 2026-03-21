/**
 * C++ Behavioral Parity Tests — Fog of War, Sub Detection, GAP Generators
 *
 * Tests verify the TS fog.ts implementation against C++ fog-of-war algorithms.
 * Each section references real C++ source with exact line numbers.
 *
 * Key C++ files:
 *   techno.cpp:5903-5913 — TechnoClass::Look() uses SightRange directly, NO condition reduction
 *   house.cpp:2612-2634  — SPC_SONAR_PULSE: PulseCountDown = 15 * TICKS_PER_SECOND (= 225)
 *   vessel.cpp:1951-1953 — Is_Allowed_To_Recloak(): return(PulseCountDown == 0)
 *   building.cpp:990-1006 — GAP generator: Power_Fraction() >= 1 required, jam/unjam logic
 *   rules.cpp:222-223     — GapShroudRadius=10, GapRegenInterval=fixed(0.1)
 *   rules.cpp:233-235     — ConditionGreen=1, ConditionYellow=fixed(1,2), ConditionRed=fixed(1,4)
 *   map.cpp:286-344       — Sight_From: sightrange capped at 10, uses RadiusCount/RadiusOffset
 *   house.cpp:1420-1425   — IsGPSActive cleared when ATEK destroyed
 *   house.cpp:4160-4170   — Power_Fraction: if Power >= Drain return 1; else Power/Drain
 *   foot.cpp:1373-1386    — Scanner detection: cell-adjacency check for 8 facing directions
 *   techno.cpp:2443-2444  — Cloaking_AI: Health_Ratio() > ConditionRed decides cloak initiation
 *   defines.h:3031        — TICKS_PER_SECOND = 15
 */

import { describe, it, expect } from 'vitest';
import {
  updateFogOfWar, updateSubDetection, updateGapGenerators,
  GAP_RADIUS, GAP_UPDATE_INTERVAL,
  type FogContext,
} from '../engine/fog';
import { CONDITION_RED, CONDITION_YELLOW, CELL_SIZE, MAP_CELLS } from '../engine/types';
import { CloakState, CLOAK_TRANSITION_FRAMES, SONAR_PULSE_DURATION } from '../engine/entity';
import type { Entity } from '../engine/entity';
import { GameMap } from '../engine/map';


// ============================================================
// Helpers — minimal mock objects for fog context
// ============================================================

function makeEntity(overrides: Partial<Entity> & { pos: { x: number; y: number } }): Entity {
  return {
    alive: true,
    isPlayerUnit: true,
    hp: 100,
    maxHp: 100,
    pos: overrides.pos,
    cloakState: CloakState.UNCLOAKED,
    cloakTimer: 0,
    sonarPulseTimer: 0,
    stats: {
      sight: 5,
      isAntiSub: false,
      isCloakable: false,
      isInfantry: false,
      ...((overrides as any).stats ?? {}),
    },
    ...overrides,
    // Ensure stats override is correctly nested
  } as unknown as Entity;
}

function makeFogContext(overrides: Partial<FogContext> = {}): FogContext {
  return {
    entities: [],
    structures: [],
    map: new GameMap(),
    tick: 0,
    playerHouse: 'Greece' as any,
    fogDisabled: false,
    gpsActive: false,
    baseDiscovered: true,
    powerProduced: 200,
    powerConsumed: 100,
    gapGeneratorCells: new Map(),
    isAllied: (a, b) => a === b,
    entitiesAllied: (a, b) => (a as any).isPlayerUnit === (b as any).isPlayerUnit,
    ...overrides,
  };
}


// ============================================================
// Section 1: CONDITION_RED sight reduction
// C++ techno.cpp:5903-5913 — TechnoClass::Look()
// ============================================================

describe('CONDITION_RED sight reduction (techno.cpp:5903-5913)', () => {
  /**
   * C++ TechnoClass::Look() (techno.cpp:5903-5913):
   *   void TechnoClass::Look(bool incremental)
   *   {
   *     assert(IsActive);
   *     assert(!IsInLimbo);
   *     int sight_range = Techno_Type_Class()->SightRange;
   *     if (sight_range) {
   *       Map.Sight_From(Coord_Cell(Coord), sight_range, House, incremental);
   *     }
   *   }
   *
   * The sight_range is ALWAYS taken from the type class directly.
   * There is NO condition-based reduction of sight range in C++.
   * Health/condition only affects cloaking behavior (techno.cpp:2443-2444),
   * NOT visibility range.
   *
   * TS fog.ts:72 reduces sight to 1 when (hp/maxHp) < CONDITION_RED.
   * This is a TS invention — NOT present in C++.
   */

  it('C++ CONDITION_RED is 0.25 (rules.cpp:235)', () => {
    // C++ rules.cpp:235: ConditionRed(fixed(1, 4))
    // fixed(1,4) = 1/4 = 0.25
    expect(CONDITION_RED).toBe(0.25);
  });

  // PARITY GAP: TS fog.ts:72 reduces sight to 1 at CONDITION_RED.
  // C++ techno.cpp:5908 always uses Techno_Type_Class()->SightRange with no health check.
  // TS invents sight reduction that does not exist in C++.
  it('C++ Look() does NOT reduce sight at CONDITION_RED — sight stays at type SightRange', () => {
    // C++ techno.cpp:5908: int sight_range = Techno_Type_Class()->SightRange;
    // No health check. A unit with SightRange=5 at 1% HP still has sight=5.
    //
    // TS fog.ts:72: const sight = (e.hp / e.maxHp) < CONDITION_RED ? 1 : e.stats.sight;
    // TS reduces sight to 1 when health < 0.25. This diverges from C++.

    const map = new GameMap();
    const entity = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      hp: 10,      // 10% health — below CONDITION_RED
      maxHp: 100,
      stats: { sight: 5, isAntiSub: false, isCloakable: false, isInfantry: false } as any,
    });

    const ctx = makeFogContext({ map, entities: [entity] });
    updateFogOfWar(ctx);

    // C++ expected: unit reveals cells within sight=5 radius
    // Check a cell at distance 4 from the unit (should be visible with sight=5)
    const unitCx = 64;
    const unitCy = 64;
    const checkCx = unitCx + 4;
    const checkCy = unitCy;

    // C++ expectation: sight=5 (type SightRange), so cell at distance 4 IS visible
    // TS behavior: sight=1 (reduced), so cell at distance 4 is NOT visible
    // PARITY GAP: TS reduces sight at CONDITION_RED, C++ does not.
    const vis = map.getVisibility(checkCx, checkCy);
    expect(vis).toBe(2); // PARITY GAP: TS returns 0 (shroud), C++ expects 2 (visible)
  });

  // PARITY GAP: Same as above — TS reduces sight at 24% HP, C++ does not.
  it('C++ Look() uses full sight range regardless of health ratio', () => {
    // Even at exactly CONDITION_RED threshold (25%), C++ uses full sight
    const map = new GameMap();
    const entity = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      hp: 24,      // 24% health — just below CONDITION_RED (0.25)
      maxHp: 100,
      stats: { sight: 7, isAntiSub: false, isCloakable: false, isInfantry: false } as any,
    });

    const ctx = makeFogContext({ map, entities: [entity] });
    updateFogOfWar(ctx);

    // C++ expected: sight=7 (type SightRange), cell at distance 6 IS visible
    const vis = map.getVisibility(64 + 6, 64);
    expect(vis).toBe(2); // PARITY GAP: TS reduces to sight=1, C++ keeps sight=7
  });

  // PARITY GAP: TS fog.ts:84 reduces structure sight at CONDITION_RED too. C++ does not.
  it('C++ structure sight is also NOT reduced by condition', () => {
    // Same principle applies to buildings — C++ building.cpp uses Class->SightRange
    // TS fog.ts:84: const sight = (s.hp / s.maxHp) < CONDITION_RED ? 1 : baseSight;
    const map = new GameMap();
    const structure = {
      type: 'GUN',
      alive: true,
      hp: 10,
      maxHp: 100,
      cx: 64,
      cy: 64,
      house: 'Greece' as any,
    };

    const ctx = makeFogContext({
      map,
      structures: [structure as any],
      baseDiscovered: true,
    });
    updateFogOfWar(ctx);

    // C++ expected: defense sight=7 (or whatever its SightRange is), cell at distance 5 visible
    // TS gives sight=1 because hp/maxHp < CONDITION_RED
    const vis = map.getVisibility(64 + 5, 64);
    expect(vis).toBe(2); // PARITY GAP: TS reduces structure sight too
  });
});


// ============================================================
// Section 2: Sonar pulse sub-detection
// C++ house.cpp:2612-2634 — SPC_SONAR_PULSE superweapon
// C++ vessel.cpp:1951-1953 — Is_Allowed_To_Recloak()
// ============================================================

describe('Sonar pulse sub-detection (house.cpp:2612-2634, vessel.cpp:1951-1953)', () => {
  /**
   * C++ sonar pulse mechanism:
   *
   * house.cpp:2612-2634 — SPC_SONAR_PULSE handler:
   *   for (int index = 0; index < Vessels.Count(); index++) {
   *     VesselClass * sub = Vessels.Ptr(index);
   *     if (*sub == VESSEL_SS || *sub == VESSEL_MISSILESUB) {
   *       sub->PulseCountDown = 15 * TICKS_PER_SECOND;  // = 225
   *       sub->Do_Uncloak();
   *     }
   *   }
   *
   * This is a GLOBAL operation — ALL subs are revealed, regardless of distance
   * to any detector unit. There is no range check.
   *
   * vessel.cpp:1951-1953 — Is_Allowed_To_Recloak():
   *   return(PulseCountDown == 0);
   *
   * The PulseCountDown is a frame timer that counts down automatically.
   * While it's nonzero, Is_Allowed_To_Recloak() returns false,
   * which prevents Is_Ready_To_Cloak() from succeeding (techno.cpp:2569).
   *
   * defines.h:3031 — TICKS_PER_SECOND = 15
   * So PulseCountDown = 15 * 15 = 225 frames = 15 seconds.
   */

  it('SONAR_PULSE_DURATION matches C++ value: 15 * TICKS_PER_SECOND = 225', () => {
    // C++ house.cpp:2629: sub->PulseCountDown = 15 * TICKS_PER_SECOND;
    // defines.h:3031: TICKS_PER_SECOND = 15
    // 15 * 15 = 225
    expect(SONAR_PULSE_DURATION).toBe(225);
  });

  it('CLOAK_TRANSITION_FRAMES is defined (C++ CLOAK_STAGES analogue)', () => {
    // C++ uses CloakingDevice stage counter for cloak/uncloak transitions.
    // The exact value varies, but the concept of a transition period exists.
    expect(CLOAK_TRANSITION_FRAMES).toBeGreaterThan(0);
  });

  // PARITY GAP: C++ sonar is a global superweapon (house.cpp:2622-2632, no range check).
  // TS fog.ts:110-111 uses per-unit range-based detection (worldDist <= sight).
  it('C++ sonar pulse is GLOBAL — all subs detected regardless of range', () => {
    // C++ house.cpp:2622-2632: iterates ALL Vessels, no distance check.
    // TS fog.ts:110-111: uses worldDist(dd.pos, sub.pos) <= sight (range-based).
    //
    // This means in C++, a sonar pulse detects subs across the entire map.
    // In TS, detection is per-detector-unit with range limited by sight.
    // This test verifies the TS behavior against C++ expectations.

    const detector = makeEntity({
      pos: { x: 10 * CELL_SIZE, y: 10 * CELL_SIZE },
      isPlayerUnit: true,
      stats: { sight: 5, isAntiSub: true, isCloakable: false, isInfantry: false } as any,
    });

    // Place sub FAR away — outside detector's sight range
    const farSub = makeEntity({
      pos: { x: 100 * CELL_SIZE, y: 100 * CELL_SIZE },
      isPlayerUnit: false,
      cloakState: CloakState.CLOAKED,
      stats: { sight: 3, isAntiSub: false, isCloakable: true, isInfantry: false } as any,
    });

    const ctx = makeFogContext({
      entities: [detector, farSub],
    });

    updateSubDetection(ctx);

    // C++ expected: sonar pulse would detect this sub (global, no range check)
    // TS expected: sub NOT detected (out of range)
    // PARITY GAP: TS uses per-unit range detection, C++ sonar is global
    expect(farSub.cloakState).toBe(CloakState.UNCLOAKING);
    // ^ Will fail if TS doesn't detect — that's the parity gap
  });

  // PARITY GAP: C++ scanner detection is cell-adjacency (foot.cpp:1373-1386, 1 cell range).
  // TS uses worldDist <= sight (multi-cell range). Sub 3 cells away is detected by TS but not C++.
  it('C++ scanner detection is cell-adjacency based, not range-based', () => {
    // C++ foot.cpp:1373-1386:
    //   if (Cloak == CLOAKED) {
    //     for (FacingType face = FACING_N; face < FACING_COUNT; face++) {
    //       CELL cell = Adjacent_Cell(Coord_Cell(Coord), face);
    //       if (Map.In_Radar(cell)) {
    //         TechnoClass const * techno = Map[cell].Cell_Techno();
    //         if (techno && !techno->House->Is_Ally(this) && techno->Techno_Type_Class()->IsScanner) {
    //           Do_Shimmer();
    //           break;
    //         }
    //       }
    //     }
    //   }
    //
    // In C++, the CLOAKED unit checks adjacent cells for scanner enemies.
    // Detection range is exactly 1 cell (adjacency), NOT the scanner's sight range.
    // TS uses worldDist <= sight, so detection range = scanner's sight range in cells.

    // Place detector and sub 3 cells apart (within sight=5 but NOT adjacent)
    const detector = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      isPlayerUnit: true,
      stats: { sight: 5, isAntiSub: true, isCloakable: false, isInfantry: false } as any,
    });

    const nearSub = makeEntity({
      pos: { x: 67 * CELL_SIZE, y: 64 * CELL_SIZE }, // 3 cells away
      isPlayerUnit: false,
      cloakState: CloakState.CLOAKED,
      stats: { sight: 3, isAntiSub: false, isCloakable: true, isInfantry: false } as any,
    });

    const ctx = makeFogContext({
      entities: [detector, nearSub],
    });

    updateSubDetection(ctx);

    // C++ expected: sub NOT detected (3 cells away, adjacency = 1 cell max)
    // TS expected: sub DETECTED (3 cells < sight=5)
    // PARITY GAP: C++ uses adjacency (1 cell), TS uses sight range
    expect(nearSub.cloakState).toBe(CloakState.CLOAKED);
    // ^ Will fail if TS detects at range 3 — that's the parity gap
  });

  it('sub in adjacent cell IS detected by scanner in C++', () => {
    // C++ foot.cpp:1374: checks FACING_N through FACING_COUNT (8 adjacent cells)
    const detector = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      isPlayerUnit: true,
      stats: { sight: 5, isAntiSub: true, isCloakable: false, isInfantry: false } as any,
    });

    // Place sub in adjacent cell (1 cell away)
    const adjSub = makeEntity({
      pos: { x: 65 * CELL_SIZE, y: 64 * CELL_SIZE }, // 1 cell east
      isPlayerUnit: false,
      cloakState: CloakState.CLOAKED,
      stats: { sight: 3, isAntiSub: false, isCloakable: true, isInfantry: false } as any,
    });

    const ctx = makeFogContext({
      entities: [detector, adjSub],
    });

    updateSubDetection(ctx);

    // Both C++ and TS should detect at 1 cell distance
    expect(adjSub.cloakState).toBe(CloakState.UNCLOAKING);
  });

  it('detected sub gets sonarPulseTimer set to SONAR_PULSE_DURATION', () => {
    // C++ house.cpp:2629: sub->PulseCountDown = 15 * TICKS_PER_SECOND = 225
    const detector = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      isPlayerUnit: true,
      stats: { sight: 5, isAntiSub: true, isCloakable: false, isInfantry: false } as any,
    });

    const sub = makeEntity({
      pos: { x: 65 * CELL_SIZE, y: 64 * CELL_SIZE },
      isPlayerUnit: false,
      cloakState: CloakState.CLOAKED,
      sonarPulseTimer: 0,
      stats: { sight: 3, isAntiSub: false, isCloakable: true, isInfantry: false } as any,
    });

    const ctx = makeFogContext({
      entities: [detector, sub],
    });

    updateSubDetection(ctx);

    expect(sub.sonarPulseTimer).toBe(SONAR_PULSE_DURATION);
    expect(sub.sonarPulseTimer).toBe(225);
  });

  it('CLOAKING sub is also detected (not just CLOAKED)', () => {
    // C++ foot.cpp:1373: checks "Cloak == CLOAKED" specifically
    // But sonar pulse in house.cpp:2629 uncloaks regardless of cloak state
    // TS fog.ts:108 checks both CLOAKED and CLOAKING states
    const detector = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      isPlayerUnit: true,
      stats: { sight: 5, isAntiSub: true, isCloakable: false, isInfantry: false } as any,
    });

    const sub = makeEntity({
      pos: { x: 65 * CELL_SIZE, y: 64 * CELL_SIZE },
      isPlayerUnit: false,
      cloakState: CloakState.CLOAKING,
      stats: { sight: 3, isAntiSub: false, isCloakable: true, isInfantry: false } as any,
    });

    const ctx = makeFogContext({
      entities: [detector, sub],
    });

    updateSubDetection(ctx);

    expect(sub.cloakState).toBe(CloakState.UNCLOAKING);
  });

  it('allied subs are NOT detected', () => {
    // C++ foot.cpp:1380: !techno->House->Is_Ally(this)
    const detector = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      isPlayerUnit: true,
      stats: { sight: 5, isAntiSub: true, isCloakable: false, isInfantry: false } as any,
    });

    const alliedSub = makeEntity({
      pos: { x: 65 * CELL_SIZE, y: 64 * CELL_SIZE },
      isPlayerUnit: true, // same team
      cloakState: CloakState.CLOAKED,
      stats: { sight: 3, isAntiSub: false, isCloakable: true, isInfantry: false } as any,
    });

    const ctx = makeFogContext({
      entities: [detector, alliedSub],
    });

    updateSubDetection(ctx);

    // Allied subs should remain cloaked
    expect(alliedSub.cloakState).toBe(CloakState.CLOAKED);
  });
});


// ============================================================
// Section 3: GAP generator jamming
// C++ building.cpp:990-1006, rules.cpp:222-223
// ============================================================

describe('GAP generator jamming (building.cpp:990-1006, rules.cpp:222-223)', () => {
  /**
   * C++ building.cpp:990-1006:
   *   if (*this == STRUCT_GAP) {
   *     if (Arm == 0) {
   *       IsJamming = false;
   *       Arm = TICKS_PER_MINUTE * Rule.GapRegenInterval + Random_Pick(1, TICKS_PER_SECOND);
   *     }
   *     if (!IsJamming) {
   *       if (House->Power_Fraction() >= 1) {
   *         Map.Jam_From(Coord_Cell(Center_Coord()), Rule.GapShroudRadius, House);
   *         IsJamming = true;
   *       }
   *     } else {
   *       if (House->Power_Fraction() < 1) {
   *         IsJamming = false;
   *         Map.UnJam_From(Coord_Cell(Center_Coord()), Rule.GapShroudRadius, House);
   *       }
   *     }
   *   }
   *
   * rules.cpp:222: GapShroudRadius(10)
   * rules.cpp:223: GapRegenInterval(".1") = fixed(1,10) = 0.1
   * defines.h:3031-3032: TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
   * Arm = 900 * 0.1 + Random_Pick(1, 15) = 90 + 1..15 = 91..105
   */

  it('GAP_RADIUS matches C++ GapShroudRadius default (rules.cpp:222)', () => {
    // C++ rules.cpp:222: GapShroudRadius(10)
    expect(GAP_RADIUS).toBe(10);
  });

  it('GAP_UPDATE_INTERVAL approximates C++ base interval (90 ticks)', () => {
    // C++ building.cpp:993: Arm = TICKS_PER_MINUTE * Rule.GapRegenInterval + Random_Pick(1, TICKS_PER_SECOND)
    // = 900 * 0.1 + Random_Pick(1,15) = 90 + 1..15
    // TS uses fixed 90, C++ uses 91..105 (base 90 + 1..15 random jitter)
    // The base value matches, but C++ adds random jitter.
    expect(GAP_UPDATE_INTERVAL).toBe(90);
  });

  it('GAP requires full power (Power_Fraction >= 1) to jam', () => {
    // C++ building.cpp:997: if (House->Power_Fraction() >= 1) { Map.Jam_From(...); IsJamming = true; }
    // TS fog.ts:201: if (pf < 1.0) { unjam and skip }
    const map = new GameMap();
    const gapStructure = {
      type: 'GAP',
      alive: true,
      hp: 100,
      maxHp: 100,
      cx: 64,
      cy: 64,
      house: 'Greece' as any,
    };

    // Power is insufficient (produced < consumed)
    const ctx = makeFogContext({
      map,
      structures: [gapStructure as any],
      tick: 0,
      powerProduced: 50,
      powerConsumed: 100, // pf = 0.5 < 1
    });

    updateGapGenerators(ctx);

    // With insufficient power, GAP should NOT jam
    expect(ctx.gapGeneratorCells.size).toBe(0);
  });

  it('GAP jams when power is sufficient (Power_Fraction >= 1)', () => {
    // C++ building.cpp:997: Power_Fraction() >= 1
    const map = new GameMap();
    const gapStructure = {
      type: 'GAP',
      alive: true,
      hp: 100,
      maxHp: 100,
      cx: 64,
      cy: 64,
      house: 'Greece' as any,
    };

    const ctx = makeFogContext({
      map,
      structures: [gapStructure as any],
      tick: 0,
      powerProduced: 200,
      powerConsumed: 100, // pf = 2.0 >= 1
    });

    updateGapGenerators(ctx);

    expect(ctx.gapGeneratorCells.size).toBe(1);
  });

  it('GAP unjams when power drops below 1 (building.cpp:1002-1004)', () => {
    // C++ building.cpp:1002-1004:
    //   if (House->Power_Fraction() < 1) {
    //     IsJamming = false;
    //     Map.UnJam_From(Coord_Cell(Center_Coord()), Rule.GapShroudRadius, House);
    //   }
    const map = new GameMap();
    const gapStructure = {
      type: 'GAP',
      alive: true,
      hp: 100,
      maxHp: 100,
      cx: 64,
      cy: 64,
      house: 'Greece' as any,
    };

    // First, jam with sufficient power
    const ctx = makeFogContext({
      map,
      structures: [gapStructure as any],
      tick: 0,
      powerProduced: 200,
      powerConsumed: 100,
    });
    updateGapGenerators(ctx);
    expect(ctx.gapGeneratorCells.size).toBe(1);

    // Now power drops
    ctx.powerProduced = 50;
    ctx.powerConsumed = 100;
    ctx.tick = GAP_UPDATE_INTERVAL; // next update interval
    updateGapGenerators(ctx);

    // Should unjam
    expect(ctx.gapGeneratorCells.size).toBe(0);
  });

  it('GAP only updates on GAP_UPDATE_INTERVAL tick boundaries', () => {
    // C++ building.cpp:991: if (Arm == 0) — arm is a countdown timer
    // TS fog.ts:189: if (ctx.tick % GAP_UPDATE_INTERVAL !== 0) return;
    const map = new GameMap();
    const gapStructure = {
      type: 'GAP',
      alive: true,
      hp: 100,
      maxHp: 100,
      cx: 64,
      cy: 64,
      house: 'Greece' as any,
    };

    const ctx = makeFogContext({
      map,
      structures: [gapStructure as any],
      tick: 1, // NOT on interval boundary
      powerProduced: 200,
      powerConsumed: 100,
    });

    updateGapGenerators(ctx);

    // Should NOT have jammed because tick is not on interval
    expect(ctx.gapGeneratorCells.size).toBe(0);
  });

  it('GAP uses radius=10 for jamming (rules.cpp:222, map.cpp:437-486)', () => {
    // C++ rules.cpp:222: GapShroudRadius(10)
    // C++ map.cpp:437: Jam_From uses jamrange parameter = Rule.GapShroudRadius
    // C++ map.cpp:446: if (!jamrange || jamrange > Rule.GapShroudRadius) return;
    // So max jam range is clamped to GapShroudRadius.
    const map = new GameMap();
    const gapStructure = {
      type: 'GAP',
      alive: true,
      hp: 100,
      maxHp: 100,
      cx: 64,
      cy: 64,
      house: 'Greece' as any,
    };

    const ctx = makeFogContext({
      map,
      structures: [gapStructure as any],
      tick: 0,
      powerProduced: 200,
      powerConsumed: 100,
    });

    updateGapGenerators(ctx);

    // The gap entry should have radius=10
    const entry = ctx.gapGeneratorCells.values().next().value;
    expect(entry).toBeDefined();
    expect(entry!.radius).toBe(10);
  });

  it('dead GAP generator does NOT jam', () => {
    // C++ building.cpp:990: if (*this == STRUCT_GAP) — only runs if building is alive in AI loop
    const map = new GameMap();
    const deadGap = {
      type: 'GAP',
      alive: false,
      hp: 0,
      maxHp: 100,
      cx: 64,
      cy: 64,
      house: 'Greece' as any,
    };

    const ctx = makeFogContext({
      map,
      structures: [deadGap as any],
      tick: 0,
      powerProduced: 200,
      powerConsumed: 100,
    });

    updateGapGenerators(ctx);

    expect(ctx.gapGeneratorCells.size).toBe(0);
  });
});


// ============================================================
// Section 4: GPS full map vision
// C++ house.cpp:1265, house.h:268, house.cpp:1420-1425
// ============================================================

describe('GPS full map vision (house.cpp:1265, house.h:268)', () => {
  /**
   * C++ house.h:268:
   *   unsigned IsGPSActive:1;
   *   // "satellite in orbit. If the satellite's there, they have
   *   //  unlimited radar and the map is fully revealed."
   *
   * C++ house.cpp:1265-1266:
   *   if (IsGPSActive) {
   *     jammed = false;
   *   }
   *   (GPS overrides radar jamming)
   *
   * C++ house.cpp:1302-1303:
   *   if (IsGPSActive || (ActiveBScan & STRUCTF_RADAR)) {
   *     if (Power_Fraction() >= 1 || IsGPSActive) {
   *       Map.Radar_Activate(1);
   *   (GPS activates radar regardless of power)
   *
   * C++ house.cpp:1420-1425:
   *   if (IsGPSActive && !(ActiveBScan & STRUCTF_ADVANCED_TECH)) {
   *     IsGPSActive = false;
   *     if (IsPlayerControl) {
   *       Map.Shroud_The_Map();
   *     }
   *   }
   *   (GPS deactivated when ATEK destroyed)
   */

  it('GPS active reveals entire map', () => {
    // C++ house.cpp:1265: IsGPSActive bypasses fog
    // TS fog.ts:63-66: if (ctx.gpsActive) { ctx.map.revealAll(); return; }
    const map = new GameMap();
    const ctx = makeFogContext({
      map,
      gpsActive: true,
      entities: [], // no units needed — GPS reveals all
    });

    updateFogOfWar(ctx);

    // All cells should be visible
    expect(map.getVisibility(0, 0)).toBe(2);
    expect(map.getVisibility(64, 64)).toBe(2);
    expect(map.getVisibility(MAP_CELLS - 1, MAP_CELLS - 1)).toBe(2);
  });

  it('GPS active bypasses all fog calculation (no units needed)', () => {
    // C++ house.cpp:1265: immediate check, skips everything else
    // TS fog.ts:63: checks gpsActive before iterating entities
    const map = new GameMap();
    const ctx = makeFogContext({
      map,
      gpsActive: true,
      entities: [], // deliberately empty
      structures: [],
    });

    updateFogOfWar(ctx);

    // Random cell should be revealed
    expect(map.getVisibility(50, 50)).toBe(2);
  });

  it('GPS active overrides radar jamming (house.cpp:1265-1266)', () => {
    // C++ house.cpp:1265-1266:
    //   if (IsGPSActive) { jammed = false; }
    // GPS prevents GAP jamming from hiding radar
    const map = new GameMap();
    const ctx = makeFogContext({
      map,
      gpsActive: true,
    });

    // Even if a cell was previously jammed
    map.jamCell(50, 50);

    updateFogOfWar(ctx);

    // GPS should override the jam
    expect(map.getVisibility(50, 50)).toBe(2);
  });

  it('GPS does NOT require power (house.cpp:1302-1303)', () => {
    // C++ house.cpp:1302-1303:
    //   if (Power_Fraction() >= 1 || IsGPSActive) { Map.Radar_Activate(1); }
    // GPS overrides power requirement
    const map = new GameMap();
    const ctx = makeFogContext({
      map,
      gpsActive: true,
      powerProduced: 0,  // No power at all
      powerConsumed: 100,
    });

    updateFogOfWar(ctx);

    expect(map.getVisibility(64, 64)).toBe(2);
  });
});


// ============================================================
// Section 5: Power-dependent GAP behavior
// C++ house.cpp:4160-4170, building.cpp:997, 1002
// ============================================================

describe('Power-dependent GAP (house.cpp:4160-4170, building.cpp:997)', () => {
  /**
   * C++ house.cpp:4160-4170 — Power_Fraction():
   *   if (Power >= Drain || Drain == 0) return(1);
   *   if (Power) { return(fixed(Power, Drain)); }
   *   return(0);
   *
   * C++ building.cpp:997: House->Power_Fraction() >= 1
   * GAP requires Power >= Drain (power fraction >= 1.0).
   * Any deficit (even 1 unit) disables GAP.
   *
   * TS fog.ts:191-193:
   *   const pf = ctx.powerProduced > 0
   *     ? ctx.powerProduced / Math.max(ctx.powerConsumed, 1)
   *     : 0;
   *
   * C++ returns 1 when Drain == 0 (no power consumers).
   * TS returns powerProduced/1 when powerConsumed <= 0.
   */

  it('GAP active when power exactly matches drain (Power_Fraction = 1)', () => {
    // C++ house.cpp:4164: if (Power >= Drain || Drain == 0) return(1);
    const map = new GameMap();
    const gapStructure = {
      type: 'GAP',
      alive: true,
      hp: 100,
      maxHp: 100,
      cx: 64,
      cy: 64,
      house: 'Greece' as any,
    };

    const ctx = makeFogContext({
      map,
      structures: [gapStructure as any],
      tick: 0,
      powerProduced: 100,
      powerConsumed: 100, // Power == Drain, fraction = 1
    });

    updateGapGenerators(ctx);
    expect(ctx.gapGeneratorCells.size).toBe(1);
  });

  it('GAP inactive when power is 1 unit short (Power_Fraction < 1)', () => {
    // C++ building.cpp:997: Power_Fraction() >= 1 check
    // Power=99, Drain=100 → fraction = 99/100 = 0.99 < 1
    const map = new GameMap();
    const gapStructure = {
      type: 'GAP',
      alive: true,
      hp: 100,
      maxHp: 100,
      cx: 64,
      cy: 64,
      house: 'Greece' as any,
    };

    const ctx = makeFogContext({
      map,
      structures: [gapStructure as any],
      tick: 0,
      powerProduced: 99,
      powerConsumed: 100, // fraction = 0.99 < 1
    });

    updateGapGenerators(ctx);
    expect(ctx.gapGeneratorCells.size).toBe(0);
  });

  it('GAP active when no drain (C++ Drain==0 returns 1)', () => {
    // C++ house.cpp:4164: if (Power >= Drain || Drain == 0) return(1);
    // When there is no power consumption, fraction is always 1.
    const map = new GameMap();
    const gapStructure = {
      type: 'GAP',
      alive: true,
      hp: 100,
      maxHp: 100,
      cx: 64,
      cy: 64,
      house: 'Greece' as any,
    };

    const ctx = makeFogContext({
      map,
      structures: [gapStructure as any],
      tick: 0,
      powerProduced: 200,
      powerConsumed: 0, // No drain — C++ returns 1
    });

    updateGapGenerators(ctx);
    expect(ctx.gapGeneratorCells.size).toBe(1);
  });

  it('GAP inactive when zero power production (C++ returns 0)', () => {
    // C++ house.cpp:4166-4169: if (Power) return fixed(Power,Drain); return 0;
    // Power=0 → returns 0 < 1 → GAP inactive
    const map = new GameMap();
    const gapStructure = {
      type: 'GAP',
      alive: true,
      hp: 100,
      maxHp: 100,
      cx: 64,
      cy: 64,
      house: 'Greece' as any,
    };

    const ctx = makeFogContext({
      map,
      structures: [gapStructure as any],
      tick: 0,
      powerProduced: 0,
      powerConsumed: 100,
    });

    updateGapGenerators(ctx);
    expect(ctx.gapGeneratorCells.size).toBe(0);
  });
});


// ============================================================
// Section 6: Sight range capping (map.cpp:296)
// ============================================================

describe('Sight range capping (map.cpp:286-296)', () => {
  /**
   * C++ map.cpp:296:
   *   if (!sightrange || sightrange > 10) return;
   *
   * Sight range is clamped to max 10 in C++. Values > 10 cause
   * Sight_From to return immediately with no cells revealed.
   * Also, sight range of 0 reveals nothing.
   */

  // PARITY GAP: C++ map.cpp:296 guards sightrange > 10 with early return (no cells revealed).
  // TS map.updateFogOfWar does not cap sight range — a unit with sight=15 reveals cells at radius 15.
  it('C++ caps sight range at 10 (map.cpp:296)', () => {
    // If TS allows sight > 10 to reveal more, that's a parity gap.
    // C++ returns immediately for sightrange > 10, revealing nothing.
    const map = new GameMap();
    const entity = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      stats: { sight: 15, isAntiSub: false, isCloakable: false, isInfantry: false } as any,
    });

    const ctx = makeFogContext({ map, entities: [entity] });
    updateFogOfWar(ctx);

    // C++ expected: sight > 10 → Sight_From returns immediately, NO cells revealed
    // (in practice, the Sight_From call for the unit itself would not execute)
    // TS may reveal cells within radius 15 without capping.
    // Check cell at distance 12 — C++ would NOT reveal this
    const vis = map.getVisibility(64 + 12, 64);

    // C++ says sight > 10 reveals NOTHING (returns early).
    // This is a strict interpretation. In practice, C++ units never have sight > 10.
    // But the code path exists and the guard is there.
    expect(vis).not.toBe(2); // PARITY GAP if TS reveals beyond 10
  });

  // PARITY GAP: C++ map.cpp:296 returns immediately for sightrange=0 (no cells revealed).
  // TS map.updateFogOfWar reveals the unit's own cell even with sight=0.
  it('C++ sight range 0 reveals nothing (map.cpp:296)', () => {
    // C++ map.cpp:296: if (!sightrange || ...) return;
    const map = new GameMap();
    const entity = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      stats: { sight: 0, isAntiSub: false, isCloakable: false, isInfantry: false } as any,
    });

    const ctx = makeFogContext({ map, entities: [entity] });
    updateFogOfWar(ctx);

    // With sight=0, no cells should be revealed
    expect(map.getVisibility(64, 64)).not.toBe(2);
  });
});


// ============================================================
// Section 7: Cloaking behavior at CONDITION_RED
// C++ techno.cpp:2443-2450, 2488-2492
// ============================================================

describe('Cloaking at CONDITION_RED (techno.cpp:2443-2450, 2488-2492)', () => {
  /**
   * C++ techno.cpp:2443-2450 — Cloaking_AI:
   *   if (Is_Ready_To_Cloak()) {
   *     if (Health_Ratio() > Rule.ConditionRed) {
   *       Do_Cloak();
   *     } else {
   *       if (Percent_Chance(4)) {
   *         Do_Cloak();
   *       }
   *     }
   *   }
   *
   * At CONDITION_RED:
   * - Healthy units (> 25% HP): always initiate cloak when ready
   * - Damaged units (<= 25% HP): only 4% chance per tick to cloak
   *
   * C++ techno.cpp:2488-2492 — during cloaking transition:
   *   case VISUAL_DARKEN:
   *     if (Health_Ratio() <= Rule.ConditionRed && Percent_Chance(25)) {
   *       Cloak = UNCLOAKING;
   *     }
   *     break;
   *
   * At CONDITION_RED during cloak transition:
   * - 25% chance per tick to abort cloaking and start uncloaking
   *
   * These are probabilistic behaviors. The tests verify the constants used.
   */

  it('C++ ConditionRed threshold is 0.25 (rules.cpp:235)', () => {
    // C++ rules.cpp:235: ConditionRed(fixed(1, 4))
    expect(CONDITION_RED).toBe(0.25);
  });

  it('C++ ConditionYellow threshold is 0.5 (rules.cpp:234)', () => {
    // C++ rules.cpp:234: ConditionYellow(fixed(1, 2))
    expect(CONDITION_YELLOW).toBe(0.5);
  });

  it('CloakState enum has 4 states matching C++ cloak stages', () => {
    // C++ techno.h defines: UNCLOAKED, CLOAKING, CLOAKED, UNCLOAKING
    expect(CloakState.UNCLOAKED).toBe(0);
    expect(CloakState.CLOAKING).toBe(1);
    expect(CloakState.CLOAKED).toBe(2);
    expect(CloakState.UNCLOAKING).toBe(3);
  });
});


// ============================================================
// Section 8: Fog disabled mode
// ============================================================

describe('Fog disabled mode', () => {
  it('fogDisabled reveals entire map (bypasses all fog calculation)', () => {
    // TS fog.ts:55-58: if (ctx.fogDisabled) { ctx.map.revealAll(); return; }
    const map = new GameMap();
    const ctx = makeFogContext({
      map,
      fogDisabled: true,
      entities: [],
    });

    updateFogOfWar(ctx);

    expect(map.getVisibility(0, 0)).toBe(2);
    expect(map.getVisibility(64, 64)).toBe(2);
  });
});


// ============================================================
// Section 9: GAP generator C++ Jam_From distance check
// C++ map.cpp:437-486 — Euclidean distance check
// ============================================================

describe('GAP generator Jam_From distance (map.cpp:437-486)', () => {
  /**
   * C++ map.cpp:477:
   *   if (Distance(Cell_Coord(newcell), Cell_Coord(cell)) > (jamrange * CELL_LEPTON_W)) continue;
   *
   * C++ uses Euclidean distance check with lepton precision.
   * TS fog.ts:221: if (dx * dx + dy * dy <= r2) — integer cell distance squared.
   *
   * Both use a circular pattern, but C++ uses lepton-precision distance while
   * TS uses integer cell distance. For radius=10, this is generally equivalent,
   * but corner cells may differ slightly.
   */

  it('GAP jams cells within radius using circular pattern', () => {
    const map = new GameMap();
    const gapStructure = {
      type: 'GAP',
      alive: true,
      hp: 100,
      maxHp: 100,
      cx: 64,
      cy: 64,
      house: 'Greece' as any,
    };

    const ctx = makeFogContext({
      map,
      structures: [gapStructure as any],
      tick: 0,
      powerProduced: 200,
      powerConsumed: 100,
    });

    updateGapGenerators(ctx);

    // GAP center (with structure size offset)
    const entry = ctx.gapGeneratorCells.values().next().value!;
    const cx = entry.cx;
    const cy = entry.cy;

    // Cell at distance 0 should be jammed
    expect(map.jammedCells.has(cy * MAP_CELLS + cx)).toBe(true);

    // Cell at distance 5 should be jammed (5^2 = 25 <= 100 = 10^2)
    expect(map.jammedCells.has(cy * MAP_CELLS + (cx + 5))).toBe(true);

    // Cell at distance 10 on axis should be jammed (10^2 = 100 <= 100)
    expect(map.jammedCells.has(cy * MAP_CELLS + (cx + 10))).toBe(true);

    // C++ coord.cpp:124-136 octagonal distance: max*2+min <= radius*2
    // Cell at (7,7): big=7,small=7 => 14+7=21 > 20 — NOT jammed (octagonal clips diagonals)
    expect(map.jammedCells.has((cy + 7) * MAP_CELLS + (cx + 7))).toBe(false);

    // Cell at (7,6): big=7,small=6 => 14+6=20 <= 20 — jammed (on the octagonal boundary)
    expect(map.jammedCells.has((cy + 6) * MAP_CELLS + (cx + 7))).toBe(true);

    // Cell at (8,7): big=8,small=7 => 16+7=23 > 20 — NOT jammed
    expect(map.jammedCells.has((cy + 7) * MAP_CELLS + (cx + 8))).toBe(false);
  });
});
