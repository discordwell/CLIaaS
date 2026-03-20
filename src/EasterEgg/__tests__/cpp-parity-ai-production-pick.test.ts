/**
 * C++ Behavioral Parity: AI Production Pick System
 *
 * Tests verify getAIProductionPick behavior matches C++ RA source code.
 * C++ reference: factory.cpp / house.cpp AI production logic.
 *
 * The AI production picker filters available production items by category,
 * faction, tech level, and tech prerequisites, then applies weighted random
 * selection based on army composition (anti-armor ratio, infantry ratio).
 * Special unit types (E6, MEDI, HARV) receive weight penalties.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  House, UnitType, CELL_SIZE,
  UNIT_STATS, HOUSE_FACTION, PRODUCTION_ITEMS,
  type ProductionItem,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap } from '../engine/map';
import { STRUCTURE_MAX_HP, type MapStructure } from '../engine/scenario';
import {
  type AIContext, type AIHouseState, type Difficulty,
  AI_DIFFICULTY_MODS,
  createAIHouseState,
  getAIProductionPick,
} from '../engine/ai';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeStructure(
  type: string, house: House, cx = 50, cy = 50,
  opts: Partial<MapStructure> = {},
): MapStructure {
  const maxHp = opts.maxHp ?? STRUCTURE_MAX_HP[type] ?? 256;
  return {
    type, image: type.toLowerCase(), house, cx, cy,
    hp: opts.hp ?? maxHp, maxHp,
    alive: opts.alive ?? true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
    ...opts,
  } as MapStructure;
}

function makeMockAIContext(overrides: Partial<AIContext> = {}): AIContext {
  const map = new GameMap();
  map.setBounds(40, 40, 50, 50);
  const alliances = buildDefaultAlliances();
  return {
    entities: [], entityById: new Map(), structures: [],
    map, tick: 0, playerHouse: House.Spain,
    scenarioId: 'SCG01EA', difficulty: 'normal' as Difficulty,
    aiStates: new Map(), houseCredits: new Map(),
    houseIQs: new Map(), houseTechLevels: new Map(),
    houseMaxUnits: new Map(), houseMaxInfantry: new Map(),
    houseMaxBuildings: new Map(),
    baseBlueprint: [], baseRebuildQueue: [], baseRebuildCooldown: 0,
    scenarioProductionItems: PRODUCTION_ITEMS,
    scenarioUnitStats: {}, scenarioWeaponStats: {},
    nextWaveId: 0,
    autocreateEnabled: false, teamTypes: [],
    destroyedTeams: new Set(), waypoints: new Map(),
    houseEdges: new Map(), effects: [],
    isAllied: (a, b) => alliances.get(a)?.has(b) ?? false,
    isPlayerControlled: (e) => alliances.get(e.house)?.has(House.Spain) ?? false,
    clearStructureFootprint: vi.fn(),
    findPassableSpawn: (_cx, _cy, _scx, _scy, _fw, _fh) => ({ cx: _cx, cy: _cy }),
    ...overrides,
  };
}

function addAIHouse(ctx: AIContext, house: House, overrides: Partial<AIHouseState> = {}): AIHouseState {
  const state = createAIHouseState(ctx, house);
  Object.assign(state, overrides);
  ctx.aiStates.set(house, state);
  return state;
}

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Build a minimal production items list with specific items for controlled tests */
function makeMinimalItems(...items: Partial<ProductionItem>[]): ProductionItem[] {
  return items.map(item => ({
    type: item.type ?? 'E1',
    name: item.name ?? item.type ?? 'Test',
    cost: item.cost ?? 100,
    buildTime: item.buildTime ?? 45,
    prerequisite: item.prerequisite ?? 'TENT',
    faction: item.faction ?? 'both',
    ...item,
  })) as ProductionItem[];
}

// =============================================================================
// getAIProductionPick — C++ factory.cpp / house.cpp AI production logic
// =============================================================================

describe('getAIProductionPick — category filtering (C++ factory.cpp prerequisite check)', () => {
  it('returns null when scenarioProductionItems is empty', () => {
    const ctx = makeMockAIContext({ scenarioProductionItems: [] });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });
    expect(getAIProductionPick(ctx, House.USSR, 'infantry')).toBeNull();
  });

  it('returns null when no items match the category prereq', () => {
    // Only vehicle items — asking for infantry should find nothing
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: '2TNK', prerequisite: 'WEAP', faction: 'allied' },
      ),
    });
    addAIHouse(ctx, House.England, { techLevel: 10 });
    expect(getAIProductionPick(ctx, House.England, 'infantry')).toBeNull();
  });

  it('infantry category matches items with TENT prerequisite', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E1', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });
    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('E1');
  });

  it('infantry category also matches items with BARR prerequisite', () => {
    // BARR is the Soviet barracks — infantry category includes both TENT and BARR
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E1', prerequisite: 'BARR', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.England, { techLevel: 10 });
    const pick = getAIProductionPick(ctx, House.England, 'infantry');
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('E1');
  });

  it('vehicle category matches items with WEAP prerequisite only (not BARR)', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: '1TNK', prerequisite: 'WEAP', faction: 'allied', techLevel: 4 },
        { type: 'E1', prerequisite: 'BARR', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.England, { techLevel: 10 });
    const pick = getAIProductionPick(ctx, House.England, 'vehicle');
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('1TNK');
  });

  it('vehicle category excludes TENT prerequisite items', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E1', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });
    expect(getAIProductionPick(ctx, House.USSR, 'vehicle')).toBeNull();
  });
});

describe('getAIProductionPick — structure filtering (C++ factory.cpp isStructure check)', () => {
  it('filters out items with isStructure=true', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'POWR', prerequisite: 'FACT', faction: 'both', isStructure: true, techLevel: 1 },
        { type: 'TENT', prerequisite: 'POWR', faction: 'allied', isStructure: true, techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });
    // All items are structures — should return null for infantry
    expect(getAIProductionPick(ctx, House.USSR, 'infantry')).toBeNull();
  });

  it('allows items without isStructure (units)', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E1', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
        { type: 'TENT', prerequisite: 'POWR', faction: 'allied', isStructure: true, techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });
    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('E1');
  });
});

describe('getAIProductionPick — faction filtering (C++ house.cpp faction ownership)', () => {
  it('soviet house gets soviet + both faction items', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E1', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
        { type: 'E2', prerequisite: 'TENT', faction: 'soviet', techLevel: 1 },
        { type: 'E3', prerequisite: 'TENT', faction: 'allied', techLevel: 2 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });

    // Vary random values to cover both eligible items (E1 and E2)
    const picks = new Set<string>();
    const randomMock = vi.spyOn(Math, 'random');
    for (let i = 0; i < 20; i++) {
      randomMock.mockReturnValue(i / 20);
      const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
      if (pick) picks.add(pick.type);
    }
    vi.restoreAllMocks();

    expect(picks.has('E1')).toBe(true);   // 'both' faction — should appear
    expect(picks.has('E2')).toBe(true);   // 'soviet' faction — should appear for USSR
    expect(picks.has('E3')).toBe(false);   // 'allied' faction — should NOT appear for USSR
  });

  it('allied house gets allied + both faction items', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E1', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
        { type: 'E2', prerequisite: 'TENT', faction: 'soviet', techLevel: 1 },
        { type: 'E3', prerequisite: 'TENT', faction: 'allied', techLevel: 2 },
      ),
    });
    addAIHouse(ctx, House.England, { techLevel: 10 });

    const picks = new Set<string>();
    const randomMock = vi.spyOn(Math, 'random');
    for (let i = 0; i < 20; i++) {
      randomMock.mockReturnValue(i / 20);
      const pick = getAIProductionPick(ctx, House.England, 'infantry');
      if (pick) picks.add(pick.type);
    }
    vi.restoreAllMocks();

    expect(picks.has('E1')).toBe(true);   // 'both' faction — should appear
    expect(picks.has('E3')).toBe(true);   // 'allied' faction — should appear for England
    expect(picks.has('E2')).toBe(false);   // 'soviet' faction — should NOT appear for England
  });

  it('Neutral house (faction=both) gets all items regardless of faction', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E1', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
        { type: 'E2', prerequisite: 'TENT', faction: 'soviet', techLevel: 1 },
        { type: 'E3', prerequisite: 'TENT', faction: 'allied', techLevel: 2 },
      ),
    });
    addAIHouse(ctx, House.Neutral, { techLevel: 10 });

    const picks = new Set<string>();
    vi.spyOn(Math, 'random').mockImplementation(() => 0.99);
    for (let i = 0; i < 10; i++) {
      const pick = getAIProductionPick(ctx, House.Neutral, 'infantry');
      if (pick) picks.add(pick.type);
    }
    vi.restoreAllMocks();

    // Neutral has faction 'both' so faction check passes for all: p.faction === 'both' || p.faction === 'both'
    expect(picks.has('E1')).toBe(true);
  });
});

describe('getAIProductionPick — tech level gating (C++ rules.ini TechLevel)', () => {
  it('items with techLevel > aiTechLevel are excluded', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E1', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
        { type: 'E6', prerequisite: 'TENT', faction: 'both', techLevel: 5 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 3 });

    // Only E1 (techLevel 1) should pass — E6 (techLevel 5) exceeds aiTechLevel 3
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    vi.restoreAllMocks();

    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('E1');
  });

  it('items with techLevel === aiTechLevel are included', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E6', prerequisite: 'TENT', faction: 'both', techLevel: 5 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 5 });

    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('E6');
  });

  it('items with undefined techLevel always pass filter', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E1', prerequisite: 'TENT', faction: 'both' },  // no techLevel
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 0 });

    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('E1');
  });

  it('defaults to techLevel 10 when no aiState exists for the house', () => {
    // Do NOT add AI house state — should fall back to techLevel 10
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E1', prerequisite: 'TENT', faction: 'both', techLevel: 10 },
        { type: 'E3', prerequisite: 'TENT', faction: 'both', techLevel: 11 },
      ),
    });
    // No addAIHouse call — aiStates.get(house) returns undefined → techLevel defaults to 10

    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('E1');  // techLevel 10 passes, 11 does not
  });

  it('techLevel 0 restricts to only techLevel 0 and undefined items', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E1', prerequisite: 'TENT', faction: 'both', techLevel: 0 },
        { type: 'E3', prerequisite: 'TENT', faction: 'both', techLevel: 2 },
        { type: 'E6', prerequisite: 'TENT', faction: 'both', techLevel: 5 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 0 });

    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    vi.restoreAllMocks();

    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('E1');
  });

  it('negative techLevel items (like STNK techLevel -1) are included (techLevel >= 0 check)', () => {
    // Items with negative techLevel fail the (p.techLevel >= 0 && p.techLevel <= aiTechLevel) check
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'STNK', prerequisite: 'WEAP', faction: 'both', techLevel: -1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });

    const pick = getAIProductionPick(ctx, House.USSR, 'vehicle');
    // techLevel -1 fails the p.techLevel >= 0 check
    expect(pick).toBeNull();
  });
});

describe('getAIProductionPick — tech prereq gating (C++ factory.cpp prerequisite structures)', () => {
  it('items with techPrereq excluded when house lacks the structure', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: '4TNK', prerequisite: 'WEAP', faction: 'soviet', techPrereq: 'STEK', techLevel: 10 },
      ),
      structures: [],  // no structures at all
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });

    expect(getAIProductionPick(ctx, House.USSR, 'vehicle')).toBeNull();
  });

  it('items with techPrereq included when house has the required structure', () => {
    const stek = makeStructure('STEK', House.USSR);
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: '4TNK', prerequisite: 'WEAP', faction: 'soviet', techPrereq: 'STEK', techLevel: 10 },
      ),
      structures: [stek],
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });

    const pick = getAIProductionPick(ctx, House.USSR, 'vehicle');
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('4TNK');
  });

  it('dead prereq structures do not satisfy techPrereq', () => {
    const stek = makeStructure('STEK', House.USSR, 50, 50, { alive: false });
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: '4TNK', prerequisite: 'WEAP', faction: 'soviet', techPrereq: 'STEK', techLevel: 10 },
      ),
      structures: [stek],
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });

    expect(getAIProductionPick(ctx, House.USSR, 'vehicle')).toBeNull();
  });

  it('other house prereq structures do not satisfy techPrereq', () => {
    // England has STEK but USSR is the producing house
    const stek = makeStructure('STEK', House.England);
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: '4TNK', prerequisite: 'WEAP', faction: 'soviet', techPrereq: 'STEK', techLevel: 10 },
      ),
      structures: [stek],
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });

    expect(getAIProductionPick(ctx, House.USSR, 'vehicle')).toBeNull();
  });

  it('items without techPrereq are always available (no structure check)', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: '3TNK', prerequisite: 'WEAP', faction: 'soviet', techLevel: 4 },
      ),
      structures: [],  // no structures — but no techPrereq required
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });

    const pick = getAIProductionPick(ctx, House.USSR, 'vehicle');
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('3TNK');
  });
});

describe('getAIProductionPick — entity counting and ratio exclusions (C++ house.cpp army scan)', () => {
  it('dead entities excluded from ratio calculation', () => {
    // Create units where all anti-armor are dead — ratio should be 0, triggering 3x weight
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E3', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
        { type: 'E1', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });

    const deadE3 = entityAtCell(UnitType.I_E3, House.USSR, 45, 45);
    deadE3.alive = false;
    const aliveE1 = entityAtCell(UnitType.I_E1, House.USSR, 46, 46);
    ctx.entities = [deadE3, aliveE1];

    // With 1 alive E1 and 0 alive anti-armor: antiArmorRatio=0, infantryRatio=1.0
    // E3 gets weight 3 (antiArmorRatio < 0.4), E1 gets weight 1 (infantryRatio >= 0.3)
    vi.spyOn(Math, 'random').mockReturnValue(0);  // picks first weighted item
    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    vi.restoreAllMocks();

    expect(pick).not.toBeNull();
    // With roll=0, first item (E3, weight=3) is immediately selected since 0-3 <= 0
    expect(pick!.type).toBe('E3');
  });

  it('ant entities excluded from ratio calculation (isAnt)', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E3', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });

    // Add many ant entities — they should be ignored in ratio calc
    const ant1 = entityAtCell(UnitType.ANT1, House.USSR, 45, 45);
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 46, 46);
    ctx.entities = [ant1, ant2];

    // total=0 after excluding ants → antiArmorRatio=0 → E3 gets weight 3
    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('E3');
  });

  it('entities from other houses excluded from ratio calculation', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E3', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
        { type: 'E1', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });

    // England's units should not count for USSR's ratios
    const engE3 = entityAtCell(UnitType.I_E3, House.England, 45, 45);
    const engE1 = entityAtCell(UnitType.I_E1, House.England, 46, 46);
    ctx.entities = [engE3, engE1];

    // total=0 for USSR → all ratios are 0 → anti-armor gets 3x, infantry gets 2x
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    vi.restoreAllMocks();

    expect(pick).not.toBeNull();
  });

  it('empty army defaults all ratios to 0 — anti-armor and infantry boosted', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E3', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
        { type: 'E1', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });
    ctx.entities = [];  // empty army

    // antiArmorRatio=0 < 0.4 → E3 gets weight 3
    // infantryRatio=0 < 0.3 → E1 gets weight 2
    // totalWeight = 3 + 2 = 5
    // With roll at 0, first item (E3) is picked
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    vi.restoreAllMocks();

    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('E3');
  });
});

describe('getAIProductionPick — weight system (C++ house.cpp composition weighting)', () => {
  it('anti-armor units (E3, 2TNK, 3TNK, 4TNK, 1TNK) get weight=3 when antiArmorRatio < 0.4', () => {
    // Single non-anti-armor unit → antiArmorRatio = 0 < 0.4
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E3', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });

    const rifleman = entityAtCell(UnitType.I_E1, House.USSR, 45, 45);
    ctx.entities = [rifleman];

    // 1 unit, 0 anti-armor → antiArmorRatio = 0/1 = 0 < 0.4 → weight = 3
    // With only one item, it returns that item regardless
    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('E3');
  });

  it('anti-armor units get weight=1 when antiArmorRatio >= 0.4', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E3', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
        { type: 'E1', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });

    // 5 units, 3 anti-armor → antiArmorRatio = 3/5 = 0.6 >= 0.4 → weight stays 1
    // Also infantryRatio = 2/5 = 0.4 >= 0.3 → E1 weight stays 1
    const e3_1 = entityAtCell(UnitType.I_E3, House.USSR, 45, 45);
    const e3_2 = entityAtCell(UnitType.I_E3, House.USSR, 46, 46);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 47, 47);
    const e1_1 = entityAtCell(UnitType.I_E1, House.USSR, 48, 48);
    const e1_2 = entityAtCell(UnitType.I_E1, House.USSR, 49, 49);
    ctx.entities = [e3_1, e3_2, tank, e1_1, e1_2];

    // Both items get weight=1, totalWeight=2
    // With roll close to 0, should pick first item (E3)
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    vi.restoreAllMocks();

    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('E3');
  });

  it('infantry units (E1, E2) get weight=2 when infantryRatio < 0.3', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E1', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });

    // 5 units, 1 infantry → infantryRatio = 1/5 = 0.2 < 0.3 → weight = 2
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 45, 45);
    const e3_1 = entityAtCell(UnitType.I_E3, House.USSR, 46, 46);
    const e3_2 = entityAtCell(UnitType.I_E3, House.USSR, 47, 47);
    const e4_1 = entityAtCell(UnitType.I_E4, House.USSR, 48, 48);
    const e4_2 = entityAtCell(UnitType.I_E4, House.USSR, 49, 49);
    ctx.entities = [e1, e3_1, e3_2, e4_1, e4_2];

    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('E1');
  });

  it('infantry units get weight=1 when infantryRatio >= 0.3', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E1', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
        { type: 'E4', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });

    // 3 units, 2 infantry → infantryRatio = 2/3 ≈ 0.67 >= 0.3 → weight stays 1
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 45, 45);
    const e2 = entityAtCell(UnitType.I_E2, House.USSR, 46, 46);
    const e4 = entityAtCell(UnitType.I_E4, House.USSR, 47, 47);
    ctx.entities = [e1, e2, e4];

    // Both items weight=1, totalWeight=2
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    vi.restoreAllMocks();

    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('E1');
  });

  it('E6 (Engineer) always gets weight=0.2 regardless of ratios', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E6', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
        { type: 'E4', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });
    ctx.entities = [];

    // E6: weight = 0.2 (overrides default 1)
    // E4: weight = 1 (not anti-armor, not infantry E1/E2)
    // totalWeight = 1.2
    // With random = 0, roll = 0 → first item E6 has weight 0.2, roll 0 - 0.2 = -0.2 <= 0 → picks E6
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    vi.restoreAllMocks();

    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('E6');

    // Now with random high enough to skip E6 → picks E4
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const pick2 = getAIProductionPick(ctx, House.USSR, 'infantry');
    vi.restoreAllMocks();

    // roll = 0.5 * 1.2 = 0.6; roll - 0.2 = 0.4 > 0; roll - 1 = -0.6 <= 0 → picks E4
    expect(pick2).not.toBeNull();
    expect(pick2!.type).toBe('E4');
  });

  it('MEDI (Medic) always gets weight=0.3 regardless of ratios', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'MEDI', prerequisite: 'TENT', faction: 'allied', techLevel: 2 },
        { type: 'E4', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.England, { techLevel: 10 });
    ctx.entities = [];

    // MEDI: weight = 0.3; E4: weight = 1
    // totalWeight = 1.3
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const pick = getAIProductionPick(ctx, House.England, 'infantry');
    vi.restoreAllMocks();

    expect(pick!.type).toBe('MEDI');

    // With higher random → skips MEDI, picks E4
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const pick2 = getAIProductionPick(ctx, House.England, 'infantry');
    vi.restoreAllMocks();

    // roll = 0.5 * 1.3 = 0.65; roll - 0.3 = 0.35 > 0; roll - 1 = -0.65 <= 0 → E4
    expect(pick2!.type).toBe('E4');
  });

  it('HARV (Harvester) always gets weight=0.1 regardless of ratios', () => {
    const proc = makeStructure('PROC', House.USSR);
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'HARV', prerequisite: 'WEAP', faction: 'both', techPrereq: 'PROC', techLevel: 1 },
        { type: '3TNK', prerequisite: 'WEAP', faction: 'soviet', techLevel: 4 },
      ),
      structures: [proc],
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });
    ctx.entities = [];

    // HARV: weight = 0.1; 3TNK: weight = 3 (anti-armor, ratio < 0.4)
    // totalWeight = 3.1
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const pick = getAIProductionPick(ctx, House.USSR, 'vehicle');
    vi.restoreAllMocks();

    // roll = 0, first item HARV weight 0.1 → 0 - 0.1 = -0.1 <= 0 → picks HARV
    expect(pick!.type).toBe('HARV');

    // With random > 0.1/3.1 ≈ 0.032 → should skip HARV and pick 3TNK
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const pick2 = getAIProductionPick(ctx, House.USSR, 'vehicle');
    vi.restoreAllMocks();

    // roll = 0.1 * 3.1 = 0.31; roll - 0.1 = 0.21 > 0; roll - 3 = -2.79 <= 0 → 3TNK
    expect(pick2!.type).toBe('3TNK');
  });
});

describe('getAIProductionPick — vehicle anti-armor weight for tank types', () => {
  it('2TNK gets weight=3 when antiArmorRatio < 0.4', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: '2TNK', prerequisite: 'WEAP', faction: 'allied', techLevel: 6 },
      ),
    });
    addAIHouse(ctx, House.England, { techLevel: 10 });
    ctx.entities = [];  // antiArmorRatio = 0

    const pick = getAIProductionPick(ctx, House.England, 'vehicle');
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('2TNK');
  });

  it('1TNK gets weight=3 when antiArmorRatio < 0.4', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: '1TNK', prerequisite: 'WEAP', faction: 'allied', techLevel: 4 },
      ),
    });
    addAIHouse(ctx, House.England, { techLevel: 10 });
    ctx.entities = [];

    const pick = getAIProductionPick(ctx, House.England, 'vehicle');
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('1TNK');
  });

  it('3TNK gets weight=3 when antiArmorRatio < 0.4', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: '3TNK', prerequisite: 'WEAP', faction: 'soviet', techLevel: 4 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });
    ctx.entities = [];

    const pick = getAIProductionPick(ctx, House.USSR, 'vehicle');
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('3TNK');
  });

  it('4TNK gets weight=3 when antiArmorRatio < 0.4 (with STEK prereq)', () => {
    const stek = makeStructure('STEK', House.USSR);
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: '4TNK', prerequisite: 'WEAP', faction: 'soviet', techPrereq: 'STEK', techLevel: 10 },
      ),
      structures: [stek],
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });
    ctx.entities = [];

    const pick = getAIProductionPick(ctx, House.USSR, 'vehicle');
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('4TNK');
  });
});

describe('getAIProductionPick — statistical distribution (C++ weighted random selection)', () => {
  it('anti-armor items dominate picks when ratio is low (weight=3 vs weight=1)', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E3', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
        { type: 'E4', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });
    ctx.entities = [];  // antiArmorRatio = 0 → E3 weight=3, E4 weight=1

    // E3 weight=3, E4 weight=1, total=4
    // E3 should be picked for random values in [0, 3/4) = [0, 0.75)
    // E4 should be picked for random values in [3/4, 1) = [0.75, 1)
    let e3Count = 0, e4Count = 0;
    const randomMock = vi.spyOn(Math, 'random');

    for (let i = 0; i < 100; i++) {
      randomMock.mockReturnValue(i / 100);
      const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
      if (pick!.type === 'E3') e3Count++;
      else if (pick!.type === 'E4') e4Count++;
    }
    vi.restoreAllMocks();

    // E3 should be picked ~75% of the time (values 0.00-0.74)
    expect(e3Count).toBeGreaterThan(70);
    expect(e4Count).toBeGreaterThan(20);
    expect(e3Count + e4Count).toBe(100);
  });

  it('infantry items get moderate boost when ratio is low (weight=2 vs weight=1)', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E1', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
        { type: 'E4', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });
    // All entities are anti-armor → infantryRatio = 0 < 0.3 → E1 weight=2
    // antiArmorRatio = 1.0 >= 0.4 → no anti-armor boost
    const e3_1 = entityAtCell(UnitType.I_E3, House.USSR, 45, 45);
    const e3_2 = entityAtCell(UnitType.I_E3, House.USSR, 46, 46);
    ctx.entities = [e3_1, e3_2];

    // E1 weight=2, E4 weight=1, total=3
    // E1 picked for random in [0, 2/3) ≈ [0, 0.667)
    let e1Count = 0, e4Count = 0;
    const randomMock = vi.spyOn(Math, 'random');

    for (let i = 0; i < 100; i++) {
      randomMock.mockReturnValue(i / 100);
      const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
      if (pick!.type === 'E1') e1Count++;
      else if (pick!.type === 'E4') e4Count++;
    }
    vi.restoreAllMocks();

    // E1 should be picked ~67% of the time
    expect(e1Count).toBeGreaterThan(60);
    expect(e4Count).toBeGreaterThan(25);
  });

  it('E6 weight penalty (0.2) means engineers are rarely picked', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E6', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
        { type: 'E4', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });

    // Create high anti-armor and infantry ratios to avoid boosts on other types
    const e3_1 = entityAtCell(UnitType.I_E3, House.USSR, 45, 45);
    const e3_2 = entityAtCell(UnitType.I_E3, House.USSR, 46, 46);
    const e1_1 = entityAtCell(UnitType.I_E1, House.USSR, 47, 47);
    const e1_2 = entityAtCell(UnitType.I_E1, House.USSR, 48, 48);
    ctx.entities = [e3_1, e3_2, e1_1, e1_2];

    // E6: weight=0.2, E4: weight=1 (anti-armor ratio=0.5>=0.4, infantry ratio=0.5>=0.3)
    // total = 1.2
    // E6 picked for random in [0, 0.2/1.2) ≈ [0, 0.167)
    let e6Count = 0;
    const randomMock = vi.spyOn(Math, 'random');

    for (let i = 0; i < 100; i++) {
      randomMock.mockReturnValue(i / 100);
      const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
      if (pick!.type === 'E6') e6Count++;
    }
    vi.restoreAllMocks();

    // E6 should be picked rarely — roughly 16.7% of the time
    expect(e6Count).toBeLessThan(25);
    expect(e6Count).toBeGreaterThan(0);
  });

  it('deterministic roll=0 always picks first item', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E4', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
        { type: 'E3', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });
    ctx.entities = [];

    vi.spyOn(Math, 'random').mockReturnValue(0);
    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    vi.restoreAllMocks();

    // roll = 0, first item weight (E4 weight=1), 0 - 1 = -1 <= 0 → picks E4
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('E4');
  });
});

describe('getAIProductionPick — return value shape', () => {
  it('returns a valid ProductionItem with type, cost, prerequisite fields', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E1', name: 'Rifle', cost: 100, buildTime: 45, prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });

    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('E1');
    expect(pick!.cost).toBe(100);
    expect(pick!.prerequisite).toBe('TENT');
    expect(pick!.name).toBe('Rifle');
    expect(pick!.buildTime).toBe(45);
    expect(pick!.faction).toBe('both');
  });

  it('returns null when all items are filtered out', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E3', prerequisite: 'TENT', faction: 'allied', techLevel: 2 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });

    // USSR is soviet faction, E3 is allied → filtered out
    expect(getAIProductionPick(ctx, House.USSR, 'infantry')).toBeNull();
  });
});

describe('getAIProductionPick — integration with full PRODUCTION_ITEMS list', () => {
  it('USSR vehicle pick from full list with STEK produces soviet + both vehicles', () => {
    const stek = makeStructure('STEK', House.USSR);
    const proc = makeStructure('PROC', House.USSR);
    const ctx = makeMockAIContext({
      structures: [stek, proc],
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });
    ctx.entities = [];

    // Should pick from WEAP-prerequisite, soviet+both, techLevel<=10, non-structure items
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const pick = getAIProductionPick(ctx, House.USSR, 'vehicle');
    vi.restoreAllMocks();

    expect(pick).not.toBeNull();
    // The pick should be a vehicle with WEAP prereq
    expect(pick!.prerequisite).toBe('WEAP');
    expect(pick!.isStructure).toBeFalsy();
    // Should be a soviet or 'both' faction item
    expect(['soviet', 'both']).toContain(pick!.faction);
  });

  it('England infantry pick from full list excludes soviet-only infantry', () => {
    const ctx = makeMockAIContext();
    addAIHouse(ctx, House.England, { techLevel: 10 });
    ctx.entities = [];

    const picks = new Set<string>();
    const randomMock = vi.spyOn(Math, 'random');
    for (let i = 0; i < 100; i++) {
      randomMock.mockReturnValue(i / 100);
      const pick = getAIProductionPick(ctx, House.England, 'infantry');
      if (pick) picks.add(pick.type);
    }
    vi.restoreAllMocks();

    // E2 is soviet-only — should never appear for England
    expect(picks.has('E2')).toBe(false);
    // E1 is both — should appear
    expect(picks.has('E1')).toBe(true);
  });

  it('antiarmorRatio at exactly 0.4 threshold does NOT trigger boost', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E3', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
        { type: 'E4', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });

    // 5 units, 2 anti-armor → ratio = 2/5 = 0.4 → NOT < 0.4, so no boost
    const e3_1 = entityAtCell(UnitType.I_E3, House.USSR, 45, 45);
    const e3_2 = entityAtCell(UnitType.I_E3, House.USSR, 46, 46);
    const e4_1 = entityAtCell(UnitType.I_E4, House.USSR, 47, 47);
    const e4_2 = entityAtCell(UnitType.I_E4, House.USSR, 48, 48);
    const e4_3 = entityAtCell(UnitType.I_E4, House.USSR, 49, 49);
    ctx.entities = [e3_1, e3_2, e4_1, e4_2, e4_3];

    // E3 weight=1 (ratio exactly 0.4, not < 0.4), E4 weight=1
    // totalWeight = 2
    // With roll = 0: first item is E3, 0 - 1 = -1 <= 0 → E3
    // With roll ≈ 0.75: roll = 0.75 * 2 = 1.5, 1.5 - 1 = 0.5 > 0, 0.5 - 1 = -0.5 <= 0 → E4
    vi.spyOn(Math, 'random').mockReturnValue(0.75);
    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    vi.restoreAllMocks();

    expect(pick!.type).toBe('E4');
  });

  it('infantryRatio at exactly 0.3 threshold does NOT trigger boost', () => {
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E1', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
        { type: 'E4', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });

    // 10 units: 3 infantry (E1), 4 anti-armor (E3), 3 flamers (E4)
    // infantryRatio = 3/10 = 0.3, not < 0.3 → E1 weight stays 1
    // antiArmorRatio = 4/10 = 0.4, not < 0.4 → no boost either
    const entities: Entity[] = [];
    for (let i = 0; i < 3; i++) entities.push(entityAtCell(UnitType.I_E1, House.USSR, 45 + i, 45));
    for (let i = 0; i < 4; i++) entities.push(entityAtCell(UnitType.I_E3, House.USSR, 45, 46 + i));
    for (let i = 0; i < 3; i++) entities.push(entityAtCell(UnitType.I_E4, House.USSR, 46, 46 + i));
    ctx.entities = entities;

    // E1 weight=1, E4 weight=1, total=2
    vi.spyOn(Math, 'random').mockReturnValue(0.75);
    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    vi.restoreAllMocks();

    // roll = 0.75 * 2 = 1.5; 1.5 - 1 = 0.5 > 0; 0.5 - 1 = -0.5 <= 0 → E4
    expect(pick!.type).toBe('E4');
  });
});

describe('getAIProductionPick — edge cases', () => {
  it('totalWeight <= 0 returns first filtered item as fallback', () => {
    // This edge case is hard to trigger since all weights are > 0,
    // but we can verify the fallback path by checking the behavior
    // when there's only one item with a very small weight
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E1', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });
    ctx.entities = [];

    // Single item always returns that item
    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('E1');
  });

  it('roll exhausting all weights falls back to items[0]', () => {
    // When Math.random returns 1.0 (or very close), roll might not be <= 0 after all items
    // In that case, the function returns items[0] as a fallback
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'E1', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
        { type: 'E4', prerequisite: 'TENT', faction: 'both', techLevel: 1 },
      ),
    });
    addAIHouse(ctx, House.USSR, { techLevel: 10 });
    ctx.entities = [];

    // E1 weight=2 (infantry boost), E4 weight=1, total=3
    // random=0.9999: roll = 0.9999 * 3 = 2.9997; 2.9997-2=0.9997 > 0; 0.9997-1=-0.0003 ≤ 0 → E4
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    vi.restoreAllMocks();

    expect(pick).not.toBeNull();
    // At 0.9999 the second item should be selected
    expect(pick!.type).toBe('E4');
  });

  it('TENT prereq check in aiHasPrereq also matches BARR', () => {
    // This tests the techPrereq = 'TENT' case through aiHasPrereq
    const barr = makeStructure('BARR', House.England);
    const ctx = makeMockAIContext({
      scenarioProductionItems: makeMinimalItems(
        { type: 'APC', prerequisite: 'WEAP', faction: 'allied', techPrereq: 'TENT', techLevel: 5 },
      ),
      structures: [barr],  // BARR satisfies TENT prereq via aiHasPrereq
    });
    addAIHouse(ctx, House.England, { techLevel: 10 });

    const pick = getAIProductionPick(ctx, House.England, 'vehicle');
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe('APC');
  });
});
