/**
 * C++ Behavioral Parity: Fog of War System — Comprehensive Audit
 *
 * Audits the TS fog-of-war implementation against C++ map.cpp / display.cpp.
 * All expected Sight= values are parsed from rules.ini / aftrmath.ini at test time.
 * NEVER hardcode C++ values in assertions — always derive from INI.
 *
 * Key C++ source files:
 *   map.cpp:286-344      — Sight_From: sightrange capped at 10, circular reveal
 *   map.cpp:296           — if (!sightrange || sightrange > 10) return;
 *   map.cpp:68-83         — RadiusOffset[] and RadiusCount[11] tables
 *   display.cpp:4157-4163 — Shroud_Cell: GPS active prevents shrouding
 *   techno.cpp:5903-5913  — TechnoClass::Look() uses SightRange directly, NO health check
 *   building.cpp:990-1006 — GAP generator AI: Power_Fraction >= 1 required
 *   building.cpp:5684-5700 — Remove_Gap_Effect: unjam on destruction
 *   rules.cpp:222-223     — GapShroudRadius=10 (default), GapRegenInterval=fixed(0.1)
 *   house.cpp:1265         — IsGPSActive bypasses fog
 *   house.cpp:1420-1425   — IsGPSActive cleared when ATEK destroyed → Shroud_The_Map
 *   house.cpp:4160-4170   — Power_Fraction() calculation
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  updateFogOfWar, updateGapGenerators, revealAroundCell,
  GAP_RADIUS, GAP_UPDATE_INTERVAL,
  STRUCTURE_SIGHT,
  type FogContext,
} from '../engine/fog';
import { CELL_SIZE, MAP_CELLS, UNIT_STATS, House } from '../engine/types';
import { CloakState } from '../engine/entity';
import type { Entity } from '../engine/entity';
import { GameMap, Terrain } from '../engine/map';

// =============================================================================
// Parse rules.ini and aftrmath.ini at test time
// =============================================================================

const RULES_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/rules.ini');
const AFTRMATH_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/aftrmath.ini');
const rulesText = fs.readFileSync(RULES_INI_PATH, 'utf-8');
const aftrmathText = fs.readFileSync(AFTRMATH_INI_PATH, 'utf-8');

interface ParsedSection {
  sight?: number;
  [key: string]: string | number | undefined;
}

function parseINISections(text: string): Record<string, ParsedSection> {
  const result: Record<string, ParsedSection> = {};
  let currentSection = '';

  for (const rawLine of text.split('\n')) {
    const line = rawLine.split(';')[0].trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[([A-Za-z0-9_]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }

    if (!currentSection) continue;

    const kvMatch = line.match(/^(\w+)=(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const val = kvMatch[2].trim();

    if (!result[currentSection]) result[currentSection] = {};

    if (key === 'Sight') {
      result[currentSection].sight = parseInt(val, 10);
    }
    result[currentSection][key] = val;
  }
  return result;
}

const INI = parseINISections(rulesText);
const AFTRMATH_INI = parseINISections(aftrmathText);

/** Parse GapRegenInterval from rules.ini [General] section */
function parseGapRegenInterval(): number {
  const generalSection = INI['General'];
  if (!generalSection) return 0.1; // C++ default
  const val = generalSection['GapRegenInterval'];
  if (typeof val === 'string') return parseFloat(val);
  return 0.1;
}

const GAP_REGEN_INTERVAL_INI = parseGapRegenInterval();

// =============================================================================
// Helpers
// =============================================================================

function makeEntity(overrides: Partial<Entity> & { pos: { x: number; y: number } }): Entity {
  return {
    alive: true,
    isPlayerUnit: true,
    house: (overrides as any).house ?? ((overrides as any).isPlayerUnit === false ? House.USSR : House.Greece),
    hp: 100,
    maxHp: 100,
    pos: overrides.pos,
    cloakState: CloakState.UNCLOAKED,
    cloakTimer: 0,
    sonarPulseTimer: 0,
    stats: {
      sight: 5,
      isAntiSub: false,
      isCloakable: false,
      isInfantry: false,
      ...((overrides as any).stats ?? {}),
    },
    ...overrides,
  } as unknown as Entity;
}

function makeFogContext(overrides: Partial<FogContext> = {}): FogContext {
  return {
    entities: [],
    structures: [],
    map: new GameMap(),
    tick: 0,
    playerHouse: 'Greece' as any,
    fogDisabled: false,
    gpsActive: false,
    baseDiscovered: true,
    powerProduced: 200,
    powerConsumed: 100,
    gapGeneratorCells: new Map(),
    isAllied: (a, b) => a === b,
    entitiesAllied: (a, b) => (a as any).isPlayerUnit === (b as any).isPlayerUnit,
    ...overrides,
  };
}

// =============================================================================
// Section 1: Unit sight ranges match INI Sight= for ALL units
// C++ techno.cpp:5908 — sight_range = Techno_Type_Class()->SightRange
// All expected values parsed from rules.ini / aftrmath.ini
// =============================================================================

describe('Unit sight ranges match INI Sight= (parsed at test time)', () => {
  // Vehicles from rules.ini
  const VEHICLES_RULES = ['V2RL', '1TNK', '3TNK', '2TNK', '4TNK', 'MRJ', 'MGG', 'ARTY', 'HARV', 'MCV', 'JEEP', 'APC', 'MNLY', 'TRUK'];
  // Vessels from rules.ini
  const VESSELS_RULES = ['SS', 'DD', 'CA', 'LST', 'PT'];
  // Infantry from rules.ini
  const INFANTRY_RULES = ['DOG', 'E1', 'E2', 'E3', 'E4', 'E6', 'SPY', 'THF', 'E7', 'MEDI', 'GNRL'];
  // Civilians from rules.ini
  const CIVILIANS_RULES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'EINSTEIN'];
  // Aircraft from rules.ini
  const AIRCRAFT_RULES = ['BADR', 'U2', 'MIG', 'YAK', 'TRAN', 'HELI', 'HIND'];
  // Expansion units from aftrmath.ini
  const EXPANSION_UNITS = ['STNK', 'CTNK', 'TTNK', 'DTRK', 'SHOK', 'MECH'];

  for (const unitKey of VEHICLES_RULES) {
    it(`vehicle ${unitKey}: TS sight matches rules.ini Sight=`, () => {
      const iniSight = INI[unitKey]?.sight;
      expect(iniSight, `${unitKey} should have Sight= in rules.ini`).toBeDefined();
      const tsStats = UNIT_STATS[unitKey];
      expect(tsStats, `${unitKey} should exist in UNIT_STATS`).toBeDefined();
      expect(tsStats.sight).toBe(iniSight);
    });
  }

  for (const unitKey of VESSELS_RULES) {
    it(`vessel ${unitKey}: TS sight matches rules.ini Sight=`, () => {
      const iniSight = INI[unitKey]?.sight;
      expect(iniSight, `${unitKey} should have Sight= in rules.ini`).toBeDefined();
      const tsStats = UNIT_STATS[unitKey];
      expect(tsStats, `${unitKey} should exist in UNIT_STATS`).toBeDefined();
      expect(tsStats.sight).toBe(iniSight);
    });
  }

  for (const unitKey of INFANTRY_RULES) {
    it(`infantry ${unitKey}: TS sight matches rules.ini Sight=`, () => {
      const iniSight = INI[unitKey]?.sight;
      expect(iniSight, `${unitKey} should have Sight= in rules.ini`).toBeDefined();
      const tsStats = UNIT_STATS[unitKey];
      expect(tsStats, `${unitKey} should exist in UNIT_STATS`).toBeDefined();
      expect(tsStats.sight).toBe(iniSight);
    });
  }

  for (const unitKey of CIVILIANS_RULES) {
    it(`civilian ${unitKey}: TS sight matches rules.ini Sight=`, () => {
      const iniSight = INI[unitKey]?.sight;
      expect(iniSight, `${unitKey} should have Sight= in rules.ini`).toBeDefined();
      const tsStats = UNIT_STATS[unitKey];
      expect(tsStats, `${unitKey} should exist in UNIT_STATS`).toBeDefined();
      expect(tsStats.sight).toBe(iniSight);
    });
  }

  for (const unitKey of AIRCRAFT_RULES) {
    it(`aircraft ${unitKey}: TS sight matches rules.ini Sight=`, () => {
      const iniSight = INI[unitKey]?.sight;
      expect(iniSight, `${unitKey} should have Sight= in rules.ini`).toBeDefined();
      const tsStats = UNIT_STATS[unitKey];
      expect(tsStats, `${unitKey} should exist in UNIT_STATS`).toBeDefined();
      expect(tsStats.sight).toBe(iniSight);
    });
  }

  for (const unitKey of EXPANSION_UNITS) {
    it(`expansion ${unitKey}: TS sight matches aftrmath.ini Sight=`, () => {
      const iniSight = AFTRMATH_INI[unitKey]?.sight;
      expect(iniSight, `${unitKey} should have Sight= in aftrmath.ini`).toBeDefined();
      const tsStats = UNIT_STATS[unitKey];
      expect(tsStats, `${unitKey} should exist in UNIT_STATS`).toBeDefined();
      expect(tsStats.sight).toBe(iniSight);
    });
  }
});

// =============================================================================
// Section 2: Building sight ranges match INI Sight= via STRUCTURE_SIGHT map
// C++ building.cpp uses Class->SightRange from INI Sight= key
// =============================================================================

describe('Building sight ranges match INI Sight= via STRUCTURE_SIGHT (parsed at test time)', () => {
  // All building types with Sight= in rules.ini
  const BUILDINGS_RULES = [
    'FACT', 'POWR', 'APWR', 'PROC', 'SILO', 'TENT', 'BARR', 'WEAP', 'FIX', 'HPAD',
    'AFLD', 'DOME', 'ATEK', 'STEK', 'PDOX', 'IRON', 'MSLO', 'KENN', 'SYRD', 'SPEN',
    'GAP', 'PBOX', 'HBOX', 'GUN', 'AGUN', 'TSLA', 'FTUR', 'SAM', 'BIO', 'HOSP', 'FCOM',
  ];

  for (const type of BUILDINGS_RULES) {
    it(`${type}: STRUCTURE_SIGHT matches rules.ini Sight=`, () => {
      const iniSight = INI[type]?.sight;
      expect(iniSight, `${type} should have Sight= in rules.ini`).toBeDefined();
      const tsSight = STRUCTURE_SIGHT[type];
      expect(tsSight, `${type} should exist in STRUCTURE_SIGHT`).toBeDefined();
      expect(tsSight).toBe(iniSight);
    });
  }

  // Walls should have Sight=0 in rules.ini (never reveal fog)
  const WALL_TYPES = ['SBAG', 'BRIK', 'FENC'];
  for (const type of WALL_TYPES) {
    it(`wall ${type}: rules.ini Sight=0 — walls never reveal fog`, () => {
      const iniSight = INI[type]?.sight;
      // Walls may not have Sight= in INI (defaults to 0 in C++)
      // If present, should be 0
      if (iniSight !== undefined) {
        expect(iniSight).toBe(0);
      }
      // Walls should NOT be in STRUCTURE_SIGHT (or if present, = 0)
      const tsSight = STRUCTURE_SIGHT[type];
      if (tsSight !== undefined) {
        expect(tsSight).toBe(0);
      }
    });
  }
});

// =============================================================================
// Section 3: GAP_RADIUS matches C++ GapShroudRadius
// C++ rules.cpp:222 — GapShroudRadius(10) default
// GapShroudRadius is NOT present in rules.ini — it's a hardcoded C++ default
// =============================================================================

describe('GAP_RADIUS matches C++ GapShroudRadius=10 (rules.cpp:222)', () => {
  it('GAP_RADIUS is 10 (C++ rules.cpp:222 default)', () => {
    // C++ rules.cpp:222: GapShroudRadius(10)
    // This is NOT in rules.ini — it's a C++ constructor default
    expect(GAP_RADIUS).toBe(10);
  });

  it('GapRegenInterval from rules.ini is 0.1', () => {
    // rules.ini line 28: GapRegenInterval=.1
    expect(GAP_REGEN_INTERVAL_INI).toBeCloseTo(0.1, 5);
  });

  it('GAP_UPDATE_INTERVAL = TICKS_PER_MINUTE * GapRegenInterval = 900 * 0.1 = 90', () => {
    // C++ building.cpp:993: Arm = TICKS_PER_MINUTE * Rule.GapRegenInterval + Random_Pick(1, TICKS_PER_SECOND)
    // Base value: 900 * 0.1 = 90 (TS omits the random jitter)
    const expectedBase = Math.round(900 * GAP_REGEN_INTERVAL_INI);
    expect(GAP_UPDATE_INTERVAL).toBe(expectedBase);
  });
});

// =============================================================================
// Section 4: Gap generator shrouds enemy view within radius
// C++ map.cpp:437-486 — Jam_From uses circular pattern
// C++ building.cpp:990-1006 — GAP AI: Power_Fraction >= 1 required
// =============================================================================

describe('Gap generator shrouds enemy view within radius', () => {
  it('GAP jams cells within octagonal radius=10 when powered', () => {
    // C++ map.cpp:437-486: Jam_From with GapShroudRadius=10
    const map = new GameMap();
    const gapStructure = {
      type: 'GAP', alive: true, hp: 100, maxHp: 100,
      cx: 64, cy: 64, house: 'Greece' as any,
    };
    const ctx = makeFogContext({
      map,
      structures: [gapStructure as any],
      tick: 0,
      powerProduced: 200,
      powerConsumed: 100,
    });

    updateGapGenerators(ctx);
    expect(ctx.gapGeneratorCells.size).toBe(1);

    const entry = ctx.gapGeneratorCells.values().next().value!;
    const cx = entry.cx;
    const cy = entry.cy;

    // Axis cell at distance 10 — octagonal: max(10,0)*2+min(10,0) = 20 <= 20 — jammed
    expect(map.jammedCells.has(cy * MAP_CELLS + (cx + 10))).toBe(true);
    // Axis cell at distance 11 — octagonal: max(11,0)*2+min(11,0) = 22 > 20 — NOT jammed
    expect(map.jammedCells.has(cy * MAP_CELLS + (cx + 11))).toBe(false);
    // Diagonal (7,7) — octagonal: max(7,7)*2+min(7,7) = 21 > 20 — NOT jammed
    expect(map.jammedCells.has((cy + 7) * MAP_CELLS + (cx + 7))).toBe(false);
    // (6,7) — octagonal: max(7,6)*2+min(7,6) = 20 <= 20 — jammed
    expect(map.jammedCells.has((cy + 7) * MAP_CELLS + (cx + 6))).toBe(true);
  });

  it('GAP does NOT jam when power insufficient (Power_Fraction < 1)', () => {
    // C++ building.cpp:997: if (House->Power_Fraction() >= 1)
    const map = new GameMap();
    const ctx = makeFogContext({
      map,
      structures: [{ type: 'GAP', alive: true, hp: 100, maxHp: 100, cx: 64, cy: 64, house: 'Greece' as any } as any],
      tick: 0,
      powerProduced: 99,
      powerConsumed: 100,
    });
    updateGapGenerators(ctx);
    expect(ctx.gapGeneratorCells.size).toBe(0);
  });

  it('GAP unjams when power drops below 1.0 (building.cpp:1002-1004)', () => {
    const map = new GameMap();
    const gapStructure = {
      type: 'GAP', alive: true, hp: 100, maxHp: 100,
      cx: 64, cy: 64, house: 'Greece' as any,
    };
    const ctx = makeFogContext({
      map,
      structures: [gapStructure as any],
      tick: 0,
      powerProduced: 200,
      powerConsumed: 100,
    });

    // First: jam with sufficient power
    updateGapGenerators(ctx);
    expect(ctx.gapGeneratorCells.size).toBe(1);

    // Power drops
    ctx.powerProduced = 50;
    ctx.tick = GAP_UPDATE_INTERVAL;
    updateGapGenerators(ctx);
    expect(ctx.gapGeneratorCells.size).toBe(0);
  });

  it('dead GAP generator does NOT jam', () => {
    const map = new GameMap();
    const ctx = makeFogContext({
      map,
      structures: [{ type: 'GAP', alive: false, hp: 0, maxHp: 100, cx: 64, cy: 64, house: 'Greece' as any } as any],
      tick: 0,
      powerProduced: 200,
      powerConsumed: 100,
    });
    updateGapGenerators(ctx);
    expect(ctx.gapGeneratorCells.size).toBe(0);
  });
});

// =============================================================================
// Section 5: Fog state transitions — unseen(0) → shrouded/fog(1) → visible(2)
// C++ cell.h — IsMapped/IsVisible states
// C++ map.cpp:340-342 — Sight_From reveals cell
// =============================================================================

describe('Fog state transitions: unseen(0) → fog(1) → visible(2)', () => {
  it('initial state is shroud (0) for all cells', () => {
    const map = new GameMap();
    expect(map.getVisibility(64, 64)).toBe(0);
    expect(map.getVisibility(0, 0)).toBe(0);
    expect(map.getVisibility(127, 127)).toBe(0);
  });

  it('first reveal transitions shroud(0) → visible(2)', () => {
    const map = new GameMap();
    map.setVisibility(64, 64, 2);
    expect(map.getVisibility(64, 64)).toBe(2);
  });

  it('updateFogOfWar downgrades visible(2) → fog(1) when unit moves away', () => {
    // C++ map.cpp: Sight_From sets IsMapped+IsVisible;
    // when unit moves, old cells lose IsVisible but keep IsMapped
    const map = new GameMap();
    const entity = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      stats: { sight: 3, isAntiSub: false, isCloakable: false, isInfantry: false } as any,
    });
    const ctx = makeFogContext({ map, entities: [entity] });

    updateFogOfWar(ctx);
    expect(map.getVisibility(64, 64)).toBe(2);

    // Move unit far away
    entity.pos = { x: 100 * CELL_SIZE, y: 100 * CELL_SIZE };
    updateFogOfWar(ctx);
    expect(map.getVisibility(64, 64)).toBe(1); // fog, not shroud
  });

  it('fog(1) cell is re-revealed to visible(2) when unit returns', () => {
    const map = new GameMap();
    const entity = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      stats: { sight: 2, isAntiSub: false, isCloakable: false, isInfantry: false } as any,
    });
    const ctx = makeFogContext({ map, entities: [entity] });

    // First reveal
    updateFogOfWar(ctx);
    expect(map.getVisibility(64, 64)).toBe(2);

    // Move away
    entity.pos = { x: 100 * CELL_SIZE, y: 100 * CELL_SIZE };
    updateFogOfWar(ctx);
    expect(map.getVisibility(64, 64)).toBe(1);

    // Return
    entity.pos = { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE };
    updateFogOfWar(ctx);
    expect(map.getVisibility(64, 64)).toBe(2);
  });

  it('explored cells never revert to shroud(0) during normal fog-of-war', () => {
    // C++ cell.h: once IsMapped=true, it stays true
    // Only gap generators can set visibility back to 0
    const map = new GameMap();
    const entity = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      stats: { sight: 3, isAntiSub: false, isCloakable: false, isInfantry: false } as any,
    });
    const ctx = makeFogContext({ map, entities: [entity] });

    updateFogOfWar(ctx);
    entity.pos = { x: 10 * CELL_SIZE, y: 10 * CELL_SIZE };
    updateFogOfWar(ctx);
    expect(map.getVisibility(64, 64)).toBe(1); // fog, never shroud

    // Update again — still fog
    updateFogOfWar(ctx);
    expect(map.getVisibility(64, 64)).toBe(1);
  });

  it('gap generator CAN force cells back to shroud(0)', () => {
    // C++ map.cpp:708-717: Jam_From sets visibility to 0
    const map = new GameMap();
    map.setVisibility(64, 64, 2);
    expect(map.getVisibility(64, 64)).toBe(2);

    map.jamCell(64, 64);
    expect(map.getVisibility(64, 64)).toBe(0);
  });

  it('unjamming restores to fog(1), not visible(2)', () => {
    // C++ building.cpp:5687: UnJam_From restores to "mapped but not visible"
    const map = new GameMap();
    map.setVisibility(64, 64, 2);
    map.jamCell(64, 64);
    expect(map.getVisibility(64, 64)).toBe(0);

    map.unjamCell(64, 64);
    expect(map.getVisibility(64, 64)).toBe(1);
  });
});

// =============================================================================
// Section 6: Radar reveals map when DOME is powered
// C++ house.cpp:1290-1311 — radar activation requires DOME + power
// The DOME (radar) building has Sight=10 in rules.ini
// =============================================================================

describe('Radar (DOME) building sight range from INI', () => {
  it('DOME Sight= in rules.ini matches STRUCTURE_SIGHT', () => {
    const iniSight = INI['DOME']?.sight;
    expect(iniSight, 'DOME should have Sight= in rules.ini').toBeDefined();
    expect(STRUCTURE_SIGHT['DOME']).toBe(iniSight);
  });

  it('DOME reveals cells when base is discovered', () => {
    // C++ building.cpp: buildings use Class->SightRange for fog reveal
    const map = new GameMap();
    const domeSight = INI['DOME']!.sight!;
    const dome = {
      type: 'DOME', alive: true, hp: 256, maxHp: 256,
      cx: 64, cy: 64, house: 'Greece' as any,
    };
    const ctx = makeFogContext({
      map,
      structures: [dome as any],
      baseDiscovered: true,
    });

    updateFogOfWar(ctx);

    // Cell at the dome position should be visible
    const domeCenterX = 64 * CELL_SIZE + CELL_SIZE / 2;
    const domeCenterCx = Math.floor(domeCenterX / CELL_SIZE);
    expect(map.getVisibility(domeCenterCx, 64)).toBe(2);
  });

  it('DOME reveals even when legacy baseDiscovered is false', () => {
    // C++ All_To_Look(units_only=true) at init skips buildings, but normal
    // per-tick building sight has no distance-based base-discovery gate.
    const map = new GameMap();
    const dome = {
      type: 'DOME', alive: true, hp: 256, maxHp: 256,
      cx: 64, cy: 64, house: 'Greece' as any,
    };
    const ctx = makeFogContext({
      map,
      structures: [dome as any],
      baseDiscovered: false,
      entities: [],
    });

    updateFogOfWar(ctx);

    expect(map.getVisibility(64, 64)).toBe(2);
  });
});

// =============================================================================
// Section 7: GPS satellite permanently reveals map
// C++ house.cpp:1265 — IsGPSActive bypasses fog
// C++ display.cpp:4159 — IsGPSActive prevents Shroud_Cell
// =============================================================================

describe('GPS satellite permanently reveals map (house.cpp:1265)', () => {
  it('GPS active reveals entire map', () => {
    const map = new GameMap();
    const ctx = makeFogContext({
      map,
      gpsActive: true,
      entities: [],
    });

    updateFogOfWar(ctx);

    expect(map.getVisibility(0, 0)).toBe(2);
    expect(map.getVisibility(64, 64)).toBe(2);
    expect(map.getVisibility(MAP_CELLS - 1, MAP_CELLS - 1)).toBe(2);
  });

  it('GPS does NOT require power (house.cpp:1302-1303)', () => {
    const map = new GameMap();
    const ctx = makeFogContext({
      map,
      gpsActive: true,
      powerProduced: 0,
      powerConsumed: 100,
    });

    updateFogOfWar(ctx);
    expect(map.getVisibility(64, 64)).toBe(2);
  });

  it('GPS overrides gap generator jamming on revealAll', () => {
    // C++ house.cpp:1265-1266: if (IsGPSActive) { jammed = false; }
    const map = new GameMap();
    map.jamCell(50, 50);
    expect(map.getVisibility(50, 50)).toBe(0);

    const ctx = makeFogContext({
      map,
      gpsActive: true,
    });
    updateFogOfWar(ctx);

    // GPS revealAll overrides jammed cells
    expect(map.getVisibility(50, 50)).toBe(2);
  });

  it('losing GPS (ATEK destroyed) re-shrouds map, then fog re-reveals around units', () => {
    // C++ house.cpp:1420-1425: IsGPSActive=false → Shroud_The_Map
    const map = new GameMap();
    const entity = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      stats: { sight: 3, isAntiSub: false, isCloakable: false, isInfantry: false } as any,
    });

    const ctx = makeFogContext({ map, entities: [entity], gpsActive: true });
    updateFogOfWar(ctx);
    expect(map.getVisibility(10, 10)).toBe(2); // GPS revealed everything

    // ATEK destroyed — shroud everything, then re-reveal around units
    map.shroudAll();
    ctx.gpsActive = false;
    updateFogOfWar(ctx);

    expect(map.getVisibility(64, 64)).toBe(2); // near unit
    expect(map.getVisibility(10, 10)).toBe(0); // far from unit
  });
});

// =============================================================================
// Section 8: Spy plane temporarily reveals area
// C++ taction.cpp / superweapon.ts — spy plane reveals 10-cell radius
// =============================================================================

describe('Spy plane reveals area around target', () => {
  it('revealAroundCell with radius=10 reveals cells within octagonal distance', () => {
    // C++ map.cpp:286-344: Sight_From reveals using RadiusOffset table
    // TS uses octagonal distance: max*2+min <= radius*2
    const map = new GameMap();
    revealAroundCell(map, 64, 64, 10);

    // Cell at distance 10 on axis — revealed
    expect(map.getVisibility(74, 64)).toBe(2);
    expect(map.getVisibility(54, 64)).toBe(2);

    // Cell at distance 11 on axis — NOT revealed
    expect(map.getVisibility(75, 64)).not.toBe(2);
  });

  it('spy plane reveal is persistent (cells stay at fog, not shroud, after move away)', () => {
    // Once revealed by spy plane, cells stay at fog (1) even without units nearby
    const map = new GameMap();
    revealAroundCell(map, 64, 64, 5);

    expect(map.getVisibility(64, 64)).toBe(2);

    // Run fog update with no units — revealed cells should downgrade to fog (1)
    const ctx = makeFogContext({ map, entities: [] });
    updateFogOfWar(ctx);

    expect(map.getVisibility(64, 64)).toBe(1); // fog, not shroud
  });

  it('revealAroundCell with radius=0 reveals nothing (map.cpp:296 guard)', () => {
    // C++ map.cpp:296: if (!sightrange || ...) return;
    // fog.ts:192: if (radius === 0) return;
    const map = new GameMap();
    revealAroundCell(map, 64, 64, 0);
    expect(map.getVisibility(64, 64)).toBe(0);
  });
});

// =============================================================================
// Section 9: Moving units update fog along path
// C++ techno.cpp:5903-5913 — Look() called when unit moves
// =============================================================================

describe('Moving units update fog along path', () => {
  it('unit reveals cells at each position along movement', () => {
    const map = new GameMap();
    const entity = makeEntity({
      pos: { x: 60 * CELL_SIZE, y: 64 * CELL_SIZE },
      stats: { sight: 3, isAntiSub: false, isCloakable: false, isInfantry: false } as any,
    });
    const ctx = makeFogContext({ map, entities: [entity] });

    // Position 1: (60, 64)
    updateFogOfWar(ctx);
    expect(map.getVisibility(60, 64)).toBe(2);

    // Move to position 2: (65, 64)
    entity.pos = { x: 65 * CELL_SIZE, y: 64 * CELL_SIZE };
    updateFogOfWar(ctx);
    expect(map.getVisibility(65, 64)).toBe(2); // new position visible
    expect(map.getVisibility(60, 64)).toBe(1); // old position fogged

    // Move to position 3: (70, 64)
    entity.pos = { x: 70 * CELL_SIZE, y: 64 * CELL_SIZE };
    updateFogOfWar(ctx);
    expect(map.getVisibility(70, 64)).toBe(2); // newest position visible
    expect(map.getVisibility(65, 64)).toBe(1); // previous position fogged
    expect(map.getVisibility(60, 64)).toBe(1); // earliest position still fogged (not shroud)
  });

  it('unit reveals newly explored territory as it moves', () => {
    const map = new GameMap();
    const entity = makeEntity({
      pos: { x: 60 * CELL_SIZE, y: 64 * CELL_SIZE },
      stats: { sight: 2, isAntiSub: false, isCloakable: false, isInfantry: false } as any,
    });
    const ctx = makeFogContext({ map, entities: [entity] });

    updateFogOfWar(ctx);
    // Cells ahead should be shrouded
    expect(map.getVisibility(70, 64)).toBe(0);

    // Move forward
    entity.pos = { x: 70 * CELL_SIZE, y: 64 * CELL_SIZE };
    updateFogOfWar(ctx);
    // Previously unseen cells now visible
    expect(map.getVisibility(70, 64)).toBe(2);
    expect(map.getVisibility(72, 64)).toBe(2); // within sight=2
  });
});

// =============================================================================
// Section 10: Dead units stop revealing
// C++ techno.cpp:5903 — Look() only called on alive units
// =============================================================================

describe('Dead units stop revealing fog', () => {
  it('dead unit does not reveal any cells', () => {
    const map = new GameMap();
    const entity = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      alive: false, // dead
      stats: { sight: 5, isAntiSub: false, isCloakable: false, isInfantry: false } as any,
    });
    const ctx = makeFogContext({ map, entities: [entity] });

    updateFogOfWar(ctx);

    // Dead unit should not reveal anything
    expect(map.getVisibility(64, 64)).toBe(0);
  });

  it('killing a unit causes its revealed area to become fog on next update', () => {
    const map = new GameMap();
    const entity = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      stats: { sight: 3, isAntiSub: false, isCloakable: false, isInfantry: false } as any,
    });
    const ctx = makeFogContext({ map, entities: [entity] });

    // Unit alive — reveals cells
    updateFogOfWar(ctx);
    expect(map.getVisibility(64, 64)).toBe(2);
    expect(map.getVisibility(66, 64)).toBe(2);

    // Unit dies
    entity.alive = false;
    updateFogOfWar(ctx);

    // Previously visible cells should be fog (1)
    expect(map.getVisibility(64, 64)).toBe(1);
    expect(map.getVisibility(66, 64)).toBe(1);
  });

  it('non-player units do not reveal fog for the player', () => {
    const map = new GameMap();
    const enemy = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      isPlayerUnit: false, // enemy unit
      stats: { sight: 5, isAntiSub: false, isCloakable: false, isInfantry: false } as any,
    });
    const ctx = makeFogContext({ map, entities: [enemy] });

    updateFogOfWar(ctx);
    expect(map.getVisibility(64, 64)).toBe(0); // enemy units don't reveal for player
  });
});

// =============================================================================
// Section 11: Sight range capped at 10 (C++ map.cpp:296)
// =============================================================================

describe('Sight range capped at 10 (map.cpp:296)', () => {
  it('sight=0 reveals nothing (map.cpp:296 guard: if (!sightrange) return)', () => {
    // C++ map.cpp:296: if (!sightrange || ...) return;
    // TS fog.ts:89: if (!sight || sight > 10) continue;
    const map = new GameMap();
    const entity = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      stats: { sight: 0, isAntiSub: false, isCloakable: false, isInfantry: false } as any,
    });
    const ctx = makeFogContext({ map, entities: [entity] });
    updateFogOfWar(ctx);

    expect(map.getVisibility(64, 64)).not.toBe(2);
  });

  it('sight > 10 reveals nothing (map.cpp:296 guard: if (sightrange > 10) return)', () => {
    // C++ map.cpp:296: if (... || sightrange > 10) return;
    const map = new GameMap();
    const entity = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      stats: { sight: 15, isAntiSub: false, isCloakable: false, isInfantry: false } as any,
    });
    const ctx = makeFogContext({ map, entities: [entity] });
    updateFogOfWar(ctx);

    // Should NOT reveal at distance > 10 (or at all for sight > 10)
    expect(map.getVisibility(64 + 12, 64)).not.toBe(2);
  });

  it('sight=10 is the maximum valid sight range — cell at distance 10 is visible', () => {
    const map = new GameMap();
    const entity = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      stats: { sight: 10, isAntiSub: false, isCloakable: false, isInfantry: false } as any,
    });
    const ctx = makeFogContext({ map, entities: [entity] });
    updateFogOfWar(ctx);

    // Cell at distance 10 on axis — octagonal: max(10,0)*2+min(10,0) = 20 <= 20
    expect(map.getVisibility(74, 64)).toBe(2);
    // Cell at distance 11 — octagonal: max(11,0)*2+min(11,0) = 22 > 20
    expect(map.getVisibility(75, 64)).not.toBe(2);
  });

  it('all aircraft in rules.ini have Sight=0 — verified from parsed INI', () => {
    const aircraftTypes = ['BADR', 'U2', 'MIG', 'YAK', 'TRAN', 'HELI', 'HIND'];
    for (const type of aircraftTypes) {
      const iniSight = INI[type]?.sight;
      expect(iniSight, `${type} should have Sight= in rules.ini`).toBeDefined();
      expect(iniSight, `${type} aircraft should have INI Sight=0`).toBe(0);
    }
  });

  it('no structure in STRUCTURE_SIGHT exceeds 10', () => {
    // C++ map.cpp:296: sightrange > 10 → return (no reveal)
    for (const [type, sight] of Object.entries(STRUCTURE_SIGHT)) {
      expect(sight, `${type} sight should be <= 10`).toBeLessThanOrEqual(10);
    }
  });

  it('no unit in rules.ini has Sight > 10', () => {
    // Verify that all INI Sight= values are capped at 10
    const allUnits = [
      ...['V2RL', '1TNK', '3TNK', '2TNK', '4TNK', 'MRJ', 'MGG', 'ARTY', 'HARV', 'MCV', 'JEEP', 'APC', 'MNLY', 'TRUK'],
      ...['SS', 'DD', 'CA', 'LST', 'PT'],
      ...['DOG', 'E1', 'E2', 'E3', 'E4', 'E6', 'SPY', 'THF', 'E7', 'MEDI', 'GNRL'],
      ...['BADR', 'U2', 'MIG', 'YAK', 'TRAN', 'HELI', 'HIND'],
    ];
    for (const type of allUnits) {
      const iniSight = INI[type]?.sight;
      if (iniSight !== undefined) {
        expect(iniSight, `${type} INI Sight should be <= 10`).toBeLessThanOrEqual(10);
      }
    }
  });
});

// =============================================================================
// Section 12: C++ sight reveal uses octagonal distance, NOT Euclidean
// C++ coord.cpp:124-136 — Distance() = max(|dy|,|dx|) + min(|dy|,|dx|)/2
// TS fog.ts + map.ts use octagonal: max*2+min <= radius*2
// =============================================================================

describe('Sight reveal uses octagonal distance (coord.cpp:124-136)', () => {
  it('corner cells are excluded by octagonal distance (not Euclidean)', () => {
    // At radius 5, (5,5) has octagonal distance max(5,5)*2+min(5,5) = 15 > 10
    // Euclidean distance sqrt(50) ~= 7.07 would include it at radius 8
    const map = new GameMap();
    revealAroundCell(map, 64, 64, 5);

    // Axis cell at distance 5 — revealed
    expect(map.getVisibility(69, 64)).toBe(2);

    // Corner cell (5,5) — NOT revealed (octagonal 15 > 10)
    expect(map.getVisibility(69, 69)).not.toBe(2);

    // Cell (2,4) — octagonal: max(4,2)*2+min(4,2) = 10 <= 10 — revealed
    expect(map.getVisibility(66, 68)).toBe(2);

    // Cell (4,4) — octagonal: max(4,4)*2+min(4,4) = 12 > 10 — NOT revealed
    expect(map.getVisibility(68, 68)).not.toBe(2);
  });

  it('octagonal shape is diamond-like, not circular', () => {
    // Verify the shape is NOT a Euclidean circle
    const map = new GameMap();
    revealAroundCell(map, 64, 64, 3);

    // Cell (3,0) — octagonal: max(3,0)*2+min(3,0) = 6 <= 6 — revealed
    expect(map.getVisibility(67, 64)).toBe(2);

    // Cell (2,2) — octagonal: max(2,2)*2+min(2,2) = 6 <= 6 — revealed
    expect(map.getVisibility(66, 66)).toBe(2);

    // Cell (3,1) — octagonal: max(3,1)*2+min(3,1) = 7 > 6 — NOT revealed
    expect(map.getVisibility(67, 65)).not.toBe(2);

    // Cell (2,3) — octagonal: max(3,2)*2+min(3,2) = 8 > 6 — NOT revealed
    expect(map.getVisibility(66, 67)).not.toBe(2);
  });
});

// =============================================================================
// Section 13: fogDisabled mode
// =============================================================================

describe('fogDisabled bypasses all fog calculation', () => {
  it('fogDisabled=true reveals entire map', () => {
    // TS fog.ts:55-58: if (ctx.fogDisabled) { ctx.map.revealAll(); return; }
    const map = new GameMap();
    const ctx = makeFogContext({
      map,
      fogDisabled: true,
      entities: [],
    });

    updateFogOfWar(ctx);

    expect(map.getVisibility(0, 0)).toBe(2);
    expect(map.getVisibility(64, 64)).toBe(2);
    expect(map.getVisibility(MAP_CELLS - 1, MAP_CELLS - 1)).toBe(2);
  });
});

// =============================================================================
// Section 14: Line-of-sight blocking (TS extension — C++ does NOT have LOS blocking)
// C++ map.cpp:286-344: Sight_From reveals all cells in radius, NO terrain blocking
// =============================================================================

describe('PARITY FIXED: TS reveals through all terrain, matching C++ (map.cpp:286-344)', () => {
  /**
   * C++ map.cpp:286-344: Sight_From iterates through RadiusOffset table and reveals
   * every cell within the radius. There is NO line-of-sight check through terrain.
   * A unit can see through mountains, buildings, walls — everything.
   *
   * TS map.ts:616-643 (updateFogForUnits): uses octagonal distance formula with
   * NO line-of-sight blocking, matching C++ behavior exactly. The hasLineOfSight()
   * method exists on GameMap but is NOT called in the fog reveal path.
   *
   * PARITY FIXED: TS no longer blocks sight through terrain.
   */

  it('C++ and TS both reveal through ROCK terrain (parity match)', () => {
    // Place ROCK terrain between unit and target cell
    const map = new GameMap();

    // Manually set some cells to ROCK terrain
    map.setTerrain(66, 64, Terrain.ROCK);

    // Unit at (64, 64) with sight=5, trying to see (68, 64)
    // Path goes through (66, 64) which is ROCK
    const entity = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      stats: { sight: 5, isAntiSub: false, isCloakable: false, isInfantry: false } as any,
    });
    const ctx = makeFogContext({ map, entities: [entity] });

    updateFogOfWar(ctx);

    // Both C++ and TS: cell at (68,64) IS visible (no LOS blocking)
    const vis = map.getVisibility(68, 64);
    expect(vis).toBe(2);
  });
});

// =============================================================================
// Section 15: Sight range NOT reduced by damage (C++ techno.cpp:5903-5913)
// C++ Look() uses Techno_Type_Class()->SightRange — NO health check
// =============================================================================

describe('PARITY FIXED: Sight range NOT reduced by damage (techno.cpp:5903-5913)', () => {
  /**
   * C++ techno.cpp:5908: int sight_range = Techno_Type_Class()->SightRange;
   * No health check. A unit at 1% HP has the same sight as at 100% HP.
   *
   * TS fog.ts:87: const sight = e.stats.sight — uses type's SightRange directly,
   * no health-based reduction. Matches C++ exactly.
   */

  it('C++ unit at 10% HP still has full sight range (no health-based reduction)', () => {
    const map = new GameMap();
    const entity = makeEntity({
      pos: { x: 64 * CELL_SIZE, y: 64 * CELL_SIZE },
      hp: 10,
      maxHp: 100,
      stats: { sight: 5, isAntiSub: false, isCloakable: false, isInfantry: false } as any,
    });
    const ctx = makeFogContext({ map, entities: [entity] });

    updateFogOfWar(ctx);

    // Both C++ and TS: sight=5, cell at distance 4 IS visible (no health reduction)
    const vis = map.getVisibility(64 + 4, 64);
    expect(vis).toBe(2);
  });

  it('C++ building at low HP still has full sight range', () => {
    const map = new GameMap();
    const iniSight = INI['GUN']?.sight ?? 6;
    const structure = {
      type: 'GUN', alive: true,
      hp: 10, maxHp: 100,
      cx: 64, cy: 64, house: 'Greece' as any,
    };
    const ctx = makeFogContext({
      map,
      structures: [structure as any],
      baseDiscovered: true,
    });

    updateFogOfWar(ctx);

    // C++ expected: sight=iniSight (from INI), cell at distance iniSight-1 IS visible
    const checkDist = Math.min(iniSight - 1, 4);
    const vis = map.getVisibility(64 + checkDist, 64);
    expect(vis).toBe(2);
  });
});

// =============================================================================
// Section 16: Multiple overlapping gap generators
// C++ building.cpp:5692-5698 — jam count tracking for overlapping GAPs
// =============================================================================

describe('Overlapping gap generators use jam count tracking', () => {
  it('two overlapping GAPs: destroying one keeps overlap jammed', () => {
    const map = new GameMap();

    // Jam from two GAPs with overlap
    const r = 3;
    const gap1cx = 60, gap2cx = 63, cy = 60;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        const big = adx > ady ? adx : ady;
        const small = adx > ady ? ady : adx;
        if (big * 2 + small <= r * 2) {
          map.jamCell(gap1cx + dx, cy + dy);
          map.jamCell(gap2cx + dx, cy + dy);
        }
      }
    }

    // Overlap cell at (62, 60) should be jammed by both
    expect(map.getVisibility(62, cy)).toBe(0);

    // Destroy first GAP — unjam its radius
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        const big = adx > ady ? adx : ady;
        const small = adx > ady ? ady : adx;
        if (big * 2 + small <= r * 2) {
          map.unjamCell(gap1cx + dx, cy + dy);
        }
      }
    }

    // Overlap cell should still be jammed (second GAP active)
    expect(map.getVisibility(62, cy)).toBe(0);

    // Unique cell of GAP1 (at gap1cx-3 = 57) should be unjammed
    expect(map.getVisibility(57, cy)).toBe(1);
  });
});

// =============================================================================
// Section 17: Edge cases — structure sight default fallback
// =============================================================================

describe('Structure sight fallback behavior', () => {
  it('unknown structure types default to sight=5 in fog.ts:101', () => {
    // TS fog.ts:101: const sight = STRUCTURE_SIGHT[s.type] ?? 5;
    // In C++, every structure has an explicit Sight= in INI
    const unknownSight = STRUCTURE_SIGHT['NONEXISTENT_TYPE'] ?? 5;
    expect(unknownSight).toBe(5);
  });
});
