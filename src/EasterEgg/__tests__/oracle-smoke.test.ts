/**
 * Oracle smoke test: verifies WasmAdapter can launch the game,
 * reach gameplay state, observe units, issue commands, and take screenshots.
 *
 * Requires Playwright + the WASM build in public/ra/.
 * Timeout: 240s (game needs ~30-90s to load WASM + navigate menus via autoplay).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { WasmAdapter } from '../oracle/WasmAdapter.js';

// Share a single adapter across tests (game takes ~60-90s to boot)
let adapter: WasmAdapter;

afterAll(async () => {
  if (adapter) await adapter.disconnect();
}, 10_000);

describe('Oracle smoke test (WASM)', { timeout: 240_000 }, () => {
  it('connects and reaches gameplay with tick > 0 and units', async () => {
    adapter = new WasmAdapter({
      scenario: 'SCG01EA',
      headless: true,
      autoplay: true,
    });

    await adapter.connect();

    const state = await adapter.observe();
    expect(state.tick).toBeGreaterThan(0);
    expect(state.units.length).toBeGreaterThan(0);
    expect(state.error).toBeUndefined();
  }, 200_000);

  it('issues a move command and unit responds', async () => {
    const state0 = await adapter.observe();
    expect(state0.units.length).toBeGreaterThan(0);

    const unit = state0.units[0];
    const targetX = unit.cx + 3;
    const targetY = unit.cy + 3;

    const cmdResult = await adapter.command([
      { cmd: 'move', ids: [unit.id], cx: targetX, cy: targetY },
    ]);
    expect(cmdResult).toBeInstanceOf(Array);
    expect(cmdResult.length).toBeGreaterThan(0);
    expect(cmdResult[0].ok).toBe(true);

    // Step to let the unit start moving
    const stepResult = await adapter.step(60);
    const movedUnit = stepResult.state.units.find((u) => u.id === unit.id);
    // Unit should have changed position or mission (may not have reached target yet)
    if (movedUnit) {
      const moved = movedUnit.cx !== unit.cx || movedUnit.cy !== unit.cy || movedUnit.m !== unit.m;
      expect(moved).toBe(true);
    }
  });

  it('takes a non-blank screenshot', async () => {
    const screenshot = await adapter.screenshot();
    expect(screenshot).toBeInstanceOf(Buffer);
    expect(screenshot.length).toBeGreaterThan(1000); // blank PNG is ~200 bytes

    // Verify it's a valid PNG (magic bytes: 89 50 4E 47)
    expect(screenshot[0]).toBe(0x89);
    expect(screenshot[1]).toBe(0x50); // P
    expect(screenshot[2]).toBe(0x4e); // N
    expect(screenshot[3]).toBe(0x47); // G
  });
});
