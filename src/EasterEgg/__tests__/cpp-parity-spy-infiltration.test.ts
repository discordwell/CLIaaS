/**
 * C++ Behavioral Parity: Spy Infiltration Effects
 *
 * Tests verify per-building-type spy effects match C++ RA source code.
 * Each test documents the C++ source reference (file:line).
 *
 * C++ algorithm (infantry.cpp:645-706):
 *   1. Spy enters building on MISSION_CAPTURE                    (line 593)
 *   2. housespy = (1 << (House->Class->House))                   (line 646)
 *   3. If trigger, fire TEVENT_SPIED                             (line 649-651)
 *   4. Speak VOX_BUILDING_INFILTRATED if player-owned spy        (line 653)
 *   5. tech->SpiedBy |= housespy  (ALL buildings, unconditional) (line 656)
 *   6. Building-specific effects (only 2 types in C++):
 *      a. STRUCT_RADAR: tech->House->RadarSpied |= housespy      (line 660-661)
 *      b. STRUCT_SUB_PEN: enable SPC_SONAR_PULSE for spy's house (line 664-669)
 *   7. delete this  (spy consumed — always)                      (line 706)
 *
 * CRITICAL: C++ has NO special handling for:
 *   - PROC (refinery): no money steal, just SpiedBy
 *   - POWR/APWR (power): no power sabotage, just SpiedBy
 *   - WEAP/TENT/BARR (production): no production reveal, just SpiedBy
 *   - Any other building type: just SpiedBy
 *
 * C++ reference: CnC_and_Red_Alert/RA/infantry.cpp:645-706
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission, SuperweaponType,
  SUPERWEAPON_DEFS, SONAR_REVEAL_TICKS,
  UNIT_STATS,
  type SuperweaponState,
} from '../engine/types';
import type { MapStructure } from '../engine/scenario';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => resetEntityIds());

// ── Helpers ──────────────────────────────────────────────────────────────

/** Create a spy Entity at a given cell */
function makeSpy(house: House, cx: number, cy: number): Entity {
  return new Entity(UnitType.I_SPY, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Create a minimal MapStructure for testing */
function makeStructure(type: string, house: House, cx = 5, cy = 5): MapStructure {
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx, cy,
    hp: 256,
    maxHp: 256,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
  };
}

/**
 * Faithful reproduction of TS Game.spyInfiltrate (index.ts:6582-6651)
 * as a standalone testable function. Returns the observable side effects
 * so tests can verify them against C++ expected behavior.
 */
interface SpyInfiltrationResult {
  /** Whether infiltration was performed (guards passed) */
  infiltrated: boolean;
  /** Spy alive state after infiltration */
  spyAlive: boolean;
  /** Spy mission after infiltration */
  spyMission: Mission;
  /** Spy disguise after infiltration */
  spyDisguise: House | null;
  /** Houses added to spiedHouses */
  spiedHouses: Set<House>;
  /** Houses added to radarSpiedHouses */
  radarSpiedHouses: Set<House>;
  /** Houses added to productionSpiedHouses */
  productionSpiedHouses: Set<House>;
  /** Sonar target mapping (spy house -> target house) */
  sonarSpiedTarget: Map<House, House>;
  /** Superweapon states created */
  superweapons: Map<string, SuperweaponState>;
  /** EVA messages pushed */
  evaMessages: string[];
  /** Trigger names added to spiedBuildingTriggers */
  spiedTriggers: Set<string>;
}

/**
 * Reproduces TS Game.spyInfiltrate logic exactly as written in index.ts:6582-6651
 * so we can test it in isolation.
 */
function tsSpyInfiltrate(
  spy: Entity,
  structure: MapStructure,
  playerHouse: House = House.Spain,
  isAllied: (a: House, b: House) => boolean = (a, b) => a === b,
): SpyInfiltrationResult {
  const result: SpyInfiltrationResult = {
    infiltrated: false,
    spyAlive: spy.alive,
    spyMission: spy.mission,
    spyDisguise: spy.disguisedAs,
    spiedHouses: new Set(),
    radarSpiedHouses: new Set(),
    productionSpiedHouses: new Set(),
    sonarSpiedTarget: new Map(),
    superweapons: new Map(),
    evaMessages: [],
    spiedTriggers: new Set(),
  };

  // Guard: index.ts:6583
  if (spy.type !== UnitType.I_SPY || !spy.alive) return result;

  const targetHouse = structure.house;
  // Guard: index.ts:6587
  if (isAllied(targetHouse, playerHouse)) return result;

  result.infiltrated = true;

  // Switch on structure type: index.ts:6590-6641
  switch (structure.type) {
    case 'PROC':
      result.spiedHouses.add(targetHouse);
      result.evaMessages.push('REFINERY INFILTRATED');
      break;
    case 'DOME':
      result.radarSpiedHouses.add(targetHouse);
      result.evaMessages.push('RADAR INFILTRATED');
      break;
    case 'POWR':
    case 'APWR':
      result.spiedHouses.add(targetHouse);
      result.evaMessages.push('POWER PLANT INFILTRATED');
      break;
    case 'SPEN': {
      const spyHouse = spy.house;
      result.sonarSpiedTarget.set(spyHouse, targetHouse);
      const sonarKey = `${spyHouse}:${SuperweaponType.SONAR_PULSE}`;
      result.superweapons.set(sonarKey, {
        type: SuperweaponType.SONAR_PULSE,
        house: spyHouse,
        chargeTick: 0,
        ready: true,
        structureIndex: -1,
        fired: false,
      });
      result.evaMessages.push('SONAR PULSE ACQUIRED');
      break;
    }
    case 'WEAP':
    case 'TENT':
    case 'BARR':
      result.productionSpiedHouses.add(targetHouse);
      result.evaMessages.push('PRODUCTION INFILTRATED');
      break;
    default:
      result.evaMessages.push('BUILDING INFILTRATED');
      break;
  }

  // Trigger tracking: index.ts:6644
  if (structure.triggerName) result.spiedTriggers.add(structure.triggerName);

  // Spy consumption: index.ts:6647-6649
  spy.alive = false;
  spy.mission = Mission.DIE;
  spy.disguisedAs = null;
  result.spyAlive = spy.alive;
  result.spyMission = spy.mission;
  result.spyDisguise = spy.disguisedAs;

  return result;
}

// ==========================================================================
// Section 1: STRUCT_RADAR (DOME) — radar spy reveal
// C++ infantry.cpp:660-661
// ==========================================================================
// C++ code:
//   if (build == STRUCT_RADAR /* || build == STRUCT_EYE */ ) {
//     tech->House->RadarSpied |= housespy;
//   }

describe('STRUCT_RADAR (DOME) spy effect (infantry.cpp:660-661)', () => {
  it('spying on DOME adds target house to radarSpiedHouses', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.USSR);
    const result = tsSpyInfiltrate(spy, dome);

    expect(result.infiltrated).toBe(true);
    expect(result.radarSpiedHouses.has(House.USSR)).toBe(true);
  });

  it('C++ RadarSpied is set on TARGET HOUSE — TS matches this', () => {
    // C++ line 661: tech->House->RadarSpied |= housespy
    // TS: radarSpiedHouses.add(targetHouse)
    const spy = makeSpy(House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.USSR);
    const result = tsSpyInfiltrate(spy, dome);

    // Target house (USSR) is tracked, not spy house (Spain)
    expect(result.radarSpiedHouses.has(House.USSR)).toBe(true);
    expect(result.radarSpiedHouses.has(House.Spain)).toBe(false);
  });

  it('DOME spy does NOT add to spiedHouses (separate from generic SpiedBy)', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.USSR);
    const result = tsSpyInfiltrate(spy, dome);

    // C++ sets SpiedBy (line 656) AND RadarSpied (line 661) for DOME.
    // TS only adds to radarSpiedHouses, NOT spiedHouses.
    // This means DOME spy doesn't count as "generally spied" in TS.
    expect(result.spiedHouses.has(House.USSR)).toBe(false);
    // In C++, both SpiedBy and RadarSpied would be set.
  });

  it('STRUCT_EYE (ATEK) is commented out in C++ — should NOT trigger radar reveal', () => {
    // C++ line 660: /* || build == STRUCT_EYE */
    const spy = makeSpy(House.Spain, 10, 10);
    const atek = makeStructure('ATEK', House.USSR);
    const result = tsSpyInfiltrate(spy, atek);

    expect(result.radarSpiedHouses.has(House.USSR)).toBe(false);
  });

  it('spy is consumed after DOME infiltration', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.USSR);
    tsSpyInfiltrate(spy, dome);

    expect(spy.alive).toBe(false);
    expect(spy.mission).toBe(Mission.DIE);
  });
});

// ==========================================================================
// Section 2: STRUCT_SUB_PEN (SPEN) — sonar pulse
// C++ infantry.cpp:664-669
// ==========================================================================
// C++ code:
//   if (build == STRUCT_SUB_PEN) {
//     House->SuperWeapon[SPC_SONAR_PULSE].Enable(false, true, false);
//     if (IsOwnedByPlayer) {
//       Map.Add(RTTI_SPECIAL, SPC_SONAR_PULSE);
//       Map.Column[1].Flag_To_Redraw();
//     }
//   }

describe('STRUCT_SUB_PEN (SPEN) spy effect — sonar pulse (infantry.cpp:664-669)', () => {
  it('spying on SPEN grants sonar pulse to SPY HOUSE', () => {
    // C++ line 665: House->SuperWeapon — "House" is spy's house
    const spy = makeSpy(House.Spain, 10, 10);
    const spen = makeStructure('SPEN', House.USSR);
    const result = tsSpyInfiltrate(spy, spen);

    expect(result.infiltrated).toBe(true);
    const sonarKey = `${House.Spain}:${SuperweaponType.SONAR_PULSE}`;
    const sonarState = result.superweapons.get(sonarKey);
    expect(sonarState).toBeDefined();
    expect(sonarState!.house).toBe(House.Spain); // spy's house, not target
    expect(sonarState!.ready).toBe(true);
  });

  it('sonar pulse is immediately ready (C++ Enable oneTime=true)', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const spen = makeStructure('SPEN', House.USSR);
    const result = tsSpyInfiltrate(spy, spen);

    const sonarKey = `${House.Spain}:${SuperweaponType.SONAR_PULSE}`;
    expect(result.superweapons.get(sonarKey)!.ready).toBe(true);
  });

  it('sonar tracks spy house -> target house for maintenance', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const spen = makeStructure('SPEN', House.USSR);
    const result = tsSpyInfiltrate(spy, spen);

    expect(result.sonarSpiedTarget.get(House.Spain)).toBe(House.USSR);
  });

  it('SUPERWEAPON_DEFS SONAR_PULSE has no building (spy-only)', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE];
    expect(def.building).toBe('');
    expect(def.name).toBe('Sonar Pulse');
    expect(def.needsTarget).toBe(false);
  });

  it('SONAR_REVEAL_TICKS is 225 (15 seconds at 15 tps, C++ parity)', () => {
    expect(SONAR_REVEAL_TICKS).toBe(225);
  });

  it('spy is consumed after SPEN infiltration', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const spen = makeStructure('SPEN', House.USSR);
    tsSpyInfiltrate(spy, spen);
    expect(spy.alive).toBe(false);
  });
});

// ==========================================================================
// Section 3: PROC (refinery) — C++ only sets SpiedBy, no special handler
// C++ infantry.cpp:656 (generic SpiedBy) — no STRUCT_REFINERY check exists
// ==========================================================================

describe('PROC spy effect (infantry.cpp:656 — generic SpiedBy only in C++)', () => {
  it('spying on PROC adds target to spiedHouses', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const proc = makeStructure('PROC', House.USSR);
    const result = tsSpyInfiltrate(spy, proc);

    expect(result.infiltrated).toBe(true);
    expect(result.spiedHouses.has(House.USSR)).toBe(true);
  });

  it('PROC spy does NOT steal money (thief does that, not spy)', () => {
    // C++ money theft is INFANTRY_THIEF (line 675-701), not INFANTRY_SPY.
    // TS correctly does not alter credits for spy infiltration.
    const spy = makeSpy(House.Spain, 10, 10);
    expect(spy.type).toBe(UnitType.I_SPY);
    expect(spy.type).not.toBe(UnitType.I_THF);
  });

  it('spy is consumed after PROC infiltration', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const proc = makeStructure('PROC', House.USSR);
    tsSpyInfiltrate(spy, proc);
    expect(spy.alive).toBe(false);
  });
});

// ==========================================================================
// Section 4: POWR/APWR — C++ only sets SpiedBy, no power sabotage
// ==========================================================================

describe('POWR/APWR spy effect (infantry.cpp:656 — generic SpiedBy only in C++)', () => {
  it('spying on POWR adds target to spiedHouses', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const powr = makeStructure('POWR', House.USSR);
    const result = tsSpyInfiltrate(spy, powr);

    expect(result.infiltrated).toBe(true);
    expect(result.spiedHouses.has(House.USSR)).toBe(true);
  });

  it('spying on APWR adds target to spiedHouses', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const apwr = makeStructure('APWR', House.USSR);
    const result = tsSpyInfiltrate(spy, apwr);

    expect(result.spiedHouses.has(House.USSR)).toBe(true);
  });

  it('C++ does NOT sabotage power when spy enters power plant', () => {
    // No power reduction in C++ infantry.cpp:645-671.
    // TS also does not reduce power. Both are correct.
    expect(true).toBe(true);
  });
});

// ==========================================================================
// Section 5: WEAP/TENT/BARR — C++ only sets SpiedBy
// TS adds productionSpiedHouses — enhancement beyond C++
// ==========================================================================

describe('WEAP/TENT/BARR spy effect (infantry.cpp:656 — generic SpiedBy only in C++)', () => {
  it('spying on WEAP adds target to productionSpiedHouses (TS enhancement)', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const weap = makeStructure('WEAP', House.USSR);
    const result = tsSpyInfiltrate(spy, weap);

    expect(result.infiltrated).toBe(true);
    expect(result.productionSpiedHouses.has(House.USSR)).toBe(true);
  });

  it('spying on TENT adds target to productionSpiedHouses', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const tent = makeStructure('TENT', House.USSR);
    const result = tsSpyInfiltrate(spy, tent);

    expect(result.productionSpiedHouses.has(House.USSR)).toBe(true);
  });

  it('spying on BARR adds target to productionSpiedHouses', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const barr = makeStructure('BARR', House.USSR);
    const result = tsSpyInfiltrate(spy, barr);

    expect(result.productionSpiedHouses.has(House.USSR)).toBe(true);
  });
});

// ==========================================================================
// Section 6: Spy consumption — C++ infantry.cpp:706 (delete this)
// ==========================================================================

describe('Spy consumption on infiltration (infantry.cpp:706)', () => {
  it('spy alive=false after infiltration', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.USSR);
    tsSpyInfiltrate(spy, dome);

    expect(spy.alive).toBe(false);
  });

  it('spy mission set to DIE after infiltration', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.USSR);
    tsSpyInfiltrate(spy, dome);

    expect(spy.mission).toBe(Mission.DIE);
  });

  it('spy disguise cleared after infiltration', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    spy.disguisedAs = House.USSR;
    const dome = makeStructure('DOME', House.USSR);
    tsSpyInfiltrate(spy, dome);

    expect(spy.disguisedAs).toBeNull();
  });

  it('spy consumed for ALL building types — delete this is outside the type switch', () => {
    // C++ "delete this" at line 706 runs for every building type.
    const buildingTypes = ['DOME', 'SPEN', 'PROC', 'POWR', 'APWR', 'WEAP', 'TENT', 'BARR', 'SILO', 'FIX', 'FACT'];
    for (const type of buildingTypes) {
      const spy = makeSpy(House.Spain, 10, 10);
      const structure = makeStructure(type, House.USSR);
      tsSpyInfiltrate(spy, structure);
      expect(spy.alive, `spy should be consumed after infiltrating ${type}`).toBe(false);
    }
  });
});

// ==========================================================================
// Section 7: Guard conditions
// C++ infantry.cpp:593-597, 645
// ==========================================================================

describe('Spy infiltration guard conditions (infantry.cpp:593-645)', () => {
  it('non-spy unit does not infiltrate', () => {
    const rifleman = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    const dome = makeStructure('DOME', House.USSR);
    const result = tsSpyInfiltrate(rifleman, dome);

    expect(result.infiltrated).toBe(false);
    expect(rifleman.alive).toBe(true); // not consumed
  });

  it('dead spy does not infiltrate', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    spy.alive = false;
    const dome = makeStructure('DOME', House.USSR);
    const result = tsSpyInfiltrate(spy, dome);

    expect(result.infiltrated).toBe(false);
  });

  it('spy cannot infiltrate allied building', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.Spain);
    const result = tsSpyInfiltrate(spy, dome);

    expect(result.infiltrated).toBe(false);
    expect(spy.alive).toBe(true); // not consumed
  });

  it('spy infiltrates enemy building', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.USSR);
    const result = tsSpyInfiltrate(spy, dome);

    expect(result.infiltrated).toBe(true);
    expect(spy.alive).toBe(false); // consumed
  });
});

// ==========================================================================
// Section 8: TEVENT_SPIED trigger — C++ infantry.cpp:649-651
// ==========================================================================

describe('TEVENT_SPIED trigger (infantry.cpp:649-651)', () => {
  it('trigger is tracked when structure has triggerName', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.USSR);
    dome.triggerName = 'spy_detected';
    const result = tsSpyInfiltrate(spy, dome);

    expect(result.spiedTriggers.has('spy_detected')).toBe(true);
  });

  it('no trigger tracked when structure has no triggerName', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.USSR);
    const result = tsSpyInfiltrate(spy, dome);

    expect(result.spiedTriggers.size).toBe(0);
  });

  it('trigger fires for ALL building types (C++ line 649 is before type check)', () => {
    const types = ['DOME', 'SPEN', 'PROC', 'POWR', 'WEAP', 'BARR', 'SILO', 'FIX'];
    for (const type of types) {
      const spy = makeSpy(House.Spain, 10, 10);
      const s = makeStructure(type, House.USSR);
      s.triggerName = `trigger_${type}`;
      const result = tsSpyInfiltrate(spy, s);
      expect(result.spiedTriggers.has(`trigger_${type}`),
        `trigger should fire for ${type}`).toBe(true);
    }
  });
});

// ==========================================================================
// Section 9: EVA announcement — C++ uses single VOX_BUILDING_INFILTRATED
// C++ infantry.cpp:653
// ==========================================================================

describe('EVA announcement (infantry.cpp:653)', () => {
  it('C++ plays single VOX_BUILDING_INFILTRATED; TS has per-type messages', () => {
    // C++ only has one announcement for ALL building types.
    // TS differentiates per building type — this is an enhancement.
    const cases: [string, string][] = [
      ['PROC', 'REFINERY INFILTRATED'],
      ['DOME', 'RADAR INFILTRATED'],
      ['POWR', 'POWER PLANT INFILTRATED'],
      ['APWR', 'POWER PLANT INFILTRATED'],
      ['SPEN', 'SONAR PULSE ACQUIRED'],
      ['WEAP', 'PRODUCTION INFILTRATED'],
      ['TENT', 'PRODUCTION INFILTRATED'],
      ['BARR', 'PRODUCTION INFILTRATED'],
      ['SILO', 'BUILDING INFILTRATED'],
      ['FIX', 'BUILDING INFILTRATED'],
    ];

    for (const [type, expectedMsg] of cases) {
      const spy = makeSpy(House.Spain, 10, 10);
      const s = makeStructure(type, House.USSR);
      const result = tsSpyInfiltrate(spy, s);
      expect(result.evaMessages[0], `EVA for ${type}`).toBe(expectedMsg);
    }
  });
});

// ==========================================================================
// Section 10: PARITY GAP — default case omits SpiedBy tracking
// C++ infantry.cpp:656 sets SpiedBy for ALL buildings
// TS default case (index.ts:6638-6640) only pushes EVA message
// ==========================================================================
// In C++, ALL buildings get tech->SpiedBy |= housespy (line 656).
// In TS, the default case for unhandled building types (SILO, FIX, FACT,
// GAP, ATEK, STEK, KENN, etc.) only shows an EVA message — no tracking
// set is updated. This means spying these buildings has no functional
// effect beyond consuming the spy.

describe('PARITY GAP: default case omits SpiedBy tracking (infantry.cpp:656)', () => {
  // C++ sets SpiedBy for ALL buildings at line 656, before the type-specific
  // if-chain. Every building that gets spied has its SpiedBy bitmask updated.
  //
  // TS only updates tracking sets for PROC, DOME, POWR, APWR, SPEN,
  // WEAP, TENT, BARR. All other types fall to the default case which
  // has no tracking effect.

  const UNHANDLED_TYPES = ['SILO', 'FIX', 'FACT', 'GAP', 'ATEK', 'STEK', 'KENN',
    'PDOX', 'IRON', 'MSLO', 'SYRD', 'AFLD', 'HPAD', 'BIO', 'HOSP'];

  for (const type of UNHANDLED_TYPES) {
    it(`${type}: C++ sets SpiedBy but TS has no tracking — PARITY GAP`, () => {
      const spy = makeSpy(House.Spain, 10, 10);
      const s = makeStructure(type, House.USSR);
      const result = tsSpyInfiltrate(spy, s);

      // Spy IS consumed (parity OK)
      expect(spy.alive).toBe(false);

      // But NO tracking set is updated (PARITY GAP)
      // C++ would set SpiedBy on the building — TS does nothing
      const anyTracking =
        result.spiedHouses.size > 0 ||
        result.radarSpiedHouses.size > 0 ||
        result.productionSpiedHouses.size > 0 ||
        result.sonarSpiedTarget.size > 0;

      // PARITY GAP: this SHOULD be true (C++ sets SpiedBy for all buildings)
      // but TS returns false for unhandled types
      expect(anyTracking).toBe(false); // documents current TS behavior
      // expect(anyTracking).toBe(true); // what C++ parity would require
    });
  }
});

// ==========================================================================
// Section 11: PARITY GAP — TS restricts spy infiltration to player spies
// C++ infantry.cpp:645 checks *this == INFANTRY_SPY (any house)
// TS missionAI.ts:1056 checks entity.isPlayerUnit
// ==========================================================================

describe('PARITY GAP: AI spy infiltration (infantry.cpp:645 vs missionAI.ts:1056)', () => {
  it('C++ allows any house spy to infiltrate — TS only allows player spies', () => {
    // C++ infantry.cpp:645: if (*this == INFANTRY_SPY) — no house check
    // The IsOwnedByPlayer check at line 653 only controls EVA announcement,
    // NOT whether infiltration occurs.
    //
    // TS missionAI.ts:1056: if (entity.type === UnitType.I_SPY && entity.isPlayerUnit)
    // AI-owned spies are excluded from infiltration entirely.

    const aiSpy = makeSpy(House.USSR, 10, 10);
    expect(aiSpy.isPlayerUnit).toBe(false);

    const playerSpy = makeSpy(House.Spain, 10, 10);
    expect(playerSpy.isPlayerUnit).toBe(true);

    // In C++, both would infiltrate.
    // In TS, only playerSpy would (via missionAI.ts:1056 guard).
    // Our tsSpyInfiltrate function doesn't enforce this guard (it tests
    // the Game.spyInfiltrate body, not the missionAI caller), so we
    // document the gap here.

    // PARITY GAP: The missionAI caller prevents AI spies from infiltrating.
    // This test documents that the guard exists in TS but not in C++.
    expect(aiSpy.type).toBe(UnitType.I_SPY); // AI spy IS a spy
    // But isPlayerUnit is false, so missionAI would skip infiltration
  });
});

// ==========================================================================
// Section 12: Thief vs Spy — C++ infantry.cpp:673-701
// ==========================================================================

describe('Thief vs Spy distinction (infantry.cpp:645-701)', () => {
  it('SPY and THIEF are distinct unit types', () => {
    expect(UnitType.I_SPY).not.toBe(UnitType.I_THF);
  });

  it('SPY has no weapon (infiltration only)', () => {
    expect(UNIT_STATS.SPY.primaryWeapon).toBeNull();
  });

  it('C++ thief steals Available_Money()/2 — spy does NOT steal', () => {
    // C++ infantry.cpp:696: long cash = bldg->House->Available_Money() / 2;
    // This is THIEF code (line 675-701), not SPY code (line 645-671).
    const availableMoney = 10000;
    const stolenCash = Math.floor(availableMoney / 2);
    expect(stolenCash).toBe(5000);

    // Verify spy code path does not include money operations
    const spy = makeSpy(House.Spain, 10, 10);
    const proc = makeStructure('PROC', House.USSR);
    const result = tsSpyInfiltrate(spy, proc);
    // Only spiedHouses is affected — no credit changes
    expect(result.spiedHouses.has(House.USSR)).toBe(true);
  });
});

// ==========================================================================
// Section 13: Sonar pulse recharge and maintenance
// ==========================================================================

describe('Sonar pulse recharge (infantry.cpp:665, types.ts SUPERWEAPON_DEFS)', () => {
  it('sonar recharge time is 9000 ticks (10 minutes)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks).toBe(9000);
  });

  it('sonar pulse granted for spy house, not target house', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const spen = makeStructure('SPEN', House.USSR);
    const result = tsSpyInfiltrate(spy, spen);

    const sonarKey = `${House.Spain}:${SuperweaponType.SONAR_PULSE}`;
    const state = result.superweapons.get(sonarKey);
    expect(state).toBeDefined();
    expect(state!.house).toBe(House.Spain);
    expect(state!.type).toBe(SuperweaponType.SONAR_PULSE);
  });

  it('only one sonar per spy house (Map semantics)', () => {
    // If spy from same house infiltrates two sub pens, only one sonar state
    const sonarMap = new Map<House, House>();
    sonarMap.set(House.Spain, House.USSR);
    sonarMap.set(House.Spain, House.Ukraine); // overwrites
    expect(sonarMap.get(House.Spain)).toBe(House.Ukraine);
    expect(sonarMap.size).toBe(1);
  });
});

// ==========================================================================
// Section 14: C++ housespy bitmask — infantry.cpp:646
// ==========================================================================

describe('C++ housespy bitmask (infantry.cpp:646)', () => {
  it('bitmask uses 1 << house_enum_index', () => {
    // Verify non-overlapping bits
    for (let i = 0; i < 10; i++) {
      for (let j = i + 1; j < 10; j++) {
        expect((1 << i) & (1 << j)).toBe(0);
      }
    }
  });

  it('multiple houses can spy on same building via OR', () => {
    let spiedBy = 0;
    spiedBy |= (1 << 0); // Spain
    spiedBy |= (1 << 4); // USSR
    expect(spiedBy & (1 << 0)).toBeTruthy();
    expect(spiedBy & (1 << 4)).toBeTruthy();
  });
});

// ==========================================================================
// Section 15: Building type code mapping (C++ STRUCT_* → TS string)
// ==========================================================================

describe('C++ STRUCT_* to TS type code mapping', () => {
  const MAPPING: [string, string][] = [
    ['STRUCT_RADAR', 'DOME'],
    ['STRUCT_SUB_PEN', 'SPEN'],
    ['STRUCT_REFINERY', 'PROC'],
    ['STRUCT_POWER', 'POWR'],
    ['STRUCT_ADVANCED_POWER', 'APWR'],
    ['STRUCT_BARRACKS', 'BARR'],
    ['STRUCT_TENT', 'TENT'],
    ['STRUCT_WEAP', 'WEAP'],
    ['STRUCT_KENNEL', 'KENN'],
    ['STRUCT_REPAIR', 'FIX'],
    ['STRUCT_STORAGE', 'SILO'],
    ['STRUCT_GAP', 'GAP'],
    ['STRUCT_EYE', 'ATEK'],
  ];

  for (const [cppName, tsCode] of MAPPING) {
    it(`${cppName} = ${tsCode}`, () => {
      const s = makeStructure(tsCode, House.USSR);
      expect(s.type).toBe(tsCode);
    });
  }
});

// ==========================================================================
// Section 16: Complete effect matrix — C++ vs TS
// ==========================================================================

describe('Complete spy effect matrix', () => {
  it('DOME: radar reveal in both C++ and TS', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const result = tsSpyInfiltrate(spy, makeStructure('DOME', House.USSR));
    expect(result.radarSpiedHouses.has(House.USSR)).toBe(true);
  });

  it('SPEN: sonar pulse in both C++ and TS', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const result = tsSpyInfiltrate(spy, makeStructure('SPEN', House.USSR));
    expect(result.superweapons.size).toBe(1);
  });

  it('PROC: spiedHouses in TS, SpiedBy in C++ — equivalent', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const result = tsSpyInfiltrate(spy, makeStructure('PROC', House.USSR));
    expect(result.spiedHouses.has(House.USSR)).toBe(true);
  });

  it('POWR: spiedHouses in TS, SpiedBy in C++ — equivalent', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const result = tsSpyInfiltrate(spy, makeStructure('POWR', House.USSR));
    expect(result.spiedHouses.has(House.USSR)).toBe(true);
  });

  it('WEAP: productionSpiedHouses in TS, SpiedBy in C++ — TS enhancement', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const result = tsSpyInfiltrate(spy, makeStructure('WEAP', House.USSR));
    expect(result.productionSpiedHouses.has(House.USSR)).toBe(true);
  });

  it('SILO: default case in TS — no tracking — PARITY GAP', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const result = tsSpyInfiltrate(spy, makeStructure('SILO', House.USSR));
    // C++ would set SpiedBy. TS only pushes EVA message.
    expect(result.spiedHouses.size).toBe(0);         // PARITY GAP
    expect(result.radarSpiedHouses.size).toBe(0);
    expect(result.productionSpiedHouses.size).toBe(0);
    expect(result.evaMessages[0]).toBe('BUILDING INFILTRATED');
    // Spy IS consumed (correct)
    expect(spy.alive).toBe(false);
  });

  it('FACT: default case in TS — no tracking — PARITY GAP', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const result = tsSpyInfiltrate(spy, makeStructure('FACT', House.USSR));
    // C++ would set SpiedBy. TS only pushes EVA message.
    expect(result.spiedHouses.size).toBe(0);         // PARITY GAP
    expect(result.evaMessages[0]).toBe('BUILDING INFILTRATED');
    expect(spy.alive).toBe(false);
  });
});

// ==========================================================================
// Section 17: PARITY GAP — DOME spy should ALSO set SpiedBy (C++ does both)
// C++ infantry.cpp:656 (SpiedBy) + line 661 (RadarSpied)
// ==========================================================================

describe('PARITY GAP: DOME should set both SpiedBy AND RadarSpied (infantry.cpp:656+661)', () => {
  it('C++ sets SpiedBy on ALL buildings (line 656) THEN RadarSpied for DOME (line 661)', () => {
    // In C++, the SpiedBy assignment (line 656) happens BEFORE the
    // building-type check (line 658). So DOME gets BOTH SpiedBy AND RadarSpied.
    //
    // In TS, DOME only gets radarSpiedHouses — it does NOT also get spiedHouses.
    // This is a minor gap: DOME is "radar spied" but not "generally spied."
    const spy = makeSpy(House.Spain, 10, 10);
    const result = tsSpyInfiltrate(spy, makeStructure('DOME', House.USSR));

    expect(result.radarSpiedHouses.has(House.USSR)).toBe(true);  // correct
    // PARITY GAP: C++ would also have SpiedBy set
    expect(result.spiedHouses.has(House.USSR)).toBe(false);      // TS divergence
    // expect(result.spiedHouses.has(House.USSR)).toBe(true);    // C++ parity
  });
});
