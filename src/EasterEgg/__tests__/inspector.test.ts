/**
 * Unit tests for GameInspector — 19 assertion checks.
 * Uses mock Entity/Game objects with known-bad states.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameInspector, type Anomaly } from '../engine/inspector';
import { Entity } from '../engine/entity';
import { Mission, UnitType, House, MAP_CELLS } from '../engine/types';
import type { Game } from '../engine/index';
import type { Effect } from '../engine/renderer';

// === Helpers ===

function makeEntity(type: UnitType, house: House, x = 1200, y = 1200): Entity {
  return new Entity(type, house, x, y);
}

/** Create a minimal mock Game for inspector checks */
function mockGame(overrides: Partial<{
  tick: number;
  entities: Entity[];
  effects: Effect[];
  corpses: unknown[];
  credits: number;
  displayCredits: number;
}>): Game {
  return {
    tick: overrides.tick ?? 100,
    entities: overrides.entities ?? [],
    effects: (overrides.effects ?? []) as Effect[],
    corpses: (overrides.corpses ?? []) as Game['corpses'],
    credits: overrides.credits ?? 1000,
    displayCredits: overrides.displayCredits ?? 1000,
  } as unknown as Game;
}

function findAnomaly(anomalies: Anomaly[], id: string): Anomaly | undefined {
  return anomalies.find(a => a.id === id);
}

// === Tests ===

describe('GameInspector', () => {
  let inspector: GameInspector;

  beforeEach(() => {
    inspector = new GameInspector();
  });

  // --- Physics ---

  describe('P1: Ground unit at altitude', () => {
    it('detects ground unit with flightAltitude > 0', () => {
      const e = makeEntity(UnitType.V_2TNK, House.Spain);
      e.flightAltitude = 20;
      const game = mockGame({ entities: [e] });
      const anomalies = inspector.check(game);
      expect(findAnomaly(anomalies, 'P1')).toBeDefined();
      expect(findAnomaly(anomalies, 'P1')!.severity).toBe('critical');
    });

    it('ignores V_TRAN at altitude', () => {
      const e = makeEntity(UnitType.V_TRAN, House.Spain);
      e.flightAltitude = 20;
      const game = mockGame({ entities: [e] });
      const anomalies = inspector.check(game);
      expect(findAnomaly(anomalies, 'P1')).toBeUndefined();
    });
  });

  describe('P2: Out of bounds', () => {
    it('detects entity at negative cell', () => {
      const e = makeEntity(UnitType.I_E1, House.Spain, -50, 100);
      const game = mockGame({ entities: [e] });
      const anomalies = inspector.check(game);
      expect(findAnomaly(anomalies, 'P2')).toBeDefined();
    });

    it('detects entity beyond map edge', () => {
      const e = makeEntity(UnitType.I_E1, House.Spain, MAP_CELLS * 24 + 100, 100);
      const game = mockGame({ entities: [e] });
      const anomalies = inspector.check(game);
      expect(findAnomaly(anomalies, 'P2')).toBeDefined();
    });
  });

  describe('P3: NaN position', () => {
    it('detects NaN x position', () => {
      const e = makeEntity(UnitType.I_E1, House.Spain);
      e.pos.x = NaN;
      const game = mockGame({ entities: [e] });
      const anomalies = inspector.check(game);
      expect(findAnomaly(anomalies, 'P3')).toBeDefined();
    });
  });

  describe('P4: Dead but moving', () => {
    it('detects dead entity with non-DIE mission', () => {
      const e = makeEntity(UnitType.I_E1, House.Spain);
      e.alive = false;
      e.mission = Mission.MOVE;
      const game = mockGame({ entities: [e] });
      const anomalies = inspector.check(game);
      expect(findAnomaly(anomalies, 'P4')).toBeDefined();
      expect(findAnomaly(anomalies, 'P4')!.severity).toBe('warning');
    });

    it('does not fire for dead entity with DIE mission', () => {
      const e = makeEntity(UnitType.I_E1, House.Spain);
      e.alive = false;
      e.mission = Mission.DIE;
      const game = mockGame({ entities: [e] });
      const anomalies = inspector.check(game);
      expect(findAnomaly(anomalies, 'P4')).toBeUndefined();
    });
  });

  // --- Behavior ---

  describe('B1: Harvester stuck seeking', () => {
    it('detects harvester stuck in seeking state', () => {
      const e = makeEntity(UnitType.V_HARV, House.Spain);
      e.harvesterState = 'seeking';
      e.mission = Mission.MOVE;

      // First check establishes the tracker
      const game1 = mockGame({ tick: 100, entities: [e] });
      inspector.check(game1);

      // Advance tick past threshold (150 ticks)
      const game2 = mockGame({ tick: 260, entities: [e] });
      const anomalies = inspector.check(game2);
      expect(findAnomaly(anomalies, 'B1')).toBeDefined();
      expect(findAnomaly(anomalies, 'B1')!.severity).toBe('critical');
    });

    it('does not fire if harvester transitions states', () => {
      const e = makeEntity(UnitType.V_HARV, House.Spain);
      e.harvesterState = 'seeking';

      const game1 = mockGame({ tick: 100, entities: [e] });
      inspector.check(game1);

      e.harvesterState = 'harvesting';
      const game2 = mockGame({ tick: 260, entities: [e] });
      const anomalies = inspector.check(game2);
      expect(findAnomaly(anomalies, 'B1')).toBeUndefined();
    });
  });

  describe('B2: Harvester stuck any state', () => {
    it('detects harvester stuck for 900+ ticks', () => {
      const e = makeEntity(UnitType.V_HARV, House.Spain);
      e.harvesterState = 'unloading';

      const game1 = mockGame({ tick: 100, entities: [e] });
      inspector.check(game1);

      const game2 = mockGame({ tick: 1010, entities: [e] });
      const anomalies = inspector.check(game2);
      expect(findAnomaly(anomalies, 'B2')).toBeDefined();
      expect(findAnomaly(anomalies, 'B2')!.severity).toBe('warning');
    });
  });

  describe('B3: Ant rotation lock', () => {
    it('detects ant stuck facing same direction while attacking', () => {
      const ant = makeEntity(UnitType.ANT1, House.USSR, 1200, 1200);
      const target = makeEntity(UnitType.I_E1, House.Spain, 1210, 1200);
      ant.mission = Mission.ATTACK;
      ant.target = target;
      ant.facing = 0;

      // Establish tracker
      const game1 = mockGame({ tick: 100, entities: [ant, target] });
      inspector.check(game1);

      // Advance past 45 tick threshold — facing unchanged
      const game2 = mockGame({ tick: 150, entities: [ant, target] });
      const anomalies = inspector.check(game2);
      expect(findAnomaly(anomalies, 'B3')).toBeDefined();
      expect(findAnomaly(anomalies, 'B3')!.severity).toBe('critical');
    });
  });

  describe('B4: Dead target reference', () => {
    it('detects entity targeting a long-dead unit', () => {
      const attacker = makeEntity(UnitType.V_2TNK, House.Spain);
      const target = makeEntity(UnitType.ANT1, House.USSR);
      target.alive = false;
      target.deathTick = 20;
      attacker.target = target;
      attacker.mission = Mission.ATTACK;

      const game = mockGame({ entities: [attacker] });
      const anomalies = inspector.check(game);
      expect(findAnomaly(anomalies, 'B4')).toBeDefined();
    });
  });

  // --- Combat ---

  describe('C1: Weapon cooldown stuck', () => {
    it('detects cooldown exceeding 3x rof', () => {
      const e = makeEntity(UnitType.V_2TNK, House.Spain);
      e.attackCooldown = 200; // rof is 50, 3x = 150
      const game = mockGame({ entities: [e] });
      const anomalies = inspector.check(game);
      expect(findAnomaly(anomalies, 'C1')).toBeDefined();
    });

    it('does not fire for normal cooldown', () => {
      const e = makeEntity(UnitType.V_2TNK, House.Spain);
      e.attackCooldown = 40; // below 3x rof
      const game = mockGame({ entities: [e] });
      const anomalies = inspector.check(game);
      expect(findAnomaly(anomalies, 'C1')).toBeUndefined();
    });
  });

  describe('C3: Invincible entity', () => {
    it('detects entity with unchanged HP while being targeted', () => {
      const target = makeEntity(UnitType.ANT1, House.USSR, 1200, 1200);
      const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 1210, 1200);
      attacker.mission = Mission.ATTACK;
      attacker.target = target;
      target.mission = Mission.ATTACK;

      // Establish tracker
      const game1 = mockGame({ tick: 100, entities: [target, attacker] });
      inspector.check(game1);

      // Advance 300+ ticks — HP unchanged
      const game2 = mockGame({ tick: 410, entities: [target, attacker] });
      const anomalies = inspector.check(game2);
      expect(findAnomaly(anomalies, 'C3')).toBeDefined();
    });
  });

  // --- Visual ---

  describe('V1: Effects explosion', () => {
    it('detects effects count > 200', () => {
      const effects = Array.from({ length: 201 }, (_, i) => ({
        type: 'explosion' as const,
        x: 0, y: 0, frame: 0, maxFrames: 10,
      }));
      const game = mockGame({ effects: effects as Effect[] });
      const anomalies = inspector.check(game);
      expect(findAnomaly(anomalies, 'V1')).toBeDefined();
    });

    it('does not fire when effects under 200', () => {
      const game = mockGame({ effects: [] });
      const anomalies = inspector.check(game);
      expect(findAnomaly(anomalies, 'V1')).toBeUndefined();
    });
  });

  describe('V2: Entity count explosion', () => {
    it('detects alive entities > 200', () => {
      const entities = Array.from({ length: 201 }, () =>
        makeEntity(UnitType.I_E1, House.Spain)
      );
      const game = mockGame({ entities });
      const anomalies = inspector.check(game);
      expect(findAnomaly(anomalies, 'V2')).toBeDefined();
    });
  });

  describe('V3: Corpse cap saturated', () => {
    it('detects corpse count at cap', () => {
      const corpses = Array.from({ length: 100 }, () => ({
        x: 0, y: 0, type: UnitType.I_E1, facing: 0, isInfantry: true, isAnt: false, alpha: 1, deathVariant: 0,
      }));
      const game = mockGame({ corpses });
      const anomalies = inspector.check(game);
      expect(findAnomaly(anomalies, 'V3')).toBeDefined();
    });
  });

  // --- Economy ---

  describe('E1: Negative credits', () => {
    it('detects negative credits', () => {
      const game = mockGame({ credits: -100 });
      const anomalies = inspector.check(game);
      expect(findAnomaly(anomalies, 'E1')).toBeDefined();
      expect(findAnomaly(anomalies, 'E1')!.severity).toBe('critical');
    });

    it('does not fire for zero credits', () => {
      const game = mockGame({ credits: 0 });
      const anomalies = inspector.check(game);
      expect(findAnomaly(anomalies, 'E1')).toBeUndefined();
    });
  });

  describe('E2: Display divergence', () => {
    it('detects large divergence after tick 300', () => {
      const game = mockGame({
        tick: 500,
        credits: 10000,
        displayCredits: 3000,
      });
      const anomalies = inspector.check(game);
      expect(findAnomaly(anomalies, 'E2')).toBeDefined();
    });

    it('does not fire before tick 300', () => {
      const game = mockGame({
        tick: 100,
        credits: 10000,
        displayCredits: 0,
      });
      const anomalies = inspector.check(game);
      expect(findAnomaly(anomalies, 'E2')).toBeUndefined();
    });
  });

  // --- Performance ---

  describe('F1: Tick duration spike', () => {
    it('reports tick over 100ms', () => {
      const anomaly = inspector.checkTickDuration(500, 150);
      expect(anomaly).toBeDefined();
      expect(anomaly!.id).toBe('F1');
      expect(anomaly!.severity).toBe('warning');
    });

    it('does not report normal tick', () => {
      const anomaly = inspector.checkTickDuration(500, 10);
      expect(anomaly).toBeNull();
    });
  });

  describe('F2: Path saturation', () => {
    it('detects >50% entities with MOVE but empty path', () => {
      const entities = Array.from({ length: 10 }, () => {
        const e = makeEntity(UnitType.I_E1, House.Spain);
        e.mission = Mission.MOVE;
        e.path = [];
        return e;
      });
      const game = mockGame({ entities });
      const anomalies = inspector.check(game);
      expect(findAnomaly(anomalies, 'F2')).toBeDefined();
    });

    it('does not fire when paths are present', () => {
      const entities = Array.from({ length: 10 }, () => {
        const e = makeEntity(UnitType.I_E1, House.Spain);
        e.mission = Mission.MOVE;
        e.path = [{ cx: 50, cy: 50 }];
        return e;
      });
      const game = mockGame({ entities });
      const anomalies = inspector.check(game);
      expect(findAnomaly(anomalies, 'F2')).toBeUndefined();
    });
  });

  // --- Deduplication ---

  describe('Deduplication', () => {
    it('suppresses same assertion within 150 ticks', () => {
      const game1 = mockGame({ tick: 100, credits: -100 });
      const a1 = inspector.check(game1);
      expect(findAnomaly(a1, 'E1')).toBeDefined();

      const game2 = mockGame({ tick: 200, credits: -100 });
      const a2 = inspector.check(game2);
      expect(findAnomaly(a2, 'E1')).toBeUndefined();
    });

    it('allows same assertion after 150 ticks', () => {
      const game1 = mockGame({ tick: 100, credits: -100 });
      inspector.check(game1);

      const game2 = mockGame({ tick: 260, credits: -100 });
      const a2 = inspector.check(game2);
      expect(findAnomaly(a2, 'E1')).toBeDefined();
    });
  });

  // --- Reset ---

  describe('reset()', () => {
    it('clears all trackers and dedup state', () => {
      const game = mockGame({ tick: 100, credits: -100 });
      inspector.check(game);
      inspector.reset();

      // Same tick should now fire again (dedup cleared)
      const a = inspector.check(game);
      expect(findAnomaly(a, 'E1')).toBeDefined();
    });
  });
});
