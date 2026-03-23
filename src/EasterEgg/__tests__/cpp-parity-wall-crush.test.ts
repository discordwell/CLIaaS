/**
 * C++ Behavioral Parity: Wall Crushing by Tracked Vehicles
 *
 * C++ unit.cpp:1855-1871 — Per_Cell_Process:
 *   When a vehicle with IsCrusher enters a cell containing an overlay,
 *   if the overlay's IsCrushable flag is true, the wall is destroyed
 *   via Reduce_Wall(-1).
 *
 * C++ odata.cpp — IsCrushable flags:
 *   SBAG (sandbag): IsCrushable = true
 *   FENC (fence):   IsCrushable = true
 *   BARB (barbwire): IsCrushable = true
 *   WOOD (wood wall): IsCrushable = true
 *   BRIK (brick/concrete): IsCrushable = false
 *
 * These tests verify that crusher vehicles destroy crushable walls
 * and leave non-crushable walls intact. Non-crusher vehicles never
 * destroy walls by driving over them.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE,
  buildDefaultAlliances, AnimState,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  checkWallCrush,
  CRUSHABLE_WALLS,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import {
  type MapStructure, STRUCTURE_MAX_HP,
} from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeWall(
  type: string, cx: number, cy: number, house: House = House.USSR,
): MapStructure {
  const maxHp = STRUCTURE_MAX_HP[type] ?? 1;
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp: maxHp, maxHp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(
  structures: MapStructure[] = [],
  entities: Entity[] = [],
): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
    inflightProjectiles: [],
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    scenarioId: 'TEST',
    killCount: 0,
    lossCount: 0,
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    attackedTriggerNames: new Set<string>(),
    map,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    movementSpeed: () => 1,
    getFirepowerBias: () => 1.0,
    getArmorBias: () => 1.0,
    getROFBias: () => 1.0,
    damageStructure: () => false,
    aiIQ: () => 3,
    warheadMuzzleColor: () => '#fff',
    aiStates: new Map(),
    lastBaseAttackEva: -Infinity,
    gameTicksPerSec: 15,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => {},
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
    powerConsumed: 0,
    powerProduced: 100,
  } as CombatContext;
}

// =============================================================================
//  CRUSHABLE_WALLS set matches C++ odata.cpp IsCrushable flags
// =============================================================================

describe('CRUSHABLE_WALLS set matches C++ odata.cpp', () => {

  it('SBAG is crushable (C++ odata.cpp:68)', () => {
    expect(CRUSHABLE_WALLS.has('SBAG')).toBe(true);
  });

  it('FENC is crushable (C++ odata.cpp:153)', () => {
    expect(CRUSHABLE_WALLS.has('FENC')).toBe(true);
  });

  it('BARB is crushable (C++ odata.cpp:119)', () => {
    expect(CRUSHABLE_WALLS.has('BARB')).toBe(true);
  });

  it('WOOD is crushable (C++ odata.cpp:136)', () => {
    expect(CRUSHABLE_WALLS.has('WOOD')).toBe(true);
  });

  it('BRIK is NOT crushable (C++ odata.cpp:102)', () => {
    expect(CRUSHABLE_WALLS.has('BRIK')).toBe(false);
  });
});

// =============================================================================
//  Crusher vehicle destroys crushable walls on cell entry
// =============================================================================
//
// C++ unit.cpp:1859: if (Class->IsCrusher && cellptr->Overlay != OVERLAY_NONE)
//   optr = &OverlayTypeClass::As_Reference(cellptr->Overlay);
//   if (optr->IsCrushable) { cellptr->Reduce_Wall(-1); }

describe('Crusher vehicle destroys crushable walls (unit.cpp:1859)', () => {

  it('Heavy Tank (crusher=true) crushes SBAG wall', () => {
    const wall = makeWall('SBAG', 10, 10);
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([wall], [tank]);
    ctx.map.setWallType(10, 10, 'SBAG');

    checkWallCrush(ctx, tank);

    expect(ctx.map.getWallType(10, 10)).toBe('');
    expect(wall.alive).toBe(false);
    expect(wall.rubble).toBe(true);
  });

  it('Heavy Tank crushes FENC wall', () => {
    const wall = makeWall('FENC', 10, 10);
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([wall], [tank]);
    ctx.map.setWallType(10, 10, 'FENC');

    checkWallCrush(ctx, tank);

    expect(ctx.map.getWallType(10, 10)).toBe('');
    expect(wall.alive).toBe(false);
    expect(wall.rubble).toBe(true);
  });

  it('Heavy Tank crushes BARB wall', () => {
    const wall = makeWall('BARB', 10, 10);
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([wall], [tank]);
    ctx.map.setWallType(10, 10, 'BARB');

    checkWallCrush(ctx, tank);

    expect(ctx.map.getWallType(10, 10)).toBe('');
    expect(wall.alive).toBe(false);
    expect(wall.rubble).toBe(true);
  });

  it('Light Tank (crusher=true) crushes SBAG wall', () => {
    const wall = makeWall('SBAG', 10, 10);
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([wall], [tank]);
    ctx.map.setWallType(10, 10, 'SBAG');

    checkWallCrush(ctx, tank);

    expect(ctx.map.getWallType(10, 10)).toBe('');
    expect(wall.alive).toBe(false);
  });

  it('Mammoth Tank (crusher=true) crushes FENC wall', () => {
    const wall = makeWall('FENC', 10, 10);
    const tank = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([wall], [tank]);
    ctx.map.setWallType(10, 10, 'FENC');

    checkWallCrush(ctx, tank);

    expect(ctx.map.getWallType(10, 10)).toBe('');
    expect(wall.alive).toBe(false);
  });

  it('APC (crusher=true) crushes SBAG wall', () => {
    const wall = makeWall('SBAG', 10, 10);
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const ctx = makeCombatCtx([wall], [apc]);
    ctx.map.setWallType(10, 10, 'SBAG');

    checkWallCrush(ctx, apc);

    expect(ctx.map.getWallType(10, 10)).toBe('');
    expect(wall.alive).toBe(false);
  });

  it('MCV (C++ udata.cpp:358 IsCrusher=true) DOES crush BARB wall', () => {
    const wall = makeWall('BARB', 10, 10);
    const mcv = entityAtCell(UnitType.V_MCV, House.Spain, 10, 10);
    const ctx = makeCombatCtx([wall], [mcv]);
    ctx.map.setWallType(10, 10, 'BARB');

    checkWallCrush(ctx, mcv);

    // MCV is a crusher (C++ IsCrusher=true) — wall is destroyed
    expect(ctx.map.getWallType(10, 10)).toBe('');
    expect(wall.alive).toBe(false);
  });

  it('Harvester (crusher=true) crushes FENC wall', () => {
    const wall = makeWall('FENC', 10, 10);
    const harv = entityAtCell(UnitType.V_HARV, House.Spain, 10, 10);
    const ctx = makeCombatCtx([wall], [harv]);
    ctx.map.setWallType(10, 10, 'FENC');

    checkWallCrush(ctx, harv);

    expect(ctx.map.getWallType(10, 10)).toBe('');
    expect(wall.alive).toBe(false);
  });
});

// =============================================================================
//  Crusher vehicle does NOT destroy non-crushable walls (BRIK)
// =============================================================================
//
// C++ odata.cpp:102 — BRIK has IsCrushable = false

describe('Crusher vehicle does NOT crush BRIK wall (odata.cpp:102)', () => {

  it('Heavy Tank cannot crush BRIK wall', () => {
    const wall = makeWall('BRIK', 10, 10);
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([wall], [tank]);
    ctx.map.setWallType(10, 10, 'BRIK');

    checkWallCrush(ctx, tank);

    expect(ctx.map.getWallType(10, 10)).toBe('BRIK');
    expect(wall.alive).toBe(true);
    expect(wall.rubble).toBe(false);
  });

  it('Mammoth Tank cannot crush BRIK wall', () => {
    const wall = makeWall('BRIK', 10, 10);
    const tank = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([wall], [tank]);
    ctx.map.setWallType(10, 10, 'BRIK');

    checkWallCrush(ctx, tank);

    expect(ctx.map.getWallType(10, 10)).toBe('BRIK');
    expect(wall.alive).toBe(true);
  });
});

// =============================================================================
//  Non-crusher vehicles do NOT crush any walls
// =============================================================================
//
// C++ unit.cpp:1859 — if (!Class->IsCrusher) skip wall crush entirely

describe('Non-crusher vehicles do NOT crush walls (unit.cpp:1859)', () => {

  it('Jeep (no crusher flag) does not crush SBAG', () => {
    const wall = makeWall('SBAG', 10, 10);
    const jeep = entityAtCell(UnitType.V_JEEP, House.Spain, 10, 10);
    const ctx = makeCombatCtx([wall], [jeep]);
    ctx.map.setWallType(10, 10, 'SBAG');

    checkWallCrush(ctx, jeep);

    expect(ctx.map.getWallType(10, 10)).toBe('SBAG');
    expect(wall.alive).toBe(true);
  });

  it('Infantry (E1, no crusher flag) does not crush SBAG', () => {
    const wall = makeWall('SBAG', 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ctx = makeCombatCtx([wall], [e1]);
    ctx.map.setWallType(10, 10, 'SBAG');

    checkWallCrush(ctx, e1);

    expect(ctx.map.getWallType(10, 10)).toBe('SBAG');
    expect(wall.alive).toBe(true);
  });
});

// =============================================================================
//  No wall present — crush is a no-op
// =============================================================================

describe('No wall at cell — checkWallCrush is a no-op', () => {

  it('crusher vehicle on empty cell does nothing', () => {
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([], [tank]);

    checkWallCrush(ctx, tank);

    expect(ctx.map.getWallType(10, 10)).toBe('');
  });
});

// =============================================================================
//  Wall crush clears map overlay and marks structure dead
// =============================================================================
//
// C++ unit.cpp:1869 — cellptr->Reduce_Wall(-1) removes the overlay from the cell.
// The corresponding structure object should also be marked dead.

describe('Wall crush clears overlay AND marks structure dead', () => {

  it('map wallType is cleared after crush', () => {
    const wall = makeWall('SBAG', 10, 10);
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([wall], [tank]);
    ctx.map.setWallType(10, 10, 'SBAG');

    checkWallCrush(ctx, tank);

    expect(ctx.map.getWallType(10, 10)).toBe('');
  });

  it('structure alive is set to false after crush', () => {
    const wall = makeWall('SBAG', 10, 10);
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([wall], [tank]);
    ctx.map.setWallType(10, 10, 'SBAG');

    checkWallCrush(ctx, tank);

    expect(wall.alive).toBe(false);
  });

  it('structure rubble is set to true after crush', () => {
    const wall = makeWall('SBAG', 10, 10);
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([wall], [tank]);
    ctx.map.setWallType(10, 10, 'SBAG');

    checkWallCrush(ctx, tank);

    expect(wall.rubble).toBe(true);
  });

  it('clearStructureFootprint is called on crush', () => {
    const wall = makeWall('SBAG', 10, 10);
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    let footprintCleared = false;
    const ctx = makeCombatCtx([wall], [tank]);
    ctx.map.setWallType(10, 10, 'SBAG');
    ctx.clearStructureFootprint = () => { footprintCleared = true; };

    checkWallCrush(ctx, tank);

    expect(footprintCleared).toBe(true);
  });

  it('adds a rubble decal at the wall cell', () => {
    const wall = makeWall('SBAG', 10, 10);
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([wall], [tank]);
    ctx.map.setWallType(10, 10, 'SBAG');

    checkWallCrush(ctx, tank);

    const decal = ctx.map.decals.find(d => d.cx === 10 && d.cy === 10);
    expect(decal).toBeDefined();
  });
});

// =============================================================================
//  Sound effects — C++ unit.cpp:1864-1868
// =============================================================================
//
// C++ unit.cpp:1864: if (optr->Type == OVERLAY_SANDBAG_WALL) Sound_Effect(VOC_SANDBAG)
//                     else Sound_Effect(VOC_WALLKILL2)

describe('Wall crush sound effects (unit.cpp:1864-1868)', () => {

  it('SBAG crush plays sandbag sound', () => {
    const wall = makeWall('SBAG', 10, 10);
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    const sounds: string[] = [];
    const ctx = makeCombatCtx([wall], [tank]);
    ctx.map.setWallType(10, 10, 'SBAG');
    ctx.playSoundAt = (name: string) => { sounds.push(name); };

    checkWallCrush(ctx, tank);

    expect(sounds).toContain('wallkill_sand');
  });

  it('FENC crush plays wallkill2 sound', () => {
    const wall = makeWall('FENC', 10, 10);
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    const sounds: string[] = [];
    const ctx = makeCombatCtx([wall], [tank]);
    ctx.map.setWallType(10, 10, 'FENC');
    ctx.playSoundAt = (name: string) => { sounds.push(name); };

    checkWallCrush(ctx, tank);

    expect(sounds).toContain('wallkill2');
  });

  it('BARB crush plays wallkill2 sound', () => {
    const wall = makeWall('BARB', 10, 10);
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    const sounds: string[] = [];
    const ctx = makeCombatCtx([wall], [tank]);
    ctx.map.setWallType(10, 10, 'BARB');
    ctx.playSoundAt = (name: string) => { sounds.push(name); };

    checkWallCrush(ctx, tank);

    expect(sounds).toContain('wallkill2');
  });
});

// =============================================================================
//  Only the wall at the vehicle's cell is destroyed (not neighbors)
// =============================================================================

describe('Only the wall at the vehicle cell is destroyed', () => {

  it('adjacent wall cells are NOT destroyed', () => {
    const wall1 = makeWall('SBAG', 10, 10);
    const wall2 = makeWall('SBAG', 11, 10);
    const wall3 = makeWall('SBAG', 10, 11);
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([wall1, wall2, wall3], [tank]);
    ctx.map.setWallType(10, 10, 'SBAG');
    ctx.map.setWallType(11, 10, 'SBAG');
    ctx.map.setWallType(10, 11, 'SBAG');

    checkWallCrush(ctx, tank);

    expect(ctx.map.getWallType(10, 10)).toBe('');  // crushed
    expect(ctx.map.getWallType(11, 10)).toBe('SBAG');  // intact
    expect(ctx.map.getWallType(10, 11)).toBe('SBAG');  // intact
    expect(wall1.alive).toBe(false);
    expect(wall2.alive).toBe(true);
    expect(wall3.alive).toBe(true);
  });
});

// =============================================================================
//  PARITY FIXED: Wall crush checks alliance (C++ unit.cpp:3108-3109)
// =============================================================================
//
// C++ unit.cpp:3108-3109 — cancrush = !House->Is_Ally(cellptr->Owner)
// Allied walls are NOT crushed by friendly vehicles.

describe('PARITY FIXED: Wall crush checks alliance (unit.cpp:3108-3109)', () => {

  it('crusher vehicle does NOT crush own allied wall', () => {
    // C++ unit.cpp:3108-3109: allied walls are not crushed
    const wall = makeWall('SBAG', 10, 10, House.Spain);
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([wall], [tank]);
    ctx.map.setWallType(10, 10, 'SBAG');

    checkWallCrush(ctx, tank);

    // PARITY FIXED: allied wall is NOT crushed
    expect(ctx.map.getWallType(10, 10)).toBe('SBAG');
    expect(wall.alive).toBe(true);
  });

  it('crusher vehicle destroys enemy wall', () => {
    const wall = makeWall('SBAG', 10, 10, House.USSR);
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([wall], [tank]);
    ctx.map.setWallType(10, 10, 'SBAG');

    checkWallCrush(ctx, tank);

    expect(ctx.map.getWallType(10, 10)).toBe('');
    expect(wall.alive).toBe(false);
  });
});
