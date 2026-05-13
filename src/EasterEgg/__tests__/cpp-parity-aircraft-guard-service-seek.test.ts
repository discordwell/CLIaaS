/**
 * C++ Behavioral Parity: AircraftClass::Mission_Guard service-seek branches
 *
 * Source: src/EasterEgg/CnC_and_Red_Alert/RA/aircraft.cpp:3737-3789
 *
 * AI-controlled aircraft in MISSION_GUARD inspect two conditions BEFORE the
 * FootClass::Mission_Guard target hunt:
 *
 *   1. Damaged & funded → Find_Docking_Bay(STRUCT_REPAIR, true)
 *      Trigger (aircraft.cpp:3741):
 *        House->Available_Money() >= 100 &&
 *        Health_Ratio() <= Rule.ConditionYellow
 *      Inner skip (aircraft.cpp:3742-3744): already heading to a repair bay
 *        if In_Radio_Contact and (airborne OR contacting a STRUCT_REPAIR).
 *      Friendly=true: allied repair bays are valid.
 *
 *   2. Out of ammo → Find_Docking_Bay(STRUCT_HELIPAD, false)
 *      Trigger (aircraft.cpp:3762):
 *        Ammo == 0 && Is_Weapon_Equipped()
 *      Skip when In_Radio_Contact (aircraft.cpp:3763).
 *      Friendly=false: only own-house helipads are visible.
 *
 *   On success: Assign_Destination(building->As_Target()); Assign_Target
 *   (TARGET_NONE); Assign_Mission(MISSION_ENTER); return(1).
 *
 * Skipped here: FIXIT_CARRIER VESSEL_CARRIER fallback (aircraft.cpp:3766-3779).
 * TS does not model carriers as a passenger-holding aircraft target.
 *
 * Test discipline: Rule.ConditionYellow is parsed from rules.ini ([General]
 * ConditionYellow=50%) — never hardcoded. Other parity values are derived from
 * the C++ source ordering and the structure of the seek call.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  House, Mission, UnitType, CELL_SIZE,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap } from '../engine/map';
import {
  type AircraftContext,
  seekAircraftServiceDocking,
} from '../engine/aircraft';
import type { MapStructure } from '../engine/scenario';

// ── rules.ini ConditionYellow parser ────────────────────────────────────────

function parseConditionYellow(): number {
  const path = join(process.cwd(), 'public', 'ra', 'assets', 'rules.ini');
  const content = readFileSync(path, 'utf-8');
  // C++ Rule.ConditionYellow comes from [General] ConditionYellow=50%.
  // Match "ConditionYellow=<pct>%" with optional inline comment.
  const match = content.match(/^\s*ConditionYellow\s*=\s*([0-9.]+)%/m);
  if (!match) throw new Error('rules.ini missing [General] ConditionYellow=<pct>%');
  return parseFloat(match[1]) / 100;
}

const RULE_CONDITION_YELLOW = parseConditionYellow();

// ── Test harness ────────────────────────────────────────────────────────────

beforeEach(() => resetEntityIds());

function makeStructure(
  type: string,
  house: House,
  cx: number,
  cy: number,
  overrides: Partial<MapStructure> = {},
): MapStructure {
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: 1000,
    maxHp: 1000,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    missionTimer: 0,
    ...overrides,
  } as MapStructure;
}

function makeCtx(overrides: Partial<AircraftContext> = {}): AircraftContext {
  return {
    entities: [],
    entityById: new Map(),
    structures: [],
    map: new GameMap(),
    unitsLeftMap: 0,
    civiliansEvacuated: 0,
    isAllied: (a, b) => a === b,
    movementSpeed: () => 2,
    idleMission: () => Mission.GUARD,
    fireWeaponAt: vi.fn(),
    fireWeaponAtStructure: vi.fn(),
    fireWeaponAtCoord: vi.fn(),
    getROFBias: () => 1.0,
    getPowerFraction: () => 1.0,
    availableMoney: () => 0,
    ...overrides,
  };
}

/** Create an AI aircraft in MISSION_GUARD on a helipad/airfield at the given
 *  cell. Configures health / ammo to caller specs. Defaults: full HP, full ammo,
 *  flying state. */
function makeAircraft(
  type: UnitType,
  house: House,
  cx: number,
  cy: number,
  opts: { hpRatio?: number; ammo?: number; landed?: boolean } = {},
): Entity {
  const entity = new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
  entity.mission = Mission.GUARD;
  entity.missionTimer = 0;
  entity.target = null;
  entity.targetStructure = null;
  entity.moveTarget = null;
  entity.aircraftDockingStructure = -1;
  if (opts.hpRatio !== undefined) {
    entity.hp = Math.max(1, Math.floor(entity.maxHp * opts.hpRatio));
  }
  if (opts.ammo !== undefined) entity.ammo = opts.ammo;
  if (opts.landed) {
    entity.aircraftState = 'landed';
    entity.flightAltitude = 0;
  } else {
    entity.aircraftState = 'flying';
    entity.flightAltitude = Entity.FLIGHT_ALTITUDE;
  }
  return entity;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('AircraftClass::Mission_Guard service-seek — rules.ini ConditionYellow', () => {
  it('rules.ini [General] ConditionYellow= parses to a finite ratio', () => {
    // Source-of-truth assertion: never hardcoded; if rules.ini changes, this
    // test (and all dependents) reflect the new threshold automatically.
    expect(RULE_CONDITION_YELLOW).toBeGreaterThan(0);
    expect(RULE_CONDITION_YELLOW).toBeLessThanOrEqual(1);
    expect(Number.isFinite(RULE_CONDITION_YELLOW)).toBe(true);
  });
});

describe('Damaged aircraft seeks repair bay — aircraft.cpp:3741-3754', () => {
  it('AI HIND at ConditionYellow with >=$100 transitions to MISSION_ENTER toward FIX', () => {
    const fix = makeStructure('FIX', House.USSR, 20, 20);
    const hpad = makeStructure('HPAD', House.USSR, 10, 10);
    const heli = makeAircraft(UnitType.V_HIND, House.USSR, 10, 10, {
      hpRatio: RULE_CONDITION_YELLOW, // exactly at yellow threshold
      landed: true,
    });
    heli.landedAtStructure = 1; // docked at HPAD (matches in-radio-contact)
    // BUT: the seek considers contact with FIX as the only blocker; contact with
    // a HPAD does not block the repair seek (C++ check is `Contact != STRUCT_REPAIR`).
    const ctx = makeCtx({
      structures: [fix, hpad],
      availableMoney: () => 200,
    });
    const fired = seekAircraftServiceDocking(ctx, heli);
    expect(fired).toBe(true);
    expect(heli.mission).toBe(Mission.ENTER);
    expect(heli.aircraftDockingStructure).toBe(0); // fix index
    expect(heli.target).toBeNull();
    expect(heli.targetStructure).toBeNull();
  });

  it('no transition when house has only $50 (<100) — aircraft.cpp:3741 money guard', () => {
    const fix = makeStructure('FIX', House.USSR, 20, 20);
    const heli = makeAircraft(UnitType.V_HIND, House.USSR, 10, 10, {
      hpRatio: RULE_CONDITION_YELLOW,
    });
    const ctx = makeCtx({ structures: [fix], availableMoney: () => 50 });
    expect(seekAircraftServiceDocking(ctx, heli)).toBe(false);
    expect(heli.mission).toBe(Mission.GUARD);
    expect(heli.aircraftDockingStructure).toBe(-1);
  });

  it('no transition when HP is above ConditionYellow (80%) — aircraft.cpp:3741', () => {
    const fix = makeStructure('FIX', House.USSR, 20, 20);
    // 80% > 50% yellow → branch skipped
    const heli = makeAircraft(UnitType.V_HIND, House.USSR, 10, 10, {
      hpRatio: 0.8,
    });
    const ctx = makeCtx({ structures: [fix], availableMoney: () => 1000 });
    expect(seekAircraftServiceDocking(ctx, heli)).toBe(false);
    expect(heli.mission).toBe(Mission.GUARD);
  });

  it('no transition when already in radio contact with a STRUCT_REPAIR (landed at FIX) — aircraft.cpp:3742-3744', () => {
    const fix = makeStructure('FIX', House.USSR, 20, 20);
    const heli = makeAircraft(UnitType.V_HIND, House.USSR, 20, 20, {
      hpRatio: RULE_CONDITION_YELLOW,
      landed: true,
    });
    heli.landedAtStructure = 0; // already docked on the FIX
    const ctx = makeCtx({
      structures: [fix],
      availableMoney: () => 500,
    });
    // C++ inner: !In_Radio_Contact || (Height==0 && NOT contacting STRUCT_REPAIR).
    // We are contacting a STRUCT_REPAIR → skip (no loop).
    const fired = seekAircraftServiceDocking(ctx, heli);
    expect(fired).toBe(false);
    expect(heli.mission).toBe(Mission.GUARD);
  });

  it('no transition when no repair bay exists', () => {
    const hpad = makeStructure('HPAD', House.USSR, 10, 10);
    const heli = makeAircraft(UnitType.V_HIND, House.USSR, 10, 10, {
      hpRatio: RULE_CONDITION_YELLOW,
    });
    const ctx = makeCtx({ structures: [hpad], availableMoney: () => 1000 });
    expect(seekAircraftServiceDocking(ctx, heli)).toBe(false);
  });

  it('allied FIX is valid (friendly=true) — aircraft.cpp:3747', () => {
    // C++ friendly=true → building->House->Is_Ally(this) accepts an allied bay.
    const allies = new Map<House, Set<House>>([
      [House.USSR, new Set([House.USSR, House.Ukraine])],
      [House.Ukraine, new Set([House.USSR, House.Ukraine])],
    ]);
    const fix = makeStructure('FIX', House.Ukraine, 20, 20);
    const heli = makeAircraft(UnitType.V_HIND, House.USSR, 10, 10, {
      hpRatio: RULE_CONDITION_YELLOW,
    });
    const ctx = makeCtx({
      structures: [fix],
      isAllied: (a, b) => allies.get(a)?.has(b) ?? a === b,
      availableMoney: () => 200,
    });
    expect(seekAircraftServiceDocking(ctx, heli)).toBe(true);
    expect(heli.mission).toBe(Mission.ENTER);
    expect(heli.aircraftDockingStructure).toBe(0);
  });
});

describe('Out-of-ammo aircraft re-seeks helipad — aircraft.cpp:3762-3787', () => {
  it('AI HIND with ammo=0 transitions to MISSION_ENTER toward own helipad', () => {
    const hpad = makeStructure('HPAD', House.USSR, 20, 20);
    const heli = makeAircraft(UnitType.V_HIND, House.USSR, 10, 10, {
      ammo: 0,
    });
    const ctx = makeCtx({ structures: [hpad] });
    expect(seekAircraftServiceDocking(ctx, heli)).toBe(true);
    expect(heli.mission).toBe(Mission.ENTER);
    expect(heli.aircraftDockingStructure).toBe(0);
    expect(heli.target).toBeNull();
    expect(heli.targetStructure).toBeNull();
  });

  it('no transition when ammo > 0 — aircraft.cpp:3762 ammo guard', () => {
    const hpad = makeStructure('HPAD', House.USSR, 20, 20);
    const heli = makeAircraft(UnitType.V_HIND, House.USSR, 10, 10, {
      ammo: 6,
    });
    const ctx = makeCtx({ structures: [hpad] });
    expect(seekAircraftServiceDocking(ctx, heli)).toBe(false);
    expect(heli.mission).toBe(Mission.GUARD);
  });

  it('no transition for unarmed transport chinook — aircraft.cpp:3762 Is_Weapon_Equipped', () => {
    // C++ techno.cpp:3676-3681: Is_Weapon_Equipped returns Class->PrimaryWeapon != NULL.
    // TRAN (transport chinook) has no PrimaryWeapon — entity.weapon === null.
    const hpad = makeStructure('HPAD', House.USSR, 20, 20);
    const tran = makeAircraft(UnitType.V_TRAN, House.USSR, 10, 10);
    tran.ammo = 0;
    expect(tran.weapon).toBeNull();
    const ctx = makeCtx({ structures: [hpad] });
    expect(seekAircraftServiceDocking(ctx, tran)).toBe(false);
    expect(tran.mission).toBe(Mission.GUARD);
  });

  it('only ALLIED helipad → no transition (friendly=false rule) — aircraft.cpp:3764', () => {
    // C++ friendly=false → building->House == this->House (own house only).
    const allies = new Map<House, Set<House>>([
      [House.USSR, new Set([House.USSR, House.Ukraine])],
      [House.Ukraine, new Set([House.USSR, House.Ukraine])],
    ]);
    const alliedHpad = makeStructure('HPAD', House.Ukraine, 20, 20);
    const heli = makeAircraft(UnitType.V_HIND, House.USSR, 10, 10, { ammo: 0 });
    const ctx = makeCtx({
      structures: [alliedHpad],
      isAllied: (a, b) => allies.get(a)?.has(b) ?? a === b,
    });
    expect(seekAircraftServiceDocking(ctx, heli)).toBe(false);
    expect(heli.mission).toBe(Mission.GUARD);
  });

  it('no transition when already in radio contact (aircraftDockingStructure>=0) — aircraft.cpp:3763', () => {
    const hpad = makeStructure('HPAD', House.USSR, 20, 20);
    const heli = makeAircraft(UnitType.V_HIND, House.USSR, 10, 10, { ammo: 0 });
    heli.aircraftDockingStructure = 0; // already heading to a docking bay
    const ctx = makeCtx({ structures: [hpad] });
    expect(seekAircraftServiceDocking(ctx, heli)).toBe(false);
    expect(heli.mission).toBe(Mission.GUARD);
    // The pre-existing docking target must be preserved.
    expect(heli.aircraftDockingStructure).toBe(0);
  });
});

describe('Branch ordering — aircraft.cpp:3737-3789', () => {
  it('damaged + out-of-ammo → repair branch wins (runs first in C++ source order)', () => {
    // C++ aircraft.cpp:3741 runs first; if a repair bay is found, return(1)
    // short-circuits the ammo-seek branch at line 3762.
    const fix = makeStructure('FIX', House.USSR, 30, 30);
    const hpad = makeStructure('HPAD', House.USSR, 20, 20);
    const heli = makeAircraft(UnitType.V_HIND, House.USSR, 10, 10, {
      hpRatio: RULE_CONDITION_YELLOW,
      ammo: 0,
    });
    const ctx = makeCtx({
      structures: [fix, hpad],
      availableMoney: () => 500,
    });
    expect(seekAircraftServiceDocking(ctx, heli)).toBe(true);
    expect(heli.mission).toBe(Mission.ENTER);
    // structures[0] is the FIX — repair branch fired first.
    expect(heli.aircraftDockingStructure).toBe(0);
    expect(ctx.structures[heli.aircraftDockingStructure].type).toBe('FIX');
  });
});

describe('Player house exclusion — aircraft.cpp:3735 House->IsHuman early return', () => {
  it('player-controlled aircraft skip the seek block entirely', () => {
    // C++ aircraft.cpp:3735: if (House->IsHuman) return(Normal_Delay) — humans
    // never enter the auto-repair / auto-rearm seek logic.
    const fix = makeStructure('FIX', House.Spain, 20, 20);
    const heli = makeAircraft(UnitType.V_HIND, House.Spain, 10, 10, {
      hpRatio: RULE_CONDITION_YELLOW,
      ammo: 0,
    });
    expect(heli.isPlayerUnit).toBe(true);
    const ctx = makeCtx({
      structures: [fix],
      availableMoney: () => 500,
    });
    expect(seekAircraftServiceDocking(ctx, heli)).toBe(false);
    expect(heli.mission).toBe(Mission.GUARD);
  });
});
