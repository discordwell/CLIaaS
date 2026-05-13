/**
 * @vitest-environment jsdom
 *
 * C++ Behavioral Parity: HPAD Helicopter Guard — Find_Juicy_Target + Target_Something_Nearby
 *
 * Tests verify HPAD-docked helicopter guard scan matches C++ AircraftClass::Mission_Guard
 * (aircraft.cpp:3678-3807) → FootClass::Mission_Guard (foot.cpp:589-635).
 *
 * C++ execution order for AI helicopter (Height==0, !IsHuman):
 *   1. Target_Legal(TarCom) → ATTACK, return 1
 *   2. Height==0 && !In_Radio_Contact → Scatter (docked = in contact, skip)
 *   3. House->State != STATE_ATTACKED → Find_Juicy_Target (house.cpp:6900)
 *   4. FootClass::Mission_Guard → Target_Something_Nearby (techno.cpp:5251)
 *   5. Return delay
 *
 * Find_Juicy_Target (house.cpp:6900-6927):
 *   - Searches the C++ Units pool only: UnitClass vehicles, not infantry/vessels/aircraft
 *   - Filters: alive, !InLimbo, !allied, Which_Zone(unit) == ZONE_NONE (outside own base)
 *   - Distance scoring: closer is better
 *   - Harvester distance halved (priority)
 *   - AA unit distance doubled (penalty)
 *   - Sets TarCom + mission=ATTACK, but does NOT return — falls through
 *
 * Target_Something_Nearby (techno.cpp:5251-5281):
 *   - If TarCom valid: check if in selected weapon range. If not, clear TarCom.
 *   - If no TarCom: Greatest_Threat(THREAT_RANGE) using Threat_Range(0).
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  House, Mission, UnitType, CELL_SIZE, RESFACTOR,
} from '../engine/types';
import type { MapStructure } from '../engine/scenario';
import { RandomClass, ScenarioRandom } from '../engine/random';

// ── Test infrastructure ──────────────────────────────────────────────────────

class FakeAudio {
  src = ''; preload = ''; volume = 1; currentTime = 0; muted = false; loop = false;
  addEventListener(): void {} removeEventListener(): void {}
  play(): Promise<void> { return Promise.resolve(); } pause(): void {}
  cloneNode(): FakeAudio { return new FakeAudio(); }
}

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 320 * RESFACTOR;
  canvas.height = 200 * RESFACTOR;
  return canvas;
}

function createGame(): Game {
  const game = new Game(createCanvas());
  game.playerHouse = House.Greece;
  game.map.setBounds(0, 0, 48, 48); // larger map for distance tests
  return game;
}

/** Access private _heliGuardScan via type cast */
function callHeliGuardScan(game: Game, heli: Entity): boolean {
  return (game as unknown as { _heliGuardScan(heli: Entity): boolean })._heliGuardScan(heli);
}

function runStructureLogic(game: Game): void {
  const g = game as unknown as {
    _combatCtx: unknown;
    tickStructuresInterleaved(ctx: unknown): void;
  };
  g.tickStructuresInterleaved(g._combatCtx);
}

/** Place entity at cell center */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Make a minimal HPAD structure */
function makeHPAD(house: House, cx: number, cy: number): MapStructure {
  return {
    type: 'HPAD', image: 'hpad', house, cx, cy,
    hp: 256, maxHp: 256, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  } as MapStructure;
}

/** Make a minimal structure (e.g., enemy base building) */
function makeStructure(type: string, house: House, cx: number, cy: number): MapStructure {
  return {
    type, image: type.toLowerCase(), house, cx, cy,
    hp: 500, maxHp: 500, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  } as MapStructure;
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

beforeEach(() => { resetEntityIds(); });

// ── Find_Juicy_Target tests ──────────────────────────────────────────────────

describe('HPAD helicopter guard — Find_Juicy_Target (house.cpp:6900)', () => {

  it('finds an enemy harvester outside its own base zone', () => {
    // C++ house.cpp:6910: Which_Zone(unit) == ZONE_NONE → unit far from own structures
    // C++ house.cpp:6915: if (*unit == UNIT_HARVESTER) val /= 2 → harvester priority
    const game = createGame();

    // Soviet HPAD at (10,10) with HIND docked
    const hpad = makeHPAD(House.USSR, 10, 10);
    game.structures.push(hpad);

    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.mission = Mission.GUARD;
    hind.aircraftState = 'landed';
    game.entities.push(hind);
    game.entityById.set(hind.id, hind);

    // Allied harvester at (13,10) — 3 cells from HIND, within scan range (5 cells)
    // The harvester is FAR from any Allied structures → ZONE_NONE
    const harvester = entityAtCell(UnitType.V_HARV, House.Greece, 13, 10);
    game.entities.push(harvester);
    game.entityById.set(harvester.id, harvester);

    // No Allied structures near harvester → it's outside base zone
    callHeliGuardScan(game, hind);

    // Find_Juicy_Target should find the harvester (outside base, within range)
    expect(hind.target).toBe(harvester);
  });

  it('does NOT find harvester inside its own base zone', () => {
    // C++ house.cpp:6910: Which_Zone(unit) != ZONE_NONE → unit near own structures → skip
    const game = createGame();

    const hpad = makeHPAD(House.USSR, 10, 10);
    game.structures.push(hpad);

    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.mission = Mission.GUARD;
    hind.aircraftState = 'landed';
    game.entities.push(hind);
    game.entityById.set(hind.id, hind);

    // Allied base near (16,10) — within 10 cells of harvester
    const allyBase = makeStructure('FACT', House.Greece, 16, 10);
    game.structures.push(allyBase);

    // Harvester at (13,10) — near its own FACT → inside base zone
    const harvester = entityAtCell(UnitType.V_HARV, House.Greece, 13, 10);
    game.entities.push(harvester);
    game.entityById.set(harvester.id, harvester);

    const juicyFound = callHeliGuardScan(game, hind);

    // Harvester is inside its own base zone → Find_Juicy_Target skips it.
    // Target_Something_Nearby may still pick a nearby building from the same
    // base, but that must not be reported as a juicy harvester hit.
    expect(juicyFound).toBe(false);
    expect(hind.target).not.toBe(harvester);
  });

  it('uses C++ weighted base radius instead of nearest-building distance for Which_Zone', () => {
    // C++ HouseClass::Recalc_Center weights building centers by Cost_Of() and
    // computes one base radius. A unit can be more than 10 cells from every
    // individual structure and still be inside its house's base zone.
    const game = createGame();

    const hpad = makeHPAD(House.USSR, 10, 10);
    game.structures.push(hpad);

    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.mission = Mission.GUARD;
    hind.aircraftState = 'landed';
    game.entities.push(hind);
    game.entityById.set(hind.id, hind);

    // Two equal-cost FACTs create a center at (18.5,21.5), radius 4 cells
    // after C++'s weighted-count division, and an outer zone of 16 cells.
    game.structures.push(makeStructure('FACT', House.Greece, 5, 20));
    game.structures.push(makeStructure('FACT', House.Greece, 29, 20));

    // This harvester is 14 cells from the C++ base center, so Which_Zone is
    // not ZONE_NONE. It is still over 10 cells from both FACTs, which exposed
    // the old per-structure approximation as a false juicy target.
    const harvester = entityAtCell(UnitType.V_HARV, House.Greece, 18, 35);
    game.entities.push(harvester);
    game.entityById.set(harvester.id, harvester);

    const juicyFound = callHeliGuardScan(game, hind);

    expect(juicyFound).toBe(false);
    expect(hind.target).not.toBe(harvester);
  });

  it('prioritizes harvesters over other units at same distance', () => {
    // C++ house.cpp:6915: harvester distance halved → appears closer
    const game = createGame();

    const hpad = makeHPAD(House.USSR, 10, 10);
    game.structures.push(hpad);

    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.mission = Mission.GUARD;
    hind.aircraftState = 'landed';
    game.entities.push(hind);
    game.entityById.set(hind.id, hind);

    // Two enemy units at same distance, both outside base zone, within scan range
    // Medium tank at (13,10) — 3 cells away
    const tank = entityAtCell(UnitType.V_2TNK, House.Greece, 13, 10);
    game.entities.push(tank);
    game.entityById.set(tank.id, tank);

    // Harvester at (14,10) — 4 cells away (farther), but distance halved → appears at 2 cells
    const harvester = entityAtCell(UnitType.V_HARV, House.Greece, 14, 10);
    game.entities.push(harvester);
    game.entityById.set(harvester.id, harvester);

    callHeliGuardScan(game, hind);

    // Find_Juicy_Target should prefer harvester (halved distance wins)
    // Note: Target_Something_Nearby may override if it finds a higher-threat target in range.
    // But since both are in range and Find_Juicy_Target sets the target first,
    // Target_Something_Nearby validates and keeps it (TarCom is legal and in range).
    expect(hind.target).toBe(harvester);
  });

  it('skips Find_Juicy_Target when house is under attack', () => {
    // C++ aircraft.cpp:3798: if (House->State != STATE_ATTACKED)
    // When under attack, skip harvester hunting → only use Target_Something_Nearby
    const game = createGame();

    const hpad = makeHPAD(House.USSR, 10, 10);
    game.structures.push(hpad);

    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.mission = Mission.GUARD;
    hind.aircraftState = 'landed';
    game.entities.push(hind);
    game.entityById.set(hind.id, hind);

    // Set Soviet house to "under attack" state
    const aiStates = (game as unknown as { aiStates: Map<House, { underAttack: boolean }> }).aiStates;
    if (!aiStates.has(House.USSR)) {
      // Create minimal AI state — the real one is created by createAIHouseState
      // but for this test we just need the underAttack flag
      aiStates.set(House.USSR, { underAttack: true } as never);
    } else {
      aiStates.get(House.USSR)!.underAttack = true;
    }

    // Enemy harvester outside base zone, within scan range
    const harvester = entityAtCell(UnitType.V_HARV, House.Greece, 13, 10);
    game.entities.push(harvester);
    game.entityById.set(harvester.id, harvester);

    callHeliGuardScan(game, hind);

    // Find_Juicy_Target skipped (under attack). Target_Something_Nearby finds harvester.
    // The harvester IS in weapon range, so Greatest_Threat finds it.
    // The target is the harvester — same result in this case, but the PATH differs:
    // C++ would only use Greatest_Threat, not Find_Juicy_Target distance scoring.
    expect(hind.target).toBe(harvester);
  });

  it('uses GuardRange for HPAD helicopter FootClass Target_Something_Nearby', () => {
    // C++ TechnoClass::Threat_Range(0) returns type GuardRange when it is set.
    // Scenario overrides such as SCG12EA [HIND] GuardRange=18 therefore widen
    // FootClass::Mission_Guard beyond HIND's ChainGun range.
    const game = createGame();

    const hpad = makeHPAD(House.USSR, 10, 10);
    game.structures.push(hpad);

    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.mission = Mission.GUARD;
    hind.aircraftState = 'landed';
    hind.stats = { ...hind.stats, guardRange: 18 };
    game.entities.push(hind);
    game.entityById.set(hind.id, hind);

    const aiStates = (game as unknown as { aiStates: Map<House, { underAttack: boolean }> }).aiStates;
    aiStates.set(House.USSR, { underAttack: true } as never);

    const rifleman = entityAtCell(UnitType.I_E1, House.Greece, 24, 10);
    game.entities.push(rifleman);
    game.entityById.set(rifleman.id, rifleman);

    const juicyFound = callHeliGuardScan(game, hind);

    expect(juicyFound).toBe(false);
    expect(hind.target).toBe(rifleman);
  });

  it('does not treat InfantryClass targets as Find_Juicy_Target hits', () => {
    // C++ house.cpp:6911 iterates Units.Count()/UnitClass*, so infantry can be
    // found later by Target_Something_Nearby but must not queue ATTACK as juicy.
    const game = createGame();

    const hpad = makeHPAD(House.USSR, 10, 10);
    game.structures.push(hpad);

    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.mission = Mission.GUARD;
    hind.aircraftState = 'landed';
    game.entities.push(hind);
    game.entityById.set(hind.id, hind);

    const rifleman = entityAtCell(UnitType.I_E1, House.Greece, 13, 10);
    game.entities.push(rifleman);
    game.entityById.set(rifleman.id, rifleman);

    const juicyFound = callHeliGuardScan(game, hind);

    expect(juicyFound).toBe(false);
    expect(hind.target).toBe(rifleman);
  });

  it('does not treat VesselClass targets as Find_Juicy_Target hits', () => {
    // C++ vessels live in a separate object pool from Units. FootClass's
    // Target_Something_Nearby can still find them through the ordinary threat scan.
    const game = createGame();

    const hpad = makeHPAD(House.USSR, 10, 10);
    game.structures.push(hpad);

    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.mission = Mission.GUARD;
    hind.aircraftState = 'landed';
    game.entities.push(hind);
    game.entityById.set(hind.id, hind);

    const transport = entityAtCell(UnitType.V_LST, House.Greece, 25, 10);
    game.entities.push(transport);
    game.entityById.set(transport.id, transport);

    const juicyFound = callHeliGuardScan(game, hind);

    expect(juicyFound).toBe(false);
    expect(hind.target).toBe(transport);
  });

  it('target found only by Target_Something_Nearby stays in GUARD until the next guard timer fire', () => {
    // C++ aircraft.cpp:3793 checks Target_Legal(TarCom) before falling through
    // to FootClass::Mission_Guard. A target first found by FootClass at
    // foot.cpp:646 does not queue MISSION_ATTACK until a later guard fire.
    const game = createGame();
    game.playerHouse = House.Greece;

    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.mission = Mission.GUARD;
    hind.missionTimer = 0;
    hind.aircraftState = 'landed';
    hind.flightAltitude = 0;
    game.entities.push(hind);
    game.entityById.set(hind.id, hind);

    const hpad = makeHPAD(House.USSR, 10, 10);
    hpad.hpadHelicopterId = hind.id;
    hpad.missionTimer = 999;
    game.structures.push(hpad);

    const aiStates = (game as unknown as { aiStates: Map<House, { underAttack: boolean }> }).aiStates;
    aiStates.set(House.USSR, { underAttack: true } as never);

    const rifleman = entityAtCell(UnitType.I_E1, House.Greece, 13, 10);
    game.entities.push(rifleman);
    game.entityById.set(rifleman.id, rifleman);

    const savedSeed = ScenarioRandom.seed;
    try {
      ScenarioRandom.seed = 0x12345678;

      runStructureLogic(game);

      expect(hind.target).toBe(rifleman);
      expect(hind.mission).toBe(Mission.GUARD);
      expect(hind.aircraftState).toBe('landed');
      expect(hind.missionTimer).toBeGreaterThanOrEqual(41);
      expect(hind.missionTimer).toBeLessThanOrEqual(43);
    } finally {
      ScenarioRandom.seed = savedSeed;
    }
  });

  it('starts the returned guard delay on the same logic frame', () => {
    // C++ MissionClass::AI assigns Timer = Mission_Guard() into a CDTimerClass
    // started at the current Frame. The value visible after the same object AI
    // has run is therefore returnedDelay - 1, not the full returnedDelay.
    const game = createGame();

    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.mission = Mission.GUARD;
    hind.missionTimer = 0;
    hind.aircraftState = 'landed';
    hind.flightAltitude = 0;
    game.entities.push(hind);
    game.entityById.set(hind.id, hind);

    const hpad = makeHPAD(House.USSR, 10, 10);
    hpad.hpadHelicopterId = hind.id;
    hpad.missionTimer = 999;
    game.structures.push(hpad);

    const seed = 0x2468ace0;
    const expectedJitter = new RandomClass(seed).nextInRange(0, 2);
    const savedSeed = ScenarioRandom.seed;
    try {
      ScenarioRandom.seed = seed;

      runStructureLogic(game);

      expect(hind.mission).toBe(Mission.GUARD);
      expect(hind.missionTimer).toBe(42 + expectedJitter - 1);
    } finally {
      ScenarioRandom.seed = savedSeed;
    }
  });

  it('player-owned docked helicopters skip AI guard scan and RNG jitter', () => {
    // C++ aircraft.cpp:3737: if (House->IsHuman) return Normal_Delay().
    // This happens before TarCom validation, Find_Juicy_Target, and the
    // FootClass::Mission_Guard Random_Pick(0,2) delay jitter.
    const game = createGame();
    game.playerHouse = House.Greece;

    const heli = entityAtCell(UnitType.V_HELI, House.Greece, 10, 10);
    heli.mission = Mission.GUARD;
    heli.missionTimer = 0;
    heli.aircraftState = 'landed';
    heli.flightAltitude = 0;
    game.entities.push(heli);
    game.entityById.set(heli.id, heli);

    const hpad = makeHPAD(House.Greece, 10, 10);
    hpad.hpadHelicopterId = heli.id;
    hpad.dockedAircraft = heli.id;
    hpad.missionTimer = 999;
    game.structures.push(hpad);

    const harvester = entityAtCell(UnitType.V_HARV, House.USSR, 13, 10);
    game.entities.push(harvester);
    game.entityById.set(harvester.id, harvester);

    const savedSeed = ScenarioRandom.seed;
    const savedCalls = ScenarioRandom.callCount;
    try {
      ScenarioRandom.seed = 0x13579bdf;
      ScenarioRandom.callCount = 0;

      runStructureLogic(game);

      expect(ScenarioRandom.callCount).toBe(0);
      expect(ScenarioRandom.seed).toBe(0x13579bdf);
      expect(heli.target).toBeNull();
      expect(heli.mission).toBe(Mission.GUARD);
      expect(heli.missionTimer).toBe(41);
    } finally {
      ScenarioRandom.seed = savedSeed;
      ScenarioRandom.callCount = savedCalls;
    }
  });

  it('clears juicy target outside Threat_Range via Target_Something_Nearby validation', () => {
    // C++ techno.cpp:5261-5266 clears out-of-weapon-range TarCom, then
    // Greatest_Threat(THREAT_RANGE) can only reacquire it if it is inside
    // TechnoClass::Threat_Range(0).
    const game = createGame();

    const hpad = makeHPAD(House.USSR, 10, 10);
    game.structures.push(hpad);

    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.mission = Mission.GUARD;
    hind.aircraftState = 'landed';
    game.entities.push(hind);
    game.entityById.set(hind.id, hind);

    // Enemy harvester at (45,10) — outside base zone and outside HIND GuardRange.
    const harvester = entityAtCell(UnitType.V_HARV, House.Greece, 45, 10);
    game.entities.push(harvester);
    game.entityById.set(harvester.id, harvester);

    const juicyFound = callHeliGuardScan(game, hind);

    // Find_Juicy_Target found the harvester, but Target_Something_Nearby
    // cleared it and Greatest_Threat could not reacquire it outside GuardRange.
    expect(juicyFound).toBe(true);
    expect(hind.target).toBeNull();
  });

  it('penalizes AA units in Find_Juicy_Target distance scoring', () => {
    // C++ house.cpp:6913: if (unit->Anti_Air()) val *= 2 → AA units score worse
    const game = createGame();

    const hpad = makeHPAD(House.USSR, 10, 10);
    game.structures.push(hpad);

    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.mission = Mission.GUARD;
    hind.aircraftState = 'landed';
    game.entities.push(hind);
    game.entityById.set(hind.id, hind);

    // Mammoth tank (AA secondary) at (12,10) — 2 cells, doubled to 4 via AA penalty
    const mammoth = entityAtCell(UnitType.V_4TNK, House.Greece, 12, 10);
    game.entities.push(mammoth);
    game.entityById.set(mammoth.id, mammoth);

    // Medium tank at (13,10) — 3 cells, no penalty
    const tank = entityAtCell(UnitType.V_2TNK, House.Greece, 13, 10);
    game.entities.push(tank);
    game.entityById.set(tank.id, tank);

    callHeliGuardScan(game, hind);

    expect(mammoth.weapon?.isAntiAir || mammoth.weapon2?.isAntiAir).toBe(true);
    expect(tank.weapon?.isAntiAir || tank.weapon2?.isAntiAir).toBeFalsy();

    // Both are in scan range. Find_Juicy_Target should pick the medium tank (3 < 4 after AA penalty).
    // Target_Something_Nearby then validates and keeps the existing in-range TarCom.
    expect(hind.target).toBe(tank);
  });
});

describe('HPAD helicopter guard — Target_Something_Nearby validation (techno.cpp:5260)', () => {

  it('validates existing target if in weapon range', () => {
    // C++ techno.cpp:5260-5266: existing TarCom in range → kept
    const game = createGame();

    const hpad = makeHPAD(House.USSR, 10, 10);
    game.structures.push(hpad);

    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.mission = Mission.GUARD;
    hind.aircraftState = 'landed';
    game.entities.push(hind);
    game.entityById.set(hind.id, hind);

    // Pre-set a target that IS in weapon range
    const tank = entityAtCell(UnitType.V_2TNK, House.Greece, 13, 10);
    game.entities.push(tank);
    game.entityById.set(tank.id, tank);
    hind.target = tank;

    callHeliGuardScan(game, hind);

    // Target should be validated and kept (in range)
    expect(hind.target).not.toBeNull();
  });

  it('clears existing target if outside Threat_Range', () => {
    // C++ techno.cpp:5264: Assign_Target(TARGET_NONE) when out of weapon range.
    // With GuardRange, the follow-up Greatest_Threat scan can reacquire targets
    // inside Threat_Range(0), so this target must be outside GuardRange too.
    const game = createGame();

    const hpad = makeHPAD(House.USSR, 10, 10);
    game.structures.push(hpad);

    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.mission = Mission.GUARD;
    hind.aircraftState = 'landed';
    game.entities.push(hind);
    game.entityById.set(hind.id, hind);

    // Pre-set a target that is outside HIND GuardRange.
    const farTank = entityAtCell(UnitType.V_2TNK, House.Greece, 45, 10);
    game.entities.push(farTank);
    game.entityById.set(farTank.id, farTank);
    hind.target = farTank;

    callHeliGuardScan(game, hind);

    // Target should be cleared (out of range) and no replacement found nearby
    expect(hind.target).toBeNull();
  });
});
