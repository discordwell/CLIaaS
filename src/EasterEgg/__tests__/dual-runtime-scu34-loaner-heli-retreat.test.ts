/**
 * Dual-runtime check for SCU34 empty loaner helicopter idle handling.
 *
 * C++ AircraftClass::Mission_Attack enters AircraftClass::Enter_Idle_Mode after
 * a helicopter spends its final round. For an airborne weapon-equipped loaner
 * helicopter with no ammo, Enter_Idle_Mode removes it from its team and assigns
 * MISSION_RETREAT; Mission_Attack's final delay then uses RETREAT's mission
 * control rate, not ATTACK's.
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

async function stepBothInChunks(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<void> {
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 900);
    await stepBoth(handle, chunk);
    remaining -= chunk;
  }
}

async function wasmEasternHeliState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const all = [...(state.units ?? []), ...(state.enemies ?? [])];
    const heli = all.find((entry: any) =>
      entry.t === 'HELI' &&
      entry.house === 'Greece' &&
      entry.cx === 73 &&
      entry.cy === 23);
    const logic = (state.logicLayer ?? []).find((row: any[]) => row[6] === heli?.id);
    if (!heli || !logic) throw new Error('C++ eastern Greece HELI missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      heli: {
        id: heli.id,
        type: heli.t,
        house: heli.house,
        mission: heli.m,
        rawMission: logic[7],
        missionTimer: heli.mt,
        arm: heli.arm,
        ammo: heli.ammo,
        status: logic[27],
        cx: heli.cx,
        cy: heli.cy,
        targetKind: logic[30],
        targetIndex: logic[33],
        height: heli.hgt,
      },
    };
  });
}

async function wasmWesternHeliState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const all = [...(state.units ?? []), ...(state.enemies ?? [])];
    const helis = all
      .map((entry: any) => ({
        heli: entry,
        logic: (state.logicLayer ?? []).find((row: any[]) => row[6] === entry.id),
      }))
      .filter(({ heli, logic }: any) =>
        heli.t === 'HELI' &&
        heli.house === 'Greece' &&
        logic?.[27] === 4 &&
        logic?.[30] !== -1)
      .sort((a: any, b: any) => a.heli.lx - b.heli.lx);
    const { heli, logic } = helis[0] ?? {};
    if (!heli || !logic) throw new Error('C++ western Greece HELI missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      heli: {
        id: heli.id,
        type: heli.t,
        house: heli.house,
        mission: heli.m,
        rawMission: logic[7],
        missionTimer: heli.mt,
        arm: heli.arm,
        ammo: heli.ammo,
        status: logic[27],
        cx: heli.cx,
        cy: heli.cy,
        lx: heli.lx,
        ly: heli.ly,
        speed: heli.spd,
        targetKind: logic[30],
        targetIndex: logic[33],
      },
    };
  });
}

async function tsEasternHeliState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const heli = ((game?.entities ?? []) as any[]).find(entity =>
      entity.type === 'HELI' &&
      entity.house === 'Greece' &&
      entity.cell?.cx === 73 &&
      entity.cell?.cy === 23);
    if (!heli) throw new Error('TS eastern Greece HELI missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      heli: {
        id: heli.id,
        type: heli.type,
        house: heli.house,
        mission: heli.mission,
        missionTimer: heli.missionTimer,
        attackCooldown: heli.attackCooldown,
        ammo: heli.ammo,
        status: heli.aircraftAttackStatus,
        cx: heli.cell.cx,
        cy: heli.cell.cy,
        targetId: heli.target?.id ?? null,
        targetStructure: heli.targetStructure?.type ?? null,
        height: heli.aircraftHeightLeptons,
        isALoaner: heli.isALoaner === true,
        hasTeam: !!heli.teamRef,
      },
    };
  });
}

async function tsWesternHeliState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const helis = ((game?.entities ?? []) as any[])
      .filter(entity =>
        entity.type === 'HELI' &&
        entity.house === 'Greece' &&
        entity.alive !== false &&
        entity.aircraftAttackStatus === 4 &&
        entity.target?.type === 'HARV')
      .sort((a, b) => a.leptonX - b.leptonX);
    const heli = helis[0];
    if (!heli) throw new Error('TS western Greece HELI missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      heli: {
        id: heli.id,
        type: heli.type,
        house: heli.house,
        mission: heli.mission,
        missionTimer: heli.missionTimer,
        attackCooldown: heli.attackCooldown,
        ammo: heli.ammo,
        status: heli.aircraftAttackStatus,
        cx: heli.cell.cx,
        cy: heli.cell.cy,
        lx: heli.leptonX,
        ly: heli.leptonY,
        speedFraction: heli.aircraftSpeedFraction,
        speedAccum: heli.speedAccum,
        targetId: heli.target?.id ?? null,
        targetType: heli.target?.type ?? null,
        targetStructure: heli.targetStructure?.type ?? null,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU34 empty loaner helicopter retreat', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('holds its actual close coordinate while waiting to fire', async () => {
    await withDualScenario('SCU34EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 1000);
      const cpp = await wasmWesternHeliState(handle.wasm);
      const ts = await tsWesternHeliState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.heli).toMatchObject({
        type: 'HELI',
        house: 'Greece',
        status: 4,
        speed: 0,
      });
      expect(cpp.heli.targetKind).not.toBe(-1);
      expect(ts.heli).toMatchObject({
        type: cpp.heli.type,
        house: cpp.heli.house,
        mission: 'ATTACK',
        status: cpp.heli.status,
        cx: cpp.heli.cx,
        cy: cpp.heli.cy,
        lx: cpp.heli.lx,
        ly: cpp.heli.ly,
        speedFraction: 0,
        targetType: 'HARV',
        targetStructure: null,
      });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);

  it('enters RETREAT with the RETREAT mission delay after spending its last shot', async () => {
    await withDualScenario('SCU34EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 1098);
      const cpp = await wasmEasternHeliState(handle.wasm);
      const ts = await tsEasternHeliState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.heli).toMatchObject({
        type: 'HELI',
        house: 'Greece',
        mission: 4,
        rawMission: 4,
        missionTimer: 87,
        arm: 43,
        ammo: 0,
        status: 0,
        targetKind: -1,
        targetIndex: -1,
      });
      expect(ts.heli).toMatchObject({
        type: cpp.heli.type,
        house: cpp.heli.house,
        mission: 'RETREAT',
        missionTimer: cpp.heli.missionTimer,
        attackCooldown: cpp.heli.arm,
        ammo: cpp.heli.ammo,
        status: cpp.heli.status,
        targetId: null,
        targetStructure: null,
        isALoaner: true,
      });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);

  it('does not fly toward the map edge until Mission_Retreat reaches FACE_MAP_EDGE', async () => {
    await withDualScenario('SCU34EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 1120);
      const cpp = await wasmEasternHeliState(handle.wasm);
      const ts = await tsEasternHeliState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.heli).toMatchObject({
        mission: 4,
        rawMission: 4,
        cx: 73,
        cy: 23,
        status: 0,
        ammo: 0,
      });
      expect(ts.heli).toMatchObject({
        mission: 'RETREAT',
        missionTimer: cpp.heli.missionTimer,
        attackCooldown: cpp.heli.arm,
        ammo: cpp.heli.ammo,
        status: cpp.heli.status,
        cx: cpp.heli.cx,
        cy: cpp.heli.cy,
        targetId: null,
        targetStructure: null,
        isALoaner: true,
      });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
