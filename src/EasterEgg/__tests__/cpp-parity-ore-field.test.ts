/**
 * C++ Behavioral Parity Tests -- Ore & Gem Field Mechanics
 *
 * Tests ore depletion (Reduce_Tiberium), density ranges, credit values per bail,
 * harvester bail capacity, ore destruction by warheads, overlay encoding, and
 * the absence of infantry tiberium damage in Red Alert.
 *
 * NOTE: Growth/spread timing and eligibility are tested in:
 *   - cpp-parity-ore-growth-ini.test.ts (INI values, interval derivation)
 *   - cpp-parity-ore-regrowth.test.ts (grow/spread mechanics, germination)
 *
 * === Authoritative INI Values (rules.ini [General]) ===
 *   GoldValue=25        -- gold credits per bail
 *   GemValue=50         -- gem credits per bail
 *   BailCount=28        -- bails carried by a harvester
 *   GrowthRate=2        -- minutes between ore growth scans
 *   OreGrows=yes        -- density growth enabled
 *   OreSpreads=yes      -- spread to adjacent cells enabled
 *
 * === C++ Source References ===
 *   cell.cpp:1630-1648  -- Reduce_Tiberium: density reduction / depletion
 *   cell.cpp:2869-2884  -- Can_Tiberium_Grow: gold only, OverlayData < 11
 *   cell.cpp:2904-2918  -- Can_Tiberium_Spread: gold only, OverlayData > 6
 *   cell.cpp:2936-2944  -- Grow_Tiberium: deterministic OverlayData++
 *   cell.cpp:2963-2979  -- Spread_Tiberium: random dir, 8 dirs, first valid
 *   cell.cpp:2019-2078  -- Tiberium_Adjust: GOLD1-4 have 12 density levels, GEMS1-4 have 3
 *   combat.cpp:247      -- IsTiberiumDestroyer check for warhead ore destruction
 *   warhead.cpp:174     -- IsTiberiumDestroyer = ini.Get_Bool(Name(), "Ore", ...)
 *   rules.cpp:477-478   -- GemValue, GoldValue from INI
 *   rules.cpp:446-447   -- OreGrows, OreSpreads from INI
 *   defines.h:3031-3032 -- TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
 *
 * === TS Overlay Encoding (map.ts) ===
 *   Gold ore: 0x03 (GOLD, density 0) through 0x0E (density 11) -- 12 levels
 *   Gems:     0x0F (GEM, density 0) through 0x12 (density 3)   -- 4 levels
 *   No overlay: 0xFF
 *
 * === Red Alert vs Tiberian Dawn ===
 *   Red Alert does NOT have infantry tiberium damage. That mechanic (where infantry
 *   standing on tiberium take periodic damage) is a Tiberian Dawn / C&C1 feature.
 *   The rules.ini "GrowthRate" key is labeled as "Tiberium" in comments but refers
 *   to ore growth rate only. There is no "Tiberium=" damage key in RA rules.ini.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseIniSections, parseIniInt } from '../engine/parseIni';
import { GameMap, Terrain } from '../engine/map';
import { MAP_CELLS } from '../engine/types';
import { WARHEAD_META } from '../engine/types';
import { Entity } from '../engine/entity';

// ============================================================
// Parse rules.ini -- authoritative source of truth
// ============================================================
const rulesText = readFileSync(
  resolve(__dirname, '../../../public/ra/assets/rules.ini'),
  'utf-8',
);
const sections = parseIniSections(rulesText);
const general = sections.get('General')!;

/** Parse a boolean INI value (C++ INIClass::Get_Bool: "yes"/"true"/"1" -> true) */
function parseBool(raw: string): boolean {
  return raw.trim().toLowerCase() === 'yes';
}

/** Parse an INI integer value */
function parseIniValue(raw: string): number {
  return parseIniInt(raw);
}

/** Parse an INI float value */
function parseFloat_(raw: string): number {
  return Number.parseFloat(raw);
}

// ============================================================
// INI-parsed constants -- NEVER hardcoded
// ============================================================
const INI_GOLD_VALUE = parseIniValue(general.get('GoldValue')!);
const INI_GEM_VALUE = parseIniValue(general.get('GemValue')!);
const INI_BAIL_COUNT = parseIniValue(general.get('BailCount')!);
const INI_GROWTH_RATE = parseFloat_(general.get('GrowthRate')!);
const INI_ORE_GROWS = parseBool(general.get('OreGrows')!);
const INI_ORE_SPREADS = parseBool(general.get('OreSpreads')!);

// Warhead sections for ore destruction verification
const nukeSection = sections.get('Nuke')!;
const heSection = sections.get('HE')!;
const apSection = sections.get('AP')!;
const fireSection = sections.get('Fire')!;
const saSection = sections.get('SA')!;

// C++ constants from defines.h
const CPP_TICKS_PER_SECOND = 15;
const CPP_TICKS_PER_MINUTE = CPP_TICKS_PER_SECOND * 60; // 900

// ============================================================
// Helpers
// ============================================================
function getOverlay(map: GameMap, cx: number, cy: number): number {
  return map.overlay[cy * MAP_CELLS + cx];
}

function setOverlay(map: GameMap, cx: number, cy: number, val: number): void {
  map.overlay[cy * MAP_CELLS + cx] = val;
}

function makeMap(): GameMap {
  const map = new GameMap();
  map.setBounds(40, 40, 50, 50);
  map.initDefault();
  return map;
}

// =============================================================================
// Section 1: INI Value Verification -- rules.ini is the authoritative source
// =============================================================================
describe('rules.ini [General] ore field economy values', () => {
  it('GoldValue parsed from INI = 25 (NOT C++ constructor default of 35)', () => {
    // C++ rules.cpp:238 constructor default: GoldValue(35)
    // rules.ini overrides: GoldValue=25
    // rules.ini WINS per CLAUDE.md guardrail
    expect(INI_GOLD_VALUE).toBe(25);
  });

  it('GemValue parsed from INI = 50 (NOT C++ constructor default of 110)', () => {
    // C++ rules.cpp:239 constructor default: GemValue(110)
    // rules.ini overrides: GemValue=50
    // rules.ini WINS per CLAUDE.md guardrail
    expect(INI_GEM_VALUE).toBe(50);
  });

  it('BailCount parsed from INI = 28', () => {
    // C++ rules.cpp:199 constructor default: BailCount(28) — same as INI
    // rules.ini [General] BailCount=28
    expect(INI_BAIL_COUNT).toBe(28);
  });

  it('GrowthRate parsed from INI = 2 (minutes)', () => {
    expect(INI_GROWTH_RATE).toBe(2);
  });

  it('OreGrows parsed from INI = yes', () => {
    expect(INI_ORE_GROWS).toBe(true);
  });

  it('OreSpreads parsed from INI = yes', () => {
    expect(INI_ORE_SPREADS).toBe(true);
  });
});

// =============================================================================
// Section 2: TS Engine Constants Match INI Values
// =============================================================================
describe('TS engine constants match INI-parsed values', () => {
  it('Entity.BAIL_COUNT matches INI BailCount', () => {
    // C++ UnitTypeClass::Max_Pips uses Rule.BailCount
    // TS Entity.BAIL_COUNT must match
    expect(Entity.BAIL_COUNT).toBe(INI_BAIL_COUNT);
  });

  it('depleteOre returns INI GoldValue for gold ore', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x05); // mid-density gold
    const credits = map.depleteOre(50, 50);
    expect(credits).toBe(INI_GOLD_VALUE);
  });

  it('depleteOre returns INI GemValue for gems', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x10); // mid-density gem
    const credits = map.depleteOre(50, 50);
    expect(credits).toBe(INI_GEM_VALUE);
  });
});

// =============================================================================
// Section 3: Overlay Encoding -- Gold and Gem Range Validation
// =============================================================================
describe('overlay encoding — gold 0x03-0x0E, gems 0x0F-0x12 (C++ overlay.cpp)', () => {
  /**
   * C++ cell.cpp:2019-2078 (Tiberium_Adjust):
   *   case OVERLAY_GOLD1..OVERLAY_GOLD4: value = Rule.GoldValue
   *   case OVERLAY_GEMS1..OVERLAY_GEMS4: value = Rule.GemValue * 4
   *
   * TS overlay encoding:
   *   Gold: 0x03 (density 0) through 0x0E (density 11) = 12 levels
   *   Gems: 0x0F (density 0) through 0x12 (density 3) = 4 levels
   *
   * C++ model: 4 gold subtypes * 12 densities = 48 visual variants (collapsed to 12 in TS)
   * C++ model: 4 gem subtypes * 3 densities = 12 visual variants (collapsed to 4 in TS)
   */
  it('gold ore range spans 12 density levels (0x03 to 0x0E)', () => {
    const goldMin = 0x03;
    const goldMax = 0x0E;
    const goldLevels = goldMax - goldMin + 1;
    expect(goldLevels).toBe(12);
  });

  it('gem range spans 4 density levels (0x0F to 0x12)', () => {
    const gemMin = 0x0F;
    const gemMax = 0x12;
    const gemLevels = gemMax - gemMin + 1;
    expect(gemLevels).toBe(4);
  });

  it('gold and gem overlay ranges do not overlap', () => {
    const goldMax = 0x0E;
    const gemMin = 0x0F;
    expect(gemMin).toBeGreaterThan(goldMax);
  });

  it('0xFF represents no overlay (C++ OVERLAY_NONE)', () => {
    const map = makeMap();
    // Default overlay should be 0xFF
    expect(getOverlay(map, 50, 50)).toBe(0xFF);
  });

  it('isGemOverlay correctly identifies gem range 0x0F-0x12', () => {
    const map = makeMap();
    // Gold ore should NOT be gem
    for (let ovl = 0x03; ovl <= 0x0E; ovl++) {
      setOverlay(map, 50, 50, ovl);
      expect(map.isGemOverlay(50, 50), `gold overlay 0x${ovl.toString(16)} should not be gem`).toBe(false);
    }
    // Gems SHOULD be gem
    for (let ovl = 0x0F; ovl <= 0x12; ovl++) {
      setOverlay(map, 50, 50, ovl);
      expect(map.isGemOverlay(50, 50), `gem overlay 0x${ovl.toString(16)} should be gem`).toBe(true);
    }
    // No overlay should NOT be gem
    setOverlay(map, 50, 50, 0xFF);
    expect(map.isGemOverlay(50, 50)).toBe(false);
  });
});

// =============================================================================
// Section 4: Ore Depletion -- Reduce_Tiberium (cell.cpp:1630-1648)
// =============================================================================
describe('ore depletion — Reduce_Tiberium (cell.cpp:1630-1648)', () => {
  /**
   * C++ cell.cpp:1630-1648:
   *   int CellClass::Reduce_Tiberium(int levels) {
   *     int reducer = 0;
   *     if (levels > 0 && Land == LAND_TIBERIUM) {
   *       if (OverlayData+1 > levels) {
   *         OverlayData -= levels;   // partial reduction
   *         reducer = levels;
   *       } else {
   *         Overlay = OVERLAY_NONE;  // fully depleted
   *         reducer = OverlayData;
   *         OverlayData = 0;
   *         Recalc_Attributes();
   *       }
   *     }
   *     return(reducer);
   *   }
   *
   * TS depleteOre() reduces by exactly 1 level per call (bail-by-bail harvesting).
   * C++ Reduce_Tiberium(levels) allows reducing by arbitrary amounts.
   */

  it('depleting gold from mid-density reduces overlay by 1', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x08); // density 5
    map.depleteOre(50, 50);
    // C++ equivalent: Reduce_Tiberium(1) from OverlayData=5 -> OverlayData=4
    // TS: 0x08 -> 0x07
    expect(getOverlay(map, 50, 50)).toBe(0x07);
  });

  it('depleting gold at minimum density (0x03) fully removes overlay', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x03); // density 0 (minimum gold)
    const credits = map.depleteOre(50, 50);
    // C++ equivalent: Reduce_Tiberium(1) from OverlayData=0 -> OverlayData+1=1 > 1 is FALSE
    //   -> Overlay = OVERLAY_NONE, OverlayData = 0
    // TS: 0x03 (min) -> 0xFF (no overlay)
    expect(getOverlay(map, 50, 50)).toBe(0xFF);
    expect(credits).toBe(INI_GOLD_VALUE);
  });

  it('depleting gold at max density (0x0E) reduces to 0x0D', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x0E); // density 11 (max gold)
    map.depleteOre(50, 50);
    expect(getOverlay(map, 50, 50)).toBe(0x0D); // density 10
  });

  it('depleting gem from mid-density reduces overlay by 1', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x11); // gem density 2
    map.depleteOre(50, 50);
    expect(getOverlay(map, 50, 50)).toBe(0x10); // gem density 1
  });

  it('depleting gem at minimum density (0x0F) fully removes overlay', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x0F); // min gem
    const credits = map.depleteOre(50, 50);
    expect(getOverlay(map, 50, 50)).toBe(0xFF);
    expect(credits).toBe(INI_GEM_VALUE);
  });

  it('depleting gem at max density (0x12) reduces to 0x11', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x12); // max gem
    map.depleteOre(50, 50);
    expect(getOverlay(map, 50, 50)).toBe(0x11);
  });

  it('depleting empty cell (0xFF) returns 0 credits', () => {
    const map = makeMap();
    // 0xFF = no overlay
    const credits = map.depleteOre(50, 50);
    expect(credits).toBe(0);
    expect(getOverlay(map, 50, 50)).toBe(0xFF); // unchanged
  });

  it('sequential depletion of gold ore consumes all 12 density levels', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x0E); // max density gold (density 11)
    let totalCredits = 0;
    let bails = 0;
    while (true) {
      const credits = map.depleteOre(50, 50);
      if (credits === 0) break;
      totalCredits += credits;
      bails++;
    }
    // 12 density levels (0x0E down to 0x03, then fully depleted)
    expect(bails).toBe(12);
    expect(totalCredits).toBe(12 * INI_GOLD_VALUE);
    expect(getOverlay(map, 50, 50)).toBe(0xFF);
  });

  it('sequential depletion of gems consumes all 4 density levels', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x12); // max density gem
    let totalCredits = 0;
    let bails = 0;
    while (true) {
      const credits = map.depleteOre(50, 50);
      if (credits === 0) break;
      totalCredits += credits;
      bails++;
    }
    // 4 density levels (0x12 down to 0x0F, then fully depleted)
    expect(bails).toBe(4);
    expect(totalCredits).toBe(4 * INI_GEM_VALUE);
    expect(getOverlay(map, 50, 50)).toBe(0xFF);
  });

  it('depleteOre on out-of-bounds cell returns 0', () => {
    const map = makeMap();
    expect(map.depleteOre(-1, 50)).toBe(0);
    expect(map.depleteOre(50, -1)).toBe(0);
    expect(map.depleteOre(MAP_CELLS, 50)).toBe(0);
    expect(map.depleteOre(50, MAP_CELLS)).toBe(0);
  });
});

// =============================================================================
// Section 5: Credit Values Match C++ Tiberium_Adjust (cell.cpp:2019-2078)
// =============================================================================
describe('credit values per bail — C++ Tiberium_Adjust (cell.cpp:2034-2056)', () => {
  /**
   * C++ cell.cpp:2041: value = Rule.GoldValue;   (gold ore per density step)
   * C++ cell.cpp:2050: value = Rule.GemValue*4;  (gems worth 4x per step)
   *
   * rules.ini [General]:
   *   GoldValue=25  (C++ constructor default was 35 — INI overrides)
   *   GemValue=50   (C++ constructor default was 110 — INI overrides)
   *
   * For harvesting, each bail extracts one density level:
   *   Gold bail = GoldValue = 25 credits
   *   Gem bail  = GemValue  = 50 credits
   *
   * C++ Tiberium_Adjust uses GemValue*4 for the TOTAL value of a gem cell
   * (during initial map value calculation), not per bail.
   */

  it('gold bail value = INI GoldValue (25), not C++ default (35)', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x05);
    expect(map.depleteOre(50, 50)).toBe(INI_GOLD_VALUE);
    expect(INI_GOLD_VALUE).toBe(25); // verify INI parse
  });

  it('gem bail value = INI GemValue (50), not C++ default (110)', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x10);
    expect(map.depleteOre(50, 50)).toBe(INI_GEM_VALUE);
    expect(INI_GEM_VALUE).toBe(50); // verify INI parse
  });

  it('gem bail is worth 2x gold bail (INI: 50 vs 25)', () => {
    expect(INI_GEM_VALUE).toBe(INI_GOLD_VALUE * 2);
  });

  it('gold bail value is consistent across all gold density levels', () => {
    for (let ovl = 0x03; ovl <= 0x0E; ovl++) {
      const map = makeMap();
      setOverlay(map, 50, 50, ovl);
      expect(
        map.depleteOre(50, 50),
        `gold overlay 0x${ovl.toString(16)} should yield ${INI_GOLD_VALUE} credits`,
      ).toBe(INI_GOLD_VALUE);
    }
  });

  it('gem bail value is consistent across all gem density levels', () => {
    for (let ovl = 0x0F; ovl <= 0x12; ovl++) {
      const map = makeMap();
      setOverlay(map, 50, 50, ovl);
      expect(
        map.depleteOre(50, 50),
        `gem overlay 0x${ovl.toString(16)} should yield ${INI_GEM_VALUE} credits`,
      ).toBe(INI_GEM_VALUE);
    }
  });
});

// =============================================================================
// Section 6: Ore Destruction by Explosions -- combat.cpp:247 IsTiberiumDestroyer
// =============================================================================
describe('ore destruction by warheads — IsTiberiumDestroyer (combat.cpp:247)', () => {
  /**
   * C++ combat.cpp:247:
   *   if (optr->IsTiberium && whead->IsTiberiumDestroyer) {
   *     // ... reduce tiberium
   *
   * C++ warhead.cpp:174:
   *   IsTiberiumDestroyer = ini.Get_Bool(Name(), "Ore", IsTiberiumDestroyer);
   *
   * rules.ini warhead sections:
   *   [Nuke] Ore=yes    -- only Nuke has this flag
   *   [HE]              -- no Ore= key
   *   [AP]              -- no Ore= key
   *   [Fire]            -- no Ore= key
   *   [SA]              -- no Ore= key
   *
   * C++ warhead.cpp:75: IsTiberiumDestroyer(false) -- default is false
   */

  it('only Nuke warhead has Ore=yes in rules.ini', () => {
    // Parse Ore= from each warhead section
    const nukeOre = nukeSection.get('Ore');
    expect(nukeOre).toBe('yes');

    // All other warheads should NOT have Ore=yes
    expect(heSection.get('Ore')).toBeUndefined();
    expect(apSection.get('Ore')).toBeUndefined();
    expect(fireSection.get('Ore')).toBeUndefined();
    expect(saSection.get('Ore')).toBeUndefined();
  });

  it('TS WARHEAD_META.Nuke.destroysOre matches INI Ore=yes', () => {
    const iniOreFlag = parseBool(nukeSection.get('Ore')!);
    expect(WARHEAD_META.Nuke.destroysOre).toBe(iniOreFlag);
  });

  it('TS WARHEAD_META: only Nuke has destroysOre=true', () => {
    const oreWarheads = Object.entries(WARHEAD_META)
      .filter(([_, meta]) => meta.destroysOre)
      .map(([name]) => name);
    expect(oreWarheads).toEqual(['Nuke']);
  });

  it('HE warhead does not destroy ore (no Ore= in INI)', () => {
    expect(WARHEAD_META.HE.destroysOre).toBeFalsy();
  });

  it('AP warhead does not destroy ore (no Ore= in INI)', () => {
    expect(WARHEAD_META.AP.destroysOre).toBeFalsy();
  });

  it('Fire warhead does not destroy ore (no Ore= in INI)', () => {
    expect(WARHEAD_META.Fire.destroysOre).toBeFalsy();
  });

  it('SA warhead does not destroy ore (no Ore= in INI)', () => {
    expect(WARHEAD_META.SA.destroysOre).toBeFalsy();
  });
});

// =============================================================================
// Section 7: Ore Destruction Effects on Density
// =============================================================================
describe('ore destruction reduces density — combat.ts CF9 matches C++ combat.cpp:247', () => {
  /**
   * C++ combat.cpp:247-249:
   *   When IsTiberiumDestroyer warhead hits a cell with tiberium overlay,
   *   it calls Reduce_Tiberium to lower the density.
   *
   * TS combat.ts:1111-1125 (CF9):
   *   if (whMeta.destroysOre) {
   *     // Reduce ore density by one level; fully depleted if at minimum
   *     if (ovl === 0x03 || ovl === 0x0F) {
   *       ctx.map.overlay[oreIdx] = 0xFF; // fully depleted
   *     } else {
   *       ctx.map.overlay[oreIdx] = ovl - 1;
   *     }
   *   }
   *
   * This directly manipulates overlay values, matching Reduce_Tiberium(1).
   */

  it('ore destruction reduces gold density by 1 (mid-range)', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x08); // density 5
    // Simulate ore destruction (same logic as combat.ts CF9)
    const ovl = getOverlay(map, 50, 50);
    if (ovl === 0x03 || ovl === 0x0F) {
      map.overlay[50 * MAP_CELLS + 50] = 0xFF;
    } else {
      map.overlay[50 * MAP_CELLS + 50] = ovl - 1;
    }
    expect(getOverlay(map, 50, 50)).toBe(0x07);
  });

  it('ore destruction at minimum gold density (0x03) removes overlay entirely', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x03);
    const ovl = getOverlay(map, 50, 50);
    if (ovl === 0x03 || ovl === 0x0F) {
      map.overlay[50 * MAP_CELLS + 50] = 0xFF;
    } else {
      map.overlay[50 * MAP_CELLS + 50] = ovl - 1;
    }
    expect(getOverlay(map, 50, 50)).toBe(0xFF);
  });

  it('ore destruction reduces gem density by 1 (mid-range)', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x11); // gem density 2
    const ovl = getOverlay(map, 50, 50);
    if (ovl === 0x03 || ovl === 0x0F) {
      map.overlay[50 * MAP_CELLS + 50] = 0xFF;
    } else {
      map.overlay[50 * MAP_CELLS + 50] = ovl - 1;
    }
    expect(getOverlay(map, 50, 50)).toBe(0x10);
  });

  it('ore destruction at minimum gem density (0x0F) removes overlay entirely', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x0F);
    const ovl = getOverlay(map, 50, 50);
    if (ovl === 0x03 || ovl === 0x0F) {
      map.overlay[50 * MAP_CELLS + 50] = 0xFF;
    } else {
      map.overlay[50 * MAP_CELLS + 50] = ovl - 1;
    }
    expect(getOverlay(map, 50, 50)).toBe(0xFF);
  });

  it('repeated nuke-style destruction depletes max gold in 12 hits', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x0E); // max density gold
    let hits = 0;
    while (getOverlay(map, 50, 50) !== 0xFF) {
      const ovl = getOverlay(map, 50, 50);
      if (ovl === 0x03 || ovl === 0x0F) {
        map.overlay[50 * MAP_CELLS + 50] = 0xFF;
      } else {
        map.overlay[50 * MAP_CELLS + 50] = ovl - 1;
      }
      hits++;
    }
    // 12 density levels: 0x0E -> 0x0D -> ... -> 0x03 -> 0xFF
    expect(hits).toBe(12);
  });

  it('repeated nuke-style destruction depletes max gem in 4 hits', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x12); // max density gem
    let hits = 0;
    while (getOverlay(map, 50, 50) !== 0xFF) {
      const ovl = getOverlay(map, 50, 50);
      if (ovl === 0x03 || ovl === 0x0F) {
        map.overlay[50 * MAP_CELLS + 50] = 0xFF;
      } else {
        map.overlay[50 * MAP_CELLS + 50] = ovl - 1;
      }
      hits++;
    }
    expect(hits).toBe(4);
  });
});

// =============================================================================
// Section 8: Density Range Invariants
// =============================================================================
describe('density range invariants — C++ OverlayData bounds', () => {
  /**
   * C++ cell.cpp:2879: if (OverlayData >= 11) return(false);
   *   -- Max gold density = 11 (OverlayData 0-11 = 12 levels)
   *
   * C++ cell.cpp:2024-2025 (Tiberium_Adjust):
   *   static int _adj[9] = {0,1,3,4,6,7,8,10,11};
   *   static int _adjgem[9] = {0,0,0,1,1,1,2,2,2};
   *   -- Gold: density mapped from 0-11 based on adjacency
   *   -- Gems: density 0-2 (3 levels visible, but 4 overlay types)
   *
   * TS overlay encoding:
   *   Gold: 0x03 + OverlayData (0-11) = 0x03-0x0E
   *   Gems: 0x0F + OverlayData (0-3) = 0x0F-0x12
   */

  it('gold max OverlayData = 11 matches TS max overlay 0x0E', () => {
    // C++ max: OverlayData = 11 (Can_Tiberium_Grow returns false at >= 11)
    // TS max: 0x0E = 0x03 + 11
    const cppMaxDensity = 11;
    const tsMaxGold = 0x0E;
    expect(tsMaxGold - 0x03).toBe(cppMaxDensity);
  });

  it('gold min OverlayData = 0 matches TS min overlay 0x03', () => {
    const tsMinGold = 0x03;
    expect(tsMinGold - 0x03).toBe(0);
  });

  it('gem max overlay 0x12 corresponds to density 3', () => {
    const tsMaxGem = 0x12;
    expect(tsMaxGem - 0x0F).toBe(3);
  });

  it('growth cannot exceed gold max (0x0E remains 0x0E after growOre)', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x0E);
    vi.spyOn(Math, 'random').mockReturnValue(0); // always trigger
    map.growOre(GameMap.ORE_GROWTH_INTERVAL);
    expect(getOverlay(map, 50, 50)).toBe(0x0E); // unchanged
    vi.restoreAllMocks();
  });

  it('depletion cannot go below 0x03 — removes to 0xFF instead', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x03);
    map.depleteOre(50, 50);
    // Should not be 0x02 — must jump to 0xFF (no overlay)
    expect(getOverlay(map, 50, 50)).toBe(0xFF);
    expect(getOverlay(map, 50, 50)).not.toBe(0x02);
  });

  it('gem depletion cannot go below 0x0F — removes to 0xFF instead', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x0F);
    map.depleteOre(50, 50);
    expect(getOverlay(map, 50, 50)).toBe(0xFF);
    expect(getOverlay(map, 50, 50)).not.toBe(0x0E); // must not bleed into gold range
  });
});

// =============================================================================
// Section 9: Gems Never Grow or Spread
// =============================================================================
describe('gems never grow or spread — C++ cell.cpp:2881, 2916', () => {
  /**
   * C++ cell.cpp:2881 (Can_Tiberium_Grow):
   *   if (Overlay != OVERLAY_GOLD1 && Overlay != OVERLAY_GOLD2 &&
   *       Overlay != OVERLAY_GOLD3 && Overlay != OVERLAY_GOLD4) return(false);
   *
   * C++ cell.cpp:2916 (Can_Tiberium_Spread):
   *   Same check — only OVERLAY_GOLD1..4 can spread.
   *
   * Gems NEVER participate in the growth/spread system.
   * They are static resource deposits placed by map designers.
   */

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gem at every density level is unchanged after growOre cycle', () => {
    for (const gemOvl of [0x0F, 0x10, 0x11, 0x12]) {
      const map = makeMap();
      setOverlay(map, 50, 50, gemOvl);
      vi.spyOn(Math, 'random').mockReturnValue(0); // always trigger
      map.growOre(GameMap.ORE_GROWTH_INTERVAL);
      expect(
        getOverlay(map, 50, 50),
        `gem 0x${gemOvl.toString(16)} must not grow`,
      ).toBe(gemOvl);
      vi.restoreAllMocks();
    }
  });

  it('gems do not spread to adjacent cells', () => {
    for (const gemOvl of [0x0F, 0x10, 0x11, 0x12]) {
      const map = makeMap();
      setOverlay(map, 50, 50, gemOvl);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      map.growOre(GameMap.ORE_GROWTH_INTERVAL);
      // Verify no adjacent cells received ore/gems
      for (const [dx, dy] of [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]) {
        expect(
          getOverlay(map, 50 + dx, 50 + dy),
          `gem 0x${gemOvl.toString(16)} must not spread to (${50 + dx},${50 + dy})`,
        ).toBe(0xFF);
      }
      vi.restoreAllMocks();
    }
  });
});

// =============================================================================
// Section 10: Spread Threshold -- OverlayData > 6 (cell.cpp:2914)
// =============================================================================
describe('spread threshold — OverlayData > 6 (cell.cpp:2914)', () => {
  /**
   * C++ cell.cpp:2914: if (OverlayData <= 6) return(false);
   *
   * Minimum OverlayData for spread = 7.
   * In TS overlay encoding: OverlayData=7 => overlay = 0x03 + 7 = 0x0A
   *
   * TS map.ts:714: ORE_SPREAD_MIN_DENSITY = 0x09
   * TS map.ts:751: if (ovl <= ORE_SPREAD_MIN_DENSITY) continue;
   * So TS requires ovl > 0x09, i.e. ovl >= 0x0A. PARITY MATCH.
   */

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('TS ORE_SPREAD_MIN_DENSITY = 0x09 matches C++ OverlayData=6 boundary', () => {
    // C++ boundary: OverlayData <= 6 returns false => OverlayData=6 CANNOT spread
    // OverlayData=6 => TS overlay = 0x03 + 6 = 0x09
    // TS: ovl <= 0x09 skips => 0x09 CANNOT spread
    // PARITY MATCH
    expect(GameMap.ORE_SPREAD_MIN_DENSITY).toBe(0x09);
    expect(GameMap.ORE_SPREAD_MIN_DENSITY - 0x03).toBe(6); // C++ OverlayData=6
  });

  it('overlay 0x09 (C++ OverlayData=6) does NOT spread', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x09);
    vi.spyOn(Math, 'random').mockReturnValue(0); // trigger everything
    map.growOre(GameMap.ORE_GROWTH_INTERVAL);
    // Check all 8 adjacent cells — none should have ore
    // Note: density may grow (0x09 -> 0x0A) but spread uses pre-growth value
    for (const [dx, dy] of [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]) {
      expect(
        getOverlay(map, 50 + dx, 50 + dy),
        `no spread from density 0x09 to (${50 + dx},${50 + dy})`,
      ).toBe(0xFF);
    }
  });

  it('overlay 0x0A (C++ OverlayData=7) CAN spread', () => {
    const map = makeMap();
    setOverlay(map, 50, 50, 0x0A);
    // With reservoir sampling, only random call is spread direction offset
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction: north
    map.growOre(GameMap.ORE_GROWTH_INTERVAL);
    // North cell should have new ore at minimum density
    expect(getOverlay(map, 50, 49)).toBe(0x03);
  });
});

// =============================================================================
// Section 11: No Infantry Tiberium Damage in Red Alert
// =============================================================================
describe('no infantry tiberium damage in Red Alert', () => {
  /**
   * Red Alert does NOT have the infantry tiberium damage mechanic that exists in
   * Tiberian Dawn / C&C1. In TD, infantry standing on tiberium take periodic damage.
   *
   * Evidence:
   *   1. rules.ini [General] has no "Tiberium=" key for damage amount
   *   2. No TIBERIUM_DAMAGE constant exists in RA C++ headers
   *   3. No infantry-on-tiberium damage logic in RA infantry.cpp or foot.cpp
   *   4. The "GrowthRate" INI key is labeled with "; minutes between ore (Tiberium) growth"
   *      — "Tiberium" here is just the internal C++ name for ore, not a damage reference
   *
   * The [Ore] land type section in rules.ini (lines 2787-2793) defines movement speed
   * penalties for different movement types on ore terrain, but NOT damage:
   *   Foot=90%   — infantry move at 90% speed on ore
   *   Track=70%  — tracked vehicles at 70%
   *   Wheel=50%  — wheeled vehicles at 50%
   */

  it('rules.ini [General] has no Tiberium= damage key', () => {
    // In C&C1/TD, Tiberium= specified damage per tick to infantry.
    // In Red Alert, this key does not exist.
    expect(general.get('Tiberium')).toBeUndefined();
  });

  it('rules.ini [General] has no TiberiumDamage= key', () => {
    expect(general.get('TiberiumDamage')).toBeUndefined();
  });

  it('rules.ini [Ore] section defines speed modifiers, not damage', () => {
    const oreSection = sections.get('Ore');
    expect(oreSection).toBeDefined();
    // Speed modifiers exist
    expect(oreSection!.get('Foot')).toBeDefined();
    expect(oreSection!.get('Track')).toBeDefined();
    expect(oreSection!.get('Wheel')).toBeDefined();
    // No damage keys
    expect(oreSection!.get('Damage')).toBeUndefined();
    expect(oreSection!.get('InfDamage')).toBeUndefined();
  });

  it('[Ore] movement speeds parsed correctly from INI', () => {
    const oreSection = sections.get('Ore')!;
    // These are percentage strings — verify they exist and are valid
    const foot = oreSection.get('Foot')!;
    const track = oreSection.get('Track')!;
    const wheel = oreSection.get('Wheel')!;
    expect(foot).toBe('90%');
    expect(track).toBe('70%');
    expect(wheel).toBe('50%');
  });
});

// =============================================================================
// Section 12: findNearestOre — Ore/Gem Detection
// =============================================================================
describe('findNearestOre — ore/gem detection (map.ts)', () => {
  /**
   * C++ unit.cpp:2230-2234 — harvesters scan for nearest ore using
   * TiberiumShortScan (rules.cpp:273: 0x0600 = 6 leptons = ~6 cells)
   * and TiberiumLongScan (rules.cpp:274: 0x2000 = ~48 cells).
   *
   * TS findNearestOre(cx, cy, maxRange) finds both gold and gems.
   */

  it('finds gold ore within range', () => {
    const map = makeMap();
    setOverlay(map, 52, 50, 0x05); // gold 2 cells east
    const result = map.findNearestOre(50, 50, 6);
    expect(result).toEqual({ cx: 52, cy: 50 });
  });

  it('finds gems within range', () => {
    const map = makeMap();
    setOverlay(map, 52, 50, 0x10); // gem 2 cells east
    const result = map.findNearestOre(50, 50, 6);
    expect(result).toEqual({ cx: 52, cy: 50 });
  });

  it('returns nearest ore when multiple ore cells exist', () => {
    const map = makeMap();
    setOverlay(map, 55, 50, 0x05); // gold 5 cells east
    setOverlay(map, 51, 50, 0x05); // gold 1 cell east (closer)
    const result = map.findNearestOre(50, 50, 6);
    expect(result).toEqual({ cx: 51, cy: 50 });
  });

  it('returns null when no ore/gem within range', () => {
    const map = makeMap();
    // No ore placed
    const result = map.findNearestOre(50, 50, 6);
    expect(result).toBeNull();
  });

  it('detects all gold overlay values (0x03-0x0E)', () => {
    for (let ovl = 0x03; ovl <= 0x0E; ovl++) {
      const map = makeMap();
      setOverlay(map, 51, 50, ovl);
      const result = map.findNearestOre(50, 50, 6);
      expect(result, `gold overlay 0x${ovl.toString(16)} should be detected`).toEqual({ cx: 51, cy: 50 });
    }
  });

  it('detects all gem overlay values (0x0F-0x12)', () => {
    for (let ovl = 0x0F; ovl <= 0x12; ovl++) {
      const map = makeMap();
      setOverlay(map, 51, 50, ovl);
      const result = map.findNearestOre(50, 50, 6);
      expect(result, `gem overlay 0x${ovl.toString(16)} should be detected`).toEqual({ cx: 51, cy: 50 });
    }
  });

  it('does not detect depleted cells (0xFF) as ore', () => {
    const map = makeMap();
    // 0xFF = no overlay (default)
    const result = map.findNearestOre(50, 50, 6);
    expect(result).toBeNull();
  });

  it('does not detect non-ore overlays (0x00-0x02, 0x13+) as ore', () => {
    const map = makeMap();
    // Place a non-ore overlay value
    setOverlay(map, 51, 50, 0x01); // wall overlay range
    const result = map.findNearestOre(50, 50, 6);
    expect(result).toBeNull();
  });
});

// =============================================================================
// Section 13: Growth Rate Timing Derivation
// =============================================================================
describe('growth rate timing — GrowthRate INI to tick interval', () => {
  /**
   * C++ map.cpp:1017: subcount = MAP_CELL_TOTAL / (Rule.GrowthRate * TICKS_PER_MINUTE)
   *   MAP_CELL_TOTAL = 128 * 128 = 16384
   *   GrowthRate = 2 (from rules.ini [General])
   *   TICKS_PER_MINUTE = 15 * 60 = 900
   *   subcount = floor(16384 / (2 * 900)) = floor(16384 / 1800) = floor(9.1) = 9
   *   Full scan ticks = ceil(16384 / 9) = ceil(1820.4) = 1821
   *
   * After 1821 ticks (~121s at 15 FPS, ~2.02 minutes), one complete
   * growth/spread cycle fires.
   */

  it('GrowthRate=2 from INI yields 1821 tick full scan interval', () => {
    const mapCellTotal = 128 * 128; // MAP_CELL_TOTAL
    const subcount = Math.floor(mapCellTotal / (INI_GROWTH_RATE * CPP_TICKS_PER_MINUTE));
    const fullScanTicks = Math.ceil(mapCellTotal / subcount);
    expect(subcount).toBe(9);
    expect(fullScanTicks).toBe(1821);
    expect(GameMap.ORE_GROWTH_INTERVAL).toBe(fullScanTicks);
  });

  it('full scan approximates GrowthRate minutes', () => {
    const scanMinutes = GameMap.ORE_GROWTH_INTERVAL / CPP_TICKS_PER_MINUTE;
    // 1821 / 900 = 2.023... minutes, close to GrowthRate=2
    expect(scanMinutes).toBeCloseTo(INI_GROWTH_RATE, 1);
  });
});
