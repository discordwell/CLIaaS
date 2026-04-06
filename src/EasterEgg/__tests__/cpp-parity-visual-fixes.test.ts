/**
 * C++ parity tests — 4 visual parity fixes:
 * 1. War Factory Door Tracking (WEAP2 overlay, building.cpp Door_Stage())
 * 2. Tesla LITNING.SHP Sprites (renderer uses litning.png when available)
 * 3. Parachute Bomb Visual (parabomb.png sprite during descent)
 * 4. Iron Curtain FadingRed Palette (IronCurtain remap in remap-colors.json)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// ── Fix 1: War Factory Door Tracking ────────────────────────────────────────

describe('War Factory door tracking — C++ building.cpp Door_Stage()', () => {
  it('MapStructure interface includes optional doorFrame field', async () => {
    const scenarioSrc = readFileSync(
      join(__dirname, '../engine/scenario.ts'), 'utf-8'
    );
    // The doorFrame field should exist in the MapStructure interface
    expect(scenarioSrc).toContain('doorFrame?: number');
  });

  it('renderer uses s.doorFrame instead of hardcoded 0 for WEAP2 overlay', async () => {
    const rendererSrc = readFileSync(
      join(__dirname, '../engine/renderer.ts'), 'utf-8'
    );
    // Should NOT contain the old hardcoded doorFrame = 0 TODO
    expect(rendererSrc).not.toContain('const doorFrame = 0; // TODO');
    // Should reference s.doorFrame for the door animation state
    expect(rendererSrc).toContain('s.doorFrame');
    // Should check sidebarQueue for 'unit' production to drive door state
    expect(rendererSrc).toContain("sidebarQueue.has('unit')");
  });

  it('door frame range is 0 (closed) to 7 (open) matching C++ WEAP2.SHP 8 frames', async () => {
    const rendererSrc = readFileSync(
      join(__dirname, '../engine/renderer.ts'), 'utf-8'
    );
    // C++ building.cpp Door_Stage() returns 0-7
    // Check that the code clamps to valid range
    expect(rendererSrc).toContain('Math.min(7,');
    expect(rendererSrc).toContain('Math.max(0,');
  });
});

// ── Fix 2: Tesla LITNING.SHP Sprites ────────────────────────────────────────

describe('Tesla LITNING.SHP — C++ uses litning.png for tesla coil zap', () => {
  it('litning.png is in the asset manifest with 8 frames (24x24)', () => {
    const manifest = JSON.parse(readFileSync(
      join(__dirname, '../../..', 'public/ra/assets/manifest.json'), 'utf-8'
    ));
    expect(manifest.litning).toBeDefined();
    expect(manifest.litning.frameCount).toBe(8);
    expect(manifest.litning.frameWidth).toBe(24);
    expect(manifest.litning.frameHeight).toBe(24);
  });

  it('renderer tesla case checks for litning sprite sheet', async () => {
    const rendererSrc = readFileSync(
      join(__dirname, '../engine/renderer.ts'), 'utf-8'
    );
    // Should attempt to load litning sprite sheet
    expect(rendererSrc).toContain("assets.getSheet('litning')");
    // Should use additive blend for tesla sprites (C++ SHAPE_GHOST)
    expect(rendererSrc).toContain("'lighter'");
    // Should still have procedural fallback
    expect(rendererSrc).toContain('Procedural fallback');
  });

  it('tesla case draws litning frames along beam path when sprite available', async () => {
    const rendererSrc = readFileSync(
      join(__dirname, '../engine/renderer.ts'), 'utf-8'
    );
    // Should draw litning frames at intervals along the beam
    expect(rendererSrc).toContain("assets.drawFrame(ctx, 'litning'");
  });
});

// ── Fix 3: Parachute Bomb Visual ────────────────────────────────────────────

describe('Parachute bomb visual — C++ bullet.cpp:573,796 ANIM_PARA_BOMB', () => {
  it('parabomb.png is in the asset manifest with 13 frames (15x15)', () => {
    const manifest = JSON.parse(readFileSync(
      join(__dirname, '../../..', 'public/ra/assets/manifest.json'), 'utf-8'
    ));
    expect(manifest.parabomb).toBeDefined();
    expect(manifest.parabomb.frameCount).toBe(13);
    expect(manifest.parabomb.frameWidth).toBe(15);
    expect(manifest.parabomb.frameHeight).toBe(15);
  });

  it('Effect interface includes isParachuted flag', async () => {
    const rendererSrc = readFileSync(
      join(__dirname, '../engine/renderer.ts'), 'utf-8'
    );
    expect(rendererSrc).toContain('isParachuted?: boolean');
  });

  it('projectile renderer checks isParachuted and draws parabomb sprite', async () => {
    const rendererSrc = readFileSync(
      join(__dirname, '../engine/renderer.ts'), 'utf-8'
    );
    // Should check fx.isParachuted
    expect(rendererSrc).toContain('fx.isParachuted');
    // Should draw parabomb sprite
    expect(rendererSrc).toContain("assets.getSheet('parabomb')");
    expect(rendererSrc).toContain("assets.drawFrame(ctx, 'parabomb'");
  });

  it('superweapon parabomb activation creates falling projectile effects with isParachuted', async () => {
    const swSrc = readFileSync(
      join(__dirname, '../engine/superweapon.ts'), 'utf-8'
    );
    // Should push projectile effects with isParachuted flag
    expect(swSrc).toContain('isParachuted: true');
    // Should still create explosion effects after descent
    expect(swSrc).toContain("type: 'explosion'");
  });
});

// ── Fix 4: Iron Curtain FadingRed Palette ───────────────────────────────────

describe('Iron Curtain FadingRed palette — C++ techno.cpp:4276 DisplayClass::FadingRed', () => {
  it('remap-colors.json includes IronCurtain house entry with 16 red gradient shades', () => {
    const remapColors = JSON.parse(readFileSync(
      join(__dirname, '../../..', 'public/ra/assets/remap-colors.json'), 'utf-8'
    ));
    expect(remapColors.houses.IronCurtain).toBeDefined();
    const ic = remapColors.houses.IronCurtain;
    expect(ic).toHaveLength(16);
    // All entries should be predominantly red (R >> G, R >> B)
    for (const [r, g, b] of ic) {
      expect(r).toBeGreaterThan(g); // red channel dominates
      expect(r).toBeGreaterThan(b); // red channel dominates
    }
    // Should be a gradient: first entry brightest, last darkest
    expect(ic[0][0]).toBeGreaterThan(ic[15][0]);
  });

  it('renderer uses IronCurtain remap via getRemappedSheet for iron-curtained units', async () => {
    const rendererSrc = readFileSync(
      join(__dirname, '../engine/renderer.ts'), 'utf-8'
    );
    // Should use getRemappedSheet with 'IronCurtain' key
    expect(rendererSrc).toContain("'IronCurtain'");
    expect(rendererSrc).toContain("getRemappedSheet(entity.stats.image, 'IronCurtain')");
    // Should use drawFrameFrom to overdraw with red remap
    expect(rendererSrc).toContain('drawFrameFrom(ctx, icRemapped');
  });

  it('renderer retains fallback multiply blend when IronCurtain remap unavailable', async () => {
    const rendererSrc = readFileSync(
      join(__dirname, '../engine/renderer.ts'), 'utf-8'
    );
    // Should have fallback path
    expect(rendererSrc).toContain("Fallback: multiply blend overlay if IronCurtain remap not available");
    expect(rendererSrc).toContain("ctx.globalCompositeOperation = 'multiply'");
  });

  it('IronCurtain remap covers the full 16-entry source palette', () => {
    const remapColors = JSON.parse(readFileSync(
      join(__dirname, '../../..', 'public/ra/assets/remap-colors.json'), 'utf-8'
    ));
    // Source has 16 entries
    expect(remapColors.source).toHaveLength(16);
    // IronCurtain must have exactly 16 entries (one per source color)
    expect(remapColors.houses.IronCurtain).toHaveLength(16);
  });
});
