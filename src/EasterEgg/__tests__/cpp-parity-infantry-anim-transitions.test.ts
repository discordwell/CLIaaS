/**
 * C++ Parity Test: Infantry Animation Transitions (G3 + G8)
 *
 * G3: LIE_DOWN/GET_UP Transition State Machine
 * C++ infantry.cpp: When infantry transitions to/from prone, they play
 * DO_LIE_DOWN / DO_GET_UP transition animations (~2 frames per facing).
 * C++ idata.cpp: Each infantry type's DoControls table defines lieDown/getUp entries.
 *
 * G8: Gesture/Salute Animation Fields
 * C++ idata.cpp: E1DoControls, E2DoControls, etc. define DO_GESTURE1/2, DO_SALUTE1/2.
 * C++ infantry.cpp:886-888: Random_Animate triggers gesture on transport unload.
 * TS triggers gesture as a rare idle fidget variant (~5% chance).
 *
 * C++ reference files:
 *   - src/EasterEgg/CnC_and_Red_Alert/RA/idata.cpp (DoControls tables)
 *   - src/EasterEgg/CnC_and_Red_Alert/RA/infantry.cpp:886-888 (Random_Animate)
 *   - src/EasterEgg/CnC_and_Red_Alert/RA/defines.h:2293-2319 (DoType enum)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Entity } from '../engine/entity';
import {
  AnimState, UnitType, House, INFANTRY_ANIMS, INFANTRY_SHAPE,
  type InfantryAnim, type DoInfo,
} from '../engine/types';

// ========== HELPERS ==========

function makeInfantry(type: string = 'E1'): Entity {
  const e = new Entity(type as UnitType, House.Spain);
  // Ensure it's alive and idle
  e.alive = true;
  e.animState = AnimState.IDLE;
  e.animFrame = 0;
  e.animTick = 0;
  e.isProne = false;
  e.prevIsProne = false;
  return e;
}

// ========== C++ REFERENCE DATA ==========

// C++ idata.cpp DoControls — lieDown/getUp entries for each infantry type.
// Format: { frame, count, jump } — from the DO_LIE_DOWN and DO_GET_UP rows.
const CPP_LIE_DOWN: Record<string, { frame: number; count: number; jump: number }> = {
  E1:   { frame: 128, count: 2, jump: 2 },  // E1DoControls (idata.cpp:86)
  E2:   { frame: 224, count: 2, jump: 2 },  // E2DoControls (idata.cpp:110)
  E3:   { frame: 128, count: 2, jump: 2 },  // E3DoControls (idata.cpp:134)
  E4:   { frame: 192, count: 2, jump: 2 },  // E4DoControls (idata.cpp:158)
  E6:   { frame: 67,  count: 2, jump: 2 },  // E6DoControls (idata.cpp:182)
  E7:   { frame: 113, count: 2, jump: 2 },  // E7DoControls (idata.cpp:206)
  SPY:  { frame: 128, count: 2, jump: 2 },  // SpyDoControls (idata.cpp:231)
  GNRL: { frame: 88,  count: 2, jump: 2 },  // GeneralDoControls (idata.cpp:303)
};

const CPP_GET_UP: Record<string, { frame: number; count: number; jump: number }> = {
  E1:   { frame: 176, count: 2, jump: 2 },  // E1DoControls (idata.cpp:88)
  E2:   { frame: 272, count: 2, jump: 2 },  // E2DoControls (idata.cpp:112)
  E3:   { frame: 176, count: 2, jump: 2 },  // E3DoControls (idata.cpp:136)
  E4:   { frame: 240, count: 2, jump: 2 },  // E4DoControls (idata.cpp:160)
  E6:   { frame: 114, count: 2, jump: 2 },  // E6DoControls (idata.cpp:184)
  E7:   { frame: 161, count: 2, jump: 2 },  // E7DoControls (idata.cpp:208)
  SPY:  { frame: 176, count: 2, jump: 2 },  // SpyDoControls (idata.cpp:233)
  GNRL: { frame: 136, count: 2, jump: 2 },  // GeneralDoControls (idata.cpp:305)
};

// C++ idata.cpp gesture/salute entries — only types with real animations (not {0,1,0}).
// Values are frame-94 for types that use the -94 offset convention.
const CPP_GESTURES: Record<string, {
  gesture1: { frame: number; count: number; jump: number };
  salute1: { frame: number; count: number; jump: number };
  gesture2: { frame: number; count: number; jump: number };
  salute2: { frame: number; count: number; jump: number };
}> = {
  E1: {
    gesture1: { frame: 436 - 94, count: 3, jump: 3 },  // idata.cpp:97
    salute1:  { frame: 460 - 94, count: 3, jump: 3 },  // idata.cpp:98
    gesture2: { frame: 484 - 94, count: 3, jump: 3 },  // idata.cpp:99
    salute2:  { frame: 508 - 94, count: 3, jump: 3 },  // idata.cpp:100
  },
  E2: {
    gesture1: { frame: 564 - 94, count: 3, jump: 3 },  // idata.cpp:121
    salute1:  { frame: 588 - 94, count: 3, jump: 3 },  // idata.cpp:122
    gesture2: { frame: 612 - 94, count: 3, jump: 3 },  // idata.cpp:123
    salute2:  { frame: 636 - 94, count: 3, jump: 3 },  // idata.cpp:124
  },
  E3: {
    gesture1: { frame: 452 - 94, count: 3, jump: 3 },  // idata.cpp:145
    salute1:  { frame: 476 - 94, count: 3, jump: 3 },  // idata.cpp:146
    gesture2: { frame: 500 - 94, count: 3, jump: 3 },  // idata.cpp:147
    salute2:  { frame: 524 - 94, count: 3, jump: 3 },  // idata.cpp:148
  },
  E4: {
    gesture1: { frame: 564 - 94, count: 3, jump: 3 },  // idata.cpp:169
    salute1:  { frame: 588 - 94, count: 3, jump: 3 },  // idata.cpp:170
    gesture2: { frame: 612 - 94, count: 3, jump: 3 },  // idata.cpp:171
    salute2:  { frame: 636 - 94, count: 3, jump: 3 },  // idata.cpp:172
  },
  E6: {
    gesture1: { frame: 200, count: 3, jump: 3 },  // idata.cpp:193
    salute1:  { frame: 224, count: 3, jump: 3 },  // idata.cpp:194
    gesture2: { frame: 200, count: 3, jump: 3 },  // idata.cpp:195 (same as gesture1)
    salute2:  { frame: 224, count: 3, jump: 3 },  // idata.cpp:196 (same as salute1)
  },
};

// Types where C++ has {0,1,0} for all gesture/salute entries — degenerate, no real animation.
const CPP_NO_GESTURE_TYPES = ['E7', 'SPY', 'GNRL', 'MECH', 'THF', 'DOG'];


// ========== G3 TESTS: LIE_DOWN/GET_UP ==========

describe('C++ Parity: G3 — LIE_DOWN/GET_UP Transition Animations', () => {

  it('AnimState enum includes LIE_DOWN and GET_UP', () => {
    expect(AnimState.LIE_DOWN).toBe('LIE_DOWN');
    expect(AnimState.GET_UP).toBe('GET_UP');
  });

  it('INFANTRY_ANIMS lieDown values match C++ idata.cpp DoControls', () => {
    for (const [type, cpp] of Object.entries(CPP_LIE_DOWN)) {
      const ts = INFANTRY_ANIMS[type]?.lieDown;
      expect(ts, `${type} should have lieDown`).toBeDefined();
      expect(ts!.frame, `${type} lieDown.frame`).toBe(cpp.frame);
      expect(ts!.count, `${type} lieDown.count`).toBe(cpp.count);
      expect(ts!.jump, `${type} lieDown.jump`).toBe(cpp.jump);
    }
  });

  it('INFANTRY_ANIMS getUp values match C++ idata.cpp DoControls', () => {
    for (const [type, cpp] of Object.entries(CPP_GET_UP)) {
      const ts = INFANTRY_ANIMS[type]?.getUp;
      expect(ts, `${type} should have getUp`).toBeDefined();
      expect(ts!.frame, `${type} getUp.frame`).toBe(cpp.frame);
      expect(ts!.count, `${type} getUp.count`).toBe(cpp.count);
      expect(ts!.jump, `${type} getUp.jump`).toBe(cpp.jump);
    }
  });

  it('standing-to-prone transition enters LIE_DOWN state', () => {
    const e = makeInfantry('E1');
    e.isProne = true; // index.ts would set this
    e.tickAnimation();
    expect(e.animState).toBe(AnimState.LIE_DOWN);
    expect(e.animFrame).toBeLessThanOrEqual(1); // just started
  });

  it('prone-to-standing transition enters GET_UP state', () => {
    const e = makeInfantry('E1');
    // Start in prone state
    e.isProne = true;
    e.prevIsProne = true;
    e.animState = AnimState.IDLE;
    // Now stand up
    e.isProne = false;
    e.tickAnimation();
    expect(e.animState).toBe(AnimState.GET_UP);
    expect(e.animFrame).toBeLessThanOrEqual(1);
  });

  it('LIE_DOWN completes after count frames and transitions to IDLE', () => {
    const e = makeInfantry('E1');
    const anim = INFANTRY_ANIMS.E1;
    e.animState = AnimState.LIE_DOWN;
    e.isProne = true;
    e.prevIsProne = true; // already tracked
    // Set animFrame to count (animation complete)
    e.animFrame = anim.lieDown!.count;
    e.tickAnimation();
    expect(e.animState).toBe(AnimState.IDLE);
  });

  it('GET_UP completes after count frames and transitions to IDLE', () => {
    const e = makeInfantry('E1');
    const anim = INFANTRY_ANIMS.E1;
    e.animState = AnimState.GET_UP;
    e.isProne = false;
    e.prevIsProne = false;
    e.animFrame = anim.getUp!.count;
    e.tickAnimation();
    expect(e.animState).toBe(AnimState.IDLE);
  });

  it('LIE_DOWN sprite frame uses lieDown DoInfo with direction', () => {
    const e = makeInfantry('E1');
    e.animState = AnimState.LIE_DOWN;
    e.animFrame = 0;
    e.facing = 0; // N → INFANTRY_SHAPE[0] = 0
    const anim = INFANTRY_ANIMS.E1;
    const expected = anim.lieDown!.frame + INFANTRY_SHAPE[0] * anim.lieDown!.jump + 0;
    expect(e.spriteFrame).toBe(expected);
  });

  it('GET_UP sprite frame uses getUp DoInfo with direction', () => {
    const e = makeInfantry('E1');
    e.animState = AnimState.GET_UP;
    e.animFrame = 1;
    e.facing = 4; // S → INFANTRY_SHAPE[4] = 4
    e.bodyFacing256 = 128;
    e.bodyFacing32 = 16;
    const anim = INFANTRY_ANIMS.E1;
    const sdir = INFANTRY_SHAPE[4];
    const expected = anim.getUp!.frame + sdir * anim.getUp!.jump + 1;
    expect(e.spriteFrame).toBe(expected);
  });

  it('transition does NOT trigger when unit is walking', () => {
    const e = makeInfantry('E1');
    e.animState = AnimState.WALK;
    e.isProne = true;
    e.tickAnimation();
    // Should NOT override WALK with LIE_DOWN
    // (prevIsProne updated, but animState stays WALK since unit is actively moving)
    expect(e.animState).not.toBe(AnimState.LIE_DOWN);
  });

  it('transition does NOT trigger when unit is attacking', () => {
    const e = makeInfantry('E1');
    e.animState = AnimState.ATTACK;
    e.isProne = true;
    e.tickAnimation();
    expect(e.animState).not.toBe(AnimState.LIE_DOWN);
  });

  it('transition does NOT trigger for dogs (no lieDown anim)', () => {
    const e = makeInfantry('DOG');
    e.animState = AnimState.IDLE;
    e.isProne = true;
    e.tickAnimation();
    // DOG has no lieDown in INFANTRY_ANIMS, so should stay IDLE
    expect(e.animState).not.toBe(AnimState.LIE_DOWN);
  });

  it('civilians without lieDown skip transition', () => {
    const e = makeInfantry('C1');
    e.animState = AnimState.IDLE;
    e.isProne = true;
    e.tickAnimation();
    // C1 has no lieDown defined
    expect(e.animState).not.toBe(AnimState.LIE_DOWN);
  });
});


// ========== G8 TESTS: GESTURE/SALUTE ==========

describe('C++ Parity: G8 — Gesture/Salute Animation Fields', () => {

  it('AnimState enum includes GESTURE', () => {
    expect(AnimState.GESTURE).toBe('GESTURE');
  });

  it('InfantryAnim has gesture/salute fields for types with real C++ entries', () => {
    for (const [type, cpp] of Object.entries(CPP_GESTURES)) {
      const ts = INFANTRY_ANIMS[type];
      expect(ts, `${type} should exist in INFANTRY_ANIMS`).toBeDefined();

      expect(ts.gesture1, `${type} should have gesture1`).toBeDefined();
      expect(ts.gesture1!.frame, `${type} gesture1.frame`).toBe(cpp.gesture1.frame);
      expect(ts.gesture1!.count, `${type} gesture1.count`).toBe(cpp.gesture1.count);
      expect(ts.gesture1!.jump, `${type} gesture1.jump`).toBe(cpp.gesture1.jump);

      expect(ts.salute1, `${type} should have salute1`).toBeDefined();
      expect(ts.salute1!.frame, `${type} salute1.frame`).toBe(cpp.salute1.frame);
      expect(ts.salute1!.count, `${type} salute1.count`).toBe(cpp.salute1.count);
      expect(ts.salute1!.jump, `${type} salute1.jump`).toBe(cpp.salute1.jump);

      expect(ts.gesture2, `${type} should have gesture2`).toBeDefined();
      expect(ts.gesture2!.frame, `${type} gesture2.frame`).toBe(cpp.gesture2.frame);
      expect(ts.gesture2!.count, `${type} gesture2.count`).toBe(cpp.gesture2.count);
      expect(ts.gesture2!.jump, `${type} gesture2.jump`).toBe(cpp.gesture2.jump);

      expect(ts.salute2, `${type} should have salute2`).toBeDefined();
      expect(ts.salute2!.frame, `${type} salute2.frame`).toBe(cpp.salute2.frame);
      expect(ts.salute2!.count, `${type} salute2.count`).toBe(cpp.salute2.count);
      expect(ts.salute2!.jump, `${type} salute2.jump`).toBe(cpp.salute2.jump);
    }
  });

  it('types with degenerate {0,1,0} C++ gesture entries omit gesture fields', () => {
    for (const type of CPP_NO_GESTURE_TYPES) {
      const ts = INFANTRY_ANIMS[type];
      if (!ts) continue; // type might not be in TS INFANTRY_ANIMS
      // These types have {0,1,0} in C++ — degenerate (just frame 0 standing).
      // TS should either not define them or they should be absent.
      expect(ts.gesture1, `${type} should NOT have gesture1`).toBeUndefined();
      expect(ts.gesture2, `${type} should NOT have gesture2`).toBeUndefined();
      expect(ts.salute1, `${type} should NOT have salute1`).toBeUndefined();
      expect(ts.salute2, `${type} should NOT have salute2`).toBeUndefined();
    }
  });

  it('GESTURE state triggers during idle fidget when fidgetVariant < 0.05', () => {
    const e = makeInfantry('E1');
    e.animState = AnimState.IDLE;
    // Set fidget conditions: past delay, variant in gesture range
    e.fidgetDelay = 5;
    e.animFrame = 10; // > fidgetDelay
    e.fidgetVariant = 0.02; // < 0.05 threshold
    e.tickAnimation();
    expect(e.animState).toBe(AnimState.GESTURE);
    expect(e.gestureDoInfo).not.toBeNull();
    expect(e.animFrame).toBe(0); // reset on transition
  });

  it('GESTURE does NOT trigger when fidgetVariant >= 0.05', () => {
    const e = makeInfantry('E1');
    e.animState = AnimState.IDLE;
    e.fidgetDelay = 5;
    e.animFrame = 10;
    e.fidgetVariant = 0.5; // well above threshold
    e.tickAnimation();
    expect(e.animState).not.toBe(AnimState.GESTURE);
  });

  it('GESTURE does NOT trigger when infantry is prone', () => {
    const e = makeInfantry('E1');
    e.animState = AnimState.IDLE;
    e.isProne = true;
    e.prevIsProne = true;
    e.fidgetDelay = 5;
    e.animFrame = 10;
    e.fidgetVariant = 0.02;
    e.tickAnimation();
    expect(e.animState).not.toBe(AnimState.GESTURE);
  });

  it('GESTURE completes and returns to IDLE after count frames', () => {
    const e = makeInfantry('E1');
    const anim = INFANTRY_ANIMS.E1;
    e.animState = AnimState.GESTURE;
    e.gestureDoInfo = anim.gesture1!;
    e.animFrame = anim.gesture1!.count; // animation complete
    e.tickAnimation();
    expect(e.animState).toBe(AnimState.IDLE);
    expect(e.gestureDoInfo).toBeNull();
  });

  it('GESTURE sprite frame uses gestureDoInfo with direction', () => {
    const e = makeInfantry('E1');
    const anim = INFANTRY_ANIMS.E1;
    e.animState = AnimState.GESTURE;
    e.gestureDoInfo = anim.gesture1!;
    e.animFrame = 1;
    e.facing = 2; // E → INFANTRY_SHAPE[2] = 6
    e.bodyFacing256 = 64;
    e.bodyFacing32 = 8;
    const sdir = INFANTRY_SHAPE[2];
    const expected = anim.gesture1!.frame + sdir * anim.gesture1!.jump + 1;
    expect(e.spriteFrame).toBe(expected);
  });

  it('GESTURE does NOT trigger for types without gesture anims (E7)', () => {
    const e = makeInfantry('E7');
    e.animState = AnimState.IDLE;
    e.fidgetDelay = 5;
    e.animFrame = 10;
    e.fidgetVariant = 0.02;
    e.tickAnimation();
    // E7 has no gesture fields, so should stay IDLE
    expect(e.animState).not.toBe(AnimState.GESTURE);
  });
});
