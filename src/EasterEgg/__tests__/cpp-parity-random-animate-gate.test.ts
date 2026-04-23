/**
 * C++ Parity: Random_Animate gate (Phase 7A).
 *
 * Pins the C++ `InfantryClass::Is_Ready_To_Random_Animate` contract against
 * the TS `Entity.isReadyToRandomAnimate()` gate. The TS gate was historically
 * stricter than C++'s because (a) TS lacked a DO_WALK → DO_STAND_READY
 * transition in `doingAI` and (b) the TS `doing` enum collapses DO_STAND_GUARD
 * and DO_STAND_READY into a single `'stand_ready'` value.
 *
 * The C++ gate permits idle animations when ALL of the following hold:
 *   1. TechnoClass::Is_Ready_To_Random_Animate: IdleTimer == 0
 *   2. Height == 0 (not paradropping)
 *   3. !IsDriving
 *   4. !IsProne
 *   5. !IsFiring
 *   6. Doing is DO_STAND_GUARD or DO_STAND_READY (idle stances)
 *
 * ## C++ refs
 *
 *   - `src/EasterEgg/CnC_and_Red_Alert/RA/infantry.cpp:4087-4158`  Is_Ready_To_Random_Animate
 *   - `src/EasterEgg/CnC_and_Red_Alert/RA/techno.cpp:5350-5368`    base class (IdleTimer==0)
 *   - `src/EasterEgg/CnC_and_Red_Alert/RA/infantry.cpp:3698-3760`  Doing_AI (DO_WALK → DO_STAND_READY)
 *   - `src/EasterEgg/CnC_and_Red_Alert/RA/foot.cpp:638-698`        Mission_Guard Random_Animate dispatch
 *
 * ## TS refs
 *
 *   - `src/EasterEgg/engine/entity.ts:283-293`                     isReadyToRandomAnimate gate
 *   - `src/EasterEgg/engine/entity.ts:268-281`                     doingAI transitions
 *   - `src/EasterEgg/engine/perCellProcess.ts` RANDOM_ANIMATE_CPP_FAITHFUL  flip-switch
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { UnitType, House } from '../engine/types';
import { RANDOM_ANIMATE_CPP_FAITHFUL } from '../engine/perCellProcess';

function mkInfantry(type: UnitType = UnitType.I_E1): Entity {
  const e = new Entity(type, House.USSR, 64 * 24 + 12, 64 * 24 + 12);
  e.alive = true;
  return e;
}

beforeEach(() => { resetEntityIds(); });

describe('C++ Random_Animate gate (Phase 7A contract)', () => {
  it('blocks when idleAnimTimer > 0 (TechnoClass base gate — IdleTimer)', () => {
    const e = mkInfantry();
    e.doing = 'stand_ready';
    e.idleAnimTimer = 5;
    expect(e.isReadyToRandomAnimate()).toBe(false);
  });

  it('blocks when doing === "walk" (C++ Doing == DO_WALK)', () => {
    const e = mkInfantry();
    e.doing = 'walk';
    e.idleAnimTimer = 0;
    expect(e.isReadyToRandomAnimate()).toBe(false);
  });

  it('blocks when isDriving (C++ IsDriving check)', () => {
    const e = mkInfantry();
    e.doing = 'stand_ready';
    e.isDriving = true;
    expect(e.isReadyToRandomAnimate()).toBe(false);
  });

  it('blocks when isFiringAnim (C++ IsFiring check)', () => {
    const e = mkInfantry();
    e.doing = 'stand_ready';
    e.isFiringAnim = true;
    expect(e.isReadyToRandomAnimate()).toBe(false);
  });

  it('allows when doing === "stand_ready" and all other gates clear', () => {
    const e = mkInfantry();
    e.doing = 'stand_ready';
    e.idleAnimTimer = 0;
    e.isDriving = false;
    e.isFiringAnim = false;
    expect(e.isReadyToRandomAnimate()).toBe(true);
  });

  it('blocks non-infantry entirely (Random_Animate is InfantryClass-only)', () => {
    const veh = new Entity(UnitType.V_MCV, House.USSR, 0, 0);
    veh.alive = true;
    expect(veh.isReadyToRandomAnimate()).toBe(false);
  });

  it('phase-7A flag RANDOM_ANIMATE_CPP_FAITHFUL is exported and boolean', () => {
    // Flag scaffolding gates the C++-faithful gate. When OFF the gate remains
    // strict (doing === 'stand_ready'). When ON, the gate becomes C++-faithful
    // (doing != 'walk' && doing != 'idle_anim', mirroring C++'s check that
    // Doing is DO_STAND_GUARD/DO_STAND_READY — post-doingAI auto-transition).
    expect(typeof RANDOM_ANIMATE_CPP_FAITHFUL).toBe('boolean');
  });

  describe('C++ Doing_AI DO_WALK → DO_STAND_READY transition (flag OFF parity hole)', () => {
    // C++ infantry.cpp:3700-3732: when Fetch_Stage() >= DoControls[Doing].Count,
    // Doing_AI transitions DO_WALK → DO_STAND_READY if !IsDriving. TS's doingAI
    // only handles {nothing, idle_anim, fire}; `walk` is sticky once set. This
    // is the parity hole Phase 7A closes.
    it('flag OFF: doing === "walk" persists after isDriving=false (current TS behavior)', () => {
      const e = mkInfantry();
      e.doing = 'walk';
      e.isDriving = false;
      e.doingAI();
      // Flag-OFF path: `walk` is NOT in the transition whitelist.
      if (!RANDOM_ANIMATE_CPP_FAITHFUL) {
        expect(e.doing).toBe('walk');
      }
    });

    it('flag ON: doing === "walk" transitions to "stand_ready" when not driving', () => {
      const e = mkInfantry();
      e.doing = 'walk';
      e.isDriving = false;
      e.doingAI();
      if (RANDOM_ANIMATE_CPP_FAITHFUL) {
        expect(e.doing).toBe('stand_ready');
      }
    });
  });
});
