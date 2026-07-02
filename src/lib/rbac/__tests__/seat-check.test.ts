import { describe, it, expect } from 'vitest';
import { evaluateSeatDecision, getPlanSeatLimits } from '../seat-check';

// Free plan seat limits, used across the scenarios below.
const FREE = getPlanSeatLimits('free'); // { maxFullSeats: 3, maxLightSeats: 10 }

describe('seat-check: evaluateSeatDecision', () => {
  describe('seat-neutral role changes (the bug)', () => {
    it('allows promoting an existing agent to admin even at the full-seat cap', () => {
      // Workspace at 3/3 full seats. Promoting an existing agent (already a full
      // seat) to admin (also a full seat) consumes no new seat, so it must be
      // allowed. The pre-fix code counted the user twice and wrongly rejected it.
      const result = evaluateSeatDecision({
        currentFullSeats: 3,
        currentLightSeats: 0,
        maxFullSeats: FREE.maxFullSeats,
        maxLightSeats: FREE.maxLightSeats,
        targetRole: 'admin',
        currentRole: 'agent',
      });
      expect(result.allowed).toBe(true);
    });

    it('allows agent -> owner at the full-seat cap (still one full seat)', () => {
      const result = evaluateSeatDecision({
        currentFullSeats: 3,
        currentLightSeats: 0,
        maxFullSeats: FREE.maxFullSeats,
        maxLightSeats: FREE.maxLightSeats,
        targetRole: 'owner',
        currentRole: 'agent',
      });
      expect(result.allowed).toBe(true);
    });

    it('allows a light_agent -> light_agent no-op at the light-seat cap', () => {
      const result = evaluateSeatDecision({
        currentFullSeats: 0,
        currentLightSeats: 10,
        maxFullSeats: FREE.maxFullSeats,
        maxLightSeats: FREE.maxLightSeats,
        targetRole: 'light_agent',
        currentRole: 'light_agent',
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('genuine seat additions still gated at the cap', () => {
    it('blocks a brand-new full-seat user (invite) when full seats are at the cap', () => {
      const result = evaluateSeatDecision({
        currentFullSeats: 3,
        currentLightSeats: 0,
        maxFullSeats: FREE.maxFullSeats,
        maxLightSeats: FREE.maxLightSeats,
        targetRole: 'agent',
        // no currentRole -> brand-new user, this is a fresh seat
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Full seat limit reached/);
    });

    it('blocks moving a light_agent INTO a full seat when full seats are at the cap', () => {
      // light_agent does not hold a full seat, so admin is a genuine +1 full seat.
      const result = evaluateSeatDecision({
        currentFullSeats: 3,
        currentLightSeats: 1,
        maxFullSeats: FREE.maxFullSeats,
        maxLightSeats: FREE.maxLightSeats,
        targetRole: 'admin',
        currentRole: 'light_agent',
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Full seat limit reached/);
    });

    it('blocks moving a full-seat user INTO a light seat when light seats are at the cap', () => {
      const result = evaluateSeatDecision({
        currentFullSeats: 2,
        currentLightSeats: 10,
        maxFullSeats: FREE.maxFullSeats,
        maxLightSeats: FREE.maxLightSeats,
        targetRole: 'light_agent',
        currentRole: 'agent',
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Light agent seat limit reached/);
    });

    it('allows a new full-seat user when there is room', () => {
      const result = evaluateSeatDecision({
        currentFullSeats: 2,
        currentLightSeats: 0,
        maxFullSeats: FREE.maxFullSeats,
        maxLightSeats: FREE.maxLightSeats,
        targetRole: 'agent',
      });
      expect(result.allowed).toBe(true);
      expect(result.currentFullSeats).toBe(2);
      expect(result.maxFullSeats).toBe(3);
    });
  });

  describe('free / unlimited roles', () => {
    it('always allows free roles (viewer/collaborator) regardless of counts', () => {
      expect(
        evaluateSeatDecision({
          currentFullSeats: 99,
          currentLightSeats: 99,
          maxFullSeats: 3,
          maxLightSeats: 10,
          targetRole: 'viewer',
        }).allowed,
      ).toBe(true);
      expect(
        evaluateSeatDecision({
          currentFullSeats: 99,
          currentLightSeats: 99,
          maxFullSeats: 3,
          maxLightSeats: 10,
          targetRole: 'collaborator',
        }).allowed,
      ).toBe(true);
    });

    it('never blocks on plans with unlimited seats', () => {
      const ent = getPlanSeatLimits('enterprise');
      const result = evaluateSeatDecision({
        currentFullSeats: 1000,
        currentLightSeats: 1000,
        maxFullSeats: ent.maxFullSeats,
        maxLightSeats: ent.maxLightSeats,
        targetRole: 'agent',
      });
      expect(result.allowed).toBe(true);
    });
  });
});

describe('seat-check: getPlanSeatLimits', () => {
  it('returns the documented per-plan seat caps', () => {
    expect(getPlanSeatLimits('free')).toEqual({ maxFullSeats: 3, maxLightSeats: 10 });
    expect(getPlanSeatLimits('starter')).toEqual({ maxFullSeats: 10, maxLightSeats: 25 });
    expect(getPlanSeatLimits('pro')).toEqual({ maxFullSeats: 25, maxLightSeats: 50 });
    expect(getPlanSeatLimits('founder')).toEqual({ maxFullSeats: 25, maxLightSeats: 50 });
    expect(getPlanSeatLimits('enterprise')).toEqual({ maxFullSeats: Infinity, maxLightSeats: Infinity });
    expect(getPlanSeatLimits('byoc')).toEqual({ maxFullSeats: Infinity, maxLightSeats: Infinity });
  });

  it('defaults unknown plans to the free tier', () => {
    expect(getPlanSeatLimits('mystery-plan')).toEqual({ maxFullSeats: 3, maxLightSeats: 10 });
  });
});
