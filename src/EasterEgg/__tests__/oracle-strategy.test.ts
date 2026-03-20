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

  it('builds the second WEAP before static tech on SCG11EA once the second refinery is online', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
        structure({ id: 103, t: 'PROC', ally: true, house: 'Greece', cx: 24, cy: 84 }),
        structure({ id: 104, t: 'WEAP', ally: true, house: 'Greece', cx: 32, cy: 76 }),
      ],
      buildable: {
        structures: ['WEAP', 'DOME', 'POWR', 'APWR', 'SYRD'],
        units: ['3TNK', '2TNK', '1TNK', 'HARV'],
        infantry: ['E1', 'E3'],
        vessels: ['DD'],
      },
    });

    const decision = strategy.decide(s);
    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 6, type_id: 2 }),
      ]),
    );
    expect(decision.commands).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 6, type_id: 6 }),
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

  it('restarts tank production on SCG11EA during sub hunt if the island hold collapses', () => {
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
        structure({ id: 103, t: 'WEAP', ally: true, house: 'Greece', cx: 24, cy: 80 }),
        structure({ id: 104, t: 'SYRD', ally: true, house: 'Greece', cx: 64, cy: 87 }),
      ],
      enemies: [
        unit({ id: 50, t: 'SS', ally: false, house: 'USSR', cx: 68, cy: 40, hp: 200, mhp: 200 }),
        unit({ id: 51, t: '3TNK', ally: false, house: 'USSR', cx: 31, cy: 81, hp: 400, mhp: 400 }),
        unit({ id: 52, t: 'V2RL', ally: false, house: 'USSR', cx: 33, cy: 82, hp: 150, mhp: 150 }),
      ],
      credits: 2500,
      buildable: {
        structures: ['PROC', 'POWR', 'APWR', 'DOME'],
        units: ['2TNK', '1TNK', 'HARV'],
        infantry: ['E1'],
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
        unit({ id: 10, t: '2TNK', house: 'Greece', cx: 44, cy: 80, hp: 300, mhp: 300 }),
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

  it('scouts east before starting SYRD on SCG11EA', () => {
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
        expect.objectContaining({ type_id: 27 }),
      ]),
    );
    expect(decision.reason).toContain('scout east');
  });

  it('prioritizes SYRD once the east shoreline and core ground economy are ready on SCG11EA', () => {
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
        structure({ id: 105, t: 'POWR', ally: true, house: 'Greece', cx: 32, cy: 84 }),
        structure({ id: 106, t: 'POWR', ally: true, house: 'Greece', cx: 34, cy: 84 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 24, cy: 71 }),
        structure({ id: 103, t: 'PROC', ally: true, house: 'Greece', cx: 27, cy: 72 }),
        structure({ id: 107, t: 'PROC', ally: true, house: 'Greece', cx: 22, cy: 74 }),
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
    expect(decision.reason).toContain('scout east');
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

  it('prioritizes destroyers over tank refills during SCG11EA sub cleanup once the home-guard floor is met', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      credits: 900,
      units: [
        unit({ id: 1, t: '3TNK', house: 'Greece', cx: 32, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 2, t: '2TNK', house: 'Greece', cx: 34, cy: 78, hp: 300, mhp: 300 }),
        unit({ id: 3, t: '2TNK', house: 'Greece', cx: 36, cy: 78, hp: 300, mhp: 300 }),
        unit({ id: 4, t: '2TNK', house: 'Greece', cx: 38, cy: 78, hp: 300, mhp: 300 }),
        unit({ id: 5, t: '2TNK', house: 'Greece', cx: 40, cy: 78, hp: 300, mhp: 300 }),
        unit({ id: 6, t: '1TNK', house: 'Greece', cx: 42, cy: 78, hp: 200, mhp: 200 }),
        unit({ id: 10, t: 'DD', house: 'Greece', cx: 63, cy: 86, hp: 200, mhp: 200, m: 5 }),
        unit({ id: 11, t: 'DD', house: 'Greece', cx: 65, cy: 86, hp: 200, mhp: 200, m: 5 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
        structure({ id: 103, t: 'WEAP', ally: true, house: 'Greece', cx: 24, cy: 80 }),
        structure({ id: 104, t: 'SYRD', ally: true, house: 'Greece', cx: 63, cy: 85 }),
      ],
      enemies: [
        unit({ id: 50, t: 'SS', ally: false, house: 'USSR', cx: 68, cy: 40, hp: 200, mhp: 200 }),
        unit({ id: 51, t: 'SS', ally: false, house: 'USSR', cx: 70, cy: 44, hp: 200, mhp: 200 }),
      ],
      buildable: {
        structures: ['POWR'],
        units: ['3TNK', '2TNK', '1TNK', 'HARV'],
        infantry: ['E1'],
        vessels: ['DD'],
      },
    });

    const decision = strategy.decide(s);
    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 31 }),
      ]),
    );
    expect(decision.commands).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 29 }),
      ]),
    );
  });

  it('keeps SCG11EA in sub-cleanup mode even if the shipyard is lost mid-fight', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      credits: 900,
      units: [
        unit({ id: 1, t: '3TNK', house: 'Greece', cx: 32, cy: 78, hp: 400, mhp: 400 }),
        unit({ id: 2, t: '2TNK', house: 'Greece', cx: 34, cy: 78, hp: 300, mhp: 300 }),
        unit({ id: 3, t: '2TNK', house: 'Greece', cx: 36, cy: 78, hp: 300, mhp: 300 }),
        unit({ id: 4, t: '2TNK', house: 'Greece', cx: 38, cy: 78, hp: 300, mhp: 300 }),
        unit({ id: 5, t: '2TNK', house: 'Greece', cx: 40, cy: 78, hp: 300, mhp: 300 }),
        unit({ id: 10, t: 'DD', house: 'Greece', cx: 63, cy: 86, hp: 200, mhp: 200, m: 5 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
        structure({ id: 103, t: 'WEAP', ally: true, house: 'Greece', cx: 24, cy: 80 }),
      ],
      enemies: [
        unit({ id: 50, t: 'SS', ally: false, house: 'USSR', cx: 68, cy: 40, hp: 200, mhp: 200 }),
        unit({ id: 51, t: 'SS', ally: false, house: 'USSR', cx: 70, cy: 44, hp: 200, mhp: 200 }),
      ],
      buildable: {
        structures: ['PROC', 'POWR'],
        units: ['3TNK', '2TNK', '1TNK', 'HARV'],
        infantry: ['E1'],
        vessels: [],
      },
    });

    const decision = strategy.decide(s);
    expect(decision.commands).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 29 }),
      ]),
    );
  });

  it('rebuilds PROC during SCG11EA sub cleanup when naval economy is down to the last refinery', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      credits: 3000,
      units: [
        unit({ id: 1, t: '2TNK', house: 'Greece', cx: 34, cy: 78, hp: 300, mhp: 300 }),
        unit({ id: 10, t: 'DD', house: 'Greece', cx: 63, cy: 86, hp: 200, mhp: 200, m: 5 }),
        unit({ id: 11, t: 'DD', house: 'Greece', cx: 65, cy: 86, hp: 200, mhp: 200, m: 5 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
        structure({ id: 104, t: 'SYRD', ally: true, house: 'Greece', cx: 63, cy: 85 }),
      ],
      enemies: [
        unit({ id: 50, t: 'SS', ally: false, house: 'USSR', cx: 68, cy: 40, hp: 200, mhp: 200 }),
        unit({ id: 51, t: 'SS', ally: false, house: 'USSR', cx: 70, cy: 44, hp: 200, mhp: 200 }),
      ],
      buildable: {
        structures: ['PROC', 'POWR'],
        units: [],
        infantry: [],
        vessels: ['DD'],
      },
    });

    const decision = strategy.decide(s);
    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 6, type_id: 12 }),
      ]),
    );
    expect(decision.commands).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 31 }),
      ]),
    );
  });

  it('keeps producing tanks during SCG11EA sub cleanup until the home-guard floor is restored', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      credits: 5000,
      units: [
        unit({ id: 1, t: '2TNK', house: 'Greece', cx: 34, cy: 78, hp: 300, mhp: 300 }),
        unit({ id: 2, t: '2TNK', house: 'Greece', cx: 36, cy: 78, hp: 300, mhp: 300 }),
        unit({ id: 10, t: 'DD', house: 'Greece', cx: 63, cy: 86, hp: 200, mhp: 200, m: 5 }),
        unit({ id: 11, t: 'DD', house: 'Greece', cx: 65, cy: 86, hp: 200, mhp: 200, m: 5 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
        structure({ id: 103, t: 'PROC', ally: true, house: 'Greece', cx: 24, cy: 84 }),
        structure({ id: 104, t: 'WEAP', ally: true, house: 'Greece', cx: 32, cy: 76 }),
        structure({ id: 105, t: 'SYRD', ally: true, house: 'Greece', cx: 63, cy: 85 }),
      ],
      enemies: [
        unit({ id: 50, t: 'SS', ally: false, house: 'USSR', cx: 68, cy: 40, hp: 200, mhp: 200 }),
      ],
      buildable: {
        structures: ['PROC', 'POWR'],
        units: ['3TNK', '2TNK', '1TNK', 'HARV'],
        infantry: [],
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

  it('rebuilds the shipyard before extra economy if SCG11EA naval tech is lost during sub cleanup', () => {
    const strategy = new OracleStrategy('SCG11EA');

    strategy.decide(scg11eaState({
      units: [
        unit({ id: 1, t: '2TNK', house: 'Greece', cx: 60, cy: 89, hp: 300, mhp: 300 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 110, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 101, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
        structure({ id: 102, t: 'SYRD', ally: true, house: 'Greece', cx: 63, cy: 85 }),
      ],
      buildable: {
        structures: ['POWR', 'PROC', 'SYRD'],
        units: [],
        infantry: [],
        vessels: ['DD'],
      },
      enemies: [
        unit({ id: 50, t: 'SS', ally: false, house: 'USSR', cx: 68, cy: 40, hp: 200, mhp: 200 }),
      ],
    }));

    const s = scg11eaState({
      credits: 5000,
      units: [
        unit({ id: 1, t: '2TNK', house: 'Greece', cx: 60, cy: 89, hp: 300, mhp: 300 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 110, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 101, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 24, cy: 84 }),
      ],
      buildable: {
        structures: ['POWR', 'PROC', 'SYRD'],
        units: [],
        infantry: [],
        vessels: ['DD'],
      },
      enemies: [
        unit({ id: 50, t: 'SS', ally: false, house: 'USSR', cx: 68, cy: 40, hp: 200, mhp: 200 }),
      ],
    });

    const decision = strategy.decide(s);
    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 6, type_id: 27 }),
      ]),
    );
    expect(decision.reason).toContain('rebuild SYRD for sub hunt');
  });

  it('defers SCG11EA shipyard rebuild while one destroyer is still afloat and cash is tight', () => {
    const strategy = new OracleStrategy('SCG11EA');

    strategy.decide(scg11eaState({
      units: [
        unit({ id: 1, t: '2TNK', house: 'Greece', cx: 60, cy: 89, hp: 300, mhp: 300 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 110, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 101, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 24, cy: 84 }),
        structure({ id: 103, t: 'SYRD', ally: true, house: 'Greece', cx: 63, cy: 85 }),
      ],
      buildable: {
        structures: ['POWR', 'PROC', 'SYRD'],
        units: [],
        infantry: [],
        vessels: ['DD'],
      },
      enemies: [
        unit({ id: 50, t: 'SS', ally: false, house: 'USSR', cx: 68, cy: 40, hp: 200, mhp: 200 }),
      ],
    }));

    const s = scg11eaState({
      credits: 550,
      units: [
        unit({ id: 1, t: '2TNK', house: 'Greece', cx: 60, cy: 89, hp: 300, mhp: 300 }),
        unit({ id: 10, t: 'DD', house: 'Greece', cx: 65, cy: 86, hp: 200, mhp: 200, m: 5 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 110, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 101, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 24, cy: 84 }),
      ],
      buildable: {
        structures: ['POWR', 'PROC', 'SYRD'],
        units: [],
        infantry: [],
        vessels: ['DD'],
      },
      enemies: [
        unit({ id: 50, t: 'SS', ally: false, house: 'USSR', cx: 68, cy: 40, hp: 200, mhp: 200 }),
        unit({ id: 51, t: 'SS', ally: false, house: 'USSR', cx: 70, cy: 44, hp: 200, mhp: 200 }),
        unit({ id: 52, t: 'SS', ally: false, house: 'USSR', cx: 72, cy: 48, hp: 200, mhp: 200 }),
        unit({ id: 53, t: 'SS', ally: false, house: 'USSR', cx: 74, cy: 52, hp: 200, mhp: 200 }),
        unit({ id: 54, t: 'SS', ally: false, house: 'USSR', cx: 76, cy: 56, hp: 200, mhp: 200 }),
        unit({ id: 55, t: 'SS', ally: false, house: 'USSR', cx: 78, cy: 60, hp: 200, mhp: 200 }),
      ],
    });

    const decision = strategy.decide(s);
    expect(decision.commands).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 6, type_id: 27 }),
      ]),
    );
    expect(decision.reason).not.toContain('rebuild SYRD for sub hunt');
  });

  it('starts the shipyard on SCG11EA once the coast, refinery line, and power line are ready', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      credits: 5000,
      units: [
        unit({ id: 1, t: '2TNK', house: 'Greece', cx: 60, cy: 89, hp: 300, mhp: 300 }),
        unit({ id: 2, t: '2TNK', house: 'Greece', cx: 32, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 3, t: '2TNK', house: 'Greece', cx: 34, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 4, t: '2TNK', house: 'Greece', cx: 36, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 5, t: '2TNK', house: 'Greece', cx: 38, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 6, t: '2TNK', house: 'Greece', cx: 40, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 7, t: '2TNK', house: 'Greece', cx: 42, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 8, t: '2TNK', house: 'Greece', cx: 44, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 9, t: '2TNK', house: 'Greece', cx: 46, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 10, t: '2TNK', house: 'Greece', cx: 48, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 11, t: '2TNK', house: 'Greece', cx: 50, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 12, t: '2TNK', house: 'Greece', cx: 52, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 13, t: '2TNK', house: 'Greece', cx: 54, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 14, t: '2TNK', house: 'Greece', cx: 56, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 15, t: '2TNK', house: 'Greece', cx: 58, cy: 80, hp: 300, mhp: 300 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 102, t: 'POWR', ally: true, house: 'Greece', cx: 31, cy: 84 }),
        structure({ id: 103, t: 'POWR', ally: true, house: 'Greece', cx: 34, cy: 84 }),
        structure({ id: 104, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
        structure({ id: 105, t: 'PROC', ally: true, house: 'Greece', cx: 24, cy: 84 }),
        structure({ id: 106, t: 'PROC', ally: true, house: 'Greece', cx: 22, cy: 86 }),
        structure({ id: 107, t: 'WEAP', ally: true, house: 'Greece', cx: 19, cy: 80 }),
        structure({ id: 108, t: 'WEAP', ally: true, house: 'Greece', cx: 19, cy: 84 }),
      ],
      buildable: {
        structures: ['POWR', 'APWR', 'PROC', 'SYRD'],
        units: ['2TNK', 'HARV'],
        infantry: ['E1'],
        vessels: ['DD'],
      },
    });

    const decision = strategy.decide(s);
    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 6, type_id: 27 }),
      ]),
    );
    expect(decision.commands).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 6, type_id: 12 }),
      ]),
    );
  });

  it('builds DOME on SCG11EA during sub hunt when aircraft pressure rises and the naval economy is already stable', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      units: [
        unit({ id: 1, t: '2TNK', house: 'Greece', cx: 30, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 10, t: 'DD', house: 'Greece', cx: 64, cy: 86, hp: 200, mhp: 200, m: 5 }),
        unit({ id: 11, t: 'DD', house: 'Greece', cx: 66, cy: 86, hp: 200, mhp: 200, m: 5 }),
        unit({ id: 12, t: 'DD', house: 'Greece', cx: 68, cy: 86, hp: 200, mhp: 200, m: 5 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
        structure({ id: 103, t: 'PROC', ally: true, house: 'Greece', cx: 24, cy: 84 }),
        structure({ id: 105, t: 'PROC', ally: true, house: 'Greece', cx: 22, cy: 86 }),
        structure({ id: 104, t: 'SYRD', ally: true, house: 'Greece', cx: 64, cy: 87 }),
      ],
      enemies: [
        unit({ id: 50, t: 'SS', ally: false, house: 'USSR', cx: 68, cy: 40, hp: 200, mhp: 200 }),
        unit({ id: 51, t: 'YAK', ally: false, house: 'USSR', cx: 28, cy: 82, hp: 60, mhp: 60 }),
        unit({ id: 52, t: 'HIND', ally: false, house: 'USSR', cx: 30, cy: 84, hp: 90, mhp: 90 }),
      ],
      credits: 4000,
      buildable: {
        structures: ['WEAP', 'DOME', 'PROC', 'POWR', 'APWR', 'SYRD'],
        units: [],
        infantry: ['E1'],
        vessels: ['DD'],
      },
    });

    const decision = strategy.decide(s);
    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 6, type_id: 6 }),
      ]),
    );
    expect(decision.commands).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 6, type_id: 2 }),
      ]),
    );
  });

  it('does not rebuild WEAP on SCG11EA while submarines remain and AA is already unlocked once economy is stable', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      units: [
        unit({ id: 1, t: '2TNK', house: 'Greece', cx: 30, cy: 80, hp: 300, mhp: 300 }),
        unit({ id: 10, t: 'DD', house: 'Greece', cx: 64, cy: 86, hp: 200, mhp: 200, m: 5 }),
        unit({ id: 11, t: 'DD', house: 'Greece', cx: 66, cy: 86, hp: 200, mhp: 200, m: 5 }),
        unit({ id: 12, t: 'DD', house: 'Greece', cx: 68, cy: 86, hp: 200, mhp: 200, m: 5 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 101, t: 'POWR', ally: true, house: 'Greece', cx: 28, cy: 80 }),
        structure({ id: 102, t: 'PROC', ally: true, house: 'Greece', cx: 26, cy: 80 }),
        structure({ id: 105, t: 'PROC', ally: true, house: 'Greece', cx: 24, cy: 84 }),
        structure({ id: 106, t: 'PROC', ally: true, house: 'Greece', cx: 22, cy: 86 }),
        structure({ id: 103, t: 'DOME', ally: true, house: 'Greece', cx: 22, cy: 78 }),
        structure({ id: 104, t: 'SYRD', ally: true, house: 'Greece', cx: 64, cy: 87 }),
      ],
      enemies: [
        unit({ id: 50, t: 'SS', ally: false, house: 'USSR', cx: 68, cy: 40, hp: 200, mhp: 200 }),
        unit({ id: 51, t: 'YAK', ally: false, house: 'USSR', cx: 28, cy: 82, hp: 60, mhp: 60 }),
        unit({ id: 52, t: 'HIND', ally: false, house: 'USSR', cx: 30, cy: 84, hp: 90, mhp: 90 }),
      ],
      credits: 4000,
      buildable: {
        structures: ['WEAP', 'AGUN', 'PROC', 'POWR', 'APWR', 'SYRD'],
        units: [],
        infantry: ['E1'],
        vessels: ['DD'],
      },
    });

    const decision = strategy.decide(s);
    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 6, type_id: 9 }),
      ]),
    );
    expect(decision.commands).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'produce', rtti: 6, type_id: 2 }),
      ]),
    );
  });

  it('rebuilds WEAP on SCG11EA during sub hunt if armor collapses under ground pressure after the refinery line is intact', () => {
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
        structure({ id: 103, t: 'PROC', ally: true, house: 'Greece', cx: 24, cy: 84 }),
        structure({ id: 104, t: 'SYRD', ally: true, house: 'Greece', cx: 64, cy: 87 }),
      ],
      enemies: [
        unit({ id: 50, t: 'SS', ally: false, house: 'USSR', cx: 68, cy: 40, hp: 200, mhp: 200 }),
        unit({ id: 51, t: '3TNK', ally: false, house: 'USSR', cx: 31, cy: 81, hp: 400, mhp: 400 }),
        unit({ id: 52, t: 'V2RL', ally: false, house: 'USSR', cx: 33, cy: 82, hp: 150, mhp: 150 }),
      ],
      credits: 4000,
      buildable: {
        structures: ['WEAP', 'PROC', 'POWR', 'APWR'],
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
    expect(decision.reason).toContain('emergency rebuild WEAP');
  });

  it('rebuilds WEAP on SCG11EA after the submarine screen is gone', () => {
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
      enemies: [],
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

  it('keeps a small SCG11EA destroyer group massed on the same submarine lane', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      units: [
        unit({ id: 10, t: 'DD', house: 'Greece', cx: 63, cy: 86, hp: 200, mhp: 200, m: 5 }),
        unit({ id: 11, t: 'DD', house: 'Greece', cx: 65, cy: 86, hp: 200, mhp: 200, m: 5 }),
        unit({ id: 12, t: 'DD', house: 'Greece', cx: 67, cy: 86, hp: 200, mhp: 200, m: 5 }),
      ],
      structures: [
        structure({ id: 100, t: 'FACT', ally: true, house: 'Greece', cx: 30, cy: 80 }),
        structure({ id: 104, t: 'SYRD', ally: true, house: 'Greece', cx: 63, cy: 85 }),
      ],
      enemies: [
        unit({ id: 50, t: 'SS', ally: false, house: 'USSR', cx: 68, cy: 40, hp: 300, mhp: 300 }),
        unit({ id: 51, t: 'SS', ally: false, house: 'USSR', cx: 70, cy: 44, hp: 300, mhp: 300 }),
        unit({ id: 52, t: 'SS', ally: false, house: 'USSR', cx: 72, cy: 48, hp: 300, mhp: 300 }),
      ],
    });

    const decision = strategy.decide(s);
    const huntCommands = decision.commands.filter((c) => c.cmd === 'attack_move');
    expect(huntCommands).toHaveLength(3);
    const uniqueTargets = new Set(huntCommands.map((command) => `${command.cx},${command.cy}`));
    expect(uniqueTargets.size).toBe(1);
    expect(uniqueTargets.has('68,40') || uniqueTargets.has('70,44') || uniqueTargets.has('72,48')).toBe(true);
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
      missionTimerActive: true,
      missionTimer: 100000,
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
        structure({ id: 200, t: 'AFLD', ally: false, house: 'USSR', cx: 49, cy: 40 }),
        structure({ id: 201, t: 'WEAP', ally: false, house: 'USSR', cx: 51, cy: 45 }),
      ],
    });

    const decision = strategy.decide(s);
    expect(decision.reason).not.toContain('assault (');
    expect(decision.reason).not.toContain('attack nearby');
    expect(decision.commands).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'attack_move', cx: 49, cy: 40 }),
      ]),
    );
  });

  it('starts a committed land assault on SCG11EA only after the river is cleared', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      credits: 5000,
      units: [
        unit({ id: 1, t: '3TNK', house: 'Greece', cx: 43, cy: 66, hp: 400, mhp: 400 }),
        unit({ id: 2, t: '3TNK', house: 'Greece', cx: 45, cy: 66, hp: 400, mhp: 400 }),
        unit({ id: 3, t: '3TNK', house: 'Greece', cx: 47, cy: 66, hp: 400, mhp: 400 }),
        unit({ id: 4, t: '2TNK', house: 'Greece', cx: 43, cy: 68, hp: 300, mhp: 300 }),
        unit({ id: 5, t: '2TNK', house: 'Greece', cx: 45, cy: 68, hp: 300, mhp: 300 }),
        unit({ id: 6, t: '2TNK', house: 'Greece', cx: 47, cy: 68, hp: 300, mhp: 300 }),
        unit({ id: 7, t: '2TNK', house: 'Greece', cx: 49, cy: 68, hp: 300, mhp: 300 }),
        unit({ id: 8, t: 'ARTY', house: 'Greece', cx: 42, cy: 69, hp: 150, mhp: 150 }),
        unit({ id: 9, t: '2TNK', house: 'Greece', cx: 51, cy: 68, hp: 300, mhp: 300 }),
        unit({ id: 10, t: '2TNK', house: 'Greece', cx: 53, cy: 68, hp: 300, mhp: 300 }),
        unit({ id: 11, t: '1TNK', house: 'Greece', cx: 44, cy: 70, hp: 200, mhp: 200 }),
        unit({ id: 12, t: '1TNK', house: 'Greece', cx: 46, cy: 70, hp: 200, mhp: 200 }),
        unit({ id: 20, t: 'DD', house: 'Greece', cx: 64, cy: 86, hp: 200, mhp: 200, m: 5 }),
        unit({ id: 21, t: 'DD', house: 'Greece', cx: 66, cy: 86, hp: 200, mhp: 200, m: 5 }),
        unit({ id: 22, t: 'DD', house: 'Greece', cx: 68, cy: 86, hp: 200, mhp: 200, m: 5 }),
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
        expect.objectContaining({ cmd: 'attack_move', cx: 51, cy: 45 }),
      ]),
    );
  });

  it('sends all armor to assault Soviet base on SCG11EA once the river is effectively open', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const s = scg11eaState({
      credits: 5000,
      units: [
        unit({ id: 1, t: '3TNK', house: 'Greece', cx: 43, cy: 66, hp: 400, mhp: 400 }),
        unit({ id: 2, t: '3TNK', house: 'Greece', cx: 45, cy: 66, hp: 400, mhp: 400 }),
        unit({ id: 3, t: '3TNK', house: 'Greece', cx: 47, cy: 66, hp: 400, mhp: 400 }),
        unit({ id: 4, t: '2TNK', house: 'Greece', cx: 43, cy: 68, hp: 300, mhp: 300 }),
        unit({ id: 5, t: '2TNK', house: 'Greece', cx: 45, cy: 68, hp: 300, mhp: 300 }),
        unit({ id: 6, t: '2TNK', house: 'Greece', cx: 47, cy: 68, hp: 300, mhp: 300 }),
        unit({ id: 7, t: '2TNK', house: 'Greece', cx: 49, cy: 68, hp: 300, mhp: 300 }),
        unit({ id: 8, t: '2TNK', house: 'Greece', cx: 51, cy: 68, hp: 300, mhp: 300 }),
        unit({ id: 9, t: 'ARTY', house: 'Greece', cx: 42, cy: 69, hp: 150, mhp: 150 }),
        unit({ id: 11, t: '2TNK', house: 'Greece', cx: 53, cy: 68, hp: 300, mhp: 300 }),
        unit({ id: 12, t: '1TNK', house: 'Greece', cx: 44, cy: 70, hp: 200, mhp: 200 }),
        unit({ id: 13, t: '1TNK', house: 'Greece', cx: 46, cy: 70, hp: 200, mhp: 200 }),
        unit({ id: 20, t: 'DD', house: 'Greece', cx: 64, cy: 86, hp: 200, mhp: 200, m: 5 }),
        unit({ id: 21, t: 'DD', house: 'Greece', cx: 66, cy: 86, hp: 200, mhp: 200, m: 5 }),
        unit({ id: 22, t: 'DD', house: 'Greece', cx: 68, cy: 86, hp: 200, mhp: 200, m: 5 }),
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
        unit({ id: 60, t: 'SS', ally: false, house: 'USSR', cx: 68, cy: 40, hp: 200, mhp: 200 }),
      ],
    });

    const decision = strategy.decide(s);
    expect(decision.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'attack_move', cx: 51, cy: 45, ids: expect.any(Array) }),
      ]),
    );
    const assaultCommand = decision.commands.find((c) =>
      c.cmd === 'attack_move' &&
      c.cx === 51 &&
      c.cy === 45 &&
      Array.isArray(c.ids),
    );
    expect(assaultCommand).toBeDefined();
    // All-in assault: all 12 armor units sent (no home guard)
    expect((assaultCommand!.ids as number[]).length).toBeGreaterThanOrEqual(10);
  });

  it('does not peel SCG11EA armor west at the first 2-DD / 8-sub plateau', () => {
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
        unit({ id: 21, t: 'DD', house: 'Greece', cx: 66, cy: 86, hp: 200, mhp: 200, m: 5 }),
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
        unit({ id: 60, t: 'SS', ally: false, house: 'USSR', cx: 68, cy: 40, hp: 200, mhp: 200 }),
        unit({ id: 61, t: 'SS', ally: false, house: 'USSR', cx: 69, cy: 42, hp: 200, mhp: 200 }),
        unit({ id: 62, t: 'SS', ally: false, house: 'USSR', cx: 70, cy: 44, hp: 200, mhp: 200 }),
        unit({ id: 63, t: 'SS', ally: false, house: 'USSR', cx: 71, cy: 46, hp: 200, mhp: 200 }),
        unit({ id: 64, t: 'SS', ally: false, house: 'USSR', cx: 72, cy: 48, hp: 200, mhp: 200 }),
        unit({ id: 65, t: 'SS', ally: false, house: 'USSR', cx: 73, cy: 50, hp: 200, mhp: 200 }),
        unit({ id: 66, t: 'SS', ally: false, house: 'USSR', cx: 74, cy: 52, hp: 200, mhp: 200 }),
        unit({ id: 67, t: 'SS', ally: false, house: 'USSR', cx: 75, cy: 54, hp: 200, mhp: 200 }),
        unit({ id: 50, t: 'YAK', ally: false, house: 'USSR', cx: 26, cy: 84, hp: 60, mhp: 60 }),
        unit({ id: 51, t: 'YAK', ally: false, house: 'USSR', cx: 28, cy: 84, hp: 60, mhp: 60 }),
        unit({ id: 52, t: 'HIND', ally: false, house: 'USSR', cx: 30, cy: 84, hp: 90, mhp: 90 }),
      ],
    });

    const decision = strategy.decide(s);
    expect(decision.reason).not.toContain('assault (');
    expect(decision.commands).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'attack_move', cx: 49, cy: 40 }),
      ]),
    );
  });
});
