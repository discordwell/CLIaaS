/**
 * Dual-runtime check for TeamClass::Add initial Calc_Center.
 *
 * SCU05EA creates the Greek `check` team from existing infantry. C++ Add()
 * immediately runs Calc_Center with Can_Enter_Cell, so the first recruit stores
 * a CELL target for Zone. TS must use that same center before choosing later
 * recruits; otherwise it fills E1 slots too early and activates one tick late.
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
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function stepBothInChunks(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>> | undefined> {
  let result: Awaited<ReturnType<typeof stepBoth>> | undefined;
  let remaining = ticks;
  while (remaining > 0) {
    const step = Math.min(remaining, 300);
    result = await stepBoth(handle, step);
    remaining -= step;
  }
  return result;
}

async function wasmCheckTeam(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const team = (state.teams ?? []).find((entry: any) => entry.cls === 'check') ?? null;
    return {
      tick: state.tick,
      rngState: state.rngState >>> 0,
      team: team
        ? {
            total: team.total,
            fullStrength: !!team.fs,
            moving: !!team.mv,
            hasBeen: !!team.hb,
            zoneX: team.zoneX,
            zoneY: team.zoneY,
          }
        : null,
    };
  });
}

async function tsCheckTeam(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = (window as any).__agentState();
    const rawTeam = ((window as any).__rawTeams?.() ?? []).find((entry: any) => entry.typeName === 'check') ?? null;
    const agentTeam = ((window as any).__agentTeams?.() ?? []).find((entry: any) => entry.typeName === 'check') ?? null;
    const team = rawTeam ?? agentTeam;
    return {
      tick: state.tick,
      rngState: state.rngState >>> 0,
      team: team
        ? {
            total: rawTeam ? team._members.length : team.members,
            fullStrength: !!team.isFullStrength,
            moving: !!team.isMoving,
            hasBeen: !!team.isHasBeen,
            zoneX: team.zoneLeptonX,
            zoneY: team.zoneLeptonY,
          }
        : null,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU05EA check team recruit center', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('fills and activates the check team on the same ticks as C++', async () => {
    await withDualScenario('SCU05EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 1117);
      const beforeCpp = await wasmCheckTeam(handle.wasm);
      const beforeTs = await tsCheckTeam(handle.ts);

      expect(beforeCpp.team).toMatchObject({
        total: 6,
        fullStrength: false,
        moving: false,
      });
      expect(beforeTs.team).toMatchObject({
        total: 6,
        fullStrength: false,
        moving: false,
      });
      expect(beforeTs.team?.zoneX).toBe(beforeCpp.team?.zoneX);
      expect(beforeTs.team?.zoneY).toBe(beforeCpp.team?.zoneY);

      const activated = await stepBoth(handle, 1);
      const afterCpp = await wasmCheckTeam(handle.wasm);
      const afterTs = await tsCheckTeam(handle.ts);

      expect(afterCpp.team).toMatchObject({
        total: 6,
        fullStrength: true,
        moving: true,
        hasBeen: true,
      });
      expect(afterTs.team).toMatchObject(afterCpp.team!);
      expect(activated.ts.state.rngState >>> 0).toBe(activated.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
