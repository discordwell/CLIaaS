/**
 * @vitest-environment jsdom
 *
 * C++ parity: FootClass::Basic_Path redirects blocked NavCom through
 * MapClass::Nearby_Location using the unit's movement zone. Wall-destroying
 * units use MZONE_DESTROYER, so wall overlay cells remain valid nearby
 * candidates for the frame-modulo selection.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity } from '../engine/entity';
import { Terrain } from '../engine/map';
import { CELL_SIZE, House, LEPTON_SIZE, Mission, RESFACTOR, UnitType, type CellPos } from '../engine/types';
import type { MapStructure } from '../engine/scenario';

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
  game.map.setBounds(30, 38, 16, 10);
  game.map.initDefault();
  return game;
}

function setCell(game: Game, cx: number, cy: number, terrain: Terrain, wallType = ''): void {
  game.map.setTerrain(cx, cy, terrain);
  if (wallType) game.map.setWallType(cx, cy, wallType);
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

describe('C++ parity: Basic_Path Nearby_Location movement zone', () => {
  it('wall-destroyer Basic_Path includes wall overlay cells in the frame-modulo nearby scan', () => {
    const game = createGame();
    const v2 = new Entity(
      UnitType.V_V2RL,
      House.USSR,
      36 * CELL_SIZE + CELL_SIZE / 2,
      39 * CELL_SIZE + CELL_SIZE / 2,
    );
    v2.moveTarget = {
      lx: 38 * LEPTON_SIZE + LEPTON_SIZE / 2,
      ly: 42 * LEPTON_SIZE + LEPTON_SIZE / 2,
    };

    // C++ SCU12EA Frame 172 diagnostic around blocked NavCom (38,42):
    // order 0 (37,41) occupied; 1 (37,43) BRIK clear for MZONE_DESTROYER;
    // 2 (38,41) clear; 3 (38,43) BRIK clear; 4 (39,41) clear;
    // 5/7 rock blocked; 6 (37,42) clear. Count=5, 172 % 5 = 2,
    // so Basic_Path redirects to the third clear candidate: (38,43).
    setCell(game, 38, 42, Terrain.WALL);
    setCell(game, 37, 43, Terrain.WALL, 'BRIK');
    setCell(game, 38, 43, Terrain.WALL, 'BRIK');
    setCell(game, 39, 43, Terrain.ROCK);
    setCell(game, 39, 42, Terrain.ROCK);
    game.map.setOccupancy(37, 41, 999);

    (game as unknown as { tick: number }).tick = 173; // TS tick maps to C++ Frame tick-1.

    const resolved = (game as unknown as {
      resolveBasicPathGoal(entity: Entity, goal: CellPos): CellPos;
    }).resolveBasicPathGoal(v2, { cx: 38, cy: 42 });

    expect(resolved).toEqual({ cx: 38, cy: 43 });
  });

  it('DriveClass::Start_Of_Move overrides MOVE to ATTACK when the next track cell is destroyable', () => {
    const game = createGame();
    const v2 = new Entity(
      UnitType.V_V2RL,
      House.USSR,
      37 * CELL_SIZE + CELL_SIZE / 2,
      41 * CELL_SIZE + CELL_SIZE / 2,
    );
    v2.mission = Mission.MOVE;
    v2.moveTarget = {
      lx: 38 * LEPTON_SIZE + LEPTON_SIZE / 2,
      ly: 42 * LEPTON_SIZE + LEPTON_SIZE / 2,
    };
    v2.path = [{ cx: 38, cy: 42 }];
    v2.pathIndex = 0;
    v2.pathDelay = 6;
    v2.bodyFacing256 = 96; // SE, matching the first Path[0] facing.
    v2.desiredFacing256 = 96;

    const gun = {
      type: 'GUN',
      image: 'gun',
      house: House.Greece,
      cx: 38,
      cy: 42,
      hp: 400,
      maxHp: 400,
      alive: true,
      rubble: false,
      attackCooldown: 0,
      ammo: -1,
      maxAmmo: -1,
      missionTimer: 0,
    } as MapStructure;

    game.entities.push(v2);
    game.entityById.set(v2.id, v2);
    game.structures.push(gun);
    game.map.setTerrain(38, 42, Terrain.WALL);

    // C++ drive.cpp:1143-1151: MOVE_DESTROYABLE calls
    // Override_Mission(MISSION_ATTACK, Cell_Object()->As_Target(), TARGET_NONE).
    (game as unknown as { runDriveClassAI(entity: Entity): void }).runDriveClassAI(v2);

    expect(v2.missionQueue).toBe(Mission.ATTACK);
    expect(v2.targetStructure).toBe(gun);
    expect(v2.moveTarget).toBeNull();
  });

  it('one-shot structure attacks keep Mission_Attack and TarCom after ammo reaches zero', () => {
    const game = createGame();
    const v2 = new Entity(
      UnitType.V_V2RL,
      House.USSR,
      37 * CELL_SIZE + CELL_SIZE / 2,
      41 * CELL_SIZE + CELL_SIZE / 2,
    );
    v2.mission = Mission.ATTACK;
    v2.attackCooldown = 0;
    v2.ammo = 1;
    v2.maxAmmo = 1;
    v2.bodyFacing256 = 96;
    v2.desiredFacing256 = 96;

    const gun = {
      type: 'GUN',
      image: 'gun',
      house: House.Greece,
      cx: 38,
      cy: 42,
      hp: 400,
      maxHp: 400,
      alive: true,
      rubble: false,
      attackCooldown: 0,
      ammo: -1,
      maxAmmo: -1,
      missionTimer: 0,
    } as MapStructure;
    v2.targetStructure = gun;

    game.entities.push(v2);
    game.entityById.set(v2.id, v2);
    game.structures.push(gun);

    // C++ TechnoClass::Can_Fire returns FIRE_AMMO on later ticks, but
    // FootClass::Mission_Attack keeps TarCom legal and continues returning
    // Normal_Delay + Random_Pick(0,2).
    (game as unknown as { updateAttackStructure(entity: Entity, s: MapStructure): void })
      .updateAttackStructure(v2, gun);

    expect(v2.ammo).toBe(0);
    expect(v2.mission).toBe(Mission.ATTACK);
    expect(v2.targetStructure).toBe(gun);
  });
});
