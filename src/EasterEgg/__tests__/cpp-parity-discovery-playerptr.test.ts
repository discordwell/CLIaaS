/**
 * @vitest-environment jsdom
 *
 * C++ behavioral parity: TechnoClass::Revealed(PlayerPtr) uses strict
 * PlayerPtr ownership, not player-allied ownership.
 *
 * C++ refs:
 *   techno.cpp:760-792  Revealed(PlayerPtr), IsOwnedByPlayer gate
 *   techno.cpp:1061-1064 Per_Cell_Process reveals objects in visible cells
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds, setPlayerHouses } from '../engine/entity';
import { CELL_SIZE, House, MAP_CELLS, Mission, RESFACTOR, UnitType } from '../engine/types';
import { clearAllTeams, getActiveTeams } from '../engine/team';
import type { ScenarioTrigger, TeamType } from '../engine/scenario';

class FakeAudio {
  src = ''; preload = ''; volume = 1; currentTime = 0; muted = false; loop = false;
  addEventListener(): void {} removeEventListener(): void {}
  play(): Promise<void> { return Promise.resolve(); } pause(): void {}
  cloneNode(): FakeAudio { return new FakeAudio(); }
}

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 320 * RESFACTOR;
  canvas.height = 200 * RESFACTOR;
  return canvas;
}

function createGame(): Game {
  const game = new Game(createCanvas());
  game.playerHouse = House.Greece;
  game.map.setBounds(0, 0, 64, 64);
  (game as unknown as { alliances: Map<House, Set<House>> }).alliances = new Map([
    [House.Greece, new Set([House.Greece, House.England])],
    [House.England, new Set([House.England, House.Greece])],
    [House.USSR, new Set([House.USSR])],
  ]);
  setPlayerHouses(new Set([House.Greece, House.England]));
  return game;
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

beforeEach(() => {
  resetEntityIds();
  clearAllTeams();
});

describe('TechnoClass::Revealed(PlayerPtr) strict PlayerPtr discovery', () => {
  it('discovers newly unlimboed player-allied non-PlayerPtr objects in PlayerPtr visible cells', () => {
    const game = createGame();
    const england = new Entity(
      UnitType.I_E1,
      House.England,
      27 * CELL_SIZE + CELL_SIZE / 2,
      58 * CELL_SIZE + CELL_SIZE / 2
    );
    game.entities.push(england);
    game.entityById.set(england.id, england);
    (game as unknown as { _houseRevealed: Map<number, Set<number>> })._houseRevealed =
      new Map([[1, new Set([58 * MAP_CELLS + 27])]]);

    (game as unknown as { markDiscoveredIfPlayerVisible(e: Entity): void })
      .markDiscoveredIfPlayerVisible(england);

    const discovered = (game as unknown as { discoveredEntityIds: Set<number> }).discoveredEntityIds;
    expect(discovered.has(england.id)).toBe(true);
  });

  it('does not let fogDisabled reveal-all debug state discover the map', () => {
    const game = createGame();
    const england = new Entity(
      UnitType.I_E1,
      House.England,
      27 * CELL_SIZE + CELL_SIZE / 2,
      58 * CELL_SIZE + CELL_SIZE / 2
    );
    game.entities.push(england);
    game.entityById.set(england.id, england);
    game.fogDisabled = true;
    game.map.revealAll();

    (game as unknown as { markDiscoveredIfPlayerVisible(e: Entity): void })
      .markDiscoveredIfPlayerVisible(england);

    const discovered = (game as unknown as { discoveredEntityIds: Set<number> }).discoveredEntityIds;
    expect(discovered.has(england.id)).toBe(false);
  });

  it('does not discover enemy objects from allied-house revealed cells alone', () => {
    const game = createGame();
    const ussr = new Entity(
      UnitType.I_E4,
      House.USSR,
      30 * CELL_SIZE + CELL_SIZE / 2,
      60 * CELL_SIZE + CELL_SIZE / 2
    );
    game.entities.push(ussr);
    game.entityById.set(ussr.id, ussr);
    game.fogDisabled = true;
    (game as unknown as { _houseRevealed: Map<number, Set<number>> })._houseRevealed =
      new Map([[1, new Set([60 * MAP_CELLS + 30])]]);

    (game as unknown as { markDiscoveredIfPlayerVisible(e: Entity): void })
      .markDiscoveredIfPlayerVisible(ussr);

    const discovered = (game as unknown as { discoveredEntityIds: Set<number> }).discoveredEntityIds;
    expect(discovered.has(ussr.id)).toBe(false);
  });

  it('springs attached DISCOVERED triggers immediately when an object is revealed', () => {
    const game = createGame();
    game.playerHouse = House.Greece;

    const player = new Entity(
      UnitType.I_E1,
      House.Greece,
      50 * CELL_SIZE + CELL_SIZE / 2,
      50 * CELL_SIZE + CELL_SIZE / 2
    );
    const enemy = new Entity(
      UnitType.I_E1,
      House.USSR,
      51 * CELL_SIZE + CELL_SIZE / 2,
      50 * CELL_SIZE + CELL_SIZE / 2
    );
    enemy.mission = Mission.GUARD;
    enemy.triggerName = 'spot';
    game.entities.push(player, enemy);
    game.entityById.set(player.id, player);
    game.entityById.set(enemy.id, enemy);

    const teamTypes: TeamType[] = [{
      name: 'spotteam',
      house: 2,
      flags: 0,
      maxAllowed: 5,
      origin: 0,
      trigger: -1,
      members: [{ type: 'E1', count: 1 }],
      missions: [{ mission: 3, data: 4 }],
    }];
    const trigger: ScenarioTrigger = {
      name: 'spot',
      persistence: 0,
      house: 2,
      eventControl: 0,
      actionControl: 0,
      event1: { type: 4, team: -1, data: 0 },
      event2: { type: 0, team: -1, data: 0 },
      action1: { action: 4, team: 0, trigger: -1, data: -1 },
      action2: { action: 0, team: -1, trigger: -1, data: 0 },
      fired: false,
      timerTick: 0,
      playerEntered: false,
      playerEnteredHouse: -1,
      objectDiscovered: false,
      enteredZone: false,
      crossedHorizontal: false,
      crossedVertical: false,
      forceFirePending: false,
      pendingDestroyedCount: 0,
      triggeringEntityIds: [],
    };
    (game as unknown as { teamTypes: TeamType[] }).teamTypes = teamTypes;
    (game as unknown as { triggers: ScenarioTrigger[] }).triggers = [trigger];
    (game as unknown as { waypoints: Map<number, { cx: number; cy: number }> }).waypoints =
      new Map([[0, { cx: 51, cy: 50 }], [4, { cx: 52, cy: 50 }]]);

    (game as unknown as { checkDiscoveryTriggers(): void }).checkDiscoveryTriggers();

    expect(trigger.objectDiscovered).toBe(true);
    expect(trigger.fired).toBe(true);
    expect(getActiveTeams()).toHaveLength(1);
    expect(getActiveTeams()[0].typeName).toBe('spotteam');
  });
});
