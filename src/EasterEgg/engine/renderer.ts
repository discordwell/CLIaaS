/**
 * Canvas 2D renderer — draws the game world.
 * Renders terrain, units, selection boxes, health bars, and UI.
 */

import { CELL_SIZE, PLAYER_HOUSES } from './types';
import { type Camera } from './camera';
import { type AssetManager } from './assets';
import { type Entity } from './entity';
import { type GameMap, Terrain } from './map';
import { type InputState } from './input';

// Terrain colors (placeholder until proper terrain tiles are loaded)
const TERRAIN_COLORS: Record<Terrain, string> = {
  [Terrain.CLEAR]: '#3a5a2a',
  [Terrain.WATER]: '#1a3a5a',
  [Terrain.ROCK]: '#4a4a3a',
  [Terrain.TREE]: '#2a4a1a',
  [Terrain.WALL]: '#5a5a5a',
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.width = canvas.width;
    this.height = canvas.height;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Clear and render one frame */
  render(
    camera: Camera,
    map: GameMap,
    entities: Entity[],
    assets: AssetManager,
    input: InputState,
    selectedIds: Set<number>,
  ): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    this.renderTerrain(camera, map);
    this.renderEntities(camera, entities, assets, selectedIds);
    this.renderSelectionBox(input);
    this.renderMinimap(map, entities, camera);
  }

  private renderTerrain(camera: Camera, map: GameMap): void {
    const ctx = this.ctx;
    const startCX = Math.floor(camera.x / CELL_SIZE);
    const startCY = Math.floor(camera.y / CELL_SIZE);
    const endCX = Math.ceil((camera.x + this.width) / CELL_SIZE);
    const endCY = Math.ceil((camera.y + this.height) / CELL_SIZE);

    for (let cy = startCY; cy <= endCY; cy++) {
      for (let cx = startCX; cx <= endCX; cx++) {
        const terrain = map.getTerrain(cx, cy);
        const screen = camera.worldToScreen(cx * CELL_SIZE, cy * CELL_SIZE);

        ctx.fillStyle = TERRAIN_COLORS[terrain] ?? '#000';

        // Add subtle variation based on cell position
        if (terrain === Terrain.CLEAR) {
          const v = ((cx * 7 + cy * 13) % 5) * 3;
          const r = 0x3a + v;
          const g = 0x5a + v;
          const b = 0x2a - v;
          ctx.fillStyle = `rgb(${r},${g},${b})`;
        }

        ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
      }
    }
  }

  private renderEntities(
    camera: Camera,
    entities: Entity[],
    assets: AssetManager,
    selectedIds: Set<number>,
  ): void {
    const ctx = this.ctx;

    // Sort entities by Y position for proper overlap
    const sorted = entities.filter(e => e.alive || e.animFrame < 10);
    sorted.sort((a, b) => a.pos.y - b.pos.y);

    for (const entity of sorted) {
      const screen = camera.worldToScreen(entity.pos.x, entity.pos.y);

      // Check if visible
      const spriteW = entity.stats.isInfantry ? 50 : (entity.stats.image === '3tnk' || entity.stats.image === '4tnk' ? 48 : 24);
      const spriteH = entity.stats.isInfantry ? 39 : (entity.stats.image === '3tnk' || entity.stats.image === '4tnk' ? 48 : 24);

      if (!camera.isVisible(
        entity.pos.x - spriteW / 2,
        entity.pos.y - spriteH / 2,
        spriteW,
        spriteH
      )) continue;

      // Try to draw sprite from asset sheet
      const sheet = assets.getSheet(entity.stats.image);
      if (sheet) {
        const frame = entity.spriteFrame % sheet.meta.frameCount;
        assets.drawFrame(ctx, entity.stats.image, frame, screen.x, screen.y, {
          centerX: true,
          centerY: true,
        });
      } else {
        // Fallback: colored rectangle
        const size = entity.stats.isInfantry ? 8 : 16;
        const color = entity.isPlayerUnit ? '#4a8' : '#d44';
        ctx.fillStyle = color;
        ctx.fillRect(screen.x - size / 2, screen.y - size / 2, size, size);

        // Direction indicator
        const dx = [0, 1, 1, 1, 0, -1, -1, -1][entity.facing];
        const dy = [-1, -1, 0, 1, 1, 1, 0, -1][entity.facing];
        ctx.fillStyle = '#fff';
        ctx.fillRect(
          screen.x + dx * (size / 2) - 1,
          screen.y + dy * (size / 2) - 1,
          3, 3
        );
      }

      // Selection highlight
      if (selectedIds.has(entity.id)) {
        const halfW = spriteW / 2;
        const halfH = spriteH / 2;
        ctx.strokeStyle = '#0f0';
        ctx.lineWidth = 1;
        ctx.strokeRect(
          screen.x - halfW, screen.y - halfH,
          spriteW, spriteH
        );
      }

      // Health bar (only for alive, non-full-hp units)
      if (entity.alive && entity.hp < entity.maxHp) {
        this.renderHealthBar(screen.x, screen.y - spriteH / 2 - 4, spriteW, entity.hp / entity.maxHp);
      }
    }
  }

  private renderHealthBar(x: number, y: number, width: number, ratio: number): void {
    const ctx = this.ctx;
    const barW = Math.max(width, 16);
    const barH = 3;
    const bx = x - barW / 2;

    // Background
    ctx.fillStyle = '#000';
    ctx.fillRect(bx, y, barW, barH);

    // Health fill
    const color = ratio > 0.5 ? '#0c0' : ratio > 0.25 ? '#cc0' : '#c00';
    ctx.fillStyle = color;
    ctx.fillRect(bx, y, barW * ratio, barH);
  }

  private renderSelectionBox(input: InputState): void {
    if (!input.isDragging) return;
    const ctx = this.ctx;
    const x1 = Math.min(input.dragStartX, input.mouseX);
    const y1 = Math.min(input.dragStartY, input.mouseY);
    const x2 = Math.max(input.dragStartX, input.mouseX);
    const y2 = Math.max(input.dragStartY, input.mouseY);

    ctx.strokeStyle = '#0f0';
    ctx.lineWidth = 1;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }

  private renderMinimap(map: GameMap, entities: Entity[], camera: Camera): void {
    const ctx = this.ctx;
    const mmSize = 80; // minimap size in pixels
    const mmX = this.width - mmSize - 4;
    const mmY = 4;
    const scale = mmSize / (Math.max(map.boundsW, map.boundsH));

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(mmX - 1, mmY - 1, mmSize + 2, mmSize + 2);

    // Terrain (simplified)
    const ox = map.boundsX;
    const oy = map.boundsY;
    for (let cy = map.boundsY; cy < map.boundsY + map.boundsH; cy += 2) {
      for (let cx = map.boundsX; cx < map.boundsX + map.boundsW; cx += 2) {
        const terrain = map.getTerrain(cx, cy);
        if (terrain !== Terrain.CLEAR) {
          ctx.fillStyle = terrain === Terrain.WATER ? '#134' : '#333';
          ctx.fillRect(
            mmX + (cx - ox) * scale,
            mmY + (cy - oy) * scale,
            Math.max(scale * 2, 1),
            Math.max(scale * 2, 1)
          );
        }
      }
    }

    // Units as dots
    for (const e of entities) {
      if (!e.alive) continue;
      const ecx = Math.floor(e.pos.x / CELL_SIZE);
      const ecy = Math.floor(e.pos.y / CELL_SIZE);
      ctx.fillStyle = e.isPlayerUnit ? '#0f0' : '#f00';
      ctx.fillRect(
        mmX + (ecx - ox) * scale,
        mmY + (ecy - oy) * scale,
        2, 2
      );
    }

    // Camera viewport rectangle
    const vx = mmX + (camera.x / CELL_SIZE - ox) * scale;
    const vy = mmY + (camera.y / CELL_SIZE - oy) * scale;
    const vw = (camera.viewWidth / CELL_SIZE) * scale;
    const vh = (camera.viewHeight / CELL_SIZE) * scale;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(vx, vy, vw, vh);
  }
}
