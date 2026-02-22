/**
 * Canvas 2D renderer — full visual fidelity.
 * Terrain, fog of war, units with death/damage effects,
 * explosions, health bars, selection circles, minimap, UI.
 */

import { CELL_SIZE, GAME_TICKS_PER_SEC, House, Stance, SUB_CELL_OFFSETS, UnitType, type ProductionItem } from './types';
import { type Camera } from './camera';
import { type AssetManager } from './assets';
import { type Entity } from './entity';
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
  type: 'explosion' | 'muzzle' | 'blood' | 'tesla' | 'projectile' | 'marker' | 'debris';
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
  projStyle?: 'bullet' | 'fireball' | 'shell' | 'rocket';
  // Marker color (for move/attack command feedback)
  markerColor?: string;
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
  repairingStructures = new Set<number>(); // indices of structures being repaired
  corpses: Array<{ x: number; y: number; type: UnitType; facing: number; isInfantry: boolean; alpha: number }> = [];
  showHelp = false;     // F1 help overlay
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
  missionTimer = 0; // 0 = hidden
  missionName = ''; // mission title shown as overlay at start
  theatre = 'TEMPERATE'; // map theatre (affects terrain colors)
  // Placement ghost
  placementItem: ProductionItem | null = null;
  placementCx = 0;
  placementCy = 0;
  placementValid = false;

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

    // Cache palette reference from assets
    if (!this.pal) this.pal = assets.getPalette();

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
    this.renderOverlays(camera, map, tick);
    this.renderStructures(camera, map, structures, assets, tick);
    this.renderCrates(camera, map, tick);
    this.renderCorpses(camera, map);
    this.renderEntities(camera, map, entities, assets, selectedIds, tick);
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
      this.renderPlacementGhost(camera);
    }

    this.renderSelectionBox(input);
    if (this.attackMoveMode) this.renderAttackMoveIndicator(input);
    if (this.sellMode) this.renderModeLabel(input, 'SELL', 'rgba(255,200,60,0.9)');
    if (this.repairMode) this.renderModeLabel(input, 'REPAIR', 'rgba(80,255,80,0.9)');
    this.renderMinimap(map, entities, structures, camera);
    this.renderOffscreenIndicators(camera, entities, selectedIds);
    this.renderSidebar();
    this.renderUnitInfo(entities, selectedIds);
    if (this.idleCount > 0) this.renderIdleCount();
    if (this.showHelp) this.renderHelpOverlay();
  }

  // ─── Terrain ─────────────────────────────────────────────

  private renderTerrain(camera: Camera, map: GameMap, tick: number): void {
    const ctx = this.ctx;
    const startCX = Math.floor(camera.x / CELL_SIZE);
    const startCY = Math.floor(camera.y / CELL_SIZE);
    const endCX = Math.ceil((camera.x + camera.viewWidth) / CELL_SIZE);
    const endCY = Math.ceil((camera.y + camera.viewHeight) / CELL_SIZE);

    for (let cy = startCY; cy <= endCY; cy++) {
      for (let cx = startCX; cx <= endCX; cx++) {
        const terrain = map.getTerrain(cx, cy);
        const screen = camera.worldToScreen(cx * CELL_SIZE, cy * CELL_SIZE);
        const h = cellHash(cx, cy);

        // Use MapPack template data for richer variation when available
        const idx = cy * 128 + cx;
        const tmpl = map.templateType[idx] || 0;
        const icon = map.templateIcon[idx] || 0;

        switch (terrain) {
          case Terrain.CLEAR: {
            if (this.theatre === 'INTERIOR') {
              // INTERIOR theatre — concrete/stone floors
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
            } else if (tmpl > 0 && tmpl !== 0xFF) {
              // Template-aware rendering using palette colors
              const isRoad = tmpl >= 0x27 && tmpl <= 0x34;
              const isRough = tmpl >= 0x0D && tmpl <= 0x12;
              const isShoreDirt = tmpl >= 0x06 && tmpl <= 0x0C;

              if (isRoad) {
                // Road tiles — palette dirt/sand colors (indices 84-90)
                const palIdx = PAL_DIRT_START + 4 + ((icon * 7 + h) % 6);
                ctx.fillStyle = this.palColor(palIdx);
                ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
                // Road line detail using slightly lighter dirt
                ctx.fillStyle = this.palColor(PAL_DIRT_START + 2, 10);
                ctx.fillRect(screen.x + 2, screen.y + 11, 20, 2);
              } else if (isRough) {
                // Rough terrain — darker palette dirt (indices 88-94)
                const palIdx = PAL_DIRT_START + 8 + (h % 6);
                ctx.fillStyle = this.palColor(palIdx);
                ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
                // Rock scatter using darker dirt
                ctx.fillStyle = this.palColor(PAL_DIRT_START + 12, -8);
                ctx.fillRect(screen.x + (h % 14) + 2, screen.y + ((h >> 3) % 12) + 3, 5, 4);
                ctx.fillRect(screen.x + ((h >> 5) % 10) + 6, screen.y + ((h >> 2) % 14) + 1, 3, 3);
              } else if (isShoreDirt) {
                // Shore/dirt transition — palette sand/brown (indices 82-88)
                const palIdx = PAL_DIRT_START + 2 + (h % 6);
                ctx.fillStyle = this.palColor(palIdx);
                ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
              } else {
                // Other templates — grass with palette variation
                const palIdx = PAL_GRASS_START + 3 + ((tmpl * 13 + icon * 7 + h) % 6);
                const bri = ((h % 12) - 6);
                ctx.fillStyle = this.palColor(palIdx, bri);
                ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
                // Subtle dirt patch detail from template
                if ((h + icon) % 5 === 0) {
                  ctx.fillStyle = this.palColor(PAL_DIRT_START + 6, -20);
                  ctx.globalAlpha = 0.2;
                  ctx.fillRect(screen.x + 3, screen.y + 3, CELL_SIZE - 6, CELL_SIZE - 6);
                  ctx.globalAlpha = 1;
                }
              }
            } else {
              // Default clear — palette green (TEMPERATE) or concrete (INTERIOR)
              if (this.theatre === 'INTERIOR') {
                const bright = 60 + (h % 8) - 4;
                ctx.fillStyle = `rgb(${bright},${bright - 2},${bright - 5})`;
              } else {
                const palIdx = PAL_GRASS_START + 2 + (h % 6);
                ctx.fillStyle = this.palColor(palIdx, (h % 10) - 5);
              }
              ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
              if (h < 15) {
                ctx.fillStyle = this.palColor(PAL_DIRT_START + 8);
                ctx.globalAlpha = 0.25;
                ctx.fillRect(screen.x + 4, screen.y + 4, CELL_SIZE - 8, CELL_SIZE - 8);
                ctx.globalAlpha = 1;
              }
            }
            // Grass tuft detail — darker green from palette
            if (h > 200) {
              ctx.fillStyle = this.palColor(PAL_GRASS_START + 8);
              ctx.globalAlpha = 0.6;
              const gx = screen.x + (h % 16) + 4;
              const gy = screen.y + ((h >> 4) % 16) + 4;
              ctx.fillRect(gx, gy, 2, 3);
              ctx.globalAlpha = 1;
            }
            break;
          }
          case Terrain.WATER: {
            // Animated water using palette indices 96-102 (7-frame ping-pong cycle)
            const phase = (tick + h) % (PAL_WATER_COUNT * 2 - 2);
            const waterIdx = phase < PAL_WATER_COUNT ? phase : (PAL_WATER_COUNT * 2 - 2 - phase);
            ctx.fillStyle = this.palColor(PAL_WATER_START + waterIdx);
            ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
            // Wave highlight using lighter water color
            if ((h + tick) % 30 < 8) {
              ctx.fillStyle = this.palColor(PAL_WATER_START, 0);
              ctx.globalAlpha = 0.15;
              ctx.fillRect(screen.x + 3, screen.y + 8, 18, 2);
              ctx.globalAlpha = 1;
            }
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
              // Ground under tree — dark grass from palette
              ctx.fillStyle = this.palColor(PAL_GRASS_START + 9, (h % 8) - 4);
              ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
              // Tree trunk — palette brown (dirt index ~88)
              ctx.fillStyle = this.palColor(PAL_DIRT_START + 8);
              ctx.fillRect(screen.x + 10, screen.y + 14, 4, 10);
              // Tree canopy — palette greens (dark→medium)
              ctx.fillStyle = this.palColor(PAL_GRASS_START + 10);
              ctx.beginPath();
              ctx.arc(screen.x + 12, screen.y + 10, 8, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = this.palColor(PAL_GRASS_START + 8);
              ctx.beginPath();
              ctx.arc(screen.x + 10, screen.y + 8, 6, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = this.palColor(PAL_GRASS_START + 6);
              ctx.beginPath();
              ctx.arc(screen.x + 13, screen.y + 7, 4, 0, Math.PI * 2);
              ctx.fill();
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

  private renderOverlays(camera: Camera, map: GameMap, tick: number): void {
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
          // Gold ore (GOLD01-GOLD12) — palette gold/yellow tones
          const density = ovl - 0x03; // 0-11
          ctx.fillStyle = this.palColor(PAL_DIRT_START + 2 + (density % 4), 20);
          ctx.fillRect(screen.x + 2, screen.y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
          // Ore scatter dots
          const dots = 2 + Math.floor(density / 3);
          ctx.fillStyle = this.palColor(PAL_DIRT_START, 40);
          for (let d = 0; d < dots; d++) {
            const dx = ((h + d * 37) % 16) + 3;
            const dy = (((h >> 3) + d * 53) % 16) + 3;
            ctx.fillRect(screen.x + dx, screen.y + dy, 3, 2);
          }
          // Animated sparkle — one glint cycles per cell at staggered intervals
          const sparklePhase = (tick + h * 3) % 40;
          if (sparklePhase < 6) {
            const sparkAlpha = sparklePhase < 3 ? sparklePhase / 3 : (6 - sparklePhase) / 3;
            const sx = screen.x + 4 + ((h * 7) % 14);
            const sy = screen.y + 4 + ((h * 11) % 14);
            ctx.fillStyle = `rgba(255,255,200,${sparkAlpha * 0.8})`;
            ctx.fillRect(sx, sy, 2, 2);
            ctx.fillRect(sx - 1, sy + 1, 4, 1); // horizontal glint arm
            ctx.fillRect(sx + 1, sy - 1, 1, 4); // vertical glint arm
          }
        } else if (ovl >= 0x0F && ovl <= 0x12) {
          // Gems (GEM01-GEM04) — blue/teal crystalline tones (like original RA)
          const gemDensity = ovl - 0x0F; // 0-3
          const gemBase = 0.25 + gemDensity * 0.08;
          ctx.fillStyle = `rgba(40,120,200,${gemBase})`;
          ctx.fillRect(screen.x + 2, screen.y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
          // Gem facets — brighter crystals at higher density
          const facetAlpha = 0.4 + gemDensity * 0.15;
          ctx.fillStyle = `rgba(100,200,255,${facetAlpha})`;
          ctx.fillRect(screen.x + 5 + (h % 6), screen.y + 5, 4, 4);
          ctx.fillRect(screen.x + 12 + (h % 4), screen.y + 12, 3, 3);
          if (gemDensity >= 2) {
            ctx.fillRect(screen.x + 8 + (h % 3), screen.y + 10, 3, 3);
          }
          // Animated gem sparkle — brighter and more frequent than ore
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
        if (totalFrames > 2) {
          const halfFrames = Math.floor(totalFrames / 2);
          const baseFrame = damaged ? halfFrames : 0;
          // Animate idle loop (every 8 ticks = ~0.5s per frame)
          const animFrames = damaged ? totalFrames - halfFrames : halfFrames;
          frame = baseFrame + (Math.floor(tick / 8) % Math.max(1, animFrames));
        } else if (totalFrames === 2) {
          frame = damaged ? 1 : 0;
        }
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

      // Health bar on damaged structures (visible only)
      if (vis === 2 && s.hp < s.maxHp) {
        const barX = screenX + CELL_SIZE;
        const barY = screenY - 2;
        this.renderHealthBar(barX, barY, CELL_SIZE * 1.5, s.hp / s.maxHp, false);
      }

      // Fire/smoke animation on damaged structures (< 50% HP)
      if (s.alive && s.hp < s.maxHp * 0.5 && vis >= 1 && !isConstructing && !isSelling) {
        const fireSeed = (s.cx * 31 + s.cy * 17) | 0;
        for (let f = 0; f < 2; f++) {
          const fx = screenX + CELL_SIZE * 0.5 + ((fireSeed + f * 13) % 12) - 6;
          const fy = screenY + CELL_SIZE * 0.3;
          // Flame: animated orange/red flicker
          const flicker = Math.sin(tick * 0.5 + f * 2.1) * 0.3;
          const fh = 6 + Math.sin(tick * 0.7 + f * 1.5) * 3;
          ctx.fillStyle = `rgba(255,${120 + flicker * 60},30,${0.5 + flicker * 0.2})`;
          ctx.beginPath();
          ctx.ellipse(fx, fy - fh * 0.5, 3, fh * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
          // Smoke rising above flame
          const smokeY = fy - fh - 2 - (tick * 0.4 + f * 3) % 8;
          const smokeAlpha = 0.3 - ((tick * 0.4 + f * 3) % 8) / 20;
          if (smokeAlpha > 0) {
            ctx.fillStyle = `rgba(40,40,40,${smokeAlpha})`;
            ctx.beginPath();
            ctx.arc(fx + Math.sin(tick * 0.2 + f) * 2, smokeY, 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
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
    }
  }

  // ─── Corpses ─────────────────────────────────────────────

  private renderCorpses(camera: Camera, map: GameMap): void {
    const ctx = this.ctx;
    for (const c of this.corpses) {
      const ecx = Math.floor(c.x / CELL_SIZE);
      const ecy = Math.floor(c.y / CELL_SIZE);
      if (map.getVisibility(ecx, ecy) === 0) continue; // shrouded
      const screen = camera.worldToScreen(c.x, c.y);
      if (screen.x < -20 || screen.x > this.width + 20 || screen.y < -20 || screen.y > this.height + 20) continue;
      ctx.globalAlpha = c.alpha;
      if (c.isInfantry) {
        // Infantry corpse: small dark blob
        ctx.fillStyle = '#2a1a0a';
        ctx.fillRect(screen.x - 3, screen.y - 1, 6, 3);
        ctx.fillStyle = '#4a2a1a';
        ctx.fillRect(screen.x - 2, screen.y - 1, 4, 2);
      } else {
        // Vehicle wreckage: dark twisted metal shapes
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(screen.x - 6, screen.y - 4, 12, 8);
        ctx.fillStyle = '#3a2a2a';
        ctx.fillRect(screen.x - 4, screen.y - 3, 8, 6);
        // Burn mark around wreck
        ctx.fillStyle = 'rgba(20,15,10,0.3)';
        ctx.beginPath();
        ctx.ellipse(screen.x, screen.y + 2, 8, 5, 0, 0, Math.PI * 2);
        ctx.fill();
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

  // ─── Effects ─────────────────────────────────────────────

  private renderEffects(camera: Camera, effects: Effect[], assets: AssetManager): void {
    const ctx = this.ctx;

    for (const fx of effects) {
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
        // Arc for shells/rockets
        const arcY = fx.projStyle === 'shell' || fx.projStyle === 'rocket'
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
            // Smoke trail
            ctx.fillStyle = 'rgba(180,180,180,0.4)';
            const trailT = Math.max(0, t - 0.1);
            const tx = fx.startX + (fx.endX - fx.startX) * trailT;
            const ty = fx.startY + (fx.endY - fx.startY) * trailT - Math.sin(trailT * Math.PI) * 30;
            const trailScreen = camera.worldToScreen(tx, ty);
            ctx.fillRect(trailScreen.x - 1, trailScreen.y - 1, 2, 2);
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
          const alpha = 1 - progress;
          ctx.strokeStyle = `rgba(100,200,255,${alpha})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          const seed = (fx.x * 11 + fx.y * 17 + fx.frame * 31) | 0;
          const segments = 6;
          ctx.moveTo(screen.x - fx.size, screen.y);
          for (let i = 1; i <= segments; i++) {
            const t = i / segments;
            const jx = ((seed + i * 47) % 11 - 5) * (1 - t);
            const jy = ((seed + i * 89) % 11 - 5) * (1 - t);
            ctx.lineTo(
              screen.x - fx.size + t * fx.size * 2 + jx,
              screen.y + jy,
            );
          }
          ctx.stroke();
          ctx.strokeStyle = `rgba(150,220,255,${alpha * 0.3})`;
          ctx.lineWidth = 4;
          ctx.stroke();
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
      }
    }
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

    // Structure dots
    for (const s of structures) {
      if (!s.alive) continue;
      const vis = map.getVisibility(s.cx, s.cy);
      if (vis === 0) continue;
      const isPlayer = s.house === 'Spain' || s.house === 'Greece';
      ctx.fillStyle = isPlayer ? '#fff' : this.palColor(PAL_RED_HP);
      const sSize = Math.max(scale * 2, 3);
      ctx.fillRect(mmX + (s.cx - ox) * scale, mmY + (s.cy - oy) * scale, sSize, sSize);
    }

    // Unit dots
    for (const e of entities) {
      if (!e.alive) continue;
      const ecx = Math.floor(e.pos.x / CELL_SIZE);
      const ecy = Math.floor(e.pos.y / CELL_SIZE);
      const vis = map.getVisibility(ecx, ecy);
      if (vis === 0) continue;
      if (vis === 1 && !e.isPlayerUnit) continue;

      ctx.fillStyle = e.isPlayerUnit ? this.palColor(PAL_GREEN_HP) : this.palColor(PAL_RED_HP);
      ctx.fillRect(
        mmX + (ecx - ox) * scale,
        mmY + (ecy - oy) * scale,
        Math.max(scale, 2), Math.max(scale, 2),
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
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = color;
    ctx.fillText(label, input.mouseX + 12, input.mouseY - 4);
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
    const w = 240;
    const lines = [
      'KEYBOARD SHORTCUTS',
      '',
      'S / G     Stop / Guard',
      'A         Attack-move',
      'Z         Cycle stance',
      'X         Scatter units',
      'Q         Sell building',
      'R         Repair building',
      'Ctrl+RMB  Force-fire ground',
      'Shift+RMB Queue waypoint',
      'Home/Space Center on units',
      '1-9       Select group',
      'Ctrl+1-9  Assign group',
      '.         Cycle idle units',
      'Tab       Cycle unit types',
      'E         Select all same type',
      'D         Deploy MCV',
      'Esc       Cancel mode',
      'P         Pause',
      'F1        Toggle this help',
    ];
    const lineH = 13;
    const h = lines.length * lineH + 16;
    const px = (this.width - w) / 2;
    const py = (this.height - h) / 2;

    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(px, py, w, h);
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, w, h);

    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      ctx.fillStyle = i === 0 ? '#fff' : '#ccc';
      if (i === 0) ctx.font = 'bold 10px monospace';
      else ctx.font = '10px monospace';
      ctx.fillText(line, px + 10, py + 14 + i * lineH);
    }
  }

  // ─── Sidebar ──────────────────────────────────────────────

  private renderSidebar(): void {
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

    // Power bar with numeric labels
    const pwrY = 18;
    const pwrW = w - 8;
    const pwrH = 8;
    const pwrX = x + 4;
    ctx.fillStyle = '#111';
    ctx.fillRect(pwrX, pwrY, pwrW, pwrH);
    const pwrRatio = this.sidebarPowerProduced > 0
      ? Math.min(1, this.sidebarPowerConsumed / this.sidebarPowerProduced) : 1;
    const lowPower = this.sidebarPowerConsumed > this.sidebarPowerProduced;
    const pwrColor = lowPower ? '#f44' : pwrRatio > 0.8 ? '#fa0' : '#4f4';
    ctx.fillStyle = pwrColor;
    ctx.fillRect(pwrX, pwrY, pwrW * Math.min(1, pwrRatio), pwrH);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.strokeRect(pwrX, pwrY, pwrW, pwrH);
    // Power numeric label (only show if player has power structures)
    if (this.sidebarPowerProduced > 0 || this.sidebarPowerConsumed > 0) {
      ctx.font = '7px monospace';
      ctx.fillStyle = lowPower ? '#f88' : '#888';
      ctx.textAlign = 'center';
      ctx.fillText(`${this.sidebarPowerConsumed}/${this.sidebarPowerProduced}`, x + w / 2, pwrY + pwrH + 8);
    }

    // Production items
    const itemH = 22;
    const itemStartY = (this.sidebarPowerProduced > 0 || this.sidebarPowerConsumed > 0) ? 36 : 28;
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';

    for (let i = 0; i < this.sidebarItems.length; i++) {
      const item = this.sidebarItems[i];
      const iy = itemStartY + i * itemH - this.sidebarScroll;
      if (iy < itemStartY - itemH || iy > this.height) continue;

      // Category color coding
      const category = item.isStructure ? 'structure' : item.prerequisite === 'TENT' ? 'infantry' : 'vehicle';
      const catColor = category === 'infantry' ? 'rgba(80,200,80,0.15)'
        : category === 'vehicle' ? 'rgba(80,80,200,0.15)' : 'rgba(200,200,80,0.15)';

      // Item background
      ctx.fillStyle = catColor;
      ctx.fillRect(x + 2, iy, w - 4, itemH - 2);
      ctx.strokeStyle = 'rgba(100,100,100,0.3)';
      ctx.strokeRect(x + 2, iy, w - 4, itemH - 2);

      // Check if this category is building
      const qEntry = this.sidebarQueue.get(category);
      const isBuilding = qEntry && qEntry.item.type === item.type;

      if (isBuilding && qEntry) {
        // Progress bar
        const progress = qEntry.progress / qEntry.item.buildTime;
        ctx.fillStyle = 'rgba(80,255,80,0.4)';
        ctx.fillRect(x + 2, iy, (w - 4) * progress, itemH - 2);
        // Name + progress %
        ctx.fillStyle = '#8f8';
        ctx.fillText(`${item.name}`, x + 4, iy + 9);
        const queueText = qEntry.queueCount > 1 ? ` [x${qEntry.queueCount}]` : '';
        ctx.fillStyle = '#ccc';
        ctx.fillText(`${Math.floor(progress * 100)}%${queueText}`, x + 4, iy + 18);
      } else {
        // Name + cost
        const canAfford = this.sidebarCredits >= item.cost;
        ctx.fillStyle = canAfford ? '#ddd' : '#666';
        ctx.fillText(item.name, x + 4, iy + 9);
        ctx.fillStyle = canAfford ? '#FFD700' : '#553';
        ctx.fillText(`$${item.cost}`, x + 4, iy + 18);
      }
    }

    ctx.textAlign = 'left';
  }

  // ─── Placement Ghost ────────────────────────────────────

  private renderPlacementGhost(camera: Camera): void {
    if (!this.placementItem) return;
    const ctx = this.ctx;
    const screen = camera.worldToScreen(
      this.placementCx * CELL_SIZE,
      this.placementCy * CELL_SIZE,
    );
    const [fw, fh] = STRUCTURE_SIZE[this.placementItem.type] ?? [2, 2];

    ctx.globalAlpha = 0.5;
    ctx.fillStyle = this.placementValid ? 'rgba(80,255,80,0.5)' : 'rgba(255,80,80,0.5)';
    ctx.fillRect(screen.x, screen.y, fw * CELL_SIZE, fh * CELL_SIZE);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = this.placementValid ? '#8f8' : '#f88';
    ctx.lineWidth = 1;
    ctx.strokeRect(screen.x, screen.y, fw * CELL_SIZE, fh * CELL_SIZE);
    // Label
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(this.placementItem.name, screen.x + fw * CELL_SIZE / 2, screen.y - 3);
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
  ): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Semi-transparent overlay
    ctx.fillStyle = won ? 'rgba(0,40,0,0.75)' : 'rgba(60,0,0,0.75)';
    ctx.fillRect(0, 0, w, h);

    // Score panel border
    const panelW = 280;
    const panelH = 220;
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

    // Stats — RA-style table layout
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
    drawRow('Enemies Killed', String(killCount), '#f84');
    drawRow('Units Lost', String(lossCount), lossCount > 0 ? '#f44' : '#8f8');
    drawRow('Structures Built', String(structsBuilt), '#8cf');
    drawRow('Structures Lost', String(structsLost), structsLost > 0 ? '#f44' : '#8f8');
    drawRow('Credits Remaining', `$${creditsRemaining}`, '#FFD700');

    // Score calculation (RA-style: kills * 50 - losses * 30 + time bonus)
    const timeBonus = Math.max(0, 1000 - Math.floor(tick / 15));
    const score = killCount * 50 - lossCount * 30 - structsLost * 100 + timeBonus;
    row += 4;
    ctx.beginPath();
    ctx.moveTo(px + 10, row - 14);
    ctx.lineTo(px + panelW - 10, row - 14);
    ctx.stroke();
    ctx.font = 'bold 13px monospace';
    drawRow('SCORE', String(Math.max(0, score)), '#FFD700');

    // Prompt
    ctx.font = '12px monospace';
    ctx.fillStyle = this.palColor(PAL_ROCK_START + 4);
    ctx.fillText('Press any key to continue', w / 2, h / 2 + 70);
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
    if (selectedIds.size === 0) return;
    const ctx = this.ctx;

    // Gather selected units
    const selected = entities.filter(e => selectedIds.has(e.id) && e.alive);
    if (selected.length === 0) return;

    const panelW = 180;
    const panelH = selected.length === 1 ? 74 : 30;
    const px = 6;
    const py = this.height - panelH - 6;

    // Panel background
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(px, py, panelW, panelH);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, panelW, panelH);

    ctx.font = '10px monospace';

    if (selected.length === 1) {
      const unit = selected[0];
      // Unit name — palette green/red
      ctx.fillStyle = unit.isPlayerUnit ? this.palColor(PAL_GREEN_HP) : this.palColor(PAL_RED_HP);
      ctx.fillText(unit.stats.name, px + 8, py + 15);
      // HP — palette light gray
      ctx.fillStyle = this.palColor(PAL_ROCK_START + 2);
      ctx.fillText(`HP: ${unit.hp}/${unit.maxHp}`, px + 8, py + 28);
      // Weapon, armor, range
      const wpn = unit.weapon;
      const armorStr = unit.stats.armor === 'none' ? 'None' : unit.stats.armor === 'light' ? 'Light' : 'Heavy';
      if (wpn) {
        ctx.fillText(`${wpn.name}  Rng:${wpn.range}  Arm:${armorStr}`, px + 8, py + 41);
      } else {
        ctx.fillText(`Unarmed  Arm:${armorStr}`, px + 8, py + 41);
      }
      // Veterancy + kills + stance
      const vetStr = unit.veterancy >= 2 ? 'Elite' : unit.veterancy >= 1 ? 'Veteran' : 'Rookie';
      const stanceStr = unit.stance === Stance.HOLD_FIRE ? 'Hold' : unit.stance === Stance.DEFENSIVE ? 'Def' : 'Agg';
      ctx.fillStyle = unit.veterancy >= 2 ? '#FFD700' : unit.veterancy >= 1 ? '#C0C0C0' : this.palColor(PAL_ROCK_START + 2);
      ctx.fillText(`${vetStr}  K:${unit.kills}  [${stanceStr}]`, px + 8, py + 54);
      // Health bar
      this.renderHealthBar(px + panelW / 2, py + 62, panelW - 20, unit.hp / unit.maxHp, true);
    } else {
      // Multiple selected — palette green
      ctx.fillStyle = this.palColor(PAL_GREEN_HP);
      ctx.fillText(`${selected.length} units selected`, px + 8, py + 18);
    }
  }
}
