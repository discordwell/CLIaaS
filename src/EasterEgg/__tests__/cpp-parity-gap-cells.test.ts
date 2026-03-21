/**
 * C++ Behavioral Parity Tests: GAP Generator Cell Persistence
 *
 * C++ source of truth:
 *   building.cpp:990-1007  — GAP generator AI: periodic re-jam, power gating
 *   building.cpp:1318-1320 — destruction calls Remove_Gap_Effect()
 *   building.cpp:3557-3558 — selling calls Remove_Gap_Effect()
 *   building.cpp:2970-2974 — capture resets GAP jamming
 *   building.cpp:5684-5700 — Remove_Gap_Effect(): unjam this, reset overlapping GAPs
 *   building.cpp:1582-1583 — constructor: IsJamming=false, IsJammed=false
 *   cell.h:124             — unsigned short Jammed (per-house bitmask)
 *   cell.cpp:111           — Jammed(0) in constructor
 *   display.cpp:4160       — Jammed & (1 << PlayerPtr->Class->House)
 *   house.cpp:4160-4170    — Power_Fraction(): Power>=Drain→1, Drain==0→1, else Power/Drain
 *   map.h:74-76            — Jam_From, UnJam_From, Shroud_From declarations
 *   defines.h:3031-3032    — TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
 *
 * TS implementation under test:
 *   engine/fog.ts:239-287  — updateGapGenerators()
 *   engine/map.ts:697-737  — jamCell, unjamCell, unjamRadius, jammedCells counter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  updateGapGenerators, GAP_RADIUS, GAP_UPDATE_INTERVAL,
  type FogContext,
} from '../engine/fog';
import { type MapStructure, STRUCTURE_SIZE, STRUCTURE_MAX_HP } from '../engine/scenario';
import { House, buildDefaultAlliances } from '../engine/types';
import { GameMap } from '../engine/map';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeGapStructure(
  cx: number, cy: number,
  house: House = House.Spain,
  alive = true,
): MapStructure {
  const maxHp = STRUCTURE_MAX_HP['GAP'] ?? 1000;
  return {
    type: 'GAP', image: 'gap', house,
    cx, cy, hp: alive ? maxHp : 0, maxHp, alive, rubble: !alive,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function makeFogContext(overrides: Partial<FogContext> = {}): FogContext {
  const alliances = buildDefaultAlliances();
  const map = new GameMap();
  return {
    entities: [],
    structures: [],
    map,
    tick: 0,
    playerHouse: House.Spain,
    fogDisabled: false,
    gpsActive: false,
    baseDiscovered: true,
    powerProduced: 200,
    powerConsumed: 100,
    gapGeneratorCells: new Map(),
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: () => false,
    ...overrides,
  };
}

/**
 * Count jammed cells in the map's jammedCells tracker.
 */
function countJammedCells(map: GameMap): number {
  return map.jammedCells.size;
}

/**
 * Check if a specific cell is jammed.
 */
function isCellJammed(map: GameMap, cx: number, cy: number): boolean {
  const MAP_CELLS = 128; // from types.ts
  const idx = cy * MAP_CELLS + cx;
  return (map.jammedCells.get(idx) ?? 0) > 0;
}

/**
 * Get jam count for a specific cell (for overlapping GAP tests).
 */
function getJamCount(map: GameMap, cx: number, cy: number): number {
  const MAP_CELLS = 128;
  const idx = cy * MAP_CELLS + cx;
  return map.jammedCells.get(idx) ?? 0;
}

// =============================================================================
// Section 1: Basic GAP activation with full power
// C++ building.cpp:996-999 — !IsJamming && Power_Fraction() >= 1 → Jam_From
// =============================================================================

describe('C++ parity: GAP generator activates when powered (building.cpp:996-999)', () => {
  it('GAP jams cells in circular radius when power >= drain', () => {
    // C++ building.cpp:997: if (House->Power_Fraction() >= 1) {
    // C++ building.cpp:998:   Map.Jam_From(Coord_Cell(Center_Coord()), Rule.GapShroudRadius, House);
    const ctx = makeFogContext({
      structures: [makeGapStructure(30, 30)],
      powerProduced: 200,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL, // must be on update interval
    });

    updateGapGenerators(ctx);

    // Center of GAP (1x2 building at 30,30) = (30, 31) — cy + floor(2/2)
    const centerY = 31;
    expect(isCellJammed(ctx.map, 30, centerY)).toBe(true);

    // Cells within GAP_RADIUS should be jammed
    expect(isCellJammed(ctx.map, 30 + GAP_RADIUS, centerY)).toBe(true);
    expect(isCellJammed(ctx.map, 30, centerY + GAP_RADIUS)).toBe(true);
    expect(isCellJammed(ctx.map, 30 - GAP_RADIUS, centerY)).toBe(true);

    // Cells outside radius should NOT be jammed
    expect(isCellJammed(ctx.map, 30 + GAP_RADIUS + 1, centerY)).toBe(false);
  });

  it('GAP uses C++ octagonal radius, not square or Euclidean', () => {
    // C++ coord.cpp:124-136 octagonal distance: max(|dx|,|dy|)*2 + min(|dx|,|dy|) <= radius*2
    const ctx = makeFogContext({
      structures: [makeGapStructure(50, 50)],
      powerProduced: 200,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);

    // GAP is 1x2, center = (50, 51)
    const cY = 51;
    const r = GAP_RADIUS;
    // Corner of bounding box: (r, r) big=10,small=10 => 20+10=30 > 20 → NOT jammed
    expect(isCellJammed(ctx.map, 50 + r, cY + r)).toBe(false);

    // (r, 0) and (0, r) are on the boundary → jammed
    // big=10,small=0 => 20+0=20 <= 20
    expect(isCellJammed(ctx.map, 50 + r, cY)).toBe(true);
    expect(isCellJammed(ctx.map, 50, cY + r)).toBe(true);

    // (7, 7): big=7,small=7 => 14+7=21 > 20 → NOT jammed (octagonal clips diagonals)
    expect(isCellJammed(ctx.map, 50 + 7, cY + 7)).toBe(false);

    // (7, 6): big=7,small=6 => 14+6=20 <= 20 → jammed (on the boundary)
    expect(isCellJammed(ctx.map, 50 + 7, cY + 6)).toBe(true);

    // (8, 7): big=8,small=7 => 16+7=23 > 20 → NOT jammed
    expect(isCellJammed(ctx.map, 50 + 8, cY + 7)).toBe(false);
  });
});

// =============================================================================
// Section 2: Power gating — GAP deactivates when underpowered
// C++ building.cpp:1001-1005 — IsJamming && Power_Fraction() < 1 → unjam
// =============================================================================

describe('C++ parity: GAP deactivates when underpowered (building.cpp:1001-1005)', () => {
  it('GAP unjams all cells when power drops below drain', () => {
    // First, activate the GAP with full power
    const gap = makeGapStructure(40, 40);
    const ctx = makeFogContext({
      structures: [gap],
      powerProduced: 200,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);
    expect(countJammedCells(ctx.map)).toBeGreaterThan(0);

    // Now cut power — C++ building.cpp:1002: Power_Fraction() < 1
    ctx.powerProduced = 50;
    ctx.powerConsumed = 100;
    ctx.tick = GAP_UPDATE_INTERVAL * 2;

    updateGapGenerators(ctx);
    expect(countJammedCells(ctx.map)).toBe(0);
  });

  it('GAP does NOT activate when power is insufficient from the start', () => {
    // C++ building.cpp:997: if (House->Power_Fraction() >= 1) — gate prevents jamming
    const ctx = makeFogContext({
      structures: [makeGapStructure(40, 40)],
      powerProduced: 50,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);
    expect(countJammedCells(ctx.map)).toBe(0);
  });

  it('GAP re-activates when power is restored', () => {
    // C++ building.cpp:996-999: !IsJamming → checks power → jams if power restored
    const gap = makeGapStructure(40, 40);
    const ctx = makeFogContext({
      structures: [gap],
      powerProduced: 50,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    // No power → no jam
    updateGapGenerators(ctx);
    expect(countJammedCells(ctx.map)).toBe(0);

    // Restore power
    ctx.powerProduced = 200;
    ctx.powerConsumed = 100;
    ctx.tick = GAP_UPDATE_INTERVAL * 2;

    updateGapGenerators(ctx);
    expect(countJammedCells(ctx.map)).toBeGreaterThan(0);
  });
});

// =============================================================================
// Section 3: Power threshold — strict Power >= Drain check
// C++ house.cpp:4160-4170: Power_Fraction returns 1 iff Power >= Drain OR Drain == 0
// =============================================================================

describe('C++ parity: Power_Fraction threshold (house.cpp:4160-4170)', () => {
  it('power exactly equal to drain → GAP activates (Power_Fraction == 1)', () => {
    // C++ house.cpp:4164: if (Power >= Drain || Drain == 0) return(1);
    const ctx = makeFogContext({
      structures: [makeGapStructure(40, 40)],
      powerProduced: 100,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);
    expect(countJammedCells(ctx.map)).toBeGreaterThan(0);
  });

  it('power just below drain → GAP does NOT activate (Power_Fraction < 1)', () => {
    // C++ house.cpp:4166: return fixed(Power, Drain) — 99/100 < 1
    const ctx = makeFogContext({
      structures: [makeGapStructure(40, 40)],
      powerProduced: 99,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);
    expect(countJammedCells(ctx.map)).toBe(0);
  });

  it('drain == 0 → GAP activates (Power_Fraction returns 1)', () => {
    // C++ house.cpp:4164: Drain == 0 → return(1)
    // TS fog.ts:243: pf = powerProduced / Math.max(powerConsumed, 1)
    //   When powerConsumed=0: pf = powerProduced / 1 = powerProduced
    //   If powerProduced > 0, pf >= 1 → OK
    //   If powerProduced == 0, pf = 0 → TS says underpowered!
    // C++ says drain=0 → always powered regardless of Power value
    const ctx = makeFogContext({
      structures: [makeGapStructure(40, 40)],
      powerProduced: 0,
      powerConsumed: 0,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);
    // C++ Power_Fraction: Drain==0 → return 1 → GAP should activate
    // TS: pf = 0/1 = 0 < 1 → GAP does NOT activate  // PARITY GAP
    expect(countJammedCells(ctx.map)).toBeGreaterThan(0);
  });
});

// =============================================================================
// Section 4: Destruction cleanup — Remove_Gap_Effect
// C++ building.cpp:1318-1320 — destruction calls Remove_Gap_Effect
// C++ building.cpp:5684-5700 — Remove_Gap_Effect unjams + resets overlapping GAPs
// =============================================================================

describe('C++ parity: GAP destruction cleanup (building.cpp:5684-5700)', () => {
  it('destroyed GAP unjams its cells', () => {
    // C++ building.cpp:1318-1320: if (*this == STRUCT_GAP) Remove_Gap_Effect();
    // C++ building.cpp:5687: Map.UnJam_From(Coord_Cell(Center_Coord()), Rule.GapShroudRadius, House);
    const gap = makeGapStructure(40, 40);
    const ctx = makeFogContext({
      structures: [gap],
      powerProduced: 200,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);
    expect(countJammedCells(ctx.map)).toBeGreaterThan(0);

    // Destroy the GAP
    gap.alive = false;
    gap.hp = 0;
    ctx.tick = GAP_UPDATE_INTERVAL * 2;

    updateGapGenerators(ctx);
    expect(countJammedCells(ctx.map)).toBe(0);
  });

  it('overlapping GAPs: destroying one leaves the other\'s cells jammed', () => {
    // C++ building.cpp:5692-5698: Remove_Gap_Effect iterates all other same-house GAPs,
    // resets IsJamming=false, Arm=0 so they re-jam next tick.
    // Net effect: overlapping area stays jammed.
    const gap1 = makeGapStructure(40, 40);
    const gap2 = makeGapStructure(45, 40); // 5 cells apart, significant overlap

    const ctx = makeFogContext({
      structures: [gap1, gap2],
      powerProduced: 200,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);

    // Both GAPs should have jammed cells
    const jammedBefore = countJammedCells(ctx.map);
    expect(jammedBefore).toBeGreaterThan(0);

    // Cell at (42, 40) is within radius of both GAPs
    // gap1 center at 40, gap2 center at 45. Both have radius 10.
    // Cell 42: dist to gap1=2, dist to gap2=3 — within both
    expect(isCellJammed(ctx.map, 42, 40)).toBe(true);

    // Destroy gap1
    gap1.alive = false;
    gap1.hp = 0;
    ctx.tick = GAP_UPDATE_INTERVAL * 2;

    updateGapGenerators(ctx);

    // Cell (42, 40) should STILL be jammed by gap2 (dist=3 < 10)
    expect(isCellJammed(ctx.map, 42, 40)).toBe(true);

    // Cell at (30, 40) was ONLY in gap1's radius (dist=10 from gap1, dist=15 from gap2)
    // After gap1 destroyed, this cell should be unjammed
    expect(isCellJammed(ctx.map, 30, 40)).toBe(false);
  });
});

// =============================================================================
// Section 5: Overlapping GAP jam counts
// C++ cell.h:124 — unsigned short Jammed is a BITMASK per-house (1 << House)
// TS map.ts:698  — jammedCells is Map<number, number> (counter, not bitmask)
// =============================================================================

describe('C++ parity: overlapping GAP jam counts (cell.h:124 bitmask vs counter)', () => {
  it('C++ uses per-house bitmask: two GAPs from same house = same bit set once', () => {
    // C++ cell.h:124: unsigned short Jammed — each house gets one bit
    // C++ Jam_From sets bit: cell.Jammed |= (1 << house)
    // Two GAPs from the same house both set the same bit — effectively idempotent per-house
    //
    // TS map.ts:706: this.jammedCells.set(idx, count + 1)
    // Two GAPs increment counter to 2 — NOT the same as a bitmask
    //
    // This diverges for unjam: C++ UnJam_From clears the bit (cell.Jammed &= ~(1 << house)),
    // which means removing ONE GAP from a two-GAP overlap clears jamming entirely!
    // C++ compensates via Remove_Gap_Effect resetting other GAPs' IsJamming flags.
    //
    // TS uses decrement: removing one GAP decrements count from 2→1, cell stays jammed.
    // This is FUNCTIONALLY equivalent but through a different mechanism.

    const gap1 = makeGapStructure(50, 50);
    const gap2 = makeGapStructure(50, 50); // same position, same house

    const ctx = makeFogContext({
      structures: [gap1, gap2],
      powerProduced: 200,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);

    // Center cell jam count:
    // C++ bitmask: Jammed = (1 << house) — value is 1 bit, not count
    // TS counter: jammedCells[idx] = 2 (incremented twice)
    const centerJamCount = getJamCount(ctx.map, 50, 50);

    // C++ would have bitmask value with single bit set (equivalent to "jammed" boolean)
    // TS has counter = 2
    // This tests whether the TS counter model produces correct end results even
    // though the internal representation differs.
    expect(centerJamCount).toBeGreaterThan(0); // both agree: cell IS jammed
  });

  it('removing one of two co-located GAPs: cell stays jammed in TS (counter > 0)', () => {
    // C++ Remove_Gap_Effect (building.cpp:5687): UnJam_From clears the house bit entirely,
    // then lines 5694-5696 reset all other same-house GAPs' IsJamming=false, Arm=0
    // so they re-jam on next AI tick. Net result: cell re-jammed next tick.
    //
    // TS: destroying gap1 decrements counter from 2→1, cell stays jammed immediately.
    // Same end state, different path.

    const gap1 = makeGapStructure(50, 50);
    const gap2 = makeGapStructure(50, 50);

    const ctx = makeFogContext({
      structures: [gap1, gap2],
      powerProduced: 200,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);
    expect(isCellJammed(ctx.map, 50, 50)).toBe(true);

    // Destroy gap1
    gap1.alive = false;
    gap1.hp = 0;
    ctx.tick = GAP_UPDATE_INTERVAL * 2;

    updateGapGenerators(ctx);

    // Cell should still be jammed (gap2 still alive)
    expect(isCellJammed(ctx.map, 50, 50)).toBe(true);
  });

  it('removing ALL co-located GAPs: cell becomes unjammed', () => {
    const gap1 = makeGapStructure(50, 50);
    const gap2 = makeGapStructure(50, 50);

    const ctx = makeFogContext({
      structures: [gap1, gap2],
      powerProduced: 200,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);
    expect(isCellJammed(ctx.map, 50, 50)).toBe(true);

    // Destroy both GAPs
    gap1.alive = false;
    gap1.hp = 0;
    gap2.alive = false;
    gap2.hp = 0;
    ctx.tick = GAP_UPDATE_INTERVAL * 2;

    updateGapGenerators(ctx);
    expect(isCellJammed(ctx.map, 50, 50)).toBe(false);
  });
});

// =============================================================================
// Section 6: GAP center offset from structure position
// C++ building.cpp:998 — Coord_Cell(Center_Coord()) for jam origin
// TS fog.ts:265-266 — cx = s.cx + Math.floor(gw / 2), cy = s.cy + Math.floor(gh / 2)
// =============================================================================

describe('C++ parity: GAP jam center calculation', () => {
  it('1x2 GAP: center is offset by floor(h/2) in Y', () => {
    // C++ Center_Coord() for a 1x2 building returns center of the footprint
    // Coord_Cell() converts back to cell coords
    // TS: STRUCTURE_SIZE['GAP'] = [1,2], so cx + floor(1/2)=0 = cx, cy + floor(2/2)=1 = cy+1
    const [gw, gh] = STRUCTURE_SIZE['GAP'] ?? [1, 2];
    expect(gw).toBe(1);
    expect(gh).toBe(2);

    const ctx = makeFogContext({
      structures: [makeGapStructure(40, 40)],
      powerProduced: 200,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);

    // The center of jamming should be at (40, 41) — cy + floor(2/2) = 41
    const centerY = 41;
    // Verify by checking symmetry: cells at +r and -r from center should both be jammed
    expect(isCellJammed(ctx.map, 40 + GAP_RADIUS, centerY)).toBe(true);
    expect(isCellJammed(ctx.map, 40 - GAP_RADIUS, centerY)).toBe(true);
    expect(isCellJammed(ctx.map, 40, centerY + GAP_RADIUS)).toBe(true);
    expect(isCellJammed(ctx.map, 40, centerY - GAP_RADIUS)).toBe(true);

    // One cell beyond radius: NOT jammed
    expect(isCellJammed(ctx.map, 40 + GAP_RADIUS + 1, centerY)).toBe(false);
    expect(isCellJammed(ctx.map, 40 - GAP_RADIUS - 1, centerY)).toBe(false);
  });
});

// =============================================================================
// Section 7: GAP_UPDATE_INTERVAL tick gating
// C++ building.cpp:991-993 — Arm timer decrements, resets to
//   TICKS_PER_MINUTE * Rule.GapRegenInterval + Random_Pick(1, TICKS_PER_SECOND)
// TS fog.ts:240 — if (ctx.tick % GAP_UPDATE_INTERVAL !== 0) return
// =============================================================================

describe('C++ parity: GAP update interval gating', () => {
  it('GAP does NOT jam on non-interval ticks', () => {
    // C++ uses Arm countdown timer; TS uses modulo check
    // Both prevent jamming on every single tick
    const ctx = makeFogContext({
      structures: [makeGapStructure(40, 40)],
      powerProduced: 200,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL + 1, // NOT on interval
    });

    updateGapGenerators(ctx);
    expect(countJammedCells(ctx.map)).toBe(0);
  });

  it('GAP jams on interval-aligned ticks', () => {
    const ctx = makeFogContext({
      structures: [makeGapStructure(40, 40)],
      powerProduced: 200,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL * 3, // on interval
    });

    updateGapGenerators(ctx);
    expect(countJammedCells(ctx.map)).toBeGreaterThan(0);
  });

  it('tick 0 is a valid update interval', () => {
    // GAP_UPDATE_INTERVAL: 0 % 90 === 0
    const ctx = makeFogContext({
      structures: [makeGapStructure(40, 40)],
      powerProduced: 200,
      powerConsumed: 100,
      tick: 0,
    });

    updateGapGenerators(ctx);
    expect(countJammedCells(ctx.map)).toBeGreaterThan(0);
  });
});

// =============================================================================
// Section 8: GAP does not jam when dead
// C++ building.cpp:990 — AI only runs for active buildings (dead buildings are deleted)
// TS fog.ts:250 — if (s.type !== 'GAP' || !s.alive) continue
// =============================================================================

describe('C++ parity: dead GAP does not jam', () => {
  it('dead GAP structure is skipped entirely', () => {
    const ctx = makeFogContext({
      structures: [makeGapStructure(40, 40, House.Spain, false)],
      powerProduced: 200,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);
    expect(countJammedCells(ctx.map)).toBe(0);
  });
});

// =============================================================================
// Section 9: Sell / capture resets GAP state
// C++ building.cpp:3557-3558 — sell calls Remove_Gap_Effect()
// C++ building.cpp:2970-2974 — capture: Remove_Gap_Effect, IsJamming=false, Arm=0
// =============================================================================

describe('C++ parity: GAP sell/capture removes jamming (building.cpp:2970-2974, 3557-3558)', () => {
  it('killing (simulating sell) a GAP removes its jam cells', () => {
    // Same behavior as destruction — alive→false triggers cleanup
    const gap = makeGapStructure(40, 40);
    const ctx = makeFogContext({
      structures: [gap],
      powerProduced: 200,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);
    expect(countJammedCells(ctx.map)).toBeGreaterThan(0);

    // "Sell" the GAP
    gap.alive = false;
    ctx.tick = GAP_UPDATE_INTERVAL * 2;

    updateGapGenerators(ctx);
    expect(countJammedCells(ctx.map)).toBe(0);
  });
});

// =============================================================================
// Section 10: Jam cell count — verify the circular area formula
// The number of jammed cells for radius r should match the discrete circle area
// C++ Jam_From iterates cells checking Lepton distance; TS uses dx^2+dy^2<=r^2
// =============================================================================

describe('C++ parity: GAP jam cell count matches C++ octagonal distance area', () => {
  it('GAP_RADIUS=10 jams the correct number of cells (C++ octagonal)', () => {
    // C++ coord.cpp:124-136 octagonal distance: max(|dx|,|dy|)*2 + min(|dx|,|dy|) <= radius*2
    const r = GAP_RADIUS;
    let expectedCount = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        const big = adx > ady ? adx : ady;
        const small = adx > ady ? ady : adx;
        if (big * 2 + small <= r * 2) {
          expectedCount++;
        }
      }
    }

    // Place GAP far enough from edges to avoid boundary clipping
    const ctx = makeFogContext({
      structures: [makeGapStructure(64, 64)],
      powerProduced: 200,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);
    expect(countJammedCells(ctx.map)).toBe(expectedCount);
  });
});

// =============================================================================
// Section 11: Edge-of-map boundary clamping
// C++ Jam_From would skip out-of-bounds cells
// TS map.ts:703 — if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return
// =============================================================================

describe('C++ parity: GAP near map edge clips to bounds', () => {
  it('GAP at (0, 0) only jams cells within map bounds', () => {
    const ctx = makeFogContext({
      structures: [makeGapStructure(0, 0)],
      powerProduced: 200,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);

    // GAP is 1x2 at (0,0), center = (0, 1)
    const centerY = 1;
    // Center and nearby cells should be jammed (others are out of bounds)
    expect(isCellJammed(ctx.map, 0, centerY)).toBe(true);
    expect(isCellJammed(ctx.map, 5, 5)).toBe(true);
    // Negative coords are out of bounds — should not cause errors
    expect(countJammedCells(ctx.map)).toBeGreaterThan(0);

    // Calculate expected: only cells where cx>=0 && cy>=0
    // C++ coord.cpp:124-136 octagonal distance: max*2+min <= radius*2
    // Center is at (0, centerY)
    const r = GAP_RADIUS;
    let expected = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        const big = adx > ady ? adx : ady;
        const small = adx > ady ? ady : adx;
        if (big * 2 + small <= r * 2 && (0 + dx) >= 0 && (centerY + dy) >= 0) {
          expected++;
        }
      }
    }
    expect(countJammedCells(ctx.map)).toBe(expected);
  });
});

// =============================================================================
// Section 12: C++ Arm timer periodic re-jam vs TS tick modulo
// C++ building.cpp:991-993:
//   if (Arm == 0) { IsJamming = false; Arm = TICKS_PER_MINUTE * Rule.GapRegenInterval + rand; }
// This means C++ periodically CLEARS and RE-APPLIES jamming (to handle unit movement
// revealing cells). TS's modulo approach effectively does the same by re-running
// the full jam logic on each interval.
// =============================================================================

describe('C++ parity: periodic re-jam cycle', () => {
  it('re-running updateGapGenerators at next interval does not double-jam', () => {
    // C++ resets IsJamming→false then re-jams (Jam_From sets bitmask, idempotent per-house)
    // TS: should skip re-jamming if already tracked in gapGeneratorCells
    const ctx = makeFogContext({
      structures: [makeGapStructure(50, 50)],
      powerProduced: 200,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);
    const firstJamCount = getJamCount(ctx.map, 50, 50);

    // Run again at next interval
    ctx.tick = GAP_UPDATE_INTERVAL * 2;
    updateGapGenerators(ctx);
    const secondJamCount = getJamCount(ctx.map, 50, 50);

    // C++ bitmask: |= same bit → no change. TS should also not increment.
    // If TS increments the counter each interval, this diverges from C++ idempotent behavior.
    expect(secondJamCount).toBe(firstJamCount);
  });
});

// =============================================================================
// Section 13: Power fraction computation divergence
// C++ house.cpp:4164: if (Power >= Drain || Drain == 0) return(1);
// C++ house.cpp:4166-4168: if (Power) return fixed(Power, Drain); else return 0;
// TS fog.ts:242-244: pf = ctx.powerProduced > 0 ? ctx.powerProduced / Math.max(ctx.powerConsumed, 1) : 0;
// =============================================================================

describe('C++ parity: power fraction edge cases for GAP gating', () => {
  it('C++ Power=0, Drain=0 → fraction=1 (GAP activates); TS may diverge', () => {
    // C++ house.cpp:4164: Drain == 0 → return 1 → GAP activates
    // TS fog.ts:242-244: powerProduced=0 → pf = 0 → GAP does NOT activate  // PARITY GAP
    const ctx = makeFogContext({
      structures: [makeGapStructure(40, 40)],
      powerProduced: 0,
      powerConsumed: 0,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);
    // C++ expected: GAP activates (drain==0 → powered)
    expect(countJammedCells(ctx.map)).toBeGreaterThan(0);
  });

  it('C++ Power=0, Drain>0 → fraction=0 (GAP does NOT activate)', () => {
    // C++ house.cpp:4168: return(0) — no power at all
    // TS: powerProduced=0 → pf = 0 < 1 → GAP does not activate (agrees)
    const ctx = makeFogContext({
      structures: [makeGapStructure(40, 40)],
      powerProduced: 0,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);
    expect(countJammedCells(ctx.map)).toBe(0);
  });
});

// =============================================================================
// Section 14: Multiple GAPs from different houses
// C++ cell.h:124: Jammed is per-house bitmask — different houses set different bits
// C++ display.cpp:4160: Jammed & (1 << PlayerPtr->Class->House)
// TS: single global counter, no per-house distinction
// =============================================================================

describe('C++ parity: multi-house GAP jamming', () => {
  it('two GAPs from different houses should both contribute to jamming', () => {
    // C++ sets different bits: (1 << HOUSE_SPAIN) | (1 << HOUSE_GREECE)
    // TS increments counter: 2 (both contribute)
    // Functionally equivalent for "is cell jammed?" check from any perspective
    const gap1 = makeGapStructure(50, 50, House.Spain);
    const gap2 = makeGapStructure(50, 50, House.Greece);

    const ctx = makeFogContext({
      structures: [gap1, gap2],
      powerProduced: 200,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);
    expect(isCellJammed(ctx.map, 50, 50)).toBe(true);
    // Counter should be 2 in TS (one per GAP)
    expect(getJamCount(ctx.map, 50, 50)).toBe(2);
  });
});

// =============================================================================
// Section 15: gapGeneratorCells state tracking
// TS fog.ts:246-286: gapGeneratorCells Map tracks which GAPs are active
// This is the TS substitute for C++'s per-building IsJamming flag
// =============================================================================

describe('C++ parity: gapGeneratorCells tracking (TS IsJamming equivalent)', () => {
  it('active GAP is tracked in gapGeneratorCells', () => {
    // TS fog.ts:278: ctx.gapGeneratorCells.set(si, { cx, cy, radius: r })
    const ctx = makeFogContext({
      structures: [makeGapStructure(40, 40)],
      powerProduced: 200,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);
    expect(ctx.gapGeneratorCells.size).toBe(1);
    expect(ctx.gapGeneratorCells.has(0)).toBe(true);
  });

  it('destroyed GAP is removed from gapGeneratorCells', () => {
    const gap = makeGapStructure(40, 40);
    const ctx = makeFogContext({
      structures: [gap],
      powerProduced: 200,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);
    expect(ctx.gapGeneratorCells.size).toBe(1);

    gap.alive = false;
    ctx.tick = GAP_UPDATE_INTERVAL * 2;

    updateGapGenerators(ctx);
    expect(ctx.gapGeneratorCells.size).toBe(0);
  });

  it('unpowered GAP is removed from gapGeneratorCells', () => {
    const ctx = makeFogContext({
      structures: [makeGapStructure(40, 40)],
      powerProduced: 200,
      powerConsumed: 100,
      tick: GAP_UPDATE_INTERVAL,
    });

    updateGapGenerators(ctx);
    expect(ctx.gapGeneratorCells.size).toBe(1);

    ctx.powerProduced = 50;
    ctx.tick = GAP_UPDATE_INTERVAL * 2;

    updateGapGenerators(ctx);
    expect(ctx.gapGeneratorCells.size).toBe(0);
  });
});
