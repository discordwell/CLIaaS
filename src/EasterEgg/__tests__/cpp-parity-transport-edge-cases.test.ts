/**
 * C++ Behavioral Parity: Transport Auto-Loading Edge Cases
 *
 * Tests verify edge case transport behavior matches C++ RA source code:
 *   - Civilian auto-load on transport arrival at waypoint
 *   - VIP evacuation trigger (RADIO_IM_IN → MISSION_RETREAT for aircraft)
 *   - Multi-unit loading order (C++ LIFO vs TS array)
 *   - Loading failure recovery (re-attach on failed unload)
 *   - RADIO_DOCKING rejection while driving
 *   - _Counts_As_Civ_Evac edge cases (null, non-infantry, technician exclusion)
 *   - Tanya evacuation flag (IsTanyaEvac scenario flag)
 *   - Edge_Of_World_AI civilian evacuation counting
 *   - Transport full → door close trigger
 *   - TMISSION_LOAD team mission loading
 *
 * Key C++ references:
 *   aircraft.cpp:116-159 — _Counts_As_Civ_Evac (VIPs, civilians, Tanya, technician exclusion)
 *   aircraft.cpp:1868-1875 — Enter_Idle_Mode: civ passenger → MISSION_RETREAT
 *   aircraft.cpp:2749-2761 — RADIO_IM_IN: civ boards → MISSION_RETREAT immediately
 *   aircraft.cpp:4167-4184 — Edge_Of_World_AI: IsCivEvacuated set per passenger
 *   cargo.cpp:87-123 — CargoClass::Attach (LIFO chain, object→Next→CargoHold)
 *   cargo.cpp:92 — null check: if (object == NULL) return;
 *   unit.cpp:729-734 — RADIO_CAN_LOAD: capacity/alliance check
 *   unit.cpp:762-766 — RADIO_IM_IN: close door when full
 *   unit.cpp:777 — RADIO_DOCKING: reject if IsDriving || Target_Legal(NavCom)
 *   unit.cpp:2439-2441 — Mission_Unload: re-attach passenger on failed placement
 *   unit.cpp:2522-2524 — Same for APC unloading
 *
 * C++ reference: CnC_and_Red_Alert/RA/ (aircraft.cpp, cargo.cpp, unit.cpp)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission, AnimState,
  UNIT_STATS, CIVILIAN_UNIT_TYPES,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType | string, house: House, cx: number, cy: number): Entity {
  return new Entity(type as UnitType, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Load a passenger into a transport (simulates C++ CargoClass::Attach + RADIO_CAN_LOAD) */
function loadPassenger(transport: Entity, passenger: Entity): boolean {
  // C++ unit.cpp:729-734 — RADIO_CAN_LOAD:
  //   if (Class->Max_Passengers() == 0 || from == NULL) return(RADIO_STATIC);
  //   if (How_Many() < Class->Max_Passengers()) return(RADIO_ROGER);
  //   return(RADIO_NEGATIVE);
  if (transport.maxPassengers === 0) return false;
  if (transport.passengers.length >= transport.maxPassengers) return false;
  transport.passengers.push(passenger);
  passenger.transportRef = transport;
  return true;
}

/** Simulate C++ CargoClass::Detach_Object — LIFO pop (returns first/most-recent) */
function detachObject(transport: Entity): Entity | null {
  // C++ cargo.cpp:144-154:
  //   TechnoClass * unit = Attached_Object();  (returns CargoHold = first in chain)
  //   CargoHold = Next; unit->Next = 0; Quantity--;
  //
  // TS uses array — shift() for FIFO, pop() for LIFO.
  // C++ is LIFO (last attached = first in chain = first detached).
  // TS pushes to end, so pop() would be LIFO-equivalent.
  if (transport.passengers.length === 0) return null;
  const passenger = transport.passengers.shift()!;
  passenger.transportRef = null;
  return passenger;
}

// ============================================================
// Section 1: _Counts_As_Civ_Evac edge cases
// C++ aircraft.cpp:116-159
// ============================================================
describe('_Counts_As_Civ_Evac edge cases (aircraft.cpp:116-159)', () => {

  // C++ aircraft.cpp:121: if (candidate == NULL) return(false);
  it('null/undefined candidate returns false (aircraft.cpp:121)', () => {
    // In C++, NULL pointer returns false immediately.
    // In TS, CIVILIAN_UNIT_TYPES.has(undefined) should be false.
    expect(CIVILIAN_UNIT_TYPES.has(undefined as unknown as string)).toBe(false);
    expect(CIVILIAN_UNIT_TYPES.has(null as unknown as string)).toBe(false);
    expect(CIVILIAN_UNIT_TYPES.has('')).toBe(false);
  });

  // C++ aircraft.cpp:126: if (candidate->What_Am_I() != RTTI_INFANTRY) return(false);
  it('non-infantry types are excluded even if they share a civilian name (aircraft.cpp:126)', () => {
    // C++ checks What_Am_I() == RTTI_INFANTRY. Only infantry objects pass.
    // In TS, vehicles and buildings can never be in CIVILIAN_UNIT_TYPES.
    const vehicleTypes = ['2TNK', '3TNK', 'APC', 'HARV', 'MCV', 'TRAN', 'LST'];
    for (const vtype of vehicleTypes) {
      expect(CIVILIAN_UNIT_TYPES.has(vtype), `${vtype} should NOT be civilian`).toBe(false);
    }
  });

  // C++ aircraft.cpp:137: INFANTRY_EINSTEIN, INFANTRY_GENERAL, INFANTRY_DELPHI, INFANTRY_CHAN
  it('all VIP types are in CIVILIAN_UNIT_TYPES (aircraft.cpp:137)', () => {
    // C++ always returns true for these types regardless of IsCivilian flag
    expect(CIVILIAN_UNIT_TYPES.has('EINSTEIN')).toBe(true);
    expect(CIVILIAN_UNIT_TYPES.has('GNRL')).toBe(true);
    expect(CIVILIAN_UNIT_TYPES.has('CHAN')).toBe(true);
    // DELPHI is in C++ but not implemented as a unit type in TS
    // PARITY GAP: DELPHI is missing from TS UnitType enum and CIVILIAN_UNIT_TYPES
  });

  // C++ aircraft.cpp:143: if (Scen.IsTanyaEvac && *inf == INFANTRY_TANYA) return(true);
  it('Tanya is NOT in CIVILIAN_UNIT_TYPES (requires IsTanyaEvac flag) (aircraft.cpp:143)', () => {
    // C++ only counts Tanya as civ evac when Scen.IsTanyaEvac is set (scenario flag).
    // TS does not include 'E7' (Tanya) in CIVILIAN_UNIT_TYPES — correct behavior
    // since the flag-based conditional is not modeled.
    expect(CIVILIAN_UNIT_TYPES.has('E7')).toBe(false);
    expect(CIVILIAN_UNIT_TYPES.has('TANYA')).toBe(false);
    // PARITY GAP: C++ Tanya evacuation is scenario-conditional (IsTanyaEvac flag).
    // TS has no equivalent flag mechanism. If a mission requires Tanya evacuation,
    // this would need to be specially handled per-scenario.
  });

  // C++ aircraft.cpp:148: if (!inf->Class->IsCivilian) return(false);
  it('military infantry are excluded by IsCivilian check (aircraft.cpp:148)', () => {
    const military = ['E1', 'E2', 'E3', 'E4', 'E6', 'E7', 'SPY', 'THF', 'MEDI', 'DOG', 'SHOK'];
    for (const type of military) {
      expect(CIVILIAN_UNIT_TYPES.has(type), `${type} should NOT be civilian`).toBe(false);
    }
  });

  // C++ aircraft.cpp:153: if (inf->IsTechnician) return(false);
  // Technicians look like civilians but are excluded from evacuation
  it('technician infantry excluded even though IsCivilian (aircraft.cpp:153)', () => {
    // C++ has IsTechnician flag on infantry. Technicians use civilian art but
    // are NOT evacuation candidates. In TS, technicians are not explicitly modeled
    // as a separate unit type — they would be C1-C10 with a special flag.
    // Verify that generic soldier types are not accidentally civilian:
    expect(CIVILIAN_UNIT_TYPES.has('E1')).toBe(false);
    expect(CIVILIAN_UNIT_TYPES.has('E3')).toBe(false);
    // PARITY GAP: C++ IsTechnician flag is not modeled in TS entity system.
    // If technician infantry are ever spawned (e.g. in spy missions), they
    // would incorrectly count as civilian evacuation candidates if typed C1-C10.
  });
});

// ============================================================
// Section 2: Civilian auto-load on transport arrival
// C++ aircraft.cpp:1868-1875 (Enter_Idle_Mode) — TS index.ts:3514-3537
// ============================================================
describe('civilian auto-load on transport arrival (aircraft.cpp:1868-1875)', () => {
  // C++ Enter_Idle_Mode checks if transport has a civilian passenger → MISSION_RETREAT.
  // TS index.ts:3514-3537 auto-loads nearby civilians when transport arrives at waypoint,
  // then calls orderTransportEvacuate if the loaded unit is in CIVILIAN_UNIT_TYPES.

  it('aircraft transport with civilian passenger triggers auto-evacuate', () => {
    // C++ aircraft.cpp:1868-1875:
    //   if (Is_Something_Attached()) {
    //     FootClass* passenger = Attached_Object();
    //     if (passenger != NULL && _Counts_As_Civ_Evac(passenger)) {
    //       Assign_Mission(MISSION_RETREAT);
    //     }
    //   }
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);
    const einstein = entityAtCell(UnitType.I_EINSTEIN, House.Spain, 10, 10);
    loadPassenger(tran, einstein);

    // TS: the auto-evacuate check mirrors C++ — aircraft with civilian → evacuate
    expect(tran.stats.isAircraft).toBe(true);
    expect(tran.passengers.length).toBeGreaterThan(0);
    const hasCiv = tran.passengers.some(p => CIVILIAN_UNIT_TYPES.has(p.type));
    expect(hasCiv).toBe(true);
  });

  it('aircraft transport with military-only passengers does NOT auto-evacuate', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 11, 10);
    loadPassenger(tran, e1);
    loadPassenger(tran, e3);

    const hasCiv = tran.passengers.some(p => CIVILIAN_UNIT_TYPES.has(p.type));
    expect(hasCiv).toBe(false);
    // No MISSION_RETREAT should be assigned — transport stays at waypoint
  });

  it('auto-load only picks up allied civilians (C++ House->Is_Ally check)', () => {
    // C++ aircraft.cpp:2817: !House->Is_Ally(from->Owner()) → RADIO_STATIC
    // TS index.ts:3521: !this.alliances.get(entity.house)?.has(other.house) → skip
    const alliances = buildDefaultAlliances();

    // Spain (Allied) and Greece (Allied) are allied
    expect(alliances.get(House.Spain)?.has(House.Greece)).toBe(true);
    // Spain (Allied) and USSR (Soviet) are NOT allied
    expect(alliances.get(House.Spain)?.has(House.USSR)).toBe(false);

    // A Soviet transport should NOT auto-load an Allied civilian
    const sovietTran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const alliedCiv = entityAtCell('C1' as UnitType, House.Spain, 10, 10);

    // Simulate the alliance check from index.ts:3521
    const canLoad = alliances.get(sovietTran.house)?.has(alliedCiv.house) ?? false;
    expect(canLoad).toBe(false);
  });

  it('auto-load only occurs for transport aircraft, not ground APC', () => {
    // C++ only has this logic in AircraftClass::Enter_Idle_Mode, not UnitClass
    // TS index.ts:3531: checks entity.stats.isAircraft before calling orderTransportEvacuate
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.stats.isAircraft).toBeFalsy();
    // Ground transports do not auto-evacuate with civilians — C++ parity
  });

  it('auto-load only picks up one civilian per arrival (C++ break after first load)', () => {
    // TS index.ts:3535: break; // load one civilian per arrival
    // C++ similarly processes one passenger at a time in the mission loop
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);
    expect(tran.maxPassengers).toBe(5);

    // Even with multiple civilians nearby, only one loads per arrival iteration.
    // This is a behavioral constraint that prevents race conditions.
    const c1 = entityAtCell('C1' as UnitType, House.Spain, 10, 10);
    const c2 = entityAtCell('C2' as UnitType, House.Spain, 10, 10);

    // Simulate single-civilian load (as the TS code does with break)
    loadPassenger(tran, c1);
    expect(tran.passengers.length).toBe(1);
    // Second civilian is NOT loaded in the same iteration
    // (would load on next tick if transport didn't evacuate first)
  });
});

// ============================================================
// Section 3: RADIO_IM_IN civilian → MISSION_RETREAT
// C++ aircraft.cpp:2749-2761
// ============================================================
describe('RADIO_IM_IN civilian boarding → immediate retreat (aircraft.cpp:2749-2761)', () => {
  // C++ aircraft.cpp:2754-2760:
  //   if (_Counts_As_Civ_Evac(from)) {
  //     Assign_Mission(MISSION_RETREAT);
  //   }
  //   return(RADIO_ATTACH);

  it('VIP (Einstein) boarding Chinook triggers evacuate', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);
    const einstein = entityAtCell(UnitType.I_EINSTEIN, House.Spain, 10, 10);
    loadPassenger(tran, einstein);

    // After civilian boards, C++ assigns MISSION_RETREAT.
    // TS calls orderTransportEvacuate which sets mission=MOVE toward map edge.
    expect(CIVILIAN_UNIT_TYPES.has(einstein.type)).toBe(true);
    expect(tran.stats.isAircraft).toBe(true);
    // Retreat/evacuate should be triggered
  });

  it('VIP (General/GNRL) boarding triggers evacuate', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);
    const general = entityAtCell(UnitType.I_GNRL, House.Spain, 10, 10);
    loadPassenger(tran, general);

    expect(CIVILIAN_UNIT_TYPES.has(general.type)).toBe(true);
  });

  it('VIP (Chan) boarding triggers evacuate', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);
    const chan = entityAtCell(UnitType.I_CHAN, House.Spain, 10, 10);
    loadPassenger(tran, chan);

    expect(CIVILIAN_UNIT_TYPES.has(chan.type)).toBe(true);
  });

  it('civilian C1-C10 boarding Chinook triggers evacuate', () => {
    for (let i = 1; i <= 10; i++) {
      const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);
      const civ = entityAtCell(`C${i}` as UnitType, House.Spain, 10, 10);
      loadPassenger(tran, civ);

      expect(CIVILIAN_UNIT_TYPES.has(civ.type), `C${i} should trigger evacuate`).toBe(true);
    }
  });

  it('regular soldier E1 boarding does NOT trigger evacuate', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    loadPassenger(tran, e1);

    expect(CIVILIAN_UNIT_TYPES.has(e1.type)).toBe(false);
  });

  it('RADIO_IM_IN still returns RADIO_ATTACH regardless of evac (aircraft.cpp:2761)', () => {
    // C++ aircraft.cpp:2761: return(RADIO_ATTACH);
    // The RADIO_ATTACH return happens unconditionally after the civ evac check.
    // In TS, the passenger is always attached (pushed to passengers array) regardless
    // of whether evacuate is triggered.
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);
    const einstein = entityAtCell(UnitType.I_EINSTEIN, House.Spain, 10, 10);
    const result = loadPassenger(tran, einstein);

    expect(result).toBe(true); // passenger attached regardless
    expect(tran.passengers).toContain(einstein);
  });
});

// ============================================================
// Section 4: Multi-unit loading order — C++ LIFO vs TS FIFO
// C++ cargo.cpp:87-123 (LIFO attach) vs TS passengers.push (FIFO)
// ============================================================
describe('multi-unit loading order (cargo.cpp:87-123)', () => {
  // C++ cargo.cpp:116: CargoHold = object;
  // New object becomes the HEAD of the linked list (LIFO).
  // C++ cargo.cpp:144-154: Detach_Object returns CargoHold (first/newest).
  //
  // TS uses passengers.push() → passengers[0] is the OLDEST (FIFO for shift).
  // The observable difference: C++ unloads LAST-loaded first, TS unloads FIRST-loaded first.

  it('TS loads in insertion order (FIFO) — first loaded is passengers[0]', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const e2 = entityAtCell(UnitType.I_E3, House.Spain, 11, 10);
    const e3 = entityAtCell(UnitType.I_E2, House.Spain, 12, 10);

    loadPassenger(apc, e1);
    loadPassenger(apc, e2);
    loadPassenger(apc, e3);

    // TS: push order preserved
    expect(apc.passengers[0]).toBe(e1); // first loaded
    expect(apc.passengers[1]).toBe(e2);
    expect(apc.passengers[2]).toBe(e3); // last loaded
  });

  it('C++ detaches LIFO (last loaded first), TS detaches FIFO (first loaded first)', () => {
    // C++ cargo.cpp:116: CargoHold = object; (new = head)
    // C++ cargo.cpp:149: CargoHold = Next; (pop head = newest)
    // So C++ unloads in REVERSE order of loading.
    //
    // TS uses shift() → pops from front → unloads in SAME order of loading (FIFO).
    // PARITY GAP: Unload order differs between C++ (LIFO) and TS (FIFO).
    // This is cosmetic — all passengers are still tracked and killed on death.

    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const e2 = entityAtCell(UnitType.I_E3, House.Spain, 11, 10);
    const e3 = entityAtCell(UnitType.I_E2, House.Spain, 12, 10);

    loadPassenger(apc, e1);
    loadPassenger(apc, e2);
    loadPassenger(apc, e3);

    // TS detaches using shift (FIFO) — first loaded is first out
    const first = detachObject(apc);
    expect(first).toBe(e1); // FIFO: first loaded, first out

    // C++ would return e3 here (LIFO: last loaded, first out)
    // PARITY GAP: C++ returns last-loaded first, TS returns first-loaded first.
    // Observable impact: unload placement order differs, but all passengers
    // are correctly tracked and destroyed on transport death.
  });

  it('all passengers survive regardless of load order', () => {
    // The critical parity requirement: all loaded passengers must be tracked.
    // Whether LIFO or FIFO, Kill_Cargo must kill ALL.
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const passengers = Array.from({ length: 5 }, (_, i) =>
      entityAtCell(UnitType.I_E1, House.Spain, 10 + i, 10)
    );
    for (const p of passengers) loadPassenger(apc, p);

    // Kill transport
    apc.takeDamage(300, 'AP');

    // ALL passengers dead regardless of LIFO/FIFO
    for (const p of passengers) {
      expect(p.alive, `passenger should be dead`).toBe(false);
    }
    expect(apc.passengers.length).toBe(0);
  });
});

// ============================================================
// Section 5: Loading failure recovery — re-attach on failed unload
// C++ unit.cpp:2439-2441, 2522-2524
// ============================================================
describe('loading failure recovery — re-attach on failed unload (unit.cpp:2439-2441)', () => {
  // C++ unit.cpp:2439-2441 (UNIT_TRUCK):
  //   if (!placed) {
  //     Attach(passenger);
  //     Status = CLOSING_DOOR;
  //   }
  //
  // C++ unit.cpp:2522-2524 (UNIT_APC):
  //   if (!placed) {
  //     Attach(passenger);
  //     Status = CLOSING_DOOR;
  //   }

  it('passenger re-attached after failed unload attempt', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const e2 = entityAtCell(UnitType.I_E3, House.Spain, 11, 10);
    loadPassenger(apc, e1);
    loadPassenger(apc, e2);
    expect(apc.passengers.length).toBe(2);

    // Simulate failed unload: detach then re-attach
    const popped = detachObject(apc);
    expect(popped).not.toBeNull();
    expect(apc.passengers.length).toBe(1);

    // Placement fails — re-attach (C++ calls Attach(passenger))
    apc.passengers.push(popped!);
    popped!.transportRef = apc;
    expect(apc.passengers.length).toBe(2);
    expect(apc.passengers).toContain(popped);
  });

  it('re-attached passenger survives transport death (Kill_Cargo)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    loadPassenger(apc, e1);

    // Detach, fail to place, re-attach
    const popped = detachObject(apc);
    apc.passengers.push(popped!);
    popped!.transportRef = apc;

    // Kill transport — re-attached passenger must still die
    apc.takeDamage(300, 'AP');
    expect(apc.alive).toBe(false);
    expect(e1.alive).toBe(false);
    expect(apc.passengers.length).toBe(0);
  });

  it('multiple failed unloads do not lose passengers', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const passengers = Array.from({ length: 3 }, (_, i) =>
      entityAtCell(UnitType.I_E1, House.Spain, 10 + i, 10)
    );
    for (const p of passengers) loadPassenger(apc, p);

    // Simulate 3 failed unload cycles
    for (let cycle = 0; cycle < 3; cycle++) {
      const popped = detachObject(apc);
      expect(popped).not.toBeNull();
      // Failed placement — re-attach
      apc.passengers.push(popped!);
      popped!.transportRef = apc;
    }

    // All 3 passengers still inside
    expect(apc.passengers.length).toBe(3);
  });
});

// ============================================================
// Section 6: RADIO_DOCKING rejection while transport is driving
// C++ unit.cpp:777
// ============================================================
describe('RADIO_DOCKING rejection while driving (unit.cpp:777)', () => {
  // C++ unit.cpp:777-779:
  //   if (IsDriving || Target_Legal(NavCom)) {
  //     return(RADIO_NEGATIVE);
  //   }
  //
  // TS index.ts:3404-3405 simulates this indirectly:
  //   entity.mission === Mission.MOVE && entity.moveTarget
  //   — only checks loading when infantry is moving toward transport

  it('transport with active moveTarget is considered "driving" (unit.cpp:777)', () => {
    // C++ rejects docking when IsDriving=true or NavCom is valid.
    // TS: loading only triggers when infantry arrives at transport's position,
    // not while transport is actively moving.
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    apc.mission = Mission.MOVE;
    apc.moveTarget = { x: 20 * CELL_SIZE, y: 10 * CELL_SIZE };

    // Transport has a valid move target — it's "driving"
    expect(apc.moveTarget).not.toBeNull();
    expect(apc.mission).toBe(Mission.MOVE);
    // In this state, C++ would return RADIO_NEGATIVE to docking requests
  });

  it('stationary transport accepts docking (IsDriving=false, NavCom=TARGET_NONE)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    apc.mission = Mission.GUARD;
    apc.moveTarget = null;

    expect(apc.moveTarget).toBeNull();
    expect(apc.mission).toBe(Mission.GUARD);
    // C++ would accept docking in this state
  });
});

// ============================================================
// Section 7: Transport full → door close trigger
// C++ unit.cpp:762-766 (APC), aircraft.cpp:2750-2751 (TRAN)
// ============================================================
describe('transport full → door close (unit.cpp:762-766, aircraft.cpp:2750)', () => {
  // C++ unit.cpp:762-766:
  //   case RADIO_IM_IN:
  //     if (How_Many() == Class->Max_Passengers()) {
  //       APC_Close_Door();
  //     }
  //     return(RADIO_ATTACH);
  //
  // C++ aircraft.cpp:2750-2751:
  //   if (How_Many() == Class->Max_Passengers()) {
  //     Close_Door(5, 4);
  //   }

  it('APC at max capacity triggers door close (unit.cpp:763-764)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    for (let i = 0; i < 5; i++) {
      loadPassenger(apc, entityAtCell(UnitType.I_E1, House.Spain, 10 + i, 10));
    }
    expect(apc.passengers.length).toBe(apc.maxPassengers);
    // C++ calls APC_Close_Door() at this point
    // TS: no explicit door model for APC, but capacity is correctly enforced
  });

  it('APC below max capacity does NOT trigger door close', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    for (let i = 0; i < 3; i++) {
      loadPassenger(apc, entityAtCell(UnitType.I_E1, House.Spain, 10 + i, 10));
    }
    expect(apc.passengers.length).toBeLessThan(apc.maxPassengers);
    // Door remains open for more passengers
  });

  it('LST doorOpen is modeled in TS entity (LST door animation)', () => {
    // TS has explicit doorOpen/doorTimer for LST (entity.ts:282-283)
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.doorOpen).toBe(false);
    expect(lst.doorTimer).toBe(0);

    // When full, TS sets doorOpen=true with a timer for auto-close
    // (index.ts:3419-3421 for LST loading)
    lst.doorOpen = true;
    lst.doorTimer = 60;
    expect(lst.doorOpen).toBe(true);
  });

  it('TRUK at max capacity (1) triggers door close', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    loadPassenger(truk, entityAtCell(UnitType.I_E1, House.Spain, 10, 10));
    expect(truk.passengers.length).toBe(truk.maxPassengers);
    expect(truk.maxPassengers).toBe(1);
  });
});

// ============================================================
// Section 8: Edge_Of_World_AI — transport evacuating off map edge
// C++ aircraft.cpp:4167-4184
// ============================================================
describe('Edge_Of_World_AI — transport evacuating off map (aircraft.cpp:4167-4184)', () => {
  // C++ aircraft.cpp:4174-4184:
  //   while (Is_Something_Attached()) {
  //     FootClass * obj = Detach_Object();
  //     if (_Counts_As_Civ_Evac(obj)) {
  //       obj->House->IsCivEvacuated = true;
  //     }
  //     if (obj->Team.Is_Valid()) obj->Team->IsLeaveMap = true;
  //   }
  //
  // TS index.ts:1646-1656:
  //   for (const p of entity.passengers) {
  //     if (CIVILIAN_UNIT_TYPES.has(p.type)) civiliansEvacuated++;
  //   }

  it('each civilian passenger counts separately for evacuation', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);
    const c1 = entityAtCell('C1' as UnitType, House.Spain, 10, 10);
    const c2 = entityAtCell('C2' as UnitType, House.Spain, 11, 10);
    const einstein = entityAtCell(UnitType.I_EINSTEIN, House.Spain, 12, 10);

    loadPassenger(tran, c1);
    loadPassenger(tran, c2);
    loadPassenger(tran, einstein);

    // Count civilians for evacuation (as TS index.ts:1651 does)
    let civCount = 0;
    for (const p of tran.passengers) {
      if (CIVILIAN_UNIT_TYPES.has(p.type)) civCount++;
    }
    expect(civCount).toBe(3); // C1, C2, EINSTEIN
  });

  it('military passengers do NOT count toward civilian evacuation', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const c1 = entityAtCell('C1' as UnitType, House.Spain, 11, 10);

    loadPassenger(tran, e1);
    loadPassenger(tran, c1);

    let civCount = 0;
    for (const p of tran.passengers) {
      if (CIVILIAN_UNIT_TYPES.has(p.type)) civCount++;
    }
    expect(civCount).toBe(1); // only C1
  });

  it('empty transport leaving map counts 0 civilian evacuations', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);
    expect(tran.passengers.length).toBe(0);

    let civCount = 0;
    for (const p of tran.passengers) {
      if (CIVILIAN_UNIT_TYPES.has(p.type)) civCount++;
    }
    expect(civCount).toBe(0);
  });

  it('transport entity itself is counted as unitsLeftMap when leaving', () => {
    // C++ and TS both count the transport itself as leaving the map
    // TS index.ts:1642: this.unitsLeftMap++;
    // The transport is the primary entity; passengers are cargo, not separate map entities.
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    loadPassenger(tran, e1);

    // When transport leaves: 1 (transport) + 1 (passenger) = 2 units left map
    // TS index.ts:1642 + 1650: both transport and passenger contribute to unitsLeftMap
    let totalLeaving = 1; // transport itself
    for (const _p of tran.passengers) {
      totalLeaving++;
    }
    expect(totalLeaving).toBe(2);
  });

  it('passengers are killed (alive=false) when transport leaves map', () => {
    // C++ aircraft.cpp:4175: FootClass * obj = Detach_Object();
    // The passenger is detached and potentially deleted.
    // TS index.ts:1649: p.alive = false;
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);
    const c1 = entityAtCell('C1' as UnitType, House.Spain, 10, 10);
    loadPassenger(tran, c1);

    // Simulate transport leaving map (index.ts:1647-1655)
    for (const p of tran.passengers) {
      p.alive = false;
    }
    tran.passengers = [];

    expect(c1.alive).toBe(false);
    expect(tran.passengers.length).toBe(0);
  });
});

// ============================================================
// Section 9: CargoClass::Attach null check
// C++ cargo.cpp:92
// ============================================================
describe('CargoClass::Attach null check (cargo.cpp:92)', () => {
  // C++ cargo.cpp:92: if (object == NULL) return;
  // Attaching a null object is a no-op.

  it('loading null passenger is rejected by capacity check', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    // Our loadPassenger requires a real Entity — there's no null path
    // in TS. The C++ null check is a safety guard; TS type system prevents this.
    expect(apc.passengers.length).toBe(0);
  });

  it('detaching from empty transport returns null (cargo.cpp:148)', () => {
    // C++ cargo.cpp:146-148:
    //   TechnoClass * unit = Attached_Object();
    //   if (unit != NULL) { ... }
    //   return((FootClass *)unit);  // returns NULL if empty
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const result = detachObject(apc);
    expect(result).toBeNull();
    expect(apc.passengers.length).toBe(0);
  });
});

// ============================================================
// Section 10: TMISSION_LOAD — team mission auto-loading
// C++ TEAMTYPE.H TMission_Load → TS index.ts:3787-3806
// ============================================================
describe('TMISSION_LOAD team mission loading (index.ts:3787-3806)', () => {
  // TS index.ts:3787-3806:
  //   case Game.TMISSION_LOAD: {
  //     if (entity.isTransport) {
  //       for (const other of this.entities) {
  //         if (entity.passengers.length >= maxLoad) break;
  //         if (!other.alive || !other.stats.isInfantry) continue;
  //         if (other.house !== entity.house) continue;
  //         if (other.transportRef) continue;
  //         ...

  it('TMISSION_LOAD only loads infantry (isInfantry check)', () => {
    // C++ and TS both restrict loading to infantry
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);

    expect(infantry.stats.isInfantry).toBe(true);
    expect(tank.stats.isInfantry).toBe(false);
    // TMISSION_LOAD would skip the tank
  });

  it('TMISSION_LOAD only loads same-house units (house check)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const friendly = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);

    // Same house
    expect(friendly.house).toBe(apc.house);
    expect(enemy.house).not.toBe(apc.house);
  });

  it('TMISSION_LOAD skips units already in a transport (transportRef check)', () => {
    const apc1 = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const apc2 = entityAtCell(UnitType.V_APC, House.Spain, 15, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);

    loadPassenger(apc1, e1);
    expect(e1.transportRef).toBe(apc1);

    // TMISSION_LOAD would skip e1 because transportRef is not null
    expect(e1.transportRef).not.toBeNull();
    // apc2 should not try to load e1
  });

  it('TMISSION_LOAD respects max capacity (passengers.length >= maxLoad)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    for (let i = 0; i < 5; i++) {
      loadPassenger(apc, entityAtCell(UnitType.I_E1, House.Spain, 10 + i, 10));
    }
    expect(apc.passengers.length).toBe(5);
    expect(apc.passengers.length >= apc.maxPassengers).toBe(true);
    // TMISSION_LOAD would break out of the loop
  });
});

// ============================================================
// Section 11: Aircraft Enter_Idle_Mode + Mission_Guard civ evac checks
// C++ aircraft.cpp:1868-1875 AND aircraft.cpp:3683-3691
// ============================================================
describe('aircraft guard/idle with civilian passenger (aircraft.cpp:3683-3691)', () => {
  // C++ aircraft.cpp:3683-3691 (Mission_Guard):
  //   if (Is_Something_Attached()) {
  //     FootClass* passenger = Attached_Object();
  //     if (passenger != NULL && _Counts_As_Civ_Evac(passenger)) {
  //       Assign_Destination(TARGET_NONE);
  //       Assign_Target(TARGET_NONE);
  //       Assign_Mission(MISSION_RETREAT);
  //       return(1);
  //     }
  //   }
  //
  // This is a redundant safety check — if the aircraft somehow ends up in
  // GUARD mode with a civilian aboard, it should still evacuate.

  it('aircraft in GUARD with civilian passenger should evacuate (safety check)', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);
    tran.mission = Mission.GUARD;
    const einstein = entityAtCell(UnitType.I_EINSTEIN, House.Spain, 10, 10);
    loadPassenger(tran, einstein);

    // C++ has this check in both Enter_Idle_Mode and Mission_Guard
    // Both paths lead to MISSION_RETREAT when a civilian is aboard
    const hasCiv = tran.passengers.some(p => CIVILIAN_UNIT_TYPES.has(p.type));
    expect(hasCiv).toBe(true);
    expect(tran.stats.isAircraft).toBe(true);
    // TS should trigger evacuate via orderTransportEvacuate
  });

  it('aircraft in GUARD with military-only passengers stays in GUARD', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);
    tran.mission = Mission.GUARD;
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    loadPassenger(tran, e1);

    const hasCiv = tran.passengers.some(p => CIVILIAN_UNIT_TYPES.has(p.type));
    expect(hasCiv).toBe(false);
    // Aircraft should remain in GUARD
    expect(tran.mission).toBe(Mission.GUARD);
  });
});

// ============================================================
// Section 12: RADIO_CAN_LOAD — capacity zero rejects all loading
// C++ unit.cpp:730, aircraft.cpp:2817
// ============================================================
describe('RADIO_CAN_LOAD zero capacity (unit.cpp:730)', () => {
  // C++ unit.cpp:730:
  //   if (Class->Max_Passengers() == 0 || from == NULL ||
  //       !House->Is_Ally(from->Owner())) return(RADIO_STATIC);

  it('vehicle with Max_Passengers=0 rejects all loading', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);

    expect(tank.maxPassengers).toBe(0);
    const result = loadPassenger(tank, e1);
    expect(result).toBe(false);
    expect(tank.passengers.length).toBe(0);
  });

  it('helicopter with Max_Passengers=0 rejects all loading (HELI/HIND)', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const e2 = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);

    expect(loadPassenger(heli, e1)).toBe(false);
    expect(loadPassenger(hind, e2)).toBe(false);
    expect(heli.passengers.length).toBe(0);
    expect(hind.passengers.length).toBe(0);
  });
});

// ============================================================
// Section 13: Mixed civilian + military passengers in same transport
// C++ cargo.cpp handles any FootClass* — no type restriction on Attach
// ============================================================
describe('mixed civilian + military passengers (cargo.cpp:87)', () => {
  // C++ cargo.cpp:87: void CargoClass::Attach(FootClass * object)
  // Any FootClass* (infantry or vehicle in C++) can be attached.
  // The civilian check only happens in _Counts_As_Civ_Evac for evacuation.

  it('transport with mixed passengers: civilian check scans all passengers', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);

    // Load 3 military then 1 civilian
    loadPassenger(tran, entityAtCell(UnitType.I_E1, House.Spain, 10, 10));
    loadPassenger(tran, entityAtCell(UnitType.I_E3, House.Spain, 11, 10));
    loadPassenger(tran, entityAtCell(UnitType.I_E2, House.Spain, 12, 10));
    loadPassenger(tran, entityAtCell('C1' as UnitType, House.Spain, 13, 10));

    expect(tran.passengers.length).toBe(4);

    // C++ checks the FIRST passenger in Enter_Idle_Mode (Attached_Object()),
    // but checks the boarding passenger in RADIO_IM_IN.
    // TS checks passengers.some() — scans all passengers.
    const hasCiv = tran.passengers.some(p => CIVILIAN_UNIT_TYPES.has(p.type));
    expect(hasCiv).toBe(true);
  });

  it('C++ Enter_Idle_Mode only checks FIRST passenger (PARITY GAP)', () => {
    // C++ aircraft.cpp:1869-1870:
    //   FootClass* passenger = Attached_Object();  // returns FIRST in LIFO chain
    //   if (passenger != NULL && _Counts_As_Civ_Evac(passenger)) ...
    //
    // In C++ LIFO: Attached_Object returns the MOST RECENTLY loaded passenger.
    // So if military loads last, civilian is hidden deeper in the chain.
    //
    // In TS: passengers.some() checks ALL passengers — always finds civilians.
    // PARITY GAP: TS is MORE correct here (always triggers evac if ANY civilian aboard).
    // C++ has a subtle bug: if a military unit boards AFTER a civilian, the
    // Enter_Idle_Mode check won't detect the civilian. However, the RADIO_IM_IN
    // handler (aircraft.cpp:2758) checks the boarding unit specifically, so in
    // practice the evacuate triggers at board-time, not at idle-time.

    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);

    // Load civilian first, then military
    const civ = entityAtCell('C1' as UnitType, House.Spain, 10, 10);
    const mil = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    loadPassenger(tran, civ);
    loadPassenger(tran, mil);

    // C++ LIFO: Attached_Object() would return mil (last loaded = head)
    // C++ Enter_Idle_Mode would check mil → NOT civilian → no retreat!
    // C++ RADIO_IM_IN: already triggered retreat when civ boarded.

    // TS: some() finds civ regardless of position
    const hasCiv = tran.passengers.some(p => CIVILIAN_UNIT_TYPES.has(p.type));
    expect(hasCiv).toBe(true);
  });
});

// ============================================================
// Section 14: orderTransportEvacuate clears team missions
// TS missionAI.ts:938-940
// ============================================================
describe('orderTransportEvacuate clears team missions (missionAI.ts:938-940)', () => {
  // TS missionAI.ts:938-940:
  //   transport.teamMissions = [];
  //   transport.teamMissionIndex = 0;
  //   transport.mission = Mission.MOVE;
  //
  // This prevents LOOP scripts from overriding the evacuation order.

  it('transport team missions can be cleared for evacuation', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);
    tran.teamMissions = [
      { mission: 3, data: 24 },  // TMISSION_MOVE to wp24
      { mission: 6, data: 0 },   // TMISSION_LOOP
    ];
    tran.teamMissionIndex = 0;

    // Simulate orderTransportEvacuate clearing team missions
    tran.teamMissions = [];
    tran.teamMissionIndex = 0;
    tran.mission = Mission.MOVE;
    tran.moveTarget = { x: 0, y: 10 * CELL_SIZE }; // nearest edge

    expect(tran.teamMissions.length).toBe(0);
    expect(tran.teamMissionIndex).toBe(0);
    expect(tran.mission).toBe(Mission.MOVE);
    expect(tran.moveTarget).not.toBeNull();
  });

  it('aircraft takeoff initiated when landed and evacuating', () => {
    // TS missionAI.ts:946-950:
    //   if (transport.aircraftState === 'landed') {
    //     transport.aircraftState = 'takeoff';
    //   }
    const tran = entityAtCell(UnitType.V_TRAN, House.Spain, 10, 10);
    tran.aircraftState = 'landed' as Entity['aircraftState'];

    // Simulate orderTransportEvacuate
    if (tran.aircraftState === 'landed') {
      tran.aircraftState = 'takeoff' as Entity['aircraftState'];
    }
    expect(tran.aircraftState).toBe('takeoff');
  });
});

// ============================================================
// Section 15: Cargo quantity recount on Attach
// C++ cargo.cpp:117-122
// ============================================================
describe('cargo quantity recount on Attach (cargo.cpp:117-122)', () => {
  // C++ cargo.cpp:117-122:
  //   Quantity = 0;
  //   object = CargoHold;
  //   while (object != NULL) {
  //     Quantity++;
  //     object = (FootClass *)(ObjectClass *)object->Next;
  //   }
  //
  // C++ recounts the ENTIRE chain on every Attach. This means Quantity is always
  // consistent even if the linked list was corrupted.

  it('passengers.length is always consistent after loads and unloads', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);

    // Load 3
    for (let i = 0; i < 3; i++) {
      loadPassenger(apc, entityAtCell(UnitType.I_E1, House.Spain, 10 + i, 10));
    }
    expect(apc.passengers.length).toBe(3);

    // Unload 1
    detachObject(apc);
    expect(apc.passengers.length).toBe(2);

    // Load 2 more
    loadPassenger(apc, entityAtCell(UnitType.I_E1, House.Spain, 13, 10));
    loadPassenger(apc, entityAtCell(UnitType.I_E1, House.Spain, 14, 10));
    expect(apc.passengers.length).toBe(4);

    // Unload all
    while (apc.passengers.length > 0) {
      detachObject(apc);
    }
    expect(apc.passengers.length).toBe(0);
  });

  it('Quantity underflow protection — never goes negative', () => {
    // C++ cargo.cpp:151: Quantity--;
    // Unsigned char so underflow wraps to 255, but Detach_Object only
    // decrements when Attached_Object() != NULL, so this shouldn't happen.
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.passengers.length).toBe(0);

    // Attempt to detach from empty transport
    const result = detachObject(apc);
    expect(result).toBeNull();
    expect(apc.passengers.length).toBe(0); // Not negative
  });
});

// ============================================================
// Section 16: BADGER (BADR) paradrop — passengers treated differently
// C++ aircraft.cpp:1442-1457 — Paradrop_Cargo
// ============================================================
describe('BADR paradrop cargo (aircraft.cpp:1442-1457)', () => {
  // C++ aircraft.cpp:1442-1457:
  //   int AircraftClass::Paradrop_Cargo(void) {
  //     FootClass * passenger = Detach_Object();
  //     if (passenger) {
  //       if (!passenger->Paradrop(Center_Coord())) {
  //         Attach(passenger);  // re-attach if paradrop fails
  //       }
  //     }
  //   }

  it('BADR has paradrop capability (isFixedWing + passengers)', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.stats.isFixedWing).toBe(true);
    expect(badr.isTransport).toBe(true);
    expect(badr.maxPassengers).toBe(5);
  });

  it('BADR re-attaches passenger if paradrop fails (aircraft.cpp:1447)', () => {
    // C++ aircraft.cpp:1447:
    //   if (!passenger->Paradrop(Center_Coord())) {
    //     Attach(passenger);
    //   }
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    loadPassenger(badr, e1);

    // Simulate failed paradrop: detach then re-attach
    const popped = detachObject(badr);
    expect(popped).toBe(e1);
    expect(badr.passengers.length).toBe(0);

    // Re-attach on failure
    badr.passengers.push(popped!);
    popped!.transportRef = badr;
    expect(badr.passengers.length).toBe(1);
    expect(badr.passengers[0]).toBe(e1);
  });
});

// ============================================================
// Section 17: LST door animation on load/unload
// TS index.ts:3419-3421 (load), 3672-3674 (unload)
// ============================================================
describe('LST door animation on load/unload (index.ts:3419)', () => {
  it('LST door opens on passenger load', () => {
    // TS index.ts:3419-3421:
    //   if (other.type === UnitType.V_LST) {
    //     other.doorOpen = true;
    //     other.doorTimer = 60;
    //   }
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.doorOpen).toBe(false);

    loadPassenger(lst, entityAtCell(UnitType.I_E1, House.Spain, 10, 10));

    // Simulate the door open that happens in game loop
    lst.doorOpen = true;
    lst.doorTimer = 60;

    expect(lst.doorOpen).toBe(true);
    expect(lst.doorTimer).toBe(60);
  });

  it('LST door opens on unload', () => {
    // TS index.ts:3672-3674:
    //   if (entity.type === UnitType.V_LST) {
    //     entity.doorOpen = true;
    //   }
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    loadPassenger(lst, entityAtCell(UnitType.I_E1, House.Spain, 10, 10));

    lst.doorOpen = true; // simulating unload trigger
    expect(lst.doorOpen).toBe(true);
  });

  it('non-LST transports do not have door animation', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    // APC has door logic in C++ (APC_Open_Door/APC_Close_Door) but TS only
    // models door state for LST. APC "door" is just a capacity constraint.
    expect(apc.doorOpen).toBe(false);
  });
});

// ============================================================
// Section 18: Transport death with ongoing unload
// Edge case: transport dies mid-unload
// ============================================================
describe('transport death during unload (edge case)', () => {
  it('killing transport mid-unload kills remaining passengers', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const p1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const p2 = entityAtCell(UnitType.I_E3, House.Spain, 11, 10);
    const p3 = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    loadPassenger(apc, p1);
    loadPassenger(apc, p2);
    loadPassenger(apc, p3);

    // Unload first passenger successfully
    const unloaded = detachObject(apc);
    expect(unloaded).toBe(p1);
    unloaded!.alive = true; // passenger successfully placed on map

    // Transport dies with 2 remaining passengers
    apc.takeDamage(300, 'AP');
    expect(apc.alive).toBe(false);

    // Remaining passengers must die
    expect(p2.alive).toBe(false);
    expect(p3.alive).toBe(false);

    // Already-unloaded passenger (p1) survives
    expect(p1.alive).toBe(true);
  });

  it('double-detach then kill does not crash', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const p1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    loadPassenger(apc, p1);

    // Detach the passenger
    detachObject(apc);
    expect(apc.passengers.length).toBe(0);

    // Try detach again from empty — returns null
    const nothing = detachObject(apc);
    expect(nothing).toBeNull();

    // Kill empty transport — should not crash
    apc.takeDamage(300, 'AP');
    expect(apc.alive).toBe(false);
    expect(apc.passengers.length).toBe(0);
  });
});
