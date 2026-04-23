/**
 * @vitest-environment jsdom
 *
 * C++ Behavioral Parity: TechnoClass::Fire_Coord (techno.cpp:491-517) used by
 * TechnoClass::In_Range (techno.cpp:1278-1294) inside
 * TechnoClass::Evaluate_Object (techno.cpp:1517-1523).
 *
 * Phase 7B (JOINT-REFACTOR plan §7B): SCG01EA tick-87 residual. The Greek
 * JEEP#27 (TS) fires at tick 87; WASM JEEP[22] fires at tick 88. Root cause
 * (per claudepad 2026-04-22T08:30Z): TS's `cellBasedGuardScan` uses
 * entity-center to candidate-center lepton distance, while C++'s In_Range
 * uses Fire_Coord(0) to candidate-center distance. For edge-of-range DOG
 * targets, the Fire_Coord offset (48 N + 48 along turret) moves the measuring
 * origin, flipping the range verdict.
 *
 * These tests exercise `Entity.fireCoordPrimary()` — the TS port of C++
 * Fire_Coord(0) scoped to JEEP — and verify the three-step Coord_Move chain:
 *
 *   1. DIR_N by (VerticalOffset + Height)                 (cosTable[0]=0, sinTable[0]=127)
 *   2. (turret + DIR_W) by PrimaryLateral   — skipped when PL=0 (JEEP)
 *   3. turret by PrimaryOffset
 *
 * C++ source refs:
 *   techno.cpp:491-517    TechnoClass::Fire_Coord
 *   techno.cpp:1278-1294  TechnoClass::In_Range (Distance(Fire_Coord, ...))
 *   udata.cpp:376-404     UnitJeep (VerticalOffset=0x30, PrimaryOffset=0x30, PrimaryLateral=0x00)
 *   coord.cpp:351-363     Coord_Move
 *   coord.cpp:410-424     calcx = (v * distance) >> 7
 *   coord.cpp:427-442     calcy = -((v * distance) >> 7)
 *   coord.cpp:445-570     Move_Point (256-step Cos/Sin tables)
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Entity, resetEntityIds } from '../engine/entity';
import {
  House, Mission, UnitType, CELL_SIZE, Dir,
  COS_TABLE_256, SIN_TABLE_256,
} from '../engine/types';
import { ScenarioRandom } from '../engine/random';

class FakeAudio {
  src = ''; preload = ''; volume = 1; currentTime = 0; muted = false; loop = false;
  addEventListener(): void {} removeEventListener(): void {}
  play(): Promise<void> { return Promise.resolve(); } pause(): void {}
  cloneNode(): FakeAudio { return new FakeAudio(); }
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
});

beforeEach(() => {
  resetEntityIds();
  ScenarioRandom.seed = 12345;
  ScenarioRandom.callCount = 0;
});

/** C++ coord.cpp:410 calcx (v * distance) >> 7. */
function calcx(v: number, distance: number): number {
  return (v * distance) >> 7;
}

/** C++ coord.cpp:427 calcy -((v * distance) >> 7). */
function calcy(v: number, distance: number): number {
  return -((v * distance) >> 7);
}

/**
 * C++ Coord_Move(x, y, dir256, distance) → {x,y}. `dir256` is 0-255 (256-step).
 * Mirrors coord.cpp:445-570 Move_Point.
 */
function coordMove(x: number, y: number, dir256: number, distance: number): { x: number; y: number } {
  const d = dir256 & 0xFF;
  const cos = COS_TABLE_256[d];
  const sin = SIN_TABLE_256[d];
  return {
    x: x + calcx(cos, distance),
    y: y + calcy(sin, distance),
  };
}

describe('C++ TechnoClass::Fire_Coord parity (SCG01EA tick 87 residual, Phase 7B)', () => {
  it('non-JEEP returns entity center (scoped port)', () => {
    const e = new Entity(UnitType.V_1TNK, House.Greece, 64 * CELL_SIZE + CELL_SIZE / 2, 50 * CELL_SIZE + CELL_SIZE / 2);
    e.turretFacing = Dir.S;
    e.turretFacing32 = 16;
    const fc = e.fireCoordPrimary();
    // Scoped port — 1TNK (+ all non-JEEP) returns center unchanged.
    expect(fc.lx).toBe(e.leptonX);
    expect(fc.ly).toBe(e.leptonY);
  });

  it('JEEP with turret N returns center shifted up by (VO + PO)', () => {
    // Turret N, VerticalOffset=0x30 up + PrimaryOffset=0x30 in turret dir (N).
    // Both add to the "up" shift: total -((127*0x30)>>7) twice ≈ -96 leptons in ly.
    const e = new Entity(UnitType.V_JEEP, House.Greece, 64 * CELL_SIZE + CELL_SIZE / 2, 50 * CELL_SIZE + CELL_SIZE / 2);
    e.turretFacing = Dir.N;
    e.turretFacing32 = 0;
    const fc = e.fireCoordPrimary();
    // Manual C++ calc:
    //   step1: DIR_N=0, dist=VO=0x30 → y += -((127*48)>>7) = -47
    //   step3: turret=0 (N), dist=PO=0x30 → same as step1: y += -47
    // Total ly offset from center = -94 (two -47 contributions).
    const step1 = calcy(SIN_TABLE_256[0], 0x30); // -47
    const step3 = calcy(SIN_TABLE_256[0], 0x30); // -47
    expect(fc.lx).toBe(e.leptonX); // no x movement when dir=N
    expect(fc.ly).toBe(e.leptonY + step1 + step3);
  });

  it('JEEP with turret S cancels VerticalOffset and PrimaryOffset', () => {
    // Turret S, VerticalOffset applied DIR_N (up = -y) + PrimaryOffset applied
    // DIR_S (down = +y). The two cancel leaving ly ~= center (off by 1 due to
    // sin(128) = -126, 127*48>>7 = 47 vs 126*48>>7 = 47 — same magnitude).
    const e = new Entity(UnitType.V_JEEP, House.Greece, 64 * CELL_SIZE + CELL_SIZE / 2, 50 * CELL_SIZE + CELL_SIZE / 2);
    e.turretFacing = Dir.S;
    e.turretFacing32 = 16; // 16 * 8 = 128 = DIR_S
    const fc = e.fireCoordPrimary();
    // sinTable[0] = 127 → step1 adds -47 to y
    // sinTable[128] = -126 → step3 adds -((-126*48)>>7) = 47 to y
    // Net: 0.
    expect(fc.lx).toBe(e.leptonX);
    const step1 = calcy(SIN_TABLE_256[0], 0x30);
    const step3 = calcy(SIN_TABLE_256[128], 0x30);
    expect(fc.ly).toBe(e.leptonY + step1 + step3);
  });

  it('JEEP with turret E shifts center N by VerticalOffset and E by PrimaryOffset', () => {
    const e = new Entity(UnitType.V_JEEP, House.Greece, 64 * CELL_SIZE + CELL_SIZE / 2, 50 * CELL_SIZE + CELL_SIZE / 2);
    e.turretFacing = Dir.E;
    e.turretFacing32 = 8; // 8 * 8 = 64 = DIR_E
    const fc = e.fireCoordPrimary();
    // step1 N by 0x30: x += calcx(cosTable[0]=0, 0x30) = 0; y += calcy(127, 0x30) = -47
    // step3 E by 0x30: x += calcx(cosTable[64]=127, 0x30) = 47; y += calcy(sinTable[64]=0, 0x30) = 0
    expect(fc.lx).toBe(e.leptonX + calcx(COS_TABLE_256[64], 0x30));
    expect(fc.ly).toBe(e.leptonY + calcy(SIN_TABLE_256[0], 0x30));
  });

  it('JEEP Fire_Coord matches bare-metal coordMove composition for turret NE', () => {
    const e = new Entity(UnitType.V_JEEP, House.Greece, 64 * CELL_SIZE + CELL_SIZE / 2, 50 * CELL_SIZE + CELL_SIZE / 2);
    e.turretFacing = Dir.NE;
    e.turretFacing32 = 4; // 4 * 8 = 32 = DIR_NE
    const fc = e.fireCoordPrimary();
    // Replicate C++ Fire_Coord chain using coordMove helper:
    const a = coordMove(e.leptonX, e.leptonY, 0, 0x30);          // DIR_N, VerticalOffset
    // DIR_W=192; PrimaryLateral=0 → skip; but verify symmetry anyway when PL=0.
    const b = coordMove(a.x, a.y, 32, 0x30);                      // turret, PrimaryOffset
    expect(fc.lx).toBe(b.x);
    expect(fc.ly).toBe(b.y);
  });

  it('JEEP Fire_Coord changes the In_Range verdict at edge of weapon range', () => {
    // JEEP M60mg range = 4 cells = 1024 leptons.
    // Place JEEP at center of cell (60,50): leptonX=60*256+128, leptonY=50*256+128.
    // Place target directly north at distance that is in-range from center but
    // out-of-range from Fire_Coord (turret N shifts Fire_Coord 96 leptons further
    // north, so distance +96 in north-facing-toward-target case).
    // For this we need the OPPOSITE: target south, turret north — Fire_Coord
    // shifts away from target, distance increases.
    const jeep = new Entity(UnitType.V_JEEP, House.Greece, 60 * CELL_SIZE + CELL_SIZE / 2, 50 * CELL_SIZE + CELL_SIZE / 2);
    jeep.mission = Mission.GUARD;
    jeep.turretFacing = Dir.N;
    jeep.turretFacing32 = 0;

    // Target directly south at center-distance 1020 leptons (just inside 1024).
    const targetLY = jeep.leptonY + 1020;
    const target = new Entity(UnitType.I_DOG, House.USSR, jeep.leptonX >> 0 /* x unchanged */,
      targetLY >> 0);
    // Entity constructor takes pixel coords; override leptonY directly for test precision.
    target.leptonY = targetLY;
    target.leptonX = jeep.leptonX;

    const centerDist = Math.max(Math.abs(jeep.leptonX - target.leptonX),
      Math.abs(jeep.leptonY - target.leptonY));
    expect(centerDist, 'center-to-center distance inside 1024').toBeLessThanOrEqual(1024);

    const fc = jeep.fireCoordPrimary();
    const fcDist = Math.max(Math.abs(fc.lx - target.leptonX),
      Math.abs(fc.ly - target.leptonY));
    expect(fcDist, 'Fire_Coord distance should be larger when turret faces away')
      .toBeGreaterThan(centerDist);
  });

  it('Dir.N + Dir.S round-trip yields identical leptonY as center', () => {
    // Symmetric sanity: if we consider the JEEP's "sweep 360 at same offsets",
    // turret S should produce net-zero Y offset because the VO(N) and PO(S)
    // cancel. Verify Fire_Coord(Dir.S).ly is within 1 lepton of center (the
    // sinTable asymmetry between 127 and -126 leaks one lepton).
    const jeep = new Entity(UnitType.V_JEEP, House.Greece, 60 * CELL_SIZE + CELL_SIZE / 2, 50 * CELL_SIZE + CELL_SIZE / 2);
    jeep.turretFacing = Dir.S;
    jeep.turretFacing32 = 16;
    const fc = jeep.fireCoordPrimary();
    expect(Math.abs(fc.ly - jeep.leptonY),
      'N + S offsets cancel within 1 lepton').toBeLessThanOrEqual(1);
  });
});
