/**
 * ScreenshotCapture — captures canvas screenshots at key moments.
 *
 * Triggers: periodic (every 450 ticks), on anomaly, on state change.
 * Stores dataURL PNGs capped at 200 entries (periodic evicted first).
 */

export interface Screenshot {
  key: string;
  dataUrl: string;
  tick: number;
  trigger: 'periodic' | 'anomaly' | 'state';
  detail: string;
}

const MAX_SCREENSHOTS = 200;
const PERIODIC_INTERVAL = 450; // 30s game time

export class ScreenshotCapture {
  private screenshots = new Map<string, Screenshot>();
  private canvas: HTMLCanvasElement | null = null;
  private pendingCapture: { trigger: 'periodic' | 'anomaly' | 'state'; detail: string } | null = null;
  private missionId = '';

  setCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
  }

  setMission(missionId: string): void {
    this.missionId = missionId;
  }

  /** Called each tick to check for periodic captures */
  tick(tick: number): void {
    if (tick > 0 && tick % PERIODIC_INTERVAL === 0) {
      this.requestCapture('periodic', `tick_${tick}`);
    }
  }

  /** Request a capture on the next render */
  requestCapture(trigger: 'periodic' | 'anomaly' | 'state', detail: string): void {
    // Anomaly/state triggers override pending periodic
    if (this.pendingCapture && this.pendingCapture.trigger === 'periodic' && trigger !== 'periodic') {
      this.pendingCapture = { trigger, detail };
    } else if (!this.pendingCapture) {
      this.pendingCapture = { trigger, detail };
    }
  }

  /** Called after render — actually captures the canvas if a request is pending */
  flush(tick: number): void {
    if (!this.pendingCapture || !this.canvas) return;

    const { trigger, detail } = this.pendingCapture;
    this.pendingCapture = null;

    try {
      const dataUrl = this.canvas.toDataURL('image/png');
      const key = `${this.missionId}_${tick}_${trigger}_${detail}.png`;

      // Enforce cap — evict periodic screenshots first
      if (this.screenshots.size >= MAX_SCREENSHOTS) {
        this.evict();
      }

      this.screenshots.set(key, { key, dataUrl, tick, trigger, detail });
    } catch {
      // Canvas tainted or other error — silently skip
    }
  }

  /** Get all captured screenshots */
  getAll(): Screenshot[] {
    return Array.from(this.screenshots.values());
  }

  /** Get screenshot count */
  get count(): number {
    return this.screenshots.size;
  }

  /** Immediate capture with custom key — callable from Playwright via window global */
  captureNow(key: string): Screenshot | null {
    if (!this.canvas) return null;
    try {
      const dataUrl = this.canvas.toDataURL('image/png');
      if (this.screenshots.size >= MAX_SCREENSHOTS) this.evict();
      const ss: Screenshot = { key, dataUrl, tick: 0, trigger: 'state', detail: key };
      this.screenshots.set(key, ss);
      return ss;
    } catch {
      return null;
    }
  }

  /** Clear all screenshots for a new mission */
  reset(): void {
    this.screenshots.clear();
    this.pendingCapture = null;
  }

  private evict(): void {
    // Evict oldest periodic screenshots first
    for (const [key, ss] of this.screenshots) {
      if (ss.trigger === 'periodic') {
        this.screenshots.delete(key);
        if (this.screenshots.size < MAX_SCREENSHOTS) return;
      }
    }
    // If still full, evict oldest of any type
    const oldest = this.screenshots.keys().next().value;
    if (oldest) this.screenshots.delete(oldest);
  }
}
