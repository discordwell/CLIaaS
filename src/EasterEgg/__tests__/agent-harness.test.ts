import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Entity, setPlayerHouses, resetEntityIds } from '../engine/entity';
import { House, UnitType, Mission, CELL_SIZE, type SpeedClass } from '../engine/types';
import type { MapStructure } from '../engine/scenario';
import {
  serializeState, processCommands,
  type AgentCommand,
} from '../engine/agentHarness';

/**
 * Agent Harness Tests — verify state serialization and command processing
 * using mock Game objects (pure data tests, no canvas needed).
 */

// Mock findPath globally — returns a trivial path or empty
vi.mock('../engine/pathfinding', () => ({
  findPath: (_map: unknown, start: { cx: number; cy: number }, goal: { cx: number; cy: number }) => {
    // Return empty path if same cell, otherwise a direct hop
    if (start.cx === goal.cx && start.cy === goal.cy) return [];
    return [{ cx: goal.cx, cy: goal.cy }];
  },
}));

// Helper: create minimal mock Game
function makeGame(overrides: Partial<MockGame> = {}): MockGame {
  return {
    tick: 100,
    state: 'paused' as const,
    credits: 5000,
    powerProduced: 200,
    powerConsumed: 100,
    siloCapacity: 2000,
    entities: [],
    entityById: new Map(),
    structures: [],
    playerHouse: House.Spain,
    killCount: 3,
    lossCount: 1,
    productionQueue: new Map(),
    pendingPlacement: null,
    fogDisabled: true,
    map: {
      boundsX: 40,
      boundsY: 40,
      boundsW: 50,
      boundsH: 50,
      isPassable: () => true,
      isTerrainPassable: () => true,
    },
    _repairing: new Set<number>(),
    getAvailableItems: () => [],
    isAllied: (house: House, playerHouse: House) =>
      house === playerHouse || house === House.Greece || house === House.Neutral,
    startProduction: vi.fn(),
    cancelProduction: vi.fn(),
    placeStructure: vi.fn().mockReturnValue(true),
    deployMCV: vi.fn().mockReturnValue(true),
    sellStructureByIndex: vi.fn().mockReturnValue(true),
    toggleRepair: vi.fn().mockReturnValue(true),
    isStructureRepairing(idx: number) { return this._repairing.has(idx); },
    step: vi.fn(),
    ...overrides,
  } as unknown as MockGame;
}

// Type alias for our mock — just needs to match what harness accesses
type MockGame = ReturnType<typeof makeGame>;

function makeEntity(id: number, type: UnitType, house: House, cx: number, cy: number): Entity {
  const e = new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
  // Override the auto-incremented id
  (e as { id: number }).id = id;
  return e;
}

function makeStructure(
  type: string, house: House, cx: number, cy: number, alive = true,
): MapStructure {
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp: 256, maxHp: 256, alive, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function addEntity(game: MockGame, e: Entity) {
  (game as unknown as { entities: Entity[] }).entities.push(e);
  (game as unknown as { entityById: Map<number, Entity> }).entityById.set(e.id, e);
}

beforeEach(() => {
  resetEntityIds();
  setPlayerHouses(new Set([House.Spain, House.Greece]));
});

// ═══════════════════════════════════════════════════════════
// serializeState
// ═══════════════════════════════════════════════════════════

describe('serializeState', () => {
  it('returns correct tick, state, credits, and power', () => {
    const game = makeGame();
    const s = serializeState(game as unknown as Parameters<typeof serializeState>[0]);
    expect(s.tick).toBe(100);
    expect(s.state).toBe('paused');
    expect(s.credits).toBe(5000);
    expect(s.power).toEqual({ produced: 200, consumed: 100 });
    expect(s.siloCapacity).toBe(2000);
    expect(s.killCount).toBe(3);
    expect(s.lossCount).toBe(1);
  });

  it('serializes player units and enemies separately', () => {
    const game = makeGame();
    const playerUnit = makeEntity(10, UnitType.V_2TNK, House.Spain, 50, 50);
    const enemyUnit = makeEntity(20, UnitType.ANT1, House.USSR, 60, 60);
    addEntity(game, playerUnit);
    addEntity(game, enemyUnit);

    const s = serializeState(game as unknown as Parameters<typeof serializeState>[0]);
    expect(s.units).toHaveLength(1);
    expect(s.enemies).toHaveLength(1);
    expect(s.units[0].id).toBe(10);
    expect(s.units[0].t).toBe('2TNK');
    expect(s.units[0].cx).toBe(50);
    expect(s.units[0].cy).toBe(50);
    expect(s.units[0].ally).toBe(true);
    expect(s.enemies[0].id).toBe(20);
    expect(s.enemies[0].ally).toBe(false);
  });

  it('filters dead entities', () => {
    const game = makeGame();
    const alive = makeEntity(1, UnitType.I_E1, House.Spain, 50, 50);
    const dead = makeEntity(2, UnitType.I_E1, House.Spain, 51, 51);
    dead.alive = false;
    addEntity(game, alive);
    addEntity(game, dead);

    const s = serializeState(game as unknown as Parameters<typeof serializeState>[0]);
    expect(s.units).toHaveLength(1);
    expect(s.units[0].id).toBe(1);
  });

  it('serializes structures with repair flag', () => {
    const game = makeGame();
    const struct = makeStructure('POWR', House.Spain, 45, 45);
    (game as unknown as { structures: MapStructure[] }).structures = [struct];
    game._repairing.add(0);

    const s = serializeState(game as unknown as Parameters<typeof serializeState>[0]);
    expect(s.structures).toHaveLength(1);
    expect(s.structures[0].t).toBe('POWR');
    expect(s.structures[0].ally).toBe(true);
    expect(s.structures[0].rep).toBe(true);
  });

  it('treats neutral structures as allied when the game alliance table does', () => {
    const game = makeGame();
    const struct = makeStructure('V19', House.Neutral, 54, 49);
    (game as unknown as { structures: MapStructure[] }).structures = [struct];

    const s = serializeState(game as unknown as Parameters<typeof serializeState>[0]);
    expect(s.structures[0].ally).toBe(true);
  });

  it('serializes structure coordinates using the footprint center cell', () => {
    const game = makeGame();
    const struct = makeStructure('FIX', House.Spain, 71, 69);
    (game as unknown as { structures: MapStructure[] }).structures = [struct];

    const s = serializeState(game as unknown as Parameters<typeof serializeState>[0]);
    expect(s.structures[0].cx).toBe(72);
    expect(s.structures[0].cy).toBe(69); // FIX is [3,2]: cy = 69 + floor((2-1)/2) = 69
  });

  it('includes cell coordinates not pixel coords', () => {
    const game = makeGame();
    const unit = makeEntity(1, UnitType.I_E1, House.Spain, 55, 65);
    addEntity(game, unit);

    const s = serializeState(game as unknown as Parameters<typeof serializeState>[0]);
    expect(s.units[0].cx).toBe(55);
    expect(s.units[0].cy).toBe(65);
  });

  it('includes map bounds', () => {
    const game = makeGame();
    const s = serializeState(game as unknown as Parameters<typeof serializeState>[0]);
    expect(s.mapBounds).toEqual({ x: 40, y: 40, w: 50, h: 50 });
  });

  it('includes production queue', () => {
    const game = makeGame();
    (game as unknown as { productionQueue: Map<string, unknown> }).productionQueue.set('right', {
      item: { type: '2TNK', name: 'Medium Tank', buildTime: 100 },
      progress: 50,
      queueCount: 2,
    });

    const s = serializeState(game as unknown as Parameters<typeof serializeState>[0]);
    expect(s.production).toHaveLength(1);
    expect(s.production[0].t).toBe('2TNK');
    expect(s.production[0].prog).toBeCloseTo(0.5);
    expect(s.production[0].q).toBe(2);
  });

  it('includes pending placement type', () => {
    const game = makeGame({ pendingPlacement: { type: 'POWR' } as unknown as null });
    const s = serializeState(game as unknown as Parameters<typeof serializeState>[0]);
    expect(s.pending).toBe('POWR');
  });
});

// ═══════════════════════════════════════════════════════════
// processCommands — move
// ═══════════════════════════════════════════════════════════

describe('processCommands — move', () => {
  it('sets mission MOVE and path for valid unit', () => {
    const game = makeGame();
    const unit = makeEntity(1, UnitType.V_2TNK, House.Spain, 50, 50);
    addEntity(game, unit);

    const cmds: AgentCommand[] = [{ cmd: 'move', unitIds: [1], cx: 55, cy: 55 }];
    const results = processCommands(game as unknown as Parameters<typeof processCommands>[0], cmds);

    expect(results[0].ok).toBe(true);
    expect(unit.mission).toBe(Mission.MOVE);
    expect(unit.moveTarget).toBeTruthy();
  });

  it('reports error for invalid unit ID', () => {
    const game = makeGame();
    const cmds: AgentCommand[] = [{ cmd: 'move', unitIds: [999], cx: 55, cy: 55 }];
    const results = processCommands(game as unknown as Parameters<typeof processCommands>[0], cmds);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain('999');
  });
});

describe('processCommands — aircraft move', () => {
  it('aircraft skip pathfinding and get direct path', () => {
    const game = makeGame();
    // TRAN is an aircraft — use it for the test
    const tran = makeEntity(1, UnitType.V_TRAN, House.Spain, 50, 50);
    addEntity(game, tran);

    // Move to a far cell — aircraft should get direct path without findPath
    const cmds: AgentCommand[] = [{ cmd: 'move', unitIds: [1], cx: 85, cy: 47 }];
    const results = processCommands(game as unknown as Parameters<typeof processCommands>[0], cmds);

    expect(results[0].ok).toBe(true);
    expect(tran.mission).toBe(Mission.MOVE);
    expect(tran.path).toEqual([{ cx: 85, cy: 47 }]);
    expect(tran.moveTarget).toEqual({
      x: 85 * CELL_SIZE + CELL_SIZE / 2,
      y: 47 * CELL_SIZE + CELL_SIZE / 2,
    });
  });
});

// ═══════════════════════════════════════════════════════════
// processCommands — attack
// ═══════════════════════════════════════════════════════════

describe('processCommands — attack', () => {
  it('sets target and mission ATTACK for valid enemy', () => {
    const game = makeGame();
    const unit = makeEntity(1, UnitType.V_2TNK, House.Spain, 50, 50);
    const enemy = makeEntity(2, UnitType.ANT1, House.USSR, 55, 55);
    addEntity(game, unit);
    addEntity(game, enemy);

    const cmds: AgentCommand[] = [{ cmd: 'attack', unitIds: [1], targetId: 2 }];
    const results = processCommands(game as unknown as Parameters<typeof processCommands>[0], cmds);

    expect(results[0].ok).toBe(true);
    expect(unit.mission).toBe(Mission.ATTACK);
    expect(unit.target).toBe(enemy);
  });

  it('rejects attack on allied unit', () => {
    const game = makeGame();
    const unit = makeEntity(1, UnitType.V_2TNK, House.Spain, 50, 50);
    const ally = makeEntity(2, UnitType.I_E1, House.Spain, 55, 55);
    addEntity(game, unit);
    addEntity(game, ally);

    const cmds: AgentCommand[] = [{ cmd: 'attack', unitIds: [1], targetId: 2 }];
    const results = processCommands(game as unknown as Parameters<typeof processCommands>[0], cmds);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain('allied');
  });

  it('rejects attack on dead target', () => {
    const game = makeGame();
    const unit = makeEntity(1, UnitType.V_2TNK, House.Spain, 50, 50);
    const dead = makeEntity(2, UnitType.ANT1, House.USSR, 55, 55);
    dead.alive = false;
    addEntity(game, unit);
    addEntity(game, dead);

    const cmds: AgentCommand[] = [{ cmd: 'attack', unitIds: [1], targetId: 2 }];
    const results = processCommands(game as unknown as Parameters<typeof processCommands>[0], cmds);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain('not alive');
  });
});

// ═══════════════════════════════════════════════════════════
// processCommands — build
// ═══════════════════════════════════════════════════════════

describe('processCommands — build', () => {
  it('calls startProduction for available item', () => {
    const mockItem = { type: '2TNK', name: 'Medium Tank', cost: 800, buildTime: 100, isStructure: false, prerequisite: 'WEAP', faction: 'both' };
    const game = makeGame({
      getAvailableItems: () => [mockItem] as unknown as [],
    });

    const cmds: AgentCommand[] = [{ cmd: 'build', type: '2TNK' }];
    const results = processCommands(game as unknown as Parameters<typeof processCommands>[0], cmds);

    expect(results[0].ok).toBe(true);
    expect(game.startProduction).toHaveBeenCalledWith(mockItem);
  });

  it('rejects build for unavailable type', () => {
    const game = makeGame();
    const cmds: AgentCommand[] = [{ cmd: 'build', type: 'NUKE' }];
    const results = processCommands(game as unknown as Parameters<typeof processCommands>[0], cmds);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain('not available');
  });
});

// ═══════════════════════════════════════════════════════════
// processCommands — batch: failures don't block others
// ═══════════════════════════════════════════════════════════

describe('processCommands — batch', () => {
  it('processes all commands even when some fail', () => {
    const game = makeGame();
    const unit = makeEntity(1, UnitType.V_2TNK, House.Spain, 50, 50);
    addEntity(game, unit);

    const cmds: AgentCommand[] = [
      { cmd: 'attack', unitIds: [1], targetId: 999 }, // fails: no such target
      { cmd: 'move', unitIds: [1], cx: 55, cy: 55 },   // should still succeed
      { cmd: 'stop', unitIds: [1] },                    // should succeed
    ];

    const results = processCommands(game as unknown as Parameters<typeof processCommands>[0], cmds);
    expect(results).toHaveLength(3);
    expect(results[0].ok).toBe(false);
    expect(results[1].ok).toBe(true);
    expect(results[2].ok).toBe(true);
    // Stop was last, so unit should be in GUARD
    expect(unit.mission).toBe(Mission.GUARD);
  });
});

// ═══════════════════════════════════════════════════════════
// processCommands — place, sell, repair, deploy
// ═══════════════════════════════════════════════════════════

describe('processCommands — structure ops', () => {
  it('place delegates to game.placeStructure', () => {
    const game = makeGame({ pendingPlacement: { type: 'POWR' } as unknown as null });
    const cmds: AgentCommand[] = [{ cmd: 'place', cx: 50, cy: 50 }];
    const results = processCommands(game as unknown as Parameters<typeof processCommands>[0], cmds);
    expect(results[0].ok).toBe(true);
    expect(game.placeStructure).toHaveBeenCalledWith(50, 50);
  });

  it('place fails when no pending placement', () => {
    const game = makeGame();
    const cmds: AgentCommand[] = [{ cmd: 'place', cx: 50, cy: 50 }];
    const results = processCommands(game as unknown as Parameters<typeof processCommands>[0], cmds);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain('no pending');
  });

  it('sell delegates to game.sellStructureByIndex', () => {
    const game = makeGame();
    const cmds: AgentCommand[] = [{ cmd: 'sell', structIdx: 0 }];
    const results = processCommands(game as unknown as Parameters<typeof processCommands>[0], cmds);
    expect(results[0].ok).toBe(true);
    expect(game.sellStructureByIndex).toHaveBeenCalledWith(0);
  });

  it('repair delegates to game.toggleRepair', () => {
    const game = makeGame();
    const cmds: AgentCommand[] = [{ cmd: 'repair', structIdx: 2 }];
    const results = processCommands(game as unknown as Parameters<typeof processCommands>[0], cmds);
    expect(results[0].ok).toBe(true);
    expect(game.toggleRepair).toHaveBeenCalledWith(2);
  });

  it('deploy MCV delegates to game.deployMCV', () => {
    const game = makeGame();
    const mcv = makeEntity(1, UnitType.V_MCV, House.Spain, 50, 50);
    addEntity(game, mcv);

    const cmds: AgentCommand[] = [{ cmd: 'deploy', unitId: 1 }];
    const results = processCommands(game as unknown as Parameters<typeof processCommands>[0], cmds);
    expect(results[0].ok).toBe(true);
    expect(game.deployMCV).toHaveBeenCalledWith(mcv);
  });
});
