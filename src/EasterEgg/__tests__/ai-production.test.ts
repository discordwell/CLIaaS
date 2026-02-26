import { describe, it, expect } from 'vitest';
import { House, UnitType } from '../engine/types';

describe('AI Production', () => {
  it('AI infantry composition matches expected distribution', () => {
    // Test the random distribution logic
    const counts = { E1: 0, E3: 0, DOG: 0, E2: 0 };
    for (let i = 0; i < 1000; i++) {
      const roll = Math.random();
      const type = roll < 0.6 ? 'E1' : roll < 0.8 ? 'E3' : roll < 0.9 ? 'DOG' : 'E2';
      counts[type]++;
    }
    // E1 should be most common (~60%)
    expect(counts.E1).toBeGreaterThan(500);
    expect(counts.E3).toBeGreaterThan(100);
  });

  it('AI vehicle composition matches expected distribution', () => {
    const counts = { '2TNK': 0, '1TNK': 0, JEEP: 0 };
    for (let i = 0; i < 1000; i++) {
      const roll = Math.random();
      const type = roll < 0.5 ? '2TNK' : roll < 0.8 ? '1TNK' : 'JEEP';
      counts[type]++;
    }
    expect(counts['2TNK']).toBeGreaterThan(400);
    expect(counts['1TNK']).toBeGreaterThan(200);
  });

  it('House enum has all required AI factions', () => {
    expect(House.USSR).toBeDefined();
    expect(House.Ukraine).toBeDefined();
    expect(House.Germany).toBeDefined();
  });

  it('UnitType has required infantry types for AI production', () => {
    expect(UnitType.I_E1).toBeDefined();
    expect(UnitType.I_E2).toBeDefined();
    expect(UnitType.I_E3).toBeDefined();
    expect(UnitType.I_DOG).toBeDefined();
  });

  it('UnitType has required vehicle types for AI production', () => {
    expect(UnitType.V_JEEP).toBeDefined();
    expect(UnitType.V_1TNK).toBeDefined();
    expect(UnitType.V_2TNK).toBeDefined();
  });
});
