import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseMapPack } from '../oracle/mapParser.js';

describe('SCG05EA water coast map', () => {
  it('shows water cells from y=40 to y=115, x=0 to x=30', () => {
    const iniPath = path.join(process.cwd(), 'public', 'ra', 'assets', 'SCG05EA.ini');
    const iniText = fs.readFileSync(iniPath, 'utf-8');
    const { ttype, bounds } = parseMapPack(iniText);

    console.log('Map bounds:', bounds);
    console.log('\nWater map (~ = water, . = clear, # = other):');
    console.log('       ' + Array.from({ length: 31 }, (_, i) => (i % 10).toString()).join(''));
    console.log('       0         1         2         3');

    for (let y = 40; y <= 115; y++) {
      let row = 'y=' + String(y).padStart(3) + ': ';
      for (let x = 0; x <= 30; x++) {
        const cell = y * 128 + x;
        const tt = ttype[cell];
        if (tt === 1 || tt === 2) row += '~'; // water templates
        else if (tt === 0 || tt === 0xFFFF) row += '.'; // clear
        else row += '#';
      }
      // Also check x=20-28 for tny3 area
      row += '  |  ';
      for (let x = 20; x <= 28; x++) {
        const cell = y * 128 + x;
        const tt = ttype[cell];
        if (tt === 1 || tt === 2) row += '~';
        else if (tt === 0 || tt === 0xFFFF) row += '.';
        else row += '#';
      }
      console.log(row);
    }

    // Check specific tny3 cells
    console.log('\ntny3 cell terrain:');
    for (const [cx, cy] of [[24, 107], [24, 108]]) {
      const cell = cy * 128 + cx;
      console.log('  (' + cx + ',' + cy + ') template=' + ttype[cell]);
    }

    expect(true).toBe(true);
  });
});
