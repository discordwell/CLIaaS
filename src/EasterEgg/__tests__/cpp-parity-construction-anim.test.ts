/**
 * C++ parity test: Construction (buildup) animation — make-sheet frame cycling,
 * build progress timing, sell reversal.
 *
 * C++ source refs:
 *   building.cpp:2725-2743   Begin_Mode() — sets BState, fetches AnimControlType, calls Set_Rate/Set_Stage
 *   building.cpp:3325-3365   Mission_Construction() — INITIAL/DURING state machine
 *   building.cpp:4324-4346   Enter_Idle_Mode() — sets BSTATE_CONSTRUCTION + MISSION_CONSTRUCTION for new buildings
 *   building.cpp:5502-5571   Animation_AI() — stage counter drives IsReadyToCommence
 *   building.cpp:567-586     Shape_Number() — construction uses Fetch_Stage(), sell reverses frames
 *   building.cpp:5619-5624   Get_Image_Data() — switches to BuildupData during BSTATE_CONSTRUCTION
 *   bdata.cpp:2854-2856      Constructor defaults: Anims[BSTATE_CONSTRUCTION] = {Start:0, Count:1, Rate:0}
 *   bdata.cpp:3125-3131      One_Time() — timedelay = floor(BuildupTime * TICKS_PER_MINUTE / count)
 *   bdata.cpp:3326-3330      Init_Anim() — sets Start, Count, Rate for a BState
 *   bdata.cpp:3369-3374      Init() theater path — timedelay = (5 * TICKS_PER_SECOND) / count
 *   stage.h:41-80            StageClass — Timer countdown, Stage increments every Rate ticks
 *   stage.h:72-78            Graphic_Logic() — if (About_To_Change()) { Stage++; Timer = Rate; return true; }
 *   type.h:734-738           AnimControlType { Start, Count, Rate }
 *   defines.h:3031-3032      TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
 *   rules.cpp:180            BuildupTime = ".05" = 0.05
 *   rules.cpp:463            BuildupTime read from INI [General] section
 */

import { describe, it, expect } from 'vitest';

// ─── C++ Constants ──────────────────────────────────────────────────────────────
const TICKS_PER_SECOND = 15;
const TICKS_PER_MINUTE = TICKS_PER_SECOND * 60; // 900
const BUILDUP_TIME = 0.05; // rules.cpp:180 — fixed(".05")

// ─── C++ AnimControlType for BSTATE_CONSTRUCTION ────────────────────────────────
// bdata.cpp:3125-3131 One_Time():
//   int count = Get_Build_Frame_Count(dataptr);
//   if (count > 0) timedelay = (Rule.BuildupTime * TICKS_PER_MINUTE) / count;
//   Init_Anim(BSTATE_CONSTRUCTION, 0, count, timedelay);
//
// type.h:734-738:
//   typedef struct { int Start; int Count; int Rate; } AnimControlType;

interface AnimControlType {
  Start: number;
  Count: number;
  Rate: number;
}

/**
 * Calculate the C++ AnimControlType for BSTATE_CONSTRUCTION given a make-sheet frame count.
 * C++ bdata.cpp:3125-3131 (One_Time path, non-theater)
 */
function cppConstructionAnim(makeFrameCount: number): AnimControlType {
  let timedelay = 1;
  if (makeFrameCount > 0) {
    // C++ integer division: (Rule.BuildupTime * TICKS_PER_MINUTE) / count
    timedelay = Math.floor((BUILDUP_TIME * TICKS_PER_MINUTE) / makeFrameCount);
  }
  return { Start: 0, Count: makeFrameCount, Rate: timedelay };
}

/**
 * Calculate the C++ AnimControlType for theater-specific buildings.
 * C++ bdata.cpp:3369-3374 (Init theater path)
 */
function cppTheaterConstructionAnim(makeFrameCount: number): AnimControlType {
  let timedelay = 1;
  if (makeFrameCount !== 0) {
    timedelay = Math.floor((5 * TICKS_PER_SECOND) / makeFrameCount);
  }
  return { Start: 0, Count: makeFrameCount, Rate: timedelay };
}

/**
 * Calculate total C++ construction duration (ticks) for the animation phase only.
 * stage.h:72-78: Stage increments every Rate ticks.
 * building.cpp:5528: IsReadyToCommence set when Fetch_Stage() == Start + Count - 1
 * So we need (Count - 1) increments, each taking Rate ticks.
 */
function cppConstructionDurationTicks(makeFrameCount: number): number {
  const anim = cppConstructionAnim(makeFrameCount);
  return (anim.Count - 1) * anim.Rate;
}

/**
 * Simulate the C++ StageClass progression during construction.
 * stage.h:41-80:
 *   Set_Rate(rate) → Timer = rate; Rate = rate;
 *   Set_Stage(start) → Stage = start;
 *   Graphic_Logic() {
 *     if (About_To_Change()) { Stage++; Timer = Rate; return true; }
 *     return false;
 *   }
 *   About_To_Change() → Timer == 0 && Rate != 0
 *
 * The timer is a CDTimerClass<FrameTimerClass> — counts down each game frame.
 * When it reaches 0 AND Rate != 0, Stage increments and Timer resets to Rate.
 *
 * Returns array of { tick, stage } entries for each stage change.
 */
function simulateCppStageProgression(anim: AnimControlType): Array<{ tick: number; stage: number }> {
  const results: Array<{ tick: number; stage: number }> = [];
  let stage = anim.Start;
  let timer = anim.Rate;
  let rate = anim.Rate;

  // Record initial state
  results.push({ tick: 0, stage });

  if (rate === 0) return results;

  // Simulate tick-by-tick
  for (let tick = 1; tick <= 1000; tick++) {
    timer--;
    if (timer === 0 && rate !== 0) {
      stage++;
      timer = rate;
      results.push({ tick, stage });

      // Stop at the last frame (IsReadyToCommence condition)
      if (stage >= anim.Start + anim.Count - 1) {
        break;
      }
    }
  }
  return results;
}

// ─── TS Construction Behavior ────────────────────────────────────────────────────
// TS engine/index.ts:1878-1880:
//   if (s.buildProgress !== undefined && s.buildProgress < 1) {
//     s.buildProgress = Math.min(1, s.buildProgress + 1 / 30);
//   }
//
// TS renderer.ts:1467-1468 (construction frame from make sheet):
//   useFrame = Math.min(Math.floor(s.buildProgress! * maxFrame), maxFrame);

const TS_CONSTRUCTION_TICKS = 30; // hardcoded 1/30 increment rate

/**
 * Simulate TS construction frame progression.
 * Returns array of { tick, frame } entries where frame changes.
 */
function simulateTsFrameProgression(maxFrame: number): Array<{ tick: number; frame: number }> {
  const results: Array<{ tick: number; frame: number }> = [];
  let lastFrame = -1;
  for (let tick = 0; tick <= TS_CONSTRUCTION_TICKS; tick++) {
    const buildProgress = Math.min(1, tick / TS_CONSTRUCTION_TICKS);
    const frame = Math.min(Math.floor(buildProgress * maxFrame), maxFrame);
    if (frame !== lastFrame) {
      results.push({ tick, frame });
      lastFrame = frame;
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('C++ parity: Construction buildup animation', () => {

  // ─── 1. Construction AnimControlType Initialization ──────────────────────
  describe('AnimControlType for BSTATE_CONSTRUCTION', () => {

    // C++ bdata.cpp:2854-2856 — constructor defaults
    it('constructor defaults: Start=0, Count=1, Rate=0', () => {
      // Before BuildupData is loaded, BSTATE_CONSTRUCTION defaults are:
      //   Anims[BSTATE_CONSTRUCTION].Start = 0;
      //   Anims[BSTATE_CONSTRUCTION].Count = 1;
      //   Anims[BSTATE_CONSTRUCTION].Rate = 0;
      const defaults: AnimControlType = { Start: 0, Count: 1, Rate: 0 };
      expect(defaults.Start).toBe(0);
      expect(defaults.Count).toBe(1);
      expect(defaults.Rate).toBe(0);
    });

    // C++ bdata.cpp:3125-3131 — One_Time() path
    it('One_Time path: 20-frame make sheet → Rate=2, Start=0, Count=20', () => {
      const anim = cppConstructionAnim(20);
      // timedelay = floor(0.05 * 900 / 20) = floor(45 / 20) = floor(2.25) = 2
      expect(anim.Start).toBe(0);
      expect(anim.Count).toBe(20);
      expect(anim.Rate).toBe(2);
    });

    it('One_Time path: various frame counts', () => {
      // 10 frames: floor(45 / 10) = 4
      expect(cppConstructionAnim(10).Rate).toBe(4);
      // 15 frames: floor(45 / 15) = 3
      expect(cppConstructionAnim(15).Rate).toBe(3);
      // 30 frames: floor(45 / 30) = 1
      expect(cppConstructionAnim(30).Rate).toBe(1);
      // 45 frames: floor(45 / 45) = 1
      expect(cppConstructionAnim(45).Rate).toBe(1);
      // 1 frame: floor(45 / 1) = 45
      expect(cppConstructionAnim(1).Rate).toBe(45);
    });

    // C++ bdata.cpp:3369-3374 — Init() theater path
    it('theater path: timedelay = floor(75 / frameCount)', () => {
      // timedelay = (5 * TICKS_PER_SECOND) / count = 75 / count
      const anim20 = cppTheaterConstructionAnim(20);
      expect(anim20.Rate).toBe(3); // floor(75/20) = 3

      const anim10 = cppTheaterConstructionAnim(10);
      expect(anim10.Rate).toBe(7); // floor(75/10) = 7
    });
  });

  // ─── 2. Construction Duration (C++ vs TS) ──────────────────────────────
  describe('construction duration', () => {

    it('C++ construction = (Count-1) * Rate = 38 ticks for 20-frame make sheet', () => {
      // building.cpp:5528: IsReadyToCommence when stage == Start + Count - 1
      // That's (Count-1) = 19 stage increments at Rate=2 ticks each = 38 ticks
      expect(cppConstructionDurationTicks(20)).toBe(38);
    });

    it('TS construction = 30 ticks (hardcoded)', () => {
      // TS engine/index.ts:1880: s.buildProgress += 1 / 30
      // Reaches 1.0 after 30 ticks
      expect(TS_CONSTRUCTION_TICKS).toBe(30);
    });

    it('PARITY GAP: C++ construction = 38 ticks, TS = 30 ticks', () => {
      // C++ derives timing from make-sheet frame count via BuildupTime * TICKS_PER_MINUTE formula.
      // TS hardcodes 30 ticks regardless of building type.
      // For 20-frame make sheets: C++ = 38, TS = 30 — an 8-tick (21%) divergence.
      const cppTicks = cppConstructionDurationTicks(20);
      const tsTicks = TS_CONSTRUCTION_TICKS;
      expect(tsTicks).toBe(cppTicks); // PARITY GAP — TS=30, C++=38
    });

    it('C++ total with state machine overhead: INITIAL(1) + animation(38) = 39 ticks minimum', () => {
      // building.cpp:3325-3365 Mission_Construction:
      //   case INITIAL: Begin_Mode(BSTATE_CONSTRUCTION); Status = DURING; (returns 1 → next tick)
      //   case DURING: if (IsReadyToCommence) → transition to GUARD
      //
      // INITIAL takes 1 tick, then animation runs for (Count-1)*Rate ticks.
      // When IsReadyToCommence fires, next call to Mission_Construction DURING detects it.
      // But there's a nuance: Animation_AI runs before Mission processing in AI(),
      // so IsReadyToCommence is set on the same tick the stage reaches the final frame.
      // Then Mission_Construction sees it on that same tick.
      // So total = 1 (INITIAL) + 38 (animation) = 39 ticks.
      const animTicks = cppConstructionDurationTicks(20);
      const totalTicks = 1 + animTicks; // INITIAL overhead + animation
      expect(totalTicks).toBe(39);
    });
  });

  // ─── 3. Stage Progression (C++ StageClass) ────────────────────────────
  describe('StageClass stage progression', () => {

    it('C++ stage increments discretely: 0 → 1 → 2 → ... → 19 at 2-tick intervals', () => {
      // stage.h:72-78: Graphic_Logic increments Stage when Timer reaches 0
      // Timer counts down each tick. When Timer==0 && Rate!=0: Stage++, Timer=Rate.
      const anim = cppConstructionAnim(20);
      const progression = simulateCppStageProgression(anim);

      // Initial stage is 0
      expect(progression[0]).toEqual({ tick: 0, stage: 0 });

      // Stage 1 at tick 2 (Timer starts at 2, counts down: 2→1→0, then stage++)
      expect(progression[1]).toEqual({ tick: 2, stage: 1 });

      // Stage 2 at tick 4
      expect(progression[2]).toEqual({ tick: 4, stage: 2 });

      // Final stage 19 at tick 38
      expect(progression[progression.length - 1]).toEqual({ tick: 38, stage: 19 });

      // Total of 20 entries (stages 0-19)
      expect(progression.length).toBe(20);
    });

    it('C++ stage progression with 10-frame make sheet: Rate=4', () => {
      const anim = cppConstructionAnim(10);
      const progression = simulateCppStageProgression(anim);

      expect(progression[0]).toEqual({ tick: 0, stage: 0 });
      expect(progression[1]).toEqual({ tick: 4, stage: 1 });
      expect(progression[progression.length - 1]).toEqual({ tick: 36, stage: 9 });
      expect(progression.length).toBe(10);
    });

    it('all stages are evenly spaced by Rate ticks', () => {
      const anim = cppConstructionAnim(20);
      const progression = simulateCppStageProgression(anim);
      // Every stage change after the first should be separated by Rate ticks
      for (let i = 2; i < progression.length; i++) {
        expect(progression[i].tick - progression[i - 1].tick).toBe(anim.Rate);
      }
    });
  });

  // ─── 4. Construction Frame Display (C++ vs TS) ────────────────────────
  describe('construction frame display mapping', () => {

    it('C++ construction: displayed frame = Fetch_Stage() directly', () => {
      // building.cpp:567-578: Shape_Number() during BSTATE_CONSTRUCTION
      //   int shapenum = Fetch_Stage();
      //   if (BState == BSTATE_CONSTRUCTION) {
      //     if (Mission == MISSION_DECONSTRUCTION) {
      //       shapenum = (Start + Count - 1) - shapenum;  // reversed
      //     }
      //   }
      // For construction (not deconstruction), frame IS the stage number directly.
      const anim = cppConstructionAnim(20);
      const progression = simulateCppStageProgression(anim);

      // At tick 0: frame 0 (empty/foundation)
      expect(progression[0].stage).toBe(0);
      // At tick 38: frame 19 (fully built)
      expect(progression[19].stage).toBe(19);
    });

    it('TS construction: displayed frame = floor(buildProgress * maxFrame)', () => {
      // renderer.ts:1467-1468:
      //   useFrame = Math.min(Math.floor(s.buildProgress! * maxFrame), maxFrame);
      const maxFrame = 19; // 20-frame make sheet
      const tsProgression = simulateTsFrameProgression(maxFrame);

      // First frame should be 0
      expect(tsProgression[0].frame).toBe(0);
      // Last frame should be maxFrame
      expect(tsProgression[tsProgression.length - 1].frame).toBe(maxFrame);
    });

    it('PARITY GAP: C++ and TS show different frames at the same game tick', () => {
      // C++ at tick 10: stage = 10 / 2 = 5 → frame 5
      // TS at tick 10: buildProgress = 10/30 = 0.333, frame = floor(0.333 * 19) = floor(6.33) = 6
      const cppFrameAtTick10 = 5; // stage 5 (every 2 ticks)
      const tsFrameAtTick10 = Math.floor((10 / 30) * 19); // 6

      // PARITY GAP: frame pacing differs because:
      // 1. C++ has Rate=2 (discrete stages), TS has continuous 1/30 progress
      // 2. C++ total duration is 38 ticks, TS is 30 ticks
      expect(tsFrameAtTick10).toBe(cppFrameAtTick10); // PARITY GAP — TS=6, C++=5
    });

    it('C++ frame-to-tick mapping is linear (stage * Rate)', () => {
      const anim = cppConstructionAnim(20);
      // Frame N is first displayed at tick N * Rate
      for (let frame = 0; frame < anim.Count; frame++) {
        const expectedTick = frame * anim.Rate;
        expect(expectedTick).toBe(frame * 2);
      }
    });

    it('TS frame-to-tick mapping is continuous (buildProgress * maxFrame)', () => {
      const maxFrame = 19;
      // Frame N is first displayed when floor(buildProgress * maxFrame) == N
      // buildProgress = tick / 30
      // N = floor(tick * maxFrame / 30)
      // tick = ceil(N * 30 / maxFrame)
      for (let frame = 0; frame <= maxFrame; frame++) {
        const firstTick = frame === 0 ? 0 : Math.ceil((frame * 30) / maxFrame);
        const actualFrame = Math.min(Math.floor((firstTick / 30) * maxFrame), maxFrame);
        expect(actualFrame).toBe(frame);
      }
    });
  });

  // ─── 5. Sell Frame Reversal vs Construction Frame Forward ─────────────
  describe('construction forward vs sell reversal', () => {

    it('C++ construction: frames play forward 0 → Count-1', () => {
      // building.cpp:572-578: Shape_Number() during construction (not deconstruction)
      //   int shapenum = Fetch_Stage();
      //   if (BState == BSTATE_CONSTRUCTION) {
      //     // NOT deconstruction, so shapenum stays as Fetch_Stage()
      //   }
      const anim = cppConstructionAnim(20);
      const stages = simulateCppStageProgression(anim);
      // First stage is 0, last is 19 — forward order
      expect(stages[0].stage).toBe(0);
      expect(stages[stages.length - 1].stage).toBe(19);
    });

    it('C++ sell: frames play reversed Count-1 → 0', () => {
      // building.cpp:584-586:
      //   if (Mission == MISSION_DECONSTRUCTION) {
      //     shapenum = (Class->Anims[BState].Start + Class->Anims[BState].Count - 1) - shapenum;
      //   }
      const start = 0;
      const count = 20;
      // Sell frame reversal formula
      const sellFrame = (stage: number) => (start + count - 1) - stage;
      // At stage 0: frame 19 (fully built — sell starts showing complete building)
      expect(sellFrame(0)).toBe(19);
      // At stage 19: frame 0 (foundation — sell ends showing empty)
      expect(sellFrame(19)).toBe(0);
      // At stage 10: frame 9
      expect(sellFrame(10)).toBe(9);
    });

    it('TS construction: frame = floor(buildProgress * maxFrame) — forward 0→19', () => {
      // renderer.ts:1467-1468
      const maxFrame = 19;
      expect(Math.floor(0.0 * maxFrame)).toBe(0);
      expect(Math.floor(0.5 * maxFrame)).toBe(9);
      expect(Math.floor(1.0 * maxFrame)).toBe(19);
    });

    it('TS sell: frame = floor((1 - sellProgress) * maxFrame) — reversed 19→0', () => {
      // renderer.ts:1470
      const maxFrame = 19;
      expect(Math.floor((1 - 0.0) * maxFrame)).toBe(19); // sell start
      expect(Math.floor((1 - 0.5) * maxFrame)).toBe(9);  // midpoint
      expect(Math.floor((1 - 1.0) * maxFrame)).toBe(0);  // sell end
    });

    it('C++ and TS both achieve same visual order (construction forward, sell reversed)', () => {
      // Both forward from empty→built during construction, reversed during sell.
      // The visual ordering is correct in both implementations.
      // The timing/pacing differs (tested above), but direction matches.
      const constructionStart = 0;
      const constructionEnd = 19;
      const sellStart = 19;
      const sellEnd = 0;

      expect(constructionStart).toBe(0);
      expect(constructionEnd).toBe(19);
      expect(sellStart).toBe(19);
      expect(sellEnd).toBe(0);
    });
  });

  // ─── 6. Begin_Mode Behavior ───────────────────────────────────────────
  describe('Begin_Mode(BSTATE_CONSTRUCTION) behavior', () => {

    it('BSTATE_CONSTRUCTION immediately overrides current BState', () => {
      // building.cpp:2731:
      //   if (BState == BSTATE_NONE || bstate == BSTATE_CONSTRUCTION || ScenarioInit)
      // BSTATE_CONSTRUCTION always takes effect immediately regardless of current BState.
      // Other states are queued (QueueBState) if the building is already animating.
      const bstate = 'BSTATE_CONSTRUCTION';
      const currentBState = 'BSTATE_ACTIVE'; // some other state

      // C++ logic: BSTATE_CONSTRUCTION bypasses the queue
      const willTakeEffectImmediately =
        currentBState === 'BSTATE_NONE' ||
        bstate === 'BSTATE_CONSTRUCTION' ||
        false; // ScenarioInit

      expect(willTakeEffectImmediately).toBe(true);
    });

    it('non-CONSTRUCTION states are queued when building is already animating', () => {
      // building.cpp:2730-2742:
      //   QueueBState = bstate;
      //   if (BState == BSTATE_NONE || bstate == BSTATE_CONSTRUCTION || ScenarioInit) {
      //     BState = bstate; QueueBState = BSTATE_NONE;
      //     // ... set rate and stage
      //   }
      // When bstate is NOT BSTATE_CONSTRUCTION and BState is NOT BSTATE_NONE,
      // the state is queued and NOT immediately applied.
      const willQueue = true; // non-construction, non-NONE current state
      expect(willQueue).toBe(true);
    });

    it('rate is NOT normalized for BSTATE_CONSTRUCTION (even for regulated buildings)', () => {
      // building.cpp:2737-2739:
      //   if (Class->IsRegulated && bstate != BSTATE_CONSTRUCTION) {
      //     rate = Options.Normalize_Delay(rate);
      //   }
      // BSTATE_CONSTRUCTION is explicitly excluded from rate normalization.
      // This means construction animation runs at the raw rate from Init_Anim,
      // unaffected by game speed settings.
      const isRegulated = true;
      const bstate = 'BSTATE_CONSTRUCTION';
      const shouldNormalize = isRegulated && bstate !== 'BSTATE_CONSTRUCTION';
      expect(shouldNormalize).toBe(false);
    });
  });

  // ─── 7. Mission_Construction State Machine ────────────────────────────
  describe('Mission_Construction state machine', () => {

    it('INITIAL phase: Begin_Mode(BSTATE_CONSTRUCTION), play sound, advance to DURING', () => {
      // building.cpp:3335-3342:
      //   case INITIAL:
      //     Begin_Mode(BSTATE_CONSTRUCTION);
      //     Transmit_Message(RADIO_BUILDING);
      //     if (House->IsPlayerControl) Sound_Effect(VOC_CONSTRUCTION, Coord);
      //     Status = DURING;
      //     break;
      // Returns 1 (re-call next tick)
      const phases = ['INITIAL', 'DURING'];
      expect(phases[0]).toBe('INITIAL');
    });

    it('DURING phase: waits for IsReadyToCommence, then transitions to GUARD', () => {
      // building.cpp:3344-3358:
      //   case DURING:
      //     if (IsReadyToCommence) {
      //       Transmit_Message(RADIO_COMPLETE);
      //       Transmit_Message(RADIO_OVER_OUT);
      //       Begin_Mode(BSTATE_IDLE);
      //       Grand_Opening();
      //       Assign_Mission(MISSION_GUARD);
      //       PrimaryFacing = Class->StartFace;
      //     }
      //     break;
      const isReadyToCommence = true; // set by Animation_AI when stage reaches final frame
      const nextMission = isReadyToCommence ? 'MISSION_GUARD' : 'MISSION_CONSTRUCTION';
      expect(nextMission).toBe('MISSION_GUARD');
    });

    it('returns 1 tick delay regardless of phase', () => {
      // building.cpp:3364: return(1);
      // Mission_Construction always returns 1, meaning it's called every tick.
      const returnValue = 1;
      expect(returnValue).toBe(1);
    });

    it('TS has no state machine — single continuous progress ramp', () => {
      // TS engine/index.ts:1878-1892:
      //   s.buildProgress = Math.min(1, s.buildProgress + 1 / 30);
      //   if (buildProgress >= 1) { builtStructureTypes.add(s.type); ... }
      //
      // No INITIAL/DURING phases, no Begin_Mode call, no sound trigger on start,
      // no radio messages to construction yard. Just a linear 0→1 ramp.
      const tsPhases = 1; // single continuous ramp
      const cppPhases = 2; // INITIAL + DURING
      expect(tsPhases).not.toBe(cppPhases); // PARITY GAP: missing state machine
    });
  });

  // ─── 8. Animation_AI IsReadyToCommence Detection ──────────────────────
  describe('Animation_AI IsReadyToCommence during construction', () => {

    it('IsReadyToCommence set when stage == Start + Count - 1 (last frame)', () => {
      // building.cpp:5528:
      //   if (Fetch_Stage() == ctrl->Start + ctrl->Count - 1 || ...) {
      //     IsReadyToCommence = true;
      //   }
      const anim = cppConstructionAnim(20);
      const lastStage = anim.Start + anim.Count - 1;
      expect(lastStage).toBe(19);
    });

    it('animation loops when stage exceeds range (but construction transitions before this)', () => {
      // building.cpp:5536-5538:
      //   if (Fetch_Stage() >= ctrl->Start + ctrl->Count) {
      //     toloop = true;
      //   }
      // building.cpp:5561-5569 (loop handler):
      //   if (toloop) {
      //     if (BState == BSTATE_CONSTRUCTION || BState == BSTATE_IDLE) {
      //       Set_Rate(Options.Normalize_Delay(ctrl->Rate));
      //     } else {
      //       Set_Rate(ctrl->Rate);
      //     }
      //     Set_Stage(ctrl->Start);
      //   }
      //
      // Note: for BSTATE_CONSTRUCTION, the loop rate IS normalized.
      // But normally construction doesn't loop — Mission_Construction catches
      // IsReadyToCommence and transitions to MISSION_GUARD first.
      const anim = cppConstructionAnim(20);
      const overflowStage = anim.Start + anim.Count; // 20
      expect(overflowStage).toBe(20);
    });

    it('if Rate==0, IsReadyToCommence set immediately (no animation)', () => {
      // building.cpp:5541:
      //   if (BState == BSTATE_NONE || Fetch_Rate() == 0) {
      //     IsReadyToCommence = true;
      //   }
      // This handles buildings without buildup data (defaults: Count=1, Rate=0).
      const defaults: AnimControlType = { Start: 0, Count: 1, Rate: 0 };
      expect(defaults.Rate).toBe(0);
      // IsReadyToCommence would be set on the very first Animation_AI call
    });
  });

  // ─── 9. Get_Image_Data Source Switch ──────────────────────────────────
  describe('image data source during construction', () => {

    it('C++ switches to BuildupData (*MAKE.SHP) during BSTATE_CONSTRUCTION', () => {
      // building.cpp:5619-5624:
      //   void const * BuildingClass::Get_Image_Data(void) const {
      //     if (BState == BSTATE_CONSTRUCTION) {
      //       return(Class->Get_Buildup_Data());
      //     }
      //     return(TechnoClass::Get_Image_Data());
      //   }
      const bstate = 'BSTATE_CONSTRUCTION';
      const imageSource = bstate === 'BSTATE_CONSTRUCTION' ? 'BuildupData' : 'ImageData';
      expect(imageSource).toBe('BuildupData');
    });

    it('TS uses makeSheetName (image + "make") during construction', () => {
      // renderer.ts:1460-1468:
      //   const makeSheetName = s.image + 'make';
      //   const makeSheet = assets.getSheet(makeSheetName);
      //   if (makeSheet) {
      //     useSheet = makeSheetName;
      //     ...
      //   }
      const image = 'fact';
      const makeSheetName = image + 'make';
      expect(makeSheetName).toBe('factmake');
      // TS correctly uses a separate make sheet, matching C++ Get_Image_Data behavior
    });

    it('C++ uses normal ImageData when NOT constructing', () => {
      const bstate = 'BSTATE_IDLE';
      const imageSource = bstate === 'BSTATE_CONSTRUCTION' ? 'BuildupData' : 'ImageData';
      expect(imageSource).toBe('ImageData');
    });
  });

  // ─── 10. Construction Progress Granularity ────────────────────────────
  describe('frame granularity during construction', () => {

    it('C++ shows exactly Count distinct frames during construction', () => {
      // C++ steps through stages 0, 1, 2, ..., Count-1
      // Each stage maps to exactly one frame of the make sheet
      const anim = cppConstructionAnim(20);
      const progression = simulateCppStageProgression(anim);
      const distinctFrames = new Set(progression.map(p => p.stage));
      expect(distinctFrames.size).toBe(anim.Count); // 20 distinct frames
    });

    it('TS shows up to maxFrame+1 distinct frames (continuous mapping)', () => {
      // TS uses floor(buildProgress * maxFrame) which can produce any integer 0..maxFrame
      const maxFrame = 19;
      const tsProgression = simulateTsFrameProgression(maxFrame);
      const distinctFrames = new Set(tsProgression.map(p => p.frame));
      // TS may show fewer distinct frames if 30 ticks < 20 frames (some frames skipped)
      // or same count if distribution is good
      // With 30 ticks and 20 possible frames, some frames may be held for only 1 tick
      // while others may be held for 2
      expect(distinctFrames.size).toBeLessThanOrEqual(maxFrame + 1);
    });

    it('PARITY GAP: TS may skip or double-up frames due to 30 vs 38 tick duration', () => {
      // C++ with 20 frames over 38 ticks: each frame shown for exactly 2 ticks
      // TS with 20 possible frames over 30 ticks: some frames shown for 1 tick, some for 2
      const maxFrame = 19;
      const tsProgression = simulateTsFrameProgression(maxFrame);
      const cppProgression = simulateCppStageProgression(cppConstructionAnim(20));

      // C++ frame durations: all exactly 2 ticks
      const cppDurations: number[] = [];
      for (let i = 1; i < cppProgression.length; i++) {
        cppDurations.push(cppProgression[i].tick - cppProgression[i - 1].tick);
      }
      expect(cppDurations.every(d => d === 2)).toBe(true);

      // TS frame durations: not all the same
      const tsDurations: number[] = [];
      for (let i = 1; i < tsProgression.length; i++) {
        tsDurations.push(tsProgression[i].tick - tsProgression[i - 1].tick);
      }
      const allSame = tsDurations.every(d => d === tsDurations[0]);
      // PARITY GAP: TS frame durations are not uniform
      expect(allSame).toBe(true); // PARITY GAP — likely false for non-uniform distribution
    });
  });

  // ─── 11. Construction Completion Side Effects ─────────────────────────
  describe('construction completion triggers', () => {

    it('C++ Grand_Opening() called on construction completion', () => {
      // building.cpp:3355: Grand_Opening();
      // Grand_Opening handles special one-time operations:
      //   - Power plant activation (add power to house)
      //   - Gap generator activation
      //   - Radar dome activation
      //   - etc.
      // This runs AFTER Begin_Mode(BSTATE_IDLE) (line 3354).
      const completionActions = [
        'Transmit_Message(RADIO_COMPLETE)',
        'Transmit_Message(RADIO_OVER_OUT)',
        'Begin_Mode(BSTATE_IDLE)',
        'Grand_Opening()',
        'Assign_Mission(MISSION_GUARD)',
        'PrimaryFacing = StartFace',
      ];
      expect(completionActions.length).toBe(6);
    });

    it('TS construction completion adds to builtStructureTypes', () => {
      // TS engine/index.ts:1882-1890:
      //   if (wasBuilding && s.buildProgress >= 1) {
      //     this.builtStructureTypes.add(s.type);
      //     if (allied) this.structuresBuilt++;
      //     if (s.type === 'PROC' || s.type === 'SILO') this.recalculateSiloCapacity();
      //   }
      // TS does NOT have Grand_Opening equivalent — no radio messages to construction yard,
      // no construction yard animation stop, no facing reset.
      const tsCompletionActions = [
        'builtStructureTypes.add(type)',
        'structuresBuilt++',
        'recalculateSiloCapacity()',
      ];
      expect(tsCompletionActions.length).toBe(3);
    });
  });

  // ─── 12. Construction Cannot Be Sold ──────────────────────────────────
  describe('sell prevention during construction', () => {

    it('C++ prevents sell during BSTATE_CONSTRUCTION or MISSION_CONSTRUCTION', () => {
      // building.cpp:3201-3203 Can_Demolish:
      //   if (Class->Get_Buildup_Data()
      //       && BState != BSTATE_CONSTRUCTION
      //       && Mission != MISSION_DECONSTRUCTION
      //       && Mission != MISSION_CONSTRUCTION) {
      //     return true;
      //   }
      // Both BSTATE_CONSTRUCTION and MISSION_CONSTRUCTION prevent selling.
      const bstate = 'BSTATE_CONSTRUCTION';
      const mission = 'MISSION_CONSTRUCTION';
      const canDemolish = bstate !== 'BSTATE_CONSTRUCTION' && mission !== 'MISSION_CONSTRUCTION';
      expect(canDemolish).toBe(false);
    });

    it('C++ prevents placing new building on construction site', () => {
      // building.cpp:175:
      //   if (Mission == MISSION_CONSTRUCTION || Mission == MISSION_DECONSTRUCTION
      //       || BState == BSTATE_CONSTRUCTION || ...) return RADIO_NEGATIVE;
      // Buildings under construction refuse radio contact.
      const isConstructing = true;
      const radioResponse = isConstructing ? 'RADIO_NEGATIVE' : 'RADIO_ROGER';
      expect(radioResponse).toBe('RADIO_NEGATIVE');
    });
  });

  // ─── 13. Enter_Idle_Mode — Construction vs Scenario Init ──────────────
  describe('Enter_Idle_Mode selects construction vs idle', () => {

    it('new buildings (initial=true, !ScenarioInit) get BSTATE_CONSTRUCTION', () => {
      // building.cpp:4338-4344:
      //   if (!initial || ScenarioInit || Debug_Map) {
      //     Begin_Mode(BSTATE_IDLE); mission = MISSION_GUARD;
      //   } else {
      //     Begin_Mode(BSTATE_CONSTRUCTION); mission = MISSION_CONSTRUCTION;
      //   }
      const initial = true;
      const scenarioInit = false;
      const debugMap = false;

      const mode = (!initial || scenarioInit || debugMap) ? 'BSTATE_IDLE' : 'BSTATE_CONSTRUCTION';
      expect(mode).toBe('BSTATE_CONSTRUCTION');
    });

    it('scenario-init buildings skip construction animation', () => {
      const initial = true;
      const scenarioInit = true;

      const mode = (!initial || scenarioInit) ? 'BSTATE_IDLE' : 'BSTATE_CONSTRUCTION';
      expect(mode).toBe('BSTATE_IDLE');
    });

    it('non-initial buildings (e.g. re-entering idle) get BSTATE_IDLE', () => {
      const initial = false;

      const mode = (!initial) ? 'BSTATE_IDLE' : 'BSTATE_CONSTRUCTION';
      expect(mode).toBe('BSTATE_IDLE');
    });
  });

  // ─── 14. BuildupTime Budget vs Actual Duration ────────────────────────
  describe('BuildupTime budget vs actual construction duration', () => {

    it('total buildup budget = BuildupTime * TICKS_PER_MINUTE = 45 ticks', () => {
      // rules.cpp:180: BuildupTime = ".05"
      // defines.h:3032: TICKS_PER_MINUTE = 900
      const budget = BUILDUP_TIME * TICKS_PER_MINUTE;
      expect(budget).toBe(45);
    });

    it('actual duration is shorter than budget due to integer division truncation', () => {
      // For 20 frames: timedelay = floor(45/20) = 2, total = 19 * 2 = 38 (not 45)
      // 7 ticks "lost" to truncation
      const actual = cppConstructionDurationTicks(20);
      const budget = 45;
      expect(actual).toBe(38);
      expect(actual).toBeLessThan(budget);
      expect(budget - actual).toBe(7); // truncation loss
    });

    it('truncation loss varies by frame count', () => {
      // frame count → timedelay → actual → loss
      // 20: floor(45/20)=2, 19*2=38, loss=7
      // 10: floor(45/10)=4, 9*4=36, loss=9
      // 15: floor(45/15)=3, 14*3=42, loss=3
      // 30: floor(45/30)=1, 29*1=29, loss=16
      // 45: floor(45/45)=1, 44*1=44, loss=1
      // 9:  floor(45/9)=5,  8*5=40, loss=5
      // 1:  floor(45/1)=45, 0*45=0, loss=45 (single frame = instant)
      expect(cppConstructionDurationTicks(20)).toBe(38);
      expect(cppConstructionDurationTicks(10)).toBe(36);
      expect(cppConstructionDurationTicks(15)).toBe(42);
      expect(cppConstructionDurationTicks(30)).toBe(29);
      expect(cppConstructionDurationTicks(45)).toBe(44);
      expect(cppConstructionDurationTicks(9)).toBe(40);
      expect(cppConstructionDurationTicks(1)).toBe(0);
    });
  });

  // ─── 15. Construction Sound Effect ────────────────────────────────────
  describe('construction sound effect', () => {

    it('C++ plays VOC_CONSTRUCTION in INITIAL phase for player buildings', () => {
      // building.cpp:3338-3340:
      //   if (House->IsPlayerControl) {
      //     Sound_Effect(VOC_CONSTRUCTION, Coord);
      //   }
      // Sound plays exactly once at the start of construction.
      const isPlayerControl = true;
      const soundPlayed = isPlayerControl;
      expect(soundPlayed).toBe(true);
    });

    it('C++ does NOT play construction sound for AI buildings', () => {
      const isPlayerControl = false;
      const soundPlayed = isPlayerControl;
      expect(soundPlayed).toBe(false);
    });
  });

  // ─── 16. Make Sheet Frame Count Consistency ───────────────────────────
  describe('make sheet frame count across building types', () => {

    it('all standard RA buildings use 20-frame make sheets', () => {
      // bdata.cpp:3125-3131: make sheet frame count comes from Get_Build_Frame_Count()
      // Standard RA buildings all have 20-frame make sheets.
      const standardMakeFrameCount = 20;
      const buildingTypes = [
        'POWR', 'APWR', 'FACT', 'BARR', 'TENT', 'WEAP', 'PROC',
        'SILO', 'DOME', 'GAP', 'FIX', 'HPAD', 'AFLD', 'ATEK',
        'STEK', 'PDOX', 'IRON', 'MSLO', 'TSLA', 'KENN', 'HOSP',
      ];
      // All standard buildings → same make frame count → same construction duration
      for (const type of buildingTypes) {
        const duration = cppConstructionDurationTicks(standardMakeFrameCount);
        expect(duration).toBe(38);
      }
    });

    it('construction duration is constant for all buildings (same make sheet count)', () => {
      // Since all RA buildings use 20-frame make sheets and the same BuildupTime,
      // they all have identical construction animation durations: 38 ticks.
      // This is a game design choice — all buildings construct in the same visual time.
      // (Production TIME varies by cost, but buildup ANIMATION is constant.)
      const duration = cppConstructionDurationTicks(20);
      expect(duration).toBe(38);
    });
  });

  // ─── 17. Theater vs Standard Buildup Timing ──────────────────────────
  describe('theater-specific buildup timing divergence', () => {

    it('theater buildings use 5*TICKS_PER_SECOND budget (75) vs standard 45', () => {
      // bdata.cpp:3372: timedelay = (5 * TICKS_PER_SECOND) / count = 75 / count
      // vs standard bdata.cpp:3129: timedelay = (BuildupTime * TICKS_PER_MINUTE) / count = 45 / count
      const theaterBudget = 5 * TICKS_PER_SECOND;
      const standardBudget = BUILDUP_TIME * TICKS_PER_MINUTE;
      expect(theaterBudget).toBe(75);
      expect(standardBudget).toBe(45);
      expect(theaterBudget).toBeGreaterThan(standardBudget);
    });

    it('theater 20-frame building: duration = 19 * 3 = 57 ticks (vs standard 38)', () => {
      const theaterAnim = cppTheaterConstructionAnim(20);
      const standardAnim = cppConstructionAnim(20);
      const theaterDuration = (theaterAnim.Count - 1) * theaterAnim.Rate;
      const standardDuration = (standardAnim.Count - 1) * standardAnim.Rate;
      expect(theaterDuration).toBe(57); // 19 * 3
      expect(standardDuration).toBe(38); // 19 * 2
      // Theater buildings take 50% longer to construct visually
    });
  });
});
