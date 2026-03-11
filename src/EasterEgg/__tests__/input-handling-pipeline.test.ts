/**
 * InputManager pipeline tests — comprehensive coverage of input.ts
 *
 * Covers: construction, mouse events (down/move/up), keyboard events,
 * wheel/scroll, updateScale, clearEvents, selection box (drag) mechanics,
 * click vs drag detection, double-click, coordinate transformation,
 * multi-key state, event ordering, and edge cases.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InputManager, InputState } from '../engine/input';

// ---------------------------------------------------------------------------
// Helpers: mock canvas & event factories
// ---------------------------------------------------------------------------

/** Minimal mock canvas that records add/removeEventListener calls */
function createMockCanvas(opts: {
  width?: number;
  height?: number;
  rectWidth?: number;
  rectHeight?: number;
  rectLeft?: number;
  rectTop?: number;
} = {}) {
  const {
    width = 640,
    height = 400,
    rectWidth = 640,
    rectHeight = 400,
    rectLeft = 0,
    rectTop = 0,
  } = opts;

  const listeners: Record<string, Function[]> = {};

  const canvas = {
    width,
    height,
    getBoundingClientRect: () => ({
      left: rectLeft,
      top: rectTop,
      width: rectWidth,
      height: rectHeight,
      right: rectLeft + rectWidth,
      bottom: rectTop + rectHeight,
      x: rectLeft,
      y: rectTop,
      toJSON() { return {}; },
    }),
    addEventListener: vi.fn((type: string, fn: Function, _opts?: any) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: Function) => {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter(f => f !== fn);
      }
    }),
    /** Manually dispatch a fake event through the registered listeners */
    __dispatch(type: string, event: any) {
      for (const fn of listeners[type] ?? []) fn(event);
    },
    __listeners: listeners,
  };

  return canvas as unknown as HTMLCanvasElement & {
    __dispatch: (type: string, event: any) => void;
    __listeners: Record<string, Function[]>;
  };
}

/** Build a minimal MouseEvent-shaped object */
function mouseEvent(overrides: Partial<MouseEvent> & { clientX?: number; clientY?: number; button?: number } = {}): MouseEvent {
  return {
    clientX: 0,
    clientY: 0,
    button: 0,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as MouseEvent;
}

/** Build a minimal KeyboardEvent-shaped object */
function keyEvent(key: string, overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

/** Build a minimal WheelEvent-shaped object */
function wheelEvent(deltaY: number): WheelEvent {
  return {
    deltaY,
    preventDefault: vi.fn(),
  } as unknown as WheelEvent;
}

// ---------------------------------------------------------------------------
// Store original window listeners so we can dispatch keyboard events
// ---------------------------------------------------------------------------
let windowListeners: Record<string, Function[]>;
const origAddEventListener = window.addEventListener;
const origRemoveEventListener = window.removeEventListener;

function dispatchWindowEvent(type: string, event: any) {
  for (const fn of windowListeners[type] ?? []) fn(event);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InputManager', () => {
  let canvas: ReturnType<typeof createMockCanvas>;
  let input: InputManager;

  beforeEach(() => {
    windowListeners = {};
    // Intercept window.addEventListener / removeEventListener
    window.addEventListener = vi.fn((type: string, fn: any) => {
      if (!windowListeners[type]) windowListeners[type] = [];
      windowListeners[type].push(fn);
    }) as any;
    window.removeEventListener = vi.fn((type: string, fn: any) => {
      if (windowListeners[type]) {
        windowListeners[type] = windowListeners[type].filter(f => f !== fn);
      }
    }) as any;

    canvas = createMockCanvas();
    input = new InputManager(canvas);
  });

  afterEach(() => {
    input.destroy();
    window.addEventListener = origAddEventListener;
    window.removeEventListener = origRemoveEventListener;
  });

  // =========================================================================
  // Construction & initialization
  // =========================================================================
  describe('construction', () => {
    it('registers canvas event listeners', () => {
      // mousedown, mousemove, mouseup, contextmenu, wheel
      const types = (canvas.addEventListener as ReturnType<typeof vi.fn>)
        .mock.calls.map((c: any[]) => c[0]);
      expect(types).toContain('mousedown');
      expect(types).toContain('mousemove');
      expect(types).toContain('mouseup');
      expect(types).toContain('contextmenu');
      expect(types).toContain('wheel');
    });

    it('registers window keyboard listeners', () => {
      const types = (window.addEventListener as ReturnType<typeof vi.fn>)
        .mock.calls.map((c: any[]) => c[0]);
      expect(types).toContain('keydown');
      expect(types).toContain('keyup');
    });

    it('initial state is zeroed / empty', () => {
      const s = input.state;
      expect(s.mouseX).toBe(0);
      expect(s.mouseY).toBe(0);
      expect(s.mouseActive).toBe(false);
      expect(s.mouseDown).toBe(false);
      expect(s.rightDown).toBe(false);
      expect(s.isDragging).toBe(false);
      expect(s.keys.size).toBe(0);
      expect(s.ctrlHeld).toBe(false);
      expect(s.shiftHeld).toBe(false);
      expect(s.scrollDelta).toBe(0);
      expect(s.leftClick).toBeNull();
      expect(s.rightClick).toBeNull();
      expect(s.doubleClick).toBeNull();
      expect(s.dragBox).toBeNull();
    });

    it('calls updateScale during construction', () => {
      // Verify internal scale was set by constructing with non-1:1 scaling
      const c2 = createMockCanvas({ width: 640, height: 400, rectWidth: 1280, rectHeight: 800 });
      const input2 = new InputManager(c2);
      // A mouse at clientX=640 (middle of rect) should map to canvas x=320
      c2.__dispatch('mousemove', mouseEvent({ clientX: 640, clientY: 400 }));
      expect(input2.state.mouseX).toBeCloseTo(320, 0);
      expect(input2.state.mouseY).toBeCloseTo(200, 0);
      input2.destroy();
    });
  });

  // =========================================================================
  // Mouse event handling
  // =========================================================================
  describe('mouse events', () => {
    it('mousedown left sets mouseDown and records drag start', () => {
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 100, clientY: 50, button: 0 }));
      expect(input.state.mouseDown).toBe(true);
      expect(input.state.dragStartX).toBe(100);
      expect(input.state.dragStartY).toBe(50);
      expect(input.state.isDragging).toBe(false);
    });

    it('mousedown right sets rightDown', () => {
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 200, clientY: 100, button: 2 }));
      expect(input.state.rightDown).toBe(true);
      expect(input.state.mouseDown).toBe(false); // left not affected
    });

    it('mousedown updates mouseX/mouseY regardless of button', () => {
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 42, clientY: 77, button: 2 }));
      expect(input.state.mouseX).toBe(42);
      expect(input.state.mouseY).toBe(77);
    });

    it('mousemove updates position and sets mouseActive', () => {
      expect(input.state.mouseActive).toBe(false);
      canvas.__dispatch('mousemove', mouseEvent({ clientX: 300, clientY: 200 }));
      expect(input.state.mouseX).toBe(300);
      expect(input.state.mouseY).toBe(200);
      expect(input.state.mouseActive).toBe(true);
    });

    it('mouseup left without drag produces leftClick', () => {
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 50, clientY: 50, button: 0 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 51, clientY: 51, button: 0 }));
      expect(input.state.leftClick).toEqual({ x: 51, y: 51 });
      expect(input.state.mouseDown).toBe(false);
      expect(input.state.isDragging).toBe(false);
    });

    it('mouseup right produces rightClick and clears rightDown', () => {
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 100, clientY: 100, button: 2 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 105, clientY: 105, button: 2 }));
      expect(input.state.rightClick).toEqual({ x: 105, y: 105 });
      expect(input.state.rightDown).toBe(false);
    });

    it('middle button does not affect left or right state', () => {
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 10, clientY: 10, button: 1 }));
      expect(input.state.mouseDown).toBe(false);
      expect(input.state.rightDown).toBe(false);
    });
  });

  // =========================================================================
  // Click vs drag detection
  // =========================================================================
  describe('click vs drag', () => {
    it('small movement below threshold registers as click, not drag', () => {
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 100, clientY: 100, button: 0 }));
      canvas.__dispatch('mousemove', mouseEvent({ clientX: 103, clientY: 103 })); // 3px < 4px threshold
      expect(input.state.isDragging).toBe(false);
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 103, clientY: 103, button: 0 }));
      expect(input.state.leftClick).toEqual({ x: 103, y: 103 });
      expect(input.state.dragBox).toBeNull();
    });

    it('movement exceeding threshold triggers drag', () => {
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 100, clientY: 100, button: 0 }));
      canvas.__dispatch('mousemove', mouseEvent({ clientX: 105, clientY: 100 })); // 5px > 4px
      expect(input.state.isDragging).toBe(true);
    });

    it('drag threshold is checked independently on each axis', () => {
      // Only Y exceeds threshold
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 100, clientY: 100, button: 0 }));
      canvas.__dispatch('mousemove', mouseEvent({ clientX: 100, clientY: 105 }));
      expect(input.state.isDragging).toBe(true);
    });

    it('no drag detection when mouse is not down', () => {
      canvas.__dispatch('mousemove', mouseEvent({ clientX: 200, clientY: 200 }));
      expect(input.state.isDragging).toBe(false);
    });
  });

  // =========================================================================
  // Selection box (drag box) mechanics
  // =========================================================================
  describe('drag box / selection box', () => {
    it('produces a normalized drag box on mouseup after drag', () => {
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 100, clientY: 50, button: 0 }));
      canvas.__dispatch('mousemove', mouseEvent({ clientX: 200, clientY: 150 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 200, clientY: 150, button: 0 }));

      expect(input.state.dragBox).toEqual({ x1: 100, y1: 50, x2: 200, y2: 150 });
      expect(input.state.leftClick).toBeNull(); // drag suppresses click
    });

    it('drag box is normalized when dragging to the upper-left', () => {
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 200, clientY: 200, button: 0 }));
      canvas.__dispatch('mousemove', mouseEvent({ clientX: 50, clientY: 50 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 50, clientY: 50, button: 0 }));

      expect(input.state.dragBox).toEqual({ x1: 50, y1: 50, x2: 200, y2: 200 });
    });

    it('drag resets mouseDown and isDragging after mouseup', () => {
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 10, clientY: 10, button: 0 }));
      canvas.__dispatch('mousemove', mouseEvent({ clientX: 100, clientY: 100 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 100, clientY: 100, button: 0 }));
      expect(input.state.mouseDown).toBe(false);
      expect(input.state.isDragging).toBe(false);
    });
  });

  // =========================================================================
  // Double-click detection
  // =========================================================================
  describe('double-click', () => {
    it('two fast clicks at the same position produce a doubleClick', () => {
      // First click
      vi.spyOn(performance, 'now').mockReturnValue(1000);
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 100, clientY: 100, button: 0 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 100, clientY: 100, button: 0 }));
      expect(input.state.leftClick).toEqual({ x: 100, y: 100 });

      input.clearEvents();

      // Second click within 300ms window
      vi.spyOn(performance, 'now').mockReturnValue(1200);
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 101, clientY: 101, button: 0 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 101, clientY: 101, button: 0 }));
      expect(input.state.doubleClick).toEqual({ x: 101, y: 101 });
      expect(input.state.leftClick).toBeNull(); // double-click replaces single
    });

    it('two clicks far apart in time do NOT produce doubleClick', () => {
      vi.spyOn(performance, 'now').mockReturnValue(1000);
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 100, clientY: 100, button: 0 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 100, clientY: 100, button: 0 }));
      input.clearEvents();

      vi.spyOn(performance, 'now').mockReturnValue(1500); // 500ms > 300ms
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 100, clientY: 100, button: 0 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 100, clientY: 100, button: 0 }));
      expect(input.state.doubleClick).toBeNull();
      expect(input.state.leftClick).toEqual({ x: 100, y: 100 });
    });

    it('two clicks far apart in space do NOT produce doubleClick', () => {
      vi.spyOn(performance, 'now').mockReturnValue(1000);
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 100, clientY: 100, button: 0 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 100, clientY: 100, button: 0 }));
      input.clearEvents();

      vi.spyOn(performance, 'now').mockReturnValue(1100);
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 120, clientY: 120, button: 0 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 120, clientY: 120, button: 0 }));
      // Distance = ~28px > 8px threshold
      expect(input.state.doubleClick).toBeNull();
      expect(input.state.leftClick).toEqual({ x: 120, y: 120 });
    });

    it('triple-click does not produce a second doubleClick', () => {
      const spy = vi.spyOn(performance, 'now');

      // First click
      spy.mockReturnValue(1000);
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 50, clientY: 50, button: 0 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 50, clientY: 50, button: 0 }));
      input.clearEvents();

      // Second click — doubleClick
      spy.mockReturnValue(1100);
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 50, clientY: 50, button: 0 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 50, clientY: 50, button: 0 }));
      expect(input.state.doubleClick).toEqual({ x: 50, y: 50 });
      input.clearEvents();

      // Third click — should NOT double-click (lastClickTime was reset to 0)
      spy.mockReturnValue(1200);
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 50, clientY: 50, button: 0 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 50, clientY: 50, button: 0 }));
      expect(input.state.doubleClick).toBeNull();
      expect(input.state.leftClick).toEqual({ x: 50, y: 50 });
    });
  });

  // =========================================================================
  // Keyboard event handling
  // =========================================================================
  describe('keyboard events', () => {
    it('keydown adds key to keys set', () => {
      dispatchWindowEvent('keydown', keyEvent('a'));
      expect(input.state.keys.has('a')).toBe(true);
    });

    it('keyup removes key from keys set', () => {
      dispatchWindowEvent('keydown', keyEvent('a'));
      dispatchWindowEvent('keyup', keyEvent('a'));
      expect(input.state.keys.has('a')).toBe(false);
    });

    it('Control / Meta sets ctrlHeld', () => {
      dispatchWindowEvent('keydown', keyEvent('Control'));
      expect(input.state.ctrlHeld).toBe(true);
      dispatchWindowEvent('keyup', keyEvent('Control'));
      expect(input.state.ctrlHeld).toBe(false);

      dispatchWindowEvent('keydown', keyEvent('Meta'));
      expect(input.state.ctrlHeld).toBe(true);
      dispatchWindowEvent('keyup', keyEvent('Meta'));
      expect(input.state.ctrlHeld).toBe(false);
    });

    it('Shift sets shiftHeld', () => {
      dispatchWindowEvent('keydown', keyEvent('Shift'));
      expect(input.state.shiftHeld).toBe(true);
      dispatchWindowEvent('keyup', keyEvent('Shift'));
      expect(input.state.shiftHeld).toBe(false);
    });

    it('Tab, F1, Space are prevented from default browser behavior', () => {
      for (const key of ['Tab', 'F1', ' ']) {
        const evt = keyEvent(key);
        dispatchWindowEvent('keydown', evt);
        expect(evt.preventDefault).toHaveBeenCalled();
      }
    });

    it('non-consumed keys are NOT prevented', () => {
      const evt = keyEvent('a');
      dispatchWindowEvent('keydown', evt);
      expect(evt.preventDefault).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Multi-key state
  // =========================================================================
  describe('multi-key state', () => {
    it('multiple keys can be held simultaneously', () => {
      dispatchWindowEvent('keydown', keyEvent('a'));
      dispatchWindowEvent('keydown', keyEvent('b'));
      dispatchWindowEvent('keydown', keyEvent('c'));
      expect(input.state.keys.size).toBe(3);
      expect(input.state.keys.has('a')).toBe(true);
      expect(input.state.keys.has('b')).toBe(true);
      expect(input.state.keys.has('c')).toBe(true);
    });

    it('releasing one key does not affect others', () => {
      dispatchWindowEvent('keydown', keyEvent('x'));
      dispatchWindowEvent('keydown', keyEvent('y'));
      dispatchWindowEvent('keyup', keyEvent('x'));
      expect(input.state.keys.has('x')).toBe(false);
      expect(input.state.keys.has('y')).toBe(true);
    });

    it('Shift + click: both shiftHeld and leftClick are set', () => {
      dispatchWindowEvent('keydown', keyEvent('Shift'));
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 200, clientY: 200, button: 0 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 200, clientY: 200, button: 0 }));
      expect(input.state.shiftHeld).toBe(true);
      expect(input.state.leftClick).toEqual({ x: 200, y: 200 });
    });

    it('Ctrl + right-click: both ctrlHeld and rightClick are set', () => {
      dispatchWindowEvent('keydown', keyEvent('Control'));
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 300, clientY: 300, button: 2 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 300, clientY: 300, button: 2 }));
      expect(input.state.ctrlHeld).toBe(true);
      expect(input.state.rightClick).toEqual({ x: 300, y: 300 });
    });
  });

  // =========================================================================
  // Wheel / scroll events
  // =========================================================================
  describe('wheel events', () => {
    it('scroll accumulates deltaY', () => {
      canvas.__dispatch('wheel', wheelEvent(120));
      expect(input.state.scrollDelta).toBe(120);
      canvas.__dispatch('wheel', wheelEvent(-30));
      expect(input.state.scrollDelta).toBe(90);
    });

    it('scroll preventDefault is called', () => {
      const evt = wheelEvent(10);
      canvas.__dispatch('wheel', evt);
      expect(evt.preventDefault).toHaveBeenCalled();
    });

    it('scrollDelta resets on clearEvents', () => {
      canvas.__dispatch('wheel', wheelEvent(50));
      input.clearEvents();
      expect(input.state.scrollDelta).toBe(0);
    });
  });

  // =========================================================================
  // clearEvents
  // =========================================================================
  describe('clearEvents', () => {
    it('clears all one-shot event fields', () => {
      // Set up events
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 10, clientY: 10, button: 0 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 10, clientY: 10, button: 0 }));
      canvas.__dispatch('wheel', wheelEvent(50));
      // Manually set dragBox and doubleClick for thorough test
      input.state.dragBox = { x1: 0, y1: 0, x2: 100, y2: 100 };
      input.state.rightClick = { x: 5, y: 5 };
      input.state.doubleClick = { x: 10, y: 10 };

      input.clearEvents();

      expect(input.state.leftClick).toBeNull();
      expect(input.state.rightClick).toBeNull();
      expect(input.state.doubleClick).toBeNull();
      expect(input.state.dragBox).toBeNull();
      expect(input.state.scrollDelta).toBe(0);
    });

    it('does NOT clear persistent state (mouseDown, keys, position)', () => {
      dispatchWindowEvent('keydown', keyEvent('a'));
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 200, clientY: 150, button: 0 }));

      input.clearEvents();

      expect(input.state.keys.has('a')).toBe(true);
      expect(input.state.mouseDown).toBe(true);
      expect(input.state.mouseX).toBe(200);
      expect(input.state.mouseY).toBe(150);
    });
  });

  // =========================================================================
  // updateScale — coordinate scaling
  // =========================================================================
  describe('updateScale / coordinate transformation', () => {
    it('1:1 scale (640x400 canvas in 640x400 rect) passes through raw coords', () => {
      canvas.__dispatch('mousemove', mouseEvent({ clientX: 320, clientY: 200 }));
      expect(input.state.mouseX).toBe(320);
      expect(input.state.mouseY).toBe(200);
    });

    it('2x upscaled canvas (640x400 canvas in 1280x800 rect) halves coordinates', () => {
      const c = createMockCanvas({ width: 640, height: 400, rectWidth: 1280, rectHeight: 800 });
      const inp = new InputManager(c);

      c.__dispatch('mousemove', mouseEvent({ clientX: 640, clientY: 400 }));
      expect(inp.state.mouseX).toBeCloseTo(320, 0);
      expect(inp.state.mouseY).toBeCloseTo(200, 0);
      inp.destroy();
    });

    it('non-uniform scaling (canvas wider than rect)', () => {
      const c = createMockCanvas({ width: 640, height: 400, rectWidth: 320, rectHeight: 400 });
      const inp = new InputManager(c);

      c.__dispatch('mousemove', mouseEvent({ clientX: 160, clientY: 200 }));
      // scaleX = 640/320 = 2, scaleY = 400/400 = 1
      expect(inp.state.mouseX).toBeCloseTo(320, 0);
      expect(inp.state.mouseY).toBeCloseTo(200, 0);
      inp.destroy();
    });

    it('offset rect (canvas not at 0,0) subtracts rect.left/top', () => {
      const c = createMockCanvas({
        width: 640, height: 400,
        rectWidth: 640, rectHeight: 400,
        rectLeft: 100, rectTop: 50,
      });
      const inp = new InputManager(c);

      c.__dispatch('mousemove', mouseEvent({ clientX: 420, clientY: 250 }));
      // (420-100)*1 = 320, (250-50)*1 = 200
      expect(inp.state.mouseX).toBeCloseTo(320, 0);
      expect(inp.state.mouseY).toBeCloseTo(200, 0);
      inp.destroy();
    });

    it('zero-size rect returns (0,0) to avoid division by zero', () => {
      const c = createMockCanvas({ width: 640, height: 400, rectWidth: 0, rectHeight: 0 });
      const inp = new InputManager(c);

      c.__dispatch('mousemove', mouseEvent({ clientX: 999, clientY: 999 }));
      expect(inp.state.mouseX).toBe(0);
      expect(inp.state.mouseY).toBe(0);
      inp.destroy();
    });

    it('updateScale can be called after construction to refresh scaling', () => {
      // Start with 1:1
      canvas.__dispatch('mousemove', mouseEvent({ clientX: 320, clientY: 200 }));
      expect(input.state.mouseX).toBe(320);

      // Simulate canvas CSS resize: now canvas is displayed at 2x
      // We need a new canvas mock for this because getBoundingClientRect is fixed
      const c = createMockCanvas({ width: 640, height: 400, rectWidth: 1280, rectHeight: 800 });
      const inp = new InputManager(c);
      // Verify initial scale is 0.5
      c.__dispatch('mousemove', mouseEvent({ clientX: 640, clientY: 400 }));
      expect(inp.state.mouseX).toBeCloseTo(320, 0);
      inp.destroy();
    });
  });

  // =========================================================================
  // Context menu
  // =========================================================================
  describe('context menu', () => {
    it('contextmenu event is prevented', () => {
      const evt = { preventDefault: vi.fn() };
      canvas.__dispatch('contextmenu', evt);
      expect(evt.preventDefault).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // destroy — cleanup
  // =========================================================================
  describe('destroy', () => {
    it('removes all canvas event listeners', () => {
      input.destroy();
      const removedTypes = (canvas.removeEventListener as ReturnType<typeof vi.fn>)
        .mock.calls.map((c: any[]) => c[0]);
      expect(removedTypes).toContain('mousedown');
      expect(removedTypes).toContain('mousemove');
      expect(removedTypes).toContain('mouseup');
      expect(removedTypes).toContain('contextmenu');
      expect(removedTypes).toContain('wheel');
    });

    it('removes window keyboard listeners', () => {
      input.destroy();
      const removedTypes = (window.removeEventListener as ReturnType<typeof vi.fn>)
        .mock.calls.map((c: any[]) => c[0]);
      expect(removedTypes).toContain('keydown');
      expect(removedTypes).toContain('keyup');
    });

    it('canvas stops receiving events after destroy', () => {
      input.destroy();
      // All listeners should have been removed
      expect(canvas.__listeners['mousedown']?.length ?? 0).toBe(0);
      expect(canvas.__listeners['mousemove']?.length ?? 0).toBe(0);
      expect(canvas.__listeners['mouseup']?.length ?? 0).toBe(0);
    });
  });

  // =========================================================================
  // Event ordering
  // =========================================================================
  describe('event ordering', () => {
    it('mousedown then mouseup in same tick produces leftClick', () => {
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 50, clientY: 50, button: 0 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 50, clientY: 50, button: 0 }));
      expect(input.state.leftClick).toEqual({ x: 50, y: 50 });
      expect(input.state.mouseDown).toBe(false);
    });

    it('left and right clicks can both occur in the same tick', () => {
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 10, clientY: 10, button: 0 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 10, clientY: 10, button: 0 }));
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 20, clientY: 20, button: 2 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 20, clientY: 20, button: 2 }));
      expect(input.state.leftClick).toEqual({ x: 10, y: 10 });
      expect(input.state.rightClick).toEqual({ x: 20, y: 20 });
    });

    it('second left-click in same tick overwrites the first', () => {
      vi.spyOn(performance, 'now').mockReturnValue(5000);
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 10, clientY: 10, button: 0 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 10, clientY: 10, button: 0 }));
      expect(input.state.leftClick).toEqual({ x: 10, y: 10 });

      // Second click in the same tick (no clearEvents between) — fast enough for double-click
      vi.spyOn(performance, 'now').mockReturnValue(5050);
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 11, clientY: 11, button: 0 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 11, clientY: 11, button: 0 }));
      // Second click was close enough in time and space — becomes doubleClick
      expect(input.state.doubleClick).toEqual({ x: 11, y: 11 });
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('edge cases', () => {
    it('key repeat: multiple keydown for same key keeps it in the set', () => {
      dispatchWindowEvent('keydown', keyEvent('a'));
      dispatchWindowEvent('keydown', keyEvent('a'));
      dispatchWindowEvent('keydown', keyEvent('a'));
      expect(input.state.keys.has('a')).toBe(true);
      expect(input.state.keys.size).toBe(1);
      // Single keyup should remove it
      dispatchWindowEvent('keyup', keyEvent('a'));
      expect(input.state.keys.has('a')).toBe(false);
    });

    it('keyup without prior keydown is harmless', () => {
      dispatchWindowEvent('keyup', keyEvent('z'));
      expect(input.state.keys.has('z')).toBe(false);
    });

    it('mouse leaving canvas mid-drag: mouseDown persists until mouseup', () => {
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 300, clientY: 200, button: 0 }));
      // Mouse moves outside canvas bounds (negative coords after transform)
      canvas.__dispatch('mousemove', mouseEvent({ clientX: -50, clientY: -50 }));
      expect(input.state.mouseDown).toBe(true);
      // If the user releases outside (browser may or may not fire mouseup on canvas)
      // The mouseDown state persists
      expect(input.state.mouseDown).toBe(true);
    });

    it('rapid left clicks build up without clear — leftClick holds latest', () => {
      vi.spyOn(performance, 'now').mockReturnValue(10000);
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 10, clientY: 10, button: 0 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 10, clientY: 10, button: 0 }));

      // Another click at a different location far away (no double-click)
      vi.spyOn(performance, 'now').mockReturnValue(10100);
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 500, clientY: 300, button: 0 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 500, clientY: 300, button: 0 }));
      // Far enough that it's a new single click, not double
      expect(input.state.leftClick).toEqual({ x: 500, y: 300 });
    });

    it('right-click does not interfere with left-click drag', () => {
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 100, clientY: 100, button: 0 }));
      canvas.__dispatch('mousemove', mouseEvent({ clientX: 200, clientY: 200 }));
      expect(input.state.isDragging).toBe(true);

      // Right-click mid-drag
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 200, clientY: 200, button: 2 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 200, clientY: 200, button: 2 }));
      expect(input.state.rightClick).toEqual({ x: 200, y: 200 });
      // Left drag still in progress
      expect(input.state.mouseDown).toBe(true);
      expect(input.state.isDragging).toBe(true);

      // Complete left drag
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 250, clientY: 250, button: 0 }));
      expect(input.state.dragBox).toBeDefined();
      expect(input.state.mouseDown).toBe(false);
    });

    it('scroll during drag: both scrollDelta and isDragging active', () => {
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 100, clientY: 100, button: 0 }));
      canvas.__dispatch('mousemove', mouseEvent({ clientX: 200, clientY: 200 }));
      canvas.__dispatch('wheel', wheelEvent(60));
      expect(input.state.isDragging).toBe(true);
      expect(input.state.scrollDelta).toBe(60);
    });

    it('large scroll accumulation survives multiple wheel events', () => {
      for (let i = 0; i < 100; i++) {
        canvas.__dispatch('wheel', wheelEvent(1));
      }
      expect(input.state.scrollDelta).toBe(100);
    });

    it('negative coordinates are valid (canvas with offset)', () => {
      const c = createMockCanvas({
        width: 640, height: 400,
        rectWidth: 640, rectHeight: 400,
        rectLeft: 200, rectTop: 100,
      });
      const inp = new InputManager(c);
      // Mouse at clientX=100 => 100-200 = -100 canvas x
      c.__dispatch('mousemove', mouseEvent({ clientX: 100, clientY: 50 }));
      expect(inp.state.mouseX).toBe(-100);
      expect(inp.state.mouseY).toBe(-50);
      inp.destroy();
    });

    it('drag exactly at threshold boundary (4px) does NOT trigger drag', () => {
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 100, clientY: 100, button: 0 }));
      // Move exactly 4 pixels — DRAG_THRESHOLD is 4 and the comparison is > (strictly greater)
      canvas.__dispatch('mousemove', mouseEvent({ clientX: 104, clientY: 100 }));
      expect(input.state.isDragging).toBe(false);
      // 5 pixels triggers it
      canvas.__dispatch('mousemove', mouseEvent({ clientX: 105, clientY: 100 }));
      expect(input.state.isDragging).toBe(true);
    });

    it('mouseActive stays true once set', () => {
      expect(input.state.mouseActive).toBe(false);
      canvas.__dispatch('mousemove', mouseEvent({ clientX: 1, clientY: 1 }));
      expect(input.state.mouseActive).toBe(true);
      // No mechanism to reset mouseActive — it stays true
      input.clearEvents();
      expect(input.state.mouseActive).toBe(true);
    });
  });

  // =========================================================================
  // Integration: full tick cycle
  // =========================================================================
  describe('integration: tick cycle', () => {
    it('simulates a full game tick: move, click, scroll, clear, next tick', () => {
      // --- Tick 1: user moves mouse, left-clicks, scrolls ---
      canvas.__dispatch('mousemove', mouseEvent({ clientX: 300, clientY: 200 }));
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 300, clientY: 200, button: 0 }));
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 300, clientY: 200, button: 0 }));
      canvas.__dispatch('wheel', wheelEvent(-30));
      dispatchWindowEvent('keydown', keyEvent('Shift'));

      expect(input.state.mouseActive).toBe(true);
      expect(input.state.mouseX).toBe(300);
      expect(input.state.mouseY).toBe(200);
      expect(input.state.leftClick).toEqual({ x: 300, y: 200 });
      expect(input.state.scrollDelta).toBe(-30);
      expect(input.state.shiftHeld).toBe(true);

      // Game processes input, then clears one-shot events
      input.clearEvents();

      // --- Tick 2: one-shots are gone, persistent state remains ---
      expect(input.state.leftClick).toBeNull();
      expect(input.state.scrollDelta).toBe(0);
      expect(input.state.shiftHeld).toBe(true); // still held
      expect(input.state.mouseActive).toBe(true);
      expect(input.state.mouseX).toBe(300);

      // User releases shift
      dispatchWindowEvent('keyup', keyEvent('Shift'));
      expect(input.state.shiftHeld).toBe(false);
    });

    it('simulates a full drag-select cycle across ticks', () => {
      // Tick 1: mouse down
      canvas.__dispatch('mousedown', mouseEvent({ clientX: 50, clientY: 50, button: 0 }));
      input.clearEvents();

      // Tick 2: drag in progress
      canvas.__dispatch('mousemove', mouseEvent({ clientX: 150, clientY: 150 }));
      expect(input.state.isDragging).toBe(true);
      expect(input.state.mouseDown).toBe(true);
      input.clearEvents();

      // Tick 3: still dragging
      canvas.__dispatch('mousemove', mouseEvent({ clientX: 200, clientY: 200 }));
      expect(input.state.isDragging).toBe(true);
      input.clearEvents();

      // Tick 4: release — drag box emitted
      canvas.__dispatch('mouseup', mouseEvent({ clientX: 200, clientY: 200, button: 0 }));
      expect(input.state.dragBox).toEqual({ x1: 50, y1: 50, x2: 200, y2: 200 });
      expect(input.state.mouseDown).toBe(false);
      expect(input.state.isDragging).toBe(false);

      // Tick 5: after clearEvents, dragBox is gone
      input.clearEvents();
      expect(input.state.dragBox).toBeNull();
    });
  });
});
