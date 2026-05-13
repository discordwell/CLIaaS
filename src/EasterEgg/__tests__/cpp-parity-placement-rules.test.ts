/**
 * C++ Behavioral Parity Tests — Placement Rules
 *
 * Tests placement.ts (placeStructure + deployMCV) against C++ behavior from:
 *   - display.cpp:668-811  Passes_Proximity_Check()
 *   - techno.cpp:6323-6349 TechnoTypeClass::Legal_Placement()
 *   - cell.cpp:453-513     CellClass::Is_Clear_To_Build()
 *   - building.cpp:740-797 BuildingClass::Mark(MARK_DOWN) — wall→overlay + bib placement
 *   - building.cpp:3162-3176 BuildingClass::Can_Enter_Cell()
 *   - unit.cpp:1477-1589   UnitClass::Try_To_Deploy()
 *   - bdata.cpp:3561-3629  BuildingTypeClass::Height() + Bib_And_Offset()
 *
 * C++ reference: CnC_and_Red_Alert/RA/
 */

import { describe, it, expect, vi } from 'vitest';
import {
  UnitType, House, Mission, CELL_SIZE,
  type ProductionItem,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap, Terrain } from '../engine/map';
import { STRUCTURE_SIZE, STRUCTURE_MAX_HP, BIBBED_BUILDINGS, getBibCells } from '../engine/scenario';
import type { MapStructure } from '../engine/scenario';
import type { Effect } from '../engine/renderer';
import {
  type PlacementContext,
  placeStructure,
  deployMCV,
} from '../engine/placement';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers — same as placement-behavioral.test.ts
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

function structItem(type: string = 'POWR', cost: number = 300): ProductionItem {
  return { type, name: type, cost, buildTime: 60, prerequisites: [], icon: type.toLowerCase(), side: 'allied' };
}

function wallItem(type: string = 'BRIK', cost: number = 25): ProductionItem {
  return { type, name: type, cost, buildTime: 10, prerequisites: [], icon: type.toLowerCase(), side: 'allied' };
}

/**
 * Mark a structure's footprint and bib smudges on the map,
 * simulating what the scenario loader does.
 */
function stampStructure(map: GameMap, type: string, cx: number, cy: number): void {
  const [fw, fh] = STRUCTURE_SIZE[type] ?? [2, 2];
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      map.setTerrain(cx + dx, cy + dy, Terrain.WALL);
    }
  }
  for (const bc of getBibCells(type, cx, cy)) {
    map.setBibSmudge(bc.cx, bc.cy, true);
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// Section 1: Terrain passability for placement
//
// C++ cell.cpp:453-513 CellClass::Is_Clear_To_Build(SpeedType loco):
//   - Line 460: ScenarioInit → always true
//   - Line 465: Cell_Object() != NULL → false
//   - Line 482: Overlay != OVERLAY_NONE (non-debug) → false
//   - Line 489: Smudge bib present → false
//   - Line 498-503: loco==SPEED_NONE → check bridge, then Ground[Land_Type()].Build
//   - Line 507-511: loco!=SPEED_NONE → check Ground cost != 0
//
// C++ rules.ini defaults for Ground[land].Build:
//   LAND_CLEAR=true, LAND_ROAD=true
//   LAND_WATER=false, LAND_ROCK=false, LAND_WALL=false
//   LAND_ORE=false, LAND_BEACH=false, LAND_ROUGH=false, LAND_RIVER=false
//
// TS map.ts:28 PASSABLE set:
//   {CLEAR, ORE, ROUGH, BEACH} — ORE, ROUGH, BEACH are passable
//
// placement.ts:57 uses ctx.map.isPassable() which checks PASSABLE set.
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 1: Terrain passability for building placement (cell.cpp:453-513)', () => {

  it('CLEAR terrain allows placement — matches C++ Ground[LAND_CLEAR].Build=true', () => {
    // C++ cell.cpp:503: return(::Ground[Land_Type()].Build) where LAND_CLEAR.Build=true
    // TS: PASSABLE has Terrain.CLEAR → isPassable returns true
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    // POWR at (13,10) — clear terrain, adjacent to FACT
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(true);
  });

  it('ROCK terrain blocks placement — matches C++ Ground[LAND_ROCK].Build=false', () => {
    // C++ cell.cpp:503: Ground[LAND_ROCK].Build=false → Is_Clear_To_Build returns false
    // TS: Terrain.ROCK not in PASSABLE → isPassable returns false
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    ctx.map.setTerrain(13, 10, Terrain.ROCK);
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });

  it('WATER terrain blocks placement — matches C++ Ground[LAND_WATER].Build=false', () => {
    // C++ cell.cpp:503: Ground[LAND_WATER].Build=false
    // TS: Terrain.WATER not in PASSABLE
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    ctx.map.setTerrain(13, 10, Terrain.WATER);
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });

  it('WALL terrain blocks placement — matches C++ Ground[LAND_WALL].Build=false', () => {
    // C++ cell.cpp line 482: walls are overlays with IsWall=true → blocks Is_Clear_To_Build
    // TS: Terrain.WALL not in PASSABLE → isPassable returns false
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    ctx.map.setTerrain(13, 10, Terrain.WALL);
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });

  // FIXED: C++ Ground[LAND_ORE].Build=false — TS BUILDABLE set excludes Terrain.ORE
  it('FIXED: ORE terrain blocks placement — C++ Ground[LAND_ORE].Build=false (rules.cpp:864)', () => {
    // C++ rules.cpp:864: gptr->Build = ini.Get_Bool(_lands[land], "Buildable", false)
    // rules.ini [Ore] section: Buildable=no (default false in C++)
    // C++ cell.cpp:503: Ground[LAND_ORE].Build=false → blocks placement
    //
    // FIXED: TS map.ts:42: BUILDABLE = {CLEAR, ROAD} — ORE excluded from buildable set
    // placement.ts:60: isBuildable(cx, cy) → false for ORE → blocks placement
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    ctx.map.setTerrain(13, 10, Terrain.ORE);
    ctx.map.setTerrain(14, 10, Terrain.ORE);
    ctx.map.setTerrain(13, 11, Terrain.ORE);
    ctx.map.setTerrain(14, 11, Terrain.ORE);
    const result = placeStructure(ctx, 13, 10);
    // FIXED: ORE is not buildable — matches C++
    expect(result).toBe(false);
  });

  // FIXED: C++ Ground[LAND_ROUGH].Build=false — TS BUILDABLE set excludes Terrain.ROUGH
  it('FIXED: ROUGH terrain blocks placement — C++ Ground[LAND_ROUGH].Build=false', () => {
    // C++ rules.cpp:844-864: _lands[] = {Clear,Road,Water,Rock,Wall,Ore,Beach,Rough,River}
    // rules.ini [Rough] Buildable=no (default false)
    // C++ cell.cpp:503: Ground[LAND_ROUGH].Build=false
    //
    // FIXED: TS map.ts:42: BUILDABLE = {CLEAR, ROAD} — ROUGH excluded
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    ctx.map.setTerrain(13, 10, Terrain.ROUGH);
    ctx.map.setTerrain(14, 10, Terrain.ROUGH);
    ctx.map.setTerrain(13, 11, Terrain.ROUGH);
    ctx.map.setTerrain(14, 11, Terrain.ROUGH);
    const result = placeStructure(ctx, 13, 10);
    // FIXED: ROUGH is not buildable — matches C++
    expect(result).toBe(false);
  });

  // FIXED: C++ Ground[LAND_BEACH].Build=false — TS BUILDABLE set excludes Terrain.BEACH
  it('FIXED: BEACH terrain blocks placement — C++ Ground[LAND_BEACH].Build=false', () => {
    // C++ rules.cpp:844-864: Beach is index 6 in _lands[]
    // rules.ini [Beach] Buildable=no (default false)
    //
    // FIXED: TS map.ts:42: BUILDABLE = {CLEAR, ROAD} — BEACH excluded
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    ctx.map.setTerrain(13, 10, Terrain.BEACH);
    ctx.map.setTerrain(14, 10, Terrain.BEACH);
    ctx.map.setTerrain(13, 11, Terrain.BEACH);
    ctx.map.setTerrain(14, 11, Terrain.BEACH);
    const result = placeStructure(ctx, 13, 10);
    // FIXED: BEACH is not buildable — matches C++
    expect(result).toBe(false);
  });

  it('RIVER terrain blocks placement — matches C++ Ground[LAND_RIVER].Build=false', () => {
    // C++ cell.cpp:503: Ground[LAND_RIVER].Build=false
    // TS: Terrain.RIVER not in PASSABLE
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    ctx.map.setTerrain(13, 10, Terrain.RIVER);
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Section 2: Adjacency / proximity check
//
// C++ display.cpp:668-811 Passes_Proximity_Check():
//   For each foundation cell of the new building:
//     For each of 8 adjacent cells (FACING_FIRST..FACING_COUNT):
//       - Check if adjacent cell has a friendly building (Class->IsBase)
//       - Check if adjacent cell's adjacent cells (N/S/E/W) have friendly buildings
//       - For walls: check cell Owner == house
//       - For bibs: check smudge IsBib && cell Owner == house
//
// This is a 2-ring 8-directional scan per foundation cell.
// TS uses AABB intersection with 1-cell expansion per existing structure.
//
// Key difference: C++ scans 8-directionally from each new building cell,
// then additionally scans 4-directionally from each of those 8 neighbors.
// This means a building can be placed 2 cells away in cardinal directions
// from a friendly building.
// TS only allows 1-cell expansion from existing structures (AABB overlap).
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 2: Adjacency / proximity check (display.cpp:668-811)', () => {

  it('placement adjacent (1 cell gap) to friendly building succeeds', () => {
    // C++ display.cpp:717-747 — first ring check finds friendly building
    // FACT at (10,10) is 3x3 → occupies columns 10-12, rows 10-12
    // POWR at (13,10) is 2x2 → columns 13-14, rows 10-11
    // Cell (13,10) is adjacent to cell (12,10) which is part of FACT
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    stampStructure(makePlacementCtx().map, 'FACT', 10, 10); // stamp won't help here
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(true);
  });

  it('placement with no adjacent friendly building fails', () => {
    // C++ display.cpp:781: retval = -1 → retval = false → fails
    const ctx = makePlacementCtx({
      pendingPlacement: structItem('POWR'),
    });
    const result = placeStructure(ctx, 50, 50);
    expect(result).toBe(false);
  });

  it('placement adjacent to enemy building fails', () => {
    // C++ display.cpp:744: base->House->Class->House == house check fails for enemy
    // TS: isAllied(s.house, playerHouse) returns false for enemy
    const existing = makeStructure('FACT', House.USSR, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
      playerHouse: House.Greece,
    });
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });

  it('placement adjacent to dead (destroyed) building fails', () => {
    // C++ would not find a dead building via Cell_Techno()
    // TS: checks s.alive
    const existing = makeStructure('FACT', House.Greece, 10, 10, { alive: false });
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });

  // FIXED: C++ two-ring scan — TS uses 2-cell AABB expansion to match
  // C++ can place a building 2 cells away (cardinal) from a friendly building:
  //   Foundation cell → 8-dir adjacent → 4-dir adjacent = 2 cells reach
  // display.cpp:756-775: second level scan
  it('FIXED: placement 2 cells away (cardinal gap) passes proximity check', () => {
    // C++ display.cpp:749-775:
    //   "BG: modifications to allow buildings one cell away from other buildings.
    //    This is done by scanning each cell that fails the check (hence getting
    //    to this point) and looking at the n/s/e/w adjacent cells to see if they
    //    have buildings in them."
    //
    // FACT at (10,10) is 3x3 → rightmost column is 12
    // POWR at (14,10) is 2x2 → leftmost column is 14
    // Gap of 1 empty column (13) between them.
    // FIXED: TS uses 2-cell AABB expansion: FACT expanded (8,8)-(15,15)
    // POWR at (14,10)-(16,12): nL(14) < exR(15)=true → overlap → passes
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    const result = placeStructure(ctx, 14, 10);
    // FIXED: 2-cell expansion reaches FACT — matches C++ two-ring scan
    expect(result).toBe(true);
  });

  it('placement diagonally adjacent (touching at corner) succeeds', () => {
    // C++ display.cpp:717: 8-directional scan includes diagonal facings
    // FACT at (10,10) is 3x3 → bottom-right corner at (12,12)
    // POWR at (13,13) is 2x2 → top-left at (13,13)
    // Cell (13,13) diagonal to (12,12) which is part of FACT → found in 1st ring
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    // TS AABB: expanded FACT (9,9)-(14,14), POWR (13,13)-(15,15)
    // nL(13) < exR(14)=true, nR(15) > exL(9)=true, nT(13) < exB(14)=true, nB(15) > exT(9)=true → overlap → true
    const result = placeStructure(ctx, 13, 13);
    expect(result).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Section 3: Wall placement exemptions
//
// C++ display.cpp:691-693:
//   if (object == NULL || object->What_Am_I() != RTTI_BUILDINGTYPE)
//     return(true);
//
// HOWEVER, walls ARE RTTI_BUILDINGTYPE in C++! They go through
// Passes_Proximity_Check and CAN be satisfied by cell ownership
// (display.cpp:734-741):
//   if (building->IsWall || bib) {
//     if (cell.Owner == house) { retval = true; break; }
//   }
//
// So in C++, walls require EITHER:
//   - An adjacent friendly building (same as regular buildings), OR
//   - An adjacent cell owned by the player (from a bib or wall)
//
// TS placement.ts:64-66:
//   if (!isWall) { /* adjacency check */ }
//   Walls skip adjacency entirely — can be placed anywhere passable.
//
// This is a deliberate TS simplification. Walls in C++ need proximity;
// TS allows walls anywhere. The first wall placed via production always
// has proximity (ConYard exists), so this mainly affects isolated wall
// placement far from base.
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 3: Wall placement (display.cpp:734-741, building.cpp:1062)', () => {

  it('wall placement on clear terrain adjacent to friendly structure succeeds', () => {
    // C++ display.cpp:706-778: walls go through Passes_Proximity_Check like buildings
    const existing = makeStructure('FACT', House.Greece, 48, 48);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: wallItem('BRIK'),
    });
    const result = placeStructure(ctx, 50, 50);
    expect(result).toBe(true);
  });

  // FIXED: C++ requires walls to pass proximity check (adjacent friendly building/wall/bib)
  it('FIXED: wall placed far from any friendly structure fails', () => {
    // C++ display.cpp:706-778: Adjacent==1 → scan for friendly structures
    // With no structures anywhere, wall at (50,50) has nothing adjacent → fails
    //
    // FIXED: TS now requires all placements (including walls) to pass proximity check.
    // In practice, walls are produced from ConYard sidebar, so there's always
    // a ConYard when placing the first wall.
    const ctx = makePlacementCtx({
      pendingPlacement: wallItem('BRIK'),
    });
    const result = placeStructure(ctx, 50, 50);
    // FIXED: wall fails when no adjacent friendly structure — matches C++
    expect(result).toBe(false);
  });

  it('wall placed adjacent to friendly structure succeeds in both C++ and TS', () => {
    // C++ display.cpp:744: finds friendly building → retval = true
    // TS: walls skip adjacency (always succeed if passable)
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: wallItem('BRIK'),
    });
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(true);
  });

  it('walls are converted to overlays in C++ (building.cpp:1062-1098)', () => {
    // C++ building.cpp:1062: if (Class->IsWall) → convert to overlay
    // This means walls don't take up "building slots" — they become terrain overlays
    // TS stores them as MapStructure entries with wallType metadata
    //
    // We just verify the TS wall placement marks the wallType on the map
    const existing = makeStructure('FACT', House.Greece, 18, 18);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: wallItem('BRIK'),
    });
    placeStructure(ctx, 20, 20);
    expect(ctx.map.getWallType(20, 20)).toBe('BRIK');
  });

  it('all four wall types are recognized (SBAG, FENC, BARB, BRIK)', () => {
    // C++ building.cpp:1066-1088: maps STRUCT_SANDBAG_WALL → OVERLAY_SANDBAG_WALL etc.
    // TS placement.ts:19: WALL_TYPES = Set(['SBAG', 'FENC', 'BARB', 'BRIK'])
    for (const wt of ['SBAG', 'FENC', 'BARB', 'BRIK']) {
      const existing = makeStructure('FACT', House.Greece, 28, 28);
      const ctx = makePlacementCtx({
        structures: [existing],
        pendingPlacement: wallItem(wt),
      });
      const result = placeStructure(ctx, 30, 30);
      expect(result, `${wt} should place successfully`).toBe(true);
    }
  });

  // FIXED: C++ has WOOD and CYCLONE walls (building.cpp:1082-1088)
  // TS WALL_TYPES now includes WOOD and CYCL
  it('FIXED: WOOD wall type recognized as wall — C++ building.cpp:1082-1084', () => {
    // C++ building.cpp:1082: case STRUCT_WOOD_WALL: otype = OVERLAY_WOOD_WALL
    // FIXED: TS placement.ts:21: WALL_TYPES = Set(['SBAG', 'FENC', 'BARB', 'BRIK', 'WOOD', 'CYCL'])
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: wallItem('WOOD'),
    });
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(true);
    // FIXED: WOOD is treated as wall — keeps pendingPlacement for continuous placement
    expect(ctx.pendingPlacement).not.toBeNull();
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Section 4: MCV deployment
//
// C++ unit.cpp:1477-1589 UnitClass::Try_To_Deploy():
//   Line 1483: if (*this == UNIT_MCV)
//   Line 1489: Mark(MARK_UP) — temporarily remove MCV from map
//   Line 1490: cell = Coord_Cell(Adjacent_Cell(Center_Coord(), FACING_NW))
//   Line 1491: Legal_Placement(cell) — checks if STRUCT_CONST (3x3) fits
//   Line 1509: if (PrimaryFacing.Current() != DIR_SW) → must face SW
//   Line 1524: building->Unlimbo(Adjacent_Cell(Coord, FACING_NW))
//   Line 1555: building->Strength = Health_Ratio() * building->Class->MaxStrength
//   Line 1573: delete this — MCV is destroyed
//
// TS placement.ts:145-192 deployMCV():
//   Line 148: ec.cx - 1, ec.cy - 1 for 3x3 center placement
//   Line 149-153: checks 3x3 passability around MCV cell
//   No facing requirement
//   Line 160: always full HP
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 4: MCV deployment (unit.cpp:1477-1589)', () => {

  it('MCV deploys into FACT (STRUCT_CONST) at NW-offset position', () => {
    // C++ unit.cpp:1490: cell = Coord_Cell(Adjacent_Cell(Center_Coord(), FACING_NW))
    // This places the building with its top-left at the NW cell relative to MCV center
    // TS: cx = ec.cx - 1, cy = ec.cy - 1 → same NW offset
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();
    deployMCV(ctx, mcv);

    expect(ctx.structures).toHaveLength(1);
    expect(ctx.structures[0].type).toBe('FACT');
    // MCV at cell (50,50) → FACT at (49,49)
    expect(ctx.structures[0].cx).toBe(49);
    expect(ctx.structures[0].cy).toBe(49);
  });

  it('MCV deployment removes the MCV entity', () => {
    // C++ unit.cpp:1562: Stun() + line 1573: delete this
    // TS: entity.alive = false, entity.mission = Mission.DIE
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();
    deployMCV(ctx, mcv);

    expect(mcv.alive).toBe(false);
  });

  it('non-MCV unit cannot deploy', () => {
    // C++ unit.cpp:1483: if (*this == UNIT_MCV) — only MCV can deploy into building
    // TS: if (entity.type !== UnitType.V_MCV) return false
    const tank = new Entity(UnitType.V_MTNK, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();
    const result = deployMCV(ctx, tank);
    expect(result).toBe(false);
  });

  it('deployment blocked by impassable cell in 3x3 area', () => {
    // C++ unit.cpp:1491: Legal_Placement checks all foundation cells via Is_Clear_To_Build
    // TS: checks isPassable for each cell in the 3x3 area
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();
    ctx.map.setTerrain(50, 50, Terrain.ROCK); // block center
    const result = deployMCV(ctx, mcv);
    expect(result).toBe(false);
    expect(mcv.alive).toBe(true); // MCV survives failed deployment
  });

  it('deployment marks 3x3 footprint as WALL terrain', () => {
    // C++ building.cpp:793: Map.Place_Down(cell, this) — marks cells occupied
    // TS: sets Terrain.WALL for 3x3 area
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();
    deployMCV(ctx, mcv);

    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        expect(ctx.map.getTerrain(49 + dx, 49 + dy)).toBe(Terrain.WALL);
      }
    }
  });

  // FIXED: C++ transfers MCV health ratio to FACT
  it('FIXED: FACT inherits MCV health ratio — C++ unit.cpp:1555', () => {
    // C++ unit.cpp:1555:
    //   building->Strength = Health_Ratio() * building->Class->MaxStrength
    //
    // FIXED: A damaged MCV creates a damaged Construction Yard.
    // If MCV has 50% HP, FACT starts at 50% HP.
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    mcv.hp = Math.floor(mcv.maxHp / 2); // 50% health
    const ctx = makePlacementCtx();
    deployMCV(ctx, mcv);

    const fact = ctx.structures[0];
    const expectedHp = Math.floor(fact.maxHp * 0.5);
    // FIXED: FACT at ~50% HP — matches C++ health ratio transfer
    expect(fact.hp).toBe(expectedHp);
  });

  // DESIGN DIVERGENCE: C++ requires MCV to face SW (DIR_SW) before deploying
  it('C++ requires MCV to face DIR_SW before deployment — unit.cpp:1509', () => {
    // C++ unit.cpp:1509-1513:
    //   if (PrimaryFacing.Current() != DIR_SW) {
    //     Do_Turn(DIR_SW);
    //     IsDeploying = true;
    //     return(true); // not actually deployed yet, just rotating
    //   }
    //
    // TS has no facing requirement — deployment is instant regardless of facing.
    // This is acceptable simplification for the TS engine which doesn't have
    // rotation mechanics, but it's documented here as a known C++ difference.
    //
    // Behavioral impact: In C++, MCV deployment takes time while rotating.
    // In TS, deployment is instant.
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();

    // TS always succeeds regardless of facing
    const result = deployMCV(ctx, mcv);
    expect(result).toBe(true);
    // This test passes in TS, documenting that facing is not checked
  });

  it('dead MCV cannot deploy', () => {
    // C++ unit.cpp:1480: assert(IsActive) — dead units filtered before this
    // TS: if (!entity.alive) return false
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    mcv.alive = false;
    const ctx = makePlacementCtx();
    const result = deployMCV(ctx, mcv);
    expect(result).toBe(false);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Section 5: Bib cells
//
// C++ bdata.cpp:3597-3629 Bib_And_Offset():
//   IsBibbed && Width()==2 → SMUDGE_BIB3 (2 cells wide)
//   IsBibbed && Width()==3 → SMUDGE_BIB2 (3 cells wide)
//   IsBibbed && Width()==4 → SMUDGE_BIB1 (4 cells wide)
//   Width()==1 or Width()>4 → no bib
//
//   Bib placed at row = Height()-1 (relative to building top-left)
//   So bib is 1 row below the building footprint
//
// C++ bdata.cpp:3574: Height(bib) = height[Size] + (bib && IsBibbed ? 1 : 0)
//   Height with bib is 1 taller than without bib.
//
// C++ cell.cpp:489: Smudge bib present → Is_Clear_To_Build returns false
//   Buildings cannot overlap bib cells.
//
// TS scenario.ts:1192-1214:
//   BIBBED_BUILDINGS set, getBibCells() returns cells 1 row below footprint
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 5: Bib cells (bdata.cpp:3597-3629)', () => {

  it('FACT (3x3, bibbed) produces 3 bib cells at row cy+3', () => {
    // C++ bdata.cpp:3607-3608: Width()==3 → SMUDGE_BIB2
    // bdata.cpp:3625: cell += (Height()-1) * MAP_CELL_W → row below building
    const bibs = getBibCells('FACT', 10, 10);
    expect(bibs).toHaveLength(3);
    expect(bibs.every(b => b.cy === 13)).toBe(true); // 10 + 3 = row 13
    expect(bibs.map(b => b.cx).sort()).toEqual([10, 11, 12]);
  });

  it('POWR (2x2, bibbed) produces 2 bib cells at row cy+2', () => {
    // C++ bdata.cpp:3603-3604: Width()==2 → SMUDGE_BIB3
    const bibs = getBibCells('POWR', 10, 10);
    expect(bibs).toHaveLength(2);
    expect(bibs.every(b => b.cy === 12)).toBe(true); // 10 + 2 = row 12
    expect(bibs.map(b => b.cx).sort()).toEqual([10, 11]);
  });

  it('WEAP (3x2, bibbed) produces 3 bib cells at row cy+2', () => {
    // C++ bdata.cpp:3607-3608: Width()==3 → SMUDGE_BIB2
    const bibs = getBibCells('WEAP', 10, 10);
    expect(bibs).toHaveLength(3);
    expect(bibs.every(b => b.cy === 12)).toBe(true); // 10 + 2 = row 12
  });

  it('GUN (1x1, not bibbed) produces no bib cells', () => {
    // C++ bdata.cpp:3601: IsBibbed=false → no bib
    // Also Width()==1 < 2 → default case returns SMUDGE_NONE
    const bibs = getBibCells('GUN', 10, 10);
    expect(bibs).toHaveLength(0);
  });

  it('SILO (1x1, not in BIBBED_BUILDINGS) produces no bib cells', () => {
    // C++ bdata.cpp: IsBibbed=false for SILO
    expect(BIBBED_BUILDINGS.has('SILO')).toBe(false);
    const bibs = getBibCells('SILO', 10, 10);
    expect(bibs).toHaveLength(0);
  });

  it('SAM (2x1, not in BIBBED_BUILDINGS) produces no bib cells', () => {
    expect(BIBBED_BUILDINGS.has('SAM')).toBe(false);
    const bibs = getBibCells('SAM', 10, 10);
    expect(bibs).toHaveLength(0);
  });

  it('bib cells block subsequent building placement', () => {
    // C++ cell.cpp:489:
    //   if (Smudge != SMUDGE_NONE && SmudgeTypeClass::As_Reference(Smudge).IsBib)
    //     return(false);
    //
    // After placing FACT at (10,10), bib smudges at row 13 block placement.
    // A subsequent building cannot be placed overlapping those bib cells.
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const map = makeMap();
    stampStructure(map, 'FACT', 10, 10);

    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
      map,
    });

    // POWR at (10, 12): rows 12-13, columns 10-11
    // Row 13 overlaps FACT's bib row → should fail
    const result = placeStructure(ctx, 10, 12);
    expect(result).toBe(false);
  });

  it('placement.ts marks bib cells as build-blocking smudges when placing structure', () => {
    // C++ building.cpp:789: Class->Bib_And_Offset(bib, newcell) → creates smudge
    const existing = makeStructure('FACT', House.Greece, 5, 5);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });

    placeStructure(ctx, 8, 5);
    // POWR at (8,5) is 2x2, bibbed → bib at row 7, columns 8-9
    const bibs = getBibCells('POWR', 8, 5);
    expect(bibs.length).toBeGreaterThan(0);
    for (const b of bibs) {
      expect(ctx.map.hasBibSmudge(b.cx, b.cy), `bib smudge at (${b.cx},${b.cy})`).toBe(true);
      expect(ctx.map.getTerrain(b.cx, b.cy), `bib terrain at (${b.cx},${b.cy})`).not.toBe(Terrain.WALL);
      expect(ctx.map.isPassable(b.cx, b.cy), `bib passable at (${b.cx},${b.cy})`).toBe(true);
      expect(ctx.map.isBuildable(b.cx, b.cy), `bib buildable at (${b.cx},${b.cy})`).toBe(false);
    }
  });

  it('non-bibbed structures do not create bib cells when placed', () => {
    // C++ bdata.cpp:3601: IsBibbed=false → no bib
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('GUN'),
    });

    // GUN is 1x1, adjacency check: GUN at (13,10) is adjacent to FACT (10-12, 10-12)
    placeStructure(ctx, 13, 10);
    const bibs = getBibCells('GUN', 13, 10);
    expect(bibs).toHaveLength(0);
  });

  it('MCV deployment also creates bib cells for FACT', () => {
    // C++ building.cpp:789: Bib_And_Offset applies to all buildings, including FACT
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const ctx = makePlacementCtx();
    deployMCV(ctx, mcv);

    // FACT at (49,49) is 3x3 → bib at row 52, columns 49-51
    const bibs = getBibCells('FACT', 49, 49);
    expect(bibs).toHaveLength(3);
    for (const b of bibs) {
      expect(ctx.map.hasBibSmudge(b.cx, b.cy), `FACT bib at (${b.cx},${b.cy})`).toBe(true);
      expect(ctx.map.getTerrain(b.cx, b.cy), `FACT bib terrain at (${b.cx},${b.cy})`).not.toBe(Terrain.WALL);
      expect(ctx.map.isPassable(b.cx, b.cy), `FACT bib passable at (${b.cx},${b.cy})`).toBe(true);
      expect(ctx.map.isBuildable(b.cx, b.cy), `FACT bib buildable at (${b.cx},${b.cy})`).toBe(false);
    }
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Section 6: Overlapping structure rejection
//
// C++ techno.cpp:6335-6341 Legal_Placement():
//   For each cell in Occupy_List:
//     if (!Map[cell].Is_Clear_To_Build(Speed)) return 0
//
// C++ cell.cpp:465: if (Cell_Object() != NULL) return false
//   Any existing object in cell blocks placement.
//
// TS placement.ts:55-59: checks isPassable() which returns false for WALL terrain
//   Since placed buildings mark cells as Terrain.WALL, overlap is rejected.
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 6: Overlapping structure rejection (techno.cpp:6335-6341)', () => {

  it('cannot place building overlapping existing building footprint', () => {
    // C++ cell.cpp:465: Cell_Object() != NULL → false
    // TS: cells marked as Terrain.WALL are not passable
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const map = makeMap();
    stampStructure(map, 'FACT', 10, 10);

    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
      map,
    });

    // POWR at (11,11) overlaps FACT footprint (10-12, 10-12)
    const result = placeStructure(ctx, 11, 11);
    expect(result).toBe(false);
  });

  it('cannot place building overlapping a single occupied cell', () => {
    // C++ cell.cpp:465: even one Cell_Object blocks entire placement
    const existing = makeStructure('GUN', House.Greece, 13, 10);
    const map = makeMap();
    stampStructure(map, 'GUN', 13, 10);

    // Need another structure for adjacency
    const adj = makeStructure('FACT', House.Greece, 10, 10);

    const ctx = makePlacementCtx({
      structures: [existing, adj],
      pendingPlacement: structItem('POWR'),
      map,
    });

    // POWR at (13,10) overlaps GUN at (13,10)
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });

  it('placing on already-marked WALL terrain fails', () => {
    // Direct test: if terrain is already WALL from prior placement
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    // Manually mark some cells as WALL
    ctx.map.setTerrain(13, 10, Terrain.WALL);
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });

  it('walls cannot be placed on occupied cells', () => {
    // C++ building.cpp:1063: Can_Enter_Cell checks passability for walls too
    const ctx = makePlacementCtx({
      pendingPlacement: wallItem('BRIK'),
    });
    ctx.map.setTerrain(20, 20, Terrain.WALL);
    const result = placeStructure(ctx, 20, 20);
    expect(result).toBe(false);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Section 7: Map bounds
//
// C++ techno.cpp:6337: if (!Map.In_Radar(cell)) return(false)
//   In_Radar checks if cell is within the radar/playable area.
//
// C++ display.cpp:711-714: if (!In_Radar(cell)) { retval=false; noradar=true; break; }
//   Proximity check also rejects cells outside radar.
//
// TS map.ts:173-178 isPassable():
//   Checks bounds: cx < boundsX || cx >= boundsX+boundsW → false
//   Out-of-bounds cells are not passable.
//
// TS map.ts:119-121 getTerrain():
//   Out-of-bounds returns Terrain.ROCK → not passable
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 7: Map bounds (techno.cpp:6337)', () => {

  it('placement at negative coordinates fails', () => {
    // C++ In_Radar: cell must be >= 0 and < MAP_CELL_TOTAL
    // TS: isPassable checks bounds
    const existing = makeStructure('FACT', House.Greece, 2, 2);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    const result = placeStructure(ctx, -1, 2);
    expect(result).toBe(false);
  });

  it('placement extending beyond map right edge fails', () => {
    // POWR is 2x2 → at (127, 50) extends to column 128 which is out of bounds
    const existing = makeStructure('FACT', House.Greece, 125, 50);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    const result = placeStructure(ctx, 127, 50);
    expect(result).toBe(false);
  });

  it('placement extending beyond map bottom edge fails', () => {
    const existing = makeStructure('FACT', House.Greece, 50, 125);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    const result = placeStructure(ctx, 50, 127);
    expect(result).toBe(false);
  });

  it('placement at map edge (within bounds) succeeds', () => {
    // POWR is 2x2 → at (126, 50) extends to column 127 which is the last valid cell
    const existing = makeStructure('FACT', House.Greece, 123, 50);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    const result = placeStructure(ctx, 126, 50);
    expect(result).toBe(true);
  });

  it('MCV deployment near map edge fails when 3x3 extends out of bounds', () => {
    // MCV at cell (0,0) → FACT at (-1,-1) → out of bounds
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 0 * CELL_SIZE, 0 * CELL_SIZE);
    const ctx = makePlacementCtx();
    const result = deployMCV(ctx, mcv);
    expect(result).toBe(false);
  });

  it('MCV deployment at map corner (cell 1,1) succeeds — 3x3 fits at (0,0)', () => {
    // MCV at cell (1,1) → FACT at (0,0) → 3x3 covers (0,0)-(2,2) → all within bounds
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 1 * CELL_SIZE + CELL_SIZE / 2, 1 * CELL_SIZE + CELL_SIZE / 2);
    const ctx = makePlacementCtx();
    const result = deployMCV(ctx, mcv);
    expect(result).toBe(true);
  });

  it('out-of-bounds terrain reads as ROCK (impassable)', () => {
    // C++ defines out-of-bounds cells as impassable
    // TS map.ts:119-121: returns Terrain.ROCK for out-of-bounds
    const map = makeMap();
    expect(map.getTerrain(-1, 0)).toBe(Terrain.ROCK);
    expect(map.getTerrain(0, -1)).toBe(Terrain.ROCK);
    expect(map.getTerrain(128, 0)).toBe(Terrain.ROCK);
    expect(map.getTerrain(0, 128)).toBe(Terrain.ROCK);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Section 8: Building footprint sizes — C++ parity
//
// C++ bdata.cpp defines building sizes via BSIZE_xxx enum.
// TS scenario.ts:1167-1185 STRUCTURE_SIZE table must match.
//
// Cross-referencing common structures:
//   FACT: 3x3 (BSIZE_33)
//   WEAP: 3x2 (BSIZE_32)
//   POWR: 2x2 (BSIZE_22)
//   PROC: 3x2 (BSIZE_32)
//   GUN:  1x1 (BSIZE_11)
//   SAM:  2x1 (BSIZE_21)
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 8: Building footprint sizes (bdata.cpp)', () => {

  const EXPECTED_SIZES: [string, number, number][] = [
    // C++ bdata.cpp structure definitions — Size field
    ['FACT', 3, 3],   // Construction Yard
    ['WEAP', 3, 2],   // War Factory
    ['POWR', 2, 2],   // Power Plant
    ['APWR', 3, 3],   // Advanced Power Plant (BSIZE_33)
    ['PROC', 3, 3],   // Ore Refinery (BSIZE_33)
    ['BARR', 2, 2],   // Barracks (Soviet)
    ['TENT', 2, 2],   // Barracks (Allied)
    ['FIX', 3, 3],    // Service Depot (BSIZE_33)
    ['SILO', 1, 1],   // Ore Silo
    ['DOME', 2, 2],   // Radar Dome
    ['GUN', 1, 1],    // Turret
    ['SAM', 2, 1],    // SAM Site
    ['HPAD', 2, 2],   // Helipad
    ['AFLD', 3, 2],   // Airfield (BSIZE_32)
    ['ATEK', 2, 2],   // Allied Tech Center
    ['STEK', 3, 3],   // Soviet Tech Center (BSIZE_33)
    ['TSLA', 1, 2],   // Tesla Coil (BSIZE_12)
    ['AGUN', 1, 2],   // AA Gun (BSIZE_12)
    ['GAP', 1, 2],    // Gap Generator (BSIZE_12)
    ['PBOX', 1, 1],   // Pillbox
    ['HBOX', 1, 1],   // Camo Pillbox
    ['PDOX', 2, 2],   // Chronosphere
    ['IRON', 2, 2],   // Iron Curtain
    ['MSLO', 2, 1],   // Missile Silo (BSIZE_21)
    ['SYRD', 3, 3],   // Naval Yard (Allied)
    ['SPEN', 3, 3],   // Sub Pen (Soviet)
    // Walls are 1x1
    ['SBAG', 1, 1],
    ['FENC', 1, 1],
    ['BARB', 1, 1],
    ['BRIK', 1, 1],
  ];

  for (const [type, expW, expH] of EXPECTED_SIZES) {
    it(`${type} footprint = ${expW}x${expH}`, () => {
      const size = STRUCTURE_SIZE[type];
      expect(size, `${type} should have a defined size`).toBeDefined();
      expect(size![0], `${type} width`).toBe(expW);
      expect(size![1], `${type} height`).toBe(expH);
    });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// Section 9: Bibbed building set — C++ parity
//
// C++ bdata.cpp: IsBibbed field set per building type
// rules.ini overrides via: Bib=yes/no (bdata.cpp:3775)
//
// Key bibbed buildings in C++:
//   FACT, WEAP, PROC, POWR, APWR, BARR, TENT, FIX, HPAD, AFLD, DOME,
//   ATEK, STEK, IRON, PDOX, SYRD, SPEN, BIO, HOSP, MISS, FCOM
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 9: Bibbed building set (bdata.cpp:3775)', () => {

  const EXPECTED_BIBBED = [
    'FACT', 'WEAP', 'PROC', 'POWR', 'APWR', 'BARR', 'TENT',
    'HPAD', 'DOME',
    'ATEK', 'STEK',
    'BIO', 'HOSP', 'MISS', 'FCOM',
    'FACF', 'WEAF', 'DOMF', 'FENC', 'MINP',
  ];

  const EXPECTED_NOT_BIBBED = [
    'SILO', 'GUN', 'SAM', 'TSLA', 'AGUN', 'GAP', 'PBOX', 'HBOX',
    'SBAG', 'BARB', 'BRIK',
    'KENN', 'MSLO',
    'FIX', 'AFLD', 'IRON', 'PDOX', 'SYRD', 'SPEN',
  ];

  for (const type of EXPECTED_BIBBED) {
    it(`${type} should be bibbed`, () => {
      expect(BIBBED_BUILDINGS.has(type), `${type}`).toBe(true);
    });
  }

  for (const type of EXPECTED_NOT_BIBBED) {
    it(`${type} should NOT be bibbed`, () => {
      expect(BIBBED_BUILDINGS.has(type), `${type}`).toBe(false);
    });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// Section 10: Bib width mapping — C++ bdata.cpp:3602-3617
//
// C++ Bib_And_Offset switch on Width():
//   Width==2 → SMUDGE_BIB3 (2 cells wide)
//   Width==3 → SMUDGE_BIB2 (3 cells wide)
//   Width==4 → SMUDGE_BIB1 (4 cells wide)
//   default  → SMUDGE_NONE (no bib)
//
// TS getBibCells: fw < 2 || fw > 4 → empty array
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 10: Bib width mapping (bdata.cpp:3602-3617)', () => {

  it('width-2 bibbed building gets 2-cell-wide bib', () => {
    // C++ bdata.cpp:3603: case 2: bib = SMUDGE_BIB3 (2 cells wide)
    // POWR is 2x2, bibbed
    const bibs = getBibCells('POWR', 0, 0);
    expect(bibs).toHaveLength(2);
  });

  it('width-3 bibbed building gets 3-cell-wide bib', () => {
    // C++ bdata.cpp:3607: case 3: bib = SMUDGE_BIB2 (3 cells wide)
    // FACT is 3x3, bibbed
    const bibs = getBibCells('FACT', 0, 0);
    expect(bibs).toHaveLength(3);
  });

  it('width-3 bibbed building (WEAP 3x2) gets 3-cell-wide bib at correct row', () => {
    // WEAP is 3x2 → bib at row 0+2=2
    const bibs = getBibCells('WEAP', 5, 5);
    expect(bibs).toHaveLength(3);
    expect(bibs.every(b => b.cy === 7)).toBe(true); // 5 + 2 = 7
  });

  it('width-1 building (even if hypothetically bibbed) gets no bib', () => {
    // C++ bdata.cpp:3615-3617: default → SMUDGE_NONE
    // GUN is 1x1, not bibbed anyway, but test the width guard
    const bibs = getBibCells('GUN', 0, 0);
    expect(bibs).toHaveLength(0);
  });

  it('getBibCells returns empty for unknown building type', () => {
    const bibs = getBibCells('FAKE_BUILDING', 0, 0);
    expect(bibs).toHaveLength(0);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Section 11: Placement terrain marking — footprint wall, bib smudge
//
// C++ building.cpp:793: Map.Place_Down(cell, this)
// This marks cells as occupied, preventing future placement.
//
// TS placement.ts: sets Terrain.WALL for footprint cells and bib smudges below.
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 11: Footprint terrain marking (building.cpp:793)', () => {

  it('placing POWR (2x2) marks 4 footprint WALL cells and 2 bib smudges', () => {
    const existing = makeStructure('FACT', House.Greece, 5, 5);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });

    placeStructure(ctx, 8, 5);
    // Footprint: (8,5), (9,5), (8,6), (9,6) → 4 cells
    for (const [x, y] of [[8, 5], [9, 5], [8, 6], [9, 6]]) {
      expect(ctx.map.getTerrain(x, y), `footprint (${x},${y})`).toBe(Terrain.WALL);
    }
    // Bib: (8,7), (9,7) → 2 cells
    for (const [x, y] of [[8, 7], [9, 7]]) {
      expect(ctx.map.hasBibSmudge(x, y), `bib smudge (${x},${y})`).toBe(true);
      expect(ctx.map.getTerrain(x, y), `bib terrain (${x},${y})`).not.toBe(Terrain.WALL);
      expect(ctx.map.isPassable(x, y), `bib passable (${x},${y})`).toBe(true);
      expect(ctx.map.isBuildable(x, y), `bib buildable (${x},${y})`).toBe(false);
    }
    // Adjacent clear cell should remain CLEAR
    expect(ctx.map.getTerrain(10, 5)).toBe(Terrain.CLEAR);
  });

  it('placing wall (1x1) marks exactly 1 cell as WALL', () => {
    const existing = makeStructure('FACT', House.Greece, 18, 18);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: wallItem('BRIK'),
    });
    placeStructure(ctx, 20, 20);
    expect(ctx.map.getTerrain(20, 20)).toBe(Terrain.WALL);
    // Adjacent cells remain clear
    expect(ctx.map.getTerrain(21, 20)).toBe(Terrain.CLEAR);
    expect(ctx.map.getTerrain(20, 21)).toBe(Terrain.CLEAR);
  });

  it('placing GUN (1x1, no bib) marks exactly 1 cell', () => {
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('GUN'),
    });
    placeStructure(ctx, 13, 10);
    expect(ctx.map.getTerrain(13, 10)).toBe(Terrain.WALL);
    // No bib cells
    expect(ctx.map.getTerrain(13, 11)).toBe(Terrain.CLEAR);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Section 12: Edge cases — overlays blocking placement in C++
//
// C++ cell.cpp:482:
//   if (Overlay != OVERLAY_NONE &&
//       (Overlay == OVERLAY_FLAG_SPOT || !Debug_Map ||
//        OverlayTypeClass::As_Reference(Overlay).IsWall))
//     return(false);
//
// In normal (non-debug) game mode, ANY overlay blocks Is_Clear_To_Build.
// This includes gems, ore, fences, etc.
//
// TS does NOT check overlays. Building on cells with overlays is allowed
// as long as the terrain type is passable.
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 12: Edge cases', () => {

  it('placement succeeds when all footprint cells are CLEAR and adjacent', () => {
    // Baseline test — everything correct
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(true);
  });

  it('placement fails when even one footprint cell is blocked', () => {
    // C++ techno.cpp:6339-6340: if (!Is_Clear_To_Build) return 0
    // A single blocked cell fails the entire placement
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    // Block just one of POWR's 4 cells: (14, 11)
    ctx.map.setTerrain(14, 11, Terrain.ROCK);
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });

  it('placement fails when a bib cell is blocked', () => {
    // C++ placement.ts:60-63 (mirroring C++):
    //   for (const bc of getBibCells(...)) {
    //     if (!ctx.map.isPassable(bc.cx, bc.cy)) return false;
    //   }
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('POWR'),
    });
    // POWR at (13,10): bib at row 12, columns 13-14
    // Block bib cell (13, 12)
    ctx.map.setTerrain(13, 12, Terrain.ROCK);
    const result = placeStructure(ctx, 13, 10);
    expect(result).toBe(false);
  });

  it('wall placement fails with insufficient credits', () => {
    // C++ deducts wall cost; TS checks credits >= cost
    // TS placement.ts:52: if (isWall && ctx.credits < item.cost) return false
    const ctx = makePlacementCtx({
      pendingPlacement: wallItem('BRIK', 25),
      credits: 10, // not enough
    });
    const result = placeStructure(ctx, 20, 20);
    expect(result).toBe(false);
  });

  it('PROC placement spawns harvester entity', () => {
    // C++ building.cpp creates a harvester attached to refinery
    // TS placement.ts:133-140: spawns Entity with UnitType.V_HARV
    const existing = makeStructure('FACT', House.Greece, 10, 10);
    const ctx = makePlacementCtx({
      structures: [existing],
      pendingPlacement: structItem('PROC', 2000),
    });
    placeStructure(ctx, 13, 10);
    expect(ctx.entities.length).toBeGreaterThanOrEqual(1);
    const harv = ctx.entities.find(e => e.type === UnitType.V_HARV);
    expect(harv).toBeDefined();
    expect(harv!.house).toBe(House.Greece);
  });
});
