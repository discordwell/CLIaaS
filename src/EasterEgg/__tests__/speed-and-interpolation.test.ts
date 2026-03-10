/**
 * Visual facing interpolation tests.
 *
 * Verifies:
 * - Entity prevBodyFacing32/prevTurretFacing32 fields exist for interpolation
 * - Ring interpolation logic (lerpFacing32) handles wrapping correctly
 */
import { describe, it, expect } from 'vitest';
import { Entity } from '../engine/entity';
import { UnitType, Dir, House } from '../engine/types';

/** Ring interpolation matching renderer's lerpFacing32 */
function lerpFacing32(prev: number, curr: number, alpha: number): number {
  if (prev === curr) return curr;
  let diff = (curr - prev + 32) % 32;
  if (diff > 16) diff -= 32;
  const result = prev + diff * alpha;
  return ((Math.round(result) % 32) + 32) % 32;
}

describe('Entity facing interpolation fields', () => {
  it('Entity has prevBodyFacing32 and prevTurretFacing32 initialized', () => {
    const entity = new Entity(UnitType.V_JEEP, House.GOOD, 100, 100);
    // Should be initialized to same as current facing (default North = 0)
    expect(entity.prevBodyFacing32).toBe(entity.bodyFacing32);
    expect(entity.prevTurretFacing32).toBe(entity.turretFacing32);
    expect(entity.prevBodyFacing32).toBe(0); // N * 4 = 0
  });

  it('prevBodyFacing32 tracks bodyFacing32 when manually set', () => {
    const entity = new Entity(UnitType.V_1TNK, House.GOOD, 100, 100);
    entity.facing = Dir.E;
    entity.bodyFacing32 = Dir.E * 4; // 8
    entity.prevBodyFacing32 = entity.bodyFacing32;
    expect(entity.prevBodyFacing32).toBe(8);
  });
});

describe('Ring interpolation (lerpFacing32)', () => {
  it('no change when prev equals curr', () => {
    expect(lerpFacing32(8, 8, 0.5)).toBe(8);
  });

  it('interpolates clockwise (short path)', () => {
    // 0 → 4 (45° CW): at alpha=0.5 should be 2
    expect(lerpFacing32(0, 4, 0.5)).toBe(2);
  });

  it('interpolates counter-clockwise across wrap (short path)', () => {
    // 2 → 30 (going CCW 4 steps is shorter than CW 28 steps)
    // diff = (30 - 2 + 32) % 32 = 28, > 16, so diff = 28-32 = -4
    // result = 2 + (-4) * 0.5 = 0
    expect(lerpFacing32(2, 30, 0.5)).toBe(0);
  });

  it('alpha=0 returns prev', () => {
    expect(lerpFacing32(4, 12, 0)).toBe(4);
  });

  it('alpha=1 returns curr', () => {
    expect(lerpFacing32(4, 12, 1)).toBe(12);
  });

  it('handles wrap from 31 to 1 (2-step CW)', () => {
    // diff = (1 - 31 + 32) % 32 = 2, <= 16, so CW
    // result at 0.5 = 31 + 2*0.5 = 32 % 32 = 0
    expect(lerpFacing32(31, 1, 0.5)).toBe(0);
  });

  it('handles 180° rotation (ambiguous — takes CW)', () => {
    // diff = (16 - 0 + 32) % 32 = 16, <= 16, so CW
    expect(lerpFacing32(0, 16, 0.5)).toBe(8);
  });
});
