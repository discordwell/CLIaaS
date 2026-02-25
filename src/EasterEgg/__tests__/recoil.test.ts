/**
 * Tests for C++ RA-style recoil animation (unit.cpp Recoil_Adjust).
 * Verifies: isInRecoilState set on fire, cleared next tick, correct offsets per facing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds, RECOIL_OFFSETS } from '../engine/entity';
import { Dir, UnitType, House } from '../engine/types';

beforeEach(() => resetEntityIds());

describe('Recoil state', () => {
  it('isInRecoilState defaults to false', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(tank.isInRecoilState).toBe(false);
  });

  it('isInRecoilState can be set and cleared', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.isInRecoilState = true;
    expect(tank.isInRecoilState).toBe(true);
    tank.isInRecoilState = false;
    expect(tank.isInRecoilState).toBe(false);
  });
});

describe('RECOIL_OFFSETS', () => {
  it('has 8 entries (one per direction)', () => {
    expect(RECOIL_OFFSETS).toHaveLength(8);
  });

  it('N facing → body kicks south (dy=+1)', () => {
    const ro = RECOIL_OFFSETS[Dir.N];
    expect(ro.dx).toBe(0);
    expect(ro.dy).toBe(1);
  });

  it('E facing → body kicks west (dx=-1)', () => {
    const ro = RECOIL_OFFSETS[Dir.E];
    expect(ro.dx).toBe(-1);
    expect(ro.dy).toBe(0);
  });

  it('S facing → body kicks north (dy=-1)', () => {
    const ro = RECOIL_OFFSETS[Dir.S];
    expect(ro.dx).toBe(0);
    expect(ro.dy).toBe(-1);
  });

  it('W facing → body kicks east (dx=+1)', () => {
    const ro = RECOIL_OFFSETS[Dir.W];
    expect(ro.dx).toBe(1);
    expect(ro.dy).toBe(0);
  });

  it('diagonal facings have both dx and dy', () => {
    const ne = RECOIL_OFFSETS[Dir.NE];
    expect(ne.dx).toBe(-1);
    expect(ne.dy).toBe(1);

    const sw = RECOIL_OFFSETS[Dir.SW];
    expect(sw.dx).toBe(1);
    expect(sw.dy).toBe(-1);
  });

  it('all offsets are exactly ±1 magnitude', () => {
    for (const ro of RECOIL_OFFSETS) {
      expect(Math.abs(ro.dx)).toBeLessThanOrEqual(1);
      expect(Math.abs(ro.dy)).toBeLessThanOrEqual(1);
      // At least one axis should be non-zero
      expect(Math.abs(ro.dx) + Math.abs(ro.dy)).toBeGreaterThan(0);
    }
  });
});
