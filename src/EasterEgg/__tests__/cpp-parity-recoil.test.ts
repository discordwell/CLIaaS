/**
 * C++ Behavioral Parity Tests — Unit Recoil Mechanics
 *
 * C++ algorithm (techno.cpp, unit.cpp, building.cpp):
 *
 *   TRIGGER (techno.cpp:3114-3117):
 *     In Fire_At(), after bullet creation:
 *       if (tclass.IsTurretEquipped) {
 *           IsInRecoilState = true;
 *           Mark(MARK_CHANGE_REDRAW);
 *       }
 *     Only IsTurretEquipped units get recoil. Infantry, artillery, APCs,
 *     harvesters — none of these trigger recoil.
 *
 *   DURATION (techno.cpp:2338-2341):
 *     In TechnoClass::AI(), at the TOP of the function (before any other logic):
 *       if (IsInRecoilState) {
 *           IsInRecoilState = false;
 *           Mark(MARK_CHANGE_REDRAW);
 *       }
 *     Recoil lasts exactly 1 game tick. Set during Fire_At on tick N,
 *     cleared at the start of AI on tick N+1.
 *
 *   VISUAL EFFECT (unit.cpp:2057-2058, 2116-2119):
 *     For turreted units, ONLY the turret sprite gets Recoil_Adjust:
 *       if (IsInRecoilState) {
 *           Recoil_Adjust(SecondaryFacing, xx, yy);  // turret recoil
 *       }
 *     Artillery has dead code for body recoil (line 2057-2058):
 *       if (*this == UNIT_ARTY && IsInRecoilState) {
 *           Recoil_Adjust(PrimaryFacing.Current(), x, y);  // body recoil
 *       }
 *     But ARTY.IsTurretEquipped = false, so IsInRecoilState is never set.
 *
 *   PIXEL OFFSET (unit.cpp:125-167 Recoil_Adjust):
 *     32-entry table mapping DirType to {X,Y} pixel adjustments.
 *     Moves sprite 1px opposite to barrel direction.
 *     Collapsed to 8 directions in TS: RECOIL_OFFSETS.
 *
 *   BUILDING RECOIL (building.cpp:636-638):
 *     Non-SAM turreted buildings (GUN, AGUN) shift sprite frame by +32:
 *       if (IsInRecoilState) shapenum += 32;
 *     This is a frame-based visual, not a pixel offset.
 *
 * C++ reference: CnC_and_Red_Alert/RA/techno.cpp, unit.cpp, building.cpp, techno.h
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds, RECOIL_OFFSETS } from '../engine/entity';
import { Dir, UnitType, House } from '../engine/types';

beforeEach(() => resetEntityIds());

// Helper: create an entity of the given type
function makeEntity(type: UnitType, x = 100, y = 100): Entity {
  return new Entity(type, House.Spain, x, y);
}

// ============================================================
// Section 1: Recoil field initialization
// C++ techno.cpp:602 — IsInRecoilState(false)
// ============================================================
describe('recoil field initialization (techno.cpp:602)', () => {
  it('IsInRecoilState initializes to false', () => {
    const tank = makeEntity(UnitType.V_2TNK);
    expect(tank.isInRecoilState).toBe(false);
  });

  it('all unit types start with isInRecoilState=false', () => {
    const types: UnitType[] = [
      UnitType.V_1TNK, UnitType.V_2TNK, UnitType.V_3TNK, UnitType.V_4TNK,
      UnitType.V_ARTY, UnitType.V_JEEP, UnitType.V_APC, UnitType.V_HARV,
      UnitType.I_E1, UnitType.I_E3, UnitType.I_E4,
    ];
    for (const type of types) {
      const e = makeEntity(type);
      expect(e.isInRecoilState, `${type} should start with recoil=false`).toBe(false);
    }
  });
});

// ============================================================
// Section 2: Trigger condition — IsTurretEquipped
// C++ techno.cpp:3114 — if (tclass.IsTurretEquipped) IsInRecoilState = true;
// TS missionAI.ts:325 — if (entity.hasTurret) entity.isInRecoilState = true;
// ============================================================
describe('recoil trigger: IsTurretEquipped / hasTurret (techno.cpp:3114)', () => {
  // C++ IsTurretEquipped = true for: 1TNK, 2TNK, 3TNK, 4TNK, JEEP, STNK, DD, CA, PT
  // C++ IsTurretEquipped = false for: ARTY, APC, HARV, MCV, TRUK, V2RL, etc.
  // TS hasTurret getter should match.

  const TURRETED: UnitType[] = [
    UnitType.V_1TNK, UnitType.V_2TNK, UnitType.V_3TNK, UnitType.V_4TNK,
    UnitType.V_JEEP, UnitType.V_STNK,
    UnitType.V_DD, UnitType.V_CA, UnitType.V_PT,
  ];

  const NOT_TURRETED: UnitType[] = [
    UnitType.V_ARTY, UnitType.V_APC, UnitType.V_HARV, UnitType.V_MCV,
    UnitType.V_TRUK, UnitType.V_MRJ, UnitType.V_MGG,
    UnitType.V_LST, UnitType.V_CTNK, UnitType.V_TTNK,
    UnitType.V_QTNK, UnitType.V_DTRK, UnitType.V_V2RL, UnitType.V_MNLY,
    UnitType.V_SS, UnitType.V_MSUB,
  ];

  for (const type of TURRETED) {
    it(`${type} hasTurret=true (C++ IsTurretEquipped=true)`, () => {
      const e = makeEntity(type);
      expect(e.hasTurret).toBe(true);
    });
  }

  for (const type of NOT_TURRETED) {
    it(`${type} hasTurret=false (C++ IsTurretEquipped=false)`, () => {
      const e = makeEntity(type);
      expect(e.hasTurret).toBe(false);
    });
  }

  it('infantry never have turrets', () => {
    const infantry: UnitType[] = [
      UnitType.I_E1, UnitType.I_E2, UnitType.I_E3, UnitType.I_E4,
      UnitType.I_E6, UnitType.I_DOG, UnitType.I_SPY, UnitType.I_MEDI,
      UnitType.I_TANYA, UnitType.I_THF,
    ];
    for (const type of infantry) {
      const e = makeEntity(type);
      expect(e.hasTurret, `${type} should not have turret`).toBe(false);
    }
  });
});

// ============================================================
// Section 3: Recoil duration — exactly 1 tick
// C++ techno.cpp:2338-2341:
//   In AI() (called once per tick, at TOP of function):
//     if (IsInRecoilState) { IsInRecoilState = false; Mark(MARK_CHANGE_REDRAW); }
// TS index.ts:1513-1514:
//   In tick loop, before entity processing:
//     if (entity.isInRecoilState) entity.isInRecoilState = false;
// ============================================================
describe('recoil duration: exactly 1 tick (techno.cpp:2338-2341)', () => {
  it('recoil set on fire, cleared on next tick — manual simulation', () => {
    const tank = makeEntity(UnitType.V_2TNK);
    // Simulate Fire_At: set recoil (C++ techno.cpp:3115)
    expect(tank.hasTurret).toBe(true);
    tank.isInRecoilState = true;
    expect(tank.isInRecoilState).toBe(true);

    // Simulate next tick AI (C++ techno.cpp:2338-2339): clear recoil
    if (tank.isInRecoilState) tank.isInRecoilState = false;
    expect(tank.isInRecoilState).toBe(false);
  });

  it('recoil does not persist across two clears', () => {
    const tank = makeEntity(UnitType.V_1TNK);
    tank.isInRecoilState = true;

    // Tick 1: clear
    if (tank.isInRecoilState) tank.isInRecoilState = false;
    expect(tank.isInRecoilState).toBe(false);

    // Tick 2: still false (no re-trigger)
    if (tank.isInRecoilState) tank.isInRecoilState = false;
    expect(tank.isInRecoilState).toBe(false);
  });

  it('recoil can be re-triggered after clearing', () => {
    const tank = makeEntity(UnitType.V_3TNK);

    // Fire → recoil on
    tank.isInRecoilState = true;
    expect(tank.isInRecoilState).toBe(true);

    // Next tick AI: clear
    if (tank.isInRecoilState) tank.isInRecoilState = false;
    expect(tank.isInRecoilState).toBe(false);

    // Fire again → recoil on
    tank.isInRecoilState = true;
    expect(tank.isInRecoilState).toBe(true);
  });
});

// ============================================================
// Section 4: Recoil_Adjust pixel offsets — C++ 32-entry table
// C++ unit.cpp:125-167 — 32-entry signed char table
// TS entity.ts:742-751 — collapsed to 8-entry RECOIL_OFFSETS
// ============================================================
describe('Recoil_Adjust pixel offsets (unit.cpp:125-167)', () => {
  /**
   * C++ has 32 entries (4 entries per cardinal direction):
   *   N(0-3):  {0,1} {0,1} {0,1} {-1,1}
   *   NE(4-7): {-1,1} {-1,1} {-1,0} {-1,0}
   *   E(8-11): {-1,0} {-1,0} {-1,-1} {-1,-1}
   *   SE(12-15): {-1,-1} {-1,-1} {-1,-1} {0,-1}
   *   S(16-19): {0,-1} {0,-1} {0,-1} {1,-1}
   *   SW(20-23): {1,-1} {1,-1} {1,0} {1,0}
   *   W(24-27): {1,0} {1,0} {1,1} {1,1}
   *   NW(28-31): {1,1} {1,1} {0,1} {0,1}
   *
   * The TS collapses to 8 entries — one per cardinal direction.
   * The TS picks the entry at the "center" of each 4-slot group.
   * Verify the representative entry matches the C++ center (index 0 of each group).
   */

  // C++ representative entries for each 8-dir (index 0 of each 4-entry group):
  const CPP_CENTER: Array<{ dx: number; dy: number }> = [
    { dx: 0, dy: 1 },   // N  [0]
    { dx: -1, dy: 1 },  // NE [4]
    { dx: -1, dy: 0 },  // E  [8]
    { dx: -1, dy: -1 }, // SE [12]
    { dx: 0, dy: -1 },  // S  [16]
    { dx: 1, dy: -1 },  // SW [20]
    { dx: 1, dy: 0 },   // W  [24]
    { dx: 1, dy: 1 },   // NW [28]
  ];

  it('TS RECOIL_OFFSETS matches C++ table at each cardinal direction', () => {
    for (let d = 0; d < 8; d++) {
      const dirName = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][d];
      expect(RECOIL_OFFSETS[d].dx, `${dirName}.dx`).toBe(CPP_CENTER[d].dx);
      expect(RECOIL_OFFSETS[d].dy, `${dirName}.dy`).toBe(CPP_CENTER[d].dy);
    }
  });

  it('recoil direction is opposite to barrel direction', () => {
    // N-facing barrel points up → body kicks DOWN (dy=+1 in screen coords)
    expect(RECOIL_OFFSETS[Dir.N].dy).toBeGreaterThan(0);
    // S-facing barrel points down → body kicks UP (dy=-1)
    expect(RECOIL_OFFSETS[Dir.S].dy).toBeLessThan(0);
    // E-facing barrel points right → body kicks LEFT (dx=-1)
    expect(RECOIL_OFFSETS[Dir.E].dx).toBeLessThan(0);
    // W-facing barrel points left → body kicks RIGHT (dx=+1)
    expect(RECOIL_OFFSETS[Dir.W].dx).toBeGreaterThan(0);
  });

  it('opposite directions produce opposite offsets', () => {
    // Helper: compare values treating -0 and +0 as equal (both are 0 in C++ signed char)
    const eq = (a: number, b: number) => expect(a + 0).toBe(b + 0);
    // N vs S
    eq(RECOIL_OFFSETS[Dir.N].dx, -RECOIL_OFFSETS[Dir.S].dx);
    eq(RECOIL_OFFSETS[Dir.N].dy, -RECOIL_OFFSETS[Dir.S].dy);
    // E vs W
    eq(RECOIL_OFFSETS[Dir.E].dx, -RECOIL_OFFSETS[Dir.W].dx);
    eq(RECOIL_OFFSETS[Dir.E].dy, -RECOIL_OFFSETS[Dir.W].dy);
    // NE vs SW
    eq(RECOIL_OFFSETS[Dir.NE].dx, -RECOIL_OFFSETS[Dir.SW].dx);
    eq(RECOIL_OFFSETS[Dir.NE].dy, -RECOIL_OFFSETS[Dir.SW].dy);
    // SE vs NW
    eq(RECOIL_OFFSETS[Dir.SE].dx, -RECOIL_OFFSETS[Dir.NW].dx);
    eq(RECOIL_OFFSETS[Dir.SE].dy, -RECOIL_OFFSETS[Dir.NW].dy);
  });

  it('cardinal offsets have magnitude 1 (exactly 1 pixel)', () => {
    for (let d = 0; d < 8; d++) {
      const ro = RECOIL_OFFSETS[d];
      const magnitude = Math.sqrt(ro.dx * ro.dx + ro.dy * ro.dy);
      // Cardinals: exactly 1.0, diagonals: ~1.414
      expect(magnitude, `Dir ${d} magnitude`).toBeGreaterThanOrEqual(1.0);
      expect(magnitude, `Dir ${d} magnitude`).toBeLessThanOrEqual(1.5);
    }
  });

  it('array has exactly 8 entries', () => {
    expect(RECOIL_OFFSETS).toHaveLength(8);
  });
});

// ============================================================
// Section 5: Recoil is visual-only
// C++ techno.h:106-109 — "Buildings and units with turrets usually have
//   a recoil animation when they fire."
// Recoil has NO gameplay effect: does not affect targeting, pathfinding,
// collision, or damage calculations.
// ============================================================
describe('recoil is visual-only (techno.h:106-109)', () => {
  it('recoil does not change entity position', () => {
    const tank = makeEntity(UnitType.V_2TNK, 200, 300);
    const origX = tank.pos.x;
    const origY = tank.pos.y;

    tank.isInRecoilState = true;
    expect(tank.pos.x).toBe(origX);
    expect(tank.pos.y).toBe(origY);

    // Clear recoil — position still unchanged
    tank.isInRecoilState = false;
    expect(tank.pos.x).toBe(origX);
    expect(tank.pos.y).toBe(origY);
  });

  it('recoil does not change entity facing', () => {
    const tank = makeEntity(UnitType.V_2TNK);
    tank.facing = Dir.NE;
    tank.turretFacing = Dir.E;

    tank.isInRecoilState = true;
    expect(tank.facing).toBe(Dir.NE);
    expect(tank.turretFacing).toBe(Dir.E);
  });

  it('recoil does not change entity health', () => {
    const tank = makeEntity(UnitType.V_2TNK);
    const origHp = tank.hp;

    tank.isInRecoilState = true;
    expect(tank.hp).toBe(origHp);
  });
});

// ============================================================
// Section 6: ARTY body recoil — dead code in C++
// C++ unit.cpp:2057-2058:
//   if (*this == UNIT_ARTY && IsInRecoilState) {
//       Recoil_Adjust(PrimaryFacing.Current(), x, y);  // body kicks back
//   }
// But ARTY has IsTurretEquipped=false, so IsInRecoilState is never set.
// This is effectively dead code. TS correctly excludes ARTY from hasTurret.
// ============================================================
describe('ARTY body recoil — dead code parity (unit.cpp:2057-2058)', () => {
  it('ARTY does not have turret (IsTurretEquipped=false in C++)', () => {
    const arty = makeEntity(UnitType.V_ARTY);
    expect(arty.hasTurret).toBe(false);
  });

  it('ARTY recoil never triggers via hasTurret guard (matching C++ dead code)', () => {
    const arty = makeEntity(UnitType.V_ARTY);
    // Simulate fire: hasTurret check prevents recoil from being set
    if (arty.hasTurret) arty.isInRecoilState = true;
    expect(arty.isInRecoilState).toBe(false);
  });

  it('ARTY can still have recoil forced on (field is writable), matching C++ field', () => {
    // Even though C++ never triggers it, the field exists on ARTY (it's in TechnoClass)
    const arty = makeEntity(UnitType.V_ARTY);
    arty.isInRecoilState = true;
    expect(arty.isInRecoilState).toBe(true);
    // But it would be cleared next tick:
    if (arty.isInRecoilState) arty.isInRecoilState = false;
    expect(arty.isInRecoilState).toBe(false);
  });
});

// ============================================================
// Section 7: Turret vs body recoil application
// C++ unit.cpp:2116-2119 — turreted units: only turret gets Recoil_Adjust
//   if (IsInRecoilState) { Recoil_Adjust(SecondaryFacing, xx, yy); }
// C++ uses SecondaryFacing (turret facing) for the recoil direction.
// TS renderer.ts:1960-1964 — uses entity.turretFacing for turreted units.
// ============================================================
describe('recoil facing selection (unit.cpp:2116-2119)', () => {
  it('turreted units: recoil uses turretFacing, not body facing', () => {
    // C++: Recoil_Adjust(SecondaryFacing, xx, yy) — uses turret direction
    // TS: const rFacing = entity.hasTurret ? entity.turretFacing : entity.facing
    const tank = makeEntity(UnitType.V_2TNK);
    tank.facing = Dir.N;
    tank.turretFacing = Dir.E;

    // The recoil offset should come from turretFacing (E), not body facing (N)
    const rFacing = tank.hasTurret ? tank.turretFacing : tank.facing;
    expect(rFacing).toBe(Dir.E);
    const ro = RECOIL_OFFSETS[rFacing];
    expect(ro.dx).toBe(-1); // E turret → kicks west
    expect(ro.dy).toBe(0);
  });

  it('non-turreted units: recoil would use body facing (C++ PrimaryFacing)', () => {
    // C++ ARTY dead code: Recoil_Adjust(PrimaryFacing.Current(), x, y)
    // TS: const rFacing = entity.hasTurret ? entity.turretFacing : entity.facing
    const arty = makeEntity(UnitType.V_ARTY);
    arty.facing = Dir.S;

    const rFacing = arty.hasTurret ? arty.turretFacing : arty.facing;
    expect(rFacing).toBe(Dir.S);
    const ro = RECOIL_OFFSETS[rFacing];
    expect(ro.dx).toBe(0);
    expect(ro.dy).toBe(-1); // S → kicks north
  });
});

// ============================================================
// Section 8: Infantry recoil exclusion
// C++ infantry never have IsTurretEquipped, so they never get recoil.
// TS renderer.ts:1960 — explicit guard: entity.isInRecoilState && !entity.stats.isInfantry
// ============================================================
describe('infantry recoil exclusion (renderer.ts:1960)', () => {
  it('infantry isInfantry flag is true', () => {
    const e1 = makeEntity(UnitType.I_E1);
    expect(e1.stats.isInfantry).toBe(true);
  });

  it('vehicle isInfantry flag is false', () => {
    const tank = makeEntity(UnitType.V_2TNK);
    expect(tank.stats.isInfantry).toBe(false);
  });

  it('infantry hasTurret is always false (preventing recoil trigger)', () => {
    const infantry: UnitType[] = [
      UnitType.I_E1, UnitType.I_E2, UnitType.I_E3, UnitType.I_E4,
      UnitType.I_E6, UnitType.I_DOG, UnitType.I_SPY, UnitType.I_MEDI,
      UnitType.I_TANYA,
    ];
    for (const type of infantry) {
      const e = makeEntity(type);
      expect(e.hasTurret, `${type} should not have turret`).toBe(false);
    }
  });
});

// ============================================================
// Section 9: C++ 32-entry vs TS 8-entry table fidelity
// C++ unit.cpp:129-162 — 32 entries, 4 per cardinal direction
// Within each 4-entry group, entries vary (transition values).
// TS collapses to 1 entry per group. Verify the chosen entry is reasonable.
// ============================================================
describe('C++ 32-entry table collapse to 8-entry (unit.cpp:129-162)', () => {
  // Full C++ 32-entry table for reference verification
  const CPP_32: Array<{ x: number; y: number }> = [
    { x: 0, y: 1 },   // 0  N
    { x: 0, y: 1 },   // 1
    { x: 0, y: 1 },   // 2
    { x: -1, y: 1 },  // 3
    { x: -1, y: 1 },  // 4  NE
    { x: -1, y: 1 },  // 5
    { x: -1, y: 0 },  // 6
    { x: -1, y: 0 },  // 7
    { x: -1, y: 0 },  // 8  E
    { x: -1, y: 0 },  // 9
    { x: -1, y: -1 }, // 10
    { x: -1, y: -1 }, // 11
    { x: -1, y: -1 }, // 12 SE
    { x: -1, y: -1 }, // 13
    { x: -1, y: -1 }, // 14
    { x: 0, y: -1 },  // 15
    { x: 0, y: -1 },  // 16 S
    { x: 0, y: -1 },  // 17
    { x: 0, y: -1 },  // 18
    { x: 1, y: -1 },  // 19
    { x: 1, y: -1 },  // 20 SW
    { x: 1, y: -1 },  // 21
    { x: 1, y: 0 },   // 22
    { x: 1, y: 0 },   // 23
    { x: 1, y: 0 },   // 24 W
    { x: 1, y: 0 },   // 25
    { x: 1, y: 1 },   // 26
    { x: 1, y: 1 },   // 27
    { x: 1, y: 1 },   // 28 NW
    { x: 1, y: 1 },   // 29
    { x: 0, y: 1 },   // 30
    { x: 0, y: 1 },   // 31
  ];

  it('C++ table has 32 entries', () => {
    expect(CPP_32).toHaveLength(32);
  });

  it('TS 8-entry matches C++ entries at indices 0,4,8,12,16,20,24,28', () => {
    // C++ Dir_To_32() maps 8-dir facing to 32-entry index: dir * 4
    for (let dir8 = 0; dir8 < 8; dir8++) {
      const cppIdx = dir8 * 4;
      expect(RECOIL_OFFSETS[dir8].dx, `Dir ${dir8} dx`).toBe(CPP_32[cppIdx].x);
      expect(RECOIL_OFFSETS[dir8].dy, `Dir ${dir8} dy`).toBe(CPP_32[cppIdx].y);
    }
  });

  it('C++ transition entries within each group differ from cardinal entries', () => {
    // The 4 entries per direction are NOT all identical.
    // e.g., N group: [0,1] [0,1] [0,1] [-1,1] — the 4th entry transitions toward NE.
    // This means the 32-to-8 collapse loses some precision for sub-facings.
    // Since TS uses 8-dir facings anyway, this is acceptable.
    expect(CPP_32[3].x).toBe(-1); // N→NE transition
    expect(CPP_32[3].y).toBe(1);
    expect(CPP_32[0].x).toBe(0);  // N center
    expect(CPP_32[0].y).toBe(1);
    // Demonstrates that entry [3] differs from [0] in dx
    expect(CPP_32[3].x).not.toBe(CPP_32[0].x);
  });
});

// ============================================================
// Section 10: Recoil clearing order — C++ clears at TOP of AI
// C++ techno.cpp:2338-2341 — recoil cleared BEFORE any other AI processing.
// This means recoil lasts from Fire_At to the start of the next tick's AI.
// If an entity fires and then AI runs in the same tick (shouldn't happen
// per C++ comment "only called ONCE per game tick"), recoil would be visible
// for 0 ticks. But the correct sequence is:
//   Tick N: AI() clears old recoil → Fire_At() sets new recoil
//   Tick N+1: AI() clears this recoil
// ============================================================
describe('recoil clearing order (techno.cpp:2331-2341)', () => {
  it('sequence: clear→fire→(recoil visible)→clear — 1 tick duration', () => {
    const tank = makeEntity(UnitType.V_2TNK);

    // --- Tick N ---
    // Step 1: AI clears any old recoil (techno.cpp:2338-2339)
    if (tank.isInRecoilState) tank.isInRecoilState = false;
    expect(tank.isInRecoilState).toBe(false);

    // Step 2: Fire_At triggers recoil (techno.cpp:3114-3115)
    if (tank.hasTurret) tank.isInRecoilState = true;
    expect(tank.isInRecoilState).toBe(true);

    // --- Tick N+1 ---
    // Step 3: AI clears this recoil (techno.cpp:2338-2339)
    if (tank.isInRecoilState) tank.isInRecoilState = false;
    expect(tank.isInRecoilState).toBe(false);
  });

  it('if unit fires every tick, recoil is always set then cleared', () => {
    const tank = makeEntity(UnitType.V_1TNK);

    for (let tick = 0; tick < 5; tick++) {
      // AI: clear previous recoil
      if (tank.isInRecoilState) tank.isInRecoilState = false;
      expect(tank.isInRecoilState, `tick ${tick} after clear`).toBe(false);

      // Fire: set recoil
      if (tank.hasTurret) tank.isInRecoilState = true;
      expect(tank.isInRecoilState, `tick ${tick} after fire`).toBe(true);
    }
  });
});

// ============================================================
// Section 11: Aircraft recoil
// C++ aircraft don't typically have IsTurretEquipped (helicopters use
// a different firing animation). Verify TS matches.
// ============================================================
describe('aircraft recoil exclusion', () => {
  it('aircraft types do not have turrets (hasTurret=false)', () => {
    const aircraft: UnitType[] = [
      UnitType.V_HELI, UnitType.V_HIND, UnitType.V_MIG, UnitType.V_YAK,
      UnitType.V_BADR, UnitType.V_U2, UnitType.V_TRAN,
    ];
    for (const type of aircraft) {
      const e = makeEntity(type);
      // C++: aircraft have isAircraft=true, which excludes them from hasTurret in TS
      expect(e.hasTurret, `${type} should not have turret`).toBe(false);
    }
  });
});

// ============================================================
// Section 12: Naval recoil parity
// C++ udata.cpp: DD, CA, PT have IsTurretEquipped=true; SS, MSUB do not.
// ============================================================
describe('naval unit recoil parity', () => {
  it('DD (Destroyer) has turret → gets recoil', () => {
    const dd = makeEntity(UnitType.V_DD);
    expect(dd.hasTurret).toBe(true);
  });

  it('CA (Cruiser) has turret → gets recoil', () => {
    const ca = makeEntity(UnitType.V_CA);
    expect(ca.hasTurret).toBe(true);
  });

  it('PT (Gunboat) has turret → gets recoil', () => {
    const pt = makeEntity(UnitType.V_PT);
    expect(pt.hasTurret).toBe(true);
  });

  it('SS (Submarine) has no turret → no recoil', () => {
    const ss = makeEntity(UnitType.V_SS);
    expect(ss.hasTurret).toBe(false);
  });

  it('MSUB (Missile Sub) has no turret → no recoil', () => {
    const msub = makeEntity(UnitType.V_MSUB);
    expect(msub.hasTurret).toBe(false);
  });
});

// ============================================================
// Section 13: Expansion unit recoil parity
// C++ udata.cpp: Expansion vehicles (STNK, CTNK, TTNK, etc.) —
// most are non-turreted in RA expansion.
// ============================================================
describe('Counterstrike/Aftermath expansion unit recoil', () => {
  // These units fire without turret rotation — body-based firing
  // Note: STNK has IsTurretEquipped=true in C++ (udata.cpp:762), excluded from this list
  const EXPANSION_NO_TURRET: Array<[UnitType, string]> = [
    [UnitType.V_CTNK, 'Chrono Tank — body-aimed, no turret'],
    [UnitType.V_TTNK, 'Tesla Tank — body-aimed tesla weapon, no turret'],
    [UnitType.V_QTNK, 'M.A.D. Tank — seismic weapon, no turret'],
    [UnitType.V_DTRK, 'Demo Truck — kamikaze, no turret'],
    [UnitType.V_V2RL, 'V2 Rocket Launcher — fixed launcher, no turret'],
    [UnitType.V_MNLY, 'Minelayer — drops mines, no turret'],
  ];

  for (const [type, desc] of EXPANSION_NO_TURRET) {
    it(`${type}: no turret → no recoil (${desc})`, () => {
      const e = makeEntity(type);
      expect(e.hasTurret).toBe(false);
      // Simulate fire: recoil guard prevents setting
      if (e.hasTurret) e.isInRecoilState = true;
      expect(e.isInRecoilState).toBe(false);
    });
  }
});

// ============================================================
// Section 14: Recoil vs body recoil divergence check
// C++ turreted unit rendering: body drawn at (x,y), turret at (xx+recoil, yy+recoil)
// TS renderer.ts:1968-1986: body drawn at (screen.x, screen.y),
//   turret drawn at (screen.x + recoilDx, screen.y + recoilDy)
// This should match: recoil applies to turret layer only.
// ============================================================
describe('recoil applies to turret layer only (unit.cpp:2116-2127)', () => {
  it('TS renderer computes recoil offset from turretFacing for turreted units', () => {
    // This tests the logic replicated from renderer.ts:1960-1964
    const tank = makeEntity(UnitType.V_4TNK);
    tank.isInRecoilState = true;
    tank.turretFacing = Dir.NW;

    // Simulate renderer logic (renderer.ts:1960-1964)
    let recoilDx = 0, recoilDy = 0;
    if (tank.isInRecoilState && !tank.stats.isInfantry) {
      const rFacing = tank.hasTurret ? tank.turretFacing : tank.facing;
      const ro = RECOIL_OFFSETS[rFacing];
      recoilDx = ro.dx;
      recoilDy = ro.dy;
    }

    // NW turret → barrel points upper-left → body kicks lower-right
    expect(recoilDx).toBe(1);
    expect(recoilDy).toBe(1);
  });

  it('infantry in recoil state produces zero offset (renderer guard)', () => {
    const e1 = makeEntity(UnitType.I_E1);
    e1.isInRecoilState = true; // force on (shouldn't happen in practice)

    // Simulate renderer logic
    let recoilDx = 0, recoilDy = 0;
    if (e1.isInRecoilState && !e1.stats.isInfantry) {
      const rFacing = e1.hasTurret ? e1.turretFacing : e1.facing;
      const ro = RECOIL_OFFSETS[rFacing];
      recoilDx = ro.dx;
      recoilDy = ro.dy;
    }

    expect(recoilDx).toBe(0);
    expect(recoilDy).toBe(0);
  });

  it('all 8 turret facings produce valid 1px recoil offsets', () => {
    const tank = makeEntity(UnitType.V_2TNK);
    tank.isInRecoilState = true;

    for (let dir = 0; dir < 8; dir++) {
      tank.turretFacing = dir as Dir;
      const rFacing = tank.hasTurret ? tank.turretFacing : tank.facing;
      const ro = RECOIL_OFFSETS[rFacing];
      // Each offset should be {-1,0,+1} on each axis, with at least one non-zero
      expect(Math.abs(ro.dx), `Dir ${dir} dx`).toBeLessThanOrEqual(1);
      expect(Math.abs(ro.dy), `Dir ${dir} dy`).toBeLessThanOrEqual(1);
      expect(Math.abs(ro.dx) + Math.abs(ro.dy), `Dir ${dir} non-zero`).toBeGreaterThan(0);
    }
  });
});
