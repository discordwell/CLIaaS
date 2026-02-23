/**
 * Asset loader — loads pre-extracted sprite sheets and metadata at runtime.
 * Sprite sheets are PNGs in /ra/assets/ with JSON manifest.
 * Also loads the TEMPERATE tileset atlas for terrain rendering.
 */

export interface SpriteSheetMeta {
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  columns: number;
  rows: number;
  sheetWidth: number;
  sheetHeight: number;
}

export interface SpriteSheet {
  image: HTMLImageElement;
  meta: SpriteSheetMeta;
}

export interface AssetManifest {
  [name: string]: SpriteSheetMeta;
}

/** Tileset lookup entry: atlas pixel position for a (templateType, icon) pair */
export interface TilesetEntry {
  ax: number; // x pixel offset in atlas
  ay: number; // y pixel offset in atlas
}

/** Tileset metadata loaded from tileset.json */
export interface TilesetMeta {
  tileW: number;
  tileH: number;
  atlasW: number;
  atlasH: number;
  tileCount: number;
  tiles: Record<string, TilesetEntry>; // key is "type,icon"
}

const BASE_URL = '/ra/assets';

/** Load an image and return a promise that resolves when loaded */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

export class AssetManager {
  private sheets = new Map<string, SpriteSheet>();
  private manifest: AssetManifest | null = null;
  private palette: number[][] | null = null;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  /** TEMPERATE tileset atlas image and lookup data */
  private tilesetImage: HTMLImageElement | null = null;
  private tilesetMeta: TilesetMeta | null = null;

  /** Whether all assets have finished loading */
  get isLoaded(): boolean { return this.loaded; }

  /** Load manifest and all sprite sheets. Calls onProgress(loaded, total) during loading.
   *  Safe to call multiple times — subsequent calls await the existing load. */
  async loadAll(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    if (this.loaded) {
      // Already loaded — report 100% and return
      if (this.manifest) {
        const total = Object.keys(this.manifest).length;
        onProgress?.(total, total);
      }
      return;
    }
    if (this.loadPromise) {
      // Already loading — attach progress and wait
      await this.loadPromise;
      if (this.manifest) {
        const total = Object.keys(this.manifest).length;
        onProgress?.(total, total);
      }
      return;
    }
    this.loadPromise = this.doLoadAll(onProgress);
    await this.loadPromise;
  }

  private async doLoadAll(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    // Load manifest
    const manifestRes = await fetch(`${BASE_URL}/manifest.json`);
    if (!manifestRes.ok) throw new Error(`Failed to load manifest: ${manifestRes.status}`);
    this.manifest = await manifestRes.json();
    if (!this.manifest) throw new Error('Empty manifest');

    // Load palette
    try {
      const palRes = await fetch(`${BASE_URL}/palette.json`);
      this.palette = await palRes.json();
    } catch {
      // Palette is optional
    }

    // Load tileset atlas (non-blocking — falls back to procedural if missing)
    try {
      const [tilesetMetaRes, tilesetImg] = await Promise.all([
        fetch(`${BASE_URL}/tileset.json`).then(r => r.ok ? r.json() : null),
        loadImage(`${BASE_URL}/tileset.png`).catch(() => null),
      ]);
      if (tilesetMetaRes && tilesetImg) {
        this.tilesetMeta = tilesetMetaRes as TilesetMeta;
        this.tilesetImage = tilesetImg;
      }
    } catch {
      // Tileset is optional — renderer falls back to procedural colors
    }

    // Load all sprite sheets in parallel
    const names = Object.keys(this.manifest);
    const total = names.length;
    let loaded = 0;

    const promises = names.map(async (name) => {
      const image = await loadImage(`${BASE_URL}/${name}.png`);
      this.sheets.set(name, { image, meta: this.manifest![name] });
      loaded++;
      onProgress?.(loaded, total);
    });

    await Promise.all(promises);
    this.loaded = true;
  }

  /** Get a loaded sprite sheet by name */
  getSheet(name: string): SpriteSheet | undefined {
    return this.sheets.get(name);
  }

  /** Get the palette */
  getPalette(): number[][] | null {
    return this.palette;
  }

  /** Draw a single frame from a sprite sheet onto a canvas context */
  drawFrame(
    ctx: CanvasRenderingContext2D,
    sheetName: string,
    frameIndex: number,
    x: number,
    y: number,
    options?: {
      centerX?: boolean;
      centerY?: boolean;
      scale?: number;
      flip?: boolean;
    }
  ): void {
    const sheet = this.sheets.get(sheetName);
    if (!sheet) return;

    const { image, meta } = sheet;
    const col = frameIndex % meta.columns;
    const row = Math.floor(frameIndex / meta.columns);
    const sx = col * meta.frameWidth;
    const sy = row * meta.frameHeight;

    let dx = x;
    let dy = y;
    const scale = options?.scale ?? 1;
    const dw = meta.frameWidth * scale;
    const dh = meta.frameHeight * scale;

    if (options?.centerX) dx -= dw / 2;
    if (options?.centerY) dy -= dh / 2;

    if (options?.flip) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(
        image,
        sx, sy, meta.frameWidth, meta.frameHeight,
        -dx - dw, dy, dw, dh
      );
      ctx.restore();
    } else {
      ctx.drawImage(
        image,
        sx, sy, meta.frameWidth, meta.frameHeight,
        dx, dy, dw, dh
      );
    }
  }

  /** Check if a sprite sheet exists */
  hasSheet(name: string): boolean {
    return this.sheets.has(name);
  }

  /** Get tileset atlas image (null if not loaded) */
  getTilesetImage(): HTMLImageElement | null {
    return this.tilesetImage;
  }

  /** Get tileset metadata (null if not loaded) */
  getTilesetMeta(): TilesetMeta | null {
    return this.tilesetMeta;
  }

  /** Check if tileset is available */
  hasTileset(): boolean {
    return this.tilesetImage !== null && this.tilesetMeta !== null;
  }
}

/** Shared singleton — preload via preloadAssets(), reused by all Game instances */
let sharedAssets: AssetManager | null = null;

/** Get or create the shared AssetManager singleton */
export function getSharedAssets(): AssetManager {
  if (!sharedAssets) sharedAssets = new AssetManager();
  return sharedAssets;
}

/** Start preloading assets immediately (fire-and-forget). Returns the promise for optional await. */
export function preloadAssets(): Promise<void> {
  return getSharedAssets().loadAll();
}
