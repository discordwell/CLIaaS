/**
 * Dual-runtime check for vehicle Basic_Path through infantry occupy flags.
 *
 * SCA04EA tick 70 has a Germany ANT3 trying to route around a barrel at
 * (112,64). C++ Find_Path accepts the enemy infantry reservation at (112,65) at
 * MOVE_DESTROYABLE threshold, then DriveClass::Start_Of_Move clears Path[0]
 * because that cell has no physical Cell_Object() to attack. TS must not treat
 * that reservation as a friendly/temp blocker and route north instead.
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

async function wasmAnt3(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const ant = [
      ...(state.units ?? []),
      ...(state.enemies ?? []),
      ...(state.vessels ?? []),
    ].find((u: any) => u.t === 'ANT3' && u.house === 'Germany' && u.cx === 111 && u.cy === 65);
    if (!ant) throw new Error('C++ SCA04EA Germany ANT3 path probe not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: ant.m,
      missionTimer: ant.mt,
      path: [ant.p0, ant.p1, ant.p2, ant.p3, ant.p4],
      pathThreshold: ant.pth,
      primaryFacing: ant.pf,
      desiredFacing: ant.pfd,
      isDriving: ant.drv,
      navCell: { cx: ant.ncx, cy: ant.ncy },
      arm: ant.arm,
      weapon: ant.wpn,
      targetLeptons: { lx: ant.tlx, ly: ant.tly },
      scatterLog: (state.bulletScatterLog ?? []).filter((entry: any) =>
        entry.frame === 83 &&
        entry.wh === 5 &&
        entry.pbx === 28544 &&
        entry.pby === 16768),
    };
  });
}

async function tsAnt3(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const ant = game.entities.find((entity: any) =>
      entity.alive !== false &&
      entity.type === 'ANT3' &&
      entity.house === 'Germany' &&
      entity.cell?.cx === 111 &&
      entity.cell?.cy === 65);
    if (!ant) throw new Error('TS SCA04EA Germany ANT3 path probe not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: ant.mission,
      missionTimer: ant.missionTimer,
      path: ant.path.slice(0, 5).map((cell: any) => ({ cx: cell.cx, cy: cell.cy })),
      pathFacings: ant.drivePathFacings.slice(0, 5),
      pathThreshold: ant.pathThreshold,
      primaryFacing: ant.bodyFacing256,
      desiredFacing: ant.desiredFacing256,
      isDriving: ant.isDriving,
      attackCooldown: ant.attackCooldown,
      moveTarget: ant.moveTarget
        ? { cx: Math.floor(ant.moveTarget.lx / 256), cy: Math.floor(ant.moveTarget.ly / 256) }
        : null,
      target: ant.target
        ? { type: ant.target.type, cx: ant.target.cell.cx, cy: ant.target.cell.cy }
        : null,
      weapon: ant.weapon
        ? {
            name: ant.weapon.name,
            projSpeed: ant.weapon.projSpeed,
            isInvisible: ant.weapon.isInvisible,
            isDropping: ant.weapon.isDropping,
          }
        : null,
    };
  });
}

async function wasmHuntAnt11164(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const ant = [
      ...(state.units ?? []),
      ...(state.enemies ?? []),
      ...(state.vessels ?? []),
    ].find((u: any) => u.t === 'ANT3' && u.house === 'Germany' && u.cx === 111 && u.cy === 64);
    if (!ant) throw new Error('C++ SCA04EA Germany ANT3 hunt probe not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: ant.m,
      missionTimer: ant.mt,
      arm: ant.arm,
      primaryFacing: ant.pf,
      desiredFacing: ant.pfd,
      isDriving: ant.drv,
      targetCell: {
        cx: Math.floor((ant.tlx ?? 0) / 256),
        cy: Math.floor((ant.tly ?? 0) / 256),
      },
      weapon: ant.wpn,
    };
  });
}

async function tsHuntAnt11164(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const ant = game.entities.find((entity: any) =>
      entity.alive !== false &&
      entity.type === 'ANT3' &&
      entity.house === 'Germany' &&
      entity.cell?.cx === 111 &&
      entity.cell?.cy === 64);
    if (!ant) throw new Error('TS SCA04EA Germany ANT3 hunt probe not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: ant.mission,
      missionTimer: ant.missionTimer,
      attackCooldown: ant.attackCooldown,
      primaryFacing: ant.bodyFacing256,
      desiredFacing: ant.desiredFacing256,
      isDriving: ant.isDriving,
      target: ant.target
        ? { type: ant.target.type, cx: ant.target.cell.cx, cy: ant.target.cell.cy }
        : null,
      weapon: ant.weapon ? ant.weapon.name : null,
    };
  });
}

async function wasmDeadInfantryBlockerAnt11164(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const ant = [
      ...(state.units ?? []),
      ...(state.enemies ?? []),
      ...(state.vessels ?? []),
    ].find((u: any) => u.t === 'ANT3' && u.house === 'Germany' && u.cx === 111 && u.cy === 64);
    const blocker = (state.logicLayer ?? []).find((row: any[]) =>
      row[1] === 'E1' && row[2] === 'England' && row[3] === 112 && row[4] === 65);
    if (!ant || !blocker) throw new Error('C++ SCA04EA dead-infantry blocker probe not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: ant.m,
      missionTimer: ant.mt,
      isDriving: ant.drv,
      path: [ant.p0, ant.p1, ant.p2, ant.p3],
      pathThreshold: ant.pth,
      targetCell: ant.tlx === undefined ? null : {
        cx: Math.floor(ant.tlx / 256),
        cy: Math.floor(ant.tly / 256),
      },
      navCell: ant.nlx === undefined ? null : {
        cx: ant.ncx,
        cy: ant.ncy,
      },
      blocker: {
        hp: blocker[14],
        mission: blocker[7],
        cell: { cx: blocker[3], cy: blocker[4] },
      },
    };
  });
}

async function tsDeadInfantryBlockerAnt11164(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const ant = game.entities.find((entity: any) =>
      entity.alive !== false &&
      entity.type === 'ANT3' &&
      entity.house === 'Germany' &&
      entity.cell?.cx === 111 &&
      entity.cell?.cy === 64);
    const blocker = game.entities.find((entity: any) =>
      entity.type === 'E1' &&
      entity.house === 'England' &&
      entity.cell?.cx === 112 &&
      entity.cell?.cy === 65);
    if (!ant || !blocker) throw new Error('TS SCA04EA dead-infantry blocker probe not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: ant.mission,
      missionTimer: ant.missionTimer,
      isDriving: ant.isDriving,
      path: ant.path.slice(0, 4).map((cell: any) => ({ cx: cell.cx, cy: cell.cy })),
      pathThreshold: ant.pathThreshold,
      moveTarget: ant.moveTarget
        ? { cx: Math.floor(ant.moveTarget.lx / 256), cy: Math.floor(ant.moveTarget.ly / 256) }
        : null,
      target: ant.target
        ? { type: ant.target.type, cx: ant.target.cell.cx, cy: ant.target.cell.cy }
        : null,
      blocker: {
        hp: blocker.hp,
        alive: blocker.alive,
        mission: blocker.mission,
        deathComplete: blocker.isInfantryDeathAnimationComplete?.(),
        cell: { cx: blocker.cell.cx, cy: blocker.cell.cy },
      },
    };
  });
}

async function wasmPatrolTeamAnt11165(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const antRow = (state.logicLayer ?? []).find((row: any[]) => row[0] === 94);
    if (!antRow) throw new Error('C++ SCA04EA patrol ANT3 logic row not found');
    const fullAnt = [
      ...(state.units ?? []),
      ...(state.enemies ?? []),
      ...(state.vessels ?? []),
    ].find((unit: any) => unit.id === antRow[6]);
    const team = (state.teams ?? []).find((candidate: any) =>
      candidate.cls === 'ptrl2' &&
      (candidate.members ?? []).some((member: any) => (member.ids ?? []).includes(antRow[6])));
    if (!team) throw new Error('C++ SCA04EA ptrl2 team not found');
    const targetCell = team.tgtX || team.tgtY
      ? { cx: Math.floor(team.tgtX / 256), cy: Math.floor(team.tgtY / 256) }
      : null;
    const missionTargetCell = team.mtgtX || team.mtgtY
      ? { cx: Math.floor(team.mtgtX / 256), cy: Math.floor(team.mtgtY / 256) }
      : null;
    return {
      tick: state.tick,
      rngState: state.rngState,
      ant: {
        mission: antRow[7],
        missionTimer: antRow[8],
        targetCell: fullAnt?.tlx || fullAnt?.tly
          ? { cx: Math.floor(fullAnt.tlx / 256), cy: Math.floor(fullAnt.tly / 256) }
          : null,
        navCell: fullAnt?.nlx || fullAnt?.nly
          ? { cx: fullAnt.ncx, cy: fullAnt.ncy }
          : null,
      },
      team: {
        currentMission: team.cur,
        targetCell,
        missionTargetCell,
      },
    };
  });
}

async function tsPatrolTeamAnt11165(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const ant = game.entities.find((entity: any) => entity.logicIndexHint === 94);
    if (!ant?.teamRef) throw new Error('TS SCA04EA patrol ANT3/team not found');
    const team = ant.teamRef;
    const targetCell = team.targetEntityRef
      ? { cx: team.targetEntityRef.cell.cx, cy: team.targetEntityRef.cell.cy }
      : team.targetCell
        ? { cx: team.targetCell.cx, cy: team.targetCell.cy }
        : team.target
          ? { cx: Math.floor(team.target.x / 24), cy: Math.floor(team.target.y / 24) }
          : null;
    const missionTargetCell = team.missionTargetEntityRef
      ? { cx: team.missionTargetEntityRef.cell.cx, cy: team.missionTargetEntityRef.cell.cy }
      : team.missionTargetCell
        ? { cx: team.missionTargetCell.cx, cy: team.missionTargetCell.cy }
        : team.missionTarget
          ? { cx: Math.floor(team.missionTarget.x / 24), cy: Math.floor(team.missionTarget.y / 24) }
          : null;
    return {
      tick: state.tick,
      rngState: state.rngState,
      ant: {
        mission: ant.mission,
        missionTimer: ant.missionTimer,
        target: ant.target
          ? { type: ant.target.type, house: ant.target.house, cx: ant.target.cell.cx, cy: ant.target.cell.cy }
          : null,
        moveTarget: ant.moveTarget
          ? { cx: Math.floor(ant.moveTarget.lx / 256), cy: Math.floor(ant.moveTarget.ly / 256) }
          : null,
      },
      team: {
        currentMission: team.currentMission,
        targetCell,
        missionTargetCell,
      },
    };
  });
}

async function wasmSameHouseTeamTargetFireState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const antRow = (state.logicLayer ?? []).find((row: any[]) => row[0] === 94);
    const friendlyAntRow = (state.logicLayer ?? []).find((row: any[]) =>
      row[1] === 'ANT3' && row[2] === 'Germany' && row[3] === 111 && row[4] === 64);
    const barrelRow = (state.logicLayer ?? []).find((row: any[]) =>
      row[1] === 'BARL' && row[3] === 112 && row[4] === 64);
    if (!antRow || !friendlyAntRow || !barrelRow) {
      throw new Error('C++ SCA04EA same-house target fire probe not found');
    }
    const fullAnt = [
      ...(state.units ?? []),
      ...(state.enemies ?? []),
      ...(state.vessels ?? []),
    ].find((unit: any) => unit.id === antRow[6]);
    const team = (state.teams ?? []).find((candidate: any) =>
      candidate.cls === 'ptrl2' &&
      (candidate.members ?? []).some((member: any) => (member.ids ?? []).includes(antRow[6])));
    if (!team) throw new Error('C++ SCA04EA ptrl2 team not found for fire probe');
    const targetCell = team.tgtX || team.tgtY
      ? { cx: Math.floor(team.tgtX / 256), cy: Math.floor(team.tgtY / 256) }
      : null;
    const missionTargetCell = team.mtgtX || team.mtgtY
      ? { cx: Math.floor(team.mtgtX / 256), cy: Math.floor(team.mtgtY / 256) }
      : null;
    return {
      tick: state.tick,
      rngState: state.rngState,
      attacker: {
        mission: antRow[7],
        missionTimer: antRow[8],
        arm: antRow[23],
        targetCell: fullAnt?.tlx || fullAnt?.tly
          ? { cx: Math.floor(fullAnt.tlx / 256), cy: Math.floor(fullAnt.tly / 256) }
          : null,
      },
      friendlyAnt: {
        mission: friendlyAntRow[7],
        missionTimer: friendlyAntRow[8],
        hp: friendlyAntRow[14],
      },
      barrel: {
        hp: barrelRow[14],
      },
      team: {
        currentMission: team.cur,
        targetCell,
        missionTargetCell,
      },
    };
  });
}

async function tsSameHouseTeamTargetFireState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const attacker = game.entities.find((entity: any) => entity.logicIndexHint === 94);
    const friendlyAnt = game.entities.find((entity: any) =>
      entity.type === 'ANT3' &&
      entity.house === 'Germany' &&
      entity.cell?.cx === 111 &&
      entity.cell?.cy === 64);
    const barrel = game.structures.find((structure: any) =>
      structure.type === 'BARL' &&
      structure.cx === 112 &&
      structure.cy === 64);
    if (!attacker?.teamRef || !friendlyAnt || !barrel) {
      throw new Error('TS SCA04EA same-house target fire probe not found');
    }
    const team = attacker.teamRef;
    const targetCell = team.targetEntityRef
      ? { cx: team.targetEntityRef.cell.cx, cy: team.targetEntityRef.cell.cy }
      : team.targetCell
        ? { cx: team.targetCell.cx, cy: team.targetCell.cy }
        : team.target
          ? { cx: Math.floor(team.target.x / 24), cy: Math.floor(team.target.y / 24) }
          : null;
    const missionTargetCell = team.missionTargetEntityRef
      ? { cx: team.missionTargetEntityRef.cell.cx, cy: team.missionTargetEntityRef.cell.cy }
      : team.missionTargetCell
        ? { cx: team.missionTargetCell.cx, cy: team.missionTargetCell.cy }
        : team.missionTarget
          ? { cx: Math.floor(team.missionTarget.x / 24), cy: Math.floor(team.missionTarget.y / 24) }
          : null;
    return {
      tick: state.tick,
      rngState: state.rngState,
      attacker: {
        mission: attacker.mission,
        missionTimer: attacker.missionTimer,
        arm: attacker.attackCooldown,
        target: attacker.target
          ? { type: attacker.target.type, house: attacker.target.house, cx: attacker.target.cell.cx, cy: attacker.target.cell.cy }
          : null,
      },
      friendlyAnt: {
        mission: friendlyAnt.mission,
        missionTimer: friendlyAnt.missionTimer,
        hp: friendlyAnt.hp,
      },
      barrel: {
        hp: barrel.hp,
      },
      team: {
        currentMission: team.currentMission,
        targetCell,
        missionTargetCell,
      },
    };
  });
}

async function wasmAttachedFireBarrelState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const barrel = (state.structures ?? []).find((structure: any) =>
      structure.t === 'BARL' && structure.cx === 112 && structure.cy === 64);
    const animNamesAtBarrel = (state.anims ?? [])
      .filter((anim: any) => anim.cx === 112 && anim.cy === 64)
      .map((anim: any) => anim.name)
      .sort();
    return {
      tick: state.tick,
      rngState: state.rngState,
      barrel: barrel ? { hp: barrel.hp } : null,
      animNamesAtBarrel,
    };
  });
}

async function tsAttachedFireBarrelState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const barrel = game.structures.find((structure: any) =>
      structure.type === 'BARL' &&
      structure.cx === 112 &&
      structure.cy === 64 &&
      structure.alive !== false);
    const animTypesAtBarrel = (game.logicAnims ?? [])
      .filter((anim: any) => Math.floor(anim.x / 24) === 112 && Math.floor(anim.y / 24) === 64)
      .map((anim: any) => anim.type)
      .sort();
    return {
      tick: state.tick,
      rngState: state.rngState,
      barrel: barrel ? { hp: barrel.hp } : null,
      animTypesAtBarrel,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCA04 infantry reservation pathing', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('clears the east-first path instead of routing north through an infantry claim', async () => {
    await withDualScenario('SCA04EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBoth(handle, 70);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);

      const cpp = await wasmAnt3(handle.wasm);
      const ts = await tsAnt3(handle.ts);

      expect(cpp.tick).toBe(70);
      expect(cpp.path).toEqual([-1, 1, 2, 1, -1]);
      expect(cpp.pathThreshold).toBe(3);
      expect(cpp.primaryFacing).toBe(64);
      expect(cpp.desiredFacing).toBe(64);
      expect(cpp.isDriving).toBe(false);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.mission).toBe('HUNT');
      expect(ts.path).toEqual([]);
      expect(ts.pathThreshold).toBe(cpp.pathThreshold);
      expect(ts.primaryFacing).toBe(cpp.primaryFacing);
      expect(ts.desiredFacing).toBe(cpp.desiredFacing);
      expect(ts.isDriving).toBe(false);
      expect(ts.moveTarget).toEqual(cpp.navCell);

      result = await stepBoth(handle, 10);
      expect(result.ts.state.tick).toBe(80);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('overrides HUNT to ATTACK when the next track cell is an enemy infantry blocker', async () => {
    await withDualScenario('SCA04EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBoth(handle, 84);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);

      const cpp = await wasmAnt3(handle.wasm);
      const ts = await tsAnt3(handle.ts);

      expect(cpp.tick).toBe(84);
      expect(cpp.mission).toBe(1); // MISSION_ATTACK
      expect(cpp.arm).toBe(24);
      expect(cpp.weapon).toBe('Napalm');
      expect(cpp.scatterLog).toHaveLength(1);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.mission).toBe('ATTACK');
      expect(ts.attackCooldown).toBe(cpp.arm);
      expect(ts.moveTarget).toBeNull();
      expect(ts.target).toEqual({ type: 'E1', cx: 112, cy: 65 });
      expect(ts.weapon).toEqual({
        name: 'Napalm',
        projSpeed: 100,
        isInvisible: true,
        isDropping: undefined,
      });
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('does not run TS-only ant retargeting between C++ Mission_Hunt scans', async () => {
    await withDualScenario('SCA04EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBoth(handle, 99);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);

      const cpp = await wasmHuntAnt11164(handle.wasm);
      const ts = await tsHuntAnt11164(handle.ts);

      expect(cpp.tick).toBe(99);
      expect(cpp.mission).toBe(14); // MISSION_HUNT
      expect(cpp.missionTimer).toBe(6);
      expect(cpp.arm).toBe(0);
      expect(cpp.targetCell).toEqual({ cx: 116, cy: 64 });

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.mission).toBe('HUNT');
      expect(ts.missionTimer).toBe(cpp.missionTimer);
      expect(ts.attackCooldown).toBe(cpp.arm);
      expect(ts.primaryFacing).toBe(cpp.primaryFacing);
      expect(ts.desiredFacing).toBe(cpp.desiredFacing);
      expect(ts.isDriving).toBe(cpp.isDriving);
      expect(ts.target).toEqual({ type: 'GNRL', cx: 116, cy: 64 });
      expect(ts.weapon).toBe(cpp.weapon);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('treats a dying infantry Cell_Occupier as a DriveClass MOVE_DESTROYABLE blocker', async () => {
    await withDualScenario('SCA04EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBoth(handle, 108);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);

      const cpp = await wasmDeadInfantryBlockerAnt11164(handle.wasm);
      const ts = await tsDeadInfantryBlockerAnt11164(handle.ts);

      expect(cpp.tick).toBe(108);
      expect(cpp.blocker).toEqual({
        hp: 0,
        mission: 5,
        cell: { cx: 112, cy: 65 },
      });
      expect(cpp.mission).toBe(1); // MISSION_ATTACK from DriveClass::Override_Mission
      expect(cpp.missionTimer).toBe(0);
      expect(cpp.isDriving).toBe(false);
      expect(cpp.path[0]).toBe(-1);
      expect(cpp.targetCell).toBeNull();
      expect(cpp.navCell).toBeNull();

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.blocker).toMatchObject({
        hp: 0,
        alive: false,
        deathComplete: false,
        cell: { cx: 112, cy: 65 },
      });
      expect(ts.mission).toBe('ATTACK');
      expect(ts.missionTimer).toBe(cpp.missionTimer);
      expect(ts.isDriving).toBe(false);
      expect(ts.path).toEqual([]);
      expect(ts.pathThreshold).toBe(cpp.pathThreshold);
      expect(ts.moveTarget).toBeNull();
      expect(ts.target).toBeNull();
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('keeps the patrol team on the same-house splash damage target before resuming waypoints', async () => {
    await withDualScenario('SCA04EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBoth(handle, 104);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);

      const cpp = await wasmPatrolTeamAnt11165(handle.wasm);
      const ts = await tsPatrolTeamAnt11165(handle.ts);

      expect(cpp.tick).toBe(104);
      expect(cpp.team).toEqual({
        currentMission: 0,
        targetCell: { cx: 111, cy: 64 },
        missionTargetCell: null,
      });
      expect(cpp.ant).toMatchObject({
        mission: 14, // MISSION_HUNT after the friendly target is rejected by Attack AI
        missionTimer: 14,
        targetCell: null,
        navCell: { cx: 115, cy: 63 },
      });

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.team).toEqual(cpp.team);
      expect(ts.ant.mission).toBe('HUNT');
      expect(ts.ant.missionTimer).toBe(cpp.ant.missionTimer);
      expect(ts.ant.target).toBeNull();
      expect(ts.ant.moveTarget).toEqual(cpp.ant.navCell);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('does not fire on the same-house team damage target during patrol attack', async () => {
    await withDualScenario('SCA04EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBoth(handle, 119);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);

      const cpp = await wasmSameHouseTeamTargetFireState(handle.wasm);
      const ts = await tsSameHouseTeamTargetFireState(handle.ts);

      expect(cpp.tick).toBe(119);
      expect(cpp.team).toEqual({
        currentMission: 0,
        targetCell: { cx: 111, cy: 64 },
        missionTargetCell: null,
      });
      expect(cpp.attacker).toEqual({
        mission: 1, // MISSION_ATTACK
        missionTimer: 15,
        arm: 0,
        targetCell: null,
      });
      expect(cpp.friendlyAnt.hp).toBe(85);
      expect(cpp.barrel.hp).toBe(4);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.team).toEqual(cpp.team);
      expect(ts.attacker).toMatchObject({
        mission: 'ATTACK',
        missionTimer: cpp.attacker.missionTimer,
        arm: cpp.attacker.arm,
        target: null,
      });
      expect(ts.friendlyAnt.hp).toBe(cpp.friendlyAnt.hp);
      expect(ts.barrel.hp).toBe(cpp.barrel.hp);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('lets attached fire damage destroy the low-health barrel', async () => {
    await withDualScenario('SCA04EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBoth(handle, 161);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);

      const cpp = await wasmAttachedFireBarrelState(handle.wasm);
      const ts = await tsAttachedFireBarrelState(handle.ts);

      expect(cpp.tick).toBe(161);
      expect(cpp.barrel).toBeNull();
      expect(cpp.animNamesAtBarrel).toEqual(expect.arrayContaining(['FBALL1', 'FIRE2', 'FIRE3']));

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.barrel).toBeNull();
      expect(ts.animTypesAtBarrel).toEqual(expect.arrayContaining(['fball1', 'fire_med', 'fire_small']));
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 180_000);
});
