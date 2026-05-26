/**
 * Dual-runtime check for the final Process_Fly_To rotation inside the LZ stop
 * radius. C++ still refreshes PrimaryFacing.Desired() before Set_Speed(0), so a
 * landing helicopter can make a final one-step PrimaryFacing adjustment even
 * though it no longer moves.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RAEntity, RAGameState } from '../oracle/WasmAdapter.js';
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
  evaluate<T, A = unknown>(fn: (arg: A) => T, arg?: A): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

function allWasmUnits(state: RAGameState): RAEntity[] {
  return [...state.units, ...state.enemies];
}

function wasmTransport(state: RAGameState) {
  const matches = allWasmUnits(state).filter(u => u.t === 'TRAN' && u.house === 'Greece');
  expect(matches).toHaveLength(1);
  const tran = matches[0] as RAEntity & Record<string, unknown>;
  return {
    lx: tran.lx,
    ly: tran.ly,
    height: tran.hgt,
    primary: tran.pf,
    primaryDesired: tran.pfd,
    secondary: tran.sf,
    secondaryDesired: tran.sfd,
  };
}

async function tsTransport(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const matches = (game?.entities ?? [])
      .filter((e: any) => e.type === 'TRAN' && e.house === 'Greece');
    if (matches.length !== 1) throw new Error(`expected one Greece TRAN, got ${matches.length}`);
    const tran = matches[0];
    return {
      lx: tran.leptonX,
      ly: tran.leptonY,
      height: tran.flightAltitude,
      heightLeptons: tran.aircraftHeightLeptons,
      primary: tran.facing256,
      primaryDesired: tran.desiredFacing256,
      secondary: tran.turretFacing256,
      secondaryDesired: tran.desiredTurretFacing256,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG01EA Chinook stop-radius facing', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps the landing transport primary facing aligned after Process_Fly_To stops movement', async () => {
    await withDualScenario('SCG01EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState);
      const result = await stepBoth(handle, 100);

      const wasmTran = wasmTransport(result.wasm.state);
      const tsTran = await tsTransport(handle.ts);

      expect({
        lx: tsTran.lx,
        ly: tsTran.ly,
        height: tsTran.heightLeptons,
        primary: tsTran.primary,
        primaryDesired: tsTran.primaryDesired,
        secondary: tsTran.secondary,
        secondaryDesired: tsTran.secondaryDesired,
      }).toEqual(wasmTran);
    });
  }, 300_000);
});
