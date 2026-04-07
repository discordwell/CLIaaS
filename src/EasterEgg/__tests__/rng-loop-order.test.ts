/**
 * RNG Loop Order Test — traces per-tick RNG consumption for SCG02EA
 * to identify where TS diverges from C++ Logic layer processing order.
 *
 * C++ source: Logic::AI() processes ALL objects (units, infantry, buildings,
 * aircraft) in a single unified loop. TS processes them in 3 separate passes.
 * This test captures the exact RNG call sequence for comparison with WASM rngLog.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from 'vitest';
import { NodeAgentAdapter } from './node-agent-adapter';
import { ScenarioRandom } from '../engine/random';

describe('RNG loop order — SCG02EA tick-by-tick trace', () => {
  let adapter: NodeAgentAdapter;

  afterEach(() => {
    adapter?.disconnect();
    // Reset RNG audit state thoroughly
    ScenarioRandom._tagLogging = false;
    ScenarioRandom._seedLog = [];
    ScenarioRandom._taggedLog = [];
    ScenarioRandom._sourceTag = 0;
    ScenarioRandom.callCount = 0;
    ScenarioRandom.seed = 0;
  });

  it('tick 1: dumps RNG seedLog with source tags', async () => {
    adapter = new NodeAgentAdapter();
    const initState = await adapter.loadScenario('SCG02EA', 'normal');

    // Record call count before tick 1
    const callsBefore = ScenarioRandom.callCount;
    const seedBefore = ScenarioRandom.seed >>> 0;

    // Enable source-tag logging
    ScenarioRandom._tagLogging = true;
    ScenarioRandom._seedLog = [];
    ScenarioRandom._taggedLog = [];

    // Step 1 tick
    const result = adapter.step(1);
    ScenarioRandom._tagLogging = false;

    const callsAfter = ScenarioRandom.callCount;
    const seedAfter = ScenarioRandom.seed >>> 0;
    const tickCalls = callsAfter - callsBefore;

    console.log('=== TICK 1 RNG TRACE ===');
    console.log(`Calls: ${tickCalls} (${callsBefore} -> ${callsAfter})`);
    console.log(`Seed: ${seedBefore} -> ${seedAfter}`);
    console.log(`SeedLog entries: ${ScenarioRandom._seedLog.length}`);

    // Group by source tag category
    const tagCounts: Record<string, number> = {};
    for (const [, tag] of ScenarioRandom._seedLog) {
      let cat: string;
      if (tag >= 10000 && tag < 11000) cat = `infantry`;
      else if (tag >= 11000 && tag < 12000) cat = `unit`;
      else if (tag >= 12000 && tag < 13000) cat = `building`;
      else if (tag >= 13000 && tag < 14000) cat = `aircraft`;
      else cat = `other(${tag})`;
      tagCounts[cat] = (tagCounts[cat] || 0) + 1;
    }
    console.log('\nBy category:');
    for (const [cat, count] of Object.entries(tagCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count}x ${cat}`);
    }

    // Dump detailed log (seed, tag, caller)
    console.log('\nDetailed call log:');
    for (let i = 0; i < ScenarioRandom._seedLog.length; i++) {
      const [seed, tag] = ScenarioRandom._seedLog[i];
      const caller = ScenarioRandom._taggedLog[i] || '?';
      let tagName: string;
      if (tag >= 10000 && tag < 11000) tagName = `INF[${tag - 10000}]`;
      else if (tag >= 11000 && tag < 12000) tagName = `UNIT[${tag - 11000}]`;
      else if (tag >= 12000 && tag < 13000) tagName = `BLDG[${tag - 12000}]`;
      else if (tag >= 13000 && tag < 14000) tagName = `ACFT[${tag - 13000}]`;
      else tagName = `tag=${tag}`;
      console.log(`  #${i}: seed=${seed} ${tagName} ${caller}`);
    }

    // Basic sanity: should have at least entity + structure calls
    expect(tickCalls).toBeGreaterThan(30);
    expect(ScenarioRandom._seedLog.length).toBe(tickCalls);
  });

  it('tick 1: reinforcement entities (MCV) are processed AFTER buildings', async () => {
    adapter = new NodeAgentAdapter();
    await adapter.loadScenario('SCG02EA', 'normal');

    const game = (adapter as any).game;
    const preCount = game._preBuildingEntityCount;

    // step(1) triggers the built-in tag logging (ticks 1-15) via update()
    adapter.step(1);

    // The update() at tick 1 enables tag logging and populates _seedLog.
    // Find the last building call and the first post-building entity call.
    let lastBuildingLogIdx = -1;
    let firstPostBuildingUnitLogIdx = -1;

    for (let i = 0; i < ScenarioRandom._seedLog.length; i++) {
      const [, tag] = ScenarioRandom._seedLog[i];
      if (tag >= 12000 && tag < 13000) {
        lastBuildingLogIdx = i;
      }
      // Post-building ground entity: uses _entityIdx >= preCount
      // For units: tag = 11000 + _entityIdx >= 11000 + preCount
      // For infantry: tag = 10000 + _entityIdx >= 10000 + preCount
      const unitThreshold = 11000 + preCount;
      const infThreshold = 10000 + preCount;
      if ((tag >= unitThreshold && tag < 12000) || (tag >= infThreshold && tag < 11000)) {
        if (firstPostBuildingUnitLogIdx < 0) firstPostBuildingUnitLogIdx = i;
      }
    }

    console.log(`_preBuildingEntityCount = ${preCount}`);
    console.log(`entities after step = ${game.entities.length}`);
    console.log(`seedLog entries = ${ScenarioRandom._seedLog.length}`);
    console.log(`Last building RNG call at seedLog index ${lastBuildingLogIdx}`);
    console.log(`First post-building entity RNG call at seedLog index ${firstPostBuildingUnitLogIdx}`);

    // C++ parity: MCV (reinforcement spawned at tick 1) must be processed
    // AFTER all buildings in the Logic layer, matching C++ insertion order.
    expect(firstPostBuildingUnitLogIdx, 'post-building entity should exist').toBeGreaterThan(-1);
    expect(lastBuildingLogIdx, 'building calls should exist').toBeGreaterThan(-1);
    expect(firstPostBuildingUnitLogIdx, 'post-building entity should come after last building').toBeGreaterThan(lastBuildingLogIdx);
  });

  it('tick 1-15: per-tick RNG call counts', async () => {
    adapter = new NodeAgentAdapter();
    await adapter.loadScenario('SCG02EA', 'normal');

    console.log('=== PER-TICK RNG CALLS (ticks 1-15) ===');

    for (let tick = 1; tick <= 15; tick++) {
      const callsBefore = ScenarioRandom.callCount;
      ScenarioRandom._tagLogging = true;
      ScenarioRandom._seedLog = [];

      adapter.step(1);

      ScenarioRandom._tagLogging = false;
      const tickCalls = ScenarioRandom.callCount - callsBefore;

      // Count by category
      const cats: Record<string, number> = {};
      for (const [, tag] of ScenarioRandom._seedLog) {
        let cat: string;
        if (tag >= 10000 && tag < 11000) cat = 'inf';
        else if (tag >= 11000 && tag < 12000) cat = 'unit';
        else if (tag >= 12000 && tag < 13000) cat = 'bldg';
        else if (tag >= 13000 && tag < 14000) cat = 'acft';
        else cat = 'other';
        cats[cat] = (cats[cat] || 0) + 1;
      }

      const parts = Object.entries(cats).map(([k, v]) => `${k}=${v}`).join(' ');
      console.log(`  tick ${tick}: ${tickCalls} calls  [${parts}]  seed=${ScenarioRandom.seed >>> 0}`);
    }
  });
});
