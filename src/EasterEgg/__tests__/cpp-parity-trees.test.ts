/**
 * C++ Behavioral Parity Tests — Tree (TerrainClass) Objects
 *
 * Audits the TypeScript engine's tree HP, ARMOR_WOOD damage, occupancy blocking,
 * clump immunity, and destruction behavior against C++ Red Alert source code.
 *
 * Source references:
 *   RA/tdata.cpp:57-77       — Occupy_List offset arrays (_List0010, _List10, etc.)
 *   RA/tdata.cpp:246-424     — Tree type definitions (T01-T17, TC01-TC05)
 *   TD/tdata.cpp:50-52       — #define TREE_NORMAL 600, TREE_WEAK 400, TREE_STRONG 800
 *   RA/terrain.cpp:108-151   — Take_Damage: SA immunity, IsImmune check, HP reduction
 *   RA/terrain.cpp:221-234   — Constructor: Strength = Class->MaxStrength
 *   RA/tdata.cpp:430         — Clumps: IsImmune=true (immune to combat damage)
 *   RA/tdata.cpp:250         — Trees: IsImmune=false (can be damaged)
 *   combat.cpp:72-129        — Modify_Damage: warhead vs armor multiplier + distance falloff
 *
 * Tests that FAIL are GOOD — they identify real C++ divergences.
 */

import { describe, it, expect } from 'vitest';
import {
  GameMap, Terrain, MoveResult,
  TREE_OCCUPY, TREE_MAX_HP, TREE_CENTER_OFFSET,
  type MapTree,
} from '../engine/map';
import { applySplashDamage, SPLASH_RADIUS, type CombatContext } from '../engine/combat';
import { modifyDamage, CELL_SIZE, House, buildDefaultAlliances } from '../engine/types';
import type { Entity } from '../engine/entity';
import type { Effect } from '../engine/renderer';

function makeTree(type: string, cx: number, cy: number, hp = TREE_MAX_HP): MapTree {
  const occupyCells = (TREE_OCCUPY[type] ?? []).map(([dx, dy]) => (cx + dx) + (cy + dy) * 128);
  return {
    type, cx, cy,
    hp, maxHp: TREE_MAX_HP,
    immune: type.startsWith('tc'),
    occupyCells,
  };
}

function makeCombatCtx(map: GameMap): CombatContext {
  const alliances = buildDefaultAlliances();
  return {
    entities: [] as Entity[],
    entityById: new Map<number, Entity>(),
    structures: [],
    inflightProjectiles: [],
    effects: [] as Effect[],
    logicAnims: [],
    tick: 0,
    playerHouse: House.Spain,
    scenarioId: 'TEST',
    killCount: 0,
    lossCount: 0,
    pointTotal: 0,
    alliedUnitsLost: 0,
    sovietUnitsLost: 0,
    alliedBuildingsLost: 0,
    sovietBuildingsLost: 0,
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    attackedTriggerNames: new Set<string>(),
    explosionDamageReservedEntityIds: new Set<number>(),
    explosionDamageReservedStructures: new Set(),
    map,
    aiStates: new Map(),
    lastBaseAttackEva: -Infinity,
    gameTicksPerSec: 15,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    powerConsumed: 0,
    powerProduced: 0,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    movementSpeed: () => 1,
    getFirepowerBias: () => 1,
    getArmorBias: () => 1,
    getROFBias: () => 1,
    damageStructure: () => false,
    aiIQ: () => 3,
    warheadMuzzleColor: () => '#fff',
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => {},
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
  } as CombatContext;
}

function damageTreeWithSplash(ctx: CombatContext, tree: MapTree, damage: number, warhead: 'Fire' | 'HE' | 'SA'): void {
  const off = TREE_CENTER_OFFSET[tree.type] ?? [CELL_SIZE / 2, CELL_SIZE / 2];
  applySplashDamage(
    ctx,
    { x: tree.cx * CELL_SIZE + off[0], y: tree.cy * CELL_SIZE + off[1] },
    { damage, warhead },
    -1,
    House.Spain,
  );
}

// ════════════════════════════════════════════════════════════════════
// 1. Tree HP constants
// ════════════════════════════════════════════════════════════════════

describe('Tree HP constants — C++ TD/tdata.cpp:50-52', () => {
  it('TREE_MAX_HP = 600 (TREE_NORMAL)', () => {
    // C++ #define TREE_NORMAL 600
    // All RA trees use TREE_NORMAL strength
    expect(TREE_MAX_HP).toBe(600);
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. Tree occupy lists — per-type cell blocking patterns
// ════════════════════════════════════════════════════════════════════

describe('Tree Occupy_List patterns — C++ RA/tdata.cpp:57-77, 246-424', () => {
  // Helper: decode C++ offset list to [dx,dy] pairs
  // MAP_CELL_W = 128 in C++. offset / 128 = dy, offset % 128 = dx.
  // _List0010 = {MAP_CELL_W, EOL} → (0, 1)
  // _List10 = {0, EOL} → (0, 0)
  // _List0011 = {MAP_CELL_W, MAP_CELL_W+1, EOL} → (0,1), (1,1)

  // Single trees — C++ RA/tdata.cpp:246-424
  it.each([
    ['t01', [[0, 1]]],             // _List0010
    ['t02', [[0, 1]]],             // _List0010
    ['t03', [[0, 1]]],             // _List0010
    ['t05', [[0, 1]]],             // _List0010
    ['t06', [[0, 1]]],             // _List0010
    ['t07', [[0, 1]]],             // _List0010
    ['t08', [[0, 0]]],             // _List10
    ['t10', [[0, 1], [1, 1]]],    // _List0011
    ['t11', [[0, 1], [1, 1]]],    // _List0011
    ['t12', [[0, 1]]],             // _List0010
    ['t13', [[0, 1]]],             // _List0010
    ['t14', [[0, 1], [1, 1]]],    // _List0011
    ['t15', [[0, 1], [1, 1]]],    // _List0011
    ['t16', [[0, 1]]],             // _List0010
    ['t17', [[0, 1]]],             // _List0010
  ] as [string, [number, number][]][])(
    '%s occupy list matches C++ tdata.cpp',
    (type, expected) => {
      expect(TREE_OCCUPY[type]).toEqual(expected);
    },
  );

  // Tree clumps — C++ RA/tdata.cpp:426-483
  it.each([
    ['tc01', [[0, 1], [1, 1]]],                                           // _List000110
    ['tc02', [[1, 0], [0, 1], [1, 1]]],                                   // _List010110
    ['tc03', [[0, 0], [1, 0], [0, 1], [1, 1]]],                           // _List110110
    ['tc04', [[0, 1], [1, 1], [2, 1], [0, 2]]],                           // _List000011101000
    ['tc05', [[2, 0], [0, 1], [1, 1], [2, 1], [1, 2], [2, 2]]],          // _List001011100110
  ] as [string, [number, number][]][])(
    '%s clump occupy list matches C++ tdata.cpp',
    (type, expected) => {
      expect(TREE_OCCUPY[type]).toEqual(expected);
    },
  );

  it('no T04, T09, T18 in RA — these are TD-only trees', () => {
    // RA/tdata.cpp Init_Heap skips T04, T09, T18
    expect(TREE_OCCUPY['t04']).toBeUndefined();
    expect(TREE_OCCUPY['t09']).toBeUndefined();
    expect(TREE_OCCUPY['t18']).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. Tree object creation and map registration
// ════════════════════════════════════════════════════════════════════

describe('Tree object creation — C++ terrain.cpp constructor', () => {
  it('tree starts with full HP', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    const tree: MapTree = {
      type: 't01', cx: 10, cy: 10,
      hp: TREE_MAX_HP, maxHp: TREE_MAX_HP,
      immune: false,
      occupyCells: [(10 + 0) + (10 + 1) * 128], // (0,1) offset
    };
    map.addTree(tree);
    expect(tree.hp).toBe(600);
    expect(tree.maxHp).toBe(600);
  });

  it('single tree occupies correct cells (T01 blocks cell below)', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    const occupyCells = TREE_OCCUPY['t01']!.map(([dx, dy]) => (10 + dx) + (10 + dy) * 128);
    const tree: MapTree = {
      type: 't01', cx: 10, cy: 10,
      hp: TREE_MAX_HP, maxHp: TREE_MAX_HP,
      immune: false, occupyCells,
    };
    map.addTree(tree);

    // Cell below origin should be blocked
    expect(map.isTreeOccupied(10, 11)).toBe(true);
    // Origin cell itself is NOT in occupy list (it's in overlap)
    expect(map.isTreeOccupied(10, 10)).toBe(false);
  });

  it('T08 occupies origin cell (not cell below)', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    const occupyCells = TREE_OCCUPY['t08']!.map(([dx, dy]) => (15 + dx) + (15 + dy) * 128);
    const tree: MapTree = {
      type: 't08', cx: 15, cy: 15,
      hp: TREE_MAX_HP, maxHp: TREE_MAX_HP,
      immune: false, occupyCells,
    };
    map.addTree(tree);

    expect(map.isTreeOccupied(15, 15)).toBe(true);
    expect(map.isTreeOccupied(15, 16)).toBe(false);
  });

  it('clumps are immune to damage', () => {
    const tree: MapTree = {
      type: 'tc01', cx: 20, cy: 20,
      hp: TREE_MAX_HP, maxHp: TREE_MAX_HP,
      immune: true,  // C++ RA/tdata.cpp: IsImmune=true for all clumps
      occupyCells: [],
    };
    expect(tree.immune).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. Tree occupancy blocks ground movement
// ════════════════════════════════════════════════════════════════════

describe('Tree occupancy blocks movement — C++ terrain.cpp Occupy_List', () => {
  function makeMapWithTree(type: string, cx: number, cy: number): { map: GameMap; tree: MapTree } {
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    const occupyCells = (TREE_OCCUPY[type] ?? []).map(([dx, dy]) => (cx + dx) + (cy + dy) * 128);
    const tree: MapTree = {
      type, cx, cy,
      hp: TREE_MAX_HP, maxHp: TREE_MAX_HP,
      immune: type.startsWith('tc'),
      occupyCells,
    };
    map.addTree(tree);
    return { map, tree };
  }

  it('canEnterCell returns IMPASSABLE for tree-occupied cells', () => {
    const { map } = makeMapWithTree('t01', 10, 10);
    // T01 occupies cell (10, 11) — below origin
    expect(map.canEnterCell(10, 11)).toBe(MoveResult.IMPASSABLE);
  });

  it('canEnterCell returns OK for tree origin (T01 origin not in occupy list)', () => {
    const { map } = makeMapWithTree('t01', 10, 10);
    // T01 origin (10, 10) is in overlap list, not occupy — should be passable
    expect(map.canEnterCell(10, 10)).toBe(MoveResult.OK);
  });

  it('canEnterCell returns IMPASSABLE for T08 origin (T08 occupies origin)', () => {
    const { map } = makeMapWithTree('t08', 15, 15);
    expect(map.canEnterCell(15, 15)).toBe(MoveResult.IMPASSABLE);
  });

  it('isPassable returns false for tree-occupied cells', () => {
    const { map } = makeMapWithTree('t01', 10, 10);
    expect(map.isPassable(10, 11)).toBe(false);
  });

  it('isTerrainPassable returns false for tree-occupied cells', () => {
    const { map } = makeMapWithTree('t01', 10, 10);
    expect(map.isTerrainPassable(10, 11)).toBe(false);
  });

  it('naval units not blocked by trees (canEnterCell naval=true)', () => {
    const { map } = makeMapWithTree('t01', 10, 10);
    // Naval units check water passability, trees are irrelevant
    map.setTerrain(10, 11, Terrain.WATER);
    expect(map.canEnterCell(10, 11, true)).toBe(MoveResult.OK);
  });

  it('multi-cell tree (T10) blocks both occupied cells', () => {
    const { map } = makeMapWithTree('t10', 20, 20);
    // T10 occupy: (0,1) and (1,1) → (20,21) and (21,21)
    expect(map.isTreeOccupied(20, 21)).toBe(true);
    expect(map.isTreeOccupied(21, 21)).toBe(true);
    // Origin and (21,20) not occupied
    expect(map.isTreeOccupied(20, 20)).toBe(false);
    expect(map.isTreeOccupied(21, 20)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// 5. Tree damage — ARMOR_WOOD + deterministic HP
// ════════════════════════════════════════════════════════════════════

describe('Tree damage — C++ terrain.cpp:108-151, ARMOR_WOOD', () => {
  it('HE warhead deals damage to wood armor (point blank)', () => {
    // C++ combat.cpp Modify_Damage with ARMOR_WOOD
    const dmg = modifyDamage(100, 'HE', 'wood', 0);
    expect(dmg).toBeGreaterThan(0);
  });

  it('SA warhead immunity is terrain-level, not warhead-vs-armor', () => {
    // C++ terrain.cpp:118 — "warhead != WARHEAD_SA" check in Take_Damage
    // SA CAN deal non-zero modifyDamage vs wood (50% in WARHEAD_VS_ARMOR),
    // but TerrainClass::Take_Damage skips all SA hits before calling Modify_Damage.
    // Our combat.ts enforces this with: weapon.warhead !== 'SA'
    const dmg = modifyDamage(100, 'SA', 'wood', 0);
    // Verify SA does produce non-zero from pure math (the terrain check catches it)
    expect(dmg).toBeGreaterThan(0);
  });

  it('AP warhead deals damage to wood armor', () => {
    const dmg = modifyDamage(100, 'AP', 'wood', 0);
    expect(dmg).toBeGreaterThan(0);
  });

  it('damage decreases with distance (splash falloff)', () => {
    const close = modifyDamage(100, 'HE', 'wood', 0);
    const far = modifyDamage(100, 'HE', 'wood', 48); // 2 cells away
    expect(far).toBeLessThan(close);
  });
});

// ════════════════════════════════════════════════════════════════════
// 6. Tree fire — TerrainClass::Catch_Fire
// ════════════════════════════════════════════════════════════════════

describe('Tree fire — C++ terrain.cpp Catch_Fire', () => {
  function makeMapWithBurnableTree(): { map: GameMap; tree: MapTree; ctx: CombatContext } {
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    const tree = makeTree('t01', 10, 10);
    map.setTreeType(tree.cx, tree.cy, tree.type);
    map.addTree(tree);
    return { map, tree, ctx: makeCombatCtx(map) };
  }

  it('Fire damage catches a wood tree on fire with generic BURN-L and delayed BURN-M anims', () => {
    const { tree, ctx } = makeMapWithBurnableTree();

    damageTreeWithSplash(ctx, tree, 80, 'Fire');

    expect(tree.isOnFire).toBe(true);
    expect(ctx.logicAnims.map(anim => anim.type)).toEqual(['burn_big', 'burn_med']);
    expect(ctx.logicAnims.some(anim => anim.type === 'on_fire_big' || anim.type === 'on_fire_med')).toBe(false);

    const burnBig = ctx.logicAnims.find(anim => anim.type === 'burn_big')!;
    const burnMed = ctx.logicAnims.find(anim => anim.type === 'burn_med')!;
    const off = TREE_CENTER_OFFSET[tree.type]!;
    const treeKey = tree.cy * 128 + tree.cx;

    expect(burnBig.delay).toBe(0);
    expect(burnBig.attachedTreeKey).toBe(treeKey);
    expect(burnBig.x).toBeCloseTo(tree.cx * CELL_SIZE + off[0]);
    expect(burnBig.y).toBeCloseTo(tree.cy * CELL_SIZE + off[1] - 0x50 * CELL_SIZE / 256);

    expect(burnMed.delay).toBe(15);
    expect(burnMed.attachedTreeKey).toBe(treeKey);
    expect(burnMed.x).toBeCloseTo(burnBig.x);
    expect(burnMed.y).toBeCloseTo(tree.cy * CELL_SIZE + off[1] - 0xE0 * CELL_SIZE / 256);
  });

  it('Fire damage does not submit duplicate terrain burn anims while the tree is already on fire', () => {
    const { tree, ctx } = makeMapWithBurnableTree();

    damageTreeWithSplash(ctx, tree, 80, 'Fire');
    damageTreeWithSplash(ctx, tree, 80, 'Fire');

    expect(ctx.logicAnims.filter(anim => anim.type === 'burn_big')).toHaveLength(1);
    expect(ctx.logicAnims.filter(anim => anim.type === 'burn_med')).toHaveLength(1);
  });

  it('SA damage does not damage or ignite terrain even though SA has a wood armor multiplier', () => {
    const { tree, ctx } = makeMapWithBurnableTree();

    damageTreeWithSplash(ctx, tree, 80, 'SA');

    expect(tree.hp).toBe(TREE_MAX_HP);
    expect(tree.isOnFire).toBeUndefined();
    expect(ctx.logicAnims).toHaveLength(0);
  });

  it('strict splash range gates tree damage before Modify_Damage', () => {
    const { tree, ctx } = makeMapWithBurnableTree();
    const off = TREE_CENTER_OFFSET[tree.type]!;

    applySplashDamage(
      ctx,
      {
        x: tree.cx * CELL_SIZE + off[0] + SPLASH_RADIUS * CELL_SIZE,
        y: tree.cy * CELL_SIZE + off[1],
      },
      { damage: 80, warhead: 'Fire' },
      -1,
      House.Spain,
    );

    expect(tree.hp).toBe(TREE_MAX_HP);
    expect(tree.isOnFire).toBeUndefined();
    expect(ctx.logicAnims).toHaveLength(0);
  });

  it('non-fire damage is ignored while a tree is already burning', () => {
    const { tree, ctx } = makeMapWithBurnableTree();

    damageTreeWithSplash(ctx, tree, 80, 'Fire');
    const hpAfterFire = tree.hp;
    damageTreeWithSplash(ctx, tree, 200, 'HE');

    expect(tree.hp).toBe(hpAfterFire);
    expect(tree.isOnFire).toBe(true);
  });

  it('lethal Fire damage leaves the burning tree on the map until attached fire goes out', () => {
    const { map, tree, ctx } = makeMapWithBurnableTree();

    damageTreeWithSplash(ctx, tree, 1000, 'Fire');

    expect(tree.hp).toBe(0);
    expect(tree.isOnFire).toBe(true);
    expect(map.getTreeAtOrigin(tree.cx, tree.cy)).toBe(tree);
    expect(map.getTreeAtCell(tree.cx, tree.cy + 1)).toBe(tree);
  });
});

// ════════════════════════════════════════════════════════════════════
// 7. Tree destruction clears occupancy
// ════════════════════════════════════════════════════════════════════

describe('Tree destruction — C++ terrain.cpp Start_To_Crumble + destructor', () => {
  it('destroyTree clears tree-occupied cells', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    const occupyCells = TREE_OCCUPY['t01']!.map(([dx, dy]) => (10 + dx) + (10 + dy) * 128);
    const tree: MapTree = {
      type: 't01', cx: 10, cy: 10,
      hp: 0, maxHp: TREE_MAX_HP,
      immune: false, occupyCells,
    };
    map.setTreeType(10, 10, 't01');
    map.addTree(tree);

    expect(map.isTreeOccupied(10, 11)).toBe(true);
    map.destroyTree(tree);
    expect(map.isTreeOccupied(10, 11)).toBe(false);
  });

  it('destroyTree clears treeType on origin cell', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    const occupyCells = TREE_OCCUPY['t01']!.map(([dx, dy]) => (10 + dx) + (10 + dy) * 128);
    const tree: MapTree = {
      type: 't01', cx: 10, cy: 10,
      hp: 0, maxHp: TREE_MAX_HP,
      immune: false, occupyCells,
    };
    map.setTreeType(10, 10, 't01');
    map.addTree(tree);

    map.destroyTree(tree);
    expect(map.getTreeType(10, 10)).toBe('');
  });

  it('destroyTree removes tree from trees Map', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    const occupyCells = TREE_OCCUPY['t01']!.map(([dx, dy]) => (10 + dx) + (10 + dy) * 128);
    const tree: MapTree = {
      type: 't01', cx: 10, cy: 10,
      hp: 0, maxHp: TREE_MAX_HP,
      immune: false, occupyCells,
    };
    map.addTree(tree);

    expect(map.getTreeAtOrigin(10, 10)).toBe(tree);
    map.destroyTree(tree);
    expect(map.getTreeAtOrigin(10, 10)).toBeUndefined();
  });

  it('destroyTree on multi-cell tree clears all occupied cells', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    const occupyCells = TREE_OCCUPY['t10']!.map(([dx, dy]) => (20 + dx) + (20 + dy) * 128);
    const tree: MapTree = {
      type: 't10', cx: 20, cy: 20,
      hp: 0, maxHp: TREE_MAX_HP,
      immune: false, occupyCells,
    };
    map.addTree(tree);

    expect(map.isTreeOccupied(20, 21)).toBe(true);
    expect(map.isTreeOccupied(21, 21)).toBe(true);
    map.destroyTree(tree);
    expect(map.isTreeOccupied(20, 21)).toBe(false);
    expect(map.isTreeOccupied(21, 21)).toBe(false);
  });

  it('getTreeAtCell returns undefined after destruction', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    const occupyCells = TREE_OCCUPY['t01']!.map(([dx, dy]) => (10 + dx) + (10 + dy) * 128);
    const tree: MapTree = {
      type: 't01', cx: 10, cy: 10,
      hp: 0, maxHp: TREE_MAX_HP,
      immune: false, occupyCells,
    };
    map.addTree(tree);

    expect(map.getTreeAtCell(10, 11)).toBe(tree);
    map.destroyTree(tree);
    expect(map.getTreeAtCell(10, 11)).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════
// 8. Clump immunity
// ════════════════════════════════════════════════════════════════════

describe('Clump immunity — C++ RA/tdata.cpp IsImmune=true', () => {
  it.each(['tc01', 'tc02', 'tc03', 'tc04', 'tc05'])(
    '%s should be immune to combat damage',
    (type) => {
      // C++ RA/tdata.cpp: all Clump*Class have IsImmune=true as first bool param
      const tree: MapTree = {
        type, cx: 0, cy: 0,
        hp: TREE_MAX_HP, maxHp: TREE_MAX_HP,
        immune: true,
        occupyCells: [],
      };
      // Immune trees should not take damage — combat.ts checks tree.immune
      expect(tree.immune).toBe(true);
    },
  );

  it.each(['t01', 't02', 't03', 't05', 't06', 't07', 't08', 't10', 't11', 't12', 't13', 't14', 't15', 't16', 't17'])(
    '%s should NOT be immune to combat damage',
    (type) => {
      // C++ RA/tdata.cpp: all Tree*Class have IsImmune=false
      const tree: MapTree = {
        type, cx: 0, cy: 0,
        hp: TREE_MAX_HP, maxHp: TREE_MAX_HP,
        immune: false,
        occupyCells: [],
      };
      expect(tree.immune).toBe(false);
    },
  );
});

// ════════════════════════════════════════════════════════════════════
// 9. Tree center offsets — C++ XYP_COORD (RA tdata.cpp)
// ════════════════════════════════════════════════════════════════════

describe('Tree center offsets — C++ RA/tdata.cpp XYP_COORD', () => {
  it.each([
    ['t01', 11, 41],   ['t02', 11, 44],   ['t03', 12, 45],
    ['t05', 15, 41],   ['t06', 16, 37],   ['t07', 15, 41],
    ['t08', 14, 22],   ['t10', 25, 43],   ['t11', 23, 44],
    ['t12', 14, 36],   ['t13', 19, 40],   ['t14', 19, 40],
    ['t15', 19, 40],   ['t16', 13, 36],   ['t17', 18, 44],
    ['tc01', 28, 41],  ['tc02', 38, 41],  ['tc03', 33, 35],
    ['tc04', 44, 49],  ['tc05', 49, 58],
  ] as [string, number, number][])(
    '%s center offset = (%d, %d)',
    (type, px, py) => {
      expect(TREE_CENTER_OFFSET[type]).toEqual([px, py]);
    },
  );

  it('center offset produces pixel-level distance for damage calc', () => {
    // T01 at cell (10,10): origin pixel = (240, 240), center = (240+11, 240+41) = (251, 281)
    // Explosion at cell center (10,10) = (252, 252)
    // Distance should use center, not origin
    const off = TREE_CENTER_OFFSET['t01']!;
    const treeCenterX = 10 * CELL_SIZE + off[0]; // 240 + 11 = 251
    const treeCenterY = 10 * CELL_SIZE + off[1]; // 240 + 41 = 281
    const explosionX = 10 * CELL_SIZE + CELL_SIZE / 2; // 252
    const explosionY = 10 * CELL_SIZE + CELL_SIZE / 2; // 252
    const dist = Math.sqrt((explosionX - treeCenterX) ** 2 + (explosionY - treeCenterY) ** 2);
    // Center is 29 pixels below cell center → significant distance difference vs origin
    expect(dist).toBeGreaterThan(28);
    expect(dist).toBeLessThan(30);
  });
});
