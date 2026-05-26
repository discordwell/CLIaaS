/**
 * Dual-runtime regression for SCA04EA tunnel shroud.
 *
 * C++ TACTION_CREEP_SHADOW calls DisplayClass::Encroach_Shadow(), which only
 * shrouds mapped shadow-edge cells and then immediately runs All_To_Look().
 * The starting room must remain rendered after the early `shrd` trigger fires.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ensureParityServer,
  isDevServerAvailable,
  stepBoth,
  stopParityServer,
  withDualScenario,
  type ParityServerHandle,
} from './dual-runtime-test-utils.js';

const serverUp = isDevServerAvailable();
let serverHandle: ParityServerHandle | undefined;

type EvalPage = {
  evaluate<T>(fn: (...args: never[]) => T): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCA04 creep shadow', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps currently visible starting-room cells mapped after shrd fires', async () => {
    await withDualScenario('SCA04EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      for (let remaining = 120; remaining > 0;) {
        const chunk = Math.min(15, remaining);
        await stepBoth(handle, chunk);
        remaining -= chunk;
      }

      const cpp = await adapterPage(handle.wasm).evaluate(() => {
        const M = (window as any).Module;
        const state = JSON.parse(M.ccall('agent_get_state', 'string', [], []));
        const cell = JSON.parse(M.ccall(
          'agent_get_cell_info',
          'string',
          ['number', 'number', 'number'],
          [116, 64, -1],
        ));
        return { tick: state.tick, mapped: cell.mapped, visible: cell.visible };
      });
      const ts = await adapterPage(handle.ts).evaluate(() => {
        const game = (window as any).__agentGame;
        const state = (window as any).__agentState();
        return {
          tick: state.tick,
          playerMapped: game.isCellMappedForPlayer(116, 64),
          displayVisibility: game.map.getDisplayVisibility(116, 64),
          mapVisibility: game.map.getVisibility(116, 64),
        };
      });

      expect(ts.tick).toBe(cpp.tick);
      expect(cpp.mapped).toBe(true);
      expect(cpp.visible).toBe(true);
      expect(ts.playerMapped).toBe(true);
      expect(ts.displayVisibility).toBe(2);
      expect(ts.mapVisibility).toBe(2);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 180_000);
});
