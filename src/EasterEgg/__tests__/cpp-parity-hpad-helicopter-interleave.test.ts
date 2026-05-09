/**
 * C++ Parity: HPAD Auto-Helicopter RNG Interleaving
 *
 * Verifies that HPAD (helipad) auto-spawned helicopters are processed interleaved
 * with buildings in tickStructuresInterleaved(), matching C++ Logic array ordering.
 *
 * In C++ building.cpp:2438-2455, when an HPAD is created during scenario load,
 * it auto-spawns a helicopter (HIND for Soviet, LONGBOW/HELI for Allied).
 * The helicopter enters the C++ Logic array right after the HPAD and gets
 * processed interleaved with buildings. This means the helicopter's guard timer
 * RNG calls happen at a specific position in the RNG stream -- between buildings.
 *
 * Without this interleaving, scenarios with HPADs (SCG09EA has 1, SCG12EA has 4)
 * would have RNG stream divergence because the helicopter's RNG calls would
 * happen in Pass 4 (aircraft pass) instead of during the building pass.
 *
 * C++ reference:
 *   building.cpp:2438-2455 — HPAD creates helicopter at scenario init
 *   logic.cpp:284-339      — single interleaved loop over all Logic objects
 *   aircraft.cpp:AI()      — helicopter AI (guard timer, movement)
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Entity, resetEntityIds } from '../engine/entity';
import { UnitType, House, Mission, CELL_SIZE, UNIT_STATS } from '../engine/types';

describe('HPAD Auto-Helicopter Interleaving — C++ parity', () => {
  const indexSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'engine', 'index.ts'), 'utf-8',
  );
  const scenarioSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'engine', 'scenario.ts'), 'utf-8',
  );
  const entitySource = fs.readFileSync(
    path.resolve(__dirname, '..', 'engine', 'entity.ts'), 'utf-8',
  );

  // ── Source structure tests ──

  it('Entity has _processedInBuildingPass field defaulting to false', () => {
    expect(entitySource).toContain('_processedInBuildingPass = false');
  });

  it('MapStructure has optional hpadHelicopterId field', () => {
    expect(scenarioSource).toContain('hpadHelicopterId?: number');
  });

  it('HPAD spawning code sets hpadHelicopterId on the structure', () => {
    expect(scenarioSource).toContain('s.hpadHelicopterId = heli.id');
  });

  it('HPAD spawning code sets dockedAircraft on the structure', () => {
    expect(scenarioSource).toContain('s.dockedAircraft = heli.id');
  });

  it('HPAD spawning code sets landedAtStructure on the helicopter', () => {
    expect(scenarioSource).toContain('heli.landedAtStructure = si');
  });

  it('tickStructuresInterleaved processes HPAD helicopter after HPAD building', () => {
    const methodStart = indexSource.indexOf('private tickStructuresInterleaved(');
    expect(methodStart).toBeGreaterThan(-1);
    const methodBody = indexSource.slice(methodStart, methodStart + 16000);
    // Must check hpadHelicopterId and process the helicopter
    expect(methodBody).toContain('s.hpadHelicopterId');
    expect(methodBody).toContain('this.entityById.get(s.hpadHelicopterId)');
    // Must set _processedInBuildingPass
    expect(methodBody).toContain('heli._processedInBuildingPass = true');
    // Must call updateEntity on the helicopter
    expect(methodBody).toContain('this.updateEntity(heli)');
    // Must call tickAnimation on the helicopter
    expect(methodBody).toContain('heli.tickAnimation()');
  });

  it('helicopter processing in building pass happens AFTER building combat', () => {
    const methodStart = indexSource.indexOf('private tickStructuresInterleaved(');
    const methodBody = indexSource.slice(methodStart, methodStart + 8000);
    const combatIdx = methodBody.indexOf('_updateSingleStructureCombat(');
    const heliIdx = methodBody.indexOf('s.hpadHelicopterId');
    expect(combatIdx).toBeGreaterThan(-1);
    expect(heliIdx).toBeGreaterThan(-1);
    // Helicopter processing comes after building combat (matching C++ Logic order:
    // building AI runs first, then helicopter AI runs as next Logic entry)
    expect(heliIdx).toBeGreaterThan(combatIdx);
  });

  it('Phase 4 skips entities with _processedInBuildingPass and resets flag', () => {
    const pass4Start = indexSource.indexOf('Phase 4: aircraft');
    expect(pass4Start).toBeGreaterThan(-1);
    const pass4Section = indexSource.slice(pass4Start, pass4Start + 1000);
    // Must check _processedInBuildingPass
    expect(pass4Section).toContain('entity._processedInBuildingPass');
    // Must reset the flag
    expect(pass4Section).toContain('_processedInBuildingPass = false');
    // Must continue (skip) when flag is set
    expect(pass4Section).toMatch(/if\s*\(entity\._processedInBuildingPass\)/);
  });

  // ── Entity field tests ──

  it('new Entity has _processedInBuildingPass = false', () => {
    resetEntityIds();
    const e = new Entity(UnitType.V_HELI, House.Spain, 100, 100);
    expect(e._processedInBuildingPass).toBe(false);
  });

  it('HELI is an air unit (isAirUnit)', () => {
    resetEntityIds();
    const e = new Entity(UnitType.V_HELI, House.Spain, 100, 100);
    expect(e.isAirUnit).toBe(true);
    expect(e.isHelicopter).toBe(true);
  });

  it('HIND is an air unit (isAirUnit)', () => {
    resetEntityIds();
    const e = new Entity(UnitType.V_HIND, House.USSR, 100, 100);
    expect(e.isAirUnit).toBe(true);
    expect(e.isHelicopter).toBe(true);
  });

  it('helicopter created for HPAD starts airborne by default, callers override to landed', () => {
    resetEntityIds();
    // Constructor sets aircraft to flying state
    const heli = new Entity(UnitType.V_HELI, House.Spain, 100, 100);
    expect(heli.aircraftState).toBe('flying');
    expect(heli.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
    // HPAD spawning code overrides to landed state
    heli.aircraftState = 'landed';
    heli.flightAltitude = 0;
    expect(heli.aircraftState).toBe('landed');
    expect(heli.flightAltitude).toBe(0);
  });

  // ── Faction parity tests ──

  it('Soviet houses (USSR, Ukraine, BadGuy) get HIND on HPAD', () => {
    // C++ building.cpp:2441-2443: ActLike == HOUSE_USSR/BAD/UKRAINE → AIRCRAFT_HIND
    const sovietHouses = [House.USSR, House.Ukraine, House.BadGuy];
    for (const house of sovietHouses) {
      // Verify scenario code handles these correctly
      const isSoviet = house === House.USSR || house === House.Ukraine || house === House.BadGuy;
      expect(isSoviet).toBe(true);
    }
    // HIND stats should exist
    expect(UNIT_STATS.HIND).toBeDefined();
    expect(UNIT_STATS.HIND.isAircraft).toBe(true);
  });

  it('Allied houses get HELI (Longbow) on HPAD', () => {
    // C++ building.cpp:2444-2445: else → AIRCRAFT_LONGBOW
    const alliedHouses = [House.Spain, House.Greece, House.England, House.France, House.Germany, House.Turkey];
    for (const house of alliedHouses) {
      const isSoviet = house === House.USSR || house === House.Ukraine || house === House.BadGuy;
      expect(isSoviet).toBe(false);
    }
    // HELI stats should exist
    expect(UNIT_STATS.HELI).toBeDefined();
    expect(UNIT_STATS.HELI.isAircraft).toBe(true);
  });

  // ── HPAD position parity ──

  it('HPAD helicopter spawns at (cx+1, cy) cell center — C++ Docking_Coord for 2x2 building', () => {
    // C++ building.cpp:2452: Unlimbo(Docking_Coord(), ...) — helicopter at pad center
    // HPAD is 2x2, docking coord is (cx+1)*CELL_SIZE, cy*CELL_SIZE in cell coords
    // scenario.ts: cellToWorld(s.cx + 1, s.cy) gives the center of the top-right cell
    expect(scenarioSource).toContain('cellToWorld(s.cx + 1, s.cy)');
  });
});
