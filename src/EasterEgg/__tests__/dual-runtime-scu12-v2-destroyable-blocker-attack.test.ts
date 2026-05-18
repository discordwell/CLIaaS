/**
 * Dual-runtime check for DriveClass::Start_Of_Move MOVE_DESTROYABLE handling.
 *
 * In SCU12EA, team `srnf1` sends a USSR V2RL toward waypoint 12, whose adjusted
 * move target is occupied by a GoodGuy GUN. C++ drive.cpp:1109-1151 clears
 * NavCom when the unit is already close enough, but still processes the saved
 * MOVE_DESTROYABLE result and calls Override_Mission(MISSION_ATTACK, blocker).
 * TS must follow that mission transition instead of compensating for the later
 * Mission_Attack RNG cadence.
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

const V2_LOGIC_INDEX = 291;
const MISSION_ATTACK = 1;
const MISSION_MOVE = 2;
const RTTI_BUILDING = 5;

type EvalPage = {
  evaluate<T, A = undefined>(fn: (arg: A) => T, arg?: A): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function stepBothInCppSizedChunks(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>>> {
  let result: Awaited<ReturnType<typeof stepBoth>> | null = null;
  let remaining = ticks;
  while (remaining > 0) {
    const step = Math.min(remaining, 15);
    result = await stepBoth(handle, step);
    remaining -= step;
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

async function wasmV2(adapter: unknown) {
  return adapterPage(adapter).evaluate((logicIndex) => {
    const module = (window as any).Module;
    const state = JSON.parse(module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) => entry[0] === logicIndex);
    if (!row) throw new Error(`C++ logic entry ${logicIndex} missing`);
    return {
      tick: state.tick,
      rngState: state.rngState,
      type: row[1],
      house: row[2],
      cx: row[3],
      cy: row[4],
      kind: row[5],
      aid: row[6],
      mission: row[7],
      missionTimer: row[8],
      missionQueue: row[9],
      isDriving: row[10],
      lx: row[12],
      ly: row[13],
      arm: row[23],
      targetKind: row[30],
      targetValue: row[31],
      targetRtti: row[32],
      targetIndex: row[33],
      inRange0: row[36],
      canFire0: row[37],
    };
  }, V2_LOGIC_INDEX) as Promise<{
    tick: number;
    rngState: number;
    type: string;
    house: string;
    cx: number;
    cy: number;
    kind: string;
    aid: number;
    mission: number;
    missionTimer: number;
    missionQueue: number;
    isDriving: boolean;
    lx: number;
    ly: number;
    arm: number;
    targetKind: number;
    targetValue: number;
    targetRtti: number;
    targetIndex: number;
    inRange0: number;
    canFire0: number;
  }>;
}

async function tsV2(adapter: unknown) {
  return adapterPage(adapter).evaluate((logicIndex) => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const entity = game.entities.find((candidate: any) =>
      candidate.alive !== false &&
      candidate.type === 'V2RL' &&
      candidate.house === 'USSR' &&
      candidate.logicIndexHint === logicIndex);
    if (!entity) throw new Error(`TS V2RL logic entity ${logicIndex} missing`);
    const targetStructureIndex = entity.targetStructure
      ? game.structures.indexOf(entity.targetStructure)
      : -1;
    return {
      tick: state.tick,
      rngState: state.rngState,
      type: entity.type,
      house: entity.house,
      cx: entity.cell.cx,
      cy: entity.cell.cy,
      mission: entity.mission,
      missionTimer: entity.missionTimer,
      missionQueue: entity.missionQueue,
      isDriving: entity.isDriving,
      lx: entity.leptonX,
      ly: entity.leptonY,
      attackCooldown: entity.attackCooldown,
      moveTarget: entity.moveTarget
        ? { lx: entity.moveTarget.lx, ly: entity.moveTarget.ly }
        : null,
      targetStructureIndex,
      targetStructureType: entity.targetStructure?.type ?? null,
      targetStructureCell: entity.targetStructure
        ? { cx: entity.targetStructure.cx, cy: entity.targetStructure.cy }
        : null,
      targetEntityId: entity.target?.id ?? null,
      forceFirePos: entity.forceFirePos
        ? { x: entity.forceFirePos.x, y: entity.forceFirePos.y }
        : null,
    };
  }, V2_LOGIC_INDEX) as Promise<{
    tick: number;
    rngState: number;
    type: string;
    house: string;
    cx: number;
    cy: number;
    mission: string;
    missionTimer: number;
    missionQueue: string | null;
    isDriving: boolean;
    lx: number;
    ly: number;
    attackCooldown: number;
    moveTarget: { lx: number; ly: number } | null;
    targetStructureIndex: number;
    targetStructureType: string | null;
    targetStructureCell: { cx: number; cy: number } | null;
    targetEntityId: number | null;
    forceFirePos: { x: number; y: number } | null;
  }>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU12 V2 destroyable blocker attack', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('overrides close-enough MOVE to ATTACK when the next track cell is an enemy GUN', async () => {
    await withDualScenario('SCU12EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInCppSizedChunks(handle, 228);
      const cppBefore = await wasmV2(handle.wasm);
      const tsBefore = await tsV2(handle.ts);

      expect(cppBefore.tick).toBe(228);
      expect(cppBefore.type).toBe('V2RL');
      expect(cppBefore.house).toBe('USSR');
      expect(cppBefore.mission).toBe(MISSION_MOVE);
      expect(tsBefore.tick).toBe(cppBefore.tick);
      expect(tsBefore.mission).toBe('MOVE');
      expect(tsBefore.moveTarget).toEqual({ lx: 9856, ly: 10880 });

      await stepBoth(handle, 1);
      const cppAfter = await wasmV2(handle.wasm);
      const tsAfter = await tsV2(handle.ts);

      expect(cppAfter.tick).toBe(229);
      expect(cppAfter.mission).toBe(MISSION_ATTACK);
      expect(cppAfter.missionQueue).toBe(-1);
      expect(cppAfter.targetRtti).toBe(RTTI_BUILDING);
      expect(cppAfter.targetIndex).toBe(34);
      expect(cppAfter.inRange0).toBe(1);

      expect(tsAfter.tick).toBe(cppAfter.tick);
      expect(tsAfter.mission).toBe('ATTACK');
      expect(tsAfter.missionQueue).toBeNull();
      expect(tsAfter.targetStructureType).toBe('GUN');
      expect(tsAfter.targetStructureIndex).toBe(cppAfter.targetIndex);
      expect(tsAfter.targetStructureCell).toEqual({ cx: 38, cy: 42 });
      expect(tsAfter.moveTarget).toBeNull();
      expect(tsAfter.attackCooldown).toBe(cppAfter.arm);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
