/**
 * Bitmap font renderer — renders text using extracted Westwood FNT glyph atlases.
 * Matches C++ Fancy_Text_Print / Buffer_Print from SDLLIB/drawbuff.cpp.
 *
 * Usage:
 *   const font = new BitmapFont(atlasImage, metadata);
 *   font.drawText(ctx, 'HELLO', 100, 50, '#FFD700');
 */

export interface BitmapFontMeta {
  maxWidth: number;
  maxHeight: number;
  atlasWidth: number;
  atlasHeight: number;
  cellWidth: number;
  cellHeight: number;
  glyphs: Record<string, { ax: number; ay: number; w: number; h: number; topBlank: number }>;
}

export interface BitmapFontDrawOptions {
  align?: 'left' | 'center' | 'right';
  shadow?: string;
  fullShadow?: string;
  scale?: number;
  gradient?: readonly string[];
  indexedPalette?: readonly string[];
  letterSpacing?: number;
}

function parseCssColor(color: string): [number, number, number, number] {
  const hex = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
      255,
    ];
  }
  return [255, 255, 255, 255];
}

export class BitmapFont {
  private atlas: HTMLImageElement;
  private meta: BitmapFontMeta;
  /** Per-color tinted atlas cache (avoid re-tinting every frame) */
  private tintCache = new Map<string, HTMLCanvasElement>();

  constructor(atlas: HTMLImageElement, meta: BitmapFontMeta) {
    this.atlas = atlas;
    this.meta = meta;
  }

  /** Get or create a tinted version of the atlas for the given color.
   *  The extracted atlas is white-on-transparent. We tint it by drawing
   *  the color over the atlas using 'source-atop' composite. */
  private getTintedAtlas(
    color: string,
    gradient?: readonly string[],
    indexedPalette?: readonly string[],
  ): HTMLCanvasElement {
    const key = indexedPalette?.length
      ? `indexed:${indexedPalette.join('|')}:${color}`
      : gradient?.length ? `gradient:${gradient.join('|')}` : color;
    const cached = this.tintCache.get(key);
    if (cached) return cached;

    const c = document.createElement('canvas');
    c.width = this.meta.atlasWidth;
    c.height = this.meta.atlasHeight;
    const ctx = c.getContext('2d')!;

    // Draw white atlas
    ctx.drawImage(this.atlas, 0, 0);

    if (indexedPalette?.length) {
      const img = ctx.getImageData(0, 0, c.width, c.height);
      const data = img.data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        const sourceIndex = Math.max(1, Math.min(15, Math.round(data[i] / 17)));
        const [r, g, b, a] = parseCssColor(indexedPalette[sourceIndex] ?? color);
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = a;
      }
      ctx.putImageData(img, 0, 0);
    } else {
      // Tint: fill with color only where atlas has pixels.
      ctx.globalCompositeOperation = 'source-atop';
      if (gradient?.length) {
        for (let row = 0; row < c.height; row++) {
          const rowInCell = row % this.meta.cellHeight;
          const rampIndex = Math.min(
            gradient.length - 1,
            Math.floor(rowInCell * gradient.length / this.meta.cellHeight),
          );
          ctx.fillStyle = gradient[rampIndex];
          ctx.fillRect(0, row, c.width, 1);
        }
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, c.width, c.height);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    this.tintCache.set(key, c);
    return c;
  }

  /** Measure text width in pixels (matches C++ String_Pixel_Width) */
  measureText(text: string, letterSpacing = 0): number {
    let width = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const g = this.meta.glyphs[code];
      if (g) width += g.w + letterSpacing;
      else width += this.meta.maxWidth + letterSpacing; // unknown char fallback
    }
    return width;
  }

  /** Draw text at (x, y) with the given foreground color.
   *  Options:
   *    align: 'left' (default) | 'center' | 'right'
   *    shadow: color string for 1px drop shadow (C++ TPF_DROPSHADOW)
   *    fullShadow: color string for outline shadow (C++ TPF_FULLSHADOW)
   *    scale: integer multiplier (default 1) */
  drawText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    color: string,
    options?: BitmapFontDrawOptions,
  ): void {
    const align = options?.align ?? 'left';
    const shadow = options?.shadow;
    const scale = options?.scale ?? 1;
    const letterSpacing = options?.letterSpacing ?? 0;

    const textWidth = this.measureText(text, letterSpacing) * scale;
    let drawX = x;
    if (align === 'center') drawX = x - textWidth / 2;
    else if (align === 'right') drawX = x - textWidth;

    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;

    if (options?.fullShadow) {
      const shadowOffsets = [
        [-1, -1], [0, -1], [1, -1],
        [-1, 0],           [1, 0],
        [-1, 1],  [0, 1],  [1, 1],
      ] as const;
      for (const [dx, dy] of shadowOffsets) {
        this.blitText(ctx, text, drawX + dx * scale, y + dy * scale, options.fullShadow, scale, undefined, undefined, letterSpacing);
      }
    }

    // Draw shadow first (1px offset down-right)
    if (shadow) {
      this.blitText(ctx, text, drawX + scale, y + scale, shadow, scale, undefined, undefined, letterSpacing);
    }

    // Draw foreground
    this.blitText(ctx, text, drawX, y, color, scale, options?.gradient, options?.indexedPalette, letterSpacing);

    ctx.imageSmoothingEnabled = prevSmooth;
  }

  /** Internal: blit each glyph character from the tinted atlas */
  private blitText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    color: string,
    scale: number,
    gradient?: readonly string[],
    indexedPalette?: readonly string[],
    letterSpacing = 0,
  ): void {
    const tinted = this.getTintedAtlas(color, gradient, indexedPalette);
    let cx = Math.round(x);

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const g = this.meta.glyphs[code];
      if (!g) {
        cx += (this.meta.maxWidth + letterSpacing) * scale;
        continue;
      }

      // Draw glyph from tinted atlas
      ctx.drawImage(
        tinted,
        g.ax, g.ay, // source position in atlas
        g.w, this.meta.cellHeight, // source size (full cell height for proper vertical positioning)
        cx, Math.round(y), // destination
        g.w * scale, this.meta.cellHeight * scale, // destination size
      );

      cx += (g.w + letterSpacing) * scale;
    }
  }
}
