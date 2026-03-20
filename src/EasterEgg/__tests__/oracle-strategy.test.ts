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
        expect.objectContaining({ cmd: 'attack_move', ids: [7], cx: 61, cy: 63 }),
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
    const tanya = unit({ id: 7, t: 'E7', house: 'GoodGuy', cx: 56, cy: 52, hp: 90, mhp: 100 });
    const einstein = unit({ id: 11, t: 'EINSTEIN', house: 'GoodGuy', cx: 53, cy: 49, hp: 25, mhp: 25 });
    const transport = unit({ id: 12, t: 'TRAN', house: 'GoodGuy', cx: 53, cy: 49, hp: 90, mhp: 90, m: 5 });
    const jeep = unit({ id: 10, t: 'JEEP', house: 'Greece', cx: 63, cy: 58, hp: 150, mhp: 150 });

    const decision = strategy.decide(state({
      globals: [1],
      units: [jeep, tanya, einstein, transport],
      enemies: [],
    }));

    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'enter', ids: [11], target: 12 }),
        expect.objectContaining({ cmd: 'attack_move', ids: [10], cx: 56, cy: 52 }),
      ]),
    );
  });

  it('keeps Einstein staged at the flare until the evac transport is close enough', () => {
    const strategy = new OracleStrategy('SCG01EA');
    const einstein = unit({ id: 11, t: 'EINSTEIN', house: 'GoodGuy', cx: 61, cy: 61, hp: 25, mhp: 25 });
    const transport = unit({ id: 12, t: 'TRAN', house: 'GoodGuy', cx: 78, cy: 80, hp: 90, mhp: 90, m: 4 });

    const decision = strategy.decide(state({
      globals: [1],
      units: [einstein, transport],
      enemies: [],
    }));

    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'move', ids: [11], cx: 53, cy: 49 }),
        expect.objectContaining({ cmd: 'move', ids: [12], cx: 53, cy: 49 }),
      ]),
    );
    expect(decision.commands).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'enter', ids: [11], target: 12 }),
      ]),
    );
  });

  it('prefers the scripted GoodGuy evac helicopter over the player transport once rescue starts', () => {
    const strategy = new OracleStrategy('SCG01EA');
    const einstein = unit({ id: 11, t: 'EINSTEIN', house: 'Greece', cx: 63, cy: 60, hp: 25, mhp: 25 });
    const greekTransport = unit({ id: 12, t: 'TRAN', house: 'Greece', cx: 62, cy: 48, hp: 90, mhp: 90, m: 4 });
    const scriptedHeli = unit({ id: 13, t: 'TRAN', house: 'GoodGuy', cx: 66, cy: 80, hp: 90, mhp: 90, m: 4 });

    const decision = strategy.decide(state({
      globals: [1],
      units: [einstein, greekTransport, scriptedHeli],
      enemies: [],
    }));

    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'move', ids: [13], cx: 53, cy: 49 }),
        expect.objectContaining({ cmd: 'move', ids: [11], cx: 53, cy: 49 }),
      ]),
    );
    expect(decision.commands).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'move', ids: [12], cx: 56, cy: 52 }),
      ]),
    );
  });

  it('switches the escort focus from the southern approach to the prison once Tanya is committed', () => {
    const strategy = new OracleStrategy('SCG01EA');
    const tanya = unit({ id: 7, t: 'E7', house: 'Greece', cx: 63, cy: 52, hp: 100, mhp: 100 });
    const jeep = unit({ id: 10, t: 'JEEP', house: 'Greece', cx: 62, cy: 54, hp: 150, mhp: 150 });

    const decision = strategy.decide(state({
      units: [jeep, tanya],
      enemies: [
        unit({ id: 20, t: 'E1', house: 'USSR', ally: false, cx: 63, cy: 59 }),
        unit({ id: 21, t: 'E1', house: 'USSR', ally: false, cx: 61, cy: 63 }),
      ],
    }));

    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'attack_move', ids: [7], cx: 61, cy: 63 }),
        expect.objectContaining({ cmd: 'attack', ids: [10], target: 21 }),
      ]),
    );
  });

  it('prioritizes route threats closest to the evac point during the rescue phase', () => {
    const strategy = new OracleStrategy('SCG01EA');
    const jeep = unit({ id: 10, t: 'JEEP', house: 'Greece', cx: 60, cy: 56, hp: 150, mhp: 150 });
    const einstein = unit({ id: 11, t: 'EINSTEIN', house: 'Greece', cx: 62, cy: 60, hp: 25, mhp: 25 });
    const transport = unit({ id: 12, t: 'TRAN', house: 'GoodGuy', cx: 64, cy: 62, hp: 90, mhp: 90, m: 2 });

    const decision = strategy.decide(state({
      globals: [1],
      units: [jeep, einstein, transport],
      enemies: [
        unit({ id: 20, t: 'E1', house: 'USSR', ally: false, cx: 62, cy: 61 }),
        unit({ id: 21, t: 'E1', house: 'USSR', ally: false, cx: 56, cy: 60 }),
      ],
    }));

    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'attack', ids: [10], target: 21 }),
      ]),
    );
  });

  it('detects SCG01EA victory from civilian evacuation state', () => {
    const strategy = new OracleStrategy('SCG01EA');
    expect(strategy.checkResult(state({ civEvacuated: true }))).toBe('victory');
  });

  it('stages an advancing front on SCG02EA before the convoy arrives', () => {
    const strategy = new OracleStrategy('SCG02EA');
    const jeep = unit({ id: 10, t: 'JEEP', house: 'Greece', cx: 90, cy: 43, hp: 150, mhp: 150 });
    const rifle = unit({ id: 11, t: 'E1', house: 'Greece', cx: 91, cy: 43, hp: 50, mhp: 50 });

    const decision = strategy.decide(state({
      units: [jeep, rifle],
      enemies: [
        unit({ id: 20, t: 'E1', house: 'USSR', ally: false, cx: 74, cy: 61 }),
      ],
      structures: [
        structure({ id: 30, t: 'WEAP', house: 'USSR', ally: false, cx: 61, cy: 66 }),
        structure({ id: 31, t: 'POWR', house: 'USSR', ally: false, cx: 57, cy: 62 }),
      ],
    }));

    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'attack_move', ids: [10, 11], cx: 80, cy: 56 }),
      ]),
    );
  });

  it('switches from staging to assault once the SCG02EA front is formed', () => {
    const strategy = new OracleStrategy('SCG02EA');
    const jeep = unit({ id: 10, t: 'JEEP', house: 'Greece', cx: 80, cy: 56, hp: 150, mhp: 150 });
    const rifle = unit({ id: 11, t: 'E1', house: 'Greece', cx: 79, cy: 56, hp: 50, mhp: 50 });

    const decision = strategy.decide(state({
      units: [jeep, rifle],
      enemies: [
        unit({ id: 20, t: 'E1', house: 'USSR', ally: false, cx: 74, cy: 61 }),
      ],
      structures: [
        structure({ id: 30, t: 'WEAP', house: 'USSR', ally: false, cx: 61, cy: 66 }),
      ],
    }));

    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'attack_move', ids: [10, 11], cx: 74, cy: 61 }),
      ]),
    );
  });

  it('switches to convoy escort orders on SCG02EA once trucks spawn', () => {
    const strategy = new OracleStrategy('SCG02EA');
    const jeep = unit({ id: 10, t: 'JEEP', house: 'Greece', cx: 70, cy: 60, hp: 150, mhp: 150 });
    const truck = unit({ id: 21, t: 'TRUK', house: 'England', cx: 49, cy: 76, hp: 110, mhp: 110, m: 2 });

    const decision = strategy.decide(state({
      units: [jeep, truck],
      enemies: [
        unit({ id: 20, t: 'E2', house: 'USSR', ally: false, cx: 52, cy: 78 }),
      ],
    }));

    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'move', ids: [10], cx: 49, cy: 76 }),
      ]),
    );
  });

  it('treats pending mission end flags as authoritative', () => {
    const strategy = new OracleStrategy('SCG02EA');
    expect(strategy.checkResult(state({ winPending: true }))).toBe('victory');
    expect(strategy.checkResult(state({ losePending: true }))).toBe('defeat');
  });
});

describe('SCG11EA naval strategy', () => {
  // SCG11EA base state: island base with 48 structures, starting army, 14800 credits
  function scg11eaState(overrides: Partial<RAGameState> = {}): RAGameState {
    return state({
      tick: 500,
      credits: 14800,
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
      ],
      units: [
        unit({ id: 1, t: '3TNK', house: 'Greece', cx: 32, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 2, t: '3TNK', house: 'Greece', cx: 34, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 3, t: '3TNK', house: 'Greece', cx: 36, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 4, t: '2TNK', house: 'Greece', cx: 32, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 5, t: '2TNK', house: 'Greece', cx: 34, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 6, t: 'ARTY', house: 'Greece', cx: 30, cy: 82, hp: 75, mhp: 75 }),
        unit({ id: 7, t: 'ARTY', house: 'Greece', cx: 32, cy: 82, hp: 75, mhp: 75 }),
      ],
      enemies: [
        unit({ id: 50, t: 'SS', ally: false, house: 'USSR', cx: 70, cy: 40, hp: 300, mhp: 300 }),
        unit({ id: 51, t: 'SS', ally: false, house: 'USSR', cx: 70, cy: 60, hp: 300, mhp: 300 }),
        unit({ id: 52, t: 'SS', ally: false, house: 'USSR', cx: 70, cy: 80, hp: 300, mhp: 300 }),
      ],
      ...overrides,
    });
  }

  it('builds PROC before WEAP in the SCG11EA build order', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      buildable: {
        structures: ['POWR', 'PROC', 'WEAP'],
        units: ['3TNK', '2TNK', '1TNK', 'HARV'],
        infantry: ['E1', 'E3'],
        vessels: ['DD'],
      },
    });

    const decision = strategy.decide(s);

    // Should produce PROC (refinery), not WEAP — build order prioritizes economy
    const produceCommands = decision.commands.filter(
      (c) => c.cmd === 'produce' && c.rtti === 6, // RTTI_BUILDINGTYPE
    );
    // First building should be PROC (type_id 12) since we already have POWR
    expect(produceCommands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 6, type_id: 12 }),
      ]),
    );
    // Should NOT produce WEAP (type_id 2)
    expect(produceCommands).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type_id: 2 }),
      ]),
    );
  });

  it('keeps producing tanks on SCG11EA until the defensive floor is met', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
        structure({ id: 103, t: 'PROC', ally: true, house: 'Greece', cx: 24, cy: 80 }),
        structure({ id: 104, t: 'WEAP', ally: true, house: 'Greece', cx: 32, cy: 76 }),
      ],
      buildable: {
        structures: ['POWR', 'SYRD'],
        units: ['3TNK', '2TNK', '1TNK', 'HARV'],
        infantry: ['E1', 'E3'],
        vessels: ['DD'],
      },
    });

    const decision = strategy.decide(s);

    const unitProduceCommands = decision.commands.filter(
      (c) => c.cmd === 'produce' && c.rtti === 29,
    );
    expect(unitProduceCommands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 29 }),
      ]),
    );
  });

  it('stops tank production on SCG11EA once the defensive floor is met', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      units: [
        unit({ id: 1, t: '3TNK', house: 'Greece', cx: 32, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 2, t: '3TNK', house: 'Greece', cx: 34, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 3, t: '3TNK', house: 'Greece', cx: 36, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 4, t: '2TNK', house: 'Greece', cx: 32, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 5, t: '2TNK', house: 'Greece', cx: 34, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 6, t: '2TNK', house: 'Greece', cx: 36, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 7, t: '2TNK', house: 'Greece', cx: 38, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 8, t: '2TNK', house: 'Greece', cx: 40, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 9, t: '2TNK', house: 'Greece', cx: 42, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 20, t: 'DD', house: 'Greece', cx: 64, cy: 86, hp: 200, mhp: 200, m: 5 }),
        unit({ id: 21, t: 'DD', house: 'Greece', cx: 65, cy: 86, hp: 200, mhp: 200, m: 5 }),
        unit({ id: 22, t: 'DD', house: 'Greece', cx: 66, cy: 86, hp: 200, mhp: 200, m: 5 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
        structure({ id: 103, t: 'PROC', ally: true, house: 'Greece', cx: 24, cy: 80 }),
        structure({ id: 104, t: 'WEAP', ally: true, house: 'Greece', cx: 32, cy: 76 }),
      ],
      buildable: {
        structures: ['POWR', 'SYRD'],
        units: ['3TNK', '2TNK', '1TNK', 'HARV'],
        infantry: ['E1', 'E3'],
        vessels: ['DD'],
      },
    });

    const decision = strategy.decide(s);
    const unitProduceCommands = decision.commands.filter(
      (c) => c.cmd === 'produce' && c.rtti === 29,
    );
    expect(unitProduceCommands).toHaveLength(0);
  });

  it('keeps producing tanks during SYRD placement until the hold line is restored', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      units: [
        unit({ id: 1, t: '3TNK', house: 'Greece', cx: 32, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 2, t: '3TNK', house: 'Greece', cx: 34, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 3, t: '3TNK', house: 'Greece', cx: 36, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 4, t: '2TNK', house: 'Greece', cx: 32, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 5, t: '2TNK', house: 'Greece', cx: 34, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 6, t: '2TNK', house: 'Greece', cx: 36, cy: 80, hp: 300, mhp: 300 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
        structure({ id: 103, t: 'WEAP', ally: true, house: 'Greece', cx: 32, cy: 76 }),
      ],
      production: [{ t: 'SYRD', prog: 45, rtti: 6, done: false }],
      buildable: {
        structures: ['POWR', 'SYRD'],
        units: ['3TNK', '2TNK', '1TNK', 'HARV'],
        infantry: ['E1', 'E3'],
        vessels: ['DD'],
      },
    });

    const decision = strategy.decide(s);
    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 29 }),
      ]),
    );
  });

  it('holds for east scout instead of falling through to a third refinery on SCG11EA', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      units: [
        unit({ id: 1, t: '3TNK', house: 'Greece', cx: 32, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 2, t: '3TNK', house: 'Greece', cx: 34, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 3, t: '3TNK', house: 'Greece', cx: 36, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 4, t: '2TNK', house: 'Greece', cx: 32, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 5, t: '2TNK', house: 'Greece', cx: 34, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 6, t: '2TNK', house: 'Greece', cx: 36, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 7, t: '2TNK', house: 'Greece', cx: 38, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 8, t: '2TNK', house: 'Greece', cx: 40, cy: 80, hp: 300, mhp: 300 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
        structure({ id: 103, t: 'PROC', ally: true, house: 'Greece', cx: 24, cy: 80 }),
        structure({ id: 104, t: 'WEAP', ally: true, house: 'Greece', cx: 32, cy: 76 }),
      ],
      buildable: {
        structures: ['PROC', 'POWR', 'SYRD'],
        units: ['3TNK', '2TNK', '1TNK', 'HARV'],
        infantry: ['E1', 'E3'],
        vessels: ['DD'],
      },
    });

    const decision = strategy.decide(s);
    const buildingProduceCommands = decision.commands.filter(
      (c) => c.cmd === 'produce' && c.rtti === 6,
    );
    expect(buildingProduceCommands).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type_id: 12 }),
        expect.objectContaining({ type_id: 27 }),
      ]),
    );
    expect(decision.reason).toContain('hold for east scout');
  });

  it('prioritizes SYRD once the east shoreline has been mapped on SCG11EA', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      units: [
        unit({ id: 1, t: '3TNK', house: 'Greece', cx: 32, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 2, t: '3TNK', house: 'Greece', cx: 34, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 3, t: '3TNK', house: 'Greece', cx: 36, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 4, t: '2TNK', house: 'Greece', cx: 32, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 5, t: '2TNK', house: 'Greece', cx: 34, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 6, t: '2TNK', house: 'Greece', cx: 36, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 7, t: '2TNK', house: 'Greece', cx: 38, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 8, t: '2TNK', house: 'Greece', cx: 40, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 9, t: '2TNK', house: 'Greece', cx: 60, cy: 89, hp: 300, mhp: 300 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 24, cy: 71 }),
        structure({ id: 103, t: 'PROC', ally: true, house: 'Greece', cx: 27, cy: 72 }),
        structure({ id: 104, t: 'WEAP', ally: true, house: 'Greece', cx: 19, cy: 80 }),
      ],
      buildable: {
        structures: ['POWR', 'SYRD'],
        units: ['3TNK', '2TNK', '1TNK', 'HARV'],
        infantry: ['E1', 'E3'],
        vessels: ['DD'],
      },
    });

    const decision = strategy.decide(s);
    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 6, type_id: 27 }),
      ]),
    );
  });

  it('holds SYRD until the east shoreline is mapped on SCG11EA', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      units: [
        unit({ id: 1, t: '3TNK', house: 'Greece', cx: 32, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 2, t: '3TNK', house: 'Greece', cx: 34, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 3, t: '3TNK', house: 'Greece', cx: 36, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 4, t: '2TNK', house: 'Greece', cx: 32, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 5, t: '2TNK', house: 'Greece', cx: 34, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 6, t: '2TNK', house: 'Greece', cx: 36, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 7, t: '2TNK', house: 'Greece', cx: 38, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 8, t: '2TNK', house: 'Greece', cx: 40, cy: 80, hp: 300, mhp: 300 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 24, cy: 71 }),
        structure({ id: 103, t: 'PROC', ally: true, house: 'Greece', cx: 27, cy: 72 }),
        structure({ id: 104, t: 'WEAP', ally: true, house: 'Greece', cx: 19, cy: 80 }),
      ],
      buildable: {
        structures: ['POWR', 'PROC', 'SYRD'],
        units: ['3TNK', '2TNK', '1TNK', 'HARV'],
        infantry: ['E1', 'E3'],
        vessels: ['DD'],
      },
    });

    const decision = strategy.decide(s);
    expect(decision.commands).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 6, type_id: 27 }),
      ]),
    );
    expect(decision.commands).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 6, type_id: 12 }),
      ]),
    );
    expect(decision.reason).toContain('hold for east scout');
  });

  it('produces destroyers when shipyard exists on SCG11EA', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
        structure({ id: 103, t: 'PROC', ally: true, house: 'Greece', cx: 24, cy: 80 }),
        structure({ id: 104, t: 'SYRD', ally: true, house: 'Greece', cx: 22, cy: 85 }),
      ],
      credits: 2000,
      buildable: {
        structures: ['POWR'],
        units: ['2TNK', 'HARV'],
        infantry: ['E1'],
        vessels: ['DD', 'PT'],
      },
    });

    const decision = strategy.decide(s);

    // Should produce DD (destroyer) — RTTI_VESSELTYPE = 31
    const vesselCommands = decision.commands.filter(
      (c) => c.cmd === 'produce' && c.rtti === 31,
    );
    expect(vesselCommands.length).toBeGreaterThan(0);
  });

  it('rebuilds WEAP on SCG11EA when the shipyard survives but tank production is offline', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      units: [
        unit({ id: 1, t: '2TNK', house: 'Greece', cx: 30, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 10, t: 'DD', house: 'Greece', cx: 64, cy: 86, hp: 200, mhp: 200, m: 5 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
        structure({ id: 104, t: 'SYRD', ally: true, house: 'Greece', cx: 64, cy: 87 }),
      ],
      credits: 4000,
      buildable: {
        structures: ['WEAP', 'PROC', 'POWR', 'APWR', 'SYRD'],
        units: [],
        infantry: ['E1'],
        vessels: ['DD'],
      },
    });

    const decision = strategy.decide(s);
    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 6, type_id: 2 }),
      ]),
    );
    expect(decision.reason).toContain('rebuild WEAP');
  });

  it('sends destroyers to intercept enemy submarines with hunt movement', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      units: [
        unit({ id: 1, t: '3TNK', house: 'Greece', cx: 32, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 10, t: 'DD', house: 'Greece', cx: 25, cy: 85, hp: 200, mhp: 200, m: 5 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 104, t: 'SYRD', ally: true, house: 'Greece', cx: 22, cy: 85 }),
      ],
      enemies: [
        unit({ id: 50, t: 'SS', ally: false, house: 'USSR', cx: 70, cy: 60, hp: 300, mhp: 300 }),
      ],
    });

    const decision = strategy.decide(s);

    // Destroyer should move onto the submarine cell with a HUNT mission.
    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'attack_move', ids: [10], cx: 70, cy: 60 }),
      ]),
    );
  });

  it('does not send SCG11EA land defenders to attack submarines near the east chain', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      units: [
        unit({ id: 1, t: '3TNK', house: 'Greece', cx: 32, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 2, t: 'ARTY', house: 'Greece', cx: 34, cy: 78, hp: 150, mhp: 150 }),
        unit({ id: 10, t: 'DD', house: 'Greece', cx: 63, cy: 86, hp: 200, mhp: 200, m: 5 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 60, cy: 88 }),
        structure({ id: 104, t: 'SYRD', ally: true, house: 'Greece', cx: 63, cy: 85 }),
      ],
      enemies: [
        unit({ id: 50, t: 'SS', ally: false, house: 'USSR', cx: 67, cy: 86, hp: 300, mhp: 300 }),
      ],
    });

    const decision = strategy.decide(s);
    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'attack_move', ids: [10], cx: 67, cy: 86 }),
      ]),
    );
    expect(decision.commands).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'attack_move', ids: [1], cx: 67, cy: 86 }),
        expect.objectContaining({ cmd: 'attack_move', ids: [2], cx: 67, cy: 86 }),
      ]),
    );
  });

  it('sweeps the river when no submarines are visible on SCG11EA', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      units: [
        unit({ id: 10, t: 'DD', house: 'Greece', cx: 25, cy: 85, hp: 200, mhp: 200, m: 5 }),
        unit({ id: 11, t: 'DD', house: 'Greece', cx: 27, cy: 85, hp: 200, mhp: 200, m: 5 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 104, t: 'SYRD', ally: true, house: 'Greece', cx: 63, cy: 85 }),
      ],
      enemies: [],
    });

    const decision = strategy.decide(s);
    const sweepCommands = decision.commands.filter((c) => c.cmd === 'attack_move');
    expect(sweepCommands.length).toBeGreaterThan(0);
  });

  it('rotates SCG11EA river sweep targets over time so a small fleet covers the full corridor', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const early = scg11eaState({
      tick: 0,
      units: [
        unit({ id: 10, t: 'DD', house: 'Greece', cx: 25, cy: 85, hp: 200, mhp: 200, m: 5 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 104, t: 'SYRD', ally: true, house: 'Greece', cx: 64, cy: 87 }),
      ],
      enemies: [],
    });
    const late = scg11eaState({
      tick: 800,
      units: [
        unit({ id: 10, t: 'DD', house: 'Greece', cx: 25, cy: 85, hp: 200, mhp: 200, m: 5 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 104, t: 'SYRD', ally: true, house: 'Greece', cx: 64, cy: 87 }),
      ],
      enemies: [],
    });

    const earlyMove = strategy.decide(early).commands.find((c) => c.cmd === 'attack_move');
    const lateMove = strategy.decide(late).commands.find((c) => c.cmd === 'attack_move');
    expect(earlyMove).toBeDefined();
    expect(lateMove).toBeDefined();
    expect(`${earlyMove!.cx},${earlyMove!.cy}`).not.toBe(`${lateMove!.cx},${lateMove!.cy}`);
  });

  it('does not initiate land attacks on SCG11EA before the fleet exists', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      credits: 5000,
      units: [
        unit({ id: 1, t: '3TNK', house: 'Greece', cx: 32, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 2, t: '3TNK', house: 'Greece', cx: 34, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 3, t: '3TNK', house: 'Greece', cx: 36, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 4, t: '2TNK', house: 'Greece', cx: 32, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 5, t: '2TNK', house: 'Greece', cx: 34, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 6, t: '2TNK', house: 'Greece', cx: 36, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 7, t: '2TNK', house: 'Greece', cx: 38, cy: 80, hp: 300, mhp: 300 }),
      ],
      enemies: [
        // Far-away enemy — should NOT trigger attack
        unit({ id: 50, t: '3TNK', ally: false, house: 'USSR', cx: 90, cy: 30, hp: 400, mhp: 400 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
      ],
    });

    const decision = strategy.decide(s);

    // Should NOT have attack commands targeting the far-away tank
    const attackFarEnemy = decision.commands.filter(
      (c) => (c.cmd === 'attack' || c.cmd === 'attack_move') && c.target === 50,
    );
    expect(attackFarEnemy).toHaveLength(0);
  });

  it('starts a committed land assault on SCG11EA once the first destroyer is online', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      credits: 5000,
      units: [
        unit({ id: 1, t: '3TNK', house: 'Greece', cx: 32, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 2, t: '3TNK', house: 'Greece', cx: 34, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 3, t: '3TNK', house: 'Greece', cx: 36, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 4, t: '2TNK', house: 'Greece', cx: 32, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 5, t: '2TNK', house: 'Greece', cx: 34, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 6, t: '2TNK', house: 'Greece', cx: 36, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 7, t: '2TNK', house: 'Greece', cx: 38, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 8, t: 'ARTY', house: 'Greece', cx: 30, cy: 82, hp: 150, mhp: 150 }),
        unit({ id: 20, t: 'DD', house: 'Greece', cx: 64, cy: 86, hp: 200, mhp: 200, m: 5 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
        structure({ id: 103, t: 'WEAP', ally: true, house: 'Greece', cx: 24, cy: 80 }),
        structure({ id: 104, t: 'SYRD', ally: true, house: 'Greece', cx: 63, cy: 85 }),
        structure({ id: 200, t: 'AFLD', ally: false, house: 'USSR', cx: 49, cy: 40 }),
        structure({ id: 201, t: 'WEAP', ally: false, house: 'USSR', cx: 51, cy: 45 }),
      ],
      enemies: [],
    });

    const decision = strategy.decide(s);
    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'attack_move', cx: 49, cy: 40 }),
      ]),
    );
  });

  it('starts the SCG11EA land suppression phase once the shipyard is online', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      credits: 5000,
      units: [
        unit({ id: 1, t: '3TNK', house: 'Greece', cx: 32, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 2, t: '3TNK', house: 'Greece', cx: 34, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 3, t: '3TNK', house: 'Greece', cx: 36, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 4, t: '2TNK', house: 'Greece', cx: 32, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 5, t: '2TNK', house: 'Greece', cx: 34, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 6, t: '2TNK', house: 'Greece', cx: 36, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 7, t: '2TNK', house: 'Greece', cx: 38, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 8, t: 'ARTY', house: 'Greece', cx: 30, cy: 82, hp: 150, mhp: 150 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
        structure({ id: 103, t: 'WEAP', ally: true, house: 'Greece', cx: 24, cy: 80 }),
        structure({ id: 104, t: 'SYRD', ally: true, house: 'Greece', cx: 63, cy: 85 }),
        structure({ id: 200, t: 'AFLD', ally: false, house: 'USSR', cx: 49, cy: 40 }),
        structure({ id: 201, t: 'WEAP', ally: false, house: 'USSR', cx: 51, cy: 45 }),
      ],
      enemies: [
        unit({ id: 50, t: 'YAK', ally: false, house: 'USSR', cx: 26, cy: 84, hp: 60, mhp: 60 }),
        unit({ id: 51, t: 'YAK', ally: false, house: 'USSR', cx: 28, cy: 84, hp: 60, mhp: 60 }),
        unit({ id: 52, t: 'HIND', ally: false, house: 'USSR', cx: 30, cy: 84, hp: 90, mhp: 90 }),
      ],
    });

    const decision = strategy.decide(s);
    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'attack_move', cx: 49, cy: 40 }),
      ]),
    );
  });
});
