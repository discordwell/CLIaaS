import { beforeEach, describe, expect, it } from 'vitest';

import { Entity, resetEntityIds, setPlayerHouses } from '../engine/entity';
import { GameMap } from '../engine/map';
import { updateHunt, type MissionAIContext } from '../engine/missionAI';
import { CELL_SIZE, House, LEPTON_SIZE, Mission, UnitType } from '../engine/types';

function makeEntity(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

describe('Mission_Hunt full-map target tie order', () => {
  beforeEach(() => {
    resetEntityIds();
    setPlayerHouses(new Set([House.Greece]));
  });

  it('breaks equal threat scores by C++ ground-layer Sort_Y order', () => {
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 62, 55);
    scanner.mission = Mission.HUNT;
    scanner.leptonX = 62 * LEPTON_SIZE + 192;
    scanner.leptonY = 55 * LEPTON_SIZE + 192;
    scanner.syncPosFromLeptons();

    const middleJeep = makeEntity(UnitType.V_JEEP, House.Greece, 63, 50);
    const leftJeep = makeEntity(UnitType.V_JEEP, House.Greece, 62, 50);
    const rightJeep = makeEntity(UnitType.V_JEEP, House.Greece, 64, 50);

    const ctx = {
      entities: [scanner, middleJeep, leftJeep, rightJeep],
      structures: [],
      map: new GameMap(),
      playerHouse: House.Greece,
      isAllied: (a: House, b: House) => a === b,
      entitiesAllied: (a: Entity, b: Entity) => a.house === b.house,
      threatScore: () => 100,
      isRevealedToHouse: () => true,
    } as unknown as MissionAIContext;

    updateHunt(ctx, scanner);

    expect(scanner.target).toBe(leftJeep);
  });
});
