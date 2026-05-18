/**
 * Dual-runtime check for DogJaw rider unlimbo after the main Logic pass.
 *
 * In SCG23EA tick 864, a dog-rider bullet detonates in the post-logic
 * projectile flush. C++ BulletClass::~BulletClass unlimbos the existing dog,
 * resubmits it at the end of Logic, and LogicClass::AI immediately processes
 * that resubmitted dog later in the same tick. TS must catch resubmitted
 * existing entities, not only newly appended array entries.
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

async function wasmScg23DogSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const logic250 = (state.logicLayer ?? []).find((row: any[]) => row[0] === 250);
    if (!logic250 || logic250[1] !== 'DOG' || logic250[2] !== 'USSR') {
      throw new Error('C++ SCG23EA dog logic index 250 not found');
    }
    const allUnits = [...(state.units ?? []), ...(state.enemies ?? [])];
    const dog = allUnits.find((u: any) => u.id === logic250[6]);
    if (!dog) throw new Error('C++ SCG23EA dog state not found');

    return {
      tick: state.tick,
      rngState: state.rngState,
      dog: {
        mission: logic250[7],
        missionTimer: logic250[8],
        isDriving: logic250[10] === true,
        doing: logic250[11],
        attackCooldown: dog.arm,
        leptonX: logic250[12],
        leptonY: logic250[13],
        nav: { lx: dog.nlx, ly: dog.nly },
        head: { lx: dog.hlx, ly: dog.hly },
      },
    };
  });
}

async function tsScg23DogSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const dog = game.entities.find((e: any) => e.logicIndexHint === 250);
    if (!dog || dog.type !== 'DOG' || dog.house !== 'USSR') {
      throw new Error('TS SCG23EA dog logic index 250 not found');
    }
    return {
      tick: game.tick,
      rngState: state.rngState,
      dog: {
        mission: dog.mission,
        missionTimer: dog.missionTimer,
        isDriving: dog.isDriving === true,
        doing: dog.doing,
        attackCooldown: dog.attackCooldown,
        leptonX: dog.leptonX,
        leptonY: dog.leptonY,
        unlimboTick: dog.unlimboTick,
        lastLogicProcessedTick: dog.lastLogicProcessedTick,
        nav: dog.moveTarget ? { lx: dog.moveTarget.lx, ly: dog.moveTarget.ly } : null,
        head: { lx: dog.headToLX, ly: dog.headToLY },
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG23 post-projectile dog rider logic', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('processes a resubmitted dog rider in the same tick as post-logic projectile impact', async () => {
    await withDualScenario('SCG23EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothChunked(handle, 864);
      const [cpp, ts] = await Promise.all([
        wasmScg23DogSnapshot(handle.wasm),
        tsScg23DogSnapshot(handle.ts),
      ]);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.dog).toMatchObject({
        mission: 2,
        missionTimer: 15,
        isDriving: true,
        doing: 20,
        attackCooldown: 1,
        leptonX: 25664,
        leptonY: 21312,
      });
      expect(ts.dog).toMatchObject({
        mission: 'MOVE',
        missionTimer: cpp.dog.missionTimer,
        isDriving: true,
        doing: 'dog_maul',
        attackCooldown: cpp.dog.attackCooldown,
        leptonX: cpp.dog.leptonX,
        leptonY: cpp.dog.leptonY,
        unlimboTick: cpp.tick,
        lastLogicProcessedTick: cpp.tick,
        nav: cpp.dog.nav,
        head: cpp.dog.head,
      });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
