/**
 * Map system — terrain grid, passability, cell occupancy.
 * The map is 128×128 cells but only a portion (typically 50×50) is playable.
 */

import { MAP_CELLS, CELL_SIZE, type CellPos, SpeedClass, TEMPLATE_ROAD_MIN, TEMPLATE_ROAD_MAX, TERRAIN_SPEED } from './types';
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

  /** Fog of war: 0=shroud, 1=fog (explored), 2=visible */
  visibility: Uint8Array;

  /** Terrain template data from MapPack (set by scenario loader) — uint16 per cell */
  templateType: Uint16Array;
  templateIcon: Uint8Array;

  /** Overlay types from OverlayPack (0xFF = no overlay) */
  overlay: Uint8Array;

  /** Wall type at each cell ('' = no wall, 'SBAG'/'FENC'/'BARB'/'BRIK' = wall type) */
  wallType: string[];

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
    this.wallType = new Array(MAP_CELLS * MAP_CELLS).fill('');
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
      this.wallType[cy * MAP_CELLS + cx] = type;
    }
  }

  /** Clear wall type at a cell */
  clearWallType(cx: number, cy: number): void {
    if (cx >= 0 && cx < MAP_CELLS && cy >= 0 && cy < MAP_CELLS) {
      this.wallType[cy * MAP_CELLS + cx] = '';
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

  /** Destroy a tree — clear its occupancy, terrain, and tree type.
   *  cpp-parity: RA terrain.cpp Start_To_Crumble + destructor — removes tree from map. */
  destroyTree(tree: MapTree): void {
    // Clear occupancy
    for (const cellIdx of tree.occupyCells) {
      this.treeOccupied.delete(cellIdx);
      this.treeCellToTree.delete(cellIdx);
    }
    // Clear tree type and terrain on all cells this tree covers
    const originIdx = tree.cy * MAP_CELLS + tree.cx;
    this.trees.delete(originIdx);
    // Clear origin cell
    this.clearTreeType(tree.cx, tree.cy);
    if (this.getTerrain(tree.cx, tree.cy) === Terrain.TREE) {
      this.setTerrain(tree.cx, tree.cy, Terrain.CLEAR);
    }
    // Clear satellite cells (clump _clump markers and TREE terrain)
    const occupy = TREE_OCCUPY[tree.type];
    if (occupy) {
      for (const [dx, dy] of occupy) {
        const scx = tree.cx + dx, scy = tree.cy + dy;
        if (this.getTreeType(scx, scy) === '_clump' || this.getTreeType(scx, scy) === tree.type) {
          this.clearTreeType(scx, scy);
        }
        if (this.getTerrain(scx, scy) === Terrain.TREE) {
          this.setTerrain(scx, scy, Terrain.CLEAR);
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

  /** Check if a cell is passable (terrain + occupancy).
   *  C++ parity: pathfinding extends 1 cell beyond map bounds.
   *  Map bounds define the visible area, not the pathfinding boundary. */
  isPassable(cx: number, cy: number): boolean {
    if (cx < this.boundsX - 1 || cx >= this.boundsX + this.boundsW + 1 ||
        cy < this.boundsY - 1 || cy >= this.boundsY + this.boundsH + 1) {
      return false;
    }
    if (!PASSABLE.has(this.getTerrain(cx, cy))) return false;
    // C++ parity: tree-occupied cells block ground movement
    if (this.isTreeOccupied(cx, cy)) return false;
    return true;
  }

  /** Check if a cell is passable ignoring unit occupancy (but respects terrain + tree occupancy).
   *  cpp-parity: tree-occupied cells are impassable even when ignoring unit occupancy. */
  isTerrainPassable(cx: number, cy: number): boolean {
    if (!PASSABLE.has(this.getTerrain(cx, cy))) return false;
    if (this.isTreeOccupied(cx, cy)) return false;
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

    // Check if cell has a road template overlay (overrides terrain speed)
    const tmpl = this.templateType[cy * MAP_CELLS + cx];
    const isRoad = tmpl >= TEMPLATE_ROAD_MIN && tmpl <= TEMPLATE_ROAD_MAX;
    if (isRoad && terrain === Terrain.CLEAR) {
      const roadEntry = TERRAIN_SPEED['Road'];
      if (roadEntry) return Math.min(roadEntry[speedClass], 1.0);
    }

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

  /** Clear all sub-cell occupancy data (called at start of each tick rebuild) */
  clearSubCellOccupancy(): void {
    this.subCellOccupancy.clear();
    this.vehicleOccupancy.clear();
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

  /** Occupy a sub-cell for an infantry unit. Returns the assigned sub-cell index (0-4),
   *  or -1 if all sub-cells are full or a vehicle is present.
   *  C++ cell.cpp Closest_Free_Spot: prefers CENTER (0), then corners in order. */
  occupySubCell(cx: number, cy: number, entityId: number): number {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return -1;
    const idx = cy * MAP_CELLS + cx;
    // Vehicle/building blocks all sub-cells
    if (this.vehicleOccupancy.has(idx)) return -1;
    let slots = this.subCellOccupancy.get(idx);
    if (!slots) {
      slots = [0, 0, 0, 0, 0];
      this.subCellOccupancy.set(idx, slots);
    }
    // C++ Closest_Free_Spot preference order: CENTER (0) first, then NW(1), NE(2), SW(3), SE(4)
    const order = [0, 1, 2, 3, 4];
    for (const s of order) {
      if (slots[s] === 0) {
        slots[s] = entityId;
        // Set legacy occupancy to first infantry's ID for backward compat
        if (this.occupancy[idx] === 0) {
          this.occupancy[idx] = entityId;
        }
        return s;
      }
    }
    return -1; // all 5 sub-cells occupied
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
          break;
        }
      }
    }
  }

  /** Get the number of occupied sub-cells in a cell */
  getSubCellCount(cx: number, cy: number): number {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return 5;
    const idx = cy * MAP_CELLS + cx;
    if (this.vehicleOccupancy.has(idx)) return 5;
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
    if (this.vehicleOccupancy.has(idx)) return false;
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
    return this.vehicleOccupancy.has(cy * MAP_CELLS + cx);
  }

  /** Check if cell is only occupied by infantry (no vehicles/buildings).
   *  Used by infantry movement to determine if cell can accept more infantry. */
  isOnlyInfantryOccupied(cx: number, cy: number): boolean {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return false;
    const idx = cy * MAP_CELLS + cx;
    if (this.vehicleOccupancy.has(idx)) return false;
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

  // === Ore/Gem overlay constants (C++ overlay.cpp) ===
  // Gold ore: 0x03 (GOLD01, min) through 0x0E (GOLD12, max) — 12 density levels
  // Gems:     0x0F (GEM01, min) through 0x12 (GEM04, max) — 4 density levels
  // No overlay: 0xFF

  /** Ore regrowth interval in ticks — C++ map.cpp:1017 scans MAP_CELL_TOTAL / (GrowthRate * TICKS_PER_MINUTE)
   *  = 16384 / (2 * 900) = 9 cells/tick. Full scan: ceil(16384/9) = 1821 ticks (~121s at 15 FPS). */
  static readonly ORE_GROWTH_INTERVAL = 1821;

  /** C++ map.h:160 — MAP_CELL_W/2 = 128/2 = 64. Maximum cells processed per growth/spread cycle.
   *  When more eligible cells exist, reservoir sampling selects exactly this many. */
  static readonly RESERVOIR_SIZE = 64;

  /** Minimum gold density level required for ore to spread (C++ parity: density > 6 on 0-12 scale).
   *  Gold overlay range is 0x03 (density 0) to 0x0E (density 11), so density > 6 means overlay > 0x09. */
  static readonly ORE_SPREAD_MIN_DENSITY = 0x09;

  /** Ore regrowth — C++ two-phase reservoir sampling model (map.cpp:1017-1098).
   *
   *  Phase 1 (Scan): Iterate all map cells, collecting eligible cells into two arrays:
   *    - TiberiumGrowth[]: cells where Can_Tiberium_Grow() is true (gold, OverlayData < 11)
   *    - TiberiumSpread[]: cells where Can_Tiberium_Spread() is true (gold, OverlayData > 6)
   *    If more than RESERVOIR_SIZE (64) eligible, use reservoir sampling to pick exactly 64.
   *
   *  Phase 2 (Apply): After full scan completes:
   *    - Grow_Tiberium() on all growth-selected cells (deterministic OverlayData++, no random)
   *    - Spread_Tiberium() on all spread-selected cells (random start dir, first valid neighbor)
   *
   *  C++ refs: map.cpp:1028-1060 (reservoir), cell.cpp:2936-2944 (grow), cell.cpp:2963-2979 (spread)
   *  EC6: Only gold overlays grow/spread — gems (0x0F-0x12) never grow or spread.
   *  EC7: Spread requires density > 6 and uses all 8 directions.
   *  @param tick Current game tick */
  growOre(tick: number): void {
    if (tick % GameMap.ORE_GROWTH_INTERVAL !== 0 || tick === 0) return;

    const bx = this.boundsX, by = this.boundsY;
    const bw = this.boundsW, bh = this.boundsH;
    const R = GameMap.RESERVOIR_SIZE;

    // ── Phase 1: Scan & collect eligible cells via reservoir sampling ──
    // C++ map.cpp:1028-1060: reservoir sampling into TiberiumGrowth[64] / TiberiumSpread[64]
    const growthCells: number[] = [];  // cell indices eligible for density growth
    const spreadCells: number[] = [];  // cell indices eligible for spread
    let growthSeen = 0;   // total eligible growth cells seen (for reservoir math)
    let spreadSeen = 0;   // total eligible spread cells seen (for reservoir math)

    for (let cy = by; cy < by + bh; cy++) {
      for (let cx = bx; cx < bx + bw; cx++) {
        const idx = cy * MAP_CELLS + cx;
        const ovl = this.overlay[idx];

        // EC6: Only gold ore grows/spreads — skip gems entirely
        // C++ cell.cpp:2881: Overlay must be OVERLAY_GOLD1..GOLD4
        const isGold = ovl >= 0x03 && ovl <= 0x0E;
        if (!isGold) continue;

        // Can_Tiberium_Grow (cell.cpp:2869-2884): gold AND OverlayData < 11
        // TS: ovl < 0x0E means density < 11 (0x0E = density 11 = max)
        if (ovl < 0x0E) {
          // C++ map.cpp:1034: Random_Pick(0, TiberiumGrowthExcess) called for EVERY growable cell.
          // Always consume RNG to match C++ call pattern, even when reservoir isn't full.
          const pick = ScenarioRandom.nextInRange(0, growthSeen);
          if (pick <= growthCells.length) {
            if (growthCells.length < R) {
              growthCells.push(idx);
            } else {
              growthCells[ScenarioRandom.nextInRange(0, growthCells.length - 1)] = idx;
            }
          }
          growthSeen++;
        }

        // Can_Tiberium_Spread (cell.cpp:2904-2918): gold AND OverlayData > 6
        // TS: ovl > 0x09 means density > 6 (0x09 = 0x03 + 6)
        if (ovl > GameMap.ORE_SPREAD_MIN_DENSITY) {
          // C++ map.cpp:1052: Random_Pick(0, TiberiumSpreadExcess) called for EVERY spreadable cell.
          const pick = ScenarioRandom.nextInRange(0, spreadSeen);
          if (pick <= spreadCells.length) {
            if (spreadCells.length < R) {
              spreadCells.push(idx);
            } else {
              spreadCells[ScenarioRandom.nextInRange(0, spreadCells.length - 1)] = idx;
            }
          }
          spreadSeen++;
        }
      }
    }

    // ── Phase 2: Apply growth & spread to sampled cells ──

    // C++ map.cpp:1078-1084: Grow_Tiberium() on ALL sampled cells — deterministic (no random)
    // C++ cell.cpp:2939: OverlayData++ (unconditional increment)
    for (const idx of growthCells) {
      const ovl = this.overlay[idx];
      // Re-check: cell may have been modified by a prior spread in the same cycle (defensive)
      if (ovl >= 0x03 && ovl < 0x0E) {
        this.overlay[idx] = ovl + 1;
      }
    }

    // C++ map.cpp:1091-1094: Spread_Tiberium() on ALL sampled cells — deterministic selection
    // C++ cell.cpp:2963-2979: random start direction, iterate 8 dirs, first valid cell gets ore
    // EC7: All 8 directions (N, NE, E, SE, S, SW, W, NW) for ore spread
    const dirs: [number, number][] = [
      [0, -1], [1, -1], [1, 0], [1, 1],
      [0, 1], [-1, 1], [-1, 0], [-1, -1],
    ];

    for (const idx of spreadCells) {
      const cx = idx % MAP_CELLS;
      const cy = Math.floor(idx / MAP_CELLS);
      // C++ cell.cpp:2968: random starting direction
      const offset = ScenarioRandom.nextInRange(0, 7);
      for (let i = 0; i < 8; i++) {
        const [dx, dy] = dirs[(i + offset) % 8];
        const nx = cx + dx, ny = cy + dy;
        if (nx < bx || nx >= bx + bw || ny < by || ny >= by + bh) continue;
        const nidx = ny * MAP_CELLS + nx;
        // C++ cell.cpp:3012: Overlay must be OVERLAY_NONE
        if (this.overlay[nidx] !== 0xFF) continue;
        // C++ cell.cpp:3010: Ground[Land_Type()].Build must be true (CLEAR and ROAD)
        if (!BUILDABLE.has(this.cells[nidx])) continue;
        // C++ cell.cpp (wall check implied by overlay/buildable)
        if (this.wallType[nidx] !== '') continue;
        // C++ cell.cpp:3000 — reject bridge cells for germination
        const tmpl = this.templateType[nidx];
        if (tmpl === 131 || tmpl === 133 || tmpl === 235 || tmpl === 236 || tmpl === 378 || tmpl === 379) continue;
        // C++ cell.cpp:3007-3008 — reject cells with visible buildings (vehicle/building occupancy)
        if (this.vehicleOccupancy.has(nidx)) continue;
        // C++ cell.cpp:2974: OverlayData = 0 (minimum density)
        this.overlay[nidx] = 0x03;
        break; // C++ cell.cpp:2975: spread to first valid cell only
      }
    }
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
      if (ovl >= 0x03 && ovl <= 0x12) return { cx, cy };
    }

    // C++ unit.cpp:2218-2243: ring search — scan perimeter of each expanding ring.
    // for (radius = 1; radius < rad; radius++)
    //   for (x = -radius; x <= radius; x++)
    //     check (x, -radius), (x, +radius), (-radius, x), (+radius, x)
    // Returns FIRST valid cell found on any ring perimeter.
    // C++ unit.cpp:2179: `if (!Map[center].Cell_Techno() && ...)`
    // Skip ore cells occupied by buildings/vehicles.
    const r = maxRange;
    for (let radius = 1; radius <= r; radius++) {
      for (let x = -radius; x <= radius; x++) {
        // Top edge: (cx+x, cy-radius)
        const ty = cy - radius;
        if (ty >= 0 && ty < MAP_CELLS) {
          const tx = cx + x;
          if (tx >= 0 && tx < MAP_CELLS) {
            const tidx = ty * MAP_CELLS + tx;
            const ovl = this.overlay[tidx];
            // C++ unit.cpp:2179: skip if building/vehicle on cell
            if (ovl >= 0x03 && ovl <= 0x12 && !this.vehicleOccupancy.has(tidx)) return { cx: tx, cy: ty };
          }
        }
        // Bottom edge: (cx+x, cy+radius)
        const by = cy + radius;
        if (by >= 0 && by < MAP_CELLS) {
          const bx = cx + x;
          if (bx >= 0 && bx < MAP_CELLS) {
            const bidx = by * MAP_CELLS + bx;
            const ovl = this.overlay[bidx];
            if (ovl >= 0x03 && ovl <= 0x12 && !this.vehicleOccupancy.has(bidx)) return { cx: bx, cy: by };
          }
        }
      }
      // Left and right edges (exclude corners already checked by top/bottom)
      for (let y = -radius + 1; y <= radius - 1; y++) {
        // Left edge: (cx-radius, cy+y)
        const lx = cx - radius;
        if (lx >= 0 && lx < MAP_CELLS) {
          const ly = cy + y;
          if (ly >= 0 && ly < MAP_CELLS) {
            const lidx = ly * MAP_CELLS + lx;
            const ovl = this.overlay[lidx];
            if (ovl >= 0x03 && ovl <= 0x12 && !this.vehicleOccupancy.has(lidx)) return { cx: lx, cy: ly };
          }
        }
        // Right edge: (cx+radius, cy+y)
        const rx = cx + radius;
        if (rx >= 0 && rx < MAP_CELLS) {
          const ry = cy + y;
          if (ry >= 0 && ry < MAP_CELLS) {
            const ridx = ry * MAP_CELLS + rx;
            const ovl = this.overlay[ridx];
            if (ovl >= 0x03 && ovl <= 0x12 && !this.vehicleOccupancy.has(ridx)) return { cx: rx, cy: ry };
          }
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
    if (ovl >= 0x03 && ovl <= 0x0E) {
      // Gold ore (GOLD01-GOLD12) — 25 credits per bail (rules.ini GoldValue=25)
      if (ovl > 0x03) {
        this.overlay[idx] = ovl - 1;
      } else {
        this.overlay[idx] = 0xFF; // fully depleted
      }
      return 25;
    } else if (ovl >= 0x0F && ovl <= 0x12) {
      // Gems (GEM01-GEM04) — 50 credits per bail (rules.ini GemValue=50)
      if (ovl > 0x0F) {
        this.overlay[idx] = ovl - 1;
      } else {
        this.overlay[idx] = 0xFF;
      }
      return 50;
    }
    return 0;
  }

  /** Check if overlay at a cell is a gem overlay (0x0F-0x12) */
  isGemOverlay(cx: number, cy: number): boolean {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return false;
    const ovl = this.overlay[cy * MAP_CELLS + cx];
    return ovl >= 0x0F && ovl <= 0x12;
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
  canEnterCell(cx: number, cy: number, naval = false, isMoving?: (entityId: number) => boolean, isInfantry = false): MoveResult {
    // C++ parity: pathfinding extends 1 cell beyond map bounds.
    if (cx < this.boundsX - 1 || cx >= this.boundsX + this.boundsW + 1 ||
        cy < this.boundsY - 1 || cy >= this.boundsY + this.boundsH + 1) {
      return MoveResult.IMPASSABLE;
    }
    const passable = naval ? this.getTerrain(cx, cy) === Terrain.WATER : PASSABLE.has(this.getTerrain(cx, cy));
    if (!passable) return MoveResult.IMPASSABLE;

    // C++ parity: trees occupy cells and block ground movement (RA terrain.cpp Occupy_List).
    // Both infantry and vehicles are blocked by tree-occupied cells.
    if (!naval && this.treeOccupied.has(cy * MAP_CELLS + cx)) {
      return MoveResult.IMPASSABLE;
    }

    // Infantry sub-cell check: infantry can enter if sub-cells are available
    if (isInfantry) {
      const idx = cy * MAP_CELLS + cx;
      // Vehicle/building blocks all sub-cells
      if (this.vehicleOccupancy.has(idx)) return MoveResult.OCCUPIED;
      // Check if any sub-cell is free
      if (this.hasAvailableSubCell(cx, cy)) return MoveResult.OK;
      return MoveResult.OCCUPIED; // all 5 sub-cells full
    }

    const occupant = this.getOccupancy(cx, cy);
    if (occupant > 0) {
      // C++ unit.cpp:3176-3194: moving ally → MOVE_MOVING_BLOCK(2), stationary ally → MOVE_TEMP(4)
      if (isMoving && isMoving(occupant)) return MoveResult.OCCUPIED;   // MOVE_MOVING_BLOCK(2)
      return MoveResult.TEMP_BLOCKED;                                    // MOVE_TEMP(4)
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
