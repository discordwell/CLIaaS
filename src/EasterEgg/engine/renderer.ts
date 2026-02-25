/**
 * Canvas 2D renderer — full visual fidelity.
 * Terrain, fog of war, units with death/damage effects,
 * explosions, health bars, selection circles, minimap, UI.
 */

import { CELL_SIZE, GAME_TICKS_PER_SEC, House, Stance, SUB_CELL_OFFSETS, UnitType, BODY_SHAPE, INFANTRY_ANIMS, ANT_ANIM, UNIT_STATS, AnimState, type ProductionItem, CursorType } from './types';
import { type Camera } from './camera';
import { type AssetManager, type TilesetMeta } from './assets';
import { Entity } from './entity';
import { type GameMap, Terrain } from './map';
import { type InputState } from './input';
import { type MapStructure, STRUCTURE_SIZE } from './scenario';

// House color tints (used for unit sprite remapping)
const HOUSE_TINT: Record<string, string> = {
  [House.Spain]:   'rgba(255,255,80,0.25)',   // yellow/gold — player allied
  [House.Greece]:  'rgba(80,180,255,0.25)',    // blue — allied
  [House.USSR]:    'rgba(255,60,60,0.30)',     // red — ant faction
  [House.Ukraine]: 'rgba(200,80,200,0.25)',    // purple — ant faction
  [House.Germany]: 'rgba(160,160,160,0.25)',   // gray — ant faction
  [House.Turkey]:  'rgba(200,200,100,0.25)',   // olive — neutral/scenario
  [House.Neutral]: 'rgba(0,0,0,0)',            // no tint
};

// TEMPERATE.PAL palette index ranges for terrain rendering
// These are the actual palette indices from the extracted TEMPERAT.PAL
const PAL_GRASS_START = 144;  // indices 144-155: green terrain ramp (light→dark)
const PAL_GRASS_COUNT = 12;
const PAL_WATER_START = 96;   // indices 96-102: animated water cycle (ping-pong)
const PAL_WATER_COUNT = 7;
const PAL_ROCK_START = 128;   // indices 128-143: gray ramp (light→dark)
const PAL_ROCK_COUNT = 16;
const PAL_DIRT_START = 80;    // indices 80-95: sand/dirt ramp (gold→dark brown)
const PAL_DIRT_COUNT = 16;
const PAL_GREEN_HP = 120;     // bright green [0,255,0]
const PAL_RED_HP = 104;       // red [190,0,0]

export interface Effect {
  type: 'explosion' | 'muzzle' | 'blood' | 'tesla' | 'projectile' | 'marker' | 'debris' | 'text';
  x: number;
  y: number;
  frame: number;
  maxFrames: number;
  size: number;
  // Sprite-based effect rendering
  sprite?: string;       // sprite sheet name (e.g. 'fball1', 'piff')
  spriteStart?: number;  // first frame index in the sheet
  // Muzzle flash color (RGB string, e.g. '255,200,60')
  muzzleColor?: string;
  // Projectile travel
  startX?: number;       // projectile origin
  startY?: number;
  endX?: number;         // projectile destination
  endY?: number;
  projStyle?: 'bullet' | 'fireball' | 'shell' | 'rocket' | 'grenade';
  // Marker color (for move/attack command feedback)
  markerColor?: string;
  // Floating text (e.g. "+100" credits)
  text?: string;
  textColor?: string;
}

// Pseudo-random hash for terrain variation
function cellHash(cx: number, cy: number): number {
  let h = (cx * 374761 + cy * 668265) | 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  return ((h >> 16) ^ h) & 0xff;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private pal: number[][] | null = null;
  screenShake = 0;      // remaining shake ticks
  screenFlash = 0;      // remaining flash ticks (white flash on big explosions)
  attackMoveMode = false; // show attack-move cursor indicator
  sellMode = false;      // show sell cursor indicator
  repairMode = false;    // show repair cursor indicator
  private scoreAnimStartTime = 0; // timestamp when score screen first appeared
  private scoreAnimActive = false; // whether score animation is running
  repairingStructures = new Set<number>(); // indices of structures being repaired
  corpses: Array<{ x: number; y: number; type: UnitType; facing: number; isInfantry: boolean; isAnt: boolean; alpha: number; deathVariant: number }> = [];
  showHelp = false;     // F1 help overlay
  difficulty: 'easy' | 'normal' | 'hard' = 'normal';
  idleCount = 0;        // number of idle player units
  minimapAlerts: Array<{ cx: number; cy: number; tick: number }> = [];
  // Sidebar data (set by game each frame)
  sidebarCredits = 0;  // animated display credits
  sidebarPowerProduced = 0;
  sidebarPowerConsumed = 0;
  sidebarItems: ProductionItem[] = [];
  sidebarQueue: Map<string, { item: ProductionItem; progress: number; queueCount: number }> = new Map();
  sidebarScroll = 0;
  sidebarW = 100;
  hasRadar = false; // requires DOME building for minimap
  radarStaticData: Uint8Array | null = null; // cached static noise for no-radar
  radarStaticCounter = 0;
  crates: Array<{ x: number; y: number; type: string }> = [];
  evaMessages: Array<{ text: string; tick: number }> = [];
  selectedStructure: { type: string; hp: number; maxHp: number; name: string } | null = null;
  selectedStructureIdx = -1; // index into structures[] for selection highlight
  missionTimer = 0; // 0 = hidden
  missionName = ''; // mission title shown as overlay at start
  theatre = 'TEMPERATE'; // map theatre (affects terrain colors)
  musicTrack = ''; // currently playing music track name
  gameSpeed = 1; // player game speed (1/2/4x)
  // Custom cursor state
  cursorType: CursorType = CursorType.DEFAULT;
  cursorX = 0;
  cursorY = 0;
  // Placement ghost
  placementItem: ProductionItem | null = null;
  placementCx = 0;
  placementCy = 0;
  private _selectedIds: Set<number> = new Set();
  // Tileset rendering cache
  private tilesetImage: HTMLImageElement | null = null;
  private tilesetMeta: TilesetMeta | null = null;
  private tilesetReady = false;
  placementValid = false;
  placementCells: boolean[] | null = null; // per-cell passability for placement preview

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.width = canvas.width;
    this.height = canvas.height;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Get an RGB string from the TEMPERATE palette, with optional brightness offset */
  private palColor(idx: number, brightnessOffset = 0): string {
    if (!this.pal) return '#555';
    const c = this.pal[idx];
    if (!c) return '#555';
    const r = Math.max(0, Math.min(255, c[0] + brightnessOffset));
    const g = Math.max(0, Math.min(255, c[1] + brightnessOffset));
    const b = Math.max(0, Math.min(255, c[2] + brightnessOffset));
    return `rgb(${r},${g},${b})`;
  }

  render(
    camera: Camera,
    map: GameMap,
    entities: Entity[],
    structures: MapStructure[],
    assets: AssetManager,
    input: InputState,
    selectedIds: Set<number>,
    effects: Effect[],
    tick: number,
  ): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    this._selectedIds = selectedIds;

    // Cache palette reference from assets
    if (!this.pal) this.pal = assets.getPalette();

    // Cache tileset atlas reference from assets (once)
    if (!this.tilesetReady && assets.hasTileset()) {
      this.tilesetImage = assets.getTilesetImage();
      this.tilesetMeta = assets.getTilesetMeta();
      this.tilesetReady = true;
    }

    // Apply screen shake
    let shaking = false;
    if (this.screenShake > 0) {
      shaking = true;
      const intensity = Math.min(this.screenShake, 6);
      const sx = (Math.random() - 0.5) * intensity * 2;
      const sy = (Math.random() - 0.5) * intensity * 2;
      ctx.save();
      ctx.translate(sx, sy);
      this.screenShake--;
    }

    this.renderTerrain(camera, map, tick);
    this.renderDecals(camera, map);
    this.renderOverlays(camera, map, tick, assets);
    this.renderStructures(camera, map, structures, assets, tick);
    this.renderCrates(camera, map, tick);
    this.renderCorpses(camera, map, assets);
    this.renderEntities(camera, map, entities, assets, selectedIds, tick);
    this.renderTargetLines(camera, entities, selectedIds);
    this.renderWaypoints(camera, entities, selectedIds);
    this.renderEffects(camera, effects, assets);
    this.renderFogOfWar(camera, map);

    if (shaking) {
      ctx.restore();
    }

    // Screen flash overlay (big explosions)
    if (this.screenFlash > 0) {
      const flashAlpha = Math.min(0.4, this.screenFlash * 0.08);
      ctx.fillStyle = `rgba(255,255,220,${flashAlpha})`;
      ctx.fillRect(0, 0, this.width, this.height);
      this.screenFlash--;
    }

    // Placement ghost preview
    if (this.placementItem) {
      this.renderPlacementGhost(camera, assets);
    }

    this.renderSelectionBox(input);
    if (this.attackMoveMode) this.renderAttackMoveIndicator(input);
    if (this.sellMode) this.renderModeLabel(input, 'SELL', 'rgba(255,200,60,0.9)');
    if (this.repairMode) this.renderModeLabel(input, 'REPAIR', 'rgba(80,255,80,0.9)');
    this.renderMinimap(map, entities, structures, camera);
    this.renderOffscreenIndicators(camera, entities, selectedIds);
    this.renderSidebar(assets);
    this.renderUnitInfo(entities, selectedIds);
    if (this.idleCount > 0) this.renderIdleCount();
    if (this.showHelp) this.renderHelpOverlay();
    this.renderCursor();
  }

  // ─── Layer Isolation (comparison mode) ───────────────────

  /** Render a single layer in isolation and return its data URL.
   *  Used by the comparison test harness to capture per-layer screenshots. */
  renderLayer(
    layer: 'terrain' | 'units' | 'buildings' | 'overlays' | 'full-no-ui',
    camera: Camera,
    map: GameMap,
    entities: Entity[],
    structures: MapStructure[],
    assets: AssetManager,
    selectedIds: Set<number>,
    effects: Effect[],
    tick: number,
  ): string | null {
    const ctx = this.ctx;

    // Cache palette + tileset if not yet loaded
    if (!this.pal) this.pal = assets.getPalette();
    if (!this.tilesetReady && assets.hasTileset()) {
      this.tilesetImage = assets.getTilesetImage();
      this.tilesetMeta = assets.getTilesetMeta();
      this.tilesetReady = true;
    }

    ctx.clearRect(0, 0, this.width, this.height);

    switch (layer) {
      case 'terrain':
        this.renderTerrain(camera, map, tick);
        break;
      case 'units':
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, this.width, this.height);
        this.renderEntities(camera, map, entities, assets, selectedIds, tick);
        break;
      case 'buildings':
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, this.width, this.height);
        this.renderStructures(camera, map, structures, assets, tick);
        break;
      case 'overlays':
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, this.width, this.height);
        this.renderOverlays(camera, map, tick, assets);
        break;
      case 'full-no-ui':
        this.renderTerrain(camera, map, tick);
        this.renderDecals(camera, map);
        this.renderOverlays(camera, map, tick, assets);
        this.renderStructures(camera, map, structures, assets, tick);
        this.renderCrates(camera, map, tick);
        this.renderCorpses(camera, map, assets);
        this.renderEntities(camera, map, entities, assets, selectedIds, tick);
        this.renderEffects(camera, effects, assets);
        break;
    }

    try {
      return ctx.canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  // ─── Custom Cursor ────────────────────────────────────────

  private renderCursor(): void {
    const ctx = this.ctx;
    const x = this.cursorX;
    const y = this.cursorY;

    ctx.save();
    ctx.lineWidth = 1.5;

    switch (this.cursorType) {
      case CursorType.DEFAULT: {
        // Green arrow pointer
        ctx.fillStyle = '#44ff44';
        ctx.strokeStyle = '#003300';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 16);
        ctx.lineTo(x + 4, y + 12);
        ctx.lineTo(x + 8, y + 18);
        ctx.lineTo(x + 10, y + 16);
        ctx.lineTo(x + 6, y + 10);
        ctx.lineTo(x + 11, y + 10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case CursorType.MOVE: {
        // Green 4-way arrow
        const s = 6;
        ctx.fillStyle = '#44ff44';
        ctx.strokeStyle = '#003300';
        ctx.beginPath();
        // Up arrow
        ctx.moveTo(x, y - s * 2); ctx.lineTo(x - s, y - s); ctx.lineTo(x + s, y - s);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // Down arrow
        ctx.beginPath();
        ctx.moveTo(x, y + s * 2); ctx.lineTo(x - s, y + s); ctx.lineTo(x + s, y + s);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // Left arrow
        ctx.beginPath();
        ctx.moveTo(x - s * 2, y); ctx.lineTo(x - s, y - s); ctx.lineTo(x - s, y + s);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // Right arrow
        ctx.beginPath();
        ctx.moveTo(x + s * 2, y); ctx.lineTo(x + s, y - s); ctx.lineTo(x + s, y + s);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // Center dot
        ctx.fillStyle = '#44ff44';
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case CursorType.NOMOVE: {
        // Red circle with X
        const r = 7;
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4);
        ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4);
        ctx.stroke();
        break;
      }
      case CursorType.ATTACK: {
        // Red crosshair with center gap
        const r = 8;
        const gap = 3;
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 1.5;
        // Outer circle
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        // Crosshair lines with gap
        ctx.beginPath();
        ctx.moveTo(x - r - 2, y); ctx.lineTo(x - gap, y);
        ctx.moveTo(x + gap, y); ctx.lineTo(x + r + 2, y);
        ctx.moveTo(x, y - r - 2); ctx.lineTo(x, y - gap);
        ctx.moveTo(x, y + gap); ctx.lineTo(x, y + r + 2);
        ctx.stroke();
        break;
      }
      case CursorType.SELL: {
        // Yellow $ sign
        ctx.font = 'bold 16px monospace';
        ctx.fillStyle = '#FFD700';
        ctx.strokeStyle = '#553300';
        ctx.lineWidth = 2;
        ctx.textAlign = 'center';
        ctx.strokeText('$', x, y + 6);
        ctx.fillText('$', x, y + 6);
        ctx.textAlign = 'left';
        break;
      }
      case CursorType.REPAIR: {
        // Green wrench icon
        ctx.strokeStyle = '#44ff44';
        ctx.fillStyle = '#44ff44';
        ctx.lineWidth = 2;
        // Simple wrench shape
        ctx.beginPath();
        ctx.moveTo(x - 2, y - 8);
        ctx.lineTo(x + 2, y - 8);
        ctx.lineTo(x + 2, y);
        ctx.lineTo(x + 5, y + 3);
        ctx.lineTo(x + 3, y + 5);
        ctx.lineTo(x, y + 2);
        ctx.lineTo(x - 3, y + 5);
        ctx.lineTo(x - 5, y + 3);
        ctx.lineTo(x - 2, y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#003300';
        ctx.lineWidth = 1;
        ctx.stroke();
        break;
      }
      default: {
        // Scroll cursors — directional white arrows
        if (this.cursorType.startsWith('SCROLL_')) {
          const dir = this.cursorType.replace('SCROLL_', '');
          const arrows: Record<string, [number, number]> = {
            N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1],
            S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1],
          };
          const [dx, dy] = arrows[dir] ?? [0, 0];
          const s = 8;
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.strokeStyle = 'rgba(0,0,0,0.5)';
          ctx.lineWidth = 1;
          // Arrow triangle pointing in scroll direction
          const tipX = x + dx * s * 2;
          const tipY = y + dy * s * 2;
          const perpX = -dy;
          const perpY = dx;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - dx * s + perpX * s * 0.6, tipY - dy * s + perpY * s * 0.6);
          ctx.lineTo(tipX - dx * s - perpX * s * 0.6, tipY - dy * s - perpY * s * 0.6);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        break;
      }
    }

    ctx.restore();
  }

  // ─── Terrain ─────────────────────────────────────────────

  /** Render a grass cell with RA-style dithered pixel variation */
  private renderGrassCell(ctx: CanvasRenderingContext2D, sx: number, sy: number,
    cx: number, cy: number, h: number, tmpl: number, icon: number): void {
    // Base grass color from palette
    const palIdx = PAL_GRASS_START + 3 + ((tmpl * 13 + icon * 7 + h) % 5);
    ctx.fillStyle = this.palColor(palIdx, (h % 10) - 5);
    ctx.fillRect(sx, sy, CELL_SIZE, CELL_SIZE);
    // RA-style dithered pixel variation: alternate darker/lighter grass pixels
    for (let py = 0; py < CELL_SIZE; py += 2) {
      for (let px = 0; px < CELL_SIZE; px += 2) {
        const ph = cellHash(cx * 24 + px, cy * 24 + py);
        if (ph % 6 === 0) {
          // Darker grass pixel
          ctx.fillStyle = this.palColor(PAL_GRASS_START + 7 + (ph % 3));
          ctx.fillRect(sx + px, sy + py, 1, 1);
        } else if (ph % 9 === 0) {
          // Lighter grass pixel
          ctx.fillStyle = this.palColor(PAL_GRASS_START + 1 + (ph % 2), 6);
          ctx.fillRect(sx + px, sy + py, 1, 1);
        }
      }
    }
    // Dirt patch detail (sparse)
    if (h % 7 === 0) {
      const dx = (h % 12) + 4, dy = ((h >> 4) % 10) + 5;
      ctx.fillStyle = this.palColor(PAL_DIRT_START + 6, -15);
      ctx.globalAlpha = 0.25;
      ctx.fillRect(sx + dx, sy + dy, 4 + (h % 3), 3);
      ctx.globalAlpha = 1;
    }
    // Grass tuft (dark green blades)
    if (h > 180) {
      const gx = sx + (h % 16) + 3, gy = sy + ((h >> 4) % 14) + 4;
      ctx.fillStyle = this.palColor(PAL_GRASS_START + 9);
      ctx.fillRect(gx, gy, 1, 3);
      ctx.fillRect(gx + 2, gy + 1, 1, 2);
    }
  }

  /** Try to draw a tile from the tileset atlas. Returns true if drawn. */
  private drawTileFromAtlas(
    ctx: CanvasRenderingContext2D,
    tmpl: number,
    icon: number,
    sx: number,
    sy: number,
  ): boolean {
    if (!this.tilesetImage || !this.tilesetMeta) return false;
    const key = `${tmpl},${icon}`;
    const entry = this.tilesetMeta.tiles[key];
    if (!entry) return false;
    ctx.drawImage(
      this.tilesetImage,
      entry.ax, entry.ay, this.tilesetMeta.tileW, this.tilesetMeta.tileH,
      sx, sy, CELL_SIZE, CELL_SIZE,
    );
    return true;
  }

  private renderTerrain(camera: Camera, map: GameMap, tick: number): void {
    const ctx = this.ctx;
    const startCX = Math.floor(camera.x / CELL_SIZE);
    const startCY = Math.floor(camera.y / CELL_SIZE);
    const endCX = Math.ceil((camera.x + camera.viewWidth) / CELL_SIZE);
    const endCY = Math.ceil((camera.y + camera.viewHeight) / CELL_SIZE);

    // Can we use the real tileset? Only for TEMPERATE theatre.
    const useTileset = this.tilesetReady && this.theatre === 'TEMPERATE';

    for (let cy = startCY; cy <= endCY; cy++) {
      for (let cx = startCX; cx <= endCX; cx++) {
        const screen = camera.worldToScreen(cx * CELL_SIZE, cy * CELL_SIZE);

        // Out-of-bounds cells render as black (shroud border)
        if (cx < map.boundsX || cx >= map.boundsX + map.boundsW ||
            cy < map.boundsY || cy >= map.boundsY + map.boundsH) {
          ctx.fillStyle = '#000';
          ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
          continue;
        }

        const terrain = map.getTerrain(cx, cy);
        const h = cellHash(cx, cy);

        // Use MapPack template data for richer variation when available
        const idx = cy * 128 + cx;
        const tmpl = map.templateType[idx] || 0;
        const icon = map.templateIcon[idx] || 0;

        // Try real tileset tile first (skip for INTERIOR theatre)
        // For TREE terrain, draw ground from atlas but still render tree overlay on top
        let atlasDrawn = false;
        if (useTileset && tmpl > 0 && tmpl !== 0xFF) {
          if (this.drawTileFromAtlas(ctx, tmpl, icon, screen.x, screen.y)) {
            if (terrain !== Terrain.TREE) continue; // Tile drawn from atlas, skip procedural
            atlasDrawn = true; // Fall through to TREE case below
          }
        }

        // Also handle clear tiles (type 0 or 0xFF) from tileset — use clear1 (type 255, icon 0)
        if (useTileset && (tmpl === 0 || tmpl === 0xFF) && terrain === Terrain.CLEAR) {
          if (this.drawTileFromAtlas(ctx, 255, 0, screen.x, screen.y)) {
            continue;
          }
        }

        // Fallback: procedural rendering
        switch (terrain) {
          case Terrain.CLEAR: {
            if (this.theatre === 'INTERIOR') {
              // INTERIOR theatre — always concrete/stone floors (ignores template data)
              const bright = 60 + (h % 12) - 6;
              ctx.fillStyle = `rgb(${bright},${bright - 2},${bright - 5})`;
              ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
              // Tile grid lines
              if ((cx + cy) % 2 === 0) {
                ctx.fillStyle = `rgba(80,78,72,0.3)`;
                ctx.fillRect(screen.x, screen.y, CELL_SIZE, 1);
                ctx.fillRect(screen.x, screen.y, 1, CELL_SIZE);
              }
              // Occasional stain detail
              if (h > 220) {
                ctx.fillStyle = 'rgba(40,35,30,0.15)';
                ctx.fillRect(screen.x + 4, screen.y + 4, 16, 12);
              }
              break; // skip TEMPERATE template rendering and grass tufts
            } else if (tmpl > 0 && tmpl !== 0xFF) {
              // Template-aware rendering using palette colors
              const isRoad = tmpl >= 0x27 && tmpl <= 0x34;
              const isRough = tmpl >= 0x0D && tmpl <= 0x12;
              const isShoreDirt = tmpl >= 0x06 && tmpl <= 0x0C;

              if (isRoad) {
                // Road tiles — two-tone dirt with gravel dithering
                const palIdx = PAL_DIRT_START + 4 + ((icon * 7 + h) % 4);
                ctx.fillStyle = this.palColor(palIdx, 5);
                ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
                // Gravel dither pattern (RA-style pixel noise)
                for (let py = 0; py < CELL_SIZE; py += 3) {
                  for (let px = 0; px < CELL_SIZE; px += 3) {
                    const ph = cellHash(cx * 24 + px, cy * 24 + py);
                    if (ph % 4 === 0) {
                      ctx.fillStyle = this.palColor(PAL_DIRT_START + 2 + (ph % 3), ph % 12 - 6);
                      ctx.fillRect(screen.x + px, screen.y + py, 1, 1);
                    }
                  }
                }
                // Road edge darkening
                ctx.fillStyle = this.palColor(PAL_DIRT_START + 8, -10);
                ctx.globalAlpha = 0.3;
                ctx.fillRect(screen.x, screen.y, CELL_SIZE, 2);
                ctx.fillRect(screen.x, screen.y + CELL_SIZE - 2, CELL_SIZE, 2);
                ctx.globalAlpha = 1;
              } else if (isRough) {
                // Rough terrain — dithered dirt/rock mix
                const palIdx = PAL_DIRT_START + 8 + (h % 4);
                ctx.fillStyle = this.palColor(palIdx);
                ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
                // Rock scatter with varied sizes
                for (let r = 0; r < 3; r++) {
                  const rh = (h + r * 47) & 0xFF;
                  const rx = (rh % 18) + 2, ry = ((rh >> 3) % 16) + 3;
                  const rs = 2 + (rh % 3);
                  ctx.fillStyle = this.palColor(PAL_ROCK_START + 6 + (rh % 4));
                  ctx.fillRect(screen.x + rx, screen.y + ry, rs, rs - 1);
                }
              } else if (isShoreDirt) {
                // Shore/dirt — dithered sand transition
                const palIdx = PAL_DIRT_START + 2 + (h % 4);
                ctx.fillStyle = this.palColor(palIdx);
                ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
                // Sand grain dithering
                for (let py = 0; py < CELL_SIZE; py += 2) {
                  for (let px = 0; px < CELL_SIZE; px += 2) {
                    if (((px + py + h) % 5) === 0) {
                      ctx.fillStyle = this.palColor(PAL_DIRT_START + (h % 3), 8);
                      ctx.fillRect(screen.x + px, screen.y + py, 1, 1);
                    }
                  }
                }
              } else {
                // Other templates — grass with dithered variation (RA-style)
                this.renderGrassCell(ctx, screen.x, screen.y, cx, cy, h, tmpl, icon);
              }
            } else {
              // Default clear — grass with dithered variation
              this.renderGrassCell(ctx, screen.x, screen.y, cx, cy, h, 0, 0);
            }
            break;
          }
          case Terrain.WATER: {
            // Animated water using palette indices 96-102 (7-frame ping-pong cycle)
            const phase = (tick + h) % (PAL_WATER_COUNT * 2 - 2);
            const waterIdx = phase < PAL_WATER_COUNT ? phase : (PAL_WATER_COUNT * 2 - 2 - phase);
            ctx.fillStyle = this.palColor(PAL_WATER_START + waterIdx);
            ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
            // Dithered water depth variation
            for (let py = 0; py < CELL_SIZE; py += 3) {
              for (let px = 0; px < CELL_SIZE; px += 3) {
                const wp = cellHash(cx * 24 + px, cy * 24 + py + tick);
                if (wp % 7 === 0) {
                  ctx.fillStyle = this.palColor(PAL_WATER_START + Math.min(waterIdx + 1, PAL_WATER_COUNT - 1), 8);
                  ctx.fillRect(screen.x + px, screen.y + py, 1, 1);
                }
              }
            }
            // Wave highlights — moving ripple lines
            const waveOff = (tick * 0.5 + h * 0.3) % CELL_SIZE;
            ctx.fillStyle = this.palColor(PAL_WATER_START, 15);
            ctx.globalAlpha = 0.2;
            ctx.fillRect(screen.x + 2, screen.y + ((waveOff | 0) % CELL_SIZE), CELL_SIZE - 4, 1);
            ctx.fillRect(screen.x + 6, screen.y + ((waveOff + 12 | 0) % CELL_SIZE), CELL_SIZE - 12, 1);
            ctx.globalAlpha = 1;
            break;
          }
          case Terrain.ROCK: {
            if (this.theatre === 'INTERIOR') {
              // Interior: dark stone walls
              const bright = 35 + (h % 8);
              ctx.fillStyle = `rgb(${bright},${bright - 3},${bright - 5})`;
              ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
              ctx.fillStyle = 'rgba(20,15,10,0.3)';
              ctx.fillRect(screen.x + (h % 10) + 2, screen.y + ((h >> 3) % 10) + 2, 4, 3);
            } else {
              // Rock using palette gray ramp (indices 132-140)
              const palIdx = PAL_ROCK_START + 4 + (h % 8);
              ctx.fillStyle = this.palColor(palIdx);
              ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
              // Rock detail using darker grays
              ctx.fillStyle = this.palColor(PAL_ROCK_START + 10);
              ctx.globalAlpha = 0.5;
              ctx.fillRect(screen.x + (h % 10) + 2, screen.y + ((h >> 3) % 10) + 2, 4, 3);
              ctx.fillRect(screen.x + ((h >> 5) % 12) + 1, screen.y + ((h >> 2) % 14) + 5, 3, 4);
              ctx.globalAlpha = 1;
            }
            break;
          }
          case Terrain.TREE: {
            if (this.theatre === 'INTERIOR') {
              // Interior: support columns/pillars instead of trees
              const bright = 50 + (h % 6);
              ctx.fillStyle = `rgb(${bright},${bright - 2},${bright - 4})`;
              ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
              ctx.fillStyle = `rgb(${bright + 15},${bright + 12},${bright + 8})`;
              ctx.fillRect(screen.x + 8, screen.y + 4, 8, 16);
              ctx.fillStyle = `rgb(${bright + 8},${bright + 5},${bright + 2})`;
              ctx.fillRect(screen.x + 6, screen.y + 2, 12, 4);
              ctx.fillRect(screen.x + 6, screen.y + 18, 12, 4);
            } else {
              // Ground under tree — skip grass if atlas already drew the ground tile
              if (!atlasDrawn) this.renderGrassCell(ctx, screen.x, screen.y, cx, cy, h, tmpl, icon);
              // Tree shadow on ground
              ctx.fillStyle = 'rgba(0,0,0,0.2)';
              ctx.beginPath();
              ctx.ellipse(screen.x + 13, screen.y + 19, 9, 4, 0, 0, Math.PI * 2);
              ctx.fill();
              // Trunk — darker brown with highlight
              const tx = screen.x + 10 + (h % 2);
              ctx.fillStyle = this.palColor(PAL_DIRT_START + 10);
              ctx.fillRect(tx, screen.y + 12, 3, 10);
              ctx.fillStyle = this.palColor(PAL_DIRT_START + 7);
              ctx.fillRect(tx + 1, screen.y + 13, 1, 8);
              // Canopy — pixel-art blocky rects (6 hash-based variants)
              const variant = h % 6;
              const sx = screen.x, sy = screen.y;
              // Dark base layer
              ctx.fillStyle = this.palColor(PAL_GRASS_START + 10 + (h % 2));
              if (variant < 2) {
                ctx.fillRect(sx + 4, sy + 8, 16, 4);
                ctx.fillRect(sx + 6, sy + 4, 12, 4);
                ctx.fillRect(sx + 8, sy + 2, 8, 2);
                ctx.fillRect(sx + 6, sy + 12, 10, 2);
              } else if (variant < 4) {
                ctx.fillRect(sx + 3, sy + 7, 18, 5);
                ctx.fillRect(sx + 5, sy + 3, 14, 4);
                ctx.fillRect(sx + 7, sy + 1, 10, 2);
                ctx.fillRect(sx + 5, sy + 12, 12, 2);
              } else {
                ctx.fillRect(sx + 5, sy + 8, 14, 4);
                ctx.fillRect(sx + 7, sy + 5, 10, 3);
                ctx.fillRect(sx + 9, sy + 3, 6, 2);
                ctx.fillRect(sx + 7, sy + 12, 10, 2);
              }
              // Mid-tone highlight blocks
              ctx.fillStyle = this.palColor(PAL_GRASS_START + 7 + (h % 3));
              ctx.fillRect(sx + 6 + (h % 3), sy + 4, 6, 4);
              ctx.fillRect(sx + 8 + (h % 2), sy + 8, 4, 3);
              // Light highlight pixels
              ctx.fillStyle = this.palColor(PAL_GRASS_START + 4 + (h % 2));
              ctx.fillRect(sx + 8 + (h % 4), sy + 4, 2, 2);
              ctx.fillRect(sx + 12 + (h % 2), sy + 6, 2, 1);
            }
            break;
          }
          case Terrain.WALL: {
            if (this.theatre === 'INTERIOR') {
              // Interior: concrete walls
              const bright = 40 + (h % 6);
              ctx.fillStyle = `rgb(${bright},${bright - 2},${bright - 4})`;
              ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
              ctx.strokeStyle = 'rgba(0,0,0,0.3)';
              ctx.lineWidth = 1;
              ctx.strokeRect(screen.x + 0.5, screen.y + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
            } else {
              // Walls using palette gray ramp
              const palIdx = PAL_ROCK_START + 5 + (h % 4);
              ctx.fillStyle = this.palColor(palIdx);
              ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
              ctx.strokeStyle = 'rgba(0,0,0,0.2)';
              ctx.lineWidth = 1;
              ctx.strokeRect(screen.x + 0.5, screen.y + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
            }
            break;
          }
        }
      }
    }
  }

  // ─── Terrain Decals (scorch marks, craters) ────────────

  private renderDecals(camera: Camera, map: GameMap): void {
    const ctx = this.ctx;
    // Render pre-placed smudge marks from scenario INI
    for (const s of map.smudges) {
      const screen = camera.worldToScreen(s.cx * CELL_SIZE + CELL_SIZE / 2, s.cy * CELL_SIZE + CELL_SIZE / 2);
      if (screen.x < -CELL_SIZE || screen.x > this.width + CELL_SIZE ||
          screen.y < -CELL_SIZE || screen.y > this.height + CELL_SIZE) continue;
      // SC = scorch marks (darker, smaller), CR = craters (larger, round)
      const isCrater = s.type.startsWith('CR');
      const size = isCrater ? 10 : 7;
      const alpha = isCrater ? 0.4 : 0.3;
      ctx.fillStyle = `rgba(20,15,10,${alpha})`;
      ctx.beginPath();
      ctx.ellipse(screen.x, screen.y, size, size * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(10,5,0,${alpha * 0.6})`;
      ctx.beginPath();
      ctx.ellipse(screen.x, screen.y, size * 0.5, size * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Render dynamic decals (from combat)
    for (const d of map.decals) {
      const screen = camera.worldToScreen(d.cx * CELL_SIZE + CELL_SIZE / 2, d.cy * CELL_SIZE + CELL_SIZE / 2);
      if (screen.x < -d.size * 2 || screen.x > this.width + d.size * 2 ||
          screen.y < -d.size * 2 || screen.y > this.height + d.size * 2) continue;
      ctx.fillStyle = `rgba(20,15,10,${d.alpha})`;
      ctx.beginPath();
      ctx.ellipse(screen.x, screen.y, d.size, d.size * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      // Darker center
      ctx.fillStyle = `rgba(10,5,0,${d.alpha * 0.6})`;
      ctx.beginPath();
      ctx.ellipse(screen.x, screen.y, d.size * 0.5, d.size * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ─── Overlays (ore, gems, walls) ────────────────────────

  private renderOverlays(camera: Camera, map: GameMap, tick: number, assets: AssetManager): void {
    const ctx = this.ctx;
    const startCX = Math.floor(camera.x / CELL_SIZE);
    const startCY = Math.floor(camera.y / CELL_SIZE);
    const endCX = Math.ceil((camera.x + camera.viewWidth) / CELL_SIZE);
    const endCY = Math.ceil((camera.y + camera.viewHeight) / CELL_SIZE);

    for (let cy = startCY; cy <= endCY; cy++) {
      for (let cx = startCX; cx <= endCX; cx++) {
        if (cx < 0 || cx >= 128 || cy < 0 || cy >= 128) continue;
        const ovl = map.overlay[cy * 128 + cx];
        if (ovl === 0xFF) continue;

        const screen = camera.worldToScreen(cx * CELL_SIZE, cy * CELL_SIZE);
        const h = cellHash(cx, cy);

        if (ovl >= 0x03 && ovl <= 0x0E) {
          // Gold ore — sprite from GOLD01-04.TEM, 12 density frames each
          const density = ovl - 0x03; // 0-11 = frame index
          const variant = (h % 4) + 1; // pick gold01-04
          const sheetName = `gold0${variant}`;
          assets.drawFrame(ctx, sheetName, density, screen.x, screen.y);
          // Animated sparkle overlay
          const sparklePhase = (tick + h * 3) % 40;
          if (sparklePhase < 6) {
            const sparkAlpha = sparklePhase < 3 ? sparklePhase / 3 : (6 - sparklePhase) / 3;
            const sx = screen.x + 4 + ((h * 7) % 14);
            const sy = screen.y + 4 + ((h * 11) % 14);
            ctx.fillStyle = `rgba(255,255,200,${sparkAlpha * 0.8})`;
            ctx.fillRect(sx, sy, 2, 2);
            ctx.fillRect(sx - 1, sy + 1, 4, 1);
            ctx.fillRect(sx + 1, sy - 1, 1, 4);
          }
        } else if (ovl >= 0x0F && ovl <= 0x12) {
          // Gems — sprite from GEM01-04.TEM, 3 density frames each
          const gemDensity = ovl - 0x0F; // 0-3
          const frame = Math.min(gemDensity, 2); // gems have 3 frames (0-2)
          const variant = (h % 4) + 1; // pick gem01-04
          const sheetName = `gem0${variant}`;
          assets.drawFrame(ctx, sheetName, frame, screen.x, screen.y);
          // Animated gem sparkle
          const gemPhase = (tick + h * 5) % 24;
          if (gemPhase < 6) {
            const sparkAlpha = gemPhase < 3 ? gemPhase / 3 : (6 - gemPhase) / 3;
            const gx = screen.x + 6 + ((h * 13) % 12);
            const gy = screen.y + 6 + ((h * 9) % 12);
            ctx.fillStyle = `rgba(180,230,255,${sparkAlpha * 0.9})`;
            ctx.fillRect(gx, gy, 2, 2);
            ctx.fillRect(gx - 1, gy + 1, 4, 1);
            ctx.fillRect(gx + 1, gy - 1, 1, 4);
          }
        } else if (ovl >= 0x15 && ovl <= 0x1F) {
          // Walls — dark gray blocks
          ctx.fillStyle = this.palColor(PAL_ROCK_START + 6);
          ctx.fillRect(screen.x + 1, screen.y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
          ctx.strokeStyle = 'rgba(0,0,0,0.3)';
          ctx.lineWidth = 1;
          ctx.strokeRect(screen.x + 1.5, screen.y + 1.5, CELL_SIZE - 3, CELL_SIZE - 3);
        }
      }
    }
  }

  // ─── Structures ─────────────────────────────────────────

  private renderCrates(camera: Camera, map: GameMap, tick: number): void {
    const ctx = this.ctx;
    for (const crate of this.crates) {
      const cx = Math.floor(crate.x / CELL_SIZE);
      const cy = Math.floor(crate.y / CELL_SIZE);
      if (map.getVisibility(cx, cy) !== 2) continue; // only show in visible area
      const screen = camera.worldToScreen(crate.x, crate.y);
      if (screen.x < -20 || screen.x > this.width || screen.y < -20 || screen.y > this.height) continue;
      // Draw a wooden crate icon
      const sz = 8;
      const bob = Math.sin(tick * 0.15) * 1.5; // gentle bobbing
      ctx.fillStyle = '#8B4513';
      ctx.fillRect(screen.x - sz, screen.y - sz + bob, sz * 2, sz * 2);
      ctx.strokeStyle = '#D2691E';
      ctx.lineWidth = 1;
      ctx.strokeRect(screen.x - sz, screen.y - sz + bob, sz * 2, sz * 2);
      // Cross lines on crate
      ctx.beginPath();
      ctx.moveTo(screen.x - sz, screen.y - sz + bob);
      ctx.lineTo(screen.x + sz, screen.y + sz + bob);
      ctx.moveTo(screen.x + sz, screen.y - sz + bob);
      ctx.lineTo(screen.x - sz, screen.y + sz + bob);
      ctx.strokeStyle = '#654321';
      ctx.stroke();
      // Type indicator dot
      const typeColor = crate.type === 'money' ? '#FFD700'
        : crate.type === 'heal' ? '#00FF00'
        : crate.type === 'veterancy' ? '#FF4444'
        : '#4488FF';
      ctx.fillStyle = typeColor;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y + bob, 2, 0, Math.PI * 2);
      ctx.fill();
      // Sparkle/glimmer effect
      const sparkPhase = (tick * 0.2 + screen.x * 0.1) % (Math.PI * 2);
      if (Math.sin(sparkPhase) > 0.7) {
        const sa = (Math.sin(sparkPhase) - 0.7) * 3.3;
        ctx.fillStyle = `rgba(255,255,200,${sa})`;
        const spx = screen.x + sz * 0.6;
        const spy = screen.y - sz * 0.6 + bob;
        ctx.fillRect(spx - 1, spy, 3, 1);
        ctx.fillRect(spx, spy - 1, 1, 3);
      }
    }
    // Defensive alpha reset after overlay pass
    ctx.globalAlpha = 1;
  }

  private renderStructures(
    camera: Camera, map: GameMap, structures: MapStructure[], assets: AssetManager, tick: number,
  ): void {
    const ctx = this.ctx;
    for (let structIdx = 0; structIdx < structures.length; structIdx++) {
      const s = structures[structIdx];
      // Render rubble for destroyed structures
      if (!s.alive) {
        if (!s.rubble) continue;
        const vis = map.getVisibility(s.cx, s.cy);
        if (vis === 0) continue;
        const screenX = s.cx * CELL_SIZE - camera.x;
        const screenY = s.cy * CELL_SIZE - camera.y;
        if (vis === 1) ctx.globalAlpha = 0.5;
        // Draw rubble: scattered dark rectangles
        ctx.fillStyle = 'rgba(60,50,40,0.7)';
        const rng = (s.cx * 31 + s.cy * 17); // deterministic seed
        for (let i = 0; i < 6; i++) {
          const rx = screenX + 4 + ((rng + i * 7) % 20);
          const ry = screenY + 4 + ((rng + i * 13) % 16);
          const rw = 3 + (i % 3) * 2;
          const rh = 2 + ((i + 1) % 3) * 2;
          ctx.fillRect(rx, ry, rw, rh);
        }
        // Darker outline pieces
        ctx.fillStyle = 'rgba(30,25,20,0.6)';
        for (let i = 0; i < 4; i++) {
          const rx = screenX + 6 + ((rng + i * 11 + 3) % 18);
          const ry = screenY + 6 + ((rng + i * 9 + 5) % 14);
          ctx.fillRect(rx, ry, 4, 3);
        }
        if (vis === 1) ctx.globalAlpha = 1;
        continue;
      }
      const vis = map.getVisibility(s.cx, s.cy);
      if (vis === 0) continue; // fully shrouded

      const screenX = s.cx * CELL_SIZE - camera.x;
      const screenY = s.cy * CELL_SIZE - camera.y;

      // Construction/sell animation: clip building sprite progressively
      const isConstructing = s.buildProgress !== undefined && s.buildProgress < 1;
      const isSelling = s.sellProgress !== undefined;
      const sheet = assets.getSheet(s.image);
      if (sheet) {
        // Determine frame: damaged buildings use second half of frames
        const totalFrames = sheet.meta.frameCount;
        const damaged = s.hp < s.maxHp * 0.5; // less than 50% health
        let frame = 0;
        // GUN turret: 128 frames = [32 normal][32 firing][32 damaged][32 damaged firing]
        if (s.type === 'GUN' && s.turretDir !== undefined) {
          const facingFrame = BODY_SHAPE[(s.turretDir * 4) % 32];
          const baseFrame = damaged ? 64 : 0;
          const firingOffset = (s.firingFlash && s.firingFlash > 0) ? 32 : 0;
          frame = baseFrame + firingOffset + facingFrame;
        // SAM launcher: 68 frames = [2 closed + 32 rotation][34 damaged]
        } else if (s.type === 'SAM' && s.turretDir !== undefined) {
          const baseFrame = damaged ? 34 : 0;
          const facingFrame = BODY_SHAPE[(s.turretDir * 4) % 32];
          frame = baseFrame + 2 + facingFrame;
        } else if (totalFrames > 2) {
          const halfFrames = Math.floor(totalFrames / 2);
          const baseFrame = damaged ? halfFrames : 0;
          // Animate idle loop (every 8 ticks = ~0.5s per frame)
          const animFrames = damaged ? totalFrames - halfFrames : halfFrames;
          frame = baseFrame + (Math.floor(tick / 8) % Math.max(1, animFrames));
        } else if (totalFrames === 2) {
          frame = damaged ? 1 : 0;
        }
        // Clamp frame to valid range (prevent overflow for non-standard frame counts)
        frame = Math.min(frame, totalFrames - 1);
        if (vis === 1) ctx.globalAlpha = 0.6; // dim in fog
        // Construction: reveal building from bottom up with scanline effect
        if (isConstructing) {
          const prog = s.buildProgress!;
          const fh = sheet.meta.frameHeight;
          const revealH = Math.floor(fh * prog);
          ctx.save();
          ctx.beginPath();
          ctx.rect(screenX - fh / 2, screenY + fh / 2 - revealH, sheet.meta.frameWidth + fh, revealH);
          ctx.clip();
          ctx.globalAlpha = 0.5 + prog * 0.5;
        }
        // Sell: shrink building top-to-bottom (reverse of construction) while fading
        if (isSelling) {
          const prog = s.sellProgress!;
          const fh = sheet.meta.frameHeight;
          const remainH = Math.floor(fh * (1 - prog));
          ctx.save();
          ctx.beginPath();
          ctx.rect(screenX - fh / 2, screenY + fh / 2 - remainH, sheet.meta.frameWidth + fh, remainH);
          ctx.clip();
          ctx.globalAlpha = Math.max(0.15, 1 - prog);
        }
        assets.drawFrame(ctx, s.image, frame % totalFrames, screenX + sheet.meta.frameWidth / 2, screenY + sheet.meta.frameHeight / 2, {
          centerX: true,
          centerY: true,
        });
        if (isConstructing) {
          // Green construction scanline at the build edge
          const fh = sheet.meta.frameHeight;
          const revealY = screenY + fh / 2 - Math.floor(fh * s.buildProgress!);
          ctx.restore();
          ctx.fillStyle = `rgba(80,255,80,${0.4 + 0.2 * Math.sin(tick * 0.5)})`;
          ctx.fillRect(screenX - 2, revealY - 1, sheet.meta.frameWidth + 4, 2);
        }
        if (isSelling) {
          // Red sell scanline at the shrinking edge
          const fh = sheet.meta.frameHeight;
          const shrinkY = screenY + fh / 2 - Math.floor(fh * (1 - s.sellProgress!));
          ctx.restore();
          ctx.fillStyle = `rgba(255,80,80,${0.4 + 0.2 * Math.sin(tick * 0.5)})`;
          ctx.fillRect(screenX - 2, shrinkY - 1, sheet.meta.frameWidth + 4, 2);
        }
        if (vis === 1) ctx.globalAlpha = 1;
      } else {
        // Fallback: colored rectangle for buildings without sprites
        const isPlayer = s.house === 'Spain' || s.house === 'Greece';
        ctx.fillStyle = isPlayer
          ? this.palColor(PAL_ROCK_START + 2, 10)   // light gray for player
          : this.palColor(PAL_DIRT_START + 6);       // brown for neutral/enemy
        if (vis === 1) ctx.globalAlpha = 0.6;
        ctx.fillRect(screenX + 2, screenY + 2, CELL_SIZE - 4, CELL_SIZE - 4);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(screenX + 2, screenY + 2, CELL_SIZE - 4, CELL_SIZE - 4);
        if (vis === 1) ctx.globalAlpha = 1;
      }

      // Power brownout dimming for defensive structures (matches severe brownout threshold in index.ts)
      if (this.sidebarPowerConsumed > this.sidebarPowerProduced * 1.5 && this.sidebarPowerProduced > 0) {
        const defenseTypes = ['HBOX', 'GUN', 'TSLA', 'PBOX'];
        if (defenseTypes.includes(s.type)) {
          const pulse = 0.15 + 0.1 * Math.sin(tick * 0.15);
          ctx.fillStyle = `rgba(0,0,0,${pulse})`;
          const [bw, bh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
          ctx.fillRect(screenX, screenY, bw * CELL_SIZE, bh * CELL_SIZE);
        }
      }

      // Health bar on damaged structures (visible only)
      if (vis === 2 && s.hp < s.maxHp) {
        const barX = screenX + CELL_SIZE;
        const barY = screenY - 2;
        this.renderHealthBar(barX, barY, CELL_SIZE * 1.5, s.hp / s.maxHp, false);
      }

      // Damage effects: light smoke (<75%), fire+smoke (<50%), intense fire (<25%)
      if (s.alive && s.hp < s.maxHp * 0.75 && vis >= 1 && !isConstructing && !isSelling) {
        const hpRatio = s.hp / s.maxHp;
        const fireSeed = (s.cx * 31 + s.cy * 17) | 0;
        const [fw] = STRUCTURE_SIZE[s.type] ?? [2, 2];
        const numFires = hpRatio < 0.25 ? 3 : hpRatio < 0.5 ? 2 : 1;

        for (let f = 0; f < numFires; f++) {
          const fx = screenX + CELL_SIZE * 0.3 * fw + ((fireSeed + f * 13) % (fw * 10)) - fw * 3;
          const fy = screenY + CELL_SIZE * 0.3 + f * 4;

          if (hpRatio < 0.5) {
            // Fire: animated orange/red flicker
            const flicker = Math.sin(tick * 0.5 + f * 2.1) * 0.3;
            const intensity = hpRatio < 0.25 ? 1.4 : 1.0;
            const fh = (6 + Math.sin(tick * 0.7 + f * 1.5) * 3) * intensity;
            ctx.fillStyle = `rgba(255,${100 + flicker * 60},${hpRatio < 0.25 ? 10 : 30},${(0.5 + flicker * 0.2) * intensity})`;
            ctx.beginPath();
            ctx.ellipse(fx, fy - fh * 0.5, 3 * intensity, fh * 0.5, 0, 0, Math.PI * 2);
            ctx.fill();
            // Inner bright core for critical damage
            if (hpRatio < 0.25) {
              ctx.fillStyle = `rgba(255,220,100,${0.3 + flicker * 0.2})`;
              ctx.beginPath();
              ctx.ellipse(fx, fy - fh * 0.3, 1.5, fh * 0.25, 0, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          // Smoke rising (all damage tiers, heavier when more damaged)
          const smokeSpeed = hpRatio < 0.25 ? 0.6 : hpRatio < 0.5 ? 0.4 : 0.25;
          const smokeSize = hpRatio < 0.25 ? 4 : hpRatio < 0.5 ? 3 : 2;
          const smokeBase = hpRatio < 0.5 ? 0.35 : 0.2;
          const smokeY = fy - 8 - (tick * smokeSpeed + f * 3) % 12;
          const smokeAlpha = smokeBase - ((tick * smokeSpeed + f * 3) % 12) / 30;
          if (smokeAlpha > 0) {
            ctx.fillStyle = `rgba(40,40,40,${smokeAlpha.toFixed(2)})`;
            ctx.beginPath();
            ctx.arc(fx + Math.sin(tick * 0.15 + f) * 2, smokeY, smokeSize, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Selection highlight — white border when structure is selected
      if (this.selectedStructureIdx === structIdx) {
        const [selW, selH] = STRUCTURE_SIZE[s.type] ?? [2, 2];
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1;
        ctx.strokeRect(screenX - 1, screenY - 1, selW * CELL_SIZE + 2, selH * CELL_SIZE + 2);
      }

      // Repair indicator: pulsing green border + wrench icon
      if (this.repairingStructures.has(structIdx)) {
        const pulse = 0.4 + 0.4 * Math.sin(tick * 0.3);
        ctx.strokeStyle = `rgba(80,255,80,${pulse})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(screenX, screenY, CELL_SIZE * 2, CELL_SIZE * 2);
        // Wrench icon (animated sparkle)
        const wx = screenX + CELL_SIZE;
        const wy = screenY - 4;
        const sparkle = Math.sin(tick * 0.5) > 0;
        ctx.fillStyle = sparkle ? '#8f8' : '#4c4';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('\u2692', wx, wy); // ⚒ hammer and pick
        ctx.textAlign = 'left';
      }

      // Construction Yard primary marker — spinning gear icon when producing
      if (s.type === 'FACT' && (s.house === 'Spain' || s.house === 'Greece') && vis === 2) {
        const hasProduction = this.sidebarQueue.size > 0;
        if (hasProduction) {
          // Animated spinning gear
          const gx = screenX + CELL_SIZE * 1.5;
          const gy = screenY + 4;
          ctx.save();
          ctx.translate(gx, gy);
          ctx.rotate(tick * 0.1);
          ctx.fillStyle = '#FFD700';
          ctx.font = 'bold 8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('\u2699', 0, 3); // ⚙ gear
          ctx.restore();
          ctx.textAlign = 'left';
        }
      }

      // Always reset alpha — prevents leak from fog dimming/brownout to next structure
      ctx.globalAlpha = 1;
    }
  }

  // ─── Corpses ─────────────────────────────────────────────

  private renderCorpses(camera: Camera, map: GameMap, assets: AssetManager): void {
    const ctx = this.ctx;
    for (const c of this.corpses) {
      const ecx = Math.floor(c.x / CELL_SIZE);
      const ecy = Math.floor(c.y / CELL_SIZE);
      if (map.getVisibility(ecx, ecy) === 0) continue; // shrouded
      const screen = camera.worldToScreen(c.x, c.y);
      if (screen.x < -20 || screen.x > this.width + 20 || screen.y < -20 || screen.y > this.height + 20) continue;

      // Burn mark on ground under corpse
      ctx.globalAlpha = c.alpha * 0.4;
      ctx.fillStyle = '#1a1008';
      const burnW = c.isInfantry ? 6 : (c.isAnt ? 10 : 12);
      const burnH = c.isInfantry ? 4 : (c.isAnt ? 7 : 8);
      ctx.beginPath();
      ctx.ellipse(screen.x, screen.y + 2, burnW, burnH, 0, 0, Math.PI * 2);
      ctx.fill();

      // Draw actual sprite frame for the corpse
      const stats = UNIT_STATS[c.type];
      const image = stats?.image;
      const sheet = image ? assets.getSheet(image) : null;
      ctx.globalAlpha = c.alpha;

      if (sheet && image) {
        let frame = 0;
        if (c.isInfantry) {
          // Infantry: use last frame of death animation
          const anim = INFANTRY_ANIMS[c.type] ?? INFANTRY_ANIMS.E1;
          const d = (c.deathVariant === 1 && anim.die2) ? anim.die2 : anim.die1;
          frame = d.frame + d.count - 1;
        } else if (c.isAnt) {
          // Ants: use dedicated ANTDIE.SHP sprite if available, else fall back to in-sprite death
          const antdieSheet = assets.getSheet('antdie');
          if (antdieSheet) {
            const dieFrame = antdieSheet.meta.frameCount - 1; // last frame = final death pose
            assets.drawFrame(ctx, 'antdie', dieFrame, screen.x, screen.y, {
              centerX: true,
              centerY: true,
            });
            // Darken overlay
            ctx.globalAlpha = c.alpha * 0.45;
            ctx.fillStyle = '#000000';
            const ahw = antdieSheet.meta.frameWidth / 2;
            const ahh = antdieSheet.meta.frameHeight / 2;
            ctx.fillRect(screen.x - ahw, screen.y - ahh, antdieSheet.meta.frameWidth, antdieSheet.meta.frameHeight);
            ctx.globalAlpha = 1;
            continue; // skip the generic sprite draw below
          }
          frame = ANT_ANIM.deathBase + ANT_ANIM.deathCount - 1;
        } else {
          // Vehicles: use body frame for facing direction
          const facingIndex = c.facing * 4;
          frame = BODY_SHAPE[facingIndex] ?? 0;
        }
        assets.drawFrame(ctx, image, frame % sheet.meta.frameCount, screen.x, screen.y, {
          centerX: true,
          centerY: true,
        });
        // Darken the sprite to look like a wreck/corpse
        ctx.globalAlpha = c.alpha * 0.45;
        ctx.fillStyle = '#000000';
        const hw = sheet.meta.frameWidth / 2;
        const hh = sheet.meta.frameHeight / 2;
        ctx.fillRect(screen.x - hw, screen.y - hh, sheet.meta.frameWidth, sheet.meta.frameHeight);
      } else {
        // Fallback: procedural corpse if no sprite available
        if (c.isInfantry) {
          ctx.fillStyle = '#2a1a0a';
          ctx.fillRect(screen.x - 3, screen.y - 1, 6, 3);
        } else {
          ctx.fillStyle = '#1a1a1a';
          ctx.fillRect(screen.x - 6, screen.y - 4, 12, 8);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  // ─── Entities ────────────────────────────────────────────

  private renderEntities(
    camera: Camera,
    map: GameMap,
    entities: Entity[],
    assets: AssetManager,
    selectedIds: Set<number>,
    tick: number,
  ): void {
    const ctx = this.ctx;

    // Sort by Y for depth ordering; dead entities render behind alive ones
    const sorted = [...entities];
    sorted.sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? 1 : -1;
      return a.pos.y - b.pos.y;
    });

    for (const entity of sorted) {
      const ecx = Math.floor(entity.pos.x / CELL_SIZE);
      const ecy = Math.floor(entity.pos.y / CELL_SIZE);

      // Don't render entities in shroud
      if (map.getVisibility(ecx, ecy) === 0) continue;
      // Don't render enemy entities in fog (only player units visible in fog)
      if (map.getVisibility(ecx, ecy) === 1 && !entity.isPlayerUnit) continue;

      // Apply infantry sub-cell offset
      const subOff = entity.stats.isInfantry ? (SUB_CELL_OFFSETS[entity.subCell] ?? SUB_CELL_OFFSETS[0]) : SUB_CELL_OFFSETS[0];
      // Air units: apply flight altitude offset (renders higher, shadow at ground level)
      const altY = entity.isAirUnit ? entity.flightAltitude : 0;
      const screen = camera.worldToScreen(entity.pos.x + subOff.x, entity.pos.y + subOff.y);
      const sheet = assets.getSheet(entity.stats.image);
      const spriteW = sheet ? sheet.meta.frameWidth : (entity.stats.isInfantry ? 50 : 24);
      const spriteH = sheet ? sheet.meta.frameHeight : (entity.stats.isInfantry ? 39 : 24);

      if (!camera.isVisible(
        entity.pos.x - spriteW / 2,
        entity.pos.y - spriteH / 2,
        spriteW, spriteH
      )) continue;

      // Death fade: reduce opacity as deathTick increases
      if (!entity.alive) {
        const fadeAlpha = Math.max(0, 1 - entity.deathTick / 40);
        if (fadeAlpha <= 0) continue;
        ctx.globalAlpha = fadeAlpha;
      }

      // Unit shadow (drawn at ground level before altitude offset)
      if (entity.alive) {
        if (entity.isAirUnit && altY > 0) {
          // Air unit shadow — offset by altitude for parallax
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.beginPath();
          ctx.ellipse(screen.x + altY * 0.3, screen.y + spriteH * 0.3, spriteW * 0.3, spriteH * 0.12, 0, 0, Math.PI * 2);
          ctx.fill();
        } else if (!entity.stats.isInfantry) {
          // Ground vehicle shadow — subtle dark ellipse under unit
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          ctx.beginPath();
          ctx.ellipse(screen.x, screen.y + spriteH * 0.35, spriteW * 0.35, spriteH * 0.12, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Apply altitude offset for rendering (sprite drawn higher)
      screen.y -= altY;

      // Selection circle (drawn under unit) — palette bright green
      if (selectedIds.has(entity.id) && entity.alive) {
        const rx = spriteW * 0.45;
        const ry = spriteW * 0.2;
        ctx.strokeStyle = this.palColor(PAL_GREEN_HP);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(screen.x, screen.y + spriteH * 0.3 + altY, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        // Medic heal range circle (dashed green)
        if (entity.type === UnitType.I_MEDI) {
          const healRange = entity.stats.sight * 1.5 * CELL_SIZE;
          ctx.strokeStyle = 'rgba(80,255,80,0.2)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.arc(screen.x, screen.y + altY, healRange, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Draw sprite with house-color tint
      if (sheet) {
        const frame = entity.spriteFrame % sheet.meta.frameCount;
        assets.drawFrame(ctx, entity.stats.image, frame, screen.x, screen.y, {
          centerX: true,
          centerY: true,
        });
        // Draw turret layer for turreted vehicles (frames 32-63)
        if (entity.hasTurret && sheet.meta.frameCount >= 64) {
          const turretFrame = entity.turretFrame % sheet.meta.frameCount;
          assets.drawFrame(ctx, entity.stats.image, turretFrame, screen.x, screen.y, {
            centerX: true,
            centerY: true,
          });
        }
        // Air unit rotor animation overlay (spinning rotor blades)
        if (entity.isAirUnit && entity.alive) {
          const rotorPhase = (tick * 3) % 4; // 4-phase rotor spin
          ctx.strokeStyle = 'rgba(160,160,160,0.6)';
          ctx.lineWidth = 1;
          const rr = spriteW * 0.4;
          const ang = (rotorPhase / 4) * Math.PI;
          ctx.beginPath();
          ctx.moveTo(screen.x - Math.cos(ang) * rr, screen.y - spriteH * 0.3 - Math.sin(ang) * rr * 0.4);
          ctx.lineTo(screen.x + Math.cos(ang) * rr, screen.y - spriteH * 0.3 + Math.sin(ang) * rr * 0.4);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(screen.x - Math.cos(ang + Math.PI / 2) * rr, screen.y - spriteH * 0.3 - Math.sin(ang + Math.PI / 2) * rr * 0.4);
          ctx.lineTo(screen.x + Math.cos(ang + Math.PI / 2) * rr, screen.y - spriteH * 0.3 + Math.sin(ang + Math.PI / 2) * rr * 0.4);
          ctx.stroke();
        }
        // Apply house-color tint as a colored overlay on the sprite area
        const tint = HOUSE_TINT[entity.house];
        if (tint && tint !== 'rgba(0,0,0,0)') {
          ctx.fillStyle = tint;
          ctx.fillRect(
            screen.x - spriteW / 2,
            screen.y - spriteH / 2,
            spriteW,
            spriteH,
          );
        }
        // Harvester harvesting animation: small ore chunks flying into harvester
        if (entity.type === UnitType.V_HARV && entity.harvesterState === 'harvesting') {
          for (let i = 0; i < 2; i++) {
            const angle = ((tick * 0.5 + i * 3.14) % (Math.PI * 2));
            const dist = 6 + Math.sin(tick * 0.4 + i * 2) * 3;
            const ox = screen.x + Math.cos(angle) * dist;
            const oy = screen.y + Math.sin(angle) * dist * 0.6;
            const oa = 0.6 + 0.3 * Math.sin(tick * 0.3 + i);
            ctx.fillStyle = `rgba(180,140,40,${oa})`;
            ctx.fillRect(ox - 1, oy - 1, 2, 2);
          }
        }
        // Harvester unloading animation: pulsing money particles rising from unit
        if (entity.type === UnitType.V_HARV && entity.harvesterState === 'unloading') {
          const phase = (tick * 0.3) % (Math.PI * 2);
          for (let i = 0; i < 3; i++) {
            const px = screen.x - 4 + (i * 4);
            const py = screen.y - spriteH * 0.3 - ((tick * 0.8 + i * 5) % 12);
            const pa = 0.8 - ((tick * 0.8 + i * 5) % 12) / 12;
            ctx.fillStyle = `rgba(255,220,60,${pa})`;
            ctx.fillRect(px, py, 2, 2);
          }
          // Subtle yellow glow around harvester
          ctx.fillStyle = `rgba(255,220,60,${0.1 + 0.05 * Math.sin(phase)})`;
          ctx.beginPath();
          ctx.ellipse(screen.x, screen.y, spriteW * 0.5, spriteH * 0.4, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Fallback
        const size = entity.stats.isInfantry ? 8 : 16;
        ctx.fillStyle = entity.isPlayerUnit ? '#4a8' : '#d44';
        ctx.fillRect(screen.x - size / 2, screen.y - size / 2, size, size);
      }

      // Damage flash overlay
      if (entity.damageFlash > 0 && entity.alive) {
        const flashAlpha = entity.damageFlash / 4;
        ctx.fillStyle = `rgba(255,50,50,${flashAlpha * 0.5})`;
        ctx.fillRect(
          screen.x - spriteW / 2,
          screen.y - spriteH / 2,
          spriteW,
          spriteH,
        );
      }

      // Movement dust trail for vehicles/ants when walking
      if (entity.alive && !entity.stats.isInfantry && entity.animState === AnimState.WALK) {
        const dustPhase = (tick + entity.id * 5) % 8;
        // Dust puffs behind the unit (opposite to facing direction)
        const facingRad = entity.facing * (Math.PI / 4);
        const behindX = screen.x + Math.sin(facingRad) * 4;
        const behindY = screen.y + Math.cos(facingRad) * 4;
        for (let d = 0; d < 2; d++) {
          const age = (dustPhase + d * 4) % 8;
          const da = (0.25 - age * 0.03) * (entity.isAnt ? 0.5 : 1);
          if (da > 0) {
            const dx = behindX + Math.sin(tick * 0.4 + d * 2) * (1 + age * 0.3);
            const dy = behindY + age * 0.3;
            ctx.fillStyle = `rgba(140,120,90,${da.toFixed(2)})`;
            ctx.beginPath();
            ctx.arc(dx, dy, 1 + age * 0.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Smoke trail from heavily damaged vehicles (below 50% HP)
      if (entity.alive && !entity.stats.isInfantry && entity.hp < entity.maxHp * 0.5) {
        const smokePhase = (tick + entity.id * 7) % 12;
        for (let s = 0; s < 3; s++) {
          const py = screen.y - spriteH * 0.3 - s * 4 - smokePhase * 0.5;
          const px = screen.x + Math.sin((tick + s * 4) * 0.3) * 2;
          const sa = (0.5 - s * 0.12) * (1 - smokePhase / 12);
          if (sa > 0) {
            ctx.fillStyle = `rgba(40,40,40,${sa})`;
            ctx.beginPath();
            ctx.arc(px, py, 2 + s * 0.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      ctx.globalAlpha = 1;

      // Harvester ore load bar (small gold bar above health bar, only when selected)
      if (entity.alive && entity.type === UnitType.V_HARV && selectedIds.has(entity.id) && entity.oreLoad > 0) {
        const oreRatio = entity.oreLoad / Entity.ORE_CAPACITY;
        const oreBarW = Math.max(spriteW, 18);
        const oreBarH = 2;
        const oreBarX = screen.x - oreBarW / 2;
        const oreBarY = screen.y - spriteH / 2 - 9;
        ctx.fillStyle = '#111';
        ctx.fillRect(oreBarX - 1, oreBarY - 1, oreBarW + 2, oreBarH + 2);
        ctx.fillStyle = '#c8a030'; // gold ore color
        ctx.fillRect(oreBarX, oreBarY, oreBarW * oreRatio, oreBarH);
      }

      // Health bar (show for damaged units and selected units)
      if (entity.alive && (entity.hp < entity.maxHp || selectedIds.has(entity.id))) {
        this.renderHealthBar(
          screen.x,
          screen.y - spriteH / 2 - 5,
          Math.max(spriteW, 18),
          entity.hp / entity.maxHp,
          selectedIds.has(entity.id),
        );
      }

      // Elite unit golden glow (subtle pulsing outline)
      if (entity.alive && entity.veterancy >= 2) {
        const glow = 0.12 + 0.06 * Math.sin(tick * 0.15 + entity.id);
        ctx.strokeStyle = `rgba(255,215,0,${glow})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(screen.x, screen.y + altY, spriteW * 0.55, spriteH * 0.35, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Veterancy star indicator (above health bar)
      if (entity.alive && entity.veterancy > 0) {
        const starY = screen.y - spriteH / 2 - (entity.hp < entity.maxHp || selectedIds.has(entity.id) ? 12 : 5);
        const starX = screen.x;
        ctx.fillStyle = entity.veterancy >= 2 ? '#FFD700' : '#C0C0C0'; // gold or silver
        const starSize = 3;
        const count = entity.veterancy; // 1 star = veteran, 2 stars = elite
        for (let i = 0; i < count; i++) {
          const sx = starX - (count - 1) * 3 + i * 6;
          // Draw 4-pointed star
          ctx.beginPath();
          ctx.moveTo(sx, starY - starSize);
          ctx.lineTo(sx + starSize * 0.4, starY - starSize * 0.4);
          ctx.lineTo(sx + starSize, starY);
          ctx.lineTo(sx + starSize * 0.4, starY + starSize * 0.4);
          ctx.lineTo(sx, starY + starSize);
          ctx.lineTo(sx - starSize * 0.4, starY + starSize * 0.4);
          ctx.lineTo(sx - starSize, starY);
          ctx.lineTo(sx - starSize * 0.4, starY - starSize * 0.4);
          ctx.closePath();
          ctx.fill();
        }
      }

      // Stance indicator for selected player units (small dot to right of selection circle)
      if (entity.alive && entity.isPlayerUnit && selectedIds.has(entity.id) &&
          entity.stance !== Stance.AGGRESSIVE) {
        const dotX = screen.x + spriteW * 0.45 + 3;
        const dotY = screen.y + spriteH * 0.3 + altY;
        ctx.fillStyle = entity.stance === Stance.HOLD_FIRE ? '#f44' : '#ff0'; // red=hold, yellow=defensive
        ctx.beginPath();
        ctx.arc(dotX, dotY, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ─── Health Bars ─────────────────────────────────────────

  private renderHealthBar(
    x: number, y: number, width: number,
    ratio: number, isSelected: boolean,
  ): void {
    const ctx = this.ctx;
    const barW = width;
    const barH = isSelected ? 4 : 3;
    const bx = x - barW / 2;

    // Black border
    ctx.fillStyle = '#000';
    ctx.fillRect(bx - 1, y - 1, barW + 2, barH + 2);

    // Dark background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(bx, y, barW, barH);

    // Health fill with pip segments — palette-accurate green/yellow/red
    const color = ratio > 0.66 ? this.palColor(PAL_GREEN_HP) :
                  ratio > 0.33 ? this.palColor(156) :  // palette yellow [255,255,158]
                                 this.palColor(PAL_RED_HP);
    const fillW = barW * ratio;
    ctx.fillStyle = color;
    ctx.fillRect(bx, y, fillW, barH);

    // Pip dividers
    const pips = Math.min(8, Math.ceil(barW / 4));
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    for (let i = 1; i < pips; i++) {
      const px = bx + (barW / pips) * i;
      ctx.fillRect(px, y, 1, barH);
    }
  }

  // ─── Waypoint Markers ────────────────────────────────────

  private renderWaypoints(camera: Camera, entities: Entity[], selectedIds: Set<number>): void {
    const ctx = this.ctx;
    for (const entity of entities) {
      if (!entity.alive || !selectedIds.has(entity.id)) continue;
      if (entity.moveQueue.length === 0) continue;

      ctx.strokeStyle = 'rgba(100,255,100,0.5)';
      ctx.fillStyle = 'rgba(100,255,100,0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);

      // Draw line from current moveTarget (or position) through queue
      const start = entity.moveTarget ?? entity.pos;
      let prev = camera.worldToScreen(start.x, start.y);
      for (const wp of entity.moveQueue) {
        const screen = camera.worldToScreen(wp.x, wp.y);
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(screen.x, screen.y);
        ctx.stroke();
        // Waypoint dot
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 3, 0, Math.PI * 2);
        ctx.fill();
        prev = screen;
      }
      ctx.setLineDash([]);
    }
  }

  // ─── Target Lines ───────────────────────────────────────

  private renderTargetLines(camera: Camera, entities: Entity[], selectedIds: Set<number>): void {
    const ctx = this.ctx;
    for (const entity of entities) {
      if (!entity.alive || !selectedIds.has(entity.id)) continue;
      if (!entity.target?.alive) continue;
      // Draw thin dashed line from attacker to target
      const from = camera.worldToScreen(entity.pos.x, entity.pos.y);
      const to = camera.worldToScreen(entity.target.pos.x, entity.target.pos.y);
      ctx.strokeStyle = 'rgba(255,80,80,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Small red diamond on target
      ctx.fillStyle = 'rgba(255,80,80,0.5)';
      ctx.beginPath();
      ctx.moveTo(to.x, to.y - 4);
      ctx.lineTo(to.x + 4, to.y);
      ctx.lineTo(to.x, to.y + 4);
      ctx.lineTo(to.x - 4, to.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ─── Effects ─────────────────────────────────────────────

  private renderEffects(camera: Camera, effects: Effect[], assets: AssetManager): void {
    const ctx = this.ctx;

    for (const fx of effects) {
      // Skip effects with negative frame (staggered delay — not yet visible)
      if (fx.frame < 0) continue;
      const screen = camera.worldToScreen(fx.x, fx.y);
      const progress = fx.frame / fx.maxFrames;

      // Sprite-based rendering: if the effect has a sprite sheet, use it
      if (fx.sprite) {
        const sheet = assets.getSheet(fx.sprite);
        if (sheet) {
          const frameIdx = (fx.spriteStart ?? 0) + Math.min(fx.frame, sheet.meta.frameCount - 1);
          const alpha = fx.type === 'tesla' ? 1 - progress * 0.5 : 1;
          if (alpha < 1) ctx.globalAlpha = alpha;
          assets.drawFrame(ctx, fx.sprite, frameIdx % sheet.meta.frameCount, screen.x, screen.y, {
            centerX: true,
            centerY: true,
          });
          if (alpha < 1) ctx.globalAlpha = 1;
          continue;
        }
        // Fall through to procedural if sprite not loaded
      }

      // Projectile rendering
      if (fx.type === 'projectile' && fx.startX != null && fx.startY != null &&
          fx.endX != null && fx.endY != null) {
        const t = fx.frame / fx.maxFrames;
        const px = fx.startX + (fx.endX - fx.startX) * t;
        const py = fx.startY + (fx.endY - fx.startY) * t;
        // Arc for shells/rockets/grenades (grenades arc higher)
        const arcY = fx.projStyle === 'grenade' ? -Math.sin(t * Math.PI) * 45
          : (fx.projStyle === 'shell' || fx.projStyle === 'rocket')
            ? -Math.sin(t * Math.PI) * 30 : 0;
        const screenP = camera.worldToScreen(px, py + arcY);

        switch (fx.projStyle) {
          case 'bullet': {
            ctx.fillStyle = '#ff0';
            ctx.fillRect(screenP.x - 1, screenP.y - 1, 2, 2);
            break;
          }
          case 'fireball': {
            ctx.fillStyle = `rgba(255,${100 + Math.floor(t * 100)},30,${1 - t * 0.3})`;
            ctx.beginPath();
            ctx.arc(screenP.x, screenP.y, 3 + t * 2, 0, Math.PI * 2);
            ctx.fill();
            break;
          }
          case 'shell': {
            ctx.fillStyle = '#ccc';
            ctx.fillRect(screenP.x - 1, screenP.y - 1, 3, 3);
            // Shadow on ground
            const groundScreen = camera.worldToScreen(px, py);
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(groundScreen.x - 1, groundScreen.y, 2, 1);
            break;
          }
          case 'rocket': {
            ctx.fillStyle = '#fa0';
            ctx.fillRect(screenP.x - 1, screenP.y - 1, 3, 3);
            // Multi-puff smoke trail
            for (let si = 1; si <= 4; si++) {
              const trailT = Math.max(0, t - si * 0.06);
              if (trailT <= 0) break;
              const stx = fx.startX! + (fx.endX! - fx.startX!) * trailT;
              const sty = fx.startY! + (fx.endY! - fx.startY!) * trailT - Math.sin(trailT * Math.PI) * 30;
              const sScreen = camera.worldToScreen(stx, sty);
              const sAlpha = 0.4 - si * 0.08;
              const sSize = 1 + si * 0.5;
              ctx.fillStyle = `rgba(180,180,180,${sAlpha})`;
              ctx.beginPath();
              ctx.arc(sScreen.x, sScreen.y, sSize, 0, Math.PI * 2);
              ctx.fill();
            }
            break;
          }
          case 'grenade': {
            // Tumbling grenade with shadow
            ctx.fillStyle = '#555';
            const gSize = 2 + Math.sin(t * Math.PI * 4) * 0.5;
            ctx.beginPath();
            ctx.arc(screenP.x, screenP.y, gSize, 0, Math.PI * 2);
            ctx.fill();
            // Shadow on ground
            const gGround = camera.worldToScreen(px, py);
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fillRect(gGround.x - 1, gGround.y, 3, 1);
            break;
          }
        }
        continue;
      }

      // Command marker (move/attack feedback)
      if (fx.type === 'marker' && fx.markerColor) {
        const alpha = 1 - progress;
        const r = fx.size * (1 - progress * 0.5);
        ctx.strokeStyle = fx.markerColor.replace('1)', `${alpha})`);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
        ctx.stroke();
        // Inner shrinking ring
        if (progress < 0.5) {
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, r * 0.4, 0, Math.PI * 2);
          ctx.stroke();
        }
        continue;
      }

      // Procedural fallback for effects without sprite sheets
      switch (fx.type) {
        case 'explosion': {
          const radius = fx.size * (0.3 + progress * 0.7);
          const alpha = 1 - progress;
          const gradient = ctx.createRadialGradient(
            screen.x, screen.y, 0,
            screen.x, screen.y, radius,
          );
          gradient.addColorStop(0, `rgba(255,200,50,${alpha * 0.8})`);
          gradient.addColorStop(0.4, `rgba(255,100,20,${alpha * 0.6})`);
          gradient.addColorStop(1, `rgba(200,30,0,0)`);
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
          ctx.fill();
          if (progress < 0.3) {
            ctx.fillStyle = `rgba(255,255,200,${(0.3 - progress) * 2})`;
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, radius * 0.4, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        case 'muzzle': {
          const alpha = 1 - progress;
          const r = fx.size * (1 - progress * 0.5);
          const mc = fx.muzzleColor ?? '255,255,150';
          ctx.fillStyle = `rgba(${mc},${alpha})`;
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
          ctx.fill();
          // Bright core
          ctx.fillStyle = `rgba(255,255,255,${alpha * 0.6})`;
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, r * 0.4, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'blood': {
          const alpha = 1 - progress;
          const seed = (fx.x * 7 + fx.y * 13) | 0;
          for (let i = 0; i < 5; i++) {
            const angle = ((seed + i * 73) % 360) * Math.PI / 180;
            const dist = progress * fx.size * (1 + (i % 3));
            const px = screen.x + Math.cos(angle) * dist;
            const py = screen.y + Math.sin(angle) * dist;
            ctx.fillStyle = `rgba(180,20,20,${alpha * 0.7})`;
            ctx.fillRect(px - 1, py - 1, 2, 2);
          }
          break;
        }
        case 'tesla': {
          const alpha = 1 - progress * 0.6;
          const seed = (fx.x * 11 + fx.y * 17 + fx.frame * 31) | 0;
          // Lightning bolt from source to target (or local effect if no source)
          const hasTravel = fx.startX !== undefined && fx.startY !== undefined;
          const sStart = hasTravel
            ? camera.worldToScreen(fx.startX!, fx.startY!)
            : { x: screen.x - fx.size, y: screen.y };
          const sEnd = screen;
          const dx = sEnd.x - sStart.x;
          const dy = sEnd.y - sStart.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const jitter = Math.max(Math.min(len * 0.15, 12), 2);
          const segments = 8;
          // Build jagged bolt path with perpendicular offsets
          const pts: Array<{ x: number; y: number }> = [sStart];
          const nx = -dy / len, ny = dx / len;
          for (let i = 1; i < segments; i++) {
            const t = i / segments;
            const perp = ((seed + i * 47 + fx.frame * 13) % (Math.floor(jitter * 2) + 1)) - jitter;
            pts.push({ x: sStart.x + dx * t + nx * perp, y: sStart.y + dy * t + ny * perp });
          }
          pts.push(sEnd);
          // Helper to draw the bolt path
          const drawBolt = () => {
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
          };
          // Outer glow
          ctx.strokeStyle = `rgba(80,150,255,${alpha * 0.3})`;
          ctx.lineWidth = 6;
          drawBolt();
          // Main bright bolt
          ctx.strokeStyle = `rgba(130,210,255,${alpha})`;
          ctx.lineWidth = 2;
          drawBolt();
          // Inner white core (brief)
          if (progress < 0.3) {
            ctx.strokeStyle = `rgba(220,240,255,${(0.3 - progress) * 2})`;
            ctx.lineWidth = 1;
            drawBolt();
          }
          // Branch sparks from 2 random segments
          ctx.lineWidth = 1;
          for (let b = 0; b < 2; b++) {
            const bi = 1 + ((seed + b * 3 + fx.frame) % (segments - 1));
            const bp = pts[bi];
            const bAngle = ((seed + b * 43 + fx.frame * 17) % 360) * Math.PI / 180;
            const bLen = jitter * 1.5 + 4;
            ctx.strokeStyle = `rgba(100,180,255,${alpha * 0.5})`;
            ctx.beginPath();
            ctx.moveTo(bp.x, bp.y);
            ctx.lineTo(bp.x + Math.cos(bAngle) * bLen, bp.y + Math.sin(bAngle) * bLen);
            ctx.stroke();
          }
          // Impact spark at target
          ctx.fillStyle = `rgba(200,230,255,${alpha * (1 - progress * 0.5)})`;
          ctx.beginPath();
          ctx.arc(sEnd.x, sEnd.y, 3 + (1 - progress) * 3, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'debris': {
          // Flying debris pieces from vehicle destruction
          const alpha = 1 - progress;
          const seed = (fx.x * 7 + fx.y * 11) | 0;
          for (let i = 0; i < 4; i++) {
            const angle = ((seed + i * 90) % 360) * Math.PI / 180;
            const dist = progress * fx.size * (1.5 + (i % 2));
            const arcY = -Math.sin(progress * Math.PI) * 15; // arc upward
            const px = screen.x + Math.cos(angle) * dist;
            const py = screen.y + Math.sin(angle) * dist + arcY;
            ctx.fillStyle = `rgba(60,55,50,${alpha * 0.8})`;
            ctx.fillRect(px - 2, py - 1, 3 + (i % 2), 2);
          }
          break;
        }
        case 'text': {
          // Floating text (credits gained, etc.) — rises and fades
          const alpha = 1 - progress;
          const riseY = progress * 20; // float upward 20px
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = `rgba(0,0,0,${alpha * 0.6})`;
          ctx.fillText(fx.text ?? '', screen.x + 1, screen.y - riseY + 1);
          ctx.fillStyle = (fx.textColor ?? 'rgba(80,255,80,1)').replace(/[\d.]+\)$/, `${alpha})`);
          ctx.fillText(fx.text ?? '', screen.x, screen.y - riseY);
          ctx.textAlign = 'left';
          break;
        }
      }
    }
    // Defensive alpha reset after effects pass
    ctx.globalAlpha = 1;
  }

  // ─── Fog of War ──────────────────────────────────────────

  private renderFogOfWar(camera: Camera, map: GameMap): void {
    const ctx = this.ctx;
    const startCX = Math.floor(camera.x / CELL_SIZE);
    const startCY = Math.floor(camera.y / CELL_SIZE);
    const endCX = Math.ceil((camera.x + camera.viewWidth) / CELL_SIZE);
    const endCY = Math.ceil((camera.y + camera.viewHeight) / CELL_SIZE);
    const half = CELL_SIZE / 2;

    for (let cy = startCY; cy <= endCY; cy++) {
      for (let cx = startCX; cx <= endCX; cx++) {
        const vis = map.getVisibility(cx, cy);
        if (vis === 2) continue; // fully visible

        const screen = camera.worldToScreen(cx * CELL_SIZE, cy * CELL_SIZE);

        if (vis === 0) {
          // Shroud — solid black with edge blending
          ctx.fillStyle = '#000';
          ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);

          // Soften edges where shroud meets revealed terrain
          // Check 4 cardinal neighbors for visibility transitions
          const vN = map.getVisibility(cx, cy - 1);
          const vS = map.getVisibility(cx, cy + 1);
          const vW = map.getVisibility(cx - 1, cy);
          const vE = map.getVisibility(cx + 1, cy);

          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          if (vN > 0) ctx.fillRect(screen.x, screen.y - half, CELL_SIZE, half);
          if (vS > 0) ctx.fillRect(screen.x, screen.y + CELL_SIZE, CELL_SIZE, half);
          if (vW > 0) ctx.fillRect(screen.x - half, screen.y, half, CELL_SIZE);
          if (vE > 0) ctx.fillRect(screen.x + CELL_SIZE, screen.y, half, CELL_SIZE);
        } else {
          // Fog — semi-transparent dark overlay
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
        }
      }
    }
  }

  // ─── Selection Box ───────────────────────────────────────

  private renderSelectionBox(input: InputState): void {
    if (!input.isDragging) return;
    const ctx = this.ctx;
    const x1 = Math.min(input.dragStartX, input.mouseX);
    const y1 = Math.min(input.dragStartY, input.mouseY);
    const x2 = Math.max(input.dragStartX, input.mouseX);
    const y2 = Math.max(input.dragStartY, input.mouseY);

    // Semi-transparent fill — palette green
    ctx.fillStyle = this.palColor(PAL_GREEN_HP);
    ctx.globalAlpha = 0.08;
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.globalAlpha = 1;

    // Green border — palette green
    ctx.strokeStyle = this.palColor(PAL_GREEN_HP);
    ctx.lineWidth = 1;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }

  // ─── Minimap ─────────────────────────────────────────────

  private renderMinimap(map: GameMap, entities: Entity[], structures: MapStructure[], camera: Camera): void {
    const ctx = this.ctx;
    const mmSize = this.sidebarW - 8;
    const mmX = this.width - this.sidebarW + 4;
    const mmY = this.height - mmSize - 6;
    const scale = mmSize / Math.max(map.boundsW, map.boundsH);
    const ox = map.boundsX;
    const oy = map.boundsY;

    // Background with border
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(mmX - 2, mmY - 2, mmSize + 4, mmSize + 4);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.strokeRect(mmX - 2, mmY - 2, mmSize + 4, mmSize + 4);

    // No radar: show static noise instead of map (update every 10 render calls)
    if (!this.hasRadar) {
      this.radarStaticCounter = (this.radarStaticCounter ?? 0) + 1;
      if (!this.radarStaticData || this.radarStaticCounter % 10 === 0) {
        const cells = Math.ceil(mmSize / 3);
        this.radarStaticData = new Uint8Array(cells * cells);
        for (let i = 0; i < this.radarStaticData.length; i++) {
          this.radarStaticData[i] = Math.floor(Math.random() * 40);
        }
      }
      const cells = Math.ceil(mmSize / 3);
      for (let i = 0; i < this.radarStaticData!.length; i++) {
        const px = mmX + (i % cells) * 3;
        const py = mmY + Math.floor(i / cells) * 3;
        const v = this.radarStaticData![i];
        ctx.fillStyle = `rgb(${v},${v + 5},${v})`;
        ctx.fillRect(px, py, 3, 3);
      }
      ctx.fillStyle = '#666';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('NO RADAR', mmX + mmSize / 2, mmY + mmSize / 2);
      ctx.textAlign = 'left';
      return;
    }

    // Terrain (with fog awareness)
    for (let cy = map.boundsY; cy < map.boundsY + map.boundsH; cy += 2) {
      for (let cx = map.boundsX; cx < map.boundsX + map.boundsW; cx += 2) {
        const vis = map.getVisibility(cx, cy);
        if (vis === 0) continue; // Don't show shrouded areas

        const terrain = map.getTerrain(cx, cy);
        const px = mmX + (cx - ox) * scale;
        const py = mmY + (cy - oy) * scale;
        const ps = Math.max(scale * 2, 1);

        if (terrain === Terrain.WATER) {
          ctx.fillStyle = this.palColor(PAL_WATER_START + 2, vis === 2 ? 0 : -50);
        } else if (terrain === Terrain.TREE) {
          ctx.fillStyle = this.palColor(PAL_GRASS_START + 9, vis === 2 ? 0 : -40);
        } else if (terrain === Terrain.ROCK || terrain === Terrain.WALL) {
          ctx.fillStyle = this.palColor(PAL_ROCK_START + 8, vis === 2 ? 0 : -40);
        } else {
          // Check for ore/gem overlay
          const ovl = map.overlay[cy * 128 + cx];
          if (ovl >= 0x03 && ovl <= 0x0E) {
            ctx.fillStyle = vis === 2 ? '#c8a030' : '#806020'; // gold ore dot
          } else if (ovl >= 0x0F && ovl <= 0x12) {
            ctx.fillStyle = vis === 2 ? '#3090d0' : '#205880'; // blue gem dot
          } else {
            ctx.fillStyle = this.palColor(PAL_GRASS_START + 6, vis === 2 ? 0 : -40);
          }
        }
        ctx.fillRect(px, py, ps, ps);
      }
    }

    // Structure outlines (using actual footprint sizes)
    for (const s of structures) {
      if (!s.alive) continue;
      const vis = map.getVisibility(s.cx, s.cy);
      if (vis === 0) continue;
      const isPlayer = s.house === 'Spain' || s.house === 'Greece';
      const [fw, fh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
      const sx = mmX + (s.cx - ox) * scale;
      const sy = mmY + (s.cy - oy) * scale;
      const sw = Math.max(fw * scale, 2);
      const sh = Math.max(fh * scale, 2);
      ctx.fillStyle = isPlayer ? 'rgba(80,220,255,0.85)' : 'rgba(220,50,50,0.85)';
      ctx.fillRect(sx, sy, sw, sh);
    }

    // Unit dots — bright cyan for player (like original RA), red for enemies
    const blinkOn = Math.floor(Date.now() / 300) % 2 === 0; // blink cycle for selected
    for (const e of entities) {
      if (!e.alive) continue;
      const ecx = Math.floor(e.pos.x / CELL_SIZE);
      const ecy = Math.floor(e.pos.y / CELL_SIZE);
      const vis = map.getVisibility(ecx, ecy);
      if (vis === 0) continue;
      if (vis === 1 && !e.isPlayerUnit) continue;

      // Selected units blink white on minimap
      const isSelected = this._selectedIds.has(e.id);
      if (isSelected && !blinkOn) {
        ctx.fillStyle = '#fff';
      } else if (e.isPlayerUnit) {
        ctx.fillStyle = '#40e0ff'; // cyan like original RA player color
      } else if (e.isCivilian) {
        ctx.fillStyle = '#c0c0c0'; // gray for civilians
      } else {
        ctx.fillStyle = '#ff3030'; // bright red for enemies
      }
      const dotSize = Math.max(scale, 2);
      ctx.fillRect(
        mmX + (ecx - ox) * scale,
        mmY + (ecy - oy) * scale,
        dotSize, dotSize,
      );
    }

    // Camera viewport
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      mmX + (camera.x / CELL_SIZE - ox) * scale,
      mmY + (camera.y / CELL_SIZE - oy) * scale,
      (camera.viewWidth / CELL_SIZE) * scale,
      (camera.viewHeight / CELL_SIZE) * scale,
    );

    // Alert flashes (pulsing red dots for EVA alerts)
    const now = Date.now();
    for (let i = this.minimapAlerts.length - 1; i >= 0; i--) {
      const alert = this.minimapAlerts[i];
      const age = now - alert.tick;
      if (age > 3000) { this.minimapAlerts.splice(i, 1); continue; }
      const alpha = (Math.sin(age * 0.01) * 0.5 + 0.5) * (1 - age / 3000);
      ctx.fillStyle = `rgba(255,60,60,${alpha})`;
      const ax = mmX + (alert.cx - ox) * scale;
      const ay = mmY + (alert.cy - oy) * scale;
      ctx.beginPath();
      ctx.arc(ax, ay, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ─── Attack-Move Indicator ──────────────────────────────

  private renderAttackMoveIndicator(input: InputState): void {
    const ctx = this.ctx;
    const mx = input.mouseX;
    const my = input.mouseY;
    const s = 8;
    // Red crosshair near cursor
    ctx.strokeStyle = 'rgba(255,80,80,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mx - s, my); ctx.lineTo(mx + s, my);
    ctx.moveTo(mx, my - s); ctx.lineTo(mx, my + s);
    ctx.stroke();
    // "A" label
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = 'rgba(255,80,80,0.9)';
    ctx.fillText('A', mx + s + 2, my - 2);
  }

  private renderModeLabel(input: InputState, label: string, color: string): void {
    const ctx = this.ctx;
    const mx = input.mouseX;
    const my = input.mouseY;
    // Draw icon near cursor
    if (label === 'SELL') {
      // Dollar sign icon
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = 'rgba(255,200,60,0.9)';
      ctx.fillText('$', mx + 10, my + 4);
      ctx.font = 'bold 8px monospace';
      ctx.fillStyle = 'rgba(255,200,60,0.6)';
      ctx.fillText('SELL', mx + 10, my + 14);
    } else if (label === 'REPAIR') {
      // Wrench icon (unicode)
      ctx.font = '12px monospace';
      ctx.fillStyle = 'rgba(80,255,80,0.9)';
      ctx.fillText('W', mx + 10, my + 4);
      ctx.font = 'bold 8px monospace';
      ctx.fillStyle = 'rgba(80,255,80,0.6)';
      ctx.fillText('FIX', mx + 10, my + 14);
    } else {
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = color;
      ctx.fillText(label, mx + 12, my - 4);
    }
  }

  // ─── EVA Messages & Mission Timer ──────────────────────

  renderEvaMessages(tick: number): void {
    const ctx = this.ctx;
    // Show messages that are less than 4 seconds old (60 ticks)
    const active = this.evaMessages.filter(m => tick - m.tick < 60);
    if (active.length === 0 && this.missionTimer <= 0) return;

    // Mission timer display (top center)
    if (this.missionTimer > 0) {
      const totalSecs = Math.ceil(this.missionTimer / GAME_TICKS_PER_SEC);
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      const timerText = `${mins}:${secs.toString().padStart(2, '0')}`;
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = totalSecs < 30 ? '#f44' : '#ff0';
      ctx.fillText(timerText, (this.width - this.sidebarW) / 2, 20);
    }

    // EVA text messages (top-center, stacked)
    if (active.length > 0) {
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      const centerX = (this.width - this.sidebarW) / 2;
      for (let i = 0; i < active.length; i++) {
        const msg = active[i];
        const age = tick - msg.tick;
        const alpha = age < 45 ? 1.0 : 1.0 - (age - 45) / 15; // fade out last 1s
        ctx.fillStyle = `rgba(0,255,0,${alpha.toFixed(2)})`;
        ctx.fillText(msg.text, centerX, 36 + i * 14);
      }
    }
    ctx.textAlign = 'left';
  }

  // ─── Music Track Display ─────────────────────────────────

  private lastMusicTrack = '';
  private musicTrackShowTick = 0;

  renderMusicTrack(tick: number): void {
    if (!this.musicTrack) return;
    // Detect track change → reset display timer
    if (this.musicTrack !== this.lastMusicTrack) {
      this.lastMusicTrack = this.musicTrack;
      this.musicTrackShowTick = tick;
    }
    // Show for 4 seconds (60 ticks) after track change
    const age = tick - this.musicTrackShowTick;
    if (age > 60) return;
    const alpha = age < 45 ? 0.7 : 0.7 * (1 - (age - 45) / 15);
    const ctx = this.ctx;
    const gameW = this.width - this.sidebarW;
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = `rgba(180,180,180,${alpha.toFixed(2)})`;
    ctx.fillText(`♪ ${this.musicTrack}`, gameW - 6, this.height - 6);
    ctx.textAlign = 'left';
  }

  /** Render game speed indicator when not at 1x */
  renderGameSpeed(): void {
    if (this.gameSpeed <= 1) return;
    const ctx = this.ctx;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = this.gameSpeed >= 4 ? 'rgba(255,100,50,0.8)' : 'rgba(255,200,50,0.8)';
    ctx.fillText(`▸▸ ${this.gameSpeed}×`, 6, this.height - 6);
    ctx.textAlign = 'left';
  }

  // ─── Pause Overlay ──────────────────────────────────────

  renderPauseOverlay(): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.textAlign = 'center';
    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = this.palColor(PAL_ROCK_START + 2);
    ctx.fillText('PAUSED', this.width / 2, this.height / 2 - 10);
    ctx.font = '12px monospace';
    ctx.fillStyle = this.palColor(PAL_ROCK_START + 4);
    ctx.fillText('Press P to resume', this.width / 2, this.height / 2 + 15);
    ctx.textAlign = 'left';
  }

  // ─── Help Overlay ──────────────────────────────────────

  private renderIdleCount(): void {
    const ctx = this.ctx;
    const text = `Idle: ${this.idleCount}`;
    const mmBottom = this.height - 6; // below minimap
    const x = this.width - this.sidebarW;
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = this.idleCount > 0 ? '#ff8' : '#888';
    ctx.fillText(text, x + this.sidebarW / 2, mmBottom + 12);
    ctx.textAlign = 'left';
  }

  private renderHelpOverlay(): void {
    const ctx = this.ctx;
    const w = 280;
    const sections: Array<{ title: string; lines: string[] }> = [
      { title: 'UNIT COMMANDS', lines: [
        'S / G     Stop / Guard',
        'A         Attack-move mode',
        'Z         Cycle stance (Agg/Def/Hold)',
        'X         Scatter units',
        'Ctrl+RMB  Force-fire ground',
        'Shift+RMB Queue waypoints',
        'D         Deploy MCV',
      ]},
      { title: 'SELECTION', lines: [
        'LMB       Click select / drag box',
        'DblClick   Select all of type',
        'E         Select all same type',
        '1-9       Recall control group',
        'Ctrl+1-9  Assign control group',
        'Tab       Cycle unit types',
        '.         Cycle idle units',
      ]},
      { title: 'BUILDINGS', lines: [
        'Q         Sell mode',
        'R         Repair mode',
        'RMB build Set rally point',
      ]},
      { title: 'CAMERA', lines: [
        'Home/Spc  Center on selection',
        'Arrow/WASD Scroll map',
        'Minimap    Click to move camera',
      ]},
      { title: 'AUDIO', lines: [
        '+/-       Volume up/down',
        'M         Mute/unmute',
        'N         Next music track',
      ]},
      { title: 'SPEED', lines: [
        '` (tick)  Cycle 1×/2×/4× speed',
      ]},
      { title: 'SYSTEM', lines: [
        'Esc       Cancel / Pause',
        'F1        Toggle this help',
        `Difficulty: ${this.difficulty.toUpperCase()}`,
      ]},
    ];

    const lineH = 12;
    const sectionGap = 6;
    let totalLines = 0;
    for (const s of sections) totalLines += 1 + s.lines.length; // title + lines
    const h = totalLines * lineH + sections.length * sectionGap + 20;
    const px = (this.width - w) / 2;
    const py = (this.height - h) / 2;

    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(px, py, w, h);
    ctx.strokeStyle = '#664400';
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, w, h);
    // Title bar
    ctx.fillStyle = 'rgba(255,68,0,0.15)';
    ctx.fillRect(px + 1, py + 1, w - 2, 16);
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = '#ff6633';
    ctx.textAlign = 'center';
    ctx.fillText('COMMAND REFERENCE', px + w / 2, py + 12);
    ctx.textAlign = 'left';

    let curY = py + 22;
    for (const section of sections) {
      ctx.font = 'bold 9px monospace';
      ctx.fillStyle = '#ffaa44';
      ctx.fillText(section.title, px + 8, curY);
      curY += lineH;
      ctx.font = '9px monospace';
      ctx.fillStyle = '#bbb';
      for (const line of section.lines) {
        // Highlight key portion (before first space gap)
        const split = line.indexOf('  ');
        if (split > 0) {
          ctx.fillStyle = '#ddd';
          ctx.fillText(line.slice(0, split), px + 12, curY);
          ctx.fillStyle = '#999';
          ctx.fillText(line.slice(split), px + 12 + ctx.measureText(line.slice(0, split)).width, curY);
        } else {
          ctx.fillStyle = '#999';
          ctx.fillText(line, px + 12, curY);
        }
        curY += lineH;
      }
      curY += sectionGap;
    }
  }

  // ─── Sidebar ──────────────────────────────────────────────

  private renderSidebar(assets: AssetManager): void {
    const ctx = this.ctx;
    const x = this.width - this.sidebarW;
    const w = this.sidebarW;

    // Background
    ctx.fillStyle = 'rgba(20,20,25,0.95)';
    ctx.fillRect(x, 0, w, this.height);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, this.height);
    ctx.stroke();

    // Credits
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFD700';
    ctx.fillText(`$${this.sidebarCredits}`, x + w / 2, 14);

    // Power bar with numeric labels + low-power pulse
    const pwrY = 18;
    const pwrW = w - 8;
    const pwrH = 8;
    const pwrX = x + 4;
    const lowPower = this.sidebarPowerConsumed > this.sidebarPowerProduced && this.sidebarPowerProduced > 0;
    ctx.fillStyle = '#111';
    ctx.fillRect(pwrX, pwrY, pwrW, pwrH);
    const pwrRatio = this.sidebarPowerProduced > 0
      ? Math.min(1, this.sidebarPowerConsumed / this.sidebarPowerProduced) : 1;
    const pwrColor = lowPower ? '#f44' : pwrRatio > 0.8 ? '#fa0' : '#4f4';
    ctx.fillStyle = pwrColor;
    ctx.fillRect(pwrX, pwrY, pwrW * Math.min(1, pwrRatio), pwrH);
    // Low-power pulsing red glow on the power bar
    if (lowPower) {
      const pulse = 0.15 + 0.15 * Math.sin(Date.now() * 0.005);
      ctx.fillStyle = `rgba(255,40,40,${pulse})`;
      ctx.fillRect(pwrX, pwrY, pwrW, pwrH);
    }
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.strokeRect(pwrX, pwrY, pwrW, pwrH);
    // Power numeric label (only show if player has power structures)
    if (this.sidebarPowerProduced > 0 || this.sidebarPowerConsumed > 0) {
      ctx.font = '7px monospace';
      ctx.fillStyle = lowPower ? '#f88' : '#888';
      ctx.textAlign = 'center';
      ctx.fillText(`${this.sidebarPowerConsumed}/${this.sidebarPowerProduced}`, x + w / 2, pwrY + pwrH + 8);
      // LOW POWER warning text (flashing)
      if (lowPower) {
        const flash = Math.sin(Date.now() * 0.006) > 0;
        if (flash) {
          ctx.font = 'bold 7px monospace';
          ctx.fillStyle = '#f44';
          ctx.fillText('LOW POWER', x + w / 2, pwrY + pwrH + 16);
        }
      }
    }

    // Production items — grouped by category with section headers
    const itemH = 22;
    const headerH = 12;
    const itemStartY = (this.sidebarPowerProduced > 0 || this.sidebarPowerConsumed > 0) ? 36 : 28;
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';

    let currentY = itemStartY - this.sidebarScroll;
    let lastCategory = '';

    for (let i = 0; i < this.sidebarItems.length; i++) {
      const item = this.sidebarItems[i];
      const category = item.isStructure ? 'structure' : item.prerequisite === 'TENT' ? 'infantry' : 'vehicle';

      // Category section header when category changes
      if (category !== lastCategory) {
        lastCategory = category;
        if (currentY >= itemStartY - headerH && currentY < this.height) {
          const headerLabel = category === 'structure' ? 'STRUCTURES'
            : category === 'infantry' ? 'INFANTRY' : 'VEHICLES';
          const headerColor = category === 'infantry' ? 'rgba(80,200,80,0.6)'
            : category === 'vehicle' ? 'rgba(80,120,255,0.6)' : 'rgba(200,180,60,0.6)';
          ctx.fillStyle = 'rgba(40,40,50,0.9)';
          ctx.fillRect(x + 1, currentY, w - 2, headerH);
          ctx.fillStyle = headerColor;
          ctx.font = 'bold 7px monospace';
          ctx.fillText(headerLabel, x + 4, currentY + 9);
          ctx.font = '9px monospace';
        }
        currentY += headerH;
      }

      const iy = currentY;
      currentY += itemH;
      if (iy < itemStartY - itemH || iy > this.height) continue;

      // Category color coding
      const catColor = category === 'infantry' ? 'rgba(80,200,80,0.15)'
        : category === 'vehicle' ? 'rgba(80,80,200,0.15)' : 'rgba(200,200,80,0.15)';

      // Item background
      ctx.fillStyle = catColor;
      ctx.fillRect(x + 2, iy, w - 4, itemH - 2);
      ctx.strokeStyle = 'rgba(100,100,100,0.3)';
      ctx.strokeRect(x + 2, iy, w - 4, itemH - 2);

      // Sprite thumbnail (18x18 area on left side of item)
      const thumbSize = 18;
      const thumbX = x + 3;
      const thumbCX = thumbX + thumbSize / 2;
      const thumbCY = iy + (itemH - 2) / 2;
      const spriteName = item.isStructure ? item.type.toLowerCase() : (UNIT_STATS[item.type]?.image ?? null);
      const thumbSheet = spriteName ? assets.getSheet(spriteName) : null;
      if (thumbSheet && spriteName) {
        const scale = Math.min(thumbSize / thumbSheet.meta.frameWidth, thumbSize / thumbSheet.meta.frameHeight);
        assets.drawFrame(ctx, spriteName, 0, thumbCX, thumbCY, {
          centerX: true, centerY: true, scale,
        });
      } else {
        // Fallback: colored rectangle with type abbreviation
        const fallbackColor = category === 'infantry' ? '#4a6' : category === 'vehicle' ? '#46a' : '#a84';
        ctx.fillStyle = fallbackColor;
        ctx.fillRect(thumbX, iy + 2, thumbSize, thumbSize - 2);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 6px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(item.type.slice(0, 4), thumbCX, thumbCY + 2);
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
      }
      const textX = x + 3 + thumbSize + 2; // text offset after thumbnail

      // Check if this category is building
      const qEntry = this.sidebarQueue.get(category);
      const isBuilding = qEntry && qEntry.item.type === item.type;

      if (isBuilding && qEntry) {
        // Progress bar — red tint when low power is slowing production
        const progress = qEntry.progress / qEntry.item.buildTime;
        ctx.fillStyle = lowPower ? 'rgba(255,80,80,0.35)' : 'rgba(80,255,80,0.4)';
        ctx.fillRect(x + 2, iy, (w - 4) * progress, itemH - 2);
        // Name + progress %
        ctx.fillStyle = lowPower ? '#f88' : '#8f8';
        ctx.fillText(`${item.name}`, textX, iy + 9);
        const queueText = qEntry.queueCount > 1 ? ` [x${qEntry.queueCount}]` : '';
        const slowText = lowPower ? ' SLOW' : '';
        ctx.fillStyle = '#ccc';
        ctx.fillText(`${Math.floor(progress * 100)}%${queueText}${slowText}`, textX, iy + 18);
      } else {
        // Name + cost
        const canAfford = this.sidebarCredits >= item.cost;
        ctx.fillStyle = canAfford ? '#ddd' : '#666';
        ctx.fillText(item.name, textX, iy + 9);
        ctx.fillStyle = canAfford ? '#FFD700' : '#553';
        ctx.fillText(`$${item.cost}`, textX, iy + 18);
      }
    }

    ctx.textAlign = 'left';
  }

  // ─── Placement Ghost ────────────────────────────────────

  private renderPlacementGhost(camera: Camera, assets: AssetManager): void {
    if (!this.placementItem) return;
    const ctx = this.ctx;
    const screen = camera.worldToScreen(
      this.placementCx * CELL_SIZE,
      this.placementCy * CELL_SIZE,
    );
    const [fw, fh] = STRUCTURE_SIZE[this.placementItem.type] ?? [2, 2];

    // Per-cell passability coloring
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        const idx = dy * fw + dx;
        const cellPassable = (this.placementCells && idx < this.placementCells.length)
          ? this.placementCells[idx] : this.placementValid;
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = cellPassable ? 'rgba(80,255,80,0.5)' : 'rgba(255,80,80,0.5)';
        ctx.fillRect(screen.x + dx * CELL_SIZE, screen.y + dy * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = cellPassable ? 'rgba(80,255,80,0.3)' : 'rgba(255,80,80,0.3)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(screen.x + dx * CELL_SIZE, screen.y + dy * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
    }

    ctx.globalAlpha = 1;
    ctx.strokeStyle = this.placementValid ? '#8f8' : '#f88';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(screen.x, screen.y, fw * CELL_SIZE, fh * CELL_SIZE);

    // Draw building sprite preview at 50% opacity
    const buildingSheet = assets.getSheet(this.placementItem.type.toLowerCase());
    if (buildingSheet) {
      ctx.globalAlpha = 0.5;
      assets.drawFrame(ctx, this.placementItem.type.toLowerCase(), 0,
        screen.x + fw * CELL_SIZE / 2,
        screen.y + fh * CELL_SIZE / 2,
        { centerX: true, centerY: true });
      ctx.globalAlpha = 1;
    }

    // Label
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(this.placementItem.name, screen.x + fw * CELL_SIZE / 2, screen.y - 3);
    // Cost label
    ctx.fillStyle = this.placementValid ? '#8f8' : '#f88';
    ctx.fillText(this.placementValid ? 'Click to place' : 'Cannot place here', screen.x + fw * CELL_SIZE / 2, screen.y + fh * CELL_SIZE + 10);
    ctx.textAlign = 'left';
  }

  // ─── End Screen ─────────────────────────────────────────

  renderEndScreen(
    won: boolean,
    killCount: number,
    lossCount: number,
    tick: number,
    structsBuilt = 0,
    structsLost = 0,
    creditsRemaining = 0,
    survivors: Array<{ type: string; name: string; hp: number; maxHp: number; vet: number }> = [],
  ): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Initialize score animation timer on first render
    if (this.scoreAnimStartTime === 0) {
      this.scoreAnimStartTime = Date.now();
      this.scoreAnimActive = true;
    }
    const scoreAnimTick = (Date.now() - this.scoreAnimStartTime) / 1000;
    const animProgress = Math.min(1, scoreAnimTick / 1.5); // 1.5s to count up
    const animateValue = (val: number) => Math.floor(val * animProgress);

    // Semi-transparent overlay
    ctx.fillStyle = won ? 'rgba(0,40,0,0.75)' : 'rgba(60,0,0,0.75)';
    ctx.fillRect(0, 0, w, h);

    // Score panel border
    const panelW = 280;
    const survivorRows = won && survivors.length > 0 ? Math.ceil(new Set(survivors.map(s => s.type)).size / 3) + 2 : 0;
    const panelH = 260 + survivorRows * 12;
    const px = (w - panelW) / 2;
    const py = (h - panelH) / 2 - 20;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(px, py, panelW, panelH);
    ctx.strokeStyle = won ? '#4a4' : '#a44';
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, panelW, panelH);

    // Title
    ctx.textAlign = 'center';
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = won ? this.palColor(PAL_GREEN_HP) : this.palColor(PAL_RED_HP);
    ctx.fillText(won ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED', w / 2, py + 24);

    // Divider
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 10, py + 34);
    ctx.lineTo(px + panelW - 10, py + 34);
    ctx.stroke();

    // Stats — RA-style table layout with animated counters
    ctx.font = '11px monospace';
    const leftX = px + 16;
    const rightX = px + panelW - 16;
    let row = py + 54;
    const rowH = 20;

    const drawRow = (label: string, value: string, color = '#ccc') => {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#999';
      ctx.fillText(label, leftX, row);
      ctx.textAlign = 'right';
      ctx.fillStyle = color;
      ctx.fillText(value, rightX, row);
      row += rowH;
    };

    const minutes = Math.floor(tick / (15 * 60));
    const seconds = Math.floor((tick / 15) % 60);
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    drawRow('Time', timeStr);
    drawRow('Enemies Killed', String(animateValue(killCount)), '#f84');
    drawRow('Units Lost', String(animateValue(lossCount)), lossCount > 0 ? '#f44' : '#8f8');
    drawRow('Structures Built', String(animateValue(structsBuilt)), '#8cf');
    drawRow('Structures Lost', String(animateValue(structsLost)), structsLost > 0 ? '#f44' : '#8f8');
    drawRow('Credits Remaining', `$${animateValue(creditsRemaining)}`, '#FFD700');

    // Score calculation (RA-style: kills * 50 - losses * 30 + time bonus)
    const timeBonus = Math.max(0, 1000 - Math.floor(tick / 15));
    const score = killCount * 50 - lossCount * 30 - structsLost * 100 + timeBonus;
    row += 4;
    ctx.beginPath();
    ctx.moveTo(px + 10, row - 14);
    ctx.lineTo(px + panelW - 10, row - 14);
    ctx.stroke();
    ctx.font = 'bold 13px monospace';
    drawRow('SCORE', String(Math.max(0, animateValue(score))), '#FFD700');

    // Letter grade based on score
    const finalScore = Math.max(0, score);
    const grade = finalScore >= 2000 ? 'S' : finalScore >= 1500 ? 'A' : finalScore >= 1000 ? 'B' : finalScore >= 500 ? 'C' : finalScore >= 200 ? 'D' : 'F';
    const gradeColor = grade === 'S' ? '#FFD700' : grade === 'A' ? '#C0C0C0' : grade === 'B' ? '#CD7F32' : '#888';
    if (animProgress >= 1) {
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = gradeColor;
      ctx.fillText(grade, w / 2, row + 4);
      row += 28;
    }

    // Bar graph: kills vs losses
    if (animProgress > 0.5) {
      const barProgress = Math.min(1, (animProgress - 0.5) * 2);
      const barW = 100;
      const barH = 8;
      const barX = (w - barW) / 2;
      const maxVal = Math.max(killCount, lossCount, 1);
      // Kills bar (green)
      ctx.fillStyle = '#111';
      ctx.fillRect(barX, row, barW, barH);
      ctx.fillStyle = '#4a4';
      ctx.fillRect(barX, row, barW * (killCount / maxVal) * barProgress, barH);
      ctx.font = '7px monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#8f8';
      ctx.fillText('K', barX - 10, row + 7);
      row += barH + 3;
      // Losses bar (red)
      ctx.fillStyle = '#111';
      ctx.fillRect(barX, row, barW, barH);
      ctx.fillStyle = '#a44';
      ctx.fillRect(barX, row, barW * (lossCount / maxVal) * barProgress, barH);
      ctx.fillStyle = '#f88';
      ctx.fillText('L', barX - 10, row + 7);
      row += barH + 6;
      ctx.textAlign = 'left';
    }

    // Survivors roster (victory only)
    if (won && survivors.length > 0) {
      row += 6;
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#8cf';
      ctx.fillText('SURVIVING FORCES', w / 2, row);
      row += 12;
      // Group by type
      const typeCounts = new Map<string, { count: number; name: string; vets: number }>();
      for (const s of survivors) {
        const entry = typeCounts.get(s.type) ?? { count: 0, name: s.name, vets: 0 };
        entry.count++;
        if (s.vet > 0) entry.vets++;
        typeCounts.set(s.type, entry);
      }
      ctx.font = '9px monospace';
      let col = 0;
      for (const [, info] of typeCounts) {
        const tx = px + 16 + col * 90;
        if (tx + 80 > px + panelW) break;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#aaa';
        const vetStr = info.vets > 0 ? ` (${info.vets}\u2605)` : '';
        ctx.fillText(`${info.count}x ${info.name}${vetStr}`, tx, row);
        col++;
        if (col >= 3) { col = 0; row += 11; }
      }
      if (col > 0) row += 11;
    }

    // Prompt
    ctx.font = '12px monospace';
    ctx.fillStyle = this.palColor(PAL_ROCK_START + 4);
    const promptY = Math.max(row + 20, h / 2 + 70);
    ctx.textAlign = 'center';
    ctx.fillText('Press any key to continue', w / 2, promptY);
    ctx.textAlign = 'left';
  }

  // ─── Off-screen Unit Indicators ─────────────────────────

  private renderOffscreenIndicators(
    camera: Camera, entities: Entity[], selectedIds: Set<number>,
  ): void {
    if (selectedIds.size === 0) return;
    const ctx = this.ctx;
    const margin = 16;
    // Accumulate counts per edge
    let top = 0, bot = 0, left = 0, right = 0;
    let topX = 0, botX = 0, leftY = 0, rightY = 0;
    for (const e of entities) {
      if (!e.alive || !selectedIds.has(e.id)) continue;
      const s = camera.worldToScreen(e.pos.x, e.pos.y);
      if (s.x >= 0 && s.x <= this.width && s.y >= 0 && s.y <= this.height) continue;
      if (s.y < 0) { top++; topX += Math.max(margin, Math.min(this.width - margin, s.x)); }
      else if (s.y > this.height) { bot++; botX += Math.max(margin, Math.min(this.width - margin, s.x)); }
      else if (s.x < 0) { left++; leftY += Math.max(margin, Math.min(this.height - margin, s.y)); }
      else if (s.x > this.width) { right++; rightY += Math.max(margin, Math.min(this.height - margin, s.y)); }
    }

    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    const drawBadge = (x: number, y: number, count: number, arrowDx: number, arrowDy: number) => {
      // Arrow triangle
      const s = 5;
      ctx.fillStyle = 'rgba(100,255,100,0.7)';
      ctx.beginPath();
      ctx.moveTo(x + arrowDx * s * 2, y + arrowDy * s * 2);
      ctx.lineTo(x + arrowDy * s, y - arrowDx * s);
      ctx.lineTo(x - arrowDy * s, y + arrowDx * s);
      ctx.closePath();
      ctx.fill();
      // Count badge
      const tx = x - arrowDx * 8;
      const ty = y - arrowDy * 8 + 3;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(tx - 8, ty - 8, 16, 11);
      ctx.fillStyle = '#8f8';
      ctx.fillText(String(count), tx, ty);
    };

    if (top > 0) drawBadge(topX / top, margin, top, 0, -1);
    if (bot > 0) drawBadge(botX / bot, this.height - margin, bot, 0, 1);
    if (left > 0) drawBadge(margin, leftY / left, left, -1, 0);
    if (right > 0) drawBadge(this.width - margin, rightY / right, right, 1, 0);
    ctx.textAlign = 'left';
  }

  // ─── Unit Info Panel ─────────────────────────────────────

  private renderUnitInfo(entities: Entity[], selectedIds: Set<number>): void {
    // Show structure info if a building is selected (no units selected)
    if (selectedIds.size === 0 && this.selectedStructure) {
      this.renderStructureInfo();
      return;
    }
    if (selectedIds.size === 0) return;
    const ctx = this.ctx;

    // Gather selected units
    const selected = entities.filter(e => selectedIds.has(e.id) && e.alive);
    if (selected.length === 0) return;

    const panelW = 160;
    const panelH = selected.length === 1
      ? (selected[0].type === UnitType.V_HARV ? 50 : 38)
      : 38;
    const px = 6;
    const py = this.height - panelH - 6;

    // Panel background — RA-style minimal dark panel
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(px, py, panelW, panelH);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, panelW, panelH);

    ctx.font = '10px monospace';

    if (selected.length === 1) {
      const unit = selected[0];
      // Unit name
      ctx.fillStyle = unit.isPlayerUnit ? this.palColor(PAL_GREEN_HP) : this.palColor(PAL_RED_HP);
      ctx.fillText(unit.stats.name, px + 8, py + 14);
      // Health bar
      this.renderHealthBar(px + panelW / 2, py + 22, panelW - 20, unit.hp / unit.maxHp, true);
      // Harvester: ore load bar + state
      if (unit.type === UnitType.V_HARV) {
        const oreRatio = unit.oreLoad / Entity.ORE_CAPACITY;
        const stateLabel = unit.harvesterState === 'harvesting' ? 'Harvesting'
          : unit.harvesterState === 'seeking' ? 'Seeking ore'
          : unit.harvesterState === 'returning' ? 'Returning'
          : unit.harvesterState === 'unloading' ? 'Unloading'
          : 'Idle';
        ctx.fillStyle = this.palColor(PAL_ROCK_START + 2);
        ctx.font = '9px monospace';
        ctx.fillText(`${stateLabel}  ${unit.oreLoad}/${Entity.ORE_CAPACITY}`, px + 8, py + 34);
        // Ore load bar
        const barX = px + 8;
        const barY = py + 38;
        const barW = panelW - 20;
        const barH = 3;
        ctx.fillStyle = '#111';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = oreRatio > 0.5 ? '#c8a030' : '#806020';
        ctx.fillRect(barX, barY, barW * oreRatio, barH);
      }
    } else {
      // Multiple selected — count + type breakdown
      const typeCounts = new Map<string, number>();
      for (const u of selected) {
        const name = u.stats.name;
        typeCounts.set(name, (typeCounts.get(name) ?? 0) + 1);
      }
      ctx.fillStyle = this.palColor(PAL_GREEN_HP);
      ctx.fillText(`${selected.length} units`, px + 8, py + 14);
      ctx.font = '9px monospace';
      ctx.fillStyle = this.palColor(PAL_ROCK_START + 2);
      let row = 0;
      for (const [name, count] of typeCounts) {
        if (row >= 2) { ctx.fillText('...', px + 8, py + 24); break; }
        ctx.fillText(`${count}x ${name}`, px + 8, py + 24 + row * 10);
        row++;
      }
    }
  }

  private renderStructureInfo(): void {
    const ss = this.selectedStructure;
    if (!ss) return;
    const ctx = this.ctx;
    const panelW = 160;
    const panelH = 48;
    const px = 6;
    const py = this.height - panelH - 6;

    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(px, py, panelW, panelH);
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, panelW, panelH);

    ctx.font = '10px monospace';
    ctx.fillStyle = '#FFD700';
    ctx.fillText(ss.name, px + 8, py + 15);
    ctx.fillStyle = this.palColor(PAL_ROCK_START + 2);
    ctx.fillText(`HP: ${ss.hp}/${ss.maxHp}`, px + 8, py + 28);
    this.renderHealthBar(px + panelW / 2, py + 36, panelW - 20, ss.hp / ss.maxHp, true);
  }
}
