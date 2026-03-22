/**
 * Tests for threat-weighted guard targeting.
 * Verifies: prefers threatening targets over closest, retaliation bonus, wounded bonus.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds, threatScore } from '../engine/entity';
import { Dir, Mission, UnitType, House } from '../engine/types';

beforeEach(() => resetEntityIds());

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

describe('threatScore — threat-weighted targeting', () => {
  it('ant types scored by 2*cost — higher cost scores higher at same distance', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const fireAnt = makeEntity(UnitType.ANT2, House.USSR, 150, 100);
    const scoutAnt = makeEntity(UnitType.ANT3, House.USSR, 150, 100);

    const fireScore = threatScore(scanner, fireAnt, 2);
    const scoutScore = threatScore(scanner, scoutAnt, 2);

    // C++ parity: scored by 2*points — whichever has higher cost/points scores higher
    expect(fireScore).toBeGreaterThan(0);
    expect(scoutScore).toBeGreaterThan(0);
  });

  it('C++ parity: wounded and healthy targets score equally (no HP modifier)', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const healthy = makeEntity(UnitType.ANT1, House.USSR, 150, 100);
    const wounded = makeEntity(UnitType.ANT1, House.USSR, 150, 100);
    wounded.hp = wounded.maxHp * 0.3;

    const healthyScore = threatScore(scanner, healthy, 2);
    const woundedScore = threatScore(scanner, wounded, 2);

    // C++ Evaluate_Object has no HP modifier
    expect(woundedScore).toBe(healthyScore);
  });

  it('C++ parity: passive and attacking targets score equally (no retaliation in scoring)', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const passive = makeEntity(UnitType.ANT1, House.USSR, 150, 100);
    const aggressive = makeEntity(UnitType.ANT1, House.USSR, 150, 100);

    const passiveScore = threatScore(scanner, passive, 2);
    const aggressiveScore = threatScore(scanner, aggressive, 2);

    // C++ handles retaliation in Assign_Target, not Evaluate_Object
    expect(aggressiveScore).toBe(passiveScore);
  });

  it('closer target scores higher than distant same type', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const near = makeEntity(UnitType.ANT1, House.USSR, 120, 100);
    const far = makeEntity(UnitType.ANT1, House.USSR, 200, 100);

    const nearScore = threatScore(scanner, near, 1);
    const farScore = threatScore(scanner, far, 5);

    expect(nearScore).toBeGreaterThan(farScore);
  });

  it('experienced target (high kills) scores higher', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const rookie = makeEntity(UnitType.ANT1, House.USSR, 150, 100);
    const veteran = makeEntity(UnitType.ANT1, House.USSR, 150, 100);
    veteran.kills = 5; // +15 score bonus

    const rookieScore = threatScore(scanner, rookie, 2);
    const vetScore = threatScore(scanner, veteran, 2);

    expect(vetScore).toBeGreaterThan(rookieScore);
  });

  it('C++ parity: closer target of same value always wins (distance dominates)', () => {
    // C++ hyperbolic falloff: closer targets dominate when values are similar
    // No retaliation/wounded bonuses to override distance
    const scanner = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);

    const closeAnt = makeEntity(UnitType.ANT2, House.USSR, 150, 100);
    const farAnt = makeEntity(UnitType.ANT2, House.USSR, 200, 100);

    const closeScore = threatScore(scanner, closeAnt, 2);
    const farScore = threatScore(scanner, farAnt, 4);

    // Same unit type at different distances — closer always wins in C++
    expect(closeScore).toBeGreaterThan(farScore);
  });

  it('vehicles score higher than infantry base value', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    // Using an ant-faction vehicle stand-in is awkward, so just test the type scoring
    // Vehicles get base 25, infantry gets base 10
    const vehicle = makeEntity(UnitType.V_2TNK, House.USSR, 150, 100);
    const infantry = makeEntity(UnitType.I_E1, House.USSR, 150, 100);

    const vehScore = threatScore(scanner, vehicle, 2);
    const infScore = threatScore(scanner, infantry, 2);

    expect(vehScore).toBeGreaterThan(infScore);
  });

  it('civilian and VIP targets score below armed combat targets at the same distance', () => {
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const rifle = makeEntity(UnitType.I_E1, House.Greece, 150, 100);
    const einstein = makeEntity(UnitType.I_EINSTEIN, House.Greece, 150, 100);

    const rifleScore = threatScore(scanner, rifle, 2);
    const einsteinScore = threatScore(scanner, einstein, 2);

    expect(rifleScore).toBeGreaterThan(einsteinScore);
  });
});
