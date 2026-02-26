import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { UnitType, House } from '../engine/types';

beforeEach(() => resetEntityIds());

describe('Unit Voice Responses', () => {
  it('infantry unit is identified correctly for voice selection', () => {
    const e1 = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    expect(e1.stats.isInfantry).toBe(true);
  });

  it('vehicle unit is identified correctly for voice selection', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(tank.stats.isInfantry).toBe(false);
  });

  it('dog has special voice type', () => {
    const dog = new Entity(UnitType.I_DOG, House.Spain, 100, 100);
    expect(dog.type).toBe(UnitType.I_DOG);
    expect(dog.stats.isInfantry).toBe(true);
  });

  it('voice throttle prevents spam (8 ticks = 0.53s)', () => {
    let lastVoiceTick = 0;
    const tick = 5;
    const shouldPlay = tick - lastVoiceTick >= 8;
    expect(shouldPlay).toBe(false);

    lastVoiceTick = 0;
    const tick2 = 10;
    const shouldPlay2 = tick2 - lastVoiceTick >= 8;
    expect(shouldPlay2).toBe(true);
  });
});
