/**
 * @vitest-environment jsdom
 *
 * C++ behavioral parity for structure TarCom while moving.
 *
 * FootClass::Mission_Move only calls Target_Something_Nearby when TarCom is
 * illegal. A live building target is legal TarCom even when it is temporarily
 * out of range, so Mission_Move must not range-validate and clear it. Later,
 * UnitClass::Rotation_AI still points a turret at any legal TarCom, including
 * building targets.
 *
 * C++ refs:
 *   foot.cpp:530-532      — Mission_Move scans only when !Target_Legal(TarCom)
 *   unit.cpp:506-515      — Rotation_AI uses Direction(TarCom)
 *   abstract.h:116        — Direction(TARGET) uses As_Coord(target)
 *   target.cpp:511        — As_Coord(building target) uses Target_Coord()
 *   building.cpp:5225     — BuildingClass::Target_Coord
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, dir256ToFacing8, dir256ToFacing32, resetEntityIds } from '../engine/entity';
import { type MapStructure, STRUCTURE_MAX_HP, structureTargetLeptons } from '../engine/scenario';
import {
  CELL_SIZE, cellTargetToLepton, directionToLeptons256, House, LEPTON_SIZE, Mission,
  pixelToLepton, RESFACTOR, UnitType,
} from '../engine/types';
import { ScenarioRandom } from '../engine/random';

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
  game.map.setBounds(0, 0, 128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      game.map.setTerrain(x, y, 0);
    }
  }
  return game;
}

function placeVehicle(game: Game, type: UnitType, house: House, cx: number, cy: number): Entity {
  const e = new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
  e.mission = Mission.GUARD;
  e.missionTimer = 42;
  game.entities.push(e);
  game.entityById.set(e.id, e);
  game.map.setOccupancy(cx, cy, e.id);
  return e;
}

function makeStructure(type: string, house: House, cx: number, cy: number): MapStructure {
  const maxHp = STRUCTURE_MAX_HP[type] ?? 256;
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: maxHp,
    maxHp,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    missionTimer: 0,
  } as MapStructure;
}

function dispatchMission(game: Game, entity: Entity, missionTimerFired = true): void {
  (game as unknown as { dispatchMission(entity: Entity, missionTimerFired: boolean): void })
    .dispatchMission(entity, missionTimerFired);
}

function tickEntity(game: Game, entity: Entity): void {
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
  ScenarioRandom.seed = 0x12345678;
  ScenarioRandom.callCount = 0;
});

describe('Mission_Move structure TarCom parity', () => {
  it('preserves a live structure TarCom instead of range-validating it', () => {
    const game = createGame();
    const jeep = placeVehicle(game, UnitType.V_JEEP, House.USSR, 10, 10);
    const target = makeStructure('APWR', House.Greece, 80, 80);
    game.structures.push(target);

    jeep.mission = Mission.MOVE;
    jeep.missionTimer = 0;
    jeep.target = null;
    jeep.targetStructure = target;
    jeep.moveTarget = {
      lx: pixelToLepton(20 * CELL_SIZE + CELL_SIZE / 2),
      ly: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2),
    };

    dispatchMission(game, jeep, true);

    expect(jeep.target).toBeNull();
    expect(jeep.targetStructure).toBe(target);
  });

  it('rotates a land-unit turret toward a structure TarCom', () => {
    const game = createGame();
    const jeep = placeVehicle(game, UnitType.V_JEEP, House.USSR, 10, 10);
    const barrel = makeStructure('BARL', House.Greece, 20, 10);
    game.structures.push(barrel);

    jeep.mission = Mission.GUARD;
    jeep.missionTimer = 42;
    jeep.attackCooldown = 20;
    jeep.target = null;
    jeep.targetStructure = barrel;
    jeep.turretFacing256 = 0;
    jeep.turretFacing32 = 0;
    jeep.desiredTurretFacing256 = 0;
    jeep.desiredTurretFacing = 0;

    const target = structureTargetLeptons(barrel);
    const expectedDir = directionToLeptons256(
      jeep.leptonX, jeep.leptonY,
      target.lx, target.ly,
    );

    tickEntity(game, jeep);

    expect(jeep.desiredTurretFacing256).toBe(expectedDir);
    expect(jeep.turretFacing256).not.toBe(0);
  });

  it('keeps a land-unit turret aimed at a cell TarCom instead of idling to body facing', () => {
    const game = createGame();
    const tank = placeVehicle(game, UnitType.V_2TNK, House.Greece, 75, 33);
    const target = cellTargetToLepton(75, 34);
    const targetDir = directionToLeptons256(
      tank.leptonX, tank.leptonY,
      target.lx, target.ly,
    );

    tank.mission = Mission.STICKY;
    tank.missionTimer = 8;
    tank.target = null;
    tank.targetStructure = null;
    tank.forceFirePos = {
      x: target.lx * CELL_SIZE / LEPTON_SIZE,
      y: target.ly * CELL_SIZE / LEPTON_SIZE,
    };
    tank.bodyFacing256 = 160;
    tank.facing = 5;
    tank.desiredFacing = 5;
    tank.turretFacing256 = targetDir;
    tank.turretFacing = dir256ToFacing8(targetDir);
    tank.turretFacing32 = dir256ToFacing32(targetDir);
    tank.desiredTurretFacing256 = targetDir;
    tank.desiredTurretFacing = dir256ToFacing8(targetDir);

    tickEntity(game, tank);

    expect(tank.desiredTurretFacing256).toBe(targetDir);
  });
});
