/**
 * @vitest-environment jsdom
 *
 * C++ parity: TechnoClass::Fire_At reveals hidden shooters.
 *
 * techno.cpp:3263-3265:
 *   if ((!IsOwnedByPlayer && !IsDiscoveredByPlayer) || ...)
 *     Map.Sight_From(Coord_Cell(Center_Coord()), 2, PlayerPtr, false);
 *
 * display.cpp:1496-1499 then calls tech->Revealed(PlayerPtr) for objects in
 * those mapped cells, setting IsDiscoveredByPlayer immediately.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import { CELL_SIZE, House, RESFACTOR, UnitType } from '../engine/types';
import { STRUCTURE_MAX_HP, type MapStructure } from '../engine/scenario';

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

function atCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
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
  } as MapStructure;
}

describe('TechnoClass::Fire_At hidden-shooter reveal', () => {
  beforeAll(() => {
    vi.stubGlobal('Audio', FakeAudio);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
      { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
    ));
  });

  beforeEach(() => resetEntityIds());

  it('reveals a non-PlayerPtr shooter and nearby allied units to PlayerPtr', () => {
    const game = new Game(createCanvas());
    game.playerHouse = House.Greece;
    game.map.setBounds(0, 0, 128, 128);

    const shooter = atCell(UnitType.V_JEEP, House.England, 27, 58);
    const nearby = atCell(UnitType.I_E1, House.England, 26, 59);
    const edge = atCell(UnitType.I_E1, House.England, 27, 57);
    const outside = atCell(UnitType.I_E1, House.England, 24, 58);
    game.entities.push(shooter, nearby, edge, outside);

    (game as unknown as { revealShooterFromFire(e: Entity): void }).revealShooterFromFire(shooter);

    const discovered = (game as unknown as { discoveredEntityIds: Set<number> }).discoveredEntityIds;
    expect(discovered.has(shooter.id)).toBe(true);
    expect(discovered.has(nearby.id)).toBe(true);
    expect(discovered.has(edge.id)).toBe(true);
    expect(discovered.has(outside.id)).toBe(false);
    expect(game.map.getVisibility(27, 58)).toBe(2);
    expect(game.map.getVisibility(26, 59)).toBe(2);
  });

  it('reveals enemy structures when any footprint cell is inside the Fire_At sight radius', () => {
    const game = new Game(createCanvas());
    game.playerHouse = House.Greece;
    game.map.setBounds(0, 0, 128, 128);

    const shooter = atCell(UnitType.V_JEEP, House.England, 10, 10);
    const weaponFactory = makeStructure('WEAP', House.England, 12, 9);
    game.entities.push(shooter);
    game.structures.push(weaponFactory);

    (game as unknown as { revealShooterFromFire(e: Entity): void }).revealShooterFromFire(shooter);

    const discoveredStructures = (game as unknown as { discoveredStructureIds: Set<number> }).discoveredStructureIds;
    expect(discoveredStructures.has(0)).toBe(true);
  });
});
