/**
 * Dual-runtime check for TeamClass::TMission_Attack structure scoring.
 *
 * SCU02EB `grc1` reaches its ATTACK mission at tick 711. C++ evaluates the
 * USSR buildings with TechnoClass::Evaluate_Object, including designated-enemy
 * and base-zone modifiers, and selects the east AFLD at structure index 30.
 * A simplified Team-only structure score picks the closer FCOM instead; the
 * RNG stream only notices much later when dog AREA_GUARD scans diverge.
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

async function stepBothOneTickAtATime(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await stepBoth(handle, 1);
  }
}

async function wasmGrc1Target(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const team = state.teams.find((t: any) => t.cls === 'grc1');
    const target = state.structures.find((s: any) => s.id === 327710);
    if (!team) throw new Error('C++ SCU02EB grc1 team missing');
    if (!target) throw new Error('C++ SCU02EB target AFLD index 30 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      team: {
        targetLeptonX: team.tgtX,
        targetLeptonY: team.tgtY,
        missionTargetLeptonX: team.mtgtX,
        missionTargetLeptonY: team.mtgtY,
        currentMission: team.cur,
      },
      target: {
        type: target.t,
        cx: target.cx,
        cy: target.cy,
      },
    };
  });
}

async function tsGrc1Target(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const team = ((window as any).__rawTeams?.() ?? []).find((t: any) => t.typeName === 'grc1');
    if (!team) throw new Error('TS SCU02EB grc1 team missing');

    const targetStructure = team.targetStructureRef ?? null;
    const missionTargetStructure = team.missionTargetStructureRef ?? null;
    const targetLepton = targetStructure
      ? { lx: targetStructure.centerLX ?? Math.trunc(team.target.x * 256 / 24), ly: targetStructure.centerLY ?? Math.trunc(team.target.y * 256 / 24) }
      : team.target
        ? { lx: Math.trunc(team.target.x * 256 / 24), ly: Math.trunc(team.target.y * 256 / 24) }
        : null;
    const missionTargetLepton = missionTargetStructure
      ? { lx: missionTargetStructure.centerLX ?? Math.trunc(team.missionTarget.x * 256 / 24), ly: missionTargetStructure.centerLY ?? Math.trunc(team.missionTarget.y * 256 / 24) }
      : team.missionTarget
        ? { lx: Math.trunc(team.missionTarget.x * 256 / 24), ly: Math.trunc(team.missionTarget.y * 256 / 24) }
        : null;

    return {
      tick: game.tick,
      rngState: state.rngState,
      team: {
        targetLeptonX: targetLepton?.lx ?? null,
        targetLeptonY: targetLepton?.ly ?? null,
        missionTargetLeptonX: missionTargetLepton?.lx ?? null,
        missionTargetLeptonY: missionTargetLepton?.ly ?? null,
        currentMission: team.currentMission,
        targetStructureType: targetStructure?.type ?? null,
        targetStructureCell: targetStructure ? { cx: targetStructure.cx, cy: targetStructure.cy } : null,
        missionTargetStructureType: missionTargetStructure?.type ?? null,
        missionTargetStructureCell: missionTargetStructure ? { cx: missionTargetStructure.cx, cy: missionTargetStructure.cy } : null,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU02EB team attack structure scoring', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('selects the same AFLD target for grc1 TMISSION_ATTACK', async () => {
    await withDualScenario('SCU02EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBothOneTickAtATime(handle, 711);

      const cpp = await wasmGrc1Target(handle.wasm);
      const ts = await tsGrc1Target(handle.ts);

      expect(cpp.team.currentMission).toBe(2);
      expect(ts.team.currentMission).toBe(cpp.team.currentMission);
      expect(cpp.target).toEqual({ type: 'AFLD', cx: 50, cy: 77 });
      expect(ts.team.missionTargetStructureType).toBe('AFLD');
      expect(ts.team.missionTargetStructureCell).toEqual({ cx: 49, cy: 77 });
      expect(ts.team.targetLeptonX).toBe(cpp.team.targetLeptonX);
      expect(ts.team.targetLeptonY).toBe(cpp.team.targetLeptonY);
      expect(ts.team.missionTargetLeptonX).toBe(cpp.team.missionTargetLeptonX);
      expect(ts.team.missionTargetLeptonY).toBe(cpp.team.missionTargetLeptonY);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
