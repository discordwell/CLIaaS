/**
 * @vitest-environment jsdom
 *
 * C++ Behavioral Parity: reentrant combat context
 *
 * C++ runs nested damage from trigger actions inside the same active logic pass.
 * Projectiles created by that nested damage remain in the Logic list and can run
 * later in the same frame.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import type { CombatContext, InflightProjectile } from '../engine/combat';
import { structureDamage, tickDestroyedStructureDebris } from '../engine/combat';
import {
  CELL_SIZE, House, Mission, RESFACTOR, UnitType,
} from '../engine/types';
import type { MapStructure, ScenarioTrigger } from '../engine/scenario';
import { STRUCTURE_ARMOR } from '../engine/scenario';
import {
  Team, TMISSION_ATT_WAYPT, TMISSION_DO, clearAllTeams, registerTeam,
} from '../engine/team';

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 320 * RESFACTOR;
  canvas.height = 200 * RESFACTOR;
  return canvas;
}

function makeStructure(overrides: Partial<MapStructure>): MapStructure {
  const type = overrides.type ?? 'BARL';
  const maxHp = overrides.maxHp ?? (type === 'FTUR' ? 400 : 10);
  return {
    type,
    image: type.toLowerCase(),
    house: House.BadGuy,
    cx: 0,
    cy: 0,
    hp: maxHp,
    maxHp,
    armor: STRUCTURE_ARMOR[type] ?? 'wood',
    alive: true,
    rubble: false,
    mission: Mission.GUARD,
    missionTimer: 0,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    ...overrides,
  };
}

function attackedDestroyObjectTrigger(name: string): ScenarioTrigger {
  return {
    name,
    persistence: 0,
    house: 0,
    eventControl: 0,
    actionControl: 0,
    event1: { type: 6, team: -1, data: 0 },
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
    triggeringEntityIds: [],
    attachCount: 3,
    remainingAttachCount: 3,
  };
}

type CombatGameAccess = {
  _runCombat<T>(fn: (ctx: CombatContext) => T): T;
  inflightProjectiles: InflightProjectile[];
  triggers: ScenarioTrigger[];
};

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

beforeEach(() => {
  resetEntityIds();
  clearAllTeams();
});

describe('combat context reentry', () => {
  it('keeps barrel projectiles spawned by nested ATTACKED destroy-object damage', () => {
    const game = new Game(createCanvas());
    const access = game as unknown as CombatGameAccess;
    game.playerHouse = House.USSR;
    game.scenarioId = 'SCU03EA';
    game.map.setBounds(0, 0, 128, 128);
    game.structures = [
      makeStructure({ type: 'FTUR', cx: 75, cy: 32, hp: 400, maxHp: 400, triggerName: 'flt2' }),
      makeStructure({ type: 'BARL', cx: 73, cy: 31, hp: 10, maxHp: 10, triggerName: 'flt2' }),
      makeStructure({ type: 'BARL', cx: 72, cy: 31, hp: 10, maxHp: 10, triggerName: 'flt2' }),
    ];
    access.triggers = [attackedDestroyObjectTrigger('flt2')];
    const attacker = new Entity(UnitType.I_E3, House.Greece, 72 * CELL_SIZE + CELL_SIZE / 2, 31 * CELL_SIZE + CELL_SIZE / 2);

    access._runCombat(ctx => structureDamage(ctx, game.structures[2], 10, attacker, 'AP'));

    expect(game.structures.map(s => s.alive)).toEqual([false, false, false]);
    const barrelProjectiles = access.inflightProjectiles.filter(p => p.weapon.name === 'BarrelFire');
    expect(barrelProjectiles).toHaveLength(8);
    expect(new Set(barrelProjectiles.map(p => `${p.startX},${p.startY}`))).toEqual(new Set([
      `${72 * CELL_SIZE + CELL_SIZE / 2},${31 * CELL_SIZE + CELL_SIZE / 2}`,
      `${73 * CELL_SIZE + CELL_SIZE / 2},${31 * CELL_SIZE + CELL_SIZE / 2}`,
    ]));
  });

  it('keeps dead cell objects legal for attack-waypoint until debris removal', () => {
    const game = new Game(createCanvas());
    const access = game as unknown as CombatGameAccess;
    game.playerHouse = House.USSR;
    game.scenarioId = 'SCU03EA';
    game.map.setBounds(0, 0, 128, 128);

    const barrel = makeStructure({ type: 'BARL', cx: 20, cy: 20, hp: 10, maxHp: 10 });
    const rocket = new Entity(UnitType.I_E3, House.Greece, 18 * CELL_SIZE + CELL_SIZE / 2, 20 * CELL_SIZE + CELL_SIZE / 2);
    game.structures = [barrel];
    game.entities = [rocket];
    game.entityById.set(rocket.id, rocket);

    const team = new Team({
      typeName: 'attack-barrel',
      house: House.Greece,
      desiredMembers: [{ type: UnitType.I_E3, count: 1 }],
      missionList: [
        { mission: TMISSION_ATT_WAYPT, data: 37 },
        { mission: TMISSION_DO, data: 14 },
      ],
      isReinforcable: false,
      forcedActive: true,
    });
    team.add(rocket);
    registerTeam(team);

    const waypoints = new Map([[37, { cx: 20, cy: 20 }]]);
    access._runCombat(ctx => {
      team.ai(waypoints, ctx);
      expect(rocket.missionQueue).toBe(Mission.ATTACK);
      expect(rocket.targetStructure).toBe(barrel);

      structureDamage(ctx, barrel, 10, undefined, 'AP', { skipBaseAttack: true });
      expect(barrel.alive).toBe(false);
      expect(barrel.debrisCountdown).toBe(8);
      expect(rocket.targetStructure).toBeNull();

      team.ai(waypoints, ctx);
      expect(team.currentMission).toBe(0);
      expect(team.isNextMission).toBe(false);
      expect(rocket.missionQueue).toBe(Mission.ATTACK);
      expect(rocket.targetStructure).toBeNull();

      barrel.debrisDropTick = ctx.tick;
      expect(tickDestroyedStructureDebris(ctx, barrel)).toBe(true);
      team.ai(waypoints, ctx);
      expect(team.isNextMission).toBe(true);

      team.ai(waypoints, ctx);
      expect(team.currentMission).toBe(1);
      expect(rocket.missionQueue).toBe(Mission.HUNT);
      expect(rocket.targetStructure).toBeNull();
    });
  });
});
