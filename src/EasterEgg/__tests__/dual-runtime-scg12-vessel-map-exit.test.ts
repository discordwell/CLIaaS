/**
 * Dual-runtime check for C++ vessel edge-of-world deletion timing.
 *
 * SCG12EA's England cruiser is ordered toward an off-map waypoint but remains
 * inside the radar rectangle at cell (68,87). C++ VesselClass::Edge_Of_World_AI
 * only deletes vessels after they are off-radar and no longer driving. TS must
 * not remove the cruiser merely because it is on the border with an off-map
 * move target; doing so skips the vessel guard jitter at tick 835.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AgentState, AgentUnit } from '../engine/agentHarness.js';
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

const WASM_MISSION_GUARD = 5;

function allTsUnits(state: AgentState): AgentUnit[] {
  return [...state.units, ...state.enemies];
}

function allWasmUnits(state: RAGameState): RAEntity[] {
  return [...state.units, ...state.enemies];
}

function findWasmEnglandCruiser(state: RAGameState): RAEntity | undefined {
  return allWasmUnits(state).find(u => u.t === 'CA' && u.house === 'England');
}

function findTsEnglandCruiser(state: AgentState): AgentUnit | undefined {
  return allTsUnits(state).find(u => u.t === 'CA' && u.h === 'England');
}

function wasmEnglandCruiser(state: RAGameState): RAEntity {
  const cruiser = allWasmUnits(state).find(u =>
    u.t === 'CA' &&
    u.house === 'England' &&
    u.cx === 68 &&
    u.cy === 87);
  expect(cruiser, 'C++ England CA at south map edge').toBeDefined();
  return cruiser!;
}

function tsEnglandCruiser(state: AgentState): AgentUnit {
  const cruiser = allTsUnits(state).find(u =>
    u.t === 'CA' &&
    u.h === 'England' &&
    u.cx === 68 &&
    u.cy === 87);
  expect(cruiser, 'TS England CA at south map edge').toBeDefined();
  return cruiser!;
}

async function stepBothOneTickAtATime(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>>> {
  let result: Awaited<ReturnType<typeof stepBoth>> | null = null;
  for (let i = 0; i < ticks; i++) {
    result = await stepBoth(handle, 1);
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG12EA vessel map-exit timing', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps the England cruiser alive while it is still inside the radar rectangle', async () => {
    await withDualScenario('SCG12EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBothOneTickAtATime(handle, 834);
      expect(wasmEnglandCruiser(result.wasm.state)).toMatchObject({
        t: 'CA',
        house: 'England',
        cx: 68,
        cy: 87,
        hp: 700,
        m: WASM_MISSION_GUARD,
        mt: 0,
      });
      expect(tsEnglandCruiser(result.ts.state), 'SCG12EA England CA before tick 835').toMatchObject({
        t: 'CA',
        h: 'England',
        cx: 68,
        cy: 87,
        hp: 700,
        m: 'GUARD',
        mt: 0,
      });

      result = await stepBoth(handle, 1);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('deletes the England cruiser at PCP_END once it stops off-radar', async () => {
    await withDualScenario('SCG12EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBothOneTickAtATime(handle, 882);
      expect(findWasmEnglandCruiser(result.wasm.state), 'C++ CA before off-radar PCP_END').toMatchObject({
        t: 'CA',
        house: 'England',
        cx: 68,
        cy: 88,
        hp: 700,
        drv: true,
      });
      expect(findTsEnglandCruiser(result.ts.state), 'TS CA before off-radar PCP_END').toMatchObject({
        t: 'CA',
        h: 'England',
        cx: 68,
        cy: 88,
        hp: 700,
        drv: true,
      });

      result = await stepBoth(handle, 1);
      expect(findWasmEnglandCruiser(result.wasm.state), 'C++ CA deleted at tick 883').toBeUndefined();
      expect(findTsEnglandCruiser(result.ts.state), 'TS CA deleted at tick 883').toBeUndefined();
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      result = await stepBothOneTickAtATime(handle, 36);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);
});
