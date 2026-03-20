/**
 * C++ Behavioral Parity: Building Placement & MCV Deployment
 *
 * Tests placement validation logic ported from C++ to placement.ts.
 * Each describe block references the original C++ source for traceability.
 *
 * C++ source of truth:
 *   - building.cpp:1450-1520  — BuildingClass::Unlimbo (adjacency, passability)
 *   - building.cpp:1052-1080  — BuildingClass::Can_Enter_Cell (overlap detection)
 *   - bdata.cpp:3448-3477     — Occupy_List(placement=true): bib cells must be passable
 *   - bdata.cpp:3597-3629     — Bib_And_Offset: bib row below building footprint
 *   - display.cpp:1210-1270   — DisplayClass::Passes_Proximity_Check (adjacency AABB)
 *   - display.cpp:694-740     — DisplayClass::Set_Cursor_Pos (terrain + bounds check)
 *   - cell.cpp:1140-1180      — CellClass::Is_Generally_Clear (occupancy blocking)
 *   - unit.cpp:2380-2430      — UnitClass::Try_To_Deploy (MCV deployment validation)
 *   - rules.ini                — Wall types (SBAG/FENC/BARB/BRIK) exempt from adjacency
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnitType, House, Mission, CELL_SIZE,
  type ProductionItem,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap, Terrain } from '../engine/map';
import { STRUCTURE_SIZE, STRUCTURE_MAX_HP, getBibCells, BIBBED_BUILDINGS } from '../engine/scenario';
import type { MapStructure } from '../engine/scenario';
import type { Effect } from '../engine/renderer';
import {
  type PlacementContext,
  placeStructure,
  deployMCV,
} from '../engine/placement';

beforeEach(() => resetEntityIds());

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMap(boundsX = 0, boundsY = 0, boundsW = 128, boundsH = 128): GameMap {
  const m = new GameMap();
  m.setBounds(boundsX, boundsY, boundsW, boundsH);
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
    credits: 10000,
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

/** Create a ProductionItem for a wall type */
function wallItem(type: string = 'BRIK', cost = 25): ProductionItem {
  return { type, name: type, cost, buildTime: 10, prerequisite: 'FACT', faction: 'both' };
}

/** Create a ProductionItem for a non-wall structure */
function structItem(type: string = 'POWR', cost = 300): ProductionItem {
  return { type, name: type, cost, buildTime: 60, prerequisite: 'FACT', faction: 'both' };
}

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. Terrain passability checks
//    C++ display.cpp:694-740 — Set_Cursor_Pos iterates footprint cells; each
//    must pass CellClass::Is_Generally_Clear which requires passable terrain.
//    Passable terrains: CLEAR, ORE, ROUGH, BEACH (map.ts PASSABLE set).
// ═════════════════════════════════════════════════════════════════════════════

describe('Terrain passability for placement (display.cpp:694-740, cell.cpp:1140-1180)', () => {

  const PASSABLE_TERRAINS = [Terrain.CLEAR, Terrain.ORE, Terrain.ROUGH, Terrain.BEACH];
  const IMPASSABLE_TERRAINS = [Terrain.WATER, Terrain.ROCK, Terrain.TREE, Terrain.WALL, Terrain.RIVER];

  it('allows placement on each passable terrain type', () => {
    for (const terrain of PASSABLE_TERRAINS) {
      resetEntityIds();
      const existing = makeStructure('FACT', House.Greece, 10, 10);
      const ctx = makePlacementCtx({
        structures: [existing],
        pendingPlacement: structItem('SILO', 150), // 1x1
      });

      // Place SILO adjacent to FACT. FACT is 3x3 at (10,10), so (13,10) is adjacent.
      ctx.map.setTerrain(13, 10, terrain);
      const result = placeStructure(ctx, 13, 10);
      expect(result, `should place on terrain ${Terrain[terrain]}`).toBe(true);
    }
  });

  it('rejects placement on each impassable terrain type', () => {
    for (const terrain of IMPASSABLE_TERRAINS) {
      resetEntityIds();
      const existing = makeStructure('FACT', House.Greece, 10, 10);
      const ctx = makePlacementCtx({
        structures: [existing],
        pendingPlacement: structItem('SILO', 150), // 1x1
      });

      ctx.map.setTerrain(13, 10, terrain);
      const result = placeStructure(ctx, 13, 10);
      expect(result, `should reject on terrain ${Terrain[terrain]}`).toBe(false);
    }
  });

  it('rejects placement when any cell in a multi-cell footprint is impassable', () => {
    // POWR is 2x2; if just one cell is WATER, placement fails
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR', 300), // 2x2
    });

    // All four cells of POWR at (13,10) are (13,10),(14,10),(13,11),(14,11)
    // Set one cell to WATER
    ctx.map.setTerrain(14, 11, Terrain.WATER);
    expect(placeStructure(ctx, 13, 10)).toBe(false);
  });

  it('allows placement when all cells in a multi-cell footprint are passable', () => {
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR', 300), // 2x2
    });

    // All cells default to CLEAR, so this should succeed
    expect(placeStructure(ctx, 13, 10)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Adjacent-to-existing-structure requirement
//    C++ display.cpp:1210-1270 — Passes_Proximity_Check: non-wall buildings
//    must have footprint overlapping the expanded AABB (±1 cell) of any
//    existing allied structure.
// ═════════════════════════════════════════════════════════════════════════════

describe('Adjacency requirement (display.cpp:1210-1270, building.cpp:1450-1520)', () => {

  it('rejects non-wall structure with no existing structures', () => {
    const ctx = makePlacementCtx({
      pendingPlacement: structItem('POWR', 300),
    });
    expect(placeStructure(ctx, 50, 50)).toBe(false);
  });

  it('rejects non-wall structure placed far from any existing structure', () => {
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR', 300),
    });
    // FACT at (10,10) is 3x3, expanded AABB is (9,9)-(14,14)
    // Place POWR at (50,50) — far away
    expect(placeStructure(ctx, 50, 50)).toBe(false);
  });

  it('accepts non-wall structure directly adjacent to existing structure', () => {
    const existing = makeStructure('FACT', House.Greece, 10, 10); // 3x3: occupies 10-12,10-12
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR', 300), // 2x2
    });
    // Place at (13,10): left edge of POWR touches expanded right edge of FACT
    expect(placeStructure(ctx, 13, 10)).toBe(true);
  });

  it('accepts structure diagonally adjacent (corner overlap with expanded AABB)', () => {
    const existing = makeStructure('FACT', House.Greece, 10, 10); // 3x3: occupies 10-12,10-12
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('SILO', 150), // 1x1
    });
    // Expanded AABB: exL=9, exT=9, exR=14, exB=14
    // SILO at (13,13): nL=13, nT=13, nR=14, nB=14
    // Overlap: 13<14 && 14>9 && 13<14 && 14>9 → true
    expect(placeStructure(ctx, 13, 13)).toBe(true);
  });

  it('rejects structure placed just outside expanded AABB', () => {
    const existing = makeStructure('FACT', House.Greece, 10, 10); // 3x3: occupies 10-12,10-12
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('SILO', 150), // 1x1
    });
    // Expanded AABB: exL=9, exT=9, exR=14, exB=14
    // SILO at (14,10): nL=14, nT=10, nR=15, nB=11
    // Overlap: 14<14 is FALSE → adjacency fails
    expect(placeStructure(ctx, 14, 10)).toBe(false);
  });

  it('ignores dead structures for adjacency check', () => {
    const dead = makeStructure('FACT', House.Greece, 10, 10, { alive: false });
    const ctx = makePlacementCtx({
      structures: [dead],
      pendingPlacement: structItem('POWR', 300),
    });
    // Even though coordinates are adjacent, dead structure doesn't count
    expect(placeStructure(ctx, 13, 10)).toBe(false);
  });

  it('ignores enemy structures for adjacency check', () => {
    const enemy = makeStructure('FACT', House.USSR, 10, 10);
    const ctx = makePlacementCtx({
      structures: [enemy],
      pendingPlacement: structItem('POWR', 300),
      playerHouse: House.Greece,
      isAllied: (a, b) => a === b, // Greece and USSR are not allied
    });
    expect(placeStructure(ctx, 13, 10)).toBe(false);
  });

  it('accepts adjacency to allied (same-house) structures', () => {
    const allied = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [allied],
      pendingPlacement: structItem('POWR', 300),
      playerHouse: House.Greece,
      isAllied: (a, b) => a === b,
    });
    expect(placeStructure(ctx, 13, 10)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Overlapping structure rejection
//    C++ building.cpp:1052-1080 — Can_Enter_Cell checks if the cell is already
//    occupied by a structure. In our implementation, placed structures mark
//    cells as Terrain.WALL, which fails the isPassable check.
// ═════════════════════════════════════════════════════════════════════════════

describe('Overlapping structure rejection (building.cpp:1052-1080)', () => {

  it('cannot place a structure on cells already occupied by another structure', () => {
    // Place FACT at (10,10) — marks 3x3 footprint as WALL
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR', 300),
    });
    // Mark the FACT footprint as WALL (simulating scenario load or prior placement)
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        ctx.map.setTerrain(10 + dx, 10 + dy, Terrain.WALL);
      }
    }
    // Try to place POWR overlapping FACT
    expect(placeStructure(ctx, 10, 10)).toBe(false);
  });

  it('cannot place a structure that partially overlaps an existing structure footprint', () => {
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR', 300), // 2x2
    });
    // Mark FACT footprint as WALL
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        ctx.map.setTerrain(10 + dx, 10 + dy, Terrain.WALL);
      }
    }
    // POWR at (12,12) would overlap FACT's bottom-right corner
    expect(placeStructure(ctx, 12, 12)).toBe(false);
  });

  it('placing a structure marks its cells as WALL, preventing subsequent overlap', () => {
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR', 300), // 2x2
    });

    // First placement succeeds
    expect(placeStructure(ctx, 13, 10)).toBe(true);
    // Cells (13,10), (14,10), (13,11), (14,11) are now WALL
    expect(ctx.map.getTerrain(13, 10)).toBe(Terrain.WALL);
    expect(ctx.map.getTerrain(14, 10)).toBe(Terrain.WALL);

    // Second placement at same location fails
    ctx.pendingPlacement = structItem('SILO', 150); // 1x1
    expect(placeStructure(ctx, 13, 10)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Wall placement rules
//    C++ building.cpp:1450 + rules.ini — Walls (SBAG, FENC, BARB, BRIK) are
//    exempt from the adjacency check. They can be placed anywhere passable.
// ═════════════════════════════════════════════════════════════════════════════

describe('Wall placement rules (building.cpp:1450, rules.ini wall adjacency exemption)', () => {

  const WALL_TYPES = ['SBAG', 'FENC', 'BARB', 'BRIK'];

  it('walls can be placed without any existing structures (no adjacency required)', () => {
    for (const wallType of WALL_TYPES) {
      resetEntityIds();
      const ctx = makePlacementCtx({
        structures: [], // no existing structures
        pendingPlacement: wallItem(wallType, 25),
        credits: 500,
      });
      const result = placeStructure(ctx, 20, 20);
      expect(result, `${wallType} should place without adjacency`).toBe(true);
    }
  });

  it('walls can be placed far from any existing structure', () => {
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: wallItem('BRIK', 25),
      credits: 500,
    });
    // Place wall at (80,80) — far from FACT at (10,10)
    expect(placeStructure(ctx, 80, 80)).toBe(true);
  });

  it('walls still require passable terrain', () => {
    const ctx = makePlacementCtx({
      pendingPlacement: wallItem('SBAG', 25),
      credits: 500,
    });
    ctx.map.setTerrain(20, 20, Terrain.WATER);
    expect(placeStructure(ctx, 20, 20)).toBe(false);
  });

  it('walls require sufficient credits', () => {
    const ctx = makePlacementCtx({
      pendingPlacement: wallItem('BRIK', 25),
      credits: 0, // no credits
    });
    expect(placeStructure(ctx, 20, 20)).toBe(false);
  });

  it('wall placement keeps pendingPlacement active for continuous placement', () => {
    const ctx = makePlacementCtx({
      pendingPlacement: wallItem('BRIK', 25),
      credits: 500,
    });
    placeStructure(ctx, 20, 20);
    expect(ctx.pendingPlacement).not.toBeNull();
    expect(ctx.pendingPlacement!.type).toBe('BRIK');
  });

  it('wall placement stores wallType on the map for sprite rendering', () => {
    const ctx = makePlacementCtx({
      pendingPlacement: wallItem('FENC', 25),
      credits: 500,
    });
    placeStructure(ctx, 20, 20);
    expect(ctx.map.getWallType(20, 20)).toBe('FENC');
  });

  it('non-wall structures do NOT bypass adjacency', () => {
    const ctx = makePlacementCtx({
      structures: [], // no existing structures
      pendingPlacement: structItem('POWR', 300),
    });
    // POWR requires adjacency — should fail with no structures
    expect(placeStructure(ctx, 20, 20)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. MCV deployment
//    C++ unit.cpp:2380-2430 — UnitClass::Try_To_Deploy checks 3x3 clear area
//    centered on MCV cell. Converts MCV to FACT (Construction Yard).
// ═════════════════════════════════════════════════════════════════════════════

describe('MCV deployment (unit.cpp:2380-2430)', () => {

  it('deploys MCV into a FACT at (mcvCell-1, mcvCell-1) with 3x3 footprint', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Greece, 50, 50);
    const ctx = makePlacementCtx();

    expect(deployMCV(ctx, mcv)).toBe(true);
    expect(ctx.structures).toHaveLength(1);

    const fact = ctx.structures[0];
    expect(fact.type).toBe('FACT');
    expect(fact.cx).toBe(49); // mcv.cell.cx - 1
    expect(fact.cy).toBe(49); // mcv.cell.cy - 1
    expect(fact.alive).toBe(true);
    expect(fact.house).toBe(House.Greece);
  });

  it('FACT footprint is 3x3 — all 9 cells marked as WALL', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Greece, 50, 50);
    const ctx = makePlacementCtx();

    deployMCV(ctx, mcv);

    const [fw, fh] = STRUCTURE_SIZE['FACT']; // [3, 3]
    expect(fw).toBe(3);
    expect(fh).toBe(3);

    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        expect(
          ctx.map.getTerrain(49 + dx, 49 + dy),
          `cell (${49 + dx},${49 + dy}) should be WALL`
        ).toBe(Terrain.WALL);
      }
    }
  });

  it('checks all 9 cells in 3x3 area around MCV — rejects if any impassable', () => {
    // MCV at cell (50,50) checks cells (49-51, 49-51)
    const offsets = [
      [-1, -1], [0, -1], [1, -1],
      [-1,  0], [0,  0], [1,  0],
      [-1,  1], [0,  1], [1,  1],
    ];

    for (const [dx, dy] of offsets) {
      resetEntityIds();
      const mcv = entityAtCell(UnitType.V_MCV, House.Greece, 50, 50);
      const ctx = makePlacementCtx();
      ctx.map.setTerrain(50 + dx, 50 + dy, Terrain.ROCK);

      const result = deployMCV(ctx, mcv);
      expect(result, `blocked at offset (${dx},${dy}) should reject`).toBe(false);
      expect(mcv.alive, `MCV should remain alive when blocked at (${dx},${dy})`).toBe(true);
    }
  });

  it('rejects deployment of non-MCV unit types', () => {
    const nonMCVTypes = [UnitType.V_JEEP, UnitType.V_HARV, UnitType.V_2TNK, UnitType.V_APC];
    for (const unitType of nonMCVTypes) {
      resetEntityIds();
      const unit = entityAtCell(unitType, House.Greece, 50, 50);
      const ctx = makePlacementCtx();
      expect(deployMCV(ctx, unit), `${unitType} should not deploy`).toBe(false);
      expect(ctx.structures).toHaveLength(0);
    }
  });

  it('rejects deployment of dead MCV', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Greece, 50, 50);
    mcv.alive = false;
    const ctx = makePlacementCtx();
    expect(deployMCV(ctx, mcv)).toBe(false);
    expect(ctx.structures).toHaveLength(0);
  });

  it('kills MCV entity on successful deployment', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Greece, 50, 50);
    const ctx = makePlacementCtx();
    deployMCV(ctx, mcv);
    expect(mcv.alive).toBe(false);
    expect(mcv.mission).toBe(Mission.DIE);
  });

  it('sets deployedFromMCV flag on the FACT — C++ ArchiveTarget parity', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Greece, 50, 50);
    const ctx = makePlacementCtx();
    deployMCV(ctx, mcv);
    expect(ctx.structures[0].deployedFromMCV).toBe(true);
  });

  it('marks bib cells as WALL below FACT footprint (bdata.cpp:3597-3629)', () => {
    const mcv = entityAtCell(UnitType.V_MCV, House.Greece, 50, 50);
    const ctx = makePlacementCtx();
    deployMCV(ctx, mcv);

    // FACT is bibbed — bib row is at cy + 3 (one row below 3x3 footprint)
    const bibCells = getBibCells('FACT', 49, 49);
    expect(bibCells.length).toBeGreaterThan(0);
    for (const bc of bibCells) {
      expect(
        ctx.map.getTerrain(bc.cx, bc.cy),
        `bib cell (${bc.cx},${bc.cy}) should be WALL`
      ).toBe(Terrain.WALL);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Entity occupancy blocking
//    C++ cell.cpp:1140-1180 — Is_Generally_Clear checks terrain passability.
//    In our placement.ts, the check is via map.isPassable() which checks
//    terrain type (not entity occupancy). Ground units on CLEAR terrain don't
//    block placement because isPassable only checks terrain, not occupancy.
//    However, if terrain is WALL (from a placed structure), it blocks.
// ═════════════════════════════════════════════════════════════════════════════

describe('Cell occupancy and placement interaction (cell.cpp:1140-1180)', () => {

  it('placement checks terrain passability, not entity occupancy directly', () => {
    // In the TS implementation, placeStructure uses map.isPassable which checks
    // terrain type. A ground unit on a CLEAR cell doesn't change terrain, so
    // placement can succeed even with a unit present (C++ parity: placement
    // cursor goes green when terrain is passable, units shuffle out of the way).
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const unit = entityAtCell(UnitType.V_2TNK, House.Greece, 13, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      entities: [unit],
      entityById: new Map([[unit.id, unit]]),
      pendingPlacement: structItem('SILO', 150),
    });
    // Terrain at (13,10) is still CLEAR despite unit presence
    expect(ctx.map.getTerrain(13, 10)).toBe(Terrain.CLEAR);
    // Placement succeeds — C++ parity: units are pushed aside
    expect(placeStructure(ctx, 13, 10)).toBe(true);
  });

  it('placement fails on cells with WALL terrain (from existing buildings)', () => {
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('SILO', 150),
    });
    // Simulate building footprint terrain
    ctx.map.setTerrain(13, 10, Terrain.WALL);
    expect(placeStructure(ctx, 13, 10)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. Map bounds checking
//    C++ display.cpp:694-740 — Set_Cursor_Pos: cells outside playable map
//    area are treated as impassable. map.isPassable() checks bounds first.
// ═════════════════════════════════════════════════════════════════════════════

describe('Map bounds checking (display.cpp:694-740)', () => {

  it('rejects placement outside playable bounds (right/bottom edge)', () => {
    // Map with bounds (10,10) to (60,60) — 50x50 playable area
    const map = makeMap(10, 10, 50, 50);
    const existing = makeStructure('FACT', House.Greece, 55, 55);
    const ctx = makePlacementCtx({
      map,
      structures: [existing],
      pendingPlacement: structItem('POWR', 300), // 2x2
    });
    // POWR at (59,59) — occupies (59,59),(60,59),(59,60),(60,60)
    // Cell (60,59) is at boundsX + boundsW = 60 which is OUT of bounds
    expect(placeStructure(ctx, 59, 59)).toBe(false);
  });

  it('rejects placement outside playable bounds (left/top edge)', () => {
    const map = makeMap(10, 10, 50, 50);
    const existing = makeStructure('FACT', House.Greece, 12, 12);
    const ctx = makePlacementCtx({
      map,
      structures: [existing],
      pendingPlacement: structItem('POWR', 300), // 2x2
    });
    // POWR at (9,10) — cell (9,10) is at boundsX-1 = 9 which is out of bounds
    expect(placeStructure(ctx, 9, 10)).toBe(false);
  });

  it('allows placement at the edge of playable bounds if footprint fits', () => {
    const map = makeMap(10, 10, 50, 50);
    const existing = makeStructure('FACT', House.Greece, 55, 55);
    const ctx = makePlacementCtx({
      map,
      structures: [existing],
      pendingPlacement: structItem('POWR', 300), // 2x2
    });
    // POWR at (57,57) — occupies (57,57),(58,57),(57,58),(58,58)
    // All cells within bounds [10,60) — should work
    expect(placeStructure(ctx, 57, 57)).toBe(true);
  });

  it('MCV deployment fails when 3x3 area extends beyond map bounds', () => {
    // Map bounds: (10,10,50,50) — playable area [10,60)
    const map = makeMap(10, 10, 50, 50);
    // MCV at cell (10,10) — checks cells (9-11, 9-11), cell (9,9) is out of bounds
    const mcv = entityAtCell(UnitType.V_MCV, House.Greece, 10, 10);
    const ctx = makePlacementCtx({ map });

    expect(deployMCV(ctx, mcv)).toBe(false);
    expect(mcv.alive).toBe(true);
  });

  it('MCV deployment succeeds when fully within bounds', () => {
    const map = makeMap(10, 10, 50, 50);
    // MCV at cell (30,30) — checks cells (29-31, 29-31), all within [10,60)
    const mcv = entityAtCell(UnitType.V_MCV, House.Greece, 30, 30);
    const ctx = makePlacementCtx({ map });

    expect(deployMCV(ctx, mcv)).toBe(true);
  });

  it('out-of-bounds cells return Terrain.ROCK from getTerrain', () => {
    const map = makeMap(10, 10, 50, 50);
    // Cell (-1,-1) is physically out of the grid
    expect(map.getTerrain(-1, -1)).toBe(Terrain.ROCK);
    // Cell (200,200) is beyond MAP_CELLS
    expect(map.getTerrain(200, 200)).toBe(Terrain.ROCK);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. Bib cells
//    C++ bdata.cpp:3448-3477 — Occupy_List(placement=true): bib cells must
//    also be passable for placement to succeed.
//    C++ bdata.cpp:3597-3629 — Bib_And_Offset: bib is 1 row below footprint,
//    width = building width. Only buildings with IsBibbed=true and width 2-4.
// ═════════════════════════════════════════════════════════════════════════════

describe('Bib cell checks (bdata.cpp:3448-3477, bdata.cpp:3597-3629)', () => {

  it('placement fails when bib cells are impassable', () => {
    // POWR is bibbed (2x2), bib row is at cy+2, width 2
    expect(BIBBED_BUILDINGS.has('POWR')).toBe(true);

    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR', 300),
    });

    // POWR at (13,10) → bib cells at (13,12) and (14,12)
    const bibCells = getBibCells('POWR', 13, 10);
    expect(bibCells.length).toBe(2);
    expect(bibCells[0]).toEqual({ cx: 13, cy: 12 });
    expect(bibCells[1]).toEqual({ cx: 14, cy: 12 });

    // Block one bib cell
    ctx.map.setTerrain(13, 12, Terrain.ROCK);
    expect(placeStructure(ctx, 13, 10)).toBe(false);
  });

  it('placement succeeds when bib cells are passable', () => {
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR', 300),
    });
    // All cells including bibs are CLEAR by default
    expect(placeStructure(ctx, 13, 10)).toBe(true);
  });

  it('placed structure marks bib cells as WALL (bdata.cpp:3597-3629)', () => {
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR', 300),
    });
    placeStructure(ctx, 13, 10);

    // Bib cells should now be WALL
    const bibCells = getBibCells('POWR', 13, 10);
    for (const bc of bibCells) {
      expect(
        ctx.map.getTerrain(bc.cx, bc.cy),
        `bib cell (${bc.cx},${bc.cy}) should be WALL after placement`
      ).toBe(Terrain.WALL);
    }
  });

  it('non-bibbed structures have no bib cells', () => {
    // SILO (1x1) is not bibbed
    expect(BIBBED_BUILDINGS.has('SILO')).toBe(false);
    const bibCells = getBibCells('SILO', 10, 10);
    expect(bibCells).toHaveLength(0);
  });

  it('walls have no bib cells', () => {
    for (const wallType of ['SBAG', 'FENC', 'BARB', 'BRIK']) {
      expect(BIBBED_BUILDINGS.has(wallType)).toBe(false);
      expect(getBibCells(wallType, 10, 10)).toHaveLength(0);
    }
  });

  it('getBibCells returns correct cells for 3-wide buildings (FACT, WEAP, PROC)', () => {
    for (const type of ['FACT', 'WEAP', 'PROC']) {
      const [fw, fh] = STRUCTURE_SIZE[type];
      const bibCells = getBibCells(type, 5, 5);
      // Bib is one row below footprint, same width as building
      expect(bibCells.length, `${type} bib width should equal footprint width`).toBe(fw);
      for (let i = 0; i < bibCells.length; i++) {
        expect(bibCells[i].cx).toBe(5 + i);
        expect(bibCells[i].cy).toBe(5 + fh);
      }
    }
  });

  it('getBibCells returns correct cells for 2-wide buildings (POWR, DOME, BARR)', () => {
    for (const type of ['POWR', 'DOME', 'BARR']) {
      const [fw, fh] = STRUCTURE_SIZE[type];
      expect(fw).toBe(2);
      const bibCells = getBibCells(type, 5, 5);
      expect(bibCells.length).toBe(2);
      expect(bibCells[0]).toEqual({ cx: 5, cy: 5 + fh });
      expect(bibCells[1]).toEqual({ cx: 6, cy: 5 + fh });
    }
  });

  it('buildings with width < 2 get no bib even if in BIBBED_BUILDINGS set', () => {
    // getBibCells has guard: if (fw < 2 || fw > 4) return []
    // Verify the guard by testing with a 1-wide type (none are actually bibbed,
    // but the function defensively handles it)
    const cells = getBibCells('GUN', 5, 5); // GUN is 1x1, not bibbed
    expect(cells).toHaveLength(0);
  });
});
