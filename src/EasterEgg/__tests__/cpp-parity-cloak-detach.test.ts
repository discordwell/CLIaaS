/**
 * @vitest-environment jsdom
 *
 * C++ Behavioral Parity: TechnoClass::Do_Cloak -> FootClass::Detach_All.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { CloakState, Entity, resetEntityIds } from '../engine/entity';
import { clearAllTeams, registerTeam, Team, TMISSION_ATTACK } from '../engine/team';
import { CELL_SIZE, House, Mission, RESFACTOR, UnitType, cellTargetToLepton } from '../engine/types';

class FakeAudio {
  src = ''; preload = ''; volume = 1; currentTime = 0; muted = false; loop = false;
  addEventListener(): void {}
  removeEventListener(): void {}
  play(): Promise<void> { return Promise.resolve(); }
  pause(): void {}
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
  game.map.setBounds(0, 0, 128, 128);
  return game;
}

function addEntity(game: Game, entity: Entity): void {
  game.entities.push(entity);
  game.entityById.set(entity.id, entity);
}

function cloakDetach(game: Game, entity: Entity): void {
  (game as unknown as {
    detachEntityFromTargeting(entity: Entity, all: boolean): void;
  }).detachEntityFromTargeting(entity, false);
}

function updateSubCloak(game: Game, entity: Entity): void {
  (game as unknown as {
    updateSubCloak(entity: Entity): void;
  }).updateSubCloak(entity);
}

function cleanupCompletedInfantryDeathAnimations(game: Game): void {
  (game as unknown as {
    cleanupCompletedInfantryDeathAnimations(): void;
  }).cleanupCompletedInfantryDeathAnimations();
}

beforeEach(() => {
  resetEntityIds();
  clearAllTeams();
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

describe('TechnoClass::Do_Cloak detach parity', () => {
  it('FootClass::Detach_All removes a cloaking team member but preserves NavCom', () => {
    const game = createGame();
    const sub = new Entity(UnitType.V_SS, House.USSR, 68 * CELL_SIZE + 12, 46 * CELL_SIZE + 12);
    const dest = cellTargetToLepton(60, 46);
    sub.mission = Mission.MOVE;
    sub.moveTarget = dest;

    const team = new Team({
      house: House.USSR,
      desiredMembers: [{ type: UnitType.V_SS, count: 1 }],
      missionList: [],
      forcedActive: true,
    });
    team.add(sub);
    addEntity(game, sub);

    cloakDetach(game, sub);

    expect(sub.teamRef).toBeNull();
    expect(team.total).toBe(0);
    expect(sub.mission).toBe(Mission.MOVE);
    expect(sub.moveTarget).toEqual(dest);
  });

  it('Cloaking_AI VISUAL_HIDDEN transition runs Detach_All(false) for foot objects', () => {
    const game = createGame();
    const sub = new Entity(UnitType.V_SS, House.USSR, 98 * CELL_SIZE + 12, 48 * CELL_SIZE + 12);
    const dest = cellTargetToLepton(68, 46);
    sub.mission = Mission.MOVE;
    sub.moveTarget = dest;
    sub.cloakState = CloakState.CLOAKING;
    sub.cloakTimer = 1;

    const team = new Team({
      house: House.USSR,
      desiredMembers: [{ type: UnitType.V_SS, count: 1 }],
      missionList: [],
      forcedActive: true,
    });
    team.add(sub);
    addEntity(game, sub);

    updateSubCloak(game, sub);

    expect(sub.cloakState).toBe(CloakState.CLOAKED);
    expect(sub.teamRef).toBeNull();
    expect(team.total).toBe(0);
    expect(sub.mission).toBe(Mission.MOVE);
    expect(sub.moveTarget).toEqual(dest);
  });

  it('InfantryClass death-animation delete clears team MissionTarget before removing Logic object', () => {
    const game = createGame();
    const attacker = new Entity(UnitType.I_E1, House.BadGuy, 75 * CELL_SIZE, 38 * CELL_SIZE);
    const corpse = new Entity(UnitType.I_E1, House.Greece, 70 * CELL_SIZE + 18, 59 * CELL_SIZE + 18);
    corpse.alive = false;
    corpse.hp = 0;
    corpse.mission = Mission.DIE;
    corpse.deathVariant = 1;
    corpse.deathTick = corpse.infantryDeathDurationTicks();

    const team = new Team({
      house: House.BadGuy,
      typeName: 'hunt1',
      desiredMembers: [{ type: UnitType.I_E1, count: 1 }],
      missionList: [{ mission: TMISSION_ATTACK, data: 2 }],
      forcedActive: true,
    });
    team.add(attacker);
    registerTeam(team);
    addEntity(game, attacker);
    addEntity(game, corpse);
    (team as unknown as { setMissionTarget(t: { x: number; y: number }, c: null, e: Entity): void })
      .setMissionTarget({ x: corpse.pos.x, y: corpse.pos.y }, null, corpse);

    cleanupCompletedInfantryDeathAnimations(game);

    expect(game.entities).not.toContain(corpse);
    expect(game.entityById.has(corpse.id)).toBe(false);
    expect(team.target).toBeNull();
    expect((team as unknown as { missionTarget: unknown }).missionTarget).toBeNull();
    expect((team as unknown as { missionTargetEntityRef: Entity | null }).missionTargetEntityRef).toBeNull();
  });
});
