/**
 * Camera pipeline tests — comprehensive coverage of Camera class:
 * construction, scrolling (manual/edge/keyboard), coordinate transforms,
 * visibility culling, boundary clamping, centering, and edge cases.
 *
 * Camera module: src/EasterEgg/engine/camera.ts
 * Constants: CELL_SIZE=24, MAP_CELLS=128 => full map = 3072x3072 px
 * Internal constants: EDGE_SCROLL_MARGIN=12, SCROLL_SPEED=12
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Camera } from '../engine/camera';
import { CELL_SIZE, MAP_CELLS } from '../engine/types';

// Derived constants matching camera.ts internals
const FULL_MAP_PX = MAP_CELLS * CELL_SIZE; // 3072
const EDGE_SCROLL_MARGIN = 12;
const SCROLL_SPEED = 12;

// Standard viewport matching the game canvas (640x400)
const VIEW_W = 640;
const VIEW_H = 400;

describe('Camera Pipeline', () => {
  // ─── Construction ──────────────────────────────────────────────────

  describe('construction', () => {
    it('creates a camera with the specified viewport dimensions', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      expect(cam.viewWidth).toBe(VIEW_W);
      expect(cam.viewHeight).toBe(VIEW_H);
    });

    it('starts at world origin (0, 0)', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      expect(cam.x).toBe(0);
      expect(cam.y).toBe(0);
    });

    it('accepts non-standard viewport sizes', () => {
      const cam = new Camera(1920, 1080);
      expect(cam.viewWidth).toBe(1920);
      expect(cam.viewHeight).toBe(1080);
      expect(cam.x).toBe(0);
      expect(cam.y).toBe(0);
    });
  });

  // ─── scroll(dx, dy) ───────────────────────────────────────────────

  describe('scroll(dx, dy)', () => {
    let cam: Camera;
    beforeEach(() => {
      cam = new Camera(VIEW_W, VIEW_H);
    });

    it('scrolls right by dx pixels', () => {
      cam.scroll(100, 0);
      expect(cam.x).toBe(100);
      expect(cam.y).toBe(0);
    });

    it('scrolls down by dy pixels', () => {
      cam.scroll(0, 50);
      expect(cam.x).toBe(0);
      expect(cam.y).toBe(50);
    });

    it('scrolls diagonally', () => {
      cam.scroll(200, 150);
      expect(cam.x).toBe(200);
      expect(cam.y).toBe(150);
    });

    it('accumulates multiple scrolls', () => {
      cam.scroll(100, 50);
      cam.scroll(100, 50);
      cam.scroll(100, 50);
      expect(cam.x).toBe(300);
      expect(cam.y).toBe(150);
    });

    it('supports negative scroll (scrolling left/up)', () => {
      cam.scroll(500, 500);
      cam.scroll(-200, -100);
      expect(cam.x).toBe(300);
      expect(cam.y).toBe(400);
    });

    it('clamps to minimum bounds (cannot scroll past top-left)', () => {
      cam.scroll(-100, -100);
      expect(cam.x).toBe(0);
      expect(cam.y).toBe(0);
    });

    it('clamps to maximum bounds (cannot scroll past bottom-right)', () => {
      // Max x = FULL_MAP_PX - viewWidth = 3072 - 640 = 2432
      // Max y = FULL_MAP_PX - viewHeight = 3072 - 400 = 2672
      cam.scroll(99999, 99999);
      expect(cam.x).toBe(FULL_MAP_PX - VIEW_W);
      expect(cam.y).toBe(FULL_MAP_PX - VIEW_H);
    });

    it('scrolling by zero does not move camera', () => {
      cam.scroll(100, 200);
      const xBefore = cam.x;
      const yBefore = cam.y;
      cam.scroll(0, 0);
      expect(cam.x).toBe(xBefore);
      expect(cam.y).toBe(yBefore);
    });
  });

  // ─── Boundary clamping (exhaustive) ────────────────────────────────

  describe('boundary clamping', () => {
    it('clamps x independently of y', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(-50, 500);
      expect(cam.x).toBe(0);
      expect(cam.y).toBe(500);
    });

    it('clamps y independently of x', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(500, -50);
      expect(cam.x).toBe(500);
      expect(cam.y).toBe(0);
    });

    it('clamps both axes simultaneously at top-left corner', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(-100, -200);
      expect(cam.x).toBe(0);
      expect(cam.y).toBe(0);
    });

    it('clamps both axes simultaneously at bottom-right corner', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(100000, 100000);
      expect(cam.x).toBe(FULL_MAP_PX - VIEW_W);
      expect(cam.y).toBe(FULL_MAP_PX - VIEW_H);
    });

    it('allows exact boundary positions without further clamping', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      const maxX = FULL_MAP_PX - VIEW_W;
      const maxY = FULL_MAP_PX - VIEW_H;
      cam.scroll(maxX, maxY);
      expect(cam.x).toBe(maxX);
      expect(cam.y).toBe(maxY);
    });

    it('position 1px inside max boundary stays unclamped', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      const target = FULL_MAP_PX - VIEW_W - 1;
      cam.scroll(target, 0);
      expect(cam.x).toBe(target);
    });

    it('position 1px past max boundary gets clamped', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(FULL_MAP_PX - VIEW_W + 1, 0);
      expect(cam.x).toBe(FULL_MAP_PX - VIEW_W);
    });
  });

  // ─── setPlayableBounds ─────────────────────────────────────────────

  describe('setPlayableBounds(x, y, w, h)', () => {
    it('constrains camera to a sub-region of the map', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      // Playable area: cells (40,40) to (90,90) = 50x50 cells
      cam.setPlayableBounds(40, 40, 50, 50);
      // boundsMinX = 40*24 = 960, boundsMinY = 40*24 = 960
      // boundsMaxX = 90*24 = 2160, boundsMaxY = 90*24 = 2160
      // At origin, clamp should push to min bounds
      // cam.x was 0, but clamp needs a scroll to trigger — let's force a scroll
      cam.scroll(0, 0);
      expect(cam.x).toBe(40 * CELL_SIZE);
      expect(cam.y).toBe(40 * CELL_SIZE);
    });

    it('clamps camera max to playable area bounds', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.setPlayableBounds(40, 40, 50, 50);
      cam.scroll(99999, 99999);
      // maxX = 90*24 - 640 = 2160 - 640 = 1520
      // maxY = 90*24 - 400 = 2160 - 400 = 1760
      expect(cam.x).toBe(90 * CELL_SIZE - VIEW_W);
      expect(cam.y).toBe(90 * CELL_SIZE - VIEW_H);
    });

    it('camera cannot scroll below playable min bounds', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.setPlayableBounds(10, 20, 80, 60);
      cam.scroll(0, 0);
      expect(cam.x).toBe(10 * CELL_SIZE);
      expect(cam.y).toBe(20 * CELL_SIZE);
    });

    it('uses cell coordinates, not pixel coordinates', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.setPlayableBounds(5, 5, 100, 100);
      cam.scroll(0, 0); // trigger clamp
      // min = 5*24 = 120
      expect(cam.x).toBe(120);
      expect(cam.y).toBe(120);
    });

    it('works with full-map bounds (0,0,128,128)', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.setPlayableBounds(0, 0, MAP_CELLS, MAP_CELLS);
      cam.scroll(0, 0);
      expect(cam.x).toBe(0);
      expect(cam.y).toBe(0);
      cam.scroll(99999, 99999);
      expect(cam.x).toBe(FULL_MAP_PX - VIEW_W);
      expect(cam.y).toBe(FULL_MAP_PX - VIEW_H);
    });
  });

  // ─── centerOn ──────────────────────────────────────────────────────

  describe('centerOn(wx, wy)', () => {
    it('centers the viewport on a world position', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.centerOn(1500, 1500);
      // x = 1500 - 320 = 1180, y = 1500 - 200 = 1300
      expect(cam.x).toBe(1500 - VIEW_W / 2);
      expect(cam.y).toBe(1500 - VIEW_H / 2);
    });

    it('clamps if centering would exceed top-left bounds', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.centerOn(100, 100);
      // x = 100 - 320 = -220 => clamped to 0
      // y = 100 - 200 = -100 => clamped to 0
      expect(cam.x).toBe(0);
      expect(cam.y).toBe(0);
    });

    it('clamps if centering would exceed bottom-right bounds', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.centerOn(3000, 3000);
      // x = 3000 - 320 = 2680 => clamped to 2432
      // y = 3000 - 200 = 2800 => clamped to 2672
      expect(cam.x).toBe(FULL_MAP_PX - VIEW_W);
      expect(cam.y).toBe(FULL_MAP_PX - VIEW_H);
    });

    it('respects playable bounds when centering', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.setPlayableBounds(40, 40, 50, 50);
      cam.centerOn(0, 0);
      // Would want x = -320, y = -200 => clamped to playable min
      expect(cam.x).toBe(40 * CELL_SIZE);
      expect(cam.y).toBe(40 * CELL_SIZE);
    });

    it('centers exactly in the middle of the map', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      const midX = FULL_MAP_PX / 2;
      const midY = FULL_MAP_PX / 2;
      cam.centerOn(midX, midY);
      expect(cam.x).toBe(midX - VIEW_W / 2);
      expect(cam.y).toBe(midY - VIEW_H / 2);
    });
  });

  // ─── edgeScroll ────────────────────────────────────────────────────

  describe('edgeScroll(mouseX, mouseY, mouseActive)', () => {
    let cam: Camera;
    beforeEach(() => {
      cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(1000, 1000); // start at a center position so scrolling either way is possible
    });

    it('does nothing when mouseActive is false', () => {
      const xBefore = cam.x;
      const yBefore = cam.y;
      cam.edgeScroll(0, 0, false);
      expect(cam.x).toBe(xBefore);
      expect(cam.y).toBe(yBefore);
    });

    it('scrolls left when mouse is near left edge', () => {
      const xBefore = cam.x;
      cam.edgeScroll(5, VIEW_H / 2, true); // 5 < EDGE_SCROLL_MARGIN(12)
      expect(cam.x).toBe(xBefore - SCROLL_SPEED);
    });

    it('scrolls right when mouse is near right edge', () => {
      const xBefore = cam.x;
      cam.edgeScroll(VIEW_W - 5, VIEW_H / 2, true); // 635 > 640-12=628
      expect(cam.x).toBe(xBefore + SCROLL_SPEED);
    });

    it('scrolls up when mouse is near top edge', () => {
      const yBefore = cam.y;
      cam.edgeScroll(VIEW_W / 2, 5, true); // 5 < 12
      expect(cam.y).toBe(yBefore - SCROLL_SPEED);
    });

    it('scrolls down when mouse is near bottom edge', () => {
      const yBefore = cam.y;
      cam.edgeScroll(VIEW_W / 2, VIEW_H - 5, true); // 395 > 400-12=388
      expect(cam.y).toBe(yBefore + SCROLL_SPEED);
    });

    it('scrolls diagonally when mouse is in a corner', () => {
      const xBefore = cam.x;
      const yBefore = cam.y;
      cam.edgeScroll(0, 0, true); // top-left corner
      expect(cam.x).toBe(xBefore - SCROLL_SPEED);
      expect(cam.y).toBe(yBefore - SCROLL_SPEED);
    });

    it('does not scroll when mouse is in the center of the screen', () => {
      const xBefore = cam.x;
      const yBefore = cam.y;
      cam.edgeScroll(VIEW_W / 2, VIEW_H / 2, true);
      expect(cam.x).toBe(xBefore);
      expect(cam.y).toBe(yBefore);
    });

    it('does not scroll when mouse is at exactly EDGE_SCROLL_MARGIN', () => {
      const xBefore = cam.x;
      cam.edgeScroll(EDGE_SCROLL_MARGIN, VIEW_H / 2, true);
      // mouseX < EDGE_SCROLL_MARGIN is the condition, so exactly 12 should NOT trigger
      expect(cam.x).toBe(xBefore);
    });

    it('scrolls when mouse is at EDGE_SCROLL_MARGIN - 1', () => {
      const xBefore = cam.x;
      cam.edgeScroll(EDGE_SCROLL_MARGIN - 1, VIEW_H / 2, true); // 11 < 12
      expect(cam.x).toBe(xBefore - SCROLL_SPEED);
    });

    it('does not scroll right when mouse is at exactly (viewWidth - EDGE_SCROLL_MARGIN)', () => {
      const xBefore = cam.x;
      // Right trigger: mouseX > viewWidth - EDGE_SCROLL_MARGIN = 640-12=628
      // At 628, NOT > 628 so should NOT trigger
      cam.edgeScroll(VIEW_W - EDGE_SCROLL_MARGIN, VIEW_H / 2, true);
      expect(cam.x).toBe(xBefore);
    });

    it('scrolls right when mouse is at (viewWidth - EDGE_SCROLL_MARGIN + 1)', () => {
      const xBefore = cam.x;
      cam.edgeScroll(VIEW_W - EDGE_SCROLL_MARGIN + 1, VIEW_H / 2, true); // 629 > 628
      expect(cam.x).toBe(xBefore + SCROLL_SPEED);
    });

    it('bottom-right corner scrolls both right and down', () => {
      const xBefore = cam.x;
      const yBefore = cam.y;
      cam.edgeScroll(VIEW_W - 1, VIEW_H - 1, true);
      expect(cam.x).toBe(xBefore + SCROLL_SPEED);
      expect(cam.y).toBe(yBefore + SCROLL_SPEED);
    });

    it('still clamps to bounds after edge scrolling at map edge', () => {
      cam = new Camera(VIEW_W, VIEW_H); // at (0,0)
      cam.edgeScroll(0, 0, true); // try to scroll up-left
      expect(cam.x).toBe(0);
      expect(cam.y).toBe(0);
    });
  });

  // ─── keyScroll ─────────────────────────────────────────────────────

  describe('keyScroll(keys)', () => {
    let cam: Camera;
    beforeEach(() => {
      cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(1000, 1000); // center position
    });

    it('scrolls left with ArrowLeft', () => {
      const xBefore = cam.x;
      cam.keyScroll(new Set(['ArrowLeft']));
      expect(cam.x).toBe(xBefore - SCROLL_SPEED);
    });

    it('scrolls right with ArrowRight', () => {
      const xBefore = cam.x;
      cam.keyScroll(new Set(['ArrowRight']));
      expect(cam.x).toBe(xBefore + SCROLL_SPEED);
    });

    it('scrolls up with ArrowUp', () => {
      const yBefore = cam.y;
      cam.keyScroll(new Set(['ArrowUp']));
      expect(cam.y).toBe(yBefore - SCROLL_SPEED);
    });

    it('scrolls down with ArrowDown', () => {
      const yBefore = cam.y;
      cam.keyScroll(new Set(['ArrowDown']));
      expect(cam.y).toBe(yBefore + SCROLL_SPEED);
    });

    it('scrolls left with WASD key "a"', () => {
      const xBefore = cam.x;
      cam.keyScroll(new Set(['a']));
      expect(cam.x).toBe(xBefore - SCROLL_SPEED);
    });

    it('scrolls right with WASD key "d"', () => {
      const xBefore = cam.x;
      cam.keyScroll(new Set(['d']));
      expect(cam.x).toBe(xBefore + SCROLL_SPEED);
    });

    it('scrolls up with WASD key "w"', () => {
      const yBefore = cam.y;
      cam.keyScroll(new Set(['w']));
      expect(cam.y).toBe(yBefore - SCROLL_SPEED);
    });

    it('scrolls down with WASD key "s"', () => {
      const yBefore = cam.y;
      cam.keyScroll(new Set(['s']));
      expect(cam.y).toBe(yBefore + SCROLL_SPEED);
    });

    it('scrolls diagonally with two arrow keys', () => {
      const xBefore = cam.x;
      const yBefore = cam.y;
      cam.keyScroll(new Set(['ArrowRight', 'ArrowDown']));
      expect(cam.x).toBe(xBefore + SCROLL_SPEED);
      expect(cam.y).toBe(yBefore + SCROLL_SPEED);
    });

    it('scrolls diagonally with WASD (w + d = up-right)', () => {
      const xBefore = cam.x;
      const yBefore = cam.y;
      cam.keyScroll(new Set(['w', 'd']));
      expect(cam.x).toBe(xBefore + SCROLL_SPEED);
      expect(cam.y).toBe(yBefore - SCROLL_SPEED);
    });

    it('does nothing with an empty key set', () => {
      const xBefore = cam.x;
      const yBefore = cam.y;
      cam.keyScroll(new Set());
      expect(cam.x).toBe(xBefore);
      expect(cam.y).toBe(yBefore);
    });

    it('does nothing with unrelated keys', () => {
      const xBefore = cam.x;
      const yBefore = cam.y;
      cam.keyScroll(new Set(['Enter', 'Space', 'Escape', 'z']));
      expect(cam.x).toBe(xBefore);
      expect(cam.y).toBe(yBefore);
    });

    it('opposite keys cancel out (left+right = net zero x, but both set dx)', () => {
      // Code checks each direction independently: ArrowLeft sets dx=-12, then ArrowRight overwrites to +12
      // So the last assignment wins — ArrowRight takes precedence
      const xBefore = cam.x;
      cam.keyScroll(new Set(['ArrowLeft', 'ArrowRight']));
      // Both conditions are true: dx first set to -SCROLL_SPEED, then overwritten to +SCROLL_SPEED
      expect(cam.x).toBe(xBefore + SCROLL_SPEED);
    });

    it('clamps to bounds after key scrolling', () => {
      cam = new Camera(VIEW_W, VIEW_H); // at (0,0)
      cam.keyScroll(new Set(['ArrowLeft', 'ArrowUp']));
      expect(cam.x).toBe(0);
      expect(cam.y).toBe(0);
    });
  });

  // ─── screenToWorld ─────────────────────────────────────────────────

  describe('screenToWorld(sx, sy)', () => {
    it('converts screen origin to camera world position', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(500, 300);
      const world = cam.screenToWorld(0, 0);
      expect(world.x).toBe(500);
      expect(world.y).toBe(300);
    });

    it('adds camera offset to screen coordinates', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(100, 200);
      const world = cam.screenToWorld(50, 75);
      expect(world.x).toBe(150);
      expect(world.y).toBe(275);
    });

    it('at default position (0,0), screen coords equal world coords', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      const world = cam.screenToWorld(320, 200);
      expect(world.x).toBe(320);
      expect(world.y).toBe(200);
    });

    it('bottom-right screen corner maps to camera.x+viewWidth, camera.y+viewHeight', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(1000, 800);
      const world = cam.screenToWorld(VIEW_W, VIEW_H);
      expect(world.x).toBe(1000 + VIEW_W);
      expect(world.y).toBe(800 + VIEW_H);
    });
  });

  // ─── worldToScreen ─────────────────────────────────────────────────

  describe('worldToScreen(wx, wy)', () => {
    it('converts camera top-left world position to screen origin', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(500, 300);
      const screen = cam.worldToScreen(500, 300);
      expect(screen.x).toBe(0);
      expect(screen.y).toBe(0);
    });

    it('subtracts camera offset from world coordinates', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(100, 200);
      const screen = cam.worldToScreen(150, 275);
      expect(screen.x).toBe(50);
      expect(screen.y).toBe(75);
    });

    it('returns negative values for positions above/left of viewport', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(500, 500);
      const screen = cam.worldToScreen(400, 400);
      expect(screen.x).toBe(-100);
      expect(screen.y).toBe(-100);
    });

    it('returns values beyond viewport for positions below/right of viewport', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(500, 500);
      const screen = cam.worldToScreen(500 + VIEW_W + 50, 500 + VIEW_H + 50);
      expect(screen.x).toBe(VIEW_W + 50);
      expect(screen.y).toBe(VIEW_H + 50);
    });
  });

  // ─── Round-trip coordinate conversion ──────────────────────────────

  describe('round-trip coordinate conversions', () => {
    it('screenToWorld(worldToScreen(wx, wy)) returns original world coords', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(500, 300);
      const wx = 700;
      const wy = 450;
      const screen = cam.worldToScreen(wx, wy);
      const back = cam.screenToWorld(screen.x, screen.y);
      expect(back.x).toBe(wx);
      expect(back.y).toBe(wy);
    });

    it('worldToScreen(screenToWorld(sx, sy)) returns original screen coords', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(800, 600);
      const sx = 123;
      const sy = 234;
      const world = cam.screenToWorld(sx, sy);
      const back = cam.worldToScreen(world.x, world.y);
      expect(back.x).toBe(sx);
      expect(back.y).toBe(sy);
    });

    it('round-trip holds for many camera positions', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      const positions = [
        [0, 0], [100, 200], [1536, 1536], [2432, 2672],
        [500, 0], [0, 500], [2000, 1000],
      ];
      for (const [cx, cy] of positions) {
        cam.scroll(cx - cam.x, cy - cam.y); // move to position
        const sx = 320;
        const sy = 200;
        const world = cam.screenToWorld(sx, sy);
        const back = cam.worldToScreen(world.x, world.y);
        expect(back.x).toBeCloseTo(sx, 10);
        expect(back.y).toBeCloseTo(sy, 10);
      }
    });

    it('round-trip holds for floating point coordinates', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(123, 456);
      const wx = 555.5;
      const wy = 777.25;
      const screen = cam.worldToScreen(wx, wy);
      const back = cam.screenToWorld(screen.x, screen.y);
      expect(back.x).toBeCloseTo(wx, 10);
      expect(back.y).toBeCloseTo(wy, 10);
    });
  });

  // ─── isVisible ─────────────────────────────────────────────────────

  describe('isVisible(wx, wy, w, h)', () => {
    let cam: Camera;
    beforeEach(() => {
      cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(500, 500);
      // visible world area: (500,500) to (1140,900)
    });

    it('object fully inside viewport is visible', () => {
      expect(cam.isVisible(600, 600, 50, 50)).toBe(true);
    });

    it('object fully outside viewport (to the left) is not visible', () => {
      expect(cam.isVisible(400, 600, 50, 50)).toBe(false); // 400+50=450 < 500
    });

    it('object partially overlapping left edge is visible', () => {
      expect(cam.isVisible(480, 600, 50, 50)).toBe(true); // 480+50=530 > 500
    });

    it('object fully outside viewport (to the right) is not visible', () => {
      expect(cam.isVisible(1200, 600, 50, 50)).toBe(false); // 1200 > 1140
    });

    it('object partially overlapping right edge is visible', () => {
      expect(cam.isVisible(1100, 600, 50, 50)).toBe(true); // 1100 < 1140
    });

    it('object fully outside viewport (above) is not visible', () => {
      expect(cam.isVisible(600, 400, 50, 50)).toBe(false); // 400+50=450 < 500
    });

    it('object partially overlapping top edge is visible', () => {
      expect(cam.isVisible(600, 480, 50, 50)).toBe(true); // 480+50=530 > 500
    });

    it('object fully outside viewport (below) is not visible', () => {
      expect(cam.isVisible(600, 950, 50, 50)).toBe(false); // 950 > 900
    });

    it('object partially overlapping bottom edge is visible', () => {
      expect(cam.isVisible(600, 880, 50, 50)).toBe(true); // 880 < 900
    });

    it('object at exact left boundary (touching but not overlapping) is not visible', () => {
      // wx + w == cam.x => NOT > cam.x => not visible
      expect(cam.isVisible(450, 600, 50, 50)).toBe(false); // 450+50=500, not > 500
    });

    it('object at exact right boundary (touching but not overlapping) is not visible', () => {
      // wx == cam.x + viewWidth => NOT < cam.x + viewWidth => not visible
      expect(cam.isVisible(1140, 600, 50, 50)).toBe(false); // 1140 is not < 1140
    });

    it('object at exact top boundary is not visible', () => {
      expect(cam.isVisible(600, 450, 50, 50)).toBe(false); // 450+50=500, not > 500
    });

    it('object at exact bottom boundary is not visible', () => {
      expect(cam.isVisible(600, 900, 50, 50)).toBe(false); // 900 is not < 900
    });

    it('1px overlap on left is visible', () => {
      expect(cam.isVisible(451, 600, 50, 50)).toBe(true); // 451+50=501 > 500
    });

    it('1px overlap on right is visible', () => {
      expect(cam.isVisible(1139, 600, 50, 50)).toBe(true); // 1139 < 1140
    });

    it('large object covering entire viewport is visible', () => {
      expect(cam.isVisible(0, 0, 3000, 3000)).toBe(true);
    });

    it('zero-size object at camera position is not visible', () => {
      // wx+w > cam.x => 500+0=500, NOT > 500 => false
      expect(cam.isVisible(500, 500, 0, 0)).toBe(false);
    });

    it('1x1 pixel object at camera position is visible', () => {
      expect(cam.isVisible(500, 500, 1, 1)).toBe(true);
    });
  });

  // ─── getVisibleBounds ──────────────────────────────────────────────

  describe('getVisibleBounds()', () => {
    it('returns world-space rectangle of the viewport', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(500, 300);
      const bounds = cam.getVisibleBounds();
      expect(bounds.left).toBe(500);
      expect(bounds.top).toBe(300);
      expect(bounds.right).toBe(500 + VIEW_W);
      expect(bounds.bottom).toBe(300 + VIEW_H);
    });

    it('at origin, returns (0,0) to (viewWidth, viewHeight)', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      const bounds = cam.getVisibleBounds();
      expect(bounds.left).toBe(0);
      expect(bounds.top).toBe(0);
      expect(bounds.right).toBe(VIEW_W);
      expect(bounds.bottom).toBe(VIEW_H);
    });

    it('at max scroll, right edge equals map edge and bottom equals map edge', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(99999, 99999);
      const bounds = cam.getVisibleBounds();
      expect(bounds.right).toBe(FULL_MAP_PX);
      expect(bounds.bottom).toBe(FULL_MAP_PX);
      expect(bounds.left).toBe(FULL_MAP_PX - VIEW_W);
      expect(bounds.top).toBe(FULL_MAP_PX - VIEW_H);
    });

    it('width and height of bounds match viewport dimensions', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(800, 600);
      const bounds = cam.getVisibleBounds();
      expect(bounds.right - bounds.left).toBe(VIEW_W);
      expect(bounds.bottom - bounds.top).toBe(VIEW_H);
    });

    it('updates after scrolling', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      const bounds1 = cam.getVisibleBounds();
      cam.scroll(100, 50);
      const bounds2 = cam.getVisibleBounds();
      expect(bounds2.left).toBe(bounds1.left + 100);
      expect(bounds2.top).toBe(bounds1.top + 50);
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('camera larger than playable area — clamps to min bounds', () => {
      // Playable area is 20x15 cells = 480x360 px, smaller than viewport 640x400
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.setPlayableBounds(50, 50, 20, 15);
      // boundsMinX = 50*24=1200, boundsMaxX = 70*24=1680
      // maxX = 1680 - 640 = 1040, but minX = 1200
      // maxX < minX so clamp behavior: Math.max(1200, Math.min(1040, x))
      // When x < 1040: result = Math.max(1200, x) = 1200 (since x < 1200 too, result = 1200)
      // When x > 1200: result = Math.max(1200, Math.min(1040, x)) = Math.max(1200, 1040) = 1200
      // So camera always ends up at minX = 1200 regardless
      cam.scroll(0, 0); // trigger clamp
      expect(cam.x).toBe(1200);
      // boundsMinY = 50*24=1200, boundsMaxY = 65*24=1560
      // maxY = 1560 - 400 = 1160 < 1200 => always clamps to 1200
      expect(cam.y).toBe(1200);
    });

    it('very small viewport (1x1) can reach near max bounds', () => {
      const cam = new Camera(1, 1);
      cam.scroll(99999, 99999);
      expect(cam.x).toBe(FULL_MAP_PX - 1);
      expect(cam.y).toBe(FULL_MAP_PX - 1);
    });

    it('viewport exactly equal to map size — camera fixed at origin', () => {
      const cam = new Camera(FULL_MAP_PX, FULL_MAP_PX);
      cam.scroll(100, 100);
      // maxX = 3072 - 3072 = 0, maxY = 0
      expect(cam.x).toBe(0);
      expect(cam.y).toBe(0);
    });

    it('coordinates at exact cell boundaries', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(CELL_SIZE * 10, CELL_SIZE * 10);
      expect(cam.x).toBe(240);
      expect(cam.y).toBe(240);
      const world = cam.screenToWorld(0, 0);
      expect(world.x).toBe(240);
      expect(world.y).toBe(240);
    });

    it('multiple centerOn calls — last one wins', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.centerOn(500, 500);
      cam.centerOn(1500, 1500);
      expect(cam.x).toBe(1500 - VIEW_W / 2);
      expect(cam.y).toBe(1500 - VIEW_H / 2);
    });

    it('centerOn followed by scroll accumulates correctly', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.centerOn(1000, 1000);
      const xAfterCenter = cam.x;
      const yAfterCenter = cam.y;
      cam.scroll(50, 30);
      expect(cam.x).toBe(xAfterCenter + 50);
      expect(cam.y).toBe(yAfterCenter + 30);
    });

    it('setPlayableBounds then centerOn respects new bounds', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.setPlayableBounds(40, 40, 50, 50);
      cam.centerOn(65 * CELL_SIZE, 65 * CELL_SIZE);
      // Center of playable area: 65*24=1560
      // x = 1560 - 320 = 1240, within bounds [960, 1520]
      // y = 1560 - 200 = 1360, within bounds [960, 1760]
      expect(cam.x).toBe(1240);
      expect(cam.y).toBe(1360);
    });
  });

  // ─── Smooth scrolling consistency ──────────────────────────────────

  describe('scroll speed consistency', () => {
    it('each keyScroll tick moves by exactly SCROLL_SPEED pixels', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(1000, 1000);
      for (let i = 0; i < 10; i++) {
        const xBefore = cam.x;
        cam.keyScroll(new Set(['ArrowRight']));
        expect(cam.x - xBefore).toBe(SCROLL_SPEED);
      }
    });

    it('edge scroll rate matches keyboard scroll rate', () => {
      const cam1 = new Camera(VIEW_W, VIEW_H);
      const cam2 = new Camera(VIEW_W, VIEW_H);
      cam1.scroll(1000, 1000);
      cam2.scroll(1000, 1000);

      cam1.keyScroll(new Set(['ArrowRight']));
      cam2.edgeScroll(VIEW_W - 1, VIEW_H / 2, true);

      // Both should have moved the same amount
      expect(cam1.x).toBe(cam2.x);
    });

    it('no jitter at min boundary — repeated scroll attempts stay at 0', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      for (let i = 0; i < 20; i++) {
        cam.keyScroll(new Set(['ArrowLeft']));
        expect(cam.x).toBe(0);
        expect(cam.y).toBe(0);
      }
    });

    it('no jitter at max boundary — repeated scroll attempts stay at max', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.scroll(99999, 99999);
      const maxX = cam.x;
      const maxY = cam.y;
      for (let i = 0; i < 20; i++) {
        cam.keyScroll(new Set(['ArrowRight', 'ArrowDown']));
        expect(cam.x).toBe(maxX);
        expect(cam.y).toBe(maxY);
      }
    });
  });

  // ─── Scenario-like initialization ──────────────────────────────────

  describe('scenario-style initialization', () => {
    it('SCA01EA: playable area (40,40,50,50), center on waypoint', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.setPlayableBounds(40, 40, 50, 50);
      // Simulating centering on a player start waypoint at cell (62, 63)
      const wpX = 62 * CELL_SIZE + CELL_SIZE / 2; // center of cell
      const wpY = 63 * CELL_SIZE + CELL_SIZE / 2;
      cam.centerOn(wpX, wpY);

      // Camera should be within playable bounds
      expect(cam.x).toBeGreaterThanOrEqual(40 * CELL_SIZE);
      expect(cam.y).toBeGreaterThanOrEqual(40 * CELL_SIZE);
      expect(cam.x + VIEW_W).toBeLessThanOrEqual(90 * CELL_SIZE);
      expect(cam.y + VIEW_H).toBeLessThanOrEqual(90 * CELL_SIZE);
    });

    it('full map default bounds allow scrolling entire 128x128 area', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      // No setPlayableBounds — default is full map
      cam.scroll(0, 0);
      expect(cam.x).toBe(0);
      cam.scroll(99999, 99999);
      expect(cam.x).toBe(FULL_MAP_PX - VIEW_W);
      expect(cam.y).toBe(FULL_MAP_PX - VIEW_H);
    });

    it('visible bounds after scenario init stay within playable area', () => {
      const cam = new Camera(VIEW_W, VIEW_H);
      cam.setPlayableBounds(40, 40, 50, 50);
      cam.centerOn(65 * CELL_SIZE, 65 * CELL_SIZE);
      const bounds = cam.getVisibleBounds();
      expect(bounds.left).toBeGreaterThanOrEqual(40 * CELL_SIZE);
      expect(bounds.top).toBeGreaterThanOrEqual(40 * CELL_SIZE);
      expect(bounds.right).toBeLessThanOrEqual(90 * CELL_SIZE);
      expect(bounds.bottom).toBeLessThanOrEqual(90 * CELL_SIZE);
    });
  });

  // ─── Constants sanity checks ───────────────────────────────────────

  describe('constants sanity', () => {
    it('CELL_SIZE is 24', () => {
      expect(CELL_SIZE).toBe(24);
    });

    it('MAP_CELLS is 128', () => {
      expect(MAP_CELLS).toBe(128);
    });

    it('full map is 3072x3072 pixels', () => {
      expect(MAP_CELLS * CELL_SIZE).toBe(3072);
    });
  });
});
