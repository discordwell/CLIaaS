/**
 * Camera / viewport — handles scrolling the map view.
 * The game world is much larger than the screen, so we track
 * which portion of the world is visible.
 */

import { CELL_SIZE, MAP_CELLS } from './types';

const EDGE_SCROLL_MARGIN = 12; // pixels from screen edge to trigger scroll
const SCROLL_SPEED = 12;       // pixels per tick
const MAP_PIXEL_SIZE = MAP_CELLS * CELL_SIZE;

export class Camera {
  /** Top-left corner of the viewport in world coordinates */
  x = 0;
  y = 0;

  /** Viewport dimensions in pixels */
  viewWidth: number;
  viewHeight: number;

  constructor(viewWidth: number, viewHeight: number) {
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
  }

  /** Center the camera on a world position */
  centerOn(wx: number, wy: number): void {
    this.x = wx - this.viewWidth / 2;
    this.y = wy - this.viewHeight / 2;
    this.clamp();
  }

  /** Scroll the camera by pixel amounts */
  scroll(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.clamp();
  }

  /** Edge-of-screen scrolling based on mouse position */
  edgeScroll(mouseX: number, mouseY: number): void {
    let dx = 0;
    let dy = 0;
    if (mouseX < EDGE_SCROLL_MARGIN) dx = -SCROLL_SPEED;
    if (mouseX > this.viewWidth - EDGE_SCROLL_MARGIN) dx = SCROLL_SPEED;
    if (mouseY < EDGE_SCROLL_MARGIN) dy = -SCROLL_SPEED;
    if (mouseY > this.viewHeight - EDGE_SCROLL_MARGIN) dy = SCROLL_SPEED;
    if (dx || dy) this.scroll(dx, dy);
  }

  /** Keyboard arrow key scrolling */
  keyScroll(keys: Set<string>): void {
    let dx = 0;
    let dy = 0;
    if (keys.has('ArrowLeft') || keys.has('a')) dx = -SCROLL_SPEED;
    if (keys.has('ArrowRight') || keys.has('d')) dx = SCROLL_SPEED;
    if (keys.has('ArrowUp') || keys.has('w')) dy = -SCROLL_SPEED;
    if (keys.has('ArrowDown') || keys.has('s')) dy = SCROLL_SPEED;
    if (dx || dy) this.scroll(dx, dy);
  }

  /** Convert screen coordinates to world coordinates */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: sx + this.x, y: sy + this.y };
  }

  /** Convert world coordinates to screen coordinates */
  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: wx - this.x, y: wy - this.y };
  }

  /** Check if a world-space rectangle is visible on screen */
  isVisible(wx: number, wy: number, w: number, h: number): boolean {
    return (
      wx + w > this.x &&
      wx < this.x + this.viewWidth &&
      wy + h > this.y &&
      wy < this.y + this.viewHeight
    );
  }

  /** Clamp camera to map bounds */
  private clamp(): void {
    const maxX = MAP_PIXEL_SIZE - this.viewWidth;
    const maxY = MAP_PIXEL_SIZE - this.viewHeight;
    this.x = Math.max(0, Math.min(maxX, this.x));
    this.y = Math.max(0, Math.min(maxY, this.y));
  }
}
