/**
 * @vitest-environment jsdom
 *
 * C++ Behavioral Parity: docked aircraft use pad Mission_Repair.
 *
 * C++ building.cpp:215-230 routes RADIO_IM_IN from an aircraft to
 * STRUCT_AIRSTRIP/STRUCT_HELIPAD Mission_Repair. While an aircraft is being
 * serviced, the pad must not execute non-weapon Mission_Guard jitter.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import { type MapStructure, STRUCTURE_MAX_HP } from '../engine/scenario';
import { House, Mission, RESFACTOR, UnitType } from '../engine/types';
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
    missionTimer: 0,
  } as MapStructure;
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

describe('aircraft pad Mission_Repair', () => {
  it('full-ammo AFLD repair handoff runs through Commence without guard jitter', () => {
    const game = new Game(createCanvas());
    const afld = makeStructure('AFLD', House.USSR, 39, 77);
    game.structures.push(afld);

    const yak = new Entity(UnitType.V_YAK, House.USSR, 40 * 24, 78 * 24);
    yak.aircraftState = 'landed';
    yak.flightAltitude = 0;
    yak.landedAtStructure = 0;
    yak.ammo = yak.maxAmmo;
    yak.mission = Mission.GUARD;
    game.entities.push(yak);
    game.entityById.set(yak.id, yak);

    afld.dockedAircraft = yak.id;
    afld.mission = Mission.GUARD;
    afld.missionQueue = Mission.REPAIR;
    afld.isReadyToCommence = true;
    afld.repairMissionStatus = 0;
    afld.missionTimer = 23;

    const ranAttack = (game as unknown as {
      readonly _combatCtx: unknown;
      dispatchStructureMissionTimer(s: MapStructure, combatCtx: unknown, guardNormalDelay: number, guardAADelay: number): boolean;
    }).dispatchStructureMissionTimer(
      afld,
      (game as unknown as { readonly _combatCtx: unknown })._combatCtx,
      42,
      14,
    );

    expect(ranAttack).toBe(false);
    expect(ScenarioRandom.callCount).toBe(0);
    expect(afld.mission).toBe(Mission.REPAIR);
    expect(afld.missionQueue).toBe(Mission.GUARD);
    expect(afld.isReadyToCommence).toBe(true);
    expect(afld.repairMissionStatus).toBe(0);
    expect(afld.missionTimer).toBe(3);
    expect(yak.mission).toBe(Mission.GUARD);
  });

  it('docked rearming AFLD does not fall through to non-weapon guard jitter', () => {
    const game = new Game(createCanvas());
    const afld = makeStructure('AFLD', House.USSR, 102, 58);
    game.structures.push(afld);

    const yak = new Entity(UnitType.V_YAK, House.USSR, 103 * 24, 58 * 24);
    yak.aircraftState = 'rearming';
    yak.flightAltitude = 0;
    yak.landedAtStructure = 0;
    yak.ammo = 0;
    yak.maxAmmo = 15;
    yak.rearmTimer = 23;
    yak.mission = Mission.SLEEP;
    game.entities.push(yak);
    game.entityById.set(yak.id, yak);

    afld.dockedAircraft = yak.id;
    afld.mission = Mission.REPAIR;
    afld.repairMissionStatus = 1;
    afld.missionTimer = 0;

    const ranAttack = (game as unknown as {
      readonly _combatCtx: unknown;
      dispatchStructureMissionTimer(s: MapStructure, combatCtx: unknown, guardNormalDelay: number, guardAADelay: number): boolean;
    }).dispatchStructureMissionTimer(
      afld,
      (game as unknown as { readonly _combatCtx: unknown })._combatCtx,
      42,
      14,
    );

    expect(ranAttack).toBe(false);
    expect(ScenarioRandom.callCount).toBe(0);
    expect(afld.mission).toBe(Mission.REPAIR);
    expect(afld.missionTimer).toBe(23);
    expect(afld.repairMissionStatus).toBe(1);
    expect(yak.mission).toBe(Mission.SLEEP);
  });
});
