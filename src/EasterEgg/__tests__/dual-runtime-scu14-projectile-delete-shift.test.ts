/**
 * Dual-runtime checks for C++ Logic cursor shifts caused by projectile deletes.
 *
 * SCU14EA has SCUD detonations that delete earlier Logic objects while the
 * runtime pass is active. DynamicVector compaction can move the following object
 * under the active cursor, so C++ skips it until the next frame. TS must mirror
 * that cursor behavior for both projectiles and regular unit logic.
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

async function wasmProjectileState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const ballistic = (state.bullets ?? []).find((bullet: any) =>
      bullet.type === 'Ballistic' &&
      bullet.tx === 23936 &&
      bullet.ty === 20864);
    const scud = (state.bullets ?? []).find((bullet: any) =>
      bullet.type === 'FROG' &&
      bullet.tx === 24704 &&
      bullet.ty === 20096);
    return {
      tick: state.tick,
      rngState: state.rngState,
      ballistic: ballistic
        ? {
            lx: ballistic.lx,
            ly: ballistic.ly,
            timer: ballistic.timer,
            payback: ballistic.pb,
          }
        : null,
      scud: scud
        ? {
            lx: scud.lx,
            ly: scud.ly,
            timer: scud.timer,
          }
        : null,
    };
  });
}

async function tsProjectileState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const ballistic = (game.inflightProjectiles ?? []).find((projectile: any) =>
      projectile.weapon?.name === '155mm' &&
      projectile.headToLX === 23936 &&
      projectile.headToLY === 20864);
    const scud = (game.inflightProjectiles ?? []).find((projectile: any) =>
      projectile.weapon?.name === 'SCUD' &&
      projectile.headToLX === 24704 &&
      projectile.headToLY === 20096);
    return {
      tick: state.tick,
      rngState: state.rngState,
      ballistic: ballistic
        ? {
            hint: ballistic.logicIndexHint,
            currentFrame: ballistic.currentFrame,
            lx: ballistic.logicalLX,
            ly: ballistic.logicalLY,
            fuseTimer: ballistic.fuseTimer,
            processedLogicTick: ballistic.processedLogicTick,
          }
        : null,
      scud: scud
        ? {
            hint: scud.logicIndexHint,
            currentFrame: scud.currentFrame,
            lx: scud.logicalLX,
            ly: scud.logicalLY,
            fuseTimer: scud.fuseTimer,
          }
        : null,
    };
  });
}

async function wasmDeleteShiftState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const logic = state.logicLayer ?? [];
    const tank = logic.find((row: any[]) =>
      row[1] === '2TNK' && row[2] === 'Greece' && row[3] === 99 && row[4] === 98);
    const rifle = logic.find((row: any[]) =>
      row[1] === 'E1' && row[2] === 'Greece' && row[3] === 92 && row[4] === 77);
    if (!tank) throw new Error('C++ SCU14EA shifted 2TNK missing');
    if (!rifle) throw new Error('C++ SCU14EA SCUD survivor E1 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      tank: {
        mission: tank[7],
        missionTimer: tank[8],
        isDriving: !!tank[10],
        lx: tank[12],
        ly: tank[13],
      },
      rifle: {
        mission: rifle[7],
        missionTimer: rifle[8],
        isDriving: !!rifle[10],
        lx: rifle[12],
        ly: rifle[13],
      },
    };
  });
}

async function tsDeleteShiftState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const tank = game.entities.find((entity: any) =>
      entity.type === '2TNK' &&
      entity.house === 'Greece' &&
      entity.cell?.cx === 99 &&
      entity.cell?.cy === 98);
    const rifle = game.entities.find((entity: any) =>
      entity.type === 'E1' &&
      entity.house === 'Greece' &&
      entity.cell?.cx === 92 &&
      entity.cell?.cy === 77);
    if (!tank) throw new Error('TS SCU14EA shifted 2TNK missing');
    if (!rifle) throw new Error('TS SCU14EA SCUD survivor E1 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      tank: {
        mission: tank.mission,
        missionTimer: tank.missionTimer,
        isDriving: tank.isDriving,
        lx: tank.leptonX,
        ly: tank.leptonY,
      },
      rifle: {
        mission: rifle.mission,
        missionTimer: rifle.missionTimer,
        isDriving: rifle.isDriving,
        lx: rifle.leptonX,
        ly: rifle.leptonY,
      },
    };
  });
}

async function wasmCombatAnimWindow(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const wanted = new Set(['SMOKE_M', 'VEH-HIT2', 'FRAG1', 'FBALL1', 'PIFF']);
    return {
      tick: state.tick,
      anims: (state.anims ?? [])
        .filter((anim: any) =>
          anim.logicIndex >= 272 &&
          anim.logicIndex <= 286 &&
          wanted.has(anim.name))
        .map((anim: any) => ({
          h: anim.logicIndex,
          type: String(anim.name).toLowerCase(),
          cx: anim.cx,
          cy: anim.cy,
          stage: anim.stage,
        }))
        .sort((a: any, b: any) =>
          a.h - b.h ||
          a.type.localeCompare(b.type) ||
          a.cx - b.cx ||
          a.cy - b.cy ||
          a.stage - b.stage),
    };
  }) as Promise<{
    tick: number;
    anims: Array<{ h: number; type: string; cx: number; cy: number; stage: number }>;
  }>;
}

async function tsCombatAnimWindow(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const wanted = new Set(['smoke_m', 'veh-hit2', 'frag1', 'fball1', 'piff']);
    return {
      tick: (window as any).__agentState().tick,
      anims: (game.logicAnims ?? [])
        .filter((anim: any) =>
          anim.logicIndexHint >= 272 &&
          anim.logicIndexHint <= 286 &&
          wanted.has(anim.type))
        .map((anim: any) => ({
          h: anim.logicIndexHint,
          type: anim.type,
          cx: Math.floor(anim.x / 24),
          cy: Math.floor(anim.y / 24),
          stage: anim.stage,
        }))
        .sort((a: any, b: any) =>
          a.h - b.h ||
          a.type.localeCompare(b.type) ||
          a.cx - b.cx ||
          a.cy - b.cy ||
          a.stage - b.stage),
    };
  }) as Promise<{
    tick: number;
    anims: Array<{ h: number; type: string; cx: number; cy: number; stage: number }>;
  }>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU14 projectile delete shift', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('skips the Ballistic shell shifted by a prior SCUD deletion', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothOneTickAtATime(handle, 922);
      const cppBefore = await wasmProjectileState(handle.wasm);
      const tsBefore = await tsProjectileState(handle.ts);
      expect(cppBefore.tick).toBe(922);
      expect(tsBefore.tick).toBe(cppBefore.tick);
      expect(cppBefore.scud).not.toBeNull();
      expect(tsBefore.scud).not.toBeNull();
      expect(cppBefore.ballistic).toMatchObject({ lx: 24160, ly: 20479, timer: 41 });
      expect(tsBefore.ballistic).toMatchObject({
        currentFrame: 12,
        lx: 24160,
        ly: 20479,
        fuseTimer: 41,
      });

      await stepBoth(handle, 1);
      const cppSkipped = await wasmProjectileState(handle.wasm);
      const tsSkipped = await tsProjectileState(handle.ts);
      expect(cppSkipped.tick).toBe(923);
      expect(tsSkipped.tick).toBe(cppSkipped.tick);
      expect(cppSkipped.scud).toBeNull();
      expect(tsSkipped.scud).toBeNull();
      expect(cppSkipped.ballistic).toMatchObject({ lx: 24160, ly: 20479, timer: 41 });
      expect(tsSkipped.ballistic).toMatchObject({
        currentFrame: 12,
        lx: 24160,
        ly: 20479,
        fuseTimer: 41,
        processedLogicTick: 923,
      });
      expect(tsSkipped.rngState).toBe(cppSkipped.rngState);

      await stepBoth(handle, 1);
      const cppAdvanced = await wasmProjectileState(handle.wasm);
      const tsAdvanced = await tsProjectileState(handle.ts);
      expect(cppAdvanced.tick).toBe(924);
      expect(tsAdvanced.tick).toBe(cppAdvanced.tick);
      expect(cppAdvanced.ballistic).toMatchObject({ lx: 24140, ly: 20546, timer: 40 });
      expect(tsAdvanced.ballistic).toMatchObject({
        currentFrame: 13,
        lx: 24140,
        ly: 20546,
        fuseTimer: 40,
      });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);

  it('skips a 2TNK shifted behind the Logic cursor by a SCUD detonation', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 763);
      const cpp = await wasmDeleteShiftState(handle.wasm);
      const ts = await tsDeleteShiftState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);

      expect(cpp.tank.mission).toBe(2);
      expect(ts.tank.mission).toBe('MOVE');
      expect(ts.tank.missionTimer).toBe(cpp.tank.missionTimer);
      expect(ts.tank.isDriving).toBe(cpp.tank.isDriving);
      expect(ts.tank.lx).toBe(cpp.tank.lx);
      expect(ts.tank.ly).toBe(cpp.tank.ly);

      expect(cpp.rifle.mission).toBe(14);
      expect(ts.rifle.mission).toBe('HUNT');
      expect(ts.rifle.missionTimer).toBe(cpp.rifle.missionTimer);
      expect(ts.rifle.isDriving).toBe(cpp.rifle.isDriving);
      expect(ts.rifle.lx).toBe(cpp.rifle.lx);
      expect(ts.rifle.ly).toBe(cpp.rifle.ly);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('keeps SCUD combat AnimClass slots aligned through damage smoke and small-arms piffs', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothOneTickAtATime(handle, 215);
      const cpp215 = await wasmCombatAnimWindow(handle.wasm);
      const ts215 = await tsCombatAnimWindow(handle.ts);
      expect(ts215.tick).toBe(cpp215.tick);
      expect(ts215.anims).toEqual(cpp215.anims);
      expect(ts215.anims).toContainEqual({
        h: 286,
        type: 'piff',
        cx: 90,
        cy: 79,
        stage: 0,
      });

      await stepBothOneTickAtATime(handle, 4);
      const cpp219 = await wasmCombatAnimWindow(handle.wasm);
      const ts219 = await tsCombatAnimWindow(handle.ts);
      expect(ts219.tick).toBe(219);
      expect(ts219.tick).toBe(cpp219.tick);
      expect(ts219.anims).toEqual(cpp219.anims);
      expect(ts219.anims).toEqual(expect.arrayContaining([
        { h: 272, type: 'smoke_m', cx: 92, cy: 76, stage: 67 },
        { h: 273, type: 'smoke_m', cx: 92, cy: 77, stage: 61 },
        { h: 274, type: 'smoke_m', cx: 94, cy: 76, stage: 45 },
        { h: 276, type: 'veh-hit2', cx: 92, cy: 80, stage: 9 },
        { h: 277, type: 'veh-hit2', cx: 94, cy: 80, stage: 9 },
        { h: 278, type: 'veh-hit2', cx: 92, cy: 80, stage: 9 },
      ]));
    }, { wasmSeed: 0 });
  }, 300_000);
});
