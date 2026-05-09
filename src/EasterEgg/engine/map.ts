/**
 * Map system — terrain grid, passability, cell occupancy.
 * The map is 128×128 cells but only a portion (typically 50×50) is playable.
 */

import { MAP_CELLS, CELL_SIZE, type CellPos, SpeedClass, TERRAIN_SPEED } from './types';
import { ScenarioRandom } from './random';

/** C++ MoveType enum (defines.h:828-837) — Can_Enter_Cell() return values for pathfinding.
 *  cpp-parity: values match C++ MOVE_OK..MOVE_NO exactly. */
export enum MoveResult {
  OK = 0,           // MOVE_OK — no blockage
  CLOAK = 1,        // MOVE_CLOAK — a cloaked blocking enemy object
  OCCUPIED = 2,     // MOVE_MOVING_BLOCK — blocked, but only temporarily (stationary unit)
  DESTROYABLE = 3,  // MOVE_DESTROYABLE — enemy unit or building is blocking
  TEMP_BLOCKED = 4, // MOVE_TEMP — blocked by friendly unit
  IMPASSABLE = 5,   // MOVE_NO — strictly prohibited terrain
}

/** C++ LandType enum (defines.h:2841-2855) — terrain classification per cell.
 *  cpp-parity: ordinals 0-8 match C++ LAND_CLEAR..LAND_RIVER exactly.
 *  TREE=9 is a TS extension (C++ uses TerrainClass objects on LAND_CLEAR cells). */
export enum Terrain {
  CLEAR = 0,
  ROAD = 1,   // C++ LAND_ROAD — paved road surface
  WATER = 2,
  ROCK = 3,
  WALL = 4,
  ORE = 5,    // C++ LAND_TIBERIUM
  BEACH = 6,
  ROUGH = 7,
  RIVER = 8,
  TREE = 9,   // TS extension — C++ has no TREE LandType; trees are TerrainClass objects on CLEAR cells
}

// C++ parity: trees (TerrainClass) are placed on CLEAR ground — infantry can
// walk through them. Vehicles are blocked by occupancy checks, not terrain type.
const PASSABLE = new Set([Terrain.CLEAR, Terrain.ROAD, Terrain.ORE, Terrain.ROUGH, Terrain.BEACH, Terrain.TREE]);

/** C++ rules.cpp:864 Ground[land].Build — only CLEAR and ROAD terrain allow building placement.
 *  ORE, ROUGH, BEACH are passable for movement but NOT buildable.
 *  cpp-parity: rules.cpp:844-864 _lands[] defaults. */
const BUILDABLE = new Set([Terrain.CLEAR, Terrain.ROAD]);

/** Map Terrain enum values to TERRAIN_SPEED table keys.
 *  C++ parity: TREE maps to 'Clear' (trees are TerrainClass objects placed on CLEAR cells). */
const TERRAIN_NAME_MAP: Record<number, string> = {
  [Terrain.CLEAR]: 'Clear',
  [Terrain.ROAD]: 'Road',
  [Terrain.WATER]: 'Water',
  [Terrain.ROCK]: 'Rock',
  [Terrain.WALL]: 'Wall',
  [Terrain.ORE]: 'Ore',
  [Terrain.BEACH]: 'Beach',
  [Terrain.ROUGH]: 'Rough',
  [Terrain.RIVER]: 'River',
  [Terrain.TREE]: 'Clear', // C++ parity — trees are TerrainClass on CLEAR cells, speed = CLEAR
};

// ═══════════════════════════════════════════════════════════════════════════
// C++ TerrainClass parity — trees as HP-bearing objects (RA terrain.cpp/tdata.cpp)
// ═══════════════════════════════════════════════════════════════════════════

/** C++ tdata.cpp line 50 — #define TREE_NORMAL 600 (all RA trees use this) */
export const TREE_MAX_HP = 600;

/** Tree object placed on the map. C++ TerrainClass (terrain.cpp).
 *  Trees have HP, take weapon damage (ARMOR_WOOD), and are destroyed when HP reaches 0.
 *  Clumps (TC01-TC05) are immune to combat damage (C++ IsImmune=true). */
export interface MapTree {
  type: string;         // 't01'-'t17', 'tc01'-'tc05'
  cx: number;           // origin cell x
  cy: number;           // origin cell y
  hp: number;           // current HP
  maxHp: number;        // max HP (600 for all trees)
  immune: boolean;      // C++ IsImmune — true for clumps
  occupyCells: number[]; // cell indices this tree occupies (blocks ground movement)
}

/** Non-tree C++ TerrainClass object placed on the map.
 *  Examples: interior BOXES01-09 and terrain MINE. These are not trees:
 *  they are immune TerrainClass objects with Occupy_List cells that block
 *  movement but do not participate in tree HP/damage routing. */
export interface MapTerrainObject {
  type: string;
  cx: number;
  cy: number;
  occupyCells: number[];
}

/** C++ RA tdata.cpp Occupy_List per tree type — cells blocked by each tree, as [dx,dy] offsets
 *  from the origin cell. Decoded from C++ cell offset arrays (_List0010, _List10, etc.)
 *  where MAP_CELL_W=128 encodes row offsets.
 *
 *  Key: _List0010={MAP_CELL_W}=(0,1), _List10={0}=(0,0), _List0011={MAP_CELL_W,MAP_CELL_W+1}=(0,1)(1,1)
 *
 *  C++ source: RA/tdata.cpp lines 57-77 (offset lists), lines 246-424 (tree type constructors) */
export const TREE_OCCUPY: Record<string, [number, number][]> = {
  // Single trees — occupy 1-2 cells, NOT immune
  't01': [[0, 1]],             // _List0010
  't02': [[0, 1]],             // _List0010
  't03': [[0, 1]],             // _List0010
  't05': [[0, 1]],             // _List0010
  't06': [[0, 1]],             // _List0010
  't07': [[0, 1]],             // _List0010
  't08': [[0, 0]],             // _List10
  't10': [[0, 1], [1, 1]],    // _List0011
  't11': [[0, 1], [1, 1]],    // _List0011
  't12': [[0, 1]],             // _List0010
  't13': [[0, 1]],             // _List0010
  't14': [[0, 1], [1, 1]],    // _List0011
  't15': [[0, 1], [1, 1]],    // _List0011
  't16': [[0, 1]],             // _List0010
  't17': [[0, 1]],             // _List0010
  // Tree clumps — immune to damage, multi-cell occupancy
  'tc01': [[0, 1], [1, 1]],                                           // _List000110
  'tc02': [[1, 0], [0, 1], [1, 1]],                                   // _List010110
  'tc03': [[0, 0], [1, 0], [0, 1], [1, 1]],                           // _List110110
  'tc04': [[0, 1], [1, 1], [2, 1], [0, 2]],                           // _List000011101000
  'tc05': [[2, 0], [0, 1], [1, 1], [2, 1], [1, 2], [2, 2]],          // _List001011100110
};

/** C++ RA tdata.cpp non-tree TerrainTypeClass Occupy_List entries.
 *  `_List10={0}` means the terrain object occupies its origin cell.
 *
 *  BOXES01-09 are interior TerrainClass objects (not overlays), and MINE is
 *  the ore-spread terrain object. C++ pathing sees both through the
 *  CellClass occupier chain; TS must mark the same cells blocked. */
export const TERRAIN_OBJECT_OCCUPY: Record<string, [number, number][]> = {
  'mine': [[0, 0]],      // TERRAIN_MINE, _List10
  'boxes01': [[0, 0]],   // TERRAIN_BOXES01, _List10
  'boxes02': [[0, 0]],   // TERRAIN_BOXES02, _List10
  'boxes03': [[0, 0]],   // TERRAIN_BOXES03, _List10
  'boxes04': [[0, 0]],   // TERRAIN_BOXES04, _List10
  'boxes05': [[0, 0]],   // TERRAIN_BOXES05, _List10
  'boxes06': [[0, 0]],   // TERRAIN_BOXES06, _List10
  'boxes07': [[0, 0]],   // TERRAIN_BOXES07, _List10
  'boxes08': [[0, 0]],   // TERRAIN_BOXES08, _List10
  'boxes09': [[0, 0]],   // TERRAIN_BOXES09, _List10
};

/** C++ RA tdata.cpp XYP_COORD — pixel offset from origin cell top-left to tree center.
 *  Used by C++ Center_Coord() for damage distance calculation (terrain.cpp).
 *  Values are [px, py] in game pixels (CELL_SIZE = 24). */
export const TREE_CENTER_OFFSET: Record<string, [number, number]> = {
  't01': [11, 41],   't02': [11, 44],   't03': [12, 45],
  't05': [15, 41],   't06': [16, 37],   't07': [15, 41],
  't08': [14, 22],   't10': [25, 43],   't11': [23, 44],
  't12': [14, 36],   't13': [19, 40],   't14': [19, 40],
  't15': [19, 40],   't16': [13, 36],   't17': [18, 44],
  'tc01': [28, 41],  'tc02': [38, 41],  'tc03': [33, 35],
  'tc04': [44, 49],  'tc05': [49, 58],
};

export class GameMap {
  /** 128×128 grid of terrain types */
  cells: Terrain[];

  /** Map bounds (playable area within the 128×128 grid) */
  boundsX: number;
  boundsY: number;
  boundsW: number;
  boundsH: number;

  /** Occupancy: entity ID at each cell (0 = empty).
   *  For cells with multiple infantry, stores the first infantry's ID (legacy compat).
   *  Use subCellOccupancy for full infantry sub-cell tracking. */
  occupancy: Int32Array;

  /** Sub-cell occupancy: maps cell index → array of 5 entity IDs (0=empty) per sub-cell.
   *  Sub-cells: 0=CENTER, 1=NW, 2=NE, 3=SW, 4=SE (C++ cell.h Flag.Occupy) */
  subCellOccupancy = new Map<number, [number, number, number, number, number]>();

  /** Vehicle/building flag per cell: if true, cell is fully blocked (all sub-cells occupied).
   *  C++ cell.h Flag.Occupy.Vehicle | Flag.Occupy.Monolith | Flag.Occupy.Building */
  vehicleOccupancy = new Set<number>();

  /** DriveClass::Mark_Track reservations. C++ stores these in the same
   *  Flag.Occupy.Vehicle bit; TS keeps owner ids so Stop_Driver clears only
   *  the cells reserved by that unit. */
  vehicleTrackReservations = new Map<number, number>();

  /** Fog of war: 0=shroud, 1=fog (explored), 2=visible */
  visibility: Uint8Array;

  /** Terrain template data from MapPack (set by scenario loader) — uint16 per cell */
  templateType: Uint16Array;
  templateIcon: Uint8Array;

  /** Overlay types from OverlayPack (0xFF = no overlay) */
  overlay: Uint8Array;

  /** C++ CellClass::OverlayData for ore/gems.
   *  0xFF means "not initialized" for tests/manual overlay writes. */
  oreDensity: Uint8Array;

  /** Wall type at each cell ('' = no wall, 'SBAG'/'FENC'/'BARB'/'BRIK' = wall type) */
  wallType: string[];

  /** C++ CellClass::OverlayData damage-level component for walls.
   *  TS renders wall connections independently, so this stores only the
   *  accumulated Reduce_Wall() damage level. */
  wallDamageLevel: Uint8Array;

  /** Tree type at each cell ('' = none, 't01'-'t17'/'tc01'-'tc05' = tree sprite, '_clump' = covered by nearby clump origin) */
  treeType: string[];

  /** C++ TerrainClass objects — trees with HP, keyed by origin cell index.
   *  cpp-parity: RA terrain.cpp — trees are objects with HP and ARMOR_WOOD. */
  trees = new Map<number, MapTree>();

  /** Cell indices occupied by trees (blocks ground unit movement).
   *  cpp-parity: RA tdata.cpp Occupy_List — each tree blocks specific cells. */
  treeOccupied = new Set<number>();

  /** Reverse lookup: cell index → MapTree that occupies it (for damage routing) */
  private treeCellToTree = new Map<number, MapTree>();

  /** Non-tree TerrainClass objects keyed by origin cell.
   *  cpp-parity: RA tdata.cpp BOXES/MINE Occupy_List cells block movement. */
  terrainObjects = new Map<number, MapTerrainObject>();

  /** Cell indices occupied by non-tree TerrainClass objects. */
  terrainObjectOccupied = new Set<number>();

  /** Reverse lookup: cell index → terrain object occupying it. */
  private terrainObjectCellToObject = new Map<number, MapTerrainObject>();

  /** Terrain decals: scorch marks and craters from explosions (capped at 200) */
  decals: Array<{ cx: number; cy: number; size: number; alpha: number }> = [];
  private static readonly MAX_DECALS = 200;

  /** Add a terrain decal (capped to prevent memory growth) */
  addDecal(cx: number, cy: number, size: number, alpha: number): void {
    if (this.decals.length >= GameMap.MAX_DECALS) {
      // Remove oldest decal (FIFO)
      this.decals.shift();
    }
    this.decals.push({ cx, cy, size, alpha });
  }

  /** Cell triggers: maps cell index to trigger name (set by scenario loader) */
  cellTriggers = new Map<number, string>();

  /** Set of cell trigger names that have been activated by player entry */
  activatedCellTriggers = new Set<string>();

  /** Pre-placed smudge marks (scorch, craters) from scenario INI */
  smudges: Array<{ type: string; cx: number; cy: number }> = [];

  /** Indices of cells currently marked visible (for efficient downgrade) */
  private visibleCells: number[] = [];

  constructor() {
    this.cells = new Array(MAP_CELLS * MAP_CELLS).fill(Terrain.CLEAR);
    this.occupancy = new Int32Array(MAP_CELLS * MAP_CELLS);
    this.visibility = new Uint8Array(MAP_CELLS * MAP_CELLS);
    this.templateType = new Uint16Array(MAP_CELLS * MAP_CELLS);
    this.templateIcon = new Uint8Array(MAP_CELLS * MAP_CELLS);
    this.overlay = new Uint8Array(MAP_CELLS * MAP_CELLS).fill(0xFF);
    this.oreDensity = new Uint8Array(MAP_CELLS * MAP_CELLS).fill(0xFF);
    this.wallType = new Array(MAP_CELLS * MAP_CELLS).fill('');
    this.wallDamageLevel = new Uint8Array(MAP_CELLS * MAP_CELLS);
    this.treeType = new Array(MAP_CELLS * MAP_CELLS).fill('');
    this.boundsX = 0;
    this.boundsY = 0;
    this.boundsW = MAP_CELLS;
    this.boundsH = MAP_CELLS;
  }

  /** Set map bounds from scenario data */
  setBounds(x: number, y: number, w: number, h: number): void {
    this.boundsX = x;
    this.boundsY = y;
    this.boundsW = w;
    this.boundsH = h;
  }

  /** Get terrain at a cell position */
  getTerrain(cx: number, cy: number): Terrain {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) {
      return Terrain.ROCK; // out of bounds = impassable
    }
    return this.cells[cy * MAP_CELLS + cx];
  }

  /** Set terrain at a cell position */
  setTerrain(cx: number, cy: number, terrain: Terrain): void {
    if (cx >= 0 && cx < MAP_CELLS && cy >= 0 && cy < MAP_CELLS) {
      this.cells[cy * MAP_CELLS + cx] = terrain;
    }
  }

  /** Get wall type at a cell ('' if no wall) */
  getWallType(cx: number, cy: number): string {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return '';
    return this.wallType[cy * MAP_CELLS + cx];
  }

  /** Set wall type at a cell */
  setWallType(cx: number, cy: number, type: string): void {
    if (cx >= 0 && cx < MAP_CELLS && cy >= 0 && cy < MAP_CELLS) {
      const idx = cy * MAP_CELLS + cx;
      this.wallType[idx] = type;
      this.wallDamageLevel[idx] = 0;
    }
  }

  /** Clear wall type at a cell */
  clearWallType(cx: number, cy: number): void {
    if (cx >= 0 && cx < MAP_CELLS && cy >= 0 && cy < MAP_CELLS) {
      const idx = cy * MAP_CELLS + cx;
      this.wallType[idx] = '';
      this.wallDamageLevel[idx] = 0;
    }
  }

  /** Get accumulated wall damage levels (C++ OverlayData >> 4 approximation). */
  getWallDamageLevel(cx: number, cy: number): number {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return 0;
    return this.wallDamageLevel[cy * MAP_CELLS + cx] ?? 0;
  }

  /** Set accumulated wall damage levels. */
  setWallDamageLevel(cx: number, cy: number, level: number): void {
    if (cx >= 0 && cx < MAP_CELLS && cy >= 0 && cy < MAP_CELLS) {
      this.wallDamageLevel[cy * MAP_CELLS + cx] = Math.max(0, Math.min(255, level | 0));
    }
  }

  /** Get tree type at a cell ('' if no tree type stored) */
  getTreeType(cx: number, cy: number): string {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return '';
    return this.treeType[cy * MAP_CELLS + cx];
  }

  /** Set tree type at a cell */
  setTreeType(cx: number, cy: number, type: string): void {
    if (cx >= 0 && cx < MAP_CELLS && cy >= 0 && cy < MAP_CELLS) {
      this.treeType[cy * MAP_CELLS + cx] = type;
    }
  }

  /** Clear tree type at a cell */
  clearTreeType(cx: number, cy: number): void {
    if (cx >= 0 && cx < MAP_CELLS && cy >= 0 && cy < MAP_CELLS) {
      this.treeType[cy * MAP_CELLS + cx] = '';
    }
  }

  /** Register a tree object on the map. Called during scenario loading.
   *  cpp-parity: RA terrain.cpp TerrainClass::Unlimbo — places tree and marks occupancy. */
  addTree(tree: MapTree): void {
    const idx = tree.cy * MAP_CELLS + tree.cx;
    this.trees.set(idx, tree);
    const maxIdx = MAP_CELLS * MAP_CELLS;
    for (const cellIdx of tree.occupyCells) {
      if (cellIdx >= 0 && cellIdx < maxIdx) {
        this.treeOccupied.add(cellIdx);
        this.treeCellToTree.set(cellIdx, tree);
      }
    }
  }

  /** Register a non-tree TerrainClass object on the map.
   *  cpp-parity: RA terrain.cpp TerrainClass::Unlimbo + tdata.cpp Occupy_List. */
  addTerrainObject(type: string, cx: number, cy: number, occupyOffsets: [number, number][]): void {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return;
    const occupyCells: number[] = [];
    for (const [dx, dy] of occupyOffsets) {
      const ocx = cx + dx;
      const ocy = cy + dy;
      if (ocx >= 0 && ocx < MAP_CELLS && ocy >= 0 && ocy < MAP_CELLS) {
        occupyCells.push(ocy * MAP_CELLS + ocx);
      }
    }
    const object: MapTerrainObject = { type, cx, cy, occupyCells };
    this.terrainObjects.set(cy * MAP_CELLS + cx, object);
    for (const cellIdx of occupyCells) {
      this.terrainObjectOccupied.add(cellIdx);
      this.terrainObjectCellToObject.set(cellIdx, object);
    }
  }

  /** Get the tree object that occupies a given cell (any of its occupy cells).
   *  Returns undefined if no tree occupies this cell. */
  getTreeAtCell(cx: number, cy: number): MapTree | undefined {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return undefined;
    return this.treeCellToTree.get(cy * MAP_CELLS + cx);
  }

  /** Get tree by origin cell. */
  getTreeAtOrigin(cx: number, cy: number): MapTree | undefined {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return undefined;
    return this.trees.get(cy * MAP_CELLS + cx);
  }

  /** Destroy a tree — clear its occupancy and tree type.
   *  cpp-parity: RA terrain.cpp Start_To_Crumble + destructor — removes tree from map. */
  destroyTree(tree: MapTree): void {
    // Clear occupancy
    for (const cellIdx of tree.occupyCells) {
      this.treeOccupied.delete(cellIdx);
      this.treeCellToTree.delete(cellIdx);
    }
    // Clear tree type on all cells this tree covers. Do not change Terrain:
    // C++ TerrainClass objects sit on top of the underlying template Land_Type.
    const originIdx = tree.cy * MAP_CELLS + tree.cx;
    this.trees.delete(originIdx);
    this.clearTreeType(tree.cx, tree.cy);
    // Clear satellite cells (clump _clump markers)
    const occupy = TREE_OCCUPY[tree.type];
    if (occupy) {
      for (const [dx, dy] of occupy) {
        const scx = tree.cx + dx, scy = tree.cy + dy;
        if (this.getTreeType(scx, scy) === '_clump' || this.getTreeType(scx, scy) === tree.type) {
          this.clearTreeType(scx, scy);
        }
      }
    }
  }

  /** Check if a cell is occupied by a tree (blocks ground movement).
   *  cpp-parity: RA terrain.cpp Occupy_List — occupied cells are impassable. */
  isTreeOccupied(cx: number, cy: number): boolean {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return false;
    return this.treeOccupied.has(cy * MAP_CELLS + cx);
  }

  /** Check if a cell is occupied by a non-tree TerrainClass object. */
  isTerrainObjectOccupied(cx: number, cy: number): boolean {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return false;
    return this.terrainObjectOccupied.has(cy * MAP_CELLS + cx);
  }

  /** Get the non-tree TerrainClass object that occupies a given cell. */
  getTerrainObjectAtCell(cx: number, cy: number): MapTerrainObject | undefined {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return undefined;
    return this.terrainObjectCellToObject.get(cy * MAP_CELLS + cx);
  }

  /** Check if a cell is passable (terrain + occupancy).
   *  C++ parity: pathfinding extends 1 cell beyond map bounds.
   *  Map bounds define the visible area, not the pathfinding boundary. */
  isPassable(cx: number, cy: number): boolean {
    if (cx < this.boundsX - 1 || cx >= this.boundsX + this.boundsW + 1 ||
        cy < this.boundsY - 1 || cy >= this.boundsY + this.boundsH + 1) {
      return false;
    }
    if (!PASSABLE.has(this.getTerrain(cx, cy))) return false;
    // C++ parity: TerrainClass Occupy_List cells block ground movement.
    if (this.isTreeOccupied(cx, cy) || this.isTerrainObjectOccupied(cx, cy)) return false;
    return true;
  }

  /** Check if a cell is passable ignoring unit occupancy (but respects terrain + tree occupancy).
   *  cpp-parity: tree-occupied cells are impassable even when ignoring unit occupancy. */
  isTerrainPassable(cx: number, cy: number): boolean {
    if (!PASSABLE.has(this.getTerrain(cx, cy))) return false;
    if (this.isTreeOccupied(cx, cy) || this.isTerrainObjectOccupied(cx, cy)) return false;
    // C++ CellClass::Is_Clear_To_Move (cell.cpp:2764-2784): wall overlays
    // block normal ground movement-zone and path checks unless the caller is
    // doing crusher/destroyer-specific wall handling. TS uses this predicate
    // for ordinary ground movers and zone construction.
    if (this.wallType[cy * MAP_CELLS + cx] !== '') return false;
    return true;
  }

  /** C++ cell.cpp:498-503 Is_Clear_To_Build — check if a cell allows building placement.
   *  Only CLEAR terrain is buildable (C++ Ground[land].Build).
   *  ORE, ROUGH, BEACH are passable for movement but NOT buildable.
   *  C++ cell.cpp:498-501 — Is_Bridge_Here() prohibits building on bridge cells.
   *  cpp-parity: rules.cpp:864, cell.cpp:453-513, cell.cpp:498-501 */
  isBuildable(cx: number, cy: number): boolean {
    if (cx < this.boundsX || cx >= this.boundsX + this.boundsW ||
        cy < this.boundsY || cy >= this.boundsY + this.boundsH) {
      return false;
    }
    if (!BUILDABLE.has(this.getTerrain(cx, cy))) return false;
    // C++ cell.cpp:498-501 — Is_Bridge_Here(): bridge template cells block building placement
    if (this.isBridgeCell(cx, cy)) return false;
    return true;
  }

  /** C++ cell.cpp:2828-2850 Is_Bridge_Here — check if cell has a bridge template. */
  isBridgeCell(cx: number, cy: number): boolean {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return false;
    const tmpl = this.templateType[cy * MAP_CELLS + cx];
    return tmpl === 131 || tmpl === 133 || tmpl === 235 || tmpl === 236 ||
           tmpl === 238 || tmpl === 239 || tmpl === 241 || tmpl === 242 ||
           tmpl === 378 || tmpl === 379;
  }

  /** Check if a cell is water-passable (for naval units) */
  isWaterPassable(cx: number, cy: number): boolean {
    if (cx < this.boundsX || cx >= this.boundsX + this.boundsW ||
        cy < this.boundsY || cy >= this.boundsY + this.boundsH) {
      return false;
    }
    return this.getTerrain(cx, cy) === Terrain.WATER;
  }

  /** Check water passability without bounds restriction — for cells outside map boundary.
   *  C++ MapPack covers the full 128x128 grid; cells outside visible bounds still have terrain. */
  isWaterPassableRelaxed(cx: number, cy: number): boolean {
    if (cx < 0 || cx >= 128 || cy < 0 || cy >= 128) return false;
    return this.getTerrain(cx, cy) === Terrain.WATER;
  }

  /** Check if a cell is a shore cell (land cell adjacent to water) */
  isShoreCell(cx: number, cy: number): boolean {
    if (!this.isPassable(cx, cy)) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (this.getTerrain(cx + dx, cy + dy) === Terrain.WATER) return true;
      }
    }
    return false;
  }

  /** C++ drive.cpp Ground[terrain].Cost[speed_class] — terrain speed multiplier.
   *  cpp-parity: uses TERRAIN_SPEED lookup table from types.ts which matches RULES.INI values.
   *  Defaults to WHEEL if no speedClass provided (backward compat with pathfinding).
   *  WINGED always 1.0 (rules.cpp:862 hardcoded). TREE treated as Clear (C++ parity). */
  getSpeedMultiplier(cx: number, cy: number, speedClass: SpeedClass = SpeedClass.WHEEL): number {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return 1.0;
    // C++ rules.cpp:862 — WINGED always fixed(1), aircraft ignore terrain
    if (speedClass === SpeedClass.WINGED) return 1.0;
    const terrain = this.cells[cy * MAP_CELLS + cx];

    // Map Terrain enum to TERRAIN_SPEED table key
    // C++ parity: TREE cells use Clear speed (trees are TerrainClass on CLEAR cells)
    const terrainKey = TERRAIN_NAME_MAP[terrain];
    const entry = TERRAIN_SPEED[terrainKey];
    if (!entry) return 1.0; // unknown terrain defaults to full speed

    return Math.min(entry[speedClass], 1.0);
  }

  /** Check if cell is within playable bounds */
  inBounds(cx: number, cy: number): boolean {
    return cx >= this.boundsX && cx < this.boundsX + this.boundsW &&
           cy >= this.boundsY && cy < this.boundsY + this.boundsH;
  }

  /** Set occupancy (entity ID or 0 to clear) */
  setOccupancy(cx: number, cy: number, entityId: number): void {
    if (cx >= 0 && cx < MAP_CELLS && cy >= 0 && cy < MAP_CELLS) {
      this.occupancy[cy * MAP_CELLS + cx] = entityId;
    }
  }

  /** Get occupying entity ID at cell (0 = empty) */
  getOccupancy(cx: number, cy: number): number {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return -1;
    return this.occupancy[cy * MAP_CELLS + cx];
  }

  private refreshSubCellOccupancy(cellIdx: number): void {
    const slots = this.subCellOccupancy.get(cellIdx);
    if (slots) {
      for (let i = 0; i < 5; i++) {
        if (slots[i] !== 0) {
          this.occupancy[cellIdx] = slots[i];
          return;
        }
      }
    }
    if (!this.vehicleOccupancy.has(cellIdx) && !this.vehicleTrackReservations.has(cellIdx)) {
      this.occupancy[cellIdx] = 0;
    }
  }

  /** Clear all sub-cell occupancy data (called at start of each tick rebuild) */
  clearSubCellOccupancy(): void {
    this.subCellOccupancy.clear();
    this.vehicleOccupancy.clear();
  }

  /** Overlay persistent DriveClass track reservations onto this tick's grid. */
  applyVehicleTrackReservations(): void {
    for (const [idx, entityId] of this.vehicleTrackReservations) {
      if (this.occupancy[idx] === 0) this.occupancy[idx] = entityId;
    }
  }

  /** Mark a vehicle/building as occupying a cell (blocks all sub-cells).
   *  C++ cell.h: Flag.Occupy.Vehicle = true */
  setVehicleOccupancy(cx: number, cy: number, entityId: number): void {
    if (cx >= 0 && cx < MAP_CELLS && cy >= 0 && cy < MAP_CELLS) {
      const idx = cy * MAP_CELLS + cx;
      this.vehicleOccupancy.add(idx);
      this.occupancy[idx] = entityId;
    }
  }

  /** Move a vehicle's physical occupy bit during DriveClass movement.
   *  C++ updates cell occupation as vehicles cross track cells inside the
   *  object AI pass; pathfinding later in the same tick must see the new cell,
   *  not the position from the tick-start occupancy rebuild. */
  moveVehicleOccupancy(oldCx: number, oldCy: number, newCx: number, newCy: number, entityId: number): void {
    if (oldCx === newCx && oldCy === newCy) return;
    if (oldCx >= 0 && oldCx < MAP_CELLS && oldCy >= 0 && oldCy < MAP_CELLS) {
      const oldIdx = oldCy * MAP_CELLS + oldCx;
      this.vehicleOccupancy.delete(oldIdx);
      if (this.occupancy[oldIdx] === entityId) {
        this.refreshSubCellOccupancy(oldIdx);
        if (this.occupancy[oldIdx] === 0) {
          const reservedBy = this.vehicleTrackReservations.get(oldIdx);
          if (reservedBy) this.occupancy[oldIdx] = reservedBy;
        }
      }
    }
    this.setVehicleOccupancy(newCx, newCy, entityId);
  }

  setVehicleTrackReservation(cellIdx: number, entityId: number): void {
    if (cellIdx < 0 || cellIdx >= MAP_CELLS * MAP_CELLS) return;
    this.vehicleTrackReservations.set(cellIdx, entityId);
    if (this.occupancy[cellIdx] === 0) this.occupancy[cellIdx] = entityId;
  }

  clearVehicleTrackReservation(cellIdx: number, entityId: number): void {
    if (cellIdx < 0 || cellIdx >= MAP_CELLS * MAP_CELLS) return;
    if (this.vehicleTrackReservations.get(cellIdx) !== entityId) return;
    this.vehicleTrackReservations.delete(cellIdx);
    if (this.occupancy[cellIdx] === entityId && !this.vehicleOccupancy.has(cellIdx)) {
      this.refreshSubCellOccupancy(cellIdx);
      if (this.occupancy[cellIdx] === 0) {
        const reservedBy = this.vehicleTrackReservations.get(cellIdx);
        if (reservedBy) this.occupancy[cellIdx] = reservedBy;
      }
    }
  }

  getVehicleTrackReservation(cx: number, cy: number): number {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return 0;
    return this.vehicleTrackReservations.get(cy * MAP_CELLS + cx) ?? 0;
  }

  /** Occupy a sub-cell for an infantry unit. Returns the assigned sub-cell index (0-4),
   *  or -1 if all sub-cells are full or a vehicle is present.
   *  C++ cell.cpp Closest_Free_Spot: prefers CENTER (0), then corners in order. */
  occupySubCell(cx: number, cy: number, entityId: number, preferred = -1): number {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return -1;
    const idx = cy * MAP_CELLS + cx;
    // Vehicle/building blocks all sub-cells
    if (this.vehicleOccupancy.has(idx) || this.vehicleTrackReservations.has(idx)) return -1;
    let slots = this.subCellOccupancy.get(idx);
    if (!slots) {
      slots = [0, 0, 0, 0, 0];
      this.subCellOccupancy.set(idx, slots);
    }
    // C++ parity: try the entity's preferred sub-cell first (from INI placement
    // or previous tick). This preserves lepton positions across ticks, matching
    // C++ where infantry keep their sub-cell from Unlimbo unless displaced.
    if (preferred >= 0 && preferred < 5 && slots[preferred] === 0) {
      slots[preferred] = entityId;
      if (this.occupancy[idx] === 0) this.occupancy[idx] = entityId;
      return preferred;
    }
    // C++ Closest_Free_Spot preference order: CENTER (0) first, then NW(1), NE(2), SW(3), SE(4)
    const order = [0, 1, 2, 3, 4];
    for (const s of order) {
      if (slots[s] === 0) {
        slots[s] = entityId;
        if (this.occupancy[idx] === 0) this.occupancy[idx] = entityId;
        return s;
      }
    }
    return -1; // all 5 sub-cells occupied
  }

  /** Restore an infantry destination claim by absolute cell index.
   *  C++ InfantryClass::Start_Driver clears the current occupy bit and sets
   *  the destination occupy bit while the infantry is in transit. */
  occupyClaimedSubCell(cellIdx: number, entityId: number, subCell: number): boolean {
    if (cellIdx < 0 || cellIdx >= MAP_CELLS * MAP_CELLS || subCell < 0 || subCell >= 5) return false;
    if (this.vehicleOccupancy.has(cellIdx) || this.vehicleTrackReservations.has(cellIdx)) return false;

    let slots = this.subCellOccupancy.get(cellIdx);
    if (!slots) {
      slots = [0, 0, 0, 0, 0];
      this.subCellOccupancy.set(cellIdx, slots);
    }

    if (slots[subCell] !== 0 && slots[subCell] !== entityId) return false;
    slots[subCell] = entityId;
    if (this.occupancy[cellIdx] === 0) this.occupancy[cellIdx] = entityId;
    return true;
  }

  /** Clear an infantry destination claim by absolute cell index. */
  vacateClaimedSubCell(cellIdx: number, entityId: number, subCell: number): void {
    if (cellIdx < 0 || cellIdx >= MAP_CELLS * MAP_CELLS || subCell < 0 || subCell >= 5) return;
    const slots = this.subCellOccupancy.get(cellIdx);
    if (slots && slots[subCell] === entityId) {
      slots[subCell] = 0;
      this.refreshSubCellOccupancy(cellIdx);
    }
  }

  /** Vacate a sub-cell when an infantry unit leaves a cell.
   *  Called when infantry dies, is loaded into transport, etc. */
  vacateSubCell(cx: number, cy: number, entityId: number): void {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return;
    const idx = cy * MAP_CELLS + cx;
    const slots = this.subCellOccupancy.get(idx);
    if (slots) {
      for (let i = 0; i < 5; i++) {
        if (slots[i] === entityId) {
          slots[i] = 0;
          this.refreshSubCellOccupancy(idx);
          break;
        }
      }
    }
  }

  /** Get the number of occupied sub-cells in a cell */
  getSubCellCount(cx: number, cy: number): number {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return 5;
    const idx = cy * MAP_CELLS + cx;
    if (this.vehicleOccupancy.has(idx) || this.vehicleTrackReservations.has(idx)) return 5;
    const slots = this.subCellOccupancy.get(idx);
    if (!slots) return 0;
    let count = 0;
    for (let i = 0; i < 5; i++) {
      if (slots[i] !== 0) count++;
    }
    return count;
  }

  /** Check if a cell has any available sub-cells for infantry */
  hasAvailableSubCell(cx: number, cy: number): boolean {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return false;
    const idx = cy * MAP_CELLS + cx;
    if (this.vehicleOccupancy.has(idx) || this.vehicleTrackReservations.has(idx)) return false;
    const slots = this.subCellOccupancy.get(idx);
    if (!slots) return true; // no occupants = all 5 free
    for (let i = 0; i < 5; i++) {
      if (slots[i] === 0) return true;
    }
    return false;
  }

  /** Check if a cell has a vehicle occupying it (blocks all sub-cells) */
  hasVehicleOccupancy(cx: number, cy: number): boolean {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return false;
    const idx = cy * MAP_CELLS + cx;
    return this.vehicleOccupancy.has(idx) || this.vehicleTrackReservations.has(idx);
  }

  /** Check if cell is only occupied by infantry (no vehicles/buildings).
   *  Used by infantry movement to determine if cell can accept more infantry. */
  isOnlyInfantryOccupied(cx: number, cy: number): boolean {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return false;
    const idx = cy * MAP_CELLS + cx;
    if (this.vehicleOccupancy.has(idx) || this.vehicleTrackReservations.has(idx)) return false;
    const slots = this.subCellOccupancy.get(idx);
    if (!slots) return false;
    for (let i = 0; i < 5; i++) {
      if (slots[i] !== 0) return true;
    }
    return false;
  }

  /** Get visibility at cell: 0=shroud, 1=fog, 2=visible */
  getVisibility(cx: number, cy: number): number {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return 0;
    return this.visibility[cy * MAP_CELLS + cx];
  }

  /** Set visibility at cell.
   *  C++ parity: any cell set to visible (2) must be tracked for fog-of-war
   *  downgrade, regardless of how it became visible. */
  setVisibility(cx: number, cy: number, v: number): void {
    if (cx >= 0 && cx < MAP_CELLS && cy >= 0 && cy < MAP_CELLS) {
      const idx = cy * MAP_CELLS + cx;
      this.visibility[idx] = v;
      if (v === 2) {
        this.visibleCells.push(idx);
      }
    }
  }

  /** Reveal the entire map (all cells set to visible) */
  revealAll(): void {
    this.visibility.fill(2);
    // Track all cells for fog-of-war downgrade (C++ parity)
    this.visibleCells.length = 0;
    for (let i = 0; i < MAP_CELLS * MAP_CELLS; i++) {
      this.visibleCells.push(i);
    }
  }

  /** Shroud the entire map — C++ Map.Shroud_The_Map() parity.
   *  Resets all cells to shroud (0). Used when GPS is lost (ATEK destroyed).
   *  The normal fog-of-war update will re-reveal around player units next tick. */
  shroudAll(): void {
    for (let i = 0; i < this.visibility.length; i++) {
      if (this.visibility[i] > 0) this.visibility[i] = 0;
    }
    this.visibleCells.length = 0;
  }

  /** Creep shadow: downgrade all visible/fog cells back to shroud (darkness).
   *  Used by SCA04EA tunnel mission — map reshrouds periodically until power is restored. */
  creepShadow(): void {
    this.shroudAll();
  }

  /** Update fog of war: downgrade visible to fog, then reveal around units */
  updateFogOfWar(units: Array<{ x: number; y: number; sight: number }>): void {
    // Downgrade only previously visible cells to fog (O(visible) instead of O(16384))
    for (const idx of this.visibleCells) {
      if (this.visibility[idx] === 2) this.visibility[idx] = 1;
    }
    this.visibleCells.length = 0;

    // Reveal around each player unit (with LOS blocking)
    for (const u of units) {
      const cx = Math.floor(u.x / CELL_SIZE);
      const cy = Math.floor(u.y / CELL_SIZE);
      const s = u.sight;
      const sThreshold = s * 2;  // C++ coord.cpp:124-136 octagonal distance
      for (let dy = -s; dy <= s; dy++) {
        for (let dx = -s; dx <= s; dx++) {
          const adx = Math.abs(dx);
          const ady = Math.abs(dy);
          const big = adx > ady ? adx : ady;
          const small = adx > ady ? ady : adx;
          if (big * 2 + small <= sThreshold) {
            const rx = cx + dx;
            const ry = cy + dy;
            if (rx >= 0 && rx < MAP_CELLS && ry >= 0 && ry < MAP_CELLS) {
              // C++ map.cpp:286-344 Sight_From: reveals ALL cells in radius
              // using precomputed octagonal offset table — NO LOS terrain blocking.
              const idx = ry * MAP_CELLS + rx;
              if (this.visibility[idx] !== 2) {
                this.visibility[idx] = 2;
                this.visibleCells.push(idx);
              }
            }
          }
        }
      }
    }
  }

  /** Bresenham line-of-sight: check if a clear line exists between two cells.
   *  Returns true if no opaque cell (ROCK, WALL) blocks the line.
   *  Water and trees are transparent (you can see over water/through sparse trees). */
  hasLineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    // Don't check start or end cell — only intermediate cells
    while (x0 !== x1 || y0 !== y1) {
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx)  { err += dx; y0 += sy; }
      // Check the intermediate cell (skip destination)
      if (x0 === x1 && y0 === y1) break;
      const t = this.getTerrain(x0, y0);
      if (t === Terrain.ROCK || t === Terrain.WALL) return false;
    }
    return true;
  }

  /** Count intact bridge cells (C++ parity: map.cpp:2045-2073 Intact_Bridge_Count)
   *  Scans ALL map cells (not just bounds) for bridge templates with icon==6.
   *  C++ counts only TEMPLATE_BRIDGE1/1H/2/2H/1A/1B with TIcon==6 as the
   *  "bridge center" tile that represents an intact bridge section. */
  countBridgeCells(): number {
    // C++ bridge template IDs (defines.h enum TemplateType, 0-based):
    // TEMPLATE_BRIDGE1=131, TEMPLATE_BRIDGE2=133,
    // TEMPLATE_BRIDGE_1A=235, TEMPLATE_BRIDGE_1B=236,
    // TEMPLATE_BRIDGE1H=378, TEMPLATE_BRIDGE2H=379
    const BRIDGE_TEMPLATES = new Set([131, 133, 235, 236, 378, 379]);
    let count = 0;
    for (let i = 0; i < MAP_CELLS * MAP_CELLS; i++) {
      if (BRIDGE_TEMPLATES.has(this.templateType[i]) && this.templateIcon[i] === 6) {
        count++;
      }
    }
    return count;
  }

  /** Destroy bridge cells in a radius (set to WATER) — returns number destroyed */
  /** Destroy bridge cells in a radius — implements C++ two-phase destruction.
   *  C++ map.cpp:1797-1864: Phase 1 converts intact → half-destroyed (passable).
   *  Phase 2 converts half-destroyed → fully destroyed (WATER, impassable).
   *  Returns number of cells affected (phase transitions count). */
  destroyBridge(cx: number, cy: number, radius: number): number {
    let count = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const rx = cx + dx;
        const ry = cy + dy;
        if (rx < 0 || rx >= MAP_CELLS || ry < 0 || ry >= MAP_CELLS) continue;
        const idx = ry * MAP_CELLS + rx;
        const tmpl = this.templateType[idx];
        // C++ map.cpp:1797-1812 Phase 1: intact → half-destroyed (BRIDGE1→BRIDGE1H, BRIDGE2→BRIDGE2H)
        if (tmpl === 131) {
          this.templateType[idx] = 378; // BRIDGE1 → BRIDGE1H
          count++;
        } else if (tmpl === 133) {
          this.templateType[idx] = 379; // BRIDGE2 → BRIDGE2H
          count++;
        }
        // C++ map.cpp:1814-1864 Phase 2: half-destroyed → fully destroyed (WATER)
        else if (tmpl === 378 || tmpl === 379) {
          this.templateType[idx] = 1;
          this.setTerrain(rx, ry, Terrain.WATER);
          count++;
        }
        // Multi-part bridge pieces: direct to water (simplified from C++ state machine)
        else if (tmpl === 235 || tmpl === 236 || tmpl === 238 || tmpl === 239 || tmpl === 241 || tmpl === 242) {
          this.templateType[idx] = 1;
          this.setTerrain(rx, ry, Terrain.WATER);
          count++;
        }
      }
    }
    return count;
  }

  // === Ore/Gem overlay constants (C++ defines.h:1480-1508) ===
  // Gold ore: OVERLAY_GOLD1..4 = 5..8 — visual variants
  // Gems:     OVERLAY_GEMS1..4 = 9..12 — visual variants
  // Actual harvestable amount lives in CellClass::OverlayData.
  // No overlay: 0xFF
  static readonly OVERLAY_GOLD1 = 5;
  static readonly OVERLAY_GOLD2 = 6;
  static readonly OVERLAY_GOLD3 = 7;
  static readonly OVERLAY_GOLD4 = 8;
  static readonly OVERLAY_GEMS1 = 9;
  static readonly OVERLAY_GEMS2 = 10;
  static readonly OVERLAY_GEMS3 = 11;
  static readonly OVERLAY_GEMS4 = 12;

  /** Ore regrowth interval in ticks — C++ map.cpp:1017 scans
   *  MAP_CELL_TOTAL / (GrowthRate * TICKS_PER_MINUTE) = 9 cells/frame.
   *  Because TiberiumScan is assigned to the boundary index after `break`,
   *  the next frame reprocesses that cell and advances by 8 new cells. */
  static readonly ORE_GROWTH_INTERVAL = 2048;

  /** C++ map.h:160 — MAP_CELL_W/2 = 128/2 = 64. Maximum cells processed per growth/spread cycle.
   *  When more eligible cells exist, reservoir sampling selects exactly this many. */
  static readonly RESERVOIR_SIZE = 64;

  /** C++ MapClass::Logic incremental ore scan state (map.cpp:1017-1098). */
  private tiberiumScan = 0;
  private tiberiumGrowth: number[] = [];
  private tiberiumSpread: number[] = [];
  private tiberiumGrowthExcess = 0;
  private tiberiumSpreadExcess = 0;
  private oreLogicLastTick = 0;

  /** Minimum gold OverlayData level required for ore to spread (C++ Can_Tiberium_Spread: > 6). */
  static readonly ORE_SPREAD_MIN_DENSITY = 6;

  private static readonly ORE_DENSITY_UNKNOWN = 0xFF;

  static isGoldOverlayId(ovl: number): boolean {
    return ovl >= GameMap.OVERLAY_GOLD1 && ovl <= GameMap.OVERLAY_GOLD4;
  }

  static isGemOverlayId(ovl: number): boolean {
    return ovl >= GameMap.OVERLAY_GEMS1 && ovl <= GameMap.OVERLAY_GEMS4;
  }

  static isOreOverlayId(ovl: number): boolean {
    return GameMap.isGoldOverlayId(ovl) || GameMap.isGemOverlayId(ovl);
  }

  private inferLegacyOreDensity(ovl: number): number {
    if (GameMap.isGoldOverlayId(ovl)) return ovl - GameMap.OVERLAY_GOLD1;
    if (GameMap.isGemOverlayId(ovl)) return ovl - GameMap.OVERLAY_GEMS1;
    return 0;
  }

  private oreDataAt(idx: number): number {
    const ovl = this.overlay[idx];
    if (!GameMap.isOreOverlayId(ovl)) return 0;
    const density = this.oreDensity[idx];
    if (density !== GameMap.ORE_DENSITY_UNKNOWN) return density;
    const inferred = this.inferLegacyOreDensity(ovl);
    this.oreDensity[idx] = inferred;
    return inferred;
  }

  /** Initialize C++ CellClass::OverlayData for scenario ore overlays.
   *  Tiberium_Adjust(true) derives density from adjacent ore count; overlay IDs
   *  are visual variants, not the amount of harvestable ore. */
  initializeOreDensityFromOverlay(): void {
    this.initializeOreDensity(false);
  }

  /** C++ MapClass::Overpass -> CellClass::Tiberium_Adjust(true).
   *  At scenario load, C++ randomizes each ore/gem visual overlay inside the
   *  playable map while also deriving OverlayData from adjacent ore count.
   *  This is gameplay RNG, so the startup seed must consume these picks. */
  applyScenarioOreOverpass(): void {
    this.initializeOreDensity(true);
  }

  private initializeOreDensity(randomizeVisualVariants: boolean): void {
    const goldByAdj = [0, 1, 3, 4, 6, 7, 8, 10, 11];
    const gemByAdj = [0, 0, 0, 1, 1, 1, 2, 2, 2];
    const dirs: [number, number][] = [
      [0, -1], [1, -1], [1, 0], [1, 1],
      [0, 1], [-1, 1], [-1, 0], [-1, -1],
    ];

    this.oreDensity.fill(GameMap.ORE_DENSITY_UNKNOWN);
    const minCx = randomizeVisualVariants ? this.boundsX : 0;
    const minCy = randomizeVisualVariants ? this.boundsY : 0;
    const maxCx = randomizeVisualVariants ? this.boundsX + this.boundsW : MAP_CELLS;
    const maxCy = randomizeVisualVariants ? this.boundsY + this.boundsH : MAP_CELLS;

    for (let cy = minCy; cy < maxCy; cy++) {
      for (let cx = minCx; cx < maxCx; cx++) {
        const idx = cy * MAP_CELLS + cx;
        const ovl = this.overlay[idx];
        const isGold = GameMap.isGoldOverlayId(ovl);
        const isGem = GameMap.isGemOverlayId(ovl);
        if (!isGold && !isGem) continue;

        if (randomizeVisualVariants) {
          this.overlay[idx] = isGold
            ? ScenarioRandom.nextInRange(GameMap.OVERLAY_GOLD1, GameMap.OVERLAY_GOLD4)
            : ScenarioRandom.nextInRange(GameMap.OVERLAY_GEMS1, GameMap.OVERLAY_GEMS4);
        }

        let count = 0;
        for (const [dx, dy] of dirs) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= MAP_CELLS || ny < 0 || ny >= MAP_CELLS) continue;
          if (GameMap.isOreOverlayId(this.overlay[ny * MAP_CELLS + nx])) count++;
        }

        this.oreDensity[idx] = isGem
          ? Math.min(gemByAdj[count], 2)
          : goldByAdj[count];
        this.cells[idx] = Terrain.ORE;
      }
    }
  }

  /** Ore regrowth — C++ two-phase reservoir sampling model (map.cpp:1017-1098).
   *
   *  Phase 1 (Scan): each Map.Logic frame scans a small chunk of map cells,
   *  collecting eligible cells into two arrays:
   *    - TiberiumGrowth[]: cells where Can_Tiberium_Grow() is true (gold, OverlayData < 11)
   *    - TiberiumSpread[]: cells where Can_Tiberium_Spread() is true (gold, OverlayData > 6)
   *    If more than RESERVOIR_SIZE (64) eligible, use C++ reservoir sampling.
   *
   *  Phase 2 (Apply): after the incremental full scan completes:
   *    - Grow_Tiberium() on all growth-selected cells (deterministic OverlayData++, no random)
   *    - Spread_Tiberium() on all spread-selected cells (random start dir, first valid neighbor)
   *
   *  C++ refs: map.cpp:1028-1060 (reservoir), cell.cpp:2936-2944 (grow), cell.cpp:2963-2979 (spread)
   *  EC6: Only gold overlays grow/spread — gems (9..12) never grow or spread.
   *  EC7: Spread requires density > 6 and uses all 8 directions.
   *  @param tick Current game tick */
  growOre(tick: number): void {
    if (tick <= 0) return;

    // In the game loop this is called once per TS tick (TS tick 1 == C++ Frame 0).
    // Unit tests often jump directly to tick 2048; process the skipped C++ frames
    // so a single jumped call still represents the same elapsed simulation time.
    const targetTick = Math.floor(tick);
    const steps = Math.max(0, targetTick - this.oreLogicLastTick);
    for (let i = 0; i < steps; i++) {
      this.processOreLogicFrame();
    }
    this.oreLogicLastTick = Math.max(this.oreLogicLastTick, targetTick);
  }

  private processOreLogicFrame(): void {
    const MAP_TOTAL = MAP_CELLS * MAP_CELLS;
    const subcountTotal = Math.max(Math.floor(MAP_TOTAL / (2 * 900)), 1);
    let subcount = subcountTotal;
    let index = this.tiberiumScan;

    // C++ map.cpp:1020-1064. The `break` leaves index at the last processed
    // cell; assigning TiberiumScan=index intentionally reprocesses that boundary
    // cell on the next frame, matching the original for-loop semantics.
    for (; index < MAP_TOTAL; index++) {
      if (this.inRadarIndex(index)) {
        const ovl = this.overlay[index];
        if (GameMap.isGoldOverlayId(ovl)) {
          const density = this.oreDataAt(index);

          if (density < 11) {
            this.sampleOreCell(this.tiberiumGrowth, this.tiberiumGrowthExcess, index);
            this.tiberiumGrowthExcess++;
          }

          if (density > GameMap.ORE_SPREAD_MIN_DENSITY) {
            this.sampleOreCell(this.tiberiumSpread, this.tiberiumSpreadExcess, index);
            this.tiberiumSpreadExcess++;
          }
        }
      }

      subcount--;
      if (subcount === 0) break;
    }

    this.tiberiumScan = index;
    if (this.tiberiumScan >= MAP_TOTAL) {
      this.tiberiumScan = 0;
      this.applyOreGrowthAndSpread();
    }
  }

  private inRadarIndex(idx: number): boolean {
    const cx = idx % MAP_CELLS;
    const cy = Math.floor(idx / MAP_CELLS);
    return cx >= this.boundsX && cx < this.boundsX + this.boundsW &&
      cy >= this.boundsY && cy < this.boundsY + this.boundsH;
  }

  private sampleOreCell(reservoir: number[], excess: number, cell: number): void {
    // C++ map.cpp:1034/1052: Random_Pick(0, Excess) <= Count.
    // Random_Pick(0,0) returns immediately without consuming RNG, just like C++.
    if (ScenarioRandom.nextInRange(0, excess) <= reservoir.length) {
      if (reservoir.length < GameMap.RESERVOIR_SIZE) {
        reservoir.push(cell);
      } else {
        reservoir[ScenarioRandom.nextInRange(0, reservoir.length - 1)] = cell;
      }
    }
  }

  private applyOreGrowthAndSpread(): void {
    for (const idx of this.tiberiumGrowth) {
      const ovl = this.overlay[idx];
      const density = this.oreDataAt(idx);
      if (GameMap.isGoldOverlayId(ovl) && density < 11) {
        this.oreDensity[idx] = density + 1;
      }
    }
    this.tiberiumGrowth.length = 0;
    this.tiberiumGrowthExcess = 0;

    const dirs: [number, number][] = [
      [0, -1], [1, -1], [1, 0], [1, 1],
      [0, 1], [-1, 1], [-1, 0], [-1, -1],
    ];
    const bx = this.boundsX, by = this.boundsY;
    const bw = this.boundsW, bh = this.boundsH;
    for (const idx of this.tiberiumSpread) {
      const sx = idx % MAP_CELLS, sy = Math.floor(idx / MAP_CELLS);
      const offset = ScenarioRandom.nextInRange(0, 7);
      for (let i = 0; i < 8; i++) {
        const [dx, dy] = dirs[(i + offset) % 8];
        const nx = sx + dx, ny = sy + dy;
        if (nx < bx || nx >= bx + bw || ny < by || ny >= by + bh) continue;
        const nidx = ny * MAP_CELLS + nx;
        if (this.overlay[nidx] !== 0xFF) continue;
        if (!BUILDABLE.has(this.cells[nidx])) continue;
        if (this.wallType[nidx] !== '') continue;
        const tmpl = this.templateType[nidx];
        if (tmpl === 131 || tmpl === 133 || tmpl === 235 || tmpl === 236 || tmpl === 378 || tmpl === 379) continue;
        if (this.vehicleOccupancy.has(nidx)) continue;
        this.overlay[nidx] = ScenarioRandom.nextInRange(GameMap.OVERLAY_GOLD1, GameMap.OVERLAY_GOLD4);
        this.oreDensity[nidx] = 0;
        this.cells[nidx] = Terrain.ORE;
        break;
      }
    }
    this.tiberiumSpread.length = 0;
    this.tiberiumSpreadExcess = 0;
  }

  /** Find nearest ore/gem cell using C++ ring/diamond search pattern.
   *  C++ parity: unit.cpp:2218-2243 searches expanding ring perimeters,
   *  returns the FIRST valid cell found (not Euclidean closest).
   *  C++ unit.cpp:2179: rejects cells with Cell_Techno() (buildings/vehicles on ore).
   *  OreNearScan=6, OreFarScan=48 (rules.ini). */
  findNearestOre(cx: number, cy: number, maxRange = 6): CellPos | null {
    // Check center cell first (C++ unit.cpp:2209-2212: already on ore → return immediately)
    if (cx >= 0 && cx < MAP_CELLS && cy >= 0 && cy < MAP_CELLS) {
      const cidx = cy * MAP_CELLS + cx;
      const ovl = this.overlay[cidx];
      // C++ unit.cpp:2209-2212: center cell returns immediately — no Cell_Techno check
      if (GameMap.isOreOverlayId(ovl)) return { cx, cy };
    }

    // C++ unit.cpp:2218-2243: ring search — scan each radius with the
    // exact per-offset order:
    //   top, bottom, left, right for x=-radius..+radius.
    // This is not equivalent to scanning the full top edge, then full
    // bottom edge, then sides. SCG01EA HARV at (69,53): C++ returns
    // (70,52) from the x=-1 right-side check before reaching x=0 bottom
    // (69,54).
    //
    // C++ loop condition is `radius < rad`, so maxRange is exclusive.
    // C++ unit.cpp:2179: `if (!Map[center].Cell_Techno() && ...)`
    // Skip ore cells occupied by buildings/vehicles.
    const r = maxRange;
    for (let radius = 1; radius < r; radius++) {
      for (let x = -radius; x <= radius; x++) {
        const checks: Array<[number, number]> = [
          [cx + x, cy - radius],
          [cx + x, cy + radius],
          [cx - radius, cy + x],
          [cx + radius, cy + x],
        ];
        for (const [tx, ty] of checks) {
          if (tx < 0 || tx >= MAP_CELLS || ty < 0 || ty >= MAP_CELLS) continue;
          const tidx = ty * MAP_CELLS + tx;
          const ovl = this.overlay[tidx];
          if (GameMap.isOreOverlayId(ovl) && !this.vehicleOccupancy.has(tidx)) return { cx: tx, cy: ty };
        }
      }
    }
    return null;
  }

  /** Deplete one bail of ore/gem at a cell. Returns credit value per bail (0 if empty).
   *  C++ parity: gold ore = 25 credits/bail (rules.ini GoldValue=25), gems = 50 credits/bail (rules.ini GemValue=50). */
  depleteOre(cx: number, cy: number): number {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return 0;
    const idx = cy * MAP_CELLS + cx;
    const ovl = this.overlay[idx];
    if (GameMap.isGoldOverlayId(ovl)) {
      // Gold ore (OVERLAY_GOLD1..4) — 25 credits per bail (rules.ini GoldValue=25)
      const density = this.oreDataAt(idx);
      if (density > 0) {
        this.oreDensity[idx] = density - 1;
        return 25;
      }
      this.overlay[idx] = 0xFF;
      this.oreDensity[idx] = GameMap.ORE_DENSITY_UNKNOWN;
      if (this.cells[idx] === Terrain.ORE) this.cells[idx] = Terrain.CLEAR;
      return 0;
    } else if (GameMap.isGemOverlayId(ovl)) {
      // Gems (GEM01-GEM04) — 50 credits per bail (rules.ini GemValue=50)
      const density = this.oreDataAt(idx);
      if (density > 0) {
        this.oreDensity[idx] = density - 1;
        return 50;
      }
      this.overlay[idx] = 0xFF;
      this.oreDensity[idx] = GameMap.ORE_DENSITY_UNKNOWN;
      if (this.cells[idx] === Terrain.ORE) this.cells[idx] = Terrain.CLEAR;
      return 0;
    }
    return 0;
  }

  /** Destroy one ore OverlayData level without awarding credits (combat splash). */
  reduceOreLevel(cx: number, cy: number): void {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return;
    const idx = cy * MAP_CELLS + cx;
    const ovl = this.overlay[idx];
    if (!GameMap.isOreOverlayId(ovl)) return;
    const density = this.oreDataAt(idx);
    if (density > 0) {
      this.oreDensity[idx] = density - 1;
    } else {
      this.overlay[idx] = 0xFF;
      this.oreDensity[idx] = GameMap.ORE_DENSITY_UNKNOWN;
      if (this.cells[idx] === Terrain.ORE) this.cells[idx] = Terrain.CLEAR;
    }
  }

  /** Check if overlay at a cell is a gem overlay (OVERLAY_GEMS1..4 = 9..12) */
  isGemOverlay(cx: number, cy: number): boolean {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return false;
    const ovl = this.overlay[cy * MAP_CELLS + cx];
    return GameMap.isGemOverlayId(ovl);
  }

  /** Find an adjacent water cell around a structure footprint (for naval production spawn).
   *  Scans the perimeter of a WxH structure at (cx,cy) for the first water-passable cell.
   *  Returns null if no water cell found. */
  findAdjacentWaterCell(cx: number, cy: number, w: number, h: number): CellPos | null {
    // Scan perimeter cells (1 cell outside the footprint)
    for (let dy = -1; dy <= h; dy++) {
      for (let dx = -1; dx <= w; dx++) {
        // Only check perimeter, not interior
        if (dx >= 0 && dx < w && dy >= 0 && dy < h) continue;
        const rx = cx + dx;
        const ry = cy + dy;
        if (this.isWaterPassable(rx, ry) && this.getOccupancy(rx, ry) === 0) {
          return { cx: rx, cy: ry };
        }
      }
    }
    return null;
  }

  // === Agent 9: Gap Generator shroud methods ===

  /** Jammed cells tracking — maps cell index to jam count (allows overlapping GAPs) */
  jammedCells = new Map<number, number>();

  /** Jam a cell — set visibility to 0 (shrouded) for enemy view.
   *  Increments jam count so overlapping Gap Generators work correctly. */
  jamCell(cx: number, cy: number): void {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return;
    const idx = cy * MAP_CELLS + cx;
    const count = this.jammedCells.get(idx) ?? 0;
    this.jammedCells.set(idx, count + 1);
    // Shroud the cell for enemy view
    if (this.visibility[idx] > 0) {
      this.visibility[idx] = 0;
    }
  }

  /** Unjam a cell — decrements jam count, restores visibility when fully unjammed. */
  unjamCell(cx: number, cy: number): void {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return;
    const idx = cy * MAP_CELLS + cx;
    const count = this.jammedCells.get(idx) ?? 0;
    if (count <= 1) {
      this.jammedCells.delete(idx);
      // Restore to fog (explored but not visible) — updateFogOfWar will handle the rest
      this.visibility[idx] = 1;
    } else {
      this.jammedCells.set(idx, count - 1);
    }
  }

  /** Unjam all cells in a radius around a position.
   *  C++ coord.cpp:124-136 octagonal distance: max*2+min <= radius*2 */
  unjamRadius(cx: number, cy: number, radius: number): void {
    const threshold = radius * 2;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        const big = adx > ady ? adx : ady;
        const small = adx > ady ? ady : adx;
        if (big * 2 + small <= threshold) {
          this.unjamCell(cx + dx, cy + dy);
        }
      }
    }
  }

  /** PF3: C++ Can_Enter_Cell — returns nuanced MoveResult for pathfinding.
   *  @param isMoving Optional callback: given occupant entity ID, returns true if that entity is currently moving
   *  @param isInfantry If true, cell is passable if sub-cells are available (C++ infantry sub-cell system) */
  canEnterCell(cx: number, cy: number, naval = false, isMoving?: (entityId: number) => boolean, isInfantry = false, ignoreEntityId = 0): MoveResult {
    // C++ parity: pathfinding extends 1 cell beyond map bounds.
    if (cx < this.boundsX - 1 || cx >= this.boundsX + this.boundsW + 1 ||
        cy < this.boundsY - 1 || cy >= this.boundsY + this.boundsH + 1) {
      return MoveResult.IMPASSABLE;
    }
    const passable = naval ? this.getTerrain(cx, cy) === Terrain.WATER : PASSABLE.has(this.getTerrain(cx, cy));
    if (!passable) return MoveResult.IMPASSABLE;

    // C++ parity: TerrainClass objects occupy cells and block ground movement
    // (RA terrain.cpp Occupy_List). Both infantry and vehicles are blocked.
    if (!naval && (this.treeOccupied.has(cy * MAP_CELLS + cx) || this.terrainObjectOccupied.has(cy * MAP_CELLS + cx))) {
      return MoveResult.IMPASSABLE;
    }
    if (!naval && this.wallType[cy * MAP_CELLS + cx] !== '') {
      return MoveResult.IMPASSABLE;
    }

    // Infantry sub-cell check: infantry can enter if sub-cells are available
    if (isInfantry) {
      const idx = cy * MAP_CELLS + cx;
      // C++ InfantryClass::Can_Enter_Cell checks the Cell_Occupier chain first,
      // then treats a bare Flag.Occupy.Vehicle bit as MOVE_NO (infantry.cpp:1490).
      // Mark_Track reservations are exactly that bare occupy bit: no infantry-
      // shareable object lives in the cell, so the pathfinder must not route
      // through it as a temporary moving block.
      if (this.vehicleTrackReservations.has(idx)) return MoveResult.IMPASSABLE;
      // Physical vehicles/buildings block all infantry sub-cells. Full
      // ally/enemy severity is entity-context dependent; callers with that
      // context refine goal-cell handling in basicPathGoalMoveResult().
      if (this.vehicleOccupancy.has(idx)) return MoveResult.OCCUPIED;
      // Check if any sub-cell is free
      if (this.hasAvailableSubCell(cx, cy)) return MoveResult.OK;
      return MoveResult.OCCUPIED; // all 5 sub-cells full
    }

    const reservationOwner = this.getVehicleTrackReservation(cx, cy);
    const occupant = this.getOccupancy(cx, cy);
    if (occupant > 0 && occupant !== ignoreEntityId) {
      // C++ VesselClass::Can_Enter_Cell (vessel.cpp:293-314) does not walk the
      // Cell_Occupier chain and does not return MOVE_TEMP for stationary
      // friendly vessels. Any vehicle occupy bit in a water cell is
      // MOVE_MOVING_BLOCK, so DriveClass will not call CellClass::Incoming on
      // naval blockers.
      if (naval) return MoveResult.OCCUPIED;
      if (reservationOwner === occupant) return MoveResult.OCCUPIED;
      // C++ unit.cpp:3176-3194: moving ally → MOVE_MOVING_BLOCK(2), stationary ally → MOVE_TEMP(4)
      if (isMoving && isMoving(occupant)) return MoveResult.OCCUPIED;   // MOVE_MOVING_BLOCK(2)
      return MoveResult.TEMP_BLOCKED;                                    // MOVE_TEMP(4)
    }
    if (reservationOwner > 0 && reservationOwner !== ignoreEntityId) {
      return MoveResult.OCCUPIED; // C++ Flag.Occupy.Vehicle → MOVE_MOVING_BLOCK
    }
    return MoveResult.OK;
  }

  /** Initialize a basic map with impassable borders */
  initDefault(): void {
    // Fill playable area with clear terrain
    for (let cy = this.boundsY; cy < this.boundsY + this.boundsH; cy++) {
      for (let cx = this.boundsX; cx < this.boundsX + this.boundsW; cx++) {
        this.setTerrain(cx, cy, Terrain.CLEAR);
      }
    }
    // Mark outside bounds as rock
    for (let cy = 0; cy < MAP_CELLS; cy++) {
      for (let cx = 0; cx < MAP_CELLS; cx++) {
        if (!this.inBounds(cx, cy)) {
          this.setTerrain(cx, cy, Terrain.ROCK);
        }
      }
    }
  }
}
