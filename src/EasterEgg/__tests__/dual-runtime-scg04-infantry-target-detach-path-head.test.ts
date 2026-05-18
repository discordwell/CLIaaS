/**
 * Dual-runtime check for InfantryClass::Assign_Target(TARGET_NONE) while moving.
 *
 * In SCG04EA, hunt3 infantry are walking an attack path when their TarCom dies.
 * C++ reaches TechnoClass::Detach -> InfantryClass::Assign_Target(TARGET_NONE):
 * it clears only Path[0], keeps NavCom and the active Head_To_Coord hop alive,
 * and preserves the residual Path[1..] facings for the later move.
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

async function wasmHunt3Infantry(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const team = (state.teams ?? []).find((candidate: any) => candidate.cls === 'hunt3');
    if (!team) throw new Error('C++ SCG04EA hunt3 team missing');

    const memberIds = (team.members ?? []).flatMap((memberType: any) => memberType.ids ?? []);
    const objects = [...(state.units ?? []), ...(state.enemies ?? [])];
    const members = memberIds
      .map((id: number) => objects.find((object: any) => object.id === id))
      .filter(Boolean);
    const infantry = members.find((member: any) =>
      member.t === 'E1' &&
      member.drv === true &&
      member.lx === 14092 &&
      member.ly === 7436 &&
      member.hlx === 14144 &&
      member.hly === 7488);
    if (!infantry) {
      throw new Error(`C++ SCG04EA hunt3 moving infantry missing: ${JSON.stringify(members)}`);
    }

    const path = [
      infantry.p0,
      infantry.p1,
      infantry.p2,
      infantry.p3,
      infantry.p4,
      infantry.p5,
      infantry.p6,
      infantry.p7,
      infantry.p8,
      infantry.p9,
      infantry.p10,
      infantry.p11,
    ];

    return {
      tick: state.tick,
      rngState: state.rngState,
      infantry: {
        mission: infantry.m,
        missionQueue: infantry.mq,
        isDriving: infantry.drv === true,
        lx: infantry.lx,
        ly: infantry.ly,
        nav: { lx: infantry.nlx, ly: infantry.nly },
        head: { lx: infantry.hlx, ly: infantry.hly },
        path,
        residualPath: path.filter((facing: number) => facing >= 0),
      },
    };
  });
}

async function tsHunt3Infantry(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const team = ((window as any).__rawTeams?.() ?? []).find((candidate: any) =>
      candidate.typeName === 'hunt3');
    if (!team) throw new Error('TS SCG04EA hunt3 team missing');

    const members = (team as any)._members ?? [];
    const infantry = members.find((member: any) =>
      member.type === 'E1' &&
      member.isDriving === true &&
      member.leptonX === 14092 &&
      member.leptonY === 7436 &&
      member.headToLX === 14144 &&
      member.headToLY === 7488);
    if (!infantry) {
      const summary = members.map((member: any) => ({
        type: member.type,
        cell: member.cell ? { cx: member.cell.cx, cy: member.cell.cy } : null,
        lx: member.leptonX,
        ly: member.leptonY,
        head: { lx: member.headToLX, ly: member.headToLY },
        driving: member.isDriving === true,
        facings: member.drivePathFacings?.slice(0, 12) ?? [],
      }));
      throw new Error(`TS SCG04EA hunt3 moving infantry missing: ${JSON.stringify(summary)}`);
    }

    const facings = infantry.drivePathFacings.slice(0, 12);
    return {
      tick: game.tick,
      rngState: state.rngState,
      infantry: {
        mission: infantry.mission,
        missionQueue: infantry.missionQueue ?? null,
        isDriving: infantry.isDriving === true,
        lx: infantry.leptonX,
        ly: infantry.leptonY,
        nav: infantry.moveTarget ? { lx: infantry.moveTarget.lx, ly: infantry.moveTarget.ly } : null,
        head: { lx: infantry.headToLX, ly: infantry.headToLY },
        drivePathHeadCleared: infantry.drivePathHeadCleared === true,
        facings,
        residualPath: facings.slice(infantry.drivePathHeadCleared ? 1 : 0),
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG04 infantry target detach path head', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('clears only the path head when a moving infantry target dies', async () => {
    await withDualScenario('SCG04EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothChunked(handle, 1287);
      const [cpp, ts] = await Promise.all([
        wasmHunt3Infantry(handle.wasm),
        tsHunt3Infantry(handle.ts),
      ]);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.infantry.path[0]).toBe(-1);
      expect(cpp.infantry.residualPath).toEqual([3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 3]);

      expect(ts.infantry).toMatchObject({
        mission: 'ATTACK',
        missionQueue: null,
        isDriving: true,
        lx: cpp.infantry.lx,
        ly: cpp.infantry.ly,
        nav: cpp.infantry.nav,
        head: cpp.infantry.head,
        drivePathHeadCleared: true,
      });
      expect(ts.infantry.residualPath).toEqual(cpp.infantry.residualPath);
    }, { wasmSeed: 0 });
  }, 240_000);
});
