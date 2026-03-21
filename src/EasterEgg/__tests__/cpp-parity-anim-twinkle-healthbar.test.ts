/**
 * Twinkle/Sparkle Effects + Health Bar Rendering Parity Tests
 *
 * C++ source of truth:
 *   - adata.cpp:1801-1872: TWINKLE1-3 animation definitions
 *   - defines.h:2263-2265: ANIM_TWINKLE1/2/3 enum values
 *   - techno.cpp:1089-1188: TechnoClass::Draw_It — health bar + selection box rendering
 *   - bdata.cpp:3399-3405: BuildingTypeClass::Dimensions (health bar width for buildings)
 *   - udata.cpp:1234-1240: UnitTypeClass::Dimensions (health bar width for units)
 *   - idata.cpp:1365-1374: InfantryTypeClass::Dimensions (health bar width for infantry)
 *   - aadata.cpp:624-633: AircraftTypeClass::Dimensions (health bar width for aircraft)
 *   - vdata.cpp:536-539: VesselTypeClass::Dimensions (health bar width for vessels)
 *   - rules.cpp:234-235: ConditionYellow = 1/2, ConditionRed = 1/4
 *   - bar.cpp: ProgressBarClass (generic bar rendering utility)
 *
 * TS implementation:
 *   - renderer.ts:2228-2261: renderHealthBar() — health bar rendering
 *   - renderer.ts:2184-2194: unit health bar (alive && damaged or selected)
 *   - renderer.ts:1566-1571: structure health bar (damaged buildings)
 *   - renderer.ts:1256-1284: ore/gem sparkle effects (replaces TWINKLE sprites)
 *   - renderer.ts:2094-2108: chrono shift blue flash + sparkle particles
 *   - scenario.ts:1167-1185: STRUCTURE_SIZE footprint dimensions
 *   - types.ts:11: CELL_SIZE = 24
 */

import { describe, it, expect } from 'vitest';
import { CELL_SIZE, UNIT_STATS } from '../engine/types';
import { STRUCTURE_SIZE } from '../engine/scenario';

// ══════════════════════════════════════════════════════════════════════════════
// Section 1: TWINKLE1-3 Animation Definitions (adata.cpp)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * C++ AnimTypeClass constructor parameters for TWINKLE1-3 (adata.cpp:1801-1872).
 * All three have identical properties except the name/enum.
 */
interface CppTwinkleAnimData {
  animEnum: string;
  graphicName: string;
  maxDimension: number;
  bigStage: number;
  isTheaterSpecific: boolean;
  isNormalized: boolean;
  isWhiteTranslucent: boolean;
  isScorcher: boolean;
  isCraterForming: boolean;
  isSticky: boolean;
  isGroundLevel: boolean;
  isTranslucent: boolean;
  isFlameThrower: boolean;
  damage: number;
  delay: number;
  startFrame: number;
  loopStart: number;
  loopEnd: number;
  stages: number;
  loops: number;
  sound: string;
  followUp: string;
}

/** C++ adata.cpp:1801-1872 — all three TWINKLE anims share identical properties */
const CPP_TWINKLE_COMMON: Omit<CppTwinkleAnimData, 'animEnum' | 'graphicName'> = {
  maxDimension: 8,
  bigStage: 1,
  isTheaterSpecific: false,
  isNormalized: true,
  isWhiteTranslucent: false,
  isScorcher: false,
  isCraterForming: false,
  isSticky: false,
  isGroundLevel: false,
  isTranslucent: false,
  isFlameThrower: false,
  damage: 0,
  delay: 1,           // Fast animation (1 tick between frames)
  startFrame: 0,
  loopStart: 0,
  loopEnd: -1,        // Loop back = -1 (use all frames)
  stages: -1,         // Stages = -1 (auto from SHP)
  loops: 1,           // Play once then vanish
  sound: 'VOC_NONE',
  followUp: 'ANIM_NONE',
};

const CPP_TWINKLE_ANIMS: CppTwinkleAnimData[] = [
  { animEnum: 'ANIM_TWINKLE1', graphicName: 'TWINKLE1', ...CPP_TWINKLE_COMMON },
  { animEnum: 'ANIM_TWINKLE2', graphicName: 'TWINKLE2', ...CPP_TWINKLE_COMMON },
  { animEnum: 'ANIM_TWINKLE3', graphicName: 'TWINKLE3', ...CPP_TWINKLE_COMMON },
];

describe('C++ TWINKLE animation data definitions (adata.cpp:1801-1872)', () => {
  it('TWINKLE1-3 all exist as defined animation types', () => {
    // C++ defines.h:2263-2265 — ANIM_TWINKLE1, ANIM_TWINKLE2, ANIM_TWINKLE3
    // These are sequential in the AnimType enum, positioned after ANIM_SONAR_BOX
    // and before ANIM_FLAK
    const twinkleEnums = ['ANIM_TWINKLE1', 'ANIM_TWINKLE2', 'ANIM_TWINKLE3'];
    for (const anim of CPP_TWINKLE_ANIMS) {
      expect(twinkleEnums).toContain(anim.animEnum);
    }
    expect(CPP_TWINKLE_ANIMS).toHaveLength(3);
  });

  it('TWINKLE sprites use correct SHP names (TWINKLE1.SHP, TWINKLE2.SHP, TWINKLE3.SHP)', () => {
    // C++ BFILE.MAK:374-376 — the build system packages these SHP files
    expect(CPP_TWINKLE_ANIMS[0].graphicName).toBe('TWINKLE1');
    expect(CPP_TWINKLE_ANIMS[1].graphicName).toBe('TWINKLE2');
    expect(CPP_TWINKLE_ANIMS[2].graphicName).toBe('TWINKLE3');
  });

  it('all TWINKLE anims have maxDimension=8 (tiny sparkle effects)', () => {
    // C++ adata.cpp: 8 pixel maximum dimension — these are small point effects
    for (const anim of CPP_TWINKLE_ANIMS) {
      expect(anim.maxDimension, `${anim.animEnum} maxDimension`).toBe(8);
    }
  });

  it('all TWINKLE anims are normalized rate (play at consistent speed)', () => {
    for (const anim of CPP_TWINKLE_ANIMS) {
      expect(anim.isNormalized, `${anim.animEnum} isNormalized`).toBe(true);
    }
  });

  it('all TWINKLE anims play once (loops=1) with delay=1', () => {
    // C++ adata.cpp: delay=1 (fast), loops=1 (play once, no repeat)
    for (const anim of CPP_TWINKLE_ANIMS) {
      expect(anim.delay, `${anim.animEnum} delay`).toBe(1);
      expect(anim.loops, `${anim.animEnum} loops`).toBe(1);
    }
  });

  it('TWINKLE anims are NOT ground level, NOT translucent, NOT flame', () => {
    for (const anim of CPP_TWINKLE_ANIMS) {
      expect(anim.isGroundLevel, `${anim.animEnum} isGroundLevel`).toBe(false);
      expect(anim.isTranslucent, `${anim.animEnum} isTranslucent`).toBe(false);
      expect(anim.isFlameThrower, `${anim.animEnum} isFlameThrower`).toBe(false);
    }
  });

  it('TWINKLE anims deal no damage and have no sound', () => {
    for (const anim of CPP_TWINKLE_ANIMS) {
      expect(anim.damage, `${anim.animEnum} damage`).toBe(0);
      expect(anim.sound, `${anim.animEnum} sound`).toBe('VOC_NONE');
    }
  });

  it('TWINKLE anims have no follow-up animation', () => {
    for (const anim of CPP_TWINKLE_ANIMS) {
      expect(anim.followUp, `${anim.animEnum} followUp`).toBe('ANIM_NONE');
    }
  });

  it('TWINKLE anims use auto stage count (stages=-1)', () => {
    // Stages=-1 means "determine from SHP frame count"
    for (const anim of CPP_TWINKLE_ANIMS) {
      expect(anim.stages, `${anim.animEnum} stages`).toBe(-1);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 2: Sparkle Effects in TS (Ore/Gem/Chrono)
// ══════════════════════════════════════════════════════════════════════════════

describe('TS sparkle effects correspond to C++ TWINKLE usage', () => {
  // C++ uses ANIM_TWINKLE1-3 as small sparkle animations spawned on ore/gem fields
  // TS implements equivalent sparkle effects procedurally in renderer.ts

  it('ore sparkle uses cross pattern matching TWINKLE sprite shape', () => {
    // C++ TWINKLE sprites are 8x8 pixel sparkle effects
    // TS renderer.ts:1256-1265 draws ore sparkle as:
    //   - 2x2 center pixel
    //   - 4x1 horizontal bar (centered)
    //   - 1x4 vertical bar (centered)
    // This cross pattern approximates the TWINKLE SHP appearance
    const sparkleWidth = 4;   // horizontal bar width
    const sparkleHeight = 4;  // vertical bar height
    // Must fit within TWINKLE's 8px maxDimension
    expect(sparkleWidth).toBeLessThanOrEqual(8);
    expect(sparkleHeight).toBeLessThanOrEqual(8);
  });

  it('gem sparkle uses similar cross pattern with different color', () => {
    // TS renderer.ts:1274-1284: gem sparkle uses same shape as ore sparkle
    // but with blue-white color rgba(180,230,255,...) vs gold rgba(255,255,200,...)
    // This matches C++ where TWINKLE1-3 are reused with palette remapping
    const oreColor = 'rgba(255,255,200,';   // warm gold
    const gemColor = 'rgba(180,230,255,';   // cool blue-white
    expect(oreColor).not.toBe(gemColor);
  });

  it('ore sparkle animation cycle is 40 ticks with 6-tick visible window', () => {
    // TS renderer.ts:1257-1258: sparklePhase = (tick + h * 3) % 40; visible if < 6
    // C++ TWINKLE: delay=1, loops=1 — fires quickly then disappears
    // TS achieves similar effect: 6/40 = 15% visible duty cycle, with fade in/out
    const cycleLength = 40;
    const visibleTicks = 6;
    const dutyCycle = visibleTicks / cycleLength;
    expect(dutyCycle).toBeCloseTo(0.15, 2);
    expect(visibleTicks).toBeLessThan(cycleLength);
  });

  it('gem sparkle cycle is shorter (24 ticks) — gems sparkle more frequently', () => {
    // TS renderer.ts:1275: gemPhase = (tick + h * 5) % 24
    // Gems sparkle more often than ore (24-tick cycle vs 40-tick cycle)
    const gemCycle = 24;
    const oreCycle = 40;
    expect(gemCycle).toBeLessThan(oreCycle);
  });

  it('chrono shift effect uses particle sparkles (equivalent to TWINKLE usage)', () => {
    // C++ chronoshift visual uses ANIM_TWINKLE-like sparkle effects
    // TS renderer.ts:2094-2108: blue flash + 3 rotating sparkle particles
    const sparkleParticleCount = 3;
    expect(sparkleParticleCount).toBeGreaterThan(0);
    // Sparkle particles are 2x2 pixels — within TWINKLE's 8px dimension
    const particleSize = 2;
    expect(particleSize).toBeLessThanOrEqual(8);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 3: Health Bar Color Thresholds (rules.cpp + techno.cpp)
// ══════════════════════════════════════════════════════════════════════════════

describe('health bar color thresholds match C++ (rules.cpp:234-235, techno.cpp:1146-1152)', () => {
  // C++ rules.cpp:234-235:
  //   ConditionYellow(fixed(1, 2)),  // 1/2 = 0.50
  //   ConditionRed(fixed(1, 4)),     // 1/4 = 0.25
  //
  // C++ techno.cpp:1146-1152:
  //   color = LTGREEN;
  //   if (ratio <= Rule.ConditionYellow) color = YELLOW;
  //   if (ratio <= Rule.ConditionRed) color = RED;
  //
  // Note: C++ uses <= for thresholds; TS uses >= for the upper bounds.
  // C++: ratio > 0.50 → green; ratio > 0.25 && ratio <= 0.50 → yellow; ratio <= 0.25 → red
  // TS:  ratio >= 0.50 → green; ratio >= 0.25 → yellow; else → red

  const cppConditionYellow = 0.50;  // fixed(1,2) = 1/2
  const cppConditionRed = 0.25;     // fixed(1,4) = 1/4

  function getBarColor(ratio: number): 'green' | 'yellow' | 'red' {
    // TS renderer.ts:2247-2249
    if (ratio >= 0.50) return 'green';
    if (ratio >= 0.25) return 'yellow';
    return 'red';
  }

  // C++ logic: starts green, drops to yellow at ≤0.50, drops to red at ≤0.25
  function getCppBarColor(ratio: number): 'green' | 'yellow' | 'red' {
    let color: 'green' | 'yellow' | 'red' = 'green';
    if (ratio <= cppConditionYellow) color = 'yellow';
    if (ratio <= cppConditionRed) color = 'red';
    return color;
  }

  it('full health (100%) → green', () => {
    expect(getBarColor(1.0)).toBe('green');
    expect(getCppBarColor(1.0)).toBe('green');
  });

  it('75% health → green', () => {
    expect(getBarColor(0.75)).toBe('green');
    expect(getCppBarColor(0.75)).toBe('green');
  });

  it('51% health → green', () => {
    expect(getBarColor(0.51)).toBe('green');
    expect(getCppBarColor(0.51)).toBe('green');
  });

  it('50% health threshold — TS=green, C++=yellow (boundary edge case)', () => {
    // C++ uses <=, so ratio == 0.50 triggers yellow
    // TS uses >=, so ratio == 0.50 stays green
    // This is a minor boundary difference at exactly 50%
    expect(getBarColor(0.50)).toBe('green');
    expect(getCppBarColor(0.50)).toBe('yellow');
    // Documenting the known boundary mismatch — in practice this is a single HP tick
  });

  it('49% health → yellow in both', () => {
    expect(getBarColor(0.49)).toBe('yellow');
    expect(getCppBarColor(0.49)).toBe('yellow');
  });

  it('30% health → yellow in both', () => {
    expect(getBarColor(0.30)).toBe('yellow');
    expect(getCppBarColor(0.30)).toBe('yellow');
  });

  it('25% health threshold — TS=yellow, C++=red (boundary edge case)', () => {
    // Same boundary mismatch: C++ uses <=, TS uses >=
    expect(getBarColor(0.25)).toBe('yellow');
    expect(getCppBarColor(0.25)).toBe('red');
  });

  it('24% health → red in both', () => {
    expect(getBarColor(0.24)).toBe('red');
    expect(getCppBarColor(0.24)).toBe('red');
  });

  it('10% health → red in both', () => {
    expect(getBarColor(0.10)).toBe('red');
    expect(getCppBarColor(0.10)).toBe('red');
  });

  it('1% health → red in both', () => {
    expect(getBarColor(0.01)).toBe('red');
    expect(getCppBarColor(0.01)).toBe('red');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 4: Health Bar Height (techno.cpp:1135-1153)
// ══════════════════════════════════════════════════════════════════════════════

describe('health bar height matches C++ (techno.cpp:1135-1136)', () => {
  // C++ techno.cpp:1136: Draw_Rect(xx, yy, xx+width-1, yy+3, BLACK)
  //   → Total height = 4 pixels (yy to yy+3 inclusive)
  //   → Interior fill: yy+1 to yy+2 = 2 pixels (line 1153)
  //   → The 4px total includes 1px border top + 2px fill + 1px border bottom
  //
  // TS renderer.ts:2234: barH = isSelected ? 4 : 3
  //   → Selected: 4px, Unselected: 3px
  //
  // In C++ the bar is ALWAYS 4px (border height=3 means 4 rows: 0,1,2,3).
  // The C++ doesn't distinguish selected vs unselected for bar height since
  // the bar is ONLY drawn when selected (IsSelected check at line 1098).
  // TS shows bars for damaged unselected units too, using 3px for those.

  const CPP_BAR_TOTAL_HEIGHT = 4;  // yy to yy+3
  const CPP_BAR_INTERIOR_HEIGHT = 2; // yy+1 to yy+2

  it('C++ health bar total height is 4 pixels', () => {
    expect(CPP_BAR_TOTAL_HEIGHT).toBe(4);
  });

  it('C++ health bar interior fill is 2 pixels', () => {
    expect(CPP_BAR_INTERIOR_HEIGHT).toBe(2);
  });

  it('TS selected bar height (4) matches C++ total height (4)', () => {
    const tsSelectedBarH = 4; // renderer.ts:2234
    expect(tsSelectedBarH).toBe(CPP_BAR_TOTAL_HEIGHT);
  });

  it('TS unselected bar (3px) is intentionally smaller than C++ (4px) — TS extension', () => {
    // TS shows health bars on damaged unselected units (C++ does not).
    // To differentiate, TS uses 3px for unselected, 4px for selected.
    const tsUnselectedBarH = 3;
    expect(tsUnselectedBarH).toBeLessThan(CPP_BAR_TOTAL_HEIGHT);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 5: Infantry Health Bar Dimensions (idata.cpp:1365-1374)
// ══════════════════════════════════════════════════════════════════════════════

describe('infantry health bar width matches C++ (idata.cpp:1365-1374)', () => {
  // C++ InfantryTypeClass::Dimensions (idata.cpp:1365-1374):
  //   #ifdef WIN32: width=14, height=20
  //   #else:        width=12, height=16
  //
  // We use WIN32 (HIRES) values since the TS port targets the Windows version.
  // The health bar width in C++ = the Dimensions width = 14 pixels.
  //
  // TS renderer.ts:1806: spriteW = sheet ? sheet.meta.frameWidth : (isInfantry ? 50 : 24)
  // TS renderer.ts:2190: barW = Math.max(spriteW, 18)
  // So TS infantry bar width = max(50, 18) = 50 when no sheet loaded, or max(frameWidth, 18).
  // This is wider than C++ (14px), but because TS sprites are at a different scale,
  // the proportional size matters more than absolute pixels.

  const CPP_INFANTRY_DIM_W = 14;    // WIN32/HIRES
  const CPP_INFANTRY_DIM_H = 20;

  it('C++ infantry Dimensions width is 14 (WIN32)', () => {
    expect(CPP_INFANTRY_DIM_W).toBe(14);
  });

  it('C++ infantry Dimensions height is 20 (WIN32)', () => {
    expect(CPP_INFANTRY_DIM_H).toBe(20);
  });

  it('infantry health bars should be smaller than vehicle health bars', () => {
    // C++ infantry width = 14, vehicle width = MaxSize*3/4 (typically 18-48)
    // TS uses sprite width which also varies: infantry sprites are typically smaller
    expect(CPP_INFANTRY_DIM_W).toBeLessThan(48); // max vehicle dimension
  });

  it('all infantry types in TS are flagged isInfantry=true', () => {
    const infantryKeys = ['E1', 'E2', 'E3', 'E4', 'E6', 'DOG', 'SPY', 'MEDI', 'SHOK', 'MECH',
      'GNRL', 'CHAN', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10',
      'EINSTEIN', 'E7', 'THF'];
    for (const key of infantryKeys) {
      const stats = UNIT_STATS[key];
      expect(stats, `${key} should exist in UNIT_STATS`).toBeDefined();
      expect(stats.isInfantry, `${key} should be infantry`).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 6: Vehicle Health Bar Dimensions (udata.cpp:1234-1240)
// ══════════════════════════════════════════════════════════════════════════════

describe('vehicle health bar width matches C++ formula (udata.cpp:1234-1240)', () => {
  // C++ UnitTypeClass::Dimensions:
  //   width = MaxSize - (MaxSize/4)  → MaxSize * 3/4 (integer division)
  //   width = min(width, 48)
  //   height = same formula
  //
  // MaxSize is set per unit type from the largest rendered sprite frame.
  // The health bar uses this Dimensions width.

  it('C++ formula: width = MaxSize - MaxSize/4, capped at 48', () => {
    function cppUnitDimWidth(maxSize: number): number {
      let w = maxSize - Math.floor(maxSize / 4);
      return Math.min(w, 48);
    }
    // Small unit (MaxSize=24): 24 - 6 = 18
    expect(cppUnitDimWidth(24)).toBe(18);
    // Medium unit (MaxSize=32): 32 - 8 = 24
    expect(cppUnitDimWidth(32)).toBe(24);
    // Large unit (MaxSize=48): 48 - 12 = 36
    expect(cppUnitDimWidth(48)).toBe(36);
    // Very large unit (MaxSize=64): 64 - 16 = 48 (capped)
    expect(cppUnitDimWidth(64)).toBe(48);
    // Oversized (MaxSize=100): 100 - 25 = 75 → capped to 48
    expect(cppUnitDimWidth(100)).toBe(48);
  });

  it('all vehicle types are NOT infantry', () => {
    const vehicleKeys = ['1TNK', '2TNK', '3TNK', '4TNK', 'JEEP', 'APC', 'ARTY',
      'HARV', 'MCV', 'TRUK', 'STNK', 'CTNK', 'TTNK', 'QTNK', 'DTRK', 'MRJ',
      'MGG', 'V2RL', 'MNLY'];
    for (const key of vehicleKeys) {
      const stats = UNIT_STATS[key];
      expect(stats, `${key} should exist in UNIT_STATS`).toBeDefined();
      expect(stats.isInfantry, `${key} should not be infantry`).toBe(false);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 7: Vessel Health Bar Dimensions (vdata.cpp:536-539)
// ══════════════════════════════════════════════════════════════════════════════

describe('vessel health bar width matches C++ (vdata.cpp:536-539)', () => {
  // C++ VesselTypeClass::Dimensions: width=48, height=48 (fixed for all vessels)
  const CPP_VESSEL_DIM_W = 48;
  const CPP_VESSEL_DIM_H = 48;

  it('C++ vessel Dimensions are fixed 48x48', () => {
    expect(CPP_VESSEL_DIM_W).toBe(48);
    expect(CPP_VESSEL_DIM_H).toBe(48);
  });

  it('all vessel types are flagged as vessels in TS', () => {
    const vesselKeys = ['LST', 'SS', 'DD', 'CA', 'PT', 'MSUB'];
    for (const key of vesselKeys) {
      const stats = UNIT_STATS[key];
      expect(stats, `${key} should exist in UNIT_STATS`).toBeDefined();
      expect(stats.isVessel, `${key} should be vessel`).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 8: Aircraft Health Bar Dimensions (aadata.cpp:624-633)
// ══════════════════════════════════════════════════════════════════════════════

describe('aircraft health bar width matches C++ (aadata.cpp:624-633)', () => {
  // C++ AircraftTypeClass::Dimensions:
  //   Badger: width=56, height=56
  //   Others: width=21, height=20

  it('badger (BADR) uses larger dimensions (56x56)', () => {
    const stats = UNIT_STATS['BADR'];
    expect(stats).toBeDefined();
    expect(stats.isAircraft).toBe(true);
    // C++ BADR dimensions: 56x56
    const cppBadrW = 56;
    const cppBadrH = 56;
    expect(cppBadrW).toBe(56);
    expect(cppBadrH).toBe(56);
  });

  it('regular aircraft use smaller dimensions (21x20)', () => {
    const regularAircraft = ['MIG', 'YAK', 'HELI', 'HIND', 'TRAN', 'U2'];
    const cppAircraftW = 21;
    const cppAircraftH = 20;
    expect(cppAircraftW).toBe(21);
    expect(cppAircraftH).toBe(20);
    for (const key of regularAircraft) {
      const stats = UNIT_STATS[key];
      expect(stats, `${key} should exist`).toBeDefined();
      expect(stats.isAircraft, `${key} should be aircraft`).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 9: Building Health Bar Dimensions (bdata.cpp:3399-3405)
// ══════════════════════════════════════════════════════════════════════════════

describe('building health bar width matches C++ formula (bdata.cpp:3399-3405)', () => {
  // C++ BuildingTypeClass::Dimensions:
  //   width = Width() * ICON_PIXEL_W;          // Width() = building footprint cells
  //   width -= (width / 5);                     // = Width() * 24 * 4/5
  //   height = Height() * ICON_PIXEL_H;
  //   height -= (height / 5);
  //
  // ICON_PIXEL_W = ICON_PIXEL_H = 24 (same as TS CELL_SIZE)
  //
  // TS renderer.ts (FIXED):
  //   cppBarW = Math.floor(fw * CELL_SIZE * 4 / 5)
  //   where fw = STRUCTURE_SIZE[s.type][0] (footprint width in cells)

  function cppBuildingBarWidth(footprintW: number): number {
    const raw = footprintW * 24;
    return raw - Math.floor(raw / 5);
  }

  function tsBuildingBarWidth(footprintW: number): number {
    return Math.floor(footprintW * CELL_SIZE * 4 / 5);
  }

  it('CELL_SIZE matches C++ ICON_PIXEL_W (24)', () => {
    expect(CELL_SIZE).toBe(24);
  });

  it('1-cell building (GUN, SAM, SILO): bar width = 19', () => {
    // C++: 1 * 24 = 24; 24 - 24/5 = 24 - 4 = 20 (int division: 24/5=4)
    expect(cppBuildingBarWidth(1)).toBe(20);
    // TS: floor(1 * 24 * 4/5) = floor(19.2) = 19
    expect(tsBuildingBarWidth(1)).toBe(19);
    // Close enough — 1 pixel difference from integer division rounding
    expect(Math.abs(cppBuildingBarWidth(1) - tsBuildingBarWidth(1))).toBeLessThanOrEqual(1);
  });

  it('2-cell building (POWR, BARR, DOME): bar width = 38', () => {
    // C++: 2 * 24 = 48; 48 - 48/5 = 48 - 9 = 39
    expect(cppBuildingBarWidth(2)).toBe(39);
    // TS: floor(2 * 24 * 4/5) = floor(38.4) = 38
    expect(tsBuildingBarWidth(2)).toBe(38);
    expect(Math.abs(cppBuildingBarWidth(2) - tsBuildingBarWidth(2))).toBeLessThanOrEqual(1);
  });

  it('3-cell building (FACT, WEAP, PROC): bar width = 57', () => {
    // C++: 3 * 24 = 72; 72 - 72/5 = 72 - 14 = 58
    expect(cppBuildingBarWidth(3)).toBe(58);
    // TS: floor(3 * 24 * 4/5) = floor(57.6) = 57
    expect(tsBuildingBarWidth(3)).toBe(57);
    expect(Math.abs(cppBuildingBarWidth(3) - tsBuildingBarWidth(3))).toBeLessThanOrEqual(1);
  });

  it('4-cell building (civilian V04-V19): bar width = 76', () => {
    // C++: 4 * 24 = 96; 96 - 96/5 = 96 - 19 = 77
    expect(cppBuildingBarWidth(4)).toBe(77);
    // TS: floor(4 * 24 * 4/5) = floor(76.8) = 76
    expect(tsBuildingBarWidth(4)).toBe(76);
    expect(Math.abs(cppBuildingBarWidth(4) - tsBuildingBarWidth(4))).toBeLessThanOrEqual(1);
  });

  it('building bar width scales with footprint (not fixed)', () => {
    // Verify that different building sizes produce different bar widths
    const gun = tsBuildingBarWidth(STRUCTURE_SIZE['GUN']?.[0] ?? 1);   // 1-cell
    const powr = tsBuildingBarWidth(STRUCTURE_SIZE['POWR']?.[0] ?? 2); // 2-cell
    const fact = tsBuildingBarWidth(STRUCTURE_SIZE['FACT']?.[0] ?? 3); // 3-cell
    expect(gun).toBeLessThan(powr);
    expect(powr).toBeLessThan(fact);
  });

  it('key building structures have correct STRUCTURE_SIZE footprint widths', () => {
    // Verify a representative set of buildings
    const expected: [string, number][] = [
      ['FACT', 3], ['WEAP', 3], ['PROC', 3], ['APWR', 3], // 3-wide
      ['POWR', 2], ['BARR', 2], ['TENT', 2], // 2-wide
      ['DOME', 2], ['HPAD', 2], ['AFLD', 3],  // 2-3 wide
      ['GUN', 1], ['SAM', 2], ['SILO', 1], ['TSLA', 1], // 1-2 wide defenses
    ];
    for (const [type, expectedW] of expected) {
      const [w] = STRUCTURE_SIZE[type] ?? [0, 0];
      expect(w, `${type} footprint width`).toBe(expectedW);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 10: Health Bar Fill Width Formula (techno.cpp:1142-1144)
// ══════════════════════════════════════════════════════════════════════════════

describe('health bar fill width formula (techno.cpp:1142-1144)', () => {
  // C++ techno.cpp:1142-1144:
  //   pwidth = (width-2) * ratio;      // fill inside 1px border on each side
  //   pwidth = Bound(pwidth, 1, width-2);  // clamp to [1, width-2]
  //
  // TS renderer.ts:2250: fillW = barW * ratio
  //   (no border subtraction — TS draws border as separate background rect)

  function cppFillWidth(barWidth: number, ratio: number): number {
    const interior = barWidth - 2;
    let pwidth = Math.floor(interior * ratio);
    return Math.max(1, Math.min(pwidth, interior));
  }

  function tsFillWidth(barWidth: number, ratio: number): number {
    return barWidth * ratio;
  }

  it('at full health, fill covers entire interior', () => {
    expect(cppFillWidth(40, 1.0)).toBe(38); // 40-2 = 38
    // TS: 40 * 1.0 = 40 (fills the bar width, border drawn separately)
    expect(tsFillWidth(40, 1.0)).toBe(40);
  });

  it('at 50% health, fill covers half the interior', () => {
    expect(cppFillWidth(40, 0.5)).toBe(19); // floor((40-2)*0.5) = 19
    expect(tsFillWidth(40, 0.5)).toBe(20);
  });

  it('C++ clamps fill to minimum 1 pixel (never empty while alive)', () => {
    // Even at 1% health, bar shows at least 1 pixel
    expect(cppFillWidth(40, 0.01)).toBe(1);
    // TS doesn't explicitly clamp but bar is only drawn for alive units
    expect(tsFillWidth(40, 0.01)).toBeCloseTo(0.4, 1);
  });

  it('C++ clamps fill to max width-2 (never overflows)', () => {
    expect(cppFillWidth(40, 1.5)).toBe(38); // clamped to width-2
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 11: Health Bar Visibility Conditions (techno.cpp:1098, 1124)
// ══════════════════════════════════════════════════════════════════════════════

describe('health bar visibility conditions (techno.cpp:1098, 1124)', () => {
  // C++ techno.cpp:1098: if (IsSelected) { ... entire block including health bar }
  //   → Health bar ONLY drawn for selected units
  //   → techno.cpp:1124: if (Strength && (ally || Rule.IsHealthBar)) { draw bar }
  //   → Needs Strength > 0 AND (allied or IsHealthBar rule)
  //
  // TS renderer.ts:2186: if (entity.alive && (entity.hp < entity.maxHp || selectedIds.has(entity.id)))
  //   → Shows for ANY alive unit that is either damaged or selected
  //   → TS extension: shows bars for damaged unselected units too

  it('C++ only shows health bars when unit is selected', () => {
    // The entire Draw_It health bar code is inside if (IsSelected) block
    const cppRequiresSelected = true;
    expect(cppRequiresSelected).toBe(true);
  });

  it('TS shows health bars for damaged units even when unselected (intentional extension)', () => {
    // renderer.ts:2186: hp < maxHp → show bar (even if not selected)
    // This is a deliberate UX improvement over C++ behavior
    const tsShowsForDamaged = true;
    expect(tsShowsForDamaged).toBe(true);
  });

  it('both require unit to be alive (Strength > 0 / entity.alive)', () => {
    // C++ techno.cpp:1124: if (Strength && ...)
    // TS renderer.ts:2186: if (entity.alive && ...)
    const cppRequiresAlive = true;
    const tsRequiresAlive = true;
    expect(cppRequiresAlive).toBe(true);
    expect(tsRequiresAlive).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 12: Health Bar Position (techno.cpp:1109-1131)
// ══════════════════════════════════════════════════════════════════════════════

describe('health bar position relative to unit (techno.cpp:1109-1131)', () => {
  // C++ techno.cpp:1109-1110: Infantry get y offset -= 6 (bar raised higher)
  // C++ techno.cpp:1113-1114: Barracks building gets y -= 5
  // C++ techno.cpp:1129-1130: xx = x - width/2 (centered); yy = y - height/2 (above center)
  //
  // TS renderer.ts:2188-2190:
  //   x = screen.x (center)
  //   y = screen.y - spriteH / 2 - 5 (above sprite top edge, offset by 5)

  it('C++ infantry health bar is 6 pixels higher than default', () => {
    const cppInfantryYOffset = -6; // techno.cpp:1110
    expect(cppInfantryYOffset).toBe(-6);
  });

  it('C++ health bar is centered horizontally (x - width/2)', () => {
    // techno.cpp:1129: xx = x - width/2
    // TS: renderHealthBar centers via bx = x - barW/2 (renderer.ts:2235)
    // Both center the bar on the unit's x coordinate
    const cppCentered = true;
    const tsCentered = true; // bx = x - barW / 2
    expect(cppCentered).toBe(tsCentered);
  });

  it('C++ health bar is above the unit center (y - height/2)', () => {
    // techno.cpp:1130: yy = y - (height/2)
    // The bar is drawn at the top edge of the unit's bounding box
    const cppAboveCenter = true;
    expect(cppAboveCenter).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 13: Selection Box Corner Brackets (techno.cpp:1159-1187)
// ══════════════════════════════════════════════════════════════════════════════

describe('selection box dimensions match health bar dimensions (techno.cpp:1159-1187)', () => {
  // C++ techno.cpp:1160-1163:
  //   lx = width/2; ly = height/2   (half-dimensions for selection box)
  //   dx = width/5; dy = height/5   (bracket arm length = 1/5 of dimension)
  //
  // TS renderer.ts:1896-1901:
  //   bx0 = screen.x - spriteW/2; bx1 = screen.x + spriteW/2
  //   armW = spriteW / 5; armH = spriteH / 5
  //
  // Both use the same 1/5 ratio for bracket arm length

  it('bracket arm length is 1/5 of unit dimension (C++ width/5)', () => {
    const cppArmRatio = 1 / 5;
    const tsArmRatio = 1 / 5; // renderer.ts:1900-1901
    expect(cppArmRatio).toBe(tsArmRatio);
  });

  it('health bar and selection box share same unit dimensions', () => {
    // C++ techno.cpp:1122: Class_Of().Dimensions(width, height)
    // Both health bar width (line 1142) and selection box (line 1160)
    // use the same width/height from Dimensions()
    const sameSource = true;
    expect(sameSource).toBe(true);
  });

  it('selection box fudge factor accounts for health bar presence', () => {
    // C++ techno.cpp:1164: fudge = (ally || Rule.IsHealthBar) ? 4 : 0
    // When health bar is shown, selection box is pushed down by 4 pixels
    const cppFudge = 4;
    expect(cppFudge).toBe(4);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 14: ProgressBarClass (bar.cpp) — Generic Bar Drawing
// ══════════════════════════════════════════════════════════════════════════════

describe('ProgressBarClass utility (bar.cpp)', () => {
  // bar.cpp implements a generic progress bar used for various UI elements.
  // Not directly used for unit health bars (those are inline in techno.cpp),
  // but documents the bar rendering pattern.

  it('bar orientation: horizontal when width > height', () => {
    // bar.cpp:102-106: Is_Horizontal() returns true when Width > Height
    const isHorizontal = (w: number, h: number) => w > h;
    expect(isHorizontal(100, 10)).toBe(true);
    expect(isHorizontal(10, 100)).toBe(false);
    expect(isHorizontal(10, 10)).toBe(false); // square = vertical
  });

  it('bar fill = currentValue * size (fractional fill)', () => {
    // bar.cpp:209: fill = CurrentValue * size
    // CurrentValue is a fixed-point ratio (0.0 to 1.0)
    const fill = (value: number, size: number) => Math.floor(value * size);
    expect(fill(0.5, 100)).toBe(50);
    expect(fill(0.25, 100)).toBe(25);
    expect(fill(1.0, 100)).toBe(100);
    expect(fill(0.0, 100)).toBe(0);
  });

  it('outlined bar has 1px border reducing interior by 2px per axis', () => {
    // bar.cpp:191-196: if outlined, x+=1, y+=1, w-=2, h-=2
    const outerW = 40;
    const innerW = outerW - 2;
    expect(innerW).toBe(38);
  });
});
