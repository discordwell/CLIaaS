import { describe, it, expect } from 'vitest';
import { OracleStrategy } from '../oracle/OracleStrategy.js';
import type { RAGameState, RAEntity, RAStructure } from '../oracle/WasmAdapter.js';

/**
 * Minelayer Oracle Tests — verify the OracleStrategy's mine-laying
 * dispatch logic using pure data fixtures (no WASM or browser needed).
 *
 * The minelayer (MNLY) should visit predefined waypoints on enemy approach
 * paths and deploy mines at each one. It should not be sent into combat.
 */

function makeEntity(
  id: number, t: string, house: string,
  cx: number, cy: number,
  hp = 100, mhp = 100, m = 5, // m=5 is MISSION_GUARD
  extra: Partial<RAEntity> = {},
): RAEntity {
  return { id, t, house, cx, cy, hp, mhp, m, ally: true, ...extra };
}

function makeStructure(
  id: number, t: string, house: string,
  cx: number, cy: number,
  ally = true,
): RAStructure {
  return { id, t, house, cx, cy, hp: 256, mhp: 256, m: 0, ally, repairing: false };
}

function makeState(overrides: Partial<RAGameState> = {}): RAGameState {
  return {
    tick: 100,
    credits: 5000,
    playerHouse: 'Greece',
    alliedHouses: ['Greece'],
    globals: [],
    missionTimer: 0,
    missionTimerActive: false,
    civEvacuated: false,
    winPending: false,
    losePending: false,
    power: { produced: 200, consumed: 50 },
    units: [],
    enemies: [],
    structures: [],
    production: [],
    buildable: { structures: [], units: [], infantry: [] },
    ...overrides,
  };
}

describe('minelayer oracle — mine-laying dispatch', () => {
  it('sends minelayer to first mine waypoint when idle at base', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const mnly = makeEntity(1, 'MNLY', 'Greece', 90, 50, 100, 100, 5, { ammo: 5, maxAmmo: 5 });
    const conYard = makeStructure(100, 'FACT', 'Greece', 90, 50);

    const decision = strategy.decide(makeState({
      units: [mnly],
      structures: [conYard],
    }));

    // Should issue a move command toward the first mine waypoint
    const moveCmd = decision.commands.find(
      (c) => c.cmd === 'move' && Array.isArray(c.ids) && (c.ids as number[]).includes(1),
    );
    expect(moveCmd).toBeDefined();
    expect(moveCmd!.cx).toBe(72);
    expect(moveCmd!.cy).toBe(48);
    expect(decision.reason).toContain('MNLY');
  });

  it('deploys mine when minelayer arrives at waypoint', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const conYard = makeStructure(100, 'FACT', 'Greece', 90, 50);

    // First call: move to waypoint
    const mnlyFar = makeEntity(1, 'MNLY', 'Greece', 90, 50, 100, 100, 5, { ammo: 5, maxAmmo: 5 });
    strategy.decide(makeState({
      units: [mnlyFar],
      structures: [conYard],
    }));

    // Second call: minelayer has arrived at waypoint (72, 48)
    const mnlyAtWp = makeEntity(1, 'MNLY', 'Greece', 72, 48, 100, 100, 5, { ammo: 5, maxAmmo: 5 });
    const decision = strategy.decide(makeState({
      units: [mnlyAtWp],
      structures: [conYard],
    }));

    // Should issue a deploy command
    const deployCmd = decision.commands.find(
      (c) => c.cmd === 'deploy' && Array.isArray(c.ids) && (c.ids as number[]).includes(1),
    );
    expect(deployCmd).toBeDefined();
    expect(decision.reason).toContain('deploys mine');
  });

  it('advances to next waypoint after deploying', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const conYard = makeStructure(100, 'FACT', 'Greece', 90, 50);

    // Call 1: move to waypoint 0
    strategy.decide(makeState({
      units: [makeEntity(1, 'MNLY', 'Greece', 90, 50, 100, 100, 5, { ammo: 5, maxAmmo: 5 })],
      structures: [conYard],
    }));

    // Call 2: arrive at waypoint 0, deploy
    strategy.decide(makeState({
      units: [makeEntity(1, 'MNLY', 'Greece', 72, 48, 100, 100, 5, { ammo: 5, maxAmmo: 5 })],
      structures: [conYard],
    }));

    // Call 3: minelayer now idle again (after deploy) — should move to waypoint 1 (70, 45)
    const decision = strategy.decide(makeState({
      units: [makeEntity(1, 'MNLY', 'Greece', 72, 48, 100, 100, 5, { ammo: 4, maxAmmo: 5 })],
      structures: [conYard],
    }));

    const moveCmd = decision.commands.find(
      (c) => c.cmd === 'move' && Array.isArray(c.ids) && (c.ids as number[]).includes(1),
    );
    expect(moveCmd).toBeDefined();
    expect(moveCmd!.cx).toBe(70);
    expect(moveCmd!.cy).toBe(45);
  });

  it('does not send minelayer to attack enemies', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const mnly = makeEntity(1, 'MNLY', 'Greece', 85, 50, 100, 100, 5, { ammo: 5, maxAmmo: 5 });
    const conYard = makeStructure(100, 'FACT', 'Greece', 90, 50);
    const enemy = makeEntity(50, '3TNK', 'USSR', 80, 50, 400, 400, 5);
    enemy.ally = false;

    const decision = strategy.decide(makeState({
      units: [mnly],
      enemies: [enemy],
      structures: [conYard],
    }));

    // MNLY should NOT have an attack command
    const attackCmd = decision.commands.find(
      (c) => c.cmd === 'attack' && Array.isArray(c.ids) && (c.ids as number[]).includes(1),
    );
    expect(attackCmd).toBeUndefined();
  });

  it('ignores minelayer with zero ammo', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const mnly = makeEntity(1, 'MNLY', 'Greece', 90, 50, 100, 100, 5, { ammo: 0, maxAmmo: 5 });
    const conYard = makeStructure(100, 'FACT', 'Greece', 90, 50);

    const decision = strategy.decide(makeState({
      units: [mnly],
      structures: [conYard],
    }));

    // No mine-laying commands for empty minelayer
    const mnlyCommands = decision.commands.filter(
      (c) => Array.isArray(c.ids) && (c.ids as number[]).includes(1),
    );
    expect(mnlyCommands.length).toBe(0);
  });

  it('starts mine-laying during MCV deployment phase', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const mcv = makeEntity(2, 'MCV', 'Greece', 90, 50, 600, 600, 5);
    const mnly = makeEntity(1, 'MNLY', 'Greece', 88, 50, 100, 100, 5, { ammo: 5, maxAmmo: 5 });

    const decision = strategy.decide(makeState({
      units: [mcv, mnly],
      structures: [],
    }));

    // Should have both MCV deploy and MNLY move
    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'deploy', ids: [2] }),
      ]),
    );
    const mnlyMove = decision.commands.find(
      (c) => c.cmd === 'move' && Array.isArray(c.ids) && (c.ids as number[]).includes(1),
    );
    expect(mnlyMove).toBeDefined();
  });
});
