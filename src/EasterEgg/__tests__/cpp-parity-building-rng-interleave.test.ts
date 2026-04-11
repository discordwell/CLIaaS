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

  it('game loop uses unified loop with interleaved building processing', () => {
    // The unified loop inlines building timer+combat processing inside _runCombat,
    // matching C++ Logic.AI() single-loop ordering. The old separate
    // tickStructureMissionTimers + _updateStructureCombat pattern must NOT appear.
    const gameLoopSection = indexSource.slice(
      indexSource.indexOf('Phase 1: pre-building'),
      indexSource.indexOf('Phase 4: aircraft'),
    );
    // Building timer+combat is inlined in Phase 2 (no longer delegated to tickStructuresInterleaved)
    expect(gameLoopSection).toContain('_updateSingleStructureCombat(ctx, s, isLowPower)');
    expect(gameLoopSection).toContain('ScenarioRandom.nextInRange(0, 2)');
    // The old separate bulk passes must NOT appear
    expect(gameLoopSection).not.toContain('this.tickStructureMissionTimers()');
    expect(gameLoopSection).not.toMatch(
      /this\._runCombat\(ctx => _updateStructureCombat\(ctx\)\)/,
    );
  });

  it('updateSingleStructureCombat is exported from combat.ts', () => {
    expect(combatSource).toContain('export function updateSingleStructureCombat(');
  });

  // C++ Logic.AI ordering: structures process BEFORE pre-building entities
  // each tick. Empirically determined via SCG08EA tick-93 RNG seed trace —
  // the GUN at structure idx 15 fires 1 tick earlier in WASM than TS, fixed
  // by letting structures consume their jitter RNG before entity jitter.
  // Reverting this to the old order will regress SCG08EA by ~7 player units.
  it('structures process BEFORE pre-building entities (SCG08EA RNG ordering)', () => {
    const phase1Idx = indexSource.indexOf('Phase 1: pre-building');
    const phase2Idx = indexSource.indexOf('Phase 2: ALL structures');
    const phase1bIdx = indexSource.indexOf('Phase 1: pre-building entities (now after structures)');
    expect(phase1Idx).toBeGreaterThan(0);
    expect(phase2Idx).toBeGreaterThan(0);
    // The Phase 1 marker exists as a deferred-comment marker BEFORE Phase 2.
    // The actual entity processing happens in Phase 1b AFTER Phase 2.
    expect(phase2Idx).toBeGreaterThan(phase1Idx);
    expect(phase1bIdx).toBeGreaterThan(phase2Idx);
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
