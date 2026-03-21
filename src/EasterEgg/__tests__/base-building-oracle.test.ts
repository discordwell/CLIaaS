import { describe, it, expect } from 'vitest';
import { OracleStrategy } from '../oracle/OracleStrategy.js';
import type { RAGameState, RAEntity, RAStructure, RABuildable } from '../oracle/WasmAdapter.js';

/**
 * Base-Building Oracle Tests — verify the OracleStrategy's base-building
 * decision pipeline using pure data fixtures (no WASM or browser needed).
 *
 * Tests the new produce/place/buildable functionality added for the
 * base-building strategy.
 */

// RTTIType constants matching C++ defines.h
const RTTI_BUILDINGTYPE = 6;
const RTTI_UNITTYPE = 29;
const RTTI_INFANTRYTYPE = 14;
const RTTI_VESSELTYPE = 31;

function makeEntity(
  id: number, t: string, house: string,
  cx: number, cy: number,
  hp = 100, mhp = 100, m = 5, // m=5 is MISSION_GUARD
): RAEntity {
  return { id, t, house, cx, cy, hp, mhp, m, ally: true };
}

function makeStructure(
  id: number, t: string, house: string,
  cx: number, cy: number,
  ally = true,
): RAStructure {
  return { id, t, house, cx, cy, hp: 256, mhp: 256, m: 0, ally, repairing: false };
}

function makeTankLine(startId: number, count = 8, cx = 31, cy = 84): RAEntity[] {
  return Array.from({ length: count }, (_, i) =>
    makeEntity(startId + i, '2TNK', 'Greece', cx + (i % 4), cy + Math.floor(i / 4)));
}

function makeState(overrides: Partial<RAGameState> = {}): RAGameState {
  return {
    tick: 100,
    credits: 5000,
    playerHouse: 'Greece',
    alliedHouses: ['Greece'],
    globals: [],
    missionTimer: 0,
    missionTimerActive: false,
    civEvacuated: false,
    winPending: false,
    losePending: false,
    power: { produced: 0, consumed: 0 },
    units: [],
    enemies: [],
    structures: [],
    production: [],
    buildable: { structures: [], units: [], infantry: [] },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
// MCV Detection & Deployment
// ═══════════════════════════════════════════════════════════

describe('base building — MCV deployment', () => {
  it('sends deploy command when idle MCV present and no ConYard', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      units: [makeEntity(1, 'MCV', 'Greece', 50, 50)],
    });

    const decision = strategy.decide(state);
    const deployCmd = decision.commands.find((c) => c.cmd === 'deploy');
    expect(deployCmd).toBeDefined();
    expect(deployCmd!.ids).toEqual([1]);
    expect(decision.reason).toContain('deploy MCV');
  });

  it('does not re-send deploy when MCV is not idle (already deploying)', () => {
    const strategy = new OracleStrategy('SCG04EA');
    // m=12 is MISSION_UNLOAD (deploying)
    const state = makeState({
      units: [makeEntity(1, 'MCV', 'Greece', 50, 50, 100, 100, 12)],
    });

    const decision = strategy.decide(state);
    const deployCmd = decision.commands.find((c) => c.cmd === 'deploy');
    expect(deployCmd).toBeUndefined();
    expect(decision.reason).toContain('MCV deploying');
  });
});

describe('SCG11EA naval cleanup', () => {
  it('keeps producing destroyers while seven submarines remain', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const enemies = Array.from({ length: 7 }, (_, i) => {
      const sub = makeEntity(200 + i, 'SS', 'USSR', 70 + (i % 2), 40 + i, 100, 100, 5);
      sub.ally = false;
      return sub;
    });
    const state = makeState({
      tick: 18000,
      credits: 5000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
        makeStructure(102, 'POWR', 'Greece', 33, 80),
        makeStructure(103, 'PROC', 'Greece', 26, 78),
        makeStructure(104, 'PROC', 'Greece', 24, 82),
        makeStructure(105, 'SYRD', 'Greece', 64, 87),
      ],
      units: [
        ...makeTankLine(1),
        makeEntity(10, 'DD', 'Greece', 67, 88),
        makeEntity(11, 'DD', 'Greece', 69, 88),
        makeEntity(12, 'DD', 'Greece', 71, 88),
      ],
      enemies,
      power: { produced: 200, consumed: 120 },
      buildable: { structures: [], units: [], infantry: [], vessels: ['DD'] },
    });

    const decision = strategy.decide(state);
    const vesselProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_VESSELTYPE,
    );
    expect(vesselProd).toBeDefined();
    expect(decision.reason).toContain('produce DD');
  });

  it('rallies two destroyers instead of hunting seven submarines piecemeal', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const enemies = Array.from({ length: 7 }, (_, i) => {
      const sub = makeEntity(300 + i, 'SS', 'USSR', 70 + (i % 2), 42 + i, 100, 100, 5);
      sub.ally = false;
      return sub;
    });
    const state = makeState({
      tick: 18000,
      credits: 5000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
        makeStructure(102, 'POWR', 'Greece', 33, 80),
        makeStructure(103, 'PROC', 'Greece', 26, 78),
        makeStructure(104, 'PROC', 'Greece', 24, 82),
        makeStructure(105, 'SYRD', 'Greece', 64, 87),
      ],
      units: [
        makeEntity(20, 'DD', 'Greece', 58, 96),
        makeEntity(21, 'DD', 'Greece', 60, 94),
      ],
      enemies,
      power: { produced: 200, consumed: 120 },
      buildable: { structures: [], units: [], infantry: [], vessels: ['DD'] },
    });

    const decision = strategy.decide(state);
    const rallyCmd = decision.commands.find(
      (c) => c.cmd === 'move' && c.cx === 70 && c.cy === 88,
    );
    const huntCmd = decision.commands.find((c) => c.cmd === 'attack_move');
    expect(rallyCmd).toBeDefined();
    expect(huntCmd).toBeUndefined();
    expect(decision.reason).toContain('rally fleet (2/3)');
  });

  it('keeps fleet-first production when four submarines remain and the island hold is stable', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const enemies = Array.from({ length: 4 }, (_, i) => {
      const sub = makeEntity(400 + i, 'SS', 'USSR', 68 + (i % 2), 40 + i, 100, 100, 5);
      sub.ally = false;
      return sub;
    });
    const state = makeState({
      tick: 32000,
      credits: 1200,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
        makeStructure(102, 'POWR', 'Greece', 33, 80),
        makeStructure(103, 'PROC', 'Greece', 26, 78),
        makeStructure(104, 'PROC', 'Greece', 24, 82),
        makeStructure(105, 'WEAP', 'Greece', 32, 76),
        makeStructure(106, 'SYRD', 'Greece', 64, 87),
      ],
      units: [
        ...makeTankLine(10),
        makeEntity(20, 'DD', 'Greece', 68, 88),
        makeEntity(21, 'DD', 'Greece', 70, 88),
      ],
      enemies,
      power: { produced: 200, consumed: 120 },
      buildable: { structures: [], units: ['2TNK'], infantry: [], vessels: ['DD'] },
    });

    const decision = strategy.decide(state);
    const unitProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_UNITTYPE,
    );
    const vesselProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_VESSELTYPE,
    );
    expect(unitProd).toBeUndefined();
    expect(vesselProd).toBeDefined();
    expect(decision.reason).toContain('produce DD');
  });

  it('ignores distant air units when deciding whether the four-sub cleanup can stay fleet-first', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const enemies = [
      ...Array.from({ length: 4 }, (_, i) => {
        const sub = makeEntity(600 + i, 'SS', 'USSR', 68 + (i % 2), 40 + i, 100, 100, 5);
        sub.ally = false;
        return sub;
      }),
      ...Array.from({ length: 3 }, (_, i) => {
        const yak = makeEntity(700 + i, 'YAK', 'USSR', 90 + i, 20 + i, 100, 100, 5);
        yak.ally = false;
        return yak;
      }),
    ];
    const state = makeState({
      tick: 32000,
      credits: 1200,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
        makeStructure(102, 'POWR', 'Greece', 33, 80),
        makeStructure(103, 'PROC', 'Greece', 26, 78),
        makeStructure(104, 'PROC', 'Greece', 24, 82),
        makeStructure(105, 'WEAP', 'Greece', 32, 76),
        makeStructure(106, 'SYRD', 'Greece', 64, 87),
      ],
      units: [
        ...makeTankLine(10),
        makeEntity(20, 'DD', 'Greece', 68, 88),
        makeEntity(21, 'DD', 'Greece', 70, 88),
      ],
      enemies,
      power: { produced: 200, consumed: 120 },
      buildable: { structures: ['AGUN', 'DOME'], units: ['2TNK'], infantry: [], vessels: ['DD'] },
    });

    const decision = strategy.decide(state);
    const unitProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_UNITTYPE,
    );
    const vesselProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_VESSELTYPE,
    );
    expect(unitProd).toBeUndefined();
    expect(vesselProd).toBeDefined();
    expect(decision.reason).toContain('produce DD');
  });

  it('rallies two destroyers against four submarines until a third escort is ready', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const enemies = Array.from({ length: 4 }, (_, i) => {
      const sub = makeEntity(500 + i, 'SS', 'USSR', 70 + (i % 2), 44 + i, 100, 100, 5);
      sub.ally = false;
      return sub;
    });
    const state = makeState({
      tick: 32000,
      credits: 1500,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
        makeStructure(102, 'POWR', 'Greece', 33, 80),
        makeStructure(103, 'PROC', 'Greece', 26, 78),
        makeStructure(104, 'PROC', 'Greece', 24, 82),
        makeStructure(105, 'SYRD', 'Greece', 64, 87),
      ],
      units: [
        makeEntity(30, 'DD', 'Greece', 58, 96),
        makeEntity(31, 'DD', 'Greece', 60, 94),
      ],
      enemies,
      power: { produced: 200, consumed: 120 },
      buildable: { structures: [], units: [], infantry: [], vessels: ['DD'] },
    });

    const decision = strategy.decide(state);
    const rallyCmd = decision.commands.find(
      (c) => c.cmd === 'move' && c.cx === 70 && c.cy === 88,
    );
    const huntCmd = decision.commands.find((c) => c.cmd === 'attack_move');
    expect(rallyCmd).toBeDefined();
    expect(huntCmd).toBeUndefined();
    expect(decision.reason).toContain('rally fleet (2/3)');
  });

  it('keeps SCG11EA static AA locked until the minimum fleet is online', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const enemies = [
      ...Array.from({ length: 4 }, (_, i) => {
        const sub = makeEntity(800 + i, 'SS', 'USSR', 70 + (i % 2), 44 + i, 100, 100, 5);
        sub.ally = false;
        return sub;
      }),
      ...Array.from({ length: 2 }, (_, i) => {
        const yak = makeEntity(900 + i, 'YAK', 'USSR', 34 + i, 70 + i, 100, 100, 5);
        yak.ally = false;
        return yak;
      }),
    ];
    const state = makeState({
      tick: 33000,
      credits: 3000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
        makeStructure(102, 'POWR', 'Greece', 33, 80),
        makeStructure(103, 'PROC', 'Greece', 26, 78),
        makeStructure(104, 'PROC', 'Greece', 24, 82),
        makeStructure(105, 'SYRD', 'Greece', 64, 87),
      ],
      units: [
        makeEntity(30, '2TNK', 'Greece', 31, 84),
        makeEntity(31, '2TNK', 'Greece', 32, 84),
        makeEntity(32, '2TNK', 'Greece', 33, 84),
        makeEntity(33, '2TNK', 'Greece', 34, 84),
        makeEntity(40, 'DD', 'Greece', 67, 88),
        makeEntity(41, 'DD', 'Greece', 69, 88),
      ],
      enemies,
      power: { produced: 200, consumed: 120 },
      buildable: { structures: ['AGUN', 'DOME'], units: [], infantry: [], vessels: ['DD'] },
    });

    const decision = strategy.decide(state);
    const agunProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_BUILDINGTYPE && c.type_id === 9,
    );
    const domeProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_BUILDINGTYPE && c.type_id === 6,
    );
    expect(agunProd).toBeUndefined();
    expect(domeProd).toBeUndefined();
    expect(decision.reason).not.toContain('produce AGUN');
    expect(decision.reason).not.toContain('produce DOME');
  });

  it('builds SCG11EA shore turrets during the live sub hunt instead of deferring the second refinery under heavy pressure', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const enemies = [
      ...Array.from({ length: 6 }, (_, i) => {
        const sub = makeEntity(960 + i, 'SS', 'USSR', 70 + (i % 2), 40 + i, 100, 100, 5);
        sub.ally = false;
        return sub;
      }),
      ...Array.from({ length: 7 }, (_, i) => {
        const tank = makeEntity(980 + i, '3TNK', 'USSR', 31 + (i % 3), 76 + i, 100, 100, 5);
        tank.ally = false;
        return tank;
      }),
    ];
    const state = makeState({
      tick: 15000,
      credits: 3200,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
        makeStructure(102, 'POWR', 'Greece', 33, 80),
        makeStructure(103, 'PROC', 'Greece', 26, 78),
        makeStructure(104, 'SYRD', 'Greece', 64, 87),
      ],
      units: [
        makeEntity(40, 'DD', 'Greece', 67, 88),
        makeEntity(41, 'DD', 'Greece', 69, 88),
        makeEntity(42, 'DD', 'Greece', 71, 88),
      ],
      enemies,
      power: { produced: 200, consumed: 60 },
      buildable: { structures: ['FTUR', 'GUN', 'PROC'], units: [], infantry: [], vessels: ['DD'] },
    });

    const decision = strategy.decide(state);
    const fturProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_BUILDINGTYPE && c.type_id === 10,
    );
    expect(fturProd).toBeDefined();
    expect(decision.reason).toContain('produce FTUR');
    expect(decision.reason).not.toContain('defer PROC for fleet');
  });

  it('does not rebuild WEAP during the live sub hunt while destroyers are still afloat', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const enemies = [
      ...Array.from({ length: 4 }, (_, i) => {
        const sub = makeEntity(1000 + i, 'SS', 'USSR', 70 + (i % 2), 44 + i, 100, 100, 5);
        sub.ally = false;
        return sub;
      }),
      ...Array.from({ length: 3 }, (_, i) => {
        const tank = makeEntity(1100 + i, '3TNK', 'USSR', 34 + i, 80 + i, 100, 100, 5);
        tank.ally = false;
        return tank;
      }),
    ];
    const state = makeState({
      tick: 34000,
      credits: 2500,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
        makeStructure(102, 'PROC', 'Greece', 26, 78),
        makeStructure(103, 'PROC', 'Greece', 24, 82),
        makeStructure(104, 'SYRD', 'Greece', 64, 87),
      ],
      units: [
        makeEntity(10, '2TNK', 'Greece', 31, 84),
        makeEntity(11, '2TNK', 'Greece', 32, 84),
        makeEntity(20, 'DD', 'Greece', 67, 88),
        makeEntity(21, 'DD', 'Greece', 69, 88),
        makeEntity(22, 'DD', 'Greece', 71, 88),
      ],
      enemies,
      power: { produced: 200, consumed: 120 },
      buildable: { structures: ['WEAP'], units: ['2TNK'], infantry: [], vessels: ['DD'] },
    });

    const decision = strategy.decide(state);
    const weapProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_BUILDINGTYPE && c.type_id === 2,
    );
    expect(weapProd).toBeUndefined();
    expect(decision.reason).not.toContain('emergency rebuild WEAP');
  });

  it('defers slight power rebuilds and restarts DD production when the fleet is critically short', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const enemies = Array.from({ length: 16 }, (_, i) => {
      const sub = makeEntity(1200 + i, 'SS', 'USSR', 68 + (i % 3), 36 + i, 100, 100, 5);
      sub.ally = false;
      return sub;
    });
    const state = makeState({
      tick: 60000,
      credits: 50,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
        makeStructure(102, 'POWR', 'Greece', 33, 80),
        makeStructure(103, 'PROC', 'Greece', 26, 78),
        makeStructure(104, 'PROC', 'Greece', 24, 82),
        makeStructure(105, 'SYRD', 'Greece', 64, 87),
      ],
      units: [
        ...makeTankLine(10),
        makeEntity(20, 'DD', 'Greece', 67, 88),
      ],
      enemies,
      power: { produced: 114, consumed: 120 },
      buildable: { structures: ['APWR'], units: [], infantry: [], vessels: ['DD'] },
    });

    const decision = strategy.decide(state);
    const apwrProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_BUILDINGTYPE && c.type_id === 18,
    );
    const ddProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_VESSELTYPE,
    );
    expect(apwrProd).toBeUndefined();
    expect(ddProd).toBeDefined();
    expect(decision.reason).toContain('defer APWR for fleet');
    expect(decision.reason).toContain('produce DD');
  });

  it('defers second refinery rebuilds and keeps producing DD while subs are still live', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const enemies = Array.from({ length: 7 }, (_, i) => {
      const sub = makeEntity(1400 + i, 'SS', 'USSR', 68 + (i % 2), 40 + i, 100, 100, 5);
      sub.ally = false;
      return sub;
    });
    const state = makeState({
      tick: 65000,
      credits: 400,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
        makeStructure(102, 'POWR', 'Greece', 33, 80),
        makeStructure(103, 'PROC', 'Greece', 26, 78),
        makeStructure(104, 'SYRD', 'Greece', 64, 87),
      ],
      units: [
        ...makeTankLine(10),
        makeEntity(20, 'DD', 'Greece', 67, 88),
        makeEntity(21, 'DD', 'Greece', 68, 88),
        makeEntity(22, 'DD', 'Greece', 69, 88),
      ],
      enemies,
      power: { produced: 120, consumed: 90 },
      buildable: { structures: ['PROC'], units: [], infantry: [], vessels: ['DD'] },
    });

    const decision = strategy.decide(state);
    const procProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_BUILDINGTYPE && c.type_id === 12,
    );
    const ddProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_VESSELTYPE,
    );
    expect(procProd).toBeUndefined();
    expect(ddProd).toBeDefined();
    expect(decision.reason).toContain('defer PROC for fleet');
    expect(decision.reason).toContain('produce DD');
  });

  it('keeps SCG11EA in fleet-first mode at four DD while six subs remain', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const enemies = Array.from({ length: 6 }, (_, i) => {
      const sub = makeEntity(1500 + i, 'SS', 'USSR', 69 + (i % 2), 44 + i, 100, 100, 5);
      sub.ally = false;
      return sub;
    });
    const state = makeState({
      tick: 70000,
      credits: 600,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
        makeStructure(102, 'POWR', 'Greece', 33, 80),
        makeStructure(103, 'PROC', 'Greece', 26, 78),
        makeStructure(104, 'SYRD', 'Greece', 64, 87),
      ],
      units: [
        ...makeTankLine(20),
        makeEntity(10, 'DD', 'Greece', 66, 87),
        makeEntity(11, 'DD', 'Greece', 67, 87),
        makeEntity(12, 'DD', 'Greece', 68, 87),
        makeEntity(13, 'DD', 'Greece', 69, 87),
      ],
      enemies,
      power: { produced: 120, consumed: 90 },
      buildable: { structures: ['PROC'], units: [], infantry: [], vessels: ['DD'] },
    });

    const decision = strategy.decide(state);
    const procProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_BUILDINGTYPE && c.type_id === 12,
    );
    const ddProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_VESSELTYPE,
    );
    expect(procProd).toBeUndefined();
    expect(ddProd).toBeDefined();
    expect(decision.reason).toContain('defer PROC for fleet');
    expect(decision.reason).toContain('produce DD');
  });

  it('does not start fresh tanks during live SCG11EA sub-hunt once the island hold is online', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const enemies = Array.from({ length: 5 }, (_, i) => {
      const sub = makeEntity(1600 + i, 'SS', 'USSR', 70 + (i % 2), 46 + i, 100, 100, 5);
      sub.ally = false;
      return sub;
    });
    const state = makeState({
      tick: 72000,
      credits: 900,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
        makeStructure(102, 'POWR', 'Greece', 33, 80),
        makeStructure(103, 'PROC', 'Greece', 26, 78),
        makeStructure(104, 'SYRD', 'Greece', 64, 87),
        makeStructure(105, 'WEAP', 'Greece', 32, 76),
      ],
      units: [
        ...makeTankLine(10),
        makeEntity(20, 'DD', 'Greece', 66, 87),
        makeEntity(21, 'DD', 'Greece', 67, 87),
        makeEntity(22, 'DD', 'Greece', 68, 87),
      ],
      enemies,
      power: { produced: 200, consumed: 90 },
      buildable: { structures: ['PROC'], units: ['2TNK'], infantry: [], vessels: ['DD'] },
    });

    const decision = strategy.decide(state);
    const tankProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_UNITTYPE,
    );
    const ddProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_VESSELTYPE,
    );
    expect(tankProd).toBeUndefined();
    expect(ddProd).toBeDefined();
    expect(decision.reason).toContain('defer PROC for fleet');
    expect(decision.reason).toContain('produce DD');
  });

  it('keeps mild SCG11EA base pressure fleet-first once the island hold is online', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const enemies = [
      ...Array.from({ length: 5 }, (_, i) => {
        const sub = makeEntity(1650 + i, 'SS', 'USSR', 70 + (i % 2), 46 + i, 100, 100, 5);
        sub.ally = false;
        return sub;
      }),
      (() => {
        const tank = makeEntity(1700, '3TNK', 'USSR', 34, 82, 100, 100, 5);
        tank.ally = false;
        return tank;
      })(),
    ];
    const state = makeState({
      tick: 73000,
      credits: 900,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
        makeStructure(102, 'POWR', 'Greece', 33, 80),
        makeStructure(103, 'PROC', 'Greece', 26, 78),
        makeStructure(104, 'SYRD', 'Greece', 64, 87),
        makeStructure(105, 'WEAP', 'Greece', 32, 76),
      ],
      units: [
        ...makeTankLine(10),
        makeEntity(20, 'DD', 'Greece', 66, 87),
        makeEntity(21, 'DD', 'Greece', 67, 87),
        makeEntity(22, 'DD', 'Greece', 68, 87),
      ],
      enemies,
      power: { produced: 200, consumed: 90 },
      buildable: { structures: ['PROC'], units: ['2TNK'], infantry: [], vessels: ['DD'] },
    });

    const decision = strategy.decide(state);
    const tankProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_UNITTYPE,
    );
    const ddProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_VESSELTYPE,
    );
    expect(tankProd).toBeUndefined();
    expect(ddProd).toBeDefined();
    expect(decision.reason).toContain('defer PROC for fleet');
    expect(decision.reason).toContain('produce DD');
  });

  it('keeps SCG11EA fleet-first when only light local pressure remains and the island hold is online', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const enemies = [
      ...Array.from({ length: 6 }, (_, i) => {
        const sub = makeEntity(1750 + i, 'SS', 'USSR', 70 + (i % 2), 46 + i, 100, 100, 5);
        sub.ally = false;
        return sub;
      }),
      (() => {
        const tank = makeEntity(1800, '3TNK', 'USSR', 34, 82, 100, 100, 5);
        tank.ally = false;
        return tank;
      })(),
      (() => {
        const tank = makeEntity(1801, '3TNK', 'USSR', 36, 83, 100, 100, 5);
        tank.ally = false;
        return tank;
      })(),
    ];
    const state = makeState({
      tick: 74000,
      credits: 1000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
        makeStructure(102, 'POWR', 'Greece', 33, 80),
        makeStructure(103, 'PROC', 'Greece', 26, 78),
        makeStructure(104, 'SYRD', 'Greece', 64, 87),
        makeStructure(105, 'WEAP', 'Greece', 32, 76),
      ],
      units: [
        ...makeTankLine(10),
        makeEntity(20, 'DD', 'Greece', 66, 87),
        makeEntity(21, 'DD', 'Greece', 67, 87),
        makeEntity(22, 'DD', 'Greece', 68, 87),
      ],
      enemies,
      power: { produced: 200, consumed: 90 },
      buildable: { structures: ['PROC'], units: ['2TNK'], infantry: [], vessels: ['DD'] },
    });

    const decision = strategy.decide(state);
    const tankProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_UNITTYPE,
    );
    const ddProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_VESSELTYPE,
    );
    expect(tankProd).toBeUndefined();
    expect(ddProd).toBeDefined();
    expect(decision.reason).toContain('defer PROC for fleet');
    expect(decision.reason).toContain('produce DD');
  });

  it('keeps SCG11EA destroyers out of the generic outgunned scout loop', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const enemies = [
      ...Array.from({ length: 6 }, (_, i) => {
        const sub = makeEntity(1700 + i, 'SS', 'USSR', 70 + (i % 2), 44 + i, 100, 100, 5);
        sub.ally = false;
        return sub;
      }),
      ...Array.from({ length: 8 }, (_, i) => {
        const tank = makeEntity(1800 + i, '4TNK', 'USSR', 40 + i, 70, 100, 100, 5);
        tank.ally = false;
        return tank;
      }),
    ];
    const state = makeState({
      tick: 76000,
      credits: 0,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'PROC', 'Greece', 26, 78),
        makeStructure(102, 'SYRD', 'Greece', 64, 87),
      ],
      units: [
        makeEntity(20, 'DD', 'Greece', 66, 87),
        makeEntity(21, 'DD', 'Greece', 67, 87),
      ],
      enemies,
      power: { produced: 200, consumed: 90 },
      buildable: { structures: ['PROC'], units: [], infantry: [], vessels: ['DD'] },
    });

    const decision = strategy.decide(state);
    expect(decision.reason).not.toContain('scout DD');
    expect(decision.reason).toContain('rally fleet');
  });

  it('does not send damaged SCG11EA destroyers through the generic retreat-to-base path', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const enemies = Array.from({ length: 6 }, (_, i) => {
      const sub = makeEntity(1900 + i, 'SS', 'USSR', 70 + (i % 2), 44 + i, 100, 100, 5);
      sub.ally = false;
      return sub;
    });
    const dd1 = makeEntity(30, 'DD', 'Greece', 66, 87);
    dd1.hp = 20;
    dd1.mhp = 100;
    const dd2 = makeEntity(31, 'DD', 'Greece', 67, 87);
    dd2.hp = 30;
    dd2.mhp = 100;
    const state = makeState({
      tick: 78000,
      credits: 0,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'PROC', 'Greece', 26, 78),
        makeStructure(102, 'SYRD', 'Greece', 64, 87),
      ],
      units: [dd1, dd2],
      enemies,
      power: { produced: 200, consumed: 90 },
      buildable: { structures: ['PROC'], units: [], infantry: [], vessels: ['DD'] },
    });

    const decision = strategy.decide(state);
    expect(decision.reason).not.toContain('retreat');
    expect(decision.reason).toContain('rally fleet');
  });

  it('rebuilds SCG11EA shipyard from one refinery when a fleet is still alive', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const enemies = Array.from({ length: 4 }, (_, i) => {
      const sub = makeEntity(2000 + i, 'SS', 'USSR', 70 + (i % 2), 46 + i, 100, 100, 5);
      sub.ally = false;
      return sub;
    });
    const state = makeState({
      tick: 82000,
      credits: 2500,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'PROC', 'Greece', 26, 78),
        makeStructure(102, 'WEAP', 'Greece', 32, 76),
      ],
      units: [
        makeEntity(20, 'DD', 'Greece', 66, 87),
        makeEntity(21, 'DD', 'Greece', 67, 87),
      ],
      enemies,
      power: { produced: 200, consumed: 60 },
      buildable: { structures: ['SYRD', 'PROC'], units: ['2TNK'], infantry: [], vessels: ['DD'] },
    });

    strategy['scg11eaNavalUnlocked'] = true;
    strategy['scg11eaCoastRevealed'] = true;
    const decision = strategy.decide(state);
    const buildProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(buildProd).toBeDefined();
    expect(buildProd!.type_id).toBe(27);
    expect(decision.reason).toContain('rebuild SYRD for sub hunt');
  });
});

// ═══════════════════════════════════════════════════════════
// Build Order — Structure Production
// ═══════════════════════════════════════════════════════════

describe('base building — build order', () => {
  it('produces POWR first when ConYard exists and nothing in production', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 89, 52)],
      power: { produced: 0, consumed: 0 },
      buildable: { structures: ['POWR', 'SBAG'], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    const prodCmd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(prodCmd).toBeDefined();
    expect(prodCmd!.type_id).toBe(17); // STRUCT_POWER
    expect(decision.reason).toContain('produce POWR');
  });

  it('produces PROC when POWR already exists (refinery before barracks)', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      structures: [
        makeStructure(100, 'FACT', 'Greece', 89, 52),
        makeStructure(101, 'POWR', 'Greece', 86, 52),
      ],
      power: { produced: 100, consumed: 0 },
      buildable: { structures: ['PROC', 'POWR', 'TENT', 'SBAG'], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    const prodCmd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(prodCmd).toBeDefined();
    expect(prodCmd!.type_id).toBe(12); // STRUCT_REFINERY
    expect(decision.reason).toContain('produce PROC');
  });

  it('produces BARR after POWR and PROC exist (Soviet barracks preferred)', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      structures: [
        makeStructure(100, 'FACT', 'Greece', 89, 52),
        makeStructure(101, 'POWR', 'Greece', 86, 52),
        makeStructure(102, 'PROC', 'Greece', 92, 52),
      ],
      power: { produced: 100, consumed: 40 },
      buildable: { structures: ['BARR', 'SBAG'], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    const prodCmd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(prodCmd).toBeDefined();
    expect(prodCmd!.type_id).toBe(21); // STRUCT_BARRACKS
    expect(decision.reason).toContain('produce BARR');
  });

  it('places completed building near ConYard', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 89, 52)],
      power: { produced: 0, consumed: 0 },
      production: [{ t: 'POWR', prog: 54, rtti: RTTI_BUILDINGTYPE, done: true }],
      buildable: { structures: ['POWR'], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    const placeCmd = decision.commands.find(
      (c) => c.cmd === 'place' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(placeCmd).toBeDefined();
    expect(typeof placeCmd!.cx).toBe('number');
    expect(typeof placeCmd!.cy).toBe('number');
    expect(decision.reason).toContain('place POWR');
  });

  it('does not produce when something is already building', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 89, 52)],
      power: { produced: 0, consumed: 0 },
      production: [{ t: 'POWR', prog: 25, rtti: RTTI_BUILDINGTYPE, done: false }],
      buildable: { structures: ['POWR', 'TENT'], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    const prodCmd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(prodCmd).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════
// Unit & Infantry Production
// ═══════════════════════════════════════════════════════════

describe('base building — unit production', () => {
  it('produces tanks when War Factory exists and credits sufficient', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      credits: 2000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 89, 52),
        makeStructure(101, 'POWR', 'Greece', 86, 52),
        makeStructure(102, 'TENT', 'Greece', 89, 55),
        makeStructure(103, 'PROC', 'Greece', 92, 52),
        makeStructure(104, 'WEAP', 'Greece', 86, 55),
      ],
      units: [
        makeEntity(10, 'HARV', 'Greece', 90, 55),
        makeEntity(11, 'HARV', 'Greece', 91, 55),
      ],
      power: { produced: 100, consumed: 60 },
      buildable: {
        structures: ['POWR'],
        units: ['3TNK', '2TNK', '1TNK', 'HARV'],
        infantry: ['E1', 'E3'],
      },
    });

    const decision = strategy.decide(state);
    const unitProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_UNITTYPE,
    );
    expect(unitProd).toBeDefined();
    // Should prefer 3TNK (Heavy/Mammoth tank) over lighter options
    expect(unitProd!.type_id).toBe(1); // UNIT_MTANK = 3TNK
    expect(decision.reason).toContain('produce 3TNK');
  });

  it('produces infantry when Barracks exists', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      credits: 2000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 89, 52),
        makeStructure(101, 'POWR', 'Greece', 86, 52),
        makeStructure(102, 'TENT', 'Greece', 89, 55),
        makeStructure(103, 'PROC', 'Greece', 92, 52),
        makeStructure(104, 'WEAP', 'Greece', 86, 55),
      ],
      power: { produced: 100, consumed: 60 },
      buildable: {
        structures: ['POWR'],
        units: ['1TNK'],
        infantry: ['E1', 'E3'],
      },
    });

    const decision = strategy.decide(state);
    const infProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_INFANTRYTYPE,
    );
    expect(infProd).toBeDefined();
    // Should prefer E3 (rocket) over E1 (rifle)
    expect(infProd!.type_id).toBe(2); // INFANTRY_E3
    expect(decision.reason).toContain('produce E3');
  });

  it('exits completed units with place command (no cx/cy)', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      credits: 2000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 89, 52),
        makeStructure(101, 'WEAP', 'Greece', 86, 55),
      ],
      power: { produced: 100, consumed: 30 },
      production: [
        { t: '3TNK', prog: 100, rtti: RTTI_UNITTYPE, done: true },
      ],
      buildable: { structures: [], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    const placeCmd = decision.commands.find(
      (c) => c.cmd === 'place' && c.rtti === RTTI_UNITTYPE,
    );
    expect(placeCmd).toBeDefined();
    // Units exit via Place_Object with cell=-1, so no cx/cy needed
    expect(placeCmd!.cx).toBeUndefined();
    expect(decision.reason).toContain('exit 3TNK');
  });
});

// ═══════════════════════════════════════════════════════════
// Combat Splitting
// ═══════════════════════════════════════════════════════════

describe('base building — combat', () => {
  it('keeps defenders near base when threats present', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      structures: [
        makeStructure(100, 'FACT', 'Greece', 89, 52),
        makeStructure(101, 'POWR', 'Greece', 86, 52),
        makeStructure(102, 'TENT', 'Greece', 89, 55),
        makeStructure(103, 'PROC', 'Greece', 92, 52),
        makeStructure(104, 'WEAP', 'Greece', 86, 55),
      ],
      units: [
        makeEntity(1, 'E3', 'Greece', 88, 53),
        makeEntity(2, 'E3', 'Greece', 90, 53),
        makeEntity(3, 'E3', 'Greece', 87, 54),
        makeEntity(4, '3TNK', 'Greece', 85, 50),
        makeEntity(5, '3TNK', 'Greece', 86, 50),
      ],
      enemies: [
        { ...makeEntity(50, 'E2', 'USSR', 85, 50), ally: false },
      ],
      power: { produced: 100, consumed: 60 },
      buildable: { structures: [], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    // Should have defender commands (attack with target via micro-management) for some units
    const defenderCmd = decision.commands.find(
      (c) => c.cmd === 'attack' || c.cmd === 'attack_move',
    );
    expect(defenderCmd).toBeDefined();
    expect(decision.reason).toContain('defend base');
  });

  it('filters non-combat units from attack orders', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 89, 52)],
      units: [
        makeEntity(1, 'HARV', 'Greece', 88, 53),
        makeEntity(2, 'MCV', 'Greece', 90, 53),
      ],
      enemies: [
        { ...makeEntity(50, 'E2', 'USSR', 85, 50), ally: false },
      ],
      power: { produced: 100, consumed: 0 },
      buildable: { structures: [], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    // HARV and MCV should not appear in any attack_move command IDs
    const attackCmds = decision.commands.filter(
      (c) => c.cmd === 'attack_move' || c.cmd === 'attack',
    );
    for (const cmd of attackCmds) {
      const ids = cmd.ids as number[] | undefined;
      if (ids) {
        expect(ids).not.toContain(1); // HARV
        expect(ids).not.toContain(2); // MCV
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════
// Generic fallback — no MCV/ConYard
// ═══════════════════════════════════════════════════════════

describe('base building — fallback to generic', () => {
  it('falls back to generic combat when no MCV and no ConYard', () => {
    const strategy = new OracleStrategy('SCG04EA');
    // Give friendly units clear force advantage (1.5x) so they attack
    // tick > 1500 to bypass early-game holding pattern
    const state = makeState({
      tick: 2000,
      units: [
        makeEntity(1, 'E1', 'Greece', 50, 50),
        makeEntity(2, 'E1', 'Greece', 51, 50),
        makeEntity(3, 'E1', 'Greece', 52, 50),
      ],
      enemies: [
        { ...makeEntity(50, 'E2', 'USSR', 55, 55), ally: false },
      ],
    });

    const decision = strategy.decide(state);
    // With micro-management, attack commands use 'attack' (with target) instead of 'attack_move'
    const attackCmd = decision.commands.find(
      (c) => c.cmd === 'attack' || c.cmd === 'attack_move',
    );
    expect(attackCmd).toBeDefined();
    expect(decision.reason).toContain('attack');
  });
});

// ═══════════════════════════════════════════════════════════
// Summarize includes production info
// ═══════════════════════════════════════════════════════════

describe('summarize', () => {
  it('includes production items in summary', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      production: [
        { t: 'POWR', prog: 42, rtti: RTTI_BUILDINGTYPE, done: false },
        { t: 'E3', prog: 80, rtti: RTTI_INFANTRYTYPE, done: false },
      ],
    });

    const summary = strategy.summarize(state, 10, { commands: [], reason: 'test' });
    expect(summary).toContain('POWR:42%');
    expect(summary).toContain('E3:80%');
  });

  it('marks completed production with asterisk', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      production: [
        { t: 'TENT', prog: 54, rtti: RTTI_BUILDINGTYPE, done: true },
      ],
    });

    const summary = strategy.summarize(state, 5, { commands: [], reason: 'test' });
    expect(summary).toContain('TENT:54%*');
  });
});

// ═══════════════════════════════════════════════════════════
// SYRD Placement — uses enemy vessels to find water
// ═══════════════════════════════════════════════════════════

describe('SYRD placement — vessel-based water detection', () => {
  it('places SYRD near enemy submarine positions using coastal cells', () => {
    // Use SCG07EA which has no mission-specific handler — it routes through
    // the generic decideBaseBuilding path with coastal cells at cx=52,50,54.
    const strategy = new OracleStrategy('SCG07EA');
    // Subs are on the EAST side of the map at x=67-72
    const state = makeState({
      tick: 8000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 26, 50),
        makeStructure(101, 'POWR', 'Greece', 24, 50),
      ],
      production: [{ t: 'SYRD', prog: 54, rtti: RTTI_BUILDINGTYPE, done: true }],
      buildable: { structures: ['SYRD'], units: [], infantry: [] },
      enemies: [
        makeEntity(200, 'SS', 'USSR', 67, 42, 100, 100, 5),
        makeEntity(201, 'SS', 'USSR', 72, 97, 100, 100, 5),
        makeEntity(202, 'SS', 'USSR', 68, 31, 100, 100, 5),
      ],
    });
    // Mark enemies as non-ally
    state.enemies.forEach((e) => { e.ally = false; });

    const decision = strategy.decide(state);
    const placeCmd = decision.commands.find(
      (c) => c.cmd === 'place' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(placeCmd).toBeDefined();
    // SCG07EA coastal cells are around cx=48-56, cy=47-60 — well east of base (x=26)
    expect(placeCmd!.cx).toBeGreaterThan(35);
  });

  it('dispatches water scout when naval enemies detected', () => {
    // Use SCG07EA — generic path dispatches tank as water scout
    const strategy = new OracleStrategy('SCG07EA');
    const state = makeState({
      tick: 500,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 26, 50),
        makeStructure(101, 'POWR', 'Greece', 24, 50),
        makeStructure(102, 'WEAP', 'Greece', 28, 50),
      ],
      units: [
        makeEntity(10, '2TNK', 'Greece', 27, 49),
      ],
      enemies: [
        makeEntity(200, 'SS', 'USSR', 67, 42, 100, 100, 5),
      ],
      buildable: { structures: [], units: ['2TNK'], infantry: [] },
    });
    state.enemies.forEach((e) => { e.ally = false; });

    const decision = strategy.decide(state);
    const moveCmd = decision.commands.find(
      (c) => c.cmd === 'move' && c.ids?.includes(10),
    );
    // Should send the tank to scout toward the water (east, toward subs)
    expect(moveCmd).toBeDefined();
    expect(moveCmd!.cx).toBeGreaterThan(40); // heading east toward water
  });

  it('re-dispatches scout if original scout is destroyed', () => {
    // Use SCG07EA — generic path handles scout re-dispatch
    const strategy = new OracleStrategy('SCG07EA');
    const sub = makeEntity(200, 'SS', 'USSR', 67, 42, 100, 100, 5);
    sub.ally = false;

    // First call: scout dispatched (tank id=10)
    const state1 = makeState({
      tick: 500,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 26, 50),
        makeStructure(101, 'WEAP', 'Greece', 28, 50),
      ],
      units: [makeEntity(10, '2TNK', 'Greece', 27, 49)],
      enemies: [sub],
      buildable: { structures: [], units: ['2TNK'], infantry: [] },
    });
    strategy.decide(state1);

    // Second call: scout tank destroyed (id=10 gone), new tank available (id=11)
    const state2 = makeState({
      tick: 1000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 26, 50),
        makeStructure(101, 'WEAP', 'Greece', 28, 50),
      ],
      units: [makeEntity(11, '2TNK', 'Greece', 27, 49)],
      enemies: [sub],
      buildable: { structures: [], units: ['2TNK'], infantry: [] },
    });
    const decision2 = strategy.decide(state2);
    const moveCmd = decision2.commands.find(
      (c) => c.cmd === 'move' && c.ids?.includes(11),
    );
    expect(moveCmd).toBeDefined();
    expect(moveCmd!.cx).toBeGreaterThan(40);
  });

  it('falls back to hardcoded coastal cells when no enemy vessels present', () => {
    // Use SCG07EA — coastal cells are at cx=52,50,54 (east of base)
    const strategy = new OracleStrategy('SCG07EA');
    const state = makeState({
      tick: 8000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 26, 50),
      ],
      production: [{ t: 'SYRD', prog: 54, rtti: RTTI_BUILDINGTYPE, done: true }],
      buildable: { structures: ['SYRD'], units: [], infantry: [] },
      enemies: [], // No vessels
    });

    const decision = strategy.decide(state);
    const placeCmd = decision.commands.find(
      (c) => c.cmd === 'place' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(placeCmd).toBeDefined();
    // Without vessels, falls back to hardcoded coastal cells for SCG07EA
    // which are around cx=48-56, cy=47-60
    expect(placeCmd!.cx).toBeGreaterThan(44);
    expect(placeCmd!.cy).toBeGreaterThan(44);
  });

  it('keeps SCG11EA refineries biased toward the ore field instead of the east chain', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const state = makeState({
      tick: 8000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
      ],
      production: [{ t: 'PROC', prog: 54, rtti: RTTI_BUILDINGTYPE, done: true }],
      buildable: { structures: ['PROC', 'POWR', 'WEAP', 'SYRD'], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    const placeCmd = decision.commands.find(
      (c) => c.cmd === 'place' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(placeCmd).toBeDefined();
    expect(placeCmd!.cy).toBeLessThan(80);
    expect(placeCmd!.cx).toBeLessThan(40);
  });

  it('keeps SCG11EA power placement local instead of forcing an east chain', () => {
    const strategy = new OracleStrategy('SCG11EA');

    const bootstrapDecision = strategy.decide(makeState({
      tick: 400,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
      ],
      production: [{ t: 'POWR', prog: 54, rtti: RTTI_BUILDINGTYPE, done: true }],
      buildable: { structures: ['POWR', 'PROC'], units: [], infantry: [] },
    }));

    const bootstrapPlace = bootstrapDecision.commands.find(
      (c) => c.cmd === 'place' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(bootstrapPlace).toBeDefined();
    expect(bootstrapPlace!.cx).toBeGreaterThanOrEqual(25);
    expect(bootstrapPlace!.cx).toBeLessThanOrEqual(35);
    expect(bootstrapPlace!.cy).toBeGreaterThanOrEqual(75);
    expect(bootstrapPlace!.cy).toBeLessThanOrEqual(83);

    const localPowerDecision = strategy.decide(makeState({
      tick: 8000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 33, 80),
        makeStructure(102, 'PROC', 'Greece', 26, 80),
        makeStructure(103, 'WEAP', 'Greece', 32, 76),
      ],
      production: [{ t: 'POWR', prog: 54, rtti: RTTI_BUILDINGTYPE, done: true }],
      buildable: { structures: ['POWR', 'SYRD'], units: [], infantry: [] },
    }));

    const localPowerPlace = localPowerDecision.commands.find(
      (c) => c.cmd === 'place' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(localPowerPlace).toBeDefined();
    expect(localPowerPlace!.cx).toBeGreaterThanOrEqual(25);
    expect(localPowerPlace!.cx).toBeLessThanOrEqual(35);
    expect(localPowerPlace!.cy).toBeGreaterThanOrEqual(75);
    expect(localPowerPlace!.cy).toBeLessThanOrEqual(83);
  });

  it('pins SCG11EA shipyard placement to the east-ocean water anchors', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const state = makeState({
      tick: 8000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
      ],
      production: [{ t: 'SYRD', prog: 54, rtti: RTTI_BUILDINGTYPE, done: true }],
      buildable: { structures: ['SYRD'], units: [], infantry: [] },
      enemies: [
        makeEntity(200, 'SS', 'USSR', 70, 42, 100, 100, 5),
      ],
    });
    state.enemies.forEach((e) => { e.ally = false; });

    const decision = strategy.decide(state);
    const placeCmd = decision.commands.find(
      (c) => c.cmd === 'place' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(placeCmd).toBeDefined();
    expect(placeCmd!.cx).toBeGreaterThanOrEqual(63);
    expect(placeCmd!.cx).toBeLessThanOrEqual(65);
    expect(placeCmd!.cy).toBeGreaterThanOrEqual(83);
    expect(placeCmd!.cy).toBeLessThanOrEqual(90);
  });

  it('pins SCG11EA shore defenses beside the shipyard corridor instead of the starting ConYard', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const state = makeState({
      tick: 18000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
        makeStructure(102, 'PROC', 'Greece', 26, 80),
        makeStructure(103, 'PROC', 'Greece', 24, 84),
        makeStructure(104, 'SYRD', 'Greece', 64, 87),
      ],
      production: [{ t: 'AGUN', prog: 54, rtti: RTTI_BUILDINGTYPE, done: true }],
      buildable: { structures: ['AGUN', 'DOME', 'PROC'], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    const placeCmd = decision.commands.find(
      (c) => c.cmd === 'place' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(placeCmd).toBeDefined();
    expect(placeCmd!.cx).toBeGreaterThanOrEqual(56);
    expect(placeCmd!.cy).toBeGreaterThanOrEqual(86);
  });

  it('places a completed SCG11EA refinery instead of suppressing it behind shipyard macro', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const state = makeState({
      tick: 18000,
      credits: 6000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
        makeStructure(102, 'POWR', 'Greece', 33, 80),
        makeStructure(103, 'PROC', 'Greece', 26, 78),
        makeStructure(104, 'SYRD', 'Greece', 64, 87),
      ],
      production: [{ t: 'PROC', prog: 54, rtti: RTTI_BUILDINGTYPE, done: true }],
      buildable: { structures: ['PROC', 'POWR'], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    const placeCmd = decision.commands.find(
      (c) => c.cmd === 'place' && c.rtti === RTTI_BUILDINGTYPE,
    );
    const prodCmd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(placeCmd).toBeDefined();
    expect(prodCmd).toBeUndefined();
    expect(decision.reason).toContain('place PROC');
  });

  it('rushes SCG11EA shipyard after the local bootstrap instead of adding more ground macro', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const state = makeState({
      tick: 12000,
      credits: 2500,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
        makeStructure(102, 'POWR', 'Greece', 33, 80),
        makeStructure(103, 'PROC', 'Greece', 26, 78),
        makeStructure(104, 'PROC', 'Greece', 24, 82),
        makeStructure(105, 'WEAP', 'Greece', 32, 76),
      ],
      units: [
        makeEntity(10, '2TNK', 'Greece', 60, 89),
      ],
      power: { produced: 200, consumed: 90 },
      buildable: { structures: ['SYRD', 'SPEN', 'POWR'], units: ['2TNK'], infantry: [] },
    });

    const decision = strategy.decide(state);
    const prodCmd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(prodCmd).toBeDefined();
    expect(prodCmd!.type_id).toBe(27); // STRUCT_SHIPYARD
    expect(decision.reason).toContain('produce SYRD');
  });

  it('does not drain SCG11EA shipyard funding into extra tanks once the beachhead is stable', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const state = makeState({
      tick: 12500,
      credits: 2500,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
        makeStructure(102, 'POWR', 'Greece', 33, 80),
        makeStructure(103, 'PROC', 'Greece', 26, 78),
        makeStructure(104, 'PROC', 'Greece', 24, 82),
        makeStructure(105, 'WEAP', 'Greece', 32, 76),
      ],
      units: [
        makeEntity(10, '2TNK', 'Greece', 30, 84),
        makeEntity(11, '2TNK', 'Greece', 31, 84),
        makeEntity(12, '2TNK', 'Greece', 32, 84),
        makeEntity(13, '2TNK', 'Greece', 33, 84),
        makeEntity(14, '2TNK', 'Greece', 34, 84),
        makeEntity(15, '2TNK', 'Greece', 35, 84),
        makeEntity(16, '2TNK', 'Greece', 36, 84),
        makeEntity(17, '2TNK', 'Greece', 37, 84),
      ],
      enemies: [
        (() => {
          const sub = makeEntity(200, 'SS', 'USSR', 70, 42, 100, 100, 5);
          sub.ally = false;
          return sub;
        })(),
      ],
      production: [{ t: 'SYRD', prog: 40, rtti: RTTI_BUILDINGTYPE, done: false }],
      power: { produced: 200, consumed: 90 },
      buildable: { structures: ['POWR'], units: ['2TNK'], infantry: [] },
    });

    const decision = strategy.decide(state);
    const unitProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_UNITTYPE,
    );
    expect(unitProd).toBeUndefined();
  });

  it('does not send SCG11EA assault orders over active base defense', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const baseThreat = makeEntity(300, '3TNK', 'USSR', 34, 82, 100, 100, 5);
    baseThreat.ally = false;
    const islandWeap = makeStructure(400, 'WEAP', 'USSR', 52, 45, false);
    const state = makeState({
      tick: 18000,
      credits: 2000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
        makeStructure(102, 'POWR', 'Greece', 33, 80),
        makeStructure(103, 'PROC', 'Greece', 26, 78),
        makeStructure(104, 'PROC', 'Greece', 24, 82),
        makeStructure(105, 'WEAP', 'Greece', 32, 76),
        makeStructure(106, 'SYRD', 'Greece', 64, 87),
        islandWeap,
      ],
      units: Array.from({ length: 12 }, (_, i) =>
        makeEntity(10 + i, '2TNK', 'Greece', 29 + (i % 4), 84 + Math.floor(i / 4)),
      ),
      enemies: [baseThreat],
      power: { produced: 200, consumed: 120 },
      buildable: { structures: [], units: ['2TNK'], infantry: [], vessels: ['DD'] },
    });

    const decision = strategy.decide(state);
    expect(decision.reason).toContain('defend base');
    expect(decision.reason).toContain('hold armor');
    expect(decision.reason).not.toContain('assault march');
    expect(decision.reason).not.toContain('assault kill');
    expect(decision.reason).not.toContain('assault raze');
  });

  it('keeps a home reserve when SCG11EA sends armor north for the island assault', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const islandWeap = makeStructure(400, 'WEAP', 'USSR', 52, 45, false);
    const state = makeState({
      tick: 18000,
      credits: 2000,
      units: Array.from({ length: 16 }, (_, i) =>
        makeEntity(10 + i, '2TNK', 'Greece', 29 + (i % 4), 84 + Math.floor(i / 4)),
      ),
      enemies: [],
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
        makeStructure(102, 'POWR', 'Greece', 33, 80),
        makeStructure(103, 'PROC', 'Greece', 26, 78),
        makeStructure(104, 'PROC', 'Greece', 24, 82),
        makeStructure(105, 'WEAP', 'Greece', 32, 76),
        makeStructure(106, 'SYRD', 'Greece', 64, 87),
        islandWeap,
      ],
      power: { produced: 200, consumed: 90 },
      buildable: { structures: [], units: ['2TNK'], infantry: [] },
    });

    const decision = strategy.decide(state);
    const assaultMove = decision.commands.find(
      (c) => c.cmd === 'move' && c.cx === 45 && c.cy === 65,
    );
    expect(assaultMove).toBeDefined();
    expect(Array.isArray(assaultMove!.ids)).toBe(true);
    expect((assaultMove!.ids as number[]).length).toBe(10);
    expect(decision.reason).toContain('assault march (10');
  });
});
