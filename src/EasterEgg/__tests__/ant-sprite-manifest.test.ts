/**
 * Ant sprite manifest tests — verify all ant-related sprites have correct
 * manifest.json entries so the asset manager can load them at runtime.
 *
 * Bug 4: ant1/ant2/ant3/antdie PNGs existed on disk but had no manifest
 * entries, causing the asset manager to skip them entirely (invisible ants).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ASSETS_DIR = join(__dirname, '../../../public/ra/assets');
const manifest = JSON.parse(readFileSync(join(ASSETS_DIR, 'manifest.json'), 'utf-8'));

describe('Ant sprite manifest entries', () => {
  // Generated ant sprites (from scripts/generate-ant-sprites.ts)
  const GENERATED_ANTS = ['ant1', 'ant2', 'ant3'];

  for (const name of GENERATED_ANTS) {
    it(`${name} has correct manifest entry (24x24, 104 frames)`, () => {
      const entry = manifest[name];
      expect(entry, `${name} missing from manifest`).toBeDefined();
      expect(entry.frameWidth).toBe(24);
      expect(entry.frameHeight).toBe(24);
      expect(entry.frameCount).toBe(104);
      expect(entry.columns).toBe(16);
      expect(entry.rows).toBe(7);
      expect(entry.sheetWidth).toBe(384);
      expect(entry.sheetHeight).toBe(168);
    });
  }

  it('antdie has correct manifest entry (48x48, 8 frames)', () => {
    const entry = manifest['antdie'];
    expect(entry, 'antdie missing from manifest').toBeDefined();
    expect(entry.frameWidth).toBe(48);
    expect(entry.frameHeight).toBe(48);
    expect(entry.frameCount).toBe(8);
    expect(entry.columns).toBe(8);
    expect(entry.rows).toBe(1);
    expect(entry.sheetWidth).toBe(384);
    expect(entry.sheetHeight).toBe(48);
  });

  // Extracted ant structure sprites (queen, larvae)
  it('quee has correct manifest entry (48x24, 20 frames)', () => {
    const entry = manifest['quee'];
    expect(entry, 'quee missing from manifest').toBeDefined();
    expect(entry.frameWidth).toBe(48);
    expect(entry.frameHeight).toBe(24);
    expect(entry.frameCount).toBe(20);
    expect(entry.columns).toBe(16);
    expect(entry.rows).toBe(2);
    expect(entry.sheetWidth).toBe(768);
    expect(entry.sheetHeight).toBe(48);
  });

  for (const name of ['lar1', 'lar2']) {
    it(`${name} has correct manifest entry (24x24, 3 frames)`, () => {
      const entry = manifest[name];
      expect(entry, `${name} missing from manifest`).toBeDefined();
      expect(entry.frameWidth).toBe(24);
      expect(entry.frameHeight).toBe(24);
      expect(entry.frameCount).toBe(3);
      expect(entry.columns).toBe(3);
      expect(entry.rows).toBe(1);
      expect(entry.sheetWidth).toBe(72);
      expect(entry.sheetHeight).toBe(24);
    });
  }

  it('all ant sprite PNGs exist on disk', () => {
    const { existsSync } = require('fs');
    for (const name of ['ant1', 'ant2', 'ant3', 'antdie', 'lar1', 'lar2', 'quee']) {
      const pngPath = join(ASSETS_DIR, `${name}.png`);
      expect(existsSync(pngPath), `${name}.png missing from ${ASSETS_DIR}`).toBe(true);
    }
  });
});
