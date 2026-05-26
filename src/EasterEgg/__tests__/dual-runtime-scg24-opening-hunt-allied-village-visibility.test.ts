/**
 * Dual-runtime regression for SCG24EA opening HUNT scans.
 *
 * Germany/Turkey village buildings are allied with the player, but those
 * houses have PlayerControl=yes. C++ DisplayClass::All_To_Look therefore
 * treats their buildings like player-control technos: they cannot Look() until
 * already IsDiscoveredByPlayer. TS must not let those allied structures
 * bootstrap their own discovery before the first USSR HUNT scan.
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

async function wasmOpeningHuntSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const Module = (window as any).Module;
    const state = JSON.parse(Module.ccall('agent_get_state', 'string', [], []));
    const logic = (state.logicLayer ?? []).find((row: any[]) => row[0] === 122);
    if (!logic || logic[1] !== 'E1' || logic[2] !== 'USSR') {
      throw new Error('C++ SCG24EA USSR E1 logic index 122 not found');
    }
    const infantry = (state.enemies ?? []).find((unit: any) => unit.id === logic[6]);
    if (!infantry) throw new Error('C++ SCG24EA USSR E1 unit not found');
    const v01 = (state.structures ?? []).find((s: any) =>
      s.t === 'V01' && s.house === 'Germany' && s.cx === 32 && s.cy === 55);
    const v07 = (state.structures ?? []).find((s: any) =>
      s.t === 'V07' && s.house === 'Turkey' && s.cx === 57 && s.cy === 77);
    if (!v01 || !v07) throw new Error('C++ SCG24EA village structures not found');

    const evalTarget = (targetId: number) => JSON.parse(Module.ccall(
      'agent_debug_eval_target',
      'string',
      ['number', 'number'],
      [logic[6], targetId],
    ));

    return {
      tick: state.tick,
      rngState: state.rngState,
      infantry: {
        mission: logic[7],
        missionTimer: logic[8],
        isDriving: logic[10] === true,
        target: logic[30] >= 0 ? { kind: logic[30], value: logic[31], rtti: logic[32], index: logic[33] } : null,
        nav: infantry.nlx !== undefined && infantry.nly !== undefined
          ? { lx: infantry.nlx, ly: infantry.nly }
          : null,
      },
      v01: {
        ally: v01.ally === true,
        targetDiscovered: evalTarget(v01.id).targetDiscovered === true,
      },
      v07: {
        ally: v07.ally === true,
        targetDiscovered: evalTarget(v07.id).targetDiscovered === true,
      },
    };
  });
}

async function tsOpeningHuntSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const infantry = game.entities.find((entity: any) =>
      entity.logicIndexHint === 122 && entity.type === 'E1' && entity.house === 'USSR');
    if (!infantry) throw new Error('TS SCG24EA USSR E1 logic index 122 not found');
    const v01 = game.structures.find((s: any) =>
      s.type === 'V01' && s.house === 'Germany' && s.cx === 32 && s.cy === 55);
    const v07 = game.structures.find((s: any) =>
      s.type === 'V07' && s.house === 'Turkey' && s.cx === 57 && s.cy === 77);
    if (!v01 || !v07) throw new Error('TS SCG24EA village structures not found');
    const discovered = new Set(Array.from(game.discoveredStructureIds ?? []));
    const v01Index = game.structures.indexOf(v01);
    const v07Index = game.structures.indexOf(v07);

    return {
      tick: state.tick,
      rngState: state.rngState,
      infantry: {
        mission: infantry.mission,
        missionTimer: infantry.missionTimer,
        isDriving: infantry.isDriving === true,
        target: infantry.target
          ? { type: infantry.target.type, house: infantry.target.house, hint: infantry.target.logicIndexHint }
          : null,
        targetStructure: infantry.targetStructure
          ? { type: infantry.targetStructure.type, house: infantry.targetStructure.house, index: game.structures.indexOf(infantry.targetStructure) }
          : null,
        nav: infantry.moveTarget
          ? { lx: infantry.moveTarget.lx, ly: infantry.moveTarget.ly }
          : null,
      },
      v01: {
        discovered: discovered.has(v01Index),
      },
      v07: {
        discovered: discovered.has(v07Index),
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG24 opening HUNT allied village visibility', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not let PlayerControl allied village buildings bootstrap HUNT targets on tick 1', async () => {
    await withDualScenario('SCG24EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 1);
      const [cpp, ts] = await Promise.all([
        wasmOpeningHuntSnapshot(handle.wasm),
        tsOpeningHuntSnapshot(handle.ts),
      ]);

      expect(ts.tick).toBe(cpp.tick);
      expect(cpp.v01).toMatchObject({ ally: true, targetDiscovered: false });
      expect(cpp.v07).toMatchObject({ ally: true, targetDiscovered: false });
      expect(cpp.infantry).toMatchObject({
        mission: 14,
        missionTimer: 13,
        isDriving: false,
        target: null,
        nav: null,
      });
      expect(ts.v01.discovered).toBe(cpp.v01.targetDiscovered);
      expect(ts.v07.discovered).toBe(cpp.v07.targetDiscovered);
      expect(ts.infantry).toMatchObject({
        mission: 'HUNT',
        missionTimer: cpp.infantry.missionTimer,
        isDriving: cpp.infantry.isDriving,
        target: null,
        targetStructure: null,
        nav: null,
      });
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 180_000);
});
