/**
 * Asset loader — loads pre-extracted sprite sheets and metadata at runtime.
 * Sprite sheets are PNGs in /ra/assets/ with JSON manifest.
 * Also loads the TEMPERATE tileset atlas for terrain rendering.
 */

import { BitmapFont, type BitmapFontMeta } from './bitmapFont';
import { RA_COLOR_BLACK, conquerBuildFadingTable, makeFadingTable, nearestPaletteIndex } from './shadow';

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

export interface GhostShadowOptions {
  palette: number[][] | null;
  frac: number;
  destColorIndex?: number;
}

export interface DrawFrameOptions {
  centerX?: boolean;
  centerY?: boolean;
  scale?: number;
  flip?: boolean;
  /** C++ CC_Draw_Shape rotation parameter, in 0..255 DirType units. */
  rotation256?: number;
  ghostShadow?: GhostShadowOptions;
  conquerFading?: boolean;
}

export interface TranslucentControl {
  sourceColorIndex: number;
  destColorIndex: number;
  frac: number;
}

export interface AssetManifest {
  [name: string]: SpriteSheetMeta;
}

/** Tileset lookup entry: atlas pixel position for a (templateType, icon) pair.
 *  Synthetic entries (Aftermath templates without TMP files) may lack ax/ay. */
export interface TilesetEntry {
  ax?: number; // x pixel offset in atlas (absent for synthetic land-type-only entries)
  ay?: number; // y pixel offset in atlas
  /** Per-icon land type from C++ TMP control map (cdata.cpp:3009 _land[16]).
   *  Only present for non-Clear tiles. Absent/undefined = 'Clear'. */
  lt?: string;
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

/** Sprite name aliases — historical C++ SHP names that map to different extracted filenames.
 *  The C++ source uses names like WATER_EXP1 / H2O_EXP1 interchangeably; the extractor
 *  writes h2o_exp1.png, but combatAnim() returns 'water-exp1' to match C++ combat.cpp:325.
 *  Keeping the alias here (instead of renaming in combatAnim) preserves all existing
 *  cpp-parity tests that assert water-exp* return values. */
const SPRITE_ALIASES: Record<string, string> = {
  'water-exp1': 'h2o_exp1',
  'water-exp2': 'h2o_exp2',
  'water-exp3': 'h2o_exp3',
};

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
  private sourcePixelCache = new WeakMap<object, {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }>();
  private fadingTableCache = new WeakMap<object, Map<string, Uint8Array>>();

  /** Per-theatre palettes (SNOW, INTERIOR — TEMPERATE uses default palette) */
  private theatrePalettes = new Map<string, number[][]>();

  /** Tileset atlas images and lookup data per theatre */
  private tilesets = new Map<string, { image: HTMLImageElement; meta: TilesetMeta }>();
  /** Legacy single-tileset references (TEMPERATE, for backwards compat) */
  private tilesetImage: HTMLImageElement | null = null;
  private tilesetMeta: TilesetMeta | null = null;

  /** Bitmap fonts (C++ 6POINT.FNT / 8POINT.FNT) */
  private fonts = new Map<string, BitmapFont>();

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
    // Single cache-bust token for this load session — forces fresh fetch after deploys
    // (Next.js serves public/ with immutable cache headers)
    const cacheBust = `?v=${Date.now()}`;

    // Load manifest (required — must complete before we know what sprites to fetch)
    const manifestRes = await fetch(`${BASE_URL}/manifest.json${cacheBust}`);
    if (!manifestRes.ok) throw new Error(`Failed to load manifest: ${manifestRes.status}`);
    this.manifest = await manifestRes.json();
    if (!this.manifest) throw new Error('Empty manifest');

    // Build sprite load promises
    const names = Object.keys(this.manifest);
    this._totalCount = names.length;
    this._loadedCount = 0;

    // Load sprites in sequential batches to avoid overwhelming the dev server.
    // C++ loads from local MIX files — TS needs to handle slow HTTP servers.
    const BATCH_SIZE = 80;
    const MAX_RETRIES = 2;
    const loadSprite = async (name: string) => {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const image = await loadImage(`${BASE_URL}/${name}.png${cacheBust}`);
          this.sheets.set(name, { image, meta: this.manifest![name] });
          this._loadedCount++;
          this._onProgress?.(this._loadedCount, this._totalCount);
          return;
        } catch {
          if (attempt === MAX_RETRIES) {
            this._loadedCount++;
            this._onProgress?.(this._loadedCount, this._totalCount);
          }
        }
      }
    };
    // Sequential batches: wait for each batch before starting the next
    const spriteLoadAll = async () => {
      for (let i = 0; i < names.length; i += BATCH_SIZE) {
        const batch = names.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(loadSprite));
      }
    };
    const spritePromises = [spriteLoadAll()];

    // Load palette, tileset, remap colors, and ALL sprites in parallel
    await Promise.all([
      // Palette (optional)
      fetch(`${BASE_URL}/palette.json${cacheBust}`)
        .then(r => r.json())
        .then(p => { this.palette = p; })
        .catch(() => {}),
      // Per-theatre palettes (SNOW, INTERIOR)
      ...[
        { theatre: 'SNOW', file: 'snow-palette.json' },
        { theatre: 'INTERIOR', file: 'interior-palette.json' },
      ].map(({ theatre, file }) =>
        fetch(`${BASE_URL}/${file}${cacheBust}`)
          .then(r => r.ok ? r.json() : null)
          .then(p => { if (p) this.theatrePalettes.set(theatre, p); })
          .catch(() => {})
      ),
      // House color remap data (optional — falls back to tint overlay)
      this.loadRemapColors(cacheBust),
      // Bitmap fonts (C++ 6POINT.FNT / GRAD6FNT.FNT / 8POINT.FNT / 12METFNT.FNT — optional, falls back to ctx.fillText)
      ...['6point-font', 'grad6-font', '8point-font', 'metal12-font'].map(name =>
        Promise.all([
          fetch(`${BASE_URL}/${name}.json${cacheBust}`).then(r => r.ok ? r.json() : null).catch(() => null),
          loadImage(`${BASE_URL}/${name}.png${cacheBust}`).catch(() => null),
        ]).then(([meta, img]) => {
          if (meta && img) {
            this.fonts.set(name.replace('-font', ''), new BitmapFont(img, meta as BitmapFontMeta));
          }
        })
      ),
      // Tileset atlases (optional — renderer falls back to procedural colors)
      // Load TEMPERATE (backwards compat filenames) + SNOW + INTERIOR
      ...[
        { theatre: 'TEMPERATE', prefix: '' },
        { theatre: 'SNOW', prefix: 'snow_' },
        { theatre: 'INTERIOR', prefix: 'interior_' },
      ].map(({ theatre, prefix }) =>
        Promise.all([
          fetch(`${BASE_URL}/${prefix}tileset.json${cacheBust}`).then(r => r.ok ? r.json() : null),
          loadImage(`${BASE_URL}/${prefix}tileset.png${cacheBust}`).catch(() => null),
        ]).then(([meta, img]) => {
          if (meta && img) {
            this.tilesets.set(theatre, { image: img, meta: meta as TilesetMeta });
            // Backwards compat: set legacy fields for TEMPERATE
            if (theatre === 'TEMPERATE') {
              this.tilesetMeta = meta as TilesetMeta;
              this.tilesetImage = img;
            }
          }
        }).catch(() => {})
      ),
      // All sprite sheets
      ...spritePromises,
    ]);

    this.loaded = true;
  }

  /** Resolve a sprite name through the alias table. Returns the direct name if no alias. */
  private resolveName(name: string): string {
    if (this.sheets.has(name)) return name;
    const alias = SPRITE_ALIASES[name];
    return alias ?? name;
  }

  /** Get a loaded sprite sheet by name. Supports aliases for historical C++ sprite names
   *  that differ from the extracted asset filenames (e.g. water-exp1 → h2o_exp1). */
  getSheet(name: string): SpriteSheet | undefined {
    const direct = this.sheets.get(name);
    if (direct) return direct;
    const alias = SPRITE_ALIASES[name];
    if (alias) return this.sheets.get(alias);
    return undefined;
  }

  /** Get the palette */
  getPalette(): number[][] | null {
    return this.palette;
  }

  /** Get the palette for a specific theatre (falls back to default TEMPERATE palette) */
  getTheatrePalette(theatre: string): number[][] | null {
    return this.theatrePalettes.get(theatre) ?? this.palette;
  }

  /** Internal: draw a frame from any CanvasImageSource using sheet metadata */
  private drawFrameInternal(
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    meta: SpriteSheetMeta,
    frameIndex: number,
    x: number,
    y: number,
    options?: DrawFrameOptions,
  ): void {
    const col = frameIndex % meta.columns;
    const row = Math.floor(frameIndex / meta.columns);
    const sx = col * meta.frameWidth;
    const sy = row * meta.frameHeight;
    let dx = Math.round(x);
    let dy = Math.round(y);
    const scale = options?.scale ?? 1;
    const dw = meta.frameWidth * scale;
    const dh = meta.frameHeight * scale;
    if (options?.centerX) dx -= Math.floor(dw / 2);
    if (options?.centerY) dy -= Math.floor(dh / 2);
    const rotation256 = options?.rotation256 ?? 0;
    if (rotation256 === 0 &&
        options?.ghostShadow &&
        this.drawFrameWithGhostShadow(ctx, source, meta, frameIndex, dx, dy, options)) {
      return;
    }
    if (rotation256 !== 0 && !options?.flip) {
      const originX = options?.centerX ? Math.floor(dw / 2) : 0;
      const originY = options?.centerY ? Math.floor(dh / 2) : 0;
      ctx.save();
      ctx.translate(dx + originX, dy + originY);
      ctx.rotate((rotation256 * Math.PI * 2) / 256);
      ctx.drawImage(source, sx, sy, meta.frameWidth, meta.frameHeight, -originX, -originY, dw, dh);
      ctx.restore();
    } else if (options?.flip) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(source, sx, sy, meta.frameWidth, meta.frameHeight, -dx - dw, dy, dw, dh);
      ctx.restore();
    } else {
      ctx.drawImage(source, sx, sy, meta.frameWidth, meta.frameHeight, dx, dy, dw, dh);
    }
  }

  private getSourcePixels(source: CanvasImageSource): {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  } | null {
    const key = source as object;
    const cached = this.sourcePixelCache.get(key);
    if (cached) return cached;

    const sized = source as CanvasImageSource & {
      naturalWidth?: number; naturalHeight?: number;
      width?: number; height?: number;
    };
    const width = sized.naturalWidth || Number(sized.width) || 0;
    const height = sized.naturalHeight || Number(sized.height) || 0;
    if (width <= 0 || height <= 0 || typeof document === 'undefined') return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const cctx = canvas.getContext('2d');
    if (!cctx) return null;
    cctx.imageSmoothingEnabled = false;
    cctx.drawImage(source, 0, 0);
    const image = cctx.getImageData(0, 0, width, height);
    const pixels = { width, height, data: image.data };
    this.sourcePixelCache.set(key, pixels);
    return pixels;
  }

  private getFadingTable(palette: number[][], destColorIndex: number, frac: number): Uint8Array {
    const key = palette as object;
    let tables = this.fadingTableCache.get(key);
    if (!tables) {
      tables = new Map<string, Uint8Array>();
      this.fadingTableCache.set(key, tables);
    }
    const tableKey = `${destColorIndex}:${frac}`;
    const cached = tables.get(tableKey);
    if (cached) return cached;
    const table = conquerBuildFadingTable(palette, destColorIndex, frac);
    tables.set(tableKey, table);
    return table;
  }

  private getBuildFadingTable(palette: number[][], destColorIndex: number, frac: number): Uint8Array {
    const key = palette as object;
    let tables = this.fadingTableCache.get(key);
    if (!tables) {
      tables = new Map<string, Uint8Array>();
      this.fadingTableCache.set(key, tables);
    }
    const tableKey = `build:${destColorIndex}:${frac}`;
    const cached = tables.get(tableKey);
    if (cached) return cached;
    const table = makeFadingTable(palette, destColorIndex, frac);
    tables.set(tableKey, table);
    return table;
  }

  private drawFrameWithGhostShadow(
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    meta: SpriteSheetMeta,
    frameIndex: number,
    dx: number,
    dy: number,
    options: DrawFrameOptions,
  ): boolean {
    const ghost = options.ghostShadow;
    if (!ghost?.palette || options.flip || (options.scale ?? 1) !== 1) return false;
    if (!ctx.getImageData || !ctx.putImageData || !ctx.canvas) return false;

    const src = this.getSourcePixels(source);
    if (!src) return false;

    const destX = Math.round(dx);
    const destY = Math.round(dy);
    const clipX0 = Math.max(0, destX);
    const clipY0 = Math.max(0, destY);
    const clipX1 = Math.min(ctx.canvas.width, destX + meta.frameWidth);
    const clipY1 = Math.min(ctx.canvas.height, destY + meta.frameHeight);
    const clipW = clipX1 - clipX0;
    const clipH = clipY1 - clipY0;
    if (clipW <= 0 || clipH <= 0) return true;

    const col = frameIndex % meta.columns;
    const row = Math.floor(frameIndex / meta.columns);
    const sx = col * meta.frameWidth;
    const sy = row * meta.frameHeight;
    const dest = ctx.getImageData(clipX0, clipY0, clipW, clipH);
    const table = this.getFadingTable(ghost.palette, ghost.destColorIndex ?? RA_COLOR_BLACK, ghost.frac);
    const globalAlpha = Math.max(0, Math.min(1, ctx.globalAlpha ?? 1));

    for (let y = 0; y < clipH; y++) {
      const frameY = clipY0 - destY + y;
      for (let x = 0; x < clipW; x++) {
        const frameX = clipX0 - destX + x;
        const srcOff = ((sy + frameY) * src.width + (sx + frameX)) * 4;
        const sr = src.data[srcOff];
        const sg = src.data[srcOff + 1];
        const sb = src.data[srcOff + 2];
        const sa = src.data[srcOff + 3];
        if (sa === 0) continue;

        const destOff = (y * clipW + x) * 4;
        if (sa === 130) {
          const dstIndex = nearestPaletteIndex(
            ghost.palette,
            dest.data[destOff],
            dest.data[destOff + 1],
            dest.data[destOff + 2],
          );
          const shadow = ghost.palette[table[dstIndex]];
          if (!shadow) continue;
          dest.data[destOff] = shadow[0];
          dest.data[destOff + 1] = shadow[1];
          dest.data[destOff + 2] = shadow[2];
          dest.data[destOff + 3] = 255;
          continue;
        }

        const alpha = (sa / 255) * globalAlpha;
        if (alpha >= 1) {
          dest.data[destOff] = sr;
          dest.data[destOff + 1] = sg;
          dest.data[destOff + 2] = sb;
          dest.data[destOff + 3] = 255;
        } else {
          const inv = 1 - alpha;
          dest.data[destOff] = Math.round(sr * alpha + dest.data[destOff] * inv);
          dest.data[destOff + 1] = Math.round(sg * alpha + dest.data[destOff + 1] * inv);
          dest.data[destOff + 2] = Math.round(sb * alpha + dest.data[destOff + 2] * inv);
          dest.data[destOff + 3] = Math.round(255 * alpha + dest.data[destOff + 3] * inv);
        }
      }
    }

    ctx.putImageData(dest, clipX0, clipY0);
    return true;
  }

  /** Draw a shape through C++ DisplayClass::SpecialGhost.
   *
   * RA/conquer.cpp converts SHAPE_FADING|SHAPE_PREDATOR into SHAPE_GHOST with
   * DisplayClass::SpecialGhost. display.cpp builds that ghost table with every
   * source color active and a BLACK,100 fading table, so the source frame is a
   * mask that darkens the already-rendered destination pixels. */
  drawFrameSpecialGhost(
    ctx: CanvasRenderingContext2D,
    sheetName: string,
    frameIndex: number,
    x: number,
    y: number,
    palette: number[][] | null,
    options?: DrawFrameOptions,
  ): void {
    if (!palette || !ctx.getImageData || !ctx.putImageData || !ctx.canvas) {
      this.drawFrame(ctx, sheetName, frameIndex, x, y, options);
      return;
    }

    const sheet = this.getSheet(sheetName);
    if (!sheet) {
      this.drawMissingAsset(ctx, sheetName, x, y, options);
      return;
    }
    const src = this.getSourcePixels(sheet.image);
    if (!src) {
      this.drawFrame(ctx, sheetName, frameIndex, x, y, options);
      return;
    }

    const meta = sheet.meta;
    const scale = options?.scale ?? 1;
    if (options?.flip || scale !== 1) {
      this.drawFrame(ctx, sheetName, frameIndex, x, y, options);
      return;
    }

    let destX = Math.round(x);
    let destY = Math.round(y);
    if (options?.centerX) destX -= Math.floor(meta.frameWidth / 2);
    if (options?.centerY) destY -= Math.floor(meta.frameHeight / 2);

    const clipX0 = Math.max(0, destX);
    const clipY0 = Math.max(0, destY);
    const clipX1 = Math.min(ctx.canvas.width, destX + meta.frameWidth);
    const clipY1 = Math.min(ctx.canvas.height, destY + meta.frameHeight);
    const clipW = clipX1 - clipX0;
    const clipH = clipY1 - clipY0;
    if (clipW <= 0 || clipH <= 0) return;

    const col = frameIndex % meta.columns;
    const row = Math.floor(frameIndex / meta.columns);
    const sx = col * meta.frameWidth;
    const sy = row * meta.frameHeight;
    const dest = ctx.getImageData(clipX0, clipY0, clipW, clipH);
    const table = this.getFadingTable(palette, RA_COLOR_BLACK, 100);

    for (let py = 0; py < clipH; py++) {
      const frameY = clipY0 - destY + py;
      for (let px = 0; px < clipW; px++) {
        const frameX = clipX0 - destX + px;
        const srcOff = ((sy + frameY) * src.width + (sx + frameX)) * 4;
        if (src.data[srcOff + 3] === 0) continue;

        const destOff = (py * clipW + px) * 4;
        const dstIndex = nearestPaletteIndex(
          palette,
          dest.data[destOff],
          dest.data[destOff + 1],
          dest.data[destOff + 2],
        );
        const ghost = palette[table[dstIndex]];
        if (!ghost) continue;
        dest.data[destOff] = ghost[0];
        dest.data[destOff + 1] = ghost[1];
        dest.data[destOff + 2] = ghost[2];
        dest.data[destOff + 3] = 255;
      }
    }

    ctx.putImageData(dest, clipX0, clipY0);
  }

  /** Draw a shape through C++ SHAPE_GHOST + DisplayClass::TranslucentTable.
   *
   * Build_Translucent_Table stores a 256-byte source-control map followed by
   * one Build_Fading_Table row per translucent source color. If a source pixel
   * is listed in the control map, C++ remaps the already-rendered destination
   * pixel through that row; otherwise it draws the source pixel normally. */
  drawFrameTranslucent(
    ctx: CanvasRenderingContext2D,
    sheetName: string,
    frameIndex: number,
    x: number,
    y: number,
    palette: number[][] | null,
    controls: readonly TranslucentControl[],
    options?: DrawFrameOptions,
  ): void {
    if (!palette || controls.length === 0 || !ctx.getImageData || !ctx.putImageData || !ctx.canvas) {
      this.drawFrame(ctx, sheetName, frameIndex, x, y, options);
      return;
    }

    const sheet = this.getSheet(sheetName);
    if (!sheet) {
      this.drawMissingAsset(ctx, sheetName, x, y, options);
      return;
    }
    const src = this.getSourcePixels(sheet.image);
    if (!src) {
      this.drawFrame(ctx, sheetName, frameIndex, x, y, options);
      return;
    }

    const meta = sheet.meta;
    const scale = options?.scale ?? 1;
    if (options?.flip || scale !== 1) {
      this.drawFrame(ctx, sheetName, frameIndex, x, y, options);
      return;
    }

    let destX = Math.round(x);
    let destY = Math.round(y);
    if (options?.centerX) destX -= Math.floor(meta.frameWidth / 2);
    if (options?.centerY) destY -= Math.floor(meta.frameHeight / 2);

    const clipX0 = Math.max(0, destX);
    const clipY0 = Math.max(0, destY);
    const clipX1 = Math.min(ctx.canvas.width, destX + meta.frameWidth);
    const clipY1 = Math.min(ctx.canvas.height, destY + meta.frameHeight);
    const clipW = clipX1 - clipX0;
    const clipH = clipY1 - clipY0;
    if (clipW <= 0 || clipH <= 0) return;

    const controlBySource = new Map<number, TranslucentControl>();
    for (const control of controls) controlBySource.set(control.sourceColorIndex, control);

    const col = frameIndex % meta.columns;
    const row = Math.floor(frameIndex / meta.columns);
    const sx = col * meta.frameWidth;
    const sy = row * meta.frameHeight;
    const dest = ctx.getImageData(clipX0, clipY0, clipW, clipH);
    const globalAlpha = Math.max(0, Math.min(1, ctx.globalAlpha ?? 1));

    for (let py = 0; py < clipH; py++) {
      const frameY = clipY0 - destY + py;
      for (let px = 0; px < clipW; px++) {
        const frameX = clipX0 - destX + px;
        const srcOff = ((sy + frameY) * src.width + (sx + frameX)) * 4;
        const sa = src.data[srcOff + 3];
        if (sa === 0) continue;

        const sr = src.data[srcOff];
        const sg = src.data[srcOff + 1];
        const sb = src.data[srcOff + 2];
        const destOff = (py * clipW + px) * 4;
        const srcIndex = nearestPaletteIndex(palette, sr, sg, sb);
        const control = controlBySource.get(srcIndex);

        if (control) {
          const dstIndex = nearestPaletteIndex(
            palette,
            dest.data[destOff],
            dest.data[destOff + 1],
            dest.data[destOff + 2],
          );
          const table = options?.conquerFading
            ? this.getFadingTable(palette, control.destColorIndex, control.frac)
            : this.getBuildFadingTable(palette, control.destColorIndex, control.frac);
          const remapped = palette[table[dstIndex]];
          if (!remapped) continue;
          dest.data[destOff] = remapped[0];
          dest.data[destOff + 1] = remapped[1];
          dest.data[destOff + 2] = remapped[2];
          dest.data[destOff + 3] = 255;
          continue;
        }

        const alpha = (sa / 255) * globalAlpha;
        if (alpha >= 1) {
          dest.data[destOff] = sr;
          dest.data[destOff + 1] = sg;
          dest.data[destOff + 2] = sb;
          dest.data[destOff + 3] = 255;
        } else {
          const inv = 1 - alpha;
          dest.data[destOff] = Math.round(sr * alpha + dest.data[destOff] * inv);
          dest.data[destOff + 1] = Math.round(sg * alpha + dest.data[destOff + 1] * inv);
          dest.data[destOff + 2] = Math.round(sb * alpha + dest.data[destOff + 2] * inv);
          dest.data[destOff + 3] = Math.round(255 * alpha + dest.data[destOff + 3] * inv);
        }
      }
    }

    ctx.putImageData(dest, clipX0, clipY0);
  }

  /** Draw a single frame from a sprite sheet onto a canvas context */
  drawFrame(
    ctx: CanvasRenderingContext2D,
    sheetName: string,
    frameIndex: number,
    x: number,
    y: number,
    options?: DrawFrameOptions,
  ): void {
    const resolved = this.resolveName(sheetName);
    const sheet = this.sheets.get(resolved);
    if (!sheet) {
      this.drawMissingAsset(ctx, sheetName, x, y, options);
      return;
    }
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
    options?: DrawFrameOptions,
  ): void {
    const sheet = this.sheets.get(this.resolveName(sheetName));
    if (!sheet) {
      this.drawMissingAsset(ctx, sheetName, x, y, options);
      return;
    }
    this.drawFrameInternal(ctx, sourceCanvas, sheet.meta, frameIndex, x, y, options);
  }

  /** Draw a bright magenta/black checkerboard for missing assets — makes it impossible to miss.
   *  Classic game dev "missing texture" pattern. Also logs a warning on first occurrence. */
  private missingAssetWarned = new Set<string>();
  private drawMissingAsset(
    ctx: CanvasRenderingContext2D,
    sheetName: string,
    x: number,
    y: number,
    options?: DrawFrameOptions,
  ): void {
    if (!ctx) return; // null context in tests — skip drawing
    const size = 24; // CELL_SIZE — one cell square
    const scale = options?.scale ?? 1;
    const w = size * scale;
    const h = size * scale;
    const dx = options?.centerX ? x - w / 2 : x;
    const dy = options?.centerY ? y - h / 2 : y;

    // Magenta/black 4x4 checkerboard
    const checkSize = w / 4;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? '#FF00FF' : '#000000';
        ctx.fillRect(dx + col * checkSize, dy + row * checkSize, checkSize, checkSize);
      }
    }

    // Label with the missing asset name
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `${Math.max(7, Math.floor(w / 4))}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(sheetName, dx + w / 2, dy + h / 2 + 3);
    ctx.textAlign = 'left'; // reset

    if (!this.missingAssetWarned.has(sheetName)) {
      this.missingAssetWarned.add(sheetName);
      console.warn(`[AssetManager] MISSING ASSET: "${sheetName}" — rendering magenta placeholder`);
    }
  }

  /** Check if a sprite sheet exists (alias-aware) */
  hasSheet(name: string): boolean {
    if (this.sheets.has(name)) return true;
    const alias = SPRITE_ALIASES[name];
    return alias ? this.sheets.has(alias) : false;
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
    // Turn all pixels dark gray while preserving alpha (SHAPE_GHOST effect)
    // Dark gray (not black) so 'multiply' blend darkens terrain proportionally
    // rather than zeroing it out — matches C++ palette-index shadow behavior
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = 'rgb(100,100,100)';
    sctx.fillRect(0, 0, canvas.width, canvas.height);
    sctx.globalCompositeOperation = 'source-over'; // Reset to default
    this.shadowSheets.set(sheetName, canvas);
    return canvas;
  }

  /** Get a bitmap font by name ('6point', '8point', or 'metal12'). Returns null if not loaded. */
  getFont(name: string): BitmapFont | null {
    return this.fonts.get(name) ?? null;
  }

  // === House color remap cache ===
  private remapData: { source: number[][]; houses: Record<string, number[][]> } | null = null;
  private remappedSheets = new Map<string, HTMLCanvasElement>();

  /** Load remap color data (called during loadAll) */
  private async loadRemapColors(cacheBust = ''): Promise<void> {
    try {
      const res = await fetch(`${BASE_URL}/remap-colors.json${cacheBust}`);
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
    // Scan pixels and remap matching source colors → house colors.
    // C++ house.cpp:2312 does palette-index remapping — we match RGB exactly because
    // our source colors come from the same palette.json that generated the PNGs.
    // Exact match avoids swapping adjacent gradient shades (old ±2 tolerance risked
    // e.g. source[7]=(146,117,65) ↔ source[8]=(134,113,56), which differ by 12 in R).
    // O(1) lookup via packed RGB→house color map.
    const lut = new Map<number, [number, number, number]>();
    for (let c = 0; c < srcColors.length; c++) {
      const key = (srcColors[c][0] << 16) | (srcColors[c][1] << 8) | srcColors[c][2];
      lut.set(key, [houseColors[c][0], houseColors[c][1], houseColors[c][2]]);
    }
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] === 0) continue; // skip transparent
      const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
      const hc = lut.get(key);
      if (hc !== undefined) {
        pixels[i] = hc[0];
        pixels[i + 1] = hc[1];
        pixels[i + 2] = hc[2];
      }
    }
    rctx.putImageData(imgData, 0, 0);
    this.remappedSheets.set(key, canvas);
    return canvas;
  }

  /** Get tileset atlas image (null if not loaded). Defaults to TEMPERATE. */
  getTilesetImage(theatre?: string): HTMLImageElement | null {
    if (theatre) {
      return this.tilesets.get(theatre)?.image ?? null;
    }
    return this.tilesetImage;
  }

  /** Set tileset metadata for a theatre (used by headless test adapters). */
  setTilesetMeta(theatre: string, meta: TilesetMeta): void {
    this.tilesets.set(theatre, { image: null as unknown as HTMLImageElement, meta });
  }

  /** Get tileset metadata (null if not loaded). Defaults to TEMPERATE. */
  getTilesetMeta(theatre?: string): TilesetMeta | null {
    if (theatre) {
      return this.tilesets.get(theatre)?.meta ?? null;
    }
    return this.tilesetMeta;
  }

  /** Check if tileset is available for a given theatre. Defaults to TEMPERATE. */
  hasTileset(theatre?: string): boolean {
    if (theatre) {
      return this.tilesets.has(theatre);
    }
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
