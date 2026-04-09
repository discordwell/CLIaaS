/**
 * C++ Parity: Building RNG Interleaving
 *
 * Verifies that building timer ticks and combat firing are processed PER BUILDING,
 * matching C++ BuildingClass::AI() which runs MissionClass::AI() (timer + jitter RNG)
 * then Firing_AI() (weapon fire + damage RNG) sequentially for each building.
 *
 * Previously TS ran two bulk passes:
 *   1. tickStructureMissionTimers() — ALL buildings get timer ticks
 *   2. _updateStructureCombat()     — ALL buildings get combat processing
 *
 * This caused ±2 RNG divergence on SCG03EA/SCG13EA because building combat RNG
 * (from damage scatter, crew spawn, etc.) was consumed at a shifted stream position.
 *
 * C++ reference:
 *   logic.cpp:284-339  — single interleaved loop over all objects
 *   building.cpp:AI()  — calls TechnoClass::AI() then Firing_AI() per building
 *   building.cpp:3228-3306 — Mission_Guard timer with Random_Pick(0,2) jitter
 *   building.cpp:Firing_AI — weapon acquisition and fire
 *
 * The fix: tickStructuresInterleaved() in index.ts runs timer + combat per building
 * in a single loop, matching C++ ordering.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Building RNG Interleaving — C++ parity', () => {
  const indexSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'engine', 'index.ts'), 'utf-8',
  );
  const combatSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'engine', 'combat.ts'), 'utf-8',
  );

  it('tickStructuresInterleaved calls per-building combat after each timer tick', () => {
    // The interleaved method must exist
    expect(indexSource).toContain('private tickStructuresInterleaved(');
    // It must call the per-building combat function
    expect(indexSource).toContain('_updateSingleStructureCombat(combatCtx, s, isLowPower)');
  });

  it('game loop uses interleaved method instead of separate bulk passes', () => {
    // The game loop (around line 1800) should call tickStructuresInterleaved,
    // NOT the old separate tickStructureMissionTimers + _updateStructureCombat pattern
    const gameLoopSection = indexSource.slice(
      indexSource.indexOf('// Pass 1: pre-building'),
      indexSource.indexOf('// Pass 3:'),
    );
    expect(gameLoopSection).toContain('tickStructuresInterleaved');
    // The old separate bulk combat call should NOT appear in this section
    expect(gameLoopSection).not.toContain('this.tickStructureMissionTimers()');
    expect(gameLoopSection).not.toMatch(
      /this\._runCombat\(ctx => _updateStructureCombat\(ctx\)\)/,
    );
  });

  it('updateSingleStructureCombat is exported from combat.ts', () => {
    expect(combatSource).toContain('export function updateSingleStructureCombat(');
  });

  it('updateSingleStructureCombat checks sellProgress and buildProgress', () => {
    const idx = combatSource.indexOf('export function updateSingleStructureCombat');
    expect(idx).toBeGreaterThan(-1);
    const chunk = combatSource.slice(idx, idx + 500);
    expect(chunk).toContain('sellProgress');
    expect(chunk).toContain('buildProgress');
  });

  it('interleaved loop processes timer jitter RNG before combat for each building', () => {
    // In the interleaved method, ScenarioRandom.nextInRange(0, 2) (timer jitter)
    // must appear BEFORE _updateSingleStructureCombat for the same building iteration
    const methodStart = indexSource.indexOf('private tickStructuresInterleaved(');
    expect(methodStart).toBeGreaterThan(-1);
    const methodBody = indexSource.slice(methodStart, methodStart + 3000);
    const jitterIdx = methodBody.indexOf('ScenarioRandom.nextInRange(0, 2)');
    const combatIdx = methodBody.indexOf('_updateSingleStructureCombat(');
    expect(jitterIdx).toBeGreaterThan(-1);
    expect(combatIdx).toBeGreaterThan(-1);
    // Timer jitter RNG must come before combat call (matching C++ AI() → Firing_AI() order)
    expect(jitterIdx).toBeLessThan(combatIdx);
  });

  it('updateStructureCombat wrapper delegates to updateSingleStructureCombat', () => {
    // The bulk wrapper should still exist (for any callers) and delegate to per-building fn
    const idx = combatSource.indexOf('export function updateStructureCombat(');
    expect(idx).toBeGreaterThan(-1);
    const chunk = combatSource.slice(idx, idx + 500);
    expect(chunk).toContain('updateSingleStructureCombat(ctx, s, isLowPower)');
  });
});
