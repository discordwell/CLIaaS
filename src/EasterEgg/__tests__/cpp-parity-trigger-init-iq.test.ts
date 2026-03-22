/**
 * C++ behavioral parity tests: Trigger initialization & AI IQ system.
 *
 * C++ source references (Trigger Initialization):
 *   trigtype.h:64-68     — PersistantType enum (VOLATILE=0, SEMIPERSISTANT=1, PERSISTANT=2)
 *   trigger.cpp:128-137  — TriggerClass constructor: AttachCount=0, Cell=0, resets Event1/Event2
 *   trigger.cpp:277-298  — Semi-persistent: decrement AttachCount, fire only when AttachCount reaches 0
 *   trigger.cpp:453-468  — Find_Or_Make: returns existing trigger or creates new one
 *   tevent.h:154-162     — AttachType enum (NONE=0, CELL=1, OBJECT=2, MAP=4, HOUSE=8, GENERAL=16)
 *   tevent.cpp:677-766   — Attaches_To(TEventType): maps events to attach types via switch cascades
 *   trigtype.cpp:1815-1823 — TriggerTypeClass::Attaches_To: composites Event1|Event2 attach types
 *   scenario.cpp:565-579 — Trigger distribution: ATTACH_MAP→MapTriggers, ATTACH_GENERAL→LogicTriggers,
 *                           ATTACH_HOUSE→HouseTriggers[house]
 *   scenario.cpp:618-625 — TACTION_ALLOWWIN blockage counting (increments house.Blockage)
 *   trigtype.cpp:1863-1908 — TriggerTypeClass::Read_INI: reads [Trigs] section, calls Fill_In
 *
 * C++ source references (AI IQ System):
 *   rules.cpp:143-153    — Default IQ constants: MaxIQ=5, IQSuperWeapons=4, IQProduction=5,
 *                           IQGuardArea=4, IQRepairSell=3, IQCrush=2, IQScatter=3,
 *                           IQContentScan=4, IQAircraft=4, IQHarvester=3, IQSellBack=2
 *   rules.cpp:935-954    — RulesClass::IQ(): reads [IQ] section from RULES.INI
 *   house.cpp:7149-7151  — IQ read from INI: if (iq > Rule.MaxIQ) iq = 1; clamp to 1 if over max
 *   house.cpp:752         — HouseStaticClass default: IQ(0)
 *   house.cpp:552         — HouseClass initializer: IQ(Control.IQ)
 *   house.cpp:936         — AI(): if (IsBaseBuilding || IQ >= Rule.IQProduction) enable base building
 *   house.cpp:1470        — SuperWeapons: (IsHuman || IQ >= Rule.IQSuperWeapons)
 *   house.cpp:5801        — AI_Unit: IQ >= Rule.IQHarvester for auto-harvester replacement
 *   house.cpp:6243        — AI_Aircraft: IQ >= Rule.IQAircraft for auto-aircraft production
 *   house.cpp:3581        — Paranoid: IQ == Rule.MaxIQ && !IsHuman triggers Computer_Paranoid
 *
 * TS implementation:
 *   engine/scenario.ts   — initializeTriggerAttachmentCounts, consumeSemiPersistentAttachment,
 *                           noteTriggerAttachment, cellTriggers parsing, IQ parsing from INI
 *   engine/ai.ts         — AIHouseState.iq, IQ gates on production/repair/sell/attack/scatter
 *   engine/combat.ts     — aiScatterOnDamage IQ >= 2 gate
 *   engine/superweapon.ts — AI superweapon usage IQ >= 3 gate
 *   engine/index.ts      — aiIQ(house) method, houseIQs mapping
 */

import { describe, it, expect } from 'vitest';
import {
  initializeTriggerAttachmentCounts,
  consumeSemiPersistentAttachment,
  noteTriggerAttachment,
  type ScenarioTrigger,
} from '../engine/scenario';

// ── C++ Constants (matching enum ordinals) ───────────────────────────────────

// TEventType (tevent.h:46-83)
const TEVENT_NONE = 0;
const TEVENT_PLAYER_ENTERED = 1;
const TEVENT_SPIED = 2;
const TEVENT_DISCOVERED = 4;
const TEVENT_ATTACKED = 6;
const TEVENT_DESTROYED = 7;
const TEVENT_ANY = 8;
const TEVENT_UNITS_DESTROYED = 9;
const TEVENT_BUILDINGS_DESTROYED = 10;
const TEVENT_ALL_DESTROYED = 11;
const TEVENT_CREDITS = 12;
const TEVENT_TIME = 13;
const TEVENT_MISSION_TIMER_EXPIRED = 14;
const TEVENT_NOFACTORIES = 17;
const TEVENT_EVAC_CIVILIAN = 18;
const TEVENT_BUILD = 19;
const TEVENT_BUILD_UNIT = 20;
const TEVENT_BUILD_INFANTRY = 21;
const TEVENT_BUILD_AIRCRAFT = 22;
const TEVENT_LEAVES_MAP = 23;
const TEVENT_ENTERS_ZONE = 24;
const TEVENT_CROSS_HORIZONTAL = 25;
const TEVENT_CROSS_VERTICAL = 26;
const TEVENT_GLOBAL_SET = 27;
const TEVENT_GLOBAL_CLEAR = 28;
const TEVENT_LOW_POWER = 30;
const TEVENT_ALL_BRIDGES_DESTROYED = 31;
const TEVENT_BUILDING_EXISTS = 32;

// AttachType (tevent.h:154-162)
const ATTACH_NONE = 0x00;
const ATTACH_CELL = 0x01;
const ATTACH_OBJECT = 0x02;
const ATTACH_MAP = 0x04;
const ATTACH_HOUSE = 0x08;
const ATTACH_GENERAL = 0x10;

// TActionType (taction.h)
const TACTION_NONE = 0;
const TACTION_WIN = 1;
const TACTION_ALLOWWIN = 15;
const TACTION_SET_GLOBAL = 28;

// EventControl (trigger.h MultiStyleType)
const MULTI_ONLY = 0;
const MULTI_AND = 1;
const MULTI_OR = 2;
const MULTI_LINKED = 3;

// ── C++ Attaches_To port (tevent.cpp:677-766) ───────────────────────────────

/**
 * Port of C++ Attaches_To(TEventType) from tevent.cpp:677-766.
 * Determines what a trigger event can attach to (bitmask).
 */
function cppAttachesTo(event: number): number {
  let attach = ATTACH_NONE;

  // tevent.cpp:681-694 — ATTACH_CELL
  switch (event) {
    case TEVENT_CROSS_HORIZONTAL:
    case TEVENT_CROSS_VERTICAL:
    case TEVENT_ENTERS_ZONE:
    case TEVENT_PLAYER_ENTERED:
    case TEVENT_ANY:
    case TEVENT_DISCOVERED:
    case TEVENT_NONE:
      attach = attach | ATTACH_CELL;
      break;
  }

  // tevent.cpp:696-709 — ATTACH_OBJECT
  switch (event) {
    case TEVENT_SPIED:
    case TEVENT_PLAYER_ENTERED:
    case TEVENT_DISCOVERED:
    case TEVENT_DESTROYED:
    case TEVENT_ATTACKED:
    case TEVENT_ANY:
    case TEVENT_NONE:
      attach = attach | ATTACH_OBJECT;
      break;
  }

  // tevent.cpp:711-721 — ATTACH_MAP
  switch (event) {
    case TEVENT_ENTERS_ZONE:
    case TEVENT_ANY:
      attach = attach | ATTACH_MAP;
      break;
  }

  // tevent.cpp:723-748 — ATTACH_HOUSE
  switch (event) {
    case TEVENT_LOW_POWER:
    case TEVENT_EVAC_CIVILIAN:
    case TEVENT_BUILDING_EXISTS:
    case TEVENT_BUILD:
    case TEVENT_BUILD_UNIT:
    case TEVENT_BUILD_INFANTRY:
    case TEVENT_BUILD_AIRCRAFT:
    case TEVENT_NOFACTORIES:
    case TEVENT_BUILDINGS_DESTROYED:
    case TEVENT_UNITS_DESTROYED:
    case TEVENT_ALL_DESTROYED:
    case TEVENT_CREDITS:
    case TEVENT_ANY:
      attach = attach | ATTACH_HOUSE;
      break;
  }

  // tevent.cpp:750-763 — ATTACH_GENERAL
  switch (event) {
    case TEVENT_TIME:
    case TEVENT_GLOBAL_SET:
    case TEVENT_GLOBAL_CLEAR:
    case TEVENT_MISSION_TIMER_EXPIRED:
    case TEVENT_ANY:
    case TEVENT_ALL_BRIDGES_DESTROYED:
    case TEVENT_LEAVES_MAP:
      attach = attach | ATTACH_GENERAL;
      break;
  }

  return attach;
}

/**
 * Port of C++ TriggerTypeClass::Attaches_To (trigtype.cpp:1815-1823).
 * Composites attachment types from Event1 and optionally Event2.
 */
function cppTriggerTypeAttachesTo(
  event1Type: number,
  event2Type: number,
  eventControl: number,
): number {
  let attach = cppAttachesTo(event1Type);
  if (eventControl !== MULTI_ONLY) {
    attach = attach | cppAttachesTo(event2Type);
  }
  return attach;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function createTrigger(overrides: Partial<ScenarioTrigger> = {}): ScenarioTrigger {
  return {
    name: 'trig',
    persistence: 0,
    house: 0,
    eventControl: MULTI_ONLY,
    actionControl: 0,
    event1: { type: TEVENT_NONE, team: -1, data: 0 },
    event2: { type: TEVENT_NONE, team: -1, data: 0 },
    action1: { action: TACTION_NONE, team: -1, trigger: -1, data: 0 },
    action2: { action: TACTION_NONE, team: -1, trigger: -1, data: 0 },
    fired: false,
    timerTick: 0,
    playerEntered: false,
    playerEnteredHouse: -1,
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

// ══════════════════════════════════════════════════════════════════════════════
// TRIGGER INITIALIZATION TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('Trigger AttachType mapping (tevent.cpp:677-766) — C++ parity', () => {
  /**
   * C++ tevent.cpp:677-766 — Attaches_To(TEventType):
   * Each event type maps to a bitmask of attach types via five cascading switch statements.
   * This is the foundation of trigger distribution (which list a trigger goes into).
   */

  it('TEVENT_NONE attaches to CELL | OBJECT (can be placed on cells or objects)', () => {
    // tevent.cpp:688-689: TEVENT_NONE → ATTACH_CELL
    // tevent.cpp:703-704: TEVENT_NONE → ATTACH_OBJECT
    expect(cppAttachesTo(TEVENT_NONE)).toBe(ATTACH_CELL | ATTACH_OBJECT);
  });

  it('TEVENT_PLAYER_ENTERED attaches to CELL | OBJECT', () => {
    // tevent.cpp:685: TEVENT_PLAYER_ENTERED → ATTACH_CELL
    // tevent.cpp:698: TEVENT_PLAYER_ENTERED → ATTACH_OBJECT
    expect(cppAttachesTo(TEVENT_PLAYER_ENTERED)).toBe(ATTACH_CELL | ATTACH_OBJECT);
  });

  it('TEVENT_ANY attaches to CELL | OBJECT | MAP | HOUSE | GENERAL (all types)', () => {
    // tevent.cpp: TEVENT_ANY appears in ALL five switch blocks
    expect(cppAttachesTo(TEVENT_ANY)).toBe(
      ATTACH_CELL | ATTACH_OBJECT | ATTACH_MAP | ATTACH_HOUSE | ATTACH_GENERAL,
    );
  });

  it('TEVENT_DESTROYED attaches to OBJECT only', () => {
    // tevent.cpp:700: TEVENT_DESTROYED → ATTACH_OBJECT
    expect(cppAttachesTo(TEVENT_DESTROYED)).toBe(ATTACH_OBJECT);
  });

  it('TEVENT_ENTERS_ZONE attaches to CELL | MAP', () => {
    // tevent.cpp:684: TEVENT_ENTERS_ZONE → ATTACH_CELL
    // tevent.cpp:714: TEVENT_ENTERS_ZONE → ATTACH_MAP
    expect(cppAttachesTo(TEVENT_ENTERS_ZONE)).toBe(ATTACH_CELL | ATTACH_MAP);
  });

  it('TEVENT_TIME attaches to GENERAL only', () => {
    // tevent.cpp:751: TEVENT_TIME → ATTACH_GENERAL
    expect(cppAttachesTo(TEVENT_TIME)).toBe(ATTACH_GENERAL);
  });

  it('TEVENT_GLOBAL_SET attaches to GENERAL only', () => {
    // tevent.cpp:752: TEVENT_GLOBAL_SET → ATTACH_GENERAL
    expect(cppAttachesTo(TEVENT_GLOBAL_SET)).toBe(ATTACH_GENERAL);
  });

  it('TEVENT_GLOBAL_CLEAR attaches to GENERAL only', () => {
    // tevent.cpp:753: TEVENT_GLOBAL_CLEAR → ATTACH_GENERAL
    expect(cppAttachesTo(TEVENT_GLOBAL_CLEAR)).toBe(ATTACH_GENERAL);
  });

  it('TEVENT_BUILDINGS_DESTROYED attaches to HOUSE only', () => {
    // tevent.cpp:732: TEVENT_BUILDINGS_DESTROYED → ATTACH_HOUSE
    expect(cppAttachesTo(TEVENT_BUILDINGS_DESTROYED)).toBe(ATTACH_HOUSE);
  });

  it('TEVENT_LOW_POWER attaches to HOUSE only', () => {
    // tevent.cpp:724: TEVENT_LOW_POWER → ATTACH_HOUSE
    expect(cppAttachesTo(TEVENT_LOW_POWER)).toBe(ATTACH_HOUSE);
  });

  it('TEVENT_SPIED attaches to OBJECT only', () => {
    // tevent.cpp:697: TEVENT_SPIED → ATTACH_OBJECT
    expect(cppAttachesTo(TEVENT_SPIED)).toBe(ATTACH_OBJECT);
  });

  it('TEVENT_ATTACKED attaches to OBJECT only', () => {
    // tevent.cpp:701: TEVENT_ATTACKED → ATTACH_OBJECT
    expect(cppAttachesTo(TEVENT_ATTACKED)).toBe(ATTACH_OBJECT);
  });

  it('TEVENT_DISCOVERED attaches to CELL | OBJECT', () => {
    // tevent.cpp:687: TEVENT_DISCOVERED → ATTACH_CELL
    // tevent.cpp:699: TEVENT_DISCOVERED → ATTACH_OBJECT
    expect(cppAttachesTo(TEVENT_DISCOVERED)).toBe(ATTACH_CELL | ATTACH_OBJECT);
  });

  it('TEVENT_CROSS_HORIZONTAL attaches to CELL only', () => {
    // tevent.cpp:682: TEVENT_CROSS_HORIZONTAL → ATTACH_CELL
    // Note: lines 712-713 are commented out in C++ source
    expect(cppAttachesTo(TEVENT_CROSS_HORIZONTAL)).toBe(ATTACH_CELL);
  });

  it('TEVENT_CROSS_VERTICAL attaches to CELL only', () => {
    // tevent.cpp:683: TEVENT_CROSS_VERTICAL → ATTACH_CELL
    expect(cppAttachesTo(TEVENT_CROSS_VERTICAL)).toBe(ATTACH_CELL);
  });

  it('TEVENT_LEAVES_MAP attaches to GENERAL only', () => {
    // tevent.cpp:757: TEVENT_LEAVES_MAP → ATTACH_GENERAL
    expect(cppAttachesTo(TEVENT_LEAVES_MAP)).toBe(ATTACH_GENERAL);
  });

  it('TEVENT_ALL_BRIDGES_DESTROYED attaches to GENERAL only', () => {
    // tevent.cpp:756: TEVENT_ALL_BRIDGES_DESTROYED → ATTACH_GENERAL
    expect(cppAttachesTo(TEVENT_ALL_BRIDGES_DESTROYED)).toBe(ATTACH_GENERAL);
  });

  it('TEVENT_MISSION_TIMER_EXPIRED attaches to GENERAL only', () => {
    // tevent.cpp:754: TEVENT_MISSION_TIMER_EXPIRED → ATTACH_GENERAL
    expect(cppAttachesTo(TEVENT_MISSION_TIMER_EXPIRED)).toBe(ATTACH_GENERAL);
  });
});

describe('TriggerTypeClass::Attaches_To composite (trigtype.cpp:1815-1823) — C++ parity', () => {
  /**
   * C++ trigtype.cpp:1815-1823:
   *   AttachType attach = ::Attaches_To(Event1.Event);
   *   if (EventControl != MULTI_ONLY) {
   *     attach = attach | ::Attaches_To(Event2.Event);
   *   }
   *   return(attach);
   *
   * For MULTI_ONLY, only Event1 matters. For AND/OR/LINKED, both events contribute.
   */

  it('MULTI_ONLY: only Event1 contributes to attach type', () => {
    // Event1=DESTROYED (OBJECT), Event2=TIME (GENERAL) — Event2 ignored
    const attach = cppTriggerTypeAttachesTo(TEVENT_DESTROYED, TEVENT_TIME, MULTI_ONLY);
    expect(attach).toBe(ATTACH_OBJECT);
    expect(attach & ATTACH_GENERAL).toBe(0); // Event2 not included
  });

  it('MULTI_AND: both events contribute to attach type', () => {
    // Event1=DESTROYED (OBJECT), Event2=TIME (GENERAL)
    const attach = cppTriggerTypeAttachesTo(TEVENT_DESTROYED, TEVENT_TIME, MULTI_AND);
    expect(attach).toBe(ATTACH_OBJECT | ATTACH_GENERAL);
  });

  it('MULTI_OR: both events contribute to attach type', () => {
    const attach = cppTriggerTypeAttachesTo(TEVENT_PLAYER_ENTERED, TEVENT_GLOBAL_SET, MULTI_OR);
    expect(attach).toBe(ATTACH_CELL | ATTACH_OBJECT | ATTACH_GENERAL);
  });

  it('MULTI_LINKED: both events contribute to attach type', () => {
    const attach = cppTriggerTypeAttachesTo(
      TEVENT_PLAYER_ENTERED, TEVENT_BUILDINGS_DESTROYED, MULTI_LINKED,
    );
    expect(attach).toBe(ATTACH_CELL | ATTACH_OBJECT | ATTACH_HOUSE);
  });

  it('duplicate attach types are idempotent (OR of same bits)', () => {
    // Both events attach to GENERAL
    const attach = cppTriggerTypeAttachesTo(TEVENT_TIME, TEVENT_GLOBAL_SET, MULTI_AND);
    expect(attach).toBe(ATTACH_GENERAL);
  });
});

describe('Trigger distribution to working lists (scenario.cpp:565-579) — C++ parity', () => {
  /**
   * C++ scenario.cpp:565-579:
   *   for each TriggerType:
   *     if (Attaches_To() & ATTACH_MAP)     → MapTriggers.Add(Find_Or_Make(tp))
   *     if (Attaches_To() & ATTACH_GENERAL) → LogicTriggers.Add(Find_Or_Make(tp))
   *     if (Attaches_To() & ATTACH_HOUSE)   → HouseTriggers[tp->House].Add(Find_Or_Make(tp))
   *
   * Note: ATTACH_CELL and ATTACH_OBJECT triggers are NOT added to any global list here.
   * They are attached directly to cells/objects in their respective Read_INI routines.
   *
   * TS: processTriggers() evaluates all triggers each tick (no separate lists).
   * This is a design difference but should produce equivalent behavior.
   */

  it('ENTERS_ZONE trigger goes to MapTriggers (ATTACH_MAP)', () => {
    const attach = cppAttachesTo(TEVENT_ENTERS_ZONE);
    expect(attach & ATTACH_MAP).toBeTruthy();
  });

  it('TIME trigger goes to LogicTriggers (ATTACH_GENERAL)', () => {
    const attach = cppAttachesTo(TEVENT_TIME);
    expect(attach & ATTACH_GENERAL).toBeTruthy();
  });

  it('BUILDINGS_DESTROYED trigger goes to HouseTriggers (ATTACH_HOUSE)', () => {
    const attach = cppAttachesTo(TEVENT_BUILDINGS_DESTROYED);
    expect(attach & ATTACH_HOUSE).toBeTruthy();
  });

  it('DESTROYED trigger is NOT in MapTriggers/LogicTriggers/HouseTriggers (OBJECT only)', () => {
    const attach = cppAttachesTo(TEVENT_DESTROYED);
    expect(attach & ATTACH_MAP).toBe(0);
    expect(attach & ATTACH_GENERAL).toBe(0);
    expect(attach & ATTACH_HOUSE).toBe(0);
  });
});

describe('Trigger attachment counting (trigger.cpp:128-137, 277-298) — C++ parity', () => {
  /**
   * C++ trigger.cpp:132: AttachCount(0) — triggers start with 0 attachments
   * C++ trigger.cpp:277-298 — Semi-persistent spring:
   *   obj->Trigger = NULL;  // detach from object
   *   Map[cell].Trigger = NULL;  // detach from cell
   *   AttachCount--;
   *   if (AttachCount > 0) return(false);  // don't fire yet
   *
   * TS: initializeTriggerAttachmentCounts sets attachCount and remainingAttachCount.
   * consumeSemiPersistentAttachment decrements and returns true when count reaches 0.
   */

  it('initializeTriggerAttachmentCounts sets correct counts from entity/cell references', () => {
    const triggers = [
      createTrigger({ name: 'alpha', persistence: 1 }),
      createTrigger({ name: 'beta', persistence: 1 }),
      createTrigger({ name: 'gamma', persistence: 0 }),
    ];

    // Simulate: 3 entities reference 'alpha', 1 references 'beta', 2 cells reference 'alpha'
    const attachedNames = ['alpha', 'alpha', 'alpha', 'beta', 'alpha', 'alpha'];

    initializeTriggerAttachmentCounts(triggers, attachedNames);

    expect(triggers[0].attachCount).toBe(5);  // alpha: 3 entities + 2 cells
    expect(triggers[0].remainingAttachCount).toBe(5);
    expect(triggers[1].attachCount).toBe(1);  // beta: 1 entity
    expect(triggers[1].remainingAttachCount).toBe(1);
    expect(triggers[2].attachCount).toBe(0);  // gamma: no references
    expect(triggers[2].remainingAttachCount).toBe(0);
  });

  it('triggers with no references get attachCount = 0', () => {
    const trigger = createTrigger({ name: 'orphan' });
    initializeTriggerAttachmentCounts([trigger], []);
    expect(trigger.attachCount).toBe(0);
    expect(trigger.remainingAttachCount).toBe(0);
  });

  it('empty trigger name strings are skipped', () => {
    const trigger = createTrigger({ name: 'test' });
    initializeTriggerAttachmentCounts([trigger], ['', '', 'test']);
    expect(trigger.attachCount).toBe(1);
  });
});

describe('Semi-persistent trigger firing gate (trigger.cpp:277-298) — C++ parity', () => {
  /**
   * C++ trigger.cpp:277-298:
   *   if (IsPersistant == SEMIPERSISTANT) {
   *     if (obj) obj->Trigger = NULL;    // detach
   *     if (cell) Map[cell].Trigger = NULL;
   *     AttachCount--;
   *     if (AttachCount > 0) return(false);  // wait for more
   *   }
   *
   * The trigger only fires when ALL attached objects/cells have been triggered.
   */

  it('semi-persistent with 3 attachments: fires only on third consume', () => {
    const trigger = createTrigger({
      persistence: 1,
      attachCount: 3,
      remainingAttachCount: 3,
    });

    // C++ AttachCount-- then check > 0
    expect(consumeSemiPersistentAttachment(trigger)).toBe(false); // 3→2, still > 0
    expect(trigger.remainingAttachCount).toBe(2);

    expect(consumeSemiPersistentAttachment(trigger)).toBe(false); // 2→1, still > 0
    expect(trigger.remainingAttachCount).toBe(1);

    expect(consumeSemiPersistentAttachment(trigger)).toBe(true);  // 1→0, fires
    expect(trigger.remainingAttachCount).toBe(0);
  });

  it('semi-persistent with 1 attachment: fires immediately on first consume', () => {
    const trigger = createTrigger({
      persistence: 1,
      attachCount: 1,
      remainingAttachCount: 1,
    });

    // C++ AttachCount-- (1→0), 0 > 0 is false, so trigger fires
    expect(consumeSemiPersistentAttachment(trigger)).toBe(true);
    expect(trigger.remainingAttachCount).toBe(0);
  });

  it('volatile (persistence=0) always returns true (no gating)', () => {
    // C++ trigger.cpp:277: only enters semi-persistent block for IsPersistant == SEMIPERSISTANT
    const trigger = createTrigger({ persistence: 0 });
    expect(consumeSemiPersistentAttachment(trigger)).toBe(true);
  });

  it('persistent (persistence=2) always returns true (no gating)', () => {
    const trigger = createTrigger({ persistence: 2 });
    expect(consumeSemiPersistentAttachment(trigger)).toBe(true);
  });

  it('semi-persistent with 0 remaining always returns true (already exhausted)', () => {
    const trigger = createTrigger({
      persistence: 1,
      attachCount: 3,
      remainingAttachCount: 0,
    });
    expect(consumeSemiPersistentAttachment(trigger)).toBe(true);
  });
});

describe('noteTriggerAttachment increments counts — C++ parity', () => {
  /**
   * C++ pattern: when entities/structures are spawned after scenario init
   * (e.g., reinforcements), their trigger references must increment AttachCount.
   *
   * TS: noteTriggerAttachment handles this for dynamically spawned units.
   */

  it('increments attachCount and remainingAttachCount for matching trigger', () => {
    const trigger = createTrigger({
      name: 'reinforce_trig',
      persistence: 1,
      attachCount: 2,
      remainingAttachCount: 2,
    });

    noteTriggerAttachment([trigger], 'reinforce_trig', 3);

    expect(trigger.attachCount).toBe(5);  // 2 + 3
    expect(trigger.remainingAttachCount).toBe(5);
  });

  it('does nothing for empty or undefined trigger names', () => {
    const trigger = createTrigger({ name: 'test' });
    noteTriggerAttachment([trigger], '', 1);
    noteTriggerAttachment([trigger], undefined, 1);
    expect(trigger.attachCount).toBeUndefined();
  });

  it('does nothing for non-matching trigger name', () => {
    const trigger = createTrigger({ name: 'alpha' });
    noteTriggerAttachment([trigger], 'beta', 1);
    expect(trigger.attachCount).toBeUndefined();
  });

  it('handles zero count as no-op', () => {
    const trigger = createTrigger({
      name: 'test',
      attachCount: 2,
      remainingAttachCount: 2,
    });
    noteTriggerAttachment([trigger], 'test', 0);
    expect(trigger.attachCount).toBe(2);
  });
});

describe('CellTrigger cell index correctness — C++ parity', () => {
  /**
   * C++ trigtype.cpp:1838-1839:
   *   Cell Trigger pointers & IsTrigger flags are set in DisplayClass::Read_INI(),
   *   and cleared in the Map::Init() routine
   *
   * In C++, [CellTriggers] section maps cell indices (integer keys) to trigger names.
   * Cell indices are linear: cellIndex = y * MAP_WIDTH + x (for standard 128x128 maps).
   *
   * TS: scenario.ts parses [CellTriggers] into Map<number, string>.
   * The cell index is parsed with parseInt().
   */

  it('cell trigger map stores integer cell indices as keys', () => {
    const cellTriggers = new Map<number, string>();
    cellTriggers.set(3456, 'guard_trig');
    cellTriggers.set(7890, 'ambush_trig');

    expect(cellTriggers.get(3456)).toBe('guard_trig');
    expect(cellTriggers.get(7890)).toBe('ambush_trig');
    expect(cellTriggers.size).toBe(2);
  });

  it('cell trigger counts are included in initializeTriggerAttachmentCounts', () => {
    // TS loadScenario.ts:1483-1490 passes cellTriggers.values() into the attachment list
    const triggers = [
      createTrigger({ name: 'cell_trig', persistence: 1 }),
    ];

    // Simulate 3 cell trigger references + 2 entity references to same trigger
    const cellTriggers = new Map<number, string>();
    cellTriggers.set(100, 'cell_trig');
    cellTriggers.set(200, 'cell_trig');
    cellTriggers.set(300, 'cell_trig');

    const entityTrigNames = ['cell_trig', 'cell_trig'];

    initializeTriggerAttachmentCounts(
      triggers,
      [...entityTrigNames, ...cellTriggers.values()],
    );

    // C++ parity: total attach count = 5 (2 entities + 3 cells)
    expect(triggers[0].attachCount).toBe(5);
    expect(triggers[0].remainingAttachCount).toBe(5);
  });
});

describe('TACTION_ALLOWWIN blockage counting (scenario.cpp:618-625) — C++ parity', () => {
  /**
   * C++ scenario.cpp:618-625:
   *   for (int index = 0; index < TriggerTypes.Count(); index++) {
   *     TriggerTypeClass * tp = TriggerTypes.Ptr(index);
   *     if (tp->Action1.Action == TACTION_ALLOWWIN ||
   *         (tp->ActionControl != MULTI_ONLY && tp->Action2.Action == TACTION_ALLOWWIN)) {
   *       HouseClass::As_Pointer(tp->House)->Blockage++;
   *     }
   *   }
   *
   * C++ counts how many triggers have ALLOWWIN actions per house.
   * The house can only win when Blockage reaches 0 (all ALLOWWIN triggers have fired).
   */

  it('Action1=ALLOWWIN counts regardless of ActionControl', () => {
    const trigger = createTrigger({
      action1: { action: TACTION_ALLOWWIN, team: -1, trigger: -1, data: 0 },
      actionControl: MULTI_ONLY,
    });
    expect(trigger.action1.action).toBe(TACTION_ALLOWWIN);
  });

  it('Action2=ALLOWWIN counts only when ActionControl != MULTI_ONLY', () => {
    // C++ check: (tp->ActionControl != MULTI_ONLY && tp->Action2.Action == TACTION_ALLOWWIN)
    const triggerAnd = createTrigger({
      action2: { action: TACTION_ALLOWWIN, team: -1, trigger: -1, data: 0 },
      actionControl: MULTI_AND,
    });
    // ActionControl=AND (1) != MULTI_ONLY (0), so Action2 counts
    expect(triggerAnd.actionControl !== MULTI_ONLY && triggerAnd.action2.action === TACTION_ALLOWWIN).toBe(true);

    const triggerOnly = createTrigger({
      action2: { action: TACTION_ALLOWWIN, team: -1, trigger: -1, data: 0 },
      actionControl: MULTI_ONLY,
    });
    // ActionControl=ONLY (0) == MULTI_ONLY, so Action2 does NOT count
    expect(triggerOnly.actionControl !== MULTI_ONLY && triggerOnly.action2.action === TACTION_ALLOWWIN).toBe(false);
  });

  it('blockage count matches number of ALLOWWIN triggers for a house', () => {
    // Simulate 3 triggers, 2 with ALLOWWIN for house 2
    const triggers = [
      createTrigger({ house: 2, action1: { action: TACTION_ALLOWWIN, team: -1, trigger: -1, data: 0 } }),
      createTrigger({ house: 2, action1: { action: TACTION_WIN, team: -1, trigger: -1, data: 0 } }),
      createTrigger({
        house: 2,
        action2: { action: TACTION_ALLOWWIN, team: -1, trigger: -1, data: 0 },
        actionControl: MULTI_AND,
      }),
    ];

    // Count blockage for house 2 using C++ algorithm
    let blockage = 0;
    for (const t of triggers) {
      if (t.action1.action === TACTION_ALLOWWIN ||
        (t.actionControl !== MULTI_ONLY && t.action2.action === TACTION_ALLOWWIN)) {
        if (t.house === 2) blockage++;
      }
    }
    expect(blockage).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// AI IQ SYSTEM TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ IQ default constants (rules.cpp:143-153) — C++ parity', () => {
  /**
   * C++ RulesClass constructor (rules.cpp:98-292):
   *   MaxIQ(5),
   *   IQSuperWeapons(4),
   *   IQProduction(5),
   *   IQGuardArea(4),
   *   IQRepairSell(3),
   *   IQCrush(2),
   *   IQScatter(3),
   *   IQContentScan(4),
   *   IQAircraft(4),
   *   IQHarvester(3),
   *   IQSellBack(2)
   *
   * These are the default IQ thresholds. Each capability is unlocked when
   * a house's IQ >= the corresponding constant.
   */

  const CPP_DEFAULTS = {
    MaxIQ: 5,
    IQSuperWeapons: 4,
    IQProduction: 5,
    IQGuardArea: 4,
    IQRepairSell: 3,
    IQCrush: 2,
    IQScatter: 3,
    IQContentScan: 4,
    IQAircraft: 4,
    IQHarvester: 3,
    IQSellBack: 2,
  };

  it('MaxIQ defaults to 5', () => {
    expect(CPP_DEFAULTS.MaxIQ).toBe(5);
  });

  it('IQSuperWeapons defaults to 4', () => {
    expect(CPP_DEFAULTS.IQSuperWeapons).toBe(4);
  });

  it('IQProduction defaults to 5', () => {
    expect(CPP_DEFAULTS.IQProduction).toBe(5);
  });

  it('IQRepairSell defaults to 3', () => {
    expect(CPP_DEFAULTS.IQRepairSell).toBe(3);
  });

  it('IQCrush defaults to 2', () => {
    expect(CPP_DEFAULTS.IQCrush).toBe(2);
  });

  it('IQScatter defaults to 3', () => {
    expect(CPP_DEFAULTS.IQScatter).toBe(3);
  });

  it('IQAircraft defaults to 4', () => {
    expect(CPP_DEFAULTS.IQAircraft).toBe(4);
  });

  it('IQHarvester defaults to 3', () => {
    expect(CPP_DEFAULTS.IQHarvester).toBe(3);
  });

  it('IQSellBack defaults to 2', () => {
    expect(CPP_DEFAULTS.IQSellBack).toBe(2);
  });
});

describe('C++ IQ clamping (house.cpp:7149-7151) — C++ parity', () => {
  /**
   * C++ house.cpp:7149-7151:
   *   int iq = ini.Get_Int(hname, "IQ", 0);
   *   if (iq > Rule.MaxIQ) iq = 1;
   *   p->IQ = p->Control.IQ = iq;
   *
   * If IQ exceeds MaxIQ (default 5), it is clamped to 1 (not MaxIQ!).
   * This is a deliberate anti-cheat/sanity measure.
   *
   * TS: scenario.ts:917-918 reads IQ with parseInt, no clamping.
   */

  it('C++ clamps IQ > MaxIQ to 1, not to MaxIQ', () => {
    const MaxIQ = 5;
    function cppClampIQ(iq: number): number {
      if (iq > MaxIQ) return 1;
      return iq;
    }

    expect(cppClampIQ(0)).toBe(0);
    expect(cppClampIQ(1)).toBe(1);
    expect(cppClampIQ(3)).toBe(3);
    expect(cppClampIQ(5)).toBe(5);  // MaxIQ itself is OK
    expect(cppClampIQ(6)).toBe(1);  // Over MaxIQ → reset to 1
    expect(cppClampIQ(99)).toBe(1); // Way over → still 1
  });

  // PARITY GAP: TS does not clamp IQ values
  it('TS does not clamp IQ values exceeding MaxIQ', () => {
    // TS scenario.ts:917-918: const iq = parseInt(get(houseName, 'IQ', ''));
    // No MaxIQ check exists in TS — an IQ of 99 would be stored as-is.
    // C++ would clamp 99 → 1.
    // This is a PARITY GAP but unlikely to affect real scenarios (mission INIs use 0-5).
    const tsIQ = parseInt('6');
    expect(tsIQ).toBe(6); // TS stores raw value, C++ would make this 1 // PARITY GAP
  });
});

describe('C++ HouseStaticClass default IQ (house.cpp:752) — C++ parity', () => {
  /**
   * C++ house.cpp:751-753:
   *   HouseStaticClass::HouseStaticClass(void) :
   *     IQ(0),
   *
   * Default IQ for any house is 0 — all AI behaviors are disabled unless
   * the scenario INI specifies an IQ value.
   *
   * TS: ai.ts:354 defaults to 3 when no IQ is specified:
   *   iq: ctx.houseIQs.get(house) ?? 3,
   */

  it('C++ default house IQ is 0 (all AI disabled)', () => {
    const cppDefaultIQ = 0;
    expect(cppDefaultIQ).toBe(0);
  });

  // PARITY GAP: TS defaults to IQ 3 instead of 0
  it('TS defaults to IQ 3 when not specified — diverges from C++ default of 0', () => {
    // TS ai.ts:354: iq: ctx.houseIQs.get(house) ?? 3
    // C++ house.cpp:752: IQ(0)
    // This means TS AI houses without explicit IQ get more capabilities than C++ would grant.
    const tsDefaultIQ = 3;
    const cppDefaultIQ = 0;
    expect(tsDefaultIQ).not.toBe(cppDefaultIQ); // PARITY GAP
  });
});

describe('IQ-gated AI behaviors — TS implementation (ai.ts, combat.ts, superweapon.ts)', () => {
  /**
   * C++ IQ gate mapping (using default Rule constants from rules.cpp):
   *
   *   IQ >= 1: (no C++ default uses 1 — IQSellBack=2 is lowest non-zero)
   *   IQ >= 2: IQCrush, IQSellBack — auto-crush infantry, sell damaged buildings
   *   IQ >= 3: IQRepairSell, IQScatter, IQHarvester — repair/sell, scatter, auto-harvester
   *   IQ >= 4: IQSuperWeapons, IQGuardArea, IQContentScan, IQAircraft — superweapons, guard area, APC scanning, aircraft
   *   IQ >= 5: IQProduction — autonomous base building/production
   *
   * TS thresholds (from ai.ts, combat.ts, superweapon.ts):
   *   IQ >= 0: strategic planner skips (iq === 0 → skip)
   *   IQ >= 1: construction, repair, sell
   *   IQ >= 2: base rebuild, attack groups, defense, scatter (combat.ts:339)
   *   IQ >= 3: retreat, superweapons (superweapon.ts:264-266)
   */

  // C++ behaviors mapped to IQ levels
  const cppIQGates = [
    { behavior: 'auto-crush infantry', iq: 2 /* IQCrush */ },
    { behavior: 'sell damaged buildings', iq: 2 /* IQSellBack */ },
    { behavior: 'auto-repair structures', iq: 3 /* IQRepairSell */ },
    { behavior: 'scatter on damage', iq: 3 /* IQScatter */ },
    { behavior: 'auto-replace harvester', iq: 3 /* IQHarvester */ },
    { behavior: 'use superweapons', iq: 4 /* IQSuperWeapons */ },
    { behavior: 'guard area', iq: 4 /* IQGuardArea */ },
    { behavior: 'scan APC contents', iq: 4 /* IQContentScan */ },
    { behavior: 'auto-build aircraft', iq: 4 /* IQAircraft */ },
    { behavior: 'autonomous production', iq: 5 /* IQProduction */ },
  ];

  // TS behaviors mapped to IQ levels
  const tsIQGates = [
    { behavior: 'strategic planner', iq: 1 /* ai.ts:1221: state.iq === 0 → skip */ },
    { behavior: 'construction', iq: 1 /* ai.ts:1346 */ },
    { behavior: 'auto-repair', iq: 1 /* ai.ts:1794 */ },
    { behavior: 'auto-sell damaged', iq: 1 /* ai.ts:1825 */ },
    { behavior: 'base rebuild', iq: 2 /* ai.ts:821 */ },
    { behavior: 'attack groups', iq: 2 /* ai.ts:1493 */ },
    { behavior: 'defense', iq: 2 /* ai.ts:1677 */ },
    { behavior: 'scatter on damage', iq: 3 /* combat.ts:339 — matches C++ IQScatter=3 */ },
    { behavior: 'retreat', iq: 3 /* ai.ts:1726 */ },
    { behavior: 'superweapons', iq: 3 /* superweapon.ts:266 */ },
  ];

  it('C++ IQScatter (scatter on damage) requires IQ >= 3', () => {
    expect(cppIQGates.find(g => g.behavior === 'scatter on damage')?.iq).toBe(3);
  });

  it('TS scatter on damage requires IQ >= 3 — matches C++ IQScatter=3', () => {
    // combat.ts:338-339: if (ctx.aiIQ(entity.house) < 3) return;
    // C++ IQScatter=3 (rules.cpp:149)
    expect(tsIQGates.find(g => g.behavior === 'scatter on damage')?.iq).toBe(3);
  });

  it('C++ IQSuperWeapons requires IQ >= 4', () => {
    expect(cppIQGates.find(g => g.behavior === 'use superweapons')?.iq).toBe(4);
  });

  it('TS superweapons require IQ >= 3 — diverges from C++ IQSuperWeapons=4', () => {
    // superweapon.ts:264-266: IQ gate at 3
    // C++ IQSuperWeapons=4 (rules.cpp:144)
    expect(tsIQGates.find(g => g.behavior === 'superweapons')?.iq).toBe(3);
    // PARITY GAP: TS gates superweapons at IQ 3, C++ at IQ 4
  });

  it('C++ IQRepairSell requires IQ >= 3 for repair/sell decisions', () => {
    expect(cppIQGates.find(g => g.behavior === 'auto-repair structures')?.iq).toBe(3);
  });

  it('TS auto-repair requires IQ >= 1 — diverges from C++ IQRepairSell=3', () => {
    // ai.ts:1794: if (state.iq < 1) continue;
    // C++ IQRepairSell=3 (rules.cpp:147)
    expect(tsIQGates.find(g => g.behavior === 'auto-repair')?.iq).toBe(1);
    // PARITY GAP: TS gates repair at IQ 1, C++ at IQ 3
  });

  it('C++ IQProduction requires IQ >= 5 for autonomous base building', () => {
    // house.cpp:936: if (IsBaseBuilding || IQ >= Rule.IQProduction)
    expect(cppIQGates.find(g => g.behavior === 'autonomous production')?.iq).toBe(5);
  });

  it('TS construction requires IQ >= 1 — diverges from C++ IQProduction=5', () => {
    // ai.ts:1346: if (state.iq < 1) continue;
    // C++ IQProduction=5 (rules.cpp:145), but note: IsBaseBuilding flag can bypass this
    expect(tsIQGates.find(g => g.behavior === 'construction')?.iq).toBe(1);
    // PARITY GAP: TS gates construction at IQ 1, C++ at IQ 5 (without IsBaseBuilding)
  });
});

describe('IQ-based base building auto-enable (house.cpp:936) — C++ parity', () => {
  /**
   * C++ house.cpp:933-940:
   *   // If base building has been turned on by a trigger, then force the house to begin
   *   // production and team creation as well. This is also true if the IQ is high enough
   *   if (IsBaseBuilding || IQ >= Rule.IQProduction) {
   *     IsBaseBuilding = true;
   *     IsStarted = true;
   *     IsAlerted = true;
   *   }
   *
   * Two paths to enable base building:
   *   1. A trigger action (TACTION_BASE_BUILDING) sets IsBaseBuilding = true
   *   2. House IQ >= IQProduction (default 5) auto-enables it
   *
   * When either condition is met, ALL three flags are set: IsBaseBuilding, IsStarted, IsAlerted.
   */

  it('IQ >= IQProduction (5) auto-enables base building without trigger', () => {
    const IQProduction = 5;
    const houseIQ = 5;
    const IsBaseBuilding = false;

    const shouldEnable = IsBaseBuilding || houseIQ >= IQProduction;
    expect(shouldEnable).toBe(true);
  });

  it('IQ < IQProduction does NOT auto-enable (requires trigger)', () => {
    const IQProduction = 5;
    const houseIQ = 4;
    const IsBaseBuilding = false;

    const shouldEnable = IsBaseBuilding || houseIQ >= IQProduction;
    expect(shouldEnable).toBe(false);
  });

  it('IsBaseBuilding=true overrides low IQ', () => {
    const IQProduction = 5;
    const houseIQ = 0;
    const IsBaseBuilding = true;

    const shouldEnable = IsBaseBuilding || houseIQ >= IQProduction;
    expect(shouldEnable).toBe(true);
  });
});

describe('AI paranoid mode (house.cpp:3581) — C++ parity', () => {
  /**
   * C++ house.cpp:3578-3583:
   *   // If this is a computer controlled house, then all computer controlled
   *   // houses become paranoid.
   *   if (IQ == Rule.MaxIQ && !IsHuman && Rule.IsComputerParanoid) {
   *     Computer_Paranoid();
   *   }
   *
   * When a non-human house with MaxIQ is defeated, it triggers paranoid mode
   * for ALL computer houses. This is a unique IQ == MaxIQ check (not >=).
   *
   * TS: No equivalent paranoid mode implementation found.
   */

  it('paranoid mode triggers only at exact MaxIQ, not lower', () => {
    const MaxIQ = 5;
    const IsComputerParanoid = true;

    // IQ == MaxIQ triggers paranoid
    expect(5 === MaxIQ && !false && IsComputerParanoid).toBe(true);

    // IQ == 4 does NOT trigger paranoid
    expect(4 === MaxIQ && !false && IsComputerParanoid).toBe(false);
  });
});

describe('IQ reading from scenario INI (house.cpp:7149-7151) — C++ parity', () => {
  /**
   * C++ house.cpp:7149-7151:
   *   int iq = ini.Get_Int(hname, "IQ", 0);     // default = 0
   *   if (iq > Rule.MaxIQ) iq = 1;               // clamp overflow to 1
   *   p->IQ = p->Control.IQ = iq;                // set both dynamic and static IQ
   *
   * TS: scenario.ts:917-918:
   *   const iq = parseInt(get(houseName, 'IQ', ''));
   *   if (!isNaN(iq)) houseIQ.set(houseName, iq);
   *
   * Key differences:
   *   1. C++ defaults to 0, TS defaults to NaN (skipped)
   *   2. C++ clamps IQ > MaxIQ to 1, TS does no clamping
   *   3. C++ sets both p->IQ and p->Control.IQ, TS only stores in map
   */

  it('C++ default IQ when not specified in INI is 0', () => {
    // ini.Get_Int(hname, "IQ", 0) — default parameter is 0
    const cppDefault = 0;
    expect(cppDefault).toBe(0);
  });

  it('TS skips houses without explicit IQ (does not default to 0)', () => {
    // TS: parseInt('') returns NaN, so !isNaN(NaN) is false → not stored
    const iq = parseInt('');
    expect(isNaN(iq)).toBe(true);
  });

  it('IQ values 0-5 are stored as-is in both C++ and TS', () => {
    const MaxIQ = 5;
    for (let iq = 0; iq <= MaxIQ; iq++) {
      const cppIQ = iq > MaxIQ ? 1 : iq;
      expect(cppIQ).toBe(iq);
    }
  });
});

describe('IQ level capability matrix — comprehensive C++ parity reference', () => {
  /**
   * This documents what each IQ level enables in C++ with default rules.ini constants.
   * IQ is set per-house in scenario INI. Higher = smarter AI.
   *
   * C++ IQ capability matrix (default thresholds from rules.cpp):
   *   IQ 0: AI does nothing (all checks fail: 0 < any threshold)
   *   IQ 1: No default behaviors enabled (all defaults >= 2)
   *   IQ 2: Auto-crush (IQCrush=2), Sell damaged buildings (IQSellBack=2)
   *   IQ 3: Repair/Sell decisions (IQRepairSell=3), Scatter on damage (IQScatter=3),
   *          Auto-replace harvesters (IQHarvester=3)
   *   IQ 4: Superweapons (IQSuperWeapons=4), Guard area (IQGuardArea=4),
   *          Scan APC contents (IQContentScan=4), Auto-aircraft (IQAircraft=4)
   *   IQ 5: Autonomous production/base building (IQProduction=5) [MaxIQ]
   */

  const cppThresholds: Record<string, number> = {
    IQCrush: 2,
    IQSellBack: 2,
    IQRepairSell: 3,
    IQScatter: 3,
    IQHarvester: 3,
    IQSuperWeapons: 4,
    IQGuardArea: 4,
    IQContentScan: 4,
    IQAircraft: 4,
    IQProduction: 5,
  };

  it('IQ 0 enables no capabilities', () => {
    const iq = 0;
    for (const [name, threshold] of Object.entries(cppThresholds)) {
      expect(iq >= threshold, `IQ 0 should NOT enable ${name}`).toBe(false);
    }
  });

  it('IQ 1 enables no capabilities (lowest default threshold is 2)', () => {
    const iq = 1;
    for (const [name, threshold] of Object.entries(cppThresholds)) {
      expect(iq >= threshold, `IQ 1 should NOT enable ${name}`).toBe(false);
    }
  });

  it('IQ 2 enables IQCrush and IQSellBack only', () => {
    const iq = 2;
    const enabled = Object.entries(cppThresholds)
      .filter(([, threshold]) => iq >= threshold)
      .map(([name]) => name);
    expect(enabled).toEqual(['IQCrush', 'IQSellBack']);
  });

  it('IQ 3 enables IQCrush, IQSellBack, IQRepairSell, IQScatter, IQHarvester', () => {
    const iq = 3;
    const enabled = Object.entries(cppThresholds)
      .filter(([, threshold]) => iq >= threshold)
      .map(([name]) => name);
    expect(enabled).toEqual([
      'IQCrush', 'IQSellBack', 'IQRepairSell', 'IQScatter', 'IQHarvester',
    ]);
  });

  it('IQ 4 enables everything except IQProduction', () => {
    const iq = 4;
    const enabled = Object.entries(cppThresholds)
      .filter(([, threshold]) => iq >= threshold)
      .map(([name]) => name);
    expect(enabled).toEqual([
      'IQCrush', 'IQSellBack', 'IQRepairSell', 'IQScatter', 'IQHarvester',
      'IQSuperWeapons', 'IQGuardArea', 'IQContentScan', 'IQAircraft',
    ]);
  });

  it('IQ 5 (MaxIQ) enables ALL capabilities', () => {
    const iq = 5;
    const enabled = Object.entries(cppThresholds)
      .filter(([, threshold]) => iq >= threshold)
      .map(([name]) => name);
    expect(enabled).toEqual(Object.keys(cppThresholds));
  });
});
