/**
 * In-browser debug overlay for the Red Alert TS engine.
 *
 * Installs window.__debug with:
 *   - game: the Game instance (full access to entities, structures, map, assets)
 *   - inspect(cx, cy): log structure/entity info at a cell coordinate
 *   - structures(): list all structures with type, position, image, sheet status
 *   - missingSheets(): list structures whose sprite sheets aren't loaded
 *   - entityAt(cx, cy): find entities near a cell
 *   - assetCheck(name): check if a sprite sheet is loaded
 *
 * Toggle visual overlay with F9 key — shows structure type labels and cell grid.
 *
 * Usage: load any mission with ?anttest=play, open browser console, type __debug.
 */

import type { Game } from './index';
import { CELL_SIZE } from './types';

interface DebugAPI {
  game: Game;
  inspect: (cx: number, cy: number) => void;
  structures: () => void;
  missingSheets: () => string[];
  entityAt: (cx: number, cy: number) => void;
  assetCheck: (name: string) => void;
  overlayEnabled: boolean;
}

export function installDebugOverlay(game: Game): void {
  const api: DebugAPI = {
    game,
    overlayEnabled: false,

    inspect(cx: number, cy: number) {
      console.log(`=== Cell (${cx}, ${cy}) ===`);
      // Structures at this cell
      for (let i = 0; i < game.structures.length; i++) {
        const s = game.structures[i];
        if (!s.alive) continue;
        // Check if cell is within structure footprint
        const fw = (s as any).footprintW ?? 1;
        const fh = (s as any).footprintH ?? 1;
        if (cx >= s.cx && cx < s.cx + fw && cy >= s.cy && cy < s.cy + fh) {
          const sheet = game.assets.getSheet(s.image);
          console.log(`  Structure #${i}: ${s.type} image="${s.image}" house=${s.house} hp=${s.hp}/${s.maxHp} sheet=${sheet ? `${sheet.meta.frameWidth}x${sheet.meta.frameHeight} ${sheet.meta.frameCount}f` : 'MISSING'}`);
        }
      }
      // Entities near this cell
      for (const e of game.entities) {
        if (!e.alive) continue;
        const ecx = Math.floor(e.pos.x / CELL_SIZE);
        const ecy = Math.floor(e.pos.y / CELL_SIZE);
        if (Math.abs(ecx - cx) <= 1 && Math.abs(ecy - cy) <= 1) {
          console.log(`  Entity: ${e.type} id=${e.id} house=${e.house} hp=${e.hp}/${e.maxHp} mission=${e.mission} at (${ecx},${ecy})`);
        }
      }
      // Terrain info
      const terrain = game.map.getTerrain(cx, cy);
      const tmpl = game.map.templateType[cy * 128 + cx];
      const icon = game.map.templateIcon[cy * 128 + cx];
      const wallType = game.map.getWallType(cx, cy);
      console.log(`  Terrain: ${terrain} template=${tmpl} icon=${icon} wall="${wallType}"`);
    },

    structures() {
      console.table(game.structures.filter(s => s.alive).map((s, i) => ({
        idx: i,
        type: s.type,
        image: s.image,
        cx: s.cx,
        cy: s.cy,
        house: s.house,
        hp: `${s.hp}/${s.maxHp}`,
        ally: (s as any).ally ?? '?',
        hasSheet: !!game.assets.getSheet(s.image),
      })));
    },

    missingSheets() {
      const missing: string[] = [];
      for (const s of game.structures) {
        if (!s.alive) continue;
        if (!game.assets.getSheet(s.image)) {
          const key = `${s.type}(${s.image})`;
          if (!missing.includes(key)) missing.push(key);
        }
      }
      if (missing.length === 0) {
        console.log('All structure sheets loaded');
      } else {
        console.warn('Missing sheets:', missing);
      }
      return missing;
    },

    entityAt(cx: number, cy: number) {
      for (const e of game.entities) {
        if (!e.alive) continue;
        const ecx = Math.floor(e.pos.x / CELL_SIZE);
        const ecy = Math.floor(e.pos.y / CELL_SIZE);
        if (ecx === cx && ecy === cy) {
          console.log(`Entity: ${e.type} id=${e.id} house=${e.house} hp=${e.hp}/${e.maxHp} mission=${e.mission}`);
        }
      }
    },

    assetCheck(name: string) {
      const sheet = game.assets.getSheet(name);
      if (sheet) {
        console.log(`Sheet "${name}": ${sheet.meta.frameWidth}x${sheet.meta.frameHeight}, ${sheet.meta.frameCount} frames, ${sheet.meta.columns}x${sheet.meta.rows} grid`);
        console.log('  Image:', sheet.image.width, 'x', sheet.image.height, 'loaded:', sheet.image.complete);
      } else {
        console.warn(`Sheet "${name}" NOT FOUND`);
      }
    },
  };

  (window as any).__debug = api;

  // F9 toggle overlay
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F9') {
      api.overlayEnabled = !api.overlayEnabled;
      console.log(`Debug overlay: ${api.overlayEnabled ? 'ON' : 'OFF'}`);
    }
  });

  // Visual overlay: draw structure type labels on the canvas after each frame
  const canvas = document.querySelector('canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d')!;
    const drawOverlay = () => {
      if (api.overlayEnabled) {
        const cam = game.camera;
        ctx.save();
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        for (const s of game.structures) {
          if (!s.alive) continue;
          const sx = s.cx * CELL_SIZE - cam.x;
          const sy = s.cy * CELL_SIZE - cam.y;
          // Skip off-screen
          if (sx < -72 || sx > cam.viewWidth + 72 || sy < -72 || sy > cam.viewHeight + 72) continue;
          const hasSheet = !!game.assets.getSheet(s.image);
          // Background label
          ctx.fillStyle = hasSheet ? 'rgba(0,0,0,0.6)' : 'rgba(255,0,0,0.7)';
          ctx.fillRect(sx, sy - 8, 30, 9);
          ctx.fillStyle = hasSheet ? '#0f0' : '#ff0';
          ctx.fillText(s.type, sx + 15, sy - 1);
          // Cell outline
          ctx.strokeStyle = hasSheet ? 'rgba(0,255,0,0.3)' : 'rgba(255,0,0,0.5)';
          ctx.lineWidth = 1;
          const fw = CELL_SIZE * 2; // approximate footprint
          ctx.strokeRect(sx + 0.5, sy + 0.5, fw - 1, fw - 1);
        }
        ctx.restore();
      }
      requestAnimationFrame(drawOverlay);
    };
    requestAnimationFrame(drawOverlay);
  }

  console.log(
    '%c[Debug] Overlay installed. Use __debug in console. F9 toggles visual overlay.',
    'color: #0f0; font-weight: bold'
  );
  console.log('  __debug.structures()     — list all structures');
  console.log('  __debug.missingSheets()  — find missing sprite sheets');
  console.log('  __debug.inspect(cx, cy)  — inspect a cell');
  console.log('  __debug.assetCheck(name) — check a sprite sheet');
  console.log('  __debug.game             — full Game instance');
}
