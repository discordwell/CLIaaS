/**
 * HTML5 video player for FMV briefing cutscenes.
 * Manages a <video> element with CRT scanline overlay.
 * Videos are lazy-loaded from archive.org.
 *
 * IMPORTANT: Pre-mission FMV must be started synchronously from the user's
 * click handler via `playImmediate()` to preserve Chrome's user gesture
 * context. If video.play() is deferred (e.g. through setTimeout), Chrome
 * blocks autoplay with sound and the video silently skips after the load
 * timeout fires.
 */

import { getMovieUrl } from './movies';

export type MoviePlayerState = 'idle' | 'loading' | 'playing' | 'ended' | 'error';

const LOAD_TIMEOUT_MS = 8000;
const VIDEO_Z = 100020;
const SCANLINE_Z = 100021;
const CLICK_OVERLAY_Z = 100022;

export class MoviePlayer {
  private video: HTMLVideoElement;
  private overlay: HTMLDivElement;
  private clickOverlay: HTMLDivElement | null = null;
  private container: HTMLElement;
  private mounted = false;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private state: MoviePlayerState = 'idle';

  onComplete: (() => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  onStateChange: ((state: MoviePlayerState) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    // Create video element (hidden until play)
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.preload = 'auto';
    Object.assign(this.video.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      background: '#000',
      zIndex: String(VIDEO_Z),
    });

    // CRT scanline overlay
    this.overlay = document.createElement('div');
    Object.assign(this.overlay.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      zIndex: String(SCANLINE_Z),
      pointerEvents: 'none',
      background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 1px, transparent 3px)',
      mixBlendMode: 'multiply',
    });

    // Event handlers
    this.video.addEventListener('ended', this.handleEnded);
    this.video.addEventListener('error', this.handleError);
    this.video.addEventListener('canplay', this.handleCanPlay);
  }

  /** Start buffering a movie without displaying it */
  preload(movieName: string): void {
    this.video.src = getMovieUrl(movieName);
    this.video.load();
    this.setState('loading');
  }

  /**
   * Start playing a movie synchronously from a user gesture context.
   * MUST be called directly in the click handler's call stack (no setTimeout)
   * to preserve Chrome's autoplay-with-sound permission.
   *
   * Mounts the video element and calls video.play() immediately, then handles
   * the returned promise. If autoplay is blocked (NotAllowedError), shows a
   * "Click to play" overlay as a fallback.
   */
  playImmediate(movieName: string): void {
    const url = getMovieUrl(movieName);

    // Only set src if different from preloaded
    if (this.video.src !== url) {
      this.video.src = url;
      this.video.load();
    }

    this.mount();
    this.setState('loading');

    // Timeout fallback for network issues
    this.timeoutId = setTimeout(() => {
      if (this.state === 'loading') {
        console.warn(`[MoviePlayer] Load timeout for "${movieName}" after ${LOAD_TIMEOUT_MS}ms`);
        this.handleError();
      }
    }, LOAD_TIMEOUT_MS);

    // Call play() synchronously — this is the critical line that must run
    // within the user gesture context (no setTimeout wrapping!)
    const playPromise = this.video.play();

    // Handle the promise asynchronously
    playPromise.then(() => {
      this.clearTimeout();
      this.removeClickOverlay();
      this.setState('playing');
    }).catch((err: unknown) => {
      // Check for NotAllowedError by name property directly — DOMException
      // may not be `instanceof Error` in all environments (e.g. jsdom)
      const errName = (err as { name?: string })?.name;
      const errMsg = (err as { message?: string })?.message ?? String(err);
      if (errName === 'NotAllowedError') {
        // Autoplay blocked — show click-to-play fallback
        console.warn('[MoviePlayer] Autoplay blocked (NotAllowedError) — showing click-to-play fallback');
        this.showClickToPlayOverlay(movieName);
      } else {
        // Genuine load/decode error
        console.error(`[MoviePlayer] Play failed for "${movieName}":`, errMsg);
        this.handleError();
      }
    });
  }

  /** Play a movie (appends to DOM). Reuses preloaded src if matching.
   *  For post-mission FMV or cases where user gesture context is unavailable.
   *  Falls back to click-to-play overlay if autoplay is blocked. */
  async play(movieName: string): Promise<void> {
    const url = getMovieUrl(movieName);

    // Only set src if different from preloaded
    if (this.video.src !== url) {
      this.video.src = url;
      this.video.load();
    }

    this.mount();
    this.setState('loading');

    // Timeout fallback
    this.timeoutId = setTimeout(() => {
      if (this.state === 'loading') {
        console.warn(`[MoviePlayer] Load timeout for "${movieName}" after ${LOAD_TIMEOUT_MS}ms`);
        this.handleError();
      }
    }, LOAD_TIMEOUT_MS);

    try {
      await this.video.play();
      this.clearTimeout();
      this.removeClickOverlay();
      this.setState('playing');
    } catch (err: unknown) {
      // Check for NotAllowedError by name property directly on the caught
      // object — DOMException may not be `instanceof Error` in all environments
      const errName = (err as { name?: string })?.name;
      const errMsg = (err as { message?: string })?.message ?? String(err);
      if (errName === 'NotAllowedError') {
        console.warn('[MoviePlayer] Autoplay blocked (NotAllowedError) — showing click-to-play fallback');
        this.showClickToPlayOverlay(movieName);
      } else {
        console.error(`[MoviePlayer] Play failed for "${movieName}":`, errMsg);
        this.handleError();
      }
    }
  }

  /** Skip the current video and fire onComplete */
  skip(): void {
    this.video.pause();
    this.clearTimeout();
    this.removeClickOverlay();
    this.unmount();
    this.setState('ended');
    this.onComplete?.();
  }

  /** Full cleanup — removes event listeners, clears src */
  destroy(): void {
    this.clearTimeout();
    this.video.pause();
    this.removeClickOverlay();
    this.unmount();
    this.video.removeEventListener('ended', this.handleEnded);
    this.video.removeEventListener('error', this.handleError);
    this.video.removeEventListener('canplay', this.handleCanPlay);
    this.video.removeAttribute('src');
    this.video.load(); // release network resources
    this.onComplete = null;
    this.onError = null;
    this.onStateChange = null;
  }

  getState(): MoviePlayerState {
    return this.state;
  }

  /** Expose the underlying video element for testing */
  getVideoElement(): HTMLVideoElement {
    return this.video;
  }

  private mount(): void {
    if (!this.mounted) {
      this.container.appendChild(this.video);
      this.container.appendChild(this.overlay);
      this.mounted = true;
    }
  }

  private unmount(): void {
    if (this.mounted) {
      this.video.remove();
      this.overlay.remove();
      this.mounted = false;
    }
  }

  private setState(s: MoviePlayerState): void {
    this.state = s;
    this.onStateChange?.(s);
  }

  private clearTimeout(): void {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /** Show a "Click to play" overlay when autoplay is blocked */
  private showClickToPlayOverlay(movieName: string): void {
    this.removeClickOverlay();

    const overlay = document.createElement('div');
    overlay.className = 'movie-click-to-play';
    Object.assign(overlay.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      zIndex: String(CLICK_OVERLAY_Z),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.7)',
      cursor: 'pointer',
      fontFamily: 'monospace',
      color: '#ff6633',
      fontSize: '18px',
      letterSpacing: '2px',
      textTransform: 'uppercase',
    });
    overlay.textContent = 'Click to play';

    overlay.addEventListener('click', () => {
      this.removeClickOverlay();
      this.video.play().then(() => {
        this.clearTimeout();
        this.setState('playing');
      }).catch((retryErr: Error) => {
        console.error(`[MoviePlayer] Retry play failed for "${movieName}":`, retryErr.message);
        this.handleError();
      });
    }, { once: true });

    this.container.appendChild(overlay);
    this.clickOverlay = overlay;
  }

  /** Remove the click-to-play overlay if present */
  private removeClickOverlay(): void {
    if (this.clickOverlay) {
      this.clickOverlay.remove();
      this.clickOverlay = null;
    }
  }

  private handleEnded = (): void => {
    this.clearTimeout();
    this.removeClickOverlay();
    this.unmount();
    this.setState('ended');
    this.onComplete?.();
  };

  private handleError = (): void => {
    this.clearTimeout();
    this.removeClickOverlay();
    this.unmount();
    this.setState('error');
    this.onError?.('Failed to load video');
  };

  private handleCanPlay = (): void => {
    this.clearTimeout();
    if (this.state === 'loading') {
      // Video is ready, play() promise should resolve
    }
  };
}
