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

  /** Mutable progress callback — can be replaced by later callers */
  private _onProgress?: (loaded: number, total: number) => void;
  private _loadedCount = 0;
  private _totalCount = 0;

  /** Whether all assets have finished loading */
  get isLoaded(): boolean { return this.loaded; }

  /** Load manifest and all sprite sheets. Calls onProgress(loaded, total) during loading.
   *  Safe to call multiple times — subsequent calls await the existing load.
   *  A later caller's onProgress replaces any previous one so the UI stays live. */
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
      // Already loading — replace progress callback and report current state
      if (onProgress) {
        this._onProgress = onProgress;
        if (this._totalCount > 0) {
          onProgress(this._loadedCount, this._totalCount);
        }
      }
      await this.loadPromise;
      // Final 100% report
      if (this.manifest && onProgress) {
        const total = Object.keys(this.manifest).length;
        onProgress(total, total);
      }
      return;
    }
    if (onProgress) this._onProgress = onProgress;
    this.loadPromise = this.doLoadAll();
    await this.loadPromise;
  }

  private async doLoadAll(): Promise<void> {
    // Load manifest (required — must complete before we know what sprites to fetch)
    const manifestRes = await fetch(`${BASE_URL}/manifest.json`);
    if (!manifestRes.ok) throw new Error(`Failed to load manifest: ${manifestRes.status}`);
    this.manifest = await manifestRes.json();
    if (!this.manifest) throw new Error('Empty manifest');

    // Build sprite load promises
    const names = Object.keys(this.manifest);
    this._totalCount = names.length;
    this._loadedCount = 0;

    const spritePromises = names.map(async (name) => {
      const image = await loadImage(`${BASE_URL}/${name}.png`);
      this.sheets.set(name, { image, meta: this.manifest![name] });
      this._loadedCount++;
      this._onProgress?.(this._loadedCount, this._totalCount);
    });

    // Load palette, tileset, remap colors, and ALL sprites in parallel
    await Promise.all([
      // Palette (optional)
      fetch(`${BASE_URL}/palette.json`)
        .then(r => r.json())
        .then(p => { this.palette = p; })
        .catch(() => {}),
      // House color remap data (optional — falls back to tint overlay)
      this.loadRemapColors(),
      // Tileset atlas (optional — renderer falls back to procedural colors)
      Promise.all([
        fetch(`${BASE_URL}/tileset.json`).then(r => r.ok ? r.json() : null),
        loadImage(`${BASE_URL}/tileset.png`).catch(() => null),
      ]).then(([meta, img]) => {
        if (meta && img) {
          this.tilesetMeta = meta as TilesetMeta;
          this.tilesetImage = img;
        }
      }).catch(() => {}),
      // All sprite sheets
      ...spritePromises,
    ]);

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

  /** Internal: draw a frame from any CanvasImageSource using sheet metadata */
  private drawFrameInternal(
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    meta: SpriteSheetMeta,
    frameIndex: number,
    x: number,
    y: number,
    options?: { centerX?: boolean; centerY?: boolean; scale?: number; flip?: boolean },
  ): void {
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
      ctx.drawImage(source, sx, sy, meta.frameWidth, meta.frameHeight, -dx - dw, dy, dw, dh);
      ctx.restore();
    } else {
      ctx.drawImage(source, sx, sy, meta.frameWidth, meta.frameHeight, dx, dy, dw, dh);
    }
  }

  /** Draw a single frame from a sprite sheet onto a canvas context */
  drawFrame(
    ctx: CanvasRenderingContext2D,
    sheetName: string,
    frameIndex: number,
    x: number,
    y: number,
    options?: { centerX?: boolean; centerY?: boolean; scale?: number; flip?: boolean },
  ): void {
    const sheet = this.sheets.get(sheetName);
    if (!sheet) return;
    this.drawFrameInternal(ctx, sheet.image, sheet.meta, frameIndex, x, y, options);
  }

  /** Draw a single frame from an arbitrary canvas source using the metadata of a named sheet.
   *  Used for shadow/remap sheets that share the same frame layout as the original sprite. */
  drawFrameFrom(
    ctx: CanvasRenderingContext2D,
    sourceCanvas: HTMLCanvasElement,
    sheetName: string,
    frameIndex: number,
    x: number,
    y: number,
    options?: { centerX?: boolean; centerY?: boolean; scale?: number; flip?: boolean },
  ): void {
    const sheet = this.sheets.get(sheetName);
    if (!sheet) return;
    this.drawFrameInternal(ctx, sourceCanvas, sheet.meta, frameIndex, x, y, options);
  }

  /** Check if a sprite sheet exists */
  hasSheet(name: string): boolean {
    return this.sheets.has(name);
  }

  // === Shadow sheet cache (sprite-shaped silhouettes for C++ SHAPE_GHOST shadow) ===
  private shadowSheets = new Map<string, HTMLCanvasElement>();

  /** Get a shadow silhouette version of a sprite sheet (all pixels → black, alpha preserved).
   *  Cached per sheet name. Used for C++-accurate sprite-shaped unit shadows. */
  getShadowSheet(sheetName: string): HTMLCanvasElement | null {
    if (this.shadowSheets.has(sheetName)) return this.shadowSheets.get(sheetName)!;
    const sheet = this.sheets.get(sheetName);
    if (!sheet) return null;
    const { image } = sheet;
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const sctx = canvas.getContext('2d')!;
    sctx.drawImage(image, 0, 0);
    // Turn all pixels black while preserving alpha (SHAPE_GHOST effect)
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = 'black';
    sctx.fillRect(0, 0, canvas.width, canvas.height);
    this.shadowSheets.set(sheetName, canvas);
    return canvas;
  }

  // === House color remap cache ===
  private remapData: { source: number[][]; houses: Record<string, number[][]> } | null = null;
  private remappedSheets = new Map<string, HTMLCanvasElement>();

  /** Load remap color data (called during loadAll) */
  private async loadRemapColors(): Promise<void> {
    try {
      const res = await fetch(`${BASE_URL}/remap-colors.json`);
      if (res.ok) this.remapData = await res.json();
    } catch { /* optional — house tint fallback */ }
  }

  /** Whether remap color data is available */
  get hasRemapData(): boolean { return this.remapData !== null; }

  /** Get a house-color-remapped version of a sprite sheet.
   *  Swaps the 16 default unit colors to house-specific colors (C++ Init_Color_Remaps).
   *  Cached per (sheetName, house). */
  getRemappedSheet(sheetName: string, house: string): HTMLCanvasElement | null {
    if (!this.remapData) return null;
    const key = `${sheetName}:${house}`;
    if (this.remappedSheets.has(key)) return this.remappedSheets.get(key)!;
    const houseColors = this.remapData.houses[house];
    if (!houseColors) return null;
    const sheet = this.sheets.get(sheetName);
    if (!sheet) return null;
    const { image } = sheet;
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const rctx = canvas.getContext('2d')!;
    rctx.drawImage(image, 0, 0);
    const imgData = rctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imgData.data;
    const srcColors = this.remapData.source;
    // Scan pixels and remap matching source colors → house colors
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] === 0) continue; // skip transparent
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      for (let c = 0; c < srcColors.length; c++) {
        const sr = srcColors[c][0], sg = srcColors[c][1], sb = srcColors[c][2];
        // Tolerance ±2 per channel for palette quantization differences
        if (Math.abs(r - sr) <= 2 && Math.abs(g - sg) <= 2 && Math.abs(b - sb) <= 2) {
          pixels[i] = houseColors[c][0];
          pixels[i + 1] = houseColors[c][1];
          pixels[i + 2] = houseColors[c][2];
          break;
        }
      }
    }
    rctx.putImageData(imgData, 0, 0);
    this.remappedSheets.set(key, canvas);
    return canvas;
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
