/**
 * C++ Behavioral Parity Tests — Differentiated Trigger Events (#21)
 *
 * C++ source refs:
 *   TEVENT.H — enum TEventType (event type constants)
 *   tevent.cpp:220-466 — TEventClass::operator() (event evaluation logic)
 *   techno.cpp:776-792 — Revealed() fires TEVENT_DISCOVERED, sets House->IsDiscovered
 *   techno.cpp:3899 — Record_The_Kill() fires TEVENT_DISCOVERED
 *   foot.cpp:1406-1455 — PLAYER_ENTERED, CROSS_H/V, ENTERS_ZONE detection
 *
 * Issue: 5 trigger event types were all conflated to a single `playerEntered` flag.
 * C++ has distinct per-object/per-cell/per-zone/per-line triggering with house ownership checks.
 *
 * Events differentiated:
 *   TEVENT_DISCOVERED (4) — per-object: fires when attached object is first revealed
 *   TEVENT_HOUSE_DISCOVERED (5) — per-house: fires when house's IsDiscovered flag is set
 *   TEVENT_ENTERS_ZONE (24) — per-trigger: fires when matching-house unit enters trigger zone
 *   TEVENT_CROSS_HORIZONTAL (25) — per-trigger: fires when matching-house unit crosses Y row
 *   TEVENT_CROSS_VERTICAL (26) — per-trigger: fires when matching-house unit crosses X column
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

// ============================================================================
// Constants (from C++ TEVENT.H enum order)
// ============================================================================

const TEVENT_PLAYER_ENTERED = 1;
const TEVENT_DISCOVERED = 4;
const TEVENT_HOUSE_DISCOVERED = 5;
const TEVENT_ENTERS_ZONE = 24;
const TEVENT_CROSS_HORIZONTAL = 25;
const TEVENT_CROSS_VERTICAL = 26;

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal TriggerGameState with all required fields. */
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
    enemyUnitsAlive: 0,
    enemyKillCount: 0,
    playerFactories: 0,
    missionTimerExpired: false,
    bridgesAlive: 0,
    unitsLeftMap: 0,
    structureTypes: new Set(),

    structureTypesByHouse: new Map([[1, new Set<string>()]]),

    triggerHouse: 1,
    builtStructureTypes: new Set(),
    destroyedTriggerNames: new Set(),
    attackedTriggerNames: new Set(),
    houseAlive: new Map(),
    houseUnitsAlive: new Map(),
    houseBuildingsAlive: new Map(),
    isLowPower: false,
    playerCredits: 0,
    buildingsDestroyedByHouse: new Map(),
    nBuildingsDestroyed: 0,
    playerFactoriesExist: true,
    civiliansEvacuated: 0,
    builtUnitTypes: new Set(),
    builtInfantryTypes: new Set(),
    builtAircraftTypes: new Set(),
    fakesExist: true,
    spiedBuildings: new Set(),
    isThieved: false,
    pendingDestroyedCount: 0,
    ...overrides,
  };
}

function makeEvent(type: number, data = 0): TriggerEvent {
  return { type, team: -1, data };
}

// ============================================================================
// TEVENT_DISCOVERED (type=4)
// ============================================================================

describe('TEVENT_DISCOVERED (type=4) — C++ tevent.cpp:270-283, techno.cpp:786', () => {
  it('fires when objectDiscovered is true', () => {
    // C++ techno.cpp:786: Trigger->Spring(TEVENT_DISCOVERED, this) when object is revealed
    const state = createState({ objectDiscovered: true });
    expect(checkTriggerEvent(makeEvent(TEVENT_DISCOVERED), state)).toBe(true);
  });

  it('does NOT fire when objectDiscovered is false', () => {
    const state = createState({ objectDiscovered: false });
    expect(checkTriggerEvent(makeEvent(TEVENT_DISCOVERED), state)).toBe(false);
  });

  it('does NOT fire based on playerEntered alone', () => {
    // Previously, DISCOVERED was conflated with playerEntered.
    // After fix, playerEntered should NOT trigger DISCOVERED.
    const state = createState({ playerEntered: true, objectDiscovered: false });
    expect(checkTriggerEvent(makeEvent(TEVENT_DISCOVERED), state)).toBe(false);
  });

  it('fires independently of ENTERS_ZONE state', () => {
    // objectDiscovered=true, enteredZone=false => DISCOVERED fires, ENTERS_ZONE does not
    const state = createState({ objectDiscovered: true, enteredZone: false });
    expect(checkTriggerEvent(makeEvent(TEVENT_DISCOVERED), state)).toBe(true);
    expect(checkTriggerEvent(makeEvent(TEVENT_ENTERS_ZONE), state)).toBe(false);
  });

  it('event.data is ignored — only objectDiscovered matters', () => {
    // C++ tevent.cpp:270-283 — DISCOVERED gate check only requires event == TEVENT_DISCOVERED,
    // then falls through to return(true) at line 466. Data is not checked for DISCOVERED.
    for (const data of [0, 1, 42, -1]) {
      expect(checkTriggerEvent(makeEvent(TEVENT_DISCOVERED, data), createState({ objectDiscovered: true }))).toBe(true);
      expect(checkTriggerEvent(makeEvent(TEVENT_DISCOVERED, data), createState({ objectDiscovered: false }))).toBe(false);
    }
  });
});

// ============================================================================
// TEVENT_HOUSE_DISCOVERED (type=5)
// ============================================================================

describe('TEVENT_HOUSE_DISCOVERED (type=5) — C++ tevent.cpp:435-436', () => {
  it('fires when the specified house is discovered', () => {
    // C++ tevent.cpp:435-436: hptr = As_Pointer(Data.House), checks hptr->IsDiscovered
    // event.data is the RA house index (Data.House)
    const houseDiscovered = new Map([[2, true]]); // USSR (index 2) is discovered
    const state = createState({ houseDiscovered });
    expect(checkTriggerEvent(makeEvent(TEVENT_HOUSE_DISCOVERED, 2), state)).toBe(true);
  });

  it('does NOT fire when the specified house is NOT discovered', () => {
    const houseDiscovered = new Map<number, boolean>(); // no house discovered
    const state = createState({ houseDiscovered });
    expect(checkTriggerEvent(makeEvent(TEVENT_HOUSE_DISCOVERED, 2), state)).toBe(false);
  });

  it('checks the specific house from event.data, not a generic flag', () => {
    // USSR (2) discovered, but trigger asks about Spain (0)
    const houseDiscovered = new Map([[2, true]]);
    const state = createState({ houseDiscovered });
    expect(checkTriggerEvent(makeEvent(TEVENT_HOUSE_DISCOVERED, 0), state)).toBe(false);
    expect(checkTriggerEvent(makeEvent(TEVENT_HOUSE_DISCOVERED, 2), state)).toBe(true);
  });

  it('does NOT fire based on playerEntered', () => {
    // Previously conflated with playerEntered; now uses houseDiscovered map
    const state = createState({ playerEntered: true, houseDiscovered: new Map() });
    expect(checkTriggerEvent(makeEvent(TEVENT_HOUSE_DISCOVERED, 0), state)).toBe(false);
  });

  it('multiple houses can be independently discovered', () => {
    const houseDiscovered = new Map([[0, true], [2, true]]); // Spain + USSR
    const state = createState({ houseDiscovered });
    expect(checkTriggerEvent(makeEvent(TEVENT_HOUSE_DISCOVERED, 0), state)).toBe(true);
    expect(checkTriggerEvent(makeEvent(TEVENT_HOUSE_DISCOVERED, 1), state)).toBe(false); // Greece
    expect(checkTriggerEvent(makeEvent(TEVENT_HOUSE_DISCOVERED, 2), state)).toBe(true);
  });
});

// ============================================================================
// TEVENT_ENTERS_ZONE (type=24)
// ============================================================================

describe('TEVENT_ENTERS_ZONE (type=24) — C++ tevent.cpp:290-293, foot.cpp:1447-1455', () => {
  it('fires when enteredZone is true', () => {
    // C++ foot.cpp:1449-1451: checks zone membership, then calls Spring(TEVENT_ENTERS_ZONE, this)
    // C++ tevent.cpp:290-293: checks object->Owner() == Data.House
    const state = createState({ enteredZone: true });
    expect(checkTriggerEvent(makeEvent(TEVENT_ENTERS_ZONE), state)).toBe(true);
  });

  it('does NOT fire when enteredZone is false', () => {
    const state = createState({ enteredZone: false });
    expect(checkTriggerEvent(makeEvent(TEVENT_ENTERS_ZONE), state)).toBe(false);
  });

  it('does NOT fire based on playerEntered alone', () => {
    // Previously conflated; now uses enteredZone
    const state = createState({ playerEntered: true, enteredZone: false });
    expect(checkTriggerEvent(makeEvent(TEVENT_ENTERS_ZONE), state)).toBe(false);
  });

  it('fires independently of DISCOVERED', () => {
    const state = createState({ enteredZone: true, objectDiscovered: false });
    expect(checkTriggerEvent(makeEvent(TEVENT_ENTERS_ZONE), state)).toBe(true);
    expect(checkTriggerEvent(makeEvent(TEVENT_DISCOVERED), state)).toBe(false);
  });
});

// ============================================================================
// TEVENT_CROSS_HORIZONTAL (type=25)
// ============================================================================

describe('TEVENT_CROSS_HORIZONTAL (type=25) — C++ tevent.cpp:290-293, foot.cpp:1419-1428', () => {
  it('fires when crossedHorizontal is true', () => {
    // C++ foot.cpp:1419-1428: scans all cells in the Y row for CROSS_HORIZONTAL triggers
    const state = createState({ crossedHorizontal: true });
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_HORIZONTAL), state)).toBe(true);
  });

  it('does NOT fire when crossedHorizontal is false', () => {
    const state = createState({ crossedHorizontal: false });
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_HORIZONTAL), state)).toBe(false);
  });

  it('does NOT fire based on playerEntered alone', () => {
    const state = createState({ playerEntered: true, crossedHorizontal: false });
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_HORIZONTAL), state)).toBe(false);
  });

  it('fires independently of CROSS_VERTICAL', () => {
    const state = createState({ crossedHorizontal: true, crossedVertical: false });
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_HORIZONTAL), state)).toBe(true);
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_VERTICAL), state)).toBe(false);
  });
});

// ============================================================================
// TEVENT_CROSS_VERTICAL (type=26)
// ============================================================================

describe('TEVENT_CROSS_VERTICAL (type=26) — C++ tevent.cpp:290-293, foot.cpp:1434-1442', () => {
  it('fires when crossedVertical is true', () => {
    const state = createState({ crossedVertical: true });
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_VERTICAL), state)).toBe(true);
  });

  it('does NOT fire when crossedVertical is false', () => {
    const state = createState({ crossedVertical: false });
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_VERTICAL), state)).toBe(false);
  });

  it('does NOT fire based on playerEntered alone', () => {
    const state = createState({ playerEntered: true, crossedVertical: false });
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_VERTICAL), state)).toBe(false);
  });

  it('fires independently of CROSS_HORIZONTAL', () => {
    const state = createState({ crossedVertical: true, crossedHorizontal: false });
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_VERTICAL), state)).toBe(true);
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_HORIZONTAL), state)).toBe(false);
  });
});

// ============================================================================
// House ownership isolation (C++ tevent.cpp:290-293)
// ============================================================================

describe('House ownership — events check Data.House (C++ tevent.cpp:290-293)', () => {
  it('HOUSE_DISCOVERED only fires for the specific house in event.data', () => {
    // event.data = 9 (BadGuy), but only USSR (2) is discovered
    const houseDiscovered = new Map([[2, true]]);
    const state = createState({ houseDiscovered });
    expect(checkTriggerEvent(makeEvent(TEVENT_HOUSE_DISCOVERED, 9), state)).toBe(false);
    expect(checkTriggerEvent(makeEvent(TEVENT_HOUSE_DISCOVERED, 2), state)).toBe(true);
  });

  it('own units should not trigger ENTERS_ZONE (ownership check in engine layer)', () => {
    // In C++, tevent.cpp:291 checks object->Owner() != Data.House returns false.
    // Wait — actually it's object->Owner() == Data.House (must match).
    // But the concept is that the trigger's Data.House field specifies WHICH house's units
    // should cause the trigger. In the engine, checkZoneAndCrossTriggers performs this check
    // before setting enteredZone=true. At the checkTriggerEvent level, enteredZone=false
    // means no matching-house unit entered.
    const state = createState({ enteredZone: false });
    expect(checkTriggerEvent(makeEvent(TEVENT_ENTERS_ZONE, 0), state)).toBe(false);
  });
});

// ============================================================================
// Event independence — each event type uses its own state flag
// ============================================================================

describe('Event independence — differentiated state flags', () => {
  it('DISCOVERED does NOT trigger ENTERS_ZONE or CROSS events', () => {
    const state = createState({ objectDiscovered: true });
    expect(checkTriggerEvent(makeEvent(TEVENT_DISCOVERED), state)).toBe(true);
    expect(checkTriggerEvent(makeEvent(TEVENT_ENTERS_ZONE), state)).toBe(false);
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_HORIZONTAL), state)).toBe(false);
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_VERTICAL), state)).toBe(false);
    expect(checkTriggerEvent(makeEvent(TEVENT_HOUSE_DISCOVERED, 0), state)).toBe(false);
  });

  it('ENTERS_ZONE does NOT trigger DISCOVERED or CROSS events', () => {
    const state = createState({ enteredZone: true });
    expect(checkTriggerEvent(makeEvent(TEVENT_ENTERS_ZONE), state)).toBe(true);
    expect(checkTriggerEvent(makeEvent(TEVENT_DISCOVERED), state)).toBe(false);
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_HORIZONTAL), state)).toBe(false);
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_VERTICAL), state)).toBe(false);
  });

  it('CROSS_HORIZONTAL does NOT trigger CROSS_VERTICAL or other events', () => {
    const state = createState({ crossedHorizontal: true });
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_HORIZONTAL), state)).toBe(true);
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_VERTICAL), state)).toBe(false);
    expect(checkTriggerEvent(makeEvent(TEVENT_DISCOVERED), state)).toBe(false);
    expect(checkTriggerEvent(makeEvent(TEVENT_ENTERS_ZONE), state)).toBe(false);
  });

  it('CROSS_VERTICAL does NOT trigger CROSS_HORIZONTAL or other events', () => {
    const state = createState({ crossedVertical: true });
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_VERTICAL), state)).toBe(true);
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_HORIZONTAL), state)).toBe(false);
    expect(checkTriggerEvent(makeEvent(TEVENT_DISCOVERED), state)).toBe(false);
    expect(checkTriggerEvent(makeEvent(TEVENT_ENTERS_ZONE), state)).toBe(false);
  });

  it('PLAYER_ENTERED remains independent and still uses playerEntered flag', () => {
    // PLAYER_ENTERED was not changed — it still reads playerEntered
    const state = createState({
      playerEntered: true,
      objectDiscovered: false,
      enteredZone: false,
      crossedHorizontal: false,
      crossedVertical: false,
    });
    expect(checkTriggerEvent(makeEvent(TEVENT_PLAYER_ENTERED), state)).toBe(true);
    expect(checkTriggerEvent(makeEvent(TEVENT_DISCOVERED), state)).toBe(false);
    expect(checkTriggerEvent(makeEvent(TEVENT_ENTERS_ZONE), state)).toBe(false);
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_HORIZONTAL), state)).toBe(false);
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_VERTICAL), state)).toBe(false);
  });

  it('all five events can be independently true at the same time', () => {
    const state = createState({
      playerEntered: true,
      objectDiscovered: true,
      houseDiscovered: new Map([[2, true]]),
      enteredZone: true,
      crossedHorizontal: true,
      crossedVertical: true,
    });
    expect(checkTriggerEvent(makeEvent(TEVENT_PLAYER_ENTERED), state)).toBe(true);
    expect(checkTriggerEvent(makeEvent(TEVENT_DISCOVERED), state)).toBe(true);
    expect(checkTriggerEvent(makeEvent(TEVENT_HOUSE_DISCOVERED, 2), state)).toBe(true);
    expect(checkTriggerEvent(makeEvent(TEVENT_ENTERS_ZONE), state)).toBe(true);
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_HORIZONTAL), state)).toBe(true);
    expect(checkTriggerEvent(makeEvent(TEVENT_CROSS_VERTICAL), state)).toBe(true);
  });
});
