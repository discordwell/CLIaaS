/**
 * Map system — terrain grid, passability, cell occupancy.
 * The map is 128×128 cells but only a portion (typically 50×50) is playable.
 */

import { MAP_CELLS, CELL_SIZE, type CellPos } from './types';

export enum Terrain {
  CLEAR = 0,
  WATER = 1,
  ROCK = 2,
  TREE = 3,
  WALL = 4,
}

const PASSABLE = new Set([Terrain.CLEAR]);

export class GameMap {
  /** 128×128 grid of terrain types */
  cells: Terrain[];

  /** Map bounds (playable area within the 128×128 grid) */
  boundsX: number;
  boundsY: number;
  boundsW: number;
  boundsH: number;

  /** Occupancy: entity ID at each cell (0 = empty) */
  occupancy: Int32Array;

  /** Fog of war: 0=shroud, 1=fog (explored), 2=visible */
  visibility: Uint8Array;

  /** Terrain template data from MapPack (set by scenario loader) */
  templateType: Uint8Array;
  templateIcon: Uint8Array;

  /** Overlay types from OverlayPack (0xFF = no overlay) */
  overlay: Uint8Array;

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

  /** Indices of cells currently marked visible (for efficient downgrade) */
  private visibleCells: number[] = [];

  constructor() {
    this.cells = new Array(MAP_CELLS * MAP_CELLS).fill(Terrain.CLEAR);
    this.occupancy = new Int32Array(MAP_CELLS * MAP_CELLS);
    this.visibility = new Uint8Array(MAP_CELLS * MAP_CELLS);
    this.templateType = new Uint8Array(MAP_CELLS * MAP_CELLS);
    this.templateIcon = new Uint8Array(MAP_CELLS * MAP_CELLS);
    this.overlay = new Uint8Array(MAP_CELLS * MAP_CELLS).fill(0xFF);
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

  /** Get visibility at cell: 0=shroud, 1=fog, 2=visible */
  getVisibility(cx: number, cy: number): number {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return 0;
    return this.visibility[cy * MAP_CELLS + cx];
  }

  /** Set visibility at cell */
  setVisibility(cx: number, cy: number, v: number): void {
    if (cx >= 0 && cx < MAP_CELLS && cy >= 0 && cy < MAP_CELLS) {
      this.visibility[cy * MAP_CELLS + cx] = v;
    }
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

  /** Deplete one level of ore/gem at a cell. Returns credits gained (0 if empty). */
  depleteOre(cx: number, cy: number): number {
    if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return 0;
    const idx = cy * MAP_CELLS + cx;
    const ovl = this.overlay[idx];
    if (ovl >= 0x03 && ovl <= 0x0E) {
      // Gold ore (GOLD01-GOLD12) — each level worth ~25 credits
      if (ovl > 0x03) {
        this.overlay[idx] = ovl - 1;
      } else {
        this.overlay[idx] = 0xFF; // fully depleted
      }
      return 25;
    } else if (ovl >= 0x0F && ovl <= 0x12) {
      // Gems (GEM01-GEM04) — each level worth ~50 credits
      if (ovl > 0x0F) {
        this.overlay[idx] = ovl - 1;
      } else {
        this.overlay[idx] = 0xFF;
      }
      return 50;
    }
    return 0;
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
