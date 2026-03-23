/**
 * C++ Behavioral Parity: GUN Turret Power Status
 *
 * Verifies that GUN (turret) is NOT in the STRUCTURE_POWERED set.
 * In rules.ini, GUN does NOT have Powered=true — it fires regardless of power.
 *
 * Source references:
 *   - rules.ini [GUN] — no Powered=true line (fires without power)
 *   - rules.ini [AGUN] Powered=true — AGUN IS powered (contrast with GUN)
 *   - rules.ini [TSLA] Powered=true — Tesla Coil IS powered
 *   - bdata.cpp:571-594 — GUN building data, no IsPowered flag
 *   - building.cpp:1880  — Grand_Opening(): if (IsOwnedByPlayer && Class->IsPowered) power check
 *
 * rules.ini authoritative Powered=true structures:
 *   IRON (line 1217), PDOX (line 1261), TSLA (line 1355),
 *   AGUN (line 1390), DOME (line 1479), GAP (line 1495)
 *
 * GUN explicitly does NOT appear in this list.
 *
 * Observable outcome: GUN fires during low power. AGUN/TSLA do not.
 */

import { describe, it, expect } from 'vitest';
import { STRUCTURE_POWERED, STRUCTURE_WEAPONS } from '../engine/scenario';

describe('C++ parity: GUN turret is NOT powered (rules.ini)', () => {

  it('GUN is NOT in STRUCTURE_POWERED', () => {
    // rules.ini [GUN]: no Powered=true line
    expect(STRUCTURE_POWERED.has('GUN')).toBe(false);
  });

  it('GUN has a weapon (fires regardless of power)', () => {
    // rules.ini [GUN] Primary=TurretGun
    expect('GUN' in STRUCTURE_WEAPONS).toBe(true);
    expect(STRUCTURE_WEAPONS.GUN.damage).toBe(40);
    expect(STRUCTURE_WEAPONS.GUN.range).toBe(6);
  });

  it('other unpowered defenses also NOT in STRUCTURE_POWERED', () => {
    // PBOX, HBOX, FTUR — none have Powered=true in rules.ini
    expect(STRUCTURE_POWERED.has('PBOX')).toBe(false);
    expect(STRUCTURE_POWERED.has('HBOX')).toBe(false);
    expect(STRUCTURE_POWERED.has('FTUR')).toBe(false);
  });

  it('AGUN IS in STRUCTURE_POWERED (rules.ini line 1390)', () => {
    // rules.ini [AGUN] Powered=true
    expect(STRUCTURE_POWERED.has('AGUN')).toBe(true);
  });

  it('TSLA IS in STRUCTURE_POWERED (rules.ini line 1355)', () => {
    // rules.ini [TSLA] Powered=true
    expect(STRUCTURE_POWERED.has('TSLA')).toBe(true);
  });

  it('complete STRUCTURE_POWERED set matches rules.ini Powered=true entries', () => {
    // rules.ini structures with Powered=true:
    // IRON (line 1217), PDOX (line 1261), TSLA (line 1355),
    // AGUN (line 1390), DOME (line 1479), GAP (line 1495)
    const expected = new Set(['IRON', 'PDOX', 'TSLA', 'AGUN', 'DOME', 'GAP']);
    expect(STRUCTURE_POWERED).toEqual(expected);
  });
});
