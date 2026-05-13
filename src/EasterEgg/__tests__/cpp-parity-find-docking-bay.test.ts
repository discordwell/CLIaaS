/**
 * C++ Behavioral Parity: TechnoClass::Find_Docking_Bay
 *
 * Source: src/EasterEgg/CnC_and_Red_Alert/RA/techno.cpp:5809-5853
 *
 * Behavior asserted:
 *   - house quantity guard (zero buildings → NULL)
 *   - same-house vs allied filter (friendly flag)
 *   - skips IsInLimbo (TS: !alive)
 *   - skips wrong type
 *   - skips buildings under construction (RADIO_CAN_LOAD NEGATIVE — building.cpp:174)
 *   - skips occupied pads (HPAD/AFLD/FIX dockedAircraft set)
 *   - aircraft bypass MZone; ground units require same reachable zone
 *   - distance ranking matches C++ coord.cpp Distance() (octagonal lepton metric)
 *   - IsLeader override: any IsLeader candidate becomes best regardless of distance
 *     (techno.cpp:5845 `... || building->IsLeader`).
 *
 * Distance helper: scenario.structureCenterLeptons gives building center; seeker
 * leptons fall back to cell-center if not supplied. The local helper uses the
 * same `max + (min>>1)` formula as coord.cpp:124-136.
 */

import { describe, it, expect } from 'vitest';
import { House } from '../engine/types';
import { findDockingBay } from '../engine/dockingBay';
import { type MapStructure, structureCenterLeptons } from '../engine/scenario';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeStructure(
  type: string,
  cx: number,
  cy: number,
  house: House,
  overrides: Partial<MapStructure> = {},
): MapStructure {
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: 1000,
    maxHp: 1000,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    missionTimer: 0,
    ...overrides,
  };
}

function alliancesAllAllied(_a: House, _b: House): boolean {
  return _a === _b;
}

function alliancesAlliedTable(allies: Map<House, Set<House>>) {
  return (a: House, b: House) => allies.get(a)?.has(b) ?? a === b;
}

// Octagonal Distance() matching C++ coord.cpp:124-136. Used to derive expected
// orderings in test assertions.
function dist(lx1: number, ly1: number, lx2: number, ly2: number): number {
  let dx = lx1 - lx2; if (dx < 0) dx = -dx;
  let dy = ly1 - ly2; if (dy < 0) dy = -dy;
  return dy > dx ? dy + (dx >> 1) : dx + (dy >> 1);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('findDockingBay — C++ techno.cpp:5809 parity', () => {

  it('returns null when no buildings of requested type exist', () => {
    // C++ techno.cpp:5820 — House->Get_Quantity(b) == 0 → return NULL.
    const ctx = {
      structures: [
        makeStructure('POWR', 5, 5, House.USSR),
        makeStructure('BARR', 8, 5, House.USSR),
      ],
      isAllied: alliancesAllAllied,
    };
    const result = findDockingBay(
      ctx,
      { house: House.USSR, cell: { cx: 10, cy: 10 }, kind: 'aircraft-heli' },
      'HPAD',
      false,
    );
    expect(result).toBeNull();
  });

  it('returns the closest qualifying building by Distance()', () => {
    // C++ techno.cpp:5845 — bestval seeded to -1, updated on each closer hit.
    const near = makeStructure('HPAD', 6, 6, House.USSR);
    const far = makeStructure('HPAD', 20, 20, House.USSR);
    const ctx = { structures: [far, near], isAllied: alliancesAllAllied };
    const result = findDockingBay(
      ctx,
      { house: House.USSR, cell: { cx: 5, cy: 5 }, kind: 'aircraft-heli' },
      'HPAD',
      false,
    );
    expect(result).toBe(near);

    // Sanity: Distance(near) < Distance(far).
    const srcLx = 5 * 256 + 128;
    const srcLy = 5 * 256 + 128;
    const nearCenter = structureCenterLeptons(near);
    const farCenter = structureCenterLeptons(far);
    expect(dist(srcLx, srcLy, nearCenter.lx, nearCenter.ly))
      .toBeLessThan(dist(srcLx, srcLy, farCenter.lx, farCenter.ly));
  });

  it('friendly=false restricts to same-house only', () => {
    // C++ techno.cpp:5834 — friendly ? Is_Ally : House == House.
    const allies = new Map<House, Set<House>>();
    allies.set(House.USSR, new Set([House.USSR, House.Ukraine]));
    allies.set(House.Ukraine, new Set([House.USSR, House.Ukraine]));
    const ctx = {
      structures: [
        makeStructure('HPAD', 6, 6, House.Ukraine), // ally, closer
        makeStructure('HPAD', 15, 15, House.USSR), // own, farther
      ],
      isAllied: alliancesAlliedTable(allies),
    };
    const result = findDockingBay(
      ctx,
      { house: House.USSR, cell: { cx: 5, cy: 5 }, kind: 'aircraft-heli' },
      'HPAD',
      false,
    );
    // friendly=false → ally's pad is invisible; USSR's far pad wins.
    expect(result?.house).toBe(House.USSR);
    expect(result?.cx).toBe(15);
  });

  it('friendly=true includes allied buildings', () => {
    const allies = new Map<House, Set<House>>();
    allies.set(House.USSR, new Set([House.USSR, House.Ukraine]));
    allies.set(House.Ukraine, new Set([House.USSR, House.Ukraine]));
    const ctx = {
      structures: [
        makeStructure('HPAD', 6, 6, House.Ukraine), // ally, closer
        makeStructure('HPAD', 15, 15, House.USSR),
      ],
      isAllied: alliancesAlliedTable(allies),
    };
    const result = findDockingBay(
      ctx,
      { house: House.USSR, cell: { cx: 5, cy: 5 }, kind: 'aircraft-heli' },
      'HPAD',
      true,
    );
    expect(result?.house).toBe(House.Ukraine);
    expect(result?.cx).toBe(6);
  });

  it('skips !alive (IsInLimbo) buildings', () => {
    // C++ techno.cpp:5835 — !building->IsInLimbo.
    const dead = makeStructure('HPAD', 6, 6, House.USSR, { alive: false });
    const live = makeStructure('HPAD', 20, 20, House.USSR);
    const ctx = { structures: [dead, live], isAllied: alliancesAllAllied };
    const result = findDockingBay(
      ctx,
      { house: House.USSR, cell: { cx: 5, cy: 5 }, kind: 'aircraft-heli' },
      'HPAD',
      false,
    );
    expect(result).toBe(live);
  });

  it('skips buildings of the wrong type', () => {
    // C++ techno.cpp:5836 — *building == b.
    const wrong = makeStructure('AFLD', 6, 6, House.USSR);
    const right = makeStructure('HPAD', 20, 20, House.USSR);
    const ctx = { structures: [wrong, right], isAllied: alliancesAllAllied };
    const result = findDockingBay(
      ctx,
      { house: House.USSR, cell: { cx: 5, cy: 5 }, kind: 'aircraft-heli' },
      'HPAD',
      false,
    );
    expect(result).toBe(right);
  });

  it('skips buildings still under construction (RADIO_CAN_LOAD NEGATIVE)', () => {
    // C++ building.cpp:174 — Mission_Construction / BSTATE_CONSTRUCTION → NEGATIVE.
    const building = makeStructure('HPAD', 6, 6, House.USSR, { buildProgress: 0.4 });
    const done = makeStructure('HPAD', 20, 20, House.USSR);
    const ctx = { structures: [building, done], isAllied: alliancesAllAllied };
    const result = findDockingBay(
      ctx,
      { house: House.USSR, cell: { cx: 5, cy: 5 }, kind: 'aircraft-heli' },
      'HPAD',
      false,
    );
    expect(result).toBe(done);
  });

  it('skips occupied helipads (dockedAircraft set)', () => {
    // C++ default RADIO_CAN_LOAD requires the pad to be free for incoming aircraft;
    // BuildingClass::Receive_Message returns NEGATIVE while In_Radio_Contact with
    // another sender (building.cpp:174 second clause).
    const occupied = makeStructure('HPAD', 6, 6, House.USSR, { dockedAircraft: 42 });
    const free = makeStructure('HPAD', 20, 20, House.USSR);
    const ctx = { structures: [occupied, free], isAllied: alliancesAllAllied };
    const result = findDockingBay(
      ctx,
      { house: House.USSR, cell: { cx: 5, cy: 5 }, kind: 'aircraft-heli' },
      'HPAD',
      false,
    );
    expect(result).toBe(free);
  });

  it('HPAD only accepts helicopters; AFLD only accepts fixed-wing', () => {
    // C++ building.cpp:177-186 — type-vs-kind matrix in RADIO_CAN_LOAD.
    const hpad = makeStructure('HPAD', 6, 6, House.USSR);
    const afld = makeStructure('AFLD', 12, 6, House.USSR);
    const ctx = { structures: [hpad, afld], isAllied: alliancesAllAllied };

    // Fixed-wing seeker can't dock the HPAD.
    expect(findDockingBay(
      ctx,
      { house: House.USSR, cell: { cx: 5, cy: 5 }, kind: 'aircraft-fixed' },
      'HPAD',
      false,
    )).toBeNull();

    // Helicopter seeker can't dock the AFLD.
    expect(findDockingBay(
      ctx,
      { house: House.USSR, cell: { cx: 5, cy: 5 }, kind: 'aircraft-heli' },
      'AFLD',
      false,
    )).toBeNull();
  });

  it('IsLeader override: a far IsLeader pad beats a closer non-leader', () => {
    // C++ techno.cpp:5845 — `if (bestval == -1 || Distance < bestval || IsLeader)`.
    const near = makeStructure('HPAD', 6, 6, House.USSR);
    const leader = makeStructure('HPAD', 60, 60, House.USSR, { isLeader: true });
    // Order matters in C++ (last-IsLeader wins per loop order); test with leader
    // appearing AFTER the closer non-leader to confirm the override.
    const ctx = { structures: [near, leader], isAllied: alliancesAllAllied };
    const result = findDockingBay(
      ctx,
      { house: House.USSR, cell: { cx: 5, cy: 5 }, kind: 'aircraft-heli' },
      'HPAD',
      false,
    );
    expect(result).toBe(leader);
  });

  it('aircraft seekers bypass MZone; ground seekers respect reachable zone', () => {
    // C++ techno.cpp:5837 — aircraft skip the Map[].Zones[MZone] equality check.
    const STRIDE = 128;
    const reachable = new Uint8Array(STRIDE * STRIDE);
    // Reachable zone covers cell (6,6) but NOT (60,60).
    reachable[6 * STRIDE + 6] = 1;
    reachable[7 * STRIDE + 6] = 1; // south-adjacent cell for footprint fallback

    const nearPad = makeStructure('FIX', 6, 6, House.USSR);
    const farUnreachable = makeStructure('FIX', 60, 60, House.USSR);
    const ctx = { structures: [nearPad, farUnreachable], isAllied: alliancesAllAllied };

    // Ground seeker — far pad pruned by zone check, near pad chosen.
    const ground = findDockingBay(
      ctx,
      { house: House.USSR, cell: { cx: 5, cy: 5 }, kind: 'unit' },
      'FIX',
      false,
      { reachableZone: reachable, mapCellsStride: STRIDE },
    );
    expect(ground).toBe(nearPad);

    // Aircraft seeker — distance alone applies; near pad still wins, but more
    // importantly when only the far pad is reachable to ground, aircraft can
    // still pick it.
    const onlyFar = new Uint8Array(STRIDE * STRIDE);
    onlyFar[60 * STRIDE + 60] = 1;
    const aircraft = findDockingBay(
      { structures: [farUnreachable], isAllied: alliancesAllAllied },
      { house: House.USSR, cell: { cx: 5, cy: 5 }, isAirUnit: true, kind: 'aircraft-heli' },
      'FIX',
      false,
      { reachableZone: onlyFar, mapCellsStride: STRIDE },
    );
    expect(aircraft).toBe(farUnreachable);

    // Ground seeker with empty reachable mask sees nothing.
    const noReach = new Uint8Array(STRIDE * STRIDE);
    const groundBlocked = findDockingBay(
      { structures: [farUnreachable], isAllied: alliancesAllAllied },
      { house: House.USSR, cell: { cx: 5, cy: 5 }, kind: 'unit' },
      'FIX',
      false,
      { reachableZone: noReach, mapCellsStride: STRIDE },
    );
    expect(groundBlocked).toBeNull();
  });

  it('PROC search: only harvesters accept; allied flag honored', () => {
    // C++ building.cpp:196-203 — STRUCT_REFINERY accepts only UNIT_HARVESTER.
    const allies = new Map<House, Set<House>>();
    allies.set(House.USSR, new Set([House.USSR, House.Ukraine]));
    allies.set(House.Ukraine, new Set([House.USSR, House.Ukraine]));
    const ourProc = makeStructure('PROC', 20, 20, House.USSR);
    const allyProc = makeStructure('PROC', 6, 6, House.Ukraine);
    const ctx = { structures: [allyProc, ourProc], isAllied: alliancesAlliedTable(allies) };

    // Non-harvester unit is rejected by the default RADIO_CAN_LOAD predicate.
    expect(findDockingBay(
      ctx,
      { house: House.USSR, cell: { cx: 5, cy: 5 }, kind: 'unit' },
      'PROC',
      false,
    )).toBeNull();

    // Harvester with friendly=false picks own-house PROC (farther but only valid).
    expect(findDockingBay(
      ctx,
      { house: House.USSR, cell: { cx: 5, cy: 5 }, kind: 'unit-harvester' },
      'PROC',
      false,
    )).toBe(ourProc);

    // Harvester with friendly=true picks the closer allied PROC.
    expect(findDockingBay(
      ctx,
      { house: House.USSR, cell: { cx: 5, cy: 5 }, kind: 'unit-harvester' },
      'PROC',
      true,
    )).toBe(allyProc);
  });

  it('custom canDock predicate overrides the default and is honored', () => {
    // The caller (e.g., harvester subsystem with an Is_Something_Attached map)
    // can supply a tighter predicate; the helper applies it exactly once per
    // candidate.
    const a = makeStructure('PROC', 6, 6, House.USSR);
    const b = makeStructure('PROC', 20, 20, House.USSR);
    const ctx = { structures: [a, b], isAllied: alliancesAllAllied };

    const result = findDockingBay(
      ctx,
      { house: House.USSR, cell: { cx: 5, cy: 5 }, kind: 'unit-harvester' },
      'PROC',
      false,
      { canDock: (s) => s.cx === 20 }, // mark 'a' as occupied externally
    );
    expect(result).toBe(b);
  });
});
