import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseMapPack } from '../oracle/mapParser.js';

/**
 * Compare terrain templates at y=94-108, x=14-30 to find what's blocking
 * Tanya from walking north from y=105 to SAM at y=94.
 */

describe('SCG05EA terrain comparison', () => {
  it('dumps template IDs for the blocked zone y=94-108', () => {
    const iniPath = path.join(process.cwd(), 'public', 'ra', 'assets', 'SCG05EA.ini');
    const iniText = fs.readFileSync(iniPath, 'utf-8');
    const { ttype, bounds } = parseMapPack(iniText);

    console.log('Map bounds:', bounds);
    console.log('\nRaw template IDs (y=92-110, x=12-30):');
    console.log('         ' + Array.from({ length: 19 }, (_, i) => String(i + 12).padStart(4)).join(''));

    for (let y = 92; y <= 110; y++) {
      let row = 'y=' + String(y).padStart(3) + ':';
      for (let x = 12; x <= 30; x++) {
        const cell = y * 128 + x;
        const tt = ttype[cell];
        if (tt === 0 || tt === 0xFFFF) {
          row += '   .';
        } else if (tt === 1 || tt === 2) {
          row += '   ~';
        } else {
          row += String(tt).padStart(4);
        }
      }
      console.log(row);
    }

    // Now show what the TS scenario.ts classifies these templates as
    // Shore templates (3-56), rock debris (97-110), cliff (149-172), etc.
    console.log('\nTemplate classification key:');
    const WATER = new Set([1, 2]);
    const SHORE = new Set<number>();
    for (let i = 3; i <= 56; i++) SHORE.add(i);
    const ROCK_DEBRIS = new Set<number>();
    for (let i = 97; i <= 110; i++) ROCK_DEBRIS.add(i);
    const CLIFF = new Set<number>();
    for (let i = 149; i <= 172; i++) CLIFF.add(i);

    // Collect unique templates in the blocked zone
    const templateSet = new Set<number>();
    for (let y = 95; y <= 108; y++) {
      for (let x = 14; x <= 25; x++) {
        const tt = ttype[y * 128 + x];
        if (tt !== 0 && tt !== 0xFFFF && tt !== 1 && tt !== 2) {
          templateSet.add(tt);
        }
      }
    }
    const sorted = [...templateSet].sort((a, b) => a - b);
    console.log('Unique templates in blocked zone (y=95-108, x=14-25):');
    for (const t of sorted) {
      let classification = 'UNKNOWN';
      if (SHORE.has(t)) classification = 'SHORE (passable as BEACH)';
      else if (ROCK_DEBRIS.has(t)) classification = 'ROCK_DEBRIS (passable as ROUGH)';
      else if (CLIFF.has(t)) classification = 'CLIFF (passable as ROUGH)';
      else if (t >= 57 && t <= 96) classification = 'terrain template 57-96';
      else if (t >= 111 && t <= 148) classification = 'terrain template 111-148';
      else if (t >= 173) classification = 'terrain template 173+';
      console.log('  template ' + t + ': ' + classification);
    }

    expect(true).toBe(true);
  });
});
