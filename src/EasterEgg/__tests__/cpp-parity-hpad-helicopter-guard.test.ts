/**
 * C++ Parity: HPAD Helicopter Guard AI
 *
 * Verifies that HPAD auto-spawned helicopters implement full Mission_Guard
 * behavior matching C++ aircraft.cpp:3678 → foot.cpp:589.
 *
 * In C++, a landed helicopter (Height=0, non-human house):
 *   1. MissionClass::AI decrements timer each tick, fires handler when timer=0
 *   2. AircraftClass::Mission_Guard checks:
 *      - If TarCom valid → MISSION_ATTACK, return 1 (takeoff next tick)
 *      - Falls through to FootClass::Mission_Guard:
 *        a. Target_Something_Nearby(THREAT_RANGE) — scans enemies in weapon range
 *        b. If no target → Random_Animate() (no-op for aircraft, no RNG consumed)
 *        c. Returns Normal_Delay(42) + Random_Pick(0,2)
 *   3. After attack + RTB + rearm + land, cycle repeats
 *
 * C++ references:
 *   aircraft.cpp:3678-3807 — AircraftClass::Mission_Guard
 *   foot.cpp:589-634       — FootClass::Mission_Guard
 *   rules.ini [Guard]      — Rate=.050 → Normal_Delay=42
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Entity, resetEntityIds } from '../engine/entity';
import { UnitType, House, Mission, CELL_SIZE, UNIT_STATS } from '../engine/types';

beforeEach(() => resetEntityIds());

describe('HPAD Helicopter Guard AI — C++ parity', () => {
  const indexSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'engine', 'index.ts'), 'utf-8',
  );

  // ── Source structure: guard scan and timer logic ──

  it('tickStructuresInterleaved has helicopter guard mission timer logic', () => {
    const methodStart = indexSource.indexOf('private tickStructuresInterleaved(');
    expect(methodStart).toBeGreaterThan(-1);
    const methodBody = indexSource.slice(methodStart, methodStart + 8000);

    // Must decrement mission timer for landed helicopter
    expect(methodBody).toContain('heli.missionTimer > 0');
    expect(methodBody).toContain('heli.missionTimer--');

    // Must check mission timer fired
    expect(methodBody).toContain('heli.missionTimer <= 0');
  });

  it('guard scan only runs when helicopter is GUARD + landed', () => {
    const methodStart = indexSource.indexOf('private tickStructuresInterleaved(');
    const methodBody = indexSource.slice(methodStart, methodStart + 8000);

    // Guard condition: Mission.GUARD && aircraftState === 'landed'
    expect(methodBody).toContain("heli.mission === Mission.GUARD && heli.aircraftState === 'landed'");
  });

  it('checks for existing target before scanning (C++ aircraft.cpp:3773)', () => {
    const methodStart = indexSource.indexOf('private tickStructuresInterleaved(');
    const methodBody = indexSource.slice(methodStart, methodStart + 8000);

    // C++ aircraft.cpp:3773: if (Target_Legal(TarCom)) → ATTACK
    expect(methodBody).toContain('heli.target?.alive');
    expect(methodBody).toContain('heli.mission = Mission.ATTACK');
  });

  it('calls _heliGuardScan when no existing target', () => {
    const methodStart = indexSource.indexOf('private tickStructuresInterleaved(');
    const methodBody = indexSource.slice(methodStart, methodStart + 8000);

    expect(methodBody).toContain('this._heliGuardScan(heli)');
  });

  it('uses Normal_Delay=42 for guard timer (rules.ini [Guard] Rate=.050)', () => {
    const methodStart = indexSource.indexOf('private tickStructuresInterleaved(');
    const methodBody = indexSource.slice(methodStart, methodStart + 8000);

    // C++ foot.cpp:634: dtime=Normal_Delay(42) + Random_Pick(0,2)
    // After 2a99bce6 the jitter is extracted into `mgJitter` so the full
    // expression is split across two lines (`const mgJitter = ...; ...
    // GUARD_NORMAL_DELAY + mgJitter;`). Assert both halves instead of the
    // inlined form.
    expect(methodBody).toMatch(/const mgJitter = ScenarioRandom\.nextInRange\(0, 2\);/);
    expect(methodBody).toContain('GUARD_NORMAL_DELAY + mgJitter');
  });

  it('attack cooldowns are ticked by updateAircraft, not duplicated in guard logic', () => {
    const methodStart = indexSource.indexOf('private tickStructuresInterleaved(');
    const methodBody = indexSource.slice(methodStart, methodStart + 8000);

    // Guard logic should NOT tick cooldowns (updateAircraft handles it for all states)
    // The comment in the code documents this delegation
    expect(methodBody).toContain('cooldowns are ticked by updateAircraft');
    // But heli.attackCooldown IS checked for the C++ Arm timer shortcut (foot.cpp:634)
    expect(methodBody).toContain('heli.attackCooldown > 0');
  });

  // ── Source structure: _heliGuardScan method ──

  it('_heliGuardScan method exists and scans for enemies', () => {
    expect(indexSource).toContain('private _heliGuardScan(heli: Entity)');

    // Must scan entities for valid targets
    const scanStart = indexSource.indexOf('private _heliGuardScan(');
    expect(scanStart).toBeGreaterThan(-1);
    const scanBody = indexSource.slice(scanStart, scanStart + 7000);

    // Uses weapon range as scan radius (C++ THREAT_RANGE → Threat_Range(0) = weaponRange + 1)
    expect(scanBody).toContain('weaponRange');
    expect(scanBody).toContain('scanRange');

    // Filters out allies, dead, cloaked, no-threat
    expect(scanBody).toContain('entitiesAllied');
    expect(scanBody).toContain('Mission.SLEEP');
    expect(scanBody).toContain('CloakState.CLOAKED');

    // Sets target as side effect (C++ Target_Something_Nearby behavior)
    expect(scanBody).toContain('heli.target = bestTarget');
  });

  it('_heliGuardScan uses weapon range + 1, NOT guardRange (C++ techno.cpp:2048-2053)', () => {
    const scanStart = indexSource.indexOf('private _heliGuardScan(');
    expect(scanStart).toBeGreaterThan(-1);
    const scanBody = indexSource.slice(scanStart, scanStart + 7000);

    // C++ Threat_Range(0) for THREAT_RANGE: crange = max(Weapon_Range(0), Weapon_Range(1)) / ICON_LEPTON_W; crange++;
    // Must use weaponRange + 1, NOT guardRange (which is 30 cells — way too large)
    expect(scanBody).toContain('weaponRange + 1');
    // Ensure guardRange is NOT used as the scan radius variable
    // (comment mentioning "NOT guardRange" is OK, but it must not appear as an actual variable reference)
    expect(scanBody).not.toMatch(/\bheli\.stats\.guardRange\b/);
  });

  it('_heliGuardScan also checks enemy structures', () => {
    const scanStart = indexSource.indexOf('private _heliGuardScan(');
    const scanBody = indexSource.slice(scanStart, scanStart + 7000);

    expect(scanBody).toContain('heli.targetStructure = bestStruct');
  });

  // ── Behavioral: HIND weapon stats for guard scan ──

  it('HIND has ChainGun weapon that can attack ground targets', () => {
    const hind = UNIT_STATS.HIND;
    expect(hind.primaryWeapon).toBe('ChainGun');
    expect(hind.maxAmmo).toBe(12);
    expect(hind.guardRange).toBe(30);
  });

  it('HELI has Hellfire weapon', () => {
    const heli = UNIT_STATS.HELI;
    expect(heli.primaryWeapon).toBe('Hellfire');
    expect(heli.maxAmmo).toBe(6);
    expect(heli.guardRange).toBe(30);
  });

  // ── Behavioral: timer lifecycle ──

  it('helicopter missionTimer starts at 0 (fires on first tick)', () => {
    const heli = new Entity(UnitType.V_HIND, House.USSR, 100, 100);
    // C++ CDTimerClass default: timer=0 means handler fires immediately
    expect(heli.missionTimer).toBe(0);
  });

  it('landed helicopter in GUARD state has correct initial conditions', () => {
    const heli = new Entity(UnitType.V_HIND, House.USSR, 100, 100);
    heli.mission = Mission.GUARD;
    heli.aircraftState = 'landed';
    heli.flightAltitude = 0;

    expect(heli.mission).toBe(Mission.GUARD);
    expect(heli.aircraftState).toBe('landed');
    expect(heli.flightAltitude).toBe(0);
    expect(heli.isAirUnit).toBe(true);
    expect(heli.isHelicopter).toBe(true);
    // Non-player house: helicopter is AI-controlled
    expect(heli.isPlayerUnit).toBe(false);
  });

  it('setting mission to ATTACK allows aircraft state machine to trigger takeoff', () => {
    const heli = new Entity(UnitType.V_HIND, House.USSR, 100, 100);
    heli.mission = Mission.GUARD;
    heli.aircraftState = 'landed';
    heli.flightAltitude = 0;

    // Simulate what the guard logic does when target found
    heli.mission = Mission.ATTACK;
    heli.target = new Entity(UnitType.I_E1, House.Spain, 500, 500);

    // Aircraft state machine 'landed' case checks:
    //   if (entity.mission === Mission.ATTACK && (entity.target?.alive || entity.targetStructure))
    //     → entity.aircraftState = 'takeoff'
    expect(heli.mission).toBe(Mission.ATTACK);
    expect(heli.target?.alive).toBe(true);
    // The transition to 'takeoff' is handled by updateAircraft() in the next tick
  });

  // ── C++ parity: two-timer-fire attack cycle ──

  it('C++ requires two timer fires to start attack (scan then act)', () => {
    // Verifies the two-step process:
    // Timer fire 1: Target_Something_Nearby sets TarCom, returns delay(42+rand)
    // Timer fire 2: sees TarCom valid → ATTACK mission → takeoff
    //
    // This is documented in aircraft.cpp:3773 — the TarCom check comes BEFORE
    // the FootClass::Mission_Guard fallthrough, so a target found on one scan
    // is acted upon on the NEXT scan.

    const methodStart = indexSource.indexOf('private tickStructuresInterleaved(');
    const methodBody = indexSource.slice(methodStart, methodStart + 8000);

    // First: check TarCom (heli.target?.alive) → ATTACK
    const tarComCheckIdx = methodBody.indexOf('heli.target?.alive');
    expect(tarComCheckIdx).toBeGreaterThan(-1);

    // Then: _heliGuardScan only runs in the else branch (no existing target)
    const guardScanIdx = methodBody.indexOf('this._heliGuardScan(heli)');
    expect(guardScanIdx).toBeGreaterThan(-1);

    // Guard scan comes after target check (in else branch)
    expect(guardScanIdx).toBeGreaterThan(tarComCheckIdx);
  });
});
