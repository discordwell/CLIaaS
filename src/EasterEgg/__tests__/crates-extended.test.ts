import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { UnitType, House, CELL_SIZE } from '../engine/types';

beforeEach(() => resetEntityIds());

describe('Extended Crate Types', () => {
  it('entity has cloakTick field initialized to 0', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(e.cloakTick).toBe(0);
  });

  it('entity has invulnTick field initialized to 0', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(e.invulnTick).toBe(0);
  });

  it('cloak crate sets 450 tick timer', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    e.cloakTick = 450;
    expect(e.cloakTick).toBe(450);
  });

  it('invuln crate sets 300 tick timer', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    e.invulnTick = 300;
    expect(e.invulnTick).toBe(300);
  });
});
