/**
 * @vitest-environment jsdom
 *
 * C++ Behavioral Parity: HouseClass Active*Scan for trigger events.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import type { MapStructure, ScenarioTrigger } from '../engine/scenario';
import { CELL_SIZE, House, Mission, RESFACTOR, UnitType } from '../engine/types';

class FakeAudio {
  src = ''; preload = ''; volume = 1; currentTime = 0; muted = false; loop = false;
  addEventListener(): void {}
  removeEventListener(): void {}
  play(): Promise<void> { return Promise.resolve(); }
  pause(): void {}
  cloneNode(): FakeAudio { return new FakeAudio(); }
}

interface TriggerHouseSnapshot {
  houseAlive: Map<number, boolean>;
  houseUnitsAlive: Map<number, boolean>;
  houseBuildingsAlive: Map<number, boolean>;
  structureTypesByHouse: Map<number, Set<string>>;
  activeStructureTypesByHouse: Map<number, Set<string>>;
  buildingsDestroyedByHouse: Map<number, boolean>;
}

const HOUSE_SPAIN = 0;
const HOUSE_GREECE = 1; // C++ HousesType index, used by TEVENT_ALL_DESTROYED data.

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 320 * RESFACTOR;
  canvas.height = 200 * RESFACTOR;
  return canvas;
}

function createGame(): Game {
  const game = new Game(createCanvas());
  game.map.setBounds(0, 0, 128, 128);
  return game;
}

function addEntity(game: Game, entity: Entity): void {
  game.entities.push(entity);
  game.entityById.set(entity.id, entity);
}

function addStructure(game: Game, structure: MapStructure): void {
  game.structures.push(structure);
}

function makeStructure(type: string, house: House, cx: number, cy: number): MapStructure {
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: 256,
    maxHp: 256,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    missionTimer: 0,
  } as MapStructure;
}

function buildTriggerSharedSnapshot(game: Game): TriggerHouseSnapshot {
  return (game as unknown as {
    buildTriggerSharedSnapshot(): TriggerHouseSnapshot;
  }).buildTriggerSharedSnapshot();
}

function markPlayerMappedSight(game: Game, cx: number, cy: number, radius: number): void {
  (game as unknown as {
    markPlayerMappedSight(cx: number, cy: number, radius: number): boolean;
  }).markPlayerMappedSight(cx, cy, radius);
}

function cleanupCompletedInfantryDeathAnimations(game: Game): void {
  (game as unknown as {
    cleanupCompletedInfantryDeathAnimations(): void;
  }).cleanupCompletedInfantryDeathAnimations();
}

function updateGame(game: Game): void {
  (game as unknown as { update(): void }).update();
}

function makeTrigger(overrides: Partial<ScenarioTrigger> = {}): ScenarioTrigger {
  return {
    name: 'lose',
    persistence: 0,
    house: 0,
    eventControl: 0,
    actionControl: 0,
    event1: { type: 11, team: -1, data: HOUSE_GREECE },
    event2: { type: 0, team: -1, data: 0 },
    action1: { action: 2, team: -1, trigger: -1, data: 0 },
    action2: { action: 0, team: -1, trigger: -1, data: 0 },
    fired: false,
    timerTick: 0,
    playerEntered: false,
    playerEnteredHouse: -1,
    objectDiscovered: false,
    enteredZone: false,
    crossedHorizontal: false,
    crossedVertical: false,
    forceFirePending: false,
    pendingDestroyedCount: 0,
    triggeringEntityIds: [],
    attachCount: 0,
    remainingAttachCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  resetEntityIds();
  vi.restoreAllMocks();
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

describe('Trigger house active scan parity', () => {
  it('LogicTriggers.Spring(TEVENT_TIME) evaluates ALL_DESTROYED on non-15 ticks', () => {
    const game = createGame();
    game.state = 'playing';
    (game as unknown as { tick: number }).tick = 199;
    (game as unknown as { triggers: ScenarioTrigger[] }).triggers = [makeTrigger()];

    updateGame(game);

    expect((game as unknown as { isToLose: boolean }).isToLose).toBe(true);
    expect((game as unknown as { borrowedTime: number }).borrowedTime).toBe(24);
    expect((game as unknown as { triggers: ScenarioTrigger[] }).triggers[0].fired).toBe(true);
  });

  it('counts zero-strength infantry death animations as house-active until Logic removal', () => {
    const game = createGame();
    const corpse = new Entity(UnitType.I_E1, House.Greece, 70 * CELL_SIZE, 59 * CELL_SIZE);
    corpse.isLocked = true;
    corpse.alive = false;
    corpse.hp = 0;
    corpse.mission = Mission.DIE;
    corpse.deathVariant = 1;
    const deathDuration = corpse.infantryDeathDurationTicks();
    expect(deathDuration).toBeGreaterThan(0);
    corpse.deathTick = deathDuration - 1;
    addEntity(game, corpse);

    let snapshot = buildTriggerSharedSnapshot(game);

    expect(corpse.occupiesCppLogic()).toBe(true);
    expect(snapshot.houseAlive.get(HOUSE_GREECE)).toBe(true);
    expect(snapshot.houseUnitsAlive.get(HOUSE_GREECE)).toBe(true);

    corpse.deathTick = deathDuration;
    cleanupCompletedInfantryDeathAnimations(game);
    snapshot = buildTriggerSharedSnapshot(game);

    expect(corpse.occupiesCppLogic()).toBe(false);
    expect(game.entities).not.toContain(corpse);
    expect(game.entityById.has(corpse.id)).toBe(false);
    expect(snapshot.houseAlive.get(HOUSE_GREECE)).not.toBe(true);
    expect(snapshot.houseUnitsAlive.get(HOUSE_GREECE)).not.toBe(true);
  });

  it('does not let undiscovered human-house buildings satisfy ActiveBScan', () => {
    const game = createGame();
    game.playerHouse = House.Spain;
    addStructure(game, makeStructure('FACT', House.Spain, 80, 80));

    const snapshot = buildTriggerSharedSnapshot(game);

    expect(snapshot.structureTypesByHouse.get(HOUSE_SPAIN)?.has('FACT')).toBe(true);
    expect(snapshot.activeStructureTypesByHouse.get(HOUSE_SPAIN)?.has('FACT')).not.toBe(true);
    expect(snapshot.houseAlive.get(HOUSE_SPAIN)).not.toBe(true);
    expect(snapshot.houseBuildingsAlive.get(HOUSE_SPAIN)).not.toBe(true);
    expect(snapshot.buildingsDestroyedByHouse.get(HOUSE_SPAIN)).toBe(true);
  });

  it('counts mapped human-house buildings in ActiveBScan', () => {
    const game = createGame();
    game.playerHouse = House.Spain;
    addStructure(game, makeStructure('FACT', House.Spain, 20, 20));
    markPlayerMappedSight(game, 20, 20, 1);

    const snapshot = buildTriggerSharedSnapshot(game);

    expect(snapshot.activeStructureTypesByHouse.get(HOUSE_SPAIN)?.has('FACT')).toBe(true);
    expect(snapshot.houseAlive.get(HOUSE_SPAIN)).toBe(true);
    expect(snapshot.houseBuildingsAlive.get(HOUSE_SPAIN)).toBe(true);
    expect(snapshot.buildingsDestroyedByHouse.get(HOUSE_SPAIN)).not.toBe(true);
  });

  it('does not let barrel-class structures keep a house active', () => {
    const game = createGame();
    game.playerHouse = House.Spain;
    addStructure(game, makeStructure('BARL', House.Spain, 20, 20));
    addStructure(game, makeStructure('BRL3', House.Spain, 21, 20));
    markPlayerMappedSight(game, 20, 20, 3);

    const snapshot = buildTriggerSharedSnapshot(game);

    expect(snapshot.structureTypesByHouse.get(HOUSE_SPAIN)?.has('BARL')).toBe(true);
    expect(snapshot.structureTypesByHouse.get(HOUSE_SPAIN)?.has('BRL3')).toBe(true);
    expect(snapshot.activeStructureTypesByHouse.get(HOUSE_SPAIN)).toBeUndefined();
    expect(snapshot.houseAlive.get(HOUSE_SPAIN)).not.toBe(true);
    expect(snapshot.houseBuildingsAlive.get(HOUSE_SPAIN)).not.toBe(true);
  });
});
