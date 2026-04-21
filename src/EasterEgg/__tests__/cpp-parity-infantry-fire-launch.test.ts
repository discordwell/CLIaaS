/**
 * C++ Behavioral Parity: Infantry FireLaunch — pre-fire animation stage gate
 *
 * InfantryClass::Firing_AI (infantry.cpp:3580-3670) splits infantry weapon fire
 * into two stages:
 *   1. Tick N: !IsFiring && Can_Fire==FIRE_OK → Do_Action(DO_FIRE_WEAPON),
 *      Set_Stage(0), IsFiring=true. No bullet launch yet.
 *   2. Tick N..N+FireLaunch: StageClass::Graphic_Logic advances stage 1/tick.
 *      IsFiring && Fetch_Stage()==FireLaunch → Fire_At (actual bullet launch).
 *
 * UnitClass::Firing_AI (unit.cpp:643-687) has no stage gate — vehicles fire
 * same-tick as Can_Fire==FIRE_OK.
 *
 * Per-type FireLaunch values from idata.cpp constructor arg "Frame of projectile
 * launch":
 *   - DOG:      1 (idata.cpp:384)
 *   - E1:       2 (idata.cpp:404) — Rifle Infantry
 *   - E2:       14 (idata.cpp:424) — Grenadier (grenade toss anim)
 *   - E3:       3 (idata.cpp:444) — Rocket Soldier
 *   - E4:       2 (idata.cpp:464) — Flamethrower
 *   - E6:       3 (idata.cpp:484) — Engineer (no weapon in RA)
 *   - SPY:      3 (idata.cpp:504)
 *   - E7/Tanya: 2 (idata.cpp:544)
 *   - Medic:    25 (idata.cpp:563)
 *   - General:  2 (idata.cpp:582)
 *   - Civilian: 2 (idata.cpp:601-854, CivilianDoControls)
 *   - Einstein: 0 (idata.cpp:793) — fires same-tick
 *
 * Empirical confirmation via WASM RNG log: SCG06EA tick 63 Greek E1 @(19,65)
 * acquires BadGuy E1 target via Mission_Guard → starts firing animation (no
 * bullet). Tick 65: Fire_At runs → invisible-bullet Bullet_Explodes →
 * Coord_Scatter Random_Pick(0,255). 2-tick delay = FireLaunch.
 */

import { describe, it, expect } from 'vitest';
import { UnitType } from '../engine/types';
import { infantryFireLaunch } from '../engine/missionAI';

describe('Infantry FireLaunch values match C++ idata.cpp constructor args', () => {
  it('DOG FireLaunch = 1 (idata.cpp:384 Dog constructor)', () => {
    expect(infantryFireLaunch(UnitType.I_DOG)).toBe(1);
  });

  it('E1 (Rifle) FireLaunch = 2 (idata.cpp:404)', () => {
    expect(infantryFireLaunch(UnitType.I_E1)).toBe(2);
  });

  it('E2 (Grenadier) FireLaunch = 14 (idata.cpp:424 — long grenade-toss anim)', () => {
    expect(infantryFireLaunch(UnitType.I_E2)).toBe(14);
  });

  it('E3 (Rocket Soldier) FireLaunch = 3 (idata.cpp:444)', () => {
    expect(infantryFireLaunch(UnitType.I_E3)).toBe(3);
  });

  it('E4 (Flamethrower) FireLaunch = 2 (idata.cpp:464)', () => {
    expect(infantryFireLaunch(UnitType.I_E4)).toBe(2);
  });

  it('E6 (Engineer) FireLaunch = 3 (idata.cpp:484)', () => {
    expect(infantryFireLaunch(UnitType.I_E6)).toBe(3);
  });

  it('SPY FireLaunch = 3 (idata.cpp:504)', () => {
    expect(infantryFireLaunch(UnitType.I_SPY)).toBe(3);
  });

  it('Tanya (E7) FireLaunch = 2 (idata.cpp:544)', () => {
    expect(infantryFireLaunch(UnitType.I_TANYA)).toBe(2);
  });

  it('Medic FireLaunch = 25 (idata.cpp:563 — long heal anim)', () => {
    expect(infantryFireLaunch(UnitType.I_MEDI)).toBe(25);
  });

  it('Mechanic FireLaunch = 25 (MedicDoControls-based)', () => {
    expect(infantryFireLaunch(UnitType.I_MECH)).toBe(25);
  });

  it('General (Stavros) FireLaunch = 2 (idata.cpp:582)', () => {
    expect(infantryFireLaunch(UnitType.I_GNRL)).toBe(2);
  });

  it('Einstein FireLaunch = 0 — fires same-tick (idata.cpp:793)', () => {
    expect(infantryFireLaunch(UnitType.I_EINSTEIN)).toBe(0);
  });

  it('Civilian (C1) FireLaunch = 2 (CivilianDoControls, idata.cpp:602)', () => {
    expect(infantryFireLaunch(UnitType.I_C1)).toBe(2);
  });

  it('Unknown types fall back to default FireLaunch = 2', () => {
    expect(infantryFireLaunch('UNKNOWN')).toBe(2);
  });
});
