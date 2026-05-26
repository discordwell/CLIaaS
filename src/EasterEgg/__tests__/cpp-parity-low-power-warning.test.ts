/**
 * @vitest-environment jsdom
 *
 * C++ parity: HouseClass::AI low-power warning.
 *
 * Source reference:
 *   RA/house.cpp:1130-1148 — SpeakPowerDelay, STRUCTF_CONST gate,
 *   VOX_LOW_POWER, and TXT_POWER_AAGUN/TXT_POWER_TESLA map messages.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine';
import {
  STRUCTURE_IMAGES,
  STRUCTURE_MAX_HP,
  STRUCTURE_WEAPONS,
  type MapStructure,
} from '../engine/scenario';
import { CPP_SPEAK_DELAY_TICKS } from '../engine/ai';
import { House, RESFACTOR } from '../engine/types';

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
  Object.defineProperty(canvas, 'getContext', {
    value: () => ({ imageSmoothingEnabled: false }),
  });
  return canvas;
}

function makeStructure(
  type: string,
  house: House,
  overrides: Partial<MapStructure> = {},
): MapStructure {
  const maxHp = STRUCTURE_MAX_HP[type] ?? 256;
  return {
    type,
    house,
    cx: 10,
    cy: 10,
    image: STRUCTURE_IMAGES[type] ?? type.toLowerCase(),
    hp: maxHp,
    maxHp,
    alive: true,
    rubble: false,
    weapon: STRUCTURE_WEAPONS[type],
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    ...overrides,
  };
}

function createGame(structures: MapStructure[]): Game {
  const game = new Game(createCanvas());
  game.playerHouse = House.USSR;
  game.structures = structures;
  (game as any).tick = 1;
  return game;
}

describe('HouseClass::AI low-power warning parity', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('Audio', FakeAudio);
  });

  it('announces Tesla low power after the initial SpeakPowerDelay countdown', () => {
    const game = createGame([
      makeStructure('FACT', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('TSLA', House.USSR),
    ]);
    const play = vi.spyOn((game as any).audio, 'play').mockImplementation(() => {});

    (game as any).tickPlayerLowPowerWarning();
    expect((game as any).evaMessages).toHaveLength(0);

    (game as any).tick = 2;
    (game as any).tickPlayerLowPowerWarning();

    expect((game as any).evaMessages.map((m: { text: string }) => m.text)).toEqual([
      'Low Power: Tesla Coils offline',
    ]);
    expect(play).toHaveBeenCalledWith('eva_low_power');
    const state = (game as any).houseRuntimeStates.get(House.USSR);
    expect(state.speakPowerTimer).toBe(CPP_SPEAK_DELAY_TICKS - 1);
  });

  it('requires an active Construction Yard and keeps the timer expired until one exists', () => {
    const game = createGame([
      makeStructure('POWR', House.USSR),
      makeStructure('TSLA', House.USSR),
    ]);
    vi.spyOn((game as any).audio, 'play').mockImplementation(() => {});

    (game as any).tickPlayerLowPowerWarning();
    (game as any).tick = 2;
    (game as any).tickPlayerLowPowerWarning();

    expect((game as any).evaMessages).toHaveLength(0);
    expect((game as any).houseRuntimeStates.get(House.USSR).speakPowerTimer).toBe(0);

    game.structures.push(makeStructure('FACT', House.USSR));
    (game as any).tick = 3;
    (game as any).tickPlayerLowPowerWarning();

    expect((game as any).evaMessages.map((m: { text: string }) => m.text)).toEqual([
      'Low Power: Tesla Coils offline',
    ]);
  });

  it('uses the AA-gun-specific message when no Tesla Coil is active', () => {
    const game = createGame([
      makeStructure('FACT', House.USSR),
      makeStructure('AGUN', House.USSR),
    ]);
    vi.spyOn((game as any).audio, 'play').mockImplementation(() => {});

    (game as any).tickPlayerLowPowerWarning();
    (game as any).tick = 2;
    (game as any).tickPlayerLowPowerWarning();

    expect((game as any).evaMessages.map((m: { text: string }) => m.text)).toEqual([
      'Low Power: AA Guns offline',
    ]);
  });
});
