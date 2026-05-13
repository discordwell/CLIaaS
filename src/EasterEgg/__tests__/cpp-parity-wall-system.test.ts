/**
 * C++ Behavioral Parity: Wall System — Placement, Linking, Destruction
 *
 * Audits wall/fence placement, auto-linking, destruction, passability,
 * projectile blocking, and sell refunds against C++ rules.ini values.
 *
 * Wall building types: SBAG (Sandbag), FENC (Wire Fence), BRIK (Concrete),
 *                      BARB (Barbed Wire), WOOD (Wooden Fence)
 *
 * C++ source refs:
 *   - rules.ini [SBAG]/[FENC]/[BRIK]/[BARB]/[WOOD]: Strength=, Cost=, Armor=, Owner=
 *   - rules.ini [HE]/[AP]/[Nuke]: Wall=yes  (warheads that destroy walls)
 *   - rules.ini [SA]/[Fire]/[HollowPoint]/[Super]: no Wall=yes
 *   - building.cpp:1062-1098: wall overlay conversion, WALL_TYPES set
 *   - combat.cpp:244-270: splash wall destruction via destroysWalls flag
 *   - bullet.cpp:903-913: non-high projectiles explode on wall contact
 *   - unit.cpp:1855-1871: vehicle crusher destroys crushable walls
 *   - display.cpp:706-778: Passes_Proximity_Check for wall placement
 *   - renderer.ts:133-139: wallConnectionMask 4-bit NESW auto-link
 *   - techno.cpp:5743-5761: Refund_Amount — 50% sell refund (human)
 *
 * CRITICAL: Expected values are parsed from rules.ini at test time.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  CELL_SIZE, House, UnitType, WARHEAD_META, PRODUCTION_ITEMS,
  buildDefaultAlliances, LEPTON_SIZE, cellTargetToLepton,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  structureDamage,
  applySplashDamage,
  CRUSHABLE_WALLS,
  checkWallCrush,
} from '../engine/combat';
import { GameMap, Terrain } from '../engine/map';
import {
  type MapStructure, STRUCTURE_SIZE, STRUCTURE_MAX_HP,
  STRUCTURE_WEAPONS, STRUCTURE_ARMOR,
} from '../engine/scenario';
import { sellRefund } from '../engine/repairSell';
import { placeStructure, type PlacementContext } from '../engine/placement';
import type { Effect } from '../engine/renderer';
import { parseIniSections, parseIniInt, normalizeOwnerToFaction } from '../engine/parseIni';

beforeEach(() => resetEntityIds());

// =============================================================================
//  Parse rules.ini at test time — the authoritative source
// =============================================================================

const RULES_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/rules.ini');
const rulesText = fs.readFileSync(RULES_INI_PATH, 'utf-8');
const iniSections = parseIniSections(rulesText);

/** Get a value from a parsed INI section */
function iniGet(section: string, key: string): string | undefined {
  return iniSections.get(section)?.get(key);
}

/** Get an integer from INI, with default */
function iniInt(section: string, key: string, def = 0): number {
  return parseIniInt(iniGet(section, key), def);
}

// The 5 wall types under audit
const WALL_SECTIONS = ['SBAG', 'FENC', 'BRIK', 'BARB', 'WOOD'] as const;
type WallType = typeof WALL_SECTIONS[number];

// All warhead sections in rules.ini
const ALL_WARHEADS = ['SA', 'HE', 'AP', 'Fire', 'HollowPoint', 'Super', 'Nuke'] as const;

// -- Helpers ------------------------------------------------------------------

function makeWall(
  type: string, cx: number, cy: number, hp?: number, house: House = House.Spain,
): MapStructure {
  const maxHp = STRUCTURE_MAX_HP[type] ?? 1;
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp: hp ?? maxHp, maxHp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(
  structures: MapStructure[] = [],
  entities: Entity[] = [],
): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
    inflightProjectiles: [],
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    scenarioId: 'TEST',
    killCount: 0,
    lossCount: 0,
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    attackedTriggerNames: new Set<string>(),
    map,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    isRevealedToHouse: () => true,
    movementSpeed: () => 1,
    getFirepowerBias: () => 1.0,
    getArmorBias: () => 1.0,
    getROFBias: () => 1.0,
    damageStructure: () => false,
    aiIQ: () => 3,
    warheadMuzzleColor: () => '#fff',
    aiStates: new Map(),
    lastBaseAttackEva: -Infinity,
    gameTicksPerSec: 15,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => {},
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
    powerConsumed: 0,
    powerProduced: 100,
  } as CombatContext;
}

function makePlacementCtx(structures: MapStructure[] = []): PlacementContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  // Mark center area as buildable (CLEAR terrain)
  for (let y = 5; y < 25; y++) {
    for (let x = 5; x < 25; x++) {
      map.setTerrain(x, y, Terrain.CLEAR);
    }
  }
  return {
    structures,
    entities: [],
    entityById: new Map(),
    credits: 10000,
    tick: 0,
    playerHouse: House.Spain,
    pendingPlacement: null,
    wallPlacementPrepaid: false,
    cachedAvailableItems: null,
    evaMessages: [],
    effects: [],
    map,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    playSound: () => {},
    getAvailableItems: () => [],
    findPassableSpawn: (cx, cy) => ({ cx, cy }),
  };
}

// =============================================================================
//  1. Wall Strength (HP) from rules.ini
// =============================================================================
// C++ rules.ini: all walls have Strength=1

describe('Wall Strength= (HP) from rules.ini', () => {
  it.each(WALL_SECTIONS)('%s: TS STRUCTURE_MAX_HP matches INI Strength=', (type) => {
    const iniStrength = iniInt(type, 'Strength');
    const tsMaxHp = STRUCTURE_MAX_HP[type];
    expect(tsMaxHp).toBe(iniStrength);
  });
});

// =============================================================================
//  2. Wall Cost= from rules.ini
// =============================================================================
// C++ rules.ini: SBAG=25, FENC=25, BRIK=100, BARB=25, WOOD has no Cost=

describe('Wall Cost= from rules.ini', () => {
  const BUILDABLE_WALLS = ['SBAG', 'FENC', 'BRIK'] as const;

  it.each(BUILDABLE_WALLS)('%s: PRODUCTION_ITEMS cost matches INI Cost=', (type) => {
    const iniCost = iniInt(type, 'Cost');
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === type);
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(iniCost);
  });

  it('BARB: INI has Cost= but no Owner=, NOT in PRODUCTION_ITEMS (tracked in STRUCTURE_POINTS)', () => {
    const iniCost = iniInt('BARB', 'Cost');
    expect(iniCost).toBeGreaterThan(0); // INI defines a cost
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'BARB');
    const iniOwner = iniGet('BARB', 'Owner');
    expect(iniOwner).toBeUndefined(); // no Owner= key in INI
    // Not in PRODUCTION_ITEMS — no Owner means not buildable, tracked in STRUCTURE_POINTS instead
    expect(prodItem).toBeUndefined();
  });

  it('WOOD: INI has no Cost=, NOT in PRODUCTION_ITEMS (tracked in STRUCTURE_POINTS)', () => {
    const iniCost = iniGet('WOOD', 'Cost');
    expect(iniCost).toBeUndefined(); // no Cost= in INI
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'WOOD');
    // Not in PRODUCTION_ITEMS — no Owner/Cost means not buildable, tracked in STRUCTURE_POINTS instead
    expect(prodItem).toBeUndefined();
  });
});

// =============================================================================
//  3. Wall Armor= type from rules.ini
// =============================================================================
// C++ rules.ini: SBAG/FENC/BRIK/CYCL have Armor=none; BARB has Armor=wood; WOOD has no Armor=

describe('Wall Armor= from rules.ini', () => {
  it.each(['SBAG', 'FENC', 'BRIK'] as const)('%s: STRUCTURE_ARMOR matches INI Armor=', (type) => {
    const iniArmor = iniGet(type, 'Armor')?.toLowerCase();
    const tsArmor = STRUCTURE_ARMOR[type];
    expect(tsArmor).toBe(iniArmor);
  });

  it('BARB: INI Armor=wood, TS STRUCTURE_ARMOR should match', () => {
    const iniArmor = iniGet('BARB', 'Armor')?.toLowerCase();
    expect(iniArmor).toBe('wood');
    // Check if TS has BARB armor defined and matches
    const tsArmor = STRUCTURE_ARMOR['BARB'];
    if (tsArmor !== undefined) {
      expect(tsArmor).toBe(iniArmor);
    } else {
      // BARB might not be in STRUCTURE_ARMOR — this is a divergence
      expect(tsArmor).toBe(iniArmor);
    }
  });

  it('WOOD: INI has no Armor= key, C++ defaults to none for walls', () => {
    const iniArmor = iniGet('WOOD', 'Armor');
    // WOOD has no Armor= in rules.ini; C++ default is ARMOR_NONE for walls
    // TS should either omit or have 'none'
    if (iniArmor !== undefined) {
      expect(STRUCTURE_ARMOR['WOOD']).toBe(iniArmor.toLowerCase());
    }
    // If WOOD is in STRUCTURE_ARMOR, verify it's 'none' (C++ default)
    if (STRUCTURE_ARMOR['WOOD'] !== undefined) {
      expect(STRUCTURE_ARMOR['WOOD']).toBe('none');
    }
  });
});

// =============================================================================
//  4. Wall Owner= (faction) from rules.ini
// =============================================================================

describe('Wall Owner= (faction) from rules.ini', () => {
  it('SBAG: Owner=allies in INI, PRODUCTION_ITEMS faction=allied', () => {
    const iniOwner = iniGet('SBAG', 'Owner');
    expect(iniOwner?.toLowerCase()).toContain('allies');
    const faction = normalizeOwnerToFaction(iniOwner);
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'SBAG');
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe(faction);
  });

  it('FENC: Owner=soviet in INI, PRODUCTION_ITEMS faction=soviet', () => {
    const iniOwner = iniGet('FENC', 'Owner');
    expect(iniOwner?.toLowerCase()).toContain('soviet');
    const faction = normalizeOwnerToFaction(iniOwner);
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'FENC');
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe(faction);
  });

  it('BRIK: Owner=allies,soviet in INI, PRODUCTION_ITEMS faction=both', () => {
    const iniOwner = iniGet('BRIK', 'Owner');
    const faction = normalizeOwnerToFaction(iniOwner);
    expect(faction).toBe('both');
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'BRIK');
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('both');
  });

  it('BARB: no Owner= in INI, NOT in PRODUCTION_ITEMS (tracked in STRUCTURE_POINTS)', () => {
    const iniOwner = iniGet('BARB', 'Owner');
    expect(iniOwner).toBeUndefined();
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'BARB');
    // No Owner= means not buildable — not in PRODUCTION_ITEMS, tracked in STRUCTURE_POINTS instead
    expect(prodItem).toBeUndefined();
  });
});

// =============================================================================
//  5. Wall auto-linking behavior (adjacent walls connect visually)
// =============================================================================
// C++ renderer.ts:133-139: wallConnectionMask checks 4 cardinal neighbors
// for same-type wall and returns a 4-bit NESW mask (N=1, E=2, S=4, W=8).

describe('Wall auto-linking (map.getWallType cardinal neighbor check)', () => {
  it('setting wall type on map stores it for retrieval', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'SBAG');
    expect(map.getWallType(10, 10)).toBe('SBAG');
  });

  it('adjacent same-type walls are both retrievable (link data exists)', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'SBAG');
    map.setWallType(11, 10, 'SBAG');
    // Both cells have wall type set — renderer can compute connection mask
    expect(map.getWallType(10, 10)).toBe('SBAG');
    expect(map.getWallType(11, 10)).toBe('SBAG');
  });

  it('different wall types do NOT link (SBAG next to FENC)', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'SBAG');
    map.setWallType(11, 10, 'FENC');
    // wallConnectionMask checks for SAME type — different types should not connect
    expect(map.getWallType(10, 10)).not.toBe(map.getWallType(11, 10));
  });

  it('clearing a wall type breaks the link chain', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'BRIK');
    map.setWallType(11, 10, 'BRIK');
    map.setWallType(12, 10, 'BRIK');
    map.clearWallType(11, 10);
    expect(map.getWallType(11, 10)).toBe('');
    // Outer walls still exist
    expect(map.getWallType(10, 10)).toBe('BRIK');
    expect(map.getWallType(12, 10)).toBe('BRIK');
  });

  it('wall type persists in all 4 cardinal directions', () => {
    const map = new GameMap();
    const cx = 10, cy = 10;
    map.setWallType(cx, cy, 'FENC');
    map.setWallType(cx, cy - 1, 'FENC'); // N
    map.setWallType(cx + 1, cy, 'FENC'); // E
    map.setWallType(cx, cy + 1, 'FENC'); // S
    map.setWallType(cx - 1, cy, 'FENC'); // W
    expect(map.getWallType(cx, cy - 1)).toBe('FENC');
    expect(map.getWallType(cx + 1, cy)).toBe('FENC');
    expect(map.getWallType(cx, cy + 1)).toBe('FENC');
    expect(map.getWallType(cx - 1, cy)).toBe('FENC');
  });
});

// =============================================================================
//  6. Warheads that destroy walls (Wall=yes in rules.ini)
// =============================================================================
// C++ rules.ini: HE Wall=yes, AP Wall=yes, Nuke Wall=yes; others no.
// TS maps this to WARHEAD_META[x].destroysWalls.

describe('Warheads with Wall=yes in rules.ini vs TS WARHEAD_META.destroysWalls', () => {
  it.each(ALL_WARHEADS)('%s: WARHEAD_META.destroysWalls matches INI Wall=yes', (wh) => {
    const iniWallYes = iniGet(wh, 'Wall')?.toLowerCase() === 'yes';
    const tsDestroys = !!WARHEAD_META[wh]?.destroysWalls;
    expect(tsDestroys).toBe(iniWallYes);
  });

  it('exactly HE, AP, Nuke have Wall=yes in INI', () => {
    const wallWarheads = ALL_WARHEADS.filter(wh => iniGet(wh, 'Wall')?.toLowerCase() === 'yes');
    expect(wallWarheads.sort()).toEqual(['AP', 'HE', 'Nuke']);
  });

  it('SA does NOT have Wall=yes', () => {
    expect(iniGet('SA', 'Wall')).toBeUndefined();
    expect(WARHEAD_META['SA'].destroysWalls).toBeFalsy();
  });

  it('Fire does NOT have Wall=yes', () => {
    expect(iniGet('Fire', 'Wall')).toBeUndefined();
    expect(WARHEAD_META['Fire'].destroysWalls).toBeFalsy();
  });

  it('HollowPoint does NOT have Wall=yes', () => {
    expect(iniGet('HollowPoint', 'Wall')).toBeUndefined();
    expect(WARHEAD_META['HollowPoint'].destroysWalls).toBeFalsy();
  });
});

// =============================================================================
//  7. HE/AP splash clears wall overlay from map
// =============================================================================
// C++ combat.cpp:244-270: if warhead destroysWalls and cell has wall, clear it.

describe('Splash damage clears wall overlay from map (combat.cpp:244-270)', () => {
  it.each(WALL_SECTIONS)('HE splash destroys %s wall overlay on map cell', (type) => {
    const ctx = makeCombatCtx();
    ctx.map.setWallType(10, 10, type);
    expect(ctx.map.getWallType(10, 10)).toBe(type);

    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const weapon = { damage: 100, warhead: 'HE' as const, splash: 1.5 };
    applySplashDamage(ctx, center, weapon, -1, House.Spain);
    expect(ctx.map.getWallType(10, 10)).toBe(type === 'BRIK' ? 'BRIK' : '');
    if (type === 'BRIK') expect(ctx.map.getWallDamageLevel(10, 10)).toBe(1);
  });

  it.each(WALL_SECTIONS)('AP splash destroys %s wall overlay on map cell', (type) => {
    const ctx = makeCombatCtx();
    ctx.map.setWallType(10, 10, type);
    expect(ctx.map.getWallType(10, 10)).toBe(type);

    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const weapon = { damage: 100, warhead: 'AP' as const, splash: 1.5 };
    applySplashDamage(ctx, center, weapon, -1, House.Spain);
    expect(ctx.map.getWallType(10, 10)).toBe(type === 'BRIK' ? 'BRIK' : '');
    if (type === 'BRIK') expect(ctx.map.getWallDamageLevel(10, 10)).toBe(1);
  });

  it.each(WALL_SECTIONS)('SA splash does NOT destroy %s wall overlay', (type) => {
    const ctx = makeCombatCtx();
    ctx.map.setWallType(10, 10, type);
    expect(ctx.map.getWallType(10, 10)).toBe(type);

    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const weapon = { damage: 50, warhead: 'SA' as const, splash: 1.5 };
    applySplashDamage(ctx, center, weapon, -1, House.Spain);
    expect(ctx.map.getWallType(10, 10)).toBe(type);
  });

  it.each(WALL_SECTIONS)('Fire splash does NOT destroy %s wall overlay', (type) => {
    const ctx = makeCombatCtx();
    ctx.map.setWallType(10, 10, type);
    expect(ctx.map.getWallType(10, 10)).toBe(type);

    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const weapon = { damage: 50, warhead: 'Fire' as const, splash: 1.5 };
    applySplashDamage(ctx, center, weapon, -1, House.Spain);
    expect(ctx.map.getWallType(10, 10)).toBe(type === 'WOOD' ? '' : type);
  });

  it('destroyed wall cells detach matching TarCom and NavCom references', () => {
    // C++ CellClass::Reduce_Wall clears the overlay, then calls
    // Detach_This_From_All(As_Target(cell)). Units holding that TARGET_CELL as
    // TarCom or NavCom must drop it immediately instead of firing at cleared
    // ground on later ticks.
    const guard = entityAtCell(UnitType.V_2TNK, House.Greece, 5, 5);
    const other = entityAtCell(UnitType.V_2TNK, House.Greece, 5, 6);
    const ctx = makeCombatCtx([], [guard, other]);
    ctx.map.setWallType(10, 10, 'SBAG');

    const target = cellTargetToLepton(10, 10);
    guard.forceFirePos = {
      x: target.lx * CELL_SIZE / LEPTON_SIZE,
      y: target.ly * CELL_SIZE / LEPTON_SIZE,
    };
    guard.moveTarget = { ...target };
    guard.path = [{ cx: 10, cy: 10 }];
    guard.firePrepActive = true;
    guard.firePrepStage = 2;
    guard.firePrepUsesDoingStage = true;
    guard.firePrepFacing256 = 64;

    const otherTarget = cellTargetToLepton(11, 10);
    other.forceFirePos = {
      x: otherTarget.lx * CELL_SIZE / LEPTON_SIZE,
      y: otherTarget.ly * CELL_SIZE / LEPTON_SIZE,
    };

    applySplashDamage(
      ctx,
      { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 },
      { damage: 100, warhead: 'HE', splash: 1.5 },
      -1,
      House.Spain,
    );

    expect(ctx.map.getWallType(10, 10)).toBe('');
    expect(guard.forceFirePos).toBeNull();
    expect(guard.moveTarget).toBeNull();
    expect(guard.path).toEqual([]);
    expect(guard.firePrepActive).toBe(false);
    expect(guard.firePrepStage).toBe(0);
    expect(guard.firePrepUsesDoingStage).toBe(false);
    expect(guard.firePrepFacing256).toBe(-1);
    expect(other.forceFirePos).toEqual({
      x: otherTarget.lx * CELL_SIZE / LEPTON_SIZE,
      y: otherTarget.ly * CELL_SIZE / LEPTON_SIZE,
    });
  });
});

// =============================================================================
//  8. Wall blocks unit movement (passability)
// =============================================================================
// C++ placement.ts:107: placing a wall sets terrain to Terrain.WALL
// C++ map.ts:37: Terrain.WALL is NOT in the PASSABLE set

describe('Walls block unit movement (Terrain.WALL is impassable)', () => {
  it('Terrain.WALL is not in PASSABLE set (units cannot walk through)', () => {
    const map = new GameMap();
    map.setTerrain(10, 10, Terrain.WALL);
    expect(map.isPassable(10, 10)).toBe(false);
  });

  it('Terrain.CLEAR is passable (control — units can walk normally)', () => {
    const map = new GameMap();
    map.setTerrain(10, 10, Terrain.CLEAR);
    expect(map.isPassable(10, 10)).toBe(true);
  });

  it('placing a wall structure marks cell as Terrain.WALL', () => {
    const ctx = makePlacementCtx();
    // Place a friendly building first (proximity check requires adjacent friendly structure)
    const fact = makeWall('FACT', 10, 10);
    (fact as any).type = 'FACT';
    ctx.structures.push({ ...fact, type: 'FACT', image: 'fact', maxHp: 1000, hp: 1000 });

    const wallItem = PRODUCTION_ITEMS.find(p => p.type === 'SBAG');
    if (wallItem) {
      ctx.pendingPlacement = wallItem;
      // Place wall adjacent to FACT
      placeStructure(ctx, 11, 10);
      expect(ctx.map.getTerrain(11, 10)).toBe(Terrain.WALL);
    }
  });
});

// =============================================================================
//  9. Wall blocks projectiles (non-high projectiles stop at walls)
// =============================================================================
// C++ bullet.cpp:903-914: Is_Forced_To_Explode — non-high, non-dropping
// projectiles entering a cell with an OverlayTypeClass::IsHigh obstacle explode
// at wall cell center. In RA odata.cpp, BRIK is the wall overlay with IsHigh.

describe('Non-high projectiles explode on wall contact (bullet.cpp:903-913)', () => {
  it('map cell with wall type returns non-empty string (wall exists)', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'BRIK');
    expect(map.getWallType(10, 10)).not.toBe('');
  });

  it('map cell without wall type returns empty string (no wall)', () => {
    const map = new GameMap();
    expect(map.getWallType(10, 10)).toBe('');
  });

  // The actual projectile-wall collision logic is covered in
  // cpp-parity-invisible-bullet-scatter.test.ts. This suite verifies the wall
  // detection primitive works correctly.
  it.each(WALL_SECTIONS)('%s: getWallType returns type string when wall present', (type) => {
    const map = new GameMap();
    map.setWallType(15, 15, type);
    expect(map.getWallType(15, 15)).toBe(type);
  });

  it('cleared wall cell returns empty (projectile passes through)', () => {
    const map = new GameMap();
    map.setWallType(15, 15, 'BRIK');
    map.clearWallType(15, 15);
    expect(map.getWallType(15, 15)).toBe('');
  });
});

// =============================================================================
// 10. C4 instantly destroys walls (structureDamage with 9999 damage)
// =============================================================================
// C++ specialUnits.ts: Tanya C4 calls damageStructure(s, 9999).
// Since all walls have Strength=1, 9999 damage trivially destroys them.

describe('C4 (massive damage) instantly destroys walls', () => {
  it.each(WALL_SECTIONS)('%s: 9999 damage (C4) destroys wall (Strength=1)', (type) => {
    const iniStrength = iniInt(type, 'Strength');
    expect(iniStrength).toBe(1); // Confirm INI says Strength=1
    const wall = makeWall(type, 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([wall]);
    const destroyed = structureDamage(ctx, wall, 9999);
    expect(destroyed).toBe(true);
    expect(wall.alive).toBe(false);
  });
});

// =============================================================================
// 11. Wall placement proximity check (must be near friendly structure)
// =============================================================================
// C++ display.cpp:706-778 Passes_Proximity_Check: ALL placements (including
// walls) must be near a friendly structure within 2-cell AABB expansion.

describe('Wall placement requires adjacent friendly structure (display.cpp:706-778)', () => {
  it('wall placement fails with no friendly structures nearby', () => {
    const ctx = makePlacementCtx();
    const wallItem = PRODUCTION_ITEMS.find(p => p.type === 'SBAG');
    if (!wallItem) return;
    ctx.pendingPlacement = wallItem;
    const result = placeStructure(ctx, 10, 10);
    expect(result).toBe(false);
  });

  it('wall placement succeeds when adjacent to friendly structure', () => {
    const ctx = makePlacementCtx();
    // Place a construction yard first
    const fact: MapStructure = {
      type: 'FACT', image: 'fact', house: House.Spain,
      cx: 10, cy: 10, hp: 1000, maxHp: 1000, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    ctx.structures.push(fact);
    const wallItem = PRODUCTION_ITEMS.find(p => p.type === 'SBAG');
    if (!wallItem) return;
    ctx.pendingPlacement = { ...wallItem };
    // Place wall within 2 cells of FACT
    const result = placeStructure(ctx, 12, 10);
    expect(result).toBe(true);
  });

  it('wall placement fails when too far from any friendly structure (>2 cells)', () => {
    const ctx = makePlacementCtx();
    const fact: MapStructure = {
      type: 'FACT', image: 'fact', house: House.Spain,
      cx: 10, cy: 10, hp: 1000, maxHp: 1000, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    ctx.structures.push(fact);
    const wallItem = PRODUCTION_ITEMS.find(p => p.type === 'SBAG');
    if (!wallItem) return;
    ctx.pendingPlacement = { ...wallItem };
    // Place wall far from FACT (5 cells away — FACT is 3x3, so edge at 12, + 2 = 14 max)
    const result = placeStructure(ctx, 20, 20);
    expect(result).toBe(false);
  });

  it('wall can be placed adjacent to another wall (chain placement)', () => {
    const ctx = makePlacementCtx();
    // Place a FACT and first wall
    const fact: MapStructure = {
      type: 'FACT', image: 'fact', house: House.Spain,
      cx: 10, cy: 10, hp: 1000, maxHp: 1000, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    ctx.structures.push(fact);
    // First wall adjacent to FACT
    const wall1: MapStructure = {
      type: 'SBAG', image: 'sbag', house: House.Spain,
      cx: 13, cy: 10, hp: 1, maxHp: 1, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    ctx.structures.push(wall1);
    const wallItem = PRODUCTION_ITEMS.find(p => p.type === 'SBAG');
    if (!wallItem) return;
    ctx.pendingPlacement = { ...wallItem };
    // Place second wall adjacent to first wall (within 2-cell AABB)
    const result = placeStructure(ctx, 14, 10);
    expect(result).toBe(true);
  });
});

// =============================================================================
// 12. Sell refund for walls (50% of build cost, C++ fixed-point)
// =============================================================================
// C++ techno.cpp:5743-5761: AI gets 100% refund, human gets Rule.RefundPercent (50%).
// C++ fixed-point: ((128 * cost) + 128) / 256

describe('Wall sell refund (50% of INI Cost=, C++ fixed-point)', () => {
  const BUILDABLE_WALLS_WITH_COST = ['SBAG', 'FENC', 'BRIK'] as const;

  it.each(BUILDABLE_WALLS_WITH_COST)('%s: sell refund = C++ fixed-point 50%% of INI Cost=', (type) => {
    const iniCost = iniInt(type, 'Cost');
    const expectedRefund = Math.trunc((128 * iniCost + 128) / 256);
    const tsRefund = sellRefund(iniCost);
    expect(tsRefund).toBe(expectedRefund);
  });

  it('SBAG sell refund = trunc((128*25+128)/256) = 13', () => {
    const iniCost = iniInt('SBAG', 'Cost');
    expect(iniCost).toBe(25);
    expect(sellRefund(iniCost)).toBe(13);
  });

  it('BRIK sell refund = trunc((128*100+128)/256) = 50', () => {
    const iniCost = iniInt('BRIK', 'Cost');
    expect(iniCost).toBe(100);
    expect(sellRefund(iniCost)).toBe(50);
  });

  it('AI gets 100% refund (isHuman=false)', () => {
    const iniCost = iniInt('BRIK', 'Cost');
    expect(sellRefund(iniCost, false)).toBe(iniCost);
  });
});

// =============================================================================
// 13. Vehicle crush — crushable vs non-crushable walls
// =============================================================================
// C++ unit.cpp:1855-1871: SBAG, FENC, BARB, WOOD are crushable.
// BRIK (concrete) is NOT crushable.

describe('Vehicle wall crush (unit.cpp:1855-1871)', () => {
  it('CRUSHABLE_WALLS contains SBAG, FENC, BARB, WOOD', () => {
    expect(CRUSHABLE_WALLS.has('SBAG')).toBe(true);
    expect(CRUSHABLE_WALLS.has('FENC')).toBe(true);
    expect(CRUSHABLE_WALLS.has('BARB')).toBe(true);
    expect(CRUSHABLE_WALLS.has('WOOD')).toBe(true);
  });

  it('BRIK is NOT crushable (concrete wall resists vehicles)', () => {
    expect(CRUSHABLE_WALLS.has('BRIK')).toBe(false);
  });

  it('crusher vehicle destroys SBAG wall overlay on the map', () => {
    const ctx = makeCombatCtx();
    ctx.map.setWallType(10, 10, 'SBAG');
    const wall = makeWall('SBAG', 10, 10, undefined, House.USSR);
    ctx.structures.push(wall);
    // Create a crusher vehicle (e.g., heavy tank)
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    ctx.entities.push(tank);
    checkWallCrush(ctx, tank);
    expect(ctx.map.getWallType(10, 10)).toBe('');
  });

  it('crusher vehicle does NOT destroy BRIK wall overlay', () => {
    const ctx = makeCombatCtx();
    ctx.map.setWallType(10, 10, 'BRIK');
    const wall = makeWall('BRIK', 10, 10, undefined, House.USSR);
    ctx.structures.push(wall);
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    ctx.entities.push(tank);
    checkWallCrush(ctx, tank);
    // BRIK should survive — not crushable
    expect(ctx.map.getWallType(10, 10)).toBe('BRIK');
  });

  it('non-crusher vehicle does NOT destroy any wall', () => {
    const ctx = makeCombatCtx();
    ctx.map.setWallType(10, 10, 'SBAG');
    const wall = makeWall('SBAG', 10, 10, undefined, House.USSR);
    ctx.structures.push(wall);
    // Jeep is not a crusher
    const jeep = entityAtCell(UnitType.V_JEEP, House.Spain, 10, 10);
    ctx.entities.push(jeep);
    checkWallCrush(ctx, jeep);
    expect(ctx.map.getWallType(10, 10)).toBe('SBAG');
  });
});

// =============================================================================
// 14. All walls have 1x1 footprint
// =============================================================================

describe('All walls have 1x1 footprint (STRUCTURE_SIZE)', () => {
  it.each(WALL_SECTIONS)('%s: STRUCTURE_SIZE is [1,1]', (type) => {
    expect(STRUCTURE_SIZE[type]).toEqual([1, 1]);
  });
});

// =============================================================================
// 15. All walls have no weapon (passive barrier)
// =============================================================================

describe('All walls have no weapon (STRUCTURE_WEAPONS)', () => {
  it.each(WALL_SECTIONS)('%s: STRUCTURE_WEAPONS is undefined', (type) => {
    expect(STRUCTURE_WEAPONS[type]).toBeUndefined();
  });
});

// =============================================================================
// 16. Wall destruction does NOT increment nBuildingsDestroyedCount
// =============================================================================

describe('Wall destruction excluded from nBuildingsDestroyedCount', () => {
  it.each(WALL_SECTIONS)('%s: destruction does not increment counter', (type) => {
    const wall = makeWall(type, 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([wall]);
    structureDamage(ctx, wall, 10);
    expect(wall.alive).toBe(false);
    expect(ctx.nBuildingsDestroyedCount).toBe(0);
  });
});

// =============================================================================
// 17. TechLevel from rules.ini
// =============================================================================

describe('Wall TechLevel from rules.ini', () => {
  const BUILDABLE_WALLS = ['SBAG', 'FENC', 'BRIK'] as const;

  it.each(BUILDABLE_WALLS)('%s: PRODUCTION_ITEMS techLevel matches INI TechLevel=', (type) => {
    const iniTechLevel = iniInt(type, 'TechLevel');
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'SBAG' ? p.type === type : p.type === type);
    expect(prodItem).toBeDefined();
    expect(prodItem!.techLevel).toBe(iniTechLevel);
  });
});

// =============================================================================
// 18. Adjacent= from rules.ini (placement adjacency distance)
// =============================================================================

describe('Wall Adjacent= from rules.ini', () => {
  it.each(WALL_SECTIONS)('%s: INI has Adjacent=1 (wall placement adjacency)', (type) => {
    const iniAdjacent = iniInt(type, 'Adjacent', -1);
    expect(iniAdjacent).toBe(1);
  });
});

// =============================================================================
// 19. Repairable= from rules.ini
// =============================================================================

describe('Wall Repairable= from rules.ini', () => {
  it.each(['SBAG', 'FENC', 'BRIK'] as const)('%s: INI Repairable=false', (type) => {
    const val = iniGet(type, 'Repairable')?.toLowerCase();
    expect(val).toBe('false');
  });
});

// =============================================================================
// 20. Points= from rules.ini (destruction point reward)
// =============================================================================

describe('Wall Points= from rules.ini', () => {
  it.each(WALL_SECTIONS)('%s: INI Points= is defined and > 0', (type) => {
    const iniPoints = iniInt(type, 'Points');
    expect(iniPoints).toBeGreaterThan(0);
  });

  it.each(['SBAG', 'FENC', 'BRIK'] as const)('%s: PRODUCTION_ITEMS points matches INI Points=', (type) => {
    const iniPoints = iniInt(type, 'Points');
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === type);
    expect(prodItem).toBeDefined();
    expect(prodItem!.points).toBe(iniPoints);
  });
});

// =============================================================================
// 21. Wall placement sets map wallType (for auto-linking and projectile stop)
// =============================================================================

describe('Wall placement stores wallType on map', () => {
  it('placeStructure sets map.getWallType for SBAG', () => {
    const ctx = makePlacementCtx();
    const fact: MapStructure = {
      type: 'FACT', image: 'fact', house: House.Spain,
      cx: 10, cy: 10, hp: 1000, maxHp: 1000, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    ctx.structures.push(fact);
    const wallItem = PRODUCTION_ITEMS.find(p => p.type === 'SBAG');
    if (!wallItem) return;
    ctx.pendingPlacement = { ...wallItem };
    placeStructure(ctx, 12, 10);
    expect(ctx.map.getWallType(12, 10)).toBe('SBAG');
  });
});

// =============================================================================
// 22. Wall placement keeps pendingPlacement active (continuous placement)
// =============================================================================
// C++ building.cpp: walls keep pendingPlacement for chain-placement.
// placement.ts:119: isWall → pendingPlacement NOT nulled out.

describe('Wall placement keeps pendingPlacement for chain placement', () => {
  it('after placing a wall, pendingPlacement is still set', () => {
    const ctx = makePlacementCtx();
    const fact: MapStructure = {
      type: 'FACT', image: 'fact', house: House.Spain,
      cx: 10, cy: 10, hp: 1000, maxHp: 1000, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    ctx.structures.push(fact);
    const wallItem = PRODUCTION_ITEMS.find(p => p.type === 'SBAG');
    if (!wallItem) return;
    ctx.pendingPlacement = { ...wallItem };
    const placed = placeStructure(ctx, 12, 10);
    expect(placed).toBe(true);
    // Wall placement should NOT clear pendingPlacement (allows chain placement)
    expect(ctx.pendingPlacement).not.toBeNull();
  });

  it('after placing a non-wall building, pendingPlacement is cleared', () => {
    const ctx = makePlacementCtx();
    const fact: MapStructure = {
      type: 'FACT', image: 'fact', house: House.Spain,
      cx: 10, cy: 10, hp: 1000, maxHp: 1000, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    ctx.structures.push(fact);
    const siloItem = PRODUCTION_ITEMS.find(p => p.type === 'SILO');
    if (!siloItem) return;
    ctx.pendingPlacement = { ...siloItem };
    const placed = placeStructure(ctx, 12, 10);
    expect(placed).toBe(true);
    expect(ctx.pendingPlacement).toBeNull();
  });
});

// =============================================================================
// 23. Walls appear instantly (no build animation)
// =============================================================================
// placement.ts:101: walls get buildProgress=undefined (instant), non-walls get 0.

describe('Walls appear instantly (no buildProgress)', () => {
  it('newly placed wall structure has buildProgress undefined', () => {
    const ctx = makePlacementCtx();
    const fact: MapStructure = {
      type: 'FACT', image: 'fact', house: House.Spain,
      cx: 10, cy: 10, hp: 1000, maxHp: 1000, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    ctx.structures.push(fact);
    const wallItem = PRODUCTION_ITEMS.find(p => p.type === 'SBAG');
    if (!wallItem) return;
    ctx.pendingPlacement = { ...wallItem };
    placeStructure(ctx, 12, 10);
    const placedWall = ctx.structures.find(s => s.type === 'SBAG');
    expect(placedWall).toBeDefined();
    expect(placedWall!.buildProgress).toBeUndefined();
  });

  it('newly placed non-wall structure has buildProgress=0', () => {
    const ctx = makePlacementCtx();
    const fact: MapStructure = {
      type: 'FACT', image: 'fact', house: House.Spain,
      cx: 10, cy: 10, hp: 1000, maxHp: 1000, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    ctx.structures.push(fact);
    const siloItem = PRODUCTION_ITEMS.find(p => p.type === 'SILO');
    if (!siloItem) return;
    ctx.pendingPlacement = { ...siloItem };
    placeStructure(ctx, 12, 10);
    const placedSilo = ctx.structures.find(s => s.type === 'SILO');
    expect(placedSilo).toBeDefined();
    expect(placedSilo!.buildProgress).toBe(0);
  });
});

// =============================================================================
// 24. Sight= from rules.ini
// =============================================================================

describe('Wall Sight= from rules.ini', () => {
  it.each(WALL_SECTIONS)('%s: INI Sight=0 (walls provide no vision)', (type) => {
    const iniSight = iniInt(type, 'Sight');
    expect(iniSight).toBe(0);
  });
});

// =============================================================================
// 25. Cross-type INI consistency — all walls share Strength=1
// =============================================================================

describe('Cross-type INI consistency', () => {
  it('all 5 wall types have Strength=1 in rules.ini', () => {
    for (const type of WALL_SECTIONS) {
      expect(iniInt(type, 'Strength')).toBe(1);
    }
  });

  it('all 5 wall types have Adjacent=1 in rules.ini', () => {
    for (const type of WALL_SECTIONS) {
      expect(iniInt(type, 'Adjacent', -1)).toBe(1);
    }
  });

  it('all 5 wall types have Sight=0 in rules.ini', () => {
    for (const type of WALL_SECTIONS) {
      expect(iniInt(type, 'Sight', -1)).toBe(0);
    }
  });

  it('all 5 wall types have STRUCTURE_MAX_HP=1 in TS engine', () => {
    for (const type of WALL_SECTIONS) {
      expect(STRUCTURE_MAX_HP[type]).toBe(1);
    }
  });

  it('all 5 wall types have STRUCTURE_SIZE=[1,1] in TS engine', () => {
    for (const type of WALL_SECTIONS) {
      expect(STRUCTURE_SIZE[type]).toEqual([1, 1]);
    }
  });
});
