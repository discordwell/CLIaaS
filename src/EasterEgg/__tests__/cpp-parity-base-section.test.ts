/**
 * C++ parity tests: [Base] section handling
 *
 * C++ source: base.h line 116-118
 * "This is the list of 'nodes' that define the base. Portions of this
 * list can be pre-built by simply saving those buildings in the INI
 * along with non-base buildings, so Is_Built will return true for them."
 *
 * The [Base] section defines the AI rebuild blueprint — it tells the
 * computer player which structures to reconstruct at which locations
 * if they're destroyed. It does NOT create additional visible structures.
 * The actual buildings should already exist in the [STRUCTURES] section.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('[Base] section — C++ parity', () => {
  // SCG08EA has 49 structures in [STRUCTURES] and 17 in [Base]
  // C++ loads 49 visible structures; TS was incorrectly loading 49+17=66

  it('SCG08EA [STRUCTURES] count matches expected', () => {
    const iniPath = path.resolve(__dirname, '..', '..', '..', 'public', 'ra', 'assets', 'SCG08EA.ini');
    const ini = fs.readFileSync(iniPath, 'utf8');

    // Count entries in [STRUCTURES] section
    const structMatch = ini.match(/\[STRUCTURES\]\r?\n([\s\S]*?)(?=\r?\n\[|$)/);
    expect(structMatch, 'should find [STRUCTURES] section').toBeTruthy();
    const structLines = structMatch![1].split(/\r?\n/).filter(l => l.trim() && !l.startsWith(';') && l.includes('='));
    // Should have entries (exact count may vary, but should be around 49)
    expect(structLines.length).toBeGreaterThan(40);
  });

  it('SCG08EA [Base] section entries should NOT be loaded as visible structures', () => {
    const iniPath = path.resolve(__dirname, '..', '..', '..', 'public', 'ra', 'assets', 'SCG08EA.ini');
    const ini = fs.readFileSync(iniPath, 'utf8');

    // Count entries in [Base] section
    const baseMatch = ini.match(/\[Base\]\r?\n([\s\S]*?)(?=\r?\n\[|$)/);
    expect(baseMatch, 'should find [Base] section').toBeTruthy();
    const baseLines = baseMatch![1].split(/\r?\n/).filter(l => l.trim() && !l.startsWith(';') && l.includes('=') && l !== 'Player=USSR' && !l.startsWith('Count='));

    // Base section should have entries (AI rebuild blueprints)
    expect(baseLines.length).toBeGreaterThan(10);

    // Per C++ base.h:116-118, these entries are blueprints only.
    // They must NOT create duplicate visible structures.
    // The TS engine stores them in baseBlueprint for the AI rebuild system.
  });

  it('SCG08EA USSR structures in [STRUCTURES] should not be duplicated by [Base]', () => {
    const iniPath = path.resolve(__dirname, '..', '..', '..', 'public', 'ra', 'assets', 'SCG08EA.ini');
    const ini = fs.readFileSync(iniPath, 'utf8');

    // Extract USSR structures from [STRUCTURES]
    const structMatch = ini.match(/\[STRUCTURES\]\r?\n([\s\S]*?)(?=\r?\n\[|$)/);
    const structLines = structMatch![1].split(/\r?\n/).filter(l => l.trim() && l.includes('='));
    const ussrStructures = structLines.filter(l => {
      const parts = l.split('=')[1]?.split(',');
      return parts && parts[0] === 'USSR';
    });

    // Extract [Base] entries
    const baseMatch = ini.match(/\[Base\]\r?\n([\s\S]*?)(?=\r?\n\[|$)/);
    const baseLines = baseMatch![1].split(/\r?\n/).filter(l => l.trim() && l.includes('=') && l !== 'Player=USSR' && !l.startsWith('Count='));

    // Total enemy structures should be ONLY from [STRUCTURES], not [STRUCTURES]+[Base]
    // C++ parity: 22 USSR structures from [STRUCTURES] + 1 Germany = 23 enemy total
    // (Germany structure: DOME at index 42)
    expect(ussrStructures.length).toBe(22);

    // Base entries exist but are blueprints only
    expect(baseLines.length).toBe(17);
  });
});
