/**
 * C++ parity test: mission timer delay constants
 *
 * Validates that TS timer values match the C++ fixed-point arithmetic
 * derived from rules.ini MissionControl data.
 *
 * C++ source refs:
 *   - mission.h:141-142   MissionControlClass::Normal_Delay / AA_Delay
 *   - mission.cpp:540-541 MissionControlClass defaults: Rate=".016", AARate=".016"
 *   - mission.cpp:565-569 MissionControlClass::Read_INI (loads overrides from rules.ini)
 *   - infantry.cpp:1748   IdleTimer = Random_Pick(RandomAnimateTime * TICKS_PER_MINUTE/2, RandomAnimateTime * TICKS_PER_MINUTE*2)
 *   - rules.cpp:462       RandomAnimateTime = ini.Get_Fixed(GENERAL, "IdleActionFrequency", ...)
 *
 * rules.ini values:
 *   [General] IdleActionFrequency=.1
 *   [Guard]   Rate=.050  AARate=.016
 *   [Area Guard] Rate=.080 AARate=.032
 *
 * C++ fixed-point math: fixed(".050") → Data.Raw=12
 *   operator*(int): ((Raw * int_rvalue) + 128) / 256
 *   Normal_Delay = TICKS_PER_MINUTE * Rate = ((12 * 900) + 128) / 256 = 42
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** C++ fixed-point 8.8 representation from ASCII string */
function cppFixed(ascii: string): number {
  const fracpart = ascii.split('.')[1] ?? '';
  const frac = parseInt(fracpart, 10) || 0;
  const base = Math.pow(10, fracpart.length);
  return Math.floor((256 * frac) / base);
}

/** C++ fixed * int → int (matches operator*(int rvalue)) */
function cppFixedMulInt(raw: number, rvalue: number): number {
  return Math.floor((raw * rvalue + 128) / 256);
}

const TICKS_PER_MINUTE = 900;

describe('Mission timer delay constants — C++ fixed-point parity', () => {
  it('[Guard] Normal_Delay = 42 (Rate=.050)', () => {
    const raw = cppFixed('.050');
    expect(raw).toBe(12); // (256*50)/1000 = 12
    const delay = cppFixedMulInt(raw, TICKS_PER_MINUTE);
    expect(delay).toBe(42);
  });

  it('[Guard] AA_Delay = 14 (AARate=.016)', () => {
    const raw = cppFixed('.016');
    expect(raw).toBe(4); // (256*16)/1000 = 4
    const delay = cppFixedMulInt(raw, TICKS_PER_MINUTE);
    expect(delay).toBe(14);
  });

  it('[Area Guard] Normal_Delay = 70 (Rate=.080)', () => {
    const raw = cppFixed('.080');
    expect(raw).toBe(20); // (256*80)/1000 = 20
    const delay = cppFixedMulInt(raw, TICKS_PER_MINUTE);
    expect(delay).toBe(70);
  });

  it('IdleActionFrequency=.1 → IdleTimer range (44, 176)', () => {
    const raw = cppFixed('.1');
    expect(raw).toBe(25); // (256*1)/10 = 25
    const lo = cppFixedMulInt(raw, TICKS_PER_MINUTE / 2); // 450
    const hi = cppFixedMulInt(raw, TICKS_PER_MINUTE * 2); // 1800
    expect(lo).toBe(44);
    expect(hi).toBe(176);
  });

  it('rules.ini values match expectations', () => {
    const rulesPath = path.join(__dirname, '../../..', 'public/ra/assets/rules.ini');
    const rules = fs.readFileSync(rulesPath, 'utf-8');

    // Normalize line endings for cross-platform
    const lines = rules.split(/\r?\n/).map(l => l.trim());

    // [Guard] Rate=.050 AARate=.016
    const guardIdx = lines.indexOf('[Guard]');
    expect(guardIdx, '[Guard] section should exist').toBeGreaterThan(-1);
    expect(lines[guardIdx + 1]).toBe('Rate=.050');
    expect(lines[guardIdx + 2]).toBe('AARate=.016');

    // [Area Guard] Rate=.080
    const areaGuardIdx = lines.indexOf('[Area Guard]');
    expect(areaGuardIdx, '[Area Guard] section should exist').toBeGreaterThan(-1);
    const agRateLine = lines.slice(areaGuardIdx + 1, areaGuardIdx + 5).find(l => l.startsWith('Rate='));
    expect(agRateLine).toBe('Rate=.080');

    // IdleActionFrequency=.1  (may have trailing comment)
    const idleLine = lines.find(l => l.startsWith('IdleActionFrequency='));
    expect(idleLine).toBeDefined();
    // Extract value before any comment (;)
    const idleVal = idleLine!.split(';')[0].split('=')[1].trim();
    expect(idleVal).toBe('.1');
  });
});
