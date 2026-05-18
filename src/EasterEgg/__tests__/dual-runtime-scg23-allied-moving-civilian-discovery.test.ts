/**
 * Dual-runtime check for player-allied moving infantry discovery.
 *
 * SCG23EA has a Spain C9 walking near USSR AREA_GUARD infantry. Spain is allied
 * to PlayerPtr, but C++ keeps this C9 IsDiscoveredByPlayer=false at tick 738:
 * its current cell is not player-mapped/visible, and no PCP_END Look(true) has
 * mapped a new player cell for it. TS must not treat continuous allied-house fog
 * as a placement reveal, or the USSR guard scan acquires the C9 on tick 739 and
 * skips the Random_Animate RNG path.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ensureParityServer,
  isDevServerAvailable,
  stepBoth,
  stopParityServer,
  withDualScenario,
  type DualStepResult,
  type ParityServerHandle,
} from './dual-runtime-test-utils.js';

const serverUp = isDevServerAvailable();
let serverHandle: ParityServerHandle | undefined;

type EvalPage = {
  evaluate<T>(fn: () => T): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function stepBothChunked(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<DualStepResult> {
  let result: DualStepResult | null = null;
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 900);
    result = await stepBoth(handle, chunk);
    remaining -= chunk;
  }
  if (!result) throw new Error('No step result produced');
  return result;
}

async function wasmScg23C9Snapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const allUnits = [...(state.units ?? []), ...(state.enemies ?? [])];
    const logic104 = (state.logicLayer ?? []).find((row: any[]) => row[0] === 104);
    const c9 = allUnits.find((u: any) =>
      u.t === 'C9' &&
      u.house === 'Spain' &&
      u.cx === 99 &&
      u.cy === 82 &&
      u.lx === 25544 &&
      u.ly === 21078) ??
      (logic104 && allUnits.find((u: any) =>
        u.t === 'C9' &&
        u.house === 'Spain' &&
        u.cx === logic104[3] &&
        u.cy === logic104[4]));
    if (!c9) throw new Error('C++ SCG23EA Spain C9 logic index 104 not found');

    const logic99 = (state.logicLayer ?? []).find((row: any[]) => row[0] === 99);
    if (!logic99) throw new Error('C++ SCG23EA AREA_GUARD scanner logic index 99 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      c9: {
        mission: c9.m,
        missionTimer: c9.mt,
        isDriving: c9.drv === true,
        discoveredByPlayer: c9.dp === true,
        visible: c9.vis === true,
        mapped: c9.map === true,
      },
      area99: {
        mission: logic99[7],
        missionTimer: logic99[8],
        targetRtti: logic99[32],
        targetIndex: logic99[33],
      },
    };
  });
}

async function tsScg23C9Snapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const c9 = game.entities.find((e: any) =>
      e.type === 'C9' &&
      e.house === 'Spain' &&
      e.cell.cx === 99 &&
      e.cell.cy === 82 &&
      e.leptonX === 25544 &&
      e.leptonY === 21078) ??
      game.entities.find((e: any) =>
        e.type === 'C9' &&
        e.house === 'Spain' &&
        e.logicIndexHint === 104);
    if (!c9) throw new Error('TS SCG23EA Spain C9 logic index 104 not found');

    const area99 = game.entities.find((e: any) => e.logicIndexHint === 99);
    if (!area99) throw new Error('TS SCG23EA AREA_GUARD scanner logic index 99 missing');

    return {
      tick: game.tick,
      rngState: state.rngState,
      c9: {
        mission: c9.mission,
        missionTimer: c9.missionTimer,
        isDriving: c9.isDriving === true,
        discoveredByPlayer: game.discoveredEntityIds.has(c9.id),
        visible: game.map.getVisibility(c9.cell.cx, c9.cell.cy) === 2,
        mapped: game.isCellMappedForPlayer(c9.cell.cx, c9.cell.cy),
        lastCellOccupierDownTick: c9.lastCellOccupierDownTick,
      },
      area99: {
        mission: area99.mission,
        missionTimer: area99.missionTimer,
        targetType: area99.target?.type ?? null,
        targetHouse: area99.target?.house ?? null,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG23 allied moving civilian discovery', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not discover a player-allied C9 from allied-house fog while it is still hidden from PlayerPtr', async () => {
    await withDualScenario('SCG23EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothChunked(handle, 738);
      const [cpp738, ts738] = await Promise.all([
        wasmScg23C9Snapshot(handle.wasm),
        tsScg23C9Snapshot(handle.ts),
      ]);

      expect(ts738.tick).toBe(cpp738.tick);
      expect(ts738.rngState >>> 0).toBe(cpp738.rngState >>> 0);
      expect(cpp738.c9).toMatchObject({
        mission: 2,
        missionTimer: 13,
        isDriving: true,
        discoveredByPlayer: false,
        visible: false,
        mapped: false,
      });
      expect(ts738.c9).toMatchObject({
        mission: 'MOVE',
        missionTimer: cpp738.c9.missionTimer,
        isDriving: true,
        discoveredByPlayer: false,
        visible: false,
        mapped: false,
      });

      await stepBoth(handle, 1);
      const [cpp739, ts739] = await Promise.all([
        wasmScg23C9Snapshot(handle.wasm),
        tsScg23C9Snapshot(handle.ts),
      ]);

      expect(ts739.tick).toBe(cpp739.tick);
      expect(ts739.rngState >>> 0).toBe(cpp739.rngState >>> 0);
      expect(cpp739.area99.targetRtti).toBe(-1);
      expect(ts739.area99.targetType).toBeNull();
      expect(ts739.area99.targetHouse).toBeNull();
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
