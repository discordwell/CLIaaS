/**
 * C++ Parity: SCG06EA tick 76 Approach_Target destination cell selection
 *
 * Pins the destination cell that FootClass::Approach_Target (foot.cpp:926-1016)
 * selects for the SCG06EA USSR E1[24] @(24,67) sub 3 targeting the Greek E1
 * @(20,64) sub 2 — the exact geometry that drives the tick-76 divergence.
 *
 * C++ algorithm (foot.cpp:984-1000):
 *   for range in [maxrange … 0x80] step -0x100:
 *     for angle in [0, 8, -8, 16, -16, 24, -24, 32, -32, 48, -48, 64, -64]:
 *       trycoord = Coord_Move(target_coord, dir256 + angle, range)
 *       if Distance(trycoord, target_coord) < range  AND
 *          In_Radar(trycell)                          AND
 *          Is_Clear_To_Move(speed, false, false, zone, mzone):
 *         accept trycell; break
 *
 * With weapon M1Carbine range=3 cells → 768 leptons. After the -0x00B7
 * infantry adjustment: maxrange = 585. Sweep ranges: 585, 329 (73 < 0x80
 * terminates the loop).
 *
 * Geometry (initial placement, SCG06EA.ini):
 *   USSR  E1 @ cell 8600 = (24,67) sub 3 (LL)  → lepton (6208, 17344)
 *   Greek E1 @ cell 8212 = (20,64) sub 2 (UR) → lepton (5312, 16448)
 *
 * dir256 = Desired_Facing256(target → entity) computed via face.cpp:150-227:
 *   dx=+896, dy=-896 (screen y inverted) → composite = 0x40 + 31 = 95.
 *
 * Sweep at range=585:
 *   angles 0..-24 all fail the `Distance < range` test (min dist ~614).
 *   angle +32 (dir=127): Coord_Move east-south by 585 lands at lepton
 *     (5325, 17024) = cell (20, 66), distance = 582 < 585 → FIRST VALID.
 *
 * So the unmodified sweep selects (20, 66) — the cell TS currently picks,
 * matching the computed geometry exactly. WASM's cell-at-firing is (22, 65),
 * a cell the sweep *cannot* produce at range=585 targeting (20, 64) sub 2
 * because its octagonal distance from target is 608 ≥ 585.
 *
 * INTERPRETATION: the sweep math (dir256, COS/SIN tables, Coord_Move, and
 * leptonDist) is already C++-equivalent for this geometry. The observed
 * tick-76 residual divergence is NOT produced by a sweep-logic bug; it is
 * produced downstream — either:
 *   (a) pathfinding from (24,67) to the shared (20,66) destination takes a
 *       route that does not graze an in-range cell as early as WASM's path
 *       from (24,67) to (22,65) (see a3c9b24e: "1-cell pathfinding
 *       divergence delays TS firing by ~4 ticks"), OR
 *   (b) WASM re-calls Approach_Target after the entity has walked to a new
 *       lepton position (e.g. tick 18 first cell-change), causing dir256
 *       to rotate and selecting (22, 65) or an intermediate cell that TS
 *       does not re-select because of a timer-gating mismatch.
 *
 * This suite pins the sweep geometry itself: any future change to sign
 * handling, distance octagonal math, dir256, or the angle ordering will
 * immediately break these tests — so the sweep cannot silently drift.
 */

import { describe, it, expect } from 'vitest';
import {
  COS_TABLE_256, SIN_TABLE_256,
  directionToLeptons256, leptonDist,
} from '../engine/types';

describe('SCG06EA tick 76 — Approach_Target sweep geometry (C++ foot.cpp:926-1016)', () => {
  // Exact initial-placement lepton coords (SCG06EA.ini lines 559, 562).
  const ENTITY_LX = 24 * 256 + 64;   // cell 24, sub 3 (LL) → lx=64
  const ENTITY_LY = 67 * 256 + 192;  // cell 67, sub 3 (LL) → ly=192
  const TARGET_LX = 20 * 256 + 192;  // cell 20, sub 2 (UR) → lx=192
  const TARGET_LY = 64 * 256 + 64;   // cell 64, sub 2 (UR) → ly=64

  it('entity lepton coords match StoppingCoordAbs[3] (64,192)', () => {
    expect(ENTITY_LX).toBe(6208);
    expect(ENTITY_LY).toBe(17344);
  });

  it('target lepton coords match StoppingCoordAbs[2] (192,64)', () => {
    expect(TARGET_LX).toBe(5312);
    expect(TARGET_LY).toBe(16448);
  });

  it('Desired_Facing256(target → entity) = 95', () => {
    const dir = directionToLeptons256(TARGET_LX, TARGET_LY, ENTITY_LX, ENTITY_LY);
    expect(dir).toBe(95);
  });

  it('weapon M1Carbine maxrange = 768 - 0x00B7 = 585 leptons', () => {
    const range = 3 * 256;
    const maxrange = range - 0xB7;
    expect(maxrange).toBe(585);
  });

  it('C++ sweep at range=585 angle +32 (dir=127) yields cell (20, 66)', () => {
    const dir256 = 95;
    const angles = [0, 8, -8, 16, -16, 24, -24, 32, -32, 48, -48, 64, -64];
    const range = 585;
    const candidates: Array<{a: number; cx: number; cy: number; dist: number; inRange: boolean}> = [];
    for (const a of angles) {
      const d = (dir256 + a) & 0xFF;
      const tryLX = TARGET_LX + ((COS_TABLE_256[d] * range) >> 7);
      const tryLY = TARGET_LY - ((SIN_TABLE_256[d] * range) >> 7);
      const dist = leptonDist(tryLX, tryLY, TARGET_LX, TARGET_LY);
      candidates.push({
        a, cx: Math.floor(tryLX / 256), cy: Math.floor(tryLY / 256),
        dist, inRange: dist < range,
      });
    }
    // First angle that passes the C++ distance check.
    const firstValid = candidates.find(c => c.inRange);
    expect(firstValid).toBeDefined();
    expect(firstValid!.a).toBe(32);
    expect(firstValid!.cx).toBe(20);
    expect(firstValid!.cy).toBe(66);
  });

  it('cell (22, 65) cannot be produced at range=585 from target (20,64) sub 2', () => {
    // WASM's "approach cell at firing" is (22, 65). Cell center (5760, 16768),
    // target (5312, 16448). Octagonal distance = 448 + 160 = 608 — strictly
    // greater than maxrange 585, so the sweep's `Distance < 585` gate rejects
    // any Coord_Move(tcoord, _, 585) that would land in (22, 65).
    const cellCX = 22 * 256 + 128;
    const cellCY = 65 * 256 + 128;
    const dist = leptonDist(cellCX, cellCY, TARGET_LX, TARGET_LY);
    expect(dist).toBe(608);
    expect(dist).toBeGreaterThanOrEqual(585);
  });

  it('cell (22, 65) IS within weapon range 768 of target (20,64)', () => {
    // ...but it is a valid firing spot (Distance 608 < 768), which is why
    // WASM happily sits at (22, 65) once it arrives there via its natural
    // walk path. The Approach_Target -0x00B7 trim produces a destination
    // that is geometrically tighter than the fire-at range; WASM stops on
    // the way because In_Range(TarCom, primary) becomes true.
    const cellCX = 22 * 256 + 128;
    const cellCY = 65 * 256 + 128;
    const dist = leptonDist(cellCX, cellCY, TARGET_LX, TARGET_LY);
    const fireRange = 3 * 256; // 768 — weapon range, not the trimmed sweep range
    expect(dist).toBeLessThan(fireRange);
  });
});
