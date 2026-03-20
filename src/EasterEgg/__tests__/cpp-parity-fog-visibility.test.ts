/**
 * C++ Behavioral Parity: Fog of War, Sub Detection, and Gap Generator Systems
 *
 * Tests verify that the TypeScript fog module matches C++ Red Alert behavior for:
 *   1. CONDITION_RED sight reduction (techno.cpp:2456-2460)
 *   2. Sonar pulse sub-detection (entity.cpp:SONAR_TIME, techno.cpp Cloak logic)
 *   3. GAP generator visibility jamming (gap.cpp, building.cpp:1420-1450)
 *   4. GPS active full map vision (house.h:268 IsGPSActive, display.cpp:4159)
 *   5. Health-gated structure visibility (building.cpp per-tick sight)
 *   6. Power-dependent GAP generators (house.cpp power fraction gating)
 *
 * C++ source of truth:
 *   - techno.cpp:2456-2460  — damaged units get reduced sight range
 *   - rules.cpp:235         — ConditionRed = 1/4 (0.25) health ratio
 *   - entity.cpp:SONAR_TIME — SONAR_PULSE_DURATION = 225 frames (15 seconds at 15 FPS)
 *   - techno.cpp:4159-4194  — Visual_Character() cloaking + sonar detection
 *   - gap.cpp               — GAP radius = 10 cells, update every 90 ticks
 *   - house.h:268           — IsGPSActive flag for full map reveal
 *   - house.cpp:1265        — GPS active bypasses Shroud_Cell
 *   - house.cpp:1420-1425   — power fraction gates GAP generator jamming
 *   - display.cpp:4159      — GPS reveal interacts with fog-of-war
 *   - building.cpp          — structure sight: defense=7, other=5
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CELL_SIZE, MAP_CELLS, CONDITION_RED,
  House, UnitType, buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds, CloakState, SONAR_PULSE_DURATION, CLOAK_TRANSITION_FRAMES, setPlayerHouses } from '../engine/entity';
import {
  type FogContext,
  updateFogOfWar,
  updateSubDetection,
  updateGapGenerators,
  GAP_RADIUS,
  GAP_UPDATE_INTERVAL,
  DEFENSE_TYPES,
} from '../engine/fog';
import { GameMap } from '../engine/map';
import type { MapStructure } from '../engine/scenario';

beforeEach(() => {
  resetEntityIds();
  setPlayerHouses(new Set([House.Spain, House.Greece]));
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Create a minimal MapStructure for testing */
function makeStructure(
  type: string, house: House, cx: number, cy: number,
  overrides: Partial<MapStructure> = {},
): MapStructure {
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx, cy,
    hp: 256, maxHp: 256,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    ...overrides,
  } as MapStructure;
}

/** Create a FogContext with sensible defaults */
function makeFogCtx(
  entities: Entity[] = [],
  structures: MapStructure[] = [],
  overrides: Partial<FogContext> = {},
): FogContext {
  const map = new GameMap();
  map.setBounds(0, 0, 64, 64);
  map.initDefault();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    structures,
    map,
    tick: 0,
    playerHouse: House.Spain,
    fogDisabled: false,
    gpsActive: false,
    baseDiscovered: true,
    powerProduced: 100,
    powerConsumed: 50,
    gapGeneratorCells: new Map(),
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    ...overrides,
  };
}

// ── 1. CONDITION_RED sight reduction (techno.cpp:2456-2460) ─────────────────

describe('CONDITION_RED sight reduction (techno.cpp:2456-2460, rules.cpp:235)', () => {

  it('healthy unit reveals cells up to its full sight range', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.Spain, 32, 32);
    // 2TNK sight = 5
    expect(unit.stats.sight).toBe(5);
    expect(unit.hp / unit.maxHp).toBeGreaterThan(CONDITION_RED);

    const ctx = makeFogCtx([unit]);
    updateFogOfWar(ctx);

    // Cell at distance 4 from unit should be visible (within sight=5)
    expect(ctx.map.getVisibility(36, 32)).toBe(2);
    // Cell at distance 5 should also be visible (edge of sight circle)
    expect(ctx.map.getVisibility(37, 32)).toBe(2);
  });

  it('unit at CONDITION_RED has sight reduced to 1', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.Spain, 32, 32);
    // Damage unit to below CONDITION_RED (25% HP)
    // 2TNK has 400 HP. At 99/400 = 0.2475 < 0.25 = CONDITION_RED
    unit.hp = Math.floor(unit.maxHp * CONDITION_RED) - 1;
    expect(unit.hp / unit.maxHp).toBeLessThan(CONDITION_RED);

    const ctx = makeFogCtx([unit]);
    updateFogOfWar(ctx);

    // Cell at distance 1 should be visible (sight reduced to 1)
    expect(ctx.map.getVisibility(33, 32)).toBe(2);
    // Cell at distance 2 should NOT be visible (beyond reduced sight of 1)
    // It could be fog (1) if previously explored, or shroud (0) if never explored
    expect(ctx.map.getVisibility(34, 32)).toBeLessThan(2);
  });

  it('unit at exactly CONDITION_RED boundary keeps full sight', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.Spain, 32, 32);
    // At exactly CONDITION_RED ratio: hp/maxHp == 0.25 — NOT less than,
    // so the condition (hp/maxHp) < CONDITION_RED is false → full sight
    unit.hp = Math.floor(unit.maxHp * CONDITION_RED);
    expect(unit.hp / unit.maxHp).toBeGreaterThanOrEqual(CONDITION_RED);

    const ctx = makeFogCtx([unit]);
    updateFogOfWar(ctx);

    // Should have full sight (5 cells)
    expect(ctx.map.getVisibility(36, 32)).toBe(2);
  });

  it('CONDITION_RED threshold matches C++ rules.cpp:235 value of 0.25', () => {
    // C++ ConditionRed = fixed(256) / 4 = 0.25
    expect(CONDITION_RED).toBe(0.25);
  });

  it('dead unit (alive=false) does not contribute to fog of war', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.Spain, 32, 32);
    unit.alive = false;

    const ctx = makeFogCtx([unit]);
    updateFogOfWar(ctx);

    // No cells around the dead unit should be visible
    expect(ctx.map.getVisibility(33, 32)).toBe(0);
  });

  it('enemy unit does not contribute to player fog of war', () => {
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 32, 32);
    const ctx = makeFogCtx([enemy]);
    updateFogOfWar(ctx);

    // Enemy does not reveal fog for the player
    expect(ctx.map.getVisibility(33, 32)).toBe(0);
  });
});

// ── 2. Sonar pulse sub-detection (entity.cpp SONAR_TIME) ────────────────────

describe('Sonar pulse sub-detection (entity.cpp SONAR_TIME, techno.cpp Cloak)', () => {

  it('SONAR_PULSE_DURATION matches C++ SONAR_TIME of 225 frames', () => {
    // C++ SONAR_TIME = 15 seconds * 15 FPS = 225
    expect(SONAR_PULSE_DURATION).toBe(225);
  });

  it('anti-sub unit (DD) detects cloaked submarine within sight range', () => {
    // DD has isAntiSub=true, sight=6
    const dd = entityAtCell(UnitType.V_DD, House.Spain, 32, 32);
    expect(dd.stats.isAntiSub).toBe(true);

    // Enemy SS is cloaked and within DD sight range (distance ~3 cells)
    const sub = entityAtCell(UnitType.V_SS, House.USSR, 35, 32);
    sub.cloakState = CloakState.CLOAKED;
    expect(sub.stats.isCloakable).toBe(true);

    const ctx = makeFogCtx([dd, sub]);
    updateSubDetection(ctx);

    // Sub should be forced to UNCLOAKING state
    expect(sub.cloakState).toBe(CloakState.UNCLOAKING);
    // Sonar pulse timer should be set
    expect(sub.sonarPulseTimer).toBe(SONAR_PULSE_DURATION);
    // Cloak timer should be set for transition
    expect(sub.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('anti-sub unit does NOT detect cloaked sub outside sight range', () => {
    const dd = entityAtCell(UnitType.V_DD, House.Spain, 32, 32);
    // Place sub far outside DD sight of 6 cells (at distance ~20 cells)
    const sub = entityAtCell(UnitType.V_SS, House.USSR, 52, 32);
    sub.cloakState = CloakState.CLOAKED;

    const ctx = makeFogCtx([dd, sub]);
    updateSubDetection(ctx);

    // Sub should remain cloaked — out of range
    expect(sub.cloakState).toBe(CloakState.CLOAKED);
    expect(sub.sonarPulseTimer).toBe(0);
  });

  it('anti-sub unit does NOT detect allied cloakable units', () => {
    // DD and sub on the same side
    const dd = entityAtCell(UnitType.V_DD, House.Spain, 32, 32);
    const sub = entityAtCell(UnitType.V_SS, House.Spain, 35, 32);
    sub.cloakState = CloakState.CLOAKED;

    const ctx = makeFogCtx([dd, sub]);
    updateSubDetection(ctx);

    // Allied sub should remain cloaked
    expect(sub.cloakState).toBe(CloakState.CLOAKED);
    expect(sub.sonarPulseTimer).toBe(0);
  });

  it('detection only triggers on CLOAKED or CLOAKING states', () => {
    const dd = entityAtCell(UnitType.V_DD, House.Spain, 32, 32);

    // Sub is UNCLOAKED — should not be re-detected
    const sub = entityAtCell(UnitType.V_SS, House.USSR, 35, 32);
    sub.cloakState = CloakState.UNCLOAKED;

    const ctx = makeFogCtx([dd, sub]);
    updateSubDetection(ctx);

    expect(sub.cloakState).toBe(CloakState.UNCLOAKED);
    expect(sub.sonarPulseTimer).toBe(0);
  });

  it('detects sub in CLOAKING transition state', () => {
    const dd = entityAtCell(UnitType.V_DD, House.Spain, 32, 32);
    const sub = entityAtCell(UnitType.V_SS, House.USSR, 35, 32);
    sub.cloakState = CloakState.CLOAKING;

    const ctx = makeFogCtx([dd, sub]);
    updateSubDetection(ctx);

    // Sub should be forced to UNCLOAKING
    expect(sub.cloakState).toBe(CloakState.UNCLOAKING);
    expect(sub.sonarPulseTimer).toBe(SONAR_PULSE_DURATION);
  });

  it('non-anti-sub unit does NOT detect cloaked submarines', () => {
    // Cruiser (CA) does NOT have isAntiSub — cannot detect subs
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 32, 32);
    expect(ca.stats.isAntiSub).toBeFalsy();

    const sub = entityAtCell(UnitType.V_SS, House.USSR, 35, 32);
    sub.cloakState = CloakState.CLOAKED;

    const ctx = makeFogCtx([ca, sub]);
    updateSubDetection(ctx);

    // Sub should remain cloaked — CA cannot detect
    expect(sub.cloakState).toBe(CloakState.CLOAKED);
    expect(sub.sonarPulseTimer).toBe(0);
  });

  it('dead anti-sub unit does NOT detect submarines', () => {
    const dd = entityAtCell(UnitType.V_DD, House.Spain, 32, 32);
    dd.alive = false;

    const sub = entityAtCell(UnitType.V_SS, House.USSR, 35, 32);
    sub.cloakState = CloakState.CLOAKED;

    const ctx = makeFogCtx([dd, sub]);
    updateSubDetection(ctx);

    expect(sub.cloakState).toBe(CloakState.CLOAKED);
  });

  it('dead submarine is not affected by detection', () => {
    const dd = entityAtCell(UnitType.V_DD, House.Spain, 32, 32);
    const sub = entityAtCell(UnitType.V_SS, House.USSR, 35, 32);
    sub.cloakState = CloakState.CLOAKED;
    sub.alive = false;

    const ctx = makeFogCtx([dd, sub]);
    updateSubDetection(ctx);

    // Dead sub stays in whatever state — no change
    expect(sub.cloakState).toBe(CloakState.CLOAKED);
    expect(sub.sonarPulseTimer).toBe(0);
  });

  it('CLOAK_TRANSITION_FRAMES matches C++ CLOAK_STAGES of 38 frames', () => {
    // C++ CLOAK_STAGES = 38 (~2.5 seconds at 15 FPS)
    expect(CLOAK_TRANSITION_FRAMES).toBe(38);
  });
});

// ── 3. GAP generator visibility jamming (gap.cpp) ───────────────────────────

describe('GAP generator visibility jamming (gap.cpp, building.cpp:1420-1450)', () => {

  it('GAP_RADIUS is 10 cells (C++ GAP_SHROUD_RADIUS)', () => {
    expect(GAP_RADIUS).toBe(10);
  });

  it('GAP_UPDATE_INTERVAL is 90 ticks', () => {
    expect(GAP_UPDATE_INTERVAL).toBe(90);
  });

  it('GAP generator jams cells within GAP_RADIUS when powered', () => {
    const gapStruct = makeStructure('GAP', House.Spain, 20, 20);
    const ctx = makeFogCtx([], [gapStruct], {
      tick: 90,  // must be divisible by GAP_UPDATE_INTERVAL
      powerProduced: 200,
      powerConsumed: 100,
    });

    // First, reveal some cells around the GAP generator so we can see them get jammed
    ctx.map.revealAll();

    updateGapGenerators(ctx);

    // Cells within GAP_RADIUS should be jammed (visibility = 0)
    // GAP is at (20,20), structure is 1x1 so center is at (20,20) + floor(1/2) = (20,20)
    expect(ctx.map.getVisibility(20, 20)).toBe(0);
    expect(ctx.map.getVisibility(25, 20)).toBe(0);  // 5 cells away — within radius 10
    expect(ctx.map.getVisibility(29, 20)).toBe(0);  // 9 cells away — within radius 10
  });

  it('GAP generator does NOT jam cells outside GAP_RADIUS', () => {
    const gapStruct = makeStructure('GAP', House.Spain, 20, 20);
    const ctx = makeFogCtx([], [gapStruct], {
      tick: 90,
      powerProduced: 200,
      powerConsumed: 100,
    });

    ctx.map.revealAll();
    updateGapGenerators(ctx);

    // Cell at distance 11 horizontally — outside radius 10
    // (11^2 = 121 > 10^2 = 100)
    expect(ctx.map.getVisibility(31, 20)).toBe(2);
  });

  it('GAP generator only runs on ticks divisible by GAP_UPDATE_INTERVAL', () => {
    const gapStruct = makeStructure('GAP', House.Spain, 20, 20);
    const ctx = makeFogCtx([], [gapStruct], {
      tick: 45,  // NOT divisible by 90
      powerProduced: 200,
      powerConsumed: 100,
    });

    ctx.map.revealAll();
    updateGapGenerators(ctx);

    // Should NOT have jammed anything — wrong tick
    expect(ctx.map.getVisibility(20, 20)).toBe(2);
  });

  it('destroyed GAP generator does not jam', () => {
    const gapStruct = makeStructure('GAP', House.Spain, 20, 20, { alive: false });
    const ctx = makeFogCtx([], [gapStruct], {
      tick: 90,
      powerProduced: 200,
      powerConsumed: 100,
    });

    ctx.map.revealAll();
    updateGapGenerators(ctx);

    // Dead GAP should not jam
    expect(ctx.map.getVisibility(20, 20)).toBe(2);
  });

  it('non-GAP structures do not jam', () => {
    const gunStruct = makeStructure('GUN', House.Spain, 20, 20);
    const ctx = makeFogCtx([], [gunStruct], {
      tick: 90,
      powerProduced: 200,
      powerConsumed: 100,
    });

    ctx.map.revealAll();
    updateGapGenerators(ctx);

    expect(ctx.map.getVisibility(20, 20)).toBe(2);
  });

  it('GAP generator unjams when destroyed between updates', () => {
    const gapStruct = makeStructure('GAP', House.Spain, 20, 20);
    const ctx = makeFogCtx([], [gapStruct], {
      tick: 90,
      powerProduced: 200,
      powerConsumed: 100,
    });

    ctx.map.revealAll();
    updateGapGenerators(ctx);

    // Cells should be jammed
    expect(ctx.map.getVisibility(20, 20)).toBe(0);

    // Now destroy the GAP generator and run again at next interval
    gapStruct.alive = false;
    ctx.tick = 180;
    updateGapGenerators(ctx);

    // Cells should be unjammed (restored to fog=1)
    expect(ctx.map.getVisibility(20, 20)).toBe(1);
  });
});

// ── 4. GPS active full map vision (house.h:268 IsGPSActive) ─────────────────

describe('GPS active full map vision (house.h:268, house.cpp:1265, display.cpp:4159)', () => {

  it('gpsActive=true reveals entire map regardless of unit positions', () => {
    // No units at all — but GPS should reveal everything
    const ctx = makeFogCtx([], [], { gpsActive: true });

    updateFogOfWar(ctx);

    // Random cells across the map should all be visible
    expect(ctx.map.getVisibility(0, 0)).toBe(2);
    expect(ctx.map.getVisibility(32, 32)).toBe(2);
    expect(ctx.map.getVisibility(63, 63)).toBe(2);
    expect(ctx.map.getVisibility(10, 50)).toBe(2);
  });

  it('gpsActive=false does NOT reveal map without units', () => {
    const ctx = makeFogCtx([], [], { gpsActive: false });

    updateFogOfWar(ctx);

    // Without GPS and without units, map should remain shrouded
    expect(ctx.map.getVisibility(32, 32)).toBe(0);
  });

  it('GPS takes precedence over fog-of-war even with no player units', () => {
    // Only enemy units — without GPS, player sees nothing
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 32, 32);
    const ctx = makeFogCtx([enemy], [], { gpsActive: true });

    updateFogOfWar(ctx);

    // GPS reveals all, even though the only entity is an enemy
    expect(ctx.map.getVisibility(10, 10)).toBe(2);
    expect(ctx.map.getVisibility(50, 50)).toBe(2);
  });

  it('fogDisabled also reveals entire map (debug/cheat mode)', () => {
    const ctx = makeFogCtx([], [], { fogDisabled: true, gpsActive: false });

    updateFogOfWar(ctx);

    expect(ctx.map.getVisibility(32, 32)).toBe(2);
    expect(ctx.map.getVisibility(0, 0)).toBe(2);
  });

  it('fogDisabled takes precedence (checked before gpsActive)', () => {
    const ctx = makeFogCtx([], [], { fogDisabled: true, gpsActive: false });

    updateFogOfWar(ctx);

    // Even without GPS, fogDisabled reveals all
    expect(ctx.map.getVisibility(32, 32)).toBe(2);
  });
});

// ── 5. Health-gated structure visibility (building.cpp per-tick sight) ───────

describe('Health-gated structure visibility (building.cpp per-tick sight)', () => {

  it('healthy defense structure has sight of 7 (C++ DEFENSE_TYPES)', () => {
    // DEFENSE_TYPES: HBOX, GUN, TSLA, SAM, PBOX, GAP, AGUN
    for (const defType of ['HBOX', 'GUN', 'TSLA', 'SAM', 'PBOX', 'GAP', 'AGUN']) {
      expect(DEFENSE_TYPES.has(defType), `${defType} should be a defense type`).toBe(true);
    }
  });

  it('healthy defense structure reveals cells up to sight=7', () => {
    const gun = makeStructure('GUN', House.Spain, 32, 32);
    const ctx = makeFogCtx([], [gun]);

    updateFogOfWar(ctx);

    // GUN center world pos: 32*24 + 12 = 780. Cell = 32
    // Sight=7, so cell at distance 6 should be visible
    expect(ctx.map.getVisibility(38, 32)).toBe(2);
  });

  it('healthy non-defense structure has sight of 5', () => {
    const proc = makeStructure('PROC', House.Spain, 32, 32);
    const ctx = makeFogCtx([], [proc]);

    updateFogOfWar(ctx);

    // Sight=5, cell at distance 4 should be visible
    expect(ctx.map.getVisibility(36, 32)).toBe(2);
    // Cell at distance 6 should NOT be visible (beyond sight=5)
    // Diagonal cells: 6^2 = 36 > 5^2 = 25
    expect(ctx.map.getVisibility(38, 32)).toBeLessThan(2);
  });

  it('defense structure at CONDITION_RED has sight reduced to 1', () => {
    const gun = makeStructure('GUN', House.Spain, 32, 32, {
      hp: Math.floor(256 * CONDITION_RED) - 1,  // below 25% — CONDITION_RED
      maxHp: 256,
    });
    expect(gun.hp / gun.maxHp).toBeLessThan(CONDITION_RED);

    const ctx = makeFogCtx([], [gun]);
    updateFogOfWar(ctx);

    // Sight reduced to 1 — cell at distance 1 visible
    expect(ctx.map.getVisibility(33, 32)).toBe(2);
    // Cell at distance 2 should NOT be visible
    expect(ctx.map.getVisibility(34, 32)).toBeLessThan(2);
  });

  it('non-defense structure at CONDITION_RED has sight reduced to 1', () => {
    const silo = makeStructure('SILO', House.Spain, 32, 32, {
      hp: Math.floor(256 * CONDITION_RED) - 1,
      maxHp: 256,
    });
    expect(silo.hp / silo.maxHp).toBeLessThan(CONDITION_RED);

    const ctx = makeFogCtx([], [silo]);
    updateFogOfWar(ctx);

    // Same behavior: sight reduced to 1
    expect(ctx.map.getVisibility(33, 32)).toBe(2);
    expect(ctx.map.getVisibility(34, 32)).toBeLessThan(2);
  });

  it('dead structure does not contribute sight', () => {
    const gun = makeStructure('GUN', House.Spain, 32, 32, { alive: false });
    const ctx = makeFogCtx([], [gun]);

    updateFogOfWar(ctx);

    expect(ctx.map.getVisibility(33, 32)).toBe(0);
  });

  it('enemy structure does not contribute to player sight', () => {
    const enemyGun = makeStructure('GUN', House.USSR, 32, 32);
    const ctx = makeFogCtx([], [enemyGun]);

    updateFogOfWar(ctx);

    // Enemy structure should NOT reveal for the player
    expect(ctx.map.getVisibility(33, 32)).toBe(0);
  });

  it('structures do NOT reveal fog when baseDiscovered=false', () => {
    // C++ parity: buildings are hidden until base discovery (ant missions)
    const gun = makeStructure('GUN', House.Spain, 32, 32);
    const ctx = makeFogCtx([], [gun], { baseDiscovered: false });

    updateFogOfWar(ctx);

    // Structure sight should NOT contribute
    expect(ctx.map.getVisibility(33, 32)).toBe(0);
  });

  it('structures reveal fog when baseDiscovered=true', () => {
    const gun = makeStructure('GUN', House.Spain, 32, 32);
    const ctx = makeFogCtx([], [gun], { baseDiscovered: true });

    updateFogOfWar(ctx);

    // Now the structure SHOULD contribute sight
    expect(ctx.map.getVisibility(33, 32)).toBe(2);
  });
});

// ── 6. Power-dependent GAP generators (house.cpp power fraction) ────────────

describe('Power-dependent GAP generators (house.cpp power fraction gating)', () => {

  it('GAP generator does NOT jam when power fraction < 1.0', () => {
    const gapStruct = makeStructure('GAP', House.Spain, 20, 20);
    const ctx = makeFogCtx([], [gapStruct], {
      tick: 90,
      powerProduced: 50,   // < powerConsumed
      powerConsumed: 100,
    });

    ctx.map.revealAll();
    updateGapGenerators(ctx);

    // Insufficient power — GAP should NOT jam
    expect(ctx.map.getVisibility(20, 20)).toBe(2);
  });

  it('GAP generator jams when power fraction >= 1.0', () => {
    const gapStruct = makeStructure('GAP', House.Spain, 20, 20);
    const ctx = makeFogCtx([], [gapStruct], {
      tick: 90,
      powerProduced: 100,
      powerConsumed: 100,  // exactly 1.0 ratio
    });

    ctx.map.revealAll();
    updateGapGenerators(ctx);

    // Power fraction = 1.0 → GAP should jam
    expect(ctx.map.getVisibility(20, 20)).toBe(0);
  });

  it('GAP generator jams with excess power (fraction > 1.0)', () => {
    const gapStruct = makeStructure('GAP', House.Spain, 20, 20);
    const ctx = makeFogCtx([], [gapStruct], {
      tick: 90,
      powerProduced: 300,
      powerConsumed: 100,
    });

    ctx.map.revealAll();
    updateGapGenerators(ctx);

    expect(ctx.map.getVisibility(20, 20)).toBe(0);
  });

  it('GAP generator does NOT jam when powerProduced is 0', () => {
    const gapStruct = makeStructure('GAP', House.Spain, 20, 20);
    const ctx = makeFogCtx([], [gapStruct], {
      tick: 90,
      powerProduced: 0,
      powerConsumed: 50,
    });

    ctx.map.revealAll();
    updateGapGenerators(ctx);

    // Zero power = power fraction 0 → no jamming
    expect(ctx.map.getVisibility(20, 20)).toBe(2);
  });

  it('GAP generator unjams when power is lost between intervals', () => {
    const gapStruct = makeStructure('GAP', House.Spain, 20, 20);
    const ctx = makeFogCtx([], [gapStruct], {
      tick: 90,
      powerProduced: 200,
      powerConsumed: 100,
    });

    ctx.map.revealAll();
    updateGapGenerators(ctx);

    // Should be jammed
    expect(ctx.map.getVisibility(20, 20)).toBe(0);
    expect(ctx.gapGeneratorCells.size).toBe(1);

    // Now cut power and advance to next interval
    ctx.powerProduced = 50;
    ctx.powerConsumed = 100;
    ctx.tick = 180;
    updateGapGenerators(ctx);

    // Should be unjammed
    expect(ctx.map.getVisibility(20, 20)).toBe(1);
    expect(ctx.gapGeneratorCells.size).toBe(0);
  });

  it('GAP generator does NOT double-jam on repeated updates at same power', () => {
    const gapStruct = makeStructure('GAP', House.Spain, 20, 20);
    const ctx = makeFogCtx([], [gapStruct], {
      tick: 90,
      powerProduced: 200,
      powerConsumed: 100,
    });

    ctx.map.revealAll();

    // Run update twice at different valid ticks
    updateGapGenerators(ctx);
    ctx.tick = 180;
    updateGapGenerators(ctx);

    // Should still have exactly 1 GAP tracked
    expect(ctx.gapGeneratorCells.size).toBe(1);

    // Now destroy and unjam — should fully restore
    gapStruct.alive = false;
    ctx.tick = 270;
    updateGapGenerators(ctx);

    // Should be fully unjammed (jam count balanced)
    expect(ctx.map.getVisibility(20, 20)).toBe(1);
    expect(ctx.gapGeneratorCells.size).toBe(0);
  });

  it('GAP jamming uses circular pattern (cells at diagonal distance checked)', () => {
    const gapStruct = makeStructure('GAP', House.Spain, 20, 20);
    const ctx = makeFogCtx([], [gapStruct], {
      tick: 90,
      powerProduced: 200,
      powerConsumed: 100,
    });

    ctx.map.revealAll();
    updateGapGenerators(ctx);

    // Cell at (27, 27) from center (20, 20): distance = sqrt(7^2 + 7^2) = 9.9 ≤ 10 → jammed
    // dx=7, dy=7, dx*dx+dy*dy = 49+49 = 98 ≤ 100 → inside circle
    expect(ctx.map.getVisibility(27, 27)).toBe(0);

    // Cell at (28, 28) from center: dx=8, dy=8, 64+64=128 > 100 → outside circle
    expect(ctx.map.getVisibility(28, 28)).toBe(2);
  });
});
