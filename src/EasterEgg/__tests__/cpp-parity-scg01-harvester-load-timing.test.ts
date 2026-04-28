/**
 * SCG01EA regression for C++ UnitClass::Mission_Harvest load timing.
 *
 * The Soviet HARV reaches the ore at (72,56) during the opening. C++ waits for
 * the 9-stage HARV load animation at OreDumpRate=2 before each bail is pulled;
 * harvesting every 10 ticks depletes this patch early and sends the HARV toward
 * (71,55), which is visible in the parity harness at jeep-move-120.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { NodeAgentAdapter } from './node-agent-adapter';

function firstJeep(state: ReturnType<NodeAgentAdapter['observe']>) {
  const jeep = [...state.units]
    .filter(unit => unit.t === 'JEEP')
    .sort((a, b) => a.cy - b.cy || a.cx - b.cx || a.id - b.id)[0];
  expect(jeep).toBeDefined();
  return jeep;
}

describe('SCG01EA harvester load timing', () => {
  let adapter: NodeAgentAdapter | null = null;

  afterEach(() => {
    adapter?.disconnect();
    adapter = null;
  });

  it('keeps the Soviet HARV on the opening ore cell through jeep-move-120', async () => {
    adapter = new NodeAgentAdapter();
    await adapter.loadScenario('SCG01EA', 'normal');

    adapter.step(60);
    const jeep = firstJeep(adapter.observe());
    adapter.step(0, [{ cmd: 'move', unitIds: [jeep.id], cx: 45, cy: 84 }]);
    adapter.step(120);

    const harv = adapter.observe().enemies.find(unit => unit.t === 'HARV');
    expect(harv).toMatchObject({ cx: 72, cy: 56 });
  }, 20_000);
});
