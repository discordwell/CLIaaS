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
import { advanceCreditDisplayParity, Game } from '../engine';
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

  it('advances power-bar AI during logic ticks, not render-only captures', () => {
    const game = new Game(createCanvas());
    const powerAiSpy = vi
      .spyOn((game as any).renderer, 'updatePowerAnimation')
      .mockImplementation(() => undefined);
    const callsBeforeRender: number[] = [];

    (game as any).state = 'playing';
    (game as any).tick = 0;
    (game as any).render = function renderProbe() {
      callsBeforeRender.push(powerAiSpy.mock.calls.length);
    };

    game.step(3);

    expect(callsBeforeRender).toEqual([2]);
    expect(powerAiSpy).toHaveBeenCalledTimes(3);
  });

  it('advances credit display before the captured frame, like CreditClass::AI before Map.Render', () => {
    const game = new Game(createCanvas());
    let renderedDisplayCredits = -1;

    (game as any).state = 'playing';
    (game as any).tick = 0;
    (game as any).credits = 5000;
    (game as any).displayCredits = 0;
    (game as any).displayCreditsCountdown = 0;
    (game as any).render = function renderProbe(this: Game) {
      renderedDisplayCredits = (this as any).displayCredits;
    };
    (game as any).update = function updateProbe(this: Game) {
      (this as any).tick += 1;
    };

    game.step(1);

    expect(renderedDisplayCredits).toBe(143);
  });

  it('uses the C++ CreditClass::AI capped one-eighth counter instead of TS easing', () => {
    let state = { current: 0, countdown: 0 };
    state = advanceCreditDisplayParity(state, 5000);
    expect(state).toEqual({ current: 143, countdown: 1 });

    state = advanceCreditDisplayParity(state, 5000);
    expect(state).toEqual({ current: 286, countdown: 1 });
  });

  it('delays downward credit display changes for three frames', () => {
    let state = advanceCreditDisplayParity({ current: 5000, countdown: 0 }, 4000);
    expect(state).toEqual({ current: 4875, countdown: 3 });

    state = advanceCreditDisplayParity(state, 4000);
    expect(state).toEqual({ current: 4875, countdown: 2 });
    state = advanceCreditDisplayParity(state, 4000);
    expect(state).toEqual({ current: 4875, countdown: 1 });
    state = advanceCreditDisplayParity(state, 4000);
    expect(state).toEqual({ current: 4766, countdown: 3 });
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
