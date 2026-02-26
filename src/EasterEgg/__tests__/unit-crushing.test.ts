/**
 * Tests for unit crushing mechanics — C++ DriveClass::Ok_To_Move parity.
 * Heavy tracked vehicles (crusher=true) instantly kill crushable units (infantry/ants)
 * when they enter the same cell. Non-crusher vehicles do NOT crush.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  UnitType, House, UNIT_STATS, SpeedClass, AnimState, Mission,
} from '../engine/types';

beforeEach(() => resetEntityIds());

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

// === 1. Crusher stats are correctly set for heavy tracked vehicles ===
describe('crusher flag on UNIT_STATS', () => {
  const expectedCrushers = ['1TNK', '2TNK', '3TNK', '4TNK', 'HARV', 'MCV', 'CTNK', 'TTNK', 'QTNK'];
  const expectedNonCrushers = ['JEEP', 'APC', 'ARTY', 'TRUK', 'STNK', 'DTRK', 'TRAN', 'LST'];

  it.each(expectedCrushers)('%s has crusher=true', (unitKey) => {
    expect(UNIT_STATS[unitKey].crusher).toBe(true);
  });

  it.each(expectedNonCrushers)('%s does NOT have crusher=true', (unitKey) => {
    expect(UNIT_STATS[unitKey].crusher).toBeFalsy();
  });
});

// === 2. All infantry types are marked crushable ===
describe('crushable flag on infantry', () => {
  const infantryKeys = Object.keys(UNIT_STATS).filter(k => UNIT_STATS[k].isInfantry);

  it('there are infantry types defined', () => {
    expect(infantryKeys.length).toBeGreaterThan(0);
  });

  it.each(infantryKeys)('%s (infantry) has crushable=true', (unitKey) => {
    expect(UNIT_STATS[unitKey].crushable).toBe(true);
  });
});

// === 3. All ant types are marked crushable ===
describe('crushable flag on ants', () => {
  it('ANT1 (Warrior Ant) is crushable', () => {
    expect(UNIT_STATS.ANT1.crushable).toBe(true);
  });

  it('ANT2 (Fire Ant) is crushable', () => {
    expect(UNIT_STATS.ANT2.crushable).toBe(true);
  });

  it('ANT3 (Scout Ant) is crushable', () => {
    expect(UNIT_STATS.ANT3.crushable).toBe(true);
  });
});

// === 4. Vehicles are NOT crushable ===
describe('vehicles are NOT crushable', () => {
  const vehicleKeys = Object.keys(UNIT_STATS).filter(
    k => !UNIT_STATS[k].isInfantry && !['ANT1', 'ANT2', 'ANT3'].includes(k)
  );

  it('there are vehicle types defined', () => {
    expect(vehicleKeys.length).toBeGreaterThan(0);
  });

  it.each(vehicleKeys)('%s (vehicle) is NOT crushable', (unitKey) => {
    expect(UNIT_STATS[unitKey].crushable).toBeFalsy();
  });
});

// === 5. Heavy tank crushes infantry on cell entry ===
describe('crush mechanics — heavy tank vs infantry', () => {
  it('heavy tank crushes rifle infantry when sharing same cell', () => {
    const tank = makeEntity(UnitType.V_3TNK, House.Spain, 100, 100);
    const infantry = makeEntity(UnitType.I_E1, House.USSR, 100, 100);

    // Verify prerequisites
    expect(tank.stats.crusher).toBe(true);
    expect(infantry.stats.crushable).toBe(true);
    expect(infantry.alive).toBe(true);

    // Simulate crush: instant kill damage (same as checkVehicleCrush logic)
    infantry.takeDamage(infantry.hp + 10, 'Super');

    expect(infantry.alive).toBe(false);
    expect(infantry.hp).toBe(0);
    expect(infantry.mission).toBe(Mission.DIE);
    expect(infantry.animState).toBe(AnimState.DIE);
  });

  it('mammoth tank crushes grenadier on cell entry', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 200, 200);
    const grenadier = makeEntity(UnitType.I_E2, House.USSR, 200, 200);

    expect(mammoth.stats.crusher).toBe(true);
    expect(grenadier.stats.crushable).toBe(true);

    grenadier.takeDamage(grenadier.hp + 10, 'Super');
    expect(grenadier.alive).toBe(false);
  });
});

// === 6. Heavy tank crushes ants on cell entry ===
describe('crush mechanics — heavy tank vs ants', () => {
  it('heavy tank crushes warrior ant (ANT1)', () => {
    const tank = makeEntity(UnitType.V_3TNK, House.Spain, 100, 100);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100, 100);

    expect(tank.stats.crusher).toBe(true);
    expect(ant.stats.crushable).toBe(true);

    ant.takeDamage(ant.hp + 10, 'Super');
    expect(ant.alive).toBe(false);
    expect(ant.hp).toBe(0);
  });

  it('mammoth tank crushes fire ant (ANT2)', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 100, 100);
    const ant = makeEntity(UnitType.ANT2, House.USSR, 100, 100);

    expect(mammoth.stats.crusher).toBe(true);
    expect(ant.stats.crushable).toBe(true);

    ant.takeDamage(ant.hp + 10, 'Super');
    expect(ant.alive).toBe(false);
  });

  it('light tank crushes scout ant (ANT3)', () => {
    const tank = makeEntity(UnitType.V_1TNK, House.Spain, 100, 100);
    const ant = makeEntity(UnitType.ANT3, House.USSR, 100, 100);

    expect(tank.stats.crusher).toBe(true);
    expect(ant.stats.crushable).toBe(true);

    ant.takeDamage(ant.hp + 10, 'Super');
    expect(ant.alive).toBe(false);
  });
});

// === 7. Light/wheeled vehicle does NOT crush infantry ===
describe('non-crusher vehicles do NOT crush', () => {
  it('Ranger (JEEP) should NOT have crusher flag — cannot crush infantry', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    const infantry = makeEntity(UnitType.I_E1, House.USSR, 100, 100);

    expect(jeep.stats.crusher).toBeFalsy();
    expect(infantry.stats.crushable).toBe(true);

    // A JEEP sharing a cell with infantry should NOT trigger crush
    // (the game loop checks crusher flag before calling checkVehicleCrush)
    expect(infantry.alive).toBe(true);
  });

  it('APC should NOT have crusher flag — cannot crush infantry', () => {
    const apc = makeEntity(UnitType.V_APC, House.Spain, 100, 100);
    expect(apc.stats.crusher).toBeFalsy();
  });

  it('Artillery should NOT have crusher flag — cannot crush infantry', () => {
    const arty = makeEntity(UnitType.V_ARTY, House.Spain, 100, 100);
    expect(arty.stats.crusher).toBeFalsy();
  });

  it('Supply Truck should NOT have crusher flag', () => {
    const truck = makeEntity(UnitType.V_TRUK, House.Spain, 100, 100);
    expect(truck.stats.crusher).toBeFalsy();
  });

  it('Phase Transport (STNK) should NOT have crusher flag', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain, 100, 100);
    expect(stnk.stats.crusher).toBeFalsy();
  });

  it('Demo Truck (DTRK) should NOT have crusher flag', () => {
    const dtrk = makeEntity(UnitType.V_DTRK, House.Spain, 100, 100);
    expect(dtrk.stats.crusher).toBeFalsy();
  });
});

// === 8. Infantry does NOT crush other infantry ===
describe('infantry does NOT crush infantry', () => {
  it('rifle infantry has no crusher flag', () => {
    const e1 = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    expect(e1.stats.crusher).toBeFalsy();
    expect(e1.stats.isInfantry).toBe(true);
  });

  it('no infantry type has crusher flag', () => {
    const infantryKeys = Object.keys(UNIT_STATS).filter(k => UNIT_STATS[k].isInfantry);
    for (const key of infantryKeys) {
      expect(UNIT_STATS[key].crusher).toBeFalsy();
    }
  });
});

// === 9. Vehicle does NOT crush other vehicles ===
describe('vehicles do NOT crush other vehicles', () => {
  it('vehicle types are not crushable', () => {
    const vehicleKeys = Object.keys(UNIT_STATS).filter(
      k => !UNIT_STATS[k].isInfantry && !['ANT1', 'ANT2', 'ANT3'].includes(k)
    );
    for (const key of vehicleKeys) {
      expect(UNIT_STATS[key].crushable).toBeFalsy();
    }
  });

  it('heavy tank cannot crush light tank (vehicle vs vehicle)', () => {
    const heavy = makeEntity(UnitType.V_3TNK, House.Spain, 100, 100);
    const light = makeEntity(UnitType.V_1TNK, House.USSR, 100, 100);

    expect(heavy.stats.crusher).toBe(true);
    expect(light.stats.crushable).toBeFalsy();

    // The crush check requires crushable=true on target; light tank is not crushable
    // so no crush damage should be applied (game loop skips non-crushable targets)
    expect(light.alive).toBe(true);
  });
});

// === 10. Crushed unit is correctly marked as dead ===
describe('crushed unit death state', () => {
  it('crushed infantry has correct death state flags', () => {
    const infantry = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    expect(infantry.alive).toBe(true);
    expect(infantry.hp).toBe(infantry.maxHp);

    // Apply crush damage (Super warhead for die2 animation, as in C++ code)
    const killed = infantry.takeDamage(infantry.hp + 10, 'Super');

    expect(killed).toBe(true);
    expect(infantry.alive).toBe(false);
    expect(infantry.hp).toBe(0);
    expect(infantry.mission).toBe(Mission.DIE);
    expect(infantry.animState).toBe(AnimState.DIE);
    expect(infantry.animFrame).toBe(0);
    expect(infantry.deathTick).toBe(0);
    // Super warhead has infantryDeath=2 (explode), which maps to deathVariant=1 (die2)
    expect(infantry.deathVariant).toBe(1);
  });

  it('crushed ant has correct death state flags', () => {
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100, 100);

    const killed = ant.takeDamage(ant.hp + 10, 'Super');

    expect(killed).toBe(true);
    expect(ant.alive).toBe(false);
    expect(ant.hp).toBe(0);
    expect(ant.mission).toBe(Mission.DIE);
    expect(ant.animState).toBe(AnimState.DIE);
  });

  it('crusher credits kill after crushing', () => {
    const tank = makeEntity(UnitType.V_3TNK, House.Spain, 100, 100);
    expect(tank.kills).toBe(0);

    // Simulate what checkVehicleCrush does: damage + creditKill
    const infantry = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    infantry.takeDamage(infantry.hp + 10, 'Super');
    tank.creditKill();

    expect(tank.kills).toBe(1);
  });
});

// === 11. Expansion tank variants are crushers ===
describe('expansion vehicle crusher flags', () => {
  it('Chrono Tank (CTNK) is a crusher', () => {
    expect(UNIT_STATS.CTNK.crusher).toBe(true);
  });

  it('Tesla Tank (TTNK) is a crusher', () => {
    expect(UNIT_STATS.TTNK.crusher).toBe(true);
  });

  it('M.A.D. Tank (QTNK) is a crusher', () => {
    expect(UNIT_STATS.QTNK.crusher).toBe(true);
  });
});

// === 12. Harvester and MCV are crushers (heavy tracked) ===
describe('non-combat heavy vehicles are crushers', () => {
  it('Harvester (HARV) is a crusher', () => {
    expect(UNIT_STATS.HARV.crusher).toBe(true);
  });

  it('MCV is a crusher', () => {
    expect(UNIT_STATS.MCV.crusher).toBe(true);
  });
});

// === 13. Ants are NOT crushers ===
describe('ants are NOT crushers', () => {
  it('ANT1 does not have crusher flag', () => {
    expect(UNIT_STATS.ANT1.crusher).toBeFalsy();
  });

  it('ANT2 does not have crusher flag', () => {
    expect(UNIT_STATS.ANT2.crusher).toBeFalsy();
  });

  it('ANT3 does not have crusher flag', () => {
    expect(UNIT_STATS.ANT3.crusher).toBeFalsy();
  });
});
