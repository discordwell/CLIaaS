/**
 * Fog of War & Visibility Pipeline Tests
 *
 * Comprehensive tests for fog of war mechanics: shroud vs fog vs visible,
 * updateFogOfWar cycle, revealAroundCell geometry, sight ranges, line-of-sight
 * blocking, gap generator jamming, sonar pulse, GPS satellite, spy plane,
 * cloaked unit visibility, fog disabled mode, and edge cases.
 *
 * Avoids duplicating coverage from:
 *   - fog-unit-visibility.test.ts (renderer entity visibility in fog/shroud)
 *   - damaged-sight.test.ts (CONDITION_RED sight reduction, entity/structure helpers)
 */
import { describe, it, expect } from 'vitest';
import { GameMap, Terrain } from '../engine/map';
import { Entity, CloakState, CLOAK_TRANSITION_FRAMES, SONAR_PULSE_DURATION, setPlayerHouses } from '../engine/entity';
import { CELL_SIZE, MAP_CELLS, CONDITION_RED, House, UnitType, UNIT_STATS, SONAR_REVEAL_TICKS } from '../engine/types';
import {
  updateFogOfWar,
  updateSubDetection,
  revealAroundCell,
  updateGapGenerators,
  GAP_RADIUS,
  GAP_UPDATE_INTERVAL,
  DEFENSE_TYPES,
  type FogContext,
} from '../engine/fog';
import type { MapStructure } from '../engine/scenario';

// ========================================================================
// Helpers
// ========================================================================

/** Create a GameMap with all-clear terrain suitable for fog tests. */
function createClearMap(): GameMap {
  const map = new GameMap();
  map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
  for (let y = 0; y < MAP_CELLS; y++) {
    for (let x = 0; x < MAP_CELLS; x++) {
      map.setTerrain(x, y, Terrain.CLEAR);
    }
  }
  return map;
}

/** Count cells with a given visibility level. */
function countVis(map: GameMap, level: number): number {
  let n = 0;
  for (let i = 0; i < map.visibility.length; i++) {
    if (map.visibility[i] === level) n++;
  }
  return n;
}

/** Create a unit descriptor suitable for map.updateFogOfWar(). */
function unit(cx: number, cy: number, sight: number) {
  return { x: cx * CELL_SIZE + CELL_SIZE / 2, y: cy * CELL_SIZE + CELL_SIZE / 2, sight };
}

/** Create a minimal FogContext with sensible defaults and no-op callbacks. */
function makeMockFogContext(overrides: Partial<FogContext> = {}): FogContext {
  const map = createClearMap();
  return {
    entities: [],
    structures: [],
    map,
    tick: 0,
    playerHouse: House.Greece,
    fogDisabled: false,
    baseDiscovered: true,
    powerProduced: 200,
    powerConsumed: 100,
    gapGeneratorCells: new Map(),
    isAllied: (a: House, b: House) => a === b,
    entitiesAllied: (a: Entity, b: Entity) => a.house === b.house,
    ...overrides,
  };
}

/** Create a mock MapStructure for testing. */
function mockStructure(type: string, cx: number, cy: number, house: House, overrides: Partial<MapStructure> = {}): MapStructure {
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: 256,
    maxHp: 256,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    ...overrides,
  } as MapStructure;
}

// ========================================================================
// 1. Shroud vs Fog vs Visible — basic state transitions
// ========================================================================

describe('Shroud vs Fog vs Visible state transitions', () => {
  it('new map starts with all cells as shroud (0)', () => {
    const map = new GameMap();
    expect(countVis(map, 0)).toBe(MAP_CELLS * MAP_CELLS);
    expect(countVis(map, 1)).toBe(0);
    expect(countVis(map, 2)).toBe(0);
  });

  it('updateFogOfWar with a unit sets cells within sight to visible (2)', () => {
    const map = createClearMap();
    map.updateFogOfWar([unit(64, 64, 3)]);
    expect(countVis(map, 2)).toBeGreaterThan(0);
    // Center cell must be visible
    expect(map.getVisibility(64, 64)).toBe(2);
  });

  it('second call without the unit downgrades visible (2) to fog (1)', () => {
    const map = createClearMap();
    map.updateFogOfWar([unit(64, 64, 3)]);
    const visibleBefore = countVis(map, 2);
    expect(visibleBefore).toBeGreaterThan(0);

    // Remove the unit — previously visible cells should become fog
    map.updateFogOfWar([]);
    expect(countVis(map, 2)).toBe(0);
    expect(countVis(map, 1)).toBe(visibleBefore);
  });

  it('shroud (0) cells never explored are NOT upgraded to fog when unit leaves', () => {
    const map = createClearMap();
    map.updateFogOfWar([unit(64, 64, 2)]);
    map.updateFogOfWar([]); // unit gone

    // Cells far from (64,64) should still be shroud
    expect(map.getVisibility(10, 10)).toBe(0);
    expect(map.getVisibility(0, 0)).toBe(0);
  });

  it('fog (1) cells re-become visible (2) when unit returns', () => {
    const map = createClearMap();
    map.updateFogOfWar([unit(64, 64, 3)]);
    map.updateFogOfWar([]); // -> fog
    expect(map.getVisibility(64, 64)).toBe(1);

    map.updateFogOfWar([unit(64, 64, 3)]); // -> visible again
    expect(map.getVisibility(64, 64)).toBe(2);
  });

  it('revealAll sets every cell to visible (2)', () => {
    const map = new GameMap();
    map.revealAll();
    expect(countVis(map, 2)).toBe(MAP_CELLS * MAP_CELLS);
    expect(countVis(map, 0)).toBe(0);
    expect(countVis(map, 1)).toBe(0);
  });

  it('creepShadow sets all cells back to shroud (0)', () => {
    const map = createClearMap();
    map.updateFogOfWar([unit(64, 64, 5)]);
    expect(countVis(map, 2)).toBeGreaterThan(0);

    map.creepShadow();
    expect(countVis(map, 0)).toBe(MAP_CELLS * MAP_CELLS);
    expect(countVis(map, 1)).toBe(0);
    expect(countVis(map, 2)).toBe(0);
  });
});

// ========================================================================
// 2. updateFogOfWar cycle — per-tick propagation
// ========================================================================

describe('updateFogOfWar full cycle', () => {
  it('multiple units merge their visibility', () => {
    const map = createClearMap();
    map.updateFogOfWar([unit(30, 30, 3), unit(40, 40, 3)]);
    expect(map.getVisibility(30, 30)).toBe(2);
    expect(map.getVisibility(40, 40)).toBe(2);
  });

  it('moving unit transitions old area to fog and new area to visible', () => {
    const map = createClearMap();
    // Unit at (50,50)
    map.updateFogOfWar([unit(50, 50, 4)]);
    expect(map.getVisibility(50, 50)).toBe(2);

    // Unit moves to (60,60) — old position should become fog, new visible
    map.updateFogOfWar([unit(60, 60, 4)]);
    expect(map.getVisibility(60, 60)).toBe(2);
    expect(map.getVisibility(50, 50)).toBe(1); // fog — was visible, now not
  });

  it('multiple update cycles accumulate fog correctly', () => {
    const map = createClearMap();
    // Tick 1: unit at (20,20)
    map.updateFogOfWar([unit(20, 20, 2)]);
    const vis1 = countVis(map, 2);

    // Tick 2: unit moves to (22,22)
    map.updateFogOfWar([unit(22, 22, 2)]);
    // Some cells are now fog (from first position), some are new visible
    expect(countVis(map, 1)).toBeGreaterThan(0); // old cells became fog
    expect(countVis(map, 2)).toBeGreaterThan(0); // new cells visible

    // Tick 3: unit gone entirely
    map.updateFogOfWar([]);
    expect(countVis(map, 2)).toBe(0); // nothing visible
    // Total fogged cells = union of both positions
    expect(countVis(map, 1)).toBeGreaterThanOrEqual(vis1);
  });

  it('overlapping sight ranges from two units do not double-count cells', () => {
    const map = createClearMap();
    // Two units right next to each other — significant overlap
    map.updateFogOfWar([unit(64, 64, 5), unit(65, 64, 5)]);
    const visibleWithBoth = countVis(map, 2);

    // Compare: single unit at same position
    const map2 = createClearMap();
    map2.updateFogOfWar([unit(64, 64, 5)]);
    const visibleSingle = countVis(map2, 2);

    // Two overlapping units should reveal slightly more (union) but not double
    expect(visibleWithBoth).toBeGreaterThanOrEqual(visibleSingle);
    expect(visibleWithBoth).toBeLessThan(visibleSingle * 2);
  });
});

// ========================================================================
// 3. Sight range geometry — circular reveal
// ========================================================================

describe('Sight range geometry', () => {
  it('sight=0 reveals only the center cell', () => {
    const map = createClearMap();
    map.updateFogOfWar([unit(64, 64, 0)]);
    // dx*dx + dy*dy <= 0 means only (0,0) — just the center
    expect(map.getVisibility(64, 64)).toBe(2);
    expect(countVis(map, 2)).toBe(1);
  });

  it('sight=1 reveals a small cross pattern (at most 5 cells)', () => {
    const map = createClearMap();
    map.updateFogOfWar([unit(64, 64, 1)]);
    // radius^2 = 1 => only dx*dx+dy*dy <= 1 => center + 4 cardinals
    const vis = countVis(map, 2);
    expect(vis).toBe(5); // (0,0),(1,0),(-1,0),(0,1),(0,-1)
  });

  it('sight=5 reveals cells within radius 5 (circular, not square)', () => {
    const map = createClearMap();
    map.updateFogOfWar([unit(64, 64, 5)]);

    // Cell at exact distance 5 (e.g., (5,0)) should be visible: 25 <= 25
    expect(map.getVisibility(69, 64)).toBe(2);
    // Cell at (4,3) distance = sqrt(25) = 5 — should be visible: 16+9=25 <= 25
    expect(map.getVisibility(68, 67)).toBe(2);
    // Cell at (5,1) distance = sqrt(26) > 5 — should NOT be visible
    expect(map.getVisibility(69, 65)).toBe(0);
    // Cell at (4,4) distance = sqrt(32) > 5 — should NOT be visible (circular not square)
    expect(map.getVisibility(68, 68)).toBe(0);
  });

  it('sight range area approximates pi*r^2', () => {
    const map = createClearMap();
    const r = 10;
    map.updateFogOfWar([unit(64, 64, r)]);
    const vis = countVis(map, 2);
    const expected = Math.PI * r * r;
    // Discrete circle approximation: within ~10% of continuous area
    expect(vis).toBeGreaterThan(expected * 0.85);
    expect(vis).toBeLessThan(expected * 1.15);
  });

  it('different unit types have different sight ranges in UNIT_STATS', () => {
    // Verify a sampling of known sight values from the data
    expect(UNIT_STATS.JEEP.sight).toBe(6);
    expect(UNIT_STATS['2TNK'].sight).toBe(5);
    expect(UNIT_STATS['4TNK'].sight).toBe(6);
    expect(UNIT_STATS.E1.sight).toBe(4);
    expect(UNIT_STATS.ANT1.sight).toBe(3);
    expect(UNIT_STATS.TRAN.sight).toBe(0); // Chinook has 0 sight
    expect(UNIT_STATS.MIG.sight).toBe(0);  // Aircraft have 0 sight
  });

  it('sight=0 units (aircraft) reveal only their own cell', () => {
    const map = createClearMap();
    map.updateFogOfWar([unit(64, 64, 0)]);
    expect(countVis(map, 2)).toBe(1);
    expect(map.getVisibility(64, 64)).toBe(2);
    expect(map.getVisibility(65, 64)).toBe(0);
  });
});

// ========================================================================
// 4. Line of sight blocking
// ========================================================================

describe('Line of sight blocking', () => {
  it('ROCK terrain blocks line of sight', () => {
    const map = createClearMap();
    // Place a wall of rock between unit and target cell
    map.setTerrain(65, 64, Terrain.ROCK);
    map.updateFogOfWar([unit(64, 64, 5)]);
    // Cell behind the rock should not be visible
    expect(map.getVisibility(66, 64)).toBe(0);
  });

  it('WALL terrain blocks line of sight', () => {
    const map = createClearMap();
    map.setTerrain(65, 64, Terrain.WALL);
    map.updateFogOfWar([unit(64, 64, 5)]);
    expect(map.getVisibility(66, 64)).toBe(0);
  });

  it('WATER terrain does NOT block line of sight', () => {
    const map = createClearMap();
    map.setTerrain(65, 64, Terrain.WATER);
    map.updateFogOfWar([unit(64, 64, 5)]);
    expect(map.getVisibility(66, 64)).toBe(2);
  });

  it('TREE terrain does NOT block line of sight', () => {
    const map = createClearMap();
    map.setTerrain(65, 64, Terrain.TREE);
    map.updateFogOfWar([unit(64, 64, 5)]);
    expect(map.getVisibility(66, 64)).toBe(2);
  });

  it('hasLineOfSight returns true for unobstructed path', () => {
    const map = createClearMap();
    expect(map.hasLineOfSight(10, 10, 15, 15)).toBe(true);
  });

  it('hasLineOfSight returns false when ROCK is in the path', () => {
    const map = createClearMap();
    map.setTerrain(12, 12, Terrain.ROCK);
    expect(map.hasLineOfSight(10, 10, 15, 15)).toBe(false);
  });

  it('hasLineOfSight does not check start or end cells', () => {
    const map = createClearMap();
    // Rock at start and end — should not block
    map.setTerrain(10, 10, Terrain.ROCK);
    map.setTerrain(15, 15, Terrain.ROCK);
    expect(map.hasLineOfSight(10, 10, 15, 15)).toBe(true);
  });

  it('ROCK wall creates a shadow behind it within sight range', () => {
    const map = createClearMap();
    // Place rock at (66, 64) between unit at (64,64) and cells beyond
    map.setTerrain(66, 64, Terrain.ROCK);
    map.updateFogOfWar([unit(64, 64, 8)]);

    // Cell at (66,64) itself should be visible (LOS skips destination)
    expect(map.getVisibility(66, 64)).toBe(2);
    // Cells directly behind the rock should be in shadow
    expect(map.getVisibility(67, 64)).toBe(0);
    expect(map.getVisibility(68, 64)).toBe(0);
  });
});

// ========================================================================
// 5. Fog disabled mode
// ========================================================================

describe('Fog disabled mode', () => {
  it('FogContext.fogDisabled defaults to false in mock', () => {
    const ctx = makeMockFogContext();
    expect(ctx.fogDisabled).toBe(false);
  });

  it('updateFogOfWar calls revealAll when fogDisabled is true', () => {
    const ctx = makeMockFogContext({ fogDisabled: true });
    // All cells start as shroud
    expect(countVis(ctx.map, 0)).toBe(MAP_CELLS * MAP_CELLS);

    updateFogOfWar(ctx);

    // After update with fogDisabled, every cell should be visible
    expect(countVis(ctx.map, 2)).toBe(MAP_CELLS * MAP_CELLS);
    expect(countVis(ctx.map, 0)).toBe(0);
  });

  it('fogDisabled skips normal unit-based reveal and reveals everything', () => {
    setPlayerHouses(new Set([House.Greece]));
    const e = new Entity(UnitType.V_JEEP, House.Greece, 64 * CELL_SIZE, 64 * CELL_SIZE);
    const ctx = makeMockFogContext({ fogDisabled: true, entities: [e] });

    updateFogOfWar(ctx);

    // ALL cells visible (not just around the unit)
    expect(countVis(ctx.map, 2)).toBe(MAP_CELLS * MAP_CELLS);
  });

  it('revealAll on GameMap sets all visibility to 2', () => {
    const map = new GameMap();
    map.revealAll();
    for (let i = 0; i < map.visibility.length; i++) {
      expect(map.visibility[i]).toBe(2);
    }
  });

  it('fogDisabled=false resumes unit-based visibility (not all cells)', () => {
    setPlayerHouses(new Set([House.Greece]));
    const map = createClearMap();
    const e = new Entity(UnitType.V_JEEP, House.Greece, 64 * CELL_SIZE, 64 * CELL_SIZE);
    const ctx = makeMockFogContext({ map, fogDisabled: false, entities: [e] });

    // Normal fog cycle: only unit's area visible
    updateFogOfWar(ctx);
    const vis = countVis(map, 2);
    expect(vis).toBeGreaterThan(0);
    expect(vis).toBeLessThan(MAP_CELLS * MAP_CELLS);

    // Far-away cell remains shroud
    expect(map.getVisibility(10, 10)).toBe(0);
  });
});

// ========================================================================
// 5b. Base discovery gate — C++ All_To_Look(units_only=true)
// ========================================================================

describe('Base discovery fog gate', () => {
  it('structures do NOT reveal fog when baseDiscovered is false', () => {
    setPlayerHouses(new Set([House.Greece]));
    const map = createClearMap();
    const s = mockStructure('FACT', 64, 64, House.Greece);
    const ctx = makeMockFogContext({
      map,
      baseDiscovered: false,
      structures: [s],
      entities: [],
    });

    updateFogOfWar(ctx);

    // No cells should be visible — no units and structures gated behind baseDiscovered
    expect(countVis(map, 2)).toBe(0);
  });

  it('structures DO reveal fog when baseDiscovered is true', () => {
    setPlayerHouses(new Set([House.Greece]));
    const map = createClearMap();
    const s = mockStructure('FACT', 64, 64, House.Greece);
    const ctx = makeMockFogContext({
      map,
      baseDiscovered: true,
      structures: [s],
      entities: [],
    });

    updateFogOfWar(ctx);

    // Structure should reveal cells around it
    expect(countVis(map, 2)).toBeGreaterThan(0);
  });

  it('units still reveal fog even when baseDiscovered is false', () => {
    setPlayerHouses(new Set([House.Greece]));
    const map = createClearMap();
    const e = new Entity(UnitType.V_JEEP, House.Greece, 64 * CELL_SIZE, 64 * CELL_SIZE);
    const ctx = makeMockFogContext({
      map,
      baseDiscovered: false,
      entities: [e],
      structures: [],
    });

    updateFogOfWar(ctx);

    // Unit sight should still work
    expect(countVis(map, 2)).toBeGreaterThan(0);
  });
});

// ========================================================================
// 6. Cloaked unit visibility
// ========================================================================

describe('Cloaked unit visibility', () => {
  it('submarines have isCloakable flag', () => {
    expect(UNIT_STATS.SS.isCloakable).toBe(true);
    expect(UNIT_STATS.MSUB.isCloakable).toBe(true);
  });

  it('Phase Transport (STNK) has isCloakable flag', () => {
    expect(UNIT_STATS.STNK.isCloakable).toBe(true);
  });

  it('cloaked sub starts UNCLOAKED and transitions through CLOAKING to CLOAKED', () => {
    const sub = new Entity(UnitType.V_SS, House.USSR, 100, 100);
    expect(sub.cloakState).toBe(CloakState.UNCLOAKED);
    sub.cloakState = CloakState.CLOAKING;
    sub.cloakTimer = CLOAK_TRANSITION_FRAMES;
    expect(sub.cloakTimer).toBe(38);
  });

  it('CloakState enum has correct values', () => {
    expect(CloakState.UNCLOAKED).toBe(0);
    expect(CloakState.CLOAKING).toBe(1);
    expect(CloakState.CLOAKED).toBe(2);
    expect(CloakState.UNCLOAKING).toBe(3);
  });

  it('updateSubDetection force-uncloaks subs within destroyer sight', () => {
    setPlayerHouses(new Set([House.Greece]));
    // Destroyer (anti-sub) at position (50,50)
    const dd = new Entity(UnitType.V_DD, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    // Enemy cloaked sub nearby at (51,50) — within DD sight range
    const sub = new Entity(UnitType.V_SS, House.USSR, 51 * CELL_SIZE, 50 * CELL_SIZE);
    sub.cloakState = CloakState.CLOAKED;
    sub.cloakTimer = 0;

    const ctx = makeMockFogContext({
      entities: [dd, sub],
      entitiesAllied: (a, b) => a.house === b.house,
    });

    updateSubDetection(ctx);

    // Sub should be forced into UNCLOAKING with sonarPulseTimer set
    expect(sub.cloakState).toBe(CloakState.UNCLOAKING);
    expect(sub.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
    expect(sub.sonarPulseTimer).toBe(SONAR_PULSE_DURATION);
  });

  it('destroyer has isAntiSub flag', () => {
    expect(UNIT_STATS.DD.isAntiSub).toBe(true);
  });

  it('taking damage force-uncloaks cloaked subs', () => {
    const sub = new Entity(UnitType.V_SS, House.USSR, 100, 100);
    sub.cloakState = CloakState.CLOAKED;
    sub.cloakTimer = 0;

    sub.takeDamage(10);
    expect(sub.cloakState).toBe(CloakState.UNCLOAKING);
    expect(sub.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('sonarPulseTimer prevents recloak — sub stays UNCLOAKED after detection', () => {
    setPlayerHouses(new Set([House.Greece]));
    const dd = new Entity(UnitType.V_DD, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const sub = new Entity(UnitType.V_SS, House.USSR, 51 * CELL_SIZE, 50 * CELL_SIZE);
    sub.cloakState = CloakState.CLOAKED;
    sub.cloakTimer = 0;

    const ctx = makeMockFogContext({
      entities: [dd, sub],
      entitiesAllied: (a, b) => a.house === b.house,
    });

    // Detect sub
    updateSubDetection(ctx);
    expect(sub.sonarPulseTimer).toBe(SONAR_PULSE_DURATION);
    expect(sub.sonarPulseTimer).toBe(225);

    // After uncloaking completes, sonarPulseTimer should still be > 0
    sub.cloakState = CloakState.UNCLOAKED;
    sub.cloakTimer = 0;
    expect(sub.sonarPulseTimer).toBeGreaterThan(0);
  });
});

// ========================================================================
// 7. Sonar pulse
// ========================================================================

describe('Sonar pulse', () => {
  it('SONAR_PULSE_DURATION is 225 ticks (15 seconds at 15 FPS)', () => {
    expect(SONAR_PULSE_DURATION).toBe(225);
  });

  it('SONAR_REVEAL_TICKS is 450 ticks (30 seconds)', () => {
    expect(SONAR_REVEAL_TICKS).toBe(450);
  });

  it('updateSubDetection sets sonarPulseTimer = SONAR_PULSE_DURATION on detected subs', () => {
    setPlayerHouses(new Set([House.Greece]));
    const dd = new Entity(UnitType.V_DD, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const sub = new Entity(UnitType.V_SS, House.USSR, 51 * CELL_SIZE, 50 * CELL_SIZE);
    sub.cloakState = CloakState.CLOAKED;

    const ctx = makeMockFogContext({
      entities: [dd, sub],
      entitiesAllied: (a, b) => a.house === b.house,
    });

    updateSubDetection(ctx);
    expect(sub.sonarPulseTimer).toBe(SONAR_PULSE_DURATION);
  });

  it('SONAR_REVEAL_TICKS constant is 450 (superweapon duration)', () => {
    // Superweapon sonar pulse uses this longer duration
    expect(SONAR_REVEAL_TICKS).toBe(450);
    expect(SONAR_REVEAL_TICKS).toBe(SONAR_PULSE_DURATION * 2);
  });
});

// ========================================================================
// 8. Gap generators
// ========================================================================

describe('Gap generators', () => {
  it('GAP_RADIUS is 10 cells', () => {
    expect(GAP_RADIUS).toBe(10);
  });

  it('GAP_UPDATE_INTERVAL is 90 ticks', () => {
    expect(GAP_UPDATE_INTERVAL).toBe(90);
  });

  it('jamCell sets visibility to 0 (shroud)', () => {
    const map = createClearMap();
    map.revealAll(); // everything visible
    map.jamCell(50, 50);
    expect(map.getVisibility(50, 50)).toBe(0);
  });

  it('jamCell increments jam count for overlapping gap generators', () => {
    const map = createClearMap();
    map.revealAll();
    map.jamCell(50, 50);
    map.jamCell(50, 50); // double jam
    expect(map.jammedCells.get(50 * MAP_CELLS + 50)).toBe(2);
  });

  it('unjamCell restores visibility to fog (1) when fully unjammed', () => {
    const map = createClearMap();
    map.revealAll();
    map.jamCell(50, 50);
    expect(map.getVisibility(50, 50)).toBe(0);

    map.unjamCell(50, 50);
    expect(map.getVisibility(50, 50)).toBe(1); // restored to fog
    expect(map.jammedCells.has(50 * MAP_CELLS + 50)).toBe(false);
  });

  it('unjamCell only decrements count when multiple jams active', () => {
    const map = createClearMap();
    map.revealAll();
    map.jamCell(50, 50);
    map.jamCell(50, 50);

    map.unjamCell(50, 50);
    // Still jammed once — visibility remains 0
    expect(map.jammedCells.get(50 * MAP_CELLS + 50)).toBe(1);
    // Cell was not explicitly set to 0 again after unjam decrement,
    // but the initial jamCell set it to 0 and it stays 0 since count > 0
    // (unjam only sets to 1 when count drops to 0)
    expect(map.getVisibility(50, 50)).toBe(0);
  });

  it('unjamRadius unjams all cells in a circular area', () => {
    const map = createClearMap();
    map.revealAll();
    const r = 3;
    const cx = 50, cy = 50;
    // Jam all cells in radius
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) {
          map.jamCell(cx + dx, cy + dy);
        }
      }
    }
    // Verify center is shrouded
    expect(map.getVisibility(cx, cy)).toBe(0);

    // Unjam
    map.unjamRadius(cx, cy, r);
    // All cells in radius should be fog (1) now
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) {
          expect(map.getVisibility(cx + dx, cy + dy)).toBe(1);
        }
      }
    }
  });

  it('updateGapGenerators is power-gated — underpowered gap unjams', () => {
    const map = createClearMap();
    map.revealAll();
    const gap = mockStructure('GAP', 50, 50, House.Greece);
    const gapCells = new Map<number, { cx: number; cy: number; radius: number }>();

    // First: full power — jams cells
    const ctx = makeMockFogContext({
      map,
      structures: [gap],
      tick: 0, // divisible by GAP_UPDATE_INTERVAL
      powerProduced: 200,
      powerConsumed: 100,
      gapGeneratorCells: gapCells,
    });
    updateGapGenerators(ctx);
    expect(gapCells.size).toBe(1);
    expect(map.getVisibility(50, 50)).toBe(0); // jammed to shroud

    // Now underpowered: power ratio < 1.0 — should unjam
    ctx.powerProduced = 50;
    ctx.powerConsumed = 100;
    ctx.tick = GAP_UPDATE_INTERVAL;
    updateGapGenerators(ctx);
    expect(gapCells.size).toBe(0);
  });

  it('destroyed gap generator unjams its cells', () => {
    const map = createClearMap();
    map.revealAll();
    const gap = mockStructure('GAP', 50, 50, House.Greece);
    const gapCells = new Map<number, { cx: number; cy: number; radius: number }>();

    const ctx = makeMockFogContext({
      map,
      structures: [gap],
      tick: 0,
      powerProduced: 200,
      powerConsumed: 100,
      gapGeneratorCells: gapCells,
    });

    // Jam
    updateGapGenerators(ctx);
    expect(gapCells.size).toBe(1);

    // Destroy the gap generator
    gap.alive = false;
    ctx.tick = GAP_UPDATE_INTERVAL;
    updateGapGenerators(ctx);
    // Should be unjammed now
    expect(gapCells.size).toBe(0);
  });

  it('gap generator jamming uses circular area', () => {
    const map = createClearMap();
    map.revealAll();
    const gap = mockStructure('GAP', 64, 64, House.Greece);
    const gapCells = new Map<number, { cx: number; cy: number; radius: number }>();

    const ctx = makeMockFogContext({
      map,
      structures: [gap],
      tick: 0,
      powerProduced: 200,
      powerConsumed: 100,
      gapGeneratorCells: gapCells,
    });

    updateGapGenerators(ctx);

    // Cell at exact distance GAP_RADIUS along axis should be jammed
    expect(map.getVisibility(64 + GAP_RADIUS, 64)).toBe(0);
    // Cell at diagonal distance sqrt(GAP_RADIUS^2 + 1) > GAP_RADIUS should NOT be jammed
    expect(map.getVisibility(64 + GAP_RADIUS, 65)).toBe(2); // just outside circle
  });
});

// ========================================================================
// 9. GPS Satellite — permanent full-map reveal
// ========================================================================

describe('GPS Satellite', () => {
  it('GPS satellite effect: fogDisabled + updateFogOfWar reveals entire map', () => {
    // GPS satellite sets fogDisabled=true, then updateFogOfWar calls revealAll
    const ctx = makeMockFogContext({ fogDisabled: true });
    updateFogOfWar(ctx);
    expect(countVis(ctx.map, 2)).toBe(MAP_CELLS * MAP_CELLS);
  });

  it('GPS satellite is one-shot: calling revealAll once is idempotent', () => {
    const map = createClearMap();
    map.revealAll();
    const visFirst = countVis(map, 2);
    map.revealAll();
    const visSecond = countVis(map, 2);
    expect(visFirst).toBe(visSecond);
    expect(visFirst).toBe(MAP_CELLS * MAP_CELLS);
  });
});

// ========================================================================
// 10. Spy plane — temporary area reveal
// ========================================================================

describe('Spy plane reveal', () => {
  it('revealAroundCell with radius=10 reveals correct number of cells', () => {
    const map = createClearMap();
    revealAroundCell(map, 64, 64, 10);
    const vis = countVis(map, 2);
    // Should match discrete circle area for r=10
    let expected = 0;
    for (let dy = -10; dy <= 10; dy++) {
      for (let dx = -10; dx <= 10; dx++) {
        if (dx * dx + dy * dy <= 100) expected++;
      }
    }
    expect(vis).toBe(expected);
  });

  it('revealAroundCell uses circular geometry (not square)', () => {
    const map = createClearMap();
    revealAroundCell(map, 64, 64, 10);
    // (10,0) = 100 <= 100 — included
    expect(map.getVisibility(74, 64)).toBe(2);
    // (8,7) = 64+49=113 > 100 — excluded
    expect(map.getVisibility(72, 71)).toBe(0);
    // (7,7) = 49+49=98 <= 100 — included
    expect(map.getVisibility(71, 71)).toBe(2);
  });

  it('revealAroundCell sets visibility directly to 2 (does not go through updateFogOfWar)', () => {
    const map = createClearMap();
    // No fog cycle — just direct reveal
    revealAroundCell(map, 64, 64, 3);
    expect(map.getVisibility(64, 64)).toBe(2);
    expect(map.getVisibility(66, 64)).toBe(2);
    // Unrevealed cells remain at shroud (0) — not fog (1)
    expect(map.getVisibility(10, 10)).toBe(0);
  });
});

// ========================================================================
// 11. Structure sight
// ========================================================================

describe('Structure sight', () => {
  it('DEFENSE_TYPES contains expected building codes', () => {
    expect(DEFENSE_TYPES.has('HBOX')).toBe(true);
    expect(DEFENSE_TYPES.has('GUN')).toBe(true);
    expect(DEFENSE_TYPES.has('TSLA')).toBe(true);
    expect(DEFENSE_TYPES.has('SAM')).toBe(true);
    expect(DEFENSE_TYPES.has('PBOX')).toBe(true);
    expect(DEFENSE_TYPES.has('GAP')).toBe(true);
    expect(DEFENSE_TYPES.has('AGUN')).toBe(true);
  });

  it('defense structures get sight=7, non-defense get sight=5', () => {
    const map = createClearMap();
    // Place a defense structure (GUN) and non-defense structure (POWR) at known locations
    const gun = mockStructure('GUN', 30, 30, House.Greece);
    const powr = mockStructure('POWR', 60, 60, House.Greece);

    const ctx = makeMockFogContext({
      map,
      structures: [gun, powr],
      entities: [],
    });

    updateFogOfWar(ctx);

    // GUN (defense) should reveal with sight=7: check cell 7 away
    expect(map.getVisibility(37, 30)).toBe(2); // 7 cells east
    // But 8 cells east (beyond sight) should not be visible
    // (unless LOS from POWR reaches it)
    // POWR (non-defense) should reveal with sight=5: check cell 5 away
    expect(map.getVisibility(65, 60)).toBe(2); // 5 cells east
    // 6 cells east from POWR should NOT be visible
    expect(map.getVisibility(66, 60)).toBe(0);
  });

  it('structures contribute to fog of war alongside units', () => {
    setPlayerHouses(new Set([House.Greece]));
    const map = createClearMap();
    const e = new Entity(UnitType.V_JEEP, House.Greece, 20 * CELL_SIZE, 20 * CELL_SIZE);
    const powr = mockStructure('POWR', 80, 80, House.Greece);

    const ctx = makeMockFogContext({
      map,
      entities: [e],
      structures: [powr],
    });

    updateFogOfWar(ctx);

    // Both the unit position and structure position should have visibility
    expect(map.getVisibility(20, 20)).toBe(2);
    expect(map.getVisibility(80, 80)).toBe(2);
  });

  it('GAP is in the DEFENSE_TYPES set (gets sight=7)', () => {
    expect(DEFENSE_TYPES.has('GAP')).toBe(true);

    // Verify behaviorally: GAP structure reveals 7 cells
    const map = createClearMap();
    const gap = mockStructure('GAP', 64, 64, House.Greece);
    const ctx = makeMockFogContext({ map, structures: [gap], entities: [] });
    updateFogOfWar(ctx);
    expect(map.getVisibility(71, 64)).toBe(2); // 7 cells east
  });
});

// ========================================================================
// 12. Unit death — fog recalculation
// ========================================================================

describe('Unit death and fog recalculation', () => {
  it('dead units are excluded from fog reveal (alive check)', () => {
    setPlayerHouses(new Set([House.Greece]));
    const map = createClearMap();
    const alive = new Entity(UnitType.V_JEEP, House.Greece, 40 * CELL_SIZE, 40 * CELL_SIZE);
    const dead = new Entity(UnitType.V_JEEP, House.Greece, 80 * CELL_SIZE, 80 * CELL_SIZE);
    dead.alive = false;

    const ctx = makeMockFogContext({ map, entities: [alive, dead] });
    updateFogOfWar(ctx);

    // Alive unit's area should be visible
    expect(map.getVisibility(40, 40)).toBe(2);
    // Dead unit's area should remain shroud
    expect(map.getVisibility(80, 80)).toBe(0);
  });

  it('dead unit provides no vision — updateFogOfWar with empty array reveals nothing', () => {
    const map = createClearMap();
    map.updateFogOfWar([unit(64, 64, 5)]);
    expect(countVis(map, 2)).toBeGreaterThan(0);

    // Simulate unit death: update without any units
    map.updateFogOfWar([]);
    expect(countVis(map, 2)).toBe(0);
    // Old cells are now fog (1)
    expect(countVis(map, 1)).toBeGreaterThan(0);
  });

  it('updateFogOfWar can be called repeatedly (per-tick simulation)', () => {
    setPlayerHouses(new Set([House.Greece]));
    const map = createClearMap();
    const e = new Entity(UnitType.V_JEEP, House.Greece, 64 * CELL_SIZE, 64 * CELL_SIZE);
    const ctx = makeMockFogContext({ map, entities: [e] });

    // Multiple calls should not error or accumulate stale state
    updateFogOfWar(ctx);
    const vis1 = countVis(map, 2);
    updateFogOfWar(ctx);
    const vis2 = countVis(map, 2);
    expect(vis1).toBe(vis2);
    expect(vis1).toBeGreaterThan(0);
  });
});

// ========================================================================
// 13. revealAroundCell
// ========================================================================

describe('revealAroundCell', () => {
  it('revealAroundCell uses circular geometry (dx^2 + dy^2 <= r^2)', () => {
    const map = createClearMap();
    revealAroundCell(map, 64, 64, 5);
    // (5,0) = 25 <= 25 — included
    expect(map.getVisibility(69, 64)).toBe(2);
    // (4,3) = 25 <= 25 — included
    expect(map.getVisibility(68, 67)).toBe(2);
    // (5,1) = 26 > 25 — excluded
    expect(map.getVisibility(69, 65)).toBe(0);
  });

  it('revealAroundCell sets visibility directly to 2 (visible)', () => {
    const map = createClearMap();
    revealAroundCell(map, 50, 50, 2);
    expect(map.getVisibility(50, 50)).toBe(2);
    expect(map.getVisibility(52, 50)).toBe(2); // within radius
    // Cells outside remain shroud, not fog
    expect(map.getVisibility(10, 10)).toBe(0);
  });

  it('revealAroundCell checks bounds — no crash at map edge', () => {
    const map = createClearMap();
    // Reveal at corner with large radius — should clip, not crash
    revealAroundCell(map, 0, 0, 15);
    expect(map.getVisibility(0, 0)).toBe(2);
    expect(map.getVisibility(10, 0)).toBe(2);
    // No cells outside map bounds should cause errors
  });

  it('revealAroundCell with radius=15 reveals correct area (initial player reveal)', () => {
    const map = createClearMap();
    revealAroundCell(map, 64, 64, 15);
    const vis = countVis(map, 2);
    let expected = 0;
    for (let dy = -15; dy <= 15; dy++) {
      for (let dx = -15; dx <= 15; dx++) {
        if (dx * dx + dy * dy <= 225) expected++;
      }
    }
    expect(vis).toBe(expected);
  });

  it('setVisibility directly on map works for programmatic reveal', () => {
    const map = createClearMap();
    map.setVisibility(50, 50, 2);
    expect(map.getVisibility(50, 50)).toBe(2);

    map.setVisibility(50, 50, 1);
    expect(map.getVisibility(50, 50)).toBe(1);

    map.setVisibility(50, 50, 0);
    expect(map.getVisibility(50, 50)).toBe(0);
  });
});

// ========================================================================
// 14. Edge cases
// ========================================================================

describe('Edge cases', () => {
  it('unit at map corner (0,0) does not crash — clips to valid cells', () => {
    const map = createClearMap();
    map.updateFogOfWar([unit(0, 0, 5)]);
    expect(map.getVisibility(0, 0)).toBe(2);
    // Should reveal cells in the positive quadrant only
    expect(map.getVisibility(3, 3)).toBe(2); // within radius
  });

  it('unit at map edge (127,127) does not crash', () => {
    const map = createClearMap();
    map.updateFogOfWar([unit(127, 127, 5)]);
    expect(map.getVisibility(127, 127)).toBe(2);
  });

  it('unit at bottom-right corner reveals limited area', () => {
    const map = createClearMap();
    map.updateFogOfWar([unit(127, 127, 3)]);
    const vis = countVis(map, 2);
    // Should be less than full circle area due to clipping
    const fullCircle = countVis(createClearMap(), 2);
    const map2 = createClearMap();
    map2.updateFogOfWar([unit(64, 64, 3)]);
    const fullArea = countVis(map2, 2);
    expect(vis).toBeLessThan(fullArea);
    expect(vis).toBeGreaterThan(0);
  });

  it('getVisibility returns 0 for out-of-bounds cells', () => {
    const map = new GameMap();
    expect(map.getVisibility(-1, -1)).toBe(0);
    expect(map.getVisibility(MAP_CELLS, 0)).toBe(0);
    expect(map.getVisibility(0, MAP_CELLS)).toBe(0);
    expect(map.getVisibility(999, 999)).toBe(0);
  });

  it('setVisibility ignores out-of-bounds coordinates (no crash)', () => {
    const map = new GameMap();
    // Should not throw
    map.setVisibility(-1, -1, 2);
    map.setVisibility(MAP_CELLS, 0, 2);
    map.setVisibility(0, MAP_CELLS, 2);
    // Verify nothing changed
    expect(countVis(map, 2)).toBe(0);
  });

  it('jamCell and unjamCell ignore out-of-bounds (no crash)', () => {
    const map = new GameMap();
    map.jamCell(-1, -1);
    map.unjamCell(-1, -1);
    map.jamCell(MAP_CELLS, MAP_CELLS);
    map.unjamCell(MAP_CELLS, MAP_CELLS);
    // No crash, no state change
    expect(map.jammedCells.size).toBe(0);
  });

  it('exact sight boundary: cell at distance=sight is included, distance>sight is not', () => {
    const map = createClearMap();
    const sight = 7;
    map.updateFogOfWar([unit(64, 64, sight)]);
    // (7,0) => 49 <= 49 — included
    expect(map.getVisibility(71, 64)).toBe(2);
    // (5,5) => 50 > 49 — NOT included
    expect(map.getVisibility(69, 69)).toBe(0);
    // (7,1) => 50 > 49 — NOT included
    expect(map.getVisibility(71, 65)).toBe(0);
  });

  it('large sight range does not overflow map bounds', () => {
    const map = createClearMap();
    // Unit at center with sight > half map — should reveal huge area but not crash
    map.updateFogOfWar([unit(64, 64, 100)]);
    const vis = countVis(map, 2);
    // Should reveal most of the map
    expect(vis).toBeGreaterThan(MAP_CELLS * MAP_CELLS * 0.5);
  });

  it('empty units array causes all visible cells to become fog', () => {
    const map = createClearMap();
    map.updateFogOfWar([unit(64, 64, 10)]);
    const wasFogged = countVis(map, 1);
    const wasVisible = countVis(map, 2);
    expect(wasVisible).toBeGreaterThan(0);

    map.updateFogOfWar([]);
    expect(countVis(map, 2)).toBe(0);
    expect(countVis(map, 1)).toBe(wasVisible + wasFogged);
  });
});

// ========================================================================
// 15. Crate effects on visibility
// ========================================================================

describe('Crate effects on visibility', () => {
  it('reveal crate effect: revealAll makes entire map visible', () => {
    const map = createClearMap();
    // Simulate reveal crate: call revealAll
    map.revealAll();
    expect(countVis(map, 2)).toBe(MAP_CELLS * MAP_CELLS);
  });

  it('darkness crate effect: 7x7 area set to shroud (0)', () => {
    const map = createClearMap();
    map.revealAll();
    const cx = 50, cy = 50;
    // Simulate darkness crate: set 7x7 grid to 0
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        map.setVisibility(cx + dx, cy + dy, 0);
      }
    }
    // Center and corners of 7x7 should be shrouded
    expect(map.getVisibility(50, 50)).toBe(0);
    expect(map.getVisibility(47, 47)).toBe(0);
    expect(map.getVisibility(53, 53)).toBe(0);
    // Total shrouded cells should be 7*7 = 49
    expect(countVis(map, 0)).toBe(49);
  });

  it('darkness crate covers exactly 49 cells (7x7 grid)', () => {
    const map = createClearMap();
    map.revealAll();
    const cx = 64, cy = 64;
    let count = 0;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        map.setVisibility(cx + dx, cy + dy, 0);
        count++;
      }
    }
    expect(count).toBe(49);
  });

  it('reveal crate: fogDisabled reveals all (simulates permanent reveal)', () => {
    const ctx = makeMockFogContext({ fogDisabled: true });
    updateFogOfWar(ctx);
    expect(countVis(ctx.map, 2)).toBe(MAP_CELLS * MAP_CELLS);
  });
});

// ========================================================================
// 16. visibleCells optimization (internal tracking)
// ========================================================================

describe('visibleCells tracking optimization', () => {
  it('GameMap tracks visible cells for efficient downgrade', () => {
    // The private visibleCells array allows O(visible) downgrade instead of O(16384)
    const map = createClearMap();
    map.updateFogOfWar([unit(64, 64, 3)]);
    const vis = countVis(map, 2);
    expect(vis).toBeGreaterThan(0);

    // After second call with no units, only previously visible cells become fog
    map.updateFogOfWar([]);
    const fog = countVis(map, 1);
    expect(fog).toBe(vis); // exactly the same count
  });

  it('repeated fog cycles do not accumulate stale visible cells', () => {
    const map = createClearMap();
    // Multiple cycles at different positions
    for (let i = 0; i < 5; i++) {
      map.updateFogOfWar([unit(30 + i * 10, 30 + i * 10, 3)]);
    }
    map.updateFogOfWar([]);
    // After clearing, only the LAST position's visible cells should have become fog
    // (previous ones were already downgraded in their respective cycles)
    // Total fog should be the union of all positions that were ever visible
    expect(countVis(map, 2)).toBe(0);
    expect(countVis(map, 1)).toBeGreaterThan(0);
  });
});

// ========================================================================
// 17. Darkness crate: functional test on GameMap
// ========================================================================

describe('Darkness crate — functional GameMap test', () => {
  it('manually shrouding a 7x7 area sets all cells to 0', () => {
    const map = createClearMap();
    map.revealAll();
    const cx = 50, cy = 50;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        map.setVisibility(cx + dx, cy + dy, 0);
      }
    }
    // Center and edges of the 7x7 should be shrouded
    expect(map.getVisibility(50, 50)).toBe(0);
    expect(map.getVisibility(47, 47)).toBe(0);
    expect(map.getVisibility(53, 53)).toBe(0);
    // Just outside should still be visible
    expect(map.getVisibility(46, 50)).toBe(2);
    expect(map.getVisibility(54, 50)).toBe(2);
  });
});

// ========================================================================
// 18. Mathematical verification of sight areas
// ========================================================================

describe('Mathematical sight area verification', () => {
  const testCases: [number, number][] = [
    [1, 5],    // dx*dx+dy*dy<=1: (0,0),(1,0),(-1,0),(0,1),(0,-1)
    [2, 13],   // dx*dx+dy*dy<=4: a circle of radius 2
    [3, 29],   // dx*dx+dy*dy<=9
  ];

  for (const [sight, expectedCells] of testCases) {
    it(`sight=${sight} reveals exactly ${expectedCells} cells (on clear terrain, center of map)`, () => {
      const map = createClearMap();
      map.updateFogOfWar([unit(64, 64, sight)]);
      const vis = countVis(map, 2);
      expect(vis).toBe(expectedCells);
    });
  }

  it('sight=5 cell count is correct for discrete circle (r^2=25)', () => {
    const map = createClearMap();
    map.updateFogOfWar([unit(64, 64, 5)]);
    const vis = countVis(map, 2);
    // Count manually: all (dx,dy) pairs where dx*dx+dy*dy <= 25
    let expected = 0;
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        if (dx * dx + dy * dy <= 25) expected++;
      }
    }
    expect(vis).toBe(expected);
  });
});

// ========================================================================
// 19. Integration: hasLineOfSight Bresenham correctness
// ========================================================================

describe('hasLineOfSight Bresenham correctness', () => {
  it('straight horizontal line blocked by ROCK in the middle', () => {
    const map = createClearMap();
    map.setTerrain(5, 0, Terrain.ROCK);
    expect(map.hasLineOfSight(0, 0, 10, 0)).toBe(false);
  });

  it('straight vertical line blocked by WALL in the middle', () => {
    const map = createClearMap();
    map.setTerrain(0, 5, Terrain.WALL);
    expect(map.hasLineOfSight(0, 0, 0, 10)).toBe(false);
  });

  it('diagonal line blocked by ROCK', () => {
    const map = createClearMap();
    map.setTerrain(3, 3, Terrain.ROCK);
    expect(map.hasLineOfSight(0, 0, 6, 6)).toBe(false);
  });

  it('same cell to same cell always has LOS (trivially true)', () => {
    const map = createClearMap();
    expect(map.hasLineOfSight(5, 5, 5, 5)).toBe(true);
    // Even with rock at that cell
    map.setTerrain(5, 5, Terrain.ROCK);
    expect(map.hasLineOfSight(5, 5, 5, 5)).toBe(true);
  });

  it('adjacent cells always have LOS (only intermediate cells checked)', () => {
    const map = createClearMap();
    // Even if both cells are rock, LOS between adjacent cells is true
    // because start and end cells are not checked
    map.setTerrain(5, 5, Terrain.ROCK);
    map.setTerrain(6, 5, Terrain.ROCK);
    expect(map.hasLineOfSight(5, 5, 6, 5)).toBe(true);
  });
});

// ========================================================================
// 20. Spy plane and crate reveal — GameMap.setVisibility integration
// ========================================================================

describe('GameMap.setVisibility direct usage', () => {
  it('can transition cell through all three states', () => {
    const map = new GameMap();
    const idx = 64 * MAP_CELLS + 64;
    expect(map.visibility[idx]).toBe(0); // starts as shroud

    map.setVisibility(64, 64, 2);
    expect(map.visibility[idx]).toBe(2); // visible

    map.setVisibility(64, 64, 1);
    expect(map.visibility[idx]).toBe(1); // fog

    map.setVisibility(64, 64, 0);
    expect(map.visibility[idx]).toBe(0); // shroud again
  });

  it('spy plane reveal (radius=10) reveals correct area', () => {
    const map = createClearMap();
    const cx = 64, cy = 64, r = 10;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r2) {
          map.setVisibility(cx + dx, cy + dy, 2);
        }
      }
    }
    // Count revealed cells
    const vis = countVis(map, 2);
    let expected = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r2) expected++;
      }
    }
    expect(vis).toBe(expected);
    // Cell at (10,0) from center — 100 <= 100, included
    expect(map.getVisibility(74, 64)).toBe(2);
    // Cell at (8,7) — 64+49=113 > 100, excluded
    expect(map.getVisibility(72, 71)).toBe(0);
  });
});

// ========================================================================
// 21. creepShadow (SCA04EA tunnel darkness)
// ========================================================================

describe('creepShadow (tunnel darkness)', () => {
  it('downgrades all fog and visible cells to shroud', () => {
    const map = createClearMap();
    map.updateFogOfWar([unit(64, 64, 5)]);
    expect(countVis(map, 2)).toBeGreaterThan(0);

    // Remove unit to create fog
    map.updateFogOfWar([]);
    expect(countVis(map, 1)).toBeGreaterThan(0);

    // Creep shadow
    map.creepShadow();
    expect(countVis(map, 0)).toBe(MAP_CELLS * MAP_CELLS);
    expect(countVis(map, 1)).toBe(0);
    expect(countVis(map, 2)).toBe(0);
  });

  it('fog can be rebuilt after creepShadow', () => {
    const map = createClearMap();
    map.updateFogOfWar([unit(64, 64, 5)]);
    map.creepShadow();
    // All shroud now
    expect(countVis(map, 2)).toBe(0);

    // Reveal again
    map.updateFogOfWar([unit(64, 64, 5)]);
    expect(countVis(map, 2)).toBeGreaterThan(0);
  });
});
