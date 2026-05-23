/**
 * @vitest-environment jsdom
 *
 * C++ visual parity: agent-step frame phase.
 *
 * RA conquer.cpp:2365-2375 renders Map.Render() before Logic.AI() advances the
 * frame. The WASM agent harness then reads HidPage after agent_step(), so the
 * captured frame is the state before the final stepped logic tick while the
 * serialized state is after it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../engine';
import { RESFACTOR } from '../engine/types';

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 320 * RESFACTOR;
  canvas.height = 200 * RESFACTOR;
  Object.defineProperty(canvas, 'getContext', {
    value: () => ({ imageSmoothingEnabled: false }),
  });
  return canvas;
}

describe('C++ agent-step render phase', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders before the stepped logic tick, matching Main_Loop Map.Render before Logic.AI', () => {
    const game = new Game(createCanvas());
    const observedRenderTicks: number[] = [];

    (game as any).state = 'playing';
    (game as any).tick = 0;
    (game as any).render = function renderProbe(this: Game) {
      observedRenderTicks.push((this as any).tick);
    };
    (game as any).update = function updateProbe(this: Game) {
      (this as any).tick += 1;
    };

    game.step(1);

    expect(observedRenderTicks).toEqual([0]);
    expect((game as any).tick).toBe(1);
  });

  it('captures the pre-final-tick frame for multi-tick agent batches', () => {
    const game = new Game(createCanvas());
    const observedRenderTicks: number[] = [];

    (game as any).state = 'playing';
    (game as any).tick = 0;
    (game as any).render = function renderProbe(this: Game) {
      observedRenderTicks.push((this as any).tick);
    };
    (game as any).update = function updateProbe(this: Game) {
      (this as any).tick += 1;
    };

    game.step(3);

    expect(observedRenderTicks).toEqual([2]);
    expect((game as any).tick).toBe(3);
  });

  it('does not schedule a paused render loop in manual-step comparison mode', () => {
    const game = new Game(createCanvas());
    const setTimeoutSpy = vi
      .spyOn(window, 'setTimeout')
      .mockImplementation((() => 321) as typeof window.setTimeout);
    const clearTimeoutSpy = vi
      .spyOn(window, 'clearTimeout')
      .mockImplementation((() => undefined) as typeof window.clearTimeout);

    (game as any).state = 'playing';
    (game as any).timerId = 123;
    game.comparisonMode = true;

    game.pause();

    expect((game as any).state).toBe('paused');
    expect(clearTimeoutSpy).toHaveBeenCalledWith(123);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect((game as any).timerId).toBe(0);
  });

  it('keeps the paused render loop for normal interactive pause', () => {
    const game = new Game(createCanvas());
    const setTimeoutSpy = vi
      .spyOn(window, 'setTimeout')
      .mockImplementation((() => 321) as typeof window.setTimeout);
    const clearTimeoutSpy = vi
      .spyOn(window, 'clearTimeout')
      .mockImplementation((() => undefined) as typeof window.clearTimeout);

    (game as any).state = 'playing';
    (game as any).timerId = 123;

    game.pause();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(123);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy.mock.calls[0][1]).toBe(100);
    expect((game as any).timerId).toBe(321);
  });

  it('ignores stray paused-loop callbacks in manual-step comparison mode', () => {
    const game = new Game(createCanvas());
    const renderSpy = vi.spyOn(game as any, 'render');
    const setTimeoutSpy = vi
      .spyOn(window, 'setTimeout')
      .mockImplementation((() => 321) as typeof window.setTimeout);

    (game as any).state = 'paused';
    (game as any).timerId = 123;
    game.comparisonMode = true;

    (game as any).gameLoop();

    expect(renderSpy).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect((game as any).timerId).toBe(0);
  });
});
