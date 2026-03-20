/**
 * C++ Behavioral Parity Tests — Victory/Defeat Condition Logic
 *
 * Tests the TS implementation of win/lose/allowwin against C++ behavior from:
 *   - house.cpp:945-972   — HouseClass::AI() win/lose/die checks
 *   - house.cpp:4039-4112 — Flag_To_Die, Flag_To_Win, Flag_To_Lose
 *   - taction.cpp:604-622  — TACTION_WIN and TACTION_LOSE action handlers
 *   - taction.h:42-89      — TActionType enum values
 *   - trigger.cpp:175-178  — ALLOWWIN blockage decrement on trigger destruction
 *   - scenario.cpp:618-625 — ALLOWWIN blockage count initialization
 *
 * C++ reference: CnC_and_Red_Alert/RA/
 */

import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TriggerAction,
  type TriggerActionResult,
  type ScenarioTrigger,
} from '../engine/scenario';
import type { TeamType } from '../engine/scenario';

// ============================================================
// Helpers — minimal scaffolding to call executeTriggerAction
// ============================================================

/** Build a minimal TriggerAction with the given action code and optional data */
function makeAction(action: number, data = -1, team = -1, trigger = -1): TriggerAction {
  return { action, team, trigger, data };
}

/** Minimal empty trigger for populating the triggers array */
function makeTrigger(overrides: Partial<ScenarioTrigger> = {}): ScenarioTrigger {
  return {
    name: 'test',
    persistence: 0,
    house: 0,
    eventControl: 0,
    actionControl: 0,
    event1: { event: 0, data: 0 },
    event2: { event: 0, data: 0 },
    action1: makeAction(0),
    action2: makeAction(0),
    fired: false,
    timerTick: 0,
    playerEntered: false,
    objectDiscovered: false,
    enteredZone: false,
    crossedHorizontal: false,
    crossedVertical: false,
    forceFirePending: false,
    pendingDestroyedCount: 0,
    triggeringEntityIds: [],
    ...overrides,
  };
}

// C++ taction.h enum values (verified against source)
const TACTION_NONE = 0;
const TACTION_WIN = 1;
const TACTION_LOSE = 2;
const TACTION_ALLOWWIN = 15;
const TACTION_WINLOSE = 14;

// ============================================================
// Section 1: TACTION enum values — C++ taction.h:42-89
// ============================================================
describe('TACTION enum values match C++ taction.h:42-89', () => {
  /**
   * C++ source (taction.h:43-88):
   *   TACTION_NONE,              // 0
   *   TACTION_WIN,               // 1  — player wins!
   *   TACTION_LOSE,              // 2  — player loses.
   *   ...
   *   TACTION_WINLOSE,           // 14 — Win if captured, lose if destroyed.
   *   TACTION_ALLOWWIN,          // 15 — Allows winning if triggered.
   */

  it('TACTION_NONE = 0', () => {
    const result = executeTriggerAction(
      makeAction(0), [], new Map(), new Set(), []
    );
    // NONE does nothing — spawned list empty, no side effects
    expect(result.spawned).toEqual([]);
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
  });

  it('TACTION_WIN = 1 sets result.win', () => {
    const result = executeTriggerAction(
      makeAction(1), [], new Map(), new Set(), []
    );
    expect(result.win).toBe(true);
  });

  it('TACTION_LOSE = 2 sets result.lose', () => {
    const result = executeTriggerAction(
      makeAction(2), [], new Map(), new Set(), []
    );
    expect(result.lose).toBe(true);
  });

  it('TACTION_ALLOWWIN = 15 sets result.allowWin', () => {
    const result = executeTriggerAction(
      makeAction(15), [], new Map(), new Set(), []
    );
    expect(result.allowWin).toBe(true);
  });

  it('TACTION_WINLOSE = 14 sets result.winLose', () => {
    const result = executeTriggerAction(
      makeAction(14), [], new Map(), new Set(), []
    );
    expect(result.winLose).toBe(true);
  });
});

// ============================================================
// Section 2: TACTION_WIN house identity check
// C++ taction.cpp:604-610
// ============================================================
describe('TACTION_WIN house identity — C++ taction.cpp:604-610', () => {
  /**
   * C++ source (taction.cpp:604-610):
   *   case TACTION_WIN:
   *     if (Data.House == PlayerPtr->Class->House) {
   *       PlayerPtr->Flag_To_Win();
   *     } else {
   *       PlayerPtr->Flag_To_Lose();  // ← NON-player house winning means PLAYER LOSES
   *     }
   *     break;
   *
   * The C++ code checks whether the action's Data.House matches the player's house.
   * If a NON-player house is specified, TACTION_WIN actually LOSES the game for the player.
   *
   * TS behavior: executeTriggerAction sets result.win=true regardless of Data.House.
   * This is a PARITY GAP — the TS implementation ignores the house parameter.
   */

  it('TACTION_WIN always sets result.win=true regardless of action.data (house)', () => {
    // In C++, action.Data.House determines whether player wins or loses.
    // In TS, TACTION_WIN always results in win=true.
    const resultPlayerHouse = executeTriggerAction(
      makeAction(1, 0), // data=0 (e.g., player house index)
      [], new Map(), new Set(), []
    );
    const resultEnemyHouse = executeTriggerAction(
      makeAction(1, 1), // data=1 (e.g., enemy house index)
      [], new Map(), new Set(), []
    );
    expect(resultPlayerHouse.win).toBe(true);
    expect(resultEnemyHouse.win).toBe(true);
    // PARITY GAP: C++ would set Flag_To_Lose when Data.House != PlayerPtr->Class->House
    // TS sets win=true for both cases — the action.data field is completely ignored.
    expect(resultEnemyHouse.lose).toBeUndefined(); // PARITY GAP — C++ would trigger lose
  });
});

// ============================================================
// Section 3: TACTION_LOSE house identity check
// C++ taction.cpp:616-622
// ============================================================
describe('TACTION_LOSE house identity — C++ taction.cpp:616-622', () => {
  /**
   * C++ source (taction.cpp:616-622):
   *   case TACTION_LOSE:
   *     if (Data.House != PlayerPtr->Class->House) {
   *       PlayerPtr->Flag_To_Win();  // ← NON-player house losing means PLAYER WINS
   *     } else {
   *       PlayerPtr->Flag_To_Lose();
   *     }
   *     break;
   *
   * C++ reverses the logic: if the ENEMY is flagged to lose, the PLAYER wins.
   *
   * TS behavior: executeTriggerAction sets result.lose=true regardless of Data.House.
   * This is a PARITY GAP — TACTION_LOSE for an enemy house should trigger player win.
   */

  it('TACTION_LOSE always sets result.lose=true regardless of action.data (house)', () => {
    const resultPlayerHouse = executeTriggerAction(
      makeAction(2, 0), [], new Map(), new Set(), []
    );
    const resultEnemyHouse = executeTriggerAction(
      makeAction(2, 1), [], new Map(), new Set(), []
    );
    expect(resultPlayerHouse.lose).toBe(true);
    expect(resultEnemyHouse.lose).toBe(true);
    // PARITY GAP: C++ would set Flag_To_Win when Data.House != PlayerPtr->Class->House
    // TS sets lose=true for both cases — the action.data field is completely ignored.
    expect(resultEnemyHouse.win).toBeUndefined(); // PARITY GAP — C++ would trigger win
  });
});

// ============================================================
// Section 4: Flag_To_Win mutual exclusion guards
// C++ house.cpp:4066-4083
// ============================================================
describe('Flag_To_Win mutual exclusion — C++ house.cpp:4066-4083', () => {
  /**
   * C++ source (house.cpp:4066-4083):
   *   bool HouseClass::Flag_To_Win(void)
   *   {
   *     if (!IsToWin && !IsToDie && !IsToLose) {
   *       IsToWin = true;
   *       BorrowedTime = TICKS_PER_MINUTE * Rule.SavourDelay;
   *     }
   *     return(IsToWin);
   *   }
   *
   * Key behavior: if IsToLose or IsToDie is already set, Flag_To_Win is a no-op.
   * This prevents conflicting states. The first condition to be set takes priority.
   *
   * TS behavior: executeTriggerAction returns {win: true} which the game engine
   * immediately applies via applyTriggerActionResult (index.ts:5162-5176).
   * If both win and lose trigger on the same tick, TS checks win FIRST (line 5163),
   * and the lose check (line 5171) has a `state === 'playing'` guard that would
   * prevent it since state was already changed to 'won'.
   *
   * This means TS has an implicit "first result wins" behavior, but it differs from
   * C++ where any pending IsToDie/IsToLose blocks Flag_To_Win entirely.
   */

  it('TACTION_WIN result has no mutual exclusion mechanism', () => {
    // In C++, calling Flag_To_Win after Flag_To_Lose is a no-op.
    // In TS, executeTriggerAction just returns {win: true} with no state checks.
    // The mutual exclusion happens at a higher level in applyTriggerActionResult.
    const result = executeTriggerAction(
      makeAction(TACTION_WIN), [], new Map(), new Set(), []
    );
    expect(result.win).toBe(true);
    // No mechanism to indicate "cannot win because lose is pending"
    // This is architecturally different from C++ but may produce same result
    // at the game loop level due to state === 'playing' guards.
  });
});

// ============================================================
// Section 5: Flag_To_Lose clears IsToWin
// C++ house.cpp:4102-4112
// ============================================================
describe('Flag_To_Lose clears IsToWin — C++ house.cpp:4102-4112', () => {
  /**
   * C++ source (house.cpp:4102-4112):
   *   bool HouseClass::Flag_To_Lose(void)
   *   {
   *     IsToWin = false;        // ← CRITICAL: clears pending win!
   *     if (!IsToDie && !IsToLose) {
   *       IsToLose = true;
   *       BorrowedTime = TICKS_PER_MINUTE * Rule.SavourDelay;
   *     }
   *     return(IsToLose);
   *   }
   *
   * Key behavior: Flag_To_Lose UNCONDITIONALLY clears IsToWin, even if the
   * Flag_To_Lose itself fails (because IsToDie is set). This ensures that
   * once a lose condition fires, any pending win is cancelled.
   *
   * TS behavior: win and lose are separate boolean results from executeTriggerAction.
   * If TACTION_WIN fires first, state='won' and subsequent TACTION_LOSE is ignored.
   * There is NO mechanism to cancel a pending win.
   */

  it('TACTION_LOSE result does not cancel a preceding TACTION_WIN', () => {
    // TS processes actions sequentially. Both return independent results.
    const winResult = executeTriggerAction(
      makeAction(TACTION_WIN), [], new Map(), new Set(), []
    );
    const loseResult = executeTriggerAction(
      makeAction(TACTION_LOSE), [], new Map(), new Set(), []
    );
    // Both are independently true — no cancellation mechanism
    expect(winResult.win).toBe(true);
    expect(loseResult.lose).toBe(true);
    // PARITY GAP: In C++, Flag_To_Lose clears IsToWin. In TS, once state='won'
    // the lose action is silently ignored by the `state === 'playing'` guard.
    // The outcome may be the same in practice IF win is applied first, but the
    // C++ behavior is: lose ALWAYS cancels pending win, regardless of ordering.
  });
});

// ============================================================
// Section 6: BorrowedTime (savour delay)
// C++ house.cpp:945, 4071-4080
// ============================================================
describe('BorrowedTime savour delay — C++ house.cpp:945, 4071-4080', () => {
  /**
   * C++ source (house.cpp:4070-4081):
   *   if (!IsToWin && !IsToDie && !IsToLose) {
   *     IsToWin = true;
   *     BorrowedTime = TICKS_PER_MINUTE * Rule.SavourDelay;
   *   }
   *
   * C++ house.cpp:945 — win fires only when timer expires:
   *   if (Session.Type == GAME_NORMAL && IsToWin && BorrowedTime == 0 && Blockage <= 0) {
   *     IsToWin = false;
   *     if (this == PlayerPtr) {
   *       PlayerWins = true;
   *     } else {
   *       PlayerLoses = true;
   *     }
   *   }
   *
   * C++ gives a "savour delay" period after win/lose is set before it takes effect.
   * Default SavourDelay = 3, so delay = TICKS_PER_MINUTE * 3 = ~2700 ticks (~3 min).
   *
   * TS behavior: No delay. executeTriggerAction returns {win: true} and
   * applyTriggerActionResult immediately sets state='won'.
   */

  it('TACTION_WIN takes effect immediately in TS (no savour delay)', () => {
    // In C++, Flag_To_Win sets IsToWin + starts a countdown.
    // In TS, the win result is applied immediately.
    const result = executeTriggerAction(
      makeAction(TACTION_WIN), [], new Map(), new Set(), []
    );
    expect(result.win).toBe(true);
    // PARITY GAP: No BorrowedTime mechanism exists in TS.
    // C++ delays the actual win by TICKS_PER_MINUTE * SavourDelay ticks.
    // TS applies win on the very same tick the trigger fires.
  });
});

// ============================================================
// Section 7: Blockage counter gates win
// C++ house.cpp:945, scenario.cpp:618-625, trigger.cpp:175-178
// ============================================================
describe('Blockage counter gates win — C++ house.cpp:945 + scenario.cpp:618-625', () => {
  /**
   * C++ scenario.cpp:618-625 — on scenario start, counts ALLOWWIN triggers:
   *   for (int index = 0; index < TriggerTypes.Count(); index++) {
   *     TriggerTypeClass * tp = TriggerTypes.Ptr(index);
   *     if (tp->Action1.Action == TACTION_ALLOWWIN ||
   *       (tp->ActionControl != MULTI_ONLY && tp->Action2.Action == TACTION_ALLOWWIN)) {
   *       HouseClass::As_Pointer(tp->House)->Blockage++;
   *     }
   *   }
   *
   * C++ trigger.cpp:175-178 — when ALLOWWIN trigger is destroyed:
   *   if (GameActive && Class->House != HOUSE_NONE && Class->Action1.Action == TACTION_ALLOWWIN) {
   *     if (Houses.Ptr(Class->House)->Blockage) Houses.Ptr(Class->House)->Blockage--;
   *     Houses.Ptr(Class->House)->BorrowedTime = TICKS_PER_SECOND*4;
   *   }
   *
   * C++ house.cpp:945 — win only fires when Blockage <= 0:
   *   if (IsToWin && BorrowedTime == 0 && Blockage <= 0) { ... }
   *
   * C++ uses an integer counter (Blockage). Multiple ALLOWWIN triggers each increment
   * the counter, and ALL must be destroyed/fired before win can proceed.
   *
   * TS behavior: uses a single boolean `allowWin`. executeTriggerAction returns
   * {allowWin: true} and the game sets this.allowWin = true. One ALLOWWIN trigger
   * firing is sufficient to clear the gate.
   *
   * PARITY GAP: If a scenario has N ALLOWWIN triggers, C++ requires ALL N to fire.
   * TS only requires ONE to fire.
   */

  it('TACTION_ALLOWWIN returns allowWin=true (TS boolean, not counter)', () => {
    const result = executeTriggerAction(
      makeAction(TACTION_ALLOWWIN), [], new Map(), new Set(), []
    );
    expect(result.allowWin).toBe(true);
    // PARITY GAP: C++ uses Blockage++ per ALLOWWIN trigger at scenario init,
    // and Blockage-- when each trigger is destroyed. Win requires Blockage <= 0.
    // TS uses a single boolean — first ALLOWWIN trigger sets it permanently.
  });

  it('multiple ALLOWWIN triggers: TS has no counter mechanism', () => {
    // Simulate two ALLOWWIN triggers firing sequentially
    const result1 = executeTriggerAction(
      makeAction(TACTION_ALLOWWIN), [], new Map(), new Set(), []
    );
    const result2 = executeTriggerAction(
      makeAction(TACTION_ALLOWWIN), [], new Map(), new Set(), []
    );
    // Both return allowWin=true. In TS, the second is redundant.
    expect(result1.allowWin).toBe(true);
    expect(result2.allowWin).toBe(true);
    // PARITY GAP: C++ would still have Blockage=1 after first fire (needs both).
    // TS: first ALLOWWIN sets boolean true — game can win immediately.
  });
});

// ============================================================
// Section 8: Session.Type == GAME_NORMAL guard
// C++ house.cpp:945, 957
// ============================================================
describe('GAME_NORMAL session guard — C++ house.cpp:945', () => {
  /**
   * C++ house.cpp:945:
   *   if (Session.Type == GAME_NORMAL && IsToWin && BorrowedTime == 0 && Blockage <= 0)
   *
   * C++ house.cpp:957:
   *   if (Session.Type == GAME_NORMAL && IsToLose && BorrowedTime == 0)
   *
   * Win/lose conditions ONLY fire in single-player campaign (GAME_NORMAL).
   * Multiplayer games use a completely different defeat mechanism
   * (MPlayer_Defeated in house.cpp).
   *
   * TS behavior: No session type distinction. The game engine always processes
   * win/lose from trigger actions regardless of game mode.
   * This is acceptable because the TS engine only runs single-player missions.
   */

  it('executeTriggerAction has no session type parameter', () => {
    // Documenting: C++ gates on Session.Type but TS has no such concept
    const result = executeTriggerAction(
      makeAction(TACTION_WIN), [], new Map(), new Set(), []
    );
    expect(result.win).toBe(true);
    // No divergence in practice — TS only implements single-player.
  });
});

// ============================================================
// Section 9: Flag_To_Die — Blowup_All
// C++ house.cpp:4039-4048, 969-972
// ============================================================
describe('Flag_To_Die blowup mechanism — C++ house.cpp:4039-4048', () => {
  /**
   * C++ house.cpp:4039-4048:
   *   bool HouseClass::Flag_To_Die(void)
   *   {
   *     if (!IsToWin && !IsToDie && !IsToLose) {
   *       IsToDie = true;
   *       BorrowedTime = TICKS_PER_MINUTE * Rule.SavourDelay;
   *     }
   *     return(IsToDie);
   *   }
   *
   * C++ house.cpp:969-972:
   *   if (IsToDie && BorrowedTime == 0) {
   *     IsToDie = false;
   *     Blowup_All();
   *   }
   *
   * Flag_To_Die is distinct from Flag_To_Lose — it blows up all buildings/units
   * owned by that house but does NOT directly set PlayerWins/PlayerLoses.
   * It's used for multiplayer defeat and CTF flag capture.
   *
   * TS behavior: No Flag_To_Die mechanism exists. There is no TACTION that maps
   * to it in the TS trigger system. This is acceptable since TS only handles
   * single-player scenarios where Flag_To_Die is not typically triggered.
   */

  it('no TACTION maps to Flag_To_Die in TS', () => {
    // TACTION_FIRE_SALE (9) is the closest but has different semantics.
    // Flag_To_Die literally destroys everything; fire sale sells buildings + hunts.
    // Documenting that this C++ mechanism has no TS equivalent.
    const fireSaleResult = executeTriggerAction(
      makeAction(9, 1), // TACTION_FIRE_SALE, house=1
      [], new Map(), new Set(), []
    );
    // TACTION_FIRE_SALE sets fireSale, not a blowup mechanism
    expect(fireSaleResult.win).toBeUndefined();
    expect(fireSaleResult.lose).toBeUndefined();
  });
});

// ============================================================
// Section 10: TACTION_WIN/LOSE are the ONLY direct win/lose
// trigger actions — C++ taction.cpp:604-622
// ============================================================
describe('only TACTION_WIN and TACTION_LOSE directly trigger game end', () => {
  /**
   * In C++, only two actions directly call Flag_To_Win/Flag_To_Lose:
   *   - TACTION_WIN (1)  — taction.cpp:604
   *   - TACTION_LOSE (2) — taction.cpp:616
   *
   * All other actions (reinforcements, timers, globals, etc.) never directly
   * set win/lose state.
   *
   * TS parity: executeTriggerAction should ONLY set result.win from TACTION_WIN
   * and result.lose from TACTION_LOSE. Verify no other action leaks win/lose.
   */

  // Test all non-win/lose actions to confirm they don't set win or lose
  const NON_WIN_LOSE_ACTIONS = [
    0,  // NONE
    3,  // BEGIN_PRODUCTION
    5,  // DESTROY_TEAM
    6,  // ALL_HUNT
    8,  // DZ
    9,  // FIRE_SALE
    11, // TEXT_TRIGGER
    13, // AUTOCREATE
    15, // ALLOWWIN — sets allowWin, NOT win
    16, // REVEAL_ALL
    19, // PLAY_SOUND
    21, // PLAY_SPEECH
    23, // START_TIMER
    24, // STOP_TIMER
    26, // SUB_TIMER
    27, // SET_TIMER
    28, // SET_GLOBAL
    29, // CLEAR_GLOBAL
  ];

  for (const actionCode of NON_WIN_LOSE_ACTIONS) {
    it(`action ${actionCode} does not set win or lose`, () => {
      const result = executeTriggerAction(
        makeAction(actionCode), [], new Map(), new Set(), []
      );
      expect(result.win, `action ${actionCode} should not trigger win`).toBeUndefined();
      expect(result.lose, `action ${actionCode} should not trigger lose`).toBeUndefined();
    });
  }
});

// ============================================================
// Section 11: TACTION_ALLOWWIN + checkVictoryConditions interaction
// C++ scenario.cpp:618-625 — ALLOWWIN gates fallback win
// ============================================================
describe('ALLOWWIN gates fallback victory — C++ scenario.cpp:618-625', () => {
  /**
   * C++ behavior:
   * 1. On scenario start, each ALLOWWIN trigger increments house->Blockage
   * 2. TACTION_WIN in house AI checks: IsToWin && BorrowedTime==0 && Blockage<=0
   * 3. When ALLOWWIN trigger fires and is destroyed, Blockage-- (trigger.cpp:176)
   * 4. Only when ALL ALLOWWIN triggers have fired does Blockage reach 0
   *
   * TS behavior (index.ts:5925-5929):
   *   const hasAllowWinTrigger = this.triggers.some(t =>
   *     t.action1.action === 15 || (t.actionControl === 1 && t.action2.action === 15)
   *   );
   *   if (hasAllowWinTrigger && !this.allowWin) return;
   *
   * TS checks: if ANY trigger has ALLOWWIN action AND the boolean isn't set, block win.
   * Once a single ALLOWWIN fires, the boolean is set and ALL fallback wins are unblocked.
   *
   * PARITY GAP: C++ uses per-trigger counting (Blockage counter).
   * TS uses a single boolean (one ALLOWWIN fires = all unblocked).
   * For scenarios with exactly 1 ALLOWWIN trigger, behavior is equivalent.
   * For scenarios with N>1 ALLOWWIN triggers, TS unblocks too early.
   */

  it('ALLOWWIN result is a boolean, not a counter decrement', () => {
    const result = executeTriggerAction(
      makeAction(TACTION_ALLOWWIN), [], new Map(), new Set(), []
    );
    // C++ decrements Blockage counter and sets BorrowedTime
    // TS returns allowWin boolean
    expect(result.allowWin).toBe(true);
    expect(typeof result.allowWin).toBe('boolean');
    // PARITY GAP: No counter mechanism. C++ trigger.cpp:176:
    //   if (Houses.Ptr(Class->House)->Blockage) Houses.Ptr(Class->House)->Blockage--;
    // TS: this.allowWin = true (irreversible boolean flip)
  });
});

// ============================================================
// Section 12: ALLOWWIN only checks Action1 in trigger destructor
// C++ trigger.cpp:175 — only Action1 is checked
// ============================================================
describe('ALLOWWIN trigger destructor asymmetry — C++ trigger.cpp:175', () => {
  /**
   * C++ trigger.cpp:175:
   *   if (GameActive && Class->House != HOUSE_NONE && Class->Action1.Action == TACTION_ALLOWWIN) {
   *     if (Houses.Ptr(Class->House)->Blockage) Houses.Ptr(Class->House)->Blockage--;
   *   }
   *
   * CRITICAL: The trigger destructor ONLY checks Action1 for ALLOWWIN.
   * If ALLOWWIN is in Action2, the destructor does NOT decrement Blockage.
   *
   * However, scenario.cpp:620-621 counts BOTH actions at init:
   *   if (tp->Action1.Action == TACTION_ALLOWWIN ||
   *     (tp->ActionControl != MULTI_ONLY && tp->Action2.Action == TACTION_ALLOWWIN)) {
   *     HouseClass::As_Pointer(tp->House)->Blockage++;
   *   }
   *
   * This means: if ALLOWWIN is in Action2, Blockage is incremented at init but
   * NEVER decremented — the win condition can never be unblocked!
   * This is likely a C++ bug (asymmetric init vs cleanup).
   *
   * TS behavior (index.ts:5926-5927):
   *   const hasAllowWinTrigger = this.triggers.some(t =>
   *     t.action1.action === 15 || (t.actionControl === 1 && t.action2.action === 15)
   *   );
   *
   * TS checks both action1 and action2 for ALLOWWIN presence (matching scenario init),
   * but uses a boolean that is set by either action firing. So TS does NOT reproduce
   * the C++ bug where Action2 ALLOWWIN permanently blocks win.
   */

  it('ALLOWWIN in action2 also triggers allowWin result in TS', () => {
    const result = executeTriggerAction(
      makeAction(TACTION_ALLOWWIN), // This tests action as standalone
      [], new Map(), new Set(), []
    );
    expect(result.allowWin).toBe(true);
    // Note: C++ would NOT decrement Blockage if ALLOWWIN was in Action2
    // of the trigger type, due to trigger.cpp:175 only checking Action1.
    // TS doesn't have this asymmetry — allowWin is set by either action.
  });
});

// ============================================================
// Section 13: Win requires house == PlayerPtr check
// C++ house.cpp:947-951
// ============================================================
describe('Win applies only to PlayerPtr — C++ house.cpp:947-951', () => {
  /**
   * C++ house.cpp:947-951:
   *   if (this == PlayerPtr) {
   *     PlayerWins = true;
   *   } else {
   *     PlayerLoses = true;   // ← enemy house winning = player loses!
   *   }
   *
   * When a NON-player house's IsToWin flag fires, the PLAYER LOSES.
   * This is the same logic as TACTION_WIN checking Data.House.
   *
   * TS behavior: The engine only processes the player house.
   * There is no concept of enemy houses having their own win/lose state.
   * TACTION_WIN always means "player wins" in TS.
   */

  it('TACTION_WIN has no house context in TS', () => {
    // executeTriggerAction receives no house context parameter that would
    // influence win/lose determination
    const result = executeTriggerAction(
      makeAction(TACTION_WIN), [], new Map(), new Set(), []
    );
    expect(result.win).toBe(true);
    expect(result.lose).toBeUndefined();
    // PARITY GAP: C++ checks this == PlayerPtr after IsToWin timer expires.
    // An enemy house winning causes the player to lose. TS has no such mechanism.
  });
});

// ============================================================
// Section 14: Ant mission detection — ScenarioName[2] == 'A'
// C++ scenario.cpp:2074, index.ts checkVictoryConditions
// ============================================================
describe('ant mission detection — C++ scenario.cpp:2074', () => {
  /**
   * C++ identifies ant missions by ScenarioName[2] == 'A' (e.g., "SCA01EA").
   * C++ scenario.cpp:2074:
   *   if (Scen.Scenario >= 20 || Scen.ScenarioName[2] == 'A') {
   *     RequiredCD = 2;
   *   }
   *
   * TS (index.ts:5942):
   *   if (!this.scenarioId.startsWith('SCA')) {
   *     // generic fallback win logic for campaign missions
   *   }
   *
   * TS uses startsWith('SCA') to distinguish ant missions from campaign missions
   * for fallback win logic. This is functionally equivalent to checking the 3rd
   * character being 'A' (0-indexed [2]) since all ant missions are SCA*.
   */

  it('SCA prefix identifies ant missions — convention match', () => {
    // C++: ScenarioName[2] == 'A' → 3rd character is 'A'
    // TS: scenarioId.startsWith('SCA')
    // Both correctly identify: SCA01EA, SCA02EA, SCA03EA, SCA04EA
    const antMissions = ['SCA01EA', 'SCA02EA', 'SCA03EA', 'SCA04EA'];
    const campaignMissions = ['SCG01EA', 'SCG02EA', 'SCU01EA', 'SCU02EA'];

    for (const id of antMissions) {
      expect(id.startsWith('SCA'), `${id} should be ant mission`).toBe(true);
      expect(id[2], `${id} C++ check: char[2] == 'A'`).toBe('A');
    }

    for (const id of campaignMissions) {
      expect(id.startsWith('SCA'), `${id} should NOT be ant mission`).toBe(false);
      expect(id[2] === 'A', `${id} C++ check: char[2] != 'A'`).toBe(false);
    }
  });
});

// ============================================================
// Section 15: TS fallback win — all enemies dead (no C++ equivalent)
// C++ has NO fallback win — only trigger-driven wins
// ============================================================
describe('TS fallback win for campaign missions — no C++ equivalent', () => {
  /**
   * C++ has NO fallback "all enemies dead = win" logic.
   * Victory is EXCLUSIVELY trigger-driven in C++.
   * If no trigger fires TACTION_WIN, the player simply cannot win.
   *
   * TS (index.ts:5941-5957) adds a fallback:
   *   if (!this.scenarioId.startsWith('SCA')) {
   *     const enemyUnitsAlive = ...
   *     const enemyStructuresAlive = ...
   *     if (!enemyUnitsAlive && !enemyStructuresAlive) {
   *       this.state = 'won';
   *     }
   *   }
   *
   * PARITY GAP: This fallback does not exist in C++.
   * It's a TS-specific feature for robustness, allowing campaign missions
   * to end even if triggers are not perfectly implemented.
   * It's gated behind the trigger-win check (line 5902: if hasTriggerWin, return),
   * so it only activates when no unfired TACTION_WIN triggers remain.
   */

  it('documenting: TS has fallback win logic that C++ lacks', () => {
    // This test documents the architectural difference.
    // C++ relies entirely on TACTION_WIN triggers for victory.
    // TS adds a "last resort" win when all enemies are destroyed
    // AND no pending TACTION_WIN triggers exist.
    // PARITY GAP: This is intentional — TS can't guarantee all triggers work.
    expect(true).toBe(true); // Document-only test
  });
});

// ============================================================
// Section 16: TS 3-second early-game immunity
// index.ts:5879 — no C++ equivalent
// ============================================================
describe('TS early-game immunity — index.ts:5879', () => {
  /**
   * TS (index.ts:5879):
   *   if (this.tick < GAME_TICKS_PER_SEC * 3) return;
   *
   * TS skips victory condition checks during the first 3 seconds of gameplay.
   * C++ has no such guard — win/lose can fire on any tick.
   *
   * In C++, the BorrowedTime (savour delay) serves a somewhat similar purpose
   * by delaying the win/lose from taking effect, but it's not the same as
   * skipping the check entirely.
   */

  it('documenting: TS has 3-second immunity that C++ lacks', () => {
    // C++ can trigger Flag_To_Win on tick 1.
    // TS ignores checkVictoryConditions for first 3 seconds.
    // PARITY GAP: Different early-game timing behavior.
    expect(true).toBe(true); // Document-only test
  });
});

// ============================================================
// Section 17: TACTION_WIN triggers immediate state change in TS
// vs C++ deferred state change through house AI loop
// ============================================================
describe('TACTION_WIN timing — immediate (TS) vs deferred (C++)', () => {
  /**
   * C++ flow:
   *   1. Trigger fires → TACTION_WIN → Flag_To_Win() sets IsToWin=true + starts timer
   *   2. HouseClass::AI() runs each tick
   *   3. When BorrowedTime expires AND Blockage<=0 → PlayerWins = true
   *   4. Main loop detects PlayerWins → calls Do_Win()
   *
   * TS flow:
   *   1. Trigger fires → executeTriggerAction returns {win: true}
   *   2. applyTriggerActionResult immediately sets state='won'
   *   3. Game stops on the next render frame
   *
   * The C++ flow has multiple frames between trigger fire and actual win.
   * The TS flow has ZERO frames of delay.
   */

  it('TACTION_WIN result is applied synchronously in TS', () => {
    const result = executeTriggerAction(
      makeAction(TACTION_WIN), [], new Map(), new Set(), []
    );
    // Result is immediately available — no timer, no deferred state
    expect(result.win).toBe(true);
    // PARITY GAP: C++ defers win by BorrowedTime ticks (typically ~2700 ticks).
    // TS applies immediately. This means triggers that fire after TACTION_WIN
    // but before BorrowedTime expires in C++ would never run in TS.
  });
});

// ============================================================
// Section 18: Loss condition — all player units dead (TS only)
// ============================================================
describe('loss fallback — all player units dead', () => {
  /**
   * TS (index.ts:5881-5889):
   *   const playerAlive = this.entities.some(e => e.alive && e.isPlayerUnit);
   *   if (!playerAlive) {
   *     this.state = 'lost';
   *   }
   *
   * C++ does NOT have a "all units dead = lose" fallback for single player.
   * In C++, the player can only lose via:
   *   1. TACTION_LOSE trigger action
   *   2. Flag_To_Lose called by game events (flag captured, HQ destroyed)
   *
   * PARITY GAP: TS adds an automatic loss when all player units are destroyed.
   * C++ only loses through explicit trigger actions or specific game events.
   */

  it('documenting: TS auto-loses when all player units die', () => {
    // This is an intentional TS addition for better gameplay
    expect(true).toBe(true); // Document-only test
  });
});

// ============================================================
// Section 19: TACTION_WINLOSE — "Win if captured, lose if destroyed"
// C++ taction.h:60, taction.cpp (falls through to default in RA)
// ============================================================
describe('TACTION_WINLOSE — C++ taction.h:60', () => {
  /**
   * C++ taction.h:60:
   *   TACTION_WINLOSE,  // Win if captured, lose if destroyed.
   *
   * In C++ RA (taction.cpp), TACTION_WINLOSE falls through to default/noop.
   * The enum exists but the action handler does nothing in RA.
   * It was functional in Tiberian Dawn (TD) but not ported to RA.
   *
   * TS implementation (scenario.ts:2320-2326):
   *   case TACTION_WINLOSE:
   *     result.winLose = true;
   *     break;
   *
   * TS sets a winLose flag. The TS comment says "we implement it per TD behavior."
   */

  it('TACTION_WINLOSE = 14 sets winLose flag', () => {
    const result = executeTriggerAction(
      makeAction(TACTION_WINLOSE), [], new Map(), new Set(), []
    );
    expect(result.winLose).toBe(true);
    // Note: In C++ RA, this is effectively a noop. TS implements TD behavior.
  });
});

// ============================================================
// Section 20: Win/lose result mutual exclusivity
// Testing that a single action can't set both win AND lose
// ============================================================
describe('win/lose result mutual exclusivity', () => {
  /**
   * C++ guarantees mutual exclusivity through the Flag_To_* functions:
   *   - Flag_To_Win checks !IsToWin && !IsToDie && !IsToLose
   *   - Flag_To_Lose clears IsToWin, then checks !IsToDie && !IsToLose
   *
   * TS: Each action returns exactly one of win/lose/allowWin.
   * No single executeTriggerAction call should ever return both win and lose.
   */

  it('TACTION_WIN never sets lose', () => {
    const result = executeTriggerAction(
      makeAction(TACTION_WIN), [], new Map(), new Set(), []
    );
    expect(result.win).toBe(true);
    expect(result.lose).toBeUndefined();
  });

  it('TACTION_LOSE never sets win', () => {
    const result = executeTriggerAction(
      makeAction(TACTION_LOSE), [], new Map(), new Set(), []
    );
    expect(result.lose).toBe(true);
    expect(result.win).toBeUndefined();
  });

  it('TACTION_ALLOWWIN sets neither win nor lose', () => {
    const result = executeTriggerAction(
      makeAction(TACTION_ALLOWWIN), [], new Map(), new Set(), []
    );
    expect(result.allowWin).toBe(true);
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
  });
});

// ============================================================
// Section 21: FAILING PARITY TESTS — C++ behavior assertions
// These test what C++ DOES. Failures document real TS divergence.
// ============================================================
describe('PARITY GAP: TACTION_WIN with enemy house should cause player loss (taction.cpp:604-610)', () => {
  /**
   * C++ taction.cpp:604-610:
   *   case TACTION_WIN:
   *     if (Data.House == PlayerPtr->Class->House) {
   *       PlayerPtr->Flag_To_Win();
   *     } else {
   *       PlayerPtr->Flag_To_Lose();
   *     }
   *
   * When TACTION_WIN fires with Data.House set to an enemy house,
   * C++ calls Flag_To_Lose() — the player LOSES.
   *
   * TS ignores action.data for TACTION_WIN and always returns {win: true}.
   */

  // PARITY GAP: This test asserts C++ behavior. TS will FAIL because it
  // always sets win=true regardless of which house is specified.
  it.fails('TACTION_WIN for enemy house should set lose=true, not win=true', () => {
    // Assume player is house 0, enemy is house 1.
    // C++ checks: Data.House(1) == PlayerPtr->Class->House(0) → false → Flag_To_Lose
    const result = executeTriggerAction(
      makeAction(TACTION_WIN, 1), // data=1 = enemy house
      [], new Map(), new Set(), [],
      0, // triggerHouse (not used for WIN in TS, but passed for completeness)
    );
    // C++ behavior: enemy house winning = player loses
    expect(result.lose).toBe(true);  // PARITY GAP — TS sets win=true instead
    expect(result.win).toBeUndefined();
  });
});

describe('PARITY GAP: TACTION_LOSE with enemy house should cause player win (taction.cpp:616-622)', () => {
  /**
   * C++ taction.cpp:616-622:
   *   case TACTION_LOSE:
   *     if (Data.House != PlayerPtr->Class->House) {
   *       PlayerPtr->Flag_To_Win();
   *     } else {
   *       PlayerPtr->Flag_To_Lose();
   *     }
   *
   * When TACTION_LOSE fires with Data.House set to an enemy house,
   * C++ calls Flag_To_Win() — the player WINS.
   *
   * TS ignores action.data for TACTION_LOSE and always returns {lose: true}.
   */

  // PARITY GAP: This test asserts C++ behavior. TS will FAIL because it
  // always sets lose=true regardless of which house is specified.
  it.fails('TACTION_LOSE for enemy house should set win=true, not lose=true', () => {
    // Assume player is house 0, enemy is house 1.
    // C++ checks: Data.House(1) != PlayerPtr->Class->House(0) → true → Flag_To_Win
    const result = executeTriggerAction(
      makeAction(TACTION_LOSE, 1), // data=1 = enemy house
      [], new Map(), new Set(), [],
      0, // triggerHouse
    );
    // C++ behavior: enemy house losing = player wins
    expect(result.win).toBe(true);   // PARITY GAP — TS sets lose=true instead
    expect(result.lose).toBeUndefined();
  });
});

describe('PARITY GAP: TACTION_WINLOSE is a noop in C++ RA (taction.cpp)', () => {
  /**
   * C++ RA taction.cpp does NOT have a case for TACTION_WINLOSE (14).
   * The enum exists in taction.h:60 but the switch statement in the
   * action operator() falls through to default, which is a noop.
   *
   * TS implements it as result.winLose=true (following TD behavior).
   * This is technically a parity gap — C++ RA does nothing with this action.
   */

  // PARITY GAP: C++ RA treats TACTION_WINLOSE as a noop.
  // TS sets winLose=true.
  it.fails('TACTION_WINLOSE should be a noop in C++ RA (no winLose flag)', () => {
    const result = executeTriggerAction(
      makeAction(TACTION_WINLOSE), [], new Map(), new Set(), []
    );
    // C++ RA behavior: TACTION_WINLOSE does nothing
    expect(result.winLose).toBeUndefined(); // PARITY GAP — TS sets winLose=true
  });
});

describe('PARITY GAP: ALLOWWIN should be a counter, not a boolean', () => {
  /**
   * C++ uses an integer Blockage counter (house.h:335):
   *   int Blockage;
   *
   * Scenario init (scenario.cpp:623):
   *   HouseClass::As_Pointer(tp->House)->Blockage++;
   *
   * Trigger destructor (trigger.cpp:176):
   *   if (Houses.Ptr(Class->House)->Blockage) Houses.Ptr(Class->House)->Blockage--;
   *
   * Win check (house.cpp:945):
   *   if (IsToWin && BorrowedTime == 0 && Blockage <= 0) { ... }
   *
   * With 2 ALLOWWIN triggers, Blockage starts at 2. First fire → Blockage=1.
   * Second fire → Blockage=0. Win is now unblocked.
   *
   * TS uses a boolean. First ALLOWWIN fire → allowWin=true. Win immediately unblocked.
   * Second ALLOWWIN fire is redundant.
   *
   * This means TS allows premature wins in multi-ALLOWWIN scenarios.
   */

  // PARITY GAP: TS has no mechanism to require multiple ALLOWWIN triggers to fire.
  // We can't directly test the counter vs boolean at the executeTriggerAction level,
  // but we can document that the result type lacks counter semantics.
  it.fails('ALLOWWIN result should include a counter decrement, not just a boolean', () => {
    const result = executeTriggerAction(
      makeAction(TACTION_ALLOWWIN), [], new Map(), new Set(), []
    );
    // C++ behavior: Blockage-- (counter decrement)
    // TS behavior: allowWin = true (boolean flip)
    // Assert C++ semantics: result should have a numeric counter field
    expect(result).toHaveProperty('blockageDecrement');  // PARITY GAP — no such field exists
  });
});
