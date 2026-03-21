import { describe, it, expect } from 'vitest';
import { OracleStrategy } from '../oracle/OracleStrategy.js';
import type { RAGameState, RAEntity, RAStructure } from '../oracle/WasmAdapter.js';

function makeEntity(
  id: number,
  t: string,
  house: string,
  cx: number,
  cy: number,
  ally = true,
): RAEntity {
  return { id, t, house, cx, cy, hp: 256, mhp: 256, m: 0, ally };
}

function makeStructure(
  id: number,
  t: string,
  house: string,
  cx: number,
  cy: number,
  ally = true,
): RAStructure {
  return { id, t, house, cx, cy, hp: 256, mhp: 256, m: 0, ally, repairing: false };
}

function makeState(overrides: Partial<RAGameState> = {}): RAGameState {
  return {
    tick: 100,
    credits: 5000,
    playerHouse: 'Greece',
    alliedHouses: ['Greece'],
    globals: [1, 10],
    missionTimer: 0,
    missionTimerActive: false,
    civEvacuated: false,
    winPending: false,
    losePending: false,
    power: { produced: 300, consumed: 120 },
    units: [],
    enemies: [],
    structures: [],
    production: [],
    buildable: { structures: [], units: [], infantry: [], vessels: [] },
    ...overrides,
  };
}

describe('SCG11EA coast-chain priority', () => {
  it('forces coast reopening before naval phase starts', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const alliedStructures = [
      makeStructure(100, 'FACT', 'Greece', 24, 96),
      makeStructure(101, 'POWR', 'Greece', 26, 94),
      makeStructure(102, 'PROC', 'Greece', 29, 86),
      makeStructure(103, 'WEAP', 'Greece', 23, 100),
    ];
    const state = makeState({
      structures: alliedStructures,
      enemies: [
        makeEntity(200, 'SS', 'USSR', 70, 90, false),
        makeEntity(201, 'SS', 'USSR', 72, 92, false),
      ],
    });

    expect((strategy as any).scg11eaMustReopenCoast(state, alliedStructures, state.units)).toBe(true);
  });

  it('drops coast-chain priority once destroyers are active and subs are in cleanup range', () => {
    const strategy = new OracleStrategy('SCG11EA');
    (strategy as any).scg11eaNavalUnlocked = true;
    const alliedStructures = [
      makeStructure(100, 'FACT', 'Greece', 24, 96),
      makeStructure(101, 'POWR', 'Greece', 26, 94),
      makeStructure(102, 'PROC', 'Greece', 29, 86),
      makeStructure(103, 'WEAP', 'Greece', 23, 100),
    ];
    const units = [
      makeEntity(1, 'DD', 'Greece', 72, 90),
      makeEntity(2, 'DD', 'Greece', 74, 90),
    ];
    const state = makeState({
      units,
      structures: alliedStructures,
      enemies: [
        makeEntity(200, 'SS', 'USSR', 70, 90, false),
        makeEntity(201, 'SS', 'USSR', 72, 92, false),
        makeEntity(202, 'SS', 'USSR', 74, 94, false),
      ],
    });

    expect((strategy as any).scg11eaMustReopenCoast(state, alliedStructures, units)).toBe(false);
  });

  it('keeps coast-chain priority when the fleet is gone even late in the mission', () => {
    const strategy = new OracleStrategy('SCG11EA');
    (strategy as any).scg11eaNavalUnlocked = true;
    const alliedStructures = [
      makeStructure(100, 'FACT', 'Greece', 24, 96),
      makeStructure(101, 'POWR', 'Greece', 26, 94),
      makeStructure(102, 'PROC', 'Greece', 29, 86),
      makeStructure(103, 'WEAP', 'Greece', 23, 100),
    ];
    const state = makeState({
      structures: alliedStructures,
      enemies: [
        makeEntity(200, 'SS', 'USSR', 70, 90, false),
        makeEntity(201, 'SS', 'USSR', 72, 92, false),
        makeEntity(202, 'SS', 'USSR', 74, 94, false),
      ],
    });

    expect((strategy as any).scg11eaMustReopenCoast(state, alliedStructures, state.units)).toBe(true);
  });
});
