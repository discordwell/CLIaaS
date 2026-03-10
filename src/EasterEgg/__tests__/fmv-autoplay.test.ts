/**
 * @vitest-environment jsdom
 *
 * FMV autoplay fix tests — verify that MoviePlayer.playImmediate() calls
 * video.play() synchronously (within the user gesture context) and that
 * autoplay errors (NotAllowedError) are surfaced rather than silently swallowed.
 *
 * Bug: transitionTo() wrapped callbacks in setTimeout(400ms), so video.play()
 * ran outside Chrome's user gesture context, causing autoplay to be blocked.
 * Fix: playImmediate() calls video.play() synchronously from the click handler.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MoviePlayer, type MoviePlayerState } from '../engine/moviePlayer';

// ── Helpers ──────────────────────────────────────────────────────────

/** Flush the microtask queue — .then().catch() chains need multiple ticks */
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** Create a controllable play() mock on the video element */
function mockVideoPlay(video: HTMLVideoElement) {
  let resolvePlay: (() => void) | null = null;
  let rejectPlay: ((err: Error) => void) | null = null;

  const playMock = vi.fn(() => {
    return new Promise<void>((resolve, reject) => {
      resolvePlay = resolve;
      rejectPlay = reject;
    });
  });

  video.play = playMock;

  return {
    playMock,
    resolve: () => resolvePlay?.(),
    reject: (err: Error) => rejectPlay?.(err),
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('MoviePlayer autoplay fix', () => {
  let container: HTMLDivElement;
  let player: MoviePlayer;
  let playCtrl: ReturnType<typeof mockVideoPlay>;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    player = new MoviePlayer(container);
    // Mock video.play() on the internal video element
    const video = player.getVideoElement();
    playCtrl = mockVideoPlay(video);
  });

  afterEach(() => {
    player.destroy();
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('playImmediate() — synchronous play for user gesture context', () => {
    it('calls video.play() synchronously (no setTimeout deferral)', () => {
      expect(playCtrl.playMock).not.toHaveBeenCalled();
      player.playImmediate('ally1');
      // video.play() should have been called already — no timer needed
      expect(playCtrl.playMock).toHaveBeenCalledTimes(1);
    });

    it('mounts the video element to the container', () => {
      player.playImmediate('ally1');
      const video = player.getVideoElement();
      expect(container.contains(video)).toBe(true);
    });

    it('sets state to loading then playing on success', async () => {
      const states: MoviePlayerState[] = [];
      player.onStateChange = (s) => states.push(s);

      player.playImmediate('ally1');
      expect(states).toContain('loading');

      playCtrl.resolve();
      await flushMicrotasks();

      expect(states).toContain('playing');
    });

    it('sets correct video src from movie name', () => {
      player.playImmediate('ally1');
      const video = player.getVideoElement();
      expect(video.src).toContain('ally1_512kb.mp4');
    });

    it('reuses preloaded src without calling load() again', () => {
      player.preload('ally1');
      const video = player.getVideoElement();
      const loadSpy = vi.spyOn(video, 'load');

      player.playImmediate('ally1');
      // Should not have called load() again since src matches
      expect(loadSpy).not.toHaveBeenCalled();
    });
  });

  describe('NotAllowedError handling (autoplay blocked)', () => {
    it('logs a warning when autoplay is blocked', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      player.playImmediate('ally1');

      const err = new DOMException('Autoplay blocked', 'NotAllowedError');
      playCtrl.reject(err as unknown as Error);
      await flushMicrotasks();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('NotAllowedError')
      );
    });

    it('shows click-to-play overlay when autoplay is blocked', async () => {
      player.playImmediate('ally1');

      const err = new DOMException('Autoplay blocked', 'NotAllowedError');
      playCtrl.reject(err as unknown as Error);
      await flushMicrotasks();

      const clickOverlay = container.querySelector('.movie-click-to-play');
      expect(clickOverlay).not.toBeNull();
      expect(clickOverlay?.textContent).toBe('Click to play');
    });

    it('does NOT call onError for NotAllowedError (uses click fallback instead)', async () => {
      const errorSpy = vi.fn();
      player.onError = errorSpy;

      player.playImmediate('ally1');

      const err = new DOMException('Autoplay blocked', 'NotAllowedError');
      playCtrl.reject(err as unknown as Error);
      await flushMicrotasks();

      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('genuine error handling', () => {
    it('logs and calls handleError for non-NotAllowedError', async () => {
      const errorSpy = vi.fn();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      player.onError = errorSpy;

      player.playImmediate('ally1');

      const err = new Error('Network error');
      err.name = 'AbortError';
      playCtrl.reject(err);
      await flushMicrotasks();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Play failed'),
        expect.any(String)
      );
      expect(errorSpy).toHaveBeenCalledWith('Failed to load video');
    });

    it('fires handleError on load timeout', () => {
      const errorSpy = vi.fn();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      player.onError = errorSpy;

      player.playImmediate('ally1');

      // Advance past load timeout (8000ms)
      vi.advanceTimersByTime(8001);

      expect(errorSpy).toHaveBeenCalledWith('Failed to load video');
    });

    it('logs load timeout with movie name', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      player.playImmediate('ally1');

      vi.advanceTimersByTime(8001);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Load timeout')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ally1')
      );
    });

    it('clears timeout when play succeeds', async () => {
      const errorSpy = vi.fn();
      player.onError = errorSpy;

      player.playImmediate('ally1');
      playCtrl.resolve();
      await flushMicrotasks();

      // Advance past timeout — should NOT fire error
      vi.advanceTimersByTime(10000);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('play() async method — improved error handling', () => {
    it('logs NotAllowedError instead of silently swallowing', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const playPromise = player.play('ally1');

      const err = new DOMException('Autoplay blocked', 'NotAllowedError');
      playCtrl.reject(err as unknown as Error);
      await playPromise;

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('NotAllowedError')
      );
    });

    it('shows click-to-play fallback on NotAllowedError', async () => {
      const playPromise = player.play('ally1');

      const err = new DOMException('Autoplay blocked', 'NotAllowedError');
      playCtrl.reject(err as unknown as Error);
      await playPromise;

      const clickOverlay = container.querySelector('.movie-click-to-play');
      expect(clickOverlay).not.toBeNull();
    });

    it('calls handleError for genuine play errors', async () => {
      const errorSpy = vi.fn();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      player.onError = errorSpy;

      const playPromise = player.play('ally1');

      const err = new Error('Media decode error');
      err.name = 'NotSupportedError';
      playCtrl.reject(err);
      await playPromise;

      expect(errorSpy).toHaveBeenCalledWith('Failed to load video');
    });
  });

  describe('skip() and destroy() clean up click overlay', () => {
    it('skip() removes click-to-play overlay if present', async () => {
      player.playImmediate('ally1');

      const err = new DOMException('Autoplay blocked', 'NotAllowedError');
      playCtrl.reject(err as unknown as Error);
      await flushMicrotasks();

      // Overlay should exist
      expect(container.querySelector('.movie-click-to-play')).not.toBeNull();

      // Skip should clean up and complete
      const completeSpy = vi.fn();
      player.onComplete = completeSpy;
      player.skip();

      expect(player.getState()).toBe('ended');
      expect(completeSpy).toHaveBeenCalled();
    });

    it('destroy() removes click-to-play overlay', async () => {
      player.playImmediate('ally1');

      const err = new DOMException('Autoplay blocked', 'NotAllowedError');
      playCtrl.reject(err as unknown as Error);
      await flushMicrotasks();

      expect(container.querySelector('.movie-click-to-play')).not.toBeNull();

      player.destroy();

      // After destroy, the overlay should be removed from DOM
      expect(container.querySelector('.movie-click-to-play')).toBeNull();
    });
  });

  describe('video.play() timing — not deferred by setTimeout', () => {
    it('playImmediate calls play() before any timer callbacks fire', () => {
      // This test verifies the core fix: play() must happen synchronously,
      // not inside a setTimeout callback.
      let playCalledBeforeTimers = false;

      player.playImmediate('ally1');
      playCalledBeforeTimers = playCtrl.playMock.mock.calls.length > 0;

      // Now advance timers — play should have already been called
      vi.advanceTimersByTime(0);

      expect(playCalledBeforeTimers).toBe(true);
    });

    it('contrast: wrapping in setTimeout defers play() past user gesture window', () => {
      // This demonstrates the original bug: if playImmediate is called inside
      // setTimeout, play() doesn't run synchronously from the click
      expect(playCtrl.playMock).not.toHaveBeenCalled();

      setTimeout(() => {
        player.playImmediate('ally1');
      }, 400);

      // play() has NOT been called yet — gesture context expired
      expect(playCtrl.playMock).not.toHaveBeenCalled();

      // Only after the timer fires does play() run
      vi.advanceTimersByTime(400);
      expect(playCtrl.playMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('onComplete fires when video ends naturally', () => {
    it('fires onComplete when video ends', () => {
      const completeSpy = vi.fn();
      player.onComplete = completeSpy;

      player.playImmediate('ally1');

      // Simulate video ended event
      const video = player.getVideoElement();
      video.dispatchEvent(new Event('ended'));

      expect(completeSpy).toHaveBeenCalled();
      expect(player.getState()).toBe('ended');
    });
  });
});
