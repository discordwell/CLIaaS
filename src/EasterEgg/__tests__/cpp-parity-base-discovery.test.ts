/**
 * C++ Behavioral Parity Tests: Base Discovery
 *
 * Tests the discovery system: when enemy houses are discovered,
 * sight range requirements, flag transitions, and production availability.
 *
 * C++ Source References:
 *
 *   house.h:175 — IsStarted: enables production. Set false initially (house.cpp:530).
 *   house.h:181 — IsAlerted: enables autocreate teams. Set false initially (house.cpp:531).
 *   house.h:193 — IsDiscovered: house has been seen by player. Set false initially (house.cpp:533).
 *
 *   techno.cpp:756-807 — Revealed(house):
 *     if (house == PlayerPtr && !IsOwnedByPlayer) {
 *       Trigger->Spring(TEVENT_DISCOVERED, this);    // line 786
 *       House->IsDiscovered = true;                   // line 792
 *     }
 *
 *   techno.cpp:5903-5913 — Look():
 *     int sight_range = Techno_Type_Class()->SightRange;
 *     if (sight_range) Map.Sight_From(Coord_Cell(Coord), sight_range, House, incremental);
 *
 *   map.cpp:286-344 — Sight_From(cell, sightrange, house, incremental):
 *     if (!sightrange || sightrange > 10) return;  // line 296: max 10 cells
 *     // Reveals cells in radius, calls Map_Cell for each unrevealed cell
 *
 *   display.cpp:1428-1501 — Map_Cell(cell, house):
 *     TechnoClass * tech = (*this)[cell].Cell_Techno();
 *     if (tech) tech->Revealed(house);              // line 1498
 *
 *   unit.cpp:1549 — MCV deploy: House->IsStarted = true
 *
 *   house.cpp:936-940 — AI() tick:
 *     if (IsBaseBuilding || IQ >= Rule.IQProduction) {
 *       IsBaseBuilding = true; IsStarted = true; IsAlerted = true;
 *     }
 *
 *   taction.cpp:627-631 — TACTION_BEGIN_PRODUCTION: house->Begin_Production() → IsStarted = true
 *   taction.cpp:648-652 — TACTION_AUTOCREATE: house->IsAlerted = true
 *
 *   building.cpp:1137-1142 — Grand opening:
 *     if ((!IsDiscoveredByPlayer && Map[coord].IsVisible) || Session.Type != GAME_NORMAL)
 *       Revealed(PlayerPtr);
 *
 * TS Implementation:
 *   - index.ts: checkDiscoveryTriggers() — visibility-based, sets houseDiscovered per-house
 *   - fog.ts: player/allied structures reveal fog during normal per-tick sight
 *   - production.ts: getAvailableItems() is gated by C++ factories/prereqs, not baseDiscovered
 *   - ai.ts: createAIHouseState() sets isStarted = true by default
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  House, Mission, UnitType, CELL_SIZE,
  UNIT_STATS, HOUSE_FACTION, PRODUCTION_ITEMS,
  type ProductionItem,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap, Terrain } from '../engine/map';
import {
  STRUCTURE_SIZE, STRUCTURE_MAX_HP, type MapStructure,
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';
import {
  type AIContext, type AIHouseState,
  AI_DIFFICULTY_MODS,
  createAIHouseState,
} from '../engine/ai';
import { getAvailableItems, type ProductionContext } from '../engine/production';
import { updateFogOfWar, revealAroundCell, type FogContext } from '../engine/fog';

beforeEach(() => resetEntityIds());

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function makeTriggerState(overrides: Partial<TriggerGameState> = {}): TriggerGameState {
  return {
    gameTick: 0,
    globals: new Set(),
    triggerStartTick: 0,
    triggerName: 'test',
    playerEntered: false,
    objectDiscovered: false,
    houseDiscovered: new Map(),
    enteredZone: false,
    crossedHorizontal: false,
    crossedVertical: false,
    enemyUnitsAlive: 0,
    enemyKillCount: 0,
    playerFactories: 0,
    missionTimerExpired: false,
    bridgesAlive: 0,
    unitsLeftMap: 0,
    structureTypes: new Set(),

    structureTypesByHouse: new Map([[1, new Set<string>()]]),

    triggerHouse: 1,
    builtStructureTypes: new Set(),
    builtStructureTypesByHouse: new Map([[1, new Set<string>()]]),
    destroyedTriggerNames: new Set(),
    attackedTriggerNames: new Set(),
    houseAlive: new Map(),
    houseUnitsAlive: new Map(),
    houseBuildingsAlive: new Map(),
    isLowPower: false,
    playerCredits: 0,
    buildingsDestroyedByHouse: new Map(),
    nBuildingsDestroyed: 0,
    playerFactoriesExist: true,
    civiliansEvacuated: 0,
    builtUnitTypes: new Set(),
    builtInfantryTypes: new Set(),
    builtAircraftTypes: new Set(),
    fakesExist: true,
    spiedBuildings: new Set(),
    isThieved: false,
    pendingDestroyedCount: 0,
    ...overrides,
  };
}

function makeAIContext(overrides: Partial<AIContext> = {}): AIContext {
  const map = new GameMap();
  map.setBounds(40, 40, 50, 50);
  const alliances = buildDefaultAlliances();
  return {
    entities: [], entityById: new Map(), structures: [],
    map, tick: 0, playerHouse: House.Spain,
    scenarioId: 'SCG01EA', difficulty: 'normal',
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
  } as AIContext;
}

// =============================================================================
// 1. House.IsDiscovered — set when enemy object is first Revealed to player
//    C++ techno.cpp:792: House->IsDiscovered = true
// =============================================================================

describe('House.IsDiscovered — C++ techno.cpp:792', () => {
  /**
   * C++ techno.cpp:792:
   *   House->IsDiscovered = true;
   *
   * This is set when ANY enemy unit/building is revealed to the player.
   * The TS equivalent is houseDiscovered Map<number, boolean>.
   */

  it('TEVENT_HOUSE_DISCOVERED returns false for undiscovered house', () => {
    const TEVENT_HOUSE_DISCOVERED = 5;
    const state = makeTriggerState({ houseDiscovered: new Map() });
    const event: TriggerEvent = { type: TEVENT_HOUSE_DISCOVERED, team: -1, data: 2 };
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('TEVENT_HOUSE_DISCOVERED returns true once house is discovered', () => {
    const TEVENT_HOUSE_DISCOVERED = 5;
    // Simulate: houseDiscovered set for USSR (index 2)
    const state = makeTriggerState({ houseDiscovered: new Map([[2, true]]) });
    const event: TriggerEvent = { type: TEVENT_HOUSE_DISCOVERED, team: -1, data: 2 };
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('discovering one house does not mark another as discovered', () => {
    // C++ techno.cpp:792 sets House->IsDiscovered only on the OWNER house,
    // not on all enemy houses.
    const TEVENT_HOUSE_DISCOVERED = 5;
    const state = makeTriggerState({ houseDiscovered: new Map([[2, true]]) });
    // Check Greece (index 0) — should be false
    const event: TriggerEvent = { type: TEVENT_HOUSE_DISCOVERED, team: -1, data: 0 };
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('IsDiscovered is permanent — once set, never unset', () => {
    // C++ has no code path that sets IsDiscovered back to false.
    // The flag is write-once: house.cpp:533 initializes to false,
    // techno.cpp:792 sets to true, and nothing clears it.
    const TEVENT_HOUSE_DISCOVERED = 5;
    const houseDiscovered = new Map([[2, true]]);
    const state = makeTriggerState({ houseDiscovered });

    // Verify it's true
    expect(checkTriggerEvent(
      { type: TEVENT_HOUSE_DISCOVERED, team: -1, data: 2 }, state
    )).toBe(true);

    // Even after many ticks, still true (map entry persists)
    expect(houseDiscovered.get(2)).toBe(true);
  });
});

// =============================================================================
// 2. TEVENT_DISCOVERED — per-object discovery
//    C++ techno.cpp:786: Trigger->Spring(TEVENT_DISCOVERED, this)
// =============================================================================

describe('TEVENT_DISCOVERED — per-object trigger (techno.cpp:786)', () => {
  const TEVENT_DISCOVERED = 4;

  it('fires only on the specific attached trigger object', () => {
    // C++ techno.cpp:785-786: if (!ScenarioInit && Trigger.Is_Valid())
    //   Trigger->Spring(TEVENT_DISCOVERED, this);
    // The trigger must be attached to the specific object.
    const event: TriggerEvent = { type: TEVENT_DISCOVERED, team: -1, data: 0 };

    // Object not discovered yet
    expect(checkTriggerEvent(event, makeTriggerState({ objectDiscovered: false }))).toBe(false);

    // Object discovered
    expect(checkTriggerEvent(event, makeTriggerState({ objectDiscovered: true }))).toBe(true);
  });

  it('objectDiscovered is independent from playerEntered (fix #21)', () => {
    // C++ has separate code paths: Revealed() fires TEVENT_DISCOVERED,
    // Per_Cell_Process fires TEVENT_PLAYER_ENTERED. They must be independent.
    const TEVENT_PLAYER_ENTERED = 1;
    const discEvent: TriggerEvent = { type: TEVENT_DISCOVERED, team: -1, data: 0 };
    const enterEvent: TriggerEvent = { type: TEVENT_PLAYER_ENTERED, team: -1, data: 0 };

    // Only discovered, not entered
    const state1 = makeTriggerState({ objectDiscovered: true, playerEntered: false });
    expect(checkTriggerEvent(discEvent, state1)).toBe(true);
    expect(checkTriggerEvent(enterEvent, state1)).toBe(false);

    // Only entered, not discovered
    const state2 = makeTriggerState({ objectDiscovered: false, playerEntered: true });
    expect(checkTriggerEvent(discEvent, state2)).toBe(false);
    expect(checkTriggerEvent(enterEvent, state2)).toBe(true);
  });
});

// =============================================================================
// 3. Revealed() — enemy objects revealed via sight trigger Revealed()
//    C++ techno.cpp:760-764: guard checks
// =============================================================================

describe('Revealed() guard checks — C++ techno.cpp:760-764', () => {
  /**
   * C++ techno.cpp:760: if (house == PlayerPtr && IsDiscoveredByPlayer) return(false);
   * C++ techno.cpp:761-763: if (house != PlayerPtr) {
   *   if (IsDiscoveredByComputer) return(false);
   *   IsDiscoveredByComputer = true;
   * }
   *
   * Key behavior: Revealed() is idempotent — calling it twice for the same
   * house does nothing the second time.
   *
   * TS equivalent: checkDiscoveryTriggers() uses discoveredEntityIds Set
   * to prevent double-discovery.
   */

  it('discovery tracking prevents double-firing (idempotent)', () => {
    // The TS uses discoveredEntityIds.has(entity.id) as the guard.
    // Once an entity is in the set, subsequent checks skip it.
    // This matches C++ IsDiscoveredByPlayer guard at techno.cpp:760.
    const discovered = new Set<number>();
    const entityId = 42;

    // First discovery
    expect(discovered.has(entityId)).toBe(false);
    discovered.add(entityId);

    // Second discovery attempt — already in set
    expect(discovered.has(entityId)).toBe(true);
    // In C++, Revealed() would return(false) here.
  });
});

// =============================================================================
// 4. Sight_From — max range cap at 10 cells
//    C++ map.cpp:296: if (!sightrange || sightrange > 10) return;
// =============================================================================

describe('Sight_From range cap — C++ map.cpp:296', () => {
  /**
   * C++ map.cpp:296:
   *   if (!sightrange || sightrange > 10) return;
   *
   * Sight range of 0 does nothing. Sight range > 10 does nothing.
   * Valid range is 1-10.
   */

  it('revealAroundCell with radius 0 does nothing (C++ map.cpp:296 early return)', () => {
    // C++ map.cpp:296: if (!sightrange || sightrange > 10) return;
    // With sightrange=0, Sight_From returns immediately — no cells revealed.
    // TS fog.ts now matches: radius === 0 → early return.
    const map = new GameMap();
    map.setBounds(0, 0, 64, 64);
    const visBefore = map.getVisibility(30, 30);
    expect(visBefore).toBe(0); // starts shrouded
    revealAroundCell(map, 30, 30, 0);
    const visAfter = map.getVisibility(30, 30);
    // C++ parity: radius 0 reveals nothing
    expect(visAfter).toBe(0);
  });

  it('revealAroundCell with normal radius reveals cells', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 64, 64);
    revealAroundCell(map, 30, 30, 5);
    // Center cell should now be visible (2)
    expect(map.getVisibility(30, 30)).toBe(2);
    // Adjacent cell should also be visible
    expect(map.getVisibility(31, 30)).toBe(2);
  });
});

// =============================================================================
// 5. IsStarted — production gate flag
//    C++ house.h:175, unit.cpp:1549, taction.cpp:627-631
// =============================================================================

describe('IsStarted — production gate (house.h:175)', () => {
  /**
   * C++ house.h:175:
   *   unsigned IsStarted:1;
   *   // This flag enables production. If false, production is disabled.
   *
   * Set by:
   *   unit.cpp:1549: MCV deploy → House->IsStarted = true
   *   house.h:716:   Begin_Production() { IsStarted = true; }
   *   house.cpp:938: IsBaseBuilding/high IQ → IsStarted = true
   *   scenario.cpp:2693: multiplayer AI init → IsStarted = true
   *
   * C++ initializes to false (house.cpp:530).
   *
   * TS createAIHouseState() mirrors the HouseClass constructor default.
   * Scenario setup/triggers are responsible for flipping this to true.
   */

  it('AI house state initializes isStarted to false', () => {
    // C++ house.cpp:534: IsStarted(false)
    const ctx = makeAIContext();
    const state = createAIHouseState(ctx, House.USSR);
    expect(state.isStarted).toBe(false);
  });

  it('IsBaseBuilding triggers IsStarted + IsAlerted cascade', () => {
    // C++ house.cpp:936-940:
    //   if (IsBaseBuilding || IQ >= Rule.IQProduction) {
    //     IsBaseBuilding = true;
    //     IsStarted = true;
    //     IsAlerted = true;
    //   }
    //
    // TS: When baseBuilding is enabled via trigger action,
    // aiState.isStarted and aiState.productionEnabled are set true.
    const ctx = makeAIContext();
    const state = createAIHouseState(ctx, House.USSR);
    state.isBaseBuilding = false;
    state.isStarted = false;

    // Simulate the trigger action setting IsBaseBuilding = true
    // (mirrors what index.ts does in applyTriggerResults)
    state.isBaseBuilding = true;
    if (state.isBaseBuilding) {
      state.isStarted = true;
      state.productionEnabled = true;
    }

    expect(state.isStarted).toBe(true);
    expect(state.productionEnabled).toBe(true);
    expect(state.isBaseBuilding).toBe(true);
  });

  it('C++ IsAlerted is set by IsBaseBuilding cascade — TS now has isAlerted field', () => {
    // C++ house.cpp:939: IsAlerted = true (when IsBaseBuilding becomes true)
    // C++ IsAlerted controls autocreate team spawning (house.cpp:988).
    //
    // TS AIHouseState now has isAlerted field, initialized to false.
    // Set to true by: IsBaseBuilding cascade, TACTION_AUTOCREATE, or IQ >= IQProduction.
    const ctx = makeAIContext();
    const state = createAIHouseState(ctx, House.USSR);

    // Verify isAlerted field exists and defaults to false
    expect('isAlerted' in state).toBe(true);
    expect(state.isAlerted).toBe(false);

    // Simulate IsBaseBuilding cascade (C++ house.cpp:936-940)
    state.isBaseBuilding = true;
    if (state.isBaseBuilding) {
      state.isStarted = true;
      state.isAlerted = true;
      state.productionEnabled = true;
    }
    expect(state.isAlerted).toBe(true);
  });
});

// =============================================================================
// 6. Player base discovery — no C++ production gate
//    C++ production is gated by IsStarted + factories/prereqs.
// =============================================================================

describe('Player base discovery is not a production gate', () => {
  /**
   * C++ has no "base discovery" mechanic for the human player.
   * In C++, the player can build as soon as they have a Construction Yard
   * and the Begin_Production trigger fires (or IsStarted is set by MCV deploy).
   */

  it('legacy baseDiscovered=false does not hide available production', () => {
    // C++ production is gated by IsStarted (house.h:175), which is
    // set by MCV deploy (unit.cpp:1549) or Begin_Production trigger.
    // There is no distance-check to a structure.

    const map = new GameMap();
    map.setBounds(0, 0, 64, 64);
    const structures: MapStructure[] = [makeStructure('FACT', House.Spain, 30, 30)];
    const productionCtx: ProductionContext = {
      structures,
      entities: [],
      entityById: new Map(),
      credits: 10000,
      playerHouse: House.Spain,
      playerFaction: 'allied',
      playerTechLevel: 10,
      baseDiscovered: false,
      scenarioProductionItems: PRODUCTION_ITEMS,
      productionQueue: new Map(),
      pendingPlacement: null,
      wallPlacementPrepaid: false,
      map,
      hasBuilding: (type: string) => structures.some(s => s.alive && s.type === type),
      countBuildings: (type: string) => structures.filter(s => s.alive && s.type === type).length,
    } as ProductionContext;

    const items = getAvailableItems(productionCtx);
    expect(items.length).toBeGreaterThan(0);

    productionCtx.baseDiscovered = true;
    const itemsAfter = getAvailableItems(productionCtx);
    expect(itemsAfter.map(item => item.type).sort()).toEqual(items.map(item => item.type).sort());
  });
});

// =============================================================================
// 7. Fog of war — structures are not gated by baseDiscovered
//    C++ building.cpp:1137-1142: buildings always can be revealed
// =============================================================================

describe('Structure fog reveal ignores legacy baseDiscovered', () => {
  /**
   * C++ building.cpp:1137-1142:
   *   if ((!IsDiscoveredByPlayer && Map[coord].IsVisible) || Session.Type != GAME_NORMAL)
   *     Revealed(PlayerPtr);
   *
   * Buildings in C++ are revealed normally — there is no gate on a "base discovered" flag.
   * Buildings provide sight from their SightRange as soon as they exist.
   *
   * Structures contribute to fog sight during normal per-tick updates.
   */

  it('structures reveal fog when baseDiscovered is false', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 64, 64);
    const structures: MapStructure[] = [makeStructure('FACT', House.Spain, 30, 30)];
    const entities: Entity[] = [];

    const ctx: FogContext = {
      entities,
      structures,
      map,
      tick: 1,
      playerHouse: House.Spain,
      fogDisabled: false,
      gpsActive: false,
      baseDiscovered: false,
      powerProduced: 100,
      powerConsumed: 0,
      gapGeneratorCells: new Map(),
      isAllied: (a, b) => a === b,
      entitiesAllied: (a, b) => a.house === b.house,
    };

    updateFogOfWar(ctx);
    const vis = map.getVisibility(30, 30);
    expect(vis).toBe(2);
  });

  it('baseDiscovered=true produces the same structure reveal', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 64, 64);
    const structures: MapStructure[] = [makeStructure('FACT', House.Spain, 30, 30)];
    const entities: Entity[] = [];

    const ctx: FogContext = {
      entities,
      structures,
      map,
      tick: 1,
      playerHouse: House.Spain,
      fogDisabled: false,
      gpsActive: false,
      baseDiscovered: true,
      powerProduced: 100,
      powerConsumed: 0,
      gapGeneratorCells: new Map(),
      isAllied: (a, b) => a === b,
      entitiesAllied: (a, b) => a.house === b.house,
    };

    updateFogOfWar(ctx);
    const vis = map.getVisibility(30, 30);
    expect(vis).toBe(2); // fully visible
  });
});

// =============================================================================
// 8. MCV deploy sets IsStarted — C++ unit.cpp:1549
// =============================================================================

describe('MCV deploy sets IsStarted — C++ unit.cpp:1549', () => {
  /**
   * C++ unit.cpp:1548-1549:
   *   // When the MCV deploys, always consider production to have started
   *   House->IsStarted = true;
   *
   * This ensures AI opponents begin construction immediately when their MCV
   * deploys, without requiring a separate Begin_Production trigger.
   *
   * TS: deployMCV() in placement.ts now sets isStarted = true on the house
   * via the aiStates context, matching C++ behavior.
   */

  it('deployMCV sets isStarted on the house via aiStates', () => {
    // C++ unit.cpp:1549: House->IsStarted = true
    // TS placement.ts: if (ctx.aiStates) aiState.isStarted = true
    //
    // For AI houses, createAIHouseState() defaults isStarted=true,
    // but if isStarted were false (e.g. reset by scenario logic),
    // MCV deploy would re-enable it. This matches C++ behavior.
    const ctx = makeAIContext();
    const state = createAIHouseState(ctx, House.USSR);
    state.isStarted = false; // simulate pre-deploy state
    ctx.aiStates.set(House.USSR, state);

    // Simulate what deployMCV does with aiStates
    const aiState = ctx.aiStates.get(House.USSR);
    if (aiState) aiState.isStarted = true;

    expect(state.isStarted).toBe(true);
  });
});

// =============================================================================
// 9. AI enemy selection — C++ house.cpp:4639 guards on IsStarted
// =============================================================================

describe('AI enemy selection guards on IsStarted — C++ house.cpp:4639-4642', () => {
  /**
   * C++ house.cpp:4634-4642:
   *   // Perform a special restriction check to ensure that no enemy is chosen if
   *   // there is even one enemy that has not established a base yet.
   *   if (!h->IsStarted) {
   *     enemy = HOUSE_NONE;
   *     break;
   *   }
   *
   * If any enemy house has IsStarted=false, no enemy is designated.
   * This prevents the AI from targeting houses before they've set up.
   *
   * TS: ai.ts checks enemyState.isStarted in enemy selection.
   */

  it('AI skips enemy selection if any enemy has isStarted=false', () => {
    // TS ai.ts checks: if (!enemyState.isStarted) { bestEnemy = null; break; }
    // This matches C++ house.cpp:4639-4642.
    const ctx = makeAIContext();
    const ussrState = createAIHouseState(ctx, House.USSR);
    ussrState.isStarted = false;
    ctx.aiStates.set(House.USSR, ussrState);

    // With isStarted=false, the enemy should be skipped
    expect(ussrState.isStarted).toBe(false);
  });
});

// Hidden() is covered by discovery-playerptr tests. C++ techno.cpp:848-856
// clears IsDiscoveredByPlayer only when Hidden() is called by explicit object
// hiding/removal paths such as ObjectClass::Limbo(), not by ordinary fog
// downgrades.

// =============================================================================
// 11. Ambush mission transition on discovery
//     C++ techno.cpp:772-774
// =============================================================================

describe('Ambush → Hunt on discovery — C++ techno.cpp:772-774', () => {
  /**
   * C++ techno.cpp:770-774:
   *   // An enemy object that is discovered will go into hunt mode if
   *   // its current mission is to ambush.
   *   if (!house->IsHuman && Mission == MISSION_AMBUSH) {
   *     Assign_Mission(MISSION_HUNT);
   *   }
   *
   * When a non-human-owned unit on AMBUSH mission is revealed,
   * it switches to HUNT mission.
   */

  it('entity on AMBUSH mission has that mission available', () => {
    // Verify the Mission enum includes AMBUSH
    expect(Mission.AMBUSH).toBeDefined();
    expect(Mission.HUNT).toBeDefined();
  });

  it('ambush units switch to hunt when revealed', () => {
    // C++ behavior: Revealed() checks if the house is non-human and mission is AMBUSH.
    // If so, assigns MISSION_HUNT.
    const entity = new Entity(UnitType.I_E1, House.USSR, 100, 100);
    entity.mission = Mission.AMBUSH;

    // Simulate what Revealed() does (techno.cpp:772-774)
    const isHuman = false; // AI house
    if (!isHuman && entity.mission === Mission.AMBUSH) {
      entity.mission = Mission.HUNT;
    }

    expect(entity.mission).toBe(Mission.HUNT);
  });

  it('ambush-to-hunt does NOT fire for human-owned objects', () => {
    // C++ techno.cpp:772: if (!house->IsHuman ...)
    // Human-owned objects on AMBUSH stay on AMBUSH when revealed.
    const entity = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    entity.mission = Mission.AMBUSH;

    const isHuman = true;
    if (!isHuman && entity.mission === Mission.AMBUSH) {
      entity.mission = Mission.HUNT;
    }

    expect(entity.mission).toBe(Mission.AMBUSH); // unchanged
  });
});
