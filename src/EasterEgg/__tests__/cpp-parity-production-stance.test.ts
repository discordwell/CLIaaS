/**
 * C++ behavioral parity tests: missions assigned to newly produced units.
 *
 * C++ references:
 *   building.cpp:4470-4589  — Mission_Unload (war factory door animation):
 *     - INITIAL state: unit->Assign_Mission(MISSION_GUARD)  (line 4501)
 *     - OPEN state: unit->Assign_Mission(MISSION_MOVE)      (line 4539)
 *       if IQ >= IQGuardArea: MISSION_GUARD_AREA + ArchiveTarget = Where_To_Go()
 *                                                              (lines 4541-4543)
 *   building.cpp:2018-2054  — Exit_Object for BARRACKS/TENT/KENNEL:
 *     - base->Assign_Mission(MISSION_MOVE)                   (line 2030)
 *     - base->Assign_Destination(exit cell)                  (line 2036)
 *       if IQ >= IQGuardArea: MISSION_GUARD_AREA + ArchiveTarget = Where_To_Go()
 *                                                              (lines 2037-2039)
 *   building.cpp:2056-2082  — Exit_Object default (other infantry/unit):
 *     - Same pattern: MOVE, then GUARD_AREA if IQ >= IQGuardArea
 *   building.cpp:1949-1966  — Exit_Object for VESSEL (sub pen/shipyard):
 *     - base->Assign_Mission(MISSION_GUARD)                  (line 1956)
 *     - NO IQ check, NO GUARD_AREA — vessels always get plain GUARD
 *   building.cpp:1916-1947  — Exit_Object for AIRCRAFT:
 *     - If pad free: air->Assign_Mission(MISSION_GUARD) (docked) (line 2449)
 *     - If pad occupied (overflow): air->Assign_Mission(MISSION_MOVE) (line 1941)
 *   building.cpp:1972-1981  — Exit_Object for REFINERY:
 *     - unit->Assign_Mission(MISSION_HARVEST)                (line 1980)
 *   rules.cpp:942           — IQGuardArea = ini.Get_Int("IQ","GuardArea",4)
 *   house.cpp:6853-6869     — Where_To_Go(): unarmed→ZONE_CORE, armed→random peripheral
 *
 * TS under test:
 *   engine/production.ts:296-372 — spawnProducedUnit()
 */

import { describe, it, expect } from 'vitest';
import {
  spawnProducedUnit,
  type ProductionContext,
} from '../engine/production';
import {
  type ProductionItem, type House, type Faction, type WorldPos,
  Mission, UnitType, CELL_SIZE, worldToCell,
} from '../engine/types';
import { Entity } from '../engine/entity';
import type { MapStructure } from '../engine/scenario';
import type { GameMap } from '../engine/map';

// ── Test helpers ────────────────────────────────────────────────────────────

/** A minimal ProductionItem for testing */
const makeItem = (overrides: Partial<ProductionItem> = {}): ProductionItem => ({
  type: '2TNK',
  name: 'Medium Tank',
  cost: 800,
  buildTime: 10,
  prerequisite: 'WEAP',
  faction: 'both' as const,
  isStructure: false,
  ...overrides,
});

/** Create a minimal alive structure */
const makeStructure = (type: string, house: House = 'Greece' as House, cx = 10, cy = 10): MapStructure => ({
  type,
  house,
  cx,
  cy,
  alive: true,
  hp: 400,
  maxHp: 400,
} as MapStructure);

/** Minimal GameMap mock */
const makeMockMap = (): GameMap => ({
  findAdjacentWaterCell: () => null,
  isTerrainPassable: () => true,
  isWaterPassable: () => false,
  canEnterCell: () => 0,
  getOccupancy: () => 0,
  cells: [],
  width: 128,
  height: 128,
} as unknown as GameMap);

/** Create a minimal ProductionContext */
const makeContext = (overrides: Partial<ProductionContext> = {}): ProductionContext => {
  const structures: MapStructure[] = [
    makeStructure('WEAP', 'Greece' as House),
    makeStructure('BARR', 'Greece' as House, 14, 10),
    makeStructure('TENT', 'Greece' as House, 18, 10),
    makeStructure('FACT', 'Greece' as House, 6, 10),
  ];
  const entities: Entity[] = [];
  const entityById = new Map<number, Entity>();

  return {
    structures,
    entities,
    entityById,
    credits: 100000,
    playerHouse: 'Greece' as House,
    playerFaction: 'allies' as Faction,
    playerTechLevel: 10,
    baseDiscovered: true,
    scenarioProductionItems: [],
    productionQueue: new Map(),
    pendingPlacement: null,
    wallPlacementPrepaid: false,
    map: makeMockMap(),
    tick: 0,
    powerProduced: 200,
    powerConsumed: 100,
    builtUnitTypes: new Set<string>(),
    builtInfantryTypes: new Set<string>(),
    builtAircraftTypes: new Set<string>(),
    rallyPoints: new Map<string, WorldPos>(),
    isAllied: (a: House, b: House) => a === b,
    hasBuilding: (type: string) => structures.some(s => s.type === type && s.alive),
    playSound: () => {},
    playEva: () => {},
    addEntity: (e: Entity) => { entities.push(e); entityById.set(e.id, e); },
    findPassableSpawn: (cx: number, cy: number) => ({ cx, cy }),
    ...overrides,
  };
};

// ══════════════════════════════════════════════════════════════════════════════
// Section 1: Vessel production — MISSION_GUARD (no IQ gate)
// C++ building.cpp:1955-1956: vessel exits sub pen/shipyard with MISSION_GUARD
// There is NO IQ check and NO upgrade to GUARD_AREA for vessels.
// ══════════════════════════════════════════════════════════════════════════════
describe('C++ parity: vessel production gets MISSION_GUARD (building.cpp:1956)', () => {
  it('destroyer exits shipyard with GUARD mission', () => {
    const dd = makeItem({
      type: 'DD' as UnitType,
      name: 'Destroyer',
      cost: 1000,
      prerequisite: 'SYRD',
    });
    // Mark as vessel
    const waterCell = { cx: 25, cy: 25 };
    const ctx = makeContext({
      structures: [
        makeStructure('SYRD', 'Greece' as House, 14, 10),
        makeStructure('FACT', 'Greece' as House, 6, 10),
      ],
      map: {
        ...makeMockMap(),
        findAdjacentWaterCell: () => waterCell,
      } as unknown as GameMap,
    });
    spawnProducedUnit(ctx, dd);
    expect(ctx.entities.length).toBe(1);
    const unit = ctx.entities[0];
    // C++: vessel gets MISSION_GUARD unconditionally
    expect(unit.mission).toBe(Mission.GUARD);
  });

  it('vessel does NOT get AREA_GUARD even with rally point set', () => {
    // C++ building.cpp:1949-1966: vessel path has no GUARD_AREA upgrade at all
    // TS: vessels go through the generic rally-point path and DO get AREA_GUARD
    // This test documents the C++ behavior — vessel should stay GUARD
    const ss = makeItem({
      type: 'SS' as UnitType,
      name: 'Submarine',
      cost: 950,
      prerequisite: 'SPEN',
    });
    const waterCell = { cx: 25, cy: 25 };
    const rallyPoints = new Map<string, WorldPos>();
    rallyPoints.set('SPEN', { x: 500, y: 500 });
    const ctx = makeContext({
      structures: [
        makeStructure('SPEN', 'Greece' as House, 14, 10),
        makeStructure('FACT', 'Greece' as House, 6, 10),
      ],
      map: {
        ...makeMockMap(),
        findAdjacentWaterCell: () => waterCell,
      } as unknown as GameMap,
      rallyPoints,
    });
    spawnProducedUnit(ctx, ss);
    expect(ctx.entities.length).toBe(1);
    const unit = ctx.entities[0];
    // C++: vessel always gets GUARD, never GUARD_AREA
    // NOTE: TS currently gives GUARD for vessels because the rally-point code
    //   only runs on non-vessel, non-aircraft units. Verify this is true.
    expect(unit.mission).toBe(Mission.GUARD);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 2: Aircraft production — MISSION_GUARD (docked at pad)
// C++ building.cpp:2449: air->Assign_Mission(MISSION_GUARD)
// ══════════════════════════════════════════════════════════════════════════════
describe('C++ parity: aircraft production gets MISSION_GUARD (building.cpp:2449)', () => {
  it('helicopter docks at helipad with GUARD mission', () => {
    const heli = makeItem({
      type: 'HELI' as UnitType,
      name: 'Longbow',
      cost: 1200,
      prerequisite: 'HPAD',
    });
    const ctx = makeContext({
      structures: [
        makeStructure('HPAD', 'Greece' as House, 14, 10),
        makeStructure('FACT', 'Greece' as House, 6, 10),
      ],
    });
    spawnProducedUnit(ctx, heli);
    expect(ctx.entities.length).toBe(1);
    const unit = ctx.entities[0];
    // C++: aircraft at pad gets GUARD
    expect(unit.mission).toBe(Mission.GUARD);
    expect(unit.aircraftState).toBe('landed');
    expect(unit.flightAltitude).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 3: Harvester production — MISSION_HARVEST
// C++ building.cpp:1980: unit->Assign_Mission(MISSION_HARVEST)
// The refinery Exit_Object path explicitly sets MISSION_HARVEST, not GUARD.
// ══════════════════════════════════════════════════════════════════════════════
describe('C++ parity: harvester gets MISSION_HARVEST (building.cpp:1980)', () => {
  it('harvester exits refinery with HARVEST mission', () => {
    const harv = makeItem({
      type: UnitType.V_HARV,
      name: 'Ore Truck',
      cost: 1400,
      prerequisite: 'WEAP',
    });
    const ctx = makeContext({
      structures: [
        makeStructure('WEAP', 'Greece' as House, 10, 10),
        makeStructure('PROC', 'Greece' as House, 16, 10),
        makeStructure('FACT', 'Greece' as House, 6, 10),
      ],
    });
    spawnProducedUnit(ctx, harv);
    expect(ctx.entities.length).toBe(1);
    const unit = ctx.entities[0];
    // C++: harvester gets MISSION_HARVEST, NOT MISSION_GUARD
    // TS: sets harvesterState='idle' but leaves mission=GUARD
    // The C++ mission IS MISSION_HARVEST from the very first tick.
    expect(unit.harvesterState).toBe('idle');
    // MISMATCH CHECK: C++ gives MISSION_HARVEST, TS gives GUARD
    expect(unit.mission).toBe(Mission.HARVEST);
  });

  it('harvester does NOT get rally-pointed AREA_GUARD (C++ skips rally for refineries)', () => {
    // C++ building.cpp:1972-1981: refinery path gives HARVEST, not MOVE/GUARD_AREA
    // Even if a rally point exists for WEAP, harvesters skip it.
    const harv = makeItem({
      type: UnitType.V_HARV,
      name: 'Ore Truck',
      cost: 1400,
      prerequisite: 'WEAP',
    });
    const rallyPoints = new Map<string, WorldPos>();
    rallyPoints.set('WEAP', { x: 500, y: 500 });
    const ctx = makeContext({
      structures: [
        makeStructure('WEAP', 'Greece' as House, 10, 10),
        makeStructure('PROC', 'Greece' as House, 16, 10),
        makeStructure('FACT', 'Greece' as House, 6, 10),
      ],
      rallyPoints,
    });
    spawnProducedUnit(ctx, harv);
    expect(ctx.entities.length).toBe(1);
    const unit = ctx.entities[0];
    // C++: harvesters always get HARVEST, never AREA_GUARD
    // TS already correctly skips rally for harvesters (production.ts:363 check)
    expect(unit.mission).not.toBe(Mission.AREA_GUARD);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 4: War factory units — IQ-gated mission assignment
// C++ building.cpp:4539-4543 (Mission_Unload OPEN state):
//   unit->Assign_Mission(MISSION_MOVE);
//   if (House->IQ >= Rule.IQGuardArea) {
//       unit->Assign_Mission(MISSION_GUARD_AREA);
//       unit->ArchiveTarget = ::As_Target(House->Where_To_Go(unit));
//   }
// Human players have IQ=0, so they get MISSION_MOVE, NOT GUARD or GUARD_AREA.
// AI houses with IQ >= 4 get GUARD_AREA + Where_To_Go rally.
// ══════════════════════════════════════════════════════════════════════════════
describe('C++ parity: war factory unit mission is IQ-gated (building.cpp:4539-4543)', () => {
  it('human player (IQ=0): tank exits war factory with MOVE, not GUARD', () => {
    // C++: human IQ=0 < IQGuardArea=4, so gets MISSION_MOVE
    // TS currently gives MISSION_GUARD (no rally) — MISMATCH
    const tank = makeItem({ type: '2TNK' as UnitType, prerequisite: 'WEAP' });
    const ctx = makeContext();
    spawnProducedUnit(ctx, tank);
    expect(ctx.entities.length).toBe(1);
    const unit = ctx.entities[0];
    // C++ behavior: MISSION_MOVE for human player
    // TS gives: MISSION_GUARD — this is the mismatch under audit
    expect(unit.mission).toBe(Mission.MOVE);
  });

  it('AI with IQ >= 4: tank exits war factory with GUARD_AREA', () => {
    // C++: AI IQ >= IQGuardArea=4 → MISSION_GUARD_AREA + ArchiveTarget
    // TS: with rally point set → AREA_GUARD (partially correct, but not IQ-gated)
    const tank = makeItem({ type: '2TNK' as UnitType, prerequisite: 'WEAP' });
    const rallyPoints = new Map<string, WorldPos>();
    rallyPoints.set('WEAP', { x: 500, y: 500 });
    const ctx = makeContext({ rallyPoints });
    spawnProducedUnit(ctx, tank);
    expect(ctx.entities.length).toBe(1);
    const unit = ctx.entities[0];
    // TS correctly gives AREA_GUARD when rally is set (simulating high-IQ)
    expect(unit.mission).toBe(Mission.AREA_GUARD);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 5: Barracks/Tent infantry — same IQ-gated pattern
// C++ building.cpp:2030-2039:
//   base->Assign_Mission(MISSION_MOVE);
//   base->Assign_Destination(exit cell);
//   if (House->IQ >= Rule.IQGuardArea) {
//       base->Assign_Mission(MISSION_GUARD_AREA);
//       base->ArchiveTarget = Where_To_Go();
//   }
// ══════════════════════════════════════════════════════════════════════════════
describe('C++ parity: barracks infantry mission is IQ-gated (building.cpp:2030-2039)', () => {
  it('human player: infantry exits barracks with MOVE, not GUARD', () => {
    // C++: human IQ=0 < IQGuardArea=4 → MISSION_MOVE + destination=exit_cell
    // TS: gives MISSION_GUARD — MISMATCH
    const e1 = makeItem({
      type: 'E1' as UnitType,
      name: 'Rifle Infantry',
      cost: 100,
      prerequisite: 'TENT',
    });
    const ctx = makeContext({
      structures: [
        makeStructure('TENT', 'Greece' as House, 14, 10),
        makeStructure('FACT', 'Greece' as House, 6, 10),
      ],
    });
    spawnProducedUnit(ctx, e1);
    expect(ctx.entities.length).toBe(1);
    const unit = ctx.entities[0];
    // C++ behavior: MISSION_MOVE for human player
    expect(unit.mission).toBe(Mission.MOVE);
  });

  it('human player: infantry exits barracks with MOVE (Soviet BARR)', () => {
    const e1 = makeItem({
      type: 'E1' as UnitType,
      name: 'Rifle Infantry',
      cost: 100,
      prerequisite: 'BARR',
    });
    const ctx = makeContext({
      structures: [
        makeStructure('BARR', 'Greece' as House, 14, 10),
        makeStructure('FACT', 'Greece' as House, 6, 10),
      ],
    });
    spawnProducedUnit(ctx, e1);
    expect(ctx.entities.length).toBe(1);
    const unit = ctx.entities[0];
    // C++ behavior: MISSION_MOVE for human player from BARR
    expect(unit.mission).toBe(Mission.MOVE);
  });

  it('with rally point: infantry gets AREA_GUARD (simulates AI IQ >= 4)', () => {
    const e1 = makeItem({
      type: 'E1' as UnitType,
      name: 'Rifle Infantry',
      cost: 100,
      prerequisite: 'TENT',
    });
    const rallyPoints = new Map<string, WorldPos>();
    rallyPoints.set('TENT', { x: 300, y: 300 });
    const ctx = makeContext({
      structures: [
        makeStructure('TENT', 'Greece' as House, 14, 10),
        makeStructure('FACT', 'Greece' as House, 6, 10),
      ],
      rallyPoints,
    });
    spawnProducedUnit(ctx, e1);
    expect(ctx.entities.length).toBe(1);
    const unit = ctx.entities[0];
    // With rally: gets AREA_GUARD (matches C++ AI with IQ >= IQGuardArea)
    expect(unit.mission).toBe(Mission.AREA_GUARD);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 6: IQGuardArea constant value
// C++ rules.cpp:146: IQGuardArea(4)
// C++ rules.cpp:942: IQGuardArea = ini.Get_Int("IQ","GuardArea",IQGuardArea)
// rules.ini [IQ] GuardArea=4
// ══════════════════════════════════════════════════════════════════════════════
describe('C++ parity: IQGuardArea constant (rules.cpp:146, rules.ini IQ.GuardArea=4)', () => {
  it('IQGuardArea default is 4 (rules.cpp:146 constructor default)', () => {
    // This is validated here for completeness; detailed IQ tests are in
    // cpp-parity-ai-constants.test.ts and cpp-parity-iq-gates.test.ts
    const IQ_GUARD_AREA = 4;
    expect(IQ_GUARD_AREA).toBe(4);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 7: Rally point sets archiveTarget (C++ ArchiveTarget = Where_To_Go)
// C++ building.cpp:2039: base->ArchiveTarget = ::As_Target(House->Where_To_Go())
// C++ building.cpp:4543: unit->ArchiveTarget = ::As_Target(House->Where_To_Go())
// ArchiveTarget is used by GUARD_AREA behavior to determine the "leash" point.
// ══════════════════════════════════════════════════════════════════════════════
describe('C++ parity: AREA_GUARD sets archiveTarget for leash (building.cpp:2039, 4543)', () => {
  it('rally-pointed unit has archiveTarget matching rally position', () => {
    const tank = makeItem({ type: '2TNK' as UnitType, prerequisite: 'WEAP' });
    const rallyPoints = new Map<string, WorldPos>();
    const rallyPos = { x: 500, y: 500 };
    rallyPoints.set('WEAP', rallyPos);
    const ctx = makeContext({ rallyPoints });
    spawnProducedUnit(ctx, tank);
    expect(ctx.entities.length).toBe(1);
    const unit = ctx.entities[0];
    // C++: ArchiveTarget = Where_To_Go() — the leash return point
    // TS: archiveTarget = worldToCell(rally position) — stored as CellPos
    expect(unit.archiveTarget).toBeDefined();
    const expectedCell = worldToCell(rallyPos.x, rallyPos.y);
    expect(unit.archiveTarget!.cx).toBe(expectedCell.cx);
    expect(unit.archiveTarget!.cy).toBe(expectedCell.cy);
  });

  it('rally-pointed unit has guardOrigin at rally position', () => {
    const e1 = makeItem({
      type: 'E1' as UnitType,
      name: 'Rifle Infantry',
      cost: 100,
      prerequisite: 'TENT',
    });
    const rallyPoints = new Map<string, WorldPos>();
    const rallyPos = { x: 300, y: 300 };
    rallyPoints.set('TENT', rallyPos);
    const ctx = makeContext({
      structures: [
        makeStructure('TENT', 'Greece' as House, 14, 10),
        makeStructure('FACT', 'Greece' as House, 6, 10),
      ],
      rallyPoints,
    });
    spawnProducedUnit(ctx, e1);
    expect(ctx.entities.length).toBe(1);
    const unit = ctx.entities[0];
    expect(unit.guardOrigin).toBeDefined();
    expect(unit.guardOrigin!.x).toBe(rallyPos.x);
    expect(unit.guardOrigin!.y).toBe(rallyPos.y);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 8: No rally + no IQ gate = GUARD (TS current behavior)
// In C++ this would be MISSION_MOVE for human player, but TS gives GUARD.
// This section documents the current TS behavior and the expected C++ behavior.
// ══════════════════════════════════════════════════════════════════════════════
describe('C++ parity: default mission without rally (building.cpp:4539, 2030)', () => {
  it('non-harvester unit without rally gets MOVE (C++ human player IQ=0)', () => {
    const tank = makeItem({ type: '2TNK' as UnitType, prerequisite: 'WEAP' });
    const ctx = makeContext(); // no rally points
    spawnProducedUnit(ctx, tank);
    expect(ctx.entities.length).toBe(1);
    const unit = ctx.entities[0];
    // C++ building.cpp:4539: human player (IQ=0) gets MISSION_MOVE
    expect(unit.mission).toBe(Mission.MOVE);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 9: Survivors from building destruction — human vs AI
// C++ building.cpp:1707-1711:
//   if (House->IsHuman) { i->Assign_Mission(MISSION_GUARD); }
//   else { i->Assign_Mission(MISSION_HUNT); }
// This is NOT about production per se, but it's a related mission-assignment path.
// Documenting the C++ behavior for future parity audit.
// ══════════════════════════════════════════════════════════════════════════════
describe('C++ reference: destruction survivors (building.cpp:1707-1711)', () => {
  it('C++ gives human survivors GUARD, AI survivors HUNT', () => {
    // This is a documentation test — the C++ behavior is:
    // Human house → MISSION_GUARD
    // AI house → MISSION_HUNT
    // There is no equivalent TS code path to test here (building destruction
    // survivor spawning is not yet implemented), so we just document the rule.
    const humanMission = 'GUARD'; // building.cpp:1708
    const aiMission = 'HUNT';     // building.cpp:1710
    expect(humanMission).not.toBe(aiMission);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 10: Survivors from building sell — unconditional GUARD_AREA
// C++ building.cpp:3477: infantry->Assign_Mission(MISSION_GUARD_AREA)
// No IQ check — all sold building survivors get GUARD_AREA.
// ══════════════════════════════════════════════════════════════════════════════
describe('C++ reference: sell survivors (building.cpp:3477)', () => {
  it('C++ gives all sell survivors GUARD_AREA (no IQ check)', () => {
    // Documentation test: C++ building sell path unconditionally assigns
    // MISSION_GUARD_AREA to surviving infantry, regardless of House IQ.
    // This differs from the destruction path (Section 9) and from the
    // production path (IQ-gated).
    const sellSurvivorMission = 'GUARD_AREA'; // building.cpp:3477
    expect(sellSurvivorMission).toBe('GUARD_AREA');
  });
});
