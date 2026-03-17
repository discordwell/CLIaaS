/**
 * C++ Behavioral Parity: Trigger actions use action Data.House, not trigger house
 *
 * In C++ taction.cpp, these actions use Data.House (the action's own data field)
 * to target a specific house. This is separate from the trigger's owner house.
 *
 * Bug: The TS implementation was incorrectly using trigger.house (the trigger's
 * owner house) instead of action.data (Data.House from the INI).
 *
 * Affected actions:
 *   TACTION_BEGIN_PRODUCTION (3) — C++: HouseClass::As_Pointer(Data.House)->Begin_Production()
 *   TACTION_FIRE_SALE (9)       — C++: HouseClass::As_Pointer(Data.House)->State = STATE_ENDGAME
 *   TACTION_ALL_HUNT (6)        — C++: HouseClass::As_Pointer(Data.House)->Do_All_To_Hunt()
 *   TACTION_AUTOCREATE (13)     — C++: HouseClass::As_Pointer(Data.House)->IsAlerted = true
 *
 * Source: RA/taction.cpp operator() switch cases
 */

import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TriggerAction,
  type TeamType,
  type ScenarioTrigger,
} from '../engine/scenario';

// ── Action type constants (from TACTION.H) ──────────────────────────────────
const TACTION_BEGIN_PRODUCTION = 3;
const TACTION_ALL_HUNT = 6;
const TACTION_FIRE_SALE = 9;
const TACTION_AUTOCREATE = 13;

// ── RA House IDs (from HOUSE.H) ────────────────────────────────────────────
const HOUSE_SPAIN = 0;      // Allied house (Spain)
const HOUSE_GREECE = 1;     // Allied house (Greece)
const HOUSE_USSR = 2;       // Soviet house (USSR)
const HOUSE_ENGLAND = 3;    // Allied house (England)
const HOUSE_UKRAINE = 4;    // Soviet house (Ukraine)
const HOUSE_GERMANY = 5;    // Allied house (Germany)

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeAction(actionType: number, dataHouse: number): TriggerAction {
  return { action: actionType, team: -1, trigger: -1, data: dataHouse };
}

function exec(action: TriggerAction, triggerHouse?: number) {
  return executeTriggerAction(
    action,
    [],           // teamTypes
    new Map(),    // waypoints
    new Set(),    // globals
    [],           // triggers
    triggerHouse,
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('TACTION_BEGIN_PRODUCTION uses action Data.House, not trigger house (taction.cpp)', () => {
  /**
   * C++ source (taction.cpp):
   *   case TACTION_BEGIN_PRODUCTION:
   *     if (Data.House != HOUSE_NONE) {
   *       HouseClass * specified_house = HouseClass::As_Pointer(Data.House);
   *       specified_house->Begin_Production();
   *     }
   *     break;
   */
  it('result.beginProduction equals action.data (Data.House), not triggerHouse', () => {
    const action = makeAction(TACTION_BEGIN_PRODUCTION, HOUSE_USSR);
    const triggerHouse = HOUSE_GREECE;  // trigger owned by Greece
    const result = exec(action, triggerHouse);
    // Must use action.data (USSR=2), NOT triggerHouse (Greece=1)
    expect(result.beginProduction).toBe(HOUSE_USSR);
    expect(result.beginProduction).not.toBe(triggerHouse);
  });

  it('different action.data values produce different beginProduction targets', () => {
    for (const house of [HOUSE_SPAIN, HOUSE_GREECE, HOUSE_USSR, HOUSE_ENGLAND, HOUSE_UKRAINE, HOUSE_GERMANY]) {
      const action = makeAction(TACTION_BEGIN_PRODUCTION, house);
      const result = exec(action, HOUSE_SPAIN);
      expect(result.beginProduction).toBe(house);
    }
  });

  it('works even when triggerHouse is undefined', () => {
    const action = makeAction(TACTION_BEGIN_PRODUCTION, HOUSE_USSR);
    const result = exec(action);
    expect(result.beginProduction).toBe(HOUSE_USSR);
  });
});

describe('TACTION_FIRE_SALE uses action Data.House, not trigger house (taction.cpp)', () => {
  /**
   * C++ source (taction.cpp):
   *   case TACTION_FIRE_SALE:
   *     if (Data.House != HOUSE_NONE) {
   *       HouseClass * specified_house = HouseClass::As_Pointer(Data.House);
   *       specified_house->State = STATE_ENDGAME;
   *     }
   *     break;
   */
  it('result.fireSale equals action.data (Data.House), not trigger.house', () => {
    const action = makeAction(TACTION_FIRE_SALE, HOUSE_USSR);
    const triggerHouse = HOUSE_GREECE;
    const result = exec(action, triggerHouse);
    // Must target USSR (from action.data), NOT Greece (trigger owner)
    expect(result.fireSale).toBe(HOUSE_USSR);
    expect(result.fireSale).not.toBe(triggerHouse);
  });

  it('different action.data values produce different fireSale targets', () => {
    for (const house of [HOUSE_SPAIN, HOUSE_USSR, HOUSE_UKRAINE]) {
      const action = makeAction(TACTION_FIRE_SALE, house);
      const result = exec(action, HOUSE_GREECE);
      expect(result.fireSale).toBe(house);
    }
  });
});

describe('TACTION_ALL_HUNT uses action Data.House to target specific house (taction.cpp)', () => {
  /**
   * C++ source (taction.cpp):
   *   case TACTION_ALL_HUNT:
   *     HouseClass::As_Pointer(Data.House)->Do_All_To_Hunt();
   *     break;
   *
   * This targets a SPECIFIC house, not all enemies.
   */
  it('result.allHunt equals action.data (Data.House), not a boolean', () => {
    const action = makeAction(TACTION_ALL_HUNT, HOUSE_USSR);
    const triggerHouse = HOUSE_GREECE;
    const result = exec(action, triggerHouse);
    // Must be the house index from action.data, not true/boolean
    expect(result.allHunt).toBe(HOUSE_USSR);
    expect(typeof result.allHunt).toBe('number');
  });

  it('targets different houses based on action.data', () => {
    for (const house of [HOUSE_SPAIN, HOUSE_GREECE, HOUSE_USSR, HOUSE_ENGLAND]) {
      const action = makeAction(TACTION_ALL_HUNT, house);
      const result = exec(action);
      expect(result.allHunt).toBe(house);
    }
  });

  it('action.data=0 (HOUSE_SPAIN) is distinct from undefined — still sets allHunt', () => {
    const action = makeAction(TACTION_ALL_HUNT, 0);
    const result = exec(action);
    expect(result.allHunt).toBe(0);
    expect(result.allHunt).not.toBeUndefined();
  });
});

describe('TACTION_AUTOCREATE uses action Data.House, not trigger house (taction.cpp)', () => {
  /**
   * C++ source (taction.cpp):
   *   case TACTION_AUTOCREATE:
   *     if (Data.House != HOUSE_NONE) {
   *       HouseClass * specified_house = HouseClass::As_Pointer(Data.House);
   *       specified_house->IsAlerted = true;
   *     }
   *     break;
   */
  it('result.autocreate equals action.data (Data.House), not a boolean', () => {
    const action = makeAction(TACTION_AUTOCREATE, HOUSE_USSR);
    const triggerHouse = HOUSE_GREECE;
    const result = exec(action, triggerHouse);
    // Must be the house index from action.data, not true/boolean
    expect(result.autocreate).toBe(HOUSE_USSR);
    expect(typeof result.autocreate).toBe('number');
  });

  it('targets different houses based on action.data', () => {
    for (const house of [HOUSE_SPAIN, HOUSE_USSR, HOUSE_UKRAINE, HOUSE_GERMANY]) {
      const action = makeAction(TACTION_AUTOCREATE, house);
      const result = exec(action);
      expect(result.autocreate).toBe(house);
    }
  });

  it('action.data=0 (HOUSE_SPAIN) is distinct from undefined — still sets autocreate', () => {
    const action = makeAction(TACTION_AUTOCREATE, 0);
    const result = exec(action);
    expect(result.autocreate).toBe(0);
    expect(result.autocreate).not.toBeUndefined();
  });
});

describe('Cross-action isolation: each action only sets its own result field', () => {
  it('BEGIN_PRODUCTION does not set fireSale, allHunt, or autocreate', () => {
    const result = exec(makeAction(TACTION_BEGIN_PRODUCTION, HOUSE_USSR));
    expect(result.beginProduction).toBe(HOUSE_USSR);
    expect(result.fireSale).toBeUndefined();
    expect(result.allHunt).toBeUndefined();
    expect(result.autocreate).toBeUndefined();
  });

  it('FIRE_SALE does not set beginProduction, allHunt, or autocreate', () => {
    const result = exec(makeAction(TACTION_FIRE_SALE, HOUSE_USSR));
    expect(result.fireSale).toBe(HOUSE_USSR);
    expect(result.beginProduction).toBeUndefined();
    expect(result.allHunt).toBeUndefined();
    expect(result.autocreate).toBeUndefined();
  });

  it('ALL_HUNT does not set beginProduction, fireSale, or autocreate', () => {
    const result = exec(makeAction(TACTION_ALL_HUNT, HOUSE_USSR));
    expect(result.allHunt).toBe(HOUSE_USSR);
    expect(result.beginProduction).toBeUndefined();
    expect(result.fireSale).toBeUndefined();
    expect(result.autocreate).toBeUndefined();
  });

  it('AUTOCREATE does not set beginProduction, fireSale, or allHunt', () => {
    const result = exec(makeAction(TACTION_AUTOCREATE, HOUSE_USSR));
    expect(result.autocreate).toBe(HOUSE_USSR);
    expect(result.beginProduction).toBeUndefined();
    expect(result.fireSale).toBeUndefined();
    expect(result.allHunt).toBeUndefined();
  });
});
