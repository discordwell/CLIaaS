/**
 * C++ Parity: BARL/BRL3 barrel buildings — IsSentient and guard timer behavior
 *
 * Investigation result: BARL and BRL3 barrels ARE sentient in C++.
 * The TechnoTypeClass constructor (techno.cpp:5962) hardcodes is_sentient=true
 * for ALL building types passed to ObjectTypeClass. This means:
 *
 *   1. All barrels ARE in the C++ Logic array (ObjectClass::Unlimbo adds sentient
 *      objects via Logic.Submit at object.cpp:1412-1413)
 *   2. All barrels DO fire Mission_Guard on tick 1 (MissionClass::AI at
 *      mission.cpp:232 checks Timer==0 && Strength>0 — both true for barrels)
 *   3. All barrels DO consume Random_Pick(0,2) for guard timer jitter
 *      (building.cpp:3302 — Normal_Delay*3 + Random_Pick(0,2))
 *
 * The ±2 RNG divergence on SCG03EA is NOT caused by barrels being non-sentient.
 * It is caused by architectural differences in entity processing order:
 *   - C++ processes ALL objects (terrain, units, infantry, buildings) in a single
 *     Logic array loop. Objects added mid-tick (trigger reinforcements) are
 *     picked up by the loop's re-evaluated Count().
 *   - TS processes entities and buildings in separate passes. Trigger-spawned
 *     entities go into a post-building pass instead of being interleaved.
 *
 * C++ source refs:
 *   techno.cpp:5962     — TechnoTypeClass passes is_sentient=true to ObjectTypeClass
 *   object.cpp:1412-1413 — Unlimbo adds sentient objects to Logic
 *   building.cpp:3228-3306 — Mission_Guard for buildings (all paths consume Random_Pick)
 *   bdata.cpp:151-179   — ClassBarrel (BARL) constructor
 *   bdata.cpp:181-209   — ClassBarrel3 (BRL3) constructor
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from 'vitest';
import { NodeAgentAdapter } from './node-agent-adapter';
import { ScenarioRandom } from '../engine/random';

describe('BARL/BRL3 barrel buildings — C++ parity', () => {
  let adapter: NodeAgentAdapter;

  afterEach(() => {
    adapter?.disconnect();
    ScenarioRandom._tagLogging = false;
    ScenarioRandom._seedLog = [];
    ScenarioRandom._taggedLog = [];
    ScenarioRandom._sourceTag = 0;
    ScenarioRandom.callCount = 0;
    ScenarioRandom.seed = 0;
  });

  it('all 141 SCG03EA buildings consume guard timer RNG on tick 1 (matching C++ sentient behavior)', async () => {
    adapter = new NodeAgentAdapter();
    await adapter.loadScenario('SCG03EA', 'normal');
    const game = (adapter as any).game;

    // Verify structure count matches C++ (both engines report 141)
    expect(game.structures.length).toBe(141);

    // All structures should be alive and have missionTimer=0 (fires on first tick)
    for (let i = 0; i < game.structures.length; i++) {
      const s = game.structures[i];
      expect(s.alive, `structures[${i}] should be alive`).toBe(true);
      expect(s.missionTimer, `structures[${i}] (${s.type}) should have missionTimer=0`).toBe(0);
    }

    // Enable RNG logging and run tick 1
    ScenarioRandom._tagLogging = true;
    ScenarioRandom._seedLog = [];
    adapter.step(1);
    ScenarioRandom._tagLogging = false;

    // Count building RNG calls — each building should have consumed at least 1 call.
    // Tags are 12000 + logicIdx where logicIdx is a unified counter across all phases
    // (matching C++ Logic array indices), so building indices start after pre-building
    // entities rather than at 0.
    const buildingTags = new Set<number>();
    for (const [, tag] of ScenarioRandom._seedLog) {
      if (tag >= 12000 && tag < 13000) {
        buildingTags.add(tag);
      }
    }

    // C++ parity: ALL 141 buildings are sentient and consume guard timer RNG.
    // The unified logicIdx means building tags are offset by pre-building entity count,
    // but there must be exactly 141 distinct building tags (one per structure).
    expect(buildingTags.size).toBe(141);
  });

  it('barrel buildings use non-weapon guard delay (Normal_Delay*3 = 126 ticks)', async () => {
    adapter = new NodeAgentAdapter();
    await adapter.loadScenario('SCG03EA', 'normal');
    const game = (adapter as any).game;

    // Run tick 1 to fire all guard timers
    adapter.step(1);

    // After one full TS/C++ tick has completed, the freshly assigned timer has
    // already elapsed one frame, so the observable value is [125, 127].
    // The returned delay itself is Normal_Delay*3 + jitter where jitter is 0-2.
    // C++ building.cpp:3302: Normal_Delay * 3 + Random_Pick(0, 2)
    // GUARD_NORMAL_DELAY = 42 (from rules.ini [Guard] Rate=.050, C++ fixed-point: 42)
    const barrelTypes = new Set(['BARL', 'BRL3']);
    for (let i = 0; i < game.structures.length; i++) {
      const s = game.structures[i];
      if (barrelTypes.has(s.type)) {
        expect(s.missionTimer).toBeGreaterThanOrEqual(125);
        expect(s.missionTimer).toBeLessThanOrEqual(127);
      }
    }
  });

  it('weapon-equipped buildings use AA_Delay (14 ticks) timer', async () => {
    adapter = new NodeAgentAdapter();
    await adapter.loadScenario('SCG03EA', 'normal');
    const game = (adapter as any).game;

    adapter.step(1);

    // After one full tick, the returned AA_Delay() + Random_Pick(0, 2)
    // is observed one frame lower.
    // GUARD_AA_DELAY = 14 (from rules.ini [Guard] AARate=.016, C++ fixed-point: 14)
    const weaponTypes = new Set(['FTUR', 'GUN', 'SAM', 'TSLA', 'AGUN', 'HBOX', 'PBOX', 'WEAP']);
    for (let i = 0; i < game.structures.length; i++) {
      const s = game.structures[i];
      if (s.weapon && weaponTypes.has(s.type)) {
        expect(s.missionTimer, `weapon building ${s.type} at (${s.cx},${s.cy})`)
          .toBeGreaterThanOrEqual(13);
        expect(s.missionTimer, `weapon building ${s.type} at (${s.cx},${s.cy})`)
          .toBeLessThanOrEqual(15);
      }
    }
  });

  it('civilian V19 buildings use non-weapon guard delay (Normal_Delay*3)', async () => {
    adapter = new NodeAgentAdapter();
    await adapter.loadScenario('SCG03EA', 'normal');
    const game = (adapter as any).game;

    adapter.step(1);

    // V19 are civilian buildings with no weapon — use Normal_Delay * 3 + jitter,
    // observed one frame lower after a full tick.
    for (let i = 0; i < game.structures.length; i++) {
      const s = game.structures[i];
      if (s.type === 'V19') {
        expect(s.missionTimer).toBeGreaterThanOrEqual(125);
        expect(s.missionTimer).toBeLessThanOrEqual(127);
      }
    }
  });
});
