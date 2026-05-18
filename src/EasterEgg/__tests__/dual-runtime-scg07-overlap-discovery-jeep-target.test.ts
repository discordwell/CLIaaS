/**
 * Dual-runtime check for mapped-overlap discovery being event-driven.
 *
 * SCG07EA has an undiscovered USSR flamethrower near (30,59). A mapped cell
 * touches its infantry overlap footprint, but C++ does not reveal it until the
 * object is actually marked down through MapClass::Place_Down/Overlap_Down.
 * Treating overlap as a continuous visibility query lets the nearby England
 * JEEP acquire the flamethrower and fire three RNG calls early.
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

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmScg07Snapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const e4 = (state.enemies ?? []).find((u: any) =>
      u.t === 'E4' && u.house === 'USSR' && u.cx === 30 && u.cy === 59);
    if (!e4) throw new Error('C++ SCG07EA E4 at (30,59) missing');

    const jeep = (state.logicLayer ?? []).find((row: any[]) =>
      row[1] === 'JEEP' && row[2] === 'England' && row[3] === 27 && row[4] === 58);
    if (!jeep) throw new Error('C++ SCG07EA England JEEP at (27,58) missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      e4: {
        discovered: !!e4.dp,
        visible: !!e4.vis,
        mapped: !!e4.map,
      },
      jeep: {
        mission: jeep[7],
        missionTimer: jeep[8],
        targetKind: jeep[30],
        targetX: jeep[21],
        targetY: jeep[22],
      },
    };
  });
}

async function tsScg07Snapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const e4 = game.entities.find((e: any) =>
      e.logicIndexHint === 110 || (e.type === 'E4' && e.house === 'USSR' && e.cell?.cx === 30 && e.cell?.cy === 59));
    if (!e4) throw new Error('TS SCG07EA E4 at (30,59) missing');

    const jeep = game.entities.find((e: any) =>
      e.logicIndexHint === 58 || (e.type === 'JEEP' && e.house === 'England' && e.cell?.cx === 27 && e.cell?.cy === 58));
    if (!jeep) throw new Error('TS SCG07EA England JEEP at (27,58) missing');

    const state = (window as any).__agentState();
    return {
      tick: game.tick,
      rngState: state.rngState,
      e4: {
        discovered: game.discoveredEntityIds.has(e4.id),
        centerMapped: game.isCellMappedForPlayer(e4.cell.cx, e4.cell.cy),
        overlapTouchesMapped: game.infantryOverlapTouchesPlayerMappedCell(e4),
        lastDownTick: e4.lastCellOccupierDownTick,
      },
      jeep: {
        mission: jeep.mission,
        missionTimer: jeep.missionTimer,
        targetType: jeep.target?.type ?? null,
        targetCell: jeep.target ? { cx: jeep.target.cell.cx, cy: jeep.target.cell.cy } : null,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG07 mapped-overlap discovery', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not let a stationary overlap-only E4 become a JEEP guard target', async () => {
    await withDualScenario('SCG07EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 130);
      const cppBefore = await wasmScg07Snapshot(handle.wasm);
      const tsBefore = await tsScg07Snapshot(handle.ts);

      expect(cppBefore.e4.discovered).toBe(false);
      expect(tsBefore.e4.discovered).toBe(cppBefore.e4.discovered);
      expect(tsBefore.e4.centerMapped).toBe(false);
      expect(tsBefore.e4.overlapTouchesMapped).toBe(true);

      await stepBoth(handle, 1);
      const cppAfter = await wasmScg07Snapshot(handle.wasm);
      const tsAfter = await tsScg07Snapshot(handle.ts);

      expect(cppAfter.tick).toBe(131);
      expect(tsAfter.tick).toBe(cppAfter.tick);
      expect(cppAfter.jeep.targetKind).toBe(-1);
      expect(tsAfter.jeep.targetType).toBeNull();
      expect(tsAfter.rngState >>> 0).toBe(cppAfter.rngState >>> 0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
