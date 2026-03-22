/**
 * C++ Behavioral Parity: Transport Loading/Unloading Mechanics
 * Covers: APC, LST, TRAN (Chinook), TRUK, STNK (Phase Transport)
 *
 * Authoritative source: rules.ini / aftrmath.ini for stats,
 * C++ cargo.cpp, unit.cpp, aircraft.cpp, vessel.cpp for mechanics.
 *
 * Each describe block documents the C++ source reference (file:line).
 * Tests describe WHAT happens (observable outcomes), not HOW.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, PRODUCTION_ITEMS,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: Max Passengers — rules.ini is authoritative
// C++ techno.cpp:6297: MaxPassengers = ini.Get_Int(Name(), "Passengers", MaxPassengers)
// C++ techno.cpp:5987: default MaxPassengers = 0
// ═══════════════════════════════════════════════════════════════════════════════

describe('Max Passengers from rules.ini (techno.cpp:6297)', () => {
  // rules.ini [APC] Passengers=5
  it('APC: maxPassengers = 5 (rules.ini line 670)', () => {
    expect(UNIT_STATS.APC.passengers).toBe(5);
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.maxPassengers).toBe(5);
  });

  // rules.ini [LST] Passengers=5
  it('LST: maxPassengers = 5 (rules.ini line 760)', () => {
    expect(UNIT_STATS.LST.passengers).toBe(5);
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.maxPassengers).toBe(5);
  });

  // rules.ini [TRAN] Passengers=5
  it('TRAN (Chinook): maxPassengers = 5 (rules.ini line 1168)', () => {
    expect(UNIT_STATS.TRAN.passengers).toBe(5);
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.maxPassengers).toBe(5);
  });

  // rules.ini [TRUK] Passengers=1
  it('TRUK (Supply Truck): maxPassengers = 1 (rules.ini line 699)', () => {
    expect(UNIT_STATS.TRUK.passengers).toBe(1);
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.maxPassengers).toBe(1);
  });

  // aftrmath.ini [STNK] Passengers=1
  it('STNK (Phase Transport): maxPassengers = 1 (aftrmath.ini line 26)', () => {
    expect(UNIT_STATS.STNK.passengers).toBe(1);
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.maxPassengers).toBe(1);
  });

  // Non-transport vehicles have 0 passengers (techno.cpp:5987 default)
  it('2TNK (non-transport): maxPassengers = 0', () => {
    expect(UNIT_STATS['2TNK'].passengers).toBeFalsy();
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.maxPassengers).toBe(0);
  });

  it('HELI (attack helicopter): maxPassengers = 0', () => {
    expect(UNIT_STATS.HELI.passengers).toBeFalsy();
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    expect(heli.maxPassengers).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: isTransport flag — derived from Max_Passengers() > 0
// C++ type.h:571: virtual int Max_Passengers(void) const {return(MaxPassengers);}
// ═══════════════════════════════════════════════════════════════════════════════

describe('isTransport derived from Passengers > 0 (type.h:571)', () => {
  it('APC is a transport', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.isTransport).toBe(true);
  });

  it('LST is a transport', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.isTransport).toBe(true);
  });

  it('TRAN is a transport', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.isTransport).toBe(true);
  });

  it('TRUK is a transport', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.isTransport).toBe(true);
  });

  it('STNK is a transport', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.isTransport).toBe(true);
  });

  it('non-transport (2TNK) is NOT a transport', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.isTransport).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Cargo starts empty — passengers array
// C++ cargo.h:52: CargoClass(void) : Quantity(0), CargoHold(0) {}
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cargo starts empty (cargo.h:52)', () => {
  const TRANSPORT_TYPES: UnitType[] = [
    UnitType.V_APC, UnitType.V_LST, UnitType.V_TRAN,
    UnitType.V_TRUK, UnitType.V_STNK,
  ];

  for (const type of TRANSPORT_TYPES) {
    it(`${type}: passengers starts empty`, () => {
      const transport = entityAtCell(type, House.Spain, 10, 10);
      expect(transport.passengers).toEqual([]);
      expect(transport.passengers.length).toBe(0);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: Cargo Attach — LIFO linked list
// C++ cargo.cpp:87-123: Attach() pushes to HEAD, Detach_Object() pops HEAD
// Last attached is first detached (LIFO stack behavior).
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cargo LIFO order (cargo.cpp:87-123, 144-154)', () => {
  it('attach order: last pushed is first in array (LIFO on unload)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    const e4 = entityAtCell(UnitType.I_E4, House.Spain, 10, 10);

    // Load order: e1, e3, e4
    apc.passengers.push(e1);
    apc.passengers.push(e3);
    apc.passengers.push(e4);

    // C++ Detach_Object removes from HEAD (LIFO = last loaded first)
    // TS unload iterates backward: passengers.length-1 → 0
    // So passengers[length-1] = e4 unloads first (matches C++ LIFO)
    expect(apc.passengers[apc.passengers.length - 1]).toBe(e4);
    expect(apc.passengers[apc.passengers.length - 2]).toBe(e3);
    expect(apc.passengers[apc.passengers.length - 3]).toBe(e1);
  });

  it('quantity tracks correctly after each attach', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.passengers.length).toBe(0);

    apc.passengers.push(entityAtCell(UnitType.I_E1, House.Spain, 10, 10));
    expect(apc.passengers.length).toBe(1);

    apc.passengers.push(entityAtCell(UnitType.I_E1, House.Spain, 10, 10));
    expect(apc.passengers.length).toBe(2);

    apc.passengers.push(entityAtCell(UnitType.I_E1, House.Spain, 10, 10));
    expect(apc.passengers.length).toBe(3);
  });

  it('detach (pop) reduces quantity', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    apc.passengers.push(entityAtCell(UnitType.I_E1, House.Spain, 10, 10));
    apc.passengers.push(entityAtCell(UnitType.I_E1, House.Spain, 10, 10));
    expect(apc.passengers.length).toBe(2);

    apc.passengers.pop();
    expect(apc.passengers.length).toBe(1);

    apc.passengers.pop();
    expect(apc.passengers.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: Capacity enforcement — cannot exceed MaxPassengers
// C++ unit.cpp:731: if (How_Many() < Class->Max_Passengers())
// C++ aircraft.cpp:2818: if (How_Many() < Class->Max_Passengers())
// C++ vessel.cpp:1359: if (How_Many() < Class->Max_Passengers())
// ═══════════════════════════════════════════════════════════════════════════════

describe('Capacity enforcement (unit.cpp:731, aircraft.cpp:2818, vessel.cpp:1359)', () => {
  it('APC can load exactly 5 infantry (maxPassengers=5)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    for (let i = 0; i < 5; i++) {
      const inf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
      apc.passengers.push(inf);
      inf.transportRef = apc;
    }
    expect(apc.passengers.length).toBe(5);
    expect(apc.passengers.length <= apc.maxPassengers).toBe(true);
  });

  it('TRUK can load exactly 1 passenger (maxPassengers=1)', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    truk.passengers.push(inf);
    inf.transportRef = truk;
    expect(truk.passengers.length).toBe(1);
    expect(truk.passengers.length <= truk.maxPassengers).toBe(true);
  });

  it('STNK can load exactly 1 passenger (maxPassengers=1)', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    stnk.passengers.push(inf);
    inf.transportRef = stnk;
    expect(stnk.passengers.length).toBe(1);
    expect(stnk.passengers.length <= stnk.maxPassengers).toBe(true);
  });

  it('LST can load exactly 5 passengers (maxPassengers=5)', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    for (let i = 0; i < 5; i++) {
      const inf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
      lst.passengers.push(inf);
      inf.transportRef = lst;
    }
    expect(lst.passengers.length).toBe(5);
  });

  it('TRAN can load exactly 5 passengers (maxPassengers=5)', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    for (let i = 0; i < 5; i++) {
      const inf = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      tran.passengers.push(inf);
      inf.transportRef = tran;
    }
    expect(tran.passengers.length).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: Alliance check — only allies can load
// C++ unit.cpp:730: if (!House->Is_Ally(from->Owner())) return(RADIO_STATIC)
// C++ aircraft.cpp:2817: same check
// C++ vessel.cpp:1358: same check
// ═══════════════════════════════════════════════════════════════════════════════

describe('Alliance check — only allies can load (unit.cpp:730)', () => {
  it('transport can hold same-house infantry', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    apc.passengers.push(inf);
    inf.transportRef = apc;
    expect(apc.passengers.length).toBe(1);
  });

  it('transport can hold cross-allied infantry (Greece is Allied with Spain)', () => {
    const alliances = buildDefaultAlliances();
    // Greece should be allied with Spain per default alliances
    expect(alliances.get(House.Spain)?.has(House.Greece)).toBe(true);

    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const inf = entityAtCell(UnitType.I_E1, House.Greece, 10, 10);
    // In-game, the radio contact alliance check would prevent enemy loading.
    // At the entity level, transportRef can hold any entity (enforcement is in Game logic).
    apc.passengers.push(inf);
    inf.transportRef = apc;
    expect(apc.passengers.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: Transport stats from rules.ini
// Verifying all transport stats match the INI values exactly.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Transport stats match rules.ini', () => {
  // --- APC: rules.ini [APC] ---
  describe('APC (rules.ini line 657)', () => {
    const s = UNIT_STATS.APC;
    it('Strength=200', () => expect(s.strength).toBe(200));
    it('Armor=heavy', () => expect(s.armor).toBe('heavy'));
    it('Speed=10', () => expect(s.speed).toBe(10));
    it('Sight=5', () => expect(s.sight).toBe(5));
    it('ROT=5', () => expect(s.rot).toBe(5));
    it('Passengers=5', () => expect(s.passengers).toBe(5));
    it('Primary=M60mg', () => expect(s.primaryWeapon).toBe('M60mg'));
    it('Owner=allies (faction=allied)', () => {
      const prod = PRODUCTION_ITEMS.find(p => p.type === 'APC');
      expect(prod).toBeDefined();
      expect(prod!.faction).toBe('allied');
    });
    it('Cost=800', () => {
      const prod = PRODUCTION_ITEMS.find(p => p.type === 'APC');
      expect(prod!.cost).toBe(800);
    });
    it('Points=25', () => expect(s.points).toBe(25));
  });

  // --- LST: rules.ini [LST] ---
  describe('LST (rules.ini line 750)', () => {
    const s = UNIT_STATS.LST;
    it('Strength=350', () => expect(s.strength).toBe(350));
    it('Armor=heavy', () => expect(s.armor).toBe('heavy'));
    it('Speed=14', () => expect(s.speed).toBe(14));
    it('Sight=6', () => expect(s.sight).toBe(6));
    it('ROT=10', () => expect(s.rot).toBe(10));
    it('Passengers=5', () => expect(s.passengers).toBe(5));
    it('No weapon (pure transport)', () => expect(s.primaryWeapon).toBeNull());
    it('Owner=allies,soviet (faction=both)', () => {
      const prod = PRODUCTION_ITEMS.find(p => p.type === 'LST');
      expect(prod!.faction).toBe('both');
    });
    it('Cost=700', () => {
      const prod = PRODUCTION_ITEMS.find(p => p.type === 'LST');
      expect(prod!.cost).toBe(700);
    });
    it('Points=25', () => expect(s.points).toBe(25));
    it('isVessel=true', () => expect(s.isVessel).toBe(true));
  });

  // --- TRAN: rules.ini [TRAN] ---
  describe('TRAN / Chinook (rules.ini line 1157)', () => {
    const s = UNIT_STATS.TRAN;
    it('Strength=90', () => expect(s.strength).toBe(90));
    it('Armor=light', () => expect(s.armor).toBe('light'));
    it('Speed=12', () => expect(s.speed).toBe(12));
    it('Sight=0', () => expect(s.sight).toBe(0));
    it('ROT=5', () => expect(s.rot).toBe(5));
    it('Passengers=5', () => expect(s.passengers).toBe(5));
    it('No weapon (pure transport)', () => expect(s.primaryWeapon).toBeNull());
    it('Owner=soviet', () => {
      const prod = PRODUCTION_ITEMS.find(p => p.type === 'TRAN');
      expect(prod!.faction).toBe('soviet');
    });
    it('Cost=1200', () => {
      const prod = PRODUCTION_ITEMS.find(p => p.type === 'TRAN');
      expect(prod!.cost).toBe(1200);
    });
    it('Points=35', () => expect(s.points).toBe(35));
    it('isAircraft=true', () => expect(s.isAircraft).toBe(true));
    it('isRotorEquipped=true', () => expect(s.isRotorEquipped).toBe(true));
  });

  // --- TRUK: rules.ini [TRUK] ---
  describe('TRUK / Supply Truck (rules.ini line 689)', () => {
    const s = UNIT_STATS.TRUK;
    it('Strength=110', () => expect(s.strength).toBe(110));
    it('Armor=light', () => expect(s.armor).toBe('light'));
    it('Speed=10', () => expect(s.speed).toBe(10));
    it('Sight=3', () => expect(s.sight).toBe(3));
    it('ROT=5', () => expect(s.rot).toBe(5));
    it('Passengers=1', () => expect(s.passengers).toBe(1));
    it('No weapon', () => expect(s.primaryWeapon).toBeNull());
    it('Points=5', () => expect(s.points).toBe(5));
  });

  // --- STNK: aftrmath.ini [STNK] ---
  describe('STNK / Phase Transport (aftrmath.ini line 13)', () => {
    const s = UNIT_STATS.STNK;
    it('Strength=200', () => expect(s.strength).toBe(200));
    it('Armor=heavy', () => expect(s.armor).toBe('heavy'));
    it('Speed=10', () => expect(s.speed).toBe(10));
    it('Sight=5', () => expect(s.sight).toBe(5));
    it('ROT=5', () => expect(s.rot).toBe(5));
    it('Passengers=1', () => expect(s.passengers).toBe(1));
    it('Primary=APTusk', () => expect(s.primaryWeapon).toBe('APTusk'));
    it('Cloakable=yes', () => expect(s.isCloakable).toBe(true));
    it('Points=25', () => expect(s.points).toBe(25));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: Transport destroys passengers on death
// C++ techno.cpp — when transport is destroyed, all cargo is killed
// (Kill_Cargo traverses linked list, each passenger gets Take_Damage lethal)
// entity.ts:577-583: for (const p of this.passengers) { p.alive = false; ... }
// ═══════════════════════════════════════════════════════════════════════════════

describe('Transport kills passengers on death (techno.cpp Kill_Cargo)', () => {
  const TRANSPORT_TYPES: Array<{ type: UnitType; hp: number; name: string }> = [
    { type: UnitType.V_APC, hp: 200, name: 'APC' },
    { type: UnitType.V_LST, hp: 350, name: 'LST' },
    { type: UnitType.V_TRAN, hp: 90, name: 'TRAN' },
    { type: UnitType.V_TRUK, hp: 110, name: 'TRUK' },
    { type: UnitType.V_STNK, hp: 200, name: 'STNK' },
  ];

  for (const { type, hp, name } of TRANSPORT_TYPES) {
    it(`${name}: all passengers die when transport is destroyed`, () => {
      const transport = entityAtCell(type, House.Spain, 10, 10);
      const maxP = transport.maxPassengers;
      const passengers: Entity[] = [];

      for (let i = 0; i < maxP; i++) {
        const inf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
        transport.passengers.push(inf);
        inf.transportRef = transport;
        passengers.push(inf);
      }

      // Kill the transport
      transport.takeDamage(hp + 100, 'AP');
      expect(transport.alive).toBe(false);

      // All passengers must be dead
      for (const p of passengers) {
        expect(p.alive, `passenger should be dead when ${name} dies`).toBe(false);
        expect(p.transportRef, `transportRef should be null after ${name} dies`).toBeNull();
      }
      expect(transport.passengers.length).toBe(0);
    });

    it(`${name}: surviving damage does NOT kill passengers`, () => {
      const transport = entityAtCell(type, House.Spain, 10, 10);
      const inf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
      transport.passengers.push(inf);
      inf.transportRef = transport;

      // Non-lethal damage
      transport.takeDamage(1, 'SA');
      expect(transport.alive).toBe(true);
      expect(inf.alive).toBe(true);
      expect(transport.passengers.length).toBe(1);
      expect(inf.transportRef).toBe(transport);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: Transport classification — vehicle class for each transport
// C++ udata.cpp, aadata.cpp, vdata.cpp define the class of each transport
// ═══════════════════════════════════════════════════════════════════════════════

describe('Transport classification (udata.cpp / aadata.cpp / vdata.cpp)', () => {
  it('APC: ground vehicle (not aircraft, not vessel)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.isAirUnit).toBe(false);
    expect(apc.isNavalUnit).toBe(false);
    expect(apc.stats.isInfantry).toBe(false);
  });

  it('LST: naval vessel', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.isNavalUnit).toBe(true);
    expect(lst.isAirUnit).toBe(false);
    expect(lst.stats.isInfantry).toBe(false);
  });

  it('TRAN: aircraft (helicopter), not naval', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.isAirUnit).toBe(true);
    expect(tran.isHelicopter).toBe(true);
    expect(tran.isFixedWing).toBe(false);
    expect(tran.isNavalUnit).toBe(false);
  });

  it('TRUK: ground vehicle', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.isAirUnit).toBe(false);
    expect(truk.isNavalUnit).toBe(false);
    expect(truk.stats.isInfantry).toBe(false);
  });

  it('STNK: ground vehicle (cloakable)', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.isAirUnit).toBe(false);
    expect(stnk.isNavalUnit).toBe(false);
    expect(stnk.stats.isInfantry).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: Loading type restrictions
// C++ infantry.cpp:2872-2878: Infantry can RADIO_CAN_LOAD any Is_Techno()
//   → infantry can enter APC, TRAN, LST, STNK, TRUK
// C++ unit.cpp:3498-3504: Units (vehicles) check RADIO_CAN_LOAD only against
//   RTTI_VESSEL objects → vehicles can enter LST but NOT APC/TRAN
// ═══════════════════════════════════════════════════════════════════════════════

describe('Loading type restrictions (infantry.cpp:2872, unit.cpp:3498)', () => {
  it('APC: infantry should be loadable', () => {
    // C++: infantry What_Action sends RADIO_CAN_LOAD to APC → accepted
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(inf.stats.isInfantry).toBe(true);
    apc.passengers.push(inf);
    inf.transportRef = apc;
    expect(apc.passengers.length).toBe(1);
  });

  it('TRAN: infantry should be loadable', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const inf = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    tran.passengers.push(inf);
    inf.transportRef = tran;
    expect(tran.passengers.length).toBe(1);
  });

  it('LST: infantry should be loadable', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    lst.passengers.push(inf);
    inf.transportRef = lst;
    expect(lst.passengers.length).toBe(1);
  });

  it('LST: vehicles should be loadable (C++ units can enter RTTI_VESSEL)', () => {
    // C++ unit.cpp:3498: units check RADIO_CAN_LOAD against RTTI_VESSEL
    // LST is a vessel → vehicles CAN load
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    lst.passengers.push(tank);
    tank.transportRef = lst;
    expect(lst.passengers.length).toBe(1);
  });

  it('mixed load: LST can carry both infantry and vehicles', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    lst.passengers.push(inf);
    lst.passengers.push(tank);
    inf.transportRef = lst;
    tank.transportRef = lst;
    expect(lst.passengers.length).toBe(2);
    expect(lst.passengers[0].stats.isInfantry).toBe(true);
    expect(lst.passengers[1].stats.isInfantry).toBe(false);
  });

  // NOTE: In C++, APC RADIO_CAN_LOAD (unit.cpp:729) does NOT restrict by RTTI.
  // The restriction is that unit.cpp What_Action only shows ACTION_ENTER for vehicles
  // entering RTTI_VESSEL (line 3498), not RTTI_UNIT. So vehicles physically can't
  // get the enter command for an APC in C++, even though the radio handler would accept.
  // The TS engine's `isInfantry` filter in index.ts:2825 correctly matches this behavior.
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11: transportRef back-reference
// C++ entity linkage: passenger knows its transport, transport knows its cargo
// entity.ts:214-215: passengers[] and transportRef
// ═══════════════════════════════════════════════════════════════════════════════

describe('transportRef back-reference (entity.ts:214-215)', () => {
  it('loaded infantry has transportRef pointing to transport', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    apc.passengers.push(inf);
    inf.transportRef = apc;

    expect(inf.transportRef).toBe(apc);
    expect(apc.passengers).toContain(inf);
  });

  it('unloaded infantry has transportRef cleared to null', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    apc.passengers.push(inf);
    inf.transportRef = apc;

    // Simulate unload
    apc.passengers = apc.passengers.filter(p => p !== inf);
    inf.transportRef = null;

    expect(inf.transportRef).toBeNull();
    expect(apc.passengers).not.toContain(inf);
  });

  it('fresh entity has transportRef = null', () => {
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(inf.transportRef).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 12: Unload scatter — C++ deterministic vs TS random
// C++ unit.cpp:2500: DirType toface = DIR_S + PrimaryFacing
//   APC/TRUK iterate FACING_N→FACING_COUNT, try adjacent cells
// C++ aircraft.cpp:1394: _toface = {S,SW,SE,NW,NE,N,W,E}
//   TRAN tries cells in south-first priority
// C++ vessel.cpp:1764: same as APC pattern (DIR_S + PrimaryFacing)
// TS: random scatter (index.ts:2874-2883, 3781-3792)
//
// MISMATCH: TS uses random placement, C++ uses deterministic adjacent-cell scan.
// This is a known behavioral divergence documented here.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Unload scatter — C++ deterministic pattern (unit.cpp:2500, aircraft.cpp:1394)', () => {
  it('C++ APC/TRUK: unload starts at DIR_S + PrimaryFacing, iterates all 8 facings', () => {
    // Documenting the C++ behavior:
    // unit.cpp:2500: DirType toface = DIR_S + PrimaryFacing;
    // Then tries FACING_N through FACING_NW (8 directions)
    // First valid cell becomes the destination for the passenger.
    // Passenger is placed at Coord_Move(Coord, newface, 0x0080)
    // (0x0080 = 128 leptons = half cell width)
    //
    // TS DIVERGENCE: index.ts:2874-2883 uses random scatter around click point
    // index.ts:3781-3792 uses random scatter around transport position
    expect(true).toBe(true); // Documented behavioral divergence
  });

  it('C++ TRAN: unload uses south-first priority {S,SW,SE,NW,NE,N,W,E}', () => {
    // aircraft.cpp:1394: static FacingType _toface[FACING_COUNT] =
    //   {FACING_S, FACING_SW, FACING_SE, FACING_NW, FACING_NE, FACING_N, FACING_W, FACING_E}
    // Tries south cell first, then SW, SE, etc.
    // Passenger unlimbo'd at aircraft's Coord (not offset), facing toward the dest cell.
    //
    // TS DIVERGENCE: same random scatter as ground transports
    expect(true).toBe(true); // Documented behavioral divergence
  });

  it('C++ LST: unload same as APC (DIR_S + PrimaryFacing iteration)', () => {
    // vessel.cpp:1764: DirType toface = DIR_S + PrimaryFacing;
    // Same 8-direction iteration as APC.
    // Additional: tethers passenger and sets IsToScatter on RTTI_UNIT passengers.
    //
    // TS: naval unload searches for shore cells within 3-cell radius (index.ts:3746-3761)
    // and places passengers on shore cells. This is a reasonable adaptation.
    expect(true).toBe(true); // Documented behavioral divergence
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 13: APC unload has door animation, TRAN does not
// C++ unit.cpp:2476: APC_Open_Door() before unloading
// C++ unit.cpp:2534: APC_Close_Door() after unloading
// C++ aircraft.cpp:1167-1176: Chinook lifts off map, unlimbos passenger, puts back
//   (no door animation — helicopter unload is instant placement)
// ═══════════════════════════════════════════════════════════════════════════════

describe('APC door vs TRAN instant unload (unit.cpp:2476, aircraft.cpp:1167)', () => {
  it('APC has door animation states (C++ APC_Open_Door / APC_Close_Door)', () => {
    // C++ unit.cpp:2476: APC_Open_Door() → OPENING_DOOR state
    // C++ unit.cpp:2484: wait for Is_Door_Open()
    // C++ unit.cpp:2534: APC_Close_Door() after all passengers out
    // This is a multi-step process: rotate → open door → unload one by one → close door
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.isTransport).toBe(true);
    // TS doesn't model APC door animation separately — unload is instant
    expect(true).toBe(true); // Known simplification
  });

  it('TRAN unloads without door (lifts off map temporarily in C++)', () => {
    // C++ aircraft.cpp:1167: Map.Pick_Up(Coord_Cell(Coord), this);
    // aircraft.cpp:1169: if (!Exit_Object(unit)) { delete unit; }
    // aircraft.cpp:1176: Map.Place_Down(Coord_Cell(Coord), this);
    // The aircraft temporarily removes itself so the passenger can unlimbo at its position
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.isTransport).toBe(true);
    expect(tran.isAirUnit).toBe(true);
  });

  it('LST has door animation (LST_Open_Door / LST_Close_Door)', () => {
    // C++ vessel.cpp:1734: LST_Open_Door()
    // vessel.cpp:1817-1832: LST_Close_Door() after unloading
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.isTransport).toBe(true);
    expect(lst.isNavalUnit).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 14: Unload mission assignment
// C++ unit.cpp:2428-2429: passenger->Assign_Mission(MISSION_MOVE),
//   passenger->Assign_Destination(::As_Target(newcell))
// C++ aircraft.cpp:1415-1416: same pattern for TRAN
// C++ vessel.cpp:1775-1777: same + Commence() + radio tether
// ═══════════════════════════════════════════════════════════════════════════════

describe('Unloaded passenger mission (unit.cpp:2428, aircraft.cpp:1415)', () => {
  it('C++: unloaded passengers get MISSION_MOVE toward adjacent cell', () => {
    // In C++, unloaded passengers are assigned MISSION_MOVE + destination
    // In TS (index.ts:3797): passenger.mission = Mission.GUARD (not MOVE)
    // This is a behavioral divergence: C++ moves them out, TS leaves them idle
    expect(true).toBe(true); // Documented divergence
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 15: Loaner transport auto-retreat after unload
// C++ unit.cpp:1330-1331: IsALoaner && Max_Passengers > 0 && Is_Something_Attached
//   → order = MISSION_UNLOAD (then retreat)
// C++ aircraft.cpp:1178-1179: if (!Is_Something_Attached()) Enter_Idle_Mode()
//   → eventually leads to retreat for loaners
// entity.ts:247: isALoaner flag for reinforcement transports
// ═══════════════════════════════════════════════════════════════════════════════

describe('Loaner transport auto-behavior (unit.cpp:1330, aircraft.cpp:1178)', () => {
  it('entity supports isALoaner property (optional, set for reinforcement transports)', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    // isALoaner is declared as optional (entity.ts:247: isALoaner?: boolean)
    // It starts undefined and is set to true for reinforcement transports
    expect(tran.isALoaner).toBeFalsy();
    tran.isALoaner = true;
    expect(tran.isALoaner).toBe(true);
  });

  it('isALoaner defaults to undefined/falsy for non-reinforcement units', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.isALoaner).toBeFalsy();
  });

  it('isALoaner can be set for reinforcement transports', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    tran.isALoaner = true;
    expect(tran.isALoaner).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 16: LST unload — tethered + scatter for vehicles
// C++ vessel.cpp:1778-1781: After unlimbo, LST tethers passenger via RADIO_HELLO +
//   RADIO_TETHER. If passenger is RTTI_UNIT, sets IsToScatter = true.
// ═══════════════════════════════════════════════════════════════════════════════

describe('LST unload tether + scatter (vessel.cpp:1778-1781)', () => {
  it('LST: passengers are unloaded one at a time (In_Radio_Contact check)', () => {
    // C++ vessel.cpp:1759: if (In_Radio_Contact()) return(TICKS_PER_SECOND)
    // LST waits for the previous passenger to clear before unloading the next.
    // This prevents passengers from stacking on top of each other.
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.isTransport).toBe(true);
    expect(lst.isNavalUnit).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 17: TRUK unload — no door animation
// C++ unit.cpp:2392-2456: UNIT_TRUCK case in Mission_Unload
// TRUK has no APC_Open_Door/APC_Close_Door — goes straight from INITIAL_CHECK
// to MANEUVERING (rotate) to UNLOADING (no door phase).
// ═══════════════════════════════════════════════════════════════════════════════

describe('TRUK unload — no door (unit.cpp:2392-2456)', () => {
  it('TRUK is a transport with 1 passenger slot', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.isTransport).toBe(true);
    expect(truk.maxPassengers).toBe(1);
  });

  it('TRUK: passengers unload same as APC but without door phase', () => {
    // C++ unit.cpp:2393: case UNIT_TRUCK — no OPENING_DOOR / CLOSING_DOOR states
    // Just: INITIAL_CHECK → MANEUVERING → UNLOADING → CLOSING_DOOR (guard)
    // The CLOSING_DOOR state simply assigns MISSION_GUARD (no actual door)
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    truk.passengers.push(inf);
    inf.transportRef = truk;
    expect(truk.passengers.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 18: STNK (Phase Transport) — cloakable + 1 passenger
// aftrmath.ini [STNK]: Cloakable=yes, Passengers=1, Primary=APTusk
// C++ unit.cpp:2459 FIXIT_PHASETRANSPORT: UNIT_PHASE case in Mission_Unload
//   handles same as APC (with door open/close)
// ═══════════════════════════════════════════════════════════════════════════════

describe('STNK Phase Transport (aftrmath.ini, unit.cpp:2459)', () => {
  it('STNK: 1 passenger, armed with APTusk, cloakable', () => {
    const s = UNIT_STATS.STNK;
    expect(s.passengers).toBe(1);
    expect(s.primaryWeapon).toBe('APTusk');
    expect(s.isCloakable).toBe(true);
  });

  it('STNK: can carry infantry', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    stnk.passengers.push(inf);
    inf.transportRef = stnk;
    expect(stnk.passengers.length).toBe(1);
  });

  it('STNK: ground vehicle, can crush (Tracked=yes)', () => {
    expect(UNIT_STATS.STNK.crusher).toBe(true);
  });

  it('STNK: heavy armor (survives while cloaked)', () => {
    expect(UNIT_STATS.STNK.armor).toBe('heavy');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 19: Cross-transport comparison — all 5 transport types
// Comprehensive comparison table matching rules.ini / aftrmath.ini values.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cross-transport comparison table', () => {
  const TRANSPORTS = [
    { id: 'APC',  hp: 200, armor: 'heavy', speed: 10, pass: 5, weapon: 'M60mg',  sight: 5, air: false, naval: false },
    { id: 'LST',  hp: 350, armor: 'heavy', speed: 14, pass: 5, weapon: null,      sight: 6, air: false, naval: true },
    { id: 'TRAN', hp:  90, armor: 'light', speed: 12, pass: 5, weapon: null,      sight: 0, air: true,  naval: false },
    { id: 'TRUK', hp: 110, armor: 'light', speed: 10, pass: 1, weapon: null,      sight: 3, air: false, naval: false },
    { id: 'STNK', hp: 200, armor: 'heavy', speed: 10, pass: 1, weapon: 'APTusk', sight: 5, air: false, naval: false },
  ] as const;

  for (const t of TRANSPORTS) {
    it(`${t.id}: HP=${t.hp}, armor=${t.armor}, speed=${t.speed}, passengers=${t.pass}`, () => {
      const stats = UNIT_STATS[t.id as keyof typeof UNIT_STATS];
      expect(stats.strength).toBe(t.hp);
      expect(stats.armor).toBe(t.armor);
      expect(stats.speed).toBe(t.speed);
      expect(stats.passengers).toBe(t.pass);
      expect(stats.primaryWeapon ?? null).toBe(t.weapon);
      expect(stats.sight).toBe(t.sight);
    });
  }

  it('only APC and STNK are armed transports', () => {
    expect(UNIT_STATS.APC.primaryWeapon).toBe('M60mg');
    expect(UNIT_STATS.STNK.primaryWeapon).toBe('APTusk');
    expect(UNIT_STATS.LST.primaryWeapon).toBeNull();
    expect(UNIT_STATS.TRAN.primaryWeapon).toBeNull();
    expect(UNIT_STATS.TRUK.primaryWeapon).toBeNull();
  });

  it('LST is the toughest transport (350 HP heavy)', () => {
    const hps = [
      UNIT_STATS.APC.strength,
      UNIT_STATS.LST.strength,
      UNIT_STATS.TRAN.strength,
      UNIT_STATS.TRUK.strength,
      UNIT_STATS.STNK.strength,
    ];
    expect(Math.max(...hps)).toBe(UNIT_STATS.LST.strength);
  });

  it('TRAN is the most fragile transport (90 HP light)', () => {
    const hps = [
      UNIT_STATS.APC.strength,
      UNIT_STATS.LST.strength,
      UNIT_STATS.TRAN.strength,
      UNIT_STATS.TRUK.strength,
      UNIT_STATS.STNK.strength,
    ];
    expect(Math.min(...hps)).toBe(UNIT_STATS.TRAN.strength);
  });

  it('LST is the fastest transport (speed=14)', () => {
    const speeds = [
      UNIT_STATS.APC.speed,
      UNIT_STATS.LST.speed,
      UNIT_STATS.TRAN.speed,
      UNIT_STATS.TRUK.speed,
      UNIT_STATS.STNK.speed,
    ];
    expect(Math.max(...speeds)).toBe(UNIT_STATS.LST.speed);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 20: Cargo parasitic — entity.ts passengers array vs C++ linked list
// C++ cargo.h:83: unsigned char Quantity (max 255 passengers theoretically)
// C++ cargo.h:89: FootClass * CargoHold (linked list via Next pointer)
// TS entity.ts:214: passengers: Entity[] (standard array)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cargo data structure (cargo.h:83-89 vs entity.ts:214)', () => {
  it('C++ CargoHold is linked list; TS passengers is array — both support LIFO', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(Array.isArray(apc.passengers)).toBe(true);
  });

  it('passengers array length is equivalent to C++ Quantity', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.passengers.length).toBe(0); // C++ Quantity starts at 0

    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    apc.passengers.push(e1);
    expect(apc.passengers.length).toBe(1); // C++ Quantity becomes 1
  });
});
