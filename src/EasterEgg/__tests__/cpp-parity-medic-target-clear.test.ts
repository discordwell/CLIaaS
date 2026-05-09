import { describe, expect, it } from 'vitest';
import { Entity, resetEntityIds, setPlayerHouses } from '../engine/entity';
import { runFiringAI, type MissionAIContext } from '../engine/missionAI';
import { CELL_SIZE, House, UnitType } from '../engine/types';

function infantry(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE, cy * CELL_SIZE);
}

describe('C++ medic Firing_AI target clearing (infantry.cpp:1595, 3589)', () => {
  it('clears fully healed infantry TarCom before the rearm gate', () => {
    resetEntityIds();
    setPlayerHouses(new Set([House.Spain, House.Greece]));

    const medic = infantry(UnitType.I_MEDI, House.Greece, 10, 54);
    const target = infantry(UnitType.I_E6, House.Greece, 9, 55);
    target.hp = target.maxHp;
    medic.target = target;
    medic.attackCooldown = 62;
    medic.firePrepActive = true;
    medic.firePrepStage = 2;

    runFiringAI({ tick: 1120 } as MissionAIContext, medic);

    // InfantryClass::Can_Fire checks negative-damage targets before delegating
    // to TechnoClass::Can_Fire, where Arm/rearm is checked. Firing_AI handles
    // FIRE_ILLEGAL by Assign_Target(TARGET_NONE), so a medic does not keep a
    // stale full-health heal target through cooldown and block Random_Animate.
    expect(medic.target).toBeNull();
    expect(medic.firePrepActive).toBe(false);
    expect(medic.attackCooldown).toBe(62);
  });

  it('keeps an injured infantry TarCom while rearming', () => {
    resetEntityIds();
    setPlayerHouses(new Set([House.Spain, House.Greece]));

    const medic = infantry(UnitType.I_MEDI, House.Greece, 10, 54);
    const target = infantry(UnitType.I_E6, House.Greece, 9, 55);
    target.hp = target.maxHp - 1;
    medic.target = target;
    medic.attackCooldown = 62;

    runFiringAI({ tick: 1120 } as MissionAIContext, medic);

    expect(medic.target).toBe(target);
    expect(medic.attackCooldown).toBe(62);
  });

  it('clears non-infantry TarCom for negative-damage medic fire', () => {
    resetEntityIds();
    setPlayerHouses(new Set([House.Spain, House.Greece]));

    const medic = infantry(UnitType.I_MEDI, House.Greece, 10, 54);
    const target = infantry(UnitType.V_JEEP, House.Greece, 9, 55);
    target.hp = target.maxHp - 1;
    medic.target = target;
    medic.attackCooldown = 62;

    runFiringAI({ tick: 1120 } as MissionAIContext, medic);

    // RA's non-FIXIT Can_Fire path uses As_Infantry(target) for negative
    // damage, so vehicles are FIRE_ILLEGAL for medics even if damaged.
    expect(medic.target).toBeNull();
  });
});
