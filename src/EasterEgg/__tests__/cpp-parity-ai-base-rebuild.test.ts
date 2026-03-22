/**
 * C++ Behavioral Parity: AI Base Rebuild System
 *
 * Tests verify that updateBaseRebuild matches C++ RA source code behavior
 * for the AI base reconstruction loop: blueprint comparison, queue population,
 * priority sorting, cost deduction, and cooldown management.
 *
 * Source references:
 *   - HOUSE.CPP AI_Building() — base rebuild scan against blueprint
 *   - HOUSE.CPP Base_Is_Destroyed() — alive structure set comparison
 *   - FACTORY.CPP Set_Candidate() — production cost check before placement
 *   - BASE.CPP Rebuild_Base() — priority table, cooldown, FACT prerequisite
 *
 * Observable outcomes: early exits, queue population/ordering, cost deduction,
 * structure spawning, cooldown lifecycle, multi-house independence.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  House, Mission, UnitType, CELL_SIZE, MAP_CELLS, GAME_TICKS_PER_SEC,
  UNIT_STATS, HOUSE_FACTION, PRODUCTION_ITEMS,
  type ProductionItem,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap, Terrain } from '../engine/map';
import { STRUCTURE_SIZE, STRUCTURE_MAX_HP, type MapStructure } from '../engine/scenario';
import {
  type AIContext, type AIHouseState, type Difficulty,
  AI_DIFFICULTY_MODS,
  createAIHouseState,
  updateBaseRebuild,
  spawnAIStructure,
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
  map.setBounds(1, 1, 126, 126);
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

function addAIHouse(
  ctx: AIContext, house: House, overrides: Partial<AIHouseState> = {},
): AIHouseState {
  const state = createAIHouseState(ctx, house);
  Object.assign(state, overrides);
  ctx.aiStates.set(house, state);
  return state;
}

/** Encode cell position to blueprint cell index: cy * MAP_CELLS + cx */
function encodeCell(cx: number, cy: number): number {
  return cy * MAP_CELLS + cx;
}

/** Create a blueprint entry */
function makeBP(type: string, house: House, cx: number, cy: number) {
  return { type, cell: encodeCell(cx, cy), house };
}

/** Set up a minimal context that will pass all early-exit checks */
function makeReadyContext(overrides: Partial<AIContext> = {}): AIContext {
  const ctx = makeMockAIContext({
    tick: 0, // 0 % 75 === 0
    baseBlueprint: [makeBP('POWR', House.USSR, 50, 50)],
    ...overrides,
  });
  // AI house with IQ >= 2
  addAIHouse(ctx, House.USSR, { iq: 3 });
  // Alive FACT for that house
  ctx.structures.push(makeStructure('FACT', House.USSR, 40, 40));
  // Credits
  ctx.houseCredits.set(House.USSR, 10000);
  return ctx;
}

// =============================================================================
// EARLY EXIT CONDITIONS
// =============================================================================

describe('C++ parity: AI Base Rebuild — updateBaseRebuild', () => {

  // ---- Early exit conditions ------------------------------------------------

  describe('early exit: empty blueprint', () => {
    it('returns immediately when baseBlueprint is empty', () => {
      const ctx = makeMockAIContext({ tick: 0, baseBlueprint: [] });
      addAIHouse(ctx, House.USSR, { iq: 3 });
      ctx.structures.push(makeStructure('FACT', House.USSR, 40, 40));
      const structCountBefore = ctx.structures.length;
      updateBaseRebuild(ctx);
      expect(ctx.structures.length).toBe(structCountBefore);
      expect(ctx.baseRebuildQueue.length).toBe(0);
    });
  });

  describe('early exit: no AI house with IQ >= 2', () => {
    it('returns when all AI houses have IQ < 2', () => {
      const ctx = makeMockAIContext({
        tick: 0,
        baseBlueprint: [makeBP('POWR', House.USSR, 50, 50)],
      });
      addAIHouse(ctx, House.USSR, { iq: 1 });
      ctx.structures.push(makeStructure('FACT', House.USSR, 40, 40));
      const structCountBefore = ctx.structures.length;
      updateBaseRebuild(ctx);
      expect(ctx.structures.length).toBe(structCountBefore);
    });

    it('returns when no AI states exist at all', () => {
      const ctx = makeMockAIContext({
        tick: 0,
        baseBlueprint: [makeBP('POWR', House.USSR, 50, 50)],
      });
      ctx.structures.push(makeStructure('FACT', House.USSR, 40, 40));
      const structCountBefore = ctx.structures.length;
      updateBaseRebuild(ctx);
      expect(ctx.structures.length).toBe(structCountBefore);
    });

    it('IQ exactly 2 passes the check', () => {
      const ctx = makeMockAIContext({
        tick: 0,
        baseBlueprint: [makeBP('POWR', House.USSR, 50, 50)],
      });
      addAIHouse(ctx, House.USSR, { iq: 2 });
      ctx.structures.push(makeStructure('FACT', House.USSR, 40, 40));
      ctx.houseCredits.set(House.USSR, 10000);
      updateBaseRebuild(ctx);
      // Should have proceeded past IQ check — queue populated and item built
      expect(ctx.baseRebuildCooldown).toBe(GAME_TICKS_PER_SEC * 30);
    });
  });

  describe('early exit: rebuild cooldown', () => {
    it('decrements cooldown and returns when cooldown > 0', () => {
      const ctx = makeMockAIContext({
        tick: 0,
        baseBlueprint: [makeBP('POWR', House.USSR, 50, 50)],
        baseRebuildCooldown: 5,
      });
      addAIHouse(ctx, House.USSR, { iq: 3 });
      ctx.structures.push(makeStructure('FACT', House.USSR, 40, 40));
      updateBaseRebuild(ctx);
      expect(ctx.baseRebuildCooldown).toBe(4);
      // No structures built
      expect(ctx.structures.length).toBe(1); // just the FACT
    });

    it('does not decrement below zero — reaches zero then proceeds on next call', () => {
      const ctx = makeMockAIContext({
        tick: 0,
        baseBlueprint: [makeBP('POWR', House.USSR, 50, 50)],
        baseRebuildCooldown: 1,
      });
      addAIHouse(ctx, House.USSR, { iq: 3 });
      ctx.structures.push(makeStructure('FACT', House.USSR, 40, 40));
      ctx.houseCredits.set(House.USSR, 10000);

      // First call: cooldown 1 -> 0, returns
      updateBaseRebuild(ctx);
      expect(ctx.baseRebuildCooldown).toBe(0);
      expect(ctx.structures.length).toBe(1);

      // Second call: cooldown is 0, proceeds
      updateBaseRebuild(ctx);
      expect(ctx.baseRebuildCooldown).toBe(GAME_TICKS_PER_SEC * 30);
    });
  });

  describe('early exit: tick gating', () => {
    it('only proceeds when tick % 75 === 0', () => {
      const ctx = makeReadyContext({ tick: 1 });
      const structCountBefore = ctx.structures.length;
      updateBaseRebuild(ctx);
      expect(ctx.structures.length).toBe(structCountBefore);
      expect(ctx.baseRebuildQueue.length).toBe(0);
    });

    it('tick 75 is valid (75 % 75 === 0)', () => {
      const ctx = makeReadyContext({ tick: 75 });
      updateBaseRebuild(ctx);
      expect(ctx.baseRebuildCooldown).toBe(GAME_TICKS_PER_SEC * 30);
    });

    it('tick 150 is valid', () => {
      const ctx = makeReadyContext({ tick: 150 });
      updateBaseRebuild(ctx);
      expect(ctx.baseRebuildCooldown).toBe(GAME_TICKS_PER_SEC * 30);
    });

    it('tick 74 fails the gate', () => {
      const ctx = makeReadyContext({ tick: 74 });
      updateBaseRebuild(ctx);
      expect(ctx.baseRebuildCooldown).toBe(0);
      expect(ctx.baseRebuildQueue.length).toBe(0);
    });

    it('cooldown check happens before tick gate (cooldown decrements on non-75 ticks)', () => {
      const ctx = makeMockAIContext({
        tick: 37, // not divisible by 75
        baseBlueprint: [makeBP('POWR', House.USSR, 50, 50)],
        baseRebuildCooldown: 3,
      });
      addAIHouse(ctx, House.USSR, { iq: 3 });
      ctx.structures.push(makeStructure('FACT', House.USSR, 40, 40));
      updateBaseRebuild(ctx);
      // Cooldown decremented regardless of tick
      expect(ctx.baseRebuildCooldown).toBe(2);
    });
  });

  describe('early exit: no FACT for AI houses', () => {
    it('returns when no alive FACT exists for any AI house', () => {
      const ctx = makeMockAIContext({
        tick: 0,
        baseBlueprint: [makeBP('POWR', House.USSR, 50, 50)],
      });
      addAIHouse(ctx, House.USSR, { iq: 3 });
      // No FACT at all
      updateBaseRebuild(ctx);
      expect(ctx.baseRebuildQueue.length).toBe(0);
    });

    it('allied house FACT does not count (isAllied check)', () => {
      const ctx = makeMockAIContext({
        tick: 0,
        baseBlueprint: [makeBP('POWR', House.USSR, 50, 50)],
      });
      addAIHouse(ctx, House.USSR, { iq: 3 });
      // FACT owned by player-allied house
      ctx.structures.push(makeStructure('FACT', House.Spain, 40, 40));
      updateBaseRebuild(ctx);
      expect(ctx.baseRebuildQueue.length).toBe(0);
    });

    it('dead FACT does not count', () => {
      const ctx = makeMockAIContext({
        tick: 0,
        baseBlueprint: [makeBP('POWR', House.USSR, 50, 50)],
      });
      addAIHouse(ctx, House.USSR, { iq: 3 });
      ctx.structures.push(makeStructure('FACT', House.USSR, 40, 40, { alive: false }));
      updateBaseRebuild(ctx);
      expect(ctx.baseRebuildQueue.length).toBe(0);
    });
  });

  // ---- Queue population -----------------------------------------------------

  describe('queue population', () => {
    it('missing structures added to rebuild queue', () => {
      const ctx = makeReadyContext({
        tick: 0,
        baseBlueprint: [
          makeBP('POWR', House.USSR, 50, 50),
          makeBP('PROC', House.USSR, 60, 60),
        ],
      });
      // Neither POWR nor PROC are alive, so both should be queued
      // The first one will be built immediately, so queue should have had both
      // but shift removes one. Check cooldown was set.
      updateBaseRebuild(ctx);
      // POWR has priority 0, PROC has priority 1 — POWR built first
      expect(ctx.baseRebuildCooldown).toBe(GAME_TICKS_PER_SEC * 30);
      // Remaining queue should have PROC
      expect(ctx.baseRebuildQueue.length).toBe(1);
      expect(ctx.baseRebuildQueue[0].type).toBe('PROC');
    });

    it('already-alive structures NOT added to queue', () => {
      const ctx = makeReadyContext({
        tick: 0,
        baseBlueprint: [
          makeBP('POWR', House.USSR, 50, 50),
        ],
      });
      // POWR is already alive at (50, 50)
      ctx.structures.push(makeStructure('POWR', House.USSR, 50, 50));
      updateBaseRebuild(ctx);
      // Nothing to rebuild — queue stays empty, no cooldown set
      expect(ctx.baseRebuildQueue.length).toBe(0);
      expect(ctx.baseRebuildCooldown).toBe(0);
    });

    it('blocked position (another alive structure in footprint) excluded', () => {
      // POWR is 2x2, so position (50,50) footprint covers (50,50) (51,50) (50,51) (51,51)
      const ctx = makeReadyContext({
        tick: 0,
        baseBlueprint: [makeBP('POWR', House.USSR, 50, 50)],
      });
      // Place a different structure at (51, 51) — within POWR's footprint
      ctx.structures.push(makeStructure('GUN', House.USSR, 51, 51));
      updateBaseRebuild(ctx);
      // POWR position is blocked, so nothing in queue
      expect(ctx.baseRebuildQueue.length).toBe(0);
      expect(ctx.baseRebuildCooldown).toBe(0);
    });

    it('blueprint entries for houses without FACT excluded from queue', () => {
      const ctx = makeMockAIContext({
        tick: 0,
        baseBlueprint: [
          makeBP('POWR', House.USSR, 50, 50),
          makeBP('PROC', House.Ukraine, 60, 60),
        ],
      });
      addAIHouse(ctx, House.USSR, { iq: 3 });
      addAIHouse(ctx, House.Ukraine, { iq: 3 });
      // Only USSR has a FACT
      ctx.structures.push(makeStructure('FACT', House.USSR, 40, 40));
      ctx.houseCredits.set(House.USSR, 10000);
      updateBaseRebuild(ctx);
      // Only POWR (USSR) should be queued/built; PROC (Ukraine) excluded
      expect(ctx.baseRebuildCooldown).toBe(GAME_TICKS_PER_SEC * 30);
      // Check the built structure is POWR, not PROC
      const builtPowr = ctx.structures.find(
        s => s.type === 'POWR' && s.cx === 50 && s.cy === 50,
      );
      expect(builtPowr).toBeDefined();
      const builtProc = ctx.structures.find(
        s => s.type === 'PROC' && s.cx === 60 && s.cy === 60,
      );
      expect(builtProc).toBeUndefined();
    });

    it('queue sorted by REBUILD_PRIORITY: POWR(0) before PROC(1) before WEAP(2) before GUN(3) before DOME(4) before ATEK(5)', () => {
      const ctx = makeReadyContext({
        tick: 0,
        baseBlueprint: [
          // Intentionally out of order
          makeBP('ATEK', House.USSR, 80, 80),
          makeBP('GUN', House.USSR, 70, 70),
          makeBP('WEAP', House.USSR, 60, 60),
          makeBP('DOME', House.USSR, 75, 75),
          makeBP('PROC', House.USSR, 55, 55),
          makeBP('POWR', House.USSR, 50, 50),
        ],
      });
      updateBaseRebuild(ctx);
      // POWR was shifted and built; remaining queue should be sorted
      const remaining = ctx.baseRebuildQueue.map(bp => bp.type);
      expect(remaining).toEqual(['PROC', 'WEAP', 'GUN', 'DOME', 'ATEK']);
    });

    it('unknown types get priority 6 (sorted last)', () => {
      const ctx = makeReadyContext({
        tick: 0,
        baseBlueprint: [
          makeBP('XYZZ', House.USSR, 90, 90), // unknown type
          makeBP('POWR', House.USSR, 50, 50),
        ],
      });
      updateBaseRebuild(ctx);
      // POWR (priority 0) built first, XYZZ (priority 6) remains
      expect(ctx.baseRebuildQueue.length).toBe(1);
      expect(ctx.baseRebuildQueue[0].type).toBe('XYZZ');
    });

    it('APWR shares priority 0 with POWR', () => {
      const ctx = makeReadyContext({
        tick: 0,
        baseBlueprint: [
          makeBP('PROC', House.USSR, 60, 60),
          makeBP('APWR', House.USSR, 50, 50),
        ],
      });
      updateBaseRebuild(ctx);
      // APWR (priority 0) should be built before PROC (priority 1)
      const builtApwr = ctx.structures.find(
        s => s.type === 'APWR' && s.cx === 50 && s.cy === 50,
      );
      expect(builtApwr).toBeDefined();
      expect(ctx.baseRebuildQueue[0].type).toBe('PROC');
    });

    it('defense structures all share priority 3 (GUN, TSLA, SAM, AGUN, PBOX, HBOX, FTUR)', () => {
      const defenseTypes = ['GUN', 'TSLA', 'SAM', 'AGUN', 'PBOX', 'HBOX', 'FTUR'];
      const bps = defenseTypes.map((t, i) => makeBP(t, House.USSR, 50 + i * 3, 50));
      // Add a POWR to be built first
      bps.push(makeBP('POWR', House.USSR, 30, 30));
      const ctx = makeReadyContext({ tick: 0, baseBlueprint: bps });
      updateBaseRebuild(ctx);
      // POWR built first; all defense types remain with same priority
      const remaining = ctx.baseRebuildQueue.map(bp => bp.type);
      for (const dt of defenseTypes) {
        expect(remaining).toContain(dt);
      }
    });
  });

  // ---- Rebuild execution ----------------------------------------------------

  describe('rebuild execution', () => {
    it('shifts first item from rebuild queue', () => {
      const ctx = makeReadyContext({ tick: 0 });
      // Pre-populate the queue (simulates previous population pass)
      ctx.baseRebuildQueue = [
        makeBP('POWR', House.USSR, 50, 50),
        makeBP('PROC', House.USSR, 60, 60),
      ];
      // Add FACT for USSR
      updateBaseRebuild(ctx);
      // POWR shifted and built
      expect(ctx.baseRebuildQueue.length).toBe(1);
      expect(ctx.baseRebuildQueue[0].type).toBe('PROC');
    });

    it('verifies house still has FACT before building from queue', () => {
      const ctx = makeReadyContext({ tick: 0 });
      // Pre-populate queue with Ukraine entry (no FACT for Ukraine)
      ctx.baseRebuildQueue = [makeBP('POWR', House.Ukraine, 50, 50)];
      addAIHouse(ctx, House.Ukraine, { iq: 3 });
      // Ukraine has no FACT — item is shifted but not built
      updateBaseRebuild(ctx);
      expect(ctx.baseRebuildCooldown).toBe(0);
      expect(ctx.baseRebuildQueue.length).toBe(0);
    });

    it('IQ < 2 for specific house blocks rebuild', () => {
      const ctx = makeReadyContext({ tick: 0 });
      // USSR has FACT but low IQ for this specific house
      addAIHouse(ctx, House.Ukraine, { iq: 1 });
      ctx.structures.push(makeStructure('FACT', House.Ukraine, 45, 45));
      ctx.baseRebuildQueue = [makeBP('POWR', House.Ukraine, 50, 50)];
      ctx.houseCredits.set(House.Ukraine, 10000);
      updateBaseRebuild(ctx);
      // Item shifted from queue but not built (IQ check fails for Ukraine)
      expect(ctx.baseRebuildCooldown).toBe(0);
      expect(ctx.baseRebuildQueue.length).toBe(0);
    });

    it('deducts cost from houseCredits', () => {
      const ctx = makeReadyContext({ tick: 0 });
      ctx.houseCredits.set(House.USSR, 5000);
      // POWR costs 300
      updateBaseRebuild(ctx);
      expect(ctx.houseCredits.get(House.USSR)).toBe(5000 - 300);
    });

    it('insufficient credits blocks rebuild (does not build)', () => {
      const ctx = makeReadyContext({ tick: 0 });
      ctx.houseCredits.set(House.USSR, 100); // Less than POWR cost (300)
      const structCountBefore = ctx.structures.length;
      updateBaseRebuild(ctx);
      // Item shifted from queue, but not enough credits — returns without building
      expect(ctx.baseRebuildCooldown).toBe(0);
      // No new structure spawned (only FACT remains + original)
      const powrStructs = ctx.structures.filter(s => s.type === 'POWR');
      expect(powrStructs.length).toBe(0);
    });

    it('spawns structure at decoded position (cell % 128, floor(cell / 128))', () => {
      // Position (60, 45) => cell = 45 * 128 + 60 = 5820
      const ctx = makeReadyContext({
        tick: 0,
        baseBlueprint: [makeBP('POWR', House.USSR, 60, 45)],
      });
      updateBaseRebuild(ctx);
      const built = ctx.structures.find(
        s => s.type === 'POWR' && s.cx === 60 && s.cy === 45,
      );
      expect(built).toBeDefined();
      expect(built!.alive).toBe(true);
      expect(built!.house).toBe(House.USSR);
    });

    it('sets baseRebuildCooldown to GAME_TICKS_PER_SEC * 30 (= 450 ticks)', () => {
      const ctx = makeReadyContext({ tick: 0 });
      updateBaseRebuild(ctx);
      expect(ctx.baseRebuildCooldown).toBe(GAME_TICKS_PER_SEC * 30);
      expect(ctx.baseRebuildCooldown).toBe(450);
    });

    it('structure without production item builds without cost deduction', () => {
      const ctx = makeReadyContext({
        tick: 0,
        baseBlueprint: [makeBP('XYZZ', House.USSR, 50, 50)],
        // Use empty production items so XYZZ is not found
        scenarioProductionItems: [],
      });
      ctx.houseCredits.set(House.USSR, 5000);
      updateBaseRebuild(ctx);
      // Credits unchanged — no production item to deduct
      expect(ctx.houseCredits.get(House.USSR)).toBe(5000);
      // Structure built
      expect(ctx.baseRebuildCooldown).toBe(GAME_TICKS_PER_SEC * 30);
      const built = ctx.structures.find(s => s.type === 'XYZZ');
      expect(built).toBeDefined();
    });
  });

  // ---- Integration / lifecycle -----------------------------------------------

  describe('integration: full rebuild lifecycle', () => {
    it('full cycle: blueprint -> queue -> build -> cooldown -> next build', () => {
      const ctx = makeReadyContext({
        tick: 0,
        baseBlueprint: [
          makeBP('POWR', House.USSR, 50, 50),
          makeBP('PROC', House.USSR, 60, 60),
        ],
      });

      // Cycle 1: queue populated, POWR built (priority 0), cooldown set
      updateBaseRebuild(ctx);
      expect(ctx.baseRebuildCooldown).toBe(450); // GAME_TICKS_PER_SEC * 30 = 15 * 30 = 450
      const powr = ctx.structures.find(s => s.type === 'POWR' && s.cx === 50);
      expect(powr).toBeDefined();
      expect(ctx.baseRebuildQueue.length).toBe(1);
      expect(ctx.baseRebuildQueue[0].type).toBe('PROC');

      // Drain cooldown to 0
      for (let i = 0; i < 450; i++) {
        ctx.tick = i + 1; // doesn't matter for cooldown path
        updateBaseRebuild(ctx);
      }
      expect(ctx.baseRebuildCooldown).toBe(0);

      // Cycle 2: tick must be % 75 === 0
      ctx.tick = 750; // 750 % 75 === 0
      updateBaseRebuild(ctx);
      expect(ctx.baseRebuildCooldown).toBe(450);
      const proc = ctx.structures.find(s => s.type === 'PROC' && s.cx === 60);
      expect(proc).toBeDefined();
      expect(ctx.baseRebuildQueue.length).toBe(0);
    });

    it('multiple blueprint entries processed one per cycle', () => {
      const ctx = makeReadyContext({
        tick: 0,
        baseBlueprint: [
          makeBP('POWR', House.USSR, 50, 50),
          makeBP('PROC', House.USSR, 60, 60),
          makeBP('WEAP', House.USSR, 70, 70),
        ],
      });

      updateBaseRebuild(ctx);
      // Only one built per call
      const builtTypes = ctx.structures
        .filter(s => s.type !== 'FACT')
        .map(s => s.type);
      expect(builtTypes.length).toBe(1);
      expect(builtTypes[0]).toBe('POWR'); // highest priority
    });

    it('priority ordering verified end-to-end: POWR built before TSLA', () => {
      const ctx = makeReadyContext({
        tick: 0,
        baseBlueprint: [
          makeBP('TSLA', House.USSR, 70, 70), // priority 3
          makeBP('POWR', House.USSR, 50, 50), // priority 0
        ],
      });

      updateBaseRebuild(ctx);
      // POWR (priority 0) should have been built, not TSLA (priority 3)
      const built = ctx.structures.find(s => s.type === 'POWR' && s.cx === 50);
      expect(built).toBeDefined();
      const tsla = ctx.structures.find(s => s.type === 'TSLA' && s.cx === 70);
      expect(tsla).toBeUndefined();
      expect(ctx.baseRebuildQueue[0].type).toBe('TSLA');
    });

    it('cooldown countdown across ticks', () => {
      const ctx = makeReadyContext({ tick: 0 });
      updateBaseRebuild(ctx);
      expect(ctx.baseRebuildCooldown).toBe(450); // 15 * 30

      // Each call decrements by 1
      ctx.tick = 1;
      updateBaseRebuild(ctx);
      expect(ctx.baseRebuildCooldown).toBe(449);

      ctx.tick = 2;
      updateBaseRebuild(ctx);
      expect(ctx.baseRebuildCooldown).toBe(448);

      // Jump ahead
      for (let i = 0; i < 446; i++) {
        ctx.tick = 3 + i;
        updateBaseRebuild(ctx);
      }
      expect(ctx.baseRebuildCooldown).toBe(2);

      ctx.tick = 449;
      updateBaseRebuild(ctx);
      expect(ctx.baseRebuildCooldown).toBe(1);

      ctx.tick = 450;
      updateBaseRebuild(ctx);
      expect(ctx.baseRebuildCooldown).toBe(0);
    });

    it('queue persists between calls (not repopulated when non-empty)', () => {
      const ctx = makeReadyContext({
        tick: 0,
        baseBlueprint: [
          makeBP('POWR', House.USSR, 50, 50),
          makeBP('PROC', House.USSR, 60, 60),
        ],
      });

      // First call populates queue and builds POWR
      updateBaseRebuild(ctx);
      expect(ctx.baseRebuildQueue.length).toBe(1);
      expect(ctx.baseRebuildQueue[0].type).toBe('PROC');

      // Drain cooldown
      for (let i = 0; i < 600; i++) {
        ctx.tick = i + 1;
        updateBaseRebuild(ctx);
      }

      // Add a new blueprint entry — but queue is non-empty, so it should NOT be added
      ctx.baseBlueprint.push(makeBP('WEAP', House.USSR, 80, 80));
      ctx.tick = 750; // % 75 === 0
      updateBaseRebuild(ctx);
      // PROC built from existing queue
      const proc = ctx.structures.find(s => s.type === 'PROC' && s.cx === 60);
      expect(proc).toBeDefined();
      // WEAP was not added because queue was non-empty when the call started
      expect(ctx.baseRebuildQueue.length).toBe(0);
    });

    it('after queue is drained, next call repopulates from blueprint', () => {
      const ctx = makeReadyContext({
        tick: 0,
        baseBlueprint: [
          makeBP('POWR', House.USSR, 50, 50),
        ],
      });

      // Build POWR, drain queue
      updateBaseRebuild(ctx);
      expect(ctx.baseRebuildQueue.length).toBe(0);

      // Add a new missing structure to blueprint
      ctx.baseBlueprint.push(makeBP('PROC', House.USSR, 60, 60));

      // Drain cooldown
      for (let i = 0; i < 600; i++) {
        ctx.tick = i + 1;
        updateBaseRebuild(ctx);
      }

      // Queue is empty, so next call at tick % 75 === 0 repopulates
      ctx.tick = 750;
      updateBaseRebuild(ctx);
      // PROC should be built (queue repopulated and shifted)
      const proc = ctx.structures.find(s => s.type === 'PROC' && s.cx === 60);
      expect(proc).toBeDefined();
    });

    it('multi-house: each house needs its own FACT', () => {
      const ctx = makeMockAIContext({
        tick: 0,
        baseBlueprint: [
          makeBP('POWR', House.USSR, 50, 50),
          makeBP('POWR', House.Ukraine, 70, 70),
        ],
      });
      addAIHouse(ctx, House.USSR, { iq: 3 });
      addAIHouse(ctx, House.Ukraine, { iq: 3 });
      // Only USSR has FACT
      ctx.structures.push(makeStructure('FACT', House.USSR, 40, 40));
      ctx.houseCredits.set(House.USSR, 10000);
      ctx.houseCredits.set(House.Ukraine, 10000);

      updateBaseRebuild(ctx);
      // Only USSR's POWR should be built
      const ussrPowr = ctx.structures.find(
        s => s.type === 'POWR' && s.cx === 50 && s.cy === 50,
      );
      expect(ussrPowr).toBeDefined();
      const ukrPowr = ctx.structures.find(
        s => s.type === 'POWR' && s.cx === 70 && s.cy === 70,
      );
      expect(ukrPowr).toBeUndefined();
    });

    it('dead structure at blueprint position triggers rebuild', () => {
      const ctx = makeReadyContext({
        tick: 0,
        baseBlueprint: [makeBP('POWR', House.USSR, 50, 50)],
      });
      // Dead POWR at position — alive: false, so not in aliveSet
      ctx.structures.push(makeStructure('POWR', House.USSR, 50, 50, { alive: false }));
      updateBaseRebuild(ctx);
      // Dead structure doesn't block (alive check in blocking loop)
      // POWR should be rebuilt
      expect(ctx.baseRebuildCooldown).toBe(GAME_TICKS_PER_SEC * 30);
    });

    it('structure at different position does not satisfy blueprint', () => {
      const ctx = makeReadyContext({
        tick: 0,
        baseBlueprint: [makeBP('POWR', House.USSR, 50, 50)],
      });
      // Alive POWR at different position
      ctx.structures.push(makeStructure('POWR', House.USSR, 80, 80));
      updateBaseRebuild(ctx);
      // Blueprint position (50,50) still missing — should rebuild
      expect(ctx.baseRebuildCooldown).toBe(GAME_TICKS_PER_SEC * 30);
      const rebuilt = ctx.structures.find(
        s => s.type === 'POWR' && s.cx === 50 && s.cy === 50,
      );
      expect(rebuilt).toBeDefined();
    });

    it('blocking check uses structure footprint size from STRUCTURE_SIZE', () => {
      // WEAP is 3x2 at position (50, 50), footprint: (50-52, 50-51)
      const ctx = makeReadyContext({
        tick: 0,
        baseBlueprint: [makeBP('WEAP', House.USSR, 50, 50)],
      });
      // Place a GUN at (52, 51) — corner of WEAP footprint
      ctx.structures.push(makeStructure('GUN', House.USSR, 52, 51));
      updateBaseRebuild(ctx);
      // Should be blocked
      expect(ctx.baseRebuildCooldown).toBe(0);
      expect(ctx.baseRebuildQueue.length).toBe(0);
    });

    it('blocking check: structure just outside footprint does NOT block', () => {
      // POWR is 2x2 at (50,50): footprint (50,50) (51,50) (50,51) (51,51)
      const ctx = makeReadyContext({
        tick: 0,
        baseBlueprint: [makeBP('POWR', House.USSR, 50, 50)],
      });
      // Place a GUN at (52, 50) — just outside the 2x2 footprint
      ctx.structures.push(makeStructure('GUN', House.USSR, 52, 50));
      updateBaseRebuild(ctx);
      // Not blocked — POWR should be built
      expect(ctx.baseRebuildCooldown).toBe(GAME_TICKS_PER_SEC * 30);
    });
  });
});
