/**
 * Canvas 2D renderer — full visual fidelity.
 * Terrain, fog of war, units with death/damage effects,
 * explosions, health bars, selection circles, minimap, UI.
 */

import { CELL_SIZE } from './types';
import { type Camera } from './camera';
import { type AssetManager } from './assets';
import { type Entity } from './entity';
import { type GameMap, Terrain } from './map';
import { type InputState } from './input';

export interface Effect {
  type: 'explosion' | 'muzzle' | 'blood' | 'tesla';
  x: number;
  y: number;
  frame: number;
  maxFrames: number;
  size: number;
  // Sprite-based effect rendering
  sprite?: string;       // sprite sheet name (e.g. 'fball1', 'piff')
  spriteStart?: number;  // first frame index in the sheet
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

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.width = canvas.width;
    this.height = canvas.height;
    this.ctx.imageSmoothingEnabled = false;
  }

  render(
    camera: Camera,
    map: GameMap,
    entities: Entity[],
    assets: AssetManager,
    input: InputState,
    selectedIds: Set<number>,
    effects: Effect[],
    tick: number,
  ): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    this.renderTerrain(camera, map, tick);
    this.renderEntities(camera, map, entities, assets, selectedIds, tick);
    this.renderEffects(camera, effects, assets);
    this.renderFogOfWar(camera, map);
    this.renderSelectionBox(input);
    this.renderMinimap(map, entities, camera);
    this.renderUnitInfo(entities, selectedIds);
  }

  // ─── Terrain ─────────────────────────────────────────────

  private renderTerrain(camera: Camera, map: GameMap, tick: number): void {
    const ctx = this.ctx;
    const startCX = Math.floor(camera.x / CELL_SIZE);
    const startCY = Math.floor(camera.y / CELL_SIZE);
    const endCX = Math.ceil((camera.x + this.width) / CELL_SIZE);
    const endCY = Math.ceil((camera.y + this.height) / CELL_SIZE);

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
            // Use template+icon data for richer TEMPERATE terrain variation
            // Template types in TEMPERATE: different ground textures
            if (tmpl > 0 && tmpl !== 0xFF) {
              // Template-aware rendering: use template/icon combo for visual variation
              const isRoad = tmpl >= 0x27 && tmpl <= 0x34;
              const isRough = tmpl >= 0x0D && tmpl <= 0x12;
              const isShoreDirt = tmpl >= 0x06 && tmpl <= 0x0C;

              if (isRoad) {
                // Road tiles — gray-brown dirt path
                const v = (icon * 7 + h) % 12;
                ctx.fillStyle = `rgb(${85 + v},${78 + v},${65 + v})`;
                ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
                // Road texture lines
                ctx.fillStyle = `rgba(100,90,75,0.4)`;
                ctx.fillRect(screen.x + 2, screen.y + 11, 20, 2);
              } else if (isRough) {
                // Rough terrain — darker, mottled earth
                const r = 55 + (h % 15) - 7;
                const g = 52 + (h % 12) - 6;
                const b = 35 + (h % 10) - 5;
                ctx.fillStyle = `rgb(${r},${g},${b})`;
                ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
                // Scatter some rocks
                ctx.fillStyle = `rgba(70,65,50,0.6)`;
                ctx.fillRect(screen.x + (h % 14) + 2, screen.y + ((h >> 3) % 12) + 3, 5, 4);
                ctx.fillRect(screen.x + ((h >> 5) % 10) + 6, screen.y + ((h >> 2) % 14) + 1, 3, 3);
              } else if (isShoreDirt) {
                // Shore/dirt transition — sandy brown
                const r = 75 + (h % 14) - 7;
                const g = 68 + (h % 12) - 6;
                const b = 45 + (h % 10) - 5;
                ctx.fillStyle = `rgb(${r},${g},${b})`;
                ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
              } else {
                // Other templates — grass with template-influenced variation
                const tVar = ((tmpl * 13 + icon * 7) % 20) - 10;
                const r = 42 + (h % 10) + tVar * 0.3;
                const g = 72 + (h % 14) + tVar * 0.5;
                const b = 28 + (h % 8) + tVar * 0.2;
                ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
                ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
                // Subtle detail from template
                if ((h + icon) % 5 === 0) {
                  ctx.fillStyle = `rgba(85,65,40,0.2)`;
                  ctx.fillRect(screen.x + 3, screen.y + 3, CELL_SIZE - 6, CELL_SIZE - 6);
                }
              }
            } else {
              // Default clear grass (no MapPack data)
              const r = 45 + (h % 12) - 6;
              const g = 75 + (h % 18) - 9;
              const b = 30 + (h % 8) - 4;
              ctx.fillStyle = `rgb(${r},${g},${b})`;
              ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
              if (h < 15) {
                ctx.fillStyle = `rgba(90,70,40,0.3)`;
                ctx.fillRect(screen.x + 4, screen.y + 4, CELL_SIZE - 8, CELL_SIZE - 8);
              }
            }
            // Grass tuft detail (always)
            if (h > 200) {
              ctx.fillStyle = `rgba(60,100,35,0.6)`;
              const gx = screen.x + (h % 16) + 4;
              const gy = screen.y + ((h >> 4) % 16) + 4;
              ctx.fillRect(gx, gy, 2, 3);
            }
            break;
          }
          case Terrain.WATER: {
            const wave = Math.sin((tick * 0.15) + cx * 0.7 + cy * 0.5) * 8;
            const r = 15 + wave;
            const g = 45 + wave * 1.5;
            const b = 85 + wave * 2;
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
            if ((h + tick) % 30 < 8) {
              ctx.fillStyle = 'rgba(100,160,200,0.15)';
              ctx.fillRect(screen.x + 3, screen.y + 8, 18, 2);
            }
            break;
          }
          case Terrain.ROCK: {
            const v = h % 10;
            ctx.fillStyle = `rgb(${65 + v},${60 + v},${50 + v})`;
            ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
            ctx.fillStyle = `rgba(80,75,60,0.5)`;
            ctx.fillRect(screen.x + (h % 10) + 2, screen.y + ((h >> 3) % 10) + 2, 4, 3);
            ctx.fillRect(screen.x + ((h >> 5) % 12) + 1, screen.y + ((h >> 2) % 14) + 5, 3, 4);
            break;
          }
          case Terrain.TREE: {
            // Ground under tree
            ctx.fillStyle = `rgb(${35 + (h % 8)},${55 + (h % 10)},${25 + (h % 6)})`;
            ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
            // Tree trunk
            ctx.fillStyle = '#4a3520';
            ctx.fillRect(screen.x + 10, screen.y + 14, 4, 10);
            // Tree canopy (layered circles for depth)
            ctx.fillStyle = '#1a4a15';
            ctx.beginPath();
            ctx.arc(screen.x + 12, screen.y + 10, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#256320';
            ctx.beginPath();
            ctx.arc(screen.x + 10, screen.y + 8, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#2d7528';
            ctx.beginPath();
            ctx.arc(screen.x + 13, screen.y + 7, 4, 0, Math.PI * 2);
            ctx.fill();
            break;
          }
          case Terrain.WALL: {
            ctx.fillStyle = `rgb(${75 + (h % 8)},${75 + (h % 8)},${70 + (h % 8)})`;
            ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
            ctx.strokeStyle = 'rgba(0,0,0,0.2)';
            ctx.lineWidth = 1;
            ctx.strokeRect(screen.x + 0.5, screen.y + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
            break;
          }
        }
      }
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

      const screen = camera.worldToScreen(entity.pos.x, entity.pos.y);
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

      // Selection circle (drawn under unit)
      if (selectedIds.has(entity.id) && entity.alive) {
        const rx = spriteW * 0.45;
        const ry = spriteW * 0.2;
        ctx.strokeStyle = '#33ff33';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(screen.x, screen.y + spriteH * 0.3, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Draw sprite
      if (sheet) {
        const frame = entity.spriteFrame % sheet.meta.frameCount;
        assets.drawFrame(ctx, entity.stats.image, frame, screen.x, screen.y, {
          centerX: true,
          centerY: true,
        });
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

    // Health fill with pip segments
    const color = ratio > 0.66 ? '#00cc00' : ratio > 0.33 ? '#cccc00' : '#cc0000';
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
          ctx.fillStyle = `rgba(255,255,150,${alpha})`;
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
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
      }
    }
  }

  // ─── Fog of War ──────────────────────────────────────────

  private renderFogOfWar(camera: Camera, map: GameMap): void {
    const ctx = this.ctx;
    const startCX = Math.floor(camera.x / CELL_SIZE);
    const startCY = Math.floor(camera.y / CELL_SIZE);
    const endCX = Math.ceil((camera.x + this.width) / CELL_SIZE);
    const endCY = Math.ceil((camera.y + this.height) / CELL_SIZE);

    for (let cy = startCY; cy <= endCY; cy++) {
      for (let cx = startCX; cx <= endCX; cx++) {
        const vis = map.getVisibility(cx, cy);
        if (vis === 2) continue; // fully visible

        const screen = camera.worldToScreen(cx * CELL_SIZE, cy * CELL_SIZE);

        if (vis === 0) {
          // Shroud — solid black
          ctx.fillStyle = '#000';
          ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
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

    // Semi-transparent fill
    ctx.fillStyle = 'rgba(0,255,0,0.08)';
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

    // Green border
    ctx.strokeStyle = '#33ff33';
    ctx.lineWidth = 1;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }

  // ─── Minimap ─────────────────────────────────────────────

  private renderMinimap(map: GameMap, entities: Entity[], camera: Camera): void {
    const ctx = this.ctx;
    const mmSize = 90;
    const mmX = this.width - mmSize - 6;
    const mmY = 6;
    const scale = mmSize / Math.max(map.boundsW, map.boundsH);
    const ox = map.boundsX;
    const oy = map.boundsY;

    // Background with border
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(mmX - 2, mmY - 2, mmSize + 4, mmSize + 4);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.strokeRect(mmX - 2, mmY - 2, mmSize + 4, mmSize + 4);

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
          ctx.fillStyle = vis === 2 ? '#1a4a6a' : '#0a2535';
        } else if (terrain === Terrain.TREE) {
          ctx.fillStyle = vis === 2 ? '#1a5a1a' : '#0d2d0d';
        } else if (terrain === Terrain.ROCK || terrain === Terrain.WALL) {
          ctx.fillStyle = vis === 2 ? '#444' : '#222';
        } else {
          ctx.fillStyle = vis === 2 ? '#2a4a1a' : '#15250d';
        }
        ctx.fillRect(px, py, ps, ps);
      }
    }

    // Unit dots
    for (const e of entities) {
      if (!e.alive) continue;
      const ecx = Math.floor(e.pos.x / CELL_SIZE);
      const ecy = Math.floor(e.pos.y / CELL_SIZE);
      const vis = map.getVisibility(ecx, ecy);
      if (vis === 0) continue;
      if (vis === 1 && !e.isPlayerUnit) continue;

      ctx.fillStyle = e.isPlayerUnit ? '#33ff33' : '#ff3333';
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
  }

  // ─── Unit Info Panel ─────────────────────────────────────

  private renderUnitInfo(entities: Entity[], selectedIds: Set<number>): void {
    if (selectedIds.size === 0) return;
    const ctx = this.ctx;

    // Gather selected units
    const selected = entities.filter(e => selectedIds.has(e.id) && e.alive);
    if (selected.length === 0) return;

    const panelW = 180;
    const panelH = selected.length === 1 ? 50 : 30;
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
      // Unit name
      ctx.fillStyle = unit.isPlayerUnit ? '#33ff33' : '#ff3333';
      ctx.fillText(unit.stats.name, px + 8, py + 15);
      // HP
      ctx.fillStyle = '#aaa';
      ctx.fillText(`HP: ${unit.hp}/${unit.maxHp}`, px + 8, py + 28);
      // Health bar
      this.renderHealthBar(px + panelW / 2, py + 38, panelW - 20, unit.hp / unit.maxHp, true);
    } else {
      // Multiple selected
      ctx.fillStyle = '#33ff33';
      ctx.fillText(`${selected.length} units selected`, px + 8, py + 18);
    }
  }
}
