/**
 * HTML5 video player for FMV briefing cutscenes.
 * Manages a <video> element with CRT scanline overlay.
 * Videos are lazy-loaded from archive.org.
 */

import { getMovieUrl } from './movies';

export type MoviePlayerState = 'idle' | 'loading' | 'playing' | 'ended' | 'error';

const LOAD_TIMEOUT_MS = 8000;
const VIDEO_Z = 100020;
const SCANLINE_Z = 100021;

export class MoviePlayer {
  private video: HTMLVideoElement;
  private overlay: HTMLDivElement;
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

  /** Play a movie (appends to DOM). Reuses preloaded src if matching. */
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
        this.handleError();
      }
    }, LOAD_TIMEOUT_MS);

    try {
      await this.video.play();
      this.clearTimeout();
      this.setState('playing');
    } catch {
      // Autoplay blocked or load failed — handled by error event or timeout
    }
  }

  /** Skip the current video and fire onComplete */
  skip(): void {
    this.video.pause();
    this.clearTimeout();
    this.unmount();
    this.setState('ended');
    this.onComplete?.();
  }

  /** Full cleanup — removes event listeners, clears src */
  destroy(): void {
    this.clearTimeout();
    this.video.pause();
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

  private handleEnded = (): void => {
    this.clearTimeout();
    this.unmount();
    this.setState('ended');
    this.onComplete?.();
  };

  private handleError = (): void => {
    this.clearTimeout();
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
