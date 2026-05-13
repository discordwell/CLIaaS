/**
 * @vitest-environment jsdom
 *
 * C++ behavioral parity: TechnoClass::AI clears TarCom when the target house
 * considers the shooter allied, even when the shooter's house does not
 * reciprocate that alliance.
 *
 * C++ refs:
 *   techno.cpp:2390-2395 — post-MissionClass self-fire target clear
 *   house.cpp:2023-2031  — Is_Ally uses the caller's one-way alliance bits
 *   foot.cpp:1077-1084   — Mission_Guard_Area returns 1 when scan finds TarCom
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds, setPlayerHouses } from '../engine/entity';
import { STRUCTURE_WEAPONS, type MapStructure } from '../engine/scenario';
import { CELL_SIZE, House, Mission, RESFACTOR, UnitType } from '../engine/types';
import { ScenarioRandom } from '../engine/random';
import { clearAllTeams } from '../engine/team';

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

function structure(type: string, house: House, cx: number, cy: number): MapStructure {
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: 400,
    maxHp: 400,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    mission: Mission.GUARD,
    missionTimer: 0,
  } as MapStructure;
}

function runStructureLogic(game: Game): void {
  const g = game as unknown as {
    readonly _combatCtx: unknown;
    tickStructuresInterleaved(ctx: unknown): void;
  };
  g.tickStructuresInterleaved(g._combatCtx);
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
  setPlayerHouses(new Set([House.USSR, House.Turkey]));
  ScenarioRandom.seed = 0x1f725abf;
  ScenarioRandom.callCount = 0;
});

describe('TechnoClass::AI one-way target-house ally clear', () => {
  it('does not retain an AREA_GUARD structure target that reverse-allies the scanner', () => {
    const game = new Game(createCanvas());
    game.playerHouse = House.USSR;
    game.map.setBounds(0, 0, 128, 128);
    (game as unknown as { alliances: Map<House, Set<House>> }).alliances = new Map<House, Set<House>>([
      [House.USSR, new Set<House>([House.USSR, House.Turkey])],
      [House.Turkey, new Set<House>([House.Turkey, House.USSR])],
      [House.Germany, new Set<House>([House.Germany, House.GoodGuy])],
      [House.Greece, new Set<House>([House.Greece, House.Germany])],
      [House.GoodGuy, new Set<House>([House.GoodGuy, House.Greece, House.Germany, House.Turkey])],
    ]);

    const civilian = new Entity(
      UnitType.I_C7,
      House.Germany,
      88 * CELL_SIZE + CELL_SIZE / 2,
      39 * CELL_SIZE + CELL_SIZE / 2,
    );
    civilian.mission = Mission.AREA_GUARD;
    civilian.guardOrigin = { x: civilian.pos.x, y: civilian.pos.y };
    civilian.missionTimer = 0;

    const village = structure('V06', House.Greece, 90, 39);
    game.entities.push(civilian);
    game.entityById.set(civilian.id, civilian);
    game.structures.push(village);
    (game as unknown as { discoveredStructureIds: Set<number> }).discoveredStructureIds.add(0);

    (game as unknown as { updateEntity(entity: Entity): void }).updateEntity(civilian);

    expect(civilian.targetStructure).toBeNull();
    expect(civilian.target).toBeNull();
    expect(civilian.missionTimer).toBe(0);
    expect(civilian.ammo).toBe(civilian.maxAmmo);
  });

  it('clears a building target when the target house reverse-allies the scanner', () => {
    const game = new Game(createCanvas());
    game.playerHouse = House.USSR;
    game.map.setBounds(0, 0, 128, 128);
    (game as unknown as { alliances: Map<House, Set<House>> }).alliances = new Map<House, Set<House>>([
      [House.USSR, new Set<House>([House.USSR])],
      [House.BadGuy, new Set<House>([House.BadGuy])],
      [House.Greece, new Set<House>([House.Greece, House.BadGuy])],
    ]);

    const tower = {
      ...structure('FTUR', House.BadGuy, 75, 32),
      weapon: STRUCTURE_WEAPONS.FTUR,
    };
    const infantry = new Entity(
      UnitType.I_E3,
      House.Greece,
      73 * CELL_SIZE + CELL_SIZE / 2,
      35 * CELL_SIZE + CELL_SIZE / 2,
    );
    infantry.mission = Mission.SLEEP;
    infantry.missionTimer = 999;

    game.structures.push(tower);
    game.entities.push(infantry);
    game.entityById.set(infantry.id, infantry);

    runStructureLogic(game);

    expect(tower.mission).toBe(Mission.ATTACK);
    expect(tower.targetEntityId).toBeUndefined();
    expect(tower.missionTimer).toBe(0);

    const callsAfterGuard = ScenarioRandom.callCount;
    runStructureLogic(game);

    expect(tower.mission).toBe(Mission.GUARD);
    expect(tower.targetEntityId).toBeUndefined();
    expect(tower.missionTimer).toBe(0);
    expect(ScenarioRandom.callCount).toBe(callsAfterGuard);
  });
});
