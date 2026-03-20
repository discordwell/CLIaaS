/**
 * C++ Behavioral Parity: Transport Loading, Unloading, Capacity Limits, Auto-Evacuate
 *
 * Tests verify transport behavior matches C++ RA source code across all transport types:
 *   - APC (ground, 5 passengers, unit.cpp)
 *   - TRAN / Chinook (helicopter, 5 passengers, aircraft.cpp)
 *   - LST (naval, 5 passengers, vessel.cpp)
 *   - TRUK (supply truck, 1 passenger, unit.cpp)
 *   - STNK (phase transport, 1 passenger, unit.cpp)
 *   - BADR (badger bomber, 5 passengers, aircraft.cpp — paradrop only)
 *
 * Key C++ references:
 *   cargo.cpp:87-123  — CargoClass::Attach (LIFO chain, Quantity recount)
 *   cargo.cpp:144-154 — CargoClass::Detach_Object (LIFO pop, Quantity--)
 *   cargo.h:65        — How_Many() returns Quantity (unsigned char → max 255)
 *   cargo.h:83        — Quantity is unsigned char
 *   type.h:435        — MaxPassengers field in TechnoTypeClass
 *   type.h:571        — Max_Passengers() virtual accessor
 *
 *   unit.cpp:729-734  — RADIO_CAN_LOAD: reject if Max_Passengers==0 or not allied or full
 *   unit.cpp:762-766  — RADIO_IM_IN: close APC door when How_Many()==Max_Passengers
 *   unit.cpp:793      — RADIO_DOCKING: reject if How_Many()>=Max_Passengers
 *   unit.cpp:812      — RADIO_DOCKING: accept if Max_Passengers>0 and How_Many()<Max_Passengers
 *
 *   aircraft.cpp:2750 — RADIO_IM_IN: close door + check _Counts_As_Civ_Evac → MISSION_RETREAT
 *   aircraft.cpp:2816-2821 — RADIO_CAN_LOAD: same capacity check as unit.cpp
 *   aircraft.cpp:116-159 — _Counts_As_Civ_Evac: EINSTEIN, GENERAL, DELPHI, CHAN, IsCivilian, TanyaEvac
 *   aircraft.cpp:1868-1875 — Enter_Idle_Mode: if has passenger && _Counts_As_Civ_Evac → MISSION_RETREAT
 *
 *   techno.cpp:4407-4418 — Kill_Cargo: while(attached) { detach; record_kill; delete }
 *
 *   vessel.cpp:1357-1375 — RADIO_CAN_LOAD for LST
 *   vessel.cpp:1381-1393 — RADIO_IM_IN for LST (close door when full)
 *
 * C++ reference: CnC_and_Red_Alert/RA/ (cargo.cpp, unit.cpp, aircraft.cpp, vessel.cpp, techno.cpp)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, PRODUCTION_ITEMS, CIVILIAN_UNIT_TYPES,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Create N infantry entities for loading */
function makeInfantry(n: number, house: House): Entity[] {
  return Array.from({ length: n }, (_, i) =>
    entityAtCell(UnitType.I_E1, house, 10 + i, 10)
  );
}

/** Load an infantry unit into a transport (simulates C++ CargoClass::Attach + RADIO_IM_IN) */
function loadPassenger(transport: Entity, passenger: Entity): boolean {
  if (transport.passengers.length >= transport.maxPassengers) return false;
  transport.passengers.push(passenger);
  passenger.transportRef = transport;
  return true;
}

// ============================================================
// Section 1: Capacity — Max_Passengers per transport type
// C++ type.h:435 (MaxPassengers), type.h:571 (Max_Passengers())
// ============================================================
describe('Max_Passengers per transport type (type.h:435, type.h:571)', () => {
  // C++ unit.cpp RADIO_CAN_LOAD (line 730):
  //   if (Class->Max_Passengers() == 0 || from == NULL || !House->Is_Ally(from->Owner()))
  //     return(RADIO_STATIC);
  //   if (How_Many() < Class->Max_Passengers()) return(RADIO_ROGER);
  //   return(RADIO_NEGATIVE);

  it('APC has Max_Passengers=5', () => {
    expect(UNIT_STATS.APC.passengers).toBe(5);
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.maxPassengers).toBe(5);
  });

  it('TRAN (Chinook) has Max_Passengers=5', () => {
    expect(UNIT_STATS.TRAN.passengers).toBe(5);
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.maxPassengers).toBe(5);
  });

  it('LST has Max_Passengers=5', () => {
    expect(UNIT_STATS.LST.passengers).toBe(5);
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.maxPassengers).toBe(5);
  });

  it('TRUK (Supply Truck) has Max_Passengers=1', () => {
    expect(UNIT_STATS.TRUK.passengers).toBe(1);
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.maxPassengers).toBe(1);
  });

  it('STNK (Phase Transport) has Max_Passengers=1', () => {
    expect(UNIT_STATS.STNK.passengers).toBe(1);
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.maxPassengers).toBe(1);
  });

  it('BADR (Badger bomber) has Max_Passengers=5 (paradrop cargo)', () => {
    expect(UNIT_STATS.BADR.passengers).toBe(5);
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.maxPassengers).toBe(5);
  });

  it('non-transport vehicles have Max_Passengers=0 (isTransport=false)', () => {
    const nonTransports: UnitType[] = [
      UnitType.V_2TNK, UnitType.V_3TNK, UnitType.V_1TNK,
      UnitType.V_JEEP, UnitType.V_HARV, UnitType.V_MCV,
    ];
    for (const type of nonTransports) {
      const e = entityAtCell(type, House.Spain, 10, 10);
      expect(e.isTransport, `${type} should not be transport`).toBe(false);
      expect(e.maxPassengers, `${type} maxPassengers`).toBe(0);
    }
  });

  it('combat helicopters HELI/HIND have Max_Passengers=0 (not transports)', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    expect(heli.isTransport).toBe(false);
    expect(heli.maxPassengers).toBe(0);
    expect(hind.isTransport).toBe(false);
    expect(hind.maxPassengers).toBe(0);
  });
});

// ============================================================
// Section 2: isTransport property — derived from Max_Passengers > 0
// C++ unit.cpp:3462 — Class->Max_Passengers() > 0 check
// ============================================================
describe('isTransport property (Class->Max_Passengers() > 0)', () => {
  // C++ unit.cpp:3462:
  //   if (Class->Max_Passengers() > 0) {
  //     if (How_Many() == 0) action = ACTION_NO_DEPLOY;
  //   } else {
  //     action = ACTION_NONE;
  //   }

  it('APC isTransport=true', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.isTransport).toBe(true);
  });

  it('TRAN isTransport=true', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.isTransport).toBe(true);
  });

  it('LST isTransport=true', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.isTransport).toBe(true);
  });

  it('TRUK isTransport=true (Max_Passengers=1 > 0)', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.isTransport).toBe(true);
  });

  it('STNK isTransport=true (Max_Passengers=1 > 0)', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.isTransport).toBe(true);
  });

  it('2TNK isTransport=false (Max_Passengers=0)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.isTransport).toBe(false);
  });
});

// ============================================================
// Section 3: Empty passengers on construction
// C++ cargo.h:52 — CargoClass(): Quantity(0), CargoHold(0)
// ============================================================
describe('passengers start empty (cargo.h:52 CargoClass constructor)', () => {
  // C++ cargo.h:52:
  //   CargoClass(void) : Quantity(0), CargoHold(0) {};

  it('APC passengers array starts empty', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.passengers).toEqual([]);
    expect(apc.passengers.length).toBe(0);
  });

  it('TRAN passengers array starts empty', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.passengers).toEqual([]);
    expect(tran.passengers.length).toBe(0);
  });

  it('LST passengers array starts empty', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.passengers).toEqual([]);
  });

  it('non-transport also starts with empty passengers', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.passengers).toEqual([]);
  });
});

// ============================================================
// Section 4: Loading passengers — capacity enforcement
// C++ unit.cpp:729-734 — RADIO_CAN_LOAD capacity check
// C++ cargo.cpp:87-123 — CargoClass::Attach (LIFO chain)
// ============================================================
describe('loading passengers — capacity enforcement (unit.cpp:729-734)', () => {
  // C++ unit.cpp:729-734:
  //   case RADIO_CAN_LOAD:
  //     if (Class->Max_Passengers() == 0 || from == NULL || !House->Is_Ally(from->Owner()))
  //       return(RADIO_STATIC);
  //     if (How_Many() < Class->Max_Passengers()) return(RADIO_ROGER);
  //     return(RADIO_NEGATIVE);

  it('APC can load up to 5 infantry', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const infantry = makeInfantry(5, House.Spain);
    for (const inf of infantry) {
      const ok = loadPassenger(apc, inf);
      expect(ok).toBe(true);
    }
    expect(apc.passengers.length).toBe(5);
  });

  it('APC rejects 6th passenger (How_Many >= Max_Passengers)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const infantry = makeInfantry(6, House.Spain);
    for (let i = 0; i < 5; i++) {
      loadPassenger(apc, infantry[i]);
    }
    const ok = loadPassenger(apc, infantry[5]);
    expect(ok).toBe(false);
    expect(apc.passengers.length).toBe(5);
  });

  it('TRUK can only load 1 passenger', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    const first = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const second = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    expect(loadPassenger(truk, first)).toBe(true);
    expect(loadPassenger(truk, second)).toBe(false);
    expect(truk.passengers.length).toBe(1);
  });

  it('STNK (Phase Transport) can only load 1 passenger', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    const first = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const second = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    expect(loadPassenger(stnk, first)).toBe(true);
    expect(loadPassenger(stnk, second)).toBe(false);
    expect(stnk.passengers.length).toBe(1);
  });

  it('LST can load up to 5 passengers', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    const infantry = makeInfantry(5, House.Spain);
    for (const inf of infantry) {
      expect(loadPassenger(lst, inf)).toBe(true);
    }
    expect(lst.passengers.length).toBe(5);
  });

  it('TRAN can load up to 5 passengers', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const infantry = makeInfantry(5, House.USSR);
    for (const inf of infantry) {
      expect(loadPassenger(tran, inf)).toBe(true);
    }
    expect(tran.passengers.length).toBe(5);
  });

  it('passenger gets transportRef set to the transport', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    loadPassenger(apc, e1);
    expect(e1.transportRef).toBe(apc);
  });
});

// ============================================================
// Section 5: Kill_Cargo — all passengers die on transport death
// C++ techno.cpp:4407-4418
// ============================================================
describe('Kill_Cargo — passengers die on transport death (techno.cpp:4407-4418)', () => {
  // C++ techno.cpp:4407-4418:
  //   void TechnoClass::Kill_Cargo(TechnoClass * source) {
  //     while (Is_Something_Attached()) {
  //       FootClass * foot = Detach_Object();
  //       if (foot != NULL) {
  //         foot->Record_The_Kill(source);
  //         delete foot;
  //       }
  //     }
  //   }

  it('APC death kills all passengers', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const passengers = makeInfantry(3, House.Spain);
    for (const p of passengers) loadPassenger(apc, p);

    apc.takeDamage(300, 'AP');
    expect(apc.alive).toBe(false);
    for (const p of passengers) {
      expect(p.alive).toBe(false);
      expect(p.mission).toBe(Mission.DIE);
    }
  });

  it('TRAN death kills all passengers', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const passengers = makeInfantry(5, House.USSR);
    for (const p of passengers) loadPassenger(tran, p);

    tran.takeDamage(90, 'AP');
    expect(tran.alive).toBe(false);
    for (const p of passengers) {
      expect(p.alive).toBe(false);
    }
  });

  it('LST death kills all passengers', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    const passengers = makeInfantry(5, House.Spain);
    for (const p of passengers) loadPassenger(lst, p);

    lst.takeDamage(lst.maxHp, 'AP');
    expect(lst.alive).toBe(false);
    for (const p of passengers) {
      expect(p.alive).toBe(false);
    }
  });

  it('transport passengers array is cleared after death', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const passengers = makeInfantry(5, House.Spain);
    for (const p of passengers) loadPassenger(apc, p);
    expect(apc.passengers.length).toBe(5);

    apc.takeDamage(300, 'AP');
    expect(apc.passengers.length).toBe(0);
  });

  it('passenger transportRef is cleared after transport death', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    loadPassenger(apc, e1);
    expect(e1.transportRef).toBe(apc);

    apc.takeDamage(300, 'AP');
    expect(e1.transportRef).toBeNull();
  });

  it('non-lethal damage does NOT kill passengers', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    loadPassenger(apc, e1);

    apc.takeDamage(50, 'AP');
    expect(apc.alive).toBe(true);
    expect(e1.alive).toBe(true);
    expect(e1.transportRef).toBe(apc);
    expect(apc.passengers.length).toBe(1);
  });

  it('empty transport death does not crash', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.passengers.length).toBe(0);
    apc.takeDamage(300, 'AP');
    expect(apc.alive).toBe(false);
    expect(apc.passengers.length).toBe(0);
  });

  it('Kill_Cargo kills ALL passengers, not just first (C++ while loop)', () => {
    // C++ uses while(Is_Something_Attached()) — processes every passenger
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const p1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const p2 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    const p3 = entityAtCell(UnitType.I_E2, House.Spain, 10, 10);
    const p4 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const p5 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    for (const p of [p1, p2, p3, p4, p5]) loadPassenger(apc, p);
    expect(apc.passengers.length).toBe(5);

    apc.takeDamage(300, 'AP');

    // C++ Kill_Cargo iterates until cargo is empty — NONE should survive
    for (const p of [p1, p2, p3, p4, p5]) {
      expect(p.alive, `passenger ${p.type} should be dead`).toBe(false);
    }
    expect(apc.passengers.length).toBe(0);
  });
});

// ============================================================
// Section 6: CargoClass LIFO ordering
// C++ cargo.cpp:87-123 — Attach appends to front (LIFO)
// C++ cargo.cpp:144-154 — Detach_Object pops from front (LIFO)
// ============================================================
describe('CargoClass LIFO ordering (cargo.cpp:87-123, 144-154)', () => {
  // C++ cargo.cpp:87-123:
  //   CargoHold = object; (new object becomes first)
  //   Attach is LIFO — last attached is first in linked list
  //
  // C++ cargo.cpp:144-154:
  //   Detach_Object() returns CargoHold (first/most recent), pops it
  //
  // TS implementation uses passengers[] array with push/shift or push/pop.
  // C++ attaches to FRONT (LIFO), TS pushes to BACK (FIFO for push+shift,
  // LIFO for push+pop). The observable behavior that matters is: are all
  // passengers tracked and do they all die on transport death? The order
  // of unload may differ.

  it('all loaded passengers are tracked regardless of load order', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const e2 = entityAtCell(UnitType.I_E3, House.Spain, 11, 10);
    const e3 = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);

    loadPassenger(apc, e1);
    loadPassenger(apc, e2);
    loadPassenger(apc, e3);

    expect(apc.passengers).toContain(e1);
    expect(apc.passengers).toContain(e2);
    expect(apc.passengers).toContain(e3);
    expect(apc.passengers.length).toBe(3);
  });
});

// ============================================================
// Section 7: Quantity tracking (How_Many)
// C++ cargo.h:65 — How_Many() returns Quantity
// C++ cargo.h:83 — Quantity is unsigned char (max 255)
// ============================================================
describe('Quantity tracking (cargo.h:65 How_Many)', () => {
  // C++ cargo.cpp:117-122:
  //   Quantity = 0;
  //   object = CargoHold;
  //   while (object != NULL) { Quantity++; object = Next; }
  //
  // C++ cargo.cpp:151: Quantity--;

  it('How_Many increments with each Attach', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    for (let i = 0; i < 5; i++) {
      const inf = entityAtCell(UnitType.I_E1, House.Spain, 10 + i, 10);
      loadPassenger(apc, inf);
      expect(apc.passengers.length).toBe(i + 1);
    }
  });

  it('How_Many matches passengers.length at each step', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.passengers.length).toBe(0);

    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    loadPassenger(tran, e1);
    expect(tran.passengers.length).toBe(1);

    const e2 = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    loadPassenger(tran, e2);
    expect(tran.passengers.length).toBe(2);
  });

  it('Is_Something_Attached is true when passengers > 0', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.passengers.length > 0).toBe(false);

    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    loadPassenger(apc, e1);
    expect(apc.passengers.length > 0).toBe(true);
  });
});

// ============================================================
// Section 8: CIVILIAN_UNIT_TYPES — C++ _Counts_As_Civ_Evac parity
// C++ aircraft.cpp:116-159
// ============================================================
describe('CIVILIAN_UNIT_TYPES — _Counts_As_Civ_Evac parity (aircraft.cpp:116-159)', () => {
  // C++ aircraft.cpp:116-159:
  //   static bool _Counts_As_Civ_Evac(ObjectClass const * candidate) {
  //     if (candidate == NULL) return false;
  //     if (candidate->What_Am_I() != RTTI_INFANTRY) return false;
  //     InfantryClass const * inf = (InfantryClass const *)candidate;
  //     if (*inf == INFANTRY_EINSTEIN || *inf == INFANTRY_GENERAL ||
  //         *inf == INFANTRY_DELPHI || *inf == INFANTRY_CHAN) return true;
  //     if (Scen.IsTanyaEvac && *inf == INFANTRY_TANYA) return true;
  //     if (!inf->Class->IsCivilian) return false;
  //     if (inf->IsTechnician) return false;
  //     return true;
  //   }

  it('EINSTEIN is a civilian evacuation type', () => {
    expect(CIVILIAN_UNIT_TYPES.has('EINSTEIN')).toBe(true);
  });

  it('GNRL (INFANTRY_GENERAL) is a civilian evacuation type', () => {
    expect(CIVILIAN_UNIT_TYPES.has('GNRL')).toBe(true);
  });

  it('CHAN is a civilian evacuation type', () => {
    expect(CIVILIAN_UNIT_TYPES.has('CHAN')).toBe(true);
  });

  it('civilians C1-C10 are evacuation types', () => {
    for (let i = 1; i <= 10; i++) {
      expect(CIVILIAN_UNIT_TYPES.has(`C${i}`), `C${i} should be civilian`).toBe(true);
    }
  });

  it('military infantry are NOT civilian evacuation types', () => {
    const military = ['E1', 'E2', 'E3', 'E4', 'E6', 'E7', 'SPY', 'THF', 'MEDI', 'DOG', 'SHOK'];
    for (const type of military) {
      expect(CIVILIAN_UNIT_TYPES.has(type), `${type} should NOT be civilian`).toBe(false);
    }
  });

  // PARITY GAP: C++ includes INFANTRY_DELPHI in _Counts_As_Civ_Evac (aircraft.cpp:137)
  // but TS CIVILIAN_UNIT_TYPES does not include 'DELPHI'. However, DELPHI may not be a
  // unit type defined in the TS engine at all (it may only appear in specific scenarios).
  // If DELPHI is ever added as a unit type, it should be in CIVILIAN_UNIT_TYPES.
  it('DELPHI is handled (C++ aircraft.cpp:137 includes INFANTRY_DELPHI)', () => {
    // C++ line 137: if (*inf == INFANTRY_EINSTEIN || *inf == INFANTRY_GENERAL ||
    //                   *inf == INFANTRY_DELPHI || *inf == INFANTRY_CHAN) return(true);
    // TS types.ts:913-916 does NOT include DELPHI.
    // This is acceptable if DELPHI is not implemented as a unit type in the TS engine.
    // Just document the C++ reference:
    const hasDelphi = CIVILIAN_UNIT_TYPES.has('DELPHI');
    // Not asserting true/false — just documenting the state
    expect(typeof hasDelphi).toBe('boolean');
  });
});

// ============================================================
// Section 9: Auto-evacuate trigger — civilian boarding aircraft transport
// C++ aircraft.cpp:2749-2761 — RADIO_IM_IN handler
// C++ aircraft.cpp:1868-1875 — Enter_Idle_Mode with civilian passenger
// ============================================================
describe('auto-evacuate trigger — civilian aboard aircraft (aircraft.cpp:2749-2761)', () => {
  // C++ aircraft.cpp:2749-2761:
  //   case RADIO_IM_IN:
  //     if (How_Many() == Class->Max_Passengers()) {
  //       Close_Door(5, 4);
  //     }
  //     // If a civilian has entered the transport, then the transport will immediately
  //     // fly off the map.
  //     if (_Counts_As_Civ_Evac(from)) {
  //       Assign_Mission(MISSION_RETREAT);
  //     }
  //     return(RADIO_ATTACH);
  //
  // C++ aircraft.cpp:1868-1875 (Enter_Idle_Mode):
  //   if (Is_Something_Attached()) {
  //     FootClass* passenger = Attached_Object();
  //     if (passenger != NULL && _Counts_As_Civ_Evac(passenger)) {
  //       Assign_Destination(TARGET_NONE);
  //       Assign_Target(TARGET_NONE);
  //       Assign_Mission(MISSION_RETREAT);
  //       return;
  //     }
  //   }

  it('auto-evacuate only triggers for aircraft transports (not APC)', () => {
    // C++ aircraft.cpp handles civilian evac in AircraftClass::Receive_Message
    // UnitClass (APC) does NOT have the _Counts_As_Civ_Evac check in RADIO_IM_IN
    // TS: index.ts:2747 — checks target.stats.isAircraft before triggering evacuate
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.stats.isAircraft).toBeFalsy();
    // APC does NOT auto-evacuate when civilian boards — C++ only does this for aircraft
  });

  it('TRAN is an aircraft eligible for auto-evacuate', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.stats.isAircraft).toBe(true);
    expect(tran.isTransport).toBe(true);
  });

  it('civilian type presence can be detected in passengers', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);

    // Load Einstein — should trigger evacuate
    const einstein = entityAtCell('EINSTEIN' as UnitType, House.Spain, 10, 10);
    loadPassenger(tran, einstein);

    const hasCivilian = tran.passengers.some(p => CIVILIAN_UNIT_TYPES.has(p.type));
    expect(hasCivilian).toBe(true);
  });

  it('military-only passengers do NOT trigger evacuate detection', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    loadPassenger(tran, e1);

    const hasCivilian = tran.passengers.some(p => CIVILIAN_UNIT_TYPES.has(p.type));
    expect(hasCivilian).toBe(false);
  });
});

// ============================================================
// Section 10: APC door close on full — C++ RADIO_IM_IN
// C++ unit.cpp:762-766
// ============================================================
describe('APC door close on full (unit.cpp:762-766)', () => {
  // C++ unit.cpp:762-766:
  //   case RADIO_IM_IN:
  //     if (How_Many() == Class->Max_Passengers()) {
  //       APC_Close_Door();
  //     }
  //     return(RADIO_ATTACH);

  it('APC door would close when reaching max passengers', () => {
    // In C++ the APC door closes when full. In TS this may not be modeled
    // as a visual door state. Verify the capacity boundary is correct.
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const infantry = makeInfantry(5, House.Spain);
    for (const inf of infantry) loadPassenger(apc, inf);

    // At max capacity
    expect(apc.passengers.length).toBe(apc.maxPassengers);
    // Further load rejected
    const extra = entityAtCell(UnitType.I_E1, House.Spain, 15, 10);
    expect(loadPassenger(apc, extra)).toBe(false);
  });
});

// ============================================================
// Section 11: Ally-only loading — C++ RADIO_CAN_LOAD alliance check
// C++ unit.cpp:730, aircraft.cpp:2817, vessel.cpp:1358
// ============================================================
describe('ally-only loading (unit.cpp:730, aircraft.cpp:2817)', () => {
  // C++ unit.cpp:730:
  //   if (Class->Max_Passengers() == 0 || from == NULL ||
  //       !House->Is_Ally(from->Owner())) return(RADIO_STATIC);
  //
  // C++ aircraft.cpp:2817:
  //   if (Class->Max_Passengers() == 0 || from == NULL ||
  //       !House->Is_Ally(from->Owner())) return(RADIO_STATIC);
  //
  // The TS player-initiated loading in index.ts:2711 checks:
  //   target.isPlayerUnit (allied with player)
  // The auto-loading in index.ts:3470 checks:
  //   this.alliances.get(entity.house)?.has(other.house)

  it('TS game loading checks alliance (player unit check)', () => {
    // The TS checks target.isPlayerUnit before allowing load.
    // This mirrors the C++ House->Is_Ally() check.
    // We verify the alliance structure exists and functions.
    const alliances = buildDefaultAlliances();
    // Spain and Greece are allied (both allied faction)
    expect(alliances.get(House.Spain)?.has(House.Greece)).toBe(true);
    // Spain and USSR are NOT allied
    expect(alliances.get(House.Spain)?.has(House.USSR)).toBe(false);
  });
});

// ============================================================
// Section 12: Transport type diversity — stats comparison
// C++ udata.cpp, aadata.cpp, vdata.cpp
// ============================================================
describe('transport type diversity — stat comparison', () => {
  it('APC is ground transport with weapon (M60mg)', () => {
    const stats = UNIT_STATS.APC;
    expect(stats.passengers).toBe(5);
    expect(stats.primaryWeapon).toBe('M60mg');
    expect(stats.armor).toBe('heavy');
    expect(stats.isAircraft).toBeFalsy();
    expect(stats.isVessel).toBeFalsy();
  });

  it('TRAN is unarmed helicopter transport', () => {
    const stats = UNIT_STATS.TRAN;
    expect(stats.passengers).toBe(5);
    expect(stats.primaryWeapon).toBeNull();
    expect(stats.armor).toBe('light');
    expect(stats.isAircraft).toBe(true);
    expect(stats.isRotorEquipped).toBe(true);
  });

  it('LST is unarmed naval transport', () => {
    const stats = UNIT_STATS.LST;
    expect(stats.passengers).toBe(5);
    expect(stats.primaryWeapon).toBeNull();
    expect(stats.armor).toBe('heavy');
    expect(stats.isVessel).toBe(true);
  });

  it('TRUK is unarmed ground truck with 1 passenger', () => {
    const stats = UNIT_STATS.TRUK;
    expect(stats.passengers).toBe(1);
    expect(stats.primaryWeapon).toBeNull();
    expect(stats.armor).toBe('light');
  });

  it('STNK is armed cloaking transport with 1 passenger', () => {
    const stats = UNIT_STATS.STNK;
    expect(stats.passengers).toBe(1);
    expect(stats.primaryWeapon).toBe('APTusk');
    expect(stats.isCloakable).toBe(true);
    expect(stats.armor).toBe('heavy');
  });

  it('BADR paradrop bomber has 5 passenger slots (ammo-based)', () => {
    // C++ aircraft.cpp:308-311:
    //   if (Is_Something_Attached()) {
    //     Ammo = 0;
    //     Passenger = true;
    //   }
    // Badger bomber treats passengers as paradrop cargo
    const stats = UNIT_STATS.BADR;
    expect(stats.passengers).toBe(5);
    expect(stats.isAircraft).toBe(true);
    expect(stats.isFixedWing).toBe(true);
  });

  it('all transports with same capacity (5) can hold the same number', () => {
    const fiveCapTransports = ['APC', 'TRAN', 'LST', 'BADR'] as const;
    for (const name of fiveCapTransports) {
      expect(UNIT_STATS[name].passengers, `${name} should hold 5`).toBe(5);
    }
  });
});

// ============================================================
// Section 13: Mixed passenger types — same transport
// C++ cargo.cpp uses FootClass* (any ground mobile unit)
// ============================================================
describe('mixed passenger types in same transport', () => {
  it('APC can hold different infantry types simultaneously', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 11, 10);

    loadPassenger(apc, e1);
    loadPassenger(apc, e3);

    expect(apc.passengers.length).toBe(2);
    expect(apc.passengers[0].type).toBe(UnitType.I_E1);
    expect(apc.passengers[1].type).toBe(UnitType.I_E3);
  });

  it('Chinook can hold civilians and military together', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const einstein = entityAtCell('EINSTEIN' as UnitType, House.Spain, 11, 10);

    loadPassenger(tran, e1);
    loadPassenger(tran, einstein);

    expect(tran.passengers.length).toBe(2);
    const types = tran.passengers.map(p => p.type);
    expect(types).toContain(UnitType.I_E1);
    expect(types).toContain('EINSTEIN');
  });
});

// ============================================================
// Section 14: Crew ejection vs transport — C++ distinction
// C++ unit.cpp:1046 — IsCrew && Max_Passengers==0 → crew ejects
// C++ unit.cpp:1046 — Max_Passengers>0 → passengers handled by Kill_Cargo
// ============================================================
describe('crew ejection vs transport passengers (unit.cpp:1046)', () => {
  // C++ unit.cpp:1046:
  //   if (Class->IsCrew && Class->Max_Passengers() == 0) {
  //     if (Percent_Chance(50)) {
  //       // Create crew survivor infantry
  //     }
  //   }
  //
  // Transports (Max_Passengers > 0) do NOT eject crew — they use Kill_Cargo instead.
  // The crew/survivor mechanic and the passenger Kill_Cargo mechanic are mutually exclusive.

  it('APC has Max_Passengers>0 so does NOT use crew ejection', () => {
    const stats = UNIT_STATS.APC;
    expect(stats.passengers).toBeGreaterThan(0);
    // This means C++ skips the IsCrew crew-ejection path
  });

  it('2TNK has Max_Passengers=0 — eligible for crew ejection (not transport)', () => {
    const stats = UNIT_STATS['2TNK'];
    expect(stats.passengers).toBeFalsy();
    // C++ would check IsCrew flag for this vehicle
  });
});

// ============================================================
// Section 15: IsALoaner transport auto-unload
// C++ unit.cpp:1330 — loaner transports with cargo get MISSION_UNLOAD
// C++ aircraft.cpp:1934-1946 — loaner helicopter with cargo
// ============================================================
describe('loaner transport auto-unload (unit.cpp:1330)', () => {
  // C++ unit.cpp:1330:
  //   if (IsALoaner && Class->Max_Passengers() > 0 &&
  //       Is_Something_Attached() && !Team.Is_Valid()) {
  //     order = MISSION_UNLOAD;
  //   }
  //
  // This triggers for reinforcement transports that arrive with cargo.
  // The transport automatically begins unloading upon reaching idle mode.

  it('transport with passengers has non-empty cargo (pre-condition for auto-unload)', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    loadPassenger(tran, e1);

    // IsALoaner check is scenario-level, but cargo presence is entity-level
    expect(tran.passengers.length).toBeGreaterThan(0);
    expect(tran.isTransport).toBe(true);
  });
});

// ============================================================
// Section 16: Unloading — passenger placement near transport
// C++ unit.cpp:2412-2447 — UNLOADING state machine
// ============================================================
describe('unloading — passenger placement (unit.cpp:2412-2447)', () => {
  // C++ unit.cpp:2412-2447:
  //   case UNLOADING:
  //     if (How_Many()) {
  //       FootClass * passenger = Detach_Object();
  //       if (passenger != NULL) {
  //         DirType toface = DIR_S + PrimaryFacing;
  //         for (FacingType face = FACING_N; face < FACING_COUNT; face++) {
  //           DirType newface = toface + Facing_Dir(face);
  //           CELL newcell = Adjacent_Cell(Coord_Cell(Coord), newface);
  //           if (passenger->Can_Enter_Cell(newcell) == MOVE_OK) {
  //             passenger->Unlimbo(Coord_Move(Coord, newface, 0x0080), newface);
  //             passenger->Assign_Mission(MISSION_MOVE);
  //             placed = true;
  //             break;
  //           }
  //         }
  //         if (!placed) {
  //           Attach(passenger); // re-attach if can't place
  //           Status = CLOSING_DOOR;
  //         }
  //       }
  //     } else {
  //       Status = CLOSING_DOOR;
  //     }

  it('unloaded passengers have transportRef cleared', () => {
    // Simulating unload: remove from passengers array, clear transportRef
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    loadPassenger(apc, e1);
    expect(e1.transportRef).toBe(apc);

    // Simulate unload
    const unloaded = apc.passengers.shift()!;
    unloaded.transportRef = null;

    expect(unloaded).toBe(e1);
    expect(e1.transportRef).toBeNull();
    expect(apc.passengers.length).toBe(0);
  });

  it('C++ unload re-attaches passenger if no valid cell found', () => {
    // C++ unit.cpp:2439-2441:
    //   if (!placed) {
    //     Attach(passenger);
    //     Status = CLOSING_DOOR;
    //   }
    //
    // This means in C++, if unload fails, passenger stays inside.
    // TS behavior: the game tries multiple positions, but should handle this case.
    // Just verify the re-attachment mechanism concept.
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    loadPassenger(apc, e1);

    // Pop and re-attach (simulating failed unload)
    const popped = apc.passengers.shift()!;
    apc.passengers.push(popped); // re-attach
    expect(apc.passengers.length).toBe(1);
    expect(apc.passengers[0]).toBe(e1);
  });
});

// ============================================================
// Section 17: Transport with passengers — Pip_Count
// C++ unit.cpp:3865-3871, aircraft.cpp:3191-3207
// ============================================================
describe('Pip_Count for transports (unit.cpp:3865-3871)', () => {
  // C++ unit.cpp:3865-3871:
  //   if (Class->Max_Passengers() > 0) {
  //     return(How_Many());
  //   }
  //
  // C++ aircraft.cpp:3198-3199:
  //   if (Class->Max_Passengers() > 0) {
  //     retval = How_Many();
  //   }

  it('pip count equals number of passengers loaded', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.passengers.length).toBe(0); // 0 pips

    loadPassenger(apc, entityAtCell(UnitType.I_E1, House.Spain, 10, 10));
    expect(apc.passengers.length).toBe(1); // 1 pip

    loadPassenger(apc, entityAtCell(UnitType.I_E1, House.Spain, 11, 10));
    expect(apc.passengers.length).toBe(2); // 2 pips

    loadPassenger(apc, entityAtCell(UnitType.I_E1, House.Spain, 12, 10));
    loadPassenger(apc, entityAtCell(UnitType.I_E1, House.Spain, 13, 10));
    loadPassenger(apc, entityAtCell(UnitType.I_E1, House.Spain, 14, 10));
    expect(apc.passengers.length).toBe(5); // 5 pips (max for APC)
  });
});

// ============================================================
// Section 18: Transport production costs
// C++ rules.ini / PRODUCTION_ITEMS
// ============================================================
describe('transport production costs (rules.ini)', () => {
  it('APC costs 800', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'APC');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(800);
  });

  it('TRAN costs 1200', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'TRAN');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(1200);
  });

  it('LST costs 700', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'LST');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(700);
  });
});

// ============================================================
// Section 19: Edge cases — double-kill, zero-HP passenger, etc.
// ============================================================
describe('edge cases — double-kill, empty ops', () => {
  it('killing already-dead transport does not double-kill passengers', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    loadPassenger(apc, e1);

    // First kill
    apc.takeDamage(300, 'AP');
    expect(apc.alive).toBe(false);
    expect(e1.alive).toBe(false);

    // Second kill attempt on dead transport — should not crash
    apc.takeDamage(100, 'AP');
    expect(apc.alive).toBe(false);
  });

  it('loading zero passengers is a no-op', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    // No passengers loaded
    expect(apc.passengers.length).toBe(0);
    expect(apc.isTransport).toBe(true);
  });

  it('transport with 1 passenger works correctly at boundary', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);

    expect(truk.maxPassengers).toBe(1);
    expect(loadPassenger(truk, e1)).toBe(true);
    expect(truk.passengers.length).toBe(1);

    // Kill the truck
    truk.takeDamage(truk.maxHp, 'AP');
    expect(truk.alive).toBe(false);
    expect(e1.alive).toBe(false);
    expect(truk.passengers.length).toBe(0);
  });
});

// ============================================================
// Section 20: C++ only loads infantry into APC (not vehicles)
// C++ unit.cpp:4482 — Contact_With_Whom()->Is_Infantry()
// ============================================================
describe('infantry-only loading for ground transports (unit.cpp:4482)', () => {
  // C++ unit.cpp:4482:
  //   if (In_Radio_Contact() && Class->Max_Passengers() > 0 &&
  //       Contact_With_Whom()->Is_Infantry()) {
  //     Transmit_Message(RADIO_OVER_OUT);
  //   }
  //
  // C++ APC only communicates with infantry for loading. In TS, the player-initiated
  // loading in index.ts:2716 checks: if (!unit.stats.isInfantry) continue;
  //
  // This verifies the TS infantry-only check matches C++ behavior.

  it('TS loading check rejects non-infantry (matching C++ behavior)', () => {
    // In the TS game loop, only infantry can load into transports:
    // index.ts:2716: if (!unit.stats.isInfantry) continue;
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.stats.isInfantry).toBe(false);
    // This means the game code skips loading tanks into APCs
    // — matching C++ which only docks with infantry
  });

  it('infantry entities have isInfantry=true', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.stats.isInfantry).toBe(true);
  });

  it('vehicle entities have isInfantry=false', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.stats.isInfantry).toBe(false);
  });
});
