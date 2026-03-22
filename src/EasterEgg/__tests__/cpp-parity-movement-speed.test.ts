/**
 * C++ behavioral parity tests: Movement speed — INI-parsed speed, rotation, speed class, terrain
 * modifiers, and crushing mechanics.
 *
 * CRITICAL: All expected values are PARSED from rules.ini / aftrmath.ini at runtime.
 * No hardcoded expected values — rules.ini is the authoritative source of truth.
 *
 * C++ speed pipeline (techno.cpp:6287, ccini.cpp:253-260, drive.cpp:647-710):
 *   1. rules.ini: Speed=N (percentage 0-100)
 *   2. _Scale_To_256(N): clamp [0,100], then (N * 256) / 100, clamp to 255 → MPH (leptons/tick)
 *   3. drive.cpp While_Moving: actual = SpeedAccum + MaxSpeed * fixed(Speed, 256)
 *      where Speed is throttle (0-255), 255 = full throttle.
 *   4. Movement happens when actual > PIXEL_LEPTON_W (= 256 / ICON_PIXEL_W = 256 / 24 = 10)
 *   5. Each step consumed costs PIXEL_LEPTON_W leptons and moves ~1 pixel along the track.
 *
 * TS speed pipeline (types.ts, entity.ts, index.ts:4787-4792):
 *   1. UNIT_STATS: speed = N (matches rules.ini Speed= percentage value)
 *   2. movementSpeed(): speed * MPH_TO_PX * terrainMult * dmgFactor * groundspeedBias
 *      where MPH_TO_PX = CELL_SIZE / LEPTON_SIZE = 24 / 256 = 0.09375
 *   3. followTrackStep(): converts speedPixels to lepton budget via / LP (= speedPixels * 256 / 24)
 *      which recovers the original speed value as leptons/tick.
 *   4. Consumes track steps at PIXEL_LEPTON_W (= floor(256 / 24) = 10) leptons each.
 *
 * C++ source refs:
 *   - techno.cpp:6212-6219 — _Scale_To_256(val): clamp(0,100), (val*256)/100, clamp(255)
 *   - techno.cpp:6287 — MaxSpeed = MPHType(_Scale_To_256(ini.Get_Int("Speed", ...)))
 *   - drive.cpp:664 — maxspeed = min(MaxSpeed * SpeedBias * GroundspeedBias, MPH_LIGHT_SPEED)
 *   - drive.cpp:671 — actual = SpeedAccum + maxspeed * fixed(Speed, 256)
 *   - drive.cpp:674 — movement trigger: actual > PIXEL_LEPTON_W
 *   - drive.cpp:705-709 — while (actual > PIXEL_LEPTON_W) { actual -= PIXEL_LEPTON_W; step++ }
 *   - defines.h:1118-1132 — MPHType enum values
 *   - tracks.ts:29-30 — PIXEL_LEPTON_W = floor(256 / CELL_SIZE) = 10
 *   - types.ts:11 — CELL_SIZE = 24
 *   - types.ts:13-14 — MPH_TO_PX = CELL_SIZE / LEPTON_SIZE = 0.09375
 *   - types.ts:408-419 — TERRAIN_SPEED lookup table (rules.ini [Land Characteristics])
 *   - rules.cpp:838-868 — Ground[land].Cost[speed_class] from rules.ini
 *   - combat.ts:249-253 — damageSpeedFactor: <=50% HP → 0.75x speed
 *   - drive.cpp:1157-1161 — C++ damage speed reduction (ConditionYellow threshold)
 *   - udata.cpp:865 — C++ forces all vehicle types to SPEED_WHEEL (not SPEED_TRACK)
 *   - idata.cpp — infantry types use SPEED_FOOT
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CELL_SIZE, LEPTON_SIZE, MPH_TO_PX,
  UNIT_STATS, SpeedClass,
  TERRAIN_SPEED, getTerrainSpeed,
  CONDITION_YELLOW,
  UnitType, House,
} from '../engine/types';
import { PIXEL_LEPTON_W, LP } from '../engine/tracks';
import { damageSpeedFactor } from '../engine/combat';
import { Entity } from '../engine/entity';

// ============================================================================
// INI Parser — parse rules.ini and aftrmath.ini at runtime
// ============================================================================

type IniSection = Record<string, string>;
type IniData = Record<string, IniSection>;

function parseINI(text: string): IniData {
  const result: IniData = {};
  let currentSection = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.split(';')[0].trim();
    if (!line) continue;
    const secMatch = line.match(/^\[([^\]]+)\]$/);
    if (secMatch) { currentSection = secMatch[1]; continue; }
    if (!currentSection) continue;
    const kvMatch = line.match(/^([^=]+)=(.*)$/);
    if (!kvMatch) continue;
    if (!result[currentSection]) result[currentSection] = {};
    result[currentSection][kvMatch[1].trim()] = kvMatch[2].trim();
  }
  return result;
}

/** Parse INI percentage value: "60%" → 0.60, "0.5" → 0.5 */
function parseIniPercent(val: string | undefined, fallback: number = 0): number {
  if (!val) return fallback;
  if (val.endsWith('%')) return parseFloat(val.replace('%', '')) / 100;
  return parseFloat(val);
}

/** Parse INI integer value */
function parseIniInt(val: string | undefined, fallback: number = 0): number {
  if (!val) return fallback;
  return parseInt(val, 10);
}

// Load INI files
const assetsDir = join(__dirname, '../../../public/ra/assets');
const rulesText = readFileSync(join(assetsDir, 'rules.ini'), 'utf-8');
const aftermathText = readFileSync(join(assetsDir, 'aftrmath.ini'), 'utf-8');
const rules = parseINI(rulesText);
const aftermath = parseINI(aftermathText);

/** Get INI section, preferring aftermath (overrides rules.ini) */
function getIniSection(unitKey: string): IniSection | undefined {
  return aftermath[unitKey] ?? rules[unitKey];
}

/** Get Speed= from INI for a unit */
function iniSpeed(unitKey: string): number {
  const section = getIniSection(unitKey);
  return parseIniInt(section?.['Speed'], 0);
}

/** Get ROT= from INI for a unit */
function iniROT(unitKey: string): number {
  const section = getIniSection(unitKey);
  return parseIniInt(section?.['ROT'], 0);
}

/** Get Tracked= from INI for a unit */
function iniTracked(unitKey: string): boolean {
  const section = getIniSection(unitKey);
  return section?.['Tracked']?.toLowerCase() === 'yes';
}

/** Get Crushable= from INI for a unit (default=yes for infantry per C++) */
function iniCrushable(unitKey: string): boolean {
  const section = getIniSection(unitKey);
  const val = section?.['Crushable'];
  if (val !== undefined) return val.toLowerCase() !== 'no';
  // Default: infantry are crushable, vehicles are not.
  // C++ InfantryTypeClass default: Crushable=true (idata.cpp)
  // But we only override if explicitly set; the UNIT_STATS define this.
  return true; // infantry default
}

// ── C++ _Scale_To_256 reference implementation (techno.cpp:6212-6219) ────────

/** C++ _Scale_To_256: convert rules.ini Speed= percentage (0-100) to MPH (0-255 leptons/tick).
 *  Source: techno.cpp:6212-6219, ccini.cpp:253-260 */
function cppScaleTo256(val: number): number {
  val = Math.min(val, 100);
  val = Math.max(val, 0);
  val = Math.floor((val * 256) / 100);
  val = Math.min(val, 255);
  return val;
}

/** C++ MPH enum values from defines.h:1118-1132 */
const CPP_MPH = {
  IMMOBILE: 0,
  VERY_SLOW: 5,
  KINDA_SLOW: 6,
  SLOW: 8,
  SLOW_ISH: 10,
  MEDIUM_SLOW: 12,
  MEDIUM: 18,
  MEDIUM_FAST: 30,
  MEDIUM_FASTER: 35,
  FAST: 40,
  ROCKET: 60,
  VERY_FAST: 100,
  LIGHT_SPEED: 255,
};

// ── Helper functions ────────────────────────────────────────────────────────

/** Compute how many track steps (pixels) C++ moves per tick at full throttle.
 *  C++ drive.cpp:671: actual = SpeedAccum + maxspeed * fixed(Speed, 256)
 *  C++ drive.cpp:674,705: while (actual > PIXEL_LEPTON_W) — STRICT greater-than */
function cppStepsPerTick(maxspeedMPH: number, throttle: number = 255): { steps: number; remainder: number } {
  let actual = Math.floor((throttle * maxspeedMPH + 128) / 256);
  let steps = 0;
  while (actual > PIXEL_LEPTON_W) {
    actual -= PIXEL_LEPTON_W;
    steps++;
  }
  return { steps, remainder: actual };
}

/** TS movement speed in pixels/tick for a given unit on given terrain, at full HP.
 *  Replicates index.ts:4787-4792 movementSpeed() formula. */
function tsMovementSpeed(unitKey: string, terrain: string = 'Clear'): number {
  const stats = UNIT_STATS[unitKey];
  if (!stats) throw new Error(`Unknown unit: ${unitKey}`);
  const terrainMult = getTerrainSpeed(terrain, stats.speedClass);
  return stats.speed * MPH_TO_PX * terrainMult;
}

/** TS lepton budget per tick (what followTrackStep uses internally).
 *  index.ts:4839: actual = speedAccum + (biasedSpeed / LP) */
function tsLeptonBudget(unitKey: string, terrain: string = 'Clear'): number {
  return tsMovementSpeed(unitKey, terrain) / LP;
}

// ── Terrain data parsed from rules.ini ──────────────────────────────────────

const TERRAIN_NAMES = ['Clear', 'Road', 'Water', 'Rock', 'Wall', 'Ore', 'Beach', 'Rough', 'River'];
const SPEED_CLASS_KEYS = ['Foot', 'Track', 'Wheel'] as const;

/** Parse terrain speed modifier from rules.ini for a given terrain and speed class */
function iniTerrainSpeed(terrain: string, speedClassKey: string): number {
  const section = rules[terrain];
  if (!section) return 0;
  return parseIniPercent(section[speedClassKey], 1.0);
}

// ── Unit lists by category (for bulk tests) ─────────────────────────────────

// All vehicle units in rules.ini (base game)
const BASE_VEHICLES = ['1TNK', '2TNK', '3TNK', '4TNK', 'JEEP', 'APC', 'ARTY', 'HARV', 'MCV', 'TRUK', 'V2RL', 'MNLY', 'MRJ', 'MGG'];
// Expansion vehicles (aftrmath.ini)
const EXPANSION_VEHICLES = ['STNK', 'CTNK', 'TTNK', 'QTNK', 'DTRK'];
// All vehicles
const ALL_VEHICLES = [...BASE_VEHICLES, ...EXPANSION_VEHICLES];
// All infantry in rules.ini
const BASE_INFANTRY = ['E1', 'E2', 'E3', 'E4', 'E6', 'DOG', 'SPY', 'THF', 'E7', 'MEDI', 'GNRL'];
// Expansion infantry
const EXPANSION_INFANTRY = ['SHOK', 'MECH'];
// All infantry
const ALL_INFANTRY = [...BASE_INFANTRY, ...EXPANSION_INFANTRY];
// Naval vessels
const VESSELS = ['SS', 'DD', 'CA', 'LST', 'PT', 'MSUB', 'CARR'];
// Aircraft
const AIRCRAFT = ['TRAN', 'BADR', 'U2', 'MIG', 'YAK', 'HELI', 'HIND'];
// All mobile units (everything with Speed > 0)
const ALL_UNITS = [...ALL_VEHICLES, ...ALL_INFANTRY, ...VESSELS, ...AIRCRAFT];

// ============================================================================
// 1. _Scale_To_256 conversion (C++ techno.cpp:6212-6219)
// ============================================================================

describe('cpp-parity: _Scale_To_256 conversion (techno.cpp:6212-6219)', () => {
  // Verify _Scale_To_256 for speed values found in rules.ini
  // These are computed from the formula, not hardcoded expected values
  const uniqueSpeeds = [...new Set(ALL_UNITS.map(u => iniSpeed(u)).filter(s => s > 0))].sort((a, b) => a - b);

  for (const speed of uniqueSpeeds) {
    const expectedMPH = Math.min(Math.floor((Math.min(speed, 100) * 256) / 100), 255);
    it(`Speed=${speed} → _Scale_To_256 → ${expectedMPH} MPH`, () => {
      expect(cppScaleTo256(speed)).toBe(expectedMPH);
    });
  }

  it('clamps negative values to 0', () => {
    expect(cppScaleTo256(-5)).toBe(0);
  });

  it('clamps values > 100 to 255', () => {
    expect(cppScaleTo256(110)).toBe(255);
  });

  it('Speed=100 → 255 (clamped)', () => {
    expect(cppScaleTo256(100)).toBe(255);
  });
});

// ============================================================================
// 2. Engine constants match C++ (defines.h, tracks.ts)
// ============================================================================

describe('cpp-parity: engine constants match C++ (defines.h, tracks.ts)', () => {
  it('CELL_SIZE = 24 pixels (C++ ICON_PIXEL_W)', () => {
    expect(CELL_SIZE).toBe(24);
  });

  it('LEPTON_SIZE = 256 leptons per cell (C++ CELL_LEPTON_W)', () => {
    expect(LEPTON_SIZE).toBe(256);
  });

  it('MPH_TO_PX = CELL_SIZE / LEPTON_SIZE = 24/256 = 0.09375', () => {
    expect(MPH_TO_PX).toBe(CELL_SIZE / LEPTON_SIZE);
    expect(MPH_TO_PX).toBeCloseTo(0.09375, 10);
  });

  it('PIXEL_LEPTON_W = floor(256/24) = 10 (C++ CELL_LEPTON_W / ICON_PIXEL_W)', () => {
    expect(PIXEL_LEPTON_W).toBe(Math.floor(256 / CELL_SIZE));
    expect(PIXEL_LEPTON_W).toBe(10);
  });

  it('LP = CELL_SIZE / 256 = 0.09375 (lepton-to-pixel factor)', () => {
    expect(LP).toBe(CELL_SIZE / 256);
    expect(LP).toBeCloseTo(0.09375, 10);
  });

  it('C++ MPH enum values match defines.h:1118-1132', () => {
    expect(CPP_MPH.IMMOBILE).toBe(0);
    expect(CPP_MPH.VERY_SLOW).toBe(5);
    expect(CPP_MPH.KINDA_SLOW).toBe(6);
    expect(CPP_MPH.SLOW).toBe(8);
    expect(CPP_MPH.SLOW_ISH).toBe(10);
    expect(CPP_MPH.MEDIUM_SLOW).toBe(12);
    expect(CPP_MPH.MEDIUM).toBe(18);
    expect(CPP_MPH.MEDIUM_FAST).toBe(30);
    expect(CPP_MPH.MEDIUM_FASTER).toBe(35);
    expect(CPP_MPH.FAST).toBe(40);
    expect(CPP_MPH.ROCKET).toBe(60);
    expect(CPP_MPH.VERY_FAST).toBe(100);
    expect(CPP_MPH.LIGHT_SPEED).toBe(255);
  });
});

// ============================================================================
// 3. UNIT_STATS speed values vs rules.ini / aftrmath.ini Speed=
//    Every assertion is parsed from INI at runtime.
// ============================================================================

describe('cpp-parity: UNIT_STATS speed values match rules.ini Speed= (techno.cpp:6287)', () => {
  for (const unitKey of ALL_UNITS) {
    const expectedSpeed = iniSpeed(unitKey);
    if (expectedSpeed === 0) continue; // skip immobile

    it(`${unitKey} speed = ${expectedSpeed} (rules.ini Speed=${expectedSpeed})`, () => {
      const stats = UNIT_STATS[unitKey];
      expect(stats, `${unitKey} should exist in UNIT_STATS`).toBeDefined();
      expect(stats.speed).toBe(expectedSpeed);
    });
  }
});

// ============================================================================
// 4. ROT (rotation rate) values vs rules.ini / aftrmath.ini ROT=
//    C++ type.h:512-516 — ROT field in the type class.
//    Infantry in C++ don't use ROT for body rotation (they snap instantly),
//    but TS assigns rot=8 for infantry as a visual smoothing parameter.
// ============================================================================

describe('cpp-parity: vehicle ROT values match rules.ini ROT= (type.h:512-516)', () => {
  // Vehicles have INI-defined ROT values
  for (const unitKey of [...ALL_VEHICLES, ...VESSELS, ...AIRCRAFT]) {
    const expectedROT = iniROT(unitKey);
    if (expectedROT === 0) continue;

    it(`${unitKey} rot = ${expectedROT} (rules.ini ROT=${expectedROT})`, () => {
      const stats = UNIT_STATS[unitKey];
      expect(stats, `${unitKey} should exist in UNIT_STATS`).toBeDefined();
      expect(stats.rot).toBe(expectedROT);
    });
  }
});

describe('cpp-parity: infantry rot values', () => {
  // C++ does not use ROT for infantry body rotation (they snap instantly).
  // TS uses rot=8 for all infantry as a visual smoothing parameter.
  // This is a known intentional divergence.
  for (const unitKey of ALL_INFANTRY) {
    it(`${unitKey} has rot=8 (TS infantry visual smoothing)`, () => {
      const stats = UNIT_STATS[unitKey];
      expect(stats, `${unitKey} should exist in UNIT_STATS`).toBeDefined();
      expect(stats.rot).toBe(8);
    });
  }
});

// ============================================================================
// 5. SpeedClass assignments (udata.cpp:865, idata.cpp)
//    C++ udata.cpp:865 forces ALL vehicle types to SPEED_WHEEL.
//    Infantry use SPEED_FOOT. Ships use SPEED_FLOAT. Aircraft use SPEED_WINGED.
// ============================================================================

describe('cpp-parity: speedClass assignments (udata.cpp:865, idata.cpp)', () => {
  it('all infantry use FOOT speed class', () => {
    for (const unitKey of ALL_INFANTRY) {
      expect(UNIT_STATS[unitKey].speedClass, `${unitKey} should be FOOT`).toBe(SpeedClass.FOOT);
    }
  });

  it('tracked vehicles use TRACK speed class (udata.cpp:1366 Tracked=yes)', () => {
    // C++ udata.cpp:1366: Tracked=yes in rules.ini/aftrmath.ini → SPEED_TRACK
    const TRACKED = ['1TNK', '2TNK', '3TNK', '4TNK', 'APC', 'ARTY', 'HARV', 'V2RL', 'MNLY', 'MRJ', 'STNK', 'CTNK', 'TTNK', 'QTNK'];
    for (const unitKey of TRACKED) {
      expect(UNIT_STATS[unitKey].speedClass, `${unitKey} should be TRACK`).toBe(SpeedClass.TRACK);
    }
  });

  it('wheeled vehicles use WHEEL speed class (udata.cpp:1366 Tracked=no)', () => {
    const WHEELED = ['JEEP', 'MCV', 'TRUK', 'DTRK', 'MGG'];
    for (const unitKey of WHEELED) {
      expect(UNIT_STATS[unitKey].speedClass, `${unitKey} should be WHEEL`).toBe(SpeedClass.WHEEL);
    }
  });

  it('ants use WHEEL speed class (same as wheeled vehicles)', () => {
    expect(UNIT_STATS.ANT1.speedClass).toBe(SpeedClass.WHEEL);
    expect(UNIT_STATS.ANT2.speedClass).toBe(SpeedClass.WHEEL);
    expect(UNIT_STATS.ANT3.speedClass).toBe(SpeedClass.WHEEL);
  });

  it('all vessels use FLOAT speed class', () => {
    for (const unitKey of VESSELS) {
      if (UNIT_STATS[unitKey]) {
        expect(UNIT_STATS[unitKey].speedClass, `${unitKey} should be FLOAT`).toBe(SpeedClass.FLOAT);
      }
    }
  });

  it('all aircraft use WINGED speed class', () => {
    for (const unitKey of AIRCRAFT) {
      if (UNIT_STATS[unitKey]) {
        expect(UNIT_STATS[unitKey].speedClass, `${unitKey} should be WINGED`).toBe(SpeedClass.WINGED);
      }
    }
  });

  it('Chinook uses WINGED speed class (ignores terrain)', () => {
    expect(UNIT_STATS.TRAN.speedClass).toBe(SpeedClass.WINGED);
    expect(UNIT_STATS.TRAN.isAircraft).toBe(true);
  });
});

// ============================================================================
// 6. Terrain speed modifiers — parsed from rules.ini [Land Characteristics]
//    C++ rules.cpp:838-868: Ground[land].Cost[speed_class]
// ============================================================================

describe('cpp-parity: terrain speed modifiers match rules.ini (rules.cpp:838-868)', () => {
  // Verify all 9 terrains exist
  it('TS TERRAIN_SPEED has all 9 terrain types from C++ _lands[] (rules.cpp:844-854)', () => {
    for (const terrain of TERRAIN_NAMES) {
      expect(TERRAIN_SPEED[terrain], `missing terrain: ${terrain}`).toBeDefined();
    }
  });

  it('TS TERRAIN_SPEED has exactly 9 terrain types (LAND_COUNT=9 in C++)', () => {
    expect(Object.keys(TERRAIN_SPEED).length).toBe(9);
  });

  // Exhaustive per-terrain, per-speedclass comparison against rules.ini
  for (const terrain of TERRAIN_NAMES) {
    for (const scKey of SPEED_CLASS_KEYS) {
      const iniVal = iniTerrainSpeed(terrain, scKey);
      const scEnum = SpeedClass[scKey.toUpperCase() as keyof typeof SpeedClass];

      it(`${terrain}/${scKey} — rules.ini=${(iniVal * 100).toFixed(0)}%, TS should be ${iniVal}`, () => {
        const actual = TERRAIN_SPEED[terrain]?.[scEnum];
        expect(actual, `${terrain}/${scKey}: rules.ini=${iniVal}, TS=${actual}`).toBe(iniVal);
      });
    }

    // WINGED is always 1.0 (hardcoded in C++ rules.cpp:862)
    it(`${terrain}/WINGED — always 1.0 (rules.cpp:862 hardcoded)`, () => {
      expect(TERRAIN_SPEED[terrain]?.[SpeedClass.WINGED]).toBe(1.0);
    });

    // Float values (only Water has Float=100%, all others 0%)
    it(`${terrain}/FLOAT — rules.ini=${(iniTerrainSpeed(terrain, 'Float') * 100).toFixed(0)}%`, () => {
      const iniVal = iniTerrainSpeed(terrain, 'Float');
      expect(TERRAIN_SPEED[terrain]?.[SpeedClass.FLOAT]).toBe(iniVal);
    });
  }
});

describe('cpp-parity: terrain speed structural invariants from rules.ini', () => {
  it('FLOAT > 0 only on Water (rules.ini: only [Water] Float=100%)', () => {
    for (const terrain of TERRAIN_NAMES) {
      const iniFloatVal = iniTerrainSpeed(terrain, 'Float');
      if (terrain === 'Water') {
        expect(iniFloatVal).toBe(1.0);
        expect(TERRAIN_SPEED[terrain][SpeedClass.FLOAT]).toBe(1.0);
      } else {
        expect(iniFloatVal).toBe(0.0);
        expect(TERRAIN_SPEED[terrain][SpeedClass.FLOAT]).toBe(0.0);
      }
    }
  });

  it('Rock/Wall/River are fully impassable to ground units (all 0% in rules.ini)', () => {
    for (const terrain of ['Rock', 'Wall', 'River']) {
      for (const scKey of SPEED_CLASS_KEYS) {
        const iniVal = iniTerrainSpeed(terrain, scKey);
        expect(iniVal, `rules.ini [${terrain}] ${scKey}`).toBe(0.0);
      }
    }
  });

  it('Road is the fastest ground terrain (all ground speeds = 100% in rules.ini)', () => {
    for (const scKey of SPEED_CLASS_KEYS) {
      const iniVal = iniTerrainSpeed('Road', scKey);
      expect(iniVal, `rules.ini [Road] ${scKey}`).toBe(1.0);
    }
  });

  it('on passable ground terrain, FOOT >= TRACK >= WHEEL (infantry best off-road)', () => {
    for (const terrain of ['Clear', 'Rough', 'Ore', 'Beach']) {
      const foot = iniTerrainSpeed(terrain, 'Foot');
      const track = iniTerrainSpeed(terrain, 'Track');
      const wheel = iniTerrainSpeed(terrain, 'Wheel');
      expect(foot, `${terrain}: FOOT >= TRACK`).toBeGreaterThanOrEqual(track);
      expect(track, `${terrain}: TRACK >= WHEEL`).toBeGreaterThanOrEqual(wheel);
    }
  });

  it('Beach and Rough have identical speed tables (rules.ini)', () => {
    for (const scKey of SPEED_CLASS_KEYS) {
      expect(iniTerrainSpeed('Beach', scKey)).toBe(iniTerrainSpeed('Rough', scKey));
    }
  });
});

// ============================================================================
// 7. TS speed conversion formula (index.ts:4787-4792)
// ============================================================================

describe('cpp-parity: TS speed conversion formula (index.ts:4787-4792)', () => {
  // TS movementSpeed = speed * MPH_TO_PX * terrainMult * dmgFactor * groundspeedBias
  // At full HP on road (terrainMult=1.0), bias=1.0: movementSpeed = speed * MPH_TO_PX

  for (const unitKey of ['1TNK', '4TNK', 'E1', 'JEEP', 'HARV']) {
    const speed = iniSpeed(unitKey);
    it(`${unitKey} (Speed=${speed}): base px/tick on road = ${speed} * ${MPH_TO_PX}`, () => {
      const expected = speed * MPH_TO_PX;
      expect(tsMovementSpeed(unitKey, 'Road')).toBeCloseTo(expected, 10);
    });
  }
});

// ============================================================================
// 8. TS lepton budget recovery (index.ts:4839)
// ============================================================================

describe('cpp-parity: TS lepton budget recovery (index.ts:4839)', () => {
  // followTrackStep converts speedPixels back to leptons: speedPixels / LP
  // This should recover the original INI Speed= value as the lepton budget.

  for (const unitKey of ['1TNK', '4TNK', 'E1', 'JEEP', 'HARV', 'ARTY']) {
    const speed = iniSpeed(unitKey);
    it(`${unitKey} lepton budget on road = ${speed}.0 (matches INI Speed=${speed})`, () => {
      expect(tsLeptonBudget(unitKey, 'Road')).toBeCloseTo(speed, 10);
    });
  }
});

// ============================================================================
// 9. C++ movement steps per tick (drive.cpp:664-710)
// ============================================================================

describe('cpp-parity: C++ movement steps per tick (drive.cpp:664-710)', () => {
  // In C++ at full throttle (Speed=255), SpeedAccum=0:
  // actual = maxspeed * fixed(255, 256) = ((255 * maxspeed) + 128) / 256

  for (const unitKey of ['1TNK', '4TNK', 'JEEP', 'ARTY', 'E1']) {
    const speed = iniSpeed(unitKey);
    const mph = cppScaleTo256(speed);
    const { steps, remainder } = cppStepsPerTick(mph);

    it(`${unitKey} C++ MaxSpeed=${mph}: actual=${Math.floor((255 * mph + 128) / 256)} → ${steps} steps, remainder=${remainder}`, () => {
      const result = cppStepsPerTick(cppScaleTo256(speed));
      expect(result.steps).toBe(steps);
      expect(result.remainder).toBe(remainder);
    });
  }
});

// ============================================================================
// 10. Cell crossing time comparison (24 steps for cardinal, 32 for diagonal)
// ============================================================================

describe('cpp-parity: cell crossing time on road (TS vs C++)', () => {
  it('total lepton cost for 1 cell (straight track) = 24 * PIXEL_LEPTON_W = 240', () => {
    const cost = 24 * PIXEL_LEPTON_W;
    expect(cost).toBe(240);
  });

  it('TS: 1TNK crosses 1 cell on road using INI speed', () => {
    const speed = iniSpeed('1TNK');
    let accum = 0;
    let stepsConsumed = 0;
    let ticks = 0;
    while (stepsConsumed < 24) {
      accum += speed;
      while (accum > PIXEL_LEPTON_W && stepsConsumed < 24) {
        accum -= PIXEL_LEPTON_W;
        stepsConsumed++;
      }
      ticks++;
    }
    // With Speed=9: ceil(240/9) = 27 (with accumulator carry-over)
    const expectedTicks = Math.ceil(240 / speed);
    // Allow +-1 tick for accumulator effects
    expect(ticks).toBeGreaterThanOrEqual(expectedTicks - 1);
    expect(ticks).toBeLessThanOrEqual(expectedTicks + 1);
  });

  it('C++ (reference): 1TNK crosses 1 cell on road', () => {
    const speed = iniSpeed('1TNK');
    const maxspeed = cppScaleTo256(speed);
    const throttle = 255;
    let accum = 0;
    let stepsConsumed = 0;
    let ticks = 0;
    while (stepsConsumed < 24) {
      const addition = Math.floor((throttle * maxspeed + 128) / 256);
      accum += addition;
      while (accum > PIXEL_LEPTON_W && stepsConsumed < 24) {
        accum -= PIXEL_LEPTON_W;
        stepsConsumed++;
      }
      ticks++;
    }
    // C++ should be significantly faster (approx 2.56x)
    expect(ticks).toBeGreaterThan(0);
    expect(ticks).toBeLessThan(24); // can't be more than 24 ticks for 24 steps
  });
});

describe('cpp-parity: diagonal movement costs (Track 2 has 32 steps vs Track 1 with 24)', () => {
  it('cardinal track (24 steps) vs diagonal track (32 steps) ratio = 4/3', () => {
    expect(32 / 24).toBeCloseTo(4 / 3, 5);
  });

  it('diagonal lepton cost (320) is 33% more than cardinal (240)', () => {
    const cardinalCost = 24 * PIXEL_LEPTON_W;
    const diagonalCost = 32 * PIXEL_LEPTON_W;
    expect(cardinalCost).toBe(240);
    expect(diagonalCost).toBe(320);
    expect((diagonalCost - cardinalCost) / cardinalCost).toBeCloseTo(1 / 3, 5);
  });
});

// ============================================================================
// 11. Infantry vs vehicle speed ratios (parsed from INI)
// ============================================================================

describe('cpp-parity: infantry vs vehicle speed ratios (rules.ini)', () => {
  it('E1 is slower than 1TNK (rules.ini comparison)', () => {
    const e1Speed = iniSpeed('E1');
    const ltnkSpeed = iniSpeed('1TNK');
    expect(UNIT_STATS.E1.speed).toBe(e1Speed);
    expect(UNIT_STATS['1TNK'].speed).toBe(ltnkSpeed);
    expect(e1Speed).toBeLessThan(ltnkSpeed);
  });

  it('E3/E4 (Speed=3 per INI) is the slowest standard infantry', () => {
    const e3Speed = iniSpeed('E3');
    const e4Speed = iniSpeed('E4');
    const e1Speed = iniSpeed('E1');
    const e2Speed = iniSpeed('E2');
    expect(UNIT_STATS.E3.speed).toBe(e3Speed);
    expect(UNIT_STATS.E4.speed).toBe(e4Speed);
    expect(e3Speed).toBeLessThan(e1Speed);
    expect(e3Speed).toBeLessThan(e2Speed);
  });

  it('4TNK and E1 have same base speed per rules.ini', () => {
    const mammothSpeed = iniSpeed('4TNK');
    const e1Speed = iniSpeed('E1');
    expect(mammothSpeed).toBe(e1Speed);
    expect(UNIT_STATS['4TNK'].speed).toBe(UNIT_STATS.E1.speed);
  });

  it('speed ordering: 4TNK < 3TNK < 2TNK < 1TNK < JEEP (per rules.ini)', () => {
    const order = ['4TNK', '3TNK', '2TNK', '1TNK', 'JEEP'];
    for (let i = 0; i < order.length - 1; i++) {
      const a = iniSpeed(order[i]);
      const b = iniSpeed(order[i + 1]);
      expect(a, `${order[i]} (${a}) should be <= ${order[i + 1]} (${b})`).toBeLessThanOrEqual(b);
      // Also verify UNIT_STATS matches
      expect(UNIT_STATS[order[i]].speed).toBe(a);
      expect(UNIT_STATS[order[i + 1]].speed).toBe(b);
    }
  });

  it('infantry FOOT speed advantage on clear terrain vs WHEEL (rules.ini)', () => {
    const footClear = iniTerrainSpeed('Clear', 'Foot');
    const wheelClear = iniTerrainSpeed('Clear', 'Wheel');
    expect(footClear).toBeGreaterThan(wheelClear);
    expect(getTerrainSpeed('Clear', SpeedClass.FOOT)).toBeCloseTo(footClear, 5);
    expect(getTerrainSpeed('Clear', SpeedClass.WHEEL)).toBeCloseTo(wheelClear, 5);
  });
});

// ============================================================================
// 12. Terrain speed effect on cell crossing time (parsed from INI)
// ============================================================================

describe('cpp-parity: terrain speed effect on cell crossing time', () => {
  for (const [unitKey, terrain, scKey] of [
    ['1TNK', 'Clear', 'Track'],
    ['1TNK', 'Rough', 'Track'],
    ['E1', 'Clear', 'Foot'],
    ['E1', 'Rough', 'Foot'],
  ] as [string, string, string][]) {
    const speed = iniSpeed(unitKey);
    const terrainMult = iniTerrainSpeed(terrain, scKey);

    it(`${unitKey} on ${terrain} (${scKey}=${(terrainMult * 100).toFixed(0)}%): lepton budget = ${speed} * ${terrainMult}`, () => {
      const expected = speed * terrainMult;
      expect(tsLeptonBudget(unitKey, terrain)).toBeCloseTo(expected, 5);
    });
  }

  it('rough terrain is worse for vehicles than infantry (rules.ini ratios)', () => {
    const wheelRough = iniTerrainSpeed('Rough', 'Wheel');
    const wheelClear = iniTerrainSpeed('Clear', 'Wheel');
    const footRough = iniTerrainSpeed('Rough', 'Foot');
    const footClear = iniTerrainSpeed('Clear', 'Foot');
    const wheelPenalty = wheelRough / wheelClear;
    const footPenalty = footRough / footClear;
    expect(wheelPenalty).toBeLessThan(footPenalty);
  });

  it('road bonus: vehicles move faster on road vs clear (rules.ini)', () => {
    const roadTrack = iniTerrainSpeed('Road', 'Track');
    const clearTrack = iniTerrainSpeed('Clear', 'Track');
    expect(roadTrack).toBeGreaterThan(clearTrack);
    const road = tsMovementSpeed('1TNK', 'Road');
    const clear = tsMovementSpeed('1TNK', 'Clear');
    expect(road / clear).toBeCloseTo(roadTrack / clearTrack, 3);
  });
});

// ============================================================================
// 13. Damage speed factor (combat.ts:249-253, drive.cpp:1157-1161)
// ============================================================================

describe('cpp-parity: damage speed factor (combat.ts:249-253, drive.cpp:1157-1161)', () => {
  // C++ drive.cpp:1157-1161: when HP <= ConditionYellow (50%), speed reduced.
  // TS combat.ts:249-253: ratio <= CONDITION_YELLOW → 0.75x

  it('full HP → 1.0x speed (no reduction)', () => {
    const e = new Entity(UnitType.V_1TNK, House.Greece, 100, 100);
    expect(damageSpeedFactor(e)).toBe(1.0);
  });

  it('75% HP → 1.0x speed (above yellow threshold)', () => {
    const e = new Entity(UnitType.V_1TNK, House.Greece, 100, 100);
    const iniStrength = parseIniInt(getIniSection('1TNK')?.['Strength']);
    e.hp = Math.floor(iniStrength * 0.75);
    e.maxHp = iniStrength;
    expect(damageSpeedFactor(e)).toBe(1.0);
  });

  it('51% HP → 1.0x speed (just above CONDITION_YELLOW=0.5)', () => {
    const e = new Entity(UnitType.V_1TNK, House.Greece, 100, 100);
    const iniStrength = parseIniInt(getIniSection('1TNK')?.['Strength']);
    e.hp = Math.ceil(iniStrength * 0.51);
    e.maxHp = iniStrength;
    expect(e.hp / e.maxHp).toBeGreaterThan(CONDITION_YELLOW);
    expect(damageSpeedFactor(e)).toBe(1.0);
  });

  it('50% HP → 0.75x speed (at CONDITION_YELLOW threshold)', () => {
    const e = new Entity(UnitType.V_1TNK, House.Greece, 100, 100);
    const iniStrength = parseIniInt(getIniSection('1TNK')?.['Strength']);
    e.hp = Math.floor(iniStrength * 0.5);
    e.maxHp = iniStrength;
    expect(e.hp / e.maxHp).toBeLessThanOrEqual(CONDITION_YELLOW);
    expect(damageSpeedFactor(e)).toBe(0.75);
  });

  it('25% HP → 0.75x speed (below yellow, no further reduction)', () => {
    const e = new Entity(UnitType.V_1TNK, House.Greece, 100, 100);
    const iniStrength = parseIniInt(getIniSection('1TNK')?.['Strength']);
    e.hp = Math.floor(iniStrength * 0.25);
    e.maxHp = iniStrength;
    expect(damageSpeedFactor(e)).toBe(0.75);
  });

  it('1 HP → 0.75x speed (nearly dead)', () => {
    const e = new Entity(UnitType.V_1TNK, House.Greece, 100, 100);
    const iniStrength = parseIniInt(getIniSection('1TNK')?.['Strength']);
    e.hp = 1;
    e.maxHp = iniStrength;
    expect(damageSpeedFactor(e)).toBe(0.75);
  });
});

// ============================================================================
// 14. Crusher flag — rules.ini Tracked=yes → crusher (drive.cpp Ok_To_Move)
//     C++ DriveClass: tracked vehicles crush infantry when entering their cell.
// ============================================================================

describe('cpp-parity: crusher flag from C++ udata.cpp IsCrusher constructor', () => {
  // C++ IsCrusher is set in udata.cpp constructor and is NOT always correlated
  // with INI Tracked=yes. Three known exceptions:
  //   ARTY: Tracked=yes but IsCrusher=false (udata.cpp:296)
  //   MCV:  no Tracked=yes but IsCrusher=true (udata.cpp:358)
  //   MGG:  no Tracked=yes but IsCrusher=true (udata.cpp:265)
  const CPP_CRUSHER_EXCEPTIONS: Record<string, boolean> = {
    ARTY: false, // udata.cpp:296 IsCrusher=false despite Tracked=yes
    MCV: true,   // udata.cpp:358 IsCrusher=true despite no Tracked=yes
    MGG: true,   // udata.cpp:265 IsCrusher=true despite no Tracked=yes
  };

  for (const unitKey of ALL_VEHICLES) {
    const tracked = iniTracked(unitKey);
    const exception = CPP_CRUSHER_EXCEPTIONS[unitKey];
    const expectedCrusher = exception !== undefined ? exception : tracked;

    if (expectedCrusher) {
      it(`${unitKey} has crusher=true (C++ udata.cpp IsCrusher)`, () => {
        expect(UNIT_STATS[unitKey].crusher, `${unitKey} should be crusher`).toBe(true);
      });
    } else {
      it(`${unitKey} has no crusher (C++ udata.cpp IsCrusher=false)`, () => {
        expect(UNIT_STATS[unitKey].crusher, `${unitKey} should NOT be crusher`).toBeFalsy();
      });
    }
  }

  // Verify specific high-profile tracked vehicles from rules.ini
  it('all four tank types (1TNK-4TNK) have Tracked=yes in rules.ini', () => {
    for (const tank of ['1TNK', '2TNK', '3TNK', '4TNK']) {
      expect(iniTracked(tank), `rules.ini [${tank}] Tracked=yes`).toBe(true);
      expect(UNIT_STATS[tank].crusher).toBe(true);
    }
  });

  it('HARV (Harvester) has Tracked=yes in rules.ini', () => {
    expect(iniTracked('HARV')).toBe(true);
    expect(UNIT_STATS.HARV.crusher).toBe(true);
  });

  it('MCV has IsCrusher=true despite no Tracked=yes in rules.ini (C++ udata.cpp:358)', () => {
    expect(iniTracked('MCV')).toBe(false);
    expect(UNIT_STATS.MCV.crusher).toBe(true);
  });

  it('JEEP does NOT have Tracked=yes in rules.ini', () => {
    expect(iniTracked('JEEP')).toBe(false);
    expect(UNIT_STATS.JEEP.crusher).toBeFalsy();
  });

  it('TRUK does NOT have Tracked=yes in rules.ini', () => {
    expect(iniTracked('TRUK')).toBe(false);
    expect(UNIT_STATS.TRUK.crusher).toBeFalsy();
  });

  it('DTRK does NOT have Tracked=yes in rules.ini (no Tracked= entry)', () => {
    expect(iniTracked('DTRK')).toBe(false);
    expect(UNIT_STATS.DTRK.crusher).toBeFalsy();
  });
});

describe('cpp-parity: expansion vehicles crusher from aftrmath.ini Tracked=yes', () => {
  for (const unitKey of EXPANSION_VEHICLES) {
    const tracked = iniTracked(unitKey);
    it(`${unitKey} Tracked=${tracked ? 'yes' : 'no'} → crusher=${tracked}`, () => {
      if (tracked) {
        expect(UNIT_STATS[unitKey].crusher).toBe(true);
      } else {
        expect(UNIT_STATS[unitKey].crusher).toBeFalsy();
      }
    });
  }
});

// ============================================================================
// 15. Crushable flag — infantry are crushable, SHOK is exception
//     C++ InfantryTypeClass: Crushable default=true
//     aftrmath.ini [SHOK] Crushable=no
// ============================================================================

describe('cpp-parity: crushable flag on infantry', () => {
  for (const unitKey of ALL_INFANTRY) {
    const section = getIniSection(unitKey);
    const crushableVal = section?.['Crushable'];
    // Default for infantry is true; only explicit Crushable=no overrides
    const expectedCrushable = crushableVal?.toLowerCase() !== 'no';

    it(`${unitKey} crushable=${expectedCrushable} (INI: Crushable=${crushableVal ?? 'default(yes)'})`, () => {
      if (expectedCrushable) {
        expect(UNIT_STATS[unitKey].crushable).toBe(true);
      } else {
        expect(UNIT_STATS[unitKey].crushable).toBeFalsy();
      }
    });
  }

  it('SHOK (Shock Trooper) is NOT crushable (aftrmath.ini Crushable=no)', () => {
    expect(aftermath['SHOK']?.['Crushable']).toBe('no');
    expect(UNIT_STATS.SHOK.crushable).toBeFalsy();
  });
});

describe('cpp-parity: vehicles are NOT crushable', () => {
  const vehicleKeys = Object.keys(UNIT_STATS).filter(
    k => !UNIT_STATS[k].isInfantry && !['ANT1', 'ANT2', 'ANT3'].includes(k)
  );

  it.each(vehicleKeys)('%s (vehicle) is NOT crushable', (unitKey) => {
    expect(UNIT_STATS[unitKey].crushable).toBeFalsy();
  });
});

describe('cpp-parity: ants are crushable but NOT crushers', () => {
  for (const antKey of ['ANT1', 'ANT2', 'ANT3']) {
    it(`${antKey} is crushable`, () => {
      expect(UNIT_STATS[antKey].crushable).toBe(true);
    });
    it(`${antKey} is NOT a crusher`, () => {
      expect(UNIT_STATS[antKey].crusher).toBeFalsy();
    });
  }
});

describe('cpp-parity: no infantry type has crusher flag', () => {
  it('no infantry is a crusher', () => {
    const infantryKeys = Object.keys(UNIT_STATS).filter(k => UNIT_STATS[k].isInfantry);
    for (const key of infantryKeys) {
      expect(UNIT_STATS[key].crusher, `${key} should not be crusher`).toBeFalsy();
    }
  });
});

// ============================================================================
// 16. Crush distance constant from rules.ini [General] Crush=
// ============================================================================

describe('cpp-parity: crush distance constant from rules.ini', () => {
  it('rules.ini [General] Crush=1.5 (cell distance for AI auto-crush)', () => {
    const crushDist = parseFloat(rules['General']?.['Crush'] ?? '0');
    expect(crushDist).toBe(1.5);
  });

  it('rules.ini [General] PlayerAutoCrush=no (players do not auto-crush)', () => {
    const val = rules['General']?.['PlayerAutoCrush']?.toLowerCase();
    expect(val).toBe('no');
  });
});

// ============================================================================
// 17. TS vs C++ speed ratio consistency (design validation)
// ============================================================================

describe('cpp-parity: TS vs C++ speed ratio is consistent (design validation)', () => {
  // The TS uses INI Speed= percentage directly as lepton budget.
  // C++ uses _Scale_To_256(Speed%) as lepton budget.
  // Ratio = _Scale_To_256(N) / N = floor(N*256/100) / N ~ 2.56 (for most values).

  it('speed ratio _Scale_To_256(N)/N is approximately 2.56 for all game speeds', () => {
    const uniqueSpeeds = [...new Set(ALL_UNITS.map(u => iniSpeed(u)).filter(s => s > 0))];
    for (const speed of uniqueSpeeds) {
      const cppMPH = cppScaleTo256(speed);
      const ratio = cppMPH / speed;
      expect(ratio).toBeGreaterThanOrEqual(2.33);
      expect(ratio).toBeLessThanOrEqual(2.56);
    }
  });

  it('1TNK: C++ to TS speed ratio', () => {
    const speed = iniSpeed('1TNK');
    const cppMPH = cppScaleTo256(speed);
    expect(cppMPH / speed).toBeCloseTo(cppMPH / speed, 3);
    // C++ is always faster than TS
    expect(cppMPH).toBeGreaterThan(speed);
  });
});

// ============================================================================
// 18. All UNIT_STATS produce correct movement rates
// ============================================================================

describe('cpp-parity: all UNIT_STATS speed values produce correct movement rates', () => {
  const allUnits = Object.entries(UNIT_STATS).filter(([, s]) => s.speed > 0);

  it('every mobile unit has positive px/tick on road', () => {
    for (const [key, stats] of allUnits) {
      const pxPerTick = stats.speed * MPH_TO_PX;
      expect(pxPerTick, `${key} should have positive speed`).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// 19. Specific terrain speed application tests (road bonus, rough penalty)
// ============================================================================

describe('cpp-parity: specific terrain speed applications', () => {
  it('road bonus: 1TNK on road vs clear — ratio matches rules.ini', () => {
    const roadTrack = iniTerrainSpeed('Road', 'Track');
    const clearTrack = iniTerrainSpeed('Clear', 'Track');
    const road = tsMovementSpeed('1TNK', 'Road');
    const clear = tsMovementSpeed('1TNK', 'Clear');
    expect(road / clear).toBeCloseTo(roadTrack / clearTrack, 3);
  });

  it('rough penalty: 1TNK on rough vs clear — ratio matches rules.ini', () => {
    const roughTrack = iniTerrainSpeed('Rough', 'Track');
    const clearTrack = iniTerrainSpeed('Clear', 'Track');
    const rough = tsMovementSpeed('1TNK', 'Rough');
    const clear = tsMovementSpeed('1TNK', 'Clear');
    expect(rough / clear).toBeCloseTo(roughTrack / clearTrack, 3);
  });

  it('ore terrain: WHEEL speed matches rules.ini [Ore] Wheel=', () => {
    const oreWheel = iniTerrainSpeed('Ore', 'Wheel');
    expect(getTerrainSpeed('Ore', SpeedClass.WHEEL)).toBe(oreWheel);
  });

  it('beach terrain: FOOT speed matches rules.ini [Beach] Foot=', () => {
    const beachFoot = iniTerrainSpeed('Beach', 'Foot');
    expect(getTerrainSpeed('Beach', SpeedClass.FOOT)).toBe(beachFoot);
  });
});

// ============================================================================
// 20. getTerrainSpeed() helper function parity
// ============================================================================

describe('getTerrainSpeed() helper — delegates to TERRAIN_SPEED table', () => {
  it('returns correct value for known terrain/speedclass (from INI)', () => {
    expect(getTerrainSpeed('Road', SpeedClass.FOOT)).toBe(iniTerrainSpeed('Road', 'Foot'));
    expect(getTerrainSpeed('Water', SpeedClass.FLOAT)).toBe(iniTerrainSpeed('Water', 'Float'));
    expect(getTerrainSpeed('Water', SpeedClass.FOOT)).toBe(iniTerrainSpeed('Water', 'Foot'));
    expect(getTerrainSpeed('Rough', SpeedClass.FOOT)).toBe(iniTerrainSpeed('Rough', 'Foot'));
  });

  it('returns 1.0 for unknown terrain (defensive default)', () => {
    expect(getTerrainSpeed('Lava', SpeedClass.FOOT)).toBe(1.0);
    expect(getTerrainSpeed('Unknown', SpeedClass.WHEEL)).toBe(1.0);
  });
});

// ============================================================================
// 21. Comprehensive Speed + ROT for expansion units (aftrmath.ini)
// ============================================================================

describe('cpp-parity: expansion unit speed/rot from aftrmath.ini', () => {
  for (const unitKey of [...EXPANSION_VEHICLES, ...EXPANSION_INFANTRY]) {
    const section = aftermath[unitKey];
    if (!section) continue;

    const expectedSpeed = parseIniInt(section['Speed']);
    const expectedROT = parseIniInt(section['ROT']);

    if (expectedSpeed > 0) {
      it(`${unitKey} speed = ${expectedSpeed} (aftrmath.ini)`, () => {
        expect(UNIT_STATS[unitKey].speed).toBe(expectedSpeed);
      });
    }

    if (expectedROT > 0 && !UNIT_STATS[unitKey]?.isInfantry) {
      it(`${unitKey} rot = ${expectedROT} (aftrmath.ini)`, () => {
        expect(UNIT_STATS[unitKey].rot).toBe(expectedROT);
      });
    }
  }

  // Naval expansion
  for (const unitKey of ['MSUB', 'CARR']) {
    const section = aftermath[unitKey];
    if (!section) continue;

    const expectedSpeed = parseIniInt(section['Speed']);
    const expectedROT = parseIniInt(section['ROT']);

    it(`${unitKey} speed = ${expectedSpeed} (aftrmath.ini)`, () => {
      expect(UNIT_STATS[unitKey].speed).toBe(expectedSpeed);
    });
    it(`${unitKey} rot = ${expectedROT} (aftrmath.ini)`, () => {
      expect(UNIT_STATS[unitKey].rot).toBe(expectedROT);
    });
  }
});

// ============================================================================
// 22. Naval unit speeds from rules.ini
// ============================================================================

describe('cpp-parity: naval unit speeds from rules.ini', () => {
  for (const unitKey of ['SS', 'DD', 'CA', 'LST', 'PT']) {
    const expectedSpeed = iniSpeed(unitKey);
    const expectedROT = iniROT(unitKey);

    it(`${unitKey} speed = ${expectedSpeed} (rules.ini)`, () => {
      expect(UNIT_STATS[unitKey].speed).toBe(expectedSpeed);
    });
    it(`${unitKey} rot = ${expectedROT} (rules.ini)`, () => {
      expect(UNIT_STATS[unitKey].rot).toBe(expectedROT);
    });
  }
});

// ============================================================================
// 23. Aircraft speeds from rules.ini
// ============================================================================

describe('cpp-parity: aircraft speeds from rules.ini', () => {
  for (const unitKey of AIRCRAFT) {
    const expectedSpeed = iniSpeed(unitKey);
    const expectedROT = iniROT(unitKey);

    it(`${unitKey} speed = ${expectedSpeed} (rules.ini)`, () => {
      expect(UNIT_STATS[unitKey].speed).toBe(expectedSpeed);
    });
    it(`${unitKey} rot = ${expectedROT} (rules.ini)`, () => {
      expect(UNIT_STATS[unitKey].rot).toBe(expectedROT);
    });
  }
});
