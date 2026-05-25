/**
 * @vitest-environment jsdom
 *
 * C++ parity: enemy MRJ radar jamming.
 *
 * Red Alert does not use a scenario-specific radar blackout. BuildingClass::AI
 * marks DOME/SAM buildings as IsJammed when an enemy MRJ is within
 * Rule.RadarJamRadius, then HouseClass::AI promotes that to RadarClass::IsRadarJammed
 * only when the player's radar is active and every player radar facility is jammed.
 */

import { describe, expect, it } from 'vitest';
import { Game } from '../engine';
import { Entity } from '../engine/entity';
import { CELL_SIZE, GAME_TICKS_PER_SEC, House, RESFACTOR, UnitType } from '../engine/types';

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 320 * RESFACTOR;
  canvas.height = 200 * RESFACTOR;
  Object.defineProperty(canvas, 'getContext', {
    value: () => ({ imageSmoothingEnabled: false }),
  });
  return canvas;
}

function dome(overrides: Record<string, unknown> = {}) {
  return {
    type: 'DOME',
    image: 'dome',
    house: House.Spain,
    cx: 20,
    cy: 20,
    hp: 1000,
    maxHp: 1000,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    ...overrides,
  };
}

describe('C++ parity: MRJ radar jamming', () => {
  it('marks a player DOME jammed when an enemy MRJ is within RadarJamRadius', () => {
    const game = new Game(createCanvas());
    const playerDome = dome();
    const mrj = new Entity(UnitType.V_MRJ, House.USSR, 21 * CELL_SIZE, 21 * CELL_SIZE);

    (game as any).tick = GAME_TICKS_PER_SEC;
    (game as any).structures = [playerDome];
    (game as any).entities = [mrj];
    (game as any).updateRadarFacilityJamming();

    expect(playerDome.isJammed).toBe(true);
  });

  it('does not jam a player DOME from an allied MRJ', () => {
    const game = new Game(createCanvas());
    const playerDome = dome();
    const mrj = new Entity(UnitType.V_MRJ, House.Spain, 21 * CELL_SIZE, 21 * CELL_SIZE);

    (game as any).tick = GAME_TICKS_PER_SEC;
    (game as any).structures = [playerDome];
    (game as any).entities = [mrj];
    (game as any).updateRadarFacilityJamming();

    expect(playerDome.isJammed).toBe(false);
  });

  it('sets global radar jam only when active player radar has no unjammed DOME', () => {
    const game = new Game(createCanvas());
    const radar = (game as any).radarVisual;
    radar.doesRadarExist = true;
    radar.isRadarActive = true;
    radar.radarAnimFrame = 22;

    const jammedDome = dome({ isJammed: true });
    const clearDome = dome({ cx: 30, cy: 30, isJammed: false });

    (game as any).structures = [jammedDome];
    (game as any).updatePlayerRadarJamming();
    expect((game as any).radarJammed).toBe(true);

    (game as any).structures = [jammedDome, clearDome];
    (game as any).updatePlayerRadarJamming();
    expect((game as any).radarJammed).toBe(false);
  });

  it('GPS suppresses global radar jamming', () => {
    const game = new Game(createCanvas());
    const radar = (game as any).radarVisual;
    radar.doesRadarExist = true;
    radar.isRadarActive = true;
    radar.radarAnimFrame = 22;

    (game as any).gpsActive = true;
    (game as any).structures = [dome({ isJammed: true })];
    (game as any).updatePlayerRadarJamming();

    expect((game as any).radarJammed).toBe(false);
  });

  it('keeps destroyed building drain until the C++ debris countdown removes it from logic', () => {
    const game = new Game(createCanvas());
    const powerPlant = dome({ type: 'POWR', power: 100, cx: 16, cy: 16 });
    const playerDome = dome({ power: -40 });
    const destroyedTechCenter = dome({
      type: 'PDOX',
      power: -200,
      alive: false,
      hp: 0,
      cx: 24,
      cy: 24,
      debrisCountdown: 8,
      debrisDropped: false,
    });

    (game as any).structures = [powerPlant, playerDome, destroyedTechCenter];

    let power = (game as any)._housePowerGrid(House.Spain);
    expect(power).toEqual({ produced: 100, consumed: 240 });

    (game as any).powerProduced = power.produced;
    (game as any).powerConsumed = power.consumed;
    (game as any).updatePlayerRadarAvailability();
    expect((game as any).radarVisual.isRadarActivating).toBe(false);

    destroyedTechCenter.debrisCountdown = undefined;
    destroyedTechCenter.debrisDropped = true;
    power = (game as any)._housePowerGrid(House.Spain);
    expect(power).toEqual({ produced: 100, consumed: 40 });

    (game as any).powerProduced = power.produced;
    (game as any).powerConsumed = power.consumed;
    (game as any).updatePlayerRadarAvailability();
    expect((game as any).radarVisual.isRadarActivating).toBe(true);
  });
});
