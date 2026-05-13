/**
 * @vitest-environment jsdom
 *
 * C++ behavioral parity for applying TACTION_DESTROY_OBJECT.
 *
 * taction.cpp:690-752 first destroys the object passed to Spring(), then
 * iterates Units, Infantry, Aircraft, and Buildings and destroys every object
 * whose Trigger pointer is the same trigger. The attached-object sweep happens
 * even when the trigger was also attached to cells.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type MapStructure, parseScenarioINI, STRUCTURE_MAX_HP, type ScenarioTrigger, type TriggerActionResult,
} from '../engine/scenario';
import { CELL_SIZE, House, Mission, RESFACTOR, UnitType } from '../engine/types';
import { ScenarioRandom } from '../engine/random';
import { Terrain } from '../engine/map';
import { combatAnim } from '../engine/combat';

const TEMPLATE_BRIDGE1H = 378;
const TEMPLATE_BRIDGE1D = 132;
const SCU01_BRIDGE_CELL = 9392; // x=48,y=73; last [CellTriggers] brdg assignment in SCU01EA.

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

function createGame(): Game {
  const game = new Game(createCanvas());
  game.map.setBounds(0, 0, 128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      game.map.setTerrain(x, y, 0);
    }
  }
  return game;
}

function makeStructure(type: string, house: House, cx: number, cy: number, triggerName: string): MapStructure {
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
    mission: Mission.GUARD,
    missionTimer: 0,
    triggerName,
  } as MapStructure;
}

function makeTrigger(name: string, triggeringEntityIds: number[]): ScenarioTrigger {
  return {
    name,
    persistence: 0,
    house: 0,
    eventControl: 0,
    actionControl: 0,
    event1: { type: 6, team: -1, data: 2 },
    event2: { type: 0, team: -1, data: 0 },
    action1: { action: 32, team: -1, trigger: -1, data: 0 },
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
    triggeringEntityIds,
    attachCount: 0,
    remainingAttachCount: 0,
  };
}

function applyDestroyObject(game: Game, trigger: ScenarioTrigger): void {
  const result: TriggerActionResult = { spawned: [], destroyTriggeringUnit: true };
  (game as unknown as {
    applyTriggerActionResult(result: TriggerActionResult, trigger: ScenarioTrigger): void;
  }).applyTriggerActionResult(result, trigger);
}

function springAttackedTrigger(game: Game, triggerName: string): void {
  (game as unknown as { springAttackedTriggerByName(triggerName: string): void })
    .springAttackedTriggerByName(triggerName);
}

function processTriggers(game: Game): void {
  (game as unknown as { processTriggers(springEvent?: number): void })
    .processTriggers(13);
}

function setTemplate(game: Game, cx: number, cy: number, templateType: number, icon: number): void {
  const idx = cy * 128 + cx;
  game.map.templateType[idx] = templateType;
  game.map.templateIcon[idx] = icon;
}

function seedScu01HalfBridge(game: Game): void {
  // BRIDGE1H is a 5x3 iconset. These cells match the SCU01EA bridge footprint
  // around the brdg trigger cell and let Destroy_Bridge_At recover the C++ origin.
  for (const [cx, cy, icon] of [
    [46, 72, 1], [47, 72, 2], [48, 72, 3], [49, 72, 4],
    [45, 73, 5], [46, 73, 6], [47, 73, 7], [48, 73, 8], [49, 73, 9],
    [47, 74, 12],
  ] as const) {
    setTemplate(game, cx, cy, TEMPLATE_BRIDGE1H, icon);
  }
  game.bridgeCellCount = game.map.countBridgeCells();
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

beforeEach(() => {
  resetEntityIds();
  ScenarioRandom.seed = 0x12345678;
  ScenarioRandom.callCount = 0;
});

describe('TACTION_DESTROY_OBJECT application parity', () => {
  it('records the final CellTriggers cell on the trigger for forced springs', () => {
    const data = parseScenarioINI(`
[Basic]
Name=cell trigger parse
[Trigs]
brdg=0,0,0,1,0,-1,20,27,-1,20,32,-1,-1,-1,32,-1,-1,-1
[CellTriggers]
9263=brdg
9264=brdg
9392=brdg
`, 'TEST');

    expect(data.triggers.find(t => t.name === 'brdg')?.cell).toBe(SCU01_BRIDGE_CELL);
  });

  it('destroys attached structures even when a triggering cell entity is recorded', () => {
    const game = createGame();
    const entrant = new Entity(UnitType.V_JEEP, House.Greece, 10 * CELL_SIZE + 12, 10 * CELL_SIZE + 12);
    game.entities.push(entrant);
    game.entityById.set(entrant.id, entrant);

    const a = makeStructure('BRL3', House.Germany, 51, 72, 'jeep');
    const b = makeStructure('BARL', House.Germany, 50, 72, 'jeep');
    const c = makeStructure('BARL', House.Germany, 47, 70, 'jeep');
    game.structures.push(a, b, c);

    const trigger = makeTrigger('jeep', [entrant.id]);
    applyDestroyObject(game, trigger);

    expect(entrant.alive).toBe(false);
    expect(a.alive).toBe(false);
    expect(b.alive).toBe(false);
    expect(c.alive).toBe(false);
  });

  it('object-level springs ignore stale cell-trigger entity ids', () => {
    const game = createGame();
    const entrant = new Entity(UnitType.V_JEEP, House.Greece, 10 * CELL_SIZE + 12, 10 * CELL_SIZE + 12);
    game.entities.push(entrant);
    game.entityById.set(entrant.id, entrant);

    const a = makeStructure('BRL3', House.Germany, 51, 72, 'jeep');
    const b = makeStructure('BARL', House.Germany, 50, 72, 'jeep');
    const c = makeStructure('BARL', House.Germany, 47, 70, 'jeep');
    game.structures.push(a, b, c);

    const trigger = makeTrigger('jeep', [entrant.id]);
    trigger.action1 = { action: 32, team: -1, trigger: -1, data: 0 };
    game.triggers.push(trigger);

    springAttackedTrigger(game, 'jeep');

    expect(entrant.alive).toBe(true);
    expect(a.alive).toBe(false);
    expect(b.alive).toBe(false);
    expect(c.alive).toBe(false);
    expect(trigger.triggeringEntityIds).toEqual([]);
  });

  it('force-triggered DESTROY_OBJECT springs synchronously without stale cell entrants', () => {
    const game = createGame();
    const entrant = new Entity(UnitType.V_JEEP, House.Greece, 10 * CELL_SIZE + 12, 10 * CELL_SIZE + 12);
    game.entities.push(entrant);
    game.entityById.set(entrant.id, entrant);

    const jeep = makeTrigger('jeep', []);
    jeep.actionControl = 1;
    jeep.action1 = { action: 0, team: -1, trigger: -1, data: 0 };
    jeep.action2 = { action: 22, team: -1, trigger: 1, data: -1 };

    const brdg = makeTrigger('brdg', [entrant.id]);
    brdg.event1 = { type: 0, team: -1, data: 20 };
    brdg.event2 = { type: 27, team: -1, data: 20 };
    brdg.actionControl = 1;
    brdg.action1 = { action: 32, team: -1, trigger: -1, data: -1 };
    brdg.action2 = { action: 32, team: -1, trigger: -1, data: -1 };
    brdg.cell = SCU01_BRIDGE_CELL;
    seedScu01HalfBridge(game);

    game.triggers.push(jeep, brdg);

    springAttackedTrigger(game, 'jeep');

    expect(brdg.forceFirePending).toBe(false);
    expect(brdg.fired).toBe(true);
    expect(brdg.triggeringEntityIds).toEqual([]);
    expect(entrant.alive).toBe(true);
    expect(game.map.templateType[SCU01_BRIDGE_CELL]).toBe(TEMPLATE_BRIDGE1D);
    expect(game.map.getTerrain(49, 72)).toBe(Terrain.RIVER);
    expect(combatAnim(200, 3, game.map.getTerrain(49, 72) === Terrain.WATER ? 'water' : 'ground')).toBe('napalm3');
    expect(game.logicAnims
      .filter(a => a.type === 'napalm3' && Math.floor(a.x / CELL_SIZE) === 47 && Math.floor(a.y / CELL_SIZE) === 73))
      .toHaveLength(1);

    processTriggers(game);

    expect(entrant.alive).toBe(true);
  });
});
