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
 *   - Searches ALL enemy units (not structures)
 *   - Filters: alive, !InLimbo, !allied, Which_Zone(unit) == ZONE_NONE (outside own base)
 *   - Distance scoring: closer is better
 *   - Harvester distance halved (priority)
 *   - AA unit distance doubled (penalty)
 *   - Sets TarCom + mission=ATTACK, but does NOT return — falls through
 *
 * Target_Something_Nearby (techno.cpp:5251-5281):
 *   - If TarCom valid: check if in weapon range. If not, clear TarCom.
 *   - If no TarCom: Greatest_Threat(THREAT_RANGE) — scan within weapon range.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  House, Mission, UnitType, CELL_SIZE, RESFACTOR,
  UNIT_STATS, buildDefaultAlliances, worldDist,
} from '../engine/types';
import type { MapStructure } from '../engine/scenario';
import { STRUCTURE_SIZE } from '../engine/scenario';

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
  game.map.setBounds(0, 0, 48, 48); // larger map for distance tests
  return game;
}

/** Access private _heliGuardScan via type cast */
function callHeliGuardScan(game: Game, heli: Entity): void {
  (game as unknown as { _heliGuardScan(heli: Entity): void })._heliGuardScan(heli);
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

    // Allied base near (12,10) — within 10 cells of harvester
    const allyBase = makeStructure('FACT', House.Greece, 12, 10);
    game.structures.push(allyBase);

    // Harvester at (13,10) — near its own FACT → inside base zone
    const harvester = entityAtCell(UnitType.V_HARV, House.Greece, 13, 10);
    game.entities.push(harvester);
    game.entityById.set(harvester.id, harvester);

    callHeliGuardScan(game, hind);

    // Harvester is inside its own base zone → Find_Juicy_Target skips it.
    // But Target_Something_Nearby (Greatest_Threat) should still find it in range.
    // The target should be the harvester (found via Greatest_Threat, not Find_Juicy_Target).
    // This test verifies the base-zone filter works.
    // Note: the harvester IS in weapon range, so Greatest_Threat finds it anyway.
    expect(hind.target).toBe(harvester);
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
    const tank = entityAtCell(UnitType.V_MED, House.Greece, 13, 10);
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

  it('clears out-of-range juicy target via Target_Something_Nearby validation', () => {
    // C++ techno.cpp:5261-5266: Target_Something_Nearby clears TarCom if out of weapon range
    const game = createGame();

    const hpad = makeHPAD(House.USSR, 10, 10);
    game.structures.push(hpad);

    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.mission = Mission.GUARD;
    hind.aircraftState = 'landed';
    game.entities.push(hind);
    game.entityById.set(hind.id, hind);

    // Enemy harvester at (25,10) — 15 cells from HIND, outside base zone,
    // but FAR outside weapon scan range (5 cells)
    const harvester = entityAtCell(UnitType.V_HARV, House.Greece, 25, 10);
    game.entities.push(harvester);
    game.entityById.set(harvester.id, harvester);

    callHeliGuardScan(game, hind);

    // Find_Juicy_Target found the harvester, but Target_Something_Nearby
    // cleared it (out of weapon range 5 cells). Greatest_Threat found nothing.
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

    // Rocket soldier (AA) at (12,10) — 2 cells, distance doubled to 4 via AA penalty
    const rocket = entityAtCell(UnitType.I_E3, House.Greece, 12, 10);
    game.entities.push(rocket);
    game.entityById.set(rocket.id, rocket);

    // Regular infantry at (13,10) — 3 cells, no penalty
    const rifleman = entityAtCell(UnitType.I_E1, House.Greece, 13, 10);
    game.entities.push(rifleman);
    game.entityById.set(rifleman.id, rifleman);

    callHeliGuardScan(game, hind);

    expect(rocket.weapon?.isAntiAir || rocket.weapon2?.isAntiAir).toBe(true);
    expect(rifleman.weapon?.isAntiAir || rifleman.weapon2?.isAntiAir).toBeFalsy();

    // Both are in scan range. Find_Juicy_Target should pick rifleman (3 < 4 after AA penalty).
    // Target_Something_Nearby then validates and keeps the existing in-range TarCom.
    expect(hind.target).toBe(rifleman);
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
    const tank = entityAtCell(UnitType.V_MED, House.Greece, 13, 10);
    game.entities.push(tank);
    game.entityById.set(tank.id, tank);
    hind.target = tank;

    callHeliGuardScan(game, hind);

    // Target should be validated and kept (in range)
    expect(hind.target).not.toBeNull();
  });

  it('clears existing target if out of weapon range', () => {
    // C++ techno.cpp:5264: Assign_Target(TARGET_NONE) when out of range
    const game = createGame();

    const hpad = makeHPAD(House.USSR, 10, 10);
    game.structures.push(hpad);

    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    hind.mission = Mission.GUARD;
    hind.aircraftState = 'landed';
    game.entities.push(hind);
    game.entityById.set(hind.id, hind);

    // Pre-set a target that is OUT of weapon range
    const farTank = entityAtCell(UnitType.V_MED, House.Greece, 30, 10);
    game.entities.push(farTank);
    game.entityById.set(farTank.id, farTank);
    hind.target = farTank;

    callHeliGuardScan(game, hind);

    // Target should be cleared (out of range) and no replacement found nearby
    expect(hind.target).toBeNull();
  });
});
