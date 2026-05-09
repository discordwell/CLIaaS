/**
 * C++ Behavioral Parity: BADR paratrooper drop on TMISSION_ATT_WAYPT
 *
 * Verifies that a fixed-wing passenger transport (Badger bomber) ejects its
 * passengers onto the target cell when following a team TMISSION_ATT_WAYPT
 * script — the paradrop mechanic used by SCG04EA's `para1`/`para2` teams
 * (2 E1 + 1 BADR, mission `1:11` = ATT_WAYPT waypoint 11).
 *
 * C++ Source Refs:
 *   - aircraft.cpp:1442-1468 — AircraftClass::Paradrop_Cargo — ejects ONE
 *     passenger per call via Detach_Object, calls passenger->Paradrop(Coord),
 *     assigns MISSION_GUARD (human) or MISSION_HUNT (AI).
 *   - aircraft.cpp:1489-1529 — AircraftClass::Fire_At — dispatches to
 *     Paradrop_Cargo() when Is_Something_Attached() returns true.
 *   - aircraft.cpp:3964-4013 — AircraftClass::Can_Fire — returns FIRE_OK for
 *     passenger aircraft when Distance(target) < 0x0200 leptons (2 cells).
 *   - aircraft.cpp:802-818 — IsALoaner retreat happens later in the REGROUP
 *     phase, not synchronously inside Paradrop_Cargo.
 *   - team.cpp:732-738 — TMISSION_ATT_WAYPT: Assign_Mission_Target(waypoint).
 *   - team.cpp:1636-1721 — Coordinate_Attack: assigns MISSION_ATTACK to members
 *     and sets Target=MissionTarget (the waypoint cell).
 *   - SCG04EA.ini:151-152 — [TeamTypes] para1/para2: 2 E1 + 1 BADR, `1:11`/`1:15`.
 *
 * Bug context: before this fix, the TS aircraft state machine treated BADR
 * with mission ATTACK + null target entity as "target lost" and sent the BADR
 * to 'returning' state, never dropping its passengers. In SCG04EA this cost
 * the player 4 enemy E1s on the ground vs. WASM by tick ~2000 and produced
 * a ±3 divergence in the late-game enemy unit count.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  UnitType, House, CELL_SIZE, Mission,
  type WorldPos, type LeptonPos, pixelToLepton,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { type AircraftContext, updateAircraft } from '../engine/aircraft';
import { GameMap } from '../engine/map';

beforeEach(() => resetEntityIds());

// ── INI Fixture (rules.ini is God — parse expected values) ──────────────────

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
      if (kvMatch) sections[current][kvMatch[1].trim()] = kvMatch[2].trim();
    }
  }
  return sections;
}

const rulesPath = path.resolve(__dirname, '../../../public/ra/assets/rules.ini');
const scg04Path = path.resolve(__dirname, '../../../public/ra/assets/SCG04EA.ini');
const rulesIni = parseINI(fs.readFileSync(rulesPath, 'utf-8'));
const scg04Ini = parseINI(fs.readFileSync(scg04Path, 'utf-8'));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeCtx(): AircraftContext & { entities: Entity[]; entityById: Map<number, Entity> } {
  const entities: Entity[] = [];
  const entityById = new Map<number, Entity>();
  return {
    entities,
    entityById,
    structures: [],
    map: new GameMap(),
    unitsLeftMap: 0,
    civiliansEvacuated: 0,
    isAllied: (a: House, b: House) => a === b,
    movementSpeed: (e: Entity) => e.stats.speed * 0.375, // pixels/tick at full speed
    idleMission: () => Mission.GUARD,
    fireWeaponAt: vi.fn(),
    fireWeaponAtStructure: vi.fn(),
    getROFBias: () => 1.0,
    getPowerFraction: () => 1.0,
  };
}

function cellToWorld(cx: number, cy: number): WorldPos {
  return { x: cx * CELL_SIZE + CELL_SIZE / 2, y: cy * CELL_SIZE + CELL_SIZE / 2 };
}

function spawnBadrWithPassengers(
  ctx: AircraftContext & { entities: Entity[]; entityById: Map<number, Entity> },
  startCell: { cx: number; cy: number },
  dropTarget: WorldPos,
  passengerCount: number,
): { badr: Entity; passengers: Entity[] } {
  const startWorld = cellToWorld(startCell.cx, startCell.cy);
  const badr = new Entity(UnitType.V_BADR, House.USSR, startWorld.x, startWorld.y);
  badr.flightAltitude = Entity.FLIGHT_ALTITUDE;
  badr.aircraftState = 'flying';
  // C++ team.cpp:1705 — Coordinate_Attack assigns MISSION_ATTACK, leaving
  // Target (the ATT_WAYPT waypoint cell) carried through moveTarget.
  badr.mission = Mission.ATTACK;
  badr.moveTarget = { lx: pixelToLepton(dropTarget.x), ly: pixelToLepton(dropTarget.y) };
  badr.target = null;
  // Face toward the target so the BADR flies in the correct direction
  const dx = dropTarget.x - startWorld.x;
  const dy = dropTarget.y - startWorld.y;
  const angle = Math.atan2(dx, -dy);
  const f256 = Math.round(((angle + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * 256) & 0xFF;
  badr.facing256 = f256;
  badr.desiredFacing256 = f256;

  const passengers: Entity[] = [];
  for (let i = 0; i < passengerCount; i++) {
    const p = new Entity(UnitType.I_E1, House.USSR, startWorld.x, startWorld.y);
    // Match scenario.ts REINFORCEMENT loading: passenger lives in transport.passengers,
    // has transportRef, NOT in ctx.entities while loaded.
    p.transportRef = badr;
    p.inLimbo = true;
    badr.passengers.push(p);
    passengers.push(p);
  }

  ctx.entities.push(badr);
  ctx.entityById.set(badr.id, badr);
  return { badr, passengers };
}

// ═══════════════════════════════════════════════════════════════════════════════
// rules.ini — BADR is a passenger-carrying fixed-wing (Passengers=5)
// ═══════════════════════════════════════════════════════════════════════════════

describe('rules.ini authoritative — BADR paratrooper carrier', () => {
  it('[BADR] has Passengers>0 (carries paratroopers)', () => {
    const pax = parseInt(rulesIni['BADR']?.Passengers ?? '0', 10);
    expect(pax).toBeGreaterThan(0);
    expect(pax).toBe(5);
  });

  it('[BADR] Speed matches Yak (Speed=16 — same fixed-wing class)', () => {
    expect(parseInt(rulesIni['BADR']?.Speed ?? '0', 10)).toBe(16);
  });
});

describe('SCG04EA para1/para2 team fixture (C++ team.cpp:732-738)', () => {
  it('[TeamTypes] para1 = 2 E1 + 1 BADR with mission 1:11 (ATT_WAYPT WP11)', () => {
    const raw = scg04Ini['TeamTypes']?.para1 ?? '';
    expect(raw).toContain('E1:2');
    expect(raw).toContain('BADR:1');
    // Mission list ends with "1:11" — TMISSION_ATT_WAYPT(1) targeting WP11
    expect(raw.endsWith(',1:11')).toBe(true);
  });

  it('[TeamTypes] para2 = 2 E1 + 1 BADR with mission 1:15 (ATT_WAYPT WP15)', () => {
    const raw = scg04Ini['TeamTypes']?.para2 ?? '';
    expect(raw).toContain('E1:2');
    expect(raw).toContain('BADR:1');
    expect(raw.endsWith(',1:15')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Paradrop behavior (C++ aircraft.cpp:1442-1468, 1489-1501, 3985-3992)
// ═══════════════════════════════════════════════════════════════════════════════

describe('BADR paradrop-on-ATT_WAYPT (aircraft.cpp:1442-1468 Paradrop_Cargo)', () => {
  it('BADR with 2 passengers drops both onto the target cell within 2 cells range', () => {
    const ctx = makeCtx();
    const dropTarget = cellToWorld(30, 30);
    // Start close — within range immediately so we verify the core drop mechanic
    const { badr, passengers } = spawnBadrWithPassengers(
      ctx,
      { cx: 30, cy: 31 }, // 1 cell away from drop target
      dropTarget,
      2,
    );

    expect(badr.passengers.length).toBe(2);
    expect(ctx.entities.length).toBe(1); // just the BADR, passengers are loaded

    // Tick once: BADR is within 2 cells — first passenger drops.
    updateAircraft(ctx, badr);
    expect(badr.passengers.length).toBe(1);
    expect(ctx.entities.length).toBe(2); // BADR + 1 dropped E1

    // Tick again: second passenger drops. BADR stays in ATTACK until the
    // aircraft attack state reaches REGROUP.
    updateAircraft(ctx, badr);
    expect(badr.passengers.length).toBe(0);
    expect(ctx.entities.length).toBe(3); // BADR + 2 dropped E1s
  });

  it('dropped paratroopers are alive, at the BADR position, on the ground (MISSION_GUARD)', () => {
    const ctx = makeCtx();
    const dropTarget = cellToWorld(30, 30);
    const { badr, passengers } = spawnBadrWithPassengers(
      ctx,
      { cx: 30, cy: 31 },
      dropTarget,
      2,
    );

    updateAircraft(ctx, badr);
    updateAircraft(ctx, badr);

    // Each dropped passenger is in the world
    for (const p of passengers) {
      expect(p.alive).toBe(true);
      expect(p.inLimbo).toBe(false);
      expect(p.transportRef).toBeNull();
      // C++ aircraft.cpp:1458-1461 — assigned MISSION_GUARD on paradrop
      expect(p.mission).toBe(Mission.GUARD);
      // Added to engine lists so render / AI see them
      expect(ctx.entities).toContain(p);
      expect(ctx.entityById.get(p.id)).toBe(p);
    }
  });

  it('dropped passengers land near the BADR flight path (drop on impact cell)', () => {
    const ctx = makeCtx();
    const dropTarget = cellToWorld(30, 30);
    const { badr, passengers } = spawnBadrWithPassengers(
      ctx,
      { cx: 30, cy: 31 },
      dropTarget,
      2,
    );

    updateAircraft(ctx, badr);
    const firstDropPos = { ...passengers[0].pos };
    // First drop should be close to the drop target (within 2 cells)
    const CELL = CELL_SIZE;
    expect(Math.abs(firstDropPos.x - dropTarget.x)).toBeLessThan(CELL * 2);
    expect(Math.abs(firstDropPos.y - dropTarget.y)).toBeLessThan(CELL * 2);
  });

  it('after the last passenger is dropped, BADR does not immediately switch to RETREAT', () => {
    const ctx = makeCtx();
    const dropTarget = cellToWorld(30, 30);
    const { badr } = spawnBadrWithPassengers(
      ctx,
      { cx: 30, cy: 31 },
      dropTarget,
      2,
    );

    updateAircraft(ctx, badr); // drop #1
    expect(badr.mission).toBe(Mission.ATTACK); // still has passengers
    updateAircraft(ctx, badr); // drop #2 → last
    expect(badr.passengers.length).toBe(0);
    expect(badr.mission).toBe(Mission.ATTACK);
  });

  it('BADR does NOT drop passengers while >2 cells from target (C++ Can_Fire 0x0200 range)', () => {
    const ctx = makeCtx();
    const dropTarget = cellToWorld(30, 30);
    const { badr } = spawnBadrWithPassengers(
      ctx,
      { cx: 10, cy: 30 }, // 20 cells away — WAY out of drop range
      dropTarget,
      2,
    );

    updateAircraft(ctx, badr);
    // Must NOT drop while out of range
    expect(badr.passengers.length).toBe(2);
    expect(ctx.entities.length).toBe(1);
  });

  it('BADR flies toward the drop cell and eventually drops (multi-tick approach)', () => {
    const ctx = makeCtx();
    const dropTarget = cellToWorld(30, 30);
    const { badr, passengers } = spawnBadrWithPassengers(
      ctx,
      { cx: 20, cy: 30 }, // 10 cells away
      dropTarget,
      2,
    );

    // Step until both passengers are dropped or we time out
    let maxTicks = 500;
    while (badr.passengers.length > 0 && maxTicks-- > 0) {
      updateAircraft(ctx, badr);
    }
    expect(badr.passengers.length).toBe(0);
    expect(ctx.entities.length).toBe(3); // BADR + 2 dropped
    for (const p of passengers) {
      expect(p.alive).toBe(true);
      expect(ctx.entities).toContain(p);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Regression guards — make sure helicopter UNLOAD and empty-BADR flight still work
// ═══════════════════════════════════════════════════════════════════════════════

describe('regression: non-paradrop aircraft flight paths unchanged', () => {
  it('BADR without passengers does NOT trigger paradrop logic', () => {
    const ctx = makeCtx();
    const dropTarget = cellToWorld(30, 30);
    const badr = new Entity(UnitType.V_BADR, House.USSR, cellToWorld(30, 31).x, cellToWorld(30, 31).y);
    badr.flightAltitude = Entity.FLIGHT_ALTITUDE;
    badr.aircraftState = 'flying';
    badr.mission = Mission.MOVE;
    badr.moveTarget = { lx: pixelToLepton(dropTarget.x), ly: pixelToLepton(dropTarget.y) };
    ctx.entities.push(badr);
    ctx.entityById.set(badr.id, badr);

    const entitiesBefore = ctx.entities.length;
    updateAircraft(ctx, badr);
    // No passengers means no drops added to ctx.entities
    expect(ctx.entities.length).toBe(entitiesBefore);
    // Still proceeds through normal MOVE handling
    expect(badr.passengers.length).toBe(0);
  });

  it('helicopter with passengers in unload_search state is NOT affected (uses separate state machine)', () => {
    const ctx = makeCtx();
    const heli = new Entity(UnitType.V_TRAN, House.USSR, cellToWorld(30, 31).x, cellToWorld(30, 31).y);
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.aircraftState = 'unload_search'; // separate from 'flying'
    heli.mission = Mission.UNLOAD;
    const heliTarget = cellToWorld(30, 30);
    heli.moveTarget = { lx: pixelToLepton(heliTarget.x), ly: pixelToLepton(heliTarget.y) };
    heli._unloadSearchTicks = 0;
    const passenger = new Entity(UnitType.I_E1, House.USSR, heli.pos.x, heli.pos.y);
    passenger.transportRef = heli;
    passenger.inLimbo = true;
    heli.passengers.push(passenger);
    ctx.entities.push(heli);
    ctx.entityById.set(heli.id, heli);

    // Tick once — helicopter drifts in unload_search; flying-state paradrop does
    // NOT apply because aircraftState !== 'flying'.
    updateAircraft(ctx, heli);
    expect(heli.passengers.length).toBe(1);
    expect(ctx.entities.length).toBe(1); // only heli, passenger still loaded
  });
});
