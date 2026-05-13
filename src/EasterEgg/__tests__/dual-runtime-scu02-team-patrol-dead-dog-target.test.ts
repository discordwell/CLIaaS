/**
 * Dual-runtime check for TeamClass::TMission_Patrol threat target parity.
 *
 * SCU02EA tick 687/688 exercises a real C++ quirk: Greatest_Threat can return
 * a zero-strength but still active dog object while it remains in the cell
 * occupier chain. TeamClass stores that raw object target as MissionTarget even
 * though member Assign_Target later rejects it. TS must preserve that team-level
 * target; otherwise Coordinate_Patrol restores the waypoint and stops in-flight
 * infantry movement.
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

async function wasmPatrolSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const team = state.teams.find((t: any) => t.cls === 'cmdatk');
    const e1 = state.enemies.find((e: any) => e.id === 851992);
    const dog = state.logicLayer.find((r: any[]) => r[6] === 851981);
    if (!team) throw new Error('C++ SCU02EA cmdatk team missing');
    if (!e1) throw new Error('C++ SCU02EA GoodGuy E1 id 851992 missing');
    if (!dog) throw new Error('C++ SCU02EA dead dog id 851981 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      team: {
        targetLeptonX: team.tgtX,
        targetLeptonY: team.tgtY,
        missionTargetLeptonX: team.mtgtX,
        missionTargetLeptonY: team.mtgtY,
      },
      dog: {
        mission: dog[7],
        hp: dog[14],
        leptonX: dog[12],
        leptonY: dog[13],
      },
      e1: {
        mission: e1.m,
        missionTimer: e1.mt,
        missionQueue: e1.mq,
        isDriving: e1.drv,
        leptonX: e1.lx,
        leptonY: e1.ly,
        headToLX: e1.hlx ?? 0,
        headToLY: e1.hly ?? 0,
        moveTargetLX: e1.nlx ?? null,
        moveTargetLY: e1.nly ?? null,
      },
    };
  });
}

async function tsPatrolSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const team = ((window as any).__rawTeams?.() ?? []).find((t: any) => t.typeName === 'cmdatk');
    const e1 = game.entities.find((e: any) => e.id === 67);
    if (!team) throw new Error('TS SCU02EA cmdatk team missing');
    if (!e1) throw new Error('TS SCU02EA GoodGuy E1 id 67 missing');

    const targetEntity = team.targetEntityRef ?? null;
    const missionTargetEntity = team.missionTargetEntityRef ?? null;
    const targetLepton = targetEntity
      ? { lx: targetEntity.leptonX, ly: targetEntity.leptonY }
      : team.target
        ? { lx: Math.trunc(team.target.x * 256 / 24), ly: Math.trunc(team.target.y * 256 / 24) }
        : null;
    const missionTargetLepton = missionTargetEntity
      ? { lx: missionTargetEntity.leptonX, ly: missionTargetEntity.leptonY }
      : team.missionTarget
        ? { lx: Math.trunc(team.missionTarget.x * 256 / 24), ly: Math.trunc(team.missionTarget.y * 256 / 24) }
        : null;

    return {
      tick: game.tick,
      rngState: state.rngState,
      team: {
        targetEntityId: targetEntity?.id ?? null,
        missionTargetEntityId: missionTargetEntity?.id ?? null,
        targetLeptonX: targetLepton?.lx ?? null,
        targetLeptonY: targetLepton?.ly ?? null,
        missionTargetLeptonX: missionTargetLepton?.lx ?? null,
        missionTargetLeptonY: missionTargetLepton?.ly ?? null,
      },
      e1: {
        mission: e1.mission,
        missionTimer: e1.missionTimer,
        missionQueue: e1.missionQueue,
        isDriving: e1.isDriving,
        leptonX: e1.leptonX,
        leptonY: e1.leptonY,
        headToLX: e1.headToLX,
        headToLY: e1.headToLY,
        moveTargetLX: e1.moveTarget?.lx ?? null,
        moveTargetLY: e1.moveTarget?.ly ?? null,
      },
    };
  });
}

function sortMembersByPosition<T extends { leptonX: number; leptonY: number }>(members: T[]): T[] {
  return [...members].sort((a, b) => (a.leptonX - b.leptonX) || (a.leptonY - b.leptonY));
}

async function wasmAttackOverrideSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const team = state.teams.find((t: any) => t.cls === 'cmdatk');
    if (!team) throw new Error('C++ SCU02EA cmdatk team missing');

    const memberIds = team.members.flatMap((m: any) => m.ids ?? []);
    const members = state.logicLayer
      .filter((r: any[]) => (r[5] === 'I' || r[5] === 'U') && memberIds.includes(r[6]))
      .map((r: any[]) => ({
        id: r[6],
        mission: r[7],
        missionTimer: r[8],
        missionQueue: r[9],
        isDriving: r[10],
        leptonX: r[12],
        leptonY: r[13],
        hp: r[14],
        targetKind: r[30],
        targetRtti: r[32],
        targetIndex: r[33],
      }));

    return {
      tick: state.tick,
      rngState: state.rngState,
      team: {
        targetLeptonX: team.tgtX,
        targetLeptonY: team.tgtY,
        missionTargetLeptonX: team.mtgtX,
        missionTargetLeptonY: team.mtgtY,
      },
      members,
    };
  });
}

async function tsAttackOverrideSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const team = ((window as any).__rawTeams?.() ?? []).find((t: any) => t.typeName === 'cmdatk');
    if (!team) throw new Error('TS SCU02EA cmdatk team missing');

    const targetEntity = team.targetEntityRef ?? null;
    const targetLepton = targetEntity
      ? { lx: targetEntity.leptonX, ly: targetEntity.leptonY }
      : team.target
        ? { lx: Math.trunc(team.target.x * 256 / 24), ly: Math.trunc(team.target.y * 256 / 24) }
        : null;

    return {
      tick: game.tick,
      rngState: state.rngState,
      team: {
        targetEntityId: targetEntity?.id ?? null,
        targetLeptonX: targetLepton?.lx ?? null,
        targetLeptonY: targetLepton?.ly ?? null,
        missionTargetEntityId: team.missionTargetEntityRef?.id ?? null,
        missionTargetLeptonX: team.missionTarget ? Math.trunc(team.missionTarget.x * 256 / 24) : null,
        missionTargetLeptonY: team.missionTarget ? Math.trunc(team.missionTarget.y * 256 / 24) : null,
      },
      members: team._members.map((e: any) => ({
        id: e.id,
        mission: e.mission,
        missionTimer: e.missionTimer,
        missionQueue: e.missionQueue,
        isDriving: e.isDriving,
        leptonX: e.leptonX,
        leptonY: e.leptonY,
        hp: e.hp,
        targetId: e.target?.id ?? null,
        moveTargetLX: e.moveTarget?.lx ?? null,
        moveTargetLY: e.moveTarget?.ly ?? null,
      })),
    };
  });
}

async function wasmDamageRetargetSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const team = state.teams.find((t: any) => t.cls === 'cmdatk');
    if (!team) throw new Error('C++ SCU02EA cmdatk team missing');

    const member = state.logicLayer.find((r: any[]) => r[6] === 851994);
    const attacker = state.logicLayer.find((r: any[]) => r[6] === 851995);
    if (!member) throw new Error('C++ SCU02EA GoodGuy E1 id 851994 missing');
    if (!attacker) throw new Error('C++ SCU02EA USSR E1 id 851995 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      team: {
        targetLeptonX: team.tgtX,
        targetLeptonY: team.tgtY,
        missionTargetLeptonX: team.mtgtX,
        missionTargetLeptonY: team.mtgtY,
        zoneLeptonX: team.zoneX,
        zoneLeptonY: team.zoneY,
      },
      member: {
        mission: member[7],
        missionTimer: member[8],
        isDriving: member[10],
        hp: member[14],
        leptonX: member[12],
        leptonY: member[13],
        targetLeptonX: member[21],
        targetLeptonY: member[22],
      },
      attacker: {
        hp: attacker[14],
        leptonX: attacker[12],
        leptonY: attacker[13],
      },
    };
  });
}

async function tsDamageRetargetSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const team = ((window as any).__rawTeams?.() ?? []).find((t: any) => t.typeName === 'cmdatk');
    if (!team) throw new Error('TS SCU02EA cmdatk team missing');

    const member = team._members.find((e: any) => e.id === 70);
    const attacker = game.entities.find((e: any) => e.id === 72);
    if (!member) throw new Error('TS SCU02EA GoodGuy E1 id 70 missing');
    if (!attacker) throw new Error('TS SCU02EA USSR E1 id 72 missing');
    const targetEntity = team.targetEntityRef ?? null;

    return {
      tick: game.tick,
      rngState: state.rngState,
      team: {
        targetEntityId: targetEntity?.id ?? null,
        targetLeptonX: targetEntity?.leptonX ?? null,
        targetLeptonY: targetEntity?.leptonY ?? null,
        missionTargetEntityId: team.missionTargetEntityRef?.id ?? null,
        zoneLeptonX: team.zoneLeptonX,
        zoneLeptonY: team.zoneLeptonY,
      },
      member: {
        mission: member.mission,
        missionTimer: member.missionTimer,
        isDriving: member.isDriving,
        hp: member.hp,
        leptonX: member.leptonX,
        leptonY: member.leptonY,
        targetLeptonX: member.target?.leptonX ?? null,
        targetLeptonY: member.target?.leptonY ?? null,
      },
      attacker: {
        hp: attacker.hp,
        leptonX: attacker.leptonX,
        leptonY: attacker.leptonY,
      },
    };
  });
}

async function stepBothInCppSizedChunks(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>>> {
  let result: Awaited<ReturnType<typeof stepBoth>> | null = null;
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 15);
    result = await stepBoth(handle, chunk);
    remaining -= chunk;
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU02EA patrol dead dog target', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps the raw zero-strength dog as the patrol mission target', async () => {
    await withDualScenario('SCU02EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBothInCppSizedChunks(handle, 688);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      const cpp = await wasmPatrolSnapshot(handle.wasm);
      const ts = await tsPatrolSnapshot(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(cpp.dog.hp).toBe(0);
      expect(cpp.team.targetLeptonX).toBe(cpp.dog.leptonX);
      expect(cpp.team.targetLeptonY).toBe(cpp.dog.leptonY);
      expect(cpp.team.missionTargetLeptonX).toBe(cpp.dog.leptonX);
      expect(cpp.team.missionTargetLeptonY).toBe(cpp.dog.leptonY);

      expect(ts.team.targetLeptonX).toBe(cpp.team.targetLeptonX);
      expect(ts.team.targetLeptonY).toBe(cpp.team.targetLeptonY);
      expect(ts.team.missionTargetLeptonX).toBe(cpp.team.missionTargetLeptonX);
      expect(ts.team.missionTargetLeptonY).toBe(cpp.team.missionTargetLeptonY);
      expect(ts.team.targetEntityId).not.toBeNull();
      expect(ts.team.missionTargetEntityId).toBe(ts.team.targetEntityId);

      expect(cpp.e1.mission).toBe(2);
      expect(ts.e1.mission).toBe('MOVE');
      expect(ts.e1.missionTimer).toBe(cpp.e1.missionTimer);
      expect(ts.e1.missionQueue).toBe('GUARD');
      expect(cpp.e1.missionQueue).toBe(5);
      expect(ts.e1.isDriving).toBe(cpp.e1.isDriving);
      expect(ts.e1.leptonX).toBe(cpp.e1.leptonX);
      expect(ts.e1.leptonY).toBe(cpp.e1.leptonY);
      expect(ts.e1.headToLX).toBe(cpp.e1.headToLX);
      expect(ts.e1.headToLY).toBe(cpp.e1.headToLY);
      expect(ts.e1.moveTargetLX).toBeNull();
      expect(ts.e1.moveTargetLY).toBeNull();
    }, { wasmSeed: 0 });
  }, 180_000);

  it('preserves a damage override target when the patrol scan finds no new threat', async () => {
    await withDualScenario('SCU02EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBothInCppSizedChunks(handle, 729);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      const cpp = await wasmAttackOverrideSnapshot(handle.wasm);
      const ts = await tsAttackOverrideSnapshot(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(cpp.team.targetLeptonX).toBe(18368);
      expect(cpp.team.targetLeptonY).toBe(12864);
      expect(cpp.team.missionTargetLeptonX).toBe(0);
      expect(cpp.team.missionTargetLeptonY).toBe(0);

      expect(ts.team.targetEntityId).not.toBeNull();
      expect(ts.team.targetLeptonX).toBe(cpp.team.targetLeptonX);
      expect(ts.team.targetLeptonY).toBe(cpp.team.targetLeptonY);
      expect(ts.team.missionTargetEntityId).toBeNull();
      expect(ts.team.missionTargetLeptonX).toBeNull();
      expect(ts.team.missionTargetLeptonY).toBeNull();

      const cppMembers = sortMembersByPosition(cpp.members);
      const tsMembers = sortMembersByPosition(ts.members);
      expect(tsMembers).toHaveLength(cppMembers.length);
      for (let i = 0; i < cppMembers.length; i++) {
        expect(tsMembers[i].mission).toBe('MOVE');
        expect(cppMembers[i].mission).toBe(2);
        expect(tsMembers[i].missionTimer).toBe(cppMembers[i].missionTimer);
        expect(tsMembers[i].missionQueue).toBe('ATTACK');
        expect(cppMembers[i].missionQueue).toBe(1);
        expect(tsMembers[i].isDriving).toBe(cppMembers[i].isDriving);
        expect(tsMembers[i].hp).toBe(cppMembers[i].hp);
        expect(tsMembers[i].leptonX).toBe(cppMembers[i].leptonX);
        expect(tsMembers[i].leptonY).toBe(cppMembers[i].leptonY);
        expect(tsMembers[i].targetId).toBe(ts.team.targetEntityId);
        expect(tsMembers[i].moveTargetLX).toBeNull();
        expect(tsMembers[i].moveTargetLY).toBeNull();
        expect(cppMembers[i].targetRtti).toBe(13);
      }
    }, { wasmSeed: 0 });
  }, 180_000);

  it('retargets a moving patrol to a new attacker when the old target cannot cover the team zone', async () => {
    await withDualScenario('SCU02EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const retargetResult = await stepBothInCppSizedChunks(handle, 852);
      expect(retargetResult.ts.state.rngState >>> 0).toBe(retargetResult.wasm.state.rngState! >>> 0);

      const retargetCpp = await wasmDamageRetargetSnapshot(handle.wasm);
      const retargetTs = await tsDamageRetargetSnapshot(handle.ts);

      expect(retargetTs.tick).toBe(retargetCpp.tick);
      expect(retargetCpp.team.zoneLeptonX).toBe(18312);
      expect(retargetCpp.team.zoneLeptonY).toBe(12424);
      expect(retargetCpp.team.targetLeptonX).toBe(19008);
      expect(retargetCpp.team.targetLeptonY).toBe(12992);
      expect(retargetCpp.team.missionTargetLeptonX).toBe(0);
      expect(retargetCpp.team.missionTargetLeptonY).toBe(0);

      expect(retargetTs.team.zoneLeptonX).toBe(retargetCpp.team.zoneLeptonX);
      expect(retargetTs.team.zoneLeptonY).toBe(retargetCpp.team.zoneLeptonY);
      expect(retargetTs.team.targetEntityId).toBe(72);
      expect(retargetTs.team.targetLeptonX).toBe(retargetCpp.team.targetLeptonX);
      expect(retargetTs.team.targetLeptonY).toBe(retargetCpp.team.targetLeptonY);
      expect(retargetTs.team.missionTargetEntityId).toBeNull();

      const shotResult = await stepBothInCppSizedChunks(handle, 19);
      expect(shotResult.ts.state.rngState >>> 0).toBe(shotResult.wasm.state.rngState! >>> 0);

      const shotCpp = await wasmDamageRetargetSnapshot(handle.wasm);
      const shotTs = await tsDamageRetargetSnapshot(handle.ts);
      expect(shotTs.tick).toBe(shotCpp.tick);
      expect(shotCpp.tick).toBe(871);
      expect(shotTs.member.mission).toBe('ATTACK');
      expect(shotCpp.member.mission).toBe(1);
      expect(shotTs.member.isDriving).toBe(shotCpp.member.isDriving);
      expect(shotTs.member.leptonX).toBe(shotCpp.member.leptonX);
      expect(shotTs.member.leptonY).toBe(shotCpp.member.leptonY);
      expect(shotTs.member.targetLeptonX).toBe(shotCpp.member.targetLeptonX);
      expect(shotTs.member.targetLeptonY).toBe(shotCpp.member.targetLeptonY);
      expect(shotTs.attacker.hp).toBe(shotCpp.attacker.hp);
      expect(shotCpp.attacker.hp).toBe(35);
    }, { wasmSeed: 0 });
  }, 180_000);
});
