/**
 * Dual-runtime check for TeamClass::TMission_Formation speed overrides.
 *
 * C++ team.cpp:2612-2661 assigns FormationSpeed/FormationMaxSpeed from the
 * slowest team member after a non-NONE formation mission. SCU13EA's Greek
 * `hunt1` team runs FORMATION_TIGHT before attacking, so its fast 2TNKs must
 * move at the ARTY-limited formation max speed. Without this, TS stays RNG
 * synced but drifts in vehicle movement immediately.
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

async function wasmHunt1TankFormationState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const team = (state.teams ?? []).find((t: any) => t.cls === 'hunt1');
    if (!team) throw new Error('C++ SCU13EA hunt1 team missing');

    const memberIds = (team.members ?? []).flatMap((memberType: any) => memberType.ids ?? []);
    const objects = [...(state.units ?? []), ...(state.enemies ?? [])];
    const members = memberIds
      .map((id: number) => objects.find((object: any) => object.id === id))
      .filter(Boolean);
    const tank = members.find((member: any) => member.t === '2TNK' && member.cx === 78 && member.cy === 59);
    if (!tank) throw new Error('C++ SCU13EA hunt1 lead 2TNK missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      team: {
        currentMission: team.cur,
        timeout: team.to,
      },
      tank: {
        type: tank.t,
        cell: { cx: tank.cx, cy: tank.cy },
        isFormationMove: tank.fm,
        formationSpeedClass: tank.fsp,
        formationMaxSpeed: tank.fms,
        maxSpeed: tank.mx,
        speedAdd: tank.add,
        speedAccum: tank.sa,
        whileMoveMaxSpeed: tank.wmx,
        whileMoveActualStart: tank.wact,
      },
    };
  });
}

async function tsHunt1TankFormationState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const team = ((window as any).__rawTeams?.() ?? []).find((t: any) => t.typeName === 'hunt1');
    if (!team) throw new Error('TS SCU13EA hunt1 team missing');

    const tank = (team as any)._members.find((member: any) =>
      member.type === '2TNK' &&
      member.cell?.cx === 78 &&
      member.cell?.cy === 59);
    if (!tank) throw new Error('TS SCU13EA hunt1 lead 2TNK missing');

    return {
      tick: game.tick,
      rngState: state.rngState,
      team: {
        currentMission: team.currentMission,
        timeout: team.timeOut,
      },
      tank: {
        type: tank.type,
        cell: { cx: tank.cell.cx, cy: tank.cell.cy },
        isFormationMove: tank.isFormationMove,
        formationSpeedClass: tank.formationSpeedClass,
        formationMaxSpeed: tank.formationMaxSpeed,
        maxSpeed: tank.stats.speed,
        speedAdd: Math.floor(((tank.formationMaxSpeed ?? 0) * (tank.driveSpeed || 0)) / 256),
        speedAccum: tank.speedAccum,
        driveSpeed: tank.driveSpeed,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU13 team formation speed', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('applies ARTY-limited formation speed before hunt1 attack movement', async () => {
    await withDualScenario('SCU13EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 6);
      const cpp = await wasmHunt1TankFormationState(handle.wasm);
      const ts = await tsHunt1TankFormationState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.team.currentMission).toBe(1);
      expect(ts.team.currentMission).toBe(cpp.team.currentMission);

      expect(cpp.tank).toMatchObject({
        isFormationMove: true,
        formationSpeedClass: 1,
        formationMaxSpeed: 15,
        speedAccum: 2,
        whileMoveMaxSpeed: 15,
      });
      expect(ts.tank).toMatchObject({
        isFormationMove: cpp.tank.isFormationMove,
        formationSpeedClass: cpp.tank.formationSpeedClass,
        formationMaxSpeed: cpp.tank.formationMaxSpeed,
        speedAccum: cpp.tank.speedAccum,
      });
    }, { wasmSeed: 0 });
  }, 300_000);
});
