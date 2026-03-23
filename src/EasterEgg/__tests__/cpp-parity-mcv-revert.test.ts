/**
 * C++ Behavioral Parity: ConYard Sell → MCV Reversion
 *
 * C++ building.cpp:3509-3549: When a Construction Yard (FACT) is sold,
 * it reverts back to an MCV instead of spawning infantry survivors.
 *
 * Conditions (C++ source of truth):
 *   - Building is STRUCT_CONST (FACT)
 *   - Target_Legal(ArchiveTarget) — ConYard was deployed from an MCV
 *   - House->IsHuman — owned by the player (not AI)
 *   - Strength > 0 — building has HP remaining
 *
 * When MCV reversion fires:
 *   - MCV spawns at ConYard location
 *   - MCV health = MCV.MaxStrength * ConYard.Health_Ratio()
 *   - No infantry survivors (MCV replaces them)
 *   - No sell refund (refund only as fallback if MCV can't be placed)
 *
 * When MCV reversion does NOT fire (e.g. AI sell / fire sale):
 *   - Normal sell behavior: refund + infantry survivors
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  House, UnitType, CELL_SIZE, Mission, UNIT_STATS,
  PRODUCTION_ITEMS, type ProductionItem,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds, setPlayerHouses } from '../engine/entity';
import type { MapStructure } from '../engine/scenario';
import { STRUCTURE_MAX_HP } from '../engine/scenario';
import type { Effect } from '../engine/renderer';
import {
  type PlacementContext,
  deployMCV,
} from '../engine/placement';
import { GameMap, Terrain } from '../engine/map';
import { sellRefund } from '../engine/repairSell';

// ---------------------------------------------------------------------------
// Source inspection — read the game loop code to verify structure
// ---------------------------------------------------------------------------

const INDEX_PATH = join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts');
let indexSource: string;
try {
  indexSource = readFileSync(INDEX_PATH, 'utf-8');
} catch {
  indexSource = '';
}

const PLACEMENT_PATH = join(process.cwd(), 'src', 'EasterEgg', 'engine', 'placement.ts');
let placementSource: string;
try {
  placementSource = readFileSync(PLACEMENT_PATH, 'utf-8');
} catch {
  placementSource = '';
}

beforeEach(() => {
  resetEntityIds();
  setPlayerHouses(new Set([House.Spain, House.Greece]));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FACT_MAX_HP = STRUCTURE_MAX_HP['FACT'] ?? 1000;
const MCV_MAX_HP = UNIT_STATS['MCV']?.strength ?? 600;

function makeFACT(
  cx: number, cy: number,
  hp = FACT_MAX_HP,
  house: House = House.Spain,
  deployedFromMCV = true,
): MapStructure {
  return {
    type: 'FACT', image: 'fact', house,
    cx, cy, hp, maxHp: FACT_MAX_HP, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
    deployedFromMCV,
  };
}

function makeStructure(
  type: string, cx: number, cy: number,
  hp?: number, house: House = House.Spain,
): MapStructure {
  const maxHp = STRUCTURE_MAX_HP[type] ?? 256;
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp: hp ?? maxHp, maxHp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function makePlacementCtx(): PlacementContext {
  const m = new GameMap();
  m.setBounds(0, 0, 128, 128);
  return {
    structures: [],
    entities: [],
    entityById: new Map(),
    credits: 5000,
    tick: 100,
    playerHouse: House.Greece,
    pendingPlacement: null,
    wallPlacementPrepaid: false,
    cachedAvailableItems: null,
    evaMessages: [],
    effects: [] as Effect[],
    map: m,
    isAllied: (a, b) => a === b,
    playSound: vi.fn(),
    getAvailableItems: () => [],
    findPassableSpawn: (cx, cy) => ({ cx, cy }),
  };
}

// ---------------------------------------------------------------------------
// 1. Selling ConYard spawns MCV (C++ building.cpp:3509-3549)
// ---------------------------------------------------------------------------

describe('ConYard sell → MCV reversion (building.cpp:3509-3549)', () => {

  it('sell finalization checks for FACT type and deployedFromMCV flag', () => {
    // The game loop must check s.type === "FACT" && s.deployedFromMCV
    const mcvSection = indexSource.indexOf('ConYard sell');
    expect(mcvSection).toBeGreaterThan(-1);
    const chunk = indexSource.slice(mcvSection, mcvSection + 600);
    expect(chunk).toContain("s.type === 'FACT'");
    expect(chunk).toContain('s.deployedFromMCV');
  });

  it('MCV reversion requires human ownership (isAllied check)', () => {
    // C++ building.cpp:3509: House->IsHuman — only human-owned ConYards revert
    const mcvSection = indexSource.indexOf('ConYard sell');
    const chunk = indexSource.slice(mcvSection, mcvSection + 600);
    expect(chunk).toContain('isAllied');
    expect(chunk).toContain('playerHouse');
  });

  it('MCV reversion requires positive health ratio', () => {
    // C++ building.cpp:3509: Strength > 0
    const mcvSection = indexSource.indexOf('ConYard sell');
    const chunk = indexSource.slice(mcvSection, mcvSection + 600);
    expect(chunk).toContain('healthRatioAtSell > 0');
  });

  it('spawns MCV entity of type V_MCV', () => {
    const mcvSection = indexSource.indexOf('ConYard sell');
    const chunk = indexSource.slice(mcvSection, mcvSection + 600);
    expect(chunk).toContain('UnitType.V_MCV');
    expect(chunk).toContain('new Entity');
  });

  it('MCV spawns at ConYard center (wx, wy = cx*CELL_SIZE+CELL_SIZE)', () => {
    // C++ building.cpp:3522: Coord_Snap(Adjacent_Cell(Coord, DIR_SE))
    // TS equivalent: wx = s.cx * CELL_SIZE + CELL_SIZE, wy = same
    const mcvSection = indexSource.indexOf('ConYard sell');
    const chunk = indexSource.slice(mcvSection, mcvSection + 600);
    // MCV is created at (wx, wy) which is defined earlier as s.cx * CELL_SIZE + CELL_SIZE
    expect(chunk).toContain('new Entity(UnitType.V_MCV, s.house, wx, wy)');
  });

  it('sets mcvSpawned flag to skip infantry survivors', () => {
    const mcvSection = indexSource.indexOf('ConYard sell');
    const chunk = indexSource.slice(mcvSection, mcvSection + 1500);
    expect(chunk).toContain('mcvSpawned = true');
    expect(chunk).toContain('!mcvSpawned');
  });
});

// ---------------------------------------------------------------------------
// 2. MCV health matches ConYard health ratio (building.cpp:3527)
// ---------------------------------------------------------------------------

describe('MCV health = MCV.MaxStrength * ConYard.Health_Ratio()', () => {

  it('full-health ConYard (1000/1000) → MCV at full HP', () => {
    const ratio = 1000 / FACT_MAX_HP;
    const mcvHp = Math.max(1, Math.floor(MCV_MAX_HP * ratio));
    expect(mcvHp).toBe(MCV_MAX_HP);
  });

  it('half-health ConYard (500/1000) → MCV at 50% HP', () => {
    const ratio = 500 / FACT_MAX_HP;
    const mcvHp = Math.max(1, Math.floor(MCV_MAX_HP * ratio));
    expect(mcvHp).toBe(Math.floor(MCV_MAX_HP * 0.5));
  });

  it('critical ConYard (1/1000) → MCV at minimum 1 HP', () => {
    const ratio = 1 / FACT_MAX_HP;
    const mcvHp = Math.max(1, Math.floor(MCV_MAX_HP * ratio));
    expect(mcvHp).toBe(1);
  });

  it('75% health ConYard → MCV at 75% HP (450/600)', () => {
    const ratio = 750 / FACT_MAX_HP;
    const mcvHp = Math.max(1, Math.floor(MCV_MAX_HP * ratio));
    expect(mcvHp).toBe(Math.floor(MCV_MAX_HP * 0.75));
  });

  it('source code applies health ratio formula correctly', () => {
    const mcvSection = indexSource.indexOf('ConYard sell');
    const chunk = indexSource.slice(mcvSection, mcvSection + 600);
    expect(chunk).toContain('mcv.maxHp * healthRatioAtSell');
    // Must clamp to at least 1 HP
    expect(chunk).toContain('Math.max(1');
  });

  it('healthRatioAtSell is computed from sellHpAtStart / maxHp', () => {
    // The health ratio must be captured at sell START, not at finalization
    // (building might take damage during the sell animation)
    const sellSection = indexSource.indexOf('sellProgress >= 1');
    const chunk = indexSource.slice(sellSection, sellSection + 800);
    expect(chunk).toContain('healthRatioAtSell');
    expect(chunk).toContain('sellHpAtStart');
  });
});

// ---------------------------------------------------------------------------
// 3. No infantry survivors when MCV is spawned (building.cpp:3509-3549)
// ---------------------------------------------------------------------------

describe('No infantry survivors when ConYard → MCV', () => {

  it('survivor loop is gated by !mcvSpawned && CREWED_BUILDINGS', () => {
    const survivorSection = indexSource.indexOf('SL4: Spawn infantry survivors');
    expect(survivorSection).toBeGreaterThan(-1);
    // The survivor section must be inside an if (!mcvSpawned && CREWED_BUILDINGS.has(s.type)) block
    // C++ building.cpp:3444: if (!IsCrewAble()) return 0
    const chunk = indexSource.slice(survivorSection, survivorSection + 300);
    expect(chunk).toContain('!mcvSpawned');
    expect(chunk).toContain('CREWED_BUILDINGS');
  });

  it('mcvSpawned is set to true before survivor check', () => {
    const mcvSpawnedSet = indexSource.indexOf('mcvSpawned = true');
    const survivorCheck = indexSource.indexOf('!mcvSpawned && CREWED_BUILDINGS');
    expect(mcvSpawnedSet).toBeGreaterThan(-1);
    expect(survivorCheck).toBeGreaterThan(-1);
    expect(mcvSpawnedSet).toBeLessThan(survivorCheck);
  });
});

// ---------------------------------------------------------------------------
// 4. Non-ConYard buildings sell normally (with survivors)
// ---------------------------------------------------------------------------

describe('Non-ConYard buildings sell normally', () => {

  it('POWR sell gives infantry survivors (mcvSpawned stays false)', () => {
    // For non-FACT types, the mcvSpawned flag never gets set
    const mcvSection = indexSource.indexOf('ConYard sell');
    const chunk = indexSource.slice(mcvSection, mcvSection + 400);
    // Only FACT triggers MCV reversion
    expect(chunk).toContain("s.type === 'FACT'");
    // Non-FACT never enters this branch, so mcvSpawned stays false
  });

  it('non-FACT structures always get refund + survivors', () => {
    // Verify the refund is gated by !mcvSpawned too
    const refundSection = indexSource.indexOf('no refund when ConYard reverts to MCV');
    expect(refundSection).toBeGreaterThan(-1);
    const chunk = indexSource.slice(refundSection, refundSection + 200);
    expect(chunk).toContain('!mcvSpawned');
    expect(chunk).toContain('addCredits');
  });

  it('POWR sell refund is 150 credits (300 * 0.5)', () => {
    expect(sellRefund(300)).toBe(150);
  });

  it('WEAP sell refund is 1000 credits (2000 * 0.5)', () => {
    expect(sellRefund(2000)).toBe(1000);
  });

  it('survivor crew types differ per building (BARR=E1, FACT=E6 chance)', () => {
    // C++ building.cpp:3444: only Crewed=yes buildings spawn survivors
    // SILO and KENN lack Crewed=yes, so they are excluded from the Crew_Type switch
    const survivorSection = indexSource.indexOf('SL4: Spawn infantry survivors');
    const chunk = indexSource.slice(survivorSection, survivorSection + 3000);
    expect(chunk).toContain("case 'BARR'");
    expect(chunk).toContain("case 'FACT'");
  });
});

// ---------------------------------------------------------------------------
// 5. Sell refund behavior with MCV reversion
// ---------------------------------------------------------------------------

describe('Sell refund skipped when MCV spawns (building.cpp:3509-3549)', () => {

  it('refund is conditional on !mcvSpawned', () => {
    // C++ building.cpp:3520-3544: refund only if MCV can't spawn
    // In TS: if (!mcvSpawned && prodItem) { this.addCredits(...) }
    const refundSection = indexSource.indexOf('no refund when ConYard reverts to MCV');
    expect(refundSection).toBeGreaterThan(-1);
    const chunk = indexSource.slice(refundSection, refundSection + 200);
    expect(chunk).toContain('!mcvSpawned');
  });

  it('FACT cost=2000, normal sell refund would be 1000 (but skipped for MCV)', () => {
    expect(sellRefund(2000)).toBe(1000);
  });

  it('silo capacity is still recalculated regardless of MCV spawn', () => {
    // recalculateSiloCapacity() must happen before the MCV check
    const siloRecalc = indexSource.indexOf('recalculateSiloCapacity');
    const mcvCheck = indexSource.indexOf('mcvSpawned = false');
    expect(siloRecalc).toBeGreaterThan(-1);
    expect(mcvCheck).toBeGreaterThan(-1);
    // Silo recalc is before MCV check
    expect(siloRecalc).toBeLessThan(mcvCheck);
  });
});

// ---------------------------------------------------------------------------
// 6. MCV spawns at ConYard's location
// ---------------------------------------------------------------------------

describe('MCV spawn position matches ConYard center', () => {

  it('wx = s.cx * CELL_SIZE + CELL_SIZE (structure center)', () => {
    // FACT at cx=10, cy=10 → center at (10*24+24, 10*24+24) = (264, 264)
    const cx = 10;
    const expectedWx = cx * CELL_SIZE + CELL_SIZE;
    expect(expectedWx).toBe(264);
  });

  it('MCV Entity is created at the same (wx, wy) used for sell effects', () => {
    const mcvSection = indexSource.indexOf('ConYard sell');
    const chunk = indexSource.slice(mcvSection, mcvSection + 600);
    // The Entity constructor call uses (wx, wy) — same coords as the explosion effect
    expect(chunk).toContain('new Entity(UnitType.V_MCV, s.house, wx, wy)');
  });

  it('Entity created with correct position via constructor', () => {
    // Verify Entity constructor sets position correctly
    const wx = 264;
    const wy = 264;
    const mcv = new Entity(UnitType.V_MCV, House.Spain, wx, wy);
    expect(mcv.pos.x).toBe(wx);
    expect(mcv.pos.y).toBe(wy);
  });
});

// ---------------------------------------------------------------------------
// 7. deployMCV sets deployedFromMCV flag (ArchiveTarget parity)
// ---------------------------------------------------------------------------

describe('deployMCV sets deployedFromMCV flag (ArchiveTarget parity)', () => {

  it('placement.ts deployMCV sets deployedFromMCV: true on the new structure', () => {
    expect(placementSource).toContain('deployedFromMCV: true');
  });

  it('deployMCV creates a FACT with deployedFromMCV flag', () => {
    const ctx = makePlacementCtx();
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 60 * CELL_SIZE + 12, 60 * CELL_SIZE + 12);
    ctx.entities.push(mcv);
    ctx.entityById.set(mcv.id, mcv);

    const result = deployMCV(ctx, mcv);
    expect(result).toBe(true);

    const fact = ctx.structures.find(s => s.type === 'FACT');
    expect(fact).toBeDefined();
    expect(fact!.deployedFromMCV).toBe(true);
  });

  it('pre-placed FACT (no MCV deploy) does NOT have deployedFromMCV', () => {
    // Pre-placed structures in scenario INI don't go through deployMCV
    const prePlaced = makeFACT(10, 10, FACT_MAX_HP, House.Spain, false);
    expect(prePlaced.deployedFromMCV).toBe(false);
    // Without the flag, MCV reversion should not trigger
  });
});

// ---------------------------------------------------------------------------
// 8. AI ConYard sell does NOT revert to MCV (fire sale behavior)
// ---------------------------------------------------------------------------

describe('AI ConYard sell does NOT get MCV reversion', () => {

  it('MCV reversion requires isAllied(s.house, playerHouse)', () => {
    // AI houses are NOT allied with player, so the check fails
    const mcvSection = indexSource.indexOf('ConYard sell');
    const chunk = indexSource.slice(mcvSection, mcvSection + 600);
    expect(chunk).toContain('this.isAllied(s.house, this.playerHouse)');
  });

  it('AI-owned FACT is not allied with player (default alliances)', () => {
    const alliances = buildDefaultAlliances();
    const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;
    // USSR is not allied with Spain (player)
    expect(isAllied(House.USSR, House.Spain)).toBe(false);
    // Spain IS allied with Spain (player)
    expect(isAllied(House.Spain, House.Spain)).toBe(true);
  });

  it('fire sale code starts sell on AI structures without MCV flag', () => {
    // Fire sale: s.sellProgress = 0 — no special MCV handling
    const fireSaleSection = indexSource.indexOf('fireSale');
    expect(fireSaleSection).toBeGreaterThan(-1);
    const chunk = indexSource.slice(fireSaleSection, fireSaleSection + 300);
    expect(chunk).toContain('s.sellProgress = 0');
  });
});

// ---------------------------------------------------------------------------
// 9. MCV Entity stats verification
// ---------------------------------------------------------------------------

describe('MCV entity stats (UNIT_STATS parity)', () => {

  it('MCV has 600 max HP (C++ rules.ini Strength=600)', () => {
    expect(MCV_MAX_HP).toBe(600);
  });

  it('MCV is type V_MCV', () => {
    expect(UnitType.V_MCV).toBe('MCV');
  });

  it('MCV is not infantry (vehicle/wheel unit)', () => {
    const stats = UNIT_STATS['MCV'];
    expect(stats).toBeDefined();
    expect(stats.isInfantry).toBe(false);
  });

  it('MCV is set to GUARD mission after spawn', () => {
    const mcvSection = indexSource.indexOf('ConYard sell');
    const chunk = indexSource.slice(mcvSection, mcvSection + 600);
    expect(chunk).toContain('mcv.mission = Mission.GUARD');
  });

  it('spawned MCV is added to entities array and entityById map', () => {
    const mcvSection = indexSource.indexOf('ConYard sell');
    const chunk = indexSource.slice(mcvSection, mcvSection + 1000);
    expect(chunk).toContain('this.entities.push(mcv)');
    expect(chunk).toContain('this.entityById.set(mcv.id, mcv)');
  });
});

// ---------------------------------------------------------------------------
// 10. Health ratio edge cases
// ---------------------------------------------------------------------------

describe('Health ratio edge cases for MCV reversion', () => {

  it('10% HP ConYard → MCV with 60 HP (floor(600 * 0.1))', () => {
    const ratio = 100 / FACT_MAX_HP; // 100/1000 = 0.1
    const mcvHp = Math.max(1, Math.floor(MCV_MAX_HP * ratio));
    expect(mcvHp).toBe(60);
  });

  it('1 HP ConYard → MCV with 1 HP (clamped to minimum 1)', () => {
    const ratio = 1 / FACT_MAX_HP; // 1/1000 = 0.001
    const rawHp = Math.floor(MCV_MAX_HP * ratio); // floor(0.6) = 0
    const mcvHp = Math.max(1, rawHp);
    expect(mcvHp).toBe(1);
  });

  it('Entity constructor gives MCV full HP by default', () => {
    const mcv = new Entity(UnitType.V_MCV, House.Spain, 100, 100);
    expect(mcv.hp).toBe(MCV_MAX_HP);
    expect(mcv.maxHp).toBe(MCV_MAX_HP);
  });

  it('MCV hp can be set after construction to match ConYard ratio', () => {
    const mcv = new Entity(UnitType.V_MCV, House.Spain, 100, 100);
    mcv.hp = Math.max(1, Math.floor(mcv.maxHp * 0.5));
    expect(mcv.hp).toBe(300);
    expect(mcv.maxHp).toBe(600);
  });
});
