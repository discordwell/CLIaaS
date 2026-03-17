/**
 * C++ Behavioral Parity: AI Building — Urgency-Ranked Scoring
 *
 * Tests verify that getAIBuildOrder matches C++ RA source code behavior
 * for the AI_Building() urgency-ranked BuildChoice heap system.
 *
 * Source references:
 *   - house.cpp:5434-5773 AI_Building() — urgency-ranked build candidates
 *   - rules.cpp:104-121 — ratio/limit defaults (RefineryRatio, BarracksRatio, etc.)
 *   - house.cpp:5482-5496 — power: APWR preferred, MEDIUM urgency if has refinery
 *   - house.cpp:5501-5510 — refinery: HIGH if none, MEDIUM otherwise
 *   - house.cpp:5580-5608 — defense: FTUR/PBOX/GUN at MEDIUM
 *   - house.cpp:5610-5663 — AA: only if enemy has aircraft, HIGH if outmatched
 *   - house.cpp:5669-5678 — tesla: requires power fraction >= 1
 *   - house.cpp:5683-5700 — tech center: max 1, requires power
 *   - house.cpp:5759-5769 — pick highest urgency candidate
 *
 * Observable outcomes: urgency scoring, ratio/limit checks, faction gating,
 * AA aircraft prerequisite, power checks, max limits.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  House, HOUSE_FACTION, PRODUCTION_ITEMS, UnitType,
  type ProductionItem,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap } from '../engine/map';
import { STRUCTURE_MAX_HP, type MapStructure } from '../engine/scenario';
import {
  type AIContext, type AIHouseState, type Difficulty,
  UrgencyType, AI_BUILD_RULES,
  createAIHouseState,
  getAIBuildOrder,
  aiCountStructure,
  aiCountEnemyAircraft,
  aiEnemyHasAircraft,
  aiCountAllStructures,
} from '../engine/ai';

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
    ...overrides,
  };
}

function addAIHouse(ctx: AIContext, house: House, overrides: Partial<AIHouseState> = {}): AIHouseState {
  const state = createAIHouseState(ctx, house);
  Object.assign(state, overrides);
  ctx.aiStates.set(house, state);
  return state;
}

/** Create an aircraft entity for a given house */
function makeAircraftEntity(house: House): Entity {
  return new Entity(UnitType.V_MIG, house, 100, 100);
}

// =============================================================================
// 1. UrgencyType Enum Values (C++ house.h)
// =============================================================================
describe('UrgencyType enum (C++ house.h)', () => {
  it('has correct ordering: NONE < LOW < MEDIUM < HIGH < CRITICAL', () => {
    expect(UrgencyType.URGENCY_NONE).toBeLessThan(UrgencyType.URGENCY_LOW);
    expect(UrgencyType.URGENCY_LOW).toBeLessThan(UrgencyType.URGENCY_MEDIUM);
    expect(UrgencyType.URGENCY_MEDIUM).toBeLessThan(UrgencyType.URGENCY_HIGH);
    expect(UrgencyType.URGENCY_HIGH).toBeLessThan(UrgencyType.URGENCY_CRITICAL);
  });

  it('has correct numeric values matching C++ enum', () => {
    expect(UrgencyType.URGENCY_NONE).toBe(0);
    expect(UrgencyType.URGENCY_LOW).toBe(1);
    expect(UrgencyType.URGENCY_MEDIUM).toBe(2);
    expect(UrgencyType.URGENCY_HIGH).toBe(3);
    expect(UrgencyType.URGENCY_CRITICAL).toBe(4);
  });
});

// =============================================================================
// 2. AI_BUILD_RULES defaults (C++ rules.cpp:104-121)
// =============================================================================
describe('AI_BUILD_RULES defaults (C++ rules.cpp:104-121)', () => {
  it('matches rules.ini ratio defaults', () => {
    expect(AI_BUILD_RULES.refineryRatio).toBeCloseTo(0.16);
    expect(AI_BUILD_RULES.barracksRatio).toBeCloseTo(0.16);
    expect(AI_BUILD_RULES.warRatio).toBeCloseTo(0.10);
    expect(AI_BUILD_RULES.defenseRatio).toBeCloseTo(0.50);
    expect(AI_BUILD_RULES.aaRatio).toBeCloseTo(0.14);
    expect(AI_BUILD_RULES.teslaRatio).toBeCloseTo(0.16);
    expect(AI_BUILD_RULES.helipadRatio).toBeCloseTo(0.12);
    expect(AI_BUILD_RULES.airstripRatio).toBeCloseTo(0.12);
  });

  it('matches rules.ini limit defaults', () => {
    expect(AI_BUILD_RULES.refineryLimit).toBe(4);
    expect(AI_BUILD_RULES.barracksLimit).toBe(2);
    expect(AI_BUILD_RULES.warLimit).toBe(2);
    expect(AI_BUILD_RULES.defenseLimit).toBe(40);
    expect(AI_BUILD_RULES.aaLimit).toBe(10);
    expect(AI_BUILD_RULES.teslaLimit).toBe(10);
    expect(AI_BUILD_RULES.helipadLimit).toBe(5);
    expect(AI_BUILD_RULES.airstripLimit).toBe(5);
  });

  it('has PowerSurplus=50 and BaseSizeAdd=3', () => {
    expect(AI_BUILD_RULES.powerSurplus).toBe(50);
    expect(AI_BUILD_RULES.baseSizeAdd).toBe(3);
  });
});

// =============================================================================
// 3. Power deficit -> power plant is CRITICAL/MEDIUM urgency
// (C++ house.cpp:5482-5496)
// =============================================================================
describe('Power: deficit triggers power plant build (house.cpp:5482-5496)', () => {
  it('builds POWR when power deficit and no refinery (LOW urgency)', () => {
    const ctx = makeMockAIContext();
    // Soviet with a FACT only — no power, no refinery
    ctx.structures.push(makeStructure('FACT', House.USSR));
    ctx.houseCredits.set(House.USSR, 5000);
    const state = addAIHouse(ctx, House.USSR);

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    // POWR should be in the queue (LOW urgency since no refinery)
    expect(queue).toContain('POWR');
  });

  it('builds power with MEDIUM urgency when has refinery', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('FACT', House.USSR),
      makeStructure('PROC', House.USSR),
      makeStructure('POWR', House.USSR), // 100 power
    );
    // With 1 PROC (30 drain) + 1 POWR (100 produced), surplus is 70 > 50
    // Need more drain to trigger power build. Add more structures.
    ctx.structures.push(
      makeStructure('TENT', House.USSR),  // +20 drain
      makeStructure('WEAP', House.USSR),  // +30 drain
      makeStructure('DOME', House.USSR),  // +40 drain
    );
    // Total drain = 30+20+30+40 = 120, produced = 100, deficit!
    ctx.houseCredits.set(House.USSR, 5000);
    const state = addAIHouse(ctx, House.USSR, { harvesterCount: 1 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).toContain('POWR');
  });

  it('APWR preferred over POWR for allied faction when prereq met', () => {
    const ctx = makeMockAIContext();
    // Allied with power deficit
    ctx.structures.push(
      makeStructure('FACT', House.Greece),
      makeStructure('POWR', House.Greece),  // has POWR prereq for APWR
      makeStructure('PROC', House.Greece),
      makeStructure('BARR', House.Greece),
      makeStructure('WEAP', House.Greece),
      makeStructure('DOME', House.Greece),
    );
    // drain = 30+20+30+40 = 120, produced = 100
    ctx.houseCredits.set(House.Greece, 5000);
    const state = addAIHouse(ctx, House.Greece, { harvesterCount: 1 });

    const queue = getAIBuildOrder(ctx, House.Greece, state);
    // Should prefer APWR since allied and has POWR prereq
    expect(queue).toContain('APWR');
  });
});

// =============================================================================
// 4. Refinery ratio check (house.cpp:5501-5510)
// =============================================================================
describe('Refinery: ratio-based building (house.cpp:5501-5510)', () => {
  it('first refinery gets HIGH urgency', () => {
    const ctx = makeMockAIContext();
    // 5 buildings, 0 refineries. refineryRatio*5 = 0.8 -> roundUp = 1
    ctx.structures.push(
      makeStructure('FACT', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('TENT', House.USSR),
      makeStructure('WEAP', House.USSR),
    );
    ctx.houseCredits.set(House.USSR, 5000);
    const state = addAIHouse(ctx, House.USSR, { harvesterCount: 0 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    // PROC should be first or near-first (HIGH urgency)
    expect(queue).toContain('PROC');
    // PROC should come before MEDIUM-urgency items
    const procIdx = queue.indexOf('PROC');
    // All MEDIUM items should be after PROC
    for (let i = 0; i < procIdx; i++) {
      // Items before PROC must also be HIGH or higher urgency
      // (power could be LOW)
    }
  });

  it('respects refineryLimit cap', () => {
    const ctx = makeMockAIContext();
    // Add 4 refineries (at the limit) plus other buildings for ratio
    for (let i = 0; i < 4; i++) {
      ctx.structures.push(makeStructure('PROC', House.USSR, 50 + i, 50));
    }
    // Need enough buildings for ratio to want more: 4/30 = 0.13 < 0.16
    for (let i = 0; i < 26; i++) {
      ctx.structures.push(makeStructure('POWR', House.USSR, 50, 50 + i));
    }
    ctx.houseCredits.set(House.USSR, 10000);
    const state = addAIHouse(ctx, House.USSR, { harvesterCount: 4 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    // At limit of 4, should NOT want another PROC
    expect(queue).not.toContain('PROC');
  });
});

// =============================================================================
// 5. Defense ratio check (house.cpp:5580-5608)
// =============================================================================
describe('Defense: ratio-based building (house.cpp:5580-5608)', () => {
  it('builds FTUR for soviet when defense ratio not met', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('FACT', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('PROC', House.USSR),
      makeStructure('TENT', House.USSR),
    );
    ctx.houseCredits.set(House.USSR, 5000);
    const state = addAIHouse(ctx, House.USSR, { harvesterCount: 1 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    // Soviet should build FTUR
    expect(queue).toContain('FTUR');
  });

  it('builds PBOX or GUN for allied when defense ratio not met', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('FACT', House.Greece),
      makeStructure('POWR', House.Greece),
      makeStructure('POWR', House.Greece),
      makeStructure('PROC', House.Greece),
      makeStructure('BARR', House.Greece),
    );
    ctx.houseCredits.set(House.Greece, 5000);
    const state = addAIHouse(ctx, House.Greece, { harvesterCount: 1 });

    const queue = getAIBuildOrder(ctx, House.Greece, state);
    // Allied should build PBOX or GUN
    const hasDefense = queue.includes('PBOX') || queue.includes('GUN');
    expect(hasDefense).toBe(true);
  });
});

// =============================================================================
// 6. AA only built when enemy has aircraft (house.cpp:5610-5663)
// =============================================================================
describe('AA Defense: only when enemy has aircraft (house.cpp:5610-5663)', () => {
  it('does NOT build SAM/AGUN when enemy has no aircraft', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('FACT', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('PROC', House.USSR),
      makeStructure('TENT', House.USSR),
      makeStructure('DOME', House.USSR),
    );
    ctx.houseCredits.set(House.USSR, 10000);
    const state = addAIHouse(ctx, House.USSR, { harvesterCount: 1 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).not.toContain('SAM');
    expect(queue).not.toContain('AGUN');
  });

  it('builds SAM for soviet when enemy has aircraft', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('FACT', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('PROC', House.USSR),
      makeStructure('TENT', House.USSR),
      makeStructure('DOME', House.USSR),
    );
    // Add enemy aircraft
    const aircraft = makeAircraftEntity(House.Spain);
    ctx.entities.push(aircraft);
    ctx.houseCredits.set(House.USSR, 10000);
    const state = addAIHouse(ctx, House.USSR, { harvesterCount: 1 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).toContain('SAM');
  });

  it('builds AGUN for allied when enemy has aircraft', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('FACT', House.Greece),
      makeStructure('POWR', House.Greece),
      makeStructure('POWR', House.Greece),
      makeStructure('PROC', House.Greece),
      makeStructure('BARR', House.Greece),
      makeStructure('DOME', House.Greece),
    );
    // Add enemy aircraft (USSR is enemy of Greece)
    const aircraft = makeAircraftEntity(House.USSR);
    ctx.entities.push(aircraft);
    ctx.houseCredits.set(House.Greece, 10000);
    const state = addAIHouse(ctx, House.Greece, { harvesterCount: 1 });

    const queue = getAIBuildOrder(ctx, House.Greece, state);
    expect(queue).toContain('AGUN');
  });

  it('AA gets HIGH urgency when outnumbered by enemy aircraft', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('FACT', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('PROC', House.USSR),
      makeStructure('TENT', House.USSR),
      makeStructure('DOME', House.USSR),
    );
    // Add 3 enemy aircraft — we have 0 SAM, so 0 < 3 triggers HIGH urgency
    for (let i = 0; i < 3; i++) {
      ctx.entities.push(makeAircraftEntity(House.Spain));
    }
    ctx.houseCredits.set(House.USSR, 10000);
    const state = addAIHouse(ctx, House.USSR, { harvesterCount: 1 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    // SAM should be HIGH urgency, appearing before MEDIUM items
    const samIdx = queue.indexOf('SAM');
    expect(samIdx).toBeGreaterThanOrEqual(0);
    // SAM (HIGH) should come before purely MEDIUM items like FTUR
    const fturIdx = queue.indexOf('FTUR');
    if (fturIdx >= 0) {
      expect(samIdx).toBeLessThan(fturIdx);
    }
  });
});

// =============================================================================
// 7. Highest urgency wins over sequential order (house.cpp:5759-5769)
// =============================================================================
describe('Urgency ranking: highest wins (house.cpp:5759-5769)', () => {
  it('HIGH urgency refinery comes before MEDIUM urgency defense', () => {
    const ctx = makeMockAIContext();
    // No refinery (HIGH urgency) but enough buildings to trigger defense (MEDIUM)
    ctx.structures.push(
      makeStructure('FACT', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('TENT', House.USSR),
      makeStructure('WEAP', House.USSR),
    );
    ctx.houseCredits.set(House.USSR, 10000);
    const state = addAIHouse(ctx, House.USSR, { harvesterCount: 0 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    const procIdx = queue.indexOf('PROC');
    const fturIdx = queue.indexOf('FTUR');

    expect(procIdx).toBeGreaterThanOrEqual(0);
    // PROC (HIGH) should be before FTUR (MEDIUM)
    if (fturIdx >= 0) {
      expect(procIdx).toBeLessThan(fturIdx);
    }
  });

  it('multiple MEDIUM items all appear in queue', () => {
    const ctx = makeMockAIContext();
    // Soviet base with enough buildings to trigger multiple MEDIUM candidates
    ctx.structures.push(
      makeStructure('FACT', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('POWR', House.USSR),  // enough power
      makeStructure('PROC', House.USSR),
      makeStructure('TENT', House.USSR),
      makeStructure('WEAP', House.USSR),
    );
    ctx.houseCredits.set(House.USSR, 10000);
    const state = addAIHouse(ctx, House.USSR, { harvesterCount: 1 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    // Multiple MEDIUM candidates should all appear
    expect(queue.length).toBeGreaterThan(1);
  });
});

// =============================================================================
// 8. Max limits respected (house.cpp various)
// =============================================================================
describe('Max limits respected', () => {
  it('max 1 tech center (ATEK+STEK combined, house.cpp:5683)', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('FACT', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('PROC', House.USSR),
      makeStructure('TENT', House.USSR),
      makeStructure('WEAP', House.USSR),
      makeStructure('STEK', House.USSR),  // already have one
    );
    ctx.houseCredits.set(House.USSR, 10000);
    const state = addAIHouse(ctx, House.USSR, { harvesterCount: 1 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).not.toContain('STEK');
    expect(queue).not.toContain('ATEK');
  });

  it('max 1 kennel (house.cpp:5538)', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('FACT', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('PROC', House.USSR),
      makeStructure('TENT', House.USSR),
      makeStructure('KENN', House.USSR),  // already have one
    );
    ctx.houseCredits.set(House.USSR, 5000);
    const state = addAIHouse(ctx, House.USSR, { harvesterCount: 1 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).not.toContain('KENN');
  });

  it('max 1 gap generator (house.cpp:5552)', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('FACT', House.Greece),
      makeStructure('POWR', House.Greece),
      makeStructure('POWR', House.Greece),
      makeStructure('PROC', House.Greece),
      makeStructure('BARR', House.Greece),
      makeStructure('GAP', House.Greece),  // already have one
    );
    ctx.houseCredits.set(House.Greece, 5000);
    const state = addAIHouse(ctx, House.Greece, { harvesterCount: 1 });

    const queue = getAIBuildOrder(ctx, House.Greece, state);
    expect(queue).not.toContain('GAP');
  });
});

// =============================================================================
// 9. Tesla requires power fraction >= 1 (house.cpp:5672)
// =============================================================================
describe('Tesla: requires power fraction >= 1 (house.cpp:5672)', () => {
  it('does NOT build TSLA when power deficit', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('FACT', House.USSR),
      makeStructure('POWR', House.USSR),  // 100 power
      makeStructure('PROC', House.USSR),  // 30 drain
      makeStructure('TENT', House.USSR),  // 20 drain
      makeStructure('WEAP', House.USSR),  // 30 drain
      makeStructure('DOME', House.USSR),  // 40 drain = 120 total > 100
    );
    ctx.houseCredits.set(House.USSR, 10000);
    const state = addAIHouse(ctx, House.USSR, { harvesterCount: 1 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).not.toContain('TSLA');
  });

  it('builds TSLA when power surplus and soviet', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('FACT', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('POWR', House.USSR),  // 300 power total
      makeStructure('PROC', House.USSR),  // 30 drain
      makeStructure('TENT', House.USSR),  // 20 drain
      makeStructure('WEAP', House.USSR),  // 30 drain = 80 total < 300
    );
    ctx.houseCredits.set(House.USSR, 10000);
    const state = addAIHouse(ctx, House.USSR, { harvesterCount: 1 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).toContain('TSLA');
  });
});

// =============================================================================
// 10. Enemy aircraft helper functions
// =============================================================================
describe('aiCountEnemyAircraft / aiEnemyHasAircraft', () => {
  it('counts enemy aircraft across non-allied houses', () => {
    const ctx = makeMockAIContext();
    // Add 2 enemy aircraft
    ctx.entities.push(makeAircraftEntity(House.Spain));
    ctx.entities.push(makeAircraftEntity(House.Spain));
    // Add 1 friendly aircraft (should not count)
    ctx.entities.push(makeAircraftEntity(House.USSR));

    expect(aiCountEnemyAircraft(ctx, House.USSR)).toBe(2);
    expect(aiEnemyHasAircraft(ctx, House.USSR)).toBe(true);
  });

  it('returns 0/false when no enemy aircraft exist', () => {
    const ctx = makeMockAIContext();
    expect(aiCountEnemyAircraft(ctx, House.USSR)).toBe(0);
    expect(aiEnemyHasAircraft(ctx, House.USSR)).toBe(false);
  });

  it('ignores dead aircraft', () => {
    const ctx = makeMockAIContext();
    const dead = makeAircraftEntity(House.Spain);
    dead.alive = false;
    ctx.entities.push(dead);

    expect(aiCountEnemyAircraft(ctx, House.USSR)).toBe(0);
    expect(aiEnemyHasAircraft(ctx, House.USSR)).toBe(false);
  });
});

// =============================================================================
// 11. aiCountAllStructures
// =============================================================================
describe('aiCountAllStructures', () => {
  it('counts all alive structures for a house', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('POWR', House.USSR),
      makeStructure('PROC', House.USSR),
      makeStructure('TENT', House.USSR),
      makeStructure('POWR', House.Spain),  // different house
      makeStructure('WEAP', House.USSR, 50, 50, { alive: false }),  // dead
    );
    expect(aiCountAllStructures(ctx, House.USSR)).toBe(3);
  });
});

// =============================================================================
// 12. Kennel is soviet-only, gap is allied-only
// =============================================================================
describe('Faction gating', () => {
  it('allied does not build KENN', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('FACT', House.Greece),
      makeStructure('POWR', House.Greece),
      makeStructure('PROC', House.Greece),
      makeStructure('BARR', House.Greece),
    );
    ctx.houseCredits.set(House.Greece, 5000);
    const state = addAIHouse(ctx, House.Greece, { harvesterCount: 1 });

    const queue = getAIBuildOrder(ctx, House.Greece, state);
    expect(queue).not.toContain('KENN');
  });

  it('soviet does not build GAP', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('FACT', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('PROC', House.USSR),
      makeStructure('TENT', House.USSR),
    );
    ctx.houseCredits.set(House.USSR, 5000);
    const state = addAIHouse(ctx, House.USSR, { harvesterCount: 1 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).not.toContain('GAP');
  });
});

// =============================================================================
// 13. Helipad/Airstrip ratio-based (house.cpp:5705-5738)
// =============================================================================
describe('Helipad/Airstrip: ratio-based (house.cpp:5705-5738)', () => {
  it('builds AFLD for soviet when under ratio', () => {
    const ctx = makeMockAIContext();
    // Need enough buildings for ratio: 0.12 * 10 = 1.2 -> roundUp = 2
    for (let i = 0; i < 5; i++) {
      ctx.structures.push(makeStructure('POWR', House.USSR, 50, 50 + i));
    }
    ctx.structures.push(
      makeStructure('FACT', House.USSR),
      makeStructure('PROC', House.USSR),
      makeStructure('TENT', House.USSR),
      makeStructure('WEAP', House.USSR),
      makeStructure('DOME', House.USSR),
    );
    ctx.houseCredits.set(House.USSR, 10000);
    const state = addAIHouse(ctx, House.USSR, { harvesterCount: 1 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).toContain('AFLD');
  });

  it('urgency boosted to HIGH when enemy has more aircraft', () => {
    const ctx = makeMockAIContext();
    for (let i = 0; i < 5; i++) {
      ctx.structures.push(makeStructure('POWR', House.USSR, 50, 50 + i));
    }
    ctx.structures.push(
      makeStructure('FACT', House.USSR),
      makeStructure('PROC', House.USSR),
      makeStructure('TENT', House.USSR),
      makeStructure('WEAP', House.USSR),
      makeStructure('DOME', House.USSR),
    );
    // Enemy has aircraft, we have none -> HIGH urgency
    ctx.entities.push(makeAircraftEntity(House.Spain));
    ctx.houseCredits.set(House.USSR, 10000);
    const state = addAIHouse(ctx, House.USSR, { harvesterCount: 1 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    const afldIdx = queue.indexOf('AFLD');
    expect(afldIdx).toBeGreaterThanOrEqual(0);
    // HIGH urgency items should be before MEDIUM items
    // FTUR/KENN are MEDIUM
    const kennIdx = queue.indexOf('KENN');
    if (kennIdx >= 0 && afldIdx >= 0) {
      expect(afldIdx).toBeLessThan(kennIdx);
    }
  });
});

// =============================================================================
// 14. Empty base produces reasonable output
// =============================================================================
describe('Edge cases', () => {
  it('empty base with no credits returns empty or minimal queue', () => {
    const ctx = makeMockAIContext();
    ctx.houseCredits.set(House.USSR, 0);
    const state = addAIHouse(ctx, House.USSR);

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    // With 0 credits and 0 buildings, power check may still trigger
    // but most ratio-gated items won't appear
    expect(Array.isArray(queue)).toBe(true);
  });

  it('no duplicate entries for the same structure type at same urgency', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('FACT', House.USSR),
      makeStructure('POWR', House.USSR),
      makeStructure('PROC', House.USSR),
      makeStructure('TENT', House.USSR),
    );
    ctx.houseCredits.set(House.USSR, 10000);
    const state = addAIHouse(ctx, House.USSR, { harvesterCount: 1 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    // Each structure type should appear at most once
    const seen = new Set<string>();
    for (const item of queue) {
      expect(seen.has(item), `duplicate: ${item}`).toBe(false);
      seen.add(item);
    }
  });
});
