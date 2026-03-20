import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseMapPack, decompressRASections } from '../oracle/mapParser.js';

/**
 * SCG05EA terrain analysis — find the water gap blocking the spy.
 */

const WATER_TEMPLATES = new Set([1, 2]);

describe('SCG05EA terrain', () => {
  it('dumps terrain types along the spy path (y=49-51, x=12-50)', () => {
    const iniPath = path.join(process.cwd(), 'public', 'ra', 'assets', 'SCG05EA.ini');
    const iniText = fs.readFileSync(iniPath, 'utf-8');
    const { ttype, bounds } = parseMapPack(iniText);

    console.log(`Map bounds: X=${bounds.x} Y=${bounds.y} W=${bounds.w} H=${bounds.h}`);

    // Dump terrain along the spy's east path
    for (let y = 48; y <= 70; y++) {
      let row = `y=${y.toString().padStart(2)}: `;
      for (let x = 12; x <= 55; x++) {
        const cell = y * 128 + x;
        const tt = ttype[cell];
        const isWater = WATER_TEMPLATES.has(tt);
        if (isWater) {
          row += '~'; // water
        } else if (tt === 0 || tt === 0xFFFF) {
          row += '.'; // clear/void
        } else {
          row += '#'; // land (some template)
        }
      }
      console.log(row);
    }

    // Also show the specific cells the spy walks through
    console.log('\nSpy path cells (y=50, x=16 to 45):');
    for (let x = 16; x <= 45; x++) {
      const cell = 50 * 128 + x;
      const tt = ttype[cell];
      const isWater = WATER_TEMPLATES.has(tt);
      console.log(`  (${x},50): ttype=${tt} ${isWater ? 'WATER' : tt === 0 ? 'CLEAR' : `LAND(template ${tt})`}`);
    }

    // Show what the TS engine map considers passable
    // Check terrain around the known water gap (x=24, y=50)
    console.log('\nTerrain grid around gap (x=20-30, y=48-55):');
    for (let y = 48; y <= 55; y++) {
      let row = `y=${y}: `;
      for (let x = 20; x <= 30; x++) {
        const cell = y * 128 + x;
        const tt = ttype[cell];
        row += `${tt.toString().padStart(4)} `;
      }
      console.log(row);
    }

    // Check shore template icons at the spy death zone
    console.log('\nShore analysis (templates 3-56 with icons, x=12-30, y=48-55):');
    for (let y = 48; y <= 55; y++) {
      let row = `y=${y}: `;
      for (let x = 12; x <= 30; x++) {
        const cell = y * 128 + x;
        const tt = ttype[cell];
        const { ticon: icons } = parseMapPack(iniText);
        const icon = icons[cell];
        if (tt >= 3 && tt <= 56) {
          // Shore template — show if it's being marked as water (icon < 4)
          row += icon < 4 ? `W${icon}` : `L${icon}`;
        } else if (tt >= 1 && tt <= 2) {
          row += '~~';
        } else {
          row += '..';
        }
        row += ' ';
      }
      console.log(row);
    }

    // Decode OverlayPack for hazards (mines, walls) at the spy path
    const overlaySection = extractSectionRaw(iniText, 'OverlayPack');
    if (overlaySection) {
      const overlayB64 = overlaySection;
      const overlayBytes = Buffer.from(overlayB64, 'base64');
      const overlayDest = new Uint8Array(128 * 128);
      overlayDest.fill(0xFF);
      decompressRASections(new Uint8Array(overlayBytes), 0, overlayDest, 128 * 128);

      console.log('\nOverlayPack at spy path (y=50, x=16-30):');
      for (let x = 16; x <= 30; x++) {
        const cell = 50 * 128 + x;
        const ov = overlayDest[cell];
        if (ov !== 0xFF) {
          console.log(`  (${x},50): overlay=${ov} (${ov < 5 ? 'wall/fence' : ov < 24 ? 'ore' : 'other'})`);
        }
      }

      console.log('\nOverlayPack near death zone (x=20-28, y=48-52):');
      for (let y = 48; y <= 52; y++) {
        let row = `y=${y}: `;
        for (let x = 20; x <= 28; x++) {
          const cell = y * 128 + x;
          const ov = overlayDest[cell];
          row += ov === 0xFF ? '. ' : `${ov.toString().padStart(2)} `;
        }
        console.log(`  ${row}`);
      }
    }

    expect(true).toBe(true);
  });
});

function extractSectionRaw(iniText: string, sectionName: string): string {
  const lines = iniText.split(/\r?\n/);
  let inSection = false;
  let result = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      if (inSection) break;
      inSection = trimmed.toLowerCase() === `[${sectionName.toLowerCase()}]`;
      continue;
    }
    if (inSection) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) result += trimmed.slice(eqIdx + 1);
    }
  }
  return result;
}
