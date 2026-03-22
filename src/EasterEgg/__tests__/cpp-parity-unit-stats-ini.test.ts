/**
 * CPP Parity: Unit Strength (HP), Cost, Speed, Sight vs rules.ini / aftrmath.ini
 *
 * This test parses the actual INI files from the repository and compares every
 * UNIT_STATS entry against its authoritative INI values. rules.ini is the
 * canonical source of truth; aftrmath.ini overrides rules.ini where present.
 *
 * Ant units (ANT1, ANT2, ANT3) are defined per-scenario in SCA*.ini files.
 * We use SCA01EA.ini as the canonical source (first ant mission).
 *
 * C++ source refs:
 *   - udata.cpp: vehicle defaults (overridden by rules.ini at runtime)
 *   - idata.cpp: infantry defaults (overridden by rules.ini at runtime)
 *   - aadata.cpp: aircraft defaults (overridden by rules.ini at runtime)
 *   - vdata.cpp: vessel defaults (overridden by rules.ini at runtime)
 *   - rules.ini: runtime authoritative values
 *   - aftrmath.ini: Aftermath expansion overrides
 *   - SCA01EA.ini: ant mission scenario overrides
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { UNIT_STATS } from '../engine/types';

// ---------------------------------------------------------------------------
// INI Parser (replicates C++ INI load: last-key-wins within a section)
// ---------------------------------------------------------------------------

function parseINI(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current = '';
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      current = sectionMatch[1];
      if (!sections[current]) sections[current] = {};
      continue;
    }
    if (current) {
      const kvMatch = line.match(/^([^=;]+)=\s*([^;]*)/);
      if (kvMatch) {
        sections[current][kvMatch[1].trim()] = kvMatch[2].trim();
      }
    }
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Load and merge INI files
// aftrmath.ini overrides rules.ini per-key within each section (C++ load order)
// SCA01EA.ini provides ant unit definitions (not in rules.ini or aftrmath.ini)
// ---------------------------------------------------------------------------

const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');
const rules = parseINI(readFileSync(join(assetsDir, 'rules.ini'), 'utf-8'));
const aftrmath = parseINI(readFileSync(join(assetsDir, 'aftrmath.ini'), 'utf-8'));
const sca01 = parseINI(readFileSync(join(assetsDir, 'SCA01EA.ini'), 'utf-8'));

// Merge: aftrmath overrides rules per-key
const ini: Record<string, Record<string, string>> = {};
for (const [section, values] of Object.entries(rules)) {
  ini[section] = { ...values };
}
for (const [section, values] of Object.entries(aftrmath)) {
  ini[section] = { ...(ini[section] || {}), ...values };
}

// Ant units come from SCA scenario INI files (not in rules.ini / aftrmath.ini)
const ANT_UNITS = new Set(['ANT1', 'ANT2', 'ANT3']);
for (const ant of ANT_UNITS) {
  if (sca01[ant]) {
    ini[ant] = { ...(ini[ant] || {}), ...sca01[ant] };
  }
}

// ---------------------------------------------------------------------------
// All TS UNIT_STATS keys — every one must be checked
// ---------------------------------------------------------------------------

const allTsUnits = Object.keys(UNIT_STATS);

// ---------------------------------------------------------------------------
// 1. Strength (HP) Parity — INI Strength= vs TS strength
// ---------------------------------------------------------------------------

describe('INI Parity: Unit Strength (HP)', () => {
  for (const unit of allTsUnits) {
    const stats = UNIT_STATS[unit];
    const iniData = ini[unit];

    it(`${unit} strength matches INI Strength=`, () => {
      expect(iniData, `${unit} must exist in INI files`).toBeDefined();
      expect(iniData!.Strength, `${unit} must have Strength= in INI`).toBeDefined();
      const iniStrength = Number(iniData!.Strength);
      expect(stats.strength, `TS ${unit}.strength=${stats.strength}, INI Strength=${iniStrength}`).toBe(iniStrength);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Cost Parity — INI Cost= vs TS cost (where TS defines cost)
// ---------------------------------------------------------------------------

describe('INI Parity: Unit Cost', () => {
  for (const unit of allTsUnits) {
    const stats = UNIT_STATS[unit];
    const iniData = ini[unit];

    // Only test cost where TS defines it (not all units have cost in TS)
    if (stats.cost === undefined) continue;
    if (!iniData?.Cost) continue;

    it(`${unit} cost matches INI Cost=`, () => {
      const iniCost = Number(iniData!.Cost);
      expect(stats.cost, `TS ${unit}.cost=${stats.cost}, INI Cost=${iniCost}`).toBe(iniCost);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Speed Parity — INI Speed= vs TS speed
// ---------------------------------------------------------------------------

describe('INI Parity: Unit Speed', () => {
  for (const unit of allTsUnits) {
    const stats = UNIT_STATS[unit];
    const iniData = ini[unit];

    it(`${unit} speed matches INI Speed=`, () => {
      expect(iniData, `${unit} must exist in INI files`).toBeDefined();
      expect(iniData!.Speed, `${unit} must have Speed= in INI`).toBeDefined();
      const iniSpeed = Number(iniData!.Speed);
      expect(stats.speed, `TS ${unit}.speed=${stats.speed}, INI Speed=${iniSpeed}`).toBe(iniSpeed);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Sight Parity — INI Sight= vs TS sight
// ---------------------------------------------------------------------------

describe('INI Parity: Unit Sight', () => {
  for (const unit of allTsUnits) {
    const stats = UNIT_STATS[unit];
    const iniData = ini[unit];

    it(`${unit} sight matches INI Sight=`, () => {
      expect(iniData, `${unit} must exist in INI files`).toBeDefined();
      expect(iniData!.Sight, `${unit} must have Sight= in INI`).toBeDefined();
      const iniSight = Number(iniData!.Sight);
      expect(stats.sight, `TS ${unit}.sight=${stats.sight}, INI Sight=${iniSight}`).toBe(iniSight);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Coverage: every TS unit must have an INI section
// ---------------------------------------------------------------------------

describe('INI Parity: Coverage', () => {
  it('every UNIT_STATS entry has a corresponding INI section', () => {
    const missing: string[] = [];
    for (const unit of allTsUnits) {
      if (!ini[unit]) missing.push(unit);
    }
    expect(missing, `Missing INI sections: ${missing.join(', ')}`).toEqual([]);
  });
});
