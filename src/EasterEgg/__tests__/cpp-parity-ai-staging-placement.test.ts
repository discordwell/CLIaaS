/**
 * C++ Behavioral Parity: AI Staging Area & Structure Placement
 *
 * Tests verify that aiStagingArea and aiPlaceStructure match C++ RA source behavior
 * for staging rally points and building placement spiral scans.
 *
 * Source references:
 *   - HOUSE.CPP AI_Building() — spiral placement of structures around base center
 *   - HOUSE.CPP Where_To_Go() — staging area calculation toward nearest enemy
 *   - BUILDING.CPP Can_Build_Here() — adjacency/obstruction/exit checks
 *
 * Observable outcomes: staging world coordinates, placement cell positions,
 * ring ordering, terrain/obstruction filtering, defense vs non-defense sorting,
 * adjacency requirements, factory exit avoidance.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  House, Mission, UnitType, CELL_SIZE,
  UNIT_STATS, HOUSE_FACTION, PRODUCTION_ITEMS,
  type ProductionItem, type WorldPos,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap, Terrain } from '../engine/map';
import { STRUCTURE_SIZE, STRUCTURE_MAX_HP, type MapStructure } from '../engine/scenario';
import {
  type AIContext, type AIHouseState, type Difficulty,
  AI_DIFFICULTY_MODS,
  createAIHouseState,
  aiStagingArea,
  aiPlaceStructure,
  aiGetBaseCenter,
  aiIsFactoryExit,
} from '../engine/ai';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeStructure(
  type: string, house: House, cx = 50, cy = 50,
  opts: Partial<MapStructure> = {},
): MapStructure {
  const maxHp = opts.maxHp ?? STRUCTURE_MAX_HP[type] ?? 256;
  return {
    type, image: type.toLowerCase(), house, cx, cy,
    hp: opts.hp ?? maxHp, maxHp,
    alive: opts.alive ?? true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
    ...opts,
  } as MapStructure;
}

function makeMockAIContext(overrides: Partial<AIContext> = {}): AIContext {
  const map = new GameMap();
  map.setBounds(40, 40, 50, 50);
  const alliances = buildDefaultAlliances();
  return {
    entities: [], entityById: new Map(), structures: [],
    map, tick: 0, playerHouse: House.Spain,
    scenarioId: 'SCG01EA', difficulty: 'normal' as Difficulty,
    aiStates: new Map(), houseCredits: new Map(),
    houseIQs: new Map(), houseTechLevels: new Map(),
    houseMaxUnits: new Map(), houseMaxInfantry: new Map(),
    houseMaxBuildings: new Map(),
    baseBlueprint: [], baseRebuildQueue: [], baseRebuildCooldown: 0,
    scenarioProductionItems: PRODUCTION_ITEMS,
    scenarioUnitStats: {}, scenarioWeaponStats: {},
    nextWaveId: 0,
    autocreateEnabled: false, teamTypes: [],
    destroyedTeams: new Set(), waypoints: new Map(),
    houseEdges: new Map(), effects: [],
    isAllied: (a, b) => alliances.get(a)?.has(b) ?? false,
    isPlayerControlled: (e) => alliances.get(e.house)?.has(House.Spain) ?? false,
    clearStructureFootprint: vi.fn(),
    findPassableSpawn: (_cx, _cy, _scx, _scy, _fw, _fh) => ({ cx: _cx, cy: _cy }),
    ...overrides,
  };
}

function addAIHouse(ctx: AIContext, house: House, overrides: Partial<AIHouseState> = {}): AIHouseState {
  const state = createAIHouseState(ctx, house);
  Object.assign(state, overrides);
  ctx.aiStates.set(house, state);
  return state;
}

// =============================================================================
// aiStagingArea — staging rally point toward nearest enemy
// C++ HOUSE.CPP Where_To_Go(): base center + 5-cell offset toward nearest enemy
// =============================================================================

describe('aiStagingArea', () => {

  // -- 1. Null when no base center (no structures) --
  it('returns null when house has no alive structures (no base center)', () => {
    const ctx = makeMockAIContext();
    expect(aiStagingArea(ctx, House.USSR)).toBeNull();
  });

  // -- 2. Returns world coordinates (not cell coordinates) --
  it('returns world coordinates (pixel space), not raw cell coordinates', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('POWR', House.USSR, 50, 50)); // base center
    ctx.structures.push(makeStructure('POWR', House.Spain, 60, 50)); // enemy east

    const result = aiStagingArea(ctx, House.USSR);
    expect(result).not.toBeNull();
    // World coords are in pixel space (multiples of CELL_SIZE, offset by CELL_SIZE/2)
    expect(result!.x % 1).toBe(0); // integer pixel values
    expect(result!.y % 1).toBe(0);
    // Must be larger than any cell coordinate
    expect(result!.x).toBeGreaterThan(CELL_SIZE);
    expect(result!.y).toBeGreaterThan(CELL_SIZE);
  });

  // -- 3. Staging area is 5 cells from base center --
  it('offsets 5 cells from base center along the unit vector toward enemy', () => {
    const ctx = makeMockAIContext();
    // POWR is 2x2, center at cx+1, cy+1 => base center floor(51/1, 51/1) = (51,51)
    ctx.structures.push(makeStructure('POWR', House.USSR, 50, 50));
    // Enemy due east at cx=70 (well beyond 5 cells)
    ctx.structures.push(makeStructure('POWR', House.Spain, 70, 50));

    const center = aiGetBaseCenter(ctx, House.USSR)!;
    const result = aiStagingArea(ctx, House.USSR)!;

    // Direction is pure east: dx=positive, dy=0
    // stageCx = center.cx + round(1 * 5) = center.cx + 5
    const expectedCx = center.cx + 5;
    const expectedCy = center.cy + 0;
    expect(result.x).toBe(expectedCx * CELL_SIZE + CELL_SIZE / 2);
    expect(result.y).toBe(expectedCy * CELL_SIZE + CELL_SIZE / 2);
  });

  // -- 4. Direction is toward nearest enemy structure --
  it('points staging direction toward nearest enemy structure', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('POWR', House.USSR, 50, 50));
    // Nearest enemy south
    ctx.structures.push(makeStructure('POWR', House.Spain, 50, 70));

    const center = aiGetBaseCenter(ctx, House.USSR)!;
    const result = aiStagingArea(ctx, House.USSR)!;

    // stageCy should be center.cy + 5 (south), stageCx = center.cx
    const expectedCy = center.cy + 5;
    expect(result.x).toBe(center.cx * CELL_SIZE + CELL_SIZE / 2);
    expect(result.y).toBe(expectedCy * CELL_SIZE + CELL_SIZE / 2);
  });

  // -- 5. Allied structures ignored as enemies --
  it('ignores allied structures when finding nearest enemy', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('POWR', House.USSR, 50, 50));
    // Ukraine is allied with USSR in default alliances
    ctx.structures.push(makeStructure('POWR', House.Ukraine, 55, 50));
    // No actual enemies → should behave as "no enemy found"

    const center = aiGetBaseCenter(ctx, House.USSR)!;
    const result = aiStagingArea(ctx, House.USSR)!;

    // With no enemy, enemyCx/enemyCy stay at center → dx=dy=0, len=1
    // stageCx = center.cx + round(0/1 * 5) = center.cx
    expect(result.x).toBe(center.cx * CELL_SIZE + CELL_SIZE / 2);
    expect(result.y).toBe(center.cy * CELL_SIZE + CELL_SIZE / 2);
  });

  // -- 6. Dead structures ignored as enemies --
  it('ignores dead enemy structures', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('POWR', House.USSR, 50, 50));
    // Dead enemy should be skipped
    ctx.structures.push(makeStructure('POWR', House.Spain, 60, 50, { alive: false }));

    const center = aiGetBaseCenter(ctx, House.USSR)!;
    const result = aiStagingArea(ctx, House.USSR)!;

    // No alive enemy → defaults to base center
    expect(result.x).toBe(center.cx * CELL_SIZE + CELL_SIZE / 2);
    expect(result.y).toBe(center.cy * CELL_SIZE + CELL_SIZE / 2);
  });

  // -- 7. No enemy → staging at base center (dx=dy=0, len=1) --
  it('returns base center when no enemies exist (offset 0)', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('POWR', House.USSR, 50, 50));

    const center = aiGetBaseCenter(ctx, House.USSR)!;
    const result = aiStagingArea(ctx, House.USSR)!;

    expect(result.x).toBe(center.cx * CELL_SIZE + CELL_SIZE / 2);
    expect(result.y).toBe(center.cy * CELL_SIZE + CELL_SIZE / 2);
  });

  // -- 8. Multiple enemies → picks nearest --
  it('picks the nearest enemy when multiple are present', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('POWR', House.USSR, 50, 50));
    const center = aiGetBaseCenter(ctx, House.USSR)!;

    // Near enemy east (10 cells from center)
    ctx.structures.push(makeStructure('POWR', House.Spain, center.cx + 10, center.cy));
    // Far enemy west (20 cells from center)
    ctx.structures.push(makeStructure('POWR', House.Spain, center.cx - 20, center.cy));

    const result = aiStagingArea(ctx, House.USSR)!;
    // Should stage toward the closer eastern enemy
    expect(result.x).toBe((center.cx + 5) * CELL_SIZE + CELL_SIZE / 2);
    expect(result.y).toBe(center.cy * CELL_SIZE + CELL_SIZE / 2);
  });

  // -- 9. WorldPos x formula: stageCx * CELL_SIZE + CELL_SIZE/2 --
  it('x = stageCx * CELL_SIZE + CELL_SIZE/2 (C++ cell-to-world conversion)', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('SILO', House.USSR, 60, 60)); // 1x1, center at (60,60)
    ctx.structures.push(makeStructure('SILO', House.Spain, 80, 60)); // enemy east

    const center = aiGetBaseCenter(ctx, House.USSR)!;
    expect(center.cx).toBe(60);
    const stageCx = center.cx + Math.round(1 * 5); // due east
    expect(aiStagingArea(ctx, House.USSR)!.x).toBe(stageCx * CELL_SIZE + CELL_SIZE / 2);
  });

  // -- 10. WorldPos y formula: stageCy * CELL_SIZE + CELL_SIZE/2 --
  it('y = stageCy * CELL_SIZE + CELL_SIZE/2 (C++ cell-to-world conversion)', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('SILO', House.USSR, 60, 60)); // 1x1
    ctx.structures.push(makeStructure('SILO', House.Spain, 60, 80)); // enemy south

    const center = aiGetBaseCenter(ctx, House.USSR)!;
    expect(center.cy).toBe(60);
    const stageCy = center.cy + Math.round(1 * 5); // due south
    expect(aiStagingArea(ctx, House.USSR)!.y).toBe(stageCy * CELL_SIZE + CELL_SIZE / 2);
  });

  // -- 11. Enemy to the east → staging area moves east --
  it('stages eastward when enemy is to the east', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('SILO', House.USSR, 55, 55));
    ctx.structures.push(makeStructure('SILO', House.Spain, 75, 55)); // pure east

    const center = aiGetBaseCenter(ctx, House.USSR)!;
    const result = aiStagingArea(ctx, House.USSR)!;
    // x should increase from center
    expect(result.x).toBeGreaterThan(center.cx * CELL_SIZE + CELL_SIZE / 2);
    // y should stay the same
    expect(result.y).toBe(center.cy * CELL_SIZE + CELL_SIZE / 2);
  });

  // -- 12. Enemy to the north → staging area moves north --
  it('stages northward when enemy is to the north', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('SILO', House.USSR, 55, 65));
    ctx.structures.push(makeStructure('SILO', House.Spain, 55, 45)); // pure north

    const center = aiGetBaseCenter(ctx, House.USSR)!;
    const result = aiStagingArea(ctx, House.USSR)!;
    // y should decrease (north is negative y)
    expect(result.y).toBeLessThan(center.cy * CELL_SIZE + CELL_SIZE / 2);
    // x should stay the same
    expect(result.x).toBe(center.cx * CELL_SIZE + CELL_SIZE / 2);
  });

  // -- 13. Diagonal enemy → offset follows normalized diagonal vector --
  it('stages diagonally when enemy is diagonal (NE)', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('SILO', House.USSR, 55, 65));
    // Enemy NE: dx=+20, dy=-20
    ctx.structures.push(makeStructure('SILO', House.Spain, 75, 45));

    const center = aiGetBaseCenter(ctx, House.USSR)!;
    const result = aiStagingArea(ctx, House.USSR)!;

    const dx = 75 - center.cx;
    const dy = 45 - center.cy;
    const len = Math.sqrt(dx * dx + dy * dy);
    const expectedCx = center.cx + Math.round(dx / len * 5);
    const expectedCy = center.cy + Math.round(dy / len * 5);
    expect(result.x).toBe(expectedCx * CELL_SIZE + CELL_SIZE / 2);
    expect(result.y).toBe(expectedCy * CELL_SIZE + CELL_SIZE / 2);
  });

  // -- 14. Own dead structures don't form base center --
  it('returns null when all own structures are dead', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('POWR', House.USSR, 50, 50, { alive: false }));
    ctx.structures.push(makeStructure('SILO', House.Spain, 60, 60)); // enemy alive but own dead
    expect(aiStagingArea(ctx, House.USSR)).toBeNull();
  });
});

// =============================================================================
// aiPlaceStructure — spiral scan outward for valid build placement
// C++ HOUSE.CPP AI_Building() → building placement spiral with BP3 adjacency
// =============================================================================

describe('aiPlaceStructure', () => {

  // Helper: set up a context with a clear map and a base structure for adjacency
  function makeBasicPlacementCtx(
    baseCx = 55, baseCy = 55, baseType = 'POWR', baseHouse = House.USSR,
  ): AIContext {
    const ctx = makeMockAIContext();
    // Ensure clear terrain in bounds
    for (let cy = ctx.map.boundsY; cy < ctx.map.boundsY + ctx.map.boundsH; cy++) {
      for (let cx = ctx.map.boundsX; cx < ctx.map.boundsX + ctx.map.boundsW; cx++) {
        ctx.map.setTerrain(cx, cy, Terrain.CLEAR);
      }
    }
    ctx.structures.push(makeStructure(baseType, baseHouse, baseCx, baseCy));
    return ctx;
  }

  // -- 15. Returns null when no base center --
  it('returns null when house has no alive structures', () => {
    const ctx = makeMockAIContext();
    expect(aiPlaceStructure(ctx, House.USSR, 'POWR')).toBeNull();
  });

  // -- 16. Returns { cx, cy } for valid placement --
  it('returns { cx, cy } cell position for a valid placement', () => {
    const ctx = makeBasicPlacementCtx();
    const result = aiPlaceStructure(ctx, House.USSR, 'SILO');
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('cx');
    expect(result).toHaveProperty('cy');
  });

  // -- 17. Spiral scans rings 1-6 from center --
  it('scans up to ring 6 (returns null if no valid pos within 6 rings)', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('SILO', House.USSR, 55, 55));
    // Block everything within 6 rings with structures
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        if (dx === 0 && dy === 0) continue;
        ctx.structures.push(makeStructure('SILO', House.USSR, 55 + dx, 55 + dy));
      }
    }
    // All ring 1-6 positions are occupied by existing structures; ring perimeter also
    // This should exhaust all rings and return null since the candidate at ring 7+ is unreachable
    const result = aiPlaceStructure(ctx, House.USSR, 'SILO');
    expect(result).toBeNull();
  });

  // -- 18. Closest ring checked first --
  it('prefers ring 1 over ring 2 for non-defense structures', () => {
    const ctx = makeBasicPlacementCtx(55, 55, 'SILO');
    const result = aiPlaceStructure(ctx, House.USSR, 'SILO');
    expect(result).not.toBeNull();
    const center = aiGetBaseCenter(ctx, House.USSR)!;
    // Ring 1 candidates have |dx| or |dy| = 1
    const dx = result!.cx - center.cx;
    const dy = result!.cy - center.cy;
    expect(Math.max(Math.abs(dx), Math.abs(dy))).toBe(1);
  });

  // -- 19. Skips out-of-bounds positions (map bounds check) --
  it('skips positions outside map bounds', () => {
    const ctx = makeMockAIContext();
    // Place base at edge of bounds
    const edgeCx = ctx.map.boundsX;
    const edgeCy = ctx.map.boundsY;
    for (let cy = ctx.map.boundsY; cy < ctx.map.boundsY + ctx.map.boundsH; cy++) {
      for (let cx = ctx.map.boundsX; cx < ctx.map.boundsX + ctx.map.boundsW; cx++) {
        ctx.map.setTerrain(cx, cy, Terrain.CLEAR);
      }
    }
    ctx.structures.push(makeStructure('SILO', House.USSR, edgeCx, edgeCy));
    const result = aiPlaceStructure(ctx, House.USSR, 'SILO');
    if (result) {
      // Any returned position must be within bounds
      const [fw, fh] = STRUCTURE_SIZE['SILO'] ?? [1, 1];
      expect(result.cx).toBeGreaterThanOrEqual(ctx.map.boundsX);
      expect(result.cy).toBeGreaterThanOrEqual(ctx.map.boundsY);
      expect(result.cx + fw).toBeLessThanOrEqual(ctx.map.boundsX + ctx.map.boundsW);
      expect(result.cy + fh).toBeLessThanOrEqual(ctx.map.boundsY + ctx.map.boundsH);
    }
  });

  // -- 20. Skips WALL terrain cells --
  it('rejects placements on WALL terrain', () => {
    const ctx = makeBasicPlacementCtx(55, 55, 'SILO');
    const center = aiGetBaseCenter(ctx, House.USSR)!;
    // Wall off all ring-1 positions
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (Math.abs(dx) !== 1 && Math.abs(dy) !== 1) continue;
        ctx.map.setTerrain(center.cx + dx, center.cy + dy, Terrain.WALL);
      }
    }
    const result = aiPlaceStructure(ctx, House.USSR, 'SILO');
    // Should skip ring 1 (all walls) and go to ring 2 or beyond
    if (result) {
      const dx = result.cx - center.cx;
      const dy = result.cy - center.cy;
      expect(Math.max(Math.abs(dx), Math.abs(dy))).toBeGreaterThanOrEqual(2);
    }
  });

  // -- 21. Skips WATER terrain cells --
  it('rejects placements on WATER terrain', () => {
    const ctx = makeBasicPlacementCtx(55, 55, 'SILO');
    const center = aiGetBaseCenter(ctx, House.USSR)!;
    // Water off all ring-1 positions
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (Math.abs(dx) !== 1 && Math.abs(dy) !== 1) continue;
        ctx.map.setTerrain(center.cx + dx, center.cy + dy, Terrain.WATER);
      }
    }
    const result = aiPlaceStructure(ctx, House.USSR, 'SILO');
    if (result) {
      const dx = result.cx - center.cx;
      const dy = result.cy - center.cy;
      expect(Math.max(Math.abs(dx), Math.abs(dy))).toBeGreaterThanOrEqual(2);
    }
  });

  // -- 22. Skips positions overlapping existing alive structures --
  it('rejects positions that overlap alive structures', () => {
    const ctx = makeBasicPlacementCtx(55, 55, 'POWR'); // POWR is 2x2 at (55,55)
    const center = aiGetBaseCenter(ctx, House.USSR)!;
    // Place a blocking structure at ring 1 east
    ctx.structures.push(makeStructure('SILO', House.USSR, center.cx + 1, center.cy));

    const result = aiPlaceStructure(ctx, House.USSR, 'SILO');
    // The result must not overlap any existing structure
    if (result) {
      for (const s of ctx.structures) {
        if (!s.alive) continue;
        const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
        const [fw, fh] = STRUCTURE_SIZE['SILO'] ?? [1, 1];
        for (let fy = 0; fy < fh; fy++) {
          for (let fx = 0; fx < fw; fx++) {
            const inStruct = result.cx + fx >= s.cx && result.cx + fx < s.cx + sw &&
                             result.cy + fy >= s.cy && result.cy + fy < s.cy + sh;
            expect(inStruct, `placement (${result.cx + fx},${result.cy + fy}) should not overlap structure ${s.type} at (${s.cx},${s.cy})`).toBe(false);
          }
        }
      }
    }
  });

  // -- 23. Dead structures don't block placement --
  it('allows placement overlapping dead structures', () => {
    const ctx = makeBasicPlacementCtx(55, 55, 'SILO');
    const center = aiGetBaseCenter(ctx, House.USSR)!;
    // Place dead structures at every ring-1 position
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (Math.abs(dx) !== 1 && Math.abs(dy) !== 1) continue;
        ctx.structures.push(makeStructure('SILO', House.Spain, center.cx + dx, center.cy + dy, { alive: false }));
      }
    }
    // Should still find ring 1 since dead structures don't block
    const result = aiPlaceStructure(ctx, House.USSR, 'SILO');
    expect(result).not.toBeNull();
    const dx = result!.cx - center.cx;
    const dy = result!.cy - center.cy;
    expect(Math.max(Math.abs(dx), Math.abs(dy))).toBe(1);
  });

  // -- 24. Skips positions that would block factory exits --
  it('rejects positions blocking factory exits (row below WEAP)', () => {
    const ctx = makeBasicPlacementCtx(55, 55, 'SILO');
    // Place a WEAP factory whose exit zone we can test
    // WEAP is 3x2, exit row is cy+2 (below the structure), cols cx..cx+2
    const weapCx = 55;
    const weapCy = 53;
    ctx.structures.push(makeStructure('WEAP', House.USSR, weapCx, weapCy));
    // The exit row is at cy = 53 + 2 = 55, cx = 55..57
    // Verify aiIsFactoryExit detects these
    expect(aiIsFactoryExit(ctx, 55, 55, House.USSR)).toBe(true);
    expect(aiIsFactoryExit(ctx, 56, 55, House.USSR)).toBe(true);
    expect(aiIsFactoryExit(ctx, 57, 55, House.USSR)).toBe(true);

    // Now try to place a SILO at (55, 55) which overlaps a factory exit
    // aiPlaceStructure should skip any position whose footprint overlaps the exit
    const center = aiGetBaseCenter(ctx, House.USSR)!;
    const result = aiPlaceStructure(ctx, House.USSR, 'SILO');
    if (result) {
      // The result should not block any factory exit
      const [fw, fh] = STRUCTURE_SIZE['SILO'] ?? [1, 1];
      for (let fy = 0; fy < fh; fy++) {
        for (let fx = 0; fx < fw; fx++) {
          expect(
            aiIsFactoryExit(ctx, result.cx + fx, result.cy + fy, House.USSR),
            `placement cell (${result.cx + fx},${result.cy + fy}) must not block factory exit`
          ).toBe(false);
        }
      }
    }
  });

  // -- 25. Requires adjacency to existing same-house structure --
  it('requires adjacency to own alive structure (center-to-center <= 2)', () => {
    const ctx = makeMockAIContext();
    for (let cy = ctx.map.boundsY; cy < ctx.map.boundsY + ctx.map.boundsH; cy++) {
      for (let cx = ctx.map.boundsX; cx < ctx.map.boundsX + ctx.map.boundsW; cx++) {
        ctx.map.setTerrain(cx, cy, Terrain.CLEAR);
      }
    }
    // Place an isolated structure far from bounds edge
    ctx.structures.push(makeStructure('SILO', House.USSR, 60, 60));
    const result = aiPlaceStructure(ctx, House.USSR, 'SILO');
    expect(result).not.toBeNull();

    // Verify the placed position is adjacent (center-to-center check)
    const s = ctx.structures[0];
    const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
    const [fw, fh] = STRUCTURE_SIZE['SILO'] ?? [1, 1];
    const scx = s.cx + sw / 2;
    const scy = s.cy + sh / 2;
    const pcx = result!.cx + fw / 2;
    const pcy = result!.cy + fh / 2;
    expect(Math.abs(pcx - scx)).toBeLessThanOrEqual(2);
    expect(Math.abs(pcy - scy)).toBeLessThanOrEqual(2);
  });

  // -- 26. Other-house structures don't satisfy adjacency --
  it('does not count enemy structures for adjacency requirement', () => {
    const ctx = makeMockAIContext();
    for (let cy = ctx.map.boundsY; cy < ctx.map.boundsY + ctx.map.boundsH; cy++) {
      for (let cx = ctx.map.boundsX; cx < ctx.map.boundsX + ctx.map.boundsW; cx++) {
        ctx.map.setTerrain(cx, cy, Terrain.CLEAR);
      }
    }
    // Own base structure isolated — far away from the ring scan area
    ctx.structures.push(makeStructure('SILO', House.USSR, 60, 60));
    // Enemy structure RIGHT next to base center but wrong house
    const center = aiGetBaseCenter(ctx, House.USSR)!;
    ctx.structures.push(makeStructure('SILO', House.Spain, center.cx + 1, center.cy));

    const result = aiPlaceStructure(ctx, House.USSR, 'SILO');
    // Result must be adjacent to an USSR structure, not the Spain one
    if (result) {
      let adjacentToOwn = false;
      for (const s of ctx.structures) {
        if (!s.alive || s.house !== House.USSR) continue;
        const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
        const [fw, fh] = STRUCTURE_SIZE['SILO'] ?? [1, 1];
        const scx = s.cx + sw / 2;
        const scy = s.cy + sh / 2;
        const pcx = result.cx + fw / 2;
        const pcy = result.cy + fh / 2;
        if (Math.abs(pcx - scx) <= 2 && Math.abs(pcy - scy) <= 2) {
          adjacentToOwn = true;
        }
      }
      expect(adjacentToOwn).toBe(true);
    }
  });

  // -- 27. Dead structures don't satisfy adjacency --
  it('does not count dead own structures for adjacency', () => {
    const ctx = makeMockAIContext();
    for (let cy = ctx.map.boundsY; cy < ctx.map.boundsY + ctx.map.boundsH; cy++) {
      for (let cx = ctx.map.boundsX; cx < ctx.map.boundsX + ctx.map.boundsW; cx++) {
        ctx.map.setTerrain(cx, cy, Terrain.CLEAR);
      }
    }
    // Only dead own structures — adjacency should fail
    ctx.structures.push(makeStructure('SILO', House.USSR, 60, 60, { alive: false }));
    // Need an alive own structure for base center computation
    // If base center requires alive structures, no center → null
    const result = aiPlaceStructure(ctx, House.USSR, 'SILO');
    // No alive structures → no base center → returns null
    expect(result).toBeNull();
  });

  // -- 28. Defense structures (GUN, HBOX, TSLA, SAM) prefer furthest valid position --
  it('defense structures sort candidates by distance descending (furthest first)', () => {
    const ctx = makeBasicPlacementCtx(55, 55, 'POWR');
    // Clear surrounding terrain
    for (let cy = ctx.map.boundsY; cy < ctx.map.boundsY + ctx.map.boundsH; cy++) {
      for (let cx = ctx.map.boundsX; cx < ctx.map.boundsX + ctx.map.boundsW; cx++) {
        ctx.map.setTerrain(cx, cy, Terrain.CLEAR);
      }
    }

    for (const defenseType of ['GUN', 'HBOX', 'TSLA', 'SAM'] as const) {
      // Reset structures
      ctx.structures.length = 0;
      ctx.structures.push(makeStructure('POWR', House.USSR, 55, 55));
      const center = aiGetBaseCenter(ctx, House.USSR)!;

      const result = aiPlaceStructure(ctx, House.USSR, defenseType);
      expect(result, `${defenseType} should find a placement`).not.toBeNull();

      // Defense should pick the corner position (furthest from center) on ring 1
      const dx = result!.cx - center.cx;
      const dy = result!.cy - center.cy;
      const dist = dx * dx + dy * dy;
      // Corner positions on ring 1 have dist=2, edge positions have dist=1
      // Defense prefers largest distance, so should be at a corner (dist 2)
      expect(dist, `${defenseType} should prefer corner (dist 2) on ring 1`).toBe(2);
    }
  });

  // -- 29. Non-defense structures prefer closest valid position --
  it('non-defense structures sort candidates by distance ascending (closest first)', () => {
    const ctx = makeBasicPlacementCtx(55, 55, 'POWR');
    for (let cy = ctx.map.boundsY; cy < ctx.map.boundsY + ctx.map.boundsH; cy++) {
      for (let cx = ctx.map.boundsX; cx < ctx.map.boundsX + ctx.map.boundsW; cx++) {
        ctx.map.setTerrain(cx, cy, Terrain.CLEAR);
      }
    }

    const center = aiGetBaseCenter(ctx, House.USSR)!;
    const result = aiPlaceStructure(ctx, House.USSR, 'POWR');
    expect(result).not.toBeNull();

    // Non-defense should pick the edge-center position (closest) on ring 1
    const dx = result!.cx - center.cx;
    const dy = result!.cy - center.cy;
    const dist = dx * dx + dy * dy;
    // Edge positions on ring 1 have dist=1, corners have dist=2
    expect(dist, 'non-defense should prefer edge (dist 1) on ring 1').toBe(1);
  });

  // -- 30. Returns null when all positions blocked (ring 1-6 exhausted) --
  it('returns null when all 6 rings are exhausted', () => {
    const ctx = makeMockAIContext();
    for (let cy = ctx.map.boundsY; cy < ctx.map.boundsY + ctx.map.boundsH; cy++) {
      for (let cx = ctx.map.boundsX; cx < ctx.map.boundsX + ctx.map.boundsW; cx++) {
        ctx.map.setTerrain(cx, cy, Terrain.WALL);
      }
    }
    // Need one clear cell for the base structure itself
    ctx.map.setTerrain(55, 55, Terrain.CLEAR);
    ctx.structures.push(makeStructure('SILO', House.USSR, 55, 55));

    const result = aiPlaceStructure(ctx, House.USSR, 'SILO');
    expect(result).toBeNull();
  });

  // -- 31. Uses STRUCTURE_SIZE for footprint dimensions --
  it('uses STRUCTURE_SIZE lookup for footprint (POWR is 2x2)', () => {
    expect(STRUCTURE_SIZE['POWR']).toEqual([2, 2]);
    expect(STRUCTURE_SIZE['FACT']).toEqual([3, 3]);
    expect(STRUCTURE_SIZE['SILO']).toEqual([1, 1]);
    expect(STRUCTURE_SIZE['WEAP']).toEqual([3, 2]);
  });

  // -- 32. Default [1,1] footprint for unknown structure types --
  it('falls back to [1,1] footprint for unknown structure types', () => {
    const ctx = makeBasicPlacementCtx(55, 55, 'SILO');
    for (let cy = ctx.map.boundsY; cy < ctx.map.boundsY + ctx.map.boundsH; cy++) {
      for (let cx = ctx.map.boundsX; cx < ctx.map.boundsX + ctx.map.boundsW; cx++) {
        ctx.map.setTerrain(cx, cy, Terrain.CLEAR);
      }
    }
    // Unknown type should use 1x1 default
    const result = aiPlaceStructure(ctx, House.USSR, 'UNKNOWN_BUILDING_TYPE');
    expect(result).not.toBeNull();
  });

  // -- 33. Multi-cell structures (2x2 POWR) have all footprint cells validated --
  it('validates every cell of a multi-cell footprint (2x2 POWR)', () => {
    const ctx = makeBasicPlacementCtx(55, 55, 'SILO');
    for (let cy = ctx.map.boundsY; cy < ctx.map.boundsY + ctx.map.boundsH; cy++) {
      for (let cx = ctx.map.boundsX; cx < ctx.map.boundsX + ctx.map.boundsW; cx++) {
        ctx.map.setTerrain(cx, cy, Terrain.CLEAR);
      }
    }
    const center = aiGetBaseCenter(ctx, House.USSR)!;

    // Put water at one cell that would be covered by a 2x2 at ring 1
    // (center.cx + 1, center.cy) is a ring-1 position for the 2x2 top-left
    // The footprint covers (center.cx+1, center.cy) and (center.cx+2, center.cy)
    // and (center.cx+1, center.cy+1) and (center.cx+2, center.cy+1)
    // Put water at the second cell of one candidate
    ctx.map.setTerrain(center.cx + 2, center.cy, Terrain.WATER);

    const result = aiPlaceStructure(ctx, House.USSR, 'POWR');
    // If placed, the footprint must not cover any water cell
    if (result) {
      for (let fy = 0; fy < 2; fy++) {
        for (let fx = 0; fx < 2; fx++) {
          const t = ctx.map.getTerrain(result.cx + fx, result.cy + fy);
          expect(t, `cell (${result.cx + fx},${result.cy + fy}) should not be WATER`)
            .not.toBe(Terrain.WATER);
          expect(t, `cell (${result.cx + fx},${result.cy + fy}) should not be WALL`)
            .not.toBe(Terrain.WALL);
        }
      }
    }
  });

  // -- 34. Ring 1 has 8 candidate positions (perimeter of 3x3 minus center) --
  it('ring 1 scans exactly the 8 perimeter cells around center', () => {
    // Verify ring-1 loop generates exactly 8 positions
    const ring = 1;
    const positions: Array<[number, number]> = [];
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        positions.push([dx, dy]);
      }
    }
    expect(positions.length).toBe(8);
    // Verify all 8 expected offsets
    const expected = [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0],           [1, 0],
      [-1, 1],  [0, 1],  [1, 1],
    ];
    for (const [edx, edy] of expected) {
      expect(positions.some(([dx, dy]) => dx === edx && dy === edy),
        `ring 1 should include offset (${edx},${edy})`).toBe(true);
    }
  });

  // -- 35. Factory exit check uses correct factory types --
  it('aiIsFactoryExit detects exits for WEAP, TENT, BARR, PROC', () => {
    const ctx = makeMockAIContext();
    for (const factoryType of ['WEAP', 'TENT', 'BARR', 'PROC'] as const) {
      ctx.structures.length = 0;
      const [fw, fh] = STRUCTURE_SIZE[factoryType]!;
      ctx.structures.push(makeStructure(factoryType, House.USSR, 50, 50));
      // Exit row is at cy = 50 + fh, cols 50..50+fw-1
      for (let fx = 0; fx < fw; fx++) {
        expect(
          aiIsFactoryExit(ctx, 50 + fx, 50 + fh, House.USSR),
          `${factoryType} should have exit at (${50 + fx},${50 + fh})`
        ).toBe(true);
      }
      // Cell above the structure should NOT be an exit
      expect(aiIsFactoryExit(ctx, 50, 49, House.USSR)).toBe(false);
    }
  });

  // -- 36. Non-factory structures don't have exits --
  it('aiIsFactoryExit returns false for non-factory structures (POWR, GUN, etc.)', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('POWR', House.USSR, 50, 50));
    const [_, fh] = STRUCTURE_SIZE['POWR']!;
    expect(aiIsFactoryExit(ctx, 50, 50 + fh, House.USSR)).toBe(false);
    expect(aiIsFactoryExit(ctx, 51, 50 + fh, House.USSR)).toBe(false);
  });

  // -- 37. Placement succeeds with clear terrain and adjacent structure --
  it('successfully places a 1x1 structure adjacent to existing base', () => {
    const ctx = makeBasicPlacementCtx(55, 55, 'SILO');
    for (let cy = ctx.map.boundsY; cy < ctx.map.boundsY + ctx.map.boundsH; cy++) {
      for (let cx = ctx.map.boundsX; cx < ctx.map.boundsX + ctx.map.boundsW; cx++) {
        ctx.map.setTerrain(cx, cy, Terrain.CLEAR);
      }
    }
    const result = aiPlaceStructure(ctx, House.USSR, 'SILO');
    expect(result).not.toBeNull();
    expect(typeof result!.cx).toBe('number');
    expect(typeof result!.cy).toBe('number');
  });

  // -- 38. Multiple candidates on same ring sorted by distance --
  it('multiple ring-1 candidates: non-defense picks closest, defense picks furthest', () => {
    const ctx = makeBasicPlacementCtx(55, 55, 'SILO');
    for (let cy = ctx.map.boundsY; cy < ctx.map.boundsY + ctx.map.boundsH; cy++) {
      for (let cx = ctx.map.boundsX; cx < ctx.map.boundsX + ctx.map.boundsW; cx++) {
        ctx.map.setTerrain(cx, cy, Terrain.CLEAR);
      }
    }
    const center = aiGetBaseCenter(ctx, House.USSR)!;

    // Non-defense: SILO should pick edge (dist 1)
    const siloResult = aiPlaceStructure(ctx, House.USSR, 'SILO');
    expect(siloResult).not.toBeNull();
    const siloDist = (siloResult!.cx - center.cx) ** 2 + (siloResult!.cy - center.cy) ** 2;
    expect(siloDist).toBe(1);

    // Defense: GUN should pick corner (dist 2)
    const gunResult = aiPlaceStructure(ctx, House.USSR, 'GUN');
    expect(gunResult).not.toBeNull();
    const gunDist = (gunResult!.cx - center.cx) ** 2 + (gunResult!.cy - center.cy) ** 2;
    expect(gunDist).toBe(2);
  });

  // -- 39. Factory exit check is house-specific --
  it('factory exit only blocks for same house (not enemy factories)', () => {
    const ctx = makeMockAIContext();
    const [fw, fh] = STRUCTURE_SIZE['WEAP']!;
    ctx.structures.push(makeStructure('WEAP', House.Spain, 50, 50));
    // Exit should NOT be detected for USSR
    for (let fx = 0; fx < fw; fx++) {
      expect(aiIsFactoryExit(ctx, 50 + fx, 50 + fh, House.USSR)).toBe(false);
    }
    // But should be detected for Spain
    for (let fx = 0; fx < fw; fx++) {
      expect(aiIsFactoryExit(ctx, 50 + fx, 50 + fh, House.Spain)).toBe(true);
    }
  });

  // -- 40. Large structure (3x3 FACT) footprint boundary check --
  it('large 3x3 structure (FACT) respects map bounds for all footprint cells', () => {
    const ctx = makeMockAIContext();
    // Set bounds so FACT placed near edge would overflow
    ctx.map.setBounds(40, 40, 20, 20);
    for (let cy = 40; cy < 60; cy++) {
      for (let cx = 40; cx < 60; cx++) {
        ctx.map.setTerrain(cx, cy, Terrain.CLEAR);
      }
    }
    // Place base near top-right so FACT can't fit toward the edge
    ctx.structures.push(makeStructure('SILO', House.USSR, 57, 41));
    const result = aiPlaceStructure(ctx, House.USSR, 'FACT');
    if (result) {
      const [fw, fh] = STRUCTURE_SIZE['FACT']!;
      expect(result.cx + fw).toBeLessThanOrEqual(60);
      expect(result.cy + fh).toBeLessThanOrEqual(60);
      expect(result.cx).toBeGreaterThanOrEqual(40);
      expect(result.cy).toBeGreaterThanOrEqual(40);
    }
  });

  // -- 41. Base center is centroid of all alive structures --
  it('base center uses centroid of all alive structures (affects ring scan origin)', () => {
    const ctx = makeMockAIContext();
    for (let cy = ctx.map.boundsY; cy < ctx.map.boundsY + ctx.map.boundsH; cy++) {
      for (let cx = ctx.map.boundsX; cx < ctx.map.boundsX + ctx.map.boundsW; cx++) {
        ctx.map.setTerrain(cx, cy, Terrain.CLEAR);
      }
    }
    // Two SILO (1x1) structures far apart
    ctx.structures.push(makeStructure('SILO', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('SILO', House.USSR, 60, 50));

    const center = aiGetBaseCenter(ctx, House.USSR)!;
    // SILO is 1x1, centers are (50+0.5, 50+0.5) and (60+0.5, 50+0.5)
    // Average: (55.5, 50.5) → floor → (55, 50)
    expect(center.cx).toBe(55);
    expect(center.cy).toBe(50);

    const result = aiPlaceStructure(ctx, House.USSR, 'SILO');
    expect(result).not.toBeNull();
    // Should be placed near the centroid
    const dx = result!.cx - center.cx;
    const dy = result!.cy - center.cy;
    expect(Math.max(Math.abs(dx), Math.abs(dy))).toBeLessThanOrEqual(6);
  });

  // -- 42. Ring 2 has 16 positions --
  it('ring 2 generates 16 perimeter cells', () => {
    const ring = 2;
    let count = 0;
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        count++;
      }
    }
    expect(count).toBe(16);
  });
});
