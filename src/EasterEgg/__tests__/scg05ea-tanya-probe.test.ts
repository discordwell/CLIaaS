import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { TsAgentAdapter } from '../oracle/TsAgentAdapter.js';

const BASE_URL = process.env.RA_PARITY_BASE_URL ?? 'http://localhost:3001';

describe('SCG05EA Tanya terrain probe', () => {
  let adapter: TsAgentAdapter;

  beforeAll(async () => {
    adapter = new TsAgentAdapter({ url: BASE_URL, headless: true });
    await adapter.connect();
  }, 120_000);

  afterAll(async () => {
    await adapter.disconnect();
  }, 20_000);

  it('probes terrain around SAMs and barrels by warping Tanya', async () => {
    await adapter.loadScenario('SCG05EA');

    // Fast-forward: spy infiltrates, Tanya spawns
    // Step to tick 300 (spy appears)
    let state = (await adapter.step(300)).state;
    const spy = state.units.find((u: { t: string }) => u.t === 'SPY');
    console.log('Spy at: ' + spy?.cx + ',' + spy?.cy);

    // Set globals to trigger Tanya
    await adapter.step(1, [{ cmd: 'set_global', data: 18 } as never]);
    // Wait for Tanya to spawn
    for (let i = 0; i < 20; i++) {
      state = (await adapter.step(30)).state;
      const tanya = state.units.find((u: { t: string }) => u.t === 'E7');
      if (tanya) {
        console.log('Tanya spawned at: ' + tanya.cx + ',' + tanya.cy);
        break;
      }
    }

    const tanya = state.units.find((u: { t: string }) => u.t === 'E7');
    if (!tanya) { console.log('NO TANYA'); return; }

    // Probe: warp Tanya to various positions and try to move
    const probePositions = [
      [20, 87], [21, 87], [22, 87], [23, 87],
      [20, 88], [21, 88], [22, 88], [25, 88], [27, 88], [28, 88],
      [20, 90], [22, 90], [25, 90],
      [20, 93], [22, 93], [17, 93], [15, 93],
      [20, 95], [22, 95], [17, 95],
      [22, 100], [22, 103], [22, 105], [22, 107],
    ];

    console.log('\n=== TERRAIN PROBE (warp + move test) ===');
    for (const [px, py] of probePositions) {
      // Warp Tanya and immediately check (1 tick — no time to be killed)
      const wr = await adapter.step(1, [{ cmd: 'warp_unit', unitId: tanya.id, cx: px, cy: py } as never]);
      // Quick move test — just 5 ticks
      await adapter.step(1, [{ cmd: 'move', unitIds: [tanya.id], cx: px + 2, cy: py }]);
      state = (await adapter.step(5)).state;
      const t = state.units.find((u: { t: string }) => u.t === 'E7');
      if (!t) { console.log('  (' + px + ',' + py + ') → DEAD'); continue; }
      const moved = t.cx !== px || t.cy !== py;
      const label = moved ? 'MOVED to (' + t.cx + ',' + t.cy + ')' : 'STUCK';
      console.log('  (' + px + ',' + py + ') → ' + label);

      // List nearby enemy structures
      const nearStructs = state.structures.filter((s: { cx: number; cy: number; ally: boolean; t: string }) => {
        if (s.ally) return false;
        const dx = s.cx - px; const dy = s.cy - py;
        return dx * dx + dy * dy <= 36;
      });
      if (nearStructs.length > 0) {
        console.log('    nearby structs: ' + nearStructs.map((s: { t: string; cx: number; cy: number }) => s.t + '(' + s.cx + ',' + s.cy + ')').join(', '));
      }
    }

    expect(true).toBe(true);
  }, 300_000);
});
