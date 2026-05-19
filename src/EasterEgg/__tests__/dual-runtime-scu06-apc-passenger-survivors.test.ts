/**
 * Dual-runtime check for UnitClass transport death cargo handling.
 *
 * In SCU06EB a USSR APC at C++ logic[95] is destroyed by a projectile on tick
 * 713. C++ UnitClass::Take_Damage does not use TechnoClass::Kill_Cargo for
 * ground transports: it detaches each attached infantry passenger, Unlimbo()s
 * it at the destroyed transport coordinate, calls Scatter(0,true), and submits
 * it to Logic. The five E6 passengers therefore run Mission_Guard in that same
 * tick, then Commence() promotes the MOVE queued by Scatter(0,true). TS must not
 * erase those passengers as a generic transport-death rule.
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
  evaluate<T>(fn: () => T): Promise<T>;
};

interface SurvivorSnapshot {
  logicIndex: number;
  type: string;
  house: string;
  cx: number;
  cy: number;
  mission: number | string;
  missionTimer: number;
  alive?: boolean;
}

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function stepBothInChunks(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<void> {
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 900);
    await stepBoth(handle, chunk);
    remaining -= chunk;
  }
}

async function wasmSurvivors(adapter: unknown): Promise<SurvivorSnapshot[]> {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    return ((state.logicLayer ?? []) as any[])
      .filter(row => row[0] >= 108 && row[0] <= 112)
      .map(row => ({
        logicIndex: row[0],
        type: row[1],
        house: row[2],
        cx: row[3],
        cy: row[4],
        mission: row[7],
        missionTimer: row[8],
      }));
  });
}

async function tsSurvivors(adapter: unknown): Promise<SurvivorSnapshot[]> {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    return game.entities
      .filter((entity: any) =>
        entity.type === 'E6' &&
        entity.house === 'USSR' &&
        entity.alive &&
        entity.cell?.cx === 39 &&
        entity.cell?.cy === 62)
      .map((entity: any) => ({
        logicIndex: entity.logicIndexHint,
        type: entity.type,
        house: entity.house,
        cx: entity.cell?.cx,
        cy: entity.cell?.cy,
        mission: entity.mission,
        missionTimer: entity.missionTimer,
        alive: entity.alive,
      }))
      .sort((a: SurvivorSnapshot, b: SurvivorSnapshot) => a.logicIndex - b.logicIndex);
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU06 APC passenger survivors', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('ejects infantry cargo from destroyed ground transports before same-tick guard AI', async () => {
    await withDualScenario('SCU06EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 712);
      await adapterPage(handle.ts).evaluate(() => {
        (window as any).__rngTagControl?.('enable');
        (window as any).__rngTagControl?.('reset');
      });

      const step = await stepBoth(handle, 1);
      const cpp = await wasmSurvivors(handle.wasm);
      const ts = await tsSurvivors(handle.ts);

      expect(step.wasm.state.tick).toBe(713);
      expect(step.ts.state.tick).toBe(713);
      expect(cpp).toEqual([
        { logicIndex: 108, type: 'E6', house: 'USSR', cx: 39, cy: 62, mission: 2, missionTimer: 0 },
        { logicIndex: 109, type: 'E6', house: 'USSR', cx: 39, cy: 62, mission: 2, missionTimer: 0 },
        { logicIndex: 110, type: 'E6', house: 'USSR', cx: 39, cy: 62, mission: 2, missionTimer: 0 },
        { logicIndex: 111, type: 'E6', house: 'USSR', cx: 39, cy: 62, mission: 2, missionTimer: 0 },
        { logicIndex: 112, type: 'E6', house: 'USSR', cx: 39, cy: 62, mission: 2, missionTimer: 0 },
      ]);
      expect(ts).toHaveLength(5);
      for (const survivor of ts) {
        expect(survivor).toMatchObject({
          type: 'E6',
          house: 'USSR',
          cx: 39,
          cy: 62,
          mission: 'MOVE',
          missionTimer: 0,
          alive: true,
        });
      }
      expect(ts.map(s => s.logicIndex)).toEqual([...ts.map(s => s.logicIndex)].sort((a, b) => a - b));
      expect(step.ts.state.rngState >>> 0).toBe(step.wasm.state.rngState! >>> 0);
    }, { preserveSourceFog: true });
  }, 180_000);
});
