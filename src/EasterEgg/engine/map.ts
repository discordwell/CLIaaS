/**
 * Map system — terrain grid, passability, cell occupancy.
 * The map is 128×128 cells but only a portion (typically 50×50) is playable.
 */

import { MAP_CELLS, CELL_SIZE, type CellPos, SpeedClass, TEMPLATE_ROAD_MIN, TEMPLATE_ROAD_MAX, TERRAIN_SPEED } from './types';

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

const PASSABLE = new Set([Terrain.CLEAR, Terrain.ROAD, Terrain.ORE, Terrain.ROUGH, Terrain.BEACH]);

/** C++ rules.cpp:864 Ground[land].Build — only CLEAR and ROAD terrain allow building placement.
 *  ORE, ROUGH, BEACH are passable for movement but NOT buildable.
 *  cpp-parity: rules.cpp:844-864 _lands[] defaults. */
const BUILDABLE = new Set([Terrain.CLEAR, Terrain.ROAD]);

/** Map Terrain enum values to TERRAIN_SPEED table keys.
 *  C++ parity: TREE maps to 'Rock' (trees are impassable terrain objects in C++). */
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
  [Terrain.TREE]: 'Rock', // C++ parity — trees are TerrainClass on CLEAR, but impassable like Rock
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

  /** Check if a cell is passable (terrain + occupancy) */
  isPassable(cx: number, cy: number): boolean {
    if (cx < this.boundsX || cx >= this.boundsX + this.boundsW ||
        cy < this.boundsY || cy >= this.boundsY + this.boundsH) {
      return false;
    }
    return PASSABLE.has(this.getTerrain(cx, cy));
  }

  /** Check if a cell is passable ignoring occupancy */
  isTerrainPassable(cx: number, cy: number): boolean {
    return PASSABLE.has(this.getTerrain(cx, cy));
  }

  /** C++ cell.cpp:498-503 Is_Clear_To_Build — check if a cell allows building placement.
   *  Only CLEAR terrain is buildable (C++ Ground[land].Build).
   *  ORE, ROUGH, BEACH are passable for movement but NOT buildable.
   *  cpp-parity: rules.cpp:864, cell.cpp:453-513 */
  isBuildable(cx: number, cy: number): boolean {
    if (cx < this.boundsX || cx >= this.boundsX + this.boundsW ||
        cy < this.boundsY || cy >= this.boundsY + this.boundsH) {
      return false;
    }
    return BUILDABLE.has(this.getTerrain(cx, cy));
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
   *  WINGED always 1.0 (rules.cpp:862 hardcoded). TREE treated as Rock (C++ parity). */
  getSpeedMultiplier(cx: number, cy: number, speedClass: SpeedClass = SpeedClass.WHEEL): number {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return 1.0;
    // C++ rules.cpp:862 — WINGED always fixed(1), aircraft ignore terrain
    if (speedClass === SpeedClass.WINGED) return 1.0;
    const terrain = this.cells[cy * MAP_CELLS + cx];

    // Map Terrain enum to TERRAIN_SPEED table key
    // C++ parity: TREE cells use Rock speed (impassable, 0.0 for all ground)
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
      const s2 = s * s;
      for (let dy = -s; dy <= s; dy++) {
        for (let dx = -s; dx <= s; dx++) {
          if (dx * dx + dy * dy <= s2) {
            const rx = cx + dx;
            const ry = cy + dy;
            if (rx >= 0 && rx < MAP_CELLS && ry >= 0 && ry < MAP_CELLS) {
              // Check line of sight from unit to this cell
              if (!this.hasLineOfSight(cx, cy, rx, ry)) continue;
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
    // C++ bridge template IDs (defines.h):
    // TEMPLATE_BRIDGE1=236, TEMPLATE_BRIDGE1H=238, TEMPLATE_BRIDGE2=237,
    // TEMPLATE_BRIDGE2H=239, TEMPLATE_BRIDGE_1A=241, TEMPLATE_BRIDGE_1B=242
    const BRIDGE_TEMPLATES = new Set([236, 237, 238, 239, 241, 242]);
    let count = 0;
    for (let i = 0; i < MAP_CELLS * MAP_CELLS; i++) {
      if (BRIDGE_TEMPLATES.has(this.templateType[i]) && this.templateIcon[i] === 6) {
        count++;
      }
    }
    return count;
  }

  /** Destroy bridge cells in a radius (set to WATER) — returns number destroyed */
  destroyBridge(cx: number, cy: number, radius: number): number {
    let count = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const rx = cx + dx;
        const ry = cy + dy;
        if (rx < 0 || rx >= MAP_CELLS || ry < 0 || ry >= MAP_CELLS) continue;
        const idx = ry * MAP_CELLS + rx;
        const tmpl = this.templateType[idx];
        if (tmpl >= 235 && tmpl <= 252) {
          this.templateType[idx] = 1; // water template
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

  /** Ore regrowth interval in ticks — C++ OverlayClass::AI() runs growth roughly
   *  every 256 game ticks (~17 seconds at 15 FPS). */
  static readonly ORE_GROWTH_INTERVAL = 256;

  /** Probability of an existing ore cell increasing one density level per growth cycle.
   *  C++ behavior: roughly 1 in 2 chance per cell per cycle. */
  static readonly ORE_DENSITY_CHANCE = 0.5;

  /** Probability of an ore cell spreading to one random adjacent empty cell per cycle.
   *  C++ behavior: roughly 1 in 4 chance per cell per cycle. */
  static readonly ORE_SPREAD_CHANCE = 0.25;

  /** Minimum gold density level required for ore to spread (C++ parity: density > 6 on 0-12 scale).
   *  Gold overlay range is 0x03 (density 0) to 0x0E (density 11), so density > 6 means overlay > 0x09. */
  static readonly ORE_SPREAD_MIN_DENSITY = 0x09;

  /** Ore regrowth — existing gold ore cells increase in density and spread to adjacent empty cells.
   *  Matches C++ OverlayClass::AI() behavior: growth fires every ~256 ticks.
   *  EC6: Only gold overlays grow/spread — gems (0x0F-0x12) never grow or spread.
   *  EC7: Spread requires density > 6 and uses all 8 directions (N, NE, E, SE, S, SW, W, NW).
   *  Fully depleted patches (all cells at 0xFF) never regrow — there must be a seed cell.
   *  Only spreads to CLEAR terrain cells with no wall and no existing overlay.
   *  @param tick Current game tick */
  growOre(tick: number): void {
    if (tick % GameMap.ORE_GROWTH_INTERVAL !== 0 || tick === 0) return;

    const bx = this.boundsX, by = this.boundsY;
    const bw = this.boundsW, bh = this.boundsH;
    // EC7: All 8 directions (N, NE, E, SE, S, SW, W, NW) for ore spread
    const dirs: [number, number][] = [
      [0, -1], [1, -1], [1, 0], [1, 1],
      [0, 1], [-1, 1], [-1, 0], [-1, -1],
    ];

    for (let cy = by; cy < by + bh; cy++) {
      for (let cx = bx; cx < bx + bw; cx++) {
        const idx = cy * MAP_CELLS + cx;
        const ovl = this.overlay[idx];

        // EC6: Only gold ore grows/spreads — skip gems entirely
        const isGold = ovl >= 0x03 && ovl <= 0x0E;
        if (!isGold) continue;

        // Density growth: increase overlay index if not at max
        if (Math.random() < GameMap.ORE_DENSITY_CHANCE) {
          if (ovl < 0x0E) {
            this.overlay[idx] = ovl + 1;
          }
        }

        // EC7: Spread requires density > 6 (overlay > 0x09)
        if (ovl <= GameMap.ORE_SPREAD_MIN_DENSITY) continue;

        // EC7: Spread to first valid adjacent cell, starting from random direction (C++ Spread_Tiberium)
        if (Math.random() < GameMap.ORE_SPREAD_CHANCE) {
          const offset = Math.floor(Math.random() * 8);
          for (let i = 0; i < 8; i++) {
            const [dx, dy] = dirs[(i + offset) % 8];
            const nx = cx + dx, ny = cy + dy;
            if (nx < bx || nx >= bx + bw || ny < by || ny >= by + bh) continue;
            const nidx = ny * MAP_CELLS + nx;
            if (this.overlay[nidx] !== 0xFF) continue;
            if (!BUILDABLE.has(this.cells[nidx])) continue;
            if (this.wallType[nidx] !== '') continue;
            // Gold always spreads as gold (minimum density)
            this.overlay[nidx] = 0x03;
            break; // C++: spread to first valid cell only
          }
        }
      }
    }
  }

  /** Find nearest ore/gem cell to a given position (returns null if none) */
  findNearestOre(cx: number, cy: number, maxRange = 20): CellPos | null {
    let bestDist = Infinity;
    let best: CellPos | null = null;
    const r = maxRange;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const rx = cx + dx;
        const ry = cy + dy;
        if (rx < 0 || rx >= MAP_CELLS || ry < 0 || ry >= MAP_CELLS) continue;
        const ovl = this.overlay[ry * MAP_CELLS + rx];
        if (ovl >= 0x03 && ovl <= 0x12) { // gold ore or gems
          const dist = dx * dx + dy * dy;
          if (dist < bestDist) {
            bestDist = dist;
            best = { cx: rx, cy: ry };
          }
        }
      }
    }
    return best;
  }

  /** Deplete one bail of ore/gem at a cell. Returns credit value per bail (0 if empty).
   *  C++ parity: gold ore = 35 credits/bail (OverlayTypeClass GOLD), gems = 110 credits/bail. */
  depleteOre(cx: number, cy: number): number {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return 0;
    const idx = cy * MAP_CELLS + cx;
    const ovl = this.overlay[idx];
    if (ovl >= 0x03 && ovl <= 0x0E) {
      // Gold ore (GOLD01-GOLD12) — 35 credits per bail (C++ overlay.cpp)
      if (ovl > 0x03) {
        this.overlay[idx] = ovl - 1;
      } else {
        this.overlay[idx] = 0xFF; // fully depleted
      }
      return 35;
    } else if (ovl >= 0x0F && ovl <= 0x12) {
      // Gems (GEM01-GEM04) — 110 credits per bail (C++ overlay.cpp)
      if (ovl > 0x0F) {
        this.overlay[idx] = ovl - 1;
      } else {
        this.overlay[idx] = 0xFF;
      }
      return 110;
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

  /** Unjam all cells in a radius around a position. */
  unjamRadius(cx: number, cy: number, radius: number): void {
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= r2) {
          this.unjamCell(cx + dx, cy + dy);
        }
      }
    }
  }

  /** PF3: C++ Can_Enter_Cell — returns nuanced MoveResult for pathfinding.
   *  @param isMoving Optional callback: given occupant entity ID, returns true if that entity is currently moving
   *  @param isInfantry If true, cell is passable if sub-cells are available (C++ infantry sub-cell system) */
  canEnterCell(cx: number, cy: number, naval = false, isMoving?: (entityId: number) => boolean, isInfantry = false): MoveResult {
    if (cx < this.boundsX || cx >= this.boundsX + this.boundsW ||
        cy < this.boundsY || cy >= this.boundsY + this.boundsH) {
      return MoveResult.IMPASSABLE;
    }
    const passable = naval ? this.getTerrain(cx, cy) === Terrain.WATER : PASSABLE.has(this.getTerrain(cx, cy));
    if (!passable) return MoveResult.IMPASSABLE;

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
      if (isMoving && isMoving(occupant)) return MoveResult.TEMP_BLOCKED;
      return MoveResult.OCCUPIED;
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
