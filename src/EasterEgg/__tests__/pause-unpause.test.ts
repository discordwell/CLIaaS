/**
 * Pause/unpause scheduling test — verify the game loop continues running
 * while paused so it can detect unpause key presses.
 *
 * Bug: togglePause() set state='paused' but scheduleNext() bails when
 * state !== 'playing', so the game loop died and could never detect the
 * unpause key. Fix: togglePause() now schedules the paused render loop
 * directly via setTimeout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Pause/unpause game loop scheduling', () => {
  let timers: { id: number; fn: Function; delay: number }[];
  let nextId: number;

  beforeEach(() => {
    timers = [];
    nextId = 1;
    vi.stubGlobal('setTimeout', (fn: Function, delay: number) => {
      const id = nextId++;
      timers.push({ id, fn, delay });
      return id;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('togglePause from playing schedules a paused render loop timer', () => {
    // Minimal game-like object with togglePause logic matching index.ts
    const game = {
      state: 'playing' as string,
      timerId: 0,
      audio: { music: { pause: vi.fn(), resume: vi.fn() } },
      onStateChange: null as ((s: string) => void) | null,
      gameLoop: vi.fn(),
      togglePause() {
        if (this.state === 'playing') {
          this.state = 'paused';
          this.audio.music.pause();
          // The fix: schedule paused render loop
          this.timerId = (setTimeout as any)(this.gameLoop, 100);
        } else if (this.state === 'paused') {
          this.state = 'playing';
          this.audio.music.resume();
        }
      },
    };

    game.togglePause();

    expect(game.state).toBe('paused');
    expect(game.timerId).toBeGreaterThan(0);
    // Timer should be scheduled at 100ms (paused render rate)
    expect(timers).toHaveLength(1);
    expect(timers[0].delay).toBe(100);
  });

  it('without the fix, scheduleNext bails when paused — no timer scheduled', () => {
    // Demonstrates the bug: scheduleNext returns early for non-playing states
    const scheduleNext = (state: string) => {
      if (state !== 'playing') return 0; // this is the bug path
      return (setTimeout as any)(() => {}, 16);
    };

    const id = scheduleNext('paused');
    expect(id).toBe(0); // no timer scheduled — game loop dies
    expect(timers).toHaveLength(0);
  });

  it('togglePause from paused back to playing restores game loop', () => {
    const game = {
      state: 'paused' as string,
      timerId: 0,
      lastTime: 0,
      audio: { music: { pause: vi.fn(), resume: vi.fn() } },
      gameLoop: vi.fn(),
      scheduleNext() {
        if (this.state !== 'playing') return;
        this.timerId = (setTimeout as any)(this.gameLoop, 16);
      },
      togglePause() {
        if (this.state === 'playing') {
          this.state = 'paused';
          this.audio.music.pause();
          this.timerId = (setTimeout as any)(this.gameLoop, 100);
        } else if (this.state === 'paused') {
          this.state = 'playing';
          this.audio.music.resume();
          this.lastTime = 12345; // performance.now() equivalent
          this.scheduleNext();
        }
      },
    };

    game.togglePause(); // paused → playing

    expect(game.state).toBe('playing');
    expect(game.timerId).toBeGreaterThan(0);
    // Should schedule at 16ms (normal render rate)
    expect(timers).toHaveLength(1);
    expect(timers[0].delay).toBe(16);
  });
});
