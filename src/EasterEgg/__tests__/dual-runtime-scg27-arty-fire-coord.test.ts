/**
 * Dual-runtime check for non-turreted vehicle Fire_Coord.
 *
 * SCG27EA has a Greek ARTY at (30,46) firing a 155mm shell at a BadGuy 3TNK.
 * C++ ARTY is not turret-equipped, so TechnoClass::Fire_Coord uses
 * UnitClass::Turret_Facing() -> PrimaryFacing.Current(), not SecondaryFacing.
 * Launching from the stale secondary/turret facing makes the shell one logic
 * frame younger and delays TeamClass::Took_Damage retaliation by a tick.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ensureParityServer,
  isDevServerAvailable,
  stepBoth,
  stopParityServer,
  withDualScenario,
  type ParityServerHandle,
  type DualStepResult,
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
): Promise<DualStepResult> {
  let result: DualStepResult | null = null;
  for (let i = 0; i < ticks; i++) {
    result = await stepBoth(handle, 1);
  }
  if (!result) throw new Error('No step result produced');
  return result;
}

async function wasmArtyShellState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const bullet = (state.bullets ?? []).find((b: any) =>
      b.type === 'Ballistic' &&
      b.pb === 1835035);
    const unit89 = (state.logicLayer ?? []).find((row: any[]) => row[0] === 89);
    if (!bullet) throw new Error('C++ SCG27EA ARTY shell missing');
    if (!unit89) throw new Error('C++ SCG27EA unit[89] missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      bullet,
      unit89: {
        hp: unit89[14],
        mission: unit89[7],
        missionTimer: unit89[8],
      },
    };
  });
}

async function tsArtyShellState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const arty = game.entities.find((entity: any) =>
      entity.type === 'ARTY' &&
      entity.house === 'Greece' &&
      entity.logicIndexHint === 194);
    if (!arty) throw new Error('TS SCG27EA Greek ARTY logic[194] missing');

    const projectile = game.inflightProjectiles.find((p: any) =>
      p.weapon?.name === '155mm' &&
      p.attackerId === arty.id);
    if (!projectile) throw new Error('TS SCG27EA ARTY shell missing');

    const unit89 = game.entities.find((entity: any) => entity.logicIndexHint === 89);
    if (!unit89) throw new Error('TS SCG27EA unit[89] missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      projectile: {
        weapon: projectile.weapon?.name,
        currentFrame: projectile.currentFrame,
        fuseTimer: projectile.fuseTimer,
        logicalLX: projectile.logicalLX,
        logicalLY: projectile.logicalLY,
        headToLX: projectile.headToLX,
        headToLY: projectile.headToLY,
      },
      unit89: {
        hp: unit89.hp,
        mission: unit89.mission,
        missionTimer: unit89.missionTimer,
      },
    };
  });
}

async function tsUnit89PostImpactState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const arty = game.entities.find((entity: any) =>
      entity.type === 'ARTY' &&
      entity.house === 'Greece' &&
      entity.logicIndexHint === 194);
    const unit89 = game.entities.find((entity: any) => entity.logicIndexHint === 89);
    if (!unit89) throw new Error('TS SCG27EA unit[89] missing after impact');

    return {
      tick: state.tick,
      rngState: state.rngState,
      projectileCount: game.inflightProjectiles.filter((p: any) =>
        p.weapon?.name === '155mm' &&
        p.attackerId === arty?.id).length,
      unit89: {
        hp: unit89.hp,
        mission: unit89.mission,
        missionTimer: unit89.missionTimer,
      },
    };
  });
}

async function wasmUnit89PostImpactState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const unit89 = (state.logicLayer ?? []).find((row: any[]) => row[0] === 89);
    if (!unit89) throw new Error('C++ SCG27EA unit[89] missing after impact');

    return {
      tick: state.tick,
      rngState: state.rngState,
      projectileCount: (state.bullets ?? []).filter((b: any) =>
        b.type === 'Ballistic' &&
        b.pb === 1835035).length,
      unit89: {
        hp: unit89[14],
        mission: unit89[7],
        missionTimer: unit89[8],
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG27EA ARTY Fire_Coord', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('launches non-turreted ARTY shells from PrimaryFacing and lands on the C++ tick', async () => {
    await withDualScenario('SCG27EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothOneTickAtATime(handle, 621);
      const [cppShell, tsShell] = await Promise.all([
        wasmArtyShellState(handle.wasm),
        tsArtyShellState(handle.ts),
      ]);

      expect(tsShell.tick).toBe(cppShell.tick);
      expect(tsShell.projectile).toMatchObject({
        weapon: '155mm',
        currentFrame: 1,
        fuseTimer: cppShell.bullet.timer,
        logicalLX: cppShell.bullet.lx,
        logicalLY: cppShell.bullet.ly,
        headToLX: cppShell.bullet.fx,
        headToLY: cppShell.bullet.fy,
      });

      await stepBothOneTickAtATime(handle, 16);
      const [cppImpact, tsImpact] = await Promise.all([
        wasmUnit89PostImpactState(handle.wasm),
        tsUnit89PostImpactState(handle.ts),
      ]);

      expect(tsImpact.tick).toBe(cppImpact.tick);
      expect(tsImpact.rngState >>> 0).toBe(cppImpact.rngState >>> 0);
      expect(tsImpact.projectileCount).toBe(cppImpact.projectileCount);
      expect(tsImpact.unit89).toMatchObject({
        hp: cppImpact.unit89.hp,
        mission: 'GUARD',
        missionTimer: cppImpact.unit89.missionTimer,
      });
      expect(cppImpact.unit89).toMatchObject({
        hp: 388,
        mission: 5,
        missionTimer: 37,
      });
    }, { wasmSeed: 0 });
  }, 300_000);
});
