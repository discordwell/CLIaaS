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

  it('TACTION_WINLOSE = 14 is noop in RA (no handler in taction.cpp)', () => {
    const result = executeTriggerAction(
      makeAction(14), [], new Map(), new Set(), []
    );
    // C++ RA: TACTION_WINLOSE falls through to default — noop
    expect(result.winLose).toBeUndefined();
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
   * TS now passes playerHouseId to executeTriggerAction, matching C++ behavior.
   */

  it('TACTION_WIN for player house sets win=true', () => {
    // C++: Data.House(0) == PlayerPtr->Class->House(0) → Flag_To_Win
    const result = executeTriggerAction(
      makeAction(1, 0), // data=0 = player house
      [], new Map(), new Set(), [],
      undefined, undefined, undefined,
      0, // playerHouseId=0
    );
    expect(result.win).toBe(true);
    expect(result.lose).toBeUndefined();
  });

  it('TACTION_WIN for enemy house sets lose=true (C++ taction.cpp:608)', () => {
    // C++: Data.House(1) != PlayerPtr->Class->House(0) → Flag_To_Lose
    const result = executeTriggerAction(
      makeAction(1, 1), // data=1 = enemy house
      [], new Map(), new Set(), [],
      undefined, undefined, undefined,
      0, // playerHouseId=0
    );
    expect(result.lose).toBe(true);
    expect(result.win).toBeUndefined();
  });

  it('TACTION_WIN without playerHouseId defaults to win=true (backward compat)', () => {
    const result = executeTriggerAction(
      makeAction(1, 1), // data=1, but no playerHouseId
      [], new Map(), new Set(), []
    );
    expect(result.win).toBe(true);
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
   * TS now passes playerHouseId to executeTriggerAction, matching C++ behavior.
   */

  it('TACTION_LOSE for player house sets lose=true', () => {
    // C++: Data.House(0) == PlayerPtr->Class->House(0) → !(!= check) → Flag_To_Lose
    const result = executeTriggerAction(
      makeAction(2, 0), // data=0 = player house
      [], new Map(), new Set(), [],
      undefined, undefined, undefined,
      0, // playerHouseId=0
    );
    expect(result.lose).toBe(true);
    expect(result.win).toBeUndefined();
  });

  it('TACTION_LOSE for enemy house sets win=true (C++ taction.cpp:618)', () => {
    // C++: Data.House(1) != PlayerPtr->Class->House(0) → Flag_To_Win
    const result = executeTriggerAction(
      makeAction(2, 1), // data=1 = enemy house
      [], new Map(), new Set(), [],
      undefined, undefined, undefined,
      0, // playerHouseId=0
    );
    expect(result.win).toBe(true);
    expect(result.lose).toBeUndefined();
  });

  it('TACTION_LOSE without playerHouseId defaults to lose=true (backward compat)', () => {
    const result = executeTriggerAction(
      makeAction(2, 1), // data=1, but no playerHouseId
      [], new Map(), new Set(), []
    );
    expect(result.lose).toBe(true);
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
   * TS implementation: applyTriggerActionResult (index.ts) now implements this
   * at the game engine level. When result.lose is applied:
   *   1. this.isToWin = false (unconditional clear, matching C++)
   *   2. if (!this.isToLose) { this.isToLose = true; this.borrowedTime = SAVOUR_DELAY; }
   * This matches the C++ Flag_To_Lose behavior exactly.
   *
   * At the executeTriggerAction level, each call is stateless — it returns
   * independent results. The mutual exclusion is enforced by the game loop.
   */

  it('executeTriggerAction returns independent results (state managed by game loop)', () => {
    // executeTriggerAction is stateless — each call returns an independent result.
    // The C++ Flag_To_Lose clearing IsToWin is implemented in applyTriggerActionResult.
    const winResult = executeTriggerAction(
      makeAction(TACTION_WIN), [], new Map(), new Set(), []
    );
    const loseResult = executeTriggerAction(
      makeAction(TACTION_LOSE), [], new Map(), new Set(), []
    );
    expect(winResult.win).toBe(true);
    expect(loseResult.lose).toBe(true);
    // C++ parity: Flag_To_Lose clears IsToWin is now implemented in applyTriggerActionResult.
    // When result.lose is applied to the game state, it unconditionally clears isToWin.
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
   * rules.ini SavourDelay=.03 → 0.03 * 900 = 27 ticks (~1.8s at 15 Hz).
   *
   * TS implementation: applyTriggerActionResult now sets isToWin/isToLose flags
   * and starts a borrowedTime countdown. applyDeferredWinLose() in the game tick
   * decrements the timer and only applies win/lose when it expires.
   */

  it('TACTION_WIN returns result.win (deferred via BorrowedTime in game loop)', () => {
    // executeTriggerAction returns the trigger result. The game engine
    // defers the actual state change via BorrowedTime (SAVOUR_DELAY_TICKS).
    const result = executeTriggerAction(
      makeAction(TACTION_WIN), [], new Map(), new Set(), []
    );
    expect(result.win).toBe(true);
    // C++ parity: BorrowedTime mechanism is now implemented in index.ts.
    // applyTriggerActionResult sets isToWin=true + borrowedTime=27 ticks.
    // applyDeferredWinLose decrements each tick; win fires when timer hits 0.
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
   * TS implementation: index.ts uses an integer counter (this.allowWin). Scenario init
   * counts ALLOWWIN triggers to set the counter. Each ALLOWWIN fire decrements it.
   * Win check gates on this.allowWin <= 0, matching C++ exactly.
   */

  it('TACTION_ALLOWWIN returns allowWin=true and blockageDecrement=true', () => {
    const result = executeTriggerAction(
      makeAction(TACTION_ALLOWWIN), [], new Map(), new Set(), []
    );
    expect(result.allowWin).toBe(true);
    // C++ parity: result signals a Blockage counter decrement
    expect(result.blockageDecrement).toBe(true);
  });

  it('multiple ALLOWWIN fires both signal counter decrements', () => {
    // Each ALLOWWIN trigger fire signals a blockageDecrement to the game engine.
    // The game engine (index.ts) maintains the integer counter.
    const result1 = executeTriggerAction(
      makeAction(TACTION_ALLOWWIN), [], new Map(), new Set(), []
    );
    const result2 = executeTriggerAction(
      makeAction(TACTION_ALLOWWIN), [], new Map(), new Set(), []
    );
    expect(result1.blockageDecrement).toBe(true);
    expect(result2.blockageDecrement).toBe(true);
    // C++ parity: game engine starts with Blockage=N, each fire → Blockage--.
    // Win only unblocks when counter reaches 0.
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
   * TS implementation (index.ts):
   *   - Scenario init: counts ALLOWWIN triggers → this.allowWin = N
   *   - applyTriggerActionResult: if (result.allowWin && this.allowWin > 0) this.allowWin--
   *   - checkVictoryConditions: if (hasAllowWinTrigger && this.allowWin > 0) return
   *
   * TS now uses an integer counter matching C++ Blockage semantics.
   */

  it('ALLOWWIN result signals counter decrement via blockageDecrement', () => {
    const result = executeTriggerAction(
      makeAction(TACTION_ALLOWWIN), [], new Map(), new Set(), []
    );
    expect(result.allowWin).toBe(true);
    expect(result.blockageDecrement).toBe(true);
    // C++ parity: game engine decrements Blockage counter on each ALLOWWIN fire.
    // Win only unblocks when all ALLOWWIN triggers have fired (counter reaches 0).
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
   * TS behavior: The game engine decrements the counter when any ALLOWWIN action
   * fires (whether in action1 or action2), which does NOT reproduce the C++ bug.
   * This is an intentional divergence — the C++ behavior is a bug we don't replicate.
   */

  it('ALLOWWIN in any action slot triggers blockageDecrement', () => {
    const result = executeTriggerAction(
      makeAction(TACTION_ALLOWWIN), // This tests action as standalone
      [], new Map(), new Set(), []
    );
    expect(result.allowWin).toBe(true);
    expect(result.blockageDecrement).toBe(true);
    // Note: C++ would NOT decrement Blockage if ALLOWWIN was in Action2
    // of the trigger type, due to trigger.cpp:175 only checking Action1.
    // TS intentionally does NOT reproduce this C++ bug.
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
   * TS implementation: executeTriggerAction now accepts playerHouseId parameter.
   * TACTION_WIN checks action.data (Data.House) against playerHouseId:
   *   - Data.House == playerHouseId → result.win (player wins)
   *   - Data.House != playerHouseId → result.lose (player loses)
   * This matches C++ taction.cpp:604-610 behavior exactly.
   */

  it('TACTION_WIN with playerHouseId checks house identity', () => {
    // Player house 0, action targets enemy house 1
    const result = executeTriggerAction(
      makeAction(TACTION_WIN, 1), [], new Map(), new Set(), [],
      undefined, undefined, undefined,
      0, // playerHouseId=0
    );
    // C++ parity: enemy house winning = player loses
    expect(result.lose).toBe(true);
    expect(result.win).toBeUndefined();
  });

  it('TACTION_WIN for player house sets win=true', () => {
    const result = executeTriggerAction(
      makeAction(TACTION_WIN, 0), [], new Map(), new Set(), [],
      undefined, undefined, undefined,
      0, // playerHouseId=0
    );
    expect(result.win).toBe(true);
    expect(result.lose).toBeUndefined();
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
   * DESIGN NOTE: This fallback does not exist in C++ — intentional TS addition.
   * Provides robustness for campaign missions to end even if triggers are
   * not perfectly implemented. Gated behind the trigger-win check
   * (if hasTriggerWin, return), so it only activates when no unfired
   * TACTION_WIN triggers remain.
   */

  it('documenting: TS has fallback win logic that C++ lacks', () => {
    // This test documents the architectural difference.
    // C++ relies entirely on TACTION_WIN triggers for victory.
    // TS adds a "last resort" win when all enemies are destroyed
    // AND no pending TACTION_WIN triggers exist.
    // DESIGN NOTE: Intentional TS robustness feature — can't guarantee all triggers work.
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
   * DESIGN NOTE: Intentional TS guard to prevent premature win/lose from triggers
   * that fire before the game is fully set up. C++ BorrowedTime serves a
   * somewhat similar purpose but operates differently.
   */

  it('documenting: TS has 3-second immunity that C++ lacks', () => {
    // C++ can trigger Flag_To_Win on tick 1.
    // TS ignores checkVictoryConditions for first 3 seconds.
    // DESIGN NOTE: Intentional TS design for robustness.
    expect(true).toBe(true); // Document-only test
  });
});

// ============================================================
// Section 17: TACTION_WIN triggers immediate state change in TS
// vs C++ deferred state change through house AI loop
// ============================================================
describe('TACTION_WIN timing — deferred via BorrowedTime (matching C++)', () => {
  /**
   * C++ flow:
   *   1. Trigger fires → TACTION_WIN → Flag_To_Win() sets IsToWin=true + starts timer
   *   2. HouseClass::AI() runs each tick
   *   3. When BorrowedTime expires AND Blockage<=0 → PlayerWins = true
   *   4. Main loop detects PlayerWins → calls Do_Win()
   *
   * TS flow (now matching C++):
   *   1. Trigger fires → executeTriggerAction returns {win: true}
   *   2. applyTriggerActionResult sets isToWin=true + borrowedTime=27
   *   3. applyDeferredWinLose() decrements borrowedTime each tick
   *   4. When borrowedTime hits 0 AND allowWin <= 0 → state='won'
   *
   * rules.ini SavourDelay=.03 → 27 ticks (~1.8s at 15 Hz).
   */

  it('TACTION_WIN result signals deferred win (applied by game loop timer)', () => {
    const result = executeTriggerAction(
      makeAction(TACTION_WIN), [], new Map(), new Set(), []
    );
    expect(result.win).toBe(true);
    // C++ parity: game engine defers win by BorrowedTime (27 ticks).
    // Other triggers can fire and override during the delay period.
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
   * DESIGN NOTE: TS adds an automatic loss when all player units are destroyed.
   * C++ only loses through explicit trigger actions or specific game events.
   * Intentional TS addition for better gameplay experience.
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
   * TS now matches RA behavior: TACTION_WINLOSE is a noop.
   */

  it('TACTION_WINLOSE = 14 is noop in RA (C++ has no case handler)', () => {
    const result = executeTriggerAction(
      makeAction(TACTION_WINLOSE), [], new Map(), new Set(), []
    );
    // C++ RA: falls through to default — no side effects
    expect(result.winLose).toBeUndefined();
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
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
// Section 21: PARITY TESTS — C++ behavior assertions (now passing)
// These test C++ behavior that was previously a parity gap.
// ============================================================
describe('TACTION_WIN with enemy house causes player loss (taction.cpp:604-610)', () => {
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
   * TS now passes playerHouseId and checks Data.House, matching C++.
   */

  it('TACTION_WIN for enemy house sets lose=true, not win=true', () => {
    // Player is house 0, enemy is house 1.
    // C++ checks: Data.House(1) == PlayerPtr->Class->House(0) → false → Flag_To_Lose
    const result = executeTriggerAction(
      makeAction(TACTION_WIN, 1), // data=1 = enemy house
      [], new Map(), new Set(), [],
      0, // triggerHouse
      undefined, undefined,
      0, // playerHouseId=0
    );
    // C++ behavior: enemy house winning = player loses
    expect(result.lose).toBe(true);
    expect(result.win).toBeUndefined();
  });
});

describe('TACTION_LOSE with enemy house causes player win (taction.cpp:616-622)', () => {
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
   * TS now passes playerHouseId and checks Data.House, matching C++.
   */

  it('TACTION_LOSE for enemy house sets win=true, not lose=true', () => {
    // Player is house 0, enemy is house 1.
    // C++ checks: Data.House(1) != PlayerPtr->Class->House(0) → true → Flag_To_Win
    const result = executeTriggerAction(
      makeAction(TACTION_LOSE, 1), // data=1 = enemy house
      [], new Map(), new Set(), [],
      0, // triggerHouse
      undefined, undefined,
      0, // playerHouseId=0
    );
    // C++ behavior: enemy house losing = player wins
    expect(result.win).toBe(true);
    expect(result.lose).toBeUndefined();
  });
});

describe('TACTION_WINLOSE is a noop in C++ RA (taction.cpp)', () => {
  /**
   * C++ RA taction.cpp does NOT have a case for TACTION_WINLOSE (14).
   * The enum exists in taction.h:60 but the switch statement in the
   * action operator() falls through to default, which is a noop.
   *
   * TS now matches RA behavior: TACTION_WINLOSE is a noop.
   */

  it('TACTION_WINLOSE is a noop in C++ RA (no winLose flag)', () => {
    const result = executeTriggerAction(
      makeAction(TACTION_WINLOSE), [], new Map(), new Set(), []
    );
    // C++ RA behavior: TACTION_WINLOSE does nothing
    expect(result.winLose).toBeUndefined();
  });
});

describe('ALLOWWIN uses counter (Blockage) not boolean', () => {
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
   * TS now uses an integer counter (this.allowWin) matching C++ Blockage.
   * executeTriggerAction returns blockageDecrement=true to signal a decrement.
   */

  it('ALLOWWIN result includes blockageDecrement field', () => {
    const result = executeTriggerAction(
      makeAction(TACTION_ALLOWWIN), [], new Map(), new Set(), []
    );
    // C++ parity: result signals Blockage-- to the game engine
    expect(result).toHaveProperty('blockageDecrement');
    expect(result.blockageDecrement).toBe(true);
  });
});
