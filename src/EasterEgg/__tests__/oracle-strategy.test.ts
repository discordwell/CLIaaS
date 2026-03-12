import { describe, expect, it } from 'vitest';
import { OracleStrategy } from '../oracle/OracleStrategy.js';
import type { RAGameState, RAEntity, RAStructure } from '../oracle/WasmAdapter.js';

function unit(overrides: Partial<RAEntity> = {}): RAEntity {
  return {
    id: 1,
    t: 'E1',
    house: 'Greece',
    cx: 0,
    cy: 0,
    hp: 50,
    mhp: 50,
    m: 5,
    ally: true,
    ...overrides,
  };
}

function structure(overrides: Partial<RAStructure> = {}): RAStructure {
  return {
    id: 100,
    t: 'POWR',
    house: 'USSR',
    cx: 0,
    cy: 0,
    hp: 200,
    mhp: 200,
    m: 0,
    ally: false,
    repairing: false,
    ...overrides,
  };
}

function state(overrides: Partial<RAGameState> = {}): RAGameState {
  return {
    tick: 210,
    credits: 0,
    playerHouse: 'Greece',
    alliedHouses: ['Greece', 'England', 'GoodGuy'],
    globals: [],
    power: { produced: 0, consumed: 0 },
    units: [],
    enemies: [],
    structures: [],
    production: [],
    ...overrides,
  };
}

describe('OracleStrategy mission logic', () => {
  it('prioritizes the prison guards and stages the evac transport on SCG01EA', () => {
    const strategy = new OracleStrategy('SCG01EA');
    const tanya = unit({ id: 7, t: 'E7', house: 'GoodGuy', cx: 63, cy: 48, hp: 100, mhp: 100 });
    const transport = unit({ id: 8, t: 'TRAN', house: 'GoodGuy', cx: 63, cy: 47, hp: 90, mhp: 90, m: 4 });
    const britishCivilian = unit({ id: 9, t: 'C7', house: 'England', cx: 76, cy: 48, hp: 25, mhp: 25 });
    const greekJeep = unit({ id: 10, t: 'JEEP', house: 'Greece', cx: 63, cy: 50, hp: 150, mhp: 150 });

    const decision = strategy.decide(state({
      units: [greekJeep, tanya, transport, britishCivilian],
      enemies: [
        unit({ id: 20, t: 'E1', house: 'USSR', ally: false, cx: 61, cy: 63 }),
      ],
      structures: [
        structure({ id: 30, t: 'POWR', house: 'USSR', ally: false, cx: 61, cy: 57 }),
      ],
    }));

    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'attack', ids: [7], target: 20 }),
        expect.objectContaining({ cmd: 'move', ids: [8], cx: 57, cy: 74 }),
      ]),
    );

    const commandedIds = decision.commands.flatMap((command) => {
      const ids = command.ids;
      return Array.isArray(ids) ? ids.map(Number) : [];
    });
    expect(commandedIds).not.toContain(9);
  });

  it('switches to evacuation orders once the rescue trigger is active', () => {
    const strategy = new OracleStrategy('SCG01EA');
    const tanya = unit({ id: 7, t: 'E7', house: 'GoodGuy', cx: 62, cy: 61, hp: 90, mhp: 100 });
    const einstein = unit({ id: 11, t: 'EINSTEIN', house: 'GoodGuy', cx: 62, cy: 62, hp: 25, mhp: 25 });
    const jeep = unit({ id: 10, t: 'JEEP', house: 'Greece', cx: 63, cy: 58, hp: 150, mhp: 150 });

    const decision = strategy.decide(state({
      globals: [1],
      units: [jeep, tanya, einstein],
      enemies: [],
    }));

    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'move', ids: [7, 11], cx: 57, cy: 74 }),
        expect.objectContaining({ cmd: 'attack_move', ids: [10], cx: 60, cy: 68 }),
      ]),
    );
  });
});
