/**
 * @vitest-environment jsdom
 *
 * C++ parity: TACTION_REVEAL_ZONE maps cells with PlayerPtr, and each mapped
 * cell runs DisplayClass::Map_Cell's object discovery side effect.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { NodeAgentAdapter } from './node-agent-adapter';
import { ScenarioRandom } from '../engine/random';
import { House, Mission, UnitType } from '../engine/types';

describe('TACTION_REVEAL_ZONE discovery side effect', () => {
  afterEach(() => {
    ScenarioRandom._tagLoggingExternal = false;
  });

  it('reveals SCU03 zone occupants before the C7 AREA_GUARD scan', async () => {
    ScenarioRandom._tagLoggingExternal = true;

    const adapter = new NodeAgentAdapter();
    await adapter.loadScenario('SCU03EA', 'normal');
    adapter.step(219);

    const game = (adapter as unknown as { game: {
      entities: Array<{
        id: number;
        type: UnitType;
        house: House;
        cell: { cx: number; cy: number };
        mission: Mission;
        missionTimer: number;
        idleAnimTimer: number;
      }>;
      discoveredEntityIds: Set<number>;
    } }).game;

    const c7 = game.entities.find(e =>
      e.type === UnitType.I_C7 &&
      e.house === House.Germany &&
      e.cell.cx === 88 &&
      e.cell.cy === 39);
    const greekE3 = game.entities.find(e =>
      e.type === UnitType.I_E3 &&
      e.house === House.Greece &&
      e.cell.cx === 89 &&
      e.cell.cy === 37);

    expect(c7).toBeDefined();
    expect(greekE3).toBeDefined();
    expect(game.discoveredEntityIds.has(greekE3!.id)).toBe(true);

    adapter.step(1);

    expect(c7!.mission).toBe(Mission.AREA_GUARD);
    expect(c7!.missionTimer).toBeLessThanOrEqual(1);
    expect(c7!.idleAnimTimer).toBe(0);

    adapter.disconnect();
  });
});
