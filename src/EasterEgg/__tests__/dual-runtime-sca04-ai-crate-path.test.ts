/**
 * Dual-runtime check for AI ground-unit crate passability.
 *
 * In SCA04EA, a Germany ANT3 repaths near a wooden crate overlay at (65,75).
 * C++ UnitClass::Can_Enter_Cell returns MOVE_NO for AI-owned wood/steel crates
 * in normal games, forcing Basic_Path to escalate through the moving blockers
 * on the north route. TS must not route the AI ant through the crate cell.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MoveResult } from '../engine/map.js';
import {
  ensureParityServer,
  isDevServerAvailable,
  stopParityServer,
  withDualScenario,
  type DualRuntimeHandle,
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

async function stepBothAligned(handle: DualRuntimeHandle, ticks: number): Promise<void> {
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(15, remaining);
    await Promise.all([
      handle.wasm.step(chunk),
      handle.ts.step(chunk),
    ]);
    remaining -= chunk;
  }
}

async function wasmPatrolAntPath(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const module = (window as any).Module;
    const state = JSON.parse(module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) => entry[0] === 298);
    if (!row) throw new Error('C++ SCA04EA patrol ANT3 logic row not found');
    const ant = [
      ...(state.units ?? []),
      ...(state.enemies ?? []),
      ...(state.vessels ?? []),
    ].find((unit: any) => unit.id === row[6]);
    if (!ant) throw new Error('C++ SCA04EA patrol ANT3 unit not found');
    const crateCell = JSON.parse(module.ccall(
      'agent_get_cell_info',
      'string',
      ['number', 'number', 'number'],
      [65, 75, ant.id],
    ));
    return {
      tick: state.tick,
      path: [ant.p0, ant.p1, ant.p2, ant.p3, ant.p4, ant.p5, ant.p6],
      pathThreshold: ant.pth,
      desiredFacing: ant.pfd,
      crateCell,
    };
  });
}

async function tsPatrolAntPath(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const ant = game.entities.find((entity: any) => entity.logicIndexHint === 298);
    if (!ant) throw new Error('TS SCA04EA patrol ANT3 not found');
    return {
      tick: state.tick,
      path: ant.path.slice(0, 7).map((cell: any) => ({ cx: cell.cx, cy: cell.cy })),
      facings: ant.drivePathFacings.slice(0, 7),
      pathThreshold: ant.pathThreshold,
      desiredFacing: ant.desiredFacing256,
      crateOverlay: game.map.overlay[75 * 128 + 65],
      crateMove: game.canEnterTrackJumpCell(ant, 65, 75),
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCA04 AI crate pathing', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('treats land crate overlays as MOVE_NO for AI ground units', async () => {
    await withDualScenario('SCA04EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBothAligned(handle, 963);

      const cpp = await wasmPatrolAntPath(handle.wasm);
      const ts = await tsPatrolAntPath(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(cpp.crateCell.overlay).toBe(21);
      expect(cpp.crateCell.canEnter).toBe(MoveResult.IMPASSABLE);
      expect(ts.crateOverlay).toBe(cpp.crateCell.overlay);
      expect(ts.crateMove).toBe(cpp.crateCell.canEnter);

      expect(ts.pathThreshold).toBe(cpp.pathThreshold);
      expect(ts.desiredFacing).toBe(cpp.desiredFacing);
      expect(ts.facings).toEqual(cpp.path);
      expect(ts.path).not.toContainEqual({ cx: 65, cy: 75 });
    }, { wasmSeed: 0 });
  }, 180_000);
});
