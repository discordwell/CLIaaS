import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { UnitType, House } from '../engine/types';

beforeEach(() => resetEntityIds());

describe('Spy Mechanics', () => {
  it('spy has disguisedAs field initialized to null', () => {
    const spy = new Entity(UnitType.I_SPY, House.Spain, 100, 100);
    expect(spy.disguisedAs).toBeNull();
  });

  it('spy can be disguised as enemy house', () => {
    const spy = new Entity(UnitType.I_SPY, House.Spain, 100, 100);
    spy.disguisedAs = House.USSR;
    expect(spy.disguisedAs).toBe(House.USSR);
  });

  it('disguise resets to null when cleared', () => {
    const spy = new Entity(UnitType.I_SPY, House.Spain, 100, 100);
    spy.disguisedAs = House.USSR;
    spy.disguisedAs = null;
    expect(spy.disguisedAs).toBeNull();
  });

  it('dog has short scan delay for fast detection', () => {
    const dog = new Entity(UnitType.I_DOG, House.Spain, 100, 100);
    expect(dog.stats.scanDelay).toBe(8);
  });
});
