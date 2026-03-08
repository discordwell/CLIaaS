/**
 * Tests for Agent 8: Trigger events/actions (TR3/TR4/TR5) and AI threat scoring (AI2/AI4/AI5/AI6).
 * Verifies C++ parity for trigger system constants and threatScore rewrite.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkTriggerEvent,
  executeTriggerAction,
  type TriggerGameState,
  type TriggerEvent,
  type TriggerAction,
  type TeamType,
  type ScenarioTrigger,
} from '../engine/scenario';
import { Entity, resetEntityIds, threatScore } from '../engine/entity';
import { House, UnitType } from '../engine/types';
import type { CellPos } from '../engine/types';

// === Helpers ===

beforeEach(() => resetEntityIds());

/** Create a minimal TriggerGameState with defaults */
function createState(overrides: Partial<TriggerGameState> = {}): TriggerGameState {
  return {
    gameTick: 0,
    globals: new Set(),
    triggerStartTick: 0,
    triggerName: 'test',
    playerEntered: false,
    enemyUnitsAlive: 0,
    enemyKillCount: 0,
    playerFactories: 0,
    missionTimerExpired: false,
    bridgesAlive: 0,
    unitsLeftMap: 0,
    structureTypes: new Set(),
    builtStructureTypes: new Set(),
    destroyedTriggerNames: new Set(),
    attackedTriggerNames: new Set(),
    houseAlive: new Map(),
    houseUnitsAlive: new Map(),
    houseBuildingsAlive: new Map(),
    isLowPower: false,
    playerCredits: 0,
    buildingsDestroyedByHouse: new Map(),
    nBuildingsDestroyed: 0,
    playerFactoriesExist: true,
    civiliansEvacuated: 0,
    builtUnitTypes: new Set(),
    builtInfantryTypes: new Set(),
    builtAircraftTypes: new Set(),
    fakesExist: true,
    spiedBuildings: new Set(),
    isThieved: false,
    ...overrides,
  };
}

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

// Empty trigger helpers for executeTriggerAction
const emptyTeamTypes: TeamType[] = [];
const emptyWaypoints = new Map<number, CellPos>();
const emptyGlobals = new Set<number>();
const emptyTriggers: ScenarioTrigger[] = [];

// === TR3: Missing trigger events ===

describe('TR3: New trigger event constants', () => {
  it('TEVENT_SPIED (2) fires when building is spied', () => {
    const event: TriggerEvent = { type: 2, team: -1, data: 0 };
    const stateNotSpied = createState({ spiedBuildings: new Set() });
    const stateSpied = createState({ spiedBuildings: new Set(['test']) });

    expect(checkTriggerEvent(event, stateNotSpied)).toBe(false);
    expect(checkTriggerEvent(event, stateSpied)).toBe(true);
  });

  it('TEVENT_BUILDINGS_DESTROYED (10) fires when all buildings of a house destroyed', () => {
    const event: TriggerEvent = { type: 10, team: -1, data: 2 }; // house 2 = USSR
    const stateAlive = createState({ buildingsDestroyedByHouse: new Map([[2, false]]) });
    const stateDestroyed = createState({ buildingsDestroyedByHouse: new Map([[2, true]]) });

    expect(checkTriggerEvent(event, stateAlive)).toBe(false);
    expect(checkTriggerEvent(event, stateDestroyed)).toBe(true);
  });

  it('TEVENT_NBUILDINGS_DESTROYED (15) fires when N buildings destroyed', () => {
    const event: TriggerEvent = { type: 15, team: -1, data: 5 };
    const stateBelow = createState({ nBuildingsDestroyed: 4 });
    const stateAtThreshold = createState({ nBuildingsDestroyed: 5 });
    const stateAbove = createState({ nBuildingsDestroyed: 8 });

    expect(checkTriggerEvent(event, stateBelow)).toBe(false);
    expect(checkTriggerEvent(event, stateAtThreshold)).toBe(true);
    expect(checkTriggerEvent(event, stateAbove)).toBe(true);
  });

  it('TEVENT_NOFACTORIES (17) fires when no factories remain', () => {
    const event: TriggerEvent = { type: 17, team: -1, data: 0 };
    const stateHasFactory = createState({ playerFactoriesExist: true });
    const stateNoFactory = createState({ playerFactoriesExist: false });

    expect(checkTriggerEvent(event, stateHasFactory)).toBe(false);
    expect(checkTriggerEvent(event, stateNoFactory)).toBe(true);
  });

  it('TEVENT_EVAC_CIVILIAN (18) fires when civilian evacuated', () => {
    const event: TriggerEvent = { type: 18, team: -1, data: 0 };
    const stateNone = createState({ civiliansEvacuated: 0 });
    const stateEvacuated = createState({ civiliansEvacuated: 1 });

    expect(checkTriggerEvent(event, stateNone)).toBe(false);
    expect(checkTriggerEvent(event, stateEvacuated)).toBe(true);
  });

  it('TEVENT_BUILD_UNIT (20) fires when specified unit type is built', () => {
    // data=0 maps to HARV in C++ UnitType enum
    const event: TriggerEvent = { type: 20, team: -1, data: 0 };
    const stateNone = createState({ builtUnitTypes: new Set() });
    const stateWrong = createState({ builtUnitTypes: new Set(['LTNK']) });
    const stateBuilt = createState({ builtUnitTypes: new Set(['HARV']) });

    expect(checkTriggerEvent(event, stateNone)).toBe(false);
    expect(checkTriggerEvent(event, stateWrong)).toBe(false);
    expect(checkTriggerEvent(event, stateBuilt)).toBe(true);
  });

  it('TEVENT_BUILD_UNIT (20) with data=1 matches 1TNK', () => {
    const event: TriggerEvent = { type: 20, team: -1, data: 1 };
    const stateBuilt = createState({ builtUnitTypes: new Set(['1TNK']) });
    const stateOther = createState({ builtUnitTypes: new Set(['HARV']) });

    expect(checkTriggerEvent(event, stateBuilt)).toBe(true);
    expect(checkTriggerEvent(event, stateOther)).toBe(false);
  });

  it('TEVENT_BUILD_INFANTRY (21) fires when specified infantry type is built', () => {
    // data=0 maps to E1 in C++ InfantryType enum
    const event: TriggerEvent = { type: 21, team: -1, data: 0 };
    const stateNone = createState({ builtInfantryTypes: new Set() });
    const stateWrong = createState({ builtInfantryTypes: new Set(['E3']) });
    const stateBuilt = createState({ builtInfantryTypes: new Set(['E1']) });

    expect(checkTriggerEvent(event, stateNone)).toBe(false);
    expect(checkTriggerEvent(event, stateWrong)).toBe(false);
    expect(checkTriggerEvent(event, stateBuilt)).toBe(true);
  });

  it('TEVENT_BUILD_AIRCRAFT (22) fires when specified aircraft type is built', () => {
    // data=0 maps to TRAN in C++ AircraftType enum
    const event: TriggerEvent = { type: 22, team: -1, data: 0 };
    const stateNone = createState({ builtAircraftTypes: new Set() });
    const stateWrong = createState({ builtAircraftTypes: new Set(['HIND']) });
    const stateBuilt = createState({ builtAircraftTypes: new Set(['TRAN']) });

    expect(checkTriggerEvent(event, stateNone)).toBe(false);
    expect(checkTriggerEvent(event, stateWrong)).toBe(false);
    expect(checkTriggerEvent(event, stateBuilt)).toBe(true);
  });

  it('TEVENT_BUILD_UNIT with unknown data falls back to any-built check', () => {
    const event: TriggerEvent = { type: 20, team: -1, data: 999 };
    const stateNone = createState({ builtUnitTypes: new Set() });
    const stateAny = createState({ builtUnitTypes: new Set(['HARV']) });

    expect(checkTriggerEvent(event, stateNone)).toBe(false);
    expect(checkTriggerEvent(event, stateAny)).toBe(true);
  });

  it('TEVENT_FAKES_DESTROYED (29) fires when no fakes remain', () => {
    const event: TriggerEvent = { type: 29, team: -1, data: 0 };
    const stateHasFakes = createState({ fakesExist: true });
    const stateNoFakes = createState({ fakesExist: false });

    expect(checkTriggerEvent(event, stateHasFakes)).toBe(false);
    expect(checkTriggerEvent(event, stateNoFakes)).toBe(true);
  });
});

// === TR4: Missing trigger actions ===

describe('TR4: New trigger action constants', () => {
  it('TACTION_FIRE_SALE (9) sets fireSale result', () => {
    const action: TriggerAction = { action: 9, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.fireSale).toBe(true);
  });

  it('TACTION_PLAY_MOVIE (10) sets playMovie result', () => {
    const action: TriggerAction = { action: 10, team: -1, trigger: -1, data: 5 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.playMovie).toBe(5);
  });

  it('TACTION_REVEAL_ZONE (18) sets revealZone result', () => {
    const action: TriggerAction = { action: 18, team: -1, trigger: -1, data: 3 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.revealZone).toBe(3);
  });

  it('TACTION_PLAY_MUSIC (20) sets playMusic result', () => {
    const action: TriggerAction = { action: 20, team: -1, trigger: -1, data: 7 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.playMusic).toBe(7);
  });

  it('TACTION_PLAY_SPEECH (21) sets playSpeech result', () => {
    const action: TriggerAction = { action: 21, team: -1, trigger: -1, data: 88 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.playSpeech).toBe(88);
  });

  it('TACTION_CREEP_SHADOW (31) sets creepShadow result', () => {
    const action: TriggerAction = { action: 31, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.creepShadow).toBe(true);
  });

  it('TACTION_DESTROY_OBJECT (32) sets destroyTriggeringUnit result', () => {
    const action: TriggerAction = { action: 32, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.destroyTriggeringUnit).toBe(true);
  });

  it('TACTION_PREFERRED_TARGET (35) sets preferredTarget result', () => {
    const action: TriggerAction = { action: 35, team: -1, trigger: -1, data: 2 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.preferredTarget).toBe(2);
  });
});

// === TR5: Event index mapping verification ===

describe('TR5: Event index mapping matches C++ tevent.h', () => {
  it('TEVENT_NONE (0) never fires on its own', () => {
    const event: TriggerEvent = { type: 0, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState())).toBe(false);
  });

  it('TEVENT_PLAYER_ENTERED (1) fires on playerEntered', () => {
    const event: TriggerEvent = { type: 1, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState({ playerEntered: true }))).toBe(true);
  });

  it('TEVENT_SPIED at index 2 (C++ matches)', () => {
    const event: TriggerEvent = { type: 2, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState({ spiedBuildings: new Set(['test']) }))).toBe(true);
  });

  it('TEVENT_THIEVED at index 3 (C++ House.IsThieved)', () => {
    const event: TriggerEvent = { type: 3, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState({ isThieved: false }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ isThieved: true }))).toBe(true);
  });

  it('TEVENT_DISCOVERED at index 4 (C++ matches)', () => {
    const event: TriggerEvent = { type: 4, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState({ playerEntered: true }))).toBe(true);
  });

  it('TEVENT_HOUSE_DISCOVERED at index 5 (C++ matches, was 3)', () => {
    const event: TriggerEvent = { type: 5, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState({ playerEntered: true }))).toBe(true);
  });

  it('TEVENT_ANY at index 8 always fires', () => {
    const event: TriggerEvent = { type: 8, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState())).toBe(true);
  });

  it('TEVENT_UNITS_DESTROYED at index 9 (C++ matches, was 26)', () => {
    const event: TriggerEvent = { type: 9, team: -1, data: 2 };
    // C++ semantics: all units (not buildings) of house destroyed (house index in event.data)
    expect(checkTriggerEvent(event, createState({ houseUnitsAlive: new Map([[2, false]]) }))).toBe(true);
    expect(checkTriggerEvent(event, createState({ houseUnitsAlive: new Map([[2, true]]) }))).toBe(false);
  });

  it('TEVENT_CREDITS at index 12 (C++ matches, was 30)', () => {
    const event: TriggerEvent = { type: 12, team: -1, data: 1000 };
    expect(checkTriggerEvent(event, createState({ playerCredits: 500 }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ playerCredits: 1500 }))).toBe(true);
  });

  it('TEVENT_LOW_POWER at index 30 (C++ matches, was 15)', () => {
    const event: TriggerEvent = { type: 30, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState({ isLowPower: false }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ isLowPower: true }))).toBe(true);
  });

  it('TEVENT_CROSS_HORIZONTAL at index 25 (C++ matches, was 21)', () => {
    const event: TriggerEvent = { type: 25, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState({ playerEntered: true }))).toBe(true);
  });

  it('TEVENT_CROSS_VERTICAL at index 26 (C++ matches, was 22)', () => {
    const event: TriggerEvent = { type: 26, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState({ playerEntered: true }))).toBe(true);
  });

  it('TEVENT_GLOBAL_SET at index 27 (unchanged)', () => {
    const event: TriggerEvent = { type: 27, team: -1, data: 5 };
    expect(checkTriggerEvent(event, createState({ globals: new Set([5]) }))).toBe(true);
    expect(checkTriggerEvent(event, createState({ globals: new Set() }))).toBe(false);
  });

  it('TEVENT_ALL_BRIDGES_DESTROYED at index 31 (unchanged)', () => {
    const event: TriggerEvent = { type: 31, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState({ bridgesAlive: 0 }))).toBe(true);
    expect(checkTriggerEvent(event, createState({ bridgesAlive: 3 }))).toBe(false);
  });

  it('TEVENT_BUILDING_EXISTS at index 32 (unchanged)', () => {
    const event: TriggerEvent = { type: 32, team: -1, data: 11 }; // 11 = FACT
    expect(checkTriggerEvent(event, createState({ structureTypes: new Set(['FACT']) }))).toBe(true);
    expect(checkTriggerEvent(event, createState({ structureTypes: new Set() }))).toBe(false);
  });
});

// === AI2: Cost-proportional threat scoring ===

describe('AI2: threatScore uses cost-proportional scoring', () => {
  it('higher-value unit scores higher than lower-value at same distance', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    // V_3TNK: strength=400 + 105mm damage(30)*5 = 550 base value
    // I_E1: strength=50 + M1Carbine damage(15)*5 = 125 base value
    const heavyTank = makeEntity(UnitType.V_3TNK, House.USSR, 200, 100);
    const rifleman = makeEntity(UnitType.I_E1, House.USSR, 200, 100);

    const tankScore = threatScore(scanner, heavyTank, 3, false);
    const rifleScore = threatScore(scanner, rifleman, 3, false);

    expect(tankScore).toBeGreaterThan(rifleScore);
  });

  it('high-strength unit produces large threat score', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const target = makeEntity(UnitType.V_3TNK, House.USSR, 200, 100);

    // V_3TNK base value ~ 550 (strength 400 + weapon 30*5)
    const score = threatScore(scanner, target, 1, false);
    // At dist=1 (256 leptons): (550 * 32000) / (256 + 1) ~ 68,482
    // (before warhead/weapon modifiers)
    expect(score).toBeGreaterThan(1000);
  });

  it('estimates value from HP + weapon damage when no cost defined', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 200, 100);

    const score = threatScore(scanner, ant, 2, false);
    // Should produce a reasonable score, not zero
    expect(score).toBeGreaterThan(0);
  });
});

// === AI2: Hyperbolic distance falloff ===

describe('AI2: Hyperbolic distance falloff', () => {
  it('closer target scores dramatically higher than distant target', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const near = makeEntity(UnitType.ANT1, House.USSR, 150, 100);
    const far = makeEntity(UnitType.ANT1, House.USSR, 600, 100);

    const nearScore = threatScore(scanner, near, 1, false);
    const farScore = threatScore(scanner, far, 10, false);

    expect(nearScore).toBeGreaterThan(farScore);
    // Hyperbolic falloff: at dist=1 (256 leptons) vs dist=10 (2560 leptons)
    // Ratio should be roughly (2560+1)/(256+1) ~ 10x
    expect(nearScore / farScore).toBeGreaterThan(5);
  });

  it('score approaches value*32000 at dist=0', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);

    const score = threatScore(scanner, target, 0, false);
    // At dist=0: score = (value * 32000) / (0 + 1) = value * 32000
    // value ~ HP (125) + weapon_danger = fairly large
    expect(score).toBeGreaterThan(1000);
  });
});

// === AI4: Designated enemy bonus ===

describe('AI4: Designated enemy house bonus', () => {
  it('target from designated enemy gets massive score boost', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const normalEnemy = makeEntity(UnitType.I_E1, House.USSR, 200, 100);
    const designatedEnemy = makeEntity(UnitType.I_E1, House.Greece, 200, 100);

    const normalScore = threatScore(scanner, normalEnemy, 3, false, undefined, House.Greece);
    const designatedScore = threatScore(scanner, designatedEnemy, 3, false, undefined, House.Greece);

    // Designated enemy: (value + 500) * 3 vs value alone
    expect(designatedScore).toBeGreaterThan(normalScore);
    // The bonus should be substantial (3x multiplier + 500 additive)
    expect(designatedScore / normalScore).toBeGreaterThan(2);
  });

  it('null designated enemy gives no bonus', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 200, 100);

    const scoreWithNull = threatScore(scanner, target, 3, false, undefined, null);
    const scoreWithout = threatScore(scanner, target, 3, false, undefined);

    expect(scoreWithNull).toBe(scoreWithout);
  });
});

// === AI5: Area modification ===

describe('AI5: Area_Modify — C++ exponential halving per nearby building', () => {
  it('splash-weapon scanner: threat reduced when target near friendly structures', () => {
    // V2RL has SCUD weapon with splash: 2.0
    const scanner = makeEntity(UnitType.V_V2RL, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 200, 100);

    const normalScore = threatScore(scanner, target, 3, false, undefined, null, 0);
    const nearOneStruct = threatScore(scanner, target, 3, false, undefined, null, 1);

    expect(nearOneStruct).toBeLessThan(normalScore);
    // C++ Area_Modify: odds /= 2 per building → pow(0.5, count)
    // 1 building: 0.5x
    expect(nearOneStruct / normalScore).toBeCloseTo(0.5, 2);
  });

  it('non-splash scanner: no penalty regardless of structure count', () => {
    // E1 has M1Carbine — no splash
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 200, 100);

    const scoreDefault = threatScore(scanner, target, 3, false);
    const scoreWithStructures = threatScore(scanner, target, 3, false, undefined, null, 3);

    // Non-splash weapons are unaffected by nearby structure count
    expect(scoreDefault).toBe(scoreWithStructures);
  });

  it('count of 0 gives same score as omitted parameter', () => {
    const scanner = makeEntity(UnitType.V_V2RL, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 200, 100);

    const scoreDefault = threatScore(scanner, target, 3, false);
    const scoreZero = threatScore(scanner, target, 3, false, undefined, null, 0);

    expect(scoreDefault).toBe(scoreZero);
  });
});

// === AI6: Spy exclusion ===

describe('AI6: Spy target exclusion', () => {
  it('spy returns 0 threat score for non-dog scanners', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const spy = makeEntity(UnitType.I_SPY, House.USSR, 200, 100);

    const score = threatScore(scanner, spy, 3, false);
    expect(score).toBe(0);
  });

  it('spy returns 0 for vehicle scanners', () => {
    const scanner = makeEntity(UnitType.V_1TNK, House.Spain, 100, 100);
    const spy = makeEntity(UnitType.I_SPY, House.USSR, 200, 100);

    const score = threatScore(scanner, spy, 3, false);
    expect(score).toBe(0);
  });

  it('dog CAN target spy (exception to exclusion)', () => {
    const dog = makeEntity(UnitType.I_DOG, House.Spain, 100, 100);
    const spy = makeEntity(UnitType.I_SPY, House.USSR, 200, 100);

    const score = threatScore(dog, spy, 3, false);
    expect(score).toBeGreaterThan(0);
  });

  it('non-spy infantry is still targeted normally', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const infantry = makeEntity(UnitType.I_E1, House.USSR, 200, 100);

    const score = threatScore(scanner, infantry, 3, false);
    expect(score).toBeGreaterThan(0);
  });
});

// === Existing behavior preservation ===

describe('Preserved behaviors: retaliation + wounded bonuses', () => {
  it('wounded target scores higher than full-health same type', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const healthy = makeEntity(UnitType.ANT1, House.USSR, 150, 100);
    const wounded = makeEntity(UnitType.ANT1, House.USSR, 150, 100);
    wounded.hp = wounded.maxHp * 0.3;

    const healthyScore = threatScore(scanner, healthy, 2, false);
    const woundedScore = threatScore(scanner, wounded, 2, false);

    expect(woundedScore).toBeGreaterThan(healthyScore);
    // Wounded bonus is 1.5x
    expect(woundedScore / healthyScore).toBeCloseTo(1.5, 1);
  });

  it('target attacking allies gets 2x retaliation bonus', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const passive = makeEntity(UnitType.ANT1, House.USSR, 150, 100);
    const aggressive = makeEntity(UnitType.ANT1, House.USSR, 150, 100);

    const passiveScore = threatScore(scanner, passive, 2, false);
    const aggressiveScore = threatScore(scanner, aggressive, 2, true);

    expect(aggressiveScore).toBeGreaterThan(passiveScore);
    expect(aggressiveScore / passiveScore).toBeCloseTo(2.0, 1);
  });

  it('closing speed bonus gives +25%', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const target = makeEntity(UnitType.ANT1, House.USSR, 200, 100);

    const stationaryScore = threatScore(scanner, target, 3, false, 0);
    const closingScore = threatScore(scanner, target, 3, false, 2);

    expect(closingScore).toBeGreaterThan(stationaryScore);
    expect(closingScore / stationaryScore).toBeCloseTo(1.25, 1);
  });
});
