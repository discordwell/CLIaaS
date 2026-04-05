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
  private getTintedAtlas(color: string): HTMLCanvasElement {
    const cached = this.tintCache.get(color);
    if (cached) return cached;

    const c = document.createElement('canvas');
    c.width = this.meta.atlasWidth;
    c.height = this.meta.atlasHeight;
    const ctx = c.getContext('2d')!;

    // Draw white atlas
    ctx.drawImage(this.atlas, 0, 0);

    // Tint: fill with color only where atlas has pixels
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'source-over';

    this.tintCache.set(color, c);
    return c;
  }

  /** Measure text width in pixels (matches C++ String_Pixel_Width) */
  measureText(text: string): number {
    let width = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const g = this.meta.glyphs[code];
      if (g) width += g.w;
      else width += this.meta.maxWidth; // unknown char fallback
    }
    return width;
  }

  /** Draw text at (x, y) with the given foreground color.
   *  Options:
   *    align: 'left' (default) | 'center' | 'right'
   *    shadow: color string for 1px drop shadow (C++ TPF_DROPSHADOW)
   *    scale: integer multiplier (default 1) */
  drawText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    color: string,
    options?: { align?: 'left' | 'center' | 'right'; shadow?: string; scale?: number },
  ): void {
    const align = options?.align ?? 'left';
    const shadow = options?.shadow;
    const scale = options?.scale ?? 1;

    const textWidth = this.measureText(text) * scale;
    let drawX = x;
    if (align === 'center') drawX = x - textWidth / 2;
    else if (align === 'right') drawX = x - textWidth;

    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;

    // Draw shadow first (1px offset down-right)
    if (shadow) {
      this.blitText(ctx, text, drawX + scale, y + scale, shadow, scale);
    }

    // Draw foreground
    this.blitText(ctx, text, drawX, y, color, scale);

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
  ): void {
    const tinted = this.getTintedAtlas(color);
    let cx = Math.round(x);

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const g = this.meta.glyphs[code];
      if (!g) {
        cx += this.meta.maxWidth * scale;
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

      cx += g.w * scale;
    }
  }
}
