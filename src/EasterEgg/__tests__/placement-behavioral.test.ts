/**
 * Behavioral tests for placement.ts — placeStructure and deployMCV.
 * Calls exported functions directly with mock contexts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnitType, House, Mission, CELL_SIZE,
  type ProductionItem,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap, Terrain } from '../engine/map';
import { STRUCTURE_SIZE, STRUCTURE_MAX_HP } from '../engine/scenario';
import type { MapStructure } from '../engine/scenario';
import type { Effect } from '../engine/renderer';
import {
  type PlacementContext,
  placeStructure,
  deployMCV,
} from '../engine/placement';

beforeEach(() => resetEntityIds());

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeMap(): GameMap {
  const m = new GameMap();
  m.setBounds(0, 0, 128, 128);
  return m;
}

function makeStructure(
  type: string, house: House, cx = 10, cy = 10,
  opts: Partial<MapStructure> = {},
): MapStructure {
  const maxHp = opts.maxHp ?? STRUCTURE_MAX_HP[type] ?? 256;
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: opts.hp ?? maxHp,
    maxHp,
    alive: opts.alive ?? true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
  };
}

function makePlacementCtx(overrides: Partial<PlacementContext> = {}): PlacementContext {
  return {
    structures: [],
    entities: [],
    entityById: new Map(),
    credits: 5000,
    tick: 100,
    playerHouse: House.Greece,
    pendingPlacement: null,
    wallPlacementPrepaid: false,
    cachedAvailableItems: null,
    evaMessages: [],
    effects: [],
    map: makeMap(),
    isAllied: (a, b) => a === b,
    playSound: vi.fn(),
    getAvailableItems: () => [],
    findPassableSpawn: (cx, cy) => ({ cx, cy }),
    ...overrides,
  };
}

function wallItem(type: string = 'BRIK', cost: number = 25): ProductionItem {
  return { type, name: type, cost, buildTime: 10, prerequisites: [], icon: type.toLowerCase(), side: 'allied' };
}

function structItem(type: string = 'POWR', cost: number = 300): ProductionItem {
  return { type, name: type, cost, buildTime: 60, prerequisites: [], icon: type.toLowerCase(), side: 'allied' };
}

// ═══════════════════════════════════════════════════════════════════════════
// placeStructure
// ═══════════════════════════════════════════════════════════════════════════

describe('placeStructure', () => {
  it('returns false if no pendingPlacement', () => {
    const ctx = makePlacementCtx();
    expect(placeStructure(ctx, 5, 5)).toBe(false);
    expect(ctx.structures).toHaveLength(0);
  });

  it('successfully places a structure at valid coordinates adjacent to existing structure', () => {
    // Need an existing allied structure for adjacency check
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const item = structItem('POWR', 300);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: item,
    });

    // Place POWR (2x2) adjacent to FACT (3x3 at 10,10 → occupies 10-12, 10-12)
    // Adjacent means within 1 cell of footprint. Try (13, 10): just right of FACT.
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(true);
    expect(ctx.structures).toHaveLength(2);
    expect(ctx.structures[1].type).toBe('POWR');
    expect(ctx.structures[1].cx).toBe(13);
    expect(ctx.structures[1].cy).toBe(10);
    expect(ctx.structures[1].alive).toBe(true);
  });

  it('assigns playerHouse to newly placed structure', () => {
    const existing = makeStructure('FACT', House.Spain, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
      playerHouse: House.Spain,
      isAllied: (a, b) => a === b,
    });

    placeStructure(ctx, 13, 10);
    expect(ctx.structures[1].house).toBe(House.Spain);
  });

  it('clears pendingPlacement after non-wall placement', () => {
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const item = structItem('POWR');
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: item,
    });

    placeStructure(ctx, 13, 10);
    expect(ctx.pendingPlacement).toBeNull();
  });

  it('keeps pendingPlacement for wall placement (allows chain-placing)', () => {
    const item = wallItem('BRIK', 25);
    const ctx = makePlacementCtx({
      pendingPlacement: item,
      credits: 500,
    });

    placeStructure(ctx, 5, 5);
    // Walls don't clear pendingPlacement — player can keep placing
    expect(ctx.pendingPlacement).not.toBeNull();
    expect(ctx.pendingPlacement!.type).toBe('BRIK');
  });

  it('deducts credits for wall types when wallPlacementPrepaid is false', () => {
    const item = wallItem('SBAG', 25);
    const ctx = makePlacementCtx({
      pendingPlacement: item,
      wallPlacementPrepaid: false,
      credits: 500,
    });

    const creditsBefore = ctx.credits;
    placeStructure(ctx, 5, 5);
    expect(ctx.credits).toBeLessThan(creditsBefore);
  });

  it('does not deduct credits for walls when wallPlacementPrepaid is true', () => {
    const item = wallItem('FENC', 25);
    const ctx = makePlacementCtx({
      pendingPlacement: item,
      wallPlacementPrepaid: true,
      credits: 500,
    });

    const creditsBefore = ctx.credits;
    placeStructure(ctx, 5, 5);
    // First wall was prepaid — no deduction
    expect(ctx.credits).toBe(creditsBefore);
    // But wallPlacementPrepaid is now false for subsequent placements
    expect(ctx.wallPlacementPrepaid).toBe(false);
  });

  it('wall types SBAG, FENC, BARB, BRIK all behave as walls', () => {
    for (const wallType of ['SBAG', 'FENC', 'BARB', 'BRIK']) {
      const item = wallItem(wallType, 25);
      const ctx = makePlacementCtx({
        pendingPlacement: item,
        credits: 500,
      });

      placeStructure(ctx, 5, 5);
      // Walls keep pendingPlacement
      expect(ctx.pendingPlacement).not.toBeNull();
    }
  });

  it('fails if target cells are not passable', () => {
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    // Block the target cells
    ctx.map.setTerrain(13, 10, Terrain.ROCK);

    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
    // Only the existing structure should be present
    expect(ctx.structures).toHaveLength(1);
  });

  it('fails for non-wall structure if not adjacent to existing player structure', () => {
    // No existing structures — can't place non-wall
    const ctx = makePlacementCtx({
      pendingPlacement: structItem('POWR'),
    });

    const result = placeStructure(ctx, 50, 50);
    expect(result).toBe(false);
  });

  it('marks placed cells as impassable (WALL terrain)', () => {
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });

    // POWR is 2x2
    expect(ctx.map.isPassable(13, 10)).toBe(true);
    expect(ctx.map.isPassable(14, 10)).toBe(true);
    placeStructure(ctx, 13, 10);
    expect(ctx.map.getTerrain(13, 10)).toBe(Terrain.WALL);
    expect(ctx.map.getTerrain(14, 10)).toBe(Terrain.WALL);
    expect(ctx.map.getTerrain(13, 11)).toBe(Terrain.WALL);
    expect(ctx.map.getTerrain(14, 11)).toBe(Terrain.WALL);
  });

  it('spawns a harvester when placing PROC (refinery)', () => {
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('PROC', 2000),
    });

    placeStructure(ctx, 13, 10);
    // Should have spawned a harvester entity
    expect(ctx.entities).toHaveLength(1);
    expect(ctx.entities[0].type).toBe(UnitType.V_HARV);
    expect(ctx.entities[0].house).toBe(House.Greece);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// deployMCV
// ═══════════════════════════════════════════════════════════════════════════

describe('deployMCV', () => {
  it('successfully deploys MCV into FACT structure', () => {
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();

    const result = deployMCV(ctx, mcv);
    expect(result).toBe(true);
  });

  it('adds FACT structure to structures array', () => {
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();

    deployMCV(ctx, mcv);
    expect(ctx.structures).toHaveLength(1);
    expect(ctx.structures[0].type).toBe('FACT');
    expect(ctx.structures[0].alive).toBe(true);
    expect(ctx.structures[0].house).toBe(House.Greece);
  });

  it('kills the MCV entity after deployment', () => {
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();

    deployMCV(ctx, mcv);
    expect(mcv.alive).toBe(false);
    expect(mcv.mission).toBe(Mission.DIE);
  });

  it('fails if entity is not an MCV', () => {
    const jeep = new Entity(UnitType.V_JEEP, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();

    const result = deployMCV(ctx, jeep);
    expect(result).toBe(false);
    expect(ctx.structures).toHaveLength(0);
  });

  it('fails if the 3x3 area is not passable', () => {
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();
    // Block one cell in the 3x3 area around MCV cell (50,50) → checks (49-51, 49-51)
    ctx.map.setTerrain(49, 49, Terrain.ROCK);

    const result = deployMCV(ctx, mcv);
    expect(result).toBe(false);
    expect(ctx.structures).toHaveLength(0);
    // MCV should remain alive
    expect(mcv.alive).toBe(true);
  });

  it('marks 3x3 footprint as impassable after deployment', () => {
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();

    deployMCV(ctx, mcv);
    // MCV at cell (50,50) → FACT placed at (49,49) with 3x3 footprint
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        expect(ctx.map.getTerrain(49 + dx, 49 + dy)).toBe(Terrain.WALL);
      }
    }
  });

  it('adds explosion effect at MCV position', () => {
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();

    deployMCV(ctx, mcv);
    expect(ctx.effects).toHaveLength(1);
    expect(ctx.effects[0].type).toBe('explosion');
    expect(ctx.effects[0].x).toBe(mcv.pos.x);
    expect(ctx.effects[0].y).toBe(mcv.pos.y);
  });
});
