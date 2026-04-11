/**
 * @vitest-environment jsdom
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import { House, Mission, UnitType, CELL_SIZE, RESFACTOR } from '../engine/types';
import type { MapStructure } from '../engine/scenario';

class FakeAudio {
  src = '';
  preload = '';
  volume = 1;
  currentTime = 0;
  muted = false;
  loop = false;

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
  game.map.setBounds(0, 0, 24, 24);
  return game;
}

function callUpdateTeamMission(game: Game, entity: Entity): void {
  (game as unknown as { updateTeamMission(entity: Entity): void }).updateTeamMission(entity);
}

function callUpdateEntity(game: Game, entity: Entity): void {
  (game as unknown as { updateEntity(entity: Entity): void }).updateEntity(entity);
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

beforeEach(() => {
  resetEntityIds();
});

describe('Team mission parity hooks', () => {
  it('TMISSION_DEPLOY turns an MCV into a FACT owned by the MCV house', () => {
    const game = createGame();
    game.playerHouse = House.Greece;

    const mcv = new Entity(UnitType.V_MCV, House.England, 10 * CELL_SIZE + CELL_SIZE / 2, 10 * CELL_SIZE + CELL_SIZE / 2);
    mcv.teamMissions = [{ mission: 9, data: 0 }];
    game.entities.push(mcv);
    game.entityById.set(mcv.id, mcv);

    callUpdateTeamMission(game, mcv);

    expect(mcv.alive).toBe(false);
    expect(mcv.teamMissionIndex).toBe(1);
    expect(game.structures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'FACT',
          house: House.England,
          cx: 9,
          cy: 9,
        }),
      ]),
    );
  });

  it('TMISSION_DEPLOY drops a minelayer mine at the current cell', () => {
    const game = createGame();

    const mnly = new Entity(UnitType.V_MNLY, House.USSR, 7 * CELL_SIZE + CELL_SIZE / 2, 8 * CELL_SIZE + CELL_SIZE / 2);
    mnly.teamMissions = [{ mission: 9, data: 0 }];
    game.entities.push(mnly);
    game.entityById.set(mnly.id, mnly);

    callUpdateTeamMission(game, mnly);

    expect(mnly.teamMissionIndex).toBe(1);
    expect(mnly.ammo).toBe(4);
    expect(game.mines).toContainEqual({
      cx: 7,
      cy: 8,
      house: House.USSR,
      damage: 1000,
      type: 'AP',  // C++ unit.cpp:2616: Soviet houses place AP mines
    });
  });

  it('TMISSION_SPY turns a waypoint-on-building into a spy infiltration', () => {
    const game = createGame();
    game.playerHouse = House.Greece;
    game.tick = 8;

    const structure: MapStructure = {
      type: 'POWR',
      image: 'powr',
      house: House.USSR,
      cx: 5,
      cy: 5,
      hp: 200,
      maxHp: 200,
      alive: true,
      rubble: false,
      attackCooldown: 0,
      ammo: -1,
      maxAmmo: -1,
      triggerName: 'SPYS',
    };
    game.structures.push(structure);

    const spy = new Entity(
      UnitType.I_SPY,
      House.Greece,
      5 * CELL_SIZE + CELL_SIZE,
      5 * CELL_SIZE + CELL_SIZE,
    );
    spy.teamMissions = [{ mission: 15, data: 6 }];
    spy.lastAIScan = 0;
    game.entities.push(spy);
    game.entityById.set(spy.id, spy);
    ((game as unknown as { waypoints: Map<number, { cx: number; cy: number }> }).waypoints).set(6, { cx: 5, cy: 5 });

    callUpdateEntity(game, spy);

    expect(spy.alive).toBe(false);
    expect(spy.mission).toBe(Mission.DIE);
    expect(
      ((game as unknown as { spiedBuildingTriggers: Set<string> }).spiedBuildingTriggers).has('SPYS'),
    ).toBe(true);
  });

  it('TMISSION_CHANGE_FORMATION assigns stable offsets that later MOVE orders honor', () => {
    const game = createGame();
    const teamScript = [
      { mission: 2, data: 7 }, // FORMATION_LINE_NS
      { mission: 3, data: 6 },
    ];

    const lead = new Entity(UnitType.V_1TNK, House.USSR, 4 * CELL_SIZE, 4 * CELL_SIZE);
    lead.teamMissions = teamScript;
    const wing = new Entity(UnitType.V_1TNK, House.USSR, 5 * CELL_SIZE, 4 * CELL_SIZE);
    wing.teamMissions = teamScript;

    game.entities.push(lead, wing);
    game.entityById.set(lead.id, lead);
    game.entityById.set(wing.id, wing);
    ((game as unknown as { waypoints: Map<number, { cx: number; cy: number }> }).waypoints).set(6, { cx: 12, cy: 12 });

    callUpdateTeamMission(game, lead);
    callUpdateTeamMission(game, wing);

    expect(lead.teamMissionIndex).toBe(1);
    expect(wing.teamMissionIndex).toBe(1);
    expect(lead.formationOffset).not.toBeNull();
    expect(wing.formationOffset).not.toBeNull();
    expect(lead.formationOffset?.y).toBe(-CELL_SIZE);
    expect(wing.formationOffset?.y).toBe(CELL_SIZE);

    callUpdateTeamMission(game, lead);
    callUpdateTeamMission(game, wing);

    const baseX = 12 * CELL_SIZE + CELL_SIZE / 2;
    const baseY = 12 * CELL_SIZE + CELL_SIZE / 2;
    expect(lead.moveTarget).toEqual({ x: baseX, y: baseY - CELL_SIZE });
    expect(wing.moveTarget).toEqual({ x: baseX, y: baseY + CELL_SIZE });
  });

  // C++ team.cpp:1689-1721 — Coordinate_Attack assigns the team's
  // missionTarget (waypoint cell coordinate) as TarCom for each member,
  // then MISSION_ATTACK. The unit's Mission_Attack handles in-range target
  // acquisition naturally — it does NOT pre-scan the entire map for the
  // nearest player unit. Previously TS picked any visible player unit
  // within sight*2 OR 15 cells of waypoint, causing reinforcement teams
  // (e.g. SCG08EA YAKs spawned by trigger air3) to deviate ~30 cells off
  // their waypoint path to chase player units they could see but couldn't
  // yet hit. The fix limits the pre-scan to enemies actually in weapon
  // range — those would be auto-engaged during the move regardless.
  describe('TMISSION_ATT_WAYPT (C++ team.cpp:1689-1721 Coordinate_Attack)', () => {
    function makeBigMapGame(): Game {
      const game = new Game(createCanvas());
      game.map.setBounds(0, 0, 60, 60);
      return game;
    }

    it('does NOT auto-target enemies far outside weapon range', () => {
      const game = makeBigMapGame();
      game.playerHouse = House.Greece;

      // YAK has ChainGun (range ~5 cells). Player E1 is 30 cells away —
      // far out of weapon range but within sight*2. The buggy old code
      // would pick this E1 as the target.
      const yak = new Entity(UnitType.V_YAK, House.USSR, 5 * CELL_SIZE, 5 * CELL_SIZE);
      yak.teamMissions = [{ mission: 1, data: 11 }]; // TMISSION_ATT_WAYPT, wp 11
      yak.flightAltitude = 24; // airborne
      yak.lastAIScan = 0;
      game.entities.push(yak);
      game.entityById.set(yak.id, yak);

      const distantPlayer = new Entity(
        UnitType.I_E1,
        House.Greece,
        35 * CELL_SIZE + CELL_SIZE / 2,
        35 * CELL_SIZE + CELL_SIZE / 2,
      );
      game.entities.push(distantPlayer);
      game.entityById.set(distantPlayer.id, distantPlayer);

      ((game as unknown as { waypoints: Map<number, { cx: number; cy: number }> }).waypoints)
        .set(11, { cx: 50, cy: 50 });

      callUpdateTeamMission(game, yak);

      expect(yak.target).toBeNull();
      expect(yak.mission).toBe(Mission.MOVE);
      expect(yak.moveTarget).not.toBeNull();
    });

    it('DOES target enemies inside weapon range', () => {
      const game = makeBigMapGame();
      game.playerHouse = House.Greece;

      // 3TNK has 90mm (range 4 cells). Player E1 is 3 cells away — in range.
      const tank = new Entity(UnitType.V_3TNK, House.USSR, 5 * CELL_SIZE, 5 * CELL_SIZE);
      tank.teamMissions = [{ mission: 1, data: 11 }];
      tank.lastAIScan = 0;
      game.entities.push(tank);
      game.entityById.set(tank.id, tank);

      const closePlayer = new Entity(
        UnitType.I_E1,
        House.Greece,
        8 * CELL_SIZE + CELL_SIZE / 2,
        5 * CELL_SIZE + CELL_SIZE / 2,
      );
      game.entities.push(closePlayer);
      game.entityById.set(closePlayer.id, closePlayer);

      ((game as unknown as { waypoints: Map<number, { cx: number; cy: number }> }).waypoints)
        .set(11, { cx: 50, cy: 50 });

      callUpdateTeamMission(game, tank);

      expect(tank.target).toBe(closePlayer);
      expect(tank.mission).toBe(Mission.ATTACK);
    });

    it('moves toward waypoint when no enemies are in weapon range', () => {
      const game = makeBigMapGame();
      const yak = new Entity(UnitType.V_YAK, House.USSR, 5 * CELL_SIZE, 5 * CELL_SIZE);
      yak.teamMissions = [{ mission: 1, data: 11 }];
      yak.flightAltitude = 24;
      yak.lastAIScan = 0;
      game.entities.push(yak);
      game.entityById.set(yak.id, yak);

      ((game as unknown as { waypoints: Map<number, { cx: number; cy: number }> }).waypoints)
        .set(11, { cx: 50, cy: 50 });

      callUpdateTeamMission(game, yak);

      expect(yak.target).toBeNull();
      expect(yak.mission).toBe(Mission.MOVE);
      expect(yak.moveTarget).not.toBeNull();
    });
  });
});
