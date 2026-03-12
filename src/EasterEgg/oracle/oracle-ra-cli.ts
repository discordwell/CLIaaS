#!/usr/bin/env npx tsx
/**
 * Red Alert WASM Oracle CLI
 *
 * Tests the WASM emulator + oracle approach for Red Alert.
 * Modeled on Emperor's oracle-cli.ts but using the C++ agent harness
 * instead of vision-based state extraction.
 *
 * Usage:
 *   npx tsx src/EasterEgg/oracle/oracle-ra-cli.ts --test-clicks
 *   npx tsx src/EasterEgg/oracle/oracle-ra-cli.ts --test-agent
 *   npx tsx src/EasterEgg/oracle/oracle-ra-cli.ts --oracle --scenario=SCG01EA
 *   npx tsx src/EasterEgg/oracle/oracle-ra-cli.ts --headed --scenario=SCG01EA
 */

import { parseArgs } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WasmAdapter, type RAGameState, type AgentStepResult } from './WasmAdapter.js';
import { OracleStrategy, type OracleResult } from './OracleStrategy.js';

const { values } = parseArgs({
  options: {
    'test-clicks': { type: 'boolean', default: false },
    'test-agent': { type: 'boolean', default: false },
    'oracle': { type: 'boolean', default: false },
    'headed': { type: 'boolean', default: false },
    'scenario': { type: 'string', default: 'SCG01EA' },
    'url': { type: 'string', default: '' },
    'max-ticks': { type: 'string', default: '5000' },
    'ants': { type: 'boolean', default: false },
  },
  strict: true,
});

async function main() {
  const scenario = values.scenario!;
  const headless = !values.headed;
  const maxTicks = parseInt(values['max-ticks']!, 10);

  console.log(`[Oracle-RA] Mode: ${values['test-clicks'] ? 'test-clicks' : values['test-agent'] ? 'test-agent' : values.oracle ? 'oracle' : 'test-agent'}`);
  console.log(`[Oracle-RA] Scenario: ${scenario}, Headless: ${headless}, MaxTicks: ${maxTicks}`);

  const adapter = new WasmAdapter({
    scenario,
    headless,
    autoplay: true,
    ants: values.ants,
    url: values.url || undefined,
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Oracle-RA] Shutting down...');
    await adapter.disconnect();
    process.exit(0);
  });

  let exitCode = 0;

  try {
    await adapter.connect();

    if (values['test-clicks']) {
      await testMouseClicks(adapter);
    } else if (values['test-agent']) {
      await testAgentHarness(adapter, maxTicks);
    } else if (values.oracle) {
      const result = await runOracle(adapter, maxTicks);
      exitCode = result === 'victory' ? 0 : result === 'defeat' ? 1 : 2;
    } else {
      // Default: test both agent harness and clicks
      await testAgentHarness(adapter, maxTicks);
      await testMouseClicks(adapter);
    }
  } catch (e) {
    console.error('[Oracle-RA] Fatal error:', e);
    exitCode = 2;

    // Dump diagnostics
    try {
      const logs = await adapter.getLogs();
      const errors = await adapter.getErrors();
      const diag = await adapter.getDiag();
      console.log('\n--- WASM Logs (last 20) ---');
      logs.slice(-20).forEach(l => console.log(l));
      if (errors.length) {
        console.log('\n--- WASM Errors ---');
        errors.forEach(e => console.error(e));
      }
      console.log('\n--- Diagnostics ---');
      console.log(JSON.stringify(diag, null, 2));
    } catch { /* adapter may be dead */ }
  } finally {
    await adapter.disconnect();
  }

  process.exit(exitCode);
}

// ─── Test: Agent Harness ──────────────────────────────────────────────

async function testAgentHarness(adapter: WasmAdapter, maxTicks: number) {
  console.log('\n=== Testing Agent Harness (semantic commands) ===\n');

  // 1. Observe initial state
  const state0 = await adapter.observe();
  console.log(`Initial state: tick=${state0.tick} credits=${state0.credits}`);
  console.log(`  Units: ${state0.units.length}, Enemies: ${state0.enemies.length}, Structures: ${state0.structures.length}`);
  console.log(`  Power: produced=${state0.power.produced} consumed=${state0.power.consumed}`);

  if (state0.units.length > 0) {
    console.log('  First unit:', JSON.stringify(state0.units[0]));
  }
  if (state0.structures.length > 0) {
    console.log('  First structure:', JSON.stringify(state0.structures[0]));
  }

  // 2. Step forward and observe
  console.log('\nStepping 30 ticks...');
  const step1 = await adapter.step(30);
  console.log(`After step: tick=${step1.state.tick} credits=${step1.state.credits}`);
  console.log(`  Units: ${step1.state.units.length}, Enemies: ${step1.state.enemies.length}`);

  // 3. If we have units, try moving one
  if (step1.state.units.length > 0) {
    const unit = step1.state.units[0];
    const targetX = unit.cx + 3;
    const targetY = unit.cy + 3;
    console.log(`\nMoving unit ${unit.id} (${unit.t}) from (${unit.cx},${unit.cy}) to (${targetX},${targetY})`);

    const cmdResult = await adapter.command([
      { cmd: 'move', ids: [unit.id], cx: targetX, cy: targetY },
    ]);
    console.log('Command result:', JSON.stringify(cmdResult));

    // Step to let the unit start moving
    const step2 = await adapter.step(60);
    const movedUnit = step2.state.units.find(u => u.id === unit.id);
    if (movedUnit) {
      console.log(`After 60 ticks: unit at (${movedUnit.cx},${movedUnit.cy}), mission=${movedUnit.m}`);
    }
  }

  // 4. Run a longer simulation
  console.log(`\nRunning ${maxTicks} ticks of simulation...`);
  let state = step1.state;
  const ticksBatch = 60;
  for (let totalTicks = step1.state.tick; totalTicks < maxTicks + step1.state.tick; totalTicks += ticksBatch) {
    const result = await adapter.step(ticksBatch);
    state = result.state;
    if (totalTicks % 300 === 0 || totalTicks === step1.state.tick) {
      console.log(`  tick=${state.tick} credits=${state.credits} units=${state.units.length} enemies=${state.enemies.length} structures=${state.structures.length}`);
    }
  }

  // Save a screenshot
  const ssPath = path.join(process.cwd(), 'artifacts', 'oracle-ra-agent-test.png');
  fs.mkdirSync(path.dirname(ssPath), { recursive: true });
  const ss = await adapter.screenshot();
  fs.writeFileSync(ssPath, ss);
  console.log(`\nScreenshot saved: ${ssPath}`);

  console.log('\n=== Agent Harness Test Complete ===');
}

// ─── Test: Mouse Clicks ──────────────────────────────────────────────

async function testMouseClicks(adapter: WasmAdapter) {
  console.log('\n=== Testing Mouse Click Injection ===\n');

  // Get current state
  const state = await adapter.observe();
  console.log(`Game state: tick=${state.tick} units=${state.units.length}`);

  // Screenshot before
  const ssBefore = await adapter.screenshot();
  const beforePath = path.join(process.cwd(), 'artifacts', 'oracle-ra-click-before.png');
  fs.mkdirSync(path.dirname(beforePath), { recursive: true });
  fs.writeFileSync(beforePath, ssBefore);
  console.log(`Before screenshot: ${beforePath}`);

  // Test 1: Check input buffer before any clicks
  const diagBefore = await adapter.inputDiag();
  console.log(`Input buffer has data (before click): ${diagBefore}`);

  // Test 2: Inject a mouse move to center of screen
  console.log('\nInjecting mouse move to (160, 100)...');
  const moveResult = await adapter.mouseMove(160, 100);
  console.log(`  inject_mouse_move result: ${moveResult}`);

  // Test 3: Inject a left click at center of screen
  console.log('Injecting left click at (160, 100)...');
  const clickResult = await adapter.mouseClick(160, 100, 1);
  console.log(`  inject_mouse_click result: ${clickResult}`);

  // Check input buffer after click
  const diagAfter = await adapter.inputDiag();
  console.log(`  Input buffer has data (after click): ${diagAfter}`);

  // Step a few ticks so the game processes the click
  console.log('Stepping 5 ticks to let game process input...');
  const stepResult = await adapter.step(5);
  console.log(`  tick=${stepResult.state.tick}`);

  // Test 4: Inject right click
  console.log('\nInjecting right click at (160, 100)...');
  const rClickResult = await adapter.mouseClick(160, 100, 2);
  console.log(`  inject_mouse_click (right) result: ${rClickResult}`);
  await adapter.step(5);

  // Test 5: Click on a unit if one exists
  if (state.units.length > 0) {
    const unit = state.units[0];
    // Convert cell coords to game pixel coords (cell * 24 = pixel, but game is 320x200)
    // Actually the game coords for inject_mouse_click are 0-319, 0-199 (screen space)
    // The camera position matters — we need to figure out the screen position of the unit
    console.log(`\nUnit ${unit.t} at cell (${unit.cx}, ${unit.cy})`);
    console.log('Note: Click coordinates are screen-space (0-319, 0-199), not world-space.');
    console.log('Without camera info, we cannot reliably click on a specific unit.');
    console.log('This is a known limitation — the agent_command API is preferred for unit control.');
  }

  // Test 6: Click on sidebar area (right side of 320x200 screen)
  // In RA, the sidebar is on the right side (roughly x=240-319)
  console.log('\nInjecting click on sidebar area (280, 50)...');
  const sidebarClick = await adapter.mouseClick(280, 50, 1);
  console.log(`  inject_mouse_click (sidebar) result: ${sidebarClick}`);
  await adapter.step(5);

  // Test 7: Verify state changed (or didn't) after clicks
  const stateAfter = await adapter.observe();
  console.log(`\nState after clicks: tick=${stateAfter.tick} credits=${stateAfter.credits}`);
  console.log(`  Units: ${stateAfter.units.length}, Enemies: ${stateAfter.enemies.length}`);

  // Screenshot after
  const ssAfter = await adapter.screenshot();
  const afterPath = path.join(process.cwd(), 'artifacts', 'oracle-ra-click-after.png');
  fs.writeFileSync(afterPath, ssAfter);
  console.log(`After screenshot: ${afterPath}`);

  // Test 8: Rapid click test — inject 10 clicks fast and check buffer doesn't overflow
  console.log('\nRapid click test (10 clicks)...');
  let allOk = true;
  for (let i = 0; i < 10; i++) {
    const x = 50 + i * 20;
    const y = 100;
    const result = await adapter.mouseClick(x, y, 1);
    if (result !== 1) {
      console.log(`  Click ${i} at (${x}, ${y}) FAILED: result=${result}`);
      allOk = false;
    }
  }
  if (allOk) {
    console.log('  All 10 rapid clicks returned success (1)');
  }
  // Step to process them
  await adapter.step(15);
  const diagFinal = await adapter.inputDiag();
  console.log(`  Input buffer after rapid clicks + step: has_data=${diagFinal}`);

  console.log('\n=== Mouse Click Test Complete ===');
  console.log('\nSummary:');
  console.log(`  inject_mouse_click works: ${clickResult === 1 ? 'YES (returned 1)' : 'NO (returned 0)'}`);
  console.log(`  inject_mouse_move works: ${moveResult === 1 ? 'YES' : 'NO'}`);
  console.log(`  Buffer accepted clicks: ${diagAfter ? 'YES' : 'POSSIBLE ISSUE — buffer empty after inject'}`);
  console.log(`  Game processes clicks: Check screenshots to verify visual change`);
}

// ─── Oracle Loop ──────────────────────────────────────────────────────

async function runOracle(adapter: WasmAdapter, maxTicks: number): Promise<OracleResult> {
  console.log('\n=== Oracle Loop (observe → decide → act) ===\n');

  const strategy = new OracleStrategy();
  const artifactsDir = path.join(process.cwd(), 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  let iteration = 0;
  let totalGameTicks = 0;
  let result: OracleResult = 'playing';

  while (totalGameTicks < maxTicks) {
    // 1. Observe
    const state = await adapter.observe();

    // 2. Check for game end
    result = strategy.checkResult(state);
    if (result !== 'playing') {
      console.log(`[Oracle] Game ended: ${result}`);
      break;
    }

    // 3. Decide
    const decision = strategy.decide(state);

    // 4. Act
    const cmdJson = decision.commands.length > 0
      ? JSON.stringify(decision.commands)
      : undefined;
    const stepResult = await adapter.step(30, cmdJson);
    totalGameTicks += 30;

    // 5. Report (every 10 iterations)
    if (iteration % 10 === 0) {
      console.log(strategy.summarize(stepResult.state, iteration, decision));
    }

    // 6. Periodic screenshots (every ~1000 game ticks ≈ 33 iterations)
    if (iteration % 33 === 0) {
      const ssPath = path.join(artifactsDir, `oracle-ra-tick${stepResult.state.tick}.png`);
      const ss = await adapter.screenshot();
      fs.writeFileSync(ssPath, ss);
    }

    iteration++;
  }

  if (result === 'playing') {
    result = 'timeout';
    console.log(`[Oracle] Timeout after ${maxTicks} ticks`);
  }

  // Final screenshot
  const ssPath = path.join(artifactsDir, 'oracle-ra-final.png');
  const ss = await adapter.screenshot();
  fs.writeFileSync(ssPath, ss);
  console.log(`\nFinal screenshot: ${ssPath}`);
  console.log(`[Oracle] Result: ${result} | ${iteration} iterations, ${totalGameTicks} game ticks`);

  return result;
}

main().catch(console.error);
