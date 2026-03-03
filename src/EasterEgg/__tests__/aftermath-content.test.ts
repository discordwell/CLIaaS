/**
 * Aftermath Expansion Content — sprite references, Mechanic stats, production gating.
 * Verifies that all Aftermath units use their own sprites (not stand-ins) and stats are correct.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  UnitType, House, UNIT_STATS, WEAPON_STATS, PRODUCTION_ITEMS,
} from '../engine/types';

beforeEach(() => resetEntityIds());

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

// ============================================================================
// 1. Aftermath sprite references — no more stand-in sprites
// ============================================================================
describe('Aftermath sprite references', () => {
  it('Chrono Tank uses ctnk sprite, not stand-in 2tnk', () => {
    expect(UNIT_STATS.CTNK.image).toBe('ctnk');
  });

  it('M.A.D. Tank uses qtnk sprite, not stand-in 2tnk', () => {
    expect(UNIT_STATS.QTNK.image).toBe('qtnk');
  });

  it('Demo Truck uses dtrk sprite, not stand-in truk', () => {
    expect(UNIT_STATS.DTRK.image).toBe('dtrk');
  });

  it('Tesla Tank uses ttnk sprite, not stand-in 4tnk', () => {
    expect(UNIT_STATS.TTNK.image).toBe('ttnk');
  });

  it('Mechanic correctly uses medi sprite (shared with Medic per C++ idata.cpp)', () => {
    expect(UNIT_STATS.MECH.image).toBe('medi');
  });

  it('Missile Sub uses msub sprite', () => {
    expect(UNIT_STATS.MSUB.image).toBe('msub');
  });
});

// ============================================================================
// 2. Mechanic stat parity (C++ idata.cpp:273)
// ============================================================================
describe('Mechanic stat parity', () => {
  it('Mechanic has 60 HP', () => {
    expect(UNIT_STATS.MECH.strength).toBe(60);
  });

  it('Mechanic costs 950', () => {
    const prod = PRODUCTION_ITEMS.find(p => p.type === 'MECH');
    expect(prod).toBeDefined();
    expect(prod!.cost).toBe(950);
  });

  it('Mechanic uses GoodWrench weapon', () => {
    expect(UNIT_STATS.MECH.primaryWeapon).toBe('GoodWrench');
  });

  it('GoodWrench weapon exists in WEAPON_STATS', () => {
    expect(WEAPON_STATS.GoodWrench).toBeDefined();
  });

  it('Mechanic entity resolves weapon correctly', () => {
    const mech = makeEntity(UnitType.I_MECH, House.Spain);
    expect(mech.weapon).not.toBeNull();
    expect(mech.weapon!.name).toBe('GoodWrench');
  });
});

// ============================================================================
// 3. Production gating — Aftermath units require tech centers
// ============================================================================
describe('Aftermath production gating', () => {
  it('Chrono Tank requires ATEK (Allied Tech Center)', () => {
    const prod = PRODUCTION_ITEMS.find(p => p.type === 'CTNK');
    expect(prod).toBeDefined();
    expect(prod!.techPrereq).toBe('ATEK');
    expect(prod!.faction).toBe('allied');
  });

  it('Tesla Tank requires STEK (Soviet Tech Center)', () => {
    const prod = PRODUCTION_ITEMS.find(p => p.type === 'TTNK');
    expect(prod).toBeDefined();
    expect(prod!.techPrereq).toBe('STEK');
    expect(prod!.faction).toBe('soviet');
  });

  it('Missile Sub requires STEK', () => {
    const prod = PRODUCTION_ITEMS.find(p => p.type === 'MSUB');
    expect(prod).toBeDefined();
    expect(prod!.techPrereq).toBe('STEK');
    expect(prod!.faction).toBe('soviet');
  });

  it('Mechanic requires FIX (Service Depot)', () => {
    const prod = PRODUCTION_ITEMS.find(p => p.type === 'MECH');
    expect(prod).toBeDefined();
    expect(prod!.techPrereq).toBe('FIX');
  });

  it('All Aftermath vehicles require WEAP prerequisite', () => {
    for (const type of ['CTNK', 'TTNK']) {
      const prod = PRODUCTION_ITEMS.find(p => p.type === type);
      expect(prod, `${type} should be in production list`).toBeDefined();
      expect(prod!.prerequisite).toBe('WEAP');
    }
  });

  it('DTRK and QTNK are not buildable (scenario-only kamikaze units)', () => {
    expect(PRODUCTION_ITEMS.find(p => p.type === 'DTRK')).toBeUndefined();
    expect(PRODUCTION_ITEMS.find(p => p.type === 'QTNK')).toBeUndefined();
  });

  it('MRLS does not exist (Tiberian Dawn unit, not in RA)', () => {
    expect(UNIT_STATS.MRLS).toBeUndefined();
    expect(PRODUCTION_ITEMS.find(p => p.type === 'MRLS')).toBeUndefined();
  });

  it('Mechanic is available to both factions', () => {
    const prod = PRODUCTION_ITEMS.find(p => p.type === 'MECH');
    expect(prod).toBeDefined();
    expect(prod!.faction).toBe('both');
  });
});
