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
  it('fire ant scores higher than scout ant at same distance', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const fireAnt = makeEntity(UnitType.ANT2, House.USSR, 150, 100);
    const scoutAnt = makeEntity(UnitType.ANT3, House.USSR, 150, 100);

    const fireScore = threatScore(scanner, fireAnt, 2, false);
    const scoutScore = threatScore(scanner, scoutAnt, 2, false);

    expect(fireScore).toBeGreaterThan(scoutScore);
  });

  it('wounded target scores higher than full-health same type', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const healthy = makeEntity(UnitType.ANT1, House.USSR, 150, 100);
    const wounded = makeEntity(UnitType.ANT1, House.USSR, 150, 100);
    wounded.hp = wounded.maxHp * 0.3; // 30% HP, below 50% threshold

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
    // Retaliation bonus is 2x
    expect(aggressiveScore / passiveScore).toBeCloseTo(2.0, 1);
  });

  it('closer target scores higher than distant same type', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const near = makeEntity(UnitType.ANT1, House.USSR, 120, 100);
    const far = makeEntity(UnitType.ANT1, House.USSR, 200, 100);

    const nearScore = threatScore(scanner, near, 1, false);
    const farScore = threatScore(scanner, far, 5, false);

    expect(nearScore).toBeGreaterThan(farScore);
  });

  it('experienced target (high kills) scores higher', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const rookie = makeEntity(UnitType.ANT1, House.USSR, 150, 100);
    const veteran = makeEntity(UnitType.ANT1, House.USSR, 150, 100);
    veteran.kills = 5; // +15 score bonus

    const rookieScore = threatScore(scanner, rookie, 2, false);
    const vetScore = threatScore(scanner, veteran, 2, false);

    expect(vetScore).toBeGreaterThan(rookieScore);
  });

  it('threatening far target beats harmless close target', () => {
    // Key behavioral test: fire ant attacking allies at distance 4
    // should score higher than idle scout ant at distance 1
    const scanner = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);

    const closeScout = makeEntity(UnitType.ANT3, House.USSR, 110, 100);
    const farFireAnt = makeEntity(UnitType.ANT2, House.USSR, 200, 100);
    farFireAnt.kills = 3; // has been killing allies

    const closeScore = threatScore(scanner, closeScout, 0.5, false);
    // Fire ant is attacking an ally AND has kills
    const farScore = threatScore(scanner, farFireAnt, 4, true);

    expect(farScore).toBeGreaterThan(closeScore);
  });

  it('vehicles score higher than infantry base value', () => {
    const scanner = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    // Using an ant-faction vehicle stand-in is awkward, so just test the type scoring
    // Vehicles get base 25, infantry gets base 10
    const vehicle = makeEntity(UnitType.V_2TNK, House.USSR, 150, 100);
    const infantry = makeEntity(UnitType.I_E1, House.USSR, 150, 100);

    const vehScore = threatScore(scanner, vehicle, 2, false);
    const infScore = threatScore(scanner, infantry, 2, false);

    expect(vehScore).toBeGreaterThan(infScore);
  });
});
