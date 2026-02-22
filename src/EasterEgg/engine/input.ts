/**
 * Input handler — mouse clicks, keyboard, drag-selection box.
 */

export interface InputState {
  mouseX: number;      // screen-space mouse X
  mouseY: number;      // screen-space mouse Y
  mouseActive: boolean; // true after first mouse move on canvas
  mouseDown: boolean;  // left button currently held
  rightDown: boolean;  // right button currently held
  dragStartX: number;  // drag box start (screen)
  dragStartY: number;
  isDragging: boolean;
  keys: Set<string>;   // currently held keys
  ctrlHeld: boolean;   // ctrl/meta key held
  // Events consumed per tick
  leftClick: { x: number; y: number } | null;
  rightClick: { x: number; y: number } | null;
  doubleClick: { x: number; y: number } | null;
  dragBox: { x1: number; y1: number; x2: number; y2: number } | null;
}

const DRAG_THRESHOLD = 4; // minimum pixels to count as a drag

export class InputManager {
  state: InputState = {
    mouseX: 0,
    mouseY: 0,
    mouseActive: false,
    mouseDown: false,
    rightDown: false,
    dragStartX: 0,
    dragStartY: 0,
    isDragging: false,
    keys: new Set(),
    ctrlHeld: false,
    leftClick: null,
    rightClick: null,
    doubleClick: null,
    dragBox: null,
  };

  private canvas: HTMLCanvasElement;
  private scaleX = 1;
  private scaleY = 1;
  private lastClickTime = 0;
  private lastClickX = 0;
  private lastClickY = 0;
  private readonly DOUBLE_CLICK_TIME = 300; // ms
  private readonly DOUBLE_CLICK_DIST = 8; // px

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.updateScale();

    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  /** Call at start of each tick to consume one-shot events */
  clearEvents(): void {
    this.state.leftClick = null;
    this.state.rightClick = null;
    this.state.doubleClick = null;
    this.state.dragBox = null;
  }

  /** Update the scale factor when canvas is resized */
  updateScale(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.scaleX = this.canvas.width / rect.width;
    this.scaleY = this.canvas.height / rect.height;
  }

  /** Convert DOM event coordinates to canvas-space */
  private toCanvas(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: (e.clientX - rect.left) * this.scaleX,
      y: (e.clientY - rect.top) * this.scaleY,
    };
  }

  private onMouseDown = (e: MouseEvent): void => {
    const pos = this.toCanvas(e);
    if (e.button === 0) {
      this.state.mouseDown = true;
      this.state.dragStartX = pos.x;
      this.state.dragStartY = pos.y;
      this.state.isDragging = false;
    } else if (e.button === 2) {
      this.state.rightDown = true;
    }
    this.state.mouseX = pos.x;
    this.state.mouseY = pos.y;
  };

  private onMouseMove = (e: MouseEvent): void => {
    const pos = this.toCanvas(e);
    this.state.mouseX = pos.x;
    this.state.mouseY = pos.y;
    this.state.mouseActive = true;

    if (this.state.mouseDown && !this.state.isDragging) {
      const dx = pos.x - this.state.dragStartX;
      const dy = pos.y - this.state.dragStartY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        this.state.isDragging = true;
      }
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    const pos = this.toCanvas(e);
    if (e.button === 0) {
      if (this.state.isDragging) {
        // Drag box complete
        this.state.dragBox = {
          x1: Math.min(this.state.dragStartX, pos.x),
          y1: Math.min(this.state.dragStartY, pos.y),
          x2: Math.max(this.state.dragStartX, pos.x),
          y2: Math.max(this.state.dragStartY, pos.y),
        };
      } else {
        // Check for double-click
        const now = performance.now();
        const dx = pos.x - this.lastClickX;
        const dy = pos.y - this.lastClickY;
        if (now - this.lastClickTime < this.DOUBLE_CLICK_TIME &&
            Math.abs(dx) < this.DOUBLE_CLICK_DIST && Math.abs(dy) < this.DOUBLE_CLICK_DIST) {
          this.state.doubleClick = { x: pos.x, y: pos.y };
          this.lastClickTime = 0; // reset to prevent triple-trigger
        } else {
          this.state.leftClick = { x: pos.x, y: pos.y };
          this.lastClickTime = now;
          this.lastClickX = pos.x;
          this.lastClickY = pos.y;
        }
      }
      this.state.mouseDown = false;
      this.state.isDragging = false;
    } else if (e.button === 2) {
      this.state.rightClick = { x: pos.x, y: pos.y };
      this.state.rightDown = false;
    }
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    this.state.keys.add(e.key);
    if (e.key === 'Control' || e.key === 'Meta') this.state.ctrlHeld = true;
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.state.keys.delete(e.key);
    if (e.key === 'Control' || e.key === 'Meta') this.state.ctrlHeld = false;
  };

  destroy(): void {
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
