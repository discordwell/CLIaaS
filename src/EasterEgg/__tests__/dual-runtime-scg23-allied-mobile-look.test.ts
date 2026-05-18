/**
 * Dual-runtime check for allied mobile TechnoClass::Look().
 *
 * In SCG23EA, the Spain C7 at logic index 107 moves through the combat area.
 * C++ InfantryClass::Per_Cell_Process calls Look(true) at cell arrival; because
 * Spain is allied to PlayerPtr, DisplayClass::Map_Cell remaps that sight to the
 * player and the C7 becomes IsDiscoveredByPlayer before nearby USSR AREA_GUARD
 * infantry scan on tick 72. TS must not fake this as continuous allied fog, but
 * the event-driven mobile Look has to run when the C7 reaches a cell.
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
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmScg23AlliedLookSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const logicLayer = (state.logicLayer ?? []) as any[][];
    const allUnits = [...(state.units ?? []), ...(state.enemies ?? [])];
    const c7Logic = logicLayer.find((row) => row[0] === 107);
    const area99 = logicLayer.find((row) => row[0] === 99);
    const area100 = logicLayer.find((row) => row[0] === 100);
    if (!c7Logic || c7Logic[1] !== 'C7' || c7Logic[2] !== 'Spain') {
      throw new Error('C++ SCG23EA Spain C7 logic index 107 not found');
    }
    if (!area99 || !area100) throw new Error('C++ SCG23EA AREA_GUARD scanners missing');

    const c7State = allUnits.find((u: any) =>
      u.t === 'C7' &&
      u.house === 'Spain' &&
      u.cx === c7Logic[3] &&
      u.cy === c7Logic[4]);
    if (!c7State) throw new Error('C++ SCG23EA Spain C7 state not found');

    const c7TargetIndex = c7Logic[6] & 0xffff;
    const unitTarget = (row: any[]) => ({
      mission: row[7],
      missionTimer: row[8],
      targetRtti: row[32],
      targetIndex: row[33],
    });

    return {
      tick: state.tick,
      rngState: state.rngState,
      c7: {
        cx: c7Logic[3],
        cy: c7Logic[4],
        discoveredByPlayer: c7State.dp === true,
        visible: c7State.vis === true,
        mapped: c7State.map === true,
        targetIndex: c7TargetIndex,
      },
      area99: unitTarget(area99),
      area100: unitTarget(area100),
    };
  }, undefined);
}

async function tsScg23AlliedLookSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const c7 = game.entities.find((e: any) => e.logicIndexHint === 107);
    const area99 = game.entities.find((e: any) => e.logicIndexHint === 99);
    const area100 = game.entities.find((e: any) => e.logicIndexHint === 100);
    if (!c7 || c7.type !== 'C7' || c7.house !== 'Spain') {
      throw new Error('TS SCG23EA Spain C7 logic index 107 not found');
    }
    if (!area99 || !area100) throw new Error('TS SCG23EA AREA_GUARD scanners missing');

    const unitTarget = (entity: any) => ({
      mission: entity.mission,
      missionTimer: entity.missionTimer,
      targetLogicIndex: entity.target?.logicIndexHint ?? null,
      targetType: entity.target?.type ?? null,
      targetHouse: entity.target?.house ?? null,
    });

    return {
      tick: game.tick,
      rngState: state.rngState,
      c7: {
        cx: c7.cell.cx,
        cy: c7.cell.cy,
        discoveredByPlayer: game.discoveredEntityIds.has(c7.id),
        visible: game.map.getVisibility(c7.cell.cx, c7.cell.cy) === 2,
        mapped: game.isCellMappedForPlayer(c7.cell.cx, c7.cell.cy),
      },
      area99: unitTarget(area99),
      area100: unitTarget(area100),
    };
  }, undefined);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG23 allied mobile Look', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('discovers the moving allied C7 before USSR AREA_GUARD scanners consume random animate RNG', async () => {
    await withDualScenario('SCG23EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 71);
      const cpp71 = await wasmScg23AlliedLookSnapshot(handle.wasm);
      const ts71 = await tsScg23AlliedLookSnapshot(handle.ts);

      expect(ts71.tick).toBe(cpp71.tick);
      expect(cpp71.c7.discoveredByPlayer).toBe(true);
      expect(cpp71.c7.visible).toBe(true);
      expect(cpp71.c7.mapped).toBe(true);
      expect(ts71.c7.cx).toBe(cpp71.c7.cx);
      expect(ts71.c7.cy).toBe(cpp71.c7.cy);
      expect(ts71.c7.discoveredByPlayer).toBe(cpp71.c7.discoveredByPlayer);

      await stepBoth(handle, 1);
      const cpp72 = await wasmScg23AlliedLookSnapshot(handle.wasm);
      const ts72 = await tsScg23AlliedLookSnapshot(handle.ts);

      expect(ts72.tick).toBe(cpp72.tick);
      expect(cpp72.area99.targetRtti).toBe(13);
      expect(cpp72.area100.targetRtti).toBe(13);
      expect(cpp72.area99.targetIndex).toBe(cpp72.c7.targetIndex);
      expect(cpp72.area100.targetIndex).toBe(cpp72.c7.targetIndex);
      expect(ts72.area99.targetLogicIndex).toBe(107);
      expect(ts72.area100.targetLogicIndex).toBe(107);
      expect(ts72.area99.targetType).toBe('C7');
      expect(ts72.area100.targetHouse).toBe('Spain');
      expect(ts72.rngState >>> 0).toBe(cpp72.rngState >>> 0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
