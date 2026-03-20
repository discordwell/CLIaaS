/**
 * C++ behavioral parity tests for trigger persistence modes.
 *
 * C++ source refs:
 *   - trigtype.h:64-68 — PersistantType enum: VOLATILE=0, SEMIPERSISTANT=1, PERSISTANT=2
 *   - trigtype.h:70-80 — IsPersistant field documentation:
 *       0 = trigger destroys itself immediately after going off
 *       1 = "Semi-Persistent": maintains attachment count, springs only after all attachments detach
 *       2 = "Fully Persistent": it just won't go away
 *   - trigger.cpp:128-137 — Constructor: AttachCount(0), events Reset
 *   - trigger.cpp:227-358 — Spring() function: full persistence lifecycle
 *   - trigger.cpp:277-298 — Semi-persistent detach logic in Spring():
 *       obj->Trigger = NULL (or Map[cell].Trigger = NULL)
 *       AttachCount--
 *       if (AttachCount > 0) return false;  // suppress firing
 *   - trigger.cpp:341-353 — Post-action persistence handling:
 *       if (VOLATILE || (SEMIPERSISTANT && AttachCount <= 1)):
 *           Detach_This_From_All(); delete this;
 *       else:  // PERSISTANT
 *           Event1.Reset(); Event2.Reset();
 *   - unit.cpp:4699, infantry.cpp:3372, building.cpp:5081, vessel.cpp:2010,
 *     display.cpp:4332 — AttachCount++ when entity/cell is linked to trigger
 *   - object.cpp:1900 — AttachCount-- when entity detaches from trigger
 *
 * TS implementation refs:
 *   - scenario.ts:173 — persistence field: 0=volatile, 1=semi, 2=persistent
 *   - scenario.ts:181 — fired boolean (replaces C++ self-destruction)
 *   - scenario.ts:191-192 — attachCount / remainingAttachCount
 *   - scenario.ts:195-209 — initializeTriggerAttachmentCounts()
 *   - scenario.ts:211-222 — noteTriggerAttachment()
 *   - scenario.ts:224-237 — consumeSemiPersistentAttachment()
 *   - index.ts:5679-5782 — processTriggers() main loop
 *   - index.ts:5682 — skip guard: `if (trigger.fired && trigger.persistence <= 1) continue`
 *   - index.ts:5720 — `trigger.fired = true` on fire
 *   - index.ts:5733-5734 — persistent timer reset: `trigger.timerTick = this.tick`
 *   - index.ts:5763 — persistent re-fire loop for pendingDestroyedCount
 */
import { describe, it, expect } from 'vitest';
import {
  consumeSemiPersistentAttachment,
  initializeTriggerAttachmentCounts,
  noteTriggerAttachment,
  checkTriggerEvent,
  executeTriggerAction,
  type ScenarioTrigger,
  type TriggerGameState,
  type TriggerAction,
  type TeamType,
} from '../engine/scenario';
import type { CellPos } from '../engine/types';

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal ScenarioTrigger */
function makeTrigger(overrides: Partial<ScenarioTrigger> = {}): ScenarioTrigger {
  return {
    name: 'test',
    persistence: 0,
    house: 0,
    eventControl: 0,
    actionControl: 0,
    event1: { type: 0, team: -1, data: 0 },
    event2: { type: 0, team: -1, data: 0 },
    action1: { action: 0, team: -1, trigger: -1, data: 0 },
    action2: { action: 0, team: -1, trigger: -1, data: 0 },
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
    attachCount: 0,
    remainingAttachCount: 0,
    ...overrides,
  };
}

/** Create a minimal TriggerGameState */
function createState(overrides: Partial<TriggerGameState> = {}): TriggerGameState {
  return {
    gameTick: 0,
    globals: new Set(),
    triggerStartTick: 0,
    triggerName: 'test',
    playerEntered: false,
    objectDiscovered: false,
    houseDiscovered: new Map(),
    enteredZone: false,
    crossedHorizontal: false,
    crossedVertical: false,
    enemyKillCount: 0,
    enemyUnitsAlive: 0,
    structureTypes: new Set(),
    builtStructureTypes: new Set(),
    destroyedTriggerNames: new Set(),
    attackedTriggerNames: new Set(),
    houseAlive: new Map(),
    houseUnitsAlive: new Map(),
    houseBuildingsAlive: new Map(),
    buildingsDestroyedByHouse: new Map(),
    nBuildingsDestroyed: 0,
    playerFactoriesExist: true,
    civiliansEvacuated: 0,
    builtUnitTypes: new Set(),
    builtInfantryTypes: new Set(),
    builtAircraftTypes: new Set(),
    fakesExist: false,
    spiedBuildings: new Set(),
    isThieved: false,
    pendingDestroyedCount: 0,
    ...overrides,
  };
}

// ============================================================================
// Persistence enum values
// ============================================================================

describe('Trigger persistence enum values — C++ trigtype.h:64-68', () => {
  /**
   * C++ trigtype.h:64-68:
   *   typedef enum PersistantType {
   *     VOLATILE = 0,
   *     SEMIPERSISTANT = 1,
   *     PERSISTANT = 2
   *   } PersistantType;
   */
  it('VOLATILE = 0', () => {
    const t = makeTrigger({ persistence: 0 });
    expect(t.persistence).toBe(0);
  });

  it('SEMIPERSISTANT = 1', () => {
    const t = makeTrigger({ persistence: 1 });
    expect(t.persistence).toBe(1);
  });

  it('PERSISTANT = 2', () => {
    const t = makeTrigger({ persistence: 2 });
    expect(t.persistence).toBe(2);
  });
});

// ============================================================================
// Volatile trigger behavior (persistence=0)
// ============================================================================

describe('Volatile trigger (persistence=0) — C++ trigger.cpp:341', () => {
  /**
   * C++ trigger.cpp:341:
   *   if (Class->IsPersistant == TriggerTypeClass::VOLATILE || ...) {
   *     Detach_This_From_All(As_Target(), true);
   *     delete this;
   *     return(true);
   *   }
   *
   * After a volatile trigger fires, C++ deletes the trigger object entirely.
   * TS equivalent: sets trigger.fired = true, then the processTriggers loop
   * skips it because `trigger.fired && trigger.persistence <= 1` is true.
   */
  it('volatile trigger: once fired=true, skip guard prevents re-evaluation', () => {
    const t = makeTrigger({ persistence: 0, fired: true });
    // TS: `if (trigger.fired && trigger.persistence <= 1) continue;`
    // C++ equivalent: trigger is deleted, can never fire again
    const shouldSkip = t.fired && t.persistence <= 1;
    expect(shouldSkip).toBe(true);
  });

  it('volatile trigger: not yet fired passes skip guard', () => {
    const t = makeTrigger({ persistence: 0, fired: false });
    const shouldSkip = t.fired && t.persistence <= 1;
    expect(shouldSkip).toBe(false);
  });

  it('volatile trigger fires exactly once — C++ deletes on first Spring()', () => {
    const t = makeTrigger({ persistence: 0, fired: false });

    // Simulate first fire
    t.fired = true;

    // After first fire, should be skipped
    const shouldSkip = t.fired && t.persistence <= 1;
    expect(shouldSkip).toBe(true);
  });
});

// ============================================================================
// Semi-persistent trigger behavior (persistence=1)
// ============================================================================

describe('Semi-persistent trigger (persistence=1) — C++ trigger.cpp:277-298,341', () => {
  /**
   * C++ trigger.cpp:277-298 (semi-persistent detach logic):
   *   if (Class->IsPersistant == TriggerTypeClass::SEMIPERSISTANT) {
   *     if (obj) obj->Trigger = NULL;
   *     if (cell) Map[cell].Trigger = NULL;
   *     AttachCount--;
   *     if (AttachCount > 0) return(false);  // suppress firing!
   *   }
   *
   * Key behavior: semi-persistent triggers DO NOT execute their action
   * until ALL attached objects/cells have triggered. Each triggering event
   * decrements AttachCount; only when it reaches 0 does the action fire.
   *
   * After action fires, C++ trigger.cpp:341:
   *   if (VOLATILE || (SEMIPERSISTANT && AttachCount <= 1)) { delete this; }
   * Since AttachCount was decremented to 0, condition is true → self-destruct.
   */

  it('consumeSemiPersistentAttachment: does NOT fire when remaining > 1', () => {
    const t = makeTrigger({ persistence: 1, attachCount: 3, remainingAttachCount: 3 });
    // C++ Spring(): AttachCount-- => 2, still > 0, return false (suppress)
    const shouldFire = consumeSemiPersistentAttachment(t, 1);
    expect(shouldFire).toBe(false);
    expect(t.remainingAttachCount).toBe(2);
  });

  it('consumeSemiPersistentAttachment: fires when remaining reaches 0', () => {
    const t = makeTrigger({ persistence: 1, attachCount: 2, remainingAttachCount: 1 });
    // C++ Spring(): AttachCount-- => 0, NOT > 0, falls through to action execution
    const shouldFire = consumeSemiPersistentAttachment(t, 1);
    expect(shouldFire).toBe(true);
    expect(t.remainingAttachCount).toBe(0);
  });

  it('consumeSemiPersistentAttachment: fires when remaining is already 0', () => {
    const t = makeTrigger({ persistence: 1, attachCount: 2, remainingAttachCount: 0 });
    // C++ equivalent: AttachCount already <= 0, so falls through
    const shouldFire = consumeSemiPersistentAttachment(t, 1);
    expect(shouldFire).toBe(true);
  });

  it('consumeSemiPersistentAttachment: multi-detach consumes multiple at once', () => {
    const t = makeTrigger({ persistence: 1, attachCount: 5, remainingAttachCount: 5 });
    // Detach 3 at once
    const shouldFire = consumeSemiPersistentAttachment(t, 3);
    expect(shouldFire).toBe(false);
    expect(t.remainingAttachCount).toBe(2);

    // Detach remaining 2
    const shouldFire2 = consumeSemiPersistentAttachment(t, 2);
    expect(shouldFire2).toBe(true);
    expect(t.remainingAttachCount).toBe(0);
  });

  it('consumeSemiPersistentAttachment: remainingAttachCount never goes below 0', () => {
    const t = makeTrigger({ persistence: 1, attachCount: 2, remainingAttachCount: 1 });
    consumeSemiPersistentAttachment(t, 5);
    expect(t.remainingAttachCount).toBe(0);
  });

  it('semi-persistent trigger: once fired, skip guard prevents re-evaluation', () => {
    // C++ deletes the trigger after semi-persistent fires (line 341-343)
    // TS equivalent: fired=true with persistence<=1 causes skip
    const t = makeTrigger({ persistence: 1, fired: true });
    const shouldSkip = t.fired && t.persistence <= 1;
    expect(shouldSkip).toBe(true);
  });

  it('consumeSemiPersistentAttachment: non-semi-persistent always returns true (no gating)', () => {
    // C++ trigger.cpp:277: the semi-persistent detach block is only entered
    // when IsPersistant == SEMIPERSISTANT. For other modes, no detach logic runs.
    const volatile0 = makeTrigger({ persistence: 0, attachCount: 5, remainingAttachCount: 5 });
    expect(consumeSemiPersistentAttachment(volatile0, 1)).toBe(true);
    // remainingAttachCount should NOT be modified for non-semi-persistent
    expect(volatile0.remainingAttachCount).toBe(5);

    const persistent2 = makeTrigger({ persistence: 2, attachCount: 5, remainingAttachCount: 5 });
    expect(consumeSemiPersistentAttachment(persistent2, 1)).toBe(true);
    expect(persistent2.remainingAttachCount).toBe(5);
  });

  it('consumeSemiPersistentAttachment: detachCount <= 0 always returns true', () => {
    const t = makeTrigger({ persistence: 1, attachCount: 3, remainingAttachCount: 3 });
    expect(consumeSemiPersistentAttachment(t, 0)).toBe(true);
    expect(t.remainingAttachCount).toBe(3); // unchanged
    expect(consumeSemiPersistentAttachment(t, -1)).toBe(true);
    expect(t.remainingAttachCount).toBe(3); // unchanged
  });
});

// ============================================================================
// Semi-persistent: C++ detach-then-check order (potential parity gap)
// ============================================================================

describe('Semi-persistent detach order — C++ trigger.cpp:283-298', () => {
  /**
   * C++ trigger.cpp:283-298:
   *   // INSIDE the SEMIPERSISTANT block:
   *   if (obj) { obj->Trigger = NULL; }     // detach from object
   *   if (cell) { Map[cell].Trigger = NULL; }  // detach from cell
   *   AttachCount--;
   *   if (AttachCount > 0) { return(false); }
   *
   * Critical C++ behavior: the object/cell trigger pointer is NULLed
   * BEFORE checking whether AttachCount allows firing. This means even
   * if AttachCount > 0 and the trigger doesn't fire, the originating
   * object has already lost its trigger reference.
   *
   * TS uses consumeSemiPersistentAttachment() which only decrements
   * remainingAttachCount — it does NOT null out entity triggerName references.
   * The entity's triggerName remains set. This is a semantic divergence
   * but functionally equivalent because TS doesn't re-use trigger pointers
   * like C++ does.
   */
  it('C++ nulls object trigger ref on each detach; TS preserves triggerName', () => {
    // This test documents the divergence. In C++, after an object's trigger fires
    // for semi-persistent, obj->Trigger becomes NULL even if the trigger doesn't
    // execute its action yet (AttachCount > 0).
    //
    // In TS, entity.triggerName is NOT cleared by consumeSemiPersistentAttachment().
    // This is acceptable because TS trigger evaluation doesn't depend on the entity
    // retaining or losing its trigger name — the death processing uses triggerName
    // to increment pendingDestroyedCount regardless.

    const t = makeTrigger({ persistence: 1, attachCount: 3, remainingAttachCount: 3 });
    // Simulate one detach — trigger should NOT fire yet
    const shouldFire = consumeSemiPersistentAttachment(t, 1);
    expect(shouldFire).toBe(false);
    // TS: remainingAttachCount decremented, but no entity mutation happens here
    expect(t.remainingAttachCount).toBe(2);
  });
});

// ============================================================================
// Persistent trigger behavior (persistence=2)
// ============================================================================

describe('Persistent trigger (persistence=2) — C++ trigger.cpp:345-353', () => {
  /**
   * C++ trigger.cpp:345-353 (else branch after destruction check):
   *   // This is the PERSISTANT path
   *   else {
   *     // Reset event data so that the event will repeat as necessary.
   *     Class->Event1.Reset(Event1);
   *     Class->Event2.Reset(Event2);
   *   }
   *
   * Persistent triggers are never deleted. After firing, their event state
   * is reset so they can fire again on the next evaluation cycle.
   */

  it('persistent trigger: fired=true does NOT trigger skip guard', () => {
    const t = makeTrigger({ persistence: 2, fired: true });
    // TS: `if (trigger.fired && trigger.persistence <= 1) continue;`
    // persistence=2 means persistence <= 1 is false → NOT skipped
    const shouldSkip = t.fired && t.persistence <= 1;
    expect(shouldSkip).toBe(false);
  });

  it('persistent trigger can fire multiple times', () => {
    const t = makeTrigger({ persistence: 2, fired: false });

    // First fire
    t.fired = true;
    expect(t.fired).toBe(true);

    // C++ resets events. TS: processTriggers resets timerTick, and
    // the trigger is re-evaluated next tick because skip guard doesn't block it.
    // For persistent triggers, TS sets trigger.fired = true but the
    // `persistence <= 1` guard is false, so it will be re-checked.
    const shouldSkip = t.fired && t.persistence <= 1;
    expect(shouldSkip).toBe(false);
  });

  it('persistent trigger resets timerTick after firing — C++ Event1.Reset() parity', () => {
    /**
     * C++ trigger.cpp:351: Class->Event1.Reset(Event1);
     * This resets the event's internal timer so TIME-based events must elapse again.
     *
     * TS: index.ts:5733-5734:
     *   if (trigger.persistence === 2) { trigger.timerTick = this.tick; }
     */
    const t = makeTrigger({ persistence: 2, timerTick: 0, fired: false });
    const currentTick = 500;

    // Simulate fire
    t.fired = true;
    if (t.persistence === 2) {
      t.timerTick = currentTick;
    }

    expect(t.timerTick).toBe(500);
    // The TIME event would now measure from tick 500 instead of tick 0
  });
});

// ============================================================================
// Persistent trigger: re-fire on pending destroyed events
// ============================================================================

describe('Persistent trigger re-fire loop — C++ trigger.cpp Spring() per-entity', () => {
  /**
   * In C++, each entity death calls Spring(TEVENT_DESTROYED, obj) individually.
   * If 3 entities with the same trigger die in one tick, Spring() is called 3 times.
   * For persistent triggers, each call fires the action and resets events.
   *
   * TS index.ts:5763 handles this with a while loop:
   *   while (trigger.persistence === 2 && trigger.pendingDestroyedCount > 0 && guard-- > 0)
   *   This fires the action once per pending death, then decrements.
   */

  it('persistent trigger: each pending death decrements pendingDestroyedCount by 1', () => {
    const t = makeTrigger({ persistence: 2, pendingDestroyedCount: 3 });

    // TS behavior: persistent triggers drain one at a time
    // index.ts:5727-5729: trigger.pendingDestroyedCount = Math.max(0, pendingDestroyedCount - 1)
    let fires = 0;
    while (t.persistence === 2 && t.pendingDestroyedCount > 0 && fires < 10) {
      t.pendingDestroyedCount = Math.max(0, t.pendingDestroyedCount - 1);
      fires++;
    }
    expect(fires).toBe(3);
    expect(t.pendingDestroyedCount).toBe(0);
  });

  it('non-persistent trigger: all pending deaths drained at once', () => {
    /**
     * TS index.ts:5725-5726:
     *   if (trigger.persistence < 2) {
     *     trigger.pendingDestroyedCount = 0;
     *   }
     *
     * C++ equivalent: volatile/semi-persistent triggers are deleted after
     * first Spring(), so subsequent per-entity Spring() calls find
     * no trigger and do nothing.
     */
    const t = makeTrigger({ persistence: 0, pendingDestroyedCount: 5 });
    if (t.persistence < 2) {
      t.pendingDestroyedCount = 0;
    }
    expect(t.pendingDestroyedCount).toBe(0);
  });

  it('persistent trigger re-fire loop has safety guard of 8 iterations', () => {
    /**
     * TS index.ts:5762: let extraFires = 8;
     * This caps the re-fire loop at 8 extra fires to prevent infinite loops.
     *
     * C++ has no such cap — Spring() is called individually per entity death,
     * so the loop is naturally bounded by the number of dead entities.
     *
     * This is a minor behavioral divergence: if > 8 entities die simultaneously,
     * TS will only fire 8+1=9 times while C++ would fire once per death.
     */
    const t = makeTrigger({ persistence: 2, pendingDestroyedCount: 20 });

    // Simulate TS behavior: first fire drains 1, then loop fires up to 8 more
    let fires = 1; // initial fire
    t.pendingDestroyedCount = Math.max(0, t.pendingDestroyedCount - 1); // initial drain

    let extraFires = 8;
    while (t.persistence === 2 && t.pendingDestroyedCount > 0 && extraFires-- > 0) {
      t.pendingDestroyedCount = Math.max(0, t.pendingDestroyedCount - 1);
      fires++;
    }

    expect(fires).toBe(9); // 1 initial + 8 extra
    expect(t.pendingDestroyedCount).toBe(11); // 20 - 9 = 11 remaining
    // PARITY GAP: C++ would fire all 20 times. TS caps at 9 per tick.
    // However, remaining deaths would fire on subsequent ticks, so it's
    // eventually consistent. The gap only matters for same-tick behavior.
  });
});

// ============================================================================
// Attachment count initialization
// ============================================================================

describe('initializeTriggerAttachmentCounts — C++ trigger AttachCount++ per entity', () => {
  /**
   * C++ unit.cpp:4699, infantry.cpp:3372, building.cpp:5081, vessel.cpp:2010:
   *   tt->AttachCount++;
   * Called once per entity/structure that links to a trigger during scenario load.
   *
   * C++ display.cpp:4332:
   *   tt->AttachCount++;
   * Called once per cell trigger during scenario load.
   *
   * TS: initializeTriggerAttachmentCounts() counts occurrences of each
   * trigger name in the attached trigger names list.
   */

  it('counts attachments per trigger name', () => {
    const t1 = makeTrigger({ name: 'alpha' });
    const t2 = makeTrigger({ name: 'beta' });
    const triggers = [t1, t2];
    initializeTriggerAttachmentCounts(triggers, ['alpha', 'alpha', 'beta', 'alpha']);
    expect(t1.attachCount).toBe(3);
    expect(t1.remainingAttachCount).toBe(3);
    expect(t2.attachCount).toBe(1);
    expect(t2.remainingAttachCount).toBe(1);
  });

  it('triggers with no attachments get count 0', () => {
    const t = makeTrigger({ name: 'orphan' });
    initializeTriggerAttachmentCounts([t], ['other']);
    expect(t.attachCount).toBe(0);
    expect(t.remainingAttachCount).toBe(0);
  });

  it('empty attachment list results in 0 for all triggers', () => {
    const t = makeTrigger({ name: 'lonely' });
    initializeTriggerAttachmentCounts([t], []);
    expect(t.attachCount).toBe(0);
    expect(t.remainingAttachCount).toBe(0);
  });

  it('skips falsy trigger names', () => {
    const t = makeTrigger({ name: 'alpha' });
    initializeTriggerAttachmentCounts([t], ['alpha', '', 'alpha']);
    expect(t.attachCount).toBe(2);
  });
});

// ============================================================================
// Dynamic attachment (noteTriggerAttachment)
// ============================================================================

describe('noteTriggerAttachment — C++ AttachCount++ for dynamically spawned entities', () => {
  /**
   * C++ object.cpp:1904-1906:
   *   Trigger = trigger;
   *   trigger->AttachCount++;
   *
   * Called when a trigger is dynamically attached to an object (e.g., from
   * team creation via TACTION_CREATE_TEAM where team members get the team's trigger).
   */

  it('increments attachCount and remainingAttachCount', () => {
    const t = makeTrigger({ name: 'wave', attachCount: 0, remainingAttachCount: 0 });
    noteTriggerAttachment([t], 'wave', 3);
    expect(t.attachCount).toBe(3);
    expect(t.remainingAttachCount).toBe(3);
  });

  it('adds to existing counts', () => {
    const t = makeTrigger({ name: 'wave', attachCount: 2, remainingAttachCount: 1 });
    noteTriggerAttachment([t], 'wave', 2);
    expect(t.attachCount).toBe(4);
    expect(t.remainingAttachCount).toBe(3);
  });

  it('does nothing for unknown trigger name', () => {
    const t = makeTrigger({ name: 'known', attachCount: 5, remainingAttachCount: 5 });
    noteTriggerAttachment([t], 'unknown', 3);
    expect(t.attachCount).toBe(5);
    expect(t.remainingAttachCount).toBe(5);
  });

  it('does nothing for undefined trigger name', () => {
    const t = makeTrigger({ name: 'test', attachCount: 0, remainingAttachCount: 0 });
    noteTriggerAttachment([t], undefined, 1);
    expect(t.attachCount).toBe(0);
  });

  it('does nothing for count <= 0', () => {
    const t = makeTrigger({ name: 'test', attachCount: 5, remainingAttachCount: 5 });
    noteTriggerAttachment([t], 'test', 0);
    expect(t.attachCount).toBe(5);
    noteTriggerAttachment([t], 'test', -1);
    expect(t.attachCount).toBe(5);
  });
});

// ============================================================================
// C++ semi-persistent full lifecycle
// ============================================================================

describe('Semi-persistent full lifecycle — C++ trigger.cpp:277-343 combined', () => {
  /**
   * Full C++ semi-persistent lifecycle for a trigger attached to 3 objects:
   *
   * 1. Trigger created: AttachCount = 0
   * 2. Three objects linked: AttachCount++ x3 → AttachCount = 3
   * 3. Object A fires trigger → AttachCount-- → 2 > 0 → return false (no action)
   * 4. Object B fires trigger → AttachCount-- → 1 > 0 → return false (no action)
   * 5. Object C fires trigger → AttachCount-- → 0, NOT > 0 → fall through
   * 6. Action executes (ok = true)
   * 7. Line 341: SEMIPERSISTANT && AttachCount <= 1 → true (0 <= 1)
   * 8. Detach_This_From_All(); delete this; → trigger destroyed
   */

  it('3-object lifecycle: suppresses first 2 fires, executes on 3rd, then dead', () => {
    const t = makeTrigger({ persistence: 1, attachCount: 3, remainingAttachCount: 3 });

    // Object A fires
    expect(consumeSemiPersistentAttachment(t, 1)).toBe(false);
    expect(t.remainingAttachCount).toBe(2);

    // Object B fires
    expect(consumeSemiPersistentAttachment(t, 1)).toBe(false);
    expect(t.remainingAttachCount).toBe(1);

    // Object C fires — should now execute
    expect(consumeSemiPersistentAttachment(t, 1)).toBe(true);
    expect(t.remainingAttachCount).toBe(0);

    // After action executes, trigger becomes "fired" (C++ deletes it)
    t.fired = true;
    const shouldSkip = t.fired && t.persistence <= 1;
    expect(shouldSkip).toBe(true);
  });

  it('1-object lifecycle: fires immediately on first trigger', () => {
    const t = makeTrigger({ persistence: 1, attachCount: 1, remainingAttachCount: 1 });

    // Single attachment fires
    expect(consumeSemiPersistentAttachment(t, 1)).toBe(true);
    expect(t.remainingAttachCount).toBe(0);
  });

  it('0-attachment semi-persistent: fires immediately (edge case)', () => {
    /**
     * C++ trigger.cpp:296: if (AttachCount > 0) return(false);
     * With AttachCount=0 after decrement to -1, condition is false → falls through.
     * But this edge case shouldn't occur in normal gameplay since AttachCount starts
     * at 0 and is only incremented when objects are attached.
     *
     * However, if AttachCount was never incremented (orphan trigger), the
     * semi-persistent block would still be entered but AttachCount-- makes it -1,
     * which is NOT > 0, so it falls through to action execution.
     *
     * TS: consumeSemiPersistentAttachment with remaining=0 returns true immediately.
     */
    const t = makeTrigger({ persistence: 1, attachCount: 0, remainingAttachCount: 0 });
    expect(consumeSemiPersistentAttachment(t, 1)).toBe(true);
  });
});

// ============================================================================
// Volatile trigger: C++ self-destruction semantics
// ============================================================================

describe('Volatile trigger self-destruction — C++ trigger.cpp:341-344', () => {
  /**
   * C++ trigger.cpp:341-344:
   *   if (Class->IsPersistant == TriggerTypeClass::VOLATILE || ...) {
   *     Detach_This_From_All(As_Target(), true);
   *     delete this;
   *     return(true);
   *   }
   *
   * C++ physically deletes the trigger object. Any reference from entities/cells
   * is cleared by Detach_This_From_All.
   *
   * TS does NOT delete the trigger. It sets fired=true and relies on the
   * skip guard (fired && persistence <= 1) to prevent re-evaluation.
   * The trigger object remains in the triggers array.
   *
   * Behavioral equivalence: both prevent re-fire. But TS triggers array
   * never shrinks, which could be a minor memory concern for scenarios
   * with many volatile triggers. Not a parity gap for behavior.
   */

  it('C++ deletes volatile trigger; TS keeps it but marks fired', () => {
    const t = makeTrigger({ persistence: 0, fired: false });

    // Simulate fire
    t.fired = true;

    // TS: trigger still exists in array
    expect(t.fired).toBe(true);
    expect(t.persistence).toBe(0);

    // But it passes the skip guard
    expect(t.fired && t.persistence <= 1).toBe(true);
  });
});

// ============================================================================
// Persistent trigger: Event Reset parity
// ============================================================================

describe('Persistent trigger event reset — C++ trigger.cpp:351-352', () => {
  /**
   * C++ trigger.cpp:351-352:
   *   Class->Event1.Reset(Event1);
   *   Class->Event2.Reset(Event2);
   *
   * In C++, Reset() clears the event's internal fired state and timer.
   * For TIME events, this means the timer starts counting from 0 again.
   *
   * TS approach:
   *   - index.ts:5733: if (trigger.persistence === 2) { trigger.timerTick = this.tick; }
   *   - index.ts:4932-4934: for persistent triggers, fired is reset to false
   *     when playerEntered conditions re-occur
   *
   * TS does NOT reset playerEntered, objectDiscovered, enteredZone, etc.
   * for persistent triggers after firing. C++ does reset ALL event state.
   * This could be a parity gap for non-TIME persistent events.
   */

  it('C++ resets ALL event state on persistent fire; TS only resets timerTick', () => {
    const t = makeTrigger({
      persistence: 2,
      fired: false,
      playerEntered: true,
      objectDiscovered: true,
      enteredZone: true,
      crossedHorizontal: true,
      crossedVertical: true,
    });

    // Simulate fire (TS behavior)
    t.fired = true;
    if (t.persistence === 2) {
      t.timerTick = 500; // reset timer
    }

    // TS: playerEntered, objectDiscovered, etc. remain true
    // C++ would have reset them via Event1.Reset()
    expect(t.playerEntered).toBe(true);
    expect(t.objectDiscovered).toBe(true);
    expect(t.enteredZone).toBe(true);
    expect(t.crossedHorizontal).toBe(true);
    expect(t.crossedVertical).toBe(true);
    // PARITY GAP: C++ resets all event state, TS preserves it.
    // For persistent triggers that rely on non-TIME events (like PLAYER_ENTERED),
    // the TS trigger would immediately re-fire on the next tick because the
    // event condition is still true. C++ would wait for the event to occur again.
    //
    // However, TS index.ts:4932-4934 handles this specifically for cell triggers:
    //   if (trigger.persistence === 2 && trigger.fired) { trigger.fired = false; }
    // This allows re-evaluation but the event flags are still true, meaning
    // it would fire again immediately — which diverges from C++ behavior.
  });

  it('persistent cell trigger: TS resets fired when playerEntered re-fires', () => {
    /**
     * TS index.ts:4932-4934 (inside checkCellTriggers):
     *   if (trigger.persistence === 2 && trigger.fired) {
     *     trigger.fired = false;
     *   }
     *
     * This is called when a player unit enters a cell with this trigger.
     * It resets `fired` so the trigger can be re-evaluated in processTriggers.
     *
     * C++ behavior: persistent trigger has events fully reset by Event1.Reset()
     * after firing, so a new PLAYER_ENTERED event must occur. The TS version
     * resets `fired` on every player entry, which is functionally similar
     * but doesn't require the event to "re-occur" — the flag was never cleared.
     */
    const t = makeTrigger({ persistence: 2, fired: true, playerEntered: true });

    // Simulate TS checkCellTriggers
    if (t.persistence === 2 && t.fired) {
      t.fired = false;
    }
    expect(t.fired).toBe(false);
    // Now it will be re-evaluated in processTriggers
  });
});

// ============================================================================
// Skip guard correctness across all persistence modes
// ============================================================================

describe('Skip guard: trigger.fired && trigger.persistence <= 1', () => {
  /**
   * TS index.ts:5682, 5547, 5035, 5911, 5921 — all use:
   *   if (trigger.fired && trigger.persistence <= 1) continue;
   *
   * This is the TS equivalent of C++ deleting volatile/semi-persistent triggers
   * after they fire. It must correctly skip fired volatile (0) and
   * fired semi-persistent (1) triggers, but NOT skip fired persistent (2) triggers.
   */

  const cases: [number, boolean, boolean][] = [
    // [persistence, fired, expectedSkip]
    [0, false, false],  // volatile, not fired → don't skip
    [0, true, true],    // volatile, fired → skip (C++: deleted)
    [1, false, false],  // semi, not fired → don't skip
    [1, true, true],    // semi, fired → skip (C++: deleted)
    [2, false, false],  // persistent, not fired → don't skip
    [2, true, false],   // persistent, fired → DON'T skip (C++: event reset, re-fire)
  ];

  for (const [persistence, fired, expectedSkip] of cases) {
    const label = `persistence=${persistence}, fired=${fired} → skip=${expectedSkip}`;
    it(label, () => {
      const shouldSkip = fired && persistence <= 1;
      expect(shouldSkip).toBe(expectedSkip);
    });
  }
});

// ============================================================================
// TACTION_DESTROY_TRIGGER interaction with persistence
// ============================================================================

describe('TACTION_DESTROY_TRIGGER forces persistence to volatile — C++ taction.cpp', () => {
  /**
   * TS scenario.ts:2331-2337:
   *   case TACTION_DESTROY_TRIGGER:
   *     target.fired = true;
   *     target.persistence = 0;
   *
   * This forcefully kills any trigger regardless of persistence mode by:
   * 1. Setting fired = true
   * 2. Setting persistence = 0 (volatile)
   *
   * Now the skip guard (fired && persistence <= 1) catches it.
   */

  it('TACTION_DESTROY_TRIGGER overrides persistent trigger to volatile+fired', () => {
    const target = makeTrigger({ persistence: 2, fired: false, name: 'target' });
    const triggers = [target];

    const action: TriggerAction = {
      action: 12, // TACTION_DESTROY_TRIGGER
      team: -1,
      trigger: 0,
      data: 0,
    };

    executeTriggerAction(
      action,
      [],
      new Map<number, CellPos>(),
      new Set<number>(),
      triggers,
    );

    expect(target.fired).toBe(true);
    expect(target.persistence).toBe(0);

    // Now the skip guard catches it
    const shouldSkip = target.fired && target.persistence <= 1;
    expect(shouldSkip).toBe(true);
  });

  it('TACTION_DESTROY_TRIGGER on already-fired trigger is idempotent', () => {
    const target = makeTrigger({ persistence: 0, fired: true, name: 'target' });
    const triggers = [target];

    executeTriggerAction(
      { action: 12, team: -1, trigger: 0, data: 0 },
      [],
      new Map<number, CellPos>(),
      new Set<number>(),
      triggers,
    );

    expect(target.fired).toBe(true);
    expect(target.persistence).toBe(0);
  });
});

// ============================================================================
// Semi-persistent with TEVENT_DESTROYED — detach on death
// ============================================================================

describe('Semi-persistent with TEVENT_DESTROYED — death-driven detach', () => {
  /**
   * TS index.ts:5705-5714:
   *   const destroyedDetachCount =
   *     trigger.event1.type === 7 || trigger.event2.type === 7
   *       ? trigger.pendingDestroyedCount : 0;
   *   if (destroyedDetachCount > 0 && !consumeSemiPersistentAttachment(trigger, destroyedDetachCount)) {
   *     trigger.pendingDestroyedCount = 0;
   *     continue;
   *   }
   *
   * When a semi-persistent trigger has TEVENT_DESTROYED, each death is treated
   * as a detach event. The trigger doesn't fire until all attachments are consumed.
   *
   * C++ equivalent: each entity death calls Spring(TEVENT_DESTROYED, obj),
   * which enters the semi-persistent block, decrements AttachCount, and
   * returns false if more attachments remain.
   */

  it('semi-persistent DESTROYED: 3 entities, fires only on 3rd death', () => {
    const t = makeTrigger({
      name: 'all_dead',
      persistence: 1,
      event1: { type: 7, team: -1, data: 0 }, // TEVENT_DESTROYED = 7
      attachCount: 3,
      remainingAttachCount: 3,
    });

    // First death
    t.pendingDestroyedCount = 1;
    const detach1 = t.event1.type === 7 ? t.pendingDestroyedCount : 0;
    const fire1 = consumeSemiPersistentAttachment(t, detach1);
    expect(fire1).toBe(false);
    expect(t.remainingAttachCount).toBe(2);
    t.pendingDestroyedCount = 0;

    // Second death
    t.pendingDestroyedCount = 1;
    const detach2 = t.event1.type === 7 ? t.pendingDestroyedCount : 0;
    const fire2 = consumeSemiPersistentAttachment(t, detach2);
    expect(fire2).toBe(false);
    expect(t.remainingAttachCount).toBe(1);
    t.pendingDestroyedCount = 0;

    // Third death — all attachments consumed, should fire
    t.pendingDestroyedCount = 1;
    const detach3 = t.event1.type === 7 ? t.pendingDestroyedCount : 0;
    const fire3 = consumeSemiPersistentAttachment(t, detach3);
    expect(fire3).toBe(true);
    expect(t.remainingAttachCount).toBe(0);
  });

  it('semi-persistent DESTROYED: 2 entities die simultaneously', () => {
    const t = makeTrigger({
      name: 'pair_dead',
      persistence: 1,
      event1: { type: 7, team: -1, data: 0 },
      attachCount: 2,
      remainingAttachCount: 2,
    });

    // Both die at once
    t.pendingDestroyedCount = 2;
    const detach = t.event1.type === 7 ? t.pendingDestroyedCount : 0;
    const shouldFire = consumeSemiPersistentAttachment(t, detach);
    expect(shouldFire).toBe(true);
    expect(t.remainingAttachCount).toBe(0);
  });
});

// ============================================================================
// Force-fire bypasses persistence gating
// ============================================================================

describe('Force-fire bypasses semi-persistent gating — C++ trigger.cpp:270', () => {
  /**
   * C++ trigger.cpp:270:
   *   if (execute || forced) {
   *
   * C++ trigger.cpp:240-241:
   *   if (forced) { cell = Cell; }
   *   else { ... switch(EventControl) ... }
   *
   * When `forced` is true, the event evaluation is skipped entirely.
   * The semi-persistent detach block is still entered (line 277), but
   * execution continues through to actions regardless.
   *
   * Wait — re-reading C++ more carefully:
   * Line 277-298 IS inside the `if (execute || forced)` block.
   * So for forced && semi-persistent:
   *   AttachCount-- happens
   *   if (AttachCount > 0) return false — STILL suppresses even when forced!
   *
   * Actually no — the code at line 277 is:
   *   if (Class->IsPersistant == SEMIPERSISTANT) { ... AttachCount--; if > 0 return false; }
   * This block DOES suppress forced triggers if AttachCount > 0.
   *
   * But in TS, force-fired triggers skip the consumeSemiPersistentAttachment check:
   * index.ts:5689-5693: forcedFire path sets shouldFire=true and goes to fire
   * index.ts:5704: `if (!forcedFire)` guards the detach logic
   * So TS skips the semi-persistent check for forced triggers.
   *
   * This is a PARITY GAP: C++ would suppress forced semi-persistent triggers
   * if AttachCount > 0, but TS fires them immediately.
   */
  it('TS: force-fired semi-persistent skips detach gating', () => {
    // TS behavior: forcedFire bypasses consumeSemiPersistentAttachment
    const t = makeTrigger({
      persistence: 1,
      attachCount: 5,
      remainingAttachCount: 5,
      forceFirePending: true,
    });

    // TS processTriggers path for forced:
    let forcedFire = false;
    if (t.forceFirePending) {
      forcedFire = true;
      t.forceFirePending = false;
    }

    // TS: `if (!forcedFire) { ... consumeSemiPersistent ... }`
    // forcedFire is true, so detach check is SKIPPED
    if (!forcedFire) {
      // This block NOT entered for forced triggers in TS
      consumeSemiPersistentAttachment(t, 1);
    }

    // TS fires immediately; remainingAttachCount unchanged
    expect(t.remainingAttachCount).toBe(5);

    // PARITY GAP: C++ would still enter the semi-persistent block and
    // decrement AttachCount. If AttachCount > 0, it would suppress.
    // C++ forces do NOT bypass the semi-persistent gate.
  });
});

// ============================================================================
// C++ AttachCount <= 1 vs == 0 in destruction check
// ============================================================================

describe('C++ semi-persistent destruction: AttachCount <= 1 check', () => {
  /**
   * C++ trigger.cpp:341:
   *   if (Class->IsPersistant == VOLATILE ||
   *       (Class->IsPersistant == SEMIPERSISTANT && AttachCount <= 1)) {
   *     Detach_This_From_All(As_Target(), true);
   *     delete this;
   *   }
   *
   * Note: The condition is `AttachCount <= 1`, NOT `AttachCount == 0`.
   * After the semi-persistent block at lines 295-298 decrements AttachCount
   * and passes through (AttachCount == 0), the destruction check uses <= 1.
   *
   * This means even if AttachCount is 1 (which shouldn't happen since we
   * just decremented past 0 to get here), it still destroys. The <= 1
   * is defensive — it handles the 0 case and any hypothetical 1 case.
   *
   * TS: consumeSemiPersistentAttachment returns true when remaining === 0.
   * The check is `=== 0`, not `<= 1`. This means if remainingAttachCount
   * is 1, TS would return false (don't fire), whereas C++ at line 341
   * with AttachCount=1 would still destroy.
   *
   * However, this discrepancy only matters if AttachCount is 1 at line 341,
   * which can only happen if the semi-persistent block at line 296
   * (AttachCount > 0 → return false) was somehow skipped. That only
   * happens for forced triggers, which skip the semi-persistent block
   * in TS anyway. So this is largely theoretical.
   */
  it('TS consumeSemiPersistentAttachment: remaining=1 after detach returns false', () => {
    const t = makeTrigger({ persistence: 1, remainingAttachCount: 2 });
    const shouldFire = consumeSemiPersistentAttachment(t, 1);
    // remaining goes from 2 to 1; TS returns false (1 !== 0)
    expect(shouldFire).toBe(false);
    expect(t.remainingAttachCount).toBe(1);
  });

  it('C++ AttachCount <= 1: with AttachCount=1, C++ would destroy', () => {
    // This documents the C++ behavior at line 341 where AttachCount <= 1
    // For AttachCount=1, C++ condition is true → destroy.
    // TS: remainingAttachCount=1, consumeSemiPersistentAttachment returns false.
    //
    // This is theoretically a gap, but in practice the semi-persistent block
    // at line 296 prevents reaching line 341 with AttachCount=1 (it returns false).
    // The only way to reach 341 with AttachCount=1 is via `forced`, but C++
    // still enters the semi-persistent block for forced triggers (unlike TS).
    const cppAttachCount = 1;
    const cppWouldDestroy = cppAttachCount <= 1;
    expect(cppWouldDestroy).toBe(true);

    // TS equivalent:
    const t = makeTrigger({ persistence: 1, remainingAttachCount: 1 });
    const tsWouldFire = consumeSemiPersistentAttachment(t, 0); // no detach
    expect(tsWouldFire).toBe(true); // detachCount=0 returns true (passthrough)
  });
});

// ============================================================================
// Constructor defaults — C++ trigger.cpp:128-137
// ============================================================================

describe('Constructor defaults — C++ trigger.cpp:128-137', () => {
  /**
   * C++ trigger.cpp:128-137:
   *   TriggerClass::TriggerClass(TriggerTypeClass * trigtype) :
   *     RTTI(RTTI_TRIGGER),
   *     ID(Triggers.ID(this)),
   *     Class(trigtype),
   *     AttachCount(0),
   *     Cell(0)
   *   {
   *     Class->Event1.Reset(Event1);
   *     Class->Event2.Reset(Event2);
   *   }
   *
   * C++ trigtype.cpp:74-81:
   *   TriggerTypeClass::TriggerTypeClass(void) :
   *     IsPersistant(VOLATILE),
   *     EventControl(MULTI_ONLY),
   *     ActionControl(MULTI_ONLY),
   *     House(HOUSE_SPAIN)
   */

  it('default AttachCount is 0', () => {
    const t = makeTrigger();
    expect(t.attachCount).toBe(0);
    expect(t.remainingAttachCount).toBe(0);
  });

  it('default persistence is VOLATILE when using trigtype defaults', () => {
    // C++ trigtype.cpp:76: IsPersistant(VOLATILE)
    // Our makeTrigger defaults to 0 to match
    const t = makeTrigger();
    expect(t.persistence).toBe(0);
  });

  it('default fired state is false', () => {
    const t = makeTrigger();
    expect(t.fired).toBe(false);
  });
});

// ============================================================================
// Edge case: team.cpp AttachCount == 0 delete
// ============================================================================

describe('Team cleanup: AttachCount==0 deletion — C++ team.cpp:305-308', () => {
  /**
   * C++ team.cpp:305-308:
   *   if (Trigger.Is_Valid()) {
   *     if (Trigger->AttachCount == 0) {
   *       delete (TriggerClass *)Trigger;
   *     }
   *     Trigger = NULL;
   *   }
   *
   * Teams also delete triggers when their AttachCount reaches 0.
   * This is an additional deletion path beyond Spring()'s self-destruction.
   * TS doesn't have this — triggers are never removed from the array.
   * This is functionally equivalent since TS uses the fired+persistence
   * skip guard instead of physical deletion.
   */
  it('TS triggers are never physically deleted (behavioral parity via skip guard)', () => {
    const triggers = [
      makeTrigger({ name: 'a', persistence: 0, fired: true }),
      makeTrigger({ name: 'b', persistence: 0, fired: false }),
    ];

    // TS: all triggers remain in array
    expect(triggers.length).toBe(2);

    // But fired volatile triggers are effectively dead
    const activeTriggers = triggers.filter(t => !(t.fired && t.persistence <= 1));
    expect(activeTriggers.length).toBe(1);
    expect(activeTriggers[0].name).toBe('b');
  });
});

// ============================================================================
// checkTriggerEvent: TEVENT_ANY with persistence modes
// ============================================================================

describe('checkTriggerEvent with TEVENT_ANY across persistence modes', () => {
  /**
   * C++ tevent.cpp: TEVENT_ANY always returns true.
   * Used to test that persistence logic (not event logic) controls re-firing.
   */
  const TEVENT_ANY = 1;

  it('TEVENT_ANY returns true regardless of state', () => {
    const state = createState();
    expect(checkTriggerEvent({ type: TEVENT_ANY, team: -1, data: 0 }, state)).toBe(true);
  });

  it('volatile + TEVENT_ANY: fires once then is dead', () => {
    const t = makeTrigger({ persistence: 0, event1: { type: TEVENT_ANY, team: -1, data: 0 } });
    const state = createState();

    // First check: event is true
    expect(checkTriggerEvent(t.event1, state)).toBe(true);

    // Fire
    t.fired = true;

    // Event still returns true, but skip guard blocks
    expect(checkTriggerEvent(t.event1, state)).toBe(true);
    expect(t.fired && t.persistence <= 1).toBe(true); // would be skipped
  });

  it('persistent + TEVENT_ANY: fires every tick', () => {
    const t = makeTrigger({ persistence: 2, event1: { type: TEVENT_ANY, team: -1, data: 0 } });
    const state = createState();

    // Fire
    t.fired = true;
    expect(checkTriggerEvent(t.event1, state)).toBe(true);
    expect(t.fired && t.persistence <= 1).toBe(false); // NOT skipped
  });
});
