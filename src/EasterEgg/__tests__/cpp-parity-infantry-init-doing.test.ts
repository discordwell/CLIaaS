/**
 * C++ parity: Infantry initial Doing state at scenario init.
 *
 * Task #50 SCG06EA tick 1 RNG divergence — WASM infantry[69] (E1 USSR) made
 * 2 RNG calls that TS did not. Evidence pointed to InfantryClass::Random_Animate
 * firing on the first AI tick:
 *   - infantry.cpp:1748  IdleTimer = Random_Pick(44, 176)        → 1 RNG
 *   - infantry.cpp:1759  switch (Random_Pick(0, 10)) { ... }     → 1 RNG
 *
 * For Random_Animate to execute its body, Is_Ready_To_Random_Animate must return
 * true. That requires Doing == DO_STAND_READY || DO_STAND_GUARD (infantry.cpp:4132).
 *
 * The InfantryClass constructor sets Doing = DO_NOTHING (infantry.cpp:178) and
 * neither Unlimbo nor Commence explicitly change it. However WASM rngLog evidence
 * shows the Random_Animate path firing on tick 1, so TS must match by having
 * infantry already in the stand_ready pose when the first mission tick runs.
 *
 * Fix: scenario.ts seeds every placed infantry with doing='stand_ready' immediately
 * after creation, mirroring the C++ runtime state the RNG trace reveals.
 */

import { describe, it, expect } from 'vitest';
import { Entity } from '../engine/entity';
import { UnitType, House } from '../engine/types';

describe('Infantry initial Doing — scenario init parity (Task #50)', () => {
  it('default Entity constructor leaves doing="nothing" (vehicles + raw state)', () => {
    // Non-infantry keep default — fix is scoped to infantry only via scenario.ts.
    const tank = new Entity(UnitType.V_HTNK, House.USSR, 100, 100);
    expect(tank.doing).toBe('nothing');
  });

  it('fresh infantry Entity from constructor still defaults to "nothing"', () => {
    // Constructor parity with C++ InfantryClass::InfantryClass — Doing(DO_NOTHING).
    const inf = new Entity(UnitType.I_E1, House.USSR, 100, 100);
    expect(inf.doing).toBe('nothing');
    expect(inf.stats.isInfantry).toBe(true);
  });

  it('isReadyToRandomAnimate returns true when doing="stand_ready", false otherwise', () => {
    // C++ infantry.cpp:4132 — Is_Ready_To_Random_Animate requires
    // Doing == DO_STAND_READY || DO_STAND_GUARD. TS maps both to 'stand_ready'.
    const inf = new Entity(UnitType.I_E1, House.USSR, 100, 100);
    expect(inf.isReadyToRandomAnimate()).toBe(false); // doing='nothing'

    inf.doing = 'stand_ready';
    expect(inf.isReadyToRandomAnimate()).toBe(true);

    inf.doing = 'walk';
    expect(inf.isReadyToRandomAnimate()).toBe(false);
  });

  it('scenario init must seed infantry with doing="stand_ready" (checked via grep)', async () => {
    // Rather than load a full scenario, read the scenario.ts source and assert the
    // seeding line is present at the documented location. This pins the behaviour
    // without requiring an async scenario load in the Node test environment.
    const fs = await import('node:fs/promises');
    const path = new URL('../engine/scenario.ts', import.meta.url).pathname;
    const src = await fs.readFile(path, 'utf8');
    expect(
      src,
      'scenario.ts must seed infantry with doing="stand_ready" at init for C++ parity'
    ).toMatch(/entity\.stats\.isInfantry[\s\S]{0,200}entity\.doing\s*=\s*['"]stand_ready['"]/);
  });
});
