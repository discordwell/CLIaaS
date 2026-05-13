/**
 * @vitest-environment jsdom
 *
 * C++ parity: SCU14EA global-trigger order.
 *
 * WASM trace:
 *   - tick 1: trigger `atks` sets global 3 after `lst4` has already been
 *     visited in LogicTriggers order, so the Greece LST/ARTY team is absent.
 *   - tick 2: the next LogicTriggers pass sees global 3 set and fires `lst4`.
 *
 * This guards against the old TS recursive global-trigger scan, which fired
 * `lst4` inside the `atks` action and injected an extra vessel AI RNG call on
 * tick 1.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { NodeAgentAdapter } from './node-agent-adapter';
import { House } from '../engine/types';

describe('SCU14EA ordered global trigger evaluation', () => {
  let adapter: NodeAgentAdapter | null = null;

  afterEach(() => {
    adapter?.disconnect();
    adapter = null;
  });

  function greekLst4Exists(state: ReturnType<NodeAgentAdapter['observe']>): boolean {
    return [...state.units, ...state.enemies].some(unit =>
      unit.t === 'LST' &&
      unit.h === 'Greece' &&
      unit.cx === 25 &&
      unit.cy === 76 &&
      unit.cargo === 4 &&
      unit.cargoTop === 'ARTY',
    );
  }

  function greekBuildVessel(): string | null {
    const game = (adapter as unknown as { game: {
      aiStates: Map<House, { buildVessel: string | null }>;
    } | null }).game;
    return game?.aiStates.get(House.Greece)?.buildVessel ?? null;
  }

  it('defers lst4 reinforcement from atks global 3 until the next LogicTriggers pass', async () => {
    adapter = new NodeAgentAdapter();
    await adapter.loadScenario('SCU14EA', 'normal');

    const tick1 = adapter.step(1).state;
    expect(tick1.globals).toContain(3);
    expect(greekLst4Exists(tick1)).toBe(false);
    expect(greekBuildVessel()).toBe('DD');

    const tick2 = adapter.step(1).state;
    expect(greekLst4Exists(tick2)).toBe(true);
    expect(greekBuildVessel()).toBe('CA');
  });
});
