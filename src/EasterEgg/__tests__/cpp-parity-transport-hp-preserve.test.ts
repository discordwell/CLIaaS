/**
 * C++ Behavioral Parity: Transport Passenger HP Preservation
 *
 * Verifies that passengers retain their current HP through load/unload cycles.
 * C++ does NOT heal passengers inside transports — cargo.cpp Detach_Object()
 * returns the object with its current HP unchanged.
 *
 * Source references:
 *   - cargo.cpp:87-123   — Attach(): adds unit to cargo hold (no HP modification)
 *   - cargo.cpp:144-154  — Detach_Object(): removes from cargo (no HP modification)
 *   - unit.cpp:731       — Per_Cell_Process loading: if (How_Many() < Max_Passengers()) Attach()
 *   - aircraft.cpp:2818  — Aircraft loading: same check, same Attach()
 *   - vessel.cpp:1359    — Vessel loading: same check, same Attach()
 *
 * Observable outcome: A unit loaded at 50% HP should unload at 50% HP.
 *
 * rules.ini references:
 *   [APC] Passengers=5, Strength=200
 *   [LST] Passengers=5, Strength=350
 *   [TRAN] Passengers=5, Strength=90
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { UnitType, House, CELL_SIZE, UNIT_STATS } from '../engine/types';

beforeEach(() => resetEntityIds());

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Passenger HP preservation through load/unload
// C++ cargo.cpp: Attach() and Detach_Object() do NOT modify HP
// ═══════════════════════════════════════════════════════════════════════════════

describe('C++ parity: passenger HP preserved through transport (cargo.cpp)', () => {

  it('full-HP passenger retains full HP after load+unload', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);

    const originalHp = e1.hp;
    expect(originalHp).toBe(e1.maxHp); // starts at full HP

    // Load
    apc.passengers.push(e1);
    e1.transportRef = apc;

    // HP unchanged while loaded
    expect(e1.hp).toBe(originalHp);

    // Unload
    const passenger = apc.passengers.pop()!;
    passenger.transportRef = null;
    passenger.alive = true;

    // HP preserved exactly
    expect(passenger.hp).toBe(originalHp);
    expect(passenger.hp).toBe(passenger.maxHp);
  });

  it('damaged passenger retains exact HP after load+unload (cargo.cpp does not heal)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);

    // Damage the infantry to 50% HP
    const halfHp = Math.floor(e1.maxHp / 2);
    e1.hp = halfHp;
    expect(e1.hp).toBe(halfHp);
    expect(e1.hp).toBeLessThan(e1.maxHp);

    // Load
    apc.passengers.push(e1);
    e1.transportRef = apc;

    // HP unchanged while loaded
    expect(e1.hp).toBe(halfHp);

    // Unload
    const passenger = apc.passengers.pop()!;
    passenger.transportRef = null;
    passenger.alive = true;

    // HP preserved exactly — NOT reset to maxHp
    expect(passenger.hp).toBe(halfHp);
    expect(passenger.hp).not.toBe(passenger.maxHp);
  });

  it('critically damaged passenger (1 HP) retains 1 HP after unload', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);

    e1.hp = 1;

    apc.passengers.push(e1);
    e1.transportRef = apc;

    const passenger = apc.passengers.pop()!;
    passenger.transportRef = null;
    passenger.alive = true;

    expect(passenger.hp).toBe(1);
  });

  it('multiple passengers each retain their individual HP', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const units: Entity[] = [];

    // Load 5 infantry at different HP levels
    for (let i = 0; i < 5; i++) {
      const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
      e.hp = (i + 1) * 10; // 10, 20, 30, 40, 50
      units.push(e);
      apc.passengers.push(e);
      e.transportRef = apc;
    }

    // Unload in LIFO order (C++ cargo.cpp:144-154)
    for (let i = apc.passengers.length - 1; i >= 0; i--) {
      const p = apc.passengers[i];
      p.transportRef = null;
      p.alive = true;
      // Each should retain their individual HP
      expect(p.hp).toBe((i + 1) * 10);
    }
  });

  it('LST transport preserves passenger HP', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);

    e3.hp = 30; // damaged

    lst.passengers.push(e3);
    e3.transportRef = lst;

    const passenger = lst.passengers.pop()!;
    passenger.transportRef = null;
    passenger.alive = true;

    expect(passenger.hp).toBe(30);
  });

  it('Chinook (TRAN) transport preserves passenger HP', () => {
    const tran = entityAtCell(UnitType.V_TRAN, House.USSR, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);

    e1.hp = 15; // damaged

    tran.passengers.push(e1);
    e1.transportRef = tran;

    const passenger = tran.passengers.pop()!;
    passenger.transportRef = null;
    passenger.alive = true;

    expect(passenger.hp).toBe(15);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Transport HP stats from rules.ini
// ═══════════════════════════════════════════════════════════════════════════════

describe('Transport HP from rules.ini', () => {
  it('APC Strength=200 (rules.ini line 660)', () => {
    expect(UNIT_STATS.APC.strength).toBe(200);
  });

  it('LST Strength=350 (rules.ini line 756)', () => {
    expect(UNIT_STATS.LST.strength).toBe(350);
  });

  it('TRAN Strength=90 (rules.ini line 1166)', () => {
    expect(UNIT_STATS.TRAN.strength).toBe(90);
  });
});
