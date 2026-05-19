/**
 * Dual-runtime check for DriveClass track-jump PCP_END path shortening.
 *
 * SCU06EB has a GoodGuy 2TNK at C++ logic[61] / TS logicIndexHint 61 driving
 * on HUNT toward a USSR APC. At tick 599 C++ performs the drive.cpp track-jump
 * handoff: Stop_Driver(), Per_Cell_Process(PCP_END), Start_Driver(c), then
 * Path memmove. The PCP_END call chains through FootClass::Per_Cell_Process,
 * sees the live TarCom in weapon range, and clears NavCom while preserving the
 * remaining active path tail for the post-PCP track jump. TS must clear
 * moveTarget at the same boundary; otherwise later TeamClass::Coordinate_Do
 * treats the stale NavCom as a live destination and skips the C++ regroup queue.
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

async function wasmTank61(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = ((state.logicLayer ?? []) as any[]).find(entry => entry[0] === 61);
    if (!row) throw new Error('C++ SCU06EB 2TNK logic row 61 missing');
    const unit = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((entry: any) => entry.id === row[6]);
    if (!unit) throw new Error('C++ SCU06EB 2TNK unit 1835012 missing');
    const rawPath = [unit.p0, unit.p1, unit.p2, unit.p3, unit.p4, unit.p5];
    const path: number[] = [];
    for (const facing of rawPath) {
      if (facing < 0) break;
      path.push(facing);
    }
    return {
      tick: state.tick,
      rngState: state.rngState,
      type: row[1],
      house: row[2],
      cx: row[3],
      cy: row[4],
      mission: row[7],
      missionQueue: row[9],
      isDriving: row[10],
      leptonX: row[12],
      leptonY: row[13],
      hp: row[14],
      targetLX: row[21],
      targetLY: row[22],
      nav: unit.nlx === undefined ? null : { lx: unit.nlx, ly: unit.nly },
      path,
    };
  });
}

async function tsTank61(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const tank = game.entities.find((entity: any) => entity.logicIndexHint === 61);
    if (!tank) throw new Error('TS SCU06EB 2TNK logicIndexHint 61 missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      type: tank.type,
      house: tank.house,
      cx: tank.cell?.cx,
      cy: tank.cell?.cy,
      mission: tank.mission,
      missionQueue: tank.missionQueue ?? null,
      isDriving: tank.isDriving,
      leptonX: tank.leptonX,
      leptonY: tank.leptonY,
      hp: tank.hp,
      target: tank.target
        ? { logicIndexHint: tank.target.logicIndexHint, type: tank.target.type }
        : null,
      moveTarget: tank.moveTarget
        ? { lx: tank.moveTarget.lx, ly: tank.moveTarget.ly }
        : null,
      path: tank.drivePathFacings.slice(0, 6),
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU06 track-jump path shorten', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('clears NavCom during track-jump PCP_END when the HUNT target is in range', async () => {
    await withDualScenario('SCU06EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const step = await stepBoth(handle, 599);
      const cpp = await wasmTank61(handle.wasm);
      const ts = await tsTank61(handle.ts);

      expect(step.wasm.state.tick).toBe(599);
      expect(step.ts.state.tick).toBe(599);
      expect(cpp).toMatchObject({
        tick: 599,
        type: '2TNK',
        house: 'GoodGuy',
        cx: 44,
        cy: 60,
        mission: 14,
        missionQueue: -1,
        isDriving: true,
        hp: 152,
        nav: null,
        path: [5, 6, 5, 6],
      });
      expect(ts).toMatchObject({
        tick: 599,
        type: '2TNK',
        house: 'GoodGuy',
        cx: 44,
        cy: 60,
        mission: 'HUNT',
        missionQueue: null,
        isDriving: true,
        hp: 152,
        target: { logicIndexHint: 95, type: 'APC' },
        moveTarget: null,
        path: [5, 6, 5, 6],
      });
      expect(ts.leptonX).toBe(cpp.leptonX);
      expect(ts.leptonY).toBe(cpp.leptonY);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
    }, { preserveSourceFog: true });
  }, 180_000);
});
