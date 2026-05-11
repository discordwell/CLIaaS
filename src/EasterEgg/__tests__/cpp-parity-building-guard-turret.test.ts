/**
 * @vitest-environment jsdom
 *
 * C++ Behavioral Parity: BuildingClass::Mission_Guard does not aim turrets.
 *
 * building.cpp:3264-3295:
 *   weapon-equipped Mission_Guard calls Greatest_Threat, Assign_Target,
 *   Assign_Mission(MISSION_ATTACK), Commence(), and returns 1.
 *
 * building.cpp:3735-3750:
 *   PrimaryFacing.Set_Desired(Direction(TarCom)) first happens in
 *   Mission_Attack when Can_Fire reports FIRE_FACING/FIRE_REARM.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import { ScenarioRandom } from '../engine/random';
import { type MapStructure, STRUCTURE_MAX_HP, STRUCTURE_WEAPONS } from '../engine/scenario';
import { type CombatContext, tickStructureTurretRotation, updateSingleStructureCombat } from '../engine/combat';
import { CELL_SIZE, directionToLeptons256, House, LEPTON_SIZE, Mission, RESFACTOR, UnitType } from '../engine/types';

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

function makeAgun(cx: number, cy: number): MapStructure {
  const maxHp = STRUCTURE_MAX_HP.AGUN;
  return {
    type: 'AGUN',
    image: 'agun',
    house: House.Greece,
    cx,
    cy,
    hp: maxHp,
    maxHp,
    alive: true,
    rubble: false,
    weapon: STRUCTURE_WEAPONS.AGUN,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    mission: Mission.GUARD,
    missionTimer: 0,
    turretFacing256: 0,
    desiredTurretFacing256: 0,
    turretDir: 0,
    desiredTurretDir: 0,
  };
}

function airborneYak(cx: number, cy: number): Entity {
  const yak = new Entity(UnitType.V_YAK, House.USSR, cx * 24 + 12, cy * 24 + 12);
  yak.flightAltitude = Entity.FLIGHT_ALTITUDE;
  return yak;
}

function airborneYakAtLeptons(lx: number, ly: number): Entity {
  const yak = new Entity(UnitType.V_YAK, House.USSR, lx * CELL_SIZE / LEPTON_SIZE, ly * CELL_SIZE / LEPTON_SIZE);
  yak.leptonX = lx;
  yak.leptonY = ly;
  yak.syncPosFromLeptons();
  yak.prevPos = { ...yak.pos };
  yak.flightAltitude = Entity.FLIGHT_ALTITUDE;
  return yak;
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

describe('BuildingClass::Mission_Guard turret timing', () => {
  it('queues ATTACK without changing turret desired facing or rotating', () => {
    const game = new Game(createCanvas());
    const agun = makeAgun(62, 100);
    const yak = airborneYak(57, 100);

    game.structures.push(agun);
    game.entities.push(yak);
    game.entityById.set(yak.id, yak);

    const ranAttack = (game as unknown as {
      readonly _combatCtx: unknown;
      dispatchStructureMissionTimer(s: MapStructure, combatCtx: unknown, guardNormalDelay: number, guardAADelay: number): boolean;
    }).dispatchStructureMissionTimer(
      agun,
      (game as unknown as { readonly _combatCtx: unknown })._combatCtx,
      42,
      14,
    );

    tickStructureTurretRotation(agun, false);

    expect(ranAttack).toBe(false);
    expect(agun.mission).toBe(Mission.ATTACK);
    expect(agun.targetEntityId).toBe(yak.id);
    expect(agun.turretFacing256).toBe(0);
    expect(agun.desiredTurretFacing256).toBe(0);
    expect(agun.turretRotAccum ?? 0).toBe(0);
  });

  it('clears just-acquired aircraft TarCom when Target_Coord is out of range', () => {
    const game = new Game(createCanvas());
    const agun = makeAgun(10, 10);
    const fireLX = 10 * LEPTON_SIZE + 0x80;
    const fireLY = 10 * LEPTON_SIZE + 0xff;
    const yak = airborneYakAtLeptons(fireLX + 1500, fireLY);

    game.structures.push(agun);
    game.entities.push(yak);
    game.entityById.set(yak.id, yak);

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
    expect(agun.mission).toBe(Mission.ATTACK);
    expect(agun.targetEntityId).toBeUndefined();
  });

  it('aims at TARGET_NONE after Mission_Attack clears an out-of-range assigned target', () => {
    const game = new Game(createCanvas());
    const agun = makeAgun(55, 100);
    const yak = airborneYakAtLeptons(55 * LEPTON_SIZE + 10 * LEPTON_SIZE, 100 * LEPTON_SIZE + 0xff);

    agun.mission = Mission.ATTACK;
    agun.missionTimer = 0;
    agun.targetEntityId = yak.id;
    agun.turretFacing256 = 57;
    agun.desiredTurretFacing256 = 57;
    agun.turretDir = 2;
    agun.desiredTurretDir = 2;

    game.structures.push(agun);
    game.entities.push(yak);
    game.entityById.set(yak.id, yak);

    const combatCtx = (game as unknown as { readonly _combatCtx: CombatContext })._combatCtx;
    const ranAttack = (game as unknown as {
      dispatchStructureMissionTimer(s: MapStructure, combatCtx: CombatContext, guardNormalDelay: number, guardAADelay: number): boolean;
    }).dispatchStructureMissionTimer(agun, combatCtx, 42, 14);
    if (ranAttack) updateSingleStructureCombat(combatCtx, agun, false);
    tickStructureTurretRotation(agun, false);

    const targetNoneFacing = directionToLeptons256(
      55 * LEPTON_SIZE + 0x80,
      100 * LEPTON_SIZE + 0xff,
      0,
      0,
    );

    expect(combatCtx.inflightProjectiles).toHaveLength(0);
    expect(agun.mission).toBe(Mission.GUARD);
    expect(agun.targetEntityId).toBeUndefined();
    expect(agun.desiredTurretFacing256).toBe(targetNoneFacing);
    expect(agun.turretFacing256).toBe(42);
  });
});
