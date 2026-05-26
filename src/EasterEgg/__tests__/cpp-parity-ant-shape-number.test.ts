/**
 * C++ UnitClass::Shape_Number parity for expansion ant units.
 *
 * Under FIXIT_ANTS, ants are UnitClass objects with Rotation=8. Their live
 * frame does not come from InfantryClass Doing state; C++ derives it from
 * PrimaryFacing, BodyShape, IsDriving, Arm, Frame, and Units.ID(this).
 */
import { describe, expect, it } from 'vitest';

import { cppAntUnitFrame } from '../engine/renderer.js';

describe('C++ ant UnitClass::Shape_Number frame selection', () => {
  it('uses BodyShape quadrant and Units.ID for attack animation phase', () => {
    expect(cppAntUnitFrame({
      id: 8,
      bodyFacing256: 57,
      bodyFacing32: 7,
      isDriving: false,
      attackCooldown: 8,
      cppUnitIndexHint: 7,
    }, 100)).toBe(97);
  });

  it('falls back to the standing quadrant when not driving or armed', () => {
    expect(cppAntUnitFrame({
      id: 42,
      bodyFacing256: 91,
      bodyFacing32: 12,
      isDriving: false,
      attackCooldown: 0,
      cppUnitIndexHint: 41,
    }, 100)).toBe(5);
  });
});
