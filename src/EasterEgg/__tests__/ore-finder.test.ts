import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseScenarioINI, decompressRASections } from '../engine/scenario';

describe('SCG11EA ore finder', () => {
  it('finds all ore positions on SCG11EA', () => {
    const iniPath = path.resolve(process.cwd(), 'public', 'ra', 'assets', 'SCG11EA.ini');
    const iniText = fs.readFileSync(iniPath, 'utf-8');
    const data = parseScenarioINI(iniText);

    // Decode the OverlayPack to get overlay array
    const MAP_W = 128;
    const MAP_SIZE = MAP_W * MAP_W;
    const overlay = new Uint8Array(MAP_SIZE).fill(0xFF);

    if (data.overlayPack) {
      const binary = Buffer.from(data.overlayPack, 'base64');
      const bytes = new Uint8Array(binary);
      decompressRASections(bytes, 0, overlay, MAP_SIZE);
    }

    const orePositions: Array<{ cx: number; cy: number; type: string; id: string }> = [];

    // Search for ore (0x03-0x0E = gold, 0x0F-0x12 = gems)
    for (let i = 0; i < overlay.length; i++) {
      const ovl = overlay[i];
      if (ovl >= 0x03 && ovl <= 0x12) {
        const cy = Math.floor(i / MAP_W);
        const cx = i % MAP_W;
        const type = ovl >= 0x0F ? 'gem' : 'gold';
        orePositions.push({ cx, cy, type, id: '0x' + ovl.toString(16) });
      }
    }

    console.log(`\n✓ Found ${orePositions.length} ore cells`);

    // Show all positions
    orePositions.forEach((p) => {
      console.log(`  (${p.cx},${p.cy}) ${p.type.padEnd(4)} ID=${p.id}`);
    });

    // Group by region relative to base (20-27, 95-100)
    const nearBase = orePositions.filter(p => p.cx >= 15 && p.cx <= 35 && p.cy >= 90 && p.cy <= 105);
    const eastChain = orePositions.filter(p => p.cx >= 35 && p.cx <= 65);
    const other = orePositions.filter(p => !nearBase.includes(p) && !eastChain.includes(p));

    console.log(`\nNear base (15-35, 90-105): ${nearBase.length} cells`);
    nearBase.forEach(p => console.log(`  (${p.cx},${p.cy})`));

    console.log(`\nEast chain (35-65): ${eastChain.length} cells`);
    eastChain.forEach(p => console.log(`  (${p.cx},${p.cy})`));

    console.log(`\nOther regions: ${other.length} cells`);
    other.forEach(p => console.log(`  (${p.cx},${p.cy})`));

    expect(orePositions.length).toBeGreaterThan(0);
  });
});
