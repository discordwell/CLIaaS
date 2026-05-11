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
  const scenarioSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'engine', 'scenario.ts'), 'utf-8',
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

  // C++ Logic.AI (logic.cpp:284): entities process BEFORE buildings.
  // Logic array order: Units → Vessels → Infantry → Buildings.
  it('pre-building entities process BEFORE structures (C++ Logic array order)', () => {
    const phase1Idx = indexSource.indexOf('Phase 1: pre-building entities');
    const phase2Idx = indexSource.indexOf('Phase 2: ALL structures');
    expect(phase1Idx).toBeGreaterThan(0);
    expect(phase2Idx).toBeGreaterThan(0);
    expect(phase1Idx).toBeLessThan(phase2Idx);
  });

  it('updateSingleStructureCombat checks sellProgress and buildProgress', () => {
    const idx = combatSource.indexOf('export function updateSingleStructureCombat');
    expect(idx).toBeGreaterThan(-1);
    const chunk = combatSource.slice(idx, idx + 500);
    expect(chunk).toContain('sellProgress');
    expect(chunk).toContain('isStructureUnderConstruction(s)');

    const helperIdx = scenarioSource.indexOf('export function isStructureUnderConstruction');
    expect(helperIdx).toBeGreaterThan(-1);
    const helperChunk = scenarioSource.slice(helperIdx, helperIdx + 200);
    expect(helperChunk).toContain('buildProgress');
  });

  it('interleaved loop processes timer jitter RNG before combat for each building', () => {
    // In the live Phase 2 structure loop, ScenarioRandom.nextInRange(0, 2)
    // (timer jitter) must appear BEFORE _updateSingleStructureCombat for the
    // same building iteration.
    const phaseStart = indexSource.indexOf('Phase 2: ALL structures');
    const phaseEnd = indexSource.indexOf('Phase 3: post-building entities');
    expect(phaseStart).toBeGreaterThan(-1);
    expect(phaseEnd).toBeGreaterThan(phaseStart);
    const phaseBody = indexSource.slice(phaseStart, phaseEnd);
    const timerIdx = phaseBody.indexOf('dispatchStructureMissionTimer(');
    const combatIdx = phaseBody.indexOf('_updateSingleStructureCombat(');
    expect(timerIdx).toBeGreaterThan(-1);
    expect(combatIdx).toBeGreaterThan(-1);
    // Timer dispatch, which owns the jitter RNG, must come before combat call
    // (matching C++ AI() → Firing_AI() order).
    expect(timerIdx).toBeLessThan(combatIdx);

    const helperStart = indexSource.indexOf('private dispatchStructureMissionTimer(');
    expect(helperStart).toBeGreaterThan(-1);
    const helperBody = indexSource.slice(helperStart, helperStart + 2500);
    expect(helperBody).toContain('ScenarioRandom.nextInRange(0, 2)');
  });

  it('flushes earlier BulletClass logic slots before each building', () => {
    // C++ LogicClass::AI is one vector: bullets appended before a building slot
    // must run before that building's MissionClass timer jitter.
    const phaseStart = indexSource.indexOf('Phase 2: ALL structures');
    const phaseEnd = indexSource.indexOf('Phase 3: post-building entities');
    expect(phaseStart).toBeGreaterThan(-1);
    expect(phaseEnd).toBeGreaterThan(phaseStart);
    const phaseBody = indexSource.slice(phaseStart, phaseEnd);
    const flushIdx = phaseBody.indexOf('updateProjectilesThrough(effectiveLogicIdx - 1)');
    const timerIdx = phaseBody.indexOf('dispatchStructureMissionTimer(');
    expect(flushIdx).toBeGreaterThan(-1);
    expect(timerIdx).toBeGreaterThan(-1);
    expect(flushIdx).toBeLessThan(timerIdx);
  });

  it('updateStructureCombat wrapper delegates to updateSingleStructureCombat', () => {
    // The bulk wrapper should still exist (for any callers) and delegate to per-building fn
    const idx = combatSource.indexOf('export function updateStructureCombat(');
    expect(idx).toBeGreaterThan(-1);
    const chunk = combatSource.slice(idx, idx + 500);
    expect(chunk).toContain('updateSingleStructureCombat(ctx, s, isLowPower)');
  });
});
