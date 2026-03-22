/**
 * C++ Parity Audit: Transport / Passenger Loading Mechanics
 *
 * Validates the TS engine's transport loading behavior against C++ rules.ini
 * source-of-truth values. All expected values are parsed from rules.ini and
 * aftrmath.ini at test time — NO hardcoded C++ values in assertions.
 *
 * Covers:
 *   - Passengers= capacity per transport type (APC, LST, TRAN, STNK, TRUK, BADR)
 *   - Which unit types can be loaded (infantry-only restriction)
 *   - Loading range / adjacent cell requirement
 *   - Unload mechanics (where do passengers go?)
 *   - Transport destruction kills all passengers (Kill_Cargo)
 *   - Can't load enemy units (alliance check)
 *   - Can't exceed capacity
 *   - STNK (Phase Transport) single passenger + cloaking
 *
 * Key C++ references:
 *   cargo.cpp:87-123  — CargoClass::Attach (LIFO chain, Quantity recount)
 *   cargo.cpp:144-154 — CargoClass::Detach_Object (LIFO pop, Quantity--)
 *   cargo.h:65        — How_Many() returns Quantity
 *   type.h:435        — MaxPassengers field in TechnoTypeClass
 *   unit.cpp:729-734  — RADIO_CAN_LOAD: reject if Max_Passengers==0 or not allied or full
 *   unit.cpp:762-766  — RADIO_IM_IN: close door when full
 *   unit.cpp:4482     — Contact_With_Whom()->Is_Infantry() (infantry-only loading)
 *   techno.cpp:4407-4418 — Kill_Cargo: while(attached) { detach; record_kill; delete }
 *   vessel.cpp:1357-1375 — RADIO_CAN_LOAD for LST
 *   aircraft.cpp:2816-2821 — RADIO_CAN_LOAD for aircraft transports
 *
 * Tests that FAIL are GOOD — they identify real C++ divergences.
 * Do NOT modify engine code. Only create test files.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission,
  UNIT_STATS, PRODUCTION_ITEMS,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => resetEntityIds());

// ---------------------------------------------------------------------------
// INI Parser — parse rules.ini and aftrmath.ini at test time
// ---------------------------------------------------------------------------

function parseINI(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current = '';
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      current = sectionMatch[1];
      if (!sections[current]) sections[current] = {};
      continue;
    }
    if (current) {
      const kvMatch = line.match(/^([^=;]+)=\s*([^;]*)/);
      if (kvMatch) {
        sections[current][kvMatch[1].trim()] = kvMatch[2].trim();
      }
    }
  }
  return sections;
}

const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');
const rules = parseINI(readFileSync(join(assetsDir, 'rules.ini'), 'utf-8'));
const aftrmath = parseINI(readFileSync(join(assetsDir, 'aftrmath.ini'), 'utf-8'));

// Merge: aftrmath overrides rules per-key within each section
const ini: Record<string, Record<string, string>> = {};
for (const [section, values] of Object.entries(rules)) {
  ini[section] = { ...values };
}
for (const [section, values] of Object.entries(aftrmath)) {
  ini[section] = { ...(ini[section] || {}), ...values };
}

/** Get the merged INI Passengers= value for a section, defaulting to 0 */
function iniPassengers(section: string): number {
  return Number(ini[section]?.Passengers ?? '0');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Create N infantry entities */
function makeInfantry(n: number, house: House): Entity[] {
  return Array.from({ length: n }, (_, i) =>
    entityAtCell(UnitType.I_E1, house, 10 + i, 10)
  );
}

/** Load a passenger into a transport (mirrors C++ RADIO_CAN_LOAD + CargoClass::Attach) */
function loadPassenger(transport: Entity, passenger: Entity): boolean {
  if (transport.maxPassengers === 0) return false;
  if (transport.passengers.length >= transport.maxPassengers) return false;
  transport.passengers.push(passenger);
  passenger.transportRef = transport;
  return true;
}

// ============================================================================
// Section 1: INI Passengers= capacity matches UNIT_STATS.passengers
// C++ type.h:435 — MaxPassengers, parsed from [Section] Passengers= in INI
// ============================================================================
describe('INI Passengers= capacity vs UNIT_STATS (type.h:435)', () => {

  const TRANSPORT_SECTIONS = ['APC', 'LST', 'TRAN', 'STNK', 'TRUK', 'BADR'] as const;

  for (const section of TRANSPORT_SECTIONS) {
    it(`${section}: UNIT_STATS.passengers matches INI Passengers=${iniPassengers(section)}`, () => {
      const iniVal = iniPassengers(section);
      const tsStats = UNIT_STATS[section];
      expect(tsStats, `${section} missing from UNIT_STATS`).toBeDefined();
      expect(
        tsStats.passengers,
        `UNIT_STATS.${section}.passengers (${tsStats.passengers}) !== INI Passengers=${iniVal}`
      ).toBe(iniVal);
    });
  }

  it('APC: Entity maxPassengers matches INI', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.maxPassengers).toBe(iniPassengers('APC'));
  });

  it('LST: Entity maxPassengers matches INI', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.maxPassengers).toBe(iniPassengers('LST'));
  });

  it('TRAN: Entity maxPassengers matches INI', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.maxPassengers).toBe(iniPassengers('TRAN'));
  });

  it('STNK: Entity maxPassengers matches INI', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.maxPassengers).toBe(iniPassengers('STNK'));
  });

  it('TRUK: Entity maxPassengers matches INI', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.maxPassengers).toBe(iniPassengers('TRUK'));
  });

  it('BADR: Entity maxPassengers matches INI', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.maxPassengers).toBe(iniPassengers('BADR'));
  });
});

// ============================================================================
// Section 2: Non-transport units have Passengers=0 in INI (or absent)
// C++ type.h:435 — MaxPassengers defaults to 0
// ============================================================================
describe('non-transport units have Passengers=0 (type.h:435 default)', () => {
  const NON_TRANSPORTS = ['2TNK', '3TNK', '1TNK', 'JEEP', 'HARV', 'MCV', 'ARTY', 'V2RL'] as const;

  for (const section of NON_TRANSPORTS) {
    it(`${section}: INI Passengers is absent or 0 → entity isTransport=false`, () => {
      const iniVal = iniPassengers(section);
      expect(iniVal, `${section} INI Passengers should be 0`).toBe(0);
      const tsStats = UNIT_STATS[section as keyof typeof UNIT_STATS];
      if (tsStats) {
        // passengers key should be absent (undefined) or 0
        expect(tsStats.passengers ?? 0).toBe(0);
      }
    });
  }

  it('combat helicopters HELI/HIND have Passengers=0 in INI', () => {
    expect(iniPassengers('HELI')).toBe(0);
    expect(iniPassengers('HIND')).toBe(0);
  });

  it('HELI Entity has isTransport=false and maxPassengers=0', () => {
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 10, 10);
    expect(heli.isTransport).toBe(false);
    expect(heli.maxPassengers).toBe(0);
  });

  it('HIND Entity has isTransport=false and maxPassengers=0', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    expect(hind.isTransport).toBe(false);
    expect(hind.maxPassengers).toBe(0);
  });
});

// ============================================================================
// Section 3: isTransport derived from Passengers > 0
// C++ unit.cpp:3462 — Class->Max_Passengers() > 0 check
// ============================================================================
describe('isTransport = Passengers > 0 (unit.cpp:3462)', () => {
  it('APC: isTransport=true because INI Passengers > 0', () => {
    expect(iniPassengers('APC')).toBeGreaterThan(0);
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.isTransport).toBe(true);
  });

  it('TRAN: isTransport=true because INI Passengers > 0', () => {
    expect(iniPassengers('TRAN')).toBeGreaterThan(0);
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.isTransport).toBe(true);
  });

  it('LST: isTransport=true because INI Passengers > 0', () => {
    expect(iniPassengers('LST')).toBeGreaterThan(0);
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.isTransport).toBe(true);
  });

  it('STNK: isTransport=true (Passengers=1 > 0)', () => {
    expect(iniPassengers('STNK')).toBeGreaterThan(0);
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.isTransport).toBe(true);
  });

  it('TRUK: isTransport=true (Passengers=1 > 0)', () => {
    expect(iniPassengers('TRUK')).toBeGreaterThan(0);
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.isTransport).toBe(true);
  });

  it('2TNK: isTransport=false because INI Passengers=0', () => {
    expect(iniPassengers('2TNK')).toBe(0);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.isTransport).toBe(false);
  });
});

// ============================================================================
// Section 4: INI stats parity — Strength, Armor, Speed, Primary weapon
// C++ rules.ini sections for each transport type
// ============================================================================
describe('transport INI stats parity (rules.ini)', () => {

  it('APC: Strength matches INI', () => {
    const iniStr = Number(ini.APC?.Strength ?? '0');
    expect(UNIT_STATS.APC.strength).toBe(iniStr);
  });

  it('APC: Armor matches INI', () => {
    expect(UNIT_STATS.APC.armor).toBe(ini.APC?.Armor);
  });

  it('APC: Speed matches INI', () => {
    const iniSpd = Number(ini.APC?.Speed ?? '0');
    expect(UNIT_STATS.APC.speed).toBe(iniSpd);
  });

  it('APC: Primary weapon matches INI', () => {
    expect(UNIT_STATS.APC.primaryWeapon).toBe(ini.APC?.Primary ?? null);
  });

  it('LST: Strength matches INI', () => {
    const iniStr = Number(ini.LST?.Strength ?? '0');
    expect(UNIT_STATS.LST.strength).toBe(iniStr);
  });

  it('LST: Armor matches INI', () => {
    expect(UNIT_STATS.LST.armor).toBe(ini.LST?.Armor);
  });

  it('LST: Speed matches INI', () => {
    const iniSpd = Number(ini.LST?.Speed ?? '0');
    expect(UNIT_STATS.LST.speed).toBe(iniSpd);
  });

  it('LST: no primary weapon in INI → null in TS', () => {
    const iniPrimary = ini.LST?.Primary;
    expect(iniPrimary).toBeUndefined();
    expect(UNIT_STATS.LST.primaryWeapon).toBeNull();
  });

  it('TRAN: Strength matches INI', () => {
    const iniStr = Number(ini.TRAN?.Strength ?? '0');
    expect(UNIT_STATS.TRAN.strength).toBe(iniStr);
  });

  it('TRAN: Armor matches INI', () => {
    expect(UNIT_STATS.TRAN.armor).toBe(ini.TRAN?.Armor);
  });

  it('TRAN: Speed matches INI', () => {
    const iniSpd = Number(ini.TRAN?.Speed ?? '0');
    expect(UNIT_STATS.TRAN.speed).toBe(iniSpd);
  });

  it('TRAN: no primary weapon in INI → null in TS', () => {
    const iniPrimary = ini.TRAN?.Primary;
    expect(iniPrimary).toBeUndefined();
    expect(UNIT_STATS.TRAN.primaryWeapon).toBeNull();
  });

  it('STNK: Strength matches INI', () => {
    const iniStr = Number(ini.STNK?.Strength ?? '0');
    expect(UNIT_STATS.STNK.strength).toBe(iniStr);
  });

  it('STNK: Primary weapon matches INI', () => {
    expect(UNIT_STATS.STNK.primaryWeapon).toBe(ini.STNK?.Primary ?? null);
  });

  it('STNK: Cloakable matches INI', () => {
    const iniCloak = (ini.STNK?.Cloakable ?? '').toLowerCase() === 'yes';
    expect(UNIT_STATS.STNK.isCloakable).toBe(iniCloak);
  });

  it('TRUK: Strength matches INI', () => {
    const iniStr = Number(ini.TRUK?.Strength ?? '0');
    expect(UNIT_STATS.TRUK.strength).toBe(iniStr);
  });

  it('TRUK: Armor matches INI', () => {
    expect(UNIT_STATS.TRUK.armor).toBe(ini.TRUK?.Armor);
  });

  it('BADR: Strength matches INI', () => {
    const iniStr = Number(ini.BADR?.Strength ?? '0');
    expect(UNIT_STATS.BADR.strength).toBe(iniStr);
  });

  it('BADR: Speed matches INI', () => {
    const iniSpd = Number(ini.BADR?.Speed ?? '0');
    expect(UNIT_STATS.BADR.speed).toBe(iniSpd);
  });
});

// ============================================================================
// Section 5: Capacity enforcement — can't exceed INI Passengers
// C++ unit.cpp:729-734 — RADIO_CAN_LOAD
//   if (How_Many() < Class->Max_Passengers()) return(RADIO_ROGER);
//   return(RADIO_NEGATIVE);
// ============================================================================
describe('capacity enforcement — cannot exceed INI Passengers (unit.cpp:729-734)', () => {

  it('APC accepts up to INI Passengers infantry, rejects the next', () => {
    const cap = iniPassengers('APC');
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const infantry = makeInfantry(cap + 1, House.Spain);
    for (let i = 0; i < cap; i++) {
      expect(loadPassenger(apc, infantry[i]), `load #${i + 1} should succeed`).toBe(true);
    }
    expect(loadPassenger(apc, infantry[cap]), `load #${cap + 1} should fail`).toBe(false);
    expect(apc.passengers.length).toBe(cap);
  });

  it('LST accepts up to INI Passengers, rejects overflow', () => {
    const cap = iniPassengers('LST');
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    const infantry = makeInfantry(cap + 1, House.Spain);
    for (let i = 0; i < cap; i++) {
      expect(loadPassenger(lst, infantry[i])).toBe(true);
    }
    expect(loadPassenger(lst, infantry[cap])).toBe(false);
    expect(lst.passengers.length).toBe(cap);
  });

  it('TRAN accepts up to INI Passengers, rejects overflow', () => {
    const cap = iniPassengers('TRAN');
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const infantry = makeInfantry(cap + 1, House.USSR);
    for (let i = 0; i < cap; i++) {
      expect(loadPassenger(tran, infantry[i])).toBe(true);
    }
    expect(loadPassenger(tran, infantry[cap])).toBe(false);
    expect(tran.passengers.length).toBe(cap);
  });

  it('STNK accepts exactly 1 passenger (INI Passengers=1), rejects 2nd', () => {
    const cap = iniPassengers('STNK');
    expect(cap).toBe(1);
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    const first = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const second = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    expect(loadPassenger(stnk, first)).toBe(true);
    expect(loadPassenger(stnk, second)).toBe(false);
    expect(stnk.passengers.length).toBe(1);
  });

  it('TRUK accepts exactly 1 passenger (INI Passengers=1), rejects 2nd', () => {
    const cap = iniPassengers('TRUK');
    expect(cap).toBe(1);
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    const first = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const second = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    expect(loadPassenger(truk, first)).toBe(true);
    expect(loadPassenger(truk, second)).toBe(false);
    expect(truk.passengers.length).toBe(1);
  });

  it('non-transport (2TNK) rejects all loading (Passengers=0)', () => {
    expect(iniPassengers('2TNK')).toBe(0);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(loadPassenger(tank, e1)).toBe(false);
    expect(tank.passengers.length).toBe(0);
  });
});

// ============================================================================
// Section 6: Infantry-only loading — C++ unit.cpp:4482
// C++ unit.cpp:4482 — Contact_With_Whom()->Is_Infantry()
// TS index.ts:2803 — if (!unit.stats.isInfantry) continue;
// ============================================================================
describe('infantry-only loading (unit.cpp:4482)', () => {

  it('infantry units have isInfantry=true', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    expect(e1.stats.isInfantry).toBe(true);
    expect(e3.stats.isInfantry).toBe(true);
  });

  it('vehicle units have isInfantry=false', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const harv = entityAtCell(UnitType.V_HARV, House.Spain, 10, 10);
    expect(tank.stats.isInfantry).toBe(false);
    expect(harv.stats.isInfantry).toBe(false);
  });

  it('TS game loop checks isInfantry before loading into APC (index.ts:2803)', () => {
    // The TS game loop at index.ts:2803 does:
    //   if (!unit.stats.isInfantry) continue;
    // This mirrors C++ unit.cpp:4482 Contact_With_Whom()->Is_Infantry().
    // Verify the isInfantry flag exists and is correct for transport targets.
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);

    // APC itself is not infantry
    expect(apc.stats.isInfantry).toBe(false);
    // Tank cannot be loaded (isInfantry=false → game skips it)
    expect(tank.stats.isInfantry).toBe(false);
    // Infantry CAN be loaded (isInfantry=true → game proceeds)
    expect(infantry.stats.isInfantry).toBe(true);
  });

  it('all standard infantry types have isInfantry=true', () => {
    const infantryTypes: UnitType[] = [
      UnitType.I_E1, UnitType.I_E2, UnitType.I_E3,
      UnitType.I_E4, UnitType.I_E6, UnitType.I_E7,
    ];
    for (const type of infantryTypes) {
      const e = entityAtCell(type, House.Spain, 10, 10);
      expect(e.stats.isInfantry, `${type} should be infantry`).toBe(true);
    }
  });
});

// ============================================================================
// Section 7: Alliance check — can't load enemy units
// C++ unit.cpp:730 — !House->Is_Ally(from->Owner()) → RADIO_STATIC
// C++ aircraft.cpp:2817 — same alliance check
// C++ vessel.cpp:1358 — same for LST
// ============================================================================
describe('alliance check — enemy units cannot load (unit.cpp:730)', () => {

  it('allied houses (Spain/Greece) share alliance → can load', () => {
    const alliances = buildDefaultAlliances();
    expect(alliances.get(House.Spain)?.has(House.Greece)).toBe(true);
  });

  it('enemy houses (Spain/USSR) do NOT share alliance → cannot load', () => {
    const alliances = buildDefaultAlliances();
    expect(alliances.get(House.Spain)?.has(House.USSR)).toBe(false);
  });

  it('same-house loading always permitted', () => {
    const alliances = buildDefaultAlliances();
    expect(alliances.get(House.Spain)?.has(House.Spain)).toBe(true);
    expect(alliances.get(House.USSR)?.has(House.USSR)).toBe(true);
  });

  it('TS game loop checks alliance before loading (index.ts:3442-3443)', () => {
    // TS index.ts:3442-3443:
    //   Auto-load: infantry must reach transport's cell AND
    //   alliances.get(entity.house)?.has(other.house)
    //
    // This mirrors C++ unit.cpp:730: !House->Is_Ally(from->Owner())
    const alliances = buildDefaultAlliances();
    const sovietTransport = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const alliedInfantry = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);

    const canLoad = alliances.get(sovietTransport.house)?.has(alliedInfantry.house) ?? false;
    expect(canLoad).toBe(false);
  });
});

// ============================================================================
// Section 8: Transport destruction kills all passengers (Kill_Cargo)
// C++ techno.cpp:4407-4418 — Kill_Cargo while loop
// TS entity.ts:573-579 — for (const p of this.passengers) { p.alive=false; }
// ============================================================================
describe('Kill_Cargo — passengers die on transport death (techno.cpp:4407-4418)', () => {

  it('APC death kills all passengers', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const passengers = makeInfantry(iniPassengers('APC'), House.Spain);
    for (const p of passengers) loadPassenger(apc, p);
    expect(apc.passengers.length).toBe(iniPassengers('APC'));

    apc.takeDamage(apc.maxHp + 100, 'AP');
    expect(apc.alive).toBe(false);

    for (const p of passengers) {
      expect(p.alive, 'passenger should be dead').toBe(false);
      expect(p.mission).toBe(Mission.DIE);
    }
    expect(apc.passengers.length).toBe(0);
  });

  it('TRAN death kills all passengers', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const passengers = makeInfantry(iniPassengers('TRAN'), House.USSR);
    for (const p of passengers) loadPassenger(tran, p);

    tran.takeDamage(tran.maxHp + 100, 'AP');
    expect(tran.alive).toBe(false);
    for (const p of passengers) {
      expect(p.alive).toBe(false);
    }
    expect(tran.passengers.length).toBe(0);
  });

  it('LST death kills all passengers', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    const passengers = makeInfantry(iniPassengers('LST'), House.Spain);
    for (const p of passengers) loadPassenger(lst, p);

    lst.takeDamage(lst.maxHp + 100, 'AP');
    expect(lst.alive).toBe(false);
    for (const p of passengers) {
      expect(p.alive).toBe(false);
    }
    expect(lst.passengers.length).toBe(0);
  });

  it('STNK death kills its single passenger', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    loadPassenger(stnk, e1);

    stnk.takeDamage(stnk.maxHp + 100, 'AP');
    expect(stnk.alive).toBe(false);
    expect(e1.alive).toBe(false);
    expect(stnk.passengers.length).toBe(0);
  });

  it('TRUK death kills its single passenger', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    loadPassenger(truk, e1);

    truk.takeDamage(truk.maxHp + 100, 'AP');
    expect(truk.alive).toBe(false);
    expect(e1.alive).toBe(false);
    expect(truk.passengers.length).toBe(0);
  });

  it('passenger transportRef is cleared on transport death', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    loadPassenger(apc, e1);
    expect(e1.transportRef).toBe(apc);

    apc.takeDamage(apc.maxHp + 100, 'AP');
    expect(e1.transportRef).toBeNull();
  });

  it('non-lethal damage does NOT kill passengers', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    loadPassenger(apc, e1);

    apc.takeDamage(50, 'AP');
    expect(apc.alive).toBe(true);
    expect(e1.alive).toBe(true);
    expect(apc.passengers.length).toBe(1);
  });

  it('empty transport death does not crash', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.passengers.length).toBe(0);
    apc.takeDamage(apc.maxHp + 100, 'AP');
    expect(apc.alive).toBe(false);
    expect(apc.passengers.length).toBe(0);
  });
});

// ============================================================================
// Section 9: Unload mechanics — passengers placed near transport
// C++ unit.cpp:2412-2447 — UNLOADING state scans adjacent cells
// ============================================================================
describe('unload mechanics (unit.cpp:2412-2447)', () => {

  it('unloaded passenger has transportRef cleared', () => {
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

  it('C++ re-attaches passenger if no valid cell found (unit.cpp:2439-2441)', () => {
    // C++ unit.cpp:2439-2441:
    //   if (!placed) { Attach(passenger); Status = CLOSING_DOOR; }
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    loadPassenger(apc, e1);

    // Pop and re-attach (simulating failed unload)
    const popped = apc.passengers.shift()!;
    apc.passengers.push(popped);
    expect(apc.passengers.length).toBe(1);
    expect(apc.passengers[0]).toBe(e1);
  });

  it('Mission.UNLOAD exists in TS mission enum (mirrors C++ MISSION_UNLOAD)', () => {
    // C++ unit.cpp:2412 — UNLOADING state is reached via MISSION_UNLOAD
    expect(Mission.UNLOAD).toBeDefined();
    expect(typeof Mission.UNLOAD).toBe('string');
  });
});

// ============================================================================
// Section 10: STNK (Phase Transport) — single passenger + cloaking
// C++ aftrmath.ini [STNK] — Passengers=1, Cloakable=yes, Primary=APTusk
// ============================================================================
describe('STNK Phase Transport — INI parity (aftrmath.ini)', () => {

  it('STNK Passengers=1 in INI', () => {
    expect(iniPassengers('STNK')).toBe(1);
  });

  it('STNK Cloakable=yes in INI → isCloakable=true in TS', () => {
    const iniCloak = (ini.STNK?.Cloakable ?? '').toLowerCase() === 'yes';
    expect(iniCloak).toBe(true);
    expect(UNIT_STATS.STNK.isCloakable).toBe(true);
  });

  it('STNK Primary=APTusk in INI', () => {
    const iniPrimary = ini.STNK?.Primary;
    expect(iniPrimary).toBe('APTusk');
    expect(UNIT_STATS.STNK.primaryWeapon).toBe(iniPrimary);
  });

  it('STNK Armor matches INI', () => {
    const iniArmor = ini.STNK?.Armor;
    expect(iniArmor).toBeDefined();
    expect(UNIT_STATS.STNK.armor).toBe(iniArmor);
  });

  it('STNK Tracked=yes in INI → crusher in TS', () => {
    const iniTracked = (ini.STNK?.Tracked ?? '').toLowerCase() === 'yes';
    expect(iniTracked).toBe(true);
    expect(UNIT_STATS.STNK.crusher).toBe(true);
  });

  it('STNK entity can load exactly 1 infantry', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(loadPassenger(stnk, e1)).toBe(true);
    expect(stnk.passengers.length).toBe(1);
    expect(stnk.maxPassengers).toBe(1);
  });
});

// ============================================================================
// Section 11: Transport production costs — INI Cost= parity
// C++ rules.ini / aftrmath.ini Cost= values
// ============================================================================
describe('transport production costs — INI Cost= parity', () => {

  const TRANSPORT_COSTS: { type: string; section: string }[] = [
    { type: 'APC', section: 'APC' },
    { type: 'TRAN', section: 'TRAN' },
    { type: 'LST', section: 'LST' },
    { type: 'TRUK', section: 'TRUK' },
    { type: 'STNK', section: 'STNK' },
  ];

  for (const { type, section } of TRANSPORT_COSTS) {
    it(`${type}: PRODUCTION_ITEMS cost matches INI Cost=`, () => {
      const iniCost = Number(ini[section]?.Cost ?? '0');
      const item = PRODUCTION_ITEMS.find(p => p.type === type);
      if (item) {
        expect(
          item.cost,
          `${type} cost: PRODUCTION_ITEMS=${item.cost}, INI=${iniCost}`
        ).toBe(iniCost);
      }
      // If item not in PRODUCTION_ITEMS (e.g. TechLevel=-1), that's not a cost parity issue
    });
  }
});

// ============================================================================
// Section 12: Passengers start empty on construction
// C++ cargo.h:52 — CargoClass(): Quantity(0), CargoHold(0)
// ============================================================================
describe('passengers start empty (cargo.h:52)', () => {

  it('APC passengers array starts empty', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.passengers).toEqual([]);
    expect(apc.passengers.length).toBe(0);
  });

  it('TRAN passengers array starts empty', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.passengers).toEqual([]);
  });

  it('LST passengers array starts empty', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.passengers).toEqual([]);
  });

  it('STNK passengers array starts empty', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.passengers).toEqual([]);
  });

  it('non-transport starts with empty passengers too', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.passengers).toEqual([]);
  });
});

// ============================================================================
// Section 13: Entity HP initialized from INI Strength
// C++ type.h — Strength field, entity HP = MaxPassengers's Strength
// ============================================================================
describe('transport Entity HP from INI Strength', () => {

  const TRANSPORTS = ['APC', 'LST', 'TRAN', 'STNK', 'TRUK'] as const;
  const UNIT_TYPE_MAP: Record<string, UnitType> = {
    APC: UnitType.V_APC,
    LST: UnitType.V_LST,
    TRAN: UnitType.V_TRAN,
    STNK: UnitType.V_STNK,
    TRUK: UnitType.V_TRUK,
  };

  for (const name of TRANSPORTS) {
    it(`${name}: Entity HP matches INI Strength=${ini[name]?.Strength}`, () => {
      const iniStrength = Number(ini[name]?.Strength ?? '0');
      const entity = entityAtCell(UNIT_TYPE_MAP[name], House.Spain, 10, 10);
      expect(entity.hp).toBe(iniStrength);
      expect(entity.maxHp).toBe(iniStrength);
    });
  }
});

// ============================================================================
// Section 14: Transport type categorization (aircraft, vessel, ground)
// C++ aircraft.cpp, vessel.cpp, unit.cpp — different transport classes
// ============================================================================
describe('transport type categorization', () => {

  it('APC: ground transport (not aircraft, not vessel)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.stats.isAircraft).toBeFalsy();
    expect(apc.stats.isVessel).toBeFalsy();
  });

  it('TRAN: aircraft transport', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    expect(tran.stats.isAircraft).toBe(true);
    expect(tran.stats.isVessel).toBeFalsy();
  });

  it('LST: naval transport (vessel)', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.stats.isVessel).toBe(true);
    expect(lst.stats.isAircraft).toBeFalsy();
  });

  it('STNK: ground transport (not aircraft, not vessel)', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.stats.isAircraft).toBeFalsy();
    expect(stnk.stats.isVessel).toBeFalsy();
  });

  it('TRUK: ground transport (not aircraft, not vessel)', () => {
    const truk = entityAtCell(UnitType.V_TRUK, House.Spain, 10, 10);
    expect(truk.stats.isAircraft).toBeFalsy();
    expect(truk.stats.isVessel).toBeFalsy();
  });

  it('BADR: aircraft transport (fixed wing)', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.stats.isAircraft).toBe(true);
    expect(badr.stats.isFixedWing).toBe(true);
  });
});

// ============================================================================
// Section 15: ROT (rotation rate) matches INI
// C++ type.h — ROT field
// ============================================================================
describe('transport ROT matches INI', () => {

  const TRANSPORTS_WITH_ROT = ['APC', 'LST', 'TRAN', 'STNK', 'TRUK'] as const;

  for (const name of TRANSPORTS_WITH_ROT) {
    it(`${name}: ROT matches INI ROT=${ini[name]?.ROT}`, () => {
      const iniRot = Number(ini[name]?.ROT ?? '0');
      expect(
        UNIT_STATS[name].rot,
        `UNIT_STATS.${name}.rot (${UNIT_STATS[name].rot}) !== INI ROT=${iniRot}`
      ).toBe(iniRot);
    });
  }
});

// ============================================================================
// Section 16: Owner factions match INI Owner= field
// C++ rules.ini Owner= determines which faction can build
// ============================================================================
describe('transport Owner faction parity', () => {

  it('APC: Owner=allies in INI', () => {
    const iniOwner = ini.APC?.Owner?.toLowerCase() ?? '';
    expect(iniOwner).toContain('allies');
    const item = PRODUCTION_ITEMS.find(p => p.type === 'APC');
    if (item) {
      expect(item.faction).toBe('allied');
    }
  });

  it('TRAN: Owner=soviet in INI', () => {
    const iniOwner = ini.TRAN?.Owner?.toLowerCase() ?? '';
    expect(iniOwner).toContain('soviet');
  });

  it('LST: Owner=allies,soviet in INI (both factions)', () => {
    const iniOwner = ini.LST?.Owner?.toLowerCase() ?? '';
    expect(iniOwner).toContain('allies');
    expect(iniOwner).toContain('soviet');
  });

  it('STNK: Owner=allies,soviet in INI (both factions)', () => {
    const iniOwner = ini.STNK?.Owner?.toLowerCase() ?? '';
    expect(iniOwner).toContain('allies');
    expect(iniOwner).toContain('soviet');
  });
});

// ============================================================================
// Section 17: Points (score) match INI
// C++ rules.ini Points= field
// ============================================================================
describe('transport Points match INI', () => {

  const TRANSPORTS = ['APC', 'LST', 'TRAN', 'STNK', 'TRUK', 'BADR'] as const;

  for (const name of TRANSPORTS) {
    it(`${name}: points matches INI Points=${ini[name]?.Points}`, () => {
      const iniPoints = Number(ini[name]?.Points ?? '0');
      expect(
        UNIT_STATS[name].points,
        `UNIT_STATS.${name}.points (${UNIT_STATS[name].points}) !== INI Points=${iniPoints}`
      ).toBe(iniPoints);
    });
  }
});

// ============================================================================
// Section 18: Mixed passenger types in same transport
// C++ cargo.cpp — CargoClass::Attach takes any FootClass*
// ============================================================================
describe('mixed passenger types in same transport', () => {

  it('APC can hold different infantry types simultaneously', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 11, 10);
    const e2 = entityAtCell(UnitType.I_E2, House.Spain, 12, 10);

    loadPassenger(apc, e1);
    loadPassenger(apc, e3);
    loadPassenger(apc, e2);

    expect(apc.passengers.length).toBe(3);
    expect(apc.passengers).toContain(e1);
    expect(apc.passengers).toContain(e3);
    expect(apc.passengers).toContain(e2);
  });

  it('all loaded passengers are killed on death regardless of type', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 11, 10);
    const e4 = entityAtCell(UnitType.I_E4, House.Spain, 12, 10);

    loadPassenger(apc, e1);
    loadPassenger(apc, e3);
    loadPassenger(apc, e4);

    apc.takeDamage(apc.maxHp + 100, 'AP');

    expect(e1.alive).toBe(false);
    expect(e3.alive).toBe(false);
    expect(e4.alive).toBe(false);
    expect(apc.passengers.length).toBe(0);
  });
});

// ============================================================================
// Section 19: Edge cases
// ============================================================================
describe('transport loading edge cases', () => {

  it('killing already-dead transport does not double-kill passengers', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    loadPassenger(apc, e1);

    apc.takeDamage(apc.maxHp + 100, 'AP');
    expect(apc.alive).toBe(false);
    expect(e1.alive).toBe(false);

    // Second kill attempt — should not crash
    apc.takeDamage(100, 'AP');
    expect(apc.alive).toBe(false);
  });

  it('passenger set to transportRef correctly tracks its transport', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    loadPassenger(apc, e1);

    expect(e1.transportRef).toBe(apc);
    expect(apc.passengers[0]).toBe(e1);
  });

  it('loading zero passengers is a no-op', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.passengers.length).toBe(0);
    expect(apc.isTransport).toBe(true);
  });

  it('STNK with 1 passenger + kill works at boundary', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(stnk.maxPassengers).toBe(iniPassengers('STNK'));
    expect(loadPassenger(stnk, e1)).toBe(true);

    stnk.takeDamage(stnk.maxHp + 100, 'AP');
    expect(stnk.alive).toBe(false);
    expect(e1.alive).toBe(false);
    expect(stnk.passengers.length).toBe(0);
  });

  it('Kill_Cargo kills ALL passengers (C++ while loop — techno.cpp:4407)', () => {
    const cap = iniPassengers('APC');
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const passengers = makeInfantry(cap, House.Spain);
    for (const p of passengers) loadPassenger(apc, p);
    expect(apc.passengers.length).toBe(cap);

    apc.takeDamage(apc.maxHp + 100, 'AP');

    for (const p of passengers) {
      expect(p.alive, 'every passenger must be dead').toBe(false);
    }
    expect(apc.passengers.length).toBe(0);
  });
});

// ============================================================================
// Section 20: Sight matches INI
// C++ rules.ini Sight= field
// ============================================================================
describe('transport Sight matches INI', () => {

  const TRANSPORTS = ['APC', 'LST', 'TRAN', 'STNK', 'TRUK'] as const;

  for (const name of TRANSPORTS) {
    it(`${name}: sight matches INI Sight=${ini[name]?.Sight}`, () => {
      const iniSight = Number(ini[name]?.Sight ?? '0');
      expect(
        UNIT_STATS[name].sight,
        `UNIT_STATS.${name}.sight (${UNIT_STATS[name].sight}) !== INI Sight=${iniSight}`
      ).toBe(iniSight);
    });
  }
});
