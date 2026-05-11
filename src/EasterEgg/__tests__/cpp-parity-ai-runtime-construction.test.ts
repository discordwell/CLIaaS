/**
 * @vitest-environment jsdom
 *
 * C++ Behavioral Parity: AI building production is not an immediate placement pass.
 *
 * C++ HouseClass::AI_Building chooses HouseClass::BuildStructure. The actual
 * building is placed later by BuildingClass::Exit_Object after a factory product
 * completes. A game tick must therefore not consume a legacy TS build queue by
 * directly spawning a completed structure.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { aiPerTick, createAIHouseState, type AIContext } from '../engine/ai';
import { decrementStructureCdTimersEndOfLogic } from '../engine/combat';
import { GameMap, Terrain } from '../engine/map';
import { type MapStructure, STRUCTURE_MAX_HP, STRUCTURE_SIZE, STRUCTURE_WEAPONS } from '../engine/scenario';
import { House, Mission, RESFACTOR, UnitType } from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { ScenarioRandom } from '../engine/random';

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
    missionTimer: 999,
  } as MapStructure;
}

function markStructureFootprint(map: GameMap, structure: MapStructure): void {
  const [fw, fh] = STRUCTURE_SIZE[structure.type] ?? [1, 1];
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      map.setTerrain(structure.cx + dx, structure.cy + dy, Terrain.WALL);
    }
  }
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

beforeEach(() => {
  resetEntityIds();
});

describe('runtime AI construction path', () => {
  it('does not direct-spawn a queued structure during the House::AI frame', () => {
    const game = new Game(createCanvas());
    game.map.setBounds(40, 40, 30, 30);
    for (let y = 40; y < 70; y++) {
      for (let x = 40; x < 70; x++) {
        game.map.setTerrain(x, y, Terrain.CLEAR);
      }
    }

    const fact = makeStructure('FACT', House.USSR, 50, 50);
    game.structures.push(fact);
    markStructureFootprint(game.map, fact);

    game.houseCredits.set(House.USSR, 10000);
    game.houseIQs.set(House.USSR, 3);
    const aiCtx = (game as unknown as { readonly _aiCtx: AIContext })._aiCtx;
    const state = createAIHouseState(aiCtx, House.USSR);
    state.productionEnabled = true;
    state.iq = 3;
    state.maxBuilding = -1;
    state.buildQueue = ['SILO'];
    game.aiStates.set(House.USSR, state);

    game.tick = 90;
    (game as unknown as { update(): void }).update();

    expect(game.structures.map(s => s.type)).toEqual(['FACT']);
    expect(state.buildQueue).toEqual(['SILO']);
  });

  it('turns a missing [Base] node into BuildStructure without placing it', () => {
    const game = new Game(createCanvas());
    game.map.setBounds(40, 40, 70, 40);
    for (let y = 40; y < 80; y++) {
      for (let x = 40; x < 110; x++) {
        game.map.setTerrain(x, y, Terrain.CLEAR);
      }
    }

    const fact = makeStructure('FACT', House.BadGuy, 50, 50);
    game.structures.push(fact);
    markStructureFootprint(game.map, fact);

    game.houseCredits.set(House.BadGuy, 10000);
    game.houseIQs.set(House.BadGuy, 3);
    (game as unknown as { baseBlueprint: Array<{ type: string; cell: number; house: House }> }).baseBlueprint = [
      { type: 'APWR', cell: 47 * 128 + 103, house: House.BadGuy },
    ];

    const aiCtx = (game as unknown as { readonly _aiCtx: AIContext })._aiCtx;
    const state = createAIHouseState(aiCtx, House.BadGuy);
    state.iq = 3;
    game.aiStates.set(House.BadGuy, state);

    game.tick = 75;
    (game as unknown as { update(): void }).update();

    expect(game.structures.map(s => `${s.house}:${s.type}:${s.cx},${s.cy}`)).toEqual([
      'BadGuy:FACT:50,50',
    ]);
    expect(state.buildStructure).toBe('APWR');
  });

  it('starts BuildUnit on a WEAP-owned FactoryClass instead of direct-spawning a unit', () => {
    const game = new Game(createCanvas());
    const weap = makeStructure('WEAP', House.USSR, 50, 50);
    game.structures.push(weap);
    game.houseCredits.set(House.USSR, 10000);
    game.houseIQs.set(House.USSR, 3);

    const aiCtx = (game as unknown as { readonly _aiCtx: AIContext })._aiCtx;
    const state = createAIHouseState(aiCtx, House.USSR);
    state.isStarted = true;
    state.buildUnit = UnitType.V_HARV;
    game.aiStates.set(House.USSR, state);

    (game as unknown as { updateAIBuildingFactory(s: MapStructure): void }).updateAIBuildingFactory(weap);

    expect(game.entities).toHaveLength(0);
    expect(weap.aiFactory).toMatchObject({
      kind: 'unit',
      productType: UnitType.V_HARV,
      stage: 0,
      suspended: false,
    });
    expect(state.buildUnit).toBeNull();
  });

  it('counts a limbo WEAP harvester product in UQuantity before requesting another replacement', () => {
    const game = new Game(createCanvas());
    const procA = makeStructure('PROC', House.USSR, 46, 45);
    const procB = makeStructure('PROC', House.USSR, 56, 45);
    const weap = makeStructure('WEAP', House.USSR, 50, 50);
    weap.aiFactory = {
      kind: 'unit',
      productType: UnitType.V_HARV,
      stage: 12,
      rate: 14,
      timer: 7,
      balance: 1000,
      cost: 1400,
      startedTick: 100,
      suspended: false,
    };
    game.structures.push(procA, procB, weap);
    game.houseCredits.set(House.USSR, 10000);
    game.houseIQs.set(House.USSR, 3);

    const activeHarv = new Entity(UnitType.V_HARV, House.USSR, 42 * 24, 45 * 24);
    activeHarv.mission = Mission.HARVEST;
    game.entities.push(activeHarv);
    game.entityById.set(activeHarv.id, activeHarv);

    const aiCtx = (game as unknown as { readonly _aiCtx: AIContext })._aiCtx;
    const state = createAIHouseState(aiCtx, House.USSR);
    state.isStarted = true;
    state.iq = 3;
    state.maxUnit = 20;
    game.aiStates.set(House.USSR, state);

    // C++ house.cpp:5817 compares BQuantity[REFINERY] to UQuantity[HARVESTER].
    // UnitClass::UnitClass increments UQuantity when FactoryClass::Set creates
    // the limbo product, so the active harvester plus in-factory harvester
    // satisfy two refineries and AI_Unit must not queue another HARV.
    aiPerTick(aiCtx);

    expect(state.buildUnit).toBeNull();
  });

  it('exits a completed WEAP BuildUnit product at the C++ war-factory exit coordinate', () => {
    const game = new Game(createCanvas());
    game.map.setBounds(40, 40, 30, 30);
    for (let y = 40; y < 70; y++) {
      for (let x = 40; x < 70; x++) {
        game.map.setTerrain(x, y, Terrain.CLEAR);
      }
    }

    const weap = makeStructure('WEAP', House.USSR, 50, 50);
    game.structures.push(weap);
    markStructureFootprint(game.map, weap);
    weap.aiFactory = {
      kind: 'unit',
      productType: UnitType.V_HARV,
      stage: 54,
      rate: 0,
      timer: 0,
      balance: 0,
      cost: 1400,
      startedTick: 1,
      suspended: true,
    };

    const aiCtx = (game as unknown as { readonly _aiCtx: AIContext })._aiCtx;
    const state = createAIHouseState(aiCtx, House.USSR);
    state.isStarted = true;
    game.aiStates.set(House.USSR, state);

    (game as unknown as { updateAIBuildingFactory(s: MapStructure): void }).updateAIBuildingFactory(weap);

    expect(weap.aiFactory).toBeUndefined();
    expect(game.entities).toHaveLength(1);
    const harv = game.entities[0];
    expect(harv.type).toBe(UnitType.V_HARV);
    expect(harv.house).toBe(House.USSR);
    expect(harv.mission).toBe(Mission.HARVEST);
    expect(harv.missionTimer).toBe(0);
    expect(harv.harvesterState).toBe('idle');
    expect(harv.leptonX).toBe(50 * 256 + 384);
    expect(harv.leptonY).toBe(50 * 256 + 256);
    expect(harv.isTethered).toBe(true);
    expect(harv.scenarioInitUnlimbo).toBe(true);
    expect(harv.logicIndexHint).toBe(1);
    expect(weap.mission).toBe(Mission.UNLOAD);
    expect(weap.missionTimer).toBe(0);
    expect(weap.aiFactoryContactEntityId).toBe(harv.id);
    expect(weap.weapUnloadStatus).toBe(0);
  });

  it('WEAP-tethered unit Basic_Path may route through its contact factory footprint', () => {
    const game = new Game(createCanvas());
    game.map.setBounds(30, 40, 40, 25);
    for (let y = 40; y < 65; y++) {
      for (let x = 30; x < 70; x++) {
        game.map.setTerrain(x, y, Terrain.CLEAR);
      }
    }

    const weap = makeStructure('WEAP', House.USSR, 51, 45);
    game.structures.push(weap);
    markStructureFootprint(game.map, weap);

    const harv = new Entity(UnitType.V_HARV, House.USSR, 0, 0);
    harv.leptonX = 51 * 256 + 384;
    harv.leptonY = 45 * 256 + 256;
    harv.syncPosFromLeptons();
    harv.mission = Mission.HARVEST;
    harv.missionTimer = 15;
    harv.moveTarget = { lx: 33 * 256 + 128, ly: 51 * 256 + 128 };
    harv.isTethered = true;
    harv.bodyFacing256 = 128; // C++ Unlimbo DIR_S for WEAP products.
    harv.desiredFacing256 = 128;
    game.entities.push(harv);
    game.entityById.set(harv.id, harv);
    game.map.setVehicleOccupancy(harv.cell.cx, harv.cell.cy, harv.id);
    weap.aiFactoryContactEntityId = harv.id;

    (game as unknown as { startDriveClassMove(e: Entity): void }).startDriveClassMove(harv);

    expect(harv.desiredFacing256).toBe(192); // FACING_W
    expect(harv.path[0]).toEqual({ cx: 51, cy: 46 });
    expect(harv.drivePathFacings[0]).toBe(6);
    expect(harv.isDriving).toBe(false);
  });

  it('WEAP-tethered cached drive path remains valid while entering the contact factory footprint', () => {
    const game = new Game(createCanvas());
    game.map.setBounds(30, 40, 40, 25);
    for (let y = 40; y < 65; y++) {
      for (let x = 30; x < 70; x++) {
        game.map.setTerrain(x, y, Terrain.CLEAR);
      }
    }

    const weap = makeStructure('WEAP', House.USSR, 51, 45);
    game.structures.push(weap);
    markStructureFootprint(game.map, weap);

    const harv = new Entity(UnitType.V_HARV, House.USSR, 0, 0);
    harv.leptonX = 51 * 256 + 384;
    harv.leptonY = 45 * 256 + 256;
    harv.syncPosFromLeptons();
    harv.mission = Mission.HARVEST;
    harv.missionTimer = 2;
    harv.moveTarget = { lx: 33 * 256 + 128, ly: 51 * 256 + 128 };
    harv.path = [
      { cx: 51, cy: 46 },
      { cx: 50, cy: 46 },
      { cx: 49, cy: 46 },
    ];
    harv.drivePathFacings = [6, 6, 6];
    harv.isTethered = true;
    harv.bodyFacing256 = 192;
    harv.desiredFacing256 = 192;
    harv.pathDelay = 0;
    game.entities.push(harv);
    game.entityById.set(harv.id, harv);
    game.map.setVehicleOccupancy(harv.cell.cx, harv.cell.cy, harv.id);
    weap.aiFactoryContactEntityId = harv.id;

    (game as unknown as { runDriveClassAI(e: Entity): void }).runDriveClassAI(harv);

    expect(harv.path[0]).toEqual({ cx: 51, cy: 46 });
    expect(harv.isDriving).toBe(true);
    expect(harv.trackNumber).toBeGreaterThan(0);
    expect(harv.driveSpeed).toBe(204);
    expect(harv.speedAccum).toBe(2);
    expect(harv.leptonX).toBe(51 * 256 + 128 + 245);
    expect(harv.leptonY).toBe(46 * 256 + 128);
    expect(harv.headToLX).toBe(51 * 256 + 128);
    expect(harv.headToLY).toBe(46 * 256 + 128);
  });

  it('assigns the C++ Logic slot to BARR-exited infantry before later runtime bullets', () => {
    const game = new Game(createCanvas());
    game.map.setBounds(40, 40, 30, 30);
    for (let y = 40; y < 70; y++) {
      for (let x = 40; x < 70; x++) {
        game.map.setTerrain(x, y, Terrain.CLEAR);
      }
    }

    const barr = makeStructure('BARR', House.BadGuy, 50, 50);
    game.structures.push(barr);
    markStructureFootprint(game.map, barr);
    barr.aiFactory = {
      kind: 'infantry',
      productType: UnitType.I_E1,
      stage: 54,
      rate: 0,
      timer: 0,
      balance: 0,
      cost: 100,
      startedTick: 1,
      suspended: true,
    };

    const runtime = new Entity(UnitType.V_JEEP, House.Greece, 87 * 24, 52 * 24);
    runtime.logicIndexHint = 42;
    game.entities.push(runtime);
    game.entityById.set(runtime.id, runtime);

    const access = game as unknown as {
      exitAIInfantryFactoryProduct(s: MapStructure): 0 | 1 | 2;
      logicIndexHintForNewObject(): number;
    };
    expect(access.exitAIInfantryFactoryProduct(barr)).toBe(2);

    const produced = game.entities.find(e => e.type === UnitType.I_E1);
    expect(produced).toBeDefined();
    expect(produced!.logicIndexHint).toBe(43);
    expect(access.logicIndexHintForNewObject()).toBe(44);
  });

  it('WEAP Mission_Unload INITIAL forces the contacted unit through GUARD and returns unload jitter', () => {
    const game = new Game(createCanvas());
    const weap = makeStructure('WEAP', House.USSR, 50, 50);
    game.structures.push(weap);
    const harv = new Entity(UnitType.V_HARV, House.USSR, 50 * 24, 50 * 24);
    harv.mission = Mission.HARVEST;
    harv.missionTimer = 14;
    game.entities.push(harv);
    game.entityById.set(harv.id, harv);

    weap.mission = Mission.UNLOAD;
    weap.missionTimer = 0;
    weap.aiFactoryContactEntityId = harv.id;
    weap.weapUnloadStatus = 0;

    ScenarioRandom.seed = 0x12345678;
    ScenarioRandom.callCount = 0;

    const ranAttack = (game as unknown as {
      readonly _combatCtx: unknown;
      dispatchStructureMissionTimer(s: MapStructure, combatCtx: unknown, guardNormalDelay: number, guardAADelay: number): boolean;
    }).dispatchStructureMissionTimer(
      weap,
      (game as unknown as { readonly _combatCtx: unknown })._combatCtx,
      42,
      14,
    );

    expect(ranAttack).toBe(false);
    expect(ScenarioRandom.callCount).toBe(1);
    expect(weap.missionTimer).toBeGreaterThanOrEqual(14);
    expect(weap.missionTimer).toBeLessThanOrEqual(16);
    expect(weap.weapUnloadStatus).toBe(1);
    expect(weap.weapDoorState).toBe(1);
    expect(weap.weapDoorTimer).toBe(8);
    expect(harv.mission).toBe(Mission.GUARD);
    expect(harv.missionTimer).toBe(0);
  });

  it('WEAP DoorClass AI advances each control stage after the C++ 8-tick rate', () => {
    const game = new Game(createCanvas());
    const weap = makeStructure('WEAP', House.USSR, 50, 50);
    game.structures.push(weap);

    weap.mission = Mission.UNLOAD;
    weap.missionTimer = 0;
    weap.weapUnloadStatus = 0;

    (game as unknown as {
      readonly _combatCtx: unknown;
      dispatchStructureMissionTimer(s: MapStructure, combatCtx: unknown, guardNormalDelay: number, guardAADelay: number): boolean;
    }).dispatchStructureMissionTimer(
      weap,
      (game as unknown as { readonly _combatCtx: unknown })._combatCtx,
      42,
      14,
    );

    const access = game as unknown as { tickWeapDoorAI(s: MapStructure): void };
    for (let i = 0; i < 7; i++) access.tickWeapDoorAI(weap);
    expect(weap.weapDoorState).toBe(1);
    expect(weap.weapDoorStage).toBe(0);
    expect(weap.weapDoorTimer).toBe(1);

    access.tickWeapDoorAI(weap);
    expect(weap.weapDoorState).toBe(1);
    expect(weap.weapDoorStage).toBe(1);
    expect(weap.weapDoorTimer).toBe(8);
  });

  it('WEAP Mission_Unload CLEAR_BIB advances to OPEN when the factory exit is clear', () => {
    const game = new Game(createCanvas());
    const weap = makeStructure('WEAP', House.USSR, 50, 50);
    game.structures.push(weap);

    weap.mission = Mission.UNLOAD;
    weap.missionTimer = 0;
    weap.weapUnloadStatus = 1;
    weap.weapDoorState = 1;
    weap.weapDoorStage = 1;
    weap.weapDoorTimer = 8;

    ScenarioRandom.seed = 0x12345678;
    ScenarioRandom.callCount = 0;

    const ranAttack = (game as unknown as {
      readonly _combatCtx: unknown;
      dispatchStructureMissionTimer(s: MapStructure, combatCtx: unknown, guardNormalDelay: number, guardAADelay: number): boolean;
    }).dispatchStructureMissionTimer(
      weap,
      (game as unknown as { readonly _combatCtx: unknown })._combatCtx,
      42,
      14,
    );

    expect(ranAttack).toBe(false);
    expect(ScenarioRandom.callCount).toBe(1);
    expect(weap.weapUnloadStatus).toBe(2);
    expect(weap.mission).toBe(Mission.UNLOAD);
    expect(weap.missionTimer).toBeGreaterThanOrEqual(14);
    expect(weap.missionTimer).toBeLessThanOrEqual(16);
  });

  it('WEAP Mission_Unload CLEAR_BIB uses C++ ExitWeap[0], not the product unlimbo cell', () => {
    const game = new Game(createCanvas());
    game.map.setBounds(40, 40, 30, 30);
    for (let y = 40; y < 70; y++) {
      for (let x = 40; x < 70; x++) {
        game.map.setTerrain(x, y, Terrain.CLEAR);
      }
    }

    const weap = makeStructure('WEAP', House.USSR, 51, 45);
    game.structures.push(weap);
    markStructureFootprint(game.map, weap);

    const harv = new Entity(UnitType.V_HARV, House.USSR, 0, 0);
    harv.leptonX = 51 * 256 + 384;
    harv.leptonY = 45 * 256 + 256;
    harv.syncPosFromLeptons();
    harv.mission = Mission.HARVEST;
    harv.moveTarget = { lx: 33 * 256 + 128, ly: 51 * 256 + 128 };
    harv.path = [
      { cx: 51, cy: 46 },
      { cx: 50, cy: 46 },
      { cx: 49, cy: 46 },
    ];
    harv.drivePathFacings = [6, 6, 6];
    harv.isTethered = true;
    harv.isDriving = true;
    harv.trackNumber = 1;
    harv.trackControlIndex = 54;
    harv.headToLX = 51 * 256 + 128;
    harv.headToLY = 46 * 256 + 128;
    harv.bodyFacing256 = 192;
    harv.desiredFacing256 = 192;
    game.entities.push(harv);
    game.entityById.set(harv.id, harv);
    game.map.setVehicleOccupancy(harv.cell.cx, harv.cell.cy, harv.id);

    weap.mission = Mission.UNLOAD;
    weap.missionTimer = 0;
    weap.weapUnloadStatus = 1;
    weap.weapDoorState = 1;
    weap.weapDoorStage = 1;
    weap.weapDoorTimer = 2;
    weap.aiFactoryContactEntityId = harv.id;

    const originalTarget = { ...harv.moveTarget };
    ScenarioRandom.seed = 0x12345678;
    ScenarioRandom.callCount = 0;

    (game as unknown as {
      readonly _combatCtx: unknown;
      dispatchStructureMissionTimer(s: MapStructure, combatCtx: unknown, guardNormalDelay: number, guardAADelay: number): boolean;
    }).dispatchStructureMissionTimer(
      weap,
      (game as unknown as { readonly _combatCtx: unknown })._combatCtx,
      42,
      14,
    );

    expect(ScenarioRandom.callCount).toBe(1);
    expect(weap.weapUnloadStatus).toBe(2);
    expect(harv.moveTarget).toEqual(originalTarget);
    expect(harv.path[0]).toEqual({ cx: 51, cy: 46 });
  });

  it('WEAP Mission_Unload OPEN closes the door when radio contact already left', () => {
    const game = new Game(createCanvas());
    const weap = makeStructure('WEAP', House.USSR, 50, 50);
    game.structures.push(weap);
    const harv = new Entity(UnitType.V_HARV, House.USSR, 51 * 24, 52 * 24);
    harv.mission = Mission.HARVEST;
    harv.isTethered = false;
    game.entities.push(harv);
    game.entityById.set(harv.id, harv);

    weap.mission = Mission.UNLOAD;
    weap.missionTimer = 0;
    weap.aiFactoryContactEntityId = harv.id;
    weap.weapUnloadStatus = 2;
    weap.weapDoorState = 2;
    weap.weapDoorStage = 4;
    weap.weapDoorTimer = 0;

    ScenarioRandom.seed = 0x12345678;
    ScenarioRandom.callCount = 0;

    const ranAttack = (game as unknown as {
      readonly _combatCtx: unknown;
      dispatchStructureMissionTimer(s: MapStructure, combatCtx: unknown, guardNormalDelay: number, guardAADelay: number): boolean;
    }).dispatchStructureMissionTimer(
      weap,
      (game as unknown as { readonly _combatCtx: unknown })._combatCtx,
      42,
      14,
    );

    expect(ranAttack).toBe(false);
    expect(ScenarioRandom.callCount).toBe(1);
    expect(weap.weapUnloadStatus).toBe(4);
    expect(weap.weapDoorState).toBe(3);
    expect(weap.mission).toBe(Mission.UNLOAD);
  });

  it('WEAP Mission_Unload CLOSE waits while the door is still closing', () => {
    const game = new Game(createCanvas());
    const weap = makeStructure('WEAP', House.USSR, 50, 50);
    game.structures.push(weap);

    weap.mission = Mission.UNLOAD;
    weap.missionTimer = 0;
    weap.weapUnloadStatus = 4;
    weap.weapDoorState = 3;
    weap.weapDoorStage = 3;
    weap.weapDoorTimer = 1;

    ScenarioRandom.seed = 0x12345678;
    ScenarioRandom.callCount = 0;

    const ranAttack = (game as unknown as {
      readonly _combatCtx: unknown;
      dispatchStructureMissionTimer(s: MapStructure, combatCtx: unknown, guardNormalDelay: number, guardAADelay: number): boolean;
    }).dispatchStructureMissionTimer(
      weap,
      (game as unknown as { readonly _combatCtx: unknown })._combatCtx,
      42,
      14,
    );

    expect(ranAttack).toBe(false);
    expect(ScenarioRandom.callCount).toBe(1);
    expect(weap.mission).toBe(Mission.UNLOAD);
    expect(weap.missionTimer).toBeGreaterThanOrEqual(14);
    expect(weap.missionTimer).toBeLessThanOrEqual(16);
    expect(weap.weapUnloadStatus).toBe(4);
  });

  it('WEAP Mission_Unload CLOSE enters GUARD when DoorClass reports closed', () => {
    const game = new Game(createCanvas());
    const weap = makeStructure('WEAP', House.USSR, 50, 50);
    game.structures.push(weap);

    weap.mission = Mission.UNLOAD;
    weap.missionTimer = 0;
    weap.weapUnloadStatus = 4;
    weap.weapDoorState = 0;
    weap.weapDoorStage = 4;
    weap.weapDoorTimer = 0;
    weap.aiFactoryContactEntityId = 1234;

    ScenarioRandom.seed = 0x12345678;
    ScenarioRandom.callCount = 0;

    const ranAttack = (game as unknown as {
      readonly _combatCtx: unknown;
      dispatchStructureMissionTimer(s: MapStructure, combatCtx: unknown, guardNormalDelay: number, guardAADelay: number): boolean;
    }).dispatchStructureMissionTimer(
      weap,
      (game as unknown as { readonly _combatCtx: unknown })._combatCtx,
      42,
      14,
    );

    expect(ranAttack).toBe(false);
    expect(ScenarioRandom.callCount).toBe(1);
    expect(weap.mission).toBe(Mission.GUARD);
    expect(weap.missionTimer).toBe(0);
    expect(weap.weapUnloadStatus).toBe(0);
    expect(weap.aiFactoryContactEntityId).toBeUndefined();
  });

  it('structure MissionClass timer value 1 waits for frame advance before dispatching', () => {
    const game = new Game(createCanvas());
    const agun = makeStructure('AGUN', House.Greece, 55, 100);
    agun.weapon = { ...STRUCTURE_WEAPONS.AGUN };
    agun.mission = Mission.GUARD;
    agun.missionTimer = 1;
    game.structures.push(agun);

    ScenarioRandom.seed = 0x11223344;
    ScenarioRandom.callCount = 0;

    const ranAttack = (game as unknown as {
      readonly _combatCtx: unknown;
      dispatchStructureMissionTimer(s: MapStructure, combatCtx: unknown, guardNormalDelay: number, guardAADelay: number): boolean;
    }).dispatchStructureMissionTimer(
      agun,
      (game as unknown as { readonly _combatCtx: unknown })._combatCtx,
      42,
      14,
    );

    expect(ranAttack).toBe(false);
    expect(ScenarioRandom.callCount).toBe(0);
    expect(agun.mission).toBe(Mission.GUARD);
    expect(agun.missionTimer).toBe(1);

    decrementStructureCdTimersEndOfLogic(agun);
    expect(agun.missionTimer).toBe(0);
  });

  it('structure TarCom maintenance clears out-of-range targets while mission timer sleeps', () => {
    const game = new Game(createCanvas());
    const gun = makeStructure('GUN', House.Greece, 10, 10);
    gun.weapon = { ...STRUCTURE_WEAPONS.GUN };
    gun.mission = Mission.ATTACK;
    gun.missionTimer = 2;
    gun.turretFacing256 = 64;
    gun.desiredTurretFacing256 = 64;
    gun.turretDir = 2;
    gun.desiredTurretDir = 2;
    game.structures.push(gun);

    const target = new Entity(UnitType.V_HTNK, House.USSR, 30 * 24, 10 * 24);
    game.entities.push(target);
    game.entityById.set(target.id, target);
    gun.targetEntityId = target.id;

    (game as unknown as { update(): void }).update();

    expect(gun.targetEntityId).toBeUndefined();
    expect(gun.mission).toBe(Mission.ATTACK);
    expect(gun.missionTimer).toBe(1);
    expect(gun.desiredTurretFacing256).toBe(64);
  });

  it('AI harvester Mission_Guard queues HARVEST after the same-tick DriveClass turn', () => {
    const game = new Game(createCanvas());
    const proc = makeStructure('PROC', House.USSR, 46, 46);
    game.structures.push(proc);
    const harv = new Entity(UnitType.V_HARV, House.USSR, 50 * 24, 50 * 24);
    harv.mission = Mission.GUARD;
    harv.missionTimer = 0;
    harv.moveTarget = { lx: 33 * 256 + 128, ly: 51 * 256 + 128 };
    harv.path = [
      { cx: 49, cy: 50 },
      { cx: 48, cy: 50 },
    ];
    harv.bodyFacing256 = 133;
    harv.desiredFacing256 = 192;
    harv.facing = 4;
    harv.desiredFacing = 6;
    game.entities.push(harv);
    game.entityById.set(harv.id, harv);

    ScenarioRandom.seed = 0x87654321;
    ScenarioRandom.callCount = 0;

    (game as unknown as { dispatchMission(entity: Entity, missionTimerFired: boolean): void })
      .dispatchMission(harv, true);

    expect(ScenarioRandom.callCount).toBe(0);
    expect(harv.mission).toBe(Mission.GUARD);
    expect(harv.missionQueue).toBe(Mission.HARVEST);
    expect(harv.missionTimer).toBe(1);
    expect(harv.bodyFacing256).toBe(138);
    expect(harv.isDriving).toBe(false);
  });
});
